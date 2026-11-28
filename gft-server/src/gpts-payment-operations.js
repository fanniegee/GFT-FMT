import { z } from "zod";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { fail, digest } from "./gpts-money-security.js";
import { permissions } from "./gpts-payment-engine.js";

const uuid = z.string().uuid(),
  reason = z.object({ reason: z.string().trim().min(8).max(2000) }).strict();
export function installGptsPaymentOperations(
  app,
  { engine, query, getCustomer, getAdmin, getCookie, verifyPassword },
) {
  const root = "/api/gpts-payments/control",
    limited = rateLimit({
      windowMs: 15 * 60000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
    });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1 },
    fileFilter: (_req, file, callback) =>
      callback(null, ["image/jpeg", "image/png"].includes(file.mimetype)),
  });
  async function actor(req, staff) {
    const account = await (staff ? getAdmin(req) : getCustomer(req));
    if (!account)
      throw fail(
        401,
        staff
          ? "Sign in to your Trust staff account."
          : "Sign in to your GPTS account.",
      );
    return {
      type: staff ? "STAFF" : "CUSTOMER",
      id: String(staff ? account.admin_id : account.customer_id),
      email: account.email,
      founder: staff && String(account.role).toUpperCase() === "FOUNDER",
      session: digest(
        getCookie(req, staff ? "gft_admin_session" : "gpts_customer_session"),
      ),
    };
  }
  function route(
    method,
    path,
    staff,
    permission,
    sensitive,
    handler,
    { multipart = false } = {},
  ) {
    const auth = async (req, res, next) => {
      res.set("Cache-Control", "no-store");
      try {
        req.gptsControlActor = await actor(req, staff);
        if (staff) {
          if (Array.isArray(permission)) {
            let permitted = false;
            for (const entry of permission) {
              try {
                await engine.authorise(req.gptsControlActor, entry);
                permitted = true;
                break;
              } catch {}
            }
            if (!permitted)
              throw fail(
                403,
                "This payments permission has not been assigned.",
              );
          } else
            await engine.authorise(
              req.gptsControlActor,
              permission || "operations:view",
            );
        }
        if (sensitive)
          await engine.stepup(req.gptsControlActor, req.get("X-GPTS-Stepup"));
        next();
      } catch (error) {
        respond(res, error);
      }
    };
    app[method](
      root + (staff ? "/operations" : "/customer") + path,
      limited,
      auth,
      ...(multipart
        ? [
            (req, res, next) =>
              upload.single("image")(req, res, (error) =>
                error
                  ? res
                      .status(400)
                      .json({
                        ok: false,
                        error: "Use one JPEG or PNG image under 5 MB.",
                      })
                  : next(),
              ),
          ]
        : []),
      async (req, res) => {
        try {
          if (method === "post" && !multipart && !req.is("application/json"))
            throw fail(415, "Send application/json.");
          await engine.ensure();
          await handler(req, res, req.gptsControlActor);
        } catch (error) {
          respond(res, error);
        }
      },
    );
  }
  function respond(res, error) {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({
          ok: false,
          error: "Check the submitted details.",
          code: "INVALID_INPUT",
        });
    if (error.code === "23505")
      return res
        .status(409)
        .json({
          ok: false,
          error: "This record or decision already exists.",
          code: "ALREADY_RECORDED",
        });
    if (!error.status)
      console.error("GPTS controls request failed:", error.code || error.name);
    return res
      .status(error.status || 503)
      .json({
        ok: false,
        error: error.status
          ? error.message
          : "Payments controls are temporarily unavailable.",
        code: error.status ? error.code : "SERVICE_UNAVAILABLE",
      });
  }
  const ok = (res, data = {}) => res.json({ ok: true, ...data });
  for (const staff of [false, true]) {
    route("get", "/security", staff, null, false, async (_req, res, actor) =>
      ok(res, await engine.securityStatus(actor)),
    );
    route(
      "post",
      "/security/setup",
      staff,
      null,
      false,
      async (req, res, actor) => {
        const { password } = z
          .object({ password: z.string().min(1).max(200) })
          .strict()
          .parse(req.body);
        const sql = staff
          ? "SELECT password_hash FROM gft_admin_accounts WHERE admin_id=$1"
          : "SELECT password_hash FROM gpts_customers WHERE customer_id=$1";
        const account = (await query(sql, [actor.id])).rows[0];
        if (
          !account ||
          !(await verifyPassword(password, account.password_hash))
        )
          throw fail(401, "The current password is incorrect.");
        ok(res, await engine.startMfa(actor));
      },
    );
    route(
      "post",
      "/security/confirm",
      staff,
      null,
      false,
      async (req, res, actor) => {
        const data = z
          .object({
            code: z.string().min(6).max(24),
            enrol: z.boolean().default(false),
          })
          .strict()
          .parse(req.body);
        ok(
          res,
          await engine.confirmMfa(actor, data.code, { enrol: data.enrol }),
        );
      },
    );
  }
  route("get", "/overview", false, null, false, async (_req, res, actor) => {
    const customer = (
      await query(
        "SELECT full_name,financial_verification FROM gpts_customers WHERE customer_id=$1",
        [actor.id],
      )
    ).rows[0];
    const balances = (
      await query(
        "SELECT a.currency,a.account_id,a.transfer_id,(-SUM(l.signed_minor))::text AS held_minor FROM gpts_money_accounts a JOIN gpts_money_lines l USING(account_id,currency) WHERE a.customer_id=$1 AND a.kind='LIABILITY' GROUP BY a.currency,a.account_id,a.transfer_id ORDER BY a.currency,a.account_id",
        [actor.id],
      )
    ).rows;
    ok(res, {
      customer,
      balances,
      security: await engine.securityStatus(actor),
      policyConfigured: Boolean(await engine.policy()),
      providers: [...engine.adapters.keys()],
    });
  });
  route("get", "/recipients", false, null, false, async (_req, res, actor) =>
    ok(res, {
      recipients: (
        await query(
          "SELECT recipient_id,replaces_id,label,country,method,last_four,archived_at,created_at FROM gpts_recipients WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100",
          [actor.id],
        )
      ).rows,
    }),
  );
  route("post", "/recipients", false, null, true, async (req, res, actor) =>
    ok(res, { recipientId: await engine.addRecipient(actor, req.body) }),
  );
  route(
    "post",
    "/recipients/:id/replace",
    false,
    null,
    true,
    async (req, res, actor) =>
      ok(res, {
        recipientId: await engine.addRecipient(
          actor,
          req.body,
          uuid.parse(req.params.id),
        ),
      }),
  );
  route(
    "post",
    "/recipients/:id/archive",
    false,
    null,
    true,
    async (req, res, actor) => {
      z.object({}).strict().parse(req.body);
      await engine.archiveRecipient(actor, uuid.parse(req.params.id));
      ok(res);
    },
  );
  route(
    "get",
    "/verification",
    false,
    null,
    false,
    async (_req, res, actor) => {
      const cases = (
        await query(
          "SELECT case_id,status,submitted_at,created_at FROM gpts_verifications WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 50",
          [actor.id],
        )
      ).rows;
      const messages = (
        await query(
          "SELECT r.case_id,r.customer_message_enc FROM gpts_verification_reviews r JOIN gpts_verifications v USING(case_id) WHERE v.customer_id=$1 AND r.customer_message_enc IS NOT NULL ORDER BY r.created_at",
          [actor.id],
        )
      ).rows;
      ok(res, {
        cases: cases.map((row) => ({
          ...row,
          messages: messages
            .filter((message) => message.case_id === row.case_id)
            .map((message) =>
              engine.vault.open(
                message.customer_message_enc,
                "verification-message:" + row.case_id,
              ),
            ),
        })),
      });
    },
  );
  route("post", "/verification", false, null, true, async (req, res, actor) =>
    ok(res, { caseId: await engine.verification(actor, req.body) }),
  );
  route(
    "get",
    "/verification/:id/draft",
    false,
    null,
    true,
    async (req, res, actor) => {
      const record = (
        await query(
          "SELECT case_id,identity_enc FROM gpts_verifications WHERE case_id=$1 AND customer_id=$2 AND status='DRAFT'",
          [uuid.parse(req.params.id), actor.id],
        )
      ).rows[0];
      if (!record) throw fail(404, "Draft not found.");
      ok(res, {
        identity: engine.vault.open(
          record.identity_enc,
          "identity:" + record.case_id,
        ),
      });
    },
  );
  route(
    "post",
    "/verification/:id/update",
    false,
    null,
    true,
    async (req, res, actor) =>
      ok(res, {
        caseId: await engine.verification(
          actor,
          req.body,
          uuid.parse(req.params.id),
        ),
      }),
  );
  route(
    "post",
    "/verification/:id/images",
    false,
    null,
    true,
    async (req, res, actor) => {
      if (!req.file) throw fail(400, "Attach a JPEG or PNG document image.");
      ok(res, {
        imageId: await engine.uploadIdentity(
          actor,
          uuid.parse(req.params.id),
          req.body.kind,
          req.file.buffer,
        ),
      });
    },
    { multipart: true },
  );
  route(
    "post",
    "/verification/:id/submit",
    false,
    null,
    true,
    async (req, res, actor) => {
      z.object({}).strict().parse(req.body);
      await engine.submitVerification(actor, uuid.parse(req.params.id));
      ok(res);
    },
  );
  route("post", "/quotes", false, null, true, async (req, res, actor) => {
    const data = z
      .object({
        instructionId: uuid,
        recipientId: uuid,
        targetCurrency: z.enum(["USD", "ZWG", "ZAR", "BWP", "ZMW", "MZN"]),
      })
      .strict()
      .parse(req.body);
    ok(res, await engine.requestQuote(actor, data));
  });
  route("get", "/quotes", false, null, false, async (_req, res, actor) =>
    ok(res, {
      quotes: (
        await query(
          "SELECT quote_id,instruction_id,recipient_id,terms,terms_hash,expires_at,created_at FROM gpts_quotes WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 50",
          [actor.id],
        )
      ).rows,
    }),
  );
  route("post", "/transfers", false, null, true, async (req, res, actor) => {
    const transfer = await engine.acceptQuote(actor, req.body);
    const { funding_enc, ...safe } = transfer;
    ok(res, { transfer: safe });
  });
  route("get", "/transfers", false, null, false, async (_req, res, actor) =>
    ok(res, {
      transfers: (
        await query(
          "SELECT transfer_id,status,terms,funded_minor,refunded_minor,held_minor,hold_reason,provider_reference,created_at FROM gpts_payment_transfers WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100",
          [actor.id],
        )
      ).rows,
    }),
  );
  route(
    "get",
    "/transfers/:id/funding",
    false,
    null,
    true,
    async (req, res, actor) => {
      const record = (
        await query(
          "SELECT funding_enc FROM gpts_payment_transfers WHERE transfer_id=$1 AND customer_id=$2",
          [uuid.parse(req.params.id), actor.id],
        )
      ).rows[0];
      if (!record) throw fail(404, "Transfer not found.");
      ok(res, {
        instructions: record.funding_enc
          ? engine.vault.open(record.funding_enc, "funding:" + req.params.id)
          : null,
      });
    },
  );
  route(
    "post",
    "/transfers/:id/cancel",
    false,
    null,
    true,
    async (req, res, actor) => {
      z.object({}).strict().parse(req.body);
      await engine.cancel(actor, uuid.parse(req.params.id));
      ok(res);
    },
  );
  route(
    "post",
    "/transfers/:id/provider-status",
    false,
    null,
    true,
    async (req, res, actor) => {
      z.object({}).strict().parse(req.body);
      ok(res, await engine.providerStatus(actor, uuid.parse(req.params.id)));
    },
  );
  route(
    "get",
    "/transfers/:id/receipt",
    false,
    null,
    false,
    async (req, res, actor) => {
      const record = (
        await query(
          "SELECT r.receipt_id,r.summary,r.digest,r.created_at FROM gpts_payment_receipts r JOIN gpts_payment_transfers t USING(transfer_id) WHERE t.transfer_id=$1 AND t.customer_id=$2",
          [uuid.parse(req.params.id), actor.id],
        )
      ).rows[0];
      if (!record)
        throw fail(404, "No confirmed settlement receipt is available.");
      ok(res, { receipt: record });
    },
  );
  route("get", "/support", false, null, false, async (_req, res, actor) =>
    ok(res, {
      cases: (
        await query(
          "SELECT case_id,transfer_id,category,subject,status,created_at FROM gpts_support_cases WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100",
          [actor.id],
        )
      ).rows,
    }),
  );
  route("post", "/support", false, null, true, async (req, res, actor) =>
    ok(res, { caseId: await engine.openSupport(actor, req.body) }),
  );
  route(
    "post",
    "/support/:id/reply",
    false,
    null,
    true,
    async (req, res, actor) => {
      await engine.replySupport(actor, uuid.parse(req.params.id), req.body);
      ok(res);
    },
  );
  route(
    "get",
    "/support/:id/messages",
    false,
    null,
    true,
    async (req, res, actor) => {
      const record = (
        await query(
          "SELECT case_id FROM gpts_support_cases WHERE case_id=$1 AND customer_id=$2",
          [uuid.parse(req.params.id), actor.id],
        )
      ).rows[0];
      if (!record) throw fail(404, "Support case not found.");
      const messages = (
        await query(
          "SELECT message_id,actor_type,body_enc,created_at FROM gpts_support_messages WHERE case_id=$1 AND internal=FALSE ORDER BY created_at,message_id",
          [req.params.id],
        )
      ).rows.map(({ body_enc, ...row }) => ({
        ...row,
        body: engine.vault.open(body_enc, "support:" + req.params.id),
      }));
      ok(res, { messages });
    },
  );
  route(
    "get",
    "/overview",
    true,
    "operations:view",
    false,
    async (_req, res, actor) => {
      let assigned = permissions;
      if (!actor.founder)
        assigned =
          (
            await query(
              "SELECT permissions FROM gpts_ops_grants WHERE admin_id=$1",
              [actor.id],
            )
          ).rows[0]?.permissions || [];
      ok(res, {
        permissions: assigned,
        founder: actor.founder,
        security: await engine.securityStatus(actor),
        policy: await engine.policy(),
        providers: [...engine.adapters.keys()],
      });
    },
  );
  route(
    "get",
    "/staff",
    true,
    "operations:view",
    true,
    async (_req, res, actor) => {
      if (!actor.founder) throw fail(403, "Founder access is required.");
      ok(res, {
        staff: (
          await query(
            "SELECT a.admin_id,a.name,a.email,a.role,COALESCE(g.permissions,'[]'::jsonb) AS payment_permissions,COALESCE((SELECT jsonb_agg(own.customer_id) FROM gpts_staff_customer_links own WHERE own.admin_id=a.admin_id),'[]'::jsonb) AS personal_customers FROM gft_admin_accounts a LEFT JOIN gpts_ops_grants g USING(admin_id) WHERE a.active=TRUE AND UPPER(a.status)='ACTIVE' ORDER BY a.name,a.email",
          )
        ).rows,
      });
    },
  );
  route(
    "post",
    "/staff/:id",
    true,
    "operations:view",
    true,
    async (req, res, actor) => {
      if (!actor.founder) throw fail(403, "Founder access is required.");
      const { permissions: list } = z
        .object({ permissions: z.array(z.enum(permissions)) })
        .strict()
        .parse(req.body);
      if (
        !(
          await query(
            "SELECT admin_id FROM gft_admin_accounts WHERE admin_id=$1 AND active=TRUE AND UPPER(status)='ACTIVE'",
            [req.params.id],
          )
        ).rows.length
      )
        throw fail(404, "Active staff account not found.");
      await engine.grant(actor, req.params.id, list);
      ok(res);
    },
  );
  route(
    "post",
    "/staff/:id/ownership",
    true,
    "operations:view",
    true,
    async (req, res, actor) => {
      if (!actor.founder) throw fail(403, "Founder access is required.");
      const data = z
        .object({ customerId: uuid, linked: z.boolean() })
        .strict()
        .parse(req.body);
      if (
        !(
          await query(
            "SELECT admin_id FROM gft_admin_accounts WHERE admin_id=$1 AND active=TRUE AND UPPER(status)='ACTIVE'",
            [req.params.id],
          )
        ).rows.length
      )
        throw fail(404, "Active staff account not found.");
      await engine.linkStaffCustomer(
        actor,
        req.params.id,
        data.customerId,
        data.linked,
      );
      ok(res);
    },
  );
  route(
    "post",
    "/policy",
    true,
    "operations:view",
    true,
    async (req, res, actor) =>
      ok(res, { policy: await engine.savePolicy(actor, req.body) }),
  );
  route(
    "get",
    "/verifications",
    true,
    "verification:review",
    false,
    async (_req, res) =>
      ok(res, {
        cases: (
          await query(
            "SELECT v.case_id,v.customer_id,v.status,v.policy_version,v.created_at,c.full_name,c.email FROM gpts_verifications v JOIN gpts_customers c USING(customer_id) ORDER BY v.created_at DESC LIMIT 100",
          )
        ).rows,
      }),
  );
  route(
    "get",
    "/verifications/:id",
    true,
    "verification:review",
    true,
    async (req, res) => {
      const record = (
        await query("SELECT * FROM gpts_verifications WHERE case_id=$1", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      if (!record) throw fail(404, "Verification not found.");
      const { identity_enc, ...safe } = record;
      ok(res, {
        record: safe,
        identity: engine.vault.open(identity_enc, "identity:" + record.case_id),
        images: (
          await query(
            "SELECT image_id,kind,digest FROM gpts_identity_images WHERE case_id=$1",
            [record.case_id],
          )
        ).rows,
        reviews: (
          await query(
            "SELECT admin_id,decision,checks,note_enc,created_at FROM gpts_verification_reviews WHERE case_id=$1 ORDER BY created_at",
            [record.case_id],
          )
        ).rows.map(({ note_enc, ...review }) => ({
          ...review,
          note: engine.vault.open(
            note_enc,
            "verification-review:" + record.case_id,
          ),
        })),
      });
    },
  );
  route(
    "get",
    "/images/:id",
    true,
    "verification:review",
    true,
    async (req, res, actor) => {
      const record = (
        await query(
          "SELECT image_id,case_id,image_enc FROM gpts_identity_images WHERE image_id=$1",
          [uuid.parse(req.params.id)],
        )
      ).rows[0];
      if (!record) throw fail(404, "Image not found.");
      await engine.tx((client) =>
        engine.audit(client, actor, "IDENTITY_IMAGE_READ", record.case_id, {
          imageId: record.image_id,
        }),
      );
      res
        .set({
          "Content-Type": "image/jpeg",
          "Content-Disposition": 'attachment; filename="identity-image.jpg"',
          "X-Content-Type-Options": "nosniff",
        })
        .send(
          engine.vault.open(record.image_enc, "image:" + record.image_id, {
            binary: true,
          }),
        );
    },
  );
  route(
    "post",
    "/verifications/:id/review",
    true,
    "verification:review",
    true,
    async (req, res, actor) =>
      ok(res, {
        status: await engine.reviewVerification(
          actor,
          uuid.parse(req.params.id),
          req.body,
        ),
      }),
  );
  route(
    "post",
    "/customers/:id/hold",
    true,
    "compliance:manage",
    true,
    async (req, res, actor) => {
      const data = z
        .object({
          frozen: z.boolean(),
          reason: z.string().trim().min(8).max(2000),
        })
        .strict()
        .parse(req.body);
      await engine.freeze(
        actor,
        uuid.parse(req.params.id),
        data.frozen,
        data.reason,
      );
      ok(res);
    },
  );
  route(
    "get",
    "/transfers",
    true,
    "payments:review",
    false,
    async (_req, res) =>
      ok(res, {
        transfers: (
          await query(
            "SELECT transfer_id,customer_id,status,terms,funded_minor,held_minor,refunded_minor,hold_reason,provider_reference,created_at FROM gpts_payment_transfers ORDER BY created_at DESC LIMIT 100",
          )
        ).rows,
      }),
  );
  route(
    "post",
    "/transfers/:id/vote",
    true,
    "payments:review",
    true,
    async (req, res, actor) => {
      await engine.vote(actor, uuid.parse(req.params.id), req.body);
      ok(res);
    },
  );
  route(
    "post",
    "/transfers/:id/refund",
    true,
    "payments:review",
    true,
    async (req, res, actor) => {
      await engine.requestRefund(
        actor,
        uuid.parse(req.params.id),
        reason.parse(req.body).reason,
      );
      ok(res);
    },
  );
  route(
    "post",
    "/jobs/run",
    true,
    "payments:review",
    true,
    async (req, res, actor) => {
      z.object({}).strict().parse(req.body);
      await engine.tx((client) =>
        engine.audit(client, actor, "QUEUE_RUN_REQUESTED", "queue"),
      );
      let processed = 0;
      for (; processed < 10; processed++)
        if (!(await engine.runOneJob())) break;
      ok(res, { processed });
    },
  );
  route(
    "post",
    "/transfers/:id/provider-status",
    true,
    "finance:reconcile",
    true,
    async (req, res, actor) => {
      z.object({}).strict().parse(req.body);
      ok(res, await engine.providerStatus(actor, uuid.parse(req.params.id)));
    },
  );
  route(
    "post",
    "/jobs/:id/resume",
    true,
    "payments:review",
    true,
    async (req, res, actor) => {
      await engine.resumeJob(
        actor,
        uuid.parse(req.params.id),
        reason.parse(req.body).reason,
      );
      ok(res);
    },
  );
  route("get", "/risk", true, "compliance:manage", false, async (_req, res) =>
    ok(res, {
      flags: (
        await query(
          "SELECT event_id,actor_type,actor_id,action,reference,details,created_at FROM gpts_ops_events WHERE action IN('SCREENING_REVIEW_REQUIRED','MFA_FAILED','JOB_HELD') ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
    }),
  );
  route(
    "get",
    "/ledger",
    true,
    ["finance:reconcile", "audit:view"],
    true,
    async (_req, res) =>
      ok(res, {
        balances: (
          await query(
            "SELECT a.currency,a.kind,SUM(l.signed_minor)::text AS signed_minor FROM gpts_money_accounts a JOIN gpts_money_lines l USING(account_id,currency) GROUP BY a.currency,a.kind ORDER BY a.currency,a.kind",
          )
        ).rows,
        journals: (
          await query(
            "SELECT journal_id,event_key,transfer_id,kind,created_at FROM gpts_money_journals ORDER BY created_at DESC LIMIT 100",
          )
        ).rows,
      }),
  );
  route(
    "get",
    "/reconciliation",
    true,
    "finance:reconcile",
    false,
    async (_req, res) =>
      ok(res, {
        issues: (
          await query(
            "SELECT issue_id,provider_key,row_id,status,reason,created_at,resolved_at FROM gpts_reconciliation_issues ORDER BY created_at DESC LIMIT 100",
          )
        ).rows,
        events: (
          await query(
            "SELECT provider_key,event_id,status,error_code,created_at FROM gpts_provider_events WHERE status<>'APPLIED' ORDER BY created_at DESC LIMIT 100",
          )
        ).rows,
        jobs: (
          await query(
            "SELECT job_id,transfer_id,operation,status,attempts,last_error,created_at FROM gpts_payment_jobs WHERE status IN('RETRY','MANUAL_REVIEW') ORDER BY created_at DESC LIMIT 100",
          )
        ).rows,
      }),
  );
  route(
    "post",
    "/reconciliation/:provider",
    true,
    "finance:reconcile",
    true,
    async (req, res, actor) => {
      const { date } = z.object({ date: z.string() }).strict().parse(req.body);
      ok(res, await engine.reconcile(actor, req.params.provider, date));
    },
  );
  route(
    "post",
    "/reconciliation/issues/:id/resolve",
    true,
    "finance:reconcile",
    true,
    async (req, res, actor) => {
      await engine.resolveIssue(
        actor,
        uuid.parse(req.params.id),
        reason.parse(req.body).reason,
      );
      ok(res);
    },
  );
  route(
    "post",
    "/events/:provider/:id/retry",
    true,
    "finance:reconcile",
    true,
    async (req, res, actor) => {
      const data = reason.parse(req.body);
      await engine.tx((client) =>
        engine.audit(
          client,
          actor,
          "PROVIDER_EVENT_RETRY",
          req.params.id,
          { provider: req.params.provider },
          data.reason,
        ),
      );
      await engine.applyEvent(req.params.provider, req.params.id);
      ok(res);
    },
  );
  route("get", "/support", true, "support:manage", false, async (_req, res) =>
    ok(res, {
      cases: (
        await query(
          "SELECT case_id,customer_id,transfer_id,category,subject,status,created_at FROM gpts_support_cases ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
    }),
  );
  route(
    "get",
    "/support/:id/messages",
    true,
    "support:manage",
    true,
    async (req, res) => {
      const caseId = uuid.parse(req.params.id);
      const messages = (
        await query(
          "SELECT message_id,actor_type,actor_id,internal,body_enc,created_at FROM gpts_support_messages WHERE case_id=$1 ORDER BY created_at,message_id",
          [caseId],
        )
      ).rows.map(({ body_enc, ...row }) => ({
        ...row,
        body: engine.vault.open(body_enc, "support:" + caseId),
      }));
      ok(res, { messages });
    },
  );
  route(
    "post",
    "/support/:id/reply",
    true,
    "support:manage",
    true,
    async (req, res, actor) => {
      await engine.replySupport(actor, uuid.parse(req.params.id), req.body);
      ok(res);
    },
  );
  route("get", "/policy/history", true, "audit:view", true, async (_req, res) =>
    ok(res, {
      versions: (
        await query(
          "SELECT version,settings,updated_by,created_at FROM gpts_policy_versions ORDER BY version DESC LIMIT 100",
        )
      ).rows,
    }),
  );
  route("get", "/audit", true, "audit:view", true, async (_req, res) =>
    ok(res, {
      events: (
        await query(
          "SELECT event_id,actor_type,actor_id,action,reference,details,created_at FROM gpts_ops_events ORDER BY created_at DESC,event_id DESC LIMIT 200",
        )
      ).rows,
    }),
  );
  app.post(
    "/api/gpts-payments/providers/:provider/events",
    limited,
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      try {
        if (!Buffer.isBuffer(req.gptsRawBody))
          throw fail(400, "Raw signed event body is required.");
        const eventId = await engine.ingest(
          req.params.provider,
          req.gptsRawBody,
          req.headers,
        );
        ok(res, { eventId });
      } catch (error) {
        respond(res, error);
      }
    },
  );
  return {
    actor,
    async pageGuard(req, res, next) {
      res.set("Cache-Control", "no-store");
      try {
        const staff = req.path === "/gpts-operations.html",
          current = await actor(req, staff);
        if (staff) await engine.authorise(current, "operations:view");
        next();
      } catch (error) {
        if (error.status === 401)
          return res.redirect(
            req.path === "/gpts-operations.html"
              ? "/admin.html"
              : "/gpts-customer-access.html",
          );
        if (error.status === 403)
          return res
            .status(403)
            .type("html")
            .send(
              '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payments access required</title><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/gpts-controls.css"><main><section class="control-panel"><h1>Payments access required</h1><p>Your account needs assigned GPTS payments permissions to enter this workspace.</p><a href="/admin.html">Return to your Admin platform</a></section></main></html>',
            );
        respond(res, error);
      }
    },
  };
}

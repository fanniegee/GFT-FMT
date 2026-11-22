import { randomUUID } from "node:crypto";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const methods = new Set(["Bank", "Ecocash", "MobileMoney", "EWallet"]);
const stages = new Set([
  "SUBMITTED",
  "UNDER_REVIEW",
  "SHORTLISTED",
  "INTERVIEW",
  "OFFERED",
  "REJECTED",
  "WITHDRAWN",
]);
const field = (value, max) =>
  typeof value === "string" && value.trim().length <= max ? value.trim() : "";
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
function destination(method, data) {
  const provider = field(
    data?.provider || data?.bankName || (method === "Ecocash" ? "EcoCash" : ""),
    100,
  );
  const accountNumber = field(data?.accountNumber || data?.number, 80);
  const accountHolder = field(data?.accountHolder || data?.name, 160);
  if (
    !methods.has(method) ||
    !provider ||
    !accountHolder ||
    !/^[A-Za-z0-9+ ._-]{4,80}$/.test(accountNumber)
  )
    throw fail(
      "Enter the payment provider, account holder and account or wallet number.",
    );
  return {
    provider,
    accountNumber,
    accountHolder,
    bankName: provider,
    number: accountNumber,
    name: accountHolder,
  };
}
function fileData(file, image = false) {
  if (
    !file ||
    typeof file.base64 !== "string" ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)
  )
    throw fail("Choose a valid file.");
  const bytes = Buffer.from(file.base64, "base64");
  if (!bytes.length || bytes.length > 400 * 1024)
    throw fail("The file must be no larger than 400 KB.");
  if (image) {
    const jpeg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!jpeg && !png) throw fail("Choose a JPEG or PNG image.");
    return { bytes, mime: jpeg ? "image/jpeg" : "image/png" };
  }
  if (bytes.subarray(0, 5).toString() !== "%PDF-")
    throw fail("Upload your CV as a PDF.");
  return { bytes, name: field(file.name, 150) || "CV.pdf" };
}
export function installBeneficiaryProfile(
  app,
  { query, withTransaction, getBeneficiary, getAdmin },
) {
  async function configuredCompanies(runQuery = query, required = true) {
    const { rows } = await runQuery(
      "SELECT config_value FROM configuration WHERE config_key = 'public_site' LIMIT 1",
    );
    const companies = rows[0]?.config_value?.companies;
    if (!Array.isArray(companies)) {
      if (required) throw fail("Company information is temporarily unavailable.", 503);
      return [];
    }
    return companies.filter(
      (company) =>
        company &&
        company.id !== undefined &&
        company.id !== null &&
        company.name,
    );
  }
  function companyJobs(rows, companies) {
    return rows.map((job) => {
      const company = companies.find(
        (item) => String(item.id) === job.company_id,
      );
      return { ...job, company: company?.name || job.company };
    });
  }
  let schema;
  function ensureSchema() {
    schema ??= withTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('beneficiary-profile-v1'))",
      );
      await client.query(
        [
          "ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS wallet_eligible_at TIMESTAMPTZ;",
          "UPDATE beneficiaries b SET wallet_eligible_at=w.created_at FROM (SELECT owner_system_id,min(created_at) AS created_at FROM wallets GROUP BY owner_system_id) w WHERE b.system_id=w.owner_system_id AND b.wallet_eligible_at IS NULL;",
          "CREATE OR REPLACE FUNCTION gft_record_wallet_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE beneficiaries SET wallet_eligible_at=COALESCE(wallet_eligible_at,NEW.created_at) WHERE system_id=NEW.owner_system_id; RETURN NEW; END $$;",
          "DROP TRIGGER IF EXISTS gft_wallet_eligibility ON wallets;",
          "CREATE TRIGGER gft_wallet_eligibility AFTER INSERT ON wallets FOR EACH ROW EXECUTE FUNCTION gft_record_wallet_eligibility();",
          "CREATE TABLE IF NOT EXISTS beneficiary_profile_photos(system_id TEXT PRIMARY KEY REFERENCES beneficiaries(system_id),image BYTEA NOT NULL,mime TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());",
          "CREATE TABLE IF NOT EXISTS beneficiary_payment_methods(payment_id UUID PRIMARY KEY,system_id TEXT NOT NULL REFERENCES beneficiaries(system_id),method TEXT NOT NULL,label TEXT NOT NULL,destination JSONB NOT NULL,is_default BOOLEAN NOT NULL DEFAULT FALSE,active BOOLEAN NOT NULL DEFAULT TRUE,legacy_cashout_id UUID UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());",
          "CREATE UNIQUE INDEX IF NOT EXISTS beneficiary_payment_default_idx ON beneficiary_payment_methods(system_id) WHERE is_default AND active;",
          "CREATE TABLE IF NOT EXISTS beneficiary_jobs(job_id UUID PRIMARY KEY,title TEXT NOT NULL,company TEXT NOT NULL,location TEXT NOT NULL,description TEXT NOT NULL,closing_date DATE NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());",
          "CREATE TABLE IF NOT EXISTS beneficiary_job_applications(application_id UUID PRIMARY KEY,job_id UUID NOT NULL REFERENCES beneficiary_jobs(job_id),system_id TEXT NOT NULL REFERENCES beneficiaries(system_id),cover_letter TEXT NOT NULL,cv BYTEA NOT NULL,cv_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'SUBMITTED',reply TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(job_id,system_id));",
          "CREATE TABLE IF NOT EXISTS beneficiary_job_replies(event_id UUID PRIMARY KEY,application_id UUID NOT NULL REFERENCES beneficiary_job_applications(application_id),admin_id TEXT NOT NULL,status TEXT NOT NULL,reply TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());",
        ].join("\n"),
      );
      await client.query(
        "ALTER TABLE beneficiary_jobs ADD COLUMN IF NOT EXISTS company_id TEXT",
      );
      const companies = await configuredCompanies(client.query.bind(client), false);
      for (const company of companies) {
        const matches = companies.filter(
          (item) =>
            item.name.trim().toLowerCase() ===
            company.name.trim().toLowerCase(),
        );
        if (matches.length !== 1) continue;
        await client.query(
          "UPDATE beneficiary_jobs SET company_id = $1 WHERE company_id IS NULL AND LOWER(TRIM(company)) = LOWER(TRIM($2))",
          [String(company.id), company.name],
        );
      }
      const legacy = await client.query(
        "SELECT DISTINCT ON(beneficiary_system_id) cashout_id,beneficiary_system_id,method,destination FROM cashout_requests WHERE method IN ('Bank','Ecocash') ORDER BY beneficiary_system_id,created_at DESC,cashout_id DESC",
      );
      for (const row of legacy.rows) {
        const owner = await client.query(
          "SELECT full_name FROM beneficiaries WHERE system_id=$1",
          [row.beneficiary_system_id],
        );
        if (!owner.rowCount) continue;
        let details;
        try {
          details = destination(row.method, {
            ...row.destination,
            accountHolder:
              row.destination.accountHolder ||
              row.destination.name ||
              owner.rows[0].full_name,
          });
        } catch {
          continue;
        }
        await client.query(
          "INSERT INTO beneficiary_payment_methods(payment_id,system_id,method,label,destination,is_default,legacy_cashout_id) VALUES($1,$2,$3,$4,$5::jsonb,NOT EXISTS(SELECT 1 FROM beneficiary_payment_methods WHERE system_id=$2 AND active),$6) ON CONFLICT(legacy_cashout_id) DO NOTHING",
          [
            randomUUID(),
            row.beneficiary_system_id,
            row.method,
            details.provider,
            JSON.stringify(details),
            row.cashout_id,
          ],
        );
      }
    }).catch((error) => {
      schema = undefined;
      throw error;
    });
    return schema;
  }
  function manageJobs(actor) {
    return (
      String(actor.role).toUpperCase() === "FOUNDER" ||
      actor.deployment?.permissions?.some((p) =>
        ["jobs:manage", "companies:manage"].includes(p),
      )
    );
  }
  function route(method, path, handler, admin = false) {
    app[method](path, async (req, res) => {
      res.set("Cache-Control", "private, no-store");
      try {
        const actor = admin ? await getAdmin(req) : await getBeneficiary(req);
        if (!actor) throw fail("Please sign in.", 401);
        if (admin && !manageJobs(actor))
          throw fail("Job management permission is required.", 403);
        if (method !== "get" && !req.is("application/json"))
          throw fail("Send JSON data.", 415);
        await ensureSchema();
        return await handler(req, res, actor);
      } catch (error) {
        if (!error.status)
          console.error(
            "Beneficiary profile request failed:",
            error.code || error.name,
          );
        return res.status(error.status || 500).json({
          ok: false,
          error: error.status
            ? error.message
            : "Unable to complete this request.",
        });
      }
    });
  }
  async function paymentDestination(runQuery, systemId, paymentId) {
    await ensureSchema();
    if (paymentId && !uuid.test(paymentId))
      throw fail("Choose a saved payment account.");
    const { rows } = await runQuery(
      "SELECT payment_id,method,destination FROM beneficiary_payment_methods WHERE system_id=$1 AND active AND ($2::uuid IS NULL OR payment_id=$2) ORDER BY is_default DESC,created_at DESC,payment_id LIMIT 1",
      [systemId, paymentId || null],
    );
    if (!rows.length)
      throw fail(
        "Set up a payment account under Profile before requesting cashout.",
        409,
      );
    return {
      ...rows[0].destination,
      method: rows[0].method,
      paymentMethodId: rows[0].payment_id,
    };
  }
  route(
    "get",
    "/api/beneficiary/profile/settings",
    async (_req, res, actor) => {
      const { rows } = await query(
        "SELECT payment_id,method,label,destination,is_default FROM beneficiary_payment_methods WHERE system_id=$1 AND active ORDER BY is_default DESC,created_at",
        [actor.system_id],
      );
      const photo = await query(
        "SELECT updated_at FROM beneficiary_profile_photos WHERE system_id=$1",
        [actor.system_id],
      );
      return res.json({
        ok: true,
        payments: rows,
        photo: photo.rows[0]?.updated_at || null,
      });
    },
  );
  route("get", "/api/beneficiary/profile/photo", async (_req, res, actor) => {
    const { rows } = await query(
      "SELECT image,mime FROM beneficiary_profile_photos WHERE system_id=$1",
      [actor.system_id],
    );
    return rows.length
      ? res.type(rows[0].mime).send(rows[0].image)
      : res.sendStatus(404);
  });
  route("put", "/api/beneficiary/profile/photo", async (req, res, actor) => {
    const file = fileData(req.body, true);
    await query(
      "INSERT INTO beneficiary_profile_photos(system_id,image,mime) VALUES($1,$2,$3) ON CONFLICT(system_id) DO UPDATE SET image=EXCLUDED.image,mime=EXCLUDED.mime,updated_at=NOW()",
      [actor.system_id, file.bytes, file.mime],
    );
    return res.json({ ok: true });
  });
  route(
    "delete",
    "/api/beneficiary/profile/photo",
    async (_req, res, actor) => {
      await query("DELETE FROM beneficiary_profile_photos WHERE system_id=$1", [
        actor.system_id,
      ]);
      return res.json({ ok: true });
    },
  );
  route(
    "post",
    "/api/beneficiary/profile/payments",
    async (req, res, actor) => {
      const label = field(req.body?.label, 100),
        id = req.body?.paymentId;
      if (!label || (id && !uuid.test(id)))
        throw fail("Give the account a label.");
      const details = destination(req.body.method, req.body.destination);
      const paymentId = await withTransaction(async (client) => {
        await client.query(
          "SELECT system_id FROM beneficiaries WHERE system_id=$1 FOR UPDATE",
          [actor.system_id],
        );
        if (id) {
          const existing = await client.query(
            "SELECT 1 FROM beneficiary_payment_methods WHERE payment_id=$1 AND system_id=$2 AND active",
            [id, actor.system_id],
          );
          if (!existing.rowCount) throw fail("Account unavailable.", 404);
        }
        const exists = await client.query(
          "SELECT 1 FROM beneficiary_payment_methods WHERE system_id=$1 AND active",
          [actor.system_id],
        );
        const isDefault = req.body.isDefault === true || !exists.rowCount;
        if (isDefault)
          await client.query(
            "UPDATE beneficiary_payment_methods SET is_default=FALSE WHERE system_id=$1",
            [actor.system_id],
          );
        const savedId = id || randomUUID();
        if (id)
          await client.query(
            "UPDATE beneficiary_payment_methods SET label=$3,method=$4,destination=$5::jsonb,is_default=CASE WHEN $6 THEN TRUE ELSE is_default END WHERE payment_id=$1 AND system_id=$2",
            [
              id,
              actor.system_id,
              label,
              req.body.method,
              JSON.stringify(details),
              isDefault,
            ],
          );
        else
          await client.query(
            "INSERT INTO beneficiary_payment_methods(payment_id,system_id,label,method,destination,is_default) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
            [
              savedId,
              actor.system_id,
              label,
              req.body.method,
              JSON.stringify(details),
              isDefault,
            ],
          );
        return savedId;
      });
      return res.json({ ok: true, paymentId });
    },
  );
  route(
    "delete",
    "/api/beneficiary/profile/payments/:id",
    async (req, res, actor) => {
      if (!uuid.test(req.params.id)) throw fail("Invalid account.");
      await withTransaction(async (client) => {
        await client.query(
          "SELECT system_id FROM beneficiaries WHERE system_id=$1 FOR UPDATE",
          [actor.system_id],
        );
        const result = await client.query(
          "UPDATE beneficiary_payment_methods SET active=FALSE,is_default=FALSE WHERE payment_id=$1 AND system_id=$2 AND active RETURNING payment_id",
          [req.params.id, actor.system_id],
        );
        if (!result.rowCount) throw fail("Account unavailable.", 404);
        await client.query(
          "UPDATE beneficiary_payment_methods SET is_default=TRUE WHERE payment_id=(SELECT payment_id FROM beneficiary_payment_methods WHERE system_id=$1 AND active ORDER BY created_at,payment_id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM beneficiary_payment_methods WHERE system_id=$1 AND active AND is_default)",
          [actor.system_id],
        );
      });
      return res.json({ ok: true });
    },
  );
  route("get", "/api/beneficiary/jobs", async (_req, res) => {
    const { rows } = await query(
      "SELECT job_id,title,company,company_id,location,description,closing_date FROM beneficiary_jobs WHERE active AND closing_date>=CURRENT_DATE ORDER BY created_at DESC",
    );
    const companies = await configuredCompanies();
    const jobs = companyJobs(rows, companies).filter((job) =>
      companies.some((company) => String(company.id) === job.company_id),
    );
    return res.json({ ok: true, jobs, companies });
  });
  route(
    "post",
    "/api/beneficiary/jobs/:id/applications",
    async (req, res, actor) => {
      const letter = field(req.body?.coverLetter, 5000);
      if (!uuid.test(req.params.id) || !letter)
        throw fail("Choose a job and enter your application.");
      const companies = await configuredCompanies();
      const file = fileData(req.body.cv);
      const { rows } = await query(
        "INSERT INTO beneficiary_job_applications(application_id,job_id,system_id,cover_letter,cv,cv_name) SELECT $1,job_id,$3,$4,$5,$6 FROM beneficiary_jobs WHERE job_id=$2 AND active AND closing_date>=CURRENT_DATE AND company_id=ANY($7::text[]) ON CONFLICT(job_id,system_id) DO NOTHING RETURNING application_id",
        [
          randomUUID(),
          req.params.id,
          actor.system_id,
          letter,
          file.bytes,
          file.name,
          companies.map((company) => String(company.id)),
        ],
      );
      if (!rows.length)
        throw fail(
          "You have already applied, or the opportunity has closed.",
          409,
        );
      return res
        .status(201)
        .json({ ok: true, applicationId: rows[0].application_id });
    },
  );
  route(
    "get",
    "/api/beneficiary/profile/applications",
    async (_req, res, actor) => {
      const { rows } = await query(
        "SELECT a.application_id,j.title,j.company,a.status,a.reply,a.created_at,a.updated_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('status',r.status,'reply',r.reply,'created_at',r.created_at) ORDER BY r.created_at) FROM beneficiary_job_replies r WHERE r.application_id=a.application_id),'[]'::jsonb) AS replies FROM beneficiary_job_applications a JOIN beneficiary_jobs j ON j.job_id=a.job_id WHERE a.system_id=$1 ORDER BY a.updated_at DESC",
        [actor.system_id],
      );
      return res.json({ ok: true, applications: rows });
    },
  );
  route(
    "get",
    "/api/admin/beneficiary-jobs",
    async (_req, res) => {
      const { rows } = await query(
        "SELECT job_id,title,company,company_id,location,description,closing_date,active FROM beneficiary_jobs ORDER BY created_at DESC",
      );
      const companies = await configuredCompanies();
      return res.json({
        ok: true,
        jobs: companyJobs(rows, companies),
        companies,
      });
    },
    true,
  );
  route(
    "post",
    "/api/admin/beneficiary-jobs",
    async (req, res, actor) => {
      const title = field(req.body?.title, 160),
        companyId = String(req.body?.companyId ?? ""),
        location = field(req.body?.location, 160),
        description = field(req.body?.description, 10000),
        closingDate = field(req.body?.closingDate, 10);
      if (
        !title ||
        !companyId ||
        !location ||
        !description ||
        !/^\d{4}-\d{2}-\d{2}$/.test(closingDate) ||
        Number.isNaN(Date.parse(closingDate))
      )
        throw fail("Complete the vacancy fields and closing date.");
      const companies = await configuredCompanies();
      const company = companies.find((item) => String(item.id) === companyId);
      if (!company) throw fail("Choose a company from the Trust company list.");
      const id = randomUUID();
      await query(
        "INSERT INTO beneficiary_jobs(job_id,title,company,location,description,closing_date,created_by,company_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          title,
          company.name,
          location,
          description,
          closingDate,
          actor.admin_id,
          companyId,
        ],
      );
      return res.status(201).json({ ok: true, jobId: id });
    },
    true,
  );
  route(
    "patch",
    "/api/admin/beneficiary-jobs/:id",
    async (req, res) => {
      if (
        !uuid.test(req.params.id) ||
        (typeof req.body?.active !== "boolean" &&
          req.body?.companyId === undefined)
      )
        throw fail("Choose a vacancy action.");
      const companies = await configuredCompanies();
      const companyId =
        req.body.companyId === undefined ? null : String(req.body.companyId);
      const company = companies.find((item) => String(item.id) === companyId);
      if (companyId !== null && !company)
        throw fail("Choose a company from the Trust company list.");
      const result = await query(
        "UPDATE beneficiary_jobs SET active=COALESCE($2,active),company_id=COALESCE($3,company_id),company=COALESCE($4,company) WHERE job_id=$1 RETURNING job_id",
        [
          req.params.id,
          typeof req.body.active === "boolean" ? req.body.active : null,
          companyId,
          company?.name || null,
        ],
      );
      if (!result.rowCount) throw fail("Vacancy unavailable.", 404);
      return res.json({ ok: true });
    },
    true,
  );
  route(
    "get",
    "/api/admin/beneficiary-job-applications",
    async (_req, res) => {
      const { rows } = await query(
        "SELECT a.application_id,a.system_id,b.full_name,j.title,j.company,a.status,a.cover_letter,a.reply,a.created_at FROM beneficiary_job_applications a JOIN beneficiary_jobs j ON j.job_id=a.job_id JOIN beneficiaries b ON b.system_id=a.system_id ORDER BY a.created_at DESC LIMIT 200",
      );
      return res.json({ ok: true, applications: rows });
    },
    true,
  );
  route(
    "get",
    "/api/admin/beneficiary-job-applications/:id/cv",
    async (req, res) => {
      if (!uuid.test(req.params.id)) throw fail("Invalid application.");
      const { rows } = await query(
        "SELECT cv FROM beneficiary_job_applications WHERE application_id=$1",
        [req.params.id],
      );
      if (!rows.length) throw fail("Application unavailable.", 404);
      return res
        .set("Content-Disposition", 'attachment; filename="CV.pdf"')
        .type("application/pdf")
        .send(rows[0].cv);
    },
    true,
  );
  route(
    "post",
    "/api/admin/beneficiary-job-applications/:id/reply",
    async (req, res, actor) => {
      const status = req.body?.status,
        reply = field(req.body?.reply, 5000);
      if (!uuid.test(req.params.id) || !stages.has(status) || !reply)
        throw fail("Choose a status and write a reply.");
      await withTransaction(async (client) => {
        const result = await client.query(
          "UPDATE beneficiary_job_applications SET status=$2,reply=$3,updated_at=NOW() WHERE application_id=$1 RETURNING application_id",
          [req.params.id, status, reply],
        );
        if (!result.rowCount) throw fail("Application unavailable.", 404);
        await client.query(
          "INSERT INTO beneficiary_job_replies(event_id,application_id,admin_id,status,reply) VALUES($1,$2,$3,$4,$5)",
          [randomUUID(), req.params.id, actor.admin_id, status, reply],
        );
      });
      return res.json({ ok: true });
    },
    true,
  );

  async function saveLegacyDestination(systemId, method, details) {
    await ensureSchema();
    return withTransaction(async (client) => {
      const owner = await client.query(
        "SELECT full_name FROM beneficiaries WHERE system_id=$1 FOR UPDATE",
        [systemId],
      );
      if (!owner.rowCount) throw fail("Beneficiary unavailable.", 404);
      const saved = destination(method, {
        ...details,
        accountHolder:
          details.accountHolder || details.name || owner.rows[0].full_name,
      });
      const old = await client.query(
        "INSERT INTO cashout_requests(beneficiary_system_id,method,destination) VALUES($1,$2,$3::jsonb) RETURNING cashout_id,status",
        [systemId, method, JSON.stringify(saved)],
      );
      await client.query(
        "UPDATE beneficiary_payment_methods SET is_default=FALSE WHERE system_id=$1",
        [systemId],
      );
      await client.query(
        "INSERT INTO beneficiary_payment_methods(payment_id,system_id,method,label,destination,is_default,legacy_cashout_id) VALUES($1,$2,$3,$4,$5::jsonb,TRUE,$6)",
        [
          randomUUID(),
          systemId,
          method,
          saved.provider,
          JSON.stringify(saved),
          old.rows[0].cashout_id,
        ],
      );
      return old.rows[0];
    });
  }

  async function cardEligibility(systemId) {
    await ensureSchema();
    const { rows } = await query(
      "SELECT wallet_eligible_at,((wallet_eligible_at AT TIME ZONE 'UTC')+INTERVAL '20 years') AT TIME ZONE 'UTC' AS expires_at FROM beneficiaries WHERE system_id=$1",
      [systemId],
    );
    return rows[0] || {};
  }
  return {
    ensureSchema,
    paymentDestination,
    cardEligibility,
    saveLegacyDestination,
  };
}

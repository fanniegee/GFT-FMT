import { gptsProviders } from "./gpts-provider-registry.js";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  createVault,
  fail,
  digest,
  minor,
  integer,
  canonical,
  base32,
  checkTotp,
} from "./gpts-money-security.js";
import { countries, corridors } from "./gpts-payments.js";

export const permissions = [
  "operations:view",
  "verification:review",
  "compliance:manage",
  "payments:review",
  "finance:reconcile",
  "support:manage",
  "audit:view",
];
const id = z.string().uuid(),
  currency = z.enum(["USD", "ZWG", "ZAR", "BWP", "ZMW", "MZN"]);
const note = z.string().trim().min(8).max(2000);
const policyInput = z
  .object({
    approvalQuorum: z.number().int().min(1).max(5),
    verificationQuorum: z.number().int().min(1).max(5),
    verificationChecks: z
      .array(z.string().trim().min(3).max(100))
      .min(1)
      .max(20),
    routes: z
      .array(
        z
          .object({
            corridor: z.enum(corridors.map((r) => r.id)),
            sourceCurrency: currency,
            targetCurrency: currency,
            providerKey: z.string().regex(/^[a-z0-9-]{2,40}$/),
            maxTransferMinor: z.string(),
            maxRolling24hMinor: z.string(),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
const recipientInput = z
  .object({
    label: z.string().trim().min(2).max(80),
    country: z.enum(["ZW", "ZA", "BW", "ZM", "MZ"]),
    method: z.enum(["BANK", "MOBILE_WALLET"]),
    name: z.string().trim().min(2).max(120),
    account: z.string().trim().min(4).max(80),
    network: z.string().trim().min(2).max(80),
  })
  .strict();
const quoteTerms = z
  .object({
    providerQuoteId: z.string().min(1).max(160),
    sourceCurrency: currency,
    targetCurrency: currency,
    sendMinor: z.string(),
    feeMinor: z.string(),
    costMinor: z.string(),
    receiveMinor: z.string(),
    exchangeRate: z.string().regex(/^\d{1,16}(?:\.\d{1,18})?$/),
    expiresAt: z.string().datetime(),
    costSource: z.literal("FEE"),
  })
  .strict();
const eventInput = z
  .object({
    id: z.string().min(1).max(160),
    type: z.enum(["FUNDED", "SETTLED", "FAILED", "REFUNDED"]),
    transferId: id,
    reference: z.string().min(1).max(160),
    currency,
    amountMinor: z.string(),
    receiveMinor: z.string().optional(),
    receiveCurrency: currency.optional(),
    costMinor: z.string().optional(),
  })
  .strict();

export function createGptsPaymentEngine({
  query,
  withTransaction,
  ensureFoundation,
  vault = createVault(),
  adapters = gptsProviders(),
  now = Date.now,
  providerTimeoutMs = 30000,
}) {
  let ready;
  async function invoke(provider, method, ...args) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => provider[method](...args)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                fail(
                  503,
                  "Provider response is unconfirmed.",
                  "PROVIDER_TIMEOUT",
                ),
              ),
            providerTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } catch (cause) {
      if (cause.gpts) throw cause;
      throw fail(
        503,
        "The provider response is unconfirmed. Please retry later.",
        "PROVIDER_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async function ensure() {
    ready ??= (async () => {
      await ensureFoundation();
      const sql = await readFile(
        new URL("./gpts-control-schema.sql", import.meta.url),
        "utf8",
      );
      await withTransaction(async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('gpts-control-v1'))",
        );
        await client.query(sql);
        await client.query(
          "ALTER TABLE gpts_customers DROP CONSTRAINT IF EXISTS gpts_customers_financial_verification_check; ALTER TABLE gpts_customers ADD CONSTRAINT gpts_customers_financial_verification_check CHECK(financial_verification IN('NOT_STARTED','SUBMITTED','VERIFIED','CHANGES_REQUIRED'))",
        );
      });
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
    return ready;
  }
  const tx = async (callback) => {
    await ensure();
    return withTransaction(callback);
  };
  async function audit(client, actor, action, reference, details = {}, reason) {
    await client.query(
      "INSERT INTO gpts_ops_events(event_id,actor_type,actor_id,action,reference,details,note_enc) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
      [
        randomUUID(),
        actor.type,
        actor.id,
        action,
        String(reference),
        JSON.stringify(details),
        reason ? vault.seal(reason, "audit:" + reference) : null,
      ],
    );
  }
  async function policy(client = { query }) {
    const { rows } = await client.query(
      "SELECT version,settings FROM gpts_ops_policy WHERE singleton=TRUE",
    );
    return rows[0] || null;
  }
  async function authorise(actor, permission) {
    await ensure();
    if (actor.type !== "STAFF")
      throw fail(403, "Payments staff access is required.");
    if (actor.founder) return;
    const { rows } = await query(
      "SELECT permissions FROM gpts_ops_grants WHERE admin_id=$1",
      [actor.id],
    );
    if (!rows[0]?.permissions.includes(permission))
      throw fail(403, "This payments permission has not been assigned.");
  }
  function adapter(key) {
    const selected = adapters.get(key);
    if (
      !selected ||
      selected.idempotent !== true ||
      typeof selected.verifyEvent !== "function"
    )
      throw fail(
        503,
        "This payment channel is not connected.",
        "CHANNEL_UNAVAILABLE",
      );
    return selected;
  }
  async function eligible(client, customerId) {
    const { rows } = await client.query(
      "SELECT customer_id,email,financial_verification FROM gpts_customers WHERE customer_id=$1",
      [customerId],
    );
    if (!rows[0] || rows[0].financial_verification !== "VERIFIED")
      throw fail(
        409,
        "Complete financial identity verification before requesting a transfer quote.",
      );
    const holds = await client.query(
      "SELECT frozen FROM gpts_customer_holds WHERE customer_id=$1",
      [customerId],
    );
    if (holds.rows[0]?.frozen)
      throw fail(423, "This payments account is restricted pending review.");
    return rows[0];
  }
  async function stepup(actor, token) {
    await ensure();
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw fail(
        403,
        "Confirm a fresh authenticator code before this action.",
        "STEP_UP_REQUIRED",
      );
    const { rows } = await query(
      "SELECT token_hash FROM gpts_stepup WHERE token_hash=$1 AND owner_type=$2 AND owner_id=$3 AND session_hash=$4 AND expires_at>NOW()",
      [digest(token), actor.type, actor.id, actor.session],
    );
    if (!rows.length)
      throw fail(
        403,
        "Your security confirmation has expired. Confirm a new code.",
        "STEP_UP_REQUIRED",
      );
  }
  async function issueStepup(client, actor) {
    const token = randomBytes(32).toString("hex");
    await client.query(
      "INSERT INTO gpts_stepup(token_hash,owner_type,owner_id,session_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')",
      [digest(token), actor.type, actor.id, actor.session],
    );
    return token;
  }
  async function securityStatus(actor) {
    await ensure();
    const grants =
      actor.type === "STAFF" && !actor.founder
        ? (
            await query(
              "SELECT permissions FROM gpts_ops_grants WHERE admin_id=$1",
              [actor.id],
            )
          ).rows[0]?.permissions || []
        : [];
    const { rows } = await query(
      "SELECT enabled,locked_until FROM gpts_mfa WHERE owner_type=$1 AND owner_id=$2",
      [actor.type, actor.id],
    );
    return {
      encryptedStorage: vault.configured(),
      mfaEnabled: Boolean(rows[0]?.enabled),
      lockedUntil: rows[0]?.locked_until || null,
      authorityContext: digest(
        canonical({
          type: actor.type,
          id: actor.id,
          session: actor.session,
          founder: Boolean(actor.founder),
          permissions: [...grants].sort(),
        }),
      ),
    };
  }
  async function startMfa(actor) {
    return tx(async (client) => {
      const current = await client.query(
        "SELECT enabled FROM gpts_mfa WHERE owner_type=$1 AND owner_id=$2 FOR UPDATE",
        [actor.type, actor.id],
      );
      if (current.rows[0]?.enabled)
        throw fail(409, "An authenticator is already enabled.");
      const secret = base32(randomBytes(20));
      await client.query(
        "INSERT INTO gpts_mfa(owner_type,owner_id,secret_enc,setup_expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes') ON CONFLICT(owner_type,owner_id) DO UPDATE SET secret_enc=EXCLUDED.secret_enc,setup_expires_at=EXCLUDED.setup_expires_at",
        [
          actor.type,
          actor.id,
          vault.seal(secret, `mfa:${actor.type}:${actor.id}`),
        ],
      );
      await audit(client, actor, "MFA_SETUP_STARTED", actor.id);
      return {
        secret,
        uri: `otpauth://totp/GPTS:${encodeURIComponent(actor.email)}?secret=${secret}&issuer=GPTS&digits=6&period=30`,
      };
    });
  }
  async function confirmMfa(actor, code, { enrol = false } = {}) {
    const result = await tx(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM gpts_mfa WHERE owner_type=$1 AND owner_id=$2 FOR UPDATE",
        [actor.type, actor.id],
      );
      const row = rows[0];
      if (
        !row ||
        (!row.enabled && !enrol) ||
        (!row.enabled && new Date(row.setup_expires_at).getTime() <= now())
      )
        throw fail(409, "Start authenticator setup again.");
      if (row.locked_until && new Date(row.locked_until).getTime() > now())
        throw fail(
          429,
          "Security confirmation is temporarily locked. Try again in 15 minutes.",
        );
      const counter = checkTotp(
        vault.open(row.secret_enc, `mfa:${actor.type}:${actor.id}`),
        code,
        row.last_counter,
        now(),
      );
      let recovery = false;
      const hashes = row.recovery_hashes || [];
      if (row.enabled && /^[a-f0-9]{24}$/.test(code || "")) {
        const index = hashes.indexOf(digest(code));
        if (index >= 0) {
          hashes.splice(index, 1);
          recovery = true;
        }
      }
      if (counter === null && !recovery) {
        await client.query(
          "UPDATE gpts_mfa SET failures=failures+1,locked_until=CASE WHEN failures+1>=5 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END WHERE owner_type=$1 AND owner_id=$2",
          [actor.type, actor.id],
        );
        await audit(client, actor, "MFA_FAILED", actor.id);
        return { failed: true };
      }
      let recoveryCodes;
      const enabling = !row.enabled;
      if (enabling)
        recoveryCodes = Array.from({ length: 10 }, () =>
          randomBytes(12).toString("hex"),
        );
      await client.query(
        "UPDATE gpts_mfa SET enabled=TRUE,last_counter=$3,recovery_hashes=$4::jsonb,failures=0,locked_until=NULL WHERE owner_type=$1 AND owner_id=$2",
        [
          actor.type,
          actor.id,
          counter === null ? row.last_counter : counter,
          JSON.stringify(enabling ? recoveryCodes.map(digest) : hashes),
        ],
      );
      await audit(
        client,
        actor,
        enabling
          ? "MFA_ENABLED"
          : recovery
            ? "RECOVERY_CODE_USED"
            : "STEP_UP_CONFIRMED",
        actor.id,
      );
      return {
        token: await issueStepup(client, actor),
        expiresIn: 300,
        ...(recoveryCodes ? { recoveryCodes } : {}),
      };
    });
    if (result.failed)
      throw fail(400, "Invalid or already-used authenticator code.");
    return result;
  }
  async function savePolicy(actor, input) {
    if (!actor.founder) throw fail(403, "Founder access is required.");
    const data = policyInput.parse(input);
    if (
      new Set(data.verificationChecks).size !== data.verificationChecks.length
    )
      throw fail(400, "Verification checks must be distinct.");
    const seen = new Set();
    for (const route of data.routes) {
      integer(route.maxTransferMinor);
      integer(route.maxRolling24hMinor);
      if (BigInt(route.maxTransferMinor) > BigInt(route.maxRolling24hMinor))
        throw fail(
          400,
          "The rolling limit cannot be lower than the single-transfer limit.",
        );
      const c = corridors.find((c) => c.id === route.corridor);
      if (
        !countries[c.origin].currencies.includes(route.sourceCurrency) ||
        !countries[c.destination].currencies.includes(route.targetCurrency)
      )
        throw fail(400, "The route currencies do not match its countries.");
      const key = route.corridor + route.sourceCurrency + route.targetCurrency;
      if (seen.has(key)) throw fail(400, "Duplicate route configuration.");
      seen.add(key);
      if (route.enabled) adapter(route.providerKey);
    }
    return tx(async (client) => {
      const { rows } = await client.query(
        "INSERT INTO gpts_ops_policy(singleton,settings,updated_by) VALUES(TRUE,$1::jsonb,$2) ON CONFLICT(singleton) DO UPDATE SET version=gpts_ops_policy.version+1,settings=EXCLUDED.settings,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING version,settings",
        [JSON.stringify(data), actor.id],
      );
      await client.query(
        "INSERT INTO gpts_policy_versions(version,settings,updated_by) VALUES($1,$2::jsonb,$3)",
        [rows[0].version, JSON.stringify(data), actor.id],
      );
      await audit(client, actor, "POLICY_SAVED", String(rows[0].version), {
        settingsHash: digest(canonical(data)),
      });
      return rows[0];
    });
  }
  async function grant(actor, adminId, list) {
    if (!actor.founder) throw fail(403, "Founder access is required.");
    const parsed = z
      .array(z.enum(permissions))
      .max(permissions.length)
      .parse(list);
    if (parsed.length && !parsed.includes("operations:view"))
      parsed.push("operations:view");
    return tx(async (client) => {
      await client.query(
        "INSERT INTO gpts_ops_grants(admin_id,permissions,granted_by) VALUES($1,$2::jsonb,$3) ON CONFLICT(admin_id) DO UPDATE SET permissions=EXCLUDED.permissions,granted_by=EXCLUDED.granted_by,updated_at=NOW()",
        [adminId, JSON.stringify([...new Set(parsed)]), actor.id],
      );
      await audit(client, actor, "PERMISSIONS_CHANGED", adminId, {
        permissions: parsed,
      });
    });
  }
  async function linkStaffCustomer(actor, adminId, customerId, linked) {
    if (!actor.founder) throw fail(403, "Founder access is required.");
    id.parse(customerId);
    z.boolean().parse(linked);
    return tx(async (client) => {
      if (linked)
        await client.query(
          "INSERT INTO gpts_staff_customer_links(admin_id,customer_id,linked_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [adminId, customerId, actor.id],
        );
      else
        await client.query(
          "DELETE FROM gpts_staff_customer_links WHERE admin_id=$1 AND customer_id=$2",
          [adminId, customerId],
        );
      await audit(
        client,
        actor,
        linked ? "STAFF_CUSTOMER_LINKED" : "STAFF_CUSTOMER_UNLINKED",
        adminId,
        { customerId },
      );
    });
  }
  async function addRecipient(actor, input, replaces) {
    const data = recipientInput.parse(input),
      recipientId = randomUUID();
    return tx(async (client) => {
      if (replaces) {
        const old = await client.query(
          "SELECT recipient_id FROM gpts_recipients WHERE recipient_id=$1 AND customer_id=$2 AND archived_at IS NULL FOR UPDATE",
          [id.parse(replaces), actor.id],
        );
        if (!old.rows.length) throw fail(404, "Recipient not found.");
        await client.query(
          "UPDATE gpts_recipients SET archived_at=NOW() WHERE recipient_id=$1",
          [replaces],
        );
      }
      await client.query(
        "INSERT INTO gpts_recipients(recipient_id,customer_id,replaces_id,label,country,method,details_enc,fingerprint,last_four) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          recipientId,
          actor.id,
          replaces || null,
          data.label,
          data.country,
          data.method,
          vault.seal(data, "recipient:" + recipientId),
          vault.fingerprint(data),
          data.account.slice(-4),
        ],
      );
      await audit(
        client,
        actor,
        replaces ? "RECIPIENT_REPLACED" : "RECIPIENT_ADDED",
        recipientId,
        { replaces: replaces || null },
      );
      return recipientId;
    });
  }
  async function archiveRecipient(actor, recipientId) {
    return tx(async (client) => {
      const result = await client.query(
        "UPDATE gpts_recipients SET archived_at=COALESCE(archived_at,NOW()) WHERE recipient_id=$1 AND customer_id=$2 RETURNING recipient_id",
        [id.parse(recipientId), actor.id],
      );
      if (!result.rows.length) throw fail(404, "Recipient not found.");
      await audit(client, actor, "RECIPIENT_ARCHIVED", recipientId);
    });
  }
  async function verification(actor, input, existingCase) {
    const data = z
      .object({
        legalName: z.string().trim().min(2).max(120),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        identityType: z.enum(["NATIONAL_ID", "PASSPORT"]),
        identityNumber: z.string().trim().min(3).max(80),
        address: z.string().trim().min(8).max(500),
      })
      .strict()
      .parse(input);
    if (
      !Number.isFinite(Date.parse(data.dateOfBirth)) ||
      new Date(data.dateOfBirth).toISOString().slice(0, 10) !==
        data.dateOfBirth ||
      data.dateOfBirth >= new Date(now()).toISOString().slice(0, 10)
    )
      throw fail(400, "Enter a valid date of birth.");
    return tx(async (client) => {
      const caseId = existingCase ? id.parse(existingCase) : randomUUID();
      if (existingCase) {
        const draft = (
          await client.query(
            "SELECT status FROM gpts_verifications WHERE case_id=$1 AND customer_id=$2 FOR UPDATE",
            [caseId, actor.id],
          )
        ).rows[0];
        if (draft?.status !== "DRAFT")
          throw fail(409, "Only your draft identity details can be edited.");
        await client.query(
          "UPDATE gpts_verifications SET identity_enc=$2 WHERE case_id=$1",
          [caseId, vault.seal(data, "identity:" + caseId)],
        );
        await audit(client, actor, "VERIFICATION_DRAFT_UPDATED", caseId);
        return caseId;
      }
      await client.query(
        "INSERT INTO gpts_verifications(case_id,customer_id,identity_enc,status) VALUES($1,$2,$3,'DRAFT')",
        [caseId, actor.id, vault.seal(data, "identity:" + caseId)],
      );
      await audit(client, actor, "VERIFICATION_STARTED", caseId);
      return caseId;
    });
  }
  async function uploadIdentity(actor, caseId, kind, bytes) {
    id.parse(caseId);
    z.enum(["IDENTITY_FRONT", "IDENTITY_BACK", "ADDRESS"]).parse(kind);
    if (!Buffer.isBuffer(bytes) || bytes.length > 5 * 1024 * 1024)
      throw fail(400, "Use an image under 5 MB.");
    const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from("89504e470d0a1a0a", "hex")),
      jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!png && !jpeg)
      throw fail(400, "Use a valid JPEG or PNG document image.");
    const { default: sharp } = await import("sharp");
    let clean;
    try {
      const image = sharp(bytes, {
          limitInputPixels: 16000000,
          animated: false,
        }),
        metadata = await image.metadata();
      if (!["jpeg", "png"].includes(metadata.format)) throw Error();
      clean = await image
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#fff" })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch {
      throw fail(400, "Use a valid JPEG or PNG document image.");
    }
    return tx(async (client) => {
      const { rows } = await client.query(
        "SELECT status FROM gpts_verifications WHERE case_id=$1 AND customer_id=$2 FOR UPDATE",
        [caseId, actor.id],
      );
      if (rows[0]?.status !== "DRAFT")
        throw fail(409, "Images can be added only to your draft verification.");
      const imageId = randomUUID();
      await client.query(
        "INSERT INTO gpts_identity_images(image_id,case_id,kind,image_enc,digest) VALUES($1,$2,$3,$4,$5) ON CONFLICT(case_id,kind) DO UPDATE SET image_id=EXCLUDED.image_id,image_enc=EXCLUDED.image_enc,digest=EXCLUDED.digest,created_at=NOW()",
        [
          imageId,
          caseId,
          kind,
          vault.seal(clean, "image:" + imageId),
          digest(clean),
        ],
      );
      await audit(client, actor, "VERIFICATION_IMAGE_ADDED", caseId, {
        kind,
        imageId,
        digest: digest(clean),
      });
      return imageId;
    });
  }
  async function submitVerification(actor, caseId) {
    return tx(async (client) => {
      const configured = await policy(client);
      if (!configured)
        throw fail(409, "Verification requirements must be configured first.");
      const { rows } = await client.query(
        "SELECT status FROM gpts_verifications WHERE case_id=$1 AND customer_id=$2 FOR UPDATE",
        [id.parse(caseId), actor.id],
      );
      if (rows[0]?.status !== "DRAFT")
        throw fail(409, "This verification is not a draft.");
      const images = await client.query(
        "SELECT image_id FROM gpts_identity_images WHERE case_id=$1",
        [caseId],
      );
      if (!images.rows.length)
        throw fail(
          400,
          "Attach your identity-document image before submitting.",
        );
      await client.query(
        "UPDATE gpts_verifications SET status='SUBMITTED',policy_version=$2,submitted_at=NOW() WHERE case_id=$1",
        [caseId, configured.version],
      );
      await client.query(
        "UPDATE gpts_customers SET financial_verification='SUBMITTED' WHERE customer_id=$1",
        [actor.id],
      );
      await audit(client, actor, "VERIFICATION_SUBMITTED", caseId);
    });
  }
  async function reviewVerification(actor, caseId, input) {
    const data = z
      .object({
        decision: z.enum(["APPROVE", "CHANGES_REQUIRED"]),
        checks: z.array(z.string()).max(20),
        reason: note,
        customerMessage: z.string().trim().max(1000).default(""),
      })
      .strict()
      .parse(input);
    if (data.decision === "CHANGES_REQUIRED" && data.customerMessage.length < 8)
      throw fail(400, "Explain the required changes to the customer.");
    return tx(async (client) => {
      const { rows } = await client.query(
        "SELECT v.*,c.email FROM gpts_verifications v JOIN gpts_customers c USING(customer_id) WHERE v.case_id=$1 FOR UPDATE OF v",
        [id.parse(caseId)],
      );
      const record = rows[0],
        configured = await policy(client);
      if (!record || record.status !== "SUBMITTED")
        throw fail(409, "This verification is not awaiting review.");
      if (
        actor.email.toLowerCase() === record.email.toLowerCase() ||
        (
          await client.query(
            "SELECT admin_id FROM gpts_staff_customer_links WHERE admin_id=$1 AND customer_id=$2",
            [actor.id, record.customer_id],
          )
        ).rows.length
      )
        throw fail(403, "You cannot review your own financial verification.");
      if (
        data.decision === "APPROVE" &&
        (!configured || configured.version !== record.policy_version)
      )
        throw fail(
          409,
          "Requirements changed. Request a new customer submission.",
        );
      if (
        data.decision === "APPROVE" &&
        (new Set(data.checks).size !==
          configured.settings.verificationChecks.length ||
          !configured.settings.verificationChecks.every((check) =>
            data.checks.includes(check),
          ))
      )
        throw fail(400, "Complete every configured verification check.");
      await client.query(
        "INSERT INTO gpts_verification_reviews(review_id,case_id,admin_id,decision,checks,note_enc,customer_message_enc) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)",
        [
          randomUUID(),
          caseId,
          actor.id,
          data.decision,
          JSON.stringify(data.checks),
          vault.seal(data.reason, "verification-review:" + caseId),
          data.customerMessage
            ? vault.seal(data.customerMessage, "verification-message:" + caseId)
            : null,
        ],
      );
      let status = "SUBMITTED";
      if (data.decision === "CHANGES_REQUIRED") status = "CHANGES_REQUIRED";
      else {
        const votes = await client.query(
          "SELECT COUNT(*)::int AS count FROM gpts_verification_reviews WHERE case_id=$1 AND decision='APPROVE'",
          [caseId],
        );
        if (votes.rows[0].count >= configured.settings.verificationQuorum)
          status = "VERIFIED";
      }
      await client.query(
        "UPDATE gpts_verifications SET status=$2 WHERE case_id=$1",
        [caseId, status],
      );
      await client.query(
        "UPDATE gpts_customers SET financial_verification=$2 WHERE customer_id=$1",
        [record.customer_id, status],
      );
      await audit(client, actor, "VERIFICATION_REVIEWED", caseId, {
        status,
        decision: data.decision,
      });
      return status;
    });
  }
  async function freeze(actor, customerId, frozen, reason) {
    note.parse(reason);
    z.boolean().parse(frozen);
    return tx(async (client) => {
      await client.query(
        "INSERT INTO gpts_customer_holds(customer_id,frozen,note_enc,changed_by) VALUES($1,$2,$3,$4) ON CONFLICT(customer_id) DO UPDATE SET frozen=EXCLUDED.frozen,note_enc=EXCLUDED.note_enc,changed_by=EXCLUDED.changed_by,updated_at=NOW()",
        [
          id.parse(customerId),
          frozen,
          vault.seal(reason, "hold:" + customerId),
          actor.id,
        ],
      );
      await audit(
        client,
        actor,
        frozen ? "CUSTOMER_FROZEN" : "CUSTOMER_UNFROZEN",
        customerId,
        {},
        reason,
      );
    });
  }
  async function requestQuote(
    actor,
    { instructionId, recipientId, targetCurrency },
  ) {
    currency.parse(targetCurrency);
    await ensure();
    await eligible({ query }, actor.id);
    const configured = await policy();
    if (!configured)
      throw fail(409, "Payment operating rules must be configured first.");
    const instruction = (
      await query(
        "SELECT * FROM gpts_payment_instructions WHERE instruction_id=$1 AND customer_id=$2",
        [id.parse(instructionId), actor.id],
      )
    ).rows[0];
    const recipient = (
      await query(
        "SELECT * FROM gpts_recipients WHERE recipient_id=$1 AND customer_id=$2 AND archived_at IS NULL",
        [id.parse(recipientId), actor.id],
      )
    ).rows[0];
    if (!instruction || instruction.status !== "AWAITING_CHANNEL" || !recipient)
      throw fail(404, "An active instruction and recipient are required.");
    if (
      recipient.country !== instruction.corridor_id.split("-")[1] ||
      recipient.method !== instruction.payout_method
    )
      throw fail(
        400,
        "Recipient country and receiving method must match the instruction.",
      );
    const route = configured.settings.routes.find(
      (route) =>
        route.enabled &&
        route.corridor === instruction.corridor_id &&
        route.sourceCurrency === instruction.currency.trim() &&
        route.targetCurrency === targetCurrency,
    );
    if (!route) throw fail(409, "This route has no enabled operating policy.");
    const provider = adapter(route.providerKey);
    const recipientDetails = vault.open(
      recipient.details_enc,
      "recipient:" + recipient.recipient_id,
    );
    const identity = (
      await query(
        "SELECT case_id,identity_enc FROM gpts_verifications WHERE customer_id=$1 AND status='VERIFIED' ORDER BY created_at DESC LIMIT 1",
        [actor.id],
      )
    ).rows[0];
    if (!identity)
      throw fail(409, "A completed identity-review record is required.");
    const screened = await invoke(provider, "screen", {
      customerId: actor.id,
      identity: vault.open(
        identity.identity_enc,
        "identity:" + identity.case_id,
      ),
      recipient: recipientDetails,
    });
    if (
      screened.status !== "CLEAR" ||
      !Number.isFinite(Date.parse(screened.expiresAt)) ||
      Date.parse(screened.expiresAt) <= now()
    ) {
      await tx((client) =>
        audit(client, actor, "SCREENING_REVIEW_REQUIRED", instructionId, {
          provider: route.providerKey,
        }),
      );
      throw fail(409, "This transfer requires compliance review.");
    }
    const returned = quoteTerms.parse(
      await invoke(provider, "quote", {
        instructionId,
        recipient: recipientDetails,
        sendMinor: String(minor(String(instruction.amount))),
        sourceCurrency: route.sourceCurrency,
        targetCurrency: route.targetCurrency,
      }),
    );
    const send = integer(returned.sendMinor),
      fee = integer(returned.feeMinor, { zero: true }),
      cost = integer(returned.costMinor, { zero: true });
    integer(returned.receiveMinor);
    if (
      returned.sourceCurrency !== route.sourceCurrency ||
      returned.targetCurrency !== route.targetCurrency ||
      send !== minor(String(instruction.amount)) ||
      Number(returned.exchangeRate) <= 0 ||
      Date.parse(returned.expiresAt) <= now() ||
      cost > fee
    )
      throw fail(
        409,
        "The provider quote does not match the supported funding and fee arrangement.",
      );
    const terms = {
      ...returned,
      sendMinor: String(send),
      feeMinor: String(fee),
      costMinor: String(cost),
      receiveMinor: String(integer(returned.receiveMinor)),
      totalMinor: String(send + fee),
      corridor: route.corridor,
      screeningExpiresAt: screened.expiresAt,
    };
    if (send + fee > BigInt(route.maxTransferMinor))
      throw fail(409, "This quote exceeds the configured transfer limit.");
    const quoteId = randomUUID(),
      termsHash = digest(canonical(terms));
    await tx(async (client) => {
      await client.query(
        "INSERT INTO gpts_quotes(quote_id,customer_id,instruction_id,recipient_id,provider_key,provider_quote_id,policy_version,terms,terms_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)",
        [
          quoteId,
          actor.id,
          instructionId,
          recipientId,
          route.providerKey,
          returned.providerQuoteId,
          configured.version,
          JSON.stringify(terms),
          termsHash,
          returned.expiresAt,
        ],
      );
      await audit(client, actor, "QUOTE_RECORDED", quoteId);
    });
    return { quoteId, terms, termsHash };
  }
  async function acceptQuote(actor, input) {
    const data = z
      .object({
        quoteId: id,
        requestId: id,
        termsHash: z.string().regex(/^[a-f0-9]{64}$/),
        accept: z.literal(true),
      })
      .strict()
      .parse(input);
    return tx(async (client) => {
      await client.query(
        "SELECT customer_id FROM gpts_customers WHERE customer_id=$1 FOR UPDATE",
        [actor.id],
      );
      const repeated = await client.query(
        "SELECT * FROM gpts_payment_transfers WHERE customer_id=$1 AND client_request_id=$2",
        [actor.id, data.requestId],
      );
      if (repeated.rows[0]) {
        if (
          repeated.rows[0].quote_id !== data.quoteId ||
          repeated.rows[0].terms_hash !== data.termsHash
        )
          throw fail(
            409,
            "Request reference already used for different transfer terms.",
          );
        return repeated.rows[0];
      }
      await eligible(client, actor.id);
      const quote = (
          await client.query(
            "SELECT * FROM gpts_quotes WHERE quote_id=$1 AND customer_id=$2 FOR UPDATE",
            [data.quoteId, actor.id],
          )
        ).rows[0],
        configured = await policy(client);
      if (
        !quote ||
        quote.terms_hash !== data.termsHash ||
        new Date(quote.expires_at).getTime() <= now() ||
        Date.parse(quote.terms.screeningExpiresAt) <= now() ||
        !configured ||
        configured.version !== quote.policy_version
      )
        throw fail(409, "Obtain and accept a fresh provider quote.");
      const recipient = (
        await client.query(
          "SELECT archived_at FROM gpts_recipients WHERE recipient_id=$1",
          [quote.recipient_id],
        )
      ).rows[0];
      if (!recipient || recipient.archived_at)
        throw fail(409, "Recipient details changed. Obtain a fresh quote.");
      const route = configured.settings.routes.find(
        (route) =>
          route.enabled &&
          route.corridor === quote.terms.corridor &&
          route.sourceCurrency === quote.terms.sourceCurrency &&
          route.providerKey === quote.provider_key,
      );
      if (!route) throw fail(409, "This payment route is unavailable.");
      const previous = await client.query(
        "SELECT COALESCE(SUM((terms->>'totalMinor')::numeric),0)::text AS amount FROM gpts_payment_transfers WHERE customer_id=$1 AND terms->>'sourceCurrency'=$2 AND status<>'CANCELLED' AND created_at>NOW()-INTERVAL '24 hours'",
        [actor.id, quote.terms.sourceCurrency],
      );
      if (
        BigInt(previous.rows[0].amount) + BigInt(quote.terms.totalMinor) >
        BigInt(route.maxRolling24hMinor)
      )
        throw fail(
          409,
          "This transfer exceeds the configured rolling 24-hour limit.",
        );
      const transferId = randomUUID();
      const { rows } = await client.query(
        "INSERT INTO gpts_payment_transfers(transfer_id,customer_id,client_request_id,quote_id,recipient_id,provider_key,terms,terms_hash,policy,instruction_id,status) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,'AWAITING_FUNDS') RETURNING *",
        [
          transferId,
          actor.id,
          data.requestId,
          data.quoteId,
          quote.recipient_id,
          quote.provider_key,
          JSON.stringify(quote.terms),
          quote.terms_hash,
          JSON.stringify(configured.settings),
          quote.instruction_id,
        ],
      );
      await client.query(
        "INSERT INTO gpts_payment_jobs(job_id,transfer_id,operation) VALUES($1,$2,'FUNDING')",
        [randomUUID(), transferId],
      );
      await audit(client, actor, "QUOTE_ACCEPTED", transferId, {
        quoteId: data.quoteId,
      });
      return rows[0];
    });
  }
  async function postJournal(client, transfer, eventKey, kind, lines) {
    const normalized = lines
      .filter((line) => BigInt(line.amount) !== 0n)
      .map((line) => ({ ...line, amount: String(line.amount) }))
      .sort((a, b) => a.account.localeCompare(b.account));
    if (
      normalized.length < 2 ||
      normalized.reduce((sum, line) => sum + BigInt(line.amount), 0n) !== 0n
    )
      throw fail(
        500,
        "The accounting journal does not balance.",
        "UNBALANCED_JOURNAL",
      );
    const hash = digest(canonical(normalized));
    const existing = await client.query(
      "SELECT payload_hash FROM gpts_money_journals WHERE event_key=$1",
      [eventKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].payload_hash !== hash)
        throw fail(409, "Accounting reference reused with different amounts.");
      return;
    }
    const journalId = randomUUID(),
      currency = transfer.terms.sourceCurrency;
    await client.query(
      "INSERT INTO gpts_money_journals(journal_id,event_key,payload_hash,transfer_id,kind) VALUES($1,$2,$3,$4,$5)",
      [journalId, eventKey, hash, transfer.transfer_id, kind],
    );
    for (const line of normalized) {
      await client.query(
        "INSERT INTO gpts_money_accounts(account_id,customer_id,transfer_id,currency,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id) DO NOTHING",
        [
          line.account,
          transfer.customer_id,
          transfer.transfer_id,
          currency,
          line.kind,
        ],
      );
      await client.query(
        "INSERT INTO gpts_money_lines(journal_id,account_id,currency,signed_minor) VALUES($1,$2,$3,$4)",
        [journalId, line.account, currency, line.amount],
      );
    }
  }
  const account = (transfer, name, amount, kind) => ({
    account: `${name}:${transfer.transfer_id}`,
    amount: String(amount),
    kind,
  });
  async function ingest(providerKey, raw, headers) {
    await ensure();
    const provider = adapter(providerKey);
    const verified = await invoke(provider, "verifyEvent", raw, headers);
    if (!verified) throw fail(401, "Provider signature verification failed.");
    return recordProviderEvent(providerKey, eventInput.parse(verified), raw);
  }
  async function recordProviderEvent(providerKey, data, raw) {
    integer(data.amountMinor, { zero: data.type === "FAILED" });
    const hash = digest(raw);
    await tx(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [providerKey, data.id],
      );
      const { rows } = await client.query(
        "SELECT body_hash,payload_enc FROM gpts_provider_events WHERE provider_key=$1 AND event_id=$2 FOR UPDATE",
        [providerKey, data.id],
      );
      if (rows[0]) {
        if (
          rows[0].body_hash !== hash &&
          canonical(
            vault.open(
              rows[0].payload_enc,
              `provider:${providerKey}:${data.id}`,
            ),
          ) !== canonical(data)
        )
          throw fail(409, "Provider event reference has conflicting contents.");
        return;
      }
      await client.query(
        "INSERT INTO gpts_provider_events(provider_key,event_id,body_hash,payload_enc,transfer_id,reference,event_type) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          providerKey,
          data.id,
          hash,
          vault.seal(data, `provider:${providerKey}:${data.id}`),
          data.transferId,
          data.reference,
          data.type,
        ],
      );
    });
    await applyEvent(providerKey, data.id);
    return data.id;
  }
  async function applyEvent(providerKey, eventId) {
    try {
      return await tx(async (client) => {
        const inbox = (
          await client.query(
            "SELECT * FROM gpts_provider_events WHERE provider_key=$1 AND event_id=$2 FOR UPDATE",
            [providerKey, eventId],
          )
        ).rows[0];
        if (!inbox) throw fail(404, "Provider event not found.");
        if (inbox.status === "APPLIED") return;
        const data = vault.open(
            inbox.payload_enc,
            `provider:${providerKey}:${eventId}`,
          ),
          transfer = (
            await client.query(
              "SELECT * FROM gpts_payment_transfers WHERE transfer_id=$1 FOR UPDATE",
              [data.transferId],
            )
          ).rows[0];
        if (
          !transfer ||
          transfer.provider_key !== providerKey ||
          transfer.terms.sourceCurrency !== data.currency
        )
          throw fail(
            409,
            "Provider event does not match its transfer.",
            "EVENT_MISMATCH",
          );
        const amount = BigInt(data.amountMinor),
          key = providerKey + ":" + data.reference + ":" + data.type,
          actor = { type: "PROVIDER", id: providerKey };
        const prior = await client.query(
          "SELECT event_id,payload_enc FROM gpts_provider_events WHERE provider_key=$1 AND event_id<>$2 AND reference=$3 AND event_type=$4 AND status='APPLIED' LIMIT 1",
          [providerKey, eventId, data.reference, data.type],
        );
        if (prior.rows[0]) {
          const previous = vault.open(
              prior.rows[0].payload_enc,
              `provider:${providerKey}:${prior.rows[0].event_id}`,
            ),
            withoutId = ({ id, ...rest }) => rest;
          if (canonical(withoutId(previous)) !== canonical(withoutId(data)))
            throw fail(
              409,
              "A provider reference has conflicting facts.",
              "REFERENCE_ALREADY_POSTED",
            );
          await client.query(
            "UPDATE gpts_provider_events SET status='APPLIED',applied_at=NOW(),error_code=NULL WHERE provider_key=$1 AND event_id=$2",
            [providerKey, eventId],
          );
          return;
        }
        if (data.type === "FUNDED") {
          await postJournal(client, transfer, key, "FUNDING", [
            account(transfer, "CASH", amount, "ASSET"),
            account(transfer, "AVAILABLE", -amount, "LIABILITY"),
          ]);
          const funded = BigInt(transfer.funded_minor) + amount;
          let state = transfer.status,
            held = BigInt(transfer.held_minor),
            hold = transfer.hold_reason;
          if (
            state === "AWAITING_FUNDS" &&
            funded === BigInt(transfer.terms.totalMinor) &&
            Date.parse(transfer.terms.expiresAt) > now()
          ) {
            await postJournal(client, transfer, key + ":reserve", "RESERVE", [
              account(transfer, "AVAILABLE", funded, "LIABILITY"),
              account(transfer, "RESERVED", -funded, "LIABILITY"),
            ]);
            held = funded;
            state = "PENDING_APPROVAL";
          } else if (
            state !== "AWAITING_FUNDS" ||
            funded > BigInt(transfer.terms.totalMinor) ||
            Date.parse(transfer.terms.expiresAt) <= now()
          ) {
            state = "REVIEW_REQUIRED";
            hold = "FUNDING_REQUIRES_REVIEW";
          }
          await client.query(
            "UPDATE gpts_payment_transfers SET funded_minor=$2,held_minor=$3,status=$4,hold_reason=$5,updated_at=NOW() WHERE transfer_id=$1",
            [transfer.transfer_id, String(funded), String(held), state, hold],
          );
        } else if (data.type === "SETTLED") {
          if (
            transfer.status !== "PROCESSING" ||
            amount !== BigInt(transfer.terms.sendMinor) ||
            data.receiveCurrency !== transfer.terms.targetCurrency ||
            data.receiveMinor !== transfer.terms.receiveMinor ||
            data.costMinor !== transfer.terms.costMinor
          )
            throw fail(
              409,
              "Settlement requires reconciliation against the accepted quote.",
              "SETTLEMENT_MISMATCH",
            );
          const total = BigInt(transfer.terms.totalMinor),
            fee = BigInt(transfer.terms.feeMinor),
            cost = BigInt(data.costMinor);
          await postJournal(client, transfer, key, "SETTLEMENT", [
            account(transfer, "RESERVED", total, "LIABILITY"),
            account(transfer, "CASH", -(amount + cost), "ASSET"),
            account(transfer, "FEE_REVENUE", -fee, "INCOME"),
            account(transfer, "PROVIDER_COST", cost, "EXPENSE"),
          ]);
          await client.query(
            "UPDATE gpts_payment_transfers SET status='SETTLED',held_minor=0,provider_reference=$2,settled_at=NOW(),updated_at=NOW() WHERE transfer_id=$1",
            [transfer.transfer_id, data.reference],
          );
          const summary = {
            transferId: transfer.transfer_id,
            reference: data.reference,
            sourceCurrency: data.currency,
            sendMinor: transfer.terms.sendMinor,
            feeMinor: transfer.terms.feeMinor,
            receiveCurrency: data.receiveCurrency,
            receiveMinor: data.receiveMinor,
            exchangeRate: transfer.terms.exchangeRate,
            settledAt: new Date(now()).toISOString(),
          };
          await client.query(
            "INSERT INTO gpts_payment_receipts(receipt_id,transfer_id,summary,digest) VALUES($1,$2,$3::jsonb,$4)",
            [
              randomUUID(),
              transfer.transfer_id,
              JSON.stringify(summary),
              digest(canonical(summary)),
            ],
          );
        } else if (data.type === "FAILED") {
          if (transfer.status !== "PROCESSING" || amount !== 0n)
            throw fail(
              409,
              "Failure confirmation does not match a processing transfer.",
            );
          await client.query(
            "UPDATE gpts_payment_transfers SET status='FAILED',hold_reason='PROVIDER_CONFIRMED_FAILURE',updated_at=NOW() WHERE transfer_id=$1",
            [transfer.transfer_id],
          );
        } else {
          if (transfer.status !== "REFUNDING")
            throw fail(
              409,
              "Refund confirmation requires a refund in progress.",
            );
          const remaining =
            BigInt(transfer.funded_minor) - BigInt(transfer.refunded_minor);
          if (amount > remaining)
            throw fail(409, "Refund exceeds the recorded customer funds.");
          const held = BigInt(transfer.held_minor),
            fromHeld = amount < held ? amount : held,
            fromAvailable = amount - fromHeld;
          await postJournal(client, transfer, key, "REFUND", [
            account(transfer, "RESERVED", fromHeld, "LIABILITY"),
            account(transfer, "AVAILABLE", fromAvailable, "LIABILITY"),
            account(transfer, "CASH", -amount, "ASSET"),
          ]);
          const refunded = BigInt(transfer.refunded_minor) + amount;
          await client.query(
            "UPDATE gpts_payment_transfers SET refunded_minor=$2,held_minor=$3,status=$4,updated_at=NOW() WHERE transfer_id=$1",
            [
              transfer.transfer_id,
              String(refunded),
              String(held - fromHeld),
              refunded === BigInt(transfer.funded_minor)
                ? "REFUNDED"
                : "REFUNDING",
            ],
          );
        }
        await audit(
          client,
          actor,
          "PROVIDER_" + data.type,
          transfer.transfer_id,
          { eventId: data.id, reference: data.reference },
        );
        await client.query(
          "UPDATE gpts_provider_events SET status='APPLIED',applied_at=NOW(),error_code=NULL WHERE provider_key=$1 AND event_id=$2",
          [providerKey, eventId],
        );
      });
    } catch (cause) {
      await query(
        "UPDATE gpts_provider_events SET status='ERROR',error_code=$3 WHERE provider_key=$1 AND event_id=$2 AND status<>'APPLIED'",
        [providerKey, eventId, cause.code || "PROCESSING_ERROR"],
      );
      throw cause;
    }
  }
  async function cancel(actor, transferId) {
    return tx(async (client) => {
      const transfer = (
        await client.query(
          "SELECT * FROM gpts_payment_transfers WHERE transfer_id=$1 AND customer_id=$2 FOR UPDATE",
          [id.parse(transferId), actor.id],
        )
      ).rows[0];
      if (!transfer) throw fail(404, "Transfer not found.");
      if (
        ["CANCELLED", "REFUND_REVIEW", "REFUNDING", "REFUNDED"].includes(
          transfer.status,
        )
      )
        return;
      if (
        transfer.status === "AWAITING_FUNDS" &&
        BigInt(transfer.funded_minor) === 0n
      ) {
        await client.query(
          "UPDATE gpts_payment_transfers SET status='CANCELLED',updated_at=NOW() WHERE transfer_id=$1",
          [transferId],
        );
      } else if (
        [
          "AWAITING_FUNDS",
          "PENDING_APPROVAL",
          "FAILED",
          "REVIEW_REQUIRED",
        ].includes(transfer.status) &&
        BigInt(transfer.funded_minor) > BigInt(transfer.refunded_minor)
      ) {
        if (transfer.status === "AWAITING_FUNDS")
          await client.query(
            "UPDATE gpts_payment_transfers SET status='REVIEW_REQUIRED',hold_reason='CUSTOMER_REQUESTED_REFUND',updated_at=NOW() WHERE transfer_id=$1",
            [transferId],
          );
        await client.query(
          "UPDATE gpts_payment_transfers SET status='REFUND_REVIEW',refund_requested_by=$2,updated_at=NOW() WHERE transfer_id=$1",
          [transferId, "CUSTOMER:" + actor.id],
        );
      } else
        throw fail(
          409,
          "A processing or delivered transfer cannot be cancelled. Contact support.",
        );
      await audit(client, actor, "CANCELLATION_REQUESTED", transferId);
    });
  }
  async function vote(actor, transferId, input) {
    const data = z
      .object({
        operation: z.enum(["EXECUTE", "REFUND"]),
        decision: z.enum(["APPROVE", "REJECT"]),
        reason: note,
      })
      .strict()
      .parse(input);
    return tx(async (client) => {
      const transfer = (
        await client.query(
          "SELECT * FROM gpts_payment_transfers WHERE transfer_id=$1 FOR UPDATE",
          [id.parse(transferId)],
        )
      ).rows[0];
      if (!transfer) throw fail(404, "Transfer not found.");
      const expected =
        data.operation === "EXECUTE" ? "PENDING_APPROVAL" : "REFUND_REVIEW";
      if (
        transfer.status !== expected ||
        transfer.hold_reason === "ACCOUNT_FROZEN"
      )
        throw fail(409, "This transfer is not awaiting this decision.");
      if (transfer.refund_requested_by === "STAFF:" + actor.id)
        throw fail(403, "A refund requester cannot approve the same refund.");
      const owner = (
        await client.query(
          "SELECT email FROM gpts_customers WHERE customer_id=$1",
          [transfer.customer_id],
        )
      ).rows[0];
      if (
        owner.email.toLowerCase() === actor.email.toLowerCase() ||
        (
          await client.query(
            "SELECT admin_id FROM gpts_staff_customer_links WHERE admin_id=$1 AND customer_id=$2",
            [actor.id, transfer.customer_id],
          )
        ).rows.length
      )
        throw fail(403, "You cannot approve your own transfer.");
      if (data.operation === "EXECUTE") {
        await eligible(client, transfer.customer_id);
        if (Date.parse(transfer.terms.expiresAt) <= now())
          throw fail(
            409,
            "The quote expired. The funded transfer requires refund review.",
          );
      }
      await client.query(
        "INSERT INTO gpts_transfer_votes(vote_id,transfer_id,operation,admin_id,decision,note_enc) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          transferId,
          data.operation,
          actor.id,
          data.decision,
          vault.seal(data.reason, "vote:" + transferId),
        ],
      );
      if (data.decision === "REJECT") {
        if (data.operation === "EXECUTE")
          await client.query(
            "UPDATE gpts_payment_transfers SET status='REFUND_REVIEW',refund_requested_by=$2,updated_at=NOW() WHERE transfer_id=$1",
            [transferId, "STAFF:" + actor.id],
          );
        await audit(
          client,
          actor,
          "TRANSFER_REJECTED",
          transferId,
          { operation: data.operation },
          data.reason,
        );
        return;
      }
      const rejected = (
        await client.query(
          "SELECT COUNT(*)::int AS count FROM gpts_transfer_votes WHERE transfer_id=$1 AND NOT EXISTS(SELECT 1 FROM gpts_staff_customer_links own WHERE own.admin_id=gpts_transfer_votes.admin_id AND own.customer_id=(SELECT customer_id FROM gpts_payment_transfers WHERE transfer_id=$1)) AND operation=$2 AND decision='REJECT'",
          [transferId, data.operation],
        )
      ).rows[0].count;
      if (rejected)
        throw fail(
          409,
          "This operation has a rejected review and requires investigation.",
        );
      const votes = (
        await client.query(
          "SELECT COUNT(*)::int AS count FROM gpts_transfer_votes WHERE transfer_id=$1 AND NOT EXISTS(SELECT 1 FROM gpts_staff_customer_links own WHERE own.admin_id=gpts_transfer_votes.admin_id AND own.customer_id=(SELECT customer_id FROM gpts_payment_transfers WHERE transfer_id=$1)) AND operation=$2 AND decision='APPROVE'",
          [transferId, data.operation],
        )
      ).rows[0].count;
      if (votes >= transfer.policy.approvalQuorum) {
        await client.query(
          "INSERT INTO gpts_payment_jobs(job_id,transfer_id,operation) VALUES($1,$2,$3) ON CONFLICT(transfer_id,operation) DO NOTHING",
          [randomUUID(), transferId, data.operation],
        );
      }
      await audit(
        client,
        actor,
        "TRANSFER_REVIEWED",
        transferId,
        { operation: data.operation, approvals: votes },
        data.reason,
      );
    });
  }
  async function requestRefund(actor, transferId, reason) {
    note.parse(reason);
    return tx(async (client) => {
      const transfer = (
        await client.query(
          "SELECT * FROM gpts_payment_transfers WHERE transfer_id=$1 FOR UPDATE",
          [id.parse(transferId)],
        )
      ).rows[0];
      if (
        !transfer ||
        !["PENDING_APPROVAL", "FAILED", "REVIEW_REQUIRED"].includes(
          transfer.status,
        ) ||
        BigInt(transfer.funded_minor) <= BigInt(transfer.refunded_minor)
      )
        throw fail(409, "This transfer is not eligible for refund review.");
      await client.query(
        "UPDATE gpts_payment_transfers SET status='REFUND_REVIEW',refund_requested_by=$2,updated_at=NOW() WHERE transfer_id=$1",
        [transferId, "STAFF:" + actor.id],
      );
      await audit(client, actor, "REFUND_REQUESTED", transferId, {}, reason);
    });
  }
  async function runOneJob() {
    await ensure();
    const claimed = await tx(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM gpts_payment_jobs WHERE (status IN('PENDING','RETRY') AND next_attempt_at<=NOW()) OR (status='IN_FLIGHT' AND lease_until<NOW()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      if (!rows[0]) return null;
      const job = rows[0],
        transfer = (
          await client.query(
            "SELECT * FROM gpts_payment_transfers WHERE transfer_id=$1 FOR UPDATE",
            [job.transfer_id],
          )
        ).rows[0];
      const running = job.operation === "EXECUTE" ? "PROCESSING" : "REFUNDING",
        expected =
          job.operation === "FUNDING"
            ? "AWAITING_FUNDS"
            : job.operation === "EXECUTE"
              ? "PENDING_APPROVAL"
              : "REFUND_REVIEW";
      const recovering = job.status !== "PENDING";
      try {
        adapter(transfer.provider_key);
        if (
          transfer.status !== expected &&
          !(recovering && transfer.status === running)
        )
          throw fail(409, "Transfer state changed.", "TRANSFER_STATE_CHANGED");
        if (!recovering || transfer.status === expected) {
          if (job.operation === "EXECUTE") {
            await eligible(client, transfer.customer_id);
            const current = await policy(client);
            if (
              !current?.settings.routes.some(
                (route) =>
                  route.enabled &&
                  route.providerKey === transfer.provider_key &&
                  route.corridor === transfer.terms.corridor &&
                  route.sourceCurrency === transfer.terms.sourceCurrency &&
                  route.targetCurrency === transfer.terms.targetCurrency,
              )
            )
              throw fail(409, "Route disabled.", "ROUTE_DISABLED");
            if (
              Date.parse(transfer.terms.expiresAt) <= now() ||
              Date.parse(transfer.terms.screeningExpiresAt) <= now()
            )
              throw fail(409, "Quote or screening expired.", "QUOTE_EXPIRED");
          }
          if (job.operation !== "FUNDING") {
            const votes = (
                await client.query(
                  "SELECT COUNT(*) FILTER(WHERE decision='APPROVE')::int AS approved,COUNT(*) FILTER(WHERE decision='REJECT')::int AS rejected FROM gpts_transfer_votes WHERE transfer_id=$1 AND NOT EXISTS(SELECT 1 FROM gpts_staff_customer_links own WHERE own.admin_id=gpts_transfer_votes.admin_id AND own.customer_id=(SELECT customer_id FROM gpts_payment_transfers WHERE transfer_id=$1)) AND operation=$2",
                  [job.transfer_id, job.operation],
                )
              ).rows[0],
              current = await policy(client);
            if (
              votes.rejected ||
              votes.approved <
                Math.max(
                  transfer.policy.approvalQuorum,
                  current?.settings.approvalQuorum || 0,
                )
            )
              throw fail(
                409,
                "Required approvals are missing.",
                "APPROVALS_REQUIRED",
              );
            await client.query(
              "UPDATE gpts_payment_transfers SET status=$2,updated_at=NOW() WHERE transfer_id=$1",
              [job.transfer_id, running],
            );
          }
        }
      } catch (cause) {
        await client.query(
          "UPDATE gpts_payment_jobs SET status='MANUAL_REVIEW',last_error=$2 WHERE job_id=$1",
          [job.job_id, cause.code || "PRECONDITION_FAILED"],
        );
        if (transfer.status === "PENDING_APPROVAL")
          await client.query(
            "UPDATE gpts_payment_transfers SET status='REVIEW_REQUIRED',hold_reason=$2,updated_at=NOW() WHERE transfer_id=$1",
            [job.transfer_id, cause.code || "PRECONDITION_FAILED"],
          );
        await audit(
          client,
          { type: "SYSTEM", id: "GPTS_QUEUE" },
          "JOB_HELD",
          job.transfer_id,
          {
            operation: job.operation,
            reason: cause.code || "PRECONDITION_FAILED",
          },
        );
        return { held: true };
      }
      await client.query(
        "UPDATE gpts_payment_jobs SET status='IN_FLIGHT',attempts=attempts+1,lease_until=NOW()+INTERVAL '5 minutes' WHERE job_id=$1",
        [job.job_id],
      );
      return { job, transfer, recovering };
    });
    if (!claimed) return false;
    if (claimed.held) return true;
    const { job, transfer, recovering } = claimed,
      provider = adapter(transfer.provider_key);
    try {
      const recipient = (
        await query(
          "SELECT details_enc FROM gpts_recipients WHERE recipient_id=$1",
          [transfer.recipient_id],
        )
      ).rows[0];
      const request = {
        idempotencyKey: job.job_id,
        transferId: transfer.transfer_id,
        quote: transfer.terms,
        recipient: vault.open(
          recipient.details_enc,
          "recipient:" + transfer.recipient_id,
        ),
      };
      let result = recovering
        ? await invoke(provider, "lookup", {
            idempotencyKey: job.job_id,
            operation: job.operation,
            transferId: transfer.transfer_id,
          })
        : null;
      if (recovering && !result) throw Error("Provider status is unconfirmed");
      if (!result || result.status === "NOT_FOUND") {
        // A lost response is never a reason to release funds. Query first, then
        // repeat only the same provider idempotency key after rechecking authority.
        if (recovering && job.operation === "EXECUTE") {
          await eligible({ query }, transfer.customer_id);
          const current = await policy();
          if (
            Date.parse(transfer.terms.expiresAt) <= now() ||
            Date.parse(transfer.terms.screeningExpiresAt) <= now() ||
            !current?.settings.routes.some(
              (route) =>
                route.enabled &&
                route.providerKey === transfer.provider_key &&
                route.corridor === transfer.terms.corridor &&
                route.sourceCurrency === transfer.terms.sourceCurrency &&
                route.targetCurrency === transfer.terms.targetCurrency,
            )
          )
            throw fail(
              409,
              "Execution requires review.",
              "RECOVERY_REVIEW_REQUIRED",
            );
          const votes = (
            await query(
              "SELECT COUNT(*) FILTER(WHERE decision='APPROVE')::int AS approved,COUNT(*) FILTER(WHERE decision='REJECT')::int AS rejected FROM gpts_transfer_votes WHERE transfer_id=$1 AND NOT EXISTS(SELECT 1 FROM gpts_staff_customer_links own WHERE own.admin_id=gpts_transfer_votes.admin_id AND own.customer_id=(SELECT customer_id FROM gpts_payment_transfers WHERE transfer_id=$1)) AND operation='EXECUTE'",
              [job.transfer_id],
            )
          ).rows[0];
          if (
            votes.rejected ||
            votes.approved <
              Math.max(
                transfer.policy.approvalQuorum,
                current.settings.approvalQuorum,
              )
          )
            throw fail(
              409,
              "Execution approvals require review.",
              "RECOVERY_REVIEW_REQUIRED",
            );
        }
        result =
          job.operation === "FUNDING"
            ? await invoke(provider, "prepareFunding", request)
            : job.operation === "EXECUTE"
              ? await invoke(provider, "execute", request)
              : await invoke(provider, "refund", {
                  idempotencyKey: job.job_id,
                  transferId: transfer.transfer_id,
                  amountMinor: String(
                    BigInt(transfer.funded_minor) -
                      BigInt(transfer.refunded_minor),
                  ),
                  currency: transfer.terms.sourceCurrency,
                  originalSourceOnly: true,
                });
      }
      if (!result || typeof result.reference !== "string" || !result.reference)
        throw Error("Invalid provider acknowledgement");
      if (
        job.operation === "FUNDING" &&
        (typeof result.instructions !== "string" ||
          result.instructions.length > 4000 ||
          !result.instructions)
      )
        throw Error("Invalid funding instructions");
      await tx(async (client) => {
        await client.query(
          "UPDATE gpts_payment_jobs SET status='ACKNOWLEDGED',provider_reference=$2,lease_until=NULL WHERE job_id=$1",
          [job.job_id, result.reference],
        );
        if (job.operation === "FUNDING")
          await client.query(
            "UPDATE gpts_payment_transfers SET funding_enc=$2,updated_at=NOW() WHERE transfer_id=$1",
            [
              transfer.transfer_id,
              vault.seal(
                result.instructions,
                "funding:" + transfer.transfer_id,
              ),
            ],
          );
        await audit(
          client,
          { type: "PROVIDER", id: transfer.provider_key },
          job.operation + "_ACKNOWLEDGED",
          transfer.transfer_id,
          { reference: result.reference },
        );
      });
    } catch (cause) {
      await query(
        "UPDATE gpts_payment_jobs SET status=$2,last_error=$3,lease_until=NULL,next_attempt_at=NOW()+INTERVAL '1 minute' WHERE job_id=$1",
        [
          job.job_id,
          cause.code === "RECOVERY_REVIEW_REQUIRED" ? "MANUAL_REVIEW" : "RETRY",
          cause.code || "PROVIDER_OUTCOME_UNCONFIRMED",
        ],
      );
    }
    return true;
  }
  async function providerStatus(actor, transferId) {
    await ensure();
    const transfer = (
      await query("SELECT * FROM gpts_payment_transfers WHERE transfer_id=$1", [
        id.parse(transferId),
      ])
    ).rows[0];
    if (
      !transfer ||
      (actor.type === "CUSTOMER" && transfer.customer_id !== actor.id)
    )
      throw fail(404, "Transfer not found.");
    const job = (
      await query(
        "SELECT * FROM gpts_payment_jobs WHERE transfer_id=$1 ORDER BY created_at DESC LIMIT 1",
        [transferId],
      )
    ).rows[0];
    if (!job) throw fail(409, "No provider operation has been submitted.");
    const response = await invoke(adapter(transfer.provider_key), "lookup", {
      idempotencyKey: job.job_id,
      operation: job.operation,
      transferId,
    });
    await tx((client) =>
      audit(client, actor, "PROVIDER_STATUS_CHECKED", transferId),
    );
    if (response?.event) {
      const normalized = eventInput.parse(response.event);
      if (normalized.transferId !== transferId)
        throw fail(409, "Provider status references another transfer.");
      await recordProviderEvent(
        transfer.provider_key,
        normalized,
        Buffer.from(canonical(normalized)),
      );
    }
    return {
      status: (
        await query(
          "SELECT status FROM gpts_payment_transfers WHERE transfer_id=$1",
          [transferId],
        )
      ).rows[0].status,
    };
  }
  async function resumeJob(actor, jobId, reason) {
    note.parse(reason);
    return tx(async (client) => {
      const job = (
        await client.query(
          "SELECT * FROM gpts_payment_jobs WHERE job_id=$1 FOR UPDATE",
          [id.parse(jobId)],
        )
      ).rows[0];
      if (!job || !["MANUAL_REVIEW", "RETRY"].includes(job.status))
        throw fail(409, "This operation is not awaiting recovery.");
      const transfer = (
        await client.query(
          "SELECT * FROM gpts_payment_transfers WHERE transfer_id=$1 FOR UPDATE",
          [job.transfer_id],
        )
      ).rows[0];
      adapter(transfer.provider_key);
      if (
        job.operation === "EXECUTE" &&
        transfer.status === "REVIEW_REQUIRED"
      ) {
        await eligible(client, transfer.customer_id);
        const current = await policy(client);
        if (
          Date.parse(transfer.terms.expiresAt) <= now() ||
          Date.parse(transfer.terms.screeningExpiresAt) <= now() ||
          !current?.settings.routes.some(
            (route) =>
              route.enabled &&
              route.providerKey === transfer.provider_key &&
              route.corridor === transfer.terms.corridor &&
              route.sourceCurrency === transfer.terms.sourceCurrency &&
              route.targetCurrency === transfer.terms.targetCurrency,
          )
        )
          throw fail(
            409,
            "The transfer requires refund or fresh terms, not execution recovery.",
          );
        const votes = (
          await client.query(
            "SELECT COUNT(*) FILTER(WHERE decision='APPROVE')::int AS approved,COUNT(*) FILTER(WHERE decision='REJECT')::int AS rejected FROM gpts_transfer_votes WHERE transfer_id=$1 AND NOT EXISTS(SELECT 1 FROM gpts_staff_customer_links own WHERE own.admin_id=gpts_transfer_votes.admin_id AND own.customer_id=(SELECT customer_id FROM gpts_payment_transfers WHERE transfer_id=$1)) AND operation='EXECUTE'",
            [job.transfer_id],
          )
        ).rows[0];
        if (
          votes.rejected ||
          votes.approved <
            Math.max(
              transfer.policy.approvalQuorum,
              current.settings.approvalQuorum,
            )
        )
          throw fail(409, "Independent approvals are still required.");
        await client.query(
          "UPDATE gpts_payment_transfers SET status='PENDING_APPROVAL',hold_reason=NULL,updated_at=NOW() WHERE transfer_id=$1",
          [job.transfer_id],
        );
      }
      await client.query(
        "UPDATE gpts_payment_jobs SET status='RETRY',next_attempt_at=NOW(),lease_until=NULL,last_error=NULL WHERE job_id=$1",
        [jobId],
      );
      await audit(
        client,
        actor,
        "JOB_RECOVERY_REQUESTED",
        job.transfer_id,
        { jobId },
        reason,
      );
    });
  }
  async function openSupport(actor, input) {
    const data = z
      .object({
        transferId: id.optional(),
        category: z.enum(["PAYMENT", "ACCOUNT", "COMPLAINT"]),
        subject: z.string().trim().min(3).max(120),
        message: note,
      })
      .strict()
      .parse(input);
    return tx(async (client) => {
      if (
        data.transferId &&
        !(
          await client.query(
            "SELECT transfer_id FROM gpts_payment_transfers WHERE transfer_id=$1 AND customer_id=$2",
            [data.transferId, actor.id],
          )
        ).rows.length
      )
        throw fail(404, "Transfer not found.");
      const caseId = randomUUID();
      await client.query(
        "INSERT INTO gpts_support_cases(case_id,customer_id,transfer_id,category,subject) VALUES($1,$2,$3,$4,$5)",
        [
          caseId,
          actor.id,
          data.transferId || null,
          data.category,
          data.subject,
        ],
      );
      await client.query(
        "INSERT INTO gpts_support_messages(message_id,case_id,actor_type,actor_id,body_enc) VALUES($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          caseId,
          actor.type,
          actor.id,
          vault.seal(data.message, "support:" + caseId),
        ],
      );
      await audit(client, actor, "SUPPORT_OPENED", caseId);
      return caseId;
    });
  }
  async function replySupport(actor, caseId, input) {
    const data = z
      .object({
        message: note,
        internal: z.boolean().default(false),
        status: z.enum(["OPEN", "IN_PROGRESS", "CLOSED"]).optional(),
      })
      .strict()
      .parse(input);
    if (actor.type === "CUSTOMER" && (data.internal || data.status))
      throw fail(
        403,
        "Customers cannot add internal notes or close staff cases.",
      );
    return tx(async (client) => {
      const record = (
        await client.query(
          "SELECT * FROM gpts_support_cases WHERE case_id=$1 FOR UPDATE",
          [id.parse(caseId)],
        )
      ).rows[0];
      if (
        !record ||
        (actor.type === "CUSTOMER" && record.customer_id !== actor.id)
      )
        throw fail(404, "Support case not found.");
      await client.query(
        "INSERT INTO gpts_support_messages(message_id,case_id,actor_type,actor_id,internal,body_enc) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          caseId,
          actor.type,
          actor.id,
          data.internal,
          vault.seal(data.message, "support:" + caseId),
        ],
      );
      await client.query(
        "UPDATE gpts_support_cases SET status=$2,updated_at=NOW() WHERE case_id=$1",
        [
          caseId,
          data.status ||
            (actor.type === "CUSTOMER" && record.status === "CLOSED"
              ? "OPEN"
              : record.status),
        ],
      );
      await audit(client, actor, "SUPPORT_REPLIED", caseId, {
        internal: data.internal,
      });
    });
  }
  async function reconcile(actor, providerKey, date) {
    z.string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .parse(date);
    const provider = adapter(providerKey),
      rows = await invoke(provider, "statement", { date });
    if (!Array.isArray(rows) || rows.length > 10000)
      throw fail(409, "Invalid provider statement.");
    return tx(async (client) => {
      let issues = 0;
      for (const raw of rows) {
        const row = z
          .object({
            rowId: z.string().min(1).max(160),
            transferId: id,
            currency,
            signedMinor: z.string().regex(/^-?\d{1,19}$/),
            eventKey: z.string().min(1).max(300),
            observedAt: z.string().datetime(),
          })
          .strict()
          .parse(raw);
        const hash = digest(canonical(row));
        const existing = (
          await client.query(
            "SELECT payload_hash FROM gpts_statement_rows WHERE provider_key=$1 AND row_id=$2",
            [providerKey, row.rowId],
          )
        ).rows[0];
        if (existing) {
          if (existing.payload_hash !== hash)
            throw fail(
              409,
              "The statement reference has conflicting contents.",
            );
          continue;
        }
        await client.query(
          "INSERT INTO gpts_statement_rows(provider_key,row_id,transfer_id,currency,signed_minor,event_key,payload_hash,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            providerKey,
            row.rowId,
            row.transferId,
            row.currency,
            row.signedMinor,
            row.eventKey,
            hash,
            row.observedAt,
          ],
        );
        const book = await client.query(
          "SELECT COALESCE(SUM(l.signed_minor),0)::text AS amount,COUNT(*)::int AS count FROM gpts_money_lines l JOIN gpts_money_journals j USING(journal_id) JOIN gpts_payment_transfers t ON t.transfer_id=j.transfer_id WHERE j.event_key=$1 AND j.transfer_id=$2 AND t.provider_key=$3 AND l.currency=$4 AND l.account_id LIKE 'CASH:%'",
          [row.eventKey, row.transferId, providerKey, row.currency],
        );
        if (
          !book.rows[0].count ||
          BigInt(book.rows[0].amount) !== BigInt(row.signedMinor)
        ) {
          issues++;
          await client.query(
            "INSERT INTO gpts_reconciliation_issues(issue_id,provider_key,row_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT(provider_key,row_id) DO NOTHING",
            [
              randomUUID(),
              providerKey,
              row.rowId,
              book.rows[0].count ? "AMOUNT_MISMATCH" : "UNMATCHED_REFERENCE",
            ],
          );
        }
      }
      await audit(client, actor, "STATEMENT_RECONCILED", providerKey, {
        date,
        rows: rows.length,
        issues,
      });
      return { rows: rows.length, issues };
    });
  }
  async function resolveIssue(actor, issueId, reason) {
    note.parse(reason);
    return tx(async (client) => {
      const issue = (
        await client.query(
          "SELECT * FROM gpts_reconciliation_issues WHERE issue_id=$1 FOR UPDATE",
          [id.parse(issueId)],
        )
      ).rows[0];
      if (!issue) throw fail(404, "Reconciliation issue not found.");
      const row = (
        await client.query(
          "SELECT * FROM gpts_statement_rows WHERE provider_key=$1 AND row_id=$2",
          [issue.provider_key, issue.row_id],
        )
      ).rows[0];
      const balance = (
        await client.query(
          "SELECT COALESCE(SUM(l.signed_minor),0)::text AS amount,COUNT(*)::int AS count FROM gpts_money_lines l JOIN gpts_money_journals j USING(journal_id) JOIN gpts_payment_transfers t ON t.transfer_id=j.transfer_id WHERE j.event_key=$1 AND j.transfer_id=$2 AND l.currency=$3 AND t.provider_key=$4 AND l.account_id LIKE 'CASH:%'",
          [row.event_key, row.transfer_id, row.currency, issue.provider_key],
        )
      ).rows[0];
      if (!balance.count || BigInt(balance.amount) !== BigInt(row.signed_minor))
        throw fail(
          409,
          "The statement and ledger still differ. Resolution cannot invent a balancing payment.",
        );
      await client.query(
        "UPDATE gpts_reconciliation_issues SET status='RESOLVED',resolution_enc=$2,resolved_by=$3,resolved_at=NOW() WHERE issue_id=$1",
        [issueId, vault.seal(reason, "reconciliation:" + issueId), actor.id],
      );
      await audit(
        client,
        actor,
        "RECONCILIATION_RESOLVED",
        issueId,
        {},
        reason,
      );
    });
  }
  return {
    ensure,
    tx,
    vault,
    adapters,
    adapter,
    authorise,
    stepup,
    securityStatus,
    startMfa,
    confirmMfa,
    savePolicy,
    policy,
    grant,
    linkStaffCustomer,
    audit,
    addRecipient,
    archiveRecipient,
    verification,
    uploadIdentity,
    submitVerification,
    reviewVerification,
    freeze,
    requestQuote,
    acceptQuote,
    postJournal,
    ingest,
    applyEvent,
    cancel,
    vote,
    requestRefund,
    runOneJob,
    providerStatus,
    resumeJob,
    openSupport,
    replySupport,
    reconcile,
    resolveIssue,
  };
}

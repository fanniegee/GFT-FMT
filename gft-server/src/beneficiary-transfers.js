import { randomUUID } from "node:crypto";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
function amount(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(text))
    throw fail(
      400,
      "Enter an amount greater than zero with at most two decimal places.",
    );
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents <= 0n) throw fail(400, "Enter an amount greater than zero.");
  return String(cents / 100n) + "." + String(cents % 100n).padStart(2, "0");
}
export function installBeneficiaryTransfers(
  app,
  { query, withTransaction, getBeneficiary, getAdmin },
) {
  let schema;
  function ensureSchema() {
    schema ??= withTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('gft-beneficiary-transfers-v1'))",
      );
      await client.query(
        [
          "CREATE TABLE IF NOT EXISTS beneficiary_transfers(transfer_id UUID PRIMARY KEY,client_request_id UUID NOT NULL,sender_system_id TEXT NOT NULL,recipient_system_id TEXT NOT NULL,sender_name TEXT NOT NULL,recipient_name TEXT NOT NULL,source_wallet_id UUID NOT NULL REFERENCES wallets(wallet_id),target_wallet_id UUID NOT NULL REFERENCES wallets(wallet_id),amount NUMERIC(18,2) NOT NULL CHECK(amount>0),currency CHAR(3) NOT NULL,note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','AUTHORIZED','COMPLETED','REJECTED','CANCELLED')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(sender_system_id,client_request_id),CHECK(sender_system_id<>recipient_system_id),CHECK(source_wallet_id<>target_wallet_id));",
          "CREATE INDEX IF NOT EXISTS beneficiary_transfers_sender_idx ON beneficiary_transfers(sender_system_id,created_at DESC);",
          "CREATE INDEX IF NOT EXISTS beneficiary_transfers_recipient_idx ON beneficiary_transfers(recipient_system_id,created_at DESC);",
          "CREATE INDEX IF NOT EXISTS beneficiary_transfer_reserves_idx ON beneficiary_transfers(source_wallet_id) WHERE status='AUTHORIZED';",
          "CREATE TABLE IF NOT EXISTS beneficiary_transfer_events(event_id UUID PRIMARY KEY,transfer_id UUID NOT NULL REFERENCES beneficiary_transfers(transfer_id),action TEXT NOT NULL,actor_id TEXT NOT NULL,actor_role TEXT NOT NULL,note TEXT NOT NULL,ip_address TEXT,user_agent TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());",
          "CREATE INDEX IF NOT EXISTS beneficiary_transfer_events_transfer_idx ON beneficiary_transfer_events(transfer_id,created_at);",
          "CREATE UNIQUE INDEX IF NOT EXISTS beneficiary_transfer_posting_idx ON ledger_entries(reference,wallet_id,entry_type) WHERE metadata ? 'beneficiaryTransferId';",
          "CREATE OR REPLACE FUNCTION gft_transfer_history_protection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Beneficiary transfer audit history is permanent'; END $$;",
          "DROP TRIGGER IF EXISTS gft_transfer_events_append_only ON beneficiary_transfer_events;",
          "CREATE TRIGGER gft_transfer_events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON beneficiary_transfer_events FOR EACH STATEMENT EXECUTE FUNCTION gft_transfer_history_protection();",
          "CREATE OR REPLACE FUNCTION gft_transfer_row_protection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Transfers cannot be deleted'; END IF; IF (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at') THEN RAISE EXCEPTION 'Transfer details cannot be changed'; END IF; IF NOT ((OLD.status='PENDING' AND NEW.status IN('AUTHORIZED','REJECTED','CANCELLED')) OR (OLD.status='AUTHORIZED' AND NEW.status IN('COMPLETED','CANCELLED'))) THEN RAISE EXCEPTION 'Invalid transfer state change'; END IF; RETURN NEW; END $$;",
          "DROP TRIGGER IF EXISTS gft_transfer_row_immutable ON beneficiary_transfers;",
          "CREATE TRIGGER gft_transfer_row_immutable BEFORE UPDATE OR DELETE ON beneficiary_transfers FOR EACH ROW EXECUTE FUNCTION gft_transfer_row_protection();",
          "DROP TRIGGER IF EXISTS gft_transfer_no_truncate ON beneficiary_transfers;",
          "CREATE TRIGGER gft_transfer_no_truncate BEFORE TRUNCATE ON beneficiary_transfers FOR EACH STATEMENT EXECUTE FUNCTION gft_transfer_history_protection();",
          "CREATE OR REPLACE FUNCTION gft_transfer_ledger_protection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='TRUNCATE' THEN IF EXISTS(SELECT 1 FROM ledger_entries WHERE metadata ? 'beneficiaryTransferId') THEN RAISE EXCEPTION 'Transfer ledger records are permanent'; END IF; RETURN NULL; END IF; IF OLD.metadata ? 'beneficiaryTransferId' THEN RAISE EXCEPTION 'Transfer ledger records are permanent'; END IF; RETURN COALESCE(NEW,OLD); END $$;",
          "DROP TRIGGER IF EXISTS gft_transfer_ledger_immutable ON ledger_entries;",
          "CREATE TRIGGER gft_transfer_ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION gft_transfer_ledger_protection();",
          "DROP TRIGGER IF EXISTS gft_transfer_ledger_no_truncate ON ledger_entries;",
          "CREATE TRIGGER gft_transfer_ledger_no_truncate BEFORE TRUNCATE ON ledger_entries FOR EACH STATEMENT EXECUTE FUNCTION gft_transfer_ledger_protection();",
        ].join("\n"),
      );
    }).catch((error) => {
      schema = undefined;
      throw error;
    });
    return schema;
  }
  function route(method, path, handler, founder = false) {
    app[method](path, async (req, res) => {
      res.set("Cache-Control", "private, no-store");
      try {
        const actor = founder ? await getAdmin(req) : await getBeneficiary(req);
        if (!actor) throw fail(401, "Please sign in.");
        if (founder && String(actor.role).toUpperCase() !== "FOUNDER")
          throw fail(403, "Founder authorization is required.");
        if (method !== "get" && !req.is("application/json"))
          throw fail(415, "Send JSON data.");
        await ensureSchema();
        return await handler(req, res, actor);
      } catch (error) {
        if (!error.status)
          console.error(
            "Beneficiary transfer failed:",
            error.code || error.name,
          );
        return res
          .status(error.status || 500)
          .json({
            ok: false,
            error: error.status
              ? error.message
              : "The transfer could not be completed. You can safely retry the same request.",
          });
      }
    });
  }
  async function event(
    client,
    req,
    actor,
    transferId,
    action,
    note,
    founder = false,
  ) {
    const actorId = founder ? actor.admin_id : actor.system_id;
    await client.query(
      "INSERT INTO beneficiary_transfer_events(event_id,transfer_id,action,actor_id,actor_role,note,ip_address,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        transferId,
        action,
        actorId,
        founder ? "FOUNDER" : "BENEFICIARY",
        note,
        String(req.ip || "").slice(0, 100),
        String(req.get?.("user-agent") || "").slice(0, 1000),
      ],
    );
    if (founder)
      await client.query(
        "INSERT INTO gft_admin_audit_events(event_id,admin_id,admin_email,action,details,ip_address,user_agent) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)",
        [
          "AUD-" + randomUUID(),
          actor.admin_id,
          actor.email,
          "BENEFICIARY_TRANSFER_" + action,
          JSON.stringify({ transferId, note }),
          req.ip || null,
          String(req.get?.("user-agent") || "").slice(0, 1000),
        ],
      );
  }
  async function lockWallets(client, ids) {
    const { rows } = await client.query(
      "SELECT w.wallet_id,w.owner_system_id,TRIM(w.currency) AS currency,w.account_number,b.full_name FROM wallets w JOIN beneficiaries b ON b.system_id=w.owner_system_id WHERE w.wallet_id=ANY($1::uuid[]) AND UPPER(w.status)='ACTIVE' AND UPPER(b.status)='ACTIVE' AND UPPER(b.identity_status)='VERIFIED' AND UPPER(b.lineage_status)='VERIFIED' ORDER BY w.wallet_id FOR UPDATE OF w,b",
      [ids],
    );
    if (rows.length !== ids.length)
      throw fail(409, "Both beneficiaries must have verified active wallets.");
    return rows;
  }
  async function available(client, walletId, currency, exclude = null) {
    const { rows } = await client.query(
      "SELECT COALESCE((SELECT SUM(CASE WHEN UPPER(TRIM(entry_type)) IN('CREDIT','DEPOSIT') THEN amount WHEN UPPER(TRIM(entry_type)) IN('DEBIT','WITHDRAWAL') THEN -amount ELSE 0 END) FROM ledger_entries WHERE wallet_id=$1 AND TRIM(currency)=$2),0) - COALESCE((SELECT SUM(amount) FROM payout_requests WHERE wallet_id=$1 AND TRIM(currency)=$2 AND status='AUTHORIZED'),0) - COALESCE((SELECT SUM(amount) FROM beneficiary_transfers WHERE source_wallet_id=$1 AND status='AUTHORIZED' AND ($3::uuid IS NULL OR transfer_id<>$3)),0) AS available",
      [walletId, currency, exclude],
    );
    return rows[0].available;
  }
  route(
    "get",
    "/api/beneficiary/transfers/wallets",
    async (_req, res, actor) => {
      const { rows } = await query(
        "SELECT w.wallet_id,w.account_number,TRIM(w.currency) AS currency,COALESCE(SUM(CASE WHEN UPPER(TRIM(le.entry_type)) IN('CREDIT','DEPOSIT') THEN le.amount WHEN UPPER(TRIM(le.entry_type)) IN('DEBIT','WITHDRAWAL') THEN -le.amount ELSE 0 END),0) AS balance FROM wallets w JOIN beneficiaries b ON b.system_id=w.owner_system_id LEFT JOIN ledger_entries le ON le.wallet_id=w.wallet_id AND TRIM(le.currency)=TRIM(w.currency) WHERE w.owner_system_id=$1 AND UPPER(w.status)='ACTIVE' AND UPPER(b.status)='ACTIVE' AND UPPER(b.identity_status)='VERIFIED' AND UPPER(b.lineage_status)='VERIFIED' GROUP BY w.wallet_id,w.account_number,w.currency,w.created_at ORDER BY w.created_at,w.wallet_id",
        [actor.system_id],
      );
      for (const wallet of rows)
        wallet.available = await available(
          { query },
          wallet.wallet_id,
          wallet.currency,
        );
      return res.json({ ok: true, wallets: rows });
    },
  );
  route(
    "get",
    "/api/beneficiary/transfers/recipient",
    async (req, res, actor) => {
      const systemId = String(req.query.systemId || "")
        .trim()
        .toUpperCase();
      const currency = String(req.query.currency || "")
        .trim()
        .toUpperCase();
      if (!/^GFT-GEN\d+-\d+$/.test(systemId) || !/^[A-Z]{3}$/.test(currency))
        throw fail(
          400,
          "Enter the recipient’s GFT system ID and select your wallet.",
        );
      if (systemId === actor.system_id)
        throw fail(400, "Choose another beneficiary.");
      const { rows } = await query(
        "SELECT b.system_id,b.full_name,w.wallet_id FROM beneficiaries b JOIN wallets w ON w.owner_system_id=b.system_id WHERE b.system_id=$1 AND UPPER(b.status)='ACTIVE' AND UPPER(b.identity_status)='VERIFIED' AND UPPER(b.lineage_status)='VERIFIED' AND UPPER(w.status)='ACTIVE' AND TRIM(w.currency)=$2 ORDER BY w.created_at,w.wallet_id LIMIT 1",
        [systemId, currency],
      );
      if (!rows.length)
        throw fail(
          404,
          "No verified beneficiary with an active wallet in this currency was found.",
        );
      return res.json({ ok: true, recipient: rows[0] });
    },
  );
  route("post", "/api/beneficiary/transfers", async (req, res, actor) => {
    const body = req.body || {},
      value = amount(body.amount);
    if (
      ![body.sourceWalletId, body.recipientWalletId, body.requestId].every(
        (id) => typeof id === "string" && uuid.test(id),
      )
    )
      throw fail(400, "Select your wallet and confirm the recipient.");
    for (const key of ["sourceWalletId", "recipientWalletId", "requestId"])
      body[key] = body[key].toLowerCase();
    const recipientId = String(body.recipientSystemId || "")
      .trim()
      .toUpperCase();
    const recipientName =
      typeof body.recipientName === "string" ? body.recipientName.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (
      note.length > 300 ||
      !recipientName ||
      recipientId === actor.system_id ||
      body.sourceWalletId === body.recipientWalletId
    )
      throw fail(400, "Check the recipient and transfer note.");
    const transfer = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "beneficiary-transfer:" + actor.system_id + ":" + body.requestId,
      ]);
      const existing = await client.query(
        "SELECT * FROM beneficiary_transfers WHERE sender_system_id=$1 AND client_request_id=$2",
        [actor.system_id, body.requestId],
      );
      if (existing.rowCount) {
        const item = existing.rows[0];
        if (
          item.source_wallet_id !== body.sourceWalletId ||
          item.target_wallet_id !== body.recipientWalletId ||
          item.recipient_system_id !== recipientId ||
          amount(item.amount) !== value ||
          item.note !== note
        )
          throw fail(
            409,
            "This request reference was already used for different transfer details.",
          );
        return item;
      }
      const wallets = await lockWallets(client, [
        body.sourceWalletId,
        body.recipientWalletId,
      ]);
      const source = wallets.find(
          (wallet) => wallet.wallet_id === body.sourceWalletId,
        ),
        target = wallets.find(
          (wallet) => wallet.wallet_id === body.recipientWalletId,
        );
      if (
        source.owner_system_id !== actor.system_id ||
        target.owner_system_id !== recipientId ||
        target.full_name !== recipientName ||
        source.currency !== target.currency
      )
        throw fail(
          409,
          "Recipient details have changed. Find and confirm the recipient again.",
        );
      const funds = await available(client, source.wallet_id, source.currency);
      const sufficient = await client.query(
        "SELECT $1::numeric >= $2::numeric AS sufficient",
        [funds, value],
      );
      if (!sufficient.rows[0].sufficient)
        throw fail(409, "Your available wallet balance is insufficient.");
      const { rows } = await client.query(
        "INSERT INTO beneficiary_transfers(transfer_id,client_request_id,sender_system_id,recipient_system_id,sender_name,recipient_name,source_wallet_id,target_wallet_id,amount,currency,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
        [
          randomUUID(),
          body.requestId,
          actor.system_id,
          recipientId,
          source.full_name,
          target.full_name,
          source.wallet_id,
          target.wallet_id,
          value,
          source.currency,
          note,
        ],
      );
      await event(client, req, actor, rows[0].transfer_id, "REQUESTED", note);
      return rows[0];
    });
    return res.status(201).json({ ok: true, transfer });
  });
  route("get", "/api/beneficiary/transfers", async (req, res, actor) => {
    const before = req.query.before || null;
    if (before && !uuid.test(before)) throw fail(400, "Invalid history page.");
    const { rows } = await query(
      "SELECT t.*,t.sender_system_id=$1 AS outgoing,COALESCE((SELECT jsonb_agg(jsonb_build_object('action',e.action,'note',e.note,'created_at',e.created_at) ORDER BY e.created_at) FROM beneficiary_transfer_events e WHERE e.transfer_id=t.transfer_id),'[]'::jsonb) AS events FROM beneficiary_transfers t WHERE $1 IN(t.sender_system_id,t.recipient_system_id) AND ($2::uuid IS NULL OR (t.created_at,t.transfer_id)<(SELECT created_at,transfer_id FROM beneficiary_transfers WHERE transfer_id=$2 AND $1 IN(sender_system_id,recipient_system_id))) ORDER BY t.created_at DESC,t.transfer_id DESC LIMIT 101",
      [actor.system_id, before],
    );
    const transfers = rows.slice(0, 100);
    return res.json({
      ok: true,
      transfers,
      nextCursor: rows.length > 100 ? transfers.at(-1).transfer_id : null,
    });
  });
  async function act(req, res, actor, action, founder) {
    const id = req.params.id,
      note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!uuid.test(id) || note.length < 3 || note.length > 500)
      throw fail(400, "Enter a reason of 3 to 500 characters.");
    const transfer = await withTransaction(async (client) => {
      const found = await client.query(
        "SELECT source_wallet_id,target_wallet_id FROM beneficiary_transfers WHERE transfer_id=$1 AND ($2::text IS NULL OR sender_system_id=$2)",
        [id, founder ? null : actor.system_id],
      );
      if (!found.rowCount) throw fail(404, "Transfer unavailable.");
      const ids = [
        found.rows[0].source_wallet_id,
        found.rows[0].target_wallet_id,
      ];
      // Always lock wallet rows before the transfer row, matching payout accounting.
      await client.query(
        "SELECT wallet_id FROM wallets WHERE wallet_id=ANY($1::uuid[]) ORDER BY wallet_id FOR UPDATE",
        [ids],
      );
      const {
        rows: [item],
      } = await client.query(
        "SELECT * FROM beneficiary_transfers WHERE transfer_id=$1 FOR UPDATE",
        [id],
      );
      if (!founder && item.sender_system_id !== actor.system_id)
        throw fail(404, "Transfer unavailable.");
      let status;
      if (
        action === "cancel" &&
        ["PENDING", "AUTHORIZED"].includes(item.status)
      )
        status = "CANCELLED";
      else if (founder && action === "reject" && item.status === "PENDING")
        status = "REJECTED";
      else if (founder && action === "authorize" && item.status === "PENDING")
        status = "AUTHORIZED";
      else if (founder && action === "execute" && item.status === "AUTHORIZED")
        status = "COMPLETED";
      else
        throw fail(409, "This action is no longer available for the transfer.");
      if (["AUTHORIZED", "COMPLETED"].includes(status)) {
        const wallets = await lockWallets(client, ids);
        if (
          !wallets.some(
            (wallet) =>
              wallet.wallet_id === item.source_wallet_id &&
              wallet.owner_system_id === item.sender_system_id &&
              wallet.currency === item.currency.trim(),
          ) ||
          !wallets.some(
            (wallet) =>
              wallet.wallet_id === item.target_wallet_id &&
              wallet.owner_system_id === item.recipient_system_id &&
              wallet.currency === item.currency.trim(),
          )
        )
          throw fail(409, "The recorded transfer wallets are no longer valid.");
        const funds = await available(
          client,
          item.source_wallet_id,
          item.currency.trim(),
          id,
        );
        const check = await client.query(
          "SELECT $1::numeric >= $2::numeric AS sufficient",
          [funds, item.amount],
        );
        if (!check.rows[0].sufficient)
          throw fail(
            409,
            "The sender has insufficient available funds after existing authorizations.",
          );
      }
      if (status === "COMPLETED") {
        const reference = "beneficiary-transfer:" + id;
        await client.query(
          "INSERT INTO ledger_entries(wallet_id,entry_type,amount,currency,reference,metadata) VALUES($1,'DEBIT',$3,$4,$5,jsonb_build_object('beneficiaryTransferId',$6::text)),($2,'CREDIT',$3,$4,$5,jsonb_build_object('beneficiaryTransferId',$6::text))",
          [
            item.source_wallet_id,
            item.target_wallet_id,
            item.amount,
            item.currency,
            reference,
            id,
          ],
        );
      }
      const updated = await client.query(
        "UPDATE beneficiary_transfers SET status=$2,updated_at=NOW() WHERE transfer_id=$1 RETURNING *",
        [id, status],
      );
      await event(client, req, actor, id, status, note, founder);
      return updated.rows[0];
    });
    return res.json({ ok: true, transfer });
  }
  route("post", "/api/beneficiary/transfers/:id/cancel", (req, res, actor) =>
    act(req, res, actor, "cancel", false),
  );
  route(
    "get",
    "/api/founder/beneficiary-transfers",
    async (req, res) => {
      const before = req.query.before || null;
      if (before && !uuid.test(before))
        throw fail(400, "Invalid history page.");
      const { rows } = await query(
        "SELECT t.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('action',e.action,'actor_id',e.actor_id,'actor_role',e.actor_role,'note',e.note,'created_at',e.created_at) ORDER BY e.created_at) FROM beneficiary_transfer_events e WHERE e.transfer_id=t.transfer_id),'[]'::jsonb) AS events FROM beneficiary_transfers t WHERE $1::uuid IS NULL OR (t.created_at,t.transfer_id)<(SELECT created_at,transfer_id FROM beneficiary_transfers WHERE transfer_id=$1) ORDER BY t.created_at DESC,t.transfer_id DESC LIMIT 101",
        [before],
      );
      const transfers = rows.slice(0, 100);
      return res.json({
        ok: true,
        transfers,
        nextCursor: rows.length > 100 ? transfers.at(-1).transfer_id : null,
      });
    },
    true,
  );
  route(
    "post",
    "/api/founder/beneficiary-transfers/:id/:action",
    (req, res, actor) => {
      if (
        !["authorize", "execute", "reject", "cancel"].includes(
          req.params.action,
        )
      )
        throw fail(404, "Unknown transfer action.");
      return act(req, res, actor, req.params.action, true);
    },
    true,
  );
  return { ensureSchema };
}

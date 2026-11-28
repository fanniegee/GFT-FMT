import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';

export const countries = Object.freeze({
  ZW: { name: 'Zimbabwe', currencies: ['USD', 'ZWG'] },
  ZA: { name: 'South Africa', currencies: ['ZAR'] },
  BW: { name: 'Botswana', currencies: ['BWP'] },
  ZM: { name: 'Zambia', currencies: ['ZMW'] },
  MZ: { name: 'Mozambique', currencies: ['MZN'] }
});
export const corridors = Object.keys(countries).filter(code => code !== 'ZW')
  .flatMap(code => [{ id: `ZW-${code}`, origin: 'ZW', destination: code }, { id: `${code}-ZW`, origin: code, destination: 'ZW' }]);
const failure = (status, message) => Object.assign(new Error(message), { status });
export function normalizeAmount(value) {
  if (typeof value !== 'string' || !/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) throw failure(400, 'Enter a positive amount with up to two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor === 0n) throw failure(400, 'The amount must be greater than zero.');
  return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
}
const instructionInput = z.object({
  requestId: z.string().uuid(), corridor: z.enum(corridors.map(route => route.id)),
  currency: z.enum(['USD', 'ZWG', 'ZAR', 'BWP', 'ZMW', 'MZN']), amount: z.string(),
  recipientName: z.string().trim().min(2).max(120),
  payoutMethod: z.enum(['BANK', 'MOBILE_WALLET']), purpose: z.string().trim().max(200).default('')
}).strict();
const idInput = z.string().uuid();
const fields = 'instruction_id,corridor_id,currency,amount,recipient_name,payout_method,purpose,status,created_at,updated_at';

// This book records instructions, not customer money. Only a contracted provider's
// authenticated quote/funding/settlement integration may introduce money movement.
export function installGptsPayments(app, { query, withTransaction, getBeneficiary, getAdmin, getCustomer = async()=>null, ensureCustomers = async()=>{} }) {
  let ready;
  function ensureSchema() {
    ready ??= (async()=>{ await ensureCustomers(); return withTransaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gpts-payments-v1'))");
      await client.query(`
        CREATE TABLE IF NOT EXISTS gpts_payment_corridors (
          corridor_id TEXT PRIMARY KEY, origin_country CHAR(2) NOT NULL,
          destination_country CHAR(2) NOT NULL,
          status TEXT NOT NULL DEFAULT 'AWAITING_PROVIDER' CHECK(status='AWAITING_PROVIDER'),
          CHECK(origin_country<>destination_country)
        );
        CREATE TABLE IF NOT EXISTS gpts_payment_instructions (
          instruction_id UUID PRIMARY KEY, beneficiary_id TEXT NOT NULL,
          client_request_id UUID NOT NULL, payload_hash TEXT NOT NULL,
          corridor_id TEXT NOT NULL REFERENCES gpts_payment_corridors(corridor_id),
          currency CHAR(3) NOT NULL CHECK(currency IN('USD','ZWG','ZAR','BWP','ZMW','MZN')),
          amount NUMERIC(18,2) NOT NULL CHECK(amount>0),
          recipient_name TEXT NOT NULL, payout_method TEXT NOT NULL CHECK(payout_method IN('BANK','MOBILE_WALLET')),
          purpose TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'AWAITING_CHANNEL'
            CHECK(status IN('AWAITING_CHANNEL','CANCELLED')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(beneficiary_id,client_request_id)
        );
        ALTER TABLE gpts_payment_instructions ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES gpts_customers(customer_id);
        ALTER TABLE gpts_payment_instructions ALTER COLUMN beneficiary_id DROP NOT NULL;
        DO $ BEGIN
          IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='gpts_instruction_one_owner' AND conrelid='gpts_payment_instructions'::regclass) THEN
            ALTER TABLE gpts_payment_instructions ADD CONSTRAINT gpts_instruction_one_owner CHECK((beneficiary_id IS NOT NULL)<>(customer_id IS NOT NULL));
          END IF;
        END $;
        CREATE UNIQUE INDEX IF NOT EXISTS gpts_instruction_customer_request_idx ON gpts_payment_instructions(customer_id,client_request_id) WHERE customer_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS gpts_instruction_customer_history_idx ON gpts_payment_instructions(customer_id,created_at DESC,instruction_id);
        CREATE INDEX IF NOT EXISTS gpts_instruction_owner_idx ON gpts_payment_instructions(beneficiary_id,created_at DESC,instruction_id);
        CREATE TABLE IF NOT EXISTS gpts_payment_events (
          event_id UUID PRIMARY KEY, instruction_id UUID NOT NULL REFERENCES gpts_payment_instructions(instruction_id),
          actor_id TEXT NOT NULL, actor_role TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN('CREATED','CANCELLED')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS gpts_payment_event_instruction_idx ON gpts_payment_events(instruction_id,created_at);
        CREATE OR REPLACE FUNCTION gpts_payment_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'GPTS payment history is permanent'; END $$;
        DROP TRIGGER IF EXISTS gpts_events_immutable ON gpts_payment_events;
        CREATE TRIGGER gpts_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON gpts_payment_events
          FOR EACH STATEMENT EXECUTE FUNCTION gpts_payment_history_guard();
        CREATE OR REPLACE FUNCTION gpts_instruction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF TG_OP='DELETE' THEN RAISE EXCEPTION 'GPTS instructions cannot be deleted'; END IF;
            IF (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at')
              OR NOT(OLD.status='AWAITING_CHANNEL' AND NEW.status='CANCELLED') THEN
              RAISE EXCEPTION 'Invalid GPTS instruction change';
            END IF;
            RETURN NEW;
          END $$;
        DROP TRIGGER IF EXISTS gpts_instructions_immutable ON gpts_payment_instructions;
        CREATE TRIGGER gpts_instructions_immutable BEFORE UPDATE OR DELETE ON gpts_payment_instructions
          FOR EACH ROW EXECUTE FUNCTION gpts_instruction_guard();
        DROP TRIGGER IF EXISTS gpts_instructions_no_truncate ON gpts_payment_instructions;
        CREATE TRIGGER gpts_instructions_no_truncate BEFORE TRUNCATE ON gpts_payment_instructions
          FOR EACH STATEMENT EXECUTE FUNCTION gpts_payment_history_guard();
      `);
      for (const route of corridors) await client.query(
        'INSERT INTO gpts_payment_corridors(corridor_id,origin_country,destination_country) VALUES($1,$2,$3) ON CONFLICT(corridor_id) DO NOTHING',
        [route.id, route.origin, route.destination]);
    }); })().catch(error => { ready = undefined; throw error; });
    return ready;
  }
  const mutations = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
    keyGenerator: req => (req.gptsActor.customer_id?'CUSTOMER:':'BENEFICIARY:')+String(req.gptsActor.customer_id||req.gptsActor.beneficiary_id), message: { ok: false, error: 'Too many changes. Please try again later.' } });
  function route(method, url, founder, handler) {
    const authorize = async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      try {
        const actor = await (founder === true ? getAdmin(req) : founder === 'CUSTOMER' ? getCustomer(req) : getBeneficiary(req));
        if (!actor) return res.status(401).json({ ok: false, error: 'Sign-in is required.' });
        if (founder === true && String(actor.role).toUpperCase() !== 'FOUNDER') return res.status(403).json({ ok: false, error: 'Founder access is required.' });
        req.gptsActor = actor; req.gptsOwnerColumn = founder === 'CUSTOMER' ? 'customer_id' : 'beneficiary_id'; next();
      } catch (error) { next(error); }
    };
    app[method](url, authorize, ...(method === 'post' ? [mutations] : []), async (req, res) => {
      try {
        if (method === 'post' && !req.is('application/json')) throw failure(415, 'Send application/json.');
        await ensureSchema(); await handler(req, res, req.gptsActor);
      } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ ok: false, error: 'Check the instruction details.' });
        if (!error.status) console.error('GPTS payments request failed:', error.code || error.name);
        res.status(error.status || 503).json({ ok: false, error: error.status ? error.message : 'Payments records are temporarily unavailable. Please retry.' });
      }
    });
  }
  async function event(client, id, actor, action) {
    await client.query('INSERT INTO gpts_payment_events(event_id,instruction_id,actor_id,actor_role,action) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), id, String(actor.customer_id||actor.beneficiary_id), actor.customer_id?'CUSTOMER':'BENEFICIARY', action]);
  }
  for(const [base,access] of [['/api/beneficiary/gpts-payments',false],['/api/gpts-payments/customer','CUSTOMER']]){
  route('get', `${base}/overview`, access, async (_req, res) => {
    const { rows } = await query('SELECT corridor_id,origin_country,destination_country,status FROM gpts_payment_corridors ORDER BY corridor_id');
    res.json({ ok: true, companyId: 7, companyName: 'GPTS | Guvaza Pro-Technology Solutions', countries, corridors: rows,
      moneyMovementAvailable: false, status: 'AWAITING_PROVIDER' });
  });
  route('get', `${base}/instructions`, access, async (req, res, actor) => {
    const before = req.query.before ? idInput.parse(req.query.before) : null;
    const { rows } = await query(`SELECT ${fields} FROM gpts_payment_instructions WHERE ${req.gptsOwnerColumn}=$1
      AND ($2::uuid IS NULL OR (created_at,instruction_id)<(SELECT created_at,instruction_id FROM gpts_payment_instructions WHERE instruction_id=$2 AND ${req.gptsOwnerColumn}=$1))
      ORDER BY created_at DESC,instruction_id DESC LIMIT 51`, [String(actor.customer_id||actor.beneficiary_id), before]);
    const items = rows.slice(0, 50); res.json({ ok: true, instructions: items, next: rows.length > 50 ? items.at(-1).instruction_id : null });
  });
  route('post', `${base}/instructions`, access, async (req, res, actor) => {
    const data = instructionInput.parse(req.body), amount = normalizeAmount(data.amount);
    const corridor = corridors.find(item => item.id === data.corridor);
    if (!countries[corridor.origin].currencies.includes(data.currency)) throw failure(400, 'Choose a currency for the sending country.');
    const payload = { corridor: data.corridor, currency: data.currency, amount, recipientName: data.recipientName, payoutMethod: data.payoutMethod, purpose: data.purpose };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const result = await withTransaction(async client => {
      const { rows } = await client.query(`INSERT INTO gpts_payment_instructions(instruction_id,${req.gptsOwnerColumn},client_request_id,payload_hash,corridor_id,currency,amount,recipient_name,payout_method,purpose)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(${req.gptsOwnerColumn},client_request_id) ${actor.customer_id?'WHERE customer_id IS NOT NULL':''} DO NOTHING RETURNING ${fields}`,
        [randomUUID(), String(actor.customer_id||actor.beneficiary_id), data.requestId, hash, data.corridor, data.currency, amount, data.recipientName, data.payoutMethod, data.purpose]);
      if (rows.length) { await event(client, rows[0].instruction_id, actor, 'CREATED'); return { created: true, instruction: rows[0] }; }
      const previous = await client.query(`SELECT ${fields},payload_hash FROM gpts_payment_instructions WHERE ${req.gptsOwnerColumn}=$1 AND client_request_id=$2`, [String(actor.customer_id||actor.beneficiary_id), data.requestId]);
      if (previous.rows[0]?.payload_hash !== hash) throw failure(409, 'This request reference was already used for different details. Start a new instruction.');
      const { payload_hash, ...instruction } = previous.rows[0]; return { created: false, instruction };
    });
    res.status(result.created ? 201 : 200).json({ ok: true, ...result });
  });
  route('post', `${base}/instructions/:id/cancel`, access, async (req, res, actor) => {
    const id = idInput.parse(req.params.id); z.object({}).strict().parse(req.body);
    const instruction = await withTransaction(async client => {
      const { rows } = await client.query(`SELECT ${fields} FROM gpts_payment_instructions WHERE instruction_id=$1 AND ${req.gptsOwnerColumn}=$2 FOR UPDATE`, [id, String(actor.customer_id||actor.beneficiary_id)]);
      if (!rows.length) throw failure(404, 'Instruction not found.');
      if (rows[0].status === 'CANCELLED') return rows[0];
      const updated = await client.query(`UPDATE gpts_payment_instructions SET status='CANCELLED',updated_at=NOW() WHERE instruction_id=$1 RETURNING ${fields}`, [id]);
      await event(client, id, actor, 'CANCELLED'); return updated.rows[0];
    });
    res.json({ ok: true, instruction });
  });
  }
  route('get', '/api/founder/gpts-payments/instructions', true, async (req, res) => {
    const before = req.query.before ? idInput.parse(req.query.before) : null;
    const { rows } = await query(`SELECT ${fields},beneficiary_id,customer_id FROM gpts_payment_instructions
      WHERE ($1::uuid IS NULL OR (created_at,instruction_id)<(SELECT created_at,instruction_id FROM gpts_payment_instructions WHERE instruction_id=$1))
      ORDER BY created_at DESC,instruction_id DESC LIMIT 51`, [before]);
    const items = rows.slice(0, 50); res.json({ ok: true, instructions: items, next: rows.length > 50 ? items.at(-1).instruction_id : null });
  });
  route('get', '/api/founder/gpts-payments/instructions/:id/events', true, async (req, res) => {
    const id = idInput.parse(req.params.id);
    const { rows } = await query('SELECT event_id,instruction_id,actor_id,actor_role,action,created_at FROM gpts_payment_events WHERE instruction_id=$1 ORDER BY created_at,event_id', [id]);
    res.json({ ok: true, events: rows });
  });
  return { ensureSchema };
}

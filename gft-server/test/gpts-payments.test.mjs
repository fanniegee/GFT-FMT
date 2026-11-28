import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { installGptsPayments, normalizeAmount, corridors } from '../src/gpts-payments.js';

test('GPTS instructions preserve ownership, idempotency and atomic audit without moving money', async () => {
  let state = { instructions: [], events: [], corridors: [] }, queue = Promise.resolve(), failAudit = false, failSchema = true;
  const calls = [];
  async function query(sql, args = []) {
    calls.push(sql);
    if (sql.includes('pg_advisory')) return { rows: [] };
    if (sql.includes('CREATE TABLE')) {
      if (failSchema) { failSchema = false; throw Error('Isolated schema outage'); }
      assert.match(sql, /CHECK\(status='AWAITING_PROVIDER'\)/);
      assert.match(sql, /gpts_events_immutable/); assert.match(sql, /gpts_instruction_guard/);
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO gpts_payment_corridors')) { if (!state.corridors.some(row => row.corridor_id === args[0])) state.corridors.push({ corridor_id: args[0], origin_country: args[1], destination_country: args[2], status: 'AWAITING_PROVIDER' }); return { rows: [] }; }
    if (sql.startsWith('SELECT corridor_id')) return { rows: state.corridors };
    if (sql.startsWith('INSERT INTO gpts_payment_instructions')) {
      if (state.instructions.some(row => row.beneficiary_id === args[1] && row.client_request_id === args[2])) return { rows: [] };
      const row = { instruction_id: args[0], beneficiary_id: args[1], client_request_id: args[2], payload_hash: args[3], corridor_id: args[4], currency: args[5], amount: args[6], recipient_name: args[7], payout_method: args[8], purpose: args[9], status: 'AWAITING_CHANNEL', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.instructions.push(row); return { rows: [publicRow(row)] };
    }
    if (sql.startsWith('INSERT INTO gpts_payment_events')) { if (failAudit) throw Error('Isolated audit failure'); state.events.push({ event_id: args[0], instruction_id: args[1], actor_id: args[2], actor_role: args[3], action: args[4] }); return { rows: [] }; }
    if (sql.startsWith('UPDATE gpts_payment_instructions')) { const row = state.instructions.find(row => row.instruction_id === args[0]); row.status = 'CANCELLED'; return { rows: [publicRow(row)] }; }
    if (sql.startsWith('SELECT event_id')) return { rows: state.events.filter(row => row.instruction_id === args[0]) };
    if (sql.startsWith('SELECT instruction_id')) {
      let rows;
      if (sql.includes('client_request_id=$2')) return { rows: state.instructions.filter(row => row.beneficiary_id === args[0] && row.client_request_id === args[1]).map(row => ({ ...publicRow(row), payload_hash: row.payload_hash })) };
      if (sql.includes('FOR UPDATE')) rows = state.instructions.filter(row => row.instruction_id === args[0] && row.beneficiary_id === args[1]);
      else if (sql.includes('WHERE beneficiary_id=$1')) rows = state.instructions.filter(row => row.beneficiary_id === args[0]);
      else rows = state.instructions;
      return { rows: rows.slice(-51).reverse().map(row => ({ ...publicRow(row), ...(sql.includes('fields_unavailable') ? {} : sql.includes(',beneficiary_id FROM') ? { beneficiary_id: row.beneficiary_id } : {}) })) };
    }
    throw Error('Unexpected SQL statement: ' + sql);
  }
  function publicRow(row) { const { beneficiary_id, client_request_id, payload_hash, ...item } = row; return { ...item }; }
  function withTransaction(callback) { const job = queue.then(async () => { const before = structuredClone(state); try { return await callback({ query }); } catch (error) { state = before; throw error; } }); queue = job.catch(() => {}); return job; }
  const app = express(); app.use(express.json());
  installGptsPayments(app, { query, withTransaction,
    getBeneficiary: async req => ['A', 'B'].includes(req.get('x-session')) ? { beneficiary_id: req.get('x-session') } : null,
    getAdmin: async req => ['F', 'D'].includes(req.get('x-session')) ? { admin_id: 'ADMIN', role: req.get('x-session') === 'F' ? 'FOUNDER' : 'SUPER ADMIN' } : null });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (url, session = 'A', body) => fetch(base + url, { headers: { 'x-session': session, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const root = '/api/beneficiary/gpts-payments';
  const create = (body, session) => request(root + '/instructions', session, body);
  const payload = () => ({ requestId: randomUUID(), corridor: 'ZW-ZA', currency: 'USD', amount: '25.50', recipientName: 'Actual recipient entered by customer', payoutMethod: 'BANK', purpose: 'Family support' });
  try {
    assert.equal((await request(root + '/overview', '')).status, 401);
    assert.equal((await request(root + '/overview')).status, 503, 'schema failure is surfaced');
    const overview = await (await request(root + '/overview')).json();
    assert.equal(overview.corridors.length, 8); assert.equal(overview.moneyMovementAvailable, false);
    assert.equal(corridors.length, 8); assert.ok(overview.corridors.every(row => row.status === 'AWAITING_PROVIDER'));
    assert.deepEqual((await (await request(root + '/instructions')).json()).instructions, []);
    for (const amount of ['0', '-1', '1e4', '1.001', 'NaN', '99999999999999999', 12]) assert.throws(() => normalizeAmount(amount));
    assert.equal(normalizeAmount('00025.5'), '25.50'); assert.equal(normalizeAmount('9999999999999999.99'), '9999999999999999.99');
    assert.equal((await create({ ...payload(), status: 'SETTLED' })).status, 400);
    assert.equal((await create({ ...payload(), corridor: 'ZA-BW' })).status, 400);
    assert.equal((await create({ ...payload(), currency: 'ZAR' })).status, 400);
    assert.equal((await create({ ...payload(), amount: '0' })).status, 400);
    failAudit = true; assert.equal((await create(payload())).status, 503); assert.equal(state.instructions.length, 0); assert.equal(state.events.length, 0); failAudit = false;
    const data = payload(); const responses = await Promise.all([create(data), create(data)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
    const created = await responses[0].json(), id = created.instruction.instruction_id;
    assert.equal(state.instructions.length, 1); assert.equal(state.events.length, 1);
    assert.equal(created.instruction.payload_hash, undefined); assert.equal(created.instruction.beneficiary_id, undefined);
    assert.equal((await create({ ...data, amount: '40' })).status, 409);
    assert.equal((await create({ ...data, amount: '25.500' })).status, 400);
    assert.deepEqual((await (await request(root + '/instructions', 'B')).json()).instructions, []);
    assert.equal((await request(root + '/instructions/' + id + '/cancel', 'B', {})).status, 404);
    assert.equal((await request(root + '/instructions/not-a-uuid/cancel', 'A', {})).status, 400);
    failAudit = true; assert.equal((await request(root + '/instructions/' + id + '/cancel', 'A', {})).status, 503); assert.equal(state.instructions[0].status, 'AWAITING_CHANNEL'); failAudit = false;
    assert.equal((await request(root + '/instructions/' + id + '/cancel', 'A', {})).status, 200);
    assert.equal((await request(root + '/instructions/' + id + '/cancel', 'A', {})).status, 200);
    assert.equal(state.events.length, 2, 'repeat cancellation does not duplicate audit');
    const replay = await (await create(data)).json(); assert.equal(replay.instruction.status, 'CANCELLED');
    assert.equal((await request('/api/founder/gpts-payments/instructions', 'A')).status, 401);
    assert.equal((await request('/api/founder/gpts-payments/instructions', 'D')).status, 403);
    assert.equal((await request('/api/founder/gpts-payments/instructions', 'F')).status, 200);
    const events = await (await request('/api/founder/gpts-payments/instructions/' + id + '/events', 'F')).json(); assert.equal(events.events.length, 2);
    assert.equal((await request(root + '/instructions?before=bad')).status, 400);
    assert.equal((await request(root + '/instructions/' + id + '/execute', 'A', {})).status, 404);
    assert.ok(calls.every(sql => !/\b(?:wallets|ledger_entries|payout_requests|configuration)\b/i.test(sql)), 'Trust accounts and balances are never touched');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('payment form retries preserve the same instruction and allow validation corrections', async () => {
  const elements = new Map();
  class Element {
    constructor() { this.children = []; this.value = ''; this.disabled = false; this.textContent = ''; }
    append(...items) { this.children.push(...items); if (!this.value && items[0]?.value) this.value = items[0].value; }
    replaceChildren(...items) { this.children = []; this.value = ''; this.append(...items); }
  }
  for (const id of ['pageStatus', 'instructionList', 'refreshInstructions', 'moreInstructions', 'paymentCorridor', 'paymentCurrency', 'paymentRoutes', 'instructionForm', 'instructionFields', 'newInstruction']) elements.set(id, new Element());
  let form = { corridor: 'ZW-ZA', currency: 'USD', amount: '10', recipientName: 'Recipient', payoutMethod: 'BANK', purpose: '' };
  elements.get('instructionForm').reset = () => {};
  const posts = []; let mode = 'network';
  const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  const context = {
    document: { body: { dataset: { paymentsRole: 'beneficiary' } }, getElementById: id => elements.get(id), createElement: () => new Element() },
    crypto: { randomUUID }, location: { replace() {} }, console,
    Option: class { constructor(label, value) { this.textContent = label; this.value = value; } },
    FormData: class { constructor() { this.items = elements.get('instructionFields').disabled ? [] : Object.entries(form); } [Symbol.iterator]() { return this.items[Symbol.iterator](); } },
    fetch: async (url, options) => {
      if (url.endsWith('/overview')) return response({ ok: true, countries: { ZW: { name: 'Zimbabwe', currencies: ['USD'] }, ZA: { name: 'South Africa' } }, corridors: [{ corridor_id: 'ZW-ZA', origin_country: 'ZW', destination_country: 'ZA' }] });
      if (options?.method === 'POST') {
        const body = JSON.parse(options.body); posts.push(body);
        if (mode === 'network') throw Error('Connection lost');
        if (mode === 'invalid') return response({ ok: false, error: 'Check amount.' }, 400);
        return response({ ok: true, instruction: { instruction_id: randomUUID() } }, 201);
      }
      return response({ ok: true, instructions: [], next: null });
    }
  };
  vm.runInNewContext(await readFile(new URL('../../gpts-payments-client.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const submit = () => elements.get('instructionForm').onsubmit({ preventDefault() {} });
  await submit(); assert.equal(posts[0].amount, '10', 'form details captured before disabling fieldset');
  await submit(); assert.deepEqual(posts[1], posts[0], 'lost response retry has identical request ID and terms');
  form.amount = '20'; await submit(); assert.equal(posts.length, 2, 'edited terms cannot silently reuse uncertain request');
  elements.get('newInstruction').onclick(); mode = 'invalid'; await submit(); const invalidId = posts.at(-1).requestId;
  assert.notEqual(invalidId, posts[0].requestId);
  form.amount = '30'; mode = 'success'; await submit(); assert.equal(posts.at(-1).amount, '30', 'validation rejection permits correction');
  const count = posts.length; await submit(); assert.equal(posts.length, count, 'saved instruction cannot be submitted again');
  assert.match(elements.get('pageStatus').textContent, /already saved/);
});

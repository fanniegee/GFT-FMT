(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const founder = document.body.dataset.paymentsRole === 'founder';
  const customer = document.body.dataset.paymentsRole === 'customer';
  const base = founder ? '/api/founder/gpts-payments' : customer ? '/api/gpts-payments/customer' : '/api/beneficiary/gpts-payments';
  let next = null, loading = false, overview, requestId = crypto.randomUUID(), saved = false, submission = null;
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
  function status(value) { $('pageStatus').textContent = value; }
  async function api(path, options = {}) {
    const response = await fetch(base + path, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (!customer && response.status === 401) throw Error('Please sign in again to continue.');
    if (customer && response.status === 401) { location.replace('gpts-customer-access.html'); throw Error('Please sign in.'); }
    if (response.status === 423) { location.replace('beneficiary-wallet-login.html'); throw Error('Unlock your wallet to continue.'); }
    const data = await response.json();
    if (!response.ok || !data.ok) throw Object.assign(Error(data.error || 'Unable to load payment records.'), { status: response.status });
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  function render(item) {
    const card = text('article', '', 'instruction');
    card.append(text('h3', item.recipient_name), text('span', item.status === 'CANCELLED' ? 'Cancelled' : 'Awaiting channel', 'badge'));
    card.append(text('p', `${item.currency.trim()} ${item.amount} · ${item.corridor_id.replace('-', ' → ')}`));
    card.append(text('p', item.payout_method === 'BANK' ? 'Bank account' : 'Mobile wallet'));
    if (item.purpose) card.append(text('p', item.purpose));
    card.append(text('p', 'Reference: ' + item.instruction_id, 'caption'), text('p', new Date(item.created_at).toLocaleString(), 'caption'));
    if (founder) {
      card.append(text('p', (item.customer_id?'GPTS customer: ':'Beneficiary record: ') + (item.customer_id||item.beneficiary_id), 'caption'));
      const button = text('button', 'View audit history'); button.type = 'button'; button.className = 'secondary';
      const history = text('div', '');
      button.onclick = async () => { button.disabled = true; try { const data = await api('/instructions/' + item.instruction_id + '/events'); history.replaceChildren(...data.events.map(event => text('p', `${new Date(event.created_at).toLocaleString()} · ${event.action} · ${event.actor_role} ${event.actor_id}`, 'caption'))); if (!data.events.length) history.textContent = 'No events recorded.'; } catch (error) { status(error.message); } finally { button.disabled = false; } };
      card.append(button, history);
    } else if (item.status === 'AWAITING_CHANNEL') {
      const button = text('button', 'Cancel instruction'); button.type = 'button'; button.className = 'secondary';
      button.onclick = async () => { button.disabled = true; try { await post('/instructions/' + item.instruction_id + '/cancel', {}); status('Instruction cancelled. No funds were moved.'); await load(); } catch (error) { status(error.message); } finally { button.disabled = false; } };
      card.append(button);
    }
    return card;
  }
  async function load(append = false) {
    if (loading) return; loading = true; $('refreshInstructions').disabled = $('moreInstructions').disabled = true;
    try {
      const data = await api('/instructions' + (append && next ? '?before=' + encodeURIComponent(next) : ''));
      if (!append) $('instructionList').replaceChildren();
      if (!append && !data.instructions.length) $('instructionList').append(text('p', 'No transfer instructions have been recorded.'));
      for (const item of data.instructions) $('instructionList').append(render(item));
      next = data.next; $('moreInstructions').hidden = !next;
    } catch (error) { status(error.message); } finally { loading = false; $('refreshInstructions').disabled = $('moreInstructions').disabled = false; }
  }
  $('refreshInstructions').onclick = () => load(); $('moreInstructions').onclick = () => load(true);
  if (!founder) {
    function currencies() {
      const origin = $('paymentCorridor').value.split('-')[0];
      $('paymentCurrency').replaceChildren(...overview.countries[origin].currencies.map(code => new Option(code, code)));
    }
    $('paymentCorridor').onchange = currencies;
    $('newInstruction').onclick = () => { $('instructionForm').reset(); currencies(); requestId = crypto.randomUUID(); saved = false; submission = null; status('Ready for a new instruction.'); };
    $('instructionForm').onsubmit = async event => {
      event.preventDefault(); if (saved) { status('This instruction is already saved. Choose Start another for a new instruction.'); return; }
      const current = { ...Object.fromEntries(new FormData($('instructionForm'))), requestId };
      if (submission && JSON.stringify(submission) !== JSON.stringify(current)) { status('The previous instruction may already be saved. Refresh your instructions to check, or retry its original details. Choose Start another to enter different details.'); return; }
      submission ??= current;
      const fields = $('instructionFields'); fields.disabled = true;
      try {
        // Keep the exact payload and id after a lost response so retry cannot duplicate it.
        const result = await post('/instructions', submission); saved = true;
        status('Instruction saved: ' + result.instruction.instruction_id + '. Awaiting channel; no funds moved.'); await load();
      } catch (error) { if (error.status === 400 || error.status === 415) submission = null; status(error.message); } finally { fields.disabled = false; }
    };
    (async () => { try {
      overview = await api('/overview');
      for (const route of overview.corridors) {
        const label = `${overview.countries[route.origin_country.trim()].name} → ${overview.countries[route.destination_country.trim()].name}`;
        const card = text('div', '', 'route'); card.append(text('strong', label), text('div', 'Awaiting provider connection', 'caption')); $('paymentRoutes').append(card);
        $('paymentCorridor').append(new Option(label, route.corridor_id));
      }
      currencies(); $('instructionFields').disabled = false; await load();
    } catch (error) { status(error.message); } })();
  } else load();
})();

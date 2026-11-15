import { randomBytes } from 'node:crypto';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const money = /^\d{1,16}(?:\.\d{1,2})?$/;
const cents = value => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
const amount = value => (value / 100n) + '.' + String(value % 100n).padStart(2, '0');

export function installCompanyContributions(app, { query, withTransaction, requireAdmin }) {
  const base = '/api/admin/company-contributions';
  const founder = admin => String(admin.role).toUpperCase() === 'FOUNDER';
  const auditor = admin => !founder(admin) && Array.isArray(admin.deployment?.permissions)
    && admin.deployment.permissions.includes('audit:verify');
  const accounts = (admin, company) => !founder(admin) && company.details?.trustAccountsAdminId === admin.admin_id;
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

  const endpoint = action => [requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (req.method === 'POST' && !req.is('application/json')) fail(415, 'Expected JSON.');
      const result = await action(req);
      return res.json(result);
    } catch (error) {
      if (!error.status) console.error('Company contribution failed', error.code || error.name);
      if (error.code === '23505') return res.status(409).json({ error: 'This record already exists.' });
      return res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to complete the contribution action.' });
    }
  }];

  async function audit(client, admin, event, details) {
    await client.query(
      'INSERT INTO gft_admin_audit_events (event_id,admin_id,admin_email,action,details) VALUES ($1,$2,$3,$4,$5::jsonb)',
      ['AUD-' + randomBytes(16).toString('hex'), admin.admin_id, admin.email, event, JSON.stringify(details)]
    );
  }

  async function company(client, id) {
    if (!uuid.test(id)) fail(400, 'Choose an active company.');
    const { rows } = await client.query("SELECT company_id,system_id,name,details FROM companies WHERE company_id=$1 AND UPPER(status)='ACTIVE' FOR UPDATE", [id]);
    if (!rows.length) fail(404, 'Company unavailable.');
    return rows[0];
  }

  app.get(base, ...endpoint(async req => {
    const admin = req.admin;
    const { rows } = await query(
      "SELECT company_id,name,details FROM companies WHERE UPPER(status)='ACTIVE' ORDER BY name,company_id"
    );
    const visible = rows.filter(row => founder(admin) || auditor(admin) || accounts(admin,row));
    if (!visible.length && !founder(admin) && !auditor(admin)) fail(403, 'Company contribution access required.');
    const ids = visible.map(row => row.company_id);
    const reports = ids.length ? (await query(
      "SELECT workflow_id,status,subject FROM workflows WHERE workflow_type='COMPANY_CONTRIBUTION' AND subject->>'companyId'=ANY($1::text[]) ORDER BY created_at DESC LIMIT 100",
      [ids]
    )).rows : [];
    return {
      founder: founder(admin), auditor: auditor(admin),
      companies: visible.map(row => ({ id:row.company_id, name:row.name, accounts:accounts(admin,row),
        rate:row.details?.trustContributionPercent ?? null,
        ...(founder(admin) ? { accountsId:row.details?.trustAccountsAdminId ?? null } : {}) })),
      reports: reports.map(row => ({ id:row.workflow_id,status:row.status,companyId:row.subject.companyId,
        month:row.subject.month,profit:row.subject.profit,rate:row.subject.rate,
        contribution:row.subject.contribution,evidence:row.subject.evidence,
        canVerify:auditor(admin) && row.status==='OPEN' && admin.admin_id!==row.subject.submittedBy }))
    };
  }));

  app.post(base + '/companies', ...endpoint(async req => {
    if (!founder(req.admin)) fail(403, 'Founder authority is required.');
    const name=typeof req.body?.name==='string' ? req.body.name.trim() : '';
    const systemId=typeof req.body?.systemId==='string' ? req.body.systemId.trim().toUpperCase() : '';
    if (!name || name.length>180 || !/^GFT-CO-[A-Z0-9-]{1,60}$/.test(systemId)) {
      fail(400,'Enter the registered company name and its GFT-CO- identifier.');
    }
    return withTransaction(async client=>{
      const {rows:[saved]}=await client.query(
        'INSERT INTO companies (name,system_id) VALUES ($1,$2) RETURNING company_id',
        [name,systemId]
      );
      await audit(client,req.admin,'COMPANY_REGISTERED_FOR_CONTRIBUTIONS',{companyId:saved.company_id,systemId});
      return {ok:true};
    });
  }));

  app.post(base + '/companies/:id/settings', ...endpoint(async req => {
    if (!founder(req.admin)) fail(403, 'Founder authority is required.');
    const { rate, accountsId } = req.body || {};
    if (typeof rate!=='string' || !money.test(rate) || cents(rate)>10000n ||
        typeof accountsId!=='string' || !accountsId.trim() || accountsId.length>180) fail(400,'Enter a percentage from 0 to 100 and an Accounts Admin ID.');
    return withTransaction(async client => {
      const row=await company(client,req.params.id);
      const delegate=await client.query("SELECT 1 FROM gft_admin_accounts WHERE admin_id=$1 AND active AND UPPER(status)='ACTIVE' AND UPPER(role)<>'FOUNDER'",[accountsId.trim()]);
      if (!delegate.rows.length) fail(400,'Choose an active Trust Admin account for company Accounts.');
      const details={...row.details,trustContributionPercent:rate,trustAccountsAdminId:accountsId.trim()};
      await client.query('UPDATE companies SET details=$1::jsonb WHERE company_id=$2',[JSON.stringify(details),row.company_id]);
      await audit(client,req.admin,'COMPANY_CONTRIBUTION_SETTINGS_UPDATED',{companyId:row.company_id,rate,accountsId:accountsId.trim()});
      return {ok:true};
    });
  }));

  app.post(base + '/companies/:id/reports', ...endpoint(async req => {
    const { month, profit, evidence } = req.body || {};
    if (typeof month!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
        typeof profit!=='string' || !/^-?\d{1,16}(?:\.\d{1,2})?$/.test(profit) ||
        typeof evidence!=='string' || evidence.trim().length<5 || evidence.length>500) {
      fail(400,'Enter a reporting month, USD net profit and a financial statement reference.');
    }
    return withTransaction(async client => {
      const row=await company(client,req.params.id);
      if (!accounts(req.admin,row)) fail(403,'Only this company’s Accounts Admin can submit a report.');
      const rate=row.details?.trustContributionPercent;
      if (typeof rate!=='string' || !money.test(rate) || cents(rate)>10000n) fail(409,'The company contribution percentage must be configured first.');
      const existing=await client.query("SELECT 1 FROM workflows WHERE workflow_type='COMPANY_CONTRIBUTION' AND subject->>'companyId'=$1 AND subject->>'month'=$2 AND status<>'REJECTED'",[row.company_id,month]);
      if (existing.rows.length) fail(409,'This company already has a report for that month.');
      const {rows:[calendar]}=await client.query("SELECT to_char(NOW() AT TIME ZONE 'Africa/Johannesburg','YYYY-MM') AS month");
      if (month>=calendar.month) fail(400,'Choose a completed reporting month.');
      const contribution=amount(profit.startsWith('-') ? 0n : cents(profit)*cents(rate)/10000n);
      const subject={companyId:row.company_id,month,profit,rate,contribution,evidence:evidence.trim(),submittedBy:req.admin.admin_id};
      const {rows:[saved]}=await client.query("INSERT INTO workflows (workflow_type,subject) VALUES ('COMPANY_CONTRIBUTION',$1::jsonb) RETURNING workflow_id",[JSON.stringify(subject)]);
      await audit(client,req.admin,'COMPANY_PROFIT_REPORT_SUBMITTED',{workflowId:saved.workflow_id,companyId:row.company_id,month});
      return {ok:true};
    });
  }));

  app.post(base + '/reports/:id/:action', ...endpoint(async req => {
    const { id, action }=req.params;
    if (!uuid.test(id) || !['verify','approve','reject','post'].includes(action)) fail(404,'Unknown contribution action.');
    const reason=typeof req.body?.reason==='string' ? req.body.reason.trim() : '';
    if (reason.length<5 || reason.length>500) fail(400,'Record a reason of 5 to 500 characters.');
    return withTransaction(async client => {
      const {rows:[report]}=await client.query("SELECT subject,status FROM workflows WHERE workflow_id=$1 AND workflow_type='COMPANY_CONTRIBUTION' FOR UPDATE",[id]);
      if (!report) fail(404,'Report unavailable.');
      const subject=report.subject;
      const row=await company(client,subject.companyId);
      let status;
      if (action==='verify' || action==='reject') {
        if (!auditor(req.admin) || accounts(req.admin,row) || req.admin.admin_id===subject.submittedBy) fail(403,'An independent Trust auditor is required.');
        if (report.status!=='OPEN') fail(409,'The report has already been reviewed.');
        status=action==='verify'?'AUDIT_VERIFIED':'REJECTED';
        subject.auditBy=req.admin.admin_id;
        // Rejected reports remain in the audit history and can be corrected by submitting a replacement.
      } else if (action==='approve') {
        if (!accounts(req.admin,row) || req.admin.admin_id===subject.auditBy) fail(403,'The company Accounts Admin must approve independently.');
        if (report.status!=='AUDIT_VERIFIED') fail(409,'Trust Audit must verify this profit first.');
        status='APPROVED';
        subject.accountsApprovedBy=req.admin.admin_id;
      } else {
        if (!founder(req.admin)) fail(403,'Founder authority is required.');
        if (report.status!=='APPROVED') fail(409,'Company Accounts approval is required before posting.');
        if (cents(subject.contribution)>0n) {
          const trustId=String(process.env.GFT_WALLET_MAIN_ID || '').trim();
          if (!uuid.test(trustId) || !row.system_id) fail(409,'Assign the company and main Trust wallets before posting.');
          const {rows:wallets}=await client.query(
            "SELECT wallet_id,owner_system_id FROM wallets w WHERE (wallet_id=$1 OR owner_system_id=$2) AND UPPER(status)='ACTIVE' AND TRIM(currency)='USD' AND NOT EXISTS(SELECT 1 FROM beneficiaries b WHERE b.system_id=w.owner_system_id) ORDER BY wallet_id FOR UPDATE",
            [trustId,row.system_id]
          );
          const trust=wallets.find(wallet=>wallet.wallet_id===trustId.toLowerCase());
          const sources=wallets.filter(wallet=>wallet.owner_system_id===row.system_id);
          if (!trust || sources.length!==1 || sources[0].wallet_id===trust.wallet_id) fail(409,'One distinct active USD company wallet and main Trust wallet are required.');
          const source=sources[0].wallet_id;
          const {rows:[balance]}=await client.query(
            "SELECT SUM(CASE WHEN UPPER(TRIM(entry_type)) IN ('CREDIT','DEPOSIT') THEN amount WHEN UPPER(TRIM(entry_type)) IN ('DEBIT','WITHDRAWAL') THEN -amount END) >= $2::numeric AS sufficient FROM ledger_entries WHERE wallet_id=$1 AND TRIM(currency)='USD'",
            [source,subject.contribution]
          );
          if (!balance.sufficient) fail(409,'The company wallet lacks sufficient recorded USD funds.');
          await client.query(
            "INSERT INTO ledger_entries(wallet_id,entry_type,amount,currency,reference) VALUES($1,'DEBIT',$3,'USD',$4),($2,'CREDIT',$3,'USD',$4)",
            [source,trust.wallet_id,subject.contribution,'company-contribution:'+id.toLowerCase()]
          );
        }
        status='EXECUTED';
      }
      await client.query('UPDATE workflows SET status=$1,subject=$2::jsonb,updated_at=NOW() WHERE workflow_id=$3',[status,JSON.stringify(subject),id]);
      await audit(client,req.admin,'COMPANY_CONTRIBUTION_'+status,{workflowId:id,companyId:row.company_id,month:subject.month,reason});
      return {ok:true,status};
    });
  }));
}


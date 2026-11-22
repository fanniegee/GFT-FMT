import { randomBytes } from 'node:crypto';

export function installPayoutAccounting(app, { withTransaction, requireAdmin, ensureTransfers }) {
  const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  app.post('/api/founder/payout-requests/:id/:action', requireAdmin, async(req,res)=>{
    if (String(req.admin.role).toUpperCase()!=='FOUNDER') return res.sendStatus(403);
    const {id,action}=req.params;
    if (!uuid.test(id) || !['authorize','settle','cancel'].includes(action)) return res.sendStatus(404);
    if (!req.is('application/json')) return res.sendStatus(415);
    const note=typeof req.body?.note==='string'?req.body.note.trim():'';
    if (note.length<5 || note.length>180) return res.status(400).json({error:'Enter a reference or reason of 5 to 180 characters.'});
    try {
      await ensureTransfers();
      const status=await withTransaction(async client=>{
        const target=await client.query(
          "SELECT wallet_id FROM payout_requests WHERE payout_id=$1",[id]
        );
        if (!target.rows[0]?.wallet_id) fail(404,'Payout request unavailable.');
        const walletId=target.rows[0].wallet_id;
        const locked=await client.query(
          "SELECT w.wallet_id FROM wallets w JOIN beneficiaries b ON b.system_id=w.owner_system_id WHERE w.wallet_id=$1 AND TRIM(w.currency)='USD' AND UPPER(w.status)='ACTIVE' AND UPPER(b.status)='ACTIVE' FOR UPDATE OF w",
          [walletId]
        );
        if (!locked.rows.length && action!=='cancel') fail(409,'The beneficiary’s USD wallet is unavailable.');
        const {rows:[payout]}=await client.query(
          "SELECT amount,status,destination FROM payout_requests WHERE payout_id=$1 AND wallet_id=$2 AND TRIM(currency)='USD' FOR UPDATE",
          [id,walletId]
        );
        if (!payout) fail(404,'Payout request unavailable.');
        const expected=action==='authorize'?'REVIEWED':'AUTHORIZED';
        if (payout.status!==expected) fail(409,'This request is no longer in the required state.');
        const status=action==='authorize'?'AUTHORIZED':action==='settle'?'PAID':'CANCELLED';
        if (action!=='cancel') {
          if (!['Bank','Ecocash','MobileMoney','EWallet'].includes(payout.destination?.method) || !(uuid.test(payout.destination?.cashoutId || '') || uuid.test(payout.destination?.paymentMethodId || ''))) {
            fail(409,'The beneficiary must submit a payout with a recorded payment destination.');
          }
          const {rows:[funds]}=await client.query(
            "SELECT COALESCE((SELECT SUM(CASE WHEN UPPER(TRIM(entry_type)) IN ('CREDIT','DEPOSIT') THEN amount WHEN UPPER(TRIM(entry_type)) IN ('DEBIT','WITHDRAWAL') THEN -amount END) FROM ledger_entries WHERE wallet_id=$1 AND TRIM(currency)='USD'),0) >= $2::numeric + COALESCE((SELECT SUM(amount) FROM payout_requests WHERE wallet_id=$1 AND TRIM(currency)='USD' AND status='AUTHORIZED' AND payout_id<>$3),0) + COALESCE((SELECT SUM(amount) FROM beneficiary_transfers WHERE source_wallet_id=$1 AND status='AUTHORIZED'),0) AS sufficient",
            [walletId,payout.amount,id]
          );
          if (!funds.sufficient) fail(409,'The wallet lacks available funds after existing authorizations.');
        }
        if (action==='settle') {
          const reference='beneficiary-payout:'+note.toUpperCase();
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[reference]);
          const duplicate=await client.query('SELECT 1 FROM ledger_entries WHERE reference=$1 LIMIT 1',[reference]);
          if (duplicate.rows.length) fail(409,'This external payment reference is already recorded.');
          await client.query(
            "INSERT INTO ledger_entries (wallet_id,entry_type,amount,currency,reference,metadata) VALUES ($1,'DEBIT',$2,'USD',$3,jsonb_build_object('payoutId',$4::text))",
            [walletId,payout.amount,reference,id]
          );
        }
        await client.query('UPDATE payout_requests SET status=$1,decided_at=NOW() WHERE payout_id=$2',[status,id]);
        await client.query(
          'INSERT INTO gft_admin_audit_events (event_id,admin_id,admin_email,action,details) VALUES ($1,$2,$3,$4,$5::jsonb)',
          ['AUD-'+randomBytes(16).toString('hex'),req.admin.admin_id,req.admin.email,'PAYOUT_REQUEST_'+status,JSON.stringify({payoutId:id,note})]
        );
        return status;
      });
      return res.json({ok:true,status});
    }catch(error){
      if(!error.status) console.error('Payout accounting failed',error.code || error.name);
      return res.status(error.status || 500).json({error:error.status?error.message:'Unable to record the payout action.'});
    }
  });
}


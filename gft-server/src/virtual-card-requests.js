import { randomBytes } from 'node:crypto';

export function installVirtualCardRequests(app,{query,withTransaction,getAuthenticatedBeneficiary,requireAdmin}){
  const service='virtual_card';
  const active=async (req,res,handler)=>{
    res.set('Cache-Control','no-store');
    if(req.method==='POST' && !req.is('application/json')) return res.sendStatus(415);
    try{
      const beneficiary=await getAuthenticatedBeneficiary(req);
      if(!beneficiary) return res.sendStatus(401);
      return await handler(beneficiary.system_id);
    }catch(error){
      console.error('Virtual card request failed',error.code || error.name);
      return res.status(500).json({error:'Unable to load or save the virtual card application.'});
    }
  };

  async function latest(runQuery,id){
    const {rows}=await runQuery('SELECT request_id,status,created_at FROM service_requests WHERE service_id=$1 AND subject_system_id=$2 ORDER BY created_at DESC,request_id DESC LIMIT 1',[service,id]);
    return rows[0] || null;
  }

  app.get('/api/beneficiary/virtual-card-application',(req,res)=>active(req,res,async id=>
    res.json({application:await latest(query,id)})
  ));

  app.post('/api/beneficiary/virtual-card-application',(req,res)=>active(req,res,async id=>{
    const application=await withTransaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['virtual-card:'+id]);
      const existing=await latest(client.query.bind(client),id);
      if(existing && existing.status!=='REJECTED') return existing;
      const {rows}=await client.query(
        "INSERT INTO service_requests(service_id,subject_system_id,status) VALUES($1,$2,'PENDING_REVIEW') RETURNING request_id,status,created_at",
        [service,id]
      );
      return rows[0];
    });
    return res.json({application});
  }));

  function founder(handler){
    return [requireAdmin,async(req,res)=>{
      res.set('Cache-Control','no-store');
      if(String(req.admin.role).toUpperCase()!=='FOUNDER') return res.sendStatus(403);
      try{return await handler(req,res);}
      catch(error){
        console.error('Virtual card review failed',error.code || error.name);
        return res.status(500).json({error:'Unable to complete the virtual card review.'});
      }
    }];
  }

  app.get('/api/founder/virtual-card-applications',...founder(async(_req,res)=>{
    const {rows}=await query('SELECT request_id,subject_system_id,status,created_at FROM service_requests WHERE service_id=$1 ORDER BY created_at DESC,request_id DESC LIMIT 100',[service]);
    return res.json({applications:rows});
  }));

  app.post('/api/founder/virtual-card-applications/:id/decision',...founder(async(req,res)=>{
    if(!req.is('application/json')) return res.sendStatus(415);
    const {id}=req.params;
    const status=req.body?.decision;
    const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
    if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) ||
       !['APPROVED','REJECTED'].includes(status) || reason.length<5 || reason.length>500) return res.sendStatus(400);
    const changed=await withTransaction(async client=>{
      const result=await client.query("UPDATE service_requests SET status=$1 WHERE request_id=$2 AND service_id=$3 AND status='PENDING_REVIEW' RETURNING request_id",[status,id,service]);
      if(!result.rows.length) return false;
      await client.query('INSERT INTO gft_admin_audit_events(event_id,admin_id,admin_email,action,details) VALUES($1,$2,$3,$4,$5::jsonb)',
        ['AUD-'+randomBytes(16).toString('hex'),req.admin.admin_id,req.admin.email,'VIRTUAL_CARD_APPLICATION_'+status,JSON.stringify({requestId:id,reason})]);
      return true;
    });
    return changed ? res.json({ok:true}) : res.status(409).json({error:'This application is no longer pending.'});
  }));
}


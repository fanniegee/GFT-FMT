import { randomBytes } from 'node:crypto';

export function installFamilyCorrections(app,{query,withTransaction,requireAdmin}) {
  const base='/api/admin/family-corrections';
  const founder=admin=>String(admin.role).toUpperCase()==='FOUNDER';
  const canRequest=admin=>founder(admin) || (Array.isArray(admin.deployment?.permissions)
    && admin.deployment.permissions.includes('familyRoot:edit'));
  const familyId=/^GFT-GEN\d+-[0-9]+$/;
  const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};

  const route=(method,path,handler)=>{
    app[method](base+path,requireAdmin,async(req,res)=>{
      res.set('Cache-Control','no-store');
      if(!canRequest(req.admin)) return res.sendStatus(403);
      if(method==='post' && !req.is('application/json')) return res.sendStatus(415);
      try {return res.json(await handler(req));}
      catch(error){
        if(!error.status) console.error('Family correction failed',error.code || error.name);
        return res.status(error.status || 500).json({error:error.status?error.message:'Unable to complete the family correction.'});
      }
    });
  };

  function audit(client,admin,event,details){
    return client.query(
      'INSERT INTO gft_admin_audit_events (event_id,admin_id,admin_email,action,details) VALUES ($1,$2,$3,$4,$5::jsonb)',
      ['AUD-'+randomBytes(16).toString('hex'),admin.admin_id,admin.email,event,JSON.stringify(details)]
    );
  }

  async function loadTarget(client,id){
    const {rows:[target]}=await client.query(
      'SELECT system_id,full_name,parent_system_id,generation,branch_code,updated_at FROM family_people WHERE system_id=$1 FOR UPDATE',[id]
    );
    if(!target) fail(404,'The GFT family record was not found.');
    return target;
  }

  async function checkParent(client,target,parentId){
    if(parentId===target.parent_system_id) return target.branch_code;
    if(!parentId || parentId===target.system_id || target.system_id==='GFT-GEN1-01') fail(409,'This parent change would break the official tree.');
    const {rows:[parent]}=await client.query(
      "SELECT generation,branch_code FROM family_people WHERE system_id=$1 AND profile->>'isPlaceholder' IS DISTINCT FROM 'true' FOR UPDATE",[parentId]
    );
    if(!parent || !Number.isInteger(target.generation) || parent.generation!==target.generation-1 || !parent.branch_code)
      fail(409,'The new parent must be verified and in the immediately preceding generation. Permanent GFT IDs are preserved.');
    const cycle=await client.query(
      'WITH RECURSIVE ancestors AS (SELECT system_id,parent_system_id FROM family_people WHERE system_id=$1 UNION SELECT p.system_id,p.parent_system_id FROM family_people p JOIN ancestors a ON p.system_id=a.parent_system_id) SELECT 1 FROM ancestors WHERE system_id=$2',
      [parentId,target.system_id]
    );
    if(cycle.rows.length) fail(409,'A descendant cannot become an ancestor of their own record.');
    return parent.branch_code;
  }

  route('get','/people',async req=>{
    const term=typeof req.query.q==='string'?req.query.q.trim():'';
    if(term.length<3 || term.length>100) fail(400,'Enter 3 to 100 characters of a name or GFT ID.');
    const {rows}=await query(
      'SELECT system_id,full_name,parent_system_id,generation,branch_code FROM family_people WHERE STRPOS(LOWER(full_name),LOWER($1))>0 OR STRPOS(LOWER(system_id),LOWER($1))>0 ORDER BY full_name,system_id LIMIT 50',
      [term]
    );
    return {people:rows};
  });

  route('get','',async req=>{
    const {rows}=await query(
      "SELECT correction_id,target_system_id,reason,status,created_at,requested_changes FROM correction_requests WHERE requested_changes->>'kind'='OFFICIAL_FAMILY_CORRECTION' AND ($1::boolean OR requested_changes->>'submittedBy'=$2) ORDER BY created_at DESC,correction_id LIMIT 100",
      [founder(req.admin),req.admin.admin_id]
    );
    return {canDecide:founder(req.admin),requests:rows};
  });

  route('post','',async req=>{
    const {systemId,fullName,parentId,reason}=req.body || {};
    if(!familyId.test(systemId) || typeof fullName!=='string' || fullName.trim().length<2 || fullName.length>180 ||
       (parentId!==null && !familyId.test(parentId)) || typeof reason!=='string' || reason.trim().length<5 || reason.length>500){
      fail(400,'Enter the official GFT ID, corrected name, parent GFT ID and reason.');
    }
    return withTransaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gft-family-correction'))");
      const target=await loadTarget(client,systemId);
      await checkParent(client,target,parentId);
      const changes={kind:'OFFICIAL_FAMILY_CORRECTION',fullName:fullName.trim(),parentId,submittedBy:req.admin.admin_id,
        snapshot:new Date(target.updated_at).toISOString()};
      if(changes.fullName===target.full_name && parentId===target.parent_system_id) fail(400,'Enter a change to the official record.');
      const pending=await client.query(
        "SELECT 1 FROM correction_requests WHERE target_system_id=$1 AND status='PENDING_REVIEW' AND requested_changes->>'kind'='OFFICIAL_FAMILY_CORRECTION' LIMIT 1",[systemId]
      );
      if(pending.rows.length) fail(409,'A correction for this record is already pending.');
      const {rows:[saved]}=await client.query(
        'INSERT INTO correction_requests(target_system_id,requested_changes,reason) VALUES($1,$2::jsonb,$3) RETURNING correction_id',
        [systemId,JSON.stringify(changes),reason.trim()]
      );
      await audit(client,req.admin,'FAMILY_CORRECTION_REQUESTED',{correctionId:saved.correction_id,systemId});
      return {id:saved.correction_id};
    });
  });

  route('post','/:id/decision',async req=>{
    if(!founder(req.admin)) fail(403,'Founder authority is required.');
    const {id}=req.params;
    const {decision,reason}=req.body || {};
    if(!uuid.test(id) || !['APPROVED','REJECTED'].includes(decision) ||
       typeof reason!=='string' || reason.trim().length<5 || reason.length>500) fail(400,'Enter a valid decision and reason.');
    return withTransaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gft-family-correction'))");
      const {rows:[request]}=await client.query(
        "SELECT target_system_id,requested_changes,status FROM correction_requests WHERE correction_id=$1 AND requested_changes->>'kind'='OFFICIAL_FAMILY_CORRECTION' FOR UPDATE",[id]
      );
      if(!request || request.status!=='PENDING_REVIEW') fail(409,'The correction is no longer pending.');
      if(decision==='APPROVED'){
        const target=await loadTarget(client,request.target_system_id);
        const changes=request.requested_changes;
        if(new Date(target.updated_at).toISOString()!==changes.snapshot) fail(409,'The official record changed since submission. Reject and request the correction again.');
        const branch=await checkParent(client,target,changes.parentId);
        await client.query('UPDATE family_people SET full_name=$1,parent_system_id=$2,branch_code=$3,updated_at=NOW() WHERE system_id=$4',
          [changes.fullName,changes.parentId,branch,target.system_id]);
        if(branch!==target.branch_code){
          await client.query(
            'WITH RECURSIVE children AS (SELECT system_id FROM family_people WHERE parent_system_id=$1 UNION SELECT p.system_id FROM family_people p JOIN children c ON p.parent_system_id=c.system_id) UPDATE family_people SET branch_code=$2,updated_at=NOW() WHERE system_id IN (SELECT system_id FROM children)',
            [target.system_id,branch]
          );
        }
        if(changes.fullName!==target.full_name){
          await client.query('UPDATE beneficiaries SET full_name=$1,updated_at=NOW() WHERE system_id=$2',[changes.fullName,target.system_id]);
        }
      }
      await client.query('UPDATE correction_requests SET status=$1,reviewed_at=NOW() WHERE correction_id=$2',[decision,id]);
      await audit(client,req.admin,'FAMILY_CORRECTION_'+decision,{correctionId:id,systemId:request.target_system_id,reason:reason.trim()});
      return {ok:true};
    });
  });
}


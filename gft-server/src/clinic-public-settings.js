export const clinicContactFields = ['phone','email','whatsapp','address','hours'];
export function canEditClinicContact(admin, staff) {
  const permissions = admin?.deployment?.permissions || admin?.permissions || [];
  return String(admin?.role||'').toUpperCase()==='FOUNDER' ||
    (Array.isArray(permissions) && (permissions.includes('clinic:edit') || ['homeEdit:edit','aboutEdit:edit','familyRoot:edit','companies:edit'].every(key=>permissions.includes(key)))) ||
    ['GGC_SUPER_ADMIN','CLINIC_ADMIN'].includes(staff?.role) ||
    (Array.isArray(staff?.permissions) && staff.permissions.includes('EDIT_PUBLIC_SETTINGS'));
}
export function validateClinicContact(value) {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Contact details are required.');
  const result={};
  for(const field of clinicContactFields) {
    if(value[field]!==undefined && typeof value[field]!=='string') throw new Error('Contact fields must be text.');
    result[field]=(value[field]||'').trim();
    if(result[field].length>(field==='address'||field==='hours'?600:254)) throw new Error('A contact field is too long.');
  }
  if(result.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.email)) throw new Error('Enter a valid email address.');
  for(const field of ['phone','whatsapp']) if(result[field]&&!/^[+\d\s().-]{5,40}$/.test(result[field])) throw new Error('Use a valid phone number with country code.');
  return result;
}
export function installClinicPublicSettings(app,{query,withTransaction,getAuthenticatedAdmin,getAuthenticatedClinicStaff}) {
  let ready;
  function schema(){
    if(!ready) ready=query(`CREATE TABLE IF NOT EXISTS clinic_public_contact (id INTEGER PRIMARY KEY CHECK(id=1), details JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS clinic_public_contact_audit (id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, previous_details JSONB NOT NULL, details JSONB NOT NULL, version INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`).catch(error=>{ready=null;throw error;});
    return ready;
  }
  async function authority(req,res){
    const [admin,staff]=await Promise.all([getAuthenticatedAdmin(req),getAuthenticatedClinicStaff(req)]);
    if(!admin&&!staff){res.status(401).json({ok:false,error:'Sign in as Founder or an authorised Admin.'});return null;}
    if(!canEditClinicContact(admin,staff)){res.status(403).json({ok:false,error:'Clinic contact editing authority is required.'});return null;}
    return admin && canEditClinicContact(admin,null)?{id:admin.admin_id,role:admin.role}:{id:staff.staff_id,role:staff.role};
  }
  app.get('/api/clinic/public/contact',async(_req,res,next)=>{
    try{await schema();const {rows}=await query('SELECT details,version FROM clinic_public_contact WHERE id=1');res.set('Cache-Control','no-store').json({ok:true,contact:rows[0]?.details||{},version:rows[0]?.version||0});}catch(error){next(error);}
  });
  app.get('/api/clinic/public/contact/authority',async(req,res,next)=>{try{if(await authority(req,res))res.set('Cache-Control','no-store').json({ok:true,canEdit:true});}catch(error){next(error);}});
  app.put('/api/clinic/public/contact',async(req,res,next)=>{
    try{
      const actor=await authority(req,res);if(!actor)return;
      let details;try{details=validateClinicContact(req.body?.contact);}catch(error){return res.status(400).json({ok:false,error:error.message});}
      const version=req.body?.version;
      if(!Number.isInteger(version)||version<0)return res.status(400).json({ok:false,error:'Reload the current contact details before saving.'});
      await schema();
      const saved=await withTransaction(async client=>{
        await client.query("INSERT INTO clinic_public_contact(id,details,version) VALUES(1,'{}'::jsonb,0) ON CONFLICT(id) DO NOTHING");
        const {rows:[current]}=await client.query('SELECT details,version FROM clinic_public_contact WHERE id=1 FOR UPDATE');
        if(current.version!==version)return null;
        const {rows:[updated]}=await client.query('UPDATE clinic_public_contact SET details=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=1 RETURNING details,version',[JSON.stringify(details)]);
        await client.query('INSERT INTO clinic_public_contact_audit(actor_id,actor_role,previous_details,details,version) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)',[actor.id,actor.role,JSON.stringify(current.details),JSON.stringify(details),updated.version]);
        return updated;
      });
      if(!saved)return res.status(409).json({ok:false,error:'Another Admin updated these details. Reload before saving.'});
      res.json({ok:true,contact:saved.details,version:saved.version});
    }catch(error){next(error);}
  });
}

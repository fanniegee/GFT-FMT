import path from 'node:path';
import {createHash} from 'node:crypto';
export function canEditClinicBranding(admin,staff){return ['FOUNDER','SUPER_ADMIN'].includes(String(admin?.role||'').toUpperCase().replace(/\s+/g,'_'))||staff?.role==='GGC_SUPER_ADMIN';}
export function clinicIcon(value,size){
  if(typeof value!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value))throw Error('Choose a valid image using the icon selector.');
  const bytes=Buffer.from(value.slice(value.indexOf(',')+1),'base64');
  if(bytes.length<45||bytes.length>650000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==size||bytes.readUInt32BE(20)!==size||!bytes.includes(Buffer.from('IEND')))throw Error('The icon size or PNG format is invalid.');
  return bytes;
}
export function installClinicBranding(app,{query,withTransaction,getAuthenticatedAdmin,getAuthenticatedClinicStaff,publicRoot}){
  let ready;
  const schema=()=>ready||(ready=query(`CREATE TABLE IF NOT EXISTS clinic_branding (id INTEGER PRIMARY KEY CHECK(id=1),icon_192 BYTEA NOT NULL,icon_512 BYTEA NOT NULL,version INTEGER NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS clinic_branding_audit (id BIGSERIAL PRIMARY KEY,actor_id TEXT NOT NULL,actor_role TEXT NOT NULL,previous_hash TEXT,icon_hash TEXT NOT NULL,version INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`).catch(error=>{ready=null;throw error;}));
  async function actor(req,res){const [admin,staff]=await Promise.all([getAuthenticatedAdmin(req),getAuthenticatedClinicStaff(req)]);if(!canEditClinicBranding(admin,staff)){res.status(admin||staff?403:401).json({ok:false,error:'Clinic or Trust Super Admin authority is required to change the Clinic icon.'});return null;}return canEditClinicBranding(admin,null)?{id:admin.admin_id,role:admin.role}:{id:staff.staff_id,role:staff.role};}
  app.get('/api/clinic/public/branding',async(_req,res,next)=>{try{await schema();const {rows}=await query('SELECT version FROM clinic_branding WHERE id=1');res.set('Cache-Control','no-store').json({ok:true,version:rows[0]?.version||0});}catch(error){next(error);}});
  app.get('/api/clinic/public/branding/authority',async(req,res,next)=>{try{if(await actor(req,res))res.set('Cache-Control','no-store').json({ok:true});}catch(error){next(error);}});
  app.get('/api/clinic/public/icon/:size',async(req,res,next)=>{
    if(!['192','512'].includes(req.params.size))return res.sendStatus(404);
    try{await schema();const {rows}=await query('SELECT icon_'+req.params.size+' AS image FROM clinic_branding WHERE id=1');res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).type('image/png');if(rows[0])return res.send(rows[0].image);res.sendFile(path.join(publicRoot,'assets','clinic-app-'+req.params.size+'.png'));}catch(error){next(error);}
  });
  app.put('/api/clinic/public/branding',async(req,res,next)=>{try{
    const editor=await actor(req,res);if(!editor)return;
    let small,large;try{small=clinicIcon(req.body?.icon192,192);large=clinicIcon(req.body?.icon512,512);}catch(error){return res.status(400).json({ok:false,error:error.message});}
    const version=req.body?.version;if(!Number.isInteger(version)||version<0)return res.status(400).json({ok:false,error:'Reload settings before saving.'});await schema();
    const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    const saved=await withTransaction(async client=>{
      // An advisory lock also serialises the first save, when the singleton row is absent.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('clinic_branding'))");
      const {rows:[current]}=await client.query('SELECT version,icon_512 FROM clinic_branding WHERE id=1 FOR UPDATE');
      if((current?.version||0)!==version)return null;
      const nextVersion=version+1;
      await client.query('INSERT INTO clinic_branding(id,icon_192,icon_512,version) VALUES(1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET icon_192=EXCLUDED.icon_192,icon_512=EXCLUDED.icon_512,version=EXCLUDED.version,updated_at=NOW()',[small,large,nextVersion]);
      await client.query('INSERT INTO clinic_branding_audit(actor_id,actor_role,previous_hash,icon_hash,version) VALUES($1,$2,$3,$4,$5)',[editor.id,editor.role,current?hash(current.icon_512):null,hash(large),nextVersion]);return nextVersion;
    });if(saved===null)return res.status(409).json({ok:false,error:'Another administrator changed the icon. Reload before saving.'});res.json({ok:true,version:saved});
  }catch(error){next(error);}});
}

import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
const scrypt=promisify(scryptCallback),digest=value=>createHash('sha256').update(value).digest('hex');
const walletCookie='gft_wallet_access',rooms=new Set(['ama-2k','elders']);
const pinPattern=/^\d{6}$/;
const messageColumns='message_id,room,sender_id,sender_name,kind,body,created_at';
export function validAudio(file){
  if(!file||file.size>5*1024*1024)return null;
  const mime=file.mimetype.split(';')[0].toLowerCase(),bytes=file.buffer;
  if(mime==='audio/webm'&&bytes.subarray(0,4).toString('hex')==='1a45dfa3')return mime;
  if(mime==='audio/ogg'&&bytes.toString('ascii',0,4)==='OggS')return mime;
  if(['audio/mp4','audio/x-m4a'].includes(mime)&&bytes.toString('ascii',4,8)==='ftyp')return 'audio/mp4';
  return null;
}
export function createBeneficiaryFamily({query,withTransaction,getBeneficiary,getCookie,publicRoot}){
  let ready;
  function schema(){
    if(!ready)ready=query(`
      CREATE TABLE IF NOT EXISTS beneficiary_wallet_pins(beneficiary_id TEXT PRIMARY KEY,pin_hash TEXT NOT NULL,pin_salt TEXT NOT NULL,failed_attempts INTEGER NOT NULL DEFAULT 0,locked_until TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS beneficiary_wallet_grants(token_hash TEXT PRIMARY KEY,beneficiary_id TEXT NOT NULL,family_session_id TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
      CREATE INDEX IF NOT EXISTS wallet_grants_family_idx ON beneficiary_wallet_grants(beneficiary_id,family_session_id);
      CREATE TABLE IF NOT EXISTS beneficiary_security_events(id BIGSERIAL PRIMARY KEY,beneficiary_id TEXT NOT NULL,event TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS family_chat_messages(message_id BIGSERIAL PRIMARY KEY,room TEXT NOT NULL CHECK(room IN ('ama-2k','elders')),sender_id TEXT NOT NULL,sender_name TEXT NOT NULL,client_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('text','audio')),body TEXT,audio BYTEA,audio_type TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(sender_id,client_id));
      CREATE INDEX IF NOT EXISTS family_chat_room_idx ON family_chat_messages(room,message_id);
      CREATE TABLE IF NOT EXISTS beneficiary_profile_photos(system_id TEXT PRIMARY KEY REFERENCES beneficiaries(system_id),image BYTEA NOT NULL,mime TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    `).catch(error=>{ready=null;throw error;});return ready;
  }
  async function beneficiary(req){return req.familyBeneficiary||(req.familyBeneficiary=await getBeneficiary(req));}
  async function requireFamily(req,res,next){try{const b=await beneficiary(req);if(!b)return res.status(401).json({ok:false,error:'Beneficiary sign-in is required.'});await schema();next();}catch(error){next(error);}}
  function cookie(req,res,token){res.append('Set-Cookie',`${walletCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; ${process.env.NODE_ENV==='production'||req.secure?'Secure; ':''}Max-Age=${token?1200:0}`);}
  async function unlocked(req,b){
    const token=getCookie(req,walletCookie);if(!token)return false;
    await schema();const {rows}=await query('SELECT token_hash FROM beneficiary_wallet_grants WHERE token_hash=$1 AND beneficiary_id=$2 AND family_session_id=$3 AND expires_at>NOW()',[digest(token),String(b.beneficiary_id),String(b.session_id)]);return Boolean(rows.length);
  }
  async function lock(req,res,b){await schema();await query('DELETE FROM beneficiary_wallet_grants WHERE beneficiary_id=$1 AND family_session_id=$2',[String(b.beneficiary_id),String(b.session_id)]);cookie(req,res,'');}
  async function pageGuard(req,res,next){
    try{
      res.set('Cache-Control','no-store');const b=await beneficiary(req);
      if(!b)return res.redirect('/beneficiary-login.html');
      if(req.path==='/beneficiary-family.html')await lock(req,res,b);
      if(['/beneficiary-portal.html','/gpts-payments.html'].includes(req.path)&&!await unlocked(req,b))return res.redirect('/beneficiary-wallet-login.html');
      next();
    }catch(error){next(error);}
  }
  function installPageGuards(app){app.get(['/beneficiary-family.html','/beneficiary-wallet-login.html','/beneficiary-portal.html','/gpts-payments.html'],pageGuard);}
  function installApi(app){
    app.use('/api/beneficiary/family-chat',rateLimit({windowMs:60*1000,limit:600,standardHeaders:true,legacyHeaders:false,message:{ok:false,error:'Chat is busy. Please try again shortly.'}}));
    // Financial endpoints require wallet authority; family trees require family sign-in.
    // Existing tree handlers continue enforcing ownership and record permissions.
    app.use('/api/beneficiary',async(req,res,next)=>{
      if(['/login','/me','/profile/photo'].includes(req.path)||req.path==='/family-chat'||req.path.startsWith('/family-chat/')||req.path.startsWith('/wallet-access/'))return next();
      try{
        const b=await beneficiary(req);
        if(req.path==='/logout'){if(b)await lock(req,res,b);return next();}
        if(!b)return res.status(401).json({ok:false,error:'Beneficiary sign-in is required.'});
        const familyTreePath=/^\/(?:generation-tree|lineage(?:\/settings|\/[^/]+\/photo)?|family-extension(?:\/[^/]+(?:\/(?:photo|registration-code))?)?)$/.test(req.path);
        if(familyTreePath){res.set('Cache-Control','no-store');return next();}
        if(!await unlocked(req,b))return res.status(423).json({ok:false,code:'WALLET_LOCKED',error:'Unlock your wallet with your six-digit PIN.'});
        res.set('Cache-Control','no-store');next();
      }catch(error){next(error);}
    });
    app.get('/api/beneficiary/wallet-access/status',requireFamily,async(req,res,next)=>{try{
      const b=req.familyBeneficiary,{rows}=await query('SELECT beneficiary_id FROM beneficiary_wallet_pins WHERE beneficiary_id=$1',[String(b.beneficiary_id)]);
      res.set('Cache-Control','no-store').json({ok:true,pinSet:Boolean(rows.length),unlocked:await unlocked(req,b)});
    }catch(error){next(error);}});
    app.post('/api/beneficiary/wallet-access/lock',requireFamily,async(req,res,next)=>{try{await lock(req,res,req.familyBeneficiary);res.json({ok:true});}catch(error){next(error);}});
    const pinLimit=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false,message:{ok:false,error:'Too many PIN requests. Please try again later.'}});
    app.post('/api/beneficiary/wallet-access/setup',requireFamily,pinLimit,async(req,res,next)=>{try{
      const {pin,confirmPin}=req.body||{};
      if(typeof pin!=='string'||!pinPattern.test(pin)||pin!==confirmPin)return res.status(400).json({ok:false,error:'Enter and confirm the same six-digit PIN.'});
      const id=String(req.familyBeneficiary.beneficiary_id),salt=randomBytes(16).toString('hex'),hash=(await scrypt(pin,salt,32)).toString('hex');
      const created=await withTransaction(async client=>{
        const result=await client.query('INSERT INTO beneficiary_wallet_pins(beneficiary_id,pin_hash,pin_salt) VALUES($1,$2,$3) ON CONFLICT(beneficiary_id) DO NOTHING RETURNING beneficiary_id',[id,hash,salt]);
        if(!result.rows.length)return false;
        await client.query("INSERT INTO beneficiary_security_events(beneficiary_id,event) VALUES($1,'WALLET_PIN_CREATED')",[id]);return true;
      });
      if(!created)return res.status(409).json({ok:false,error:'A wallet PIN already exists. Use your existing PIN.'});
      res.json({ok:true});
    }catch(error){next(error);}});
    app.post('/api/beneficiary/wallet-access/unlock',requireFamily,pinLimit,async(req,res,next)=>{try{
      const pin=req.body?.pin;if(typeof pin!=='string'||!pinPattern.test(pin))return res.status(400).json({ok:false,error:'Enter your six-digit PIN.'});
      const b=req.familyBeneficiary,id=String(b.beneficiary_id),token=randomBytes(32).toString('hex');
      const result=await withTransaction(async client=>{
        const {rows:[saved]}=await client.query('SELECT * FROM beneficiary_wallet_pins WHERE beneficiary_id=$1 FOR UPDATE',[id]);
        if(!saved)return {status:409,error:'Create your wallet PIN first.'};
        if(saved.locked_until&&new Date(saved.locked_until)>new Date())return {status:429,error:'PIN access is temporarily locked. Try again after 15 minutes.'};
        const expected=Buffer.from(saved.pin_hash,'hex'),actual=await scrypt(pin,saved.pin_salt,32);
        if(expected.length!==actual.length||!timingSafeEqual(expected,actual)){
          const attempts=(saved.locked_until?0:saved.failed_attempts)+1;
          await client.query("UPDATE beneficiary_wallet_pins SET failed_attempts=$2,locked_until=CASE WHEN $2>=5 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END WHERE beneficiary_id=$1",[id,attempts]);
          await client.query("INSERT INTO beneficiary_security_events(beneficiary_id,event) VALUES($1,'WALLET_PIN_FAILED')",[id]);
          return {status:attempts>=5?429:401,error:attempts>=5?'PIN access is locked for 15 minutes.':'Incorrect wallet PIN.'};
        }
        await client.query('UPDATE beneficiary_wallet_pins SET failed_attempts=0,locked_until=NULL WHERE beneficiary_id=$1',[id]);
        await client.query('DELETE FROM beneficiary_wallet_grants WHERE beneficiary_id=$1 AND family_session_id=$2',[id,String(b.session_id)]);
        await client.query("INSERT INTO beneficiary_wallet_grants(token_hash,beneficiary_id,family_session_id,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '20 minutes')",[digest(token),id,String(b.session_id)]);
        await client.query("INSERT INTO beneficiary_security_events(beneficiary_id,event) VALUES($1,'WALLET_UNLOCKED')",[id]);return {status:200};
      });
      if(result.status!==200)return res.status(result.status).json({ok:false,error:result.error});
      cookie(req,res,token);res.json({ok:true});
    }catch(error){next(error);}});
    const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:4}}).single('audio');
    const chatLimit=rateLimit({windowMs:60*1000,limit:40,keyGenerator:req=>String(req.familyBeneficiary.beneficiary_id),standardHeaders:true,legacyHeaders:false,message:{ok:false,error:'Please wait a moment before sending another message.'}});
    app.get('/api/beneficiary/family-chat/:room/messages',requireFamily,async(req,res,next)=>{try{
      if(!rooms.has(req.params.room))return res.sendStatus(404);
      const before=req.query.before,after=req.query.after;
      if((before&&!/^\d{1,16}$/.test(before))||(after&&!/^\d{1,16}$/.test(after))||(before&&after))return res.status(400).json({ok:false,error:'Invalid message page.'});
      const params=[req.params.room],comparison=before?' AND message_id<$2':after?' AND message_id>$2':'';
      if(before||after)params.push(before||after);
      const {rows}=await query(`SELECT ${messageColumns} FROM family_chat_messages WHERE room=$1${comparison} ORDER BY message_id ${after?'ASC':'DESC'} LIMIT 50`,params);
      if(!after)rows.reverse();res.set('Cache-Control','no-store').json({ok:true,messages:rows.map(message=>({...message,audioUrl:message.kind==='audio'?'/api/beneficiary/family-chat/audio/'+message.message_id:null}))});
    }catch(error){next(error);}});
    app.post('/api/beneficiary/family-chat/:room/messages',requireFamily,chatLimit,(req,res,next)=>upload(req,res,error=>{
      if(error)return res.status(400).json({ok:false,error:'Audio must be under 5 MB. Only one recording can be sent at a time.'});next();
    }),async(req,res,next)=>{try{
      const room=req.params.room;if(!rooms.has(room))return res.sendStatus(404);
      const clientId=req.body?.clientId;if(typeof clientId!=='string'||!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(clientId))return res.status(400).json({ok:false,error:'A valid message identifier is required.'});
      const body=typeof req.body?.text==='string'?req.body.text.trim():'',mime=validAudio(req.file);
      if((req.file&&!mime)||(!req.file&&(!body||body.length>2000))||(req.file&&body))return res.status(400).json({ok:false,error:'Send text up to 2,000 characters or a supported audio recording.'});
      const b=req.familyBeneficiary,{rows}=await query(`INSERT INTO family_chat_messages(room,sender_id,sender_name,client_id,kind,body,audio,audio_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(sender_id,client_id) DO NOTHING RETURNING ${messageColumns}`,[room,String(b.beneficiary_id),b.full_name||b.username||b.system_id,clientId,req.file?'audio':'text',body||null,req.file?.buffer||null,mime]);
      if(!rows.length){const existing=await query(`SELECT ${messageColumns} FROM family_chat_messages WHERE sender_id=$1 AND client_id=$2`,[String(b.beneficiary_id),clientId]);if(existing.rows[0]?.room!==room)return res.status(409).json({ok:false,error:'Message identifier already used.'});return res.json({ok:true,message:existing.rows[0]});}
      res.status(201).json({ok:true,message:rows[0]});
    }catch(error){next(error);}});
    app.get('/api/beneficiary/family-chat/audio/:id',requireFamily,async(req,res,next)=>{try{
      if(!/^\d{1,16}$/.test(req.params.id))return res.sendStatus(404);
      const {rows:[message]}=await query("SELECT audio,audio_type FROM family_chat_messages WHERE message_id=$1 AND kind='audio'",[req.params.id]);if(!message)return res.sendStatus(404);
      const bytes=message.audio;res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'}).type(message.audio_type);
      if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match)return res.status(416).set('Content-Range',`bytes */${bytes.length}`).end();const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;if(start>end||start>=bytes.length)return res.status(416).set('Content-Range',`bytes */${bytes.length}`).end();return res.status(206).set('Content-Range',`bytes ${start}-${end}/${bytes.length}`).send(bytes.subarray(start,end+1));}
      res.send(bytes);
    }catch(error){next(error);}});
    app.get('/api/beneficiary/family-chat/avatar/:id',requireFamily,async(req,res,next)=>{try{
      if(!/^[\w-]{1,100}$/.test(req.params.id))return res.sendStatus(404);
      const {rows:[photo]}=await query('SELECT p.image,p.mime FROM beneficiary_profile_photos p JOIN beneficiaries b ON b.system_id=p.system_id WHERE b.beneficiary_id::text=$1 AND EXISTS(SELECT 1 FROM family_chat_messages m WHERE m.sender_id=$1) LIMIT 1',[req.params.id]);
      if(!photo)return res.sendStatus(404);res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).type(photo.mime).send(photo.image);
    }catch(error){next(error);}});
  }
  return {installPageGuards,installApi,schema};
}

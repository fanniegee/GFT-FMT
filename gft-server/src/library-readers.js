import { randomBytes } from 'node:crypto';

const titles = new Map([
  ['LIB-001','The Rising Generations'], ['LIB-002','Roots, Memory & Identity'],
  ['LIB-003','African Knowledge'], ['LIB-004','Songs For The Generations']
]);
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cookie='gft_library_reader';
const path='/api/library';
const token=()=>randomBytes(32).toString('base64url');

export function installLibrary(app,{query,withTransaction,getCookie,sha256,createPasswordHash,verifyPassword,rateLimit}){
  let schema;
  const limiter=rateLimit({windowMs:15*60_000,limit:25,standardHeaders:true,legacyHeaders:false});
  const cookieOptions={httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path};
  const ensure=()=>schema ??= withTransaction(async client=>{
    await client.query('CREATE TABLE IF NOT EXISTS gft_library_members (member_id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL)');
    await client.query('CREATE TABLE IF NOT EXISTS gft_library_sessions (token_hash TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES gft_library_members ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL)');
    await client.query('CREATE TABLE IF NOT EXISTS gft_library_reading (member_id TEXT NOT NULL REFERENCES gft_library_members ON DELETE CASCADE,book_id TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(member_id,book_id))');
    await client.query('CREATE TABLE IF NOT EXISTS gft_library_newsletter (email TEXT PRIMARY KEY,subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  }).catch(error=>{schema=undefined;throw error;});

  function route(method,suffix,handler,limited=false){
    app[method](path+suffix,...(limited?[limiter]:[]),async(req,res)=>{
      res.set('Cache-Control','no-store');
      if(method==='post' && !req.is('application/json')) return res.sendStatus(415);
      try{await ensure();return await handler(req,res);}
      catch(error){
        if(error.code==='23505') return res.status(409).json({error:'An account with this email already exists.'});
        console.error('Library request failed',error.code || error.name);
        return res.status(500).json({error:'The Library service could not complete this request.'});
      }
    });
  }

  async function member(req){
    const session=getCookie(req,cookie);
    if(!session) return null;
    const {rows}=await query('SELECT m.member_id,m.name,m.email FROM gft_library_sessions s JOIN gft_library_members m USING(member_id) WHERE s.token_hash=$1 AND s.expires_at>NOW()',[sha256(session)]);
    return rows[0] || null;
  }

  async function signIn(res,id){
    const session=token();
    await query("INSERT INTO gft_library_sessions(token_hash,member_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '8 hours')",[sha256(session),id]);
    return res.cookie(cookie,session,{...cookieOptions,maxAge:28_800_000}).json({ok:true});
  }

  function credentials(req){
    const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
    const password=typeof req.body?.password==='string'?req.body.password:'';
    return {email,password,valid:email.length<=254 && emailPattern.test(email) && password.length>=12 && password.length<=200};
  }

  route('post','/register',async(req,res)=>{
    const {email,password,valid}=credentials(req);
    const name=typeof req.body?.name==='string'?req.body.name.trim():'';
    if(!valid||!name||name.length>180) return res.status(400).json({error:'Enter a name, a valid email address and a password of 12 to 200 characters.'});
    const id=token();
    await query('INSERT INTO gft_library_members(member_id,name,email,password_hash) VALUES ($1,$2,$3,$4)',[id,name,email,await createPasswordHash(password)]);
    return signIn(res,id);
  },true);

  route('post','/login',async(req,res)=>{
    const {email,password,valid}=credentials(req);
    if(!valid) return res.status(401).json({error:'Email or password is incorrect.'});
    const {rows:[account]}=await query('SELECT member_id,password_hash FROM gft_library_members WHERE email=$1',[email]);
    if(!account || !await verifyPassword(password,account.password_hash)) return res.status(401).json({error:'Email or password is incorrect.'});
    return signIn(res,account.member_id);
  },true);

  route('post','/logout',async(req,res)=>{
    const session=getCookie(req,cookie);
    if(session) await query('DELETE FROM gft_library_sessions WHERE token_hash=$1',[sha256(session)]);
    return res.clearCookie(cookie,cookieOptions).json({ok:true});
  });

  route('get','/me',async(req,res)=>{
    const reader=await member(req);
    if(!reader) return res.sendStatus(401);
    const {rows}=await query('SELECT book_id,progress,updated_at FROM gft_library_reading WHERE member_id=$1 ORDER BY updated_at DESC,book_id',[reader.member_id]);
    return res.json({reader:{name:reader.name,email:reader.email},books:rows.filter(row=>titles.has(row.book_id)).map(row=>({...row,title:titles.get(row.book_id)}))});
  });

  route('post','/reading/:id',async(req,res)=>{
    const reader=await member(req);
    if(!reader) return res.sendStatus(401);
    const id=req.params.id, {action,progress}=req.body || {};
    if(!titles.has(id) || !['save','progress','remove'].includes(action) ||
       (action==='progress' && (!Number.isInteger(progress)||progress<0||progress>100))) return res.sendStatus(400);
    if(action==='remove'){
      await query('DELETE FROM gft_library_reading WHERE member_id=$1 AND book_id=$2',[reader.member_id,id]);
    }else if(action==='progress'){
      const changed=await query('UPDATE gft_library_reading SET progress=$3,updated_at=NOW() WHERE member_id=$1 AND book_id=$2 RETURNING book_id',[reader.member_id,id,progress]);
      if(!changed.rows.length) return res.status(404).json({error:'Save the title before recording progress.'});
    }else{
      await query('INSERT INTO gft_library_reading(member_id,book_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[reader.member_id,id]);
    }
    return res.json({ok:true});
  });

  route('post','/newsletter',async(req,res)=>{
    const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
    if(req.body?.consent!==true||email.length>254||!emailPattern.test(email)) return res.status(400).json({error:'Enter a valid email address and consent to receive the newsletter.'});
    await query('INSERT INTO gft_library_newsletter(email) VALUES($1) ON CONFLICT DO NOTHING',[email]);
    return res.json({ok:true});
  },true);
}


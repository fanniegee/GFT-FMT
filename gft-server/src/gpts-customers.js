import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';

const digest = value => createHash('sha256').update(value).digest('hex');
const error = (status, message) => Object.assign(new Error(message), { status });
const emailInput = z.string().trim().toLowerCase().email().max(254);
const passwordInput = z.string().min(12).max(200);
const registerInput = z.object({
  name: z.string().trim().min(2).max(120), email: emailInput, password: passwordInput,
  country: z.enum(['ZW','ZA','BW','ZM','MZ']), service: z.enum(['TECHNOLOGY','PAYMENTS','BOTH']),
  acknowledge: z.literal(true)
}).strict();
const tokenInput = z.string().regex(/^[a-f0-9]{64}$/);
const publicCustomer = customer => ({ customerId: customer.customer_id, name: customer.full_name,
  email: customer.email, country: customer.country, service: customer.service,
  emailVerified: Boolean(customer.email_verified_at), financialVerification: customer.financial_verification });

export function createGptsCustomers({ query, withTransaction, getCookie, createPasswordHash, verifyPassword, sendEmail,
  publicOrigin = 'https://guvazafamilytrust.com', secure = process.env.NODE_ENV === 'production' }) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname) && !secure)) throw Error('GPTS requires a secure public origin');
  const cookieName = 'gpts_customer_session';
  let ready, dummyHash;
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 8*60*60*1000 };
  function ensureSchema() {
    ready ??= withTransaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gpts-customers-v1'))");
      await client.query(`CREATE TABLE IF NOT EXISTS gpts_customers(
        customer_id UUID PRIMARY KEY,email TEXT NOT NULL UNIQUE,full_name TEXT NOT NULL,password_hash TEXT NOT NULL,
        country CHAR(2) NOT NULL CHECK(country IN('ZW','ZA','BW','ZM','MZ')),
        service TEXT NOT NULL CHECK(service IN('TECHNOLOGY','PAYMENTS','BOTH')),
        email_verified_at TIMESTAMPTZ,financial_verification TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(financial_verification='NOT_STARTED'),
        failed_attempts INTEGER NOT NULL DEFAULT 0,locked_until TIMESTAMPTZ,
        acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS gpts_customer_sessions(
        token_hash CHAR(64) PRIMARY KEY,customer_id UUID NOT NULL REFERENCES gpts_customers(customer_id),
        expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS gpts_customer_session_owner_idx ON gpts_customer_sessions(customer_id);
      CREATE TABLE IF NOT EXISTS gpts_customer_tokens(
        token_hash CHAR(64) PRIMARY KEY,customer_id UUID NOT NULL REFERENCES gpts_customers(customer_id),
        purpose TEXT NOT NULL CHECK(purpose IN('VERIFY','RESET')),expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS gpts_customer_token_owner_idx ON gpts_customer_tokens(customer_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS gpts_customer_events(
        event_id UUID PRIMARY KEY,customer_id UUID NOT NULL REFERENCES gpts_customers(customer_id),
        action TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE OR REPLACE FUNCTION gpts_customer_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'GPTS customer security history is permanent'; END $$;
      DROP TRIGGER IF EXISTS gpts_customer_events_immutable ON gpts_customer_events;
      CREATE TRIGGER gpts_customer_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON gpts_customer_events
        FOR EACH STATEMENT EXECUTE FUNCTION gpts_customer_event_guard();`);
    }).catch(cause => { ready = undefined; throw cause; });
    return ready;
  }
  async function event(client, id, action) {
    await client.query('INSERT INTO gpts_customer_events(event_id,customer_id,action) VALUES($1,$2,$3)', [randomUUID(),id,action]);
  }
  async function getCustomer(req) {
    const token = getCookie(req,cookieName);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    await ensureSchema();
    const { rows } = await query(`SELECT c.customer_id,c.full_name,c.email,c.country,c.service,c.email_verified_at,c.financial_verification
      FROM gpts_customer_sessions s JOIN gpts_customers c USING(customer_id)
      WHERE s.token_hash=$1 AND s.expires_at>NOW() AND c.email_verified_at IS NOT NULL`, [digest(token)]);
    return rows[0] || null;
  }
  async function deliver(email, token, purpose) {
    const url = new URL('/gpts-customer-access.html',origin); url.searchParams.set('action',purpose === 'VERIFY' ? 'verify' : 'reset'); url.searchParams.set('token',token);
    await sendEmail({ to: email, subject: purpose === 'VERIFY' ? 'Verify your GPTS customer email' : 'Reset your GPTS password',
      text: `${purpose === 'VERIFY' ? 'Confirm your email for your GPTS customer account' : 'Choose a new password for your GPTS customer account'}:\n\n${url.href}\n\nThis link expires in 30 minutes and can be used once. If you did not request it, ignore this message. A GPTS customer account does not create Guvaza Family Trust beneficiary membership.` });
  }
  function installPages(app) {
    app.get('/gpts-customer.html',async(req,res,next)=>{
      res.set('Cache-Control','no-store');
      try { if (!await getCustomer(req)) return res.redirect('/gpts-customer-access.html'); next(); } catch(cause) { next(cause); }
    });
    app.get('/gpts-customer-access.html',(_req,res,next)=>{ res.set('Cache-Control','no-store'); res.set('Referrer-Policy','no-referrer'); next(); });
  }
  function installApi(app) {
    const limiter = rateLimit({ windowMs: 15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,message:{ok:false,error:'Too many account attempts. Please try again later.'} });
    function route(method,suffix,handler,limited=false) {
      app[method]('/api/gpts-payments/auth'+suffix,...(limited?[limiter]:[]),async(req,res)=>{
        res.set('Cache-Control','no-store');
        try {
          if (method==='post'&&!req.is('application/json')) throw error(415,'Send application/json.');
          await ensureSchema(); await handler(req,res);
        } catch(cause) {
          if(cause instanceof z.ZodError)return res.status(400).json({ok:false,error:'Check your details. Passwords must contain 12 to 200 characters.'});
          if(cause.code==='23505')return res.status(409).json({ok:false,error:'An account already exists for this email. Sign in, resend verification, or reset your password.'});
          if(!cause.status)console.error('GPTS customer account request failed:',cause.code||cause.name);
          res.status(cause.status||503).json({ok:false,error:cause.status?cause.message:'The account service is temporarily unavailable. Please retry.'});
        }
      });
    }
    route('post','/register',async(req,res)=>{
      const data=registerInput.parse(req.body),id=randomUUID(),token=randomBytes(32).toString('hex'),passwordHash=await createPasswordHash(data.password);
      await withTransaction(async client=>{
        await client.query('INSERT INTO gpts_customers(customer_id,email,full_name,password_hash,country,service) VALUES($1,$2,$3,$4,$5,$6)',[id,data.email,data.name,passwordHash,data.country,data.service]);
        await client.query("INSERT INTO gpts_customer_tokens(token_hash,customer_id,purpose,expires_at) VALUES($1,$2,'VERIFY',NOW()+INTERVAL '30 minutes')",[digest(token),id]);
        await event(client,id,'REGISTERED');
      });
      try { await deliver(data.email,token,'VERIFY'); } catch { throw error(503,'Your account is saved but the verification email could not be delivered. Use Resend verification to retry.'); }
      res.status(201).json({ok:true,message:'Account created. Check your email and confirm the verification link before signing in.'});
    },true);
    route('post','/login',async(req,res)=>{
      const data=z.object({email:emailInput,password:passwordInput}).strict().parse(req.body);
      dummyHash ??= createPasswordHash(randomBytes(32).toString('hex'));
      const session=randomBytes(32).toString('hex');
      const result=await withTransaction(async client=>{
        const {rows}=await client.query('SELECT * FROM gpts_customers WHERE email=$1 FOR UPDATE',[data.email]);const customer=rows[0];
        if(!customer){await verifyPassword(data.password,await dummyHash);return {status:401,message:'Email or password is incorrect.'};}
        if(customer.locked_until&&new Date(customer.locked_until)>new Date())return {status:429,message:'Account temporarily locked. Try again in 15 minutes.'};
        if(!await verifyPassword(data.password,customer.password_hash)){
          const failures=Number(customer.failed_attempts||0)+1;
          await client.query("UPDATE gpts_customers SET failed_attempts=$2,locked_until=CASE WHEN $2>=5 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END WHERE customer_id=$1",[customer.customer_id,failures]);
          await event(client,customer.customer_id,'LOGIN_FAILED');return {status:failures>=5?429:401,message:failures>=5?'Account temporarily locked. Try again in 15 minutes.':'Email or password is incorrect.'};
        }
        if(!customer.email_verified_at)return {status:403,message:'Verify your email before signing in. You can resend the verification email.'};
        await client.query('UPDATE gpts_customers SET failed_attempts=0,locked_until=NULL WHERE customer_id=$1',[customer.customer_id]);
        await client.query('DELETE FROM gpts_customer_sessions WHERE customer_id=$1 AND expires_at<=NOW()',[customer.customer_id]);
        await client.query("INSERT INTO gpts_customer_sessions(token_hash,customer_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '8 hours')",[digest(session),customer.customer_id]);
        await event(client,customer.customer_id,'SIGNED_IN');return {customer:publicCustomer(customer)};
      });
      if(result.status)throw error(result.status,result.message);
      res.cookie(cookieName,session,cookieOptions).json({ok:true,customer:result.customer});
    },true);
    for(const [suffix,purpose] of [['/resend-verification','VERIFY'],['/forgot-password','RESET']])route('post',suffix,async(req,res)=>{
      const {email}=z.object({email:emailInput}).strict().parse(req.body),token=randomBytes(32).toString('hex');
      const customer=await withTransaction(async client=>{
        const {rows}=await client.query('SELECT * FROM gpts_customers WHERE email=$1 FOR UPDATE',[email]);const account=rows[0];
        if(!account||(purpose==='VERIFY'&&account.email_verified_at))return null;
        const recent=await client.query("SELECT token_hash FROM gpts_customer_tokens WHERE customer_id=$1 AND purpose=$2 AND consumed_at IS NULL AND created_at>NOW()-INTERVAL '60 seconds' LIMIT 1",[account.customer_id,purpose]);
        if(recent.rows.length)return null;
        await client.query('UPDATE gpts_customer_tokens SET consumed_at=NOW() WHERE customer_id=$1 AND purpose=$2 AND consumed_at IS NULL',[account.customer_id,purpose]);
        await client.query("INSERT INTO gpts_customer_tokens(token_hash,customer_id,purpose,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '30 minutes')",[digest(token),account.customer_id,purpose]);
        await event(client,account.customer_id,purpose==='VERIFY'?'VERIFICATION_REQUESTED':'PASSWORD_RESET_REQUESTED');return account;
      });
      if(customer)try{await deliver(email,token,purpose);}catch{throw error(503,'Email delivery is temporarily unavailable. Please retry after one minute.');}
      res.status(202).json({ok:true,message:'If the account needs this email, a link will be sent. Check your inbox or try again after one minute.'});
    },true);
    route('post','/verify-email',async(req,res)=>{
      const {token}=z.object({token:tokenInput}).strict().parse(req.body);
      await consume(token,'VERIFY',async(client,id)=>{await client.query('UPDATE gpts_customers SET email_verified_at=COALESCE(email_verified_at,NOW()) WHERE customer_id=$1',[id]);await event(client,id,'EMAIL_VERIFIED');});
      res.json({ok:true,message:'Email verified. You can now sign in.'});
    },true);
    route('post','/reset-password',async(req,res)=>{
      const data=z.object({token:tokenInput,password:passwordInput}).strict().parse(req.body),passwordHash=await createPasswordHash(data.password);
      await consume(data.token,'RESET',async(client,id)=>{
        await client.query('UPDATE gpts_customers SET password_hash=$2,failed_attempts=0,locked_until=NULL WHERE customer_id=$1',[id,passwordHash]);
        await client.query('DELETE FROM gpts_customer_sessions WHERE customer_id=$1',[id]);
        await client.query("UPDATE gpts_customer_tokens SET consumed_at=NOW() WHERE customer_id=$1 AND purpose='RESET' AND consumed_at IS NULL",[id]);await event(client,id,'PASSWORD_RESET');
      });
      res.clearCookie(cookieName,{...cookieOptions,maxAge:undefined}).json({ok:true,message:'Password changed. Sign in with your new password.'});
    },true);
    route('get','/me',async(req,res)=>{const customer=await getCustomer(req);if(!customer)throw error(401,'Sign in to your GPTS account.');res.json({ok:true,customer:publicCustomer(customer)});});
    route('post','/logout',async(req,res)=>{
      const token=getCookie(req,cookieName);
      if(token)await withTransaction(async client=>{
        const {rows}=await client.query('DELETE FROM gpts_customer_sessions WHERE token_hash=$1 RETURNING customer_id',[digest(token)]);
        if(rows[0])await event(client,rows[0].customer_id,'SIGNED_OUT');
      });
      res.clearCookie(cookieName,{...cookieOptions,maxAge:undefined}).json({ok:true});
    });
  }
  async function consume(token,purpose,handler){
    await withTransaction(async client=>{
      // Lock the customer before the token to serialize reset, resend and login.
      const owner=await client.query('SELECT customer_id FROM gpts_customer_tokens WHERE token_hash=$1 AND purpose=$2',[digest(token),purpose]);
      if(!owner.rows[0])throw error(400,'This link is invalid or expired. Request a new link.');
      await client.query('SELECT customer_id FROM gpts_customers WHERE customer_id=$1 FOR UPDATE',[owner.rows[0].customer_id]);
      const {rows}=await client.query('SELECT customer_id FROM gpts_customer_tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE',[digest(token),purpose]);
      if(!rows[0])throw error(400,'This link is invalid or expired. Request a new link.');
      await client.query('UPDATE gpts_customer_tokens SET consumed_at=NOW() WHERE token_hash=$1',[digest(token)]);
      await handler(client,rows[0].customer_id);
    });
  }
  return {ensureSchema,getCustomer,installPages,installApi};
}

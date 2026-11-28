import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createGptsCustomers } from '../src/gpts-customers.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const createPasswordHash = async password => { const salt=randomBytes(16).toString('hex');return `scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`; };
const verifyPassword = async(password,encoded) => {const [,salt,key]=encoded.split('$');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(key,'hex'));};
async function fixture(){
  let state={customers:[],tokens:[],sessions:[],events:[]},queue=Promise.resolve(),failAudit=false,failMail=false;
  const emails=[],calls=[];
  async function query(sql,args=[]){
    calls.push(sql);
    if(sql.includes('pg_advisory')||sql.includes('CREATE TABLE'))return {rows:[]};
    if(sql.startsWith('INSERT INTO gpts_customers')){
      if(state.customers.some(c=>c.email===args[1]))throw Object.assign(Error('Duplicate'),{code:'23505'});
      state.customers.push({customer_id:args[0],email:args[1],full_name:args[2],password_hash:args[3],country:args[4],service:args[5],email_verified_at:null,financial_verification:'NOT_STARTED',failed_attempts:0,locked_until:null});return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO gpts_customer_tokens')){
      state.tokens.push({token_hash:args[0],customer_id:args[1],purpose:args[2]||'VERIFY',expires_at:new Date(Date.now()+1800000),consumed_at:null,created_at:new Date()});return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO gpts_customer_events')){if(failAudit)throw Error('Isolated audit failure');state.events.push({customer_id:args[1],action:args[2]});return {rows:[]};}
    if(sql.startsWith('SELECT * FROM gpts_customers WHERE email'))return {rows:state.customers.filter(c=>c.email===args[0])};
    if(sql.startsWith('SELECT customer_id FROM gpts_customers'))return {rows:state.customers.filter(c=>c.customer_id===args[0])};
    if(sql.startsWith('SELECT customer_id FROM gpts_customer_tokens'))return {rows:state.tokens.filter(t=>t.token_hash===args[0]&&t.purpose===args[1]&&(!sql.includes('expires_at>NOW()')||(!t.consumed_at&&t.expires_at>Date.now())))};
    if(sql.startsWith('SELECT token_hash FROM gpts_customer_tokens'))return {rows:state.tokens.filter(t=>t.customer_id===args[0]&&t.purpose===args[1]&&!t.consumed_at&&t.created_at>Date.now()-60000).slice(0,1)};
    if(sql.startsWith('UPDATE gpts_customer_tokens')){
      for(const t of state.tokens){if(sql.includes('WHERE token_hash')?t.token_hash===args[0]:t.customer_id===args[0]&&t.purpose===(args[1]||'RESET')&&!t.consumed_at)t.consumed_at=new Date();}return {rows:[]};
    }
    if(sql.startsWith('UPDATE gpts_customers')){
      const c=state.customers.find(c=>c.customer_id===args[0]);
      if(sql.includes('email_verified_at='))c.email_verified_at??=new Date();
      else if(sql.includes('password_hash=')){c.password_hash=args[1];c.failed_attempts=0;c.locked_until=null;}
      else {c.failed_attempts=args[1]||0;c.locked_until=c.failed_attempts>=5?new Date(Date.now()+900000):null;}return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO gpts_customer_sessions')){state.sessions.push({token_hash:args[0],customer_id:args[1],expires_at:new Date(Date.now()+28800000)});return {rows:[]};}
    if(sql.startsWith('DELETE FROM gpts_customer_sessions')){
      const deleted=[];state.sessions=state.sessions.filter(s=>{const remove=sql.includes('WHERE token_hash')?s.token_hash===args[0]:s.customer_id===args[0]&&(!sql.includes('expires_at<=NOW()')||s.expires_at<=Date.now());if(remove)deleted.push(s);return !remove;});return {rows:deleted};
    }
    if(sql.startsWith('SELECT c.customer_id')){
      const session=state.sessions.find(s=>s.token_hash===args[0]&&s.expires_at>Date.now());return {rows:session?state.customers.filter(c=>c.customer_id===session.customer_id&&c.email_verified_at):[]};
    }
    throw Error('Unexpected customer SQL: '+sql);
  }
  const withTransaction=callback=>{const job=queue.then(async()=>{const before=structuredClone(state);try{return await callback({query});}catch(error){state=before;throw error;}});queue=job.catch(()=>{});return job;};
  const app=express();app.use(express.json());
  const accounts=createGptsCustomers({query,withTransaction,createPasswordHash,verifyPassword,secure:true,
    getCookie:(req,key)=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(key+'='))?.slice(key.length+1),
    sendEmail:async message=>{if(failMail)throw Error('Isolated mail failure');emails.push(message);}});
  accounts.installPages(app);accounts.installApi(app);
  app.get('/gpts-customer.html',(_req,res)=>res.send('Private customer page'));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(suffix,body,cookie='')=>fetch(base+'/api/gpts-payments/auth'+suffix,{redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const page=cookie=>fetch(base+'/gpts-customer.html',{redirect:'manual',headers:cookie?{Cookie:cookie}:{}});
  return {request,page,emails,calls,get state(){return state;},set failAudit(v){failAudit=v;},set failMail(v){failMail=v;},close:()=>new Promise(resolve=>server.close(resolve))};
}
const registration=()=>({name:'Isolated Test Customer',email:'customer@example.test',password:'long secure fixture password',country:'ZW',service:'BOTH',acknowledge:true});
const emailToken=email=>new URL(email.text.match(/https:\/\/\S+/)[0]).searchParams.get('token');

test('independent customer registration, verification, durable lock and password recovery',async()=>{
  const f=await fixture();try{
    assert.equal((await f.page()).headers.get('location'),'/gpts-customer-access.html');
    assert.equal((await f.request('/me')).status,401);
    assert.equal((await f.request('/register',{...registration(),acknowledge:false})).status,400);
    const created=await f.request('/register',registration());assert.equal(created.status,201);assert.equal(created.headers.get('set-cookie'),null);
    assert.equal(f.emails.length,1);assert.equal(f.state.customers[0].email_verified_at,null);assert.notEqual(f.state.customers[0].password_hash,registration().password);
    assert.ok(!f.emails[0].text.includes(registration().password));const token=emailToken(f.emails[0]);assert.equal(f.state.tokens[0].token_hash,hash(token));
    assert.equal((await f.request('/register',registration())).status,409);
    assert.equal((await f.request('/login',{email:registration().email,password:registration().password})).status,403);
    assert.equal((await f.request('/reset-password',{token,password:'a different secure fixture password'})).status,400);
    assert.equal((await f.request('/verify-email',{token})).status,200);
    assert.equal((await f.request('/verify-email',{token})).status,400,'verification token is single use');
    for(let i=0;i<5;i++)assert.equal((await f.request('/login',{email:registration().email,password:'an incorrect long password'})).status,i===4?429:401);
    assert.equal((await f.request('/login',{email:registration().email,password:registration().password})).status,429);
    f.state.customers[0].locked_until=new Date(Date.now()-1);
    const login=await f.request('/login',{email:registration().email,password:registration().password});assert.equal(login.status,200);
    const setCookie=login.headers.get('set-cookie'),cookie=setCookie.split(';')[0];assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Strict/);
    const me=await(await f.request('/me',undefined,cookie)).json();assert.equal(me.customer.financialVerification,'NOT_STARTED');assert.equal(me.customer.password_hash,undefined);
    assert.equal((await f.page(cookie)).status,200);assert.equal((await f.request('/me',undefined,'gft_beneficiary=other-session')).status,401);
    assert.equal((await f.request('/forgot-password',{email:'unknown@example.test'})).status,202);
    assert.equal((await f.request('/forgot-password',{email:registration().email})).status,202);
    const reset=emailToken(f.emails.at(-1));
    assert.equal((await f.request('/reset-password',{token:reset,password:'a different secure fixture password'})).status,200);
    assert.equal((await f.request('/me',undefined,cookie)).status,401,'password recovery revokes existing sessions');
    assert.equal((await f.request('/reset-password',{token:reset,password:'yet another secure fixture password'})).status,400);
    assert.ok(f.calls.every(sql=>!/\b(?:beneficiaries|wallets|ledger_entries|family_members)\b/i.test(sql)),'customer registration never changes family data');
  }finally{await f.close();}
});
test('registration audit failure rolls back; email failure is recoverable without bypassing verification',async()=>{
  const f=await fixture();try{
    f.failAudit=true;assert.equal((await f.request('/register',registration())).status,503);assert.equal(f.state.customers.length,0);assert.equal(f.emails.length,0);
    f.failAudit=false;f.failMail=true;assert.equal((await f.request('/register',registration())).status,503);assert.equal(f.state.customers.length,1);assert.equal(f.state.customers[0].email_verified_at,null);
    f.failMail=false;f.state.tokens[0].created_at=new Date(Date.now()-120000);
    assert.equal((await f.request('/resend-verification',{email:registration().email})).status,202);assert.equal(f.emails.length,1);
    const token=emailToken(f.emails[0]);f.state.tokens.at(-1).expires_at=new Date(Date.now()-1);
    assert.equal((await f.request('/verify-email',{token})).status,400,'expired token cannot verify');
    f.state.tokens.at(-1).created_at=new Date(Date.now()-120000);
    await f.request('/resend-verification',{email:registration().email});const valid=emailToken(f.emails.at(-1));
    assert.equal((await f.request('/verify-email',{token:valid})).status,200);
    const login=await f.request('/login',{email:registration().email,password:registration().password});const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await f.request('/logout',{},cookie)).status,200);assert.equal((await f.request('/me',undefined,cookie)).status,401);
  }finally{await f.close();}
});

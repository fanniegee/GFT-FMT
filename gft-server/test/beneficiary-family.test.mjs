import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createBeneficiaryFamily,validAudio} from '../src/beneficiary-family.js';

test('family chat and separate wallet authority, using isolated fixtures',async()=>{
  let state={pins:new Map(),grants:new Map(),events:[],messages:[]};
  let failEvent=false,queue=Promise.resolve();
  const sessions={
    A:{beneficiary_id:'B1',session_id:'S1',system_id:'GFT-1',full_name:'Fixture One'},
    A2:{beneficiary_id:'B1',session_id:'S3',system_id:'GFT-1',full_name:'Fixture One'},
    B:{beneficiary_id:'B2',session_id:'S2',system_id:'GFT-2',full_name:'Fixture Two'}
  };
  function getCookie(req,key){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='))?.slice(key.length+1);}
  async function query(sql,args=[]){
    if(sql.includes('CREATE TABLE IF NOT EXISTS'))return {rows:[]};
    if(sql.startsWith('SELECT beneficiary_id FROM beneficiary_wallet_pins'))return {rows:state.pins.has(args[0])?[{beneficiary_id:args[0]}]:[]};
    if(sql.startsWith('INSERT INTO beneficiary_wallet_pins')){
      if(state.pins.has(args[0]))return {rows:[]};
      state.pins.set(args[0],{beneficiary_id:args[0],pin_hash:args[1],pin_salt:args[2],failed_attempts:0,locked_until:null});return {rows:[{beneficiary_id:args[0]}]};
    }
    if(sql.startsWith('SELECT * FROM beneficiary_wallet_pins'))return {rows:state.pins.has(args[0])?[structuredClone(state.pins.get(args[0]))]:[]};
    if(sql.startsWith('UPDATE beneficiary_wallet_pins')){
      const pin=state.pins.get(args[0]);pin.failed_attempts=args[1]||0;pin.locked_until=args[1]>=5?new Date(Date.now()+900000):null;return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO beneficiary_security_events')){if(failEvent)throw Error('Simulated audit write failure');state.events.push({id:args[0],event:sql});return {rows:[]};}
    if(sql.startsWith('SELECT token_hash FROM beneficiary_wallet_grants')){
      const grant=state.grants.get(args[0]);return {rows:grant&&grant.id===args[1]&&grant.family===args[2]&&grant.expires>Date.now()?[{token_hash:args[0]}]:[]};
    }
    if(sql.startsWith('DELETE FROM beneficiary_wallet_grants')){for(const [key,grant]of state.grants)if(grant.id===args[0]&&grant.family===args[1])state.grants.delete(key);return {rows:[]};}
    if(sql.startsWith('INSERT INTO beneficiary_wallet_grants')){state.grants.set(args[0],{id:args[1],family:args[2],expires:Date.now()+1200000});return {rows:[]};}
    if(sql.startsWith('INSERT INTO family_chat_messages')){
      if(state.messages.some(m=>m.sender_id===args[1]&&m.client_id===args[3]))return {rows:[]};
      const message={message_id:String(state.messages.length+1),room:args[0],sender_id:args[1],sender_name:args[2],client_id:args[3],kind:args[4],body:args[5],audio:args[6],audio_type:args[7],created_at:new Date().toISOString()};state.messages.push(message);return {rows:[publicMessage(message)]};
    }
    if(sql.startsWith('SELECT audio,audio_type')){const message=state.messages.find(m=>m.message_id===args[0]&&m.kind==='audio');return {rows:message?[{audio:Buffer.from(message.audio),audio_type:message.audio_type}]:[]};}
    if(sql.startsWith('SELECT p.image'))return {rows:[]};
    if(sql.startsWith('SELECT message_id')){
      let messages=state.messages.filter(m=>sql.includes('WHERE sender_id')?m.sender_id===args[0]&&m.client_id===args[1]:m.room===args[0]);
      if(sql.includes('message_id<$2'))messages=messages.filter(m=>BigInt(m.message_id)<BigInt(args[1]));
      if(sql.includes('message_id>$2'))messages=messages.filter(m=>BigInt(m.message_id)>BigInt(args[1]));
      if(sql.includes('DESC'))messages=messages.toReversed();return {rows:messages.slice(0,50).map(publicMessage)};
    }
    throw Error('Unexpected fixture query: '+sql);
  }
  function publicMessage(message){const {audio,audio_type,client_id,...result}=message;return {...result};}
  function withTransaction(callback){const operation=queue.then(async()=>{const before=structuredClone(state);try{return await callback({query});}catch(error){state=before;throw error;}});queue=operation.catch(()=>{});return operation;}
  const app=express();app.use(express.json());
  const hub=createBeneficiaryFamily({query,withTransaction,getBeneficiary:async req=>sessions[getCookie(req,'family')]||null,getCookie,publicRoot:process.cwd()});
  hub.installPageGuards(app);hub.installApi(app);
  app.get(['/beneficiary-family.html','/beneficiary-wallet-login.html','/beneficiary-portal.html'],(_req,res)=>res.send('Fixture page'));
  for(const route of ['/wallet','/payouts','/cashout','/transfers','/profile/payments','/card'])app.all('/api/beneficiary'+route,(_req,res)=>res.json({ok:true}));
  app.get('/api/beneficiary/me',(_req,res)=>res.json({ok:true}));
  app.post('/api/beneficiary/logout',(_req,res)=>res.json({ok:true}));
  app.use((error,_req,res,_next)=>res.status(500).json({ok:false,error:'Fixture failure'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(url,session='A',options={},wallet='')=>fetch(base+url,{redirect:'manual',...options,headers:{...(session?{Cookie:'family='+session+(wallet?'; '+wallet:'')}:{}),...options.headers}});
  const post=(url,body,session='A',wallet='')=>request('/api/beneficiary'+url,session,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},wallet);
  const access=(action,body,session='A')=>post('/wallet-access/'+action,body,session);
  let wallet;
  try{
    assert.equal((await request('/beneficiary-family.html','')).status,302);
    assert.equal((await request('/beneficiary-portal.html')).headers.get('location'),'/beneficiary-wallet-login.html');
    for(const route of ['/wallet','/payouts','/cashout','/transfers','/profile/payments','/card'])assert.equal((await request('/api/beneficiary'+route)).status,423,route+' must require PIN authority');
    assert.equal((await request('/api/beneficiary/wallet','')).status,401);
    assert.equal((await access('setup',{pin:'123',confirmPin:'123'})).status,400);
    assert.equal((await access('setup',{pin:'001234',confirmPin:'001234'})).status,200);
    assert.notEqual(state.pins.get('B1').pin_hash,'001234');assert.equal(state.pins.get('B1').pin_salt.length,32);
    assert.equal((await access('setup',{pin:'999999',confirmPin:'999999'})).status,409);
    for(let attempt=0;attempt<5;attempt++)assert.equal((await access('unlock',{pin:'999999'})).status,attempt===4?429:401);
    assert.equal((await access('unlock',{pin:'001234'})).status,429);
    state.pins.get('B1').locked_until=new Date(Date.now()-1000);
    const unlocked=await access('unlock',{pin:'001234'});assert.equal(unlocked.status,200);wallet=unlocked.headers.get('set-cookie').split(';')[0];assert.ok(unlocked.headers.get('set-cookie').includes('HttpOnly'));
    assert.equal((await request('/api/beneficiary/wallet','A',{},wallet)).status,200);
    assert.equal((await request('/api/beneficiary/wallet','B',{},wallet)).status,423);
    assert.equal((await request('/api/beneficiary/wallet','A2',{},wallet)).status,423);
    assert.equal((await request('/api/beneficiary/wallet','A',{},'gft_wallet_access=forged')).status,423);
    assert.equal((await request('/beneficiary-family.html','A',{},wallet)).status,200);
    assert.equal((await request('/api/beneficiary/wallet','A',{},wallet)).status,423);
    failEvent=true;assert.equal((await access('unlock',{pin:'001234'})).status,500);assert.equal(state.grants.size,0);failEvent=false;
    const grants=await access('unlock',{pin:'001234'});wallet=grants.headers.get('set-cookie').split(';')[0];for(const grant of state.grants.values())grant.expires=Date.now()-1000;assert.equal((await request('/api/beneficiary/wallet','A',{},wallet)).status,423);
    const textId=crypto.randomUUID();const text={text:'Hello family <script>fixture</script>',clientId:textId,sender_id:'B2',sender_name:'Impersonator'};
    const sent=await post('/family-chat/ama-2k/messages',text);assert.equal(sent.status,201);const message=(await sent.json()).message;assert.equal(message.sender_id,'B1');assert.equal(message.sender_name,'Fixture One');
    const repeated=await post('/family-chat/ama-2k/messages',text);assert.equal(repeated.status,200);assert.equal(state.messages.length,1);
    assert.equal((await post('/family-chat/elders/messages',text)).status,409);
    assert.equal((await post('/family-chat/elders/messages',{text:'Elders greeting',clientId:crypto.randomUUID()},'B')).status,201);
    assert.equal((await request('/api/beneficiary/family-chat/elders/messages','A')).status,200);
    assert.equal((await request('/api/beneficiary/family-chat/ama-2k/messages','')).status,401);
    assert.equal((await request('/api/beneficiary/family-chat/unknown/messages')).status,404);
    assert.equal((await request('/api/beneficiary/family-chat/ama-2k/messages?after=invalid')).status,400);
    assert.equal((await post('/family-chat/ama-2k/messages',{text:'x'.repeat(2001),clientId:crypto.randomUUID()})).status,400);
    const audio=Buffer.from('1a45dfa30000000000000000','hex');assert.equal(validAudio({buffer:audio,size:audio.length,mimetype:'audio/webm;codecs=opus'}),'audio/webm');assert.equal(validAudio({buffer:audio,size:audio.length,mimetype:'image/png'}),null);
    const data=new FormData();data.append('clientId',crypto.randomUUID());data.append('audio',new Blob([audio],{type:'audio/webm'}),'fixture.webm');assert.equal((await request('/api/beneficiary/family-chat/ama-2k/messages','A',{method:'POST',body:data})).status,201);
    const audioId=state.messages.at(-1).message_id;
    assert.equal((await request('/api/beneficiary/family-chat/audio/'+audioId,'')).status,401);
    const range=await request('/api/beneficiary/family-chat/audio/'+audioId,'B',{headers:{Range:'bytes=0-3'}});assert.equal(range.status,206);assert.equal(Buffer.from(await range.arrayBuffer()).toString('hex'),'1a45dfa3');
    assert.equal((await request('/api/beneficiary/family-chat/audio/'+audioId,'A',{headers:{Range:'bytes=9999-'}})).status,416);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

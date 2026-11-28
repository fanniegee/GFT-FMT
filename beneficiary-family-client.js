(() => {
  const $=id=>document.getElementById(id),base='/api/beneficiary';
  let room='ama-2k',last='0',first=null,loading=false,roomVersion=0,active=false;
  let recorder=null,stream=null,recordTimer=null,chunks=[],audioBlob=null,audioUrl=null,audioId=null,textId=null,textValue='';
  const seen=new Set();
  const message=value=>{$('familyChatStatus').textContent=value;};
  function announceLock(){if('BroadcastChannel' in window){const channel=new BroadcastChannel('gft-wallet-lock');channel.postMessage('locked');channel.close();}}
  async function lockWallet(){await api('/wallet-access/lock',{method:'POST'});announceLock();}
  async function api(path,options){const response=await fetch(base+path,{cache:'no-store',...options});if(response.status===401&&path!=='/wallet-access/lock'){location.replace('beneficiary-login.html');throw Error('Please sign in again.');}const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Unable to complete the request.');return data;}
  function avatar(id,name){const image=document.createElement('img');image.src=base+'/family-chat/avatar/'+encodeURIComponent(id);image.alt=name+' profile picture';image.loading='lazy';image.onerror=()=>{const fallback=document.createElement('span');fallback.className='family-avatar-fallback';fallback.textContent=(name||'G').trim().slice(0,1).toUpperCase();image.replaceWith(fallback);};return image;}
  function render(items,older=false){
    const target=$('familyMessages'),fragment=document.createDocumentFragment();
    for(const item of items){if(seen.has(String(item.message_id)))continue;seen.add(String(item.message_id));const row=document.createElement('article');row.className='family-message';row.append(avatar(item.sender_id,item.sender_name));const bubble=document.createElement('div');bubble.className='family-bubble';const name=document.createElement('strong');name.textContent=item.sender_name;bubble.append(name);
      if(item.kind==='audio'){const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=base+'/family-chat/audio/'+encodeURIComponent(item.message_id);bubble.append(audio);}else{const body=document.createElement('p');body.textContent=item.body;bubble.append(body);}
      const date=document.createElement('time');date.dateTime=item.created_at;date.textContent=new Date(item.created_at).toLocaleString();bubble.append(date);row.append(bubble);fragment.append(row);
      if(!first||BigInt(item.message_id)<BigInt(first))first=String(item.message_id);if(BigInt(item.message_id)>BigInt(last))last=String(item.message_id);
    }
    if(older){const height=target.scrollHeight;target.prepend(fragment);target.scrollTop+=target.scrollHeight-height;}else{const nearBottom=target.scrollHeight-target.scrollTop-target.clientHeight<150;target.append(fragment);if(nearBottom)target.scrollTop=target.scrollHeight;}
    if(!seen.size){target.textContent='No messages yet. Start a conversation with the family.';target.dataset.empty='true';}
  }
  async function load(older=false,initial=false){
    if(loading||!active)return;loading=true;const snapshot=roomVersion;
    try{const suffix=older&&first?'?before='+first:initial?'':'?after='+last;const result=await api('/family-chat/'+room+'/messages'+suffix);if(snapshot!==roomVersion)return;if($('familyMessages').dataset.empty==='true'){$('familyMessages').replaceChildren();delete $('familyMessages').dataset.empty;}render(result.messages,older);if(older&&!result.messages.length)message('You have reached the first messages in this room.');}
    catch(error){message(error.message);}finally{loading=false;}
  }
  function discard(){if(recorder?.state==='recording')recorder.stop();clearTimeout(recordTimer);stream?.getTracks().forEach(track=>track.stop());stream=null;audioBlob=null;audioId=null;if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=null;$('audioPreview').removeAttribute('src');$('audioPreview').hidden=true;$('audioActions').hidden=true;}
  async function chooseRoom(value){if(loading)return;roomVersion++;room=value;last='0';first=null;seen.clear();$('familyMessages').replaceChildren();$('familyText').value='';textId=null;discard();message('');document.querySelectorAll('[data-room]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.room===room)));await load(false,true);}
  document.querySelectorAll('[data-room]').forEach(button=>button.onclick=()=>chooseRoom(button.dataset.room));
  $('olderMessages').onclick=()=>load(true);
  $('familyTextForm').onsubmit=async event=>{event.preventDefault();const text=$('familyText').value.trim();if(!text)return;const button=$('sendFamilyText');button.disabled=true;const targetRoom=room;if(text!==textValue||!textId){textId=crypto.randomUUID();textValue=text;}try{await api('/family-chat/'+targetRoom+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,clientId:textId})});if(targetRoom===room){$('familyText').value='';textId=null;message('');await load();}}catch(error){message(error.message);}finally{button.disabled=false;}};
  $('recordFamilyAudio').onclick=async()=>{
    if(recorder?.state==='recording'){recorder.stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){message('Audio recording is not supported in this browser. You can still send text messages.');return;}
    const button=$('recordFamilyAudio');button.disabled=true;
    try{
      discard();const recordingRoomVersion=roomVersion;stream=await navigator.mediaDevices.getUserMedia({audio:true});if(recordingRoomVersion!==roomVersion){stream.getTracks().forEach(track=>track.stop());stream=null;return;}chunks=[];
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
      recorder=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:64000}:undefined);
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onstop=()=>{clearTimeout(recordTimer);stream?.getTracks().forEach(track=>track.stop());stream=null;button.textContent='Record audio';if(recordingRoomVersion!==roomVersion)return;audioBlob=new Blob(chunks,{type:recorder.mimeType});if(!audioBlob.size||audioBlob.size>5*1024*1024){discard();message('Recording is empty or too large. Please record a shorter message.');return;}audioId=crypto.randomUUID();audioUrl=URL.createObjectURL(audioBlob);$('audioPreview').src=audioUrl;$('audioPreview').hidden=false;$('audioActions').hidden=false;message('Listen to your recording, then choose Send audio or Discard.');};
      recorder.start();button.textContent='Stop recording';message('Recording… Press Stop recording when finished.');recordTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},120000);
    }catch(error){stream?.getTracks().forEach(track=>track.stop());message(error.name==='NotAllowedError'?'Microphone access was not allowed. Enable it in your browser settings to record.':'Unable to start the microphone.');}finally{button.disabled=false;}
  };
  $('discardFamilyAudio').onclick=()=>{discard();message('Recording discarded.');};
  $('sendFamilyAudio').onclick=async()=>{if(!audioBlob)return;const button=$('sendFamilyAudio'),targetRoom=room;button.disabled=true;const data=new FormData();data.append('clientId',audioId);data.append('audio',audioBlob,'family-recording.'+(audioBlob.type.includes('mp4')?'m4a':audioBlob.type.includes('ogg')?'ogg':'webm'));try{await api('/family-chat/'+targetRoom+'/messages',{method:'POST',body:data});discard();message('Audio sent.');if(targetRoom===room)await load();}catch(error){message(error.message);}finally{button.disabled=false;}};
  $('saveFamilyPhoto').onclick=async()=>{const file=$('familyProfileFile').files[0],status=$('profileMessage'),button=$('saveFamilyPhoto');if(!file){status.textContent='Choose your picture first.';return;}button.disabled=true;try{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error('Choose a JPG, PNG or WebP picture under 8 MB.');const image=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=canvas.height=320;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,320,320);const scale=Math.max(320/image.width,320/image.height);ctx.drawImage(image,(320-image.width*scale)/2,(320-image.height*scale)/2,image.width*scale,image.height*scale);image.close();const data=canvas.toDataURL('image/jpeg',0.85).split(',')[1];await api('/profile/photo',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:data})});$('familyProfileImage').src=base+'/profile/photo?v='+Date.now();status.textContent='Your profile picture is saved.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
  $('familySignOut').onclick=async()=>{try{await api('/logout',{method:'POST'});location.replace('beneficiary-login.html');}catch(error){message(error.message);}};
  window.addEventListener('pagehide',()=>{clearTimeout(recordTimer);if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(track=>track.stop());});
  window.addEventListener('pageshow',event=>{if(event.persisted)lockWallet().catch(error=>message(error.message));});
  window.addEventListener('focus',()=>{if(active)lockWallet().catch(error=>message(error.message));});
  setInterval(()=>{if(!document.hidden)load();},10000);
  (async()=>{try{await lockWallet();const result=await api('/me');$('familyName').textContent=result.beneficiary.fullName||'Family member';$('familySystemId').textContent=result.beneficiary.systemId||'';$('familyProfileImage').src=base+'/profile/photo';$('familyProfileImage').onerror=()=>{$('familyProfileImage').onerror=null;$('familyProfileImage').src='/assets/gft-app-192.png';};active=true;await load(false,true);}catch(error){message(error.message);}})();
})();

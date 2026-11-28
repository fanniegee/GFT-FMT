(() => {
  const form=document.getElementById('walletPinForm');
  async function status(){const response=await fetch('/api/beneficiary/wallet-access/status',{cache:'no-store'});if(response.status===401){location.replace('beneficiary-login.html');return null;}const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to check wallet access.');return data;}
  if(form){let setup=false;
    status().then(data=>{if(!data)return;if(data.unlocked){location.replace('beneficiary-portal.html');return;}setup=!data.pinSet;document.getElementById('walletGateTitle').textContent=setup?'Create your wallet PIN':'Wallet Login';document.getElementById('walletGateHelp').textContent=setup?'Choose a private six-digit PIN. This protects your wallet separately from Family Chat.':'Enter your six-digit PIN to open your personal wallet.';document.getElementById('confirmPinLabel').hidden=!setup;document.getElementById('walletConfirmPin').required=setup;document.getElementById('walletUnlockButton').textContent=setup?'Create PIN & open wallet':'Unlock wallet';form.hidden=false;}).catch(error=>document.getElementById('walletGateStatus').textContent=error.message);
    form.onsubmit=async event=>{event.preventDefault();const button=document.getElementById('walletUnlockButton'),message=document.getElementById('walletGateStatus');button.disabled=true;const pin=document.getElementById('walletPin').value;try{
      if(setup){const response=await fetch('/api/beneficiary/wallet-access/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin,confirmPin:document.getElementById('walletConfirmPin').value})});const result=await response.json();if(!response.ok)throw Error(result.error);setup=false;document.getElementById('confirmPinLabel').hidden=true;document.getElementById('walletConfirmPin').required=false;}
      const response=await fetch('/api/beneficiary/wallet-access/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});const result=await response.json();if(!response.ok)throw Error(result.error);form.reset();location.replace('beneficiary-portal.html');
    }catch(error){message.textContent=error.message||'Unable to unlock the wallet.';document.getElementById('walletPin').value='';document.getElementById('walletConfirmPin').value='';}finally{button.disabled=false;}};
  }else{
    let checking=false;
    async function check(){if(checking)return;checking=true;try{const data=await status();if(!data)return;if(!data.unlocked){document.body.style.visibility='hidden';location.replace('beneficiary-wallet-login.html');return;}document.body.style.visibility='visible';}catch{document.body.style.visibility='hidden';location.replace('beneficiary-wallet-login.html');}finally{checking=false;}}
    window.addEventListener('pagehide',()=>{document.body.style.visibility='hidden';});window.addEventListener('pageshow',check);window.addEventListener('focus',check);
    if('BroadcastChannel' in window){const channel=new BroadcastChannel('gft-wallet-lock');channel.onmessage=event=>{if(event.data==='locked'){document.body.style.visibility='hidden';location.replace('beneficiary-family.html');}};}
    setInterval(check,60000);check();
  }
})();

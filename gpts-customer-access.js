(() => {
  'use strict';
  const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
  let token=params.get('token')||'',mode='login';const requested=params.get('action');
  // Remove email-link secrets from the address bar without consuming the link on GET.
  if(params.has('token'))history.replaceState(null,'',location.pathname);
  const forms=['registerForm','loginForm','emailForm','verifyForm','resetForm'];
  function status(message){$('accessStatus').textContent=message;}
  function show(value){mode=value;for(const id of forms)$(id).hidden=true;
    const ids={register:'registerForm',login:'loginForm',forgot:'emailForm',resend:'emailForm',verify:'verifyForm',reset:'resetForm'};
    $(ids[value]||'loginForm').hidden=false;
    $('accessTitle').textContent=({register:'Create your GPTS account',login:'Sign in to GPTS',forgot:'Reset your password',resend:'Verify your email',verify:'Confirm your email',reset:'Choose a new password'})[value]||'GPTS Account';
    $('emailAction').textContent=value==='resend'?'Resend verification':'Send password reset link';
    for(const button of document.querySelectorAll('[role=tab]'))button.setAttribute('aria-selected',String(button.dataset.mode===value));
  }
  for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>show(button.dataset.mode);
  const service=params.get('service');if(['TECHNOLOGY','PAYMENTS','BOTH'].includes(service))$('registerService').value=service;
  async function submit(form,path,body,onSuccess){
    const button=form.querySelector('button[type=submit]');button.disabled=true;status('Please wait…');
    try{const response=await fetch('/api/gpts-payments/auth/'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Unable to complete the request.');form.reset();status(data.message||'Done.');onSuccess?.();}catch(error){status(error.message);}finally{button.disabled=false;}
  }
  $('registerForm').onsubmit=event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form));if(data.password!==data.confirmPassword){status('The passwords do not match.');return;}delete data.confirmPassword;data.acknowledge=data.acknowledge==='on';submit(form,'register',data,()=>show('login'));};
  $('loginForm').onsubmit=event=>{event.preventDefault();submit(event.currentTarget,'login',Object.fromEntries(new FormData(event.currentTarget)),()=>location.replace('gpts-customer.html'));};
  $('emailForm').onsubmit=event=>{event.preventDefault();submit(event.currentTarget,mode==='resend'?'resend-verification':'forgot-password',Object.fromEntries(new FormData(event.currentTarget)));};
  $('verifyForm').onsubmit=event=>{event.preventDefault();submit(event.currentTarget,'verify-email',{token},()=>{token='';show('login');});};
  $('resetForm').onsubmit=event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));if(data.password!==data.confirmPassword){status('The passwords do not match.');return;}submit(event.currentTarget,'reset-password',{token,password:data.password},()=>{token='';show('login');});};
  show(token&&requested==='verify'?'verify':token&&requested==='reset'?'reset':params.get('mode')==='register'?'register':'login');
})();

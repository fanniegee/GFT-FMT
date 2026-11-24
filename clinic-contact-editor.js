(() => {
  const form=document.getElementById('contactEditor'),status=document.getElementById('contactStatus');let version=0;
  async function api(path,options){const response=await fetch('/api/clinic/public/contact'+path,{cache:'no-store',...options});const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to load contact settings.');return result;}
  async function load(){try{await api('/authority');const result=await api('');version=result.version;for(const key of ['phone','email','whatsapp','address','hours'])form.elements[key].value=result.contact[key]||'';form.hidden=false;status.textContent='Changes appear on the public Clinic pages after saving.';}catch(error){form.hidden=true;status.textContent=error.message;}}
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;try{const result=await api('',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({contact:Object.fromEntries(new FormData(form)),version})});version=result.version;status.textContent='Clinic contact details saved.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
  document.getElementById('reloadContacts').onclick=load;load();
})();

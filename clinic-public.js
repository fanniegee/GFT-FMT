(() => {
  const nav=document.querySelector('.cp-top'),button=nav?.querySelector('.cp-menu'),links=nav?.querySelector('.cp-nav');
  if(button&&links){nav.dataset.ready='true';button.onclick=()=>{const open=links.classList.toggle('is-open');button.setAttribute('aria-expanded',String(open));};nav.addEventListener('keydown',e=>{if(e.key==='Escape'){links.classList.remove('is-open');button.setAttribute('aria-expanded','false');button.focus();}});}
  const targets=[...document.querySelectorAll('[data-clinic-contact]')];
  if(!targets.length)return;
  fetch('/api/clinic/public/contact',{cache:'no-store'}).then(async response=>{
    if(!response.ok)throw Error();const {contact}=await response.json();
    for(const target of targets){target.replaceChildren();for(const [key,label] of [['phone','Telephone'],['email','Email'],['whatsapp','WhatsApp'],['address','Visit us'],['hours','Opening hours']]){
      const card=document.createElement('div');card.className='cp-card';const title=document.createElement('h3');title.textContent=label;const value=document.createElement('p');value.textContent=contact[key]||'Details will be published here.';
      if(contact[key]&&['phone','email','whatsapp'].includes(key)){const link=document.createElement('a');link.textContent=contact[key];link.href=key==='email'?'mailto:'+contact[key]:key==='whatsapp'?'https://wa.me/'+contact[key].replace(/\D/g,''):'tel:'+contact[key].replace(/[^+\d]/g,'');value.replaceChildren(link);}card.append(title,value);target.append(card);
    }}
  }).catch(()=>targets.forEach(target=>target.textContent='Contact details are temporarily unavailable. Please try again later.'));
})();

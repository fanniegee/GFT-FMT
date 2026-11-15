(() => {
  const root=document.getElementById('familyCorrections');
  if(!root) return;
  const base='/api/admin/family-corrections';
  const results=document.getElementById('familyCorrectionResults');
  const history=document.getElementById('familyCorrectionHistory');
  const search=document.getElementById('familyCorrectionSearch');

  async function request(path,body){
    const response=await fetch(base+path,body ? {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
    } : {cache:'no-store'});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw Error(result.error || 'Family corrections unavailable.');
    return result;
  }

  function button(row,label,action){
    const control=document.createElement('button');
    control.type='button';
    control.textContent=label;
    control.onclick=async()=>{
      control.disabled=true;
      try { await action(); }
      catch(error){alert(error.message);}
      finally{control.disabled=false;}
    };
    row.append(' ',control);
  }

  async function propose(person){
    const fullName=prompt('Corrected official name:',person.full_name)?.trim();
    if(!fullName) return;
    const parent=prompt('Verified parent GFT ID:',person.parent_system_id || '');
    if(parent===null) return;
    const reason=prompt('Reason and evidence reference for the correction:')?.trim();
    if(!reason) return;
    await request('',{systemId:person.system_id,fullName,parentId:parent.trim().toUpperCase() || null,reason});
    await refresh();
  }

  async function refresh(){
    history.textContent='Loading corrections…';
    try {
      const {requests,canDecide}=await request('');
      history.textContent=requests.length?'':'No correction requests recorded.';
      for(const change of requests){
        const row=document.createElement('p');
        const data=change.requested_changes;
        row.textContent=[change.target_system_id,data.fullName,'Parent '+(data.parentId || '—'),change.status,change.reason].join(' · ');
        if(canDecide && change.status==='PENDING_REVIEW'){
          for(const decision of ['APPROVED','REJECTED']){
            button(row,decision==='APPROVED'?'Approve correction':'Reject correction',async()=>{
              const reason=prompt('Reason for this decision:')?.trim();
              if(!reason) return;
              await request('/'+encodeURIComponent(change.correction_id)+'/decision',{decision,reason});
              await refresh();
            });
          }
        }
        history.append(row);
      }
    } catch(error){history.textContent=error.message;}
  }

  search.onsubmit=async event=>{
    event.preventDefault();
    const term=search.elements.namedItem('query').value.trim();
    results.textContent='Looking up official family records…';
    try {
      const {people}=await request('/people?q='+encodeURIComponent(term));
      results.textContent=people.length?'':'No matching family records.';
      for(const person of people){
        const row=document.createElement('p');
        row.textContent=[person.full_name,person.system_id,'Parent '+(person.parent_system_id || '—')].join(' · ');
        button(row,'Request correction',()=>propose(person));
        results.append(row);
      }
    } catch(error){results.textContent=error.message;}
  };
  document.getElementById('familyCorrectionRefresh').onclick=refresh;
})();


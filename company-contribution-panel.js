(() => {
  const base='/api/admin/company-contributions';
  const panel=document.getElementById('companyContributions');
  if(!panel) return;

  async function request(path, body){
    const options=body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {cache:'no-store'};
    const response=await fetch(base+path,options);
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw Error(data.error || 'Company contributions unavailable.');
    return data;
  }

  function button(container,label,callback){
    const control=document.createElement('button');
    control.type='button';
    control.textContent=label;
    control.onclick=async()=>{
      control.disabled=true;
      try { await callback(); }
      catch(error){alert(error.message);}
      finally{control.disabled=false;}
    };
    container.append(' ',control);
  }

  async function decide(report, action){
    const reason=prompt('Enter the reason and supporting reference:')?.trim();
    if(!reason) return;
    await request('/reports/'+encodeURIComponent(report.id)+'/'+action,{reason});
    await load();
  }

  async function load(){
    const content=document.getElementById('companyContributionContent');
    content.textContent='Loading monthly contributions…';
    try{
      const {founder,companies,reports}=await request('');
      content.textContent=companies.length?'':'No active company records available.';
      if(founder){
        button(content,'Register company',async()=>{
          const name=prompt('Registered company name:')?.trim();
          if(!name) return;
          const systemId=prompt('Company identifier (GFT-CO-…):')?.trim();
          if(!systemId) return;
          await request('/companies',{name,systemId});
          await load();
        });
      }
      for(const company of companies){
        const card=document.createElement('section');
        const heading=document.createElement('h3');
        heading.textContent=company.name;
        const rate=document.createElement('p');
        rate.textContent=company.rate===null?'Contribution percentage unassigned':company.rate+'% of monthly net profit';
        card.append(heading,rate);

        if(founder){
          button(card,'Configure contribution',async()=>{
            const rate=prompt('Designated percentage of monthly net profit:',company.rate ?? '')?.trim();
            if(!rate) return;
            const accountsId=prompt('Trust Admin ID for this company’s Accounts team:',company.accountsId ?? '')?.trim();
            if(!accountsId) return;
            await request('/companies/'+encodeURIComponent(company.id)+'/settings',{rate,accountsId});
            await load();
          });
        }

        if(company.accounts && company.rate!==null){
          button(card,'Submit monthly profit',async()=>{
            const month=prompt('Completed reporting month (YYYY-MM):')?.trim();
            if(!month) return;
            const profit=prompt('Net profit or loss in USD:')?.trim();
            if(!profit) return;
            const evidence=prompt('Financial statement reference for Trust Audit:')?.trim();
            if(!evidence) return;
            await request('/companies/'+encodeURIComponent(company.id)+'/reports',{month,profit,evidence});
            await load();
          });
        }

        for(const report of reports.filter(row=>row.companyId===company.id)){
          const line=document.createElement('p');
          line.textContent=[report.month,'Net profit USD '+report.profit,'Contribution USD '+report.contribution,report.status,report.evidence].join(' · ');
          if(report.canVerify && !company.accounts){
            button(line,'Verify profit',()=>decide(report,'verify'));
            button(line,'Reject report',()=>decide(report,'reject'));
          }
          if(company.accounts && report.status==='AUDIT_VERIFIED') button(line,'Approve contribution',()=>decide(report,'approve'));
          if(founder && report.status==='APPROVED') button(line,'Post contribution to Trust ledger',()=>decide(report,'post'));
          card.append(line);
        }
        content.append(card);
      }
    }catch(error){content.textContent=error.message;}
  }

  document.getElementById('refreshCompanyContributions').onclick=load;
  window.loadCompanyContributions=load;
})();


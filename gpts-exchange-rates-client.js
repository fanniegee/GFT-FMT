(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = { USD:'US dollar', ZAR:'South African rand', BWP:'Botswana pula', 'ZMW/ZMK':'Zambian kwacha', 'MZN/MET':'Mozambican metical' };
  const node = (tag,value,cls) => { const el=document.createElement(tag); el.textContent=value; if(cls)el.className=cls; return el; };
  let loading=false;
  function values(bid,ask,mid) {
    const row=node('div','','rate-values');
    for(const [label,value] of [['Bid',bid],['Ask',ask],['Mid',mid]]) {const cell=node('div','');cell.append(node('small',label),node('strong',value));row.append(cell);}
    return row;
  }
  async function load() {
    if(loading||document.hidden)return;loading=true;
    try {
      const response=await fetch('/api/gpts-payments/rates',{cache:'no-store'}),data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'Official rates are temporarily unavailable.');
      const url=new URL(data.sourceUrl); if(url.origin!=='https://www.rbz.co.zw')throw Error('Official source could not be verified.');
      $('rateSource').href=url.href;
      $('rateMetadata').textContent=`Published: ${data.publishedDate} · Retrieved: ${new Date(data.fetchedAt).toLocaleString()} · Source check: ${new Date(data.checkedAt).toLocaleString()}`;
      $('rateStatus').textContent=data.refreshFailed?'Source refresh failed. Showing the last successfully retrieved report; see its publication date.':data.ageDays>7?'The latest retrieved report is over seven days old. Check its date before relying on it.':'Latest published report checked. The publication date may precede today on weekends or holidays.';
      const cards=data.rates.map(rate=>{const card=node('article','','rate-card');card.append(node('h3',`${rate.currency} · ${names[rate.currency]||rate.currency}`),node('p','International columns — as published','rate-label'),values(rate.bid,rate.ask,rate.mid),node('p','ZWG columns — as published','rate-label'),values(rate.zwgBid,rate.zwgAsk,rate.zwgMid));return card;});
      $('rateGrid').replaceChildren(...cards);
    } catch(error) { $('rateStatus').textContent=$('rateGrid').children.length?'Refresh unavailable. The displayed report has not been updated; check its publication date.':error.message; }
    finally{loading=false;}
  }
  window.addEventListener('pageshow',load);document.addEventListener('visibilitychange',load);setInterval(load,5*60*1000);load();
})();

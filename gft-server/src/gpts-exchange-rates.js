import { createHash } from 'node:crypto';

const source = 'https://www.rbz.co.zw/';
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const iso = (year, month, day) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
function validateDate(year, month, day, now) {
  const date = iso(year, month, day), parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date || date > new Date(now+2*60*60*1000).toISOString().slice(0,10)) throw Error('Invalid publication date');
  return date;
}
export function discoverReport(html, now = Date.now()) {
  const plain = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ');
  const match = plain.match(/EXCHANGE\s+RATES\s+(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})/i);
  if (!match) throw Error('RBZ publication date unavailable');
  const [, day, month, year] = match, date = validateDate(+year,+month,+day,now);
  return { date, url: `${source}documents/Exchange_Rates/${year}/${months[+month-1]}/RATES_${String(+day).padStart(2,'0')}_${months[+month-1].toUpperCase()}_${year}.pdf` };
}
export function parseReport(text, expectedDate) {
  if (!/INTERBANK\s+(?:EXCHANGE\s+)?RATE/i.test(text) || !/CURRENCY\s+INDICES\s+BID\s+ASK\s+MID RATE\s+BID RATE\s+ASK RATE\s+MID RATE/i.test(text)) throw Error('Unrecognized RBZ table layout');
  const monthFirst = text.match(new RegExp(`\\b(${months.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`,'i'));
  const dayFirst = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${months.join('|')}),?\\s+(\\d{4})\\b`,'i'));
  const dateMatch = monthFirst || (dayFirst && [dayFirst[0],dayFirst[2],dayFirst[1],dayFirst[3]]);
  if (!dateMatch) throw Error('Report date missing');
  const month = months.findIndex(name => name.toLowerCase() === dateMatch[1].toLowerCase()) + 1;
  if (iso(+dateMatch[3],month,+dateMatch[2]) !== expectedDate) throw Error('Report date mismatch');
  const keys = ['USD','ZAR','BWP','ZMW/ZMK','MZN/MET'], rates = [];
  const numeric = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
  for (const currency of keys) {
    const rows = text.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => parts[0] === currency);
    if (rows.length !== 1) throw Error('Required regional currency missing or duplicated');
    const values = rows[0].slice(1);
    if (values.length !== 6 || !values.every(value => numeric.test(value) && Number(value.replaceAll(',','')) > 0)) throw Error('Invalid rate row');
    const [bid,ask,mid,zwgBid,zwgAsk,zwgMid] = values;
    for (const [low,high,average] of [[bid,ask,mid],[zwgBid,zwgAsk,zwgMid]]) if (!(Number(low.replaceAll(',','')) <= Number(average.replaceAll(',','')) && Number(average.replaceAll(',','')) <= Number(high.replaceAll(',','')))) throw Error('Invalid bid/ask order');
    rates.push({ currency, bid, ask, mid, zwgBid, zwgAsk, zwgMid });
  }
  return rates;
}
async function boundedFetch(url, maxSize, timeoutMs = 15000) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://www.rbz.co.zw') throw Error('Invalid rate source');
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { Accept: url.endsWith('.pdf') ? 'application/pdf' : 'text/html' } });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > maxSize) throw Error('RBZ source unavailable');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > maxSize) { await response.body.cancel().catch(()=>{}); throw Error('Rate source too large'); } chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function fetchRbzReport({ now = Date.now(), download = boundedFetch, extract } = {}) {
  const deadline = Date.now()+30000;
  if (!extract) extract = async data => {
    const { PDFParse } = await import('pdf-parse'); const parser = new PDFParse({ data });
    try { return (await parser.getText()).text; } finally { await parser.destroy(); }
  };
  let advertised;
  try { advertised=discoverReport((await download(source,2_000_000,10000)).toString('utf8'),now); } catch { /* Public report files can remain available when the HTML index is unavailable. */ }
  const candidates=[];
  const harareDay=new Date(now+2*60*60*1000).toISOString().slice(0,10);
  // Check real dated publications, newest first. A candidate date is never a rate.
  for(let days=0;days<10;days++) {
    const day=new Date(Date.parse(harareDay+'T00:00:00Z')-days*86400000),date=day.toISOString().slice(0,10);
    candidates.push({date,url:`${source}documents/Exchange_Rates/${day.getUTCFullYear()}/${months[day.getUTCMonth()]}/RATES_${String(day.getUTCDate()).padStart(2,'0')}_${months[day.getUTCMonth()].toUpperCase()}_${day.getUTCFullYear()}.pdf`});
  }
  if(advertised&&!candidates.some(item=>item.date===advertised.date))candidates.push(advertised);
  for(const report of candidates){
    if(Date.now()>=deadline)break;
    try {
      const pdf=await download(report.url,3_000_000,Math.max(1,Math.min(10000,deadline-Date.now())));
      if(pdf.subarray(0,5).toString()!=='%PDF-')continue;
      const rates=parseReport(await extract(pdf),report.date);
      return {publishedDate:report.date,sourceUrl:report.url,sourceHash:createHash('sha256').update(pdf).digest('hex'),rates};
    }catch { /* Never substitute values from a missing, blocked or invalid report. */ }
  }
  throw Error('No valid official report could be retrieved');
}
export function installGptsExchangeRates(app, { query, loadReport = fetchRbzReport, now = Date.now }) {
  let ready, pending, checkedAt = null, refreshFailed = false;
  function schema() {
    ready ??= query(`CREATE TABLE IF NOT EXISTS gpts_reference_rate_reports(
      source_hash CHAR(64) PRIMARY KEY,published_date DATE NOT NULL,source_url TEXT NOT NULL,
      rates JSONB NOT NULL,fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(error => { ready = undefined; throw error; });
    return ready;
  }
  async function refresh() {
    if (checkedAt !== null && now()-checkedAt < 15*60*1000) return;
    pending ??= (async()=>{
      try {
        const report = await loadReport({ now: now() });
        await query(`INSERT INTO gpts_reference_rate_reports(source_hash,published_date,source_url,rates) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(source_hash) DO NOTHING`, [report.sourceHash,report.publishedDate,report.sourceUrl,JSON.stringify(report.rates)]);
        refreshFailed = false;
      } catch (error) { refreshFailed = true; console.error('RBZ rates refresh failed:', error.name); }
      finally { checkedAt = now(); }
    })().finally(()=>{pending=null;});
    await pending;
  }
  app.get('/api/gpts-payments/rates', async (_req,res) => {
    res.set('Cache-Control','no-store');
    try {
      await schema(); await refresh();
      const { rows } = await query('SELECT published_date::text AS published_date,source_url,rates,fetched_at FROM gpts_reference_rate_reports ORDER BY published_date DESC,fetched_at DESC LIMIT 1');
      if (!rows.length) return res.status(503).json({ ok:false,error:'Official rates are temporarily unavailable.',sourceUrl:source });
      const report = rows[0], ageDays = Math.floor((now()-Date.parse(report.published_date+'T00:00:00Z'))/86400000);
      res.json({ ok:true, sourceName:'Reserve Bank of Zimbabwe', sourceUrl:report.source_url,
        publishedDate:report.published_date, fetchedAt:report.fetched_at, checkedAt:new Date(checkedAt).toISOString(),
        refreshFailed, ageDays, referenceOnly:true, rates:report.rates });
    } catch (error) { console.error('Official rates unavailable:',error.name); res.status(503).json({ ok:false,error:'Official rates are temporarily unavailable.',sourceUrl:source }); }
  });
}

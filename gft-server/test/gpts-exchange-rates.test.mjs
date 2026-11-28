import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { discoverReport,parseReport,fetchRbzReport,installGptsExchangeRates } from '../src/gpts-exchange-rates.js';

// Isolated parser fixtures. No fixture rate is shipped to the public board.
const now=Date.parse('2026-11-28T12:00:00Z');
const reportText=`CURRENCY INDICES BID ASK MID RATE BID RATE ASK RATE MID RATE
ZWG ZWG ZWG
INTERBANK RATE
USD 1 1 1 25 27 26
ZAR 17 19 18 1 3 2
BWP 0.06 0.08 0.07 1 3 2
ZMW/ZMK 20 22 21 1 3 2
MZN/MET 60 64 62 1 3 2
Friday, November 27, 2026`;
test('official report discovery and parsing reject incorrect dates, missing rows and changed layouts',async()=>{
  const discovered=discoverReport('<b>EXCHANGE RATES <span>27</span>-11-2026</b>',now);
  assert.equal(discovered.date,'2026-11-27');assert.match(discovered.url,/RATES_27_NOVEMBER_2026.pdf$/);
  assert.throws(()=>discoverReport('EXCHANGE RATES 31-02-2026',now));
  assert.throws(()=>discoverReport('EXCHANGE RATES 30-11-2026',now));
  assert.throws(()=>discoverReport('Access verification required',now));
  assert.throws(()=>parseReport(reportText,'2026-11-26'));
  assert.throws(()=>parseReport(reportText.replace('MZN/MET','UNKNOWN'),'2026-11-27'));
  assert.throws(()=>parseReport(reportText.replace('25 27 26','28 27 26'),'2026-11-27'));
  assert.throws(()=>parseReport(reportText.replace('CURRENCY INDICES','Different header'),'2026-11-27'));
  const parsed=parseReport(reportText,'2026-11-27');assert.equal(parsed.length,5);assert.equal(parsed[1].bid,'17');
  assert.equal(parseReport(reportText.replace('November 27, 2026','27 November 2026'),'2026-11-27').length,5);
  assert.equal(parsed[1].zwgMid,'2','published data is retained without deriving a customer quote');
  const result=await fetchRbzReport({now,download:async url=>Buffer.from(url.endsWith('.pdf')?'%PDF-test':'EXCHANGE RATES 27-11-2026'),extract:async()=>reportText});
  assert.equal(result.rates.length,5);assert.equal(result.sourceHash.length,64);
  const attempted=[];
  const fallback=await fetchRbzReport({now,download:async url=>{attempted.push(url);if(!url.endsWith('RATES_27_NOVEMBER_2026.pdf'))throw Error('Unavailable publication');return Buffer.from('%PDF-test');},extract:async()=>reportText});
  assert.equal(fallback.publishedDate,'2026-11-27');assert.equal(attempted.length,3,'checks source, current day, then previous published day');
  await assert.rejects(fetchRbzReport({now,download:async url=>Buffer.from(url.endsWith('.pdf')?'Access denied':'EXCHANGE RATES 27-11-2026'),extract:async()=>reportText}));
});
test('public board caches verified reports, marks failed refreshes and returns no invented fallback',async()=>{
  let clock=now,loadCalls=0,fail=false,stored=[];
  const query=async(sql,args=[])=>{
    if(sql.startsWith('CREATE'))return {rows:[]};
    if(sql.startsWith('INSERT')){stored=[{published_date:args[1],source_url:args[2],rates:JSON.parse(args[3]),fetched_at:new Date(clock).toISOString()}];return {rows:[]};}
    if(sql.startsWith('SELECT'))return {rows:stored};throw Error('Unexpected query');
  };
  const app=express();installGptsExchangeRates(app,{query,now:()=>clock,loadReport:async()=>{loadCalls++;if(fail)throw Error('Isolated source failure');return {publishedDate:'2026-11-27',sourceUrl:'https://www.rbz.co.zw/report.pdf',sourceHash:'a'.repeat(64),rates:parseReport(reportText,'2026-11-27')};}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const request=()=>fetch('http://127.0.0.1:'+server.address().port+'/api/gpts-payments/rates');
  try {
    const responses=await Promise.all([request(),request()]);const data=await responses[0].json();assert.equal(data.referenceOnly,true);assert.equal(data.refreshFailed,false);assert.equal(loadCalls,1);
    assert.equal(responses[0].headers.get('cache-control'),'no-store');
    await request();assert.equal(loadCalls,1);
    fail=true;clock+=16*60*1000;
    const cached=await(await request()).json();assert.equal(cached.refreshFailed,true);assert.equal(cached.publishedDate,'2026-11-27');assert.equal(cached.fetchedAt,data.fetchedAt);
    stored=[];clock+=16*60*1000;const unavailable=await request();assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).rates,undefined);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

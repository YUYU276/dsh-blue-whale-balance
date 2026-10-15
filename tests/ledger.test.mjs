import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decimalDelta,decimalSum,emptyLedger,loadLedger,recordBalance,sevenDays,DEFAULT_PREFS,loadPreferences,lowBalanceEvents} from '../lib/ledger.js';
const a='a'.repeat(24), b='b'.repeat(24);
const snapshot=(total,checkedAt='2026-10-14T01:00:00.000Z',keyId=a,currency='CNY')=>({keyId,checkedAt,available:true,balances:[{currency,total}]});
test('decimal money never rounds cumulative small changes or large values',()=>{
  assert.equal(decimalDelta('10.0000','9.9999'),'0.0001');
  assert.equal(decimalDelta('-0.0001','0.0002'),'-0.0003');
  assert.equal(decimalSum('999999999999999999.9999','0.0001'),'1000000000000000000');
  let value='0';for(let i=0;i<1000;i++)value=decimalSum(value,'0.0001');assert.equal(value,'0.1');
});
test('recharge increases and key rotations are separate from observed declines',()=>{
  let ledger=recordBalance(emptyLedger(),snapshot('10'));
  ledger=recordBalance(ledger,snapshot('9.9999','2026-10-14T01:01:00.000Z'));
  ledger=recordBalance(ledger,snapshot('20','2026-10-14T01:02:00.000Z'));
  ledger=recordBalance(ledger,snapshot('2','2026-10-14T01:03:00.000Z',b));
  assert.deepEqual(ledger.accounts[a].days['2026-10-14'].CNY,{decrease:'0.0001',increase:'10.0001',comparisons:2});
  assert.equal(ledger.accounts[b].points[0].changes[0].kind,'baseline');
  assert.equal(ledger.accounts[b].days['2026-10-14'].CNY.comparisons,0);
  ledger=recordBalance(ledger,snapshot('19','2026-10-14T01:04:00.000Z'));
  assert.equal(ledger.accounts[a].days['2026-10-14'].CNY.decrease,'1.0001');
});
test('missing identity, duplicate or stale responses cannot create accounting entries',()=>{
  const ledger=recordBalance(emptyLedger(),snapshot('10'));
  assert.equal(recordBalance(ledger,snapshot('1','2026-10-14T01:00:00.000Z')),ledger);
  assert.equal(recordBalance(ledger,snapshot('1','2026-10-13T00:00:00.000Z')),ledger);
  assert.equal(recordBalance(ledger,{...snapshot('1'),keyId:undefined}),ledger);
  assert.equal(recordBalance(ledger,{...snapshot('1'),keyId:'__proto__'}),ledger);
});
test('currencies are never summed together and a newly appearing currency gets a baseline',()=>{
  let ledger=recordBalance(emptyLedger(),snapshot('10'));
  ledger=recordBalance(ledger,{...snapshot('9','2026-10-14T01:01:00.000Z'),balances:[{currency:'CNY',total:'9'},{currency:'USD',total:'100'}]});
  assert.equal(ledger.accounts[a].days['2026-10-14'].CNY.decrease,'1');
  assert.equal(ledger.accounts[a].days['2026-10-14'].USD.comparisons,0);
});
test('seven-day chart uses Beijing dates, leaves gaps unknown, and preserves daily aggregates after detail trimming',()=>{
  let ledger=recordBalance(emptyLedger(),snapshot('1000','2026-10-13T16:00:00.000Z'));
  assert.ok(ledger.accounts[a].days['2026-10-14']);
  let days=sevenDays(ledger.accounts[a],'CNY','2026-10-14T01:00:00Z');
  assert.equal(days.length,7);assert.ok(days.every(day=>day.decrease===null));
  for(let i=1;i<=300;i++)ledger=recordBalance(ledger,snapshot(String(1000-i),new Date(Date.parse('2026-10-13T16:00:00Z')+i*15000).toISOString()));
  assert.equal(ledger.accounts[a].points.length,240);
  assert.equal(ledger.accounts[a].days['2026-10-14'].CNY.decrease,'300');
  days=sevenDays(ledger.accounts[a],'CNY','2026-10-14T01:00:00Z');assert.equal(days.at(-1).decrease,'300');
});
test('corrupt or disabled persistence falls back safely and valid ledger round-trips',()=>{
  for(const text of ['bad','null','{}',JSON.stringify({version:1,accounts:{[a]:{startedAt:'x',points:[],days:{}}}})])assert.deepEqual(loadLedger({getItem:()=>text}),emptyLedger());
  assert.deepEqual(loadLedger({getItem:()=>{throw new Error('denied');}}),emptyLedger());
  const value=recordBalance(emptyLedger(),snapshot('1.2345'));
  assert.deepEqual(loadLedger({getItem:()=>JSON.stringify(value)}),value);
  const damaged=structuredClone(value);damaged.accounts[a].points[0].balances[0].total='oops';assert.deepEqual(loadLedger({getItem:()=>JSON.stringify(damaged)}),emptyLedger());
});
test('low reminders fire once, recover then rearm with cooldown and independent currency/key state',()=>{
  const prefs={...DEFAULT_PREFS,cooldownMinutes:5};
  let r=lowBalanceEvents({},snapshot('4'),prefs,1000000);assert.equal(r.events.length,1);
  r=lowBalanceEvents(r.state,snapshot('3'),prefs,2000000);assert.equal(r.events.length,0,'same episode never repeats');
  r=lowBalanceEvents(r.state,snapshot('10'),prefs,2000001);
  r=lowBalanceEvents(r.state,snapshot('4'),prefs,2000002);assert.equal(r.events.length,1);
  r=lowBalanceEvents(r.state,snapshot('10'),prefs,2000003);
  r=lowBalanceEvents(r.state,snapshot('4'),prefs,2000004);assert.equal(r.events.length,0,'bounce suppressed');
  r=lowBalanceEvents(r.state,snapshot('0',undefined,b),prefs,2000005);assert.equal(r.events.length,1);
  r=lowBalanceEvents(r.state,snapshot('0',undefined,b),{...prefs,lowEnabled:false},3000000);assert.equal(r.events.length,0);
  r=lowBalanceEvents(r.state,snapshot('0',undefined,b),prefs,4000000);assert.equal(r.events.length,1,'explicit re-enable rearms');
});
test('only supported theme values and safe thresholds survive stored preferences',()=>{
  assert.deepEqual(loadPreferences({getItem:()=>JSON.stringify({theme:'javascript:',thresholdCNY:-1,accent:'url(x)',cooldownMinutes:0})}),DEFAULT_PREFS);
  assert.equal(loadPreferences({getItem:()=>JSON.stringify({theme:'ocean',accent:'#123abc',thresholdCNY:'0.0001'})}).thresholdCNY,'0.0001');
});

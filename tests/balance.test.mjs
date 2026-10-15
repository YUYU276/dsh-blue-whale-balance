import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBalanceReader, parseBalance} from '../lib/balance.js';
import {apply} from '../lib/index.js';

const payload = total => ({is_available:true,balance_infos:[{currency:'CNY',total_balance:total,granted_balance:'0.0050',topped_up_balance:'12.3400'}]});
test('preserves exact decimals and separate currencies',()=>{
  const value=payload('12.3450');
  value.balance_infos.push({currency:'USD',total_balance:'4.0001',granted_balance:'1.0',topped_up_balance:'3.0001'});
  assert.deepEqual(parseBalance(value).balances.map(x=>[x.currency,x.total]),[['CNY','12.3450'],['USD','4.0001']]);
  assert.equal(parseBalance({...value,is_available:false}).available,false);
});
test('rejects malformed totals instead of showing a misleading zero',()=>{
  for(const value of [null,{},payload('12junk'),payload(''),payload('Infinity')]) assert.throws(()=>parseBalance(value),{code:'INVALID_RESPONSE'});
});
test('every completed click reads fresh balance and resolves the current key',async()=>{
  let key='test-one',calls=0;
  const reader=createBalanceReader(async()=>key,{fetcher:async(url,opts)=>{
    assert.equal(url,'https://api.deepseek.com/user/balance');assert.equal(opts.headers.Authorization,`Bearer ${key}`);
    assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');calls++;return {ok:true,json:async()=>payload(`${calls}.0000`)};
  },now:()=>0});
  const first=await reader();assert.equal(first.balances[0].total,'1.0000');
  assert.match(first.keyId,/^[a-f0-9]{24}$/);assert.ok(!JSON.stringify(first).includes('test-one'));key='test-two';
  const second=await reader();assert.equal(second.balances[0].total,'2.0000');assert.notEqual(first.keyId,second.keyId);assert.equal(calls,2);
});
test('overlapping clicks share the pending request, failure allows retry',async()=>{
  let release,calls=0;
  const reader=createBalanceReader(async()=>'test-key',{fetcher:async()=>{calls++;await new Promise(resolve=>release=resolve);return {ok:true,json:async()=>payload('1.00')};}});
  const first=reader(),second=reader();assert.equal(first,second);
  await new Promise(resolve=>setImmediate(resolve));release();await first;assert.equal(calls,1);
});
test('network and credential failures never include secret or raw upstream error',async()=>{
  let fail=true;
  const reader=createBalanceReader(async()=>'secret-sentinel',{fetcher:async()=>{if(fail)throw new Error('secret-sentinel');return {ok:true,json:async()=>payload('1.00')};}});
  await assert.rejects(reader(),error=>error.code==='NETWORK'&&!error.message.includes('secret-sentinel'));
  fail=false;assert.equal((await reader()).balances[0].total,'1.00');
  await assert.rejects(createBalanceReader(async()=>undefined)(),{code:'MISSING_KEY'});
  for(const status of [401,429,500])await assert.rejects(createBalanceReader(async()=>'test',{fetcher:async()=>({ok:false,status})})(),{code:`HTTP_${status}`});
});
test('host route rejects foreign origins and GET without resolving credentials; effect disposes',async()=>{
  let route,disposed=false,reads=0;
  const ctx={credentials:{resolve:async()=>{reads++;return undefined;}},webServer:{register:value=>{if(value.path==='/blue-whale/api/balance')route=value;return()=>disposed=true;}},effect:fn=>ctx.dispose=fn()};
  apply(ctx);
  async function request(method,origin,contentType='application/json'){
    const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=JSON.parse(body);}};
    await route.handler({method,headers:{host:'127.0.0.1:19387',origin,'content-type':contentType}},response);return response;
  }
  assert.equal((await request('GET')).status,405);
  assert.equal((await request('POST','https://foreign.example')).status,403);
  assert.equal((await request('POST','dsh-app://app','text/plain')).status,403);assert.equal(reads,0);
  const response=await request('POST','dsh-app://app');assert.equal(response.body.code,'MISSING_KEY');assert.equal(response.headers['cache-control'],'no-store');
  ctx.dispose();assert.equal(disposed,true);
});
test('skin asset route serves bundled PNG and refuses unknown paths or methods',async()=>{
  let asset;
  const ctx={credentials:{resolve:async()=>undefined},webServer:{register:value=>{if(value.path==='/blue-whale/assets')asset=value;return()=>{};}},effect:fn=>fn()};
  apply(ctx);
  const request=async(method,url)=>{
    const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};
    await asset.handler({method,url},res);return res;
  };
  const result=await request('GET','/blue-whale/assets/whalechan-rice.png');
  assert.equal(result.status,200);assert.equal(result.headers['content-type'],'image/png');
  assert.deepEqual([...result.body.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  for (const phase of ['idle','working','done','low','dragged','clicked']) {
    const sheet=await request('GET',`/blue-whale/assets/whalechan-${phase}-sheet.png`);
    assert.equal(sheet.status,200,`${phase} sheet must be served by the real asset whitelist`);
    assert.equal(sheet.body.readUInt32BE(16),2048);
    assert.equal(sheet.body.readUInt32BE(20),1024);
    assert.equal(sheet.body[25],6,'sprite PNG must preserve RGBA transparency');
  }
  assert.equal((await request('GET','/blue-whale/assets/../../.credentials.yaml')).status,404);
  assert.equal((await request('POST','/blue-whale/assets/whalechan-rice.png')).status,404);
});

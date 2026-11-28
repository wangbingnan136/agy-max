import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseChecklist } from '../lib/progress.mjs';
import { createPricingStore, estimateCost, parseOfficialPricing, parsePartnerPricing } from '../lib/pricing.mjs';
import { createQuotaTracker } from '../lib/quota.mjs';
import { requestEvents, usageDashboard } from '../lib/analytics.mjs';
import { readDatabase } from '../lib/database.mjs';
import { fields, string as protoString } from '../lib/protobuf.mjs';
test('buffered provider responses use whole-request timing while streamed responses use pure decode timing',()=>{
 const events=requestEvents({generations:[
  {requestId:'same-id',stepIndices:[8],modelName:'model',inputTokens:100,cacheReadTokens:0,outputTokens:1000,thinkingTokens:800,responseTokens:200,ttftMs:9990,streamingMs:10},
  {requestId:'streamed-id',stepIndices:[9],modelName:'Gemini 4 Neon (High)',inputTokens:226000,cacheReadTokens:0,outputTokens:456,thinkingTokens:120,responseTokens:336,ttftMs:9740,streamingMs:2520}
 ],times:new Map([[8,{createdMs:1000}],[9,{createdMs:2000}]])},'source');
 assert.equal(events[0].tps,100);assert.equal(events[0].e2eTps,100);assert.equal(events[0].durationMs,10000);assert.equal(events[0].timestampMs,1000);assert.equal(events[0].id,'same-id');
 assert.equal(events[1].tps,181);assert.equal(events[1].e2eTps,37.2);assert.equal(events[1].durationMs,12260);assert.equal(events[1].effectiveGenMs,2520);
});
test('non-streamed replies with a short tail do not inflate tok/s or peak speed',()=>{
 const events=requestEvents({generations:[
  // Buffered reply: 9.7s wait, then 180 tokens dumped in a 250ms tail (old logic: 720 tok/s)
  {requestId:'tail',stepIndices:[],modelName:'m',inputTokens:10,cacheReadTokens:0,outputTokens:180,ttftMs:9750,streamingMs:250},
  // Short-but-real-looking window that still decodes implausibly fast (old logic: 900 tok/s)
  {requestId:'fast',stepIndices:[],modelName:'m',inputTokens:10,cacheReadTokens:0,outputTokens:900,ttftMs:9000,streamingMs:1000}
 ],times:new Map()},'source');
 assert.equal(events[0].effectiveGenMs,10000);assert.equal(events[0].tps,18);
 assert.equal(events[1].effectiveGenMs,10000);assert.equal(events[1].tps,90);
 assert.ok(events.every(e=>e.tps<=500));
});
test('progress counts leaf tasks without counting headings twice',()=>{
 const tasks=parseChecklist('- [ ] Parent\n  - [x] First\n  - [/] Active\n- [ ] Later');
 assert.deepEqual(tasks,[{title:'First',status:'complete'},{title:'Active',status:'running'},{title:'Later',status:'pending'}]);
 assert.deepEqual(parseChecklist('No plan recorded'),[]);
});
test('official price parsing selects standard rates and applies dated prices without pricing unknown models',()=>{
 const rates=parseOfficialPricing('## Gemini 4 Argon {% id="gemini-4-argon" %}\n{% tab title="Standard" %}\n* Input price\n* Not available\n* $2.00 through November 30, 2026.\n$4.00 starting December 1, 2026.\n---\n* Output price (including thinking tokens)\n* Not available\n* $10.00\n$20.00 starting December 1, 2026.\n---\n* Context caching price\n* Not available\n* $0.10\n$0.20 starting December 1, 2026.\n---\n{% /tab %}\n{% tab title="Batch" %}\n* Input price\n* $1.00');
 assert.equal(rates.length,1);const request={model:'Gemini 4 Argon (High)',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:Date.parse('2026-11-11')};
 assert.equal(estimateCost(request,rates),12.1);assert.equal(estimateCost({...request,timestampMs:Date.parse('2026-12-02')},rates),24.2);
 assert.equal(estimateCost({...request,model:'unpriced-model'},rates),null);
 const dir=mkdtempSync(join(tmpdir(),'agy-price-'));try{
  const store=createPricingStore(dir),neon=store.get().rates.find(r=>r.model==='gemini-4-neon');
  assert.deepEqual({input:neon.input,output:neon.output,cache:neon.cache},{input:3,output:15,cache:.15});
  assert.equal(estimateCost({model:'Gemini 4 Neon (XHigh)',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:Date.parse('2026-11-19')},store.get().rates),18.15);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('quota estimates require quota consumption and local priced requests in the same reset window',()=>{
 const dir=mkdtempSync(join(tmpdir(),'agy-quota-'));try{
 const tracker=createQuotaTracker(dir),rates=[{model:'gemini-4-argon',input:2,cache:.1,output:10}];
 const groups=fraction=>[{buckets:[{bucketId:'gemini-5h',remainingFraction:fraction,resetTimeMs:100000}]}];
 assert.equal(tracker.observe(groups(1),[],rates,1000).estimates[0].estimateUsd,null);
 const requests=[2000,3000,4000].map(timestampMs=>({model:'Gemini 4 Argon',timestampMs,inputTokens:10000,cacheReadTokens:0,outputTokens:0}));
 const result=tracker.observe(groups(.98),requests,rates,5000).estimates[0];assert.ok(Math.abs(result.estimateUsd-3)<1e-9);assert.equal(result.confidence,'low');assert.ok(Math.abs(result.estimateTokens-1500000)<1e-6);assert.ok(Math.abs(result.remainingTokens-1470000)<1e-6);
 assert.equal(tracker.observe([{buckets:[{bucketId:'gemini-5h',remainingFraction:.97,resetTimeMs:200000}]}],requests,rates,6000).estimates[0].estimateUsd,null);
 for(let i=0;i<120;i++)tracker.observe([{buckets:[{bucketId:'3p-5h',remainingFraction:1,resetTimeMs:300000+i*1000},{bucketId:'3p-weekly',remainingFraction:1,resetTimeMs:900000+i*1000}]}],requests,rates,6000+i*10);
 const moreRequests=[...requests,[6100,6200,6300].map(t=>({model:'Gemini 4 Argon',timestampMs:t,durationMs:1500,inputTokens:10000,cacheReadTokens:0,outputTokens:0}))].flat();
 const kept=tracker.observe([{buckets:[{bucketId:'gemini-5h',remainingFraction:.95,resetTimeMs:200000}]}],moreRequests,rates,8000).estimates[0];
 assert.ok(Math.abs(kept.estimateUsd-1.2)<1e-9);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('quota tracker computes full-cycle 100% quota from resetTimeMs minus window duration without prior samples',()=>{
 const dir=mkdtempSync(join(tmpdir(),'agy-quota-cycle-'));try{
 const tracker=createQuotaTracker(dir),rates=[{model:'gemini-4-carbon',input:2,cache:.1,output:10}];
 const resetTimeMs=Date.parse('2026-11-18T22:30:00Z');
 const startMs=resetTimeMs-5*3600*1000;
 const requests=[
   {model:'Gemini 4 Carbon (High)',timestampMs:startMs-5000,durationMs:1000,inputTokens:900000,cacheReadTokens:0,outputTokens:0},
   {model:'Gemini 4 Carbon (High)',timestampMs:startMs-500,durationMs:1200,inputTokens:50000,cacheReadTokens:0,outputTokens:0},
   {model:'Gemini 4 Carbon (High)',timestampMs:startMs+3000,durationMs:500,inputTokens:50000,cacheReadTokens:0,outputTokens:0},
   {model:'Gemini 4 Carbon (High)',timestampMs:startMs+6000,durationMs:500,inputTokens:50000,cacheReadTokens:0,outputTokens:0}
 ];
 const est=tracker.observe([{buckets:[{bucketId:'gemini-5h',window:'5h',remainingFraction:.99,resetTimeMs}]}],requests,rates,startMs+10000).estimates[0];
 assert.ok(Math.abs(est.estimateUsd-30)<1e-9);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('request cache hit rate counts cached tokens within total input, not output',()=>{
 const events=requestEvents({generations:[{stepIndices:[],modelName:'Gemini',inputTokens:25,cacheReadTokens:75,outputTokens:1000},{stepIndices:[],modelName:'Gemini',inputTokens:0,cacheReadTokens:0,outputTokens:0}],times:new Map()},'source');
 assert.equal(events[0].cacheHitPercent,75);assert.equal(events[1].cacheHitPercent,null);
});

test('Orchestrator planner and execution requests price by underlying model and count toward Gemini quota',()=>{
 const dir=mkdtempSync(join(tmpdir(),'agy-orch-price-'));try{
  const rates=createPricingStore(dir).get().rates;
  const ts=Date.parse('2026-11-20T05:00:00Z');
  assert.equal(estimateCost({model:'Orchestrator (Neon)',role:'planner',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:ts},rates),18.15);
  assert.equal(estimateCost({model:'Orchestrator (Neon)',role:'execution',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:ts},rates),9.075);
  assert.equal(estimateCost({model:'Gemini 4 Hydrogen (High)',role:'execution',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:ts},rates),9.075);
  assert.equal(estimateCost({model:'Orchestrator (Carbon)',role:'planner',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:ts},rates),12.1);
  assert.equal(estimateCost({model:'Orchestrator (Argon)',role:'planner',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:ts},rates),12.1);
  assert.equal(estimateCost({model:'Orchestrator Gemini 4 Neon Extra High',role:'planner',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:ts},rates),18.15);
  assert.equal(estimateCost({model:'Orchestrator (Claude Opus 5.5)',role:'planner',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:ts},rates),24.2);
  assert.equal(estimateCost({model:'Claude Opus 5.5 (Orchestrator)',role:'planner',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:ts},rates),24.2);
  assert.equal(estimateCost({model:'Claude Sonnet 5.5 (Orchestrator)',role:'execution',inputTokens:1e6,cacheReadTokens:1e6,outputTokens:1e6,timestampMs:ts},rates),12.1);

  const tracker=createQuotaTracker(dir);
  const resetTimeMs=ts+4*3600*1000;
  const reqs=[
   {model:'Orchestrator (Neon)',role:'planner',timestampMs:ts-2000,durationMs:500,inputTokens:100000,cacheReadTokens:0,outputTokens:0},
   {model:'Gemini 4 Hydrogen (High)',role:'execution',timestampMs:ts-1500,durationMs:500,inputTokens:200000,cacheReadTokens:0,outputTokens:0},
   {model:'Orchestrator (Neon)',role:'planner',timestampMs:ts-1000,durationMs:500,inputTokens:100000,cacheReadTokens:0,outputTokens:0},
   {model:'Orchestrator (Claude Opus 5.5)',role:'planner',timestampMs:ts-900,durationMs:500,inputTokens:100000,cacheReadTokens:0,outputTokens:0},
   {model:'Claude Opus 5.5 (Orchestrator)',role:'planner',timestampMs:ts-800,durationMs:500,inputTokens:100000,cacheReadTokens:0,outputTokens:0},
   {model:'Claude Sonnet 5.5 (Orchestrator)',role:'execution',timestampMs:ts-700,durationMs:500,inputTokens:200000,cacheReadTokens:0,outputTokens:0}
  ];
  // Gemini: 0.3 + 0.3 + 0.3 = $0.90 across 3% => $30; Claude: 0.4 + 0.4 + 0.4 = $1.20 across 3% => $40
  const res=tracker.observe([
   {buckets:[{bucketId:'gemini-5h',window:'5h',remainingFraction:.97,resetTimeMs},{bucketId:'claude-5h',window:'5h',remainingFraction:.97,resetTimeMs}]}
  ],reqs,rates,ts).estimates;
  assert.ok(Math.abs(res[0].estimateUsd-30)<1e-9);
  assert.ok(Math.abs(res[1].estimateUsd-40)<1e-9);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('parsePartnerPricing dynamically parses current and future Claude models without bleeding sections',()=>{
  const html=`
    <nav><a href="#opus">Opus 5.5</a><a href="#future">Claude Opus 6</a></nav>
    <h3 id="opus">Opus 5.5</h3>
    <table><tr><td>Input $4.00</td><td>Output $20.00</td><td>Cache Hit $0.20</td><td>5m Cache Write $5.00</td></tr></table>
    <h3>Claude Haiku 5.5</h3>
    <table><tr><td>Input $0.10</td><td>Output $0.50</td><td>Cache Hit $0.01</td><td>5m Cache Write $0.125</td></tr></table>
    <h3>Claude Opus 4.7</h3>
    <table><tr><td>Input $5.00</td><td>Output $25.00</td><td>5m Cache Write $6.25</td></tr></table>
    <h3 id="future">Claude Opus 6</h3>
    <table><tr><td>Input $6.00</td><td>Output $30.00</td><td>Cache Read $0.30</td></tr></table>
  `;
  const rates=parsePartnerPricing(html,'2026-11-21');
  assert.deepEqual(rates.map(r=>r.model),['claude-opus-5-5','claude-haiku-5-5','claude-opus-6']);
  assert.equal(rates[0].input,4);assert.equal(rates[0].output,20);assert.equal(rates[0].cache,0.2);assert.equal(rates[0].cacheWrite,5);
  assert.equal(rates[1].cacheWrite,0.125);
  assert.equal(rates[2].input,6);assert.equal(rates[2].cache,0.3);assert.equal(rates[2].cacheWrite,undefined);
});

test('estimateCost prefers exact match then longest prefix and guards missing tokens or NaN rates', () => {
  const rates = [
    { model: 'gemini-2.5-flash', input: 0.3, output: 2.5, cache: 0.03 },
    { model: 'gemini-2.5-flash-lite', input: 0.1, output: 0.4, cache: 0.01 },
    { model: 'broken-rate', input: undefined, output: 1, cache: 0 }
  ];
  assert.ok(Math.abs(estimateCost({ model: 'Gemini 2.5 Flash Lite', inputTokens: 1e6, cacheReadTokens: 0, outputTokens: 1e6 }, rates) - 0.5) < 1e-9);
  assert.ok(Math.abs(estimateCost({ model: 'Gemini 2.5 Flash Lite Preview', inputTokens: 1e6, cacheReadTokens: 0, outputTokens: 1e6 }, rates) - 0.5) < 1e-9);
  assert.ok(Math.abs(estimateCost({ model: 'Gemini 2.5 Flash', inputTokens: 1e6, cacheReadTokens: 0, outputTokens: 1e6 }, rates) - 2.8) < 1e-9);
  // Missing token fields coerce to 0 instead of returning NaN
  const partialCost = estimateCost({ model: 'Gemini 2.5 Flash Lite', inputTokens: 1e6 }, rates);
  assert.equal(partialCost, 0.1);
  // Non-finite rate returns null instead of NaN
  assert.equal(estimateCost({ model: 'broken-rate', inputTokens: 1000, outputTokens: 1000 }, rates), null);
});

test('quota tracker classifies Argon, Gemini, and Claude pools separately, skips unknown models, and bases remote-gap confidence on segDelta', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-quota-pools-'));
  try {
    const tracker = createQuotaTracker(dir);
    const ts = Date.parse('2026-11-20T10:00:00Z');
    const resetTimeMs = ts + 4 * 3600_000;
    const rates = [
      { model: 'gemini-4-argon', input: 2, cache: 0.1, output: 10 },
      { model: 'gemini-4-carbon', input: 2, cache: 0.1, output: 10 },
      { model: 'claude-opus-5-5', input: 4, cache: 0.2, output: 20 },
      { model: 'mystery-model', input: 10, cache: 1, output: 50 }
    ];
    const reqs = [
      // 3 Argon requests: $0.20 each => $0.60 total
      { model: 'Gemini 4 Argon (High)', timestampMs: ts - 5000, durationMs: 200, inputTokens: 100000, cacheReadTokens: 0, outputTokens: 0 },
      { model: 'Orchestrator (Argon)', timestampMs: ts - 4500, durationMs: 200, inputTokens: 100000, cacheReadTokens: 0, outputTokens: 0 },
      { model: 'Gemini 4 Argon (Medium)', timestampMs: ts - 4000, durationMs: 200, inputTokens: 100000, cacheReadTokens: 0, outputTokens: 0 },
      // 3 Gemini requests: $0.40 each => $1.20 total
      { model: 'Gemini 4 Carbon (High)', timestampMs: ts - 3500, durationMs: 200, inputTokens: 200000, cacheReadTokens: 0, outputTokens: 0 },
      { model: 'Gemini 4 Carbon (High)', timestampMs: ts - 3000, durationMs: 200, inputTokens: 200000, cacheReadTokens: 0, outputTokens: 0 },
      { model: 'Orchestrator (Carbon)', timestampMs: ts - 2500, durationMs: 200, inputTokens: 200000, cacheReadTokens: 0, outputTokens: 0 },
      // 3 Claude requests: $0.40 each => $1.20 total
      { model: 'Claude Opus 5.5', timestampMs: ts - 2000, durationMs: 200, inputTokens: 100000, cacheReadTokens: 0, outputTokens: 0 },
      { model: 'Claude Opus 5.5', timestampMs: ts - 1500, durationMs: 200, inputTokens: 100000, cacheReadTokens: 0, outputTokens: 0 },
      { model: 'Claude Opus 5.5', timestampMs: ts - 1000, durationMs: 200, inputTokens: 100000, cacheReadTokens: 0, outputTokens: 0 },
      // Unknown model should be skipped, NOT dumped into Claude or Argon
      { model: 'mystery-model', timestampMs: ts - 500, durationMs: 200, inputTokens: 1000000, cacheReadTokens: 0, outputTokens: 0 }
    ];
    const groups = [
      { displayName: 'Gemini 4 Argon', buckets: [{ bucketId: 'gemini-argon-wtu-weekly', window: 'weekly', remainingFraction: 0.98, resetTimeMs }] },
      { displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.96, resetTimeMs }] },
      { displayName: 'Claude and GPT models', buckets: [{ bucketId: '3p-5h', window: '5h', remainingFraction: 0.97, resetTimeMs }] }
    ];
    const est = tracker.observe(groups, reqs, rates, ts).estimates;
    assert.equal(est[0].observedRequests, 3);
    assert.ok(Math.abs(est[0].estimateUsd - 30) < 1e-9); // $0.60 / 0.02
    assert.equal(est[1].observedRequests, 3);
    assert.ok(Math.abs(est[1].estimateUsd - 30) < 1e-9); // $1.20 / 0.04
    assert.equal(est[2].observedRequests, 3);
    assert.ok(Math.abs(est[2].estimateUsd - 40) < 1e-9); // $1.20 / 0.03

    // Remote gap confidence uses segDelta (0.02 < 0.05 -> low), not total delta (0.22 >= 0.05)
    const gapReset = ts + 6 * 86400_000;
    tracker.observe([{ displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.80, resetTimeMs: gapReset }] }], [], rates, ts + 1000);
    const localReqs = Array.from({ length: 8 }, (_, i) => ({
      model: 'Gemini 4 Carbon (High)',
      timestampMs: ts + 2000 + i * 1000,
      durationMs: 100,
      inputTokens: 100000,
      cacheReadTokens: 0,
      outputTokens: 0
    }));
    const gapLow = tracker.observe([{ displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.78, resetTimeMs: gapReset }] }], localReqs, rates, ts + 20000).estimates[0];
    assert.equal(gapLow.observedRequests, 8);
    assert.equal(gapLow.confidence, 'low');
    const moreLocalReqs = [
      ...localReqs,
      { model: 'Gemini 4 Carbon (High)', timestampMs: ts + 25000, durationMs: 100, inputTokens: 100000, cacheReadTokens: 0, outputTokens: 0 }
    ];
    const gapMedium = tracker.observe([{ displayName: 'Gemini Models', buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.74, resetTimeMs: gapReset }] }], moreLocalReqs, rates, ts + 30000).estimates[0];
    assert.equal(gapMedium.confidence, 'medium');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('usageDashboard caches >12 SQLite DBs incrementally even with force:true, prunes deleted DBs, and protobuf avoids copying Buffers', () => {
  const varint = value => { const a = []; let n = BigInt(value); do { let b = Number(n & 127n); n >>= 7n; if (n) b |= 128; a.push(b); } while (n); return Buffer.from(a); };
  const integer = (n, value) => Buffer.concat([varint(n * 8), varint(value)]);
  const bytes = (n, value) => { const b = Buffer.from(value); return Buffer.concat([varint(n * 8 + 2), varint(b.length), b]); };
  const makeGen = (reqId, modelName, outTokens) => Buffer.concat([
    bytes(1, Buffer.concat([
      bytes(4, Buffer.concat([integer(2, 100), integer(3, outTokens)])),
      bytes(19, modelName),
      bytes(20, Buffer.concat([bytes(1, 'request_id'), bytes(2, reqId)]))
    ])),
    integer(2, 1)
  ]);

  // Protobuf zero-copy subarray when input is already a Buffer
  const rawBuf = makeGen('req-buf', 'Gemini 4 Neon', 42);
  const parsedMap = fields(rawBuf);
  assert.equal(parsedMap.get(1)[0].buffer, rawBuf.buffer);
  assert.equal(protoString(fields(parsedMap.get(1)[0]), 19), 'Gemini 4 Neon');

  const root = mkdtempSync(join(tmpdir(), 'agy-db-cache-'));
  try {
    const convDir = join(root, 'conversations');
    mkdirSync(convDir, { recursive: true });
    const writeConvDb = (id, reqId, outTokens, tsSec) => {
      const dbPath = join(convDir, `${id}.db`);
      const db = new DatabaseSync(dbPath);
      db.exec('CREATE TABLE IF NOT EXISTS gen_metadata(idx INTEGER PRIMARY KEY,data BLOB); CREATE TABLE IF NOT EXISTS steps(idx INTEGER PRIMARY KEY,metadata BLOB);');
      db.prepare('INSERT OR REPLACE INTO gen_metadata VALUES (?,?)').run(0, makeGen(reqId, 'Gemini 4 Neon', outTokens));
      db.prepare('INSERT OR REPLACE INTO steps VALUES (?,?)').run(1, bytes(1, integer(1, tsSec)));
      db.close();
      return dbPath;
    };

    // Create 16 conversation DBs (exceeding the legacy 12-entry FIFO cap)
    const paths = [];
    for (let i = 0; i < 16; i++) {
      paths.push(writeConvDb(`conv-${i}`, `req-${i}`, 100 + i, 1735689600 + i * 10));
    }
    const first = usageDashboard(root, { force: true });
    assert.equal(first.totalRequests, 16);
    // LRU cache holds all 16 DBs without eviction
    const db0First = readDatabase(root, 'conv-0');
    const db0Second = readDatabase(root, 'conv-0');
    assert.equal(db0First, db0Second);

    // Repeat with force:true — unchanged DBs reuse cached requestEvents objects
    const second = usageDashboard(root, { force: true });
    assert.equal(second.totalRequests, 16);
    assert.equal(second.requests.find(r => r.id === 'req-0'), first.requests.find(r => r.id === 'req-0'));

    // Modify one DB and bump mtime so stamp changes
    writeConvDb('conv-5', 'req-5-updated', 999, 1735699999);
    const future = new Date(Date.now() + 5000);
    utimesSync(paths[5], future, future);
    const third = usageDashboard(root, { force: true });
    assert.equal(third.totalRequests, 16);
    assert.ok(third.requests.some(r => r.id === 'req-5-updated' && r.outputTokens === 999));
    assert.equal(third.requests.find(r => r.id === 'req-0'), first.requests.find(r => r.id === 'req-0'));

    // Delete a DB file — incremental cache prunes its events
    unlinkSync(paths[0]);
    const fourth = usageDashboard(root, { force: true });
    assert.equal(fourth.totalRequests, 15);
    assert.equal(fourth.requests.some(r => r.id === 'req-0'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

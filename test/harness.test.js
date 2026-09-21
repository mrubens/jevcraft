'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vec3 } = require('vec3');
const { Trace, clean, legacyFrames, decisionSource } = require('../src/harness/trace');
const { Archive } = require('../src/harness/archive');
const { observeBot, terrain } = require('../src/harness/observer');
const { startHarness } = require('../src/harness/server');

function bot() {
  const b = new EventEmitter(); b.username = 'TestJev'; b.entity = { id: 1, position: new Vec3(2, 64, 3), yaw: .3, pitch: .1 };
  b.entities = { 1: b.entity }; b.health = 20; b.food = 17; b.game = { dimension: 'overworld' };
  b.inventory = { items: () => [{ name: 'oak_log', count: 2 }, { name: 'oak_log', count: 3 }] };
  b.blockAt = p => p.x > 7 ? null : { name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' };
  return b;
}

test('trace snapshots survive later mutation, redact credential fields and bound retained frames', () => {
  const trace = new Trace(), state = { position: { x: 1 }, apiKey: 'sensitive', OPENROUTER_API_KEY: 'sensitive' };
  trace.append({ snapshot: state }); state.position.x = 99;
  assert.equal(trace.frames[0].snapshot.position.x, 1);
  assert.equal(trace.frames[0].snapshot.apiKey, '[redacted]');
  assert.equal(trace.frames[0].snapshot.OPENROUTER_API_KEY, '[redacted]');
  for (let i=0;i<605;i++) trace.append({ snapshot: {} });
  assert.equal(trace.frames.length, 600); assert.equal(trace.view().limited,true);
  assert.deepEqual(trace.view(604).frames.map(f=>f.id),[605,606]);
  assert.equal(clean(2n),'2');
});

test('legacy observations do not claim a live connection, invent timestamps or backfill inventory', () => {
  const decision = { at: '2026-09-18T19:00:00Z', path: ['gather'], judgments: [{ choice: 'gather' }] };
  const frames = legacyFrames([{ step: { action: 'collect' } }, { decision, position: { x: 1, y: 64, z: 2 }, inventory: { oak_log: 2 } },
    { step: { action: 'craft' }, decision }, { error: 'blocked', decision }], { health: 20, inventory: { diamond: 64 } });
  assert.equal(frames[0].at,null); assert.equal(frames[0].snapshot.inventory,undefined);
  assert.equal(frames[1].source,'jev'); assert.equal(frames[2].source,'rules'); assert.equal(frames[2].at,null);
  assert.equal(frames[3].source,'rules'); assert.equal(frames[3].snapshot.connected,null);
  assert.equal(decisionSource(decision,'danger'),'survival');
});

test('archive handles incomplete JSONL, updates and symlinks without exposing arbitrary files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'jev-harness-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const artifacts=path.join(root,'artifacts'), stateDirectory=path.join(root,'state'), run=path.join(artifacts,'run-a');
  await fs.mkdir(run,{recursive:true}); await fs.mkdir(stateDirectory);
  await fs.writeFile(path.join(run,'events.jsonl'),'{"step":{"action":"collect"}}\n{"broken":');
  await fs.writeFile(path.join(run,'goal.json'),'{"request":"get wood"}');
  await fs.writeFile(path.join(stateDirectory,'bot.json'),JSON.stringify({ request:'get a chest',history:[],status:'running' }));
  await fs.writeFile(path.join(stateDirectory,'bot-command-tree.json'),'{}');
  await fs.symlink(path.join(stateDirectory,'bot.json'),path.join(stateDirectory,'leak.json'));
  const archive = new Archive({artifacts,stateDirectory}), list=await archive.list();
  assert.equal(list.length,2); assert(!JSON.stringify(list).includes(root));
  const id=list.find(e=>e.mode==='recording').id, recording=await archive.get(id);
  assert.equal(recording.frames.length,1); assert.equal(recording.frames[0].snapshot.goal.request,'get wood');
  assert.equal(recording.capabilities.terrain,false); assert.equal(recording.connected,null);
  assert.equal(await archive.get('../../.env'),null);
  await fs.appendFile(path.join(run,'events.jsonl'),'\n{"health":17}\n');
  assert.equal((await archive.get(id)).frames.at(-1).snapshot.health,17);
});

test('observer captures loaded terrain, route and immutable state, fencing a replaced connection', () => {
  const b=bot(), trace=new Trace(); let goal={request:'get wood',decisions:[]};
  const observation=observeBot(trace,b,{getGoal:()=>goal});
  b.emit('spawn'); assert.equal(trace.connected,true);
  const world=terrain(b,1); assert.equal(world.known.length,9); assert(world.blocks.every(block=>block[1]<0));
  b.emit('path_update',{path:[new Vec3(3,64,4)]});
  goal.decisions.push({at:'2026-09-18T19:00:00Z',path:['gather'],judgments:[{choice:'gather'}]});
  goal.lastError='Previous action failed; deciding the next move';
  observation.sample(); observation.sample('step');
  const frame=trace.frames.at(-1); assert.equal(frame.kind,'decision'); assert.equal(frame.source,'jev');
  assert.equal(frame.snapshot.inventory.oak_log,5); assert.equal(frame.snapshot.route.length,1);
  b.entity.position.x=10; assert.equal(frame.snapshot.position.x,2);
  const replacement=observeBot(trace,bot()); const serial=trace.serial; b.emit('health'); b.emit('end');
  assert.equal(trace.serial,serial); assert.equal(trace.epoch,2);
  observation.detach(); replacement.detach(); assert.equal(b.listenerCount('health'),0);
});

test('observer failures cannot throw into bot event handlers', () => {
  const b=bot(), trace=new Trace(), observer=observeBot(trace,b,{getGoal:()=>{throw new Error('checkpoint unavailable');}});
  assert.doesNotThrow(()=>b.emit('spawn')); assert.equal(trace.observationError,'checkpoint unavailable');observer.detach();
});

test('HTTP viewer is loopback only, serves local 3D modules, rejects unsafe controls and fences reconnections', async t => {
  const harness=await startHarness({port:0}); t.after(()=>harness.close());
  const get=async route=>(await fetch(harness.url+route)).json();
  const control=(body, headers={})=>fetch(harness.url+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-Jev-Harness':'1',...headers},body:JSON.stringify(body)});
  assert.match(harness.url,/127\.0\.0\.1/);
  assert.equal((await get('/api/sessions'))[0].id,'demo');
  const demo=await get('/api/sessions/demo'); assert.equal(demo.mode,'demo'); assert.equal(demo.capabilities.controls,false);
  assert(demo.frames[0].snapshot.world.blocks.length>1000);
  assert.equal((await fetch(harness.url+'/vendor/three.js')).status,200);
  assert.match(await (await fetch(harness.url+'/vendor/OrbitControls.js')).text(),/from '\/vendor\/three.js'/);
  assert.equal((await control({sessionId:'demo',action:'stop'})).status,400);
  assert.equal((await control({sessionId:'live',action:'stop',expectedEpoch:1})).status,409);
  let stops=0; const b=bot(); harness.attach(b,{controls:{stop:async()=>{stops++;}}});b.emit('spawn');
  assert.equal((await get('/api/sessions/live')).capabilities.controls,false); // An observation-only or partial adapter cannot advertise both UI controls.
  const valid={sessionId:'live',action:'stop',expectedEpoch:1};
  assert.equal((await control(valid,{'Origin':'https://unrelated.invalid'})).status,403);
  const badHostStatus = await new Promise((resolve,reject) => {
    const request = require('node:http').get(harness.url+'/api/sessions', {headers:{Host:'unrelated.invalid'}}, response=>{response.resume();resolve(response.statusCode);});
    request.on('error',reject);
  });
  assert.equal(badHostStatus,403);
  assert.equal((await control(valid,{'X-Jev-Harness':''})).status,403); assert.equal(stops,0);
  assert.equal((await control(valid)).status,200); assert.equal(stops,1);
  const b2=bot();harness.attach(b2,{controls:{stop:async()=>{stops++;}}});b2.emit('spawn');
  assert.equal((await control(valid)).status,409); assert.equal(stops,1);
  b2.emit('end'); assert.equal((await control({...valid,expectedEpoch:2})).status,409);
  const exported=await get('/api/export/live'); assert.equal(exported.format,'jev-harness'); assert.equal(exported.connected,false);
});

test('stop remains available while resume is waiting',async t=>{
  const harness=await startHarness({port:0}); t.after(()=>harness.close());
  let release;const pending=new Promise(resolve=>{release=resolve;});let stopped=false;
  const b=bot();harness.attach(b,{controls:{resume:()=>pending,stop:async()=>{stopped=true;release();}}});b.emit('spawn');
  const send=action=>fetch(harness.url+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-Jev-Harness':'1'},body:JSON.stringify({action,sessionId:'live',expectedEpoch:1})});
  const resume=send('resume');const stop=await send('stop');assert.equal(stop.status,200);assert(stopped);assert.equal((await resume).status,200);
});

test('maintenance resume scope reaches the session while invalid scopes cannot issue controls', async t => {
  const harness = await startHarness({ port: 0 }); t.after(() => harness.close());
  const calls = [], b = bot(); harness.attach(b, { controls: { resume: async options => calls.push(options), stop: async () => calls.push('stop') } }); b.emit('spawn');
  const send = body => fetch(harness.url + '/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jev-Harness': '1' },
    body: JSON.stringify({ sessionId: 'live', action: 'resume', expectedEpoch: 1, ...body }) });
  assert.equal((await send({ resumeScope: 'current' })).status, 200);
  assert.deepEqual(calls, [{ currentOnly: true }]);
  assert.equal((await send({})).status, 200);
  assert.deepEqual(calls[1], { currentOnly: false });
  assert.equal((await send({ resumeScope: 'unknown' })).status, 400);
  assert.equal((await send({ action: 'stop', resumeScope: 'current' })).status, 400);
  assert.equal(calls.length, 2);
});

test('inspector branch IDs include singleton siblings and never invent probabilities',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../public/harness/decisions.js'),'utf8');
  const {branches}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const tree={a:{children:{only:{}}},b:{children:{one:{},two:{}}}};
  const result=branches({options:tree,path:['b','two'],judgments:[{branch:'branch_2',choice:'two',probabilities:{one:.2,two:.8}}]});
  assert.deepEqual(result.map(b=>b.id),['branch_0','branch_1','branch_2']);
  assert.equal(result[1].onPath,false);assert.equal(result[2].chosen,'two');assert.equal(result[2].candidates[1].probability,.8);
  assert.equal(result[0].candidates[0].probability,undefined);
});

test('session adapter shares chat cancellation and detaches when the session closes',async t=>{
  const mineflayer=require('mineflayer'),{createSession}=require('../src/session');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'jev-harness-session-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.writeFile(path.join(directory,'test-1-Jev.json'),JSON.stringify({version:1,status:'running',kind:'follow',request:'follow me'}));
  const b=bot();b._client=new EventEmitter();b.players={};b.loadPlugin=()=>{};b.chat=()=>{};b.quit=()=>b.emit('end');
  let callbacks,detached=false;const original=mineflayer.createBot;
  const harness={attach(_bot,options){callbacks=options;return {sample(){},detach(){detached=true;}};}};
  let session;
  try{
    mineflayer.createBot=()=>b;
    session=createSession({host:'test',port:1,username:'Jev'},{},{stateDirectory:directory,harness});
    await assert.rejects(callbacks.controls.resume(),/not ready/);
    await callbacks.controls.stop();
    const saved=JSON.parse(await fs.readFile(path.join(directory,'test-1-Jev.json'),'utf8'));
    assert.equal(saved.status,'cancelled');assert.equal(saved.request,'follow me');
    assert.equal(JSON.parse(await fs.readFile(path.join(directory,'test-1-Jev-survival.json'),'utf8')).paused,true);
    session.shutdown();assert.equal(detached,true);
    await assert.rejects(callbacks.controls.stop(),/Connection ended/);
  }finally{session?.shutdown();mineflayer.createBot=original;}
});

test('live Fable advice remains separate from Jev classifier judgments and records recovery outcomes', () => {
  const b = bot(), trace = new Trace(), goal = { request: 'find a way to the Nether', decisions: [
    { at: '2026-09-18T19:00:00Z', path: ['gather'], judgments: [{ choice: 'gather' }] },
  ] };
  const observation = observeBot(trace, b, { getGoal: () => goal });
  b.emit('spawn');
  const advice = { model: 'anthropic/claude-fable-5.1', diagnosis: 'Use the dry ledge', steps: [{ kind: 'relocate' }], context: { inventory: { dirt: 3 } } };
  b.emit('recovery_advice', advice);
  assert.equal(trace.frames.at(-1).source, 'fable');
  assert.equal(trace.frames.at(-1).detail.model, advice.model);
  b.emit('recovery_result', { outcome: 'Recovery actions completed; retrying original objective' });
  assert.equal(trace.frames.at(-1).source, 'rules');
  assert.match(trace.frames.at(-1).label, /retrying original objective/);
  observation.detach();
});

test('chat interpretations, clarifying questions and Jev recovery picks are attributed to Jev, not to rules or Fable', () => {
  const b = bot(), trace = new Trace(), goal = { request: 'get me a pumpkin', decisions: [] };
  const observation = observeBot(trace, b, { getGoal: () => goal });
  b.emit('spawn');
  observation.sample('request', { request: 'Jev get me a pumpkin', kind: 'obtain', interpretation: { objective: { choice: 'obtain', confidence: 0.97 } }, usage: { input_tokens: 1900, output_tokens: 300 }, latencyMs: 210 });
  assert.equal(trace.frames.at(-1).source, 'jev'); assert.equal(trace.frames.at(-1).label, 'Understood: obtain');
  observation.sample('clarify', { request: 'Jev bring me grass', kind: 'clarify', message: 'Did you mean short grass or grass block?', clarification: { reason: 'ambiguous_item' } });
  assert.equal(trace.frames.at(-1).source, 'jev'); assert.match(trace.frames.at(-1).label, /^Asked back: Did you mean/);
  b.emit('recovery_advice', { source: 'jev', model: 'jev-latest', diagnosis: 'Jev chose: relocate', steps: [{ kind: 'relocate' }], jev: { judgment: { choice: 'option_2', confidence: 0.81 } } });
  assert.equal(trace.frames.at(-1).source, 'jev'); assert.equal(trace.frames.at(-1).label, 'Jev chose a recovery action');
  // A decision with a single feasible option never reached Jev and says so.
  goal.decisions.push({ at: '2026-09-18T19:00:01Z', path: ['obtain_item', 'mine', 'source_oak_log_3_64_0'], judgments: [] });
  observation.sample('step');
  assert.equal(trace.frames.at(-1).source, 'rules'); assert.match(trace.frames.at(-1).label, /only feasible option/);
  observation.detach();
});

test('heartbeat frames are evicted before requests and decisions, so a chat request outlives ten minutes of terrain samples', () => {
  const { MAX_FRAMES } = require('../src/harness/trace');
  const trace = new Trace();
  trace.append({ kind: 'request', label: 'Understood: obtain', snapshot: {} });
  trace.append({ kind: 'decision', label: 'obtain_item → mine', snapshot: {} });
  for (let i = 0; i < MAX_FRAMES + 50; i++) trace.append({ kind: i % 2 ? 'observation' : 'vitals', snapshot: {} });
  trace.append({ kind: 'clarify', label: 'Asked back: which one?', snapshot: {} });
  assert.equal(trace.frames.length, MAX_FRAMES);
  assert.deepEqual(trace.frames.filter(f => !['observation', 'vitals'].includes(f.kind)).map(f => f.kind), ['request', 'decision', 'clarify']);
  assert.equal(trace.frames[0].id, 1);
  assert.equal(trace.view().oldestId, 1);
});

test('an idle step with no action to name is recorded as a heartbeat rather than a blank activity', () => {
  const b = bot(), trace = new Trace(), goal = { request: 'Stay alive and prepare supplies between player requests', kind: 'survive', decisions: [] };
  const observation = observeBot(trace, b, { getGoal: () => goal });
  b.emit('spawn');
  observation.sample('step');
  assert.equal(trace.frames.at(-1).kind, 'observation'); assert.equal(trace.frames.at(-1).source, 'observed');
  goal.step = { action: 'collect', item: 'oak_log' };
  observation.sample('step');
  assert.equal(trace.frames.at(-1).kind, 'action'); assert.equal(trace.frames.at(-1).label, 'collect oak log');
  observation.detach();
});

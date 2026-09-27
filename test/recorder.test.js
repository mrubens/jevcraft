'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vec3 } = require('vec3');
const { Trace, clean, decisionSource } = require('../src/recorder/trace');
const { observeBot, terrain } = require('../src/recorder/observer');

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
  const { MAX_FRAMES } = require('../src/recorder/trace');
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

test('the session attaches the flight recorder to its bot and detaches it when the session closes', async t => {
  const mineflayer = require('mineflayer'), { createSession } = require('../src/session');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-recorder-session-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const b = bot(); b._client = new EventEmitter(); b.players = {}; b.loadPlugin = () => {}; b.chat = () => {}; b.quit = () => b.emit('end');
  let attached = null, detached = false; const original = mineflayer.createBot;
  const recorder = { attach(_bot, options) { attached = options; return { sample() {}, detach() { detached = true; } }; } };
  let session;
  try {
    mineflayer.createBot = () => b;
    session = createSession({ host: 'test', port: 1, username: 'Jev' }, {}, { stateDirectory: directory, recorder });
    assert.equal(attached.server, 'test:1'); assert.equal(typeof attached.getGoal, 'function');
    session.shutdown(); assert.equal(detached, true);
  } finally { session?.shutdown(); mineflayer.createBot = original; }
});

test('a damage event on the bot is a frame with its type and the mob that caused it', () => {
  // mid-241-d lost its last points climbing a staircase and the record could not say why (note 293).
  const b = bot(), trace = new Trace();
  b._client = new EventEmitter();
  b.entities[7] = { id: 7, name: 'zombie' };
  const observation = observeBot(trace, b);
  b.emit('spawn');
  b._client.emit('registry_data', { id: 'minecraft:damage_type', entries: [{ key: 'minecraft:arrow' }, { key: 'minecraft:in_wall' }, { key: 'minecraft:mob_attack' }] });
  b._client.emit('damage_event', { entityId: 1, sourceTypeId: 1, sourceCauseId: 0, sourceDirectId: 0 });
  b._client.emit('damage_event', { entityId: 1, sourceTypeId: 2, sourceCauseId: 8, sourceDirectId: 8 });
  b._client.emit('damage_event', { entityId: 7, sourceTypeId: 2, sourceCauseId: 2, sourceDirectId: 2 });
  const frames = trace.frames.filter(f => f.kind === 'damage');
  assert.deepEqual(frames.map(f => [f.detail.type, f.detail.cause]), [['in_wall', null], ['mob_attack', 'zombie']], 'the bot\'s own, not another mob\'s');
  observation.detach();
  assert.equal(b._client.listenerCount('damage_event'), 0);
});

test('a walk with no route records what stands round the feet', () => {
  // mid-207-d's every walk came back "partial", and what boxed it in could not be seen (note 304).
  const b = bot(), trace = new Trace();
  const observation = observeBot(trace, b);
  b.emit('spawn');
  b.emit('no_route', { status: 'partial', feet: { x: 2, y: 64, z: 3 }, around: ['1,0,0:cobblestone'] });
  const frame = trace.frames.find(f => f.kind === 'no_route');
  assert.deepEqual(frame?.detail.around, ['1,0,0:cobblestone']);
  observation.detach();
});

test('every frame says who has the turn and for how long, and a question out to Jev holds it while it is out', async () => {
  // Notes 358, 366 and 391: seconds of silence while hurt, with no holder in the record.
  const { takeTurn, turnHeld, giveBack } = require('../src/turn');
  const b = bot(), trace = new Trace();
  const observation = observeBot(trace, b, { getGoal: () => ({ decisions: [] }) });
  b.emit('spawn');
  observation.sample();
  assert.equal(trace.frames.at(-1).snapshot.turn, undefined, 'nothing has taken the turn yet');
  const before = takeTurn(b, 'survival', 'stance: pillar', { threats: ['skeleton 9'] });
  assert.equal(before, null);
  observation.sample();
  const turn = trace.frames.at(-1).snapshot.turn;
  assert.equal(turn.holder, 'survival'); assert.equal(turn.phase, 'stance: pillar'); assert.deepEqual(turn.detail, { threats: ['skeleton 9'] }); assert(turn.forMs >= 0);
  assert.equal(turnHeld(b, b._turn.since + 2500).forMs, 2500);
  // A question out to Jev: the turn is the question's while it is out, and the layer's again after.
  const { decide } = require('../src/decisions');
  let during = null;
  const client = { systemOne: async () => { during = turnHeld(b); return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  await decide('hunt_target', { client, bot: b, goal: { decisions: [] }, tree: { hunt_1: { description: 'fight it' }, defer: { description: 'leave them' } }, state: { recentDeaths: [], nightsWithoutSleep: 0 } });
  assert.equal(during.holder, 'decision'); assert.equal(during.phase, 'asking Jev: hunt_target');
  assert.equal(b._turn.phase, 'stance: pillar', 'given back');
  giveBack(b, null); assert.equal(turnHeld(b), undefined);
  observation.detach();
});

test('every frame says the mobs about and where they stand', () => {
  // mid-211-p's creeper went off two seconds after the last frame without one; the record could not say where it had been (2026-09-27).
  const b = bot(), trace = new Trace();
  b.entities = { 7: { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(b.entity.position.x + 3, b.entity.position.y, b.entity.position.z), height: 1.7, width: 0.6, isValid: true } };
  b.world = { raycast: () => null };
  const observation = observeBot(trace, b, { getGoal: () => ({}) });
  b.emit('spawn'); observation.sample();
  const mobs = trace.frames.at(-1).snapshot.mobs;
  assert.equal(mobs?.[0]?.name, 'creeper');
  assert.equal(mobs[0].d, 3);
  assert.equal(mobs[0].seen, true);
});

test('a decision is framed when Jev answers, not at the next step report after its action ran', () => {
  // mid-229-s's dig_down was answered in 0.2 seconds at 23:36:43.9 and framed
  // at 23:36:49, after the digging and 5 health lost, reading as five seconds
  // of waiting for Jev (note 530).
  const b = bot(), trace = new Trace(), goal = { request: 'beat the game', decisions: [] };
  const observation = observeBot(trace, b, { getGoal: () => ({}) });
  b.emit('spawn');
  goal.decisions.push({ at: '2026-09-27T23:36:43.900Z', askedAt: '2026-09-27T23:36:43.700Z', id: 'encounter_stance', path: ['dig_down'], judgments: [{ choice: 'dig_down' }] });
  b.emit('jev_decision', goal);
  const frame = trace.frames.at(-1);
  assert.equal(frame.kind, 'decision'); assert.equal(frame.source, 'jev');
  assert.equal(frame.snapshot.decision.askedAt, '2026-09-27T23:36:43.700Z');
  goal.step = { action: 'dig_down' };
  observation.sample('step', undefined, goal);
  assert.equal(trace.frames.at(-1).kind, 'action');
  assert.equal(trace.frames.filter(f => f.kind === 'decision').length, 1);
  observation.detach();
});

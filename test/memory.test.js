'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Vec3 } = require('vec3');
const { CompanionMemory, intentOf, visitPlace } = require('../src/memory');
const { resolveMemory, labelCandidates, coordinateCandidates } = require('../src/memory-routing');
const { rememberResources, knownResourceLocations } = require('../src/resource-observation');
const { Task } = require('../src/skills');
const { interpret } = require('../src/objectives');
const fixture = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-memory-')); t.after(() => fs.rmSync(dir, { recursive: true })); return path.join(dir, 'world-memory.json'); };

test('places and notes survive a restart, remain player/world scoped, and accept corrections', t => {
  const file = fixture(t), memory = new CompanionMemory(file);
  const home = memory.rememberPlace('Alex', 'home', { x: 12, y: 64, z: -7 }, 'minecraft:overworld');
  const note = memory.rememberNote('Alex', 'I like oak');
  memory.rememberPlace('Sam', 'home', { x: 99, y: 70, z: 99 }, 'overworld');
  memory.rememberNote('Sam', 'I like big houses');
  memory.rememberPlace('Alex', 'home', { x: 15, y: 64, z: -7 }, 'overworld');
  memory.rememberNote('Alex', 'I prefer cherry now', note.id);
  const saved = new CompanionMemory(file).context('ALEX');
  assert.equal(saved.places.length, 1); assert.equal(saved.places[0].id, home.id); assert.equal(saved.places[0].position.x, 15);
  assert.deepEqual(saved.notes.map(n => n.note), ['I prefer cherry now']);
  assert.equal(new CompanionMemory(path.join(path.dirname(file), 'another-world.json')).context('Alex').notes.length, 0);
  saved.notes[0].note = 'not written'; assert.equal(memory.context('Alex').notes[0].note, 'I prefer cherry now');
});

test('task history records actual outcomes, keeps failed tasks honest and repeats only clean gameplay intents', t => {
  const memory = new CompanionMemory(fixture(t));
  const goal = { kind: 'bundle', request: 'Jev give me a chest and a bed', from: 'Alex', status: 'running',
    createdAt: '2026-09-19T00:00:00Z', tasks: [{ kind: 'obtain', item: 'chest', count: 1, deliver: true, delivered: 1 }, { kind: 'craft', item: 'white_bed', count: 1, deliver: true, pendingDelivery: {} }] };
  memory.recordGoal(goal); memory.recordGoal(goal); assert.equal(memory.context('Alex').history.length, 1);
  goal.status = 'blocked'; goal.lastError = 'Could not find sheep'; memory.recordGoal(goal);
  const entry = memory.context('Alex').history[0]; assert.equal(entry.status, 'blocked'); assert.match(entry.problem, /haven't found/);
  assert(entry.intent.tasks.every(t => !('delivered' in t) && !('pendingDelivery' in t)));
  assert.equal(intentOf({ kind: 'operator_command', command: '/op Alex' }), null);
  assert.equal(intentOf({ kind: 'win' }), null);
  const imported = { ...goal }; delete imported.memoryId;
  new CompanionMemory(memory.file, { seedGoal: imported });
  assert.equal(new CompanionMemory(memory.file).context('Alex').history.length, 1, 'migration does not duplicate the retained request');
});

test('forget removes only the speaker entries and a later save cannot resurrect a forgotten task', t => {
  const file = fixture(t), memory = new CompanionMemory(file);
  const other = memory.rememberNote('Sam', 'red beds');
  memory.rememberNote('Alex', 'blue beds');
  const goal = { kind: 'craft', item: 'chest', count: 1, request: 'make a chest', from: 'Alex', status: 'complete' };
  memory.recordGoal(goal);
  assert.equal(memory.forget('Alex', other.id), 0);
  assert.equal(memory.forget('Alex', 'all'), 2);
  const resumed = new CompanionMemory(file); resumed.recordGoal(goal);
  assert.equal(resumed.context('Alex').history.length, 0); assert.equal(resumed.context('Alex').notes.length, 0);
  assert.equal(resumed.context('Sam').notes.length, 1);
});

test('resource observations carry into a new request after restart and are removed when actually gone', t => {
  const file = fixture(t), memory = new CompanionMemory(file), first = {}, p = new Vec3(20, 64, 0);
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, blockAt: () => ({ name: 'cherry_log' }) };
  memory.bind(first); rememberResources(bot, first, [p]); memory.flush();
  const restarted = new CompanionMemory(file), second = {}; restarted.bind(second);
  bot.blockAt = () => null;
  assert.deepEqual(knownResourceLocations(bot, second, ['cherry_log']), [p]);
  bot.game.dimension = 'nether'; assert.deepEqual(knownResourceLocations(bot, second, ['cherry_log']), []);
  bot.game.dimension = 'overworld'; bot.blockAt = () => ({ name: 'air' });
  assert.deepEqual(knownResourceLocations(bot, second, ['cherry_log']), []);
  restarted.flush(); assert.deepEqual(new CompanionMemory(file).state.resources, {});
});

test('memory caps records and chat summaries stay short', t => {
  const memory = new CompanionMemory(fixture(t));
  for (let n = 0; n < 40; n++) memory.rememberNote('Alex', `${n}: ${'x'.repeat(400)}`);
  assert.equal(memory.context('Alex').notes.length, 32);
  const reply = memory.handle({ from: 'Alex', memory: { operation: 'recall', targetId: 'all' } });
  assert(reply.length <= 256); assert.match(reply, /32 notes/);
});

test('verified discoveries become saved places, while blocked discoveries do not', t => {
  const memory = new CompanionMemory(fixture(t));
  const goal = { kind: 'find', from: 'Alex', request: 'find a cherry biome', status: 'blocked',
    discovery: { found: { kind: 'biome', name: 'cherry_grove', position: { x: 20, y: 70, z: 30 }, dimension: 'overworld' } } };
  memory.recordGoal(goal, {}); assert.equal(memory.context('Alex').places.length, 0);
  goal.status = 'complete'; memory.recordGoal(goal, {});
  assert.equal(memory.context('Alex').places[0].label, 'cherry grove');
  memory.recordGoal(goal, {}); assert.equal(memory.context('Alex').places.length, 1);
});

test('personal statements reach memory without turning ordinary discussion into gameplay', async () => {
  let statement = .95;
  const client = { async systemOne({ questions }) {
    if (questions.addressed) return { answers: { addressed: { noul: 1 }, objective: { choice: 'house' },
      interaction: { choice: 'discussion' }, memory_statement: { noul: statement } } };
    assert(questions.operation); return { answers: { operation: { choice: 'remember_note' } } };
  } };
  const preference = await interpret(client, 'Jev I prefer small houses', 'Alex', 'Jev');
  assert.equal(preference.kind, 'memory'); assert.equal(preference.memory.note, 'I prefer small houses');
  statement = 0;
  assert.equal((await interpret(client, 'Jev explain how to build houses', 'Alex', 'Jev')).kind, 'other');
});

test('memory candidates copy names and coordinates from the player text, rejecting invalid positions', () => {
  assert(labelCandidates('remember this as the north mine').includes('north mine'));
  assert.deepEqual(coordinateCandidates('save mine at x: -12, y: 64, z: 30'), [{ x: -12, y: 64, z: 30 }]);
  assert.deepEqual(coordinateCandidates('at 50000000,64,10'), []);
});

function picks(operation, choose) {
  return { async systemOne({ questions }) {
    if (questions.operation) return { answers: { operation: { choice: operation } } };
    const { criteria, instructions } = questions.entry;
    const selected = choose(criteria, instructions);
    return { answers: { entry: { choice: selected } } };
  } };
}
const spec = request => ({ kind: 'memory', request, from: 'Alex' });

test('remember here uses the observed speaker position, not Jev or invented model coordinates', async () => {
  const client = picks('remember_place', (criteria, instructions) =>
    Object.entries(criteria).find(([, description]) => instructions.includes('location the player') ? description.startsWith('Where the speaking') : description === 'home' || description.includes(' | home |'))?.[0] || 'none');
  const saved = await resolveMemory(client, spec('Jev remember this as home'), 'Jev', {
    speakerPosition: { x: 10, y: 64, z: 2 }, botPosition: { x: 90, y: 10, z: 4 }, dimension: 'overworld' });
  assert.equal(saved.memory.label, 'home'); assert.deepEqual(saved.memory.location.position, { x: 10, y: 64, z: 2 });
  await assert.rejects(resolveMemory(picks('visit', () => 'invented'), spec('Jev go home'), 'Jev', {}), /outside the offered/);
});

test('recall never repeats an action and a repeat resets all execution state', async t => {
  const memory = new CompanionMemory(fixture(t));
  memory.recordGoal({ kind: 'obtain', item: 'diamond', count: 4, deliver: true, delivered: 4,
    from: 'Alex', request: 'Jev give me 4 diamonds', status: 'complete', blueprint: { blocks: [] } });
  const context = { memory: memory.context('Alex') };
  const recall = await resolveMemory(picks('recall', () => 'entry_0'), spec('Jev what did I ask last time?'), 'Jev', context);
  assert.equal(recall.kind, 'memory'); assert.match(memory.handle(recall), /finished/);
  const repeat = await resolveMemory(picks('repeat', () => 'entry_0'), spec('Jev do that again'), 'Jev', context);
  assert.equal(repeat.kind, 'obtain'); assert.equal(repeat.count, 4); assert.equal(repeat.from, 'Alex');
  assert.equal(repeat.delivered, undefined); assert.equal(repeat.blueprint, undefined); assert.equal(repeat.status, undefined);
});

test('returning to a remembered place verifies arrival, respects dimension, and stops promptly', async () => {
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) } };
  const goal = { destination: { label: 'home', position: { x: 10, y: 64, z: 0 }, dimension: 'overworld' } };
  let moved = 0; const task = new Task('visit');
  assert.equal(await visitPlace(bot, task, goal, () => {}, { navigate: async () => { moved++; bot.entity.position.x = 10; } }), true);
  assert.equal(moved, 1);
  bot.game.dimension = 'nether';
  await assert.rejects(visitPlace(bot, task, goal, () => {}, { navigate: async () => assert.fail() }), /That place is in the overworld/);
  task.cancel(); await assert.rejects(visitPlace(bot, task, goal, () => {}, {}), { name: 'Cancelled' });
});

test('forgetting everything needs the words and a sure answer; a coin-flip forget is a question back', async () => {
  const sure = (operation, choice, confidence = 0.95) => ({ async systemOne({ questions }) {
    if (questions.operation) return { answers: { operation: { choice: operation, confidence } } };
    return { answers: { entry: { choice: choice(questions.entry.criteria), confidence } } };
  } });
  const context = { memory: { places: [{ id: 'p1', label: 'old base', dimension: 'overworld', position: { x: 1, y: 2, z: 3 }, at: 'x' }], notes: [], history: [] } };
  const all = await resolveMemory(sure('forget', () => 'all'), spec('Jev forget everything'), 'Jev', context);
  assert.equal(all.memory.targetId, 'all');
  const vague = await resolveMemory(sure('forget', () => 'all'), spec('Jev forget it'), 'Jev', context);
  assert.equal(vague.kind, 'clarify', 'no "all" or "everything" in the message, no wipe');
  const unsure = await resolveMemory(sure('forget', () => 'entry_0', 0.55), spec('Jev forget the old base'), 'Jev', context);
  assert.equal(unsure.kind, 'clarify', 'an unsure forget is asked back');
  const one = await resolveMemory(sure('forget', () => 'entry_0'), spec('Jev forget the old base'), 'Jev', context);
  assert.equal(one.memory.targetId, 'p1');
});

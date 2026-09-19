'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { CompanionMemory, intentOf } = require('../src/memory');
const { woodChoices, requestedPreferences, preferenceContext, resolvedPreferenceContext } = require('../src/preferences');
const registry = require('minecraft-data')('26.1');
function notebook(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-implicit-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  return new CompanionMemory(path.join(dir, 'memory.json'));
}
const request = (value, extra = {}) => ({ kind: 'obtain', from: 'Alex', request: `Jev get me ${value} logs`, item: `${value}_log`, count: 1,
  status: 'pending', implicitPreferences: [{ category: 'wood_species', value }], ...extra });

test('wood choice candidates come from the catalog and only confident action choices become evidence', () => {
  const choices = woodChoices(registry);
  for (const item of registry.itemsArray.filter(i => i.name.endsWith('_planks'))) assert(choices[item.name.slice(0, -7)]);
  assert.deepEqual(requestedPreferences('obtain', { choice: 'cherry', confidence: .95 }, choices), [{ category: 'wood_species', value: 'cherry' }]);
  for (const kind of ['other', 'find', 'memory', 'operator_command']) assert.deepEqual(requestedPreferences(kind, { choice: 'cherry', confidence: 1 }, choices), []);
  assert.deepEqual(requestedPreferences('build', { choice: 'cherry', confidence: .51 }, choices), []);
  assert.deepEqual(requestedPreferences('build', { choice: 'none', confidence: 1 }, choices), []);
  assert.throws(() => requestedPreferences('build', { choice: 'invented', confidence: 1 }, choices), /outside/);
});

test('one actual request teaches a soft preference with provenance that survives restart and player scoping', t => {
  const memory = notebook(t), goal = request('cherry'); memory.recordGoal(goal);
  goal.status = 'complete'; memory.recordGoal(goal); memory.recordGoal(goal);
  const saved = new CompanionMemory(memory.file).context('ALEX');
  assert.equal(saved.preferences.length, 1); assert.equal(saved.preferences[0].value, 'cherry');
  assert.equal(saved.preferences[0].request, goal.request); assert.equal(saved.preferences[0].sourceTaskId, goal.memoryId);
  assert.equal(saved.preferences[0].source, 'inferred_from_request');
  assert.equal(memory.context('Sam').preferences.length, 0);
  assert.match(memory.handle({ from: 'Alex', memory: { operation: 'recall', targetId: saved.preferences[0].id } }), /asked for cherry wood before/);
});

test('defaults and repeats cannot reinforce preferences and new explicit choices replace older implicit ones', t => {
  const memory = notebook(t), cherry = request('cherry'); memory.recordGoal(cherry);
  const saved = memory.context('Alex').preferences[0];
  memory.recordGoal(request('cherry', { request: 'Jev get me wood', implicitPreferences: undefined }));
  memory.recordGoal({ ...intentOf(cherry), from: 'Alex', status: 'pending' });
  assert.deepEqual(memory.context('Alex').preferences, [saved]);
  const oak = request('oak'); memory.recordGoal(oak);
  assert.equal(memory.context('Alex').preferences.length, 1);
  assert.equal(memory.context('Alex').preferences[0].value, 'oak');
  assert.equal(memory.context('Alex').preferences[0].sourceTaskId, oak.memoryId);
  memory.recordGoal(request('birch', { from: 'Sam' }));
  assert.equal(memory.context('Alex').preferences[0].value, 'oak');
  memory.state.history = []; memory.flush();
  const restarted = new CompanionMemory(memory.file); restarted.recordGoal(cherry);
  assert.equal(restarted.context('Alex').preferences[0].value, 'oak', 'resuming an old task after history eviction cannot overwrite the later choice');
});

test('forgetting a learned choice persists even if its source task is saved again after history eviction', t => {
  const memory = notebook(t), goal = request('cherry'); memory.recordGoal(goal);
  const id = memory.context('Alex').preferences[0].id;
  assert.equal(memory.forget('Sam', id), 0); assert.equal(memory.forget('Alex', id), 1);
  memory.state.history = []; memory.flush();
  const restarted = new CompanionMemory(memory.file); restarted.recordGoal(goal);
  assert.deepEqual(restarted.context('Alex').preferences, []);
  restarted.recordGoal(request('birch')); assert.equal(restarted.context('Alex').preferences[0].value, 'birch');
  restarted.forget('Alex', 'all'); assert.deepEqual(new CompanionMemory(memory.file).context('Alex').preferences, []);
});

test('older notebook files migrate without treating past bot defaults as inferred player choices', t => {
  const memory = notebook(t); memory.recordGoal(request('oak', { implicitPreferences: undefined }));
  const old = JSON.parse(fs.readFileSync(memory.file)); delete old.preferences; delete old.forgottenPreferences;
  fs.writeFileSync(memory.file, JSON.stringify(old));
  assert.deepEqual(new CompanionMemory(memory.file).context('Alex').preferences, []);
});

test('preference choices receive notes and learned defaults, never forgotten evidence in task history', t => {
  const memory = notebook(t); memory.recordGoal(request('cherry'));
  const preference = memory.context('Alex').preferences[0]; memory.forget('Alex', preference.id);
  assert.equal(memory.context('Alex').history.length, 1);
  const context = preferenceContext(memory.context('Alex'));
  assert.deepEqual(context.preferences, []); assert.equal(context.history, undefined); assert.equal(context.places, undefined);
  assert.equal(preferenceContext(undefined), undefined);
});

test('an explicit note replaces a conflicting inferred default before catalog classification', async () => {
  const memory = { notes: [{ note: 'I prefer birch' }], preferences: [{ category: 'wood_species', value: 'cherry' }], history: [{ request: 'get oak' }] };
  const result = await resolvedPreferenceContext({ async systemOne({ state, questions }) {
    assert.deepEqual(state, { playerNotes: memory.notes }); assert(questions.noted_wood.criteria.birch);
    return { answers: { noted_wood: { choice: 'birch', confidence: .98 } } };
  } }, registry, memory);
  assert.deepEqual(result.preferences, [{ category: 'wood_species', value: 'birch', source: 'explicit_note' }]);
  assert.equal(memory.preferences[0].value, 'cherry'); assert.equal(result.history, undefined);
});

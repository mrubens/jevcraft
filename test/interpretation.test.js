'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('minecraft-data')('26.1');
const { interpret, CONFIDENCE } = require('../src/objectives');
const { resolveItem } = require('../src/catalog');

const base = { addressed: { noul: 1 }, interaction: { choice: 'request' }, quantity: { choice: '1' }, delivery: { choice: 'speaker' }, outputs: { choice: 'single' }, target: { choice: 'Player' } };

test('a confident word-overlap pick settles the item inside the interpretation round trip', async () => {
  let calls = 0;
  const client = { systemOne: async ({ questions }) => {
    calls++;
    assert(questions.item, 'the item question is asked speculatively with the routing questions');
    assert(questions.item.criteria.pumpkin);
    return { answers: { ...base, objective: { choice: 'obtain', confidence: 0.97 }, item: { choice: 'pumpkin', confidence: 0.94 } } };
  } };
  const spec = await interpret(client, 'Jev get me a pumpkin', 'Player', 'Jev', { registry });
  assert.equal(calls, 1);
  assert.equal(spec.kind, 'obtain'); assert.equal(spec.item, 'pumpkin'); assert.equal(spec.deliver, true);
  assert.equal(spec.itemResolution.direct, true);
});

test('an unsure item pick, or none, walks the full catalog instead of guessing', async () => {
  for (const item of [{ choice: 'pumpkin', confidence: CONFIDENCE.item - 0.1 }, { choice: 'none', confidence: 1 }]) {
    const seen = [];
    const client = { systemOne: async ({ questions }) => {
      seen.push(Object.keys(questions));
      if (questions.addressed) return { answers: { ...base, objective: { choice: 'obtain', confidence: 0.97 }, item } };
      const key = Object.keys(questions.item.criteria).find(k => k === 'items' || k === 'pumpkin' || /^families_|pumpkin/.test(k)) || 'none';
      return { answers: { item: { choice: key, confidence: 0.9 } } };
    } };
    const spec = await interpret(client, 'Jev get me a pumpkin', 'Player', 'Jev', { registry });
    assert(seen.length > 1, 'the catalog walk ran');
    assert(['obtain', 'clarify'].includes(spec.kind));
  }
});

test('an uncertain objective asks the player instead of starting work, with a higher bar for costly requests', async () => {
  const ask = async (kind, confidence, runnerUp) => interpret({ systemOne: async () => ({ answers: { ...base,
    objective: { choice: kind, confidence, probabilities: { [kind]: confidence, [runnerUp]: 1 - confidence } } } }) }, 'Jev do the thing', 'Player', 'Jev', { registry });
  const come = await ask('come', 0.45, 'follow');
  assert.equal(come.kind, 'clarify'); assert.match(come.message, /come to you or follow you/);
  assert.equal(come.clarification.reason, 'uncertain_objective');
  assert.equal((await ask('come', 0.55, 'follow')).kind, 'come');
  const build = await ask('build', 0.6, 'house');
  assert.equal(build.kind, 'clarify'); assert.match(build.message, /design and build something or build a small house/);
  const status = await ask('status', 0.3, 'other');
  assert.equal(status.kind, 'status', 'harmless reports are never gated');
});

test('answers without a confidence figure are not gated', async () => {
  const spec = await interpret({ systemOne: async () => ({ answers: { ...base, objective: { choice: 'come' }, target: { choice: 'Player' } } }) }, 'Jev come', 'Player', 'Jev', { registry });
  assert.equal(spec.kind, 'come');
});

test('the wood note judgment rides along with the request and the catalog does not ask it again', async () => {
  const asked = [];
  const client = { systemOne: async ({ questions }) => {
    asked.push(Object.keys(questions));
    if (questions.addressed) {
      assert(questions.noted_wood);
      return { answers: { ...base, quantity: { choice: 'unspecified' }, objective: { choice: 'craft', confidence: 0.99 }, item: { choice: 'none', confidence: 1 }, noted_wood: { choice: 'cherry', confidence: 0.95 } } };
    }
    assert(!questions.noted_wood);
    const key = Object.keys(questions.item.criteria)[0];
    return { answers: { item: { choice: key, confidence: 1 } } };
  } };
  await interpret(client, 'Jev craft some planks', 'Player', 'Jev', { registry, memory: { notes: [{ note: 'I like cherry wood' }], preferences: [], places: [] } });
  assert(!asked.some(keys => keys.includes('noted_wood') && !keys.includes('addressed')));
});

test('an unsure leaf pick with a real runner-up becomes a question for the player', async () => {
  const small = { itemsArray: [{ name: 'short_grass', displayName: 'Short Grass' }, { name: 'grass_block', displayName: 'Grass Block' }], blocksByName: { short_grass: {}, grass_block: {} }, foodsByName: {} };
  const client = { systemOne: async ({ questions }) => {
    const keys = Object.keys(questions.item.criteria);
    if (keys.includes('blocks')) return { answers: { item: { choice: 'blocks', confidence: 1 } } };
    return { answers: { item: { choice: 'short_grass', confidence: 0.3, probabilities: { short_grass: 0.55, grass_block: 0.45 } } } };
  } };
  const resolution = await resolveItem(client, small, 'bring me grass');
  assert.equal(resolution.item, null);
  assert.deepEqual(resolution.ambiguous, ['short_grass', 'grass_block']);
  const spec = await interpret({ systemOne: async ({ questions }) => questions.addressed
    ? { answers: { ...base, objective: { choice: 'obtain', confidence: 0.9 }, item: { choice: 'none', confidence: 1 } } }
    : client.systemOne({ questions }) }, 'Jev bring me grass', 'Player', 'Jev', { registry: small });
  assert.equal(spec.kind, 'clarify'); assert.equal(spec.message, 'Did you mean short grass or grass block?');
});

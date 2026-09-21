'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { villageState, villageCandidates, chooseVillagePart, nextDreamRequest, shouldLaunchDream, resolveDream, VILLAGE_LEVELS, COOLDOWN_MS } = require('../src/dream');
const { preparationStage } = require('../src/game-progress');

const structure = (name, request, extra = {}) => ({ id: name, name, request, status: 'complete', standing: 100, origin: { x: 0, y: 64, z: 0 }, entrance: { x: 1, y: 64, z: -1 }, distance: 5, builtAt: '2026-09-21T05:00:00Z', ...extra });

test('the village is read off what stands, and candidates respect limits and the designer', () => {
  const structures = [structure('Cottage', 'build a small cottage'), structure('Cottage 2', 'build a small cottage', { builtAt: '2026-09-21T06:00:00Z' }),
    structure('Ruin', 'build a small cottage', { standing: 20 }), structure('Tower', 'build a tall watchtower')];
  const state = villageState(structures);
  assert.deepEqual([state.total, state.counts.cottage, state.counts.tower], [3, 2, 1]);
  const offered = villageCandidates(structures, { available: ['cottage', 'mansion', 'tower', 'well'] });
  assert.deepEqual(Object.keys(offered).sort(), ['cottage', 'mansion', 'well'], 'the tower is standing; only parts the shelf holds are offered');
});

test('Jev picks the next part and scores the village; an unoffered part is refused', async () => {
  const structures = [structure('Cottage', 'build a small cottage')];
  let asked;
  const shelf = [{ id: 'tiny', part: 'cottage', source: { name: 'Tiny Cottage', size: [5, 6, 5] }, summary: { name: 'Tiny Cottage', size: '5x5, 6 tall', blocks: 110, materials: '90 oak planks' } },
    { id: 'birch', part: 'cottage', source: { name: 'Birch Cottage', size: [11, 10, 9] }, summary: { name: 'Birch Cottage', size: '11x9, 10 tall', blocks: 396, materials: '200 birch planks' } },
    { id: 'tower', part: 'tower', source: { name: 'Tower' }, summary: { name: 'Tower', size: '9x9, 14 tall', blocks: 600, materials: 'sandstone' } }];
  const client = { systemOne: async ({ questions, state }) => {
    if (questions.design) return { answers: { design: { choice: 'birch', confidence: 0.8 } } };
    asked = { questions, state };
    return { answers: { part: { choice: 'cottage', confidence: 0.8, probabilities: { cottage: 0.8, mansion: 0.1, done: 0.1 } }, progress: { type: 'score', score: 0.3, confidence: 0.9 } }, usage: { input_tokens: 400 } };
  } };
  const chosen = await chooseVillagePart(client, { structures, available: ['cottage', 'tower'] });
  assert.equal(asked.questions.progress.type, 'score'); assert.deepEqual(asked.questions.progress.criteria, VILLAGE_LEVELS);
  assert.equal(asked.state.standing.length, 1);
  assert.equal(chosen.part, 'cottage'); assert.equal(chosen.score, 0.3); assert.equal(chosen.done, false);
  const next = await nextDreamRequest(client, { dream: 'build_a_village', setBy: 'Player' }, { structures, shelf });
  assert.equal(next.kind, 'build'); assert.equal(next.request, 'build Birch Cottage (cottage)'); assert.equal(next.from, 'Player');
  assert.equal(next.design.libraryId, 'birch'); assert.equal(next.design.backend, 'schematic-library');
  assert.deepEqual(next.buildAnchor, { x: 1, y: 64, z: -1 }, 'placed beside the newest standing structure');
  assert.equal(next.buildContinuation.placement, 'beside_target');
  await assert.rejects(chooseVillagePart({ systemOne: async () => ({ answers: { part: { choice: 'castle' }, progress: { score: 1 } } }) }, { structures, available: ['cottage'] }), /not offered/);
  const done = await nextDreamRequest({ systemOne: async () => ({ answers: { part: { choice: 'done' }, progress: { score: 3 } } }) }, { dream: 'build_a_village' }, { structures, shelf });
  assert.equal(done.done, true); assert.equal(done.villageScore, 3);
});

test('beating the game is handed over as the win objective, and the ladder starts with tools you can see', async () => {
  const next = await nextDreamRequest({ systemOne: async () => assert.fail('no question needed') }, { dream: 'beat_the_game', setBy: 'Player' });
  assert.equal(next.kind, 'win'); assert.equal(next.dream, 'beat_the_game');
  const bot = (items, slots = {}) => ({ inventory: { items: () => items.map(name => ({ name })), slots } });
  assert.equal(preparationStage(bot(['diamond_pickaxe', 'iron_sword', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots'], { 45: { name: 'shield' } })), null, 'a shield on the arm counts');
  assert.equal(preparationStage(bot(['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'golden_boots'], { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } })), null, 'worn armour counts');
  assert.equal(preparationStage(bot(['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'])).item, 'golden_boots', 'gold on the feet before the Nether keeps piglins neutral');
  assert.equal(preparationStage(bot(['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings'], { 8: { name: 'golden_boots' } })), null, 'golden boots worn count as the boots');
  const registry = require('minecraft-data')('26.1');
  const worn = { registry, inventory: { items: () => [{ name: 'iron_pickaxe', durabilityUsed: 240 }, { name: 'stone_pickaxe', durabilityUsed: 0 }, { name: 'iron_sword' }, { name: 'shield' }, { name: 'water_bucket' }], slots: {} } };
  assert.equal(preparationStage(worn).item, 'iron_pickaxe', 'a pickaxe with ten uses left is a rung to redo before it breaks');
  assert.equal(preparationStage(worn).count, 2, 'the worn one is still carried, so the rung asks for one more');
  worn.inventory.items = () => [{ name: 'iron_pickaxe', durabilityUsed: 100 }, { name: 'iron_sword' }, { name: 'shield' }, { name: 'water_bucket' }];
  assert.equal(preparationStage(worn).item, 'iron_helmet', 'a sound pickaxe counts');
  assert.equal(preparationStage(bot([])).item, 'stone_pickaxe');
  assert.equal(preparationStage(bot(['stone_pickaxe'])).item, 'stone_sword');
  assert.equal(preparationStage(bot(['stone_pickaxe', 'stone_sword'])).item, 'iron_pickaxe');
  assert.equal(preparationStage(bot(['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket'])).item, 'iron_helmet', 'armour is four rungs of its own');
  assert.equal(preparationStage(bot(['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings'])).item, 'iron_boots');
  assert.equal(preparationStage(bot(['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'diamond_boots', 'golden_boots'])), null);
});

test('the idle loop launches the dream only when nothing of the player\'s is pending and outside the cool-down', () => {
  const standing = { dream: 'build_a_village' };
  assert.equal(shouldLaunchDream(standing, null), true);
  assert.equal(shouldLaunchDream(standing, { status: 'running', request: 'get me a pumpkin' }), false, 'a player request is saved and unfinished');
  assert.equal(shouldLaunchDream(standing, { status: 'cancelled', request: 'get me a pumpkin' }), false, 'a stopped player request waits for resume');
  assert.equal(shouldLaunchDream(standing, { status: 'complete', request: 'get me a pumpkin' }), true);
  assert.equal(shouldLaunchDream(standing, { status: 'complete', dream: 'build_a_village' }), true, 'the last part finished, the next may start');
  const now = Date.now();
  assert.equal(shouldLaunchDream({ ...standing, lastAttemptAt: now - 1000 }, { status: 'blocked', dream: 'build_a_village' }, { now }), false, 'a parked part waits out the cool-down');
  assert.equal(shouldLaunchDream({ ...standing, lastAttemptAt: now - COOLDOWN_MS - 1 }, { status: 'blocked', dream: 'build_a_village' }, { now }), true);
  assert.equal(shouldLaunchDream(standing, null, { ready: false }), false, 'not at night, hurt or hungry');
  assert.equal(shouldLaunchDream({ ...standing, satisfiedAt: 'x' }, null), false);
});

test('chat sets, asks about and clears the dream, and an unclear line asks back', async () => {
  const ask = async operation => resolveDream({ systemOne: async () => ({ answers: { operation: { choice: operation, confidence: 0.9 } } }) }, { request: 'Jev your goal is to build a village', from: 'Player' });
  const set = await ask('set_build_a_village');
  assert.equal(set.kind, 'dream'); assert.equal(set.dream.key, 'build_a_village');
  assert.equal((await ask('clear')).dream.operation, 'clear');
  assert.equal((await ask('pause')).dream.operation, 'pause'); assert.equal((await ask('resume')).dream.operation, 'resume');
  assert.equal(shouldLaunchDream({ dream: 'build_a_village', paused: true }, null), false, 'a dream set aside is not chased');
  assert.equal((await ask('none')).kind, 'clarify');
  await assert.rejects(ask('invent'), /Invalid dream/);
});

test('a question about the dream reaches the dream handler even when phrased as discussion', async () => {
  const { interpret } = require('../src/objectives');
  const registry = require('minecraft-data')('26.1');
  const client = { systemOne: async ({ questions }) => questions.addressed
    ? { answers: { addressed: { noul: 1 }, interaction: { choice: 'discussion' }, objective: { choice: 'dream', confidence: 0.9 } } }
    : { answers: { operation: { choice: 'query', confidence: 0.9 } } } };
  const spec = await interpret(client, "Jev what's your dream?", 'Player', 'Jev', { registry });
  assert.equal(spec.kind, 'dream'); assert.equal(spec.dream.operation, 'query');
});

test('armour is one rung planned as a set, and the set shrinks to the pieces still missing', () => {
  const registry = require('minecraft-data')('26.1');
  const bot = (names, slots = {}) => ({ registry, inventory: { items: () => names.map(name => ({ name, durabilityUsed: 0 })), slots } });
  const bare = preparationStage(bot(['iron_pickaxe', 'iron_sword', 'shield', 'water_bucket']));
  assert.equal(bare.action, 'acquire_set'); assert.equal(bare.phase, 'iron_armour');
  assert.deepEqual(bare.items, ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']);
  const partly = preparationStage(bot(['iron_pickaxe', 'iron_sword', 'shield', 'water_bucket'], { 5: { name: 'iron_helmet' } }));
  assert.deepEqual(partly.items, ['iron_chestplate', 'iron_leggings', 'iron_boots']); assert.equal(partly.phase, 'iron_chestplate');
});

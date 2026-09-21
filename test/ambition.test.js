'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { villageState, villageCandidates, chooseVillagePart, nextAmbitionRequest, shouldLaunchAmbition, resolveAmbition, VILLAGE_LEVELS, COOLDOWN_MS } = require('../src/ambition');
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
  const next = await nextAmbitionRequest(client, { ambition: 'build_a_village', setBy: 'Player' }, { structures, shelf });
  assert.equal(next.kind, 'build'); assert.equal(next.request, 'build Birch Cottage (cottage)'); assert.equal(next.from, 'Player');
  assert.equal(next.design.libraryId, 'birch'); assert.equal(next.design.backend, 'schematic-library');
  assert.deepEqual(next.buildAnchor, { x: 1, y: 64, z: -1 }, 'placed beside the newest standing structure');
  assert.equal(next.buildContinuation.placement, 'beside_target');
  await assert.rejects(chooseVillagePart({ systemOne: async () => ({ answers: { part: { choice: 'castle' }, progress: { score: 1 } } }) }, { structures, available: ['cottage'] }), /not offered/);
  const done = await nextAmbitionRequest({ systemOne: async () => ({ answers: { part: { choice: 'done' }, progress: { score: 3 } } }) }, { ambition: 'build_a_village' }, { structures, shelf });
  assert.equal(done.done, true); assert.equal(done.villageScore, 3);
});

test('beating the game is handed over as the win objective, and the ladder starts with tools you can see', async () => {
  const next = await nextAmbitionRequest({ systemOne: async () => assert.fail('no question needed') }, { ambition: 'beat_the_game', setBy: 'Player' });
  assert.equal(next.kind, 'win'); assert.equal(next.ambition, 'beat_the_game');
  const bot = items => ({ inventory: { items: () => items.map(name => ({ name })) } });
  assert.equal(preparationStage(bot([])).item, 'stone_pickaxe');
  assert.equal(preparationStage(bot(['stone_pickaxe'])).item, 'stone_sword');
  assert.equal(preparationStage(bot(['stone_pickaxe', 'stone_sword'])).item, 'iron_pickaxe');
  assert.equal(preparationStage(bot(['diamond_pickaxe', 'iron_sword', 'shield', 'water_bucket'])), null);
});

test('the idle loop launches the ambition only when nothing of the player\'s is pending and outside the cool-down', () => {
  const standing = { ambition: 'build_a_village' };
  assert.equal(shouldLaunchAmbition(standing, null), true);
  assert.equal(shouldLaunchAmbition(standing, { status: 'running', request: 'get me a pumpkin' }), false, 'a player request is saved and unfinished');
  assert.equal(shouldLaunchAmbition(standing, { status: 'cancelled', request: 'get me a pumpkin' }), false, 'a stopped player request waits for resume');
  assert.equal(shouldLaunchAmbition(standing, { status: 'complete', request: 'get me a pumpkin' }), true);
  assert.equal(shouldLaunchAmbition(standing, { status: 'complete', ambition: 'build_a_village' }), true, 'the last part finished, the next may start');
  const now = Date.now();
  assert.equal(shouldLaunchAmbition({ ...standing, lastAttemptAt: now - 1000 }, { status: 'blocked', ambition: 'build_a_village' }, { now }), false, 'a parked part waits out the cool-down');
  assert.equal(shouldLaunchAmbition({ ...standing, lastAttemptAt: now - COOLDOWN_MS - 1 }, { status: 'blocked', ambition: 'build_a_village' }, { now }), true);
  assert.equal(shouldLaunchAmbition(standing, null, { ready: false }), false, 'not at night, hurt or hungry');
  assert.equal(shouldLaunchAmbition({ ...standing, satisfiedAt: 'x' }, null), false);
});

test('chat sets, asks about and clears the standing goal, and an unclear line asks back', async () => {
  const ask = async operation => resolveAmbition({ systemOne: async () => ({ answers: { operation: { choice: operation, confidence: 0.9 } } }) }, { request: 'Jev your goal is to build a village', from: 'Player' });
  const set = await ask('set_build_a_village');
  assert.equal(set.kind, 'ambition'); assert.equal(set.ambition.key, 'build_a_village');
  assert.equal((await ask('clear')).ambition.operation, 'clear');
  assert.equal((await ask('none')).kind, 'clarify');
  await assert.rejects(ask('invent'), /Invalid ambition/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { reservedForConstruction, portalSiteClear } = require('../src/build-sites');

test('resource gathering preserves house and portal foundations and approaches', () => {
  const goal = { portalFrame: { origin: { x: 29, y: 64, z: -12 } } };
  assert(reservedForConstruction(goal, new Vec3(29, 63, -12)));
  assert(reservedForConstruction(goal, new Vec3(32, 62, -11)));
  assert(!reservedForConstruction(goal, new Vec3(37, 63, -12)));
  assert(reservedForConstruction({ blueprint: { origin: { x: 0, y: 64, z: 0 } } }, new Vec3(-2, 63, 2)));
});

test('portal site requires level support across the entire frame and walking approaches', () => {
  const origin = new Vec3(0, 64, 0);
  const holes = new Set();
  const bot = { blockAt: p => ({ name: p.y === 63 && !holes.has(`${p}`) ? 'dirt' : 'air',
    boundingBox: p.y === 63 && !holes.has(`${p}`) ? 'block' : 'empty' }) };
  assert(portalSiteClear(bot, origin));
  holes.add(`${new Vec3(3, 63, 0)}`);
  assert(!portalSiteClear(bot, origin));
});

test('portal anchors reuse mixed non-burning masonry without spending obsidian or falling blocks', () => {
  const { portalSupports } = require('../src/build-sites');
  const bot = { inventory: { items: () => [
    { name: 'obsidian', count: 10 }, { name: 'cobbled_deepslate', count: 2 }, { name: 'diorite', count: 1 },
    { name: 'sand', count: 64 }, { name: 'gravel', count: 64 }, { name: 'oak_planks', count: 64 },
    { name: 'cobbled_deepslate', count: 1 },
  ] } };
  assert.deepEqual(portalSupports(bot), { count: 4, material: 'cobbled_deepslate' });
  assert.deepEqual(portalSupports({ inventory: { items: () => [] } }), { count: 0, material: undefined });
});

test('portal resume preserves owned anchors and an unloaded frame before any obsidian is visible', async () => {
  const { runGoal } = require('../src/work'), { Task } = require('../src/skills');
  const registry = require('minecraft-data')('26.1');
  for (const loaded of [true, false]) {
    const frame = { origin: { x: 0, y: 64, z: 0 }, blocks: [{ x: 1, y: 64, z: 0 }],
      supports: [{ x: 0, y: 64, z: 0, material: 'andesite' }] };
    const bot = { registry, game: { gameMode: 'survival', difficulty: 'peaceful', dimension: 'overworld' },
      entity: { position: new Vec3(0.5, 64, -2.5) }, health: 20, food: 20, entities: {},
      inventory: { items: () => [{ name: 'obsidian', count: 10 }, { name: 'cobblestone', count: 3 }, { name: 'flint_and_steel', count: 1 }] },
      pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, goto: async () => { throw new Error('Pause before construction'); } },
      blockAt: p => !loaded ? null : { name: p.y === 63 ? 'stone' : p.equals(new Vec3(0, 64, 0)) ? 'andesite' : 'air' },
      findBlocks: () => [], chat() {}, clearControlStates() {} };
    const goal = { kind: 'nether', request: 'find a way to the Nether', expeditionReady: true, portalFrame: structuredClone(frame) };
    await runGoal(bot, new Task('resume'), goal, { save() {} }, { maxSteps: 1, survival: { state: {}, step: async () => false } });
    assert.deepEqual(goal.portalFrame, frame, loaded ? 'Owned temporary anchor is construction progress' : 'Unloaded cells are not evidence of an empty frame');
  }
});

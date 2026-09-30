'use strict';
// Trial note 750d: a bastion read as a fortress. 25589 (mid-243-ma) at
// 17:13:35Z on 2026-09-30 said "Ooh, a bastion at -222, 24" and a second
// later was asked the way to "the fortress at (-238, 39, 26)", a magma cube
// spawner in that bastion's treasure room, "3 piglin brutes" at its bricks
// (critic ~17:16Z item 5).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

function world(blocks, { spawners = {}, entities = {} } = {}) {
  const at = p => {
    const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`, name = blocks[k] || 'air';
    return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block', ...(spawners[k] ? { blockEntity: spawners[k] } : {}) };
  };
  return { registry, game: { dimension: 'the_nether' }, entity: { position: new Vec3(0, 40, 0) }, entities, blockAt: at,
    findBlocks: ({ matching, count = 1 }) => Object.keys(blocks).filter(k => [].concat(matching).includes(registry.blocksByName[blocks[k]]?.id)).map(k => new Vec3(...k.split(',').map(Number))).slice(0, count) };
}

test('a spawner is the fortress\'s only when it makes blazes: by its mob as sent, else by the fortress\'s own bricks beside it (note 750d)', () => {
  const { spawnerKind } = require('../src/fortress-map');
  const magma = world({ '10,40,10': 'spawner', '11,40,10': 'polished_blackstone_bricks' }, { spawners: { '10,40,10': { SpawnData: { entity: { id: 'minecraft:magma_cube' } } } } });
  assert.deepEqual(spawnerKind(magma, new Vec3(10, 40, 10)), { blaze: false, mob: 'magma_cube', why: 'a magma cube spawner' });
  const blaze = world({ '10,40,10': 'spawner' }, { spawners: { '10,40,10': { SpawnData: { entity: { id: 'minecraft:blaze' } } } } });
  assert.equal(spawnerKind(blaze, new Vec3(10, 40, 10)).blaze, true);
  // Its mob not sent: the bricks decide.
  assert.equal(spawnerKind(world({ '10,40,10': 'spawner', '12,39,10': 'polished_blackstone_bricks' }), new Vec3(10, 40, 10)).blaze, false);
  assert.equal(spawnerKind(world({ '10,40,10': 'spawner', '12,39,10': 'polished_blackstone_bricks', '9,39,10': 'nether_bricks' }), new Vec3(10, 40, 10)).blaze, true);
  assert.equal(spawnerKind(world({ '10,40,10': 'spawner' }), new Vec3(10, 40, 10)).blaze, true, 'nothing against it: as before');
});

test('the cage the blaze work stands at is a blaze spawner, a bastion\'s magma cube spawner passed over (blaze-stand.js spawnerAt, note 750d)', () => {
  const { spawnerAt } = require('../src/blaze-stand');
  const bot = world({ '5,40,5': 'spawner', '20,40,20': 'spawner' }, { spawners: { '5,40,5': { SpawnData: { entity: { id: 'minecraft:magma_cube' } } }, '20,40,20': { SpawnData: { entity: { id: 'minecraft:blaze' } } } } });
  assert.deepEqual(spawnerAt(bot), new Vec3(20, 40, 20));
  const none = world({ '5,40,5': 'spawner' }, { spawners: { '5,40,5': { SpawnData: { entity: { id: 'minecraft:magma_cube' } } } } });
  assert.equal(spawnerAt(none), null);
});

test('a piglin brute in view marks a bastion where no gilded blackstone is seen (note 750d)', () => {
  const { noticeLandmarks } = require('../src/exploration');
  const bot = world({}, { entities: { 7: { id: 7, name: 'piglin_brute', position: new Vec3(-230, 40, 20) } } });
  bot.entity.position = new Vec3(-238, 40, 26);
  const goal = {};
  noticeLandmarks(bot, goal, () => {}, { force: true });
  const b = (goal.landmarks || []).find(l => l.kind === 'bastion');
  assert(b, JSON.stringify(goal.landmarks));
  assert.deepEqual([b.x, b.z], [-230, 20]);
});

test('scripts/fortress-arrival.js says what a fortress was known by: its bricks, or a spawner only, and piglin brutes about (note 750d)', () => {
  const { measureFrames } = require('../scripts/fortress-arrival');
  const T = 1_000_000;
  const frames = [
    { t: T, kind: 'observation', label: 'observation', snapshot: { step: { action: 'wait_at_spawner', spawner: { x: -238, y: 39, z: 26 }, target: { x: -238, y: 39, z: 26 } }, position: { x: -240, y: 40, z: 20 }, mobs: [{ name: 'piglin_brute', d: 12 }] } },
    { t: T + 5000, kind: 'observation', label: 'observation', snapshot: { step: { action: 'find_fortress', found: { x: -238, y: 39, z: 26 }, legs: 3 }, position: { x: -240, y: 40, z: 20 }, mobs: [] } },
  ];
  const [e] = measureFrames(frames, { end: T + 60000 });
  assert.equal(e.knownBy, 'a spawner only');
  assert.equal(e.brutesSeen, 1);
  const withBricks = measureFrames([{ t: T, kind: 'observation', label: 'observation', snapshot: { step: { action: 'find_fortress', found: { x: 10, y: 60, z: 10 }, legs: 1 }, position: { x: 0, y: 60, z: 0 } } }], { end: T + 1000 });
  assert.equal(withBricks[0].knownBy, 'bricks');
});

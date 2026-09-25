'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const dd = require('../src/deep-dark');

function bot({ y = 64, blocks = {}, items = [['iron_pickaxe', 1], ['cooked_beef', 8]], entities = {} } = {}) {
  const at = p => blocks[`${p.x},${p.y},${p.z}`];
  return { registry, game: { dimension: 'overworld' }, health: 20, food: 20, entities, chat() {},
    entity: { position: new Vec3(0.5, y, 0.5) },
    inventory: { items: () => items.map(([name, count]) => ({ name, count })) },
    blockAt: p => ({ position: p, name: at(p) || 'stone', boundingBox: 'block' }),
    findBlocks: ({ matching }) => Object.entries(blocks).filter(([, name]) => matching.includes(registry.blocksByName[name]?.id)).map(([k]) => new Vec3(...k.split(',').map(Number))) };
}

test('sculk below zero is the deep dark; reinforced deepslate or tiles among sculk is an ancient city', () => {
  const { DETECTORS } = require('../src/exploration');
  const detect = kind => DETECTORS.find(d => d.kind === kind).detect;
  const sculk = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`${i},-50,0`, 'sculk']));
  assert(detect('deep_dark')(bot({ blocks: sculk })), 'fourteen sculk at y -50');
  assert(!detect('deep_dark')(bot({ blocks: Object.fromEntries(Object.entries(sculk).slice(0, 5)) })), 'five is a vein, not the biome');
  assert.equal(detect('ancient_city')(bot({ blocks: { '10,-51,4': 'reinforced_deepslate' } })).x, 10, 'the portal frame');
  const tiles = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${i},-48,2`, 'deepslate_tiles']));
  assert(detect('ancient_city')(bot({ blocks: { ...tiles, '3,-49,2': 'sculk' } })), 'tiles beside sculk');
  assert(!detect('ancient_city')(bot({ blocks: tiles })), 'tiles alone are someone\'s floor');
});

test('from the surface the trip stairs down toward y -52 along its heading', async () => {
  const b = bot({ y: 64 });
  const tunnels = [];
  const goal = { deepDark: { heading: 0, legs: 0, legFails: 0 } };
  const did = await dd.deepDarkStep(b, new Task('dd'), goal, () => {}, { tunnel: async (bb, t, holder, sv, target) => { tunnels.push(target); b.entity.position = b.entity.position.offset(1, -1, 0); },
    navigate: async () => {}, dig: async () => {}, loot: async () => false });
  assert.equal(did, 'descend');
  assert.equal(tunnels[0].y, dd.DEPTH); assert.equal(tunnels[0].x, 16, 'along +x, sixteen out');
  assert.equal(goal.step.phase, 'descend');
});

test('at a known city the trip goes chest to chest, and leaves when a warden shows', async () => {
  const b = bot({ y: -50, blocks: { '8,-50,3': 'chest' } });
  const goal = { landmarks: [{ kind: 'ancient_city', x: 5, y: -51, z: 5, dimension: 'overworld' }], deepDark: { heading: 0, legs: 3, legFails: 0 } };
  const walked = [];
  const actions = { navigate: async (bb, t, g) => { walked.push([g.x, g.y, g.z]); b.entity.position = new Vec3(g.x, g.y, g.z); }, tunnel: async () => {}, dig: async () => {}, loot: async () => false };
  assert.equal(await dd.deepDarkStep(b, new Task('dd'), goal, () => {}, actions), 'city');
  assert.deepEqual(walked[0], [8, -50, 3], 'to the city\'s chest');
  actions.loot = async () => true;
  assert.equal(await dd.deepDarkStep(b, new Task('dd'), goal, () => {}, actions), 'loot');
  b.entities = { 9: { name: 'warden', position: new Vec3(20, -50, 3), isValid: true } };
  assert.equal(await dd.deepDarkStep(b, new Task('dd'), goal, () => {}, actions), 'warden');
  assert.equal(dd.deepDarkReady(b, goal), false, 'the trip rests after a warden');
});

test('while the ladder walks about after endermen, Jev is offered the deep dark instead', () => {
  const { strategyOptions } = require('../src/strategy');
  const b = bot({ y: 64, items: [['diamond_pickaxe', 1], ['diamond_sword', 1], ['shield', 1], ['white_bed', 1], ['water_bucket', 1], ['bow', 1], ['arrow', 16], ['cooked_beef', 8],
    ['iron_helmet', 1], ['iron_chestplate', 1], ['iron_leggings', 1], ['iron_boots', 1], ['golden_boots', 1], ['blaze_rod', 8]] });
  b.game.gameMode = 'survival'; b.time = { timeOfDay: 3000 };
  const stage = { phase: 'obtain_ender_pearls', action: 'acquire', item: 'ender_pearl', count: 16 };
  const goal = {};
  const options = strategyOptions(b, goal, stage, { deep_dark: { description: dd.describe(goal), run: async () => {} } });
  assert.deepEqual(Object.keys(options).sort(), ['deep_dark', 'stage_obtain_ender_pearls']);
  assert(options.stage_obtain_ender_pearls.fallback, 'the ladder stays the fallback');
});

test('trial chambers: a trial spawner or vault marks them, a dropped key is picked up, and a key opens a vault', async () => {
  const { DETECTORS } = require('../src/exploration');
  assert(DETECTORS.find(d => d.kind === 'trial_chambers').detect(bot({ blocks: { '4,-28,4': 'trial_spawner' } })), 'a trial spawner');
  const b = bot({ y: -30, blocks: { '6,-30,2': 'vault' }, items: [['iron_pickaxe', 1], ['cooked_beef', 8]] });
  const goal = { landmarks: [{ kind: 'trial_chambers', x: 4, y: -28, z: 4, dimension: 'overworld' }], expeditions: { trial_chambers: { heading: 0, legs: 1, legFails: 0 } } };
  const key = { name: 'trial_key', count: 1 };
  b.entities = { 5: { position: new Vec3(3, -30, 1), getDroppedItem: () => key } };
  const went = [];
  const actions = { navigate: async (bb, t, g) => { went.push([g.x, g.y, g.z]); }, tunnel: async () => {}, dig: async () => {}, loot: async () => false };
  assert.equal(await dd.expeditionStep(b, new Task('tc'), goal, () => {}, actions, 'trial_chambers'), 'key');
  delete b.entities[5];
  const items = [['iron_pickaxe', 1], ['trial_key', 1]].map(([name, count]) => ({ name, count }));
  b.inventory.items = () => items;
  let used = null;
  b.equip = async () => {}; b.activateBlock = async block => { used = block.position; };
  assert.equal(await dd.expeditionStep(b, new Task('tc'), goal, () => {}, actions, 'trial_chambers'), 'vault');
  assert.deepEqual([used.x, used.y, used.z], [6, -30, 2]);
  assert.equal(await dd.expeditionStep(b, new Task('tc'), goal, () => {}, actions, 'trial_chambers') === 'vault', false, 'a vault opened once is not opened again');
});

test('a barrel of a trial chamber that cannot be got to rests after two tries, and the next is taken', async () => {
  // Trial 39: a barrel in a wall of tuff bricks and copper, no path in,
  // walked at until the audit failed the trial.
  const b = bot({ y: -10, blocks: { '20,-10,1': 'barrel', '24,-10,6': 'barrel' } });
  const goal = { landmarks: [{ kind: 'trial_chambers', x: 20, y: -10, z: 1, dimension: 'overworld' }], expeditions: { trial_chambers: { heading: 0, legs: 1, legFails: 0, foundAt: 'x' } } };
  const went = [];
  const actions = { navigate: async (bb, t, g) => { went.push(`${g.x},${g.z}`); }, tunnel: async () => {}, dig: async () => {}, loot: async () => false };
  for (let n = 0; n < 3; n++) await dd.expeditionStep(b, new Task('tc'), goal, () => {}, actions, 'trial_chambers');
  assert.deepEqual(went, ['20,1', '20,1', '24,6'], 'twice at the walled barrel, then the other');
});

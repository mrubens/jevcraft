'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { reachShore } = require('../src/shore');
const { Task } = require('../src/skills');

function fixture() {
  const registry = require('prismarine-registry')('26.1'), Block = require('prismarine-block')(registry), blocks = new Map();
  const landing = new Vec3(18, 63, 0);
  const bot = { registry, game: { minY: 0, height: 100 }, entities: {}, oxygenLevel: 20,
    entity: { position: new Vec3(.5, 61.9, .5), onGround: false },
    blockAt(point) {
      const p = point.floored(), name = blocks.get(`${p}`) || (p.y < 59 || p.x >= 18 && p.y <= 62 ? 'stone' : p.y <= 62 ? 'water' : 'air');
      if (name === 'unknown') return null;
      const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = p; return b;
    },
    findBlocks({ useExtraInfo }) { const b = bot.blockAt(landing.offset(0, -1, 0)); return useExtraInfo(b) ? [b.position] : []; },
    pathfinder: { movements: { canDig: true, allowParkour: true, allow1by1towers: true, scafoldingBlocks: [1] },
      getPathTo: () => ({ status: 'success', path: [{ ...landing, toPlace: [], toBreak: [] }] }), setGoal() {} }, clearControlStates() {},
  };
  const surface = async (b, task, y) => { assert.equal(y, 62); b.entity.position.y = 62.2; };
  const move = async () => { bot.entity.position = landing.offset(.5, 0, .5); bot.entity.onGround = true; };
  return { bot, landing, blocks, task: new Task('shore'), goal: { request: 'get wood', item: 'oak_log' }, surface, move };
}

test('shore recovery rejects unknown, hazardous, covered or forbidden land and construction routes', async () => {
  for (const kind of ['unknown', 'hazard', 'roof', 'restricted', 'excavation', 'placement', 'stale']) {
    const f = fixture(), { bot, blocks, landing } = f;
    if (kind === 'unknown') blocks.set(`${landing}`, 'unknown');
    if (kind === 'hazard') blocks.set(`${landing.offset(0, -1, 0)}`, 'campfire');
    if (kind === 'roof') blocks.set(`${landing.offset(0, 5, 0)}`, 'stone');
    if (kind === 'restricted') bot.pathfinder.movements.allowedPosition = p => p.x < 18;
    bot.pathfinder.getPathTo = () => {
      if (kind === 'stale') blocks.set(`${landing}`, 'water');
      return { status: 'success', path: [{ ...landing, toBreak: kind === 'excavation' ? [landing] : [], toPlace: kind === 'placement' ? [landing] : [] }] };
    };
    const previous = { ...bot.pathfinder.movements };
    await assert.rejects(reachShore(bot, f.task, f.goal, () => {}, { surface: f.surface, move: () => assert.fail(kind) }), /No reachable dry shore/, kind);
    for (const [key, value] of Object.entries(previous)) assert.equal(bot.pathfinder.movements[key], value, key);
  }
});

test('shore recovery verifies arrival, retains failures and restores movement on cancellation', async () => {
  for (const kind of ['arrived', 'not_arrived', 'airborne', 'cancelled']) {
    const f = fixture(), { bot, task, goal } = f, previous = { ...bot.pathfinder.movements };
    const run = reachShore(bot, task, goal, () => {}, { surface: f.surface, move: async () => {
      if (kind === 'cancelled') { task.cancel(); task.check(); }
      if (kind !== 'not_arrived') await f.move();
      if (kind === 'airborne') bot.entity.onGround = false;
    } });
    if (kind === 'arrived') { assert(await run); assert(goal.shoreRecovery.landed); }
    else await assert.rejects(run, kind === 'cancelled' ? { name: 'Cancelled' } : /No reachable dry shore/);
    assert.equal(goal.item, 'oak_log');
    if (kind === 'not_arrived' || kind === 'airborne') assert.equal(Object.keys(goal.shoreRecovery.failures).length, 1);
    for (const [key, value] of Object.entries(previous)) assert.equal(bot.pathfinder.movements[key], value, key);
  }
});

test('under a roof, with no landing counted as surface, the bot climbs out onto the nearest dry cell', async () => {
  const { Vec3 } = require('vec3');
  const { reachShore } = require('../src/shore');
  const { Task } = require('../src/skills');
  const water = new Set(['0,62,0', '1,62,0']);
  const blockAt = p => water.has(`${p.x},${p.y},${p.z}`) ? { name: 'water', type: 1, boundingBox: 'empty', position: p, getProperties: () => ({ level: 0 }) }
    : p.y === 66 ? { name: 'oak_planks', boundingBox: 'block', position: p } : p.y < 62 || (p.y === 62 && !water.has(`${p.x},${p.y},${p.z}`) && Math.abs(p.x) > 2) ? { name: 'dirt', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { registry: require('minecraft-data')('26.1'), game: { dimension: 'overworld', minY: -64, height: 384 }, entity: { position: new Vec3(0.5, 62.2, 0.5), onGround: false, isInWater: true },
    blockAt, findBlocks: () => [], controlState: {}, entities: {}, oxygenLevel: 20, lookAt: async () => {}, clearControlStates() {},
    setControlState(k, v) { this.controlState[k] = v; if (k === 'forward' && v) { this.entity.position = new Vec3(-1.5, 62, 0.5); this.entity.isInWater = false; this.entity.onGround = true; } },
    pathfinder: { movements: { allowedPosition: () => true }, setGoal() {} } };
  const goal = {};
  const landed = await reachShore(bot, new Task('shore'), goal, () => {}, { surface: async () => {} });
  assert.equal(landed, true);
  assert.equal(goal.step.climb, true);
});

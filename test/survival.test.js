'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { threats, checkThreats, safeFromHostiles } = require('../src/danger');
const shelter = require('../src/shelter');
const { reservedForConstruction } = require('../src/build-sites');
const { Task, navigate } = require('../src/skills');
const { Survival } = require('../src/survival');
const { EventEmitter } = require('node:events');
const { houseBlueprint, verifyHouse } = require('../src/objectives');

test('threat visibility uses the entire ray and respects solid cover', () => {
  const bot = { entity: { position: new Vec3(0, 64, 0) }, time: { timeOfDay: 13000 },
    entities: { 1: { name: 'skeleton', position: new Vec3(12, 64, 0), height: 1.8 } },
    world: { raycast: (eye, direction, distance) => {
      assert(distance > 12); assert(Math.abs(direction.norm() - 1) < 1e-6);
      return { intersect: new Vec3(4, 65.5, 0) };
    } } };
  assert.equal(threats(bot)[0].visible, false);
  assert.doesNotThrow(() => checkThreats(bot));
  bot.world.raycast = () => null;
  assert.throws(() => checkThreats(bot), { name: 'NeedsSafety' });
});

test('ordinary routes avoid observed hostile ranges while preserving retreat and Creative movement', () => {
  const bot = { game: { gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 14000 },
    entity: { position: new Vec3(0, 64, 0) }, entities: { 1: { name: 'skeleton', position: new Vec3(25, 64, 0) } } };
  assert(safeFromHostiles(bot, new Vec3(4, 64, 0)));
  assert(!safeFromHostiles(bot, new Vec3(6, 64, 0)));
  bot.entity.position.x = 15; // A moving mob has already entered the buffer.
  assert(safeFromHostiles(bot, new Vec3(14, 64, 0)));
  assert(!safeFromHostiles(bot, new Vec3(16, 64, 0)));
  bot.game.gameMode = 'creative';
  assert(safeFromHostiles(bot, new Vec3(25, 64, 0)));
});

test('a shelter is safe only with complete nonfalling shell, floor, and clear interior', () => {
  const origin = new Vec3(0, 64, 0);
  const refuge = { origin, dimension: 'overworld' };
  const blocks = new Map();
  const bot = { game: { dimension: 'overworld' }, entity: { position: origin.offset(0.5, 0, 0.5) },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'),
      boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty' }) };
  assert.equal(shelter.safeSite(bot, origin, {}), true);
  assert.equal(shelter.sealed(bot, refuge), false);
  for (const p of shelter.shell(origin)) blocks.set(`${p}`, 'dirt');
  assert.equal(shelter.inside(bot, refuge), true);
  assert.equal(shelter.sealed(bot, refuge), true);
  const roof = `${origin.offset(0, 2, 0)}`;
  blocks.set(roof, 'gravel');
  assert.equal(shelter.sealed(bot, refuge), false);
  blocks.set(roof, 'dirt'); blocks.set(`${origin}`, 'dirt');
  assert.equal(shelter.sealed(bot, refuge), false);
  assert(reservedForConstruction({ survival: { shelters: [refuge] } }, origin.offset(0, -1, 0)));
});

test('a newly observed threat interrupts an in-flight navigation', async () => {
  let stopped = false;
  const task = new Task('house', 'build a house');
  const bot = { oxygenLevel: 20, entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { goto: () => new Promise(() => {}), setGoal: value => { if (value === null) stopped = true; } },
    clearControlStates() {}, stopDigging() {} };
  const timer = setTimeout(() => { task.interruptCheck = () => { const err = new Error('Skeleton approached'); err.name = 'NeedsSafety'; throw err; }; }, 10);
  try { await assert.rejects(navigate(bot, task, {}), { name: 'NeedsSafety' }); }
  finally { clearTimeout(timer); }
  assert.equal(stopped, true);
  assert.equal(task.cancelled, false, 'The player task remains resumable after a survival interruption');
});

test('shelter construction rechecks materials consumed by the approach before sealing exits', async () => {
  let carried = 29;
  let placed = 0;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' },
    entity: { position: new Vec3(5.5, 64, 0.5) },
    inventory: { items: () => [{ name: 'dirt', count: carried }] },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }) });
  const state = { shelters: [{ origin: { x: 0, y: 64, z: 0 }, dimension: 'overworld' }] };
  const controller = new Survival(bot, {
    navigate: async () => { bot.entity.position = new Vec3(0.5, 64, 0.5); carried = 2; },
    place: async () => { placed++; },
  }, { state });
  await controller.refugeStep(new Task('house', 'build a house'), { survival: state }, () => {});
  assert.equal(placed, 0, 'Do not close the room when travel spent the remaining roof materials');
});

test('an empty shelter reservation permits its approach while preserving other sites and restoring protection', async () => {
  const origin = new Vec3(0, 64, 0), other = { origin: { x: 20, y: 64, z: 0 }, dimension: 'overworld' };
  const refuge = { origin, dimension: 'overworld' }, state = { shelters: [refuge, other] }, goal = { survival: state };
  const changed = new Map();
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' },
    entity: { position: new Vec3(0.5, 58, 0.5) },
    blockAt: p => ({ name: changed.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'), boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { movements: { exclusionAreasBreak: [] } },
  });
  bot._constructionProtection = block => reservedForConstruction(goal, block.position) ? 100 : 0;
  const foreignRule = () => 5;
  const original = bot.pathfinder.movements.exclusionAreasBreak = [foreignRule, bot._constructionProtection];
  let expectProtected = false;
  const controller = new Survival(bot, { navigate: async () => {
    const rules = bot.pathfinder.movements.exclusionAreasBreak;
    const cost = p => rules.reduce((sum, rule) => sum + rule({ position: p }), 0);
    assert.equal(cost(origin.offset(0, -2, 0)), expectProtected ? 105 : 5);
    assert.equal(cost(new Vec3(20, 63, 0)), 105, 'Other planned work remains protected');
    throw new Error('approach failed');
  } }, { state });
  await assert.rejects(controller.approachRefuge(new Task('approach'), goal, refuge, {}), /approach failed/);
  assert.equal(bot.pathfinder.movements.exclusionAreasBreak, original);
  changed.set(`${origin.offset(1, 0, 0)}`, 'cobblestone'); expectProtected = true;
  await assert.rejects(controller.approachRefuge(new Task('partial shelter'), goal, refuge, {}), /approach failed/);
  assert.equal(bot.pathfinder.movements.exclusionAreasBreak, original);
});

test('shelter supply gathering first escapes the pit beneath an empty reserved site', async () => {
  const origin = new Vec3(0, 70, 0), refuge = { origin, dimension: 'overworld' };
  const state = { shelters: [refuge, { origin: new Vec3(20, 70, 0), dimension: 'overworld' }] };
  const goal = { kind: 'obtain', item: 'oak_log', count: 16, survival: state };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(.5, 67, .5) }, inventory: { items: () => [{ name: 'oak_planks', count: 5 }] },
    blockAt: p => ({ name: p.y < 70 ? 'stone' : 'air', boundingBox: p.y < 70 ? 'block' : 'empty' }),
    pathfinder: { movements: { exclusionAreasBreak: [] } },
  });
  bot._constructionProtection = block => reservedForConstruction(goal, block.position) ? 100 : 0;
  const original = bot.pathfinder.movements.exclusionAreasBreak = [bot._constructionProtection];
  let approached = false, acquired = false;
  const controller = new Survival(bot, {
    navigate: async (b, task, target) => {
      if (!approached) {
        const cost = p => b.pathfinder.movements.exclusionAreasBreak.reduce((sum, rule) => sum + rule({ position: p }), 0);
        assert.equal(cost(origin.offset(0, -2, 0)), 0, 'Can excavate the natural approach below this empty site');
        assert.equal(cost(new Vec3(20, 68, 0)), 100, 'Other work stays protected');
        assert.equal(target.y, 70); approached = true;
      }
      b.entity.position = new Vec3(target.x + .5, target.y, target.z + .5);
    },
    dig: async () => {},
    acquireStep: async (b, task, item, count, retained, save, options) => {
      assert(approached, 'Do not start the dirt search while imprisoned under the reservation');
      assert.equal(b.entity.position.y, 70); assert.equal(options.minimumMiningY, 69);
      assert.equal(retained, goal); assert.equal(item, 'dirt'); acquired = true;
    },
  }, { state });
  await controller.refugeStep(new Task('shelter supplies'), goal, () => {});
  assert(approached); assert(!acquired, 'Approach is a bounded step before gathering');
  assert.equal(bot.pathfinder.movements.exclusionAreasBreak, original);
  await controller.refugeStep(new Task('gather outside'), goal, () => {});
  assert(acquired); assert.equal(goal.item, 'oak_log');
});

test('a completed house becomes a persistent refuge with a temporary two-block night closure', async () => {
  const blueprint = houseBlueprint(new Vec3(0, 64, 0));
  const blocks = new Map(blueprint.blocks.map(p => [`${new Vec3(p.x, p.y, p.z)}`, p.material]));
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {}, time: { timeOfDay: 14000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'dirt', count: 2 }] },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty' }) });
  const actions = { place: async (b, t, p, material) => blocks.set(`${p}`, material),
    dig: async (b, t, p, options) => { assert.equal(options.requireDrops, false, 'Opening our shelter does not require harvesting its closure'); blocks.delete(`${p}`); }, navigate: async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } };
  const survival = new Survival(bot, actions);
  assert.equal(survival.rememberHouse(blueprint), true);
  assert.equal(survival.rememberHouse(blueprint), false, 'Do not duplicate a remembered home');
  const restored = new Survival(bot, actions, { state: JSON.parse(JSON.stringify(survival.state)) });
  const refuge = restored.currentShelter();
  assert.equal(refuge.kind, 'house');
  assert.equal(shelter.missingShell(bot, refuge).length, 2);
  await restored.refugeStep(new Task('test', 'shelter'), {}, () => {});
  assert(shelter.inside(bot, refuge)); assert(shelter.sealed(bot, refuge));
  assert.equal(blocks.size, blueprint.blocks.length + 2);
  await restored.leave(new Task('test', 'leave'), {}, () => {}, refuge);
  assert(!shelter.inside(bot, refuge));
  assert(verifyHouse(bot, blueprint).ok, 'The original house is intact and its doorway is clear again');
});

test('shelter sealing reselects material when positioning spends the last selected block', async () => {
  const origin = new Vec3(0, 64, 0), blocks = new Map();
  let items = [{ name: 'oak_planks', count: 1 }, { name: 'cobblestone', count: 32 }];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {},
    entity: { position: origin.offset(0.5, 0, 0.5) }, inventory: { items: () => items },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty' }) });
  const refuge = { origin: { ...origin }, dimension: 'overworld' }, state = { shelters: [refuge] };
  const controller = new Survival(bot, { place: async (b, t, p, material) => {
    if (material === 'oak_planks') {
      items = items.filter(i => i.name !== 'oak_planks');
      const err = new Error('Need more oak_planks'); err.name = 'Blocked'; throw err;
    }
    assert.equal(material, 'cobblestone');
    items[0].count--; blocks.set(`${p}`, material);
  } }, { state });
  const task = new Task('test', 'seal with current materials');
  await controller.refugeStep(task, {}, () => {});
  assert(!shelter.sealed(bot, refuge));
  await controller.refugeStep(task, {}, () => {});
  assert(shelter.sealed(bot, refuge));
});

test('shelter sealing clears snow without requiring the tool that would harvest its drops', async () => {
  const origin = new Vec3(0, 64, 0), blocks = new Map([['(1, 64, 0)', 'snow']]);
  let stock = 32, cleared = 0;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {},
    entity: { position: origin.offset(.5, 0, .5) }, inventory: { items: () => [{ name: 'dirt', count: stock }] },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'),
      boundingBox: blocks.get(`${p}`) === 'snow' ? 'empty' : blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty' }) });
  const refuge = { origin: { ...origin }, dimension: 'overworld' };
  const controller = new Survival(bot, {
    dig: async (b, t, p, options) => { assert.equal(options.requireDrops, false); cleared++; blocks.delete(`${p}`); },
    place: async (b, t, p, material) => { assert.notEqual(blocks.get(`${p}`), 'snow'); stock--; blocks.set(`${p}`, material); },
  }, { state: { shelters: [refuge] } });
  await controller.refugeStep(new Task('snow shelter'), {}, () => {});
  assert.equal(cleared, 1); assert(shelter.sealed(bot, refuge));
});

test('a ledge shelter builds anchored peripheral foundations before walls and retains its exit', async () => {
  const origin = new Vec3(0, 64, 0), blocks = new Map([['(0, 63, 0)', 'stone'], ['(0, 63, -2)', 'stone']]);
  let stock = 40;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {},
    entity: { position: origin.offset(0.5, 0, 0.5) }, inventory: { items: () => [{ name: 'cobblestone', count: stock }] },
    blockAt: p => ({ name: blocks.get(`${p}`) || 'air', boundingBox: blocks.has(`${p}`) ? 'block' : 'empty' }) });
  assert(shelter.safeSite(bot, origin, {}));
  const refuge = { origin: { ...origin }, dimension: 'overworld' };
  assert.equal(shelter.missingShell(bot, refuge).length, 33);
  const directions = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
  const controller = new Survival(bot, { place: async (b, t, p, material) => {
    assert(directions.some(d => shelter.solid(bot.blockAt(p.plus(d)))), `No anchor at ${p}`);
    if (p.y >= origin.y) assert(shelter.foundation(origin).every(q => shelter.solid(bot.blockAt(q))), 'Build the complete floor before enclosing the room');
    stock--; blocks.set(`${p}`, material);
  } }, { state: { shelters: [refuge] } });
  await controller.refugeStep(new Task('test', 'build refuge'), {}, () => {});
  assert(shelter.sealed(bot, refuge));
  assert.equal(stock, 7);
  assert.equal(shelter.exits(bot, refuge).length, 1);
});

test('shelter foundation planning rejects liquids, unloaded terrain and unsupported central footing', () => {
  const origin = new Vec3(0, 64, 0);
  for (const invalid of ['water', 'lava', 'gravel', null]) {
    const bot = { blockAt: p => p.equals(origin.offset(1, -1, 0))
      ? invalid === null ? null : { name: invalid, boundingBox: invalid === 'gravel' ? 'block' : 'empty' }
      : { name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' } };
    assert(!shelter.safeSite(bot, origin, {}));
  }
  assert(!shelter.safeSite({ blockAt: () => ({ name: 'air', boundingBox: 'empty' }) }, origin, {}));
});

test('shelter preparation swims to observed shore before reserving a site or gathering blocks', async () => {
  const registry = require('prismarine-registry')('26.1'), Block = require('prismarine-block')(registry);
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld', gameMode: 'survival', minY: 0, height: 100 },
    entity: { position: new Vec3(.5, 62.2, .5), isInWater: true, onGround: false }, entities: {},
    inventory: { items: () => [{ name: 'dirt', count: 1 }] }, clearControlStates() {},
    blockAt(point) {
      const p = point.floored(), name = p.y < 59 || p.x >= 18 && p.y <= 62 ? 'stone' : p.y <= 62 ? 'water' : 'air';
      const block = Block.fromStateId(registry.blocksByName[name].defaultState); block.position = p; return block;
    },
    findBlocks({ maxDistance, useExtraInfo }) {
      const block = bot.blockAt(new Vec3(18, 62, 0));
      return maxDistance >= 18 && (!useExtraInfo || useExtraInfo(block)) ? [block.position] : [];
    },
    pathfinder: { movements: { canDig: true, allow1by1towers: true, allowParkour: true, scafoldingBlocks: [1] },
      getPathTo: () => ({ status: 'success', path: [{ x: 18, y: 63, z: 0, toBreak: [], toPlace: [] }] }), setGoal() {} },
  });
  const previous = { ...bot.pathfinder.movements }, goal = { kind: 'survive', request: 'Stay alive between requests' };
  let moved = false;
  const controller = new Survival(bot, {
    navigate: async (b, t, target) => {
      moved = true; assert.equal(target.x, 18);
      assert.equal(b.pathfinder.movements.canDig, false); assert.deepEqual(b.pathfinder.movements.scafoldingBlocks, []);
      b.entity.position = new Vec3(18.5, 63, .5); b.entity.isInWater = false; b.entity.onGround = true;
    },
    acquireStep: () => assert.fail('Reach dry land before gathering shelter supplies'),
    place: () => assert.fail('Cannot build an emergency room in open water'),
  });
  await controller.refugeStep(new Task('shelter from water'), goal, () => {});
  assert(moved); assert.equal(controller.state.shelters.length, 0);
  assert.equal(goal.request, 'Stay alive between requests'); assert.equal(goal.step.action, 'reach_shore');
  for (const [key, value] of Object.entries(previous)) assert.deepEqual(bot.pathfinder.movements[key], value, key);
});

test('unfinished shelter plans stop pulling the bot back uphill after it leaves the area', () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' },
    entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt: () => ({ name: 'air', boundingBox: 'empty' }) });
  const old = { origin: { x: 0, y: 79, z: 0 }, dimension: 'overworld' };
  const state = { shelters: [old] }, controller = new Survival(bot, {}, { state });
  assert.equal(controller.currentShelter(), undefined);
  assert(reservedForConstruction({ survival: state }, new Vec3(0, 79, 0)), 'Partial work remains protected');
  old.origin = { x: 30, y: 64, z: 0 };
  assert.equal(controller.currentShelter(), undefined, 'Do not gather for a distant unfinished site');
  old.origin = { x: 4, y: 66, z: 0 };
  assert.equal(controller.currentShelter(), old, 'Nearby short climbs remain available');
  old.origin.y = 79; old.verifiedAt = new Date().toISOString();
  assert.equal(controller.currentShelter(), old, 'A verified home remains a remembered refuge');
});

test('shelter stock and carried-wood crafting use the full plank recipe catalog', async () => {
  for (const [input, plank, yieldPerItem] of [['spruce_log', 'spruce_planks', 4], ['stripped_cherry_wood', 'cherry_planks', 4],
    ['crimson_stem', 'crimson_planks', 4], ['bamboo_block', 'bamboo_planks', 2]]) {
    const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' },
      entity: { position: new Vec3(4.5, 64, 0.5) },
      inventory: { items: () => [{ name: input, count: 2 }, { name: plank, count: 4 }, { name: 'dirt', count: 1 }] },
      blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }) });
    const refuge = { origin: { x: 0, y: 64, z: 0 }, dimension: 'overworld' };
    assert.equal(shelter.materialStock(bot), 5);
    let calls = 0;
    const controller = new Survival(bot, { acquireStep: async (b, t, item, count) => {
      calls++; assert.equal(item, plank); assert.equal(count, 4 + 2 * yieldPerItem, 'Only request what carried ingredients can make');
    } }, { state: { shelters: [refuge] } });
    await controller.refugeStep(new Task('shelter with available wood'), {}, () => {});
    assert.equal(calls, 1);
  }
});

test('shelter gathering follows the current ground height even when returning to an elevated home', async () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' },
    entity: { position: new Vec3(4.5, 64, 0.5) }, inventory: { items: () => [] },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }) });
  const refuge = { origin: { x: 0, y: 79, z: 0 }, dimension: 'overworld', verifiedAt: new Date().toISOString() };
  let calls = 0;
  const controller = new Survival(bot, { acquireStep: async (b, t, item, count, goal, save, options) => {
    calls++; assert.equal(item, 'dirt'); assert.equal(options.minimumMiningY, 63);
  } }, { state: { shelters: [refuge] } });
  await controller.refugeStep(new Task('ground supplies'), {}, () => {});
  assert.equal(calls, 1);
});

test('mixed wood variants never make shelter crafting ask for new logs', () => {
  const registry = require('minecraft-data')('26.1'), { planCatalog } = require('../src/knowledge');
  const stock = { spruce_log: 1, stripped_spruce_wood: 3 };
  const bot = { inventory: { items: () => Object.entries(stock).filter(([, count]) => count > 0).map(([name, count]) => ({ name, count })) } };
  for (let step = 0; step < 4 && (stock.spruce_planks || 0) < 16; step++) {
    const target = shelter.supplyTarget(bot, 16 - (stock.spruce_planks || 0));
    assert.equal(target.item, 'spruce_planks');
    const plan = planCatalog(registry, target.item, target.count, stock);
    assert(plan.length && plan.every(s => s.action === 'craft' && s.item === 'spruce_planks'));
    for (const s of plan) {
      for (const [name, count] of Object.entries(s.consumes)) { assert(stock[name] >= count); stock[name] -= count; }
      for (const [name, count] of Object.entries(s.produces)) stock[name] = (stock[name] || 0) + count;
    }
  }
  assert.equal(stock.spruce_planks, 16);
  stock.spruce_log = 8;
  assert.deepEqual(shelter.supplyTarget(bot, 1), { item: 'spruce_planks', count: 17 }, 'Only fill the shortage, allowing the recipe to round up');
});

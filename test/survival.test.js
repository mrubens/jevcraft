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

test('an in-reach hostile does not make defensive swings preempt an available retreat', async () => {
  const registry = require('prismarine-registry')('26.1');
  const zombie = { id: 7, name: 'zombie', position: new Vec3(2.5, 64, .5), height: 1.8, isValid: true };
  const destination = new Vec3(-8, 64, 0), attacks = [];
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { position: new Vec3(.5, 64, .5) }, entities: { 7: zombie }, health: 8, food: 20, oxygenLevel: 20,
    time: { timeOfDay: 14000 }, inventory: { items: () => [] }, world: { raycast: () => null },
    blockAt: p => ({ position: p.floored(), name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    findBlocks: () => [destination.offset(0, -1, 0)],
    pathfinder: { movements: { canDig: true, allow1by1towers: true, allowSprinting: false }, setGoal() {},
      getPathTo: () => ({ status: 'success', path: [{ ...destination, toBreak: [], toPlace: [] }] }) },
    clearControlStates() {}, lookAt: async () => {}, attack: target => attacks.push(target),
  });
  const prior = { ...bot.pathfinder.movements }, task = new Task('retreat'), goal = { kind: 'obtain', item: 'dirt', count: 32 };
  let navigated = 0;
  const controller = new Survival(bot, { navigate: async (b, t, g) => {
    navigated++; assert.equal(attacks.length, 1, 'One knockback swing, then move immediately');
    assert.equal(b.pathfinder.movements.canDig, false); assert.equal(b.pathfinder.movements.allow1by1towers, false);
    assert.equal(b.pathfinder.movements.allowSprinting, true);
    b.entity.position = new Vec3(g.x + .5, g.y, g.z + .5);
  } });
  assert(await controller.step(task, goal, () => {}));
  assert.equal(navigated, 1, 'Close-range defense must not consume the escape action');
  assert(bot.entity.position.distanceTo(zombie.position) > 8);
  assert.equal(goal.item, 'dirt'); assert.deepEqual(bot.pathfinder.movements, prior);
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

test('a saved shelter with no route to it is set aside so a pocket can be sealed where the bot stands', async () => {
  const { Survival } = require('../src/survival');
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 35, 0.5) },
    pathfinder: { movements: {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, blockAt: () => ({ name: 'stone', boundingBox: 'block' }), on() {} };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { x: 0, y: 75, z: 0 }, dimension: 'overworld', verifiedAt: 'x', createdAt: 'x' }] } });
  const goal = {}, saved = [];
  const refuge = survival.currentShelter();
  assert(refuge, 'the surface shelter is the current one');
  assert.equal(await survival.reachableRefuge(new Task('night'), goal, () => saved.push(1), refuge), null);
  assert(refuge.avoidUntil > Date.now()); assert.equal(goal.survivalAction.action, 'shelter_unreachable');
  assert.equal(survival.currentShelter(), undefined, 'set aside, so a new local site will be chosen');
  bot.pathfinder.getPathTo = () => ({ status: 'success', path: [] });
  const near = { origin: { x: 2, y: 35, z: 0 }, dimension: 'overworld' };
  assert.equal(await survival.reachableRefuge(new Task('night'), goal, () => {}, near), near, 'a reachable one is kept');
});

test('an empty food reserve pulls the bot off its work at 18 hunger on the surface but only at 12 underground', async () => {
  const { Survival } = require('../src/survival');
  const forages = [];
  const make = (y, food) => {
    const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
      entity: { position: new Vec3(0.5, y, 0.5) }, entities: {}, health: 20, food, oxygenLevel: 20, time: { timeOfDay: 2000 },
      inventory: { items: () => [] }, registry: require('minecraft-data')('26.1'),
      blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }),
      findBlocks: () => [], pathfinder: { movements: {} }, on() {}, removeListener() {} };
    const survival = new Survival(bot, { explore: async (b, t, goal) => { forages.push(`${y}:${food}`); },
      navigate: async () => {}, acquireStep: async () => {} }, { state: { shelters: [] } });
    return survival;
  };
  assert.equal(await make(70, 18).step(new Task('surface'), { kind: 'win' }, () => {}), true, 'on the surface, 18 with no reserve is a hunt');
  assert.equal(await make(20, 18).step(new Task('deep'), { kind: 'win' }, () => {}), false, 'underground, 18 with no reserve is not worth the climb');
  assert.equal(await make(20, 12).step(new Task('deep hungry'), { kind: 'win' }, () => {}), true, 'underground, 12 is');
  assert.deepEqual(forages, ['70:18', '20:12']);
});

test('a pocket in a one-wide staircase is a shelter site underground even without a two-block exit', () => {
  const origin = new Vec3(0, 20, 0);
  // Solid stone everywhere except the staircase: the bot's cell and two
  // cells of headroom, one cell behind a step lower, one ahead a step higher.
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`, `${origin.offset(-1, -1, 0)}`, `${origin.offset(-1, 0, 0)}`, `${origin.offset(-1, 1, 0)}`,
    `${origin.offset(1, 1, 0)}`, `${origin.offset(1, 2, 0)}`]);
  const bot = { game: { dimension: 'overworld' }, entity: { position: origin.offset(0.5, 0, 0.5) },
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : 'block' }) };
  assert.equal(shelter.exits(bot, { origin }).length, 0, 'no two-block exit in a staircase');
  assert.equal(shelter.safeSite(bot, origin, {}), true, 'but buried, the pocket is a site');
  const missing = shelter.missingShell(bot, { origin, dimension: 'overworld' });
  assert.equal(missing.length, 5, 'only the staircase openings, the step below and the headroom above need sealing');
  const surface = { ...bot, blockAt: p => ({ name: open.has(`${p}`) || p.y > 20 ? 'air' : 'stone', boundingBox: open.has(`${p}`) || p.y > 20 ? 'empty' : 'block' }) };
  assert.equal(shelter.safeSite(surface, origin, {}), false, 'under open sky the exit rule still holds');
});

test('a sealed-in bot leaves at dawn despite mobs behind rock, and stays for one that can see in', async () => {
  const { Survival } = require('../src/survival');
  const origin = new Vec3(0, 20, 0);
  const shellCells = new Set(shelter.shell(origin).map(p => `${p}`));
  const make = (skeletonAt, seeThrough) => {
    const skeleton = { name: 'skeleton', type: 'hostile', position: skeletonAt, height: 1.99 };
    const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
      entity: { position: origin.offset(0.5, 0, 0.5) }, entities: { 1: skeleton }, health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: 2000 },
      inventory: { items: () => [{ name: 'cobblestone', count: 64 }] }, registry: require('minecraft-data')('26.1'),
      blockAt: p => { const open = p.equals(origin) || p.equals(origin.offset(0, 1, 0)); return { name: open ? 'air' : shellCells.has(`${p}`) ? 'cobblestone' : 'stone', boundingBox: open ? 'empty' : 'block', position: p }; },
      world: { raycast: () => seeThrough ? null : { position: origin.offset(1, 0, 0), intersect: origin.offset(1, 0.5, 0.5) } },
      findBlocks: () => [], pathfinder: { movements: {} }, on() {}, removeListener() {} };
    const refuge = { origin: { ...origin }, dimension: 'overworld', verifiedAt: 'x', createdAt: 'x' };
    const actions = [];
    const survival = new Survival(bot, { navigate: async () => {}, dig: async () => { actions.push('dig'); } }, { state: { shelters: [refuge] } });
    survival.leave = async () => { actions.push('leave'); };
    survival.wait = async () => { actions.push('wait'); };
    return { survival, actions };
  };
  const rock = make(origin.offset(15, 0, 0), false);
  await rock.survival.step(new Task('dawn'), {}, () => {});
  assert.deepEqual(rock.actions, ['leave'], 'a skeleton fifteen blocks away through rock does not keep the bot in');
  const watching = make(origin.offset(15, 0, 0), true);
  await watching.survival.step(new Task('dawn'), {}, () => {});
  assert.deepEqual(watching.actions, ['wait'], 'one with a line of sight does');
  // One inside the pocket with the bot is fought, not waited out.
  const inside = make(origin.offset(0.7, 0, 0.6), true);
  Object.assign(inside.survival.bot, { pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, equip: async () => {}, attack() {}, heldItem: null });
  const goal = {};
  await inside.survival.step(new Task('night'), goal, () => {});
  assert(!inside.actions.includes('wait'), `not waited out: ${inside.actions}`);
  assert.equal(goal.survivalAction?.action, 'fight_in_pocket');
});

test('a pocket sealed in a staircase is left through the closure the bot placed', async () => {
  const { Survival } = require('../src/survival');
  const origin = new Vec3(0, 20, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`, `${origin.offset(-2, -1, 0)}`, `${origin.offset(-2, 0, 0)}`, `${origin.offset(-2, 1, 0)}`]);
  const placed = new Set([`${origin.offset(-1, 0, 0)}`, `${origin.offset(-1, 1, 0)}`, `${origin.offset(1, 0, 0)}`, `${origin.offset(1, 1, 0)}`]);
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
    entity: { position: origin.offset(0.5, 0, 0.5) }, entities: {}, health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: 2000 },
    inventory: { items: () => [{ name: 'cobblestone', count: 60 }] }, registry: require('minecraft-data')('26.1'),
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : placed.has(`${p}`) ? 'cobblestone' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {} }, on() {}, removeListener() {} };
  const refuge = { origin: { ...origin }, dimension: 'overworld', verifiedAt: 'x', createdAt: 'x' };
  const dug = [];
  const survival = new Survival(bot, { navigate: async () => { throw new Error('no outside cell to walk to'); }, dig: async (b, t, p) => { dug.push(`${p}`); } }, { state: { shelters: [refuge] } });
  assert.equal(shelter.exits(bot, refuge).length, 0);
  assert.deepEqual(shelter.closures(bot, refuge).map(String), [`${origin.offset(-1, 0, 0)}`], 'only the door onto the open staircase');
  await survival.leave(new Task('dawn'), {}, () => {}, refuge);
  assert.deepEqual(dug, [`${origin.offset(-1, 1, 0)}`, `${origin.offset(-1, 0, 0)}`]);
  assert.deepEqual(survival.state.shelters, [], 'a pocket is forgotten once left, so its shell is not reserved against the climb');
});

test('a pocket left past the mobs, as Jev chose, is opened though a mob is near every door', async () => {
  const { Survival } = require('../src/survival');
  const origin = new Vec3(0, 20, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`, `${origin.offset(-2, -1, 0)}`, `${origin.offset(-2, 0, 0)}`, `${origin.offset(-2, 1, 0)}`]);
  const placed = new Set([`${origin.offset(-1, 0, 0)}`, `${origin.offset(-1, 1, 0)}`, `${origin.offset(1, 0, 0)}`, `${origin.offset(1, 1, 0)}`]);
  const make = () => {
    const zombie = { name: 'zombie', type: 'hostile', position: origin.offset(4.5, 0, 0.5), height: 1.95 };
    const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
      entity: { position: origin.offset(0.5, 0, 0.5) }, entities: { 1: zombie }, health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: 2000 },
      inventory: { items: () => [{ name: 'cobblestone', count: 60 }] }, registry: require('minecraft-data')('26.1'),
      blockAt: p => ({ name: open.has(`${p}`) ? 'air' : placed.has(`${p}`) ? 'cobblestone' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
      world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {} }, on() {}, removeListener() {} };
    const refuge = { origin: { ...origin }, dimension: 'overworld', verifiedAt: 'x', createdAt: 'x' };
    const dug = [], waits = [];
    const survival = new Survival(bot, { navigate: async () => { throw new Error('no outside cell to walk to'); }, dig: async (b, t, p) => { dug.push(`${p}`); } }, { state: { shelters: [refuge] } });
    survival.wait = async (t, g, s, reason) => { waits.push(reason); };
    return { survival, refuge, dug, waits };
  };
  const held = make();
  await held.survival.leave(new Task('dawn'), {}, () => {}, held.refuge);
  assert.deepEqual(held.dug, [], 'leaving for the work alone still waits a mob out');
  assert.match(held.waits[0], /block the shelter exits/);
  const past = make();
  await past.survival.leave(new Task('dawn'), {}, () => {}, past.refuge, undefined, { past: true });
  assert.deepEqual(past.waits, []);
  assert.equal(past.dug.length, 2, 'the door is opened');
});

test('leaving a pocket opens every closure so the staircase continues both ways', async () => {
  const { Survival } = require('../src/survival');
  const origin = new Vec3(0, 20, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`, `${origin.offset(-2, -1, 0)}`, `${origin.offset(-2, 0, 0)}`, `${origin.offset(2, 1, 0)}`, `${origin.offset(2, 2, 0)}`]);
  const placed = new Set([`${origin.offset(-1, 0, 0)}`, `${origin.offset(-1, 1, 0)}`, `${origin.offset(1, 0, 0)}`, `${origin.offset(1, 1, 0)}`]);
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { position: origin.offset(0.5, 0, 0.5) }, entities: {},
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : placed.has(`${p}`) ? 'cobblestone' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
    world: { raycast: () => null }, on() {}, removeListener() {} };
  const refuge = { origin: { ...origin }, dimension: 'overworld', verifiedAt: 'x', createdAt: 'x' };
  const dug = [];
  const survival = new Survival(bot, { dig: async (b, t, p) => { dug.push(`${p}`); } }, { state: { shelters: [refuge] } });
  await survival.leave(new Task('dawn'), {}, () => {}, refuge);
  assert.equal(dug.length, 4, 'both closures, two blocks each');
});

test('a hostile behind rock does not make a step toward it unsafe unless it is nearly at the wall', () => {
  const { safeFromHostiles } = require('../src/danger');
  const skeleton = { name: 'skeleton', type: 'hostile', position: new Vec3(20.5, 64, 0.5), height: 1.99 };
  const make = raycast => ({ game: { gameMode: 'survival', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 1: skeleton }, world: { raycast } });
  const wall = () => ({ position: new Vec3(3, 65, 0), intersect: new Vec3(3, 65.5, 0.5) });
  assert.equal(safeFromHostiles(make(wall), new Vec3(1.5, 64, 0.5), [skeleton]), true, 'through rock, twenty blocks is nothing');
  assert.equal(safeFromHostiles(make(() => null), new Vec3(1.5, 64, 0.5), [skeleton]), false, 'in sight, a ranged mob keeps its twenty-block ring');
  skeleton.position = new Vec3(5.5, 64, 0.5);
  assert.equal(safeFromHostiles(make(wall), new Vec3(1.5, 64, 0.5), [skeleton]), false, 'at the wall it still counts');
});

test('a verified pocket well below is not the current shelter when the bot carries blocks for a new one', () => {
  const { Survival } = require('../src/survival');
  const deep = { origin: { x: 0, y: 15, z: 0 }, dimension: 'overworld', verifiedAt: 'x', createdAt: 'x' };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 31, 0.5) }, blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    inventory: { items: () => [{ name: 'cobblestone', count: 64 }] }, on() {}, removeListener() {} };
  const survival = new Survival(bot, {}, { state: { shelters: [deep] } });
  assert.equal(survival.currentShelter(), undefined, 'sixteen blocks down is a day of climbing');
  bot.inventory.items = () => [];
  assert.equal(survival.currentShelter(), deep, 'with nothing to seal a pocket, the old one is still the shelter');
  bot.entity.position = new Vec3(0.5, 18, 0.5); bot.inventory.items = () => [{ name: 'cobblestone', count: 64 }];
  assert.equal(survival.currentShelter(), deep, 'three blocks down is fine');
});

test('an air cell in the shell with solid blocks on all six sides counts as sealed', () => {
  const origin = new Vec3(0, 51, 0);
  const pocket = origin.offset(1, 0, 1);
  const bot = { game: { dimension: 'overworld' }, entity: { position: origin.offset(0.5, 0, 0.5) },
    blockAt: p => { const open = p.equals(origin) || p.equals(origin.offset(0, 1, 0)) || p.equals(pocket); return { name: open ? 'air' : 'stone', boundingBox: open ? 'empty' : 'block' }; } };
  const refuge = { origin, dimension: 'overworld' };
  assert.deepEqual(shelter.missingShell(bot, refuge), []);
  assert.equal(shelter.sealed(bot, refuge), true);
  const exposed = { ...bot, blockAt: p => { const open = p.equals(origin) || p.equals(origin.offset(0, 1, 0)) || p.equals(pocket) || p.equals(pocket.offset(1, 0, 0)); return { name: open ? 'air' : 'stone', boundingBox: open ? 'empty' : 'block' }; } };
  assert.equal(shelter.missingShell(exposed, refuge).length, 1, 'a pocket open to the outside is still missing');
});

test('cornered in a tunnel with stone in hand, the bot walls the cell toward the mob shut, unless the mob is already in it', async () => {
  const { Survival } = require('../src/survival');
  const feet = new Vec3(0, 10, 0);
  const make = zombieX => {
    const zombie = { name: 'zombie', type: 'hostile', position: new Vec3(zombieX, 10, 0.5), height: 1.95 };
    const placed = [];
    const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { position: feet.offset(0.5, 0, 0.5) }, entities: { 1: zombie },
      inventory: { items: () => [{ name: 'cobblestone', count: 64 }] }, world: { raycast: () => null }, on() {}, removeListener() {},
      blockAt: p => { const open = p.y >= 10 && p.y <= 11 && p.z === 0; return { name: open ? 'air' : 'stone', boundingBox: open ? 'empty' : 'block', position: p }; } };
    const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p}`); } }, { state: { shelters: [] } });
    const { threats } = require('../src/danger');
    return { survival, placed, danger: threats(bot) };
  };
  const far = make(2.5);
  assert.equal(await far.survival.wallOff(new Task('wall'), {}, () => {}, far.danger), true);
  assert.deepEqual(far.placed, ['(1, 10, 0)', '(1, 11, 0)']);
  const near = make(1.5);
  assert.equal(await near.survival.wallOff(new Task('wall'), {}, () => {}, near.danger), false, 'the mob is in the cell: fight it');
});

test('with lava beside it and a mob coming, the bot leaves the lava edge before fleeing or fighting', async () => {
  const { Survival } = require('../src/survival');
  const feet = new Vec3(0, 10, 0);
  const lava = new Set([`${feet.offset(1, -1, 0)}`, `${feet.offset(2, -1, 0)}`, `${feet.offset(1, 0, 0)}`]);
  const zombie = { name: 'zombie', type: 'hostile', position: new Vec3(-4.5, 10, 0.5), height: 1.95 };
  const moved = [];
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { position: feet.offset(0.5, 0, 0.5) }, entities: { 1: zombie },
    registry: require('minecraft-data')('26.1'), inventory: { items: () => [{ name: 'cobblestone', count: 64 }] }, world: { raycast: () => null }, on() {}, removeListener() {}, clearControlStates() {},
    blockAt: p => lava.has(`${p}`) ? { name: 'lava', boundingBox: 'empty', position: p } : p.y < 10 ? { name: 'stone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p },
    findBlocks: ({ maxDistance, count, useExtraInfo }) => { const out = []; for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) { const p = new Vec3(x, 9, z); const b = bot.blockAt(p); if (b.name === 'stone' && (!useExtraInfo || useExtraInfo({ ...b, position: p }))) out.push(p); } return out.slice(0, count); },
    pathfinder: { movements: {}, getPathTo: async () => ({ status: 'success', path: [] }), setGoal() {} } };
  const survival = new Survival(bot, { navigate: async (b, t, goal) => { moved.push([goal.x, goal.z]); bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); } }, { state: { shelters: [] } });
  await survival.flee(new Task('lava'), {}, () => {});
  assert.equal(moved.length, 1, 'one move: off the lava edge');
  const { lavaBeside } = require('../src/survival');
  assert.equal(lavaBeside(bot, bot.entity.position.floored()), false, 'and it lands clear of the lava');
});

test('a fight chosen bare-handed against a creeper at arm\'s length swings at it: trial 99 held that fight twenty times a second doing nothing', async () => {
  const { Survival } = require('../src/survival');
  const feet = new Vec3(0, 10, 0);
  const creeper = { id: 1, name: 'creeper', type: 'hostile', position: new Vec3(1.5, 10, 0.5), height: 1.7, width: 0.6, isValid: true, metadata: [] };
  const attacks = [];
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 }, entity: { position: feet.offset(0.5, 0, 0.5), velocity: new Vec3(0, 0, 0), onGround: true }, entities: { 1: creeper },
    health: 10, food: 20, oxygenLevel: 20, time: { timeOfDay: 2000 }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'cobblestone', count: 64 }], slots: {} }, world: { raycast: () => null },
    heldItem: null, equip: async item => { bot.heldItem = item; }, unequip: async () => {}, lookAt: async () => {}, attack: t => attacks.push(t.name),
    clearControlStates() {}, setControlState() {}, on() {}, removeListener() {},
    blockAt: p => ({ name: p.y < 10 ? 'stone' : 'air', boundingBox: p.y < 10 ? 'block' : 'empty', position: p }),
    findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} } };
  const survival = new Survival(bot, { navigate: async () => {} }, { state: {} });
  bot._defenseAttackAt = 0;
  const started = Date.now();
  await survival.swingFor(new Task('fight'), {}, () => {}, 300);
  assert.deepEqual(attacks.slice(0, 1), ['creeper'], 'the chosen fight swings at the creeper');
  assert(Date.now() - started >= 250, 'and holds for its time rather than handing straight back');
});

test('a mob at arm\'s length is fought swing after swing, with no route search between and no sealing against it', async () => {
  const { Survival } = require('../src/survival');
  const feet = new Vec3(0, 10, 0);
  const zombie = { id: 1, name: 'zombie', type: 'hostile', position: new Vec3(1.5, 10, 0.5), height: 1.95, width: 0.6, isValid: true };
  const attacks = [], routes = [], sealed = [];
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 }, entity: { position: feet.offset(0.5, 0, 0.5) }, entities: { 1: zombie },
    health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: 2000 }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword', count: 1, type: 5 }, { name: 'cobblestone', count: 64 }] }, world: { raycast: () => null },
    heldItem: null, equip: async item => { bot.heldItem = item; }, unequip: async () => {}, lookAt: async () => {}, attack: t => attacks.push(t.name),
    clearControlStates() {}, on() {}, removeListener() {},
    blockAt: p => ({ name: p.y < 10 ? 'stone' : 'air', boundingBox: p.y < 10 ? 'block' : 'empty', position: p }),
    findBlocks: () => { routes.push('search'); return []; },
    pathfinder: { movements: {}, setGoal() {}, getPathTo: async () => { routes.push('route'); return { status: 'success', path: [] }; } } };
  const refuge = { origin: { ...feet }, dimension: 'overworld', createdAt: 'x' };
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, t, p) => { sealed.push(`${p}`); }, dig: async () => {} }, { state: { shelters: [refuge] } });
  bot._defenseAttackAt = 0;
  await survival.step(new Task('fight'), {}, () => {});
  assert.deepEqual(attacks, ['zombie']);
  assert.deepEqual(routes, [], 'no escape search while the mob is in reach');
  assert.deepEqual(sealed, [], 'no sealing against a mob in the cell');
});

test('a stock-driven food search is set aside after five minutes of finding nothing, and real hunger still forages', async () => {
  const { Survival } = require('../src/survival');
  const forages = [];
  const make = (food, state) => {
    const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
      entity: { position: new Vec3(0.5, 70, 0.5) }, entities: {}, health: 20, food, oxygenLevel: 20, time: { timeOfDay: 2000 },
      inventory: { items: () => [] }, registry: require('minecraft-data')('26.1'),
      blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }),
      findBlocks: () => [], pathfinder: { movements: {} }, on() {}, removeListener() {} };
    return new Survival(bot, { explore: async () => { forages.push(food); }, navigate: async () => {}, acquireStep: async () => {} }, { state });
  };
  // Five and more minutes of searching, as the supervisor keeps it, with no food found.
  const state = { shelters: [], progress: { 'food_search:stock': { best: 0, looks: 40, bestAt: Date.now() - 400000 } } };
  assert.equal(await make(20, state).step(new Task('stock'), { kind: 'win', stockFood: true }, () => {}), false, 'five minutes of nothing: the reserve waits');
  assert(require('../src/progress').isSetAside({ state }, 'food_search', 'stock'), 'set aside in the shared memory, with the reason');
  assert.equal(await make(20, state).step(new Task('stock again'), { kind: 'win', stockFood: true }, () => {}), false, 'and stays paused');
  assert.equal(await make(10, state).step(new Task('hungry'), { kind: 'win', stockFood: true }, () => {}), true, 'real hunger still forages');
  assert.deepEqual(forages, [10]);
});

test('a mob watching the shelter in daylight keeps the bot in for three minutes, not the whole day', async () => {
  const { Survival } = require('../src/survival');
  const origin = new Vec3(0, 20, 0);
  const shellCells = new Set(shelter.shell(origin).map(p => `${p}`));
  const skeleton = { name: 'skeleton', type: 'hostile', position: origin.offset(10, 0, 0), height: 1.99 };
  const make = state => {
    const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 },
      entity: { position: origin.offset(0.5, 0, 0.5) }, entities: { 1: skeleton }, health: 20, food: 20, oxygenLevel: 20, time: { timeOfDay: 2000 },
      inventory: { items: () => [{ name: 'cobblestone', count: 64 }] }, registry: require('minecraft-data')('26.1'),
      blockAt: p => { const open = p.equals(origin) || p.equals(origin.offset(0, 1, 0)); return { name: open ? 'air' : shellCells.has(`${p}`) ? 'cobblestone' : 'stone', boundingBox: open ? 'empty' : 'block', position: p }; },
      world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {} }, on() {}, removeListener() {} };
    const refuge = { origin: { ...origin }, dimension: 'overworld', verifiedAt: 'x', createdAt: 'x' };
    const actions = [];
    const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {} }, { state: { shelters: [refuge], ...state } });
    survival.leave = async () => { actions.push('leave'); }; survival.wait = async () => { actions.push('wait'); };
    return { survival, actions };
  };
  const fresh = make({});
  await fresh.survival.step(new Task('watched'), {}, () => {});
  assert.deepEqual(fresh.actions, ['wait']);
  const long = make({ watchedSince: Date.now() - 200000 });
  await long.survival.step(new Task('outwaited'), {}, () => {});
  assert.deepEqual(long.actions, ['leave']);
});

// Unarmed: with a sword a lone skeleton this close is run at instead.
test('cornered by a ranged mob with no way out and nothing to fight with, the bot closes every open side into a pocket', async () => {
  const { Survival } = require('../src/survival');
  const feet = new Vec3(0, 10, 0);
  const skeleton = { name: 'skeleton', type: 'hostile', position: new Vec3(5.5, 10, 0.5), height: 1.99 };
  const placed = [];
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { position: feet.offset(0.5, 0, 0.5) }, entities: { 1: skeleton },
    inventory: { items: () => [{ name: 'cobblestone', count: 64 }] }, world: { raycast: () => null }, on() {}, removeListener() {}, clearControlStates() {},
    registry: require('minecraft-data')('26.1'),
    blockAt: p => ({ name: p.y >= 10 && p.y <= 12 ? 'air' : 'stone', boundingBox: p.y >= 10 && p.y <= 12 ? 'empty' : 'block', position: p }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }), setGoal() {} } };
  const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p}`); }, navigate: async () => {} }, { state: { shelters: [] } });
  await survival.flee(new Task('shot at'), {}, () => {});
  assert(placed.length >= 9, `the whole shell goes up, not one wall: ${placed.length} placed`);
  assert.equal(survival.state.shelters.length, 1, 'and the pocket is registered so the next step waits inside it');
});

// A skeleton in view at ten blocks, a bow and arrows in the pack.
// A sword runs a lone skeleton down (measured: 0 to 2 damage against 16 to
// 17 for the bow at eight blocks), so the bow's own flow is tested without
// one.
function archerFixture({ health = 20, client, sword = false, shield = true, lone = true } = {}) {
  const registry = require('prismarine-registry')('26.1');
  const skeleton = { id: 7, name: 'skeleton', position: new Vec3(10.5, 64, .5), width: .6, height: 1.99, isValid: true };
  const arrows = { name: 'arrow', count: 8 }, events = [], destination = new Vec3(-8, 64, 0);
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    // Not lone: a blaze behind the skeleton. A flying shooter is not run at
    // (only ground ones are), so the stance is asked.
    entity: { position: new Vec3(.5, 64, .5) }, entities: { 7: skeleton, ...(lone ? {} : { 17: { id: 17, name: 'blaze', position: new Vec3(11.5, 64, 4.5), width: .6, height: 1.8, isValid: true } }) }, health, food: 20, oxygenLevel: 20, quickBarSlot: 0,
    time: { timeOfDay: 6000 }, inventory: { items: () => [...(sword ? [{ name: 'iron_sword' }] : []), { name: 'bow', count: 1, durabilityUsed: 0 }, arrows], slots: shield ? { 45: { name: 'shield' } } : {} },
    world: { raycast: () => null },
    blockAt: p => ({ position: p.floored(), name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    findBlocks: () => [destination.offset(0, -1, 0)],
    pathfinder: { movements: { canDig: true, allow1by1towers: true, allowSprinting: false }, setGoal() {},
      getPathTo: () => ({ status: 'success', path: [{ ...destination, toBreak: [], toPlace: [] }] }) },
    clearControlStates() {}, lookAt: async () => {}, attack: () => events.push('attack'), equip: async i => { bot.heldItem = i; events.push(`equip ${i.name}`); },
    look: async (yaw, pitch) => { bot.lastSentRotation = { yaw: (Math.PI - yaw) * 180 / Math.PI, pitch: -pitch * 180 / Math.PI }; },
    activateItem: offHand => events.push(offHand ? 'raise shield' : 'draw'), setQuickBarSlot: () => {},
    deactivateItem: () => {
      const drawing = events.at(-1) === 'draw';
      events.push(drawing ? 'release' : 'lower shield');
      if (drawing) { arrows.count--; bot.emit('entitySpawn', { id: 9, name: 'arrow', position: bot.entity.position.offset(0, 1.52, 0), velocity: new Vec3(3, 0, 0) }); }
    },
  });
  const controller = new Survival(bot, { navigate: async (b, t, g) => { events.push('navigate'); b.entity.position = new Vec3(g.x + .5, g.y, g.z + .5); } }, { client });
  return { bot, skeleton, arrows, events, controller, task: new Task('archer'), goal: { kind: 'obtain', item: 'dirt', count: 32 } };
}

test('a skeleton in view at bow range is shot from where the bot stands, then the shield comes up', async () => {
  const { bot, arrows, events, controller, task, goal } = archerFixture();
  assert(await controller.step(task, goal, () => {}));
  assert.deepEqual(events, ['equip bow', 'draw', 'release', 'raise shield'], 'no retreat, no swing: the shooter is the target');
  assert.equal(arrows.count, 7);
  assert.equal(goal.survivalAction.action, 'shoot'); assert.equal(goal.survivalAction.target, 'skeleton'); assert(goal.survivalAction.released);
  assert.equal(goal.decisions.at(-1).path[0], 'shoot_7'); assert.deepEqual(Object.keys(goal.decisions.at(-1).options).sort(), ['retreat', 'shoot_7']);
  delete bot.entities[7];
  assert.equal(await controller.step(task, goal, () => {}), false);
  assert.equal(events.at(-1), 'lower shield', 'a raised shield is sneaking speed; it comes down once nothing is in view');
});

test('Jev is offered the shot, the retreat and, with blocks in the pack, a pocket; its choice runs', async () => {
  // The ranged question answers when the stance is not asked (JEV_ENCOUNTERS=0).
  process.env.JEV_ENCOUNTERS = '0';
  let asked;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, questions }; return { answers: { branch_0: { choice: 'retreat' } } }; } };
  const { bot, events, controller, task, goal } = archerFixture({ client, sword: true, shield: false, lone: false });
  bot.inventory.items = () => [{ name: 'iron_sword' }, { name: 'bow', count: 1, durabilityUsed: 0 }, { name: 'arrow', count: 8 }, { name: 'cobblestone', count: 20 }];
  try { assert(await controller.step(task, goal, () => {})); } finally { delete process.env.JEV_ENCOUNTERS; }
  assert.deepEqual(Object.keys(asked.questions.branch_0.criteria).sort(), ['dig_in', 'retreat', 'shoot_17', 'shoot_7']);
  assert.deepEqual(asked.state.threats, [{ name: 'skeleton', distance: 10, shoots: true, visible: true }, { name: 'blaze', distance: 12, shoots: true, visible: true }]); assert.equal(asked.state.arrowsCarried, 8);
  assert(asked.state.riskNow && asked.state.deathWouldCost, 'the risk and what a death costs are in the state');
  assert.match(asked.questions.branch_0.criteria.retreat, /No route is checked yet/);
  assert.deepEqual(events, ['navigate'], 'the retreat ran and nothing was drawn');
  assert.equal(goal.survivalAction.action, 'escape_threat');
});

test('the ranged question offers the pocket with a creeper near, and says what the creeper and the mobs out of sight do', async () => {
  // The decision audit (2026-09-25): the pocket was hidden with a creeper
  // within seven blocks; now it is offered, with what a creeper does to it.
  let asked;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, questions }; return { answers: { branch_0: { choice: 'retreat' } } }; } };
  const { bot, controller, task, goal } = archerFixture({ client, sword: true, shield: false });
  bot.inventory.items = () => [{ name: 'iron_sword' }, { name: 'bow', count: 1, durabilityUsed: 0 }, { name: 'arrow', count: 8 }, { name: 'cobblestone', count: 20 }];
  bot.entities[30] = { id: 30, name: 'creeper', position: new Vec3(-4.5, 64, .5), width: .6, height: 1.7, isValid: true };
  bot.entities[31] = { id: 31, name: 'zombie', position: new Vec3(.5, 64, 12.5), width: .6, height: 1.95, isValid: true };
  const { threats } = require('../src/danger');
  bot.world.raycast = (from, dir, range) => dir.z > 0.9 ? { position: from.offset(0, 0, 2).floored(), intersect: from.offset(0, 0, 2) } : null;
  const danger = threats(bot, 32).filter(t => t.visible);
  controller.escape = async () => {};
  await controller.rangedChoice(task, goal, () => {}, danger, true);
  const c = asked.questions.branch_0.criteria;
  assert.match(c.dig_in, /creeper 5 blocks off walks up to a pocket and goes off before it closes/);
  assert.match(c.shoot_7.action, /creeper is 5 blocks off: it closes while the bow draws/);
  assert.match(c.retreat, /Out of sight but about: a zombie 12 blocks off/);
  assert(asked.state.threats.some(t => t.name === 'zombie' && t.visible === false), JSON.stringify(asked.state.threats));
});

test('with a sword a lone skeleton is run at and struck, not shot at or hidden from', async () => {
  const { bot, events, controller, task, goal } = archerFixture({ sword: true, shield: true });
  bot.setControlState = () => {}; bot.clearControlStates = () => {};
  // Close the gap each look, as walking would; struck once it is in reach.
  bot.lookAt = async () => { if (bot.entity.position.distanceTo(bot.entities[7].position) > 2.5) bot.entity.position = bot.entity.position.offset(2, 0, 0); };
  bot.blockAt = p => ({ position: p, name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' });
  bot.attack = target => { events.push('attack'); target.isValid = false; };
  assert(await controller.step(task, goal, () => {}));
  assert.equal(goal.survivalAction.action, 'close_on_shooter');
  assert(events.includes('attack'), events.join(','));
  assert(!events.includes('draw'), 'no bow at eight blocks with a sword and a shield');
});

test('no charge from the water or at half health against more than one', async () => {
  const wet = archerFixture({ sword: true, shield: false });
  wet.bot.entity.isInWater = true;
  await wet.controller.step(wet.task, wet.goal, () => {}).catch(() => {});
  assert.notEqual(wet.goal.survivalAction?.action, 'close_on_shooter', 'a river is no place to run from');
  const tired = archerFixture({ sword: true, shield: false, health: 10 });
  tired.bot.entities[18] = { id: 18, name: 'skeleton', position: new Vec3(6.5, 64, 6.5), width: .6, height: 1.99, isValid: true };
  await tired.controller.step(tired.task, tired.goal, () => {}).catch(() => {});
  assert.notEqual(tired.goal.survivalAction?.action, 'close_on_shooter', 'two at ten health is not the measured case');
});

test('two skeletons are run at one after the other when health allows', async () => {
  const { bot, events, controller, task, goal } = archerFixture({ sword: true, shield: false });
  bot.entities[18] = { id: 18, name: 'skeleton', position: new Vec3(6.5, 64, 6.5), width: .6, height: 1.99, isValid: true };
  bot.setControlState = () => {}; bot.clearControlStates = () => {};
  const at = () => Object.values(bot.entities).filter(e => e.name === 'skeleton' && e.isValid).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
  bot.lookAt = async () => { const e = at(); if (e && bot.entity.position.distanceTo(e.position) > 2.5) bot.entity.position = e.position.offset(-1.5, 0, 0); };
  bot.blockAt = p => ({ position: p, name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' });
  bot.attack = target => { events.push(`attack ${target.id}`); target.isValid = false; delete bot.entities[target.id]; };
  assert(await controller.step(task, goal, () => {}));
  assert.deepEqual(events.filter(e => e.startsWith('attack')).sort(), ['attack 18', 'attack 7']);
});

test('hurt, or with a zombie closing, the bow stays in the pack and the escape rules take over', async () => {
  const hurt = archerFixture({ health: 6, sword: true, shield: false, lone: false });
  assert(await hurt.controller.step(hurt.task, hurt.goal, () => {}));
  assert.deepEqual(hurt.events, ['navigate']); assert.equal(hurt.goal.decisions, undefined, 'no question at six health');
  const crowded = archerFixture({ sword: true, shield: true });
  crowded.bot.entities[8] = { id: 8, name: 'zombie', position: new Vec3(3, 64, .5), width: .6, height: 1.95, isValid: true };
  assert(await crowded.controller.step(crowded.task, crowded.goal, () => {}));
  assert.deepEqual(crowded.events, ['equip iron_sword', 'attack', 'raise shield'], 'a zombie within a sword\'s reach is fought, the shield up between swings, not drawn on or run from');
});

test('Jev picks the stance once and it holds; unsure, its pick still stands', async () => {
  const calls = [];
  const client = { systemOne: async ({ state, questions }) => { calls.push({ state, questions }); return { answers: { branch_0: { choice: 'retreat', confidence: 0.9 } } }; } };
  const { bot, events, controller, task, goal } = archerFixture({ client, sword: true, shield: false, lone: false });
  bot.inventory.items = () => [{ name: 'iron_sword' }, { name: 'bow', count: 1, durabilityUsed: 0 }, { name: 'arrow', count: 8 }, { name: 'cobblestone', count: 20 }];
  assert(await controller.step(task, goal, () => {}));
  assert.equal(goal.decisions.at(-1).id, 'encounter_stance');
  assert.deepEqual(Object.keys(calls[0].questions.branch_0.criteria).sort(), ['charge_shooter', 'fight', 'keep_working', 'pillar', 'retreat', 'seal', 'shoot_17', 'shoot_7']);
  assert.deepEqual(calls[0].state.threats, [{ name: 'skeleton', distance: 10, shoots: true, visible: true }, { name: 'blaze', distance: 11.7, shoots: true, visible: true }]);
  assert.deepEqual(events, ['navigate'], 'the retreat ran');
  bot.entity.position = new Vec3(.5, 64, .5);
  await controller.step(task, goal, () => {});
  assert.equal(calls.length, 1, 'the stance holds for the same mobs, not asked again at every tick');

  const unsure = archerFixture({ sword: true, shield: false, lone: false, client: { systemOne: async () => ({ answers: { branch_0: { choice: 'shoot_7', confidence: 0.2 } } }) } });
  assert(await unsure.controller.step(unsure.task, unsure.goal, () => {}));
  const asked = unsure.goal.decisions.find(d => d.id === 'encounter_stance');
  assert.equal(asked.gated, undefined, 'no gate: an unsure pick is not handed to the rules');
  assert.equal(unsure.goal.survivalAction.action, 'shoot', 'Jev\'s pick ran');
  assert(!unsure.goal.decisions.some(d => d.id === 'ranged_response'), 'no second question from the rules');
});

test('a carried bed goes down at bedtime, the night passes, and the bed comes back up', async () => {
  const { Survival, bedSite } = require('../src/survival');
  const blocks = new Map(); let items = [{ name: 'white_bed', count: 1 }, { name: 'iron_sword' }];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 13000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, isSleeping: false, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => items, slots: {} }, heldItem: null,
    equip: async item => { bot.heldItem = item; }, lookAt: async () => {},
    placeBlock: async () => { blocks.set(`${new Vec3(1, 64, 0)}`, 'white_bed'); blocks.set(`${new Vec3(2, 64, 0)}`, 'white_bed'); items = items.filter(i => i.name !== 'white_bed'); },
    sleep: async block => { assert.equal(block.name, 'white_bed'); bot.isSleeping = true; setTimeout(() => { bot.time.timeOfDay = 0; bot.isSleeping = false; }, 50); },
    wake: async () => { bot.isSleeping = false; },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'grass_block' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }) });
  assert.deepEqual(bedSite(bot), { stand: new Vec3(0, 64, 0), foot: new Vec3(1, 64, 0), head: new Vec3(2, 64, 0) });
  const dug = [];
  const survival = new Survival(bot, { navigate: async () => {}, dig: async (b, t, p) => { dug.push(`${p}`); blocks.delete(`${p}`); items.push({ name: 'white_bed', count: 1 }); } });
  const goal = {}; const actions = [];
  survival.report = (g, sv, action) => actions.push(action.action);
  await survival.sleepStep(new Task('test', 'sleep'), goal, () => {});
  assert.deepEqual(actions, ['sleep', 'leave_shelter']);
  assert.equal(bot.time.timeOfDay, 0);
  assert(dug.length >= 1, 'the bed is picked back up'); assert(items.some(i => i.name === 'white_bed'));
});

test('a sleep the server confirms late still counts: the clock decides, not mineflayer\'s three-second timeout', async () => {
  const { Survival } = require('../src/survival');
  const blocks = new Map(); let items = [{ name: 'white_bed', count: 1 }, { name: 'iron_sword' }];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 13000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, isSleeping: false, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => items, slots: {} }, heldItem: null, equip: async item => { bot.heldItem = item; }, lookAt: async () => {},
    placeBlock: async () => { blocks.set(`${new Vec3(1, 64, 0)}`, 'white_bed'); blocks.set(`${new Vec3(2, 64, 0)}`, 'white_bed'); items = items.filter(i => i.name !== 'white_bed'); },
    // The server puts the bot to bed, but mineflayer's event never comes.
    sleep: async () => { setTimeout(() => { bot.time.timeOfDay = 0; }, 50); throw new Error('bot is not sleeping'); },
    wake: async () => {},
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'grass_block' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }) });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async (b, t, p) => { blocks.delete(`${p}`); items.push({ name: 'white_bed', count: 1 }); } });
  const actions = []; survival.report = (g, sv, action) => actions.push(action.action);
  await survival.sleepStep(new Task('test', 'sleep'), {}, () => {});
  assert(!actions.includes('sleep_failed'), 'the night passed, so it is a sleep');
  assert.equal(survival.state.sleepFailedAt, undefined);
});

test('at night with a bed the choices are sleep, stay up, or shelter, the shelter told the bed is quicker; in a shaft, no sleep', async () => {
  const { Survival } = require('../src/survival');
  const seen = [];
  const client = { systemOne: async () => { throw new Error('offline'); } };
  const make = items => Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 13000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } }, heldItem: { name: 'iron_sword' },
    blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }), findBlocks: () => [], world: { raycast: () => null }, chat() {} });
  const bot = make([{ name: 'white_bed', count: 1 }, { name: 'iron_sword' }]);
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client });
  // The fallback is the question's own, from its definition.
  const { question } = require('../src/decisions');
  survival.decide = async (task, goal, save, { id, tree }) => { seen.push(Object.keys(tree).sort()); const key = question(id).fallback(tree, []); return { path: [key], action: tree[key], stale: false }; };
  survival.sleepStep = async () => { seen.push('slept'); };
  await survival.step(new Task('test', 'night'), { kind: 'win', request: 'beat the game' }, () => {});
  assert.deepEqual(seen, [['continue_request', 'secure_shelter', 'sleep_in_bed'], 'slept'], 'with a bed at hand, the fallback sleeps');
  // In a one-wide shaft the bed does not fit, so sleep is not on the list.
  const shaft = make([{ name: 'white_bed', count: 1 }, { name: 'iron_sword' }]);
  shaft.blockAt = p => ({ name: p.y < 64 || (p.x !== 0 || p.z !== 0) ? 'stone' : 'air', boundingBox: p.y < 64 || (p.x !== 0 || p.z !== 0) ? 'block' : 'empty', position: p });
  const narrow = new Survival(shaft, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client });
  const offered = [];
  narrow.decide = async (task, goal, save, { tree }) => { offered.push(Object.keys(tree).sort()); return { path: ['secure_shelter'], action: { run: async () => {} }, stale: false }; };
  await narrow.step(new Task('test', 'night'), { kind: 'win', request: 'beat the game' }, () => {});
  assert.deepEqual(offered, [['continue_request', 'secure_shelter']]);
});

test('the bed at the base is slept in when it is near, and it stays where it is', async () => {
  const { Survival, nearbyHomeBed } = require('../src/survival');
  const { layout } = require('../src/home-base');
  const home = { version: 1, dimension: 'overworld', origin: { x: 0, y: 63, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 63, z: 0 }, bed: { placedAt: 'now', claimedAt: 'now' }, plot: {}, pen: {} };
  const { bed } = layout(home);
  const blocks = new Map([[`${new Vec3(bed.foot.x, bed.foot.y, bed.foot.z)}`, 'white_bed'], [`${new Vec3(bed.head.x, bed.head.y, bed.head.z)}`, 'white_bed']]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 13000 },
    entity: { position: new Vec3(3.5, 64, 3.5) }, health: 20, food: 20, isSleeping: false, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null,
    sleep: async block => { assert.equal(block.name, 'white_bed'); bot.isSleeping = true; setTimeout(() => { bot.time.timeOfDay = 0; bot.isSleeping = false; }, 50); },
    wake: async () => { bot.isSleeping = false; },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'grass_block' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }) });
  const goal = { kind: 'win', survival: { home } };
  assert(nearbyHomeBed(bot, goal)?.placed, 'the base bed counts');
  // At dusk a long walk home; once it is dark, only a short one.
  bot.time.timeOfDay = 12000;
  bot.entity.position = new Vec3(80.5, 64, 0.5); assert(nearbyHomeBed(bot, goal), 'eighty blocks is a walk, not a night');
  bot.entity.position = new Vec3(140.5, 64, 0.5); assert(nearbyHomeBed(bot, goal), 'a hundred and forty is still a walk started early');
  bot.entity.position = new Vec3(200.5, 64, 0.5); assert.equal(nearbyHomeBed(bot, goal), null, 'two hundred is not');
  bot.time.timeOfDay = 13000;
  bot.entity.position = new Vec3(80.5, 64, 0.5); assert.equal(nearbyHomeBed(bot, goal), null, 'dark already: eighty blocks through the mobs is not a walk to bed');
  bot.entity.position = new Vec3(40.5, 64, 0.5); assert(nearbyHomeBed(bot, goal), 'forty is');
  bot.entity.position = new Vec3(3.5, 64, 3.5);
  const walked = [], dug = [];
  const survival = new Survival(bot, { navigate: async (b, t, g) => { walked.push([g.x, g.y, g.z]); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); }, dig: async (b, t, p) => dug.push(`${p}`) }, { state: goal.survival });
  await survival.sleepStep(new Task('test', 'sleep'), goal, () => {});
  assert.equal(bot.time.timeOfDay, 0); assert.equal(walked.length, 1, 'the stand cell is reached first time'); assert.deepEqual(dug, [], 'the base bed is not picked up');
});

test('a block left on top of the base bed is dug off before sleeping, not taken as a refusal for the night', async () => {
  const { Survival } = require('../src/survival');
  const { layout } = require('../src/home-base');
  const home = { version: 1, dimension: 'overworld', origin: { x: 0, y: 63, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 63, z: 0 }, bed: { placedAt: 'now', claimedAt: 'now' }, plot: {}, pen: {} };
  const { bed } = layout(home);
  const foot = new Vec3(bed.foot.x, bed.foot.y, bed.foot.z), head = new Vec3(bed.head.x, bed.head.y, bed.head.z);
  const blocks = new Map([[`${foot}`, 'white_bed'], [`${head}`, 'white_bed'], [`${foot.offset(0, 1, 0)}`, 'netherrack']]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 13000 },
    entity: { position: new Vec3(3.5, 64, 3.5) }, health: 20, food: 20, isSleeping: false, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null,
    // The server refuses while anything sits on the bed.
    sleep: async () => { if (blocks.has(`${foot.offset(0, 1, 0)}`)) throw new Error('obstructed'); setTimeout(() => { bot.time.timeOfDay = 0; }, 50); },
    wake: async () => {},
    blockAt: p => { const name = blocks.get(`${p}`) || (p.y < 64 ? 'grass_block' : 'air'); return { name, diggable: name === 'netherrack', boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }; } });
  const goal = { kind: 'win', survival: { home } }, dug = [];
  const survival = new Survival(bot, { navigate: async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); }, dig: async (b, t, p) => { dug.push(`${p}`); blocks.delete(`${p}`); } }, { state: goal.survival });
  await survival.sleepStep(new Task('test', 'sleep'), goal, () => {});
  assert.deepEqual(dug, [`${foot.offset(0, 1, 0)}`], 'only the block on the bed comes off');
  assert.equal(bot.time.timeOfDay, 0, 'and the night passes');
});

test('a shell leaning on the chest does not use the chest as its door', () => {
  const shelter = require('../src/shelter');
  const o = new Vec3(0, 64, 0), blocks = new Map();
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1]) blocks.set(`${o.offset(d[0], dy, d[1])}`, 'cobblestone');
  blocks.set(`${o.offset(1, 0, 0)}`, 'chest');
  const bot = { blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty' }) };
  const exits = shelter.exits(bot, { origin: { x: 0, y: 64, z: 0 } });
  assert(exits.length >= 1); assert(exits.every(e => !(e.door.x === 1 && e.door.z === 0)), 'the chest side is not a door');
});

test('at dusk with a bed at home, Jev heads home before bedtime', async () => {
  const { Survival } = require('../src/survival');
  const { layout } = require('../src/home-base');
  const home = { version: 1, dimension: 'overworld', origin: { x: 0, y: 63, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 63, z: 0 }, bed: { placedAt: 'now', claimedAt: 'now' }, plot: {}, pen: {} };
  const { bed } = layout(home);
  const blocks = new Map([[`${new Vec3(bed.foot.x, bed.foot.y, bed.foot.z)}`, 'white_bed'], [`${new Vec3(bed.head.x, bed.head.y, bed.head.z)}`, 'white_bed']]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 11600 },
    entity: { position: new Vec3(30.5, 40, 0.5) }, health: 20, food: 20, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null, findBlocks: () => [], world: { raycast: () => null }, chat() {},
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }) });
  const walked = [], climbed = [];
  const survival = new Survival(bot, { navigate: async (b, t, g) => walked.push([g.x, g.y, g.z]), surfaceStep: async () => climbed.push(1), dig: async () => {}, place: async () => {} }, { state: { home } });
  const goal = { kind: 'win', request: 'beat the game', survival: survival.state };
  assert.equal(await survival.step(new Task('test', 'dusk'), goal, () => {}), true);
  assert.deepEqual([walked, climbed], [[], [1]], 'from the bottom of a shaft, the way home starts with the stairs');
  bot.entity.position = new Vec3(30.5, 64, 0.5);
  assert.equal(await survival.step(new Task('test', 'dusk'), goal, () => {}), true);
  assert.deepEqual(walked, [[bed.foot.x, bed.foot.y, bed.foot.z]], 'on the surface, the walk home');
  bot.entity.position = new Vec3(bed.foot.x + 2.5, 64, bed.foot.z + 0.5);
  const reported = []; survival.report = (g, sv, a) => reported.push(a.action);
  assert.equal(await survival.step(new Task('test', 'dusk'), goal, () => {}), true, 'home before bedtime: the survival layer keeps the turn');
  assert.deepEqual(reported, ['wait_for_bedtime']); assert.equal(walked.length, 1, 'no second walk, no dive back to work');
});

test('a night in a pocket is spent mining: ore in reach is dug, and a bed that can be slept in comes first', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const ore = new Vec3(2, 62, 0);
  const blocks = new Map([[`${ore}`, 'iron_ore']]);
  let items = [{ name: 'iron_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 15000 },
    entity: { position: new Vec3(0.5, 62, 0.5) }, health: 20, food: 20, registry, inventory: { items: () => items, slots: {} },
    findBlocks: ({ matching }) => blocks.has(`${ore}`) && matching.includes(registry.blocksByName.iron_ore.id) ? [ore] : [],
    blockAt: p => ({ name: blocks.get(`${p}`) || 'stone', boundingBox: 'block', position: p }), world: { raycast: () => null } });
  const dug = [];
  const survival = new Survival(bot, { dig: async (b, t, p) => { dug.push(`${p}`); blocks.delete(`${p}`); items = [...items, { name: 'raw_iron', count: 1 }]; }, navigate: async () => {} });
  const goal = { kind: 'win' }, actions = [];
  survival.report = (g, sv, action) => actions.push(action);
  assert(survival.canNightMine(goal));
  assert.equal(await survival.nightMine(new Task('night', 'mine'), goal, () => {}), true);
  assert.deepEqual(dug, [`${ore}`], 'the iron in reach is dug');
  assert.equal(actions[0].action, 'night_mine'); assert.equal(actions[0].ore, 'iron_ore');
  assert.equal(survival.state.nightMine.mined, 1);
  items = [...items, { name: 'white_bed', count: 1 }];
  assert.equal(survival.canNightMine(goal), false, 'with a bed to sleep in, the night is slept');
  bot.time.timeOfDay = 3000; items = items.filter(i => i.name !== 'white_bed');
  assert.equal(survival.canNightMine(goal), false, 'by day there is no night to fill');
});

test('an ore the night mine cannot reach is set aside, not chosen again as the nearest', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const near = new Vec3(8, 55, 0), far = new Vec3(-10, 55, 0);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 15000 },
    entity: { position: new Vec3(0.5, 62, 0.5) }, health: 20, food: 20, registry, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }], slots: {} },
    findBlocks: () => [near, far], blockAt: p => ({ name: p.equals(near) || p.equals(far) ? 'iron_ore' : 'stone', boundingBox: 'block', position: p }), world: { raycast: () => null } });
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => { throw new Error('No existing dry route away from the blocked staircase'); } });
  const chosen = []; survival.report = (g, sv, action) => chosen.push(`${action.target.x},${action.target.z}`);
  for (let i = 0; i < 4; i++) await survival.nightMine(new Task('night', 'mine'), { kind: 'win' }, () => {});
  assert(survival.state.attempts?.[`night_mine:${near.x},${near.y},${near.z}`], 'the unreachable ore rests in the shared memory of failed attempts');
  assert.equal(chosen[0], `${near.x},${near.z}`);
  assert.equal(chosen[1], `${far.x},${far.z}`, 'and the mine goes for the next one, not the nearest again');
  assert(survival.state.attempts[`night_mine:${near.x},${near.y},${near.z}`].why, 'with the reason kept');
});

test('a night-mine target the steps never get closer to is set aside, even when every step succeeds', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const ore = new Vec3(8, 55, 0);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 15000 },
    entity: { position: new Vec3(0.5, 55, 0.5) }, health: 20, food: 20, registry, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }], slots: {} },
    findBlocks: () => [ore], blockAt: p => ({ name: p.equals(ore) ? 'iron_ore' : p.y < 55 || p.y >= 60 ? 'stone' : 'air', boundingBox: p.y < 55 || p.y >= 60 || p.equals(ore) ? 'block' : 'empty', position: p }),
    world: { raycast: () => null }, pathfinder: { movements: {} } });
  // Every step "succeeds" by pacing along z, never closer in x.
  let z = 0;
  const survival = new Survival(bot, { dig: async () => {}, navigate: async (b, t, goal) => { z = z ? 0 : 1; bot.entity.position = new Vec3(0.5, 55, z + 0.5); } });
  survival.report = () => {};
  for (let i = 0; i < 20 && !survival.state.nightMine?.lastAbandoned; i++) await survival.nightMine(new Task('night', 'mine'), { kind: 'win' }, () => {});
  assert(survival.state.nightMine.lastAbandoned, 'the pacing is noticed');
  assert(survival.state.attempts[`night_mine:${ore.x},${ore.y},${ore.z}`], 'and the ore rests');
});

test('the night mine does not choose an ore in the wall of a flooded cave', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const wet = new Vec3(4, 55, 0), dry = new Vec3(-9, 55, 0);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 15000 },
    entity: { position: new Vec3(0.5, 62, 0.5) }, health: 20, food: 20, registry, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }], slots: {} },
    findBlocks: () => [wet, dry], world: { raycast: () => null },
    blockAt: p => ({ name: p.equals(wet) || p.equals(dry) ? 'copper_ore' : p.equals(wet.offset(0, 1, 0)) ? 'water' : 'stone', boundingBox: 'block', position: p }) });
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {} });
  const chosen = []; survival.report = (g, sv, action) => chosen.push(action.target);
  await survival.nightMine(new Task('night', 'mine'), { kind: 'win' }, () => {});
  assert.deepEqual(chosen[0], { x: dry.x, y: dry.y, z: dry.z }, 'the dry ore, though it is farther');
});

test('a bed in view is a bed to sleep in: its foot, a cell to stand in, never a head, an occupied one or one outside the Overworld', () => {
  const { observedBed } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const beds = new Map([
    ['4,64,0', { name: 'red_bed', props: { part: 'foot', facing: 'east', occupied: false } }],
    ['5,64,0', { name: 'red_bed', props: { part: 'head', facing: 'east', occupied: false } }],
    ['1,64,5', { name: 'white_bed', props: { part: 'foot', facing: 'north', occupied: true } }],
  ]);
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) },
    findBlocks: () => [new Vec3(5, 64, 0), new Vec3(1, 64, 5), new Vec3(4, 64, 0)],
    blockAt: p => { const b = beds.get(`${p.x},${p.y},${p.z}`); if (b) return { name: b.name, boundingBox: 'block', getProperties: () => b.props };
      return p.y < 64 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }; } };
  const bed = observedBed(bot);
  assert.deepEqual([bed.foot.x, bed.foot.z, bed.head.x, bed.head.z], [4, 0, 5, 0]);
  assert(!bed.stand.equals(bed.head) && bed.stand.distanceTo(bed.foot) === 1);
  bot.game.dimension = 'the_nether';
  assert.equal(observedBed(bot), null, 'a bed in the Nether explodes');
});

test('the escape runs from every hostile about, not only the one in view: no running from a zombie into a blaze', async () => {
  const { Survival } = require('../src/survival');
  const feet = new Vec3(0, 10, 0);
  const zombie = { id: 1, name: 'zombie', type: 'hostile', position: new Vec3(10.5, 10, 0.5), height: 1.95, width: 0.6, isValid: true };
  const blaze = { id: 2, name: 'blaze', type: 'hostile', position: new Vec3(-8.5, 12, 0.5), height: 1.8, width: 0.6, isValid: true };
  const moved = [];
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { position: feet.offset(0.5, 0, 0.5) }, entities: { 1: zombie, 2: blaze },
    registry: require('minecraft-data')('26.1'), inventory: { items: () => [] }, world: { raycast: () => null }, on() {}, removeListener() {}, clearControlStates() {},
    blockAt: p => p.y < 10 ? { name: 'stone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p },
    findBlocks: ({ count, useExtraInfo }) => { const out = []; for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) { const p = new Vec3(x, 9, z); const b = bot.blockAt(p); if (!useExtraInfo || useExtraInfo({ ...b, position: p })) out.push(p); } return out.slice(0, count); },
    pathfinder: { movements: {}, getPathTo: async () => ({ status: 'success', path: [] }), setGoal() {} } };
  const survival = new Survival(bot, { navigate: async (b, t, goal) => { moved.push(new Vec3(goal.x, goal.y, goal.z)); } }, { state: { shelters: [] } });
  // Only the zombie is "in view"; the blaze is behind the bot, out of sight for this look.
  await survival.escape(new Task('run'), {}, () => {}, [{ entity: zombie, distance: 10 }], true);
  assert.equal(moved.length, 1);
  const start = feet.offset(0.5, 0, 0.5);
  const nearest = p => Math.min(p.distanceTo(zombie.position), p.distanceTo(blaze.position));
  assert(nearest(moved[0]) >= nearest(start) + 4, `ground gained on the nearest of both, not only the zombie: ${moved[0]}`);
});

test('in lava, the way out is the nearest cell with a floor and air, and nothing else is decided first', async () => {
  const { Survival, inLava, lavaExit } = require('../src/survival');
  const lava = new Set(['0,10,0', '0,11,0', '-1,10,0', '0,10,-1']);
  const blockAt = p => lava.has(`${p.x},${p.y},${p.z}`) ? { name: 'lava', boundingBox: 'empty', position: p }
    : p.y < 10 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { entity: { position: new Vec3(0.5, 10, 0.5), isInLava: true, onGround: false }, blockAt, health: 6, food: 20,
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: {}, controlState: {},
    setControlState(k, v) { this.controlState[k] = v; if (k === 'forward' && v) { this.entity.position = new Vec3(1.5, 10, 0.5); this.entity.isInLava = false; this.entity.onGround = true; } },
    lookAt: async () => {}, inventory: { items: () => [], slots: {} }, time: { timeOfDay: 6000 }, on() {}, removeListener() {} };
  assert.equal(inLava(bot), true);
  const exit = lavaExit(bot);
  assert.equal(exit.distanceTo(new Vec3(0, 10, 0)), 1, 'a step off, not across the pool');
  assert(!lava.has(`${exit.x},${exit.y},${exit.z}`));
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const goal = {};
  assert.equal(await survival.step(new Task('lava'), goal, () => {}, () => {}), true);
  assert.equal(goal.survivalAction.action, 'leave_lava');
  assert.equal(inLava(bot), false, 'and it is out');
});

test('floating in water, the way out is dry ground with air above, never another water cell', () => {
  const { inWater, lavaExit } = require('../src/survival');
  const water = new Set(['0,10,0', '1,10,0', '0,10,1']);
  const blockAt = p => water.has(`${p.x},${p.y},${p.z}`) ? { name: 'water', boundingBox: 'empty', position: p }
    : p.y < 10 ? { name: 'dirt', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { entity: { position: new Vec3(0.5, 10.4, 0.5), isInWater: true }, blockAt };
  assert.equal(inWater(bot), true);
  const exit = lavaExit(bot);
  assert(!water.has(`${exit.x},${exit.y},${exit.z}`), `dry: ${exit}`);
  assert.equal(exit.distanceTo(new Vec3(0, 10, 0)), 1);
});

test('beside a drop is a neighbouring cell with no floor for three blocks or lava under it; firm ground has neither', () => {
  const { besideDrop, firmGround } = require('../src/survival');
  // A ledge three wide at y 99 (z 0..2), a drop to the north (z < 0).
  const blockAt = p => (p.y === 99 && p.z >= 0 && p.z <= 2 && Math.abs(p.x) <= 6) ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { entity: { position: new Vec3(0.5, 100, 0.5) }, blockAt };
  assert.equal(besideDrop(bot, new Vec3(0, 100, 0)), true, 'the edge row');
  assert.equal(besideDrop(bot, new Vec3(0, 100, 1)), false, 'the middle row of a three-wide ledge has floor all round');
  assert.equal(firmGround(bot).z, 1, 'and is where the bot steps to');
  const wide = { entity: bot.entity, blockAt: p => (p.y === 99 && p.z >= 0 && p.z <= 8 && Math.abs(p.x) <= 6) ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p } };
  const cell = firmGround(wide);
  assert(cell && cell.z >= 1 && !besideDrop(wide, cell), `a cell with ground all round: ${cell}`);
});

test('a reserve top-up once chosen is held: "get food or carry on" is not asked again every step', async () => {
  const { Survival } = require('../src/survival');
  const client = { systemOne: async () => { throw new Error('offline'); } };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 3000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null, pathfinder: { movements: {}, setGoal() {} },
    blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }), findBlocks: () => [], world: { raycast: () => null }, chat() {} });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client });
  const offered = [];
  survival.decide = async (task, goal, save, { tree }) => { offered.push(Object.keys(tree).sort()); return { path: ['obtain_food'], action: { run: async () => {} }, stale: false }; };
  const goal = { kind: 'win', request: 'beat the game', stockFood: true };
  for (let i = 0; i < 3; i++) await survival.step(new Task('test', 'food'), goal, () => {});
  assert.deepEqual(offered[0], ['continue_request', 'obtain_food'], 'asked once');
  assert(offered.slice(1).every(keys => !keys.includes('continue_request')), `then held: ${JSON.stringify(offered)}`);
});

test('after two nights awake, staying up says phantoms come on the third; it is still Jev\'s to weigh', async () => {
  const { Survival, SLEEP_DEBT_TICKS } = require('../src/survival');
  const seen = [];
  const make = () => Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 13000, age: 100000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'white_bed', count: 1 }, { name: 'iron_sword' }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } }, heldItem: { name: 'iron_sword' },
    blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }), findBlocks: () => [], world: { raycast: () => null }, chat() {} });
  const bot = make();
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => ({}) } });
  survival.decide = async (task, goal, save, { tree }) => { seen.push(tree); return { path: ['sleep_in_bed'], action: { run: async () => {} }, stale: false }; };
  survival.sleepStep = async () => {};
  await survival.step(new Task('t', 'night'), { kind: 'win', request: 'beat the game' }, () => {});
  bot.time.age += SLEEP_DEBT_TICKS + 1;
  await survival.step(new Task('t', 'night'), { kind: 'win', request: 'beat the game' }, () => {});
  assert.doesNotMatch(seen[0].continue_request.description, /phantoms/, 'rested: nothing to warn of');
  assert.match(seen[1].continue_request.description, /phantoms come for a player on the third/);
  assert(seen[1].sleep_in_bed, 'the bed is on offer beside it');
});

test('hungry at night, food is offered with the dark said, and staying up names the mobs out of sight (the decision audit)', async () => {
  const { Survival } = require('../src/survival');
  let tree;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, time: { timeOfDay: 14000, age: 100000 },
    entities: { 50: { id: 50, name: 'creeper', position: new Vec3(12.5, 64, 0.5), height: 1.7, isValid: true } },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 14, food: 6, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null, pathfinder: { movements: {}, setGoal() {} },
    blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }), findBlocks: () => [], chat() {},
    // Behind a hill: nothing is in sight.
    world: { raycast: from => ({ position: from.floored(), intersect: from }) } });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => ({}) } });
  survival.decide = async (task, goal, save, q) => { tree = q.tree; return { path: ['secure_shelter'], action: { run: async () => {} }, stale: false }; };
  await survival.step(new Task('t', 'night'), { kind: 'win', request: 'beat the game' }, () => {});
  assert.match(tree.obtain_food.description, /Night: mobs spawn on the way; hunger 6, starvation at 0/);
  assert.match(tree.continue_request.description, /1 hostile mob, 1 of them out of sight, creepers among them/);
  assert.match(tree.continue_request.description, /Health does not come back meanwhile: hunger 6/);
});

test('with no shelter site that can be walked to, the night is sealed in where the bot stands', async () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 47, 0.5) },
    inventory: { items: () => [{ name: 'cobblestone', count: 64 }] }, blockAt: p => ({ name: p.y < 47 ? 'stone' : 'air', boundingBox: p.y < 47 ? 'block' : 'empty' }),
    pathfinder: { movements: {}, getPathTo: () => ({ status: 'timeout', path: [] }) } });
  const controller = new Survival(bot, {}, { state: { shelters: [] } });
  const sites = shelter.shelterSites;
  let sealed = 0;
  shelter.shelterSites = () => [new Vec3(9, 58, 9)];
  controller.sealHere = async () => { sealed++; return true; };
  try {
    await controller.refugeStep(new Task('dusk in a hollow'), {}, () => {});
    assert.equal(sealed, 1);
  } finally { shelter.shelterSites = sites; }
});

test('a night mine refused on every heading is boxed in and waits the night out instead of turning in place', () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 55, 0.5) }, inventory: { items: () => [] } });
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const mine = survival.state.nightMine = { heading: 0, failures: 0, mined: 3, target: { x: 24, y: 45, z: 0 }, targetOre: 'branch' };
  for (let i = 0; i < 3; i++) { mine.target = { x: 24, y: 45, z: i }; survival.abandonTarget(mine, 'No safe way toward it: lava or water in the way'); }
  assert(!(mine.boxedInUntil > Date.now()), 'three turns are not yet boxed in');
  mine.target = { x: 0, y: 45, z: 24 }; survival.abandonTarget(mine, 'No safe way toward it: lava or water in the way');
  assert(mine.boxedInUntil > Date.now(), 'all four headings refused within a minute');
});


test('four unreachable ores of one vein are set aside, not a mine boxed in', () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 16, 0.5) }, inventory: { items: () => [] } });
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const mine = survival.state.nightMine = { heading: 0, failures: 0, mined: 105, targetOre: 'copper_ore' };
  for (let i = 0; i < 4; i++) { mine.target = { x: -550 - i, y: 16, z: -363 }; mine.targetOre = 'copper_ore'; survival.abandonTarget(mine, 'No safe way toward it: no floor, moss block in the way'); }
  assert(!(mine.boxedInUntil > Date.now()), 'the vein by the lush cave is set aside; the mine goes on by a branch');
  assert.equal(mine.heading, 0, 'and the heading is kept for the branch');
});

test('mining steps that keep the pocket sealed are not dig-outs: the night mine is not set aside after three', async () => {
  const { isSetAside } = require('../src/progress');
  const origin = new Vec3(0, 30, 0), blocks = new Map();
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 20,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 16000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'air' : 'stone'), boundingBox: blocks.get(`${p}`) === 'air' || p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'empty' : 'block', position: p }),
    world: { raycast: () => null } });
  const refuge = { origin: { ...origin }, dimension: 'overworld' };
  const survival = new Survival(bot, {}, { state: { shelters: [refuge] } });
  assert(shelter.sealed(bot, refuge), 'the fixture pocket is sealed');
  let steps = 0;
  survival.nightMine = async () => { steps++; return true; }; // mines downward: the pocket stays shut
  for (let i = 0; i < 4; i++) { try { await survival.step(new Task('night'), { kind: 'win' }, () => {}); } catch (_) { /* other branches */ } }
  assert(steps >= 3, `the mine ran (${steps})`);
  assert(!isSetAside(survival, 'night_mine', `${origin.x},${origin.y},${origin.z}`), 'not counted as dig-outs');
});

test('sealed in at night, what next is Jev\'s (stay, leave, mine), and the choice holds', async () => {
  const origin = new Vec3(0, 30, 0);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 16000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'air' : 'stone', boundingBox: p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'empty' : 'block', position: p }),
    world: { raycast: () => null } });
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld' }] }, client: { systemOne: async () => ({}) } });
  const asked = [], waits = [];
  survival.decide = async (task, goal, save, { id, tree }) => { asked.push([id, Object.keys(tree).sort()]); return { path: ['stay'], stale: false }; };
  survival.wait = async () => { waits.push(1); };
  survival.nightMine = async () => assert.fail('Jev chose to stay');
  await survival.step(new Task('night'), { kind: 'win' }, () => {});
  await survival.step(new Task('night'), { kind: 'win' }, () => {});
  assert.deepEqual(asked, [['pocket_next', ['leave', 'night_mine', 'stay']]]);
  assert.equal(waits.length, 2, 'the stay held for the next step without a second question');
});

test('sealed in, the mobs the wall hides are named in the choice to leave', async () => {
  // mid-110-e: opened its pocket for the bed with a creeper ten blocks off it had not been told of, and was blown up.
  const origin = new Vec3(0, 30, 0);
  const creeper = { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(10.5, 30, 0.5), height: 1.7, width: 0.6, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: { 7: creeper }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 16000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'air' : 'stone', boundingBox: p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'empty' : 'block', position: p }),
    world: { raycast: (from) => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld' }] }, client: { systemOne: async () => ({}) } });
  let leave;
  survival.decide = async (task, goal, save, { id, tree }) => { if (id === 'pocket_next') leave = tree.leave?.description; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('night'), { kind: 'win' }, () => {});
  assert.match(leave || '', /past a creeper 10 blocks off \(heard, not seen: the wall is between\)/);
  // mid-83-i: the fight's figure left the creepers out, and said so nowhere.
  assert.match(leave || '', /the creeper not counted in it: each that reaches the bot goes off for about [\d.]+ health/);
});

test('with the night planned for a shelter, a bed in sight does not keep the night mine shut', () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 20,
    time: { timeOfDay: 16000 }, entity: { position: new Vec3(0.5, 30, 0.5) },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'white_bed', count: 1 }], slots: [] },
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }), world: { raycast: () => null } });
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  assert.equal(survival.canNightMine({}), false, 'a bed carried and no plan yet: the night is for sleep');
  survival.state.nightPlan = { plan: 'shelter', until: Date.now() + 60000 };
  assert.equal(survival.canNightMine({}), true, 'the plan is a shelter: mine');
});

test('in lava with no dry cell in sight the bot swims up and back toward its last dry footing, and never stands', { timeout: 6000 }, async () => {
  const held = new Set(); let looked = null;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 15, food: 20,
    entity: { position: new Vec3(.5, 27, .5), onGround: false }, entities: {}, inventory: { items: () => [], slots: {} },
    blockAt: p => ({ position: p, name: p.y <= 31 ? 'lava' : 'air', boundingBox: 'empty' }),
    setControlState: (key, on) => { if (on) held.add(key); }, getControlState: () => false, lookAt: async p => { looked = p; } });
  const survival = new Survival(bot, {}, { state: { shelters: [], lastDry: { x: -30, y: 42, z: -60 } } });
  const goal = {};
  const started = Date.now();
  assert(await survival.step(new Task('lava'), goal, () => {}));
  assert.equal(goal.survivalAction.action, 'leave_lava'); assert.equal(goal.survivalAction.to, null);
  assert(held.has('jump') && held.has('forward'), 'swimming, not standing');
  assert(looked && looked.x < -29 && looked.z < -59, 'toward the last dry footing');
  assert(Date.now() - started >= 2000, 'the step held the keys, it did not return at once');
});

test('with a creeper close the bot gets away from it instead of starting a pocket', async () => {
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0, 64, 0) }, health: 20, pathfinder: { movements: {} }, clearControlStates() {}, inventory: { items: () => [{ name: 'cobblestone', count: 64 }], slots: {} } });
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const calls = [];
  survival.runAway = async (task, goal, save, danger, options) => { calls.push({ names: danger.map(t => t.entity.name), options }); return calls.length > 1; };
  survival.sealHere = async () => assert.fail('no pocket with a creeper at four blocks');
  survival.report = () => {};
  const t = (name, distance) => ({ entity: { name, position: new Vec3(distance, 64, 0) }, distance, visible: true });
  await survival.escape(new Task('crowd'), {}, () => {}, [t('creeper', 4), t('skeleton', 6), t('zombie', 7)], true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].names, ['creeper'], 'the second run is from the creepers alone');
  assert.equal(calls[1].options.only, true);
});

// A ledge: floor at y 63 for x up to 5, then a drop to a lava sea.
function ledgeWorld({ wallAt = null } = {}) {
  return p => {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (wallAt !== null && x === wallAt && y >= 64 && y <= 65) return { position: p, name: 'netherrack', boundingBox: 'block' };
    if (y === 63 && x <= 5) return { position: p, name: 'netherrack', boundingBox: 'block' };
    if (y < 63 && x <= 5) return { position: p, name: 'netherrack', boundingBox: 'block' };
    if (y <= 55) return { position: p, name: 'lava', boundingBox: 'empty' };
    return { position: p, name: 'air', boundingBox: 'empty' };
  };
}

test('a drop within reach of a hoglin\'s toss counts, along a clear line only', () => {
  const { dropWithin, besideDrop } = require('../src/terrain');
  const bot = { blockAt: ledgeWorld() };
  const feet = new Vec3(3, 64, 0);
  assert.equal(besideDrop(bot, feet), false, 'the next cell is floor');
  assert.equal(dropWithin(bot, feet, 3), true, 'the edge three blocks off is the edge for a hoglin');
  assert.equal(dropWithin(bot, new Vec3(1, 64, 0), 3), false, 'five blocks back is clear');
  assert.equal(dropWithin({ blockAt: ledgeWorld({ wallAt: 4 }) }, feet, 3), false, 'a wall between stops the flight');
});

test('with a hoglin about, the bot steps back from an edge three blocks off, to ground three blocks from any drop', async () => {
  const moved = [];
  const hoglin = { id: 3, name: 'hoglin', position: new Vec3(-6, 64, 0.5), height: 1.4, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20,
    entity: { position: new Vec3(3.5, 64, 0.5), onGround: true }, entities: { 3: hoglin }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'diamond_sword' }], slots: {} }, world: { raycast: () => null }, blockAt: ledgeWorld(),
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {} });
  const survival = new Survival(bot, { navigate: async (b, t, g) => { moved.push({ x: g.x, y: g.y, z: g.z }); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('ledge'), goal, () => {});
  assert.equal(goal.survivalAction.action, 'off_the_edge');
  assert.equal(moved.length, 1);
  assert(moved[0].x <= 2, `to x ${moved[0].x}: three blocks from the drop at x 6`);
});

test('a pickaxe about to break is replaced from the pockets inside the night mine, and none at all is made if it can be', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  let items = [{ name: 'iron_pickaxe', count: 1, durabilityUsed: 240 }, { name: 'iron_ingot', count: 17 }, { name: 'stick', count: 4 }, { name: 'crafting_table', count: 1 }, { name: 'cobblestone', count: 63 }];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 15000 },
    entity: { position: new Vec3(0.5, 24, 0.5) }, health: 20, food: 20, registry, inventory: { items: () => items, slots: {}, emptySlotCount: () => 5 },
    findBlocks: () => [], blockAt: p => ({ name: 'stone', boundingBox: 'block', position: p }), world: { raycast: () => null } });
  const made = [];
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {}, acquireStep: async (b, t, item, count) => { made.push([item, count]); } });
  survival.report = () => {};
  assert.equal(await survival.nightMine(new Task('night', 'mine'), { kind: 'win' }, () => {}), true);
  assert.deepEqual(made, [['iron_pickaxe', 2]], 'ten uses left, seventeen ingots carried: a new iron pickaxe before the next step');
  items = items.filter(i => !/pickaxe|ingot/.test(i.name));
  assert(survival.canNightMine({ kind: 'win' }), 'no pickaxe, but stone and sticks and a table: the night is still mined');
  await survival.nightMine(new Task('night', 'mine'), { kind: 'win' }, () => {});
  assert.deepEqual(made.at(-1), ['stone_pickaxe', 1]);
  items = items.filter(i => i.name !== 'cobblestone');
  assert.equal(survival.canNightMine({ kind: 'win' }), false, 'nothing to dig with and nothing to make one from');
});

test('night-mine steps that do not move the bot are given up after four, before they wear the pickaxe out', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const ore = new Vec3(8, 55, 0);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 15000 },
    entity: { position: new Vec3(0.5, 55, 0.5) }, health: 20, food: 20, registry, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }], slots: {} },
    findBlocks: () => [ore], blockAt: p => ({ name: p.equals(ore) ? 'iron_ore' : p.y < 55 || p.y >= 60 ? 'stone' : 'air', boundingBox: p.y < 55 || p.y >= 60 || p.equals(ore) ? 'block' : 'empty', position: p }),
    world: { raycast: () => null }, pathfinder: { movements: {} } });
  // Every step "succeeds" and the server puts the bot back where it was.
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {} });
  survival.report = () => {};
  let n = 0;
  for (; n < 12 && !survival.state.nightMine?.lastAbandoned; n++) await survival.nightMine(new Task('night', 'mine'), { kind: 'win' }, () => {});
  assert.equal(survival.state.nightMine.lastAbandoned?.why, 'four steps without moving');
  assert(n <= 5, `given up after ${n} steps, not twelve`);
  const { position } = survival.state.nightMine.lastAbandoned.target ? { position: survival.state.nightMine.lastAbandoned.target } : {};
  if (survival.state.nightMine.lastAbandoned.target && survival.state.nightMine.targetOre !== 'branch') {
    assert(require('../src/progress').attemptsFor(survival).resting('night_mine', position), 'the ore rests, so it is not offered straight back');
  }
});

test('no shelter site and no blocks, but a pickaxe: the night is dug into the ground, not failed every eight seconds', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 13000 },
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true }, health: 20, food: 20, registry,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'netherrack', count: 1 }], slots: {}, emptySlotCount: () => 5 },
    findBlocks: () => [], blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }),
    world: { raycast: () => null }, pathfinder: { movements: {}, getPathTo: () => ({ status: 'noPath', path: [] }), setGoal() {} } });
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  let mined = 0;
  survival.nightMine = async () => { mined++; return true; };
  survival.shaftPocket = async () => false; // no rock straight down here
  await survival.refugeStep(new Task('dusk'), { kind: 'win' }, () => {});
  assert.equal(mined, 1, 'the mine began where the bot stands');
  assert(survival.state.nightMine?.origin, 'and it is the night mine the next step continues');
});

// A sand island: sand to y 59 over sandstone and stone, the sea all round
// above y 60 beyond the island's edge.
function sandIsland() {
  return p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    const island = Math.abs(x) <= 3 && Math.abs(z) <= 3;
    let name;
    if (y >= 63) name = 'air';
    else if (y >= 60) name = island ? 'sand' : (y === 62 || y >= 60 ? 'water' : 'sand');
    else if (y >= 57) name = 'sandstone';
    else name = 'stone';
    return { position: new Vec3(x, y, z), name, boundingBox: /air|water/.test(name) ? 'empty' : 'block', diggable: true };
  };
}

test('on a sand island at dusk with one block and a pickaxe, the bot digs straight down into rock and caps the shaft', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const dug = new Set(), placed = new Map();
  const world = sandIsland();
  const blockAt = p => { const k = `${p.floored()}`; if (placed.has(k)) return { position: p.floored(), name: placed.get(k), boundingBox: 'block' }; if (dug.has(k)) return { position: p.floored(), name: 'air', boundingBox: 'empty' }; return world(p); };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 13000 },
    // On the island's edge: the sea is beside the first block down here.
    entity: { position: new Vec3(3.5, 63, 0.5), onGround: true }, health: 20, food: 20, registry,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'netherrack', count: 1 }], slots: {}, emptySlotCount: () => 5 },
    findBlocks: () => [], blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, getPathTo: () => ({ status: 'noPath', path: [] }), setGoal() {} } });
  const actions = { navigate: async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
    dig: async (b, t, p) => { dug.add(`${p.floored()}`); bot.entity.position = new Vec3(p.x + 0.5, p.y, p.z + 0.5); },
    place: async (b, t, p, name) => { placed.set(`${p.floored()}`, name); } };
  const survival = new Survival(bot, actions, { state: { shelters: [] } });
  survival.nightMine = async () => assert.fail('the shaft comes first');
  await survival.refugeStep(new Task('dusk'), { kind: 'win' }, () => {});
  const refuge = survival.state.shelters.at(-1);
  assert(refuge?.shaft, 'a shaft pocket was made');
  assert(refuge.origin.y <= 57, `down into the sandstone (feet at ${refuge.origin.y})`);
  assert(Math.abs(refuge.origin.x) <= 2, 'from a column in from the edge');
  assert.equal(placed.get(`${new Vec3(refuge.origin.x, refuge.origin.y + 2, refuge.origin.z)}`), 'netherrack', 'capped with the netherrack');
  assert(refuge.verifiedAt, 'and it counts as a sealed shelter');
});

test('short of blocks for the room on open grass, the bot digs a shaft pocket instead of gathering dirt a block at a time', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const dug = new Set(), placed = new Map();
  const ground = p => { const y = Math.floor(p.y); return y >= 63 ? 'air' : y === 62 ? 'grass_block' : y >= 58 ? 'dirt' : 'stone'; };
  const blockAt = p => { const f = p.floored(), k = `${f}`; const name = placed.get(k) || (dug.has(k) ? 'air' : ground(f)); return { position: f, name, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true }; };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 13000 },
    entity: { position: new Vec3(0.5, 63, 0.5), onGround: true }, health: 20, food: 20, registry,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'dirt', count: 11 }], slots: {}, emptySlotCount: () => 5 },
    findBlocks: () => [], blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} } });
  const actions = { navigate: async () => {},
    dig: async (b, t, p) => { dug.add(`${p.floored()}`); bot.entity.position = new Vec3(p.x + 0.5, p.y, p.z + 0.5); },
    place: async (b, t, p, name) => { placed.set(`${p.floored()}`, name); },
    acquireStep: async () => assert.fail('no dirt gathering: the shaft costs one block') };
  // The room already planned beside the bot, twenty-eight blocks short of eleven.
  const survival = new Survival(bot, actions, { state: { shelters: [{ origin: { x: 3, y: 63, z: 0 }, dimension: 'overworld', createdAt: new Date().toISOString() }] } });
  await survival.refugeStep(new Task('dusk'), { kind: 'win' }, () => {});
  const shaft = survival.state.shelters.find(s => s.shaft);
  assert(shaft?.verifiedAt, 'a sealed shaft pocket');
  assert.equal(shaft.origin.y, 60, 'three down, walled in dirt with grass over the rim');
  assert.equal(placed.get(`${new Vec3(0, 62, 0)}`), 'dirt', 'capped with a block of dirt');
});

test('a zombie at arm\'s length comes before the bed: it is fought, not slept beside', async () => {
  const swung = [];
  const zombie = { id: 3, name: 'zombie', type: 'hostile', position: new Vec3(1.8, 64, 0.5), height: 1.95, width: 0.6, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, entities: { 3: zombie }, registry: require('minecraft-data')('26.1'), time: { timeOfDay: 13000 },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'white_bed', count: 1 }], slots: {} }, heldItem: null,
    blockAt: p => ({ position: p, name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }), world: { raycast: () => null },
    equip: async item => { bot.heldItem = item; }, unequip: async () => {}, lookAt: async () => {}, attack: e => swung.push(e.name),
    pathfinder: { setGoal() {}, movements: {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {}, findBlocks: () => [], chat() {} });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const goal = {};
  assert(await survival.step(new Task('night'), goal, () => {}));
  assert.deepEqual(swung, ['zombie'], `struck, not slept beside (${goal.survivalAction?.action})`);
});

test('with a creeper close or a mob at arm\'s length, building is still offered, with what it costs; the creeper dance is offered', () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, health: 3.2, food: 10, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5) }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'diamond_sword' }, { name: 'cobblestone', count: 64 }], slots: {} },
    blockAt: p => ({ position: p, name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }), world: { raycast: () => null }, findBlocks: () => [] });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const t = (name, distance) => ({ entity: { name, position: new Vec3(distance, 64, 0), height: 1.7 }, distance, visible: true });
  // At 3.2 health too: health is in the state for Jev to weigh, not a
  // reason to hide a stance.
  const withCreeper = survival.stanceOptions(new Task('x'), {}, () => {}, [t('creeper', 4)], false);
  assert(withCreeper.creeper_dance && withCreeper.fight && withCreeper.retreat, Object.keys(withCreeper).join(','));
  assert.match(withCreeper.seal.description, /creeper is 4 blocks off/);
  assert.match(withCreeper.pillar.description, /goes off/);
  // Trial 118: two creepers and a spider, no armour, twelve health, told only the fight's "6.7 damage".
  assert.match(withCreeper.fight.description, /Not counted there: the creeper, whose blast at arm's length takes up to 22 health after the armour worn, more than the bot has/);
  assert.match(withCreeper.creeper_dance.description, /up to twenty-two health without armour/);
  assert.match(withCreeper.retreat.description, /No route is checked yet/);
  const withZombie = Object.keys(survival.stanceOptions(new Task('x'), {}, () => {}, [t('zombie', 4)], false));
  assert(withZombie.includes('pillar'), 'a zombie is climbed away from');
  // At arm's length building is still Jev's to choose; the description says
  // what it costs, the options are not hidden.
  const atArmsLength = survival.stanceOptions(new Task('x'), {}, () => {}, [t('zombie', 2), t('zombie', 2.8)], false);
  assert(atArmsLength.pillar, Object.keys(atArmsLength).join(','));
  assert.match(JSON.stringify(atArmsLength.pillar.description), /arm's length/);
  assert(atArmsLength.retreat);
});

test('from a pocket on the surface the night mine goes down into solid ground, not sideways to an ore through the hillside', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const ore = new Vec3(6, 58, -5);
  // A hillside: solid to the east (+x), open air to the west, sky above.
  const blockAt = p => { const f = p.floored(); const solid = f.y < 64 || (f.x >= 1 && f.y < 66); return { position: f, name: f.equals(ore) ? 'copper_ore' : solid ? 'stone' : 'air', boundingBox: solid || f.equals(ore) ? 'block' : 'empty' }; };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 15000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, registry, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }], slots: {} },
    findBlocks: () => [ore], blockAt, world: { raycast: () => null } });
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {} });
  const reports = []; survival.report = (g, sv, a) => reports.push(a);
  survival.shaftPocket = async () => false; // no rock straight down here: the heading rule
  survival.state.nightMine = { heading: 2, failures: 0, mined: 0 };
  await survival.nightMine(new Task('night'), { kind: 'win' }, () => {});
  assert.equal(reports[0].ore, 'branch', 'no side ore from the surface');
  assert(reports[0].target.x > 0, `into the hill (+x), not out to the open west: ${JSON.stringify(reports[0].target)}`);
});

test('one skeleton at the wall of the pocket, the bot armed and whole: the wall toward it is opened for the fight', async () => {
  const { Survival } = require('../src/survival');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, health: 20, entities: { 7: { id: 7, name: 'skeleton', position: new Vec3(3.9, 64, 0.5), height: 1.99, isValid: true } },
    time: { timeOfDay: 15000 }, entity: { position: new Vec3(0.5, 64, 0.5) }, world: { raycast: () => null },
    inventory: { items: () => [{ name: 'diamond_sword', count: 1 }], slots: {} },
    blockAt: p => ({ position: p.floored(), name: 'stone', boundingBox: 'block', diggable: true }) });
  const dug = [];
  const survival = new Survival(bot, { dig: async (b, t, p) => dug.push(`${p}`) }, { state: { shelters: [] } });
  survival.report = () => {};
  const watcher = { entity: bot.entities[7], distance: 3.4, visible: false };
  assert(await survival.openOnWatcher(new Task('pocket'), {}, () => {}, {}, watcher));
  assert.deepEqual(dug.sort(), [`${new Vec3(1, 64, 0)}`, `${new Vec3(1, 65, 0)}`].sort(), 'the two cells toward it');
  bot.health = 10;
  assert.equal(await survival.openOnWatcher(new Task('pocket'), {}, () => {}, {}, watcher), false, 'hurt, the wall stays');
});

test('a night mine from a surface pocket first sinks the pocket into the rock', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 15000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, registry, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }], slots: {} },
    findBlocks: () => [], blockAt: p => ({ position: p.floored(), name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }), world: { raycast: () => null } });
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {} });
  let sunk = 0; survival.shaftPocket = async () => { sunk++; return true; };
  survival.state.nightMine = { heading: 0, failures: 0, mined: 0 };
  assert.equal(await survival.nightMine(new Task('night'), { kind: 'win' }, () => {}), true);
  assert.equal(sunk, 1);
  assert(survival.state.nightMine.sunkAt, 'once a night mine');
});

test('a hoglin close on a ledge: the bot seals itself in rather than fight, pillar or walk the edge', async () => {
  const placed = [];
  const hoglin = { id: 3, name: 'hoglin', position: new Vec3(-1.5, 64, 0.5), height: 1.4, isValid: true };
  const world = ledgeWorld();
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 18, food: 20,
    entity: { position: new Vec3(3.5, 64, 0.5), onGround: true }, entities: { 3: hoglin }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'diamond_sword' }, { name: 'netherrack', count: 16 }], slots: {} }, world: { raycast: () => null },
    blockAt: p => { const k = `${p.floored()}`; return placed.includes(k) ? { position: p.floored(), name: 'netherrack', boundingBox: 'block' } : world(p); },
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {} });
  const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p.floored()}`); }, navigate: async () => {} }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('ledge'), goal, () => {});
  assert(placed.length >= 4, `a pocket went up (${placed.length} blocks)`);
  assert.notEqual(goal.survivalAction?.action, 'pillar_from');
});

test('a shelter site with dry rock below is chosen over a nearer one beside a flooded cave', () => {
  const shelter = require('../src/shelter');
  const registry = require('minecraft-data')('26.1');
  const name = p => p.y >= 64 ? 'air' : (p.x >= -1 && p.x <= 2 && p.z >= -1 && p.z <= 2 && p.y >= 57 && p.y <= 60) ? 'water' : p.y === 63 ? 'grass_block' : 'stone';
  const bot = { registry, game: { dimension: 'overworld', minY: -64, height: 384 }, entity: { position: new Vec3(0.5, 64, 0.5) },
    blockAt: p => { const f = p.floored(); const n = name(f); return { position: f, name: n, boundingBox: /air|water/.test(n) ? 'empty' : 'block', type: registry.blocksByName[n]?.id }; },
    findBlocks: () => [new Vec3(9, 63, 0)] };
  const sites = shelter.shelterSites(bot, {});
  assert(sites.length >= 2, `both sites are safe (${sites.length})`);
  assert.deepEqual([sites[0].x, sites[0].z], [9, 0], 'the dry one first, though it is further');
  assert(shelter.wetBelow(bot, new Vec3(0, 64, 0)) > 0 && shelter.wetBelow(bot, new Vec3(9, 64, 0)) === 0);
});

// The live pocket on a sand bar at sea: walls and roof of cobblestone, and
// sand in four cells of the ring under them.
function sandFloorPocket() {
  const origin = new Vec3(0, 64, 0), blocks = new Map();
  for (const p of shelter.shell(origin)) blocks.set(`${p}`, 'cobblestone');
  for (const [x, z] of [[1, -1], [-1, 0], [-1, 1], [0, 1]]) blocks.set(`${origin.offset(x, -1, z)}`, 'sand');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: origin.offset(0.5, 0, 0.5) }, entities: {},
    inventory: { items: () => [{ name: 'cobblestone', count: 160 }] },
    blockAt: p => { const name = blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'); return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block' }; } });
  return { origin, blocks, bot, refuge: { origin, dimension: 'overworld' } };
}

test('sand resting under the shell is floor, not a missing cell; sand in a wall still is', () => {
  const { origin, blocks, bot, refuge } = sandFloorPocket();
  assert.deepEqual(shelter.missingShell(bot, refuge), []);
  assert.equal(shelter.sealed(bot, refuge), true);
  blocks.set(`${origin.offset(1, 0, 0)}`, 'sand');
  assert.equal(shelter.missingShell(bot, refuge).length, 1);
});

test('a seal that closes nothing says so, and the spot is not sealed again at once', async () => {
  const { origin, blocks, bot } = sandFloorPocket();
  blocks.set(`${origin.offset(1, 0, 0)}`, 'sand');
  let placed = 0;
  const survival = new Survival(bot, { place: async () => { placed++; throw new Error('the cell is full'); }, navigate: async () => {} });
  const goal = {};
  assert.equal(await survival.sealHere(new Task('night'), goal, () => {}, []), false);
  assert.equal(placed, 1);
  assert.equal(await survival.sealHere(new Task('night'), goal, () => {}, []), false);
  assert.equal(placed, 1, 'set aside: not tried again straight away');
});

test('sealing beside a drop places with stay, so the bot never steps off the ledge to do it', async () => {
  // A one-block ledge of netherrack at (0, 63, 0), open air all round and
  // down to lava: the dream run's first death without the restore.
  const origin = new Vec3(0, 64, 0);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether' }, entity: { position: origin.offset(0.5, 0, 0.5) }, entities: {},
    inventory: { items: () => [{ name: 'netherrack', count: 40 }] },
    blockAt: p => { const name = p.equals(new Vec3(0, 63, 0)) ? 'netherrack' : p.y < 30 ? 'lava' : 'air'; return { name, position: p, boundingBox: name === 'netherrack' ? 'block' : 'empty' }; } });
  const options = [];
  const survival = new Survival(bot, { place: async (b, t, p, m, opts) => { options.push(opts); throw new Error('no anchor'); }, navigate: async () => {} });
  await survival.sealHere(new Task('ledge'), {}, () => {}, []);
  assert(options.length > 0);
  assert(options.every(o => o?.stay === true), JSON.stringify(options.slice(0, 2)));
});

test('a stance that failed is not offered again against the same mobs for twenty seconds', async () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 20, food: 20,
    inventory: { items: () => [], slots: {} }, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {} });
  const ran = [], trees = [];
  survival.stanceOptions = () => ({ pillar: { description: 'up', run: async () => { ran.push('pillar'); return false; } },
    fight: { description: 'fight', run: async () => { ran.push('fight'); return true; } }, seal: { description: 'seal', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { trees.push(Object.keys(q.tree)); return { path: [q.tree.pillar ? 'pillar' : 'fight'] }; };
  const danger = [{ entity: { name: 'zombie' }, distance: 2 }];
  assert.equal(await survival.stanceStep(new Task('pack'), {}, () => {}, danger, false), true, 'knocked off the pillar: the tick is spent, the rules do not step in');
  assert.equal(await survival.stanceStep(new Task('pack'), {}, () => {}, danger, false), true);
  assert.deepEqual(ran, ['pillar', 'fight']);
  assert(!trees[1].includes('pillar'), `the failed pillar was not offered again: ${trees[1]}`);
});

test('a fight that failed for want of reach is offered again once the mob is at reach', async () => {
  // Trial 106: the charge could not climb the stairs to the zombie; it came down to one block, and the bot was offered no fight.
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 12, food: 20,
    inventory: { items: () => [], slots: {} }, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {} });
  const trees = [];
  survival.stanceOptions = () => ({ fight: { description: 'fight', run: async () => true }, pillar: { description: 'up', run: async () => true }, retreat: { description: 'away', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { trees.push(Object.keys(q.tree)); return { path: ['retreat'] }; };
  survival.state.stanceFailed = [{ choice: 'fight', kinds: 'zombie', at: Date.now() }];
  await survival.stanceStep(new Task('stairs'), {}, () => {}, [{ entity: { name: 'zombie' }, distance: 5 }], false);
  assert(!trees[0].includes('fight'), 'still out of reach: not again yet');
  delete survival.state.stance;
  await survival.stanceStep(new Task('stairs'), {}, () => {}, [{ entity: { name: 'zombie' }, distance: 1 }], false);
  assert(trees[1].includes('fight'), `at reach: the fight is back: ${trees[1]}`);
});

test('cornered with a wither skeleton at arm\'s length and blazes behind it, the bot fights instead of sealing', async () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 19,
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'netherrack', count: 40 }], slots: {} }, heldItem: { name: 'iron_sword' },
    pathfinder: { movements: {} }, clearControlStates() {}, setControlState() {}, deactivateItem() {},
    blockAt: p => ({ name: p.y < 64 ? 'nether_bricks' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => assert.fail('no block placed') });
  survival.runAway = async () => false;
  survival.sealHere = async () => assert.fail('no pocket sealed with a sword at arm\'s length');
  const danger = [{ entity: { name: 'wither_skeleton', position: new Vec3(2, 64, 0.5) }, distance: 1.5, visible: true },
    { entity: { name: 'blaze', position: new Vec3(8, 66, 0) }, distance: 8, visible: true }];
  const goal = {};
  await survival.escape(new Task('fortress'), goal, () => {}, danger, true);
  assert.equal(goal.survivalAction.action, 'fight');
  assert.equal(goal.survivalAction.cornered, true);
});

test('the walk to bed stops when the bot is hurt on the way, for the threat rules to take it', async () => {
  const { Survival } = require('../src/survival');
  const { layout } = require('../src/home-base');
  const home = { version: 1, dimension: 'overworld', origin: { x: 0, y: 63, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 63, z: 0 }, bed: { placedAt: 'now', claimedAt: 'now' }, plot: {}, pen: {} };
  const { bed } = layout(home);
  const blocks = new Map([[`${new Vec3(bed.foot.x, bed.foot.y, bed.foot.z)}`, 'white_bed'], [`${new Vec3(bed.head.x, bed.head.y, bed.head.z)}`, 'white_bed']]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 12500 },
    entity: { position: new Vec3(30.5, 64, 0.5) }, health: 20, food: 20, isSleeping: false, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null, sleep: async () => assert.fail('no sleep'),
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'grass_block' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }) });
  const goal = { kind: 'win', survival: { home } };
  let walks = 0;
  // An arrow on the way: the walk's stopWhen sees the health drop.
  const survival = new Survival(bot, { navigate: async (b, t, g, opts) => { walks++; bot.health = 15; bot.entity.position = new Vec3(20.5, 64, 0.5); assert(opts.stopWhen(), 'the walk sees the hit'); } }, { state: goal.survival });
  await assert.rejects(survival.sleepStep(new Task('test', 'sleep'), goal, () => {}), /Trouble on the way to bed/);
  assert.equal(walks, 1);
  assert.equal(goal.survivalAction.action, 'sleep_interrupted');
});

test('mobs Jev leaves be are no threat to the work for fifteen seconds, unless one comes within three blocks or a hit lands', () => {
  const { immediateThreat } = require('../src/danger');
  const zombie = { id: 3, name: 'zombie', type: 'hostile', position: new Vec3(8.5, 64, .5), height: 1.95, width: .6, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { position: new Vec3(.5, 64, .5) },
    entities: { 3: zombie }, registry: require('minecraft-data')('26.1'), world: { raycast: () => null }, health: 20 });
  assert(immediateThreat(bot), 'a zombie at eight is a threat');
  bot._wavedOff = { ids: [3], until: Date.now() + 15000 };
  assert.equal(immediateThreat(bot), undefined, 'left be');
  zombie.position = new Vec3(3, 64, .5);
  assert(immediateThreat(bot), 'within three it is a threat again');
  zombie.position = new Vec3(8.5, 64, .5); bot._recentHurtAt = Date.now();
  assert(immediateThreat(bot), 'a hit ends it');
});

test('at dusk with the bed at home forty blocks off, the walk home is Jev\'s option; once chosen it is held, not asked again', async () => {
  const { Survival } = require('../src/survival');
  const { layout } = require('../src/home-base');
  const home = { version: 1, dimension: 'overworld', origin: { x: 0, y: 63, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 63, z: 0 }, bed: { placedAt: 'now', claimedAt: 'now' }, plot: {}, pen: {} };
  const { bed } = layout(home);
  const blocks = new Map([[`${new Vec3(bed.foot.x, bed.foot.y, bed.foot.z)}`, 'white_bed'], [`${new Vec3(bed.head.x, bed.head.y, bed.head.z)}`, 'white_bed']]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 10000 },
    entity: { position: new Vec3(40.5, 64, 0.5) }, health: 20, food: 20, oxygenLevel: 20, isSleeping: false, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null, findBlocks: () => [], world: { raycast: () => null }, chat() {},
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'grass_block' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }) });
  const goal = { kind: 'win', request: 'beat the game', survival: { home } };
  let walks = 0; const asked = [];
  const survival = new Survival(bot, { navigate: async () => { walks++; } }, { state: goal.survival, client: { systemOne: async () => ({}) } });
  let described;
  survival.decide = async (task, g, save, { tree }) => { described = tree.go_home_for_night.description; asked.push(Object.keys(tree).sort()); return { path: ['go_home_for_night'], action: tree.go_home_for_night, stale: false }; };
  await survival.step(new Task('dusk'), goal, () => {});
  assert(asked[0].includes('go_home_for_night') && asked[0].includes('continue_request') && asked[0].includes('secure_shelter'), asked[0].join(','));
  assert.match(described, /arriving about 10\d\d\d, before nightfall at 11500/, 'when the walk arrives (the decision audit)');
  assert.equal(walks, 1);
  await survival.step(new Task('dusk'), goal, () => {});
  assert.equal(asked.length, 1, 'held: the walk goes on without a second question');
  assert.equal(walks, 2);
});

test('the bed at home is offered with its walk and the monsters beside it that refuse sleep (the decision audit)', async () => {
  const { Survival } = require('../src/survival');
  const { layout } = require('../src/home-base');
  const home = { version: 1, dimension: 'overworld', origin: { x: 0, y: 63, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 63, z: 0 }, bed: { placedAt: 'now', claimedAt: 'now' }, plot: {}, pen: {} };
  const { bed } = layout(home);
  const blocks = new Map([[`${new Vec3(bed.foot.x, bed.foot.y, bed.foot.z)}`, 'white_bed'], [`${new Vec3(bed.head.x, bed.head.y, bed.head.z)}`, 'white_bed']]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, time: { timeOfDay: 13000 },
    entities: { 60: { id: 60, name: 'zombie', position: new Vec3(-5.5, 64, -3.5), height: 1.95, isValid: true } },
    entity: { position: new Vec3(5.5, 64, -2.5) }, health: 20, food: 20, oxygenLevel: 20, isSleeping: false, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null, findBlocks: () => [], world: { raycast: () => null }, chat() {},
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'grass_block' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }) });
  const goal = { kind: 'win', request: 'beat the game', survival: { home } };
  const survival = new Survival(bot, { navigate: async () => {} }, { state: goal.survival, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, g, save, q) => { tree ||= q.tree; return { path: ['secure_shelter'], action: { run: async () => {} }, stale: false }; };
  survival.sleepStep = async () => {};
  await survival.step(new Task('night'), goal, () => {});
  assert(tree?.sleep_in_bed, tree && Object.keys(tree).join(','));
  assert.match(tree.sleep_in_bed.description, /Walk to the bed 5 blocks away \(about 1 seconds\)/);
  assert.match(tree.sleep_in_bed.description, /1 monster is within eight blocks of the bed now: sleep is refused while any are/);
});

test('a walk home held past bedtime still walks: trial 94 held it thirty blocks off and did nothing twenty times a second', async () => {
  const { Survival } = require('../src/survival');
  const { layout } = require('../src/home-base');
  const home = { version: 1, dimension: 'overworld', origin: { x: 0, y: 63, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 63, z: 0 }, bed: { placedAt: 'now', claimedAt: 'now' }, plot: {}, pen: {} };
  const { bed } = layout(home);
  const blocks = new Map([[`${new Vec3(bed.foot.x, bed.foot.y, bed.foot.z)}`, 'white_bed'], [`${new Vec3(bed.head.x, bed.head.y, bed.head.z)}`, 'white_bed']]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 13000 },
    entity: { position: new Vec3(30.5, 64, 0.5) }, health: 20, food: 20, oxygenLevel: 20, isSleeping: false, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null, findBlocks: () => [], world: { raycast: () => null }, chat() {},
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'grass_block' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }) });
  const goal = { kind: 'win', request: 'beat the game', survival: { home } };
  let walks = 0;
  const survival = new Survival(bot, { navigate: async () => { walks++; } }, { state: goal.survival, client: { systemOne: async () => ({}) } });
  survival.state.nightPlan = { plan: 'home', until: Date.now() + 120000 };
  survival.decide = async () => assert.fail('held, not asked');
  await survival.step(new Task('night'), goal, () => {});
  assert.equal(walks, 1, 'the held walk home walks after bedtime too');
});

test('respawned with nothing at night, the bot digs down into dirt by hand and caps it with the dirt', async () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const dug = new Set(), placed = new Map(), items = [];
  const nameAt = y => y >= 63 ? 'air' : y >= 58 ? 'dirt' : 'stone';
  const blockAt = p => {
    const f = p.floored(), k = `${f}`;
    const name = placed.get(k) || (dug.has(k) ? 'air' : nameAt(f.y));
    const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f; return b;
  };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {}, registry, entity: { position: new Vec3(0.5, 63, 0.5), onGround: true },
    health: 20, inventory: { items: () => items, slots: {} }, blockAt });
  const actions = { navigate: async () => {},
    dig: async (b, t, p) => { dug.add(`${p.floored()}`); bot.entity.position = new Vec3(p.x + 0.5, p.y, p.z + 0.5); const d = items.find(i => i.name === 'dirt'); if (d) d.count++; else items.push({ name: 'dirt', count: 1 }); },
    place: async (b, t, p, name) => { placed.set(`${p.floored()}`, name); } };
  const survival = new Survival(bot, actions, { state: { shelters: [] } });
  assert.equal(await survival.shaftPocket(new Task('night'), {}, () => {}), true);
  assert(dug.has('(0, 62, 0)') && dug.has('(0, 61, 0)'), [...dug].join(' '));
  assert.equal(placed.get('(0, 62, 0)'), 'dirt', 'capped with the dug dirt');
  // Bare hands on stone: no shaft.
  const stone = new Survival(Object.assign(new EventEmitter(), { ...bot, blockAt: p => { const b = Block.fromStateId(registry.blocksByName[p.y >= 63 ? 'air' : 'stone'].defaultState); b.position = p.floored(); return b; },
    entity: { position: new Vec3(0.5, 63, 0.5) }, inventory: { items: () => [], slots: {} } }), actions, { state: { shelters: [] } });
  assert.equal(await stone.shaftPocket(new Task('night'), {}, () => {}), false);
});

test('no charge up or down a fortress, or from an edge; a charge walks without digging or towering', async () => {
  const blocks = new Map();
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 65, 0.5) }, entities: {}, health: 20,
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, pathfinder: { movements: { canDig: true, allow1by1towers: true, maxDropDown: 4 } },
    blockAt: p => { const f = p.floored(); const name = blocks.get(`${f}`) || (f.y < 65 ? 'nether_bricks' : 'air'); return { name, position: f, boundingBox: name === 'air' ? 'empty' : 'block' }; } });
  const seen = [];
  const survival = new Survival(bot, { navigate: async () => { seen.push({ ...bot.pathfinder.movements }); } });
  survival.report = () => {};
  const skeleton = y => ({ entity: { name: 'wither_skeleton', position: new Vec3(6.5, y, 0.5), height: 2.4 }, distance: 6 });
  assert.equal(await survival.charge(new Task('fortress'), {}, () => {}, skeleton(69), false), false, 'four blocks up: no charge');
  // An edge beside the bot: a bridge one block wide.
  for (let y = 30; y < 65; y++) blocks.set(`${new Vec3(0, y, 1)}`, 'air');
  assert.equal(await survival.charge(new Task('fortress'), {}, () => {}, skeleton(65), false), false, 'from an edge: no charge');
  blocks.clear();
  await survival.charge(new Task('fortress'), {}, () => {}, skeleton(65), false);
  assert.deepEqual(seen, [{ canDig: false, allow1by1towers: false, maxDropDown: 2 }]);
  assert.deepEqual(bot.pathfinder.movements, { canDig: true, allow1by1towers: true, maxDropDown: 4 }, 'restored');
});

test('cornered with a blaze at arm\'s length, the bot swings instead of walling', async () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 20,
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'netherrack', count: 40 }], slots: {} }, heldItem: { name: 'iron_sword' },
    pathfinder: { movements: {} }, clearControlStates() {}, setControlState() {}, deactivateItem() {},
    blockAt: p => ({ name: p.y < 64 ? 'nether_bricks' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => assert.fail('no wall') });
  survival.runAway = async () => false;
  survival.sealHere = async () => assert.fail('no pocket with a blaze in reach');
  const goal = {};
  await survival.escape(new Task('fortress'), goal, () => {}, [{ entity: { name: 'blaze', position: new Vec3(2.5, 65, 0.5) }, distance: 2.4, visible: true }], true);
  assert.equal(goal.survivalAction.action, 'fight');
});

test('hit by a blaze with none in sight, the nearest blaze is the one: seen, as the attacker', () => {
  const blaze = { name: 'blaze', type: 'hostile', position: new Vec3(10, 66, 0), height: 1.8 };
  const bot = { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 1: blaze },
    time: { timeOfDay: 6000 }, world: { raycast: () => ({ position: new Vec3(5, 65, 0), intersect: new Vec3(5, 65, 0.5) }) } };
  assert.equal(threats(bot)[0].visible, false, 'behind the fortress wall');
  bot._hurtBy = { blaze: Date.now() };
  const t = threats(bot)[0];
  assert.equal(t.visible, true); assert.equal(t.attributed, true);
  bot._hurtBy = { blaze: Date.now() - 10000 };
  assert.equal(threats(bot)[0].visible, false, 'an old hit names nobody');
});

test('how the night is sheltered is Jev\'s pick, run and held for the night without a second question', async () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 13000 }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'cobblestone', count: 20 }], slots: [] },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }), world: { raycast: () => null }, pathfinder: { movements: {} } });
  const controller = new Survival(bot, {}, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  const sites = shelter.shelterSites; shelter.shelterSites = () => [];
  const asked = [], ran = [];
  let seen;
  bot.entities[40] = { id: 40, name: 'zombie', position: new Vec3(6.5, 64, 0.5), height: 1.95, isValid: true };
  controller.decide = async (task, goal, save, { id, tree, state }) => { seen = { tree, state }; asked.push([id, Object.keys(tree).sort()]); return { path: ['shaft_pocket'], stale: false }; };
  controller.shaftPocket = async () => { ran.push('shaft'); return true; };
  controller.sealHere = async () => assert.fail('Jev chose the shaft');
  try {
    assert.equal(await controller.refugeStep(new Task('dusk'), {}, () => {}), true);
    assert.equal(await controller.refugeStep(new Task('dusk'), {}, () => {}), true);
  } finally { shelter.shelterSites = sites; }
  assert.equal(asked.length, 1); assert.equal(asked[0][0], 'shelter_method');
  assert(asked[0][1].includes('seal_here') && asked[0][1].includes('shaft_pocket'), asked[0][1].join(','));
  assert.deepEqual(ran, ['shaft', 'shaft'], 'held');
  // The decision audit: the shaft's column is looked for before it is
  // offered, the pocket's race is with every mob about, and the risk is in
  // the state.
  assert.match(seen.tree.shaft_pocket.description, /No dry column here: .*rock too hard to dig by hand.*; chosen, it fails/, 'no pickaxe, and stone underfoot');
  assert.match(seen.tree.seal_here.description, /the nearest zombie, 6 blocks off, can be at the bot in about 2 seconds/);
  assert(seen.state.riskNow && seen.state.deathWouldCost);
});

test('the night mine\'s next ore is Jev\'s pick of the nearest of each kind, copper included with its use said; without Jev, not copper', async () => {
  const registry = require('minecraft-data')('26.1');
  const ores = { '3,39,0': 'copper_ore', '6,39,0': 'iron_ore', '4,39,0': 'copper_ore', '8,39,0': 'lava' };
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 40, 0.5) },
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }], emptySlotCount: () => 10, slots: [] },
    findBlocks: ({ matching }) => Object.keys(ores).filter(k => matching.includes(registry.blocksByName[ores[k]].id)).map(k => new Vec3(...k.split(',').map(Number))),
    blockAt: p => ({ name: ores[`${p.x},${p.y},${p.z}`] || 'stone', boundingBox: 'block', position: p }) });
  const survival = new Survival(bot, {}, {});
  assert.equal((await survival.nightTarget(new Task('night'), {}, () => {}, new Vec3(0, 40, 0))).name, 'iron_ore', 'no Jev: the nearest the ladder uses');
  survival.client = { systemOne: async () => ({}) };
  let tree;
  survival.decide = async (task, goal, save, q) => { tree = q.tree; return { path: ['ore_0'], stale: false }; };
  const pick = await survival.nightTarget(new Task('night'), {}, () => {}, new Vec3(0, 40, 0));
  assert.equal(pick.name, 'copper_ore', 'Jev\'s pick stands');
  assert.equal(Object.keys(tree).length, 3, 'one of each kind, and the branch');
  assert.match(tree.ore_0.description, /nothing on the ladder wants it/);
  // The decision audit: where each ore lies, what is beside it, and where the branch goes.
  assert.match(tree.ore_0.description, /1 block down\./);
  assert.match(tree.ore_1.description, /Lava within two blocks of it/);
  assert.doesNotMatch(tree.ore_0.description, /Lava/);
  assert.match(tree.branch.description, /down to y 30, 10 blocks below here/);
});

test('in a dark tunnel with torches, lighting it is one of Jev\'s night-mine options, and a torch goes down when chosen', async () => {
  const registry = require('minecraft-data')('26.1');
  const placed = [];
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 20, 0.5) },
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'torch', count: 4 }], emptySlotCount: () => 10, slots: [] },
    findBlocks: () => [],
    // A tunnel: stone all round but a two-high corridor along x.
    blockAt: p => { const open = p.z === 0 && (p.y === 20 || p.y === 21) && Math.abs(p.x) <= 6; return { name: open ? 'air' : 'stone', boundingBox: open ? 'empty' : 'block', position: p, skyLight: 0 }; } });
  const survival = new Survival(bot, { place: async (b, t, p, m) => placed.push([`${p}`, m]) }, { client: { systemOne: async () => ({}) } });
  let offered;
  survival.decide = async (task, goal, save, q) => { offered = Object.keys(q.tree); return { path: ['light_tunnel'], stale: false }; };
  const result = await survival.nightTarget(new Task('night'), {}, () => {}, new Vec3(0, 20, 0));
  assert(offered.includes('light_tunnel') && offered.includes('branch'), offered.join(','));
  assert.deepEqual(result, { lit: true });
  assert.equal(placed.length, 1); assert.equal(placed[0][1], 'torch');
});

test('sealed in with the next item makeable from the pockets, working here is on offer and runs the ladder\'s step', async () => {
  const origin = new Vec3(0, 30, 0);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 16000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'raw_iron', count: 29 }, { name: 'coal', count: 30 }, { name: 'furnace', count: 1 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'air' : 'stone', boundingBox: p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'empty' : 'block', position: p }),
    world: { raycast: () => null } });
  const acquired = [];
  const survival = new Survival(bot, { acquireStep: async (b, t, item, count) => { acquired.push([item, count]); }, planFor: () => [] }, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld' }] }, client: { systemOne: async () => ({}) } });
  survival.benchWork = () => ({ item: 'iron_helmet', count: 1, plan: [{ action: 'smelt', item: 'iron_ingot', count: 5 }, { action: 'craft', item: 'iron_helmet', count: 1 }] });
  let offered;
  survival.decide = async (task, goal, save, { tree }) => { offered = tree; return { path: ['work_here'], stale: false }; };
  await survival.step(new Task('night'), { kind: 'win' }, () => {});
  assert.match(offered.work_here.description, /make the iron helmet here.*smelt 5 iron ingot, then craft 1 iron helmet/);
  assert.match(offered.work_here.description, /About 0.8 minutes of smelting \(5 at ten seconds each\)\. About 6 real minutes to dawn/);
  assert.deepEqual(acquired, [['iron_helmet', 1]]);
});

test('a night hunt is offered for each kind of mob about, with its drops, its cost and what a death would drop', () => {
  const registry = require('prismarine-registry')('26.1');
  const item = (name, count, slot) => ({ name, count, slot, type: registry.itemsByName[name].id });
  const items = [item('stone_sword', 1, 36), item('iron_ingot', 5, 10), item('dirt', 20, 11)];
  const slots = []; slots[6] = item('iron_chestplate', 1, 6);
  const mob = (id, name, x) => ({ id, name, position: new Vec3(x, 64, 0), height: 1.8, isValid: true });
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { position: new Vec3(0, 64, 0) }, entities: { 1: mob(1, 'spider', 10), 2: mob(2, 'spider', 14), 3: mob(3, 'zombie', 20), 4: mob(4, 'pig', 5), 5: mob(5, 'spider', 40) },
    health: 20, food: 20, experience: { level: 3 }, spawnPoint: new Vec3(0, 64, 100), time: { timeOfDay: 15000 },
    inventory: { items: () => items, slots }, world: { raycast: () => null }, blockAt: () => null });
  const survival = new Survival(bot, {});
  const options = survival.huntOptions({});
  assert.deepEqual(Object.keys(options).sort(), ['hunt_spider', 'hunt_zombie']);
  assert.match(options.hunt_spider.description, /spiders \(2 within thirty-two blocks, nearest 10\)/);
  assert.match(options.hunt_spider.description, /string.*white wool/);
  assert.match(options.hunt_spider.description, /stone sword and 1 piece of armour: about [\d.]+ seconds/);
  assert.match(options.hunt_spider.description, /iron chestplate, stone sword, 5 iron ingot\), 100 blocks from where the bot would respawn/);
  // The decision audit: what else is out there (mid-110-c's cave had a witch, skeletons and creepers).
  assert.match(options.hunt_spider.description, /Also within thirty-two blocks: 1 other hostile mob \(zombie\)/);
  const cost = survival.deathCost({});
  assert.deepEqual(cost.dropsValuables, { 'iron ingot': 5 });
  assert.equal(cost.respawnAt, 'the world spawn');
  assert.equal(cost.walkBackBlocks, 100);
  assert.equal(cost.levelsLost, 3);
  assert.equal(cost.otherStacks, 1);
  assert.equal(cost.realSecondsToWalkBack, 23);
  // The real minutes that went into what would drop, from the ladder's clocks.
  const made = survival.deathCost({ rungClocks: { iron_armour: { activeMs: 600000 }, shield: { activeMs: 240000 }, stone_pickaxe: { activeMs: 30000 } } });
  assert.deepEqual(made.realMinutesToMakeAgain, { 'iron armour': 10 });
});

test('a whole shell the bot is not sealed in is not reported sealed, and is not sealed again twenty times a second', async () => {
  // Trial 38: no cell of the shell missing, the pocket not sealed (a block
  // in the bot's own space), "sealed" returned every pass for 98 seconds.
  const { origin, blocks, bot } = sandFloorPocket();
  blocks.set(`${origin.offset(0, 1, 0)}`, 'cobweb');
  let placed = 0;
  const survival = new Survival(bot, { place: async () => { placed++; }, navigate: async () => {} });
  const goal = {};
  assert.deepEqual(shelter.missingShell(bot, { origin, dimension: 'overworld' }), []);
  assert.equal(await survival.sealHere(new Task('night'), goal, () => {}, []), false);
  assert.equal(await survival.sealHere(new Task('night'), goal, () => {}, []), false, 'set aside: not tried again straight away');
  assert.equal(placed, 0);
});

test('a seal pass whose placements keep failing ends after three, and says why', async () => {
  // Trial 53: fifty seconds in one pass, every block of the shell failing.
  const { origin, bot } = sandFloorPocket();
  const blocks = new Map();
  bot.blockAt = p => { const name = blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'); return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block' }; };
  let tries = 0;
  const survival = new Survival(bot, { place: async () => { tries++; throw new Error('Timed out waiting for world/inventory update'); }, navigate: async () => {} });
  const goal = {};
  assert.equal(await survival.sealHere(new Task('night'), goal, () => {}, []), false);
  assert.equal(tries, 3, 'three tries, not the whole shell');
  assert.match(survival.state.lastSealError, /Timed out/);
});

test('a survival action the stall supervisor set aside on the goal is refused when it is next reported; a hold is not', () => {
  // mid-92-c: return_to_surface and dig_in traded once a second; forty-four stalls raised, none refused.
  const { setAside } = require('../src/progress');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, entities: {} });
  const survival = new Survival(bot, {});
  const goal = {};
  setAside(goal, 'act', 'survival:return_to_surface', 'turning between return to surface and dig in', 600000);
  assert.throws(() => survival.report(goal, () => {}, { action: 'return_to_surface' }), { name: 'SetAside' });
  setAside(goal, 'act', 'survival:dig_in', 'x', 600000);
  survival.report(goal, () => {}, { action: 'dig_in' });
  assert.equal(goal.survivalAction.action, 'dig_in');
});

test('the pickaxe uses kept for the climb out grow with the rock over the head', () => {
  const { usesToClimbOut } = require('../src/survival');
  const at = (feetY, topY) => ({ entity: { position: new Vec3(0.5, feetY, 0.5) },
    blockAt: p => ({ position: p, boundingBox: p.y <= topY ? 'block' : 'empty', name: p.y <= topY ? 'stone' : 'air' }) });
  assert.equal(usesToClimbOut(at(60, 62)), 24, 'near the surface, the old floor of twenty-four');
  assert.equal(usesToClimbOut(at(24, 64)), 2 * 40 + 16, 'forty blocks down, two digs a block and a margin');
});

test('lava is found anywhere the body is, a thin flow at the edge of the box included, as the game counts it', () => {
  // mid-83-b: the edge of a flow beside the feet, missed by the one-cell check, burned it from 18 to 2.7 health.
  const { inLava } = require('../src/survival');
  const lavaAt = cell => ({ entity: { position: new Vec3(256.75, -23, -84.5), isInLava: false, width: 0.6, height: 1.8 },
    blockAt: p => ({ position: p, name: p.x === cell.x && p.y === cell.y && p.z === cell.z ? 'lava' : 'air' }) });
  assert.equal(inLava(lavaAt(new Vec3(257, -23, -85))), true, 'the neighbouring cell the box leans into');
  assert.equal(inLava(lavaAt(new Vec3(255, -23, -85))), false, 'a cell the body does not touch');
  assert.equal(inLava(lavaAt(new Vec3(256, -22, -85))), true, 'at the head');
});

test('a drop beside a stance is measured and said with what the fall costs at this health', () => {
  // mid-100-d: told only "a drop within three blocks", it fought a skeleton two blocks from a twenty-one-block shaft and fell from 18.6 to 0.6.
  const { dropNear, dropNote } = require('../src/terrain');
  const feet = new Vec3(0, 24, 0);
  const bot = { blockAt: p => ({ position: p, name: p.x === 2 && p.z === 0 && p.y > 2 ? 'air' : p.y >= 24 ? 'air' : 'stone', boundingBox: (p.x === 2 && p.z === 0 && p.y > 2) || p.y >= 24 ? 'empty' : 'block' }) };
  const drop = dropNear(bot, feet, 3);
  assert.deepEqual(drop, { blocksAway: 2, fallBlocks: 21, into: 'ground', damage: 18 });
  assert.match(dropNote(drop, 18.6), /A drop of 21 blocks is 2 blocks off: .* about 18 of the bot's 19 health/);
  assert.match(dropNote(drop, 10), /more than the 10 the bot has/);
  assert.equal(dropNote({ blocksAway: 1, fallBlocks: 3, into: 'ground', damage: 0 }, 20), '', 'a step down is not said');
});

test('with a skeleton close, a deadly drop two blocks off is the edge: the bot steps back to ground three blocks from it', async () => {
  // mid-100-d: a skeleton two blocks from a twenty-one-block shaft; its knockback and the fight put the bot down it.
  const world = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x >= 6 && y > 42) return { position: p, name: 'air', boundingBox: 'empty' };
    if (y <= 63) return { position: p, name: 'stone', boundingBox: 'block' };
    return { position: p, name: 'air', boundingBox: 'empty' };
  };
  const moved = [];
  const skeleton = { id: 4, name: 'skeleton', type: 'hostile', position: new Vec3(0.5, 64, 0.5), height: 1.99, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 18.6, food: 17,
    entity: { position: new Vec3(4.5, 64, 0.5), onGround: true }, entities: { 4: skeleton }, time: { timeOfDay: 14000 },
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, world: { raycast: () => null }, blockAt: world,
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {} });
  const { besideDrop } = require('../src/terrain');
  assert.equal(besideDrop(bot, new Vec3(4, 64, 0)), false, 'the next cell is floor: the old rule saw no edge');
  const survival = new Survival(bot, { navigate: async (b, t, g) => { moved.push({ x: g.x, y: g.y, z: g.z }); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('shaft'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'off_the_edge');
  assert(moved[0].x <= 2, `to x ${moved[0]?.x}: three blocks from the shaft at x 6`);
});

test('a creeper out of sight within four blocks is an immediate threat; farther off unseen, it is not', () => {
  // mid-79-b: recovering beside a creeper round a block's edge; the blast was the first it knew.
  const { immediateThreat } = require('../src/danger');
  const make = d => ({ entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 }, game: { dimension: 'overworld' }, health: 12, food: 18,
    entities: { 7: { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(0.5 + d, 64, 0.5), height: 1.7, isValid: true } },
    world: { raycast: () => ({ intersect: new Vec3(1, 65, 0.5), position: new Vec3(1, 65, 0) }) }, inventory: { items: () => [], slots: {} } });
  assert.equal(immediateThreat(make(3))?.entity.name, 'creeper');
  assert.equal(immediateThreat(make(7)), undefined);
});

test('the charge\'s way to a shooter is walked ahead: a gap on the line stops it short, level ground carries it', () => {
  // mid-110-h: a charge offered at skeletons the ground between did not carry it to.
  const { chargeStopsAt } = require('../src/survival');
  const world = gapAt => p => {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    const solid = y < 64 && !(gapAt !== null && x === gapAt && y >= 50);
    return { position: p, name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty' };
  };
  const skeleton = { position: new Vec3(10.5, 64, 0.5) };
  const bot = gap => ({ entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt: world(gap) });
  assert.equal(chargeStopsAt(bot(null), skeleton), null, 'level ground all the way');
  assert.deepEqual(chargeStopsAt(bot(4), skeleton), { blocks: 3, left: 7 }, 'a ravine at x 4');
});

test('a drowned with a trident is a shooter, and its throw is counted at eight', () => {
  // mid-72-a: a trident drowned threw from beyond eight blocks underwater, 4.5 a throw through iron, and nothing answered it.
  const { shooter } = require('../src/mob-policy');
  const { fightEstimate } = require('../src/combat-estimate');
  assert.equal(shooter({ name: 'drowned', heldItem: { name: 'trident' } }), true);
  assert.equal(shooter({ name: 'drowned', heldItem: null }), false);
  const est = fightEstimate({ threats: [{ name: 'drowned', distance: 12, shoots: true, visible: true }], armour: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'] });
  assert(est.mobs[0].hitsBot > 4, `a throw through iron: ${est.mobs[0].hitsBot}`);
});

// A bed nook: the carried bed where no two level cells lie beside the feet.
// Six midgame trials (2026-09-26): the one bot carrying a bed sealed itself
// in eleven times with it, sleep offered only on two level cells.
function nookFixture({ time = 13000, items = [{ name: 'white_bed', count: 1 }, { name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], open = null } = {}) {
  const origin = new Vec3(0, 30, 0), blocks = new Map();
  let inventory = items.map(i => ({ ...i }));
  const air = p => open ? open(p) : p.equals(origin) || p.equals(origin.offset(0, 1, 0));
  const nameAt = p => blocks.get(`${p}`) || (air(p) ? 'air' : 'stone');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 20,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: time }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => inventory, emptySlotCount: () => 10, slots: [] }, heldItem: null, isSleeping: false,
    equip: async item => { bot.heldItem = item; }, lookAt: async () => {},
    blockAt: p => { const name = nameAt(p); return { name, boundingBox: name === 'air' ? 'empty' : 'block', diggable: name !== 'air', position: p }; },
    placeBlock: async ground => { const foot = ground.position.offset(0, 1, 0); blocks.set(`${foot}`, 'white_bed'); blocks.set(`${foot.offset(1, 0, 0)}`, 'white_bed'); inventory = inventory.filter(i => i.name !== 'white_bed'); },
    sleep: async block => { assert.equal(block.name, 'white_bed'); setTimeout(() => { bot.time.timeOfDay = 0; }, 50); },
    wake: async () => {}, world: { raycast: () => null }, findBlocks: () => [], chat() {} });
  const dug = [], placed = [];
  const actions = {
    navigate: async () => {},
    dig: async (b, t, p) => {
      dug.push(`${p}`);
      if (nameAt(p) === 'white_bed') { for (const [k, v] of blocks) if (v === 'white_bed') blocks.set(k, 'air'); inventory.push({ name: 'white_bed', count: 1 }); return; }
      blocks.set(`${p}`, 'air');
    },
    place: async (b, t, p, name) => { placed.push(`${p}`); blocks.set(`${p}`, name); },
  };
  return { bot, origin, blocks, actions, dug, placed, refuge: { origin: { ...origin }, dimension: 'overworld' } };
}

test('a bed nook is two cells in a line dug beside the feet, the floor kept; not beside water, under gravel, or open to the air from a sealed pocket', () => {
  const { bedNook, bedSite } = require('../src/survival');
  const { bot, origin, blocks } = nookFixture();
  assert.equal(bedSite(bot), null, 'a one-by-two pocket has no level cells beside the feet');
  const nook = bedNook(bot, {}, { sealed: true });
  assert.deepEqual([nook.foot, nook.head], [origin.offset(1, 0, 0), origin.offset(2, 0, 0)]);
  assert.equal(nook.dig.length, 4, 'the foot and head cells and the cell over each');
  assert(nook.dig.every(p => p.y >= origin.y), 'the floor under the bed is not dug');
  assert.equal(nook.enclosed, true);
  blocks.set(`${origin.offset(3, 0, 0)}`, 'water');
  assert.notDeepEqual(bedNook(bot, {}, { sealed: true }).foot, origin.offset(1, 0, 0), 'not beside water');
  blocks.delete(`${origin.offset(3, 0, 0)}`);
  blocks.set(`${origin.offset(1, 2, 0)}`, 'gravel');
  assert.notDeepEqual(bedNook(bot, {}, { sealed: true }).foot, origin.offset(1, 0, 0), 'not under gravel, which falls in');
  blocks.delete(`${origin.offset(1, 2, 0)}`);
  // A cave beside the head: from a sealed pocket that way would open it.
  for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) blocks.set(`${origin.offset(dx, 0, dz)}`, 'air');
  assert.equal(bedNook(bot, {}, { sealed: true }), null, 'every way opens the pocket to the air');
  assert.equal(bedNook(bot, {}).enclosed, false, 'unsealed, it is offered and said to be open');
});

test('from a sealed pocket the nook is dug, the carried bed slept in and picked back up, and the pocket\'s wall goes back', async () => {
  const { bot, origin, actions, dug, placed, refuge } = nookFixture();
  const survival = new Survival(bot, actions, { state: { shelters: [refuge] } });
  const reports = []; survival.report = (g, sv, a) => reports.push(a.action);
  assert(shelter.sealed(bot, refuge), 'sealed before');
  await survival.nookSleep(new Task('night'), { kind: 'win' }, () => {}, { pocket: refuge });
  assert.equal(bot.time.timeOfDay, 0, 'the night passed');
  assert.deepEqual(reports, ['bed_nook', 'sleep', 'leave_shelter']);
  assert.deepEqual(dug.slice(0, 4).sort(), [origin.offset(1, 0, 0), origin.offset(1, 1, 0), origin.offset(2, 0, 0), origin.offset(2, 1, 0)].map(String).sort());
  assert(bot.inventory.items().some(i => i.name === 'white_bed'), 'the bed is carried again');
  assert.deepEqual(placed, [origin.offset(1, 0, 0), origin.offset(1, 1, 0)].map(String), 'the two cells dug out of the wall go back');
  assert(shelter.sealed(bot, refuge), 'and the pocket is shut again');

  // Refused, with a monster behind the rock: the bed comes up, the wall goes back, and the sleep waits.
  const refused = nookFixture();
  refused.bot.sleep = async () => { throw new Error('You may not rest now; there are monsters nearby'); };
  const again = new Survival(refused.bot, refused.actions, { state: { shelters: [refused.refuge] } });
  again.report = () => {};
  await assert.rejects(again.nookSleep(new Task('night'), { kind: 'win' }, () => {}, { pocket: refused.refuge }), /monsters/);
  assert(refused.bot.inventory.items().some(i => i.name === 'white_bed'), 'the bed is carried again');
  assert(shelter.sealed(refused.bot, refused.refuge), 'the pocket is shut again');
  assert(require('../src/progress').isSetAside(again, 'sleep', 'bed'), 'the sleep waits out the refusal');
});

test('at bedtime in a shaft with a bed carried, the nook is on offer where the bed does not fit, and the fallback sleeps in it', async () => {
  const { question } = require('../src/decisions');
  // A one-wide shaft open to the sky above the bot.
  const { bot } = nookFixture({ open: p => p.x === 0 && p.z === 0 && p.y >= 30 });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } } });
  const seen = [];
  survival.decide = async (task, goal, save, { id, tree }) => { seen.push([id, Object.keys(tree).sort()]); const key = question(id).fallback(tree, []); seen.push(tree[key].description); return { path: [key], action: tree[key], stale: false }; };
  survival.nookSleep = async () => { seen.push('slept'); };
  await survival.step(new Task('night'), { kind: 'win', request: 'beat the game' }, () => {});
  assert.deepEqual(seen[0], ['survival_priority', ['continue_request', 'secure_shelter', 'sleep_in_nook']]);
  assert.match(seen[1], /dig a bed nook beside the bot, the two cells in a line where the bed goes \(foot and head\), 4 blocks to dig and the floor under them kept, closed in rock all round; put the carried bed in it and sleep/);
  assert.match(seen[1], /within about eight blocks sideways and five up or down of the bed \(vanilla\), seen or not: none now/);
  assert.equal(seen[2], 'slept');
});

test('sealed in with a bed carried: at bedtime the nook is Jev\'s to choose, before it the stay says when; chosen as the night\'s shelter, it is taken without asking', async () => {
  const early = nookFixture({ time: 12000 });
  const before = new Survival(early.bot, early.actions, { state: { shelters: [early.refuge] }, client: { systemOne: async () => ({}) } });
  let asked = [];
  before.decide = async (task, goal, save, { id, tree }) => { asked.push([id, tree]); return { path: ['stay'], stale: false }; };
  before.wait = async () => {};
  await before.step(new Task('night'), { kind: 'win' }, () => {});
  assert.equal(asked[0][0], 'pocket_next');
  assert(!asked[0][1].sleep_in_nook, 'not before bedtime');
  assert.match(asked[0][1].stay.description, /The carried bed can go down in a nook dug out of the wall, the pocket staying shut, from bedtime \(12541\), about 27 seconds off/);

  const late = nookFixture({ time: 13000 });
  const survival = new Survival(late.bot, late.actions, { state: { shelters: [late.refuge] }, client: { systemOne: async () => ({}) } });
  asked = [];
  survival.decide = async (task, goal, save, { id, tree }) => { asked.push([id, Object.keys(tree)]); return { path: ['sleep_in_nook'], stale: false }; };
  const slept = [];
  survival.nookSleep = async (task, goal, save, { pocket }) => { slept.push(pocket); };
  await survival.step(new Task('night'), { kind: 'win' }, () => {});
  assert(asked[0][1].includes('sleep_in_nook'), asked[0][1].join(','));
  assert.deepEqual(slept, [late.refuge], 'slept from the pocket, which stays the pocket');

  const planned = nookFixture({ time: 13000 });
  const held = new Survival(planned.bot, planned.actions, { state: { shelters: [planned.refuge], bedNookPlan: { until: Date.now() + 60000 } }, client: { systemOne: async () => ({}) } });
  held.decide = async () => assert.fail('the nook was chosen when the pocket was sealed');
  let ran = 0; held.nookSleep = async () => { ran++; };
  await held.step(new Task('night'), { kind: 'win' }, () => {});
  assert.equal(ran, 1);
});

test('choosing how to shelter with a bed carried, the bed nook is on offer: before bedtime a pocket sealed here and the nook dug at bedtime', async () => {
  const { bot, actions } = nookFixture({ time: 12000, open: p => p.y >= 30 && p.x === 0 && p.z === 0 });
  const survival = new Survival(bot, actions, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  bot.pathfinder = { movements: {} };
  const sites = shelter.shelterSites; shelter.shelterSites = () => [];
  let seen;
  survival.decide = async (task, goal, save, { id, tree }) => { seen = { id, tree }; return { path: ['bed_nook'], stale: false }; };
  const sealed = [];
  survival.sealHere = async () => { sealed.push(1); return true; };
  survival.nookSleep = async () => assert.fail('not bedtime yet');
  try { assert.equal(await survival.refugeStep(new Task('dusk'), {}, () => {}), true); }
  finally { shelter.shelterSites = sites; }
  assert.equal(seen.id, 'shelter_method');
  assert.match(seen.tree.bed_nook.description, /Seal a pocket where the bot stands, as seal_here does \(32 blocks carried\), and at bedtime dig a bed nook out of the pocket's wall/);
  assert.match(seen.tree.bed_nook.description, /closed in rock all round so the pocket stays shut; put the carried bed in it and sleep\. The night passes in seconds/);
  assert.match(seen.tree.bed_nook.description, /Bedtime is from 12541, about 27 seconds off/);
  assert.deepEqual(sealed, [1], 'the pocket is sealed now');
  assert(survival.state.bedNookPlan?.until > Date.now(), 'and the nook is the plan for bedtime');
});

test('out of lava, a water cell beside is the way out; out of water it is not', () => {
  // mid-92-h: the pour's water filled every cell beside the lava it fell into; the nearest dry cell was seven blocks through the pool.
  const { lavaExit } = require('../src/survival');
  const blockAt = p => p.x === 0 && p.z === 0 && p.y === 38 ? { name: 'lava', boundingBox: 'empty', position: p }
    : p.y === 38 && Math.abs(p.x) <= 3 && Math.abs(p.z) <= 3 ? { name: 'water', boundingBox: 'empty', position: p }
    : p.y < 38 ? { name: 'stone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { entity: { position: new Vec3(0.5, 38.4, 0.5) }, blockAt };
  const out = lavaExit(bot, 6, { water: true });
  assert(out && out.distanceTo(new Vec3(0, 38, 0)) <= 1.5, `beside: ${out}`);
  const dry = lavaExit(bot);
  assert(!dry || blockAt(dry).name !== 'water', 'the dry exit is never water');
});

test('out of lava, water a step up is no way out: the climb into it is refused', () => {
  // mid-92-n: in the pool at y 37 against obsidian with the poured water on it; steered at the water, it bobbed there and burned.
  const { lavaExit } = require('../src/survival');
  const blockAt = p => p.y === 37 && p.x <= 0 ? { name: 'lava', boundingBox: 'empty', position: p }
    : p.y === 37 ? { name: 'obsidian', boundingBox: 'block', position: p }
    : p.y === 38 && p.x >= 1 && p.x <= 3 ? { name: 'water', boundingBox: 'empty', position: p }
    : p.y < 37 ? { name: 'stone', boundingBox: 'block', position: p }
    : p.x <= 0 || p.y >= 39 || p.x > 3 ? { name: 'air', boundingBox: 'empty', position: p } : { name: 'stone', boundingBox: 'block', position: p };
  const bot = { entity: { position: new Vec3(0.7, 37.5, 0.5) }, blockAt };
  const out = lavaExit(bot, 6, { water: true });
  assert(out && blockAt(out).name !== 'water', `not the water on the obsidian: ${out}`);
});

// A crowd on flat stone (mid-83-d, mid-92-e, mid-110-k): the bot in iron with
// a diamond sword and pickaxe, cobblestone to build with, bread to eat.
function crowdBot({ health = 13, food = 14, items = [] } = {}) {
  const registry = require('minecraft-data')('26.1');
  const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].map(name => ({ name }));
  return Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, health, food, foodSaturation: 0, entities: {}, time: { timeOfDay: 13000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, registry,
    inventory: { items: () => [{ name: 'diamond_sword', count: 1 }, { name: 'diamond_pickaxe', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'bread', count: 3 }, ...items], slots: { 5: iron[0], 6: iron[1], 7: iron[2], 8: iron[3], 45: { name: 'shield' } } },
    blockAt: p => ({ position: p.floored(), name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', diggable: true }), world: { raycast: () => null }, findBlocks: () => [] });
}
const crowdMob = (id, name, x, z = 0) => ({ entity: { id, name, position: new Vec3(0.5 + x, 64, 0.5 + z), height: 1.8 }, distance: Math.hypot(x, z), visible: true });

test('in a crowd every stance says what the mobs cost it over the same fifteen seconds, the pillar and the pocket as well as the fight', () => {
  const bot = crowdBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const crowd = [crowdMob(1, 'spider', 1.8), crowdMob(2, 'zombie', -3.2), crowdMob(3, 'creeper', 0, 6.4), crowdMob(4, 'skeleton', 6.4), crowdMob(5, 'skeleton', -8.5), crowdMob(6, 'skeleton', 0, -20)];
  const options = survival.stanceOptions(new Task('dusk'), {}, () => {}, crowd, false);
  const priced = /About [\d.]+ damage from the mobs here in the next fifteen seconds this way/;
  // The pillar under a creeper and three skeletons carried no figure, and was taken (mid-110-k).
  assert.match(options.pillar.description, priced);
  assert.match(options.pillar.description, /the 1\.5 seconds of going up included, from 13 health \(more than the bot has\)/);
  assert.match(options.pillar.description, /The creeper 6 blocks off can go off beside the bot in about 2\.6 seconds, after the going up is done: up to 19 after the armour worn, more than the bot has/);
  assert.match(options.pillar.description, /Two up, the creeper, 3 skeletons and the spider still reach it/);
  assert.match(options.seal.description, priced);
  assert.match(options.seal.description, /seconds of building not done within them/, 'thirty blocks of pocket are not shut in fifteen seconds');
  assert.match(options.fight.description, /about [\d.]+ of it in the first fifteen seconds/);
  assert.match(options.fight.description, /Open ground all round: every biter can be at arm's length at once/);
  // The charge quotes the fight's estimate: what it leaves out is said there too.
  assert.match(options.charge_shooter.description, /Not counted there: the creeper, whose blast at arm's length takes up to 19 health/);
  // Down into the stone underfoot: three blocks (walled all round, the roof ring too), a block over the head.
  assert.match(options.dig_down.description, /Dig straight down 3 blocks where the bot stands, put a block over its head and wait inside for the mobs to lose interest/);
  assert.match(options.dig_down.description, priced);
  // Hurt and hungry, a meal is a stance with its bill: the eating alone.
  assert.match(options.eat.description, /Eat the bread now \(3 carried\): about 1\.6 seconds standing still, the hand busy and the shield down, no swing; hunger 14 to 19, then health comes back about one each four seconds/);
  assert.match(options.eat.description, /while it eats, from 13 health\. The mobs are all still here when it is done\./);
  // With nothing close, the hole is shut before any of them arrives.
  const far = survival.stanceOptions(new Task('dusk'), {}, () => {}, [crowdMob(4, 'skeleton', 24), crowdMob(2, 'zombie', 0, 20)], false);
  assert.match(far.dig_down.description, /Shut in below, none of them reaches it/);
});

test('a meal is offered in an encounter only where it brings health back', () => {
  const survival = b => new Survival(b, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const one = [crowdMob(1, 'zombie', 5)];
  assert(!survival(crowdBot({ health: 20, food: 14 })).stanceOptions(new Task('x'), {}, () => {}, one, false).eat, 'full health: nothing to heal');
  assert(!survival(crowdBot({ health: 12, food: 8 })).stanceOptions(new Task('x'), {}, () => {}, one, false).eat, 'bread to thirteen: still no regeneration');
  assert(survival(crowdBot({ health: 12, food: 16 })).stanceOptions(new Task('x'), {}, () => {}, one, false).eat, 'to eighteen or more: health comes back');
});

test('how many can reach at once: two in a tunnel, eight on open ground', () => {
  const { openCells } = require('../src/survival');
  assert.equal(openCells(crowdBot()), 8);
  // A one-wide tunnel along x: rock on both sides.
  const tunnel = { blockAt: p => { const f = p.floored(); const solid = f.y < 64 || f.y > 65 || f.z !== 0; return { position: f, name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty' }; }, entity: { position: new Vec3(0.5, 64, 0.5) } };
  assert.equal(openCells(tunnel), 2);
});

test('a stance is held through a crowd whose kinds change, and asked again for a mob new to it come close', async () => {
  const bot = crowdBot({ health: 18 });
  const survival = new Survival(bot, { navigate: async () => {} });
  const asked = [];
  survival.stanceOptions = () => ({ fight: { description: 'fight', run: async () => true }, pillar: { description: 'up', run: async () => true }, retreat: { description: 'away', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { asked.push(q.state.previousStance); return { path: ['fight'] }; };
  const zombie = crowdMob(1, 'zombie', 4), creeper = crowdMob(2, 'creeper', 9), skeleton = crowdMob(3, 'skeleton', 14), spider = crowdMob(4, 'spider', 5);
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [zombie, creeper], false);
  assert.equal(asked.length, 1);
  // mid-83-d: the kinds in view changed as mobs came into view far off and went out of it.
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [zombie], false);
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [zombie, creeper, skeleton], false);
  assert.equal(asked.length, 1, 'a kind gone out of view, or one come into view fourteen blocks off: held');
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [zombie, creeper, skeleton, spider], false);
  assert.equal(asked.length, 2, 'a spider new to the choice five blocks off: asked again');
  assert.match(asked[1].askedAgainFor, /a spider come within 5 blocks/);
  bot.health = 11;
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [zombie, creeper, skeleton, spider], false);
  assert.equal(asked.length, 3, 'six health gone since the choice: asked again');
});

test('a stance that failed here is not offered again when the kinds about change, and is once the bot is elsewhere', async () => {
  const bot = crowdBot({ health: 18 });
  const survival = new Survival(bot, { navigate: async () => {} });
  const trees = [];
  survival.stanceOptions = () => ({ pillar: { description: 'up', run: async () => false }, fight: { description: 'fight', run: async () => true }, seal: { description: 'seal', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { trees.push(Object.keys(q.tree)); return { path: [q.tree.pillar ? 'pillar' : 'fight'] }; };
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [crowdMob(1, 'zombie', 2)], false);
  delete survival.state.stance;
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [crowdMob(1, 'zombie', 2), crowdMob(2, 'skeleton', 9)], false);
  assert(!trees[1].includes('pillar'), `a skeleton come into view does not bring the failed pillar back: ${trees[1]}`);
  delete survival.state.stance;
  bot.entity.position = new Vec3(8.5, 64, 0.5);
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [crowdMob(1, 'zombie', 2)], false);
  assert(trees[2].includes('pillar'), 'eight blocks on, it is offered again');
});

test('the run\'s way is found before the stance is asked, said on the retreat, and run without a second search', async () => {
  const bot = crowdBot({ health: 16 });
  const footing = [new Vec3(0, 63, 14), new Vec3(0, 63, -14)];
  let searches = 0;
  Object.assign(bot, { findBlocks: () => footing, pathfinder: { movements: {}, setGoal() {},
    getPathTo: (m, goal) => { searches++; return goal.z > 0 ? { status: 'success', path: Array.from({ length: 14 }, (_, i) => new Vec3(0.5, 64, 1.5 + i)) } : { status: 'noPath', path: [] }; } }, clearControlStates() {} });
  const zombie = { id: 1, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 64, -4.5), height: 1.95, isValid: true };
  bot.entities = { 1: zombie };
  const went = [];
  const survival = new Survival(bot, { navigate: async (b, t, goal) => { went.push([goal.x, goal.y, goal.z]); } }, { state: { shelters: [] } });
  const danger = [{ entity: zombie, distance: 5, visible: true }];
  const scout = await survival.scoutRetreat(new Task('dusk'), danger);
  assert.deepEqual(scout.destination, { x: 0, y: 64, z: 14 });
  assert.match(survival.stanceOptions(new Task('dusk'), {}, () => {}, danger, false).retreat.description, /A way is found: 14 blocks to footing \d+ blocks further from every mob about, passing none of them, about 2\.5 seconds at a run/);
  const before = searches;
  assert.equal(await survival.runAway(new Task('dusk'), {}, () => {}, danger), true);
  assert.equal(searches, before, 'the way found is the one run');
  assert.deepEqual(went, [[0, 64, 14]]);
  // Nowhere to go: said, so the run is not chosen blind.
  bot.findBlocks = () => [];
  await survival.scoutRetreat(new Task('dusk'), danger);
  assert.match(survival.stanceOptions(new Task('dusk'), {}, () => {}, danger, false).retreat.description, /Nowhere to run to: no footing within 20 blocks is four blocks further than here from every mob about/);
});

test('out of lava the way out is never the cell the feet are in, and a cell with no lava beside comes first', () => {
  // mid-92-m: its own cell, leaned out of into the lava beside, was "the nearest dry cell"; it burned standing in it.
  const { lavaExit } = require('../src/survival');
  const blockAt = p => p.x === 1 && p.y === 75 && p.z === 0 ? { name: 'lava', boundingBox: 'empty', position: p }
    : p.y < 75 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { entity: { position: new Vec3(0.8, 75, 0.5) }, blockAt };
  const out = lavaExit(bot, 6, { water: true });
  assert(!(out.x === 0 && out.z === 0), `not its own cell: ${out}`);
  assert(![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, z]) => blockAt(out.offset(x, 0, z)).name === 'lava'), `no lava beside it: ${out}`);
});

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

test('a zombie on the lid of a dug-down pocket is not fought from inside: the pocket\'s question is asked, and says it is on the lid (mid-235-n, note 478)', async () => {
  // mid-235-n sat two hours and twenty minutes under zombies on its lid, the
  // reflex "fighting" them twice a second without a swing, and was never asked.
  const origin = new Vec3(0, 10, 0);
  const open = p => p.x === 0 && p.z === 0 && (p.y === 10 || p.y === 11);
  const blockAt = p => { const c = p.floored(); return open(c) || c.y > 12 ? { name: 'air', boundingBox: 'empty', position: c, shapes: [] } : { name: 'stone', boundingBox: 'block', position: c, shapes: [[0, 0, 0, 1, 1, 1]], diggable: true, hardness: 1.5 }; };
  const raycast = (from, dir, range) => {
    for (let t = 0; t <= range; t += 0.01) { const at = from.plus(dir.scaled(t)), b = blockAt(at); if (b.boundingBox === 'block') return { ...b, intersect: at }; }
    return null;
  };
  const zombie = { id: 7, name: 'zombie', type: 'hostile', position: new Vec3(1, 13, 0.5), height: 1.95, width: 0.6, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 }, entities: { 7: zombie }, health: 20, food: 20,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 23500 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] }, heldItem: null,
    blockAt, world: { raycast }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, equip: async () => {}, attack() {} });
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {} }, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld', verifiedAt: 'x', createdAt: 'x' }] } });
  let tree;
  survival.decide = async (task, goal, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  const goal = { kind: 'win' };
  await survival.step(new Task('dawn'), goal, () => {});
  assert.notEqual(goal.survivalAction?.action, 'fight_in_pocket', 'no swing reaches it through the lid');
  assert(tree, 'pocket_next is asked');
  for (const key of ['stay', 'leave']) assert.match(tree[key]?.description || '', /A zombie is standing on the pocket's lid, right over the bot: a solid block is between, so the sword cannot reach it and it cannot hit the bot through it\./, key);
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
  const make = (name = 'zombie') => {
    const zombie = { name, type: 'hostile', position: origin.offset(4.5, 0, 0.5), height: 1.95 };
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
  // mid-72-g: opened on a creeper three blocks off behind the wall and was blown up.
  const creeper = make('creeper');
  await creeper.survival.leave(new Task('dawn'), {}, () => {}, creeper.refuge, undefined, { past: true });
  assert.deepEqual(creeper.dug, [], 'never out beside a creeper');
  assert.match(creeper.waits[0], /block the shelter exits/);
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
  // A blaze among them and twenty blocks carried: the box and the corner
  // too (note 606), and the close-in with no shield (note 614).
  assert.deepEqual(Object.keys(calls[0].questions.branch_0.criteria).sort(), ['box_here', 'charge_shooter', 'close_in', 'corner_ambush', 'fight', 'keep_working', 'pillar', 'retreat', 'seal', 'shoot_17', 'shoot_7']);
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

test('at dusk with a bed at home, Jev heads home before bedtime; from a mine only after two nights awake', async () => {
  const { Survival, SLEEP_DEBT_TICKS } = require('../src/survival');
  const { layout } = require('../src/home-base');
  const home = { version: 1, dimension: 'overworld', origin: { x: 0, y: 63, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 63, z: 0 }, bed: { placedAt: 'now', claimedAt: 'now' }, plot: {}, pen: {} };
  const { bed } = layout(home);
  const blocks = new Map([[`${new Vec3(bed.foot.x, bed.foot.y, bed.foot.z)}`, 'white_bed'], [`${new Vec3(bed.head.x, bed.head.y, bed.head.z)}`, 'white_bed']]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 11600, age: 100000 },
    entity: { position: new Vec3(30.5, 40, 0.5) }, health: 20, food: 20, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null, findBlocks: () => [], world: { raycast: () => null }, chat() {},
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }) });
  const walked = [], climbed = [];
  const survival = new Survival(bot, { navigate: async (b, t, g) => walked.push([g.x, g.y, g.z]), surfaceStep: async () => climbed.push(1), dig: async () => {}, place: async () => {} }, { state: { home } });
  const goal = { kind: 'win', request: 'beat the game', survival: survival.state };
  assert.equal(await survival.step(new Task('test', 'dusk'), goal, () => {}), false, 'at the bottom of a shaft the night changes nothing: the work goes on');
  bot.time.age += SLEEP_DEBT_TICKS + 1;
  assert.equal(await survival.step(new Task('test', 'dusk'), goal, () => {}), true);
  assert.deepEqual([walked, climbed], [[], [1]], 'two nights awake: the way home starts with the stairs');
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

test('out of lava into water is out: jump is not held on, up the water (mid-237-j, note 518)', { timeout: 6000 }, async () => {
  // Out of the pool into a waterfall's foot, forward and jump swam it six blocks up toward the lip it fell from.
  const { Survival } = require('../src/survival');
  const blockAt = p => p.x === 0 && p.z === 0 && p.y === 10 ? { name: 'lava', boundingBox: 'empty', position: p }
    : p.y < 10 ? { name: 'stone', boundingBox: 'block', position: p } : p.x === 1 && p.z === 0 ? { name: 'water', boundingBox: 'empty', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { entity: { position: new Vec3(0.5, 10, 0.5), isInLava: true, onGround: false }, blockAt, health: 13, food: 20,
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, controlState: {},
    // In the water column: out of the lava, afloat, never on ground, never over the exit's own cell.
    setControlState(k, v) { this.controlState[k] = v; if (k === 'forward' && v) { this.entity.position = new Vec3(1.5, 10.3, 0.5); this.entity.isInLava = false; this.entity.isInWater = true; } },
    lookAt: async () => {}, inventory: { items: () => [], slots: {} }, time: { timeOfDay: 6000 }, on() {}, removeListener() {} };
  const survival = new Survival(bot, {}, { state: { shelters: [], lastDry: { x: -1, y: 10, z: 0 } } });
  const started = Date.now();
  assert.equal(await survival.step(new Task('lava'), {}, () => {}, () => {}), true);
  assert(Date.now() - started < 1500, `stopped once in the water, not held for the move's whole time: ${Date.now() - started} ms`);
});

test('out of lava, a cell with a floor all round comes before one on a ledge edge', () => {
  // mid-235-a: stepped out of lava onto the edge of a Nether ledge at y 71 and over it, twenty blocks into the lava below.
  const { lavaExit } = require('../src/survival');
  // A ledge floor at y 70 for z >= 0; nothing north of it down to y 50. Lava at the bot's cell (0,71,1).
  const blockAt = p => (p.x === 0 && p.y === 71 && p.z === 1) ? { name: 'lava', boundingBox: 'empty', position: p }
    : (p.y <= 70 && p.z >= 0) || p.y < 50 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { entity: { position: new Vec3(0.5, 71, 1.2) }, blockAt };
  const exit = lavaExit(bot, 6, { water: true });
  assert(exit, 'a way out');
  assert(exit.z >= 1, `not the edge row over the drop: ${exit}`);
});

test('out of lava, a cell a jump can reach comes before a nearer ledge two up', () => {
  // mid-230-d: steered at a ledge two above its feet in a lava pit, it hopped in place and burned.
  const { lavaExit } = require('../src/survival');
  // Lava at (0,33,0); a ledge at y 35 one block north; floor at y 34 three blocks east.
  const blockAt = p => (p.x === 0 && p.z === 0 && p.y === 33) ? { name: 'lava', boundingBox: 'empty', position: p }
    : (p.x === 0 && p.z === -1 && p.y <= 34) ? { name: 'stone', boundingBox: 'block', position: p }
    : (p.x >= 1 && p.y <= 33) || p.y <= 32 ? { name: 'stone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { entity: { position: new Vec3(0.5, 33.2, 0.5) }, blockAt };
  const exit = lavaExit(bot, 6, { water: true });
  assert(exit && exit.y <= 34, `within a jump: ${exit}`);
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
  // mid-230-l: what leaving does with a creeper by the doors, said.
  assert.match(leave || '', /A door within six blocks of a creeper stays shut \(the creeper 10 blocks off now, behind the rock\): with every door so, the pocket waits for it to move off/);
});

test('a creeper that keeps every door shut: a passage out through the far wall is Jev\'s, and it is dug away from the creeper', async () => {
  // mid-230-l (note 390): sixty-seven choices to leave, every door refused for a creeper three to seven blocks off behind the rock, a hundred minutes in the pocket.
  const origin = new Vec3(0, 30, 0);
  const creeper = { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(5.5, 30, 0.5), height: 1.7, width: 0.6, isValid: true };
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: { 7: creeper }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : 'block', diggable: true, position: p }),
    world: { raycast: (from) => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const dug = [], walked = [];
  const refuge = { origin: { ...origin }, dimension: 'overworld' };
  const survival = new Survival(bot, { dig: async (b, t, p) => { dug.push([p.x, p.y, p.z]); open.add(`${p}`); }, navigate: async (b, t, g) => { walked.push([g.x, g.z]); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } },
    { state: { shelters: [refuge] }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, goal, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['tunnel_out'], stale: false }; };
  survival.wait = async () => assert.fail('Jev chose the passage');
  await survival.step(new Task('day'), { kind: 'win' }, () => {});
  assert.match(tree?.tunnel_out?.description || '', /Dig a passage out through the pocket's west wall, away from the creeper: one wide and two high, 5 blocks, about 13 seconds/);
  assert.match(tree.tunnel_out.description, /10 blocks from where the creeper is now \(it is 5 off, behind the rock\)/);
  assert.match(tree.tunnel_out.description, /stops, the bot still enclosed, if the creeper comes round toward its head within six blocks/);
  assert.deepEqual(dug, [[-1, 30, 0], [-1, 31, 0], [-2, 30, 0], [-2, 31, 0], [-3, 30, 0], [-3, 31, 0], [-4, 30, 0], [-4, 31, 0], [-5, 30, 0], [-5, 31, 0]], 'west, cell by cell, two high');
  assert.deepEqual(walked.at(-1), [-5, 0]);
  assert(!survival.state.shelters.includes(refuge), 'the pocket is left behind, as by a door');
  // The creeper come round to the passage's head: it stops, the bot still in rock.
  const again = new Survival(bot, { dig: async (b, t, p) => { dug.push([p.x, p.y, p.z]); open.add(`${p}`); }, navigate: async () => {} }, { state: { shelters: [refuge] } });
  bot.entity.position = origin.offset(0.5, 0, 0.5); dug.length = 0;
  const passage = again.passageOut({ entity: creeper, distance: 5, visible: false });
  creeper.position = new Vec3(-3.5, 30, 0.5);
  assert.equal(await again.tunnelOut(new Task('day'), {}, () => {}, refuge, { entity: creeper, distance: 4 }, passage), false);
  assert.deepEqual(dug, [], 'not a block dug toward a creeper within six of the passage');
  assert(again.state.shelters.includes(refuge), 'still the pocket');
  // No passage where the rock ahead has water behind it, on every way that
  // does not lead toward the creeper, level or down (note 597).
  const wetAt = p => p.x <= -2 || Math.abs(p.z) >= 2;
  const wet = new Survival(Object.assign(bot, { blockAt: p => ({ name: open.has(`${p}`) ? 'air' : wetAt(p) ? 'water' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : wetAt(p) ? 'empty' : 'block', diggable: true, position: p }) }), {}, {});
  assert.equal(wet.passageOut({ entity: { position: new Vec3(5.5, 30, 0.5) }, distance: 5 }), null);
  // Water behind the west run only: across to the north instead, level.
  const westWet = new Survival(Object.assign(bot, { blockAt: p => ({ name: open.has(`${p}`) ? 'air' : p.x <= -2 ? 'water' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : p.x <= -2 ? 'empty' : 'block', diggable: true, position: p }) }), {}, {});
  const across = westWet.passageOut({ entity: { position: new Vec3(5.5, 30, 0.5) }, distance: 5 });
  assert.equal(across?.direction, 'north');
  assert.equal(across.down, 0);
  assert(across.clearance >= 10);
});

test('sealed in hurt and hungry at night, staying and leaving both say the health and that it does not come back', async () => {
  // mid-92-o: at eight health and twelve hunger it left the pocket told only that mobs spawn in the dark, and died in a minute.
  const origin = new Vec3(0, 30, 0);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 8.3, food: 12, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 16000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'air' : 'stone', boundingBox: p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'empty' : 'block', position: p }),
    world: { raycast: (from) => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld' }] }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, goal, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('night'), { kind: 'win' }, () => {});
  assert.match(tree?.stay?.description || '', /not healing: 8.3 health and hunger 12/);
  assert.match(tree?.leave?.description || '', /goes out at 8.3 health, not healing at hunger 12: about \d+ zombie hits or \d+ arrows end it/);
});

test('a ghast in sight with a drop into lava beside the bot: off the edge first', async () => {
  // mid-87-l: on a ledge at y 74 over the lava sea, a ghast's fireball threw it forty blocks down into the lava.
  const ghast = { id: 3, name: 'ghast', type: 'hostile', position: new Vec3(-20.5, 80, 20.5), height: 4, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 3: ghast }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 74, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'diamond_sword', count: 1 }, { name: 'netherrack', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: p.x >= 2 ? (p.y <= 30 ? 'lava' : 'air') : p.y < 74 ? 'netherrack' : 'air', boundingBox: p.x < 2 && p.y < 74 ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  let to = null;
  const survival = new Survival(bot, { navigate: async (b, t, g) => { to = g; } }, { state: { shelters: [] } });
  const goal = {};
  await survival.step(new Task('leg'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'off_the_edge');
  assert(to && to.x <= -2, `back from the edge: ${to && to.x}`);
});

test('any mob in sight within reach, with a drop into lava beside the bot: off the edge first', async () => {
  // mid-227-a: stood on a ledge at y 77 over the lava sea while a magma cube came down from eighteen blocks over; it went over the edge.
  const cube = { id: 4, name: 'magma_cube', type: 'hostile', position: new Vec3(-0.5, 92, 0.5), height: 2, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 4: cube }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 74, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'diamond_sword', count: 1 }, { name: 'netherrack', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: p.x >= 2 ? (p.y <= 30 ? 'lava' : 'air') : p.y < 74 ? 'netherrack' : 'air', boundingBox: p.x < 2 && p.y < 74 ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  let to = null;
  const survival = new Survival(bot, { navigate: async (b, t, g) => { to = g; } }, { state: { shelters: [] } });
  const goal = {};
  await survival.step(new Task('leg'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'off_the_edge');
  assert.equal(goal.survivalAction?.from, 'magma_cube');
  assert(to && to.x <= -2, `back from the edge: ${to && to.x}`);
});

test('a mob in sight with lava level with the feet beside the bot: off the edge first, as from a drop', async () => {
  // mid-214-b: hit by an enderman beside a lava pool at y 51 in the Nether, went in, and burned to death.
  const zombie = { id: 4, name: 'zombie', type: 'hostile', position: new Vec3(-8.5, 51, 0.5), height: 1.9, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 4: zombie }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 51, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'diamond_sword', count: 1 }, { name: 'netherrack', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: p.y === 51 && p.x >= 2 ? 'lava' : p.y < 51 ? 'netherrack' : 'air', boundingBox: p.y < 51 ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  let to = null;
  const survival = new Survival(bot, { navigate: async (b, t, g) => { to = g; } }, { state: { shelters: [] } });
  const goal = {};
  await survival.step(new Task('leg'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'off_the_edge');
  assert(to && to.x <= -1, `back from the pool: ${to && to.x}`);
});

test('a deadly drop two blocks off and no firmer ground than the feet: no walk to where the bot stands', async () => {
  // mid-244-i: off_the_edge to its own cell twenty passes a second, for minutes, with zombies about.
  const zombie = { id: 4, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 51, -1.5), height: 1.9, isValid: true };
  const ground = p => Math.abs(p.x) <= 1 && Math.abs(p.z) <= 1;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: { 4: zombie }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 51, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'diamond_sword', count: 1 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: p.y <= 30 ? 'lava' : ground(p) && p.y < 51 ? 'stone' : 'air', boundingBox: ground(p) && p.y < 51 && p.y > 30 ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {},
    equip: async () => {}, attack() {}, lookAt: async () => {}, heldItem: { name: 'diamond_sword' } });
  const walked = [];
  const survival = new Survival(bot, { navigate: async (b, t, g) => { walked.push(g); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.step(new Task('leg'), goal, () => {});
  assert(!walked.some(g => g.x === 0 && g.y === 51 && g.z === 0), 'not walked to its own cell');
  assert.notEqual(goal.survivalAction?.action, 'off_the_edge');
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

test('in lava, the way out is priced and walked by the way through at the jar\'s 0.4 blocks a second, not the straight line through rock (mid-244-ab, note 569)', { timeout: 10000 }, async () => {
  // The bunker's last leg, flooded: lava in the tunnel at z 233 (x -4..-1),
  // its turn north at x -1 and the dry leg before it at z 232 (x -1..2), and
  // a dug pocket at (-3, 39, 231) behind a block of rock, nearer in a
  // straight line.
  const lava = new Set(['-4,39,233', '-3,39,233', '-2,39,233', '-1,39,233', '-4,40,233']);
  const open = new Set(['-3,40,233', '-2,40,233', '-1,40,233', '-3,39,231', '-3,40,231']);
  for (let x = -1; x <= 2; x++) { open.add(`${x},39,232`); open.add(`${x},40,232`); }
  const blockAt = p => { const k = `${p.x},${p.y},${p.z}`;
    return lava.has(k) ? { name: 'lava', boundingBox: 'empty', position: p } : open.has(k) ? { name: 'air', boundingBox: 'empty', position: p } : { name: 'netherrack', boundingBox: 'block', position: p }; };
  const { Survival, lavaExit, LAVA_BLOCKS_A_SECOND } = require('../src/survival');
  assert.equal(LAVA_BLOCKS_A_SECOND, 0.4, 'the jar: 0.02 of the keys a tick, the motion halved every tick');
  const looks = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 18, food: 20,
    entity: { position: new Vec3(-3.5, 39, 233.5), onGround: false, isInLava: true, yaw: 0, pitch: 0 }, entities: {}, blockAt,
    inventory: { items: () => [], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } } },
    lookAt: async p => { looks.push(p); }, look: async () => {}, getControlState: () => false,
    // A held key takes the body to the cell looked at; out of the lava there.
    setControlState(k, v) { if (k === 'forward' && v && looks.length) { const l = looks.at(-1); this.entity.position = new Vec3(l.x, 39, l.z); this.entity.isInLava = lava.has(`${Math.floor(l.x)},39,${Math.floor(l.z)}`); this.entity.onGround = !this.entity.isInLava; } } });
  const exit = lavaExit(bot, 6, { dryOnly: true });
  // The turn itself has the lava beside it, so the cell past it is first.
  assert.deepEqual([exit.x, exit.y, exit.z], [0, 39, 232], `round the corner, not the pocket behind the rock: ${exit}`);
  assert.equal(exit.blocks, 5);
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const ways = survival.lavaWays(new Task('lava'), {}, () => {});
  assert.match(ways.to_dry_ground.description, /5 blocks off by the way through at \(0, 39, 232\).*about 12\.5 seconds at the 0\.4 blocks a second/);
  assert.match(require('../src/body').conditionSays(bot, 'lava'), /about 3\.8 health a second through the armour worn/, 'full iron: 1.92 a hit, two hits a second');
  assert.equal(await ways.to_dry_ground.run(), true, 'out');
  assert.deepEqual(looks.map(l => [Math.floor(l.x), Math.floor(l.z)]), [[-3, 233], [-2, 233], [-1, 233], [-1, 232]], 'cell by cell along the tunnel and round its turn, ended once out');
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
  assert.equal(goal.survivalAction.action, 'leave_lava'); assert.equal(goal.survivalAction.way, 'back_the_way_came', 'no cell out: back toward the last dry footing');
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
  const survival = new Survival(bot, { navigate: async (b, t, g) => { moved.push({ x: g.x, y: g.y, z: g.z }); b.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } }, { state: { shelters: [] } });
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

// mid-241-a (2026-09-27 23:26:53): 4.8 health, full iron, an iron sword, a
// creeper 4.4 blocks off coming on and a stone wall at the bot's back. The
// fight said "about 2.5 seconds and 0 damage"; Jev took it (0.41), the fight
// closed on the creeper, backed into the wall unstruck, and it went off
// three blocks off: 4.9 to none (note 529).
function creeperBot({ weapon = 'iron_sword', health = 4.8, wall = true, wallAt = 0, hole = false, armour = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], creeper = null, attacked = [] } = {}) {
  const registry = require('minecraft-data')('26.1');
  const slots = { 45: { name: 'shield' } };
  armour.forEach((name, i) => { slots[5 + i] = { name }; });
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health, food: 20, oxygenLevel: 20, entities: creeper ? { [creeper.id]: creeper } : {}, time: { timeOfDay: 13000 },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, registry, heldItem: null,
    inventory: { items: () => [{ name: weapon, count: 1 }, { name: 'cobblestone', count: 64 }], slots },
    // The wall: stone below x = wallAt, the bot's back to it; or a hole,
    // stone in every cell round the bot's.
    blockAt: p => { const f = p.floored(); const solid = f.y < 64 || (wall && f.x < wallAt) || (hole && f.y < 66 && (f.x !== 0 || f.z !== 0)); return { position: f, name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty', diggable: true }; },
    world: { raycast: () => null }, findBlocks: () => [],
    equip: async item => { bot.heldItem = item; }, unequip: async () => {}, lookAt: async () => {}, look: async () => {}, attack: e => attacked.push(e.name),
    pathfinder: { setGoal() {}, movements: {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {}, chat() {} });
  return bot;
}

test('a creeper coming on at a wall-backed bot is priced by where it goes off: the fight is not "0 damage"', () => {
  const bot = creeperBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const creeper = { entity: { id: 9, name: 'creeper', position: new Vec3(4.95, 64, 0.5), height: 1.7 }, distance: 4.45, visible: true };
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [creeper], false);
  assert(options.fight.expects.damage > 4.8, `the fight's blast is counted: ${JSON.stringify(options.fight.expects)}`);
  assert.match(options.fight.description, /about [\d.]+ seconds and ([5-9]|1\d)(\.\d)? damage to kill them all, from 4\.8 health \(more than the bot has\)/);
  assert.match(options.fight.description, /With the iron sword, the creeper 4 blocks off takes 4 swings, the first about 0\.25 seconds after it lights and one each 0\.7 seconds after: about 2\.35 seconds, longer than the fuse, so it goes off first, about 3 blocks off \(no room to back out\): about 12 after the armour worn, more than the bot has/);
  assert.doesNotMatch(options.fight.description, /Not counted there/);
  // The dance meets it the same way and says it the same way.
  assert.match(options.creeper_dance.description, /it goes off first, about 3 blocks off/);
  assert.doesNotMatch(options.creeper_dance.description, /puts its fuse out/);
  assert.match(options.creeper_dance.description, /Gone off where the dance backs to here, a blast is about 11\.5 after the armour worn: 1 of them ends it/);
  // A block of room behind: four blocks off, still more than it has.
  const oneBlock = new Survival(creeperBot({ wallAt: -1 }), { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } })
    .stanceOptions(new Task('x'), {}, () => {}, [creeper], false);
  assert.match(oneBlock.fight.description, /goes off first, about 4 blocks off \(1 block of room behind the bot\): about 6 after the armour worn, more than the bot has/);
  // With room behind, the bot backs out to where the blast does nothing.
  const open = new Survival(creeperBot({ wall: false }), { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } })
    .stanceOptions(new Task('x'), {}, () => {}, [creeper], false);
  assert.equal(open.fight.expects.damage, 0);
  assert.match(open.fight.description, /goes off first, about 6 blocks off, where the blast does nothing/);
});

// mid-239-c (2026-09-27 23:51:32): in a hole with no cell open round it,
// a helmet and a chestplate, 20 health, a zombie at 3.5 and a creeper come
// to 3.1, the fight told "0 damage" and asked again and again while it
// came; it went off there, 20 to 5.1 ("15 at 3 blocks" said beside).
test('a creeper already lit is priced by the fuse it has left, where the bot can get to in it', t => {
  // The clock held still: the fuse left is read against Date.now(), and the
  // setup's time would otherwise take it under 0.45 seconds.
  t.mock.timers.enable({ apis: ['Date'] });
  const registry = require('minecraft-data')('26.1'), keys = registry.entitiesByName.creeper.metadataKeys;
  const metadata = []; metadata[keys.indexOf('swell_dir')] = 1; metadata[keys.indexOf('health')] = 20;
  const lit = { id: 9, name: 'creeper', position: new Vec3(3.6, 64, 0.5), height: 1.7, metadata };
  const bot = creeperBot({ health: 20, wall: false, hole: true, armour: ['iron_helmet', 'iron_chestplate'], creeper: lit });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  bot._creeperFuses.set(9, Date.now() - 1000);
  const zombie = { entity: { id: 4, name: 'zombie', position: new Vec3(0.5, 64, 4), height: 1.95 }, distance: 3.5, visible: true };
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [{ entity: lit, distance: 3.1, visible: true }, zombie], false);
  assert.match(options.fight.description, /It is lit now, about 0\.5 seconds of its fuse left\./);
  assert.match(options.fight.description, /longer than the fuse left, so it goes off first, about 3\.1 blocks off \(no room to back out\): about 15 after the armour worn/);
  assert(options.fight.expects.damage >= 14, JSON.stringify(options.fight.expects));
});

// mid-230-v (2026-09-27 23:50:14): the dance closed in on a creeper lit 4.9
// blocks off, whose fuse burns on within seven, and it went off: 1.8 to none.
test('the dance does not close in on a creeper that is lit, however far off within seven', async () => {
  const registry = require('minecraft-data')('26.1'), keys = registry.entitiesByName.creeper.metadataKeys;
  const metadata = []; metadata[keys.indexOf('swell_dir')] = 1; metadata[keys.indexOf('health')] = 20;
  const creeper = { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(5.4, 64, 0.5), height: 1.7, width: 0.6, isValid: true, metadata };
  const bot = creeperBot({ weapon: 'diamond_sword', health: 1.8, wall: false, creeper });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const actions = [];
  const report = survival.report.bind(survival);
  survival.report = (goal, save, a) => { actions.push(a.action); return report(goal, save, a); };
  const pressed = [];
  bot.setControlState = (k, v) => { if (v) pressed.push(k); };
  assert.equal(await survival.creeperDance(new Task('x'), {}, () => {}, [{ entity: creeper, distance: 4.9, visible: true }], false, { chosen: true }), true);
  assert(!actions.includes('creeper_close_in'), actions.join(','));
  assert(pressed.includes('back') && !pressed.includes('forward'), `backed out to where the blast does nothing: ${pressed.join(',')}`);
});

test('the dance strikes a creeper at reach before it backs off, and holds at reach while the swings left beat the fuse', async () => {
  const registry = require('minecraft-data')('26.1'), keys = registry.entitiesByName.creeper.metadataKeys;
  const creeperAt = (health, lit) => { const metadata = []; metadata[keys.indexOf('health')] = health; metadata[keys.indexOf('swell_dir')] = lit ? 1 : -1; return { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(2.9, 64, 0.5), height: 1.7, width: 0.6, isValid: true, metadata }; };
  const run = async ({ weapon, health, lit }) => {
    const attacked = [], creeper = creeperAt(health, lit);
    const bot = creeperBot({ weapon, health: 20, wall: false, creeper, attacked });
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
    // Seen to light just now (the metadata listener's record).
    if (lit) bot._creeperFuses.set(creeper.id, Date.now());
    const actions = [];
    const report = survival.report.bind(survival);
    survival.report = (goal, save, a) => { actions.push(a.action); return report(goal, save, a); };
    await survival.creeperDance(new Task('x'), {}, () => {}, [{ entity: creeper, distance: 2.4, visible: true }], false, { chosen: true });
    return { attacked, actions };
  };
  // Not lit yet: struck, then backed from (it backed off unstruck before).
  const first = await run({ weapon: 'iron_sword', health: 20, lit: false });
  assert.deepEqual(first.attacked, ['creeper']);
  assert.equal(first.actions.at(-1), 'creeper_back_off');
  // Lit, 14 health left and a diamond sword: one swing after this one, 0.7
  // seconds, inside the fuse: held.
  const held = await run({ weapon: 'diamond_sword', health: 14, lit: true });
  assert.deepEqual(held.attacked, ['creeper']);
  assert.equal(held.actions.at(-1), 'creeper_hold');
  // Lit, full health and an iron sword: three swings more do not fit, so out.
  const out = await run({ weapon: 'iron_sword', health: 20, lit: true });
  assert.equal(out.actions.at(-1), 'creeper_back_off');
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
  // A diamond sword's three swings do not fit in the fuse; with room behind
  // on open ground it goes off where the blast does nothing (note 529).
  assert.match(withCreeper.fight.description, /With the diamond sword, the creeper 4 blocks off takes 3 swings.*about 1\.65 seconds, longer than the fuse, so it goes off first, about 6 blocks off, where the blast does nothing/);
  assert.match(withCreeper.fight.description, /A blast by distance after the armour worn: 43 at point blank, 24 at 2 blocks, 16 at 3 blocks, 10 at 4 blocks/);
  assert.match(withCreeper.creeper_dance.description, /A blast by distance after the armour worn: 43 at point blank, 24 at 2 blocks, 16 at 3 blocks, 10 at 4 blocks/);
  assert.doesNotMatch(withCreeper.creeper_dance.description, /puts its fuse out/, 'a hit does not put the fuse out');
  assert.doesNotMatch(withCreeper.creeper_dance.description, /of them ends? it/, 'gone off six blocks off, no blast to count');
  // mid-215-b: three creepers five to seven blocks off, told of one blast.
  const three = survival.stanceOptions(new Task('x'), {}, () => {}, [t('creeper', 5), t('creeper', 6), t('creeper', 7)], false);
  assert.match(three.creeper_dance.description, /3 creepers are here \(5, 6, 7 blocks off\): the dance hits one at a time/);
  assert.match(withCreeper.retreat.description, /No route is checked yet/);
  const withZombie = Object.keys(survival.stanceOptions(new Task('x'), {}, () => {}, [t('zombie', 4)], false));
  assert(withZombie.includes('pillar'), 'a zombie is climbed away from');
  // mid-92-p: pillared from a wither skeleton and was cut down in four blows.
  const withWither = survival.stanceOptions(new Task('x'), {}, () => {}, [t('wither_skeleton', 6)], false);
  assert.match(withWither.pillar.description, /Two up does not stop a wither skeleton \(is tall enough to hit a player two up\)/);
  // At arm's length building is still Jev's to choose; the description says
  // what it costs, the options are not hidden.
  const atArmsLength = survival.stanceOptions(new Task('x'), {}, () => {}, [t('zombie', 2), t('zombie', 2.8)], false);
  assert(atArmsLength.pillar, Object.keys(atArmsLength).join(','));
  assert.match(JSON.stringify(atArmsLength.pillar.description), /arm's length/);
  assert(atArmsLength.retreat);
});

test('in the Nether with the portal close, going back through it is a stance', async () => {
  // mid-92-q burned among skeletons and ghasts beside its portal, turning between six stances.
  const make = dimension => {
    const bot = Object.assign(new EventEmitter(), { game: { dimension, gameMode: 'survival' }, health: 12, food: 20, entities: {},
      entity: { position: new Vec3(0.5, 64, 0.5) }, registry: require('minecraft-data')('26.1'),
      inventory: { items: () => [{ name: 'diamond_sword' }, { name: 'netherrack', count: 64 }], slots: {} },
      blockAt: p => ({ position: p, name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }), world: { raycast: () => null },
      findBlocks: ({ matching }) => matching === require('minecraft-data')('26.1').blocksByName.nether_portal.id ? [new Vec3(4, 64, 0)] : [] });
    let back = 0;
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {}, returnOverworld: async () => { back++; } }, { state: { shelters: [] } });
    return { survival, count: () => back };
  };
  const t = (name, distance) => ({ entity: { name, position: new Vec3(distance, 64, 0), height: 1.99 }, distance, visible: true });
  const nether = make('the_nether');
  const options = nether.survival.stanceOptions(new Task('x'), {}, () => {}, [t('skeleton', 9), t('skeleton', 12)], false);
  assert(options.portal_back, Object.keys(options).join(','));
  assert.match(options.portal_back.description, /back through the portal 4 blocks off, to the Overworld/);
  await options.portal_back.run();
  assert.equal(nether.count(), 1);
  assert(!make('overworld').survival.stanceOptions(new Task('x'), {}, () => {}, [t('skeleton', 9)], false).portal_back, 'not from the Overworld');
});

test('no pocket is begun where a creeper in sight would reach it before it closed', async () => {
  // mid-92-u dug in with a creeper eight blocks off that had followed it for half a minute, and was blown up at full health.
  const make = distance => {
    const creeper = { id: 4, name: 'creeper', type: 'hostile', position: new Vec3(distance + 0.5, 64, 0.5), height: 1.7, isValid: true };
    const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, entities: { 4: creeper },
      entity: { position: new Vec3(0.5, 64, 0.5) }, registry: require('minecraft-data')('26.1'),
      inventory: { items: () => [{ name: 'cobblestone', count: 64 }], slots: {} },
      blockAt: p => ({ position: p, name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }), world: { raycast: () => null }, findBlocks: () => [] });
    const placed = [];
    const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p}`); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
    return { survival, placed };
  };
  const near = make(8);
  assert.equal(await near.survival.sealHere(new Task('x'), {}, () => {}, []), false, 'eight blocks off: it would go off first');
  assert.deepEqual(near.placed, []);
  const far = make(40);
  await far.survival.sealHere(new Task('x'), {}, () => {}, []);
  assert(far.placed.length > 0, 'forty off: time to build');
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

test('a stance that failed stays on offer with its failure said, not taken off for twenty seconds (note 521)', async () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 20, food: 20,
    inventory: { items: () => [], slots: {} }, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {} });
  const ran = [], trees = [];
  // Knocked off after its blocks went down (a block placed is the stance
  // acting, note 596): one that did nothing is the next test's.
  survival.stanceOptions = () => ({ pillar: { description: 'up', run: async () => { ran.push('pillar'); bot._stalls = { marked: (bot._stalls?.marked || 0) + 2 }; return false; } },
    fight: { description: 'fight', run: async () => { ran.push('fight'); return true; } }, seal: { description: 'seal', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { trees.push(q.tree); return { path: [/Tried/.test(q.tree.pillar?.description || '') ? 'fight' : 'pillar'] }; };
  const danger = [{ entity: { name: 'zombie' }, distance: 2 }];
  assert.equal(await survival.stanceStep(new Task('pack'), {}, () => {}, danger, false), true, 'knocked off the pillar: the tick is spent, the rules do not step in');
  assert.equal(await survival.stanceStep(new Task('pack'), {}, () => {}, danger, false), true);
  assert.deepEqual(ran, ['pillar', 'fight']);
  assert.match(trees[1].pillar.description, /Tried \d+ seconds? ago here, and it failed/, 'the failed pillar is offered with its failure said');
});

test('a stance whose action is resting is a stance that failed, not one held and refused every tick', async () => {
  // mid-235-i: dug down at 6.7 health with its shaft pocket resting, and stood fifteen seconds under a skeleton's arrows.
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 20, food: 20,
    inventory: { items: () => [], slots: {} }, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {} });
  const ran = [], trees = [];
  survival.stanceOptions = () => ({ dig_down: { description: 'down', run: async () => { ran.push('dig_down'); throw Object.assign(new Error('shaft pocket is set aside'), { name: 'SetAside' }); } },
    fight: { description: 'fight', run: async () => { ran.push('fight'); return true; } } });
  survival.decide = async (task, goal, save, q) => { trees.push(q.tree); return { path: [/Tried/.test(q.tree.dig_down?.description || '') ? 'fight' : 'dig_down'] }; };
  const danger = [{ entity: { name: 'skeleton' }, distance: 3 }];
  assert.equal(await survival.stanceStep(new Task('pack'), {}, () => {}, danger, false), true);
  assert.equal(await survival.stanceStep(new Task('pack'), {}, () => {}, danger, false), true);
  assert.deepEqual(ran, ['dig_down', 'fight']);
  assert.match(trees[1].dig_down.description, /Tried \d+ seconds? ago here, and it failed/, 'the resting dig is offered with its failure said');
});

test('a fight that failed for want of reach is offered again once the mob is at reach', async () => {
  // Trial 106: the charge could not climb the stairs to the zombie; it came down to one block, and the bot was offered no fight.
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 12, food: 20,
    inventory: { items: () => [], slots: {} }, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {} });
  const trees = [];
  survival.stanceOptions = () => ({ fight: { description: 'fight', run: async () => true }, pillar: { description: 'up', run: async () => true }, retreat: { description: 'away', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { trees.push(q.tree); return { path: ['retreat'] }; };
  survival.state.stanceFailed = [{ choice: 'fight', kinds: 'zombie', at: Date.now() }];
  await survival.stanceStep(new Task('stairs'), {}, () => {}, [{ entity: { name: 'zombie' }, distance: 5 }], false);
  assert.match(trees[0].fight.description, /Tried \d+ seconds? ago here, and it failed/, 'still out of reach: offered with the failure said');
  delete survival.state.stance;
  await survival.stanceStep(new Task('stairs'), {}, () => {}, [{ entity: { name: 'zombie' }, distance: 1 }], false);
  assert.match(trees[1].fight.description, /a mob is at reach now/, 'at reach: said so');
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
  assert.match(tree.sleep_in_bed.description, /1 monster is within eight blocks sideways and five up or down of the bed now, seen or not: sleep is refused while any are/);
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
  setAside(goal, 'act', 'survival:wait_in_shelter', 'x', 600000);
  survival.report(goal, () => {}, { action: 'wait_in_shelter' });
  assert.equal(goal.survivalAction.action, 'wait_in_shelter');
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
  assert.deepEqual(drop, { blocksAway: 2, fallBlocks: 21, into: 'ground', damage: 18, cell: { x: 2, y: 24, z: 0 } });
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
  const survival = new Survival(bot, { navigate: async (b, t, g) => { moved.push({ x: g.x, y: g.y, z: g.z }); b.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } }, { state: { shelters: [] } });
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

test('a thrown trident flying at the bot is incoming, for the shield', () => {
  // mid-243-i: four drowned throws through iron and a shield never raised.
  const { Vec3 } = require('vec3');
  const { incoming } = require('../src/projectile-guard');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, entities: {
    1: { name: 'trident', position: new Vec3(8, 65.5, 0), velocity: new Vec3(-1.5, 0, 0) } } };
  assert.deepEqual(incoming(bot).map(e => e.name), ['trident']);
});

test('a shot whose velocity has not arrived is incoming once it has moved toward the bot', () => {
  // mid-202-k (note 382): a blaze's fireball seen eight blocks off, struck 1.3 seconds later, no shield raised between.
  const { Vec3 } = require('vec3');
  const { incoming } = require('../src/projectile-guard');
  const fireball = { name: 'small_fireball', position: new Vec3(8, 65.5, 0) };
  const bot = { entity: { position: new Vec3(0, 64, 0) }, entities: { 1: fireball } };
  assert.deepEqual(incoming(bot), [], 'eight blocks off and not yet seen to move: not known to be coming');
  fireball.position = new Vec3(6.5, 65.5, 0);
  assert.deepEqual(incoming(bot).map(e => e.name), ['small_fireball'], 'moved a block and a half nearer since the last look');
  fireball.position = new Vec3(7.5, 65.5, 0);
  assert.deepEqual(incoming(bot), [], 'moving away');
});

test('a held pillar faces the shooter, not the nearest mob, and a shot on its way before either', () => {
  // mid-227-n (note 395): on its pillar the bot faced the spider at its foot while the skeleton shot it through a raised shield.
  const { Vec3 } = require('vec3');
  const { shieldFacing } = require('../src/survival');
  const spider = { entity: { id: 1, name: 'spider', position: new Vec3(1.5, 62, 0.5), isValid: true }, distance: 2, visible: true };
  const skeleton = { entity: { id: 2, name: 'skeleton', position: new Vec3(-9.5, 62, 0.5), isValid: true }, distance: 10, visible: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {} };
  assert.equal(shieldFacing(bot, [spider, skeleton]).name, 'skeleton');
  assert.deepEqual(shieldFacing(bot, [spider, skeleton]).at, skeleton.entity.position.offset(0, 1, 0));
  assert.equal(shieldFacing(bot, [spider]).name, 'spider', 'nothing shoots: the nearest');
  bot.entities[3] = { name: 'arrow', position: new Vec3(0.5, 66, 6.5), velocity: new Vec3(0, 0, -1.2) };
  assert.equal(shieldFacing(bot, [spider, skeleton]).name, 'arrow', 'a shot on its way first');
  // Held on the pillar, the look goes to the shooter.
  const looks = [];
  const world = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal' }, registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 64, 0.5), onGround: true }, entities: {}, health: 14, food: 18,
    inventory: { items: () => [{ name: 'cobblestone', count: 32 }, { name: 'iron_sword' }], slots: { 45: { name: 'shield' } } }, heldItem: { name: 'iron_sword' }, world: { raycast: () => null }, findBlocks: () => [],
    lookAt: async p => looks.push(p), blockAt: p => ({ name: p.y < 64 ? 'cobblestone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }) });
  const survival = new Survival(world, { navigate: async () => {} }, { state: { pillar: { x: 0, y: 62, z: 0 } } });
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [spider, skeleton], false);
  return options.pillar.run().then(() => { assert.deepEqual(looks.at(-1), skeleton.entity.position.offset(0, 1, 0)); });
});

test('a held pillar faces a wither skeleton at arm\'s length whose blow reaches the top, not a blaze twenty blocks off (mid-208-k-nether-3-fortress-2, note 559)', async () => {
  // Held facing the blaze, the bot was struck from behind by the wither skeleton three blocks off on the floor below, 20 to 15.2, and knocked off.
  const { shieldFacing } = require('../src/survival');
  const skeleton = { entity: { id: 1, name: 'wither_skeleton', position: new Vec3(2.5, 62, 1.5), height: 2.4, isValid: true }, distance: 3.1, visible: true };
  const blaze = { entity: { id: 2, name: 'blaze', position: new Vec3(-19.5, 66, 0.5), height: 1.8, isValid: true }, distance: 20, visible: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {} };
  assert.equal(shieldFacing(bot, [skeleton, blaze]).name, 'wither_skeleton');
  bot.entities[3] = { name: 'small_fireball', position: new Vec3(-5.5, 65, 0.5), velocity: new Vec3(1, 0, 0) };
  assert.equal(shieldFacing(bot, [skeleton, blaze]).name, 'wither_skeleton', 'before a fireball on its way too: the blow is the harder and the surer');
  const zombie = { entity: { id: 4, name: 'zombie', position: new Vec3(2.5, 62, 1.5), height: 1.95, isValid: true }, distance: 3.1, visible: true };
  assert.notEqual(shieldFacing(bot, [zombie, blaze]).name, 'zombie', 'a zombie on the floor below does not reach the top: the shot or the shooter');
  const looks = [];
  const world = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', difficulty: 'normal' }, registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 64, 0.5), onGround: true }, entities: {}, health: 20, food: 20,
    inventory: { items: () => [{ name: 'cobblestone', count: 32 }, { name: 'iron_sword' }], slots: { 45: { name: 'shield' } } }, heldItem: { name: 'iron_sword' }, world: { raycast: () => null }, findBlocks: () => [],
    lookAt: async p => looks.push(p), blockAt: p => ({ name: p.y < 62 || (p.x === 0 && p.z === 0 && p.y < 64) ? 'cobblestone' : 'air', position: p, boundingBox: p.y < 62 || (p.x === 0 && p.z === 0 && p.y < 64) ? 'block' : 'empty' }) });
  const survival = new Survival(world, { navigate: async () => {} }, { state: { pillar: { x: 0, y: 62, z: 0 } } });
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [skeleton, blaze], false);
  await options.pillar.run();
  assert.deepEqual(looks.at(-1), skeleton.entity.position.offset(0, 1.2, 0));
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
  const crowd = [crowdMob(1, 'spider', 4.2), crowdMob(2, 'zombie', -3.2), crowdMob(3, 'creeper', 0, 6.4), crowdMob(4, 'skeleton', 6.4), crowdMob(5, 'skeleton', -8.5), crowdMob(6, 'skeleton', 0, -20)];
  const options = survival.stanceOptions(new Task('dusk'), {}, () => {}, crowd, false);
  const priced = /About [\d.]+ damage from the mobs here in the next fifteen seconds this way/;
  // The pillar under a creeper and three skeletons carried no figure, and was taken (mid-110-k).
  assert.match(options.pillar.description, priced);
  assert.match(options.pillar.description, /the 1\.5 seconds of going up included, from 13 health \(more than the bot has\)/);
  assert.match(options.pillar.description, /The creeper 6 blocks off can go off beside the bot in about 2\.6 seconds, after the going up is done: about 21 two blocks off after the armour worn, more than the bot has/);
  assert.match(options.pillar.description, /Two up, the creeper, 3 skeletons and the spider still reach it/);
  assert.match(options.seal.description, priced);
  assert.match(options.seal.description, /seconds of building not done within them/, 'thirty blocks of pocket are not shut in fifteen seconds');
  assert.match(options.fight.description, /about [\d.]+ of it in the first fifteen seconds/);
  assert.match(options.fight.description, /Open ground all round: every biter can be at arm's length at once/);
  // The charge quotes the fight's estimate: what it leaves out is said there too.
  assert.match(options.charge_shooter.description, /A creeper's fuse lights once the bot is within 3 blocks.*With the diamond sword, the creeper 6 blocks off takes 3 swings.*longer than the fuse/);
  assert.match(options.charge_shooter.description, /A blast by distance after the armour worn: 38 at point blank, 21 at 2 blocks/);
  // Down into the stone underfoot: three blocks (walled all round, the roof ring too), a block over the head.
  assert.match(options.dig_down.description, /Dig straight down 3 blocks where the bot stands, put a block over its head and wait inside for the mobs to lose interest/);
  assert.match(options.dig_down.description, priced);
  // Hurt and hungry, a meal is a stance with its bill: the eating alone.
  assert.match(options.eat.description, /Eat the bread now \(3 carried\): about 1\.6 seconds standing still, the hand busy and the shield down, no swing; hunger 14 to 19, then health comes back about one each four seconds/);
  assert.match(options.eat.description, /while it eats, from 13 health\. The mobs are all still here when it is done\./);
  // With nothing close, the hole is shut before any of them arrives.
  const far = survival.stanceOptions(new Task('dusk'), {}, () => {}, [crowdMob(4, 'skeleton', 24), crowdMob(2, 'zombie', 0, 20)], false);
  assert.match(far.dig_down.description, /Shut in below, none of them reaches it/);
  // mid-220-c: a creeper seventeen blocks off walked up to the lid and went off through it.
  const creeper = survival.stanceOptions(new Task('dusk'), {}, () => {}, [crowdMob(4, 'skeleton', 24), crowdMob(3, 'creeper', 0, 17)], false);
  assert.doesNotMatch(creeper.dig_down.description, /none of them reaches it/);
  assert.match(creeper.dig_down.description, /Shut in below, the creeper still reaches it/);
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

test('a stance that failed here is said as failed when the kinds about change, and not once the bot is elsewhere', async () => {
  const bot = crowdBot({ health: 18 });
  const survival = new Survival(bot, { navigate: async () => {} });
  const trees = [];
  survival.stanceOptions = () => ({ pillar: { description: 'up', run: async () => false }, fight: { description: 'fight', run: async () => true }, seal: { description: 'seal', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { trees.push(q.tree); return { path: [/Tried/.test(q.tree.pillar?.description || '') ? 'fight' : 'pillar'] }; };
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [crowdMob(1, 'zombie', 2)], false);
  delete survival.state.stance;
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [crowdMob(1, 'zombie', 2), crowdMob(2, 'skeleton', 9)], false);
  assert.match(trees[1].pillar.description, /Tried .* and it failed/, 'a skeleton come into view: the pillar is said as failed here');
  delete survival.state.stance;
  bot.entity.position = new Vec3(8.5, 64, 0.5);
  await survival.stanceStep(new Task('dusk'), {}, () => {}, [crowdMob(1, 'zombie', 2)], false);
  assert.doesNotMatch(trees[2].pillar.description, /Tried/, 'eight blocks on, it is offered fresh');
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

test('a priority choice that runs into a resting action rests with it and is left out of the question, Jev told why', async () => {
  // first-days-213: secure_shelter chosen thirty times in five seconds, its sealing resting, each run refused at once.
  const { question } = require('../src/decisions');
  const { bot } = nookFixture({ open: p => p.x === 0 && p.z === 0 && p.y >= 30 });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } } });
  const seen = [];
  survival.decide = async (task, goal, save, { id, tree, state }) => { seen.push({ id, keys: Object.keys(tree).sort(), notNow: state.notNow });
    const key = tree.secure_shelter ? 'secure_shelter' : question(id).fallback(tree, []); return { path: [key], action: tree[key], stale: false }; };
  survival.refugeStep = async () => { throw Object.assign(new Error('seal shelter is set aside: Shelter verification failed'), { name: 'SetAside', until: Date.now() + 120000 }); };
  survival.nookSleep = async () => {};
  const goal = { kind: 'win', request: 'beat the game' };
  await survival.step(new Task('night'), goal, () => {});
  await survival.step(new Task('night'), goal, () => {});
  assert(seen[0].keys.includes('secure_shelter'));
  assert(!seen[1].keys.includes('secure_shelter'), 'not offered while it rests');
  assert.match(seen[1].notNow.secure_shelter, /Shelter verification failed; back in about 1\d\d seconds/);
});

test('a stance chosen on an estimate is asked again once it has cost more than it was said to, in health or time', async () => {
  // first-days-219: told 1.3 damage in 3.8 seconds against one skeleton, the fight stood eleven seconds under its ledge, 9.2 health to 2.9.
  const bot = crowdBot({ health: 9.2 });
  const survival = new Survival(bot, { navigate: async () => {} });
  const asked = [];
  survival.stanceOptions = () => ({ fight: { expects: { damage: 1.3, seconds: 3.8, oneHit: 1.4 }, description: 'fight', run: async () => true }, dig_down: { description: 'down', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { asked.push(q.state.previousStance); return { path: ['fight'] }; };
  const skeleton = crowdMob(3, 'skeleton', 5);
  await survival.stanceStep(new Task('cave'), {}, () => {}, [skeleton], false);
  bot.health = 8.0;
  await survival.stanceStep(new Task('cave'), {}, () => {}, [skeleton], false);
  assert.equal(asked.length, 1, 'one arrow in: within its pace and one blow');
  bot.health = 6.5;
  await survival.stanceStep(new Task('cave'), {}, () => {}, [skeleton], false);
  assert.equal(asked.length, 2, 'two arrows in at once: past its pace, asked again, not at six');
  survival.state.stance.at = Date.now() - 5000; bot.health = 7.8; survival.state.stance.health = 7.8;
  await survival.stanceStep(new Task('cave'), {}, () => {}, [skeleton], false);
  assert.equal(asked.length, 3, 'longer than the 3.8 seconds it was said to take: asked again');
});

test('a creeper about is said on the shelter: how soon it could go off beside the bot', () => {
  // first-days-222: chose the shelter with a creeper five blocks off, told only of sealing a room, and was blown up three seconds later.
  const { creeperSays } = require('../src/survival');
  const { bot } = nookFixture();
  bot.entities = { 7: { id: 7, name: 'creeper', type: 'hostile', position: bot.entity.position.offset(5, 0, 0), height: 1.7, isValid: true } };
  assert.match(creeperSays(bot), /A creeper is 5 blocks off: coming on, it could go off beside the bot in about [\d.]+ seconds; a shelter is walled or dug at about 0.6 seconds a block/);
  bot.entities = {};
  assert.equal(creeperSays(bot), '');
});

test('the retreat says a rider on a horse or camel outruns a running player', () => {
  // mid-215-a: ran four times from a zombie on a zombie horse with a spear, caught each time.
  const bot = crowdBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const rider = crowdMob(1, 'zombie', 6);
  rider.entity.vehicle = { name: 'zombie_horse' };
  const options = survival.stanceOptions(new Task('night'), {}, () => {}, [rider], false);
  assert.match(options.retreat.description, /A zombie on a zombie horse is faster than a running player: a run from it is caught/);
  const walker = survival.stanceOptions(new Task('night'), {}, () => {}, [crowdMob(2, 'zombie', 6)], false);
  assert.doesNotMatch(walker.retreat.description, /faster than a running player/);
});

test('every way to shelter says how soon a creeper about could go off, the shaft pocket as well as the room', async () => {
  // mid-211-a: chose the shaft pocket told "done in seconds" with a creeper eight blocks off, and it followed the bot down.
  const { bot } = nookFixture({ time: 14000, open: p => p.x === 0 && p.z === 0 && p.y >= 30 });
  bot.entities = { 7: { id: 7, name: 'creeper', type: 'hostile', position: bot.entity.position.offset(8, 0, 0), height: 1.7, isValid: true } };
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => ({}) } });
  let tree = null;
  survival.decide = async (task, goal, save, q) => { if (q.id === 'shelter_method') tree = q.tree; return { stale: true, path: [] }; };
  try { await survival.refugeStep(new Task('night'), { kind: 'win' }, () => {}); } catch (_) {}
  assert(tree, 'the shelter question was asked');
  for (const key of ['shaft_pocket', 'seal_here'].filter(k => tree[k])) assert.match(tree[key].description, /creeper is 8 blocks off/, key);
  assert(tree.shaft_pocket, 'a shaft pocket is on offer here');
});

test('the shaft pocket says its seconds of digging and the mobs coming at the bot against them, not "done in seconds" (mid-244-a, note 544)', async () => {
  // mid-244-a: ten blocks ahead of four zombies after a run, the shaft pocket was offered as "done in seconds"; its dig outlasted their walk and they bit it to death.
  const { bot } = nookFixture({ time: 16000, items: [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], open: p => p.x === 0 && p.z === 0 && p.y >= 30 });
  bot.health = 13.1; bot.food = 16;
  bot.entities = { 7: { id: 7, name: 'zombie', type: 'hostile', position: bot.entity.position.offset(8, 0, 0), height: 1.95, isValid: true } };
  const track = dx => { const p = bot.entity.position.offset(dx, 0, 0); return new Map([[7, [{ at: Date.now() - 1000, x: p.x, y: p.y, z: p.z }]]]); };
  bot._mobTracks = track(10.3);
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => ({}) } });
  let tree = null, state = null;
  survival.decide = async (task, goal, save, q) => { if (q.id === 'shelter_method') { tree = q.tree; state = q.state; } return { stale: true, path: [] }; };
  try { await survival.refugeStep(new Task('night'), { kind: 'win' }, () => {}); } catch (_) {}
  assert(tree?.shaft_pocket, Object.keys(tree || {}).join(','));
  assert.doesNotMatch(tree.shaft_pocket.description, /done in seconds/);
  assert.match(tree.shaft_pocket.description, /about [\d.]+ seconds of digging and the cap/);
  assert.match(tree.shaft_pocket.description, /Coming at the bot now: the zombie 8 blocks off at about 2\.3 blocks a second; at the bot in about 2\.8 seconds, before the shaft is done/);
  assert.match(tree.shaft_pocket.description, /A biter within three blocks stops the dig part-way/);
  assert.equal(state.comingAtTheBot?.[0]?.name, 'zombie');
  // One standing still is not said to be coming.
  bot._mobTracks = track(8);
  tree = null;
  try { await survival.refugeStep(new Task('night'), { kind: 'win' }, () => {}); } catch (_) {}
  assert.doesNotMatch(tree.shaft_pocket.description, /Coming at the bot/);
});

test('after a retreat, its chasers coming ten blocks back claim the turn for the stance, said with how soon they are at the bot, not the night\'s pocket (mid-244-a, note 544)', () => {
  const { claim } = require('../src/survival');
  const { bot } = nookFixture({ time: 16000, items: [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], open: p => p.y >= 30 });
  bot.health = 13.1; bot.food = 16;
  bot.entities = { 7: { id: 7, name: 'zombie', type: 'hostile', position: bot.entity.position.offset(10, 0, 0), height: 1.95, isValid: true } };
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  bot._stance = { choice: 'retreat', ids: [7], at: Date.now() - 3000, ranAt: Date.now() - 400, health: 14.5, expects: { damage: 0, seconds: 2.5, oneHit: 1.4 } };
  const p = bot.entity.position.offset(12.3, 0, 0);
  bot._mobTracks = new Map([[7, [{ at: Date.now() - 1000, x: p.x, y: p.y, z: p.z }]]]);
  const c = claim(bot, { kind: 'win' }, survival);
  assert.equal(c?.action, 'escape_threat', JSON.stringify(c));
  assert.deepEqual(c.facts.comingAtTheBot, { after: 'retreat', blocksASecond: 2.3, atBotInSeconds: 3.7 });
  // Standing ten blocks off, not coming: the night's own question.
  bot._mobTracks = new Map([[7, [{ at: Date.now() - 1000, x: bot.entity.position.x + 10, y: p.y, z: p.z }]]]);
  assert.notEqual(claim(bot, { kind: 'win' }, survival)?.action, 'escape_threat');
});

test('waiting sealed for daylight says the zombie coming at the bot and how soon, against a shaft pocket dug here (note 544)', async () => {
  const { bot } = nookFixture({ time: 6000, items: [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], open: p => p.y >= 30 });
  bot.health = 6; bot.food = 14; bot.pathfinder = { movements: {}, getPathTo: () => ({ status: 'noPath', path: [] }), setGoal() {} };
  bot.entities = { 7: { id: 7, name: 'zombie', type: 'hostile', position: bot.entity.position.offset(12, 0, 0), height: 1.95, isValid: true } };
  const p = bot.entity.position.offset(14.3, 0, 0);
  bot._mobTracks = new Map([[7, [{ at: Date.now() - 1000, x: p.x, y: p.y, z: p.z }]]]);
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } } });
  let tree = null, state = null;
  survival.decide = async (task, goal, save, q) => { if (q.id === 'survival_priority') { tree = tree || q.tree; state = state || q.state; } return { path: ['continue_request'], action: q.tree.continue_request || Object.values(q.tree)[0], stale: true }; };
  await survival.step(new Task('hurt'), { kind: 'win', request: 'beat the game' }, () => {});
  assert(tree?.wait_for_day_sealed, Object.keys(tree || {}).join(','));
  assert.match(tree.wait_for_day_sealed.description, /Coming at the bot now: the zombie 12 blocks off at about 2\.3 blocks a second; at the bot in about 4\.6 seconds/);
  assert.match(tree.wait_for_day_sealed.description, /a shaft pocket dug here/);
  assert.equal(state.comingAtTheBot?.[0]?.atBotInSeconds, 4.6);
});

test('a stance priced at more than the bot has is still asked again when it runs ahead of its pace, not held to the death', async () => {
  // mid-205-a ate on for four seconds under two zombies and a creeper walking up.
  const bot = crowdBot({ health: 18 });
  const survival = new Survival(bot, { navigate: async () => {} });
  const asked = [];
  survival.stanceOptions = () => ({ dig_down: { expects: { damage: 44, seconds: 15, oneHit: 2 }, description: 'down', run: async () => true }, eat: { description: 'eat', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { asked.push(q.id); return { path: ['dig_down'] }; };
  const zombie = crowdMob(1, 'zombie', 2);
  await survival.stanceStep(new Task('cave'), {}, () => {}, [zombie], false);
  survival.state.stance.at = Date.now() - 1000;
  bot.health = 11;
  await survival.stanceStep(new Task('cave'), {}, () => {}, [zombie], false);
  assert.equal(asked.length, 2, 'seven lost in a second, where 44 over fifteen seconds is about three: asked again');
});

test('no shelter is made under water: the way up comes first', async () => {
  // mid-205-b sealed a pocket under water for nine seconds and drowned.
  const { bot } = nookFixture({ time: 14000 });
  bot.blockAt = p => ({ name: 'water', boundingBox: 'empty', position: p, getProperties: () => ({ level: 0 }), metadata: 0 });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => ({}) } });
  await assert.rejects(survival.refugeStep(new Task('night'), { kind: 'win' }, () => {}), { name: 'NeedsAir' });
});

test('a creeper coming on can be shot with the bow, told the arrows it takes and how soon it is beside the bot', () => {
  // mid-202-a: offered the bow only at a skeleton, a creeper coming on from eight blocks, and was blown up.
  const bot = crowdBot({ items: [{ name: 'bow', count: 1 }, { name: 'arrow', count: 32 }] });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const creeper = crowdMob(4, 'creeper', 8);
  const options = survival.stanceOptions(new Task('night'), {}, () => {}, [creeper], false);
  assert(options.shoot_4, Object.keys(options).join(','));
  assert.match(options.shoot_4.description, /About 4 arrows bring it down.*beside the bot and going off in about [\d.]+ seconds if it keeps coming/);
});

test('a body in lava stops any step at its next breath check, and the way out is not itself stopped', () => {
  // mid-211-b climbed straight up into lava and burned from seventeen to four over nine seconds while the climb went on.
  const { checkAir } = require('../src/vitals');
  const { Vec3 } = require('vec3');
  const bot = { oxygenLevel: 20, entity: { position: new Vec3(0.5, 58, 0.5), eyeHeight: 1.62, height: 1.8, width: 0.6 },
    blockAt: p => ({ name: p.y === 58 ? 'lava' : 'air', boundingBox: 'empty', position: p }) };
  assert.throws(() => checkAir(bot), { name: 'NeedsSafety', message: /lava/ });
  bot._leavingLava = true;
  assert.doesNotThrow(() => checkAir(bot));
});

test('a run at a mob that got no nearer is said with the next question', () => {
  // mid-230-b: three runs at a witch each ended as far off as they began; the fight was offered as if it stood to be struck.
  const { chargeSays } = require('../src/survival');
  const witch = { id: 7, name: 'witch' };
  const bot = { _charges: { 7: { at: Date.now() - 3000, from: 4.7, to: 6.1, name: 'witch' } } };
  assert.match(chargeSays(bot, witch), /last run at the witch, 3 seconds ago, ended 6 blocks off, no nearer than the 5/);
  bot._charges[7] = { at: Date.now() - 3000, from: 6, to: 2, name: 'witch' };
  assert.equal(chargeSays(bot, witch), '', 'a run that closed in says nothing');
  bot._charges[7] = { at: Date.now() - 60000, from: 5, to: 6, name: 'witch' };
  assert.equal(chargeSays(bot, witch), '', 'forgotten after half a minute');
});

test('a stance that moves, held, is not walked back from an edge by the reflex', async () => {
  // mid-208-a: dancing with a creeper four blocks off, the edge reflex walked the bot in the creeper's face; its blast took nine.
  const moved = [];
  const hoglin = { id: 3, name: 'hoglin', position: new Vec3(-6, 64, 0.5), height: 1.4, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20,
    entity: { position: new Vec3(3.5, 64, 0.5), onGround: true }, entities: { 3: hoglin }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'diamond_sword' }], slots: {} }, world: { raycast: () => null }, blockAt: ledgeWorld(),
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {} });
  bot._stance = { choice: 'retreat', at: Date.now(), running: true, health: 20 };
  const survival = new Survival(bot, { navigate: async (b, t, g) => { moved.push(g); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('ledge'), goal, () => {}).catch(() => {});
  assert.notEqual(goal.survivalAction?.action, 'off_the_edge');
});

test('the step back from an edge gives way to the fight once a biter is at arm\'s length', async () => {
  // mid-236-d: the way to a cell a block off stalled three seconds while a zombie walked up and hit it from nine to three.
  const zombie = { id: 3, name: 'zombie', position: new Vec3(3.5, 64, 0.5), height: 1.9, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 9, food: 20,
    entity: { position: new Vec3(5.5, 64, 0.5), onGround: true }, entities: { 3: zombie }, time: { timeOfDay: 18000 },
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, world: { raycast: () => null }, blockAt: ledgeWorld(),
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {} });
  let stopped = null;
  const survival = new Survival(bot, { navigate: async (b, t, g, opts) => { stopped = opts.stopWhen?.(); } }, { state: { shelters: [] } });
  await survival.flee(new Task('ledge'), {}, () => {}).catch(() => {});
  assert.equal(stopped, true, 'the walk is told to stop with the zombie two blocks off');
  const { isSetAside } = require('../src/progress');
  assert.equal(isSetAside(survival, 'firm_ground', 'here'), true, 'and not tried again at once');
});

test('while the stance question is out, the bot backs from a creeper coming on', async () => {
  // mid-231-a: stood still four seconds waiting for the answer with a creeper eight blocks off, and was blown up.
  const creeper = { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(4.5, 64, 0.5), height: 1.7, isValid: true };
  const held = new Set();
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0 },
    entities: { 7: creeper }, health: 20, food: 20, registry: require('minecraft-data')('26.1'), world: { raycast: () => null },
    inventory: { items: () => [], slots: {} }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }),
    setControlState(k, v) { if (v) held.add(k); }, getControlState: () => false, lookAt: async () => {} });
  const survival = new Survival(bot, { navigate: async () => {} });
  survival.stanceOptions = () => ({ fight: { description: 'fight', run: async () => true }, retreat: { description: 'run', run: async () => true } });
  survival.decide = () => new Promise(resolve => setTimeout(() => resolve({ path: ['fight'] }), 400));
  await survival.stanceStep(new Task('pack'), {}, () => {}, [{ entity: creeper, distance: 4, visible: true }], false);
  assert(held.has('back'), `backed while Jev thought: ${[...held]}`);
});

test('a creeper that comes on while the pocket is walled stops the walling', async () => {
  // mid-226-c: walled itself in for five seconds at night while a creeper walked up; one blast from twenty.
  const creeper = { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(40.5, 64, 0.5), height: 1.7, isValid: true };
  let placed = 0;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 7: creeper },
    registry: require('minecraft-data')('26.1'), world: { raycast: () => null }, health: 20, food: 20,
    inventory: { items: () => [{ name: 'dirt', count: 64 }] },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }) });
  const state = { shelters: [{ origin: { x: 0, y: 64, z: 0 }, dimension: 'overworld' }] };
  const controller = new Survival(bot, { navigate: async () => {},
    place: async () => { placed++; if (placed === 2) creeper.position = new Vec3(3.5, 64, 0.5); } }, { state });
  const goal = { survival: state };
  await controller.refugeStep(new Task('night'), goal, () => {});
  assert.equal(placed, 2, `stopped once the creeper came on (${placed} placed)`);
  assert.equal(goal.survivalAction?.action, 'seal_failed');
  // mid-202-j: stopped a hundred times a second; the pocket here is set aside a moment instead.
  delete goal.survivalAction;
  assert.equal(await controller.refugeStep(new Task('night'), goal, () => {}), false);
  assert.equal(placed, 2, 'not begun again');
  assert.notEqual(goal.survivalAction?.action, 'seal_shelter', 'and not reported as begun (mid-231-l spun on the report)');
});

test('up on its own pillar, the step back from the edge does not take the bot off it', async () => {
  // mid-205-e: pillared among five zombies, stepped back off the edge into them each time it was up.
  const zombie = { id: 3, name: 'zombie', position: new Vec3(-1.5, 65, 0.5), height: 1.9, isValid: true };
  // Ground at y 64, a one-block pillar at (0,65,0), and a shaft beside it at x 1.
  const blockAt = p => (p.x === 0 && p.z === 0 && p.y <= 65) || (p.y < 65 && !(p.x === 1 && p.z === 0)) ? { name: 'cobblestone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20,
    entity: { position: new Vec3(0.5, 66, 0.5), onGround: true }, entities: { 3: zombie }, time: { timeOfDay: 18000 },
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, world: { raycast: () => null }, blockAt,
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {} });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [], pillar: { x: 0, y: 65, z: 0, at: Date.now() } } });
  const goal = {};
  await survival.flee(new Task('pillar'), goal, () => {}).catch(() => {});
  assert.notEqual(goal.survivalAction?.action, 'off_the_edge');
});

test('at the edge of its pillar\'s top, its feet floored over the air beside, the bot is still on its pillar and not stepped off (mid-242-a, note 535)', async () => {
  const { onPillarTop } = require('../src/survival');
  const zombie = { id: 3, name: 'zombie', position: new Vec3(-1.5, 65, 0.5), height: 1.9, isValid: true };
  const blockAt = p => (p.x === 0 && p.z === 0 && p.y <= 65) || (p.y < 65 && !(p.x === 1 && p.z === 0)) ? { name: 'cobblestone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  // x 1.15: the body's edge over the top at x 0, the feet's cell the shaft.
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20,
    entity: { position: new Vec3(1.15, 66, 0.5), onGround: true, width: 0.6 }, entities: { 3: zombie }, time: { timeOfDay: 18000 },
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, world: { raycast: () => null }, blockAt,
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {} });
  const pillar = { x: 0, y: 65, z: 0, at: Date.now() };
  assert(onPillarTop(bot, pillar, 1));
  assert(!onPillarTop({ entity: { position: new Vec3(1.35, 66, 0.5), width: 0.6 } }, pillar, 1), 'past the body\'s width: off it');
  assert(!onPillarTop(bot, pillar, 2), 'one up is not two');
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [], pillar } });
  const goal = {};
  await survival.flee(new Task('pillar'), goal, () => {}).catch(() => {});
  assert.notEqual(goal.survivalAction?.action, 'off_the_edge');
});

test('the shelter kept is offered with whether a way to it from here was found, and the walk reads that search (mid-242-a, note 535)', async () => {
  const { Survival } = require('../src/survival');
  let tree, state, searches = 0;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, time: { timeOfDay: 20000, age: 100000 },
    entities: {}, entity: { position: new Vec3(0.5, 64, 0.5) }, health: 17.4, food: 16, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'cobblestone', count: 64 }], slots: {} }, heldItem: null,
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => { searches++; return { status: 'noPath', path: [] }; } },
    blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }), findBlocks: () => [], chat() {},
    world: { raycast: () => null } });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} },
    { client: { systemOne: async () => ({}) }, state: { shelters: [{ origin: { x: 15, y: 64, z: 0 }, dimension: 'overworld', verifiedAt: 'x', createdAt: 'x' }] } });
  survival.decide = async (task, goal, save, q) => { tree = q.tree; state = q.state; return { path: ['continue_request'], action: { run: async () => {} }, stale: false }; };
  await survival.step(new Task('t', 'night'), { kind: 'win', request: 'beat the game' }, () => {});
  assert.match(tree.secure_shelter.description, /The shelter used before, 15 blocks off, has no way to it from here \(a route search found none\)/);
  assert.equal(state.survivalFacts.shelterWayFromHere, 'none found');
  const asked = searches;
  const refuge = survival.state.shelters[0];
  assert.equal(await survival.reachableRefuge(new Task('night'), {}, () => {}, refuge), null, 'chosen, the walk reads the same search');
  assert.equal(searches, asked, 'and does not search again');
  assert.equal(await survival.reachableRefuge(new Task('night'), {}, () => {}, { ...refuge, avoidUntil: 0 }), null);
  assert.equal(searches, asked + 1, 'read once: a later walk searches afresh');
});

test('on a one-wide span over the lava sea, a hoglin at arm\'s length is struck crouched and still, with no jump and no key down', async () => {
  // mid-215-e: a swing at a hoglin behind it turned it about on its span, and the crossing walked it off the far end into the lava sea (note 273).
  const { onSpan } = require('../src/terrain');
  const { defendNearby } = require('../src/combat');
  const { deflect } = require('../src/projectile-guard');
  // A span one block wide along x at y 64, over the lava sea at y 40 and below.
  const span = p => { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    return y === 64 && z === 0 && x >= -10 && x <= 10 ? { position: p, name: 'netherrack', boundingBox: 'block' }
      : y <= 40 ? { position: p, name: 'lava', boundingBox: 'empty' } : { position: p, name: 'air', boundingBox: 'empty' }; };
  const hoglin = { id: 3, name: 'hoglin', type: 'hostile', position: new Vec3(-1.5, 65, 0.5), height: 1.4, width: 1.4, isValid: true };
  const arrow = { id: 9, name: 'arrow', position: new Vec3(0.5, 66.5, 5.5), velocity: new Vec3(0, 0, -1), isValid: true };
  const attacks = [], looks = [], keys = {};
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entity: { position: new Vec3(0.5, 65, 0.5), onGround: true, height: 1.8 }, entities: { 3: hoglin, 9: arrow }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'iron_sword', type: 1 }], slots: { 45: { name: 'shield' } } }, world: { raycast: () => null }, blockAt: span,
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() { for (const k of Object.keys(keys)) keys[k] = false; },
    setControlState(k, v) { keys[k] = v; }, getControlState: k => !!keys[k], activateItem() {}, deactivateItem() {},
    lookAt: async p => { looks.push(p); }, look: async () => { looks.push('look'); }, equip: async () => {}, attack: e => attacks.push(e) });
  assert.equal(onSpan(bot), true, 'open air over lava on both sides');
  // The crit's jump would let the sneak go; on the span the swing is plain.
  bot.entity.onGround = true; const jumps = []; const set = bot.setControlState; bot.setControlState = (k, v) => { if (k === 'jump' && v) jumps.push(k); set(k, v); };
  assert.equal(await defendNearby(bot, new Task('span'), {}, () => {}), true, 'struck where it stands');
  assert.deepEqual([attacks.length, jumps, keys.sneak, keys.forward || false, keys.back || false], [1, [], true, false, false], 'one plain swing, crouched, no jump, no walking');
  attacks.length = 0; looks.length = 0; bot._defenseAttackAt = 0;
  assert.equal(await deflect(bot, new Task('span'), { holdMs: 50 }), false, 'the hoglin at arm\'s length comes before the shot');
  const survival = new Survival(bot, { navigate: async () => { throw new Error('not walked from a span'); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'defend', 'held on the span, and the hoglin struck from there');
  assert.equal(attacks.length, 1); assert.equal(keys.sneak, true);
  // Laying a span is being on one; on wide ground the reflexes are back.
  const wide = p => Math.floor(p.y) === 64 ? { position: p, name: 'netherrack', boundingBox: 'block' } : { position: p, name: 'air', boundingBox: 'empty' };
  assert.equal(onSpan({ entity: bot.entity, blockAt: wide }), false);
  assert.equal(onSpan({ entity: bot.entity, blockAt: wide, _spanning: { since: Date.now() } }), true);
  bot.blockAt = wide;
  assert.equal(await defendNearby(bot, new Task('ground'), {}, () => {}), true, 'the swing, on firm ground');
});

test('food in the Nether is a hoglin as well as the trip back, and the trip stays offered once Jev chose to go on without it, said with when and at what health (note 607)', () => {
  // mid-211-c, short of food in the Nether, was offered only the portal back, 250 blocks off and lost (note 241).
  const { setAside } = require('../src/progress');
  const registry = require('minecraft-data')('26.1');
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'the_nether' }, health: 18, food: 6, entity: { position: new Vec3(0.5, 64, 0.5) },
    entities: { 3: { id: 3, name: 'hoglin', position: new Vec3(10.5, 64, 0.5), isValid: true, height: 1.4 } }, world: { raycast: () => null },
    inventory: { items: () => [], slots: [] } });
  const state = { shelters: [] }, goal = { survival: state };
  const survival = new Survival(bot, { navigate: async () => {}, returnOverworld: async () => {} }, { state });
  let children = survival.offWorldFood(new Task('food'), goal, () => {});
  assert.deepEqual(Object.keys(children).sort(), ['hoglin_food', 'return_for_food']);
  assert.match(children.hoglin_food.description, /1 in view within thirty-two blocks, the nearest 10 blocks off/);
  children.hoglin_food.run();
  assert.equal(state.nightPlan.kind, 'hoglin'); assert(state.nightPlan.food, 'a hunt for food, not ended by daylight or the Nether');
  setAside(goal, 'nether_return', 'food', require('../src/nether-travel').keepOnWhy({ health: 10.1, food: 17 }), 60000);
  children = survival.offWorldFood(new Task('food'), goal, () => {});
  assert.deepEqual(Object.keys(children).sort(), ['hoglin_food', 'return_for_food']);
  assert.match(children.return_for_food.description, /Jev chose under a minute ago, at 10\.1 health, to go on in the Nether without this trip for twenty minutes; health is 18 now\.$/);
});

test('underground at night nothing is asked until two nights awake, and then staying up says underground, not outside', async () => {
  const { Survival, SLEEP_DEBT_TICKS } = require('../src/survival');
  const seen = [];
  // A mined corridor at y 20: rock overhead, the two body cells open.
  const open = p => p.y >= 20 && p.y <= 21 && Math.floor(p.z) === 0;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival', minY: -64, height: 384 }, entities: {}, time: { timeOfDay: 14000, age: 100000 },
    entity: { position: new Vec3(0.5, 20, 0.5) }, health: 20, food: 20, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'cobblestone', count: 64 }], slots: {} }, heldItem: null, pathfinder: { movements: {}, setGoal() {} },
    blockAt: p => ({ name: open(p) || p.y > 80 ? 'air' : 'stone', boundingBox: open(p) || p.y > 80 ? 'empty' : 'block', position: p }), findBlocks: () => [], world: { raycast: () => null }, chat() {} });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => ({}) } });
  survival.decide = async (task, goal, save, { tree }) => { seen.push(tree); return { path: ['continue_request'], action: tree.continue_request, stale: false }; };
  const goal = { kind: 'win', request: 'beat the game' };
  assert.equal(await survival.step(new Task('t', 'night'), goal, () => {}), false, 'the work goes on');
  assert.equal(seen.length, 0, 'no night question underground');
  bot.time.age += SLEEP_DEBT_TICKS + 1;
  await survival.step(new Task('t', 'night'), goal, () => {});
  assert.equal(seen.length, 1, 'two nights awake: the night is a question again');
  assert.match(seen[0].continue_request.description, /keep on with the request underground/);
  assert.doesNotMatch(seen[0].continue_request.description, /outside/);
});

test('"carry on" by day is held like a food trip: not asked again every step, and asked again once hunger falls two', async () => {
  const { Survival } = require('../src/survival');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, entities: {}, time: { timeOfDay: 3000 },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 18, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, heldItem: null, pathfinder: { movements: {}, setGoal() {} },
    blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }), findBlocks: () => [], world: { raycast: () => null }, chat() {} });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => ({}) } });
  let asked = 0;
  survival.decide = async (task, goal, save, { tree }) => { asked++; return { path: ['continue_request'], action: tree.continue_request, stale: false }; };
  const goal = { kind: 'win', request: 'beat the game' };
  for (let i = 0; i < 3; i++) assert.equal(await survival.step(new Task('t', 'food'), goal, () => {}), false);
  assert.equal(asked, 1, 'asked once, then held');
  bot.food = 16;
  await survival.step(new Task('t', 'food'), goal, () => {});
  assert.equal(asked, 2, 'hunger fell two: asked again');
});

test('a mob nine blocks off does not hide the bed: sleep is offered with the monsters by it counted, and worn kit is said beside armed-and-armoured', async () => {
  const { Survival } = require('../src/survival');
  let seen;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, time: { timeOfDay: 13000, age: 100000 },
    entities: { 50: { id: 50, name: 'zombie', position: new Vec3(9.5, 64, 0.5), height: 1.95, isValid: true } },
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'white_bed', count: 1 }, { name: 'iron_sword' }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } } }, heldItem: { name: 'iron_sword' },
    blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }), findBlocks: () => [], world: { raycast: () => null }, chat() {} });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => ({}) } });
  survival.decide = async (task, goal, save, q) => { seen = q; return { path: ['secure_shelter'], action: { run: async () => {} }, stale: false }; };
  await survival.step(new Task('t', 'night'), { kind: 'win', request: 'beat the game' }, () => {});
  assert(seen.tree.sleep_in_bed, Object.keys(seen.tree).join(','));
  assert.doesNotMatch(seen.tree.sleep_in_bed.description, /monster/, 'nine blocks off is outside the eight that refuse a sleep');
  assert.deepEqual(seen.state.survivalFacts.armourWorn, ['iron_helmet', 'iron_chestplate']);
  assert.equal(seen.state.survivalFacts.weapon, 'iron_sword');
});

test('walking off a deadly edge from a skeleton, an arrow on its way stops the walk and the shield comes up to it', async () => {
  // mid-243-e: half a block in a second and a half from a forty-block edge, and a skeleton's arrow put it over, shield in hand (2026-09-27).
  const world = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x >= 6 && y > 22) return { position: p, name: 'air', boundingBox: 'empty' };
    if (y <= 63) return { position: p, name: 'stone', boundingBox: 'block' };
    return { position: p, name: 'air', boundingBox: 'empty' };
  };
  const skeleton = { id: 4, name: 'skeleton', type: 'hostile', position: new Vec3(0.5, 64, 0.5), height: 1.99, isValid: true };
  const arrow = { id: 9, name: 'arrow', position: new Vec3(2.5, 65.5, 0.5), velocity: new Vec3(1, 0, 0), isValid: true };
  let raised = false, stopped = null;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 17,
    entity: { position: new Vec3(4.5, 64, 0.5), onGround: true, height: 1.8 }, entities: { 4: skeleton }, time: { timeOfDay: 14000 },
    inventory: { items: () => [{ name: 'iron_sword' }], slots: { 45: { name: 'shield' } } }, world: { raycast: () => null }, blockAt: world,
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {},
    activateItem() { raised = true; }, deactivateItem() {} });
  const survival = new Survival(bot, { navigate: async (b, t, g, opts) => { bot.entities[9] = arrow; stopped = opts.stopWhen?.() ?? null; } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('edge'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'off_the_edge');
  assert.equal(stopped, true, 'the walk is told to stop for the shot');
  assert.equal(raised, true, 'and the shield comes up to it');
});

test('a stance is asked and run from the ground: mid-jump the bot lands first, so its cells are not measured a block high', async () => {
  // mid-239-b: the swing's jump put the feet a block high each time the pillar was chosen, and the pillar's own headroom check refused it.
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64.8, 0.5), onGround: false }, entities: {}, health: 12, food: 20,
    inventory: { items: () => [], slots: {} }, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) });
  setTimeout(() => { bot.entity.position = new Vec3(0.5, 64, 0.5); bot.entity.onGround = true; }, 250);
  const survival = new Survival(bot, { navigate: async () => {} });
  let measuredAt = null;
  survival.stanceOptions = () => { measuredAt = bot.entity.position.y; return { pillar: { description: 'up', run: async () => true }, retreat: { description: 'away', run: async () => true } }; };
  survival.decide = async () => ({ path: ['pillar'] });
  await survival.stanceStep(new Task('jump'), {}, () => {}, [{ entity: { name: 'zombie', id: 1 }, distance: 2 }], true);
  assert.equal(measuredAt, 64, 'measured once landed');
});

test('the pillar says when the mobs stand above the bot\'s feet: two up is within their reach', () => {
  // mid-239-b pillared at the foot of its stairs with the zombies coming down them (2026-09-27).
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal' }, registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 9, 0.5), onGround: true }, entities: {}, health: 17, food: 18,
    inventory: { items: () => [{ name: 'cobblestone', count: 32 }, { name: 'iron_sword' }], slots: {} }, heldItem: { name: 'iron_sword' }, world: { raycast: () => null }, findBlocks: () => [],
    blockAt: p => ({ name: p.y < 9 ? 'stone' : 'air', position: p, boundingBox: p.y < 9 ? 'block' : 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {} });
  const zombie = (id, y, z) => ({ entity: { id, name: 'zombie', position: new Vec3(0.5, y, z), height: 1.95, isValid: true }, distance: Math.hypot(z - 0.5, y - 9), visible: true });
  const stairs = survival.stanceOptions(new Task('t'), {}, () => {}, [zombie(1, 11, 3.5), zombie(2, 12, 4.5)], false);
  assert.match(stairs.pillar.description, /2 of the mobs stand a block or more above the bot's feet \(2 up, 4 off; 3 up, 5 off\): two up is within reach of them/);
  const level = survival.stanceOptions(new Task('t'), {}, () => {}, [zombie(1, 9, 3.5)], false);
  assert.doesNotMatch(level.pillar.description, /above the bot's feet/);
});

test('at the foot of a shaft open onto a tunnel, the mobs drop into the bot\'s own cells: the fight is not one at a time, and the pillar and the pocket say what a body in its cells does', () => {
  // mid-229-r (note 526): dug down from a tunnel, three zombies came down into its cell; the fight was priced one at a time (3.5 damage),
  // then the pillar and the pocket were offered as "none of them reaches it" five times, and none placed a block.
  const openAt = p => (p.x === 0 && p.z === 0 && p.y >= 9 && p.y <= 12) || (p.x === 0 && p.z >= 1 && p.z <= 6 && (p.y === 11 || p.y === 12));
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal' }, registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 9, 0.5), onGround: true }, entities: {}, health: 20, food: 18,
    inventory: { items: () => [{ name: 'cobblestone', count: 32 }, { name: 'iron_sword' }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } } },
    heldItem: { name: 'iron_sword' }, world: { raycast: () => null }, findBlocks: () => [],
    blockAt: p => { const q = p.floored ? p.floored() : p; return openAt(q) ? { name: 'air', position: q, boundingBox: 'empty' } : { name: 'stone', position: q, boundingBox: 'block' }; } });
  const survival = new Survival(bot, { navigate: async () => {} });
  const zombie = (id, x, y, z) => ({ entity: { id, name: 'zombie', position: new Vec3(x, y, z), height: 1.95, width: 0.6, isValid: true }, distance: Math.hypot(x - 0.5, y - 9, z - 0.5), visible: true });
  // In the tunnel, coming: all three can be on the bot at once.
  const coming = survival.stanceOptions(new Task('t'), {}, () => {}, [zombie(1, 0.5, 11, 2.5), zombie(2, 0.5, 11, 3.5), zombie(3, 0.5, 11, 4.5)], false);
  assert.doesNotMatch(coming.fight.description, /at most 0 at arm's length/);
  assert.match(coming.fight.description, /the column over the bot is open 2 up onto ground beside it at \(0, 11, 1\): mobs walk to its edge and drop in, into the bot's own cells, as many as come/);
  const damage = Number(coming.fight.description.match(/and ([\d.]+) damage to kill them all/)[1]);
  assert(damage > 5, `three at once, not one at a time: ${damage}`);
  assert.match(coming.pillar.description, /The column over the bot opens onto ground 2 up at \(0, 11, 1\): two up is level with it/);
  assert.doesNotMatch(coming.pillar.description, /none of them reaches it/);
  // In its cell: the pillar's block has nowhere to go, and the pocket shuts them in with it.
  const inCell = survival.stanceOptions(new Task('t'), {}, () => {}, [zombie(1, 0.5, 9, 0.5), zombie(2, 0.7, 9, 0.7), zombie(3, 0.3, 9, 0.3)], false);
  assert.match(inCell.pillar.description, /3 zombies stand in the bot's own cells with it: the pillar's first block goes into the cell under the bot's feet, and no block goes where a body is, so it does not rise while they stay there/);
  assert.match(inCell.pillar.description, /Not up while they stand there, 3 zombies still reach it/);
  assert.match(inCell.seal.description, /3 zombies stand in the bot's own cells with it: they are inside the pocket, and closed, it shuts them in with the bot/);
  assert.doesNotMatch(inCell.seal.description, /none of them reaches it/);
  assert.match(inCell.fight.description, /3 zombies stand in the bot's own cells with it, at arm's length whatever the cells round it hold/);
  // One of three in its cell: the one shut in with it is said, not the kind.
  const one = survival.stanceOptions(new Task('t'), {}, () => {}, [zombie(1, 0.5, 9, 0.5), zombie(2, 0.5, 11, 2.5), zombie(3, 0.5, 11, 3.5)], false);
  // And the one at the shaft's lip 2.8 blocks off can drop in before the
  // lid's 0.6 seconds are done (note 581): it is in with the bot too; the
  // one behind it at 3.6 finds the lid on.
  assert.match(one.seal.description, /A zombie stands in the bot's own cells with it: it is inside the pocket, and closed, it shuts it in with the bot\..*Shut in, 2 zombies still reach it\./);
});

test('in water with a drowned, the stances say so, no pillar, pocket or bunker is offered, and getting out of the water is', () => {
  // mid-227-d fell into a flooded pit, chose the fight, the pillar and the bunker while it sank, and was drowned-and-hit to nothing (2026-09-27).
  const water = p => p.y >= 10 && p.y <= 20 && Math.abs(p.x) <= 4 && Math.abs(p.z) <= 4;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal' }, registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 15, 0.5), isInWater: true }, entities: {},
    health: 14, food: 17, oxygenLevel: 12, inventory: { items: () => [{ name: 'cobblestone', count: 32 }, { name: 'iron_sword' }], slots: { 5: { name: 'iron_helmet' } } }, heldItem: { name: 'iron_sword' },
    world: { raycast: () => null }, findBlocks: () => [],
    blockAt: p => { const q = p.floored ? p.floored() : p; return water(q) ? { name: 'water', position: q, boundingBox: 'empty' } : { name: 'stone', position: q, boundingBox: 'block' }; } });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} });
  const drowned = { entity: { id: 1, name: 'drowned', position: new Vec3(2.5, 15, 0.5), height: 1.95, isValid: true }, distance: 2, visible: true };
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [drowned], false);
  for (const k of ['pillar', 'seal', 'bunker', 'dig_down']) assert.equal(options[k], undefined, k);
  assert(options.get_out_of_water, Object.keys(options).join(','));
  assert.match(options.get_out_of_water.description, /in water, air 12 of 20.*sinks unless it swims.*The drowned swims faster than the bot in water/);
  assert.match(options.fight.description, /The bot is in water/);
  assert.match(options.get_out_of_water.description, /No dry landing near the water's level is in view within sixty-four blocks: nothing to swim for/);
  // A pillager on the bank (notes 367, 388): the bank out of its sight is said, and the swim for shore is run as the stance, the pillager passed with it.
  const pillager = { entity: { id: 2, name: 'pillager', position: new Vec3(8.5, 16, -6.5), height: 1.95, isValid: true }, distance: 10, visible: true };
  // Two banks at the water's surface (y 20 here): one at z 0 in the pillager's sight, one at z 6 behind the bank.
  const bank = new Set(['6,20,0', '6,21,0', '6,20,6', '6,21,6']);
  const ground = bot.blockAt;
  bot.blockAt = p => { const q = p.floored ? p.floored() : p; return bank.has(`${q.x},${q.y},${q.z}`) ? { name: 'air', position: q, boundingBox: 'empty' } : ground(p); };
  bot.findBlocks = ({ useExtraInfo } = {}) => [new Vec3(6, 19, 0), new Vec3(6, 19, 6)].map(p => ({ position: p })).filter(b => !useExtraInfo || useExtraInfo(b)).map(b => b.position);
  bot.world.raycast = (from, dir, len) => { const to = from.plus(dir.scaled(len)); return to.z > 3 ? { intersect: from.plus(dir.scaled(2)) } : null; };
  const shot = survival.stanceOptions(new Task('t'), {}, () => {}, [drowned, pillager], false);
  assert.match(shot.get_out_of_water.description, /The nearest bank out of the shooter's sight is 9 blocks off \(the nearest bank of all, 7 off, is in their sight\); it is swum for first, shot at on the way, and behind it they cannot hit the bot/);
});

test('getting out of the water says the bank as far as the swim looks, and prices the swim under fire', () => {
  // mid-215-j (note 501): told only that no bank was within thirty-two blocks; it was 35 off, some 17 seconds of swimming, and a drowned's trident took 4.5 every two seconds from 15.5 health.
  const sea = p => p.y >= 53 && p.y <= 62 && p.z > -35;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal' }, registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 61.5, 0.5), isInWater: true }, entities: {},
    health: 15.5, food: 18, oxygenLevel: 20, inventory: { items: () => [{ name: 'cobblestone', count: 64 }, { name: 'iron_sword' }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } },
    heldItem: { name: 'iron_sword' }, world: { raycast: () => null },
    blockAt: p => { const q = p.floored ? p.floored() : p; return sea(q) ? { name: 'water', position: q, boundingBox: 'empty' } : q.y <= 62 ? { name: 'stone', position: q, boundingBox: 'block' } : { name: 'air', position: q, boundingBox: 'empty' }; } });
  // The bank's top row at z -35, y 62: found only by a search that looks past thirty-two blocks.
  bot.findBlocks = ({ maxDistance, useExtraInfo }) => [-1, 0, 1].map(x => new Vec3(x, 62, -35)).filter(p => p.distanceTo(bot.entity.position) <= maxDistance)
    .map(p => ({ position: p })).filter(b => !useExtraInfo || useExtraInfo(b)).map(b => b.position);
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} });
  const drowned = { entity: { id: 1, name: 'drowned', position: new Vec3(5, 55, -15), height: 1.95, isValid: true, heldItem: { name: 'trident' } }, distance: 20, visible: true };
  const says = survival.stanceOptions(new Task('t'), {}, () => {}, [drowned], false).get_out_of_water.description;
  assert.match(says, /Every dry landing in view within sixty-four blocks is in the shooters' sight; the nearest is 36 blocks off/);
  assert.match(says, /The swim to it is about 18 seconds at the surface \(about 2 blocks a second\), toward the drowned\. About (\d+(\.\d)?) damage from the mobs here over the swim, from 15\.5 health \(more than the bot has\)/);
});

test('on a one-wide ledge with a zombie close, the open sides are walled before anything else: knockback there is the fall', async () => {
  // mid-230-f held still on a ravine ledge at y -28 with zombies at arm's length and was knocked twenty-three blocks down (2026-09-27).
  const placed = new Set();
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, health: 10, food: 18,
    entities: { 3: { id: 3, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 64, 3.5), height: 1.95, isValid: true } }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'cobblestone', count: 32 }, { name: 'iron_sword' }], slots: {} }, world: { raycast: () => null },
    // A ledge one wide along z at y 63, open air to the bottom on both sides.
    blockAt: p => { const q = p.floored(); const solid = placed.has(`${q}`) || (q.y === 63 && q.x === 0); return { name: solid ? 'stone' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, attack() {}, equip: async () => {}, activateItem() {}, deactivateItem() {} });
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, t, p) => { placed.add(`${p}`); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('ledge'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'rail_span');
  for (const x of [1, -1]) {
    assert(placed.has(`${new Vec3(x, 63, 0)}`), `the floor beside at x ${x}`);
    assert(placed.has(`${new Vec3(x, 64, 0)}`), `and the wall on it at x ${x}`);
  }
  assert.equal(require('../src/terrain').onSpan(bot), false, 'no longer a ledge');
});

test('open water on both sides is swimming, not a ledge: no hold on a span there', () => {
  // mid-231-f was held still and crouched in the sea with a drowned, sinking while it was hit (2026-09-27).
  const { onSpan, dropAt } = require('../src/terrain');
  const sea = p => { const q = p.floored(); return { name: q.y <= 62 && q.y >= 40 ? 'water' : q.y < 40 ? 'sand' : 'air', position: q, boundingBox: q.y < 40 ? 'block' : 'empty' }; };
  const bot = { entity: { position: new Vec3(0.5, 61.4, 0.5) }, blockAt: sea };
  assert.equal(onSpan(bot), false);
  assert.equal(dropAt(bot, new Vec3(1, 61, 0)), false, 'water beside is no drop');
  // A ledge over water is no drop either: the fall into it does not hurt.
  const ledge = { entity: { position: new Vec3(0.5, 70, 0.5) }, blockAt: p => { const q = p.floored(); return q.x === 0 && q.y === 69 ? { name: 'stone', position: q, boundingBox: 'block' } : q.y <= 67 ? { name: 'water', position: q, boundingBox: 'empty' } : { name: 'air', position: q, boundingBox: 'empty' }; } };
  assert.equal(onSpan(ledge), false);
});

test('no charge at a creeper, even in a fight Jev chose: a run at one ends beside it as it lights', async () => {
  // mid-242-e's held fight ran at a creeper eight blocks off twice: twenty to one, then seven to dead (2026-09-27).
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 65, 0.5) }, entities: {}, health: 20,
    inventory: { items: () => [{ name: 'iron_sword' }], slots: {} }, pathfinder: { movements: {} },
    blockAt: p => { const f = p.floored(); return { name: f.y < 65 ? 'stone' : 'air', position: f, boundingBox: f.y < 65 ? 'block' : 'empty' }; } });
  let walked = 0;
  const survival = new Survival(bot, { navigate: async () => { walked++; } });
  survival.report = () => {};
  const creeper = { entity: { id: 2, name: 'creeper', position: new Vec3(6.5, 65, 0.5), height: 1.7 }, distance: 6 };
  assert.equal(await survival.charge(new Task('t'), {}, () => {}, creeper, false, { chosen: true }), false);
  assert.equal(walked, 0);
});

test('a pocket beside a drop walls the drop side first, from the bottom: a hit while it goes up throws the bot a block', async () => {
  // mid-242-e sealed beside a hole with zombies at arm's length and was knocked twenty-two blocks down before that side was walled (2026-09-27).
  const hole = p => p.x === 1 && p.z === 0 && p.y >= 40;
  const placed = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 17, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5) }, registry: require('minecraft-data')('26.1'), inventory: { items: () => [{ name: 'cobblestone', count: 64 }], slots: {} },
    blockAt: p => { const q = p.floored(); const solid = placed.includes(`${q}`) || (q.y < 64 && !hole(q)); return { position: q, name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty' }; },
    world: { raycast: () => null }, findBlocks: () => [] });
  const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p}`); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  await survival.sealHere(new Task('x'), {}, () => {}, []);
  assert(placed.length > 2, placed.join(' '));
  assert(/^\(1, 6[34], 0\)$/.test(placed[0]), `the hole's side first: ${placed.slice(0, 3).join(' ')}`);
});

test('no shaft pocket is dug while a creeper would reach the open shaft before the cap', async () => {
  // mid-231-g dug down with a creeper eight blocks off; it came down on top of the bot and went off (2026-09-27).
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const dug = new Set(), capped = new Set();
  const blockAt = p => { const f = p.floored(); const name = capped.has(`${f}`) ? 'cobblestone' : dug.has(`${f}`) ? 'air' : f.y >= 63 ? 'air' : f.y >= 58 ? 'dirt' : 'stone'; const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f; return b; };
  const make = distance => {
    const creeper = { id: 4, name: 'creeper', type: 'hostile', position: new Vec3(distance + 0.5, 63, 0.5), height: 1.7, isValid: true };
    const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: { 4: creeper }, registry, entity: { position: new Vec3(0.5, 63, 0.5), onGround: true },
      health: 13, inventory: { items: () => [{ name: 'cobblestone', count: 8 }], slots: {} }, blockAt, world: { raycast: () => null } });
    const seen = [];
    const survival = new Survival(bot, { navigate: async () => {}, dig: async (b, t, p) => { seen.push(`${p}`); dug.add(`${p.floored()}`); bot.entity.position = new Vec3(p.x + 0.5, p.y, p.z + 0.5); }, place: async (b, t, p) => { capped.add(`${p.floored()}`); } }, { state: { shelters: [] } });
    return { survival, seen };
  };
  const near = make(8);
  assert.equal(await near.survival.shaftPocket(new Task('night'), {}, () => {}), false);
  assert.deepEqual(near.seen, [], 'not a block dug');
  dug.clear();
  const far = make(40);
  assert.equal(await far.survival.shaftPocket(new Task('night'), {}, () => {}), true, 'forty off: time to dig and cap');
});

test('a ghast in sight is a threat within its own reach, sixty-four blocks (note 513), not the sixteen of a bow', () => {
  // mid-244-e walked a ledge at y 89 with a ghast in sight at seventeen to nineteen blocks, and its fireball threw the bot off (2026-09-27).
  const { immediateThreat } = require('../src/danger');
  const make = distance => ({ game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 89, 0.5), height: 1.8 }, health: 20, food: 20,
    entities: { 9: { id: 9, name: 'ghast', type: 'hostile', position: new Vec3(distance + 0.5, 89, 0.5), height: 4, isValid: true } },
    world: { raycast: () => null }, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }), inventory: { items: () => [], slots: {} } });
  assert.equal(immediateThreat(make(19))?.entity.name, 'ghast');
  assert.equal(immediateThreat(make(45))?.entity.name, 'ghast', 'forty-five: within its sixty-four');
  assert.equal(immediateThreat(make(70)), undefined, 'past its reach');
});

test('a meal cut short is not offered as a stance again for ten seconds', async () => {
  // mid-235-g chose to eat with two drowned at arm's length; the meal began every half second and was never eaten (2026-09-27).
  const bot = crowdBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const crowd = [crowdMob(1, 'spider', 1.8), crowdMob(2, 'zombie', -3.2)];
  const first = survival.stanceOptions(new Task('t'), {}, () => {}, crowd, false);
  assert(first.eat, Object.keys(first).join(','));
  bot.equip = async () => {}; bot.consume = () => new Promise((resolve, reject) => setTimeout(() => reject(new Error('Consuming cancelled')), 5));
  survival.report = () => {};
  assert.equal(await first.eat.run(), false);
  assert.equal(survival.stanceOptions(new Task('t'), {}, () => {}, crowd, false).eat, undefined, 'cut short: not offered');
  // A consume that comes back with nothing eaten is cut short too.
  survival.state.mealCutAt = Date.now() - 11000;
  const again = survival.stanceOptions(new Task('t'), {}, () => {}, crowd, false);
  bot.consume = async () => {};
  assert.equal(await again.eat.run(), false, 'hunger did not go up');
  assert.equal(survival.stanceOptions(new Task('t'), {}, () => {}, crowd, false).eat, undefined, 'and not offered');
  bot.consume = async () => { bot.food += 3; };
  survival.state.mealCutAt = Date.now() - 11000;
  assert.equal(await survival.stanceOptions(new Task('t'), {}, () => {}, crowd, false).eat.run(), true, 'eaten');
  survival.state.mealCutAt = Date.now() - 11000;
  assert(survival.stanceOptions(new Task('t'), {}, () => {}, crowd, false).eat, 'offered again after ten seconds');
});

test('the pillar says a phantom flies and dives on a player wherever it stands', () => {
  // mid-205-g pillared from phantoms twice at five health (2026-09-27).
  const bot = crowdBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('night'), {}, () => {}, [crowdMob(1, 'zombie', 3), crowdMob(2, 'phantom', 0, 4)], false);
  assert.match(options.pillar.description, /Two up does not stop a phantom \(flies, and dives on a player wherever it stands; only a roof keeps it off\)/);
  // mid-211-h pillared from a magma cube over the lava sea and was knocked off (2026-09-27).
  const cube = survival.stanceOptions(new Task('nether'), {}, () => {}, [crowdMob(3, 'magma_cube', 3)], false);
  assert.match(cube.pillar.description, /Two up does not stop a magma cube \(jumps higher than two blocks, and its hit throws\)/);
});

test('no shaft pocket is dug with a zombie at arm\'s length: it follows the bot down the open shaft', async () => {
  // mid-229-e dug on with two zombies in the shaft with it, a hit a second (2026-09-27).
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const name = f.y >= 63 ? 'air' : f.y >= 58 ? 'dirt' : 'stone'; const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f; return b; };
  const zombie = { id: 4, name: 'zombie', type: 'hostile', position: new Vec3(2.0, 63, 0.5), height: 1.95, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: { 4: zombie }, registry, entity: { position: new Vec3(0.5, 63, 0.5), onGround: true },
    health: 18, inventory: { items: () => [{ name: 'cobblestone', count: 8 }], slots: {} }, blockAt, world: { raycast: () => null } });
  const dug = [];
  const survival = new Survival(bot, { navigate: async () => {}, dig: async (b, t, p) => { dug.push(`${p}`); }, place: async () => {} }, { state: { shelters: [] } });
  assert.equal(await survival.shaftPocket(new Task('night'), {}, () => {}), false);
  assert.deepEqual(dug, []);
});

test('a fireball on its way is a threat with its ghast out of view: the shield comes up to it', async () => {
  // mid-230-g was hit by four fireballs in six seconds from a ghast out of view, the fourth throwing it into the lava (2026-09-27).
  const { immediateThreat } = require('../src/danger');
  const fireball = { id: 9, name: 'fireball', position: new Vec3(0.5, 66, 8.5), velocity: new Vec3(0, 0, -1), isValid: true };
  let raised = false;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 14, food: 18,
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, entities: { 9: fireball }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'iron_sword' }], slots: { 45: { name: 'shield' } } }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 64 ? 'netherrack' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, activateItem() { raised = true; }, deactivateItem() {} });
  assert.equal(immediateThreat(bot)?.entity.name, 'fireball');
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('shot'), goal, () => {});
  assert.equal(raised, true);
  assert.equal(goal.survivalAction?.action, 'block_shot');
});

test('standing on the corner of a block over an edge, the drop is under the bot itself', () => {
  // mid-244-g stood so in a ravine, told no drop was within three, and a spider's hit put it twenty-two blocks down (2026-09-27).
  const { dropNear } = require('../src/terrain');
  // The floor ends at x 1; the bot's middle is over x 0, where nothing is under it.
  const bot = { blockAt: p => { const q = p.floored(); const solid = q.y === 63 && q.x >= 1; return { name: solid ? 'stone' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; } };
  const drop = dropNear(bot, new Vec3(0, 64, 0), 3);
  assert(drop, 'a drop');
  assert.equal(drop.blocksAway, 0);
});

test('the charge at a shooter says the mobs out of sight about, as the fight does', () => {
  // mid-231-h charged a skeleton at 3.7 health told of it alone, two more four blocks off out of sight, and was shot (2026-09-27).
  const bot = crowdBot({ health: 4 });
  bot.entities = { 7: { id: 7, name: 'skeleton', type: 'hostile', position: new Vec3(-3.5, 64, 0.5), height: 1.99, isValid: true },
    8: { id: 8, name: 'skeleton', type: 'hostile', position: new Vec3(10.5, 64, 0.5), height: 1.99, isValid: true } };
  // Behind a wall to the west.
  bot.world = { raycast: (from, dir) => dir.x < 0 ? { position: from.floored(), intersect: from } : null };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('night'), {}, () => {}, [crowdMob(8, 'skeleton', 10)], false);
  assert(options.charge_shooter, Object.keys(options).join(','));
  assert.match(options.charge_shooter.description, /Out of sight but about: a skeleton 4 blocks off/);
});

test('on a one-wide span with fireballs coming, the open sides are walled: a blocked shot still pushes', async () => {
  // mid-242-h blocked four blaze fireballs on its span and drifted off it into the lava (2026-09-27).
  const placed = new Set();
  const fireball = { id: 9, name: 'small_fireball', position: new Vec3(0.5, 65.5, 8.5), velocity: new Vec3(0, 0, -1), isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, health: 20, food: 18,
    entities: { 9: fireball }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'netherrack', count: 32 }, { name: 'iron_sword' }], slots: { 45: { name: 'shield' } } }, world: { raycast: () => null },
    blockAt: p => { const q = p.floored(); const solid = placed.has(`${q}`) || (q.y === 63 && q.x === 0); return { name: solid ? 'netherrack' : q.y < 30 ? 'lava' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, attack() {}, equip: async () => {}, activateItem() {}, deactivateItem() {} });
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, t, p) => { placed.add(`${p}`); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'rail_span');
  assert(placed.has(`${new Vec3(1, 64, 0)}`) && placed.has(`${new Vec3(-1, 64, 0)}`), [...placed].join(' '));
});

test('a creeper Jev chose to leave be is a threat again well before its fuse\'s reach, not at three blocks', () => {
  // mid-231-i at two health had one follow it in from nine blocks to two, no stance asked, and was blown up (2026-09-27).
  const { immediateThreat } = require('../src/danger');
  const creeper = { id: 8, name: 'creeper', type: 'hostile', position: new Vec3(6.5, 64, 0.5), height: 1.7, isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 }, entities: { 8: creeper }, game: { dimension: 'overworld' }, health: 20,
    world: { raycast: () => null }, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }), _wavedOff: { ids: [8], until: Date.now() + 15000 } };
  assert.equal(immediateThreat(bot)?.entity.name, 'creeper', 'six blocks off: a threat again');
  creeper.position = new Vec3(10.5, 64, 0.5);
  assert.equal(immediateThreat(bot), undefined, 'ten off: still left be');
});

test('on a span with a ghast in sight twenty blocks off, the walls go up before its fireball', async () => {
  // mid-202-g held still on its span with a ghast in sight at twenty-two blocks and was thrown into the lava (2026-09-27).
  const placed = new Set();
  const ghast = { id: 4, name: 'ghast', type: 'hostile', position: new Vec3(0.5, 70, 22.5), height: 4, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, health: 20, food: 18,
    entities: { 4: ghast }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'netherrack', count: 32 }, { name: 'iron_sword' }], slots: { 45: { name: 'shield' } } }, world: { raycast: () => null },
    blockAt: p => { const q = p.floored(); const solid = placed.has(`${q}`) || (q.y === 63 && q.x === 0); return { name: solid ? 'netherrack' : q.y < 30 ? 'lava' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, attack() {}, equip: async () => {}, activateItem() {}, deactivateItem() {} });
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, t, p) => { placed.add(`${p}`); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'rail_span');
});

test('on a span with a ghast in sight sixty blocks off, the walls go up too, from a block its blast does not break (mid-242-aa-nether-2, note 551)', async () => {
  // Held still on a span with a ghast in sight fifty-eight to sixty-two blocks off, 102 blocks carried and no wall
  // raised (only shooters within forty-eight were looked for); its fireball threw the bot five blocks into the lava.
  const placed = new Map();
  const ghast = { id: 4, name: 'ghast', type: 'hostile', position: new Vec3(0.5, 70, 60.5), height: 4, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', difficulty: 'normal' }, registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, health: 18, food: 18,
    entities: { 4: ghast }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'netherrack', count: 60 }, { name: 'cobblestone', count: 42 }, { name: 'iron_sword' }], slots: { 45: { name: 'shield' } } }, world: { raycast: () => null },
    blockAt: p => { const q = p.floored(); const solid = placed.has(`${q}`) || (q.y === 63 && q.x === 0); return { name: solid ? 'netherrack' : q.y < 30 ? 'lava' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, attack() {}, equip: async () => {}, activateItem() {}, deactivateItem() {} });
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, t, p, material) => { placed.set(`${p}`, material); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'rail_span');
  assert(placed.size && [...placed.values()].every(m => m === 'cobblestone'), [...placed.values()].join(','));
});

test('a warden behind the rock is a threat within its boom\'s reach, seen or not', () => {
  // mid-230-h stood recovering at y -52 with a warden sixteen blocks off behind the rock and was killed by its sonic boom (2026-09-27).
  const { immediateThreat } = require('../src/danger');
  const warden = { id: 3, name: 'warden', type: 'hostile', position: new Vec3(16.5, -52, 0.5), height: 2.9, isValid: true };
  const bot = { entity: { position: new Vec3(0.5, -52, 0.5), height: 1.8 }, entities: { 3: warden }, game: { dimension: 'overworld' }, health: 20,
    world: { raycast: from => ({ position: from.floored(), intersect: from }) }, blockAt: p => ({ name: 'deepslate', position: p, boundingBox: 'block' }) };
  assert.equal(immediateThreat(bot)?.entity.name, 'warden');
});

test('the Nether forest floor and its trees are ground to dig through, not walls', () => {
  // mid-242-k: a crimson nylium block at head height held a fortress leg for minutes, "crimson nylium in the way".
  const { natural } = require('../src/tunneling');
  const { surveyCrossing } = require('../src/bridging');
  for (const n of ['crimson_nylium', 'warped_nylium', 'nether_wart_block', 'crimson_stem', 'shroomlight']) assert(natural.test(n), n);
  assert(!natural.test('magma_block'), 'not magma: it burns whoever stands on it');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0.5, 57, 0.5) }, inventory: { items: () => [{ name: 'netherrack', count: 64 }] },
    blockAt: p => { const name = p.y < 57 ? 'netherrack' : p.z === 2 && p.y === 58 ? 'crimson_nylium' : 'air'; return { name, position: p, diggable: true, boundingBox: name === 'air' ? 'empty' : 'block' }; } };
  const survey = surveyCrossing(bot, new Vec3(0, 57, 20), { cells: 8 });
  assert.equal(survey.stoppedBy, null, survey.stoppedBy);
  assert.equal(survey.dig, 1);
});

test('the charge at a shooter is not offered where its run would refuse it: in water', () => {
  // mid-202-h: offered waist-deep in a stream, failed at once and rested twenty seconds, then shot at 3.2.
  const bot = crowdBot({ health: 10 });
  bot.entities = { 8: { id: 8, name: 'skeleton', type: 'hostile', position: new Vec3(10.5, 64, 0.5), height: 1.99, isValid: true } };
  bot.world = { raycast: () => null };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  assert(survival.stanceOptions(new Task('stream'), {}, () => {}, [crowdMob(8, 'skeleton', 10)], false).charge_shooter, 'on dry ground: offered');
  bot.entity.isInWater = true;
  assert(!survival.stanceOptions(new Task('stream'), {}, () => {}, [crowdMob(8, 'skeleton', 10)], false).charge_shooter, 'in the water: not');
});

test('while Jev is asked the stance, a mob in reach is still struck', async () => {
  // mid-227-i: the fight re-asked every two seconds, each answer two seconds with no swing; magma cubes took it from seventeen to one.
  const registry = require('prismarine-registry')('26.1');
  const zombie = { id: 7, name: 'zombie', type: 'hostile', position: new Vec3(2, 64, .5), height: 1.8, isValid: true };
  const attacks = [];
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { position: new Vec3(.5, 64, .5), height: 1.8 }, entities: { 7: zombie }, health: 12, food: 20, oxygenLevel: 20,
    time: { timeOfDay: 14000 }, inventory: { items: () => [], slots: {} }, world: { raycast: () => null }, heldItem: null,
    blockAt: p => ({ position: p.floored(), name: p.y < 64 ? 'grass_block' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, equip: async () => {}, unequip: async () => {},
    attack: target => attacks.push(target.name) });
  const survival = new Survival(bot, { navigate: async () => {} });
  survival.stanceOptions = () => ({ fight: { description: 'fight', run: async () => true }, seal: { description: 'seal', run: async () => true } });
  survival.decide = async () => { await new Promise(r => setTimeout(r, 400)); return { path: ['fight'] }; };
  await survival.stanceStep(new Task('cubes'), {}, () => {}, [{ entity: zombie, distance: 1.5, visible: true }], false);
  assert(attacks.length >= 1, 'struck while the answer was out');
});

test('laying a span with a mob close, its sides are walled but not the way on', async () => {
  // mid-243-j: crossing at y 59 over the lava sea, hit twice by an enderman with no wall up, thrown thirty blocks into the lava.
  const placed = new Set();
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, health: 12, food: 18,
    entities: { 3: { id: 3, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 64, -2.5), height: 1.95, isValid: true } }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'netherrack', count: 32 }, { name: 'iron_sword' }], slots: {} }, world: { raycast: () => null },
    // One block laid so far, open air all round: the span goes on toward +x.
    blockAt: p => { const q = p.floored(); const solid = placed.has(`${q}`) || (q.y === 63 && q.x === 0 && q.z === 0); return { name: solid ? 'netherrack' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, attack() {}, equip: async () => {}, activateItem() {}, deactivateItem() {} });
  bot._spanning = { target: { x: 20, y: 64, z: 0 }, since: Date.now() };
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, t, p) => { placed.add(`${p}`); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'rail_span');
  assert(placed.has(`${new Vec3(0, 64, 1)}`) && placed.has(`${new Vec3(0, 64, -1)}`), 'both sides walled');
  assert(!placed.has(`${new Vec3(1, 64, 0)}`), 'the way on left open');
});

test('a ghast in sight within its own reach puts a span under fire, not only a shooter within twenty-four', () => {
  // mid-230-j laid a span with a ghast in sight thirty-nine blocks off and was thrown sixteen blocks down.
  const { underFire } = require('../src/bridging');
  const ghast = { id: 4, name: 'ghast', type: 'hostile', position: new Vec3(39.5, 70, 0.5), height: 4, isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 }, entities: { 4: ghast }, game: { dimension: 'the_nether' }, world: { raycast: () => null },
    blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) };
  assert.equal(underFire(bot)?.entity?.name, 'ghast');
  ghast.position = new Vec3(60.5, 70, 0.5);
  assert.equal(underFire(bot)?.entity?.name, 'ghast', 'sixty: within its sixty-four (note 513)');
  ghast.position = new Vec3(75.5, 70, 0.5);
  assert.equal(underFire(bot), undefined, 'past its sixty-four');
});

test('the charge at a shooter is no answer with a biter at arm\'s length, in view or not', async () => {
  // mid-241-g charged a skeleton with a zombie at its back, broke off at once for it, ten times a second, and the zombie killed it.
  const skeleton = { id: 8, name: 'skeleton', type: 'hostile', position: new Vec3(10.5, 64, 0.5), height: 1.99, isValid: true };
  const zombie = { id: 9, name: 'zombie', type: 'hostile', position: new Vec3(-1.5, 64, 0.5), height: 1.95, isValid: true };
  const bot = crowdBot({ health: 12 });
  bot.entities = { 8: skeleton, 9: zombie };
  Object.assign(bot, { pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, equip: async () => {}, attack() {}, heldItem: { name: 'diamond_sword' } });
  bot.entity.onGround = true;
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const danger = [{ entity: skeleton, distance: 10, visible: true }];
  assert.equal(await survival.closeOnShooter(new Task('t'), {}, () => {}, danger), false);
});

test('the night mine is told what is left once the pickaxes wear out', () => {
  // mid-244-k wore six pickaxes to none with one stick and no wood, and dug seventy blocks up by hand for forty-six minutes.
  const { pickaxeReserve } = require('../src/survival');
  const items = [{ name: 'stick', count: 1 }, { name: 'cobblestone', count: 128 }, { name: 'crafting_table', count: 1 }];
  const bot = { inventory: { items: () => items }, blockAt: p => ({ name: p.y < 70 ? 'stone' : 'air', position: p, boundingBox: p.y < 70 ? 'block' : 'empty' }) };
  const r = pickaxeReserve(bot, new Vec3(0, 10, 0));
  assert.equal(r.stonePickaxesMakeable, 0, 'one stick makes none');
  assert(r.climbOutByHandMinutes >= 20, JSON.stringify(r));
  items.push({ name: 'oak_log', count: 2 });
  assert.equal(pickaxeReserve(bot, new Vec3(0, 10, 0)).stonePickaxesMakeable, 8, 'two logs are sixteen sticks more');
});

test('on a span with no blocks for walls and a shooter in reach, off the span to firm ground', async () => {
  // mid-235-j held still at the end of its span, no blocks for walls, and a ghast's fireball threw it into the lava.
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, health: 20, food: 18,
    entities: { 4: { id: 4, name: 'ghast', type: 'hostile', position: new Vec3(0.5, 70, 36.5), height: 4, isValid: true } }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'gravel', count: 16 }, { name: 'iron_sword' }], slots: {} }, world: { raycast: () => null },
    // A span one wide along x from firm ground at x <= -4.
    blockAt: p => { const q = p.floored(); const solid = q.y === 63 && (q.x <= -4 || (q.x <= 0 && q.z === 0)); return { name: solid ? 'netherrack' : q.y < 30 ? 'lava' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, attack() {}, equip: async () => {}, activateItem() {}, deactivateItem() {} });
  let to = null;
  const survival = new Survival(bot, { navigate: async (b, t, g) => { to = g; }, place: async () => { throw new Error('nothing to place'); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'off_span');
  assert(to && to.x <= -4, `to firm ground: ${to && to.x}`);
});

test('on a span with a creeper coming, off the span away from it before any wall', async () => {
  // mid-241-h held still on a ledge at y 74 and a creeper went off beside it.
  const placed = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, health: 9, food: 18,
    entities: { 4: { id: 4, name: 'creeper', type: 'hostile', position: new Vec3(5.5, 64, 0.5), height: 1.7, isValid: true } }, time: { timeOfDay: 14000 },
    inventory: { items: () => [{ name: 'cobblestone', count: 32 }, { name: 'iron_sword' }], slots: {} }, world: { raycast: () => null },
    // A ledge one wide along x, firm ground either end: x <= -4 and x >= 8.
    blockAt: p => { const q = p.floored(); const solid = q.y === 63 && (q.x <= -4 || q.x >= 8 || q.z === 0); return { name: solid ? 'stone' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, attack() {}, equip: async () => {}, activateItem() {}, deactivateItem() {} });
  let to = null;
  const survival = new Survival(bot, { navigate: async (b, t, g) => { to = g; }, place: async (b, t, p) => { placed.push(p); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'off_span');
  assert(to && to.x <= -4, `away from the creeper: ${to && to.x}`);
  assert.equal(placed.length, 0, 'no walls: a wall does not stop a blast');
});

test('a zombie at arm\'s length round a wall, out of sight, still rules out sealing the shelter', () => {
  // mid-202-i sealed its half-built walls four seconds with a zombie one to two blocks off, not in view.
  const { biterAtArm } = require('../src/survival');
  const zombie = { id: 3, name: 'zombie', type: 'hostile', position: new Vec3(2, 64, 0.5), height: 1.95, isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8 }, entities: { 3: zombie }, game: { dimension: 'overworld' },
    world: { raycast: (from) => ({ position: from.floored(), intersect: from }) }, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) };
  assert.equal(biterAtArm(bot), true);
  zombie.position = new Vec3(6, 64, 0.5);
  assert.equal(biterAtArm(bot), false);
});

test('a step off the edge that goes nowhere is set aside a moment, not taken again a hundred times a second', async () => {
  // mid-244-l: its step to the cell beside it came back at once, over and over, until an arrow and a creeper's blast.
  const skeleton = { id: 5, name: 'skeleton', type: 'hostile', position: new Vec3(0.5, 64, -5.5), height: 1.99, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, health: 12, food: 18,
    entities: { 5: skeleton }, time: { timeOfDay: 14000 }, inventory: { items: () => [{ name: 'iron_sword' }], slots: {}, emptySlotCount: () => 10 }, world: { raycast: () => null },
    registry: require('minecraft-data')('26.1'), findBlocks: () => [], oxygenLevel: 20,
    // Ground to the west, a deep drop to the east beside the feet.
    blockAt: p => { const q = p.floored(); const solid = q.y === 63 && q.x <= 0; return { name: solid ? 'stone' : q.y < 40 ? 'lava' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, attack() {}, equip: async () => {}, activateItem() {}, deactivateItem() {} });
  let walks = 0;
  const survival = new Survival(bot, { navigate: async () => { if (goal.survivalAction?.action === 'off_the_edge') walks++; } }, { state: { shelters: [] } });
  const goal = {};
  survival.stanceStep = async () => true;
  await survival.flee(new Task('edge'), goal, () => {}).catch(() => {});
  delete goal.survivalAction;
  await survival.flee(new Task('edge'), goal, () => {}).catch(() => {});
  assert.equal(walks, 1, 'set aside after going nowhere once');
});

test('two up is not out of a spear\'s reach: the pillar says so and counts its thrusts', () => {
  // mid-244-o pillared from spear zombies and was speared on top, three hits from 6.6 to none.
  const bot = crowdBot({ health: 12 });
  const spear = { entity: { id: 1, name: 'zombie', position: new Vec3(2.5, 64, 0.5), height: 1.95, heldItem: { name: 'iron_spear' } }, distance: 2, visible: true };
  const plain = { entity: { id: 2, name: 'zombie', position: new Vec3(2.5, 64, 0.5), height: 1.95 }, distance: 2, visible: true };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const withSpear = survival.stanceOptions(new Task('t'), {}, () => {}, [spear], false).pillar;
  const without = survival.stanceOptions(new Task('t'), {}, () => {}, [plain], false).pillar;
  assert.match(withSpear.description, /A spear reaches past an arm: the zombie with a spear still reaches the bot two up/);
  assert(withSpear.expects.damage > without.expects.damage, `${withSpear.expects.damage} against ${without.expects.damage}`);
});

test('the fight says a spear\'s reach and knock, and how many jabs off the drop is (mid-244-z)', () => {
  // mid-244-z fought a spear zombie told only its cost; jabbed a block back each second, the last jab put it over a fifteen-block drop.
  const zombie = { id: 1, name: 'zombie', type: 'hostile', position: new Vec3(-1.5, 74, 0.5), height: 1.95, isValid: true, heldItem: { name: 'iron_spear' } };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: { 1: zombie }, health: 15.4, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 74, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], emptySlotCount: () => 10, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } } },
    blockAt: p => ({ position: p, name: p.y < (p.x >= 3 ? 58 : 74) ? 'stone' : 'air', boundingBox: p.y < (p.x >= 3 ? 58 : 74) ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const fight = survival.stanceOptions(new Task('t'), {}, () => {}, [{ entity: zombie, distance: 2, visible: true }], false).fight;
  assert.match(fight.description, /The zombie with a spear jabs from about 3 blocks, as far as a sword reaches and past an arm, about once a second for about 2\.5 each after armour/);
  assert.match(fight.description, /each jab knocks the bot about a block back out of its swing/);
  assert.match(fight.description, /A drop of 16 blocks is 3 blocks off.*The drop 3 blocks off is 3 jabs away/);
  delete zombie.heldItem;
  const plain = survival.stanceOptions(new Task('t'), {}, () => {}, [{ entity: zombie, distance: 2, visible: true }], false).fight;
  assert.doesNotMatch(plain.description, /spear/);
  assert(fight.expects.damage > plain.expects.damage * 5, `${fight.expects.damage} against ${plain.expects.damage}`);
});

test('leaving the mobs be is asked again once one of them stops the work, not run again every tick', async () => {
  // mid-227-k: a creeper left be came within its fuse's reach; the held stance ran a hundred times a second until it went off.
  const creeper = { id: 3, name: 'creeper', type: 'hostile', position: new Vec3(12.5, 64, 0.5), height: 1.7, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 3: creeper }, health: 20, food: 20,
    inventory: { items: () => [], slots: {} }, world: { raycast: () => null }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {} });
  let asked = 0;
  survival.stanceOptions = () => ({ keep_working: { description: 'on', run: async () => { bot._wavedOff = { ids: [3], until: Date.now() + 15000 }; return true; } }, seal: { description: 'in', run: async () => true } });
  survival.decide = async () => { asked++; return { path: ['keep_working'] }; };
  const danger = [{ entity: creeper, distance: 12, visible: true }];
  await survival.stanceStep(new Task('t'), {}, () => {}, danger, false);
  await survival.stanceStep(new Task('t'), {}, () => {}, danger, false);
  assert.equal(asked, 1, 'far off and left be: held');
  creeper.position = new Vec3(5.5, 64, 0.5);
  await survival.stanceStep(new Task('t'), {}, () => {}, [{ entity: creeper, distance: 5, visible: true }], false);
  assert.equal(asked, 2, 'within its fuse\'s reach: asked again');
});

test('a golden apple is eaten only when one is gone: an eat cut short by the hand\'s change is not taken for one', async () => {
  // mid-244-n "ate" its golden apple every half second for four seconds, none eaten, zombies hitting it to none.
  const bot = crowdBot({ health: 9, items: [{ name: 'golden_apple', count: 2 }] });
  Object.assign(bot, { equip: async item => { setTimeout(() => { bot.heldItem = item; }, 60); }, consume: async () => {}, heldItem: null });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const option = survival.stanceOptions(new Task('t'), {}, () => {}, [crowdMob(1, 'zombie', 1.5)], false).eat_golden_apple;
  assert(option);
  assert.equal(await option.run(), false, 'nothing eaten: not done');
});

test('hurt and fed, resting where it is while health comes back is on offer, with the seconds said', async () => {
  // mid-241-i, at 2.3 health and hunger nineteen, had only food to choose and walked back past the skeleton it had got away from.
  const { bot } = nookFixture({ open: p => p.x === 0 && p.z === 0 && p.y >= 30 });
  bot.health = 6; bot.food = 19;
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } } });
  let tree = null;
  survival.decide = async (task, goal, save, q) => { tree = tree || q.tree; return { path: ['rest_to_heal'], action: q.tree.rest_to_heal, stale: true }; };
  await survival.step(new Task('hurt'), { kind: 'win', request: 'beat the game' }, () => {});
  assert(tree?.rest_to_heal, Object.keys(tree || {}).join(','));
  assert.match(tree.rest_to_heal.description, /6 health now, hunger 19, about one health each four seconds .* about 56 seconds to twenty/);
});

test('a step back from the lava edge that goes nowhere is no answer: the next footing is tried, and with none the rest', async () => {
  // mid-229-i "left the lava edge" twenty times a second without a step while a skeleton shot it.
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 10,
    blockAt: p => { const q = p.floored(); return { name: q.y < 64 ? 'netherrack' : (q.x === 1 && q.y === 64) ? 'lava' : 'air', position: q, boundingBox: q.y < 64 ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} }, clearControlStates() {}, setControlState() {} });
  const walks = [];
  const survival = new Survival(bot, { navigate: async (b, t, g) => { walks.push(g); } }, { state: { shelters: [] } });
  survival.escapeFootings = () => ({ about: [], footing: [new Vec3(-3, 64, 0), new Vec3(-4, 64, 2)], far: [], near: [], heavy: false, persistent: false });
  survival.wayAway = async () => ({});
  assert.equal(await survival.runAway(new Task('t'), {}, () => {}, []), false);
  assert.equal(walks.length, 2, 'both footings tried');
});

test('an action reported twenty times in a second without the bot moving is set aside a moment, emergencies too', () => {
  // The step off an edge, the step back from lava and keep working each spun a hundred times a second (notes 370, 377, 380).
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {} });
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const goal = {};
  for (let n = 0; n < 20; n++) survival.report(goal, () => {}, { action: 'leave_lava_edge' });
  assert.throws(() => survival.report(goal, () => {}, { action: 'leave_lava_edge' }), e => e.name === 'SetAside');
  assert.doesNotThrow(() => survival.report(goal, () => {}, { action: 'fight' }), 'another action is not');
  // Moving, it is not a spin.
  const moving = new Survival(Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {} }), {}, { state: { shelters: [] } });
  for (let n = 0; n < 25; n++) { moving.bot.entity.position = new Vec3(0.5 + n, 64, 0.5); moving.report(goal, () => {}, { action: 'off_the_edge' }); }
});

test('the run from an enderman says it teleports after the bot', () => {
  // mid-211-m ran from one three times, told only that a way was found, and was hit on arrival each time.
  const bot = crowdBot({ health: 12 });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [crowdMob(1, 'enderman', 3)], false);
  // And outruns the bot's sprint (note 578).
  assert.match(options.retreat.description, /An enderman after the bot runs at about 8\.7 blocks a second, faster than the bot sprints \(5\.6\), and teleports toward it once it is more than sixteen blocks off: a run from one ends with it beside the bot again/);
});

test('held on a span with a shot on its way and no walls or ground to be had, the shield comes up', async () => {
  // mid-227-l held still on a fortress bridge under two blazes' fire and burned from 7.5 to none.
  const blaze = { id: 4, name: 'blaze', type: 'hostile', position: new Vec3(0.5, 66, 10.5), height: 1.8, isValid: true };
  const fireball = { id: 9, name: 'small_fireball', position: new Vec3(0.5, 65.5, 5.5), velocity: new Vec3(0, 0, -1), isValid: true };
  let raised = false;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, health: 7, food: 18,
    entities: { 4: blaze, 9: fireball }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'iron_sword' }], slots: { 45: { name: 'shield' } } }, world: { raycast: () => null },
    // A one-wide bridge along x, lava far below, nothing firm anywhere else.
    blockAt: p => { const q = p.floored(); const solid = q.y === 63 && q.z === 0; return { name: solid ? 'nether_bricks' : q.y < 30 ? 'lava' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, attack() {}, equip: async () => {},
    activateItem() { raised = true; }, deactivateItem() {} });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => { throw new Error('nothing to place'); } }, { state: { shelters: [] } });
  const goal = {};
  await survival.flee(new Task('bridge'), goal, () => {});
  assert.equal(raised, true, 'the shield came up');
  assert.equal(goal.survivalAction?.action, 'block_shot');
});

test('a span wall counts only when it stands: a place that leaves nothing is no wall', async () => {
  // mid-243-l "walled" its span eleven times in four seconds under a ghast, no wall ever standing, and was thrown into the lava.
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, health: 20,
    entities: {}, inventory: { items: () => [{ name: 'cobblestone', count: 32 }], slots: {} },
    blockAt: p => { const q = p.floored(); const solid = q.y === 63 && q.z === 0; return { name: solid ? 'cobblestone' : 'air', position: q, boundingBox: solid ? 'block' : 'empty' }; } });
  const survival = new Survival(bot, { place: async () => {} }, { state: { shelters: [] } });
  assert.equal(await survival.railSpan(new Task('span'), {}, () => {}), false);
});

test('by a deadly edge with a creeper coming, the step back goes away from the creeper', async () => {
  // mid-230-m walked two seconds toward ground by the creeper, stalled, and the blast took it from twenty.
  const creeper = { id: 4, name: 'creeper', type: 'hostile', position: new Vec3(-3.5, 74, 0.5), height: 1.7, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 4: creeper }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 74, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'diamond_sword', count: 1 }, { name: 'netherrack', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: p.x >= 2 ? (p.y <= 30 ? 'lava' : 'air') : p.y < 74 ? 'netherrack' : 'air', boundingBox: p.x < 2 && p.y < 74 ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  let to = null;
  const survival = new Survival(bot, { navigate: async (b, t, g) => { to = g; } }, { state: { shelters: [] } });
  const goal = {};
  await survival.step(new Task('leg'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'off_the_edge');
  const d = new Vec3(to.x + 0.5, to.y, to.z + 0.5).distanceTo(creeper.position);
  assert(d >= bot.entity.position.distanceTo(creeper.position) + 2, `away from the creeper: ${to.x},${to.z} at ${d.toFixed(1)}`);
});

test('the night\'s shaft pocket is not dug with a witch in sight and in range; as Jev\'s own dig_down it is', async () => {
  // mid-218-j's night shaft went down beside a witch five blocks off, its potions coming in for twelve seconds, twenty health to none (2026-09-27).
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const name = f.y >= 63 ? 'air' : f.y >= 58 ? 'dirt' : 'stone'; const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f; return b; };
  const witch = { id: 4, name: 'witch', type: 'hostile', position: new Vec3(5.5, 63, 0.5), height: 1.95, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: { 4: witch }, registry, entity: { position: new Vec3(0.5, 63, 0.5), onGround: true },
    health: 20, inventory: { items: () => [{ name: 'cobblestone', count: 8 }], slots: {} }, blockAt, world: { raycast: () => null } });
  const dug = [];
  const survival = new Survival(bot, { navigate: async () => {}, dig: async (b, t, p) => { dug.push(`${p}`); }, place: async () => {} }, { state: { shelters: [] } });
  const column = survival.shaftColumn();
  assert(column.bottom, JSON.stringify(column));
  assert.equal(await survival.shaftPocket(new Task('night'), {}, () => {}), false);
  assert.deepEqual(dug, []);
  await survival.digShaft(new Task('stance'), {}, () => {}, { ...column, here: column.start, spot: 'x', stance: true });
  assert(dug.length > 0);
});

test('sealed in with a warden about, the pocket\'s choices say its boom goes through the wall, and the hits taken', async () => {
  // mid-230-n stayed in a pocket two minutes told only that a warden was outside, and was boomed through the wall three times (2026-09-27).
  const origin = new Vec3(0, -25, 0);
  const warden = { id: 7, name: 'warden', type: 'hostile', position: new Vec3(8.5, -25, 0.5), height: 2.9, width: 0.9, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: { 7: warden }, health: 10, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 16000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20, _sonicBooms: [Date.now() - 5000],
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'air' : 'stone', boundingBox: p.equals(origin) || p.equals(origin.offset(0, 1, 0)) ? 'empty' : 'block', diggable: true, hardness: 1.5, position: p }),
    world: { raycast: (from) => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {} }, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld' }] }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, goal, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('night'), { kind: 'win' }, () => {});
  for (const key of ['stay', 'leave']) {
    assert.match(tree?.[key]?.description || '', /sonic boom that passes through blocks and armour/, key);
    assert.match(tree[key].description, /The warden is 8 blocks off, within the boom's reach\. The bot has been hit by the boom once in the last minute\./, key);
    // What the boom does at this health, not left to "healing from 10 health" beside it (note 554).
    assert.match(tree[key].description, /about 10 damage, about every five seconds.* At 10 health, one boom ends it, whatever heals before it\./, key);
  }
  // On Hard it is fifteen, and a bot at twenty takes two.
  bot.game.difficulty = 'hard'; bot.health = 20; tree = null;
  const hard = new Survival(bot, { dig: async () => {}, navigate: async () => {} }, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld' }] }, client: { systemOne: async () => ({}) } });
  hard.decide = survival.decide; hard.wait = async () => {};
  await hard.step(new Task('night'), { kind: 'win' }, () => {});
  assert.match(tree.stay.description, /about 15 damage, .* At 20 health, 2 booms end it, the last about 5 seconds after the first, less what heals between them\./);
  // And a way away from it, beyond the boom, that is not a door past it.
  assert.match(tree.tunnel_from_warden?.description || '', /pocket's west wall, away from the warden: one wide and two high, 9 blocks, .* ending 17 blocks across from where it is now, beyond its boom's 15/);
});

test('beside a mob spawner, every stance says it makes more of its mob while the bot stays within sixteen blocks', async () => {
  // mid-207-j fought beside a dungeon's zombie spawner told of "a zombie, 2.5 seconds", and eight zombies came in a minute (2026-09-27).
  const calls = [];
  const client = { systemOne: async ({ state, questions }) => { calls.push({ state, questions }); return { answers: { branch_0: { choice: 'retreat', confidence: 0.9 } } }; } };
  const { bot, controller, task, goal } = archerFixture({ client, sword: true, shield: false, lone: false });
  bot.registry = require('minecraft-data')('26.1');
  bot.findBlocks = ({ matching }) => matching === bot.registry.blocksByName.spawner.id ? [new Vec3(6, 64, 0)] : [];
  await controller.step(task, goal, () => {});
  assert.equal(calls[0].state.spawner?.blocksAway, 6);
  for (const [key, c] of Object.entries(calls[0].questions.branch_0.criteria)) assert.match(JSON.stringify(c), /A mob spawner is 6 blocks off: while a player is within 16 blocks of it, it makes more of its mob/, key);
});

test('sealed in by a spawner with a skeleton at the wall and no creeper: a passage out to beyond the spawner\'s sixteen is Jev\'s, and staying and leaving say the spawner', async () => {
  // mid-220-g (note 476): eighteen minutes beside a dungeon it knew, sealed in about sixty times, skeletons, cave spiders and zombies at its pockets, and shot by a skeleton; the passage out was only ever for a creeper or a warden.
  const origin = new Vec3(0, 30, 0), spawnerAt = new Vec3(10, 30, 0);
  const skeleton = { id: 8, name: 'skeleton', type: 'hostile', position: new Vec3(5.5, 30, 0.5), height: 1.99, width: 0.6, isValid: true };
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const registry = require('minecraft-data')('26.1');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: { 8: skeleton }, health: 20, food: 20, registry,
    time: { timeOfDay: 16000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] },
    findBlocks: ({ matching }) => [].concat(matching).includes(registry.blocksByName.spawner.id) ? [spawnerAt] : [],
    blockAt: p => p.equals(spawnerAt) ? { name: 'spawner', boundingBox: 'block', diggable: true, position: p } : ({ name: open.has(`${p}`) ? 'air' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : 'block', diggable: true, position: p }),
    world: { raycast: (from) => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const walked = [];
  const survival = new Survival(bot, { dig: async (b, t, p) => { open.add(`${p}`); }, navigate: async (b, t, g) => { walked.push(new Vec3(g.x, g.y, g.z)); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } },
    { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld' }] }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, goal, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['tunnel_out'], stale: false }; };
  survival.wait = async () => assert.fail('Jev chose the passage');
  await survival.step(new Task('night'), { kind: 'win' }, () => {});
  assert.match(tree?.tunnel_out?.description || '', /pocket's west wall, away from the mob spawner: one wide and two high, \d+ blocks/);
  const said = Number(/ending (\d+) blocks from the spawner/.exec(tree.tunnel_out.description)?.[1]);
  assert(said > 16, `the passage's end said ${said} from the spawner`);
  const end = walked.at(-1);
  assert(end && Math.hypot(end.x + 0.5 - 10.5, end.z + 0.5 - 0.5) > 16, `the passage ends at ${end}, beyond sixteen from the spawner`);
  for (const key of ['stay', 'leave']) {
    assert.match(tree[key].description, /a mob spawner 10 blocks off: while a player is within 16 blocks of it, it makes more of its mob/, key);
    assert.match(tree[key].description, /its mobs do not leave at daylight/, key);
  }
});

test('the night mine\'s target says a dungeon remembered nearby, and a branch away from it is on offer', async () => {
  // mid-220-g (note 476): thirteen "none of these" on the night mine's target beside a dungeon it knew; the move it wanted, away, was never offered.
  const registry = require('minecraft-data')('26.1');
  const ores = { '3,39,0': 'iron_ore' };
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 40, 0.5) },
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }], emptySlotCount: () => 10, slots: [] },
    findBlocks: ({ matching }) => Object.keys(ores).filter(k => [].concat(matching).includes(registry.blocksByName[ores[k]].id)).map(k => new Vec3(...k.split(',').map(Number))),
    blockAt: p => ({ name: ores[`${p.x},${p.y},${p.z}`] || 'stone', boundingBox: 'block', position: p }) });
  const survival = new Survival(bot, {}, { client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, goal, save, q) => { tree = q.tree; return { path: ['branch_away'], stale: false }; };
  survival.state.nightMine = { heading: 0 };
  const goal = { landmarks: [{ kind: 'dungeon', x: 12, y: 38, z: 0, dimension: 'overworld' }] };
  assert.equal(await survival.nightTarget(new Task('night'), goal, () => {}, new Vec3(0, 40, 0)), null);
  for (const key of ['ore_0', 'branch']) assert.match(tree[key].description, /About this place: a dungeon remembered 12 blocks off: a room round a mob spawner/, key);
  assert.match(tree.branch_away?.description || '', /Dig the branch west, away from the dungeon/);
  assert.equal(survival.state.nightMine.heading, 2, 'the branch heads west, away from it');
});

test('on a pillar with a shooter out of reach, no charge that carries no step is offered, and the fight is priced as the shots taken', () => {
  // mid-244-s, on a pillar eight blocks from a pillager, was told the fight and the charge were "about 6.2 seconds and 2.9 damage"; each ended at once, twice, arrows every three seconds (2026-09-27).
  const pillar = p => p.x === 0 && p.z === 0 && p.y < 62;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, health: 10.7, food: 18, entities: {},
    entity: { position: new Vec3(0.5, 62, 0.5), onGround: true }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'cobblestone', count: 64 }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } } },
    blockAt: p => { const f = p.floored(); const solid = pillar(f) || f.y < 48; return { position: f, name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty' }; },
    world: { raycast: () => null }, findBlocks: () => [] });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const pillager = { entity: { id: 9, name: 'pillager', position: new Vec3(8.5, 60, 0.5), height: 1.95, heldItem: { name: 'crossbow' } }, distance: 8.2, visible: true };
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [pillager], false);
  assert.equal(options.charge_shooter, undefined, Object.keys(options).join(','));
  assert.match(options.fight.description, /None of them can be reached from here: .* about [\d.]+ damage from their shots in the next fifteen seconds, from 10.7 health/);
  assert.equal(options.fight.expects.seconds, 15);
  // Holding the pillar is the same: nothing to swing at, shot with no end.
  assert.match(options.pillar?.description || '', /nothing (up here|two up) to swing at: held, it is standing in their line of fire/);
});

test('on a span with the hold refused, a piglin at arm\'s length is still struck', async () => {
  // mid-242-o: its span hold was set aside as a stall, every hold after threw, and nothing swung while a piglin hit it off into the lava (2026-09-27).
  const span = p => { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    return y === 32 && x === -16 && z >= 40 && z <= 60 ? { position: p, name: 'netherrack', boundingBox: 'block' }
      : y <= 31 ? { position: p, name: 'lava', boundingBox: 'empty' } : { position: p, name: 'air', boundingBox: 'empty' }; };
  const piglin = { id: 3, name: 'piglin', type: 'hostile', position: new Vec3(-15.5, 33, 50.2), height: 1.95, width: 0.6, isValid: true };
  const attacks = [], keys = {};
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 15, food: 20, oxygenLevel: 20,
    entity: { position: new Vec3(-15.5, 33, 49), onGround: true, height: 1.8 }, entities: { 3: piglin }, time: { timeOfDay: 6000 }, _hurtBy: { piglin: Date.now() },
    inventory: { items: () => [{ name: 'iron_sword', type: 1 }], slots: {} }, world: { raycast: () => null }, blockAt: span,
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState(k, v) { keys[k] = v; }, getControlState: k => !!keys[k],
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: e => attacks.push(e) });
  const survival = new Survival(bot, { navigate: async () => { throw new Error('No path'); } }, { state: { shelters: [] } });
  const goal = {};
  require('../src/progress').setAside(survival, 'act', 'survival:hold_on_span', 'it stalled', 600000);
  survival._spin = { until: { 'survival:hold_on_span': Date.now() + 5000 } };
  await survival.flee(new Task('span'), goal, () => {});
  assert.equal(attacks.length, 1, 'struck, though the hold was refused');
});

test('a zombie on a ledge within a block of the pillar\'s top is said to reach it, and priced', () => {
  // mid-241-k held a pillar in a cave told "two up, none of them reaches it" and was hit on top (2026-09-27).
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, health: 15.7, food: 16, entities: {},
    entity: { position: new Vec3(0.5, -14, 0.5) }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'cobblestone', count: 64 }], slots: {} },
    blockAt: p => ({ position: p, name: p.y < -14 || (p.x >= 2 && p.y < -13) ? 'deepslate' : 'air', boundingBox: p.y < -14 || (p.x >= 2 && p.y < -13) ? 'block' : 'empty' }), world: { raycast: () => null }, findBlocks: () => [] });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const z = (id, x, y) => ({ entity: { id, name: 'zombie', position: new Vec3(x + 0.5, y, 0.5), height: 1.95 }, distance: Math.hypot(x, y + 14), visible: true });
  const flat = survival.stanceOptions(new Task('x'), {}, () => {}, [z(1, 4, -14)], false);
  assert.doesNotMatch(flat.pillar.description, /ledge/);
  const ledge = survival.stanceOptions(new Task('x'), {}, () => {}, [z(2, 2, -13)], false);
  assert.match(ledge.pillar.description, /The zombie 2 blocks off stands on ground above the bot's floor \(a ledge or a slope\), high enough that its blow reaches a player two up/);
  assert(ledge.pillar.expects.damage > flat.pillar.expects.damage);
});

test('ground one up beside the pillar\'s column puts its top in reach of the walkers there, wherever they stand now; a blow knocks the bot off (mid-242-aa, note 559)', () => {
  // A tunnel floor at y 64 beside a floor a block higher (x >= 1): two up is one above that floor.
  const make = step => {
    const solid = p => p.y < 64 || (step && p.x >= 1 && p.y < 65);
    const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entities: {},
      entity: { position: new Vec3(0.5, 64, 0.5) }, registry: require('minecraft-data')('26.1'),
      inventory: { items: () => [{ name: 'stone_sword' }, { name: 'cobblestone', count: 64 }], slots: {} },
      blockAt: p => ({ position: p, name: solid(p.floored()) ? 'netherrack' : 'air', boundingBox: solid(p.floored()) ? 'block' : 'empty' }), world: { raycast: () => null }, findBlocks: () => [] });
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
    const y = step ? 65 : 64;
    const zombie = { entity: { id: 1, name: 'zombie', position: new Vec3(7.5, y, 0.5), height: 1.95 }, distance: Math.hypot(7, y - 64), visible: true };
    return survival.stanceOptions(new Task('x'), {}, () => {}, [zombie], false).pillar;
  };
  const flat = make(false), step = make(true);
  assert.doesNotMatch(flat.description, /The ground beside the pillar's column/);
  assert.match(flat.description, /Two up, none of them reaches it/);
  // Seven blocks off: not "on a ledge within five", but it walks to the column's side.
  assert.match(step.description, /The ground beside the pillar's column is 1 up, at 1, 65, -1: two up is one above it, and a blow reaches as high as the mob stands \(a zombie or a piglin 1\.95, a wither skeleton 2\.4\), so the zombie reaches a player on the top from there, and one there steps up onto the top once the bot is off its middle\./);
  assert.match(step.description, /A blow that lands knocks the bot back \(the game's knockback, with a hop\): on a top one block wide the first leaves it at the edge and the next puts it off, two blocks down among them/);
  assert.match(step.description, /Two up, the zombie still reaches it/);
  assert(step.expects.damage > flat.expects.damage, `${step.expects.damage} > ${flat.expects.damage}`);
});

test('a wither skeleton reaches a pillar\'s top from the bot\'s own floor, and the fight up there is priced as the fight here meets it (mid-242-aa, note 559)', () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5) }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'stone_sword' }, { name: 'cobblestone', count: 64 }], slots: {} },
    blockAt: p => ({ position: p, name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }), world: { raycast: () => null }, findBlocks: () => [] });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const skeleton = { entity: { id: 1, name: 'wither_skeleton', position: new Vec3(7.5, 64, 3.5), height: 2.4 }, distance: Math.hypot(7, 3), visible: true };
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [skeleton], false);
  // After the hardest blow, said first on every stance (note 576).
  assert.match(options.pillar.description, /^The wither skeleton 8 blocks off hits for about 8 a blow[^]*?seconds\. Go two blocks straight up on placed blocks and fight from there\. Here two up is no cover from any of the mobs that bite: the wither skeleton reaches its top, and the fight up there is the fight here, begun once the blocks are down, on a top one block wide; shooters still can hit\./);
  assert.match(options.pillar.description, /Two up does not stop a wither skeleton/);
  assert.match(options.pillar.description, /A blow that lands knocks the bot back/);
  // Fought from the top with no approach, it read 16.3 where the fight here read 23.8.
  const fight15 = Number(/about ([\d.]+) of it in the first fifteen seconds/.exec(options.fight.description)[1]);
  assert(options.pillar.expects.damage > 18, `${options.pillar.expects.damage}`);
  assert(options.pillar.expects.damage <= fight15 + 0.01, `${options.pillar.expects.damage} <= ${fight15}`);
});

test('running from a shooter, no footing beside a drop into lava is chosen: its arrows push', () => {
  // mid-242-p ran from a crossbow piglin to a spot beside a three-block drop to the lava, and the next arrow put it in (2026-09-27).
  const registry = require('minecraft-data')('26.1');
  // Netherrack at y 34 for x <= 12; past x 9 at z >= 4 a drop to lava at y 31.
  const solid = p => p.y === 34 && p.x <= 12 && !(p.x >= 10 && p.z >= 4);
  const blockAt = p => { const f = p.floored(); return { position: f, name: solid(f) ? 'netherrack' : f.y <= 31 ? 'lava' : 'air', boundingBox: solid(f) ? 'block' : 'empty' }; };
  const piglin = { id: 5, name: 'piglin', type: 'hostile', position: new Vec3(-4.5, 35, 0.5), height: 1.95, width: 0.6, isValid: true, heldItem: { name: 'crossbow' } };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether' }, registry, health: 16, entities: { 5: piglin }, entity: { position: new Vec3(0.5, 35, 0.5) },
    blockAt, world: { raycast: () => null },
    findBlocks: ({ maxDistance }) => { const out = []; for (let x = -20; x <= 12; x++) for (let z = -20; z <= 20; z++) { const p = new Vec3(x, 34, z); if (solid(p) && p.distanceTo(bot.entity.position) <= maxDistance) out.push(p); } return out; } });
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const danger = [{ entity: piglin, distance: 5, visible: true }];
  const { near, far } = survival.escapeFootings(danger);
  const beside = p => p.x >= 8 && p.z >= 2;
  assert(near.length > 0);
  assert(![...near, ...far].some(beside), `none by the lava: ${[...near, ...far].filter(beside).map(String).slice(0, 3)}`);
});

test('at bedtime in a pocket on open ground, with a bed carried and no nook, sleeping beside it is offered', async () => {
  // mid-211-o carried a bed three hours and was never offered sleep from a pocket; nights were 62 of its 180 minutes (2026-09-27).
  const origin = new Vec3(0, 64, 0);
  const shell = new Set(require('../src/shelter').shell(origin).map(String));
  const blockAt = p => { const f = p.floored(); const solid = f.y < 64 || shell.has(`${f}`); return { position: f, name: solid ? (f.y < 64 ? 'grass_block' : 'cobblestone') : 'air', boundingBox: solid ? 'block' : 'empty', diggable: true }; };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 13000, isDay: false }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'white_bed', count: 1 }, { name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt, world: { raycast: () => null } });
  const survival = new Survival(bot, { dig: async () => {}, place: async () => {}, navigate: async () => {} }, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld', verifiedAt: new Date().toISOString() }] }, client: { systemOne: async () => ({}) } });
  let tree = null;
  survival.decide = async (task, goal, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('night'), { kind: 'win' }, () => {});
  assert(tree, 'asked what next in the pocket');
  assert.match(tree.sleep_beside?.description || '', /put the carried bed down on level ground beside it, \d+ blocks off, and sleep/, Object.keys(tree).join(','));
});

test('at dusk with a bed carried and no nook, a pocket now and the bed beside it at bedtime is offered, and kept at bedtime', async () => {
  // The night was asked at dusk, before a bed could be slept in, and answered with a pocket; mid-211-o's nights were 62 of 180 minutes (2026-09-27).
  const origin = new Vec3(0, 64, 0);
  const placed = new Set();
  const blockAt = p => { const f = p.floored(); const solid = f.y < 64 || placed.has(`${f}`); return { position: f, name: solid ? (f.y < 64 ? 'grass_block' : 'cobblestone') : 'air', boundingBox: solid ? 'block' : 'empty', diggable: true }; };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 11500 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'white_bed', count: 1 }, { name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 64 }], emptySlotCount: () => 10, slots: [] },
    blockAt, world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'success', path: [] }) }, clearControlStates() {}, setControlState() {} });
  const survival = new Survival(bot, { dig: async () => {}, place: async (b, t, p) => { placed.add(`${p.floored()}`); }, navigate: async () => {} }, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  let asked = null;
  survival.decide = async (task, goal, save, { id, tree }) => { if (id === 'shelter_method') { asked = tree; return { path: ['bed_beside'], stale: false }; } return { path: ['stay'], stale: false }; };
  survival.sealHere = async () => true;
  await survival.refugeStep(new Task('night'), { kind: 'win' }, () => {});
  assert.match(asked?.bed_beside?.description || '', /Seal a pocket where the bot stands, .* and at bedtime .* put the carried bed down on level ground \d+ blocks off and sleep/, Object.keys(asked || {}).join(','));
  assert(survival.state.bedBesidePlan?.until > Date.now(), 'the plan is kept for bedtime');
});

test('a step whose answer is set aside, with a mob hitting the bot, answers the mob instead of doing nothing', async () => {
  // mid-244-t: its seal spun and was set aside by turns, the step returned "nothing to do", and a skeleton shot it from two blocks for twenty seconds (2026-09-27).
  const skeleton = { id: 4, name: 'skeleton', type: 'hostile', position: new Vec3(2.5, 64, 0.5), height: 1.99, width: 0.6, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, entities: { 4: skeleton }, health: 9.6,
    entity: { position: new Vec3(0.5, 64, 0.5) }, world: { raycast: () => null }, _hurtTimes: [Date.now() - 1000] });
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  survival.stepOnce = async () => { throw Object.assign(new Error('seal shelter is set aside: it ran twenty times in a second and the bot did not move'), { name: 'SetAside' }); };
  let fled = 0;
  survival.flee = async () => { fled++; };
  assert.equal(await survival.step(new Task('x'), {}, () => {}), true);
  assert.equal(fled, 1, 'the encounter was answered');
  // Nothing about and nothing hurting: a set-aside is still nothing to do.
  bot.entities = {}; bot._hurtTimes = [];
  assert.equal(await survival.step(new Task('x'), {}, () => {}), false);
  assert.equal(fled, 1);
});

test('burning out of the lava, the survival step pours the water before anything else', async () => {
  // mid-235-m came out of a lava pool alight with a water bucket, and the span's walls were rebuilt every tick while it burned to none (2026-09-27).
  let poured = 0;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, entities: {}, health: 6.6, food: 20, oxygenLevel: 20,
    entity: { position: new Vec3(0.5, 64, 0.5), metadata: { 0: 1 }, onGround: true, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'water_bucket', count: 1 }] }, world: { raycast: () => null },
    blockAt: p => { const f = p.floored(); return { position: f, name: f.y < 64 ? 'stone' : 'air', boundingBox: f.y < 64 ? 'block' : 'empty' }; },
    equip: async () => {}, lookAt: async () => {}, activateItem: () => { poured++; bot.entity.metadata[0] = 0; } });
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const goal = {};
  assert.equal(await survival.step(new Task('fire'), goal, () => {}), true);
  assert.equal(poured, 1);
  assert.equal(goal.survivalAction?.action, 'douse');
});

test('a survival step that returns with a threat at hand has the encounter answered', async () => {
  // The Fable advice on mid-244-t: a pass that leaves an immediate threat unanswered lets every step after throw on it.
  const zombie = { id: 4, name: 'zombie', type: 'hostile', position: new Vec3(1.5, 64, 0.5), height: 1.95, width: 0.6, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, entities: { 4: zombie }, health: 12,
    entity: { position: new Vec3(0.5, 64, 0.5) }, world: { raycast: () => null } });
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  survival.stepOnce = async () => false;
  let fled = 0; survival.flee = async () => { fled++; };
  assert.equal(await survival.step(new Task('x'), {}, () => {}), true);
  assert.equal(fled, 1);
});

test('the nook\'s wall is put back though the walk to its stand fails', async () => {
  // mid-243-m: the walk back failed, the wall was never put back, and the pocket stood open (2026-09-27).
  const placed = [];
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'cobblestone', count: 8 }] },
    blockAt: p => ({ position: p, name: 'air', boundingBox: 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => { throw new Error('No path'); }, place: async (b, t, p) => { placed.push(`${p}`); } }, { state: { shelters: [] } });
  await survival.closeNook(new Task('x'), { stand: new Vec3(1, 64, 0) }, [new Vec3(1, 64, 0), new Vec3(1, 65, 0)]);
  assert.equal(placed.length, 2);
});

test('the bow is priced as the other stances are, and the question carries no standing verdict against it', async () => {
  // The Fable advice on mid-244-s: the shot had no number beside the others' numbers, and the guidance said "the bow 16 to 17 with no kill".
  const calls = [];
  const client = { systemOne: async ({ questions, instructions, rootInstructions }) => { calls.push({ questions, text: JSON.stringify(rootInstructions || instructions || '') }); return { answers: { branch_0: { choice: 'retreat', confidence: 0.9 } } }; } };
  const { bot, controller, task, goal } = archerFixture({ client, sword: true, shield: false, lone: false });
  bot.inventory.items = () => [{ name: 'iron_sword' }, { name: 'bow', count: 1, durabilityUsed: 0 }, { name: 'arrow', count: 8 }, { name: 'cobblestone', count: 20 }];
  await controller.step(task, goal, () => {});
  const shot = JSON.stringify(calls[0].questions.branch_0.criteria.shoot_7);
  assert.match(shot, /About [\d.]+ damage from the mobs here in the next fifteen seconds this way/);
  assert.doesNotMatch(calls[0].text, /the bow 16 to 17 with no kill/);
});

test('poisoned, every stance says poison never takes the last health but a harming potion can', async () => {
  // mid-244-w: poisoned by a witch, it ran three times, the poison held it at one, and a harming potion ended it (2026-09-27).
  const calls = [];
  const client = { systemOne: async ({ questions, state }) => { calls.push({ questions, state }); return { answers: { branch_0: { choice: 'retreat', confidence: 0.9 } } }; } };
  const { bot, controller, task, goal } = archerFixture({ client, sword: true, shield: false, lone: false });
  bot.registry = require('minecraft-data')('26.1');
  bot.entity.effects = { 18: { id: 18, amplifier: 0, duration: 300 } };
  await controller.step(task, goal, () => {});
  // Its rate from the game (one every 25 ticks), not "about one a second or so" (note 542).
  assert.match(calls[0].state.effectsNow || '', /poisoned, about 15 seconds left: one health every 1\.25 seconds .* never kills, but a bite, a hit or a harming potion after it does/);
  for (const [k, c] of Object.entries(calls[0].questions.branch_0.criteria)) assert.match(JSON.stringify(c), /never kills/, k);
});

test('on a span, hurt twice in six seconds, the encounter goes to Jev instead of the span\'s own answers', async () => {
  // Four span deaths in a day were the span branch's alone to the end (notes 435, 436, 439, 443).
  const span = p => { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    return y === 64 && z === 0 && x >= -10 && x <= 10 ? { position: p, name: 'netherrack', boundingBox: 'block' }
      : y <= 40 ? { position: p, name: 'lava', boundingBox: 'empty' } : { position: p, name: 'air', boundingBox: 'empty' }; };
  const blaze = { id: 3, name: 'blaze', type: 'hostile', position: new Vec3(12.5, 70, 8.5), height: 1.8, width: 0.6, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 14, food: 20, oxygenLevel: 20,
    entity: { position: new Vec3(0.5, 65, 0.5), onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0) }, entities: { 3: blaze }, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'iron_sword', type: 1 }, { name: 'netherrack', count: 20 }], slots: { 45: { name: 'shield' } } }, world: { raycast: () => null }, blockAt: span, registry: require('minecraft-data')('26.1'),
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => {}, findBlocks: () => [],
    _hurtTimes: [Date.now() - 3000, Date.now() - 1000] });
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {}, dig: async () => {} }, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  const asked = [];
  survival.decide = async (task, goal, save, { id }) => { asked.push(id); return { path: ['seal'], stale: false }; };
  const goal = {};
  await survival.flee(new Task('span'), goal, () => {}).catch(() => {});
  assert.notEqual(goal.survivalAction?.action, 'hold_on_span');
  assert(asked.includes('encounter_stance'), `asked: ${asked.join(',')} / ${goal.survivalAction?.action}`);
});

test('a hold that fails (the swing\'s walk timing out) rests ten seconds, not three minutes', async () => {
  // mid-211-q's defend failed once on a path timeout, rested three minutes, and a skeleton at 1.5 blocks shot it to none (2026-09-27).
  const { attemptsFor } = require('../src/progress');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, entities: {}, health: 15, entity: { position: new Vec3(0.5, 64, 0.5) }, world: { raycast: () => null } });
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const goal = { survivalAction: { action: 'defend', at: new Date().toISOString() } };
  survival.stepOnce = async () => { throw new Error('Took to long to decide path to goal!'); };
  assert.equal(await survival.step(new Task('x'), goal, () => {}), false);
  const entry = attemptsFor(survival).of('act')['survival:defend'];
  assert(entry && entry.until - Date.now() <= 10000, `rests ${entry && Math.round((entry.until - Date.now()) / 1000)} seconds`);
});

test('a fight at a shooter the charge would not run at (beside a drop) is priced as standing in its fire', () => {
  // mid-244-x's fight at a skeleton in a mineshaft was offered as a kill and ended at once (2026-09-27).
  const solid = p => p.y < 64 && !(p.x === 1 && p.z === 0);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, health: 8.6, food: 18, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'cobblestone', count: 64 }], slots: {} },
    blockAt: p => { const f = p.floored(); return { position: f, name: solid(f) ? 'stone' : 'air', boundingBox: solid(f) ? 'block' : 'empty' }; },
    world: { raycast: () => null }, findBlocks: () => [] });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const skeleton = { entity: { id: 9, name: 'skeleton', position: new Vec3(-5.5, 64, 0.5), height: 1.99 }, distance: 6, visible: true };
  const spider = { entity: { id: 10, name: 'cave_spider', position: new Vec3(-14.5, 64, 0.5), height: 0.5 }, distance: 15, visible: true };
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [skeleton, spider], false);
  assert.match(options.fight.description, /The nearest, a skeleton 6 blocks off, shoots and cannot be run at from here/);
  assert.equal(options.fight.expects.seconds, 15);
});

test('with a shooter in sight, cover is offered: a block two high in its line, priced, and run', async () => {
  // mid-227-q and mid-202-m were burned down at twenty blocks from their blazes with no way to break the line offered (2026-09-27).
  const placed = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival' }, health: 6.6, food: 18, entities: {},
    entity: { position: new Vec3(0.5, 72, 0.5), onGround: true }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'netherrack', count: 32 }], slots: {} },
    blockAt: p => { const f = p.floored(); const solid = f.y < 72 || placed.includes(`${f}`); return { position: f, name: solid ? 'netherrack' : 'air', boundingBox: solid ? 'block' : 'empty' }; },
    world: { raycast: () => null }, findBlocks: () => [] });
  const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p.floored()}`); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const blaze = { entity: { id: 9, name: 'blaze', position: new Vec3(20.5, 74, 0.5), height: 1.8 }, distance: 20, visible: true };
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [blaze], false);
  assert.match(options.take_cover?.description || '', /Put 2 blocks, two high, in the line from the eyes of the blaze \(20 blocks off\) to the bot's, beside the bot at head height.*About [\d.]+ damage/);
  assert.equal(await options.take_cover.run(), true);
  assert.deepEqual(placed.sort(), ['(1, 72, 0)', '(1, 73, 0)']);
});

test('cover beside a railed span goes on top of the rail, and cover that cannot go down fails with its why, said once with the count (mid-235-p-fortress-7, note 528)', async () => {
  // Its span railed one high at the feet, take_cover needed both cells empty, placed nothing six times in two seconds,
  // each "Tried N seconds ago here, and it failed" with no why, and Jev said none of these.
  const placed = [];
  let rail = new Set(['(1, 72, 0)']);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival' }, health: 4.2, food: 17, entities: {},
    entity: { position: new Vec3(0.5, 72, 0.5), onGround: true }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'netherrack', count: 32 }], slots: {} },
    blockAt: p => { const f = p.floored(); const solid = f.y < 72 || rail.has(`${f}`) || placed.includes(`${f}`); return { position: f, name: solid ? 'netherrack' : 'air', boundingBox: solid ? 'block' : 'empty' }; },
    world: { raycast: () => null }, findBlocks: () => [] });
  const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p.floored()}`); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const piglin = { entity: { id: 9, name: 'piglin', position: new Vec3(24.5, 72, 0.5), height: 1.95, heldItem: { name: 'crossbow' } }, distance: 24, visible: true };
  let options = survival.stanceOptions(new Task('x'), {}, () => {}, [piglin], false);
  assert.equal(await options.take_cover.run(), true);
  assert.deepEqual(placed, ['(1, 73, 0)'], 'only the block on the rail');
  // Both cells solid already: its line is stopped, and the bot stays behind what is there.
  rail = new Set(['(1, 72, 0)', '(1, 73, 0)']); placed.length = 0;
  options = survival.stanceOptions(new Task('x'), {}, () => {}, [piglin], false);
  assert.match(options.take_cover.description, /^Stay here behind what stands in the line already: nothing for the piglin \(24 blocks off\): the netherrack at \(1, 73, 0\) is in its line already/);
  assert.equal(await options.take_cover.run(), true);
  assert.deepEqual(placed, []);
  // A cover that cannot go down fails with its why.
  rail = new Set(['(1, 72, 0)']);
  const failing = new Survival(bot, { place: async () => { throw new Error('no face to place against'); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  options = failing.stanceOptions(new Task('x'), {}, () => {}, [piglin], false);
  await assert.rejects(options.take_cover.run(), e => e.name === 'StanceFailed' && /no face to place against \(the cell in the line of the piglin at \(1, 73, 0\)\)/.test(e.message));
});

test('cover from a blaze on the diagonal goes in its line, not on the side of its larger axis (mid-235-q-nether-2, note 541)', async () => {
  // At the lip of a thirty-block drop, a blaze thirty blocks off to the south-west and two below: the cover went up at head height
  // west (its larger axis), the fireball came in past it, and its push put the bot over the edge.
  const { sightLine } = require('../src/creeper-sight');
  const placed = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival' }, health: 9.4, food: 20, entities: {},
    entity: { position: new Vec3(235.92, 62, 212.17), onGround: true }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'cobblestone', count: 64 }], slots: {} },
    blockAt: p => { const f = p.floored(); const solid = (f.y === 61 && f.x >= 230 && f.x <= 235 && f.z >= 208 && f.z <= 214) || placed.includes(`${f}`); return { position: f, name: solid ? 'netherrack' : 'air', boundingBox: solid ? 'block' : 'empty' }; },
    world: { raycast: () => null }, findBlocks: () => [] });
  const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p.floored()}`); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const blaze = { id: 9, name: 'blaze', position: new Vec3(212.8, 60.1, 192.6), height: 1.8, width: 0.6 };
  bot.entities[9] = blaze;
  assert.equal(sightLine(bot, blaze).stoppedBy, null, 'the blaze has its line');
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [{ entity: blaze, distance: 30.3, visible: true }], false);
  assert.equal(await options.take_cover.run(), true);
  assert(!placed.includes('(234, 63, 212)'), `not on the west side of the larger axis: ${placed}`);
  assert(sightLine(bot, blaze).stoppedBy, `its line is cut: ${placed}`);
});

test('a blaze in sight past the stance\'s mobs, within its forty-eight, is said with what one fireball costs at this health (mid-235-p-fortress-7, note 528)', () => {
  // At 4.2 health the stance weighed a ghast at 61; a blaze at 48 in sight was unsaid, and its fireball and the fire it set ended the bot.
  const { fartherShootersSay } = require('../src/survival');
  const slots = {}; ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].forEach((name, i) => { slots[5 + i] = { name }; });
  const ghast = { id: 8, name: 'ghast', type: 'hostile', position: new Vec3(60.5, 72, 0.5), height: 4 };
  const blaze = { id: 9, name: 'blaze', type: 'hostile', position: new Vec3(0.5, 72, 48.5), height: 1.8 };
  const bot = { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 4.2, entity: { position: new Vec3(0.5, 72, 0.5) }, entities: { 8: ghast, 9: blaze },
    inventory: { items: () => [], slots }, world: { raycast: () => null }, blockAt: () => ({ name: 'air', boundingBox: 'empty' }) };
  const said = fartherShootersSay(bot, [{ entity: ghast, distance: 60, visible: true }]);
  assert.deepEqual(said.list, ['blaze 48 blocks off']);
  assert.match(said.says, /^ Farther off, not in the figures above: a blaze 48 blocks off has the bot in sight and fires from as far as 48, each of its fireballs landing about 14 in 100 from there and a volley of three at least one about 3\d in 100 \(a volley about every nine seconds\); one that lands is about 2\.5 and 5 burn over the five seconds after, more than the 4\.2 health there is\.$/);
  assert.equal(fartherShootersSay(bot, [{ entity: ghast, distance: 60, visible: true }, { entity: blaze, distance: 48, visible: true }]), null, 'one the stance weighs is not said twice');
});

test('digging down is not offered with a biter within three blocks: its shaft would stop for it at once', () => {
  // mid-205-p chose it three times with a zombie and a spider at arm's length, each ended at once (2026-09-27).
  const survival = new Survival(Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, health: 16, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5) }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'iron_pickaxe' }, { name: 'cobblestone', count: 64 }], slots: {} },
    blockAt: p => ({ position: p, name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }), world: { raycast: () => null }, findBlocks: () => [] }),
    { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const near = survival.stanceOptions(new Task('x'), {}, () => {}, [crowdMob(1, 'zombie', 1.8)], false);
  assert.equal(near.dig_down, undefined, Object.keys(near).join(','));
  const far = survival.stanceOptions(new Task('x'), {}, () => {}, [crowdMob(1, 'zombie', 6)], false);
  assert(far.dig_down, Object.keys(far).join(','));
});

test('a swimmer is on no span and takes no step off an edge', () => {
  // mid-202-n, swimming in a flooded column with a creeper near, was walked out of the water by the span and edge steps and fell thirty blocks (2026-09-27).
  const { onSpan } = require('../src/terrain');
  const blockAt = p => { const f = p.floored(); const water = f.x === 0 && f.z === 0 && f.y >= -6; return { position: f, name: water ? 'water' : f.y < -35 ? 'stone' : 'air', boundingBox: f.y < -35 ? 'block' : 'empty' }; };
  const bot = { entity: { position: new Vec3(0.5, -4.8, 0.5), isInWater: true }, blockAt };
  assert.equal(onSpan(bot), false);
});

test('a shelter search out of time looks longer, and is not a shelter with no way (mid-231-o)', async () => {
  const { Survival } = require('../src/survival');
  const timeouts = [];
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 35, 0.5) },
    pathfinder: { movements: {}, getPathTo: (m, g, ms) => { timeouts.push(ms); return { status: ms > 400 ? 'success' : 'timeout', path: [] }; } },
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }), on() {} };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { x: 0, y: 75, z: 0 }, dimension: 'overworld', verifiedAt: 'x', createdAt: 'x' }] } });
  const refuge = survival.currentShelter();
  assert.equal(await survival.reachableRefuge(new Task('night'), {}, () => {}, refuge), refuge);
  assert.equal(refuge.avoidUntil, undefined);
  bot.pathfinder.getPathTo = () => ({ status: 'timeout', path: [] });
  assert.equal(await survival.reachableRefuge(new Task('night'), {}, () => {}, refuge), null);
  assert(refuge.avoidUntil - Date.now() <= 60000, 'out of time twice rests a minute, not ten');
});

test('knocked into the air at the rim, the edge step plans from where the bot lands, and its walk does not tower up (mid-230-q)', async () => {
  const cube = { id: 4, name: 'magma_cube', type: 'hostile', position: new Vec3(-0.5, 76, 0.5), height: 2, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 4: cube }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(2.2, 74.6, 0.5), onGround: false, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'diamond_sword', count: 1 }, { name: 'netherrack', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: p.x >= 2 ? (p.y <= 30 ? 'lava' : 'air') : p.y < 74 ? 'netherrack' : 'air', boundingBox: p.x < 2 && p.y < 74 ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: { allow1by1towers: true }, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  setTimeout(() => { bot.entity.position = new Vec3(1.5, 74, 0.5); bot.entity.onGround = true; }, 150);
  let towers = null, from = null;
  const survival = new Survival(bot, { navigate: async () => { towers = bot.pathfinder.movements.allow1by1towers; from = bot.entity.position.x; } }, { state: { shelters: [] } });
  const goal = {};
  await survival.step(new Task('leg'), goal, () => {});
  assert.equal(goal.survivalAction?.action, 'off_the_edge');
  assert.equal(from, 1.5, 'planned once on the ground');
  assert.equal(towers, false, 'no tower in place on the walk to ground');
  assert.equal(bot.pathfinder.movements.allow1by1towers, true, 'given back after');
});

test('underground at night, hurt, with no food and no healing: sealing in until dawn is offered beside the climb to food (mid-207-l)', async () => {
  const { bot } = nookFixture({ time: 18000, items: [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }] });
  bot.health = 5.2; bot.food = 16; bot.pathfinder = { movements: {}, getPathTo: () => ({ status: "noPath", path: [] }), setGoal() {} };
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } } });
  let tree = null;
  survival.decide = async (task, goal, save, q) => { if (q.id === 'survival_priority') tree = tree || q.tree; return { path: ['continue_request'], action: q.tree.continue_request || Object.values(q.tree)[0], stale: true }; };
  await survival.step(new Task('hurt'), { kind: 'win', request: 'beat the game' }, () => {});
  assert(tree?.secure_shelter, Object.keys(tree || {}).join(','));
  assert.match(tree.secure_shelter.description, /wait in it for dawn.*5\.2 health, which does not come back/);
  if (tree.obtain_food) assert.match(tree.obtain_food.description, /night there until dawn/);
});

test('beside a drop into lava, fighting from firm ground away from it is on offer; on open ground it is not (mid-211-s)', async () => {
  const cube = { id: 4, name: 'magma_cube', type: 'hostile', position: new Vec3(-2.5, 74, 0.5), height: 2, isValid: true };
  const ledge = p => ({ position: p, name: p.x >= 2 ? (p.y <= 30 ? 'lava' : 'air') : p.y < 74 ? 'netherrack' : 'air', boundingBox: p.x < 2 && p.y < 74 ? 'block' : 'empty' });
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 4: cube }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 74, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], emptySlotCount: () => 10, slots: [] },
    blockAt: ledge, world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: { allow1by1towers: true }, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  let to = null;
  const survival = new Survival(bot, { navigate: async (b, t, g) => { to = g; } }, { state: { shelters: [] } });
  const danger = [{ entity: cube, distance: 3, visible: true }];
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, danger, false);
  assert(options.fight_from_footing, Object.keys(options).join(','));
  assert.match(options.fight_from_footing.description, /Step to firm ground .* blocks off, three blocks or more from any drop.*into lava/);
  await options.fight_from_footing.run();
  assert(to && to.x <= -2, `onto ground three from the edge: ${to && to.x}`);
  bot.blockAt = p => ({ position: p, name: p.y < 74 ? 'netherrack' : 'air', boundingBox: p.y < 74 ? 'block' : 'empty' });
  assert.equal(survival.stanceOptions(new Task('t'), {}, () => {}, danger, false).fight_from_footing, undefined);
});

test('a fight beside a deadly drop says how many of the mobs\' hits land, each a knock toward it (mid-211-s)', () => {
  const cube = { id: 4, name: 'magma_cube', type: 'hostile', position: new Vec3(-2.5, 74, 0.5), height: 2, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 4: cube }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 74, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: p.x >= 2 ? (p.y <= 30 ? 'lava' : 'air') : p.y < 74 ? 'netherrack' : 'air', boundingBox: p.x < 2 && p.y < 74 ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [{ entity: cube, distance: 3, visible: true }], false);
  assert.match(options.fight.description, /about \d+ of their hits? lands? in this fight, and each is a knock that can put the bot over the drop/);
});

test('on a long span, ground to fight from is looked for out to sixteen blocks (mid-211-s-nether-1)', () => {
  const cube = { id: 4, name: 'magma_cube', type: 'hostile', position: new Vec3(3.5, 74, 0.5), height: 2, isValid: true };
  // A one-wide span along z 0 from x -9 to 5 over the lava sea; ground from x -10 back.
  const solid = p => p.y < 74 && p.y > 30 && (p.x <= -10 || (p.z === 0 && p.x <= 5 && p.y === 73));
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 4: cube }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 74, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: solid(p) ? 'netherrack' : p.y <= 30 ? 'lava' : 'air', boundingBox: solid(p) ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const option = survival.stanceOptions(new Task('t'), {}, () => {}, [{ entity: cube, distance: 3, visible: true }], false).fight_from_footing;
  assert(option);
  assert.match(option.description, /Step to firm ground 1[3-6](\.\d)? blocks off/);
});

test('on a ledge with no ground near, walling the open edge and then fighting is on offer, and walls before it swings (mid-211-s-nether-2)', async () => {
  const cube = { id: 4, name: 'magma_cube', type: 'hostile', position: new Vec3(3.5, 74, 0.5), height: 2, isValid: true };
  const placed = new Set();
  const solid = p => placed.has(`${p}`) || (p.y === 73 && p.z === 0 && p.x > -30 && p.x <= 5);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 4: cube }, health: 20, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 74, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 16 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: solid(p) ? 'netherrack' : p.y <= 30 ? 'lava' : 'air', boundingBox: solid(p) ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, t, p) => { placed.add(`${p}`); } }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [{ entity: cube, distance: 3, visible: true }], false);
  assert.equal(options.fight_from_footing, undefined, 'no ground within sixteen');
  assert(options.rail_and_fight, Object.keys(options).join(','));
  assert.match(options.rail_and_fight.description, /Wall the 2 open sides at the feet over the drop \(4 blocks/);
  let fought = false;
  options.fight.run = async () => { fought = true; return true; };
  assert.equal(await options.rail_and_fight.run(), true);
  assert(placed.has(`${new Vec3(0, 74, 1)}`) && placed.has(`${new Vec3(0, 74, -1)}`), [...placed].join(' '));
  assert(fought);
});

test('with only a shooter out of reach at the lip of a deadly drop, walling the edge and holding behind it is on offer, priced (mid-235-q-nether-2, note 541)', async () => {
  // At 9.4 health on its own span thirty blocks over the lava sea under a blaze's fire, the rail was offered only while something
  // could be fought; the fireball's push put the bot over.
  const blaze = { id: 4, name: 'blaze', type: 'hostile', position: new Vec3(-25.5, 72, -19.5), height: 1.8, isValid: true };
  const placed = new Set();
  const solid = p => placed.has(`${p}`) || (p.y === 73 && p.z === 0 && p.x > -30 && p.x <= 5);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 4: blaze }, health: 9.4, food: 20, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay: 6000 }, entity: { position: new Vec3(0.5, 74, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 16 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ position: p, name: solid(p) ? 'netherrack' : p.y <= 30 ? 'lava' : 'air', boundingBox: solid(p) ? 'block' : 'empty' }),
    world: { raycast: () => null }, findBlocks: () => [], pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {} });
  const survival = new Survival(bot, { navigate: async () => {}, place: async (b, t, p) => { placed.add(`${p}`); } }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('t'), {}, () => {}, [{ entity: blaze, distance: 32, visible: true }], false);
  assert(options.rail_and_fight, Object.keys(options).join(','));
  assert.match(options.rail_and_fight.description, /Wall the 2 open sides at the feet over the drop \(4 blocks.*then hold here behind it: a push from a shot that lands, or a step back, stops at the wall.*About [\d.]+ damage from the mobs here/);
  assert(options.rail_and_fight.expects);
  let fought = false;
  options.fight.run = async () => { fought = true; return true; };
  assert.equal(await options.rail_and_fight.run(), true);
  assert(placed.has(`${new Vec3(0, 74, 1)}`) && placed.has(`${new Vec3(0, 74, -1)}`), [...placed].join(' '));
  assert(!fought, 'nothing to swing at: held, not fought');
});

test('a golden apple is priced as every stance is, and an eat cut short with the apple still carried stays on offer, said (mid-205-q)', async () => {
  const bot = crowdBot({ health: 2.8, items: [{ name: 'golden_apple', count: 1 }] });
  const zombie = crowdMob(1, 'zombie', 2);
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } }, state: { shelters: [] } });
  const apple = survival.stanceOptions(new Task('t'), {}, () => {}, [zombie], false).eat_golden_apple;
  assert(apple.expects, 'priced');
  assert.match(apple.description, /from 2\.8 health|from 3 health/);
  const feet = bot.entity.position.floored();
  survival.state.stanceFailed = [{ choice: 'eat_golden_apple', where: { x: feet.x, y: feet.y, z: feet.z }, at: Date.now() - 1000 }];
  let q = null;
  survival.decide = async (task, goal, save, question) => { q = q || question; return { path: ['fight'], action: question.tree.fight, stale: true }; };
  await survival.stanceStep(new Task('t'), {}, () => {}, [zombie], false).catch(() => {});
  assert(q?.tree?.eat_golden_apple, Object.keys(q?.tree || {}).join(','));
  assert.match(q.tree.eat_golden_apple.description, /Tried \d+ seconds? ago here and cut short before it was eaten; still carried/);
  assert.equal(q.state.failedHereJustNow[0].choice, 'eat_golden_apple');
});

// A world of stone with the air cells given, blocks from the registry so
// their dig times are the game's; the raycast walks it as the game's does.
function rockWorld(air, items = []) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const cache = new Map();
  const blockAt = p => {
    const f = p.floored(), key = `${f}`;
    if (!cache.has(key)) { const b = Block.fromStateId(registry.blocksByName[air(f) ? 'air' : 'stone'].defaultState); b.position = f; cache.set(key, b); }
    return cache.get(key);
  };
  const raycast = (from, dir, range) => {
    for (let t = 0; t <= range; t += 0.02) { const at = from.plus(dir.scaled(t)), b = blockAt(at); if (b.boundingBox === 'block') return { position: b.position, name: b.name, intersect: at }; }
    return null;
  };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 14, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => items.map(name => ({ name, type: registry.itemsByName[name].id, count: /pickaxe|sword/.test(name) ? 1 : 64, durabilityUsed: 0 })), slots: {} },
    blockAt, world: { raycast }, findBlocks: () => [], pathfinder: { movements: {} } });
  return bot;
}
const skeletonAt = (x, z) => ({ id: 9, name: 'skeleton', type: 'hostile', position: new Vec3(x, 64, z), height: 1.99, isValid: true, heldItem: { name: 'bow' } });
const threat = (bot, entity) => ({ entity, distance: entity.position.distanceTo(bot.entity.position), visible: true });

test('in a corridor with a skeleton down its length, the side opening out of its line is offered, the walk and what still reaches said (note 499)', async () => {
  // The 78 "none of these" picks with shooters of 2026-09-27: 57 underground,
  // the pillar taken 49 times, nothing offered that left the arrows' line.
  const corridor = p => (p.y === 64 || p.y === 65) && ((p.z === 0 && p.x >= -6 && p.x <= 20) || (p.x === -3 && (p.z === 1 || p.z === 2)));
  const bot = rockWorld(corridor, ['iron_sword', 'cobblestone']);
  const skeleton = skeletonAt(15.5, 0.5);
  let went = null;
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async (b, t, goal) => { went = new Vec3(goal.x, goal.y, goal.z); } }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, skeleton)], false);
  assert(options.out_of_sight, Object.keys(options).join(','));
  assert.match(options.out_of_sight.description, /^Walk 4 blocks to a spot [\d.]+ blocks off that no line from the skeleton reaches \(rock stands between\), about 0\.9 seconds in their fire on the way/);
  assert.match(options.out_of_sight.description, /About [\d.]+ damage from the mobs here in the next fifteen seconds this way, the 0\.9 seconds of walking there included/);
  await options.out_of_sight.run();
  assert.deepEqual(went, new Vec3(-3, 64, 1));
  const { seenFrom } = require('../src/bunker');
  assert.deepEqual(seenFrom(bot, [skeleton], went), [], 'no line from the skeleton to the side opening');
  assert.equal(seenFrom(bot, [skeleton], new Vec3(0, 64, 0)).length, 1, 'where it stands, in its line');
});

test('a hiding spot whose walk ended where it began is said with why and passed over from here, the next spot offered (mid-244-ad, note 570)', async () => {
  // mid-244-ad chose out_of_sight forty-one times in eleven seconds under a crossbow piglin, 6.4 health to 1.2, a walk of
  // six blocks to the same spot each time, and moved 1.4 blocks: the walk's failure was swallowed, "it failed" with no why.
  const corridor = p => (p.y === 64 || p.y === 65) && ((p.z === 0 && p.x >= -6 && p.x <= 20) || (p.x === -3 && (p.z === 1 || p.z === 2)));
  const bot = rockWorld(corridor, ['iron_sword', 'cobblestone']);
  const skeleton = skeletonAt(15.5, 0.5);
  const walks = [];
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async (b, t, goal) => { walks.push(new Vec3(goal.x, goal.y, goal.z)); throw new Error('No path to the goal!'); } }, { state: { shelters: [] } });
  let options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, skeleton)], false);
  assert.equal(await options.out_of_sight.run(), false);
  assert.deepEqual(walks[0], new Vec3(-3, 64, 1));
  assert.equal(survival.state.stanceWhy, 'the walk to the spot at (-3, 64, 1) ended 3.2 blocks short of it, where it began: No path to the goal!');
  options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, skeleton)], false);
  assert.match(options.out_of_sight.description, /^Walk 5 blocks to a spot/, 'the next spot, not the one just failed');
  assert.match(options.out_of_sight.description, /Not the spot tried just now: the walk to the spot at \(-3, 64, 1\) ended 3\.2 blocks short of it, where it began: No path to the goal!, 1 seconds ago\.$/);
  await options.out_of_sight.run();
  assert.deepEqual(walks[1], new Vec3(-3, 64, 2));
  options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, skeleton)], false);
  assert.equal(options.out_of_sight, undefined, 'no spot left to walk to from here');
  // Half a minute on, the spots are tried afresh.
  for (const f of survival.state.coverFailed) f.at -= 31000;
  options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, skeleton)], false);
  assert.match(options.out_of_sight?.description || '', /^Walk 4 blocks to a spot/);
});

test('in a wall of stone with a skeleton in the open, an L dug in out of its line is offered, its seconds from the tool carried', () => {
  const open = p => p.y >= 64 && p.x < 1;
  const make = pick => {
    const bot = rockWorld(open, [pick, 'cobblestone']);
    const skeleton = skeletonAt(-10.5, 0.5);
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
    return { bot, skeleton, options: survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, skeleton)], false) };
  };
  const { bot, skeleton, options } = make('iron_pickaxe');
  assert(options.nook, Object.keys(options).join(','));
  const { nookSite, blockDigMs, seenFrom } = require('../src/bunker');
  const site = nookSite(bot, [skeleton]);
  const stone = bot.blockAt(new Vec3(1, 64, 0));
  assert.equal(site.blocks, 6);
  assert.equal(site.digMs, 6 * blockDigMs(bot, stone));
  const secs = Math.round((site.ms + 3 * 250) / 100) / 10;
  assert.match(options.nook.description, new RegExp(`^Dig an L into the rock: two blocks in and one to the side, 6 blocks with the iron pickaxe, about ${secs} seconds of digging and stepping in`));
  assert.match(options.nook.description, /no line from the skeleton reaches its end/);
  assert.match(options.nook.description, /What bites comes to the mouth and round the turn one at a time/);
  const openCells = new Set(site.cells.flatMap(c => [`${c}`, `${c.offset(0, 1, 0)}`]));
  assert.deepEqual(seenFrom(bot, [skeleton], site.end, { open: openCells }), [], 'its end out of the line once dug');
  assert.equal(seenFrom(bot, [skeleton], site.cells[0], { open: openCells }).length, 1, 'its mouth in the line');
  // A wooden pickaxe digs it slower, and says so.
  const wooden = make('wooden_pickaxe');
  assert.match(wooden.options.nook.description, /6 blocks with the wooden pickaxe/);
  const woodSecs = Number(/about ([\d.]+) seconds of digging/.exec(wooden.options.nook.description)[1]);
  assert(woodSecs > secs, `${woodSecs} against ${secs}`);
});

test('out of a shooter\'s line is priced from when it walks to a new one, in the corner and in the L (mid-242-y, note 522)', () => {
  // mid-242-y: round a corner from a skeleton three blocks off, told "about 1 damage" in fifteen seconds; then
  // "none of them reaches" the end of an L that the skeleton walked into and shot it from.
  const corridor = p => (p.y === 64 || p.y === 65) && ((p.z === 0 && p.x >= -6 && p.x <= 20) || (p.x === -3 && (p.z === 1 || p.z === 2)));
  const bot = rockWorld(corridor, ['iron_sword', 'cobblestone']);
  const skeleton = skeletonAt(3.5, 0.5);
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const hidden = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, skeleton)], false).out_of_sight;
  assert(hidden);
  const { lineRegained } = require('../src/bunker');
  const back = lineRegained(bot, skeleton, new Vec3(-3, 64, 1));
  assert(back && back.blocks >= 5 && back.blocks <= 8, JSON.stringify(back));
  assert.match(hidden.description, /A shooter that loses sight of the bot walks on toward it by its way and shoots once it has a line again, its bow drawn in about a second: the skeleton 3 blocks off has one after about [\d.]+ blocks of walking, about [\d.]+ seconds in/);
  assert.match(hidden.description, /Out of their line, none of them reaches it at first; the skeleton after about [\d.]+ seconds reaches it again, counted from then/);
  // Its arrows from then on, not none: about 1.1 a second after armour, unshielded.
  assert(hidden.expects.damage >= 8, `${hidden.expects.damage}`);
  // Far down the corridor it is longer, and the damage less.
  const far = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, skeletonAt(15.5, 0.5))], false).out_of_sight;
  assert(far.expects.damage < hidden.expects.damage, `${far.expects.damage} against ${hidden.expects.damage}`);

  // The L: a shooter walks to its mouth and in, to the turn.
  const wall = rockWorld(p => p.y >= 64 && p.x < 1, ['iron_pickaxe', 'cobblestone']);
  const near = skeletonAt(-3.5, 0.5);
  const nook = new Survival(wall, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } })
    .stanceOptions(new Task('x'), {}, () => {}, [threat(wall, near)], false).nook;
  assert(nook);
  assert.doesNotMatch(nook.description, /a shooter has to come to the mouth to see in/);
  assert.match(nook.description, /the skeleton 4 blocks off has one after about [\d.]+ blocks of walking/);
  assert.match(nook.description, /Round the turn, none of them reaches it at first; the skeleton after about [\d.]+ seconds reaches it again/);
});

test('a stance that hid the bot is asked again once a shooter has a line to where it hid, and said (mid-242-y, note 522)', async () => {
  // In the open: nothing stands between the skeleton and the bot where it "hid".
  const make = air => {
    const bot = rockWorld(air, ['iron_sword', 'cobblestone']);
    const skeleton = skeletonAt(-3.5, 0.5);
    bot.entities = { 9: skeleton };
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } }, state: { shelters: [] } });
    const feet = bot.entity.position.floored();
    survival.state.nook = { end: `${feet}`, watch: { x: 1, y: 64, z: 0 } };
    survival.state.stance = { choice: 'nook', kinds: 'skeleton', ids: [9], at: Date.now() - 2000, health: 14, expects: { damage: 12, seconds: 15, oneHit: 2.2 }, hidden: { cell: `${feet}`, seenBy: [] } };
    let asked = null;
    survival.decide = async (task, goal, save, question) => { asked = question; return { path: ['nook'], stale: true }; };
    return { bot, skeleton, survival, asked: () => asked };
  };
  const seen = make(p => p.y >= 64);
  await seen.survival.stanceStep(new Task('t'), {}, () => {}, [threat(seen.bot, seen.skeleton)], false);
  assert(seen.asked(), 'asked again, not held');
  assert.match(seen.asked().state.previousStance.askedAgainFor, /the skeleton [\d.]+ blocks off has a line to where the bot hid/);
  assert.match(seen.asked().tree.nook.description, /^Stay round the turn of the nook dug here: the skeleton [\d.]+ blocks off has a line into it now/);
  // Rock between: held, not asked.
  const hid = make(p => p.y >= 64 && (p.x !== -1 || p.z < -3 || p.z > 3));
  await hid.survival.stanceStep(new Task('t'), {}, () => {}, [threat(hid.bot, hid.skeleton)], false);
  assert.equal(hid.asked(), null);
});

test('a bunker that takes five seconds or more to dig is offered with its seconds said, not hidden', () => {
  const open = p => p.y >= 64 && p.x < 1;
  const bot = rockWorld(open, ['wooden_pickaxe', 'cobblestone']);
  const zombie = { id: 5, name: 'zombie', type: 'hostile', position: new Vec3(-9.5, 64, 0.5), height: 1.95, isValid: true };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const ms = require('../src/bunker').bunkerDigMs(bot, zombie.position);
  assert(ms >= 5000, `${ms}`);
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, zombie)], false);
  assert(options.bunker, Object.keys(options).join(','));
  assert.match(options.bunker.description, new RegExp(`about ${Math.round(ms / 100) / 10} seconds of digging with the tools carried`));
});

test('the bunker says the wall it leaves for the lava behind it, and once dug is stayed in, not dug again (mid-244-ab, note 569)', async () => {
  // Rock east and south of the bot; lava over the third cell east's head.
  const bot = rockWorld(p => p.y >= 64 && p.x < 1 && p.z <= 0, ['iron_pickaxe']);
  const rock = bot.blockAt;
  bot.blockAt = p => { const f = p.floored(); return f.x === 3 && f.y === 66 && f.z === 0 ? { name: 'lava', boundingBox: 'empty', position: f } : rock(p); };
  const zombie = { id: 5, name: 'zombie', type: 'hostile', position: new Vec3(-9.5, 64, 0.5), height: 1.95, isValid: true };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, zombie)], false);
  assert(options.bunker, Object.keys(options).join(','));
  assert.match(options.bunker.description, /Not dug where there is lava behind the stone at \(3, 65, 0\): a cell opened there lets it in/);
  // Standing in the bunker it dug: the stance is to stay, with nothing to dig.
  survival.state.bunkerDug = { cells: [{ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: 1 }], inside: { x: 0, y: 64, z: 1 }, mouth: { x: 0, y: 64, z: 1 }, watch: { x: 0, y: 64, z: 0 }, at: Date.now(), dimension: 'overworld' };
  const held = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, zombie)], false);
  // After the hardest blow, said first on every stance (note 576).
  assert.match(held.bunker.description, /^The zombie \d+ blocks off hits for about 3 a blow[^]*?seconds\. Stay in the bunker already dug here/);
});

test('a NoRoute from an emergency walk is not persisted as the work step', async () => {
  // mid-202-o-nether-2 (note 500): survival held the turn for escape_threat, the last report an eat; its walk threw
  // "No route" to (89, 88, 115), two blocks under its own pocket's floor, and it was rethrown into the work, which
  // persisted it from attempt 1 to 12 in 28 seconds, nothing named, while health went from 18 to 4.8.
  const { persist } = require('../src/work');
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(89.5, 90, 115.5) }, entities: {}, health: 18, food: 19,
    game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [], slots: [] }, chat() {} });
  const controller = new Survival(bot, {});
  const noRoute = () => Object.assign(new Error('No route from here to (89, 88, 115) (partial)'), { name: 'NoRoute', destination: { x: 89, y: 88, z: 115 } });
  controller.stepOnce = async () => { throw noRoute(); };
  const goal = { kind: 'win', step: { action: 'return_to_blazes', target: { x: -91, y: 74, z: 53 } }, survivalAction: { action: 'eat', item: 'mutton', at: new Date().toISOString() } };
  assert.equal(await controller.step(new Task('survival'), goal, () => {}), false, 'survival\'s own, not thrown on to the work');
  assert.deepEqual(goal.step, { action: 'return_to_blazes', target: { x: -91, y: 74, z: 53 } }, 'the work step untouched');
  assert.match(controller.state.walkFailed.says, /a survival walk \(the last action reported: eat\) found no route to \(89, 88, 115\)/);
  assert.deepEqual(controller.state.walkFailed.destination, { x: 89, y: 88, z: 115 });
  // A fact on the survival claim, as a set-aside says it.
  const { claim } = require('../src/survival');
  bot.entities[3] = { id: 3, name: 'hoglin', type: 'hostile', position: new Vec3(89.5, 90, 117.5), height: 1.4, isValid: true };
  bot.world = { raycast: () => null };
  const said = claim(bot, goal, controller)?.facts?.setAside || {};
  assert.match(said.eat || '', /found no route to \(89, 88, 115\)/);
  // What the work does persist names what it retries and where it was going.
  let seen = null;
  const work = { step: { action: 'find_fortress', legs: 6 } };
  await persist(bot, new Task('work'), work, () => {}, noRoute(), g => { seen ||= { ...g.step }; }).catch(() => {});
  assert.deepEqual(seen, { action: 'persist', attempt: 1, problem: 'No route from here to (89, 88, 115) (partial)', retrying: 'find_fortress', destination: { x: 89, y: 88, z: 115 } });
});

test('the bed at night says a creeper coming as the shelter does (mid-243-p)', async () => {
  const { bot } = nookFixture({ open: p => p.y >= 30 });
  bot.time.timeOfDay = 13500;
  bot.entities[9] = { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(11.5, 30, 0.5), height: 1.7, isValid: true };
  bot.pathfinder = { movements: {}, getPathTo: () => ({ status: 'noPath', path: [] }), setGoal() {} };
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } } });
  let tree = null;
  survival.decide = async (task, goal, save, q) => { if (q.id === 'survival_priority') tree = tree || q.tree; return { path: [Object.keys(q.tree)[0]], action: Object.values(q.tree)[0], stale: true }; };
  survival.stanceStep = async () => false;
  await survival.step(new Task('night'), { kind: 'win', request: 'beat the game' }, () => {}).catch(() => {});
  const sleep = tree?.sleep_in_bed || tree?.sleep_in_nook;
  assert(sleep, Object.keys(tree || {}).join(','));
  assert.match(sleep.description, /A creeper is 11 blocks off: coming on, it could go off beside the bot in about/);
});

test('a fight that just failed stays on offer with a skeleton at arm\'s length, as with a biter (mid-239-g)', async () => {
  const bot = crowdBot({ health: 8 });
  const skeleton = crowdMob(1, 'skeleton', 1.7);
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } }, state: { shelters: [] } });
  const feet = bot.entity.position.floored();
  survival.state.stanceFailed = [{ choice: 'fight', where: { x: feet.x, y: feet.y, z: feet.z }, at: Date.now() - 500 }];
  let q = null;
  survival.decide = async (task, goal, save, question) => { q = q || question; return { path: ['fight'], action: question.tree.fight || Object.values(question.tree)[0], stale: true }; };
  await survival.stanceStep(new Task('t'), {}, () => {}, [skeleton], false).catch(() => {});
  assert(q?.tree?.fight, Object.keys(q?.tree || {}).join(','));
});

test('on the surface by day, hurt, with no food and no healing: waiting sealed for daylight is offered, priced in minutes and about no hunger (note 515)', async () => {
  // mid-231-q and mid-211-x went on hunting and working hurt under eighteen hunger with nothing safe to eat; sealing in was offered only underground at night.
  const { bot } = nookFixture({ time: 6000, items: [{ name: 'iron_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], open: p => p.y >= 30 });
  bot.health = 6; bot.food = 14; bot.pathfinder = { movements: {}, getPathTo: () => ({ status: 'noPath', path: [] }), setGoal() {} };
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {}, explore: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } } });
  let tree = null, state = null;
  survival.decide = async (task, goal, save, q) => { if (q.id === 'survival_priority') { tree = tree || q.tree; state = state || q.state; } return { path: ['continue_request'], action: q.tree.continue_request || Object.values(q.tree)[0], stale: true }; };
  await survival.step(new Task('hurt'), { kind: 'win', request: 'beat the game' }, () => {});
  assert(tree?.wait_for_day_sealed, Object.keys(tree || {}).join(','));
  assert.equal(tree.secure_shelter, undefined, 'by day no night shelter is on offer');
  assert.match(tree.wait_for_day_sealed.description, /wait in it for daylight, about 14 real minutes off: it is day now, so the wait runs through dusk and the whole night.*6 health, which does not come back meanwhile \(hunger 14, below eighteen\), and standing still in it spends no hunger/);
  // Health that comes back is no such wait.
  bot.food = 18; tree = null;
  await survival.step(new Task('fed'), { kind: 'win', request: 'beat the game' }, () => {});
  assert.equal(tree?.wait_for_day_sealed, undefined);
});

// A fortress of nether brick, blocks from the registry so their dig times
// are the game's; `solid` says where the brick is, `lava` where lava is.
function brickWorld(solid, { lava = () => false, spawner = null, items = ['iron_sword', 'iron_pickaxe', 'netherrack'] } = {}) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const cache = new Map();
  const blockAt = p => {
    const f = p.floored(), key = `${f}`;
    if (!cache.has(key)) {
      const name = spawner && f.equals(spawner) ? 'spawner' : lava(f) ? 'lava' : solid(f) ? 'nether_bricks' : 'air';
      const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f; cache.set(key, b);
    }
    return cache.get(key);
  };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => items.map(name => ({ name, type: registry.itemsByName[name].id, count: /pickaxe|sword/.test(name) ? 1 : 64, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {} } });
  bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point }) => {
    const ids = [].concat(matching), at = point || bot.entity.position, out = [];
    for (let x = -12; x <= 12; x++) for (let y = -3; y <= 3; y++) for (let z = -12; z <= 12; z++) {
      const p = at.floored().offset(x, y, z);
      if (p.distanceTo(at) <= maxDistance && ids.includes(blockAt(p).type)) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(at) - b.distanceTo(at)).slice(0, count);
  };
  return bot;
}
const blazeAt = (id, x, y, z) => ({ id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, isValid: true });

test('the stands against a blaze are priced with a biter out of sight that has a way to the bot (mid-242-ac-nether-1-fortress-1, note 559)', () => {
  // back_to_wall read "about 0 damage ... none of them reaches it" with a wither skeleton five blocks off round a corner; it struck a second later.
  const solid = p => p.y <= 63 || (p.x <= -1 && p.y <= 67);
  const make = withSkeleton => {
    const bot = brickWorld(solid);
    const blaze = blazeAt(3, 8.5, 64.5, 0.5);
    const skeleton = { id: 4, name: 'wither_skeleton', type: 'hostile', position: new Vec3(0.5, 64, 4.5), height: 2.4, width: 0.7, isValid: true };
    bot.entities = withSkeleton ? { 3: blaze, 4: skeleton } : { 3: blaze };
    // Rays toward the south are stopped: the skeleton is round the corner.
    bot.world = { raycast: (from, dir) => (dir.z > 0.3 ? { position: from.offset(0, 0, 1).floored(), intersect: from.offset(0, 0, 1) } : null) };
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
    return survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, blaze)], false);
  };
  const alone = make(false), round = make(true);
  assert(alone.back_to_wall && round.back_to_wall, Object.keys(round).join(','));
  assert.match(alone.back_to_wall.description, /Back to the wall, the blaze still reaches it\./);
  assert.match(round.back_to_wall.description, /Back to the wall, the wither skeleton and the blaze still reach it\./);
  assert(round.back_to_wall.expects.damage > alone.back_to_wall.expects.damage + 5, `${round.back_to_wall.expects.damage} vs ${alone.back_to_wall.expects.damage}`);
});

test('at a blaze fight on the way to the rods, every stance says what it gains toward them, the charge is offered without a shield, and the fight says which it prices (mid-242-aa-fortress-5, note 614)', () => {
  // 15:16:45: a stone sword, no armour, no shield, 20 health; one blaze 4.3
  // off in sight, more behind the walls. Offered cover, holds, heal and
  // retreat, each priced in damage alone; chose cover and heal again and
  // again. The fight said "to kill them all" of the one in sight.
  const make = goal => {
    const bot = brickWorld(p => p.y <= 63, { items: ['stone_sword', 'cobblestone'] });
    bot.inventory.slots = {};
    const blaze = blazeAt(3, 4.8, 64.5, 0.5);
    const hidden = [blazeAt(4, -9.5, 65, 4.5), blazeAt(5, -10.5, 65, -3.5)];
    bot.entities = { 3: blaze, 4: hidden[0], 5: hidden[1] };
    bot.world = { raycast: (from, dir, len) => { const to = from.plus(dir.scaled(len)); return hidden.some(h => h.position.distanceTo(to) < 2.5 || h.position.distanceTo(from) < 2.5) ? { position: from.plus(dir).floored(), intersect: from.plus(dir) } : null; } };
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
    return survival.stanceOptions(new Task('x'), goal, () => {}, [threat(bot, blaze)], false);
  };
  const options = make({ mobHunt: { item: 'blaze_rod', entity: 'blaze', targetCount: 8 }, step: { action: 'leave_and_heal' } });
  assert(options.close_in && options.charge_nearest, Object.keys(options).join(','));
  assert.match(options.charge_nearest.description, /no shield carried: walk straight in on it/);
  assert.match(options.charge_nearest.description, /Toward the rods: about 1 blaze killed/);
  assert.match(options.fight.description, /damage to kill the one in these figures, not those out of sight below, from 20 health/);
  assert.match(options.fight.description, /Toward the rods: about 1 blaze killed in about [\d.]+ seconds?, about 0\.5 rods on the average \(a blaze drops one about half the time\); 8 rods still needed/);
  for (const k of ['take_cover', 'retreat', 'seal', 'dig_down'].filter(k => options[k])) assert.match(options[k].description, /Toward the rods: none, no blaze killed; the blazes stay, and waiting does not send them away; 8 rods still needed\./, k);
  assert(options.take_cover || options.retreat, Object.keys(options).join(','));
  for (const [k, o] of Object.entries(options)) if (k !== 'none_good') assert.equal((o.description.match(/Toward the rods:/g) || []).length, 1, k);
  // No rods wanted: nothing said.
  const plain = make({});
  for (const [k, o] of Object.entries(plain)) assert.doesNotMatch(o.description, /Toward the rods/, k);
});

test('with a blaze in sight beside a nether-brick wall, the stance offers a hole dug into it, its seconds from the pickaxe carried, and the wall at the back (notes 509, 512, 514)', async () => {
  // Brick floor, a brick mass to the west (x <= -1), open to the east where the blaze is.
  const solid = p => p.y <= 63 || (p.x <= -1 && p.y <= 67);
  const make = pick => {
    const bot = brickWorld(solid, { items: ['iron_sword', pick, 'netherrack'] });
    const blaze = blazeAt(3, 8.5, 64.5, 0.5);
    bot.entities = { 3: blaze };
    const dug = [];
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
    bot.dig = async b => { dug.push(`${b.position}`); };
    return { bot, blaze, dug, options: survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, blaze)], false) };
  };
  const { bot, options, dug } = make('iron_pickaxe');
  assert(options.dig_in_and_fight, Object.keys(options).join(','));
  const { blockDigMs } = require('../src/bunker');
  const secs = Math.round(2 * blockDigMs(bot, bot.blockAt(new Vec3(-1, 64, 0))) / 100) / 10;
  assert.match(options.dig_in_and_fight.description, new RegExp(`^Dig a hole one wide and two high into the nether bricks beside the bot \\(2 blocks with the iron pickaxe, about ${secs} seconds? of digging`));
  assert.match(options.dig_in_and_fight.description, /a fireball's push there meets rock, not a drop; only a blaze in line with the mouth can shoot in/);
  assert.match(options.dig_in_and_fight.description, /within two blocks it swings for 6 before armour instead of shooting/);
  assert.match(options.dig_in_and_fight.description, /A blaze's fireball lands about \d+ in 100 from 8 blocks/);
  assert.match(options.dig_in_and_fight.description, /About [\d.]+ damage from the mobs here in the next [\d.]+ seconds this way \(fifteen held after the digging in\)/);
  assert(options.dig_in_and_fight.expects.damage >= 0);
  // A wooden pickaxe digs brick slower, and says so.
  const wooden = make('wooden_pickaxe').options.dig_in_and_fight.description;
  assert(Number(/about ([\d.]+) seconds? of digging/.exec(wooden)[1]) > secs, wooden);
  // The wall at the back, where the bot stands: rock west, the blaze east, no drop within a push.
  assert(options.back_to_wall, Object.keys(options).join(','));
  assert.match(options.back_to_wall.description, /^Stay on footing with a wall at its back on the side away from the blazes and no drop or lava within 2 blocks, and fight there: a fireball from them pushes the bot into the wall/);
  // Taken: the two blocks dug, the bot steps in; held, it stays.
  bot.setControlState = (key, on) => { if (key === 'forward' && on) bot.entity.position = new Vec3(-0.5, 64, 0.5); };
  bot.clearControlStates = () => {}; bot.lookAt = async () => {}; bot.equip = async () => {};
  assert.equal(await options.dig_in_and_fight.run(), true);
  assert.deepEqual(dug, ['(-1, 65, 0)', '(-1, 64, 0)']);
});

test('in a hole already, the stance is to stay and fight from inside; with a spawner near under a ceiling, its cage is offered too', () => {
  // The bot in a one-wide hole in the brick at x = -1, its mouth east; a
  // room two high to the east with a spawner at (4, 64, 3) under the roof.
  const hole = new Vec3(-1, 64, 0);
  const solid = p => p.y <= 63 || p.y >= 66 || (p.x <= -1 && !(p.x === hole.x && p.z === hole.z && p.y <= 65));
  const bot = brickWorld(solid, { spawner: new Vec3(4, 64, 3) });
  bot.entity.position = new Vec3(-0.5, 64, 0.5);
  const blaze = blazeAt(3, 6.5, 64.2, 0.5);
  bot.entities = { 3: blaze };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, blaze)], false);
  assert(options.dig_in_and_fight, Object.keys(options).join(','));
  assert.match(options.dig_in_and_fight.description, /^Stay in the hole the bot is in and fight from inside/);
  assert(options.fight_at_spawner, Object.keys(options).join(','));
  assert.match(options.fight_at_spawner.description, /^Walk \d+ blocks? \(about [\d.]+ seconds?, in their fire meanwhile\) to a cell [\d.]+ blocks from the blaze spawner's cage, under a ceiling, with no drop or lava within a push/);
  const { spawnerSite } = require('../src/blaze-stand');
  const site = spawnerSite(bot);
  assert(site.off <= 3 && bot.blockAt(site.cell.offset(0, 2, 0)).boundingBox === 'block', 'within three of the cage, a block over the head');
});

test('a sealed pocket with blazes about offers its wall opened toward them, fought from inside (mid-235-p-fortress-4)', () => {
  // mid-235-p-fortress-4 sat twenty-two minutes sealed ten blocks from a spawner, blazes five to seven off, offered only to stay or leave.
  const pocket = new Vec3(0, 64, 0);
  const solid = p => !(p.x === pocket.x && p.z === pocket.z && (p.y === 64 || p.y === 65)) && (p.y <= 63 || Math.abs(p.x) <= 1 && Math.abs(p.z) <= 1 && p.y <= 66);
  const bot = brickWorld(solid);
  const blaze = blazeAt(3, 7.5, 64.5, 0.5);
  bot.entities = { 3: blaze };
  const { blazeStands } = require('../src/blaze-stand');
  const { threats } = require('../src/danger');
  const window = blazeStands(bot, threats(bot, 24), { pocket: true }).dig_in_and_fight;
  assert(window, 'offered');
  assert.deepEqual(window.site.window.map(String), ['(1, 65, 0)', '(1, 64, 0)'], 'the wall toward the blaze, head and feet');
  assert.match(window.description, /^Open the pocket's wall toward the blazes, one wide and two high \(2 blocks of nether bricks with the iron pickaxe, about [\d.]+ seconds? of digging\), and fight from inside the pocket through it\./);
});

test('the pocket\'s window is priced over its digging and fifteen held after, with every blaze within forty-eight that sees in or settles into its line (mid-235-q-nether-3, note 548)', () => {
  // mid-235-q-nether-3 opened its pocket's wall toward eight blazes told none of the two in sight would see in; one twenty
  // blocks out came down to its height square in front of the mouth and shot it from 7 to none.
  const pocket = new Vec3(0, 64, 0);
  const solid = p => !(p.x === pocket.x && p.z === pocket.z && (p.y === 64 || p.y === 65)) && (p.y <= 63 || Math.abs(p.x) <= 1 && Math.abs(p.z) <= 1 && p.y <= 66);
  const { blazeStands } = require('../src/blaze-stand');
  const { threats } = require('../src/danger');
  // A brick pillar twenty out, from three over the floor up: over the line at the bot's height, across one from above.
  const walled = p => solid(p) || p.x === 20 && p.y >= 67 && p.y <= 76 && Math.abs(p.z) <= 2;
  const windowWith = far => {
    const bot = brickWorld(walled);
    bot.health = 7;
    // Lines stopped by the brick, stepped a tenth of a block at a time.
    bot.world.raycast = (from, dir, len) => {
      for (let t = 0; t <= len; t += 0.1) { const at = from.plus(dir.scaled(t)); if (walled(at.floored())) return { position: at.floored(), intersect: at }; }
      return null;
    };
    bot.entities = { 3: blazeAt(3, 7.5, 64.5, 0.5), ...Object.fromEntries(far.map((p, i) => [10 + i, blazeAt(10 + i, ...p)])) };
    return blazeStands(bot, threats(bot, 24), { pocket: true }).dig_in_and_fight;
  };
  const near = windowWith([]);
  // One thirty blocks out in front of the mouth, eight over its line, the pillar across it; one behind the pocket's rock to the west.
  const window = windowWith([[30.5, 72.5, 0.5], [-30.5, 64.5, 0.5]]);
  assert.match(window.description, /Of the 3 blazes within their forty-eight blocks, 2 have a line in through the mouth: 1 now, and 1 at the bot's own height, where a blaze after a target hovers/);
  assert(window.expects.damage > near.expects.damage, `the one that settles in front is priced: ${window.expects.damage} over ${near.expects.damage}`);
  assert(window.expects.seconds > 15, 'the fifteen held come after the digging');
  assert.match(window.description, /in the next [\d.]+ seconds this way \(fifteen held after the opening\), the [\d.]+ seconds of opening it included/);
});

test('sealed with blazes about, the window chosen is dug once and the pocket asked again after; the blazes past sixteen are said (mid-235-q-nether-3, note 548)', async () => {
  // mid-235-q-nether-3's window, chosen once, was dug three times in a minute and a half, never asked again; its stay
  // said nothing watched the pocket, eight blazes twenty to twenty-eight blocks off.
  const pocket = new Vec3(0, 64, 0);
  const solid = p => !(p.x === pocket.x && p.z === pocket.z && (p.y === 64 || p.y === 65)) && (p.y <= 63 || Math.abs(p.x) <= 1 && Math.abs(p.z) <= 1 && p.y <= 66);
  const bot = brickWorld(solid);
  Object.assign(bot, { health: 7, food: 14, oxygenLevel: 20 });
  bot.game.minY = 0; bot.game.height = 256;
  bot.entity.velocity = new Vec3(0, 0, 0);
  bot.inventory.emptySlotCount = () => 10;
  bot.findBlocks = () => [];
  bot.pathfinder = { movements: {}, getPathTo: () => ({ status: 'noPath', path: [] }), setGoal() {} };
  bot.entities = { 3: blazeAt(3, 7.5, 64.5, 0.5), 4: blazeAt(4, 24.5, 70.5, 0.5) };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {}, explore: async () => {} },
    { state: { shelters: [{ origin: { x: 0, y: 64, z: 0 }, dimension: 'the_nether' }] }, client: { systemOne: async () => ({}) } });
  const asked = [];
  // The window when offered (the stub digs nothing, so its run does nothing and it rests a minute after).
  survival.decide = async (task, g, save, q) => { if (q.id === 'pocket_next') asked.push(q.tree); return { path: q.id === 'pocket_next' ? [q.tree.dig_in_and_fight ? 'dig_in_and_fight' : 'stay'] : [Object.keys(q.tree)[0]], stale: q.id !== 'pocket_next' }; };
  survival.wait = async () => {};
  await survival.step(new Task('p'), { kind: 'win' }, () => {});
  assert.equal(asked.length, 1);
  assert(asked[0].dig_in_and_fight, Object.keys(asked[0]).join(','));
  assert.equal(survival.state.pocketPlan, undefined, 'the window is not held as the plan for ninety seconds');
  assert.match(asked[0].stay.description, /Beyond, 1 blaze 25 blocks off, within the reach they fire from at what they see \(a blaze 48 blocks\): the pocket's rock stops them/);
  // At 7 health one landing is 2.5 and four ticks of fire, 6.5: it takes two (note 631; 1 when the fire was counted as five).
  assert.match(asked[0].leave.description, /(about|or) 2 blaze fireballs that land \(about [\d.]+ each after armour, and the 5 seconds of fire the first sets, about 4 more health: 6\.5 for one landing\)/);
  await survival.step(new Task('p'), { kind: 'win' }, () => {});
  assert.equal(asked.length, 2, 'sealed again, the pocket is a new question');
});

test('beside a drop into lava with a blaze about, the stances say its fireball\'s push against the drop (note 469\'s pattern)', () => {
  // A brick bridge at y 63, x from -1 to 1, over the lava sea at y 40: the bot at its east edge, the lava one block off.
  const solid = p => p.y === 63 && Math.abs(p.x) <= 1;
  const bot = brickWorld(solid, { lava: p => p.y <= 40 });
  bot.entity.position = new Vec3(1.5, 64, 0.5);
  const blaze = blazeAt(3, 10.5, 66, 0.5);
  bot.entities = { 3: blaze };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, blaze)], false);
  assert.match(options.fight.description, /A blaze's fireball that lands pushes the bot about 2 blocks, shield raised or not; the drop into lava is 1 block off: one that lands puts it over\./);
  assert.equal(options.back_to_wall, undefined, 'no wall on the bridge, and every cell a push from the lava');
});

// mid-226-h (note 520): a skeleton stood in a wall cell of the pocket at 1.5 to 2.1 blocks and shot the bot from 17.1 to none in
// forty seconds; each seal_shelter pass began at its cell, threw "Placement obstructed", and began there again.
const skeletonInWall = () => ({ id: 9, name: 'skeleton', type: 'hostile', position: new Vec3(-0.4, 65, 0.6), height: 1.99, width: 0.6, isValid: true });
function wallBot(skeleton, placed = new Set()) {
  const registry = require('minecraft-data')('26.1');
  const solid = p => p.y < 64 || placed.has(`${p.floored()}`);
  return Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 }, registry,
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, entities: { 9: skeleton }, health: 17, food: 17, oxygenLevel: 20,
    time: { timeOfDay: 17000 }, world: { raycast: () => null }, findBlocks: () => [], heldItem: null,
    inventory: { items: () => [{ name: 'diamond_sword', count: 1 }, { name: 'dirt', count: 60 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    blockAt: p => ({ position: p.floored(), name: solid(p) ? (p.y < 64 ? 'stone' : 'dirt') : 'air', boundingBox: solid(p) ? 'block' : 'empty', diggable: true }),
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, getControlState: () => false, lookAt: async () => {}, equip: async () => {}, attack() {} });
}

test('a seal pass leaves the cell a mob stands in and says it, rather than beginning there again (mid-226-h, note 520)', async () => {
  const skeleton = skeletonInWall(), placed = new Set(), tried = [];
  const bot = wallBot(skeleton, placed);
  const { occupant, occupiedSays } = require('../src/work');
  const state = { shelters: [{ origin: { x: 0, y: 64, z: 0 }, dimension: 'overworld' }] };
  const controller = new Survival(bot, { navigate: async () => {}, dig: async () => {},
    // As the real placing does: no block where a body is.
    place: async (b, t, p) => { tried.push(`${p}`); const body = occupant(bot, p); if (body) throw new Error(`Placement obstructed: ${occupiedSays(body, p)}`); placed.add(`${p}`); } }, { state });
  const goal = { survival: state };
  assert.equal(await controller.refugeStep(new Task('night'), goal, () => {}), false, 'not sealed: the skeleton is in its wall');
  assert(!tried.includes('(-1, 65, 0)'), 'the skeleton\'s cell is not placed at');
  assert(!tried.includes('(-1, 66, 0)'), 'nor the roof cell its head is in');
  assert.equal(placed.size, 23, 'every other cell of the shell is');
  assert.equal(goal.survivalAction?.action, 'seal_failed');
  assert.match(goal.survivalAction.error, /a skeleton stands in the cell at \(-1, 65, 0\), and the game puts no block where a body is/);
  assert.ok(bot._sealPlaced, 'the blocks placed are the hold\'s results');
  const before = tried.length;
  assert.equal(await controller.refugeStep(new Task('night'), goal, () => {}), false);
  assert.equal(tried.length, before, 'not begun again at once');
});

test('a mob at arm\'s length while sealing goes to the stance, told how much of the pocket stands and the cell the mob is in (mid-226-h, note 520)', async () => {
  const skeleton = skeletonInWall();
  const bot = wallBot(skeleton);
  const state = { shelters: [{ origin: { x: 0, y: 64, z: 0 }, dimension: 'overworld', emergency: true }], sealing: { origin: { x: 0, y: 64, z: 0 }, at: Date.now() } };
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { state });
  const went = [];
  survival.refugeStep = async () => { went.push('seal'); };
  survival.flee = async () => { went.push('stance'); };
  await survival.step(new Task('night'), { kind: 'win' }, () => {});
  assert.deepEqual(went, ['stance'], 'the skeleton at 1.6 blocks is answered, not sealed against');
  // And the stance says the pocket's state, with the seal and in the state.
  let asked;
  survival.decide = async (task, goal, save, q) => { asked = q; return { path: ['seal'], stale: false }; };
  survival.sealHere = async () => true;
  const danger = [{ entity: skeleton, distance: 1.1, visible: true }];
  await survival.stanceStep(new Task('night'), {}, () => {}, danger, false);
  assert.equal(asked?.id, 'encounter_stance');
  assert.match(asked.tree.seal.description, /The pocket here is 9 of 34 blocks; a skeleton stands in the cells at \(-1, 65, 0\) and \(-1, 66, 0\), and no block goes where a body is, so it does not close while it stays there\./);
  assert.deepEqual(asked.state.pocketHere.mobInCells.map(c => c.cell), [{ x: -1, y: 65, z: 0 }, { x: -1, y: 66, z: 0 }]);
});

test('the claim for the mob at arm\'s length says the pocket being sealed and the mob in its wall (mid-226-h, note 520)', () => {
  const { claim } = require('../src/survival');
  const { claimSays } = require('../src/arbiter');
  const skeleton = skeletonInWall();
  const bot = wallBot(skeleton);
  bot._recentHurtAt = Date.now();
  const survival = new Survival(bot, {}, { state: { shelters: [], sealing: { origin: { x: 0, y: 64, z: 0 }, at: Date.now() } } });
  const c = claim(bot, { kind: 'win' }, survival);
  assert.equal(c?.action, 'escape_threat');
  assert.match(claimSays(c), /The pocket here is 9 of 34 blocks; a skeleton stands in the cells at \(-1, 65, 0\) and \(-1, 66, 0\)/);
});

// mid-205-v: a one-wide column five up over a cave floor, walkers held below it, a skeleton shooting (note 525).
function columnBot({ stair = false } = {}) {
  const solid = new Set();
  for (let y = 60; y <= 64; y++) solid.add(`0,${y},0`);
  if (stair) for (let x = 1; x <= 4; x++) for (let y = 60; y <= 64 - x; y++) solid.add(`${x},${y},0`);
  const isSolid = f => f.y < 60 || solid.has(`${f.x},${f.y},${f.z}`);
  const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].map(name => ({ name }));
  return Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, health: 14.9, food: 20, foodSaturation: 5, entities: {}, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(0.5, 65, 0.5), onGround: true }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }], slots: { 5: iron[0], 6: iron[1], 7: iron[2], 8: iron[3], 45: { name: 'shield' } } },
    blockAt: p => { const f = p.floored(); return { position: f, name: isSolid(f) ? 'stone' : 'air', boundingBox: isSolid(f) ? 'block' : 'empty', diggable: true }; },
    world: { raycast: () => null }, findBlocks: () => [] });
}
const below = (bot, id, name, x, z) => { const position = new Vec3(x, 60, z); return { entity: { id, name, position, height: name === 'skeleton' ? 1.99 : 1.95, ...(name === 'skeleton' ? { heldItem: { name: 'bow' } } : {}) }, distance: position.distanceTo(bot.entity.position), visible: true }; };
const columnCrowd = bot => [below(bot, 1, 'creeper', -2.5, 0.5), below(bot, 2, 'zombie', 3.5, 0.5), below(bot, 3, 'zombie', 0.5, -2.5), below(bot, 4, 'zombie_villager', 2.5, 2.5), below(bot, 5, 'skeleton', -8.5, 0.5)]
  .sort((a, b) => a.distance - b.distance);

test('walkers with no way up to the bot are said so and left out of every stance\'s figures; a stair up to it counts them again', () => {
  const bot = columnBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, columnCrowd(bot), false);
  const damage = o => Number((o.description.match(/About ([\d.]+) damage from the mobs here/) || [])[1]);
  // Cover from the skeleton was priced at about 144 with eight walkers counted at the bot.
  assert(damage(options.take_cover) < 5, options.take_cover.description);
  assert.match(options.take_cover.description, /zombie villager, the creeper and 2 zombies, 5 blocks below the bot's feet, have no way to the bot/);
  assert.doesNotMatch(options.seal.description, /can be at the bot in about|walks up to whatever is built/);
  assert.doesNotMatch(options.pillar.description, /creeper .* can go off beside the bot/);
  assert.match(options.fight.description, /every one that can get to the bot shoots, none is at reach.*standing in their line of fire/);
  assert.match(options.keep_working.description, /have no way to the bot/);

  const open = columnBot({ stair: true });
  const survival2 = new Survival(open, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const counted = survival2.stanceOptions(new Task('x'), {}, () => {}, columnCrowd(open), false);
  assert.doesNotMatch(counted.take_cover.description, /no way to the bot/);
  assert(damage(counted.take_cover) > 10, counted.take_cover.description);
});

// mid-244-ad-nether-2 (note 560): the bot on its own one-wide bridge over a valley twenty deep, a sword piglin on the
// slope six blocks off and two below. Every stance priced it at the bot, the pillar was chosen every fifteen seconds
// for minutes, and nothing said the crossing waited.
function bridgeBot(bridgeFrom) {
  const isSolid = f => f.y < 40 || (f.x >= 3 && f.x <= 14 && f.z >= 5 && f.z <= 14 && f.y <= 62) || (f.y === 64 && f.z === 0 && f.x >= bridgeFrom && f.x <= 0);
  const iron = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].map(name => ({ name }));
  return Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, foodSaturation: 5, entities: {}, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(0.5, 65, 0.5), onGround: true }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }], slots: { 5: iron[0], 6: iron[1], 7: iron[2], 8: iron[3], 45: { name: 'shield' } } },
    blockAt: p => { const f = p.floored(); return { position: f, name: isSolid(f) ? (f.y === 64 ? 'cobblestone' : 'netherrack') : 'air', boundingBox: isSolid(f) ? 'block' : 'empty', diggable: true }; },
    world: { raycast: () => null }, findBlocks: () => [] });
}
const onSlope = (bot, held) => { const position = new Vec3(4.5, 63, 6.5); return [{ entity: { id: 7, name: 'piglin', position, height: 1.95, heldItem: { name: held } }, distance: position.distanceTo(bot.entity.position), visible: true }]; };

test('a sword piglin on the slope with no way onto the bridge is said first where the work goes on, and every stance says the work waits', () => {
  for (const [from, sure] of [[-6, true], [-30, false]]) {
    const bot = bridgeBot(from);
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
    const goal = { step: { action: 'cross_toward' } };
    const options = survival.stanceOptions(new Task('x'), goal, () => {}, onSlope(bot, 'golden_sword'), false);
    assert.ok(options.keep_working, 'carrying on is offered');
    const says = sure ? /^The piglin \(holding golden sword, no crossbow: it hits at arm's length only\), 2 blocks below the bot's feet, has no way to the bot/
      : /^The piglin 7\.5 blocks off, 2 below the bot's feet, \(holding golden sword, no crossbow: it hits at arm's length only\) has no way to the bot within 12 blocks of it: any way it has goes round, \d+ blocks of walking or more/;
    assert.match(options.keep_working.description, says, `${from}: ${options.keep_working.description}`);
    for (const [k, o] of Object.entries(options)) if (k !== 'keep_working') assert.match(o.description, /The work \(cross toward\) waits meanwhile/, k);
  }
  // With a crossbow it shoots: no walker, and nothing says it cannot get to the bot.
  const bot = bridgeBot(-30);
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), { step: { action: 'cross_toward' } }, () => {}, onSlope(bot, 'crossbow'), false);
  assert.doesNotMatch(Object.values(options).map(o => o.description).join(' '), /no way to the bot/);
});

// Note 566: the same bridge, with ground to step to. `land` at the bridge's own start, across the valley from the
// piglin; `level`, the slope raised to the bridge's height, still a gap from it, so the piglin can walk onto it.
function groundBridgeBot({ land = false, level = false } = {}) {
  const bot = bridgeBot(-6);
  const slopeTop = level ? 64 : 62;
  const isSolid = f => f.y < 40 || (f.x >= 3 && f.x <= 14 && f.z >= 5 && f.z <= 14 && f.y <= slopeTop) || (f.y === 64 && f.z === 0 && f.x >= -6 && f.x <= 0) ||
    (land && f.x >= -22 && f.x <= -7 && f.z >= -8 && f.z <= 8 && f.y <= 64);
  bot.blockAt = p => { const f = p.floored(); return { position: f, name: isSolid(f) ? (f.y === 64 && f.z === 0 && f.x <= 0 && f.x >= -6 ? 'cobblestone' : 'netherrack') : 'air', boundingBox: isSolid(f) ? 'block' : 'empty', diggable: true }; };
  return bot;
}
const piglinAt = (bot, y) => { const position = new Vec3(4.5, y, 6.5); return [{ entity: { id: 7, name: 'piglin', position, height: 1.95, heldItem: { name: 'golden_sword' } }, distance: position.distanceTo(bot.entity.position), visible: true }]; };

test('carrying on past a walker with no way to the bot says where the work stands and the others\' real reach, and firm ground says whether the walker can get there (note 566)', async () => {
  const goal = { step: { action: 'cross_toward', what: 'a fortress', target: { x: 0, y: 70, z: -80 }, bridge: 40 } };
  // Across the valley from the piglin: firm ground at the bridge's start.
  const bot = groundBridgeBot({ land: true });
  bot._stalls = { records: { [require('../src/stillness').actionOf(goal).key]: { idle: 1000 } } };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), goal, () => {}, piglinAt(bot, 63), false);
  const keep = options.keep_working.description;
  assert.doesNotMatch(keep, /nearest 8 blocks/, 'not priced by the piglin that cannot get to the bot');
  assert.match(keep, /Where the work stands: its target, a fortress, is 80 blocks off and 5 up; this stretch has 40 blocks to lay, 64 carried; it was making headway when these mobs stopped it/);
  assert.match(keep, /None of the mobs here can get to the bot, and none of them shoots: nothing here stops the work while that holds/);
  assert.ok(options.fight_from_footing, 'firm ground at the bridge\'s start is offered');
  assert.match(options.fight_from_footing.description, /The piglin 7 blocks off has no way to that ground either: nothing here comes to be fought there, and the fight stands and waits for one that does\./);
  assert.doesNotMatch(options.fight_from_footing.description, /the mobs hitting freely meanwhile/);
  // The question's state lists it apart, unpriced, and the risk leaves it out.
  let asked;
  survival.decide = async (task, g, save, q) => { asked = q; return { path: ['keep_working'], stale: false }; };
  await survival.stanceStep(new Task('x'), goal, () => {}, piglinAt(bot, 63), false);
  assert.equal(asked?.id, 'encounter_stance');
  assert.deepEqual(asked.state.threats, []);
  assert.deepEqual(asked.state.cannotGetToTheBot.map(t => t.name), ['piglin']);
  assert.equal(asked.state.estimate.fightHere.damageTaken, 0);

  // The slope level with the bridge: the piglin still has no way onto it, but it can walk onto the ground stepped to.
  const level = groundBridgeBot({ level: true });
  const survival2 = new Survival(level, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options2 = survival2.stanceOptions(new Task('x'), goal, () => {}, piglinAt(level, 65), false);
  assert.match(options2.keep_working.description, /^The piglin \(holding golden sword.*has no way to the bot/);
  assert.ok(options2.fight_from_footing, 'the slope is firm ground');
  assert.match(options2.fight_from_footing.description, /The piglin 7 blocks off, with no way to the bot here, is not kept from that ground \(a way there, or none the search can rule out\): stepping there can put the bot where it can get to it\./);
});

test('a retreat that finds no way says why to the next question', async () => {
  const bot = columnBot();
  bot.pathfinder = { movements: {}, setGoal: () => {} };
  bot.clearControlStates = () => {};
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  survival.scoutRetreat = async () => null;
  survival.escapeFootings = () => ({ about: [], footing: [], far: [], near: [], heavy: false, persistent: false });
  survival.decide = async () => ({ path: ['retreat'] });
  await survival.stanceStep(new Task('x'), {}, () => {}, columnCrowd(bot), false);
  const failed = survival.state.stanceFailed.find(f => f.choice === 'retreat');
  assert.match(failed?.why || '', /no footing near is further from every mob/);
});

test('a run says who follows it, at each one\'s speed from the jar, and is held no longer than its seconds (mid-239-b)', async () => {
  // mid-239-b ran ten blocks from a spider three off at seven health, told only that a way was found eleven blocks further from every mob;
  // the spider (3.9 blocks a second to a sprint's 5.6, and it climbs) was biting again three seconds after, and the held retreat ran again (note 532).
  const { blocksPerSecond, followRange, PLAYER_SPRINT } = require('../src/combat-estimate');
  assert.equal(Math.round(blocksPerSecond('spider') * 10) / 10, 3.9);
  assert.equal(Math.round(blocksPerSecond('zombie') * 10) / 10, 2.3);
  assert.equal(Math.round(blocksPerSecond('skeleton') * 10) / 10, 2.7);
  assert.equal(Math.round(PLAYER_SPRINT * 10) / 10, 5.6, 'the same model gives a player\'s sprint as measured');
  assert.equal(followRange('spider'), 16);
  assert.equal(followRange('zombie'), 35);
  const bot = crowdBot({ health: 7 });
  const footing = [new Vec3(0, 63, 14)];
  Object.assign(bot, { findBlocks: () => footing, pathfinder: { movements: {}, setGoal() {},
    getPathTo: () => ({ status: 'success', path: Array.from({ length: 14 }, (_, i) => new Vec3(0.5, 64, 1.5 + i)) }) }, clearControlStates() {} });
  const spider = { id: 1, name: 'spider', type: 'hostile', position: new Vec3(0.5, 64, -2.5), height: 0.9, isValid: true };
  bot.entities = { 1: spider };
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const danger = [{ entity: spider, distance: 3, visible: true }];
  await survival.scoutRetreat(new Task('dusk'), danger);
  const retreat = survival.stanceOptions(new Task('dusk'), {}, () => {}, danger, false).retreat;
  assert.match(retreat.description, /They follow a running player \(the bot sprints about 5\.6 blocks a second\): the spider 3 blocks off at about 3\.9 blocks a second, climbing walls: about \d+ blocks behind when the run ends, and at the bot about [\d.]+ seconds after/);
  assert.equal(retreat.expects?.seconds, 2.5, 'held for its run, then asked again');
  // No way looked for: the speeds and how far each follows.
  delete survival.state.retreatScout;
  const zombie = { id: 2, name: 'zombie', type: 'hostile', position: new Vec3(8.5, 64, 0.5), height: 1.95, isValid: true };
  const blind = survival.stanceOptions(new Task('dusk'), {}, () => {}, [{ entity: zombie, distance: 8, visible: true }], false).retreat;
  assert.match(blind.description, /the zombie 8 blocks off at about 2\.3 blocks a second, about 3\.3 a second slower than the run, and it gives up only more than 35 blocks behind/);
  assert.equal(blind.expects, undefined);
});

test('dig_down\'s race is at the biter\'s own speed: a spider is at the shaft\'s top sooner than a zombie as far', () => {
  const bot = crowdBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const spider = survival.stanceOptions(new Task('dusk'), {}, () => {}, [crowdMob(1, 'spider', 12)], false).dig_down.description;
  assert.match(spider, /The spider 12 blocks off can be at the shaft's top in about 3 seconds, before the lid/);
  const zombie = survival.stanceOptions(new Task('dusk'), {}, () => {}, [crowdMob(2, 'zombie', 8)], false).dig_down.description;
  assert.match(zombie, /The zombie 8 blocks off can be at the shaft's top in about 3 seconds, before the lid/);
});

test('knocked off the shaft it is digging, the bot steps back over it before the next block (mid-229-s)', async () => {
  // mid-229-s: an arrow put it half a block off the column as the first block came out, and the dig went on beside it,
  // two blocks down a hole it never dropped into, for five seconds under a skeleton's arrows until a zombie came (note 532).
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const dugCells = new Set();
  const blockAt = p => { const f = p.floored(); const name = dugCells.has(`${f}`) || f.y >= 63 ? 'air' : f.y >= 58 ? 'dirt' : 'stone'; const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f; return b; };
  const controls = {};
  const lowest = () => Math.min(63, ...[...dugCells].map(c => Number(c.replace(/[()]/g, '').split(',')[1])));
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entities: {}, registry, entity: { position: new Vec3(0.5, 63, 0.5), onGround: true },
    health: 11, inventory: { items: () => [{ name: 'cobblestone', count: 8 }, { name: 'iron_pickaxe', count: 1 }], slots: {} }, blockAt, world: { raycast: () => null },
    lookAt: async () => {}, getControlState: k => !!controls[k],
    // A step toward the shaft's middle: over the open cells, the bot drops to the lowest.
    setControlState(k, v) { controls[k] = v; if (k === 'forward' && v) this.entity.position = new Vec3(0.5, lowest(), 0.5); },
    clearControlStates() {} });
  const digs = [];
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {},
    dig: async (b, t, p) => {
      const at = bot.entity.position;
      const over = Math.floor(at.x) === p.x && Math.floor(at.z) === p.z;
      digs.push({ cell: `${p}`, over });
      dugCells.add(`${p}`);
      // The first block out: an arrow knocks the bot to the rim of the cell beside; after that it drops into what it digs.
      if (digs.length === 1) bot.entity.position = new Vec3(0.68, 63.4, -0.43);
      else if (over) bot.entity.position = new Vec3(at.x, p.y, at.z);
    } }, { state: { shelters: [] } });
  const column = survival.shaftColumn({ radius: 0 });
  assert(column.bottom, JSON.stringify(column));
  await survival.digShaft(new Task('stance'), {}, () => {}, { ...column, here: column.start, spot: 'x', stance: true });
  assert(digs.length >= 2, JSON.stringify(digs));
  assert(digs.slice(1).every(d => d.over), `every block after the knock is dug from over the shaft: ${JSON.stringify(digs)}`);
  assert.equal(Math.floor(bot.entity.position.z), 0, 'the bot ends in its shaft');
});

test('by a wall no blaze has a line to, the meal is priced by the lines to where the bot stands, as the wall is; a stand whose walk ends short says why (note 533)', async () => {
  // mid-235-p-nether-3 stood twenty seconds at 0.5 health and hunger 16 by a wall no blaze had a line to, mutton
  // carried: the wall was priced at 0 and the meal at 7.2 from blazes counted in sight a moment before; it never ate,
  // and the wall stance then failed forty times in seven seconds, each said as "it failed".
  const solid = p => p.y <= 63 || (p.x <= -1 && p.y <= 67);
  const bot = brickWorld(solid, { items: ['iron_sword', 'iron_pickaxe', 'netherrack', 'bread'] });
  bot.health = 0.5; bot.food = 16;
  const blaze = blazeAt(3, 3.5, 64.5, 0.5);
  bot.entities = { 3: blaze };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const inLine = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, blaze)], false);
  assert(inLine.eat, Object.keys(inLine).join(','));
  assert(inLine.eat.expects.damage > 0, 'in its line, the blaze shoots while the bot eats');
  // Rock between: no line from the blaze reaches the bot's cell, though it was counted in sight a moment ago.
  bot.world = { raycast: from => ({ position: from.floored(), intersect: from }) };
  const hidden = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, blaze)], false);
  assert.equal(hidden.eat.expects.damage, 0);
  assert.match(hidden.eat.description, /About 0 damage from the mobs here while it eats, from 0\.5 health\. Of the 1 shooter about, none has a line to the bot where it stands/);
  // The wall's walk ended short: said as why.
  const { blazeStands, takeStand } = require('../src/blaze-stand');
  bot.world = { raycast: () => null };
  bot.entity.position = new Vec3(2.5, 64, 0.5);
  const far = blazeAt(3, 8.5, 64.5, 0.5); bot.entities = { 3: far };
  const stands = blazeStands(bot, [threat(bot, far)]);
  assert(stands.back_to_wall, Object.keys(stands).join(','));
  await assert.rejects(takeStand(bot, new Task('x'), {}, () => {}, stands.back_to_wall, { navigate: async () => { throw new Error('No route'); } }),
    { name: 'StanceFailed', message: 'the walk to its cell at (0, 64, 0) ended 2 blocks short: No route' });
});

// mid-220-h (note 531): the night mine offered in the pocket at 99 uses with
// 110 kept for the climb out, chosen, refused inside, and the bot sat the
// night out, asked every five seconds; some 330 picks over the run.
function pocketAt40({ uses = 99, items = [] } = {}) {
  const origin = new Vec3(0, 40, 0);
  // Rock from y 40 to y 90 over the pocket: 2 * 50 + 16 = 116 kept for the climb.
  const solid = p => !(p.equals(origin) || p.equals(origin.offset(0, 1, 0))) && p.y <= 90;
  const registry = require('minecraft-data')('26.1');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 20, registry,
    time: { timeOfDay: 16000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1, durabilityUsed: 250 - uses }, { name: 'cobblestone', count: 32 }, ...items], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: solid(p) ? 'stone' : 'air', boundingBox: solid(p) ? 'block' : 'empty', position: p }), findBlocks: () => [],
    world: { raycast: () => null } });
  const survival = new Survival(bot, { acquireStep: async () => {}, dig: async () => {}, navigate: async () => {} },
    { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld' }] }, client: { systemOne: async () => ({}) } });
  survival.wait = async () => {};
  return { bot, survival };
}

test('a night mine that would not dig a block is not offered from the pocket, and the stay says why', async () => {
  const { survival } = pocketAt40({ uses: 99 });
  const asked = [];
  survival.decide = async (task, goal, save, { id, tree, state }) => { asked.push({ id, tree, state }); return { path: ['stay'], stale: false }; };
  await survival.step(new Task('night'), { kind: 'win', gameProgress: { phase: 'reach_nether' } }, () => {});
  const pocket = asked.find(a => a.id === 'pocket_next');
  assert(pocket, 'pocket_next is asked');
  assert(!pocket.tree.night_mine, 'under the uses kept for the climb and no spare to make: no mine on offer');
  assert.match(pocket.tree.stay.description, /No night mine from here: the best pickaxe has 99 uses left, under the 116 kept for a dug climb out from here/);
  assert.match(pocket.tree.stay.description, /the reach nether step \(the portal: no frame begun\) waiting/);
  assert.match(pocket.state.nightMineOff, /would not dig a block/);
  assert.equal(survival.canNightMine({ kind: 'win' }), false);
});

test('a night mine over the uses kept, or with a spare to make, is still offered', async () => {
  const { survival } = pocketAt40({ uses: 200 });
  assert.equal(survival.nightMineOff(), null, '200 uses, 116 kept: the mine digs');
  assert(survival.canNightMine({ kind: 'win' }));
  const spare = pocketAt40({ uses: 99, items: [{ name: 'stick', count: 2 }, { name: 'crafting_table', count: 1 }] }).survival;
  assert.equal(spare.nightMineOff(), null, 'a stone pickaxe can be made: the mine makes it first');
});

test('a pocket choice that did nothing is not offered again at once, and why is said', async () => {
  const { survival } = pocketAt40({ uses: 200 });
  const asked = [];
  survival.nightMine = async () => false;
  survival.decide = async (task, goal, save, { id, tree, state }) => { asked.push({ id, tree, state }); return { path: [asked.length === 1 ? 'night_mine' : 'stay'], stale: false }; };
  const goal = { kind: 'win', gameProgress: { phase: 'reach_nether' } };
  await survival.step(new Task('night'), goal, () => {});
  await survival.step(new Task('night'), goal, () => {});
  const pockets = asked.filter(a => a.id === 'pocket_next');
  assert.equal(pockets.length, 2, 'asked again after the choice did nothing');
  // mid-202-q: fifty minutes of night mines, told the ore and not the run's minutes or the portal work waiting.
  assert.match(pockets[0].tree.night_mine?.description || '', /Until dawn is about 6 real minutes of the run, with the reach nether step \(the portal: no frame begun\) waiting/);
  assert.match(pockets[0].tree.leave.description, /go back to the reach nether step \(the portal: no frame begun\) in the dark/);
  assert(!pockets[1].tree.night_mine, 'the mine that did nothing rests');
  assert.match(pockets[1].state.notNow?.night_mine || '', /did nothing from this pocket; back in about \d+ seconds/);
});

test('underground at dusk, carrying on names the work and says the night changes nothing below; the shelter says what it holds up', async () => {
  const { SLEEP_DEBT_TICKS } = require('../src/survival');
  const open = p => p.y >= 20 && p.y <= 21 && Math.floor(p.z) === 0;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival', minY: -64, height: 384 }, entities: {}, time: { timeOfDay: 10000, age: 100000 + SLEEP_DEBT_TICKS + 1 },
    entity: { position: new Vec3(0.5, 20, 0.5) }, health: 20, food: 20, oxygenLevel: 20, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'cobblestone', count: 64 }], slots: {} }, heldItem: null, pathfinder: { movements: {}, setGoal() {} },
    blockAt: p => ({ name: open(p) || p.y > 80 ? 'air' : 'stone', boundingBox: open(p) || p.y > 80 ? 'empty' : 'block', position: p }), findBlocks: () => [], world: { raycast: () => null }, chat() {} });
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { state: { sleptAtAge: 100000 }, client: { systemOne: async () => ({}) } });
  const seen = [];
  survival.decide = async (task, goal, save, { tree }) => { seen.push(tree); return { path: ['continue_request'], action: tree.continue_request, stale: false }; };
  await survival.step(new Task('t', 'dusk'), { kind: 'win', request: 'beat the game', gameProgress: { phase: 'reach_nether' }, portalMethod: { kind: 'cast', near: { x: 30, y: 20, z: 0 } } }, () => {});
  assert.equal(seen.length, 1, 'two nights awake: the night is asked');
  const [tree] = seen;
  assert.match(tree.continue_request.description, /Keep on with the reach nether step \(the portal: no frame begun; to be cast from lava and water; the lava chosen 30 blocks off\) underground/);
  assert.match(tree.continue_request.description, /nightfall changes nothing down here/);
  assert.doesNotMatch(tree.continue_request.description, /while outside/);
  assert.match(tree.secure_shelter.description, /real minutes off: that much of the run with the reach nether step \(the portal: no frame begun; to be cast from lava and water; the lava chosen 30 blocks off\) waiting/);
  assert.match(tree.secure_shelter.description, /Underground the dark is the same at any hour/);
});

// Note 534: a block in a creeper's line. Its fuse burns only while it sees
// the bot (26.1.2 SwellGoal.tick, one ray eye to eye), and no sword kills a
// whole creeper inside its fuse; mid-241-a (4.8 health, a creeper coming on
// at 4.4, a wall at its back) was offered only stances that cost more than
// its health.
test('a block in a creeper\'s line is offered, priced by the seconds until the line is cut against its walk and fuse, and placed two high beside the bot', async () => {
  const placed = [];
  const bot = creeperBot();
  const blockAt = bot.blockAt;
  bot.blockAt = p => { const f = p.floored(); return placed.includes(`${f}`) ? { position: f, name: 'cobblestone', boundingBox: 'block' } : blockAt(p); };
  const survival = new Survival(bot, { place: async (b, t, p, m, opts) => { assert.equal(opts?.stay, true, 'placed where the bot stands'); placed.push(`${p.floored()}`); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const creeper = { entity: { id: 9, name: 'creeper', position: new Vec3(4.95, 64, 0.5), height: 1.7, width: 0.6 }, distance: 4.45, visible: true };
  bot.entities[9] = creeper.entity;
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [creeper], false);
  const o = options.block_creeper;
  assert(o, Object.keys(options).join(','));
  assert.match(o.description, /^Put 2 blocks, two high, in the line from the eyes of the creeper \(4\.5 blocks off\) to the bot's, beside the bot at head height: about 1\.2 seconds until the line is cut \(the second block\), 1\.2 for both, and stay behind it\./);
  assert.match(o.description, /its sight is one line from its eyes to the bot's, which any block stops; out of its sight the fuse burns back down a tick at a time/);
  assert.match(o.description, /It is not lit: at 3 blocks in about 0\.5 seconds at its walk, and it goes off 1\.5 seconds after that if it sees the bot\. The line is cut about 0\.8 seconds before it would go off\./);
  assert.match(o.description, /within 3 blocks of the bot the creeper stands where it is, lit or not, and out of its sight it does not light\. It is more than 3 off, so it walks on toward the bot round the block/);
  // Its way round, against the wall at the bot's back, comes within three
  // where the column still stops its line: there it stands (note 547).
  assert.match(o.description, /Here that point is about [\d.]+ blocks' walk from it, about [\d.]+ seconds, [\d.]+ blocks from the bot, where the block still stops its line: it stands there and does not light\./);
  assert.match(o.description, /Out of its sight three seconds on end, it forgets the bot/);
  assert.match(o.description, /If the bot backs off past 3 blocks from it, it walks round the block and lights again/);
  assert.equal(o.expects.damage, 0, 'nothing else here reaches it');
  assert(options.fight.expects.damage > 4.8, 'the fight still costs more than the bot has');
  assert.equal(await o.run(), true);
  assert.deepEqual(placed, ['(1, 64, 0)', '(1, 65, 0)'], 'the foot first, then the cell the line crosses');
  // Held, the line stopped: staying behind the block, nothing placed.
  survival.state.stance = { choice: 'block_creeper', at: Date.now() };
  const held = survival.stanceOptions(new Task('x'), {}, () => {}, [creeper], false);
  assert.match(held.block_creeper?.description || '', /^Stay behind the cobblestone at \(1, 65, 0\), in the line from the eyes of the creeper/);
  assert.equal(await held.block_creeper.run(), true);
  assert.equal(placed.length, 2);
  // Not held, a line already stopped is the same stance, staying behind that
  // block: mid-242-af-nether-3-fortress-1 stood on its bridge out of a
  // creeper's sight, was offered no way to stay there, and ran down into it
  // (note 604).
  delete survival.state.stance;
  assert.match(survival.stanceOptions(new Task('x'), {}, () => {}, [creeper], false).block_creeper?.description || '', /^Stay behind the cobblestone at \(1, 65, 0\), in the line from the eyes of the creeper/);
});

test('a creeper lit with too little fuse left for the block is said as too late, with its blast; one on a ledge above is cut over the head', () => {
  const registry = require('minecraft-data')('26.1'), keys = registry.entitiesByName.creeper.metadataKeys;
  const metadata = []; metadata[keys.indexOf('swell_dir')] = 1; metadata[keys.indexOf('health')] = 20;
  const lit = { id: 9, name: 'creeper', position: new Vec3(3.6, 64, 0.5), height: 1.7, width: 0.6, metadata };
  const bot = creeperBot({ health: 20, wall: false, creeper: lit });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  bot._creeperFuses.set(9, Date.now() - 1000);
  const late = survival.stanceOptions(new Task('x'), {}, () => {}, [{ entity: lit, distance: 3.1, visible: true }], false).block_creeper;
  assert.match(late.description, /It is lit, about 0\.5 seconds of its fuse left\. That is about 0\.7 seconds too late: it goes off first, about 3\.1 blocks off, about 12 after the armour worn\./);
  assert(late.expects.damage >= 11, JSON.stringify(late.expects));
  // Seen to light just now: in time.
  bot._creeperFuses.set(9, Date.now());
  assert.match(survival.stanceOptions(new Task('x'), {}, () => {}, [{ entity: lit, distance: 3.1, visible: true }], false).block_creeper.description, /The line is cut about 0\.3 seconds before it would go off/);
  // mid-241-a's creeper stood on a mineshaft's floor four above the bot's
  // feet, two across: the line crosses the column over the bot's head,
  // where a block goes against the wall beside it.
  const above = { id: 10, name: 'creeper', position: new Vec3(0.6, 68, 2.44), height: 1.7, width: 0.6 };
  const shaft = creeperBot({ creeper: above });
  shaft.blockAt = p => { const f = p.floored(); const solid = f.y < 64 || f.z < 0 || (f.y >= 64 && f.y < 68 && f.z >= 2); return { position: f, name: solid ? 'deepslate' : 'air', boundingBox: solid ? 'block' : 'empty' }; };
  const overhead = new Survival(shaft, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } })
    .stanceOptions(new Task('x'), {}, () => {}, [{ entity: above, distance: 4.4, visible: true }], false).block_creeper;
  assert.match(overhead?.description || '', /^Put a block in the line from the eyes of the creeper \(4\.4 blocks off\) to the bot's, over the bot's head: about 0\.6 seconds until the line is cut/);
});

test('no block is offered for a creeper with no cell between it and the bot, or none carried', () => {
  const close = { id: 9, name: 'creeper', position: new Vec3(1.3, 64, 0.5), height: 1.7, width: 0.6 };
  const bot = creeperBot({ creeper: close });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  assert.equal(survival.stanceOptions(new Task('x'), {}, () => {}, [{ entity: close, distance: 0.8, visible: true }], false).block_creeper, undefined);
  const far = { id: 9, name: 'creeper', position: new Vec3(4.95, 64, 0.5), height: 1.7, width: 0.6 };
  const bare = creeperBot({ creeper: far });
  bare.inventory.items = () => [{ name: 'iron_sword', count: 1 }];
  assert.equal(new Survival(bare, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } })
    .stanceOptions(new Task('x'), {}, () => {}, [{ entity: far, distance: 4.45, visible: true }], false).block_creeper, undefined);
});

// Note 547, mid-243-aa (25583, 2026-09-28 01:11:53 to 01:12:03): the block
// went in, and the creeper walked round it at three to four blocks; held on
// "the line is stopped", the stance put a block in each new line as it came
// round, four two-high columns in six seconds, never asking, until it came
// in lit at 1.7 blocks with the bot walled in by its own blocks, and one
// blast took 20 health through full iron.
test('a creeper past three is said to walk round the block to where it sees the bot, and the blast there is the price of staying (note 547)', () => {
  // The column goes in diagonally beside the bot; its way in comes within
  // three blocks with a line past it.
  const creeper = { id: 9, name: 'creeper', position: new Vec3(-2.5, 64, 4.5), height: 1.7, width: 0.6 };
  const bot = creeperBot({ wall: false, health: 20, creeper });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const o = survival.stanceOptions(new Task('x'), {}, () => {}, [{ entity: creeper, distance: creeper.position.distanceTo(bot.entity.position), visible: true }], false).block_creeper;
  assert(o);
  const { creeperWalk, blockPlan } = require('../src/creeper-sight');
  const walk = creeperWalk(bot, creeper, { planned: blockPlan(bot, creeper).cells });
  assert.equal(walk.sees, true, JSON.stringify(walk));
  assert(walk.distance <= 3 && walk.seconds > 0, JSON.stringify(walk));
  assert.match(o.description, /It is more than 3 off, so it walks on toward the bot round the block, making its way anew about every second whether it sees the bot or not/);
  assert.match(o.description, /where it sees the bot past the block: it lights there with its whole fuse and goes off about [\d.]+ seconds from now, about 1\d after the armour worn/);
  assert.match(o.description, /The block buys those seconds, not the end of it: they are for backing out past 6 blocks, where its blast does nothing, or for striking it; staying behind the block, the blast is the price/);
  assert(o.expects.damage >= 10, `the blast where it comes round is counted: ${JSON.stringify(o.expects)}`);
  // Within three and out of its sight behind a block, it stands: nothing counted.
  const near = { id: 9, name: 'creeper', position: new Vec3(3.4, 64, 0.5), height: 1.7, width: 0.6 };
  const walled = creeperBot({ wall: false, health: 20, creeper: near });
  walled.blockAt = (inner => p => { const f = p.floored(); return f.x === 2 && (f.y === 64 || f.y === 65) && f.z === 0 ? { position: f, name: 'cobblestone', boundingBox: 'block' } : inner(p); })(walled.blockAt);
  const still = creeperWalk(walled, near);
  assert.equal(still.within, true);
  assert.equal(still.sees, false);
});

test('a held block in a creeper\'s line is asked again the moment the creeper walks, or has a line again, and no block goes in unasked (note 547)', async () => {
  const placed = [];
  const creeper = { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(4.95, 64, 0.5), height: 1.7, width: 0.6, isValid: true };
  const bot = creeperBot({ health: 20, creeper });
  const blockAt = bot.blockAt;
  bot.blockAt = p => { const f = p.floored(); return placed.includes(`${f}`) ? { position: f, name: 'cobblestone', boundingBox: 'block' } : blockAt(p); };
  const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p.floored()}`); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const asked = [];
  survival.decide = async (task, goal, save, question) => { asked.push(question); return { path: ['block_creeper'], stale: asked.length > 1 }; };
  const danger = () => [{ entity: creeper, distance: creeper.position.distanceTo(bot.entity.position), visible: true }];
  await survival.stanceStep(new Task('t'), {}, () => {}, danger(), false);
  assert.equal(asked.length, 1);
  assert.deepEqual(placed, ['(1, 64, 0)', '(1, 65, 0)']);
  assert(survival.state.stance?.blockCreeper, 'the line cut, where the creeper stood is kept');
  // It stands: held, not asked.
  await survival.stanceStep(new Task('t'), {}, () => {}, danger(), false);
  assert.equal(asked.length, 1, 'held while it stands behind the block');
  // It walks, the line still stopped: asked again at once.
  creeper.position = new Vec3(4.95, 64, 1.9);
  assert(require('../src/creeper-sight').sightLine(bot, creeper).stoppedBy, 'still out of its sight');
  await survival.stanceStep(new Task('t'), {}, () => {}, danger(), false);
  assert.equal(asked.length, 2, 'asked again as it walks');
  assert.match(asked[1].state.previousStance.askedAgainFor, /the creeper is walking: 1\.4 blocks since its line was cut, from 4\.5 to 4\.7 blocks off the bot/);
  // Round the block to a line: asked, and nothing placed without the answer.
  survival.state.stance = { ...survival.state.stance, askAgain: undefined, blockCreeper: { id: 9, creeperAt: creeper.position.clone(), distance: 4.7, at: Date.now() }, choice: 'block_creeper', at: Date.now(), ids: [9], health: 20 };
  creeper.position = new Vec3(0.5, 64, 3.6);
  await survival.stanceStep(new Task('t'), {}, () => {}, danger(), false);
  assert.equal(asked.length, 3);
  assert.match(asked[2].state.previousStance.askedAgainFor, /the creeper has come round the block to a line to the bot, 3\.1 blocks off/);
  assert.equal(placed.length, 2, 'no block put in the new line unasked');
});

test('the state\'s fight estimate prices a creeper with its fuse and the room behind the bot, as the options do (note 547)', async () => {
  const registry = require('minecraft-data')('26.1'), keys = registry.entitiesByName.creeper.metadataKeys;
  const metadata = []; metadata[keys.indexOf('swell_dir')] = 1; metadata[keys.indexOf('health')] = 17;
  const lit = { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(2.2, 64, 0.5), height: 1.7, width: 0.6, metadata, isValid: true };
  const bot = creeperBot({ health: 20, creeper: lit });
  bot._creeperFuses = new Map([[9, Date.now() - 100]]);
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  let asked = null;
  survival.decide = async (task, goal, save, question) => { asked = question; return { path: ['fight'], stale: true }; };
  await survival.stanceStep(new Task('t'), {}, () => {}, [{ entity: lit, distance: 1.7, visible: true }], false);
  assert(asked);
  const fought = asked.state.estimate.mobs.find(m => m.name === 'creeper').fought;
  assert(fought.blast >= 15, `lit 1.7 off with a wall behind: ${JSON.stringify(fought)}`);
  assert(asked.state.estimate.fightHere.damageTaken >= 15, JSON.stringify(asked.state.estimate.fightHere));
  // The dance says it does not stop it, and what the blast costs.
  const dance = survival.stanceOptions(new Task('x'), {}, () => {}, [{ entity: lit, distance: 1.7, visible: true }], false).creeper_dance;
  assert(dance);
  assert.match(dance.description, /Nothing the dance does here stops it: the creeper is lit, about [\d.]+ seconds of its fuse left; the swings take about [\d.]+ seconds to kill it, and with no room behind the bot to back into it goes off about 1\.7 blocks off: about 2\d(\.\d)? after the armour worn, more than the bot has/);
});

// mid-241-n (2026-09-28 00:11:37 to 46): two creepers, one 3.4 off on the
// bot's level and one three blocks below behind it. Both were priced as
// going off six blocks off; the dance backed from the first, down the drop
// and past the second, which went off 4.3 blocks off (16 to 10.9).
test('the room to back from a creeper ends short of another creeper, and the dance stops backing there', async t => {
  // The clock driven by hand: the walk steps with the dance's ticks, not
  // against them on a timer of its own.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const front = { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(3.9, 64, 0.5), height: 1.7, width: 0.6, isValid: true };
  const behind = { id: 10, name: 'creeper', type: 'hostile', position: new Vec3(-3, 64, 0.5), height: 1.7, width: 0.6, isValid: true };
  const bot = creeperBot({ wall: false, health: 16, creeper: front });
  bot.entities[10] = behind;
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [{ entity: front, distance: 3.4, visible: true }, { entity: behind, distance: 3.5, visible: true }], false);
  assert.match(options.fight.description, /goes off first, about 3\.5 blocks off \(0\.5 blocks of room behind the bot\)/);
  assert.doesNotMatch(options.fight.description, /about 6 blocks off, where the blast does nothing/);
  // The dance backs until it would come within three of the second, walked
  // at 0.2 blocks (about four a second) each of its 50 ms ticks.
  let backing = false, done = false;
  bot.setControlState = (k, v) => { if (k === 'back') backing = v; };
  const dance = survival.creeperDance(new Task('x'), {}, () => {}, [{ entity: front, distance: 3.4, visible: true }, { entity: behind, distance: 3.5, visible: true }], true, { chosen: true }).finally(() => { done = true; });
  for (let tick = 0; tick < 100 && !done; tick++) {
    await new Promise(resolve => setImmediate(resolve));
    if (done) break;
    if (backing) bot.entity.position = bot.entity.position.offset(-0.2, 0, 0);
    t.mock.timers.tick(50);
  }
  await dance;
  assert(behind.position.distanceTo(bot.entity.position) >= 2.7, `stopped short of the second creeper: ${bot.entity.position}`);
});

// mid-244-aa (2026-09-28 00:26:07): full iron, 20 health, a creeper struck
// once and lit two blocks up a ledge, not at reach. The fight had said its
// swings did not fit the fuse; the dance held and walked at the ledge, backed
// with a second left, and the blast came 1.6 blocks off: 20 to none.
test('the dance holds for a lit creeper only at reach or a step off on its own level, the step counted as the price counts it', async () => {
  const registry = require('minecraft-data')('26.1'), keys = registry.entitiesByName.creeper.metadataKeys;
  const metadata = []; metadata[keys.indexOf('health')] = 14; metadata[keys.indexOf('swell_dir')] = 1;
  const creeper = { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(3.3, 66, 0.5), height: 1.7, width: 0.6, isValid: true, metadata };
  const bot = creeperBot({ weapon: 'diamond_sword', health: 20, wall: false, creeper });
  // The ledge's edge between the eyes and the creeper: no strike from here.
  bot.world.raycast = (eye, dir) => ({ position: new Vec3(1, 63, 0), intersect: eye.plus(dir.scaled(0.8)) });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  bot._creeperFuses.set(9, Date.now());
  const actions = [];
  const report = survival.report.bind(survival);
  survival.report = (goal, save, a) => { actions.push(a.action); return report(goal, save, a); };
  await survival.creeperDance(new Task('x'), {}, () => {}, [{ entity: creeper, distance: 3.4, visible: true }], false, { chosen: true });
  assert.equal(actions.at(-1), 'creeper_back_off', actions.join(','));
});

test('a held stance no longer on offer scouts the run before it asks, as a new question does (mid-241-n, note 534)', async () => {
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 10.9, food: 20,
    inventory: { items: () => [], slots: {} }, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) });
  const survival = new Survival(bot, { navigate: async () => {} });
  const scouted = [];
  survival.scoutRetreat = async () => { scouted.push(Date.now()); survival.state.retreatScout = { at: Date.now(), feet: `${bot.entity.position.floored()}`, tried: 3, candidates: 3 }; };
  survival.stanceOptions = () => ({ fight: { description: 'fight', run: async () => true }, retreat: { description: survival.state.retreatScout ? 'scouted' : 'blind', run: async () => true } });
  const trees = [];
  survival.decide = async (task, goal, save, q) => { trees.push(q.tree); return { path: ['fight'] }; };
  // The dance held (health 16 to 10.9, less than six), its creeper walked
  // out past six: the dance is no longer offered.
  survival.state.stance = { choice: 'creeper_dance', ids: [9], at: Date.now(), health: 16 };
  await survival.stanceStep(new Task('x'), {}, () => {}, [{ entity: { id: 9, name: 'creeper' }, distance: 7.1 }], false);
  assert.equal(scouted.length, 1, 'the run was looked for before the question');
  assert.equal(trees[0].retreat.description, 'scouted');
});

// mid-231-r (note 538): a shaft pocket dug on a snowy slope at dusk, 0.7
// health, hunger 3, nothing to eat. Three days went by in it: by day it was
// offered only staying and going back to the work, answered "none of these"
// over and over, and the four leaves chosen were each refused as "threats
// block the exits" with none in sight, the shaft having no side to open.
function snowShaft({ health = 0.7, food = 3, timeOfDay = 4619, goal = {} } = {}) {
  const origin = new Vec3(0, 81, 0), cap = origin.offset(0, 2, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const block = p => open.has(`${p}`) || p.y >= 84 ? 'air' : p.equals(cap) ? 'cobbled_deepslate' : p.y < 78 ? 'stone' : 'snow_block';
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: -64, height: 384 }, entities: {}, health, food, registry: require('minecraft-data')('26.1'),
    time: { timeOfDay }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'stone_axe', count: 1 }, { name: 'cobbled_deepslate', count: 62 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: block(p), boundingBox: block(p) === 'air' ? 'empty' : 'block', diggable: true, position: p }),
    pathfinder: { movements: {}, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} },
    world: { raycast: (from) => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const refuge = { origin: { ...origin }, dimension: 'overworld', shaft: true, top: { x: 0, y: 84, z: 0 } };
  const dug = [], walked = [], explored = [];
  const actions = { dig: async (b, t, p) => { dug.push([p.x, p.y, p.z]); open.add(`${p}`); },
    navigate: async (b, t, g) => { walked.push([g.x, g.y, g.z]); }, explore: async (b, t, g, s, what) => { explored.push(what); } };
  const survival = new Survival(bot, actions, { state: { shelters: [refuge] }, client: { systemOne: async () => ({}) } });
  return { bot, survival, refuge, dug, walked, explored, goal: { kind: 'win', ...goal } };
}

test('sealed in a shaft by day, hurt and hungry with nothing to eat: going for food is a way out, the rabbits seen said, and staying says the daylight it spends', async () => {
  const seen = { rabbit: [{ x: 0, y: 82, z: 80, count: 2, at: Date.now() - 60000, dimension: 'overworld' }] };
  const { survival, goal } = snowShaft({ goal: { sightings: seen } });
  let tree;
  survival.decide = async (task, g, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('day'), goal, () => {});
  assert(tree?.go_for_food, `going for food is offered (${Object.keys(tree || {}).join(', ')})`);
  assert.match(tree.go_for_food.description, /2 rabbit seen 1 minute ago, 80 blocks south/);
  assert.match(tree.go_for_food.description, /Food is the only way health comes back: 0.7 health and hunger 3/);
  assert.match(tree.go_for_food.description, /Day: dusk in about \d+ real minutes/);
  assert(tree.go_for_food.children.search_food, 'the search, as the food question has it');
  assert(tree.go_for_food.children.seen_food_0, 'and the walk back to the rabbits');
  assert.match(tree.stay.description, /It is day, dusk in about \d+ real minutes: the daylight waited out here .* and staying brings no health back/);
});

test('fed, the pocket offers no food trip', async () => {
  const { survival, goal } = snowShaft({ health: 20, food: 20 });
  let tree;
  survival.decide = async (task, g, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('day'), goal, () => {});
  assert(tree && !tree.go_for_food);
});

test('leaving a shaft pocket with no side to open goes up through its cap, not "threats block the exits"', async () => {
  const { survival, goal, refuge, dug, walked } = snowShaft();
  const waits = [];
  survival.decide = async () => ({ path: ['leave'], stale: false });
  survival.wait = async (t, g, s, why) => { waits.push(why); };
  await survival.step(new Task('day'), goal, () => {});
  assert.deepEqual(waits, [], 'the leave is not refused');
  assert.deepEqual(dug, [[0, 83, 0]], 'the cap is dug');
  assert.deepEqual(walked.at(-1), [0, 84, 0], 'and the bot climbs to where the shaft was dug from');
  assert(!survival.state.shelters.includes(refuge), 'the pocket is left behind');
});

test('going for food from the pocket opens it first and runs the way chosen', async () => {
  const { survival, goal, dug, explored } = snowShaft();
  survival.decide = async (task, g, save, { id }) => ({ path: id === 'pocket_next' ? ['go_for_food', 'search_food'] : ['stay'], stale: false });
  survival.wait = async () => assert.fail('Jev chose food');
  await survival.step(new Task('day'), goal, () => {});
  assert.deepEqual(dug, [[0, 83, 0]]);
  assert.deepEqual(explored, ['food animals']);
  assert(survival.state.foodPlan?.until > Date.now(), 'held as the food question\'s plan');
});

test('a leave that finds no door says so and rests a minute, not chosen again five seconds on', async () => {
  // A pocket in snow with no cap placed by the bot and no side to open.
  const { survival, goal, refuge } = snowShaft();
  delete refuge.shaft;
  const waits = [];
  survival.decide = async () => ({ path: ['leave'], stale: false });
  survival.wait = async (t, g, s, why) => { waits.push(why); };
  await survival.step(new Task('day'), goal, () => {});
  assert.equal(waits[0], 'No wall of this pocket can be opened as a door');
  let asked;
  survival.decide = async (task, g, save, { id, tree: t, state }) => { if (id === 'pocket_next') asked = { t, state }; return { path: ['stay'], stale: false }; };
  delete survival.state.pocketPlan;
  await survival.step(new Task('day'), goal, () => {});
  assert(!asked.t.leave, 'leave rests');
  assert.match(asked.state.notNow.leave, /did nothing from this pocket \(no wall of this pocket can be opened as a door\)/);
});

test('a ghast firing on the bot is survival\'s claim over the food hunt Jev chose, and the hunted kind alone keeps the hunt (mid-235-q-nether-1, note 541)', () => {
  // Hunting hoglins for food, a ghast's fireball threw the bot off a ledge (16.5 to 8.2); the claim said only the hunt, the turn
  // went to the work six times, and the next fireball ended it.
  const { claim } = require('../src/survival');
  const hoglin = { id: 3, name: 'hoglin', type: 'hostile', position: new Vec3(20.5, 64, 0.5), height: 1.4, metadata: [] };
  const ghast = { id: 4, name: 'ghast', type: 'hostile', position: new Vec3(0.5, 70, 44.5), height: 4, metadata: [] };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 8.2, food: 17,
    time: { timeOfDay: 0 }, entity: { position: new Vec3(0.5, 64, 0.5), height: 1.8, eyeHeight: 1.62, metadata: [0], velocity: new Vec3(0, 0, 0), onGround: true },
    entities: { 3: hoglin }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    blockAt: p => p.y < 64 ? { name: 'netherrack', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p } });
  const state = { nightPlan: { plan: 'hunt', kind: 'hoglin', food: true, until: Date.now() + 120000, startHealth: 16.5 } };
  bot._nightHunt = { name: 'hoglin', until: Date.now() + 120000 };
  assert.equal(claim(bot, { kind: 'win' }, { state, currentShelter: () => null })?.action, 'night_hunt', 'the hunted kind alone: the hunt');
  bot.entities[4] = ghast; bot._hurtBy = { ghast: Date.now() - 1000 }; bot._recentHurtAt = Date.now() - 1000;
  const c = claim(bot, { kind: 'win' }, { state, currentShelter: () => null });
  assert.equal(c?.action, 'escape_threat', JSON.stringify(c));
  assert.equal(c.facts.threat.name, 'ghast');
});

// Note 551: mid-235-p-nether-4-fortress-2 hid from a ghast at 15.3 health and died under its fireballs.
const ghastAt = (x, z, y = 70) => ({ id: 21, name: 'ghast', type: 'hostile', position: new Vec3(x, y, z), height: 4, width: 4, isValid: true });

test('a hiding stance is asked again once the ghast it hid from lands a hit, and its drift is said, not a walk (note 551)', async () => {
  // A wall at x = -1 between the ghast thirty blocks west and the bot.
  const make = () => {
    const bot = rockWorld(p => p.y >= 64 && (p.x !== -1 || p.z < -3 || p.z > 3), ['iron_sword', 'cobblestone']);
    const ghast = ghastAt(-30.5, 0.5, 64);
    bot.entities = { 21: ghast };
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } }, state: { shelters: [] } });
    const feet = bot.entity.position.floored();
    survival.state.stance = { choice: 'out_of_sight', kinds: 'ghast', ids: [21], shooters: ['ghast'], at: Date.now() - 2000, health: 14, expects: { damage: 2, seconds: 15, oneHit: 6 }, hidden: { cell: `${feet}`, seenBy: [] } };
    let asked = null;
    survival.decide = async (task, goal, save, question) => { asked = question; return { path: ['out_of_sight'], stale: true }; };
    return { bot, ghast, survival, asked: () => asked };
  };
  const held = make();
  await held.survival.stanceStep(new Task('t'), {}, () => {}, [threat(held.bot, held.ghast)], false);
  assert.equal(held.asked(), null, 'no hit since: held');
  const hit = make();
  hit.bot._hurtBy = { ghast: Date.now() - 1000 };
  await hit.survival.stanceStep(new Task('t'), {}, () => {}, [threat(hit.bot, hit.ghast)], false);
  assert(hit.asked(), 'the ghast it hid from hit the bot: asked again');
  assert.match(hit.asked().state.previousStance.askedAgainFor, /^the ghast it was chosen against hit the bot 1 seconds ago/);
  const hidden = hit.asked().tree.out_of_sight.description;
  assert.doesNotMatch(hidden, /the ghast \d+ blocks off has none within the fifteen seconds/);
  assert.match(hidden, /The ghast 31 blocks off does not walk to a line: it drifts through the air at random/);
  // Every stance says when it fires and that it drifts.
  for (const [k, o] of Object.entries(hit.asked().tree)) assert.match(o.description, /fires only at a bot it can see within 64 blocks: its fireball about 1 second after it has a line, then one every 3 seconds/, k);
});

test('a ghast in sight: its fireball can be struck back, and it can be shot past twenty blocks, each said with its flight (note 551)', () => {
  const bot = rockWorld(p => p.y >= 64, ['iron_sword', 'bow', 'arrow', 'cobblestone']);
  bot.game.dimension = 'the_nether'; bot.health = 7;
  const ghast = ghastAt(30.5, 0.5, 64);
  bot.entities = { 21: ghast };
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, ghast)], false);
  assert(options.return_fireball, Object.keys(options).join(','));
  const back = options.return_fireball.description;
  assert.match(back, /^Stand in the ghast's line 30 blocks off, look at it, and strike its fireball as it comes/);
  assert.match(back, /kills it outright/);
  assert.match(back, /each fireball takes about 1\.4 seconds to come 30 blocks, about 1\.1 to go back/);
  assert.match(back, /an arrow does not send it back/);
  // Note 574: what it has done live, and priced by it.
  assert.match(back, /The server takes the strike only while the fireball is within 6 blocks of the bot's eyes, the last three or four ticks before it lands/);
  assert.match(back, /Measured live so far: before its strike was timed by the fireball's flight, it was chosen 11 times in trials, a strike was sent at 4 fireballs, none was seen to go back and no ghast was killed; 6 fireballs landed during those watches, and 3 of those runs died of them, 2 thrown into lava\. Since then it has not been tried\./);
  assert.match(back, /Priced by that record \(0 of the 6 fireballs that came to the bot sent back\): both of the next 2 fireballs landing, about 12 damage in about 6\.8 seconds\./);
  assert.doesNotMatch(back, /no trial has yet measured|Priced with one fireball missed/);
  assert.equal(options.return_fireball.expects.damage, 12, 'two fireballs, none measured sent back, no armour: 6 each on Normal');
  // This bot's own count since, kept with the goal, says and prices.
  const since = survival.stanceOptions(new Task('x'), { fireballReturns: { watches: 3, came: 2, struck: 2, sentBack: 2, killed: 1, landed: 0 } }, () => {}, [threat(bot, ghast)], false).return_fireball;
  assert.match(since.description, /Since then, by this bot: 3 watches, 2 fireballs came, 2 struck at, 2 seen to go back, 1 ghast killed, 0 landed\./);
  assert.match(since.description, /Priced by that record \(2 of the 8 fireballs that came to the bot sent back\): about 1\.5 of the next 2 fireballs landing, about 9 damage/);
  assert.equal(since.expects.damage, 9);
  const shot = options.shoot_21;
  assert(shot, Object.keys(options).join(','));
  assert.match(shot.description, /^Shoot the ghast 30 blocks off with the bow from here/);
  assert.match(shot.description, /lands for at least 6, so about 2 that land bring down its 10 health \(64 carried\)/);
  // A fireball is a fireball, not an arrow.
  assert.match(options.fight.description, /At 7 health, 2 fireballs from the ghast \(about 6 each after armour\) end it/);
});

test('cover from a ghast is put from a block its blast does not break, and what breaks is said (note 551)', async () => {
  const bot = rockWorld(p => p.y >= 64, ['netherrack', 'cobblestone']);
  bot.game.dimension = 'the_nether';
  const ghast = ghastAt(20.5, 0.5, 64);
  bot.entities = { 21: ghast };
  const placed = [];
  const survival = new Survival(bot, { place: async (b, t, c, material) => { placed.push(material); }, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [threat(bot, ghast)], false);
  assert(options.take_cover, Object.keys(options).join(','));
  assert.match(options.take_cover.description, /A ghast's fireball blast breaks a block with a blast resistance under about 4 and never one of 4 or more\. Carried that holds: cobblestone \(64, blast resistance 6\); the cover is put from it\. Carried that it can break: netherrack \(64, blast resistance 0\.4\)\./);
  await options.take_cover.run();
  assert(placed.length && placed.every(m => m === 'cobblestone'), placed.join(','));
});

// mid-243-bg, 2026-09-28: the carried bed went down with a spider two blocks off,
// the server refused, the survival layer preempted, and the bed stayed standing.
function bedBot({ spider = false } = {}) {
  const blocks = new Map(); let items = [{ name: 'white_bed', count: 1 }, { name: 'iron_sword' }];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, time: { timeOfDay: 13000 },
    entities: spider ? { 9: { id: 9, name: 'spider', type: 'hostile', position: new Vec3(0.5, 64, 2.5), height: 0.9, isValid: true } } : {},
    entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, isSleeping: false, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => items, slots: {} }, heldItem: null,
    equip: async item => { bot.heldItem = item; }, lookAt: async () => {},
    placeBlock: async () => { blocks.set(`${new Vec3(1, 64, 0)}`, 'white_bed'); blocks.set(`${new Vec3(2, 64, 0)}`, 'white_bed'); items = items.filter(i => i.name !== 'white_bed'); },
    sleep: async () => { throw new Error('There are monsters nearby'); },
    wake: async () => {},
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'grass_block' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty', position: p }) });
  return { bot, blocks, give: () => items.push({ name: 'white_bed', count: 1 }), carried: () => items.some(i => i.name === 'white_bed') };
}

test('the carried bed is not put down with a monster within eight blocks, and the option says who and how far', async () => {
  const { Survival, refusalSays } = require('../src/survival');
  const { bot, blocks, carried } = bedBot({ spider: true });
  let placed = 0; const inner = bot.placeBlock; bot.placeBlock = async (...a) => { placed++; return inner(...a); };
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} });
  const actions = []; survival.report = (g, sv, action) => actions.push(action);
  await assert.rejects(survival.sleepStep(new Task('test', 'sleep'), {}, () => {}), /refuses a sleep with monsters within eight blocks/);
  assert.equal(placed, 0, 'no bed went down'); assert.equal(blocks.size, 0); assert(carried());
  assert(actions.some(a => a.action === 'sleep_failed'));
  assert.equal(survival.state.bedLeft, undefined);
  assert.match(refusalSays(bot, bot.entity.position), /A spider 2 blocks off.*the server will refuse the sleep/);
  assert.equal(refusalSays(bedBot().bot, new Vec3(0.5, 64, 0.5)), '');
});

test('a bed put down is picked up even when the task is cancelled by the threat layer meanwhile', async () => {
  const { Survival } = require('../src/survival');
  const { bot, blocks, give, carried } = bedBot();
  const task = new Task('test', 'sleep');
  bot.sleep = async () => { task.cancel(); throw new Error('There are monsters nearby'); };
  const survival = new Survival(bot, { navigate: async () => {}, dig: async (b, t, p) => { t.check(); blocks.delete(`${p}`); give(); } });
  survival.report = () => {};
  await assert.rejects(survival.sleepStep(task, {}, () => {}), err => err.name === 'Cancelled');
  assert(carried(), 'the bed is back in the pack');
  assert.equal(blocks.size, 0, 'and nothing stands in the tunnel');
  assert.equal(survival.state.bedLeft, undefined);
});

test('a bed that cannot be picked up is recorded as left, reported, and fetched when near and quiet', async () => {
  const { Survival } = require('../src/survival');
  const { bot, blocks, give, carried } = bedBot();
  let failDig = true; const task = new Task('test', 'sleep');
  const survival = new Survival(bot, { navigate: async () => {}, dig: async (b, t, p) => { if (failDig) throw new Error('no'); blocks.delete(`${p}`); give(); } });
  const actions = []; survival.report = (g, sv, a) => actions.push(a);
  await assert.rejects(survival.sleepStep(task, {}, () => {}), /monsters/);
  const left = actions.find(a => a.action === 'bed_left');
  assert(left && left.standing && left.bed === 'white_bed', 'reported with what and where');
  assert.deepEqual(survival.state.bedLeft.foot, { x: 1, y: 64, z: 0 });
  // A hostile near: not now.
  bot.entities = { 9: { id: 9, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 64, 4.5), height: 1.9, isValid: true } };
  assert.equal(await survival.fetchLeftBed(task, {}, () => {}), false);
  bot.entities = {}; failDig = false;
  assert.equal(await survival.fetchLeftBed(task, {}, () => {}), true);
  assert(carried()); assert.equal(survival.state.bedLeft, undefined);
  assert(actions.some(a => a.action === 'bed_recovered'));
});

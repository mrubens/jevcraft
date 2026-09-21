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
  const state = { shelters: [], foodSearch: { since: Date.now() - 400000 } };
  assert.equal(await make(20, state).step(new Task('stock'), { kind: 'win', stockFood: true }, () => {}), false, 'five minutes of nothing: the reserve waits');
  assert(state.foodStockPausedUntil > Date.now());
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

test('cornered by a ranged mob with no way out, the bot closes every open side into a pocket', async () => {
  const { Survival } = require('../src/survival');
  const feet = new Vec3(0, 10, 0);
  const skeleton = { name: 'skeleton', type: 'hostile', position: new Vec3(5.5, 10, 0.5), height: 1.99 };
  const placed = [];
  const bot = { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entity: { position: feet.offset(0.5, 0, 0.5) }, entities: { 1: skeleton },
    inventory: { items: () => [{ name: 'cobblestone', count: 64 }, { name: 'iron_sword', count: 1 }] }, world: { raycast: () => null }, on() {}, removeListener() {}, clearControlStates() {},
    registry: require('minecraft-data')('26.1'),
    blockAt: p => ({ name: p.y >= 10 && p.y <= 12 ? 'air' : 'stone', boundingBox: p.y >= 10 && p.y <= 12 ? 'empty' : 'block', position: p }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }), setGoal() {} } };
  const survival = new Survival(bot, { place: async (b, t, p) => { placed.push(`${p}`); }, navigate: async () => {} }, { state: { shelters: [] } });
  await survival.flee(new Task('shot at'), {}, () => {});
  assert(placed.length >= 9, `the whole shell goes up, not one wall: ${placed.length} placed`);
  assert.equal(survival.state.shelters.length, 1, 'and the pocket is registered so the next step waits inside it');
});

// A skeleton in view at ten blocks, a bow and arrows in the pack.
function archerFixture({ health = 20, client } = {}) {
  const registry = require('prismarine-registry')('26.1');
  const skeleton = { id: 7, name: 'skeleton', position: new Vec3(10.5, 64, .5), width: .6, height: 1.99, isValid: true };
  const arrows = { name: 'arrow', count: 8 }, events = [], destination = new Vec3(-8, 64, 0);
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { position: new Vec3(.5, 64, .5) }, entities: { 7: skeleton }, health, food: 20, oxygenLevel: 20, quickBarSlot: 0,
    time: { timeOfDay: 6000 }, inventory: { items: () => [{ name: 'iron_sword' }, { name: 'bow', count: 1, durabilityUsed: 0 }, arrows], slots: { 45: { name: 'shield' } } },
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
  let asked;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, questions }; return { answers: { branch_0: { choice: 'retreat' } } }; } };
  const { bot, events, controller, task, goal } = archerFixture({ client });
  bot.inventory.items = () => [{ name: 'iron_sword' }, { name: 'bow', count: 1, durabilityUsed: 0 }, { name: 'arrow', count: 8 }, { name: 'cobblestone', count: 20 }];
  assert(await controller.step(task, goal, () => {}));
  assert.deepEqual(Object.keys(asked.questions.branch_0.criteria).sort(), ['dig_in', 'retreat', 'shoot_7']);
  assert.deepEqual(asked.state.threats, [{ name: 'skeleton', distance: 10, shoots: true }]); assert.equal(asked.state.arrowsCarried, 8);
  assert.deepEqual(events, ['navigate'], 'the retreat ran and nothing was drawn');
  assert.equal(goal.survivalAction.action, 'escape_threat');
});

test('hurt, or with a zombie closing, the bow stays in the pack and the escape rules take over', async () => {
  const hurt = archerFixture({ health: 6 });
  assert(await hurt.controller.step(hurt.task, hurt.goal, () => {}));
  assert.deepEqual(hurt.events, ['navigate']); assert.equal(hurt.goal.decisions, undefined, 'no question at six health');
  const crowded = archerFixture();
  crowded.bot.entities[8] = { id: 8, name: 'zombie', position: new Vec3(3, 64, .5), width: .6, height: 1.95, isValid: true };
  assert(await crowded.controller.step(crowded.task, crowded.goal, () => {}));
  assert.deepEqual(crowded.events, ['equip iron_sword', 'attack', 'navigate'], 'a zombie at arm\'s length gets the knockback swing and the retreat, not a draw');
});

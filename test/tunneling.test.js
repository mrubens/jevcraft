'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { stairOptions, tunnelStep, resourceTunnelStep, retreatForTunnel, safeExcavation } = require('../src/tunneling');
const { Task } = require('../src/skills');
const { dig } = require('../src/work');

test('approaching a foundation moves off its top before digging', async () => {
  const target = new Vec3(10, 63, 10);
  let removed = false, routes = 0;
  const bot = { game: { gameMode: 'creative' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true },
    inventory: { items: () => [] },
    blockAt: p => ({ position: p, type: p.y === 63 && !(removed && p.equals(target)) ? 1 : 0,
      name: p.y === 63 && !(removed && p.equals(target)) ? 'grass_block' : 'air', boundingBox: p.y === 63 ? 'block' : 'empty', diggable: true, digTime: () => 100 }),
    canDigBlock: b => b.position.distanceTo(bot.entity.position) < 5,
    pathfinder: { setGoal: () => {}, goto: async goal => {
      routes++;
      bot.entity.position = routes === 1 ? target.offset(0.5, 1, 0.5) : new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5);
    } },
    dig: async () => { assert(!target.equals(bot.entity.position.floored().offset(0, -1, 0))); removed = true; },
  };
  await dig(bot, new Task('foundation'), target);
  assert(removed); assert.equal(routes, 2);
});

test('a broken pickaxe does not prevent clearing a shelter exit, while resource mining still requires drops', async () => {
  const target = new Vec3(1, 64, 0); let removed = false;
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.5), onGround: true },
    inventory: { items: () => [] }, canDigBlock: () => true,
    blockAt: p => ({ position: p, type: removed ? 0 : 1, name: removed ? 'air' : 'cobblestone',
      diggable: true, harvestTools: { 1: true }, digTime: () => 7500 }),
    dig: async () => { removed = true; },
  };
  const task = new Task('exit');
  await assert.rejects(dig(bot, task, target), /Missing harvest tool/);
  assert(!removed);
  await dig(bot, task, target, { requireDrops: false });
  assert(removed);
});

function world() {
  const blocks = new Map();
  return { blocks, entity: { position: new Vec3(0.5, 70, 0.5) }, inventory: { items: () => [{ type: 1 }] },
    blockAt: p => blocks.get(`${p}`) || { name: 'stone', position: p, diggable: true, boundingBox: 'block', harvestTools: { 1: true } },
  };
}

test('staircase descends beside the bot without digging beneath its feet', async () => {
  const bot = world(); const dug = [];
  const goal = {};
  await tunnelStep(bot, new Task('test', 'descend'), goal, () => {}, new Vec3(5, 60, 0), {
    dig: async (_bot, _task, p) => { dug.push(p); bot.blocks.set(`${p}`, { name: 'air', boundingBox: 'empty', position: p }); },
    navigate: async (_bot, _task, target) => { bot.entity.position = new Vec3(target.x + 0.5, target.y, target.z + 0.5); },
  });
  assert.equal(bot.entity.position.y, 69);
  assert(dug.length >= 3);
  assert(dug.every(p => p.x !== 0 || p.z !== 0));
  assert.equal(bot.blockAt(new Vec3(1, 68, 0)).name, 'stone');
  assert.equal(goal.tunnel.steps, 1);
});

test('a forest staircase descends through grass and leaf litter without treating vegetation as a wall', async () => {
  for (const name of ['leaf_litter', 'short_grass', 'tall_grass', 'fern']) {
    const bot = world(), feet = bot.entity.position.floored(), dug = [];
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dy of [0, 1]) bot.blocks.set(`${feet.offset(x, dy, z)}`, { name, boundingBox: 'empty' });
    }
    const goal = {};
    await tunnelStep(bot, new Task('forest descent'), goal, () => {}, feet.offset(20, -10, 0), {
      dig: async (_bot, _task, p) => { dug.push(p); bot.blocks.set(`${p}`, { name: 'air' }); },
      navigate: async (_bot, _task, target) => { bot.entity.position = new Vec3(target.x + 0.5, target.y, target.z + 0.5); },
    });
    assert.equal(bot.entity.position.y, feet.y - 1, name);
    assert.equal(dug.length, 1, 'Only the ground block needs excavation');
  }
});

test('non-colliding hazards still block staircase headroom', () => {
  for (const name of ['sweet_berry_bush', 'cobweb', 'soul_fire', 'bubble_column', 'seagrass']) {
    const bot = world(), feet = bot.entity.position.floored();
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      bot.blocks.set(`${feet.offset(x, 1, z)}`, { name, boundingBox: 'empty', diggable: true });
    }
    assert.equal(stairOptions(bot, {}, feet.offset(20, -10, 0)).length, 0, name);
  }
});

test('staircase refuses lava, missing footing, and construction foundations', () => {
  const bot = world();
  bot.blocks.set(`${new Vec3(1, 69, 0)}`, { name: 'lava', boundingBox: 'empty' });
  assert(stairOptions(bot, {}, new Vec3(5, 60, 0)).every(c => c.destination.x !== 1));
  assert.equal(stairOptions(bot, { blueprint: { origin: { x: 0, y: 70, z: 0 } } }, new Vec3(5, 60, 0)).length, 0);
  bot.blockAt = p => ({ name: 'air', position: p, boundingBox: 'empty' });
  assert.equal(stairOptions(bot, {}, new Vec3(5, 60, 0)).length, 0);
});

test('staircase does not release water above a falling sand or gravel column', () => {
  const bot = world(), p = new Vec3(1, 70, 0);
  bot.blocks.set(`${p.offset(0, 1, 0)}`, { name: 'gravel' });
  bot.blocks.set(`${p.offset(0, 2, 0)}`, { name: 'sand' });
  assert(safeExcavation(bot, p));
  bot.blocks.set(`${p.offset(0, 3, 0)}`, { name: 'water' });
  assert(!safeExcavation(bot, p));
});

test('ascending staircase clears inspected jump headroom but rejects wet or falling ceilings', async () => {
  const bot = world(), feet = bot.entity.position.floored(), dug = [];
  const overhead = feet.offset(0, 2, 0), target = new Vec3(8, 80, 0);
  await tunnelStep(bot, new Task('ascend'), {}, () => {}, target, {
    dig: async (_bot, _task, p) => { dug.push(p); bot.blocks.set(`${p}`, { name: 'air' }); },
    navigate: async (_bot, _task, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
  });
  assert(dug[0].equals(overhead), 'Clear current jump ceiling before stepping up');
  assert.equal(bot.entity.position.y, feet.y + 1);
  assert(dug.every(p => !p.equals(feet.offset(0, -1, 0))));
  for (const name of ['water', 'gravel']) {
    const unsafe = world(); unsafe.blocks.set(`${overhead}`, { name, diggable: true, boundingBox: 'block' });
    assert(stairOptions(unsafe, {}, target).every(option => option.destination.y <= feet.y));
  }
});

function retreatFixture(wet) {
  const target = new Vec3(2, 60, 0), water = new Vec3(1, 60, 0);
  const inherited = p => p.z >= 0;
  const bot = { registry: require('minecraft-data')('26.1'), game: { difficulty: 'normal' },
    entity: { position: new Vec3(0.5, 60, 0.5) },
    blockAt: p => ({ position: p, name: p.y < 60 ? 'stone' : p.x === 1 || wet && p.x === 0 ? 'water' : 'air', boundingBox: p.y < 60 ? 'block' : 'empty' }),
    findBlocks: ({ useExtraInfo }) => useExtraInfo(bot.blockAt(target.offset(0, -1, 0))) ? [target.offset(0, -1, 0)] : [],
    pathfinder: { movements: { canDig: true, allow1by1towers: true, scafoldingBlocks: [1], allowedPosition: inherited },
      getPathFromTo: function * (movement) {
        assert.equal(movement.canDig, false); assert.deepEqual(movement.scafoldingBlocks, []);
        assert(!movement.allowedPosition(new Vec3(1, 59, 0)), 'Cannot retreat deeper through water');
        assert(!movement.allowedPosition(new Vec3(2, 60, -1)), 'Retains inherited restrictions');
        yield { result: { status: 'success', path: [water, target] } };
      } },
  };
  return { bot, target };
}
test('a flooded staircase retreats through existing water to dry footing without digging', async () => {
  const { bot, target } = retreatFixture(true), before = { ...bot.pathfinder.movements }, goal = { tunnel: { visited: {} } };
  await retreatForTunnel(bot, new Task('retreat'), goal, () => {}, { navigate: async () => {
    assert.equal(bot.pathfinder.movements.canDig, false);
    bot.entity.position = target.offset(0.5, 0, 0.5);
  } });
  assert.equal(goal.step.action, 'retreat_from_tunnel');
  assert.equal(goal.tunnel.retreats, 1);
  assert.deepEqual(bot.pathfinder.movements, before);
});
test('a dry staircase cannot choose a new submerged retreat, and failure restores movement rules', async () => {
  const { bot } = retreatFixture(false), before = { ...bot.pathfinder.movements };
  await assert.rejects(retreatForTunnel(bot, new Task('retreat'), { tunnel: {} }, () => {}, {
    navigate: async () => assert.fail('Must not enter the water'),
  }), /No existing dry route/);
  assert.deepEqual(bot.pathfinder.movements, before);
});

test('retreat surveys the known stair before its budget is spent on unreachable new areas', async () => {
  const known = new Vec3(1, 59, 0), candidates = [known];
  for (const x of [-6, -3, 0, 3, 6]) for (const z of [-6, -3, 0, 3, 6]) if (x || z) candidates.push(new Vec3(x, 60, z));
  let surveyed = 0;
  const bot = { registry: require('minecraft-data')('26.1'), game: { difficulty: 'normal' },
    entity: { position: new Vec3(.5, 60, .5) },
    blockAt: p => { const solid = p.y < (p.x === 1 && p.z === 0 ? 59 : 60);
      return { position: p, name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty' }; },
    findBlocks: ({ useExtraInfo }) => candidates.map(p => p.offset(0, -1, 0)).filter(p => useExtraInfo(bot.blockAt(p))),
    pathfinder: { movements: {}, getPathTo: (_m, g) => { surveyed++;
      return { status: g.x === known.x && g.y === known.y && g.z === known.z ? 'success' : 'noPath', path: [known] }; } },
  };
  const goal = { tunnel: { visited: { [`${known}`]: 1 } } };
  await retreatForTunnel(bot, new Task('retrace stair'), goal, () => {}, { navigate: async (_bot, _task, g) => {
    bot.entity.position = new Vec3(g.x + .5, g.y, g.z + .5);
  } });
  assert.equal(surveyed, 1);
  assert.equal(bot.entity.position.y, 59);
  assert.equal(goal.tunnel.retreats, 1);
});

test('resource shafts survive shelter and other-resource interruptions without beginning another descent', async () => {
  const bot = world(); bot.game = { dimension: 'overworld' };
  bot.pathfinder = { movements: { canDig: true, allow1by1towers: true, scafoldingBlocks: [1] },
    getPathFromTo: function * (movement) {
      assert.equal(movement.canDig, false); assert.equal(movement.allow1by1towers, false);
      assert.deepEqual(movement.scafoldingBlocks, []);
      yield { result: { status: 'success', path: [] } };
    } };
  let digs = 0;
  const actions = { dig: async (_bot, _task, p) => { digs++; bot.blocks.set(`${p}`, { name: 'air' }); },
    navigate: async (_bot, _task, target) => { bot.entity.position = new Vec3(target.x + 0.5, target.y, target.z + 0.5); } };
  const task = new Task('mine'), goal = {}, target = new Vec3(10, 40, 0);
  await resourceTunnelStep(bot, task, goal, () => {}, target, 'diamond_ore', actions);
  const diamondSite = JSON.parse(JSON.stringify(goal.miningSites['overworld:diamond_ore']));
  bot.entity.position = new Vec3(50.5, 70, 0.5);
  await resourceTunnelStep(bot, task, goal, () => {}, target, 'iron_ore', actions);
  const countBefore = digs, before = { ...bot.pathfinder.movements };
  const resumed = JSON.parse(JSON.stringify(goal));
  await resourceTunnelStep(bot, task, resumed, () => {}, new Vec3(70, 40, 0), 'diamond_ore', actions);
  assert.equal(digs, countBefore, 'Walking back must not excavate another shaft');
  assert.equal(resumed.step.action, 'return_to_mine');
  assert.equal(resumed.tunnel.steps, diamondSite.steps);
  assert.deepEqual(resumed.tunnel.workPosition, diamondSite.workPosition);
  assert.deepEqual(bot.pathfinder.movements, before);
  assert(resumed.miningSites['overworld:iron_ore']);
});

test('unreachable saved shafts record bounded retry failures and restore movement rules', async () => {
  const bot = world(); bot.game = { dimension: 'overworld' };
  bot.pathfinder = { movements: { canDig: true, allow1by1towers: true, scafoldingBlocks: [1] },
    getPathFromTo: function * () { yield { result: { status: 'noPath', path: [] } }; } };
  const before = { ...bot.pathfinder.movements };
  const site = { steps: 20, visited: {}, workPosition: { x: 20, y: 30, z: 0 } };
  const goal = { miningSites: { 'overworld:diamond_ore': site } };
  const actions = { dig: async () => assert.fail('Must not mine while retrying'), navigate: async () => assert.fail('No route') };
  for (let i = 1; i <= 3; i++) {
    await assert.rejects(resourceTunnelStep(bot, new Task('mine'), goal, () => {}, new Vec3(10, 40, 0), 'diamond_ore', actions), /No existing route/);
    assert.equal(site.rejoinFailures, i); assert.deepEqual(bot.pathfinder.movements, before);
  }
  assert(site.rejoinBlockedUntil > Date.now());
});

test('with no pickaxe, a staircase through stone exists only for an exit being dug by hand', () => {
  const bot = world(); bot.inventory.items = () => [];
  const up = bot.entity.position.floored().offset(20, 30, 0);
  assert.equal(stairOptions(bot, {}, up).length, 0, 'no tool, no stone stair');
  const byHand = stairOptions(bot, { surfaceReturn: { byHand: true } }, up);
  assert(byHand.length > 0);
  assert(byHand.some(c => c.destination.y === bot.entity.position.floored().y + 1), 'and it climbs');
});

test('the block underfoot can be dug as a one-block drop onto solid ground, never over a hole or lava', async () => {
  const feet = new Vec3(0, 64, 0), ore = feet.offset(0, -1, 0);
  const make = under => {
    let removed = false;
    const bot = { game: { gameMode: 'survival' }, entity: { position: feet.offset(0.5, 0, 0.5), onGround: true }, inventory: { items: () => [] }, canDigBlock: () => true,
      blockAt: p => p.equals(ore) ? { position: p, type: removed ? 0 : 1, name: removed ? 'air' : 'diamond_ore', diggable: true, boundingBox: removed ? 'empty' : 'block', digTime: () => 100 }
        : p.equals(ore.offset(0, -1, 0)) ? { position: p, name: under, boundingBox: under === 'air' ? 'empty' : 'block', type: 2 }
        : { position: p, name: 'stone', boundingBox: 'block', type: 3, diggable: true },
      dig: async () => { removed = true; }, pathfinder: { setGoal() {}, goto: async () => {} } };
    return bot;
  };
  const stone = make('stone');
  await dig(stone, new Task('drop'), ore, { requireDrops: false });
  assert.equal(stone.blockAt(ore).name, 'air');
  await assert.rejects(dig(make('air'), new Task('hole'), ore, { requireDrops: false }), /beneath feet|footing/);
  await assert.rejects(dig(make('lava'), new Task('lava'), ore, { requireDrops: false }), /beneath feet|footing/);
});

test('a body leaning into the target cell is detected, and clear once it stands centred', () => {
  const { hitboxIntrudes } = require('../src/work');
  const bot = { entity: { position: new Vec3(-506.81, 15, 138.43) } };
  assert.equal(hitboxIntrudes(bot, new Vec3(-508, 15, 138)), true, 'eleven centimetres over the line');
  bot.entity.position = new Vec3(-506.5, 15, 138.5);
  assert.equal(hitboxIntrudes(bot, new Vec3(-508, 15, 138)), false);
  assert.equal(hitboxIntrudes(bot, new Vec3(-507, 17, 138)), false, 'above head height is clear');
});

test('a shaft that has spent its staircase budget starts over from here instead of refusing', async () => {
  const bot = world(); const dug = [];
  bot.pathfinder = { setGoal() {}, goto: async goal => { bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); } };
  bot.game = { gameMode: 'survival' };
  const goal = { tunnel: { entrance: { x: 0, y: 70, z: 0 }, steps: 512, visited: { a: 40 }, workPosition: { x: 9, y: 9, z: 9 } } };
  const dig = async (b, t, p) => { dug.push(`${p}`); bot.blocks.set(`${p}`, { name: 'air', position: p, boundingBox: 'empty', diggable: false }); };
  await tunnelStep(bot, new Task('spent'), goal, () => {}, new Vec3(20, 60, 0), { dig, navigate: async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } });
  assert.equal(goal.tunnel.rounds, 1);
  assert(goal.tunnel.steps >= 1 && goal.tunnel.steps < 10, 'a fresh count');
  assert.equal(goal.tunnel.workPosition !== undefined, true, 'and a new worksite');
});

test('with mobs in the cave around the shaft, the stairs go on in the direction that gains ground from them', () => {
  const bot = world();
  bot.game = { gameMode: 'survival', difficulty: 'normal' }; bot.registry = require('minecraft-data')('26.1');
  bot.world = { raycast: () => null };
  bot.entities = { 1: { name: 'zombie', position: new Vec3(3.5, 70, 0.5), isValid: true, width: 0.6, height: 1.95 } };
  let choices = stairOptions(bot, {}, new Vec3(0, 60, 0));
  assert(choices.length >= 1, 'one zombie to the east leaves other ways');
  assert(choices.every(c => c.destination.x <= 0), `no choice leads toward the zombie: ${choices.map(c => `${c.destination}`)}`);
  // Surrounded: every direction is unsafe by the first rule, and the shaft goes on anyway.
  bot.entities = Object.fromEntries([[3.5, 0.5], [-2.5, 0.5], [0.5, 3.5], [0.5, -2.5]].map(([x, z], i) => [i, { name: 'zombie', position: new Vec3(x, 70, z), isValid: true, width: 0.6, height: 1.95 }]));
  choices = stairOptions(bot, {}, new Vec3(0, 60, 0));
  assert(choices.length >= 1, 'the shaft does not freeze with mobs on every side');
});

test('a dug-in pocket at the bot\'s feet does not reserve the stairs out of it', () => {
  const bot = world();
  bot.game = { gameMode: 'survival', difficulty: 'normal' }; bot.registry = require('minecraft-data')('26.1'); bot.entities = {}; bot.world = { raycast: () => null };
  const goal = { survival: { shelters: [{ origin: { x: 0, y: 70, z: 0 }, dimension: 'overworld', emergency: true }] } };
  assert(stairOptions(bot, goal, new Vec3(0, 60, 0)).length >= 1, 'an emergency pocket is not construction');
  goal.survival.shelters[0].emergency = false;
  assert.equal(stairOptions(bot, goal, new Vec3(0, 60, 0)).length, 0, 'a planned shelter still is');
});

test('a shaft dug at a mob goes toward it, where a travelling shaft would be turned away', () => {
  const { stairOptions } = require('../src/tunneling');
  const { Vec3 } = require('vec3');
  const rock = { name: 'netherrack', boundingBox: 'block', diggable: true, harvestTools: undefined };
  const air = { name: 'air', boundingBox: 'empty' };
  const bot = {
    entity: { position: new Vec3(0.5, 77, 0.5), height: 1.8 },
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' },
    registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'diamond_pickaxe', type: 1 }] },
    world: { raycast: () => null },
    time: { timeOfDay: 6000 },
    blockAt: p => ({ ...(p.y < 77 ? rock : (p.x >= 1 ? rock : air)), position: p }),
    // One blaze sits east, which is also the way to the target.
    entities: { 1: { id: 1, name: 'blaze', position: new Vec3(6.5, 77, 0.5), isValid: true, height: 1.8, width: 0.6 } },
    pathfinder: { movements: {} },
  };
  const target = new Vec3(6, 77, 0);
  const travelling = stairOptions(bot, {}, target);
  const closing = stairOptions(bot, {}, target, { approach: true });
  assert(closing.length, 'closing on the mob always has somewhere to dig');
  assert.equal(closing[0].destination.x, 1, 'and it is the cell toward the target');
  if (travelling.length) {
    assert(closing[0].destination.distanceTo(target) <= travelling[0].destination.distanceTo(target),
      'a travelling shaft never gets closer than one dug on purpose');
  }
});

test('an approach shaft is not turned back by its own footprints', () => {
  const { stairOptions } = require('../src/tunneling');
  const { Vec3 } = require('vec3');
  const rock = { name: 'netherrack', boundingBox: 'block', diggable: true };
  const air = { name: 'air', boundingBox: 'empty' };
  const bot = {
    entity: { position: new Vec3(21.5, 77, 75.5), height: 1.8 },
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' },
    registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'diamond_pickaxe', type: 1 }] },
    world: { raycast: () => null }, time: { timeOfDay: 6000 }, entities: {}, pathfinder: { movements: {} },
    // A dug pocket from x 19 to 22, rock beyond.
    blockAt: p => ({ ...(p.y < 77 || p.x > 22 || p.x < 19 ? rock : air), position: p }),
  };
  // The pocket's cells all heavily visited, the one toward the target most of all.
  const goal = { tunnel: { visited: { '(22, 77, 75)': 60, '(20, 77, 75)': 10, '(21, 77, 74)': 20, '(21, 77, 76)': 20 } } };
  const target = new Vec3(27, 77, 75);
  const travelling = stairOptions(bot, goal, target);
  const closing = stairOptions(bot, goal, target, { approach: true });
  assert.equal(closing[0].destination.x, 22, 'the approach steps toward the target whatever the footprints say');
  assert.notEqual(travelling[0].destination.x, 22, 'a travelling shaft still avoids the well-trodden cell');
});

test('a shaft pacing back and forth is not gaining, and a new destination starts a new count', () => {
  const { noteProgress } = require('../src/tunneling');
  const tunnel = {}, target = new Vec3(0, 40, 0);
  for (const gap of [19, 20, 21, 20, 19, 20, 21, 20, 19]) noteProgress(tunnel, target, gap);
  assert.equal(tunnel.best, 19);
  assert.equal(tunnel.sinceBest, 8, 'coming back to the old best is not a new best');
  noteProgress(tunnel, target, 18);
  assert.equal(tunnel.sinceBest, 0, 'a block closer is');
  noteProgress(tunnel, new Vec3(3, 40, 2), 17.9);
  assert.equal(tunnel.sinceBest, 1, 'a mob that moved a few blocks is still the same race');
  noteProgress(tunnel, new Vec3(96, 40, 0), 96);
  assert.equal(tunnel.best, 96); assert.equal(tunnel.sinceBest, 0, 'a new leg is a new race');
});

test('an approach shaft lets off only its quarry: it does not dig into a wither skeleton on the way to a blaze', () => {
  const { stairOptions } = require('../src/tunneling');
  const rock = { name: 'netherrack', boundingBox: 'block', diggable: true };
  const air = { name: 'air', boundingBox: 'empty' };
  const bot = {
    entity: { position: new Vec3(0.5, 77, 0.5), height: 1.8 },
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' },
    registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'diamond_pickaxe', type: 1 }] },
    world: { raycast: () => null }, time: { timeOfDay: 6000 }, pathfinder: { movements: {} },
    blockAt: p => ({ ...(p.y < 77 ? rock : air), position: p }),
    _huntingEntity: { name: 'blaze', until: Date.now() + 5000 },
    entities: {
      1: { id: 1, name: 'blaze', position: new Vec3(8.5, 77, 0.5), isValid: true, height: 1.8, width: 0.6 },
      2: { id: 2, name: 'wither_skeleton', position: new Vec3(2.5, 77, 0.5), isValid: true, height: 2.4, width: 0.7 },
    },
  };
  const closing = stairOptions(bot, {}, new Vec3(8, 77, 0), { approach: true });
  assert(closing.length);
  assert.notEqual(closing[0].destination.x, 1, 'the cell next to the skeleton is not the way to the blaze');
  delete bot.entities[2];
  assert.equal(stairOptions(bot, {}, new Vec3(8, 77, 0), { approach: true })[0].destination.x, 1, 'with it gone, straight on');
});

test('the retreat budget is spent between gains, not over the shaft\'s whole life', () => {
  const { noteProgress } = require('../src/tunneling');
  const tunnel = { retreats: 23 }, target = new Vec3(0, 40, 0);
  noteProgress(tunnel, target, 30);
  assert.equal(tunnel.retreats, 0, 'a first best is ground gained');
  tunnel.retreats = 20; noteProgress(tunnel, target, 30);
  assert.equal(tunnel.retreats, 20, 'no gain, the count stands');
  noteProgress(tunnel, target, 28);
  assert.equal(tunnel.retreats, 0);
});

test('a staircase that gains nothing keeps its best and its walked cells, and after three such rounds is set aside', async () => {
  const bot = world();
  bot.pathfinder = { setGoal() {}, goto: async () => {} }; bot.game = { gameMode: 'survival' };
  const dig = async (b, t, p) => { bot.blocks.set(`${p}`, { name: 'air', position: p, boundingBox: 'empty', diggable: false }); };
  const navigate = async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  // A target ninety blocks off, and a best of ten already made: every step here is a step that gains nothing.
  const target = new Vec3(90, 70, 0);
  const goal = { tunnel: { entrance: { x: 0, y: 70, z: 0 }, steps: 3, visited: { walked: 4 }, target: { x: 90, y: 70, z: 0 }, best: 10, sinceBest: 47 } };
  await assert.rejects(tunnelStep(bot, new Task('round'), goal, () => {}, target, { dig, navigate }), /not gaining on it; starting round 2/);
  assert.equal(goal.tunnel.best, 10, 'the best is kept across rounds');
  assert.equal(goal.tunnel.visited.walked, 4, 'and the cells it has walked');
  goal.tunnel.sinceBest = 47;
  await assert.rejects(tunnelStep(bot, new Task('round'), goal, () => {}, target, { dig, navigate }), /starting round 3/);
  goal.tunnel.sinceBest = 47;
  await assert.rejects(tunnelStep(bot, new Task('round'), goal, () => {}, target, { dig, navigate }), e => e.name === 'StaircaseStalled' && /closer than 10 blocks/.test(e.message));
  await assert.rejects(tunnelStep(bot, new Task('again'), goal, () => {}, target, { dig, navigate }), { name: 'StaircaseStalled' }, 'set aside, not walked again');
  assert.equal(goal.attempts['staircase:88,64,0'].action, 'staircase', 'by the area, so a target a block off is covered too');
  await assert.rejects(tunnelStep(bot, new Task('moved'), goal, () => {}, new Vec3(91, 70, 2), { dig, navigate }), { name: 'StaircaseStalled' });
});

test('a new best clears the count of rounds that gained nothing', () => {
  const { noteProgress } = require('../src/tunneling');
  const tunnel = { best: 40, sinceBest: 0, staleRounds: 2 }, target = new Vec3(0, 40, 0);
  noteProgress(tunnel, target, 41);
  assert.equal(tunnel.staleRounds, 2);
  noteProgress(tunnel, target, 38);
  assert.equal(tunnel.staleRounds, 0);
});

test('a staircase stepping between two cells ends its round within a few steps, not forty-eight', async () => {
  const bot = world();
  bot.pathfinder = { setGoal() {}, goto: async () => {} }; bot.game = { gameMode: 'survival' };
  const dig = async (b, t, p) => { bot.blocks.set(`${p}`, { name: 'air', position: p, boundingBox: 'empty', diggable: false }); };
  const navigate = async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  const target = new Vec3(90, 70, 0);
  const goal = { tunnel: { entrance: { x: 0, y: 70, z: 0 }, steps: 20, target: { x: 90, y: 70, z: 0 }, best: 10, sinceBest: 9, visited: {} } };
  // Every way on already walked four times: the pacing is seen now.
  for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) for (const y of [69, 70]) goal.tunnel.visited[`(${x}, ${y}, ${z})`] = 4;
  await assert.rejects(tunnelStep(bot, new Task('pace'), goal, () => {}, target, { dig, navigate }), /not gaining on it/);
  assert.equal(goal.tunnel.staleRounds, 1);
});

test('pinned below two skeletons at full health, the staircase claims them and climbs toward them; hurt, it does not', () => {
  const bot = world();
  bot.game = { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }; bot.registry = require('minecraft-data')('26.1');
  bot.world = { raycast: () => null }; bot.health = 20; bot.food = 20;
  bot.inventory = { items: () => [{ type: 1, name: 'diamond_sword' }, { type: 1, name: 'diamond_pickaxe' }, { name: 'cooked_beef', count: 8 }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } };
  bot.heldItem = null;
  bot.entities = {
    1: { id: 1, name: 'skeleton', position: new Vec3(-8.5, 70, 2.5), isValid: true, width: 0.6, height: 1.99 },
    2: { id: 2, name: 'skeleton', position: new Vec3(-8.5, 70, -1.5), isValid: true, width: 0.6, height: 1.99 },
  };
  // The way on is straight past them: every step that gains is a step closer to a shooter.
  const surface = new Vec3(-20, 70, 0);
  assert(require('../src/mob-policy').kitReady(bot), 'armed and armoured');
  const choices = stairOptions(bot, {}, surface);
  assert(choices[0].destination.distanceTo(surface) < bot.entity.position.floored().distanceTo(surface), 'a step that gains on the surface');
  assert.equal(bot._huntingEntity?.name, 'skeleton');
  delete bot._huntingEntity; bot.health = 8;
  const hurt = stairOptions(bot, {}, surface);
  assert(!hurt.length || hurt[0].destination.distanceTo(surface) >= bot.entity.position.floored().distanceTo(surface) - 0.1 || !bot._huntingEntity, 'hurt, no claim');
  assert.equal(bot._huntingEntity, undefined);
});

test('a pillar goes straight up a block a time, digging what is overhead, and stops beside lava', async () => {
  const { pillarUp } = require('../src/pillar-recovery');
  const registry = require('minecraft-data')('26.1');
  const solid = new Map(), lava = new Set();
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) solid.set(`${x},9,${z}`, 'netherrack');
  solid.set('0,14,0', 'netherrack');
  const block = p => { const k = `${p.x},${p.y},${p.z}`; if (lava.has(k)) return { name: 'lava', boundingBox: 'empty', position: p };
    const n = solid.get(k); return n ? { name: n, boundingBox: 'block', diggable: true, position: p } : { name: 'air', boundingBox: 'empty', position: p }; };
  const bot = { registry, entity: { position: new Vec3(0.5, 10, 0.5), onGround: true, yaw: 0 }, game: { dimension: 'the_nether', gameMode: 'survival' }, entities: {}, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }] }, blockAt: block,
    equip: async () => {}, look: async () => {}, controlState: {}, setControlState(k, v) { this.controlState[k] = v; if (k === 'jump' && v) this.entity.position = this.entity.position.offset(0, 1.1, 0); },
    placeBlock: async (ref) => { solid.set(`${ref.position.x},${ref.position.y + 1},${ref.position.z}`, 'netherrack'); bot.entity.position = new Vec3(0.5, ref.position.y + 2, 0.5); } };
  const dug = [];
  const placed = await pillarUp(bot, new Task('up'), 16, { dig: async (b, t, p) => { dug.push(p.y); solid.delete(`${p.x},${p.y},${p.z}`); } });
  assert.equal(bot.entity.position.y, 16, 'up to the height asked');
  assert.equal(placed, 6); assert.deepEqual(dug, [14], 'and the block overhead was dug');
  // Lava beside the next cell up: stop where it stands.
  bot.entity.position = new Vec3(0.5, 16, 0.5); lava.add('1,17,0');
  assert.equal(await pillarUp(bot, new Task('lava'), 24, { dig: async () => {} }), 0);
  assert.equal(bot.entity.position.y, 16);
});

test('the pillar is raised from the nearest column clear of lava all the way up, not beside the lava fall', () => {
  const { pillarSite } = require('../src/pillar-recovery');
  // Floor at y 9 everywhere; a lava fall at x = -1 from y 10 to 30.
  const blockAt = p => p.y <= 9 ? { name: 'netherrack', boundingBox: 'block', position: p, diggable: true }
    : (p.x === -1 && p.z === 0 && p.y <= 30) ? { name: 'lava', boundingBox: 'empty', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { entity: { position: new Vec3(0.5, 10, 0.5) }, blockAt };
  const site = pillarSite(bot, 28, new Vec3(0, 28, 0));
  assert(site, 'a site is found');
  assert(!(site.x === 0 && site.z === 0), 'not the column beside the lava');
  assert(Math.abs(site.x + 1) + Math.abs(site.z) > 1, 'nor any other column touching it');
});

test('a pillar raised on purpose is not taken back down by the pillar descent', async () => {
  const { descendPillar } = require('../src/pillar-recovery');
  let dug = 0;
  const bot = { entity: { position: new Vec3(0.5, 20, 0.5), onGround: true }, game: { gameMode: 'survival', dimension: 'the_nether' }, entities: {}, oxygenLevel: 20,
    _pillarUp: { x: 0, z: 0, until: Date.now() + 60000 }, blockAt: p => ({ name: p.y < 20 ? 'netherrack' : 'air', boundingBox: p.y < 20 ? 'block' : 'empty', position: p }),
    dig: async () => { dug++; }, pathfinder: { setGoal() {} } };
  assert.equal(await descendPillar(bot, new Task('down'), {}, () => {}), false);
  assert.equal(dug, 0);
});

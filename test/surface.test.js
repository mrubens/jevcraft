'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { surfaceObserver, surfaceMovement, descendCanopy, returnToSurface, beginSurfaceAscent, surfaceReturnComplete } = require('../src/surface');
const { constructionObservation, explore } = require('../src/work');
const { Task } = require('../src/skills');
const { configureMovements } = require('../src/movement');

function world() {
  const blocks = new Map();
  const bot = { game: { minY: 0, height: 100 }, entity: { position: new Vec3(0.5, 64, 0.5) },
    pathfinder: { movements: { canDig: true, allow1by1towers: true, allowSprinting: true, scafoldingBlocks: [1] } },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty' }) };
  return { bot, blocks };
}
test('surface search accepts forest canopy but rejects cave floors and roofs', () => {
  const { bot, blocks } = world();
  blocks.set('(5, 70, 0)', 'oak_leaves');
  blocks.set('(6, 70, 0)', 'oak_log');
  blocks.set('(7, 70, 0)', 'stone');
  const check = surfaceObserver(bot);
  assert(check(new Vec3(0, 64, 0)));
  assert(check(new Vec3(5, 64, 0)));
  assert(check(new Vec3(6, 64, 0)));
  assert(!check(new Vec3(7, 64, 0)));
  assert(!check(new Vec3(0, 24, 0)));
  bot.blockAt = () => null;
  assert(!surfaceObserver(bot)(new Vec3(0, 64, 0)), 'Unloaded terrain cannot establish surface safety');
});

test('surface travel can clear leaf body-space while keeping trunks, terrain and protected foliage intact', () => {
  const registry = require('prismarine-registry')('26.1'), Block = require('prismarine-block')(registry);
  const { bot } = world(); Object.assign(bot, { registry, entities: {}, inventory: { items: () => [] } });
  bot.entity.effects = {};
  bot.pathfinder.setMovements = m => { bot.pathfinder.movements = m; };
  bot.pathfinder.bestHarvestTool = () => null;
  let obstruction = 'spruce_leaves';
  bot.blockAt = point => {
    const p = point.floored();
    const name = p.y < 64 ? 'grass_block' : p.x === 1 && p.z === 0 && p.y <= 65 ? obstruction : 'air';
    const block = Block.fromStateId(registry.blocksByName[name].defaultState); block.position = p; return block;
  };
  const movement = configureMovements(bot), before = { ...movement };
  const forward = () => { const nodes = []; movement.getMoveForward({ x: 0, y: 64, z: 0, remainingBlocks: 0 }, new Vec3(1, 0, 0), nodes); return nodes; };
  const policy = surfaceMovement(bot);
  try {
    const route = forward(); assert.equal(route.length, 1, 'Leaf cover must not imprison a surface explorer');
    assert.equal(route[0].toBreak.length, 2);
    assert(route[0].toBreak.every(p => bot.blockAt(p).name === 'spruce_leaves'));
    for (obstruction of ['spruce_log', 'dirt', 'stone', 'gravel', 'oak_planks']) assert.equal(forward().length, 0, obstruction);
    assert.equal(movement.maxDropDown, before.maxDropDown); assert.equal(movement.allow1by1towers, false);
  } finally { policy.restore(); }
  assert.equal(movement.exclusionAreasBreak, before.exclusionAreasBreak);
  obstruction = 'spruce_leaves';
  for (const inherited of ['no_dig', 'protected']) {
    movement.canDig = inherited !== 'no_dig';
    movement.exclusionAreasBreak = inherited === 'protected' ? [b => b.position.x === 1 ? 100 : 0] : [];
    const restrictions = { ...movement }, guarded = surfaceMovement(bot);
    assert.equal(forward().length, 0, inherited); guarded.restore();
    assert.equal(movement.canDig, restrictions.canDig); assert.equal(movement.exclusionAreasBreak, restrictions.exclusionAreasBreak);
  }
});
test('surface routes can bridge and clear foliage but cannot pillar up, excavate terrain or descend into a cave', () => {
  const { bot, blocks } = world();
  blocks.set('(0, 67, 0)', 'oak_planks');
  const before = { ...bot.pathfinder.movements };
  const policy = surfaceMovement(bot);
  assert(policy.allowed(new Vec3(0, 64, 0)), 'Can leave the starting house');
  assert(!policy.allowed(new Vec3(1, 60, 0)));
  assert(!policy.allowed(new Vec3(20, 24, 0)));
  assert.equal(bot.pathfinder.movements.canDig, true);
  assert.equal(bot.pathfinder.movements.exclusionAreasBreak.at(-1)({ name: 'stone' }), 100);
  assert.equal(bot.pathfinder.movements.allow1by1towers, false);
  assert.deepEqual(bot.pathfinder.movements.scafoldingBlocks, [1]);
  policy.restore();
  for (const [key, value] of Object.entries(before)) assert.deepEqual(bot.pathfinder.movements[key], value);
});

test('surface travel permits river swimming with open headroom while rejecting dives and covered water', () => {
  const { bot } = world();
  bot.blockAt = p => {
    const name = p.x === 11 && p.y === 70 ? 'stone' : p.y < 64 ? p.x === 12 ? 'lava' : 'water' : 'air';
    return { name, boundingBox: name === 'stone' ? 'block' : 'empty' };
  };
  bot.pathfinder.movements.allowedPosition = p => p.x < 20;
  const policy = surfaceMovement(bot);
  assert(policy.allowed(new Vec3(10, 63, 0)), 'Can cross the top of a river');
  assert(!policy.allowed(new Vec3(10, 62, 0)), 'Head cannot submerge');
  assert(!policy.allowed(new Vec3(11, 63, 0)), 'Cannot swim into a flooded cave');
  assert(!policy.allowed(new Vec3(12, 63, 0)), 'Lava is never a swimming route');
  assert(!bot.pathfinder.movements.allowedPosition(new Vec3(21, 63, 0)), 'Retains inherited restrictions');
  policy.restore();
});

function canopyFixture() {
  const registry = require('prismarine-registry')('26.1'), Block = require('prismarine-block')(registry);
  const landing = new Vec3(1, 74, 0), blocks = new Map([['(0, 75, 0)', 'spruce_leaves'], ['(1, 73, 0)', 'spruce_log'], ['(1, 72, 0)', 'spruce_log']]);
  const bot = { registry, game: { gameMode: 'survival', minY: 0, height: 100 }, entity: { position: new Vec3(.5, 76, .5), onGround: true },
    entities: {}, inventory: { items: () => [] }, players: {},
    blockAt(point) {
      const p = point.floored(), name = blocks.get(`${p}`) || (p.y < 64 ? 'grass_block' : 'air');
      const block = Block.fromStateId(registry.blocksByName[name].defaultState); block.position = p; return block;
    },
    findBlocks({ matching, useExtraInfo }) {
      const block = bot.blockAt(landing.offset(0, -1, 0));
      return [].concat(matching).includes(block.type) && (!useExtraInfo || useExtraInfo(block)) ? [block.position] : [];
    }, pathfinder: { movements: { canDig: true, allow1by1towers: true, scafoldingBlocks: [1], maxDropDown: 3 },
      getPathTo: () => ({ status: 'success', path: [landing] }),
      goto: async g => { bot.entity.position = new Vec3(g.x + .5, g.y, g.z + .5); }, setGoal() {} },
  };
  return { bot, landing, blocks };
}

test('surface exploration uses a lower trunk as an intermediate landing when ground is out of reach', async () => {
  const { bot, landing } = canopyFixture(), goal = { request: 'get wood', item: 'spruce_log' };
  const before = { ...bot.pathfinder.movements };
  const travel = bot.pathfinder.goto;
  bot.pathfinder.goto = async g => {
    assert.equal(bot.pathfinder.movements.allow1by1towers, false);
    assert.deepEqual(bot.pathfinder.movements.scafoldingBlocks, []);
    await travel(g);
  };
  await explore(bot, new Task('leave tall tree'), goal, () => {}, 'spruce_log');
  assert.equal(goal.step.action, 'descend_canopy');
  assert(bot.entity.position.floored().equals(landing)); assert.equal(goal.item, 'spruce_log');
  for (const [key, value] of Object.entries(before)) assert.deepEqual(bot.pathfinder.movements[key], value);
});

test('canopy descent rejects deep, wet, obstructed and unfinished routes without building or breaking a trunk', async () => {
  for (const kind of ['too_deep', 'wet', 'blocked', 'partial', 'placing', 'trunk', 'detour', 'protected', 'cancel']) {
    const { bot, blocks, landing } = canopyFixture(), task = new Task('tree exit'), goal = {};
    if (kind === 'too_deep') { bot.entity.position.y = 78; blocks.set('(0, 77, 0)', 'spruce_leaves'); }
    if (kind === 'wet') blocks.set(`${landing}`, 'water');
    if (kind === 'blocked') blocks.set(`${landing}`, 'stone');
    const exclusions = [b => b.position.x === 1 ? 100 : 0];
    bot.pathfinder.movements.exclusionAreasBreak = exclusions;
    const before = { ...bot.pathfinder.movements };
    bot.pathfinder.getPathTo = movement => {
      assert.equal(movement.exclusionAreasBreak[0], exclusions[0]);
      if (kind === 'cancel') task.cancel();
      return { status: kind === 'partial' ? 'partial' : kind === 'protected' ? 'noPath' : 'success',
        path: [{ ...landing, ...(kind === 'placing' && { toPlace: [{}] }),
          ...(kind === 'trunk' && { toBreak: [landing.offset(0, -1, 0)] }), ...(kind === 'detour' && { y: 70 }) }] };
    };
    const run = descendCanopy(bot, task, goal, () => {}, { move: async () => assert.fail(`Unsafe ${kind} route executed`) });
    if (kind === 'cancel') await assert.rejects(run, { name: 'Cancelled' }); else assert.equal(await run, false, kind);
    assert.equal(goal.step, undefined);
    for (const [key, value] of Object.entries(before)) assert.deepEqual(bot.pathfinder.movements[key], value, kind);
  }
});

test('canopy landings must still exist after the route survey and after walking', async () => {
  for (const when of ['survey', 'walking']) {
    const { bot, blocks, landing } = canopyFixture(), task = new Task('changing tree'), goal = {};
    bot.pathfinder.getPathTo = () => {
      if (when === 'survey') blocks.set(`${landing.offset(0, -1, 0)}`, 'air');
      return { status: 'success', path: [landing] };
    };
    const run = descendCanopy(bot, task, goal, () => {}, { move: async () => {
      assert.equal(when, 'walking'); bot.entity.position = landing.offset(.5, 0, .5);
      blocks.set(`${landing.offset(0, -1, 0)}`, 'air');
    } });
    if (when === 'survey') assert.equal(await run, false); else await assert.rejects(run, /inspected landing/);
    assert.equal(goal.step?.landed, undefined);
  }
});

test('covered lower tree landings can clear leaves, with inherited protection and actual arrival checks', async () => {
  for (const kind of ['clear', 'no_dig', 'protected', 'wet_leaf', 'uncleared', 'over_budget']) {
    const { bot, blocks, landing } = canopyFixture(), task = new Task('covered lower landing'), goal = {};
    blocks.set(`${landing}`, 'spruce_leaves'); blocks.set(`${landing.offset(0, 1, 0)}`, 'spruce_leaves');
    if (kind === 'no_dig') bot.pathfinder.movements.canDig = false;
    if (kind === 'protected') bot.pathfinder.movements.exclusionAreasBreak = [b => b.position.equals(landing) ? 100 : 0];
    if (kind === 'wet_leaf') {
      const blockAt = bot.blockAt;
      bot.blockAt = p => { const b = blockAt(p); if (p.equals(landing)) b.getProperties = () => ({ waterlogged: true }); return b; };
    }
    const before = { ...bot.pathfinder.movements }, cleared = [landing, landing.offset(0, 1, 0)];
    if (kind === 'over_budget') for (let i = 2; i < 9; i++) {
      const p = landing.offset(i, 0, 0); blocks.set(`${p}`, 'spruce_leaves'); cleared.push(p);
    }
    bot.pathfinder.getPathTo = () => ({ status: 'success', path: [{ ...landing, toBreak: cleared }] });
    let moved = false;
    const run = descendCanopy(bot, task, goal, () => {}, { move: async () => {
      moved = true; bot.entity.position = landing.offset(.5, 0, .5);
      if (kind !== 'uncleared') for (const p of cleared) blocks.delete(`${p}`);
    } });
    if (kind === 'uncleared') await assert.rejects(run, /inspected landing/);
    else assert.equal(await run, kind === 'clear', kind);
    assert.equal(moved, ['clear', 'uncleared'].includes(kind), kind);
    if (kind === 'clear') assert.deepEqual(goal.step.landed, { ...landing.offset(.5, 0, .5) });
    for (const [key, value] of Object.entries(before)) assert.deepEqual(bot.pathfinder.movements[key], value, kind);
  }
});

test('kelp and seagrass mark the water surface and never masquerade as dry underwater routes', () => {
  for (const name of ['kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']) {
    const { bot } = world();
    bot.blockAt = p => ({ name: p.y < 61 ? 'stone' : p.y < 64 ? name : 'air', boundingBox: p.y < 61 ? 'block' : 'empty' });
    const check = surfaceObserver(bot), policy = surfaceMovement(bot);
    assert(!check(new Vec3(10, 62, 0)), name);
    assert(policy.allowed(new Vec3(10, 63, 0)), `${name} surface`);
    assert(!policy.allowed(new Vec3(10, 62, 0)), `${name} submerged`);
    policy.restore();
  }
});
test('building progress observes placement and clearing with unchanged Creative inventory and position', () => {
  const { bot, blocks } = world();
  const p = new Vec3(1, 64, 1);
  const goal = { blueprint: { blocks: [{ ...p, material: 'gold_block' }], empty: [] } };
  const before = constructionObservation(bot, goal);
  blocks.set(`${p}`, 'gold_block');
  const placed = constructionObservation(bot, goal);
  assert.notEqual(placed, before);
  blocks.set(`${p}`, 'short_grass');
  const obstruction = constructionObservation(bot, goal);
  blocks.delete(`${p}`);
  assert.notEqual(constructionObservation(bot, goal), obstruction);
  blocks.set('(10, 64, 10)', 'stone');
  assert.equal(constructionObservation(bot, goal), before, 'Unrelated world updates are not construction progress');
});

function undergroundFixture() {
  const { bot } = world();
  bot.entity.position = new Vec3(0.5, 55, 0.5);
  bot.registry = require('minecraft-data')('26.1');
  const target = new Vec3(6, 63, 0);
  const inherited = p => p.x >= 0;
  bot.pathfinder.movements.allowedPosition = inherited;
  bot.findBlocks = ({ useExtraInfo }) => {
    const block = { ...bot.blockAt(target), position: target };
    return useExtraInfo(block) ? [target] : [];
  };
  bot.pathfinder.getPathFromTo = function * (movements) {
    assert.equal(movements.canDig, false, 'Survey existing exits before spending recovery-tool ingredients');
    assert(movements.allowedPosition(new Vec3(1, 56, 0)));
    assert(!movements.allowedPosition(new Vec3(1, 51, 0)), 'Recovery must not descend farther into the cave');
    assert(!movements.allowedPosition(new Vec3(-1, 60, 0)), 'Preserve other movement restrictions');
    yield { result: { status: 'partial', path: [] } };
    yield { result: { status: 'success', path: [target.offset(0, 1, 0)] } };
  };
  bot.pathfinder.goto = async g => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  bot.pathfinder.setGoal = () => {};
  return { bot, inherited };
}

test('surface foraging first exits an underground work area without spending its exploration budget', async () => {
  const { bot, inherited } = undergroundFixture();
  const goal = {};
  assert(!surfaceObserver(bot)(bot.entity.position.floored()));
  await explore(bot, new Task('test', 'food'), goal, () => {}, 'food animals', { surfaceOnly: true });
  assert(surfaceObserver(bot)(bot.entity.position.floored()));
  assert.equal(goal.survivalAction.action, 'return_to_surface');
  assert.equal(goal.search, undefined);
  assert.equal(goal.surfaceReturn, undefined);
  assert.equal(bot.pathfinder.movements.allowedPosition, inherited);
  const policy = surfaceMovement(bot);
  assert(!policy.allowed(new Vec3(6, 55, 0)), 'Ordinary surface hunting still rejects caves');
  policy.restore();
});

test('failed or cancelled surface recovery restores movement policy and keeps its bounded attempts', async () => {
  for (const cancelled of [false, true]) {
    const { bot, inherited } = undergroundFixture();
    const task = new Task('test', 'recover'), goal = {};
    bot.pathfinder.getPathFromTo = function * () {
      if (cancelled) task.cancel();
      yield { result: { status: 'noPath', path: [] } };
    };
    await assert.rejects(returnToSurface(bot, task, goal, () => {}), cancelled ? { name: 'Cancelled' } : /No safe route from underground/);
    assert.equal(bot.pathfinder.movements.allowedPosition, inherited);
    assert.equal(goal.surfaceReturn.attempts, 1);
    assert.equal(bot.entity.position.y, 55);
  }
});

test('an open ravine retains its observed rim across restart instead of treating sky as a completed exit', async () => {
  const { bot } = world();
  bot.registry = require('minecraft-data')('26.1');
  bot.entity.position = new Vec3(.5, 51, .5);
  bot.blockAt = p => ({ name: p.y < (p.x >= 5 ? 64 : 51) ? 'stone' : 'air',
    boundingBox: p.y < (p.x >= 5 ? 64 : 51) ? 'block' : 'empty', position: p });
  const target = new Vec3(6, 64, 0), goal = {};
  assert(surfaceObserver(bot)(bot.entity.position), 'The failed location really has open sky');
  assert(beginSurfaceAscent(bot, goal, [new Vec3(2, 51, 0), target]));
  const restored = JSON.parse(JSON.stringify(goal));
  assert(!surfaceReturnComplete(bot, restored));
  assert.equal(restored.surfaceReturn.minimumY, 64);
  bot.findBlocks = ({ useExtraInfo }) => [new Vec3(1, 50, 0), target.offset(0, -1, 0)].filter(p => useExtraInfo(bot.blockAt(p)));
  bot.pathfinder.getPathTo = (_m, g) => { assert.equal(g.y, 64); return { status: 'success', path: [] }; };
  await returnToSurface(bot, new Task('ravine exit'), restored, () => {}, { navigate: async (_bot, _task, g) => {
    bot.entity.position = new Vec3(g.x + .5, g.y, g.z + .5);
  } });
  assert.equal(bot.entity.position.y, 64);
  assert.equal(restored.surfaceReturn, undefined);
});

test('surface escalation requires nearby higher observed ground rather than an invented ascent', () => {
  const { bot } = world(), goal = {};
  assert(!beginSurfaceAscent(bot, goal, [new Vec3(5, 64, 0), new Vec3(100, 80, 0), new Vec3(4, 120, 0)]));
  assert.equal(goal.surfaceReturn, undefined);
});

test('an obstructed ascent can retreat down its existing stair without excavating or dropping farther', async () => {
  const { bot } = world();
  bot.registry = require('minecraft-data')('26.1');
  bot.entity.position = new Vec3(.5, 55, .5);
  bot.inventory = { items: () => [] };
  const retreat = new Vec3(1, 54, 0), open = new Set(['(0, 55, 0)', '(0, 56, 0)', '(1, 54, 0)', '(1, 55, 0)']);
  bot.blockAt = p => ({ position: p, name: open.has(`${p}`) ? 'air' : p.equals(retreat.offset(0, -1, 0)) ? 'stone' : 'oak_planks',
    boundingBox: open.has(`${p}`) ? 'empty' : 'block', diggable: true });
  bot.findBlocks = ({ maxDistance, useExtraInfo }) => maxDistance === 16 && useExtraInfo(bot.blockAt(retreat.offset(0, -1, 0))) ? [retreat.offset(0, -1, 0)] : [];
  bot.pathfinder.getPathTo = (movement, g) => {
    assert.equal(g.y, 54); assert(movement.allowedPosition(retreat));
    assert(!movement.allowedPosition(new Vec3(1, 51, 0)));
    return { status: 'success', path: [retreat] };
  };
  const goal = {};
  await returnToSurface(bot, new Task('obstructed ascent'), goal, () => {}, {
    dig: async () => assert.fail('Do not dig through the obstruction'),
    navigate: async (_bot, _task, g) => { bot.entity.position = new Vec3(g.x + .5, g.y, g.z + .5); },
  });
  assert.equal(bot.entity.position.y, 54);
  assert.equal(goal.surfaceReturn.ascent.retreats, 1);
  assert.equal(bot.pathfinder.movements.canDig, true);
});

test('deep surface recovery excavates one supported step at a time and preserves the mining worksite', async () => {
  const { bot } = world(), changed = new Map();
  bot.entity.position = new Vec3(0.5, 16, 0.5);
  bot.registry = require('minecraft-data')('26.1');
  bot.inventory = { items: () => [{ type: 1 }] };
  bot.findBlocks = () => [];
  bot.blockAt = p => {
    const name = changed.get(`${p}`) || (p.y < 64 ? 'stone' : 'air');
    return { name, position: p, boundingBox: name === 'stone' ? 'block' : 'empty', diggable: true, harvestTools: name === 'stone' ? { 1: true } : undefined };
  };
  changed.set('(0, 16, 0)', 'air'); changed.set('(0, 17, 0)', 'air');
  const mining = { steps: 35, target: { x: -30, y: 2, z: -40 }, visited: {} };
  const goal = { tunnel: mining }, before = { ...bot.pathfinder.movements };
  let digCount = 0;
  for (let step = 0; step < 48 && !surfaceObserver(bot)(bot.entity.position.floored()); step++) {
    const start = bot.entity.position.floored();
    await returnToSurface(bot, new Task('exit'), goal, () => {}, {
      dig: async (_bot, _task, p) => {
        assert(!p.equals(bot.entity.position.floored().offset(0, -1, 0)));
        changed.set(`${p}`, 'air'); digCount++;
      },
      navigate: async (_bot, _task, target) => {
        assert.equal(target.y, start.y + 1);
        assert.equal(bot.blockAt(new Vec3(target.x, target.y - 1, target.z)).name, 'stone');
        bot.entity.position = new Vec3(target.x + 0.5, target.y, target.z + 0.5);
      },
    });
    assert.equal(bot.entity.position.y, start.y + 1);
    for (const [key, value] of Object.entries(before)) assert.deepEqual(bot.pathfinder.movements[key], value);
    assert.equal(goal.tunnel, mining);
    assert.equal(goal.tunnel.steps, 35);
  }
  assert(digCount > 48);
  assert(bot.entity.position.y >= 62, 'Escapes the deep cave through a real opening to the sky');
  assert(surfaceObserver(bot)(bot.entity.position.floored()));
  assert.equal(goal.surfaceReturn, undefined);
  assert.equal(goal.step.action, 'ascend_to_surface');
});

test('surface ascent yields for replacement-tool preparation and can be cancelled without excavating', async () => {
  const { bot } = undergroundFixture(); bot.findBlocks = () => [];
  const task = new Task('exit'), goal = {};
  let preparations = 0;
  const actions = { prepareTool: async () => { preparations++; return false; }, dig: async () => assert.fail('No tool yet') };
  await returnToSurface(bot, task, goal, () => {}, actions);
  assert.equal(preparations, 1); assert.equal(bot.entity.position.y, 55);
  task.cancel();
  await assert.rejects(returnToSurface(bot, task, goal, () => {}, actions), { name: 'Cancelled' });
  assert.equal(preparations, 1);
});

test('an exit through gravel or dirt overhead needs no pickaxe; stone does', () => {
  const { handDiggableExit } = require('../src/surface');
  const world = overhead => ({ game: { minY: -64, height: 384 }, entity: { position: new Vec3(0.5, 66, 0.5) },
    blockAt: p => {
      if (p.x !== 0 || p.z !== 0) return { name: 'air', boundingBox: 'empty' };
      if (p.y < 66) return { name: 'stone', boundingBox: 'block' };
      const name = overhead[p.y];
      return name ? { name, boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' };
    } });
  assert.equal(handDiggableExit(world({ 68: 'gravel', 69: 'gravel', 70: 'dirt' })), true);
  assert.equal(handDiggableExit(world({ 68: 'gravel', 69: 'stone' })), false);
  assert.equal(handDiggableExit(world({})), false, 'nothing overhead is not a dig problem');
  assert.equal(handDiggableExit(world({ 68: 'oak_leaves', 69: 'sand' })), true, 'leaves are passed through');
});

test('a thin cobblestone lid with sky above it is dug straight up, not searched around', async () => {
  const { lidExit, returnToSurface } = require('../src/surface');
  const blocks = { 67: 'cobblestone', 68: 'cobblestone', 71: 'oak_leaves' };
  const bot = { game: { minY: -64, height: 384, dimension: 'overworld' }, entity: { position: new Vec3(0.5, 65, 0.5) },
    pathfinder: { movements: {} }, findBlocks: () => [], registry: { blocksByName: {} },
    blockAt: p => {
      if (p.x !== 0 || p.z !== 0) return { name: 'air', boundingBox: 'empty' };
      if (p.y < 65) return { name: 'grass_block', boundingBox: 'block' };
      const name = blocks[p.y];
      return name ? { name, boundingBox: name.endsWith('_leaves') ? 'block' : 'block' } : { name: 'air', boundingBox: 'empty' };
    } };
  assert.deepEqual(lidExit(bot).map(p => p.y), [67, 68]);
  assert.deepEqual(lidExit({ ...bot, blockAt: p => p.y === 67 && p.x === 0 && p.z === 0 ? { name: 'stone', boundingBox: 'block' } : bot.blockAt(p) }), [], 'stone overhead is terrain, not a lid');
  const dug = [];
  const goal = {}; const task = { check() {} };
  await returnToSurface(bot, task, goal, () => {}, { dig: async (b, t, p) => { dug.push(p.y); delete blocks[p.y]; } });
  assert.deepEqual(dug, [67, 68]);
  assert.equal(goal.surfaceReturn, undefined, 'standing on grass under open sky is the surface');
});

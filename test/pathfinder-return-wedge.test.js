'use strict';
// Note 621: mid-242-ah-nether-2-fortress-5 (25589), 17:32:16 to 17:33:03Z.
// The pathfinder stepped up onto two blocks it laid, the lower laid from
// the edge it backed out to, and kept the cell it had backed from as the
// place to return to (mineflayer-pathfinder's LOSWhenPlacingBlocks,
// returningPos). The bot ended on top of that cell. Every walk after (an out_of_sight and four
// retreats, under a ghast's fire) stood three seconds where it began,
// pressing forward and looking down at its feet, no route ever searched:
// the pathfinder's tick goes to the return first, and nothing but getting
// there clears it. The real plugin, on a corridor over the void.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { goalGuardPlugin } = require('../src/skills');

const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);

// A corridor of stone along x at y 63 (z 0), open over the void either
// side, ending at x 0: the cell a block up past its end, (1, 65, 0), is
// reached only by the pathfinder's step up onto two blocks it lays there,
// the lower from the corridor's edge, as the recorded walk at 17:32:16 laid
// them; `laid` are blocks put since.
function corridorBot() {
  const laid = new Set();
  const solid = p => laid.has(`${p.x},${p.y},${p.z}`) || (p.y === 63 && p.z === 0 && p.x >= -6 && p.x <= 0);
  const blockAt = at => {
    const p = at.floored();
    const b = Block.fromStateId(registry.blocksByName[solid(p) ? 'stone' : 'air'].defaultState, 0);
    b.position = p;
    return b;
  };
  const controls = {};
  const netherrack = { name: 'netherrack', type: registry.itemsByName.netherrack.id, count: 16 };
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', game: { gameMode: 'survival', dimension: 'the_nether' }, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), onGround: true, height: 1.8, width: 0.6, yaw: 0, pitch: 0, effects: {} },
    inventory: { items: () => [netherrack], slots: [] },
    heldItem: null, controlState: controls, blockAt,
    world: { getBlock: blockAt },
    setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates: () => { for (const k of Object.keys(controls)) controls[k] = false; },
    look: async () => {}, lookAt: async () => {}, equip: async () => {}, dig: async () => {}, stopDigging() {}, activateBlock: async () => {},
    placeBlock: async (ref, face) => { const p = ref.position.plus(face); laid.add(`${p.x},${p.y},${p.z}`); },
    // The walk's look ahead simulates nothing here: the test moves the bot.
    physics: { simulatePlayer: state => state },
  });
  bot.laid = laid;
  pathfinder(bot);
  const movements = new Movements(bot);
  Object.assign(movements, { canDig: false, allowParkour: false, allow1by1towers: false, allowSprinting: false, allowEntityDetection: false });
  movements.scafoldingBlocks = [registry.itemsByName.netherrack.id];
  bot.pathfinder.setMovements(movements);
  return bot;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function tick(bot, n = 1) { for (let i = 0; i < n; i++) { bot.emit('physicsTick'); await flush(); } }

// The lower block laid past the corridor's end, then the bot put on top of
// the cell the pathfinder would return to (as a push or its own pillar
// left it in the trial), and a new walk given: is a route searched?
async function walkAfterBridge(bot) {
  const routes = [];
  // Copied as it comes: the pathfinder takes its placements off the path as it lays them.
  bot.on('path_update', r => routes.push(JSON.parse(JSON.stringify({ status: r.status, path: r.path }))));
  bot.pathfinder.setGoal(new goals.GoalBlock(1, 65, 0));
  await tick(bot);
  assert.ok(routes.length, 'the step up is searched');
  assert.ok(routes[0].path.some(n => n.toPlace.length), 'and lays blocks to step up on');
  // Backed out to the edge as the pathfinder asks, when it asks.
  for (let i = 0; i < 20 && !bot.laid.has('1,63,0'); i++) {
    if (bot.controlState.back) bot.entity.position = new Vec3(1.2, 64, 0.5);
    await tick(bot);
  }
  assert.ok(bot.laid.has('1,63,0'), 'the lower block is laid');
  // Now the bot stands a block up, over the cell it came from.
  bot.laid.add('0,64,0');
  bot.entity.position = new Vec3(0.5, 65, 0.5);
  bot.clearControlStates();
  routes.length = 0;
  bot.pathfinder.setGoal(new goals.GoalBlock(-4, 64, 0));
  await tick(bot, 10);
  return routes;
}

test('as the library ships, a block laid from the edge leaves a return that stops every walk after it, once the bot cannot stand there (mid-242-ah-nether-2-fortress-5, 17:32:16)', async () => {
  const bot = corridorBot();
  assert.equal(bot.pathfinder.LOSWhenPlacingBlocks, true);
  const routes = await walkAfterBridge(bot);
  assert.equal(routes.length, 0, 'no route searched for the new goal in ten ticks');
  assert.equal(bot.controlState.forward, true, 'pressing forward at the return it cannot reach');
});

test('with the goal guard, the block is laid from where the bot stands and the next walk is searched at once (note 621)', async () => {
  const bot = corridorBot();
  goalGuardPlugin(bot);
  assert.equal(bot.pathfinder.LOSWhenPlacingBlocks, false);
  const routes = await walkAfterBridge(bot);
  assert.ok(routes.length >= 1, 'the new walk is searched');
  assert.equal(routes[0].status, 'success');
});

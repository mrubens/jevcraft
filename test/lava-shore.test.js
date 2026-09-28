'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);

// The lava sea's soul sand shore where mid-235-p-nether-3-fortress-4 and
// mid-235-p-nether-4-fortress-3 went into the lava on their walks back to
// the portal (note 580), as the region file saved at 04:25:10 has it: x 80
// to 94, y 29 to 38, z 33 to 45, every lava cell a source, its top at y 31.
// The walk came down a soul sand slope from the netherrack ridge at x 86 to
// 92; from (85, 33, 38), on the soul sand at (85, 32, 38), a block's fall
// east or north lands on the shore's soul sand at y 31, whose top (31.875)
// is under the lava's (31.889) beside it.
const SHORE = require('./fixtures/lava-shore-mid-235-p.json');
function shoreBot({ health = 3.5, at = new Vec3(85.5, 32.875, 38.5), set = {} } = {}) {
  const [ox, oy, oz] = SHORE.origin, cache = new Map();
  const nameAt = q => {
    if (set[`${q.x},${q.y},${q.z}`]) return set[`${q.x},${q.y},${q.z}`];
    const inside = q.x >= ox && q.z >= oz && q.x - ox < SHORE.layers[0][0].length && q.z - oz < SHORE.layers[0].length;
    // Open air over the saved box (the cavern the walk came down through).
    if (inside && q.y - oy >= SHORE.layers.length) return 'air';
    const ch = SHORE.layers[q.y - oy]?.[q.z - oz]?.[q.x - ox];
    return ch === undefined ? null : SHORE.palette[ch.charCodeAt(0) - 97];
  };
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), k = `${q}`;
    if (!cache.has(k)) {
      const name = nameAt(q);
      let b = null;
      if (name) { b = Block.fromStateId(registry.blocksByName[name.replace(/:.*/, '')].defaultState, 0); b.position = q; }
      cache.set(k, b);
    }
    return cache.get(k);
  };
  const controls = {};
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 14, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => [{ name: 'netherrack', count: 124, type: registry.itemsByName.netherrack.id }], slots: [] },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    stopDigging() {}, lookAt: async () => {}, blockAt,
    pathfinder: { setMovements(m) { this.movements = m; }, setGoal() {}, isMoving: () => true, goal: null },
  });
  return bot;
}

test('standing on the soul sand shore level with the lava sea is standing in the lava; a whole block there is not (note 580)', () => {
  const { standsInLava } = require('../src/terrain');
  const bot = shoreBot(), at = p => bot.blockAt(p);
  // Where both trials burned: on the soul sand at (86, 31, 37), the source at (86, 31, 36) beside.
  assert.equal(standsInLava(at, { x: 86, y: 32, z: 37 }), true);
  // The ledge a block up, where the walk stood: dry.
  assert.equal(standsInLava(at, { x: 85, y: 33, z: 38 }), false);
  // A whole block in the soul sand's place holds the feet at 32, over the lava's 31.889.
  const rock = shoreBot({ set: { '86,31,37': 'netherrack' } });
  assert.equal(standsInLava(p => rock.blockAt(p), { x: 86, y: 32, z: 37 }), false);
});

test('from the soul sand ledge, the fall onto the shore is a fall into lava: the edge is measured so, and no block is laid backing toward it (mid-235-p-nether-3-fortress-4, note 580)', () => {
  const { configureMovements } = require('../src/movement');
  const bot = shoreBot();
  const m = configureMovements(bot);
  const node = { x: 85, y: 33, z: 38, remainingBlocks: 124 };
  // A block's fall east-north of the ledge lands in the lava's edge.
  assert.deepEqual(m.fallOff(node, 1, -1, bot.health), { into: 'lava', fall: 1 });
  assert.equal(m.deadlyDropBeside(node)?.into, 'lava');
  // The partial route laid a block west at (84, 32, 38), backing to the edge crouched from here; a miss's drift is the shore.
  const west = { x: 84, y: 33, z: 38, remainingBlocks: 123, cost: 1, toPlace: [{ x: 85, y: 32, z: 38, dx: -1, dy: 0, dz: 0 }], toBreak: [] };
  assert.equal(m.overFall(node, west)?.into, 'lava');
  const onward = m.getNeighbors(node);
  assert(!onward.some(n => (n.toPlace || []).some(p => p.dy === 0 && (p.dx || p.dz))), `no block laid level from the ledge: ${JSON.stringify(onward.map(n => [n.x, n.y, n.z, n.toPlace]))}`);
  // Nor is the shore cell itself ever a step of the route.
  assert(!onward.some(n => n.x === 86 && n.y === 32 && n.z === 37));
});

test('the walk crouches on the soul sand ledge over the shore: the drop is measured from the cell over the block stood on (note 580)', async () => {
  const { navigate, Task } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  const { dropNear } = require('../src/terrain');
  const bot = shoreBot({ health: 20 });
  assert.equal(dropNear(bot, new Vec3(85, 33, 38), 1)?.into, 'lava', 'the shore a block down is a drop into lava');
  const { configureMovements } = require('../src/movement');
  configureMovements(bot);
  bot.pathfinder.goto = () => new Promise(r => setTimeout(r, 300));
  const walking = navigate(bot, new Task('portal leg'), new goals.GoalNearXZ(68, 35, 4), { timeoutMs: 400, stallMs: 300 }).catch(() => {});
  for (let i = 0; i < 40 && !bot.listenerCount('physicsTick'); i++) await new Promise(r => setTimeout(r, 5));
  bot.emit('physicsTick');
  assert.equal(bot.controlState.sneak, true, 'crouched on the ledge, where a step off is the lava');
  await walking;
});

test('the stall\'s blind step never goes off onto the shore (note 580)', async () => {
  const { shakeLoose, Task } = require('../src/skills');
  const bot = shoreBot({ health: 20 });
  const looked = [];
  bot.lookAt = async p => { looked.push(p.floored()); };
  await shakeLoose(bot, new Task('shake'), Date.now() + 500, { random: () => 0.5, settleMs: 1, budgetMs: 300 });
  // From the soul sand at (85, 32, 38): north (85, 32, 37) drops onto the shore's soul sand beside the lava.
  assert(!looked.some(p => p.x === 85 && p.z === 37), `stepped toward the shore: ${looked.join(' ')}`);
});

test('the way back to a Nether portal says the lava on the line, what one touch of it costs at this health, and that health does not come back (mid-235-p-nether-3-fortress-4, note 580)', () => {
  const { portalTrip } = require('../src/game-progress');
  const bot = shoreBot({ health: 4.5, at: new Vec3(90.5, 36, 44.5) });
  bot.inventory.slots = { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } };
  const says = portalTrip(bot, { portals: [{ x: 37, y: 56, z: 3, dimension: 'nether' }] });
  assert.match(says, /The nearest portal remembered is \d+ blocks off/);
  assert.match(says, /On the straight line toward it, of the \d+ blocks loaded: .*\d+ over lava/);
  assert.match(says, /One touch of lava costs about 3\.8 a second in it through the armour worn \(a second to get out at the least\), then burns 15 seconds at a point a second that armour does not stop, with no water to put it out in the Nether: about 18\.8 at the least, more than the 4\.5 health the bot has: a touch is death/);
  assert.match(says, /Health does not come back on the way: hunger 14, under eighteen, and nothing to eat; 4\.5 health is what it walks with/);
});

test('digging down a column over the lava sea stops over the rock at the sea\'s level: the body would come down in the lava beside it (mid-242-ae-nether-3-fortress-1, note 580)', () => {
  // mid-242-ae-nether-3-fortress-1 dug down its column at (-106, 106) from y 50, a block at a time "never into a fall that hurts",
  // to the rock at y 30 with the lava sea round it at y 31, and came down into the sea: 20 to none in four seconds.
  const { perchOf, waysDown } = require('../src/way-down');
  const view = { name: p => (p.x === 0 && p.z === 0) ? (p.y <= 49 ? 'netherrack' : 'air') : p.y <= 31 ? (p.y <= 20 ? 'netherrack' : 'lava') : 'air' };
  const perch = perchOf(view, new Vec3(0, 50, 0));
  assert(perch, 'a column over the lava sea is a top');
  const ways = waysDown(view, perch, { health: 20, pickaxe: 'iron_pickaxe', pickaxeUses: 100, nether: true });
  assert(ways.dig_down, 'the column is dug down');
  assert.deepEqual({ ...ways.dig_down.plan.endsAt }, { x: 0, y: 32, z: 0 }, 'on the rock at 31, over the sea\'s own level');
  assert.match(ways.dig_down.description, /lava beside where the feet come down, under the netherrack at 31: the body stands in it there/);
  assert(!ways.step_off, 'no side is stepped off into the sea');
});

test('the way back with no blocks to cross by offers mining them here and crossing, with what the crossing needs (mid-242-aa-nether-1-fortress-3, note 580)', async () => {
  // mid-242-aa-nether-1-fortress-3, 145 blocks from its portal with one block carried, was offered the legs round and waiting,
  // none good 0.38, three times over: the crossing straight at the portal stopped at its first gap for want of blocks.
  const { returnFromNether } = require('../src/work');
  const { Task } = require('../src/skills');
  const { setAside } = require('../src/progress');
  const portal = new Vec3(10, 73, -13);
  const bot = Object.assign(new EventEmitter(), { registry, entity: { position: new Vec3(-14.5, 35, 14.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 20, entities: {}, world: { raycast: () => null },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }], slots: [] },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.nether_portal.id) ? [portal] : [],
    blockAt: p => {
      const name = p.equals(portal) ? 'nether_portal' : p.y <= 31 ? 'lava' : p.y === 34 && p.z === 14 && p.x >= -40 && p.x <= -15 ? 'netherrack' : 'air';
      return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: p };
    },
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {} });
  bot.pathfinder = { movements: {}, setGoal() {}, isMoving: () => false, goto: async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); } };
  const task = new Task('back'), asked = [];
  task.opportunityClient = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: 'wait_rest', confidence: 0.9 } } }; } };
  const goal = { survival: {} };
  setAside(goal, 'staircase', { x: 8, y: 72, z: -16 }, 'no safe step toward it from (-15, 35, 14) (no floor to step onto (a gap, for a span or a pillar): 6 of the steps nearer)', 600000);
  await assert.rejects(returnFromNether(bot, task, goal, () => {}), err => err.name === 'WaysResting');
  assert.equal(asked.length, 1);
  const { options, state } = asked[0];
  assert(options.blocks_then_cross, `offered: ${Object.keys(options)}`);
  assert.match(options.blocks_then_cross, /^Mine netherrack for blocks first \(0 carried; the crossing straight at the portal lays \d+ in its next \d+ blocks\), up to 16, .*then the crossing with them\. Go straight at the portal at the height the bot stands, 16 blocks, laying 16 blocks over open air and lava \(16 of them over lava\), crouched all the way/);
  // The line over the lava sea, and what a touch of it costs, are in the state.
  assert.match(state.between, /over lava/);
  assert.match(state.aTouchOfLava, /^One touch of lava costs about 8 a second in it/);
});

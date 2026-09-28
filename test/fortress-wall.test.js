'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { Task } = require('../src/skills');

// The ground between mid-242-ab-nether-4 and the fortress it saw 102 blocks
// off (note 591), as the region files of 25587 had it at 05:42Z: the bot at
// (203.5, 47, -486.3) in a pocket over a pit to the lava at y 31, a wall of
// netherrack (gold and quartz ore through it) running some ninety blocks
// toward the fortress, a crimson forest's air beyond, and the fortress's
// near end at x 128 to 150, z -572 to -554, its floors at y 57. The columns
// kept are a band of four either side of the lines from the bot to the
// fortress, the ground within twenty of the bot, and that end; the rest is
// unloaded. Each column is its blocks from y 20 to 70 run-length coded.
const WALL = require('./fixtures/fortress-wall-mid-242-ab.json');
const [Y0, Y1] = WALL.y;
function column(key) {
  const s = WALL.columns[key];
  if (!s) return null;
  const out = [];
  for (const [, ch, n] of s.matchAll(/([a-z])(\d*)/g)) for (let i = 0; i < (n ? Number(n) : 1); i++) out.push(WALL.palette[ch.charCodeAt(0) - 97]);
  return out;
}
// Its inventory then: no pickaxe (the iron one had worn out), no block a
// span is laid with, four oak logs and a crafting table.
const CARRIED = [['oak_log', 4], ['crafting_table', 1], ['stick', 1], ['iron_ingot', 11], ['gravel', 16], ['nether_wart_block', 5], ['iron_sword', 1], ['beef', 3]];
function wallBot({ items = CARRIED } = {}) {
  const cols = new Map(), cache = new Map(), dug = new Set(), laid = new Set();
  const nameAt = q => {
    const key = `${q.x},${q.z}`;
    if (!cols.has(key)) cols.set(key, column(key));
    const c = cols.get(key);
    if (!c) return null;
    return q.y < Y0 ? 'netherrack' : q.y > Y1 ? 'netherrack' : c[q.y - Y0];
  };
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), k = `${q}`;
    if (laid.has(k)) { const b = Block.fromStateId(registry.blocksByName.netherrack.defaultState, 0); b.position = q; return b; }
    if (dug.has(k)) { const b = Block.fromStateId(registry.blocksByName.air.defaultState, 0); b.position = q; return b; }
    if (!cache.has(k)) {
      const name = nameAt(q);
      let b = null;
      if (name) { b = Block.fromStateId((registry.blocksByName[name] || registry.blocksByName.stone).defaultState, 0); b.position = q; }
      cache.set(k, b);
    }
    return cache.get(k);
  };
  const inv = items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  let look = null;
  const controls = {};
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health: 20, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival' }, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(203.5, 47, -486.3), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {}, world: { raycast: () => null },
    inventory: { items: () => inv.filter(i => i.count > 0), slots: [] }, chat() {}, blockAt,
    controlState: controls, getControlState: k => !!controls[k], clearControlStates() {}, stopDigging() {},
    equip: async () => {}, lookAt: async p => { look = p; },
    setControlState: (name, on) => { controls[name] = on; if (name === 'forward' && on && look) bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, Math.floor(bot.entity.position.y), Math.floor(look.z) + 0.5); },
    placeBlock: async (ref, face) => { laid.add(`${ref.position.plus(face)}`); inv.find(i => i.name === 'netherrack').count--; },
    dig: async block => { dug.add(`${block.position}`); },
    // Within the columns kept, nearest first.
    findBlocks({ matching, maxDistance = 16, count = 4096 }) {
      const ids = new Set([matching].flat()), c = bot.entity.position.floored(), out = [];
      for (const key of Object.keys(WALL.columns)) {
        const [x, z] = key.split(',').map(Number);
        if (Math.hypot(x - c.x, z - c.z) > maxDistance) continue;
        for (let y = Y0; y <= Y1; y++) {
          const p = new Vec3(x, y, z);
          const b = blockAt(p);
          if (b && ids.has(b.type) && p.distanceTo(c) <= maxDistance) out.push(p);
        }
      }
      return out.sort((a, b) => a.distanceTo(c) - b.distanceTo(c)).slice(0, count);
    },
  });
  bot.pathfinder = { movements: {}, setGoal() {}, isMoving: () => false, getPathTo: () => ({ status: 'noPath', path: [] }) };
  return { bot, dug, laid, inv };
}
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => { asked.push({ id: questions.branch_0, state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
}

test('the recorded crossing through the wall: ore is dug as rock, and the line at the bot\'s height reaches the fortress (mid-242-ab-nether-4, note 591)', () => {
  const { surveyCrossing } = require('../src/bridging');
  const { bot } = wallBot({ items: [['iron_pickaxe', 1]] });
  // To the fortress's nearest brick, a pillar in the forest at y 47: it stopped at the gold ore 93 cells along ("nether gold
  // ore in the way"), as the legs east and north had rested for it.
  const pillar = surveyCrossing(bot, new Vec3(135, 47, -563), { cells: 192, blocks: 999 });
  assert.equal(pillar.stoppedBy, null, JSON.stringify(pillar));
  assert.deepEqual([pillar.cells, pillar.dig, pillar.bridge, pillar.overLava, `${pillar.end}`], [142, 205, 36, 13, '(136, 47, -562)']);
  // To its nearest floor, 11 up: under it.
  const floor = surveyCrossing(bot, new Vec3(142, 57, -563), { cells: 192, blocks: 999 });
  assert.deepEqual([floor.cells, floor.dig, floor.bridge, floor.overLava, `${floor.end}`, floor.stoppedBy], [135, 158, 54, 12, '(143, 47, -562)', null]);
  assert(floor.digSeconds < 60, `dug with the pickaxe: ${floor.digSeconds}`);
});

test('from the recorded spot, fortress_approach offers mining the blocks and crossing with them, and no route the pathfinder did not find (mid-242-ab-nether-4, note 591)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = wallBot();
  const client = jevStub(['keep_searching']);
  const now = Date.now(), rest = why => ({ from: { x: 203, y: 47, z: -486 }, until: now + 240000, at: now - 60000, made: 2, why });
  // Its legs from here as they rested then: two at the gold ore, two out of blocks.
  const goal = { fortressSearch: { axis: 1, legs: 22, since: now - 146 * 60000,
    legRests: { east: rest('nether gold ore in the way'), south: rest('out of blocks (0 carried)'), west: rest('out of blocks (0 carried)'), north: rest('nether gold ore in the way') } } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('No path to the goal!'); }, mineAt: async () => {}, tunnel: async () => {} });
  assert.equal(client.asked.length, 1);
  assert.equal(goal.decisions.at(-1).id, 'fortress_approach');
  const { options, state } = client.asked[0];
  // Offered at 05:42:04 as "The pathfinder found no route toward it from here", and chosen.
  assert.equal(options.walk_route, undefined);
  assert.match(state.walkRoute, /the pathfinder found no route toward it from here/);
  assert.match(state.pickaxe, /^none carried/);
  const d = options.blocks_then_cross;
  assert(d, `offered: ${Object.keys(options)}`);
  assert.match(d, /^Mine netherrack for blocks here first, then go straight at the fortress with them, 98 blocks off and 11 blocks up\./);
  assert.match(d, /No pickaxe is carried, and netherrack dug by hand drops nothing: a wooden pickaxe is made first from what is carried \(4 logs, a crafting table\)/);
  assert.match(d, /The crossing to its end lays 54 blocks \(12 over lava\) and digs 158 of rock in 135 cells; 5 carried\./);
  assert.match(d, /Mined first: 49 from the \d+ that can be dug from ground walked to from here \(\d+ netherrack\)/);
  assert.match(d, /Then, with them: Go straight at the fortress at the height the bot stands, 135 blocks, digging 158 blocks of rock and laying 54 blocks/);
  assert.match(d, /It ends 96 blocks nearer/);
  assert.match(d, /the nearest of the fortress's floors is \d+ blocks across and \d+ up/);
  assert.match(d, /No ghast or blaze is in sight now/);
  assert.match(d, /About \d+ minutes in all\./);
  // Leaving says what searching on from here meets.
  assert.match(options.keep_searching, /\(22 legs so far, 146 minutes searching\).*From here every leg ended at once and rests a few minutes \(nether gold ore in the way; out of blocks \(0 carried\)\)\.$/);
});

test('left from the recorded spot over its ways in, the fortress is offered to the legs as the crossing with blocks mined, and the restock says the pickaxe (mid-242-ab-nether-4, note 591)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = wallBot();
  const client = jevStub(['return_for_blocks']);
  const now = Date.now(), from = { x: 203, y: 47, z: -486 };
  const rest = { from, until: now + 240000, at: now - 60000, made: 1, why: 'out of blocks (0 carried)' };
  const goal = { fortressSearch: { axis: 1, legs: 22, since: now - 146 * 60000,
    // keep_searching at 05:42:04.8, over walk_route and tunnel.
    shunned: [{ x: 135, z: -563, radius: 64, until: now + 600000, at: now, why: 'Jev chose to leave it and search on', from, left: ['walk route', 'tunnel'] }],
    legRests: { east: rest, south: rest, west: rest, north: rest } } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('No path to the goal!'); }, mineAt: async () => {}, tunnel: async () => {}, returnOverworld: async () => {} });
  assert.equal(client.asked.length, 1);
  assert.equal(goal.decisions.at(-1).id, 'fortress_leg');
  const { options } = client.asked[0];
  assert.equal(options.back_to_fortress, undefined, 'going back from here asks the ways left again');
  assert.match(options.blocks_then_cross || '', /^Mine netherrack for blocks here first, then go straight at the fortress with them, 98 blocks off and 11 blocks up\..*The fortress is set aside 0 minutes ago, for 10 minutes more; taken, it is no longer set aside\.$/);
  assert.match(options.restock_blocks, /No pickaxe is carried, and netherrack dug by hand drops nothing: a wooden pickaxe is made first/);
  // Left over the crossing itself from here, it is still the leg's to take (taken, it is carried out, not the ways in asked
  // again), and that is said.
  goal.fortressSearch.shunned[0].left.push('blocks then cross');
  const again = jevStub(['return_for_blocks']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client: again, navigate: async () => { throw new Error('No path to the goal!'); }, mineAt: async () => {}, tunnel: async () => {}, returnOverworld: async () => {} });
  assert.match(again.asked[0].options.blocks_then_cross, /Jev left the fortress from where the bot stands with this way among its ways in\.$/);
});

test('chosen, the blocks are mined first and the crossing laid with them, through the wall to the fortress (note 591)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot, dug, laid, inv } = wallBot({ items: [...CARRIED, ['iron_pickaxe', 1]] });
  const client = jevStub(['blocks_then_cross']);
  const goal = { fortressSearch: { axis: 1, legs: 22 } };
  const mined = [];
  // One block dug from where the bot stands and its drop picked up (work.js mine).
  const mineAt = async (b, t, g, sv, p) => { mined.push(`${p}`); dug.add(`${p}`); const n = inv.find(i => i.name === 'netherrack'); if (n) n.count++; else inv.push({ name: 'netherrack', count: 1, type: registry.itemsByName.netherrack.id }); };
  const navigate = async (b, t, g) => { if (g.x !== undefined && g.y !== undefined) bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate, mineAt, tunnel: async () => { throw new Error('the staircase was not chosen'); } });
  assert.equal(client.asked.length, 1);
  assert.equal(goal.fortressSearch.approach.choice, 'blocks_then_cross');
  // The five nether wart blocks carried are laid too (bridging.js LAID,
  // note 622): 49 mined.
  assert.equal(mined.length, 49, 'the crossing\'s blocks, mined first');
  assert.equal(laid.size, 54, 'and laid over its open air and lava');
  const at = bot.entity.position;
  assert(Math.hypot(at.x - 142.5, at.z - -562.5) <= 2, `under the fortress's floor: ${at}`);
  assert.equal(goal.fortressSearch.approach.failed.length, 0, 'it came nearer');
});

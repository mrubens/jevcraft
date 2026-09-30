'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

// Note 729, item 1: 25591 (mid-242-u) stood on netherrack with an iron
// pickaxe and was sent "for stone to lay spans with" 109 blocks to a
// portal, while recoveryOptions (a separate recovery layer, stillness's
// "recover_N" answers) sent it looking for dirt, cobblestone and stone in
// the Nether too ("No way to dirt/stone/cobblestone from here: none ...
// seen within 128 blocks"), none of which exist there.
test('recoveryOptions asks for netherrack (not dirt or cobblestone) as the footing supply in the Nether (note 729)', async () => {
  const { recoveryOptions } = require('../src/recovery-options');
  const bot = Object.assign(new EventEmitter(), {
    registry, game: { difficulty: 'normal', dimension: 'the_nether', gameMode: 'survival', minY: 0, height: 128 },
    entity: { position: new Vec3(0.5, 65, 0.5) }, entities: {}, health: 20, food: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }] },
    blockAt: p => ({ name: p.y === 64 ? 'netherrack' : 'air', position: p, boundingBox: p.y === 64 ? 'block' : 'empty' }),
    findBlocks: ({ matching }) => {
      const ids = [].concat(matching);
      // Netherrack right underfoot, nothing else within reach.
      return ids.includes(registry.blocksByName.netherrack.id) ? [new Vec3(0, 64, 0)] : [];
    },
    pathfinder: { movements: {} },
  });
  const task = new Task('recovery');
  const goal = { kind: 'win', step: {} };
  const actions = { planningInventory: () => ({ iron_pickaxe: 1 }), catalogPlan: (b, item, count) => item === 'netherrack' ? [{ action: 'mine', block: 'netherrack', drops: 'netherrack', count }] : [] };
  const { options } = await recoveryOptions(bot, task, goal, actions);
  const acquires = options.filter(o => o.kind === 'acquire').map(o => o.item);
  assert(!acquires.includes('dirt'), `dirt should not be sought in the Nether: ${acquires}`);
  assert(!acquires.includes('cobblestone'), `cobblestone should not be sought in the Nether: ${acquires}`);
  assert(acquires.includes('netherrack'), `netherrack should be the Nether's footing supply: ${acquires}`);
});

// Note 729, item 1: returnForKitSays said "for stone" whatever the
// dimension, and offered no honest comparison against restock_blocks
// (removing the option outright would be the hidden-threshold bandaid the
// project's fixes avoid: the fact is added, the choice stays Jev's).
test('the trip home for blocks says what the Overworld gives (never netherrack), with what restock_blocks itself found here (notes 729, 751c)', () => {
  const { returnForKitSays } = require('../src/mob-hunt');
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 40, 0.5) },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] } };
  const homeBy = { portal: { x: 109, y: 64, z: 0 }, says: 'the one it came through, 109 blocks off' };
  const said = returnForKitSays(bot, homeBy, { plan: { want: 7, need: 60, carried: 0 } });
  assert.match(said, /for cobblestone, dirt or other blocks got there to lay spans with/);
  assert.doesNotMatch(said, /netherrack to lay/);
  assert.match(said, /Of the 60 the longest leg short of blocks needs, 7 can be dug from ground walked to from here \(restock_blocks\)/);
  // Nothing diggable here at all: said plainly, not silently.
  const none = returnForKitSays(bot, homeBy, { plan: { want: 0, need: 60, carried: 0 } });
  assert.match(none, /Nothing of what a leg is short of can be dug from ground walked to from here\./);
  // With the ground last stood on offered, said beside it (note 751c).
  const ground = returnForKitSays(bot, homeBy, { plan: { want: 0, need: 60, carried: 0 }, ground: { says: 'the basalt last stood on at (7, 35, -12), 166 blocks back', off: 66 } });
  assert.match(ground, /from here; the basalt last stood on at \(7, 35, -12\), 166 blocks back has blocks to dig \(back_to_ground\), nearer than the portal\./);
  // The same from the Overworld.
  const overworld = returnForKitSays({ ...bot, game: { dimension: 'overworld' } }, homeBy, {});
  assert.match(overworld, /for cobblestone, dirt or other blocks got there to lay spans with/);
});

// A Nether world as a rule: `solid(p)` names the block at p, or null for air.
function netherWorld(position, solid, items = []) {
  const dug = new Set();
  const at = p => {
    const name = dug.has(`${p}`) ? null : solid(p);
    return { name: name || 'air', boundingBox: name && name !== 'lava' ? 'block' : 'empty', diggable: name !== 'bedrock', position: p, digTime: () => 400 };
  };
  const controls = {};
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position }, entities: {}, world: { raycast: () => null },
    inventory: { items: () => items }, findBlocks: () => [], chat() {}, blockAt: at, equip: async () => {}, lookAt: async () => {},
    dig: async block => { dug.add(`${block.position}`); },
    setControlState: () => {}, getControlState: () => false, clearControlStates() {} };
  return { bot, dug };
}

// Note 729, item 2: 25594 (mid-242-tb) sat 14+ minutes on the tip of its own
// span with no pickaxe and 197 blocks carried; back_to_ground (the walk to
// the rock last stood on, note 695) was gated behind having a pickaxe it
// never needed to walk back the way it came.
test('back_to_ground is offered with no pickaxe: the walk back needs no digging, only the blocks already carried (note 729)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  // mid-211-s-nether-4's ground (as the existing restock test uses it): a
  // basalt ledge to z 1, a void south of it, nothing carried and no
  // pickaxe (the existing test carries one; this one carries none).
  const rock = p => p.y <= 31 ? 'lava' : (p.z <= 1 && p.y <= 64) || (p.z <= -4) || (p.z >= 62 && p.y <= 64) ? 'basalt' : null;
  const { bot } = netherWorld(new Vec3(0.5, 65, 1.5), rock, []);
  bot.findBlocks = () => [];
  const goal = { portals: [{ dimension: 'nether', x: -40, y: 65, z: 1 }], fortressSearch: { axis: 1, legs: 3, heading: 1, lastHeading: 1, legMode: 'level',
    target: { x: 1, y: 65, z: 97 }, legFrom: { x: 0, z: 1 }, legSince: Date.now() - 30000, legFails: 3 } };
  const actions = { navigate: async () => {}, tunnel: async () => { throw new Error('No safe way toward (1, 65, 97): open air'); }, mineAt: async () => {}, returnOverworld: async () => {} };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  // Five minutes on, the leg south is offered again.
  goal.fortressSearch.legRests.south.until = Date.now() - 1;
  // The rock last stood on: known and farther than the restock's own reach
  // (16 blocks), as note 695's lastGround keeps it.
  const coverage = require('../src/nether-coverage');
  const real = coverage.lastGround;
  coverage.lastGround = () => ({ key: '-40,65,1', x: -40, y: 65, z: 1, name: 'basalt', at: 0 });
  bot.pathfinder = { movements: {}, getPathTo: () => ({ status: 'success', path: [{ x: 0, y: 65, z: 1, toBreak: [], toPlace: [] }] }) };
  try {
    const client = { asked: [], systemOne: async ({ questions }) => { const o = questions.branch_0.criteria; client.asked.push(o); return { answers: { branch_0: { choice: Object.keys(o)[0], confidence: 0.9 } } }; } };
    await findFortressStep(bot, new Task('hunt'), goal, () => {}, { ...actions, client });
    const options = client.asked[0];
    assert(options.back_to_ground, `back_to_ground should be offered with no pickaxe: ${Object.keys(options)}`);
    assert.equal(options.restock_blocks, undefined, 'no pickaxe: restock_blocks (which digs) is not offered');
  } finally { coverage.lastGround = real; }
});

// Note 729, item 3 addendum: the critic's follow-up (25598 at the spawner
// (-108, 77, 155), 36+ min, 5 kills, 2 rods, 12 to 15 blazes within 16,
// mostly out of sight): the spawner caps at fewer than 6 of its own kind
// near the cage; waiting in a box past that gains nothing, and the rods
// already made are in the blazes already out. The cap fact goes on the
// stall's hold, and going to a blaze already out is offered beside it.
test('the stall at a live cage says the spawner\'s cap and offers going to a blaze already out (note 729)', async () => {
  const CAGE = new Vec3(0, 64, 0);
  const bot = Object.assign(new EventEmitter(), {
    registry, health: 20, food: 19, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: new Vec3(4.5, 64, 0.5), onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1, type: registry.itemsByName.iron_sword.id }] },
    world: { raycast: () => null }, chat() {}, findBlocks: () => [],
    blockAt: p => ({ name: (p.x === 0 && p.y === 64 && p.z === 0) ? 'spawner' : 'air', position: p, boundingBox: 'empty' }),
    entities: Object.fromEntries([...Array(6)].map((_, i) => [i + 1, { id: i + 1, name: 'blaze', type: 'hostile', isValid: true, height: 1.8, width: 0.6,
      // Six blazes right at the cage: the cap is met.
      position: new Vec3(1 + (i % 3) * 0.3, 64, (i % 2) * 0.3) }])),
  });
  const ch = require('../src/cage-hold');
  const goal = { kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 }, fortressSearch: { map: { spawners: [{ x: 0, y: 64, z: 0 }] } } };
  const fight = ch.cageFight(bot, goal);
  assert(fight, 'the fight at the cage should be recognized');
  const navigated = [];
  const answers = ch.stallAnswers(bot, { check() {} }, goal, () => {}, fight, { dig: async () => {}, navigate: async (b, t, g) => navigated.push(g) });
  assert.match(answers.stay_and_fight.description, /6 of the spawner's own kind are already within its own range of the cage: at its cap of 6, it tries none more until fewer are there\./);
  assert(answers.go_to_blaze_about, 'a way to a blaze already out should be offered');
  assert.match(answers.go_to_blaze_about.description, /Go to the nearest blaze already out/);
  await answers.go_to_blaze_about.run();
  assert.equal(navigated.length, 1, 'the walk toward a blaze already out is on foot, not another wait at the cage');
});

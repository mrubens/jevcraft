'use strict';
// Note 685: ways offered that the code cannot take, a search re-asked the
// second it rested, a walk off back into the same pocket (25597, mid-242-gf),
// and a creeper's block re-asked at every step it took while every option
// led with a zombie sixteen blocks off (25594, mid-242-he).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');

const SPAN = require('./fixtures/span-end-mid-243-cd.json');
const SPAN_KIT = [['iron_pickaxe', 1], ['stone_pickaxe', 1], ['iron_sword', 1], ['stone_sword', 1], ['stone_axe', 1], ['raw_iron', 2], ['iron_nugget', 7], ['stick', 2]];
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
}

test('the way back for blocks is offered only by a portal there is to go back by, and none known is said (25597, note 685)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const run = async goal => {
    const bot = groundBot(SPAN, { at: new Vec3(-163.5, 38, 150.5), dimension: 'the_nether', items: SPAN_KIT, indexed: true });
    const client = jevStub(['restock_blocks']);
    await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('No path to the goal!'); }, mineAt: async () => {}, tunnel: async () => {}, returnOverworld: async () => {} }).catch(() => {});
    return client.asked[0];
  };
  const now = Date.now(), from = { x: -163, y: 38, z: 150 };
  const rest = { from, until: now + 240000, at: now - 30000, made: 1, why: 'out of blocks (0 carried)' };
  const search = () => ({ axis: 1, legs: 95, since: now - 165 * 60000, legRests: { east: rest, south: rest, west: rest, north: rest } });
  const none = await run({ fortressSearch: search() });
  assert(none, 'asked');
  assert.equal(none.options.return_for_blocks, undefined, 'no portal known, none in view: not offered');
  assert.match(none.state.portalBack, /no portal is known in the Nether/);
  // The one it came through, worked out from its Overworld side, is a way back.
  const came = await run({ portals: [{ dimension: 'overworld', x: 40, y: 70, z: 1200 }], fortressSearch: search() });
  assert.match(came.options.return_for_blocks, /the one it came through, not seen since, worked out from its Overworld side as near \(5, 150\), 169 blocks off/);
  // One remembered far off is offered with its distance, as the walk back goes to it (no cap in the Nether).
  const far = await run({ portals: [{ dimension: 'nether', x: 800, y: 40, z: 150 }], fortressSearch: search() });
  assert.match(far.options.return_for_blocks, /the nearest known 964 blocks off at 800, 40, 150/);
});

test('the walk back in the Nether goes to a known portal however far; in the Overworld one past 600 is not walked to (note 685)', async () => {
  const { walkToKnownPortal } = require('../src/work');
  const bot = { entity: { position: new Vec3(940, 38, 72) }, game: { dimension: 'the_nether' }, inventory: { items: () => [], slots: [] } };
  // Set aside as a leg that made no ground: the walk is not tried, the way asked is reached.
  const goal = { portals: [{ dimension: 'overworld', x: -800, y: 70, z: 0 }] };
  assert.equal(await walkToKnownPortal(bot, new Task('t'), goal, () => {}, 'overworld'), false, 'past 600 in the Overworld: none to walk to');
  const nether = { portals: [{ dimension: 'nether', x: 4, y: 50, z: 13 }] };
  setAside(nether, 'portal_leg', new Vec3(4, 50, 13), 'test', 60000);
  // The walk is taken up (portal_way asked or the crossing tried), not refused as none known.
  let reached = false;
  try { await walkToKnownPortal(bot, new Task('t'), nether, () => {}, 'nether'); reached = true; } catch (_) { reached = true; }
  assert(reached);
  assert.deepEqual(nether.step?.portal, { x: 4, y: 50, z: 13 }, 'the portal 937 blocks off is the one walked back to');
});

test('in the Nether the warped search rests while the only forest known lies past the step\'s reach (25597, note 685)', () => {
  const warped = require('../src/warped-pearls');
  const goal = { landmarks: [{ kind: 'warped_forest', dimension: 'nether', x: -81, y: 40, z: 26 }] };
  setAside(goal, 'rung', 'warped_search', 'eight legs without a warped forest', 30 * 60000);
  const bot = { entity: { position: new Vec3(940, 38, 72) }, game: { dimension: 'the_nether' } };
  assert.equal(warped.warpedOpen(goal, Date.now(), { bot }), false, 'a forest 1,020 blocks off is not one the step walks to: the rest holds');
  assert.equal(warped.warpedOpen(goal), true, 'from the Overworld, a forest known in the Nether is still a reason to go');
  goal.landmarks.push({ kind: 'warped_forest', dimension: 'nether', x: 900, y: 40, z: 72 });
  assert.equal(warped.warpedOpen(goal, Date.now(), { bot }), true, 'one within reach is walked to');
});

test('the walk off leaves every spot the spell was stuck at, not only this one (25597, note 685)', () => {
  const { localMoves } = require('../src/unstuck');
  // A strip of netherrack floor along x at z 72, y 38, walled north and south.
  const name = p => p.y < 38 ? 'netherrack' : p.y <= 40 && p.z === 72 && p.x >= 920 && p.x <= 960 ? 'air' : p.y > 40 ? 'air' : 'netherrack';
  const view = { name, laid: () => null, carried: {}, pickaxe: null, axe: null, health: 20 };
  const feet = new Vec3(947, 38, 72);
  const plain = localMoves(view, feet, { goal: 'away', visits: {}, from: feet, breathS: 15 }).moves.find(m => m.key === 'walk_off');
  assert(plain, 'a walk off is offered');
  assert.equal(Math.abs(plain.to.x - 947), 8);
  // Stuck at 940 before in this spell: the walk off does not go back there.
  const moves = localMoves(view, feet, { goal: 'away', visits: {}, from: feet, stuckAt: [new Vec3(940, 38, 72)], breathS: 15 }).moves;
  const walk = moves.find(m => m.key === 'walk_off');
  assert(walk, 'a walk off is offered');
  assert(walk.to.x >= 955, `it ends 8 from both spots: ${walk.to}`);
  assert.match(walk.does, /8 blocks from where it got stuck and from the spot it was stuck at before in this spell/);
});

test('every stance leads with the creeper it was asked about, not a zombie sixteen blocks off out of sight (25594, note 685)', () => {
  const { Survival } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  const slots = { 45: { name: 'shield' }, 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } };
  const creeper = { id: 9, name: 'creeper', position: new Vec3(6.5, 64, 0.5), height: 1.7, width: 0.6 };
  const zombie = { id: 10, name: 'zombie', position: new Vec3(-15.5, 64, 0.5), height: 1.95, width: 0.6 };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 17, oxygenLevel: 20, entities: { 9: creeper, 10: zombie }, time: { timeOfDay: 6000 },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), onGround: true, height: 1.8 }, registry, heldItem: null,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'dirt', count: 64 }], slots },
    blockAt: p => { const f = p.floored(); const solid = f.y < 64; return { position: f, name: solid ? 'stone' : 'air', boundingBox: solid ? 'block' : 'empty', diggable: true }; },
    world: { raycast: () => null }, findBlocks: () => [],
    equip: async () => {}, unequip: async () => {}, lookAt: async () => {}, look: async () => {}, attack: () => {},
    pathfinder: { setGoal() {}, movements: {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {}, chat() {} });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const danger = [{ entity: creeper, distance: 6, visible: true }, { entity: zombie, distance: 16, visible: false }];
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  for (const [k, o] of Object.entries(options)) {
    if (k === 'none_good') continue;
    assert.match(o.description, /^The creeper 6 blocks off goes off 1\.5 seconds after it lights, within 3 blocks in sight of the bot: about [\d.]+ through the armour worn two blocks off/, k);
    assert.doesNotMatch(o.description, /^The zombie/, k);
  }
});

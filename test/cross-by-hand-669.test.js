'use strict';
// Note 669: the crossing straight at a fortress dug by hand. mid-242-cf-
// nether-1-fortress-9 (25598, 2026-09-29 09:51-10:12Z) stood in the basalt
// deltas with no pickaxe, 23 blackstone and a crafting table, and was
// offered "Go straight at the fortress ... digging 113 blocks of rock ...
// about 782 seconds" beside the fact "pickaxe: none carried: rock and nether
// bricks cannot be dug, so ... a crossing through rock digs nothing". It
// crawled at four blocks a minute for twelve minutes, twice, and on arriving
// a block under a floor of the fortress was "reached it" three times in
// three seconds without a step and left for the next bricks. The pickaxe
// that the legs offered (make_pickaxe, fetch_stems) the way in never did.
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const id = n => registry.itemsByName[n].id;
const item = (name, count) => ({ name, count, type: id(name) });
// The deltas as the window had them, laid flat: basalt ground at y 60, a
// basalt wall two high from x 2 to 28, the fortress's floor from x 30 at
// the ground's height, two clear over it; lava at y 31 and under. Basalt
// takes 6.25 seconds by hand and 0.5 with a stone pickaxe (the game's
// hardness 1.25).
function deltas(items) {
  const dug = new Set();
  const solid = p => p.y <= 31 ? 'lava' : p.y === 60 && p.z === 0 && p.x >= 30 && p.x <= 54 ? 'nether_bricks'
    : p.y === 60 && p.x <= 29 ? 'basalt' : p.x >= 2 && p.x <= 28 && (p.y === 61 || p.y === 62) ? 'basalt' : null;
  const at = p => {
    const name = dug.has(`${p}`) ? null : solid(p);
    return { name: name || 'air', boundingBox: name && name !== 'lava' ? 'block' : 'empty', diggable: true, position: p,
      digTime: tool => name === 'basalt' ? (tool === id('stone_pickaxe') ? 500 : 6250) : 400 };
  };
  const bricks = Array.from({ length: 25 }, (_, i) => new Vec3(30 + i, 60, 0));
  let look = null;
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(0.5, 61, 0.5) }, entities: {},
    world: { raycast: () => null }, time: { timeOfDay: 6000 }, inventory: { items: () => items }, findBlocks: () => bricks, chat() {}, blockAt: at,
    equip: async () => {}, lookAt: async p => { look = p; }, placeBlock: async () => {}, dig: async b => { dug.add(`${b.position}`); },
    setControlState: (name, on) => { if (name === 'forward' && on && look) bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, Math.floor(bot.entity.position.y), Math.floor(look.z) + 0.5); },
    getControlState: () => false, clearControlStates() {} };
  return { bot, dug };
}
function jev(picks) {
  const asked = [];
  return { asked, systemOne: async ({ kind, state, questions }) => {
    const o = questions.branch_0.criteria;
    if (o.go_in) return { answers: { branch_0: { choice: 'go_in', confidence: 0.9 } } };
    asked.push({ kind, state, options: o });
    return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } };
  } };
}

// Tests of the approach's own words, whose stand-in Jev chose go_in at the
// visit and then leaves: the intention's gate (note 689) is off for them.
const noIntention = t => { process.env.JEV_INTENTION = '0'; t.after(() => { delete process.env.JEV_INTENTION; }); };

test('with no pickaxe the crossing says its seconds by hand against a pickaxe\'s, the fact says rock is dug by hand, and making one is a way in (note 669)', async t => {
  noIntention(t);
  const { findFortressStep } = require('../src/mob-hunt');
  const items = [item('blackstone', 23), item('crafting_table', 1), item('oak_planks', 2), item('basalt', 146)];
  const { bot } = deltas(items);
  const client = jev(['make_pickaxe', 'keep_searching']);
  const made = [];
  const acquireStep = async (b, t, name) => { made.push(name); items.push(item(name, 1)); return true; };
  const goal = { fortressSearch: { axis: 1, legs: 22, target: { x: 96, y: 61, z: 0 } } };
  const actions = { client, acquireStep, navigate: async () => { throw new Error('No path to the goal!'); }, tunnel: async () => { throw new Error('the code tunnelled on its own'); } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const { options, state } = client.asked[0];
  assert(options.make_pickaxe && options.cross_level, Object.keys(options).join());
  assert.match(state.pickaxe, /^none carried: rock is dug by hand and drops nothing, about 2 seconds a block of netherrack, 6\.3 a block of basalt/);
  assert.doesNotMatch(state.pickaxe, /cannot be dug|digs nothing/);
  // 27 cells of wall, two high: 54 blocks, 6.25 seconds each by hand and 0.5 with a stone pickaxe.
  assert.match(options.cross_level, /digging 54 blocks of rock/);
  assert.match(options.cross_level, /about 338 are the 54 blocks of rock dug by hand, none of which drops anything; with a stone pickaxe they take about 27, the crossing about \d+ \(made here from what is carried, a few seconds: make_pickaxe\)/);
  assert.match(options.make_pickaxe, /^Make a stone pickaxe here from what is carried \(3 of the 23 cobblestone or blackstone; 2 planks, a crafting table\)/);
  assert.match(options.make_pickaxe, /digs 54 blocks of rock: about \d+ seconds by hand, about \d+ with a stone pickaxe\. The way in is asked again after\.$/);
  assert.deepEqual(made, ['stone_pickaxe']);
  // Made, the way in is asked again, not counted a way that failed.
  assert.equal(goal.fortressSearch.approach.choice, undefined);
  assert.deepEqual(goal.fortressSearch.approach.failed, []);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const again = client.asked.at(-1);
  assert.equal(again.options.make_pickaxe, undefined, 'carried now: nothing to make');
  assert.doesNotMatch(again.options.cross_level, /dug by hand/);
  assert.match(again.state.pickaxe, /^stone pickaxe/);
});

test('with no pickaxe and no wood for one, the stems are a way in and the crossing says none can be made (note 669)', async t => {
  noIntention(t);
  const { findFortressStep } = require('../src/mob-hunt');
  // The window's pockets: blackstone and a table, no planks, no sticks.
  const items = [item('blackstone', 23), item('crafting_table', 1), item('basalt', 146)];
  const { bot } = deltas(items);
  const client = jev(['keep_searching']);
  const goal = { fortressSearch: { axis: 1, legs: 22, target: { x: 96, y: 61, z: 0 } } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, acquireStep: async () => false, navigate: async () => { throw new Error('No path to the goal!'); }, tunnel: async () => {} });
  const { options } = client.asked[0];
  assert.equal(options.make_pickaxe, undefined);
  assert.match(options.fetch_stems, /^Fetch 1 stem of the Nether's forests now/);
  assert.match(options.fetch_stems, /about \d+ seconds by hand, about \d+ with a stone pickaxe\. The way in is asked again after\.$/);
  assert.match(options.cross_level, /with a stone pickaxe they take about 27, the crossing about \d+ \(none can be made from what is carried: wood is what is short\)/);
});

test('floors seen across a gap are reached when stood on, not from a block under them two across (note 669)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  // 25598 at 09:58:51: the bot at (161.6, 61, 266.7) in its own tunnel, the unwalked floor to stand on at (160, 62, 268).
  const items = [item('basalt', 146)];
  const { bot } = deltas(items);
  bot.entity.position = new Vec3(161.6, 61, 266.7);
  bot.findBlocks = () => [];
  const walks = [];
  const goal = { fortressSearch: { axis: 1, legs: 22, goTo: { x: 160, y: 62, z: 268, kind: 'unwalked', since: Date.now() } } };
  const client = jev(['other_way']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async (b, t, g) => { walks.push(g); throw new Error('No path to the goal!'); }, tunnel: async () => {} });
  assert.equal(walks.length, 1, 'the walk to it is tried, not skipped as reached');
  assert.equal(client.asked[0]?.kind, 'fortress', 'the way there is asked');
  assert.match(client.asked[0].state.stretch, /the walk there on foot failed: No path to the goal!/);
  assert.notEqual(goal.fortressSearch.goToEnded['unwalked'].why, 'reached it');
  // Stood on it, it is reached.
  bot.entity.position = new Vec3(160.5, 62, 268.5);
  goal.fortressSearch.goTo = { x: 160, y: 62, z: 268, kind: 'unwalked', since: Date.now() };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('walked while on it'); }, tunnel: async () => {} });
  assert.equal(goal.fortressSearch.goToEnded['unwalked'].why, 'reached it');
});

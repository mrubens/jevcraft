'use strict';
// Trial note 783: once blazes are known within reach and rods are owed, a
// question about the work offers the ways to the blazes (each with its
// record), the rods' carry-out and the body's safety; the errands are not
// offered, said (src/blaze-goal.js, applied in decide()). And the measure
// and replay over the flight records (scripts/blaze-span.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const decisions = require('../src/decisions');
const BG = require('../src/blaze-goal');
const BS = require('../scripts/blaze-span');

const quiet = async f => { const log = console.log; console.log = () => {}; try { return await f(); } finally { console.log = log; } };
function netherBot({ at = new Vec3(0.5, 64, 0.5), items = [['iron_sword', 1], ['iron_pickaxe', 1]], food = 20, health = 20, dimension = 'the_nether' } = {}) {
  return { entity: { position: at }, health, food, game: { dimension, gameMode: 'survival' }, entities: {}, players: {},
    registry: require('minecraft-data')('26.1'), inventory: { items: () => items.map(([name, count]) => ({ name, count })) } };
}
// 7 rods owed by the hunt, blazes seen 20 times at (10, 64, 10).
function huntGoal({ seenAt = { x: 10, y: 64, z: 10 }, targetCount = 7, spawners = [] } = {}) {
  return { kind: 'win', request: 'beat the game', survival: {}, gameProgress: { phase: 'obtain_blaze_rods' },
    mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount, sightings: seenAt ? [{ ...seenAt, dimension: 'the_nether', seen: 20, at: Date.now() - 60000 }] : [] },
    fortressSearch: { map: { spawners } } };
}
const node = d => ({ description: d });

test('classify: what each answer is for (note 783)', () => {
  assert.equal(BG.classify('fortress_leg', 'go_to_blazes'), 'toward');
  assert.equal(BG.classify('fortress_leg', 'go_to_spawner_2'), 'toward');
  assert.equal(BG.classify('fortress_leg', 'blazes_tunnel'), 'toward');
  assert.equal(BG.classify('fortress_leg', 'unwalked_3'), 'toward');
  assert.equal(BG.classify('fortress_approach', 'cross_level'), 'toward');
  assert.equal(BG.classify('empty_spawner', 'box_here'), 'toward');
  assert.equal(BG.classify('fortress_leg', 'leg_north'), 'off');
  assert.equal(BG.family('fortress_leg', 'leg_north'), 'the search for another fortress');
  assert.equal(BG.classify('fortress_approach', 'keep_searching'), 'off');
  assert.equal(BG.family('upkeep', 'spare_pickaxe'), 'wood and pickaxes');
  assert.equal(BG.family('nether_gather', 'leg_west'), 'gathering');
  assert.equal(BG.family('nether_gather', 'cross_to_2'), 'gathering');
  assert.equal(BG.family('stillness_detour', 'mine_nearby'), 'mining');
  assert.equal(BG.family('while_cooking', 'wait_here'), 'cooking');
  assert.equal(BG.classify('upkeep', 'carry_on'), 'keep');
  assert.equal(BG.classify('upkeep', 'wall_in_first'), 'body');
  assert.equal(BG.classify('empty_spawner', 'stash_rods'), 'carry');
  assert.equal(BG.classify('encounter_stance', 'retreat'), 'reflex');
  assert.equal(BG.classify('portal_way', 'climb_here'), 'other', 'not named: left alone');
  // A food errand is the body's only with nothing safe to eat and hunger under 18.
  assert.equal(BG.purpose('restock_food', 'hoglin_pillar', { needsFood: true }), 'body');
  assert.equal(BG.purpose('restock_food', 'hoglin_pillar', { needsFood: false }), 'off');
  // Back through the portal: the carry-out with rods, the body's for food, else an errand.
  assert.equal(BG.purpose('leave_nether', 'go_back', { rodsCarried: 3 }), 'carry');
  assert.equal(BG.purpose('leave_nether', 'go_back', { needsFood: true }), 'body');
  assert.equal(BG.purpose('leave_nether', 'go_back', {}), 'off');
  assert.equal(BG.wayKind('blazes_cross_level'), 'a bridge or crossing');
  assert.equal(BG.wayKind('go_to_spawner_3'), 'a walk');
  assert.equal(BG.wayKind('stand_by_spawner'), 'a wait at the spawner');
});

test('sieve: the errands are withheld only with rods owed, blazes known, and a way to them offered or the bot within 32 of them', () => {
  const keys = ['fetch_stems', 'spare_pickaxe', 'carry_on'];
  assert.deepEqual(BG.sieve('upkeep', keys, { rodsOwed: 7, known: true, atBlazes: true }).keep, ['carry_on']);
  assert.equal(BG.sieve('upkeep', keys, { rodsOwed: 7, known: true, atBlazes: false }).gated, false, 'far off, no way offered: left');
  assert.equal(BG.sieve('upkeep', keys, { rodsOwed: 0, known: true, atBlazes: true }).gated, false, 'no rod owed');
  assert.equal(BG.sieve('upkeep', keys, { rodsOwed: 7, known: false, atBlazes: true }).gated, false, 'no blaze known');
  const leg = BG.sieve('fortress_leg', ['go_to_blazes', 'leg_north', 'leg_east', 'restock_blocks', 'wall_in_first'], { rodsOwed: 5, known: true });
  assert.deepEqual(leg.keep, ['go_to_blazes', 'wall_in_first']);
  assert.deepEqual(leg.withheld.map(w => w.key), ['leg_north', 'leg_east', 'restock_blocks']);
  // Every option an errand: all stay on offer.
  const all = BG.sieve('nether_gather', ['leg_west', 'cross_to_1'], { rodsOwed: 7, known: true, atBlazes: true });
  assert.equal(all.gated, false); assert.equal(all.allOff, true);
});

test('upkeep at the blazes with rods owed: the spare pickaxe and the stems are not offered, and carry on is taken unasked (note 783)', async () => {
  const bot = netherBot({ at: new Vec3(0.5, 64, 0.5) });
  const goal = huntGoal();
  let asks = 0;
  const client = { systemOne: async () => { asks++; return { answers: { branch_0: { choice: 'spare_pickaxe', confidence: 0.9 } } }; } };
  const tree = { fetch_stems: node('Fetch crimson stems 40 blocks off for a spare pickaxe.'), spare_pickaxe: node('Make a spare pickaxe now.'), carry_on: node('Carry on with the hunt.') };
  const d = await quiet(() => decisions.decide('upkeep', { client, bot, goal, tree, state: {} }));
  assert.equal(asks, 0, 'one way left: not asked');
  assert.deepEqual(d.path, ['carry_on']);
  // The same with the blazes 200 blocks off and no way to them offered here: asked whole.
  const far = huntGoal({ seenAt: { x: 200, y: 64, z: 10 } });
  const e = await quiet(() => decisions.decide('upkeep', { client, bot, goal: far, tree: { ...tree }, state: {} }));
  assert.equal(asks, 1);
  assert.deepEqual(e.path, ['spare_pickaxe']);
  // No rods owed: as before.
  const done = huntGoal({ targetCount: 0 });
  await quiet(() => decisions.decide('upkeep', { client, bot: netherBot(), goal: done, tree: { ...tree }, state: {} }));
  assert.equal(asks, 2);
  // In the Overworld: as before.
  await quiet(() => decisions.decide('upkeep', { client, bot: netherBot({ dimension: 'overworld' }), goal: huntGoal(), tree: { ...tree }, state: {} }));
  assert.equal(asks, 3);
});

test('the fortress leg with a way to the blazes: the legs, the floors elsewhere and the blocks are not offered, said in toTheBlazes, and the way says its record (note 783)', async () => {
  const bot = netherBot({ at: new Vec3(-60.5, 64, 0.5) });
  const goal = huntGoal();
  const asked = [];
  const client = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria, instructions: questions.branch_0.instructions }); return { answers: { branch_0: { choice: 'go_to_blazes', confidence: 0.8 } } }; } };
  const tree = { go_to_blazes: { description: 'Go to where blazes were seen 20 times at (10, 64, 10), 71 blocks off.', target: { x: 10, y: 64, z: 10 } },
    leg_north: node('Search north: 64 blocks.'), leg_east: node('Search east: 64 blocks.'), widen_search: node('Widen the search.'), restock_blocks: node('Dig 20 netherrack for blocks.'), wall_in_first: node('Wall in first.') };
  const d = await quiet(() => decisions.decide('fortress_leg', { client, bot, goal, tree, state: {} }));
  assert.deepEqual(d.path, ['go_to_blazes']);
  const { state, options, instructions } = asked[0];
  assert.deepEqual(Object.keys(options).filter(k => k !== 'none_good').sort(), ['go_to_blazes', 'wall_in_first']);
  assert.match(options.go_to_blazes, /The record \(trials of 2026-09-30T06:08Z to 2026-10-01T05:00Z, blazes known within reach\): a walk chosen 159 times; a rod came within five minutes after 38 \(24%\), a death within five minutes after 12 \(8%\)\.$/);
  assert.match(state.toTheBlazes[0], /^7 blaze rods still needed, and blazes are known: blazes seen 20 times at \(10, 64, 10\), 71 blocks off, last 1 minute ago; the ways to them offered here: go to blazes\.$/);
  assert.match(state.toTheBlazes[1], /^Not offered while that holds: leg north, leg east, widen search \(the search for another fortress\); restock blocks \(blocks\)\./);
  assert.match(state.toTheBlazes[2], /^In the trials of .* 223 such errands were chosen with blazes known within reach: they held 110 bot-minutes/);
  assert.match(JSON.stringify(instructions), /toTheBlazes: blaze rods are still needed/);
  // A place Jev left (waysLeft) is not a known blaze: the legs as before.
  const left = huntGoal(); left.fortressSearch.waysLeft = [{ x: 10, y: 64, z: 10, what: 'blazes', why: 'Jev left it', at: Date.now(), until: Date.now() + 600000, from: { x: -60, y: 64, z: 0 } }];
  const tree2 = { leg_north: node('Search north.'), leg_east: node('Search east.') };
  await quiet(() => decisions.decide('fortress_leg', { client: { systemOne: async ({ questions }) => { asked.push({ options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: 'leg_north', confidence: 0.8 } } }; } }, bot, goal: left, tree: tree2, state: {} }));
  assert.ok(asked.at(-1).options.leg_north && asked.at(-1).options.leg_east);
});

test('a blaze spawner on the fortress map within 32: the stems and a cook are errands; a food errand with nothing to eat at hunger 12 is the body\'s (note 783)', async () => {
  const spawner = { x: 5, y: 64, z: 5, seenAt: Date.now() - 120000 };
  const goal = huntGoal({ seenAt: null, spawners: [spawner] });
  const hungry = netherBot({ food: 12, health: 14, items: [['iron_sword', 1]] });
  const g1 = BG.gate(hungry, goal, 'restock_food', { hoglin_pillar: node('Hunt the hoglin.'), return_for_food: node('Back for food.'), keep_on: node('Keep on.') }, { area: 'survival' });
  assert.deepEqual(g1.facts, [], 'nothing safe to eat, hunger 12: every food way stays');
  const fed = netherBot({ food: 12, health: 14, items: [['iron_sword', 1], ['cooked_beef', 6]] });
  const g2 = BG.gate(fed, goal, 'restock_food', { hoglin_pillar: node('Hunt the hoglin.'), return_for_food: node('Back for food.'), keep_on: node('Keep on.') }, { area: 'survival' });
  assert.deepEqual(Object.keys(g2.tree), ['keep_on']);
  assert.match(g2.facts[0], /the blaze spawner at \(5, 64, 5\), 7 blocks off; the bot is within 32 blocks of them \(the hunt.s look\)\./);
  assert.match(g2.facts[1], /hoglin pillar, return for food \(a food errand with food carried or hunger at 18 or more\)/);
  // The body's questions in the moment are never gated.
  const g3 = BG.gate(fed, goal, 'encounter_stance', { retreat: node('Retreat.'), leg_north: node('?') }, { area: 'combat' });
  assert.deepEqual(Object.keys(g3.tree), ['retreat', 'leg_north']);
  // Off: JEV_BLAZE_GOAL=0.
  process.env.JEV_BLAZE_GOAL = '0';
  try { assert.deepEqual(Object.keys(BG.gate(fed, goal, 'upkeep', { fetch_stems: node('x'), carry_on: node('y') }, { area: 'resources' }).tree), ['fetch_stems', 'carry_on']); }
  finally { delete process.env.JEV_BLAZE_GOAL; }
});

test('blaze-span.js: the span from the first blaze to the first rod, the deaths, leaving, and the replay of a recorded question under the rule', () => {
  const t0 = Date.parse('2026-09-30T10:00:00Z'), m = n => t0 + n * 60000;
  const ask = (t, id, answer, keys, extra = {}) => ({ t, kind: 'decision', dim: 'nether', p: { x: 0, y: 64, z: 0 }, q: { id, answer, keys, held: false, only: false, noneGood: false, spawner: false, blazes: false, rods: 0, words: {}, ...extra } });
  const frames = [
    { t: m(0), kind: 'observation', dim: 'nether', p: { x: 0, y: 64, z: 0 }, rods: 0, hp: 20, food: 20, inv: { cooked_beef: 4 } },
    { t: m(1), kind: 'observation', dim: 'nether', p: { x: 0, y: 64, z: 0 }, rods: 0, hp: 20, blazeSeen: true, blazeAt: [{ x: 10, y: 64, z: 10 }] },
    ask(m(1.5), 'upkeep', 'fetch_stems', ['fetch_stems', 'carry_on', 'none_good']),
    ask(m(2), 'fortress_leg', 'go_to_blazes', ['go_to_blazes', 'leg_north', 'none_good']),
    { t: m(4), kind: 'observation', dim: 'nether', p: { x: 9, y: 64, z: 9 }, rods: 1, hp: 20 },
    { t: m(6), kind: 'observation', dim: 'nether', p: { x: 9, y: 64, z: 9 }, rods: 1, hp: 0 },
    { t: m(6.5), kind: 'observation', dim: 'overworld', p: { x: 0, y: 70, z: 0 }, rods: 0, hp: 20 },
  ];
  const s = BS.measure(frames, { trialStart: m(0), end: m(7) });
  assert.equal(s.start, m(1)); assert.equal(s.how, 'blaze in sight');
  assert.equal(s.firstRod, m(4)); assert.equal(s.seven, null);
  assert.equal(s.deaths.length, 1); assert.equal(s.deaths[0].rods, 1);
  assert.equal(s.left, null, 'a death\'s respawn is not leaving');
  assert.equal(s.asks.length, 2);
  const [up, leg] = s.asks;
  assert.equal(up.near, 14);
  assert.equal(up.rodAfter, true); assert.equal(up.deathAfter, true, 'the death came 4.5 minutes after');
  const r1 = BS.replayAsk(up);
  assert.equal(r1.purpose, 'off'); assert.equal(r1.gated, true); assert.equal(r1.lost, true); assert.equal(r1.oneLeft, true);
  const r2 = BS.replayAsk(leg);
  assert.deepEqual(r2.withheld.map(w => w.key), ['leg_north']); assert.equal(r2.lost, false);
});

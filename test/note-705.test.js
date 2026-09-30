'use strict';
// Note 705: the game's hand-dig rule shared (basalt, blackstone and bricks
// break by hand, slowly, dropping nothing), what a pickaxe is short of said
// on the fetch, plan answers in a chain and reversals said, the trip home's
// target, and a crossing that digs a gravel column before stepping in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { decide } = require('../src/decisions');

function netherBot({ at = new Vec3(163.5, 61, 287.5), health = 20, food = 20, items = [['cobblestone', 12], ['crafting_table', 1], ['netherrack', 157]] } = {}) {
  const inv = items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  const said = [];
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, said,
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv.filter(i => i.count > 0), slots: [] }, chat(m) { said.push(m); }, blockAt: () => null,
  });
}
function jev(answers) {
  const offered = [], states = [];
  let n = 0;
  const client = { systemOne: async ({ state, questions }) => {
    const criteria = questions.branch_0.criteria, keys = Object.keys(criteria);
    offered.push(criteria); states.push(state);
    const choice = Array.isArray(answers) ? answers.find(a => keys.includes(a)) : answers(keys, n++);
    return { answers: { branch_0: { choice, confidence: 0.6, probabilities: { [choice]: 0.6 } } } };
  } };
  return { client, offered, states };
}
const opt = (d, target) => ({ description: d, ...(target ? { target } : {}) });

test('the game\'s hand rule: every rock breaks by hand at hardness x 5 seconds and drops nothing; soul sand drops; bedrock does not break (scratch server 26.1.2)', () => {
  const hd = require('../src/hand-dig');
  const bot = { registry };
  // Measured on a scratch server: 2.0, 6.25, 7.5, 10.0, 7.5 and 0.75 seconds; only soul sand dropped.
  assert.deepEqual(hd.handRule(bot, 'netherrack'), { breaks: true, seconds: 2, drops: false });
  assert.deepEqual(hd.handRule(bot, 'basalt'), { breaks: true, seconds: 6.25, drops: false });
  assert.deepEqual(hd.handRule(bot, 'blackstone'), { breaks: true, seconds: 7.5, drops: false });
  assert.deepEqual(hd.handRule(bot, 'nether_bricks'), { breaks: true, seconds: 10, drops: false });
  assert.deepEqual(hd.handRule(bot, 'stone'), { breaks: true, seconds: 7.5, drops: false });
  assert.deepEqual(hd.handRule(bot, 'soul_sand'), { breaks: true, seconds: 0.75, drops: true });
  assert.deepEqual(hd.handRule(bot, 'bedrock'), { breaks: false, seconds: null, drops: false });
  assert.equal(hd.handSeconds(bot, 'netherrack', { inWater: true }), 10);
  assert.equal(hd.rockByHand(bot), 'netherrack about 2 s, basalt about 6.25 s, blackstone about 7.5 s, nether bricks about 10 s a block by hand, dropping nothing');
  // The same from a block object, and as the block-stock and unstuck rules read it.
  const b = name => ({ name, boundingBox: 'block', hardness: registry.blocksByName[name].hardness, harvestTools: registry.blocksByName[name].harvestTools });
  const bs = require('../src/block-stock');
  for (const name of ['basalt', 'blackstone', 'nether_bricks', 'polished_blackstone_bricks']) assert.equal(bs.handDigs(bot, b(name)), true, name);
  assert.equal(bs.handDigs(bot, b('bedrock')), false);
  const u = require('../src/unstuck');
  assert.equal(u.digSeconds('blackstone', { pickaxe: null, name: () => null }, false), 7.5);
  assert.equal(u.digSeconds('nether_bricks', { pickaxe: null, name: () => null }, false), 10);
});

test('no pickaxe, one stem short: the pickaxe says what it is short of, and fetch_stems says the stems bring it (25589, critic-20260930T0034Z item 1)', () => {
  const { pickaxeFirst } = require('../src/mob-hunt');
  // 25589: cobblestone and a crafting table carried, no planks, no sticks.
  const pick = pickaxeFirst(netherBot());
  assert.equal(pick.none, true);
  assert.deepEqual(pick.short, { planks: 2, stems: 1, for: 'the sticks', then: 'a stone pickaxe from the cobblestone or blackstone carried' });
  assert.match(pick.says, /^No pickaxe is carried and none can be made yet: short of 2 planks \(1 log or stem\) for the sticks, then a stone pickaxe from the cobblestone or blackstone carried\./);
  assert.doesNotMatch(pick.says, /none can be made from what is carried/);
  // Nothing at all: a crafting table, the sticks and a wooden head.
  const bare = pickaxeFirst(netherBot({ items: [['netherrack', 3]] }));
  assert.deepEqual(bare.short, { planks: 9, stems: 3, for: 'a crafting table, the sticks, the head', then: 'a wooden pickaxe' });
});

test('six plan answers in a row from one spot with nothing taking time: the sixth is not asked, the rung\'s question is, with the chain and its reversals said (25589 at 00:32:36Z)', async () => {
  const bot = netherBot(), goal = { kind: 'win', step: { action: 'find_fortress' } };
  // The recorded chain: leave the fortress, go to its blazes, set that aside, fetch stems, go without.
  const order = ['leg_south', 'keep_searching', 'go_to_blazes_about', 'other_way', 'fetch_stems', 'walk_route'];
  const { client, states, offered } = jev((keys, n) => order[n]);
  const leg = () => ({ leg_south: opt('Go south 96 blocks.'), go_to_blazes_about: opt('Go to the blazes about now.'), fetch_stems: opt('Fetch 1 stem.'), back_to_fortress: opt('Go back into the fortress in view.') });
  const approach = () => ({ walk_route: opt('Walk the route.'), keep_searching: opt('Leave this fortress for ten minutes.'), other_way: opt('Leave this way for now.') });
  const asks = [['fortress_leg', leg], ['fortress_approach', approach], ['fortress_leg', leg], ['fortress_approach', approach], ['fortress_leg', leg]];
  for (const [q, tree] of asks) await decide(q, { client, bot, goal, tree: tree(), state: { height: 61 } });
  // The third asking (fortress_leg after keep_searching): go to blazes about says it turns back on leaving.
  assert.match(offered[2].go_to_blazes_about, /It turns back on keep searching \(fortress approach\), chosen \d+ seconds? ago \(leave this fortress\)\.$/);
  assert.match(offered[2].back_to_fortress, /It turns back on keep searching/);
  assert.doesNotMatch(offered[2].leg_south, /turns back/);
  // The fourth asking hears the reversal the third answer made, and the chain.
  assert.match(states[3].reversal, /^go to blazes about \(fortress leg\), chosen \d+ seconds? ago, reverses keep searching \(fortress approach\), chosen \d+ seconds? ago from here: leave this fortress$/);
  assert.match(states[3].planAnswersJustNow, /^3 plan answers in the last \d+ seconds? from this spot, none of which took any time: leg south \(fortress leg\), keep searching \(fortress approach\), go to blazes about \(fortress leg\); 1 of them turned back on one before: go to blazes about turned back on keep searching \(leave this fortress\)$/);
  // The sixth is not asked: the rung's question, once, with the chain said.
  await assert.rejects(decide('fortress_approach', { client, bot, goal, tree: approach(), state: {} }), err => {
    assert.equal(err.name, 'Stalled');
    assert.equal(err.stall.escalated.to, 'rung_progress');
    assert.match(err.stall.escalated.says, /^5 plan answers in the last \d+ seconds? from this spot, none of which took any time: leg south \(fortress leg\), keep searching \(fortress approach\), go to blazes about \(fortress leg\), other way \(fortress approach\), fetch stems \(fortress leg\); .*fortress approach was not asked again$/);
    return true;
  });
  assert.equal(states.length, 5, 'the sixth was not asked');
  delete bot._stalls.stall;
  // Asked again after, the chain begins afresh.
  await decide('fortress_approach', { client, bot, goal, tree: approach(), state: {} });
  assert.equal(states.length, 6);
});

test('answers with time between them, or from another spot, are no chain (note 705)', async () => {
  const pc = require('../src/plan-chain');
  const bot = netherBot(), goal = { kind: 'win' };
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) pc.note(bot, goal, 'fortress_leg', ['leg_south'], { now: t0 + i * 6000 });
  assert.equal(pc.chainOf(bot, goal, t0 + 36000 - 1000).length, 1, 'six seconds apart: something took time');
  const g2 = { kind: 'win' };
  for (let i = 0; i < 6; i++) { bot.entity.position.x += 4; pc.note(bot, g2, 'fortress_leg', ['leg_south'], { now: t0 + i * 500 }); }
  assert.equal(pc.chainOf(bot, g2, t0 + 3000).length, 1, 'four blocks a step: it moved');
  assert.equal(pc.check(bot, g2, 'fortress_leg', t0 + 3000), null);
  // Not a question about the plan: not kept.
  pc.note(bot, g2, 'encounter_stance', ['fight']);
  assert.equal(g2.planAnswers.at(-1).q, 'fortress_leg');
});

test('the trip home goes to the portal: go_back is said and held toward the portal, not the fortress asked about (25588 at 00:32:04Z)', async () => {
  const bot = netherBot({ at: new Vec3(-378, 76, -241), health: 1.2, food: 9 });
  const goal = { kind: 'win', portals: [{ x: 40, y: 111, z: -51, dimension: 'overworld' }, { x: 3, y: 42, z: 8, dimension: 'nether' }] };
  const { client, offered } = jev(['go_back', 'go_in']);
  const fortress = { x: -328, y: 73, z: -293 };
  const tree = () => ({ go_in: opt('Go in now, at health 1.2 and hunger 9.'), go_back: opt('Go back through the portal to the Overworld for food.') });
  await decide('fortress_visit', { client, bot, goal, target: fortress, tree: tree(), state: {} });
  assert.deepEqual(goal.intention.target, { x: 3, y: 42, z: 8 });
  assert.equal(bot.said.at(-1), 'Going back through the portal for food at (3, 42, 8): hunger 9, health 1.');
  // Its own question asked again three minutes on, nothing changed: go_in says it turns back on it.
  goal.intention.at -= 3 * 60000;
  for (const e of goal.planAnswers) e.at -= 3 * 60000;
  await decide('fortress_visit', { client, bot, goal, target: fortress, tree: tree(), state: {} });
  assert.match(offered[1].go_in, /It turns back on go back \(fortress visit\), chosen 3 minutes ago \(go back through the portal\); health 1\.2 then, 1\.2 now, hunger 9 then, 9 now\.$/);
  assert.doesNotMatch(offered[1].go_back, /turns back/);
});

test('a crossing digs the gravel column over the head\'s cell until the cell stays open, and does not step into it while it falls (25588 at 00:26Z)', async () => {
  const { clearCell } = require('../src/bridging');
  // Gravel at the head's cell and three more over it; each dug, the next falls in a moment later.
  let column = 4;
  const head = new Vec3(10, 39, 0);
  const cell = p => {
    const name = p.x === 10 && p.z === 0 && p.y >= 39 && p.y < 39 + column ? 'gravel' : p.y < 38 ? 'netherrack' : 'air';
    return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, hardness: 0.6, digTime: () => 900 };
  };
  let dug = 0;
  const bot = Object.assign(netherBot({ at: new Vec3(9.5, 38, 0.5) }), {
    blockAt: p => cell(p),
    dig: async () => { dug++; column--; },
    equip: async () => {}, heldItem: null,
  });
  bot.inventory.items = () => [];
  await clearCell(bot, { check() {} }, head);
  assert.equal(dug, 4, 'the whole column dug');
  assert.equal(bot.blockAt(head).name, 'air');
});

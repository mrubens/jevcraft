'use strict';
// Note 709: two actions that hand the turn to each other on a round trip,
// each leg walking off and the other walking back, are one flip, judged by
// the rung's measure where the trip comes back to. 25584 mid-242-pf
// (2026-09-30 01:33 to 01:40Z) traded enter_nether (the portal site looked
// for at the staircase's worksite, 11.6 from its lava, a search_heading walk
// of 8 to 20 blocks) and return_to_mine (past twelve from the lava, the
// staircase's first move back to its worksite at (0, 77, 127)) every four
// seconds for seven minutes; the flip watch's in-place rule (every change
// within five blocks) never saw it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');

function watchedBot(at) {
  const bot = new EventEmitter();
  Object.assign(bot, { entity: { position: at.clone() }, inventory: { items: () => [] }, game: { gameMode: 'survival', dimension: 'overworld' }, placeBlock: async () => {} });
  const stillness = require('../src/stillness');
  stillness.watchStalls(bot, () => null);
  return { bot, stop: () => stillness.unwatchStalls(bot) };
}
// Each change as the watch saw it: the step and where the bot stood.
function trades(bot, goal, seen, { t0 = 7_000_000, gap = 4000 } = {}) {
  const { flipWatch } = require('../src/stillness');
  let t = t0, raised = null;
  for (const [step, p] of seen) { t += gap; bot.entity.position = new Vec3(...p); goal.step = { ...step }; raised = flipWatch(bot, goal, t) || raised; }
  return { raised, t };
}
const enter = { action: 'enter_nether', phase: 'reach_nether' };
const back = { action: 'return_to_mine', resource: 'lava_for_portal', destination: { x: 0, y: 77, z: 127 } };
const MINE = [1.0, 78.2, 128.5];
// The recorded legs' far ends (01:33:44 to 01:34:28Z), one nearer the frame's site than the worksite is.
const recorded = [[enter, MINE], [back, [8.3, 80, 135.5]], [enter, [0.5, 77, 128.5]], [back, [13.0, 78, 126.0]], [enter, [1.0, 78.0, 129.7]]];

test('25584: enter nether and return to mine trading on a round trip are raised, said by where the trip comes back to', () => {
  const pairs = require('../src/flip-pairs');
  const { takeStall } = require('../src/stillness');
  const { bot, stop } = watchedBot(new Vec3(...MINE));
  try {
    const goal = { kind: 'win', rungTime: { phase: 'reach_nether' }, survival: {}, portalFrame: { origin: { x: 20, y: 71, z: 122 }, blocks: [] } };
    const { raised, t } = trades(bot, goal, recorded);
    assert.match(raised?.why || '', /^turning between enter nether and return to mine 4 times in 16 seconds, each enter nether begun back at \(1, 78, 128\) after a leg of up to 12 blocks with nothing gained on the rung: no obsidian or flint and steel/);
    assert.deepEqual(raised.escalated && { from: raised.escalated.from, to: raised.escalated.to }, { from: 'flip', to: 'rung_progress' });
    // Rests together from the worksite: the next trade there is raised at once.
    assert(pairs.resting(goal, ['enter_nether', 'return_to_mine'], new Vec3(...MINE), t));
    takeStall(bot);
    const again = trades(bot, goal, [[back, [2, 86, 139]], [enter, MINE]], { t0: t + 5000 });
    assert.match(again.raised?.why || '', /^turning between enter nether and return to mine again within 5 blocks of where they rested together/);
  } finally { stop(); }
});

test('a round trip that brings something back, or whose return comes nearer the frame each time, is not a flip', () => {
  // Nearer the frame at each return: the staircase going on toward it.
  const nearer = watchedBot(new Vec3(...MINE));
  try {
    const goal = { kind: 'win', rungTime: { phase: 'reach_nether' }, survival: {}, portalFrame: { origin: { x: 20, y: 71, z: 122 }, blocks: [] } };
    const seen = [[enter, [1, 78, 128]], [back, [-8, 80, 135]], [enter, [4.5, 78, 127]], [back, [-8, 80, 136]], [enter, [4.9, 78, 126]]];
    // Each return 3.5 blocks nearer: within the trip's reach of the first, and nearer the frame by more than two.
    const { raised } = trades(nearer.bot, goal, seen);
    assert.equal(raised, null, raised?.why);
  } finally { nearer.stop(); }
  // More carried at the end (a chest emptied into the pockets each trip).
  const carried = watchedBot(new Vec3(...MINE));
  try {
    const goal = { kind: 'win', rungTime: { phase: 'reach_nether' }, survival: {} };
    let n = 0;
    carried.bot.inventory.items = () => [{ name: 'obsidian', count: n }];
    const { flipWatch } = require('../src/stillness');
    let raised = null, t = 9_000_000;
    for (const [step, p] of recorded) { t += 4000; n += 2; carried.bot.entity.position = new Vec3(...p); goal.step = { ...step }; raised = flipWatch(carried.bot, goal, t) || raised; }
    assert.equal(raised, null, raised?.why);
  } finally { carried.stop(); }
});

test('a staircase whose two steps each begin a block or two on is not a round trip', () => {
  const { bot, stop } = watchedBot(new Vec3(1, 78, 128));
  try {
    const goal = { kind: 'win', rungTime: { phase: 'reach_nether' }, survival: {} };
    const tunnel = { action: 'tunnel', target: { x: -8, y: 70, z: 125 } };
    const seen = [[enter, [1, 78, 128]], [tunnel, [0.2, 77, 128]], [enter, [-0.6, 76, 127.8]], [tunnel, [-1.4, 75, 127.6]], [enter, [-2.2, 74, 127.4]]];
    const { raised } = trades(bot, goal, seen, { gap: 2000 });
    assert.equal(raised, null, raised?.why);
  } finally { stop(); }
});

test('25584: the win strategy answered holds while an option it was answered over comes and goes', async () => {
  const { strategyStep } = require('../src/strategy');
  const { Task } = require('../src/skills');
  const GEAR = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow'].map(name => ({ name, count: 1 })).concat({ name: 'arrow', count: 16 });
  let items = GEAR.filter(i => !['golden_boots', 'diamond_sword'].includes(i.name));
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), game: { dimension: 'overworld', gameMode: 'survival' }, chat() {},
    health: 20, food: 20, isAlive: true, entities: {}, time: { timeOfDay: 1000 }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => items } });
  const goal = { version: 1, kind: 'win', request: 'beat the game' };
  const asked = [];
  const decide = async (id, args) => { asked.push(Object.keys(args.tree)); return { path: [Object.keys(args.tree)[0]] }; };
  const stage = { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  let now = 1e12;
  await strategyStep(bot, new Task('win'), goal, () => {}, stage, { decide, now: () => now });
  assert.deepEqual(asked[0], ['rung_golden_boots', 'nether_first', 'rung_diamond_sword'], 'the diamond sword optional, offered after the Nether now (note 776)');
  // The diamond sword made (an option gone, not the one chosen): held.
  items = GEAR.filter(i => i.name !== 'golden_boots');
  now += 4000;
  await strategyStep(bot, new Task('win'), goal, () => {}, stage, { decide, now: () => now });
  assert.equal(asked.length, 1, 'held over fewer options');
  // And back again: it was on offer when answered, so still held.
  items = GEAR.filter(i => !['golden_boots', 'diamond_sword'].includes(i.name));
  now += 4000;
  await strategyStep(bot, new Task('win'), goal, () => {}, stage, { decide, now: () => now });
  assert.equal(asked.length, 1, 'held as the option comes back');
  // One not on offer at the answer asks again: the armour, chosen (optional
  // before the Nether, note 776), reopened by the boots gone.
  goal.rungOptIn = { iron_armour: Date.now() };
  items = GEAR.filter(i => !['golden_boots', 'diamond_sword', 'iron_boots'].includes(i.name));
  now += 4000;
  await strategyStep(bot, new Task('win'), goal, () => {}, stage, { decide, now: () => now });
  assert.equal(asked.length, 2, `asked with something new on offer: ${asked.at(-1)}`);
});

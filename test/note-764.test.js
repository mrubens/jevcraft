'use strict';
// Note 764: an answer is a commitment with its end stated. The question's
// definition or the option says what ends it; until one of those happens,
// asking again returns the held answer without asking Jev
// (src/decisions/commit.js, decide()); turn_priority's ruling holds a fight
// through the fight and a minute through an unchanged scene (arbiter.js); and
// win_strategy's going to the Nether holds until the bot is there
// (strategy.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const commit = require('../src/decisions/commit');
const { decide, question } = require('../src/decisions');
const arbiter = require('../src/arbiter');

const facts = (over = {}) => ({ t: 0, pos: { x: 0, y: 64, z: 0 }, dimension: 'overworld', health: 20, food: 20, inv: {}, threats: {}, deaths: 0, ...over });
const held = (until, over = {}) => ({ key: 'a', as: 'a', until, at: 0, facts: facts(), offered: ['a'], ...over });

test('what ends a commitment: each named fact changing band, and always the dimension, a death, its time, and its answer gone', () => {
  const on = new Set(['a']);
  const ends = (until, now, extra = {}) => commit.endedBy(held(until, extra), facts({ t: 1000, ...now }), { offered: on });
  assert.equal(ends({ health: true }, { health: 17 }, { facts: facts({ health: 19 }) }), null, 'a scratch is not a band');
  assert.match(ends({ health: true }, { health: 15 }, { facts: facts({ health: 19 }) }), /health went from 19 to 15/);
  assert.match(ends({ health: true }, { health: 19 }), /health went from 20 to 19/, 'full is a band of its own');
  assert.equal(ends({ health: true }, { health: 11 }, { facts: facts({ health: 9 }) }), null, 'health coming back part way is not an end');
  assert.match(ends({ health: true }, { health: 20 }, { facts: facts({ health: 9 }) }), /health went from 9 to 20/, 'back to full is');
  assert.match(ends({ hunger: true }, { food: 17 }), /hunger went from 20 to 17/);
  assert.equal(ends({ hunger: true }, { food: 18 }), null);
  // The mobs about: a new kind, more of a kind, all of one gone (with four blocks' give).
  const zombie = { zombie: [1, 1] };
  assert.match(ends({ threats: true }, { threats: { zombie: [1, 1], skeleton: [1, 1] } }, { facts: facts({ threats: zombie }) }), /a skeleton came within 16 blocks/);
  assert.match(ends({ threats: true }, { threats: { zombie: [2, 2] } }, { facts: facts({ threats: zombie }) }), /more zombies within 16 blocks \(2, from 1\)/);
  assert.equal(ends({ threats: true }, { threats: { zombie: [0, 1] } }, { facts: facts({ threats: zombie }) }), null, 'stepped just past sixteen');
  assert.match(ends({ threats: true }, { threats: {} }, { facts: facts({ threats: zombie }) }), /the zombie about is gone/);
  assert.equal(ends({ threats: true }, { threats: { zombie: [1, 2] } }, { facts: facts({ threats: { zombie: [1, 2] } }) }), null, 'the same, one drifting');
  // What is carried, against its line.
  assert.equal(ends({ items: { raw_iron: 5 } }, { inv: { raw_iron: 4 } }), null);
  assert.match(ends({ items: { raw_iron: 5 } }, { inv: { raw_iron: 5 } }), /raw iron carried reached 5 \(5\)/);
  // Always.
  assert.match(ends({}, { dimension: 'the_nether' }), /the bot went to the nether/);
  assert.match(ends({}, { deaths: 1 }), /the bot died/);
  assert.match(ends({ seconds: 1 }, {}), /1 second passed/);
  assert.match(commit.endedBy(held({}), facts({ t: 1000 }), { offered: new Set(['b']) }), /no longer on offer/);
  assert.match(ends({ arrives: 4 }, { pos: { x: 3, y: 64, z: 0 } }, { target: { x: 0, y: 64, z: 0 } }), /it arrived/);
  // Something new offered, or only what its pattern names.
  assert.match(commit.endedBy(held({ newOption: true }), facts({ t: 1 }), { offered: new Set(['a', 'b']) }), /b is offered, which was not/);
  assert.equal(commit.endedBy(held({ newOption: '^ore:' }), facts({ t: 1 }), { offered: new Set(['a', 'light_tunnel']) }), null);
  assert.match(commit.endedBy(held({ newOption: '^ore:' }), facts({ t: 1 }), { offered: new Set(['a', 'ore:diamond']) }), /diamond is offered/);
  assert.match(commit.endedBy(held({}, { endedBy: 'its way failed' }), facts({ t: 1 }), { offered: on }), /its way failed/);
  assert.equal(commit.needLine(3, 2, 128), 5, 'the rung wants two more');
  assert.equal(commit.needLine(52, 0, 128), 128, 'the rung wants none: the worth keeping');
  assert.equal(commit.needLine(140, 0, 128), null, 'past both');
});

// The night mine: 71% of its re-asks within 30 s came as the ore chosen was dug.
const ore = (id, kind, x, carried, more) => {
  const item = kind === 'coal' ? 'coal' : `raw_${kind}`, line = commit.needLine(carried, more, kind === 'coal' ? 128 : undefined);
  return [`ore_${id}`, { target: { x, y: 60, z: 0 }, description: `Dig to the ${kind} ore ${x} blocks off (${carried} ${item.replaceAll('_', ' ')} carried; tools).`,
    commit: { as: `ore:${kind}`, until: line ? { items: { [item]: line } } : {} } }];
};
function mineBot(items) {
  return { entity: { position: new Vec3(0.5, 60, 0.5) }, health: 20, food: 20, game: { dimension: 'overworld' }, entities: {}, inventory: { items: () => Object.entries(items).map(([name, count]) => ({ name, count })) } };
}

test('night_mine_target: an ore chosen is its kind, taken unasked block after block until its line is carried, and asked again then with how it ended', async () => {
  const items = { raw_iron: 1 };
  const bot = mineBot(items), goal = { step: { action: 'mine' } };
  const seen = [];
  let pick = 'ore_1';
  const client = { systemOne: async ({ state, questions }) => { seen.push({ state, questions }); return { answers: { branch_0: { choice: pick, confidence: 0.9 } } }; } };
  const ask = tree => decide('night_mine_target', { client, bot, goal, tree, state: {} });
  const first = await ask(Object.fromEntries([ore(1, 'iron', 5, 1, 2), ore(2, 'coal', 3, 40, 0), ['branch', { description: 'A branch.' }]]));
  assert.deepEqual(first.path, ['ore_1']);
  assert.equal(seen.length, 1);
  assert.match(seen[0].state.answersHold, /^ore 1, ore 2, branch: chosen, each holds \(the question not asked again meanwhile\) until health falls a band of four \(or is full again\), the mobs about change .*, a kind of ore not offered now is, it fails or is no longer on offer, 5 minutes pass; and ore 1 until raw iron carried reaches 3; ore 2 until coal carried reaches 128\.$/);
  // Dug: the next iron ore is a new key, taken without asking.
  items.raw_iron = 2;
  const next = await ask(Object.fromEntries([ore(3, 'iron', 4, 2, 1), ore(2, 'coal', 3, 40, 0), ['branch', { description: 'A branch.' }]]));
  assert.deepEqual(next.path, ['ore_3']);
  assert.match(next.held, /^ore 1 was chosen \d+ seconds? ago and holds until raw iron carried reaches 3/);
  assert.equal(seen.length, 1, 'not asked');
  // The rung's iron carried: asked again, and told how the last ended.
  items.raw_iron = 3; pick = 'ore_4';
  await ask(Object.fromEntries([ore(4, 'iron', 6, 3, 0), ore(2, 'coal', 3, 40, 0), ['branch', { description: 'A branch.' }]]));
  assert.equal(seen.length, 2);
  assert.match(seen[1].state.lastCommitment, /^ore 1 \(night mine target\), chosen \d+ seconds? ago to hold until .*, ended: raw iron carried reached 3 \(3\); asked afresh$/);
});

test('night_mine_target: a new kind of ore offered, or the way failing, ends the hold; a torch coming on offer does not', async () => {
  const items = { raw_iron: 1 };
  const bot = mineBot(items), goal = { step: { action: 'mine' } };
  let asked = 0;
  const client = { systemOne: async () => { asked++; return { answers: { branch_0: { choice: 'ore_1', confidence: 0.9 } } }; } };
  const ask = tree => decide('night_mine_target', { client, bot, goal, tree, state: {} });
  const base = () => [ore(1, 'iron', 5, 1, 5), ['branch', { description: 'A branch.' }]];
  // Each ore dug brings its iron (an answer that came to nothing ends the hold, tried.js).
  await ask(Object.fromEntries(base()));
  items.raw_iron++;
  await ask(Object.fromEntries([...base(), ['light_tunnel', { description: 'A torch.' }]]));
  assert.equal(asked, 1, 'a torch on offer is not an ore');
  items.raw_iron++;
  await ask(Object.fromEntries([...base(), ore(9, 'diamond', 7, 0, 1)]));
  assert.equal(asked, 2, 'a diamond ore offered');
  items.raw_iron++;
  await ask(Object.fromEntries(base()));
  assert.equal(asked, 2, 'held again');
  commit.end(bot, 'night_mine_target', 'the way to the iron ore failed: no route');
  await ask(Object.fromEntries(base()));
  assert.equal(asked, 3);
});

test('night_mine_target: an answer that came to nothing in the ledger (nothing gained, nothing moved) ends its hold, said so', async () => {
  const bot = mineBot({ raw_iron: 1 }), goal = { step: { action: 'mine' } };
  const seen = [];
  const client = { systemOne: async ({ state }) => { seen.push(state); return { answers: { branch_0: { choice: 'ore_1', confidence: 0.9 } } }; } };
  const tree = () => Object.fromEntries([ore(1, 'iron', 5, 1, 5), ['branch', { description: 'A branch.' }]]);
  await decide('night_mine_target', { client, bot, goal, tree: tree(), state: {} });
  await decide('night_mine_target', { client, bot, goal, tree: tree(), state: {} });
  assert.equal(seen.length, 2);
  assert.match(seen[1].lastCommitment, /ended: it came to nothing/);
  // And where Jev chose none good, or the answer was under the bar, nothing is held.
  commit.drop(bot, 'night_mine_target');
  assert.equal(commit.holding(bot, 'night_mine_target'), null);
});

test('the question\'s definition states its hold: night_mine_target, upkeep and survival_priority\'s hunts; light_tunnel and a pickaxe made hold nothing', () => {
  const nm = question('night_mine_target'), up = question('upkeep'), sp = question('survival_priority');
  assert.equal(commit.spec(nm, 'light_tunnel', {}), null);
  assert.deepEqual(commit.spec(nm, 'branch', {}).until, { health: true, threats: true, newOption: '^ore:', seconds: 300 });
  assert.equal(commit.spec(up, 'make_pickaxe', {}), null);
  assert.equal(commit.spec(up, 'carry_on', {}).until.newOption, true);
  assert.equal(commit.spec(sp, 'hunt_4412', { description: { animal: 'cow' } }).as, 'hunt:cow');
  assert.equal(commit.spec(sp, 'secure_shelter', {}), null);
  for (const q of [nm, up, sp]) assert.match(q.trigger, /note 764/);
});

test('survival_priority: a hunt for a cow holds for cows, the next cow in view taken unasked, until hunger crosses a band', async () => {
  const items = {};
  const bot = mineBot(items); bot.food = 12;
  const goal = { step: { action: 'mine' } };
  let asked = 0, pick = 'hunt_101';
  const client = { systemOne: async () => { asked++; return { answers: { branch_0: { choice: 'obtain_food', confidence: 0.9 }, branch_1: { choice: pick, confidence: 0.9 } } }; } };
  const hunt = (id, animal) => [`hunt_${id}`, { description: { action: `Hunt this ${animal}.`, animal }, run: async () => true }];
  const tree = (...hunts) => ({ obtain_food: { description: 'Get food.', children: Object.fromEntries([...hunts, ['search_food', { description: 'Search.' }]]) }, continue_request: { description: 'Carry on.' } });
  const first = await decide('survival_priority', { client, bot, goal, tree: tree(hunt(101, 'cow'), hunt(7, 'pig')), state: {} });
  assert.deepEqual(first.path, ['obtain_food', 'hunt_101']);
  items.beef = 1;
  const next = await decide('survival_priority', { client, bot, goal, tree: tree(hunt(102, 'cow'), hunt(7, 'pig')), state: {} });
  assert.deepEqual(next.path, ['obtain_food', 'hunt_102']);
  assert.equal(asked, 1);
  bot.food = 18; items.beef = 2; pick = 'hunt_103';
  await decide('survival_priority', { client, bot, goal, tree: tree(hunt(103, 'cow')), state: {} });
  assert.equal(asked, 2, 'fed to eighteen: asked');
});

// turn_priority: read from the records of 13:20Z to 19:00Z, the same answer
// came back at 100% of 349 re-asks for a newcomer after survival's
// escape_threat, 98% of 175 for its own step stopped, 100% of 128 for a food
// band, and 93 to 99% of 938 for "a minute passed".
const fakeBot = (over = {}) => ({ entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, oxygenLevel: 20, entities: {}, ...over });
const claim = (layer, action, urgency = 'routine', extra = {}) => ({ layer, action, urgency, facts: {}, run: async () => true, ...extra });
const mob = (name, distance, id = 1) => ({ entity: { name, id }, distance, visible: true });

test('turn_priority: survival\'s answer to a threat holds through the fight it answers, and ends with its claim', async () => {
  let asked = 0;
  const decide = async () => { asked++; return { path: ['survival'] }; };
  const state = {}, bot = fakeBot({ health: 18, food: 18 });
  const fight = (action = 'escape_threat', extra = {}) => [claim('survival', action, 'pressing', extra), claim('work', 'mine')];
  const at = (now, claims = fight(), mobs = [mob('zombie', 5, 1)]) => arbiter.arbitrate(bot, claims, { state, decide, now, mobs });
  assert.equal((await at(0)).by, 'jev');
  assert.equal((await at(1000, fight(), [mob('zombie', 5, 1), mob('zombie', 4, 2), mob('skeleton', 5, 3)])).by, 'held', 'a newcomer is the fight it answers');
  state.ruling.stoppedBy = 'Threat nearby: zombie at 2 blocks';
  assert.equal((await at(2000)).by, 'held', 'its own step stopped by the mob');
  bot.health = 11; bot.food = 17;
  assert.equal((await at(3000)).by, 'held', 'health and food falling');
  assert.equal((await at(4000, fight('creeper_back_off', { alert: 'creeper' }))).by, 'held', 'its own alert coming');
  assert.equal(asked, 1);
  // The fight over: survival's claim is not a fight's, and the other rules read again (health and food as they were).
  bot.health = 18; bot.food = 18;
  assert.equal((await at(5000, [claim('survival', 'secure_shelter', 'pressing'), claim('work', 'mine')], [])).by, 'held', 'the fingerprint is the same layers');
  assert.equal((await at(6000, [claim('survival', 'secure_shelter', 'pressing'), claim('work', 'mine')], [mob('skeleton', 5, 9)])).why, 'a newcomer within six blocks');
  // Another layer's claim coming ends a fight ruling too.
  state.ruling = { ...state.ruling, action: 'escape_threat' };
  assert.equal((await at(7000, [...fight(), claim('vitals', 'eat', 'pressing')])).why, 'the claims changed');
});

test('turn_priority: a minute passed renews a ruling whose scene is as it was, up to five minutes; a reflex\'s pass and the winner alone keep it', async () => {
  let asked = 0;
  const decide = async () => { asked++; return { path: ['work'] }; };
  const state = {}, bot = fakeBot();
  const claims = () => [claim('survival', 'secure_shelter', 'pressing'), claim('work', 'mine')];
  const at = (now, extra = {}) => arbiter.arbitrate(bot, claims(), { state, decide, now, mobs: [mob('zombie', 12, 1)], ...extra });
  await at(0);
  for (let m = 1; m < 5; m++) assert.equal((await at(m * arbiter.RULING_MS + 1)).by, 'held', `minute ${m}`);
  assert.equal(asked, 1);
  assert.equal((await at(5 * arbiter.RULING_MS + 2)).why, 'a minute passed', 'five minutes: asked');
  const was = state.ruling;
  await arbiter.arbitrate(bot, [...claims(), { ...claim('vitals', 'swim_up', 'body'), reflex: 'air' }], { state, decide, now: 5 * arbiter.RULING_MS + 3 });
  assert.equal(state.ruling, was, 'a reflex\'s pass keeps it');
  for (const t of [1, 2]) await arbiter.arbitrate(bot, [claim('work', 'mine')], { state, decide, now: 5 * arbiter.RULING_MS + 3 + t, mobs: [] });
  assert.equal(state.ruling, was, 'its winner alone keeps it');
  assert.equal((await at(5 * arbiter.RULING_MS + 10)).by, 'held', 'the others come back to it');
  for (const t of [1, 2]) await arbiter.arbitrate(bot, [claim('survival', 'secure_shelter', 'pressing')], { state, decide, now: 5 * arbiter.RULING_MS + 20 + t, mobs: [] });
  assert.equal(state.ruling, undefined, 'another\'s claim alone ends it');
  // A minute on with another scene (a kind of mob about): asked.
  await at(6 * arbiter.RULING_MS);
  const n = asked;
  assert.equal((await at(7 * arbiter.RULING_MS + 1, { mobs: [mob('zombie', 12, 1), mob('spider', 14, 5)] })).why, 'a minute passed');
  assert.equal(asked, n + 1);
});

// win_strategy: 185 re-asks within 30 s followed nether_first or
// stage_reach_nether with the ladder's stage flipped by a craft.
const GEAR = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow'].map(name => ({ name, count: 1 })).concat({ name: 'arrow', count: 16 });
function strategyFixture(without = []) {
  const items = GEAR.filter(i => !without.includes(i.name));
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), game: { dimension: 'overworld', gameMode: 'survival' },
    health: 20, food: 20, isAlive: true, entities: {}, time: { timeOfDay: 1000 }, entity: { position: new Vec3(.5, 64, .5) }, inventory: { items: () => items } });
  return { bot, items, goal: { version: 1, kind: 'win', request: 'beat the game' }, task: new (require('../src/skills').Task)('win') };
}

test('win_strategy: going to the Nether holds past its set-asides and the ladder read afresh, and is asked again when a rung opens, the dimension changes or its time is up', async () => {
  const { strategyStep, HOLD_MS } = require('../src/strategy');
  const { bot, items, goal, task } = strategyFixture(['golden_boots', 'diamond_sword']);
  const asked = [];
  const decide = async (id, args) => { asked.push(Object.keys(args.tree)); return { path: [['stage_reach_nether', 'nether_first'].find(k => args.tree[k])] }; };
  let now = Date.now();
  const { nextGameStage } = require('../src/game-progress');
  assert.deepEqual(await strategyStep(bot, task, goal, () => {}, { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 }, { decide, now: () => now }), { replan: true });
  assert.equal(goal.strategy.choice, 'nether_first', 'kept past its set-asides');
  // The ladder read afresh: the portal's stage, the take-ups beside it. Held, not asked.
  now += 5000;
  assert.equal(nextGameStage(bot, goal).phase, 'reach_nether');
  assert.equal(await strategyStep(bot, task, goal, () => {}, nextGameStage(bot, goal), { decide, now: () => now }), null);
  assert.equal(asked.length, 1, 'held');
  // A rung neither open nor known then opens (the iron boots worn out, note 709's case): asked.
  items.splice(items.findIndex(i => i.name === 'iron_boots'), 1);
  now += 5000;
  await strategyStep(bot, task, goal, () => {}, nextGameStage(bot, goal), { decide, now: () => now });
  assert.equal(asked.length, 2, 'a new rung');
  assert.equal(goal.strategy.choice, 'nether_first');
  now += 5000;
  await strategyStep(bot, task, goal, () => {}, nextGameStage(bot, goal), { decide, now: () => now });
  assert.equal(asked.length, 2, 'held again');
  // Another dimension than it was chosen in (as if chosen in the Nether and come back): asked.
  now += 5000; goal.strategy.dimension = 'the_nether';
  await strategyStep(bot, task, goal, () => {}, nextGameStage(bot, goal), { decide, now: () => now });
  assert.equal(asked.length, 3, 'the dimension changed');
  now += HOLD_MS;
  await strategyStep(bot, task, goal, () => {}, nextGameStage(bot, goal), { decide, now: () => now });
  assert.equal(asked.length, 4, 'its time up');
});

test('ask-loops replays the records through the rule: an ore dug is held, a new kind is asked', () => {
  const C = commit;
  const def = question('night_mine_target');
  const f = (t, inv) => facts({ t, inv });
  const tree = (...o) => Object.fromEntries(o);
  const asks = [
    { t: 0, choice: 'ore_1', tree: tree(ore(1, 'iron', 5, 1, 3)), facts: f(0, { raw_iron: 1 }) },
    { t: 2000, choice: 'ore_2', tree: tree(ore(2, 'iron', 4, 2, 2)), facts: f(2000, { raw_iron: 2 }) },
    { t: 4000, choice: 'ore_3', tree: tree(ore(3, 'iron', 4, 3, 1)), facts: f(4000, { raw_iron: 3 }) },
    { t: 6000, choice: 'ore_5', tree: tree(ore(4, 'iron', 4, 4, 0), ore(5, 'gold', 6, 0, 3)), facts: f(6000, { raw_iron: 4 }) },
  ];
  const r = C.replay(def, asks);
  assert.deepEqual(r.held.map(a => a.t), [2000, 4000]);
  assert.deepEqual(r.sent.map(a => a.t), [0, 6000]);
});

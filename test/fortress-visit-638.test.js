'use strict';
// Note 638: whether a visit to a fortress happens now. Note 631 measured that what moves a blaze fight's death
// rate is the health and hunger it begins at (over 16 health 14% died and 12% brought a rod; 8 to 16, 24% and 6%;
// under 8, 58% and none; hunger under 18, 24% and 6%), yet fortress_approach had twelve ways in and no "not yet".
// fortress_visit is asked once per visit with the row the bot is in and what can change it first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const visit = require('../src/fortress-visit');
const { question } = require('../src/decisions');
require('../src/decisions/travel');

const registry = require('minecraft-data')('26.1');
// A bot in the Nether with `items` carried, at (0, 64, 0), blazes and hoglins as given.
function bot({ health = 20, food = 20, items = [['iron_sword', 1]], saturation = 5, hoglin = false, worn = ['iron_helmet', 'iron_chestplate'] } = {}) {
  const stock = items.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 }));
  const entities = hoglin ? { 9: { id: 9, name: 'hoglin', type: 'hostile', position: new Vec3(12.5, 64, 0.5), height: 1.4, width: 1.3964844, isValid: true } } : {};
  const slots = { 45: { name: 'shield' } }; worn.forEach((n, i) => { slots[5 + i] = { name: n }; });
  const b = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food, foodSaturation: saturation, entities,
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock, slots }, blockAt: () => ({ name: 'netherrack', boundingBox: 'block', position: new Vec3(0, 63, 0) }), world: { raycast: () => null } });
  b.stock = stock;
  return b;
}
const goalOf = (extra = {}) => ({ portals: [{ dimension: 'nether', x: 0, y: 64, z: 300 }, { dimension: 'overworld', x: 0, y: 70, z: 37 }], survival: { deaths: [] }, ...extra });
const fortress = { distance: 40, height: 0, at: { x: 40, y: 64, z: 0 } };

test('at 20 health fed the visit has two answers: go in, or leave the fortress; the record says the top row and nothing is refused', () => {
  const b = bot();
  const tree = visit.options(b, null, goalOf(), () => {}, { navigate: async () => {} }, { fortress, leave: () => {} });
  assert.deepEqual(Object.keys(tree).sort(), ['go_in', 'leave_fortress']);
  assert.match(tree.go_in.description, /^Go in now, at health 20 and hunger 20 with nothing to eat:/);
  assert.match(tree.go_in.description, /at health 20: over 16 health, 307 fights begun there, 14% died, 12% brought a rod; at hunger 20: 18 or more, 255 fights begun there, 16% died, 13% brought a rod/);
  assert.match(tree.go_in.description, /a day's record of fights begun in that row, not a forecast for this fortress/);
  assert.match(tree.leave_fortress.description, /gains no rod|It gains no rod/);
});

test('at 5 health, hunger 14 and nothing to eat: no wait is offered (nothing would come back), go in says none comes back, go back is priced at the measured pace, the hoglin hunt says both facts', () => {
  const b = bot({ health: 5, food: 14, hoglin: true });
  const calls = [];
  const tree = visit.options(b, null, goalOf(), () => {}, { navigate: async () => {}, returnOverworld: async () => calls.push('back') }, { fortress, leave: () => {} });
  assert.deepEqual(Object.keys(tree).sort(), ['go_back', 'go_in', 'hoglin_hunt', 'leave_fortress']);
  assert.match(tree.go_in.description, /under 8 health, 26 fights begun there, 58% died, none brought a rod; at hunger 14: under 18, 160 fights begun there, 24% died, 6% brought a rod/);
  assert.match(tree.go_in.description, /Health does not come back: hunger 14 is under eighteen and nothing carried is food, so every point lost in the fight stays lost/);
  assert.doesNotMatch(tree.go_in.description, /Health does come back/);
  // Going back: the walk is minutes at the measured pace, from note 626, and its record.
  assert.match(tree.go_back.description, /17 to 30 blocks a minute/);
  assert.match(tree.go_back.description, /minutes, not seconds/);
  assert.match(tree.go_back.description, /It gains no rod while it lasts/);
  // The hoglin: the pillar's figures and the hunts' record, both, and that this hunt is on foot.
  assert.match(tree.hoglin_hunt.description, /lost 0\.1 health on average over 168 stances, against 0\.4 said, with 2 deaths inside fifteen seconds/);
  assert.match(tree.hoglin_hunt.description, /none in 66 begun in the Nether/);
  assert.match(tree.hoglin_hunt.description, /goes at the hoglin on foot: it does not stand on a pillar/);
  // Nothing refuses the visit for health: go in is on offer at 1 health too.
  const hurt = visit.options(bot({ health: 1, food: 2 }), null, goalOf(), () => {}, {}, { fortress });
  assert(hurt.go_in, 'go in is offered at 1 health');
});

test('the hoglin hunt sets the hunt as the survival layer\'s food hunt does, and go back sets the trip', async () => {
  const b = bot({ health: 12, food: 10, hoglin: true });
  const goal = goalOf();
  let back = 0;
  const tree = visit.options(b, { check() {} }, goal, () => {}, { navigate: async () => {}, returnOverworld: async () => { back++; } }, { fortress });
  await tree.hoglin_hunt.run();
  assert.equal(goal.survival.nightPlan.kind, 'hoglin');
  assert.equal(goal.survival.nightPlan.food, true);
  await tree.go_back.run();
  assert.equal(back, 1);
  assert.equal(goal.leaveNether.reason, 'food'); assert.equal(goal.leaveNether.pick, 'go_back');
});

test('at 12 health and hunger 18 with food carried: eating and waiting is offered with its seconds and the rows it moves; going back is not (health comes back here)', () => {
  const b = bot({ health: 12, food: 18, items: [['iron_sword', 1], ['cooked_beef', 4]], saturation: 0 });
  const tree = visit.options(b, null, goalOf(), () => {}, { returnOverworld: async () => {}, navigate: async () => {} }, { fortress, leave: () => {} });
  assert.deepEqual(Object.keys(tree).sort(), ['go_in', 'heal_first', 'leave_fortress']);
  assert.match(tree.heal_first.description, /^Do not go in yet: eat what is carried \(4 cooked beef, 8 hunger each\), which brings hunger to 20, and wait where the bot stands until the health is full: from 12, about \d+(\.\d)? seconds/);
  assert.match(tree.heal_first.description, /standing still spends no hunger; at most three minutes, then the visit is asked again/);
  assert.match(tree.heal_first.description, /the health row moves from 8 to 16 health \(24% died, 6% brought a rod\) to over 16 health \(14% died, 12% brought a rod\)/);
  assert.match(tree.heal_first.description, /fights begun in that row, not a trial of waiting/);
  assert.match(tree.go_in.description, /Health does come back on the way/);
});

test('with hunger 14 and food that brings it to 20, the wait is offered; with food that does not reach 18 and health 20, only feeding is, and it says health does not come back', () => {
  const rich = visit.options(bot({ health: 5, food: 14, items: [['iron_sword', 1], ['cooked_beef', 1]] }), null, goalOf(), () => {}, {}, { fortress });
  assert(rich.heal_first, 'one cooked beef takes hunger to 20 and health comes back');
  const thin = visit.options(bot({ health: 20, food: 10, items: [['iron_sword', 1], ['potato', 1]] }), null, goalOf(), () => {}, {}, { fortress });
  assert(thin.heal_first, 'feeding is possible with food carried under 18');
  assert.match(thin.heal_first.description, /which brings hunger to 11, and then the visit is asked again: health does not come back at hunger 11, under eighteen, so this raises hunger and not health/);
  const none = visit.options(bot({ health: 20, food: 20 }), null, goalOf(), () => {}, {}, { fortress });
  assert.equal(none.heal_first, undefined, 'nothing to change at 20 fed');
});

// Note 643: six live askings at health 20 and hunger 17 said "health does not
// come back at hunger 20, under eighteen": eating to 20 was the very thing that
// makes it come back, and Jev took the wait 0.72 to 0.86 on a sentence that
// was false on its face.
test('at full health with hunger under 18 and food that reaches 18, heal_first says health is full and hunger is what it raises, not that health does not come back', () => {
  const tree = visit.options(bot({ health: 20, food: 17, items: [['iron_sword', 1], ['cooked_mutton', 3]] }), null, goalOf(), () => {}, {}, { fortress });
  assert(tree.heal_first);
  assert.match(tree.heal_first.description, /which brings hunger to 20, and then the visit is asked again: health is full, so this raises hunger to 20, where health comes back after a hit, and heals nothing now/);
  assert.doesNotMatch(tree.heal_first.description, /health does not come back at hunger 20/);
});

test('the state says whether health can come back at this hunger and which row the bot is in', () => {
  const { state } = visit.facts(bot({ health: 5, food: 14 }), goalOf(), { fortress });
  assert.match(state.healthComesBack, /^no: at hunger 14 with nothing to eat, under eighteen, none of it comes back$/);
  assert.match(state.visit, /about to approach a Nether fortress 40 blocks off/);
  assert.match(state.playedRecord, /the row is under 8 health: 26 fights, 58% died, none brought a rod/);
  assert.match(state.aboutTheRecord, /One day's record .*counted separately: there is no row for both/);
  const ok = visit.facts(bot({ health: 12, food: 18, items: [['cooked_beef', 2]] }), goalOf(), {}).state;
  assert.match(ok.healthComesBack, /^yes: at hunger 18, about \d+(\.\d)? seconds to full$/);
});

test('every option the visit offers is one fortress_visit declares, and its outage default is to go in', () => {
  const spec = question('fortress_visit');
  assert.equal(spec.parent, 'rung_progress');
  const b = bot({ health: 5, food: 14, hoglin: true });
  const tree = visit.options(b, null, goalOf(), () => {}, { navigate: async () => {}, returnOverworld: async () => {} }, { fortress, leave: () => {} });
  for (const k of [...Object.keys(tree), 'heal_first']) assert(spec.options.some(o => o.key === k), k);
  assert.equal(spec.fallback({ go_in: {}, leave_fortress: {} }), 'go_in');
});

// ---- asked once and held ----------------------------------------------------
function jev(picks) {
  const asked = [];
  return { asked, systemOne: async ({ questions }) => { const o = questions.branch_0.criteria; asked.push(o); return { answers: { branch_0: { choice: picks.shift() || 'go_in', confidence: 0.9 } } }; } };
}
const task = { check() {} };

test('the answer is held: not asked again until hunger falls two points, a death, or the time is out', async () => {
  const b = bot({ health: 20, food: 20 }), goal = goalOf(), client = jev(['go_in', 'go_in']);
  const ask = (now, ctx = { fortress, leave: () => {} }) => visit.ask(b, task, goal, () => {}, { client, navigate: async () => {} }, ctx, now);
  const t0 = Date.now();
  assert.equal(await ask(t0), 'go_in'); assert.equal(client.asked.length, 1);
  assert.equal(await ask(t0 + 30000), 'go_in'); assert.equal(client.asked.length, 1, 'held');
  b.food = 19; assert.equal(await ask(t0 + 31000), 'go_in'); assert.equal(client.asked.length, 1, 'one point of hunger is not a change');
  b.food = 18; await ask(t0 + 32000); assert.equal(client.asked.length, 2, 'two points down: asked again');
  // The held answer as read: standing, then not after a death, and not after its five minutes (whether the
  // question is then asked or the ledger's rests answer it is the ledger's: tried.js).
  const fresh = Date.now();
  assert(visit.stands(b, goal, fresh + 1000), 'standing');
  goal.survival.deaths.push({ at: new Date().toISOString() });
  assert.equal(visit.stands(b, goal, fresh + 1000), null, 'a death ends it');
  goal.survival.deaths.pop();
  assert.equal(visit.stands(b, goal, fresh + visit.HOLD_MS.go_in + 1000), null, 'five minutes end it');
  b.food = 16; assert.equal(visit.stands(b, goal, fresh + 1000), null, 'two more points of hunger end it');
  // Hurt six in a fight with a blaze in sight is the stance\'s, not this question\'s.
});

test('a wait chosen eats what is carried, ends with the health full and goes on as chosen without asking again', async () => {
  const b = bot({ health: 12, food: 18, items: [['iron_sword', 1], ['cooked_beef', 1]] }), goal = goalOf(), client = jev(['heal_first']);
  b.equip = async () => {};
  b.consume = async () => { b.food = 20; b.stock[1].count = 0; b.stock.splice(1, 1); };
  const actions = { client, navigate: async () => {} };
  const first = await visit.ask(b, task, goal, () => {}, actions, { fortress, leave: () => {} });
  assert.equal(first, 'acted', 'it ate and waits');
  assert.equal(b.food, 20);
  assert.equal(goal.fortressVisit.pick, 'heal_first');
  assert.equal(goal.step.action, 'recover_before_visit');
  b.health = 20;
  assert.equal(await visit.ask(b, task, goal, () => {}, actions, { fortress, leave: () => {} }), 'go_in', 'health full: the visit goes on');
  assert.equal(client.asked.length, 1, 'no second asking');
  assert.equal(goal.fortressVisit.pick, 'go_in'); assert.equal(goal.fortressVisit.after, 'waited');
});

test('a mob in sight ends the wait; leaving the fortress shuns it for ten minutes and the caller is told it acted', async () => {
  const b = bot({ health: 12, food: 20 }), goal = goalOf(), client = jev(['heal_first']);
  const actions = { client, navigate: async () => {} };
  b.entities = {};
  await visit.ask(b, task, goal, () => {}, actions, { fortress, leave: () => {} });
  b.entities = { 7: { id: 7, name: 'zombie', type: 'hostile', position: new Vec3(6.5, 64, 0.5), height: 1.95, width: 0.6, isValid: true, metadata: {} } };
  const r = await visit.ask(b, task, goal, () => {}, actions, { fortress, leave: () => {} });
  assert.equal(r, 'go_in', 'the wait ended, the visit goes on');
  assert.equal(goal.fortressVisit.after, 'mobs came');
  const goal2 = goalOf(), client2 = jev(['leave_fortress']);
  let left = 0;
  const res = await visit.ask(bot(), task, goal2, () => {}, { client: client2, navigate: async () => {} }, { fortress, leave: () => { left++; } });
  assert.equal(res, 'acted'); assert.equal(left, 1);
});

test('with Jev unreachable (no client) the visit is not asked and goes on: the code default is to go in', async () => {
  assert.equal(await visit.ask(bot(), task, goalOf(), () => {}, {}, { fortress }), 'go_in');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival, claim } = require('../src/survival');
const { claimSays } = require('../src/arbiter');

// mid-242-ac-nether-2-fortress-3 (25585, note 584): dug down against a ghast
// in sight 25 blocks off at 04:44:59, the ghast gone within a minute, and
// sealed in the corridor's floor for eleven minutes and more with a crossbow
// piglin heard 13 blocks off through the rock the whole time, never nearer,
// never in sight; stay answered every time, told nothing of the wait.
function netherPocket({ piglinAt = new Vec3(13.5, 30, 0.5), mob = 'piglin' } = {}) {
  const origin = new Vec3(0, 30, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const ghast = { id: 9, name: 'ghast', type: 'hostile', position: new Vec3(0.5, 40, 25.5), height: 4, width: 4, isValid: true };
  const piglin = { id: 7, name: mob, type: 'hostile', position: piglinAt, height: 1.95, width: 0.6, isValid: true, heldItem: mob === 'piglin' ? { name: 'crossbow' } : null };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 7: piglin, 9: ghast }, health: 20, food: 18,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 6000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 43 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : 'netherrack', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  return { bot, origin, ghast, piglin };
}

async function askAt(survival, goal, now) {
  const real = Date.now;
  let tree, state;
  survival.decide = async (task, g, save, { id, tree: t, state: s }) => { if (id === 'pocket_next') { tree = t; state = s; } return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  Date.now = () => now;
  try { await survival.step(new Task('wait'), goal, () => {}); } finally { Date.now = real; }
  delete survival.state.pocketPlan;
  return { tree, state };
}

test('a pocket in the Nether says how the wait has gone: its minutes, the ghast it was sealed against gone, a piglin heard five minutes never nearer and never in sight, no daylight, full health, the rung idle (note 584)', async () => {
  const { bot, origin } = netherPocket();
  const t0 = 1_800_000_000_000;
  const goal = { kind: 'win', request: 'beat the game', rungTime: { phase: 'obtain_blaze_rods' },
    tried: { entries: [], escalations: [], rung: { rung: 'obtain_blaze_rods', since: t0 - 3600000, bestAt: t0 - 45 * 60000, lastBest: 'nearer the blazes (20 blocks)' } } };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'the_nether' }],
    // The stance that dug the pocket, chosen against the ghast in sight.
    stance: { choice: 'dig_down', kinds: ['ghast'], ids: [9], mobs: [{ name: 'ghast', distance: 24.7, visible: true }], at: t0 - 5000, health: 20 } }, client: { systemOne: async () => ({}) } });
  await askAt(survival, goal, t0);
  // The ghast drifts off; the piglin stays where it is.
  delete bot.entities[9];
  for (let s = 20; s < 300; s += 20) await askAt(survival, goal, t0 + s * 1000);
  const { tree, state } = await askAt(survival, goal, t0 + 5 * 60000);
  const stay = tree.stay.description, leave = tree.leave.description;
  assert.match(stay, /In this pocket 5 minutes so far\./);
  assert.match(stay, /It was sealed when dig down was chosen against a ghast in sight 25 blocks off; that ghast is not about now\./);
  assert.match(stay, /Of the mobs outside: the piglin 13 blocks off, about for 5 minutes of the wait, 13 blocks off all that time, never nearer\. None of them has come nearer or had the bot in sight while it waited\./);
  assert.match(stay, /No daylight comes here: nothing outside burns off or goes away with the hour, so a stay here ends only when the bot opens the pocket\./);
  assert.match(stay, /Health is full: staying heals nothing\./);
  assert.match(stay, /The obtain blaze rods has had no new best for 50 minutes \(the last: nearer the blazes \(20 blocks\)\)\./);
  assert.match(leave, /The pocket was sealed when dig down was chosen against a ghast in sight 25 blocks off; that ghast is not about now\./);
  assert.match(leave, /Should they all come at the bot at once, fighting them is estimated at about/);
  assert.doesNotMatch(leave, /Out among them, fighting them all/);
  assert.equal(state.pocketSoFar.minutes, 5);
  assert.match(state.pocketSoFar.sealedAgainst, /ghast in sight 25 blocks off \(dig down\); that ghast is not about now/);
  // The turn's own question says it too.
  const real = Date.now; Date.now = () => t0 + 5 * 60000;
  let c; try { c = claim(bot, { ...goal, survival: survival.state }, survival); } finally { Date.now = real; }
  assert.equal(c.action, 'pocket_next');
  assert.match(claimSays(c), /^In a sealed pocket, 5 minutes so far, sealed against a ghast in sight 25 blocks off \(dig down\); that ghast is not about now: whether to stay/);
});

test('a mob that has come nearer through the wait is said so, and leaving is priced among them as before', async () => {
  const { bot, origin, piglin } = netherPocket({ mob: 'zombie', piglinAt: new Vec3(15.5, 30, 0.5) });
  delete bot.entities[9];
  const t0 = 1_800_000_000_000;
  const goal = { kind: 'win', request: 'beat the game' };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'the_nether' }] }, client: { systemOne: async () => ({}) } });
  await askAt(survival, goal, t0);
  for (let s = 20; s <= 120; s += 20) { piglin.position = new Vec3(15.5 - 8 * s / 120, 30, 0.5); await askAt(survival, goal, t0 + s * 1000); }
  const { tree } = await askAt(survival, goal, t0 + 120000);
  assert.match(tree.stay.description, /In this pocket 2 minutes so far\./);
  assert.match(tree.stay.description, /Of the mobs outside: the zombie 7 blocks off, about for 2 minutes of the wait, come from 15 to 7 blocks off\./);
  assert.doesNotMatch(tree.stay.description, /It was sealed when/, 'no stance sealed it: nothing said of one');
  assert.match(tree.leave.description, /Out among them, fighting them all is estimated/);
  assert.doesNotMatch(tree.leave.description, /Should they all come/);
});

test('in the Overworld at night the stay says its minutes and not the Nether\'s lack of day', async () => {
  const { bot, origin } = netherPocket();
  bot.game.dimension = 'overworld'; bot.time.timeOfDay = 16000; bot.entities = {};
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld' }] }, client: { systemOne: async () => ({}) } });
  const t0 = 1_800_000_000_000;
  await askAt(survival, { kind: 'win' }, t0);
  await askAt(survival, { kind: 'win' }, t0 + 30000); await askAt(survival, { kind: 'win' }, t0 + 60000);
  const { tree } = await askAt(survival, { kind: 'win' }, t0 + 90000);
  assert.match(tree.stay.description, /In this pocket 1\.5 minutes so far\./);
  assert.doesNotMatch(tree.stay.description, /No daylight comes here|staying heals nothing/);
});

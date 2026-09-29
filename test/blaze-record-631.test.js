'use strict';
// Note 631: the day's blaze deaths (2026-09-28, 70 by a blaze or its fire, 289 in all) read from the flight
// records. A fireball that lands costs its hit and four ticks of fire (168 landings that burned out: 112 took
// four); 48 of the 63 deaths with a landing in their last fifteen seconds took it at 6.5 health or less, where
// one landing is the end, and the questions said "at 3 health, 2 fireballs (2.5 each) end it". The record of the
// bot's fights by the health and hunger they began at is said on the hunt's and the stance's questions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const ce = require('../src/combat-estimate');
const record = require('../src/blaze-record');
const script = require('../scripts/blaze-record');

test('a landing costs its hit and four ticks of fire, and the landings that end the bot are counted with it', () => {
  assert.equal(ce.FIRE_TICKS.fireball, 4);
  assert.equal(ce.landingCost(2.5), 6.5, 'through full iron');
  // 6.5 health: one landing (2.5 and four ticks) takes it to nothing.
  assert.equal(ce.landingsToEnd(3, 2.5), 1);
  assert.equal(ce.landingsToEnd(6.5, 2.5), 1);
  assert.equal(ce.landingsToEnd(7, 2.5), 2, 'one landing is 6.5, and leaves half a point');
  assert.equal(ce.landingsToEnd(12, 2.5), 4, 'in one volley: 3 are 11.5 with the one fire, 4 are 14');
  assert.equal(ce.landingsToEnd(20, 3.9), 5);
  // Already alight with 4 ticks to come: the new landing sets the fire back to five seconds (4 ticks), adding
  // none of its own; the burning that is left counts first.
  assert.equal(ce.landingCost(2.5, 4), 2.5);
  assert.equal(ce.landingCost(2.5, 2), 4.5);
  assert.equal(ce.landingsToEnd(5, 2.5, 4), 1);
  assert.equal(ce.landingsToEnd(3, 2.5, 4), 0, 'the fire on it alone is the health it has');
  assert.equal(ce.landingsToEnd(10, 0), null, 'no hit, no count');
  // From separate volleys each fire burns out before the next: each landing is 6.5 whole, so fewer of them.
  assert.equal(ce.landingsApart(3, 2.5), 1);
  assert.equal(ce.landingsApart(6.5, 2.5), 1);
  assert.equal(ce.landingsApart(7, 2.5), 2);
  assert.equal(ce.landingsApart(12, 2.5), 2);
  assert.equal(ce.landingsApart(15.6, 2.5), 3, 'the approach was told 3 at 15.6 by a landing of 7.5; 6.5 leaves it at 3');
  assert.equal(ce.landingsApart(20, 2.5), 4);
  assert.equal(ce.landingsApart(3, 2.5, 4), 0);
  assert.equal(ce.landingsApart(9, 2.5, 4), 2, 'four ticks to come and the landing\'s 2.5 is 6.5 of the 9: a second landing is needed');
  assert.equal(ce.landingsApart(6.5, 2.5, 4), 1, 'four ticks and 2.5 is the 6.5 it has');
});

// The scene of note 617: two blazes on a fortress floor, the bot in full iron with a shield.
const world = p => {
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z), position = new Vec3(x, y, z);
  if (y === 54 && x >= -218 && x <= -196 && z >= -162 && z <= -146) return { position, name: 'nether_bricks', boundingBox: 'block' };
  return y <= 31 ? { position, name: 'lava', boundingBox: 'empty' } : { position, name: 'air', boundingBox: 'empty' };
};
const blaze = (id, x, y, z) => ({ id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } });
function sceneBot(health, { alight = false, food = 19 } = {}) {
  const entities = { 342: blaze(342, -203.41, 58.97, -153.03), 343: blaze(343, -204.53, 57, -151.69) };
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 77 }, { name: 'beef', count: 5 }];
  return Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food, oxygenLevel: 20,
    entity: { position: new Vec3(-217.5, 55, -155.42), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), metadata: [alight ? 1 : 0] }, entities, time: { timeOfDay: 0 },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } },
    world: { raycast: () => null }, blockAt: world, registry: require('minecraft-data')('26.1'),
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => {}, findBlocks: () => [] });
}
const threat = (bot, entity) => ({ entity, distance: entity.position.distanceTo(bot.entity.position), visible: true });
const stance = (health, opts) => {
  const bot = sceneBot(health, opts);
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  return survival.stanceOptions(new Task('x'), {}, () => {}, Object.values(bot.entities).map(e => threat(bot, e)), false);
};

test('at 3 health one fireball that lands ends the bot, said with its fire; at 12 two from separate volleys do, or four within one (the stance said "2 fireballs, 2.5 each" at 3)', () => {
  const low = stance(3);
  assert.match(low.fight.description, /At 3 health, 1 fireball from the blaze that lands ends it: it is about 2\.5 after armour and sets the bot alight for 5 seconds, about 4 more health from the fire \(6\.5 for one landing\)\./);
  assert.doesNotMatch(low.fight.description, /2 fireballs/);
  assert.match(stance(6.5).close_in.description, /At 6\.5 health, 1 fireball from the blaze that lands ends it/);
  assert.match(stance(7).fight.description, /At 7 health, 2 fireballs from the blaze that land end it \(each is about 2\.5 after armour and sets the bot alight for 5 seconds, about 4 more health from the fire: 6\.5 for one landing\)\./);
  assert.match(stance(12).fight.description, /At 12 health, 2 fireballs from the blaze that land from separate volleys end it \(each is about 2\.5 after armour and sets the bot alight for 5 seconds, about 4 more health from the fire: 6\.5 for one landing\), or 4 in one volley, whose fire is one fire\./);
  // Not said at 14 or more, as the hits were not.
  assert.doesNotMatch(stance(20).fight.description, /that land end it|lands ends it|separate volleys/);
});

test('alight, the fire on the bot counts first: the burning alone can be the health it has', () => {
  const bot = sceneBot(3, { alight: true });
  bot._alightUntil = Date.now() + 4000;
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, Object.values(bot.entities).map(e => threat(bot, e)), false);
  assert.match(options.fight.description, /At 3 health the burning alone ends the bot; a fireball that lands only hurries it \(about 2\.5 after armour\)\./);
});

test('a price that leaves less than one landing is said as a coin toss over a landing of its hit and its fire, not the hit alone', () => {
  const said = Object.values(stance(6.5)).map(o => o.description).join(' ');
  assert.match(said, /That leaves [\d.]+ health, less than the 6\.5 of one fireball that lands \(its hit and its fire\): one blow more than the figure counts, or one landing sooner than it does, ends the bot\./);
});

test('the record of the bot\'s fights is said with the row it is in: its health, its hunger, the blazes about', () => {
  const hurt = record.says({ health: 3, food: 16, entity: { position: new Vec3(0, 60, 0) }, entities: {} });
  assert.match(hurt, /^In the trials of 2026-09-28, 415 fights with blazes \(a run of blazes in sight, or hurting the bot, ending after thirty seconds without\): 19% ended in the bot's death and 10% in a blaze rod \(54 rods, 79 deaths\)\./);
  assert.match(hurt, /Begun at the health this bot has, 3, the row is under 8 health: 26 fights, 58% died, none brought a rod;/);
  assert.match(hurt, /over 16 health 14% died and 12% brought a rod, 8 to 16 24% and 6%, under 8 58% and none/);
  assert.match(hurt, /With hunger under 18, as here \(16\), where health does not come back: 160 fights, 24% died and 6% brought a rod, against 16% and 13% at 18 or more\./);
  assert.match(hurt, /Iron armour made no difference: four pieces 18% died, two or three 20%\./);
  assert.match(hurt, /of the 63 with a fireball landing in their last fifteen seconds, 48 took it at 6\.5 health or less/);
  const fit = record.says({ health: 20, food: 20, entity: { position: new Vec3(0, 60, 0) }, entities: {} });
  assert.match(fit, /the row is over 16 health: 307 fights, 14% died, 12% brought a rod;/);
  assert.doesNotMatch(fit, /With hunger under 18/);
  // Three or more blazes within sixteen: the spawner's row, and how many are about.
  const near = record.says({ health: 12, food: 20, entity: { position: new Vec3(0, 60, 0) }, entities: Object.fromEntries([1, 2, 3].map(i => [i, { name: 'blaze', position: new Vec3(i * 3, 60, 0), isValid: true }])) });
  assert.match(near, /the row is 8 to 16 health: 82 fights, 24% died, 6% brought a rod;/);
  assert.match(near, /with three or more within sixteen blocks \(a spawner's\) 198 fights, 21% died and 9% brought a rod; with one or none 141 fights, 13% and 11%; 3 are within sixteen now\./);
});

test('the stance\'s state carries the record when a blaze is among the threats', async () => {
  const run = async health => {
    const bot = sceneBot(health, { food: 16 });
    const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
    let state = null;
    survival.decide = async (task, goal, save, q) => { state = q.state; return { path: ['take_cover'] }; };
    survival.stanceStep(new Task('x'), {}, () => {}, Object.values(bot.entities).map(e => threat(bot, e)), false).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 200));
    return state;
  };
  const state = await run(5);
  assert(state, 'the stance was asked');
  assert.match(state.playedRecord, /the row is under 8 health: 26 fights, 58% died, none brought a rod/);
  assert.match(state.playedRecord, /With hunger under 18, as here \(16\)/);
});

// The stance's state carries it when a blaze is about (survival.js stanceStep), the hunt's the same sentence
// (mob-hunt.test.js); both questions say in their instructions what it is.
test('the two blaze questions say in their instructions what playedRecord is', () => {
  const { question } = require('../src/decisions');
  assert.match(question('encounter_stance').instructions.guidance, /With blazes about, playedRecord is what the bot's own fights with blazes came to in the trials/);
  assert.match(question('encounter_stance').instructions.guidance, /one landing is the end/);
  assert.match(question('hunt_target').instructions.guidance, /On a blaze hunt playedRecord is what the bot's own fights with blazes came to in the trials/);
  assert.match(question('hunt_target').instructions.guidance, /priced with the blazes it puts in over the fight's own seconds/);
});

// ------------------------------------------------------------ scripts/blaze-record.js on frames

const T0 = Date.parse('2026-09-28T10:00:00Z');
const frame = (s, kind, snapshot, detail) => ({ at: T0 + s * 1000, kind, snapshot: { dimension: 'the_nether', ...snapshot }, detail });
const mobs = (...ds) => ds.map(([d, seen = true]) => ({ name: 'blaze', d, seen }));

test('a fight is a run of blazes in sight within 24 blocks, or a fireball that lands, a gap of 30 seconds ending it; it dies, brings a rod or neither', () => {
  const frames = [
    frame(0, 'observation', { health: 5, food: 15, inventory: { blaze_rod: 0 }, equipment: { head: 'iron_helmet', torso: 'iron_chestplate', legs: null, feet: null } }),
    frame(2, 'decision', { health: 5, food: 15, mobs: mobs([10], [12], [14, false], [40]) }),
    frame(6, 'damage', { health: 5, mobs: mobs([10]) }, { type: 'fireball', cause: 'blaze' }),
    frame(7, 'vitals', { health: 2.5 }),
    frame(9, 'vitals', { health: 0 }),
    // After the death: a new connection's frames, health 20; a fight with a rod, and a lone blaze.
    frame(100, 'observation', { health: 20, food: 20, inventory: { blaze_rod: 0 }, equipment: { head: 'iron_helmet', torso: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' } }),
    frame(101, 'decision', { health: 20, food: 20, mobs: mobs([6]) }),
    frame(110, 'observation', { health: 18, food: 20, inventory: { blaze_rod: 1 } }),
    frame(112, 'decision', { health: 18, food: 20, mobs: mobs([8]) }),
    // More than 30 seconds on: another fight, nothing came of it.
    frame(160, 'decision', { health: 18, food: 20, mobs: mobs([9]) }),
    frame(170, 'decision', { health: 18, food: 20, mobs: mobs([9]) }),
    // Too short to count (under three seconds), and a blaze out of sight is no fight.
    frame(300, 'decision', { health: 18, food: 20, mobs: mobs([9]) }),
    frame(400, 'decision', { health: 18, food: 20, mobs: mobs([9, false], [30]) }),
  ];
  const list = script.fights(frames);
  assert.equal(list.length, 3);
  const [dead, rod, none] = list;
  assert.equal(dead.died, true); assert.equal(dead.hp0, 5); assert.equal(dead.hunger0, 15); assert.equal(dead.max16, 3);
  assert.equal(dead.iron, 2); assert.equal(dead.landings, 1);
  assert.equal(rod.died, false); assert.equal(rod.rodsGain, 1); assert.equal(rod.hp0, 20); assert.equal(rod.max16, 1);
  assert.equal(none.died, false); assert.equal(none.rodsGain, 0);
  const t = script.tables(list);
  assert.deepEqual(t.health['under 8'], { fights: 1, died: 1, diedPct: 100, rodFights: 0, rodPct: 0, rods: 0 });
  assert.equal(t.health['over 16'].fights, 2, 'the fight with the rod began at 20, the last at 18');
  assert.equal(t.hunger['under 18'].fights, 1);
  assert.equal(t.blazes['three or more'].fights, 1);
  assert.equal(t.all.fights, 3);
});

test('a landing that burns out costs the ticks of fire after it; one relit or burned after another is not counted', () => {
  const at = (s, type, health, cause = null) => frame(s, 'damage', { health }, { type, cause });
  const after = (s, health) => frame(s, 'vitals', { health });
  const frames = [
    at(0, 'fireball', 20, 'blaze'), after(0.05, 17.5),
    at(1, 'on_fire', 17.5), after(1.05, 16.5), at(2, 'on_fire', 16.5), after(2.05, 15.5), at(3, 'on_fire', 15.5), after(3.05, 14.5), at(4, 'on_fire', 14.5), after(4.05, 13.5),
    // The next landing, twenty seconds on, burned twice and then relit by a landing.
    at(24, 'fireball', 13.5, 'blaze'), after(24.05, 11), at(25, 'on_fire', 11), after(25.05, 10), at(26, 'on_fire', 10), after(26.05, 9), at(26.5, 'fireball', 9, 'blaze'), after(26.55, 6.5),
  ];
  const l = script.landings(frames);
  assert.equal(l.length, 3);
  assert.deepEqual([l[0].hit, l[0].ticks, l[0].ended, l[0].isolated], [2.5, 4, 'gap', true]);
  assert.deepEqual([l[1].ticks, l[1].ended, l[1].isolated], [2, 'relit', true]);
  assert.equal(l[2].isolated, false, 'alight from the one before');
});

test('a death by a blaze is read from the game\'s own line, its last minute\'s damage and the health before its last landing', () => {
  const at = (s, type, health, cause = null) => frame(s, 'damage', { health, mobs: mobs([9]) }, { type, cause });
  const after = (s, health) => frame(s, 'vitals', { health });
  const frames = [
    frame(-1, 'decision', { health: 20, mobs: mobs([9]) }),
    at(10, 'fireball', 20, 'blaze'), after(10.05, 17.5),
    at(11, 'on_fire', 17.5), after(11.05, 16.5),
    at(40, 'fireball', 6.5, 'blaze'), after(40.05, 4),
    at(41, 'on_fire', 4), after(41.05, 3), at(42, 'on_fire', 3), after(42.05, 2), at(43, 'on_fire', 2), after(43.05, 1), at(44, 'on_fire', 1), after(44.05, 0),
    frame(60, 'decision', { health: 20, dimension: 'overworld', decision: { state: { recentDeaths: [{ minutesAgo: 0, cause: 'was burned to a crisp while fighting Blaze' }] } } }),
  ];
  const [d] = script.deaths(frames);
  assert.equal(d.blaze, true);
  assert.equal(d.msg, 'was burned to a crisp while fighting Blaze');
  assert.equal(d.lastLandingHealth, 6.5);
  assert.equal(d.sums.fireball, 5);
  assert.equal(d.sums.on_fire, 5);
  assert.equal(d.lastLandingSecondsBefore, 4.1);
});

// Note 645: what followed each kind of answer in the played fights, in the bot's situation (blaze-record.js
// answersSay, optionSays), on the state and on each option of that kind; only where five fights are in the row.
test('each option of a kind ends with what followed answers of that kind in a situation like this one, with its count', () => {
  const rows = record.ANSWERS['none|2-3|>16'];
  const options = stance(20);
  const said = (kind, k) => new RegExp(`In the fights of 2026-09-28 after an answer of this kind \\(${kind}\\) in a situation like this \\(no spawner within 16, two or three blazes within 16\\): ${rows[k][0]} fights, ${rows[k][1]} took a rod after it \\(${Math.round(100 * rows[k][1] / rows[k][0])}%\\), ${rows[k][2]} died after it \\(${Math.round(100 * rows[k][2] / rows[k][0])}%\\)\\.`);
  assert.match(options.close_in.description, said('a strike', 'strike'));
  assert.match(options.take_cover.description, said('cover', 'cover'));
  assert.match(options.retreat.description, said('a retreat', 'retreat'));
  // A kind with under five fights at this health says the row at any health, and says so.
  assert.match(options.fight.description, /\(a fight from a stand\) in a situation like this \(no spawner within 16, two or three blazes within 16\): 7 fights, 0 took a rod after it \(0%\), 1 died after it \(14%\) \(at any health: the sample is under 5 at over 16 health\)\./);
  // Hurt (5 health) the strike row at this health has under five fights: the row at any health is said, and says so; the cover row is at 5 health.
  const hurt = stance(5);
  assert.match(hurt.close_in.description, /\(a strike\) in a situation like this \(no spawner within 16, two or three blazes within 16\): 18 fights, 10 took a rod after it \(56%\), 3 died after it \(17%\) \(at any health: the sample is under 5 at under 8 health\)\./);
  assert.match(hurt.take_cover.description, /\(cover\) in a situation like this \(no spawner within 16, two or three blazes within 16\): 15 fights, 0 took a rod after it \(0%\), 8 died after it \(53%\)\.$/);
});

test('the stance\'s state carries playedAnswers with the rows for the situation, the rate of no kind under five fights, and how the rods came', async () => {
  const bot = sceneBot(20);
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  let state = null;
  survival.decide = async (task, goal, save, q) => { state = q.state; return { path: ['take_cover'] }; };
  survival.stanceStep(new Task('x'), {}, () => {}, Object.values(bot.entities).map(e => threat(bot, e)), false).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 200));
  assert(state, 'the stance was asked');
  assert.match(state.playedAnswers, /^In this situation \(no spawner within 16, two or three blazes within 16, health 20\), what followed each kind of answer/);
  assert.match(state.playedAnswers, /a strike \(close_in or charge_nearest: walking in on the blazes with the sword\): 11 fights, 5 took a rod after it \(45%\), 2 died after it \(18%\)/);
  assert.match(state.playedAnswers, /How the rods came, of the 61 fights that ended with a rod: 56 had a strike in them/);
  const { question } = require('../src/decisions');
  assert.match(question('encounter_stance').instructions.guidance, /playedAnswers, and the sentence ending an option that has one, say what came after each kind of answer/);
  assert.match(question('hunt_target').instructions.guidance, /playedAnswers, and the sentence ending a stand that has one/);
});

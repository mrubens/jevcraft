'use strict';
// Note 759: the blaze-rod stage, from the first rod to seven carried out.
// Of 80 lives that carried a rod in the Nether (flight records
// 2026-09-29T23:00Z to 2026-09-30T17:00Z, scripts/rod-stage.js), 70 died
// with them and none carried one out. 25588 (mid-242-zh) died at 16:32:49Z
// carrying 5 of 7 among eight blazes, burning at 1.8 health; no question it
// was asked said what the death would take, stash_rods was never on offer
// (a blaze always saw it), and body_way offered only ways ending in their
// line. The scene is 25589's room at the cage (test/fixtures/spawner-lull-
// 25589.json), with a blaze that sees the bot 3 blocks off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const room = require('./fixtures/spawner-lull-25589.json');
const rec = require('./fixtures/spawner-lull-frame-25589.json');
const stage = require('../scripts/rod-stage');
const risk = require('../src/rod-risk');
const vitals = require('../src/vitals');
const { Task } = require('../src/skills');

const CAGE = new Vec3(rec.cage.x, rec.cage.y, rec.cage.z);
const SEER = { id: 9, position: { x: -151.5, y: 81, z: 162.5 } };
function sceneBot({ rods = 5, health = 9, alight = false, seen = true } = {}) {
  const blazes = seen ? [...rec.blazes, SEER] : rec.blazes;
  const bot = groundBot(room, { at: new Vec3(rec.position.x, rec.position.y, rec.position.z), health, food: 20, items: Object.entries({ ...rec.inventory, blaze_rod: rods }).filter(([, n]) => n > 0), worn: ['iron_helmet', 'iron_chestplate'], dimension: 'the_nether', indexed: true,
    mobs: blazes.map(b => ({ id: b.id, name: 'blaze', at: new Vec3(b.position.x, b.position.y, b.position.z), height: 1.8 })) });
  bot.changed.set(`${CAGE.x},${CAGE.y},${CAGE.z}`, 'spawner');
  if (alight) bot.entity.metadata = [1];
  return bot;
}

// Frames as the flight record keeps them, slimmed as the script reads them.
const frame = (at, { hp = 20, dim = 'the_nether', rods, blazes = [], kind = 'observation', decision, detail, food = 20 } = {}) => stage.slim({ at, kind, detail,
  snapshot: { health: hp, food, dimension: dim, ...(rods !== undefined ? { inventory: { blaze_rod: rods, cooked_beef: 3 } } : {}), equipment: { offhand: null },
    mobs: blazes.map(d => ({ name: 'blaze', d, seen: true })), ...(decision ? { decision } : {}) } });

test('rod-stage: a life\'s rods over time, its death read in its last minute and its shape; a restart\'s record joined to the life it goes on', () => {
  const t0 = Date.parse('2026-09-30T16:00:00Z');
  const a = [
    frame(t0, { rods: 0 }), frame(t0 + 60000, { rods: 1, blazes: [5] }), frame(t0 + 120000, { rods: 5, blazes: [4, 5, 6, 7, 8] }),
    frame(t0 + 170000, { hp: 20, rods: 5, blazes: [3, 4, 5, 6, 7], kind: 'decision', decision: { id: 'hunt_target', path: ['defer'], options: { defer: {}, hunt_1: {} } } }),
    frame(t0 + 175000, { hp: 17, kind: 'damage', detail: { type: 'fireball', cause: 'blaze' }, rods: 5, blazes: [4, 5, 6, 7, 8] }),
    frame(t0 + 181000, { hp: 1.8, rods: 5, blazes: [3, 6, 7, 8], kind: 'decision', decision: { id: 'body_way', path: ['burn_out'], options: { burn_out: 'Leave it. Its end is in the line of the blaze: its fire goes on there.', strike_at_arm: 'Strike.' } } }),
    frame(t0 + 182000, { hp: 0, rods: 5 }),
    frame(t0 + 184000, { hp: 20, dim: 'overworld', rods: 0, decision: { id: 'turn_priority', path: ['work'], state: { recentDeaths: [{ minutesAgo: 0, cause: 'was fireballed by Blaze' }] } }, kind: 'decision' }),
  ];
  const lives = stage.lives(a, '127_0_0_1-25588-Jev-2026-09-30T16-00-01-866Z.jsonl');
  assert.equal(lives.length, 1);
  const l = lives[0];
  assert.deepEqual([l.how, l.maxRods, l.rodsAtEnd], ['died', 5, 5]);
  assert.deepEqual(l.rodsOverTime, [[0, 1], [1, 5]]);
  assert.equal(l.death.cause, 'was fireballed by Blaze');
  assert.equal(l.death.rodsLost, 5);
  assert.equal(l.death.secondsFromLast16, 7);
  assert.equal(l.death.blazesWithin16Max, 5);
  assert.equal(stage.shapeOf(l.death), 'burst_at_swarm');
  assert.deepEqual(l.death.decisions.map(q => `${q.id}>${q.choice}`), ['hunt_target>defer', 'body_way>burn_out']);
  // A record that ends with the trial's restart and the next begun with the same rods are one life.
  const b1 = stage.lives([frame(t0, { rods: 0 }), frame(t0 + 1000, { rods: 3 })], '127_0_0_1-25591-Jev-2026-09-30T03-28-19-450Z.jsonl');
  const b2 = stage.lives([frame(t0 + 120000, { rods: 3 }), frame(t0 + 130000, { rods: 7 }), frame(t0 + 140000, { dim: 'overworld', rods: 7 })], '127_0_0_1-25591-Jev-2026-09-30T03-57-06-933Z.jsonl');
  const joined = stage.chain([...b1, ...b2]);
  assert.equal(joined.length, 1);
  assert.deepEqual([joined[0].startRods, joined[0].maxRods, joined[0].how, joined[0].leftWith, joined[0].files.length], [0, 7, 'left the Nether', 7, 2]);
  const r = stage.report(joined);
  assert.deepEqual(r.reaching[7], { lives: 1, died: 0, left: 1, ended: 0, carriedOutWith: [7] });
  // body_way asked with a blaze seeing the bot, by where its ways end.
  const rows = stage.wayRows(a);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].allIn, rows[0].anyOut, rows[0].died30], [true, false, true]);
});

test('rodsAtRisk: carried in the Nether, what a death drops and the record\'s row; nothing with no rod, nor in the Overworld', () => {
  assert.deepEqual(risk.RECORD.reached[5], [13, 13, 0]);
  assert.equal(risk.RECORD.out, 0);
  const r = risk.risk(sceneBot({ rods: 5 }), { kind: 'win' });
  assert.equal(r.carried, 5);
  assert.equal(r.says, '5 rods carried, 7 wanted; 2 still needed. A death here drops the 5 blaze rods where the bot falls (lava burns them, on the ground they vanish five minutes after) and it comes back to life in the Overworld. In the trials of 2026-09-29T23:00Z to 2026-09-30T17:00Z, 13 lives carried 5 or more rods in the Nether: 13 died with them, none carried them out. No chest is carried; the wood carried makes one to keep them in (stash_rods).');
  // What could keep them: 24 of the 34 rod-dropping blaze deaths carried neither a chest nor wood.
  const bare = sceneBot({ rods: 5 }); for (const i of bare.inventory.items()) if (/_log$|crafting_table/.test(i.name)) i.count = 0;
  assert.match(risk.risk(bare, { kind: 'win' }).says, /No chest is carried and no wood to make one \(8 planks, and 4 more for a table\): nothing here keeps them, and every rod carried is lost with a death; the Overworld's trees, past the portal, make one\.$/);
  const boxed = sceneBot({ rods: 5 }); boxed.inventory.items().push({ name: 'chest', count: 1 });
  assert.equal(risk.keepSays(boxed, { kind: 'win' }), 'A chest is carried to keep them in (stash_rods).');
  assert.match(risk.recordSays(2), /55 lives carried 2 or more rods in the Nether: 49 died with them, none carried them out \(6 ended with the trial\)\./);
  assert.equal(risk.risk(sceneBot({ rods: 0 }), { kind: 'win' }), null);
  const over = sceneBot({ rods: 5 }); over.game.dimension = 'overworld';
  assert.equal(risk.risk(over, { kind: 'win' }), null);
});

test('rodsAtRisk goes with every question asked in the Nether while rods are carried, with its guidance line', async () => {
  const decisions = require('../src/decisions');
  const said = [], asked = [];
  const client = { systemOne: async ({ state, questions }) => { said.push(state); asked.push(questions); return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.9 } } }; } };
  const bot = sceneBot({ rods: 5, health: 20, seen: false });
  await decisions.decide('upkeep', { client, bot, task: new Task('work'), goal: { kind: 'win' }, save: () => {}, tree: { fetch_stems: { description: 'Fetch stems.' }, carry_on: { description: 'Carry on.' } }, state: { health: 20 } });
  assert.match(said[0].rodsAtRisk, /^5 rods carried, 7 wanted; 2 still needed\. A death here drops the 5 blaze rods/);
  assert.match(JSON.stringify(asked[0]), /rodsAtRisk is the blaze rods carried and what a death now does to them/);
  said.length = 0;
  await decisions.decide('upkeep', { client, bot: sceneBot({ rods: 0, health: 20, seen: false }), task: new Task('work'), goal: { kind: 'win' }, save: () => {}, tree: { fetch_stems: { description: 'Fetch stems.' }, carry_on: { description: 'Carry on.' } }, state: { health: 20 } });
  assert.equal(said[0].rodsAtRisk, undefined);
});

test('body_way alight with a blaze seeing the bot: a way to the nearest cell out of its line, walked as the run out of fire is', async () => {
  const bot = sceneBot({ alight: true });
  const ways = vitals.fireWays(bot, { check() {} });
  assert.ok(ways.out_of_their_line, Object.keys(ways).join(', '));
  assert.match(ways.out_of_their_line.description, /Walk \d+ blocks? to \(-?\d+, \d+, -?\d+\), a cell the blaze in sight has no line to from where it is now \(rock stands between\): about [\d.]+ seconds, in their line until there\. The fire on the body burns on \(about 1 second of it, about 1 health\); there no fireball lands/);
  const at = ways.out_of_their_line.description.match(/to \((-?\d+), (\d+), (-?\d+)\)/).slice(1).map(Number);
  const seer = Object.values(bot.entities).find(e => e.id === 9);
  assert.deepEqual(require('../src/bunker').seenFrom(bot, [seer], new Vec3(...at)), [], 'no line from the blaze there');
  // The blaze is at arm's length and the burn out's seconds take more than the bot has: the strike, which they do not, is first (note 1018).
  assert.equal(Object.keys(ways)[0], 'strike_at_arm');
  assert.match(ways.burn_out.description, /^Over the next \d+ seconds this way, if nothing turns to the blaze: .*more than the bot has\. /);
  // No shooter seeing the bot: not offered.
  assert.equal(vitals.fireWays(sceneBot({ alight: true, seen: false }), { check() {} }).out_of_their_line, undefined);
});

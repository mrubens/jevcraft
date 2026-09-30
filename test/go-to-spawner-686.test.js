'use strict';
// Note 686: a blaze spawner the fortress map holds is a way of its own in
// fortress_leg. mid-242-dc-fortress-22 (25589) fought blazes at the cage at
// (-108, 77, 155), took three rods within sixteen of it, and later walked
// its fortress's floors again and again at full health, back_to_fortress
// chosen at 0.78 each time, then "Walked what I can reach", then the legs
// again: the spawner was said only in fortressInView.map. The frame and the
// spawner's record are the trial's own (test/fixtures/go-to-spawner-25589.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const { chooseLeg, findFortressStep } = require('../src/mob-hunt');
const { question } = require('../src/decisions');
require('../src/decisions/travel');

const rec = require('./fixtures/go-to-spawner-25589.json');
const CAGE = { x: rec.spawner.x, y: rec.spawner.y, z: rec.spawner.z };
// The option's key is the number the spawner was given when first offered (note 749).
const GO = 'go_to_spawner_1';

// The frame's ground as far as the question reads it: the fortress floor at
// y 57 under the bot, open air above, the cage where the map has it.
function frameBot({ broken = false } = {}) {
  const at = rec.frame.position;
  const block = p => p.x === CAGE.x && p.y === CAGE.y && p.z === CAGE.z ? (broken ? null : 'spawner') : p.y <= 57 ? 'nether_bricks' : null;
  const items = Object.entries(rec.frame.inventory).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 }));
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: rec.frame.health, food: rec.frame.food,
    entity: { position: new Vec3(at.x, at.y, at.z), onGround: true }, entities: {}, world: { raycast: () => null },
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], chat() {},
    blockAt: p => { const name = block(p); return { name: name || 'air', boundingBox: name ? 'block' : 'empty', diggable: true, position: p, digTime: () => 400 }; } };
  return bot;
}
function frameGoal() {
  const now = Date.now(), min = m => now - m * 60000;
  const s = rec.spawner;
  return { kind: 'win', mobHunt: { item: 'blaze_rod', entity: 'blaze', sightings: rec.sightings.map(({ minutesAgo, ...x }) => ({ ...x, at: min(minutesAgo) })) },
    fortressSearch: { legs: rec.fortress.legs, found: rec.fortress.found,
      map: { cells: {}, failed: {}, chests: [], spawners: [{ x: s.x, y: s.y, z: s.z, seenAt: min(s.seenMinutesAgo), lastThereAt: min(s.lastThereMinutesAgo), secondsThere: s.secondsThere, kills: s.kills, rods: s.rods }] } } };
}
function jev(pick) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: pick, confidence: 0.9 } } }; } };
}

test('the recorded frame: the spawner the map holds is offered as go_to_spawner, said with what the bot\'s time at it came to, and its cage is the answer\'s target', async () => {
  const bot = frameBot(), goal = frameGoal(), state = goal.fortressSearch;
  const client = jev(GO);
  const picked = await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, tunnel: async () => {} }, state);
  assert.equal(picked, 'goto');
  const { options } = client.asked[0];
  assert.match(options[GO], /^Go to the blaze spawner at \(-108, 77, 155\), \d+ blocks off and 19 up, seen 65 minutes ago: blazes seen near it 27 times; 3 blazes killed and 3 rods taken in about 5 minutes within 16 of it, last there 62 minutes ago\. No floor seen joins it to here\./);
  assert.match(options[GO], /There, with no blaze near, the stand is asked \(empty_spawner\)\./);
  assert.ok(options.go_to_blazes, 'the sightings stay a way of their own');
  // Chosen: the walk to it is the search's wait by a spawner, as a walk.
  assert.deepEqual({ x: state.spawnerWait.x, y: state.spawnerWait.y, z: state.spawnerWait.z, go: state.spawnerWait.go }, { ...CAGE, go: true });
  // The option's target is the cage: the ledger's answer and the rung's measure read it.
  const tree = { [GO]: { description: options[GO], target: CAGE } };
  const parts = require('../src/rung-measure').parts(bot, goal, { rung: 'obtain_blaze_rods', target: tree[GO].target });
  assert.ok(Object.keys(parts).some(k => /^cage@/.test(k)), JSON.stringify(Object.keys(parts)));
  assert.ok(Object.keys(parts).some(k => /^step:/.test(k)));
});

test('taken, the walk is on foot with the cage as the step\'s target; there, it ends and the stand is the next question\'s', async () => {
  const bot = frameBot(), goal = frameGoal(), state = goal.fortressSearch;
  state.spawnerWait = { ...CAGE, until: Date.now() + 300000, startedAt: Date.now(), go: true };
  const walks = [];
  const navigate = async (b, t, g, o = {}) => { walks.push({ x: g.x, y: g.y, z: g.z, onFoot: !!o.onFoot }); bot.entity.position = new Vec3(CAGE.x + 3.5, CAGE.y, CAGE.z + 0.5); };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { navigate, tunnel: async () => {} });
  assert.equal(walks.length, 1); assert.ok(walks[0].onFoot);
  assert.equal(goal.step.action, 'go_to_spawner');
  assert.deepEqual(goal.step.target, CAGE);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { navigate, tunnel: async () => {} });
  assert.equal(state.spawnerWait, undefined, 'the walk ends there');
  assert.match(state.spawnerWaitEnded, /^reached it, \d blocks from the cage$/);
  assert.equal(state.goToEnded['spawner:-108,77,155'].why, 'reached it');
  assert.equal(goal.step.action, 'at_spawner');
  // With no blaze near, the known spawner is the empty_spawner question's.
  assert.ok(require('../src/empty-spawner').knownSpawner(bot, goal));
});

test('a long walk that came nearer goes on next pass, not ended as no way after one navigation', async () => {
  const bot = frameBot(), goal = frameGoal(), state = goal.fortressSearch;
  state.spawnerWait = { ...CAGE, until: Date.now() + 300000, startedAt: Date.now(), go: true };
  const navigate = async () => { const p = bot.entity.position, c = new Vec3(CAGE.x, CAGE.y, CAGE.z), d = c.minus(p); bot.entity.position = p.plus(d.scaled(20 / d.norm())); };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { navigate, tunnel: async () => {} });
  assert.ok(state.spawnerWait?.go, 'still on its way');
  assert.equal(state.spawnerWait.asked, undefined, 'the way there not asked while the walk gains');
});

test('a spawner seen broken is not offered; the tally counts only while within sixteen of it', async () => {
  const fm = require('../src/fortress-map');
  const bot = frameBot({ broken: true }), goal = frameGoal(), state = goal.fortressSearch;
  fm.noteSpawners(bot, state.map, { kills: 0, rods: 0 });
  assert.ok(state.map.spawners[0].broken);
  const client = jev('leg_east');
  await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, tunnel: async () => {} }, state);
  assert.ok(!Object.keys(client.asked[0].options).some(k => /^go_to_spawner/.test(k)));
  // The tally: a rod and a kill gained far off are not the spawner's; within sixteen they are.
  const b2 = frameBot(), g2 = frameGoal(), map = g2.fortressSearch.map;
  fm.noteSpawners(b2, map, { kills: 5, rods: 5 });
  fm.noteSpawners(b2, map, { kills: 6, rods: 6 });
  assert.deepEqual([map.spawners[0].kills, map.spawners[0].rods], [3, 3]);
  b2.entity.position = new Vec3(CAGE.x + 4, CAGE.y, CAGE.z);
  fm.noteSpawners(b2, map, { kills: 7, rods: 8 });
  assert.deepEqual([map.spawners[0].kills, map.spawners[0].rods], [4, 5]);
  assert.ok(Date.now() - map.spawners[0].lastThereAt < 1000);
});

test('fortress_leg lists go_to_spawner, and without Jev a spawner known is gone to before the floors are walked again (stay_in_fortress)', () => {
  const q = question('fortress_leg');
  assert.ok(q.options.some(o => o.pattern && new RegExp(`^${o.pattern}$`).test('go_to_spawner_1')));
  assert.ok(!q.options.some(o => o.pattern && new RegExp(`^${o.pattern}$`).test('go_to_spawner')), 'every spawner has its number, the nearest too (note 749)');
  const { legFallback } = require('./support/jev-stand-in');
  assert.equal(legFallback({ go_to_spawner_1: {}, stay_in_fortress: {}, go_to_blazes: {}, leg_east: {} }, [], { passes: 1 }), 'go_to_spawner_1');
});

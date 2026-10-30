'use strict';
// Note 2609: on the fortress's floors with blazes seen within the hunt's
// look lately and none about, the wait where they were seen is a way of its
// own (mob-hunt.js chooseLeg wait_where_seen), and leave_for_kit is a leave
// (intention.js DROP): a lone one is not taken unasked (fortress-hold.js
// loneWhy, note 721). full-225 (25587, 2026-10-30 23:03Z) had the kit leave
// taken as the one way with blazes seen 30 times 12 blocks off; over the full
// runs that lone leave was taken 83 times.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const { chooseLeg } = require('../src/mob-hunt');
const hold = require('../src/fortress-hold');
const intention = require('../src/intention');
require('../src/decisions/travel');

const rec = require('./fixtures/go-to-spawner-25589.json');
const SPOT = { x: -160, y: 58, z: 210 };

function frameBot() {
  const at = rec.frame.position;
  const items = Object.entries(rec.frame.inventory).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 }));
  return { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20,
    entity: { position: new Vec3(at.x, at.y, at.z), onGround: true }, entities: {}, world: { raycast: () => null },
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], chat() {}, _kills: { blaze: 2 },
    blockAt: p => { const name = p.y <= 57 ? 'nether_bricks' : null; return { name: name || 'air', boundingBox: name ? 'block' : 'empty', diggable: true, position: p, digTime: () => 400 }; } };
}
// The bot on a floor the map holds, no spawner on the map, blazes seen 30 times 12 blocks off three minutes ago.
function frameGoal({ minutesAgo = 3, spawner = null } = {}) {
  const now = Date.now();
  const at = rec.frame.position, cell = `${Math.floor(at.x)},${Math.floor(at.y) - 1},${Math.floor(at.z)}`;
  return { kind: 'win', mobHunt: { item: 'blaze_rod', entity: 'blaze', sightings: [{ ...SPOT, dimension: 'the_nether', seen: 30, inSight: 20, at: now - minutesAgo * 60000 }] },
    fortressSearch: { legs: 3, found: rec.fortress.found, inFortressSince: now - 16 * 60000,
      map: { cells: { [cell]: [1, 0, 0] }, failed: {}, chests: [], spawners: spawner ? [{ ...spawner, seenAt: now - 60000 }] : [] } } };
}
function jev(pick) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: questions.branch_0.criteria[pick] ? pick : Object.keys(questions.branch_0.criteria)[0], confidence: 0.9 } } }; } };
}
const fortress = { key: 'stay_in_fortress', offer: false, bricks: [], facts: {}, others: {}, description: '', run: () => 'stay' };

test('on the floors with blazes seen 12 blocks off three minutes ago and none about, the wait where they were seen is offered, said with the place, the spawner\'s making and the fortress\'s own tally; chosen, it is the search\'s wait there', async () => {
  const bot = frameBot(), goal = frameGoal(), state = goal.fortressSearch;
  const client = jev('wait_where_seen');
  const picked = await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, tunnel: async () => {} }, state, fortress);
  assert.equal(picked, 'wait');
  const { options } = client.asked[0];
  assert.match(options.wait_where_seen, /^Wait where the blazes were seen, 30 times at \(-160, 58, 210\) \(20 of them in sight, the rest heard through the walls\), 1[23] blocks off, last 3 minutes ago, for 3 minutes/);
  assert.match(options.wait_where_seen, /No blaze is about now\. Blazes come from a spawner, which makes up to four within four blocks of itself every ten to forty seconds while a player is within sixteen of it; this fortress's spawner has not been seen/);
  assert.match(options.wait_where_seen, /The bot has been in this fortress 16 minutes, 2 blazes killed in the trial\./);
  assert.ok(options.go_to_blazes, 'the walk to where they were seen stays a way of its own');
  assert.deepEqual({ x: state.spawnerWait.x, y: state.spawnerWait.y, z: state.spawnerWait.z, go: state.spawnerWait.go }, { ...SPOT, go: undefined });
  assert.ok(state.spawnerWait.until > Date.now() + 2 * 60000);
});

test('not offered where the sighting is older than ten minutes, or a spawner the map holds stands within sixteen of it (wait_at_spawner\'s)', async () => {
  for (const goal of [frameGoal({ minutesAgo: 12 }), frameGoal({ spawner: { x: SPOT.x + 3, y: SPOT.y, z: SPOT.z } })]) {
    const client = jev('leg_east');
    await chooseLeg(frameBot(), new Task('hunt'), goal, () => {}, { client, tunnel: async () => {} }, goal.fortressSearch, fortress);
    assert.equal(client.asked[0].options.wait_where_seen, undefined);
  }
});

test('leave_for_kit is a leave: alone on the fortress\'s question it is not taken unasked, and chosen it ends what is under way', () => {
  assert.ok(hold.isLeave('leave_for_kit'));
  assert.match(hold.loneWhy('fortress_leg', 'leave_for_kit'), /the one option left from here, leave for kit, leaves it; leaving is not taken unasked/);
  assert.ok(intention.DROP.test('leave_for_kit'));
  assert.equal(hold.loneWhy('fortress_leg', 'wait_where_seen'), null);
});

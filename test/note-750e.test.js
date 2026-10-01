'use strict';
// Trial note 750e: 25583 (mid-230-ae), 04:32-04:42Z on 2026-10-01, at its
// fortress's bricks, blazes seen there 70 times, 0 of 7 rods; the leg
// question offered searches for another fortress and go_to_blazes on foot
// only, and it took leg_north, round_north, leg_east by turns
// (critic-20261001T0441Z item 1).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot } = require('./fixtures/saved-ground');

// The ground under 25581's fortress (note 750c's fixture): floors 27 up.
const GROUND = require('./fixtures/fortress-over-25581-750c.json');
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => {
    const criteria = questions.branch_0.criteria;
    asked.push({ state, options: criteria });
    const pick = picks.find(p => criteria[p]) || Object.keys(criteria).find(k => k !== 'none_good');
    return { answers: { branch_0: { choice: pick, confidence: 0.9 } } };
  } };
}

test('at a fortress in view with rods owed and blazes seen at it, the leg question offers the fortress approach\'s ways to those blazes, and no search for another (note 750e)', async () => {
  const { chooseLeg } = require('../src/mob-hunt');
  const bot = groundBot(GROUND, { at: new Vec3(-246.5, 45, -241.5), items: [['iron_pickaxe', 1], ['netherrack', 64]], dimension: 'the_nether', indexed: true });
  bot.entities = {}; bot.players = {};
  const now = Date.now();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7, sightings: [{ x: -254, y: 72, z: -249, dimension: 'the_nether', seen: 20, inSight: 0, at: now - 120000 }] }, portals: [] };
  const state = { legs: 3, since: now - 600000 };
  const bricks = [new Vec3(-255, 71, -243), new Vec3(-254, 71, -249), new Vec3(-250, 71, -246)];
  const fortress = { key: 'back_to_fortress', offer: false, bricks, facts: { bricks: 3 } };
  const ran = [];
  const client = jevStub(['blazes_tunnel']);
  const actions = { client, navigate: async () => { throw new Error('No path to the goal!'); }, tunnel: async () => { ran.push('tunnel'); bot.entity.position = bot.entity.position.offset(-1, 1, -1); }, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false };
  const out = await chooseLeg(bot, new Task('hunt'), goal, () => {}, actions, state, fortress);
  const { options, state: facts } = client.asked.at(-1);
  const ways = Object.keys(options).filter(k => k.startsWith('blazes_'));
  assert(ways.includes('blazes_tunnel'), Object.keys(options).join(', '));
  assert.match(options.blazes_tunnel, /^To the blazes seen 20 times at \(-254, 72, -249\).*at this fortress, with 7 blaze rods still needed: Dig a staircase/);
  assert.equal(Object.keys(options).filter(k => /^(leg_|round_|floor_)|^(widen_search|seek_fortress_height)$/.test(k)).length, 0, 'no search for another');
  assert.match(facts.searchNotOffered, /^the search for another fortress \(.*\) is not offered: this fortress, in view, is where blazes were seen and 7 rods are still needed/);
  assert.equal(out, 'way'); assert.deepEqual(ran, ['tunnel']);
  assert.deepEqual(state.blazeWay.failed, [], 'a step nearer is not a failure');
  // No rods owed: the legs as before.
  const done = jevStub(['leg_north']);
  await chooseLeg(bot, new Task('hunt'), { ...goal, mobHunt: { ...goal.mobHunt, targetCount: 0 } }, () => {}, { ...actions, client: done }, { legs: 3, since: now }, fortress);
  assert(Object.keys(done.asked.at(-1).options).some(k => k.startsWith('leg_')), 'legs offered with nothing owed');
});

test('on the fortress\'s floors or on a walk to a place of it, no "Leaving the fortress ... searching on" is said (25583 at 04:32:12Z, note 750e)', () => {
  const narration = require('../src/narration');
  const bot = { chat() {} };
  const shunned = [{ x: 0, z: 0, until: Date.now() + 60000, why: 'Jev chose to leave it and search on' }];
  assert.equal(narration.stepLine({ fortressSearch: { shunned, goTo: { kind: 'unwalked' } } }, { action: 'find_fortress', legs: 1 }, null, null, bot), null);
  assert.equal(narration.stepLine({ fortressSearch: { shunned } }, { action: 'find_fortress', target: { x: 90, y: 60, z: 0 }, legs: 2 }, null, null, bot), 'Leaving the fortress for now, searching on (leg 2).');
});

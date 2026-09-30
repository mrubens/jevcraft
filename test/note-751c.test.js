'use strict';
// Note 751c: a leg short of blocks said as one that cannot be done, a leg
// that ran out of blocks at the same place said as tried, the way back to
// ground offered where its route ends within the digging's reach, and the
// digging named before the legs it is for (25593 mid-237-ca, 19:03-19:06Z).
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

const stack = (name, count = 1) => ({ name, count, type: registry.itemsByName[name].id });
// Netherrack at y 56 and below where z >= -5, open air over nothing north of it.
function world(position, items) {
  const at = p => {
    const q = p.floored ? p.floored() : p;
    const name = q.y <= 56 && q.z >= -5 && q.y >= 40 ? 'netherrack' : q.y > 70 ? 'netherrack' : 'air';
    return { name, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, position: q, digTime: () => 400 };
  };
  return { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position }, entities: {},
    world: { raycast: () => null }, inventory: { items: () => items }, chat() {}, blockAt: at,
    findBlocks: ({ maxDistance }) => { const out = []; for (let x = -6; x <= 6; x++) for (let z = -5; z <= 6; z++) out.push(new Vec3(Math.floor(position.x) + x, 56, z)); return out.filter(p => p.distanceTo(position) <= maxDistance); } };
}

test('a leg short of blocks says first that it cannot be done with what is carried (25593 took leg_north with 88 for 96)', () => {
  const { surveyLeg, legSays } = require('../src/nether-travel');
  const bot = world(new Vec3(0.5, 57, -4.5), [stack('netherrack', 88), stack('iron_pickaxe')]);
  const survey = surveyLeg(bot, [0, -1], { cells: 96 });
  assert.equal(survey.runsOut, 88);
  assert.match(legSays(survey, { direction: 'north', length: 96, y: 57 }), /^It needs 96 blocks laid and 88 are carried: it cannot be done with what is carried, and stops at cell 88 with none to lay\. Go north 96 blocks at y 57/);
  const enough = surveyLeg(world(new Vec3(0.5, 57, -4.5), [stack('netherrack', 128)]), [0, -1], { cells: 96 });
  assert.doesNotMatch(legSays(enough, { direction: 'north', length: 96, y: 57 }), /cannot be done/);
});

test('a leg that ran out of blocks where this one stops, with no more carried, is said as tried (25593 at 19:05:31Z)', () => {
  const { triedSays } = require('../src/mob-hunt');
  const now = Date.parse('2026-09-30T19:05:31Z');
  const state = { legHistory: { north: { ended: 'out of blocks (0 carried)', endAt: { x: 15, y: 35, z: -178 }, carried: 0, at: now - 30000, from: { x: 14, z: -144 } } } };
  const here = new Vec3(14.5, 35, -144.5);
  // Its walk ends on its own span at the same place.
  assert.equal(triedSays(state, 'north', here, { runsOut: 34 }, { x: 15, y: 35, z: -178 }, 0, now),
    ' Tried: the last leg north ran out of blocks at (15, 35, -178) 30 seconds ago with 0 carried; with 0 carried now this one stops at the same place.');
  // Without a walk surveyed, where the line's blocks run out.
  assert.match(triedSays(state, 'north', here, { runsOut: 34 }, null, 0, now), /^ Tried:/);
  // More carried now, or another end: not said.
  assert.equal(triedSays(state, 'north', here, { runsOut: 34 }, null, 40, now), '');
  assert.equal(triedSays(state, 'north', here, { runsOut: 10 }, null, 0, now), '');
});

test('back to the ground last stood on is offered where the route ends short of it within the digging\'s reach (25593: "its nearest ends 7 blocks short")', async () => {
  const { backToGround } = require('../src/mob-hunt');
  const bot = world(new Vec3(14.5, 57, -144.5), [stack('iron_pickaxe')]);
  const path = []; for (let z = -143; z <= -19; z++) path.push({ x: 14, y: 57, z, toPlace: [], toBreak: [] });
  bot.pathfinder = { movements: {}, getPathTo: () => ({ status: 'partial', path }) };
  const state = { lastGround: { nether: { x: 7, y: 57, z: -12, name: 'basalt', key: 'k' } } };
  const back = await backToGround(bot, new Task('leg'), {}, state, { want: 0, need: 96, carried: 0 });
  assert(back?.option, JSON.stringify(back));
  const o = back.option({ navigate: async () => {} }, () => {});
  assert.match(o.description, /^Walk back to the basalt last stood on at \(7, 57, -12\), 133 blocks back the way the pathfinder finds \(125 steps, about \d+ seconds; its route ends 10 blocks short of it, within the 16 blocks the digging reaches from where it stands\)/);
  // Farther short than the digging reaches: said, not offered.
  bot.pathfinder.getPathTo = () => ({ status: 'partial', path: path.slice(0, 60) });
  const far = await backToGround(bot, new Task('leg'), {}, state, { want: 0, need: 96, carried: 0 });
  assert(!far.option && /so it is not offered/.test(far.says));
});

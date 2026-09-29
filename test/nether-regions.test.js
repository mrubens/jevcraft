'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const regions = require('../src/nether-regions');

test('a bastion seen settles its region as holding no fortress; one near a region\'s edge could have begun in either and settles none', () => {
  // mid-243-ch's bastion at (89, 43, 324) lies in the region x 0 to 431, z 0 to 431 and nowhere else.
  const bastion = { kind: 'bastion', x: 89, y: 43, z: 324, dimension: 'nether' };
  assert.deepEqual(regions.owners('bastion', bastion), [{ rx: 0, rz: 0 }]);
  const k = regions.known([bastion, { kind: 'warped_forest', x: 27, z: 6, dimension: 'nether' }, { kind: 'bastion', x: 10, y: 60, z: 100, dimension: 'overworld' }]);
  assert.equal(k.settled.length, 1);
  assert.match(regions.regionSays({ rx: 0, rz: 0 }, k, {}, 'nether'), /^the region x 0 to 431, z 0 to 431 holds the bastion seen at \(89, 43, 324\), so no fortress begins in it; about 0% of it seen/);
  assert.match(regions.regionSays({ rx: 1, rz: 0 }, k, {}, 'nether'), /^the region x 432 to 863, z 0 to 431 nothing of a fortress or bastion known there/);
  // Ten blocks inside the west edge: a bastion begun in the region to the west can reach that far.
  const edge = regions.known([{ kind: 'bastion', x: 10, y: 50, z: 200, dimension: 'nether' }]);
  assert.equal(edge.settled.length, 0);
  assert.match(regions.regionSays({ rx: -1, rz: 0 }, edge, {}, 'nether'), /may hold the bastion seen at \(10, 50, 200\), which could have begun in it or in a region beside it/);
  // Heading east from (97, 292), the region ends 335 blocks on; north, 292.
  assert.equal(regions.headingRegion({ x: 97, z: 292 }, [1, 0]).blocks, 335);
  assert.equal(regions.headingRegion({ x: 97, z: 292 }, [0, -1]).blocks, 292);
  assert.deepEqual(regions.headingRegion({ x: -5, z: 292 }, [-1, 0]).next, { rx: -2, rz: 0 });
});

test('how much of a region is seen is counted from the search\'s coverage of it alone', () => {
  // Two chunks of columns seen in the region at the origin, one in the region east of it.
  const state = { coverage: { nether: { seen: { '0,0': 0xffff, '1,0': 0xffff, '27,0': 0xffff }, stood: {} } } };
  assert.equal(regions.seenShare(state, 'nether', { rx: 0, rz: 0 }), 32 / 11664);
  assert.equal(regions.seenShare(state, 'nether', { rx: 1, rz: 0 }), 16 / 11664);
});

test('the leg\'s question says where fortresses can begin: the bastion\'s region has none of its own, each leg says where it leaves the region, and the portal back is said (mid-243-ch, note 652)', async () => {
  // 25581 walked thirteen legs over x -62 to 132, z 6 to 443, round the bastion it had seen at (89, 43, 324), never told the region held no fortress.
  const { chooseLeg } = require('../src/mob-hunt');
  const open = p => p.y >= 57 && p.y <= 75;
  const at = p => { const q = p.floored ? p.floored() : p, name = open(q) ? 'air' : 'netherrack'; return { name, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, position: q, digTime: () => 400 }; };
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(97.5, 62, 292.5) }, entities: {},
    world: { raycast: () => null }, inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }] }, findBlocks: () => [], chat() {}, blockAt: at };
  const goal = { landmarks: [{ kind: 'bastion', x: 89, y: 43, z: 324, dimension: 'nether' }], portals: [{ x: 186, y: 65, z: 113, dimension: 'overworld' }, { x: 27, y: 41, z: 7, dimension: 'nether' }] };
  const state = goal.fortressSearch = { legs: 12 };
  const asked = [];
  const client = { systemOne: async ({ state: facts, questions }) => { asked.push({ facts, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: 'leg_east', confidence: 0.9 } } }; } };
  await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, tunnel: async () => {} }, state);
  const { facts, options } = asked[0];
  assert.match(facts.structureRegions.rule, /each region holds one fortress or one bastion, never both/);
  assert.match(facts.structureRegions.standingIn, /^the region x 0 to 431, z 0 to 431 holds the bastion seen at \(89, 43, 324\), so no fortress begins in it; about \d+% of it seen at fortress heights$/);
  assert.match(options.leg_east, /This way the bot leaves the region it stands in after about 335 blocks, into the region x 432 to 863, z 0 to 431 nothing of a fortress or bastion known there; about 0% of it seen at fortress heights\./);
  assert.match(options.leg_north, /after about 293 blocks, into the region x 0 to 431, z -432 to -1 nothing of a fortress or bastion known there/);
  assert.equal(facts.portalBack, 'the nearest portal known in the Nether is at (27, 41, 7), 294 blocks north of here');
  assert.equal(state.heading, 0);
});

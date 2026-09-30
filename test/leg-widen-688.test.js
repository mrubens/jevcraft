'use strict';
// The fortress search's legs: what each is worth first, the way back over
// the last leg said plainly, and the search widened round where it began
// (note 688: 25598, mid-243-hb, 21:05 to 21:12Z on 2026-09-29).
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const coverage = require('../src/nether-coverage');

function world(position, open) {
  const at = p => {
    const q = p.floored ? p.floored() : p;
    const name = open(q) ? 'air' : 'netherrack';
    return { name, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, position: q, digTime: () => 400 };
  };
  return { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position }, entities: {},
    world: { raycast: () => null }, inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }] }, findBlocks: () => [], chat() {}, blockAt: at };
}

test('the spiral\'s next side is read from where the bot stands: clockwise along its ring, out to the next from the west side', () => {
  const o = { x: 0, z: 0 };
  // North side: east to the ring's corner.
  assert.deepEqual((({ heading, length }) => ({ heading, length }))(coverage.spiralSide(o, { x: -40, z: -100 })), { heading: 0, length: 140 });
  // At the north-east corner the side turns south, the whole east side (capped at 192).
  assert.equal(coverage.spiralSide(o, { x: 100, z: -100 }).heading, 1);
  assert.equal(coverage.spiralSide(o, { x: 100, z: -100 }).length, 192);
  // South side: west.
  assert.equal(coverage.spiralSide(o, { x: 50, z: 100 }).heading, 2);
  // West side: north, past the corner to the next ring, 96 blocks out.
  const w = coverage.spiralSide(o, { x: -100, z: 60 });
  assert.equal(w.heading, 3);
  assert.equal(w.length, 192);
  const top = coverage.spiralSide(o, { x: -100, z: -60 });
  assert.equal(top.heading, 3);
  assert.equal(top.length, 136, 'from z -60 north to z -196, the next ring');
  // Then east along the next ring's north side, never back over the last.
  assert.equal(coverage.spiralSide(o, { x: -100, z: -196 }).heading, 0);
  // At the start itself the spiral begins east.
  assert.equal(coverage.spiralSide(o, { x: 0, z: 0 }).heading, 0);
});

test('each leg leads with the new ground it looks over and where it ends against the start; the way back over the last leg is said plainly; widen_search is offered and taken with its own length', async () => {
  const { chooseLeg, fortressLegTarget } = require('../src/mob-hunt');
  const open = p => p.y >= 57 && p.y <= 75 && Math.abs(p.x) <= 300 && Math.abs(p.z) <= 300;
  const bot = world(new Vec3(0.5, 57, 0.5), open);
  // The search began at (100, 0); the last leg went west from (90, 0) to here, looking as it went.
  const state = { legs: 3, heading: 2, lastHeading: 2, legFrom: { x: 90, z: 0 }, origin: { x: 100, z: 0 } };
  for (let x = 90; x >= 0; x -= 6) { bot.entity.position = new Vec3(x + 0.5, 57, 0.5); coverage.look(bot, state); }
  bot.entity.position = new Vec3(0.5, 57, 0.5);
  const goal = { fortressSearch: state };
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'widen_search', confidence: 0.9 } } }; } };
  await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, tunnel: async () => {} }, state);
  const options = asked[0];
  for (const k of ['leg_east', 'leg_south', 'leg_west', 'leg_north']) assert.match(options[k], /^Unseen ahead: about \d+ of \d+ chunks \(\d+%\)/, k);
  // East is back over the last leg: said with how far back it began, and its ground as seen.
  assert.match(options.leg_east, /Back over the last leg's own line: that leg began 90 blocks east of here, and this one's first 90 blocks go over the ground it just searched, already looked over from there\.$/);
  assert.match(options.leg_east, /Its end is 4 blocks from where the search began \(the bot is 100 from there now\)\./);
  assert.doesNotMatch(options.leg_west, /Back over/);
  assert.match(options.leg_west, /Its end is 196 blocks from where the search began/);
  // The spiral: from the west side of its ring, north, out past the corner.
  assert.match(options.widen_search, /^Widen the search: the next side of a square spiral round where it began at \(100, 0\), clockwise, each ring 96 blocks past the last, so no side goes back over another\. From here: north 192 blocks, ending 215 blocks from the start\. Unseen ahead: about \d+ of \d+ chunks/);
  assert.match(options.widen_search, /Its first 96 blocks are as leg_north says\.$/);
  // Taken: the heading and the side's own length, and the leg after it is ninety-six again.
  assert.equal(state.heading, 3);
  assert.equal(state.legLength, 192);
  const target = fortressLegTarget(state, bot.entity.position);
  assert.deepEqual([target.x, target.z], [1, -191]);
  delete state.legLength;
  assert.equal(fortressLegTarget(state, bot.entity.position).z, -95);
});

test('without Jev the spiral\'s side is taken where its heading is among the most unseen', () => {
  const { legFallback } = require('./support/jev-stand-in');
  const children = { leg_east: {}, leg_south: {}, leg_west: {}, leg_north: {}, widen_search: {} };
  const unseen = { leg_east: 20, leg_south: 300, leg_west: 900, leg_north: 900 };
  assert.equal(legFallback(children, [], { current: 'leg_east', open: {}, unseen, widen: { leg: 'leg_north', unseen: 1500 } }), 'widen_search');
  // A side over seen ground is not the default.
  assert.equal(legFallback(children, [], { current: 'leg_east', open: {}, unseen, widen: { leg: 'leg_east', unseen: 20 } }), 'leg_west');
});

test('the turn says why the way ended: out of blocks is not "no way on in this direction"', () => {
  const { noWaySays } = require('../src/mob-hunt');
  assert.equal(noWaySays({ lastHeading: 2, lastLegError: 'out of blocks (20 carried)' }, 'Choosing another way.'), 'No way on west from here: out of blocks (20 carried). Choosing another way.');
  assert.equal(noWaySays({ lastHeading: 0 }, 'Choosing another.'), 'No way on east from here. Choosing another.');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { localMoves, describeMove } = require('../src/unstuck');

// A world of stone with named cells.
const view = (cells, extra = {}) => ({ name: p => cells[`${p.x},${p.y},${p.z}`] ?? (p.y >= 80 ? 'air' : 'stone'), carried: {}, pickaxe: 'iron_pickaxe', ...extra });

test('in a pool under a stone lid, the moves say the lid can be dug and the climb out waits for it', () => {
  // Trial 33: feet in water, head in the one open cell, stone over the
  // head, a dry bank a block up to the east.
  const cells = { '0,70,0': 'water', '0,71,0': 'air', '1,71,0': 'air', '1,72,0': 'air', '-1,70,0': 'water' };
  const feet = new Vec3(0, 70, 0);
  const before = localMoves(view(cells), feet, { goal: 'dry' });
  const keys = before.moves.map(m => m.key);
  assert(keys.includes('dig_up'), 'the lid can be dug');
  assert(!keys.includes('climb_east'), 'no climb out with stone at the top of the head');
  assert.equal(before.here.headroomToRise, false);
  cells['0,72,0'] = 'air';
  const after = localMoves(view(cells), feet, { goal: 'dry' });
  const climb = after.moves.find(m => m.key === 'climb_east');
  assert(climb && climb.dryFooting, 'with the lid gone, the climb east ends on dry ground');
  assert.match(describeMove(climb), /Climb out of the water onto the block east.*ends on dry ground/);
});

test('a dig down or to the side says the drop past it and what the fall costs (the decision audit)', () => {
  // A cave six blocks under the floor, and a ravine beside at the feet.
  const cells = { '0,71,0': 'air', '0,72,0': 'air' };
  for (let y = 64; y <= 69; y++) cells[`0,${y},0`] = 'air';
  for (let y = 66; y <= 70; y++) cells[`1,${y},0`] = 'air';
  const moves = localMoves(view(cells), new Vec3(0, 71, 0)).moves;
  const down = moves.find(m => m.key === 'dig_down');
  assert.match(describeMove(down), /it opens onto open air; a drop of 6 blocks under it: falling 7 blocks costs about 4 health/);
  const east = moves.find(m => m.key === 'dig_east_feet');
  assert.match(describeMove(east), /a drop of 5 blocks under it: falling 5 blocks costs about 2 health/);
});

test('digging under sand says it will fall onto the head, and a pillar is offered only with blocks and headroom', () => {
  const cells = { '0,71,0': 'air', '0,72,0': 'air', '0,73,0': 'sand', '0,74,0': 'sand', '0,75,0': 'sand' };
  const feet = new Vec3(0, 71, 0);
  const up = localMoves(view(cells), feet).moves.find(m => m.key === 'dig_up');
  assert.match(up.effects.join(), /2 blocks of sand above would fall into it, onto the bot's head/);
  assert(!localMoves(view(cells, { carried: { dirt: 4 } }), feet).moves.some(m => m.key === 'pillar'), 'no headroom for a pillar under sand');
  cells['0,73,0'] = 'air';
  assert(localMoves(view(cells, { carried: { dirt: 4 } }), feet).moves.some(m => m.key === 'pillar'));
});

test('stuck on the surface, the moves say how far each ends from where the bot got stuck, and eight blocks off is out', () => {
  const { localMoves } = require('../src/unstuck');
  // An alcove: stone all round but a way west along a ledge.
  const cells = {};
  for (let x = -12; x <= 0; x++) { cells[`${x},70,0`] = 'air'; cells[`${x},71,0`] = 'air'; }
  const from = new Vec3(0, 70, 0);
  const west = localMoves(view(cells), from, { goal: 'away', from }).moves.find(m => m.key === 'step_west');
  assert.equal(west.blocksFromStart, 1);
  assert.equal(localMoves(view(cells), new Vec3(-8, 70, 0), { goal: 'away', from }).done, true);
  assert.equal(localMoves(view(cells), new Vec3(-7, 70, 0), { goal: 'away', from }).done, false);
});

test('under water, a move says whether there is air up the column or only water to a ceiling', () => {
  // Trial 77: swam up a column flooded to the rock and drowned at the top of it.
  const { localMoves, describeMove } = require('../src/unstuck');
  const { Vec3 } = require('vec3');
  const column = new Set(); for (let y = 10; y <= 16; y++) column.add(`0,${y},0`);
  const view = { name: p => (p.x === 0 && p.z === 0 && column.has(`0,${p.y},0`)) ? 'water' : 'stone', carried: {}, pickaxe: 'stone_pickaxe' };
  const { moves } = localMoves(view, new Vec3(0, 10, 0), { goal: 'sky' });
  const up = moves.find(m => m.key === 'swim_up');
  assert.match(describeMove(up), /water up to a ceiling \d+ blocks up from there: no air that way/);
  column.delete('0,16,0');
  const view2 = { ...view, name: p => p.x === 0 && p.z === 0 && p.y === 16 ? 'air' : view.name(p) };
  const up2 = localMoves(view2, new Vec3(0, 10, 0), { goal: 'sky' }).moves.find(m => m.key === 'swim_up');
  assert.match(describeMove(up2), /air 5 blocks straight up from there/);
});

test('digging up with water beside the block says the water pours down, and fills a one-block shaft', () => {
  // Trial 77: dug up out of its own pillar shaft into rock beside water; told only "would flow in".
  const { localMoves, describeMove } = require('../src/unstuck');
  const { Vec3 } = require('vec3');
  const view = { name: p => (p.x === 0 && p.z === 0 && (p.y === 10 || p.y === 11)) ? 'air' : (p.x === 1 && p.z === 0 && p.y === 12) ? 'water' : 'stone', carried: {}, pickaxe: 'stone_pickaxe' };
  const up = localMoves(view, new Vec3(0, 10, 0), { goal: 'sky' }).moves.find(m => m.key === 'dig_up');
  assert.match(describeMove(up), /water beside it would pour down onto the bot and fill the one-block shaft it stands in/);
});

test('a move that already failed from this cell says so', () => {
  // mid-72-e chose the climb south out of a pool ten times in ten minutes.
  const climb = { key: 'climb_south', does: 'Climb out of the water onto the block south.', kind: 'move', to: new Vec3(0, 71, 1), rises: 1, dryFooting: true };
  assert.doesNotMatch(describeMove(climb), /tried/);
  assert.match(describeMove({ ...climb, failedHere: 3 }), /tried from here 3 times already and it did not get there/);
});

test('working free stops for a mob come close: the survival layer answers it', async () => {
  // mid-110-q climbed out of a hole one move at a time while a creeper walked up, and was blown up in iron.
  const { workFree } = require('../src/unstuck');
  const { Task } = require('../src/skills');
  const creeper = { id: 5, name: 'creeper', type: 'hostile', position: new Vec3(3.5, 64, 0.5), height: 1.7, isValid: true };
  const bot = { game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 5: creeper },
    world: { raycast: () => null }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }),
    inventory: { items: () => [] }, chat() {} };
  let asked = 0;
  await assert.rejects(workFree(bot, new Task('free'), {}, () => {}, { client: { systemOne: async () => { asked++; return {}; } }, dig: async () => {}, aim: { goal: 'sky', aim: 'up' } }),
    { name: 'NeedsSafety' });
  assert.equal(asked, 0, 'no move asked for with the creeper there');
});

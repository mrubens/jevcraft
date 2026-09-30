'use strict';
// Note 716: 25583 (mid-242-mh) was told crimson stems were the nearest,
// close by, and the fetch failed three times running, "No stems were
// fetched" (nether-wood.js's fetchStemsOffer named the nearest known place
// by raw distance alone, never checking whether a walk could reach it,
// while a farther place the survey could actually reach sat unasked in
// "next nearest"). The offer now tries the known places nearest first and
// says the one its own route survey (the same surveyRoute the fetch's walk
// option itself uses) finds a way to on foot, not just the closest by line.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const { Task, surveyRoute } = require('../src/skills');
const { goals } = require('mineflayer-pathfinder');
const nw = require('../src/nether-wood');

// A start room, a near pocket of stems sealed off by solid netherrack (no
// door), and a farther pocket of stems at the end of an open corridor.
function world() {
  const box = { x: [-3, 40], y: [59, 62], z: [0, 6] };
  const palette = ['air', 'netherrack', 'crimson_stem'];
  const inRoom = (x, lo, hi) => x >= lo && x <= hi;
  // The corridor runs along z = 4; the near pocket sits at z = 0, four
  // blocks off that line (past GoalNear's own radius of three), so getting
  // within the corridor is not mistaken for reaching it.
  const at = (x, y, z) => {
    if (y === 59 || y === 62) return 1; // floor and ceiling everywhere
    // The near pocket, sealed: nothing opens beside it. Checked before the
    // side-wall rule below, which would otherwise cover the same cell.
    if (inRoom(x, 8, 9) && y === 60 && z === 0) return 2;
    if (z < 3 || z > 5) return 1; // side walls
    // The start room, at the corridor's near end.
    if (inRoom(x, -2, 2)) return 0;
    // The open corridor on to the far pocket.
    if (inRoom(x, 3, 33) && (y === 60 || y === 61) && z === 4) return 0;
    // The far pocket's stems, at the end of the corridor.
    if (inRoom(x, 34, 35) && y === 60 && z === 4) return 2;
    return 1;
  };
  const rows = [];
  for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
    let row = '';
    for (let x = box.x[0]; x <= box.x[1]; x++) row += String.fromCharCode(97 + at(x, y, z));
    rows.push(row);
  }
  return { box, palette, rows };
}

test('the stems offered as "the nearest" are ones a walk can actually reach, not just the closest known by distance (note 716)', async () => {
  const bot = groundBot(world(), { at: new Vec3(0.5, 60, 4.5), dimension: 'the_nether', items: [] });
  const offer = await nw.fetchStemsOffer(bot, new Task('work'), { kind: 'win' });
  assert(offer, 'offered: some short wood and stems known');
  // The raw-nearest place (the sealed pocket, 6 to 9 blocks off) is not the
  // one named: it is not offered a walk at all.
  assert.equal(offer.place.at.x, 8, 'the nearest known by distance is the sealed pocket');
  // Sanity: the near pocket really is sealed off, no route on foot.
  const near = await surveyRoute(bot, new Task('work'), bot.pathfinder.movements, new goals.GoalNear(8, 60, 0, 3), 500);
  assert.notEqual(near.status, 'success');
  const said = await offer.describe();
  // describe() moved past the sealed, unreachable pocket (raw-nearest) to
  // the farther one a walk actually reaches, and said that route.
  assert.doesNotMatch(said, /The nearest stems: 2 crimson stems known at \(8,/, said);
  assert.match(said, /The nearest stems: 2 crimson stems known at \(34,/, said);
  assert.match(said, /A route survey from here found a way there on foot/, said);
});

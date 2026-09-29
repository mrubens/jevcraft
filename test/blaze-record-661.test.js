'use strict';
// Note 661: what the overnight run (2026-09-29T04:49Z to 11:37Z, 248 blaze fights, 73 deaths) said about the
// fire and the blazes, and where Jev is told it: the ways out of fire each end with what followed them in the played
// fights (putting out the flame where the bot stood was followed by a death in 45% of 111 answers with four or more
// blazes about, running out of the fire in 26% of 97), the stance's rows were counted again over both days, the
// iron sentence no longer says armour made no difference, and the rods' aftermath is compared within a health.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const record = require('../src/blaze-record');
const script = require('../scripts/blaze-record');
const body = require('../src/body');
const afterRod = require('../src/after-rod');

const blazeBot = ({ blazes = 5, at = 6, dimension = 'the_nether', health = 14 } = {}) => ({
  health, game: { dimension }, entity: { position: new Vec3(0, 60, 0) },
  entities: Object.fromEntries(Array.from({ length: blazes }, (_, i) => [i + 1, { name: 'blaze', position: new Vec3(at + i * 0.5, 60, 0), isValid: true }])),
});

test('a way out of fire says what followed it in the played fights, by the blazes within sixteen, and only where the row has eight answers', () => {
  const four = record.waySays(blazeBot({ blazes: 5 }), 'put_out_flames');
  assert.match(four, /^ In the fights of 2026-09-28 to 2026-09-29T11:40Z, with four or more blazes within sixteen \(5 now\), after this way was chosen \(111 answers\): 50 died within thirty seconds \(45%\), 7\.6 health lost in those thirty seconds on average;/);
  const run = record.waySays(blazeBot({ blazes: 5 }), 'out_of_fire');
  assert.match(run, /\(97 answers\): 25 died within thirty seconds \(26%\), 5\.1 health lost/);
  // The same question offered both, and the record says the two rows side by side.
  assert.ok(record.WAYS['4+'].put_out_flames[1] / record.WAYS['4+'].put_out_flames[0] > 1.5 * (record.WAYS['4+'].out_of_fire[1] / record.WAYS['4+'].out_of_fire[0]));
  // Fewer blazes: another row, and it says so.
  assert.match(record.waySays(blazeBot({ blazes: 2 }), 'put_out_flames'), /with no more than three blazes within sixteen \(2 now\), after this way was chosen \(69 answers\): 12 died within thirty seconds \(17%\)/);
  // No row, or under the minimum: nothing said (burn_out with no more than three blazes has no row).
  assert.equal(record.waySays(blazeBot({ blazes: 2 }), 'burn_out'), '');
  assert.equal(record.waySays(blazeBot({ blazes: 5 }), 'to_water'), '');
  for (const cells of Object.values(record.WAYS)) for (const c of Object.values(cells)) assert(c[0] >= record.WAYS_MIN, 'no row under the minimum');
  // Not in the Nether, or no blaze within 24: nothing said.
  assert.equal(record.waySays(blazeBot({ blazes: 5, dimension: 'overworld' }), 'put_out_flames'), '');
  assert.equal(record.waySays(blazeBot({ blazes: 5, at: 30 }), 'put_out_flames'), '');
});

test('body_way asks with each way ending in its row while blazes are about, and unchanged without them', async () => {
  const ways = () => ({
    put_out_flames: { description: 'Punch out the flame.', run: async () => true },
    out_of_fire: { description: 'Run out of the fire.', run: async () => true },
  });
  const asked = [];
  const decide = async (id, q) => { asked.push(q.tree); return { path: ['out_of_fire'] }; };
  await body.answer({ ...blazeBot({ blazes: 5 }), inventory: { items: () => [] } }, new Task('t'), 'fire', ways(), { client: {}, decide, facts: { inFire: true }, log: () => {} });
  assert.match(asked[0].put_out_flames.description, /^Punch out the flame\. In the fights of 2026-09-28 to 2026-09-29T11:40Z, with four or more blazes within sixteen/);
  assert.match(asked[0].out_of_fire.description, /^Run out of the fire\. In the fights of/);
  assert.match(asked[0].out_of_fire.description, /\(97 answers\)/);
  await body.answer({ ...blazeBot({ blazes: 0 }), inventory: { items: () => [] } }, new Task('t'), 'fire', ways(), { client: {}, decide, facts: { inFire: true }, log: () => {} });
  assert.equal(asked[1].put_out_flames.description, 'Punch out the flame.');
});

// A body_way answer in the Nether with blazes about, as the flight record has it (frames of scripts/blaze-record.js).
const T = Date.parse('2026-09-29T06:00:00Z');
const mobs = n => Array.from({ length: n }, (_, i) => ({ name: 'blaze', id: i, d: 6 + i, at: { x: 0, y: 60, z: 0 }, seen: true }));
const frame = (s, snapshot) => ({ at: T + s * 1000, kind: 'observation', snapshot: { dimension: 'the_nether', ...snapshot } });
const answer = (s, way, hp, n, options = ['put_out_flames', 'out_of_fire', 'none_good']) => ({ at: T + s * 1000, kind: 'decision', snapshot: { dimension: 'the_nether', health: hp, mobs: mobs(n), decision: { id: 'body_way', path: [way], options } } });

test('--ways: a body_way answer is counted by the blazes within sixteen, whether the bot died within thirty seconds and the health it lost', () => {
  const frames = [
    frame(0, { health: 16, mobs: mobs(5) }),
    answer(1, 'put_out_flames', 16, 5), frame(4, { health: 9, mobs: mobs(5) }), frame(12, { health: 0, mobs: mobs(5) }),
    answer(100, 'out_of_fire', 18, 5), frame(104, { health: 15, mobs: mobs(5) }), frame(120, { health: 20, mobs: mobs(5) }),
    // Two blazes only: the other row. One option only: not counted. No blaze within 24: not counted.
    answer(200, 'put_out_flames', 20, 2), frame(210, { health: 17, mobs: mobs(2) }),
    answer(300, 'burn_out', 20, 5, ['burn_out', 'none_good']),
    { at: T + 400000, kind: 'decision', snapshot: { dimension: 'the_nether', health: 20, mobs: [{ name: 'blaze', id: 1, d: 40 }], decision: { id: 'body_way', path: ['put_out_flames'], options: ['put_out_flames', 'out_of_fire'] } } },
  ];
  const rows = script.wayRows(frames.map(f => ({ ...f })), { from: T - 1000, to: T + 1e6 });
  assert.deepEqual(rows.map(r => [r.way, r.blazes, r.died, r.lost]), [['put_out_flames', '4+', true, 16], ['out_of_fire', '4+', false, 3], ['put_out_flames', '0-3', false, 3]]);
  const table = script.waysTable(Array.from({ length: 8 }, () => rows[0]).concat([rows[1]]));
  assert.deepEqual(table, { '4+': { put_out_flames: [8, 8, 160] } }, 'a row of under eight answers is left out; the loss is the mean in tenths');
});

test('--recent: a spawner\'s fights against the rest, by blazes at once, and the health lost by the iron worn among fights begun over 16 health', () => {
  const f = (o) => ({ died: false, rod: false, rods: 0, spawnerNear: true, peak16: 5, hp0: 20, iron: 2, lost: 10, ...o });
  const t = script.recentTable([f({ died: true, lost: 30 }), f({ rod: true, rods: 2, lost: 20 }), f({ spawnerNear: false, peak16: 1, iron: 4, lost: 4 }), f({ spawnerNear: false, peak16: 3, hp0: 12, lost: 8, died: true })]);
  assert.deepEqual(t.spawner, { fights: 2, died: 1, rod: 1, rods: 2, lost: 25 });
  assert.deepEqual(t.elsewhere, { fights: 2, died: 1, rod: 0, rods: 0, lost: 6 });
  assert.deepEqual([t.few.fights, t.some.fights], [1, 1]);
  assert.deepEqual(t.ironLost, { two: { fights: 2, lost: 25 }, more: { fights: 1, lost: 4 }, none: { fights: 0, lost: 0 } }, 'fights begun at 12 health are left out of the iron rows');
});

test('the played record no longer says iron made no difference, and says the newest trials\' spawner rows with the rods each death cost', () => {
  const said = record.says({ health: 20, food: 20, entity: { position: new Vec3(0, 60, 0) }, entities: {} });
  assert.doesNotMatch(said, /made no difference/);
  assert.match(said, /Iron armour: the deaths barely moved/);
  assert.match(said, /and the fire it sets \(a health a second for five seconds\) is not reduced at all/);
  const r = record.RECENT;
  assert.equal(r.spawner.fights + r.elsewhere.fights, r.fights);
  assert.equal(r.few.fights + r.some.fights <= r.fights, true);
  assert.match(said, new RegExp(`${r.spawner.rods} rods, ${r.spawner.died} deaths: ${Math.round(r.spawner.rods / r.spawner.died * 10) / 10} rods for each death`));
  assert.match(said, new RegExp(`${r.elsewhere.rods} rods, ${r.elsewhere.died} deaths: ${Math.round(r.elsewhere.rods / r.elsewhere.died * 10) / 10} rods for each death`));
});

test('after a rod each answer is also compared within the bot\'s own health, and the rows are the whole record', () => {
  // A rod whose first answer was none of the three kinds ("other": a choice that is neither a stay nor a going away) is in no column.
  const left = (all, a) => all - a;
  let others = 0;
  for (const [band, rows] of Object.entries(afterRod.BY_BAND)) {
    const all = { overSixteen: afterRod.ROWS.overSixteen, eightToSixteen: afterRod.ROWS.eightToSixteen, underEight: afterRod.ROWS.underEight }[band];
    const rods = rows.stayed[0] + rows.away[0] + rows.unasked[0];
    assert(left(all[0], rods) >= 0 && left(all[0], rods) <= 2, `${band}: the three answers make the band's rods (all but a rod or two)`);
    assert(rows.stayed[1] + rows.away[1] + rows.unasked[1] <= all[1], `${band}: and no more deaths than the band has`);
    others += left(all[0], rods);
  }
  assert.equal(afterRod.ROWS.overSixteen[0] + afterRod.ROWS.eightToSixteen[0] + afterRod.ROWS.underEight[0], afterRod.ROWS.all[0]);
  assert.equal(afterRod.ROWS.all[0] - (afterRod.ROWS.stayed[0] + afterRod.ROWS.away[0] + afterRod.ROWS.unasked[0]), others, 'the rods of no column are the same in both splits');
});

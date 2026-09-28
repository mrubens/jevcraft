'use strict';
// Note 637: what the trial tooling measures, and what it starts from. The
// stage save pick (health, hunger, food, source worlds), the commit in the
// flight record and the per-commit table, and the stance price calibration.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const nbt = require('prismarine-nbt');
const { Vec3 } = require('vec3');
const stage = require('../scripts/lib/stage-select');
const fc = require('../scripts/lib/flight-commit');
const calib = require('../scripts/price-calibration');
const { loadedCommit } = require('../src/recorder/commit');
const { Trace } = require('../src/recorder/trace');
const { observeBot } = require('../src/recorder/observer');

const tmp = name => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));

// ---- stage save selection ----
const snap = (name, { health = 20, hunger = 20, food = 60, started = 0, last = 0, stage: at = 'fortress' } = {}) =>
  ({ name, stage: at, dir: `/x/${name}`, source: stage.sourceWorld(name), started, last, vitals: { health, hunger, foodPoints: food } });

test('note 637: a save is named for the world it came from, through nether and fortress trials and its clock time', () => {
  assert.equal(stage.sourceWorld('mid-242-ba-124020'), '242-ba');
  assert.equal(stage.sourceWorld('mid-242-ba-nether-2-140518'), '242-ba');
  assert.equal(stage.sourceWorld('mid-242-ae-nether-2-fortress-6-043011'), '242-ae');
  assert.equal(stage.sourceWorld('mid-235-p-nether-3-233732'), '235-p');
});

test('note 637: food points count what can be eaten for health, not rotten flesh', () => {
  const table = { cooked_mutton: 6, mutton: 2, rotten_flesh: 4, bread: 5 };
  const got = stage.foodPoints([{ id: 'minecraft:cooked_mutton', count: 3 }, { id: 'minecraft:mutton', count: 2 }, { id: 'minecraft:rotten_flesh', count: 9 }, { id: 'minecraft:dirt', count: 64 }], table);
  assert.equal(got.points, 22);
  assert.deepEqual(got.items, { cooked_mutton: 3, mutton: 2 });
});

test('note 637: a fortress save qualifies at health 20, hunger 18 and 40 food points; the nether save needs no food', () => {
  assert.deepEqual(stage.shortfalls({ health: 20, hunger: 18, foodPoints: 40 }), []);
  assert.equal(stage.shortfalls({ health: 17.3, hunger: 17, foodPoints: 4 }).length, 3);
  assert.match(stage.shortfalls({ health: 20, hunger: 20, foodPoints: 4 })[0], /4 food points/);
  assert.deepEqual(stage.shortfalls({ health: 20, hunger: 18, foodPoints: 0 }, { stage: 'nether' }), []);
  assert.match(stage.shortfalls({ error: 'no player data' })[0], /no player data/);
});

test('note 637: fortress starts rotate over source worlds before any repeats, and skip the hungry and the empty-handed', () => {
  const fortress = [
    snap('mid-1-a-100000', { started: 3 }), snap('mid-1-a-100100', { started: 3 }),
    snap('mid-2-b-100000', { started: 6 }), snap('mid-3-c-100000', { started: 6 }),
    snap('mid-4-d-100000', { started: 0, hunger: 16 }), snap('mid-5-e-100000', { started: 0, food: 4 }),
  ];
  const stages = { fortress, nether: [] };
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const pick = stage.choose(stages, 'fortress');
    assert.equal(pick.rule, 'qualifying');
    seen.push(pick.snapshot.source);
    pick.snapshot.started++;
  }
  // three worlds qualify: each once, then again in the same order
  assert.deepEqual(seen.slice(0, 3).sort(), ['1-a', '2-b', '3-c']);
  assert.deepEqual(seen.slice(3), seen.slice(0, 3));
  assert.ok(!seen.includes('4-d') && !seen.includes('5-e'));
});

test('note 637: within a world the save least started from goes first', () => {
  const stages = { fortress: [snap('mid-1-a-100000', { started: 3 }), snap('mid-1-a-100100', { started: 1 }), snap('mid-2-b-100000', { started: 9 }), snap('mid-3-c-100000', { started: 9 }), snap('mid-4-d-100000', { started: 9 })] };
  assert.equal(stage.choose(stages, 'fortress').snapshot.name, 'mid-1-a-100100');
});

test('note 637: with fewer than three qualifying fortress saves the pick falls back to the nether stage and says so', () => {
  const stages = {
    fortress: [snap('mid-1-a-100000'), snap('mid-2-b-100000', { hunger: 10 }), snap('mid-3-c-100000', { food: 2 })],
    nether: [snap('mid-9-z-100000', { hunger: 16, food: 0, stage: 'nether' }), snap('mid-8-y-100000', { food: 0, started: 2, stage: 'nether' }), snap('mid-7-x-100000', { food: 0, started: 0, stage: 'nether' })],
  };
  const pick = stage.choose(stages, 'fortress');
  assert.equal(pick.rule, 'fallback-nether');
  assert.equal(pick.stage, 'nether');
  assert.equal(pick.snapshot.name, 'mid-7-x-100000');
  assert.match(pick.why, /only 1 of 3 fortress saves qualify \(needs 3\); fell back to the nether stage/);
  // nothing qualifies anywhere: the fallback still starts something
  const none = stage.choose({ fortress: stages.fortress.slice(1), nether: [snap('mid-9-z-100000', { hunger: 10, stage: 'nether' })] }, 'fortress');
  assert.equal(none.rule, 'fallback-nether-any');
});

test('note 637: STAGE_ANY keeps the old pick, the least started save whatever it carried', () => {
  const stages = { fortress: [snap('mid-1-a-100000', { started: 4 }), snap('mid-2-b-100000', { started: 1, hunger: 3, food: 0 }), snap('mid-3-c-100000', { started: 2 })] };
  const pick = stage.choose(stages, 'fortress', { any: true });
  assert.equal(pick.rule, 'any');
  assert.equal(pick.snapshot.name, 'mid-2-b-100000');
});

test('note 637: the vitals come from the save\'s player data and the save is not written to', async () => {
  const root = tmp('stages'), dir = path.join(root, '.trial-checkpoints', 'stages', 'fortress', 'mid-1-a-100000');
  fs.mkdirSync(path.join(dir, 'world', 'players', 'data'), { recursive: true }); fs.mkdirSync(path.join(dir, 'state'));
  const tag = nbt.comp({ Health: nbt.float(20), foodLevel: nbt.int(19), foodSaturationLevel: nbt.float(2.5), Dimension: nbt.string('minecraft:the_nether'),
    Inventory: nbt.list(nbt.comp([{ id: nbt.string('minecraft:cooked_mutton'), count: nbt.int(8) }, { id: nbt.string('minecraft:netherrack'), count: nbt.int(64) }])) });
  fs.writeFileSync(path.join(dir, 'world', 'players', 'data', 'abc.dat'), zlib.gzipSync(nbt.writeUncompressed(tag, 'big')));
  const before = fs.readdirSync(dir, { recursive: true }).sort();
  const snaps = await stage.readStage(root, 'fortress');
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].source, '1-a');
  assert.equal(snaps[0].started, 0);
  assert.equal(snaps[0].vitals.health, 20);
  assert.equal(snaps[0].vitals.hunger, 19);
  assert.equal(snaps[0].vitals.foodPoints, 48);
  assert.equal(snaps[0].vitals.dimension, 'the_nether');
  assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), before);
  const text = stage.listing({ fortress: snaps }, 'fortress');
  assert.match(text, /mid-1-a-100000 <- next\s+1-a\s+20\s+19\s+48/);
  assert.match(text, /0 of 1 qualify|1 of 1 qualify/);
});

// ---- the commit in the flight record ----
test('note 637: the commit is the short SHA read once, and null where git cannot say', () => {
  const root = '/nowhere/one';
  let calls = 0;
  const run = () => { calls++; return 'ab12cd3\n'; };
  assert.equal(loadedCommit(root, run), 'ab12cd3');
  assert.equal(loadedCommit(root, run), 'ab12cd3');
  assert.equal(calls, 1);
  assert.equal(loadedCommit('/nowhere/two', () => { throw new Error('not a repository'); }), null);
  assert.equal(loadedCommit('/nowhere/three', () => 'garbage output here'), null);
});

test('note 637: the connection frame carries the commit the bot loaded', () => {
  const b = new EventEmitter(); b.username = 'TestJev'; b.entity = { id: 1, position: new Vec3(2, 64, 3), yaw: 0, pitch: 0 };
  b.entities = { 1: b.entity }; b.health = 20; b.food = 20; b.game = { dimension: 'overworld' };
  b.inventory = { items: () => [] }; b.blockAt = () => null;
  const trace = new Trace();
  observeBot(trace, b, { getGoal: () => ({}), commit: 'feed123' });
  b.emit('spawn');
  const frame = trace.frames.find(f => f.kind === 'connection');
  assert.equal(frame.detail.connected, true);
  assert.equal(frame.detail.commit, 'feed123');
  const bare = new Trace();
  observeBot(bare, b, { getGoal: () => ({}), commit: null });
  b.emit('spawn');
  assert.equal(bare.frames.find(f => f.kind === 'connection').detail.commit, undefined);
});

// ---- grouping by commit ----
const line = (t, snapshot, kind = 'observation', extra = '') => JSON.stringify({ kind, snapshot, ...(extra ? { detail: JSON.parse(extra) } : {}), id: 1, at: new Date(t).toISOString() });
const T0 = Date.parse('2026-09-28T10:00:00Z');
const at = s => T0 + s * 1000;
const obs = (s, { dim = 'overworld', hp = 20, rods } = {}) => line(at(s), { position: { x: 0, y: 64, z: 0 }, dimension: dim, health: hp, food: 20, ...(rods !== undefined ? { inventory: { cobblestone: 3, ...(rods ? { blaze_rod: rods } : {}) } } : {}) });

test('note 637: a run\'s lines give its bot time, deaths, rods gained and Nether entry', () => {
  const lines = [
    obs(0, { rods: 0 }), obs(1), obs(2, { dim: 'the_nether' }), obs(3, { dim: 'the_nether', rods: 1 }), obs(4, { dim: 'the_nether', hp: 4 }), obs(5, { dim: 'the_nether', hp: 0 }),
    obs(6, { dim: 'the_nether', hp: 0 }),
    obs(300, { dim: 'overworld', rods: 0 }), obs(301, { dim: 'the_nether', rods: 2 }),   // a gap of five minutes is not bot time
  ];
  const m = fc.measureLines(lines);
  assert.equal(m.deaths, 1);
  assert.equal(m.rods, 3);
  assert.equal(m.netherEntries, 2);
  assert.equal(m.botMs, 7000);
  assert.equal(m.frames, 9);
  assert.equal(fc.measureLines(lines, { from: at(200) }).deaths, 0);
});

test('note 637: a run begun in the Nether by a stage save is not a Nether entry, and rods carried from the start are not gained', () => {
  const m = fc.measureLines([obs(0, { dim: 'the_nether', rods: 2 }), obs(10, { dim: 'the_nether', rods: 2 }), obs(20, { dim: 'the_nether', rods: 3 })]);
  assert.equal(m.netherEntries, 0);
  assert.equal(m.rods, 1);
});

test('note 637: runs group by commit, records without one as unknown, with per bot-hour rates', () => {
  const H = 3600000;
  const runs = [
    { commit: 'aaa1111', port: '25582', botMs: 2 * H, deaths: 4, rods: 3, netherEntries: 2, first: at(0), last: at(7200) },
    { commit: 'aaa1111', port: '25583', botMs: 1 * H, deaths: 2, rods: 0, netherEntries: 0, first: at(100), last: at(3700) },
    { commit: 'bbb2222', port: '25582', botMs: 0.5 * H, deaths: 0, rods: 1, netherEntries: 1, first: at(9000), last: at(10800) },
    { commit: null, port: '25584', botMs: 1 * H, deaths: 1, rods: 0, netherEntries: 0, first: at(-5000), last: at(-1400) },
  ];
  const rows = fc.groupByCommit(runs);
  assert.deepEqual(rows.map(r => r.commit), ['aaa1111', 'bbb2222', 'unknown']);
  const a = rows[0];
  assert.equal(a.runs, 2); assert.equal(a.ports, 2); assert.equal(a.botHours, 3);
  assert.equal(a.deaths, 6); assert.equal(a.deathsPerHour, 2);
  assert.equal(a.rods, 3); assert.equal(a.rodsPerHour, 1); assert.equal(a.runsWithRod, 1);
  assert.equal(a.netherEntries, 2); assert.equal(a.runsEntered, 1);
  assert.equal(rows[1].rodsPerHour, 2);
  assert.equal(rows[2].deathsPerHour, 1);
  assert.match(fc.commitTable(rows), /aaa1111\s+2\s+3\s+6\s+2\s+3\s+1\s+1\s+2 \(1 runs\)/);
});

test('note 637: a directory of records groups its runs by the commit on the connection frame, parts included', () => {
  const dir = tmp('flight');
  const conn = (s, commit) => line(at(s), { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld', health: 20 }, 'connection', JSON.stringify({ connected: true, ...(commit ? { commit } : {}) }));
  fs.writeFileSync(path.join(dir, '127_0_0_1-25582-Jev-2026-09-28T10-00-00-000Z.jsonl'), [conn(0, 'aaa1111'), obs(1), obs(2, { hp: 0 })].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, '127_0_0_1-25582-Jev-2026-09-28T10-00-00-000Z-part2.jsonl'), [obs(3), obs(4, { hp: 0 })].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, '127_0_0_1-25583-Jev-2026-09-28T10-05-00-000Z.jsonl'), [obs(10), obs(11), obs(12, { hp: 0 })].join('\n') + '\n');   // an old record: no commit
  const rows = fc.groupByCommit(fc.readRuns(dir));
  assert.deepEqual(rows.map(r => [r.commit, r.runs, r.deaths]), [['aaa1111', 1, 2], ['unknown', 1, 1]]);
  assert.equal(fc.commitOfText('{"kind":"observation","snapshot":{}}\n{"kind":"connection","detail":{"connected":true,"commit":"0f0f0f0"},"id":2}'), '0f0f0f0');
  assert.equal(fc.commitOfText('{"kind":"decision","snapshot":{"note":"commit"}}'), null);
});

// ---- stance price calibration ----
test('note 637: the figure a stance description prices, and the seconds it prices it over', () => {
  const take = 'Put 2 blocks, two high, in the line. About 3.7 damage from the mobs here in the next fifteen seconds this way, the 1.2 seconds of placing it included, from 20 health. Behind it, none of them reaches it.';
  assert.deepEqual(calib.priceOf(take), { priced: 3.7, seconds: 15, health: 20 });
  const fight = 'Fight here. Estimated for these mobs: about 9.5 seconds and 21.4 damage to kill the 2 in these figures, from 20 health (more than the bot has); about 20.2 of it in the first fifteen seconds.';
  assert.deepEqual(calib.priceOf(fight), { priced: 20.2, seconds: 15, health: 20 });
  assert.deepEqual(calib.priceOf('Charge. About 5.3 damage over the 4.5 seconds to that one killed, from 12.5 health, 7 after.'), { priced: 5.3, seconds: 4.5, health: 12.5 });
  assert.deepEqual(calib.priceOf('Run. A way is found: 13 blocks, about 2.3 seconds at a run. About 7 damage from the shooters in range over those seconds, the shield down, from 20 health.'), { priced: 7, seconds: 2.3, health: 20 });
  assert.deepEqual(calib.priceOf('Eat the mutton now: about 1.6 seconds standing still. About 1.1 damage from the mobs here while it eats, from 19.1 health.'), { priced: 1.1, seconds: 1.6, health: 19.1 });
  // what the arena measured is another figure, and no figure is none
  assert.equal(calib.priceOf('Measured in the arena with the same kit, this way: about 34.7 damage in the next fifteen seconds.'), null);
  assert.equal(calib.priceOf('Box it in. Inside, only a blaze in line sees the bot.'), null);
});

const decision = (t, option, description, health = 20) => ({ at: t, kind: 'decision', snapshot: { health, dimension: 'the_nether', decision: { id: 'encounter_stance', at: new Date(t).toISOString(), path: [option], judgments: [1], options: { [option]: { description } } } } });
const hurt = (t, health) => [{ at: t, kind: 'damage', detail: { type: 'arrow', cause: 'skeleton' }, snapshot: { health } }, { at: t + 50, kind: 'observation', snapshot: { health: health - 3 } }];
const beat = (from, to, health = 20) => { const out = []; for (let t = from; t <= to; t += 1000) out.push({ at: t, kind: 'observation', snapshot: { health, dimension: 'the_nether' } }); return out; };

test('note 637: the damage taken in the window after an answer is set against the damage it priced', () => {
  const cover = 'About 6 damage from the mobs here in the next fifteen seconds this way, from 20 health.';
  const frames = [decision(at(0), 'take_cover', cover), ...beat(at(0), at(40)), ...hurt(at(5), 20)].sort((a, b) => a.at - b.at);
  const { answers, dropped } = calib.calibrate(frames);
  assert.equal(answers.length, 1);
  assert.deepEqual([answers[0].option, answers[0].priced, answers[0].taken, answers[0].capped, answers[0].died], ['take_cover', 6, 3, 6, false]);
  assert.equal(dropped.unfinished, 0);
  const t = calib.table(answers, { minN: 1 });
  assert.equal(t.rows[0].ratio, 2);
  assert.equal(t.rows[0].flag, 'OVER');
});

test('note 637: an answer is compared with health-capped price, dropped where the record ends inside its window, and kept where the bot died in it', () => {
  const fight = 'Estimated: about 9 seconds and 30 damage to kill them all, from 8 health (more than the bot has); about 25 of it in the first fifteen seconds.';
  const cut = calib.calibrate([decision(at(0), 'fight', fight, 8), ...beat(at(0), at(6), 8)]);
  assert.equal(cut.answers.length, 0);
  assert.equal(cut.dropped.unfinished, 1);
  const dead = calib.calibrate([decision(at(0), 'fight', fight, 8), ...beat(at(0), at(3), 8), ...beat(at(4), at(6), 0)]);
  assert.equal(dead.answers.length, 1);
  assert.equal(dead.answers[0].died, true);
  assert.equal(dead.answers[0].capped, 8);
  assert.equal(dead.answers[0].priced, 25);
  const noFigure = calib.calibrate([decision(at(0), 'box_here', 'Wall it in and hold it.'), ...beat(at(0), at(30))]);
  assert.equal(noFigure.dropped.noFigure, 1);
});

test('note 637: the table flags an option priced more than half over or under what it took, and marks small rows', () => {
  const rows = [];
  const add = (option, priced, taken, n) => { for (let i = 0; i < n; i++) rows.push({ option, priced, capped: priced, taken, seconds: 15, health: 20, died: false }); };
  add('take_cover', 5.6, 2.2, 6); add('corner_ambush', 2, 1.8, 6); add('retreat', 1, 4, 6); add('seal', 9, 3, 2);
  const t = calib.table(rows, { minN: 5 }), by = Object.fromEntries(t.rows.map(r => [r.option, r]));
  assert.equal(by.take_cover.flag, 'OVER'); assert.equal(by.take_cover.ratio, 2.55);
  assert.equal(by.corner_ambush.flag, '');
  assert.equal(by.retreat.flag, 'UNDER');
  assert.equal(by.seal.flag, 'OVER'); assert.equal(by.seal.few, true);
  assert.match(calib.print(t, { noFigure: 0, unfinished: 0 }, 20, 5), /seal\s+2\s+2.*OVER \(n<5\)/);
});

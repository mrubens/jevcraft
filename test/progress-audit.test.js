'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { readFlight, readBotLog, scanBotLog, firstCarried, measure, reviewLines, stanceOf, deathsInLog, resolveDeaths, cohort, cohortTable } = require('../scripts/trials/progress-audit');

// A fortress trial busy but going nowhere, as mid-242-aa-nether-1-fortress-1
// was (2026-09-27): back and forth over the same few columns it already
// walked, digging, and asked the same leg question with the same answer.
const id = '127_0_0_1-1-Jev', t0 = Date.parse('2026-09-27T20:00:00Z'), min = 60000;
const iso = t => new Date(t).toISOString();
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-'));
  const obs = (t, x, z) => JSON.stringify({ kind: 'observation', label: 'observation', snapshot: { position: { x, y: 70, z }, dimension: 'the_nether', health: 20 }, id: 1, at: iso(t) });
  const history = [], window = [];
  // The half hour before: walked the corridor x 0 to 40.
  for (let s = 0; s < 30 * 60; s += 10) history.push(obs(t0 + s * 1000, (s / 10) % 41, 0));
  const from = t0 + 30 * min;
  // The window: back and forth over x 0 to 12, every two seconds, for fifteen minutes.
  for (let s = 0; s < 15 * 60; s += 2) window.push(obs(from + s * 1000, Math.abs(((s / 2) % 24) - 12), 0));
  // Netherrack dug, a block every ten seconds, carried in full frames.
  for (let s = 0; s < 15 * 60; s += 10) window.push(JSON.stringify({ kind: 'action', label: 'mine netherrack', snapshot: { position: { x: 3, y: 70, z: 0 }, dimension: 'the_nether',
    inventory: { netherrack: s / 10, iron_sword: 1 }, goal: { step: { action: 'find_fortress' } } }, id: 2, at: iso(from + s * 1000 + 1) }));
  // The run clock: find_fortress for most of it.
  const recent = [];
  for (let s = 0; s < 15 * 60; s += 15) recent.push([from + s * 1000, s < 13 * 60 ? 'obtain_blaze_rods: find_fortress' : 'eat', 15000]);
  window.push(JSON.stringify({ kind: 'action', label: 'find fortress', snapshot: { position: { x: 5, y: 70, z: 0 }, dimension: 'the_nether',
    goal: { gameProgress: { phase: 'obtain_blaze_rods', milestones: { nether_entered: { at: t0 - 50 * min } }, clock: { recent } } } }, id: 3, at: iso(from + 14 * min) }));
  // The same question twenty times with the same answer, one a frame written twice; four none-good.
  for (let i = 0; i < 20; i++) {
    const d = { id: 'fortress_leg', at: iso(from + i * 40000), path: ['stay_in_fortress'], judgments: [{}], ...(i < 4 ? { noneGood: true } : {}),
      state: { fortressInView: { passes: 10 + i, minutesThere: 14, blazesSeenNear: 0, lastPass: { stretches: 6, reached: 2 } } } };
    const line = JSON.stringify({ kind: 'decision', label: 'stay_in_fortress', snapshot: { position: { x: 1, y: 70, z: 0 }, dimension: 'the_nether', decision: d }, id: 4, at: d.at });
    window.push(line); if (i === 5) window.push(line);
  }
  fs.writeFileSync(path.join(dir, `${id}-2026-09-27T20-00-00-000Z.jsonl`), history.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, `${id}-2026-09-27T20-30-00-000Z.jsonl`), window.sort((a, b) => JSON.parse(a).at < JSON.parse(b).at ? -1 : 1).join('\n') + '\n');
  const log = path.join(dir, 'bot.log');
  fs.writeFileSync(log, [`{"step":{"action":"x"},"at":"${iso(from - 5 * min)}"}`, '[missing option] fortress_leg: none of the options was good; took leg_east instead', '[stall] before the window',
    `{"decision":{"askedAt":"${iso(from - 2000)}"}}`, '[missing option] fortress_leg: none of the options was good; took stay_in_fortress instead', '[stall] a strike', '[still] 45s on step:find_fortress', ''].join('\n'));
  return { dir, log, from, to: from + 15 * min, historyFrom: t0 };
}

test('a fortress trial walking the same ground is flagged, with what it did', () => {
  const { dir, log, from, to, historyFrom } = fixture();
  const { frames, history } = readFlight({ identity: id, from, to, historyFrom, dir });
  assert.equal(history.length, 180);
  const m = measure({ frames, history, from, to, trial: { startedAt: iso(t0) }, botLog: readBotLog(log, from), minutes: 15, historyMinutes: 30 });
  assert.equal(m.dimension, 'nether');
  assert.equal(m.lastMilestone.name, 'nether_entered');
  assert.equal(m.minutesSinceMilestone, 95);
  assert.equal(m.top[0], 'obtain_blaze_rods: find_fortress');
  assert.equal(m.top[1], 13);
  assert.equal(m.ground.newCells, 0);
  assert.equal(m.ground.cells, 4);
  assert.ok(m.ground.walked > 400 && m.ground.net < 16, `walked ${m.ground.walked}, net ${m.ground.net}`);
  assert.equal(m.ground.dug, 89);
  assert.deepEqual(m.questions.top[0], { id: 'fortress_leg', count: 20, answer: 'stay_in_fortress', same: 20, byJev: 20, noneGood: 4 });
  assert.equal(m.questions.noneGoodShare, 0.2);
  assert.equal(m.fortress.passes, 29);
  // The bot log from the window only.
  assert.deepEqual(m.botLog.missingOption, { fortress_leg: 1 });
  assert.equal(m.botLog.stall, 1);
  assert.equal(m.botLog.still, 1);
  const ids = m.flags.map(f => f.id);
  for (const f of ['fortress', 'newGround', 'pacing', 'digging', 'oneThing', 'milestone', 'sameAnswer', 'noneGood']) assert.ok(ids.includes(f), `${f} in ${ids}`);
  assert.match(m.verdict, /at the fortress 14 min \(as of 2 min ago\), 29 passes, 2 of 6 stretches reached, blazes seen near it 0, revisiting 100% of columns — not exploring/);
  assert.match(m.verdict, /fortress_leg 20× \(20× stay_in_fortress\)/);
  // Every flag says its threshold.
  for (const f of m.flags) assert.ok(f.threshold.length > 20);
});

test('a trial covering new ground and reaching a milestone is not flagged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-'));
  const from = t0, to = t0 + 15 * min, lines = [];
  for (let s = 0; s < 15 * 60; s += 2) lines.push(JSON.stringify({ kind: 'observation', snapshot: { position: { x: s / 2, y: 64, z: 0 }, dimension: 'overworld', step: { action: s < 450 ? 'go_to_landmark' : 'mine' } }, id: 1, at: iso(from + s * 1000) }));
  lines.push(JSON.stringify({ kind: 'action', snapshot: { position: { x: 440, y: 64, z: 0 }, dimension: 'overworld', goal: { gameProgress: { milestones: { nether_entered: { at: from + 10 * min } } } } }, id: 2, at: iso(from + 14 * min) }));
  fs.writeFileSync(path.join(dir, `${id}-2026-09-27T20-00-00-000Z.jsonl`), lines.join('\n') + '\n');
  const { frames, history } = readFlight({ identity: id, from, to, historyFrom: from - 60 * min, dir });
  const m = measure({ frames, history, from, to, minutes: 15, historyMinutes: 60 });
  assert.equal(m.ground.newShare, 1);
  assert.deepEqual(m.flags, []);
  assert.match(m.verdict, /^moving: .*100% new ground, last milestone 5 min ago/);
});

// The design review's measures (note 573) on a small Nether window: a
// question answered eight times, each back in half a second with nothing
// gained; a hold in the bot log and the question asked again after it; a
// quarter of the clock on persist; a walk east over new ground toward a
// fortress and a blaze; a fortress first seen 35 min after the Nether and
// the first rod 50 min after it.
test('the review measures: quick answers, re-asks after a hold, stall share, Nether ground, firsts, the rung\'s target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-'));
  const from = t0, to = t0 + 15 * min, lines = [];
  const snap = (x, extra = {}) => ({ position: { x, y: 70, z: 0 }, dimension: 'the_nether', inventory: { netherrack: 10, ...(extra.inv || {}) }, ...extra.more });
  // Walking east a block every 9 s: 100 blocks, 26 columns new.
  for (let s = 0; s <= 900; s += 9) lines.push({ kind: 'observation', snapshot: { ...snap(s / 9), mobs: s === 0 ? [{ id: 7, name: 'blaze', at: { x: 300, y: 70, z: 0 } }] : [] }, at: iso(from + s * 1000) });
  // The first rod, carried from minute 10.
  lines.push({ kind: 'action', snapshot: snap(60, { inv: { blaze_rod: 0 } }), at: iso(from + 9 * min) });
  lines.push({ kind: 'action', snapshot: snap(67, { inv: { blaze_rod: 1 } }), at: iso(from + 10 * min) });
  // fortress_approach eight times at x 20, half a second apart, nothing gained.
  for (let i = 0; i < 8; i++) {
    const at = from + 3 * min + i * 500;
    lines.push({ kind: 'decision', snapshot: { ...snap(20), decision: { id: 'fortress_approach', at: iso(at), askedAt: iso(at - 150), path: ['other_way'], judgments: [{}] } }, at: iso(at) });
  }
  // fortress_leg twice a second apart, but a walk of five blocks between: not quick.
  for (const [i, x] of [[0, 30], [1, 35]]) {
    const at = from + 5 * min + i * 1000;
    lines.push({ kind: 'decision', snapshot: { ...snap(x), decision: { id: 'fortress_leg', at: iso(at), askedAt: iso(at - 100), path: ['leg_east'], judgments: [{}] } }, at: iso(at) });
  }
  // The run clock: 3 of 12 min on persist.
  const recent = [];
  for (let s = 0; s < 12 * 60; s += 15) recent.push([from + (s + 15) * 1000, s < 3 * 60 ? 'obtain_blaze_rods: persist' : 'obtain_blaze_rods: find_fortress', 15000]);
  lines.push({ kind: 'action', snapshot: { ...snap(99), goal: { gameProgress: { phase: 'obtain_blaze_rods', clock: { recent } } } }, at: iso(from + 14 * min) });
  lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  fs.writeFileSync(path.join(dir, `${id}-2026-09-27T20-00-00-000Z.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  // The bot log: an answer, the hold, the same answer said again, and the question asked again after it.
  const log = path.join(dir, 'bot.log');
  const said = at => `{"status":"running","decision":{"at":"${iso(at)}","askedAt":"${iso(at - 100)}","id":"fortress_approach","kind":"fortress","path":["other_way"]}}`;
  fs.writeFileSync(log, [said(from + 3 * min), '[repeat] fortress approach: other way was chosen 2 times in the last 1 second with these same facts, and nothing measurable came of any of them',
    said(from + 3 * min), said(from + 3 * min + 400), said(from + 3 * min + 400), ''].join('\n'));

  const { frames, history } = readFlight({ identity: id, from, to, historyFrom: from - 60 * min, dir });
  const firstRodAt = firstCarried({ identity: id, item: 'blaze_rod', from: from - 60 * min, dir });
  assert.equal(firstRodAt, from + 10 * min);
  const known = { gameProgress: { milestones: { nether_entered: { at: from - 40 * min } } },
    landmarks: [{ kind: 'nether_fortress', x: 200, y: 60, z: 0, dimension: 'nether', firstAt: from - 5 * min }] };
  const m = measure({ frames, history, from, to, trial: { startedAt: iso(from - 60 * min) }, botLog: readBotLog(log, from), minutes: 15, historyMinutes: 60, known, firstRodAt });
  const r = m.review;
  // 1. Seven of eight answers came back at once to nothing; the walked one did not.
  assert.deepEqual(r.quickNothing, [{ id: 'fortress_approach', quick: 7, answers: 8, per15: 7, answer: 'other_way' }]);
  // 2. One hold, one asking after it (the answer said again is not one).
  assert.deepEqual(r.reask, { holds: { fortress_approach: 1 }, reasked: { fortress_approach: 1 }, total: 1, asked: 1 });
  // 3. A quarter of the clock on persist.
  assert.equal(r.stall.share, 0.25);
  assert.deepEqual(r.stall.by, { persist: 3 });
  // 4. New Nether ground, a 15 min of Nether time.
  assert.equal(r.nether.newCells, 26);
  assert.ok(r.nether.per15 >= 20);
  // 5. The fortress 35 min after the Nether, the first rod 50.
  assert.deepEqual(r.firsts.fortress, { minutes: 35, from: 'landmark first seen' });
  assert.deepEqual(r.firsts.rod, { minutes: 50, from: 'flight record' });
  // 6. The fortress and the blaze, closer at the end than the start.
  assert.deepEqual(r.rung.targets.map(t => [t.name, t.start, t.end, t.improving]), [['the fortress', 200, 100, true], ['blazes', 300, 200, true]]);
  // Each flagged against its target, the target said.
  const flagged = Object.fromEntries(m.flags.map(f => [f.id, f]));
  for (const f of ['quickNothing', 'reaskAfterHold', 'stallShare', 'fortressSighting']) assert.ok(flagged[f], `${f} in ${Object.keys(flagged)}`);
  for (const f of ['netherGround', 'firstRod', 'rungTarget']) assert.ok(!flagged[f], `${f} not flagged`);
  for (const f of ['quickNothing', 'reaskAfterHold', 'stallShare', 'fortressSighting']) assert.match(flagged[f].threshold, /^target: /);
  assert.match(flagged.quickNothing.text, /fortress_approach 7 of 8 \(7\/15min, other_way\)/);
  const lines2 = reviewLines(m);
  assert.deepEqual(lines2.map(l => [l.id, l.met]), [['quickNothing', false], ['reaskAfterHold', false], ['stallShare', false], ['netherGround', true],
    ['fortressSighting', false], ['firstRod', true], ['rungTarget', true], ['rungTarget', true], ['waitShare', true], ['stanceRate', true], ['noneGoodStreak', null]]);
});

// Note 598's measures on a twenty-minute Nether window: waiting (a bunker
// held, a shelter, a pillar top, a stay_in_fortress walk cut short by the
// legs asked again), the stance asked every twenty seconds while nothing
// changed, and a question answered none_good seven times running with
// other questions between.
const fileTime = t => iso(t).replace(/:/g, '-').replace('.', '-');
function waitingWindow({ from, dir, identity = id }) {
  const lines = [];
  const pos = { x: 0, y: 70, z: 0 };
  const zombie = s => ({ name: 'zombie', id: 9, d: s < 6 * 60 ? 5 : 10, at: { x: s < 6 * 60 ? 5 : 10, y: 70, z: 0 } });
  // Health every 5 s: 20, and 19.5 for a minute (within 1: nothing changed).
  for (let s = 0; s < 20 * 60; s += 5) lines.push({ kind: 'observation', snapshot: { position: pos, dimension: 'the_nether', health: s >= 180 && s < 240 ? 19.5 : 20 }, at: iso(from + s * 1000) });
  // The mobs in a full frame every 30 s: the zombie 5 blocks off, then 10 from minute 6.
  for (let s = 0; s < 20 * 60; s += 30) lines.push({ kind: 'action', snapshot: { position: pos, dimension: 'the_nether', health: 20, mobs: [zombie(s)] }, at: iso(from + s * 1000 + 1) });
  const decide = (s, qid, answer, extra = {}) => lines.push({ kind: 'decision', snapshot: { position: pos, dimension: 'the_nether', health: 20, mobs: [zombie(s)],
    decision: { id: qid, at: iso(from + s * 1000 + 2), path: [answer], judgments: [{}], ...extra } }, at: iso(from + s * 1000 + 2) });
  // encounter_stance every 20 s for the first six minutes (18), twice after.
  for (let s = 10; s < 6 * 60; s += 20) decide(s, 'encounter_stance', 'fight');
  decide(8 * 60, 'turn_priority', 'work'); decide(15 * 60, 'encounter_stance', 'fight');
  // unstuck_move none_good seven times running, others between; then a good one, then two.
  for (let i = 0; i < 7; i++) { decide(61 + i * 40, 'unstuck_move', 'none_good', { noneGood: true }); decide(71 + i * 40, 'fortress_approach', 'other_way'); }
  decide(400, 'unstuck_move', 'dig_up');
  decide(420, 'unstuck_move', 'none_good', { noneGood: true }); decide(440, 'unstuck_move', 'none_good', { noneGood: true });
  // The legs: stay_in_fortress at minute 10, the legs asked again at minute 12.
  decide(600, 'fortress_leg', 'stay_in_fortress'); decide(720, 'fortress_leg', 'leg_east');
  // The run clock, 15 s entries: 4 min hold_bunker, 2 wait in shelter, 1 on a pillar top, the rest find_fortress.
  const recent = [];
  for (let s = 15; s <= 20 * 60; s += 15) recent.push([from + s * 1000, s <= 240 ? 'obtain_blaze_rods: hold_bunker' : s <= 360 ? 'wait_in_shelter' : s <= 420 ? 'pillar_hold' : 'obtain_blaze_rods: find_fortress', 15000]);
  // Carried in two frames, each with what came before it.
  lines.push({ kind: 'action', snapshot: { position: pos, dimension: 'the_nether', health: 20, goal: { gameProgress: { phase: 'obtain_blaze_rods', clock: { recent: recent.filter(e => e[0] <= from + 10 * min) } } } }, at: iso(from + 10 * min + 3) });
  lines.push({ kind: 'action', snapshot: { position: pos, dimension: 'the_nether', health: 20, goal: { gameProgress: { phase: 'obtain_blaze_rods', clock: { recent: recent.filter(e => e[0] > from + 5 * min) } } } }, at: iso(from + 20 * min - 1) });
  lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  fs.writeFileSync(path.join(dir, `${identity}-${fileTime(from)}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
}

test('note 598: waiting share, stance askings while nothing changed, the longest none-good run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-'));
  const from = t0, to = t0 + 20 * min;
  waitingWindow({ from, dir });
  const { frames, history } = readFlight({ identity: id, from, to, historyFrom: from, dir });
  const m = measure({ frames, history, from, to, trial: { startedAt: iso(from) }, minutes: 20, historyMinutes: 60 });
  const r = m.review;
  // Both clock frames joined: all twenty minutes clocked.
  assert.equal(m.clockedMinutes, 20);
  // 4 + 2 + 1, and the two minutes of the walk before the legs were asked again: 9 of 20.
  assert.deepEqual(r.waits, { minutes: 9, clocked: 20, share: 0.45, by: { hold_bunker: 4, wait_in_shelter: 2, stay_in_fortress: 2, pillar_hold: 1 } });
  // Nothing changed for six minutes (health 19.5 is within 1), 18 askings; then the zombie
  // five blocks farther, fourteen minutes, 2 askings: 20 in 20 min.
  assert.equal(r.stance.asks, 20);
  assert.equal(r.stance.stillAsks, 20);
  assert.equal(r.stance.perMinute, 1);
  assert.deepEqual([r.stance.worst.asks, r.stance.worst.perMinute], [18, 3]);
  // Seven in a row to unstuck_move, the other questions between not breaking it.
  assert.equal(r.noneGoodStreak.id, 'unstuck_move');
  assert.equal(r.noneGoodStreak.run, 7);
  const flagged = Object.fromEntries(m.flags.map(f => [f.id, f]));
  assert.ok(flagged.waitShare && flagged.stanceRate, Object.keys(flagged).join(','));
  assert.match(flagged.waitShare.text, /45%, 9 of 20 min \(hold bunker 4, wait in shelter 2, stay in fortress 2, pillar hold 1\)/);
  assert.match(flagged.stanceRate.threshold, /^target: under 1/);
  assert.ok(!flagged.noneGoodStreak);
  assert.match(reviewLines(m).find(l => l.id === 'noneGoodStreak').text, /7 in a row to unstuck_move/);
});

test('note 598: a change in the nearest mob or in health starts a new stretch; short stretches are not counted', () => {
  const obs = t => ({ t, kind: 'observation', snapshot: { position: { x: 0, y: 70, z: 0 }, dimension: 'overworld', health: 20 } });
  const frames = [];
  // The skeleton a block and a half closer every 20 s, over two blocks every 40 s: stretches of 40 s, none counted.
  for (let s = 0; s < 300; s += 20) frames.push({ ...obs(t0 + s * 1000), kind: 'action', snapshot: { ...obs(0).snapshot, mobs: [{ d: 30 - s / 20 * 1.5 }] } });
  const s = stanceOf({ frames, decs: frames.map(f => ({ id: 'encounter_stance', at: f.t + 1 })) });
  assert.equal(s.asks, 15);
  assert.equal(s.stillAsks, 0);
  assert.equal(s.perMinute, null);
  // Health down 3 halfway through an otherwise still two minutes: two stretches of a minute, each counted.
  const still = [];
  for (let s = 0; s <= 120; s += 5) still.push({ ...obs(t0 + s * 1000), snapshot: { ...obs(0).snapshot, health: s < 60 ? 20 : 17 } });
  const s2 = stanceOf({ frames: still, decs: [10, 20, 70].map(x => ({ id: 'turn_priority', at: t0 + x * 1000 })) });
  assert.equal(s2.stillAsks, 3);
  assert.equal(s2.stillMinutes, 2);
  assert.equal(s2.worst.asks, 2);
});

test('note 598: deaths from the server log, the day carried past midnight and settled by the trial', () => {
  const text = ['[23:50:00] [Server thread/INFO]: Preparing level "mid-1"', '[23:59:30] [Server thread/INFO]: Jev was slain by Piglin using [Golden Sword]',
    '[00:10:00] [Server thread/INFO]: Jev tried to swim in lava', '[00:20:00] [Server thread/INFO]: Preparing level "mid-2"', '[00:30:00] [Server thread/INFO]: Jev was shot by Skeleton'].join('\n');
  const deaths = deathsInLog(text, '2026-09-27-3.log.gz', 0);
  assert.deepEqual(deaths.map(d => [d.world, d.cause, d.t]), [
    ['mid-1', 'was slain by Piglin', new Date(2026, 8, 27, 23, 59, 30).getTime()],
    ['mid-1', 'tried to swim in lava', new Date(2026, 8, 28, 0, 10, 0).getTime()],
    ['mid-2', 'was shot by Skeleton', new Date(2026, 8, 28, 0, 30, 0).getTime()]]);
  // latest.log: the day counted back from its last change.
  const latest = deathsInLog(text, 'latest.log', new Date(2026, 8, 28, 1, 0, 0).getTime());
  assert.equal(latest[0].t, new Date(2026, 8, 27, 23, 59, 30).getTime());
  // A day wrong by one is moved into its trial's span; a world with no trial is dropped.
  const trials = [{ world: 'mid-1', start: new Date(2026, 8, 26, 23, 0).getTime(), end: new Date(2026, 8, 27, 1, 0).getTime() }];
  assert.deepEqual(resolveDeaths(deaths, trials).map(d => d.t), [new Date(2026, 8, 26, 23, 59, 30).getTime(), new Date(2026, 8, 27, 0, 10).getTime()]);
});

test('note 598: a bot log scanned whole, its holds and re-asks split at the deploy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-'));
  const log = path.join(dir, 'bot.log'), at = t0 + 10 * min;
  const said = t => `{"status":"running","decision":{"at":"${iso(t)}","askedAt":"${iso(t - 100)}","id":"fortress_approach","kind":"fortress","path":["other_way"]}}`;
  const hold = '[repeat] fortress approach: other way was chosen 2 times in the last 1 second with these same facts, and nothing measurable came of any of them';
  fs.writeFileSync(log, [said(t0 + min), hold, said(t0 + min + 500), said(t0 + min + 900), '[stall] one', said(at + min), hold, said(at + min + 500), ''].join('\n'));
  const { before, after } = scanBotLog(log, { from: t0, split: at, chunk: 64 });
  assert.deepEqual([before.repeat, before.reaskAfterHold, before.stall], [{ fortress_approach: 1 }, { fortress_approach: 2 }, 1]);
  assert.deepEqual([after.repeat, after.reaskAfterHold, after.stall], [{ fortress_approach: 1 }, { fortress_approach: 1 }, 0]);
  // The tail reader counts the same from the deploy on.
  assert.deepEqual(readBotLog(log, at).reaskAfterHold, { fortress_approach: 1 });
});

test('note 611: a re-ask after a hold is the held answer offered again from where it was held; the question asked with it left out, or from new ground, is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-'));
  const log = path.join(dir, 'bot.log');
  const tree = held => JSON.stringify({ continue_request: { description: 'c' }, obtain_food: { description: 'f', children: { ...(held ? { return_for_food: { description: 'r' } } : {}), hoglin_food: { description: 'h' } } } });
  const said = (t, { held = true, x = -204.5 } = {}) => `{"status":"running","decision":{"at":"${iso(t)}","askedAt":"${iso(t - 100)}","id":"survival_priority","kind":"survival","path":["obtain_food","return_for_food"],"options":${tree(held)}},"position":{"x":${x},"y":61,"z":-200.5}}`;
  const hold = '[repeat] survival priority: obtain food/return for food was chosen 2 times in the last 1 second with these same facts, and nothing measurable came of any of them';
  // mid-243-af-fortress-4 at 14:24:07: the hold; then the question with the held answer left out, from six blocks
  // on with it offered, and from where it was held with it offered.
  fs.writeFileSync(log, [said(t0), hold, said(t0 + 500, { held: false }), said(t0 + 900, { x: -198.5 }), said(t0 + 1300), ''].join('\n'));
  const r = readBotLog(log, t0 - min);
  assert.deepEqual(r.askedAfterHold, { survival_priority: 3 });
  assert.deepEqual(r.reaskAfterHold, { survival_priority: 1 });
  const { after } = scanBotLog(log, { from: t0 - min, split: t0 - 1, chunk: 64 });
  assert.deepEqual([after.askedAfterHold, after.reaskAfterHold], [{ survival_priority: 3 }, { survival_priority: 1 }]);
});

test('note 598: the cohort, before and after a deploy, across the trial records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-'));
  const flight = path.join(root, 'flight');
  fs.mkdirSync(flight);
  fs.mkdirSync(path.join(root, 'artifacts', 'midgame'), { recursive: true });
  fs.mkdirSync(path.join(root, '.clean-run', 'logs'), { recursive: true });
  // Two trials on one port: the waiting window above, 20 min, then one after the deploy, moving, 10 min.
  const a = t0, b = t0 + 30 * min, at = t0 + 25 * min;
  waitingWindow({ from: a, dir: flight, identity: '127_0_0_1-25581-Jev' });
  const lines = [];
  for (let s = 0; s < 600; s += 5) lines.push({ kind: 'observation', snapshot: { position: { x: s, y: 64, z: 0 }, dimension: 'overworld', health: 20, step: { action: 'mine' } }, at: iso(b + s * 1000) });
  fs.writeFileSync(path.join(flight, `127_0_0_1-25581-Jev-${fileTime(b)}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const record = (world, start, minutes, reached) => fs.writeFileSync(path.join(root, 'artifacts', 'midgame', `${world}.json`), JSON.stringify({ world, port: 25581, source: '.trial-sources/first-days-1', startedAt: iso(start),
    verdict: { from: iso(start), minutes, done: true, reachedAtMinute: reached, most: { blazeRods: 0 } } }));
  record('mid-1', a, 20, { nether: 5, fortress: 12 });
  record('mid-2', b, 10, {});
  // A death in each, the server's clock local.
  const hms = t => { const d = new Date(t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':'); };
  const logFile = path.join(root, '.clean-run', 'logs', 'latest.log');
  fs.writeFileSync(logFile, [`[${hms(a)}] [Server thread/INFO]: Preparing level "mid-1"`, `[${hms(a + 15 * min)}] [Server thread/INFO]: Jev was slain by Piglin`,
    `[${hms(b)}] [Server thread/INFO]: Preparing level "mid-2"`, `[${hms(b + 5 * min)}] [Server thread/INFO]: Jev tried to swim in lava`, ''].join('\n'));
  fs.utimesSync(logFile, new Date(b + 6 * min), new Date(b + 6 * min));
  const c = cohort({ at, root, dir: flight, now: b + 60 * min });
  assert.equal(c.trials, 2);
  assert.deepEqual([c.before.trials, c.after.trials], [1, 1]);
  assert.equal(c.before.waitShare.share, 0.45);
  assert.equal(c.before.waitShare.met, false);
  assert.equal(c.after.waitShare.share, 0);
  assert.equal(c.before.stanceRate.perMinute, 1);
  assert.equal(c.before.noneGood.longestRun.run, 7);
  assert.deepEqual(c.before.deaths.byCause, { 'was slain by Piglin': { n: 1, perHour: 3 } });
  assert.deepEqual(c.after.deaths.byCause, { 'tried to swim in lava': { n: 1, perHour: 6 } });
  assert.deepEqual(c.before.firsts.nether, { eligible: 1, reached: 1, median: 5, min: 5, max: 5, notReachedMedianMinutes: null });
  assert.equal(c.before.firsts.fortress.median, 7);
  assert.deepEqual(c.after.firsts.nether, { eligible: 1, reached: 0, median: null, min: null, max: null, notReachedMedianMinutes: 10 });
  // Trials begun after a time only.
  assert.equal(cohort({ at, since: a + min, root, dir: flight, now: b + 60 * min }).trials, 1);
  assert.match(cohortTable(c), /waitShare\s+45% \(9 min\)\s+OVER\s+0% \(0 min\)\s+ok/);
});

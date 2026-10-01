#!/usr/bin/env node
'use strict';
// Climbs to open sky for wood, and what each brought back (note 787). Per
// fresh trial (scripts/rung-time.js's reading: from its start to its first
// Nether frame, Jev-down frames left out, scripts/lib/jev-down.js): every
// climb spell (an ascend_to_surface step, or the return_to_surface survival
// action while current, frames under a minute apart), and among them the
// climbs for wood: the question answered in the two minutes before named
// wood (a log as surface_trip's need, upkeep's wood_reserve, the crossing
// kit's top_up_wood, climb_out's wood_first), or logs' worth carried rose
// within five minutes of the climb's end. For each: the minutes, the blocks
// risen, the logs' worth carried at its start and the most carried from
// then until the bot was back down (20 blocks under the climb's top and
// under y 50) or 20 minutes, and whether another climb for wood came after
// it in the trial.
//
// The surface's pace for logs: the seconds of frames on a log step (mine,
// wood_reserve) at y 50 or above over the logs' worth gained in them.
//
// Replayed under note 787 (an upper bound on what it saves, a lower bound
// on what it costs): at each climb for wood, the trip takes the wood owed
// (at least the WOOD_RESERVE, six logs' worth, src/work.js; the rungs'
// own wood is not in the record and is left out, so the replay takes less
// than the rule would). The logs taken past what the bot carried at its
// most cost the surface's measured seconds a log. A later climb for wood is
// not made when the logs' worth recorded at its start plus the surplus the
// trip left covers the need it was for (its stated count of logs, or the
// reserve for upkeep's wood), the surplus then less what that climb
// gained. A trip that cut no log (the climb stopped short, or the bot left
// the surface first) takes nothing more. Its minutes are saved; the walk back down after it is not counted.
//
//   node scripts/wood-trips.js [--since 2026-09-30T12:00:00Z] [--to ISO] [--json]
// JEV_ROOT reads another checkout's records (from a worktree).
const path = require('path');
const RT = require('./rung-time');
const audit = require('./trials/progress-audit');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const has = name => args.includes(name);
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const MINUTE = 60000, GAP_MS = 60000, CURRENT_MS = 8000;
const round = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;
const RESERVE = 6;

const units = inv => inv ? Object.entries(inv).reduce((n, [k, v]) => n + (/_log$|_stem$|_hyphae$|_wood$/.test(k) ? v : /_planks$/.test(k) ? v / 4 : k === 'stick' ? v / 8 : 0), 0) : null;
const SKIP = /^(climb_out|turn_priority|encounter_stance|shot_answer|body_way|unstuck_move|combat_kit)$/;
const WOOD_WHY = /surface_trip:climb .*\blog\b|surface_trip:climb wood|upkeep:wood_reserve|top_up_wood|wood_first|wood_owed/;

function trialClimbs(frames) {
  const climbs = [];
  let cur = null, sa = null;
  const asks = [];
  for (const f of frames) {
    if (f.sa) sa = f.sa;
    if (f.ask && !f.ask.stale && !SKIP.test(f.ask.id)) asks.push({ t: f.t, why: `${f.ask.id}:${f.ask.answer.split('/')[0]}${f.ask.need ? ` ${f.ask.need}` : ''}` });
    const climbing = f.step?.a === 'ascend_to_surface' || (sa?.a === 'return_to_surface' && f.t - sa.at < CURRENT_MS);
    if (!climbing) continue;
    if (cur && f.t - cur.last <= GAP_MS) { cur.last = f.t; if (f.p) cur.top = Math.max(cur.top, f.p.y); continue; }
    if (cur) climbs.push(cur);
    const why = asks.filter(a => a.t <= f.t && f.t - a.t < 2 * MINUTE).at(-1);
    cur = { t: f.t, last: f.t, from: f.p?.y ?? null, top: f.p?.y ?? -Infinity, why: why ? why.why : 'none asked' };
  }
  if (cur) climbs.push(cur);
  const invAt = t => { let inv = null; for (const f of frames) { if (f.t > t) break; if (f.inv) inv = f.inv; } return inv; };
  for (const c of climbs) {
    c.minutes = (c.last - c.t) / MINUTE;
    c.rose = Number.isFinite(c.top) && c.from !== null ? Math.max(0, Math.round(c.top - c.from)) : 0;
    const back = frames.find(f => f.t > c.last && f.t < c.last + 20 * MINUTE && f.p && f.p.y < c.top - 20 && f.p.y < 50);
    c.backDown = !!back;
    c.start = units(invAt(c.t)) ?? 0;
    const until = back ? back.t : c.last + 20 * MINUTE;
    c.most = Math.max(c.start, ...frames.filter(f => f.t > c.t && f.t < until && f.inv).map(f => units(f.inv)));
    const after = frames.filter(f => f.t > c.last && f.t < c.last + 5 * MINUTE && f.inv).map(f => units(f.inv));
    c.gainedAfter = after.length ? Math.max(...after) - (units(invAt(c.last)) ?? 0) : 0;
    c.wood = WOOD_WHY.test(c.why) || c.gainedAfter >= 1;
    c.cutLog = c.most >= c.start + 0.5;
    // What came next: the first question answered within half a minute of
    // its end (the climb's own and the turn's left out), else the next step.
    const nextAsk = asks.find(a => a.t > c.last - 5000 && a.t <= c.last + 30000 && !/^surface_trip:climb/.test(a.why));
    const nextStep = frames.find(f => f.t > c.last && f.step && f.step.a !== 'ascend_to_surface')?.step?.a || null;
    c.endedBy = nextAsk ? nextAsk.why.replace(/ .*/, '') : `step ${nextStep}`;
    const m = c.why.match(/surface_trip:climb (\d+) [a-z_ ]*log/);
    c.need = m ? Number(m[1]) : /wood_reserve|top_up_wood/.test(c.why) ? RESERVE : 1;
  }
  return climbs;
}

// Seconds a log at the surface: frames on a log step at y 50 or above
// over the logs' worth gained in them (the walk to the tree and the search
// counted); and within a trunk: the gaps between single logs gained under
// 30 s apart at y 50 or above.
function logPace(frames) {
  let ms = 0, gained = 0, last = null, lastLogs = null, lastGainT = null;
  const gaps = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const f = frames[i];
    if (f.inv) {
      const u = units(f.inv); if (last !== null && u > last && f.onLog) gained += u - last; last = u;
      const logs = Object.entries(f.inv).filter(([k]) => /_log$|_stem$/.test(k)).reduce((n, [, v]) => n + v, 0);
      if (lastLogs !== null && logs === lastLogs + 1 && f.p?.y >= 50) { if (lastGainT && f.t - lastGainT <= 30000) gaps.push((f.t - lastGainT) / 1000); lastGainT = f.t; }
      lastLogs = logs;
    }
    const onLog = /^(mine|wood_reserve)$/.test(f.step?.a || '') && /_log$|_stem$/.test(f.step?.item || '') && f.p && f.p.y >= 50;
    frames[i + 1].onLog = onLog;
    const dt = frames[i + 1].t - f.t;
    if (onLog && dt > 0 && dt <= GAP_MS) ms += dt;
  }
  return { ms, gained, gaps };
}

// The descent back down after a climb, at the bot's measured pace (levels.js).
const DOWN_S = require('../src/levels').LEVEL_RECORD.downSecondsABlock;
// `more`: logs past the most carried the trip takes, at most; `walkS`: the
// seconds of walking to a further tree each four logs past the first trunk.
function replay(climbs, { secondsALog, more = Infinity, walkS = 0 } = {}) {
  let surplus = 0, saved = 0, savedDown = 0, avoided = 0, extraLogs = 0, cost = 0, trips = 0;
  for (const c of climbs.filter(x => x.wood)) {
    if (surplus > 0 && c.start + surplus >= c.need) {
      saved += c.minutes; avoided++;
      if (c.backDown) savedDown += c.rose * DOWN_S / 60;
      surplus = Math.max(0, surplus - Math.max(0, c.most - c.start)); continue;
    }
    // The trip takes the wood owed: at least the reserve, as far as `more`
    // allows; only a trip that cut a log at all was at a tree to take more.
    trips++;
    if (!(c.most >= c.start + 0.5)) { surplus = 0; continue; }
    const extra = Math.min(more, Math.max(0, RESERVE - c.most));
    extraLogs += extra; surplus = extra;
    cost += (extra * secondsALog + Math.floor(Math.max(0, extra - 4) / 4 + (extra > 4 ? 1 : 0)) * walkS) / 60;
  }
  return { saved, savedDown, avoided, extraLogs, costMinutes: cost, trips };
}

function main() {
  const since = Date.parse(opt('--since', '2026-09-30T12:00:00Z'));
  const to = opt('--to', null) ? Date.parse(opt('--to', null)) : Infinity;
  const trials = audit.trialRecords({ since: since - 1, flight: FLIGHT }).filter(t => t.port && t.start < to && !/\/stages\/(fortress|nether)\//.test(t.source || ''));
  const filesBy = new Map();
  const rows = [];
  let paceMs = 0, paceGained = 0;
  const gaps = [];
  for (const tr of trials) {
    if (!filesBy.has(tr.port)) filesBy.set(tr.port, RT.portFiles(tr.port));
    const end = Math.min(tr.end, to);
    const all = RT.readTrial({ port: tr.port, start: tr.start, end, files: filesBy.get(tr.port) });
    const nether = all.find(f => f.dim === 'nether');
    const frames = all.filter(f => f.t < (nether ? nether.t : end) && !f.jd);
    if (frames.length < 60) continue;
    // The step stands until the next names another (observations carry none).
    let step = null;
    for (const f of frames) { if (f.step) step = f.step; else f.step = step; }
    const played = frames.reduce((n, f, i) => { const d = (frames[i + 1]?.t ?? f.t) - f.t; return n + (d > 0 && d <= GAP_MS ? d : 0); }, 0) / MINUTE;
    const pace = logPace(frames);
    paceMs += pace.ms; paceGained += pace.gained; gaps.push(...pace.gaps);
    const cut = !nether && (/cut: /.test(JSON.stringify(tr.verdict?.reasons || '')) || played >= 59);
    rows.push({ world: tr.world, port: tr.port, source: RT.sourceOf(tr), reached: !!nether, cut, played, climbs: trialClimbs(frames) });
  }
  const secondsALog = paceGained ? paceMs / 1000 / paceGained : 15;
  gaps.sort((a, b) => a - b);
  const trunkS = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 10;
  // Walks to a further tree: 16 blocks at the arrived pace of levels.js.
  const walkS = Math.round(16 / require('../src/levels').LEVEL_RECORD.arrivedBlocksAMinute * 60);
  const variants = { trunk: { secondsALog: trunkS, more: 4 }, owed: { secondsALog: trunkS, walkS }, measured: { secondsALog } };
  const report = (label, rs) => {
    const climbs = rs.flatMap(r => r.climbs), wood = climbs.filter(c => c.wood);
    const repeats = rs.flatMap(r => r.climbs.filter(c => c.wood).slice(1));
    const q = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? round(s[Math.floor(s.length / 2)]) : null; };
    const woodMin = wood.reduce((n, c) => n + c.minutes, 0);
    const replayed = Object.fromEntries(Object.entries(variants).map(([k, v]) => {
      const R = rs.map(r => replay(r.climbs, v));
      const saved = R.reduce((n, x) => n + x.saved, 0), down = R.reduce((n, x) => n + x.savedDown, 0), cost = R.reduce((n, x) => n + x.costMinutes, 0);
      return [k, { avoided: R.reduce((n, x) => n + x.avoided, 0), savedMinutes: round(saved), savedDownMinutes: round(down), extraLogs: round(R.reduce((n, x) => n + x.extraLogs, 0)), costMinutes: round(cost), netMinutes: round(saved + down - cost), woodMinutesAfter: round(woodMin - saved + cost) }];
    }));
    return { label, trials: rs.length, played: round(rs.reduce((n, r) => n + r.played, 0)), climbs: climbs.length, climbMinutes: round(climbs.reduce((n, c) => n + c.minutes, 0)),
      woodClimbs: wood.length, woodMinutes: round(woodMin), woodRose: wood.reduce((n, c) => n + c.rose, 0), trialsWithWoodClimbs: rs.filter(r => r.climbs.some(c => c.wood)).length,
      backDown: wood.filter(c => c.backDown).length, medianStart: q(wood.map(c => c.start)), medianMost: q(wood.map(c => c.most)), underThree: wood.filter(c => c.most < 3).length,
      repeats: repeats.length, repeatMinutes: round(repeats.reduce((n, c) => n + c.minutes, 0)), replayed };
  };
  const out = { since: new Date(since).toISOString(), secondsALog: round(secondsALog), trunkSeconds: round(trunkS), trunkGaps: gaps.length, walkSeconds: walkS, paceMinutes: round(paceMs / MINUTE), paceLogs: round(paceGained),
    all: report('all fresh trials', rows), cut: report('cut without the Nether', rows.filter(r => r.cut)), reached: report('reached the Nether', rows.filter(r => r.reached)),
    byWorld: Object.fromEntries([...new Set(rows.map(r => r.source))].sort().map(w => [w, report(w, rows.filter(r => r.source === w))])) };
  if (has('--json')) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log(`Logs at the surface: ${out.secondsALog} s a log's worth on log steps at y 50 or above, the walk and search counted (${out.paceLogs} logs' worth in ${out.paceMinutes} min); within a trunk ${out.trunkSeconds} s a log (median of ${out.trunkGaps} single logs under 30 s apart); a further tree 16 blocks off ${out.walkSeconds} s.`);
  for (const r of [out.all, out.cut, out.reached, ...Object.values(out.byWorld)]) {
    console.log(`\n${r.label}: ${r.trials} trials, ${r.played} played min; ${r.climbs} climbs, ${r.climbMinutes} min`);
    console.log(`  for wood: ${r.woodClimbs} climbs on ${r.trialsWithWoodClimbs} trials, ${r.woodMinutes} min, ${r.woodRose} blocks risen; ${r.backDown} back down within 20 min; logs' worth carried at the start median ${r.medianStart}, at the most ${r.medianMost}; ${r.underThree} never carried 3; ${r.repeats} after another climb for wood in the trial (${r.repeatMinutes} min)`);
    for (const [k, x] of Object.entries(r.replayed)) console.log(`  replayed under note 787 (${k === 'trunk' ? 'the trunk in reach, up to 4 more logs, at the trunk pace' : k === 'owed' ? 'the wood owed, at the trunk pace and a walk to a further tree each four logs' : 'the wood owed, at the surface\'s whole measured pace'}): ${x.avoided} climbs for wood not made (${x.savedMinutes} min, and ${x.savedDownMinutes} min of the way back down), ${x.extraLogs} more logs taken on the trips made (${x.costMinutes} min); net ${x.netMinutes} min; wood-climb minutes ${r.woodMinutes} -> ${x.woodMinutesAfter}`);
  }
}

module.exports = { trialClimbs, replay, units, logPace };
if (require.main === module) main();

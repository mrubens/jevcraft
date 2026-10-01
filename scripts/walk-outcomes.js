'use strict';
// Walks and what came of them (note 785). Read from the flight records;
// read-only.
//   node scripts/walk-outcomes.js [--since 2026-09-30T12:00Z] [--until ...] [--port 25589] [--dir .bot-state/flight] [--json] [--top 12]
//
// From the records written since note 785 every walk's end is its own frame
// (`walk_end`: kind, goal, where it began, blocks walked, seconds), and a
// record that has them is read by them. Before that a walk is read back
// from the once-a-second frames:
//   a walk      a run of frames with the pathfinder moving (`pathing`), from
//               the first to the first frame it is not; a failure frame with
//               no such run about it (a search that found nothing, a walk
//               refused) is a walk that never moved;
//   its kind    from the failure frames within a second before its start to
//               three seconds after its end, the first that applies: stall
//               (navigation_stall), search timeout ("Took to long to decide
//               path to goal!", the pathfinder's own), no route (no_route,
//               "No route", "No path to the goal!"), refused (note 777's
//               third-walk ban), timed out (the walk's own time), ended short,
//               no nearer, interrupted (a threat, a preemption, the air);
//               else arrived;
//   its target  the failure's own goal where it says one (the stall's and the
//               no route's detail, the coordinates in the error), else the
//               step's destination; an arrival's is where it ended.
// Jev-down time (frames carrying jevDown) is off the clock.
// Measures: walks a bot-hour by kind; blocks walked against net displacement
// (ten-minute windows, frame to frame under 10 blocks, one dimension); a
// failed walk's target walked to again within ten minutes (within 4 blocks,
// from within 16), asked between (a question answered) or not, and how that
// went; minutes inside failed walks. And the rules replayed (failed-places.js
// read and pacingSays, note 785): of the walks to a place a way there had
// failed to, how many had it said and resting before (what the ledger and
// the stall memory saw) and after (every walk's end); the failed walks the
// pacing rule would not have walked, and their minutes.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', '2026-09-30T12:00:00Z'));
const until = Date.parse(arg('until', new Date().toISOString()));
const port = arg('port');
const top = Number(arg('top', 12));
const dir = arg('dir', path.join(ROOT, '.bot-state', 'flight'));
const AGAIN_MS = 10 * 60000, SAME_TARGET = 4, FROM = 16, HERE = 4, WINDOW_MS = 10 * 60000;
const FAILED = new Set(['stall', 'search_timeout', 'no_route', 'refused', 'timed_out', 'ended_short', 'no_nearer']);
// The failure kinds the ledger's failed ways and the stall memory read before
// note 785 (failed-places.js WAY_FAILED, skills.js stallsToward), where the
// step's failure reached the ledger: a stall always (its own memory); a no
// route, a timed-out walk or one that came no nearer only where the step
// failed with it (an error frame); a search timeout never.
const OLD_SEEN = new Set(['stall', 'no_route', 'timed_out', 'no_nearer', 'refused']);
// Questions that are the body's, not the work's: a fight's stance is no
// question about where to walk.
const BODY_Q = /^(encounter_stance|turn_priority|shot_answer|ranged_response|hunt_target|combat_kit)$/;

const fileStart = f => { const m = f.match(/Jev-(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d+)Z/); return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) : NaN; };
const files = fs.readdirSync(dir).filter(f => /\.jsonl$/.test(f) && (!port || f.includes(`-${port}-`)))
  .filter(f => { const t = fileStart(f); return Number.isFinite(t) && t <= until && t >= since - 6 * 3600000; }).sort();
const d3 = (a, b) => Number.isFinite(a.y) && Number.isFinite(b.y) ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Math.hypot(a.x - b.x, a.z - b.z);
const num = '(-?[\\d.]+(?:e-?\\d+)?)';
const POS = new RegExp(`"position":\\{"x":${num},"y":${num},"z":${num}\\}`);
const DEST = new RegExp(`"destination":\\{"x":${num},"y":${num},"z":${num}`);
const COORDS = /\((-?\d+), (-?\d+), (-?\d+)\)/;

function kindOfError(label) {
  if (/Took to long to decide path/.test(label)) return 'search_timeout';
  if (/The walk is not begun/.test(label)) return 'refused';
  if (/navigation timed out without reaching new ground/.test(label)) return 'stall';
  if (/No route from here|No path to the goal|no route to|No existing route/i.test(label)) return 'no_route';
  if (/navigation timed out/.test(label)) return 'timed_out';
  if (/Navigation ended before reaching/.test(label)) return 'ended_short';
  if (/no nearer|not gaining|without getting closer/i.test(label)) return 'no_nearer';
  if (/^(Threat nearby|Preempted|Low air|task cancelled)/.test(label)) return 'interrupted';
  return null;
}
const RANK = ['stall', 'search_timeout', 'no_route', 'refused', 'timed_out', 'ended_short', 'no_nearer', 'interrupted'];

async function readFile(file) {
  const frames = [], events = [], decisions = [], recorded = [];
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, file)), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const atM = line.match(/"at":"(\d{4}-[^"]+)"\}\s*$/);
    const t = atM ? Date.parse(atM[1]) : NaN;
    if (!Number.isFinite(t) || t < since || t > until) continue;
    const head = line.slice(0, 60);
    const km = head.match(/"kind":"(\w+)"/); const kind = km ? km[1] : '';
    if (kind === 'error' && head.includes('TypeSafe 40')) continue;
    const pm = line.match(POS);
    const pos = pm ? { x: +pm[1], y: +pm[2], z: +pm[3] } : null;
    const dm = line.match(/"dimension":"([^"]+)"/);
    const dim = dm ? dm[1].replace(/^minecraft:/, '') : null;
    const down = line.includes('"jevDown":{');
    const pathing = /"pathing":true/.test(line);
    if (pos) frames.push({ t, pos, dim, down, pathing });
    if (kind === 'walk_end') { try { const f = JSON.parse(line); recorded.push({ ...f.detail, t, down }); } catch (_) { /* torn line */ } continue; }
    if (kind === 'decision') {
      const im = line.match(/"decision":\{"at":"[^"]*","askedAt":"[^"]*","id":"(\w+)"/);
      const pa = line.match(/"path":\["([^"]+)"/);
      if (im && !line.includes('"stale":true')) decisions.push({ t, id: im[1], choice: pa ? pa[1] : null, pos });
      continue;
    }
    if (kind === 'navigation_stall' || kind === 'no_route') {
      let detail = null; try { detail = JSON.parse(line).detail; } catch (_) { detail = null; }
      const g = detail?.goal;
      const target = g && Number.isFinite(g.x) && Number.isFinite(g.z) ? { x: g.x, y: Number.isFinite(g.y) ? g.y : null, z: g.z } : null;
      events.push({ t, kind: kind === 'navigation_stall' ? 'stall' : 'no_route', target, from: detail?.from || null, pos, dim, why: kind });
      continue;
    }
    if (kind === 'error') {
      const lm = line.match(/"label":"((?:[^"\\]|\\.)*)"/);
      const label = lm ? lm[1] : '';
      const k = kindOfError(label);
      if (!k) continue;
      const cm = label.match(COORDS), dd = line.match(DEST);
      const target = cm ? { x: +cm[1], y: +cm[2], z: +cm[3] } : dd ? { x: +dd[1], y: +dd[2], z: +dd[3] } : null;
      events.push({ t, kind: k, target, pos, dim, why: label.slice(0, 120), error: true });
    }
  }
  return { file, frames, events, decisions, recorded };
}

// The walks of one record, from its frames and failure frames.
function walksOf({ frames, events }) {
  const runs = [];
  let run = null, prev = null;
  for (const f of frames) {
    if (run && (!f.pathing || f.t - prev.t > 5000 || f.dim !== run.dim)) { run.end = f.t; run.to = f.pathing ? prev.pos : f.pos; runs.push(run); run = null; }
    if (f.pathing && !run) run = { start: prev && f.t - prev.t <= 2000 ? prev.t : f.t, from: prev && f.t - prev.t <= 2000 ? prev.pos : f.pos, dim: f.dim, blocks: 0, events: [], down: f.down };
    if (run && prev) { const d = d3(prev.pos, f.pos); if (d < 10) run.blocks += d; }
    prev = f;
  }
  if (run && prev) { run.end = prev.t; run.to = prev.pos; runs.push(run); }
  const loose = [];
  let i = 0;
  for (const e of events.sort((a, b) => a.t - b.t)) {
    while (i < runs.length && runs[i].end + 3000 < e.t) i++;
    const r = runs.slice(Math.max(0, i - 1), i + 2).find(r => e.t >= r.start - 1000 && e.t <= r.end + 3000);
    if (r) r.events.push(e); else loose.push(e);
  }
  const walks = [];
  const pick = list => RANK.find(k => list.some(e => e.kind === k)) || 'arrived';
  for (const r of runs) {
    const kind = pick(r.events);
    const ev = r.events.find(e => e.kind === kind && e.target) || r.events.find(e => e.target);
    walks.push({ start: r.start, end: r.end, from: r.events.find(e => e.from)?.from || r.from, to: r.to, dim: r.dim, kind, target: kind === 'arrived' ? r.to : ev?.target || null,
      blocks: r.blocks, ms: r.end - r.start, sources: r.events.map(e => e.kind), error: r.events.some(e => e.error && FAILED.has(e.kind)), down: r.down });
  }
  // A failure with no walk about it: a walk that never moved. Failures within
  // three seconds toward the same target (or none said) are one.
  const merged = [];
  for (const e of loose) {
    const same = merged.find(m => e.t - m.end <= 3000 && (!m.target || !e.target || d3(m.target, e.target) <= SAME_TARGET));
    if (same) { same.end = e.t; same.sources.push(e.kind); same.target ||= e.target; same.error ||= !!e.error && FAILED.has(e.kind); continue; }
    merged.push({ start: e.t, end: e.t, from: e.from || e.pos, to: e.pos, dim: e.dim, target: e.target, blocks: 0, ms: 0, sources: [e.kind], error: !!e.error && FAILED.has(e.kind), still: true });
  }
  for (const m of merged) { m.kind = pick(m.sources.map(k => ({ kind: k }))); if (m.kind !== 'arrived') walks.push(m); }
  return walks.sort((a, b) => a.start - b.start);
}

// The walks of a record that frames each walk's end (note 785 on): read
// as they were recorded, the kind the walk's own.
function walksRecorded(recorded) {
  return recorded.filter(w => w.kind !== 'refused').map(w => ({ start: Number.isFinite(w.startedAt) ? w.startedAt : w.t, end: w.t, from: w.from || null, to: w.to || null, dim: w.dim, kind: w.kind,
    target: w.kind === 'arrived' ? w.to || w.goal || null : w.goal || null, blocks: w.blocks || 0, ms: Number.isFinite(w.startedAt) ? w.t - w.startedAt : 0, sources: [w.kind], error: true, down: !!w.down })).sort((a, b) => a.start - b.start);
}

function clock(frames) {
  let ms = 0, down = 0;
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].t - frames[i - 1].t;
    if (gap > 60000) continue;
    if (frames[i].down || frames[i - 1].down) down += gap; else ms += gap;
  }
  return { ms, down };
}

// Blocks walked and net, in ten-minute windows of played (not Jev-down) time.
function displacement(frames) {
  const out = [];
  let w = null, prev = null;
  for (const f of frames) {
    if (f.down) { prev = null; continue; }
    if (!w || f.t - w.t0 >= WINDOW_MS || f.dim !== w.dim) { if (w && w.t1 - w.t0 >= 5 * 60000) out.push(w); w = { t0: f.t, t1: f.t, from: f.pos, to: f.pos, dim: f.dim, walked: 0 }; prev = f; continue; }
    if (prev) { const d = d3(prev.pos, f.pos); if (d < 10) w.walked += d; }
    w.t1 = f.t; w.to = f.pos; prev = f;
  }
  if (w && w.t1 - w.t0 >= 5 * 60000) out.push(w);
  return out.map(x => ({ ...x, net: d3(x.from, x.to) }));
}

// A failed walk's target walked to again: within ten minutes, its target
// within 4 blocks, begun within 16 of where the failed one began.
function again(walks, decisions) {
  const rows = [];
  for (let i = 0; i < walks.length; i++) {
    const w = walks[i];
    if (!FAILED.has(w.kind) || !w.target || w.down) continue;
    for (let j = i + 1; j < walks.length; j++) {
      const n = walks[j];
      if (n.start - w.end > AGAIN_MS) break;
      if (n.dim !== w.dim || !n.target || !n.from || !w.from) continue;
      if (d3(n.target, w.target) > SAME_TARGET || d3(n.from, w.from) > FROM) continue;
      const between = decisions.filter(d => d.t > w.end && d.t <= n.start + 500 && !BODY_Q.test(d.id));
      rows.push({ failed: w, next: n, asked: between.length > 0, by: between.at(-1) || null });
      break;
    }
  }
  return rows;
}

// The rules replayed on the walks of one record (failed-places.js), in time
// order on a stand-in bot: before each walk, what the failures before it
// make of it. `before` is what the ledger and the stall memory saw (a stall
// always, a failure that reached the step's error), `after` every walk's
// end. Said: one failure or more toward its target from about its start
// (read: 'once' or 'toward'); resting: two or more. And the pacing rule
// (pacingSays) at each walk's start, the questions answered from the
// record's decision frames: a walk it refuses is not walked, and its minutes
// are what the question asked instead takes their place.
function replay(walks, decisions) {
  const fp = require('../src/failed-places');
  const out = { againSaidBefore: 0, againSaidAfter: 0, againRestBefore: 0, againRestAfter: 0, againN: 0, againFailedMin: 0, againFailedMinAfterRest: 0,
    pacing: [], pacingMinAfter: 0, pacingWalksAfter: 0, pacingOthersRefused: 0, refused: new Set(), read: new Map() };
  const seenBefore = w => FAILED.has(w.kind) && (w.kind === 'stall' || (OLD_SEEN.has(w.kind) && w.error));
  const stand = () => ({ game: { dimension: 'overworld' }, entity: { position: null }, _walks: [] });
  const after = stand(), before = stand();
  const work = decisions.filter(d => !BODY_Q.test(d.id)).sort((a, b) => a.t - b.t);
  let di = 0, spell = null;
  const note = (bot, w) => fp.noteWalk(bot, { kind: w.kind, goal: w.target, from: w.from, to: w.to, at: w.end, startedAt: w.start, blocks: w.blocks });
  for (const w of walks) {
    if (w.down || !w.from) continue;
    while (di < work.length && work[di].t <= w.start) { after._lastAnswer = before._lastAnswer = { id: work[di].id, at: work[di].t }; di++; }
    for (const b of [after, before]) { b.game.dimension = w.dim || 'overworld'; b.entity.position = { x: w.from.x, y: w.from.y, z: w.from.z }; }
    if (w.target) {
      const goal = { tried: { entries: [] } };
      const a = fp.read(after, goal, w.target, { now: w.start }), b = fp.read(before, goal, w.target, { now: w.start });
      if (a || b) out.read.set(w, { after: a, before: b });
      if (a) {
        out.againN++; out.againSaidAfter++;
        if (b) out.againSaidBefore++;
        if (a.until > w.start) out.againRestAfter++;
        if (b?.until > w.start) out.againRestBefore++;
        if (FAILED.has(w.kind)) { out.againFailedMin += w.ms / 60000; if (a.until > w.start && !(b?.until > w.start)) out.againFailedMinAfterRest += w.ms / 60000; }
      }
    }
    // Pacing: refused here, the walk is not walked; a spell runs from the
    // first refusal to the next question answered.
    const says = fp.pacingSays(after, w.target, { now: w.start });
    if (says) {
      out.refused.add(w);
      if (!spell || (after._lastAnswer && after._lastAnswer.at > spell.at)) { spell = { at: w.start, from: w.from, n: 0, minutes: 0, kinds: [] }; out.pacing.push(spell); }
      spell.n++; spell.kinds.push(w.kind);
      if (FAILED.has(w.kind)) { out.pacingWalksAfter++; out.pacingMinAfter += w.ms / 60000; spell.minutes += w.ms / 60000; } else out.pacingOthersRefused++;
      continue;
    }
    note(after, w);
    if (seenBefore(w) || !FAILED.has(w.kind)) note(before, w);
  }
  return out;
}

(async () => {
  const totals = { ms: 0, down: 0, walks: {}, walkMin: {}, blocks: 0, net: 0, windows: 0, pacingWindows: 0, pacingWindowMin: 0, again: 0, againAsked: 0, againUnasked: 0, againFailed: 0, againMin: 0, failedTargets: 0, againRefused: 0, againRefusedFailed: 0, againAskedSaid: 0, againAskedRest: 0, againAskedSaidNew: 0, againUnaskedWalked: 0 };
  const rp = { againN: 0, againSaidBefore: 0, againSaidAfter: 0, againRestBefore: 0, againRestAfter: 0, againFailedMin: 0, againFailedMinAfterRest: 0, pacing: [], pacingMinAfter: 0, pacingWalksAfter: 0, pacingOthersRefused: 0 };
  const byAsker = {}, worstWindows = [], files_ = [];
  const recordedKinds = {};
  for (const f of files) {
    const r = await readFile(f);
    if (!r.frames.length) continue;
    const c = clock(r.frames); totals.ms += c.ms; totals.down += c.down;
    const walks = (r.recorded.length ? walksRecorded(r.recorded) : walksOf(r)).filter(w => !w.down);
    for (const w of walks) { totals.walks[w.kind] = (totals.walks[w.kind] || 0) + 1; totals.walkMin[w.kind] = (totals.walkMin[w.kind] || 0) + w.ms / 60000; }
    for (const w of r.recorded) recordedKinds[w.kind] = (recordedKinds[w.kind] || 0) + 1;
    totals.failedTargets += walks.filter(w => FAILED.has(w.kind) && w.target).length;
    for (const w of displacement(r.frames)) {
      totals.windows++; totals.blocks += w.walked; totals.net += w.net;
      if (w.walked >= 100 && w.net <= 0.1 * w.walked) { totals.pacingWindows++; totals.pacingWindowMin += (w.t1 - w.t0) / 60000; worstWindows.push({ port: (f.match(/-(\d{5})-/) || [])[1], at: new Date(w.t0).toISOString(), walked: Math.round(w.walked), net: Math.round(w.net) }); }
    }
    const a = again(walks, r.decisions);
    const x = replay(walks, r.decisions);
    for (const row of a) {
      totals.again++; if (row.asked) { totals.againAsked++; const k = row.by ? `${row.by.id}/${row.by.choice}` : '?'; byAsker[k] = (byAsker[k] || 0) + 1; } else totals.againUnasked++;
      if (FAILED.has(row.next.kind)) totals.againFailed++;
      totals.againMin += row.next.ms / 60000;
      // After: refused unasked (pacing), or walked with the failure said,
      // or resting at the question that chose it.
      const rd = x.read.get(row.next);
      if (x.refused.has(row.next)) { totals.againRefused++; if (FAILED.has(row.next.kind)) totals.againRefusedFailed++; }
      else if (row.asked && rd?.after) { totals.againAskedSaid++; if (rd.after.until > row.next.start) totals.againAskedRest++; if (!rd.before) totals.againAskedSaidNew++; }
      else if (!row.asked) totals.againUnaskedWalked++;
    }
    for (const k of Object.keys(rp)) if (k === 'pacing') rp.pacing.push(...x.pacing.map(p => ({ ...p, port: (f.match(/-(\d{5})-/) || [])[1] }))); else if (k !== 'refused' && k !== 'read') rp[k] += x[k];
    files_.push(f);
  }
  const hours = totals.ms / 3600000;
  const all = Object.values(totals.walks).reduce((a, b) => a + b, 0);
  const failedN = Object.entries(totals.walks).filter(([k]) => FAILED.has(k)).reduce((a, [, v]) => a + v, 0);
  const failedMin = Object.entries(totals.walkMin).filter(([k]) => FAILED.has(k)).reduce((a, [, v]) => a + v, 0);
  const out = {
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString(), files: files_.length, botHours: +hours.toFixed(1), jevDownHours: +(totals.down / 3600000).toFixed(1) },
    walks: all, perBotHour: +(all / hours).toFixed(1),
    byKind: Object.fromEntries(Object.entries(totals.walks).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { walks: v, perBotHour: +(v / hours).toFixed(1), minutes: +totals.walkMin[k].toFixed(1) }])),
    failed: failedN, failedMinutes: +failedMin.toFixed(1), failedWithTarget: totals.failedTargets,
    displacement: { blocksWalked: Math.round(totals.blocks), blocksPerBotHour: Math.round(totals.blocks / hours), netPerWindow: +(totals.net / totals.windows).toFixed(1), walkedPerWindow: +(totals.blocks / totals.windows).toFixed(1), windows: totals.windows, pacingWindows: totals.pacingWindows, pacingWindowMinutes: +totals.pacingWindowMin.toFixed(1) },
    again: { failedThenAgain: totals.again, asked: totals.againAsked, unasked: totals.againUnasked, failedAgain: totals.againFailed, minutes: +totals.againMin.toFixed(1),
      after: { refusedUnasked: totals.againRefused, refusedThatFailed: totals.againRefusedFailed, unaskedStillWalked: totals.againUnaskedWalked, askedWithFailureSaid: totals.againAskedSaid, askedSaidNewly: totals.againAskedSaidNew, askedResting: totals.againAskedRest }, byAnswer: Object.fromEntries(Object.entries(byAsker).sort((a, b) => b[1] - a[1]).slice(0, top)) },
    replay: { walksToAFailedTarget: rp.againN, saidBefore: rp.againSaidBefore, saidAfter: rp.againSaidAfter, restingBefore: rp.againRestBefore, restingAfter: rp.againRestAfter,
      failedMinutesOfThose: +rp.againFailedMin.toFixed(1), failedMinutesNewlyResting: +rp.againFailedMinAfterRest.toFixed(1),
      pacingSpells: rp.pacing.length, pacingWalksNotWalked: rp.pacingWalksAfter, pacingOtherWalksRefused: rp.pacingOthersRefused, pacingMinutesAfterThird: +rp.pacingMinAfter.toFixed(1),
      longestPacing: rp.pacing.sort((a, b) => b.n - a.n).slice(0, top).map(p => `${p.port} ${new Date(p.at).toISOString().slice(5, 19)} ${p.n} walks refused (${p.minutes.toFixed(1)} min of failed walks not walked) from (${Math.round(p.from.x)}, ${Math.round(p.from.y)}, ${Math.round(p.from.z)}): ${[...new Set(p.kinds)].join(', ')}`) },
    recordedWalkEnds: recordedKinds,
    worstWindows: worstWindows.sort((a, b) => (b.walked - b.net) - (a.walked - a.net)).slice(0, top),
  };
  if (argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log(`flight records ${out.window.files}, ${out.window.since} .. ${out.window.until}: ${out.window.botHours} bot-hours played (${out.window.jevDownHours} Jev down, off the clock)`);
  console.log(`walks ${all} (${out.perBotHour} a bot-hour); failed ${failedN}, ${out.failedMinutes} minutes inside them`);
  for (const [k, v] of Object.entries(out.byKind)) console.log(`  ${k}: ${v.walks} (${v.perBotHour}/h, ${v.minutes} min)`);
  const D = out.displacement;
  console.log(`walked ${D.blocksWalked} blocks (${D.blocksPerBotHour} a bot-hour); a ten-minute window walked ${D.walkedPerWindow} for ${D.netPerWindow} net; ${D.pacingWindows} of ${D.windows} windows walked 100+ for a tenth or less net (${D.pacingWindowMinutes} min)`);
  const A = out.again;
  console.log(`failed walks whose target was walked to again within 10 min: ${A.failedThenAgain} of ${failedN} (${out.failedWithTarget} with a target); asked between ${A.asked}, not ${A.unasked}; failed again ${A.failedAgain}; ${A.minutes} min in the walks again`);
  console.log(`  after the rules: ${A.after.refusedUnasked} of the unasked not walked (pacing; ${A.after.refusedThatFailed} of them had failed again), ${A.after.unaskedStillWalked} unasked still walked; of the asked, ${A.after.askedWithFailureSaid} with the failure said on the option (${A.after.askedSaidNewly} said only now), ${A.after.askedResting} resting`);
  for (const [k, v] of Object.entries(A.byAnswer)) console.log(`  after ${k}: ${v}`);
  const R = out.replay;
  console.log(`replay: walks to a target failed from about there in the last 10 min ${R.walksToAFailedTarget}: the failure said on the way there before ${R.saidBefore}, after ${R.saidAfter}; resting (2+) before ${R.restingBefore}, after ${R.restingAfter}; ${R.failedMinutesOfThose} min of failed walks among them, ${R.failedMinutesNewlyResting} of them now resting`);
  console.log(`replay pacing (pacingSays): ${R.pacingSpells} spells refused; ${R.pacingWalksNotWalked} failed walks not walked, ${R.pacingMinutesAfterThird} min of them, each spell a question asked instead; ${R.pacingOtherWalksRefused} walks that arrived or were cut short refused with them`);
  for (const l of R.longestPacing) console.log(`  ${l}`);
  if (Object.keys(out.recordedWalkEnds).length) console.log(`walk_end frames: ${JSON.stringify(out.recordedWalkEnds)}`);
  console.log('worst windows:'); for (const w of out.worstWindows) console.log(`  ${w.port} ${w.at.slice(5, 19)} walked ${w.walked} for ${w.net} net`);
})();

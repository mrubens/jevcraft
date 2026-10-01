#!/usr/bin/env node
'use strict';
// From the first blaze or blaze spawner known to the rods carried out (note
// 783). Per trial (artifacts/midgame, its port's flight records), the span
// begins at the first frame in the Nether with a blaze in sight or a blaze
// spawner known (a spawner step whose cage had a blaze seen within 32), and
// runs to the trial's end. In it: the minutes to the first rod, to seven
// carried, to leaving the Nether (a dimension change that is not a death's
// respawn); the deaths; the bot-minutes busy but not progressing (wasted-
// minutes.js's waste, its deaths and Jev-down minutes apart); and every
// question asked in the Nether in the span with the answer given, each
// answer sorted (src/blaze-goal.js classify): a way to the blazes, the body's
// or the rods' carry-out, a reflex, keeping on, or OFF the goal (gathering,
// food errands, wood, shelter, set-asides, mining, exploring, searching for
// another fortress...). With --replay, each recorded question is put through
// blaze-goal.js's gate as it stood (the blazes known, the rods owed, the
// options recorded) and counted again: which off-goal options would not have
// been offered, and the off-goal answers that could no longer be given.
// With --record, the record blaze-goal.js says on each way (RECORD).
// The flight records kept begin 2026-09-30T06:08Z (older ones are gone).
// Read-only.
//
//   node scripts/blaze-span.js [--since 2026-09-29T00:00:00Z] [--to ISO] [--port N] [--list] [--replay] [--record] [--json out.json]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');
const WM = require('./wasted-minutes');
const BG = require('../src/blaze-goal');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const MINUTE = 60000, GAP_MS = 60000, AFTER_MS = 5 * 60000;
const SPAWNER_STEP = /^(at_spawner|wait_at_spawner|go_to_spawner|heal_at_spawner|hold_box)$/;
const dimOf = d => String(d || '').replace(/^minecraft:/, '').replace(/^the_/, '');
const round = n => n == null ? null : Math.round(n * 10) / 10;
const iso = t => new Date(t).toISOString().slice(0, 19) + 'Z';
const median = a => { const b = a.filter(v => v != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
// Food points carried that can be eaten safely (not rotten flesh, spider eyes or raw chicken).
const EDIBLE = /^(cooked_\w+|baked_potato|bread|golden_carrot|golden_apple|enchanted_golden_apple|apple|carrot|pumpkin_pie|mushroom_stew|beef|porkchop|mutton|rabbit|cod|salmon|sweet_berries|melon_slice|glow_berries|dried_kelp|beetroot|potato|cookie)$/;
const edible = inv => Object.entries(inv || {}).filter(([k]) => EDIBLE.test(k)).reduce((n, [, v]) => n + v, 0);
const rodsOf = inv => (inv?.blaze_rod || 0) + Math.floor((inv?.blaze_powder || 0) / 2);
const midgameStart = at => { const m = at.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };

// A frame for the span: wasted-minutes.js's minute frame and what the span reads.
function slim(f, t) {
  const o = WM.slim(f, t), s = f.snapshot || {};
  if (Array.isArray(s.mobs)) { const b = s.mobs.filter(m => m.name === 'blaze'); o.blazeSeen = b.some(m => m.seen); o.blazeNear = b.length ? Math.min(...b.map(m => m.d)) : null; o.blazeAt = b.filter(m => m.seen && m.at).map(m => m.at); }
  const st = s.step || s.goal?.step;
  if (st?.action && SPAWNER_STEP.test(st.action)) { o.spawnerStep = st.action; const c = [st.spawner, st.target, st.cage].find(v => v && Number.isFinite(v.x)); if (c) o.spawnerAt = { x: c.x, y: c.y, z: c.z }; }
  if (f.kind === 'observation' && s.inventory) o.rods = rodsOf(s.inventory);
  if (f.kind === 'decision' && s.decision && !s.decision.stale) {
    const d = s.decision, keys = Object.keys(d.options || {});
    o.q = { id: d.id, answer: (Array.isArray(d.path) ? d.path : [d.path]).filter(x => x && x !== 'list').join('/') || d.judgments?.[0]?.choice || '?', keys,
      held: !!d.held, only: !!d.only, noneGood: !!d.noneGood, area: d.kind || null,
      spawner: keys.some(k => /^(wait_at_spawner|go_to_spawner(_\d+)?|stand_by_spawner|box_at_spawner)$/.test(k)) || d.id === 'empty_spawner',
      blazes: keys.some(k => /^(blazes_\w+|go_to_blazes(_about)?)$/.test(k)) || (d.id === 'hunt_target' && keys.some(k => /^hunt_/.test(k))),
      rods: Number.isFinite(rodsOf(d.state?.inventory)) ? rodsOf(d.state?.inventory) : null,
      // The option words, cut, for the replay's gate (what each option is).
      words: Object.fromEntries(Object.entries(d.options || {}).map(([k, v]) => [k, String(typeof v === 'string' ? v : v?.description ?? '').slice(0, 300)])) };
  }
  return o;
}

function portFiles(port) {
  const identity = `127_0_0_1-${port}-Jev`;
  let names = []; try { names = fs.readdirSync(FLIGHT); } catch (_) { return []; }
  const files = names.filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl')).map(f => ({ f: path.join(FLIGHT, f), start: midgameStart(f.slice(identity.length + 1)) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  files.forEach((x, i) => { x.next = files[i + 1]?.start ?? Infinity; });
  return files;
}

// The trial's frames, or null where it never saw a blaze or a spawner.
function readTrial(tr, files) {
  const frames = [];
  let seen = false;
  for (const { f, start: fs0, next } of files) {
    if (next < tr.start - GAP_MS || fs0 > tr.end) continue;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    if (!seen && !text.includes('"blaze"') && !text.includes('spawner')) { frames.length = 0; continue; }
    seen = true;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const t = frameAt(line);
      if (!(t >= tr.start && t <= tr.end)) continue;
      try { frames.push(slim(JSON.parse(line), t)); } catch (_) { /* torn */ }
    }
    text = null;
  }
  frames.sort((a, b) => a.t - b.t);
  return seen ? frames : null;
}

// The span of one trial's frames. Pure.
function measure(frames, { trialStart, end }) {
  // A spawner counts once a blaze has been seen within 32 of it in the trial:
  // before note 750d a bastion's magma cube spawner was waited at as a
  // fortress's (mid-242-ya, 121 minutes).
  const blazeSeenAt = frames.flatMap(o => o.dim === 'nether' ? o.blazeAt || [] : []);
  const blazeSpawner = o => !!o.spawnerAt && blazeSeenAt.some(b => Math.hypot(b.x - o.spawnerAt.x, b.y - o.spawnerAt.y, b.z - o.spawnerAt.z) <= 32);
  const i0 = frames.findIndex(o => o.dim === 'nether' && (o.blazeSeen || blazeSpawner(o)));
  if (i0 < 0) return null;
  const start = frames[i0].t, how = frames[i0].blazeSeen ? 'blaze in sight' : frames[i0].spawnerStep ? `spawner step ${frames[i0].spawnerStep}` : 'a spawner offered';
  let base = null;
  for (let i = i0; i >= 0 && base === null; i--) if (Number.isFinite(frames[i].rods)) base = frames[i].rods;
  base ??= 0;
  let firstRod = null, seven = null, left = null, maxRods = base, lastHp = null, lastDeath = -Infinity;
  const deaths = [], asks = [];
  const places = [];
  const addPlace = (p, kind, t) => { const k = places.find(x => Math.hypot(x.x - p.x, x.y - p.y, x.z - p.z) <= 8); if (k) { k.t = t; if (kind === 'spawner') k.kind = kind; } else places.push({ x: p.x, y: p.y, z: p.z, kind, t }); };
  const nearest = (h, stood = false) => { const list = places.filter(x => !stood || x.stood); return h && list.length ? Math.round(Math.min(...list.map(x => Math.hypot(x.x - h.x, x.y - h.y, x.z - h.z)))) : null; };
  let here = null;
  let netherMs = 0, hunger = null, eats = null, step = null, phase = null;
  for (let i = i0; i < frames.length; i++) {
    const o = frames[i], n = frames[i + 1];
    if (o.dim === 'nether' && n && n.t - o.t <= GAP_MS) netherMs += n.t - o.t;
    if (Number.isFinite(o.hp)) {
      if (o.hp === 0 && lastHp > 0) { deaths.push({ t: o.t, rods: maxRodsNow(frames, i), dim: o.dim, min: round((o.t - start) / MINUTE) }); lastDeath = o.t; }
      lastHp = o.hp;
    }
    if (Number.isFinite(o.rods)) {
      if (o.rods > base && firstRod === null) firstRod = o.t;
      if (o.rods >= 7 && seven === null) seven = o.t;
      maxRods = Math.max(maxRods, o.rods);
    }
    if (left === null && o.dim && o.dim !== 'nether' && o.t - lastDeath > 60000 && frames.slice(Math.max(i0, i - 40), i).some(x => x.dim === 'nether')) left = { t: o.t, rods: lastRods(frames, i) };
    if (Number.isFinite(o.food)) hunger = o.food;
    if (o.inv) eats = edible(o.inv);
    if (o.step?.a) step = o.step.a;
    if (o.phase) phase = o.phase;
    if (o.dim === 'nether') { for (const b of o.blazeAt || []) addPlace(b, 'blaze', o.t); if (o.spawnerAt) addPlace(o.spawnerAt, 'spawner', o.t); }
    if (o.p) { here = o.p; if (o.dim === 'nether') for (const x of places) if (!x.stood && Math.hypot(x.x - here.x, x.y - here.y, x.z - here.z) <= 32) x.stood = true; }
    if (o.q && o.dim === 'nether') asks.push({ t: o.t, ...o.q, near: nearest(here), nearStood: nearest(here, true), step, phase, hunger, hp: lastHp, eats, rodsNow: maxRodsNow(frames, i), min: round((o.t - start) / MINUTE) });
  }
  // Busy, not progressing: wasted-minutes.js's waste over the span's Nether minutes.
  const bins = WM.minutesOf(frames, { start: trialStart });
  let busyMs = 0, busyOffMs = 0, slowMs = 0, deadMs = 0, downMs = 0, progressMs = 0, upkeepMs = 0;
  const busyBy = {}, busy = [];
  for (const b of bins) {
    if (!b.botMs || b.from + MINUTE <= start || b.from > end) continue;
    if (!b.frames.some(x => x.dim === 'nether')) continue;
    const v = WM.classify(b.m);
    if (v.cls === 'jev_down') downMs += b.botMs;
    else if (v.cls === 'waste' && v.pattern === 'died') deadMs += b.botMs;
    else if (v.cls === 'waste') {
      busyMs += b.botMs; busyBy[v.pattern] = (busyBy[v.pattern] || 0) + b.botMs;
      busy.push({ from: b.from, botMs: b.botMs, pattern: v.pattern, why: v.why, doing: b.m.doing, steps: b.m.steps, ...WM.attribution(b.m) });
      // Under an errand: the minute's question and answer (wasted-minutes.js attribution) is one.
      const q = WM.attribution(b.m).question, m = /^(.+) → (.+)$/.exec(q || '');
      if (m && BG.classify(m[1].replaceAll(' ', '_'), m[2].replaceAll(' ', '_')) === 'off') busyOffMs += b.botMs;
    }
    else if (v.cls === 'progress') progressMs += b.botMs;
    else if (v.cls === 'slow') slowMs += b.botMs;
    else upkeepMs += b.botMs;
  }
  // Each answer that is not the body's in the moment: how long it held (to
  // the next such answer, at most ten minutes, Nether time), and whether a rod
  // came, or a death, within five minutes after.
  const rodLine = frames.filter(o => Number.isFinite(o.rods)).map(o => [o.t, o.rods]);
  const rodsAt = t => { let r = base; for (const [u, v] of rodLine) { if (u > t) break; r = v; } return r; };
  const work = asks.filter(a => !BG.REFLEX_Q.has(a.id));
  work.forEach((a, k) => {
    const next = work[k + 1]?.t ?? Math.min(end, a.t + 10 * MINUTE);
    a.heldMs = Math.max(0, Math.min(next, a.t + 10 * MINUTE) - a.t);
    const before = rodsAt(a.t);
    a.rodAfter = rodLine.some(([u, v]) => u > a.t && u <= a.t + AFTER_MS && v > before);
    a.deathAfter = deaths.some(d => d.t > a.t && d.t <= a.t + AFTER_MS);
  });
  return { start, how, base, firstRod, seven, left, maxRods, deaths, asks, netherMs, busyMs, busyOffMs, slowMs, busyBy, busy, deadMs, downMs, progressMs, upkeepMs };
}
function maxRodsNow(frames, i) { for (let j = i; j >= 0; j--) if (Number.isFinite(frames[j].rods)) return frames[j].rods; return 0; }
const lastRods = maxRodsNow;

function main() {
  const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const since = Date.parse(opt('since', '2026-09-29T00:00:00Z')), to = Date.parse(opt('to', '')) || Infinity;
  const port = opt('port', null);
  const audit = require('./trials/progress-audit');
  let trials = audit.trialRecords({ since: since - 1, flight: FLIGHT }).filter(t => t.port && t.start < to);
  if (port) trials = trials.filter(t => String(t.port) === String(port));
  const byPort = new Map(), out = [];
  for (const tr of trials) {
    if (!byPort.has(tr.port)) byPort.set(tr.port, portFiles(tr.port));
    const end = Math.min(tr.end, to);
    const frames = readTrial({ ...tr, end }, byPort.get(tr.port));
    if (!frames) continue;
    const m = measure(frames, { trialStart: tr.start, end });
    if (m) out.push({ world: tr.world, port: tr.port, trialStart: tr.start, end, ...m });
  }
  report(out, { list: args.includes('--list'), replay: args.includes('--replay'), record: args.includes('--record') });
  const j = opt('json', null);
  if (j) fs.writeFileSync(j, JSON.stringify(out, null, 1));
}

function report(spans, { list = false, replay = false, record = false } = {}) {
  const mins = (a, b) => b == null ? null : round((b - a) / MINUTE);
  console.log(`Trials that saw a blaze or a blaze spawner: ${spans.length}`);
  const toRod = spans.map(s => mins(s.start, s.firstRod)), to7 = spans.map(s => mins(s.start, s.seven)), toLeave = spans.map(s => mins(s.start, s.left?.t));
  const n = a => a.filter(v => v != null).length;
  console.log(`  a first rod: ${n(toRod)} (median ${median(toRod)} min); seven carried: ${n(to7)} (median ${median(to7)}); left the Nether alive: ${n(toLeave)} (median ${median(toLeave)}), with rods: ${spans.filter(s => s.left?.rods > 0).length}`);
  const deaths = spans.flatMap(s => s.deaths.filter(d => d.dim === 'nether'));
  console.log(`  Nether bot-minutes in the spans: ${round(spans.reduce((a, s) => a + s.netherMs, 0) / MINUTE)}; deaths there: ${deaths.length} (rods dropped ${deaths.reduce((a, d) => a + d.rods, 0)})`);
  const sum = k => round(spans.reduce((a, s) => a + s[k], 0) / MINUTE);
  console.log(`  minutes: progress ${sum('progressMs')}, upkeep ${sum('upkeepMs')}, crawling ${sum('slowMs')}, busy not progressing ${sum('busyMs')} (${sum('busyOffMs')} of them under an errand's answer), died ${sum('deadMs')}, Jev down ${sum('downMs')}`);
  const busy = {}; for (const s of spans) for (const [k, v] of Object.entries(s.busyBy)) busy[k] = (busy[k] || 0) + v;
  console.log(`  busy by pattern: ${Object.entries(busy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${round(v / MINUTE)}`).join(', ')}`);
  const asks = spans.flatMap(s => s.asks.map(a => ({ ...a, world: s.world, port: s.port })));
  const tally = {}, byQ = {};
  for (const a of asks) {
    const c = BG.classify(a.id, a.answer.split('/').at(-1), { area: a.area });
    tally[c] = (tally[c] || 0) + 1;
    const k = `${a.id} → ${a.answer.split('/').at(-1)}`;
    (byQ[c] ||= {})[k] = (byQ[c][k] || 0) + 1;
  }
  console.log(`  questions asked in the Nether in the spans: ${asks.length}; by the answer given: ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const c of Object.keys(byQ).sort()) console.log(`    ${c}: ${Object.entries(byQ[c]).sort((a, b) => b[1] - a[1]).slice(0, list ? 60 : 18).map(([k, v]) => `${k} ${v}`).join('; ')}`);
  if (list) for (const s of spans) console.log(`  ${s.world} ${s.port} ${iso(s.start)} (${s.how}): rod ${mins(s.start, s.firstRod)} 7 ${mins(s.start, s.seven)} left ${mins(s.start, s.left?.t)} (rods ${s.left?.rods ?? '-'}) max ${s.maxRods}; deaths ${s.deaths.length}; asks ${s.asks.length}; busy ${round(s.busyMs / MINUTE)} of ${round(s.netherMs / MINUTE)} Nether min`);
  if (replay) replayReport(spans);
  if (record) recordReport(spans);
}

// Each recorded question about the work, as the rule reads it from the
// record: rods owed (fewer than seven carried), blazes known (seen in this
// trial's Nether so far), within reach (a way to them offered in the
// question, or the bot within 32 blocks of where one was seen or of a blaze
// spawner it stood at), the rods carried, and the body's food (nothing safe
// carried and hunger under 18). -> the sieve's verdict on it.
function replayAsk(a) {
  const keys = a.keys.length ? a.keys : [a.answer.split('/').at(-1)];
  const chosen = a.answer.split('/').at(-1);
  const ctx = { rodsOwed: Math.max(0, 7 - (a.rodsNow || 0)), known: a.near != null || keys.some(k => BG.classify(a.id, k) === 'toward'), atBlazes: a.near != null && a.near <= BG.BLAZES_AT, rodsCarried: a.rodsNow || 0, needsFood: Number.isFinite(a.hunger) && a.hunger < BG.REGEN_HUNGER && !(a.eats > 0) };
  const v = BG.sieve(a.id, keys, ctx);
  const purpose = BG.purpose(a.id, chosen, ctx);
  return { ...v, ctx, chosen, purpose, lost: v.gated && v.withheld.some(w => w.key === chosen), oneLeft: v.gated && v.keep.filter(k => k !== 'none_good').length <= 1 };
}
function replayReport(spans) {
  const work = spans.flatMap(s => s.asks.filter(a => !BG.REFLEX_Q.has(a.id)).map(a => ({ ...a, world: s.world, port: s.port })));
  const rows = work.map(a => ({ a, r: replayAsk(a) }));
  const offBefore = rows.filter(x => x.r.purpose === 'off');
  const gated = rows.filter(x => x.r.gated), lost = rows.filter(x => x.r.lost), one = rows.filter(x => x.r.oneLeft);
  const mins = list => round(list.reduce((n, x) => n + (x.a.heldMs || 0), 0) / MINUTE);
  const by = (list, f) => { const t = {}; for (const x of list) { const k = f(x); t[k] = (t[k] || 0) + 1; } return Object.entries(t).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k} ${v}`).join(', '); };
  console.log(`\nReplay under the rule (src/blaze-goal.js sieve), questions about the work asked in the Nether in the spans: ${rows.length}`);
  console.log(`  before: off-goal answers ${offBefore.length} (${mins(offBefore)} bot-minutes held): ${by(offBefore, x => BG.familyOf(x.a.id, x.r.chosen))}`);
  console.log(`  gated (something withheld): ${gated.length} questions, by question: ${by(gated, x => x.a.id)}`);
  console.log(`  options withheld: ${gated.reduce((n, x) => n + x.r.withheld.length, 0)}; questions left with one option (not asked of Jev): ${one.length}`);
  console.log(`  off-goal answers that could no longer be given: ${lost.length} of ${offBefore.length} (${mins(lost)} bot-minutes held; a rod within five minutes after ${lost.filter(x => x.a.rodAfter).length}, a death ${lost.filter(x => x.a.deathAfter).length}): ${by(lost, x => `${x.a.id} ${BG.familyOf(x.a.id, x.r.chosen)}`)}`);
  const left = offBefore.filter(x => !x.r.lost);
  console.log(`  after: off-goal answers still possible ${left.length} (${mins(left)} bot-minutes held), why: ${by(left, x => !x.r.ctx.known ? 'no blaze known yet' : !(x.r.ctx.rodsOwed > 0) ? 'no rod owed' : !x.r.toward.length && !x.r.ctx.atBlazes ? `no way offered, ${x.a.near == null ? '?' : x.a.near <= 128 ? '33-128' : 'over 128'} blocks from blazes` : x.r.allOff ? 'every option an errand' : 'other')}`);
  // The trials' questions asked of Jev: a recorded ask that was asked (more
  // than one option, not held) and now has one option left is not asked.
  const askedBefore = rows.filter(x => !x.a.only && !x.a.held).length;
  console.log(`  questions asked of Jev: ${askedBefore} before, ${askedBefore - one.filter(x => !x.a.only && !x.a.held).length} after`);
}

// The record said on the ways (src/blaze-goal.js RECORD): answers given with
// blazes known within reach, by kind.
function recordReport(spans) {
  const r = {};
  const add = (k, a) => { const x = r[k] ||= [0, 0, 0, 0]; x[0]++; x[1] += a.rodAfter ? 1 : 0; x[2] += a.deathAfter ? 1 : 0; x[3] += a.heldMs || 0; };
  for (const s of spans) for (const a of s.asks) {
    if (BG.REFLEX_Q.has(a.id)) continue;
    const v = replayAsk(a);
    if (!(v.ctx.rodsOwed > 0) || !v.ctx.known || (!v.toward.length && !v.ctx.atBlazes)) continue;
    if (v.purpose === 'toward') add(BG.wayKind(v.chosen) || 'a way', a);
    else if (v.purpose === 'off') add('errands', a);
  }
  console.log('\nRecord (blazes known within reach): kind: [chosen, rod within 5 min, death within 5 min, bot-minutes held]');
  for (const [k, x] of Object.entries(r)) console.log(`  '${k}': [${x[0]}, ${x[1]}, ${x[2]}, ${round(x[3] / MINUTE)}],`);
}

if (require.main === module) main();
module.exports = { measure, slim, report, replayAsk, portFiles, readTrial };

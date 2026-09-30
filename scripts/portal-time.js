#!/usr/bin/env node
'use strict';
// Where a fresh trial's time before the Nether goes, by phase (trial note
// 748: 93 fresh trials since 2026-09-29 23Z, 26 reached a blaze fight,
// 69.6 of 94.5 fresh bot-hours went to trials that never did). Per fresh
// trial: minutes to the Nether (or never, and how long it ran without it),
// and the minutes of that time spent on each named phase: fetching lava or
// water (fill_bucket), a trip to a known lava pool (go_to_landmark), the
// cast itself (cast_portal), the walk to a known portal (return_to_portal),
// the plan's own dispatch label (enter_nether: see the note below), upkeep
// (food, tools, restocking), night_mine, and shelter. This does not change
// any behavior; it is the measure the fixes in note 748 are checked
// against next run. Note 753 added the lava fetch's own measures (lavaFetch
// below): buckets, minutes by phase, target switches, the deep dig with a
// pool near, height a bucket, portal_method's changed answers, the route
// searches before a phase, and walks that went down a cave under a pool.
//
//   node scripts/portal-time.js [--since 2026-09-29T23:00:00Z] [--to ISO]
//                                [--port N] [--json] [--verbose]
// JEV_ROOT reads another checkout's records (from a worktree).
//
// A "fresh" trial is one begun from a fresh world, not a fortress or
// nether checkpoint (progress-audit.js trialRecords, the same test
// wasted-minutes.js uses for 'fresh' vs 'fortress checkpoint'/'nether
// checkpoint'). Nether is reached at the first frame whose dimension is
// 'nether' within the trial's span; phases are counted only up to that
// frame (or the trial's end, if it never came).
//
// A note on `enter_nether` in this report: game-progress.js's gameStep sets
// goal.step to the ladder's current stage, `{action: stage.action, phase:
// stage.phase, ...stage}`, right before dispatching into the stage's own
// handler (work.js netherStep -> crossing -> portalStep), which then
// overwrites goal.step with the real work (fill_bucket, cast_portal,
// return_to_portal...). A flight frame sampled in that instant records the
// generic `{action: 'enter_nether', phase: 'reach_nether'}` label, which can
// look like the bot toggling between casting and "trying to enter the
// Nether" every few seconds when read as a bare action-name diff — it is
// not a behavior loop, and every normal pass through the crossing shows it.
// This script still counts it as its own small bucket (rather than folding
// it into whatever follows) so that bucket's size is itself the evidence:
// on every fresh trial measured so far it is a few seconds, not minutes.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const has = name => args.includes(name);
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const since = Date.parse(opt('--since', '2026-09-29T23:00:00Z'));
const to = opt('--to', null) ? Date.parse(opt('--to', null)) : Infinity;
const onlyPort = opt('--port', null) ? Number(opt('--port', null)) : null;
const asJson = has('--json');
const verbose = has('--verbose');
const GAP_MS = 60000; // a gap under a minute between frames is bot time (flight-commit.js), same cut as wasted-minutes.js

const audit = require('./trials/progress-audit');

const dimOf = d => String(d || '').replace(/^minecraft:/, '').replace(/^the_/, '');
const midgameStart = at => { const m = at.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };

function portFiles(port, dir = FLIGHT) {
  const identity = `127_0_0_1-${port}-Jev`;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  const files = names.filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl'))
    .map(f => ({ f: path.join(dir, f), start: midgameStart(f.slice(identity.length + 1)) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  files.forEach((x, i) => { x.next = files[i + 1]?.start ?? Infinity; });
  return files;
}

// The frames of one trial, start to end: {t, dim, action, phase}, and for
// the lava fetch's measures (note 753) where the bot stood, the step's
// target, the lava and empty buckets carried (on frames that carry the
// inventory), a lava pool newly found, and a portal_method answer.
function readTrial({ port, start, end, dir = FLIGHT }) {
  const frames = [];
  for (const { f, start: fs0, next } of portFiles(port, dir)) {
    if (next < start - GAP_MS || fs0 > end) continue;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const t = frameAt(line);
      if (!(t >= start && t <= end)) continue;
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      const s = o.snapshot || {};
      const st = s.step || s.goal?.step;
      const sa = s.survivalAction || s.goal?.survivalAction;
      const d = o.kind === 'decision' ? s.decision : null;
      frames.push({ t, dim: s.dimension ? dimOf(s.dimension) : null, action: st?.action || null, phase: st?.phase || null,
        pos: s.position || null, target: st?.target || st?.position || null, kind: st?.kind || null,
        lava: s.inventory ? (+s.inventory.lava_bucket || 0) : null,
        pool: sa?.action === 'landmark_found' && sa.kind === 'lava_pool' && sa.position ? sa.position : null,
        answer: d?.id === 'portal_method' && Array.isArray(d.path) ? d.path.at(-1) : null, stall: o.kind === 'navigation_stall',
        detour: o.kind === 'decision' && /^(stillness_detour|rung_progress)$/.test(d?.id || '') && Array.isArray(d.path) ? d.path.at(-1) : null });
    }
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

// By action name, to the phases the task asked this measured by. Order
// matters: the first pattern that matches wins.
const PHASES = [
  ['fill_bucket', /^fill_bucket$/],
  ['go_to_landmark', /^go_to_landmark$/],
  ['cast_portal', /^cast_portal$/],
  ['return_to_portal', /^(return_to_portal|buckets_for_portal)$/],
  ['enter_nether', /^enter_nether$/],
  ['night_mine', /^(night_mine|mine_nearby)$/],
  ['shelter', /^(secure_shelter|shelter_method|seal_here|box_here|box_in_line|box_at_spawner|dig_in_at_spawner|open_slit|wait_in_shelter|dig_in|dig_in_bunker|dig_nook|shaft_pocket|hold_bunker|hold_box|box_in|pillar_hold|nook_hold|back_to_wall|out_of_sight_hold|out_of_sight|take_cover|stay_up|seal_shelter|hold_on_span|hold_defensive_position|work_in_pocket)$/],
  ['upkeep', /^(acquire|acquire_set|craft_eyes|fetch_stems|cook_meat|mushroom_stew|top_up_food|top_up_food_near|restock_food|return_for_food|restock_blocks|wood_reserve|gather_wool|shear_sheep|home|home_with_rods|corpse_run)$/],
];
function phaseOf(action) {
  if (!action) return 'no step';
  for (const [name, re] of PHASES) if (re.test(action)) return name;
  return 'other';
}

function measureTrial(tr) {
  const start = tr.start, cap = Math.min(tr.end, to);
  const frames = readTrial({ port: tr.port, start, end: cap });
  const netherFrame = frames.find(f => f.dim === 'nether');
  const cut = netherFrame ? netherFrame.t : cap;
  const byPhase = {}, otherActions = {};
  let botMs = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.t >= cut) break;
    const next = frames[i + 1]?.t ?? cut;
    const dt = Math.min(next, cut) - f.t;
    if (!(dt > 0) || dt > GAP_MS) continue;
    const phase = phaseOf(f.action);
    byPhase[phase] = (byPhase[phase] || 0) + dt;
    botMs += dt;
    if (phase === 'other' && f.action) otherActions[f.action] = (otherActions[f.action] || 0) + dt;
  }
  const lava = lavaFetch(frames.filter(f => f.t < cut));
  return {
    world: tr.world, port: tr.port, startedAt: new Date(start).toISOString(), lava,
    reachedNether: !!netherFrame, minutesToNether: netherFrame ? round((netherFrame.t - start) / 60000) : null,
    minutesMeasured: round(botMs / 60000), minutesRun: round((cap - start) / 60000),
    byPhase: Object.fromEntries(Object.entries(byPhase).sort((a, b) => b[1] - a[1]).map(([k, ms]) => [k, round(ms / 60000)])),
    topOther: Object.entries(otherActions).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, ms]) => [k, round(ms / 60000)]),
  };
}
const round = n => Math.round(n * 10) / 10;

// The lava fetch, measured (note 753): buckets filled (the rises in lava
// buckets carried, a change undone within thirty seconds not counted: a
// frame taken mid-click reads as a drop and a pick-up; progress-audit.js
// steady),
// the fetch's minutes (fill_bucket and go_to_landmark), how often the lava
// it was going for changed, the minutes spent digging for the deep lava
// with a lava pool found this trial within 64 blocks, the height climbed
// and descended while fetching, and portal_method's answers and the ones
// changed within a minute.
const FETCH = /^(fill_bucket|go_to_landmark|to_lava_for_portal)$/;
const LAVA_DEPTH = -56;
const near3 = (a, b, r) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= r;
const { steady } = audit;
function lavaFetch(frames) {
  const over = frames.filter(f => f.dim === 'overworld' || f.dim === null);
  const carrying = over.filter(f => f.lava !== null);
  const lavaSeries = steady(carrying.map(f => f.lava), carrying.map(f => f.t));
  let buckets = 0;
  for (let i = 1; i < lavaSeries.length; i++) if (lavaSeries[i] > lavaSeries[i - 1]) buckets += lavaSeries[i] - lavaSeries[i - 1];
  const byPhase = {};
  let fetchMs = 0, deepMs = 0, deepPoolMs = 0, climbed = 0, descended = 0, switches = 0, lastKey = null, lastAt = null;
  const pools = [];
  const answers = [];
  for (let i = 0; i < over.length; i++) {
    const f = over[i], next = over[i + 1];
    if (f.pool && !pools.some(p => near3(p, f.pool, 8))) pools.push({ ...f.pool, t: f.t });
    if (f.answer) answers.push({ t: f.t, answer: f.answer });
    if (!FETCH.test(f.action || '')) continue;
    const dt = next ? next.t - f.t : 0;
    if (dt > 0 && dt <= GAP_MS) {
      fetchMs += dt;
      const ph = f.action === 'fill_bucket' ? (f.phase === 'tunnel' ? (f.target && f.target.y <= LAVA_DEPTH + 2 ? 'tunnel (deep)' : 'tunnel (to lava in sight)') : f.phase || 'before a phase (the survey)') : f.action;
      byPhase[ph] = (byPhase[ph] || 0) + dt;
      if (f.pos && next?.pos) { const dy = next.pos.y - f.pos.y; if (Math.abs(dy) < 20) { if (dy > 0) climbed += dy; else descended -= dy; } }
      const deep = f.phase === 'tunnel' && f.target && f.target.y <= LAVA_DEPTH + 2;
      if (deep) {
        deepMs += dt;
        if (f.pos && pools.some(p => p.t < f.t && p.y > LAVA_DEPTH + 2 && near3(p, f.pos, 64))) deepPoolMs += dt;
      }
    }
    // The lava it is going for: the deep lava is one target however its
    // heading moves a block a step; any other, its place, a switch when it
    // moves more than eight blocks.
    const tgt = f.target;
    if (!tgt) continue;
    const key = f.phase === 'tunnel' && tgt.y <= LAVA_DEPTH + 2 ? 'deep' : tgt;
    if (lastKey !== null && (key === 'deep' ? lastKey !== 'deep' : lastKey === 'deep' || !near3(lastKey, key, 8))) switches++;
    lastKey = key; lastAt = f.t;
  }
  // Walks stalled at a spot already stalled at twice in the last fifteen
  // minutes (within three blocks): the stalls note 753b's bad-step rule
  // routes round (skills.js noteStallSpot).
  const spots = [];
  let stalls = 0, repeatStalls = 0;
  for (const f of over) {
    if (!f.stall || !f.pos) continue;
    stalls++;
    const near = spots.filter(q => f.t - q.t < 15 * 60000 && Math.hypot(q.x - f.pos.x, q.y - f.pos.y, q.z - f.pos.z) <= 3);
    if (near.length >= 2) repeatStalls++;
    spots.push({ ...f.pos, t: f.t });
  }
  // The stall's questions (stillness_detour, rung_progress) answered while a
  // lava pool found this trial lay within 128 blocks, and how many of those
  // answers went to it (note 753b's to_known_lava).
  let detoursWithPool = 0, detoursToPool = 0;
  const seenPools = [];
  for (const f of over) {
    if (f.pool) seenPools.push({ ...f.pool, t: f.t });
    if (!f.detour || !f.pos) continue;
    if (!seenPools.some(p => p.t < f.t && near3(p, f.pos, 128))) continue;
    detoursWithPool++;
    if (/^(to_known_lava|to_portal_frame)$/.test(f.detour)) detoursToPool++;
  }
  // The cast held up by water running into its slot (stop_water,
  // fill_source, drain): minutes, and walks stalled meanwhile (note 753c).
  let castWaterMs = 0, castWaterStalls = 0;
  for (let i = 0; i < over.length; i++) {
    const f = over[i], next = over[i + 1];
    if (f.action !== 'cast_portal' || !/^(stop_water|fill_source|drain)$/.test(f.phase || '')) continue;
    if (next && next.t - f.t <= GAP_MS) castWaterMs += next.t - f.t;
    if (f.stall) castWaterStalls++;
  }
  let flips = 0;
  for (let i = 1; i < answers.length; i++) if (answers[i].answer !== answers[i - 1].answer && answers[i].t - answers[i - 1].t < 60000) flips++;
  // The scooping spots' route search before each pass's phase (a
  // fill_bucket frame with no phase yet), as segments: where it began, how
  // long, and the phase it led to. One that began within six blocks and a
  // minute of the last, both leading to no scoop, is a search note 753's
  // memo makes once, not again: an upper bound on what it saves, since the
  // memo also wants the walk from there set aside where the search ran out
  // of time.
  const surveys = [];
  for (let i = 0; i < over.length; i++) {
    const f = over[i];
    if (f.action !== 'fill_bucket' || f.phase || !f.pos) continue;
    let j = i; while (j + 1 < over.length && over[j + 1].action === 'fill_bucket' && !over[j + 1].phase && over[j + 1].t - over[j].t <= GAP_MS) j++;
    const after = over[j + 1];
    if (after && after.t - over[j].t <= GAP_MS) surveys.push({ t: f.t, pos: f.pos, ms: after.t - f.t, led: after.action === 'fill_bucket' ? after.phase : after.action });
    i = j;
  }
  let surveyMs = 0, skippableMs = 0;
  for (let k = 0; k < surveys.length; k++) {
    surveyMs += surveys[k].ms;
    const prev = surveys[k - 1], cur = surveys[k];
    if (prev && cur.t - prev.t <= 60000 && near3(prev.pos, cur.pos, 6) && !/scoop/.test(prev.led || '') && !/scoop/.test(cur.led || '')) skippableMs += cur.ms;
  }
  // A walk to a remembered pool that went down more than sixteen blocks
  // below both where it began and the pool: a leg into a cave under it
  // (note 753's legGoal). Counted per walk (go_to_landmark, one target),
  // with the minutes from where it first went that low to the walk's end.
  let caveLegs = 0, caveLegMs = 0;
  for (let i = 0; i < over.length; i++) {
    const f = over[i];
    if (f.action !== 'go_to_landmark' || !f.target || !f.pos) continue;
    let j = i; while (j + 1 < over.length && over[j + 1].action === 'go_to_landmark' && over[j + 1].target && near3(over[j + 1].target, f.target, 1) && over[j + 1].t - over[j].t <= GAP_MS) j++;
    const floor = Math.min(f.pos.y, f.target.y ?? f.pos.y) - 16;
    const low = over.slice(i, j + 1).findIndex(g => g.pos && g.pos.y < floor);
    if (low >= 0) { caveLegs++; caveLegMs += (over[j + 1] && over[j + 1].t - over[j].t <= GAP_MS ? over[j + 1].t : over[j].t) - over[i + low].t; }
    i = j;
  }
  return { buckets, minutes: round(fetchMs / 60000), byPhase: Object.fromEntries(Object.entries(byPhase).map(([k, ms]) => [k, ms / 60000])), deepMinutes: round(deepMs / 60000), deepWithPoolMinutes: round(deepPoolMs / 60000),
    switches, climbed: Math.round(climbed), descended: Math.round(descended), poolsFound: pools.length, portalMethodAnswers: answers.length, portalMethodFlips: flips,
    castWaterMinutes: round(castWaterMs / 60000), castWaterStalls, stalls, repeatStalls, detoursWithPool, detoursToPool, surveys: surveys.length, surveyMinutes: round(surveyMs / 60000), surveySkippableMinutes: round(skippableMs / 60000), caveLegs, caveLegMinutes: round(caveLegMs / 60000) };
}

function main() {
  let trials = audit.trialRecords({ since: since - 1, flight: FLIGHT }).filter(t => t.port && t.start < to);
  if (onlyPort) trials = trials.filter(t => Number(t.port) === onlyPort);
  trials = trials.filter(t => !/\/stages\/(fortress|nether)\//.test(t.source || ''));
  const rows = trials.map(measureTrial);
  if (asJson) { console.log(JSON.stringify({ since: new Date(since).toISOString(), trials: rows }, null, 2)); return; }

  console.log(`${rows.length} fresh trial${rows.length === 1 ? '' : 's'} since ${new Date(since).toISOString()}${Number.isFinite(to) ? ` to ${new Date(to).toISOString()}` : ''}.`);
  const reached = rows.filter(r => r.reachedNether);
  console.log(`${reached.length} of ${rows.length} reached the Nether.`);
  if (reached.length) {
    const sorted = reached.map(r => r.minutesToNether).sort((a, b) => a - b);
    console.log(`Minutes to Nether: median ${sorted[Math.floor(sorted.length / 2)]}, min ${sorted[0]}, max ${sorted[sorted.length - 1]}.`);
  }
  const totalsByPhase = {};
  for (const r of rows) for (const [k, m] of Object.entries(r.byPhase)) totalsByPhase[k] = (totalsByPhase[k] || 0) + m;
  console.log('\nMinutes by phase, summed over every fresh trial\'s pre-Nether time:');
  for (const [k, m] of Object.entries(totalsByPhase).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${round(m)} min`);

  // The lava fetch (note 753), summed over every fresh trial's
  // pre-Nether Overworld time.
  const L = rows.map(r => r.lava);
  const sum = k => L.reduce((a, l) => a + (l[k] || 0), 0);
  const buckets = sum('buckets'), fetchMin = sum('minutes');
  const per = (n, d) => d ? round(n / d) : '-';
  console.log('\nThe lava fetch (fill_bucket and go_to_landmark), pre-Nether:');
  console.log(`  ${round(fetchMin)} min for ${buckets} lava buckets filled: ${per(buckets, fetchMin / 60)} buckets an hour, ${per(fetchMin, buckets)} min a bucket.`);
  const phases = {};
  for (const l of L) for (const [k, m] of Object.entries(l.byPhase || {})) phases[k] = (phases[k] || 0) + m;
  console.log(`  By phase: ${Object.entries(phases).sort((a, b) => b[1] - a[1]).map(([k, m]) => `${k} ${round(m)}`).join(', ')}.`);
  console.log(`  Target switches: ${sum('switches')} (${per(sum('switches'), buckets)} a bucket).`);
  console.log(`  Digging for the deep lava: ${round(sum('deepMinutes'))} min, ${round(sum('deepWithPoolMinutes'))} of them with a lava pool found this trial within 64 blocks (${sum('poolsFound')} pools found in all).`);
  console.log(`  Height while fetching: ${sum('climbed')} climbed, ${sum('descended')} descended (${per(sum('climbed') + sum('descended'), buckets)} a bucket).`);
  console.log(`  portal_method: ${sum('portalMethodAnswers')} answers, ${sum('portalMethodFlips')} changed within a minute of the one before.`);
  console.log(`  Route searches before a phase: ${sum('surveys')}, ${round(sum('surveyMinutes'))} min; at most ${round(sum('surveySkippableMinutes'))} min of them repeated within six blocks and a minute with no scoop (note 753's memo).`);
  console.log(`  The cast held up by water in its slot (stop_water, fill_source, drain): ${round(sum('castWaterMinutes'))} min, ${sum('castWaterStalls')} stalls meanwhile (note 753c).`);
  console.log(`  Navigation stalls before the Nether: ${sum('stalls')}, ${sum('repeatStalls')} of them at a spot stalled at twice already in fifteen minutes (note 753b).`);
  console.log(`  Stall questions answered with a pool found within 128 blocks: ${sum('detoursWithPool')}, ${sum('detoursToPool')} of them going to it or to the frame (note 753b).`);
  console.log(`  Walks to a remembered pool that went 16+ blocks below both their start and the pool: ${sum('caveLegs')}, ${round(sum('caveLegMinutes'))} min from there to the walk's end.`);

  console.log('\nPer trial:');
  for (const r of rows) {
    const nether = r.reachedNether ? `Nether at ${r.minutesToNether} min` : `never reached the Nether (ran ${r.minutesRun} min)`;
    console.log(`  ${r.world} (port ${r.port}, ${r.startedAt}): ${nether}, ${r.minutesMeasured} min measured`);
    const parts = Object.entries(r.byPhase).map(([k, m]) => `${k} ${m}`);
    if (parts.length) console.log(`    ${parts.join(', ')}`);
    const l = r.lava;
    if (l.minutes || l.buckets) console.log(`    lava: ${l.buckets} buckets in ${l.minutes} min, ${l.switches} switches, deep ${l.deepMinutes} min (${l.deepWithPoolMinutes} with a pool found within 64), up ${l.climbed} down ${l.descended}, portal_method ${l.portalMethodAnswers} (${l.portalMethodFlips} changed within a minute)`);
    if (verbose && r.topOther.length) console.log(`    other: ${r.topOther.map(([k, m]) => `${k} ${m}`).join(', ')}`);
  }
}

module.exports = { measureTrial, phaseOf, lavaFetch };
if (require.main === module) main();

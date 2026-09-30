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
// against next run.
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

// The frames of one trial, start to end, each just {t, dim, action}.
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
      frames.push({ t, dim: s.dimension ? dimOf(s.dimension) : null, action: st?.action || null, phase: st?.phase || null });
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
  return {
    world: tr.world, port: tr.port, startedAt: new Date(start).toISOString(),
    reachedNether: !!netherFrame, minutesToNether: netherFrame ? round((netherFrame.t - start) / 60000) : null,
    minutesMeasured: round(botMs / 60000), minutesRun: round((cap - start) / 60000),
    byPhase: Object.fromEntries(Object.entries(byPhase).sort((a, b) => b[1] - a[1]).map(([k, ms]) => [k, round(ms / 60000)])),
    topOther: Object.entries(otherActions).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, ms]) => [k, round(ms / 60000)]),
  };
}
const round = n => Math.round(n * 10) / 10;

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

  console.log('\nPer trial:');
  for (const r of rows) {
    const nether = r.reachedNether ? `Nether at ${r.minutesToNether} min` : `never reached the Nether (ran ${r.minutesRun} min)`;
    console.log(`  ${r.world} (port ${r.port}, ${r.startedAt}): ${nether}, ${r.minutesMeasured} min measured`);
    const parts = Object.entries(r.byPhase).map(([k, m]) => `${k} ${m}`);
    if (parts.length) console.log(`    ${parts.join(', ')}`);
    if (verbose && r.topOther.length) console.log(`    other: ${r.topOther.map(([k, m]) => `${k} ${m}`).join(', ')}`);
  }
}

module.exports = { measureTrial, phaseOf };
if (require.main === module) main();

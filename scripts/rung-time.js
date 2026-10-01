#!/usr/bin/env node
'use strict';
// The played minutes from spawn to the Nether by rung, and what each rung's
// minutes were (note 787). Per fresh trial (progress-audit.js trialRecords,
// not a fortress or nether checkpoint) from its start to its first Nether
// frame (or its end), every bot-minute of wasted-minutes.js's clock, Jev-down
// minutes left out (scripts/lib/jev-down.js, note 781), is split among the
// rungs its frames were on (by the time each frame stood, five seconds at
// most), and the minute's verdict (wasted-minutes.js classify) is put to each
// rung's share of it:
//   progress   a milestone, a ladder item gained, a rung's target nearer, new
//              ground, or upkeep (food, materials such as logs and coal, healing)
//   crawl      progress under ten blocks in the minute
//   busy       waste that is not a question asked over: standing still, old
//              ground, pacing, digging in place, a stall and its detours, a
//              route failed again, a wait, a death
//   re-asks    one question asked 3+ times in the minute, or the step or an
//              answer turning back and forth (flipping)
//
// The rungs, by what the frame's step or survival action did (the first that
// holds), then the ladder's rung (goal.gameProgress.phase):
//   climb/descend  ascend_to_surface, return_to_surface, a descent, climb_out
//   shelter/night  a shelter, a hold, sleep, the wait for day, night_mine
//   portal         the lava fetch, obsidian, the cast, the walk to the frame,
//                  the enter_nether label
//   food           hunting, cooking, the food errands, nether_food, eating
//   wood           logs, planks, sticks (a step that makes or mines them)
//   table/tools    the crafting table, a wooden pickaxe, the craft of a tool
//   stone          cobblestone, a stone tool's rung
//   iron           iron ore, raw iron, a smelt, iron gear, the shield
//   buckets        the bucket rung, a bucket made
//   other          the rest (the bed, the crossing kit's blocks, fights, ...)
//
//   node scripts/rung-time.js [--since 2026-09-30T12:00:00Z] [--to ISO] [--json] [--dump]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');
const W = require('./wasted-minutes');
const audit = require('./trials/progress-audit');
const JD = require('./lib/jev-down');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const has = name => args.includes(name);
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const MINUTE = 60000, GAP_MS = 60000, CURRENT_MS = 8000;
const round = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;

const RUNGS = ['wood', 'table/tools', 'stone', 'climb/descend', 'iron', 'food', 'buckets', 'portal', 'shelter/night', 'other'];

const CLIMB = /^(ascend_to_surface|return_to_surface|surface|climb_out|descend|descend_to|go_down|dig_down|stair_down|staircase_down|to_depth|descent|down_to|mine_down|recover_surface|surface_trip|leave_shelter|tunnel_out)$/;
const SHELTER = /^(sleep|sleep_in_bed|sleep_failed|bed_nook|bed_left|bed_recover|wait_for_day|wait_for_day_sealed|wait_for_bedtime|wait_in_shelter|pillar_hold|back_to_wall|nook_hold|out_of_sight_hold|out_of_sight|take_cover|box_here|dig_in|dig_in_bunker|dig_nook|shaft_pocket|stay_up|seal_shelter|secure_shelter|sheltered|hold_bunker|hold_box|dig_bunker|box_in|hold_on_span|hold_defensive_position|work_in_pocket|night_mine|mine_nearby|shelter_method|seal_here|box_in_line|open_slit|pocket_next|night)$/;
const PORTAL = /^(fill_bucket|go_to_landmark|to_lava_for_portal|cast_portal|dig_portal_site|clear_cast_walls|return_to_frame|pillar_to_portal|make_obsidian|return_to_portal|buckets_for_portal|to_ruined_portal|into_cave|dig_frame_site|enter_nether|light_portal|portal_plan|portal_method)$/;
const FOOD = /^(hunt_food_for_nether|food_known|food_near_frame|nether_food|top_up_food|top_up_food_near|top_up_cook|cook_meat|cook_food|restock_food|return_for_food|harvest|bake|village_hay|mushroom_stew|search_food|gather_food|food_collected|go_for_food|eat|hunt_mob|stalk_mob|food_errand|fish)$/;
const WOOD_ITEM = /(_log|_planks|_stem|_wood|_hyphae|^stick)$/;
const TABLE_ITEM = /^(crafting_table|wooden_(pickaxe|axe|sword|shovel))$/;
const STONE_ITEM = /^(cobblestone|cobbled_deepslate|stone_(pickaxe|sword|axe|shovel)|furnace|blackstone)$/;
const IRON_ITEM = /^(raw_iron|iron_ore|deepslate_iron_ore|iron_ingot|iron_.*|shield|coal|charcoal|coal_ore|deepslate_coal_ore)$/;
const BUCKET_ITEM = /^(bucket|water_bucket)$/;
const WOOD_STEP = /^(gather_wood|wood_reserve|fetch_stems|top_up_wood|wood_first|chop|fell_tree)$/;
const TABLE_STEP = /^(bootstrap_pickaxe|craft_pickaxe|place_table|craft_table)$/;
const IRON_STEP = /^(smelt|refuel_furnace|settle_smelt|while_cooking|wait_smelt|collect_smelt)$/;
const PHASE_RUNG = p => /^(stone_pickaxe|stone_sword)$/.test(p) ? 'stone'
  : /^(iron_pickaxe|iron_sword|shield|iron_armour|iron_(helmet|chestplate|leggings|boots))$/.test(p) ? 'iron'
  : p === 'bucket' ? 'buckets' : p === 'nether_food' ? 'food' : null;

// What a step makes or works: its item, else what it produces, else its block.
const itemOf = st => st ? String(st.item || Object.keys(st.produces || {})[0] || st.block || '') : '';

const STALL = /^(persist|detour|work_free|shake_loose|unstuck|stay_below|breakout)$/;
function rungOf(f) {
  const sa = f.saNow;
  const stalled = STALL.test(f.step?.a || '');
  const a = (stalled && f.step?.via?.a) || f.step?.a || '';
  const item = (stalled && f.step?.via ? f.step.via.item : f.step?.item) || '';
  if (sa && CLIMB.test(sa)) return 'climb/descend';
  if (sa && SHELTER.test(sa)) return 'shelter/night';
  if (sa && FOOD.test(sa)) return 'food';
  if (CLIMB.test(a)) return 'climb/descend';
  if (SHELTER.test(a)) return 'shelter/night';
  if (PORTAL.test(a)) return 'portal';
  if (FOOD.test(a) || /^cooked_/.test(item)) return 'food';
  if (item === 'flint' || item === 'flint_and_steel' || item === 'obsidian' || item === 'lava_bucket') return 'portal';
  if (WOOD_STEP.test(a) || WOOD_ITEM.test(item)) return 'wood';
  if (TABLE_STEP.test(a) || TABLE_ITEM.test(item)) return 'table/tools';
  if (BUCKET_ITEM.test(item) || f.phase === 'bucket') return 'buckets';
  if (IRON_STEP.test(a) || IRON_ITEM.test(item)) return 'iron';
  if (STONE_ITEM.test(item)) return 'stone';
  if (/(gold|_bed$|_wool$|diamond)/.test(item)) return 'other';
  const p = PHASE_RUNG(f.phase || '');
  if (p) return p;
  // A stall or a dig with no work named, under the portal's rung, is the
  // portal's (the crossing kit's own steps name their items above).
  if ((stalled || /^(tunnel|mine|return_to_mine)$/.test(a)) && f.phase === 'reach_nether') return 'portal';
  return 'other';
}

// The verdict's class put to the four shares.
const shareOf = v => v.cls === 'progress' || v.cls === 'upkeep' ? 'progress' : v.cls === 'slow' ? 'crawl'
  : /^(re-asking|flipping)$/.test(v.pattern) ? 're-asks' : 'busy';

function readTrial({ port, start, end, files }) {
  const frames = [];
  for (const { f, start: fs0, next } of files) {
    if (next < start - GAP_MS || fs0 > end) continue;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const i = line.lastIndexOf('"at":"');
      const t = i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6)));
      if (!(t >= start && t <= end)) continue;
      let raw; try { raw = JSON.parse(line); } catch (_) { continue; }
      const o = W.slim(raw, t);
      const s = raw.snapshot || {}, st = s.step || s.goal?.step;
      if (o.step) {
        o.step.item = itemOf(st);
        // A stall's step is the work it stalled on: persist names the step
        // it retries, a detour the step it came from ("smelt:iron_ingot").
        const via = st.action === 'persist' ? String(st.retrying || '') : st.action === 'detour' ? String(st.from || '') : '';
        if (via) { const [va, vi] = via.split(':'); o.step.via = { a: va, item: vi || '' }; }
      }
      if (o.kind === 'decision' && s.decision?.id) o.ask = { id: s.decision.id, answer: (s.decision.path || []).join('/'), stale: !!s.decision.stale, need: s.decision.state?.need ? String(s.decision.state.need).slice(0, 80) : null };
      frames.push(o);
    }
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

function portFiles(port) {
  const identity = `127_0_0_1-${port}-Jev`;
  let names = [];
  try { names = fs.readdirSync(FLIGHT); } catch (_) { return []; }
  const ms = s => { const m = s.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
  const files = names.filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl'))
    .map(f => ({ f: path.join(FLIGHT, f), start: ms(f.slice(identity.length + 1)) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  files.forEach((x, i) => { x.next = files[i + 1]?.start ?? Infinity; });
  return files;
}

const sourceOf = tr => (String(tr.source || '').match(/first-days-(\d+)/) || String(tr.world || '').match(/^mid-(\d+)/) || [])[1] || '?';

// One trial: per rung, the minutes and their shares; the steps under each.
function measureTrial(tr, to, files) {
  const end = Math.min(tr.end, to);
  const frames = readTrial({ port: tr.port, start: tr.start, end, files });
  const nether = frames.find(f => f.dim === 'nether');
  const cut = nether ? nether.t : end;
  const before = frames.filter(f => f.t < cut);
  // Per frame: the survival action while current, the ladder rung carried.
  let phase = null, sa = null;
  const binRung = new Map(); // minute index -> { rung -> ms }
  const steps = {};          // rung -> step -> ms
  for (let i = 0; i < before.length; i++) {
    const f = before[i];
    if (f.phase) phase = f.phase; else f.phase = phase;
    if (f.sa) sa = f.sa;
    f.saNow = sa && sa.at && f.t - sa.at < CURRENT_MS && sa.a !== 'landmark_found' ? sa.a : null;
    if (!f.step) for (let j = i - 1; j >= 0 && j >= i - 30; j--) if (before[j].step) { f.step = before[j].step; break; }
    const n = before[i + 1];
    const dt = n ? n.t - f.t : 0;
    if (!(dt > 0) || dt > GAP_MS) continue;
    const r = rungOf(f);
    const k = Math.floor((f.t - tr.start) / MINUTE);
    let b = binRung.get(k); if (!b) binRung.set(k, b = {});
    b[r] = (b[r] || 0) + dt;
    const key = `${f.saNow || f.step?.a || 'no step'}${f.step?.item && !f.saNow ? ` (${f.step.item})` : ''}`;
    ((steps[r] ||= {})[key] = (steps[r][key] || 0) + dt);
  }
  const bins = W.minutesOf(before, { start: tr.start });
  const by = {};
  let played = 0, down = 0;
  for (const b of bins) {
    if (!b.botMs) continue;
    const v = W.classify(b.m);
    if (v.cls === 'jev_down') { down += b.botMs; continue; }
    const rs = binRung.get(b.k) || { other: b.botMs };
    const tot = Object.values(rs).reduce((x, y) => x + y, 0) || 1;
    const share = shareOf(v);
    for (const [r, ms] of Object.entries(rs)) {
      const part = b.botMs * ms / tot;
      const o = by[r] ||= { ms: 0, progress: 0, crawl: 0, busy: 0, 're-asks': 0, patterns: {} };
      o.ms += part; o[share] += part;
      if (share !== 'progress') o.patterns[v.pattern] = (o.patterns[v.pattern] || 0) + part;
    }
    played += b.botMs;
  }
  const cutNoNether = !nether && (/cut: /.test(JSON.stringify(tr.verdict?.reasons || '')) || played >= 59 * MINUTE);
  return { world: tr.world, port: tr.port, source: sourceOf(tr), startedAt: new Date(tr.start).toISOString(), reached: !!nether,
    minutesToNether: nether ? round((nether.t - tr.start) / MINUTE) : null, played: played / MINUTE, jevDown: down / MINUTE, cutNoNether, by, steps };
}

function sum(rows) {
  const out = {};
  for (const r of rows) for (const [k, o] of Object.entries(r.by)) {
    const t = out[k] ||= { ms: 0, progress: 0, crawl: 0, busy: 0, 're-asks': 0, patterns: {}, trials: 0 };
    for (const s of ['ms', 'progress', 'crawl', 'busy', 're-asks']) t[s] += o[s];
    for (const [p, ms] of Object.entries(o.patterns)) t.patterns[p] = (t.patterns[p] || 0) + ms;
    if (o.ms >= 30000) t.trials++;
  }
  return out;
}

function tableOf(label, rows) {
  const S = sum(rows), played = rows.reduce((n, r) => n + r.played, 0);
  const lines = [`${label}: ${rows.length} trials, ${rows.filter(r => r.reached).length} reached the Nether, ${round(played)} played pre-Nether min (${round(rows.reduce((n, r) => n + r.jevDown, 0))} Jev-down min left out)`];
  lines.push(`  ${'rung'.padEnd(14)} ${'min'.padStart(7)} ${'share'.padStart(6)} ${'a trial'.padStart(7)} ${'progress'.padStart(9)} ${'crawl'.padStart(6)} ${'busy'.padStart(6)} ${'re-asks'.padStart(8)}  top not-progress patterns`);
  for (const k of RUNGS) {
    const o = S[k]; if (!o) continue;
    const m = o.ms / MINUTE, pc = x => `${Math.round(100 * x / (o.ms || 1))}%`;
    const pats = Object.entries(o.patterns).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, ms]) => `${p} ${round(ms / MINUTE, 0)}`).join(', ');
    lines.push(`  ${k.padEnd(14)} ${String(round(m)).padStart(7)} ${`${Math.round(100 * m / (played || 1))}%`.padStart(6)} ${String(round(m / rows.length)).padStart(7)} ${pc(o.progress).padStart(9)} ${pc(o.crawl).padStart(6)} ${pc(o.busy).padStart(6)} ${pc(o['re-asks']).padStart(8)}  ${pats}`);
  }
  return lines.join('\n');
}

function main() {
  const since = Date.parse(opt('--since', '2026-09-30T12:00:00Z'));
  const to = opt('--to', null) ? Date.parse(opt('--to', null)) : Infinity;
  let trials = audit.trialRecords({ since: since - 1, flight: FLIGHT }).filter(t => t.port && t.start < to && !/\/stages\/(fortress|nether)\//.test(t.source || ''));
  const filesBy = new Map();
  const rows = trials.map((tr, i) => {
    if (!filesBy.has(tr.port)) filesBy.set(tr.port, portFiles(tr.port));
    process.stderr.write(`\r${i + 1}/${trials.length} ${tr.world}`.padEnd(60));
    return measureTrial(tr, to, filesBy.get(tr.port));
  }).filter(r => r.played >= 1);
  process.stderr.write('\n');
  if (has('--json')) { console.log(JSON.stringify({ since: new Date(since).toISOString(), rows: rows.map(r => ({ ...r, steps: undefined })), all: sum(rows) }, null, 1)); return; }
  console.log(tableOf(`All fresh trials since ${new Date(since).toISOString()}`, rows));
  console.log('\n' + tableOf('Cut without the Nether', rows.filter(r => r.cutNoNether)));
  console.log('\n' + tableOf('Reached the Nether', rows.filter(r => r.reached)));
  const worlds = [...new Set(rows.map(r => r.source))].sort();
  console.log('\nBy source world:');
  for (const w of worlds) console.log('\n' + tableOf(`  ${w}`, rows.filter(r => r.source === w)));
  if (has('--dump')) {
    const steps = {};
    for (const r of rows) for (const [k, o] of Object.entries(r.steps)) for (const [s, ms] of Object.entries(o)) ((steps[k] ||= {})[s] = (steps[k][s] || 0) + ms);
    for (const k of RUNGS) if (steps[k]) console.log(`\n${k}: ${Object.entries(steps[k]).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([s, ms]) => `${s} ${round(ms / MINUTE)}`).join(', ')}`);
  }
}

module.exports = { rungOf, shareOf, measureTrial, sum, RUNGS, readTrial, portFiles, sourceOf };
if (require.main === module) main();

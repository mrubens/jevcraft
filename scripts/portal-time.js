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
        // For the per-world measure (note 763): the ladder's rung where the
        // frame carries the goal whole, the survival action named, the
        // decision asked and answered, the pockets and the body.
        rung: s.goal?.gameProgress?.phase || null, doing: s.goal?.gameProgress?.clock?.byDoing || null,
        sa: sa?.action || null, decision: d?.id ? { id: d.id, answer: Array.isArray(d.path) ? d.path.join('/') : null, need: d.state?.need || null,
          ...(/^(kit_food)$/.test(d.id) && Array.isArray(d.path) ? { said: String(d.options?.[d.path.at(-1)]?.description || '').slice(0, 600) } : {}),
          ...(/^(stillness_detour|rung_progress)$/.test(d.id) && /cast portal and enter nether come off their rest|enter nether and cast portal come off their rest/.test(JSON.stringify(d.options || {})) ? { castRested: true } : {}),
          ...(/^(stillness_detour|rung_progress)$/.test(d.id) ? (m => m ? { flip: [m[1], m[2]] } : {})(/turning between ([a-z ]+?) and ([a-z ]+?) (?:\d+ times|again)/.exec(JSON.stringify(d.state || {}))) : {}) } : null,
        chat: o.kind === 'chat' && o.detail?.from === 'Jev' ? String(o.detail.message || '') : null,
        inventory: s.inventory && typeof s.inventory === 'object' ? s.inventory : null, equipment: s.equipment || null,
        health: typeof s.health === 'number' ? s.health : null, food: typeof s.food === 'number' ? s.food : null,
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
  const before = frames.filter(f => f.t < cut);
  const lava = lavaFetch(before);
  return {
    world: tr.world, source: sourceOf(tr), port: tr.port, startedAt: new Date(start).toISOString(), lava,
    startY: before.find(f => f.pos)?.pos.y ?? null, work: workMinutes(before), height: heightTrips(before), strategy: strategyFlips(before),
    rungs: rungMinutes(before), kit: netherFrame ? entryKit(before) : null, stay: netherFrame ? netherStay(frames.filter(f => f.t >= cut)) : null,
    cut: /cut: /.test((tr.verdict?.reasons || []).join(' ')) || (!netherFrame && (cap - start) >= 59 * 60000),
    sim: simulate(before),
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
  // A walk to a pool that got there, followed within thirty seconds by the
  // dig for the deep lava while still within twelve blocks of the pool: the
  // pass read from where the walk began (note 753d).
  let arrivedThenDeep = 0, lastPool = null;
  for (const f of over) {
    if (f.action === 'go_to_landmark' && f.target) { lastPool = { at: f.target, t: f.t }; continue; }
    if (lastPool && f.action === 'fill_bucket' && f.phase === 'tunnel' && f.target && f.target.y <= LAVA_DEPTH + 2 && f.pos && f.t - lastPool.t < 30000 && near3(f.pos, lastPool.at, 12)) { arrivedThenDeep++; lastPool = null; }
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
    arrivedThenDeep, castWaterMinutes: round(castWaterMs / 60000), castWaterStalls, stalls, repeatStalls, detoursWithPool, detoursToPool, surveys: surveys.length, surveyMinutes: round(surveyMs / 60000), surveySkippableMinutes: round(skippableMs / 60000), caveLegs, caveLegMinutes: round(caveLegMs / 60000) };
}

// The per-source-world measure (note 763). Nether reach collapsed on every
// source world but 242; these read where the pre-Nether minutes of each
// went, what the climbs were for, how often win_strategy turned, and what
// the bot carried into the Nether and what that stay came to.
const sourceOf = tr => (String(tr.source || '').match(/first-days-(\d+)/) || String(tr.world || '').match(/^mid-(\d+)/) || [])[1] || '?';

// Each pre-Nether frame's minutes, by what it was for. The first that
// matches wins: a climb is a climb whatever it climbed for (its reasons are
// in heightTrips), the lava fetch and the cast are the portal's own work,
// food and the bed are the rungs that are not the Nether's, the rest by the
// ladder's rung where the goal names it.
const CAST = /^(cast_portal|dig_portal_site|clear_cast_walls|return_to_frame|pillar_to_portal|make_obsidian|return_to_portal|buckets_for_portal|to_ruined_portal|into_cave|dig_frame_site)$/;
const FOOD = /^(hunt_food_for_nether|food_known|food_near_frame|nether_food|top_up_food|top_up_food_near|top_up_cook|cook_meat|restock_food|return_for_food|harvest|bake|village_hay|mushroom_stew)$/;
const FOOD_SA = /^(search_food|gather_food|food_collected|cook_food|go_for_food)$/;
const BED = /^(gather_wool|shear_sheep|cut_cobwebs|take_home_bed|village_bed)$/;
const NIGHT_SA = /^(night_mine|mine_nearby|secure_shelter|seal_shelter|sheltered|wait_in_shelter|dig_in|shaft_pocket|leave_shelter|sleep|work_in_pocket|tunnel_out|pillar_hold)$/;
const GEAR_RUNG = /^(stone_pickaxe|stone_sword|iron_pickaxe|shield|iron_sword|bucket|iron_armour|iron_(helmet|chestplate|leggings|boots)|golden_boots|bow|arrows|diamond_sword|nether_pickaxe|nether_blocks|nether_chest)$/;
function workOf(f, rung) {
  const a = f.action || '';
  if (a === 'ascend_to_surface') return 'climb up';
  if (FETCH.test(a)) return 'lava fetch';
  if (CAST.test(a)) return 'cast';
  if (FOOD.test(a) || FOOD_SA.test(f.sa || '') || rung === 'nether_food') return 'food';
  if (BED.test(a) || /^(bed|home_bed|carry_bed)$/.test(rung || '')) return 'bed and wool';
  if (NIGHT_SA.test(f.sa || '') || /^(night_mine|mine_nearby)$/.test(a)) return 'night';
  if (a === 'enter_nether') return 'enter_nether label';
  if (GEAR_RUNG.test(rung || '')) return `gear rungs`;
  return a ? 'other' : 'no step';
}
function workMinutes(frames) {
  const out = {};
  let rung = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.rung) rung = f.rung;
    const dt = (frames[i + 1]?.t ?? f.t) - f.t;
    if (!(dt > 0) || dt > GAP_MS) continue;
    const k = workOf(f, rung);
    out[k] = (out[k] || 0) + dt / 60000;
  }
  return Object.fromEntries(Object.entries(out).map(([k, m]) => [k, round(m)]));
}

// The climbs to open sky and the trips between the depth and the surface:
// each climb (ascend_to_surface frames no more than a minute apart) with the
// blocks it rose, its minutes, the rung it was on and the question answered
// just before it that sent it up (not climb_out, which chose how, nor the
// turn's or a fight's); and the times the bot went from the depth (under
// y 40) to the surface (y 60 or more) and back.
const DEEP_Y = 40, HIGH_Y = 60;
const WHY_SKIP = /^(climb_out|turn_priority|encounter_stance|shot_answer|body_way|unstuck_move|while_cooking|combat_kit)$/;
function heightTrips(frames) {
  const climbs = [];
  let cur = null, rung = null;
  const recent = [];
  for (const f of frames) {
    if (f.rung) rung = f.rung;
    if (f.decision && !WHY_SKIP.test(f.decision.id)) { recent.push({ t: f.t, ...f.decision }); while (recent.length && f.t - recent[0].t > 90000) recent.shift(); }
    if (f.action !== 'ascend_to_surface') continue;
    if (cur && f.t - cur.last <= GAP_MS) { cur.last = f.t; if (f.pos) cur.top = Math.max(cur.top, f.pos.y); continue; }
    if (cur) climbs.push(cur);
    const why = recent.filter(d => d.t <= f.t).at(-1);
    cur = { t: f.t, last: f.t, from: f.pos?.y ?? null, top: f.pos?.y ?? -Infinity, rung, why: why ? `${why.id}:${why.answer}${why.need ? ` (${String(why.need).slice(0, 48)})` : ''}` : 'none asked' };
  }
  if (cur) climbs.push(cur);
  let band = null, ups = 0, downs = 0;
  for (const f of frames) {
    if (!f.pos || (f.dim && f.dim !== 'overworld')) continue;
    const b = f.pos.y < DEEP_Y ? 'deep' : f.pos.y >= HIGH_Y ? 'high' : null;
    if (!b) continue;
    if (band && b !== band) { if (b === 'high') ups++; else downs++; }
    band = b;
  }
  return { climbs: climbs.map(c => ({ minutes: round((c.last - c.t) / 60000), rose: Number.isFinite(c.top) && c.from !== null ? Math.max(0, Math.round(c.top - c.from)) : 0, rung: c.rung, why: c.why })), ups, downs };
}

// win_strategy's answers before the Nether: how often asked, how often the
// answer turned (the Nether now and the ladder's reach-nether stage are the
// same answer: one sets the rungs aside, the other goes on without them),
// how many of those within a minute, and the work under way when it turned.
const SAME_ANSWER = a => /^(nether_first|stage_reach_nether)$/.test(a) ? 'the Nether' : a;
function strategyFlips(frames) {
  let asks = 0, flips = 0, quick = 0, prev = null, step = null;
  const abandoned = {}, pairs = {};
  for (const f of frames) {
    if (!f.decision && f.action) step = f.action;
    if (f.decision?.id !== 'win_strategy' || !f.decision.answer) continue;
    asks++;
    const a = SAME_ANSWER(f.decision.answer);
    if (prev && prev.a !== a) {
      flips++; if (f.t - prev.t < 60000) quick++;
      abandoned[step || 'none'] = (abandoned[step || 'none'] || 0) + 1;
      const k = `${prev.a} -> ${a}`; pairs[k] = (pairs[k] || 0) + 1;
    }
    prev = { a, t: f.t };
  }
  return { asks, flips, quick, abandoned, pairs };
}

// Minutes by rung from the bot's own run clock (game-progress.js tallyClock:
// "rung: step" for work, a survival action by its name), the last reading
// before the Nether.
function rungMinutes(frames) {
  const doing = frames.filter(f => f.doing).at(-1)?.doing;
  if (!doing) return null;
  const out = {};
  for (const [k, ms] of Object.entries(doing)) { const r = k.includes(': ') ? k.split(': ')[0] : `(survival) ${k}`; out[r] = (out[r] || 0) + ms / 60000; }
  return Object.fromEntries(Object.entries(out).map(([k, m]) => [k, round(m)]));
}

// What was carried into the Nether: food points, a bed, armor pieces worn,
// pickaxes, building blocks, the lava buckets' iron aside.
let FOODS = null;
function foodPoints(inv) {
  if (!FOODS) { try { FOODS = require('minecraft-data')('26.1').foodsByName; } catch (_) { FOODS = {}; } }
  return Object.entries(inv || {}).reduce((n, [k, c]) => n + (/^(rotten_flesh|spider_eye|poisonous_potato|pufferfish|chicken)$/.test(k) ? 0 : (FOODS[k]?.foodPoints || 0) * (+c || 0)), 0);
}
function entryKit(frames) {
  const inv = frames.filter(f => f.inventory).at(-1)?.inventory || {};
  const eq = frames.filter(f => f.equipment).at(-1)?.equipment || {};
  const armor = ['head', 'torso', 'legs', 'feet'].filter(s => eq[s]).length;
  const n = re => Object.entries(inv).filter(([k]) => re.test(k)).reduce((s, [, c]) => s + (+c || 0), 0);
  return { food: foodPoints(inv), bed: n(/_bed$/) > 0, armor, pickaxes: n(/_pickaxe$/), blocks: n(/^(cobblestone|cobbled_deepslate|dirt|netherrack|blackstone|andesite|diorite|granite|tuff)$/) };
}
// The stay the Nether entry began: minutes until the bot was back in the
// Overworld (or the record ends), whether it ended in a death, and the most
// rods held in the trial.
function netherStay(frames) {
  let end = frames[0]?.t ?? 0, died = false, rods = 0, prevH = null;
  for (const f of frames) {
    if (f.dim === 'overworld') break;
    end = f.t;
    if (f.health !== null) { if (prevH !== null && prevH > 0 && f.health <= 0) { died = true; break; } prevH = f.health; }
  }
  for (const f of frames) if (f.inventory) rods = Math.max(rods, (+f.inventory.blaze_rod || 0) + (+f.inventory.blaze_powder || 0) / 2);
  return { minutes: round((end - (frames[0]?.t ?? end)) / 60000), died, rods };
}

// Note 763's rules replayed on the recorded frames, before and after:
// what the recorded questions and choices would have met under them.
//  strategy: win_strategy asks the new holds would not have made (the ask
//    right after the Nether now, within the hold; an ask with an errand the
//    held answer began under way: the lava fetch, the cast, a climb, a food
//    trip, the frame before it within 30 s), and the turns among them.
//  lava: the deep lava announced with a pool known passed, and whether the
//    dig and carry back (obsidian.js digCarry) takes the pool instead; the
//    deep digging minutes after those announcements (to the next bucket or
//    ten minutes).
//  food: food trips for the Nether taken (kit_food top_up_food and _near)
//    that a climb followed within two minutes: the seconds the option said,
//    and the climb and way back down at the measured pace (levels.js).
const ERRAND = /^(fill_bucket|go_to_landmark|to_lava_for_portal|cast_portal|ascend_to_surface|hunt_food_for_nether|food_known|food_near_frame)$/;
function simulate(frames) {
  const LEVEL = require('../src/levels').LEVEL_RECORD;
  let asks = 0, held = 0, flips = 0, flipsHeld = 0, prev = null, lastAction = null;
  for (const f of frames) {
    if (!f.decision && f.action) lastAction = { a: f.action, t: f.t };
    if (f.decision?.id !== 'win_strategy' || !f.decision.answer) continue;
    asks++;
    const a = SAME_ANSWER(f.decision.answer), turned = prev && prev.a !== a;
    if (turned) flips++;
    const afterNow = prev && prev.raw === 'nether_first' && f.t - prev.t < 600000 && a === 'the Nether';
    const midErrand = prev && f.t - prev.t < 600000 && lastAction && f.t - lastAction.t < 30000 && ERRAND.test(lastAction.a);
    if (afterNow || midErrand) { held++; if (turned) flipsHeld++; }
    else prev = { a, raw: f.decision.answer, t: f.t };
    if (!prev) prev = { a, raw: f.decision.answer, t: f.t };
  }
  // The lava picker.
  const DEEP = /Digging down for the deep lava at y (-?\d+), (\d+) blocks down[^;]*; the pool known at \((-?\d+), (-?\d+), (-?\d+)\) is passed: (\d+) blocks off, too far to dig to/;
  const legSeconds = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / 4.3 + (Math.abs(a.y - b.y) > 8 ? Math.abs(a.y - b.y) * 3 : 0);
  const digCarry = (here, p) => Math.max(Math.hypot(p.x - here.x, p.z - here.z), Math.abs(p.y - here.y)) * 3 + legSeconds(p, here);
  let passed = 0, taken = 0, deepAfterMs = 0;
  for (let i = 0; i < frames.length; i++) {
    const m = frames[i].chat && DEEP.exec(frames[i].chat);
    if (!m || !frames[i].pos) continue;
    passed++;
    const here = frames[i].pos, pool = { x: +m[3], y: +m[4], z: +m[5] }, deep = { x: here.x + 24, y: +m[1], z: here.z };
    if (digCarry(here, pool) < digCarry(here, deep)) {
      taken++;
      const lava0 = frames[i].lava;
      for (let j = i + 1; j < frames.length && frames[j].t - frames[i].t < 600000; j++) {
        if (frames[j].lava !== null && lava0 !== null && frames[j].lava > lava0) break;
        const dt = frames[j].t - frames[j - 1].t;
        if (dt > 0 && dt <= GAP_MS && frames[j - 1].action === 'fill_bucket') deepAfterMs += dt;
      }
    }
  }
  // The food trips.
  let trips = 0, saidS = 0, climbS = 0;
  for (let i = 0; i < frames.length; i++) {
    const d = frames[i].decision;
    if (d?.id !== 'kit_food' || !/top_up_food/.test(d.answer || '')) continue;
    const up = frames.slice(i + 1).find(g => g.t - frames[i].t < 120000 && g.action === 'ascend_to_surface');
    if (!up) continue;
    let top = up.pos?.y ?? null;
    for (const g of frames) if (g.t >= up.t && g.t - up.t < 900000 && g.pos && (g.action === 'ascend_to_surface' || g.t - up.t < 30000)) top = Math.max(top ?? g.pos.y, g.pos.y);
    const rise = top !== null && frames[i].pos ? Math.max(0, top - frames[i].pos.y) : 0;
    if (rise < 8) continue;
    trips++;
    const said = /about (\d+) seconds in all|about (\d+) minutes in all/.exec(d.said || '');
    saidS += said ? (said[1] ? +said[1] : +said[2] * 60) : 0;
    climbS += rise * (LEVEL.upSecondsABlock + LEVEL.downSecondsABlock);
  }
  // The cast rested as a flip with its lava in hand (note 763): the stall's
  // questions asked while the cast and the dispatch label rested together
  // with a lava bucket carried, and the walks to the frame among them.
  let castAsks = 0, castFrameWalks = 0, lavaNow = 0, restUntil = 0;
  for (const f of frames) {
    if (f.lava !== null) lavaNow = f.lava;
    if (f.decision?.castRested && lavaNow) restUntil = f.t + 5 * 60000;
    if (!(f.t <= restUntil) || !/^(stillness_detour|rung_progress)$/.test(f.decision?.id || '')) continue;
    castAsks++;
    if (/to_portal_frame/.test(f.decision.answer || '')) castFrameWalks++;
  }
  // The stall's questions raised for a flip (note 763's portal fact): one
  // with the ladder's label enter_nether in it is not a flip now; one of two
  // portal steps is asked as portal_method, no rest; the others unchanged.
  const PORTAL = /^(enter nether|cast portal|fill bucket|go to landmark|to lava for portal|ascend to surface|return to portal|return to frame|dig portal site|buckets for portal|to ruined portal|make obsidian|clear cast walls|pillar to portal)$/;
  let flipAsks = 0, labelFlips = 0, portalFlips = 0;
  for (const f of frames) {
    const fl = f.decision?.flip;
    if (!fl) continue;
    flipAsks++;
    if (fl.includes('enter nether')) labelFlips++;
    else if (fl.every(n => PORTAL.test(n))) portalFlips++;
  }
  return { flip: { asks: flipAsks, label: labelFlips, portal: portalFlips }, cast: { asks: castAsks, frameWalks: castFrameWalks }, strategy: { asks, held, flips, flipsHeld }, lava: { passed, taken, deepAfterMinutes: round(deepAfterMs / 60000) }, food: { trips, saidMinutes: round(saidS / 60), climbMinutes: round(climbS / 60) } };
}

// The report by source world, and 242 against the rest.
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
function byWorld(rows) {
  const groups = {};
  for (const r of rows) (groups[r.source] ||= []).push(r);
  const out = {};
  for (const [w, rs] of Object.entries(groups)) out[w] = summarize(rs);
  const rest = rows.filter(r => r.source !== '242');
  if (rest.length && rows.some(r => r.source === '242')) out['all but 242'] = summarize(rest);
  return out;
}
function summarize(rs) {
  const reached = rs.filter(r => r.reachedNether);
  const pre = rs.reduce((n, r) => n + r.minutesMeasured, 0) || 1;
  const work = {};
  for (const r of rs) for (const [k, m] of Object.entries(r.work || {})) work[k] = (work[k] || 0) + m;
  const climbs = rs.flatMap(r => r.height?.climbs || []);
  const why = {};
  for (const c of climbs) { const k = `${c.rung || '?'} <- ${c.why}`; (why[k] ||= { n: 0, minutes: 0, rose: 0 }); why[k].n++; why[k].minutes += c.minutes; why[k].rose += c.rose; }
  const st = rs.map(r => r.strategy).filter(Boolean);
  const sumOf = (list, k) => list.reduce((n, x) => n + (x[k] || 0), 0);
  const merge = k => { const o = {}; for (const s of st) for (const [a, n] of Object.entries(s[k] || {})) o[a] = (o[a] || 0) + n; return o; };
  const rungs = {};
  for (const r of rs) for (const [k, m] of Object.entries(r.rungs || {})) rungs[k] = (rungs[k] || 0) + m;
  const top = (o, n) => Object.entries(o).sort((a, b) => (b[1].minutes ?? b[1]) - (a[1].minutes ?? a[1])).slice(0, n);
  return {
    trials: rs.length, reached: reached.length, cut: rs.filter(r => r.cut).length, medianMinutes: median(reached.map(r => r.minutesToNether)), medianStartY: Math.round(median(rs.map(r => r.startY)) ?? NaN),
    preNetherMinutes: round(pre), perTrial: round(pre / rs.length),
    work: Object.fromEntries(top(work, 20).map(([k, m]) => [k, { minutes: round(m), share: round(100 * m / pre) }])),
    climbs: climbs.length, climbMinutes: round(climbs.reduce((n, c) => n + c.minutes, 0)), blocksRisen: climbs.reduce((n, c) => n + c.rose, 0),
    ups: rs.reduce((n, r) => n + (r.height?.ups || 0), 0), downs: rs.reduce((n, r) => n + (r.height?.downs || 0), 0),
    climbsFor: Object.fromEntries(top(why, 12).map(([k, v]) => [k, { n: v.n, minutes: round(v.minutes), rose: v.rose }])),
    lavaBuckets: rs.reduce((n, r) => n + (r.lava?.buckets || 0), 0),
    strategy: { asks: sumOf(st, 'asks'), flips: sumOf(st, 'flips'), quick: sumOf(st, 'quick'), perHour: round(sumOf(st, 'asks') / (pre / 60)), flipsPerHour: round(sumOf(st, 'flips') / (pre / 60)),
      abandoned: Object.fromEntries(top(merge('abandoned'), 8)), pairs: Object.fromEntries(top(merge('pairs'), 6)) },
    rungs: Object.fromEntries(top(rungs, 16).map(([k, m]) => [k, round(m)])),
    sim: {
      asks: rs.reduce((n, r) => n + (r.sim?.strategy.asks || 0), 0), held: rs.reduce((n, r) => n + (r.sim?.strategy.held || 0), 0),
      flips: rs.reduce((n, r) => n + (r.sim?.strategy.flips || 0), 0), flipsHeld: rs.reduce((n, r) => n + (r.sim?.strategy.flipsHeld || 0), 0),
      poolsPassed: rs.reduce((n, r) => n + (r.sim?.lava.passed || 0), 0), poolsTaken: rs.reduce((n, r) => n + (r.sim?.lava.taken || 0), 0), deepAfterMinutes: round(rs.reduce((n, r) => n + (r.sim?.lava.deepAfterMinutes || 0), 0)),
      flipAsks: rs.reduce((n, r) => n + (r.sim?.flip?.asks || 0), 0), labelFlips: rs.reduce((n, r) => n + (r.sim?.flip?.label || 0), 0), portalFlips: rs.reduce((n, r) => n + (r.sim?.flip?.portal || 0), 0),
      castRestAsks: rs.reduce((n, r) => n + (r.sim?.cast?.asks || 0), 0), castFrameWalks: rs.reduce((n, r) => n + (r.sim?.cast?.frameWalks || 0), 0),
      foodTrips: rs.reduce((n, r) => n + (r.sim?.food.trips || 0), 0), foodSaidMinutes: round(rs.reduce((n, r) => n + (r.sim?.food.saidMinutes || 0), 0)), foodClimbMinutes: round(rs.reduce((n, r) => n + (r.sim?.food.climbMinutes || 0), 0)),
    },
  };
}
// What the kit carried into the Nether came to: stays by food carried at
// entry, bed, armor worn.
function kitRecord(rows) {
  const stays = rows.filter(r => r.kit && r.stay);
  const band = (label, list) => ({ label, n: list.length, died: list.filter(r => r.stay.died).length, rodsMedian: median(list.map(r => r.stay.rods)), anyRod: list.filter(r => r.stay.rods >= 1).length, stayMedian: median(list.map(r => r.stay.minutes)) });
  return [
    band('food under 24 points', stays.filter(r => r.kit.food < 24)), band('food 24 to 79', stays.filter(r => r.kit.food >= 24 && r.kit.food < 80)), band('food 80 or more', stays.filter(r => r.kit.food >= 80)),
    band('a bed carried', stays.filter(r => r.kit.bed)), band('no bed', stays.filter(r => !r.kit.bed)),
    band('full armor worn', stays.filter(r => r.kit.armor >= 4)), band('under four pieces', stays.filter(r => r.kit.armor < 4)),
    band('two or more pickaxes', stays.filter(r => r.kit.pickaxes >= 2)), band('one pickaxe', stays.filter(r => r.kit.pickaxes < 2)),
  ];
}

function main() {
  let trials = audit.trialRecords({ since: since - 1, flight: FLIGHT }).filter(t => t.port && t.start < to);
  if (onlyPort) trials = trials.filter(t => Number(t.port) === onlyPort);
  trials = trials.filter(t => !/\/stages\/(fortress|nether)\//.test(t.source || ''));
  const rows = trials.map(measureTrial);
  if (asJson) { console.log(JSON.stringify({ since: new Date(since).toISOString(), byWorld: byWorld(rows), kitRecord: kitRecord(rows), trials: rows }, null, 2)); return; }
  if (has('--by-world')) { printByWorld(rows); return; }

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
  console.log(`  Pool walks that got there and then dug for the deep lava within 30 s, within 12 blocks of the pool: ${sum('arrivedThenDeep')} (note 753d).`);
  console.log(`  The cast held up by water in its slot (stop_water, fill_source, drain): ${round(sum('castWaterMinutes'))} min, ${sum('castWaterStalls')} stalls meanwhile (note 753c).`);
  console.log(`  Navigation stalls before the Nether: ${sum('stalls')}, ${sum('repeatStalls')} of them at a spot stalled at twice already in fifteen minutes (note 753b).`);
  console.log(`  Stall questions answered with a pool found within 128 blocks: ${sum('detoursWithPool')}, ${sum('detoursToPool')} of them going to it or to the frame (note 753b).`);
  console.log(`  Walks to a remembered pool that went 16+ blocks below both their start and the pool: ${sum('caveLegs')}, ${round(sum('caveLegMinutes'))} min from there to the walk's end.`);

  printByWorld(rows);
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

function printByWorld(rows) {
  const W = byWorld(rows);
  console.log('\nBy source world (note 763):');
  for (const [w, s] of Object.entries(W)) {
    console.log(`  ${w}: ${s.reached} of ${s.trials} reached the Nether${s.medianMinutes !== null ? `, median ${s.medianMinutes} min` : ''}; ${s.cut} ran an hour without it; started at y ${s.medianStartY ?? '?'} (median); ${s.perTrial} pre-Nether min a trial`);
    console.log(`    work: ${Object.entries(s.work).map(([k, v]) => `${k} ${v.minutes} (${v.share}%)`).join(', ')}`);
    console.log(`    climbs: ${s.climbs}, ${s.climbMinutes} min, ${s.blocksRisen} blocks risen; depth to surface ${s.ups} times, surface to depth ${s.downs}; lava buckets ${s.lavaBuckets} (${round(s.lavaBuckets / s.trials)} a trial)`);
    console.log(`    climbs for (rung <- the question before): ${Object.entries(s.climbsFor).map(([k, v]) => `${k} ${v.n}x ${v.minutes} min`).join('; ')}`);
    console.log(`    win_strategy: ${s.strategy.asks} asks (${s.strategy.perHour} an hour), ${s.strategy.flips} turned (${s.strategy.flipsPerHour} an hour, ${s.strategy.quick} within a minute); work under way when it turned: ${Object.entries(s.strategy.abandoned).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    console.log(`    rungs (run clock): ${Object.entries(s.rungs).map(([k, m]) => `${k} ${m}`).join(', ')}`);
    const x = s.sim;
    console.log(`    replayed under note 763: win_strategy ${x.asks} asks -> ${x.asks - x.held} (${x.held} held), ${x.flips} turns -> ${x.flips - x.flipsHeld}; deep lava with a pool passed ${x.poolsPassed}, the pool taken instead ${x.poolsTaken} (${x.deepAfterMinutes} min of lava fetch after them); food trips that climbed ${x.foodTrips}, said as ${x.foodSaidMinutes} min, the climb and back alone ${x.foodClimbMinutes} min; stall questions with the cast rested as a flip and lava in hand ${x.castRestAsks} (${x.castFrameWalks} of them walks to the frame); stall questions for a flip ${x.flipAsks}, ${x.labelFlips} with the label enter_nether (not a flip now), ${x.portalFlips} of two portal steps (portal_method now, no rest)`);
  }
  console.log('\nNether stays by the kit carried in:');
  for (const b of kitRecord(rows)) console.log(`  ${b.label}: ${b.n} stays, ${b.died} ended in a death, ${b.anyRod} brought a rod, rods median ${b.rodsMedian ?? '-'}, stay median ${b.stayMedian ?? '-'} min`);
}

module.exports = { simulate, measureTrial, phaseOf, lavaFetch, workOf, workMinutes, heightTrips, strategyFlips, rungMinutes, entryKit, netherStay, byWorld, summarize, kitRecord, sourceOf, foodPoints };
if (require.main === module) main();

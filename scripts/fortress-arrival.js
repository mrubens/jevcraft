#!/usr/bin/env node
'use strict';
// From a fortress first seen to the first blaze fight: where the time goes
// (trial note 750). Per trial (every trial begun since --since, fresh or from
// a checkpoint): when a fortress was first known (a find_fortress step naming
// one, the at_spawner step, or a fortress question asked), when the bot first
// stood on its floors (the patrol's own walking/patrolling/exploring step, or
// at_spawner / wait_at_spawner), the first blaze fight (a fight step or a
// fight reflex with a blaze within 10 blocks, or hunt_target answered with a
// fight), and the first blaze rod gained. Between the sighting and the first
// fight: the minutes by the work question and answer that held them (the
// last question asked that is not a reflex: turn_priority, encounter_stance,
// shot_answer and the like are said apart), the no_route frames, the
// "A fortress!" chats said at a fortress already known, and the minutes a
// blaze was within 16 blocks with no fight on. Then the loop shapes: each
// minute of that span in which three or more work questions were answered
// and the bot ended under 12 blocks from where the minute began, grouped by
// the questions asked in it, ranked by minutes, each with a trial and time.
// Read-only; it changes no behavior.
//
//   node scripts/fortress-arrival.js [--since 2026-09-29T23:00:00Z] [--to ISO]
//                                    [--port N] [--json] [--verbose]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');

const GAP_MS = 60000; // a gap under a minute between frames is bot time (same cut as portal-time.js)
const FIGHT_NEAR = 10, REACH_NEAR = 16;
// Reflexes: asked about a body in the moment, not the way on. Their minutes
// are said apart, the work question under them keeps the clock.
const REFLEX = /^(turn_priority|encounter_stance|shot_answer|survival_priority|body_way|unstuck_move|climb_out|way_down|pocket_next|shelter_method|combat_kit|while_cooking)$/;
// Steps and reflexes that are a fight with what is near.
const FIGHT_STEP = /^(hunt_mob|close_in|charge_nearest|blaze_sortie|corner_ambush|stalk_mob|dig_toward_them|take_the_door|break_their_line|dig_in_and_fight|strike_at_arm|fight|fight_at_spawner|fight_from_footing)$/;
const FIGHT_SURVIVAL = /^(fight|charge|charge nearest|fight at spawner|fight from footing|defend|corner ambush|close in|strike at arm|back to wall)$/;
const HUNT_FIGHT = /^(?!defer$|leave_and_heal$|none_good$|heal_first$|box_|open_slit|dig_in|seal|retreat|leave).+/;
const ON_FLOORS = st => !!st && (st.walking || st.patrolling || st.exploring || st.action === 'at_spawner' || st.action === 'wait_at_spawner');
const KNOWN = st => !!st && ((st.action === 'find_fortress' && (st.found || st.fortress)) || st.action === 'at_spawner' || st.action === 'wait_at_spawner' || st.action === 'go_to_spawner');
const GO_ON = /^(carry_on|keep_on|keep_working|keep_at_it|none_good)$/;
const FORTRESS_Q = /^(fortress_visit|fortress_approach)$/;

const dimOf = d => String(d || '').replace(/^minecraft:/, '').replace(/^the_/, '');
const round = n => Math.round(n * 10) / 10;
const iso = t => new Date(t).toISOString().slice(0, 19) + 'Z';

// Where a step or question says the fortress is: the anchor, the brick
// found, or the spawner's cage.
const placeOf = (st, target) => st?.fortress || st?.found || ((st?.action === 'at_spawner' || st?.action === 'wait_at_spawner' || st?.action === 'go_to_spawner') ? st.target || st.spawner : null) || target || null;
const SAME = 160; // blocks: one fortress's corridors run about 112 from where it begins

// Frames -> the measure, one episode per fortress known. `frames`:
// [{ t, kind, label, detail, snapshot }] in time order, the flight
// recorder's own shape with `t` as ms (snapshot: step, mobs, position,
// inventory, decision). An episode begins at the first frame naming a
// fortress not already known this trial (by its anchor's firstAt, else
// within 160 blocks) and ends at the first blaze fight while it is the one
// last named, or at `end`. Pure.
function measureFrames(frames, { end = Infinity } = {}) {
  const episodes = [];
  let current = null, firstRods = null, lastMobs = [], lastMobsAt = -Infinity, lastPos = null;
  const episodeFor = (p, firstAt, t) => {
    let e = episodes.find(x => (firstAt && x.firstAt === firstAt) || (p && x.at && Math.hypot(x.at.x - p.x, x.at.z - p.z) <= SAME));
    // A fortress question asked before any step named the place: that
    // episode is this place's.
    if (!e && p && current && !current.at) { e = current; e.at = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) }; }
    if (!e) {
      e = { sighted: t, at: p ? { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } : null, firstAt: firstAt || null, onFloors: null, blazeNear: null, fight: null, rod: null,
        byWork: {}, byStep: {}, counts: {}, noRoute: 0, falseFind: 0, blazeNearMs: 0, deferNear: 0, botMs: 0, work: 'before any question', minutes: new Map(), pos: [] };
      if (lastPos) e.pos.push({ t, p: lastPos });
      episodes.push(e);
    }
    if (firstAt && !e.firstAt) e.firstAt = firstAt;
    return e;
  };
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], s = f.snapshot || {}, st = s.step;
    if (Array.isArray(s.mobs)) { lastMobs = s.mobs; lastMobsAt = f.t; }
    if (s.position) lastPos = s.position;
    const inv = s.inventory;
    if (inv && firstRods === null) firstRods = inv.blaze_rod || 0;
    const q = f.kind === 'decision' ? s.decision?.id : null;
    const place = KNOWN(st) || (q && FORTRESS_Q.test(q)) ? placeOf(st, s.decision?.target) : null;
    if (place || (!current && q && FORTRESS_Q.test(q))) current = episodeFor(place, st?.fortress?.firstAt, f.t);
    const e = current;
    if (!e) continue;
    if (s.position) e.pos.push({ t: f.t, p: s.position });
    const mobs = f.t - lastMobsAt <= 5000 ? lastMobs : [];
    const blaze = mobs.filter(m => m.name === 'blaze').reduce((d, m) => Math.min(d, m.d ?? Infinity), Infinity);
    if (inv && e.rod === null && (inv.blaze_rod || 0) > (e.rodsAt ??= inv.blaze_rod || 0)) e.rod = f.t;
    if (e.fight !== null) continue;
    if (e.onFloors === null && ON_FLOORS(st)) e.onFloors = f.t;
    if (e.blazeNear === null && blaze <= REACH_NEAR) e.blazeNear = f.t;
    const stepFight = st && FIGHT_STEP.test(st.action || '') && (st.action !== 'hunt_mob' || st.entity === 'blaze') && blaze <= FIGHT_NEAR;
    const reflexFight = f.kind === 'survival' && FIGHT_SURVIVAL.test(f.label || '') && blaze <= FIGHT_NEAR;
    const hunted = q === 'hunt_target' && HUNT_FIGHT.test(f.label || '') && blaze <= REACH_NEAR;
    if (stepFight || reflexFight || hunted) { e.fight = f.t; continue; }
    // The span's clock.
    if (f.kind === 'no_route') e.noRoute++;
    if (f.kind === 'chat' && /A fortress!/.test(String(f.detail?.message ?? '')) && f.t - e.sighted > 30000) e.falseFind++;
    if (q) {
      const key = `${q} ${f.label || '?'}`;
      e.counts[key] = (e.counts[key] || 0) + 1;
      if (!REFLEX.test(q)) {
        // Carrying on is the work already holding, not a new one.
        if (!GO_ON.test(f.label || '')) e.work = key;
        const m = Math.floor((f.t - e.sighted) / 60000);
        const b = e.minutes.get(m) || { qs: new Map(), ans: new Map(), n: 0, at: f.t };
        b.qs.set(q, (b.qs.get(q) || 0) + 1); b.ans.set(key, (b.ans.get(key) || 0) + 1); b.n++;
        e.minutes.set(m, b);
        if (q === 'hunt_target' && f.label === 'defer' && blaze <= REACH_NEAR) e.deferNear++;
      }
    }
    const next = Math.min(frames[i + 1]?.t ?? end, end);
    const dt = next - f.t;
    if (!(dt > 0) || dt > GAP_MS) continue;
    e.botMs += dt;
    e.byWork[e.work] = (e.byWork[e.work] || 0) + dt;
    const act = st?.action || (f.kind === 'survival' ? `reflex: ${f.label}` : 'no step');
    e.byStep[act] = (e.byStep[act] || 0) + dt;
    if (blaze <= REACH_NEAR) e.blazeNearMs += dt;
  }
  const ms = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round(v / 60000)]));
  return episodes.map(e => {
    // A minute of three or more work questions ending under 12 blocks from
    // where it began is thrash.
    const at = t => { let best = null; for (const x of e.pos) { if (x.t > t) break; best = x.p; } return best; };
    const thrash = [];
    for (const [m, b] of e.minutes) {
      if (b.n < 3) continue;
      const a = at(e.sighted + m * 60000) || e.pos.find(x => x.t >= e.sighted + m * 60000)?.p, z = at(e.sighted + (m + 1) * 60000);
      if (!a || !z || Math.hypot(a.x - z.x, a.y - z.y, a.z - z.z) >= 12) continue;
      thrash.push({ at: b.at, shape: [...b.qs.keys()].sort().join(' + '), answers: [...b.ans.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => `${k}${n > 1 ? ` x${n}` : ''}`) });
    }
    const until = Math.min(e.fight ?? end, end);
    return { sighted: e.sighted, at: e.at, onFloors: e.onFloors, blazeNear: e.blazeNear, fight: e.fight, rod: e.rod,
      span: { minutes: round((until - e.sighted) / 60000), botMinutes: round(e.botMs / 60000), reachedFight: e.fight !== null, byWork: ms(e.byWork), byStep: ms(e.byStep), noRoute: e.noRoute, falseFind: e.falseFind, blazeNearMinutes: round(e.blazeNearMs / 60000), deferNear: e.deferNear, counts: e.counts, thrash } };
  });
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const has = name => args.includes(name);
  const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
  const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
  const since = Date.parse(opt('--since', '2026-09-29T23:00:00Z'));
  const to = opt('--to', null) ? Date.parse(opt('--to', null)) : Infinity;
  const onlyPort = opt('--port', null) ? Number(opt('--port', null)) : null;
  process.env.JEV_ROOT = ROOT;
  const audit = require('./trials/progress-audit');
  let trials = audit.trialRecords({ since: since - 1, flight: FLIGHT, dir: path.join(ROOT, 'artifacts', 'midgame') }).filter(t => t.port && t.start < to);
  if (onlyPort) trials = trials.filter(t => Number(t.port) === onlyPort);
  const midgameStart = at => { const m = at.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
  let names = []; try { names = fs.readdirSync(FLIGHT); } catch (_) {}
  const readTrial = tr => {
    const identity = `127_0_0_1-${tr.port}-Jev`;
    const files = names.filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl')).map(f => ({ f: path.join(FLIGHT, f), start: midgameStart(f.slice(identity.length + 1)) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
    const frames = [];
    const end = Math.min(tr.end, to);
    files.forEach((x, i) => { x.next = files[i + 1]?.start ?? Infinity; });
    for (const { f, start, next } of files) {
      if (next < tr.start - GAP_MS || start > end) continue;
      let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
      for (const line of text.split('\n')) {
        if (!line) continue;
        let o; try { o = JSON.parse(line); } catch (_) { continue; }
        const t = Date.parse(o.at);
        if (!(t >= tr.start && t <= end)) continue;
        const s = o.snapshot || {};
        // Only the Nether's steps: an Overworld step names no fortress.
        const nether = !s.dimension || dimOf(s.dimension) === 'nether';
        frames.push({ t, kind: o.kind, label: o.label, detail: o.kind === 'chat' ? { message: o.detail?.message } : null,
          snapshot: { step: nether ? s.step : null, mobs: s.mobs, position: s.position, inventory: s.inventory && typeof s.inventory === 'object' ? { blaze_rod: s.inventory.blaze_rod || 0 } : null, decision: s.decision ? { id: s.decision.id } : null } });
      }
    }
    frames.sort((a, b) => a.t - b.t);
    return frames;
  };
  const rows = [];
  for (const tr of trials) {
    for (const m of measureFrames(readTrial(tr), { end: Math.min(tr.end, to) })) {
      const from = x => x === null ? null : round((x - m.sighted) / 60000);
      rows.push({ world: tr.world, port: tr.port, start: iso(tr.start), checkpoint: /\/stages\/fortress\//.test(tr.source || '') ? 'fortress' : /\/stages\/nether\//.test(tr.source || '') ? 'nether' : 'fresh',
        fortress: m.at, sighted: iso(m.sighted), onFloorsAfter: from(m.onFloors), blazeNearAfter: from(m.blazeNear), fightAfter: from(m.fight), rodAfter: from(m.rod), span: m.span });
    }
  }
  const seen = rows;
  if (has('--json')) { console.log(JSON.stringify({ since: iso(since), trials: rows }, null, 2)); return; }
  const med = xs => { const s = xs.filter(x => x !== null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  console.log(`${trials.length} trials since ${iso(since)}; ${new Set(rows.map(r => `${r.port} ${r.start}`)).size} knew a fortress, ${rows.length} fortresses in all (one episode each: from first known to the first blaze fight there).`);
  const fought = seen.filter(r => r.fightAfter !== null);
  console.log(`Of those, ${seen.filter(r => r.onFloorsAfter !== null).length} stood on its floors (median ${med(seen.map(r => r.onFloorsAfter))} min after), ${fought.length} fought a blaze (median ${med(fought.map(r => r.fightAfter))} min after), ${seen.filter(r => r.rodAfter !== null).length} gained a rod (median ${med(seen.map(r => r.rodAfter))} min after).`);
  const sum = {}, steps = {};
  let noRoute = 0, falseFind = 0, blazeNear = 0, total = 0, deferNear = 0;
  const shapes = {};
  for (const r of seen) {
    const s = r.span; if (!s) continue;
    total += s.botMinutes; noRoute += s.noRoute; falseFind += s.falseFind; blazeNear += s.blazeNearMinutes; deferNear += s.deferNear;
    for (const [k, v] of Object.entries(s.byWork)) sum[k] = (sum[k] || 0) + v;
    for (const [k, v] of Object.entries(s.byStep)) steps[k] = (steps[k] || 0) + v;
    for (const th of s.thrash) {
      const x = shapes[th.shape] ||= { minutes: 0, trials: new Set(), example: null, answers: {} };
      x.minutes++; x.trials.add(r.world);
      if (!x.example) x.example = `${r.world} (port ${r.port}) at ${iso(th.at)}: ${th.answers.join(', ')}`;
      for (const a of th.answers) { const k = a.replace(/ x\d+$/, ''); x.answers[k] = (x.answers[k] || 0) + 1; }
    }
  }
  console.log(`\nSighting to first fight (or trial end): ${round(total)} bot-minutes over ${seen.length} fortresses (${round(seen.filter(r => r.fightAfter === null).reduce((n, r) => n + r.span.botMinutes, 0))} of them in episodes never reaching a fight); ${noRoute} no_route frames; ${falseFind} "A fortress!" said at a fortress already known; ${round(blazeNear)} minutes with a blaze within ${REACH_NEAR} blocks and no fight yet; hunt_target answered defer with a blaze within ${REACH_NEAR}: ${deferNear}.`);
  console.log('\nMinutes by the work question and answer holding them:');
  for (const [k, v] of Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, has('--verbose') ? 60 : 25)) console.log(`  ${k}: ${round(v)}`);
  console.log('\nMinutes by step:');
  for (const [k, v] of Object.entries(steps).sort((a, b) => b[1] - a[1]).slice(0, has('--verbose') ? 40 : 15)) console.log(`  ${k}: ${round(v)}`);
  console.log('\nLoop shapes (minutes of 3+ work questions ending under 12 blocks from where they began):');
  for (const [shape, x] of Object.entries(shapes).sort((a, b) => b[1].minutes - a[1].minutes).slice(0, has('--verbose') ? 15 : 6)) {
    console.log(`  ${x.minutes} min, ${x.trials.size} trials: ${shape}`);
    console.log(`    answers most often: ${Object.entries(x.answers).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} (${n})`).join(', ')}`);
    console.log(`    e.g. ${x.example}`);
  }
  console.log('\nPer fortress (minutes after it was first known):');
  for (const r of seen) {
    const s = r.span;
    console.log(`  ${r.world} (port ${r.port}, ${r.checkpoint}) fortress ${r.fortress ? `(${r.fortress.x}, ${r.fortress.y}, ${r.fortress.z})` : '?'}: known ${r.sighted}; floors ${r.onFloorsAfter ?? '-'}, blaze near ${r.blazeNearAfter ?? '-'}, fight ${r.fightAfter ?? '-'}, rod ${r.rodAfter ?? '-'}; span ${s.minutes} min, ${s.noRoute} no_route, ${s.thrash.length} thrash min${s.falseFind ? `, ${s.falseFind} false "A fortress!"` : ''}`);
    if (has('--verbose')) console.log(`    ${Object.entries(s.byWork).slice(0, 6).map(([k, v]) => `${k} ${v}`).join('; ')}`);
  }
}

module.exports = { measureFrames };
if (require.main === module) main();

#!/usr/bin/env node
'use strict';
// The portal rung's questions and plan changes, per fresh trial, and the
// same rungs replayed under one portal plan (trial note 782).
//
// Before note 782 the way to a portal was asked in many places: portal_method
// (and its re-asks: twenty working minutes, walks no nearer, the lava a
// third farther, slow trips, a flip, a frame out of reach, a site failure),
// lava_way, and the stall's portal detours (to_known_lava, to_other_lava,
// dig_to_lava, cast_at_pool, to_portal_frame, search_lava); and the fetch
// switched its lava on its own. This reads, from the flight records, per
// fresh trial on its Overworld portal rung (the first portal question or
// lava fetch to the Nether or the trial's end):
//   asks        portal questions asked (portal_method, lava_way, portal_plan)
//               and stall answers that chose a portal route
//   changes     plan changes: the way's answer changed (portal_method or
//               portal_plan, buckets first aside), the lava named for the
//               fetch moved more than 16 blocks (lava-switches.js), or a
//               lava_way answer other than the last; within 30 s, one
//   minutes     the rung's minutes (bot time, gaps over a minute cut)
//   buckets     lava buckets filled (rises in lava buckets carried, steadied)
//   obsidian    frame slots cast (the cast moved off a slot and never came
//               back to it), ten once in the Nether
// and the replay under note 782's plan: one portal_plan ask at the rung's
// first portal question, then one for each named fact the record shows
// (merged within 30 s): the route failed (a portal question asked with a
// failure said: walks no nearer, a frame out of reach, a site failure, a
// staircase resting, a way chosen failed; or a stall answered with a
// portal route, read as replan_portal), a lava pool found nearer the frame
// (or the bot, no frame) than the lava the plan holds, buckets lost
// (buckets of any kind carried fall), a death, and the plan's own stated
// minutes run out (read as the twenty working minutes portal_method was
// asked again at, the record having no stated minutes). Jev's answers
// cannot be replayed: changes after are at most asks after less one.
//
//   node scripts/portal-plan.js [--since ISO] [--to ISO] [--port N] [--json] [--verbose]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const has = name => args.includes(name);
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const GAP_MS = 60000, MERGE_MS = 30000, SWITCH_BLOCKS = 16;

const PORTAL_Q = /^(portal_method|lava_way|portal_plan)$/;
const STALL_Q = /^(stillness_detour|rung_progress)$/;
const PORTAL_JOB = /^(to_known_lava|to_other_lava|dig_to_lava|cast_at_pool|to_portal_frame|search_lava|replan_portal)$/;
const RUNG_ACTION = /^(fill_bucket|go_to_landmark|to_lava_for_portal|cast_portal|buckets_for_portal|to_ruined_portal|return_to_portal)$/;
// A portal question asked with a failure of the way said (work.js
// frameFailedSays, siteFailedSays, the walks no nearer, a rest; obsidian.js
// askedAgainBecause).
const FAILED_SAYS = /came no nearer|cannot be got back to|has failed at its site|is set aside \(|its route failed|asked again because the route|Asked again because the way chosen|"askedAgainBecause":"(the route failed|a death|buckets lost|the frame|lava found)/;
const LAVA_NAMED = /^(Walking to the lava pool at|Digging toward the lava at|Walking to the lava at) \((-?\d+), (-?\d+), (-?\d+)\)|^(Digging down for the deep lava at y) (-?\d+)/;
const BUCKETS = inv => ['bucket', 'lava_bucket', 'water_bucket'].reduce((n, k) => n + (+inv?.[k] || 0), 0);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const round = n => Math.round(n * 10) / 10;

const fileStart = name => { const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
function portFiles(port, dir = FLIGHT) {
  const identity = `127_0_0_1-${port}-Jev-`;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  const files = names.filter(f => f.startsWith(identity) && f.endsWith('.jsonl')).map(f => ({ f: path.join(dir, f), start: fileStart(f) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  files.forEach((x, i) => { x.next = files[i + 1]?.start ?? Infinity; });
  return files;
}

// The frames this reads, slim.
function readFrames({ port, start, end, dir = FLIGHT }) {
  const out = [];
  for (const { f, start: s0, next } of portFiles(port, dir)) {
    if (next < start - 3600e3 || s0 > end) continue;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const i = line.lastIndexOf('"at":"');
      const t = i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6)));
      if (!(t >= start && t <= end)) continue;
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      out.push(slim(o, t));
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
function slim(o, t) {
  const s = o.snapshot || {}, st = s.step || s.goal?.step, sa = s.survivalAction || s.goal?.survivalAction, d = o.kind === 'decision' ? s.decision : null;
  const said = d ? `${Object.values(d.options || {}).map(x => x?.description || '').join(' ')} ${JSON.stringify(d.state || {})}` : '';
  return { t, kind: o.kind, dim: s.dimension ? String(s.dimension).replace(/^minecraft:/, '').replace(/^the_/, '') : null,
    action: st?.action || null, phase: st?.phase || null, slot: st?.action === 'cast_portal' && st.slot ? st.slot : null, rung: s.goal?.gameProgress?.phase || null,
    pos: s.position || null, health: typeof s.health === 'number' ? s.health : null, inv: s.inventory && typeof s.inventory === 'object' ? s.inventory : null,
    pool: sa?.action === 'landmark_found' && sa.kind === 'lava_pool' && sa.position ? sa.position : null,
    decision: d?.id ? { id: d.id, pick: Array.isArray(d.path) ? d.path.at(-1) : null, failed: FAILED_SAYS.test(said), clock: (/worked on for \d+ minutes so far/.test(said) && !FAILED_SAYS.test(said) && !/Asked again because/.test(said) && d.id === 'portal_method') || /"askedAgainBecause":"its own stated/.test(said), stale: !!d.stale } : null,
    chat: o.kind === 'chat' && o.detail?.from === 'Jev' ? String(o.detail.message || '') : null };
}

// Lava buckets filled: the rises in what is carried, a change undone within
// thirty seconds not counted (progress-audit.js steady).
function bucketsFilled(frames) {
  const { steady } = require('./trials/progress-audit');
  const c = frames.filter(f => f.inv);
  const v = steady(c.map(f => +f.inv.lava_bucket || 0), c.map(f => f.t));
  let n = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[i - 1]) n += v[i] - v[i - 1];
  return n;
}
// Slots cast: a slot the cast worked on, moved off and never came back to.
function slotsCast(frames) {
  const seq = [];
  for (const f of frames) if (f.slot) { const k = `${f.slot.x},${f.slot.y},${f.slot.z}`; if (seq.at(-1) !== k) seq.push(k); }
  let n = 0;
  for (let i = 0; i < seq.length - 1; i++) if (!seq.slice(i + 1).includes(seq[i]) && seq.indexOf(seq[i]) === i) n++;
  return n;
}
const merge = (events) => {
  const out = [];
  for (const e of events.sort((a, b) => a.t - b.t)) { const last = out.at(-1); if (last && e.t - last.t <= MERGE_MS) { last.why.add(e.why); continue; } out.push({ t: e.t, why: new Set([e.why]) }); }
  return out;
};

// One trial's portal rung, before and replayed.
function measure(frames) {
  const over = frames.filter(f => f.dim === 'overworld' || f.dim === null);
  const nether = frames.find(f => f.dim === 'nether');
  const end = nether ? nether.t : (frames.at(-1)?.t ?? 0);
  const first = over.find(f => (f.decision && (PORTAL_Q.test(f.decision.id) || (STALL_Q.test(f.decision.id) && PORTAL_JOB.test(f.decision.pick || '')))) || RUNG_ACTION.test(f.action || ''));
  if (!first || first.t >= end) return null;
  const rung = over.filter(f => f.t >= first.t && f.t < end);
  let ms = 0;
  for (let i = 0; i < rung.length; i++) { const dt = (rung[i + 1]?.t ?? end) - rung[i].t; if (dt > 0 && dt <= GAP_MS) ms += dt; }
  // Before: the asks, by question, and the plan changes.
  const asks = { portal_method: 0, lava_way: 0, portal_plan: 0, stall_portal_route: 0 };
  const changes = [];
  let lastWay = null, lastLavaWay = null, lastLava = null, lastAnswerAt = -Infinity;
  for (const f of rung) {
    const d = f.decision;
    if (d && !d.stale && d.pick && (PORTAL_Q.test(d.id) || (STALL_Q.test(d.id) && PORTAL_JOB.test(d.pick)))) lastAnswerAt = f.t;
    if (d && !d.stale && d.pick && d.pick !== 'none_good') {
      if (PORTAL_Q.test(d.id)) {
        asks[d.id]++;
        if (d.id !== 'lava_way' && d.pick !== 'craft_buckets') { if (lastWay && d.pick !== lastWay) changes.push({ t: f.t, why: `${d.id}: ${lastWay} -> ${d.pick}` }); lastWay = d.pick; }
        if (d.id === 'lava_way' && d.pick !== 'craft_buckets') { if (lastLavaWay && d.pick !== lastLavaWay) changes.push({ t: f.t, why: `lava_way: ${lastLavaWay} -> ${d.pick}` }); lastLavaWay = d.pick; }
      } else if (STALL_Q.test(d.id) && PORTAL_JOB.test(d.pick)) {
        asks.stall_portal_route++;
        if (d.pick !== 'to_portal_frame' && d.pick !== 'search_lava') changes.push({ t: f.t, why: `stall: ${d.pick}` });
      }
    }
    const m = f.chat && LAVA_NAMED.exec(f.chat);
    if (m) {
      const at = m[5] ? { deep: true } : { x: +m[2], y: +m[3], z: +m[4] };
      if (lastLava && (at.deep ? !lastLava.deep : lastLava.deep || dist(at, lastLava) > SWITCH_BLOCKS)) changes.push({ t: f.t, why: f.t - lastAnswerAt <= 60000 ? 'lava named moved' : 'lava named moved unasked' });
      lastLava = at;
    }
  }
  const changed = merge(changes);
  // After: one portal_plan ask at the start, and one for each named fact.
  const facts = [];
  let held = null, frameAt = null, carriers = null, health = null, clockAsks = 0;
  const seenPools = [];
  for (const f of rung) {
    const d = f.decision;
    if (d && !d.stale && PORTAL_Q.test(d.id) && d.failed && f.t > first.t) facts.push({ t: f.t, why: 'the route failed' });
    if (d && !d.stale && d.id === 'portal_method' && d.clock && f.t > first.t) { facts.push({ t: f.t, why: 'its stated minutes ran out' }); clockAsks++; }
    if (d && !d.stale && STALL_Q.test(d.id) && PORTAL_JOB.test(d.pick || '') && !/^(to_portal_frame|search_lava)$/.test(d.pick)) facts.push({ t: f.t, why: 'the route failed (a stall answered with another route)' });
    if (f.slot && !frameAt) frameAt = f.slot;
    const m = f.chat && LAVA_NAMED.exec(f.chat);
    if (m && !m[5]) held = { x: +m[2], y: +m[3], z: +m[4] };
    if (f.pool && !seenPools.some(p => dist(p, f.pool) <= 8)) {
      seenPools.push(f.pool);
      const from = frameAt || f.pos;
      if (held && from && dist(f.pool, from) < dist(held, from) && dist(f.pool, held) > SWITCH_BLOCKS) facts.push({ t: f.t, why: 'a lava pool found nearer' });
    }
    if (f.inv) { const b = BUCKETS(f.inv); if (carriers !== null && b < carriers) facts.push({ t: f.t, why: 'buckets lost' }); carriers = b; }
    if (f.health !== null) { if (health !== null && health > 0 && f.health <= 0) facts.push({ t: f.t, why: 'a death' }); health = f.health; }
  }
  // Buckets lost read only where the drop holds (a pour turns a lava bucket
  // to an empty one, a count the same; a frame mid-click reads a drop).
  const steadyFacts = facts.filter(e => e.why !== 'buckets lost' || (() => { const later = rung.find(f => f.inv && f.t > e.t + MERGE_MS); return !later || BUCKETS(later.inv) < (BUCKETS(rung.filter(f => f.inv && f.t < e.t).at(-1)?.inv) || 0); })());
  const after = [{ t: first.t, why: new Set(['the rung begins']) }, ...merge(steadyFacts.filter(e => e.t > first.t + MERGE_MS))];
  const askedBefore = asks.portal_method + asks.lava_way + asks.portal_plan + asks.stall_portal_route;
  const buckets = bucketsFilled(rung), obsidian = nether ? 10 : Math.min(10, slotsCast(rung));
  const minutes = round(ms / 60000);
  const whyAfter = {};
  for (const a of after) for (const w of a.why) whyAfter[w] = (whyAfter[w] || 0) + 1;
  return { reachedNether: !!nether, minutes, buckets, obsidian, minutesABucket: buckets ? round(minutes / buckets) : null, minutesAnObsidian: obsidian ? round(minutes / obsidian) : null,
    asks, askedBefore, changesBefore: changed.length, unaskedBefore: changed.filter(c => c.why.size === 1 && c.why.has('lava named moved unasked')).length, changeWhys: changed.map(c => [...c.why].join('; ')),
    asksAfter: after.length, changesAfterAtMost: Math.max(0, after.length - 1), whyAfter, clockAsks };
}

function trials({ since, to, port = null }) {
  const audit = require('./trials/progress-audit');
  return audit.trialRecords({ since: since - 1, flight: FLIGHT }).filter(t => t.port && t.start < to && !/\/stages\/(fortress|nether)\//.test(t.source || '') && (!port || Number(t.port) === port));
}

function main() {
  const since = Date.parse(opt('--since', '2026-09-30T17:00:00Z')), to = opt('--to', null) ? Date.parse(opt('--to', null)) : Infinity;
  const port = opt('--port', null) ? Number(opt('--port', null)) : null;
  const rows = [];
  for (const tr of trials({ since, to, port })) {
    const r = measure(readFrames({ port: tr.port, start: tr.start, end: Math.min(tr.end, to) }));
    if (r) rows.push({ world: tr.world, port: tr.port, startedAt: new Date(tr.start).toISOString(), ...r });
  }
  const sum = k => rows.reduce((n, r) => n + (r[k] || 0), 0);
  const med = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const out = {
    since: new Date(since).toISOString(), to: Number.isFinite(to) ? new Date(to).toISOString() : null, trials: rows.length, reachedNether: rows.filter(r => r.reachedNether).length,
    minutes: round(sum('minutes')), buckets: sum('buckets'), obsidian: sum('obsidian'),
    minutesABucket: round(sum('minutes') / Math.max(1, sum('buckets'))), minutesAnObsidian: round(sum('minutes') / Math.max(1, sum('obsidian'))),
    before: { asks: sum('askedBefore'), byQuestion: ['portal_method', 'lava_way', 'portal_plan', 'stall_portal_route'].reduce((o, k) => ({ ...o, [k]: rows.reduce((n, r) => n + r.asks[k], 0) }), {}), changes: sum('changesBefore'), unasked: sum('unaskedBefore'),
      medianAsks: med(rows.map(r => r.askedBefore)), medianChanges: med(rows.map(r => r.changesBefore)), asksAnHour: round(sum('askedBefore') / Math.max(1e-9, sum('minutes') / 60)), changesAnHour: round(sum('changesBefore') / Math.max(1e-9, sum('minutes') / 60)) },
    after: { asks: sum('asksAfter'), changesAtMost: sum('changesAfterAtMost'), medianAsks: med(rows.map(r => r.asksAfter)), asksAnHour: round(sum('asksAfter') / Math.max(1e-9, sum('minutes') / 60)),
      why: rows.reduce((o, r) => { for (const [k, n] of Object.entries(r.whyAfter)) o[k] = (o[k] || 0) + n; return o; }, {}) },
    rows,
  };
  if (has('--json')) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log(`${out.trials} fresh trials with a portal rung, ${out.since} to ${out.to || 'now'}; ${out.reachedNether} reached the Nether.`);
  console.log(`Rung minutes ${out.minutes}: ${out.buckets} lava buckets filled (${out.minutesABucket} min a bucket), ${out.obsidian} obsidian cast (${out.minutesAnObsidian} min an obsidian).`);
  console.log(`Before: ${out.before.asks} portal asks (${Object.entries(out.before.byQuestion).map(([k, n]) => `${k} ${n}`).join(', ')}), ${out.before.asksAnHour} a rung-hour, median ${out.before.medianAsks} a trial; ${out.before.changes} plan changes (${out.before.unasked} of them the fetch's own switch of lava, no portal answer in the minute before), ${out.before.changesAnHour} a rung-hour, median ${out.before.medianChanges} a trial.`);
  console.log(`Under the plan (replayed): ${out.after.asks} portal_plan asks, ${out.after.asksAnHour} a rung-hour, median ${out.after.medianAsks} a trial; plan changes at most ${out.after.changesAtMost}, none unasked (the fetch goes to the plan's lava only). Why asked: ${Object.entries(out.after.why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}.`);
  console.log('\nPer trial (minutes, buckets, obsidian, min a bucket, min an obsidian; asks and changes before -> asks after):');
  for (const r of rows) {
    console.log(`  ${r.world} ${r.port} ${r.startedAt.slice(5, 16)}${r.reachedNether ? ' nether' : ''}: ${r.minutes} min, ${r.buckets} b, ${r.obsidian} o, ${r.minutesABucket ?? '-'} min/b, ${r.minutesAnObsidian ?? '-'} min/o; asks ${r.askedBefore} (pm ${r.asks.portal_method}, lw ${r.asks.lava_way}, stall ${r.asks.stall_portal_route}), changes ${r.changesBefore} -> plan asks ${r.asksAfter}`);
    if (has('--verbose')) { for (const w of r.changeWhys) console.log(`      change: ${w}`); console.log(`      plan asked for: ${JSON.stringify(r.whyAfter)}`); }
  }
}

if (require.main === module) main();
module.exports = { measure, slim, slotsCast, merge, FAILED_SAYS, LAVA_NAMED };

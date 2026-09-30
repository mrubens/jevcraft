#!/usr/bin/env node
'use strict';
// Who owns the turn, and whether what owned it could reach the bot (trial
// note 752). Per trial port, over the flight records since --since:
//   - turn_priority answers by the layer given the turn;
//   - for each survival win against a mob (escape_threat, creeper_back_off),
//     whether that mob could reach the bot: a hit by its kind in the next
//     60 s, its distance over the next 30 s (closing to its reach, or by a
//     block or more), line of sight for a shooter, and whether "no way to
//     the bot" was said of it or the bot's own walks found no route;
//   - bot-minutes each such win held the turn (to the next turn_priority
//     answer, at most RULING_MS), summed where the mob never reached or hit;
//   - the minutes survival held the turn sitting in shelter (pocket_next,
//     wait_for_day_sealed, secure_shelter);
//   - every chosen option whose words promise a question "asked next", and
//     whether that question was asked within 30 s.
// With --simulate, each survival win against a mob is also judged by note
// 752's rule (held-off.js quiet: about QUIET_MS without coming nearer, no
// hit from its kind, a shooter out of sight, never a creeper): a win the
// rule would not have given survival counts as minutes released to the
// work. It reads only the flight records; nothing is changed.
//
//   node scripts/turn-owners.js [--since ISO] [--to ISO] [--port N] [--json]
//                               [--simulate] [--examples N]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const RULING_MS = 60000, CLOSE_MS = 30000, HIT_MS = 60000, PROMISE_MS = 30000;
let QUIET_MS = 3 * 60000;
const NEARER = 2, ARM = 3;
const SHOOTERS = new Set(['skeleton', 'stray', 'bogged', 'parched', 'pillager', 'blaze', 'ghast', 'witch', 'breeze', 'shulker']);
// The questions a turn_priority option's "asked next" names, by its action
// (arbiter.js claimSays); anything else "asked next" is checked against any
// question asked after it.
const PROMISES = {
  escape_threat: ['encounter_stance', 'ranged_response'],
  creeper_back_off: ['encounter_stance'],
  pocket_next: ['pocket_next'],
  secure_shelter: ['survival_priority', 'shelter_method'],
  obtain_food: ['survival_priority', 'resource_source', 'kit_food', 'restock_food', 'leave_nether', 'sheep_search'],
  hunt: ['hunt_target', 'empty_spawner'],
};
const SHELTER = new Set(['pocket_next', 'wait_for_day_sealed', 'secure_shelter', 'go_home_for_night']);

const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };
const fileStart = name => { const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const portOf = name => Number((name.match(/^127_0_0_1-(\d+)-/) || [])[1]);
const round = (n, p = 10) => Math.round(n * p) / p;

// One file's frames, kept small: the mobs seen, the damage taken, the
// decisions asked (with the chosen option's words and facts), no-route
// records and what the survival layer reported doing.
async function readFile(file, { since = -Infinity, to = Infinity } = {}) {
  const out = { mobs: [], hurts: [], decisions: [], noRoutes: [], survival: [] };
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const head = line.slice(0, 160);
    const kind = (head.match(/^\{"kind":"([^"]+)"/) || [])[1];
    const t = frameAt(line);
    if (!(t >= since && t <= to)) continue;
    if (kind === 'damage') {
      const by = (head.match(/"label":"hurt: [^"]*? by ([a-z_]+)"/) || [])[1];
      out.hurts.push({ t, by: by || null });
    } else if (kind === 'no_route') out.noRoutes.push(t);
    else if (kind === 'survival') out.survival.push({ t, label: (head.match(/"label":"([^"]*)"/) || [])[1] || '' });
    if (kind === 'decision') {
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      const d = o.snapshot?.decision;
      if (!d?.id || !Array.isArray(d.path)) continue;
      const chosen = d.options?.[d.path[0]]?.description;
      const words = typeof chosen === 'string' ? chosen : chosen?.does || '';
      out.decisions.push({ t: Date.parse(d.askedAt || o.at) || t, id: d.id, path: d.path, words, action: chosen?.action || null, facts: chosen?.facts || null,
        why: d.state?.why || null, standIn: !!d.standIn, again: d.state?.previousStance?.askedAgainFor || null, heldS: d.state?.previousStance?.heldSeconds ?? null,
        health: d.state?.health ?? null, lead: d.id === 'encounter_stance' ? (Object.values(d.options || {}).map(o => typeof o.description === 'string' ? o.description : o.description?.does || '').find(Boolean) || '').slice(0, 200) : null });
    }
    // The mobs listed on any frame that carries them (observation frames
    // do not; the step, decision and chat frames do).
    const ci = line.indexOf('"controller":');
    const mi = ci >= 0 ? line.indexOf('"mobs":[', ci) : -1;
    if (mi >= 0) {
      const end = line.indexOf(']', mi);
      let mobs = [];
      try { mobs = JSON.parse(line.slice(mi + 7, end + 1)); } catch (_) { mobs = null; }
      if (Array.isArray(mobs)) out.mobs.push({ t, list: mobs.filter(m => Number.isFinite(m.d)).map(m => ({ name: m.name, id: m.id, d: m.d, seen: !!m.seen })) });
    }
  }
  return out;
}

function flightFiles(dir, { since, to, port }) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names.filter(n => n.endsWith('.jsonl') && n.startsWith('127_0_0_1-')).map(n => ({ n, f: path.join(dir, n), port: portOf(n), start: fileStart(n) }))
    .filter(x => Number.isFinite(x.port) && Number.isFinite(x.start) && x.start <= to && (port == null || x.port === port))
    .filter(x => { try { return fs.statSync(x.f).mtimeMs >= since; } catch (_) { return false; } })
    .sort((a, b) => a.port - b.port || a.start - b.start);
}

// The threat a survival claim answered, from its facts.
function threatOf(facts) {
  if (!facts) return null;
  if (facts.threat?.name) return { name: facts.threat.name, d: facts.threat.distance, projectile: !!facts.threat.projectile, seen: facts.threat.seen, stance: !!facts.stance };
  if (Array.isArray(facts.atArm) && facts.atArm[0]) return { name: facts.atArm[0].name, d: facts.atArm[0].distance, atArm: true, seen: facts.atArm[0].seen };
  if (facts.creeper !== undefined) return { name: 'creeper', d: facts.creeper, seen: facts.seen };
  if (facts.mob) return { name: facts.mob, d: facts.distance };
  return null;
}

// Whether the mob named could reach the bot after `t`, from the frames.
function reachAfter(tr, t, threat, words) {
  const hit = tr.hurts.some(h => h.t >= t && h.t <= t + HIT_MS && h.by === threat.name);
  const frames = tr.mobs.filter(m => m.t >= t && m.t <= t + CLOSE_MS);
  const ds = frames.map(f => f.list.filter(m => m.name === threat.name)).filter(l => l.length).map(l => Math.min(...l.map(m => m.d)));
  const minD = ds.length ? Math.min(...ds) : null;
  const shooter = SHOOTERS.has(threat.name);
  const closed = minD !== null && Number.isFinite(threat.d) && (minD <= 2.5 || minD < threat.d - 1);
  const lineOfSight = frames.some(f => f.list.some(m => m.name === threat.name && m.seen));
  const noWaySaid = /no way to the bot/.test(words || '');
  const noRoutes = tr.noRoutes.filter(x => x >= t && x <= t + CLOSE_MS).length;
  const reached = hit || (shooter ? lineOfSight : closed) || !!threat.atArm;
  return { hit, closed, minD, lineOfSight, shooter, noWaySaid, noRoutes, reached, trend: ds.length >= 2 ? round(ds.at(-1) - ds[0]) : null };
}

// Note 752's rule, judged from the frames: about QUIET_MS within the list
// without coming nearer by NEARER, no hit by its kind in that time, a
// shooter out of sight, never a creeper or warden, beyond arm's length.
function heldOffThen(tr, t, threat) {
  if (!threat || threat.projectile || threat.atArm || threat.name === 'warden') return null;
  // A creeper past its lighting distance and a second's walk (note 752b).
  const near = threat.name === 'creeper' ? 6 : ARM;
  if (!(threat.d > near)) return null;
  if (tr.hurts.some(h => h.by === threat.name && h.t <= t && h.t > t - QUIET_MS)) return null;
  const win = tr.mobs.filter(m => m.t <= t && m.t >= t - QUIET_MS);
  const seenAt = win.map(f => ({ t: f.t, m: f.list.filter(m => m.name === threat.name).sort((a, b) => a.d - b.d)[0] })).filter(x => x.m);
  if (!seenAt.length || t - seenAt[0].t < QUIET_MS - 15000) return null;
  // Continuously about: no gap over a minute in the window.
  for (let i = 1; i < seenAt.length; i++) if (seenAt[i].t - seenAt[i - 1].t > 60000) return null;
  const first = seenAt[0].m.d, min = Math.min(threat.d, ...seenAt.map(x => x.m.d));
  if (min < first - NEARER || min <= near) return null;
  if (SHOOTERS.has(threat.name) && seenAt.some(x => x.m.seen)) return null;
  return { minutes: round((t - seenAt[0].t) / 60000), first, min };
}

function analyse(tr, { simulate = false, examples = 0 } = {}) {
  const tps = tr.decisions.filter(d => d.id === 'turn_priority' && !d.standIn).sort((a, b) => a.t - b.t);
  const byLayer = {};
  const r = { answers: tps.length, byLayer, survivalMob: 0, survivalMobMin: 0, neverReached: 0, neverReachedMin: 0, shelterMin: 0, byThreat: {}, released: 0, releasedMin: 0, releasedHit: 0, examples: [] };
  tps.forEach((d, i) => {
    const layer = d.path[0];
    byLayer[layer] = (byLayer[layer] || 0) + 1;
    const next = tps[i + 1]?.t ?? Infinity;
    const heldMs = Math.max(0, Math.min(next - d.t, RULING_MS));
    if (layer !== 'survival') return;
    if (SHELTER.has(d.action)) r.shelterMin += heldMs / 60000;
    if (!['escape_threat', 'creeper_back_off'].includes(d.action)) return;
    const threat = threatOf(d.facts);
    if (!threat || threat.projectile) return;
    r.survivalMob++; r.survivalMobMin += heldMs / 60000;
    const reach = reachAfter(tr, d.t, threat, d.words);
    const k = threat.name;
    const b = r.byThreat[k] ||= { wins: 0, min: 0, never: 0, neverMin: 0, hit: 0, closed: 0, sight: 0, noWaySaid: 0, noRoute: 0 };
    b.wins++; b.min += heldMs / 60000;
    if (reach.hit) b.hit++; if (reach.closed) b.closed++; if (reach.lineOfSight && reach.shooter) b.sight++; if (reach.noWaySaid) b.noWaySaid++; if (reach.noRoutes) b.noRoute++;
    if (!reach.reached) {
      r.neverReached++; r.neverReachedMin += heldMs / 60000; b.never++; b.neverMin += heldMs / 60000;
      if (r.examples.length < examples) r.examples.push({ at: new Date(d.t).toISOString(), threat, heldS: Math.round(heldMs / 1000), ...reach, words: d.words.slice(0, 160) });
    }
    if (simulate) {
      const off = heldOffThen(tr, d.t, threat);
      if (off) { r.released++; r.releasedMin += heldMs / 60000; if (reach.hit) r.releasedHit++; }
    }
  });
  // Promises: a chosen option that says a question is "asked next".
  const promises = {};
  const asked = tr.decisions.slice().sort((a, b) => a.t - b.t);
  for (const d of asked) {
    if (!/asked next/.test(d.words || '')) continue;
    const key = d.id === 'turn_priority' ? `turn_priority:${d.action || d.path[0]}` : `${d.id}:${d.path.join('/')}`;
    const want = d.id === 'turn_priority' ? PROMISES[d.action] || null : null;
    const kept = asked.some(e => e.t > d.t && e.t <= d.t + PROMISE_MS && e.id !== 'turn_priority' && e.id !== 'shot_answer' && (!want || want.includes(e.id)));
    // What the survival layer did instead, when the promise was not kept.
    const did = kept ? null : (tr.survival.filter(s => s.t > d.t && s.t <= d.t + PROMISE_MS).map(s => s.label)[0] || 'nothing reported');
    const p = promises[key] ||= { made: 0, kept: 0, instead: {} };
    p.made++; if (kept) p.kept++; else p.instead[did] = (p.instead[did] || 0) + 1;
  }
  r.promises = promises;
  // A striking stance (fight, a charge) asked again within 2 s of being
  // answered, nothing struck between (25589, note 752's scene-book cause).
  const stances = asked.filter(d => d.id === 'encounter_stance');
  r.strikeReasked = 0; r.strikeAnswers = 0;
  stances.forEach((d, i) => {
    if (!/^(fight|charge|charge_nearest|charge_shooter|fight_from_footing|strike_from_above)$/.test(d.path.at(-1))) return;
    r.strikeAnswers++;
    const next = stances[i + 1];
    if (next && next.t - d.t <= 2000 && !tr.hurts.some(h => h.t > d.t && h.t <= next.t)) r.strikeReasked++;
  });
  // Why a stance was asked again (note 752b), and those the hold's rules
  // now keep: a new shoot_<id> key, a way that came on offer within the
  // stance's own first time (come_down), one mob of several gone.
  r.againBy = {}; r.againKept = 0; r.againAll = 0;
  for (const d of stances) {
    if (!d.again) continue;
    const k = d.again.replace(/\d+(\.\d+)? (blocks|seconds|minutes)/g, 'N $2').replace(/: .*$/, '').replace(/the [a-z ]+ it was chosen against/, 'the mob it was chosen against').slice(0, 70);
    r.againBy[k] = (r.againBy[k] || 0) + 1; r.againAll++;
    const ways = /^a way not on offer when it was chosen is on offer now: (.*)$/.exec(d.again);
    if (ways && ways[1].split(', ').every(w => /^shoot \d+$/.test(w) || (w === 'come down' && (d.heldS ?? 99) <= 20))) r.againKept++;
  }
  // Stances asked at 6 health or under within 20 s of a hit, whose lead
  // named another kind than the one that hit (25594's spider for its skeleton).
  r.lowAsks = 0; r.leadWrong = 0;
  for (const d of stances) {
    if (!(d.health <= 6)) continue;
    const hit = tr.hurts.filter(h => h.by && h.t <= d.t && h.t > d.t - 20000).at(-1);
    if (!hit) continue;
    r.lowAsks++;
    const lead = (/^(?:Hitting the bot now: )?[Tt]he ([a-z ]+?) [\d.]+ blocks off/.exec(d.lead || '') || [])[1];
    if (lead && lead.replaceAll(' ', '_') !== hit.by) r.leadWrong++;
  }
  // A pocket answer that opens the pocket (leave, a hunt, the stash, food)
  // followed by the step waiting in it, not leaving (25585).
  r.leaveAnswers = 0; r.leaveNoop = 0;
  for (const d of asked.filter(x => x.id === 'pocket_next' && /^(leave|stash_valuables|cache_valuables|go_to_bed|hunt_)/.test(x.path[0]))) {
    r.leaveAnswers++;
    const after = tr.survival.filter(x => x.t > d.t && x.t <= d.t + 10000).map(x => x.label);
    if (!after.some(l => /leave shelter/.test(l)) && after.some(l => /wait in shelter/.test(l))) r.leaveNoop++;
  }
  for (const k of ['survivalMobMin', 'neverReachedMin', 'shelterMin', 'releasedMin']) r[k] = round(r[k]);
  for (const b of Object.values(r.byThreat)) { b.min = round(b.min); b.neverMin = round(b.neverMin); }
  return r;
}

function merge(parts) {
  const out = { mobs: [], hurts: [], decisions: [], noRoutes: [], survival: [] };
  for (const p of parts) for (const k of Object.keys(out)) out[k].push(...p[k]);
  for (const k of ['mobs', 'hurts', 'decisions', 'survival']) out[k].sort((a, b) => a.t - b.t);
  out.noRoutes.sort((a, b) => a - b);
  return out;
}

function total(rows) {
  const t = { answers: 0, byLayer: {}, survivalMob: 0, survivalMobMin: 0, neverReached: 0, neverReachedMin: 0, shelterMin: 0, released: 0, releasedMin: 0, releasedHit: 0, byThreat: {}, promises: {} };
  for (const r of rows) {
    for (const k of ['answers', 'survivalMob', 'survivalMobMin', 'neverReached', 'neverReachedMin', 'shelterMin', 'released', 'releasedMin', 'releasedHit']) t[k] += r[k];
    for (const [k, v] of Object.entries(r.byLayer)) t.byLayer[k] = (t.byLayer[k] || 0) + v;
    for (const [k, b] of Object.entries(r.byThreat)) { const a = t.byThreat[k] ||= {}; for (const [f, v] of Object.entries(b)) a[f] = round((a[f] || 0) + v); }
    for (const k of ['strikeReasked', 'strikeAnswers', 'leaveAnswers', 'leaveNoop', 'againKept', 'againAll', 'lowAsks', 'leadWrong']) t[k] = (t[k] || 0) + (r[k] || 0);
    for (const [k, v] of Object.entries(r.againBy || {})) (t.againBy ||= {})[k] = (t.againBy[k] || 0) + v;
    for (const [k, p] of Object.entries(r.promises)) {
      const a = t.promises[k] ||= { made: 0, kept: 0, instead: {} };
      a.made += p.made; a.kept += p.kept;
      for (const [w, n] of Object.entries(p.instead)) a.instead[w] = (a.instead[w] || 0) + n;
    }
  }
  for (const k of ['survivalMobMin', 'neverReachedMin', 'shelterMin', 'releasedMin']) t[k] = round(t[k]);
  return t;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const has = name => args.includes(name);
  const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
  const since = Date.parse(opt('--since', '2026-09-29T23:00:00Z'));
  const to = opt('--to', null) ? Date.parse(opt('--to')) : Infinity;
  const port = opt('--port', null) ? Number(opt('--port')) : null;
  if (opt('--quiet-s', null)) QUIET_MS = Number(opt('--quiet-s')) * 1000;
  const simulate = has('--simulate'), examples = Number(opt('--examples', 0)) || 0;
  const files = flightFiles(path.join(ROOT, '.bot-state', 'flight'), { since, to, port });
  const byPort = new Map();
  for (const x of files) { if (!byPort.has(x.port)) byPort.set(x.port, []); byPort.get(x.port).push(x); }
  const rows = [];
  for (const [p, list] of byPort) {
    const parts = [];
    for (const x of list) parts.push(await readFile(x.f, { since, to }));
    rows.push({ port: p, files: list.length, ...analyse(merge(parts), { simulate, examples }) });
  }
  const all = total(rows);
  if (has('--json')) { console.log(JSON.stringify({ since: new Date(since).toISOString(), total: all, ports: rows }, null, 2)); return; }
  const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : '-';
  console.log(`Flight records since ${new Date(since).toISOString()}: ${files.length} files, ${rows.length} ports.`);
  console.log(`turn_priority answers: ${all.answers}; by layer ${Object.entries(all.byLayer).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${pct(v, all.answers)})`).join(', ')}.`);
  console.log(`Survival wins against a mob: ${all.survivalMob}, holding ${all.survivalMobMin} bot-minutes; the mob never reached or hit the bot in ${all.neverReached} (${pct(all.neverReached, all.survivalMob)}), ${all.neverReachedMin} bot-minutes.`);
  console.log(`Survival holding the turn in shelter (pocket_next, wait_for_day_sealed, secure_shelter): ${all.shelterMin} bot-minutes.`);
  if (simulate) console.log(`Note 752's held-off rule (quiet ${QUIET_MS / 1000} s) would not have given survival ${all.released} of those wins (${all.releasedMin} bot-minutes); a hit by that kind followed ${all.releasedHit} of them within 60 s, each ending the hold at once.`);
  console.log('\nBy mob (wins, minutes, never reached (minutes), hit in 60 s, closed in 30 s, shooter in sight, "no way" said, bot no-route):');
  for (const [k, b] of Object.entries(all.byThreat).sort((a, b) => b[1].min - a[1].min)) console.log(`  ${k}: ${b.wins}, ${b.min} min, ${b.never} (${b.neverMin} min), hit ${b.hit}, closed ${b.closed}, sight ${b.sight}, noWay ${b.noWaySaid}, noRoute ${b.noRoute}`);
  console.log(`Striking stances (fight, a charge) asked again within 2 s with no hit between: ${all.strikeReasked} of ${all.strikeAnswers}.`);
  console.log(`Pocket answers that open the pocket (leave, a hunt, the stash, the bed) followed by waiting in it, not leaving, within 10 s: ${all.leaveNoop} of ${all.leaveAnswers}.`);
  console.log(`Stances asked again for a reason (${all.againAll}): ${Object.entries(all.againBy || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join('; ')}; a new shoot key or a way come on within the stance's own time: ${all.againKept}.`);
  console.log(`Stances asked at 6 health or under within 20 s of a hit: ${all.lowAsks}; led by a mob of another kind than the one that hit: ${all.leadWrong}.`);
  console.log('\nOptions promising a question "asked next" (made, asked within 30 s; what ran instead):');
  for (const [k, p] of Object.entries(all.promises).sort((a, b) => (b[1].made - b[1].kept) - (a[1].made - a[1].kept)).slice(0, 25)) {
    const inst = Object.entries(p.instead).sort((a, b) => b[1] - a[1]).slice(0, has('--verbose') ? 12 : 4).map(([w, n]) => `${w} ${n}`).join(', ');
    console.log(`  ${k}: ${p.made}, kept ${p.kept} (${pct(p.kept, p.made)})${inst ? `; instead: ${inst}` : ''}`);
  }
  console.log('\nPer port (answers: survival/work/other; survival-vs-mob minutes, never reached; shelter minutes' + (simulate ? '; released' : '') + '):');
  for (const r of rows.sort((a, b) => b.neverReachedMin - a.neverReachedMin)) {
    const s = r.byLayer.survival || 0, w = r.byLayer.work || 0;
    console.log(`  ${r.port}: ${r.answers} (${s}/${w}/${r.answers - s - w}), ${r.survivalMobMin} min, never ${r.neverReachedMin} min; shelter ${r.shelterMin} min${simulate ? `; released ${r.releasedMin} min` : ''}`);
    for (const e of r.examples) console.log(`    ${e.at} ${e.threat.name} ${e.threat.d} held ${e.heldS}s minD ${e.minD} trend ${e.trend} noRoute ${e.noRoutes}: ${e.words}`);
  }
}

module.exports = { readFile, analyse, merge, total, threatOf, reachAfter, heldOffThen, PROMISES };
if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });

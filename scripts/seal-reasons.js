#!/usr/bin/env node
'use strict';
// Why the bots sealed themselves in, and what followed (trial note 755).
// Per trial port, over the flight records since --since:
//   - every seal chosen (survival_priority secure_shelter or
//     wait_for_day_sealed, and shelter_method's way, seal_here and the rest)
//     with health, hunger, time of day, underground or not, the hostiles
//     within 24 blocks and those in sight, and what followed within 60 s:
//     pocket_next's first answer, the night mine, a leave, or staying;
//   - the reason the game gives for it (seal-reason.js, the rule the
//     options now say): a hostile in sight or within 8 or coming, the night
//     on the surface, health under twenty; or none;
//   - bot-minutes from each seal to its end (a pocket answer that opens it,
//     the night mine, a leave, the work given the turn; at most 15 min), by
//     reason, and summed where none was named;
//   - for rung_progress (and stillness_detour) answers that walk away
//     (travel_*, look_around, explore): how often the stalled step's need
//     (its target block, or the ore mine_nearby named) was within 8 blocks
//     of where the walk started, and how often the bot came back within 16
//     blocks of that start within 10 minutes, with blocks walked against net.
// With --simulate, each recorded seal's words are replaced by the rule's
// (seal-reason.js) on its recorded facts, and each travel answer by what the
// job-in-hand line (job-in-hand.js) would have said from its recorded goal:
// the count of options that now say "No reason to seal" or name the step's
// need at the start. It reads only the flight records; nothing is changed.
//
//   node scripts/seal-reasons.js [--since ISO] [--to ISO] [--port N] [--json]
//                                [--simulate] [--examples N]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { sealReason } = require('../src/seal-reason');

const FOLLOW_MS = 60000, SEALED_CAP_MS = 15 * 60000, RETURN_MS = 10 * 60000;
const NIGHT = 11500, DAWN = 23000;
const HOSTILE = new Set(['zombie', 'zombie_villager', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'parched', 'creeper', 'spider', 'vex', 'illusioner', 'guardian', 'elder_guardian', 'creaking',
  'cave_spider', 'witch', 'pillager', 'vindicator', 'evoker', 'ravager', 'phantom', 'blaze', 'wither_skeleton', 'hoglin', 'zoglin', 'magma_cube', 'slime', 'ghast', 'piglin_brute', 'silverfish', 'endermite', 'warden', 'breeze']);
const EXIT_LABELS = new Set(['leave shelter', 'night mine', 'tunnel out', 'leave and heal', 'surface']);
const AWAY = /^(travel_\w+|look_around|explore)$/;

const fileStart = name => { const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const portOf = name => Number((name.match(/^127_0_0_1-(\d+)-/) || [])[1]);
const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };
const round = (n, p = 10) => Math.round(n * p) / p;
const dist = (a, b) => a && b ? Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z) : Infinity;
const POS = /"position":\{"x":(-?[\d.e-]+),"y":(-?[\d.e-]+),"z":(-?[\d.e-]+)\}/;

async function readFile(file, { since = -Infinity, to = Infinity } = {}) {
  const out = { decisions: [], survival: [], positions: [], works: [] };
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const head = line.slice(0, 400);
    const kind = (head.match(/^\{"kind":"([^"]+)"/) || [])[1];
    const t = frameAt(line);
    if (!(t >= since && t <= to)) continue;
    const pm = head.match(POS);
    const p = pm ? { x: +pm[1], y: +pm[2], z: +pm[3] } : null;
    if (p && /"dimension":"overworld"/.test(head)) out.positions.push({ t, p });
    if (kind === 'survival') out.survival.push({ t, label: (head.match(/"label":"([^"]*)"/) || [])[1] || '' });
    else if (kind === 'action') out.works.push(t);
    if (kind !== 'decision') continue;
    if (!/"id":"(survival_priority|shelter_method|pocket_next|turn_priority|rung_progress|stillness_detour)"/.test(line)) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    const s = o.snapshot || {}, d = s.decision;
    if (!d?.id || !Array.isArray(d.path)) continue;
    const st = d.state || {};
    const rec = { t: Date.parse(d.askedAt || o.at) || t, id: d.id, path: d.path, standIn: !!d.standIn, p: s.position || p, dimension: s.dimension };
    if (['survival_priority', 'shelter_method'].includes(d.id)) {
      const hw = st.riskNow?.hostilesWithin || {};
      rec.facts = { health: st.health ?? s.health, food: st.food ?? s.food, timeOfDay: st.timeOfDay, underground: st.underground ?? st.survivalFacts?.underground ?? null,
        count: hw.count ?? null, inSight: hw.inSight ?? null, sleepDebt: !!(st.survivalFacts?.nightsWithoutSleepTooMany || st.nightsWithoutSleep >= 3),
        mobs: (s.mobs || []).filter(m => HOSTILE.has(m.name) && Number.isFinite(m.d) && m.d <= 24).map(m => ({ name: m.name, distance: m.d, visible: !!m.seen })),
        coming: st.comingAtTheBot ? [].concat(st.comingAtTheBot.list || st.comingAtTheBot).filter(c => c?.name).map(c => ({ name: c.name, distance: c.distance, atBotIn: c.atBotIn })) : [] };
      const chosen = d.options?.[d.path[0]]?.description;
      rec.words = typeof chosen === 'string' ? chosen : chosen?.does || '';
    }
    if (['rung_progress', 'stillness_detour'].includes(d.id)) {
      const step = s.goal?.step || null;
      rec.step = step ? { action: step.action, block: step.block || null, sources: step.sources || null, count: step.count || null, drops: step.drops || null, target: step.target || null } : null;
      const mn = d.options?.mine_nearby?.description;
      rec.mineNearby = typeof mn === 'string' ? mn : null;
      const chosen = d.options?.[d.path.at(-1)]?.description;
      rec.words = typeof chosen === 'string' ? chosen : '';
      rec.frame = s.goal?.portalFrame ? true : false;
    }
    out.decisions.push(rec);
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

function merge(parts) {
  const out = { decisions: [], survival: [], positions: [], works: [] };
  for (const p of parts) for (const k of Object.keys(out)) out[k].push(...p[k]);
  for (const k of ['decisions', 'survival', 'positions']) out[k].sort((a, b) => a.t - b.t);
  out.works.sort((a, b) => a - b);
  return out;
}

const night = t => Number.isFinite(t) && t >= NIGHT && t < DAWN;
// The reason by the rule, from the recorded facts.
function reasonOf(f) {
  const hostiles = f.mobs.length ? f.mobs : [];
  return sealReason({ health: f.health ?? 20, food: f.food ?? 20, underground: !!f.underground, night: night(f.timeOfDay), overworld: true,
    hostiles, coming: f.coming || [], sleepDebt: f.sleepDebt });
}

function analyse(tr, { examples = 0, simulate = false } = {}) {
  const ds = tr.decisions.filter(d => !d.standIn);
  // Seals: survival_priority's seal answers, and shelter_method answers not
  // within 30 s of one (a held shelter plan asked its way again).
  const seals = [];
  for (const d of ds) {
    if (d.id === 'survival_priority' && ['secure_shelter', 'wait_for_day_sealed'].includes(d.path[0])) seals.push({ ...d, via: d.path[0] });
    else if (d.id === 'shelter_method') {
      const prev = seals.at(-1);
      if (prev && d.t - prev.t <= 30000 && !prev.method) { prev.method = d.path.at(-1); continue; }
      seals.push({ ...d, via: 'shelter_method', method: d.path.at(-1) });
    }
  }
  const r = { seals: seals.length, byReason: {}, followed: {}, noneFollowed: {}, sealedMin: {}, noneSealedMin: 0, noneNotNightMine: 0, examples: [], simNone: 0, simRoutine: 0, simRoutineMin: 0, oldNamedReason: 0,
    travel: 0, travelNeedsAtStart: 0, travelReturned: 0, travelReturnedNeeds: 0, travelWalked: 0, travelNet: 0, travelById: {}, travelSimNamed: 0, travelExamples: [] };
  for (const s of seals) {
    const why = reasonOf(s.facts);
    const kind = why.none ? 'none' : why.kinds[0];
    r.byReason[kind] = (r.byReason[kind] || 0) + 1;
    if (why.none) r.simNone++;
    // Under the rock with none: the turn's claim is now routine, beside the work.
    if (why.none && s.facts.underground) { r.simRoutine++; r.simRoutineMin += 0; s._routine = true; }
    // The old words: whether their first sentence named a threat, the
    // surface's night or health (they led with "Prepare and enter a sealed
    // shelter before hostile mobs spawn at night" underground as above).
    if (/^(Seal a pocket here underground and wait|Against|Sealing)/.test(s.words || '')) r.oldNamedReason++;
    // What followed within 60 s.
    const after = ds.filter(x => x.t > s.t && x.t <= s.t + FOLLOW_MS);
    const pn = after.find(x => x.id === 'pocket_next');
    const surv = tr.survival.filter(x => x.t > s.t && x.t <= s.t + FOLLOW_MS).map(x => x.label);
    const nm = s.method === 'night_mine' ? 'night_mine (as the way)' : null;
    const followed = nm || (pn ? `pocket_next ${/^hunt_/.test(pn.path[0]) ? 'hunt' : pn.path[0]}` : surv.includes('night mine') ? 'night mine' : surv.includes('leave shelter') ? 'leave shelter' : surv.includes('wait in shelter') ? 'waited in shelter' : 'nothing asked or done in the pocket');
    r.followed[followed] = (r.followed[followed] || 0) + 1;
    if (why.none) r.noneFollowed[followed] = (r.noneFollowed[followed] || 0) + 1;
    // Sealed until its end.
    const exits = [
      ...ds.filter(x => x.t > s.t && ((x.id === 'pocket_next' && x.path[0] !== 'stay') || (x.id === 'turn_priority' && x.path[0] === 'work'))).map(x => x.t),
      ...tr.survival.filter(x => x.t > s.t && EXIT_LABELS.has(x.label)).map(x => x.t),
    ];
    const nextSeal = seals.find(o => o.t > s.t)?.t ?? Infinity;
    const end = Math.min(s.t + SEALED_CAP_MS, nextSeal, ...exits, tr.positions.at(-1)?.t ?? Infinity);
    const min = Math.max(0, (end - s.t) / 60000);
    const kmin = s.method === 'night_mine' ? 0 : min;
    r.sealedMin[kind] = round((r.sealedMin[kind] || 0) + kmin);
    if (why.none && s.method !== 'night_mine') { r.noneSealedMin += kmin; r.noneNotNightMine++; }
    if (s._routine) r.simRoutineMin += kmin;
    if (why.none && r.examples.length < examples) r.examples.push({ at: new Date(s.t).toISOString(), via: s.via, method: s.method || null, health: s.facts.health, food: s.facts.food, tod: s.facts.timeOfDay,
      underground: s.facts.underground, within24: s.facts.count, inSight: s.facts.inSight, followed, sealedMin: round(min), says: why.says.slice(0, 200) });
  }
  r.noneSealedMin = round(r.noneSealedMin); r.simRoutineMin = round(r.simRoutineMin);
  // Travel answers.
  const JH = simulate ? require('../src/job-in-hand') : null;
  for (const d of ds.filter(x => ['rung_progress', 'stillness_detour'].includes(x.id) && AWAY.test(x.path.at(-1)))) {
    r.travel++;
    const b = r.travelById[d.id] ||= { n: 0, needsAtStart: 0, returned: 0 };
    b.n++;
    const start = d.p;
    const step = d.step;
    const oreWord = step?.block ? step.block.replace(/^deepslate_/, '').replaceAll('_', ' ') : null;
    const needsAtStart = !!(step && (step.target && dist(step.target, start) <= 8 || (oreWord && d.mineNearby && d.mineNearby.includes(`Dig the ${oreWord}`)) || (oreWord && d.mineNearby && d.mineNearby.includes(`deepslate ${oreWord}`))));
    if (needsAtStart) { r.travelNeedsAtStart++; b.needsAtStart++; }
    const path = tr.positions.filter(x => x.t >= d.t && x.t <= d.t + RETURN_MS);
    let walked = 0, far = 0, back = false;
    for (let i = 1; i < path.length; i++) { const step = dist(path[i].p, path[i - 1].p); if (step < 20) walked += step; const off = dist(path[i].p, start); if (off > far) far = off; if (far >= 32 && off <= 16) { back = true; break; } }
    const net = path.length ? dist(path.at(-1).p, start) : 0;
    r.travelWalked += walked; r.travelNet += net;
    if (back) { r.travelReturned++; b.returned++; if (needsAtStart) r.travelReturnedNeeds++; }
    if (JH && step) {
      const said = JH.stepNeedSays(step, { here: start, nearest: step.target || null });
      if (said) r.travelSimNamed++;
    }
    if (r.travelExamples.length < examples) r.travelExamples.push({ at: new Date(d.t).toISOString(), id: d.id, choice: d.path.at(-1), start: start && `${Math.round(start.x)},${Math.round(start.y)},${Math.round(start.z)}`, step: step ? `${step.action} ${step.block || ''} ${step.count || ''}`.trim() : null, needsAtStart, back, walked: Math.round(walked), net: Math.round(net) });
  }
  r.travelWalked = Math.round(r.travelWalked); r.travelNet = Math.round(r.travelNet);
  return r;
}

function total(rows) {
  const t = { seals: 0, byReason: {}, followed: {}, noneFollowed: {}, sealedMin: {}, noneSealedMin: 0, noneNotNightMine: 0, simNone: 0, simRoutine: 0, simRoutineMin: 0, oldNamedReason: 0,
    travel: 0, travelNeedsAtStart: 0, travelReturned: 0, travelReturnedNeeds: 0, travelWalked: 0, travelNet: 0, travelById: {}, travelSimNamed: 0 };
  for (const r of rows) {
    for (const k of ['seals', 'noneSealedMin', 'noneNotNightMine', 'simNone', 'simRoutine', 'simRoutineMin', 'oldNamedReason', 'travel', 'travelNeedsAtStart', 'travelReturned', 'travelReturnedNeeds', 'travelWalked', 'travelNet', 'travelSimNamed']) t[k] = round(t[k] + r[k]);
    for (const f of ['byReason', 'followed', 'noneFollowed', 'sealedMin']) for (const [k, v] of Object.entries(r[f])) t[f][k] = round((t[f][k] || 0) + v);
    for (const [k, b] of Object.entries(r.travelById)) { const a = t.travelById[k] ||= { n: 0, needsAtStart: 0, returned: 0 }; for (const f of Object.keys(a)) a[f] += b[f]; }
  }
  return t;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const has = name => args.includes(name);
  const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
  const since = Date.parse(opt('--since', '2026-09-30T06:00:00Z'));
  const to = opt('--to', null) ? Date.parse(opt('--to')) : Infinity;
  const port = opt('--port', null) ? Number(opt('--port')) : null;
  const examples = Number(opt('--examples', 0)) || 0, simulate = has('--simulate');
  const files = flightFiles(path.join(ROOT, '.bot-state', 'flight'), { since, to, port });
  const byPort = new Map();
  for (const x of files) { if (!byPort.has(x.port)) byPort.set(x.port, []); byPort.get(x.port).push(x); }
  const rows = [];
  for (const [p, list] of byPort) {
    const parts = [];
    for (const x of list) parts.push(await readFile(x.f, { since, to }));
    rows.push({ port: p, files: list.length, ...analyse(merge(parts), { examples, simulate }) });
  }
  const all = total(rows);
  if (has('--json')) { console.log(JSON.stringify({ since: new Date(since).toISOString(), total: all, ports: rows }, null, 2)); return; }
  const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : '-';
  const list = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`Flight records since ${new Date(since).toISOString()}: ${files.length} files, ${rows.length} ports.`);
  console.log(`Seals chosen: ${all.seals}; by the reason the game gives (first named): ${list(all.byReason)}.`);
  console.log(`  No reason (health 20, nothing hostile in sight within 24 or within 8 or coming, not the surface's night): ${all.byReason.none || 0} (${pct(all.byReason.none || 0, all.seals)}).`);
  console.log(`  The chosen option's words named a reason first: ${all.oldNamedReason} of ${all.seals}.`);
  console.log(`What followed within 60 s: ${list(all.followed)}.`);
  console.log(`  After a seal with no reason: ${list(all.noneFollowed)}.`);
  console.log(`Bot-minutes from seal to its end (at most 15 min), by reason: ${list(all.sealedMin)}; with no reason named (the way not the night mine): ${all.noneSealedMin} over ${all.noneNotNightMine} seals.`);
  if (simulate) console.log(`Simulated: the rule's words on each recorded seal say "No reason to seal" on ${all.simNone} of ${all.seals}; every other one opens with its reason. Under the rock with none, the turn's claim is routine, not pressing: ${all.simRoutine} seals, ${all.simRoutineMin} bot-minutes sealed after them.`);
  console.log(`\nTravel answers (rung_progress, stillness_detour: travel_*, look_around, explore): ${all.travel}; ${Object.entries(all.travelById).map(([k, b]) => `${k} ${b.n} (needs at start ${b.needsAtStart}, back within 16 blocks in 10 min ${b.returned})`).join('; ')}.`);
  console.log(`  The stalled step's need was within 8 blocks of the start (or named by mine_nearby): ${all.travelNeedsAtStart} (${pct(all.travelNeedsAtStart, all.travel)}); back at the start within 10 minutes: ${all.travelReturned}, ${all.travelReturnedNeeds} of them with the need there.`);
  console.log(`  Walked ${all.travelWalked} blocks in the 10 minutes after, for ${all.travelNet} net.`);
  if (simulate) console.log(`  Simulated: the travel options would now name the step's need and where it is on ${all.travelSimNamed} of ${all.travel}.`);
  console.log('\nPer port (seals: none/all; no-reason sealed minutes; travel: needs at start/all, back):');
  for (const r of rows.sort((a, b) => b.noneSealedMin - a.noneSealedMin)) {
    console.log(`  ${r.port}: ${r.byReason.none || 0}/${r.seals}; ${r.noneSealedMin} min; travel ${r.travelNeedsAtStart}/${r.travel}, back ${r.travelReturned}`);
    for (const e of r.examples) console.log(`    ${e.at} ${e.via}${e.method ? `>${e.method}` : ''} hp ${e.health} food ${e.food} tod ${e.tod} below ${e.underground} within24 ${e.within24} sight ${e.inSight} -> ${e.followed} (${e.sealedMin} min)`);
    for (const e of r.travelExamples) console.log(`    ${e.at} ${e.id}>${e.choice} from ${e.start} step ${e.step} needsAtStart ${e.needsAtStart} back ${e.back} walked ${e.walked} net ${e.net}`);
  }
}

module.exports = { readFile, analyse, merge, total, reasonOf };
if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });

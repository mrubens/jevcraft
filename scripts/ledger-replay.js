'use strict';
// The ledger's old rule and its new one, on the recorded flight records
// (note 646). The old rule called an answer under a rung "getting somewhere"
// when the bot moved more than three blocks, carried something different, or
// laid or dug a block (decisions/repeats.js cameOf). The new one judges an
// answer of the work's own by the rung's measure (src/rung-measure.js): more
// of what the rung is for, a kill, new ground looked over, a new nearest to
// the fortress, the cage, the blazes or the step's target. This replays the
// day's answers through both and says how many change class, what the flags
// the audit keeps (quickNothing, reaskAfterHold) would have counted per
// bot-hour, and, for the windows asked, each answer with its reason.
//
//   node scripts/ledger-replay.js [--since <iso>] [--to <iso>] [--port 25587 ...] [--examples 12]
//                                 [--show 25587@2026-09-28T18:11:00Z/2026-09-28T18:18:00Z ...] [--json]
// JEV_ROOT reads another checkout's records (from a worktree).
//
// What a replay can and cannot know. A flight record holds each answer as it
// was asked (the question, the answer, the bot's place, what it carried, the
// step) and the bot's positions between. An answer ends here where its
// question is next asked in the same process (the ledger's own settle), at
// most ten minutes on. Not in the record: the stall watch's dug-and-placed
// count (old rule: the change in blocks carried of the rock kinds stands for
// it), kills (the measure's kills are zero throughout, so a kill shows only
// as the rod it may drop), the columns seen from a distance (new ground is the
// 4 x 4 columns the bot stood in, in the Nether: a tunnel dug blind counts
// here and does not in the bot), the blaze cages (none) and the sightings
// (blazes seen in the frames' mob lists). So the replay is generous to the
// new rule on ground and cages, and is a counterfactual on the recorded
// answers, not what the bot would have done had the rule been in force: it
// would have rested and left out some of those answers.
const fs = require('fs');
const path = require('path');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const SRC = path.join(__dirname, '..', 'src');
const RM = require(path.join(SRC, 'rung-measure'));
const tried = require(path.join(SRC, 'tried'));
const { WAIT_ANSWERS } = require(path.join(SRC, 'decisions'));
const { worth, FILLER } = require(path.join(SRC, 'stillness'));
const registry = require('minecraft-data')('26.1');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i < 0 ? null : args[i + 1]; };
const all = name => args.flatMap((a, i) => a === `--${name}` ? [args[i + 1]] : []);
const SINCE = Date.parse(opt('since') || '2026-09-28T00:00:00Z'), TO = Date.parse(opt('to') || '2100-01-01T00:00:00Z');
const PORTS = new Set(all('port'));
const SHOW = all('show').map(s => { const m = s.match(/^(\d+)@(.+)\/(.+)$/); return m && { port: m[1], from: Date.parse(m[2]), to: Date.parse(m[3]) }; }).filter(Boolean);
const JSON_OUT = args.includes('--json');

const TARGET_FROM = 16, TAKEN_BACK = 64, NEARER = 2, GROUND = 3, QUICK_MS = 2000, AT_ONCE_MS = 5000, QUICK_HOLD = 3, HOLD_SAID_MS = 120000, END_CAP_MS = 10 * 60000, REST_AFTER = 2, REST_MS = 5 * 60000, WINDOW_MS = 10 * 60000, NEAR = 4;
const fileStart = f => { const m = f.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const stoodIndex = (list, t) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t < t) lo = m + 1; else hi = m; } return lo; };
const dimOf = d => String(d || '').replace(/^minecraft:/, '').replace(/^the_/, '') || 'overworld';
const cell = p => `${Math.floor(p.x / 4)},${Math.floor(p.z / 4)}`;
const ROCK = /^(cobblestone|cobbled_deepslate|netherrack|dirt|coarse_dirt|gravel|stone|deepslate|andesite|diorite|granite|tuff|blackstone|sand|soul_sand|soul_soil)$/;
const rockCount = inv => Object.entries(inv || {}).filter(([n]) => ROCK.test(n)).reduce((a, [, c]) => a + c, 0);
const worthOf = inv => worth({ inventory: { items: () => Object.entries(inv || {}).map(([name, count]) => ({ name, count })) } });
const P = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? { x: v.x, y: v.y, z: v.z } : null;

// One bot process's frames: its answers (decisions) and the places it stood.
function readIdentity(port) {
  const files = fs.readdirSync(FLIGHT).filter(f => f.startsWith(`127_0_0_1-${port}-`) && f.endsWith('.jsonl'))
    .map(f => ({ f, start: fileStart(f) })).filter(x => x.start >= SINCE && x.start <= TO).sort((a, b) => a.start - b.start);
  const runs = [];
  for (const { f, start } of files) {
    let text; try { text = fs.readFileSync(path.join(FLIGHT, f), 'utf8'); } catch (_) { continue; }
    const run = { file: f, start, decisions: [], stood: [], first: null, last: null };
    for (let i = 0; i < text.length;) {
      let end = text.indexOf('\n', i); if (end < 0) end = text.length;
      const isDecision = text.startsWith('{"kind":"decision"', i), isObs = text.startsWith('{"kind":"observation"', i);
      if (isDecision || isObs) {
        let j; try { j = JSON.parse(text.slice(i, end)); } catch (_) { j = null; }
        const s = j?.snapshot, t = Date.parse(j?.at);
        if (s?.position && Number.isFinite(t) && t <= TO) {
          run.first ??= t; run.last = t;
          const step = s.goal?.step || s.step || null;
          run.stood.push({ t, p: s.position, dim: dimOf(s.dimension), st: P(step?.target) || P(step?.destination) || P(step?.to) || P(step?.cell) || P(step?.portal) });
          if (s.mobs?.length) run.stood.at(-1).mobs = s.mobs.filter(m => m.name === 'blaze' && m.at).map(m => m.at);
          const d = s.decision;
          if (isDecision && d?.id && d.path) run.decisions.push({ t: Date.parse(d.askedAt) || t, at: Date.parse(d.at) || t, id: d.id, method: d.path.join('/'), last: d.path.at(-1), noneGood: !!d.judgments?.[0]?.probabilities && d.path.length === 0,
            p: s.position, dim: dimOf(s.dimension), inv: s.inventory || {}, step: s.goal?.step || null, phase: s.goal?.gameProgress?.phase || null, found: s.goal?.step?.found || null });
        }
      } else if (text.startsWith('{"kind":"connection"', i) || text.includes('"gameProgress":{"version"', i) && end - i < 200000) {
        const seg = text.slice(i, Math.min(end, i + 4000)), m = seg.match(/"gameProgress":\{[^]*?"phase":"([a-z_]+)"/), t = seg.match(/"at":"([^"]+)"$/);
        if (m) (run.phases ||= []).push({ phase: m[1], at: Date.parse(text.slice(i, end).match(/"at":"([^"]+)"\}?$/)?.[1]) || null });
      }
      i = end + 1;
    }
    if (run.decisions.length || run.stood.length) runs.push(run);
  }
  return runs;
}

// The rung's parts, for one answer's asking, from the frame alone.
function partsAt(d, ctx) {
  const items = d.inv ? Object.entries(d.inv).map(([name, count]) => ({ name, count })) : [];
  const bot = { entity: { position: d.p }, game: { dimension: d.dim === 'nether' ? 'the_nether' : d.dim }, inventory: { items: () => items }, registry, blockAt: null };
  const goal = { kind: 'win', step: d.step || {}, fortressSearch: d.found ? { found: P(d.found) } : null, mobHunt: { sightings: ctx.sightings.filter(s => s.dim === d.dim).map(s => ({ ...s.at, dimension: d.dim })) }, gameProgress: { phase: ctx.phase } };
  let parts;
  try {
    const step = d.step || {};
    const target = P(step.target) || P(step.destination) || P(step.to) || P(step.cell) || P(step.portal);
    parts = RM.parts(bot, goal, { rung: ctx.phase, items: tried.rungItems(goal, ctx.phase), target, stepItems: [step.item, step.drops, step.resource, step.block].filter(n => typeof n === 'string' && n) });
  } catch (_) { return null; }
  if (d.dim === 'nether' && /blaze_rods/.test(ctx.phase)) parts.ground = { v: ctx.cells.size, what: 'ground' };
  return parts;
}

function classify(runs) {
  const rows = [];
  const bests = {};
  const cells = new Set(), sightings = [];
  let phase = null;
  for (const run of runs) {
    let pi = 0;
    const phases = (run.phases || []).filter(x => x.at).sort((a, b) => a.at - b.at);
    const stood = run.stood.slice().sort((a, b) => a.t - b.t);
    let si = 0;
    const byQ = {};
    for (const d of run.decisions) (byQ[d.id] ||= []).push(d);
    // Time-ordered walk: stood cells and sightings up to each answer.
    const order = run.decisions.slice().sort((a, b) => a.t - b.t);
    const partsBy = new Map();
    for (const d of order) {
      while (si < stood.length && stood[si].t <= d.t) {
        const s = stood[si++];
        if (s.dim === 'nether') cells.add(cell(s.p));
        for (const m of s.mobs || []) if (!sightings.some(x => x.dim === s.dim && dist3(x.at, m) < 16)) sightings.push({ dim: s.dim, at: m });
      }
      while (pi < phases.length && phases[pi].at <= d.t) phase = phases[pi++].phase;
      d.rung = phase || (d.dim === 'nether' ? 'obtain_blaze_rods' : null);
      d.rungKnown = !!phase;
      if (d.rung) partsBy.set(d, partsAt(d, { phase: d.rung, cells, sightings }));
    }
    // Where an answer was going, when the step it began says so: the first target the bot's step carried while the answer was in force
    // (the options' own targets are not in the record). Judged as tried.js does a walk toward a place (note 629): by its nearest
    // approach, against the earlier answers of its question toward the same place.
    const seen = [];
    const reachHistory = [];
    const walks = { old: 0, now: 0 };
    for (const a of order) {
      const list = byQ[a.id], i = list.indexOf(a), next = list[i + 1];
      if (!next || next.t - a.at > END_CAP_MS || next.t < a.at) continue;
      const moved = dist3(a.p, next.p);
      // What the rule counts now, outside the rung: more of what is worth keeping, not less (a meal eaten is no progress).
      let newCame = moved > GROUND ? `moved ${Math.round(moved)} blocks` : worthOf(a.inv) < worthOf(next.inv) ? 'what is carried changed' : rockCount(a.inv) !== rockCount(next.inv) ? 'a block was dug or placed' : null;
      // The old rule as it stood before note 646: any change of what is carried counted.
      let oldCame = newCame || (worthOf(a.inv) !== worthOf(next.inv) ? 'what is carried changed' : null);
      const wait = WAIT_ANSWERS.has(a.last);
      const owned = !wait && a.rung && tried.workBelowRung(a.id) && !['stillness_detour', 'rung_progress'].includes(a.id);
      const before = partsBy.get(a), after = partsBy.get(next);
      // The place it was going.
      const target = (() => { for (let k = stoodIndex(stood, a.at); k < stood.length && stood[k].t <= next.t; k++) if (stood[k].st) return stood[k].st; return null; })();
      let reach = null, noNearer = false;
      if (target && !wait) {
        const reached = dist3(next.p, target), began = dist3(a.p, target);
        const earlier = reachHistory.filter(h => h.q === a.id && h.t < a.t && dist3(h.target, target) <= TARGET_FROM);
        const best = earlier.length ? earlier.reduce((m, h) => h.reached < m.reached ? h : m) : null;
        noNearer = !!(best && dist3(a.p, best.endP) <= TAKEN_BACK && reached >= best.reached - NEARER);
        reach = { reached, began };
        reachHistory.push({ q: a.id, target, reached, endP: next.p, t: a.t });
      }
      // Before the change a walk that ended no nearer than an earlier one toward the same place was already nothing (note 629).
      if (noNearer && /^moved /.test(oldCame || '')) { oldCame = null; newCame = null; }
      let reason = null;
      if (owned && before && after) {
        const r = RM.judge({ before: RM.values(before), parts: after, store: bests, since: a.t, at: next.t });
        newCame = r.came;
        if (!newCame && reach && moved > GROUND && !noNearer && reach.reached < reach.began - NEARER) newCame = `moved ${Math.round(moved)} blocks toward its own target, ${Math.round(reach.reached)} blocks off it`;
        reason = newCame ? null : RM.says(r.nothing, moved, { food: /food/.test(a.id) });
      }
      rows.push({ port: run.file.match(/-(\d{5})-/)[1], run: run.file, id: a.id, method: a.method, t: a.t, endT: next.t, place: a.p, moved: Math.round(moved), owned: !!(owned && before && after), wait, rung: a.rung, rungKnown: a.rungKnown, targeted: !!target,
        old: oldCame, now: newCame, oldKind: oldCame ? 'progressed' : 'nothing', newKind: newCame ? 'progressed' : 'nothing', reason });
    }
  }
  return rows;
}

// The audit's quickNothing: an answer that came back within QUICK_MS of the last answer to its question, with nothing gained.
// The repeat rule's quick hold: QUICK_HOLD such answers in a row (each within AT_ONCE_MS) hold the question, and a re-ask is an
// asking within two minutes after a hold that chooses a held answer again from within four blocks of where it was held.
function quickOf(rows, kind) {
  const by = {};
  for (const r of rows) (by[`${r.run}|${r.id}`] ||= []).push(r);
  let quick = 0, holds = 0, reasked = 0;
  const byQuestion = {};
  for (const list of Object.values(by)) {
    list.sort((a, b) => a.t - b.t);
    let streak = [], held = null;
    list.forEach((r, i) => {
      if (held && r.t - held.at < HOLD_SAID_MS && held.methods.has(r.method) && dist3(r.place, held.place) <= NEAR) reasked++;
      const gap = r.endT - r.t;
      const nothing = kind === 'old' ? !r.old : !r.now;
      // The next answer came back at once: this one is a quick answer when nothing came of it.
      if (gap < QUICK_MS && nothing) { quick++; byQuestion[r.id] = (byQuestion[r.id] || 0) + 1; }
      if (gap <= AT_ONCE_MS && nothing) {
        streak.push(r);
        if (streak.length >= QUICK_HOLD) { holds++; held = { at: r.endT, place: r.place, methods: new Set(streak.map(s => s.method)) }; streak = []; }
      } else streak = [];
    });
  }
  return { quick, holds, reasked, byQuestion };
}

// The ledger's own rest: an option blocked twice from about the same place in ten minutes rests five minutes from the last. The
// answers that were chosen while it rested (the option would have been left out and said).
function restedOf(rows, kind) {
  const by = {};
  for (const r of rows) (by[`${r.run}|${r.id}|${r.method}`] ||= []).push(r);
  let chosenResting = 0, blocked = 0;
  const byQuestion = {};
  for (const list of Object.values(by)) {
    list.sort((a, b) => a.t - b.t);
    list.forEach((r, i) => {
      const nothing = kind === 'old' ? !r.old : !r.now;
      const prior = list.slice(0, i).filter(o => r.t - o.endT < WINDOW_MS && dist3(o.place, r.place) <= NEAR && (kind === 'old' ? !o.old : !o.now));
      if (prior.length >= REST_AFTER && r.t - Math.max(...prior.map(o => o.endT)) < REST_MS) { chosenResting++; byQuestion[r.id] = (byQuestion[r.id] || 0) + 1; }
      if (nothing) blocked++;
    });
  }
  return { chosenResting, blocked, byQuestion };
}

const pad = (s, n) => String(s).padEnd(n);
const top = (o, n = 6) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(', ');
function main() {
  const ports = fs.readdirSync(FLIGHT).map(f => f.match(/^127_0_0_1-(\d{5})-/)?.[1]).filter(Boolean);
  const list = [...new Set(ports)].filter(p => p !== '25565' && (!PORTS.size || PORTS.has(p))).sort();
  const rows = []; let botMs = 0, runsN = 0;
  for (const port of list) {
    const runs = readIdentity(port);
    for (const r of runs) if (r.first && r.last) { botMs += r.last - r.first; runsN++; }
    rows.push(...classify(runs));
  }
  const hours = botMs / 3600000;
  const owned = rows.filter(r => r.owned);
  const flips = owned.filter(r => r.oldKind !== r.newKind);
  const toNothing = flips.filter(r => r.newKind === 'nothing'), toProgress = flips.filter(r => r.newKind === 'progressed');
  const per = n => Math.round(n / hours * 10) / 10;
  // The flags over every answer judged (the questions outside the rung keep the old rule, so most of what is counted is theirs and
  // does not change), and over the answers under the rung alone, where the rule changed.
  const flagsOf = rs => {
    const oldQ = quickOf(rs, 'old'), newQ = quickOf(rs, 'new'), oldR = restedOf(rs, 'old'), newR = restedOf(rs, 'new');
    return { quickNothing: { old: oldQ.quick, now: newQ.quick, oldPerBotHour: per(oldQ.quick), nowPerBotHour: per(newQ.quick), topNow: top(newQ.byQuestion) },
      quickHolds: { old: oldQ.holds, now: newQ.holds, oldPerBotHour: per(oldQ.holds), nowPerBotHour: per(newQ.holds) },
      reaskAfterHold: { old: oldQ.reasked, now: newQ.reasked, oldPerBotHour: per(oldQ.reasked), nowPerBotHour: per(newQ.reasked) },
      chosenWhileResting: { old: oldR.chosenResting, now: newR.chosenResting, oldPerBotHour: per(oldR.chosenResting), nowPerBotHour: per(newR.chosenResting), topNow: top(newR.byQuestion) },
      cameToNothing: { old: oldR.blocked, now: newR.blocked, oldPerBotHour: per(oldR.blocked), nowPerBotHour: per(newR.blocked) } };
  };
  const byQ = {};
  for (const r of owned) { const q = byQ[r.id] ||= { answers: 0, oldNothing: 0, newNothing: 0, toNothing: 0, toProgress: 0 }; q.answers++; if (r.oldKind === 'nothing') q.oldNothing++; if (r.newKind === 'nothing') q.newNothing++; if (r.oldKind !== r.newKind) (r.newKind === 'nothing' ? q.toNothing++ : q.toProgress++); }
  const oldWhy = {};
  for (const r of toNothing) { const k = (r.old || '').replace(/\d+/g, 'N'); oldWhy[k] = (oldWhy[k] || 0) + 1; }
  const summary = { window: { since: new Date(SINCE).toISOString(), to: Number.isFinite(TO) && TO < 4e12 ? new Date(Math.min(TO, Date.now())).toISOString() : null }, botHours: Math.round(hours * 10) / 10, runs: runsN, bots: list.length,
    answersJudged: rows.length, underTheRung: owned.length, waitsLeftAlone: rows.filter(r => r.wait).length, rungUnknown: rows.filter(r => !r.rung).length,
    old: { progressed: owned.filter(r => r.oldKind === 'progressed').length, nothing: owned.filter(r => r.oldKind === 'nothing').length },
    now: { progressed: owned.filter(r => r.newKind === 'progressed').length, nothing: owned.filter(r => r.newKind === 'nothing').length },
    flipped: flips.length, toNothing: toNothing.length, toProgress: toProgress.length, oldRuleWasBy: oldWhy,
    flags: { underTheRung: flagsOf(owned), everyAnswer: flagsOf(rows) },
    byQuestion: Object.fromEntries(Object.entries(byQ).sort((a, b) => b[1].toNothing - a[1].toNothing).slice(0, 15)) };
  const shown = SHOW.map(w => ({ ...w, rows: rows.filter(r => r.port === w.port && r.t >= w.from && r.t <= w.to).sort((a, b) => a.t - b.t) }));
  if (JSON_OUT) { console.log(JSON.stringify({ summary, shown: shown.map(w => ({ port: w.port, rows: w.rows })) }, null, 2)); return; }
  console.log(`${summary.window.since} to ${summary.window.to || 'now'}: ${summary.bots} bots, ${summary.runs} runs, ${summary.botHours} bot-hours`);
  console.log(`answers judged ${summary.answersJudged} (ended by the same question asked again within ten minutes); under the rung ${summary.underTheRung}; waits left alone ${summary.waitsLeftAlone}; no rung known ${summary.rungUnknown}`);
  console.log(`under the rung, old rule: ${summary.old.progressed} getting somewhere, ${summary.old.nothing} to nothing; new rule: ${summary.now.progressed} getting somewhere, ${summary.now.nothing} to nothing`);
  console.log(`changed class: ${summary.flipped} (${summary.toNothing} to nothing, ${summary.toProgress} to getting somewhere); the old rule had called the ones now nothing: ${top(oldWhy, 8)}`);
  for (const [scope, flags] of Object.entries(summary.flags)) {
    console.log(`flags over ${scope === 'underTheRung' ? 'the answers under the rung' : 'every answer judged (the rest keep the old rule)'}, old -> new (per bot-hour); counterfactual on the recorded answers:`);
    for (const [k, v] of Object.entries(flags)) console.log(`  ${pad(k, 20)} ${v.old} -> ${v.now}  (${v.oldPerBotHour} -> ${v.nowPerBotHour} per bot-hour)${v.topNow ? `   now mostly: ${v.topNow}` : ''}`);
  }
  const examples = Number(opt('examples') || 0);
  if (examples) for (const [title, list] of [['to nothing', toNothing], ['to getting somewhere', toProgress]]) {
    console.log(`\nexamples, ${title} (${list.length}; every ${Math.max(1, Math.floor(list.length / examples))}th):`);
    for (const r of list.filter((_, i) => i % Math.max(1, Math.floor(list.length / examples)) === 0).slice(0, examples)) console.log(`  ${r.port} ${new Date(r.t).toISOString().slice(5, 19)} ${pad(r.id, 18)} ${pad(r.method, 20)} moved ${pad(r.moved, 4)} old: ${pad(r.old || 'nothing', 22)} new: ${r.now || `nothing (${r.reason})`}`);
  }
  console.log('by question (under the rung): answers, old nothing, new nothing, to nothing, to getting somewhere');
  for (const [q, v] of Object.entries(summary.byQuestion)) console.log(`  ${pad(q, 22)} ${v.answers}, ${v.oldNothing}, ${v.newNothing}, ${v.toNothing}, ${v.toProgress}`);
  for (const w of shown) {
    console.log(`\n${w.port} ${new Date(w.from).toISOString()} to ${new Date(w.to).toISOString()}: ${w.rows.length} answers`);
    for (const r of w.rows) console.log(`  ${new Date(r.t).toISOString().slice(11, 19)} ${pad(r.id, 20)} ${pad(r.method, 22)} moved ${pad(r.moved, 4)} ${r.wait ? 'wait, as before' : r.owned ? `old: ${pad(r.old || 'nothing', 26)} new: ${r.now || `nothing (${r.reason})`}` : `not under the rung (${r.old || 'nothing'})`}`);
  }
}
if (require.main === module) main();
module.exports = { classify, quickOf, restedOf, readIdentity };

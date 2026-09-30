'use strict';
// Answers whose run changed nothing (note 765). Read from the flight
// records; read-only.
//   node scripts/zero-delta.js [--since 2026-09-30T12:00Z] [--until ...] [--port 25590] [--top 25] [--json]
//
// For every answer Jev gave to a question about playing the game that the
// ledger keeps (not turn_priority nor shot_answer), in each record file:
//   its mark as given (where the bot stood, what it carried, health, hunger,
//   the dimension; decisions/outcome.js markOfSnapshot), and its window: the
//   option's own stated time (outcome.statedMs, 90 s at least),
//   ended early by the next asking of the same question (the run came back);
//   zero delta: no frame in the window with the bot a block or more from
//   where it was chosen, another count of anything carried (frames that
//   carry the inventory: the decisions and about one observation in ten),
//   health or hunger up by one, or another dimension. Blocks dug or placed
//   are not in the frames: read from what is carried alone, so a little high;
//   exempt: a wait declared as one (outcome.waitWhy), or an answer the ledger
//   takes as a wait (a hold or an emergency of the survival layer within
//   eight seconds, a hold step; index.js waitingByChoice);
//   the minutes after it: from the answer to the first frame that differs
//   from its mark (capped at ten minutes, and at the record's end);
//   the same again at once: the next asking of the question chose the same
//   answer (and within 30 s).
// Then the rule (outcome.replay): a zero-delta answer is said and listed
// last from within 16 blocks of where it was chosen while nothing new is
// carried, up to 10 minutes, and rests from its second such (not a say-only
// question's): the answers chosen again from the same stall after a no-op,
// those the rest would have kept off offer, and their minutes.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const outcome = require('../src/decisions/outcome');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', '2026-09-30T12:00:00Z'));
const until = Date.parse(arg('until', new Date().toISOString()));
const port = arg('port');
const top = Number(arg('top', 25));
const dir = arg('dir', path.join(ROOT, '.bot-state', 'flight'));
const AT_ONCE = 30000, AFTER_CAP = 10 * 60000;
const UNLEDGERED = new Set(['turn_priority', 'shot_answer']);
// Said, never rested (index.js SAY_ONLY).
const SAY_ONLY = new Set(['encounter_stance', 'body_way', 'shot_answer', 'ranged_response']);

let decisions = null;
try { decisions = require('../src/decisions'); } catch (_) { decisions = null; }
const specOf = id => { try { return decisions?.question(id) || { id }; } catch (_) { return { id }; } };
const GAMEPLAY = new Set(['combat', 'endgame', 'home', 'idle', 'resources', 'strategy', 'survival', 'travel', 'work']);
let HOLDS = new Set(), EMERGENCIES = new Set();
try { ({ HOLDS, EMERGENCIES } = require('../src/stillness')); } catch (_) { /* none */ }
const NEVER_HELD = new Set(['turn_priority', 'stillness_detour', 'encounter_stance', 'shot_answer']);
function waiting(id, goal, t) {
  if (id === 'stillness_detour') return false;
  if (NEVER_HELD.has(id)) return true;
  const sa = goal?.survivalAction;
  if (sa?.action && t - Date.parse(sa.at || 0) < 8000 && (HOLDS.has(sa.action) || EMERGENCIES.has(sa.action))) return true;
  return HOLDS.has(goal?.step?.action);
}
const leafAt = (tree, p) => { let n = { children: tree }; for (const k of p) n = n?.children?.[k]; return n || null; };

async function readFile(file) {
  const frames = [], answers = [], errors = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    const t = Date.parse(o.at || '');
    if (!Number.isFinite(t)) continue;
    const s = o.snapshot;
    if (s?.position) frames.push({ t, m: outcome.markOfSnapshot(s) });
    if (/^(error|no_route|navigation_stall)$/.test(o.kind)) errors.push(t);
    if (o.kind !== 'decision' || o.source !== 'jev' || t < since || t > until) continue;
    const d = s?.decision;
    if (!d?.id || !d.path?.length || d.stale || UNLEDGERED.has(d.id)) continue;
    const spec = specOf(d.id);
    if (spec.area && !GAMEPLAY.has(spec.area)) continue;
    const node = leafAt(d.options, d.path);
    const key = d.path.join('/');
    const wait = outcome.waitWhy(spec, key, node) || (waiting(d.id, s.goal, t) ? 'a wait to the ledger' : null);
    answers.push({ t, id: d.id, key, node, mark: outcome.markOfSnapshot(s, node?.target), ms: outcome.statedMs(node), wait, sayOnly: SAY_ONLY.has(d.id), sameStall: Number.isFinite(spec.sameStall) ? spec.sameStall : outcome.NOOP_NEAR });
  }
  return { frames, answers, errors };
}

function judge({ frames, answers, errors = [] }) {
  frames.sort((a, b) => a.t - b.t);
  const lastT = frames.at(-1)?.t ?? 0;
  const out = [];
  const next = {};
  for (let i = answers.length - 1; i >= 0; i--) { const a = answers[i]; a.next = next[a.id] || null; next[a.id] = a; }
  let fi = 0;
  for (const a of answers) {
    if (!a.mark) continue;
    const end = Math.min(a.t + a.ms, a.next ? a.next.t : Infinity);
    if (end > lastT) continue;
    while (fi < frames.length && frames[fi].t <= a.t) fi++;
    let changed = null, j = fi;
    // The next asking's own frame carries what the bot was when it came back.
    for (; j < frames.length && frames[j].t <= end; j++) { changed = outcome.effect(a.mark, frames[j].m); if (changed) break; }
    let afterMs = 0;
    if (!changed) {
      let k = j;
      for (; k < frames.length && frames[k].t - a.t <= AFTER_CAP; k++) if (outcome.effect(a.mark, frames[k].m)) break;
      afterMs = Math.min(AFTER_CAP, (k < frames.length ? frames[k].t : lastT) - a.t);
    }
    const again = a.next && a.next.key === a.key;
    out.push({ t: a.t, id: a.id, key: a.key, zero: !changed, exempt: !!a.wait, waitWhy: a.wait, afterMs, ms: a.ms, again, nextT: a.next ? a.next.t : null, againAtOnce: again && a.next.t - a.t <= AT_ONCE, byAsk: !!a.next && a.next.t <= a.t + a.ms, failSaid: !!a.next && errors.some(e => e > a.t && e <= a.next.t),
      place: a.mark.p, kinds: Object.keys(a.mark.inv || {}), dimension: a.mark.dimension, failed: !changed && !a.wait, sameStall: a.sameStall, sayOnly: a.sayOnly });
  }
  return out;
}

(async () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!port || f.includes(`-${port}-`))).filter(f => {
    const m = f.match(/Jev-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})/);
    if (!m) return false;
    const t0 = Date.parse(`${m[1]}:${m[2]}:${m[3]}Z`);
    return t0 <= until && t0 >= since - 6 * 3600000 && fs.statSync(path.join(dir, f)).mtimeMs >= since;
  }).sort();
  const all = [];
  let botMs = 0;
  for (const f of files) {
    const r = await readFile(path.join(dir, f));
    const inWin = r.frames.filter(x => x.t >= since && x.t <= until);
    if (inWin.length) botMs += inWin.at(-1).t - inWin[0].t;
    const judged = judge(r);
    // The rest, walked per record (a bot process: its ledger's life).
    const rule = outcome.replay(judged);
    const kept = new Set(rule.kept.map(k => k.t + k.id)), said = new Set(rule.said.map(k => k.t + k.id));
    for (const j of judged) { j.keptOff = kept.has(j.t + j.id); j.saidLast = said.has(j.t + j.id); j.file = f; all.push(j); }
  }
  const byQ = {};
  const row = k => byQ[k] ||= { answers: 0, zero: 0, zeroExempt: 0, afterMs: 0, again: 0, againAtOnce: 0, keptOff: 0, keptOffMs: 0, keptOffZero: 0, againAfterRule: 0, byAsk: 0, byTime: 0, late: 0, repeats: 0, repeatsZero: 0, saidLast: 0, saidLastZero: 0 };
  const tot = row('(all)');
  for (const j of all) {
    for (const r of [tot, row(j.id), row(`${j.id} / ${j.key}`)]) {
      r.answers++;
      if (j.zero && j.exempt) r.zeroExempt++;
      if (j.failed) { r.zero++; if (j.byAsk) r.byAsk++; else { r.byTime++; if (j.afterMs <= j.ms + 30000) r.late++; } r.afterMs += j.afterMs; if (j.again) r.again++; if (j.againAtOnce) r.againAtOnce++; }
      if (j.keptOff) { r.keptOff++; if (j.failed) { r.keptOffZero++; r.keptOffMs += j.afterMs; } }
      if (j.saidLast) { r.saidLast++; if (j.failed) r.saidLastZero++; }
      if (j.saidLast || j.keptOff) { r.repeats++; if (j.failed) r.repeatsZero++; }
    }
  }
  if (arg('dump')) fs.writeFileSync(arg('dump'), JSON.stringify(all.map(({ place, kinds, ...j }) => j)));
  const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : '-';
  const min = ms => (ms / 60000).toFixed(1);
  if (argv.includes('--json')) { console.log(JSON.stringify({ since: new Date(since).toISOString(), files: files.length, botHours: botMs / 3600000, byQ }, null, 1)); return; }
  console.log(`${files.length} records, ${(botMs / 3600000).toFixed(1)} bot-hours, since ${new Date(since).toISOString()}`);
  console.log(`answers judged ${tot.answers}; changed nothing within their time ${tot.zero} (${pct(tot.zero, tot.answers)}), besides ${tot.zeroExempt} waits that changed nothing (exempt)`);
  console.log(`of them, judged when the question came back ${tot.byAsk}, at their own time ${tot.byTime} (${tot.late} of those changed something within 30 s after it)`);
  console.log(`bot-minutes after them with nothing changed: ${min(tot.afterMs)}; chosen again at the next asking ${tot.again} (${tot.againAtOnce} within 30 s)`);
  console.log(`the same answer chosen again from the same stall (within 16 blocks, nothing new carried, 10 minutes) after a no-op of it: ${tot.repeats}, ${tot.repeatsZero} of them no-ops again`);
  console.log(`under the rule: the first repeat said and listed last ${tot.saidLast} (${tot.saidLastZero} no-ops again); from the second no-op the answer rests: ${tot.keptOff} answers kept off offer, ${tot.keptOffZero} of them no-ops again (${min(tot.keptOffMs)} bot-minutes after them), ${tot.keptOff - tot.keptOffZero} that changed something`);
  const rows = Object.entries(byQ).filter(([k]) => k !== '(all)' && !k.includes(' / ')).sort((a, b) => b[1].afterMs - a[1].afterMs || b[1].zero - a[1].zero).slice(0, top);
  console.log('\nquestion: answers, no-ops (share), minutes after, again at the next asking (<=30 s), repeats from the stall (no-ops), kept off by the rule (no-ops, minutes); by ask/by time (late)');
  for (const [k, r] of rows) console.log(`  ${k}: ${r.answers}, ${r.zero} (${pct(r.zero, r.answers)}), ${min(r.afterMs)} min, ${r.again} (${r.againAtOnce}), ${r.repeats} (${r.repeatsZero}), ${r.keptOff} (${r.keptOffZero}, ${min(r.keptOffMs)} min); ${r.byAsk}/${r.byTime} (${r.late})`);
  const opts = Object.entries(byQ).filter(([k]) => k.includes(' / ')).sort((a, b) => b[1].zero - a[1].zero).slice(0, top);
  console.log('\nanswer: no-ops of answers, minutes after, again at the next asking (<=30 s), repeats from the stall (no-ops), kept off (no-ops)');
  for (const [k, r] of opts) console.log(`  ${k}: ${r.zero} of ${r.answers}, ${min(r.afterMs)} min, ${r.again} (${r.againAtOnce}), ${r.repeats} (${r.repeatsZero}), ${r.keptOff} (${r.keptOffZero})`);
})();

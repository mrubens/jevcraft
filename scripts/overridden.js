'use strict';
// Answers overridden (note 689): an answer that takes time (a walk to a
// place, a trip, a hunt, a stand) replaced within thirty seconds by another
// question's answer before it arrived, finished or failed. Read from the
// flight records and replayed through src/intention.js's rules twice: as the
// answers were given (before), and with the intention's gate (after), where
// an answer the gate would not have offered is counted as kept from being
// given and the intention goes on. Read-only.
//   node scripts/overridden.js [--since 2026-09-29T12:00Z] [--until ...] [--port 25598] [--pairs 15]
// What ends an intention here is what the records show: arriving within 4
// blocks of its target, the dimension changing, a death, health 4 or more
// lower, ten minutes, its own question asked again, a question told of a
// failure below it (whatFailedBelow, an escalation). A way under it that
// failed and was asked again is not an end (the live ledger's blocked
// settle is not in the records).
const fs = require('node:fs');
const path = require('node:path');
const I = require('../src/intention');
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', new Date(Date.now() - 3 * 3600000).toISOString()));
const until = Date.parse(arg('until', new Date().toISOString()));
const port = arg('port');
const pairsShown = Number(arg('pairs', 12));
const WINDOW = 30000;

const dir = path.join(ROOT, '.bot-state', 'flight');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!port || f.includes(`-${port}-Jev-`)))
  .filter(f => { const m = f.match(/Jev-(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)/); const t = m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}Z`) : 0; return t < until && fs.statSync(path.join(dir, f)).mtimeMs >= since; });
const P = v => v && Number.isFinite(v.x) ? { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) } : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function simulate(frames, gating) {
  const out = { committed: 0, gated: 0, atChange: 0, other: 0, kept: 0, afterFailure: 0, setDown: 0, setDownAfterWithheld: 0, pairs: {}, setDownPairs: {} };
  let cur = null;
  const close = (why, by = null, t = 0) => {
    if (cur && by && t - cur.at <= WINDOW) {
      // Chosen with a failure of its way before Jev (the walk there failed,
      // ways tried and failed): an end, not an override.
      const kind = why === 'set down' ? 'setDown' : by.failed ? 'afterFailure' : I.GATED.has(by.q) ? 'gated' : I.AT_A_CHANGE.has(by.q) ? 'atChange' : 'other';
      out[kind]++;
      if (kind === 'setDown' && cur.withheld) out.setDownAfterWithheld++;
      if (kind === 'setDown' && !cur.withheld) { const k = `${cur.q}/${cur.choice} -> ${by.q}/${by.choice}`; out.setDownPairs[k] = (out.setDownPairs[k] || 0) + 1; }
      if (kind === 'setDown' || kind === 'afterFailure') { cur = null; return; }
      const k = `${cur.q}/${cur.choice} -> ${by.q}/${by.choice}`;
      out.pairs[k] = (out.pairs[k] || 0) + 1;
    }
    cur = null;
  };
  for (const f of frames) {
    const s = f.snapshot || {};
    if (cur) {
      const pos = P(s.position);
      if (f.t - cur.at >= I.MAX_MS || (s.dimension && s.dimension !== cur.dimension) || s.health === 0 ||
        (cur.target && pos && dist(pos, cur.target) <= I.ARRIVED) || (Number.isFinite(s.health) && Number.isFinite(cur.health) && s.health <= cur.health - I.HURT)) close('end');
    }
    if (f.kind !== 'decision') continue;
    const d = s.decision || {}, q = d.id, choice = f.label;
    if (!q || !choice || /Discarded/.test(choice)) continue;
    if (cur && d.state?.whatFailedBelow) close('escalated');
    const options = d.options || {};
    const failed = !!(d.state?.stretch || (Array.isArray(d.state?.failed) && d.state.failed.length));
    const node = options[choice] || {};
    if (cur && q !== cur.q) {
      const way = I.wayOf(q, cur);
      if (gating && I.GATED.has(q)) {
        const kept = Object.keys(options).filter(k => I.serves(cur, q, k, options[k], way));
        if (!kept.includes(choice)) {
          if (!way && !kept.filter(k => !I.KEEP.test(k) && k !== 'none_good').length) close('set down', { q, choice, failed }, f.t);
          else if (kept.length) { out.kept++; cur.withheld = true; continue; }
        }
      }
      if (cur && I.DROP.test(choice)) { close('dropped', { q, choice, failed }, f.t); continue; }
      if (cur && (way || !I.committing(q, choice) || (P(node.target) && cur.target && dist(P(node.target), cur.target) <= I.NEAR))) continue;
    }
    if (!I.committing(q, choice)) continue;
    if (cur && cur.q === q && cur.choice === choice) continue;
    if (cur) close('replaced', q === cur.q ? null : { q, choice, failed }, f.t);
    cur = { q, choice, at: f.t, target: P(node.target), dimension: s.dimension, health: s.health };
    out.committed++;
  }
  return out;
}

const total = { before: null, after: null };
const add = (a, b) => { if (!a) return JSON.parse(JSON.stringify(b)); for (const k of ['committed', 'gated', 'atChange', 'other', 'kept', 'afterFailure', 'setDown', 'setDownAfterWithheld']) a[k] += b[k]; for (const w of ['pairs', 'setDownPairs']) for (const [k, v] of Object.entries(b[w])) a[w][k] = (a[w][k] || 0) + v; return a; };
for (const f of files) {
  const frames = [];
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch (_) { continue; }
    const at = typeof e.at === 'number' ? e.at : Date.parse(e.at);
    if (at >= since && at < until) frames.push({ ...e, t: at });
  }
  total.before = add(total.before, simulate(frames, false));
  total.after = add(total.after, simulate(frames, true));
}
console.log(`${files.length} records, ${new Date(since).toISOString()} to ${new Date(until).toISOString()}${port ? `, port ${port}` : ''}`);
for (const [name, t] of Object.entries(total)) {
  if (!t) continue;
  const n = t.gated + t.atChange + t.other;
  console.log(`${name}: ${t.committed} intentions begun; replaced within ${WINDOW / 1000} s by another question ${n} (${Math.round(100 * n / Math.max(1, t.committed))}%): by a plan question ${t.gated}, at a stall or the rung's question ${t.atChange}, other ${t.other}; ended within ${WINDOW / 1000} s after a failure of its way ${t.afterFailure}, set down by a question about something else ${t.setDown}${t.setDownAfterWithheld ? ` (${t.setDownAfterWithheld} of them after an answer the gate withheld: the record goes on as the withheld answer played out)` : ''}${name === 'after' ? `; answers the gate would not have offered ${t.kept}` : ''}`);
  for (const [k, v] of Object.entries(t.pairs).sort((a, b) => b[1] - a[1]).slice(0, pairsShown)) console.log(`   ${String(v).padStart(5)}  ${k}`);
  if (t.setDown) console.log('  set down:');
  for (const [k, v] of Object.entries(t.setDownPairs).sort((a, b) => b[1] - a[1]).slice(0, pairsShown)) console.log(`   ${String(v).padStart(5)}  ${k}`);
}

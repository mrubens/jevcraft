'use strict';
// Answers whose action ended in failure within two seconds, and the chains
// of questions answered one after another (note 695). Read from the flight
// records; read-only.
//   node scripts/instant-failures.js [--since 2026-09-29T18:00Z] [--until ...] [--port 25591] [--top 25] [--within 2000]
// An answer failed at once when an error or no_route frame comes within
// --within ms of it and before the next question; a chain is three or more
// questions answered by Jev (more than one option weighed) within five
// seconds, none of the survival layer's stance questions counted.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', new Date(Date.now() - 3 * 3600000).toISOString()));
const until = Date.parse(arg('until', new Date().toISOString()));
const port = arg('port');
const top = Number(arg('top', 25));
const WITHIN = Number(arg('within', 2000));
const CHAIN_MS = 5000, CHAIN_N = 3;
const INTERRUPT = /^(Threat nearby|Preempted by|The bot died|Low air|Interrupted|Cancelled)/;
const STANCE = /^(encounter_stance|turn_priority|shot_answer|shield_guard|combat_kit|unstuck_move)$/;

const dir = path.join(ROOT, '.bot-state', 'flight');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!port || f.includes(`-${port}-Jev-`)))
  .filter(f => fs.statSync(path.join(dir, f)).mtimeMs >= since);
const count = (m, k) => { m[k] = (m[k] || 0) + 1; };
const out = { answers: 0, interrupted: 0, failedFast: 0, planAnswers: 0, planFailed: 0, nextFast: 0, byOption: {}, byQuestion: {}, askedByQuestion: {}, why: {}, chains: 0, inChains: 0, chainPairs: {}, examples: [] };
for (const f of files) {
  const frames = [];
  for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!l) continue;
    let o; try { o = JSON.parse(l); } catch (_) { continue; }
    const t = Date.parse(o.at || '');
    if (!Number.isFinite(t) || t < since || t > until) continue;
    if (o.kind === 'observation') continue;
    frames.push({ ...o, t });
  }
  const asked = [];
  for (let i = 0; i < frames.length; i++) {
    const o = frames[i];
    if (o.kind !== 'decision') continue;
    const d = o.snapshot?.decision || {};
    const probs = d.judgments?.[0]?.probabilities || {};
    if (Object.keys(probs).filter(k => k !== 'none_good').length < 2) continue;
    const q = d.id, choice = o.label;
    if (!q || !choice) continue;
    out.answers++; count(out.askedByQuestion, q); if (!STANCE.test(q)) out.planAnswers++;
    let failed = null, next = null;
    for (let j = i + 1; j < frames.length && frames[j].t - o.t <= WITHIN; j++) {
      if (frames[j].kind === 'decision') { next = frames[j]; break; }
      if (!failed && (frames[j].kind === 'error' || frames[j].kind === 'no_route')) { if (INTERRUPT.test(String(frames[j].label || ''))) { out.interrupted++; break; } failed = frames[j]; }
    }
    if (next) out.nextFast++;
    if (failed) {
      out.failedFast++; if (!STANCE.test(q)) out.planFailed++; count(out.byOption, `${q}/${choice}`); count(out.byQuestion, q);
      const why = String(failed.label || '').replace(/\(-?\d+, -?\d+(, -?\d+)?\)/g, '(…)').replace(/\d+/g, 'N').slice(0, 90);
      count(out.why, why);
      if (out.examples.length < 8 && /25591|25585|25588/.test(f)) out.examples.push(`${o.at.slice(11, 19)} ${f.match(/-(\d{5})-/)[1]} ${q}/${choice}: ${String(failed.label).slice(0, 140)}`);
    }
    if (!STANCE.test(q)) asked.push({ t: o.t, k: `${q}/${choice}` });
  }
  // chains: runs of 3+ plan answers each within 5 s of the first
  let i = 0;
  while (i < asked.length) {
    let j = i;
    while (j + 1 < asked.length && asked[j + 1].t - asked[i].t <= CHAIN_MS) j++;
    if (j - i + 1 >= CHAIN_N) {
      out.chains++; out.inChains += j - i + 1;
      for (let k = i; k < j; k++) count(out.chainPairs, `${asked[k].k} -> ${asked[k + 1].k}`);
      i = j + 1;
    } else i++;
  }
}
const topOf = (m, n = top) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`${files.length} records since ${new Date(since).toISOString()}`);
console.log(`answers weighed by Jev: ${out.answers}; next question within ${WITHIN / 1000} s: ${out.nextFast}; an error or no_route within ${WITHIN / 1000} s: ${out.failedFast} (${(100 * out.failedFast / Math.max(1, out.answers)).toFixed(1)}%)`);
console.log(`interrupted by the survival layer within ${WITHIN / 1000} s (not counted): ${out.interrupted}; plan answers (stance questions aside) ${out.planAnswers}, failed at once ${out.planFailed} (${(100 * out.planFailed / Math.max(1, out.planAnswers)).toFixed(1)}%)`);
console.log('\nby question (failed fast / asked):');
for (const [k, v] of topOf(out.byQuestion)) console.log(`  ${v}\t/ ${out.askedByQuestion[k]}\t${k}`);
console.log('\nby option:');
for (const [k, v] of topOf(out.byOption)) console.log(`  ${v}\t${k}`);
console.log('\nwhy (first failure frame):');
for (const [k, v] of topOf(out.why, 15)) console.log(`  ${v}\t${k}`);
console.log(`\nchains (${CHAIN_N}+ plan answers within ${CHAIN_MS / 1000} s): ${out.chains}, ${out.inChains} answers in them`);
for (const [k, v] of topOf(out.chainPairs, 15)) console.log(`  ${v}\t${k}`);
console.log('\nexamples:'); for (const e of out.examples) console.log(`  ${e}`);

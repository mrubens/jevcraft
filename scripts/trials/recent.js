'use strict';
// What a trial's bot did in its last minutes, compact enough to read in one
// sitting: each question Jev was asked (its id, the answer and its probability,
// the confidence, and the runner-up), each hurt with health before and after, each chat
// line, and where the bot stood. Read-only; for a person or an agent
// looking for the dumb thing a trial is doing (the live critic,
// scripts/trials/critic.sh).
//   node scripts/trials/recent.js <port> [--minutes 10] [--options]
// --options prints each question's option texts too (long).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..', '..');
const argv = process.argv.slice(2);
const port = argv.find(a => /^\d{5}$/.test(a));
const minutes = Number(argv[argv.indexOf('--minutes') + 1]) || 10;
const withOptions = argv.includes('--options');
if (!port) { console.error('usage: recent.js <port> [--minutes 10] [--options]'); process.exit(2); }

const dir = path.join(ROOT, '.bot-state', 'flight');
const files = fs.readdirSync(dir).filter(f => f.includes(`-${port}-Jev-`) && f.endsWith('.jsonl')).map(f => path.join(dir, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, 2).reverse();
const since = Date.now() - minutes * 60000;
const t = at => new Date(at).toISOString().slice(11, 19);
const r = n => Math.round(n);
const pos = s => s?.position ? `${r(s.position.x)},${r(s.position.y)},${r(s.position.z)}` : '?';

// The question behind a decision frame: the recorder keeps it at
// snapshot.decision (id, options, judgments, asked).
function asked(e) {
  const d = e.snapshot?.decision || {};
  return { id: d.id || null, judgments: d.judgments || null, options: d.options || null };
}
const said = e => String(e.detail?.message ?? e.message ?? '');

let lastHealth = null, lastDim = null;
for (const file of files) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch (_) { continue; }
    const s = e.snapshot || {};
    const at = typeof e.at === 'number' ? e.at : Date.parse(e.at);
    if (!(at >= since)) { if (s.health != null) lastHealth = s.health; continue; }
    if (s.dimension && s.dimension !== lastDim) { console.log(`${t(e.at)} -- in ${s.dimension}`); lastDim = s.dimension; }
    if (e.kind === 'decision') {
      const q = asked(e), j = q.judgments?.[0];
      const probs = j?.probabilities ? Object.entries(j.probabilities).sort((a, b) => b[1] - a[1]) : [];
      // The answer's probability beside the runner-up's, the same measure
      // (the confidence is the service's own and runs lower: 25595's
      // step_aside printed 0.27 against dig_out's 0.43 when the
      // distribution had them 0.51 and 0.43, note 678). An answer the
      // distribution does not put first (none good, a fallback) is marked.
      const mine = j?.probabilities?.[e.label];
      const runner = probs.find(([k]) => k !== e.label);
      const top = probs[0] && probs[0][0] !== e.label ? ` [top ${probs[0][0]} ${probs[0][1]}]` : '';
      const conf = j?.confidence != null ? ` conf ${j.confidence}` : '';
      console.log(`${t(e.at)} ${pos(s)} hp ${r(s.health ?? 0)} food ${s.food ?? '?'}  ${q.id || e.source || ''} -> ${e.label}${mine != null ? ` ${mine}` : ''}${conf ? ` (${conf.trim()})` : ''}${runner ? `, next ${runner[0]} ${runner[1]}` : ''}${top}`);
      const text = v => typeof v === 'string' ? v : typeof v?.description === 'string' ? v.description : v?.description?.does || v?.label || JSON.stringify(v?.description ?? v) || String(v);
      if (withOptions && q.options) for (const [k, v] of Object.entries(q.options)) console.log(`      ${k}: ${String(text(v)).slice(0, 400)}`);
    } else if (e.kind === 'chat') {
      const m = said(e); if (m) console.log(`${t(e.at)} chat: ${m.slice(0, 160)}`);
    } else if (['error', 'no_route', 'navigation_stall'].includes(e.kind)) {
      console.log(`${t(e.at)} ${pos(s)} ${e.kind}: ${String(e.label || '').slice(0, 120)}`);
    }
    if (s.health != null) {
      if (lastHealth != null && s.health < lastHealth - 0.4) console.log(`${t(e.at)} ${pos(s)} HURT ${lastHealth.toFixed(1)} -> ${s.health.toFixed(1)}${(s.keys || []).includes('shield') ? ' (shield up)' : ''}`);
      lastHealth = s.health;
    }
  }
}

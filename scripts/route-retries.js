'use strict';
// Goals retried after "No route" (note 775). Read from the flight records;
// read-only.
//   node scripts/route-retries.js [--since 2026-09-30T12:00Z] [--until ...] [--port 25589] [--min 5] [--top 20] [--json]
//
// A spell is a run of errors in one record file that say "No route from here
// to (x, y, z)" with the same (x, y, z), each within five minutes of the one
// before (other targets' failures between them do not end it). For each spell with --min failures or more:
//   failures, the persist attempts counted in it (the loop's own counter,
//   work.js persist), the highest "I'll keep trying (attempt N)" said in
//   chat, its minutes, how far the bot ever got from where it began and its
//   distance to the target, the questions answered inside it (by answer);
//   what broke it, the first of: the record ended (within two minutes of the
//   last failure), the dimension changed, the bot came within 4 blocks of the
//   target, a death, or the work went on to other steps for five minutes with
//   no failure toward that target (said with the last answer before it).
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', '2026-09-30T12:00:00Z'));
const until = Date.parse(arg('until', new Date().toISOString()));
const port = arg('port');
const MIN = Number(arg('min', 5));
const top = Number(arg('top', 20));
const dir = arg('dir', path.join(ROOT, '.bot-state', 'flight'));
const GAP = 5 * 60000;
const NO_ROUTE = /No route from here to \((-?\d+), (-?\d+), (-?\d+)\)/;
const ATTEMPT = /keep trying \(attempt (\d+)\)/;

const fileStart = f => { const m = f.match(/Jev-(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d+)Z/); return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) : NaN; };
const files = fs.readdirSync(dir).filter(f => /\.jsonl$/.test(f) && (!port || f.includes(`-${port}-`)))
  .filter(f => { const t = fileStart(f); return Number.isFinite(t) && t <= until; }).sort();

const flat = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function readFile(file) {
  const spells = [];
  const opens = new Map();
  let lastAt = 0, lastDim = null, lastPos = null;
  const close = (open, why, at) => { open.broke = why; open.brokeAt = at; spells.push(open); opens.delete(open.key); };
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, file)), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const head = line.slice(0, 40);
    const isErr = head.includes('"kind":"error"'), isChat = head.includes('"kind":"chat"'), isDec = head.includes('"kind":"decision"');
    const atM = line.match(/"at":"(\d{4}-[^"]+)"\}\s*$/);
    const t = atM ? Date.parse(atM[1]) : NaN;
    if (!Number.isFinite(t)) continue;
    if (t < since || t > until) { lastAt = t; continue; }
    // The bot's own position: the snapshot's (cheap: a match, not a parse).
    const pm = line.match(/"snapshot":\{"connected":true,"position":\{"x":(-?[\d.e-]+),"y":(-?[\d.e-]+),"z":(-?[\d.e-]+)\},"dimension":"([a-z_]+)"/);
    const pos = pm ? { x: +pm[1], y: +pm[2], z: +pm[3] } : lastPos;
    const dim = pm ? pm[4] : lastDim;
    for (const open of [...opens.values()]) {
      if (t - open.lastAt > GAP) close(open, `went on to other work for five minutes${open.lastAnswer ? ` (last answer: ${open.lastAnswer})` : ''}`, open.lastAt + GAP);
      else if (dim && open.dim && dim !== open.dim) close(open, 'the dimension changed', t);
      else if (pos && flat(pos, open.target) <= 4) close(open, 'came within 4 blocks of the target', t);
      else if (/"health":0[,}]/.test(line) || head.includes('"kind":"death"')) close(open, 'a death', t);
      else if (pos) open.far = Math.max(open.far, flat(pos, open.from));
    }
    if (isDec) {
      const lm = line.match(/"label":"([^"]+)"/);
      if (lm) for (const open of opens.values()) { open.answers[lm[1]] = (open.answers[lm[1]] || 0) + 1; open.lastAnswer = lm[1]; }
    }
    if (isChat) { const am = line.match(ATTEMPT); if (am) for (const open of opens.values()) open.chatAttempt = Math.max(open.chatAttempt, +am[1]); }
    if (isErr) {
      const nm = line.match(NO_ROUTE);
      if (nm) {
        const target = { x: +nm[1], y: +nm[2], z: +nm[3] };
        const key = `${target.x},${target.y},${target.z}`;
        let open = opens.get(key);
        if (!open) { open = { file, key, target, start: t, lastAt: t, failures: 0, attempts: new Set(), chatAttempt: 0, from: pos || target, far: 0, dim, answers: {}, lastAnswer: null, distance: pos ? flat(pos, target) : null }; opens.set(key, open); }
        open.failures++; open.lastAt = t;
        if (pos) (open.events ||= []).push({ t, pos });
        const at = line.match(/"action":"persist","attempt":(\d+)/); if (at) open.attempts.add(+at[1]);
        if (pos) open.distance = flat(pos, target);
      }
    }
    lastAt = t; lastPos = pos; lastDim = dim;
  }
  for (const open of [...opens.values()]) close(open, lastAt - open.lastAt > GAP ? `went on to other work for five minutes${open.lastAnswer ? ` (last answer: ${open.lastAnswer})` : ''}` : 'the record ended', lastAt);
  return spells;
}

(async () => {
  const all = [];
  for (const f of files) {
    const spells = await readFile(f);
    all.push(...spells);
  }
  const big = all.filter(s => s.failures >= MIN);
  const minutes = s => (s.lastAt - s.start) / 60000;
  // The rule (route-aside.js, note 775) replayed: each failure in order from
  // where the bot stood; from the one that sets the target aside on, the
  // step goes to the stall's question with that said, not round again.
  const ra = require('../src/route-aside');
  for (const s of all) {
    const goal = {};
    for (const e of s.events || []) {
      const r = ra.noteFailure(goal, { message: `No route from here to (${s.target.x}, ${s.target.y}, ${s.target.z})`, destination: s.target }, e.pos, e.t);
      if (r?.aside && s.asideAt == null) { s.asideAt = e.t; s.asideIndex = (s.events.indexOf(e) + 1); }
    }
  }
  const rows = big.map(s => ({ port: (s.file.match(/-(\d{5})-/) || [])[1], file: s.file, start: new Date(s.start).toISOString(), target: s.key,
    distance: Math.round(s.distance ?? -1), failures: s.failures, persistAttempts: s.attempts.size, maxAttempt: Math.max(0, ...s.attempts), chatAttempt: s.chatAttempt,
    minutes: +minutes(s).toFixed(1), asideAtFailure: s.asideIndex ?? null, minutesAfterAside: s.asideAt ? +((s.lastAt - s.asideAt) / 60000).toFixed(1) : 0, failuresAfterAside: s.asideIndex ? s.failures - s.asideIndex : 0, farFromStart: Math.round(s.far), answers: s.answers, broke: s.broke }));
  rows.sort((a, b) => b.minutes - a.minutes);
  const sum = (k, xs = rows) => xs.reduce((n, r) => n + r[k], 0);
  const byBroke = {};
  for (const r of rows) { const k = r.broke.replace(/ \(last answer: .*\)$/, ''); (byBroke[k] ||= { spells: 0, minutes: 0 }); byBroke[k].spells++; byBroke[k].minutes += r.minutes; }
  const lastAnswers = {};
  for (const r of rows) { const m = r.broke.match(/last answer: ([^)]+)/); if (m) lastAnswers[m[1]] = (lastAnswers[m[1]] || 0) + 1; }
  const asideRows = rows.filter(r => r.asideAtFailure);
  const out = {
    rule: { setAside: asideRows.length, failuresAfter: sum('failuresAfterAside', asideRows), minutesAfter: +sum('minutesAfterAside', asideRows).toFixed(1), medianAsideAt: asideRows.map(r => r.asideAtFailure).sort((a, b) => a - b)[Math.floor(asideRows.length / 2)] ?? null },
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString(), files: files.length },
    spells: all.length, retried: rows.length, failures: sum('failures'), persistAttempts: sum('persistAttempts'), minutes: +sum('minutes').toFixed(1),
    chatAttemptMax: Math.max(0, ...rows.map(r => r.chatAttempt)), spellsWithAttemptChat: rows.filter(r => r.chatAttempt).length,
    over20Failures: rows.filter(r => r.failures >= 20).length, stillOver: rows.filter(r => r.farFromStart < 16).length,
    targetsFar: rows.filter(r => r.distance > 128).length,
    byBroke, lastAnswers, top: rows.slice(0, top),
  };
  if (argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log(`flight records ${files.length}, ${out.window.since} .. ${out.window.until}`);
  console.log(`no-route spells ${out.spells}; retried ${MIN}+ times: ${out.retried} (${out.failures} failures, ${out.persistAttempts} persist attempts, ${out.minutes} minutes)`);
  console.log(`  with 20+ failures ${out.over20Failures}; never 16 blocks from where they began ${out.stillOver}; target over 128 blocks off ${out.targetsFar}`);
  console.log(`  "keep trying (attempt N)" said in ${out.spellsWithAttemptChat}, highest N ${out.chatAttemptMax}`);
  console.log(`the rule (3 from about here): ${out.rule.setAside} spells set aside (at failure ${out.rule.medianAsideAt}, median); ${out.rule.failuresAfter} failures and ${out.rule.minutesAfter} minutes came after, each now the stall's question with the set-aside said instead of a silent retry`);
  console.log('what broke them:'); for (const [k, v] of Object.entries(byBroke).sort((a, b) => b[1].minutes - a[1].minutes)) console.log(`  ${k}: ${v.spells} spells, ${v.minutes.toFixed(1)} min`);
  console.log('last answer before going on:'); for (const [k, v] of Object.entries(lastAnswers).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${k}: ${v}`);
  console.log('longest:');
  for (const r of rows.slice(0, top)) console.log(`  ${r.port} ${r.start.slice(5, 19)} to (${r.target}) ${r.distance} off: ${r.failures} failures, ${r.persistAttempts} attempts (chat ${r.chatAttempt}), ${r.minutes} min, ${r.farFromStart} blocks from start;${r.asideAtFailure ? ` set aside at failure ${r.asideAtFailure} (${r.minutesAfterAside} min after);` : ''} ${r.broke}; answers ${Object.entries(r.answers).map(([k, v]) => `${k}${v > 1 ? `x${v}` : ''}`).join(' ').slice(0, 160)}`);
})();

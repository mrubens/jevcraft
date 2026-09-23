'use strict';
// A day of play, audited. Reads the flight recorder (every observation a
// second, every action, survival choice, decision and error as it happened)
// for a window of time, and writes a report of everything that looks wrong:
// standing still, time in water, retry loops, pacing, steps flipping back
// and forth, errors, damage, items made and thrown away. Plus where the time
// went and what the day cost in Jev inference. Each flagged stretch is a
// place to look; the report says where and when, and what the bot was doing.
//
//   node scripts/audit-day.js --from 2026-09-23T14:05:00Z --to 2026-09-23T14:25:00Z
//   node scripts/audit-day.js --minutes 20          # the last twenty minutes
//   AUDIT_IDENTITY=127_0_0_1-25580-Jev (default)
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => a.startsWith('--') ? [...out, [a.slice(2), all[i + 1]]] : out, []));
const identity = process.env.AUDIT_IDENTITY || '127_0_0_1-25580-Jev';
const to = args.to ? Date.parse(args.to) : Date.now();
const from = args.from ? Date.parse(args.from) : to - Number(args.minutes || 20) * 60000;
const dir = path.join(__dirname, '..', '.bot-state', 'flight');

// Every file that may hold frames in the window: named by its start time.
const files = fs.readdirSync(dir).filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl'))
  .map(f => ({ f, start: Date.parse(f.slice(identity.length + 1, -6).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z')) }))
  .sort((a, b) => a.start - b.start);
const frames = [];
files.forEach(({ f, start }, i) => {
  const next = files[i + 1]?.start ?? Infinity;
  if (next < from || start > to) return;
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    const at = Date.parse(r.at);
    if (at >= from && at <= to) frames.push({ ...r, t: at, file: f });
  }
});
frames.sort((a, b) => a.t - b.t);
if (!frames.length) { console.error(`No frames between ${new Date(from).toISOString()} and ${new Date(to).toISOString()}`); process.exit(1); }

const clock = t => new Date(t).toISOString().slice(11, 19);
const secs = ms => Math.round(ms / 1000);
const pos = s => s?.position ? `(${Math.round(s.position.x)}, ${Math.round(s.position.y)}, ${Math.round(s.position.z)})` : '?';
const stepOf = s => s?.step?.action || s?.goal?.step?.action || null;
const survivalOf = s => s?.survivalAction?.action || s?.goal?.survivalAction?.action || null;
// The survival action stays in the snapshot after it ends: only a recent one
// is what the bot is doing (the first audit charged six minutes to "eat").
const currentSurvival = (s, t) => { const a = s?.survivalAction || s?.goal?.survivalAction; return a && (!a.at || t - Date.parse(a.at) < 8000) ? a.action : null; };
const dist = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0;
const obs = frames.filter(f => f.kind === 'observation' && f.snapshot?.position);

// Where the time went: each observation second charged to the survival
// action if one is current and recent, otherwise to the work step.
const time = {};
for (let i = 0; i < obs.length - 1; i++) {
  const s = obs[i].snapshot, dt = Math.min(obs[i + 1].t - obs[i].t, 5000);
  const survival = currentSurvival(s, obs[i].t), step = stepOf(s);
  const key = survival ? `survival:${survival}` : `step:${step || 'none'}`;
  time[key] = (time[key] || 0) + dt;
}

// Stretches of standing still: under half a block from where the stretch
// began, for twenty seconds or more. Waiting in a shelter or a bed at night
// is labelled as such rather than hidden.
const WAITS = new Set(['wait_in_shelter', 'sleep', 'sleep_in_bed', 'wait_for_bedtime', 'hold_defensive_position']);
const still = [];
for (let i = 0; i < obs.length;) {
  let j = i;
  while (j + 1 < obs.length && dist(obs[j + 1].snapshot.position, obs[i].snapshot.position) < 0.5) j++;
  const span = obs[j].t - obs[i].t;
  if (span >= 20000) {
    const s = obs[i].snapshot, survivals = new Set(obs.slice(i, j + 1).map(o => currentSurvival(o.snapshot, o.t)).filter(Boolean));
    still.push({ from: obs[i].t, to: obs[j].t, seconds: secs(span), at: pos(s), step: stepOf(s), survival: [...survivals].join('/'),
      waiting: [...survivals].some(a => WAITS.has(a)) });
  }
  i = j + 1;
}

// In water: air below full, or the shore and surfacing actions.
const wet = [];
for (let i = 0; i < obs.length;) {
  const inWater = o => (o.snapshot.oxygen ?? 20) < 20 || /reach_shore|surface|swim/.test(survivalOf(o.snapshot) || '') || /reach_shore|dig_to_shore/.test(stepOf(o.snapshot) || '');
  if (!inWater(obs[i])) { i++; continue; }
  let j = i;
  while (j + 1 < obs.length && (inWater(obs[j + 1]) || obs[j + 1].t - obs[j].t < 3000 && inWater(obs[Math.min(j + 2, obs.length - 1)]))) j++;
  const span = obs[j].t - obs[i].t;
  if (span >= 10000) wet.push({ from: obs[i].t, to: obs[j].t, seconds: secs(span), at: pos(obs[i].snapshot), minAir: Math.min(...obs.slice(i, j + 1).map(o => o.snapshot.oxygen ?? 20)),
    step: stepOf(obs[i].snapshot), survival: survivalOf(obs[i].snapshot) });
  i = j + 1;
}

// Pacing: a minute in which the bot walked more than thirty blocks and ended
// within five of where it began.
const pacing = [];
for (let i = 0; i < obs.length; i++) {
  let j = i, walked = 0;
  while (j + 1 < obs.length && obs[j + 1].t - obs[i].t <= 60000) { walked += dist(obs[j].snapshot.position, obs[j + 1].snapshot.position); j++; }
  if (obs[j].t - obs[i].t >= 50000 && walked > 30 && dist(obs[i].snapshot.position, obs[j].snapshot.position) < 5) {
    pacing.push({ from: obs[i].t, to: obs[j].t, walked: Math.round(walked), net: Math.round(dist(obs[i].snapshot.position, obs[j].snapshot.position)), at: pos(obs[i].snapshot), step: stepOf(obs[i].snapshot) });
    i = j;
  }
}

// Steps flipping: the work step changing back and forth between the same
// two actions six times or more within a minute.
const flips = [];
const changes = [];
for (const o of obs) { const a = stepOf(o.snapshot); if (a && changes.at(-1)?.a !== a) changes.push({ a, t: o.t, s: o.snapshot }); }
for (let i = 0; i + 6 < changes.length; i++) {
  const win = changes.slice(i, i + 7);
  const names = new Set(win.map(c => c.a));
  if (names.size === 2 && win[6].t - win[0].t <= 60000) { flips.push({ from: win[0].t, to: win[6].t, between: [...names].join(' <-> '), at: pos(win[0].s) }); i += 6; }
}

// Retry loops: "persist" steps and repeated problems, by problem text.
const problems = {};
for (const o of obs) {
  const st = o.snapshot.step;
  if (st?.action === 'persist' && st.problem) { const p = problems[st.problem] ||= { count: 0, first: o.t, last: o.t, attempts: new Set() }; p.last = o.t; p.attempts.add(st.attempt); }
}
for (const p of Object.values(problems)) p.count = p.attempts.size;

// Errors, damage, deaths, and what was said.
const errors = {};
for (const f of frames.filter(f => f.kind === 'error')) { const k = String(f.label).slice(0, 110); (errors[k] ||= { count: 0, first: f.t, step: stepOf(f.snapshot) }).count++; }
const damage = [];
let lastHealth = null;
for (const f of frames) {
  const h = f.snapshot?.health;
  if (typeof h !== 'number') continue;
  if (lastHealth !== null && h < lastHealth - 0.5) damage.push({ t: f.t, from: lastHealth, to: h, at: pos(f.snapshot), step: stepOf(f.snapshot), survival: survivalOf(f.snapshot) });
  lastHealth = h;
}
const deaths = damage.filter(d => d.to <= 0);
const chat = frames.filter(f => f.kind === 'chat').map(f => ({ t: f.t, text: f.detail?.message || f.label, from: f.detail?.from }));
// Made and thrown away: a "leaving N X here" said after X was crafted or
// taken in the same stretch.
const thrown = chat.filter(c => /leaving \d+ ([a-z _]+) here/i.test(c.text || ''));

// Jev inference: every decision frame, deduplicated by the decision's own
// time and id; the ones with usage were answered by the model.
const seen = new Set(), inference = { calls: 0, input: 0, output: 0, latency: 0, rules: 0, byQuestion: {} };
for (const f of frames.filter(f => f.kind === 'decision')) {
  const d = f.snapshot?.decision || {};
  const key = `${d.id}@${d.at || f.t}`;
  if (seen.has(key)) continue; seen.add(key);
  const q = inference.byQuestion[d.id || f.label] ||= { calls: 0, rules: 0, input: 0, output: 0 };
  if (d.usage) {
    inference.calls++; q.calls++;
    inference.input += d.usage.input_tokens || 0; inference.output += d.usage.output_tokens || 0; inference.latency += d.latencyMs || 0;
    q.input += d.usage.input_tokens || 0; q.output += d.usage.output_tokens || 0;
  } else { inference.rules++; q.rules++; }
}

// Distance and what changed in the pockets, from the first and last full
// snapshots.
let walked = 0;
for (let i = 1; i < obs.length; i++) { const d = dist(obs[i - 1].snapshot.position, obs[i].snapshot.position); if (d < 20) walked += d; }
const full = frames.filter(f => f.snapshot?.inventory);
const inventoryDelta = {};
if (full.length >= 2) {
  const a = full[0].snapshot.inventory, b = full.at(-1).snapshot.inventory;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = (b[k] || 0) - (a[k] || 0); if (d) inventoryDelta[k] = d; }
}

// The report.
const span = frames.at(-1).t - frames[0].t;
const lines = [];
const out = s => lines.push(s);
out(`# Day audit: ${identity}`);
out(`${new Date(frames[0].t).toISOString()} to ${new Date(frames.at(-1).t).toISOString()} (${Math.round(span / 60000)} minutes, ${frames.length} frames from ${new Set(frames.map(f => f.file)).size} flight file(s))`);
out('');
out('## Summary');
out(`- Deaths: ${deaths.length}. Damage events: ${damage.length}, ${Math.round(damage.reduce((n, d) => n + d.from - d.to, 0))} health lost in all.`);
out(`- Walked about ${Math.round(walked)} blocks.`);
out(`- Standing still 20 s or more: ${still.filter(s => !s.waiting).length} stretches, ${still.filter(s => !s.waiting).reduce((n, s) => n + s.seconds, 0)} s (plus ${still.filter(s => s.waiting).reduce((n, s) => n + s.seconds, 0)} s of waiting in a shelter or bed).`);
out(`- In water 10 s or more: ${wet.length} stretches, ${wet.reduce((n, s) => n + s.seconds, 0)} s.`);
out(`- Pacing: ${pacing.length}. Step flips: ${flips.length}. Retry loops: ${Object.keys(problems).length}. Distinct errors: ${Object.keys(errors).length}. Items thrown away: ${thrown.length}.`);
out(`- Jev inference: ${inference.calls} calls, ${inference.input} input + ${inference.output} output tokens (${inference.input + inference.output} in all), ${Math.round(inference.latency / 1000)} s of latency; ${inference.rules} decisions settled by rule without a call.`);
out(`- Pockets: ${Object.entries(inventoryDelta).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 14).map(([k, d]) => `${d > 0 ? '+' : ''}${d} ${k}`).join(', ') || 'no change seen'}`);
out('');
out('## Where the time went');
for (const [k, ms] of Object.entries(time).sort((a, b) => b[1] - a[1]).slice(0, 25)) out(`- ${k}: ${secs(ms)} s (${Math.round(ms / span * 100)}%)`);
out('');
out('## Standing still (20 s or more)');
for (const s of still) out(`- ${clock(s.from)}–${clock(s.to)} ${s.seconds} s at ${s.at}${s.waiting ? ' [waiting]' : ''}: step ${s.step || '-'}, survival ${s.survival || '-'}`);
out('');
out('## In water (10 s or more)');
for (const w of wet) out(`- ${clock(w.from)}–${clock(w.to)} ${w.seconds} s at ${w.at}, air down to ${w.minAir}: step ${w.step || '-'}, survival ${w.survival || '-'}`);
out('');
out('## Pacing (30+ blocks walked in a minute, ending within 5)');
for (const p of pacing) out(`- ${clock(p.from)}–${clock(p.to)} walked ${p.walked}, net ${p.net}, at ${p.at}: step ${p.step || '-'}`);
out('');
out('## Steps flipping back and forth');
for (const f of flips) out(`- ${clock(f.from)}–${clock(f.to)} ${f.between} at ${f.at}`);
out('');
out('## Retry loops (persist)');
for (const [p, v] of Object.entries(problems).sort((a, b) => b[1].count - a[1].count)) out(`- ${v.count} attempts, ${clock(v.first)}–${clock(v.last)}: ${p.slice(0, 200)}`);
out('');
out('## Errors');
for (const [e, v] of Object.entries(errors).sort((a, b) => b[1].count - a[1].count)) out(`- ${v.count}× (first ${clock(v.first)}, step ${v.step || '-'}): ${e}`);
out('');
out('## Damage');
for (const d of damage) out(`- ${clock(d.t)} ${d.from.toFixed(1)} → ${d.to.toFixed(1)} at ${d.at}: step ${d.step || '-'}, survival ${d.survival || '-'}`);
out('');
out('## Items thrown away');
for (const c of thrown) out(`- ${clock(c.t)} ${c.text}`);
out('');
out('## Jev inference by question');
for (const [q, v] of Object.entries(inference.byQuestion).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))) out(`- ${q}: ${v.calls} calls, ${v.input + v.output} tokens; ${v.rules} by rule`);
out('');
out('## Chat');
for (const c of chat) out(`- ${clock(c.t)} ${c.from && c.from !== 'Jev' ? `<${c.from}> ` : ''}${c.text}`);

const file = path.join(__dirname, '..', 'artifacts', `audit-${new Date(frames[0].t).toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, lines.join('\n') + '\n');
console.log(lines.slice(0, 12).join('\n'));
console.log(`\nReport: ${file}`);

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
const { analyse } = require('./lib/audit');
const result = analyse({ identity, from, to });
if (!result) { console.error(`No frames between ${new Date(from).toISOString()} and ${new Date(to).toISOString()}`); process.exit(1); }
const { frames, time, still, wet, pacing, flips, problems, errors, damage, deaths, chat, thrown, inference, walked, inventoryDelta, clock, secs } = result;

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

// Another bot's audit of the same window (the clean run beside the dream)
// is named for it, so neither overwrites the other.
const suffix = identity === '127_0_0_1-25580-Jev' ? '' : `-${identity}`;
const file = path.join(__dirname, '..', 'artifacts', `audit-${new Date(frames[0].t).toISOString().replace(/[:.]/g, '-').slice(0, 19)}${suffix}.md`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, lines.join('\n') + '\n');
console.log(lines.slice(0, 12).join('\n'));
console.log(`\nReport: ${file}`);

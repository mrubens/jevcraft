'use strict';
// Read the flight recorder: what the bot was doing, frame by frame, around
// a moment. Times are UTC, as the frames record them.
//
//   node scripts/flight.js                       # the last minute of the newest run
//   node scripts/flight.js 20:04:10 20:04:16     # a window
//   node scripts/flight.js --deaths              # every death with the ten seconds before it
//   node scripts/flight.js --label localhost-25570-Jev   # another bot (default: the dream run)
const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, '..', '.bot-state', 'flight');
const args = process.argv.slice(2);
// Newest by time, not by name: two bots share the directory, and the name
// that sorts last is the last label, not the latest run. --label narrows it.
const labelAt = args.indexOf('--label'), label = labelAt >= 0 ? args[labelAt + 1] : '127_0_0_1-25580-Jev';
const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter(f => f.endsWith('.jsonl') && f.startsWith(`${label}-`))
  .sort((a, b) => fs.statSync(path.join(directory, a)).mtimeMs - fs.statSync(path.join(directory, b)).mtimeMs) : [];
if (!files.length) { console.log('No flight records yet.'); process.exit(0); }
const read = file => fs.readFileSync(path.join(directory, file), 'utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
// A run may span parts: take every part of the newest run.
const newest = files.at(-1)?.replace(/-part\d+\.jsonl$/, '').replace(/\.jsonl$/, '');
const frames = (args.includes('--all') ? files : files.filter(f => f.startsWith(newest))).flatMap(read);
const time = f => f.at.slice(11, 23);
const round = p => p ? `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}` : '-';
function line(f) {
  const s = f.snapshot || {};
  const who = s.controller ? `${s.controller.name}` : s.pathing ? 'pathfinder' : '';
  return `${time(f)} ${f.kind.padEnd(9)} ${String(f.label || '').slice(0, 38).padEnd(38)} ${round(s.position).padEnd(20)} hp ${String(Math.round(s.health ?? 0)).padStart(2)} ` +
    `${s.held?.length ? `keys ${s.held.join('+')}` : ''} ${who}`.trimEnd();
}
if (args.includes('--deaths')) {
  for (const death of frames.filter(f => f.kind === 'danger' && (f.snapshot?.health ?? 1) <= 0)) {
    const at = Date.parse(death.at);
    console.log(`--- death at ${time(death)}`);
    for (const f of frames.filter(f => Date.parse(f.at) >= at - 10000 && Date.parse(f.at) <= at)) console.log(line(f));
  }
} else {
  const window = args.filter(a => /^\d\d:\d\d/.test(a));
  const last = Date.parse(frames.at(-1).at);
  const day = frames.at(-1).at.slice(0, 11);
  const from = window[0] ? Date.parse(day + window[0] + 'Z') : last - 60000;
  const to = window[1] ? Date.parse(day + window[1] + 'Z') : last;
  for (const f of frames.filter(f => Date.parse(f.at) >= from && Date.parse(f.at) <= to)) console.log(line(f));
}

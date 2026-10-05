'use strict';
// The spawner drill's runs, one line each, and a row a layout.
//   node scripts/spawner-results.js artifacts/spawner-drill-<id> [more directories]
const fs = require('fs');
const path = require('path');
const { median } = require('./lib/arena');
const rows = {};
for (const dir of process.argv.slice(2)) {
  for (const name of fs.readdirSync(dir).filter(n => /^(open|buried)-\d+$/.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(dir, name, 'result.json'), 'utf8')); } catch (_) { console.log(`${path.basename(dir)} ${name}: no result yet`); continue; }
    // From the ten-second beats: the time within sixteen of the cage with blazes about and no swing since the beat before, and the most blazes about at once.
    let idle = 0, most = 0, last = null;
    try { for (const line of fs.readFileSync(path.join(dir, name, 'events.jsonl'), 'utf8').split('\n')) { if (!line.includes('"beat"')) continue; const b = JSON.parse(line); most = Math.max(most, b.blazes.length); if (last && b.cage <= 16 && b.blazes.length && b.strikes === last.strikes) idle += (Date.parse(b.at) - Date.parse(last.at)) / 1000; last = b; } } catch (_) { /* no beats */ }
    r.idle = Math.round(idle); r.most = most;
    console.log(`${path.basename(dir)} ${name}: ${r.ended}, ${r.rods} rods${r.rodsAt?.length ? ` (at ${r.rodsAt.map(s => Math.round(s)).join(', ')} s)` : ''}, ${r.minutes} min, ${r.kills} kills, ${r.rodsDropped ?? '?'} dropped, ${r.rodsGone ?? '?'} gone, ${r.rodsLying} lying, least health ${r.minHealth}, ${r.idle} s by the cage with no swing, most blazes ${r.most}${r.swingsOnLeft ? `, ${r.strikes} swings: ${r.swingsOnLeft.reduce((a, b) => a + b, 0)} on ${r.swingsOnLeft.length} blazes left alive [${r.swingsOnLeft.join(" ")}]` : ""}${r.cause ? `, ${r.cause}` : ''}`);
    if (/connection closed/.test(String(r.ended))) continue;
    (rows[`${path.basename(dir)} ${r.layout}`] ||= []).push(r);
  }
}
console.log('');
for (const [key, runs] of Object.entries(rows)) {
  const most = Math.max(...runs.map(r => r.rods));
  console.log(`${key}: ${runs.length} runs, ${runs.reduce((n, r) => n + r.rods, 0)} rods (most in a run ${most}), ${runs.filter(r => r.ended === 'rods').length} reached their rods (median ${median(runs.filter(r => r.ended === 'rods').map(r => r.minutes)) ?? '-'} min), ` +
    `${runs.filter(r => r.died).length} died, ${runs.filter(r => /^left/.test(r.ended)).length} left, ${runs.filter(r => r.ended === 'time').length} ran out the clock; ${runs.reduce((n, r) => n + r.kills, 0)} kills, ` +
    `${runs.reduce((n, r) => n + (r.rodsDropped || 0), 0)} rods dropped, ${runs.reduce((n, r) => n + (r.rodsGone || 0), 0)} gone unpicked; median ${median(runs.map(r => r.minutes))} min a run; ${Math.round(runs.reduce((n, r) => n + r.idle, 0) / Math.max(1, runs.reduce((n, r) => n + r.minutes * 60, 0)) * 100)}% of the time by the cage with no swing`);
}

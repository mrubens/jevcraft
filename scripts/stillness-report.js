'use strict';
// How long the bot stood still, hour by hour, and on what. Read from the
// survival state the stillness rule writes (src/stillness.js).
//
//   node scripts/stillness-report.js                  # the dream run on 25579
//   node scripts/stillness-report.js 127_0_0_1-25580-Jev
const fs = require('fs');
const path = require('path');

const identity = process.argv[2] || '127_0_0_1-25580-Jev';
const file = path.join(__dirname, '..', '.bot-state', `${identity}-survival.json`);
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const stats = state.stillness;
if (!stats || !Object.keys(stats.hours || {}).length) { console.log('No stillness recorded yet.'); process.exit(0); }

console.log('| hour (UTC) | seconds still | stalls | top reasons |');
console.log('|---|---|---|---|');
for (const [hour, bucket] of Object.entries(stats.hours).sort()) {
  const top = Object.entries(bucket.byReason).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([reason, seconds]) => `${reason.replace(/^\w+:/, '').replaceAll('_', ' ')} ${seconds}s`).join(', ');
  console.log(`| ${hour.replace('T', ' ')}:00 | ${bucket.seconds} | ${bucket.stalls} | ${top} |`);
}
const recent = (stats.events || []).slice(-8);
if (recent.length) {
  console.log('\nLast stalls:');
  for (const e of recent) console.log(`  ${e.at.slice(11, 19)}  ${e.seconds}s on ${e.reason}  -> ${e.detour}`);
}

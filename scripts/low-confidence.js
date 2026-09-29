'use strict';
// Jev's close calls, from the flight records: gameplay decisions whose top
// weight was low, grouped by question, and the ones a death followed within
// a minute listed with what was on offer. Close calls between good options
// are fine; close calls before a death are where an option's facts, or a
// missing option, want looking at (the user's suggestion, 2026-09-27).
//   node scripts/low-confidence.js [--since 2026-09-27T12:00] [--below 0.45] [--port 25590]
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1]]] : out), []));
const since = args.since || new Date(Date.now() - 24 * 3600000).toISOString();
const below = Number(args.below || 0.45);
const dir = '.bot-state/flight';
const GAMEPLAY = /^(encounter_stance|pocket_next|survival_priority|shelter_method|climb_out|night_mine_target|hunt_target|fortress_approach|fortress_leg|portal_method|crossing_kit|kit_food|win_strategy|upkeep|sculk_work|corpse_run|stillness_detour|unstuck_move)$/;

const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!args.port || f.includes(`-${args.port}-`)));
const byQuestion = {};
const beforeDeath = [];
for (const file of files) {
  const port = (file.match(/-(\d{5})-/) || [])[1];
  const frames = [];
  let text = '';
  try { if (fs.statSync(path.join(dir, file)).mtime.toISOString() < since) continue; text = fs.readFileSync(path.join(dir, file), 'utf8'); } catch (_) { continue; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    let frame; try { frame = JSON.parse(line); } catch (_) { continue; }
    if (frame.at < since) continue;
    frames.push(frame);
  }
  const deaths = frames.filter(f => f.snapshot?.health === 0 && f.kind === 'danger').map(f => Date.parse(f.at));
  for (const f of frames) {
    const d = f.snapshot?.decision;
    if (!d || !GAMEPLAY.test(d.id) || !d.path) continue;
    const weights = d.judgments?.[0]?.probabilities;
    if (!weights) continue;
    const sorted = Object.entries(weights).sort((a, b) => b[1] - a[1]);
    const top = sorted[0]?.[1] ?? 1;
    const q = byQuestion[d.id] ||= { asked: 0, close: 0, beforeDeath: 0 };
    q.asked++;
    if (top >= below) continue;
    q.close++;
    const t = Date.parse(d.at || f.at);
    const death = deaths.find(x => x >= t && x - t <= 60000);
    if (death) {
      q.beforeDeath++;
      beforeDeath.push({ port, at: d.at || f.at, secondsToDeath: Math.round((death - t) / 1000), question: d.id, chose: d.path.join('/'),
        weights: sorted.slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '), health: d.state?.health ?? d.state?.riskNow?.health });
    }
  }
}
console.log(`Gameplay decisions since ${since}, a close call being a top weight under ${below}:\n`);
console.log('question'.padEnd(20), 'asked'.padStart(6), 'close'.padStart(6), 'close, then died within a minute');
for (const [id, q] of Object.entries(byQuestion).sort((a, b) => b[1].beforeDeath - a[1].beforeDeath || b[1].close - a[1].close)) {
  console.log(id.padEnd(20), String(q.asked).padStart(6), String(q.close).padStart(6), String(q.beforeDeath).padStart(6));
}
if (beforeDeath.length) {
  console.log('\nClose calls a death followed:');
  for (const e of beforeDeath.sort((a, b) => a.at < b.at ? -1 : 1)) console.log(`  ${e.at.slice(0, 19)} port ${e.port}, ${e.secondsToDeath}s before death, ${e.question}: chose ${e.chose} (${e.weights})${e.health != null ? `, health ${Math.round(e.health * 10) / 10}` : ''}`);
}

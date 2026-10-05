'use strict';
// A spawner drill run read back: every question asked of Jev with its answer
// (events.jsonl of scripts/spawner-drill.js), the steps between, in order.
//   node scripts/spawner-asks.js artifacts/spawner-drill-<id>/buried-1 [--said] [--from <seconds>]
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) throw new Error('usage: spawner-asks.js <run directory> [--said] [--from seconds]');
const said = process.argv.includes('--said');
const from = process.argv.includes('--from') ? Number(process.argv[process.argv.indexOf('--from') + 1]) : 0;
const read = name => { try { return fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (_) { return []; } };
const lines = read('events.jsonl');
// The question's task, its first words: the request carries no id.
const tasks = new Map(read('asks.jsonl').map(a => [a.ask, String(a.question?.instructions?.task || '').slice(0, 56)]));
const t0 = Date.parse(lines[0].at);
for (const e of lines) {
  const s = Math.round((Date.parse(e.at) - t0) / 1000);
  if (s < from) continue;
  const t = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  if (e.ask) console.log(`${t} hp ${e.health} @${e.at_}  "${tasks.get(e.ask) || e.q}" -> ${e.choice}${e.confidence != null ? ` (${e.confidence})` : ''}  [${e.options.join(' ')}]${said && e.said ? `\n        ${e.said}` : ''}`);
  else if (!e.beat && !e.result && !e.rod && (e.step !== undefined || e.survival !== undefined)) console.log(`${t} hp ${e.health} @${e.at_}    step ${e.step || '-'}${e.phase ? `:${e.phase}` : ''} / ${e.survival || '-'}`);
  else if (e.beat) console.log(`${t} hp ${e.health} f${e.food} @${e.at_}    . cage ${e.cage} blazes [${e.blazes.join(' ')}] rods ${e.rods} strikes ${e.strikes} kills ${e.kills}`);
  else if (e.rod) console.log(`${t}    ROD ${e.rod}`);
  else if (e.result) console.log(`${t}    RESULT ${JSON.stringify({ ...e.result, out: undefined })}`);
}

'use strict';
// One question of a spawner drill run, whole: the options as Jev read them.
//   node scripts/spawner-ask.js <run directory> <ask number> [option ...] [--state key,key]
const fs = require('fs');
const path = require('path');
const [dir, n, ...rest] = process.argv.slice(2);
const stateAt = rest.indexOf('--state');
const stateKeys = stateAt >= 0 ? rest[stateAt + 1].split(',') : [];
const only = rest.filter((r, i) => r !== '--state' && i !== stateAt + 1 || stateAt < 0 && r !== '--state');
const asks = fs.readFileSync(path.join(dir, 'asks.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const a = asks.find(x => x.ask === Number(n));
if (!a) throw new Error(`no ask ${n} in ${dir}`);
console.log(`${a.at} ask ${a.ask}: ${a.question.instructions?.task}`);
console.log(`answer: ${JSON.stringify(a.answer)}`);
for (const [key, value] of Object.entries(a.question.criteria || {})) {
  if (only.length && !only.includes(key)) continue;
  console.log(`\n[${key}] ${typeof value === 'string' ? value : value?.description || JSON.stringify(value)}`);
}
if (stateKeys.length) for (const key of stateKeys) console.log(`\nstate.${key}: ${JSON.stringify(key === '*' ? Object.keys(a.state) : a.state[key], null, 1)}`);

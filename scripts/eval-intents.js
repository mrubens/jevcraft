'use strict';
require('../src/env').loadEnv();
const { TypeSafe } = require('../src/typesafe');
const { interpret } = require('../src/objectives');
const fs = require('fs');
const cases = [
  ['JevBot build a house', 'house', 'oak_planks'],
  ['JevBot make a cobblestone shelter', 'house', 'cobblestone'],
  ['JevBot get me 32 purple concrete', 'concrete', 32],
  ['JevBot bring half a stack of purple concrete', 'concrete', 32],
  ['JevBot find a way to the nether', 'nether'],
  ['JevBot build a glass castle', 'other'],
  ['JevBot stop please', 'stop'],
  ['JevBot resume', 'resume'],
  ['Jev build a house', 'house', 'oak_planks'],
  ['Jev, get me half a stack of purple concrete', 'concrete', 32],
  ['jev find a way to the nether', 'nether'],
  ['Jev stop', 'stop'],
  ['Jev status', 'status'],
  ['Jev resume', 'resume'],
];
(async () => {
  const client = new TypeSafe();
  const results = [];
  for (const [request, kind, arg] of cases) {
    const result = await interpret(client, request, 'TestPlayer', 'JevBot');
    const pass = result?.kind === kind && (arg === undefined || result.material === arg || result.count === arg);
    const record = { request, pass, expected: { kind, arg }, result };
    results.push(record); console.log(JSON.stringify(record));
  }
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/intent-eval.json', JSON.stringify(results, null, 2));
  if (results.some(r => !r.pass)) process.exitCode = 1;
})().catch(err => { console.error(err.message); process.exitCode = 1; });

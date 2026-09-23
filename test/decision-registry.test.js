'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const decisions = require('../src/decisions');
const { Task } = require('../src/skills');

test('every question is defined with stakes, a ledger kind and a primitive; trees have a fallback; high stakes are gated or say why not', () => {
  const all = decisions.all();
  assert(all.length >= 9);
  for (const q of all) {
    assert(q.area && q.kind && q.primitive && q.stakes, q.id);
    if (q.tree) assert(typeof q.fallback === 'function' || q.fallback === 'throws', `${q.id} has a fallback`);
    if (q.stakes === 'high') assert(q.gate || q.ungated, `${q.id} is gated or says why not`);
  }
  assert.throws(() => decisions.define({ id: 'bad', area: 'x', kind: 'x', primitive: 'choice', stakes: 'high', tree: true, fallback: 'throws' }), /gate/);
});

test('only the decisions directory calls decideTree: every in-game tree goes through the one runner', () => {
  const src = path.join(__dirname, '..', 'src');
  const offenders = [];
  const walk = dir => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'decisions') walk(p); continue; }
    if (f.name.endsWith('.js') && /decideTree\(/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(src, p));
  } };
  walk(src);
  assert.deepEqual(offenders, []);
});

const tree = () => ({ a: { description: 'first', run: async () => 'a' }, b: { description: 'second', run: async () => 'b' } });

test('a judgment under the gate is not acted on: the fallback walks the tree instead, and the log says so', async () => {
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'b', confidence: 0.1 } } }) };
  const goal = {};
  const decision = await decisions.decide('survival_priority', { client, task: new Task('t'), goal, tree: tree(), state: {} });
  assert.deepEqual(decision.path, ['a'], 'the safety order, not the coin flip');
  assert.equal(decision.gated.confidence, 0.1);
  assert.equal(goal.decisions.at(-1).id, 'survival_priority');
  assert.equal(goal.decisions.at(-1).kind, 'survival');
  const sure = await decisions.decide('survival_priority', { client: { systemOne: async () => ({ answers: { branch_0: { choice: 'b', confidence: 0.9 } } }) }, task: new Task('t'), goal, tree: tree(), state: {} });
  assert.deepEqual(sure.path, ['b']); assert.equal(sure.gated, undefined);
});

test('without a client the fallback walks the tree; a question with no safe default says so instead', async () => {
  const decision = await decisions.decide('stillness_detour', { client: null, task: new Task('t'), tree: tree(), state: {} });
  assert.deepEqual(decision.path, ['a']);
  assert.equal(decision.fallback.reason, 'no Jev client');
  decisions.define({ id: 'test_throws', area: 'test', kind: 'test', primitive: 'choice', stakes: 'low', tree: true, fallback: 'throws' });
  await assert.rejects(decisions.decide('test_throws', { client: null, task: new Task('t'), tree: tree(), state: {} }), /no safe default/);
});

test('the ledger kind is the question\'s own: idle and stillness are no longer charged as "source"', async () => {
  const kinds = [];
  const client = { systemOne: async ({ kind }) => { kinds.push(kind); return { answers: { branch_0: { choice: 'a', confidence: 0.9 } } }; } };
  for (const id of ['idle_work', 'stillness_detour', 'house_build_step', 'resource_source']) await decisions.decide(id, { client, task: new Task('t'), tree: tree(), state: {} });
  assert.deepEqual(kinds, ['idle', 'idle', 'build', 'source']);
});

test('only the decisions directory talks to Jev: the files still calling systemOne directly are the ones not yet moved, and no others', () => {
  const src = path.join(__dirname, '..', 'src');
  const direct = [];
  const walk = dir => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'decisions') walk(p); continue; }
    if (f.name.endsWith('.js') && !['typesafe.js', 'ledger.js'].includes(f.name) && /\.systemOne\(/.test(fs.readFileSync(p, 'utf8'))) direct.push(path.relative(src, p));
  } };
  walk(src);
  const notYetMoved = ['boats.js', 'build-templates.js', 'builds.js', 'command-classifier.js', 'design-review.js', 'dream.js', 'opportunistic-mining.js',
    'opportunistic-pickups.js', 'recovery-adviser.js', 'schematic-library.js'];
  assert.deepEqual(direct.sort(), notYetMoved.sort());
});

test('the intake bars come from the definitions: the objective, the item pick, the catalog and memory', () => {
  const { CONFIDENCE } = require('../src/objectives');
  assert.equal(CONFIDENCE.costly, decisions.question('intake_objective').gate.threshold);
  assert.equal(CONFIDENCE.item, decisions.question('intake_item').gate.threshold);
  assert.deepEqual(require('../src/catalog').AMBIGUOUS, decisions.question('catalog_branch').ambiguous);
  assert.equal(decisions.confident('bundle_candidate', { noul: 0.1 }), false, 'a sure no is not a sure yes');
  assert.equal(decisions.confident('noted_wood', { choice: 'oak' }, { missing: false }), false);
});

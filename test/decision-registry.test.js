'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const decisions = require('../src/decisions');
const { Task } = require('../src/skills');

test('every question is defined with stakes, a ledger kind and a primitive; none has a fallback, only the body\'s physics a safety rule; high stakes are gated or say why not', () => {
  const all = decisions.all();
  assert(all.length >= 9);
  for (const q of all) {
    assert(q.area && q.kind && q.primitive && q.stakes, q.id);
    assert(!Object.hasOwn(q, 'fallback'), `${q.id} has no fallback`);
    if (q.safetyRule) assert(decisions.SAFETY_RULED.has(q.id) && q.safetyWhy, `${q.id}: a safety rule only on the body's physics, with why`);
    if (q.stakes === 'high') assert(q.gate || q.ungated, `${q.id} is gated or says why not`);
  }
  assert.throws(() => decisions.define({ id: 'bad', area: 'x', kind: 'x', primitive: 'choice', stakes: 'high', tree: true }), /gate/);
  assert.throws(() => decisions.define({ id: 'bad_fallback', area: 'x', kind: 'x', primitive: 'choice', stakes: 'low', tree: true, fallback: () => 'a', question: 'q', trigger: 't', source: 's', options: [{ key: 'a', label: 'a', when: 'always' }] }), /no fallback/);
  assert.throws(() => decisions.define({ id: 'bad_rule', area: 'x', kind: 'x', primitive: 'choice', stakes: 'low', tree: true, safetyRule: () => 'a', safetyWhy: 'w', question: 'q', trigger: 't', source: 's', options: [{ key: 'a', label: 'a', when: 'always' }] }), /safetyRule only/);
  assert.deepEqual([...decisions.SAFETY_RULED].sort(), ['body_way', 'shot_answer']);
  for (const id of decisions.SAFETY_RULED) assert.equal(typeof decisions.question(id).safetyRule, 'function', id);
  for (const q of all) {
    assert(q.question && q.trigger && q.source, `${q.id} says what it asks, when, and where its options come from`);
    if (q.tree) assert(q.options.length, `${q.id} declares its options`);
    else assert(q.unreachable, `${q.id} says what happens when Jev is unreachable`);
  }
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

// Two options each question declares: the first is the stand-in's pick.
const KEYS = { survival_priority: ['obtain_food', 'continue_request'], stillness_detour: ['mine_nearby', 'look_around'],
  idle_work: ['cook_food', 'stone_tools'], house_build_step: ['build_house', 'build_house'], resource_source: ['obtain_item', 'obtain_item'], test_throws: ['a', 'b'] };
const tree = (id = 'survival_priority') => { const [a, b] = KEYS[id]; return a === b
  ? { [a]: { description: 'root', children: Object.fromEntries((id === 'house_build_step' ? ['gather_materials', 'build'] : ['find_resource', 'execute_recipe'])
    .map((key, i) => [key, { description: i ? 'second' : 'first', run: async () => key }])) } }
  : { [a]: { description: 'first', run: async () => 'a' }, [b]: { description: 'second', run: async () => 'b' } }; };

test('a judgment under the gate is marked and left to the caller: no code answer takes its place', async () => {
  decisions.define({ id: 'test_gated', area: 'test', kind: 'test', primitive: 'choice', stakes: 'low', tree: true,
    gate: { threshold: 0.35, below: 'caller', why: 'a test' }, question: 'a test', trigger: 'the test', source: 'test', options: [{ pattern: '[ab]', label: 'a or b', when: 'always' }] });
  assert.throws(() => decisions.define({ id: 'test_gated_fb', area: 'test', kind: 'test', primitive: 'choice', stakes: 'low', tree: true,
    gate: { threshold: 0.35, below: 'fallback', why: 'a test' }, question: 'a test', trigger: 'the test', source: 'test', options: [{ pattern: '[ab]', label: 'a or b', when: 'always' }] }), /gate/);
  const gatedTree = () => ({ a: { description: 'a' }, b: { description: 'b' } });
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'a', confidence: 0.1 } } }) };
  const goal = {};
  const decision = await decisions.decide('test_gated', { client, task: new Task('t'), goal, tree: gatedTree(), state: {} });
  assert.deepEqual(decision.path, ['a'], 'Jev\'s pick, marked');
  assert.equal(decision.gated.confidence, 0.1); assert.equal(decision.gated.below, 'caller');
  assert.equal(goal.decisions.at(-1).id, 'test_gated');
  const sure = await decisions.decide('test_gated', { client: { systemOne: async () => ({ answers: { branch_0: { choice: 'a', confidence: 0.9 } } }) }, task: new Task('t'), goal, tree: gatedTree(), state: {} });
  assert.deepEqual(sure.path, ['a']); assert.equal(sure.gated, undefined);
});

test('the play decisions have no gate: Jev\'s pick stands at any confidence', async () => {
  for (const id of ['survival_priority', 'ranged_response', 'encounter_stance', 'dragon_fight']) assert.equal(decisions.question(id).gate, undefined, id);
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'continue_request', confidence: 0.1 } } }) };
  const decision = await decisions.decide('survival_priority', { client, task: new Task('t'), goal: {}, tree: tree(), state: {} });
  assert.deepEqual(decision.path, ['continue_request']); assert.equal(decision.gated, undefined);
});

test('without a client the tests\' stand-in answers by the old order, marked as the stand-in; the stance still has no answer of its own', async () => {
  const decision = await decisions.decide('stillness_detour', { client: null, task: new Task('t'), tree: tree('stillness_detour'), state: {} });
  assert.deepEqual(decision.path, ['mine_nearby']);
  assert.equal(decision.standIn, true); assert.equal(decision.fallback, undefined);
  await assert.rejects(decisions.decide('encounter_stance', { client: null, task: new Task('t'), tree: { fight: { description: 'a' }, pillar: { description: 'b' } }, state: {} }), /no safe default/);
});

test('the ledger kind is the question\'s own: idle and stillness are no longer charged as "source"', async () => {
  const kinds = [];
  const client = { systemOne: async ({ kind, questions }) => { kinds.push(kind); const first = Object.keys(Object.values(questions)[0].criteria)[0]; return { answers: { branch_0: { choice: first, confidence: 0.9 }, branch_1: { choice: first, confidence: 0.9 } } }; } };
  for (const id of ['idle_work', 'stillness_detour', 'house_build_step', 'resource_source']) await decisions.decide(id, { client, task: new Task('t'), tree: tree(id), state: {} });
  assert.deepEqual(kinds, ['idle', 'idle', 'build', 'source']);
});

test('only the decisions directory talks to Jev: no other file calls systemOne', () => {
  const src = path.join(__dirname, '..', 'src');
  const direct = [];
  const walk = dir => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'decisions') walk(p); continue; }
    // typesafe.js is the client; ledger.js wraps it to charge each call to its run.
    if (f.name.endsWith('.js') && !['typesafe.js', 'ledger.js'].includes(f.name) && /\.systemOne\(/.test(fs.readFileSync(p, 'utf8'))) direct.push(path.relative(src, p));
  } };
  walk(src);
  assert.deepEqual(direct, []);
});

test('the four command steps that were ungated are gated now; every question is registered once', () => {
  for (const id of ['command_node', 'command_argument', 'command_subject', 'command_destination']) assert(decisions.question(id).gate, id);
  const ids = decisions.all().map(q => q.id);
  assert.equal(new Set(ids).size, ids.length);
  assert(ids.length >= 57);
});

test('the intake bars come from the definitions: the objective, the item pick, the catalog and memory', () => {
  const { CONFIDENCE } = require('../src/objectives');
  assert.equal(CONFIDENCE.costly, decisions.question('intake_objective').gate.threshold);
  assert.equal(CONFIDENCE.item, decisions.question('intake_item').gate.threshold);
  assert.deepEqual(require('../src/catalog').AMBIGUOUS, decisions.question('catalog_branch').ambiguous);
  assert.equal(decisions.confident('bundle_candidate', { noul: 0.1 }), false, 'a sure no is not a sure yes');
  assert.equal(decisions.confident('noted_wood', { choice: 'oak' }, { missing: false }), false);
});

test('docs/decisions.md is generated from the registry and is current', () => {
  const { render } = require('../scripts/decisions-doc');
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'docs', 'decisions.md'), 'utf8'), render(), 'run node scripts/decisions-doc.js');
});

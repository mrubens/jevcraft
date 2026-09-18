'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCommand } = require('../src/command-classifier');

const node = (name, children = [], executable = false, parser) => ({
  flags: { command_node_type: parser ? 2 : name ? 1 : 0, has_command: executable, has_redirect_node: false },
  children, extraNodeData: { name, ...(parser ? { parser, properties: { min: -10, max: 10 } } : {}) },
});
function botFor(tree) {
  return { username: 'Jev', players: { Player: {}, Jev: {} }, commandTree: tree,
    chat: () => { throw new Error('Classification must never execute a command'); },
    tabComplete: async () => [] };
}
const numericTree = () => ({ rootIndex: 0, nodes: [node(null, [1]), node('server_added_action', [2]), node('amount', [], true, 'brigadier:integer')] });
function scripted(answers) {
  return { async systemOne({ questions }) {
    const next = answers.shift();
    if (questions.faithful) return { answers: { faithful: { noul: next } } };
    assert(Object.hasOwn(questions.selection.criteria, next), `Missing offered choice ${next}`);
    return { answers: { selection: { choice: next } } };
  } };
}

test('server-provided commands outside the semantic hints work with source-derived numeric arguments', async () => {
  const result = await classifyCommand(scripted(['node_1', 'node_2', 'value_0', 0.99]), botFor(numericTree()), 'Jev set the amount to -7', 'Player');
  assert.equal(result.command, '/server_added_action -7');
});
test('required numeric arguments cannot be invented or exceed the server range', async () => {
  for (const request of ['Jev do the action', 'Jev set the amount to 50']) {
    await assert.rejects(classifyCommand(scripted(['node_1']), botFor(numericTree()), request, 'Player'), /argument is missing/);
  }
});
test('large catalogs retain late branches through nested choices', async () => {
  const tree = { rootIndex: 0, nodes: [node(null, Array.from({ length: 125 }, (_, i) => i + 1)),
    ...Array.from({ length: 125 }, (_, i) => node(`action_${i + 1}`, [], true))] };
  const result = await classifyCommand(scripted(['group_5', 'node_125', 0.99]), botFor(tree), 'Jev do action 125', 'Player');
  assert.equal(result.command, '/action_125');
});
test('invalid model selections and failed semantic verification never yield executable requests', async () => {
  const bad = { systemOne: async () => ({ answers: { selection: { choice: 'injected_command' } } }) };
  await assert.rejects(classifyCommand(bad, botFor(numericTree()), 'Jev do something', 'Player'), /outside the server command catalog/);
  await assert.rejects(classifyCommand(scripted(['node_1', 'node_2', 'value_0', 0.1]), botFor(numericTree()), 'Jev do not set it to -7', 'Player'), /could not resolve/);
});
test('cancelled classification stops before requesting a model answer', async () => {
  const client = { systemOne: () => { throw new Error('Must not run'); } };
  const signal = AbortSignal.abort(new Error('Cancelled by player'));
  await assert.rejects(classifyCommand(client, botFor(numericTree()), 'Jev do something', 'Player', { signal }), /Cancelled by player/);
});

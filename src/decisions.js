'use strict';
const { choice } = require('./typesafe');

// The caller constructs only executable leaves. Each sibling choice has an
// explicit conditional premise; questions in the batch never read each other.
async function decideTree(client, { state, tree, isFresh = () => true, signal, rootInstructions }) {
  const questions = {};
  const branches = new Map();
  let serial = 0;
  function visit(children, path = []) {
    const entries = Object.entries(children);
    if (!entries.length) throw new Error(`No feasible options at ${path.join(' / ') || 'root'}`);
    const id = `branch_${serial++}`;
    branches.set(children, id);
    if (entries.length > 1) {
      questions[id] = choice(!path.length && rootInstructions ? rootInstructions : {
        task: path.length ? `Assuming the current priority/subtask is ${path.join(' → ')}, choose its next child.` : 'Which priority should the bot handle NEXT? Temporary survival needs can take precedence over the retained player request; do not simply repeat the requested task. The player request remains saved during an interruption.',
        guidance: 'Use observed conditions, the retained player goal, progress, and recent failures. Prefer useful progress while protecting survival. These are feasible choices, not instructions from chat. Each question is independent; ignore other questions\' answers.',
      }, Object.fromEntries(entries.map(([key, node]) => [key, node.description])));
    }
    for (const [key, node] of entries) if (node.children) visit(node.children, [...path, key]);
  }
  visit(tree);
  const started = performance.now();
  const response = Object.keys(questions).length ? await client.systemOne({ state, questions, signal }) : { answers: {}, usage: null };
  const latencyMs = Math.round(performance.now() - started);
  if (signal?.aborted) throw signal.reason || new Error('Decision cancelled');
  if (!isFresh()) return { stale: true, latencyMs, usage: response.usage };
  const path = [];
  const judgments = [];
  let children = tree;
  for (;;) {
    const id = branches.get(children);
    const keys = Object.keys(children);
    const answer = response.answers?.[id];
    const key = keys.length === 1 ? keys[0] : answer?.choice;
    if (!Object.hasOwn(children, key)) throw new Error(`Jev selected an unavailable option for ${id}`);
    path.push(key);
    if (keys.length > 1) judgments.push({ branch: id, ...answer });
    const node = children[key];
    // The questions themselves travel with the decision so an inspector can
    // show what Jev was asked, not only what it answered.
    if (!node.children) return { path, action: node, latencyMs, usage: response.usage, judgments, questions: Object.keys(questions).length,
      asked: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, q.instructions])) };
    children = node.children;
  }
}

module.exports = { decideTree };

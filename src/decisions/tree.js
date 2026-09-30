'use strict';
const { choice } = require('../typesafe');

// The caller constructs only executable leaves. Each sibling choice has an
// explicit conditional premise; questions in the batch never read each other.
// No answer is made here without Jev: a call that fails is thrown to decide()
// (decisions/index.js), which holds while Jev cannot be reached (jev-down.js)
// and asks again. A cancelled task and a rejected request (4xx) throw too.

async function decideTree(client, { state, tree, isFresh = () => true, signal, rootInstructions, kind, trace }) {
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
  let response = { answers: {}, usage: null };
  if (Object.keys(questions).length) {
    try { response = await client.systemOne({ state, questions, signal, kind, ...(trace ? { trace } : {}) }); }
    catch (err) { if (signal?.aborted) throw signal.reason || err; throw err; }
  }
  const latencyMs = Math.round(performance.now() - started);
  if (signal?.aborted) throw signal.reason || new Error('Decision cancelled');
  // Stale: the facts it was built from changed while it was out. Jev's own
  // answer at the root goes back with it, for decide() to keep where it is
  // an answer that keeps on with what is under way (note 749).
  if (!isFresh()) return { stale: true, latencyMs, usage: response.usage, staleAnswer: response.answers?.[branches.get(tree)] || null };
  // Jev's own answer at any level of the tree, for a walk down a branch Jev
  // answered though the path did not go that way (none_good, decide()).
  const answerAt = children => { const a = response.answers?.[branches.get(children)]; return a && Object.hasOwn(children, a.choice) ? a.choice : null; };
  const path = [];
  const judgments = [];
  let children = tree;
  for (;;) {
    const id = branches.get(children);
    const keys = Object.keys(children);
    const answer = response.answers?.[id];
    const key = keys.length === 1 ? keys[0] : answer?.choice;
    // An answer that names no option offered is a bug to see, not an outage.
    if (!Object.hasOwn(children, key)) throw Object.assign(new Error(`Jev selected an unavailable option for ${id}`), { name: 'BadAnswer' });
    path.push(key);
    if (keys.length > 1) judgments.push({ branch: id, ...answer });
    const node = children[key];
    // The questions themselves travel with the decision so an inspector can
    // show what Jev was asked, not only what it answered.
    if (!node.children) {
      const decision = { path, action: node, latencyMs, usage: response.usage, judgments, questions: Object.keys(questions).length,
        asked: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, q.instructions])) };
      Object.defineProperty(decision, 'answerAt', { value: answerAt, enumerable: false });
      return decision;
    }
    children = node.children;
  }
}

// The first listed option: where a walk down a branch has no answer of
// Jev's to follow (a none-good taken again unasked, decide()). The ladder's
// own next rung claims it (`ladderNext: true`, strategy.js).
const firstOption = children => Object.keys(children).find(key => children[key].ladderNext) || Object.keys(children)[0];

module.exports = { decideTree, firstOption };

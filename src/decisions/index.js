'use strict';
// Every question Jev is asked, in one place, and one way of asking it.
//
// The questions used to be spread across twenty-two files, each call site
// with its own copy of the same machinery: a watcher that aborts the call
// when the task is cancelled or the air runs out, a "thinking" indicator,
// the walk the code takes when Jev is unreachable, the outage announcement,
// the staleness check, the entry in the decision log. The copies drifted:
// idle, stillness and house steps were all charged to the ledger as
// "source", confidence was looked at only where a caller had remembered to,
// and the hunt's freshness rule existed at one call site only.
//
// Now a question is defined once, in an area module under this directory
// (survival.js, work.js, combat.js, travel.js, and the intake, build,
// dream and command modules), with:
//   id, area       what it is and where it belongs
//   kind           the ledger category it is charged to
//   primitive      choice, noul or score
//   stakes         low, medium or high: what a wrong answer costs
//   instructions   what Jev is asked (a tree's root; children use the default)
//   fallback       the code's own answer when Jev is unreachable, as
//                  (children, path, context) => key, or 'throws' where there
//                  is no safe default and the caller must stop instead
//   gate           { threshold, below, why }: a confidence under the
//                  threshold is not acted on as asked. below is 'fallback'
//                  (the fallback walks the tree instead) or 'caller' (the
//                  caller has its own low-confidence path: a clarifying
//                  question, a narrower action). A high-stakes question
//                  without a gate states why in `ungated`.
//
// and every tree decision goes through decide() below, which applies the
// definition. Batched intake questions are composed with compose() and
// judged with confident(), so their thresholds live here too.
const { decideTree, announceFallback, firstOption } = require('./tree');
const { checkAir } = require('../vitals');

const QUESTIONS = new Map();
const STAKES = new Set(['low', 'medium', 'high']);
const PRIMITIVES = new Set(['choice', 'noul', 'score']);
const BELOW = new Set(['fallback', 'caller']);

function define(spec) {
  const problems = [];
  if (!spec.id) problems.push('an id');
  if (QUESTIONS.has(spec.id)) problems.push(`a unique id (${spec.id} is taken)`);
  if (!spec.area) problems.push('an area');
  if (!spec.kind) problems.push('a ledger kind');
  if (!PRIMITIVES.has(spec.primitive)) problems.push('a primitive');
  if (!STAKES.has(spec.stakes)) problems.push('stakes');
  if (spec.tree && !(typeof spec.fallback === 'function' || spec.fallback === 'throws')) problems.push("a fallback or fallback: 'throws'");
  if (spec.gate && (!(spec.gate.threshold > 0 && spec.gate.threshold < 1) || !BELOW.has(spec.gate.below) || !spec.gate.why)) problems.push('a gate with threshold, below and why');
  if (spec.gate?.below === 'fallback' && typeof spec.fallback !== 'function') problems.push('a fallback for its gate to fall back to');
  if (spec.stakes === 'high' && !spec.gate && !spec.ungated) problems.push('a gate, or `ungated` saying why a high-stakes answer is acted on at any confidence');
  if (problems.length) throw new Error(`Decision ${spec.id || '(unnamed)'} needs ${problems.join(', ')}`);
  const frozen = Object.freeze({ ...spec });
  QUESTIONS.set(spec.id, frozen);
  return frozen;
}

function question(id) {
  const spec = QUESTIONS.get(id);
  if (!spec) throw new Error(`No decision is defined as ${id}`);
  return spec;
}

// The code's own walk down a tree, for an outage, no client, or a gate.
function walk(tree, fallback) {
  const path = [];
  let children = tree;
  for (;;) {
    const keys = Object.keys(children);
    const key = keys.length === 1 ? keys[0] : fallback(children, path);
    if (!Object.hasOwn(children, key)) throw new Error(`The fallback rule selected an unavailable option at ${path.join(' / ') || 'root'}`);
    path.push(key);
    const node = children[key];
    if (!node.children) return { path, action: node };
    children = node.children;
  }
}

class NoSafeDefault extends Error {
  constructor(id, reason) { super(`${id}: Jev is unreachable (${reason}) and this decision has no safe default`); this.name = 'Blocked'; }
}

// One decision over a tree of feasible options the caller built. Returns
// what decideTree returns, plus `id`, and `gated` when a low confidence
// sent it to the fallback. A single feasible leaf is taken without asking.
async function decide(id, { client, bot, task, goal, save = () => {}, tree, state, isFresh = () => true, interrupt = () => {}, context, watchMs = 100 }) {
  const spec = question(id);
  if (!tree || !Object.keys(tree).length) throw new Error(`No feasible options for ${id}`);
  const fallback = typeof spec.fallback === 'function' ? (children, path) => spec.fallback(children, path, context) : null;
  let decision;
  if (!client) {
    if (!fallback) throw new NoSafeDefault(id, 'no client');
    decision = { ...walk(tree, fallback), fallback: { reason: 'no Jev client' } };
  } else {
    const controller = new AbortController();
    const watcher = setInterval(() => {
      try { task?.check(); if (bot) checkAir(bot); interrupt(); }
      catch (err) { controller.abort(err); }
    }, watchMs);
    const stopThinking = spec.thinking && bot ? require('../speech').thinking(bot) : () => {};
    try {
      decision = await decideTree(client, { state, tree, signal: controller.signal, fallback, kind: spec.kind,
        rootInstructions: spec.instructions, isFresh });
    } catch (err) {
      if (!fallback && !controller.signal.aborted && err.name === 'TypeSafeError') throw new NoSafeDefault(id, err.message);
      throw err;
    } finally { clearInterval(watcher); stopThinking(); }
    task?.check(); if (bot) checkAir(bot); interrupt();
    // The gate: a judgment below the question's threshold is not acted on
    // as asked. Where the fallback is the safer answer, it is taken.
    const low = !decision.stale && !decision.fallback && spec.gate && (decision.judgments || []).find(j => (j.confidence ?? 1) < spec.gate.threshold);
    if (low) {
      decision.gated = { branch: low.branch, confidence: low.confidence, threshold: spec.gate.threshold, below: spec.gate.below };
      if (spec.gate.below === 'fallback') decision = { ...decision, ...walk(tree, fallback) };
    }
    if (goal && bot && !decision.stale) announceFallback(bot, goal, decision);
  }
  decision.id = id;
  if (!decision.stale && decision.action?.valid && !decision.action.valid()) decision.stale = true;
  if (goal) {
    goal.decisions ||= [];
    goal.decisions.push({ at: new Date().toISOString(), id, kind: spec.kind, path: decision.path, state, options: JSON.parse(JSON.stringify(tree)),
      latencyMs: decision.latencyMs, usage: decision.usage, judgments: decision.judgments, asked: decision.asked, model: client?.model,
      stale: decision.stale, fallback: decision.fallback, gated: decision.gated });
    goal.decisions = goal.decisions.slice(-40); save();
  }
  return decision;
}

// Batched questions (intake): each defined question contributes its typed
// question; the caller sends them in one call and reads the answers with
// confident(), which applies each question's own threshold.
function compose(entries) {
  return Object.fromEntries(entries.filter(Boolean).map(([key, id, built]) => { question(id); return [key, built]; }));
}
function confident(id, answer, { threshold } = {}) {
  const spec = question(id);
  const bar = threshold ?? spec.gate?.threshold;
  if (!answer) return false;
  if (bar === undefined) return true;
  if (spec.primitive === 'noul') return (answer.probability ?? 0) >= bar || (answer.probability ?? 1) <= 1 - bar;
  return (answer.confidence ?? 1) >= bar;
}

const all = () => [...QUESTIONS.values()];

module.exports = { define, question, decide, walk, compose, confident, all, NoSafeDefault, decideTree, announceFallback, firstOption };

// The area modules register their questions when this directory is loaded.
require('./survival'); require('./work'); require('./combat'); require('./travel');

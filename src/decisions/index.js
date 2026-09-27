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
//                  question, a narrower action). A tree's gate applies at
//                  every level of it. A high-stakes question without a gate
//                  states why in `ungated`.
//   question       what is asked, in a plain sentence
//   trigger        when it is asked
//   source         where its options or candidates are built
//   options        a tree's option catalogue: every key the tree can hold,
//                  as { key } or { pattern }, with a label, when it is on
//                  offer, and the level it sits at. decide() checks each tree
//                  against it: a key not in the catalogue fails a test, and
//                  is logged as a bug in play.
//   unreachable    for a batched question, what happens when Jev cannot be
//                  reached (a tree's is its fallback)
//   batch          the batch a question rides in, when it rides in one
//
// and every tree decision goes through decide() below, which applies the
// definition. Batched questions are asked with ask() and judged with
// confident(), so their bars live here too.
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
  if (!spec.tree && typeof spec.build !== 'function') problems.push('a tree flag or a build(args) that returns its typed question');
  if (spec.gate && (!(spec.gate.threshold > 0 && spec.gate.threshold < 1) || !BELOW.has(spec.gate.below) || !spec.gate.why)) problems.push('a gate with threshold, below and why');
  if (spec.gate?.below === 'fallback' && typeof spec.fallback !== 'function') problems.push('a fallback for its gate to fall back to');
  if (spec.stakes === 'high' && !spec.gate && !spec.ungated) problems.push('a gate, or `ungated` saying why a high-stakes answer is acted on at any confidence');
  if (!spec.question) problems.push('a plain question');
  if (!spec.trigger) problems.push('a trigger');
  if (!spec.source) problems.push('a source');
  if (spec.tree && !(Array.isArray(spec.options) && spec.options.length && spec.options.every(o => (o.key || o.pattern) && o.label && o.when))) problems.push('an option catalogue ({ key or pattern, label, when })');
  if (!spec.tree && !spec.unreachable) problems.push('an unreachable description');
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

// Every key in the tree must be one its question declares. Under the test
// runner an undeclared key fails; in play it is logged once as a bug.
const declared = (spec, key) => spec.options.some(o => o.key === key || (o.pattern && new RegExp(`^(?:${o.pattern})$`).test(key)));
const reported = new Set();
function checkOptions(spec, tree) {
  const unknown = [];
  const visit = children => { for (const [key, node] of Object.entries(children)) { if (!declared(spec, key)) unknown.push(key); if (node.children) visit(node.children); } };
  visit(tree);
  if (!unknown.length) return;
  const message = `${spec.id} offered options it does not declare: ${unknown.join(', ')}`;
  if (process.env.NODE_TEST_CONTEXT) throw new Error(message);
  if (!reported.has(message)) { reported.add(message); console.error('[bug]', message); }
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

// Every choice about playing the game is told what the player counts:
// real minutes. A night hidden in a pocket was weighed as safe and free,
// and it cost seven minutes of a run with nothing to show.
const GAMEPLAY_AREAS = new Set(['combat', 'endgame', 'home', 'idle', 'resources', 'strategy', 'survival']);
const REAL_TIME = 'The player counts real time: a Minecraft day is twenty real minutes and a night about seven. Minutes spent waiting, hiding, or redoing what a death lost are the cost that counts, and the player minds a death less than a night idled.';
const RISK = 'riskNow is how likely a death is now (the mobs about, what fighting them all here would cost, whether more spawn around, whether health comes back); deathWouldCost is what a death now would lose.';
const DEATHS = 'recentDeaths are the bot\'s deaths of the last two hours: how, where, what was about, and what was chosen last before each; the same answer in the same place seldom ends differently.';
const TRAIL = 'recentPositions is where the bot has been over the last few minutes, fifteen seconds apart, and what it was doing: the same few places over and over is a loop, and the same answer again seldom breaks it.';
function withRealTime(spec, state = {}) {
  if (!GAMEPLAY_AREAS.has(spec.area) || !spec.instructions) return spec.instructions;
  const { task, guidance = '' } = spec.instructions;
  const risk = state && (state.riskNow || state.deathWouldCost) && !guidance.includes('riskNow') ? ` ${RISK}` : '';
  const trail = state?.recentPositions ? ` ${TRAIL}` : '';
  const deaths = state?.recentDeaths ? ` ${DEATHS}` : '';
  return { ...spec.instructions, task, guidance: `${guidance}${guidance ? ' ' : ''}${REAL_TIME}${risk}${trail}${deaths}` };
}

// The deaths of the last two hours, newest first: how, where from here,
// what was about, what it wore and ate, and what Jev had last chosen.
const DEATHS_KEPT_MS = 2 * 3600000;
function recentDeaths(bot, goal, now = Date.now()) {
  const here = bot.entity?.position;
  return (goal?.survival?.deaths || []).filter(d => now - Date.parse(d.at) < DEATHS_KEPT_MS).slice(-3).reverse().map(d => ({
    minutesAgo: Math.round((now - Date.parse(d.at)) / 60000),
    ...(d.cause ? { cause: d.cause } : {}),
    where: here && d.position && String(d.dimension || '').replace(/^minecraft:/, '') === String(bot.game?.dimension || '').replace(/^minecraft:/, '')
      ? `${Math.round(Math.hypot(d.position.x - here.x, d.position.y - here.y, d.position.z - here.z))} blocks from here, at y ${Math.round(d.position.y)}` : `in the ${String(d.dimension || '').replace(/^minecraft:/, '').replace(/^the_/, '')}`,
    ...(d.about?.length ? { about: d.about.map(t => `${t.name.replaceAll('_', ' ')} ${t.distance} blocks off`) } : {}),
    ...(d.worn ? { wore: d.worn.length ? d.worn.map(n => n.replaceAll('_', ' ')) : ['no armour'] } : {}),
    ...(Number.isFinite(d.food) ? { hunger: d.food } : {}),
    ...(d.lastChoice ? { lastChoice: `${d.lastChoice.choice.replaceAll('_', ' ')} (${d.lastChoice.question.replaceAll('_', ' ')}, ${d.lastChoice.secondsBefore} seconds before)` } : {}),
  }));
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
  // How the bot died lately, with every question about playing the game:
  // it walked back to the drowned that had just killed it, and chose to
  // search for food at five health three deaths running, told nothing of
  // any of them (the user's suggestion, 2026-09-26).
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && !state.recentDeaths) {
    const deaths = recentDeaths(bot, goal);
    if (deaths.length) state = { ...state, recentDeaths: deaths };
  }
  checkOptions(spec, tree);
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
        rootInstructions: withRealTime(spec, state), isFresh });
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
  if (bot && !decision.stale && decision.path) bot._lastDecision = { id, choice: decision.path.at(-1), at: Date.now() };
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

// Batched questions (intake and the rest): each defined question builds its
// typed question from the caller's arguments, and they go in one call. The
// answers are read with confident(), which applies each question's own bar.
// `questions` is { key: [id, args] }; a falsy entry is left out, so a
// speculative question is included with a condition in place.
async function ask(client, { questions, state, signal, kind }) {
  const entries = Object.entries(questions).filter(([, entry]) => entry);
  if (!entries.length) throw new Error('No questions to ask');
  const specs = entries.map(([key, [id]]) => [key, question(id)]);
  const built = Object.fromEntries(entries.map(([key, [id, args]]) => [key, question(id).build(args || {})]));
  return client.systemOne({ kind: kind || specs[0][1].kind, state, questions: built, signal });
}
// Whether an answer clears its question's bar. A Noul clears it when the
// probability of yes is at least the bar: a sure "no" is not a sure "yes".
// An answer with no confidence figure clears it unless `missing: false`
// (the preference questions never learned from an unscored answer).
function confident(id, answer, { threshold, missing = true } = {}) {
  const spec = question(id);
  const bar = threshold ?? spec.gate?.threshold;
  if (!answer) return false;
  if (bar === undefined) return true;
  if (spec.primitive === 'noul') { const p = answer.noul ?? answer.probability; return Number.isFinite(p) ? p >= bar : missing; }
  return Number.isFinite(answer.confidence) ? answer.confidence >= bar : missing;
}

const all = () => [...QUESTIONS.values()];

module.exports = { recentDeaths, define, question, decide, walk, ask, confident, all, NoSafeDefault, decideTree, announceFallback, firstOption };

// The area modules register their questions when this directory is loaded.
require('./survival'); require('./work'); require('./combat'); require('./travel'); require('./intake');
require('./build'); require('./dream'); require('./command');

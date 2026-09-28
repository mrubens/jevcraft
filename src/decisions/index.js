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
//   parent         for a question about playing the game, the question
//                  asked next up when this one has nothing left to try:
//                  step, way (fortress_approach), plan (fortress_leg,
//                  portal_way), rung (rung_progress); null where none is
//
// and every tree decision goes through decide() below, which applies the
// definition. Batched questions are asked with ask() and judged with
// confident(), so their bars live here too.
const { decideTree, announceFallback, firstOption } = require('./tree');
const { checkAir } = require('../vitals');
const { stage } = require('../typesafe');
const repeats = require('./repeats');
const tried = require('../tried');

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
  // The question asked next up when this one has nothing left to try (every
  // option resting in the ledger), its same answer is held, or the step it
  // chose keeps failing: step, way, plan, rung (tried.js, note 571). null
  // where there is none above: the stall question takes it as before.
  if (spec.tree && GAMEPLAY_AREAS.has(spec.area) && !Object.hasOwn(spec, 'parent')) problems.push('a parent (the question asked when this one has nothing left to try), or parent: null');
  if (spec.parent != null && (typeof spec.parent !== 'string' || spec.parent === spec.id)) problems.push('a parent that is another question\'s id');
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
const declared = (spec, key) => key === NONE_GOOD_KEY || spec.options.some(o => o.key === key || (o.pattern && new RegExp(`^(?:${o.pattern})$`).test(key)));
// "None of these options are good", on every question about playing the
// game: Jev's way of saying the move a player would make is not on the
// list. It is recorded for us to add what is missing, and the best of the
// options that are there is taken all the same (the user, 2026-09-27: the
// deaths of the day were read, one by one, to find missing moves).
const NONE_GOOD_KEY = 'none_good';
const NONE_GOOD = 'None of these options are good: the move a player would make here is not among them. Choose this only when such a move is missing, not because every option listed is costly; the least bad of a bad set is still one of them. It is recorded for the missing move to be added, and meanwhile the best of the options listed is taken.';
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
const GAMEPLAY_AREAS = new Set(['combat', 'endgame', 'home', 'idle', 'resources', 'strategy', 'survival', 'travel', 'work']);
// The run's own scoring, said plainly: a death fails it. The line had said
// a death mattered less than a night idled, a thumb on the scale toward the
// risky answer at low health (the decision review, 2026-09-26). A night is
// eleven real minutes from dusk to dawn, eight and a half from bedtime.
const REAL_TIME = 'The player counts real time: a Minecraft day is twenty real minutes, and a night about eleven from dusk to dawn. A death ends this attempt and loses what is carried; after that, minutes spent waiting, hiding or going back are the cost that counts.';
const RISK = 'riskNow is how likely a death is now (the mobs about, what fighting them all here would cost, whether more spawn around, whether health comes back); deathWouldCost is what a death now would lose.';
const DEATHS = 'recentDeaths are the bot\'s deaths of the last two hours: how, where, what was about, and what was chosen last before each; the same answer in the same place seldom ends differently.';
// A sense of pace said as a fact, not a limit: what the minutes played
// compare with.
const CLOCK = 'runClock is the run so far: minutes played toward the goal, when each milestone was reached, what it is on now, and where the minutes went, all told and in the last half hour. For pace, a practiced player from a settled start with iron reaches the Nether within the first hour and has the blaze rods and ender pearls within the next two; minutes already spent on a way are spent, and what counts is the minutes each option still costs.';
const SCULK = 'sculk says the sculk sensors and shriekers near, what hears the bot and what a shrieker calls.';
const HEALING = 'healing is the bot\'s health and hunger, whether health comes back, the food carried by kind (the last resort with what it may cost), the nearest food known, the time to daylight, and what standing still costs.';
const AGAIN = 'sameAnswerAgain says what this question was answered last with these same facts, and that nothing came of it; lastAnswersCameToNothing, the last answers to it in a row that each came back within seconds with nothing coming of them, whatever the facts said between; answersThatCameToNothing, the answers held as failed in the last two minutes, and why. The same answer again seldom ends differently.';
const LEDGER = 'An option tried from about here lately says so, how often and how it ended; waysResting are the options left out because each was tried from here and came to nothing twice (or was held), and when they come back; whatFailedBelow is what the question below this one tried and why it ended, which brought this question. The same way again seldom ends differently.';
const TRAIL = 'recentPositions is where the bot has been over the last few minutes, fifteen seconds apart, and what it was doing: the same few places over and over is a loop, and the same answer again seldom breaks it.';
function withRealTime(spec, state = {}) {
  if (!GAMEPLAY_AREAS.has(spec.area) || !spec.instructions) return spec.instructions;
  const { task, guidance = '' } = spec.instructions;
  const risk = state && (state.riskNow || state.deathWouldCost) && !guidance.includes('riskNow') ? ` ${RISK}` : '';
  const trail = state?.recentPositions ? ` ${TRAIL}` : '';
  const deaths = (state?.recentDeaths ? ` ${DEATHS}` : '') + (state?.sameAnswerAgain || state?.lastAnswersCameToNothing || state?.answersThatCameToNothing ? ` ${AGAIN}` : '') + (state?.waysResting || state?.whatFailedBelow ? ` ${LEDGER}` : '');
  const clock = (state?.runClock ? ` ${CLOCK}` : '') + (state?.sculk ? ` ${SCULK}` : '') + (state?.healing ? ` ${HEALING}` : '');
  return { ...spec.instructions, task, guidance: `${guidance}${guidance ? ' ' : ''}${REAL_TIME}${clock}${risk}${trail}${deaths}` };
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

// Recorded, and the best listed option taken instead: the likeliest by
// Jev's own weights, walked on down its branch by the question's fallback.
function noneGood(id, decision, listed, fallback, { bot, goal, state }) {
  const weights = decision.judgments?.[0]?.probabilities || {};
  const keys = Object.keys(listed);
  const best = keys.slice().sort((a, b) => (weights[b] || 0) - (weights[a] || 0))[0];
  const node = listed[best];
  const rest = node?.children ? walk(node.children, fallback || firstOption) : { path: [], action: node };
  const took = { path: [best, ...rest.path], action: rest.action };
  recordMissing(id, decision, listed, { bot, goal, state }, { took: took.path });
  console.log(`[missing option] ${id}: none of the options was good; took ${took.path.join('/')} instead`);
  return { ...decision, ...took, noneGood: true };
}
function recordMissing(id, decision, listed, { bot, goal, state }, { near = false, took = [] } = {}) {
  const weights = decision.judgments?.[0]?.probabilities || {};
  const keys = Object.keys(listed);
  const entry = { ...(near ? { near: true } : {}), at: new Date().toISOString(), question: id, bot: bot?.username || null, port: bot?._client?.socket?.remotePort ?? null,
    dimension: String(bot?.game?.dimension || '').replace('minecraft:', ''), position: bot?.entity?.position ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null,
    health: bot?.health ?? null, request: goal?.request || null, weights, tookInstead: took,
    options: Object.fromEntries(keys.map(k => [k, typeof listed[k].description === 'string' ? listed[k].description : JSON.stringify(listed[k].description)])), state };
  try {
    const fs = require('fs'), path = require('path');
    const log = process.env.JEV_MISSING_OPTIONS || 'artifacts/missing-options.jsonl';
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, JSON.stringify(entry) + '\n');
  } catch (_) { /* the flight record still has it */ }
}

// A question stopped (the task's check, the air, its caller) ends then,
// whatever its request is doing. mid-243-q-nether-3's turn_priority said
// "asking Jev" for 5.6 seconds while its check threw every look (a
// preemption and the hurt watchdog's stop, both standing), until the death:
// the abort had not ended the request under it, for reasons the record
// could not show (note 540). The request is still watched: one still out a
// second after the stop, or settling late, is said with its stages.
const SLOW_MS = 3000, LATE_MS = 250, STILL_OUT_MS = 1000;
const saysStages = trace => (trace.stages || []).map(s => `${s.stage} ${s.ms}${Object.keys(s).length > 2 ? ` ${JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'stage' && k !== 'ms')))}` : ''}`).join(', ') +
  (trace.lookedMs !== undefined ? `; last looked ${trace.lookedMs}` : '');
function endsWhenStopped(asking, signal, trace, log = console.log) {
  return new Promise((resolve, reject) => {
    let settled = false, stoppedAt = null;
    const onStop = () => {
      stoppedAt = performance.now();
      reject(signal.reason);
      setTimeout(() => { if (!settled) log(`[question] ${trace.id} stopped ${STILL_OUT_MS / 1000}s ago and its request is still out: ${saysStages(trace)}`); }, STILL_OUT_MS).unref?.();
    };
    const done = () => {
      settled = true; signal.removeEventListener('abort', onStop);
      if (stoppedAt === null) return;
      stage(trace, 'settled');
      const late = performance.now() - stoppedAt;
      if (late >= LATE_MS) log(`[question] ${trace.id}'s request settled ${Math.round(late)} ms after it was stopped: ${saysStages(trace)}`);
    };
    if (signal.aborted) onStop(); else signal.addEventListener('abort', onStop, { once: true });
    asking.then(value => { done(); resolve(value); }, err => { done(); reject(err); });
  });
}

// The one way through a tree, when every level has one option.
function oneWay(tree) {
  const path = [];
  let children = tree;
  for (;;) {
    const keys = Object.keys(children);
    if (keys.length !== 1) return null;
    path.push(keys[0]);
    const node = children[keys[0]];
    if (!node?.children) return { path, action: node };
    children = node.children;
  }
}
// Said when it changes, and at most once a minute while it does not.
const ONE_SAID_MS = 60000;
function sayOnce(bot, id, path, now = Date.now()) {
  const said = (bot ? (bot._oneWaySaid ||= {}) : {});
  const key = path.join('/');
  if (said[id]?.key === key && now - said[id].at < ONE_SAID_MS) return;
  said[id] = { key, at: now };
  console.log(`[one way] ${id}: ${path.join(' / ').replaceAll('_', ' ')}, the only way offered`);
}
// A wait chosen is not a loop: a shelter held for the night, a pillar held
// up top, a stance holding (stillness.js HOLDS) come back to the same
// answer with nothing new, and that is their point. Nor is an emergency
// (the fire, the lava, a fight in reach, stillness.js EMERGENCIES), whose
// questions (body_way, shield_policy, the stance) come at every turn of it:
// a stall raised there would set the way out aside. Said, never held. And
// the questions that are the routing and the stall path themselves
// (turn_priority, stillness_detour) are said, never held: holding them
// would raise a stall from inside the answer to one.
// Nor the stance against mobs about (encounter_stance): held, it raises a
// stall with the mobs still there and no stance taken. Its answers that
// came to nothing are said (note 570: mid-244-ad's out_of_sight forty-one
// times in eleven seconds, under a crossbow piglin, each walk ending where
// it began), and the stance's own failures say why (failedHereJustNow).
const NEVER_HELD = new Set(['turn_priority', 'stillness_detour', 'encounter_stance']);
function waitingByChoice(goal, id, now = Date.now()) {
  if (NEVER_HELD.has(id)) return true;
  const { HOLDS, EMERGENCIES } = require('../stillness');
  const recent = goal?.survivalAction;
  if (recent?.action && now - Date.parse(recent.at || 0) < 8000 && (HOLDS.has(recent.action) || EMERGENCIES.has(recent.action))) return true;
  return HOLDS.has(goal?.step?.action);
}

// Waiting, for the ledger: a hold or an emergency, whose point is to stay.
// The stall's own question is never held by the repeat rule, but its
// answers (a walk off, a hunt, a dig) are not waits: recorded as waits,
// none of them ever came to nothing, none rested, and a step failing every
// two seconds was answered "differently" for minutes with nothing above it
// asked (mid-242-ae-nether-3-fortress-1's pearls, note 583).
const ledgerWaits = (goal, id) => id !== 'stillness_detour' && waitingByChoice(goal, id);
// The options offered, for the ledger (tried.js spent).
const offeredOf = (tree, target = null) => Object.entries(tree || {}).filter(([, n]) => !n?.children).map(([key, n]) => ({ key, target: n?.target || target || null }));
// Not in the ledger: the routing between the layers, asked every turn.
const UNLEDGERED = new Set(['turn_priority']);
// Said, never left out nor escalated: a stance against mobs about, the
// body's way out of the lava or the fire, the shield (note 521: a failed
// stance stays on offer with its failure said; Jev weighs it).
const SAY_ONLY = new Set(['encounter_stance', 'body_way', 'shield_policy', 'ranged_response']);
// The tree as offered, less what the ledger left out, without its words.
function plainOf(tree, original) { return Object.fromEntries(Object.keys(tree).map(k => [k, original[k] || tree[k]])); }
// To the question above (define's `parent`), with this one's failure said:
// thrown as a stall held on the bot, so a step that swallows it meets it
// again at its next check, and the loop takes it (work.js runGoal): a
// parent that is a plan's question is asked by its step on the next pass;
// the rung's question is asked at once (answerStall).
function parentOf(id) { try { return question(id).parent || null; } catch (_) { return null; } }
function escalateFrom(bot, goal, spec, why) {
  const { to, says, passed } = tried.escalate(goal, { from: spec.id, to: spec.parent || null, why, parentOf, here: bot?.entity?.position });
  // The answer above that led here came to this.
  if (spec.parent) tried.markBlocked(tried.latestOf(goal, spec.parent), says);
  if (to && to !== spec.parent) tried.markBlocked(tried.latestOf(goal, to), says);
  const { raiseFor, Stalled } = require('../stillness');
  throw new Stalled(raiseFor(bot, goal, says, Date.now(), { escalated: { from: spec.id, to, says, passed } }));
}

class NoSafeDefault extends Error {
  constructor(id, reason) { super(`${id}: Jev is unreachable (${reason}) and this decision has no safe default`); this.name = 'Blocked'; }
}

// One decision over a tree of feasible options the caller built. Returns
// what decideTree returns, plus `id`, and `gated` when a low confidence
// sent it to the fallback. A single feasible leaf is taken without asking.
// watchAir false: the question is about the breath or the lava itself
// (body_way), which checkAir would stop at once.
async function decide(id, { client, bot, task, goal, save = () => {}, tree, state, isFresh = () => true, interrupt = () => {}, context, watchMs = 100, watchAir = true, target = null }) {
  const spec = question(id);
  // The question's stages, from here (queued) to its record, each as
  // milliseconds since: asked (the turn taken), the client's sent, headers,
  // body and parsed (typesafe.js), stopped, settled, recorded. On the bot
  // while it is out, for the flight frames; on the decision's record after.
  const trace = { id, t0: performance.now(), at: new Date().toISOString(), stages: [{ stage: 'queued', ms: 0 }] };
  if (!tree || !Object.keys(tree).length) throw new Error(`No feasible options for ${id}`);
  const original = tree;
  // One way: taken and said, not asked. A question with one option was
  // recorded as asked, took the turn and stood in the flight record as a
  // decision: mid-242-aa's body_way "asked" burn_out forty times in fifteen
  // minutes, alight in the Nether with nothing else to do (note 560).
  // What has been tried (tried.js): the answer before this one has ended,
  // since it is being asked again; the options read against the ledger,
  // each blocked try said on its option, those resting left out while
  // another is on offer; with every option resting, the question above is
  // asked instead, with this one's failure said (escalate).
  const ledgered = !!bot && !!goal && GAMEPLAY_AREAS.has(spec.area) && !UNLEDGERED.has(id);
  let resting = null, below = null;
  if (ledgered) {
    tried.settle(bot, goal, { q: id });
    const read = tried.read(bot, goal, id, tree, { target, sayOnly: SAY_ONLY.has(id) });
    if (read.allResting && spec.parent !== undefined && spec.parent !== null) escalateFrom(bot, goal, spec, `every way it had from here rests: ${read.resting.join('; ')}`);
    tree = read.tree;
    if (read.resting.length) resting = read.resting;
    below = tried.escalationsFor(goal, id);
  }
  const takeOne = one => {
    sayOnce(bot, id, one.path);
    const decision = { ...one, id, only: true };
    if (bot) bot._lastDecision = { id, choice: one.path.at(-1), at: Date.now() };
    if (decision.action?.valid && !decision.action.valid()) decision.stale = true;
    if (ledgered && !decision.stale) tried.begin(bot, goal, { q: id, method: one.path.join('/'), target: decision.action?.target || target, waiting: ledgerWaits(goal, id), offered: offeredOf(original, target) });
    return decision;
  };
  const one = oneWay(tree);
  if (one) return takeOne(one);
  // How the bot died lately, with every question about playing the game:
  // it walked back to the drowned that had just killed it, and chose to
  // search for food at five health three deaths running, told nothing of
  // any of them (the user's suggestion, 2026-09-26).
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && !state.recentDeaths) {
    const deaths = recentDeaths(bot, goal);
    if (deaths.length) state = { ...state, recentDeaths: deaths };
  }
  // Nights without sleep, with every such question: phantoms come for a
  // player on the third, and mid-231-e was killed by them at seven hunger,
  // told of it only in one option of one question (2026-09-26).
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && state.nightsWithoutSleep === undefined) {
    const slept = goal?.survival?.sleptAtAge, age = bot.time?.age;
    if (Number.isFinite(slept) && Number.isFinite(age) && /overworld/.test(String(bot.game?.dimension || 'overworld'))) {
      const nights = Math.floor((age - slept) / 24000);
      if (nights >= 1) state = { ...state, nightsWithoutSleep: nights, phantoms: nights >= 3 ? 'phantoms are coming at night now: three nights without sleep brings them, diving from the sky; sleeping in a bed stops them' : `phantoms come after three nights without sleep (${3 - nights} more)` };
    }
  }
  if (state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && !state.runClock) {
    const clock = require('../game-progress').runClock(goal);
    if (clock) state = { ...state, runClock: clock };
  }
  // Whether health comes back, with every such question, and what could
  // bring it back: four deaths of 2026-09-27 went on working or hunting
  // hurt, under eighteen hunger with nothing safe to eat, told of it in a
  // few options of a few questions (note 515: mid-231-o, mid-207-l,
  // mid-211-x, mid-231-q).
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && !state.healing) {
    let healing = null; try { healing = require('../healing').healingSays(bot, goal); } catch (_) { /* no body */ }
    if (healing) state = { ...state, healing };
  }
  // Sculk near, with every such question: mid-230-n worked beside a
  // shrieker it was never told of, and the warden it called killed it.
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && !state.sculk) {
    let sculk = null; try { sculk = require('../sculk').sculkAbout(bot); } catch (_) { /* no world */ }
    if (sculk) state = { ...state, sculk: sculk.says };
  }
  // The same facts, the same answer, and nothing came of it (repeats.js):
  // said in the facts; held as failed when it came back at once twice
  // running, and the step's stall path takes it from here.
  const tracked = !!bot && !!goal && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area);
  // The facts as they were offered, without the ledger's words on them: a
  // try said on an option is not new facts (repeats.js).
  const print = tracked ? repeats.fingerprint(state, plainOf(tree, original)) : null;
  if (tracked) {
    const waiting = waitingByChoice(goal, id);
    const again = repeats.before(bot, goal, id, print, { waiting });
    // And whatever the facts: the last answers in a row that each came
    // back at once with nothing coming of them (note 570).
    const quick = repeats.quickBefore(bot, goal, id, { waiting });
    const holding = again?.hold ? again : quick?.hold ? quick : null;
    if (holding) {
      const why = `${id.replaceAll('_', ' ')}: ${holding.says}`;
      repeats.held(bot, id, holding.says);
      console.log(`[repeat] ${why}`);
      // Held, the answers rest from here (the ledger), and the question
      // above is asked with this failure said: not the same question, and
      // not a detour that walks eight blocks and comes back to it (note 571).
      const methods = holding.run ? [holding.run.choice] : holding.streak.map(s => s.choice);
      if (ledgered) tried.hold(bot, goal, id, methods, holding.says, { target, targets: Object.fromEntries(methods.map(m => [m, tree[m]?.target])) });
      // The answers held rest; a question with other ways left is asked
      // with those, the hold said, and escalates only once they rest too:
      // on 25583 fortress_leg's hold on back_to_fortress and leg_east would
      // have gone to the rung with its heights, the blocks to dig and the
      // Overworld's stone never offered (note 583).
      const after = ledgered && !SAY_ONLY.has(id) ? tried.read(bot, goal, id, original, { target }) : null;
      if (!after || after.allResting || !Object.keys(after.tree).length || methods.some(m => after.tree[m])) escalateFrom(bot, goal, spec, holding.says);
      tree = after.tree; resting = after.resting.length ? after.resting : null;
      const left = oneWay(tree);
      if (left) return takeOne(left);
    }
    const lately = repeats.heldSays(bot);
    const quickly = !again && quick ? quick.says : null;
    if (again || quickly || lately) state = { ...state, ...(again ? { sameAnswerAgain: again.says } : {}), ...(quickly ? { lastAnswersCameToNothing: quickly } : {}), ...(lately ? { answersThatCameToNothing: lately } : {}) };
  }
  if (state && typeof state === 'object' && (resting || below)) state = { ...state, ...(resting ? { waysResting: resting } : {}), ...(below ? { whatFailedBelow: below } : {}) };
  // On unless JEV_NONE_GOOD=0 (the test runner, whose tests name the options
  // each question offers; test/decisions.test.js turns it back on).
  const offerNoneGood = process.env.JEV_NONE_GOOD !== '0' && !!client && GAMEPLAY_AREAS.has(spec.area) && Object.keys(tree).length >= 2 && !tree[NONE_GOOD_KEY];
  const listed = tree;
  if (offerNoneGood) tree = { ...tree, [NONE_GOOD_KEY]: { description: NONE_GOOD } };
  checkOptions(spec, tree);
  const fallback = typeof spec.fallback === 'function' ? (children, path) => spec.fallback(children, path, context) : null;
  // The question out is what holds the turn while it is out (turn.js).
  const { takeTurn, giveBack } = require('../turn');
  const turnBefore = takeTurn(bot, 'decision', `asking Jev: ${id}`), mark = bot?._turn;
  stage(trace, 'asked');
  if (bot) bot._asking = trace;
  // When the question went out, beside `at`, when its answer came back.
  const askedAt = new Date().toISOString();
  let decision;
  try {
  if (!client) {
    if (!fallback) throw new NoSafeDefault(id, 'no client');
    decision = { ...walk(tree, fallback), fallback: { reason: 'no Jev client' } };
  } else {
    const controller = new AbortController();
    const watcher = setInterval(() => {
      // When the watcher last looked: a check starved would show here.
      trace.lookedMs = Math.round(performance.now() - trace.t0);
      try { task?.check(); if (bot && watchAir) checkAir(bot); interrupt(); }
      catch (err) { if (!controller.signal.aborted) { stage(trace, 'stopped', { why: String(err?.message || err).slice(0, 100) }); controller.abort(err); } }
    }, watchMs);
    const stopThinking = spec.thinking && bot ? require('../speech').thinking(bot) : () => {};
    try {
      decision = await endsWhenStopped(decideTree(client, { state, tree, signal: controller.signal, fallback, kind: spec.kind,
        rootInstructions: withRealTime(spec, state), isFresh, trace }), controller.signal, trace);
    } catch (err) {
      if (!fallback && !controller.signal.aborted && err.name === 'TypeSafeError') throw new NoSafeDefault(id, err.message);
      throw err;
    } finally { clearInterval(watcher); stopThinking(); }
    const tookMs = performance.now() - trace.t0;
    if (tookMs >= SLOW_MS) console.log(`[question] ${id} answered in ${(tookMs / 1000).toFixed(1)}s: ${saysStages(trace)}`);
    task?.check(); if (bot && watchAir) checkAir(bot); interrupt();
    // The gate: a judgment below the question's threshold is not acted on
    // as asked. Where the fallback is the safer answer, it is taken.
    const low = !decision.stale && !decision.fallback && spec.gate && (decision.judgments || []).find(j => (j.confidence ?? 1) < spec.gate.threshold);
    if (low) {
      decision.gated = { branch: low.branch, confidence: low.confidence, threshold: spec.gate.threshold, below: spec.gate.below };
      if (spec.gate.below === 'fallback') decision = { ...decision, ...walk(tree, fallback) };
    }
    if (goal && bot && !decision.stale) announceFallback(bot, goal, decision);
    if (!decision.stale && decision.path?.[0] === NONE_GOOD_KEY) decision = noneGood(id, decision, listed, fallback, { bot, goal, state });
    // A near flag: "none of these" weighed a quarter or more but not taken.
    // In the replay of mid-227-q's blaze at 1.4 health, cover missing, it was
    // a close second (0.32 against the pillar's 0.37) every time (note 462).
    else if (!decision.stale && offerNoneGood && (decision.judgments?.[0]?.probabilities?.[NONE_GOOD_KEY] || 0) >= 0.25) recordMissing(id, decision, listed, { bot, goal, state }, { near: true, took: decision.path });
  }
  // Given back only while the mark is still this question's: a question set
  // aside by its caller (arbiter.js answerOrCut) ends after the layer given
  // the turn has marked it, and must not put "asking Jev" back over it.
  } finally {
    if (!bot || bot._turn === mark) giveBack(bot, turnBefore);
    if (bot?._asking === trace) delete bot._asking;
  }
  decision.id = id;
  if (tracked && !decision.stale && decision.path) repeats.after(bot, id, print, decision.path.join('/'), { goal });
  if (ledgered && !decision.stale && decision.path) tried.begin(bot, goal, { q: id, method: decision.path.join('/'), target: decision.action?.target || target, waiting: ledgerWaits(goal, id), offered: offeredOf(original, target) });
  if (bot && !decision.stale && decision.path) bot._lastDecision = { id, choice: decision.path.at(-1), at: Date.now() };
  if (!decision.stale && decision.action?.valid && !decision.action.valid()) decision.stale = true;
  stage(trace, 'recorded');
  if (client) decision.stages = trace.stages;
  if (goal) {
    goal.decisions ||= [];
    goal.decisions.push({ at: new Date().toISOString(), askedAt, id, kind: spec.kind, path: decision.path, state, options: JSON.parse(JSON.stringify(tree)),
      ...(client ? { stages: trace.stages } : {}),
      latencyMs: decision.latencyMs, usage: decision.usage, judgments: decision.judgments, asked: decision.asked, model: client?.model,
      stale: decision.stale, fallback: decision.fallback, gated: decision.gated, ...(decision.noneGood ? { noneGood: true } : {}) });
    goal.decisions = goal.decisions.slice(-40); save();
    // The flight records it now. Its frame used to wait for the next step's
    // report, after the chosen stance had run, and read as seconds of
    // waiting for Jev: mid-229-s's dig_down, answered in 0.2 seconds at
    // 23:36:43.9, was framed at 23:36:49 with the digging and its 5 health
    // lost between (note 530).
    if (bot && typeof bot.emit === 'function') { try { bot.emit('jev_decision', goal); } catch (_) { /* the record only */ } }
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

module.exports = { parentOf, recentDeaths, define, question, decide, endsWhenStopped, walk, ask, confident, all, NoSafeDefault, decideTree, announceFallback, firstOption };

// The area modules register their questions when this directory is loaded.
require('./survival'); require('./work'); require('./combat'); require('./travel'); require('./intake');
require('./build'); require('./dream'); require('./command');

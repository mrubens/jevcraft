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
// Each gloss in a line (note 672): they go with every such question, and
// re-asked with the shorter ones 12 of 248 recorded answers moved (5 between
// two asks of the same question), no replay case lost.
// The run's own scoring, said plainly: a death fails it. The line had said
// a death mattered less than a night idled, a thumb on the scale toward the
// risky answer at low health (the decision review, 2026-09-26). A night is
// eleven real minutes from dusk to dawn, eight and a half from bedtime.
const REAL_TIME = 'The player counts real time: a Minecraft day is twenty real minutes, a night about eleven. A death ends this attempt and loses what is carried; after that, minutes spent waiting, hiding or going back are the cost.';
const RISK = 'riskNow is how likely a death is now; deathWouldCost, what a death now would lose.';
const DEATHS = 'recentDeaths are the deaths of the last two hours and what was chosen last before each; the same answer in the same place seldom ends differently.';
// A sense of pace said as a fact, not a limit: what the minutes played
// compare with.
const CLOCK = 'runClock is the run so far. A practiced player with iron reaches the Nether within the first hour and has the rods and pearls within the next two; minutes spent are spent, and what counts is what each option still costs.';
const STOCK = 'blockStock is what can be laid: with no pickaxe carried none comes back, and what is carried is all there will be until one is made (makingAPickaxe).';
const SCULK = 'sculk is the sculk sensors and shriekers near and what a shrieker calls.';
const HEALING = 'healing is health, hunger, whether health comes back, the food carried and nearest; standing still spends no hunger.';
// Off the Overworld, hurt with nothing that brings hunger to eighteen: the
// ways health could come back, each with its cost (healing.js, note 607).
const WITHOUT_FOOD = 'withoutFood: health does not come back here; tripBackForFood is the way back through the portal for food; hoglinHunt, the one food of the Nether.';
const AGAIN = 'sameAnswerAgain, lastAnswersCameToNothing and answersThatCameToNothing are this question\'s recent answers that came to nothing; the same answer again seldom ends differently.';
const LEDGER = 'An option tried from about here lately says how it ended; waysResting are options left out after coming to nothing here, and when they come back; whatFailedBelow is what the question below tried and why it ended.';
const UNDER_WAY = 'underWay is the answer under way, chosen earlier and not yet arrived, done or failed; lastIntention is how the last one ended.';
const TRAIL = 'recentPositions is where the bot has been these last minutes: the same few places over and over is a loop, and the same answer again seldom breaks it.';
// Off the Overworld the clock is only minutes (note 677): no day comes to
// end a wait, nothing burns off, and a wait in a sealed pocket ends only when
// the bot opens it. A Nether pocket at hunger 16 with nothing to eat was
// asked with the Overworld's "a night is about eleven minutes" and chose to
// stay (0.48 against going for food 0.25), where health could never come back.
const elsewhereTime = place => `The player counts real time. In ${place} no day or night comes: no mob burns off or leaves with the light, a wait ends only when the bot ends it, and health comes back only while hunger is eighteen or more. A death ends this attempt and loses what is carried; after that, minutes spent waiting, hiding or going back are the cost.`;
// The dark's rule for spawning is the Overworld's: most of the Nether's mobs
// spawn at any light (checkGhastSpawnRules, the zombified piglin's, the
// piglin's, the hoglin's and the magma cube's own rules look at no light).
const NETHER_DARK = 'In the Nether ghasts, zombified piglins, piglins, hoglins and magma cubes spawn at any light; only skeletons, wither skeletons and endermen need the dark.';
const { offOverworld, placeName, norm: normDimension, withoutDayFields } = require('./prompt-audit');
// A question's own words: `guidance` on the Overworld (or where the
// dimension is not known), word for word as it was; off it,
// `elsewhereGuidance` in its place where there is one, else `guidance` with
// each `offOverworld` [from, to] said the way it is true there. `overworld`
// is added on the Overworld only, `elsewhere` off it only.
function ownInstructions(spec, dimension) {
  if (!spec.instructions) return spec.instructions;
  const { overworld, elsewhere, elsewhereGuidance, offOverworld: swaps, ...own } = spec.instructions;
  const off = offOverworld(dimension);
  const place = placeName(dimension);
  const rest = !off ? own : elsewhereGuidance ? { ...own, guidance: typeof elsewhereGuidance === 'function' ? elsewhereGuidance(place) : elsewhereGuidance }
    : swaps ? { ...own, guidance: swaps.reduce((g, [from, to]) => g.split(from).join(to), own.guidance || '') } : own;
  const extra = off ? (typeof elsewhere === 'function' ? elsewhere(place) : elsewhere) : overworld;
  if (!extra) return rest;
  return { ...rest, guidance: `${rest.guidance || ''}${rest.guidance ? ' ' : ''}${extra}` };
}
function withRealTime(spec, state = {}, dimension = state?.dimension) {
  const own = ownInstructions(spec, dimension);
  if (!GAMEPLAY_AREAS.has(spec.area) || !own) return own;
  const { task, guidance = '' } = own;
  const off = offOverworld(dimension);
  const risk = state && (state.riskNow || state.deathWouldCost) && !guidance.includes('riskNow') ? ` ${RISK}` : '';
  const trail = (state?.recentPositions ? ` ${TRAIL}` : '') + (state?.underWay || state?.lastIntention ? ` ${UNDER_WAY}` : '');
  const deaths = (state?.recentDeaths ? ` ${DEATHS}` : '') + (state?.sameAnswerAgain || state?.lastAnswersCameToNothing || state?.answersThatCameToNothing ? ` ${AGAIN}` : '') + (state?.waysResting || state?.whatFailedBelow ? ` ${LEDGER}` : '');
  const clock = (state?.runClock ? ` ${CLOCK}` : '') + (state?.sculk ? ` ${SCULK}` : '') + (state?.healing ? ` ${HEALING}` : '') + (state?.healing?.withoutFood ? ` ${WITHOUT_FOOD}` : '') + (state?.blockStock ? ` ${STOCK}` : '');
  const dark = off && normDimension(dimension) === 'the_nether' && (state?.darkHere !== undefined || /\bdark\b/.test(guidance)) ? ` ${NETHER_DARK}` : '';
  return { ...own, task, guidance: `${guidance}${guidance ? ' ' : ''}${off ? elsewhereTime(placeName(dimension)) : REAL_TIME}${dark}${clock}${risk}${trail}${deaths}` };
}
// The state as it goes out off the Overworld: the day's fields left out at
// any depth (a clock that means nothing there), and where the bot is said.
// The builders leave them out themselves where they were found (pocket_next,
// survival_priority, the work's observation, the strategy); this is the net.
function stateFor(state, dimension) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !offOverworld(dimension)) return state;
  const out = withoutDayFields(state);
  if (!out.dimension) out.dimension = normDimension(dimension);
  return out;
}
// Under the test runner every question built is read for what is false
// where it is asked (prompt-audit.js): a finding fails the test that built it.
const offWorldSaid = new Set();
function auditAsked(id, { instructions, state, tree, dimension }) {
  if (process.env.JEV_PROMPT_AUDIT === '0') return;
  const spec = QUESTIONS.get(id);
  const misplaced = spec?.overworldOnly && offOverworld(dimension);
  if (!process.env.NODE_TEST_CONTEXT) {
    if (misplaced && !offWorldSaid.has(id)) { offWorldSaid.add(id); console.error('[bug]', `${id} is defined as asked only on the Overworld and was asked in ${dimension}`); }
    return;
  }
  const found = require('./prompt-audit').audit({ id, dimension, instructions, state, tree });
  if (misplaced) found.push({ rule: 'overworld-only-question-asked-off-it', at: 'definition', clause: `asked in ${dimension}` });
  if (found.length) throw new Error(`${id} tells Jev what is false where it is asked (${dimension || 'dimension unknown'}): ${found.map(f => `${f.rule} at ${f.at}: "${f.clause.slice(0, 160)}"`).join('; ')}`);
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
function sayOnce(bot, id, path, now = Date.now(), why = null) {
  const said = (bot ? (bot._oneWaySaid ||= {}) : {});
  const key = `${path.join('/')}${why ? '|spent' : ''}`;
  if (said[id]?.key === key && now - said[id].at < ONE_SAID_MS) return;
  said[id] = { key, at: now };
  console.log(why ? `[spent] ${id}: ${path.join(' / ').replaceAll('_', ' ')}, ${why}` : `[one way] ${id}: ${path.join(' / ').replaceAll('_', ' ')}, the only way offered`);
}
// A wait chosen is not a loop: a shelter held for the night, a pillar held
// up top, a stance holding (stillness.js HOLDS) come back to the same
// answer with nothing new, and that is their point. Nor is an emergency
// (the fire, the lava, a fight in reach, stillness.js EMERGENCIES), whose
// questions (body_way, shot_answer, the stance) come at every turn of it:
// a stall raised there would set the way out aside. Said, never held. And
// the questions that are the routing and the stall path themselves
// (turn_priority, stillness_detour) are said, never held: holding them
// would raise a stall from inside the answer to one.
// Nor the stance against mobs about (encounter_stance): held, it raises a
// stall with the mobs still there and no stance taken. Its answers that
// came to nothing are said (note 570: mid-244-ad's out_of_sight forty-one
// times in eleven seconds, under a crossbow piglin, each walk ending where
// it began), and the stance's own failures say why (failedHereJustNow).
// Nor a shooter's warning (shot_answer): the same blazes glow again and
// again, and each glow is its own question.
const NEVER_HELD = new Set(['turn_priority', 'stillness_detour', 'encounter_stance', 'shot_answer']);
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
// Nor are the work's own answers (a question under the rung's, not the
// stall's) waits for the survival layer's action of a few seconds before:
// the work asks them only while it holds the turn. On 25590 off_the_edge
// lingered its eight seconds at every asking of fortress_leg and
// fortress_approach from 12:34:55 to 12:35:03, sixteen answers each coming
// back within a second were recorded as waits, none came to nothing, and
// the rung's question read "17 answers given, 1 coming to nothing" (note
// 605). What an answer is (WAIT_ANSWERS) and a hold step still make a wait.
const ledgerWaits = (goal, id, path = null) => id !== 'stillness_detour' && ((tried.workBelowRung(id) ? HOLDS_STEP(goal) : waitingByChoice(goal, id)) || WAIT_ANSWERS.has(String(path?.at?.(-1) || '')));
const HOLDS_STEP = goal => require('../stillness').HOLDS.has(goal?.step?.action);
// Answers that are waits by what they are, whatever holds the turn when
// they are chosen (note 599): a hunt's stand held for blazes to come, the
// fortress walked again or a spawner waited by, a wait for day or for
// health. Each is judged when it ends by what changed while it lasted
// (tried.js), and one that changed nothing came to nothing.
// The blaze tactics' holds too (note 606: the box and the corner are held for
// a blaze to come to them): the hunt offers them, and not as waits their
// holds were never judged there (note 620).
const WAIT_ANSWERS = new Set(['stay', 'back_to_wall', 'dig_in_and_fight', 'dig_in_at_spawner', 'fight_at_spawner', 'stay_in_fortress', 'wait_at_spawner', 'wait_for_day_sealed', 'rest_to_heal', 'pillar', 'seal', 'dig_down', 'hold_on_span', 'take_cover', 'out_of_sight', 'nook', 'out_of_the_push',
  'box_here', 'box_at_spawner', 'corner_ambush']);
// The options offered, for the ledger (tried.js spent).
// A nested option by its path, as the ledger records it (note 611).
const offeredOf = (tree, target = null) => tried.leavesOf(tree).map(({ key, node }) => ({ key, target: node?.target || target || null }));
// Not in the ledger: the routing between the layers, asked every turn.
// Nor the answer to a shooter's warning (shot_answer), asked at each one,
// beside the step, and over within seconds.
const UNLEDGERED = new Set(['turn_priority', 'shot_answer']);
// Said, never left out nor escalated: a stance against mobs about, the
// body's way out of the lava or the fire, the shield (note 521: a failed
// stance stays on offer with its failure said; Jev weighs it).
const SAY_ONLY = new Set(['encounter_stance', 'body_way', 'shot_answer', 'ranged_response']);
// The tree as offered, less what the ledger left out, without its words.
function plainOf(tree, original) { return Object.fromEntries(Object.keys(tree).map(k => [k, original[k] || tree[k]])); }
// To the question above (define's `parent`), with this one's failure said:
// thrown as a stall held on the bot, so a step that swallows it meets it
// again at its next check, and the loop takes it (work.js runGoal): a
// parent that is a plan's question is asked by its step on the next pass;
// the rung's question is asked at once (answerStall).
function parentOf(id) { try { return question(id).parent || null; } catch (_) { return null; } }
// `until`: when the first of the ways below comes off rest, with every one
// resting. Said to the question above as a stall's rest (answerStall's
// until_rest_ends): on 25584 fortress_leg's ways all rested five minutes,
// and each pass asked fortress_leg, escalated, and asked the rung's
// question again, fifteen times in two minutes, until keeping at it rested
// too and setting the rods aside was the answer left (note 600).
function escalateFrom(bot, goal, spec, why, { until = 0 } = {}) {
  const { to, says, passed } = tried.escalate(goal, { from: spec.id, to: spec.parent || null, why, parentOf, here: bot?.entity?.position });
  // The answer above that led here came to this.
  if (spec.parent) tried.markBlocked(tried.latestOf(goal, spec.parent), says);
  if (to && to !== spec.parent) tried.markBlocked(tried.latestOf(goal, to), says);
  const { raiseFor, Stalled } = require('../stillness');
  throw new Stalled(raiseFor(bot, goal, says, Date.now(), { escalated: { from: spec.id, to, says, passed }, ...(until > Date.now() ? { until } : {}) }));
}

// The same from outside decide: a question whose asker judged its answers
// came to nothing (unstuck.js, a minute of moves that gained nothing, note
// 684). Throws the stall.
function escalate(bot, goal, id, why) { return escalateFrom(bot, goal, question(id), why); }

class NoSafeDefault extends Error {
  constructor(id, reason) { super(`${id}: Jev is unreachable (${reason}) and this decision has no safe default`); this.name = 'Blocked'; }
}

// One decision over a tree of feasible options the caller built. Returns
// what decideTree returns, plus `id`, and `gated` when a low confidence
// sent it to the fallback. A single feasible leaf is taken without asking.
// watchAir false: the question is about the breath or the lava itself
// (body_way), which checkAir would stop at once.
// `situation`: the caller's own key for "the same situation", where the whole
// state's fingerprint changes with what the answer does not turn on (the
// stance's scene, stance-scene.js, note 659); with it a none-good answer is
// counted whatever its weight.
async function decide(id, { client, bot, task, goal, save = () => {}, tree, state, isFresh = () => true, interrupt = () => {}, context, watchMs = 100, watchAir = true, target = null, above = undefined, situation = undefined, aside = false }) {
  // The question above this one, where the caller knows it will not be
  // asked here (`above`: { parent: null, says }): the stall's question with
  // its rung set aside, or between requests, escalated to the rung's
  // question, which answerStall does not ask then, and asked itself again at
  // once, round and round: 52,000 escalations on 25586 and the spin that
  // ended 25587's game (note 609). With nothing above to ask, every way
  // resting is asked here, each with its rest said, and why nothing above
  // is asked is said too.
  const spec = above && above.parent !== undefined ? { ...question(id), parent: above.parent } : question(id);
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
    if (read.allResting && spec.parent !== undefined && spec.parent !== null) escalateFrom(bot, goal, spec, `every way it had from here rests: ${read.resting.join('; ')}`, { until: read.until });
    tree = read.tree;
    if (read.resting.length) resting = read.resting;
    // Kept on offer with nothing above to ask, each says its own rest.
    // Kept on offer with nothing above to ask, each says its own rest; one
    // held by the repeat rule is left out while another is on offer, and
    // said here (note 611).
    if (read.allResting) { resting = read.heldOut?.length ? read.heldOut : null; if (above?.says) state = { ...(state || {}), nothingAbove: above.says }; }
    below = tried.escalationsFor(goal, id);
  }
  // One committed intention at a time (intention.js, note 689): while an
  // answer that takes time holds, a question about the plan is asked without
  // the options that would replace it, and says it.
  let underWay = null, intentionEnded = null;
  if (ledgered) {
    const g = require('../intention').gate(bot, goal, id, tree);
    tree = g.tree; underWay = g.underWay; intentionEnded = g.ended;
    if (g.withheld.length) console.log(`[intention] ${id}: not offered while ${goal.intention?.choice} holds: ${g.withheld.join(', ')}`);
  }
  const takeOne = (one, why = null) => {
    sayOnce(bot, id, one.path, Date.now(), why);
    const decision = { ...one, id, only: true };
    if (bot) bot._lastDecision = { id, choice: one.path.at(-1), at: Date.now() };
    if (decision.action?.valid && !decision.action.valid()) decision.stale = true;
    if (ledgered && !decision.stale) tried.begin(bot, goal, { q: id, method: one.path.join('/'), target: decision.action?.target || target, waiting: ledgerWaits(goal, id, one.path), offered: offeredOf(original, target) });
    if (ledgered && !decision.stale) require('../intention').after(bot, goal, id, one.path, { target: decision.action?.target || target, state, chosen: false });
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
  // The stock of blocks, in the Nether with no pickaxe: mid-243-ah-fortress-7
  // spent 90 blocks in three minutes and stood on its span for three hours,
  // told in each option what it spent and in no question that none comes
  // back (note 642).
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && !state.blockStock) {
    let blocks = null; try { blocks = require('../block-stock').stockSays(bot); } catch (_) { /* no body */ }
    // What a pickaxe is made of is said once: where a way to make one is
    // offered, its own words say it with what is carried (note 687).
    if (blocks && tree && (tree.make_pickaxe || tree.fetch_stems)) { const { makingAPickaxe, ...rest } = blocks; blocks = rest; }
    if (blocks) state = { ...state, blockStock: blocks };
  }
  // The body alight, with every such question but the body's own: while
  // the way out was left be, mid-244-bb was asked survival_priority and
  // turn_priority burning from 12.3 health to 0.3, the fire in none of
  // their facts, and walked on for food (note 595).
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && id !== 'body_way' && !state.alight) {
    let alight = null; try { alight = require('../body').burningSays(bot); } catch (_) { /* no body */ }
    if (alight) state = { ...state, alight };
  }
  // A craft that made nothing lately, with every such question: 25588's
  // stick craft failed fourteen times while the stone pickaxe, the upkeep
  // and the detours each asked for it again (note 690).
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && !state.craftingFailed) {
    let failed = null; try { failed = require('../craft-failures').craftFailuresSay(bot); } catch (_) { /* no body */ }
    if (failed) state = { ...state, craftingFailed: failed };
  }
  // Sculk near, with every such question: mid-230-n worked beside a
  // shrieker it was never told of, and the warden it called killed it.
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && !state.sculk) {
    let sculk = null; try { sculk = require('../sculk').sculkAbout(bot); } catch (_) { /* no world */ }
    if (sculk) state = { ...state, sculk: sculk.says };
  }
  // Where it is asked (note 677): off the Overworld the day's fields go
  // (timeOfDay, night, daylight...), and where the bot is is said.
  const dimension = normDimension(bot?.game?.dimension) || normDimension(state?.dimension);
  state = stateFor(state, dimension);
  // The same facts, the same answer, and nothing came of it (repeats.js):
  // said in the facts; held as failed when it came back at once twice
  // running, and the step's stall path takes it from here.
  const tracked = !!bot && !!goal && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area);
  // The facts as they were offered, without the ledger's words on them: a
  // try said on an option is not new facts (repeats.js).
  const print = tracked ? repeats.fingerprint(state, plainOf(tree, original)) : null;
  // Spent here: "none of these is good" said sure twice running to this
  // same situation from about here (note 599). Not asked again while it
  // stands: the best of the options by that answer's weights is taken, as
  // it was each time, and the question above has been told (below).
  const sit = tracked ? (situation ?? repeats.situation(state, plainOf(tree, original))) : null;
  const spentHere = tracked ? repeats.noneGoodSpent(bot, id, sit, { here: bot.entity?.position }) : null;
  if (spentHere) {
    const keys = Object.keys(tree).filter(k => k !== NONE_GOOD_KEY);
    const best = keys.slice().sort((a, b) => (spentHere.weights[b] || 0) - (spentHere.weights[a] || 0))[0];
    const node = tree[best];
    const rest = node?.children ? walk(node.children, typeof spec.fallback === 'function' ? (children, path) => spec.fallback(children, path, context) : firstOption) : { path: [], action: node };
    return { ...takeOne({ path: [best, ...rest.path], action: rest.action }, `spent here: none of its options was good, ${spentHere.times} times running with these same facts; the best listed taken`), spent: true };
  }
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
      if (ledgered) tried.hold(bot, goal, id, methods, holding.says, { target, targets: Object.fromEntries(methods.map(m => [m, tried.leafAt(tree, m)?.target])), anyTarget: !holding.run });
      // The answers held rest; a question with other ways left is asked
      // with those, the hold said, and escalates only once they rest too:
      // on 25583 fortress_leg's hold on back_to_fortress and leg_east would
      // have gone to the rung with its heights, the blocks to dig and the
      // Overworld's stone never offered (note 583).
      const after = ledgered && !SAY_ONLY.has(id) ? tried.read(bot, goal, id, original, { target }) : null;
      // A held answer is looked for by its path: a nested one is not a key
      // of the top level (note 611).
      if (!after || after.allResting || !Object.keys(after.tree).length || methods.some(m => tried.leafAt(after.tree, m))) escalateFrom(bot, goal, spec, holding.says, { until: after?.allResting ? after.until : 0 });
      tree = after.tree; resting = after.resting.length ? after.resting : null;
      const left = oneWay(tree);
      if (left) return takeOne(left);
    }
    const lately = repeats.heldSays(bot);
    const quickly = !again && quick ? quick.says : null;
    if (again || quickly || lately) state = { ...state, ...(again ? { sameAnswerAgain: again.says } : {}), ...(quickly ? { lastAnswersCameToNothing: quickly } : {}), ...(lately ? { answersThatCameToNothing: lately } : {}) };
  }
  if (state && typeof state === 'object' && (resting || below)) state = { ...state, ...(resting ? { waysResting: resting } : {}), ...(below ? { whatFailedBelow: below } : {}) };
  if (state && typeof state === 'object' && (underWay || intentionEnded)) state = { ...state, ...(underWay ? { underWay } : {}), ...(intentionEnded ? { lastIntention: intentionEnded } : {}) };
  // On unless JEV_NONE_GOOD=0 (the test runner, whose tests name the options
  // each question offers; test/decisions.test.js turns it back on).
  const offerNoneGood = process.env.JEV_NONE_GOOD !== '0' && !!client && GAMEPLAY_AREAS.has(spec.area) && Object.keys(tree).length >= 2 && !tree[NONE_GOOD_KEY];
  const listed = tree;
  if (offerNoneGood) tree = { ...tree, [NONE_GOOD_KEY]: { description: NONE_GOOD } };
  checkOptions(spec, tree);
  const rootInstructions = withRealTime(spec, state, dimension);
  auditAsked(id, { instructions: rootInstructions, state, tree: listed, dimension });
  const fallback = typeof spec.fallback === 'function' ? (children, path) => spec.fallback(children, path, context) : null;
  // The question out is what holds the turn while it is out (turn.js).
  const { takeTurn, giveBack } = require('../turn');
  // Asked aside (`aside`: shot_answer, asked beside whatever holds the
  // turn, which goes on meanwhile): the turn is not taken, and the question
  // out in the record stays the one that holds it.
  const turnBefore = aside ? null : takeTurn(bot, 'decision', `asking Jev: ${id}`), mark = aside ? undefined : bot?._turn;
  stage(trace, 'asked');
  if (bot && !aside) bot._asking = trace;
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
        rootInstructions, isFresh, trace }), controller.signal, trace);
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
    if (!aside && (!bot || bot._turn === mark)) giveBack(bot, turnBefore);
    if (bot?._asking === trace) delete bot._asking;
  }
  decision.id = id;
  if (tracked && !decision.stale && decision.path) repeats.after(bot, id, print, decision.path.join('/'), { goal });
  // "None of these is good", sure, twice running to the same situation:
  // the question is spent here, and escalates as a resting way does (note
  // 599). The best listed is still carried out meanwhile, so the stall is
  // raised, not thrown: the question above is asked with whatFailedBelow
  // on its next asking (the rung's at the loop's next pass).
  if (tracked && !decision.stale && decision.path && decision.judgments?.length) {
    const ng = repeats.noneGoodAfter(bot, id, sit, decision.judgments[0]?.probabilities || {}, { here: bot.entity?.position, took: decision.noneGood ? decision.path : [], anyWeight: situation !== undefined });
    if (ng?.spent) {
      decision.spent = true;
      console.log(`[none good] ${id}: ${ng.says}`);
      if (ledgered && spec.parent) {
        const { to, says, passed } = tried.escalate(goal, { from: id, to: spec.parent, why: ng.says, parentOf, here: bot.entity?.position });
        tried.markBlocked(tried.latestOf(goal, spec.parent), says);
        if (to && to !== spec.parent) tried.markBlocked(tried.latestOf(goal, to), says);
        try { require('../stillness').raiseFor(bot, goal, says, Date.now(), { escalated: { from: id, to, says, passed } }); } catch (_) { /* the ledger has it */ }
      }
    }
  }
  if (ledgered && !decision.stale && decision.path) tried.begin(bot, goal, { q: id, method: decision.path.join('/'), target: decision.action?.target || target, waiting: ledgerWaits(goal, id, decision.path), offered: offeredOf(original, target) });
  if (ledgered && !decision.stale && decision.path) require('../intention').after(bot, goal, id, decision.path, { target: decision.action?.target || target, state });
  if (bot && !decision.stale && decision.path) bot._lastDecision = { id, choice: decision.path.at(-1), at: Date.now() };
  if (!decision.stale && decision.action?.valid && !decision.action.valid()) decision.stale = true;
  stage(trace, 'recorded');
  if (client) decision.stages = trace.stages;
  if (goal) {
    goal.decisions ||= [];
    goal.decisions.push({ at: new Date().toISOString(), askedAt, id, kind: spec.kind, path: decision.path, ...(dimension ? { dimension } : {}), state, options: JSON.parse(JSON.stringify(tree)),
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

module.exports = { escalate, withRealTime, ownInstructions, stateFor, WAIT_ANSWERS, parentOf, recentDeaths, define, question, decide, endsWhenStopped, walk, ask, confident, all, NoSafeDefault, decideTree, announceFallback, firstOption };

// The area modules register their questions when this directory is loaded.
require('./survival'); require('./work'); require('./combat'); require('./travel'); require('./intake');
require('./build'); require('./dream'); require('./command');

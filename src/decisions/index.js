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
//   (no fallback)  a question Jev cannot answer is not answered by code
//                  (the user, 2026-09-30: "If jev is down, decisions aren't
//                  made"): decide() holds and asks again (jev-down.js)
//   safetyRule     the body's physics only (body_way, shot_answer): the
//                  rule that answers at once when Jev cannot be reached, as
//                  (children, path, context) => key, with `safetyWhy`
//   gate           { threshold, below: 'caller', why }: a confidence under
//                  the threshold is not acted on as asked; the caller has
//                  its own low-confidence path (a clarifying question, a
//                  narrower action). A tree's gate applies at every level
//                  of it. A high-stakes question without a gate states why
//                  in `ungated`.
//   question       what is asked, in a plain sentence
//   trigger        when it is asked
//   source         where its options or candidates are built
//   options        a tree's option catalogue: every key the tree can hold,
//                  as { key } or { pattern }, with a label, when it is on
//                  offer, and the level it sits at. decide() checks each tree
//                  against it: a key not in the catalogue fails a test, and
//                  is logged as a bug in play.
//   unreachable    for a batched question, what happens when Jev cannot be
//                  reached (a tree's is the hold, decide())
//   batch          the batch a question rides in, when it rides in one
//   parent         for a question about playing the game, the question
//                  asked next up when this one has nothing left to try:
//                  step, way (fortress_approach), plan (fortress_leg,
//                  portal_way), rung (rung_progress); null where none is
//
// and every tree decision goes through decide() below, which applies the
// definition. Batched questions are asked with ask() and judged with
// confident(), so their bars live here too.
const { decideTree, firstOption } = require('./tree');
const jevDown = require('../jev-down');
const { checkAir } = require('../vitals');
const { stage } = require('../typesafe');
const repeats = require('./repeats');
const tried = require('../tried');
const leastBad = require('./least-bad');
const unchanged = require('./unchanged');
const loops = require('./loops');

const QUESTIONS = new Map();
const STAKES = new Set(['low', 'medium', 'high']);
const PRIMITIVES = new Set(['choice', 'noul', 'score']);
const BELOW = new Set(['caller']);
// The questions whose unanswered form is the body's own physics: the way
// out of lava, fire, a hot floor, a block or the water (body_way), and the
// shield or cover against a shot about to land (shot_answer, note 676).
// Only these may carry a safetyRule.
const SAFETY_RULED = new Set(['body_way', 'shot_answer']);

function define(spec) {
  const problems = [];
  if (!spec.id) problems.push('an id');
  if (QUESTIONS.has(spec.id)) problems.push(`a unique id (${spec.id} is taken)`);
  if (!spec.area) problems.push('an area');
  if (!spec.kind) problems.push('a ledger kind');
  if (!PRIMITIVES.has(spec.primitive)) problems.push('a primitive');
  if (!STAKES.has(spec.stakes)) problems.push('stakes');
  if (Object.hasOwn(spec, 'fallback')) problems.push('no fallback (a question Jev cannot answer is held and asked again, jev-down.js; the tests declare their answers in test/support/jev-stand-in.js)');
  if (spec.safetyRule !== undefined && !(SAFETY_RULED.has(spec.id) && typeof spec.safetyRule === 'function' && spec.safetyWhy)) problems.push(`a safetyRule only on the body's physics (${[...SAFETY_RULED].join(', ')}), a function, with safetyWhy`);
  if (!spec.tree && typeof spec.build !== 'function') problems.push('a tree flag or a build(args) that returns its typed question');
  if (spec.gate && (!(spec.gate.threshold > 0 && spec.gate.threshold < 1) || !BELOW.has(spec.gate.below) || !spec.gate.why)) problems.push('a gate with threshold, below and why');
  if (spec.stakes === 'high' && !spec.gate && !spec.ungated) problems.push('a gate, or `ungated` saying why a high-stakes answer is acted on at any confidence');
  if (!spec.question) problems.push('a plain question');
  if (!spec.trigger) problems.push('a trigger');
  if (!spec.source) problems.push('a source');
  if (spec.tree && !(Array.isArray(spec.options) && spec.options.length && spec.options.every(o => (o.key || o.pattern) && o.label && o.when))) problems.push('an option catalogue ({ key or pattern, label, when })');
  // What a dynamic option's key names (keys.js, note 749): its thing, by
  // name, by where it is, by its entity id; never its place in the list,
  // which names a different thing whenever the list is ordered anew.
  if (spec.tree && Array.isArray(spec.options)) for (const o of spec.options) {
    if (o.trip !== undefined && !(typeof o.trip === 'string' && o.trip)) problems.push(`option ${o.key || o.pattern} to say where its trip goes (\`trip\`: a place in words), or no trip`);
    if (o.dynamic && !(typeof o.names === 'string' && o.names && !/\b(index|order in the list|position in the list|place in the list|nearest first)\b/i.test(o.names))) problems.push(`option ${o.key || o.pattern} to say what its key names (\`names\`): its thing, by name, place or id, not its place in the list`);
  }
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
// The body's own ways offered beside a work question at low health
// (low-health.js, note 752c) are every such question's, as none_good is.
const BODY_KEYS = new Set(['eat_first', 'wall_in_first']);
const declared = (spec, key) => key === NONE_GOOD_KEY || BODY_KEYS.has(key) || spec.options.some(o => o.key === key || (o.pattern && new RegExp(`^(?:${o.pattern})$`).test(key)));
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

// A walk down a tree by a picker: the body's safety rule, Jev's own answers
// below a none good, the tests' stand-in.
function walk(tree, pick) {
  const path = [];
  let children = tree;
  for (;;) {
    const keys = Object.keys(children);
    const key = keys.length === 1 ? keys[0] : pick(children, path);
    if (!Object.hasOwn(children, key)) throw new Error(`The walk selected an unavailable option at ${path.join(' / ') || 'root'}`);
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
const LEAST_BAD = 'leastBadLast: at this question\'s last asking Jev said none of its options was good; it says what was taken as the least bad and what came of it.';
const LAST_HIT = 'lastHit: one hit ends the bot and only food brings health back.';
const AT_ONCE = 'failedAtOnce: answers chosen a moment ago whose action ended within two seconds, and why; each rests from where it was chosen.';
const UNDER_WAY = 'underWay is the answer under way, chosen earlier and not yet arrived, done or failed; lastIntention is how the last one ended.';
// Note 724 (unchanged.js): the answer before this one changed nothing, and
// options whose goal is already so.
const CHANGED_NOTHING = 'answerChangedNothing: this question\'s last answer ended with the bot on the same block, carrying the same, no block dug or placed and health as it was; the same answer again changes nothing unless something else has.';
const ALREADY_SO = 'alreadySo: options not offered because what they would bring about is already so.';
// Note 749 (loops.js): the askings of this question just before, each within
// a minute of the one before, wherever the bot walked between.
const SPELL = 'spellSoFar: this question has been asked again and again just now, each asking within a minute of the one before: how many times, what was answered, how far the bot walked and how far it is from where the askings began, whether anything new is carried, and how often none of the options was good. The same answers again seldom end it.';
const ASIDE_HOLDS = 'asideHolds: options that would take back a rung set aside a moment ago, not offered while nothing named has changed since it was set aside.';
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
  const deaths = (state?.recentDeaths ? ` ${DEATHS}` : '') + (state?.sameAnswerAgain || state?.lastAnswersCameToNothing || state?.answersThatCameToNothing ? ` ${AGAIN}` : '') + (state?.waysResting || state?.whatFailedBelow ? ` ${LEDGER}` : '') + (state?.leastBadLast ? ` ${LEAST_BAD}` : '') + (state?.failedAtOnce ? ` ${AT_ONCE}` : '') + (state?.lastHit ? ` ${LAST_HIT}` : '') + (state?.answerChangedNothing ? ` ${CHANGED_NOTHING}` : '') + (state?.alreadySo ? ` ${ALREADY_SO}` : '') + (state?.spellSoFar ? ` ${SPELL}` : '') + (state?.asideHolds ? ` ${ASIDE_HOLDS}` : '');
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

// The option taken when Jev says none of them is good: the likeliest by
// Jev's own weights, unless it is priced (a stance's `expects`: the damage
// it takes over its seconds, by its own figures) at the health the bot has
// or more. Then the likeliest priced one that is not;
// and where every priced one does, the one that takes the least in the next
// seconds (its damage at its own pace over EXPOSED_S, as a hold judges a
// stance on pace, holds.js), not the next weight down. At 21:18:09Z on
// 25589 (6.8 health, six blazes by a live spawner) none_good was 0.18 and
// the code took break_spawner, 0.17, priced 9.6 damage in its first second
// and a half; leave_and_heal took 9.9 on a 2.1-second walk and then none
// (note 691). An option with no price is not judged by it. The weights are Jev's where Jev chose;
// here Jev chose none of them, and the rule is what the code does meanwhile.
const EXPOSED_S = 15;
function pickWhenNoneGood(listed, weights, health) {
  const keys = Object.keys(listed).filter(k => k !== NONE_GOOD_KEY);
  const byWeight = keys.slice().sort((a, b) => (weights[b] || 0) - (weights[a] || 0));
  const priced = keys.filter(k => Number.isFinite(listed[k]?.expects?.damage) && Number.isFinite(listed[k]?.expects?.seconds));
  if (!Number.isFinite(health) || !priced.length) return { key: byWeight[0], why: null };
  const takes = k => listed[k].expects.damage;
  const soon = k => takes(k) * EXPOSED_S / Math.max(1, listed[k].expects.seconds);
  // The next by weight stands unless its own figures take the health.
  if (!priced.includes(byWeight[0]) || takes(byWeight[0]) < health) return { key: byWeight[0], why: null };
  const lives = byWeight.filter(k => priced.includes(k) && takes(k) < health);
  if (lives.length) return { key: lives[0], why: `the likelier ${byWeight.slice(0, byWeight.indexOf(lives[0])).filter(k => priced.includes(k)).join(', ')} priced at the health the bot has or more` };
  const least = priced.slice().sort((a, b) => soon(a) - soon(b) || (weights[b] || 0) - (weights[a] || 0))[0];
  return { key: least, why: `every priced option takes the ${Math.round(health * 10) / 10} health the bot has or more by its own figures; ${least} takes the least in the next ${EXPOSED_S} seconds (about ${Math.round(soon(least) * 10) / 10})` };
}
// Recorded, and an option taken instead: the least bad (least-bad.js,
// note 693: a wait or keep-on taken so twice running with nothing changed
// is passed over for the best other), unless its own price takes the health
// the bot has (pickWhenNoneGood, note 691), walked on down its branch by
// Jev's own answers there (the whole tree is asked at once), the first
// listed where a level had none.
function noneGood(id, decision, listed, { bot, goal, state, last = null }) {
  const weights = decision.judgments?.[0]?.probabilities || {};
  const keys = Object.keys(listed);
  const byJev = children => decision.answerAt?.(children) || firstOption(children);
  const down = k => { const node = listed[k]; return node?.children ? { path: [k, ...walk(node.children, byJev).path] } : { path: [k] }; };
  const safety = pickWhenNoneGood(listed, weights, bot?.health);
  let path, passedOver = null, why = safety.why;
  if (why) { path = down(safety.key).path; console.log(`[none good] ${id}: took ${safety.key}, not the next by weight: ${why}`); }
  else ({ path, passedOver } = leastBad.choose(id, keys, weights, last, k => down(k).path));
  // None good far above the best listed (note 749c): the listed are not
  // Jev's choice in any sense, and the least bad taken on a sliver of weight
  // is a guess acted on. 25598 at 14:15:14Z: none_good 0.83, take_up_nether_
  // chest 0.09 taken ("I'll make the nether chest first after all"), and
  // undone seven seconds later. At twice the best listed or more, the option
  // that changes nothing is taken instead where one is on offer (the ladder's
  // own next, ladderNext; one that keeps on with what is under way, KEEP);
  // where none is, the least bad is taken as before and marked weak, for a
  // caller with its own way to go on as it was (strategy.js: the ladder's
  // stage). Not the body's own questions nor the stance (pickWhenNoneGood's
  // safety comes first there).
  let weak = null;
  const bestKey = keys.filter(k => k !== NONE_GOOD_KEY).sort((a, b) => (weights[b] || 0) - (weights[a] || 0))[0];
  const ng = weights[NONE_GOOD_KEY] || 0, bestW = weights[bestKey] || 0;
  if (!why && !SAY_ONLY.has(id) && ng >= 2 * bestW && ng > 0) {
    const KEEP = require('../intention').KEEP;
    const calm = keys.find(k => k !== NONE_GOOD_KEY && (listed[k]?.ladderNext || KEEP.test(k)));
    const r = n => Math.round(n * 100) / 100;
    if (calm && calm !== path[0]) { passedOver = `none good at ${r(ng)} was twice the best listed or more (${bestKey.replaceAll('_', ' ')} ${r(bestW)}): ${calm.replaceAll('_', ' ')}, which changes nothing, was taken rather than a guess`; path = down(calm).path; }
    else if (!calm) weak = { key: path[0], p: r(weights[path[0]] || 0), noneGood: r(ng) };
  }
  let node = { children: listed };
  for (const k of path) node = node.children[k];
  const took = { path, action: node };
  recordMissing(id, decision, listed, { bot, goal, state }, { took: took.path, ...(why ? { tookBecause: why } : {}), ...(passedOver ? { passedOver } : {}), ...(last ? { lastLeastBad: last.says } : {}) });
  console.log(`[missing option] ${id}: none of the options was good; took ${took.path.join('/')} instead${passedOver ? ` (${passedOver})` : ''}`);
  return { ...decision, ...took, noneGood: true, ...(passedOver ? { passedOver } : {}), ...(weak ? { weakLeastBad: weak } : {}) };
}
function recordMissing(id, decision, listed, { bot, goal, state }, { near = false, took = [], ...more } = {}) {
  const weights = decision.judgments?.[0]?.probabilities || {};
  const keys = Object.keys(listed);
  const entry = { ...(near ? { near: true } : {}), at: new Date().toISOString(), question: id, bot: bot?.username || null, port: bot?._client?.socket?.remotePort ?? null,
    dimension: String(bot?.game?.dimension || '').replace('minecraft:', ''), position: bot?.entity?.position ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null,
    health: bot?.health ?? null, request: goal?.request || null, weights, tookInstead: took, ...more,
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
// Answers thrown away as stale (note 749): from STALE_RUN in a row within
// STALE_WINDOW_MS, the next asking is watched STALE_WATCH_MS first.
const STALE_RUN = 2, STALE_WINDOW_MS = 30000, STALE_WATCH_MS = 1000;
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
// The questions about the plan, which wait while a fight is on (danger.js
// fightOn, note 696): the legs, the fortress's questions, the detours, the
// upkeep and the stage. Survival's turn comes first; asked at the end of the
// wait with the fight still on, the fight is said in the facts.
const FIGHT_WAITS = (() => { const i = require('../intention'); return new Set([...i.GATED, ...i.AT_A_CHANGE, 'upkeep', 'win_strategy']); })();
// The questions that say the walls round the bot themselves (note 697).
const WALLED_OWN = new Set(['pocket_next', 'unstuck_move']);
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

// No client in play is Jev not reachable: held like an outage.
const NO_CLIENT = { systemOne: async () => { throw new jevDown.JevDown('no Jev client is configured'); } };
// The tests' stand-in for Jev (test/support/jev-stand-in.js), set by the
// test harness only; used where a test gives no client.
const STAND_IN = { current: null };
const useStandIn = standIn => { STAND_IN.current = standIn || null; };

// One decision over a tree of feasible options the caller built. Returns
// what decideTree returns, plus `id`, and `gated` when a low confidence
// is under the question's bar (its caller's own path). A single feasible
// leaf is taken without asking. Jev not reachable, it holds and asks again
// (jev-down.js); an answer after an outage comes back stale.
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
  // No question while the body is in lava with nothing to keep it from
  // burning: the way out is the body's safety rule, taken at once
  // (lava-escape.js, note 756). Thrown as the lava's own safety stop, which
  // every caller already meets from task.check, so the loop's next pass
  // gives the turn to the escape. 25595 asked turn_priority and 25593
  // win_strategy with the body in lava (scripts/lava-deaths.js).
  if (bot && require('../lava-escape').mustEscape(bot)) {
    console.log(`[lava-escape] ${id} not asked: the body is in lava`);
    throw new (require('../danger').NeedsSafety)({ entity: { name: 'lava' }, distance: 0 });
  }
  // A question about the plan waits while a fight is on (note 696); the
  // options it was built with are asked only if still fresh after a wait.
  if (bot && goal && FIGHT_WAITS.has(id)) {
    const fight = await require('../danger').waitOutFight(bot, task);
    if (fight.first) {
      console.log(`[fight] ${id} waited ${(fight.waitedMs / 1000).toFixed(1)}s for the fight (${fight.first})${fight.still ? `; still on (${fight.still}), asked with it said` : ''}`);
      if (fight.waitedMs > 0 && !isFresh()) return { id, stale: true, fightWaited: fight };
    }
    if (fight.still) state = { ...(state || {}), fightOn: `${fight.still}: this question waited ${Math.round(fight.waitedMs / 1000)} seconds for the fight to end and is asked with it still on` };
  }
  // A wait whose event cannot come, or whose coming changes nothing, is not
  // offered: said in the facts instead (waits.js, note 698). 25591 answered
  // leave_nether wait_here 32 times of 32 for a rest whose cause standing
  // there did not change.
  {
    const w = require('../waits').gate(id, tree, { sayOnly: SAY_ONLY.has(id), declaredWait: key => spec.options?.some(o => o.key === key && o.wait) });
    tree = w.tree;
    if (w.facts.length) {
      console.log(`[waits] ${id}: ${w.facts.join(' | ')}`);
      if (state && typeof state === 'object') state = { ...state, waitsForNothing: w.facts };
    }
    // An option whose goal is already so (a node's `satisfied`, unchanged.js,
    // note 724): not offered, said as a fact.
    const done = unchanged.satisfiedGate(tree);
    tree = done.tree;
    if (done.facts.length) {
      console.log(`[already so] ${id}: ${done.facts.join(' | ')}`);
      if (state && typeof state === 'object') state = { ...state, alreadySo: done.facts };
    }
  }
  // At low health (6 or under, or four and more lost to hits in the last 30
  // seconds), a question about the work says the body, the hits and what
  // the work at this health came to in the played record, and offers eating
  // or walling in first, each with its time (low-health.js, note 752c):
  // 25588 at 2 health, nine zombie hits in eight seconds, was asked which
  // coal ore to dig with nothing said of either. Not the questions that are
  // the body's own (the fight, the shelter, the turn, the pocket).
  let bodyFirst = null;
  if (bot && goal && !aside && GAMEPLAY_AREAS.has(spec.area) && spec.area !== 'combat' && !BODY_QUESTIONS.has(id)) {
    try { bodyFirst = require('../low-health').ways(bot, { task: task || { check() {} }, goal, save }); } catch (_) { bodyFirst = null; }
    if (bodyFirst) {
      tree = { ...tree, ...bodyFirst.tree };
      state = { ...(state && typeof state === 'object' ? state : {}), lowHealth: bodyFirst.says };
    }
  }
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
  // The least bad taken at the last asking, when Jev said none of its
  // options was good (least-bad.js, note 693): asked again with the same
  // options from about here and nothing come of it, the same set is not
  // asked again: the least bad is held from here and the question above is
  // asked with the none good said. Else it is said, in the facts and on it.
  let lastLeastBad = null, lastChosen = null, keptBesideLeave = [];
  // The answer given last, whatever its question, if it ended in its first
  // second: rested from where it was chosen, and said below (at-once.js,
  // note 695).
  if (ledgered) require('../at-once').check(bot, goal, id);
  if (ledgered) {
    tried.settle(bot, goal, { q: id });
    lastLeastBad = leastBad.before(bot, goal, id, original);
    // And an answer Jev chose twice running from here with these same
    // options, nothing come of it: held from here, said as its rest (note 697).
    lastChosen = leastBad.chosenBefore(bot, goal, id, original);
    // Where the ledger rests it already (its own two tries), that rest says it.
    const ledgerRests = lastChosen?.hold && (tried.read(bot, goal, id, original, { target }).resting || []).some(r => r.startsWith(`${String(lastChosen.key).replaceAll('_', ' ')}:`));
    if (lastChosen?.hold && !ledgerRests) {
      const why = `${lastChosen.says}; not offered again from here`;
      delete bot._chosenLast[id];
      tried.hold(bot, goal, id, [lastChosen.key], why, { target, targets: { [lastChosen.key]: tried.leafAt(original, lastChosen.key)?.target } });
      console.log(`[chosen again] ${id}: ${why}`);
    }
    if (lastLeastBad?.unchanged && spec.parent && !SAY_ONLY.has(id)) {
      const why = `${lastLeastBad.says}; the same options from here are not asked again`;
      delete bot._leastBad[id];
      tried.hold(bot, goal, id, [lastLeastBad.key], why, { target, targets: { [lastLeastBad.key]: tried.leafAt(original, lastLeastBad.key)?.target } });
      console.log(`[none good] ${id}: ${why}`);
      escalateFrom(bot, goal, spec, why);
    }
    const read = tried.read(bot, goal, id, tree, { target, sayOnly: SAY_ONLY.has(id), leave: require('../intention').GATED.has(id) ? require('../fortress-hold').isLeave : null });
    keptBesideLeave = read.keptBesideLeave || [];
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
  // More than a few plan answers in a row from one spot, none of which took
  // any time: not asked on, the rung's question asked once with the chain
  // said (plan-chain.js, note 705). After the ledger's own reading, whose
  // escalation of a way resting comes first.
  if (ledgered) {
    const chain = require('../plan-chain').check(bot, goal, id);
    if (chain) { const { raiseFor, Stalled } = require('../stillness'); throw new Stalled(raiseFor(bot, goal, chain.says, Date.now(), { escalated: { from: id, to: 'rung_progress', says: chain.says } })); }
  }
  // Asked round and round (loops.js, note 749): the spell of askings, each
  // within a minute of the one before, wherever the bot has walked between.
  // Said from its third asking; gone up to the question above, the answers
  // it gave resting from here, once none good has been Jev's likeliest at
  // half of it (three times or more) or it has gone nowhere.
  let spell = null;
  // Asked aside too (shot_answer, note 749b): said, never sent up.
  if (bot && goal && GAMEPLAY_AREAS.has(spec.area)) {
    spell = loops.before(bot, id);
    if (spell?.why && ledgered && spec.parent && !SAY_ONLY.has(id) && !NEVER_HELD.has(id)) {
      const why = `${id.replaceAll('_', ' ')} was ${spell.says}; ${spell.why}`;
      loops.reset(bot, id);
      const methods = spell.choices.filter(c => tried.leafAt(original, c));
      if (methods.length) tried.hold(bot, goal, id, methods, why, { target, targets: Object.fromEntries(methods.map(m => [m, tried.leafAt(original, m)?.target])), anyTarget: true });
      console.log(`[round and round] ${why}`);
      escalateFrom(bot, goal, spec, why);
    }
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
  // A rung set aside holds like a trip (asides.js, note 749): an option that
  // would take it back is not offered until something named has changed.
  let asideHolds = null;
  if (bot && goal && GAMEPLAY_AREAS.has(spec.area)) {
    const a = require('./asides').gate(bot, goal, tree);
    tree = a.tree;
    if (a.facts.length) { asideHolds = a.facts; console.log(`[aside holds] ${id}: ${a.facts.join(' | ')}`); }
  }
  // Leaving is Jev's, asked (fortress-hold.js, note 721): a lone leave, or a
  // lone resting way kept only beside one, is not taken unasked. Its failure
  // goes to the answer it serves, where it is that answer's way (the fetch of
  // stems whose gathering has only `without` left fails, and says why), else
  // to the question above with it said.
  const loneLeave = key => {
    const why = ledgered ? require('../fortress-hold').loneWhy(id, key, keptBesideLeave) : null;
    if (!why) return;
    const intent = require('../intention'), i = intent.holding(bot, goal);
    console.log(`[leaving] ${id}: ${why}`);
    if (i && i.q !== id && intent.wayOf(id, i)) {
      intent.end(goal, `failed: ${id.replaceAll('_', ' ')}: ${why}`);
      throw new Error(`No way on for ${i.choice.replaceAll('_', ' ')} from here: ${id.replaceAll('_', ' ')}: ${why}`);
    }
    escalateFrom(bot, goal, spec, why);
  };
  const takeOne = (one, why = null) => {
    loneLeave(one.path.join('/'));
    sayOnce(bot, id, one.path, Date.now(), why);
    const decision = { ...one, id, only: true };
    if (bot) bot._lastDecision = { id, choice: one.path.at(-1), at: Date.now() };
    if (decision.action?.valid && !decision.action.valid()) decision.stale = true;
    if (ledgered && !decision.stale) tried.begin(bot, goal, { q: id, method: one.path.join('/'), target: decision.action?.target || target, waiting: ledgerWaits(goal, id, one.path), offered: offeredOf(original, target) });
    if (ledgered && !decision.stale) require('../intention').after(bot, goal, id, one.path, { target: decision.action?.target || target, state, chosen: false });
    if (ledgered && !decision.stale) require('../plan-chain').note(bot, goal, id, one.path);
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
  // Walled in by its own blocks, with every such question but the pocket's
  // and working free's own, which say it themselves: 25591's leave_nether
  // and rung_progress were asked round and round in its netherrack pocket,
  // told nothing of it (walled-in.js, note 697).
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && !WALLED_OWN.has(id) && !state.walledIn) {
    let walled = null; try { walled = require('../walled-in').walledInSays(bot, { survival: goal?.survival }); } catch (_) { /* no body */ }
    if (walled) state = { ...state, walledIn: walled.says };
  }
  // One hit ends the bot and health cannot come back (last-hit.js, note
  // 706), with every such question and said first: 25588 at 0.2 health and
  // no food was asked for stems, a spare pickaxe and twenty minutes on
  // without food, none of them saying it.
  if (bot && state && typeof state === 'object' && GAMEPLAY_AREAS.has(spec.area) && !state.lastHit) {
    let hit = null; try { hit = require('../last-hit').lastHit(bot); } catch (_) { /* no body */ }
    if (hit) state = { lastHit: hit.says, ...state };
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
  // The answer before this one changed nothing (unchanged.js, note 724): the
  // block, what is carried, the blocks dug or placed and the health band are
  // as they were when it was given. With the question's facts the same too,
  // it is not asked yet: the bot holds, its reflexes watching as they do
  // while a question is out, until one of those changes (then the question
  // is built afresh: stale) or the stated wait passes. Either way the answer
  // that changed nothing is said, in the facts and on its option. The body's
  // own questions, the stance and the routing are said, never held.
  const digest = tracked ? unchanged.digest(state, plainOf(tree, original)) : null;
  let changedNothing = null;
  if (tracked) {
    const last = unchanged.before(bot, id, digest);
    if (last) {
      let held = { heldMs: 0, ended: null };
      if (last.holdMs > 0 && !unchanged.NOT_HELD.has(id) && !aside) {
        console.log(`[unchanged] ${id}: ${last.choice} changed nothing ${Math.round((Date.now() - last.at) / 100) / 10}s ago, the same facts; held up to ${Math.round(last.holdMs / 1000)}s for something to change`);
        const { takeTurn, giveBack } = require('../turn');
        const before = takeTurn(bot, 'decision', `held: ${id}, its last answer changed nothing`), heldMark = bot._turn;
        try { held = await unchanged.hold(bot, last, last.holdMs, { check: () => { task?.check(); if (watchAir) checkAir(bot); interrupt(); } }); }
        finally { if (bot._turn === heldMark) giveBack(bot, before); }
        if (held.changed) { console.log(`[unchanged] ${id}: held ${(held.heldMs / 1000).toFixed(1)}s, then ${held.changed}; asked afresh`); return { id, stale: true, heldUnchanged: { choice: last.choice, heldMs: held.heldMs, changed: held.changed } }; }
      }
      const w = unchanged.says(last, held);
      state = { ...state, answerChangedNothing: w.facts };
      // On the option too, unless the ledger's words on it say it already.
      const leaf = tried.leafAt(tree, last.choice);
      if (leaf && !/came to nothing/.test(typeof leaf.description === 'string' ? leaf.description : JSON.stringify(leaf.description || ''))) tree = leastBad.sayOn(tree, last.choice, w.option);
      changedNothing = last;
    }
  }
  // The stance's only (note 693): elsewhere a none good changes the next
  // asking (least-bad.js) instead of the likeliest listed being taken unasked.
  const spentHere = tracked && !leastBad.applies(id) ? repeats.noneGoodSpent(bot, id, sit, { here: bot.entity?.position }) : null;
  if (spentHere) {
    const { key: best } = pickWhenNoneGood(tree, spentHere.weights || {}, bot?.health);
    const node = tree[best];
    const rest = node?.children ? walk(node.children, firstOption) : { path: [], action: node };
    return { ...takeOne({ path: [best, ...rest.path], action: rest.action }, `spent here: none of its options was good, ${spentHere.times} times running with these same facts; the best listed taken`), spent: true };
  }
  if (tracked) {
    const waiting = waitingByChoice(goal, id);
    const again = repeats.before(bot, goal, id, print);
    // And whatever the facts: the last answers in a row that each came
    // back at once with nothing coming of them (note 570).
    const quick = repeats.quickBefore(bot, goal, id, { waiting });
    // The same facts and the same answer come back at once are unchanged.js's
    // (note 724): held there, before this, until something changes. What is
    // held here is a run of answers back at once whatever the facts.
    const holding = quick?.hold ? quick : null;
    if (holding) {
      const why = `${id.replaceAll('_', ' ')}: ${holding.says}`;
      repeats.held(bot, id, holding.says);
      console.log(`[repeat] ${why}`);
      // Held, the answers rest from here (the ledger), and the question
      // above is asked with this failure said: not the same question, and
      // not a detour that walks eight blocks and comes back to it (note 571).
      const methods = holding.streak.map(s => s.choice);
      if (ledgered) tried.hold(bot, goal, id, methods, holding.says, { target, targets: Object.fromEntries(methods.map(m => [m, tried.leafAt(tree, m)?.target])), anyTarget: true });
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
  if (!ledgered && bot && GAMEPLAY_AREAS.has(spec.area)) lastLeastBad = leastBad.before(bot, goal, id, original);
  if (lastLeastBad) {
    if (state && typeof state === 'object') state = { ...state, leastBadLast: lastLeastBad.says };
    if (tried.leafAt(tree, lastLeastBad.key)) tree = leastBad.sayOn(tree, lastLeastBad.key, lastLeastBad.optionSays);
  }
  if (ledgered && state && typeof state === 'object' && !state.failedAtOnce) {
    const atOnce = require('../at-once').says(goal);
    if (atOnce) state = { ...state, failedAtOnce: atOnce };
  }
  if (asideHolds && state && typeof state === 'object') state = { ...state, asideHolds };
  if (spell?.said && state && typeof state === 'object') state = { ...state, spellSoFar: `${id.replaceAll('_', ' ')} was ${spell.says}${spell.why ? `; ${spell.why}` : ''}` };
  if (state && typeof state === 'object' && (underWay || intentionEnded)) state ={ ...state, ...(underWay ? { underWay } : {}), ...(intentionEnded ? { lastIntention: intentionEnded } : {}) };
  // The plan answers just given from here, a reversal among them, and the
  // options that would turn back on the last (plan-chain.js, note 705).
  if (ledgered && state && typeof state === 'object') {
    const pf = require('../plan-chain').facts(bot, goal, id, tree);
    if (pf.recent || pf.reversal) state = { ...state, ...(pf.recent ? { planAnswersJustNow: pf.recent } : {}), ...(pf.reversal ? { reversal: pf.reversal } : {}) };
    for (const [key, said] of Object.entries(pf.tags)) tree = leastBad.sayOn(tree, key, said.trim());
  }
  // On unless JEV_NONE_GOOD=0 (the test runner, whose tests name the options
  // each question offers; test/decisions.test.js turns it back on).
  const offerNoneGood = process.env.JEV_NONE_GOOD !== '0' && !!client && GAMEPLAY_AREAS.has(spec.area) && Object.keys(tree).length >= 2 && !tree[NONE_GOOD_KEY];
  const listed = tree;
  if (offerNoneGood) tree = { ...tree, [NONE_GOOD_KEY]: { description: NONE_GOOD } };
  checkOptions(spec, tree);
  const rootInstructions = withRealTime(spec, state, dimension);
  auditAsked(id, { instructions: rootInstructions, state, tree: listed, dimension });
  // The body's physics only (body_way, shot_answer): the rule that answers
  // when Jev cannot, at once (safetyRule in define).
  const rule = typeof spec.safetyRule === 'function' ? (children, path) => spec.safetyRule(children, path, context) : null;
  // A question whose last answers were thrown away because its facts changed
  // while it was out (note 749): 25585's upkeep, asked at every step of a
  // staircase, came back "Discarded changed-state decision" 23 times in a
  // minute and a half, one every 2.5 seconds. From the second such answer in
  // a row it is watched a moment first; its facts changing meanwhile, it is
  // not sent, and comes back stale for the step to ask when they hold still.
  const staleRun = bot?._staleRun?.[id];
  if (staleRun && staleRun.n >= STALE_RUN && Date.now() - staleRun.at < STALE_WINDOW_MS && !aside) {
    const t0 = Date.now();
    let changing = false;
    while (Date.now() - t0 < STALE_WATCH_MS) {
      await new Promise(r => setTimeout(r, Math.min(250, STALE_WATCH_MS)));
      task?.check(); if (bot && watchAir) checkAir(bot); interrupt();
      if (!isFresh()) { changing = true; break; }
    }
    if (changing) {
      staleRun.notSent = (staleRun.notSent || 0) + 1;
      console.log(`[stale] ${id}: its last ${staleRun.n} answers were thrown away as its facts changed while out, and they are changing still: not sent`);
      return { id, stale: true, notSent: `its last ${staleRun.n} answers were thrown away as its facts changed while it was out, and they were changing still` };
    }
  }
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
  // The tests' stand-in (test/support/jev-stand-in.js), where no client was
  // given: its answers are declared in the test harness. In play there is
  // no stand-in, and no client is Jev not reachable.
  const standIn = !client ? STAND_IN.current : null;
  if (standIn) {
    decision = { ...standIn.decide(id, { tree, context, state, spec }), standIn: true };
  } else {
    const asked = client || NO_CLIENT;
    const controller = new AbortController();
    const watcher = setInterval(() => {
      // When the watcher last looked: a check starved would show here.
      trace.lookedMs = Math.round(performance.now() - trace.t0);
      try { task?.check(); if (bot && watchAir) checkAir(bot); interrupt(); }
      catch (err) { if (!controller.signal.aborted) { stage(trace, 'stopped', { why: String(err?.message || err).slice(0, 100) }); controller.abort(err); } }
    }, watchMs);
    const stopThinking = spec.thinking && bot ? require('../speech').thinking(bot) : () => {};
    // Jev down (jev-down.js): no answer is made by code. The asker holds,
    // the question is asked again with a backoff, the reflexes stop the hold
    // through the watcher above as they stop anything, and when Jev answers
    // again the question held comes back stale, to be asked fresh.
    let outage = null;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          decision = await endsWhenStopped(decideTree(asked, { state, tree, signal: controller.signal, kind: spec.kind, rootInstructions, isFresh, trace }), controller.signal, trace);
          break;
        } catch (err) {
          if (controller.signal.aborted || !jevDown.unreachable(err)) throw err;
          if (rule) { decision = { ...walk(tree, rule), safetyRule: { reason: String(err.message || err).slice(0, 200) } }; console.log(`[jev down] ${id}: ${decision.path.join('/')} by the body's safety rule (${decision.safetyRule.reason})`); break; }
          outage = jevDown.down(bot, goal, id, err, { aside });
          if (process.env.NODE_TEST_CONTEXT && attempt >= jevDown.TEST_ASKS) { jevDown.testHeld.push(id); throw new Error(`${id} held ${attempt} times for Jev under the test runner: give the test a client or the stand-in`); }
          stage(trace, 'held', { attempt });
          await jevDown.pause(attempt, controller.signal);
        }
      }
    } finally { clearInterval(watcher); stopThinking(); }
    const tookMs = performance.now() - trace.t0;
    if (tookMs >= SLOW_MS && !outage) console.log(`[question] ${id} answered in ${(tookMs / 1000).toFixed(1)}s: ${saysStages(trace)}`);
    if (!decision.safetyRule) jevDown.back(bot, goal, id);
    // Held through an outage: the facts it was built from are old. Not acted
    // on; its caller asks it again from where the bot is now.
    if (outage) decision = { stale: true, jevWasDown: { since: new Date(outage.since).toISOString(), heldMs: Math.round(tookMs) }, usage: decision.usage };
    task?.check(); if (bot && watchAir) checkAir(bot); interrupt();
    // The gate: a judgment below the question's threshold is not acted on
    // as asked; the caller has its own low-confidence path.
    const low = !decision.stale && !decision.safetyRule && spec.gate && (decision.judgments || []).find(j => (j.confidence ?? 1) < spec.gate.threshold);
    if (low) decision.gated = { branch: low.branch, confidence: low.confidence, threshold: spec.gate.threshold, below: spec.gate.below };
    if (!decision.stale && decision.path?.[0] === NONE_GOOD_KEY) decision = noneGood(id, decision, listed, { bot, goal, state, last: lastLeastBad });
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
  // Thrown away as stale, an answer that keeps on with what is under way is
  // kept (note 749): what changed the facts is the work it keeps on with.
  if (decision.stale && !decision.jevWasDown && decision.staleAnswer?.choice && require('../intention').KEEP.test(decision.staleAnswer.choice) && tree[decision.staleAnswer.choice] && !tree[decision.staleAnswer.choice].children) {
    const k = decision.staleAnswer.choice;
    decision = { ...decision, stale: false, path: [k], action: tree[k], judgments: [{ branch: 'branch_0', ...decision.staleAnswer }], keptThroughChange: true };
    console.log(`[stale] ${id}: ${k} kept though the facts changed while it was out: it keeps on with what changed them`);
  }
  if (bot && !decision.jevWasDown && !decision.notSent) {
    const runs = bot._staleRun ||= {};
    if (decision.stale) runs[id] = { n: (runs[id] && Date.now() - runs[id].at < STALE_WINDOW_MS ? runs[id].n : 0) + 1, at: Date.now() };
    else delete runs[id];
  }
  decision.id = id;
  if (tracked && !decision.stale && decision.path) repeats.after(bot, id, print, decision.path.join('/'), { goal });
  if (tracked && !decision.stale && decision.path) unchanged.after(bot, id, { choice: decision.path.join('/'), digest, run: changedNothing?.run || 0 });
  if (bot && goal && GAMEPLAY_AREAS.has(spec.area) && !decision.stale && decision.path) {
    const weights = decision.judgments?.[0]?.probabilities || {};
    loops.after(bot, id, { choice: decision.path.join('/'), noneGoodTop: decision.noneGood || Object.entries(weights).sort((a, b) => b[1] - a[1])[0]?.[0] === NONE_GOOD_KEY });
  }
  if (bot && client && !decision.stale && decision.path && GAMEPLAY_AREAS.has(spec.area)) leastBad.after(bot, goal, id, original, decision, lastLeastBad);
  if (bot && client && ledgered) leastBad.chosenAfter(bot, goal, id, original, decision, lastChosen);
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
  // The least bad is not Jev's choice, and a walk taken as one begins no
  // intention (note 693): abandoning a walk costs only the time spent, and
  // its own yield measure already ends it once it gains nothing (note 699),
  // so nether_gather's leg_west or fortress_leg's back_to_ground taken none
  // good still is not held, and note 693's churn is unchanged. A stand taken
  // as the least bad is not so cheap to abandon: it has already put down
  // real, harder-to-redo progress (a portal frame's obsidian, a wait at a
  // found spawner), and the very next, unrelated question undoing it costs
  // the same whether Jev was confident or not (note 714). 25590 chose
  // cast_at_lava none good at 0.22 (none_good on top at 0.48), and because
  // that stand began no intention, surface_trip's climb nine seconds later
  // was never withheld by portal_method's own WAYS entry and undid it,
  // leaving a 6-of-ten frame for one with none cast, thirty blocks from the
  // lava (note 722). A stand still holds when it is the least bad; only a
  // walk does not.
  if (ledgered && !decision.stale && decision.path) require('../intention').after(bot, goal, id, decision.path, { target: decision.action?.target || target, state, chosen: !decision.noneGood || !require('../intention').WALKS.test(decision.path.at(-1)) });
  if (ledgered && !decision.stale && decision.path) require('../plan-chain').note(bot, goal, id, decision.path);
  if (bot && !decision.stale && decision.path) bot._lastDecision = { id, choice: decision.path.at(-1), at: Date.now() };
  if (!decision.stale && decision.action?.valid && !decision.action.valid()) decision.stale = true;
  stage(trace, 'recorded');
  if (client) decision.stages = trace.stages;
  if (goal) {
    goal.decisions ||= [];
    goal.decisions.push({ at: new Date().toISOString(), askedAt, id, kind: spec.kind, path: decision.path, ...(dimension ? { dimension } : {}), state, options: JSON.parse(JSON.stringify(tree)),
      ...(client ? { stages: trace.stages } : {}),
      latencyMs: decision.latencyMs, usage: decision.usage, judgments: decision.judgments, asked: decision.asked, model: client?.model,
      stale: decision.stale, ...(decision.jevWasDown ? { jevWasDown: decision.jevWasDown } : {}), ...(decision.safetyRule ? { safetyRule: decision.safetyRule } : {}), ...(decision.standIn ? { standIn: true } : {}), gated: decision.gated, ...(decision.noneGood ? { noneGood: true } : {}), ...(decision.passedOver ? { passedOver: decision.passedOver } : {}) });
    goal.decisions = goal.decisions.slice(-40); save();
    // The flight records it now. Its frame used to wait for the next step's
    // report, after the chosen stance had run, and read as seconds of
    // waiting for Jev: mid-229-s's dig_down, answered in 0.2 seconds at
    // 23:36:43.9, was framed at 23:36:49 with the digging and its 5 health
    // lost between (note 530).
    if (bot && typeof bot.emit === 'function') { try { bot.emit('jev_decision', goal); } catch (_) { /* the record only */ } }
  }
  // The body seen to first, chosen: done here, and the question comes back
  // stale for its caller to ask again from where the bot is then.
  const bodyKey = decision.path?.[0];
  if (bodyFirst && !decision.stale && bodyFirst.tree[bodyKey]) {
    let ran = false;
    try { ran = !!(await bodyFirst.tree[bodyKey].run()); }
    catch (err) { task?.check?.(); if (['NeedsAir', 'Cancelled'].includes(err?.name)) throw err; ran = false; }
    console.log(`[low health] ${id}: ${bodyKey} ${ran ? 'done' : 'did nothing'} before the question is asked again`);
    return { ...decision, stale: true, bodyFirst: { key: bodyKey, ran } };
  }
  return decision;
}
// The questions that are the body's own, not the work's (note 752c).
const BODY_QUESTIONS = new Set(['turn_priority', 'survival_priority', 'shelter_method', 'pocket_next', 'body_way', 'unstuck_move', 'way_down', 'climb_out']);

// Batched questions (intake and the rest): each defined question builds its
// typed question from the caller's arguments, and they go in one call. The
// answers are read with confident(), which applies each question's own bar.
// `questions` is { key: [id, args] }; a falsy entry is left out, so a
// speculative question is included with a condition in place.
// `hold` ({ bot, goal, task }), for a question about playing the game: Jev
// not reachable, nothing is decided by code: the asker holds as decide()
// does (jev-down.js), the task's check stopping the hold, and asks again;
// when Jev answers after an outage the answer is not used (its facts are
// old) and { stale: true, answers: {} } comes back, for the caller to ask
// fresh. `timeoutMs` is then each try's own bound, a try that runs past it
// being Jev not answering. Without `hold` an outage is thrown to the caller
// (a player's request, which tells the player).
async function ask(client, { questions, state, signal, kind, hold = null, timeoutMs = 0 }) {
  const entries = Object.entries(questions).filter(([, entry]) => entry);
  if (!entries.length) throw new Error('No questions to ask');
  const specs = entries.map(([key, [id]]) => [key, question(id)]);
  const built = Object.fromEntries(entries.map(([key, [id, args]]) => [key, question(id).build(args || {})]));
  const send = () => (client || NO_CLIENT).systemOne({ kind: kind || specs[0][1].kind, state, questions: built,
    signal: timeoutMs ? (signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)) : signal });
  if (!hold) return send();
  const ids = entries.map(([, [id]]) => id).join('+');
  let outage = null;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await send();
      jevDown.back(hold.bot, hold.goal, ids);
      if (outage) return { stale: true, answers: {}, usage: response.usage, jevWasDown: { since: new Date(outage.since).toISOString() } };
      return response;
    } catch (err) {
      if (signal?.aborted || !jevDown.unreachable(err)) throw err;
      outage = jevDown.down(hold.bot, hold.goal, ids, err);
      if (process.env.NODE_TEST_CONTEXT && attempt >= jevDown.TEST_ASKS) { jevDown.testHeld.push(ids); throw new Error(`${ids} held ${attempt} times for Jev under the test runner`); }
      await jevDown.pauseChecked(attempt, () => { hold.task?.check?.(); signal?.throwIfAborted(); });
    }
  }
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

module.exports = { pickWhenNoneGood, EXPOSED_S, escalate, withRealTime, ownInstructions, stateFor, WAIT_ANSWERS, parentOf, recentDeaths, define, question, decide, endsWhenStopped, walk, ask, confident, all, decideTree, firstOption, useStandIn, SAFETY_RULED, NONE_GOOD_KEY };

// The area modules register their questions when this directory is loaded.
require('./survival'); require('./work'); require('./combat'); require('./travel'); require('./intake');
require('./build'); require('./dream'); require('./command');

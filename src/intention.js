'use strict';
// One committed intention at a time (note 689).
//
// Several loops ask questions about what the work does next (fortress_leg,
// fortress_approach, fortress_visit, nether_gather, leave_nether, the food
// questions), each on its own pass, and an answer that takes time was
// replaced by the next loop's question within seconds: "A fortress! I'm
// heading for it" and "Leaving this fortress for now" in the same second, a
// walk to the portal turned round by nether_gather, go_in then keep_searching
// a second apart. Of 4,391 such answers in the flight records of 2026-09-29
// from 12:00Z to 21:20Z, another question's answer replaced 805 (18%) within
// thirty seconds with nothing failed in between (scripts/overridden.js).
//
// Here the answer that takes time (a walk to a place, a trip, a hunt, a stand
// at a spawner) is the bot's intention: what, where, when, and why, said in
// chat as it starts. It ends by its own end: arrived, the dimension changed,
// its answer settled as done or come to nothing in the ledger (tried.js), the
// ways below it all resting (an escalation), a death, or ten minutes gone
// without any of those. Health lost since it began (a blow's worth or more)
// is a real change: it ends there, and the question asking sees why.
// While it holds, a question about the plan (GATED) is asked with it said and
// without the options that would replace it: the ways toward it (walk_route,
// cross_level, go_in, a hoglin hunt for the food chosen) stay, leaving it
// (keep_searching, leave_fortress, without) and going elsewhere do not. A
// question with nothing that serves it ends it, "nothing it offers serves
// it", and is asked whole. The stall's and the rung's questions, upkeep and
// every survival question are asked as always: a stall is a real change, and
// the survival layer's turn comes before any intention and hands it back.

// The answers that start an action that takes time, by question.
const TIMED = {
  fortress_leg: /^(back_to_fortress|leg_\w+|floor_\w+|go_to_blazes(_about)?|go_to_spawner(_\d+)?|wait_at_spawner|stay_in_fortress|unwalked_\d+|fetch_stems|return_for_blocks|restock_blocks|back_to_ground|seek_fortress_height|blocks_then_cross|pillar_up|blocks_then_pillar)$/,
  fortress_visit: /^(go_in|go_back|heal_first|get_food_here|hoglin_hunt)$/,
  fortress_approach: /^(walk_route|cross_level|tunnel|blocks_then_cross|pillar_up|blocks_then_pillar|dig_through|descend|fetch_stems|cover_lava|scoop_lava|span_round|return_for_blocks)$/,
  nether_gather: /^(leg_\w+|cross_to_\d+|walk_to_\d+|floor_to_\d+|wood_in_view|portal_trip)$/,
  nether_food_kit: /^(restock_food|return_for_food)$/,
  leave_nether: /^(go_back|restock_food)$/,
  restock_food: /^(hoglin_\w+|cook_meat|mushroom_stew|return_for_food)$/,
  empty_spawner: /^(stand_by_spawner|heal_first)$/,
  portal_way: /^(climb_here|around_\w+)$/,
  stillness_detour: /^(return_for_food|restock_food|explore|cross_toward|floor_toward|pillar_up|blocks_then_pillar|fetch_stems|mine_nearby|night_mine|cook_food|stock_wood|pearls_\w+)$/,
  rung_progress: /^(fetch_stems|cross_toward|floor_toward|pillar_up|blocks_then_pillar|restock_food|return_for_food|pearls_\w+)$/,
  // Upkeep's fetch too (note 703): 25589 chose it at 00:05:38Z, a wither
  // skeleton's preemption cut it a tenth of a second in, and the work came
  // back to the fortress leg with nothing held; the stems were never fetched.
  upkeep: /^fetch_stems$/,
};
// An errand is the same errand whichever question offers it: the fetch
// chosen at upkeep is carried on by fortress_leg's or the approach's
// fetch_stems (note 703).
const ERRANDS = /^(fetch_stems|return_for_blocks|return_for_food|restock_food|restock_blocks)$/;
// The questions about the plan that are not asked to replace an intention.
const GATED = new Set(['fortress_leg', 'fortress_approach', 'fortress_visit', 'nether_gather', 'leave_nether', 'nether_food_kit', 'restock_food', 'empty_spawner', 'portal_way', 'bastion_raid']);
// Asked at a real change (a stall, ten minutes without a new best), whatever
// is under way: a timed answer of theirs replaces it.
const AT_A_CHANGE = new Set(['stillness_detour', 'rung_progress']);
// Answers that keep on with what is under way.
const KEEP = /^(carry_on|keep_on|go_on|keep_at_it|continue_request|search_on|wait_here)$/;
// Answers that leave what is under way: chosen, it ends.
const DROP = /^(keep_searching|leave_fortress|without|set_aside_rung|other_way)$/;
// A question asked as the way of an intention: its answers carry it on,
// but for those that leave it.
const WAYS = [
  { q: 'fortress_approach', of: /^(fortress_leg\/(back_to_fortress|go_to_blazes(_about)?|go_to_spawner(_\d+)?|unwalked_\d+|wait_at_spawner|stay_in_fortress)|fortress_visit\/(go_in|heal_first))$/, drops: /^keep_searching$/ },
  { q: 'fortress_visit', of: /^fortress_leg\/(back_to_fortress|go_to_blazes(_about)?|go_to_spawner(_\d+)?|unwalked_\d+)$/, drops: /^(leave_fortress|go_back|get_food_here|hoglin_hunt)$/ },
  { q: 'empty_spawner', of: /^fortress_leg\/(go_to_spawner(_\d+)?|wait_at_spawner)$/, drops: /^$/ },
  { q: 'restock_food', of: /^(nether_food_kit|leave_nether|stillness_detour|rung_progress)\/restock_food$|^fortress_visit\/get_food_here$/, drops: /^$/ },
  // A gathering is asked for what the step under way needs (wood for the
  // pickaxe its stair wants, stems): the means of whatever holds, and after
  // it the intention goes on. 25591's walk back to the portal was turned
  // round by nether_gather's legs and its without (note 678).
  { q: 'nether_gather', of: /./, drops: /^without$/ },
];
const NEAR = 16;          // a target this near the intention's serves it
const ARRIVED = 4;
const MAX_MS = 10 * 60000;
const HURT = 4;           // health lost since it began: a real change
const SAID_MS = 60000;
// Its yield (note 699): the rung's measure (rung-measure.js: what the rung is
// for, new columns of the Nether looked over, a new nearest to the fortress,
// blazes, a cage, the portal) and its own target, read at every look. A walk
// three minutes without a new best on any of them ends there, said as that,
// and the answer is marked come to nothing so its question is asked again
// with it said. 25583 walked 2,532 blocks in 77 minutes and ended 32 from
// where it began; nothing it was under measured what the walking brought.
// Only the walks: a wait by a spawner, a heal or a cook yields nothing by
// this measure while it does what it is for.
const YIELD_MS = 3 * 60000;
const WALKS = /^(leg_\w+|floor_\w+|back_to_fortress|go_to_blazes(_about)?|go_to_spawner(_\d+)?|unwalked_\d+|walk_route|cross_level|cross_to_\d+|walk_to_\d+|floor_to_\d+|wood_in_view|go_in|go_back|return_for_\w+|portal_trip|explore|cross_toward|floor_toward|back_to_ground)$/;

const P = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) } : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const words = s => String(s || '').replaceAll('_', ' ');
const ago = ms => { const s = Math.max(1, Math.round(ms / 1000)); return s < 90 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.round(s / 60)} minutes`; };
const dim = bot => String(bot?.game?.dimension || '').replace(/^minecraft:/, '');

const committing = (q, choice) => !!TIMED[q]?.test(String(choice || ''));
const wayOf = (q, i) => i ? WAYS.find(w => w.q === q && w.of.test(`${i.q}/${i.choice}`)) || null : null;

// A trip back through the portal is a walk to it: the nearest portal known in
// this dimension, else the one come through worked out from the other side.
const THROUGH_PORTAL = /^(go_back|return_for_\w+|portal_trip)$/;
function portalBack(bot, goal) {
  const here = bot?.entity?.position, d = dim(bot).replace(/^the_/, '');
  if (!here || !d) return null;
  const flat = p => Math.hypot(p.x - here.x, p.z - here.z);
  const known = (goal?.portals || []).filter(p => p.dimension === d && Number.isFinite(p.x)).sort((a, b) => flat(a) - flat(b))[0];
  if (known) return P(known);
  try { return d === 'nether' ? P(require('./game-progress').cameThrough(goal, here)) : null; } catch (_) { return null; }
}

// What the bot says as it starts, by answer; null stays quiet (the legs say
// their own "I'm looking for a fortress (leg 7)").
const SAYS = [
  [/^fortress_leg\/back_to_fortress$/, 'Going back to the fortress', 'rods'],
  [/^fortress_leg\/go_to_blazes(_about)?$/, 'Going to where blazes were seen', 'rods'],
  [/^fortress_leg\/go_to_spawner(_\d+)?$/, 'Going back to the spawner', 'rods'],
  [/^fortress_leg\/wait_at_spawner$/, 'Waiting by the spawner for blazes', 'rods'],
  [/^fortress_leg\/stay_in_fortress$/, 'Staying in the fortress for blazes', 'rods'],
  [/^fortress_leg\/unwalked_\d+$/, 'Crossing to a part of the fortress not yet walked', 'rods'],
  [/^fortress_leg\/seek_fortress_height$/, 'Digging to the height fortresses stand at', null],
  [/^(fortress_leg|fortress_approach)\/(restock_blocks|blocks_then_cross)$/, 'Digging netherrack for blocks to build with', 'blocks'],
  [/\/blocks_then_pillar$/, 'Digging blocks to pillar up to the fortress', 'blocks'],
  [/^(fortress_leg|stillness_detour|rung_progress)\/pillar_up$/, 'Pillaring up to the fortress floor', 'rods'],
  [/^(fortress_leg|fortress_approach)\/return_for_blocks$/, 'Going back through the portal for', 'kit'],
  [/^fortress_leg\/back_to_ground$/, 'Walking back to the rock last stood on for blocks', 'blocks'],
  [/\/fetch_stems$/, 'Fetching stems for a pickaxe', 'pickaxe'],
  [/^fortress_visit\/go_in$/, 'Going into the fortress', 'rods'],
  [/^fortress_visit\/heal_first$/, 'Healing before going into the fortress', 'health'],
  [/^(fortress_visit|leave_nether)\/go_back$|\/return_for_food$/, 'Going back through the portal for food', 'food'],
  [/\/(restock_food|get_food_here)$/, 'Getting food here first', 'food'],
  [/^(restock_food|fortress_visit)\/hoglin_\w+$/, 'Hunting a hoglin for food', 'food'],
  [/^restock_food\/cook_meat$/, 'Cooking the raw meat carried', 'food'],
  [/^nether_gather\/portal_trip$/, 'Going back through the portal for wood', 'pickaxe'],
  [/^nether_gather\/(walk_to|cross_to|floor_to)_\d+$|^nether_gather\/wood_in_view$/, 'Going for', 'for'],
  [/^empty_spawner\/stand_by_spawner$/, 'Standing by the spawner for blazes', 'rods'],
];
function whySays(bot, goal, kind, state) {
  try {
    if (kind === 'rods' && goal?.kind === 'win') { const n = require('./eye-need').need(bot, goal); return n.rodsLeft ? `${n.rodsLeft} more rod${n.rodsLeft === 1 ? '' : 's'} needed` : null; }
    if (kind === 'food' && Number.isFinite(bot?.food)) return `hunger ${bot.food}, health ${Math.round(bot.health ?? 0)}`;
    if (kind === 'health' && Number.isFinite(bot?.health)) return `health ${Math.round(bot.health)}`;
    if (kind === 'pickaxe') return (bot?.inventory?.items?.() || []).some(i => /_pickaxe$/.test(i.name)) ? null : 'no pickaxe carried';
    if (kind === 'blocks') { const n = require('./bridging').blocksCarried(bot); return Number.isFinite(n) ? `${n} blocks carried` : null; }
    if (kind === 'kit') { const bs = require('./block-stock'), n = require('./bridging').blocksCarried(bot); return `${bs.pickaxeCarried(bot) ? 'a pickaxe' : 'no pickaxe'}, ${n} blocks carried`; }
  } catch (_) { /* said without why */ }
  return null;
}
// What the trip home is for, as its option says it (block-stock.js kitLacks).
function kitSays(bot) {
  try { const bs = require('./block-stock'); return bs.listSays(bs.kitLacks(bot)); } catch (_) { return 'a pickaxe and blocks'; }
}
function startSays(bot, goal, i, state) {
  const row = SAYS.find(([re]) => re.test(`${i.q}/${i.choice}`));
  if (!row) return null;
  const at = i.target ? ` at (${i.target.x}, ${i.target.y}, ${i.target.z})` : '';
  // Fed, food got now is a stock-up, said so (note 702's words): 25584 said
  // "Getting food here first: hunger 20, health 20" (note 708).
  const fed = row[1] === 'Getting food here first' && (bot?.food ?? 0) >= 18;
  const what = row[2] === 'for' ? `${row[1]} ${state?.for ? `what a ${words(state.for)} needs` : 'what is needed'}` : row[2] === 'kit' ? `${row[1]} ${kitSays(bot)}` : fed ? 'Stocking up on food here first' : row[1];
  const why = row[2] === 'for' ? null : whySays(bot, goal, row[2], state);
  return `${what}${at}${why ? `: ${why}` : ''}.`;
}

// What the intention has brought: the rung's parts, and the distance to its
// own target, as rung-measure.js parts ({ key: { v, what } }).
function yieldParts(bot, goal, i) {
  let parts = {};
  try {
    const tried = require('./tried'), rung = tried.rungOf(goal);
    parts = (rung && tried.measureOf(bot, goal, rung)) || {};
  } catch (_) { parts = {}; }
  // The step's own target is the step's, which changes under a walk: the
  // intention's target stands for it.
  parts = Object.fromEntries(Object.entries(parts).filter(([k]) => !/^step:/.test(k)));
  const here = bot?.entity?.position;
  if (i.target && here) parts.target = { v: Math.round(dist(here, i.target) * 10) / 10, what: 'its target' };
  return parts;
}
const valuesOf = parts => Object.fromEntries(Object.entries(parts).map(([k, x]) => [k, x.v]));
// Brought up to date at each look: a part better than its best so far (by
// the measure's own tolerances) is a gain, and the clock starts again.
function yieldLook(bot, goal, i, now) {
  if (!bot?.entity?.position) return i.yield || null;
  const RM = require('./rung-measure');
  const parts = yieldParts(bot, goal, i), v = valuesOf(parts), here = P(bot.entity.position);
  const y = i.yield ||= { best: v, from: here, gainAt: now, gains: 0 };
  const gain = RM.changed(y.best, v);
  for (const [k, x] of Object.entries(v)) {
    const b = y.best[k];
    y.best[k] = b === undefined ? x : RM.kindOf(k) === 'distance' ? Math.min(b, x) : Math.max(b, x);
  }
  if (gain) { y.gainAt = now; y.gains += 1; y.lastGain = gain; }
  y.net = y.from && here ? Math.round(dist(y.from, here)) : null;
  y.lookedAt = now;
  y.parts = parts;
  return y;
}
// What it has brought, in words, once a minute has passed without a gain:
// "nothing gained for 2 minutes, 4 blocks from where it began".
function yieldSays(i, now = Date.now()) {
  const y = i?.yield;
  if (!y || now - y.gainAt < 60000) return null;
  return `nothing gained for ${ago(now - y.gainAt)}${Number.isFinite(y.net) ? `, ${y.net} blocks from where it began` : ''}`;
}

// The intention in force, or null; one whose end has come is ended here and
// kept as goal.intentionEnded.
function holding(bot, goal, now = Date.now()) {
  const i = goal?.intention;
  if (!i) return null;
  const why = endOf(bot, goal, i, now);
  if (!why) return i;
  end(goal, why, now);
  return null;
}
function endOf(bot, goal, i, now) {
  if (now - i.at >= MAX_MS) return `lapsed: held ${ago(now - i.at)} without arriving, failing or finishing`;
  if (i.dimension && dim(bot) && dim(bot) !== i.dimension) return `ended: now in ${words(dim(bot).replace(/^the_/, ''))}`;
  const deaths = goal?.survival?.deaths || [];
  if (deaths.length && Date.parse(deaths.at(-1).at) > i.at) return 'ended by a death';
  const here = P(bot?.entity?.position);
  if (i.target && here && dist(here, i.target) <= ARRIVED) return 'arrived';
  if (Number.isFinite(i.health) && Number.isFinite(bot?.health) && bot.health <= i.health - HURT) return `a real change: health ${Math.round(i.health)} to ${Math.round(bot.health)} since it began`;
  const t = goal?.tried;
  const own = (t?.entries || []).find(e => e.q === i.q && e.method === i.path && e.at >= i.at - 1000);
  if (own && ['blocked', 'impossible'].includes(own.outcome)) return `failed: ${own.why || 'it came to nothing'}`;
  if (own?.outcome === 'done') return 'done';
  // The ways below it all resting, or its question's answer come to nothing
  // there: escalated.
  const up = (t?.escalations || []).find(e => e.at > i.at);
  if (up) return `failed: ${String(up.why || 'its ways came to nothing').slice(0, 160)}`;
  // A walk that has brought nothing for YIELD_MS (note 699).
  const y = yieldLook(bot, goal, i, now);
  if (y && WALKS.test(i.choice) && now - y.gainAt >= YIELD_MS) {
    const RM = require('./rung-measure');
    const nothing = RM.says(RM.judge({ before: y.best, parts: y.parts || {}, store: null }).nothing, y.net);
    return `no yield: ${ago(now - y.gainAt)} with ${nothing || 'nothing gained on the rung'}`;
  }
  return null;
}
function end(goal, why, now = Date.now()) {
  const i = goal?.intention;
  if (!i) return;
  goal.intentionEnded = { q: i.q, choice: i.choice, ...(i.target ? { target: i.target } : {}), at: i.at, endedAt: now, why: String(why).slice(0, 200) };
  delete goal.intention;
}

// As the facts say it, for a question asked while it holds.
function says(i, now = Date.now()) {
  const y = yieldSays(i, now);
  const walk = WALKS.test(i.choice) ? `, or walks ${Math.round(YIELD_MS / 60000)} minutes with nothing gained` : '';
  return `${words(i.choice)} (${words(i.q)}${i.target ? `, to (${i.target.x}, ${i.target.y}, ${i.target.z})` : ''}), chosen ${ago(now - i.at)} ago; it holds until it arrives, is done or fails${walk}${y ? `; ${y}` : ''}`;
}
const endedSays = (e, now = Date.now()) => e && now - e.endedAt < 2 * 60000 ? `${words(e.choice)} (${words(e.q)}) ended ${ago(now - e.endedAt)} ago: ${e.why}` : null;

// Whether an option of question q serves the intention i.
function serves(i, q, key, node, way = wayOf(q, i)) {
  if (KEEP.test(key) || key === 'none_good') return true;
  if (way) return !way.drops.test(key);
  if (q === i.q && key === i.choice) return true;
  if (key === i.choice && ERRANDS.test(key)) return true;
  const t = P(node?.target);
  return !!(t && i.target && dist(t, i.target) <= NEAR);
}

// Before a question is asked: the tree as it is offered while the intention
// holds, and what is said of it. -> { tree, underWay, withheld }
// JEV_INTENTION=0 turns the gate off (the tests of a question's own words
// whose stand-in answers leave what it had just chosen).
const off = () => process.env.JEV_INTENTION === '0';
function gate(bot, goal, q, tree, { now = Date.now() } = {}) {
  if (off()) return { tree, underWay: null, withheld: [], ended: null };
  const i = holding(bot, goal, now);
  const ended = endedSays(goal?.intentionEnded, now);
  const out = { tree, underWay: null, withheld: [], ended };
  if (!i || !(GATED.has(q) || AT_A_CHANGE.has(q))) return out;
  out.underWay = says(i, now);
  if (!GATED.has(q) || q === i.q) return out;
  const way = wayOf(q, i);
  const kept = Object.fromEntries(Object.entries(tree).filter(([k, n]) => serves(i, q, k, n, way)));
  const withheld = Object.keys(tree).filter(k => !Object.hasOwn(kept, k));
  if (!withheld.length) return out;
  if (!Object.keys(kept).filter(k => !KEEP.test(k) && k !== 'none_good').length && !way) {
    // Nothing on offer here carries it on: what it needs is something else.
    end(goal, `set down: ${words(q)} was asked and none of its options carries it on (${withheld.map(words).join(', ')})`, now);
    return { tree, underWay: null, withheld: [], ended: endedSays(goal.intentionEnded, now) };
  }
  if (!Object.keys(kept).length) return out;
  return { tree: kept, underWay: `${out.underWay}; not offered while it holds: ${withheld.map(words).join(', ')}`, withheld, ended };
}

// After an answer: a timed answer Jev chose is the intention, unless it is a way of the
// one in force; the chat says it as it starts.
// `chosen` false: the one way taken, not asked, is not Jev's choice and
// begins nothing; it is still a way of the one in force, or ends it.
function after(bot, goal, q, pathKeys, { target = null, now = Date.now(), state = null, chosen = true } = {}) {
  if (off() || !goal || !Array.isArray(pathKeys) || !pathKeys.length) return null;
  const choice = String(pathKeys.at(-1)), path = pathKeys.join('/');
  const i = holding(bot, goal, now);
  if (i && DROP.test(choice)) { end(goal, `dropped: Jev chose ${words(choice)} (${words(q)})`, now); return null; }
  if (i && q !== i.q && (wayOf(q, i) || !committing(q, choice) || (choice === i.choice && ERRANDS.test(choice)) || (P(target) && i.target && dist(P(target), i.target) <= NEAR))) {
    if (committing(q, choice)) { i.way = `${q}/${choice}`; i.wayAt = now; }
    return i;
  }
  if (!committing(q, choice) || !chosen) return i;
  if (i && i.q === q && i.path === path) { i.health = bot?.health ?? i.health; return i; }
  if (i) end(goal, `replaced: Jev chose ${words(choice)} (${words(q)})`, now);
  // A trip back through the portal in the Nether goes to the portal, not to
  // the question's own target: 25588's fortress_visit go_back said "Going
  // back through the portal for food at (-328, 73, -293)", the fortress's
  // floor, with the portal at (3, 42, 8) (note 705).
  const viaPortal = THROUGH_PORTAL.test(choice) && /nether/.test(dim(bot)) ? portalBack(bot, goal) : null;
  const to = viaPortal || P(target) || (THROUGH_PORTAL.test(choice) ? portalBack(bot, goal) : null);
  const next = { q, choice, path, at: now, ...(to ? { target: to } : {}), dimension: dim(bot) || null, health: Number.isFinite(bot?.health) ? bot.health : null, ...(Number.isFinite(bot?.food) ? { food: bot.food } : {}) };
  goal.intention = next;
  yieldLook(bot, goal, next, now);
  const line = startSays(bot, goal, next, state);
  const said = bot ? (bot._intentionSaid ||= {}) : {};
  if (line && typeof bot?.chat === 'function' && !(said.line === line && now - said.at < SAID_MS)) { said.line = line; said.at = now; try { bot.chat(line); } catch (_) { /* said in the record */ } }
  if (line) next.says = line;
  return next;
}

// The watch's look (stillness.js, every few seconds): a walk that ended for
// want of yield is not left running until a question comes; its answer is
// marked come to nothing and its question asked again, the stall thrown to
// the work so the walk stops. -> the stall raised, or null
const WATCH_MS = 5000;
function yieldWatch(bot, goal, now = Date.now()) {
  const i = goal?.intention;
  if (off() || !i || !WALKS.test(i.choice) || now - (i.yield?.lookedAt || 0) < WATCH_MS) return null;
  if (holding(bot, goal, now)) return null;
  const e = goal.intentionEnded;
  if (!e || e.endedAt !== now || !/^no yield/.test(e.why)) return null;
  const why = `${words(e.choice)} (${words(e.q)}) ended, ${e.why}`;
  try {
    const tried = require('./tried'), own = (goal.tried?.entries || []).filter(x => x.q === e.q && x.at >= e.at - 1000).at(-1) || tried.latestOf(goal, e.q, now);
    if (own) { if (own.outcome === 'pending') own.outcome = 'blocked'; tried.markBlocked(own, why, now); }
  } catch (_) { /* the ledger has none */ }
  console.log(`[intention] ${why}`);
  try { return require('./stillness').raiseFor(bot, goal, why, now, { escalated: { from: 'intention', to: e.q, says: why } }); } catch (_) { return null; }
}

module.exports = { ERRANDS, yieldWatch, yieldSays, YIELD_MS, WALKS, wayOf, DROP, committing, holding, gate, after, end, serves, says, startSays, TIMED, GATED, AT_A_CHANGE, KEEP, WAYS, MAX_MS, NEAR, ARRIVED, HURT };

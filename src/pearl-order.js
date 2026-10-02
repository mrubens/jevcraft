'use strict';
// The pearls beside the rods, in the Nether (note 788). The ladder took the
// rods first by rule and the pearls only once seven rods were carried or
// the rods rested (game-progress.js nextGameStage). In the trials of
// 2026-09-26 to 2026-10-01 the bot never carried a pearl (932 flight
// records, 296 bot-hours; 1,521 trial verdicts): ten trials ever carried
// seven rods' worth, the pearl rung held the turn in 22 records and every
// time with the rods resting, and on the rods' way 155 endermen came within
// sixteen blocks in the Nether, warped forests were found in 71 of 204
// Nether records and gold to throw was carried with a piglin within 32 for
// 67 minutes, none of it ever put to Jev as a way to the pearls. The order
// was a hidden rule; the routes the trip passes are Jev's to weigh.
//
// pearl_order is asked in the Nether on the game ladder, the rods the step
// in hand and short, the pearls short, when a way to the pearls is real from
// here: an enderman within 24 blocks, a warped forest known within 512 whose
// walk is not resting (and its hunt not resting), or gold to throw with a
// piglin within 32 (bartering.js barterReady). Each way is said with its
// record (pearl-record.js: the trials, the arena, the measured barter and
// this run's own), and with what it shares with the rods' trip: the
// fortress's distance from here and from the forest, the rods carried and
// wanted, the gold carried and its pearls at nine ingots a pearl.
//
// The answer is held half an hour. A pearl way held is the step while it
// stays real (the enderman in view within 48, the forest open, the barter
// ready); when it is no longer real the ladder goes on with the rods. It is
// asked again only when a named fact changes: a kind of way real now that
// was not offered at the answer, a death since, or the half hour run out.
//
// In the Overworld, on the way to the Nether for the rods, the same
// question with the one way real there, an enderman within 24 (note 790).
// The enderman's fight is priced as the hunt fights it: struck first while
// it is calm, the shield raised between swings (combat-estimate.js).
const { isSetAside } = require('./progress');
const record = require('./pearl-record');

const HOLD_MS = 30 * 60000, NONE_GOOD_MS = 5 * 60000;
const ENDERMAN_REACH = 24, HUNT_SIGHT = 48, FOREST_REACH = 512;
const KIND = { hunt_enderman: 'enderman', warped_forest: 'forest', barter_gold: 'barter' };
const PICKS = new Set(['rods_first', ...Object.keys(KIND)]);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const count = (bot, name) => (bot.inventory?.items?.() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));
const inOverworld = bot => /overworld/.test(String(bot?.game?.dimension || ''));
const dimensionOf = bot => inNether(bot) ? 'nether' : inOverworld(bot) ? 'overworld' : 'other';
const tripKey = l => `${l.kind}:${l.x},${l.z}`;

function endermen(bot, reach) {
  const here = bot.entity?.position;
  if (!here) return [];
  return Object.values(bot.entities || {}).filter(e => e?.name === 'enderman' && e.isValid !== false && e.position)
    .map(e => ({ e, d: e.position.distanceTo(here) })).filter(x => x.d <= reach).sort((a, b) => a.d - b.d);
}

// The ways to the pearls real from here, by kind.
// In the Overworld, on the way to the Nether for the rods, the enderman in
// reach is the one way (note 790): 136 endermen came within sixteen blocks
// there in the trials, 87 minutes of them on reach_nether, and none was
// put to Jev.
function routes(bot, goal, now = Date.now()) {
  const out = {};
  if (!bot?.entity?.position || !(inNether(bot) || inOverworld(bot))) return out;
  const ender = endermen(bot, ENDERMAN_REACH);
  if (ender.length) out.enderman = { nearest: ender[0], count: ender.length };
  if (!inNether(bot)) return out;
  if (!isSetAside(goal, 'rung', 'warped_pearls', now)) {
    let known = [];
    try { known = require('./exploration').knownLandmarks(bot, goal, 'warped_forest', FOREST_REACH).filter(k => !isSetAside(goal, 'landmark_trip', tripKey(k.landmark), now)); } catch (_) { known = []; }
    if (known.length) out.forest = known[0];
  }
  const bartering = require('./bartering');
  if (bartering.barterReady(bot, goal)) out.barter = { gold: bartering.barterGold(bot) };
  return out;
}

const deathsSince = (goal, at, to = Infinity) => (goal?.survival?.deaths || []).filter(d => { const t = Date.parse(d.at); return t > at && t <= to; }).length;
// The answer held, or null once its half hour is out.
function held(goal, now = Date.now()) {
  const h = goal?.pearlOrder;
  if (!h || !PICKS.has(h.pick) || now >= h.until) return null;
  return h;
}

// Why it is asked again now, or null: nothing held, or a named fact changed.
function askAgainBecause(bot, goal, kinds, now = Date.now()) {
  const h = goal?.pearlOrder;
  if (!h) return 'not asked before';
  if (now >= h.until) return `the answer held (${h.pick.replaceAll('_', ' ')}, ${Math.round((now - h.at) / 60000)} minutes ago) has run its time`;
  if (deathsSince(goal, h.at, now)) return 'the bot has died since the answer';
  const fresh = kinds.filter(k => !(h.offered || []).includes(k));
  if (fresh.length) return `a way to the pearls that was not on offer at the answer is real now: ${fresh.map(k => ({ enderman: 'an enderman in reach', forest: 'a warped forest known and open', barter: 'gold to throw with a piglin in reach' })[k]).join(', ')}`;
  return null;
}

// The stage the ladder gives, the rods being the step and short and the
// pearls short in the Nether: the pearl way held while it is real, the
// question when it is due, or null (the rods).
function orderStage(bot, goal, { count: want = 1, now = Date.now(), phase = 'obtain_blaze_rods' } = {}) {
  if (!(inNether(bot) || inOverworld(bot)) || goal?.kind !== 'win') return null;
  const r = routes(bot, goal, now), kinds = Object.keys(r);
  const h = held(goal, now);
  if (h && KIND[h.pick] && !h.ended) {
    const stage = stageFor(bot, goal, h.pick, r, want, now);
    if (stage) return stage;
    // No longer real from here: the ladder goes on with the rods, and the
    // answer stands as the order until a named fact changes.
    h.ended = { at: now, why: endedWhy(h.pick) };
  }
  if (!kinds.length) return null;
  const because = askAgainBecause(bot, goal, kinds, now);
  return because ? { phase, action: 'pearl_order', item: 'blaze_rod', because } : null;
}
const endedWhy = pick => ({ hunt_enderman: 'no enderman left within 48 blocks', warped_forest: 'the forest\'s walk or its hunt rests', barter_gold: 'no gold to throw or no piglin within 32' })[pick];

function stageFor(bot, goal, pick, r, want, now) {
  const base = { phase: 'obtain_ender_pearls', item: 'ender_pearl', via: 'pearl_order' };
  if (pick === 'hunt_enderman') return endermen(bot, HUNT_SIGHT).length ? { ...base, action: 'acquire', count: count(bot, 'ender_pearl') + 1 } : null;
  if (pick === 'warped_forest') return r.forest ? { ...base, action: 'warped_pearls', count: want } : null;
  if (pick === 'barter_gold') return r.barter ? { ...base, action: 'barter', count: want } : null;
  return null;
}

// What every way shares with the rods' trip.
function overlap(bot, goal, r) {
  const here = bot.entity.position;
  let fortress = null;
  try { fortress = require('./exploration').knownLandmarks(bot, goal, 'nether_fortress')[0] || null; } catch (_) { fortress = null; }
  const n = require('./eye-need').need(bot, goal);
  const gold = require('./bartering').barterGold(bot);
  let portal = null;
  try { portal = require('./game-progress').portalDistance(bot, goal); } catch (_) { portal = null; }
  const forestToFortress = r.forest && fortress ? Math.round(Math.hypot(r.forest.landmark.x - fortress.landmark.x, r.forest.landmark.z - fortress.landmark.z)) : null;
  return {
    rods: `${n.rods} carried of ${n.rodsWanted} wanted (${n.rodsLeft} still needed)`,
    pearls: `${n.pearls} carried of ${n.pearlsWanted} wanted (${n.pearlsLeft} still needed); every pearl got in the Nether is one the Overworld's night hunt need not find, and each eye takes a pearl and half a rod`,
    fortress: fortress ? `a fortress known ${fortress.distance} blocks off at (${fortress.landmark.x}, ${fortress.landmark.z})${forestToFortress != null ? `, ${forestToFortress} blocks from the warped forest known` : ''}` : 'no fortress known yet: the rods\' step is searching for one',
    gold: gold.total ? `gold for ${plural(gold.total, 'ingot')} carried, ${gold.throwable} to throw once a gold piece is worn (${gold.dressed ? 'one is worn or carried' : 'golden boots take four first'}): about ${Math.floor(gold.throwable / record.BARTER.perPearl * 10) / 10} pearls at the measured nine ingots a pearl` : 'no gold carried',
    portalBack: portal != null ? `the portal back ${portal} blocks off` : 'no portal back known',
  };
}

function fightSays(bot, n) {
  try {
    const { fightEstimate } = require('./combat-estimate');
    const { defenseWeapon } = require('./combat');
    const armour = [5, 6, 7, 8].map(s => bot.inventory?.slots?.[s]?.name).filter(Boolean);
    const weapon = defenseWeapon(bot)?.name || null, health = bot.health ?? 20;
    // As the hunt fights it: calm until its first blow, the shield raised
    // between swings (combat-estimate.js `calm`, `guarded`; note 790).
    const shield = bot.inventory?.slots?.[45]?.name === 'shield';
    const e = fightEstimate({ threats: [{ name: 'enderman', distance: 4, visible: true, calm: true }], armour, weapon, health, shield, guarded: true });
    const h = e.fightHere, r = x => Math.round(x * 10) / 10;
    return `One enderman fought with ${weapon ? `the ${weapon.replaceAll('_', ' ')}` : 'bare hands'}${shield ? ' and the shield raised between swings' : ', no shield'}, struck first while it is calm, by the game's numbers and the arena's rate: about ${r(h.seconds)} seconds and ${r(h.damageTaken)} damage, ${h.damageTaken >= h.healthNow ? 'more than the health there is' : `leaving about ${r(h.healthAfter)} of ${r(h.healthNow)} health`}; about half drop a pearl${n > 1 ? `; ${n} are within ${ENDERMAN_REACH} blocks (the arena's forest drills are the record of fighting among several)` : ''}.`;
  } catch (_) { return 'no fight figure (the estimate could not be worked out).'; }
}

function tree(bot, goal, r, now = Date.now()) {
  const o = overlap(bot, goal, r), out = {};
  out.rods_first = { ladderNext: true, description: inNether(bot)
    ? `Go on with the rods, the ladder's order: ${o.fortress}; rods ${o.rods}. The pearls come after the rods (or while they rest): a warped forest's endermen, a barter, or the Overworld's night hunt. ${record.routeSays('rods_first', goal)}`
    : `Go on to the Nether for the rods, the ladder's order: rods ${o.rods}. The pearls come after the rods (or while they rest): a warped forest's endermen, a barter, or the Overworld's night hunt. ${record.routeSays('rods_first', goal)}` };
  if (r.enderman) {
    const e = r.enderman.nearest.e, p = e.position;
    out.hunt_enderman = { target: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) },
      description: `Hunt the enderman ${Math.round(r.enderman.nearest.d)} blocks off now, struck with the sword and never looked in the eye (a sword's blow does not make it teleport; an arrow does), about half drop a pearl: held while an enderman is within ${HUNT_SIGHT} blocks, then the rods again. ${fightSays(bot, r.enderman.count)} ${record.routeSays('hunt_enderman', goal)} Pearls ${o.pearls}.` };
  }
  if (r.forest) {
    const l = r.forest.landmark;
    let pace = '';
    try { pace = require('./game-progress').netherPaceSays(bot, r.forest.distance).says; } catch (_) { pace = ''; }
    out.warped_forest = { target: { x: l.x, y: Number.isFinite(l.y) ? l.y : Math.round(bot.entity.position.y), z: l.z },
      description: `Go to the warped forest at (${l.x}, ${l.z}), ${r.forest.distance} blocks off, and hunt its endermen one at a time for the pearls; ${o.fortress}. Held while the forest's walk and hunt do not rest (a hunt fifteen minutes without a pearl rests it), then the rods again.${pace} ${record.routeSays('warped_forest', goal)} Pearls ${o.pearls}.` };
  }
  if (r.barter) {
    out.barter_gold = { description: `Barter with the piglins in reach now: ${o.gold}. A piglin turns on a player in no gold, so a gold piece is worn first. Held while gold is left to throw and a piglin is within 32, then the rods again. ${record.routeSays('barter_gold', goal)} Pearls ${o.pearls}.` };
  }
  return { tree: out, overlap: o };
}

// Asked, and the answer held. Returns the pick, or null when the question
// came back stale (asked again at the next pass).
async function ask(bot, task, goal, save, actions = {}, { now = Date.now() } = {}) {
  const r = routes(bot, goal, now), kinds = Object.keys(r);
  const because = askAgainBecause(bot, goal, kinds, now);
  const { tree: options, overlap: shared } = tree(bot, goal, r, now);
  const prev = goal.pearlOrder;
  if (prev) record.settle(goal, prev, { pearls: count(bot, 'ender_pearl'), deaths: deathsSince(goal, prev.at, now), now });
  const state = { dimension: dimensionOf(bot), askedBecause: because || 'not asked before', ...shared, health: Math.round((bot.health ?? 20) * 10) / 10, hunger: bot.food ?? 20,
    holds: 'the answer holds half an hour; a pearl way is the step while it stays real from here, the rods again after; asked again when a way not on offer now becomes real, after a death, or when the half hour is out' };
  // The rods carried asked on their own first (rod-bank.js askBank, note
  // 871), here too (note 894): a pearl way holds half an hour, and 25593
  // (mid-243-mc-fortress-2, 2026-10-02 12:08 to 14:25Z) stalked endermen
  // through three such holds with one and then two rods in its pack, never
  // asked, and died walking home with them at 5 health.
  if (/nether/.test(String(bot.game?.dimension || ''))) {
    let banked = null;
    try { banked = await require('./rod-bank').askBank(bot, task, goal, save, actions, actions.client || task.opportunityClient, { now }); }
    catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; banked = null; }
    if (banked === 'banked') return null;
  }
  const decision = await require('./decisions').decide('pearl_order', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree: options, state,
    target: options.warped_forest?.target || options.hunt_enderman?.target || null });
  if (decision.stale) return null;
  // None good: the least bad taken (decisions/index.js noneGood), held five
  // minutes, not half an hour.
  const pick = decision.path.at(-1);
  const at = Date.now();
  goal.pearlOrder = { pick, at, until: at + (decision.noneGood ? NONE_GOOD_MS : HOLD_MS), ...(decision.noneGood ? { noneGood: true } : {}), offered: kinds, pearlsAt: count(bot, 'ender_pearl'), deathsAt: 0, because: because || null };
  if (KIND[pick]) bot.chat?.(({ hunt_enderman: 'An enderman in reach: its pearl first, the rods after.', warped_forest: 'To the warped forest for pearls, then the rods.', barter_gold: 'Bartering for pearls, then the rods.' })[pick]);
  save();
  return pick;
}

module.exports = { routes, held, askAgainBecause, orderStage, stageFor, overlap, tree, ask, HOLD_MS, NONE_GOOD_MS, ENDERMAN_REACH, HUNT_SIGHT, FOREST_REACH, KIND };

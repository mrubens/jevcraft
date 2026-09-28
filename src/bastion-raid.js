'use strict';
// A bastion's chests, Jev's to open or leave (note 636).
//
// The chests were a rule, not a question. looting.js opened a bastion's
// chests "whoever is looking" whenever the bot stood near one, and its
// header said the opposite (nothing in the Nether is opened); no trip was
// ever made for them, the idle trip leaves bastions out, and the one way to
// a bastion, the gold rung (bartering.js gatherBastionGold), took gold
// blocks no piglin could see and opened chests only if it happened to be
// near. Nobody had put to Jev what a bastion's chests are worth against what
// opening one does. Here the bot asks, once per trip, from the facts:
//   raid_chests  walk there, lift the lids, take the valuables, get out
//   gold_only    take the gold blocks no piglin can see, open no chest
//   leave_it     leave the bastion alone for thirty minutes
// and a bastion chest is opened only while a raid Jev chose is on
// (looting.js lootableChests reads raidOn). Nothing else about the chests'
// safety changes: the loot code's own guards (health, a mob that bites in
// sight), the survival layer's stances and the trip kit (trip-kit.js).
//
// What the numbers are. The loot tables and the piglin rules are from the
// 26.1.2 server jar (data/minecraft/loot_table/chests/bastion_*.json; the
// class PiglinAi, angerNearbyPiglins, called by ChestBlock with "only if
// they can see"), the fight figures from combat-estimate.js (also the jar).
// What is not known is said as not known: how many piglins, brutes and
// hoglins live in this bastion (their markers are in its jigsaw pieces, not
// a count), how many chests it has and which room each is in.
const { isSetAside, setAside } = require('./progress');

const REACH = 384;                     // as bastionKnown (bartering.js)
const HOLD_MS = 45 * 60000;            // a trip's answer holds this long
const LEAVE_MS = 30 * 60000;           // leave_it: the rung rests this long
const RAID_REACH = 40;                 // chests looked for round the bot in a raid
const LEG_SECONDS = 120, WALK = 4;     // goToLandmark's leg (exploration.js) at about four blocks a second
const LID_RADIUS = 16;                 // PiglinAi.angerNearbyPiglins inflates the player's box by 16
const BRUTE_SIGHT = 12;                // a brute's follow range (combat-estimate FOLLOW_RANGE)
const PEARL_INGOTS = 9;                // the measured barter rate (pearl-routes.js)
const KEY = l => `${l.kind}:${l.x},${l.z}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const inNether = bot => /nether/.test(String(bot.game?.dimension || ''));

// The played record, to the day it was read: no bastion chest has ever been
// opened by the bot, so there is no rate to say, good or bad.
const RECORD = { day: '2026-09-28', chestsOpened: 0, raids: 0 };

// What a chest holds, by room, from the jar's four tables: the pools' rolls
// and weights worked to the chance a chest holds one at least, and the gold
// it holds in ingots (a block is nine, a nugget a ninth). Chance is at the
// average rolls. Which room a chest is in is not known before it is opened
// (the treasure room is the big lava-lit hall at the bottom; a bridge's is
// a single chest on the walkway; a stable's is beside the hoglins).
const CHESTS = [
  { room: 'bridge (the walkway and its gate)', gold: 2.1, says: 'about 2 gold ingots\' worth (a block 11%, ingots 11%), a golden helmet, chestplate, leggings or boots each 11% (usually enchanted), a crossbow 11%, spectral arrows, gilded blackstone, crying obsidian; no food, no golden apple; the netherite upgrade template 1 chest in 10' },
  { room: 'housing units (the ordinary rooms)', gold: 2.6, says: 'about 2.6 gold ingots\' worth (a block 19%), a golden apple 10%, golden carrots 13% (six to seventeen), a cooked porkchop 24%, golden boots 18% and the other gold armor 10% each, a crossbow 16%, ancient debris 14%, netherite scrap 4.5%; the template 1 in 10' },
  { room: 'hoglin stable', gold: 4.5, says: 'about 4.5 gold ingots\' worth (a block, two to four, 16% of the time), a golden apple 10%, golden carrots 10% (eight to seventeen), porkchops (raw and cooked) 23% each, ancient debris 16%, netherite scrap 8%, a diamond pickaxe or shovel; the template 1 in 10' },
  { room: 'treasure room (the hall under the bastion, lava round it)', gold: 14.6, says: 'about 14.6 gold ingots\' worth (a block or more 34%, ingots 34%), an enchanted golden apple 5%, a netherite ingot 35%, netherite scrap 20%, ancient debris 32%, diamond gear (each piece 5 to 12% of the three rolls) and diamonds 13%; the netherite upgrade template in every treasure chest (the jar has no empty roll there)' },
];
const HOLDS = 'Jar tables, per chest: '
  + CHESTS.map(c => `${c.room}: ${c.says}`).join('. ');

// What a lid does, from the jar. ChestBlock calls PiglinAi.angerNearbyPiglins
// (level, player, true) when a chest is opened: every Piglin (the class, not
// the brute) within 16 blocks of the player that is idle and can see the player
// is angered at the player, whatever is worn (setAngerTarget looks at no
// armor). A piglin brute is not touched by the lid: it attacks any player it
// sees within 12 blocks on its own, gold or not.
const LID = `Lifting a lid turns every piglin within ${LID_RADIUS} blocks that can see the bot hostile, gold armor or not (the jar: ChestBlock calls PiglinAi.angerNearbyPiglins with only-if-they-can-see, no armor check); the ones that cannot see it stay calm. A piglin brute is not touched by the lid and is not calmed by gold: it attacks a player it sees within ${BRUTE_SIGHT} blocks anyway. Angry piglins hit with a sword or shoot a crossbow and stay angry for a while; hoglins are not calmed by gold either.`;

function rememberRaid(goal, entry) {
  const list = goal.bastionRaids ||= [];
  list.push(entry);
  if (list.length > 12) list.splice(0, list.length - 12);
  return entry;
}

// A raid whose bot has died since it began ended in that death, whatever
// else was noted: read lazily, wherever the raids are read.
function settle(goal, now = Date.now()) {
  const deaths = goal?.survival?.deaths || [];
  for (const r of goal?.bastionRaids || []) {
    if (r.outcome !== 'pending') continue;
    const death = deaths.find(d => Date.parse(d.at) >= r.at);
    if (death) { r.outcome = 'died'; r.endedAt = Date.parse(death.at); r.why = death.cause || 'died'; }
    else if (now - r.at > 2 * HOLD_MS) { r.outcome = 'nothing'; r.endedAt = now; r.why = 'never finished'; }
  }
  const held = goal?.bastionRaid;
  if (held && !held.ended && (goal?.bastionRaids || []).some(r => r.at === held.at && r.outcome === 'died')) held.ended = true;
}

// The raid Jev chose is on: a bastion's chests may be opened. Ended by the
// hold running out, the bot's death, or the raid closing (closeRaid).
function raidOn(goal, now = Date.now()) {
  const held = goal?.bastionRaid;
  if (!held || held.pick !== 'raid_chests' || held.ended || now - held.at > HOLD_MS) return false;
  settle(goal, now);
  return !held.ended;
}

// The trip's held answer, for this bastion, or null.
function heldFor(goal, landmark, now = Date.now()) {
  settle(goal, now);
  const h = goal?.bastionRaid;
  if (!h || h.ended || now - h.at > HOLD_MS) return null;
  return landmark && h.key && h.key !== KEY(landmark) ? null : h;
}

// The nearest bastion whose walk is not resting, from here, in the Nether.
function offer(bot, goal) {
  if (!bot?.entity?.position || !inNether(bot)) return null;
  let known = [];
  try { known = require('./exploration').knownLandmarks(bot, goal, 'bastion', REACH); } catch (_) { return null; }
  const open = known.filter(k => !isSetAside(goal, 'landmark_trip', KEY(k.landmark)));
  return open[0] || null;
}

const wornNames = bot => [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
const goldWorn = bot => wornNames(bot).some(n => /^golden_/.test(n));

// One mob kind fought as the game's numbers say (combat-estimate.js), at the
// health the bot has, in what it wears.
function fought(bot, threats) {
  try {
    const { fightEstimate } = require('./combat-estimate');
    const { defenseWeapon } = require('./combat');
    const weapon = defenseWeapon(bot)?.name || null, armour = wornNames(bot), health = bot.health ?? 20;
    const e = fightEstimate({ threats, armour, weapon, health, shield: bot.inventory?.slots?.[45]?.name === 'shield' });
    return { weapon, armour, health, e };
  } catch (_) { return null; }
}
function fightSays(bot, what, threats) {
  const f = fought(bot, threats);
  if (!f) return `${what}: no figure (the estimate could not be worked out)`;
  const { e, weapon } = f, one = e.mobs[0], h = e.fightHere;
  const left = round(h.healthAfter);
  const verdict = h.damageTaken >= h.healthNow ? `more than the ${round(h.healthNow)} health there is: dead before it is` : `leaving about ${left} of ${round(h.healthNow)} health`;
  const blow = one ? `, ${one.hitsBot} a blow through the armor worn${one.hitsBot >= h.healthNow ? ' (one blow ends the bot)' : ''}` : '';
  return `${what}, with ${weapon ? `the ${weapon.replaceAll('_', ' ')}` : 'bare hands'}: about ${round(h.seconds)} seconds and ${round(h.damageTaken)} damage${blow}, ${verdict}${e.fightHere.notCounted ? `; ${e.fightHere.notCounted}` : ''}`;
}

// The bastion's mobs in view now, by kind and nearest, from the entities
// loaded round the bot. Most of a bastion is out of range from a walk away.
function seenNow(bot, at, radius = 64) {
  const kinds = { piglin_brute: [], piglin: [], hoglin: [] };
  for (const e of Object.values(bot.entities || {})) {
    if (!kinds[e.name] || e.isValid === false || !e.position) continue;
    const d = e.position.distanceTo(bot.entity.position);
    if (d <= radius) kinds[e.name].push({ e, d });
  }
  for (const k of Object.values(kinds)) k.sort((a, b) => a.d - b.d);
  const words = { piglin_brute: 'piglin brute', piglin: 'piglin', hoglin: 'hoglin' };
  const parts = Object.entries(kinds).filter(([, v]) => v.length).map(([k, v]) => `${plural(v.length, words[k])} (nearest ${Math.round(v[0].d)} blocks off)`);
  return { kinds, says: parts.length ? `In view now within ${radius} blocks: ${parts.join(', ')}.` : `None in view now (the bastion is ${Math.round(at)} blocks off; what lives there is loaded only when the bot is near).` };
}

// Every fact the question is asked with, and the options' words.
function facts(bot, goal, o, now = Date.now()) {
  const l = o.landmark, here = bot.entity.position;
  const dy = Number.isFinite(l.y) ? Math.round(l.y - here.y) : 0;
  const legs = Math.max(1, Math.ceil(o.distance / (LEG_SECONDS * WALK)));
  const seen = seenNow(bot, o.distance);
  const sightings = [...seen.kinds.piglin_brute, ...seen.kinds.piglin, ...seen.kinds.hoglin].slice(0, 8);
  const threats = sightings.map(s => ({ name: s.e.name, distance: s.d, visible: true }));
  const gold = goldWorn(bot);
  const carriedFood = (() => { try { return require('./healing').foodCarried(bot).map(f => f.says); } catch (_) { return []; } })();
  const count = name => (bot.inventory?.items?.() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
  const ingots = count('gold_ingot') + count('gold_block') * 9 + Math.floor(count('gold_nugget') / 9);
  settle(goal, now);
  const past = (goal.bastionRaids || []).filter(r => r.key === KEY(l) || Math.hypot(r.x - l.x, r.z - l.z) < 64).slice(-3);
  const w = l.lastWalk;
  const state = {
    bastion: { at: { x: l.x, y: Number.isFinite(l.y) ? l.y : null, z: l.z }, blocksAway: o.distance, ...(dy ? { blocksUpOrDown: dy } : {}),
      route: `${plural(legs, 'leg')}: a trip walks one leg of at most ${LEG_SECONDS} seconds at a time (about ${WALK} blocks a second over Nether ground, so ${Math.round(o.distance / WALK)} seconds if the way is straight; broken ground and lava make it longer)`,
      ...(w ? { lastWalk: `the last walk there began ${w.began} blocks off and ended ${w.ended}${w.why ? `: ${w.why}` : ''}` } : { lastWalk: 'no walk there has been tried' }),
      ...(l.gold ? { goldSeenWhenFound: l.gold } : {}) },
    mobsThere: { inView: seen.says, count: 'not known: how many piglins, brutes and hoglins live in this bastion is not counted anywhere, only what is in view is. From the jar: the bastion\'s pieces put mobs on posts, each filled from a pool. An ordinary piglin post is a sword piglin 4 times in 10, a crossbow piglin 4 in 10, a piglin brute 1 in 10, empty 1 in 10; a melee post is a brute 6 times in 7 and a sword piglin the rest; the hoglin stables have hoglin posts. How many posts this bastion has is not known.' },
    wearing: wornNames(bot).length ? wornNames(bot).map(n => n.replaceAll('_', ' ')) : 'no armor',
    goldArmorWorn: gold ? 'yes: calms piglins that have not been angered, does nothing against a brute, a hoglin or a piglin the lid angered' : 'no: piglins in sight will attack a player not wearing gold, lid or no lid',
    health: round(bot.health ?? 20), hunger: bot.food ?? 20,
    foodCarried: carriedFood.length ? carriedFood : 'nothing to eat',
    lidLifted: LID,
    chestsHold: HOLDS,
    chestsHere: 'how many chests this bastion has, and which room each is in, is not known until they are seen; the treasure room is the one with lava round it and the most piglins about',
    fights: {
      oneBrute: fightSays(bot, 'One piglin brute at 8 blocks (50 health, golden axe)', [{ name: 'piglin_brute', distance: 8, visible: true }]),
      onePiglin: fightSays(bot, 'One angry piglin at 8 blocks (16 health, golden sword)', [{ name: 'piglin', distance: 8, visible: true }]),
      threePiglins: fightSays(bot, 'Three angry piglins at 8 blocks', [0, 1, 2].map(() => ({ name: 'piglin', distance: 8, visible: true }))),
      ...(threats.length ? { inView: fightSays(bot, `Everything in view now (${plural(threats.length, 'mob')})`, threats) } : { inView: 'nothing in view to price' }),
      bruteChase: (() => { try { const ce = require('./combat-estimate'); return `A brute runs ${round(ce.blocksPerSecond('piglin_brute'))} blocks a second, the bot sprinting ${round(ce.PLAYER_SPRINT)}, so one already close is not outrun; ${ce.GIVES_UP.piglin_brute}.`; } catch (_) { return 'not known'; } })(),
      note: 'from the 26.1.2 jar via combat-estimate.js, not measured on a bastion: the arena has no bastion drill, so these are the game\'s numbers and not a measurement of the bot in a bastion',
    },
    whatItHelps: `Gold: ${ingots ? `${plural(ingots, 'ingot')} of gold carried` : 'no gold carried'}; a barter is about ${PEARL_INGOTS} ingots a pearl (measured), so a hoglin stable's chest is about half a pearl, a bridge or housing chest a fifth to a quarter, a treasure chest about one and a half. Pearls carried: ${count('ender_pearl')}. Golden apples: ${count('golden_apple')} carried (a golden apple gives regeneration for a few seconds and absorption hearts; only the enchanted one adds fire resistance, and the treasure room alone holds one, at about 5% a chest). Netherite upgrade template: one in ten ordinary chests, every treasure chest; the diamond gear and netherite ingots it takes are in the treasure room too.`,
    record: { bastionChestsOpenedByTheBotEver: 'none: not yet tried (no bastion chest has been opened by the bot in any trial to ' + RECORD.day + '), so there is no success rate to say, not even a bad one', thisRun: past.length ? past.map(r => `${r.outcome}${r.why ? ` (${r.why})` : ''}${r.took && Object.keys(r.took).length ? `, took ${Object.entries(r.took).map(([n, c]) => `${c} ${n.replaceAll('_', ' ')}`).join(', ')}` : ''}, ${Math.max(1, Math.round((now - r.at) / 60000))} minutes ago`) : 'no raid on a bastion chosen before in this run' },
    guard: 'the loot code opens no chest under 10 health or with a mob that bites in sight within 16 blocks; a raid waits then, and the survival layer\'s stances answer whatever comes',
  };
  return { state, legs, dy, past };
}

function options(bot, goal, o, f) {
  const l = o.landmark, where = `(${l.x}, ${l.z})`;
  const at = `${o.distance} blocks off${f.dy ? ` and ${Math.abs(f.dy)} ${f.dy > 0 ? 'up' : 'down'}` : ''}, ${plural(f.legs, 'leg')}`;
  const tree = {
    raid_chests: { description: `Raid the chests of the bastion at ${where}, ${at}: walk there, open the nearest chest, take the gold, golden apples, food, armor and the rest of what the ladder uses (the loot list), and go on to the next while nothing that bites is in view within 16 blocks. Lifting a lid angers every piglin within 16 blocks that sees it, gold armor or not, and a brute attacks on sight within 12 anyway; what the chests hold, what the fights cost and what has been tried are in the state (${f.past.length ? `raids on this bastion before: ${f.state.record.thisRun.join('; ')}` : 'this has never been tried: no bastion chest has ever been opened by the bot'}).`, target: { x: l.x, y: Number.isFinite(l.y) ? l.y : Math.round(bot.entity.position.y), z: l.z } },
    gold_only: { description: `Go to the bastion at ${where}, ${at}, and take only the gold blocks and gilded blackstone that no piglin is within 16 blocks of, one block a visit, opening no chest: a gold block is nine ingots (one pearl's worth by the measured barter), and piglins that cannot see the mining are not angered. Nothing the chests hold (golden apples, food, armor, the template) is taken. This is what the gold rung did before chests were a question.`, target: { x: l.x, y: Number.isFinite(l.y) ? l.y : Math.round(bot.entity.position.y), z: l.z } },
    leave_it: { description: `Leave the bastion at ${where} alone for thirty minutes and go on with the ladder's next step or another way to the pearls (a warped forest, the Overworld's endermen, a barter with piglins in view).` },
  };
  return tree;
}

// Asked once per trip and held: the answer is what the bastion trip does.
// Returns 'raid_chests', 'gold_only' or 'leave_it'; null when a question was
// begun and is stale (the caller returns and the loop asks again).
async function chooseTrip(bot, task, goal, save, actions = {}, now = Date.now()) {
  const o = offer(bot, goal);
  if (!o) return 'gold_only';        // no bastion to ask about: the caller's own "none remembered"
  const held = heldFor(goal, o.landmark, now);
  if (held) return held.pick;
  const f = facts(bot, goal, o, now);
  const tree = options(bot, goal, o, f);
  const decision = await require('./decisions').decide('bastion_raid', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree,
    state: f.state, target: tree.raid_chests.target });
  if (decision.stale) return null;
  const pick = decision.path.at(-1);
  const key = KEY(o.landmark);
  goal.bastionRaid = { key, pick, at: now, asked: true, ...(decision.noneGood ? { noneGood: true } : {}) };
  rememberRaid(goal, { key, x: o.landmark.x, z: o.landmark.z, at: now, pick, outcome: pick === 'leave_it' ? 'declined' : 'pending', distance: o.distance, health: round(bot.health ?? 20), goldWorn: goldWorn(bot) });
  if (pick === 'leave_it') { setAside(goal, 'rung', 'bastion_gold', 'Jev chose to leave the bastion alone', LEAVE_MS); goal.bastionRaid.ended = true; }
  save();
  return pick;
}

// A raid ends: what it took, or that it came to nothing. Called when no
// chest is left to open at the bastion (or none could be reached); the
// record is kept for the next time the question is asked.
function closeRaid(goal, { now = Date.now() } = {}) {
  const held = goal.bastionRaid;
  if (!held || held.pick !== 'raid_chests' || held.ended) return null;
  const took = {}; let opened = 0;
  for (const rec of Object.values(goal.looted || {})) {
    if (rec.structure !== 'bastion' || rec.at < held.at) continue;
    opened++;
    for (const [n, c] of Object.entries(rec.took || {})) took[n] = (took[n] || 0) + c;
  }
  const entry = (goal.bastionRaids || []).find(r => r.at === held.at);
  if (entry && entry.outcome === 'pending') Object.assign(entry, { outcome: opened ? 'looted' : 'nothing', endedAt: now, opened, took, ...(opened ? {} : { why: 'no chest was reached' }) });
  // The trip goes on as the gold's, the answer held: not asked again for the
  // same bastion, and the chests shut to the code again (raidOn).
  held.pick = 'gold_only'; held.raided = true;
  return entry || null;
}

module.exports = { RECORD, CHESTS, HOLDS, LID, REACH, RAID_REACH, HOLD_MS, offer, facts, options, chooseTrip, raidOn, heldFor, closeRaid, settle, rememberRaid, goldWorn, seenNow };

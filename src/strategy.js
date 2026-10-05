'use strict';
// Strategy on the way to the dragon: of the things open now, which next.
const { Vec3 } = require('vec3');
// The ladder's order is the code's answer when Jev cannot be reached, and
// nothing in the wording favours it. What Jev weighs is what the order
// cannot see: that the ruined portal's chest two hundred blocks off holds
// the gold the golden-boots rung is digging for, that the diamond sword is
// worth more today than the bow, that the levels in hand should go on the
// sword before the next fight.
//
// On offer, all of them already checked feasible, as a short tree:
//   the rungs open now (game-progress.js openRungs): the ladder's next,
//     and each one after it the ladder may reach while those before it
//     wait. Pickaxes may not wait, so they are never skipped.
//   the Nether now, when every rung left may wait.
//   side_trip, one branch holding the trips off the way to the pearls:
//     loot, trade, explore, travel, animals, a bed to carry, the home base,
//     copper armour, the expeditions, smelting, enchanting, a cache. Each
//     says what it buys and what it takes, on the branch's own question.
//     Twenty of them beside the rungs in one list was the question the
//     critical review of 2026-09-26 found Jev answering.
//
// The choice holds: asked when the ladder's next rung changes, when the
// top-level choices change (a trip coming into view among the others does
// not), or after ten minutes, and not at every step. A side trip runs once
// and rests ten minutes (thirty if it failed), so the answer after it is
// asked again with the trip done.
const { DAY } = require('./day');
const { openRungs, dimension, carryBedRung } = require('./game-progress');
const { woolCarried, homeStage, bedCarried } = require('./home-base');
const { setAside, isSetAside, attemptsFor } = require('./progress');
const { immediateThreat } = require('./danger');

const WALK_BLOCKS_PER_S = 4;
const LATER = new Set(['acquire', 'enter_nether', 'find_stronghold', 'trade', 'barter', 'pearl_patrol']);
const HOLD_MS = 10 * 60 * 1000, SIDE_REST_MS = 10 * 60 * 1000, SIDE_FAIL_MS = 30 * 60 * 1000;
// The answers that are going to the Nether (note 764): held as one.
const TO_THE_NETHER = /^(nether_first|stage_reach_nether)$/;
const fatal = err => ['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name);
const label = phase => phase.replaceAll('_', ' ');
const { spoken, Spoken } = require('./spoken');

const RUNG_WHY = {
  // What a night costs without one, said where the bed is weighed: nights
  // were sixty-two of mid-211-o's hundred and eighty minutes and the most of
  // mid-230-o's (notes 428, 449; the Fable advice).
  bed: 'a night slept passes in seconds, where one spent awake is about eight and a half real minutes from bedtime (eleven from dusk) sealed in or night-mining, and a Minecraft day is twenty real minutes, so an hour of play has three nights; it also sets the spawn point; three wool from sheep or crafted from spiders\' string (four string a wool), or a bed from a village',
  iron_pickaxe: 'mines the iron for armour and the diamonds past it',
  iron_armour: 'a helmet, chestplate, leggings and boots, twenty-four ingots in all; worn, they take about half off a mob\'s hit and an eighth off a creeper\'s blast',
  copper_armour: 'a helmet, chestplate, leggings and boots of copper, twenty-four copper ingots (copper ore is common in caves near the surface, two to five raw copper a block); worn, ten armour points: a zombie\'s hit of three comes down to two, an arrow of four to under three, until the iron armour replaces it',
  // What a home is for, said with its steps: offered as "get home site"
  // and nothing more beside options that each said what they were worth,
  // trial 72 put it off to its last half hour.
  home_site: 'the base\'s place, picked beside water on flat ground: the bed, a chest and a plot go there, and each trip starts and ends at it',
  home_level: 'the base\'s ground made level so the bed, the chest and the plot fit',
  home_stash: 'a chest at the base: what is left in it does not drop on a death',
  home_bed: 'the bed placed at the base and slept in: the spawn point is home, and each night there passes in seconds',
  home_water: 'the pond that waters the plot',
  home_plot: 'wheat for bread, tomorrow\'s food',
  home_pen: 'cows kept for steak and leather',
  shield: 'blocks arrows and creeper blasts; the fights ahead are easier behind one',
  leather_armour: 'a leather piece from the leather carried, worn at once while the iron is to come: a chestplate takes about an eighth off a mob\'s blow, the four pieces about a quarter; two thirds of the deaths of 2026-10-05 were with no armour on',
  fishing_rod: 'food from any water, standing still on the bank: in the record of 2026-10-05 the bot\'s 13 fishing sessions caught 64 cod and salmon in 33 minutes (about ten food points a minute cooked), where its food errands, hunting and searching, made about 0.3 a minute; three sticks and two string, the string a spider\'s drop',
  iron_sword: 'kills faster than stone',
  bucket: 'water for lava, falls and the End portal room',
  golden_boots: 'a piglin leaves a player wearing any one gold armour piece alone in the Nether, save one the player struck (and those near it) for about 30 seconds; a brute ignores gold; four gold ingots at a crafting table',
  bow: 'answers skeletons, blazes and the dragon\'s crystals from range',
  arrows: 'the bow is nothing without them; here they come only from skeletons, none to two a skeleton, and are spent as they are shot (feathers for crafting come from chickens, which the bot never hurts)',
  diamond_sword: 'ends a blaze or a piglin in two swings',
  // The crossing's kit (crossing-kit.js kitRungs, note 673).
  nether_pickaxe: 'a spare pickaxe for the Nether',
  nether_blocks: 'blocks for bridging and pillaring in the Nether',
  nether_food: 'food carried for the Nether stay',
  nether_chest: 'a chest to keep the blaze rods in through a death in the Nether',
  // The rods got so far banked past the portal (rod-bank.js, note 760).
  bank_rods: 'a chest on the Overworld side for the blaze rods got so far, kept through a death while the bot goes back for the rest',
  // The rest of the ladder, said as the others are (the decision audit,
  // 2026-09-25).
  stone_pickaxe: 'mines stone, coal and iron ore; a wooden one mines only stone and coal, and slowly',
  stone_sword: 'five damage a swing against a fist\'s one: a zombie in four swings, not twenty punches',
  furnace: 'smelts ore into ingots and cooks raw meat; eight cobblestone',
  torches: 'light where monsters would spawn: a lit tunnel or home stays clear at night',
  obtain_ender_pearls: 'ender pearls and blaze powder make the eyes that find the stronghold and fill the End portal',
  pearl_patrol: 'endermen drop the pearls; they come out on the surface at night and are fought with a sword, not stared at',
};
// What going on without the step costs, where it is simple to say.
const WITHOUT = {
  stone_pickaxe: 'no stone, coal or iron can be mined',
  stone_sword: 'every fight is with bare hands',
  bed: 'each night is spent awake, walled in or fighting, about eight and a half to eleven real minutes a night and three nights to an hour of play, and a death respawns at the world spawn',
  iron_pickaxe: 'no diamond, gold or redstone can be mined',
  shield: 'every arrow and every creeper blast lands in full',
  iron_armour: 'every hit lands on what is worn now',
  bucket: 'there is no water for fire, lava or a fall',
  // Priced by the record (scripts/piglin-gold.js, note 773).
  golden_boots: 'every piglin in the Nether goes for the bot on sight (141 piglin hits on the bots in the Nether from 06:00Z on 2026-09-30 to 01:10Z the next day, none with gold worn; 658 stance questions with a piglin among the threats, 4 with gold worn, and 5 deaths within fifteen seconds of a piglin\'s hit)',
  bow: 'shooters are answered only by closing on them',
  arrows: 'the bow cannot shoot',
  home_bed: 'a death respawns far from home',
  nether_pickaxe: 'a pickaxe worn out in the Nether is made again only from what is carried',
  nether_blocks: 'a bridge or a pillar stops where the blocks run out, and netherrack there is mined for more',
  nether_food: 'the Nether is entered with the food carried; going back through the portal is the other way to more',
  nether_chest: 'every rod carried is lost with a death (none of 122 Nether entries since 2026-09-29 carried a chest, note 760); a chest is made there only from wood carried or the Nether\'s stems',
};
// Where each ore lies, said with a step that mines it.
const ORE_DEPTH = { coal: [0, 95, 95], iron: [-24, 56, 16], copper: [-16, 112, 48], gold: [-64, 32, -16], redstone: [-64, 15, -59], lapis: [-64, 64, 0], diamond: [-64, 16, -59], emerald: [-16, 256, 100] };
const oreOf = name => (/^(?:raw_)?(?:deepslate_)?(coal|iron|copper|gold|redstone|lapis|diamond|emerald)(?:_ore|_lazuli)?$/.exec(String(name || '')) || [])[1];
function oreFacts(bot, goal, steps) {
  const kinds = [...new Set(steps.filter(st => st.action === 'mine').map(st => oreOf(st.item || st.block)).filter(Boolean))];
  const y = Math.floor(bot.entity?.position?.y ?? 64);
  return kinds.map(kind => {
    const [from, to, most] = ORE_DEPTH[kind];
    const names = [`${kind}_ore`, `deepslate_${kind}_ore`];
    let known = null;
    try { known = require('./resource-observation').knownResourceLocations(bot, goal, names)[0]; } catch (_) { /* no memory */ }
    const where = y > to ? `${y - most} blocks below here` : y < from ? `${most - y} blocks above here` : 'here, at this depth';
    return ` ${kind[0].toUpperCase()}${kind.slice(1)} ore lies between y ${from} and ${to}, most around y ${most}: ${where}${known ? `; some was seen ${Math.round(known.distanceTo(bot.entity.position))} blocks away` : ''}.`;
  }).join('');
}

// How a search for the rung is going, said with it: minutes alone did not
// tell Jev that no sheep had been seen in five hundred blocks.
function searchSoFar(bot, goal, rung) {
  const search = rung.action === 'gather_wool' && goal.woolSearch;
  if (!search) return '';
  // Not a search left off over half an hour ago (note 450).
  if (Date.now() - (search.lastAt || search.since) > 30 * 60000) return '';
  const minutes = Math.round((Date.now() - search.since) / 60000);
  const blocks = Math.round(Math.hypot(bot.entity.position.x - search.from.x, bot.entity.position.z - search.from.z));
  const flocks = require('./sightings').sighted(bot, goal, 'sheep');
  // Without sheep, the other ways, as they stand: trial 113 was offered
  // "none seen yet" forty-three minutes running in snow, chose every other
  // step instead, and never had a bed.
  const string = (bot.inventory?.items?.() || []).filter(i => i.name === 'string').reduce((n, i) => n + i.count, 0);
  const igloo = require('./exploration').knownLandmarks(bot, goal, 'igloo').find(l => l.landmark.beds > 0);
  const others = flocks.length ? '' : ` Without sheep: ${string} string carried of the twelve a bed's wool takes (spiders drop up to two each and come out at night; cobwebs cut with a sword drop one)${igloo ? `, and an igloo with a bed ${igloo.distance} blocks away` : ''}.`;
  return ` Searching for sheep for ${minutes} minute${minutes === 1 ? '' : 's'}, ${blocks} blocks from where the search began, ${flocks.length ? `and ${flocks.slice(0, 2).map(s => s.says).join('; ')}` : 'none seen yet'}.${others}`;
}
// The way to the wool, said with the bed rung whether or not a search has
// begun (note 644). Six of the 23 deaths before the Nether in 2026-09-28's
// fresh worlds (62 midgame trials from first-days saves) were inside the bed
// rung's wool hunt, five of them hunts begun below y 40: the saves that had no
// bed put the bot 60 blocks under a dawn surface, and "get bed" said what a
// bed is worth, not that the sheep were at the top of a climb through the
// caves, how far off they were, or that none had been seen. The 29 hunts
// begun below y 40 ended in a death five times and took 8.4 minutes on
// average; the 20 begun higher, once and 3.6 minutes (the ladder's bed step
// in the flight records, a stretch each). Said as it stands, beside
// nether_first, which goes without the bed and says what that costs; the
// probe of the recorded question (mid-244-aa, 72 blocks down at dawn) kept
// choosing the bed with it said, five of five: the facts are Jev's to weigh.
const WOOL_HUNTS = { day: '2026-09-28', worlds: 62, below: 40, deep: { n: 29, died: 5, minutes: 8.4 }, shallow: { n: 20, died: 1, minutes: 3.6 } };
function woolTrip(bot, goal, rung) {
  if (rung?.action !== 'gather_wool' || !bot?.entity?.position || !/overworld/.test(String(bot.game?.dimension || 'overworld'))) return '';
  const here = bot.entity.position;
  let depth = null;
  try { if (typeof bot.blockAt === 'function' && bot.registry) depth = require('./surface').climbToSurface(bot, here); } catch (_) { depth = null; }
  const inView = Object.values(bot.entities || {}).filter(e => e.name === 'sheep' && e.isValid !== false && e.position?.distanceTo?.(here) < 64)
    .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))[0];
  let flocks = [];
  try { flocks = require('./sightings').sighted(bot, goal || {}, 'sheep'); } catch (_) { flocks = []; }
  const climb = depth >= 8 ? require('./surface').climbMinutes(depth) : 0;
  const walkTo = blocks => `about ${Math.max(1, Math.round(blocks / WALK_BLOCKS_PER_S))} seconds at a walk`;
  const sheep = inView ? `Sheep are in view, ${Math.round(inView.position.distanceTo(here))} blocks off (${walkTo(inView.position.distanceTo(here))}).`
    : flocks[0] ? `Nearest sheep known: ${flocks[0].says} (${walkTo(flocks[0].distance)}${climb ? ', after the climb' : ''}).`
      : 'No sheep are in view or remembered: the hunt is a search over ground not yet seen.';
  const under = depth >= 8 ? ` The bot is about ${depth} blocks under open sky: the climb out is about ${climb} minute${climb === 1 ? '' : 's'} before any walk to sheep, through what the caves hold.` : '';
  let dark = '';
  const t = bot.time?.timeOfDay;
  if (Number.isFinite(t) && t >= DAY.DARK && t < DAY.DAWN) dark = ` It is night on the surface, about ${Math.round((DAY.DAWN - t) / 1200)} real minutes to dawn: sheep stand on open ground, where zombies, skeletons, spiders and creepers spawn until then.`;
  const { deep, shallow } = WOOL_HUNTS, y = Math.round(here.y), low = y < WOOL_HUNTS.below;
  const mine = low ? deep : shallow, other = low ? shallow : deep;
  const record = ` Wool hunts begun ${low ? 'below' : 'at or above'} y ${WOOL_HUNTS.below}, as this one is: ${mine.n} in ${WOOL_HUNTS.day}'s ${WOOL_HUNTS.worlds} fresh worlds, ${mine.died} ended in a death, ${mine.minutes} minutes each on average; begun ${low ? 'at or above' : 'below'} it: ${other.n}, ${other.died} ended in a death, ${other.minutes} minutes.`;
  return ` The way to the wool: ${sheep}${under}${dark}${record}`;
}
// What the step takes from the pockets as they are, when a planner is
// given: trial 43 carried sixty-one raw iron and two hundred coal, was
// offered the armour as "get 4 iron helmet" with nothing said of what it
// would take, and went looking for a bed.
function rungTakes(bot, goal, rung, planFor) {
  if (!planFor || !bot || !(rung.items || rung.item)) return '';
  // A set is planned as one batch against the one pair of pockets: planned
  // a piece at a time, trial 94's eleven raw iron covered each piece and the
  // four were offered as "no gathering" for twenty-four ingots.
  let steps;
  try { steps = [...(planFor(bot, rung.items ? rung.items.map(item => ({ item, count: 1 })) : rung.item, rung.count || 1, goal) || [])]; }
  catch (_) { return ''; }
  if (!steps.length) return '';
  const words = s => String(s || '').replaceAll('_', ' ');
  const gather = steps.filter(st => /mine|hunt|fill|explore/.test(st.action));
  const byAction = {};
  for (const st of steps) { const k = `${st.action} ${words(st.item || st.block || st.mob)}`; byAction[k] = (byAction[k] || 0) + (st.count || 1); }
  const list = Object.entries(byAction).map(([k, n]) => { const [action, ...rest] = k.split(' '); return `${action.replaceAll('_', ' ')} ${n} ${rest.join(' ')}`; }).join(', ');
  return ` From the pockets as they are it takes: ${list}${gather.length ? '' : ' (all of it from what is carried: no gathering)'}.${oreFacts(bot, goal, steps)}${pickaxeLeft(bot, planSpends(steps))}`;
}

// What a plan uses up, net: what its steps consume less what they make.
function planSpends(steps) {
  const net = {};
  for (const st of steps) {
    for (const [k, n] of Object.entries(st.consumes || {})) net[k] = (net[k] || 0) + n;
    for (const [k, n] of Object.entries(st.produces || {})) net[k] = (net[k] || 0) - n;
  }
  return Object.fromEntries(Object.entries(net).filter(([, n]) => n > 0));
}
// What spending wood, sticks or iron leaves for the next pickaxe, said with
// any option that spends them (the decision audit, from two midgame
// trials): mid-100-c spent its last three logs on a chest in a cave at
// y -16, and mid-87-a its twenty-four ingots and its sticks on armour; each
// pickaxe broke underground with nothing to make another, and each climbed
// out by hand for some forty minutes. Digging up by hand was measured in
// both at about five blocks in 2.3 minutes.
const HAND_BLOCKS_PER_MINUTE = 2;
function pickaxeLeft(bot, spends = {}) {
  const WOOD = /_log$|_stem$|_planks$|^stick$/, HEAD = /^(iron_ingot|cobblestone|cobbled_deepslate|blackstone)$/;
  if (!Object.keys(spends).some(k => WOOD.test(k) || k === 'iron_ingot') || !bot?.inventory?.items) return '';
  const stock = {};
  for (const i of bot.inventory.items()) stock[i.name] = (stock[i.name] || 0) + i.count;
  for (const [k, n] of Object.entries(spends)) stock[k] = Math.max(0, (stock[k] || 0) - n);
  const sum = re => Object.entries(stock).filter(([k]) => re.test(k)).reduce((n, [, c]) => n + c, 0);
  const logs = sum(/_log$|_stem$/), planks = sum(/_planks$/), sticks = stock.stick || 0, ingots = stock.iron_ingot || 0, cobble = sum(/^(cobblestone|cobbled_deepslate|blackstone)$/);
  const sticksOk = sticks >= 2 || planks >= 2 || logs >= 1, headOk = ingots >= 3 || cobble >= 3;
  const uses = i => (bot.registry?.itemsByName?.[i.name]?.maxDurability ?? Infinity) - (i.durabilityUsed || 0);
  const picks = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => `the ${i.name.replaceAll('_', ' ')} (${Number.isFinite(uses(i)) ? `${uses(i)} uses left` : 'uses unknown'})`);
  let depth = null;
  try { if (typeof bot.blockAt === 'function' && bot.entity?.position) depth = require('./surface').climbToSurface(bot, bot.entity.position); } catch (_) { depth = null; }
  const { WOOD_RESERVE } = require('./work');
  const wood = Math.floor((logs + planks / 4 + sticks / 8) * 10) / 10;
  const none = !sticksOk ? 'no sticks can be made' : !headOk ? 'no pickaxe head can be made (3 ingots or 3 cobblestone)' : '';
  return ` It leaves ${logs} logs, ${planks} planks, ${sticks} sticks and ${ingots} iron ingots (${wood} logs' worth of wood of the ${WOOD_RESERVE} kept for pickaxes and a table); a new pickaxe takes 2 sticks and 3 ingots or 3 cobblestone${none ? `, and ${none} from what is left` : ', and that is left'}. Pickaxes carried: ${picks.join(', ') || 'none'}.${depth >= 8 ? ` The bot is about ${depth} blocks under the surface${none ? `: when the last pickaxe breaks, none can be made down here, and the way up is dug by hand (${require('./hand-dig').handPaceSays(bot)}), about ${require('./hand-dig').handPace(bot).minutesUp(depth)} minutes by stairs` : ''}.` : ''}`;
}

// Where a home step is done, from where the bot is (the decision audit,
// mid-100-c): "a chest at the base" was chosen in a cave seventy blocks
// under home, the chest made there from the last logs.
function homeWhere(bot, goal, rung) {
  const home = goal?.survival?.home;
  if (!/^home_/.test(rung.phase) || rung.phase === 'home_site' || !home?.origin || !bot?.entity?.position) return '';
  let at = home.origin;
  try { if (rung.phase === 'home_stash') at = require('./home-base').layout(home).chest || at; } catch (_) { at = home.origin; }
  const here = bot.entity.position, d = Math.round(Math.hypot(at.x + 0.5 - here.x, at.y - here.y, at.z + 0.5 - here.z)), dy = Math.round(at.y - here.y), flat = Math.hypot(at.x + 0.5 - here.x, at.z + 0.5 - here.z);
  const made = rung.item ? ` The ${label(rung.item)} is made from the pockets where the bot stands, then carried there.` : '';
  return ` It is done at the base${rung.phase === 'home_stash' ? ', the chest going by the bed' : ''}: ${d} blocks from here${Math.abs(dy) >= 3 ? `, ${Math.abs(dy)} blocks ${dy > 0 ? 'up' : 'down'}` : ''}${flat > 6 ? `, about ${Math.round(flat / 4.3)} seconds at a walk${Math.abs(dy) >= 3 ? ' and the climb besides' : ''}` : ''}.${made}`;
}
function rungOption(rung, first, bot, goal, planFor = null) {
  const what = rung.kit ? RUNG_WHY[rung.phase] : rung.items?.length > 1 ? `${label(rung.phase)} (${rung.items.map(label).join(', ')})` : rung.item ? `${rung.count > 1 ? `${rung.count} ` : ''}${label(rung.item)}` : label(rung.phase);
  const piece = /^iron_(helmet|chestplate|leggings|boots)$/.test(rung.phase) ? 'iron_armour' : rung.phase;
  const why = rung.kit ? null : RUNG_WHY[rung.phase] || RUNG_WHY[piece];
  const clock = goal?.rungClocks?.[rung.phase];
  const spent = clock?.activeMs >= 60000 ? ` Worked on for ${Math.round(clock.activeMs / 60000)} minutes so far.` : '';
  const without = WITHOUT[piece] ? ` Until it is done, ${WITHOUT[piece]}.` : '';
  // Said alike whichever rung is first: "the ladder's next step" beside
  // "ahead of the ladder's order" was a thumb on the scale (the critical
  // review, 2026-09-26). The first is marked the ladder's next (ladderNext).
  const kit = rung.kit && bot ? require('./crossing-kit').kitRungSays(bot, goal || {}, rung) : '';
  // What this rung costs against the Nether, when the reach nether was set
  // aside to work on it: the same fact nether_first already says of itself,
  // said here too (note 746: 25594 chose rung_iron_leggings three times
  // after setting the reach nether aside "I keep getting stuck", never told
  // by this option that the Nether was the thing waiting on it).
  let netherCost = '';
  if (bot && goal && rung.phase !== 'reach_nether') { try { const s = require('./game-progress').rungAsideSays(goal, 'reach_nether'); if (s) netherCost = ` ${s}`; } catch (_) { netherCost = ''; } }
  // Its level from here and its record (note 763): a rung whose gathering
  // is at the surface said with the climb and what is owed below, and what
  // the trials that chose it spent on it and what the stays that had it
  // came to, the same facts the Nether now says of going without it.
  const level = bot && goal ? require('./levels').rungLevelSays(bot, goal, rung.phase) : '';
  const record = require('./kit-record').rungRecordSays(rung.phase, bot?.entity?.position?.y);
  return { description: `Get ${what}${why ? ` (${why})` : ''}.${kit}${rung.kit ? '' : spareSays(bot, goal, rung)}${bot && goal ? searchSoFar(bot, goal, rung) : ''}${bot && goal ? woolTrip(bot, goal, rung) : ''}${homeWhere(bot, goal, rung)}${rungTakes(bot, goal, rung, planFor)}${spent}${without}${level}${record}${netherCost}`, rung, ladderNext: first };
}
// A pickaxe rung with a pickaxe still carried is a spare: the ladder counts
// one under a fifth of its uses (or sixty-four) as worn, and said only
// "stone pickaxe", mid-220-h's rung read as the first pickaxe while its
// iron one had twelve uses 66 blocks down (note 543). What those uses
// cover, and what the pockets make, said with it.
// With none carried, the same facts: what the pockets make, the wood short
// and where wood is (mid-243-ga's rung said only the steps, note 671).
function spareSays(bot, goal, rung) {
  if (!bot?.inventory?.items || !/_pickaxe$/.test(rung.phase || '')) return '';
  let budget = null;
  try { budget = require('./pickaxe-budget').pickaxeBudget(bot, goal || {}); } catch (_) { budget = null; }
  if (!budget) return '';
  return budget.picks.length ? ` A spare: the ladder counts a pickaxe under a fifth of its uses (or 64) as worn. ${budget.says}` : ` ${budget.says}`;
}

// A second bed to carry, once the base's is claimed and none is in the
// pockets (game-progress.js carryBedRung). The six midgame trials of
// 2026-09-26 carried none after the home was built but one; the nights
// underground were pockets and night mines, and the climbs back up were a
// quarter of the trial time. What it buys and what it costs, with what is
// in hand toward it; Jev's to weigh against the ladder's next step.
function carryBedOption(bot, goal, planFor = null) {
  const rung = carryBedRung(bot, goal);
  if (!rung) return null;
  const items = bot.inventory?.items?.() || [];
  const have = re => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
  const wool = woolCarried(bot), string = have(/^string$/), planks = have(/_planks$/), logs = have(/_log$|_stem$/);
  let flocks = [];
  try { flocks = require('./sightings').sighted(bot, goal, 'sheep'); } catch (_) { flocks = []; }
  const sheep = Object.values(bot.entities || {}).filter(e => e.name === 'sheep' && e.isValid !== false && e.position?.distanceTo?.(bot.entity.position) < 48).length;
  const where = rung.action === 'village_bed' ? ` A bed can be taken from the ${rung.village?.kind === 'igloo' ? 'igloo' : 'village'} ${rung.distance} blocks away.`
    : rung.action === 'home' ? ' The chest at home holds what it takes.' : '';
  const inHand = ` In hand: ${wool.total} wool (${wool.dyed ? `mixed colours, dyed white with the bone or bone meal carried: the bed is a craft` : wool.count >= 3 ? `three ${wool.colour.replaceAll('_', ' ')}: the bed is a craft` : 'three of one colour make the bed; wool of mixed colours is dyed white, a bone\'s bone meal for three'}), ${string} string, ${planks} planks and ${logs} logs; ${sheep ? `${sheep} sheep in view` : flocks.length ? flocks[0].says : 'no sheep in view or remembered'}.`;
  return {
    description: `Make a second bed to carry, the base's staying where it is (three wool and three planks; wool from sheep, or crafted from spiders' string, four string a wool and twelve a bed). It buys any night on the Overworld, anywhere there (in the Nether or the End a bed set down explodes): put down where the night comes, slept in and picked back up, the night passes in seconds, instead of about eleven real minutes in a pocket or a night mine and the climb out after. A carried bed does not keep the spawn point; the base's does.${inHand}${where}${searchSoFar(bot, goal, rung)}${woolTrip(bot, goal, rung)}${rungTakes(bot, goal, rung, planFor)}`,
    says: 'I\'ll make a second bed to carry', rung,
  };
}

// The home base, one side trip with what it buys and what it takes (the
// critical review, 2026-09-26): its seven steps stood on the ladder ahead
// of the armour as "the walkthrough order every speedrunner keeps", and no
// speedrunner builds a base. None of it is on the way to the pearls. A base
// begun in an older world is offered the same way, from where it stopped;
// chosen, it holds like a rung, a step at a time (home-base.js homeStage).
const HOME_STEPS = {
  home_site: 'a site by water on flat ground', home_level: 'the ground levelled',
  home_stash: 'a chest by the bed (eight planks)', home_bed: 'the bed placed there and slept in (three wool and three planks, or the one carried)',
  home_water: 'a pond poured for the plot (a water bucket)', home_plot: 'a wheat plot tilled and sown (a hoe and seeds)', home_pen: 'a fenced pen for cows (fences and a gate)',
};
function homeOption(bot, goal, planFor = null) {
  let step;
  try { step = homeStage(bot, goal); } catch (_) { step = null; }
  if (!step || isSetAside(goal, 'rung', step.phase)) return null;
  const rung = { ...step, action: 'home', home: step };
  const home = goal.survival?.home;
  // What is left, read off the record: the plot and the pen are known only
  // by looking, so they are said as left until the base is finished.
  const done = { home_site: !!home, home_level: !!home && !(home.levelling > 0 && !home.levelledAt), home_stash: !!home?.stash?.position,
    home_bed: !!home?.bed?.claimedAt, home_water: !!home && !home.pourWater, home_plot: false, home_pen: false };
  const left = Object.keys(HOME_STEPS).filter(p => !done[p] || p === step.phase).map(p => HOME_STEPS[p]);
  const spent = Object.entries(goal.rungClocks || {}).filter(([p]) => p in HOME_STEPS).reduce((n, [, c]) => n + (c.activeMs || 0), 0);
  const bed = bedCarried(bot) && !done.home_bed ? ' The bed carried becomes the base\'s: nights away from it are spent without one until a second is made.' : '';
  const at = home?.origin ? `the base at ${home.origin.x}, ${home.origin.z}, begun; left, in order: ` : 'none yet; its steps, in order: ';
  return {
    description: `Work on a home base: ${at}${left.join('; ')}. What it buys: the bed there keeps the spawn point while the bot sleeps nowhere else, so a death respawns by the chest and not at the world spawn; what is left in the chest does not drop on a death; the plot is bread and the pen steak and leather, a known walk away. None of it is needed for the Nether, blaze rods or ender pearls.${bed} The step at hand: ${HOME_STEPS[step.phase] || label(step.phase)}.${searchSoFar(bot, goal, rung)}${homeWhere(bot, goal, rung)}${rungTakes(bot, goal, rung, planFor)} ${spent >= 60000 ? `Worked on for ${Math.round(spent / 60000)} minutes so far.` : 'Not worked on yet.'}`,
    says: home ? 'I\'ll work on the base' : 'I\'ll make a home base', rung, trip: true,
  };
}

// The trip out of the Nether for food Jev chose there (return_for_food,
// game-progress.js foodTrip), said on the Nether first that would undo it
// (note 832): 25597 (2026-10-01 12:56Z) came out for food with none
// carried, was asked win_strategy at once, took nether_first (told only
// "the Nether is entered with the food carried") and was asked the food
// again on arrival: out, in and out again inside a minute and a half. Since
// 10:00Z, 12 trips out for food came back in, 9 of them with no more food
// than they went out with, 7 inside two minutes.
function cameOutSays(bot, goal, now = Date.now()) {
  const trip = goal?.foodTrip;
  if (!trip?.at || now - trip.at > 30 * 60000) return '';
  const points = Math.round(require('./foraging').foodSupply(bot));
  const secs = Math.max(1, Math.round((now - trip.at) / 1000));
  const ago = secs < 90 ? `${secs} seconds` : `${Math.round(secs / 60)} minutes`;
  return ` The bot came out of the Nether ${ago} ago for food (going back through the portal for it was chosen there) and carries ${points} food point${points === 1 ? '' : 's'} now: going in now leaves that trip, and in the Nether the food question comes first again with what is carried.`;
}
// The options now, keyed for the decision tree. Only in the Overworld on
// the preparation ladder with more than one thing to do. A side trip is
// marked `trip`: strategyTree puts them all under one branch.
function strategyOptions(bot, goal, stage, sides = {}, planFor = null) {
  if (bot.game?.gameMode !== 'survival' || dimension(bot) !== 'overworld') return null;
  const rungs = openRungs(bot, goal);
  const options = {};
  if (rungs.length && rungs[0].phase === stage.phase) rungs.forEach((rung, i) => { options[`rung_${rung.phase}`] = rungOption(rung, i === 0, bot, goal, planFor); });
  // The Nether before the steps that may wait: when every step left before
  // it may, going now is Jev's to weigh, not a door kept shut by the ladder.
  // mid-110-i had only the arrows left, chose them seventy-three times over
  // three hours (arrows come only from skeletons here), and never went
  // (2026-09-26). Taken, the steps left are set aside for half an hour.
  const { DEFERRABLE, asideRungs, GOING_WITHOUT } = require('./game-progress');
  const netherFirst = all => {
    // What is already set aside to go without is not set aside again: an
    // option that would change nothing is not offered (mid-242-x, note 498).
    const resting = attemptsFor(goal).of('rung');
    const left = all.filter(p => !GOING_WITHOUT.test(resting[p]?.why || ''));
    if (!left.length) return null;
    const clock = goal.rungClocks?.[stage.phase];
    // Without the armour, what the Nether's mobs take a hit through what is
    // worn now, not a word for it.
    const armourHits = () => {
      const { MOBS, armourOf, afterArmour } = require('./combat-estimate');
      const worn = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
      const through = armourOf(worn), round = n => Math.round(n * 10) / 10;
      return `every hit lands on what is worn now (${worn.length ? worn.map(label).join(', ') : 'nothing'}, ${through.points} armour points): a blaze's fireball about ${round(afterArmour(MOBS.blaze.hit, through))}, a wither skeleton's blade about ${round(afterArmour(MOBS.wither_skeleton.hit, through))}, a piglin's about ${round(afterArmour(MOBS.piglin.hit, through))}, of 20 health; full iron would take about ${round(afterArmour(MOBS.blaze.hit, armourOf(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'])))} of the fireball`;
    };
    const without = p => /^iron_(armour|helmet|chestplate|leggings|boots)$/.test(p) ? armourHits() : WITHOUT[p] || RUNG_WHY[p] || 'it waits';
    // What the rung left would have taken from here, and its record.
    const priced = p => {
      const phase = p === 'iron_armour' ? (left.find(q => /^iron_/.test(q)) || p) : p;
      const level = require('./levels').rungLevelSays(bot, goal, phase).replace(/^ Its gathering/, ' Its gathering from here');
      return `${level}${require('./kit-record').rungRecordShort(p)}`;
    };
    // Going for the Nether takes up the reach nether if it was set aside:
    // said, and its rest cut short when chosen (note 694).
    const netherAside = require('./game-progress').rungAsideSays(goal, 'reach_nether');
    return {
      ...(netherAside ? { takeBack: 'reach_nether' } : {}),
      // Entered with the kit carried now, each rung left priced (note 763):
      // what it would take from here (its level, the climb) and what the
      // trials that chose it spent and the stays that had it came to.
      description: `Leave ${left.map(label).join(', ')} for later and go for the Nether now, with the kit carried now: the portal, and through it for a fortress, blaze rods and ender pearls.${netherAside ? ` ${netherAside}` : ''} ${[...new Set(left.map(p => /^iron_(helmet|chestplate|leggings|boots)$/.test(p) ? 'iron_armour' : p))].map(p => `Without ${label(p)} for now: ${without(p)}.${priced(p)}`).join(' ')}${clock ? ` The ${label(stage.phase)} has been worked on for ${Math.round(clock.activeMs / 60000)} minutes.` : ''} The steps left are set aside for half an hour, then offered again.${require('./crossing-kit').kitSummary(bot, goal)}${cameOutSays(bot, goal)}`,
      says: `I'll leave the ${left.map(label).join(' and the ')} for later`,
      // Said whole: "Before the diamond sword, I'll leave the diamond sword
      // for later" named the rung skipped as the one done first (25592
      // mid-237-ad 11:55:39Z and 11:57:59Z, the nether chest the same; the
      // live critic's report of 11:57Z, note 753).
      chat: `I'll leave the ${left.map(label).join(' and the ')} for later and go for the Nether now.`,
      side: true, aside: true,
      run: async () => { for (const p of left) setAside(goal, 'rung', p, 'Jev chose the Nether first', 1800000); if (left.includes('nether_food')) delete goal.foodTrip; delete goal.rungOptIn; },
    };
  };
  if (rungs.length && rungs[0].phase === stage.phase && dimension(bot) === 'overworld' && rungs.every(r => DEFERRABLE.has(r.phase))) {
    const first = netherFirst(rungs.map(r => r.phase));
    if (first) options.nether_first = first;
  }
  // Past the preparation ladder (pearls, the stronghold, the crossing): the
  // ladder's stage and the side trips. The dream run spent an afternoon
  // walking about after endermen with an ancient city never looked for.
  else if (LATER.has(stage.action) || stage.phase === 'obtain_ender_pearls') {
    // The ladder hands back a rung set aside when nothing else is left (the
    // reach nether is not held by its rest at all): said, and taking it is
    // taking it back, a choice of its own (note 694).
    const asideSays = require('./game-progress').rungAsideSays(goal, stage.phase);
    options[`stage_${stage.phase}`] = { description: `${asideSays ? `Take the ${label(stage.phase)} back up now after all.` : `Go on to ${label(stage.phase)}${stage.item ? ` (${stage.count || ''} ${label(stage.item)})` : ''}.`}${RUNG_WHY[stage.action] || RUNG_WHY[stage.phase] ? ` It is for this: ${RUNG_WHY[stage.action] || RUNG_WHY[stage.phase]}.` : ''}${asideSays ? ` ${asideSays}` : ''}${stage.action === 'enter_nether' ? require('./crossing-kit').kitSummary(bot, goal) : ''}`, stage, ladderNext: true,
      ...(asideSays ? { takeBack: stage.phase, says: `I'll take the ${label(stage.phase)} back up after all` } : {}) };
    // A step that may wait, back on the ladder after its time was up (the
    // ladder returns a set-aside step when nothing else is left): the
    // Nether first is on offer beside it too. mid-237-c was handed the
    // diamond sword alone forty-eight times and the bow eighteen, with no
    // way to the Nether before them, for three hours (2026-09-26).
    const first = DEFERRABLE.has(stage.phase) && dimension(bot) === 'overworld' && netherFirst([stage.phase]);
    if (first) options.nether_first = first;
    // On the way to the Nether with only steps Jev set aside to go without
    // left before it: each is a route of its own, taken up now rather than
    // when its half hour is out. mid-242-x was handed them back instead,
    // one after another, beside a Nether first that did nothing (note 498).
    if (stage.action === 'enter_nether' && dimension(bot) === 'overworld') for (const rung of asideRungs(bot, goal)) {
      const minutes = Math.max(1, Math.round((rung.until - Date.now()) / 60000)), p = /^iron_(helmet|chestplate|leggings|boots)$/.test(rung.phase) ? 'iron_armour' : rung.phase;
      options[`take_up_${rung.phase}`] = { description: `Take up the ${label(rung.phase)} now after all, before the Nether: it was set aside to go without it, and would come back on its own in ${minutes} minute${minutes === 1 ? '' : 's'}.${RUNG_WHY[p] ? ` It is for this: ${RUNG_WHY[p]}.` : ''}${rungTakes(bot, goal, rung, planFor)}`,
        says: `I'll make the ${label(rung.phase)} first after all`, rung, takeUp: true };
    }
    // No food at all on the way into the Nether, at a hunger health does
    // not come back at (note 1165): the food's own step is a way here, set
    // aside or not, said with the crossing that turned back for it. 25591
    // (mid-242-pc-fortress-10-r1, 2026-10-04 03:41 to 03:46Z), nine rods and
    // eleven pearls in its pack, no food and hunger 14 to 13, was offered
    // the pearls and five side trips, answered none good at 0.32 to 0.52,
    // and crossed three times in five minutes, each turned back for food.
    if (stage.action === 'enter_nether' && dimension(bot) === 'overworld' && !options.take_up_nether_food && (bot.food ?? 20) < 18) {
      // The rung made here: the crossing's kit is counted only while rods
      // are still wanted (crossing-kit.js kitCounted), and this crossing is
      // for the pearls.
      let foodRung = null;
      try {
        const carried = require('./foraging').foodSupply(bot), wants = require('./food-reserve').crossingWant(bot, goal);
        if (bot.game?.difficulty !== 'peaceful' && carried < wants) foodRung = { phase: 'nether_food', action: 'nether_food', kit: 'food', carried, wants };
      } catch (_) { foodRung = null; }
      if (foodRung && foodRung.carried === 0) {
        const back = goal.foodTurnBack && Date.now() - goal.foodTurnBack.at < 30 * 60000 ? Math.max(1, Math.round((Date.now() - goal.foodTurnBack.at) / 60000)) : null;
        options.take_up_nether_food = { description: `Get food first, before the Nether: nothing to eat is carried and hunger is ${bot.food} of 20, where health does not come back under eighteen.${back ? ` The last crossing turned back through the portal for food ${back} minute${back === 1 ? '' : 's'} ago, the first thing asked on the far side: crossed so again, it is asked there again.` : ''} The food's own question follows, with the ways to it from here (what is known near, the home chest, a hunt) and each one's trip.`,
          says: 'I\'ll get food first', rung: foodRung, takeUp: true };
      }
    }
  }
  else return null;
  // The Overworld's endermen, the pearls' route Jev chose (pearl-routes.js),
  // while the ladder's steps before the Nether are open: on offer beside
  // them, said with when it was chosen (note 831). 25593 (2026-10-01
  // 16:34:26Z) came out of the Nether for them and was asked the bow, the
  // diamond sword and the Nether first, nothing of the hunt it came for, and
  // went straight back in; five crossings in twelve minutes.
  const route = require('./game-progress').pearlRouteHeld(goal);
  const pearls = bot.inventory.items().filter(i => i.name === 'ender_pearl').reduce((n, i) => n + i.count, 0);
  if (route?.pick === 'overworld' && dimension(bot) === 'overworld' && rungs.length && rungs[0].phase === stage.phase && pearls < 12 && !options.pearls_first) {
    const open = rungs.map(r => r.phase), ago = Math.max(1, Math.round((Date.now() - route.at) / 60000)), left = Math.max(1, Math.round((route.until - Date.now()) / 60000));
    options.pearls_first = {
      description: `Hunt the Overworld's endermen for the ender pearls first, the route chosen for the pearls ${ago} minute${ago === 1 ? '' : 's'} ago (held ${left} more): ${pearls} pearls carried. ${open.map(label).join(', ')} wait${open.length === 1 ? 's' : ''} for it, set aside half an hour; the Nether's rods come after.`,
      says: `I'll hunt endermen for pearls first`, chat: `I'll hunt endermen for the pearls first, as I came out for.`, side: true, aside: true,
      run: async () => { for (const p of open) setAside(goal, 'rung', p, "Jev chose the Overworld's endermen for the pearls first", 1800000); delete goal.rungOptIn; },
    };
  }
  // The rungs optional before the Nether (note 776, game-progress.js
  // optionalRungs): no benefit in the record, so the ladder does not hand
  // them; each is on offer here with its minutes, its record and its level,
  // and chosen it goes on the ladder (rungOptIn) until it is made. Not while
  // a basic tool is the next step, nor past the Nether's own stage.
  const preNether = dimension(bot) === 'overworld' && (stage.action === 'enter_nether' || (rungs.length && rungs[0].phase === stage.phase))
    && !(rungs.length && /^(stone_pickaxe|stone_sword|iron_pickaxe)$/.test(rungs[0].phase));
  if (preNether) {
    let optional = [];
    try { optional = require('./game-progress').optionalRungs(bot, goal); } catch (_) { optional = []; }
    for (const rung of optional) {
      const key = `rung_${rung.phase}`;
      if (options[key] || options[`take_up_${rung.phase}`]) continue;
      const o = rungOption(rung, false, bot, goal, planFor);
      options[key] = { ...o, optIn: true };
    }
  }
  const fit = (bot.health ?? 20) >= 14 && (bot.food ?? 20) >= 12 && !immediateThreat(bot);
  // Whether a trip fits in the daylight left is Jev's to weigh, not a rule
  // that hides it (the user, 2026-09-26: "drop the daylight rule, let Jev
  // choose"). Every trip says its walk against the daylight left, or that it
  // is night (work.js tripTime). It had been a rule since Jev sent the bot
  // 240 blocks to a chest with half a minute of day left, told only the
  // distance.
  // Not while the next step is a basic tool: Jev chose a dungeon over the
  // stone pickaxe it had none of.
  const toolless = rungs.length && /^(stone_pickaxe|stone_sword|iron_pickaxe)$/.test(rungs[0].phase);
  // A bed to carry, at any hour: spiders' string is a night's wool.
  const carryBed = !toolless && carryBedOption(bot, goal, planFor);
  if (carryBed) options.carry_bed = { ...carryBed, trip: true };
  // The home base, at any hour and in any health, as its steps were on the
  // ladder: a hurt bot is the one a bed and a chest would serve.
  const home = !toolless && homeOption(bot, goal, planFor);
  if (home) options.home_base = home;
  if (fit && !toolless) for (const [key, side] of Object.entries(sides)) {
    if (side && !isSetAside(goal, 'strategy_side', key)) options[key] = { description: side.description, says: side.says, run: side.run, side: true, trip: true };
  }
  // Work that needs no walk or daylight (smelting the ore carried) is on
  // offer at any hour while nothing is on the bot.
  if (!immediateThreat(bot)) for (const [key, side] of Object.entries(sides)) {
    if (side?.anyTime && !options[key] && !isSetAside(goal, 'strategy_side', key)) options[key] = { description: side.description, says: side.says, run: side.run, side: true, trip: true };
  }
  // A rung set aside is not taken back unasked, even alone: the question
  // goes out with it said (note 694).
  return Object.keys(options).length > 1 || Object.values(options).some(o => o.takeBack && o.stage) ? options : null;
}

// The question as Jev sees it: the rungs, the Nether now, and one
// side_trip branch whose children are the trips, each with its facts. The
// branch names what it holds, so the top question is answered knowing what
// a side trip would be; with one trip, it says all of it.
const tripSays = (key, o) => o.says ? o.says.replace(/^I'll /, '') : key.replaceAll('_', ' ');
function strategyTree(options) {
  const top = {}, trips = {};
  // A rung it would take back goes with the node (asides.js, note 749).
  for (const [key, o] of Object.entries(options)) (o.trip ? trips : top)[key] = { description: o.description, ...(o.ladderNext ? { ladderNext: true } : {}), ...(o.takeBack ? { takeBack: o.takeBack } : o.takeUp && o.rung?.phase ? { takeBack: o.rung.phase } : {}) };
  const keys = Object.keys(trips);
  if (keys.length === 1) top.side_trip = { description: `A side trip, off the way to the Nether: ${trips[keys[0]].description}`, children: trips };
  else if (keys.length) top.side_trip = { description: `A side trip, off the way to the Nether, one of ${keys.length}: ${keys.map(k => tripSays(k, options[k])).join('; ')}. Each says what it buys and what it takes on its own question.`, children: trips };
  return top;
}

// Whether the rung a strategy answer chose is still open (not yet finished),
// resting (set aside, so it failed or was gone without), or gone from the
// ladder outright (finished): read the same way openRungs and the aside
// ledger already read it, nothing new kept for this.
function rungStatus(bot, goal, phase, now = Date.now()) {
  const open = openRungs(bot, goal, now).some(r => r.phase === phase);
  const resting = isSetAside(goal, 'rung', phase, now);
  return { open, resting, why: resting ? attemptsFor(goal).why('rung', phase) : null };
}
const agoWords = ms => { const s = Math.max(1, Math.round(ms / 1000)); return s < 90 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.round(s / 60)} minutes`; };
// What a held strategy answer has brought, once it is worth saying: what was
// chosen, how long ago, and whether its rung finished, was set aside, or is
// still open with nothing decided about it since (note 733: win_strategy was
// re-asked after every small craft between rungs_nether_pickaxe,
// rung_nether_food, nether_first and stage_reach_nether, six times in nine
// minutes on 25585, because the hold broke on the tree's own shape - a new
// side trip unlocked by the pickaxe just made, or the ladder's default stage
// moving to the rung just chosen - not on anything the chosen rung itself
// did). -> { choice, rungPhase, at, open, resting, why, says } or null
function lastStrategyFact(bot, goal, now = Date.now()) {
  const held = goal.strategy;
  if (!held) return null;
  const at = held.at, choice = held.choice, phase = held.rungPhase;
  if (!phase) return { choice, rungPhase: null, at, open: false, resting: false, why: null,
    says: `${label(choice)} was chosen ${agoWords(now - at)} ago: a side step or the ladder's own default, not a rung of its own.` };
  const { open, resting, why } = rungStatus(bot, goal, phase, now);
  const clock = goal.rungClocks?.[phase];
  const worked = clock ? `${Math.round(clock.activeMs / 60000)} minutes worked on it` : 'nothing worked on it yet';
  const gained = !open && !resting ? `the ${label(phase)} finished` : resting ? `the ${label(phase)} was set aside: ${why || 'it came to nothing'}`
    : `the ${label(phase)} is still open, ${worked}, nothing decided about it since`;
  return { choice, rungPhase: phase, at, open, resting, why, says: `${label(choice)} was chosen ${agoWords(now - at)} ago: ${gained}.` };
}

// Work under way that a held win_strategy answer began (note 763): the
// lava fetch holding its lava (obsidian.js heldLava), a cast frame being
// filled, a climb to open sky chosen and not yet at the top, a food trip for
// the Nether taken within its hold. Null when none is.
function errandUnderWay(bot, goal, now = Date.now()) {
  try { const lava = require('./obsidian').heldLava(bot, goal); if (lava) return 'the lava fetch under way'; } catch (_) { /* none held */ }
  const f = goal.portalFrame;
  if (f && !f.ruin && f.cast && f.origin && goal.portalMethod?.kind === 'cast' && dimension(bot) === 'overworld') return `the cast of the frame at (${f.origin.x}, ${f.origin.y}, ${f.origin.z})`;
  if (goal.surfaceReturn && goal.surfaceTrip?.pick === 'climb') return `the climb to open sky for ${goal.surfaceTrip.need || 'the work'}`;
  const k = goal.kitFood?.choice;
  if (k && k.pick !== 'go_without' && now - k.at < 10 * 60000) return 'the food trip for the Nether';
  return null;
}

function strategyState(bot, goal, stage, extra = {}) {
  const clock = goal.rungClocks?.[stage.phase];
  const t = bot.time?.timeOfDay ?? 0;
  // The options are not repeated here: each is in its question, and the
  // state had carried every description a second time (the critical
  // review, 2026-09-26).
  return {
    situation: 'On the way to beating the game (Nether, blaze rods, ender pearls, the stronghold, the dragon). Several things are open; choose which to do next.',
    workingOn: label(stage.phase), minutesWorkedOn: clock ? Math.round(clock.activeMs / 60000) : 0,
    note: 'minutesWorkedOn is how long the step being worked on has gone without finishing; this is asked again every twenty of them. Nothing skipped here is skipped for good.',
    ...extra,
    // The day where there is one (note 677).
    ...(/overworld/.test(String(bot.game?.dimension || 'overworld')) ? { timeOfDay: t, daylightMinutesRemaining: Math.round(Math.max(0, DAY.DUSK - t) / 1200 * 10) / 10 } : {}),
    ...(require('./exploration').biomeView(bot) || {}),
    // What the Nether truly waits on, said: the note had told Jev "every
    // step is done before the Nether", with the Nether-first option beside
    // it, and mid-207-a chose the arrows (only from skeletons here) a
    // hundred and ninety-six times over three hours and never went
    // (2026-09-26).
    beforeTheNether: (() => { const { DEFERRABLE, asideRungs } = require('./game-progress'); const left = openRungs(bot, goal).map(r => r.phase);
      const { KIT_PHASES } = require('./crossing-kit');
      const needed = left.filter(p => !DEFERRABLE.has(p)), may = left.filter(p => DEFERRABLE.has(p) && !KIT_PHASES.has(p)), kit = left.filter(p => KIT_PHASES.has(p));
      // What Jev set aside to go without, said as that (mid-242-x, note 498).
      const aside = asideRungs(bot, goal).map(r => `${label(r.phase)} (${Math.max(1, Math.round((r.until - Date.now()) / 60000))} minutes more)`);
      // And the kit for the crossing, said: it was a second ladder of gates
      // at the portal that this line never mentioned (the decision review,
      // 2026-09-26).
      // The rungs optional before the Nether, said as that (note 776).
      let optional = [];
      try { optional = require('./game-progress').optionalRungs(bot, goal).map(r => r.phase); } catch (_) { optional = []; }
      return `${needed.length ? `Needed before the Nether: ${needed.map(label).join(', ')}.` : 'Nothing left is needed before the Nether: a portal can be made or found now.'}${may.length ? ` May wait until after it: ${may.map(label).join(', ')}.` : ''}${optional.length ? ` Optional before the Nether, not on the ladder unless chosen (no benefit for them in the first Nether stays' record, kit-record.js): ${optional.map(label).join(', ')}.` : ''}${kit.length ? ` The crossing's kit, last before the portal, each of which may be gone without: ${kit.map(p => RUNG_WHY[p]).join(', ')}.` : ''}${aside.length ? ` Set aside by choice, to go without for now: ${aside.join(', ')}, each back on its own after that.` : ''}${require('./crossing-kit').kitSummary(bot, goal)}`; })(),
    // What is owed at the surface and at depth from here, and the climb
    // between them at the bot's own pace (note 763).
    ...((() => { const says = require('./levels').levelsSays(bot, goal).trim(); return says ? { byLevel: says } : {}; })()),
    riskNow: require('./risk').riskNow(bot), deathWouldCost: require('./risk').deathCost(bot, goal),
    recentPositions: require('./stillness').recentPositions(bot),
    health: bot.health, food: bot.food, experienceLevel: bot.experience?.level ?? 0,
    inventory: Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])),
    deaths: (goal.survival?.deaths || []).length,
  };
}

async function strategyStep(bot, task, goal, save, stage, { client, decide, sides = {}, planFor = null, now = Date.now } = {}) {
  // The rods' bank under way is the step (rod-bank.js bankStage), not a
  // rung among the others: it was chosen at the cage (rods_now, bank_rods)
  // or begun on coming out with rods (note 868), and a held answer does not
  // go on over it. 25597 (mid-241-cc-nether-1, 2026-10-02 13:23:59Z) said
  // "Out with 2 blaze rods: into a chest here first", and the going to the
  // Nether held from five minutes before walked it through its portal with
  // both rods in the pack (note 875).
  if (stage?.phase === 'bank_rods') return null;
  // So the trip back for the kit a death left in the Nether, chosen at its
  // own question (corpse-run.js kitTrip): 25589 (2026-10-04 15:55 to
  // 15:59Z), the trip chosen at 15:47Z, was asked of an iron pickaxe, a
  // bucket and a bed over it, the trip said as 'errand' (note 1235).
  if (stage?.phase === 'errand' && stage.for === require('./corpse-run').KIT_ERRAND && goal.corpseRun?.status === 'open' && goal.corpseRun.trip?.pick === 'go_now') return null;
  const options = strategyOptions(bot, goal, stage, sides, planFor);
  if (!options) { delete goal.strategy; return null; }
  const tree = strategyTree(options);
  // Held while the top-level choices stand: a trip coming into view or
  // going beside the others changes nothing chosen between at the top.
  // Biomes coming into view had re-asked the whole list on most walks.
  // Nor an option going that was not chosen: the answer was given over it,
  // and stands over fewer. 25584 mid-242-pf (2026-09-30 01:32 to 01:40Z)
  // was asked this 36 times, every four seconds, as take_up_bow came and
  // went between the two steps it traded, each answer stage_reach_nether
  // (note 709). Only an option not on offer when it was answered asks again.
  const keys = Object.keys(tree).sort().join(',');
  const held = goal.strategy;
  const offered = new Set(String(held?.keys || '').split(','));
  const same = held && (held.keys === keys || Object.keys(tree).every(k => offered.has(k)));
  // A rung chosen commits to that rung, not to the tree's own shape (note
  // 733): the crafts a rung takes (a table, a stone pickaxe) change what is
  // carried, which unlocks or closes side trips and moves the ladder's
  // default stage onto the rung just picked, and both used to read as "the
  // question changed" and break the hold on their own, with the rung itself
  // still open and nothing decided about it. Held instead on the rung's own
  // end: it is asked again only once that rung has finished or been set
  // aside, or HOLD_MS has passed regardless. A choice that named no rung of
  // its own (a side trip, the ladder's plain default) still holds the old
  // way, by the tree's shape and the ladder's stage.
  let choice = null, heldOption = null;
  // Food before the Nether, taken up, holds while it is still on offer
  // (note 1319): its rung is made here, not one of the open rungs, so the
  // rung hold read it as finished. 25598 (2026-10-05 21:38 to 21:40Z),
  // hunger 6 with its stronghold found, was asked this every four seconds
  // and answered it 12 times.
  if (held?.choice === 'take_up_nether_food' && options.take_up_nether_food && now() - held.at < HOLD_MS) { choice = held.choice; heldOption = options.take_up_nether_food; }
  else if (held?.rungPhase) {
    // Held by the open rungs themselves (game-progress.js openRungs), not by
    // the tree's shape: that list does not change regime with stage.phase
    // (rung_* keys against stage_* ones) the way the tree does, so a rung
    // finishing its own crafts mid-way, which flips the ladder's default
    // stage onto it and back, no longer reads as a new question. Still asked
    // again the moment a rung neither open nor known at the answer opens up
    // (note 709's own case: iron boots wearing out mid-hold), or the chosen
    // rung itself finishes, is set aside, or HOLD_MS is up regardless.
    const status = rungStatus(bot, goal, held.rungPhase, now());
    const openNow = openRungs(bot, goal, now());
    const newlyOpen = openNow.some(r => !(held.openPhases || []).includes(r.phase));
    if (status.open && !newlyOpen && now() - held.at < HOLD_MS) {
      const rung = openNow.find(r => r.phase === held.rungPhase);
      if (rung) { choice = held.choice; heldOption = { rung }; }
    }
  } else if (held && TO_THE_NETHER.test(held.choice) && now() - held.at < HOLD_MS) {
    // Going to the Nether holds until the bot is there (note 764): nether_first
    // (the rungs left put after it) and stage_reach_nether (the ladder's own
    // stage, the portal) are the one answer, and the ladder read afresh after
    // each craft moving its default between the portal and a rung it had put
    // after it was not an end. From 13:20Z to 19:00Z on 2026-09-30, 185 of
    // win_strategy's re-asks within 30 s followed nether_first or
    // stage_reach_nether with the ladder's stage flipped by a craft. Asked
    // again when the dimension changes, a rung neither open nor known at the
    // answer opens (note 709's case, read after nether_first's set-asides, so
    // a rung it set aside coming back is one), the portal's stage is not on
    // offer, or HOLD_MS.
    const openNow = openRungs(bot, goal, now());
    // Keyed to its goal, the Nether, not to what is carried (note 777): a
    // rung that may wait (game-progress.js DEFERRABLE: the crossing's kit,
    // the armour, the side gear) opening since is the work's own wear or
    // spend (a spare pickaxe dug with, the food eaten, the blocks laid) or a
    // may-wait rung come into reach, which going to the Nether put after it,
    // and the crossing's kit is asked at the portal anyway (crossing_kit).
    // From 00:41Z to 02:50Z on 2026-10-01, 56 of 57 askings within a held
    // going-to-the-Nether came with the portal's stage off the tree because
    // such a rung had become the ladder's next (the nether pickaxe reopened
    // 11 times of the 51 it finished). A rung that may not wait (a pickaxe
    // to dig with at all) still ends it.
    const fresh = openNow.filter(r => !(held.openPhases || []).includes(r.phase));
    const ends = fresh.filter(r => !require('./game-progress').DEFERRABLE.has(r.phase));
    const dim = String(bot.game?.dimension || '').replace(/^minecraft:/, '');
    // Only the ladder's own stage is taken unasked: nether_first again would
    // set rungs aside again, which is Jev's to say.
    const key = options.stage_reach_nether ? 'stage_reach_nether' : null;
    if (!ends.length && (!held.dimension || held.dimension === dim)) {
      if (key) { choice = key; heldOption = options[key]; }
      else if (dimension(bot) === 'overworld' && openNow.every(r => require('./game-progress').DEFERRABLE.has(r.phase))) {
        const waiting = fresh.map(r => label(r.phase));
        const said = waiting.join(', ');
        if (held.waitingSaid !== said) { held.waitingSaid = said; save(); console.log(`[strategy] held: ${label(held.choice)} goes on, chosen ${agoWords(now() - held.at)} ago${waiting.length ? `; the ${said} opened meanwhile and may wait (the crossing's kit is said at the portal)` : ''}`); }
        return { stage: { phase: 'reach_nether', action: 'enter_nether' } };
      }
    }
  } else if (same && held?.ladderNext === stage.phase && now() - held.at < HOLD_MS && options[held.choice]) {
    choice = held.choice; heldOption = options[choice];
  }
  // Not asked again mid-errand (note 763): a lava fetch, a cast, a climb or
  // a food trip the held answer began goes on to its end, a rung the work's
  // own wear or spend opens (a pickaxe worn under the spare's uses on the
  // dig, the food eaten, the blocks laid) waiting for it. 25583 and 25590
  // turned win_strategy every 10 to 60 seconds, the lava fetch restarted
  // each time; 142 of the turns on the hard worlds came mid lava fetch.
  // The errand ends on its own terms (the bucket filled, the frame lit, the
  // top reached, the food trip's hold out) or the ten minutes of the hold
  // do; the question is asked then, with what opened said.
  let errand = null;
  if (!choice && held && now() - held.at < HOLD_MS && (errand = errandUnderWay(bot, goal, now()))) {
    const opened = openRungs(bot, goal, now()).filter(r => !(held.openPhases || []).includes(r.phase)).map(r => label(r.phase));
    if (held.rungPhase) {
      const rung = openRungs(bot, goal, now()).find(r => r.phase === held.rungPhase);
      if (rung && rungStatus(bot, goal, held.rungPhase, now()).open) { choice = held.choice; heldOption = { rung }; }
    } else if (options[held.choice] && held.choice !== 'nether_first') { choice = held.choice; heldOption = options[held.choice]; }
    else if (/^(stage_reach_nether|nether_first)$/.test(held.choice) && stage.phase !== 'reach_nether' && dimension(bot) === 'overworld'
      && openRungs(bot, goal, now()).every(r => require('./game-progress').DEFERRABLE.has(r.phase))) {
      console.log(`[strategy] held through ${errand}: ${label(held.choice)} goes on${opened.length ? `, the ${opened.join(', ')} opened meanwhile waiting for its end` : ''}`);
      return { stage: { phase: 'reach_nether', action: 'enter_nether' } };
    }
    if (choice) {
      if (!held.errand) { held.errand = errand; save(); }
      if (opened.length) console.log(`[strategy] held through ${errand}: ${label(held.choice)} goes on, the ${opened.join(', ')} opened meanwhile waiting for its end`);
    }
  }
  if (!choice) {
    // What the last answer brought, said so the next one is not asked blind
    // of it, and priced as a reversal on every other option when the rung it
    // held is still open with nothing decided (note 733).
    const last = lastStrategyFact(bot, goal, now());
    if (last && last.rungPhase && last.open) {
      for (const [key, node] of Object.entries(tree)) {
        if (key === `rung_${last.rungPhase}` || node.children) continue;
        node.description = `${node.description} This would reverse ${label(last.choice)}, chosen ${agoWords(now() - last.at)} ago: ${label(last.rungPhase)} is still open, nothing decided about it since.`;
      }
    }
    // The errand still under way when the hold's ten minutes are out is
    // said with the question (note 767c): 25593 (2026-10-01 01:24:21Z),
    // mid-cast, was asked the ladder afresh with nothing of the cast in
    // it, and took the pickaxe rung and a furnace job, the cast left.
    const underWay = errand || errandUnderWay(bot, goal, now());
    const errandSays = underWay ? { errandUnderWay: `${underWay} is under way${held ? `, begun under ${label(held.choice)} ${agoWords(now() - held.at)} ago` : ''}; another answer leaves it where it stands until it is taken up again${(() => { const f = goal.portalFrame; if (!f?.blocks || !f.cast) return ''; const n = f.blocks.filter(p => bot.blockAt?.(new Vec3(p.x, p.y, p.z))?.name === 'obsidian').length; return ` (${n || f.placedSeen || 0} of ten cast)`; })()}` } : {};
    const askedAt = Date.now();
    const decision = await decide('win_strategy', { client, bot, task, goal, save, tree, state: strategyState(bot, goal, stage, { ...(last ? { lastStrategy: last.says } : {}), ...errandSays }) });
    // Held through an outage (note 707): nothing is done this step; the
    // next asks it fresh.
    if (decision.stale) return { stale: true };
    // None good far above the least bad, and no option that changes nothing
    // on offer (decide's weakLeastBad, note 749c): the ladder's stage goes on
    // as it was, nothing set aside or taken up on a guess.
    if (decision.weakLeastBad) {
      console.log(`[strategy] none good at ${decision.weakLeastBad.noneGood} against ${label(decision.weakLeastBad.key)} at ${decision.weakLeastBad.p}: the ladder's stage goes on as it was`);
      return null;
    }
    choice = decision.path.at(-1);
    // Only a ladder rung (openRungs, `rung_${phase}`) is held by its own
    // progress: a side trip's rung-shaped object (home_base, carry_bed) is
    // never in openRungs at all (the base's steps are not on the ladder),
    // so it is held the old way, by the tree's shape.
    const rungPhase = choice.startsWith('rung_') ? options[choice]?.rung?.phase || null : null;
    // An optional rung chosen goes on the ladder (note 776) before the hold
    // reads the rungs open, so its own opening is not a new rung.
    if (options[choice]?.optIn && rungPhase) require('./game-progress').optIn(goal, rungPhase);
    if (last?.rungPhase && last.open && rungPhase !== last.rungPhase) console.log(`[strategy] reversal: ${choice} (${rungPhase ? label(rungPhase) : 'no rung'}) chosen over ${label(last.choice)}, with ${label(last.rungPhase)} still open and nothing decided about it since it was chosen ${agoWords(now() - last.at)} ago`);
    goal.strategy = { choice, rungPhase, ladderNext: stage.phase, keys, at: now(), source: decision.standIn ? 'stand-in' : 'jev',
      ...(rungPhase || TO_THE_NETHER.test(choice) ? { openPhases: openRungs(bot, goal, now()).map(r => r.phase) } : {}),
      ...(TO_THE_NETHER.test(choice) ? { dimension: String(bot.game?.dimension || '').replace(/^minecraft:/, '') } : {}) };
    // The work in hand left for another rung or a side trip (note 854): its
    // answers under way are cut short, not tries that came to nothing.
    // 25584 (mid-218-au, 2026-10-02 01:11:59Z) took a side trip to smelt a
    // second into digging its portal site; the dig was then offered as
    // "chosen 3 minutes ago ... and it came to nothing: nothing gained on
    // the rung", and the climb of 29 blocks to the surface was taken.
    if (choice !== `rung_${stage.phase}` && choice !== `stage_${stage.phase}`) require('./tried').cut(goal, `left for ${label(choice)} (win_strategy)`, Date.now(), { before: askedAt });
    save();
    if (choice !== `rung_${stage.phase}` && choice !== `stage_${stage.phase}`) bot.chat?.(options[choice].chat ? options[choice].chat : options[choice].side || options[choice].says ? `Before ${spoken(stage.phase)}, ${options[choice].says || choice.replaceAll('_', ' ')}.` : `${Spoken(options[choice].rung.phase)} first, then ${spoken(stage.phase)}.`);
  }
  const option = heldOption || options[choice];
  // A rung set aside, taken back: its rest cut short and said (note 694).
  if (option.takeBack) {
    const gp = require('./game-progress');
    const entry = attemptsFor(goal).of('rung')[option.takeBack];
    gp.takeBackRung(goal, option.takeBack); save();
    bot.chat?.(`Back to ${spoken(option.takeBack)} after all${entry ? `: I set it aside ${gp.agoSays(Date.now() - entry.at)} ago` : ''}.`);
  }
  if (option.stage) return null;
  // A step set aside to go without, taken up again now.
  // The food before the Nether is a rung made here and nowhere on the
  // ladder, so its answer is kept for the hold above (note 1319), not let go.
  if (option.takeUp && choice === 'take_up_nether_food') return { stage: option.rung };
  if (option.takeUp) { attemptsFor(goal).clear('rung', option.rung.phase); require('./game-progress').optIn(goal, option.rung.phase); delete goal.strategy; save(); return { stage: option.rung }; }
  if (option.rung) return option.rung.phase === stage.phase ? null : { stage: option.rung };
  // Setting steps aside is not work: nothing to run in the world, no step to
  // stall on, no rest. The ladder is read again at once (gameStep).
  // mid-242-x kept it as a strategy_side step, re-chose it five times a
  // second and failed on "no measurable progress" (note 498).
  if (option.aside) {
    await option.run(bot, task, goal, save);
    // Going to the Nether is held past its set-asides (note 764), against the
    // rungs open once they are made.
    if (TO_THE_NETHER.test(choice) && goal.strategy?.choice === choice) goal.strategy.openPhases = openRungs(bot, goal, now()).map(r => r.phase);
    else delete goal.strategy;
    save(); return { replan: true };
  }
  // A side trip: once, then a rest, and the next step asks again.
  delete goal.strategy;
  goal.step = { action: 'strategy_side', choice, ladderNext: stage.phase }; save();
  try {
    await option.run(bot, task, goal, save);
    setAside(goal, 'strategy_side', choice, 'done for now', SIDE_REST_MS);
  } catch (err) {
    task.check(); if (fatal(err)) throw err;
    setAside(goal, 'strategy_side', choice, err, SIDE_FAIL_MS);
  }
  save();
  return { ran: true };
}

module.exports = { cameOutSays, errandUnderWay, woolTrip, WOOL_HUNTS, oreFacts, carryBedOption, homeOption, strategyTree, pickaxeLeft, planSpends, HAND_BLOCKS_PER_MINUTE, rungTakes, WITHOUT, RUNG_WHY, rungOption, strategyOptions, strategyStep, HOLD_MS, SIDE_REST_MS, SIDE_FAIL_MS, rungStatus, lastStrategyFact };

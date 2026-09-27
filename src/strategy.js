'use strict';
// Strategy on the way to the dragon: of the things open now, which next.
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
const { setAside, isSetAside } = require('./progress');
const { immediateThreat } = require('./danger');

const WALK_BLOCKS_PER_S = 4;
const LATER = new Set(['acquire', 'enter_nether', 'find_stronghold', 'trade', 'barter', 'pearl_patrol']);
const HOLD_MS = 10 * 60 * 1000, SIDE_REST_MS = 10 * 60 * 1000, SIDE_FAIL_MS = 30 * 60 * 1000;
const fatal = err => ['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name);
const label = phase => phase.replaceAll('_', ' ');

const RUNG_WHY = {
  bed: 'a night slept passes in seconds and sets the spawn point; three wool from sheep or crafted from spiders\' string (four string a wool), or a bed from a village',
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
  iron_sword: 'kills faster than stone',
  bucket: 'water for lava, falls and the End portal room',
  golden_boots: 'piglins leave a player wearing gold alone in the Nether',
  bow: 'answers skeletons, blazes and the dragon\'s crystals from range',
  arrows: 'the bow is nothing without them; here they come only from skeletons, none to two a skeleton, and are spent as they are shot (feathers for crafting come from chickens, which the bot never hurts)',
  diamond_sword: 'ends a blaze or a piglin in two swings',
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
  bed: 'each night is spent awake, walled in or fighting, and a death respawns at the world spawn',
  iron_pickaxe: 'no diamond, gold or redstone can be mined',
  shield: 'every arrow and every creeper blast lands in full',
  iron_armour: 'every hit lands on what is worn now',
  bucket: 'there is no water for fire, lava or a fall',
  golden_boots: 'every piglin in the Nether attacks on sight',
  bow: 'shooters are answered only by closing on them',
  arrows: 'the bow cannot shoot',
  home_bed: 'a death respawns far from home',
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
  return ` It leaves ${logs} logs, ${planks} planks, ${sticks} sticks and ${ingots} iron ingots (${wood} logs' worth of wood of the ${WOOD_RESERVE} kept for pickaxes and a table); a new pickaxe takes 2 sticks and 3 ingots or 3 cobblestone${none ? `, and ${none} from what is left` : ', and that is left'}. Pickaxes carried: ${picks.join(', ') || 'none'}.${depth >= 8 ? ` The bot is about ${depth} blocks under the surface${none ? `: when the last pickaxe breaks, none can be made down here, and the way up is dug by hand at about ${HAND_BLOCKS_PER_MINUTE} blocks a minute (about ${Math.round(depth / HAND_BLOCKS_PER_MINUTE)} minutes)` : ''}.` : ''}`;
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
  const what = rung.items?.length > 1 ? `${label(rung.phase)} (${rung.items.map(label).join(', ')})` : rung.item ? `${rung.count > 1 ? `${rung.count} ` : ''}${label(rung.item)}` : label(rung.phase);
  const piece = /^iron_(helmet|chestplate|leggings|boots)$/.test(rung.phase) ? 'iron_armour' : rung.phase;
  const why = RUNG_WHY[rung.phase] || RUNG_WHY[piece];
  const clock = goal?.rungClocks?.[rung.phase];
  const spent = clock?.activeMs >= 60000 ? ` Worked on for ${Math.round(clock.activeMs / 60000)} minutes so far.` : '';
  const without = WITHOUT[piece] ? ` Until it is done, ${WITHOUT[piece]}.` : '';
  // Said alike whichever rung is first: "the ladder's next step" beside
  // "ahead of the ladder's order" was a thumb on the scale (the critical
  // review, 2026-09-26). The first is still the fallback.
  return { description: `Get ${what}${why ? ` (${why})` : ''}.${bot && goal ? searchSoFar(bot, goal, rung) : ''}${homeWhere(bot, goal, rung)}${rungTakes(bot, goal, rung, planFor)}${spent}${without}`, rung, fallback: first };
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
    description: `Make a second bed to carry, the base's staying where it is (three wool and three planks; wool from sheep, or crafted from spiders' string, four string a wool and twelve a bed). It buys any night, anywhere: put down where the night comes, slept in and picked back up, the night passes in seconds, instead of about eleven real minutes in a pocket or a night mine and the climb out after. A carried bed does not keep the spawn point; the base's does.${inHand}${where}${searchSoFar(bot, goal, rung)}${rungTakes(bot, goal, rung, planFor)}`,
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
  const { DEFERRABLE } = require('./game-progress');
  const netherFirst = left => {
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
    return {
      description: `Leave ${left.map(label).join(', ')} for later and go for the Nether now: the portal, and through it for a fortress, blaze rods and ender pearls. ${[...new Set(left.map(p => /^iron_(helmet|chestplate|leggings|boots)$/.test(p) ? 'iron_armour' : p))].map(p => `Without ${label(p)} for now: ${without(p)}.`).join(' ')}${clock ? ` The ${label(stage.phase)} has been worked on for ${Math.round(clock.activeMs / 60000)} minutes.` : ''} The steps left are set aside for half an hour, then offered again.${require('./crossing-kit').kitSummary(bot, goal)}`,
      says: `I'll leave the ${left.map(label).join(' and the ')} for later`,
      side: true,
      run: async () => { for (const p of left) setAside(goal, 'rung', p, 'Jev chose the Nether first', 1800000); },
    };
  };
  if (rungs.length && rungs[0].phase === stage.phase && dimension(bot) === 'overworld' && rungs.every(r => DEFERRABLE.has(r.phase))) {
    options.nether_first = netherFirst(rungs.map(r => r.phase));
  }
  // Past the preparation ladder (pearls, the stronghold, the crossing): the
  // ladder's stage and the side trips. The dream run spent an afternoon
  // walking about after endermen with an ancient city never looked for.
  else if (LATER.has(stage.action) || stage.phase === 'obtain_ender_pearls') {
    options[`stage_${stage.phase}`] = { description: `Go on to ${label(stage.phase)}${stage.item ? ` (${stage.count || ''} ${label(stage.item)})` : ''}.${RUNG_WHY[stage.action] || RUNG_WHY[stage.phase] ? ` It is for this: ${RUNG_WHY[stage.action] || RUNG_WHY[stage.phase]}.` : ''}${stage.action === 'enter_nether' ? require('./crossing-kit').kitSummary(bot, goal) : ''}`, stage, fallback: true };
    // A step that may wait, back on the ladder after its time was up (the
    // ladder returns a set-aside step when nothing else is left): the
    // Nether first is on offer beside it too. mid-237-c was handed the
    // diamond sword alone forty-eight times and the bow eighteen, with no
    // way to the Nether before them, for three hours (2026-09-26).
    if (DEFERRABLE.has(stage.phase) && dimension(bot) === 'overworld') options.nether_first = netherFirst([stage.phase]);
  }
  else return null;
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
  return Object.keys(options).length > 1 ? options : null;
}

// The question as Jev sees it: the rungs, the Nether now, and one
// side_trip branch whose children are the trips, each with its facts. The
// branch names what it holds, so the top question is answered knowing what
// a side trip would be; with one trip, it says all of it.
const tripSays = (key, o) => o.says ? o.says.replace(/^I'll /, '') : key.replaceAll('_', ' ');
function strategyTree(options) {
  const top = {}, trips = {};
  for (const [key, o] of Object.entries(options)) (o.trip ? trips : top)[key] = { description: o.description, ...(o.fallback ? { fallback: true } : {}) };
  const keys = Object.keys(trips);
  if (keys.length === 1) top.side_trip = { description: `A side trip, off the way to the Nether: ${trips[keys[0]].description}`, children: trips };
  else if (keys.length) top.side_trip = { description: `A side trip, off the way to the Nether, one of ${keys.length}: ${keys.map(k => tripSays(k, options[k])).join('; ')}. Each says what it buys and what it takes on its own question.`, children: trips };
  return top;
}

function strategyState(bot, goal, stage) {
  const clock = goal.rungClocks?.[stage.phase];
  const t = bot.time?.timeOfDay ?? 0;
  // The options are not repeated here: each is in its question, and the
  // state had carried every description a second time (the critical
  // review, 2026-09-26).
  return {
    situation: 'On the way to beating the game (Nether, blaze rods, ender pearls, the stronghold, the dragon). Several things are open; choose which to do next.',
    workingOn: label(stage.phase), minutesWorkedOn: clock ? Math.round(clock.activeMs / 60000) : 0,
    note: 'minutesWorkedOn is how long the step being worked on has gone without finishing; this is asked again every twenty of them. Nothing skipped here is skipped for good.',
    timeOfDay: t, daylightMinutesRemaining: Math.round(Math.max(0, DAY.DUSK - t) / 1200 * 10) / 10,
    ...(require('./exploration').biomeView(bot) || {}),
    // What the Nether truly waits on, said: the note had told Jev "every
    // step is done before the Nether", with the Nether-first option beside
    // it, and mid-207-a chose the arrows (only from skeletons here) a
    // hundred and ninety-six times over three hours and never went
    // (2026-09-26).
    beforeTheNether: (() => { const { DEFERRABLE } = require('./game-progress'); const left = openRungs(bot, goal).map(r => r.phase);
      const needed = left.filter(p => !DEFERRABLE.has(p)), may = left.filter(p => DEFERRABLE.has(p));
      // And the kit for the crossing, said: it was a second ladder of gates
      // at the portal that this line never mentioned (the decision review,
      // 2026-09-26).
      return `${needed.length ? `Needed before the Nether: ${needed.map(label).join(', ')}.` : 'Nothing left is needed before the Nether: a portal can be made or found now.'}${may.length ? ` May wait until after it: ${may.map(label).join(', ')}.` : ''}${require('./crossing-kit').kitSummary(bot, goal)}`; })(),
    riskNow: require('./risk').riskNow(bot), deathWouldCost: require('./risk').deathCost(bot, goal),
    recentPositions: require('./stillness').recentPositions(bot),
    health: bot.health, food: bot.food, experienceLevel: bot.experience?.level ?? 0,
    inventory: Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])),
    deaths: (goal.survival?.deaths || []).length,
  };
}

async function strategyStep(bot, task, goal, save, stage, { client, decide, sides = {}, planFor = null, now = Date.now } = {}) {
  const options = strategyOptions(bot, goal, stage, sides, planFor);
  if (!options) { delete goal.strategy; return null; }
  const tree = strategyTree(options);
  // Held while the top-level choices stand: a trip coming into view or
  // going beside the others changes nothing chosen between at the top.
  // Biomes coming into view had re-asked the whole list on most walks.
  const keys = Object.keys(tree).sort().join(',');
  const held = goal.strategy;
  let choice = held && held.ladderNext === stage.phase && held.keys === keys && now() - held.at < HOLD_MS && options[held.choice] ? held.choice : null;
  if (!choice) {
    const decision = await decide('win_strategy', { client, bot, task, goal, save, tree, state: strategyState(bot, goal, stage) });
    choice = decision.path.at(-1);
    goal.strategy = { choice, ladderNext: stage.phase, keys, at: now(), source: decision.fallback ? 'fallback' : 'jev' };
    save();
    if (choice !== `rung_${stage.phase}` && choice !== `stage_${stage.phase}`) bot.chat?.(options[choice].side || options[choice].says ? `Before the ${label(stage.phase)}, ${options[choice].says || choice.replaceAll('_', ' ')}.` : `The ${label(options[choice].rung.phase)} first, then the ${label(stage.phase)}.`);
  }
  const option = options[choice];
  if (option.stage) return null;
  if (option.rung) return option.rung.phase === stage.phase ? null : { stage: option.rung };
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

module.exports = { oreFacts, carryBedOption, homeOption, strategyTree, pickaxeLeft, planSpends, HAND_BLOCKS_PER_MINUTE, rungTakes, WITHOUT, RUNG_WHY, rungOption, strategyOptions, strategyStep, HOLD_MS, SIDE_REST_MS, SIDE_FAIL_MS };

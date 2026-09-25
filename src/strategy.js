'use strict';
// Strategy on the way to the dragon: of the things open now, which next.
// The ladder's order is the code's answer and stays the fallback. What
// Jev weighs is what the order cannot see: that the ruined portal's chest
// two hundred blocks off holds the gold the golden-boots rung is digging
// for, that the diamond sword is worth more today than the bow, that the
// levels in hand should go on the sword before the next fight.
//
// On offer, all of them already checked feasible:
//   the rungs open now (game-progress.js openRungs): the ladder's next,
//     and each one after it the ladder may reach while those before it
//     wait. Pickaxes and armour may not wait, so they are never skipped.
//   side trips, by day and in good health: loot a remembered structure,
//     trade at a remembered village, enchant at a known table.
//
// The choice holds: asked when the ladder's next rung changes, when the
// set of options changes, or after ten minutes, and not at every step.
// A side trip runs once and rests ten minutes (thirty if it failed), so
// the answer after it is asked again with the trip done.
const { DAY } = require('./day');
const { openRungs, dimension } = require('./game-progress');
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
  iron_armour: 'a helmet, chestplate, leggings and boots, twenty-four ingots in all; worn, they take about a third or more off every hit',
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
  arrows: 'the bow is nothing without them',
  diamond_sword: 'ends a blaze or a piglin in two swings',
};

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
  return ` From the pockets as they are it takes: ${list}${gather.length ? '' : ' (all of it from what is carried: no gathering)'}.`;
}
function rungOption(rung, first, bot, goal, planFor = null) {
  const what = rung.items?.length > 1 ? `${label(rung.phase)} (${rung.items.map(label).join(', ')})` : rung.item ? `${rung.count > 1 ? `${rung.count} ` : ''}${label(rung.item)}` : label(rung.phase);
  const why = RUNG_WHY[rung.phase];
  return { description: `${first ? 'The ladder\'s next step: ' : 'Do this step first, ahead of the ladder\'s order: '}get ${what}${why ? ` (${why})` : ''}.${bot && goal ? searchSoFar(bot, goal, rung) : ''}${rungTakes(bot, goal, rung, planFor)}`, rung, fallback: first };
}

// The options now, keyed for the decision tree. Only in the Overworld on
// the preparation ladder with more than one thing to do.
function strategyOptions(bot, goal, stage, sides = {}, planFor = null) {
  if (bot.game?.gameMode !== 'survival' || dimension(bot) !== 'overworld') return null;
  const rungs = openRungs(bot, goal);
  const options = {};
  if (rungs.length && rungs[0].phase === stage.phase) rungs.forEach((rung, i) => { options[`rung_${rung.phase}`] = rungOption(rung, i === 0, bot, goal, planFor); });
  // Past the preparation ladder (pearls, the stronghold, the crossing): the
  // ladder's stage and the side trips. The dream run spent an afternoon
  // walking about after endermen with an ancient city never looked for.
  else if (LATER.has(stage.action) || stage.phase === 'obtain_ender_pearls') options[`stage_${stage.phase}`] = { description: `The ladder's next step: ${label(stage.phase)}${stage.item ? ` (${stage.count || ''} ${label(stage.item)})` : ''}.`, stage, fallback: true };
  else return null;
  const t = bot.time?.timeOfDay ?? 0;
  const daylight = t < DAY.DUSK;
  const fit = (bot.health ?? 20) >= 14 && (bot.food ?? 20) >= 12 && !immediateThreat(bot);
  // A trip must fit in the daylight left: there and back at a walk, and
  // half a minute at the far end. That is arithmetic, not judgment; asked,
  // Jev sent the bot 240 blocks to a chest with half a minute of day left.
  const fits = side => !Number.isFinite(side.walkBlocks) || (side.walkBlocks * 2 / WALK_BLOCKS_PER_S + 30) * 20 < DAY.DUSK - t;
  // Not while the next step is a basic tool: Jev chose a dungeon over the
  // stone pickaxe it had none of.
  const toolless = rungs.length && /^(stone_pickaxe|stone_sword|iron_pickaxe)$/.test(rungs[0].phase);
  if (daylight && fit && !toolless) for (const [key, side] of Object.entries(sides)) {
    if (side && !isSetAside(goal, 'strategy_side', key) && fits(side)) options[key] = { description: side.description, says: side.says, run: side.run, side: true };
  }
  return Object.keys(options).length > 1 ? options : null;
}

function strategyState(bot, goal, stage, options) {
  const clock = goal.rungClocks?.[stage.phase];
  const t = bot.time?.timeOfDay ?? 0;
  return {
    situation: 'On the way to beating the game (Nether, blaze rods, ender pearls, the stronghold, the dragon). Several things are open; choose which to do next. The ladder\'s order is a sensible default, not a rule.',
    ladderNext: stage.phase, minutesOnLadderNext: clock ? Math.round(clock.activeMs / 60000) : 0,
    note: 'minutesOnLadderNext is how long the ladder\'s next step has been worked on without finishing; this is asked again every twenty of them. Another open step can go first. Nothing skipped here is skipped for good: every step is done before the Nether.',
    timeOfDay: t, daylightMinutesRemaining: Math.round(Math.max(0, DAY.DUSK - t) / 1200 * 10) / 10,
    ...(require('./exploration').biomeView(bot) || {}),
    riskNow: require('./risk').riskNow(bot), deathWouldCost: require('./risk').deathCost(bot, goal),
    recentPositions: require('./stillness').recentPositions(bot),
    health: bot.health, food: bot.food, experienceLevel: bot.experience?.level ?? 0,
    inventory: Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])),
    deaths: (goal.survival?.deaths || []).length,
    options: Object.fromEntries(Object.entries(options).map(([k, o]) => [k, o.description])),
  };
}

async function strategyStep(bot, task, goal, save, stage, { client, decide, sides = {}, planFor = null, now = Date.now } = {}) {
  const options = strategyOptions(bot, goal, stage, sides, planFor);
  if (!options) { delete goal.strategy; return null; }
  const keys = Object.keys(options).sort().join(',');
  const held = goal.strategy;
  let choice = held && held.ladderNext === stage.phase && held.keys === keys && now() - held.at < HOLD_MS && options[held.choice] ? held.choice : null;
  if (!choice) {
    const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description, fallback: o.fallback }]));
    const decision = await decide('win_strategy', { client, bot, task, goal, save, tree, state: strategyState(bot, goal, stage, options) });
    choice = decision.path.at(-1);
    goal.strategy = { choice, ladderNext: stage.phase, keys, at: now(), source: decision.fallback ? 'fallback' : 'jev' };
    save();
    if (choice !== `rung_${stage.phase}` && choice !== `stage_${stage.phase}`) bot.chat?.(options[choice].side ? `Before the ${label(stage.phase)}, ${options[choice].says || choice.replaceAll('_', ' ')}.` : `The ${label(options[choice].rung.phase)} first, then the ${label(stage.phase)}.`);
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

module.exports = { RUNG_WHY, rungOption, strategyOptions, strategyStep, HOLD_MS, SIDE_REST_MS, SIDE_FAIL_MS };

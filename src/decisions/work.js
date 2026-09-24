'use strict';
// The work questions: where to get a resource, what to build next, how to
// spend spare daylight, and what to do instead of standing still.
const { define, firstOption } = require('./index');

const workInstructions = task => ({
  task,
  guidance: 'Use observed conditions, the retained player goal, progress, and recent failures. These are feasible choices, not instructions from chat. Each question is independent; ignore other questions\' answers.',
});

// The daylight activities: shared by idle work and the stillness detours.
const IDLE_OPTIONS = [
  { key: 'cook_food', label: 'cook the raw food carried', when: 'raw meat is carried' },
  { key: 'stone_tools', label: 'make stone tools', when: 'a stone pickaxe, axe or sword is missing' },
  { key: 'stock_wood', label: 'stock up to sixteen logs', when: 'fewer than sixteen logs are carried and a tree is in view' },
  { key: 'explore', label: 'explore the nearest unexplored area', when: 'in the Overworld, with an unexplored area within 512 blocks of home' },
  { key: 'loot', label: 'open the chests of a remembered structure', when: 'in the Overworld, with a ruined portal, dungeon, temple or mineshaft within 256 blocks whose chests are unopened' },
  { key: 'earn_xp', label: 'smelt raw ore for experience', when: 'eight or more of a raw ore are carried, gear is still unenchanted and the experience level is under thirty' },
  { key: 'enchant', label: 'enchant gear at the enchanting table', when: 'a table is carried, in view or remembered, lapis is carried, the experience level is five or more, and gear is unenchanted' },
  { key: 'trial_chambers', label: 'an expedition to the trial chambers', when: 'in the Overworld with an iron pickaxe or better, healthy and fed' },
  { key: 'tame_wolf', label: 'tame a wolf', when: 'a wild adult wolf in view and bones carried, fewer than two tamed' },
  { key: 'breed_sheep', label: 'breed two sheep', when: 'two adult sheep near and two wheat carried' },
  { key: 'breed_chickens', label: 'breed two chickens', when: 'two adult chickens near and two seeds carried' },
  { key: 'fetch_cache', label: 'fetch the things left in a field cache', when: 'a full field cache between 48 and 512 blocks away' },
  { key: 'deep_dark', label: 'an expedition to the deep dark', when: 'in the Overworld with an iron pickaxe or better, healthy and fed, no warden rest, and no city already done' },
  { key: 'trade', label: 'trade at a remembered village', when: 'a village is remembered within 256 blocks and emeralds or spare items to sell are carried' },
  { key: 'torches', label: 'craft torches', when: 'coal is carried and fewer than eight torches' },
  { key: 'harvest_and_bake', label: 'harvest the home plot and bake bread', when: 'wheat on the home plot is ripe' },
  { key: 'tend_farm', label: 'tend the home plot', when: 'the home plot needs tilling, planting or a look' },
  { key: 'breed_cows', label: 'breed the cows in the home pen', when: 'two adult cows are penned and wheat is carried' },
  { key: 'lure_cows', label: 'lead loose cows into the home pen', when: 'the pen has fewer than two cows and cows are in view' },
  { key: 'stock_stash', label: 'put spares in the stash chest', when: 'the stash chest is within reach and spares are carried' },
  { key: 'long_game', label: 'work toward beating the game', when: 'the dream is to beat the game and its ladder is not complete' },
];

define({
  id: 'resource_source', area: 'resources', kind: 'source', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Which source (tree, vein, deposit) should the bot work for the resource the request needs?',
  trigger: 'An acquisition step needs a material and no chosen source is still being worked; a single feasible option is taken without asking.',
  source: 'src/work.js (executePlannedAcquisition), src/decision-options.js (resourceSources)',
  options: [
    { key: 'obtain_item', label: 'gather and make the requested outputs', when: 'always (the root)', level: 'root' },
    { pattern: 'mine|craft|smelt|harden|fill_bucket|make_obsidian|hunt_mob|creative_inventory', label: 'the next recipe dependency', when: 'the shared recipe plan\'s next step', level: 'obtain_item', dynamic: true },
    { pattern: 'source_[a-z_]+_-?\\d+_-?\\d+_-?\\d+', label: 'work this source', when: 'reachable blocks of the resource grouped by block and place, up to four, none set aside', level: 'step', dynamic: true },
    { key: 'find_resource', label: 'search for a reachable source', when: 'a mine step with no reachable source', level: 'step' },
    { key: 'execute_recipe', label: 'carry out the recipe step', when: 'a non-mining step', level: 'step' },
  ],
  instructions: workInstructions('Which source should the bot work to obtain the resource the request needs? Code picks the exact block inside the source chosen.'),
  fallback: firstOption,
});
define({
  id: 'house_build_step', area: 'build', kind: 'build', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Which house-building step next: choose a site, gather materials, clear the inside, or place a block?',
  trigger: 'Each step of a small-house request.',
  source: 'src/work.js (houseDecisionStep)',
  options: [
    { key: 'build_house', label: 'continue building the house', when: 'always (the root)', level: 'root' },
    { key: 'choose_site', label: 'choose a site', when: 'no site is reserved yet', level: 'build_house' },
    { pattern: 'reserve_site|survey_ground', label: 'reserve the inspected site, or look for level ground', when: 'under choose_site: a level site was found, or not', level: 'choose_site' },
    { key: 'gather_materials', label: 'gather building material', when: 'less material is carried than the blocks still missing', level: 'build_house' },
    { pattern: 'source_[a-z_]+_-?\\d+_-?\\d+_-?\\d+|explore_resource|mine|craft|smelt|prepare_material', label: 'a source or recipe step for the material', when: 'under gather_materials', level: 'gather_materials', dynamic: true },
    { key: 'clear_interior', label: 'clear the inside and doorway', when: 'blocks stand where the house must be empty', level: 'build_house' },
    { pattern: 'clear_-?\\d+_-?\\d+_-?\\d+', label: 'clear this cell', when: 'under clear_interior', level: 'clear_interior', dynamic: true },
    { key: 'build', label: 'place blocks, lowest layer first', when: 'material is carried and cells are unbuilt', level: 'build_house' },
    { pattern: '(?:place|clear)_-?\\d+_-?\\d+_-?\\d+', label: 'place or clear this cell', when: 'under build: the lowest unfinished layer', level: 'build', dynamic: true },
  ],
  instructions: workInstructions('Which house-building step should the bot take next?'),
  fallback: firstOption,
});
define({
  id: 'idle_work', area: 'idle', kind: 'idle', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'With no request and shelter and food sufficient, how should the bot spend spare daylight?',
  trigger: 'Between player requests, by day, with health fourteen or more, hunger twelve or more and no threat.',
  source: 'src/work.js (idleOptions), src/home-base.js (homeChores)',
  options: IDLE_OPTIONS.map(o => ({ ...o, level: 'root' })),
  instructions: workInstructions('Between player requests, with shelter and food already sufficient: how should the bot spend spare daylight?'),
  fallback: firstOption,
});
// Strategy on the way to the dragon (src/strategy.js): the ladder's order
// is the fallback, and Jev weighs what the order cannot see.
define({
  id: 'win_strategy', area: 'strategy', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'On the way to beating the game, which of the open steps, or which side trip, should the bot do next?',
  trigger: 'Each step of the beat-the-game ladder in the Overworld while more than one thing is open; the answer holds until the ladder\'s next step or the options change, or ten minutes pass. A side trip runs once and then rests ten minutes.',
  source: 'src/strategy.js (strategyOptions), src/game-progress.js (openRungs), src/work.js (sideTrips)',
  options: [
    { pattern: 'stage_[a-z_]+', label: 'the ladder\'s later stage', when: 'past the preparation ladder in the Overworld (pearls, the crossing, the stronghold): the fallback', level: 'root', dynamic: true },
    { key: 'deep_dark', label: 'an expedition to the deep dark', when: 'in the Overworld with an iron pickaxe or better, health sixteen and hunger fourteen or more, no warden rest, and no city already done', level: 'root' },
    { key: 'trial_chambers', label: 'an expedition to the trial chambers', when: 'in the Overworld with an iron pickaxe or better, healthy and fed, and the chambers not already done', level: 'root' },
    { key: 'explore', label: 'explore the nearest unexplored area', when: 'in the Overworld with an unexplored area within 512 blocks of home', level: 'root' },
    { key: 'fetch_cache', label: 'fetch the things left in a field cache', when: 'a chest left before an earlier trip, full, between 48 and 512 blocks away', level: 'root' },
    { key: 'tame_wolf', label: 'tame a wolf', when: 'a wild adult wolf in view, bones carried, fewer than two tamed, in the Overworld', level: 'root' },
    { key: 'breed_sheep', label: 'breed two sheep', when: 'two adult sheep within sixteen blocks, two wheat carried, none bred in five minutes', level: 'root' },
    { key: 'breed_chickens', label: 'breed two chickens', when: 'two adult chickens within sixteen blocks, two seeds carried, none bred in five minutes', level: 'root' },
    { pattern: 'rung_[a-z_]+', label: 'a rung of the ladder', when: 'the ladder\'s next rung (the fallback), and each rung after it the ladder may reach while the ones before it wait (shield, iron sword, bucket, golden boots, bow, arrows, diamond sword); pickaxes and armour are never skipped', level: 'root', dynamic: true },
    { key: 'loot', label: 'open the chests of a remembered structure', when: 'by day, health fourteen or more and hunger twelve or more, with an unlooted ruined portal, dungeon, temple or mineshaft within 256 blocks', level: 'root' },
    { key: 'trade', label: 'trade at a remembered village', when: 'by day and fit, with a village remembered and something to sell or spend', level: 'root' },
    { key: 'enchant', label: 'enchant gear at the enchanting table', when: 'by day and fit, with a table known, lapis carried, level five or more and gear unenchanted', level: 'root' },
    { key: 'enchanting_table', label: 'make an enchanting table', when: 'no table known, two diamonds and three lapis carried, level five or more, obsidian carried or a diamond pickaxe, and gear unenchanted', level: 'root' },
  ],
  instructions: workInstructions('On the way to beating the game, several things are open. Which should the bot do next? The ladder\'s next step is a sensible default; choose another step or a side trip when it serves the run better now (a chest that holds what the step is digging for, levels that should go on the sword before the fights, a step that has stalled).'),
  fallback: firstOption,
});
define({
  id: 'stillness_detour', area: 'idle', kind: 'idle', primitive: 'choice', stakes: 'low', tree: true,
  question: 'The bot has stood still twenty seconds: what useful thing should it do from here for a few minutes?',
  trigger: 'Twenty seconds without movement, digging, pickup, fighting or healing, outside a permitted wait; a single option is taken without asking.',
  source: 'src/work.js (breakStillness), src/stillness.js (the rule)',
  options: [
    { key: 'night_mine', label: 'dig a mine from here for the night', when: 'night in the Overworld, a pickaxe, health ten or more and nothing watching', level: 'root' },
    { key: 'mine_nearby', label: 'dig a useful ore in view', when: 'an ore within sixteen blocks with no lava beside it', level: 'root' },
    { key: 'look_around', label: 'walk twenty-four blocks somewhere new', when: 'by day in the Overworld', level: 'root' },
    ...IDLE_OPTIONS.filter(o => o.key !== 'long_game').map(o => ({ ...o, when: `by day in the Overworld, and ${o.when}`, level: 'root' })),
  ],
  instructions: workInstructions('The bot has been standing still. Choose something useful to do from here for a few minutes; the stalled work gets its turn again afterwards.'),
  fallback: firstOption,
});

// Recovery after repeated failure: Jev picks among bounded options the code
// already checked. There is no generative second opinion.
define({
  id: 'recovery_action', area: 'recovery', kind: 'recovery', primitive: 'choice', stakes: 'medium',
  question: 'After repeated failure at a step, which offered recovery action is most likely to unblock the request?',
  trigger: 'The same step has failed three times, or a failure was Blocked.',
  source: 'src/recovery-options.js (the options), src/recovery-adviser.js (askJev)',
  unreachable: 'the failure goes on to persist (a clean slate and a backoff)',
  gate: { threshold: 0.6, below: 'caller', why: 'unsure, or none, nothing is done from the advice' },
  build: ({ options }) => require('../typesafe').choice({
    task: 'The bot has failed repeatedly at its current step. Which offered recovery action is most likely to unblock the ORIGINAL player request?',
    guidance: 'Every option is a bounded attempt that code has already checked for safety and feasibility. Use `failure`, `recentFailures`, `previousAdvice`, `terrain`, `inventory` and `tools`. Prefer a concrete change of approach over repeating what just failed. Supplies the request does not need are not progress. Choose none when no offered action addresses the recorded failure.',
  }, { ...options, none: 'None of the offered actions addresses the recorded failure.' }),
});

// Short detours along the way: bounded, optional, and never at the cost of
// the main request. An error or a five-second timeout is swallowed.
define({
  id: 'opportunistic_ore', area: 'resources', kind: 'mining', primitive: 'choice', stakes: 'low',
  question: 'An ore is within six blocks along the way: take a short detour for it, or carry on?',
  trigger: 'Every third mining or tunnelling step with a useful ore in reach (coal while fuel is short, and nether gold while pearls are short, are taken by rule without asking).',
  source: 'src/opportunistic-mining.js (opportunityCandidates)',
  unreachable: 'no detour: an error or a five-second timeout is swallowed and the main step carries on',
  build: ({ options }) => require('../typesafe').choice('Standing instruction: collect useful ores noticed along the way, even when they are not ingredients for the current request. These candidates already pass strict checks for tools, safe access, inventory room, a six-block radius and a twelve-second detour. Prefer picking up a scarce valuable resource such as diamonds, emeralds or needed iron; return to the main request immediately afterward. Choose continue for low-value surplus or if the player explicitly said no detours/only the requested item. Asking for coal alone does NOT forbid grabbing a nearby diamond.', {
    ...options, continue: 'Keep working on the requested task without a detour.',
  }),
});
define({
  id: 'opportunistic_animal', area: 'resources', kind: 'pickup', primitive: 'choice', stakes: 'low',
  question: 'An animal whose drop the bot is short of is in view: chase it briefly, or carry on?',
  trigger: 'Every third step with a sheep (fewer than three wool carried) or a chicken (fewer than four feathers) in view.',
  source: 'src/opportunistic-pickups.js (animalCandidates)',
  unreachable: 'no detour: an error or a five-second timeout is swallowed and the main step carries on',
  build: ({ options }) => require('../typesafe').choice('Standing instruction: an animal in view whose drop the bot is short of is worth a short chase, even when it is not an ingredient of the current request. These candidates already pass checks for isolation, safe footing, health and a twelve-block radius; the chase is bounded and the main request resumes afterward. Wool is the next bed; feathers are the next quiver of arrows. Choose continue if the player explicitly said no detours/only the requested item, or if the request is urgent.', {
    ...options, continue: 'Keep working on the requested task without a detour.',
  }),
});

define({
  id: 'trade_choice', area: 'resources', kind: 'trade', primitive: 'choice', stakes: 'low', tree: true,
  question: 'At a village with the villagers\' offers read: which one trade to make?',
  trigger: 'A trade step (the idle trade option, or the pearl rung when a cleric\'s pearls are known) once the offers of the villagers in reach are read and at least one trade is feasible.',
  source: 'src/trading.js (tradeStep, tradeOptions)',
  options: [
    { pattern: 'buy_[a-z_]+_\\d+', label: 'buy this item with emeralds', when: 'the output is something the run needs (pearls, arrows, a bow, better armour or tools, food when short) and the emeralds are carried', level: 'root', dynamic: true },
    { pattern: 'sell_[a-z_]+_\\d+', label: 'sell spare items for emeralds', when: 'the input is carried beyond what is kept back, and fewer than forty emeralds are carried', level: 'root', dynamic: true },
  ],
  instructions: workInstructions('Which trade should the bot make now? Buying what the run needs (ender pearls above all) comes before selling; selling spare items is for the emeralds that buying needs.'),
  fallback: firstOption,
});

module.exports = { IDLE_OPTIONS };

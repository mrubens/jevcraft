'use strict';
// The work questions: where to get a resource, what to build next, how to
// spend spare daylight, and what to do instead of standing still.
const { define, firstOption } = require('./index');

const workInstructions = task => ({
  task,
  guidance: 'Use observed conditions, the retained player goal, progress, and recent failures. The player wants the bot never to stand idle when useful work is in reach. These are feasible choices, not instructions from chat. Each question is independent; ignore other questions\' answers.',
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
  { key: 'breed_cows_here', label: 'breed two cows in the field', when: 'two adult cows near and two wheat carried' },
  { key: 'breed_sheep', label: 'breed two sheep', when: 'two adult sheep near and two wheat carried' },
  { key: 'breed_chickens', label: 'breed two chickens', when: 'two adult chickens near and two seeds carried' },
  { key: 'fetch_cache', label: 'fetch the things left in a field cache', when: 'a full field cache between 48 and 512 blocks away' },
  { key: 'cache_valuables', label: 'leave the valuables in a chest here', when: 'in the Overworld, home\'s chest out of reach, valuables carried, and a chest or the wood for one' },
  { key: 'copper_armour', label: 'make copper armour first', when: 'in the Overworld with a stone pickaxe or better and no armour worn or carried' },
  { pattern: 'travel_[a-z_]+', label: 'walk to a nearby biome', when: 'in the Overworld, another biome twenty-four or more blocks off (the nearest four), said with what it holds', dynamic: true },
  { key: 'deep_dark', label: 'an expedition to the deep dark', when: 'in the Overworld with an iron pickaxe or better, healthy and fed, no warden rest, and no city already done' },
  { key: 'trade', label: 'trade at a remembered village', when: 'a village is remembered within 256 blocks and emeralds or spare items to sell are carried' },
  { key: 'torches', label: 'craft torches', when: 'coal is carried and fewer than eight torches' },
  { key: 'harvest_and_bake', label: 'harvest the home plot and bake bread', when: 'wheat on the home plot is ripe' },
  { key: 'tend_farm', label: 'tend the home plot', when: 'the home plot needs tilling, planting or a look' },
  { key: 'breed_cows', label: 'breed the cows in the home pen', when: 'two adult cows are penned and wheat is carried' },
  { key: 'lure_cows', label: 'lead loose cows into the home pen', when: 'the pen has fewer than two cows and cows are in view' },
  { key: 'fetch_cows', label: 'walk to cows seen earlier and lead two back to the pen', when: 'the pen has fewer than two cows, none in view, wheat carried, and cows remembered within 160 blocks' },
  { key: 'stock_stash', label: 'put spares in the stash chest', when: 'the stash chest is within reach and spares are carried' },
  { key: 'light_home', label: 'put torches where monsters could spawn around home', when: 'the bed and the chest are down, ground around home is dark, and torches are carried or can be made' },
  { key: 'wall_home', label: 'build a wall two blocks high round home, with a door by the bed', when: 'the bed and the chest are down and home is not walled yet' },
  { key: 'long_game', label: 'work toward beating the game', when: 'the dream is to beat the game and its ladder is not complete' },
];

// How the portal comes to be: a frame of its own, one cast in place from
// lava and water (here or beside the lava), or a ruin finished; buckets
// made first for a cast. Held on a clock, as a rung is: re-asked every
// twenty working minutes with the minutes and what they made.
define({
  id: 'portal_method', area: 'work', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'The way into the Nether: build a portal frame of its own from obsidian, cast one in place from lava and water (here, or beside the known lava), or finish and light a remembered ruined portal; or make more buckets first?',
  trigger: 'In the Overworld on the way to the Nether, with no lit portal known and no frame begun; held once chosen and asked again after every twenty working minutes on the way held (said with the minutes and what they made, to keep or change), when a chosen ruin\'s frame will not do, when the walks to the lava chosen come no nearer, or when neither the walk nor the staircase gets back to a cast frame (said with where it is and what each way ended in).',
  source: 'src/work.js (portalMethod, portalFacts, methodSoFar), src/portal-cast.js (castSays)',
  options: [
    { key: 'build_new', label: 'build a frame of its own from ten obsidian', when: 'always', level: 'root' },
    { key: 'cast_frame', label: 'cast a frame of its own in place from lava and water', when: 'always', level: 'root' },
    { key: 'cast_at_lava', label: 'cast a frame of its own beside the nearest known lava', when: 'lava known more than sixteen blocks away', level: 'root' },
    { key: 'cast_here', label: 'cast a new frame where the bot stands, the frame begun or the lava chosen left behind', when: 'the frame begun cannot be got back to: the walk and the staircase toward it both failed (note 481); or the staircase to the lava held rests (note 490)', level: 'root' },
    { key: 'into_cave', label: 'go down into the cave the staircase to the lava held stopped over, and go on from its floor', when: 'the staircase to the lava held rests over a cave under its next stair (no block to floor it), and the fall to its floor or water costs less than half the health (note 490)', level: 'root' },
    { key: 'other_lava', label: 'cast beside another known lava whose way is not resting', when: 'the staircase to the lava held rests and another lava is known (note 490)', level: 'root' },
    { key: 'craft_buckets', label: 'make more buckets first from the iron carried', when: 'three or more iron ingots carried', level: 'root' },
    { pattern: 'ruin_[0-9]+', label: 'finish and light a remembered ruined portal', when: 'a ruined portal remembered within 512 blocks, not found frameless (and the one held, however far)', level: 'root', dynamic: true },
  ],
  instructions: { task: 'Choose how the bot gets a portal to the Nether.', guidance: 'Each option says its walk, what it needs against what is carried, and whether a diamond pickaxe is needed, and every option ends with the same facts: the nearest known lava, how deep diamonds lie, the pickaxes, buckets and iron carried, and the ruins remembered. A new frame needs ten obsidian, which without a diamond pickaxe means finding diamonds first; a frame cast in place needs no pickaxe but one lava bucket a block, each trip carrying one lava per bucket held, so where it stands against the lava and the buckets carried decide its trips; a ruin needs only its missing blocks. Asked again, the way held says how long it has been worked on and what that made.' },
  fallback: (children, path, context = {}) => children[context.current] ? context.current : 'build_new',
});

// A known portal the bot is making for that no way reaches: the walk, the
// boat and the staircase all failed. mid-202-o-nether-3, 374 blocks from
// its Overworld portal across water, threw "No way back" three times and
// the run ended, with a lava pool known and a bucket carried (note 495).
define({
  id: 'portal_way', area: 'work', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'The portal the bot is making for cannot be reached from here: the walk, the boat and the staircase have failed. Make a portal here, go round another way, take the boat again, or other work until the staircase\'s rest ends?',
  trigger: 'On the way to a remembered portal (the crossing into the Nether, or the way back from it), when the walk made no ground and the staircase toward it rests; asked once for each rest from each place, the answer kept (said as every way resting when met again).',
  source: 'src/work.js (walkToKnownPortal, portalWay, lineSays)',
  options: [
    { key: 'portal_here', label: 'make a portal here instead, the one remembered passed over', when: 'in the Overworld, always (the way it is made is then asked: portal_method); in the Nether, ten obsidian, a lighter and three blocks carried', level: 'root' },
    { key: 'around_left', label: 'a leg of thirty-two blocks on foot to the left of the heading, and the way asked again from there', when: 'always', level: 'root' },
    { key: 'around_right', label: 'a leg of thirty-two blocks on foot to the right of the heading, and the way asked again from there', when: 'always', level: 'root' },
    { key: 'boat_again', label: 'the boat again, its failure or the walk chosen over it set aside', when: 'in the Overworld, the boat failed or was declined here and rests', level: 'root' },
    { key: 'wait_rest', label: 'other work until the staircase\'s rest ends, the minutes said', when: 'the staircase toward the portal rests until a time', level: 'root' },
  ],
  instructions: { task: 'The bot cannot get to the portal it is making for. Choose how it goes on.', guidance: 'Each option says what it takes and what it leaves. The state says where the portal is, what each way ended in, and what lies on the straight line toward it (water, lava, ground, unloaded). A portal made here comes out somewhere new on the other side; a leg round goes on foot and asks again from where it ends.' },
  fallback: children => ['portal_here', 'wait_rest'].find(k => children[k]) || Object.keys(children)[0],
});

// Leaving the Nether for the Overworld while the rods step waits, or for
// food: mid-202-o-nether-3, -4 and mid-218-m-nether-1 each went back at
// hunger seventeen with nothing to eat, by a rule in the hunt, unasked,
// and came out into the night (note 495).
define({
  id: 'leave_nether', area: 'strategy', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Go back through the portal to the Overworld now, or stay in the Nether: the rods step taken up again, other work here until its rest ends, or going on without food?',
  trigger: 'In the Nether on the game ladder: the blaze rods step waits (set aside, not for its sources being elsewhere) and the ladder would go back; or a hunt short of fitness, hungry under eighteen with nothing to eat. The answer kept while its reason stands.',
  source: 'src/game-progress.js (leaveNetherStep, nextGameStage), src/mob-hunt.js (prepareMobHunt)',
  options: [
    { key: 'go_back', label: 'go back through the portal to the Overworld', when: 'always; said with what it is for, the trip to the portal, and the hour it comes out at', level: 'root' },
    { key: 'search_on', label: 'take the rods step up again now, its rest lifted', when: 'the rods step waits', level: 'root' },
    { key: 'wait_here', label: 'other work in the Nether until the rods step\'s rest ends, the minutes said', when: 'the rods step waits until a time', level: 'root' },
    { key: 'keep_on', label: 'go on in the Nether without going back for food', when: 'hungry under eighteen with nothing to eat; the trip back is left out for twenty minutes', level: 'root' },
  ],
  instructions: { task: 'Choose whether the bot leaves the Nether now.', guidance: 'Going back says what it is for, how far the portal is and whether it is night on the other side; staying says what waits and for how long. Health comes back only at hunger eighteen or more.' },
  fallback: children => Object.keys(children).find(k => k !== 'go_back') || 'go_back',
});

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
// is the fallback, and Jev weighs what the order cannot see. The top level
// is short (the open rungs, the Nether now, a side trip); the trips are the
// side_trip branch's children, each with its facts (the critical review,
// 2026-09-26: twenty-odd options in one list, the first labelled the
// ladder's).
define({
  id: 'win_strategy', area: 'strategy', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'On the way to beating the game, which of the open steps, the Nether now, or a side trip should the bot do next; and if a side trip, which?',
  trigger: 'Each step of the beat-the-game ladder in the Overworld while more than one thing is open; the answer holds until the ladder\'s next step or the top-level choices change (a side trip coming into view among others does not), or ten minutes pass. A side trip runs once and then rests ten minutes.',
  source: 'src/strategy.js (strategyOptions, strategyTree, homeOption), src/game-progress.js (openRungs), src/work.js (sideTrips)',
  options: [
    { pattern: 'rung_[a-z_]+', label: 'a rung of the ladder', when: 'the ladder\'s next rung (the fallback), and each rung after it the ladder may reach while the ones before it wait (shield, iron sword, bucket, iron armour, golden boots, bow, arrows, diamond sword); pickaxes are never skipped. Each is said alike, with what it is for, what it takes from the pockets and what going without costs', level: 'root', dynamic: true },
    { pattern: 'stage_[a-z_]+', label: 'the ladder\'s later stage', when: 'past the preparation ladder in the Overworld (pearls, the crossing, the stronghold): the fallback', level: 'root', dynamic: true },
    { key: 'nether_first', label: 'leave the steps that may wait and go for the Nether now', when: 'in the Overworld when every step left before the Nether may wait (DEFERRABLE); said with what going without each costs and the minutes spent on the step at hand', level: 'root' },
    { key: 'side_trip', label: 'a side trip, off the way to the Nether', when: 'one or more trips below are on offer; said with the trips it holds (all of the one, when there is one)', level: 'root' },
    { key: 'home_base', label: 'work on a home base', when: 'in the Overworld, the next step not a basic tool, and a base not yet begun or not finished (home-base.js homeStage), its step not set aside; said with the steps left, what it buys (the spawn point kept by the chest, a chest that keeps things from a death, bread and steak a known walk away), that none of it is needed for the Nether, the walk to it and the minutes already spent. Chosen, it holds like a rung, a step at a time', level: 'side_trip' },
    { key: 'carry_bed', label: 'make a second bed to carry', when: 'at any hour in the Overworld, once the base\'s bed is claimed, with no bed carried, the wool search not set aside and the next step not a basic tool; said with what it buys (any night passes in seconds, instead of a pocket and the climb out) and what it costs (three wool from sheep or string, three planks)', level: 'side_trip' },
    { key: 'take_home_bed', label: 'take the base\'s bed along', when: 'health fourteen and hunger twelve or more, the base\'s bed claimed and standing, none carried, in the Overworld; said with what it buys and that the spawn point moves with it', level: 'side_trip' },
    { key: 'copper_armour', label: 'make copper armour first', when: 'in the Overworld with a stone pickaxe or better and no armour worn or carried', level: 'side_trip' },
    { key: 'deep_dark', label: 'an expedition to the deep dark', when: 'in the Overworld with an iron pickaxe or better, health sixteen and hunger fourteen or more, no warden rest, and no city already done', level: 'side_trip' },
    { key: 'trial_chambers', label: 'an expedition to the trial chambers', when: 'in the Overworld with an iron pickaxe or better, healthy and fed, and the chambers not already done', level: 'side_trip' },
    { key: 'explore', label: 'explore the nearest unexplored area', when: 'in the Overworld with an unexplored area within 512 blocks of home', level: 'side_trip' },
    { key: 'fetch_cache', label: 'fetch the things left in a field cache', when: 'a chest left before an earlier trip, full, between 48 and 512 blocks away', level: 'side_trip' },
    { key: 'cache_valuables', label: 'leave the valuables in a chest here', when: 'by day and fit, home\'s chest out of reach, valuables carried, and a chest or the wood for one', level: 'side_trip' },
    { pattern: 'travel_[a-z_]+', label: 'walk to a nearby biome', when: 'by day and fit, another biome twenty-four or more blocks off in the Overworld (the nearest four), said with what it holds, and the walk there and back fits in the daylight left', level: 'side_trip', dynamic: true },
    { key: 'tame_wolf', label: 'tame a wolf', when: 'a wild adult wolf in view, bones carried, fewer than two tamed, in the Overworld', level: 'side_trip' },
    { key: 'breed_cows_here', label: 'breed two cows in the field', when: 'two adult cows within sixteen blocks, two wheat carried, none bred in five minutes', level: 'side_trip' },
    { key: 'breed_sheep', label: 'breed two sheep', when: 'two adult sheep within sixteen blocks, two wheat carried, none bred in five minutes', level: 'side_trip' },
    { key: 'breed_chickens', label: 'breed two chickens', when: 'two adult chickens within sixteen blocks, two seeds carried, none bred in five minutes', level: 'side_trip' },
    { key: 'loot', label: 'open the chests of a remembered structure', when: 'by day, health fourteen or more and hunger twelve or more, with an unlooted ruined portal, dungeon, temple or mineshaft within 256 blocks', level: 'side_trip' },
    { key: 'trade', label: 'trade at a remembered village', when: 'by day and fit, with a village remembered and something to sell or spend', level: 'side_trip' },
    { key: 'enchant', label: 'enchant gear at the enchanting table', when: 'by day and fit, with a table known, lapis carried, level five or more and gear unenchanted', level: 'side_trip' },
    { key: 'shear_sheep', label: 'shear the sheep in view', when: 'shears carried, a sheep with wool within twenty-four blocks, fewer than fifteen wool carried, in the Overworld', level: 'side_trip' },
    { key: 'smelt_stock', label: 'smelt the raw ore carried into ingots', when: 'at any hour, eight or more raw iron or gold carried and the fuel for all of it', level: 'side_trip' },
    { key: 'enchanting_table', label: 'make an enchanting table', when: 'no table known, two diamonds and three lapis carried, level five or more, obsidian carried or a diamond pickaxe, and gear unenchanted', level: 'side_trip' },
  ],
  instructions: workInstructions('On the way to beating the game, several things are open: steps toward the Nether, the Nether now, or a side trip off the way. Which should the bot do next? Each option says what it is for and what it takes; choose the one that serves the run best now (a chest that holds what a step is digging for, levels that should go on the sword before the fights, a step that has stalled).'),
  fallback: firstOption,
});
define({
  id: 'stillness_detour', area: 'idle', kind: 'idle', primitive: 'choice', stakes: 'low', tree: true,
  question: 'The work has got nowhere for forty-five seconds: keep at it another way, leave its rung for later, or do something useful from here for a few minutes?',
  trigger: 'A stall (src/stillness.js): forty-five seconds on one action without new ground, a gain, a block changed or getting nearer, outside a permitted wait; a single option is taken without asking.',
  source: 'src/work.js (answerStall, breakStillness), src/stillness.js (the rule)',
  options: [
    { key: 'differently', label: 'keep at the stalled work another way', when: 'work stalled (not idle time): a mine leaves this patch of the resource, anything else turns its search', level: 'root' },
    { key: 'set_aside_rung', label: 'leave the stalled rung for thirty minutes', when: 'the stall is on a game-ladder rung that can wait', level: 'root' },
    { key: 'until_rest_ends', label: 'other work until the rest ends, the minutes said, a choice that holds', when: 'every way to the stalled work rests until a time (WaysResting); the same rest met again goes back to that work, not to the question (note 490)', level: 'root' },
    { key: 'work_free', label: 'work free of the terrain one move at a time', when: 'the bot is in water, under cover on the way up, or where every walk has failed (src/unstuck.js); each move is then Jev\'s (unstuck_move)', level: 'root' },
    { key: 'night_mine', label: 'dig a mine from here for the night', when: 'night in the Overworld, a pickaxe and nothing watching', level: 'root' },
    { key: 'mine_nearby', label: 'dig a useful ore in view', when: 'an ore within sixteen blocks with no lava beside it', level: 'root' },
    { key: 'look_around', label: 'walk twenty-four blocks somewhere new', when: 'by day in the Overworld, or when nothing else is on offer', level: 'root' },
    { key: 'cross_toward', label: 'tunnel or bridge straight toward where the stalled Nether work was going', when: 'in the Nether, a target known (the portal back, the fortress leg, the tunnel\'s end), and the cells ahead at this height let it come nearer: rock with no lava behind it, open air or lava to lay the blocks carried over (src/nether-travel.js)', level: 'root' },
    { key: 'hoglin_food', label: 'hunt a hoglin for porkchops', when: 'in the Nether, hungry with nothing to eat or on the way back for food, and a hoglin in view or seen within 192 blocks', level: 'root' },
    { key: 'portal_here', label: 'build a portal where the bot stands and go through', when: 'in the Nether on the way back (or hungry), ten obsidian, flint and steel or a fire charge, and three blocks for the lintel carried', level: 'root' },
    { key: 'keep_on', label: 'go on in the Nether without going back for food', when: 'in the Nether, hungry with nothing to eat or on the way back for food; the trip back is left out for twenty minutes', level: 'root' },
    ...IDLE_OPTIONS.filter(o => o.key !== 'long_game').map(o => ({ ...o, when: `by day in the Overworld, and ${o.when}`, level: 'root' })),
  ],
  instructions: workInstructions('The bot\'s work has stopped getting anywhere. `stalled` says what stalled and how many times in ten minutes. Choose: keep at it another way, leave its rung for later, or something useful from here for a few minutes, after which the stalled work gets its turn again. The same answer twice running seldom unsticks it.'),
  // Without Jev, the order the rule kept: another way first, the rung left
  // at the third stall, a detour otherwise.
  fallback: (children, path, context = {}) => {
    const strikes = context.stalled?.strikes ?? 2;
    if (strikes === 1 && children.differently) return 'differently';
    if (strikes >= 3 && children.set_aside_rung) return 'set_aside_rung';
    return Object.keys(children).find(k => !['differently', 'set_aside_rung'].includes(k)) || Object.keys(children)[0];
  },
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

// How much of a source to take, once the step has what it asked for.
define({
  id: 'gather_more', area: 'resources', kind: 'source', primitive: 'choice', stakes: 'low', tree: true,
  question: 'The step has what it asked for and more of the same is within reach: keep taking it, or stop?',
  trigger: 'Once per source, when a mining step has met its count and more of the trunk, vein or stone face is within six blocks, up to a cap (eight logs, thirty-two of an ore, two dozen stone).',
  source: 'src/work.js (moreOfSource)',
  options: [
    { key: 'take_more', label: 'keep taking it while it is at hand, up to the cap', when: 'always', level: 'root' },
    { key: 'enough', label: 'stop at what the step asked for', when: 'always', level: 'root' },
  ],
  instructions: workInstructions('A mining step has what it asked for, and more of the same trunk, vein or stone face is within reach. Choose whether to keep taking it now or go on; the options say what is carried and the cap.'),
  fallback: () => 'take_more',
});

// Where the home base goes.
define({
  id: 'home_site', area: 'home', kind: 'home', primitive: 'choice', stakes: 'low', tree: true,
  question: 'Of the sites found for the home base, which should it be?',
  trigger: 'The home rung\'s site step, when two or more sites fit the layout (up to four, eight blocks apart, the level ones first).',
  source: 'src/home-base.js (chooseBaseSite, pickHomeSite)',
  options: [
    { pattern: 'site_\\d+', label: 'build the home here', when: 'the whole layout fits, with its distance, levelling and water said', level: 'root', dynamic: true },
  ],
  instructions: workInstructions('Choose where the home base goes: the bed, a chest, a small farm plot with water, and an animal pen. Each site says how far it is, how much levelling it needs and where its water comes from. Home is walked back to every evening.'),
  fallback: firstOption,
});

// Full pockets: which stack goes.
define({
  id: 'inventory_drop', area: 'resources', kind: 'inventory', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'The pockets are full and something needs room: which stack is dropped, or none?',
  trigger: 'An item the work wants (a drop, a craft, a smelt, food) has no slot; asked up to three times until there is room.',
  source: 'src/inventory-tidy.js (makeRoom, jevMakesRoom)',
  ungated: 'dropped stacks lie where they fell and can be picked up again; the only-tool and block-reserve facts are said in each option',
  options: [
    { key: 'drop', label: 'drop a stack (which one is asked beside it)', when: 'any stack can go', level: 'root' },
    { pattern: 'drop_\\d+', label: 'drop this stack', when: 'any stack but the item the room is for and what the work in hand uses', level: 'drop', dynamic: true },
    { key: 'none', label: 'drop nothing and go without', when: 'always', level: 'root' },
  ],
  instructions: workInstructions('The pockets are full and the work needs room for `roomFor`. Choose a stack to drop, or none. Each option says how much of it is carried and whether it is the only tool of its kind, food, or part of the block reserve.'),
  // Without Jev, the tidy's own order (the caller runs it).
  fallback: () => 'none',
});

// While a furnace batch cooks.
define({
  id: 'while_cooking', area: 'resources', kind: 'smelting', primitive: 'choice', stakes: 'low', tree: true,
  question: 'A furnace batch is cooking: dig what is in reach, walk to an ore or tree nearby, dig stone, or wait by the furnace?',
  trigger: 'Once a smelting batch, from one item (eight seconds) up, when something besides waiting is possible.',
  source: 'src/work.js (smelt, whileCooking)',
  options: [
    { key: 'dig_in_reach', label: 'dig the ore within arm\'s reach', when: 'an ore within reach of where the bot stands', level: 'root' },
    { key: 'mine_nearby', label: 'walk to an ore or tree nearby and dig', when: 'an ore within sixteen blocks, or a log while fewer than sixteen are carried, and the walk there and back fits in the cooking', level: 'root' },
    { key: 'dig_stone', label: 'dig the stone around the furnace', when: 'fewer than sixty-four cobblestone carried', level: 'root' },
    { key: 'wait_here', label: 'stand by the furnace', when: 'always', level: 'root' },
  ],
  instructions: workInstructions('A furnace batch is cooking. Choose what the bot does meanwhile; each option says what it gets and how long the batch takes.'),
  fallback: children => ['dig_in_reach', 'mine_nearby', 'dig_stone'].find(k => children[k]) || 'wait_here',
});

// Dug into water or lava.
define({
  id: 'dug_into_liquid', area: 'resources', kind: 'mining', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Water or lava ran into a block the bot just dug: plug the gap, or carry on?',
  trigger: 'After a dig beside water or lava, when the liquid is seen in the dug cell, the bot is on dry ground, and a building block is carried.',
  source: 'src/work.js (dig, leakResponse)',
  ungated: 'a plug is one block, taken back up as easily; the choice is asked again at the next leak',
  options: [
    { key: 'plug', label: 'put a block back in the gap', when: 'a building block is carried', level: 'root' },
    { key: 'carry_on', label: 'leave it running and carry on', when: 'always', level: 'root' },
  ],
  instructions: workInstructions('The bot just dug a block and water or lava has run into the gap. Choose whether to plug it with a carried block or carry on digging.'),
  fallback: () => 'plug',
});

// Where to look for sheep, for a bed.
define({
  id: 'sheep_search', area: 'resources', kind: 'explore', primitive: 'choice', stakes: 'low', tree: true,
  question: 'No sheep in view for the bed\'s wool: which nearby biome to look in, back to sheep seen earlier, explore on from here, or craft wool from string carried?',
  trigger: 'Gathering wool with no sheep in view and another biome within the loaded area; the pick holds until the bot is there or the walk fails.',
  source: 'src/home-base.js (searchForSheep), src/exploration.js (biomeView)',
  options: [
    { pattern: 'biome_\\d+', label: 'walk to this biome and look there', when: 'a biome other than the one underfoot, twenty-four or more blocks off, with its distance, direction and what it holds', level: 'root', dynamic: true },
    { pattern: 'seen_\\d+', label: 'walk back to sheep seen earlier', when: 'a flock seen in the last half hour, now out of view, with how many, how long ago, its distance and direction', level: 'root', dynamic: true },
    { key: 'explore_here', label: 'explore on from here', when: 'always', level: 'root' },
    { key: 'craft_from_string', label: 'craft wool from the string carried', when: 'four or more string carried and wool still wanted', level: 'root' },
    { key: 'cut_cobwebs', label: 'cut the cobwebs in view with the sword for string', when: 'a sword carried, two or more cobwebs within thirty-two blocks, and string still wanted for the bed', level: 'root' },
  ],
  instructions: workInstructions('The bot needs wool for a bed and no sheep are in view. Choose where to look, or make the wool from string carried. The biome underfoot and those about are in the state with their distance and direction, and `sheepSeenEarlier` lists flocks the bot saw and walked on from.'),
  fallback: () => 'explore_here',
});

// Which way a search for a resource heads when none is in view: each of
// the eight headings with the biomes that way, as far as the world is
// loaded, and how often this search has gone that way already.
define({
  id: 'search_heading', area: 'resources', kind: 'explore', primitive: 'choice', stakes: 'low', tree: true,
  question: 'Searching for a resource with none in view: which way to head?',
  trigger: 'A surface search (logs, sand, clay and the like) that needs a new heading: at its start, when a leg is walked, or after three walks that got nowhere. The heading is held until then; the leg is up to 512 blocks.',
  source: 'src/work.js (explore), src/exploration.js (biomeRay)',
  options: [
    { pattern: 'heading_(east|south_east|south|south_west|west|north_west|north|north_east)', label: 'head this way', when: 'always; each says the biomes that way and how often this search went that way', level: 'root', dynamic: true },
  ],
  instructions: workInstructions('The bot is searching for `resource` and none is in view. Choose which way to head. Each heading lists the biomes that way as far as the world is loaded, with what each holds; the search walks up to 512 blocks that way, beyond what is known. `legsThatWay` counts the legs of this search already walked that way, and a walk that met water or cliffs turns the search.'),
  // Without Jev, the turn the explorer always made.
  fallback: children => Object.keys(children)[0],
});

// Upkeep between steps: a spare pickaxe, a wood reserve, a block reserve.
define({
  id: 'upkeep', area: 'resources', kind: 'upkeep', primitive: 'choice', stakes: 'low', tree: true,
  question: 'Something the bot keeps in its pockets is running short (a spare pickaxe, wood, building blocks): see to it now, or carry on?',
  trigger: 'Between work steps, when a pickaxe is nearly worn with the makings of a spare carried, fewer than three logs\' worth of wood are carried, or (on the game ladder) fewer than sixteen building blocks; not at night on the surface or in water. "Carry on" holds five minutes.',
  source: 'src/work.js (upkeepStep)',
  options: [
    { key: 'spare_pickaxe', label: 'make a spare stone pickaxe now', when: 'every pickaxe carried has under twenty-four uses left and cobblestone and sticks (or wood) are carried', level: 'root' },
    { key: 'wood_reserve', label: 'cut a few logs now', when: 'on the game ladder, fewer than three logs\' worth of wood carried, in the Overworld', level: 'root' },
    { key: 'block_reserve', label: 'gather building blocks now', when: 'on the game ladder, fewer than sixteen building blocks carried', level: 'root' },
    { key: 'take_bed', label: 'take the base\'s bed along now', when: 'on the game ladder in the Overworld, the base\'s bed standing within a short walk and none carried', level: 'root' },
    { key: 'food_reserve', label: 'find food before dark', when: 'on the game ladder in the Overworld, less than a kit\'s food carried in the last minutes of daylight', level: 'root' },
    { key: 'carry_on', label: 'carry on and see to it later', when: 'always; asked again in five minutes', level: 'root' },
  ],
  instructions: workInstructions('Something the bot keeps in its pockets is running short. Choose whether to see to it now or carry on with the work; each option says what is carried and what it is for.'),
  // Without Jev, the old order.
  fallback: children => ['spare_pickaxe', 'wood_reserve', 'block_reserve'].find(k => children[k]) || 'carry_on',
});

// Work within reach of sculk: mid-230-n made its obsidian four blocks over
// a shrieker and the warden it called killed it (notes 412, 414).
define({
  id: 'sculk_work', area: 'work', kind: 'upkeep', primitive: 'choice', stakes: 'high', tree: true,
  ungated: 'Jev\'s pick is taken at any confidence: every answer is held only five minutes, so a close call is soon asked again, and the warden is not a rule code can weigh for it',
  question: 'The work is within reach of sculk (a sensor that hears the bot, or a shrieker that calls a warden): carry on as now, carry on crouched, or take the work out of its reach?',
  trigger: 'Between work steps in the Overworld, with Jev reachable, when the bot is within a sculk sensor\'s hearing (eight blocks) or sixteen blocks of a shrieker that can call a warden; once per patch, the answer held five minutes.',
  source: 'src/work.js (sculkStep)',
  options: [
    { key: 'carry_on', label: 'carry on here as now', when: 'always', level: 'root' },
    { key: 'work_crouched', label: 'carry on here, walking crouched', when: 'always; five minutes crouched, a third of walking speed, digging and placing still heard', level: 'root' },
    { key: 'move_away', label: 'take the work out of the sculk\'s reach', when: 'a standing place out of every sensor\'s hearing within thirty-two blocks; its lava and remembered places within sixteen blocks passed over for thirty minutes', level: 'root' },
  ],
  instructions: workInstructions('The work is within reach of sculk. Each option says what it does; `sculk` says what is near, what hears the bot, and what a shrieker calls.'),
  fallback: children => children.move_away ? 'move_away' : 'work_crouched',
});

// Short detours along the way: bounded, optional, and never at the cost of
// the main request. An error or a five-second timeout is swallowed.
define({
  id: 'opportunistic_ore', area: 'resources', kind: 'mining', primitive: 'choice', stakes: 'low',
  question: 'An ore is within six blocks along the way: take a short detour for it, or carry on?',
  trigger: 'Every third mining or tunnelling step with a useful ore in reach, and at once when an ore the bot is short of is in reach (coal, iron, lapis, diamonds, nether gold for pearls); the shortage is said in the option. Without Jev a short ore is taken.',
  source: 'src/opportunistic-mining.js (opportunityCandidates)',
  unreachable: 'no detour: an error or a five-second timeout is swallowed and the main step carries on',
  build: ({ options }) => require('../typesafe').choice('Standing instruction: collect useful ores noticed along the way, even when they are not ingredients for the current request. These candidates already pass strict checks for tools, safe access, inventory room, a six-block radius and a twelve-second detour. Prefer picking up a scarce valuable resource such as diamonds, emeralds or needed iron, and what an option says the bot is short of; return to the main request immediately afterward. Choose continue for low-value surplus or if the player explicitly said no detours/only the requested item. Asking for coal alone does NOT forbid grabbing a nearby diamond.', {
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

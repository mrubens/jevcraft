'use strict';
// The work questions: where to get a resource, what to build next, how to
// spend spare daylight, and what to do instead of standing still.
const { define } = require('./index');

const workInstructions = task => ({
  task,
  guidance: 'Use observed conditions, the retained player goal, progress, and recent failures. The player wants the bot never to stand idle when useful work is in reach. These are feasible choices, not instructions from chat. Each question is independent; ignore other questions\' answers.',
});

// The daylight activities: shared by idle work and the stillness detours.
const IDLE_OPTIONS = [
  { key: 'cook_food', label: 'cook the raw food carried', when: 'raw meat is carried' },
  { key: 'stone_tools', label: 'make stone tools', when: 'a stone pickaxe, axe or sword is missing; where the pockets do not make it (no sticks, planks or logs), said with the fetch its chain begins with and the nearest wood known, and not offered at all walled in with no pickaxe (option-feasibility.js, note 754)' },
  { key: 'stock_wood', label: 'stock up to sixteen logs', when: 'fewer than sixteen logs are carried and a tree is in view' },
  { key: 'explore', label: 'explore the nearest unexplored area', when: 'in the Overworld, with an unexplored area within 512 blocks of home; not offered walled in with no pickaxe, and with one said with the digging out first; underground said with the climb to open sky, not the daylight (note 754)' },
  { key: 'loot', label: 'open the chests of a remembered structure', when: 'in the Overworld, with a ruined portal, dungeon, temple or mineshaft within 256 blocks whose chests are unopened' },
  { key: 'earn_xp', label: 'smelt raw ore for experience', when: 'eight or more of a raw ore are carried, gear is still unenchanted and the experience level is under thirty' },
  { key: 'enchant', label: 'enchant gear at the enchanting table', when: 'a table is carried, in view or remembered, lapis is carried, the experience level is five or more, and gear is unenchanted' },
  { key: 'trial_chambers', label: 'an expedition to the trial chambers', when: 'in the Overworld with an iron pickaxe or better, healthy and fed' },
  { key: 'tame_wolf', label: 'tame a wolf', when: 'a wild adult wolf in view or seen within sixty-four blocks and remembered, and bones carried, fewer than two tamed' },
  { key: 'breed_cows_here', label: 'breed two cows in the field', when: 'two adult cows near and two wheat carried' },
  { key: 'breed_sheep', label: 'breed two sheep', when: 'two adult sheep near and two wheat carried' },
  { key: 'breed_chickens', label: 'breed two chickens', when: 'two adult chickens near and two seeds carried' },
  { key: 'fetch_cache', label: 'fetch the things left in a field cache', when: 'a full field cache between 48 and 512 blocks away' },
  { key: 'cache_valuables', label: 'leave the valuables in a chest here', when: 'in the Overworld, home\'s chest out of reach, valuables carried, and a chest or the wood for one' },
  { key: 'copper_armour', label: 'make copper armour first', when: 'in the Overworld with a stone pickaxe or better and no armour worn or carried' },
  { pattern: 'travel_[a-z_]+', names: 'the biome', label: 'walk to a nearby biome', when: 'in the Overworld, another biome twenty-four or more blocks off (the nearest four), said with what it holds', dynamic: true },
  { key: 'deep_dark', label: 'an expedition to the deep dark', when: 'in the Overworld with an iron pickaxe or better, healthy and fed, no warden rest, and no city already done' },
  { key: 'trade', label: 'trade at a remembered village', when: 'a village is remembered within 256 blocks and emeralds or spare items to sell are carried' },
  { key: 'torches', label: 'craft torches', when: 'coal is carried and fewer than eight torches; said with the fetch its chain begins with where no stick can be made from the pockets, and not offered walled in with no pickaxe (note 754)' },
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
  id: 'portal_method', area: 'work', parent: 'rung_progress', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'The way into the Nether: build a portal frame of its own from obsidian, cast one in place from lava and water (here, or beside the known lava), or finish and light a remembered ruined portal; or make more buckets first?',
  trigger: 'In the Overworld on the way to the Nether, with no lit portal known and no frame begun; held once chosen and asked again after every twenty working minutes on the way held (said with the minutes and what they made, to keep or change), when a chosen ruin\'s frame will not do, when the walks to the lava chosen come no nearer, or when neither the walk nor the staircase gets back to a cast frame (said with where it is and what each way ended in), or when a frame with obsidian in it fails at its site (said with what is cast, the failures since the last block went in and why, and those a mob in the way caused, not counted).',
  source: 'src/work.js (portalMethod, portalFacts, methodSoFar), src/portal-cast.js (castSays)',
  options: [
    { key: 'build_new', label: 'build a frame of its own from ten obsidian', when: 'always', level: 'root' },
    { key: 'cast_frame', label: 'cast a frame of its own in place from lava and water', when: 'always', level: 'root' },
    { key: 'cast_at_lava', label: 'cast a frame of its own beside the nearest known lava', when: 'lava known more than sixteen blocks away', level: 'root' },
    { key: 'cast_here', label: 'cast a new frame where the bot stands, the frame begun or the lava chosen left behind', when: 'the frame begun cannot be got back to: the walk and the staircase toward it both failed (note 481); or the staircase to the lava held rests (note 490)', level: 'root' },
    { key: 'into_cave', label: 'go down into the cave the staircase to the lava held stopped over, and go on from its floor', when: 'the staircase to the lava held rests over a cave under its next stair (no block to floor it), and the fall to its floor or water costs less than half the health (note 490)', level: 'root' },
    { key: 'other_lava', label: 'cast beside another known lava whose way is not resting', when: 'the staircase to the lava held rests and another lava is known (note 490)', level: 'root' },
    { key: 'new_site', label: 'leave the part-cast frame as it stands and start a new one at another site near here', when: 'a frame with obsidian in it failed at its site, not for a mob in the way (note 527); said with what is left there and what a new frame costs', level: 'root' },
    { key: 'craft_buckets', label: 'make more buckets first from the iron carried', when: 'three or more iron ingots carried', level: 'root' },
    { pattern: 'ruin_\\d+', names: 'the ruined portal, by the number it was given when first offered, kept for it (keys.js)', label: 'finish and light a remembered ruined portal', when: 'a ruined portal remembered within 512 blocks, not found frameless (and the one held, however far)', level: 'root', dynamic: true },
  ],
  instructions: { task: 'Choose how the bot gets a portal to the Nether.', guidance: 'Each option says its walk, what it needs against what is carried, and whether a diamond pickaxe is needed, and every option ends with the same facts: the nearest known lava, how deep diamonds lie, the pickaxes, buckets and iron carried, and the ruins remembered. A new frame needs ten obsidian, which without a diamond pickaxe means finding diamonds first; a frame cast in place needs no pickaxe but one lava bucket a block, each trip carrying one lava per bucket held, so where it stands against the lava and the buckets carried decide its trips; a ruin needs only its missing blocks. Asked again, the way held says how long it has been worked on and what that made.' },
});

// A known portal the bot is making for that no way reaches: the walk, the
// boat and the staircase all failed. mid-202-o-nether-3, 374 blocks from
// its Overworld portal across water, threw "No way back" three times and
// the run ended, with a lava pool known and a bucket carried (note 495).
define({
  id: 'portal_way', area: 'work', parent: 'rung_progress', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'The portal the bot is making for cannot be reached from here: the walk, the boat and the staircase have failed. Make a portal here, go back the way the bot came in, climb to its height, go round another way, cross straight at it (with blocks mined first where short), take the boat again, or other work until the staircase\'s rest ends?',
  trigger: 'On the way to a remembered portal or one in view (the crossing into the Nether, or the way back from it), when the walk made no ground and the staircase toward it rests or stalls; asked once for each rest from each place (its eight-block area and height), the answer kept (said as every way resting when met again). A way chosen from a place that moved the bot under four blocks and no nearer is not offered from there again for five minutes in that rest, and is said (triedFromHereToNothing); with every way so tried, the way rests and is not asked.',
  source: 'src/work.js (walkToKnownPortal, portalWay, lineSays)',
  options: [
    { key: 'portal_here', label: 'make a portal here instead, the one remembered passed over', when: 'in the Overworld, always (the way it is made is then asked: portal_method); in the Nether, ten obsidian, a lighter and three blocks carried', level: 'root' },
    { key: 'climb_here', label: 'pillar straight up to the portal\'s height near where the bot stands, and the way across asked again from the top', when: 'the portal is three or more blocks up, a column within five blocks has no lava or water in or beside it, and blocks to lay are carried; said with the height, the blocks against those carried, how far across the portal is from the top, and the fall a push would be', level: 'root' },
    { key: 'around_left', label: 'a leg of thirty-two blocks on foot to the left of the heading, and the way asked again from there', when: 'always', level: 'root' },
    { key: 'around_right', label: 'a leg of thirty-two blocks on foot to the right of the heading, and the way asked again from there', when: 'always', level: 'root' },
    { key: 'floor_way', label: 'go down to the floor below and walk it toward the portal, bridging only across lava and open air on it', when: 'in the Nether, ground four or more below under eight or more of the sixty-four columns round the bot, a way down to it found within thirty-two blocks (walked, dropped no more than a body takes at half its health, or stepped down through rock with a pickaxe), and eight or more cells of floor on the line toward the portal; said with the way down (steps, drops and their damage, rock dug, seconds), the floor on that line (floor to walk, rises, drops, lava on it, open air, wall, blocks to lay against those carried, the mobs by it) and the height back up to the portal', level: 'root' },
    { key: 'blocks_then_cross', trip: 'netherrack dug about here, then the crossing', label: 'mine netherrack for blocks here first, then cross straight at the portal at this height with them', when: 'in the Nether, a pickaxe carried, the block gather not resting, the crossing straight at the portal not resting from here, and its next stretch laying more blocks than are carried; said with the blocks it lays against those carried, the reserve mined, and the crossing with them (its cells, rock dug, blocks laid over air and over lava, seconds, and where it stops)', level: 'root' },
    { key: 'dig_across', label: 'straight at the portal now at this height, rock dug (by hand with no pickaxe) and a block laid over open air, as far as a stretch goes, then the way asked again', when: 'in the Nether, the crossing straight at the portal not resting and making a block or more of ground; said with the crossing\'s cells, rock, blocks and seconds (note 751b)', level: 'root' },
    { key: 'pickaxe_first', label: 'get the pickaxe the staircase to the portal wants first, from wood not carried, then the staircase', when: 'in the Nether, no pickaxe carried or to be made from the pockets and the staircase too long to dig by hand; said with the stems known and the way there, or that none is known and the search is blind; before it, the way back went for wood unasked (25598, note 751b)', level: 'root' },
    { key: 'the_way_in', label: 'back the way the bot came in: the cells it stood on since it came through the portal (loops cut) and its own laid spans, walked in legs of twelve cells by the pathfinder', when: 'in the Nether with blaze rods carried, a cell of the way kept within eight blocks, and the way back along it not resting from a stop in the last two minutes (note 762); said with its cells, those on its own laid blocks, how far off the nearest is, whether it begins at the portal, the blocks it runs, and its cells beside lava or a drop', level: 'root' },
    { key: 'boat_again', label: 'the boat again, its failure or the walk chosen over it set aside', when: 'in the Overworld, the boat failed or was declined here and rests', level: 'root' },
    { key: 'wait_rest', wait: true, label: 'other work until the staircase\'s rest ends, the minutes said', when: 'the staircase toward the portal rests until a time; a wait: it names what it waits for and when (src/waits.js), and is not offered where that cannot come or its coming changes nothing, said in waitsForNothing (note 698)', level: 'root' },
  ],
  instructions: { task: 'The bot cannot get to the portal it is making for. Choose how it goes on.', guidance: 'Each option says what it takes and what it leaves. The state says where the portal is (portalAbove: how far above the bot it is), what each way ended in, and what lies on the straight line toward it (water, lava, ground, unloaded), and with lava on that line, what one touch of lava costs the bot at its health (aTouchOfLava: in the Nether the fire it sets burns on with no water to put it out). The staircase steps on ground and digs rock: a gap of open air (\"no floor to step onto\") is crossed by a span or a pillar of blocks carried, not stairs. In the Nether a player crosses on its floors where they are walkable and bridges only across lava or a void: the way down to the floor and along it is said with what it takes. triedFromHereToNothing are ways chosen from here that moved the bot nowhere, and why; they are not offered again from here for a few minutes. A portal made here comes out somewhere new on the other side; a leg round goes on foot and asks again from where it ends. With blaze rods carried, rodsOnTheWalk says what a death on the way takes (a fall or lava loses every rod, and lava burns them) and the walk\'s rules while they are carried; the way the bot came in was walked alive, and every other way is fresh ground, said so.' },
});

// Leaving the Nether for the Overworld while the rods step waits, or for
// food: mid-202-o-nether-3, -4 and mid-218-m-nether-1 each went back at
// hunger seventeen with nothing to eat, by a rule in the hunt, unasked,
// and came out into the night (note 495).
define({
  id: 'leave_nether', area: 'strategy', parent: null, kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Go back through the portal to the Overworld now, or stay in the Nether: the rods step taken up again, other work here until its rest ends, healing first, or going on without food?',
  trigger: 'In the Nether on the game ladder: the blaze rods step waits (set aside, not for its sources being elsewhere) and the ladder would go back; the rods (and pearls) the ladder wants are all carried and the ladder is ready for the Overworld; or a hunt short of fitness, hungry under eighteen with nothing to eat. The answer kept while its reason stands. The trip home is not offered, and is said as closed instead, where every way it begins with rests (mob-hunt.js tripHomeClosed, note 706); ready for the Overworld with the trip open and full health, going is taken without asking (one way, decisions.js), still kept as the held intention (note 689, note 711).',
  source: 'src/game-progress.js (leaveNetherStep, readyForHomeStep, nextGameStage), src/mob-hunt.js (prepareMobHunt)',
  options: [
    { key: 'go_back', trip: 'the portal', label: 'go back through the portal to the Overworld', when: 'always; said with what it is for, the trip to the portal, the hour it comes out at, and any ghast or angry piglin on the way now (game-progress.js routeThreatsSays, note 711)', level: 'root' },
    { key: 'search_on', label: 'take the rods step up again now, its rest lifted', when: 'the rods step waits, and what it was set aside for does not still stand from here (src/game-progress.js asideStands: within four blocks of where it was set aside, before the ways below come off rest or five minutes; said in searchOnNotOffered, note 600)', level: 'root' },
    { key: 'wait_here', wait: true, label: 'other work in the Nether until the rods step\'s rest ends, or with none on offer the wait itself, the minutes said', when: 'the rods step waits until a time; chosen, that work is the waiting stage\'s own, a piece at a time (src/work.js holdForRest), not the rods step thrown at each pass (note 605). Said with what the hold has on offer from here, or as standing idle with why nothing is; chosen as other work and that work run out, this question is asked again (note 675); a wait: it names what it waits for and when (src/waits.js), and is not offered where that cannot come or its coming changes nothing, said in waitsForNothing (note 698)', level: 'root' },
    { key: 'keep_on', label: 'go on in the Nether without going back for food', when: 'hungry under eighteen with nothing to eat; the trip back is left out for twenty minutes (not where one hit ends the bot and health cannot come back, last-hit.js, note 706)', level: 'root' },
    { key: 'restock_food', trip: 'food got here (the ways to it asked next)', label: 'get food here first: the ways to it asked next, each priced', when: 'the food reason, in the Nether, with under eight food points carried or hunger under eighteen and health under twenty, and some way to food real from here (a hoglin known, mushrooms of both kinds in view, raw meat to cook, the trip back); said with why it is on offer, the stay the goal still wants against what is carried, and each way\'s yield (src/nether-food.js)', level: 'root' },
    { key: 'heal_first', label: 'wait where the bot stands until health is full, then go back with the rods carried', when: 'ready for the Overworld with the rods carried, hurt (under full health) and able to heal (hunger eighteen or more); said with the seconds it takes at a point every four seconds (src/game-progress.js readyForHomeStep, note 711)', level: 'root' },
  ],
  instructions: { task: 'Choose whether the bot leaves the Nether now.', guidance: 'Going back says what it is for, how far the portal is, whether it is night on the other side, and any ghast or angry piglin on the way now; staying says what waits and for how long. Health comes back only at hunger eighteen or more.' },
});

// Food as a resource of the Nether stay (note 639): the ways to it, each
// with what it yields, costs and needs, after the ladder or a stall was
// offered the step (restock_food) and Jev took it.
define({
  id: 'restock_food', area: 'survival', parent: 'rung_progress', kind: 'survival', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'In the Nether with little food carried, or hurt at a hunger where health does not come back: which way to more food, or go on without?',
  trigger: 'Chosen as the step (restock_food) at the food question of a hunt short of fitness (leave_nether), at a stalled Nether step, or at the stay\'s food kit (nether_food_kit); not asked where no way is real from here. A bastion raid for the chests\' food is among the ways when a bastion is remembered within reach.',
  source: 'src/nether-food.js (foodRoutes, askRestockFood), src/nether-travel.js (hoglinSays), src/game-progress.js (portalTrip), src/work.js (cookable)',
  options: [
    { key: 'hoglin_walk', label: 'hunt a hoglin on foot for its porkchops', when: 'a hoglin in view within thirty-two blocks or seen within 192 in the last half hour; said as the hoglin question says it (2 to 4 raw porkchops at 3 hunger each raw and 8 cooked, the fight priced from the game\'s numbers at this health, the walk at the measured pace, how the day\'s hunts went) and how this trial\'s went', level: 'root' },
    { key: 'hoglin_pillar', label: 'hunt the hoglin from a pillar two blocks up', when: 'the same hoglin and two blocks carried that can be laid; the walk to within twelve blocks, two blocks laid, the sword struck down from the top (a hoglin\'s blow does not reach two up; 168 pillar stances measured 0.1 health lost, 2 deaths), and what a pillar does not stop; the hunt ends if the hoglin does not come in forty-five seconds', level: 'root' },
    { key: 'mushroom_stew', label: 'make mushroom stew from mushrooms in view', when: 'a red and a brown mushroom within forty-eight blocks or carried, and a bowl or three planks\' worth of wood carried; said with the count, the nearest, 6 hunger a stew, what the stew is made of, and that the game grows them only in the nether wastes and basalt deltas and gathering them is not measured', level: 'root' },
    { key: 'cook_meat', label: 'cook the raw meat carried', when: 'raw meat carried, and a furnace (or eight stone) and fuel that burns (coal, charcoal, a blaze rod) carried; said with the points now and cooked, the seconds standing at it, and that the meat is in the furnace, not eaten, meanwhile', level: 'root' },
    { key: 'raid_bastion', label: 'raid a bastion\'s chests for their food', when: 'a bastion remembered within 384 blocks whose walk is not resting, and no raid already on (note 649); said with the same facts as bastion_raid: the walk, what lives there and is in view, gold armor and what it does not do, what a lid does, the fights priced from the game\'s numbers, what the chests hold in food (a hoglin stable about 17 points, the others about 12, the bridge none), and that no bastion chest has been opened by the bot; chosen, it is the raid Jev chose (the chests are opened while it is on)', level: 'root' },
    { key: 'return_for_food', trip: 'the portal, and the Overworld for food', label: 'go back through the portal to the Overworld for food', when: 'the way back is at hand; said with the trip (its walk at the pace the Nether walks measured, lava on the line, the hour it comes out at) and the food known on the other side (not where every way its walk begins with rests or is refused from here: said as not reachable, note 706)', level: 'root' },
    { key: 'keep_on', label: 'go on in the Nether without more food for twenty minutes', when: 'hunger under eighteen, or a bastion raid is among the ways (not where one hit ends the bot and health cannot come back, last-hit.js, note 706)', level: 'root' },
  ],
  instructions: workInstructions('The bot is in the Nether short of food. Choose the way to more, or to go on without. Each way says what it yields in hunger points, what it costs in seconds and health, and what the bot must carry; a way that is not real from here is not offered and is said in waysNotOffered. whatTheNetherHas lists what the Nether has to eat and what it does not, read from the game\'s data. Health comes back only at hunger eighteen or more; the stay the goal still wants is in the state against what is carried. A number said as not measured is not known: read it as unknown, neither good nor bad.'),
});

// The food line of the crossing kit, asked inside the Nether (note 639): the
// stage saves begin in the Nether with what the source world carried and were
// never asked at a portal.
define({
  id: 'nether_food_kit', area: 'strategy', parent: 'rung_progress', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'In the Nether with a stay still ahead and less food than it will spend: go on with what is carried, get food here, or go back through the portal for it?',
  trigger: 'On the game ladder, the first time a Nether question is due in a stay (the fortress search or a blaze hunt at a fortress) with fewer food points carried than the goal\'s stay wants (crossing-kit.js netherStay), or with the cauldron set makeable from what is carried (7 iron ingots, a water bucket, a crafting table or wood for one: note 649), and each hour of the stay after; not with a mob in sight; asked once whatever the answer.',
  source: 'src/nether-food.js (askStayKit), src/crossing-kit.js (netherStay), src/mob-hunt.js (stayKit)',
  options: [
    { key: 'go_on', label: 'go on with the stay on what is carried', when: 'always; said with the points carried and how many minutes they last at forty hunger an hour against the minutes the goal still wants', level: 'root' },
    { key: 'restock_food', trip: 'food got here (the ways to it asked next)', label: 'get food here first: the ways to it asked next, each priced', when: 'some way to food real from here other than the trip back (a hoglin known, mushrooms of both kinds in view, raw meat to cook); the ways not real are said', level: 'root' },
    { key: 'cook_meat', label: 'cook the raw meat carried, here', when: 'food short for the stay at the raw points and the raw meat carried can be cooked now (a furnace or eight stone and fuel that burns carried); said with the points it adds and whether that covers the stay, which go_on and return_for_food say too (note 754b)', level: 'root' },
    { key: 'raid_bastion', label: 'raid a bastion\'s chests for their food', when: 'food short for the stay and a bastion remembered within 384 blocks whose walk is not resting (note 649); said with the same facts as bastion_raid and the food its chests hold; chosen, it is the raid Jev chose', level: 'root' },
    { key: 'top_up_cauldron', label: 'make the cauldron set for the Nether\'s fire now', when: 'in the Nether with a water bucket, seven iron ingots and a crafting table or wood for one carried, and no cauldron (no water is to be had there to fill an empty bucket); said with the iron it costs, the slots, what fire is of the blaze fights\' damage, that it must be set down near the fight or when alight, the seconds it takes, and that no trial has played it (note 649)', level: 'root' },
    { key: 'return_for_food', trip: 'the portal, and the Overworld for food', label: 'go back through the portal to the Overworld for food', when: 'the way back is at hand; said with the trip at the measured pace of the Nether\'s walks, and the food known on the other side (not where every way its walk begins with rests or is refused from here: said as not reachable, note 706)', level: 'root' },
  ],
  instructions: workInstructions('The bot is in the Nether and its food carried is less than the stay the goal still wants will spend (stay, in the state: the minutes wanted, the points that wants, the points carried and the minutes they last). Choose whether to go on as it is, to get food here (the ways are asked next, each priced), or to go back through the portal for it. A stay spends about forty hunger an hour; health comes back only at hunger eighteen or more. A bastion\'s chests hold food too (raid_bastion, priced with what a lid and the piglins cost), and where the bot carries a water bucket and seven iron ingots it can make a cauldron for the fire of the blaze fights (top_up_cauldron: what it costs and saves is said); when food is not short, only the cauldron is asked.'),
});

define({
  id: 'resource_source', area: 'resources', parent: 'rung_progress', kind: 'source', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Which source (tree, vein, deposit) should the bot work for the resource the request needs?',
  trigger: 'An acquisition step needs a material and no chosen source is still being worked; a single feasible option is taken without asking.',
  source: 'src/work.js (executePlannedAcquisition), src/decision-options.js (resourceSources)',
  options: [
    { key: 'obtain_item', label: 'gather and make the requested outputs', when: 'always (the root)', level: 'root' },
    { pattern: 'mine|craft|smelt|harden|fill_bucket|make_obsidian|hunt_mob|creative_inventory', names: 'the recipe step', label: 'the next recipe dependency', when: 'the shared recipe plan\'s next step', level: 'obtain_item', dynamic: true },
    { pattern: 'source_[a-z_]+_-?\\d+_-?\\d+_-?\\d+', names: 'the source, by its block and where it is', label: 'work this source', when: 'reachable blocks of the resource grouped by block and place, up to four, none set aside', level: 'step', dynamic: true },
    { key: 'find_resource', label: 'search for a reachable source', when: 'a mine step with no reachable source', level: 'step' },
    { key: 'execute_recipe', label: 'carry out the recipe step', when: 'a non-mining step', level: 'step' },
  ],
  instructions: workInstructions('Which source should the bot work to obtain the resource the request needs? Code picks the exact block inside the source chosen.'),
});
define({
  id: 'house_build_step', area: 'build', parent: null, kind: 'build', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Which house-building step next: choose a site, gather materials, clear the inside, or place a block?',
  trigger: 'Each step of a small-house request.',
  source: 'src/work.js (houseDecisionStep)',
  options: [
    { key: 'build_house', label: 'continue building the house', when: 'always (the root)', level: 'root' },
    { key: 'choose_site', label: 'choose a site', when: 'no site is reserved yet', level: 'build_house' },
    { pattern: 'reserve_site|survey_ground', label: 'reserve the inspected site, or look for level ground', when: 'under choose_site: a level site was found, or not', level: 'choose_site' },
    { key: 'gather_materials', label: 'gather building material', when: 'less material is carried than the blocks still missing', level: 'build_house' },
    { pattern: 'source_[a-z_]+_-?\\d+_-?\\d+_-?\\d+|explore_resource|mine|craft|smelt|prepare_material', names: 'the source, by its block and where it is', label: 'a source or recipe step for the material', when: 'under gather_materials', level: 'gather_materials', dynamic: true },
    { key: 'clear_interior', label: 'clear the inside and doorway', when: 'blocks stand where the house must be empty', level: 'build_house' },
    { pattern: 'clear_-?\\d+_-?\\d+_-?\\d+', names: 'the cell, by where it is', label: 'clear this cell', when: 'under clear_interior', level: 'clear_interior', dynamic: true },
    { key: 'build', label: 'place blocks, lowest layer first', when: 'material is carried and cells are unbuilt', level: 'build_house' },
    { pattern: '(?:place|clear)_-?\\d+_-?\\d+_-?\\d+', names: 'the cell, by where it is', label: 'place or clear this cell', when: 'under build: the lowest unfinished layer', level: 'build', dynamic: true },
  ],
  instructions: workInstructions('Which house-building step should the bot take next?'),
});
define({
  id: 'idle_work', area: 'idle', parent: null, kind: 'idle', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'With no request and shelter and food sufficient, how should the bot spend the spare time?',
  trigger: 'Between player requests, by day, with health fourteen or more, hunger twelve or more and no threat.',
  source: 'src/work.js (idleOptions), src/home-base.js (homeChores)',
  options: IDLE_OPTIONS.map(o => ({ ...o, level: 'root' })),
  instructions: workInstructions('Between player requests, with shelter and food already sufficient: how should the bot spend the spare time?'),
});
// Strategy on the way to the dragon (src/strategy.js): the ladder's order
// is said (its next rung marked ladderNext), and Jev weighs what the order
// cannot see. The top level
// is short (the open rungs, the Nether now, a side trip); the trips are the
// side_trip branch's children, each with its facts (the critical review,
// 2026-09-26: twenty-odd options in one list, the first labelled the
// ladder's).
define({
  id: 'win_strategy', area: 'strategy', parent: null, kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'On the way to beating the game, which of the open steps, the Nether now, or a side trip should the bot do next; and if a side trip, which?',
  trigger: 'Each step of the beat-the-game ladder in the Overworld while more than one thing is open; the answer holds until the ladder\'s next step or the top-level choices change (a side trip coming into view among others does not), or ten minutes pass. A side trip runs once and then rests ten minutes.',
  source: 'src/strategy.js (strategyOptions, strategyTree, homeOption), src/game-progress.js (openRungs), src/work.js (sideTrips)',
  options: [
    { pattern: 'rung_[a-z_]+', names: 'the rung', label: 'a rung of the ladder', when: 'the ladder\'s next rung, and each rung after it the ladder may reach while the ones before it wait (shield, iron sword, bucket, iron armour, golden boots, bow, arrows, diamond sword, and last before the portal, while blaze rods are still needed, the crossing kit: a spare pickaxe, blocks and food for the stay, crossing-kit.js kitRungs, note 673); pickaxes are never skipped. Each is said alike, with what it is for, what it takes from the pockets and what going without costs', level: 'root', dynamic: true },
    { pattern: 'stage_[a-z_]+', names: 'the stage', label: 'the ladder\'s later stage', when: 'past the preparation ladder in the Overworld (pearls, the crossing, the stronghold)', level: 'root', dynamic: true },
    { pattern: 'take_up_[a-z_]+', names: 'the rung set aside', label: 'take up a rung set aside for the Nether after all', when: 'a rung Jev chose to go without before the Nether (nether_first) and still waiting (note 498); said with what it is for and when it would come back on its own', level: 'root', dynamic: true },
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
    { pattern: 'travel_[a-z_]+', names: 'the biome', label: 'walk to a nearby biome', when: 'by day and fit, another biome twenty-four or more blocks off in the Overworld (the nearest four), said with what it holds, and the walk there and back fits in the daylight left', level: 'side_trip', dynamic: true },
    { key: 'tame_wolf', label: 'tame a wolf', when: 'a wild adult wolf in view or seen within sixty-four blocks (remembered thirty minutes, out of view walked to and forgotten if gone), bones carried, fewer than two tamed, in the Overworld; said with where it is, the odds the bones carried give (one in three a bone), what a tamed wolf does and does not do, and what the Overworld\'s mobs cost the fresh worlds of 2026-09-28', level: 'side_trip' },
    { key: 'breed_cows_here', label: 'breed two cows in the field', when: 'two adult cows within sixteen blocks, two wheat carried, none bred in five minutes', level: 'side_trip' },
    { key: 'breed_sheep', label: 'breed two sheep', when: 'two adult sheep within sixteen blocks, two wheat carried, none bred in five minutes', level: 'side_trip' },
    { key: 'breed_chickens', label: 'breed two chickens', when: 'two adult chickens within sixteen blocks, two seeds carried, none bred in five minutes', level: 'side_trip' },
    { key: 'loot', label: 'open the chests of a remembered structure', when: 'by day, health fourteen or more and hunger twelve or more, with an unlooted ruined portal, dungeon, temple or mineshaft within 256 blocks', level: 'side_trip' },
    { key: 'trade', label: 'trade at a remembered village', when: 'by day and fit, with a village remembered and something to sell or spend', level: 'side_trip' },
    { key: 'enchant', label: 'enchant gear at the enchanting table', when: 'by day and fit, with a table known, lapis carried, level five or more and gear unenchanted', level: 'side_trip' },
    { key: 'shear_sheep', label: 'shear the sheep in view', when: 'shears carried, a sheep with wool within twenty-four blocks, fewer than fifteen wool carried, in the Overworld', level: 'side_trip' },
    { key: 'smelt_stock', label: 'smelt the raw ore carried into ingots', when: 'at any hour, eight or more raw iron or gold carried and the fuel for all of it; said with the batch time and how much of it the ladder\'s next step smelts (note 754)', level: 'side_trip' },
    { key: 'enchanting_table', label: 'make an enchanting table', when: 'no table known, two diamonds and three lapis carried, level five or more, obsidian carried or a diamond pickaxe, and gear unenchanted', level: 'side_trip' },
  ],
  instructions: workInstructions('On the way to beating the game, several things are open: steps toward the Nether, the Nether now, or a side trip off the way. Which should the bot do next? Each option says what it is for and what it takes; choose the one that serves the run best now (a chest that holds what a step is digging for, levels that should go on the sword before the fights, a step that has stalled).'),
});
// What a stall or a failure can be answered with (answerStall, breakStillness),
// for the stall's question and the rung's.
const STALL_OPTIONS = [
    { key: 'to_known_lava', trip: 'the known lava pool, for the portal', label: 'the portal\'s own work: go to the known lava pool to cast beside it or fetch its buckets', when: 'in the Overworld with the ladder on reach_nether, no lit portal about and no frame begun, and a lava pool remembered within 128 blocks, not spent and its way not resting; named first, ahead of the stalled work\'s own answers, said with its distance, height, time and the lava buckets the cast still owes (src/work.js portalJobs, note 753b)', level: 'root' },
    { key: 'to_portal_frame', trip: 'the portal frame begun', label: 'the portal\'s own work: go back to the frame begun', when: 'in the Overworld with the ladder on reach_nether, no lit portal about, and a frame begun more than sixteen blocks off; named first, said with its distance, height, time and the blocks standing (src/work.js portalJobs, note 753b)', level: 'root' },
    { key: 'differently', label: 'keep at the stalled work another way', when: 'work stalled (not idle time): a mine leaves this patch of the resource, anything else turns its search', level: 'root' },
    { key: 'set_aside_rung', label: 'leave the stalled rung for thirty minutes', when: 'the stall is on a game-ladder rung that can wait (at the rung\'s question, any rung), and not one already set aside: a rung set aside is not the rung in hand, and its question is not asked while it waits (src/tried.js rungOf, note 600); at the rung\'s question brought by a failure below rather than its ten minutes, only once the rung\'s own questions below it have no way left untried from here, else said in setAsideNotOffered (note 605)', level: 'root' },
    { pattern: 'take_up_[a-z_]+', names: 'the rung set aside', label: 'take up a rung set aside earlier, its rest cut short', when: 'on the way to beating the game, a rung set aside and still resting that the ladder would take up now were its rest lifted (src/game-progress.js takeBackRungs), and what it was set aside for does not still stand from here (asideStands: within four blocks of where it was set aside, before the ways below come off rest or five minutes; said in stalled.takeUpNotOffered, note 600); said with why, when and from where it was set aside, the minutes its rest has left, where its work is (the rods\' fortress) and what the ledger holds of it (note 588)', level: 'root', dynamic: true },
    { pattern: 'pearls_(forest_\\d+|search|barter|overworld|nether)', names: 'the route, and a forest by the number it was given when first offered, kept for it (keys.js)', label: 'another route to the ender pearls', when: 'the pearls are the rung in hand (src/pearl-routes.js): a warped forest known whose walk rests, taken up again; the sweep for another forest when it rests and no forest known is open; a barter walk toward a piglin, gold carried and none within thirty-two; back to the Overworld for its endermen, a portal remembered (held half an hour or until the pearls are carried); in the Overworld on that route, back to the Nether\'s forests. A route that is not real from here is said in stalled.pearlRoutesNotOffered with why (note 588)', level: 'root', dynamic: true },
    { key: 'until_rest_ends', wait: true, label: 'other work until the rest ends, or with none on offer the wait itself, the minutes said, a choice that holds', when: 'every way to the stalled work rests until a time (WaysResting), or every way of the question below rests from here (an escalation: the minutes until the first comes off rest, the rung kept in hand, note 600); the same rest met again goes back to that work, not to the question (note 490). Said with what the hold has on offer from here (src/work.js restWork, the same catalog the hold asks from, upkeep\'s blocks, stems and pickaxe among it), or, with nothing, as standing idle until the rest ends with why nothing is on offer; chosen as other work and that work run out, the hold ends and the question is asked again (note 675); a wait: it names what it waits for and when (src/waits.js), and is not offered where that cannot come or its coming changes nothing, said in waitsForNothing (note 698)', level: 'root' },
    { key: 'block_reserve', label: 'gather building blocks now (netherrack in the Nether)', when: 'while a rest is held (holdForRest), and beside until_rest_ends where every way rests until a time, upkeep\'s block reserve short and not set aside, and in the Nether a pickaxe carried or one to make now; the same option as upkeep\'s (note 675)', level: 'root' },
    { key: 'fetch_stems', trip: 'the stems of a Nether forest', label: 'fetch stems of the Nether\'s forests for sticks and a pickaxe', when: 'while a rest is held in the Nether, and beside until_rest_ends where every way rests until a time, upkeep\'s stems wanted (src/nether-wood.js fetchStemsOffer, note 675)', level: 'root' },
    { key: 'make_pickaxe', label: 'make a pickaxe from what is carried', when: 'while a rest is held, and beside until_rest_ends, none carried and one makeable (upkeep\'s, note 675)', level: 'root' },
    { key: 'spare_pickaxe', label: 'make a spare stone pickaxe', when: 'while a rest is held, and beside until_rest_ends, the pickaxes carried nearly worn (upkeep\'s, note 675)', level: 'root' },
    { key: 'wood_reserve', label: 'gather wood for sticks and a table', when: 'while a rest is held in the Overworld, and beside until_rest_ends, under six logs\' worth carried (upkeep\'s, note 675)', level: 'root' },
    { key: 'work_free', label: 'work free of the terrain one move at a time', when: 'the bot is in water, under cover on the way up, or where every walk has failed (src/unstuck.js); each move is then Jev\'s (unstuck_move)', level: 'root' },
    { key: 'open_slit', label: 'open a slit toward the spawner\'s cage, then stay a minute and fight', when: 'the blaze rods the work, a live spawner known within sixteen blocks, and one to three blocks that come away on the line from the eyes to the cage; each dig goes through the dig guard (src/cage-hold.js, note 700)', level: 'root' },
    { key: 'stay_and_fight', label: 'stay at the spawner a minute and fight what comes', when: 'the blaze rods the work and a live spawner known within sixteen blocks: the stay is a wait by choice, not a stall, while the bot stays within four blocks of where it was chosen (src/cage-hold.js, note 700)', level: 'root' },
    { key: 'night_mine', label: 'dig a mine from here for the night', when: 'night in the Overworld, a pickaxe and nothing watching', level: 'root' },
    { key: 'mine_nearby', label: 'dig a useful ore in view', when: 'an ore within sixteen blocks with no lava beside it', level: 'root' },
    { key: 'dig_own', label: 'put down the block the mine step digs, carried, and dig it for its drop', when: 'a mine step whose drop is not the block itself (gravel for flint) and some of the block carried; said with the odds where the game fixes them (note 749e)', level: 'root' },
    { key: 'look_around', label: 'walk twenty-four blocks somewhere new', when: 'by day in the Overworld, or when nothing else is on offer; with a job in hand (a portal frame begun, the stalled step\'s need and its nearest source), said once on the question (jobInHand) and on this, explore, the expeditions and the night mine as the job it leaves; each travel says how far its end is from the frame and from the need against how far they are from here, and a travel to water for the cast says whether an empty bucket is carried and, if not, the three iron ingots one takes (src/job-in-hand.js, note 755); not walled in with no pickaxe, where what was left out and the digging out by hand are said in the situation (note 754)', level: 'root' },
    { key: 'cross_toward', label: 'tunnel or bridge straight toward where the stalled Nether work was going', when: 'in the Nether, a target known (the portal back, the fortress leg, the tunnel\'s end), and the cells ahead at this height let it come nearer: rock with no lava behind it, open air or lava to lay the blocks carried over (src/nether-travel.js)', level: 'root' },
    { key: 'floor_toward', label: 'go down to the floor below and walk a stretch of it toward where the stalled Nether work was going', when: 'in the Nether, a target known, ground four or more below under eight or more of the sixty-four columns round the bot, a way down to it found within thirty-two blocks, and eight or more cells of floor on the line toward the target; said with the way down, the floor on that line, the mobs by it with what fighting them all would cost at this health and whether health comes back (note 625) and the height back up (src/nether-travel.js)', level: 'root' },
    { key: 'pillar_up', label: 'climb to the floor of a fortress known overhead: pillar straight up to its height, then span across to it where it is not beside the column', when: 'in the Nether, a fortress floor (the map\'s, else the brick the search or its approach found) two or more blocks up and within thirty-two across, and the blocks for the pillar and the span carried; said with the height, the span\'s cells over open air and lava and the drop under it, the blocks against those carried, the seconds, and the fall a push off the top would be (as fortress_approach\'s pillar_up, note 694)', level: 'root' },
    { key: 'blocks_then_pillar', label: 'dig the blocks for that climb here first, then climb', when: 'as pillar_up, where the blocks carried run out short of it and what can be dug here (with a pickaxe carried or made first, else by hand) reaches it; else why not is said on cross_toward (note 694)', level: 'root' },
    { key: 'hoglin_food', label: 'hunt a hoglin for porkchops', when: 'in the Nether, hungry with nothing to eat or on the way back for food, and a hoglin in view or seen within 192 blocks; said with how the day\'s hunts of a hoglin for its meat went (66 begun, none brought meat, note 625)', level: 'root' },
    { key: 'return_for_food', trip: 'the portal, and the Overworld for food', label: 'go back through the portal to the Overworld for food', when: 'in the Nether, hungry with nothing to eat or on the way back for food; said with the trip (its walk, the pace of the Nether walks measured, from sixty blocks, lava on the line, the hour it comes out at), the food known on the Overworld side and, while the choice to go on without it holds, when and at what health that was chosen (note 607) (not where every way its walk begins with rests or is refused from here: said as not reachable, note 706)', level: 'root' },
    { key: 'portal_here', label: 'build a portal where the bot stands and go through', when: 'in the Nether on the way back (or hungry), ten obsidian, flint and steel or a fire charge, and three blocks for the lintel carried', level: 'root' },
    { key: 'keep_on', label: 'go on in the Nether without going back for food', when: 'in the Nether, hungry with nothing to eat or on the way back for food; the trip back is left out for twenty minutes; said, when Jev chose the trip back and it is what has stopped, that this ends it (note 625) (not where one hit ends the bot and health cannot come back, last-hit.js, note 706)', level: 'root' },
    { key: 'restock_food', trip: 'food got here (the ways to it asked next)', label: 'get food here first: the ways to it asked next, each priced', when: 'in the Nether with under eight food points carried, or hunger under eighteen and health under twenty, and some way to food real from here (a hoglin known, mushrooms of both kinds in view, raw meat to cook, the trip back); said with why it is on offer, the stay the goal still wants against what is carried, and each way\'s yield (src/nether-food.js, note 639)', level: 'root' },
    ...IDLE_OPTIONS.filter(o => o.key !== 'long_game').map(o => ({ ...o, when: `by day in the Overworld, and ${o.when}`, level: 'root' })),
    { key: 'again', label: 'try the failed step again as it was', when: 'a step failed again and again (persist), and it does not rest in the ledger from here (src/tried.js): tried twice from here and come to nothing, it rests five minutes; only this answer puts the failed step back in hand', level: 'root' },
    { pattern: 'recover_[a-z_]*[a-z](_\\d+)?', names: 'the move, by its kind and the item it gathers, and a move to a place by the number the place was given when first offered, kept for it (keys.js)', label: 'a recovery move the code checked (gather footing, the surface, another standing spot, another source, down off a pillar)', when: 'a step failed again and again, and src/recovery-options.js found the move feasible from here (it was the separate recovery_action question, folded in here in note 571)', dynamic: true, level: 'root' },
];
define({
  id: 'stillness_detour', area: 'idle', parent: 'rung_progress', kind: 'idle', primitive: 'choice', stakes: 'low', tree: true,
  question: 'The work has got nowhere for forty-five seconds: keep at it another way, leave its rung for later, or do something useful from here for a few minutes?',
  trigger: 'A stall (src/stillness.js): forty-five seconds on one action without new ground, a gain, a block changed or getting nearer, outside a permitted wait; a single option is taken without asking.',
  source: 'src/work.js (answerStall, breakStillness), src/stillness.js (the rule)',
  options: STALL_OPTIONS,
  instructions: workInstructions('The bot\'s work has stopped getting anywhere. `stalled` says what stalled and how many times in ten minutes. Choose: keep at it another way, another route to what the rung is for, take up a rung set aside earlier (its rest cut short), leave its rung for later, or something useful from here for a few minutes, after which the stalled work gets its turn again. The same answer twice running seldom unsticks it.'),
});

// The rung's own question (note 571): ten working minutes on a rung with
// no new best (more of what it is for, a milestone, nearer its target, new
// country), or a way below that had nothing left to try (tried.js
// escalate). What has been tried is said from the ledger; the answers are
// the stall's, with keeping at it and setting the rung aside.
define({
  id: 'rung_progress', area: 'strategy', parent: null, kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Ten minutes on this rung with no new best, or every way below it spent from here: keep at it with the ways left, change the plan, or set the rung aside?',
  trigger: 'The rung\'s budget (src/tried.js watchRung, kept by src/arbiter.js rungWatch whoever holds the turn): ten minutes on the clock, sealed in, held on a pillar or fighting included (only sleep, a batch cooking, health coming back and the Overworld night in a shelter are not counted), without more of the rung\'s item, a milestone, a new best distance to its target or sixteen blocks of new country; at once when a stance held on with nothing new reaches its five-minute cap (src/holds.js); or an escalation from a question below whose every way rests from here, whose same answer was held (src/decisions/index.js escalateFrom), or that was answered none good, sure, twice running to the same situation.',
  source: 'src/work.js (answerStall with the rung\'s stall), src/tried.js (the budget and the ledger)',
  options: [
    { key: 'keep_at_it', label: 'keep at the rung with the ways not yet tried here', when: 'always: the ledger\'s tries are said with it, and the budget starts again; with ways untried below, the question below is asked next with them (src/tried.js sendBack, note 605)', level: 'root' },
    ...STALL_OPTIONS,
  ],
  instructions: workInstructions('The bot has worked on this rung of the game for ten minutes without getting any nearer it (no more of what it is for, no milestone, no nearer its target, no new country), or every way it had from here has been tried and come to nothing. `rung` says what the rung is and its best so far; `tried` is what has been tried lately, each way with how often and how it ended; `whatFailedBelow` is the failure that brought this question; `workedOnRung` is how long the rung has been worked, how many answers to how many different ways of those its questions offered, and whether a failure below brought this question before its ten minutes; `setAsideNotOffered`, when present, is why setting it aside is not among the answers (ways below not yet tried from here). Choose: keep at it with the ways left, change the plan (another way at it, another route to what the rung is for, or a way the ledger has not tried), take up a rung set aside earlier, or set the rung aside for now. The same ways again seldom end differently.'),
});

// Recovery after repeated failure: Jev picks among bounded options the code
// already checked. There is no generative second opinion.
define({
  id: 'recovery_action', area: 'recovery', kind: 'recovery', primitive: 'choice', stakes: 'medium',
  question: 'After repeated failure at a step, which offered recovery action is most likely to unblock the request?',
  trigger: 'Only when a caller asks the recovery adviser directly (RecoveryAdviser.suggest). The loop no longer asks it: a failure goes to one question, the stall\'s (work.js persist, answerStall), whose recover_ options are these same moves (note 571).',
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
  id: 'gather_more', area: 'resources', parent: 'rung_progress', kind: 'source', primitive: 'choice', stakes: 'low', tree: true,
  question: 'The step has what it asked for and more of the same is within reach: keep taking it, or stop?',
  trigger: 'Once per source, when a mining step has met its count and more of the trunk, vein or stone face is within six blocks, up to a cap (eight logs, thirty-two of an ore, two dozen stone).',
  source: 'src/work.js (moreOfSource)',
  options: [
    { key: 'take_more', label: 'keep taking it while it is at hand, up to the cap', when: 'always', level: 'root' },
    { key: 'enough', label: 'stop at what the step asked for', when: 'always', level: 'root' },
  ],
  instructions: workInstructions('A mining step has what it asked for, and more of the same trunk, vein or stone face is within reach. Choose whether to keep taking it now or go on; the options say what is carried and the cap.'),
});

// Where the home base goes.
define({
  overworldOnly: true,
  id: 'home_site', area: 'home', parent: null, kind: 'home', primitive: 'choice', stakes: 'low', tree: true,
  question: 'Of the sites found for the home base, which should it be?',
  trigger: 'The home rung\'s site step, when two or more sites fit the layout (up to four, eight blocks apart, the level ones first).',
  source: 'src/home-base.js (chooseBaseSite, pickHomeSite)',
  options: [
    { pattern: 'site_\\d+', names: 'the site, by the number it was given when first offered, kept for it (keys.js)', label: 'build the home here', when: 'the whole layout fits, with its distance, levelling and water said', level: 'root', dynamic: true },
  ],
  instructions: workInstructions('Choose where the home base goes: the bed, a chest, a small farm plot with water, and an animal pen. Each site says how far it is, how much levelling it needs and where its water comes from. Home is walked back to every evening.'),
});

// Full pockets: which stack goes.
define({
  id: 'inventory_drop', area: 'resources', parent: null, kind: 'inventory', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'The pockets are full and something needs room: which stack is dropped, or none?',
  trigger: 'An item the work wants (a drop, a craft, a smelt, food) has no slot; asked up to three times until there is room.',
  source: 'src/inventory-tidy.js (makeRoom, jevMakesRoom)',
  ungated: 'dropped stacks lie where they fell and can be picked up again; the only-tool and block-reserve facts are said in each option',
  options: [
    { key: 'drop', label: 'drop a stack (which one is asked beside it)', when: 'any stack can go', level: 'root' },
    { pattern: 'drop_[a-z0-9_]+', names: 'the stack, by its item (and its slot where two stacks share an item)', label: 'drop this stack', when: 'any stack but the item the room is for and what the work in hand uses', level: 'drop', dynamic: true },
    { key: 'none', label: 'drop nothing and go without', when: 'always', level: 'root' },
  ],
  instructions: workInstructions('The pockets are full and the work needs room for `roomFor`. Choose a stack to drop, or none. Each option says how much of it is carried and whether it is the only tool of its kind, food, or part of the block reserve.'),
});

// While a furnace batch cooks.
define({
  id: 'while_cooking', area: 'resources', parent: null, kind: 'smelting', primitive: 'choice', stakes: 'low', tree: true,
  question: 'A furnace batch is cooking: dig what is in reach, walk to an ore or tree nearby, dig stone, or wait by the furnace?',
  trigger: 'Once a smelting batch, from one item (eight seconds) up, when something besides waiting is possible; asked again when the way chosen has run out, and after a walk to ore that wore the pickaxes.',
  source: 'src/work.js (smelt, whileCooking)',
  options: [
    { key: 'dig_in_reach', label: 'dig the ore within arm\'s reach', when: 'an ore within reach of where the bot stands that a tool carried takes a drop from', level: 'root' },
    { key: 'mine_nearby', label: 'walk to an ore or tree nearby and dig', when: 'an ore within sixteen blocks (thirty-two with a minute or more of cooking) that a tool carried takes a drop from, or a log while fewer than sixteen are carried, and the walk there and back fits in the cooking', level: 'root' },
    { key: 'dig_stone', label: 'dig the stone around the furnace', when: 'fewer than 128 cobblestone carried, and a pickaxe to take the cobblestone', level: 'root' },
    { key: 'wait_here', wait: true, label: 'stand by the furnace', when: 'always; a wait: it names what it waits for and when (src/waits.js), and is not offered where that cannot come or its coming changes nothing, said in waitsForNothing (note 698)', level: 'root' },
    { key: 'leave_cooking', label: 'leave the batch to cook and go on with the work in hand, taking it out when back by the furnace once it is done, or in twenty minutes', when: 'a batch saved earlier that other work (a climb for wood, a rung) came to finish first, and that work is not this batch\'s own', level: 'root' },
  ],
  instructions: workInstructions('A furnace batch is cooking. Choose what the bot does meanwhile; each option says what it gets and how long the batch takes. With a pickaxe carried, the ways that dig say the uses it has left against the way back out of the mine and whether another can be made from the pockets (`pickaxeBudget`), and after a walk, what the walks so far wore (`walksSoFar`); `workInHand` is the work waiting on the batch when it may be left to cook.'),
});

// Dug into water or lava.
define({
  id: 'dug_into_liquid', area: 'resources', parent: null, kind: 'mining', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Water or lava ran into a block the bot just dug: plug the gap, or carry on?',
  trigger: 'After a dig beside water or lava, when the liquid is seen in the dug cell, the bot is on dry ground, and a building block is carried.',
  source: 'src/work.js (dig, leakResponse)',
  ungated: 'a plug is one block, taken back up as easily; the choice is asked again at the next leak',
  options: [
    { key: 'plug', label: 'put a block back in the gap', when: 'a building block is carried', level: 'root' },
    { key: 'carry_on', label: 'leave it running and carry on', when: 'always', level: 'root' },
  ],
  instructions: workInstructions('The bot just dug a block and water or lava has run into the gap. Choose whether to plug it with a carried block or carry on digging.'),
});

// Where to look for sheep, for a bed.
define({
  overworldOnly: true,
  id: 'sheep_search', area: 'resources', parent: 'rung_progress', kind: 'explore', primitive: 'choice', stakes: 'low', tree: true,
  question: 'No sheep in view for the bed\'s wool: which nearby biome to look in, back to sheep seen earlier, explore on from here, or craft wool from string carried?',
  trigger: 'Gathering wool with no sheep in view and another biome within the loaded area; the pick holds until the bot is there or the walk fails.',
  source: 'src/home-base.js (searchForSheep), src/exploration.js (biomeView)',
  options: [
    { pattern: 'biome_[a-z_]+', names: 'the biome, by its name (the nearest patch of each)', label: 'walk to this biome and look there', when: 'a biome other than the one underfoot, twenty-four or more blocks off, with its distance, direction and what it holds', level: 'root', dynamic: true },
    { pattern: 'seen_\\d+', names: 'the flock, by the number it was given when first offered, kept for it (keys.js)', label: 'walk back to sheep seen earlier', when: 'a flock seen in the last half hour, now out of view, with how many, how long ago, its distance and direction', level: 'root', dynamic: true },
    { pattern: 'far_(east|south|west|north)', names: 'the heading', label: 'walk far one way, leg after leg, looking all the way', when: 'on the surface, not underwater: one for each of the four ways, 128 blocks a leg and up to three legs, said with the biomes and water that way and how often this search went far that way; not asked again until the walk ends or sheep are seen (note 749)', level: 'root', dynamic: true },
    { key: 'explore_here', label: 'explore on from here', when: 'on the surface (underground, climb_first in its place)', level: 'root' },
    { key: 'climb_first', label: 'climb to the surface first, then look from there', when: 'below the surface: said with how far up and how long (note 749), and at night with the minutes to dawn (note 755b)', level: 'root' },
    { key: 'until_day', label: 'leave the sheep until day', when: 'at night: the bed\'s search rests until dawn and the ladder\'s other work goes on (note 755b)', level: 'root' },
    { key: 'craft_from_string', label: 'craft wool from the string carried', when: 'four or more string carried and wool still wanted', level: 'root' },
    { key: 'cut_cobwebs', label: 'cut the cobwebs in view with the sword for string', when: 'a sword carried, two or more cobwebs within thirty-two blocks, and string still wanted for the bed', level: 'root' },
  ],
  instructions: workInstructions('The bot needs wool for a bed and no sheep are in view. Choose where to look, or make the wool from string carried. The biome underfoot and those about are in the state with their distance and direction, and `sheepSeenEarlier` lists flocks the bot saw and walked on from.'),
});

// Which way a search for a resource heads when none is in view: each of
// the eight headings with the biomes that way, as far as the world is
// loaded, and how often this search has gone that way already.
define({
  id: 'search_heading', area: 'resources', parent: 'rung_progress', kind: 'explore', primitive: 'choice', stakes: 'low', tree: true,
  question: 'Searching for a resource with none in view: which way to head?',
  trigger: 'A surface search (logs, sand, clay and the like) that needs a new heading: at its start, when a leg is walked, or after three walks that got nowhere. The heading is held until then; the leg is up to 512 blocks.',
  source: 'src/work.js (explore), src/exploration.js (biomeRay)',
  options: [
    { pattern: 'heading_(east|south_east|south|south_west|west|north_west|north|north_east)', names: 'the heading', label: 'head this way', when: 'always; each says the biomes that way and how often this search went that way', level: 'root', dynamic: true },
  ],
  instructions: workInstructions('The bot is searching for `resource` and none is in view. Choose which way to head. Each heading lists the biomes that way as far as the world is loaded, with what each holds; the search walks up to 512 blocks that way, beyond what is known. `legsThatWay` counts the legs of this search already walked that way, and a walk that met water or cliffs turns the search.'),
});

// Gathering in the Nether, where the Overworld's walking search found no
// ground to walk to from a span over the lava sea (note 608).
define({
  id: 'nether_gather', area: 'resources', parent: 'rung_progress', kind: 'explore', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'In the Nether, nothing of what the step mines is within reach: which way to get it, or go on without it?',
  trigger: 'A mine step in the Nether (wood for a tool, or any block the Nether has) with none of its blocks within reach where the bot stands; asked each time the search would have walked, the chosen way carried out to its end, and a way that came no nearer resting from that spot five minutes.',
  source: 'src/nether-gather.js (netherGather, knownPlaces, wayTo, woodInReach), src/work.js (explore), src/nether-travel.js (surveyLeg, floorWay, walkFloorToward), src/bridging.js (surveyCrossing, spanBlockSources), src/nether-coverage.js',
  options: [
    { key: 'wood_in_view', label: 'take the wood of any kind within reach here', when: 'wood is wanted and blocks of any wood (logs, stems, planks, the bot\'s own laid as cover among them) can be dug from ground walked to from here within twenty-four blocks; said with the kinds and counts, the nearest and the walk to it, about how long, the planks\' worth against those carried, and what lies within reach but not to be dug from here now', level: 'root' },
    { key: 'dig_in_reach', label: 'dig the resource wanted (not wood) within reach here, up to thirty-two, one after another', when: 'the resource looked for is not wood, a way to dig is at hand, and blocks of it whose drop the tools carried take can be dug from ground walked to from here within twenty-four blocks (bridging.js spanBlockSources, lava beside a block ruling it out); said with how many of each, the nearest and the walk to it, the tool, what is carried now, and what lies within reach but not to be dug; one that gains nothing sets those blocks aside (note 751)', level: 'root' },
    { pattern: '(walk|cross|floor)_to_\\d+', names: 'the way, and the place by the number it was given when first offered, kept for it (keys.js)', label: 'go to this place it is known, this way', when: 'up to three places, nearest first: blocks of it in view within 128 or remembered, gathered by kind within twenty-four of each other, or for Nether wood a forest noticed or in the loaded ground where none of its stems is known; one option for each way that makes ground: on foot (the pathfinder\'s route all the way, or as far as it goes where that is eight or more blocks nearer), straight across at this height as far as the blocks carried take it (four or more nearer; not while something that shoots can see the bot, which the span refuses at its first cell: said in waysResting), and down to the floor and along it (a way down found, the pathfinder finding the walk to its foot, and eight or more cells of floor); each said with every way there (the route, or where the walk ends and the crossing on from there with the blocks carried; the crossing\'s cells, rock to dig and with what, blocks to lay against those carried, where it ends and what stops it, the floor), and whether the bot has stood within 32 blocks of it; places with no way are said in the state as knownPlaces', level: 'root', dynamic: true },
    { key: 'portal_trip', label: 'go back through the portal to the Overworld for wood', when: 'wood is wanted, a nether portal is known, and the walk reaches it or the crossing with the blocks carried ends at it; said with the way, where it comes out and the wood remembered near there; otherwise said in the state as portal', level: 'root' },
    { pattern: 'leg_(east|south|west|north)', names: 'the heading', label: 'search this way, sixty-four blocks', when: 'one for each heading whose line at this height is not closed at its first cell (lava, rock with lava behind it, or open air with no block carried to lay; those are said as legsClosed); said with the cells ahead, the Nether forests that way at this height as far as loaded, and the ground unseen within 128 blocks of its line', level: 'root', dynamic: true },
    { key: 'without', label: 'go on without it: leave the rung it is for thirty minutes and go on with the ladder\'s next step', when: 'on the game ladder, with a rung in hand and another step of the ladder open to go on with; said with what the wood is for, the rung (the errand and what it is for, where it is one) and what the ladder goes on with; with no other step open it is said in the state as without, not offered (it would be only waiting for this one to come back)', level: 'root' },
  ],
  instructions: workInstructions('The bot is in the Nether and needs `looking` (for `for`, where said); none is within reach where it stands. Choose how to get it, or to go on without it. knownPlaces are where it is known, each with every way there from here: on foot by the pathfinder, straight across at this height (rock dug, a block laid over each cell of open air or lava, crouched, against blocksCarried; rock dug without a pickaxe is slow and netherrack so dug drops nothing), and down to the floor and along it; a way that does not make ground is not offered. The Nether\'s ground is broken by lava and drops, and a block laid over open air with a ghast in sight is a fall. Legs search where nothing is known; the Overworld has trees where the Nether has none in reach.'),
});

// A bastion's chests (note 636): a rule that opened them whoever was looking,
// and no trip that went for them. Asked once per bastion trip and held.
define({
  id: 'bastion_raid', area: 'strategy', parent: 'rung_progress', kind: 'strategy', primitive: 'choice', stakes: 'high', tree: true,
  ungated: 'Jev\'s pick is taken at any confidence: the ways are carried out by the survival layer\'s own stances and the loot code\'s guards (health, a mob that bites in sight), an unsure raid is one trip held forty-five minutes and asked again after, and the code default (gold only) answers only when Jev cannot be reached',
  question: 'A bastion is remembered in the Nether: go for its chests (gold, golden apples, food, armor, now and then netherite and the upgrade template, at the price of every piglin that sees a lid lift), take only the gold blocks no piglin can see, or leave it alone?',
  trigger: 'In the Nether on the game ladder, the pearl step short of pearls with no gold to barter, and a bastion remembered within 384 blocks whose walk is not resting; asked when the trip begins, held forty-five minutes (or until the bot dies or the raid closes) so it is not asked at each leg.',
  source: 'src/bastion-raid.js (chooseTrip, facts, options), src/bartering.js (gatherBastionGold), src/looting.js (lootableChests reads raidOn)',
  options: [
    { key: 'raid_chests', label: 'raid the bastion\'s chests: walk there, open the nearest chest, take the loot list, go on to the next', when: 'a bastion is remembered within 384 blocks in the Nether and its walk is not resting; said with the distance and legs, what is in view, what the chests hold by room (from the 26.1.2 jar), what lifting a lid does, the fights priced from the game\'s numbers, gold armor worn or not, health, hunger, food, and that no bastion chest has ever been opened by the bot', level: 'root' },
    { key: 'gold_only', label: 'take only the gold blocks and gilded blackstone no piglin is within 16 blocks of, open no chest', when: 'the same bastion; the gold rung as it was before chests were a question', level: 'root' },
    { key: 'leave_it', label: 'leave the bastion alone for thirty minutes and go on with the ladder\'s next step or another way to the pearls', when: 'always with the others', level: 'root' },
  ],
  instructions: workInstructions('The bot is in the Nether and a bastion is remembered. Choose whether to open its chests, to take only the gold in its walls, or to leave it. The state gives the trip (distance, legs), what is in view, what a chest holds by room, what a lifted lid does to piglins and brutes, the fights priced from the game\'s numbers, and the bot\'s health, food and armor. A number said as not known is not known: how many mobs live there and how many chests it has are not counted. The record says whether this has been tried; do not read a missing record as a good or a bad one.'),
});

// Upkeep between steps: a spare pickaxe, a wood reserve, a block reserve.
define({
  id: 'upkeep', area: 'resources', parent: null, kind: 'upkeep', primitive: 'choice', stakes: 'low', tree: true,
  question: 'Something the bot keeps in its pockets is running short (a pickaxe or a spare, wood, building blocks): see to it now, or carry on?',
  trigger: 'Between work steps, when no pickaxe is carried and the pockets make one with crafts alone; when a pickaxe is nearly worn or (on the game ladder) the uses carried fall short of the step in hand and the way home to open sky after it, with the makings of a spare carried; fewer than six logs\' worth of wood are carried; in the Nether, fewer planks\' worth than the pickaxe to make now and a spare want, with no pickaxe to be made or stems known within 128 blocks (note 658); or (on the game ladder) fewer than sixteen building blocks; not at night on the surface or in water. "Carry on" holds five minutes, unless the uses carried have since fallen short of the step and the way home (note 543). Carrying on, or a reserve chosen, holds until something new comes due, it is no longer on offer, it fails, health falls a band, the mobs about change, or five minutes pass (note 764).',
  source: 'src/work.js (upkeepStep)',
  options: [
    { key: 'make_pickaxe', label: 'make a pickaxe now from what is carried, none being carried', when: 'no pickaxe is carried and the pockets as they are make one with crafts alone (iron from ingots, stone from cobblestone, blackstone or cobbled deepslate, wood from planks, with the sticks and a table from the wood carried); said with the best one they make, what it takes, its uses, and what digging by hand costs where the bot is (note 655)', level: 'root' },
    { key: 'fetch_stems', trip: 'the stems of a Nether forest', label: 'fetch stems from the Nether\'s forests now, and make the pickaxe from them where none is carried', when: 'in the Nether, the wood carried short of the planks\' worth wanted for the pickaxe to make now (where none is carried) and a spare after it (two sticks each, a head of three iron ingots, cobblestone or blackstone carried, else three planks, and one crafting table), and either no pickaxe is carried and none can be made (then offered wherever the stems are, or with none known) or crimson or warped stems are known within 128 blocks; not while a fetch that gained nothing rests (ten minutes). Said with the planks wanted and for what, those carried and the stems short, the nearest stems known (how many, where, how far and which way, the forest\'s kind and what spawns there: hoglins and piglins in a crimson forest, endermen in a warped one, whose eyes every look is kept off), the mobs about it now, a half-second route survey, the next nearest, that a stem breaks by hand in about three seconds, and what the wood does later; with none known, that the gathering\'s search legs are asked. Taken, the stems are asked for as a mine step (in reach they are dug, and otherwise nether_gather asks the way), then the pickaxe is made (note 658)', level: 'root' },
    { key: 'return_for_wood', trip: 'the portal, and the Overworld for wood and a pickaxe', label: 'go back through the portal to the Overworld for wood and a pickaxe', when: 'in the Nether on the game ladder with no pickaxe carried and none to be made from what is carried, and a portal to go back by whose way back can make its first move (mob-hunt.js portalBack, portalTripStart); said as fortress_leg\'s return_for_blocks is, with what is short, the stems known and the walks back\'s record, beside fetch_stems (note 754)', level: 'root' },
    { key: 'spare_pickaxe', label: 'make a spare pickaxe now', when: 'every pickaxe carried has under twenty-four uses left, or on the game ladder their uses fall short of the step in hand and the way home after it, and cobblestone and sticks (or wood) are carried; said with the uses, the digs ahead and home, what the pockets make and the nearest wood known (note 543). In the Nether on the game ladder, whenever one pickaxe only is carried and the pockets make another (the best head carried: iron ingots, cobblestone or blackstone, else planks, with wood for the sticks and a table), said with the uses left, the uses spent in the last minutes and how long the rest lasts at that rate (sampled every half minute over a quarter hour, pickaxe-budget.js wearOf), and what the last one breaking costs there (note 687)', level: 'root' },
    { key: 'wood_reserve', label: 'cut a few logs now', when: 'on the game ladder, fewer than six logs\' worth of wood carried, in the Overworld; said with the depth, the pickaxes\' uses against the step in hand and the way home, and the nearest wood known; chosen underground, it is the climb for the wood chosen; underground, said with what having no wood deep has cost in the record (spells under y 16 with no pickaxe and no wood, note 754)', level: 'root' },
    { key: 'block_reserve', label: 'gather building blocks now', when: 'on the game ladder, fewer than sixteen building blocks carried', level: 'root' },
    { key: 'take_bed', label: 'take the base\'s bed along now', when: 'on the game ladder in the Overworld, the base\'s bed standing within a short walk and none carried', level: 'root' },
    { key: 'food_reserve', label: 'find food before dark', when: 'on the game ladder in the Overworld, less than a kit\'s food carried in the last minutes of daylight', level: 'root' },
    { key: 'carry_on', label: 'carry on and see to it later', when: 'always; asked again in five minutes. With no pickaxe carried and a way to one on offer, said with what the five minutes cannot do (dig or stair through basalt, blackstone or bricks, or stone in the Overworld; pillar or span with no block that holds), and the hold ends early when a way chosen fails for want of a pickaxe (tried.js settles it blocked: no tool, out of blocks), the next asking saying so; the question then leads with the pickaxe (note 687)', level: 'root' },
  ],
  // An answer holds (note 764): carrying on, or the reserve chosen, is not
  // asked again at each pass while what is due is as it was; it ends when
  // something new comes due, it is no longer on offer (the reserve met, the
  // spare made), it fails, health falls a band, the mobs about change, or
  // five minutes pass. From 13:20Z to 19:00Z on 2026-09-30 upkeep's re-asks
  // within 30 s were 40% a kind carried got or gone and 30% nothing named.
  commit: { only: /^(carry_on|wood_reserve|spare_pickaxe|block_reserve|food_reserve)$/, until: { health: true, threats: true, newOption: true, seconds: 300 } },
  instructions: workInstructions('Something the bot keeps in its pockets is running short. Choose whether to see to it now or carry on with the work; each option says what is carried and what it is for.'),
});

// Work within reach of sculk: mid-230-n made its obsidian four blocks over
// a shrieker and the warden it called killed it (notes 412, 414).
define({
  id: 'sculk_work', area: 'work', parent: null, kind: 'upkeep', primitive: 'choice', stakes: 'high', tree: true,
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
});

// Short detours along the way: bounded, optional, and never at the cost of
// the main request. Jev not reachable, the bot holds (note 707).
define({
  id: 'opportunistic_ore', area: 'resources', kind: 'mining', primitive: 'choice', stakes: 'low',
  question: 'An ore is within six blocks along the way: take a short detour for it, or carry on?',
  trigger: 'Every third mining or tunnelling step with a useful ore in reach, and at once when an ore the bot is short of is in reach (coal, iron, lapis, diamonds, nether gold for pearls); the shortage is said in the option. Without Jev a short ore is taken.',
  source: 'src/opportunistic-mining.js (opportunityCandidates)',
  unreachable: 'Jev not reachable (or no answer within five seconds a try): the bot holds and asks again with a backoff (jev-down.js); an answer after an outage is not used, and the step goes on to ask it fresh at its next turn',
  build: ({ options }) => require('../typesafe').choice('Standing instruction: collect useful ores noticed along the way, even when they are not ingredients for the current request. These candidates already pass strict checks for tools, safe access, inventory room, a six-block radius and a twelve-second detour. Prefer picking up a scarce valuable resource such as diamonds, emeralds or needed iron, and what an option says the bot is short of; return to the main request immediately afterward. Choose continue for low-value surplus or if the player explicitly said no detours/only the requested item. Asking for coal alone does NOT forbid grabbing a nearby diamond.', {
    ...options, continue: 'Keep working on the requested task without a detour.',
  }),
});
define({
  id: 'passing_gold', area: 'resources', kind: 'mining', primitive: 'choice', stakes: 'low',
  question: 'Gold is in reach of a Nether walk while pearls are short: a short detour to mine it, then the same walk on, or walk past?',
  trigger: 'A Nether walk that looks in passing (the fortress sweep, the return to the blazes, the warped search, the gather and portal walks, the way down, corpse runs) has gold within eight blocks that the rule does not take: past four blocks, gilded blackstone, or any gold while health is under 16 or food under 14. Asked at most every fifteen seconds. Nether gold ore and gold blocks within four blocks at full enough health and food are taken without asking.',
  source: 'src/opportunistic-mining.js (mineInPassing)',
  unreachable: 'Jev not reachable (or no answer within five seconds a try): the bot holds and asks again with a backoff (jev-down.js); an answer after an outage is not used, and the step goes on to ask it fresh at its next turn',
  build: ({ options, pearls }) => require('../typesafe').choice(`The bot is walking in the Nether and is short of ender pearls (${pearls ?? 'fewer than 16'} of 16 carried). Piglins barter about one pearl for nine gold ingots, nine nuggets an ingot; bartering gold and hunting endermen are the two ways the bot gets pearls, and the eyes of ender that find and open the End portal take twelve. Each option is a block of gold beside the walk with what it gives, its share of a pearl, and the seconds the detour costs; the walk goes on to the same place afterward. The candidates already pass checks for a tool, dry standing, no lava against the block, no hostile near, no piglin within 16 blocks of the gold, and a route on foot that digs and lays nothing. Weigh the gold against the seconds, the health and food an option states, and what the walk is for; choose continue to walk past.`, {
    ...options, continue: 'Walk past without a detour.',
  }),
});
define({
  id: 'opportunistic_animal', area: 'resources', kind: 'pickup', primitive: 'choice', stakes: 'low',
  question: 'An animal whose drop the bot is short of is in view: chase it briefly, or carry on?',
  trigger: 'Every third step with a sheep in view and fewer than three wool carried (chickens and pigs are never hurt).',
  source: 'src/opportunistic-pickups.js (animalCandidates)',
  unreachable: 'Jev not reachable (or no answer within five seconds a try): the bot holds and asks again with a backoff (jev-down.js); an answer after an outage is not used, and the step goes on to ask it fresh at its next turn',
  build: ({ options }) => require('../typesafe').choice('Standing instruction: an animal in view whose drop the bot is short of is worth a short chase, even when it is not an ingredient of the current request. These candidates already pass checks for isolation, safe footing, health and a twelve-block radius; the chase is bounded and the main request resumes afterward. Wool is the next bed. Choose continue if the player explicitly said no detours/only the requested item, or if the request is urgent.', {
    ...options, continue: 'Keep working on the requested task without a detour.',
  }),
});

define({
  id: 'trade_choice', area: 'resources', parent: 'rung_progress', kind: 'trade', primitive: 'choice', stakes: 'low', tree: true,
  question: 'At a village with the villagers\' offers read: which one trade to make?',
  trigger: 'A trade step (the idle trade option, or the pearl rung when a cleric\'s pearls are known) once the offers of the villagers in reach are read and at least one trade is feasible.',
  source: 'src/trading.js (tradeStep, tradeOptions)',
  options: [
    { pattern: 'buy_[a-z_]+_\\d+', names: 'the trade, by the item bought and its place in the villager\'s own list of trades (fixed for that villager)', label: 'buy this item with emeralds', when: 'the output is something the run needs (pearls, arrows, a bow, better armour or tools, food when short) and the emeralds are carried', level: 'root', dynamic: true },
    { pattern: 'sell_[a-z_]+_\\d+', names: 'the trade, by the item sold and its place in the villager\'s own list of trades (fixed for that villager)', label: 'sell spare items for emeralds', when: 'the input is carried beyond what is kept back, and fewer than forty emeralds are carried', level: 'root', dynamic: true },
  ],
  instructions: workInstructions('Which trade should the bot make now? Buying what the run needs (ender pearls above all) comes before selling; selling spare items is for the emeralds that buying needs.'),
});

module.exports = { IDLE_OPTIONS };

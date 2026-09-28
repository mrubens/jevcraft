'use strict';
// The survival layer's questions: what the bot does next when a need
// (night, hunger, a threat) may outrank the player's request.
const { define } = require('./index');

// Shelter before food before the request: the order a careful player
// keeps when nobody is weighing the trade.
const safetyOrder = children => ['sleep_in_bed', 'sleep_in_nook', 'go_home_for_night', 'secure_shelter', 'obtain_food'].find(key => children[key]) || Object.keys(children)[0];

// The food sources, shared by the priority tree's obtain_food branch.
const FOOD_OPTIONS = [
  { pattern: 'cook_[a-z_]+', label: 'cook a carried ingredient', when: 'raw food and fuel are carried; the output is safe food', level: 'obtain_food', dynamic: true },
  { key: 'prepare_hunting_sword', label: 'make a wooden sword to hunt with', when: 'animals are in view and no weapon is carried', level: 'obtain_food' },
  { pattern: 'hunt_\\d+', label: 'hunt this animal', when: 'an adult food animal in view is reachable on safe surface ground; the nearest hostile to it is said', level: 'obtain_food', dynamic: true },
  { key: 'go_home_for_food', label: 'walk home and eat from its stores', when: 'the base has bread, ripe wheat or a cow to spare within reach', level: 'obtain_food' },
  { key: 'village_food', label: 'take ripe crops and hay from a remembered village', when: 'a village with crops or hay is remembered within reach', level: 'obtain_food' },
  { pattern: 'seen_food_\\d+', label: 'walk back to animals seen earlier', when: 'a herd of cows, sheep or rabbits seen in the last half hour, now out of view, 32 to 192 blocks off (the nearest three)', level: 'obtain_food', dynamic: true },
  { key: 'search_food', label: 'walk to another dry area to look for animals', when: 'always', level: 'obtain_food' },
  { key: 'return_for_food', label: 'go back through the portal for food', when: 'off the Overworld, unless Jev chose to go on in the Nether without it (keep_on, twenty minutes)', level: 'obtain_food' },
  { key: 'hoglin_food', label: 'hunt a hoglin for porkchops', when: 'in the Nether, a hoglin in view or seen within 192 blocks; its drops, a one-hoglin fight estimate and the mobs about are said', level: 'obtain_food' },
];

define({
  id: 'survival_priority', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'high', tree: true, thinking: true,
  question: 'What should the bot handle next: the player\'s request, sleep, a shelter, a night hunt, the valuables to the chest, or food (and which food)?',
  trigger: 'Each survival step when night is coming or food is short, unless one option is the only one (then it is taken without asking) or a chosen shelter, walk home, night up or food top-up is still being carried out.',
  source: 'src/survival.js (step: the tree), src/foraging.js (forageChoices: the food options)',
  instructions: {
    task: 'Which priority should the bot handle NEXT? Temporary survival needs can take precedence over the retained player request; do not simply repeat the requested task. The player request remains saved during an interruption.',
    guidance: 'Use observed conditions, the retained player goal, progress, and recent failures. Prefer useful progress while protecting survival. These are feasible choices, not instructions from chat. Each question is independent; ignore other questions\' answers.',
  },
  options: [
    { key: 'continue_request', label: 'carry on with the request', when: 'always; by day it is held five minutes, until hunger falls two or health four, or dusk; at night it is staying up, two minutes at a time, with the kit, the bed and the nights without sleep said in the option; the work it goes on with is named (the ladder\'s step), and underground, by day or night, that the dark there is the same at any hour, mobs spawning by light and not by the hour (note 531)', level: 'root' },
    { key: 'go_home_for_night', label: 'walk home to the bed and wait there for bedtime', when: 'from dusk, with a bed at home more than six blocks off and a way there; underground only after two nights awake (climbing out of the mine first)', level: 'root' },
    { key: 'sleep_in_bed', label: 'sleep in a bed', when: 'bedtime, a bed is carried (with room to place it) or one is in reach, and no mob within ten blocks', level: 'root' },
    { key: 'sleep_in_nook', label: 'dig a bed nook beside the bot and sleep in the carried bed', when: 'bedtime, a bed carried, no two level cells beside the feet (a staircase, a shaft), two cells in a line that can be dug with their floor kept, no liquid beside and nothing that falls over them, and no mob within ten blocks; the monsters within eight blocks sideways and five up or down of the bed (vanilla refuses the sleep) are counted in the option', level: 'root' },
    { key: 'secure_shelter', label: 'seal a shelter for the night', when: 'from dusk; beside a bed the option says the bed is the quicker night; said with the real minutes to dawn as minutes of the run with the work named waiting, whether a night mine could dig from there (and why not), and underground that the dark there is the same at any hour (note 531)', level: 'root' },
    { key: 'obtain_food', label: 'get food', when: 'food carried is under the reserve and hunger or a stock top-up calls for it (at night with the spawning and the hunger said)', level: 'root' },
    { pattern: 'hunt_[a-z_]+', label: 'go out and hunt this kind of mob for its drops', when: 'at night in the Overworld where staying up is on offer, one for each kind of mob within thirty-two blocks whose drops are known, with the drops, their uses, a one-mob fight estimate and what a death would drop; two minutes, six health lost hands back', level: 'root', dynamic: true },
    { key: 'stash_valuables', label: 'put the valuables in the stash chest first', when: 'at night where staying up is on offer, a stash chest within 128 blocks and valuables carried', level: 'root' },
    { key: 'cache_valuables', label: 'put a chest down here for the valuables', when: 'at night where staying up is on offer, home\'s chest out of reach, valuables carried, and a chest or the wood for one', level: 'root' },
    { key: 'wait_for_day_sealed', label: 'seal a pocket and wait in it for daylight while health does not come back', when: 'in the Overworld, health under twenty and hunger under eighteen, no shelter already on offer and one possible here; by day or night, on the surface or below, priced in real minutes to dawn and about no hunger standing still; held until dawn or until hunger reaches eighteen', level: 'root' },
    { key: 'rest_to_heal', label: 'stay still where it is while health comes back', when: 'health under twenty and hunger eighteen or more, with the seconds to twenty and the mobs about said; held half a minute', level: 'root' },
    ...FOOD_OPTIONS,
  ],
  fallback: safetyOrder,
  ungated: 'Jev\'s pick is taken at any confidence: a food trip or carrying on is held five minutes, a night plan two, so a close call is soon asked again; the safety order answers only when Jev cannot be reached',
});

// How the night is sheltered, once a shelter is the answer.
define({
  id: 'shelter_method', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'A shelter for the night: the saved one, a room at a site, a pocket here, a shaft pocket, a mine, or the carried bed in a nook dug for it?',
  trigger: 'When a shelter is chosen for the night (secure_shelter) and none is under way; held for the night, and asked again when the chosen way fails (it rests three minutes).',
  source: 'src/survival.js (refugeStep)',
  options: [
    { key: 'bed_beside', label: 'seal a pocket now and at bedtime put the carried bed down beside it and sleep', when: 'before bedtime in the Overworld with a bed carried, no nook to be had, a pocket sealable here and level ground for the bed within four blocks; said with the seconds to bedtime and the monsters within the vanilla sleep range', level: 'root' },
    { key: 'saved_shelter', label: 'go back to the saved shelter and seal it', when: 'a shelter is remembered with a route to it and dry below', level: 'root' },
    { key: 'build_at_site', label: 'build a small room at a dry site', when: 'a dry site within reach has a route to it', level: 'root' },
    { key: 'seal_here', label: 'seal a pocket where the bot stands', when: 'always (with too few blocks it digs in instead)', level: 'root' },
    { key: 'shaft_pocket', label: 'dig straight down and cap it', when: 'always; fails where the ground cannot be dug', level: 'root' },
    { key: 'night_mine', label: 'dig a mine from here for the night', when: 'a pickaxe (or one can be made) and nothing watching, and the mine would dig: not with the best pickaxe under the uses kept for a dug climb out and no spare to make (nightMineOff, said in the state; note 531); said with the ore about, the pickaxe\'s uses, the real minutes to dawn and the work they hold up; health is Jev\'s to weigh', level: 'root' },
    { key: 'bed_nook', label: 'the carried bed in a nook dug beside the bot', when: 'a bed carried in the Overworld and a nook can be dug here: at bedtime it is dug and slept in now; before it, a pocket is sealed here and the nook, closed in rock, is dug out of its wall at bedtime and slept in (held, not asked again)', level: 'root' },
  ],
  instructions: { task: 'Night is coming and the bot will shelter. Choose how.', guidance: 'Each option says its distance and the blocks it needs against those carried. Placing a block takes about a second, gathering more takes minutes; mobs spawn in the dark (darkHere says where the bot stands is dark enough); a room or pocket is kept for later nights.' },
  // Without Jev, the old order.
  fallback: children => ['saved_shelter', 'build_at_site', 'seal_here', 'shaft_pocket', 'night_mine', 'bed_nook'].find(k => children[k]) || Object.keys(children)[0],
});

// Sealed in a pocket: stay, leave, go to bed, open on a watcher, or mine.
define({
  id: 'pocket_next', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Sealed in a pocket: stay, leave, go out for food, go to the bed, sleep in the carried bed in a nook dug out of the wall, open the wall on a watcher, dig a passage out away from a spawner, a creeper, the mob at the wall or the blazes about, mine the night away, hunt mobs for their drops, or take the valuables to the chest?',
  trigger: 'Each survival step inside a sealed pocket, unless a mob is inside or at arm\'s length (that is fought as a reflex); the choice holds ninety seconds for the same watcher and the same night.',
  source: 'src/survival.js (stepOnce: the pocket)',
  options: [
    { key: 'sleep_beside', label: 'open the pocket, put the carried bed down beside it and sleep', when: 'at bedtime in the Overworld with a bed carried and no nook to be had, level ground for the bed beside the pocket; said with the monsters within the vanilla sleep range now', level: 'root' },
    { key: 'go_to_bed', label: 'open the pocket and go to the bed', when: 'bedtime, with the base bed near (on the surface or within ten blocks of its level) or a bed carried on the surface', level: 'root' },
    { key: 'sleep_in_nook', label: 'dig a bed nook out of the pocket\'s wall and sleep in the carried bed', when: 'bedtime, a bed carried, and a nook beside the bot closed in rock all round, so the pocket stays shut (its wall goes back after); taken without asking when the shelter method chosen tonight was the bed nook; the monsters within eight blocks sideways and five up or down of the bed are counted in the option', level: 'root' },
    { key: 'open_on_watcher', label: 'open the wall toward the watching mob and fight it', when: 'a mob within four and a half blocks and a sword or axe carried', level: 'root' },
    { key: 'night_mine', label: 'mine from the pocket through the night', when: 'night, nothing watching, and a pickaxe carried or makeable (no health floor: Jev weighs the risk), and the mine would dig: not with the best pickaxe under the uses kept for a dug climb out and no spare to make, said then on stay and in the state (nightMineOff, note 531); said with the real minutes to dawn and the work they hold up (the ladder\'s step, and for the portal its frame, way and lava); it stays in the pocket when no mine can be dug from here, and a choice that did nothing rests a minute (notNow)', level: 'root' },
    { key: 'work_here', label: 'stay and make the ladder\'s next item in the pocket', when: 'on the game ladder, nothing watching, and the next item can be made from what is carried by smelting and crafting alone', level: 'root' },
    { pattern: 'hunt_[a-z_]+', label: 'open the pocket and hunt this kind of mob for its drops', when: 'night, nothing watching, one for each kind of mob within thirty-two blocks whose drops are known, with the drops, their uses, a one-mob fight estimate and what a death would drop; two minutes, six health lost hands back', level: 'root', dynamic: true },
    { key: 'stash_valuables', label: 'open the pocket and put the valuables in the stash chest', when: 'night, nothing watching, a stash chest within 128 blocks and valuables carried', level: 'root' },
    { key: 'cache_valuables', label: 'open the pocket and put a chest down outside for the valuables', when: 'night, nothing watching, home\'s chest out of reach, valuables carried, and a chest or the wood for one', level: 'root' },
    { key: 'tunnel_from_warden', label: 'dig a passage out through the far wall, away from the warden, to beyond its boom, and go back to work from its end', when: 'a warden within thirty-two blocks, the bot not in water, digging and walking at hand, and the rock away from it safe to dig for at least four cells to a point seventeen or more blocks across from it (its boom reaches fifteen), twenty-four cells at most; said with the direction, the cells, about how long, the clearance, that digging is a vibration it follows, what a warden does, and the booms taken in the last minute', level: 'root' },
    { key: 'tunnel_out', label: 'dig a passage out through the far wall, away from what keeps the pocket (a spawner in reach, a creeper, or the mob at the wall), and go back to work from its end', when: 'the bot not in water, digging and walking at hand, and the rock safe to dig for at least four cells: away from a mob spawner within sixteen blocks to a point seventeen or more across from it (and ten from a creeper about), twenty-four cells at most; else away from a creeper within sixteen blocks (the rule that keeps a door within six of one shut would refuse the doors) to ten or more from it; else away from the mob watching the pocket (not a warden) to ten or more from it; else away from the blazes within their forty-eight blocks, to eight blocks further from them than the pocket (note 548); said with the direction, the cells, about how long, the clearance at its end, how long the same mob has kept the pocket, and that it stops, the bot still enclosed, if that kind of mob comes round toward its head within six blocks', level: 'root' },
    { key: 'dig_in_and_fight', label: 'open the pocket\'s wall toward the blazes, one wide and two high, and fight them from inside', when: 'a blaze within twenty-four blocks, a sword or axe carried, digging at hand, and the wall toward them safe to dig with the pocket\'s rock on the other three sides and over it; said with the blocks, the tool, the seconds, how many of the blazes within their forty-eight blocks have a line in through the opening now and at the bot\'s own height (where a blaze after a target hovers), what a blaze does, its fireball\'s chance to land by distance and its push, and the damage over the digging and fifteen seconds held after (note 548); carried out once, not again when the pocket is sealed after it', level: 'root' },
    { key: 'stay', label: 'stay in the pocket', when: 'always; said with what the place is (mobSourceAbout: a spawner in reach, a dungeon or mineshaft remembered within twenty-four, the mobs met and hits taken within sixteen in the last fifteen minutes), and at night with the minutes to dawn, the work they hold up, and why no night mine is on offer when it is not; by day with the daylight left and, hurt under eighteen hunger, that staying brings no health back', level: 'root' },
    { key: 'leave', label: 'open the pocket and go back to work', when: 'always; said with what the place is, as stay, the work named, and underground at night that the dark there is the same at any hour; a shaft pocket with no side to open is left up through its cap, and a leave that finds no door rests a minute with why (note 538)', level: 'root' },
    { key: 'go_for_food', label: 'open the pocket and go for food, the way chosen next', when: 'in the Overworld, day or night, hunger under eighteen and the safe food carried not enough to bring it there; said with the food known (in view, herds and rabbits seen, a village, home), health and whether it comes back, the daylight left, and what is outside (note 538)', level: 'root' },
    ...FOOD_OPTIONS.filter(o => o.level === 'obtain_food' && !['return_for_food', 'hoglin_food'].includes(o.key)).map(o => ({ ...o, level: 'go_for_food' })),
  ],
  instructions: { task: 'The bot is sealed in a small pocket. Choose what to do next.', guidance: 'Use the time of day, health, food, armour and the mobs about (distance, in sight, whether they shoot). Mobs spawn in the dark; zombies and skeletons in the open burn once the sun is up, creepers, spiders and cave mobs do not. A pocket is safe but gains nothing, and a night in one is about eleven minutes from dusk; health comes back while fed. workWaiting is what the work outside is on; stillNeeded is the steps still open on the ladder and what each takes from the pockets as they are. watchedForSeconds is how long a mob has kept watch. The player wants the bot never to stand idle when useful work is in reach.' },
  // Without Jev, the old order, worked out by the caller.
  fallback: (children, path, context = {}) => children[context.rule] ? context.rule : children.stay ? 'stay' : Object.keys(children)[0],
});

// The night mine's next target.
define({
  id: 'night_mine_target', area: 'survival', kind: 'mining', primitive: 'choice', stakes: 'low', tree: true,
  question: 'Mining through the night: which ore next, or a branch deeper?',
  trigger: 'Each time the night mine needs a new target and an ore is in sight within twenty-four blocks, below the feet, dry, and not lately failed, or the tunnel is dark with torches carried, or a spawner or a remembered dungeon or mineshaft is near.',
  source: 'src/survival.js (nightMine, nightTarget)',
  options: [
    { pattern: 'ore_\\d+', label: 'dig to this ore', when: 'the nearest of its kind, with its distance, what is carried and what it is for', level: 'root', dynamic: true },
    { key: 'branch', label: 'dig a branch down and along', when: 'always', level: 'root' },
    { key: 'branch_away', label: 'dig the branch away from the spawner or structure that makes the mobs here', when: 'a mob spawner within sixteen blocks, or a dungeon or mineshaft remembered within twenty-four; said with where its end lies from it. Every option here is said with what the place is (mobSourceAbout)', level: 'root' },
    { key: 'light_tunnel', label: 'put a torch in the tunnel here', when: 'torches carried and the cells around are dark enough for monsters', level: 'root' },
  ],
  instructions: { task: 'The bot is mining through the night from its shelter. Choose the next target, or light the tunnel.', guidance: 'Each ore says how far it is, how much of what it gives is carried, and what that is for. A pickaxe wears a use a block. The player wants the bot never to stand idle when useful work is in reach.' },
  fallback: children => Object.keys(children).find(k => k !== 'branch') || 'branch',
});

// At home before bedtime: a chore, or wait for the bed.
define({
  id: 'evening_chore', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'low', tree: true,
  question: 'Home before bedtime: which chore now (the stash, the wheat, the farm, the cows, the plot), or wait for the bed?',
  trigger: 'At home within six blocks of the bed, from the walk-home hour until bedtime, with a chore on offer; waiting, once chosen, holds until a new chore appears.',
  source: 'src/survival.js (step), src/home-base.js (homeChores), src/home-stash.js (stashChores)',
  options: [
    { key: 'stock_stash', label: 'put spares in the chest', when: 'spares are carried', level: 'root' },
    { key: 'harvest_and_bake', label: 'harvest the ripe wheat and bake bread', when: 'enough ripe or carried wheat for a loaf', level: 'root' },
    { key: 'tend_farm', label: 'till, harvest or plant the plot', when: 'the plot needs work', level: 'root' },
    { key: 'breed_cows', label: 'breed the cows in the pen', when: 'two adults, two wheat, and the cooldown past', level: 'root' },
    { key: 'light_home', label: 'put torches where monsters could spawn around home', when: 'ground around home is dark and torches are carried or can be made', level: 'root' },
    { key: 'wall_home', label: 'build a wall two blocks high round home, with a door by the bed', when: 'the bed and the chest are down and home is not walled yet', level: 'root' },
    { key: 'grow_plot', label: 'mark the plot to grow by a column', when: 'the home is complete and the plot has not grown yet', level: 'root' },
    { key: 'wait_for_bedtime', label: 'wait by the bed for bedtime', when: 'always', level: 'root' },
    { pattern: '[a-z_]+', label: 'another home chore', when: 'offered by the stash or the home', level: 'root', dynamic: true },
  ],
  instructions: { task: 'The bot is at home and bedtime is near. Choose a chore to do before it, or wait by the bed.', guidance: 'Each chore says what it does and what it is for. Bread and a stocked chest are tomorrow\'s food and kit; light around home keeps the night\'s monsters from spawning there. The player wants the bot never to stand idle when useful work is in reach.' },
  fallback: children => ['stock_stash', 'harvest_and_bake', 'tend_farm', 'breed_cows'].find(k => children[k]) || Object.keys(children).find(k => k !== 'wait_for_bedtime') || 'wait_for_bedtime',
});

// A shooter in view and a bow in the pack: shoot, retreat or dig in.
define({
  id: 'ranged_response', area: 'combat', kind: 'survival', primitive: 'choice', stakes: 'high', tree: true, thinking: true,
  question: 'A mob that shoots is in clear view at bow range: shoot it, run for cover, or dig in?',
  trigger: 'A shooting mob is in clear view at bow range, a bow and arrows are carried, health is eight or more and no melee mob is within three blocks.',
  source: 'src/survival.js (rangedChoice)',
  instructions: {
    task: 'A mob that shoots is in clear view at bow range. Choose the response NOW: shoot it from here, run for cover out of its sight, or seal a pocket and let it pass.',
    guidance: 'Health, arrows and the number of shooters are in the state. Every option listed is already checked as possible from here.',
  },
  options: [
    { pattern: 'shoot_\\d+', label: 'shoot this mob', when: 'it is in clear view with a solved arrow path (up to three targets)', level: 'root', dynamic: true },
    { key: 'retreat', label: 'run for cover out of its sight', when: 'always', level: 'root' },
    { key: 'dig_in', label: 'seal a two-block pocket here', when: 'twelve or more building blocks are carried', level: 'root' },
  ],
  fallback: (children, path, context = {}) => (context.health ?? 20) >= 12 ? Object.keys(children)[0] : (children.retreat ? 'retreat' : Object.keys(children)[0]),
  ungated: 'Jev\'s pick is taken at any confidence; the health rule answers only when Jev cannot be reached',
});

// The stance for an encounter, once per encounter (src/survival.js
// stanceStep). Jev's pick stands, sure or not; the rules answer only when
// Jev cannot be reached, or with JEV_ENCOUNTERS=0.
define({
  id: 'encounter_stance', area: 'combat', kind: 'combat', primitive: 'choice', stakes: 'high', tree: true, thinking: true,
  question: 'Hostile mobs are near the bot: fight here, go up, step out of the shooters\' line, block a creeper\'s line, dig into the wall, dig down, seal in, run, eat, shoot, charge the shooters, dance with the creeper, or leave them be and keep working?',
  trigger: 'An encounter the reflexes (the swing at arm\'s length, a shield against an arrow in flight, off a ledge) have not settled, with two or more stances possible (one is taken without asking); held for fifteen seconds, until health falls by six, until the stance fails, or until a mob it was not chosen against comes within six blocks (not when a kind of mob comes into view further off or goes out of it); a stance that hid the bot from the shooters (out_of_sight, nook) is asked again once a shooter has a line to where it hid, or the bot is off that spot. A stance that failed stays on offer, its option saying how long ago and how it failed here. While a stance holds, the shield at each arrow gives way to a stance that moves or builds, the hurt watchdog to any stance but keep_working, and eating to the eat stance. Off with JEV_ENCOUNTERS=0.',
  source: 'src/survival.js (stanceOptions)',
  instructions: {
    task: 'Hostile mobs are close. Choose the stance for this encounter NOW. The bot will keep to it for the next several seconds, swinging at anything in reach whatever you choose.',
    guidance: 'Use the threats (kind, distance, whether they shoot), health, armour, weapon, shield, arrows and building blocks. Every option listed is already checked possible from here. Weigh what each mob does: walkers cannot climb a pillar, shooters can hit a pillar or a runner, a crowd in the open hits from every side while a doorway admits one at a time, a sealed pocket takes no damage but gains nothing. Placing a block takes about six tenths of a second (a pocket on open ground is twenty to thirty-four of them), going two up about a second and a half, and digging down about a second and a half a block, and anything at arm\'s length hits freely meanwhile. On Normal, unarmoured, a zombie or husk hits for about 3, a skeleton arrow 2 to 4, a spider 2, a creeper blast 43 at point blank, 24 at two blocks, 16 at three, 10 at four. Full iron armour takes about half off a zombie\'s hit or an arrow, but only an eighth off a blast. A stone sword kills a zombie in about four hits and an iron sword in four too (six a hit against twenty), a diamond sword in three, a hit about every 0.6 seconds, so a crowd at arm\'s length lands several hits for each one that dies. A creeper lights within three blocks and goes off about a second and a half later unless the bot is more than seven blocks from it or out of its sight by then; a hit does not put the fuse out, and a pocket or pillar is seldom finished first. The fight and the dance meet one the same way (struck, then backed from, or held at reach where the swings kill it first), and each says where it goes off and what that costs. Hoglins and ravagers throw a player about three blocks, so near a drop (dropWithinThreeBlocks) a hit from one can be a fall; a sealed pocket is the one place they cannot throw the bot out of. estimate is worked out for this bot: each mob\'s hit after its armour, the swings its weapon needs to kill it, and fightHere, about how long and how much health killing them all where it stands would take (every biter reaching it, shooters hitting while in sight). darkHere says the ground where the bot stands is dark enough for monsters to spawn: more may come. previousStance says what was chosen last and the health then. Every stance says about how much damage the mobs here deal in the next fifteen seconds that way, worked out the same way for each: the seconds of building, digging or eating first, the hands busy and the shield down, and then only what still reaches the bot in that stance; set them side by side, and weigh them against the health the bot has.',
  },
  options: [
    { key: 'take_cover', label: 'put a block in the line from the eyes of each shooter in sight to the bot\'s, two high where it is beside the bot, and stay behind it', when: 'shooters in sight (up to three) and a cell in the line of at least one that takes a block within reach (or a block there already), the blocks carried, not in water; said with where each block goes, the shooters it cannot cover and why, the seconds and the damage in the next fifteen seconds this way', level: 'root' },
    { key: 'block_creeper', label: 'put a block in the line from a creeper\'s eyes to the bot\'s, two high beside the bot, and stay behind it: out of its sight its fuse does not burn', when: 'a creeper within seven blocks (the lit one whose fuse ends first, else the nearest), a cell on that line within reach open to a block with a face to place against, and the blocks carried, not in water; said with where the block goes, the seconds until the line is cut against the fuse left or the walk to three blocks and the fuse, the blast where it goes off if that is too late, what the creeper does behind the block, and the damage in the next fifteen seconds this way; held, with the line stopped, it is staying behind the block', level: 'root' },
    { key: 'fight_from_footing', label: 'step onto firm ground away from the drop, then fight there', when: 'the drop beside the bot is into lava or does half its health or more, and ground three blocks from any drop is within sixteen; said with its distance and seconds', level: 'root' },
    { key: 'rail_and_fight', label: 'wall the open sides at the feet over the drop, then fight (or, with only shooters out of reach, hold behind the wall)', when: 'the drop beside the bot is into lava or does half its health or more and blocks for the wall are carried; said with the blocks and seconds, and where nothing can be fought, with the damage from the shots in the next fifteen seconds this way', level: 'root' },
    { key: 'fight', label: 'fight where the bot stands', when: 'always, with bare hands when no sword, axe or trident is carried', level: 'root' },
    { key: 'eat_golden_apple', label: 'eat a golden apple now', when: 'a golden or enchanted golden apple is carried and health is below full', level: 'root' },
    { key: 'pillar', label: 'go two blocks up and fight from there', when: 'two scaffold blocks carried and three clear blocks overhead', level: 'root' },
    { key: 'come_down', label: 'come down the bot\'s own pillar, digging the block underfoot', when: 'standing on a pillar of its own blocks with a floor under it', level: 'root' },
    { key: 'bunker', label: 'dig into the nearby wall and fight at the doorway', when: 'natural rock to dig into where the bot stands or within five blocks; said with its seconds of digging with the tools carried', level: 'root' },
    { key: 'out_of_sight', label: 'walk to a spot no shooter\'s line reaches and fight what comes round', when: 'a shooter has a line to the bot and a spot out of every shooter\'s line is within eight blocks of walking (the game\'s raycast from each shooter\'s eye), not in water; said with the blocks, the seconds in their fire, what still reaches it, and when each shooter in sight has a line on it again by walking its way toward the bot (counted from then)', level: 'root' },
    { key: 'nook', label: 'dig an L into the rock, two in and one to the side, out of every shooter\'s line', when: 'a shooter has a line to the bot, natural rock for the L where the bot stands or within five blocks, and its end out of every shooter\'s line; said with the blocks, the tool, the seconds of digging, and when each shooter in sight has a line into its end by walking its way in (counted from then), or, once in it, which shooter has a line in now', level: 'root' },
    { key: 'seal', label: 'seal a pocket and wait', when: 'four or more building blocks are carried', level: 'root' },
    { key: 'dig_down', label: 'dig straight down where the bot stands and close the hole over its head', when: 'a dry column of diggable ground under the bot walls it in within twelve blocks, a block carried for the cap, a pickaxe or ground soft enough for the hand, not in water', level: 'root' },
    { key: 'eat', label: 'eat food now', when: 'food carried, health below full, hunger below full and eighteen or more after the meal (health comes back)', level: 'root' },
    { key: 'charge_shooter', label: 'run at the ground shooters one after another and strike', when: 'skeletons, strays, bogged, pillagers or witches in view within sixteen, a sword or axe carried, not in water', level: 'root' },
    { key: 'creeper_dance', label: 'hit the creeper and back out of its blast, or hold at reach where the swings kill it before it goes off, again and again', when: 'a creeper within six, a sword or axe carried, no drop or lava to back into', level: 'root' },
    { key: 'keep_working', label: 'carry on with the work and leave the mobs be for fifteen seconds', when: 'nothing within three blocks; ends early when one comes within three or lands a hit', level: 'root' },
    { key: 'retreat', label: 'run for footing out of reach and sight', when: 'always', level: 'root' },
    { key: 'dig_in_and_fight', label: 'dig a hole one wide and two high into the brick or netherrack and fight the blazes from inside', when: 'a blaze among the mobs, a sword or axe carried, not in water, and a cell of natural rock or brick beside the bot or a wall within five blocks with rock behind, beside and over it (or the bot already in such a hole); said with the blocks, the tool, the seconds of digging, how many shooters would see in, what a blaze does, its fireball\'s chance to land by distance and its push, and the damage in the next fifteen seconds this way', level: 'root' },
    { key: 'fight_at_spawner', label: 'walk to a cell within three of the blaze spawner\'s cage under a ceiling and fight them there as they come out', when: 'a blaze among the mobs, a sword or axe carried, a spawner within twenty-four, and a cell within three of it with a block over the head and no drop or lava within a push, within twenty-four blocks of walking; said as the hole is', level: 'root' },
    { key: 'back_to_wall', label: 'walk to footing with a wall at its back and fight there', when: 'a blaze among the mobs, a sword or axe carried, and footing within eight blocks of walking with rock at its back on the side away from the blazes and no drop or lava within a fireball\'s push (two blocks); said as the hole is', level: 'root' },
    { key: 'get_out_of_water', label: 'swim for dry ground and deal with the mobs from there', when: 'in water; the pillar, the pocket, the bunker and digging down are not offered there', level: 'root' },
    { key: 'portal_back', label: 'go back through the portal to the Overworld', when: 'in the Nether with a portal within eight blocks and a way back through it', level: 'root' },
    { pattern: 'shoot_\\d+', label: 'shoot this mob with the bow', when: 'a bow, arrows and a clear arrow path (up to two targets)', level: 'root', dynamic: true },
  ],
  fallback: 'throws',
  ungated: 'Jev\'s pick is taken at any confidence: a stance is held fifteen seconds and asked again when health falls by six, when it fails or when a new mob comes close, so a close call is soon corrected; the encounter rules answer only when Jev cannot be reached',
});

module.exports = { safetyOrder, FOOD_OPTIONS };

// Getting unstuck one move at a time (src/unstuck.js): the moves possible
// from where the bot stands, each with what the code works out about it.
// A prototype, run on replays of the traps that stalled trials 32 and 33.
define({
  id: 'unstuck_move', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Stuck: which single move next (walk, climb, dig, place a block, pillar, swim up)?',
  trigger: 'A stall while the bot is in water, or under cover on the way up (the survival layer\'s stall, or the work stall\'s work_free answer): each move asked in turn until the bot is out, twenty-four moves pass, or four in a row change nothing.',
  source: 'src/unstuck.js (localMoves)',
  options: [
    { pattern: '(step|climb|place)_(north|east|south|west)', label: 'walk, climb or place a block that way', when: 'the cells that way allow it', level: 'root', dynamic: true },
    { pattern: 'dig_(north|east|south|west)_(feet|head|over)', label: 'dig the block that way', when: 'a natural block there, and a tool for it if it needs one', level: 'root', dynamic: true },
    { pattern: 'dig_up|dig_down|swim_up|pillar', label: 'dig over the head or underfoot, swim up, or pillar', when: 'what is over the head or underfoot allows it', level: 'root', dynamic: true },
  ],
  instructions: { task: 'The bot is stuck and has to get somewhere: `aim` says where. Choose the next single move.', guidance: 'Each move says what it does and what the code has worked out about the result: what digging would bring down or let in, whether the move rises, whether it ends on dry ground or under open sky, and whether the bot has stood there before. `here` is where the bot stands now; `recentMoves` are the moves already made and what each did. A move that changed nothing last time will change nothing again.' },
  fallback: children => Object.keys(children)[0],
});

// Climbing out of the mine by digging (src/surface.js): a staircase, or
// straight up the column overhead. mid-72-b spent twenty-seven minutes
// climbing, three digs a block of height, and went on by hand at over
// twenty seconds a stair twice when the last pickaxe wore out on the way.
define({
  id: 'climb_out', area: 'survival', kind: 'mining', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Climbing out of the mine by digging: a staircase toward open ground, straight up the column overhead, or a span across open cave toward the way up?',
  trigger: 'A climb to the surface with no dug way out found, when it starts digging; asked again when the pickaxes carried change, a way not offered before is open, the column would not rise, or a span has been laid.',
  source: 'src/surface.js (returnToSurface, chooseClimb, climbOptions)',
  options: [
    { key: 'staircase', label: 'dig a staircase up toward open ground', when: 'always', level: 'root' },
    { key: 'straight_up', label: 'dig straight up, a block put under the feet at each step', when: 'the column to open sky has only natural ground to dig, nothing that falls or flows in or beside it, and a building block carried for every step up', level: 'root' },
    { key: 'bridge', label: 'lay a level span across the open cave toward the way up, then look again from its end', when: 'a straight crossing at the feet\'s height toward the way up has open air to lay blocks over and gains four blocks or more on it', level: 'root' },
  ],
  instructions: { task: 'The bot is underground and has to dig its way out to open sky. Choose how it climbs.', guidance: 'Each way says how many blocks it digs, how long it takes with the pickaxes carried, and what it leaves behind. A pickaxe wears a use for each block it digs; once the pickaxes are used up the rest is dug by hand, stone at seven and a half seconds a block. `pickaxes` lists what is carried and the uses left; `straightUpBlocked` says why the column overhead is not on offer, when it is not.' },
  fallback: (children, path, context = {}) => children[context.quicker] ? context.quicker : Object.keys(children)[0],
});

// The kit carried into the Nether (src/work.js crossingKitReady,
// src/crossing-kit.js). Forty food points were a gate the bot could not see
// past (mid-220-a stood at thirty-nine for forty-four passes, 2026-09-26),
// and five more stood behind it unsaid: sixteen health, a hundred and
// twenty-eight blocks, a spare pickaxe, eight logs and a table, and the
// valuables walked home (the decision review, 2026-09-26). One question now,
// every item said with what is carried against what the code would take.
define({
  id: 'crossing_kit', area: 'strategy', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Cross into the Nether with the kit carried now, or first top up one named item of it (food, health, blocks, a spare pickaxe, wood) or leave the valuables behind?',
  trigger: 'In the Overworld on the way through a portal, in Survival, with some item of the kit short of what the code would take or valuables carried that could be left; held until what is on offer changes or for ten working minutes.',
  source: 'src/work.js (crossingKitReady), src/crossing-kit.js (kitItems, valuablesAt)',
  options: [
    { key: 'cross_now', label: 'cross with what is carried', when: 'always', level: 'root' },
    { key: 'top_up_food', label: 'gather food first, up to forty points', when: 'fewer than forty food points carried, monsters on; said with where it goes (the home chest, the plot, or a search outward with no bound), the trip to food known, and the frame begun it leaves where it stands (note 527)', level: 'root' },
    { key: 'top_up_food_near', label: 'gather food at the known food whose trip on to the frame begun is shortest, then back to it', when: 'food short, a frame begun and no portal lit, and some food known (animals in view, a herd seen, a village, the home plot or chest); said with the walk there, the gathering, the walk on to the frame and about what it gives (note 527)', level: 'root' },
    { key: 'top_up_health', label: 'wait and heal first, to sixteen', when: 'health under sixteen, monsters on', level: 'root' },
    { key: 'top_up_blocks', label: 'mine stone first, up to two stacks of blocks', when: 'fewer than 128 building blocks carried', level: 'root' },
    { key: 'top_up_pickaxe', label: 'make a stone pickaxe first, as the spare', when: 'no stone pickaxe or better, or the best has under 24 uses', level: 'root' },
    { key: 'top_up_gold', label: 'make golden boots first, a piece of gold worn so piglins leave the bot be', when: 'no piece of golden armour carried', level: 'root' },
    { key: 'top_up_wood', label: 'gather logs up to eight and make a crafting table first', when: 'fewer than eight logs or no crafting table carried', level: 'root' },
    { key: 'stash_valuables', label: 'walk home and leave the valuables in the stash chest first', when: 'the home stash chest within 128 blocks and valuables carried', level: 'root' },
    { key: 'cache_valuables', label: 'leave the valuables in a chest put down here first', when: 'home\'s chest out of reach, valuables carried, and a chest or the wood for one', level: 'root' },
  ],
  instructions: { task: 'The bot is on its way through a portal into the Nether. Choose whether to cross with what it carries now or to top up one item of its kit first.', guidance: 'Every option lists the kit item by item: what is carried, what the code would take, and why. The amounts the code would take are a careful default, not a rule: a player often crosses with a stack of blocks, a few steaks and a pickaxe. A top-up says the working minutes it has had at this crossing and what they brought. `kit` is each item carried against what the code would take.' },
  fallback: (children, path, context = {}) => children[context.fallback] ? context.fallback : 'cross_now',
});

// A step on the ladder whose sources are in another dimension
// (src/game-progress.js elsewhereStep): the ladder says so and the routes
// are Jev's, instead of the same step planned again. mid-227-r-nether-1
// planned iron ore in the Nether for its blaze hunt 1,130 times in
// twenty-five minutes, and the set-aside the loop made was never read
// (note 476).
define({
  id: 'rung_elsewhere', area: 'strategy', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'The step the game needs next cannot be done in this dimension: go where its sources are, or go on with what the ladder has next here?',
  trigger: 'On the game ladder, a step whose plan from here needs a block found only in another dimension, or a step set aside for that.',
  source: 'src/game-progress.js (elsewhereStep, nextGameStage)',
  options: [
    { pattern: 'go_(overworld|nether|end)', label: 'go to the dimension its sources are in', when: 'always; said with what is mined there, what is brought back, and the trip to the portal', level: 'root', dynamic: true },
    { key: 'on_here', label: 'leave the step for now and go on with what the ladder has next here', when: 'the ladder has something else to do in this dimension', level: 'root' },
  ],
  instructions: { task: 'The next step of the game cannot be done where the bot is. Choose to go where its sources are, or go on here with the ladder\'s next step.', guidance: 'Each option says what it means: what is mined in the other dimension and brought back, and the trip to the portal; or what the ladder does here meanwhile. A step left comes back after half an hour.' },
  fallback: children => Object.keys(children).find(k => k.startsWith('go_')) || Object.keys(children)[0],
});

// A climb to open sky for the ladder's step (src/work.js surfaceTrip): a
// log, a flower, a surface search or a portal site wanted underground. It
// had been climbed at once, and mid-229-q climbed 74 blocks in 97 minutes
// for one log for a spare pickaxe's table, 100 of its 180 minutes on
// climbs nothing asked about (note 511).
define({
  id: 'surface_trip', area: 'strategy', kind: 'strategy', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'The step in hand wants the surface and the bot is underground: climb to open sky for it, leave the step for now and go on down here with the ladder\'s next one, dig the ore in view first with the uses the climb does not need, or, for a portal site, dig one out of the rock here?',
  trigger: 'Underground in the Overworld, the work\'s step wants what only the surface has (logs, flowers, a surface search, a portal site), on the game ladder with another step to go on with (the rungs after it that want the same climb are left with it), or for a portal site with one that can be dug out here; asked when the climb would begin, and held to the top once Jev chose it (a climb made with nothing else on offer holds nothing and is looked at again; wood chosen at upkeep is its climb chosen) (note 543).',
  source: 'src/work.js (surfaceTrip), src/surface.js (tripCost), src/game-progress.js (nextGameStage)',
  options: [
    { key: 'climb', label: 'climb to open sky for it', when: 'always; said with the height, the quicker way out and its time, the pickaxe uses it wears, and the way back down it leaves', level: 'root' },
    { key: 'stay_below', label: 'leave the step thirty minutes and go on with the ladder\'s next step here', when: 'the ladder has another step to go on with that does not want the same climb (those that do are left with it, and named), and it is the work\'s turn; said with the pickaxes\' uses against the step in hand and the way home, what the pockets make and the nearest wood known (note 543)', level: 'root' },
    { key: 'mine_first', label: 'dig the ore in view first with the uses the climb does not need, then climb', when: 'on the game ladder at the work\'s turn, a pickaxe carried, an ore it can mine within sixteen blocks with no lava beside it, and more uses carried than the climb\'s quicker way digs; said with the uses, the climb\'s digs and the spare, and asked again after each ore (note 543)', level: 'root' },
    { key: 'dig_site', label: 'dig a site for the portal frame out of the rock where the bot stands', when: 'the need is a portal site, a pickaxe carried, and a site takes in the bot\'s feet whose frame and walkways are natural rock to dig, with solid floor and no water, lava or falling block beside; said with the blocks, the seconds and the uses, and how far it is from the lava chosen to cast beside, where the climb says how far above that lava the frame would go (note 531)', level: 'root' },
  ],
  instructions: { task: 'The step in hand needs the surface and the bot is underground. Choose to climb for it now, to leave it and go on with the next step down here, to dig the ore in view first, or, for a portal site, to dig one out here.', guidance: 'The climb says how far up it is, how long the quicker way out takes with the pickaxes carried, how many of their uses it wears, and what the way back down to this depth is after. Staying says what the ladder goes on with meanwhile and what the pickaxes carried cover of it and of the way home after; the step left comes back after thirty minutes. Ore first says the uses the climb leaves spare. A site dug out says its blocks and seconds; a frame goes on it as on open ground.' },
  fallback: children => children.dig_site ? 'dig_site' : children.climb ? 'climb' : Object.keys(children)[0],
});

// Back for what a death dropped (src/corpse-run.js). A rule that went
// whenever the kit was ready or it was day: mid-230-c walked 194 blocks
// back to the drowned that had just killed it, and mid-231-b died four
// times in two and a half minutes going back (2026-09-26).
define({
  id: 'corpse_run', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Go back for what the last death dropped, or leave it and go on?',
  trigger: 'After a death whose drops are worth fetching and still there, once the bot is fit to go; asked once a death.',
  source: 'src/corpse-run.js (corpseRunStep)',
  options: [
    { key: 'go_back', label: 'go back for the drops', when: 'always', level: 'root' },
    { key: 'leave_them', label: 'leave them and go on', when: 'always', level: 'root' },
  ],
  instructions: { task: 'The bot died and has come back to life. Choose whether it goes back for what it dropped.', guidance: 'Each option says what is there, how far, how long the drops last, what was about when the bot died there and what it wore then and wears now.' },
  fallback: () => 'go_back',
});

// Whose turn it is, when more than one layer claims it (src/arbiter.js).
// The reflexes are never asked; this is the rest: a live survival plan, the
// meal, the hunt and the work, each with what it observed. mid-231-o's turn
// fell through to the work at 0.9 health because the survival plan had
// failed and returned false (notes 465, 466): now it is a claim like any.
define({
  id: 'turn_priority', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'high', tree: true,
  question: 'Which layer has the bot\'s turn now: survival, the meal and breath, the hunt, or the work?',
  trigger: 'When two or more layers claim the turn and none of them is a reflex (the default; with JEV_ARBITER=shadow the rules answer and nobody is asked); the ruling is held until a reflex, a newcomer within six blocks, health down six, food across a band, its winner doing nothing for ten seconds, or a minute.',
  source: 'src/arbiter.js (arbitrate), the claims in src/survival.js, src/vitals.js, src/mob-hunt.js and src/work.js',
  instructions: {
    task: 'Several parts of the bot want its turn at once. Choose which one acts NEXT. Each option is what that part would do and what it observed; nothing here is a verdict.',
    guidance: 'The player request stays saved whichever is chosen. The ruling is kept until something observed changes, so choose what should hold for the next while. A plan that failed or rests says so in its facts (setAside), and the part that has the turn says how long it has had it and how long it has done nothing with it: a part that does nothing keeps the turn while it is chosen.',
  },
  options: [
    { key: 'survival', label: 'the survival layer: a shelter, a stance, a bed, food to find', when: 'the survival layer has something to do, including a plan that failed or rests (said as a fact)', level: 'root' },
    { key: 'vitals', label: 'eat carried food, get out of powder snow, or surface for air', when: 'hunger or breath call for it and the means are carried', level: 'root' },
    { key: 'hunt', label: 'fight a mob the request needs a drop from', when: 'a mob hunt is on and one of its kind is in view', level: 'root' },
    { key: 'work', label: 'the request\'s next step', when: 'always while a request is running', level: 'root' },
  ],
  fallback: children => require('../arbiter').rulesPick(Object.entries(children).map(([layer, o]) => ({ layer, urgency: o.description?.urgency })))?.layer || Object.keys(children)[0],
  ungated: 'Jev\'s pick is taken at any confidence: it holds a minute at most, and any change a reflex, a newcomer, six health or a food band makes asks again; the urgency then safety order answers only when Jev cannot be reached',
});

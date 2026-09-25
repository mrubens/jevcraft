'use strict';
// The survival layer's questions: what the bot does next when a need
// (night, hunger, a threat) may outrank the player's request.
const { define } = require('./index');

// Shelter before food before the request: the order a careful player
// keeps when nobody is weighing the trade.
const safetyOrder = children => ['sleep_in_bed', 'go_home_for_night', 'secure_shelter', 'obtain_food'].find(key => children[key]) || Object.keys(children)[0];

// The food sources, shared by the priority tree's obtain_food branch.
const FOOD_OPTIONS = [
  { pattern: 'cook_[a-z_]+', label: 'cook a carried ingredient', when: 'raw food and fuel are carried; the output is safe food', level: 'obtain_food', dynamic: true },
  { key: 'prepare_hunting_sword', label: 'make a wooden sword to hunt with', when: 'animals are in view and no weapon is carried', level: 'obtain_food' },
  { pattern: 'hunt_\\d+', label: 'hunt this animal', when: 'an adult food animal in view is reachable on safe surface ground; the nearest hostile to it is said', level: 'obtain_food', dynamic: true },
  { key: 'go_home_for_food', label: 'walk home and eat from its stores', when: 'the base has bread, ripe wheat or a cow to spare within reach', level: 'obtain_food' },
  { key: 'village_food', label: 'take ripe crops and hay from a remembered village', when: 'a village with crops or hay is remembered within reach', level: 'obtain_food' },
  { key: 'search_food', label: 'walk to another dry area to look for animals', when: 'always', level: 'obtain_food' },
  { key: 'return_for_food', label: 'go back through the portal for food', when: 'off the Overworld, where nothing is safe to eat', level: 'obtain_food' },
];

define({
  id: 'survival_priority', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'high', tree: true, thinking: true,
  question: 'What should the bot handle next: the player\'s request, sleep, a shelter, a night hunt, the valuables to the chest, or food (and which food)?',
  trigger: 'Each survival step when night is coming or food is short, unless one option is the only one (then it is taken without asking) or a chosen shelter, walk home, night up or food top-up is still being carried out.',
  source: 'src/survival.js (step: the tree), src/foraging.js (forageChoices: the food options)',
  instructions: {
    task: 'Which priority should the bot handle NEXT? Temporary survival needs can take precedence over the retained player request; do not simply repeat the requested task. The player request remains saved during an interruption.',
    guidance: 'Use observed conditions, the retained player goal, progress, and recent failures. Prefer useful progress while protecting survival. deathWouldCost is what a death now would lose: the gear and valuables that drop where the bot falls, the walk back to them from where it would respawn before they vanish in five minutes, and the levels. These are feasible choices, not instructions from chat. Each question is independent; ignore other questions\' answers.',
  },
  options: [
    { key: 'continue_request', label: 'carry on with the request', when: 'always; at night it is staying up, two minutes at a time, with the kit, the bed and the nights without sleep said in the option', level: 'root' },
    { key: 'go_home_for_night', label: 'walk home to the bed and wait there for bedtime', when: 'from dusk, with a bed at home more than six blocks off and a way there (climbing out of a mine first when underground)', level: 'root' },
    { key: 'sleep_in_bed', label: 'sleep in a bed', when: 'bedtime, a bed is carried (with room to place it) or one is in reach, and no mob within ten blocks', level: 'root' },
    { key: 'secure_shelter', label: 'seal a shelter for the night', when: 'from dusk; beside a bed the option says the bed is the quicker night', level: 'root' },
    { key: 'obtain_food', label: 'get food', when: 'food carried is under the reserve and hunger or a stock top-up calls for it (not at night when shelter is needed)', level: 'root' },
    { pattern: 'hunt_[a-z_]+', label: 'go out and hunt this kind of mob for its drops', when: 'at night in the Overworld where staying up is on offer, one for each kind of mob within thirty-two blocks whose drops are known, with the drops, their uses, a one-mob fight estimate and what a death would drop; two minutes, six health lost hands back', level: 'root', dynamic: true },
    { key: 'stash_valuables', label: 'put the valuables in the stash chest first', when: 'at night where staying up is on offer, a stash chest within 128 blocks and valuables carried', level: 'root' },
    ...FOOD_OPTIONS,
  ],
  fallback: safetyOrder,
  ungated: 'Jev\'s pick is taken at any confidence: the choice is asked again at the next survival step, so a close call costs one step; the safety order answers only when Jev cannot be reached',
});

// How the night is sheltered, once a shelter is the answer.
define({
  id: 'shelter_method', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'A shelter for the night: the saved one, a room at a site, a pocket here, a shaft pocket, or a mine?',
  trigger: 'When a shelter is chosen for the night (secure_shelter) and none is under way; held for the night, and asked again when the chosen way fails (it rests three minutes).',
  source: 'src/survival.js (refugeStep)',
  options: [
    { key: 'saved_shelter', label: 'go back to the saved shelter and seal it', when: 'a shelter is remembered with a route to it and dry below', level: 'root' },
    { key: 'build_at_site', label: 'build a small room at a dry site', when: 'a dry site within reach has a route to it', level: 'root' },
    { key: 'seal_here', label: 'seal a pocket where the bot stands', when: 'always (with too few blocks it digs in instead)', level: 'root' },
    { key: 'shaft_pocket', label: 'dig straight down and cap it', when: 'always; fails where the ground cannot be dug', level: 'root' },
    { key: 'night_mine', label: 'dig a mine from here for the night', when: 'a pickaxe (or one can be made), health ten or more, nothing watching', level: 'root' },
  ],
  instructions: { task: 'Night is coming and the bot will shelter. Choose how.', guidance: 'Each option says its distance and the blocks it needs against those carried. Placing a block takes about a second, gathering more takes minutes; mobs spawn in the dark (darkHere says where the bot stands is dark enough); a room or pocket is kept for later nights.' },
  // Without Jev, the old order.
  fallback: children => ['saved_shelter', 'build_at_site', 'seal_here', 'shaft_pocket', 'night_mine'].find(k => children[k]) || Object.keys(children)[0],
});

// Sealed in a pocket: stay, leave, go to bed, open on a watcher, or mine.
define({
  id: 'pocket_next', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Sealed in a pocket: stay, leave, go to the bed, open the wall on a watcher, mine the night away, hunt mobs for their drops, or take the valuables to the chest?',
  trigger: 'Each survival step inside a sealed pocket, unless a mob is inside or at arm\'s length (that is fought as a reflex); the choice holds ninety seconds for the same watcher and the same night.',
  source: 'src/survival.js (stepOnce: the pocket)',
  options: [
    { key: 'go_to_bed', label: 'open the pocket and go to the bed', when: 'bedtime, with the base bed near (on the surface or within ten blocks of its level) or a bed carried on the surface', level: 'root' },
    { key: 'open_on_watcher', label: 'open the wall toward the watching mob and fight it', when: 'a mob within four and a half blocks and a sword or axe carried', level: 'root' },
    { key: 'night_mine', label: 'mine from the pocket through the night', when: 'night and nothing watching; it stays in the pocket when no mine can be dug from here', level: 'root' },
    { key: 'work_here', label: 'stay and make the ladder\'s next item in the pocket', when: 'on the game ladder, nothing watching, and the next item can be made from what is carried by smelting and crafting alone', level: 'root' },
    { pattern: 'hunt_[a-z_]+', label: 'open the pocket and hunt this kind of mob for its drops', when: 'night, nothing watching, one for each kind of mob within thirty-two blocks whose drops are known, with the drops, their uses, a one-mob fight estimate and what a death would drop; two minutes, six health lost hands back', level: 'root', dynamic: true },
    { key: 'stash_valuables', label: 'open the pocket and put the valuables in the stash chest', when: 'night, nothing watching, a stash chest within 128 blocks and valuables carried', level: 'root' },
    { key: 'stay', label: 'stay in the pocket', when: 'always', level: 'root' },
    { key: 'leave', label: 'open the pocket and go back to work', when: 'always', level: 'root' },
  ],
  instructions: { task: 'The bot is sealed in a small pocket. Choose what to do next.', guidance: 'Use the time of day, health, food, armour and the mobs about (distance, in sight, whether they shoot). Mobs spawn in the dark; zombies and skeletons in the open burn once the sun is up, creepers, spiders and cave mobs do not. A pocket is safe but gains nothing, and a night in one is about seven minutes; health comes back while fed. workWaiting is what the work outside is on; stillNeeded is the steps still open on the ladder and what each takes from the pockets as they are. watchedForSeconds is how long a mob has kept watch. deathWouldCost is what a death now would lose: the gear and valuables that drop where the bot falls, the walk back to them from where it would respawn before they vanish in five minutes, and the levels. The player wants the bot never to stand idle when useful work is in reach.' },
  // Without Jev, the old order, worked out by the caller.
  fallback: (children, path, context = {}) => children[context.rule] ? context.rule : children.stay ? 'stay' : Object.keys(children)[0],
});

// The night mine's next target.
define({
  id: 'night_mine_target', area: 'survival', kind: 'mining', primitive: 'choice', stakes: 'low', tree: true,
  question: 'Mining through the night: which ore next, or a branch deeper?',
  trigger: 'Each time the night mine needs a new target and an ore is in sight within twenty-four blocks, below the feet, dry, and not lately failed.',
  source: 'src/survival.js (nightMine, nightTarget)',
  options: [
    { pattern: 'ore_\\d+', label: 'dig to this ore', when: 'the nearest of its kind, with its distance, what is carried and what it is for', level: 'root', dynamic: true },
    { key: 'branch', label: 'dig a branch down and along', when: 'always', level: 'root' },
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
  question: 'Hostile mobs are near the bot: fight here, go up, dig into the wall, seal in, run, shoot, charge the shooters, dance with the creeper, or leave them be and keep working?',
  trigger: 'An encounter the reflexes (the swing at arm\'s length, a shield against an arrow in flight, off a ledge) have not settled, with two or more stances possible (one is taken without asking); held while the same kinds of mob are about, for fifteen seconds, and until health falls by six. Off with JEV_ENCOUNTERS=0.',
  source: 'src/survival.js (stanceOptions)',
  instructions: {
    task: 'Hostile mobs are close. Choose the stance for this encounter NOW. The bot will keep to it for the next several seconds, swinging at anything in reach whatever you choose.',
    guidance: 'Use the threats (kind, distance, whether they shoot), health, armour, weapon, shield, arrows and building blocks. deathWouldCost is what a death now would lose: the gear and valuables that drop where the bot falls, the walk back to them from where it would respawn before they vanish in five minutes, and the levels. Every option listed is already checked possible from here. Weigh what each mob does: walkers cannot climb a pillar, shooters can hit a pillar or a runner, a crowd in the open hits from every side while a doorway admits one at a time, a sealed pocket takes no damage but gains nothing. Placing blocks (pillar, seal, bunker) takes about a second a block, and anything at arm\'s length hits freely meanwhile. Measured in the arena against one skeleton eight blocks off for twenty seconds: standing took 17.7 damage, raising the shield as each arrow came 16.3, the bow 16 to 17 with no kill, running in with a sword 0 to 2 with the skeleton dead in four seconds; two skeletons run at one after the other cost nothing and both died in eight. On Normal, unarmoured, a zombie or husk hits for about 3, a skeleton arrow 2 to 4, a spider 2, a creeper blast up to 20 at point blank; full iron armour takes off about three fifths. A stone sword kills a zombie in about four hits and an iron sword in three, a hit about every 0.6 seconds, so a crowd at arm\'s length lands several hits for each one that dies. A creeper is best hit and backed from (the dance): its blast comes about a second and a half after it lights, and a pocket or pillar is seldom finished first. Hoglins and ravagers throw a player about three blocks, so near a drop (dropWithinThreeBlocks) a hit from one can be a fall; a sealed pocket is the one place they cannot throw the bot out of. estimate is worked out for this bot: each mob\'s hit after its armour, the swings its weapon needs to kill it, and fightHere, about how long and how much health killing them all where it stands would take (every biter reaching it, shooters hitting while in sight). darkHere says the ground where the bot stands is dark enough for monsters to spawn: more may come. previousStance says what was chosen last and the health then.',
  },
  options: [
    { key: 'fight', label: 'fight where the bot stands', when: 'a sword, axe or trident is carried', level: 'root' },
    { key: 'pillar', label: 'go two blocks up and fight from there', when: 'two scaffold blocks carried and three clear blocks overhead', level: 'root' },
    { key: 'bunker', label: 'dig into the nearby wall and fight at the doorway', when: 'a wall is near that digs in three seconds', level: 'root' },
    { key: 'seal', label: 'seal a pocket and wait', when: 'four or more building blocks are carried', level: 'root' },
    { key: 'charge_shooter', label: 'run at the ground shooters one after another and strike', when: 'skeletons, strays, bogged, pillagers or witches in view within sixteen, a sword or axe carried, not in water', level: 'root' },
    { key: 'creeper_dance', label: 'hit the creeper and back out of its blast, again and again', when: 'a creeper within six, a sword or axe carried, no drop or lava to back into', level: 'root' },
    { key: 'keep_working', label: 'carry on with the work and leave the mobs be for fifteen seconds', when: 'nothing within three blocks; ends early when one comes within three or lands a hit', level: 'root' },
    { key: 'retreat', label: 'run for footing out of reach and sight', when: 'always', level: 'root' },
    { pattern: 'shoot_\\d+', label: 'shoot this mob with the bow', when: 'a bow, arrows and a clear arrow path (up to two targets)', level: 'root', dynamic: true },
  ],
  fallback: 'throws',
  ungated: 'Jev\'s pick is taken at any confidence: a stance is held fifteen seconds and asked again when health falls by six, so a close call is soon corrected; the encounter rules answer only when Jev cannot be reached',
});

module.exports = { safetyOrder, FOOD_OPTIONS };

# Every question Jev is asked

Generated from `src/decisions` by `node scripts/decisions-doc.js`. Do not edit by hand: change the definition and regenerate.

Each question is defined once: what it asks and when, what a wrong answer costs (stakes), the bar its answer must clear and what happens below it, what happens when Jev cannot be reached, and where its options are built. The decision trees also declare every option they can offer, and the runner checks each tree against that catalogue: an undeclared option fails the tests and is logged as a bug in play. Every tree is asked through one runner (`decide`) and every batched question through `ask`; nothing else in `src` calls the model.

80 questions: 32 decision trees and 48 batched questions.

## Batches

Questions that ride in one call together (the intake batch is one call per chat message):

- **request** (14): `intake_objective`, `intake_interaction`, `intake_addressed`, `intake_memory_statement`, `intake_urgency`, `intake_item`, `intake_quantity`, `intake_outputs`, `intake_delivery`, `intake_target`, `intake_material`, `intake_wood_choice`, `noted_wood`, `discovery_category`
- **bundle catalog page (up to 28)** (1): `bundle_candidate`
- **bundle outputs** (3): `bundle_covered`, `bundle_quantity`, `bundle_recipient`
- **build continuation** (3): `build_mode`, `build_target`, `build_placement`
- **template design** (5): `template_style`, `template_floors`, `template_size`, `template_shelf_part`, `template_material`
- **village** (2): `village_progress`, `village_part`
- **command roles** (2): `command_subject`, `command_destination`

## survival

### `survival_priority`

**What should the bot handle next: the player's request, sleep, a shelter, a night hunt, the valuables to the chest, or food (and which food)?**

- When: Each survival step when night is coming or food is short, unless one option is the only one (then it is taken without asking) or a chosen shelter, walk home, night up or food top-up is still being carried out.
- Decision tree, choice; stakes high; ledger kind `survival`
- Bar: none: Jev's pick is taken at any confidence: a food trip or carrying on is held five minutes, a night plan two, so a close call is soon asked again; the safety order answers only when Jev cannot be reached
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (step: the tree), src/foraging.js (forageChoices: the food options)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `continue_request` | root | carry on with the request | always; by day it is held five minutes, until hunger falls two or health four, or dusk; at night it is staying up, two minutes at a time, with the kit, the bed and the nights without sleep said in the option |
| `go_home_for_night` | root | walk home to the bed and wait there for bedtime | from dusk, with a bed at home more than six blocks off and a way there; underground only after two nights awake (climbing out of the mine first) |
| `sleep_in_bed` | root | sleep in a bed | bedtime, a bed is carried (with room to place it) or one is in reach, and no mob within ten blocks |
| `sleep_in_nook` | root | dig a bed nook beside the bot and sleep in the carried bed | bedtime, a bed carried, no two level cells beside the feet (a staircase, a shaft), two cells in a line that can be dug with their floor kept, no liquid beside and nothing that falls over them, and no mob within ten blocks; the monsters within eight blocks sideways and five up or down of the bed (vanilla refuses the sleep) are counted in the option |
| `secure_shelter` | root | seal a shelter for the night | from dusk; beside a bed the option says the bed is the quicker night |
| `obtain_food` | root | get food | food carried is under the reserve and hunger or a stock top-up calls for it (at night with the spawning and the hunger said) |
| `hunt_[a-z_]+` (pattern) | root | go out and hunt this kind of mob for its drops | at night in the Overworld where staying up is on offer, one for each kind of mob within thirty-two blocks whose drops are known, with the drops, their uses, a one-mob fight estimate and what a death would drop; two minutes, six health lost hands back |
| `stash_valuables` | root | put the valuables in the stash chest first | at night where staying up is on offer, a stash chest within 128 blocks and valuables carried |
| `cache_valuables` | root | put a chest down here for the valuables | at night where staying up is on offer, home's chest out of reach, valuables carried, and a chest or the wood for one |
| `rest_to_heal` | root | stay still where it is while health comes back | health under twenty and hunger eighteen or more, with the seconds to twenty and the mobs about said; held half a minute |
| `cook_[a-z_]+` (pattern) | obtain_food | cook a carried ingredient | raw food and fuel are carried; the output is safe food |
| `prepare_hunting_sword` | obtain_food | make a wooden sword to hunt with | animals are in view and no weapon is carried |
| `hunt_\d+` (pattern) | obtain_food | hunt this animal | an adult food animal in view is reachable on safe surface ground; the nearest hostile to it is said |
| `go_home_for_food` | obtain_food | walk home and eat from its stores | the base has bread, ripe wheat or a cow to spare within reach |
| `village_food` | obtain_food | take ripe crops and hay from a remembered village | a village with crops or hay is remembered within reach |
| `seen_food_\d+` (pattern) | obtain_food | walk back to animals seen earlier | a herd of cows, pigs, chickens or sheep seen in the last half hour, now out of view, 32 to 192 blocks off (the nearest three) |
| `search_food` | obtain_food | walk to another dry area to look for animals | always |
| `return_for_food` | obtain_food | go back through the portal for food | off the Overworld, unless Jev chose to go on in the Nether without it (keep_on, twenty minutes) |
| `hoglin_food` | obtain_food | hunt a hoglin for porkchops | in the Nether, a hoglin in view or seen within 192 blocks; its drops, a one-hoglin fight estimate and the mobs about are said |

### `shelter_method`

**A shelter for the night: the saved one, a room at a site, a pocket here, a shaft pocket, a mine, or the carried bed in a nook dug for it?**

- When: When a shelter is chosen for the night (secure_shelter) and none is under way; held for the night, and asked again when the chosen way fails (it rests three minutes).
- Decision tree, choice; stakes medium; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (refugeStep)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `bed_beside` | root | seal a pocket now and at bedtime put the carried bed down beside it and sleep | before bedtime in the Overworld with a bed carried, no nook to be had, a pocket sealable here and level ground for the bed within four blocks; said with the seconds to bedtime and the monsters within the vanilla sleep range |
| `saved_shelter` | root | go back to the saved shelter and seal it | a shelter is remembered with a route to it and dry below |
| `build_at_site` | root | build a small room at a dry site | a dry site within reach has a route to it |
| `seal_here` | root | seal a pocket where the bot stands | always (with too few blocks it digs in instead) |
| `shaft_pocket` | root | dig straight down and cap it | always; fails where the ground cannot be dug |
| `night_mine` | root | dig a mine from here for the night | a pickaxe (or one can be made) and nothing watching; health is Jev's to weigh |
| `bed_nook` | root | the carried bed in a nook dug beside the bot | a bed carried in the Overworld and a nook can be dug here: at bedtime it is dug and slept in now; before it, a pocket is sealed here and the nook, closed in rock, is dug out of its wall at bedtime and slept in (held, not asked again) |

### `pocket_next`

**Sealed in a pocket: stay, leave, go to the bed, sleep in the carried bed in a nook dug out of the wall, open the wall on a watcher, dig a passage out away from a creeper, mine the night away, hunt mobs for their drops, or take the valuables to the chest?**

- When: Each survival step inside a sealed pocket, unless a mob is inside or at arm's length (that is fought as a reflex); the choice holds ninety seconds for the same watcher and the same night.
- Decision tree, choice; stakes medium; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (stepOnce: the pocket)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `sleep_beside` | root | open the pocket, put the carried bed down beside it and sleep | at bedtime in the Overworld with a bed carried and no nook to be had, level ground for the bed beside the pocket; said with the monsters within the vanilla sleep range now |
| `go_to_bed` | root | open the pocket and go to the bed | bedtime, with the base bed near (on the surface or within ten blocks of its level) or a bed carried on the surface |
| `sleep_in_nook` | root | dig a bed nook out of the pocket's wall and sleep in the carried bed | bedtime, a bed carried, and a nook beside the bot closed in rock all round, so the pocket stays shut (its wall goes back after); taken without asking when the shelter method chosen tonight was the bed nook; the monsters within eight blocks sideways and five up or down of the bed are counted in the option |
| `open_on_watcher` | root | open the wall toward the watching mob and fight it | a mob within four and a half blocks and a sword or axe carried |
| `night_mine` | root | mine from the pocket through the night | night, nothing watching, and a pickaxe carried or makeable (no health floor: Jev weighs the risk); it stays in the pocket when no mine can be dug from here |
| `work_here` | root | stay and make the ladder's next item in the pocket | on the game ladder, nothing watching, and the next item can be made from what is carried by smelting and crafting alone |
| `hunt_[a-z_]+` (pattern) | root | open the pocket and hunt this kind of mob for its drops | night, nothing watching, one for each kind of mob within thirty-two blocks whose drops are known, with the drops, their uses, a one-mob fight estimate and what a death would drop; two minutes, six health lost hands back |
| `stash_valuables` | root | open the pocket and put the valuables in the stash chest | night, nothing watching, a stash chest within 128 blocks and valuables carried |
| `cache_valuables` | root | open the pocket and put a chest down outside for the valuables | night, nothing watching, home's chest out of reach, valuables carried, and a chest or the wood for one |
| `tunnel_from_warden` | root | dig a passage out through the far wall, away from the warden, to beyond its boom, and go back to work from its end | a warden within thirty-two blocks, the bot not in water, digging and walking at hand, and the rock away from it safe to dig for at least four cells to a point seventeen or more blocks across from it (its boom reaches fifteen), twenty-four cells at most; said with the direction, the cells, about how long, the clearance, that digging is a vibration it follows, what a warden does, and the booms taken in the last minute |
| `tunnel_out` | root | dig a passage out through the far wall, away from the creeper, and go back to work from its end | a creeper within sixteen blocks (the rule that keeps a door within six of one shut would refuse the doors), the bot not in water, digging and walking at hand, and the rock away from the creeper safe to dig for at least four cells to a point ten or more blocks from it; said with the direction, the cells, about how long, the clearance at its end, and that it stops, the bot still enclosed, if the creeper comes round toward its head within six blocks |
| `stay` | root | stay in the pocket | always |
| `leave` | root | open the pocket and go back to work | always |

### `night_mine_target`

**Mining through the night: which ore next, or a branch deeper?**

- When: Each time the night mine needs a new target and an ore is in sight within twenty-four blocks, below the feet, dry, and not lately failed.
- Decision tree, choice; stakes low; ledger kind `mining`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (nightMine, nightTarget)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `ore_\d+` (pattern) | root | dig to this ore | the nearest of its kind, with its distance, what is carried and what it is for |
| `branch` | root | dig a branch down and along | always |
| `light_tunnel` | root | put a torch in the tunnel here | torches carried and the cells around are dark enough for monsters |

### `evening_chore`

**Home before bedtime: which chore now (the stash, the wheat, the farm, the cows, the plot), or wait for the bed?**

- When: At home within six blocks of the bed, from the walk-home hour until bedtime, with a chore on offer; waiting, once chosen, holds until a new chore appears.
- Decision tree, choice; stakes low; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (step), src/home-base.js (homeChores), src/home-stash.js (stashChores)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `stock_stash` | root | put spares in the chest | spares are carried |
| `harvest_and_bake` | root | harvest the ripe wheat and bake bread | enough ripe or carried wheat for a loaf |
| `tend_farm` | root | till, harvest or plant the plot | the plot needs work |
| `breed_cows` | root | breed the cows in the pen | two adults, two wheat, and the cooldown past |
| `light_home` | root | put torches where monsters could spawn around home | ground around home is dark and torches are carried or can be made |
| `wall_home` | root | build a wall two blocks high round home, with a door by the bed | the bed and the chest are down and home is not walled yet |
| `grow_plot` | root | mark the plot to grow by a column | the home is complete and the plot has not grown yet |
| `wait_for_bedtime` | root | wait by the bed for bedtime | always |
| `[a-z_]+` (pattern) | root | another home chore | offered by the stash or the home |

### `unstuck_move`

**Stuck: which single move next (walk, climb, dig, place a block, pillar, swim up)?**

- When: A stall while the bot is in water, or under cover on the way up (the survival layer's stall, or the work stall's work_free answer): each move asked in turn until the bot is out, twenty-four moves pass, or four in a row change nothing.
- Decision tree, choice; stakes medium; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/unstuck.js (localMoves)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `(step\|climb\|place)_(north\|east\|south\|west)` (pattern) | root | walk, climb or place a block that way | the cells that way allow it |
| `dig_(north\|east\|south\|west)_(feet\|head\|over)` (pattern) | root | dig the block that way | a natural block there, and a tool for it if it needs one |
| `dig_up\|dig_down\|swim_up\|pillar` (pattern) | root | dig over the head or underfoot, swim up, or pillar | what is over the head or underfoot allows it |

### `climb_out`

**Climbing out of the mine by digging: a staircase toward open ground, straight up the column overhead, or a span across open cave toward the way up?**

- When: A climb to the surface with no dug way out found, when it starts digging; asked again when the pickaxes carried change, a way not offered before is open, the column would not rise, or a span has been laid.
- Decision tree, choice; stakes medium; ledger kind `mining`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/surface.js (returnToSurface, chooseClimb, climbOptions)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `staircase` | root | dig a staircase up toward open ground | always |
| `straight_up` | root | dig straight up, a block put under the feet at each step | the column to open sky has only natural ground to dig, nothing that falls or flows in or beside it, and a building block carried for every step up |
| `bridge` | root | lay a level span across the open cave toward the way up, then look again from its end | a straight crossing at the feet's height toward the way up has open air to lay blocks over and gains four blocks or more on it |

### `corpse_run`

**Go back for what the last death dropped, or leave it and go on?**

- When: After a death whose drops are worth fetching and still there, once the bot is fit to go; asked once a death.
- Decision tree, choice; stakes medium; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/corpse-run.js (corpseRunStep)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `go_back` | root | go back for the drops | always |
| `leave_them` | root | leave them and go on | always |

## combat

### `ranged_response`

**A mob that shoots is in clear view at bow range: shoot it, run for cover, or dig in?**

- When: A shooting mob is in clear view at bow range, a bow and arrows are carried, health is eight or more and no melee mob is within three blocks.
- Decision tree, choice; stakes high; ledger kind `survival`
- Bar: none: Jev's pick is taken at any confidence; the health rule answers only when Jev cannot be reached
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (rangedChoice)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `shoot_\d+` (pattern) | root | shoot this mob | it is in clear view with a solved arrow path (up to three targets) |
| `retreat` | root | run for cover out of its sight | always |
| `dig_in` | root | seal a two-block pocket here | twelve or more building blocks are carried |

### `encounter_stance`

**Hostile mobs are near the bot: fight here, go up, dig into the wall, dig down, seal in, run, eat, shoot, charge the shooters, dance with the creeper, or leave them be and keep working?**

- When: An encounter the reflexes (the swing at arm's length, a shield against an arrow in flight, off a ledge) have not settled, with two or more stances possible (one is taken without asking); held for fifteen seconds, until health falls by six, until the stance fails, or until a mob it was not chosen against comes within six blocks (not when a kind of mob comes into view further off or goes out of it). A stance that failed is not offered again within four blocks of where it failed for twenty seconds. While a stance holds, the shield at each arrow gives way to a stance that moves or builds, the hurt watchdog to any stance but keep_working, and eating to the eat stance. Off with JEV_ENCOUNTERS=0.
- Decision tree, choice; stakes high; ledger kind `combat`
- Bar: none: Jev's pick is taken at any confidence: a stance is held fifteen seconds and asked again when health falls by six, when it fails or when a new mob comes close, so a close call is soon corrected; the encounter rules answer only when Jev cannot be reached
- Jev unreachable: stops: no safe default
- Options built in: src/survival.js (stanceOptions)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `take_cover` | root | put a block two high in the line of each shooter in sight and stay behind it | shooters in sight (up to three), two blocks each carried, not in water; said with the blocks, the seconds and the damage in the next fifteen seconds this way |
| `fight_from_footing` | root | step onto firm ground away from the drop, then fight there | the drop beside the bot is into lava or does half its health or more, and ground three blocks from any drop is within eight; said with its distance and seconds |
| `fight` | root | fight where the bot stands | always, with bare hands when no sword, axe or trident is carried |
| `eat_golden_apple` | root | eat a golden apple now | a golden or enchanted golden apple is carried and health is below full |
| `pillar` | root | go two blocks up and fight from there | two scaffold blocks carried and three clear blocks overhead |
| `come_down` | root | come down the bot's own pillar, digging the block underfoot | standing on a pillar of its own blocks with a floor under it |
| `bunker` | root | dig into the nearby wall and fight at the doorway | a wall is near that digs in three seconds |
| `seal` | root | seal a pocket and wait | four or more building blocks are carried |
| `dig_down` | root | dig straight down where the bot stands and close the hole over its head | a dry column of diggable ground under the bot walls it in within twelve blocks, a block carried for the cap, a pickaxe or ground soft enough for the hand, not in water |
| `eat` | root | eat food now | food carried, health below full, hunger below full and eighteen or more after the meal (health comes back) |
| `charge_shooter` | root | run at the ground shooters one after another and strike | skeletons, strays, bogged, pillagers or witches in view within sixteen, a sword or axe carried, not in water |
| `creeper_dance` | root | hit the creeper and back out of its blast, again and again | a creeper within six, a sword or axe carried, no drop or lava to back into |
| `keep_working` | root | carry on with the work and leave the mobs be for fifteen seconds | nothing within three blocks; ends early when one comes within three or lands a hit |
| `retreat` | root | run for footing out of reach and sight | always |
| `get_out_of_water` | root | swim for dry ground and deal with the mobs from there | in water; the pillar, the pocket, the bunker and digging down are not offered there |
| `portal_back` | root | go back through the portal to the Overworld | in the Nether with a portal within eight blocks and a way back through it |
| `shoot_\d+` (pattern) | root | shoot this mob with the bow | a bow, arrows and a clear arrow path (up to two targets) |

### `hunt_target`

**The request needs a mob's drop: which observed mob should the bot fight now, or leave them for now?**

- When: A mob hunt step with at least one candidate in view that is reachable and isolated, the bot on ground it can fight from (dry, not on a one-wide span, air to breathe).
- Decision tree, choice; stakes high; ledger kind `combat`
- Bar: none: every target offered is reachable and isolated and the bot has footing for a fight; the fitness is said in full on every option, a close call between fighting and leaving it is a preference, and the outage default is the same nearest target
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/mob-hunt.js (huntObserved, fitness, fitnessSays)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `hunt_\d+` (pattern) | root | fight this mob | observed, reachable, isolated from others of its kind; said with the one fight's estimate and the bot's fitness: health against the fourteen the code once required, hunger and whether health comes back, food carried, fire, and the kit |
| `defer` | root | leave them for now | always; said with the fitness, and what the hunt does meanwhile when the bot is short of it (food, cover, health) |

## strategy

### `crossing_kit`

**Cross into the Nether with the kit carried now, or first top up one named item of it (food, health, blocks, a spare pickaxe, wood) or leave the valuables behind?**

- When: In the Overworld on the way through a portal, in Survival, with some item of the kit short of what the code would take or valuables carried that could be left; held until what is on offer changes or for ten working minutes.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (crossingKitReady), src/crossing-kit.js (kitItems, valuablesAt)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `cross_now` | root | cross with what is carried | always |
| `top_up_food` | root | gather food first, up to forty points | fewer than forty food points carried, monsters on |
| `top_up_health` | root | wait and heal first, to sixteen | health under sixteen, monsters on |
| `top_up_blocks` | root | mine stone first, up to two stacks of blocks | fewer than 128 building blocks carried |
| `top_up_pickaxe` | root | make a stone pickaxe first, as the spare | no stone pickaxe or better, or the best has under 24 uses |
| `top_up_gold` | root | make golden boots first, a piece of gold worn so piglins leave the bot be | no piece of golden armour carried |
| `top_up_wood` | root | gather logs up to eight and make a crafting table first | fewer than eight logs or no crafting table carried |
| `stash_valuables` | root | walk home and leave the valuables in the stash chest first | the home stash chest within 128 blocks and valuables carried |
| `cache_valuables` | root | leave the valuables in a chest put down here first | home's chest out of reach, valuables carried, and a chest or the wood for one |

### `win_strategy`

**On the way to beating the game, which of the open steps, the Nether now, or a side trip should the bot do next; and if a side trip, which?**

- When: Each step of the beat-the-game ladder in the Overworld while more than one thing is open; the answer holds until the ladder's next step or the top-level choices change (a side trip coming into view among others does not), or ten minutes pass. A side trip runs once and then rests ten minutes.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/strategy.js (strategyOptions, strategyTree, homeOption), src/game-progress.js (openRungs), src/work.js (sideTrips)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `rung_[a-z_]+` (pattern) | root | a rung of the ladder | the ladder's next rung (the fallback), and each rung after it the ladder may reach while the ones before it wait (shield, iron sword, bucket, iron armour, golden boots, bow, arrows, diamond sword); pickaxes are never skipped. Each is said alike, with what it is for, what it takes from the pockets and what going without costs |
| `stage_[a-z_]+` (pattern) | root | the ladder's later stage | past the preparation ladder in the Overworld (pearls, the crossing, the stronghold): the fallback |
| `nether_first` | root | leave the steps that may wait and go for the Nether now | in the Overworld when every step left before the Nether may wait (DEFERRABLE); said with what going without each costs and the minutes spent on the step at hand |
| `side_trip` | root | a side trip, off the way to the Nether | one or more trips below are on offer; said with the trips it holds (all of the one, when there is one) |
| `home_base` | side_trip | work on a home base | in the Overworld, the next step not a basic tool, and a base not yet begun or not finished (home-base.js homeStage), its step not set aside; said with the steps left, what it buys (the spawn point kept by the chest, a chest that keeps things from a death, bread and steak a known walk away), that none of it is needed for the Nether, the walk to it and the minutes already spent. Chosen, it holds like a rung, a step at a time |
| `carry_bed` | side_trip | make a second bed to carry | at any hour in the Overworld, once the base's bed is claimed, with no bed carried, the wool search not set aside and the next step not a basic tool; said with what it buys (any night passes in seconds, instead of a pocket and the climb out) and what it costs (three wool from sheep or string, three planks) |
| `take_home_bed` | side_trip | take the base's bed along | health fourteen and hunger twelve or more, the base's bed claimed and standing, none carried, in the Overworld; said with what it buys and that the spawn point moves with it |
| `copper_armour` | side_trip | make copper armour first | in the Overworld with a stone pickaxe or better and no armour worn or carried |
| `deep_dark` | side_trip | an expedition to the deep dark | in the Overworld with an iron pickaxe or better, health sixteen and hunger fourteen or more, no warden rest, and no city already done |
| `trial_chambers` | side_trip | an expedition to the trial chambers | in the Overworld with an iron pickaxe or better, healthy and fed, and the chambers not already done |
| `explore` | side_trip | explore the nearest unexplored area | in the Overworld with an unexplored area within 512 blocks of home |
| `fetch_cache` | side_trip | fetch the things left in a field cache | a chest left before an earlier trip, full, between 48 and 512 blocks away |
| `cache_valuables` | side_trip | leave the valuables in a chest here | by day and fit, home's chest out of reach, valuables carried, and a chest or the wood for one |
| `travel_[a-z_]+` (pattern) | side_trip | walk to a nearby biome | by day and fit, another biome twenty-four or more blocks off in the Overworld (the nearest four), said with what it holds, and the walk there and back fits in the daylight left |
| `tame_wolf` | side_trip | tame a wolf | a wild adult wolf in view, bones carried, fewer than two tamed, in the Overworld |
| `breed_cows_here` | side_trip | breed two cows in the field | two adult cows within sixteen blocks, two wheat carried, none bred in five minutes |
| `breed_sheep` | side_trip | breed two sheep | two adult sheep within sixteen blocks, two wheat carried, none bred in five minutes |
| `breed_chickens` | side_trip | breed two chickens | two adult chickens within sixteen blocks, two seeds carried, none bred in five minutes |
| `loot` | side_trip | open the chests of a remembered structure | by day, health fourteen or more and hunger twelve or more, with an unlooted ruined portal, dungeon, temple or mineshaft within 256 blocks |
| `trade` | side_trip | trade at a remembered village | by day and fit, with a village remembered and something to sell or spend |
| `enchant` | side_trip | enchant gear at the enchanting table | by day and fit, with a table known, lapis carried, level five or more and gear unenchanted |
| `shear_sheep` | side_trip | shear the sheep in view | shears carried, a sheep with wool within twenty-four blocks, fewer than fifteen wool carried, in the Overworld |
| `smelt_stock` | side_trip | smelt the raw ore carried into ingots | at any hour, eight or more raw iron or gold carried and the fuel for all of it |
| `enchanting_table` | side_trip | make an enchanting table | no table known, two diamonds and three lapis carried, level five or more, obsidian carried or a diamond pickaxe, and gear unenchanted |

## work

### `portal_method`

**The way into the Nether: build a portal frame of its own from obsidian, cast one in place from lava and water (here, or beside the known lava), or finish and light a remembered ruined portal; or make more buckets first?**

- When: In the Overworld on the way to the Nether, with no lit portal known and no frame begun; held once chosen and asked again after every twenty working minutes on the way held (said with the minutes and what they made, to keep or change), or when a chosen ruin's frame will not do.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (portalMethod, portalFacts, methodSoFar), src/portal-cast.js (castSays)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `build_new` | root | build a frame of its own from ten obsidian | always |
| `cast_frame` | root | cast a frame of its own in place from lava and water | always |
| `cast_at_lava` | root | cast a frame of its own beside the nearest known lava | lava known more than sixteen blocks away |
| `craft_buckets` | root | make more buckets first from the iron carried | three or more iron ingots carried |
| `ruin_[0-9]+` (pattern) | root | finish and light a remembered ruined portal | a ruined portal remembered within 512 blocks, not found frameless (and the one held, however far) |

### `sculk_work`

**The work is within reach of sculk (a sensor that hears the bot, or a shrieker that calls a warden): carry on as now, carry on crouched, or take the work out of its reach?**

- When: Between work steps in the Overworld, with Jev reachable, when the bot is within a sculk sensor's hearing (eight blocks) or sixteen blocks of a shrieker that can call a warden; once per patch, the answer held five minutes.
- Decision tree, choice; stakes high; ledger kind `upkeep`
- Bar: none: Jev's pick is taken at any confidence: every answer is held only five minutes, so a close call is soon asked again, and the warden is not a rule code can weigh for it
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (sculkStep)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `carry_on` | root | carry on here as now | always |
| `work_crouched` | root | carry on here, walking crouched | always; five minutes crouched, a third of walking speed, digging and placing still heard |
| `move_away` | root | take the work out of the sculk's reach | a standing place out of every sensor's hearing within thirty-two blocks; its lava and remembered places within sixteen blocks passed over for thirty minutes |

## resources

### `resource_source`

**Which source (tree, vein, deposit) should the bot work for the resource the request needs?**

- When: An acquisition step needs a material and no chosen source is still being worked; a single feasible option is taken without asking.
- Decision tree, choice; stakes medium; ledger kind `source`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (executePlannedAcquisition), src/decision-options.js (resourceSources)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `obtain_item` | root | gather and make the requested outputs | always (the root) |
| `mine\|craft\|smelt\|harden\|fill_bucket\|make_obsidian\|hunt_mob\|creative_inventory` (pattern) | obtain_item | the next recipe dependency | the shared recipe plan's next step |
| `source_[a-z_]+_-?\d+_-?\d+_-?\d+` (pattern) | step | work this source | reachable blocks of the resource grouped by block and place, up to four, none set aside |
| `find_resource` | step | search for a reachable source | a mine step with no reachable source |
| `execute_recipe` | step | carry out the recipe step | a non-mining step |

### `gather_more`

**The step has what it asked for and more of the same is within reach: keep taking it, or stop?**

- When: Once per source, when a mining step has met its count and more of the trunk, vein or stone face is within six blocks, up to a cap (eight logs, thirty-two of an ore, two dozen stone).
- Decision tree, choice; stakes low; ledger kind `source`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (moreOfSource)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `take_more` | root | keep taking it while it is at hand, up to the cap | always |
| `enough` | root | stop at what the step asked for | always |

### `inventory_drop`

**The pockets are full and something needs room: which stack is dropped, or none?**

- When: An item the work wants (a drop, a craft, a smelt, food) has no slot; asked up to three times until there is room.
- Decision tree, choice; stakes medium; ledger kind `inventory`
- Bar: none: dropped stacks lie where they fell and can be picked up again; the only-tool and block-reserve facts are said in each option
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/inventory-tidy.js (makeRoom, jevMakesRoom)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `drop` | root | drop a stack (which one is asked beside it) | any stack can go |
| `drop_\d+` (pattern) | drop | drop this stack | any stack but the item the room is for and what the work in hand uses |
| `none` | root | drop nothing and go without | always |

### `while_cooking`

**A furnace batch is cooking: dig what is in reach, walk to an ore or tree nearby, dig stone, or wait by the furnace?**

- When: Once a smelting batch, from one item (eight seconds) up, when something besides waiting is possible.
- Decision tree, choice; stakes low; ledger kind `smelting`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (smelt, whileCooking)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `dig_in_reach` | root | dig the ore within arm's reach | an ore within reach of where the bot stands |
| `mine_nearby` | root | walk to an ore or tree nearby and dig | an ore within sixteen blocks, or a log while fewer than sixteen are carried, and the walk there and back fits in the cooking |
| `dig_stone` | root | dig the stone around the furnace | fewer than sixty-four cobblestone carried |
| `wait_here` | root | stand by the furnace | always |

### `dug_into_liquid`

**Water or lava ran into a block the bot just dug: plug the gap, or carry on?**

- When: After a dig beside water or lava, when the liquid is seen in the dug cell, the bot is on dry ground, and a building block is carried.
- Decision tree, choice; stakes medium; ledger kind `mining`
- Bar: none: a plug is one block, taken back up as easily; the choice is asked again at the next leak
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (dig, leakResponse)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `plug` | root | put a block back in the gap | a building block is carried |
| `carry_on` | root | leave it running and carry on | always |

### `sheep_search`

**No sheep in view for the bed's wool: which nearby biome to look in, back to sheep seen earlier, explore on from here, or craft wool from string carried?**

- When: Gathering wool with no sheep in view and another biome within the loaded area; the pick holds until the bot is there or the walk fails.
- Decision tree, choice; stakes low; ledger kind `explore`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/home-base.js (searchForSheep), src/exploration.js (biomeView)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `biome_\d+` (pattern) | root | walk to this biome and look there | a biome other than the one underfoot, twenty-four or more blocks off, with its distance, direction and what it holds |
| `seen_\d+` (pattern) | root | walk back to sheep seen earlier | a flock seen in the last half hour, now out of view, with how many, how long ago, its distance and direction |
| `explore_here` | root | explore on from here | always |
| `craft_from_string` | root | craft wool from the string carried | four or more string carried and wool still wanted |
| `cut_cobwebs` | root | cut the cobwebs in view with the sword for string | a sword carried, two or more cobwebs within thirty-two blocks, and string still wanted for the bed |

### `search_heading`

**Searching for a resource with none in view: which way to head?**

- When: A surface search (logs, sand, clay and the like) that needs a new heading: at its start, when a leg is walked, or after three walks that got nowhere. The heading is held until then; the leg is up to 512 blocks.
- Decision tree, choice; stakes low; ledger kind `explore`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (explore), src/exploration.js (biomeRay)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `heading_(east\|south_east\|south\|south_west\|west\|north_west\|north\|north_east)` (pattern) | root | head this way | always; each says the biomes that way and how often this search went that way |

### `upkeep`

**Something the bot keeps in its pockets is running short (a spare pickaxe, wood, building blocks): see to it now, or carry on?**

- When: Between work steps, when a pickaxe is nearly worn with the makings of a spare carried, fewer than three logs' worth of wood are carried, or (on the game ladder) fewer than sixteen building blocks; not at night on the surface or in water. "Carry on" holds five minutes.
- Decision tree, choice; stakes low; ledger kind `upkeep`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (upkeepStep)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `spare_pickaxe` | root | make a spare stone pickaxe now | every pickaxe carried has under twenty-four uses left and cobblestone and sticks (or wood) are carried |
| `wood_reserve` | root | cut a few logs now | on the game ladder, fewer than three logs' worth of wood carried, in the Overworld |
| `block_reserve` | root | gather building blocks now | on the game ladder, fewer than sixteen building blocks carried |
| `take_bed` | root | take the base's bed along now | on the game ladder in the Overworld, the base's bed standing within a short walk and none carried |
| `food_reserve` | root | find food before dark | on the game ladder in the Overworld, less than a kit's food carried in the last minutes of daylight |
| `carry_on` | root | carry on and see to it later | always; asked again in five minutes |

### `opportunistic_ore`

**An ore is within six blocks along the way: take a short detour for it, or carry on?**

- When: Every third mining or tunnelling step with a useful ore in reach, and at once when an ore the bot is short of is in reach (coal, iron, lapis, diamonds, nether gold for pearls); the shortage is said in the option. Without Jev a short ore is taken.
- Batched question, choice; stakes low; ledger kind `mining`
- Bar: none
- Jev unreachable: no detour: an error or a five-second timeout is swallowed and the main step carries on
- Options built in: src/opportunistic-mining.js (opportunityCandidates)

### `opportunistic_animal`

**An animal whose drop the bot is short of is in view: chase it briefly, or carry on?**

- When: Every third step with a sheep (fewer than three wool carried) or a chicken (fewer than four feathers) in view.
- Batched question, choice; stakes low; ledger kind `pickup`
- Bar: none
- Jev unreachable: no detour: an error or a five-second timeout is swallowed and the main step carries on
- Options built in: src/opportunistic-pickups.js (animalCandidates)

### `trade_choice`

**At a village with the villagers' offers read: which one trade to make?**

- When: A trade step (the idle trade option, or the pearl rung when a cleric's pearls are known) once the offers of the villagers in reach are read and at least one trade is feasible.
- Decision tree, choice; stakes low; ledger kind `trade`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/trading.js (tradeStep, tradeOptions)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `buy_[a-z_]+_\d+` (pattern) | root | buy this item with emeralds | the output is something the run needs (pearls, arrows, a bow, better armour or tools, food when short) and the emeralds are carried |
| `sell_[a-z_]+_\d+` (pattern) | root | sell spare items for emeralds | the input is carried beyond what is kept back, and fewer than forty emeralds are carried |

## build

### `house_build_step`

**Which house-building step next: choose a site, gather materials, clear the inside, or place a block?**

- When: Each step of a small-house request.
- Decision tree, choice; stakes medium; ledger kind `build`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (houseDecisionStep)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `build_house` | root | continue building the house | always (the root) |
| `choose_site` | build_house | choose a site | no site is reserved yet |
| `reserve_site\|survey_ground` (pattern) | choose_site | reserve the inspected site, or look for level ground | under choose_site: a level site was found, or not |
| `gather_materials` | build_house | gather building material | less material is carried than the blocks still missing |
| `source_[a-z_]+_-?\d+_-?\d+_-?\d+\|explore_resource\|mine\|craft\|smelt\|prepare_material` (pattern) | gather_materials | a source or recipe step for the material | under gather_materials |
| `clear_interior` | build_house | clear the inside and doorway | blocks stand where the house must be empty |
| `clear_-?\d+_-?\d+_-?\d+` (pattern) | clear_interior | clear this cell | under clear_interior |
| `build` | build_house | place blocks, lowest layer first | material is carried and cells are unbuilt |
| `(?:place\|clear)_-?\d+_-?\d+_-?\d+` (pattern) | build | place or clear this cell | under build: the lowest unfinished layer |

### `build_mode`

**Does the build request continue a standing structure: finish, edit, repair, or build fresh?**

- When: A build request when structures Jev built stand nearby.
- Batched question, choice; stakes high; ledger kind `request`; batch **build continuation**
- Bar: 0.65: an unsure edit is built fresh beside the structure instead, which destroys nothing
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/builds.js (resolveBuildContinuation)

### `build_target`

**Which standing structure does the request mean?**

- When: A build request when structures Jev built stand nearby.
- Batched question, choice; stakes high; ledger kind `request`; batch **build continuation**
- Bar: 0.65: an edit of an unsure target is built fresh beside it instead
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/builds.js (resolveBuildContinuation over builds.describe)

### `build_placement`

**Where should the structure go: here, beside the target, or anywhere?**

- When: Every build request.
- Batched question, choice; stakes medium; ledger kind `request`; batch **build continuation**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/builds.js (resolveBuildContinuation)

### `template_style`

**Which template fits the request: cottage, mansion, tower, or none?**

- When: A build request in Survival, or with no generative designer configured.
- Batched question, choice; stakes medium; ledger kind `design`; batch **template design**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/build-templates.js (designWithJev)

### `template_floors`

**How many floors?**

- When: A build request in Survival, or with no generative designer configured.
- Batched question, choice; stakes low; ledger kind `design`; batch **template design**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/build-templates.js (designWithJev)

### `template_size`

**Ordinary or large?**

- When: A build request in Survival, or with no generative designer configured.
- Batched question, choice; stakes low; ledger kind `design`; batch **template design**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/build-templates.js (designWithJev)

### `template_shelf_part`

**If no template fits, which ready-made design on the shelf is asked for?**

- When: A build request in Survival, or with no generative designer configured, when the shelf has parts.
- Batched question, choice; stakes medium; ledger kind `design`; batch **template design**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/build-templates.js (designWithJev), src/schematic-library.js (library)

### `template_material`

**Is a building material named or remembered?**

- When: A build request in Survival, or with no generative designer configured.
- Batched question, choice; stakes low; ledger kind `design`; batch **template design**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/build-templates.js (designWithJev)

### `schematic_design`

**Which design on the shelf best answers the request, or fits the village?**

- When: A shelf part with more than one design: a build request or the village dream.
- Batched question, choice; stakes medium; ledger kind `design`
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/schematic-library.js (chooseSchematic)

### `design_fits`

**Does the drawn design answer what was asked, in kind, scale and material?**

- When: Every design the generative designer returns, before building.
- Batched question, noul; stakes high; ledger kind `design`
- Bar: 0.5: a design that does not answer the request is sent back to the designer with the reason, up to four times
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/design-review.js (reviewDesign)

## idle

### `idle_work`

**With no request and shelter and food sufficient, how should the bot spend spare daylight?**

- When: Between player requests, by day, with health fourteen or more, hunger twelve or more and no threat.
- Decision tree, choice; stakes medium; ledger kind `idle`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (idleOptions), src/home-base.js (homeChores)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `cook_food` | root | cook the raw food carried | raw meat is carried |
| `stone_tools` | root | make stone tools | a stone pickaxe, axe or sword is missing |
| `stock_wood` | root | stock up to sixteen logs | fewer than sixteen logs are carried and a tree is in view |
| `explore` | root | explore the nearest unexplored area | in the Overworld, with an unexplored area within 512 blocks of home |
| `loot` | root | open the chests of a remembered structure | in the Overworld, with a ruined portal, dungeon, temple or mineshaft within 256 blocks whose chests are unopened |
| `earn_xp` | root | smelt raw ore for experience | eight or more of a raw ore are carried, gear is still unenchanted and the experience level is under thirty |
| `enchant` | root | enchant gear at the enchanting table | a table is carried, in view or remembered, lapis is carried, the experience level is five or more, and gear is unenchanted |
| `trial_chambers` | root | an expedition to the trial chambers | in the Overworld with an iron pickaxe or better, healthy and fed |
| `tame_wolf` | root | tame a wolf | a wild adult wolf in view and bones carried, fewer than two tamed |
| `breed_cows_here` | root | breed two cows in the field | two adult cows near and two wheat carried |
| `breed_sheep` | root | breed two sheep | two adult sheep near and two wheat carried |
| `breed_chickens` | root | breed two chickens | two adult chickens near and two seeds carried |
| `fetch_cache` | root | fetch the things left in a field cache | a full field cache between 48 and 512 blocks away |
| `cache_valuables` | root | leave the valuables in a chest here | in the Overworld, home's chest out of reach, valuables carried, and a chest or the wood for one |
| `copper_armour` | root | make copper armour first | in the Overworld with a stone pickaxe or better and no armour worn or carried |
| `travel_[a-z_]+` (pattern) | root | walk to a nearby biome | in the Overworld, another biome twenty-four or more blocks off (the nearest four), said with what it holds |
| `deep_dark` | root | an expedition to the deep dark | in the Overworld with an iron pickaxe or better, healthy and fed, no warden rest, and no city already done |
| `trade` | root | trade at a remembered village | a village is remembered within 256 blocks and emeralds or spare items to sell are carried |
| `torches` | root | craft torches | coal is carried and fewer than eight torches |
| `harvest_and_bake` | root | harvest the home plot and bake bread | wheat on the home plot is ripe |
| `tend_farm` | root | tend the home plot | the home plot needs tilling, planting or a look |
| `breed_cows` | root | breed the cows in the home pen | two adult cows are penned and wheat is carried |
| `lure_cows` | root | lead loose cows into the home pen | the pen has fewer than two cows and cows are in view |
| `fetch_cows` | root | walk to cows seen earlier and lead two back to the pen | the pen has fewer than two cows, none in view, wheat carried, and cows remembered within 160 blocks |
| `stock_stash` | root | put spares in the stash chest | the stash chest is within reach and spares are carried |
| `light_home` | root | put torches where monsters could spawn around home | the bed and the chest are down, ground around home is dark, and torches are carried or can be made |
| `wall_home` | root | build a wall two blocks high round home, with a door by the bed | the bed and the chest are down and home is not walled yet |
| `long_game` | root | work toward beating the game | the dream is to beat the game and its ladder is not complete |

### `stillness_detour`

**The work has got nowhere for forty-five seconds: keep at it another way, leave its rung for later, or do something useful from here for a few minutes?**

- When: A stall (src/stillness.js): forty-five seconds on one action without new ground, a gain, a block changed or getting nearer, outside a permitted wait; a single option is taken without asking.
- Decision tree, choice; stakes low; ledger kind `idle`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (answerStall, breakStillness), src/stillness.js (the rule)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `differently` | root | keep at the stalled work another way | work stalled (not idle time): a mine leaves this patch of the resource, anything else turns its search |
| `set_aside_rung` | root | leave the stalled rung for thirty minutes | the stall is on a game-ladder rung that can wait |
| `work_free` | root | work free of the terrain one move at a time | the bot is in water, under cover on the way up, or where every walk has failed (src/unstuck.js); each move is then Jev's (unstuck_move) |
| `night_mine` | root | dig a mine from here for the night | night in the Overworld, a pickaxe and nothing watching |
| `mine_nearby` | root | dig a useful ore in view | an ore within sixteen blocks with no lava beside it |
| `look_around` | root | walk twenty-four blocks somewhere new | by day in the Overworld, or when nothing else is on offer |
| `cross_toward` | root | tunnel or bridge straight toward where the stalled Nether work was going | in the Nether, a target known (the portal back, the fortress leg, the tunnel's end), and the cells ahead at this height let it come nearer: rock with no lava behind it, open air or lava to lay the blocks carried over (src/nether-travel.js) |
| `hoglin_food` | root | hunt a hoglin for porkchops | in the Nether, hungry with nothing to eat or on the way back for food, and a hoglin in view or seen within 192 blocks |
| `portal_here` | root | build a portal where the bot stands and go through | in the Nether on the way back (or hungry), ten obsidian, flint and steel or a fire charge, and three blocks for the lintel carried |
| `keep_on` | root | go on in the Nether without going back for food | in the Nether, hungry with nothing to eat or on the way back for food; the trip back is left out for twenty minutes |
| `cook_food` | root | cook the raw food carried | by day in the Overworld, and raw meat is carried |
| `stone_tools` | root | make stone tools | by day in the Overworld, and a stone pickaxe, axe or sword is missing |
| `stock_wood` | root | stock up to sixteen logs | by day in the Overworld, and fewer than sixteen logs are carried and a tree is in view |
| `explore` | root | explore the nearest unexplored area | by day in the Overworld, and in the Overworld, with an unexplored area within 512 blocks of home |
| `loot` | root | open the chests of a remembered structure | by day in the Overworld, and in the Overworld, with a ruined portal, dungeon, temple or mineshaft within 256 blocks whose chests are unopened |
| `earn_xp` | root | smelt raw ore for experience | by day in the Overworld, and eight or more of a raw ore are carried, gear is still unenchanted and the experience level is under thirty |
| `enchant` | root | enchant gear at the enchanting table | by day in the Overworld, and a table is carried, in view or remembered, lapis is carried, the experience level is five or more, and gear is unenchanted |
| `trial_chambers` | root | an expedition to the trial chambers | by day in the Overworld, and in the Overworld with an iron pickaxe or better, healthy and fed |
| `tame_wolf` | root | tame a wolf | by day in the Overworld, and a wild adult wolf in view and bones carried, fewer than two tamed |
| `breed_cows_here` | root | breed two cows in the field | by day in the Overworld, and two adult cows near and two wheat carried |
| `breed_sheep` | root | breed two sheep | by day in the Overworld, and two adult sheep near and two wheat carried |
| `breed_chickens` | root | breed two chickens | by day in the Overworld, and two adult chickens near and two seeds carried |
| `fetch_cache` | root | fetch the things left in a field cache | by day in the Overworld, and a full field cache between 48 and 512 blocks away |
| `cache_valuables` | root | leave the valuables in a chest here | by day in the Overworld, and in the Overworld, home's chest out of reach, valuables carried, and a chest or the wood for one |
| `copper_armour` | root | make copper armour first | by day in the Overworld, and in the Overworld with a stone pickaxe or better and no armour worn or carried |
| `travel_[a-z_]+` (pattern) | root | walk to a nearby biome | by day in the Overworld, and in the Overworld, another biome twenty-four or more blocks off (the nearest four), said with what it holds |
| `deep_dark` | root | an expedition to the deep dark | by day in the Overworld, and in the Overworld with an iron pickaxe or better, healthy and fed, no warden rest, and no city already done |
| `trade` | root | trade at a remembered village | by day in the Overworld, and a village is remembered within 256 blocks and emeralds or spare items to sell are carried |
| `torches` | root | craft torches | by day in the Overworld, and coal is carried and fewer than eight torches |
| `harvest_and_bake` | root | harvest the home plot and bake bread | by day in the Overworld, and wheat on the home plot is ripe |
| `tend_farm` | root | tend the home plot | by day in the Overworld, and the home plot needs tilling, planting or a look |
| `breed_cows` | root | breed the cows in the home pen | by day in the Overworld, and two adult cows are penned and wheat is carried |
| `lure_cows` | root | lead loose cows into the home pen | by day in the Overworld, and the pen has fewer than two cows and cows are in view |
| `fetch_cows` | root | walk to cows seen earlier and lead two back to the pen | by day in the Overworld, and the pen has fewer than two cows, none in view, wheat carried, and cows remembered within 160 blocks |
| `stock_stash` | root | put spares in the stash chest | by day in the Overworld, and the stash chest is within reach and spares are carried |
| `light_home` | root | put torches where monsters could spawn around home | by day in the Overworld, and the bed and the chest are down, ground around home is dark, and torches are carried or can be made |
| `wall_home` | root | build a wall two blocks high round home, with a door by the bed | by day in the Overworld, and the bed and the chest are down and home is not walled yet |

## recovery

### `recovery_action`

**After repeated failure at a step, which offered recovery action is most likely to unblock the request?**

- When: The same step has failed three times, or a failure was Blocked.
- Batched question, choice; stakes medium; ledger kind `recovery`
- Bar: 0.6: unsure, or none, nothing is done from the advice
- Jev unreachable: the failure goes on to persist (a clean slate and a backoff)
- Options built in: src/recovery-options.js (the options), src/recovery-adviser.js (askJev)

## home

### `home_site`

**Of the sites found for the home base, which should it be?**

- When: The home rung's site step, when two or more sites fit the layout (up to four, eight blocks apart, the level ones first).
- Decision tree, choice; stakes low; ledger kind `home`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/home-base.js (chooseBaseSite, pickHomeSite)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `site_\d+` (pattern) | root | build the home here | the whole layout fits, with its distance, levelling and water said |

## endgame

### `dragon_fight`

**In the Ender Dragon fight, what is the most useful action now?**

- When: Each step of the dragon fight in the End.
- Decision tree, choice; stakes high; ledger kind `end`
- Bar: none: Jev's pick is taken at any confidence and asked again each step; the fixed order (out of danger, crystals, head, arrow, position) answers only when Jev cannot be reached
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/end-combat.js (fightEndStep)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `crystal_\d+` (pattern) | root | shoot this healing crystal | in view with a solved arrow path and not missed repeatedly |
| `shoot_dragon` | root | shoot the flying dragon | a bow, arrows and a clear trajectory |
| `bed_bomb` | root | blow a bed beside the perched dragon's head | the dragon perched, a bed carried, health fourteen or more, and a trench line within twelve blocks |
| `strike_head` | root | strike the perched dragon's head | the head is within sword reach |
| `move_[a-z0-9_,.:-]+` (pattern) | root | move along this checked route | a safe surveyed route toward a crystal, the dragon or away from danger |
| `observe` | root | wait one second and watch | on a safe spot with the dragon in view, fewer than five idle watches in a row |

### `stronghold_waypoint`

**Following thrown Eyes of Ender, which surveyed waypoint should the bot walk to next?**

- When: Each step of the stronghold search once an Eye has given a bearing.
- Decision tree, choice; stakes medium; ledger kind `stronghold`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/stronghold.js (walkBearing)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `walk_\d+` (pattern) | root | walk this surveyed surface route | a surveyed route toward the Eye-indicated estimate |

### `fortress_approach`

**A Nether fortress is in view: which way should the bot go to it, or should it leave it and keep searching?**

- When: On the fortress search, when a fortress (two dozen or more of its bricks) comes into view more than six blocks off, and again each time the way chosen ends no nearer; the answer holds for the approach until it fails, five minutes at most.
- Decision tree, choice; stakes high; ledger kind `fortress`
- Bar: none: every way offered was surveyed and runs under the hard rules (a span laid crouched and never under a shooter's fire, no rock dug with lava behind it, no drop into lava, no swing or turn on a span); a way that fails is asked again with what failed, and the outage default is the order the code kept, a failed way passed over
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/mob-hunt.js (fortressApproaches, approachFortress), src/bridging.js (surveyCrossing), src/nether-travel.js (crossingSays)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `walk_route` | root | walk the pathfinder's route to it, level with the bot first, then at the bricks' height | a pathfinder is at hand; said with its surveyed route (cells, blocks it would place and dig, how many beside lava, how much nearer it ends) and that it walks upright |
| `descend` | root | dig straight down to the bricks below | the bricks are more than two blocks below and within twelve blocks across; said with the drop and that a drop too deep for the health or ending in lava is refused |
| `cross_level` | root | go straight at it at the height the bot stands, digging rock and laying a one-wide span | the cells ahead at this height let it come a block or more nearer (surveyCrossing); said with the cells, the blocks to lay against those carried, how many over lava, how much nearer it ends, what stops it, about how long, and the mobs in view |
| `tunnel` | root | dig a staircase through the rock toward it | a staircase is at hand |
| `keep_searching` | root | leave this fortress for ten minutes and go on searching | always |

### `fortress_leg`

**Searching the Nether for a fortress: which way should the next leg go, or should the bot first dig toward the heights fortresses stand at?**

- When: On the fortress search, each time a leg begins: at the start, when the last leg reached its end, and when the sweep turned for a leg that made no ground.
- Decision tree, choice; stakes medium; ledger kind `fortress`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/mob-hunt.js (chooseLeg, findFortressStep), src/nether-travel.js (surveyLeg, legSays)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `leg_(east\|south\|west\|north)` (pattern) | root | go this way ninety-six blocks at the height the bot stands | always, one for each heading; said with the cells ahead at this height (open air, how many of them over a drop of four or more, rock to dig at about six seconds a cell, and what stops it), about how long, whether it is back the way the last leg came, and how the last leg this way ended |
| `seek_fortress_height` | root | dig a staircase toward y 64 first, along the most open heading | the bot stands more than eight blocks above or below y 64 and a staircase is at hand; said with the height to make up and where fortresses stand |

## travel

### `boat_crossing`

**Code has checked a water crossing: take a boat, or keep walking and swimming?**

- When: A travel leg meets a level water route of useful length with a safe shore at each end.
- Batched question, choice; stakes low; ledger kind `travel`
- Bar: none
- Jev unreachable: counted as a failed boat choice; the bot walks or swims
- Options built in: src/boats.js (boatTravelStep)

### `discovery_target`

**Which catalog branch or exact biome or creature is to be found? (one level at a time)**

- When: A find request for a biome or creature.
- Batched question, choice; stakes medium; ledger kind `discovery`
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/discovery.js (discoveryCatalog)

## intake

### `intake_objective`

**What outcome does the message ask for: which of the sixteen request types?**

- When: Every chat message that reaches the bot.
- Batched question, choice; stakes high; ledger kind `request`; batch **request**
- Bar: 0.65: unsure, the bot asks which of the two likeliest outcomes was meant; the bar is 0.65 for the costly kinds and 0.5 for the rest, and none for other, status, stop, resume and dream
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_interaction`

**Is the message an instruction to act, or talk about something?**

- When: Every chat message that reaches the bot.
- Batched question, choice; stakes high; ledger kind `request`; batch **request**
- Bar: 0.65: for a costly kind, unsure whether it was an instruction or talk, the bot asks "now, or were we just talking?"
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_addressed`

**Is the message for this bot, when it does not start with the bot's name?**

- When: A chat message without the bot's name in front.
- Batched question, noul; stakes medium; ledger kind `request`; batch **request**
- Bar: 0.5: a message not clearly for this bot is left to the players it was for
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_memory_statement`

**Is the speaker telling Jev a personal fact or preference to remember?**

- When: Every chat message that reaches the bot.
- Batched question, noul; stakes medium; ledger kind `request`; batch **request**
- Bar: 0.75: a discussion is saved as a memory only when Jev is sure it is a personal statement for Jev
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_urgency`

**How much time pressure does the wording put on the request?**

- When: Every chat message that reaches the bot.
- Batched question, score; stakes low; ledger kind `request`; batch **request**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_item`

**Which of the word-overlap catalog candidates is the requested item?**

- When: Asked speculatively with every message whose words overlap catalog items; read for obtain and craft.
- Batched question, choice; stakes medium; ledger kind `request`; batch **request**
- Bar: 0.6: unsure of the pick among the word-overlap candidates, the full catalog walk decides instead
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_quantity`

**How many of the item are asked for, from the numbers in the message?**

- When: Asked speculatively with every message; read for obtain and craft.
- Batched question, choice; stakes medium; ledger kind `request`; batch **request**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_outputs`

**One kind of item, or several (a set)?**

- When: Asked speculatively with every message; read for obtain and craft.
- Batched question, choice; stakes medium; ledger kind `request`; batch **request**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_delivery`

**Who should receive the item: the speaker, the bot, or unstated?**

- When: Asked speculatively with every message; read for obtain and craft.
- Batched question, choice; stakes low; ledger kind `request`; batch **request**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_target`

**Which player should the bot come to or follow?**

- When: Asked speculatively with every message; read for come and follow.
- Batched question, choice; stakes low; ledger kind `request`; batch **request**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_material`

**What should a small house be built of?**

- When: Asked speculatively with every message; read for house.
- Batched question, choice; stakes medium; ledger kind `request`; batch **request**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `intake_wood_choice`

**Does the speaker explicitly choose a wood species in this message?**

- When: Every chat message; learned as a preference for obtain, craft, house and build.
- Batched question, choice; stakes low; ledger kind `request`; batch **request**
- Bar: 0.7: a wood species is learned as a preference only when the message clearly chose it
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret)

### `noted_wood`

**Which wood species do the player's saved notes prefer?**

- When: With every message when the player has notes (in the request batch), and on its own when a catalog walk needs the preference.
- Batched question, choice; stakes low; ledger kind `preferences`; batch **request**
- Bar: 0.7: an old wood preference is replaced by a note only when the note clearly states one
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret), src/preferences.js (resolvedPreferenceContext)

### `discovery_category`

**For a find request: is the thing a biome, a creature or a block?**

- When: Asked speculatively with every message (in the request batch); read for find.
- Batched question, choice; stakes low; ledger kind `discovery`; batch **request**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/objectives.js (interpret), src/discovery.js (resolveDiscovery)

## item

### `catalog_branch`

**Which branch of the item catalog holds the requested item? (one level at a time)**

- When: An obtain, craft or house request whose item the word-overlap pick did not settle; also command item arguments.
- Batched question, choice; stakes medium; ledger kind `catalog`
- Bar: 0.5: unsure at a leaf, the bot asks "did you mean A or B?" when a runner-up holds 0.25, and always below 0.35
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/catalog.js (resolveItem over catalogTree)

### `bundle_candidate`

**Does this catalog branch hold one of the requested outputs?**

- When: A request for several kinds of item: once per branch, a page at a time.
- Batched question, noul; stakes medium; ledger kind `bundle`; batch **bundle catalog page (up to 28)**
- Bar: 0.65: a catalog branch is followed only when Jev is sure it holds a requested output
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/item-bundle.js (resolveItemBundle)

### `bundle_covered`

**Do the selected outputs cover everything asked for, and nothing more?**

- When: Once the bundle walk has selected its outputs.
- Batched question, noul; stakes medium; ledger kind `bundle`; batch **bundle outputs**
- Bar: 0.65: unsure the list is whole, the bot asks the player to name the items rather than drop one
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/item-bundle.js (resolveItemBundle)

### `bundle_quantity`

**How many of this output are asked for?**

- When: Once per selected output of a bundle.
- Batched question, choice; stakes medium; ledger kind `bundle`; batch **bundle outputs**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/item-bundle.js (resolveItemBundle)

### `bundle_recipient`

**Who should receive this output?**

- When: Once per selected output of a bundle.
- Batched question, choice; stakes low; ledger kind `bundle`; batch **bundle outputs**
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/item-bundle.js (resolveItemBundle)

## memory

### `memory_operation`

**What memory action does the speaker want: remember a place or note, recall, forget, visit, or repeat?**

- When: A message routed as memory.
- Batched question, choice; stakes medium; ledger kind `memory`
- Bar: 0.75: forgetting cannot be undone: an unsure "forget" is a question back ("say exactly what")
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/memory-routing.js (resolveMemory)

### `memory_entry`

**Which saved entry (or found place) does the recall, forget, visit or repeat mean?**

- When: A memory recall, forget, visit or repeat.
- Batched question, choice; stakes high; ledger kind `memory`
- Bar: 0.75: forget below 0.75 asks which memory; repeating a costly past request below 0.65 asks the player to ask directly
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/memory-routing.js (select over offered entries)

### `memory_place_name`

**Which span of the message is the place's name?**

- When: A request to remember a place.
- Batched question, choice; stakes low; ledger kind `memory`
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/memory-routing.js (select over offered entries)

### `memory_place_location`

**Which observed position is the place being named?**

- When: A request to remember a place.
- Batched question, choice; stakes medium; ledger kind `memory`
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/memory-routing.js (select over offered entries)

### `memory_place_dimension`

**Which dimension do written coordinates refer to?**

- When: Remembering a place by written coordinates.
- Batched question, choice; stakes low; ledger kind `memory`
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/memory-routing.js (select over offered entries)

### `memory_note_replaces`

**Which existing note does a new note update, if any?**

- When: A request to remember a note, when notes exist.
- Batched question, choice; stakes medium; ledger kind `memory`
- Bar: none
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"; stop and status still work
- Options built in: src/memory-routing.js (select over offered entries)

## dream

### `dream_operation`

**What does the speaker want done with Jev's dream: set one, ask, pause, resume, or clear?**

- When: A message routed as dream.
- Batched question, choice; stakes high; ledger kind `dream`
- Bar: 0.75: clearing the dream below 0.75 and setting one below 0.65 are confirmed in words first; the rest are reversible
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"
- Options built in: src/dream.js (resolveDream)

### `village_progress`

**How complete is the village, judged from what stands?**

- When: Each step of the build-a-village dream.
- Batched question, score; stakes low; ledger kind `dream`; batch **village**
- Bar: none
- Jev unreachable: the village dream step fails and is set aside for two minutes
- Options built in: src/dream.js (chooseVillagePart)

### `village_part`

**Which part should the village get next, or is it done?**

- When: Each step of the build-a-village dream, while parts are on offer.
- Batched question, choice; stakes medium; ledger kind `dream`; batch **village**
- Bar: none
- Jev unreachable: the village dream step fails and is set aside for two minutes
- Options built in: src/dream.js (chooseVillagePart over villageCandidates)

## command

### `command_node`

**Which branch of the server's command tree implements the request next, or is the command finished?**

- When: Each level of an operator command request.
- Batched question, choice; stakes high; ledger kind `command`
- Bar: 0.5: unsure of a step, the bot asks for the command again with more detail rather than guess
- Jev unreachable: the command is not run, and the player is told it could not be used
- Options built in: src/command-classifier.js (classifyCommand over the server command tree)

### `command_argument`

**Which value fills this argument (player, coordinates, number, quoted text)?**

- When: Each argument of an operator command whose values the code can list.
- Batched question, choice; stakes high; ledger kind `command`
- Bar: 0.5: unsure of a step, the bot asks for the command again with more detail rather than guess
- Jev unreachable: the command is not run, and the player is told it could not be used
- Options built in: src/command-classifier.js (classifyCommand over the server command tree)

### `command_subject`

**Who is the command's subject: moved, changed or given to?**

- When: A teleport, gamemode, give, clear, effect, enchant, kill or spawnpoint command.
- Batched question, choice; stakes high; ledger kind `command`; batch **command roles**
- Bar: 0.5: unsure of a step, the bot asks for the command again with more detail rather than guess
- Jev unreachable: the command is not run, and the player is told it could not be used
- Options built in: src/command-classifier.js (classifyCommand over the server command tree)

### `command_destination`

**Where is the teleport going: a player or coordinates?**

- When: A teleport command.
- Batched question, choice; stakes high; ledger kind `command`; batch **command roles**
- Bar: 0.5: unsure of a step, the bot asks for the command again with more detail rather than guess
- Jev unreachable: the command is not run, and the player is told it could not be used
- Options built in: src/command-classifier.js (classifyCommand over the server command tree)

### `command_faithful`

**Does the finished command do what was asked, with the right targets and scope?**

- When: Every finished command, before it is run.
- Batched question, noul; stakes high; ledger kind `command`
- Bar: 0.75: a built command is run only when Jev is sure it is the one asked for
- Jev unreachable: the command is not run, and the player is told it could not be used
- Options built in: src/command-classifier.js (classifyCommand over the server command tree)

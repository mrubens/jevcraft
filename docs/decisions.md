# Every question Jev is asked

Generated from `src/decisions` by `node scripts/decisions-doc.js`. Do not edit by hand: change the definition and regenerate.

Each question is defined once: what it asks and when, what a wrong answer costs (stakes), the bar its answer must clear and what happens below it, what happens when Jev cannot be reached, and where its options are built. The decision trees also declare every option they can offer, and the runner checks each tree against that catalogue: an undeclared option fails the tests and is logged as a bug in play. Every tree is asked through one runner (`decide`) and every batched question through `ask`; nothing else in `src` calls the model.

97 questions: 47 decision trees and 50 batched questions.

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
- Nothing left to try: the stall's question, as before (nothing above it)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `continue_request` | root | carry on with the request | always; by day it is held five minutes, until hunger falls two or health four, or dusk; at night it is staying up, two minutes at a time, with the kit, the bed and the nights without sleep said in the option; the work it goes on with is named (the ladder's step), and underground, by day or night, that the dark there is the same at any hour, mobs spawning by light and not by the hour (note 531) |
| `go_home_for_night` | root | walk home to the bed and wait there for bedtime | from dusk, with a bed at home more than six blocks off and a way there; underground only after two nights awake (climbing out of the mine first) |
| `sleep_in_bed` | root | sleep in a bed | bedtime, a bed is carried (with room to place it) or one is in reach, and no mob within ten blocks |
| `sleep_in_nook` | root | dig a bed nook beside the bot and sleep in the carried bed | bedtime, a bed carried, no two level cells beside the feet (a staircase, a shaft), two cells in a line that can be dug with their floor kept, no liquid beside and nothing that falls over them, and no mob within ten blocks; the monsters within eight blocks sideways and five up or down of the bed (vanilla refuses the sleep) are counted in the option |
| `secure_shelter` | root | seal a shelter for the night | from dusk; beside a bed the option says the bed is the quicker night; said with the real minutes to dawn as minutes of the run with the work named waiting, whether a night mine could dig from there (and why not), and underground that the dark there is the same at any hour (note 531) |
| `obtain_food` | root | get food | food carried is under the reserve and hunger or a stock top-up calls for it (at night with the spawning and the hunger said) |
| `hunt_[a-z_]+` (pattern) | root | go out and hunt this kind of mob for its drops | at night in the Overworld where staying up is on offer, one for each kind of mob within thirty-two blocks whose drops are known, with the drops, their uses, a one-mob fight estimate and what a death would drop; two minutes, six health lost hands back |
| `stash_valuables` | root | put the valuables in the stash chest first | at night where staying up is on offer, a stash chest within 128 blocks and valuables carried |
| `cache_valuables` | root | put a chest down here for the valuables | at night where staying up is on offer, home's chest out of reach, valuables carried, and a chest or the wood for one |
| `wait_for_day_sealed` | root | seal a pocket and wait in it for daylight while health does not come back | in the Overworld, health under twenty and hunger under eighteen, no shelter already on offer and one possible here; by day or night, on the surface or below, priced in real minutes to dawn and about no hunger standing still; held until dawn or until hunger reaches eighteen |
| `rest_to_heal` | root | stay still where it is while health comes back | health under twenty and hunger eighteen or more, with the seconds to twenty and the mobs about said; held half a minute |
| `cook_[a-z_]+` (pattern) | obtain_food | cook a carried ingredient | raw food and fuel are carried; the output is safe food |
| `prepare_hunting_sword` | obtain_food | make a wooden sword to hunt with | animals are in view and no weapon is carried |
| `hunt_\d+` (pattern) | obtain_food | hunt this animal | an adult food animal in view is reachable on safe surface ground; the nearest hostile to it is said |
| `go_home_for_food` | obtain_food | walk home and eat from its stores | the base has bread, ripe wheat or a cow to spare within reach |
| `village_food` | obtain_food | take ripe crops and hay from a remembered village | a village with crops or hay is remembered within reach |
| `seen_food_\d+` (pattern) | obtain_food | walk back to animals seen earlier | a herd of cows, sheep or rabbits seen in the last half hour, now out of view, 32 to 192 blocks off (the nearest three) |
| `search_food` | obtain_food | walk to another dry area to look for animals | always |
| `return_for_food` | obtain_food | go back through the portal for food | off the Overworld; said with the trip (its walk, the pace of the Nether walks measured, from sixty blocks, lava on the line, the hour it comes out at), the food known on the Overworld side and, while the choice to go on without it holds (keep_on, twenty minutes), when and at what health that was chosen (note 607) |
| `hoglin_food` | obtain_food | hunt a hoglin for porkchops | in the Nether, a hoglin in view or seen within 192 blocks; its drops, a one-hoglin fight estimate, the day's hunts of a hoglin for its meat (66 begun, none brought meat) and the mobs about are said |

### `shelter_method`

**A shelter for the night: the saved one, a room at a site, a pocket here, a shaft pocket, a mine, or the carried bed in a nook dug for it?**

- When: When a shelter is chosen for the night (secure_shelter) and none is under way; held for the night, and asked again when the chosen way fails (it rests three minutes).
- Decision tree, choice; stakes medium; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (refugeStep)
- Nothing left to try: asks `survival_priority` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `bed_beside` | root | seal a pocket now and at bedtime put the carried bed down beside it and sleep | before bedtime in the Overworld with a bed carried, no nook to be had, a pocket sealable here and level ground for the bed within four blocks; said with the seconds to bedtime and the monsters within the vanilla sleep range |
| `saved_shelter` | root | go back to the saved shelter and seal it | a shelter is remembered with a route to it and dry below |
| `build_at_site` | root | build a small room at a dry site | a dry site within reach has a route to it |
| `seal_here` | root | seal a pocket where the bot stands | always (with too few blocks it digs in instead) |
| `shaft_pocket` | root | dig straight down and cap it | always; fails where the ground cannot be dug |
| `night_mine` | root | dig a mine from here for the night | a pickaxe (or one can be made) and nothing watching, and the mine would dig: not with the best pickaxe under the uses kept for a dug climb out and no spare to make (nightMineOff, said in the state; note 531); said with the ore about, the pickaxe's uses, the real minutes to dawn and the work they hold up; health is Jev's to weigh |
| `bed_nook` | root | the carried bed in a nook dug beside the bot | a bed carried in the Overworld and a nook can be dug here: at bedtime it is dug and slept in now; before it, a pocket is sealed here and the nook, closed in rock, is dug out of its wall at bedtime and slept in (held, not asked again) |

### `pocket_next`

**Sealed in a pocket: stay, leave, go out for food, go to the bed, sleep in the carried bed in a nook dug out of the wall, open the wall on a watcher, dig a passage out away from a spawner, a creeper, the mob at the wall or the blazes about, mine the night away, hunt mobs for their drops, or take the valuables to the chest?**

- When: Each survival step inside a sealed pocket, unless a mob is inside or at arm's length (that is fought as a reflex); the choice holds ninety seconds for the same watcher and the same night.
- Decision tree, choice; stakes medium; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (stepOnce: the pocket)
- Nothing left to try: asks `survival_priority` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `sleep_beside` | root | open the pocket, put the carried bed down beside it and sleep | at bedtime in the Overworld with a bed carried and no nook to be had, level ground for the bed beside the pocket; said with the monsters within the vanilla sleep range now |
| `go_to_bed` | root | open the pocket and go to the bed | bedtime, with the base bed near (on the surface or within ten blocks of its level) or a bed carried on the surface |
| `sleep_in_nook` | root | dig a bed nook out of the pocket's wall and sleep in the carried bed | bedtime, a bed carried, and a nook beside the bot closed in rock all round, so the pocket stays shut (its wall goes back after); taken without asking when the shelter method chosen tonight was the bed nook; the monsters within eight blocks sideways and five up or down of the bed are counted in the option |
| `open_on_watcher` | root | open the wall toward the watching mob and fight it | a mob within four and a half blocks and a sword or axe carried |
| `night_mine` | root | mine from the pocket through the night | night, nothing watching, and a pickaxe carried or makeable (no health floor: Jev weighs the risk), and the mine would dig: not with the best pickaxe under the uses kept for a dug climb out and no spare to make, said then on stay and in the state (nightMineOff, note 531); said with the real minutes to dawn and the work they hold up (the ladder's step, and for the portal its frame, way and lava); it stays in the pocket when no mine can be dug from here, and a choice that did nothing rests a minute (notNow) |
| `work_here` | root | stay and make the ladder's next item in the pocket | on the game ladder, nothing watching, and the next item can be made from what is carried by smelting and crafting alone |
| `hunt_[a-z_]+` (pattern) | root | open the pocket and hunt this kind of mob for its drops | night, nothing watching, one for each kind of mob within thirty-two blocks whose drops are known, with the drops, their uses, a one-mob fight estimate and what a death would drop; two minutes, six health lost hands back |
| `stash_valuables` | root | open the pocket and put the valuables in the stash chest | night, nothing watching, a stash chest within 128 blocks and valuables carried |
| `cache_valuables` | root | open the pocket and put a chest down outside for the valuables | night, nothing watching, home's chest out of reach, valuables carried, and a chest or the wood for one |
| `tunnel_from_warden` | root | dig a passage out through the far wall, away from the warden, to beyond its boom, and go back to work from its end | a warden within thirty-two blocks, the bot not in water, digging and walking at hand, and the rock away from it safe to dig for at least four cells to a point seventeen or more blocks across from it (its boom reaches fifteen), twenty-four cells at most; said with the direction, the cells, how far down, about how long, the clearance, that digging is a vibration it follows, what a warden does, and the booms taken in the last minute |
| `tunnel_out` | root | dig a passage out through a wall, level or a stair down, away from what keeps the pocket (a spawner in reach, a creeper, or the mob at the wall), and go back to work (or on with the trip back for food Jev chose) from its end | the bot not in water, digging and walking at hand, and the rock safe to dig for at least four cells, surveyed straight away first and then across, level first and then a stair down a block a step (note 597): away from a mob spawner within sixteen blocks to a point seventeen or more from it, measured in three dimensions (and ten from a creeper about), twenty-four cells at most; else away from a creeper within sixteen blocks (the rule that keeps a door within six of one shut would refuse the doors) to ten or more from it; else away from the mob watching the pocket (not a warden) to ten or more from it; else away from the blazes within their forty-eight blocks, to eight blocks further from them than the pocket (note 548); said with the direction, the cells, about how long, the clearance at its end, how long the same mob has kept the pocket, and that it stops, the bot still enclosed, if that kind of mob comes round toward its head within six blocks |
| `dig_in_and_fight` | root | open the pocket's wall toward the blazes, one wide and two high, and fight them from inside | a blaze within twenty-four blocks, a sword or axe carried, digging at hand, and the wall toward them safe to dig with the pocket's rock on the other three sides and over it; said with the blocks, the tool, the seconds, how many of the blazes within their forty-eight blocks have a line in through the opening now and at the bot's own height (where a blaze after a target hovers), what a blaze does, its fireball's chance to land by distance and its push, and the damage over the digging and fifteen seconds held after (note 548); carried out once, not again when the pocket is sealed after it |
| `stay` | root | stay in the pocket | always; said with what the place is (mobSourceAbout: a spawner in reach, a dungeon or mineshaft remembered within twenty-four, the mobs met and hits taken within sixteen in the last fifteen minutes), and at night with the minutes to dawn, the work they hold up, and why no night mine is on offer when it is not; by day with the daylight left and, hurt under eighteen hunger, that staying brings no health back; and with how the wait has gone (pocketSoFar, note 584): the minutes in this pocket, the stance that sealed it and the mobs it was chosen against as they were then and where they are now, each mob outside about a minute or more with how its distance has gone (come nearer, or never nearer) and whether it has had the bot in sight, that no daylight comes outside the Overworld so a stay there ends only when the bot opens the pocket, that at full health by day staying heals nothing, and the rung's minutes without a new best past five; the minutes run from the seal, across a restart, until the bot is out of the pocket or seals it again, and a mob come nearer is said with how near and how far it has been over the wait and whether it has had the bot in sight; hurt under eighteen hunger with nothing carried to eat, that health does not come back in the pocket however long it waits, and where no daylight comes either, that neither comes to the wait (note 589) |
| `leave` | root | open the pocket and go back to work | always; said with what the place is, as stay, the work named, and underground at night that the dark there is the same at any hour; a shaft pocket with no side to open is left up through its cap, and a leave that finds no door rests a minute with why (note 538); said with what the pocket was sealed against and where it is now, and how the mobs outside have moved while it waited; with every one of them held off out of sight a minute or more, the fight with them all is said as what it costs should they all come at the bot at once (note 584), and so it is with every one of them about a minute or more without the bot in sight in the wait, come nearer or not, none of them the mob it was sealed against: a mob takes the bot as its target only on sight (note 589); off the Overworld with Jev's trip back for food still held (leave_nether go_back), the work it goes on with is that trip, said with the portal's distance and the way back, and the rung waiting till the bot is fed and back (note 589) |
| `go_for_food` | root | open the pocket and go for food, the way chosen next | day or night, hunger under eighteen and the safe food carried not enough to bring it there; in the Overworld said with the food known (in view, herds and rabbits seen, a village, home), health and whether it comes back, the daylight left, and what is outside (note 538); off the Overworld its ways are back through the portal, said with the trip, unless the leave already goes on with that trip, and the Nether's hoglins when known (note 589) |
| `cook_[a-z_]+` (pattern) | go_for_food | cook a carried ingredient | raw food and fuel are carried; the output is safe food |
| `prepare_hunting_sword` | go_for_food | make a wooden sword to hunt with | animals are in view and no weapon is carried |
| `hunt_\d+` (pattern) | go_for_food | hunt this animal | an adult food animal in view is reachable on safe surface ground; the nearest hostile to it is said |
| `go_home_for_food` | go_for_food | walk home and eat from its stores | the base has bread, ripe wheat or a cow to spare within reach |
| `village_food` | go_for_food | take ripe crops and hay from a remembered village | a village with crops or hay is remembered within reach |
| `seen_food_\d+` (pattern) | go_for_food | walk back to animals seen earlier | a herd of cows, sheep or rabbits seen in the last half hour, now out of view, 32 to 192 blocks off (the nearest three) |
| `search_food` | go_for_food | walk to another dry area to look for animals | always |
| `return_for_food` | go_for_food | go back through the portal for food | off the Overworld; said with the trip (its walk, the pace of the Nether walks measured, from sixty blocks, lava on the line, the hour it comes out at), the food known on the Overworld side and, while the choice to go on without it holds (keep_on, twenty minutes), when and at what health that was chosen (note 607) |
| `hoglin_food` | go_for_food | hunt a hoglin for porkchops | in the Nether, a hoglin in view or seen within 192 blocks; its drops, a one-hoglin fight estimate, the day's hunts of a hoglin for its meat (66 begun, none brought meat) and the mobs about are said |

### `night_mine_target`

**Mining through the night: which ore next, or a branch deeper?**

- When: Each time the night mine needs a new target and an ore is in sight within twenty-four blocks, below the feet, dry, and not lately failed, or the tunnel is dark with torches carried, or a spawner or a remembered dungeon or mineshaft is near.
- Decision tree, choice; stakes low; ledger kind `mining`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (nightMine, nightTarget)
- Nothing left to try: asks `survival_priority` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `ore_\d+` (pattern) | root | dig to this ore | the nearest of its kind, with its distance, what is carried and what it is for |
| `branch` | root | dig a branch down and along | always |
| `branch_away` | root | dig the branch away from the spawner or structure that makes the mobs here | a mob spawner within sixteen blocks, or a dungeon or mineshaft remembered within twenty-four; said with where its end lies from it. Every option here is said with what the place is (mobSourceAbout) |
| `light_tunnel` | root | put a torch in the tunnel here | torches carried and the cells around are dark enough for monsters |

### `evening_chore`

**Home before bedtime: which chore now (the stash, the wheat, the farm, the cows, the plot), or wait for the bed?**

- When: At home within six blocks of the bed, from the walk-home hour until bedtime, with a chore on offer; waiting, once chosen, holds until a new chore appears.
- Decision tree, choice; stakes low; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (step), src/home-base.js (homeChores), src/home-stash.js (stashChores)
- Nothing left to try: asks `survival_priority` next up, with this one's failure said

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
- Nothing left to try: asks `stillness_detour` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `(step\|climb\|place\|bridge\|take_floor)_(north\|east\|south\|west)` (pattern) | root | walk, climb, place a block, bridge a gap in the floor that way, or take up a block of the floor the bot laid itself there | the cells that way allow it; a bridge is laid with a block that holds (rock, wart block, nether wood, wool), or else a fence or the crafting table, and says how many cells of gap lie between this floor and the nearest ground the bot is not on by way of it, against the blocks carried, and, for a fence, what walking it is; a block taken up is offered only where the block dug has a floor to land on, not over lava or a fall (it drops out of its cell and burns), and the line for it says so in here.notOffered |
| `dig_(north\|east\|south\|west)_(feet\|head\|over)` (pattern) | root | dig the block that way | a natural block there, and a tool for it if it needs one |
| `dig_up\|dig_down\|swim_up\|pillar\|rise_through` (pattern) | root | dig over the head or underfoot, swim up, pillar, or rise straight up through the rock over the head | what is over the head or underfoot allows it; the rise says the air, the rock and the open space above it, the blocks it lays and where they come from (the pack, then the rock dug on the way), and how long it takes |
| `walk_off` | root | walk off the spot over the ground as it stands, to the nearest dry ground eight blocks from where it got stuck with no lava round it | the aim is off a spot every walk failed from and such ground lies more than a step away within sixteen blocks; said with its cells, the height it goes up or down, and how many of its cells have lava beside them (walked crouched, with what a touch of lava costs this body), since the walks the bot makes on its own take no cell beside lava in the Nether (note 655) |
| `ask_server` | root | ask the server what the blocks round the body are, and take its answer for the view | the server put the body back where it was several times within five minutes near here (a body it will not let move where the view says it can); said with how many times, and what an earlier asking found |

### `way_down`

**On a top with no way down at a walk: dig down through the column, ride a poured waterfall down, or step off a side?**

- When: A walk to somewhere off the top (not on it, nor a place just above it) from a top whose every side falls more than three blocks, with no mob at hand; asked again from wherever the way chosen leaves the bot while it is still on a top, up to four times a walk.
- Decision tree, choice; stakes medium; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/way-down.js (perchOf, waysDown, comeDownFirst); asked from src/skills.js navigate
- Nothing left to try: the stall's question, as before (nothing above it)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `dig_down` | root | dig down through the column underfoot, a block at a time, never into a fall that hurts | a column of the top has a block underfoot that can be dug with no fall over three under it; each way says a creeper within ten blocks of where it ends, how far, and whether it sees the bot there |
| `ride_water` | root | pour the water bucket at the feet and step off into the waterfall | a water bucket carried, not in the Nether, and an open side whose fall runs clear to the ground or water |
| `step_off` | root | step off a side and take the fall | a side whose fall leaves more than a point of health |

### `climb_out`

**Climbing out of the mine by digging: a staircase toward open ground, straight up the column overhead, or a span across open cave toward the way up?**

- When: A climb to the surface with no dug way out found, when it starts digging; asked again when the pickaxes carried change, a way not offered before is open, the column would not rise, or a span has been laid.
- Decision tree, choice; stakes medium; ledger kind `mining`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/surface.js (returnToSurface, chooseClimb, climbOptions)
- Nothing left to try: asks `surface_trip` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `staircase` | root | dig a staircase up toward open ground | always |
| `straight_up` | root | dig straight up, a block put under the feet at each step | the column to open sky has only natural ground to dig, nothing that falls or flows in or beside it, and a building block carried for every step up |
| `bridge` | root | lay a level span across the open cave toward the way up, then look again from its end | a straight crossing at the feet's height toward the way up has open air to lay blocks over and gains four blocks or more on it |

### `corpse_run`

**Go back for what the last death dropped, or leave it and go on?**

- When: After a death whose drops are worth fetching (what was worn and in the off hand among them) and still there, once the bot is in their dimension, whatever it wears; asked once a death. With no answer, it goes only with the kit worn (in the Nether or below sea level) or by day (note 559).
- Decision tree, choice; stakes medium; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/corpse-run.js (corpseRunStep)
- Nothing left to try: the stall's question, as before (nothing above it)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `go_back` | root | go back for the drops | always |
| `leave_them` | root | leave them and go on | always |

### `body_way`

**The body is in danger of its own (in lava, alight or in fire, on a hot floor, the head in a block, out of breath under water), and may be struck by a mob at arm's length meanwhile: which way, now?**

- When: The moment a step meets the condition (the survival step for lava and burning, the vitals step for fire, a hot floor (a magma block not crouched, a lit campfire) under the body wherever it stands, a head in a block and the breath), with two or more ways out (one is taken without asking); asked again each time the step meets it, unless burning was left to burn out (chosen, or the one way there was), which holds until it could have burned out, health falls four more (or half what it was, when that is less), or a way not on offer when it was left be is on offer (the bucket pours once the body is over a floor); while it holds, every other question says the burning (state.alight).
- Decision tree, choice; stakes high; ledger kind `survival`
- Bar: none: Jev's pick is taken at any confidence and acted on at once: every way offered gets the body out as the code can carry it out, and the next step asks again while the danger stands; the code's old order answers only when Jev cannot be reached or has not answered in a second
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/body.js (answer), src/survival.js (lavaWays), src/vitals.js (fireWays, hotFloorWays, headWays, airWays)
- Nothing left to try: the stall's question, as before (nothing above it)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `to_dry_ground` | root | out of the lava onto the nearest dry cell | in lava with a dry cell (floor under it, air over it) within six blocks that a swim reaches (its floor no higher than the lava's top, or a jump up from shallow lava); said with its distance, how high above the feet, lava or a drop beside it, the seconds, and the health the seconds in the lava and the burning after cost |
| `to_water` | root | into water, which puts the fire out | in lava with water within six blocks that is not a step up; or alight with water within eight blocks (not in the Nether); said with its distance and seconds |
| `pillar_out` | root | press against a block beside the lava holding jump and put a block into the lava under the feet, to stand on at the lava's top | in lava with scaffold blocks carried, room over the top lava cell of the body's column or one beside it and a block beside that cell to put it against; said with the seconds in the lava and their health, and the dry ground a step from the block, if any |
| `back_the_way_came` | root | back toward the last dry footing stood on | in lava with the last dry footing known in this dimension; said with its distance, whether anything is under it now and whether a swim reaches it, the seconds and their health |
| `swim_up` | root | swim straight up in the lava | in lava with no way out found and no dry footing known |
| `out_of_fire` | root | run out of the fire to a cell two blocks from any flame, or into water | standing in fire with such a cell within twelve blocks by a way with no cell beside a fall that kills; said with the steps and seconds and whether the way runs through a flame |
| `crouch_out_of_fire` | root | walk out of the fire crouched along cells beside a fall, to a cell two blocks from any flame | standing in fire where the way out runs beside a fall that kills (a span over the lava sea) and no way clear of the fall is found or it is slower; said with the steps, how many are beside the drop and what it falls into, and the seconds at a crouch |
| `rise_on_block` | root | jump and put a block in the cell underfoot (the fire's, or the one over a magma block), and stand on it a block up | standing in fire on a floor, or on a magma block with the middle of the body over it, a full block carried that holds on it, and the two cells over the feet open and not alight; said with the block, the seconds and the flames or fall beside the cell it rises to |
| `put_out_flames` | root | punch out the flames the body stands in or beside, where it stands | standing in fire with a flame in a cell the body's box touches or beside it at the feet or head; said with how many, the quarter second a flame, and the burning on after |
| `step_off_hot_floor` | root | step off the hot floor crouched to the nearest floor that does not hurt | on a magma block not crouched, or a lit campfire, with such a floor within eight blocks by a way walked crouched (over other magma, no step down); said with the steps, the floor it ends on, a drop beside the way and the seconds |
| `crouch_on_hot_floor` | root | crouch where it stands: a magma block does not hurt a crouched body | on a magma block not crouched; the crouch is let go once the body is off the magma, and a walk that stands it up on the magma again is asked about again |
| `douse_bucket` | root | pour the carried water bucket at the feet and take the water back | alight out of the fire, a water bucket carried, not in the Nether, an open cell on a block under the body's box (the middle first, then the box's edge; in the air, down to two below the feet); said with the burning it spares |
| `extinguish_in_cauldron` | root | step into a cauldron of water near by, which puts the fire out (in the Nether too) | alight out of the fire, a water cauldron placed within six blocks with a cell beside it to go in from (a floor, room for a jump); said with the walk, the hop onto its rim and the drop in, the seconds, the fire and health it saves, the level it costs of three, a drop or lava beside the cell it goes in from, and whether that cell is in a shooter's line (note 634) |
| `set_down_cauldron` | root | put the carried cauldron down beside the bot, fill it from the water bucket and step in | alight out of the fire, a cauldron and a water bucket carried, a side of the bot's own cell open with a floor under and room to jump; said with the seconds (measured), that the bucket is left empty, the fire and health it saves, a drop beside and the shooters' line (note 634) |
| `burn_out` | root | leave the burning to end by itself and go on | alight out of the fire; said with the fire left, the health it takes and whether the bot dies of it and when; held until the burning could have ended, health falls four more (or half, when less), or another way comes |
| `strike_at_arm` | root | turn to the mob at arm's length and strike it, burning meanwhile | alight out of the fire with a mob at arm's length (a biter at its reach, a blaze within three blocks); said with where it is from the way the bot faces, its health, the swings and seconds, the blows it lands while struck, and the fire left. Every question of the body says the blows at arm's length (atArmsLength) and what they come to in each way's seconds, and a way a blow stopped (lastWay) (note 657) |
| `eat_golden_apple` | root | eat the enchanted golden apple: fire resistance for five minutes | in lava, alight or on a hot floor with an enchanted golden apple carried; said with the 1.6 seconds of eating first |
| `drink_fire_resistance` | root | drink a fire resistance potion, or throw a splash one at the feet | in lava, alight or on a hot floor with a fire resistance potion carried (a splash first: it acts in about half a second, a drink in 1.6); said with the seconds first and the effect's length (src/fire-resistance.js bodyWay, note 656) |
| `step_aside` | root | step out from under the block into the open cell beside the feet | the head in a block and an open cell beside with a floor and nothing that falls over it |
| `dig_out` | root | dig the block the head is in, and what falls after it | the head in a block; said with the block and the seconds with the best tool carried |
| `swim_to_air` | root | swim the shortest way to air, digging what is in the way | under water with a way to air found within the breath and the drowning after it; said with its seconds and digs |
| `straight_up` | root | swim and dig straight up to air | under water with the column overhead diggable to air within the breath and the drowning after it; said with its seconds |

### `turn_priority`

**Which layer has the bot's turn now: survival, the meal and breath, the hunt, or the work?**

- When: When two or more layers claim the turn and none of them is the body's own danger (lava, fire, a hot floor, a head in a block, the breath: that layer's step asks body_way at once) (the default; with JEV_ARBITER=shadow the rules answer and nobody is asked); the ruling is held until a reflex, a newcomer within six blocks, health down six, food across a band, its winner doing nothing for ten seconds, or a minute.
- Decision tree, choice; stakes high; ledger kind `survival`
- Bar: none: Jev's pick is taken at any confidence: it holds a minute at most, and any change a reflex, a newcomer, six health or a food band makes asks again; the urgency then safety order answers only when Jev cannot be reached
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/arbiter.js (arbitrate), the claims in src/survival.js, src/vitals.js, src/mob-hunt.js and src/work.js
- Nothing left to try: the stall's question, as before (nothing above it)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `survival` | root | the survival layer: a shelter, a stance, a bed, food to find | the survival layer has something to do, including a plan that failed or rests (said as a fact) |
| `vitals` | root | eat carried food, get out of powder snow, or surface for air | hunger or breath call for it and the means are carried |
| `hunt` | root | fight a mob the request needs a drop from | a mob hunt is on and one of its kind is in view |
| `work` | root | the request's next step | always while a request is running |

### `restock_food`

**In the Nether with little food carried, or hurt at a hunger where health does not come back: which way to more food, or go on without?**

- When: Chosen as the step (restock_food) at the food question of a hunt short of fitness (leave_nether), at a stalled Nether step, or at the stay's food kit (nether_food_kit); not asked where no way is real from here. A bastion raid for the chests' food is among the ways when a bastion is remembered within reach.
- Decision tree, choice; stakes medium; ledger kind `survival`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/nether-food.js (foodRoutes, askRestockFood), src/nether-travel.js (hoglinSays), src/game-progress.js (portalTrip), src/work.js (cookable)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `hoglin_walk` | root | hunt a hoglin on foot for its porkchops | a hoglin in view within thirty-two blocks or seen within 192 in the last half hour; said as the hoglin question says it (2 to 4 raw porkchops at 3 hunger each raw and 8 cooked, the fight priced from the game's numbers at this health, the walk at the measured pace, how the day's hunts went) and how this trial's went |
| `hoglin_pillar` | root | hunt the hoglin from a pillar two blocks up | the same hoglin and two blocks carried that can be laid; the walk to within twelve blocks, two blocks laid, the sword struck down from the top (a hoglin's blow does not reach two up; 168 pillar stances measured 0.1 health lost, 2 deaths), and what a pillar does not stop; the hunt ends if the hoglin does not come in forty-five seconds |
| `mushroom_stew` | root | make mushroom stew from mushrooms in view | a red and a brown mushroom within forty-eight blocks or carried, and a bowl or three planks' worth of wood carried; said with the count, the nearest, 6 hunger a stew, what the stew is made of, and that the game grows them only in the nether wastes and basalt deltas and gathering them is not measured |
| `cook_meat` | root | cook the raw meat carried | raw meat carried, and a furnace (or eight stone) and fuel that burns (coal, charcoal, a blaze rod) carried; said with the points now and cooked, the seconds standing at it, and that the meat is in the furnace, not eaten, meanwhile |
| `raid_bastion` | root | raid a bastion's chests for their food | a bastion remembered within 384 blocks whose walk is not resting, and no raid already on (note 649); said with the same facts as bastion_raid: the walk, what lives there and is in view, gold armor and what it does not do, what a lid does, the fights priced from the game's numbers, what the chests hold in food (a hoglin stable about 17 points, the others about 12, the bridge none), and that no bastion chest has been opened by the bot; chosen, it is the raid Jev chose (the chests are opened while it is on) |
| `return_for_food` | root | go back through the portal to the Overworld for food | the way back is at hand; said with the trip (its walk at the pace the Nether walks measured, lava on the line, the hour it comes out at) and the food known on the other side |
| `keep_on` | root | go on in the Nether without more food for twenty minutes | hunger under eighteen, or a bastion raid is among the ways |

## combat

### `ranged_response`

**A mob that shoots is in clear view at bow range: shoot it, run for cover, or dig in?**

- When: A shooting mob is in clear view at bow range, a bow and arrows are carried, health is eight or more and no melee mob is within three blocks.
- Decision tree, choice; stakes high; ledger kind `survival`
- Bar: none: Jev's pick is taken at any confidence; the health rule answers only when Jev cannot be reached
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (rangedChoice)
- Nothing left to try: asks `survival_priority` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `shoot_\d+` (pattern) | root | shoot this mob | it is in clear view with a solved arrow path (up to three targets) |
| `retreat` | root | run for cover out of its sight | always |
| `dig_in` | root | seal a two-block pocket here | twelve or more building blocks are carried |

### `encounter_stance`

**Hostile mobs are near the bot: fight here, go up, step out of the shooters' line, block a creeper's line, dig into the wall, dig down, seal in, run, eat, drink fire resistance, shoot, strike a ghast's fireball back, charge the shooters, dance with the creeper, or leave them be and keep working?**

- When: An encounter (a threat the survival step answers, a mob at arm's length among them, in a sealed pocket too, and a hurt beside a deep drop while the hunt waits to heal), asked before anything is done about it while no stance holds: the swing at arm's length is part of the stance chosen, the step off a ledge is fight_from_footing, the hold on a span is hold_on_span, and the shield at shots is shield_policy (the code does these first only when Jev cannot be reached); with two or more stances possible (one is taken without asking); held for fifteen seconds (or its estimate's seconds), until health falls by six, until the stance fails, or until a mob it was not chosen against comes within six blocks (not when a kind of mob comes into view further off or goes out of it); at the end of its time a stance with nothing new is held on without asking, 15, 30, then 60 seconds at a time up to five minutes (src/holds.js), and asked again sooner when what it was chosen on is falsified: more damage than priced at its own rate, a mob it was chosen against nearer by four, into or out of sight, gone or hurting the bot, a shot at the bot, the bot off the spot it held, or a way not on offer when it was chosen (at the cap the rung's question is due too); asked sure twice running with none good to the same situation (the failures just now aside), it is not asked again there for five minutes and the best listed is taken; a stance that hid the bot from the shooters (out_of_sight, nook) is asked again once a shooter has a line to where it hid, or the bot is off that spot; out_of_sight, nook and take_cover are asked again once a shooter they were chosen against lands a hit. A stance that failed stays on offer, its option saying how long ago and how it failed here; one that ended without acting (no swing, no step of a block, no block placed or dug, nothing carried changed), or a fight or strike held to its end so, is left out while nothing about it changes (the bot within a block of where it was, each mob within a block of where it stood and none come, health within a point) and two or more other ways stay on offer, said in notOfferedNow with why; with fewer left it stays on offer with that said. While a stance holds, the shield at each arrow gives way to a stance that moves or builds, the hurt watchdog to any stance but keep_working, and eating to the eat stance. Off with JEV_ENCOUNTERS=0.
- Decision tree, choice; stakes high; ledger kind `combat`
- Bar: none: Jev's pick is taken at any confidence: a stance is held fifteen seconds and asked again when health falls by six, when it fails or when a new mob comes close, so a close call is soon corrected; the encounter rules answer only when Jev cannot be reached
- Jev unreachable: stops: no safe default
- Options built in: src/survival.js (stanceOptions)
- Nothing left to try: asks `survival_priority` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `take_cover` | root | put a block in the line from the eyes of each shooter in sight to the bot's, two high where it is beside the bot, and stay behind it | shooters in sight (up to three) and a cell in the line of at least one that takes a block within reach (or a block there already), the blocks carried, not in water; said with where each block goes, the shooters it cannot cover and why, the seconds and the damage in the next fifteen seconds this way |
| `block_creeper` | root | put a block in the line from a creeper's eyes to the bot's, two high beside the bot, and stay behind it: out of its sight its fuse does not burn | a creeper within ten blocks that can get to the bot (the lit one whose fuse ends first, else the nearest), a cell on that line within reach open to a block with a face to place against, and the blocks carried, not in water; said with where the block goes, the seconds until the line is cut against the fuse left or the walk to three blocks and the fuse, the blast where it goes off if that is too late, what the creeper does behind the block, and the damage in the next fifteen seconds this way; with a block already in that line (held, or the ground's own), it is staying behind that block |
| `warped_fungus` | root | set a warped fungus down beside the bot and stay by it: hoglins within eight blocks of it across and four up or down attack nothing and walk off from it | a hoglin that can get to the bot, a warped fungus carried, not in water, and an open cell within reach on ground it takes (nylium, soul soil, mycelium, dirt and the like), or on a floor to lay such ground carried first; said with the rule (only the block counts, not the item held), where it goes, the seconds placing and the second before the hoglins notice, the damage in the next fifteen seconds with every other mob still reaching; held, with it standing, it is staying by it |
| `fight_from_footing` | root | step onto firm ground away from the drop, then fight there | the drop beside the bot is into lava or does half its health or more, and ground three blocks from any drop is within sixteen; said with its distance and seconds, and with a ghast in sight whose push carries the bot over a drop from here, whether its push still does from that ground |
| `out_of_the_push` | root | step back from the edge to footing where a ghast's fireball cannot push the bot over a drop, and stand there | a ghast (or a breeze) in sight whose blast's push (away from it, about 2 to 4 blocks and up, 15 degrees either side of its line) carries the bot over a drop into lava or of half its health or more from where it stands, or whose blast can break the floor under the feet over such a fall, and footing within sixteen steps of walking where it cannot, its floor holding against the blast and no lava beside it; said with the steps, the cells of the way beside the drop walked crouched, the seconds until it stands there against the ghast's rate of fire, what a fireball that lands costs there, and whether a push from another side can reach a drop from there; the walk takes the cells it was offered along; held there, asked again once a push from where the ghast has drifted carries it over from there |
| `rail_and_fight` | root | wall the open sides at the feet over the drop, then fight (or, with only shooters out of reach, hold behind the wall) | the drop beside the bot is into lava or does half its health or more and blocks for the wall are carried; said with the blocks and seconds, and where nothing can be fought, with the damage from the shots in the next fifteen seconds this way |
| `fight` | root | fight where the bot stands | always, with bare hands when no sword, axe or trident is carried |
| `strike_from_above` | root | step along the bot's own ground to the edge over a walker standing below and strike down at it, where its blow cannot reach up | a walker (not a creeper) within six blocks whose top is at or below the feet of a stand on the bot's level within two steps from which the sword reaches it (within three of the eye, a clear line); said with the game's rule (a blow reaches sideways, not up), the step, the swings to kill, whether it has a way up, what it drops and where, and the damage in the next fifteen seconds with every other mob still reaching |
| `shield_the_charge` | root | face the spear holders with the shield raised and strike each as it comes within reach on its run in | a mob with a spear that can get to the bot, in sight (or within five) and within sixteen, and a shield carried; said with the spear's run in and back off, its reach, that a shield takes its hit and a hit taken knocks the bot nowhere, and the moments the shield is down for a swing |
| `shield_guard` | root | face the nearest biter with the shield raised and let it come, striking it right after each of its blows lands on the shield or while it is within the sword's reach and out of its own, the shield straight back up | a shield carried and a biter that can get to the bot (not a creeper, a shooter or a spear holder) in sight or within five, within sixteen, not in water; said with the game's rules (a blow the shield takes does no harm and gives no wither, about one a second at its reach), the swings to kill, the blows from the side it does not block, what the arena measured, and the damage in the next fifteen seconds with the one faced blocking and the rest fought as they come |
| `low_ceiling` | root | put a ceiling two up over the bot and the cells round it, or dig a hole two in and two high into the rock beside it, and fight from under it: a walker taller than two blocks cannot come under and is struck from out of its reach | a walker taller than two blocks (a wither skeleton) that can get to the bot within sixteen, on the ground, not in water, and a ceiling within reach of the blocks carried (each against a face) or a hole of four diggable blocks with rock over it, after which walk-reach finds no way for it within its reach; said with the blocks, the seconds, the rule, what the arena measured, and the damage in the next fifteen seconds with it hitting until the ceiling is in |
| `eat_golden_apple` | root | eat a golden apple now | a golden or enchanted golden apple is carried and health is below full |
| `drink_fire_resistance` | root | drink a fire resistance potion now (or throw a splash one at the feet) | a fire resistance potion is carried, a blaze shoots at the bot in sight or the body is alight, and less than thirty seconds of the effect is on; said with its length (three minutes, eight for the long kind), the 1.6 seconds of drinking or half a second of a splash priced as the meal is, what the effect stops (a blaze's fireball, burning, lava) and does not (a blaze's swing, a ghast's blast, arrows, blades), and the fight here over fifteen seconds without it and with it (src/fire-resistance.js, note 656) |
| `pillar` | root | go two blocks up and fight from there | two scaffold blocks carried and three clear blocks overhead |
| `come_down` | root | come down the bot's own pillar, digging the block underfoot | standing on a pillar of its own blocks with a floor under it |
| `bunker` | root | dig into the nearby wall and fight at the doorway | natural rock to dig into where the bot stands or within five blocks; said with its seconds of digging with the tools carried |
| `out_of_sight` | root | walk to a spot no shooter's line reaches and fight what comes round | a shooter has a line to the bot and a spot out of every shooter's line is within eight blocks of walking (the game's raycast from each shooter's eye), not in water; said with the blocks, the seconds in their fire, what still reaches it, and when each shooter in sight has a line on it again by walking its way toward the bot (counted from then) |
| `nook` | root | dig an L into the rock, two in and one to the side, out of every shooter's line | a shooter has a line to the bot, natural rock for the L where the bot stands or within five blocks, and its end out of every shooter's line; said with the blocks, the tool, the seconds of digging, and when each shooter in sight has a line into its end by walking its way in (counted from then), or, once in it, which shooter has a line in now |
| `seal` | root | seal a pocket and wait | four or more building blocks are carried; said with the blocks and seconds, the order they go down (the cells a walker comes in by or strikes from first, those toward the biter that can be there soonest first), when those are shut against when the nearest biter can be there at its own speed, seen or not, and the damage in the next fifteen seconds this way, a biter there first standing in a gap or dropping in over the head |
| `dig_down` | root | dig straight down where the bot stands and close the hole over its head | a dry column of diggable ground under the bot walls it in within twelve blocks, a block carried for the cap, a pickaxe or ground soft enough for the hand, not in water |
| `eat` | root | eat food now | food carried, health below full, hunger below full and eighteen or more after the meal (health comes back) |
| `charge_shooter` | root | run at the ground shooters one after another and strike | skeletons, strays, bogged, pillagers or witches in view within sixteen, a sword or axe carried, not in water |
| `creeper_dance` | root | hit the creeper and back out of its blast, or hold at reach where the swings kill it before it goes off, again and again | a creeper within six, a sword or axe carried, no drop or lava to back into |
| `keep_working` | root | carry on with the work and leave the mobs be for fifteen seconds | nothing within three blocks; ends early when one comes within three or lands a hit |
| `retreat` | root | run for footing out of reach and sight | always; with a creeper within ten blocks or lit, the way found is walked in time against its fuse (the bot at its runs' measured pace, the creeper standing within three or lit and walking after the bot past three) and said with where the bot is past seven blocks or out of its sight, or where it goes off and the blast, which is counted in the price; the route search and the run are steered away from it, and a search standing still stops where it would be within three |
| `leave_reach` | root | run past the reach of what bites, taking the shooters' fire on the way | no run passes every mob about, and a route passing none of those that bite reaches footing further from each than the range it follows a player to and nearer the bot than any of them (found before the question); said with the blocks, the seconds, the shooters' damage over them, and how each that bites follows and gives up (a piglin brute by sight too, and home to its bastion) |
| `dig_in_and_fight` | root | dig a hole one wide and two high into the brick or netherrack and fight the blazes from inside | a blaze among the mobs, a sword or axe carried, not in water, and a cell of natural rock or brick beside the bot or a wall within five blocks with rock behind, beside and over it (or the bot already in such a hole); said with the blocks, the tool, the seconds of digging, how many shooters would see in, what a blaze does, its fireball's chance to land by distance and its push, and the damage in the next fifteen seconds this way |
| `fight_at_spawner` | root | walk to a cell within three of the blaze spawner's cage under a ceiling and fight them there as they come out | a blaze among the mobs, a sword or axe carried, a spawner within twenty-four, and a cell within three of it with a block over the head and no drop or lava within a push, within twenty-four blocks of walking; said as the hole is |
| `back_to_wall` | root | walk to footing with a wall at its back and fight there | a blaze among the mobs, a sword or axe carried, and footing within eight blocks of walking with rock at its back on the side away from the blazes and no drop or lava within a fireball's push (two blocks); said as the hole is |
| `dig_in_at_spawner` | root | dig a hole into the rock beside the blaze spawner's cage, the mouth toward it, and fight its blazes at the mouth | a blaze among the mobs, a sword or axe carried, digging at hand, not in water, and a blaze spawner within twenty-four with rock for such a hole within four and a half blocks of its cage; said as the hunt's dig_in_at_spawner is |
| `break_spawner` | root | walk to the blaze spawner behind the shield, break it with the pickaxe, then go at the blazes left with the sword | a blaze among the mobs, a sword or axe carried, a shield in the off hand, a pickaxe, not in water, and a blaze spawner within twenty-four with a cell within block reach of its cage; said as the hunt's break_spawner is, run fifteen seconds at a time |
| `close_in` | root | go at the blazes with the sword, striking each in reach; with a shield, up and facing each volley as it comes and down between, without one straight in | a blaze among the mobs, a sword or axe carried, not in water, and a blaze over ground the bot can stand on within a sword's reach of it; said and priced as the hunt's close_in is, run fifteen seconds at a time; a close-in that gets nowhere (a volley's cycle with no step nearer and no swing) fails, said why, and is left out while nothing changes, as a striking stance is; offered with or without a shield (note 614), said so, and priced with every fireball landing at its chance where none is carried; every option at a blaze fight says what it gains toward the rods the goal still needs (kills by its own figures, a kill only if one comes to the sword, or none) |
| `charge_nearest` | root | charge the nearest blaze alone with the sword, kill it, pick up its rod, and be asked again | a blaze among the mobs, a sword or axe carried, more than one blaze about, and the nearest over ground the bot can stand on within a sword's reach of it; priced as close_in is, up to that one kill (closeInCost upTo), with the others that see the bot shooting meanwhile, with or without a shield (note 614) |
| `box_at_spawner` | root | wall the bot in with blocks two to four and a half from the blaze spawner's cage, one block open at head height toward it, and take its blazes through the window | only where the arena measures it (BLAZE_TACTICS_ALL=1), not in play: at the drill's live spawner with four blazes about it lost 3 runs of 5 and took no rod (note 606); there, a blaze among the mobs, a sword or axe carried, not in water, a blaze spawner within sixteen, a cell within sixteen blocks of walking with ground under each side, no lava beside it and no more blocks to place than are carried; said with the walk, the blocks, that only a blaze in line with the window sees in and every shot comes from in front where the shield faces, that a blaze more than two off hovers and shoots and one within two that sees in comes at the window into the sword, the blazes within four of the cell now, the rods fetched through the block under the window, what the building costs in their fire, and what the arena measured of it (blaze-stand.js MEASURED); held up to forty-five seconds, until a rod is carried, six health is gone or twenty seconds with no blaze in line or within eight |
| `box_here` | root | wall the bot in with blocks where it stands, one block open at head height toward the spawner or the blazes, and hold it | a blaze among the mobs, a sword or axe carried, not in water, a cell within two steps with ground under each side, no lava beside it and no more blocks to place than are carried; said and held as box_at_spawner is, with whether the spawner puts its blazes beside it (only within four of its cage) and that food can be eaten in it |
| `light_spawner` | root | put torches on and round the blaze spawner's cage until every open cell it spawns in is at light twelve or more, the shield up for each volley | only where the arena measures it (BLAZE_TACTICS_ALL=1), not in play: at the drill's live spawner with four blazes about it lost 4 runs of 5 and took no rod (note 606); there, a blaze among the mobs, a sword or axe carried, not in water, a blaze spawner within sixteen with cells still dark, torch spots from which every one of them can be lit, and torches carried or coal and sticks to make them (four a pair); said with the torches, the game's rule (a blaze spawner's tries fail at light 12 or more, and a round in which every try fails is tried again the next tick, so every open cell within four of the cage, one below to one above, has to be lit), that the spawner makes them again once the torches are taken down, the blazes about left to fight after, the seconds and damage in their fire, and what the arena measured of it |
| `corner_ambush` | root | stand round a corner where no blaze has a line to the bot, facing the corner, and strike what comes round it | a blaze among the mobs, a sword or axe carried, not in water, a cell within ten blocks of walking that none of the blazes about sees, with a cell beside it one of them does and no drop or lava within a push; said with what a blaze does out of sight (flies toward the bot a quarter second, gives it up after three seconds unseen, then wanders), the walk in their fire and what the arena measured of it; held thirty seconds, until a rod is carried or six health is gone |
| `leave_and_heal` | root | go out of every blaze's sight, eat, and wait until the health is full where it can come back, then be asked again | a blaze among the mobs, a sword or axe carried, not in water, health under twenty, and a cell within fourteen blocks of walking none of the blazes about sees, at least four from the nearest; said with the walk in their fire, the healing's pace (a point each half second at hunger twenty with saturation, each four seconds at eighteen or nineteen) and seconds to full (said as never where hunger is under eighteen with too little carried to bring it to eighteen: then no health comes back, and the option is only out of the fire and the volleys), that the blazes stay and a spawner within sixteen makes more meanwhile, and what the arena measured of it; run until the health is full or sixty seconds, or, where none can come back, until out of sight with the fire on the body out |
| `hold_on_span` | root | hold crouched on the span: wall its open sides where something can push, strike what comes to arm's length and meet shots with the shield, crouched; off it away from a creeper first | standing on a one-wide span over a drop; said with the walls' blocks and what can push |
| `get_out_of_water` | root | swim for dry ground and deal with the mobs from there | in water; the pillar, the pocket, the bunker and digging down are not offered there |
| `portal_back` | root | go back through the portal to the Overworld | in the Nether with a portal within eight blocks and a way back through it |
| `return_fireball` | root | stand in the ghast's line, look at it, and strike its fireball back at it | a ghast in the bot's sight within sixty-four blocks, not in water; said with when it fires, the fireball's flight each way, that a struck fireball flies where the bot looks and kills the ghast it hits, the server's six blocks and three or four ticks for the strike, what it has done live (before its strike was timed by the fireball's flight, and this bot's own since), and priced by that record: the next two fireballs landing but for the share measured sent back, and over a drop a shot can push the bot off, by that fall |
| `shoot_\d+` (pattern) | root | shoot this mob with the bow | a bow, arrows and a clear arrow path (up to three targets within twenty blocks, and a ghast in sight out to sixty-four, said with the arrow's flight and the arrows that bring it down) |

### `shield_policy`

**Shooters can hit the bot and a shield is carried: raise the shield at each shot on its way, or leave it down and keep on?**

- When: In an encounter (the survival step's answer to a threat), a shield in the off hand and a shooter in sight or a shot on its way, with no choice standing for these shooters; held until a shooter not counted comes, health falls four, or a minute.
- Decision tree, choice; stakes medium; ledger kind `combat`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (shieldPolicy), src/projectile-guard.js (deflect)
- Nothing left to try: asks `encounter_stance` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `shield_at_shots` | root | raise the shield at each shot on its way | always; said with each shooter's shot flight time from where it is, the quarter second the shield takes to rise, that it stops whatever the bot is doing for up to 0.7 seconds a shot and covers only the way it faces, and that it is not raised with something that bites within 3.5 blocks or a creeper that could reach the bot meanwhile |
| `take_shots` | root | leave the shield down and keep on with the stance or the step | always; said with what each shooter's shot does to the bot through what it wears |

### `hunt_target`

**The request needs a mob's drop: which observed mob should the bot fight now, or leave them for now?**

- When: A mob hunt step with at least one candidate in view that is reachable and isolated, or on a blaze hunt a blaze within twenty-four, in sight or heard through the walls, and a stand to take them from, the bot on ground it can fight from (dry, not on a one-wide span, air to breathe). A blaze whose every way in the open ends within a fireball's push of lava or a deep drop is not offered to fight in the open (notFoughtInTheOpen in the state).
- Decision tree, choice; stakes high; ledger kind `combat`
- Bar: none: every target offered is reachable and isolated and the bot has footing for a fight; the fitness is said in full on every option, a close call between fighting and leaving it is a preference, and the outage default is the same nearest target
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/mob-hunt.js (huntObserved, fitness, fitnessSays)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `hunt_\d+` (pattern) | root | fight this mob | observed, reachable, isolated from others of its kind; said in a sentence with where it is and whether it is in sight or only heard, how it is fought with what is carried, what it drops and that the resource is what the request needs, the fight's estimate (with the others that reach the bot there fighting too, a shooter in sight within its reach or anything else within sixteen, and the one alone beside it; a blaze spawner near said) and the bot's fitness: health against the fourteen the code once required, hunger and whether health comes back, food carried, fire, and the kit |
| `dig_in_and_fight` | root | dig a hole into the brick or netherrack and take the blazes from inside it | a blaze hunt with a blaze within twenty-four (in sight or heard), a sword or axe carried, and rock for the hole beside the bot or a wall within five blocks; said as the encounter stance of that name, with the push where the bot stands; held until a rod is in hand, the blazes are quiet twenty seconds or two minutes pass, then the rods picked up |
| `fight_at_spawner` | root | take the blazes at their spawner's cage, under a ceiling | a blaze hunt with a blaze within twenty-four (in sight or heard), a spawner within twenty-four and a cell within three of it under a ceiling, no drop or lava within a push, within twenty-four blocks of walking; held as the hole is |
| `back_to_wall` | root | take the blazes from footing with a wall at its back | a blaze hunt with a blaze within twenty-four (in sight or heard) and such footing within eight blocks of walking; held as the hole is |
| `dig_in_at_spawner` | root | dig a hole into the rock beside the blaze spawner's cage, the mouth toward it, and take its blazes at the mouth | a blaze hunt with a blaze within twenty-four, a sword or axe carried, digging at hand, and a blaze spawner within twenty-four with rock for such a hole within four and a half blocks of its cage and thirty of walking; said with the walk, the rock, the digging, what the spawner makes and where, that every shot comes in through the mouth, and what the arena measured of it (blaze-stand.js MEASURED); held as the hole is, the rods at the mouth picked up between volleys |
| `break_spawner` | root | walk to the blaze spawner behind the shield, break it with the pickaxe, then go at the blazes left with the sword | a blaze hunt with a blaze within twenty-four, a sword or axe carried, a shield in the off hand, a pickaxe, and a blaze spawner within twenty-four with a cell within block reach of its cage and thirty of walking; said with the walk, the digging, that no more come from it once broken and where the rods come from after, and what the arena measured of it; the blazes left then fought as close_in |
| `close_in` | root | go at the blazes with the sword, striking each in reach; with a shield, up and facing each volley as it comes and down between, without one straight in | a blaze hunt with a blaze within twenty-four, a sword or axe carried, and a blaze over ground the bot can stand on within a sword's reach of it; said with the nearest one's distance, how many are over ground and over lava, the volley's glow and rest, what the shield takes and what it leaves, what the arena measured of it with the same kit (blaze-stand.js MEASURED), and its price worked from the fight at hand (closeInCost: how many blazes see the bot and over how wide an arc, how many the shield faced at their middle covers, the lulls between volleys the walk needs, the swings each takes with the shield down while the rest shoot, the burning, a live spawner's newcomers, and when the health runs out if it does); run for forty-five seconds, until a rod is carried or until six health is gone, then asked again, or ended sooner, said why, when a volley's cycle passes without a step nearer a blaze or a swing; the rods picked up between volleys; offered with or without a shield (note 614), said so, and priced with every fireball landing at its chance where none is carried; every option at a blaze fight says what it gains toward the rods the goal still needs (kills by its own figures, a kill only if one comes to the sword, or none) |
| `charge_nearest` | root | charge the nearest blaze alone with the sword, kill it, pick up its rod, and be asked again | a blaze hunt with a blaze within twenty-four, a sword or axe carried, more than one blaze about, and the nearest over ground the bot can stand on within a sword's reach of it; priced as close_in is, up to that one kill (closeInCost upTo), with the others that see the bot shooting meanwhile, with or without a shield (note 614) |
| `box_at_spawner` | root | wall the bot in with blocks two to four and a half from the blaze spawner's cage, one block open at head height toward it, and take its blazes through the window | only where the arena measures it (BLAZE_TACTICS_ALL=1), not in play: at the drill's live spawner with four blazes about it lost 3 runs of 5 and took no rod (note 606); there, a blaze hunt with a blaze within twenty-four, a sword or axe carried, a blaze spawner within sixteen, a cell within sixteen blocks of walking with ground under each side, no lava beside it and no more blocks to place than are carried; said with the walk, the blocks, that only a blaze in line with the window sees in and every shot comes from in front where the shield faces, that a blaze more than two off hovers and shoots and one within two that sees in comes at the window into the sword, the blazes within four of the cell now, the rods fetched through the block under the window, what the building costs in their fire, and what the arena measured of it (blaze-stand.js MEASURED); held up to forty-five seconds, until a rod is carried, six health is gone or twenty seconds with no blaze in line or within eight |
| `box_here` | root | wall the bot in with blocks where it stands, one block open at head height toward the spawner or the blazes, and hold it | a blaze hunt with a blaze within twenty-four, a sword or axe carried, a cell within two steps with ground under each side, no lava beside it and no more blocks to place than are carried; said and held as box_at_spawner is, with whether the spawner puts its blazes beside it (only within four of its cage) and that food can be eaten in it |
| `light_spawner` | root | put torches on and round the blaze spawner's cage until every open cell it spawns in is at light twelve or more, the shield up for each volley | only where the arena measures it (BLAZE_TACTICS_ALL=1), not in play: at the drill's live spawner with four blazes about it lost 4 runs of 5 and took no rod (note 606); there, a blaze hunt with a blaze within twenty-four, a sword or axe carried, a blaze spawner within sixteen with cells still dark, torch spots from which every one of them can be lit, and torches carried or coal and sticks to make them (four a pair); said with the torches, the game's rule (a blaze spawner's tries fail at light 12 or more, and a round in which every try fails is tried again the next tick, so every open cell within four of the cage, one below to one above, has to be lit), that the spawner makes them again once the torches are taken down, the blazes about left to fight after, the seconds and damage in their fire, and what the arena measured of it |
| `corner_ambush` | root | stand round a corner where no blaze has a line to the bot, facing the corner, and strike what comes round it | a blaze hunt with a blaze within twenty-four, a sword or axe carried, a cell within ten blocks of walking that none of the blazes about sees, with a cell beside it one of them does and no drop or lava within a push; said with what a blaze does out of sight (flies toward the bot a quarter second, gives it up after three seconds unseen, then wanders), the walk in their fire and what the arena measured of it; held thirty seconds, until a rod is carried or six health is gone |
| `leave_and_heal` | root | go out of every blaze's sight, eat, and wait until the health is full where it can come back, then be asked again | a blaze hunt with a blaze within twenty-four, a sword or axe carried, health under twenty, and a cell within fourteen blocks of walking none of the blazes about sees, at least four from the nearest; said with the walk in their fire, the healing's pace (a point each half second at hunger twenty with saturation, each four seconds at eighteen or nineteen) and seconds to full (said as never where hunger is under eighteen with too little carried to bring it to eighteen: then no health comes back, and the option is only out of the fire and the volleys), that the blazes stay and a spawner within sixteen makes more meanwhile, and what the arena measured of it; run until the health is full or sixty seconds, or, where none can come back, until out of sight with the fire on the body out |
| `defer` | root | leave them for now | always; said with the fitness, the shooters that still reach the bot where it stands (leaving is not out of their fire), and what the hunt does meanwhile when the bot is short of it (food, cover, health); on a blaze hunt, that it gains nothing toward the rods still needed, the blazes staying, and that those left are not offered again for two minutes (note 614) |

### `combat_kit`

**Pieces of the combat kit (iron-or-better sword, helmet, chestplate, leggings, boots, a shield) are missing: go on with what is carried, make them here first, or go back to the Overworld for them?**

- When: Before a hunt of a mob that fights back, or the crossing into the Nether or the End, with a piece of the kit neither carried nor set aside, and more than one way on; held ten minutes while the same options stand.
- Decision tree, choice; stakes medium; ledger kind `combat`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/mob-hunt.js (prepareCombatGear, kitChoice, kitPieces)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `fight_with_carried` | root | go on with what is carried | always; said with the weapon and armour carried and one fight's estimate against the mob hunted |
| `make_kit_here` | root | make the pieces that can be made here first | a missing piece can be made from sources in this dimension; said with the iron it takes and the steps |
| `return_for_kit` | root | go back to the Overworld for the pieces | outside the Overworld, a missing piece made only from Overworld ore; said with the iron, the ore and the trip to the portal |

## strategy

### `crossing_kit`

**Cross into the Nether with the kit carried now, or first top up one named item of it (food, health, blocks, a spare pickaxe, wood) or leave the valuables behind?**

- When: In the Overworld on the way through a portal, in Survival, with some item of the kit short of what the code would take, valuables carried that could be left, or a cauldron and water bucket for the Nether fire makeable from what is carried (an offer, not a gap); held until what is on offer changes or for ten working minutes.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (crossingKitReady), src/crossing-kit.js (kitItems, valuablesAt)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `cross_now` | root | cross with what is carried | always |
| `top_up_food` | root | gather food first, enough for the Nether stay the goal needs | fewer food points carried than the stay the goal still needs takes (src/crossing-kit.js netherStay: the rods and pearls left, on the two hours a practiced player takes for all of them, at about forty hunger an hour; eighty points for the whole stay), monsters on; said with the stay, its hunger and what raw and cooked count for (note 607); said with where it goes (the home chest, the plot, an animal in view hunted, or a search outward with no bound), the trip to food known, and the frame begun it leaves where it stands (notes 527, 594) |
| `top_up_food_near` | root | gather food at the known food whose trip is shortest, on to the frame begun or, with none begun, back here | food short and some food known (animals in view, a herd seen, a village, the home plot or chest); said with the walk there, the gathering, the walk on to the frame or back here, and what it gives raw and cooked (notes 527, 594) |
| `top_up_cook` | root | cook the raw food carried first, at a furnace put down here | food short, raw food carried that cooking makes more of, fuel carried, and a furnace or smoker or eight cobblestone for one; said with the points as carried and once cooked, and the seconds (note 594) |
| `top_up_health` | root | wait and heal first, to sixteen | health under sixteen, monsters on |
| `top_up_blocks` | root | mine stone first, up to two stacks of blocks | fewer than 128 building blocks carried |
| `top_up_pickaxe` | root | make a stone pickaxe first, as the spare | no stone pickaxe or better, or the best has under 24 uses |
| `top_up_gold` | root | make golden boots first, a piece of gold worn so piglins leave the bot be | no piece of golden armour carried |
| `top_up_wood` | root | gather logs up to eight and make a crafting table first | fewer than eight logs or no crafting table carried |
| `top_up_cauldron` | root | make a cauldron and fill a bucket with water first, to put a fire out in the Nether | no complete set (a cauldron and a water bucket) carried, and one makeable from what is carried: a cauldron or seven iron ingots, and a water bucket or an empty bucket; it makes the question worth asking even with nothing short, and is never the fallback; said with the iron it costs, the slots, what the cauldron does (the fire out a tenth of a second after the feet are under its water, in the Nether too), the seconds it takes to put down and step into, and that the bucket is emptied into it (note 634) |
| `stash_valuables` | root | walk home and leave the valuables in the stash chest first | the home stash chest within 128 blocks and valuables carried |
| `cache_valuables` | root | leave the valuables in a chest put down here first | home's chest out of reach, valuables carried, and a chest or the wood for one |

### `rung_elsewhere`

**The step the game needs next cannot be done in this dimension: go where its sources are, or go on with what the ladder has next here?**

- When: On the game ladder, a step whose plan from here needs a block found only in another dimension, or a step set aside for that.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/game-progress.js (elsewhereStep, nextGameStage)
- Nothing left to try: the stall's question, as before (nothing above it)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `go_(overworld\|nether\|end)` (pattern) | root | go to the dimension its sources are in | always; said with what is mined there, what is brought back, and the trip to the portal |
| `on_here` | root | leave the step for now and go on with what the ladder has next here | the ladder has something else to do in this dimension |

### `surface_trip`

**The step in hand wants the surface and the bot is underground: climb to open sky for it, leave the step for now and go on down here with the ladder's next one, dig the ore in view first with the uses the climb does not need, or, for a portal site, dig one out of the rock here?**

- When: Underground in the Overworld, the work's step wants what only the surface has (logs, flowers, a surface search, a portal site), on the game ladder with another step to go on with (the rungs after it that want the same climb are left with it), or for a portal site with one that can be dug out here; asked when the climb would begin, and held to the top once Jev chose it (a climb made with nothing else on offer holds nothing and is looked at again; wood chosen at upkeep is its climb chosen) (note 543).
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (surfaceTrip), src/surface.js (tripCost), src/game-progress.js (nextGameStage)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `climb` | root | climb to open sky for it | always; said with the height, the quicker way out and its time, the pickaxe uses it wears, and the way back down it leaves |
| `stay_below` | root | leave the step thirty minutes and go on with the ladder's next step here | the ladder has another step to go on with that does not want the same climb (those that do are left with it, and named), and it is the work's turn; said with the pickaxes' uses against the step in hand and the way home, what the pockets make and the nearest wood known (note 543) |
| `mine_first` | root | dig the ore in view first with the uses the climb does not need, then climb | on the game ladder at the work's turn, a pickaxe carried, an ore it can mine within sixteen blocks with no lava beside it, and more uses carried than the climb's quicker way digs; said with the uses, the climb's digs and the spare, and asked again after each ore (note 543) |
| `dig_site` | root | dig a site for the portal frame out of the rock where the bot stands | the need is a portal site, a pickaxe carried, and a site takes in the bot's feet whose frame and walkways are natural rock to dig, with solid floor and no water, lava or falling block beside; said with the blocks, the seconds and the uses, and how far it is from the lava chosen to cast beside, where the climb says how far above that lava the frame would go (note 531) |

### `leave_nether`

**Go back through the portal to the Overworld now, or stay in the Nether: the rods step taken up again, other work here until its rest ends, or going on without food?**

- When: In the Nether on the game ladder: the blaze rods step waits (set aside, not for its sources being elsewhere) and the ladder would go back; or a hunt short of fitness, hungry under eighteen with nothing to eat. The answer kept while its reason stands.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/game-progress.js (leaveNetherStep, nextGameStage), src/mob-hunt.js (prepareMobHunt)
- Nothing left to try: the stall's question, as before (nothing above it)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `go_back` | root | go back through the portal to the Overworld | always; said with what it is for, the trip to the portal, and the hour it comes out at |
| `search_on` | root | take the rods step up again now, its rest lifted | the rods step waits, and what it was set aside for does not still stand from here (src/game-progress.js asideStands: within four blocks of where it was set aside, before the ways below come off rest or five minutes; said in searchOnNotOffered, note 600) |
| `wait_here` | root | other work in the Nether until the rods step's rest ends, the minutes said | the rods step waits until a time; chosen, that work is the waiting stage's own, a piece at a time (src/work.js holdForRest), not the rods step thrown at each pass (note 605) |
| `keep_on` | root | go on in the Nether without going back for food | hungry under eighteen with nothing to eat; the trip back is left out for twenty minutes |
| `restock_food` | root | get food here first: the ways to it asked next, each priced | the food reason, in the Nether, with under eight food points carried or hunger under eighteen and health under twenty, and some way to food real from here (a hoglin known, mushrooms of both kinds in view, raw meat to cook, the trip back); said with why it is on offer, the stay the goal still wants against what is carried, and each way's yield (src/nether-food.js) |

### `nether_food_kit`

**In the Nether with a stay still ahead and less food than it will spend: go on with what is carried, get food here, or go back through the portal for it?**

- When: On the game ladder, the first time a Nether question is due in a stay (the fortress search or a blaze hunt at a fortress) with fewer food points carried than the goal's stay wants (crossing-kit.js netherStay), or with the cauldron set makeable from what is carried (7 iron ingots, a water bucket, a crafting table or wood for one: note 649), and each hour of the stay after; not with a mob in sight; asked once whatever the answer.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/nether-food.js (askStayKit), src/crossing-kit.js (netherStay), src/mob-hunt.js (stayKit)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `go_on` | root | go on with the stay on what is carried | always; said with the points carried and how many minutes they last at forty hunger an hour against the minutes the goal still wants |
| `restock_food` | root | get food here first: the ways to it asked next, each priced | some way to food real from here other than the trip back (a hoglin known, mushrooms of both kinds in view, raw meat to cook); the ways not real are said |
| `raid_bastion` | root | raid a bastion's chests for their food | food short for the stay and a bastion remembered within 384 blocks whose walk is not resting (note 649); said with the same facts as bastion_raid and the food its chests hold; chosen, it is the raid Jev chose |
| `top_up_cauldron` | root | make the cauldron set for the Nether's fire now | in the Nether with a water bucket, seven iron ingots and a crafting table or wood for one carried, and no cauldron (no water is to be had there to fill an empty bucket); said with the iron it costs, the slots, what fire is of the blaze fights' damage, that it must be set down near the fight or when alight, the seconds it takes, and that no trial has played it; never the fallback (note 649) |
| `return_for_food` | root | go back through the portal to the Overworld for food | the way back is at hand; said with the trip at the measured pace of the Nether's walks, and the food known on the other side |

### `win_strategy`

**On the way to beating the game, which of the open steps, the Nether now, or a side trip should the bot do next; and if a side trip, which?**

- When: Each step of the beat-the-game ladder in the Overworld while more than one thing is open; the answer holds until the ladder's next step or the top-level choices change (a side trip coming into view among others does not), or ten minutes pass. A side trip runs once and then rests ten minutes.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/strategy.js (strategyOptions, strategyTree, homeOption), src/game-progress.js (openRungs), src/work.js (sideTrips)
- Nothing left to try: the stall's question, as before (nothing above it)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `rung_[a-z_]+` (pattern) | root | a rung of the ladder | the ladder's next rung (the fallback), and each rung after it the ladder may reach while the ones before it wait (shield, iron sword, bucket, iron armour, golden boots, bow, arrows, diamond sword); pickaxes are never skipped. Each is said alike, with what it is for, what it takes from the pockets and what going without costs |
| `stage_[a-z_]+` (pattern) | root | the ladder's later stage | past the preparation ladder in the Overworld (pearls, the crossing, the stronghold): the fallback |
| `take_up_[a-z_]+` (pattern) | root | take up a rung set aside for the Nether after all | a rung Jev chose to go without before the Nether (nether_first) and still waiting (note 498); said with what it is for and when it would come back on its own |
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
| `tame_wolf` | side_trip | tame a wolf | a wild adult wolf in view or seen within sixty-four blocks (remembered thirty minutes, out of view walked to and forgotten if gone), bones carried, fewer than two tamed, in the Overworld; said with where it is, the odds the bones carried give (one in three a bone), what a tamed wolf does and does not do, and what the Overworld's mobs cost the fresh worlds of 2026-09-28 |
| `breed_cows_here` | side_trip | breed two cows in the field | two adult cows within sixteen blocks, two wheat carried, none bred in five minutes |
| `breed_sheep` | side_trip | breed two sheep | two adult sheep within sixteen blocks, two wheat carried, none bred in five minutes |
| `breed_chickens` | side_trip | breed two chickens | two adult chickens within sixteen blocks, two seeds carried, none bred in five minutes |
| `loot` | side_trip | open the chests of a remembered structure | by day, health fourteen or more and hunger twelve or more, with an unlooted ruined portal, dungeon, temple or mineshaft within 256 blocks |
| `trade` | side_trip | trade at a remembered village | by day and fit, with a village remembered and something to sell or spend |
| `enchant` | side_trip | enchant gear at the enchanting table | by day and fit, with a table known, lapis carried, level five or more and gear unenchanted |
| `shear_sheep` | side_trip | shear the sheep in view | shears carried, a sheep with wool within twenty-four blocks, fewer than fifteen wool carried, in the Overworld |
| `smelt_stock` | side_trip | smelt the raw ore carried into ingots | at any hour, eight or more raw iron or gold carried and the fuel for all of it |
| `enchanting_table` | side_trip | make an enchanting table | no table known, two diamonds and three lapis carried, level five or more, obsidian carried or a diamond pickaxe, and gear unenchanted |

### `rung_progress`

**Ten minutes on this rung with no new best, or every way below it spent from here: keep at it with the ways left, change the plan, or set the rung aside?**

- When: The rung's budget (src/tried.js watchRung, kept by src/arbiter.js rungWatch whoever holds the turn): ten minutes on the clock, sealed in, held on a pillar or fighting included (only sleep, a batch cooking, health coming back and the Overworld night in a shelter are not counted), without more of the rung's item, a milestone, a new best distance to its target or sixteen blocks of new country; at once when a stance held on with nothing new reaches its five-minute cap (src/holds.js); or an escalation from a question below whose every way rests from here, whose same answer was held (src/decisions/index.js escalateFrom), or that was answered none good, sure, twice running to the same situation.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (answerStall with the rung's stall), src/tried.js (the budget and the ledger)
- Nothing left to try: the stall's question, as before (nothing above it)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `keep_at_it` | root | keep at the rung with the ways not yet tried here | always: the ledger's tries are said with it, and the budget starts again; with ways untried below, the question below is asked next with them (src/tried.js sendBack, note 605) |
| `differently` | root | keep at the stalled work another way | work stalled (not idle time): a mine leaves this patch of the resource, anything else turns its search |
| `set_aside_rung` | root | leave the stalled rung for thirty minutes | the stall is on a game-ladder rung that can wait (at the rung's question, any rung), and not one already set aside: a rung set aside is not the rung in hand, and its question is not asked while it waits (src/tried.js rungOf, note 600); at the rung's question brought by a failure below rather than its ten minutes, only once the rung's own questions below it have no way left untried from here, else said in setAsideNotOffered (note 605) |
| `take_up_[a-z_]+` (pattern) | root | take up a rung set aside earlier, its rest cut short | on the way to beating the game, a rung set aside and still resting that the ladder would take up now were its rest lifted (src/game-progress.js takeBackRungs), and what it was set aside for does not still stand from here (asideStands: within four blocks of where it was set aside, before the ways below come off rest or five minutes; said in stalled.takeUpNotOffered, note 600); said with why, when and from where it was set aside, the minutes its rest has left, where its work is (the rods' fortress) and what the ledger holds of it (note 588) |
| `pearls_(forest_[0-9]+\|search\|barter\|overworld\|nether)` (pattern) | root | another route to the ender pearls | the pearls are the rung in hand (src/pearl-routes.js): a warped forest known whose walk rests, taken up again; the sweep for another forest when it rests and no forest known is open; a barter walk toward a piglin, gold carried and none within thirty-two; back to the Overworld for its endermen, a portal remembered (held half an hour or until the pearls are carried); in the Overworld on that route, back to the Nether's forests. A route that is not real from here is said in stalled.pearlRoutesNotOffered with why (note 588) |
| `until_rest_ends` | root | other work until the rest ends, the minutes said, a choice that holds | every way to the stalled work rests until a time (WaysResting), or every way of the question below rests from here (an escalation: the minutes until the first comes off rest, the rung kept in hand, note 600); the same rest met again goes back to that work, not to the question (note 490) |
| `work_free` | root | work free of the terrain one move at a time | the bot is in water, under cover on the way up, or where every walk has failed (src/unstuck.js); each move is then Jev's (unstuck_move) |
| `night_mine` | root | dig a mine from here for the night | night in the Overworld, a pickaxe and nothing watching |
| `mine_nearby` | root | dig a useful ore in view | an ore within sixteen blocks with no lava beside it |
| `look_around` | root | walk twenty-four blocks somewhere new | by day in the Overworld, or when nothing else is on offer |
| `cross_toward` | root | tunnel or bridge straight toward where the stalled Nether work was going | in the Nether, a target known (the portal back, the fortress leg, the tunnel's end), and the cells ahead at this height let it come nearer: rock with no lava behind it, open air or lava to lay the blocks carried over (src/nether-travel.js) |
| `floor_toward` | root | go down to the floor below and walk a stretch of it toward where the stalled Nether work was going | in the Nether, a target known, ground four or more below under eight or more of the sixty-four columns round the bot, a way down to it found within thirty-two blocks, and eight or more cells of floor on the line toward the target; said with the way down, the floor on that line, the mobs by it with what fighting them all would cost at this health and whether health comes back (note 625) and the height back up (src/nether-travel.js) |
| `hoglin_food` | root | hunt a hoglin for porkchops | in the Nether, hungry with nothing to eat or on the way back for food, and a hoglin in view or seen within 192 blocks; said with how the day's hunts of a hoglin for its meat went (66 begun, none brought meat, note 625) |
| `return_for_food` | root | go back through the portal to the Overworld for food | in the Nether, hungry with nothing to eat or on the way back for food; said with the trip (its walk, the pace of the Nether walks measured, from sixty blocks, lava on the line, the hour it comes out at), the food known on the Overworld side and, while the choice to go on without it holds, when and at what health that was chosen (note 607) |
| `portal_here` | root | build a portal where the bot stands and go through | in the Nether on the way back (or hungry), ten obsidian, flint and steel or a fire charge, and three blocks for the lintel carried |
| `keep_on` | root | go on in the Nether without going back for food | in the Nether, hungry with nothing to eat or on the way back for food; the trip back is left out for twenty minutes; said, when Jev chose the trip back and it is what has stopped, that this ends it (note 625) |
| `restock_food` | root | get food here first: the ways to it asked next, each priced | in the Nether with under eight food points carried, or hunger under eighteen and health under twenty, and some way to food real from here (a hoglin known, mushrooms of both kinds in view, raw meat to cook, the trip back); said with why it is on offer, the stay the goal still wants against what is carried, and each way's yield (src/nether-food.js, note 639) |
| `cook_food` | root | cook the raw food carried | by day in the Overworld, and raw meat is carried |
| `stone_tools` | root | make stone tools | by day in the Overworld, and a stone pickaxe, axe or sword is missing |
| `stock_wood` | root | stock up to sixteen logs | by day in the Overworld, and fewer than sixteen logs are carried and a tree is in view |
| `explore` | root | explore the nearest unexplored area | by day in the Overworld, and in the Overworld, with an unexplored area within 512 blocks of home |
| `loot` | root | open the chests of a remembered structure | by day in the Overworld, and in the Overworld, with a ruined portal, dungeon, temple or mineshaft within 256 blocks whose chests are unopened |
| `earn_xp` | root | smelt raw ore for experience | by day in the Overworld, and eight or more of a raw ore are carried, gear is still unenchanted and the experience level is under thirty |
| `enchant` | root | enchant gear at the enchanting table | by day in the Overworld, and a table is carried, in view or remembered, lapis is carried, the experience level is five or more, and gear is unenchanted |
| `trial_chambers` | root | an expedition to the trial chambers | by day in the Overworld, and in the Overworld with an iron pickaxe or better, healthy and fed |
| `tame_wolf` | root | tame a wolf | by day in the Overworld, and a wild adult wolf in view or seen within sixty-four blocks and remembered, and bones carried, fewer than two tamed |
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
| `again` | root | try the failed step again as it was | a step failed again and again (persist), and it does not rest in the ledger from here (src/tried.js): tried twice from here and come to nothing, it rests five minutes; only this answer puts the failed step back in hand |
| `recover_[0-9]+` (pattern) | root | a recovery move the code checked (gather footing, the surface, another standing spot, another source, down off a pillar) | a step failed again and again, and src/recovery-options.js found the move feasible from here (it was the separate recovery_action question, folded in here in note 571) |

### `bastion_raid`

**A bastion is remembered in the Nether: go for its chests (gold, golden apples, food, armor, now and then netherite and the upgrade template, at the price of every piglin that sees a lid lift), take only the gold blocks no piglin can see, or leave it alone?**

- When: In the Nether on the game ladder, the pearl step short of pearls with no gold to barter, and a bastion remembered within 384 blocks whose walk is not resting; asked when the trip begins, held forty-five minutes (or until the bot dies or the raid closes) so it is not asked at each leg.
- Decision tree, choice; stakes high; ledger kind `strategy`
- Bar: none: Jev's pick is taken at any confidence: the ways are carried out by the survival layer's own stances and the loot code's guards (health, a mob that bites in sight), an unsure raid is one trip held forty-five minutes and asked again after, and the code default (gold only) answers only when Jev cannot be reached
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/bastion-raid.js (chooseTrip, facts, options), src/bartering.js (gatherBastionGold), src/looting.js (lootableChests reads raidOn)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `raid_chests` | root | raid the bastion's chests: walk there, open the nearest chest, take the loot list, go on to the next | a bastion is remembered within 384 blocks in the Nether and its walk is not resting; said with the distance and legs, what is in view, what the chests hold by room (from the 26.1.2 jar), what lifting a lid does, the fights priced from the game's numbers, gold armor worn or not, health, hunger, food, and that no bastion chest has ever been opened by the bot |
| `gold_only` | root | take only the gold blocks and gilded blackstone no piglin is within 16 blocks of, open no chest | the same bastion; the gold rung as it was before chests were a question |
| `leave_it` | root | leave the bastion alone for thirty minutes and go on with the ladder's next step or another way to the pearls | always with the others |

## work

### `portal_method`

**The way into the Nether: build a portal frame of its own from obsidian, cast one in place from lava and water (here, or beside the known lava), or finish and light a remembered ruined portal; or make more buckets first?**

- When: In the Overworld on the way to the Nether, with no lit portal known and no frame begun; held once chosen and asked again after every twenty working minutes on the way held (said with the minutes and what they made, to keep or change), when a chosen ruin's frame will not do, when the walks to the lava chosen come no nearer, or when neither the walk nor the staircase gets back to a cast frame (said with where it is and what each way ended in), or when a frame with obsidian in it fails at its site (said with what is cast, the failures since the last block went in and why, and those a mob in the way caused, not counted).
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (portalMethod, portalFacts, methodSoFar), src/portal-cast.js (castSays)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `build_new` | root | build a frame of its own from ten obsidian | always |
| `cast_frame` | root | cast a frame of its own in place from lava and water | always |
| `cast_at_lava` | root | cast a frame of its own beside the nearest known lava | lava known more than sixteen blocks away |
| `cast_here` | root | cast a new frame where the bot stands, the frame begun or the lava chosen left behind | the frame begun cannot be got back to: the walk and the staircase toward it both failed (note 481); or the staircase to the lava held rests (note 490) |
| `into_cave` | root | go down into the cave the staircase to the lava held stopped over, and go on from its floor | the staircase to the lava held rests over a cave under its next stair (no block to floor it), and the fall to its floor or water costs less than half the health (note 490) |
| `other_lava` | root | cast beside another known lava whose way is not resting | the staircase to the lava held rests and another lava is known (note 490) |
| `new_site` | root | leave the part-cast frame as it stands and start a new one at another site near here | a frame with obsidian in it failed at its site, not for a mob in the way (note 527); said with what is left there and what a new frame costs |
| `craft_buckets` | root | make more buckets first from the iron carried | three or more iron ingots carried |
| `ruin_[0-9]+` (pattern) | root | finish and light a remembered ruined portal | a ruined portal remembered within 512 blocks, not found frameless (and the one held, however far) |

### `portal_way`

**The portal the bot is making for cannot be reached from here: the walk, the boat and the staircase have failed. Make a portal here, climb to its height, go round another way, mine blocks and cross straight at it, take the boat again, or other work until the staircase's rest ends?**

- When: On the way to a remembered portal or one in view (the crossing into the Nether, or the way back from it), when the walk made no ground and the staircase toward it rests or stalls; asked once for each rest from each place (its eight-block area and height), the answer kept (said as every way resting when met again). A way chosen from a place that moved the bot under four blocks and no nearer is not offered from there again for five minutes in that rest, and is said (triedFromHereToNothing); with every way so tried, the way rests and is not asked.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (walkToKnownPortal, portalWay, lineSays)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `portal_here` | root | make a portal here instead, the one remembered passed over | in the Overworld, always (the way it is made is then asked: portal_method); in the Nether, ten obsidian, a lighter and three blocks carried |
| `climb_here` | root | pillar straight up to the portal's height near where the bot stands, and the way across asked again from the top | the portal is three or more blocks up, a column within five blocks has no lava or water in or beside it, and blocks to lay are carried; said with the height, the blocks against those carried, how far across the portal is from the top, and the fall a push would be |
| `around_left` | root | a leg of thirty-two blocks on foot to the left of the heading, and the way asked again from there | always |
| `around_right` | root | a leg of thirty-two blocks on foot to the right of the heading, and the way asked again from there | always |
| `floor_way` | root | go down to the floor below and walk it toward the portal, bridging only across lava and open air on it | in the Nether, ground four or more below under eight or more of the sixty-four columns round the bot, a way down to it found within thirty-two blocks (walked, dropped no more than a body takes at half its health, or stepped down through rock with a pickaxe), and eight or more cells of floor on the line toward the portal; said with the way down (steps, drops and their damage, rock dug, seconds), the floor on that line (floor to walk, rises, drops, lava on it, open air, wall, blocks to lay against those carried, the mobs by it) and the height back up to the portal |
| `blocks_then_cross` | root | mine netherrack for blocks here first, then cross straight at the portal at this height with them | in the Nether, a pickaxe carried, the block gather not resting, the crossing straight at the portal not resting from here, and its next stretch laying more blocks than are carried; said with the blocks it lays against those carried, the reserve mined, and the crossing with them (its cells, rock dug, blocks laid over air and over lava, seconds, and where it stops) |
| `boat_again` | root | the boat again, its failure or the walk chosen over it set aside | in the Overworld, the boat failed or was declined here and rests |
| `wait_rest` | root | other work until the staircase's rest ends, the minutes said | the staircase toward the portal rests until a time |

### `sculk_work`

**The work is within reach of sculk (a sensor that hears the bot, or a shrieker that calls a warden): carry on as now, carry on crouched, or take the work out of its reach?**

- When: Between work steps in the Overworld, with Jev reachable, when the bot is within a sculk sensor's hearing (eight blocks) or sixteen blocks of a shrieker that can call a warden; once per patch, the answer held five minutes.
- Decision tree, choice; stakes high; ledger kind `upkeep`
- Bar: none: Jev's pick is taken at any confidence: every answer is held only five minutes, so a close call is soon asked again, and the warden is not a rule code can weigh for it
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (sculkStep)
- Nothing left to try: the stall's question, as before (nothing above it)

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
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

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
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

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
- Nothing left to try: the stall's question, as before (nothing above it)

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
- Nothing left to try: the stall's question, as before (nothing above it)

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
- Nothing left to try: the stall's question, as before (nothing above it)

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
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

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
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `heading_(east\|south_east\|south\|south_west\|west\|north_west\|north\|north_east)` (pattern) | root | head this way | always; each says the biomes that way and how often this search went that way |

### `nether_gather`

**In the Nether, nothing of what the step mines is within reach: which way to get it, or go on without it?**

- When: A mine step in the Nether (wood for a tool, or any block the Nether has) with none of its blocks within reach where the bot stands; asked each time the search would have walked, the chosen way carried out to its end, and a way that came no nearer resting from that spot five minutes.
- Decision tree, choice; stakes medium; ledger kind `explore`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/nether-gather.js (netherGather, knownPlaces, wayTo, woodInReach), src/work.js (explore), src/nether-travel.js (surveyLeg, floorWay, walkFloorToward), src/bridging.js (surveyCrossing, spanBlockSources), src/nether-coverage.js
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `wood_in_view` | root | take the wood of any kind within reach here | wood is wanted and blocks of any wood (logs, stems, planks, the bot's own laid as cover among them) can be dug from ground walked to from here within twenty-four blocks; said with the kinds and counts, the nearest and the walk to it, about how long, the planks' worth against those carried, and what lies within reach but not to be dug from here now |
| `(walk\|cross\|floor)_to_[1-3]` (pattern) | root | go to this place it is known, this way | up to three places, nearest first: blocks of it in view within 128 or remembered, gathered by kind within twenty-four of each other, or for Nether wood a forest noticed or in the loaded ground where none of its stems is known; one option for each way that makes ground: on foot (the pathfinder's route all the way, or as far as it goes where that is eight or more blocks nearer), straight across at this height as far as the blocks carried take it (four or more nearer), and down to the floor and along it (a way down found and eight or more cells of floor); each said with every way there (the route, or where the walk ends and the crossing on from there with the blocks carried; the crossing's cells, rock to dig and with what, blocks to lay against those carried, where it ends and what stops it, the floor), and whether the bot has stood within 32 blocks of it; places with no way are said in the state as knownPlaces |
| `portal_trip` | root | go back through the portal to the Overworld for wood | wood is wanted, a nether portal is known, and the walk reaches it or the crossing with the blocks carried ends at it; said with the way, where it comes out and the wood remembered near there; otherwise said in the state as portal |
| `leg_(east\|south\|west\|north)` (pattern) | root | search this way, sixty-four blocks | one for each heading whose line at this height is not closed at its first cell (lava, rock with lava behind it, or open air with no block carried to lay; those are said as legsClosed); said with the cells ahead, the Nether forests that way at this height as far as loaded, and the ground unseen within 128 blocks of its line |
| `without` | root | go on without it: leave the rung it is for thirty minutes and go on with the ladder's next step | on the game ladder, with a rung in hand; said with what the wood is for, the rung (the errand and what it is for, where it is one) and what the ladder goes on with |

### `upkeep`

**Something the bot keeps in its pockets is running short (a pickaxe or a spare, wood, building blocks): see to it now, or carry on?**

- When: Between work steps, when no pickaxe is carried and the pockets make one with crafts alone; when a pickaxe is nearly worn or (on the game ladder) the uses carried fall short of the step in hand and the way home to open sky after it, with the makings of a spare carried; fewer than six logs' worth of wood are carried; in the Nether, fewer planks' worth than the pickaxe to make now and a spare want, with no pickaxe to be made or stems known within 128 blocks (note 658); or (on the game ladder) fewer than sixteen building blocks; not at night on the surface or in water. "Carry on" holds five minutes, unless the uses carried have since fallen short of the step and the way home (note 543).
- Decision tree, choice; stakes low; ledger kind `upkeep`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (upkeepStep)
- Nothing left to try: the stall's question, as before (nothing above it)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `make_pickaxe` | root | make a pickaxe now from what is carried, none being carried | no pickaxe is carried and the pockets as they are make one with crafts alone (iron from ingots, stone from cobblestone, blackstone or cobbled deepslate, wood from planks, with the sticks and a table from the wood carried); said with the best one they make, what it takes, its uses, and what digging by hand costs where the bot is (note 655) |
| `fetch_stems` | root | fetch stems from the Nether's forests now, and make the pickaxe from them where none is carried | in the Nether, the wood carried short of the planks' worth wanted for the pickaxe to make now (where none is carried) and a spare after it (two sticks each, a head of three iron ingots, cobblestone or blackstone carried, else three planks, and one crafting table), and either no pickaxe is carried and none can be made (then offered wherever the stems are, or with none known) or crimson or warped stems are known within 128 blocks; not while a fetch that gained nothing rests (ten minutes). Said with the planks wanted and for what, those carried and the stems short, the nearest stems known (how many, where, how far and which way, the forest's kind and what spawns there: hoglins and piglins in a crimson forest, endermen in a warped one, whose eyes every look is kept off), the mobs about it now, a half-second route survey, the next nearest, that a stem breaks by hand in about three seconds, and what the wood does later; with none known, that the gathering's search legs are asked. Taken, the stems are asked for as a mine step (in reach they are dug, and otherwise nether_gather asks the way), then the pickaxe is made (note 658) |
| `spare_pickaxe` | root | make a spare stone pickaxe now | every pickaxe carried has under twenty-four uses left, or on the game ladder their uses fall short of the step in hand and the way home after it, and cobblestone and sticks (or wood) are carried; said with the uses, the digs ahead and home, what the pockets make and the nearest wood known (note 543) |
| `wood_reserve` | root | cut a few logs now | on the game ladder, fewer than six logs' worth of wood carried, in the Overworld; said with the depth, the pickaxes' uses against the step in hand and the way home, and the nearest wood known; chosen underground, it is the climb for the wood chosen |
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

### `passing_gold`

**Gold is in reach of a Nether walk while pearls are short: a short detour to mine it, then the same walk on, or walk past?**

- When: A Nether walk that looks in passing (the fortress sweep, the return to the blazes, the warped search, the gather and portal walks, the way down, corpse runs) has gold within eight blocks that the rule does not take: past four blocks, gilded blackstone, or any gold while health is under 16 or food under 14. Asked at most every fifteen seconds. Nether gold ore and gold blocks within four blocks at full enough health and food are taken without asking.
- Batched question, choice; stakes low; ledger kind `mining`
- Bar: none
- Jev unreachable: no detour: an error or a five-second timeout is swallowed and the walk goes on
- Options built in: src/opportunistic-mining.js (mineInPassing)

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
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

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
- Nothing left to try: the stall's question, as before (nothing above it)

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
- Nothing left to try: the stall's question, as before (nothing above it)

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
| `tame_wolf` | root | tame a wolf | a wild adult wolf in view or seen within sixty-four blocks and remembered, and bones carried, fewer than two tamed |
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
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `differently` | root | keep at the stalled work another way | work stalled (not idle time): a mine leaves this patch of the resource, anything else turns its search |
| `set_aside_rung` | root | leave the stalled rung for thirty minutes | the stall is on a game-ladder rung that can wait (at the rung's question, any rung), and not one already set aside: a rung set aside is not the rung in hand, and its question is not asked while it waits (src/tried.js rungOf, note 600); at the rung's question brought by a failure below rather than its ten minutes, only once the rung's own questions below it have no way left untried from here, else said in setAsideNotOffered (note 605) |
| `take_up_[a-z_]+` (pattern) | root | take up a rung set aside earlier, its rest cut short | on the way to beating the game, a rung set aside and still resting that the ladder would take up now were its rest lifted (src/game-progress.js takeBackRungs), and what it was set aside for does not still stand from here (asideStands: within four blocks of where it was set aside, before the ways below come off rest or five minutes; said in stalled.takeUpNotOffered, note 600); said with why, when and from where it was set aside, the minutes its rest has left, where its work is (the rods' fortress) and what the ledger holds of it (note 588) |
| `pearls_(forest_[0-9]+\|search\|barter\|overworld\|nether)` (pattern) | root | another route to the ender pearls | the pearls are the rung in hand (src/pearl-routes.js): a warped forest known whose walk rests, taken up again; the sweep for another forest when it rests and no forest known is open; a barter walk toward a piglin, gold carried and none within thirty-two; back to the Overworld for its endermen, a portal remembered (held half an hour or until the pearls are carried); in the Overworld on that route, back to the Nether's forests. A route that is not real from here is said in stalled.pearlRoutesNotOffered with why (note 588) |
| `until_rest_ends` | root | other work until the rest ends, the minutes said, a choice that holds | every way to the stalled work rests until a time (WaysResting), or every way of the question below rests from here (an escalation: the minutes until the first comes off rest, the rung kept in hand, note 600); the same rest met again goes back to that work, not to the question (note 490) |
| `work_free` | root | work free of the terrain one move at a time | the bot is in water, under cover on the way up, or where every walk has failed (src/unstuck.js); each move is then Jev's (unstuck_move) |
| `night_mine` | root | dig a mine from here for the night | night in the Overworld, a pickaxe and nothing watching |
| `mine_nearby` | root | dig a useful ore in view | an ore within sixteen blocks with no lava beside it |
| `look_around` | root | walk twenty-four blocks somewhere new | by day in the Overworld, or when nothing else is on offer |
| `cross_toward` | root | tunnel or bridge straight toward where the stalled Nether work was going | in the Nether, a target known (the portal back, the fortress leg, the tunnel's end), and the cells ahead at this height let it come nearer: rock with no lava behind it, open air or lava to lay the blocks carried over (src/nether-travel.js) |
| `floor_toward` | root | go down to the floor below and walk a stretch of it toward where the stalled Nether work was going | in the Nether, a target known, ground four or more below under eight or more of the sixty-four columns round the bot, a way down to it found within thirty-two blocks, and eight or more cells of floor on the line toward the target; said with the way down, the floor on that line, the mobs by it with what fighting them all would cost at this health and whether health comes back (note 625) and the height back up (src/nether-travel.js) |
| `hoglin_food` | root | hunt a hoglin for porkchops | in the Nether, hungry with nothing to eat or on the way back for food, and a hoglin in view or seen within 192 blocks; said with how the day's hunts of a hoglin for its meat went (66 begun, none brought meat, note 625) |
| `return_for_food` | root | go back through the portal to the Overworld for food | in the Nether, hungry with nothing to eat or on the way back for food; said with the trip (its walk, the pace of the Nether walks measured, from sixty blocks, lava on the line, the hour it comes out at), the food known on the Overworld side and, while the choice to go on without it holds, when and at what health that was chosen (note 607) |
| `portal_here` | root | build a portal where the bot stands and go through | in the Nether on the way back (or hungry), ten obsidian, flint and steel or a fire charge, and three blocks for the lintel carried |
| `keep_on` | root | go on in the Nether without going back for food | in the Nether, hungry with nothing to eat or on the way back for food; the trip back is left out for twenty minutes; said, when Jev chose the trip back and it is what has stopped, that this ends it (note 625) |
| `restock_food` | root | get food here first: the ways to it asked next, each priced | in the Nether with under eight food points carried, or hunger under eighteen and health under twenty, and some way to food real from here (a hoglin known, mushrooms of both kinds in view, raw meat to cook, the trip back); said with why it is on offer, the stay the goal still wants against what is carried, and each way's yield (src/nether-food.js, note 639) |
| `cook_food` | root | cook the raw food carried | by day in the Overworld, and raw meat is carried |
| `stone_tools` | root | make stone tools | by day in the Overworld, and a stone pickaxe, axe or sword is missing |
| `stock_wood` | root | stock up to sixteen logs | by day in the Overworld, and fewer than sixteen logs are carried and a tree is in view |
| `explore` | root | explore the nearest unexplored area | by day in the Overworld, and in the Overworld, with an unexplored area within 512 blocks of home |
| `loot` | root | open the chests of a remembered structure | by day in the Overworld, and in the Overworld, with a ruined portal, dungeon, temple or mineshaft within 256 blocks whose chests are unopened |
| `earn_xp` | root | smelt raw ore for experience | by day in the Overworld, and eight or more of a raw ore are carried, gear is still unenchanted and the experience level is under thirty |
| `enchant` | root | enchant gear at the enchanting table | by day in the Overworld, and a table is carried, in view or remembered, lapis is carried, the experience level is five or more, and gear is unenchanted |
| `trial_chambers` | root | an expedition to the trial chambers | by day in the Overworld, and in the Overworld with an iron pickaxe or better, healthy and fed |
| `tame_wolf` | root | tame a wolf | by day in the Overworld, and a wild adult wolf in view or seen within sixty-four blocks and remembered, and bones carried, fewer than two tamed |
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
| `again` | root | try the failed step again as it was | a step failed again and again (persist), and it does not rest in the ledger from here (src/tried.js): tried twice from here and come to nothing, it rests five minutes; only this answer puts the failed step back in hand |
| `recover_[0-9]+` (pattern) | root | a recovery move the code checked (gather footing, the surface, another standing spot, another source, down off a pillar) | a step failed again and again, and src/recovery-options.js found the move feasible from here (it was the separate recovery_action question, folded in here in note 571) |

## recovery

### `recovery_action`

**After repeated failure at a step, which offered recovery action is most likely to unblock the request?**

- When: Only when a caller asks the recovery adviser directly (RecoveryAdviser.suggest). The loop no longer asks it: a failure goes to one question, the stall's (work.js persist, answerStall), whose recover_ options are these same moves (note 571).
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
- Nothing left to try: the stall's question, as before (nothing above it)

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
- Nothing left to try: the stall's question, as before (nothing above it)

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
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `walk_\d+` (pattern) | root | walk this surveyed surface route | a surveyed route toward the Eye-indicated estimate |

### `fortress_approach`

**A Nether fortress is in view: which way should the bot go to it, or should it leave it and keep searching?**

- When: On the fortress search, when a fortress (two dozen or more of its bricks) is in view and the bot is not on its floors (at the height of a brick with room to stand on it, within six blocks), and again each time the way chosen ends no nearer; the way is to its nearest floor; the answer holds for the approach until it fails, five minutes at most. Also where a walk on foot to a place Jev chose failed (state.stretch says which: a stretch of the fortress's floors, or where blazes were seen): the way is then to that place, asked afresh for each, the failed walk among what failed, and leaving it (other_way) leaves that way, not the fortress.
- Decision tree, choice; stakes high; ledger kind `fortress`
- Bar: none: every way offered was surveyed and runs under the hard rules (a span laid crouched and never under a shooter's fire, no rock dug with lava behind it, no drop into lava, no swing or turn on a span); a way that fails is asked again with what failed, and the outage default is the order the code kept, a failed way passed over
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/mob-hunt.js (fortressApproaches, approachFortress, crossingOptions), src/bridging.js (surveyCrossing, crossAlong), src/fortress-map.js (crossing), src/nether-travel.js (crossingSays)
- Nothing left to try: asks `fortress_leg` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `walk_route` | root | walk the pathfinder's route to it, level with the bot first, then at the bricks' height | a pathfinder is at hand and its survey from here found a route or was not made (a survey that found none is said in the state as walkRoute, not offered); said with its surveyed route (cells, blocks it would place and dig, how many beside lava, how much nearer it ends) and that it walks upright |
| `descend` | root | dig straight down to the bricks below | the bricks are more than two blocks below and within twelve blocks across; said with the drop and that a drop too deep for the health or ending in lava is refused |
| `cross_level` | root | go straight at it at the height the bot stands, digging rock and laying a one-wide span | the cells ahead at this height let it come a block or more nearer (surveyCrossing); said with the cells, the blocks to lay against those carried, how many over lava, how much nearer it ends, what stops it, about how long, and the mobs in view |
| `blocks_then_cross` | root | mine netherrack for blocks here first, then go straight at it at the height the bot stands with them | in the Nether, the crossing straight at it at this height, surveyed to its end (up to 192 cells, ores dug as rock), comes a block or more nearer and lays more blocks than are carried, a pickaxe is carried or can be made from what is carried (the best head carried, iron, stone, else wooden), and blocks can be dug from ground walked to from here; said with the pickaxe (which one is made first, and from what, where none is carried, made before any digging: netherrack dug by hand drops nothing), the crossing to its end (blocks laid, how many over lava, rock dug, cells), the blocks carried, how many are mined (up to a stack) from how many to be had here and the seconds, the crossing with them (where it ends and what stops it, about how long), the fortress's floors or bricks from where it ends, the ghasts and blazes in sight, and the minutes in all |
| `pillar_up` | root | pillar straight up to the height of its floor overhead | its nearest floor is two or more blocks up and within twelve across, a column near the bot has no lava or water in or beside it, and blocks to lay are carried; said with the height, the blocks against those carried, how far across the floor is from the top, and the fall a push would be |
| `tunnel` | root | dig a staircase through the rock toward it | a staircase is at hand |
| `cover_lava` | root | cover the lava lying on the floor on the way along the ground, a block laid into each cell of it and walked on a block up | on the way to floors of the fortress seen unwalked, the way along the ground (fortress-map.js crossing) has lava lying on a floor; said with its cells (lava, rock, open air, floor), the blocks against those carried, the seconds, where the lava comes from (a source seen, or flowing down from above), and how many cells are beside lava and what a misstep into it costs |
| `scoop_lava` | root | scoop the lava on the way with the empty buckets carried, covering what is still lava when reached | as cover_lava, with empty buckets carried and lava sources among the cells on the way; said with how many are sources, that flowing lava cannot be scooped, and the rest as cover_lava |
| `dig_through` | root | dig through the rock filling the way along the ground (round the lava, where the way along the ground has lava on it) | on the way to floors of the fortress seen unwalked, a way along the ground digs natural rock (never with lava or water behind it); said with its cells, the blocks dug and the seconds with what is carried, and that netherrack dug by hand drops nothing |
| `span_round` | root | go round the lava along the ground, laying a one-wide span where there is no floor | as cover_lava, where the way round the lava digs nothing but crosses open air; said with its cells, the blocks against those carried and the seconds |
| `keep_searching` | root | leave this fortress for ten minutes and go on searching | on the way into a fortress (not a way on its floors); said with the legs so far, the minutes searching, and the legs from here that ended at once and rest, with why |
| `other_way` | root | leave this way for now: the place is set aside for ten minutes (not offered again until then), not the fortress, and the fortress's other ways are asked again | a way on the fortress's floors or to a place chosen from the search (where blazes were seen): state.stretch says which and why the walk failed |

### `fortress_visit`

**The bot is about to approach a Nether fortress (or go at blazes) for blaze rods, at the health and hunger it has: go in now, eat and heal first where that is possible, drink a fire resistance potion or barter for one first, go back for food, hunt a hoglin, or leave this fortress and search another?**

- When: On the fortress search, when a fortress in view is about to be approached (before fortress_approach asks the way in), and on a blaze hunt when blazes heard out of sight are about to be gone at; asked once per visit and held until the bot dies, its hunger falls two points, or its time is out (five minutes for going in, three for a wait, two for the trip back and the hunt); a wait ends when health is full or a mob comes, and the visit then goes on as chosen.
- Decision tree, choice; stakes high; ledger kind `fortress`
- Bar: none: every way offered is a real route the bot can run from here (a wait eats what is carried and stops when a mob comes; the trip back and the hoglin hunt are the ones leave_nether and the food answers run), none refuses a visit for health, and the outage default is to go in, as the code did before the question
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/fortress-visit.js (ask, options), src/mob-hunt.js (findFortressStep, huntObserved), src/blaze-record.js (rowSays)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `go_in` | root | go in now at this health and hunger | always; said with the health, hunger, food carried, and the played record's rows for the bot's health and hunger (fights begun there, the share that died and that brought a rod), as a day's record and not a forecast, and whether health comes back on the way |
| `heal_first` | root | eat what is carried and wait here until the health is full, then go on | health under twenty and health comes back (hunger 18 or more, or what is carried brings it there), or hunger under eighteen with food carried; said with the food, the seconds to full at the pace that applies, that standing still spends no hunger, and how the rows the record counts change if it works (fights begun in that row, not a trial of waiting); at most three minutes; a mob ends it |
| `go_back` | root | go back through the portal to the Overworld for food and come back fed | in the Nether, health cannot come back here (hunger under eighteen and what is carried does not bring it to eighteen) and the way back is at hand; said with the walk at the measured pace of 17 to 30 blocks a minute (minutes, not seconds), what became of the walks back that day, and the food known on the other side |
| `hoglin_hunt` | root | hunt a hoglin for its meat | in the Nether at hunger under eighteen with a hoglin in view or seen; said with the hoglin's drop and the fight at this health, the pillar stance's measured 0.1 health lost in 168 stances against hoglins with two deaths, and that none of the 66 hunts begun in the Nether brought meat (this hunt is on foot, not from a pillar) |
| `drink_fire_resistance` | root | drink a fire resistance potion carried (or throw a splash one at the feet), then go in | a fire resistance potion is carried and less than a minute of the effect is on; said with its length (three minutes, eight for the long kind) against the walk ahead, what it stops (a blaze's fireball, burning, lava) and does not (a blaze's swing, a ghast's blast), and how many are carried; the visit then goes on as go_in (src/fortress-visit.js fireOptions, note 656) |
| `barter_fire_resistance` | root | barter gold with the piglins about for a fire resistance potion first | in the Nether, no fire resistance potion carried and less than a minute of the effect on, gold to throw once a gold piece is worn (or boots makeable), and an adult piglin within thirty-two; said with the barter table's odds (16 in 469 a throw for a fire resistance potion or splash potion, about 29 ingots for one on the average, the chance with the gold carried), the pace (three piglins a round, about eight seconds each), that it stops at the first potion, and that the effect runs from when it is drunk; the visit is asked again after (src/bartering.js barterForFireResistance, note 656) |
| `leave_fortress` | root | leave this fortress for ten minutes and search for another | on an approach to a fortress in view; said with what it changes (neither health nor hunger) and gains (no rod) |

### `fortress_leg`

**Searching the Nether for a fortress: which way should the next leg go, should the bot first dig toward the heights fortresses stand at, or first get blocks to lay spans with?**

- When: On the fortress search, each time a leg begins: at the start, when the last leg reached its end, when a leg ended within eight blocks of where it began (its heading then rests from there), when the sweep turned for a leg that made no ground, and on a fortress's floors when the bot has walked all it can reach of what it has seen of it (the map: floors seen through open air, walked, and running on into unseen space).
- Decision tree, choice; stakes medium; ledger kind `fortress`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/mob-hunt.js (chooseLeg, findFortressStep), src/nether-travel.js (surveyLeg, legSays), src/nether-coverage.js (what has been seen and stood on), src/nether-regions.js (where fortresses can begin)
- Nothing left to try: asks `rung_progress` next up, with this one's failure said

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `leg_(east\|south\|west\|north)` (pattern) | root | go this way ninety-six blocks at the height the bot stands | one for each heading whose line at this height is not closed at its first cell (lava in the way, or rock with lava or water behind it, which no dig opens; those are said in the state as legsClosed, and with every heading closed or resting and nothing else to offer, the step says why each is closed); said with the cells ahead at this height (open air, how many of them over a drop of four or more, rock to dig at about six seconds a cell, and what stops it, rock with lava or water behind it among them), the cells with no floor against the blocks carried and where they run out, about how long, whether it is back the way the last leg came, how the last leg this way ended, kept on that heading, the ground within 128 blocks of its line unseen at fortress heights (and how much of that lies beside the stretches of the line in open air), how much of its line the bot has stood on, what seen before lies that way (where blazes were seen, a spawner, fortress bricks), and how far this way the bot leaves the region of 432 blocks it stands in and what is known of the region past it (a bastion or fortress seen, how much of it is seen: src/nether-regions.js) |
| `floor_(east\|south\|west\|north)` (pattern) | root | go down to the floor below and walk it this way ninety-six blocks, bridging only across the lava and open air on it | ground four or more below under eight or more of the sixty-four columns round the bot, a way down to it found within thirty-two blocks (walked, dropped no more than a body takes at half its health, or stepped down through rock with a pickaxe), and eight or more cells of floor this way from the foot of it; said with the way down (steps, drops and their damage, rock dug, seconds), the floor this way (floor to walk, rises, drops, lava on it, open air, wall, blocks to lay against those carried, the first cells, the mobs by it), how the last such leg this way ended, and the ground unseen that way, what seen before lies that way and the region it leads into, as for the level leg |
| `seek_fortress_height` | root | dig a staircase toward y 64 first, along the most open heading | the bot stands more than eight blocks above or below y 64 and a staircase is at hand; said with the height to make up and where fortresses stand |
| `restock_blocks` | root | dig, in one go, the blocks the longest leg short of them still needs from what can be dug on foot from here, then choose the leg again | a leg runs out of the blocks carried and some a span is laid with can be dug from ground walked to from here; said with how many (the need past those carried, as far as can be had here), the kinds, the nearest and the walk to it, about how long, the pickaxe (where none is carried, the best one whose head is carried made first, iron from three iron ingots, stone from cobblestone or blackstone, else wooden, and made before any digging, or that none can be: netherrack dug by hand drops nothing), what lies within sixteen blocks out of reach, and what the last restock gained |
| `make_pickaxe` | root | make a pickaxe here from what is carried, then choose the leg again | no pickaxe is carried and one can be made from what is carried (the best head carried: iron ingots, cobblestone or blackstone, else planks; the table and sticks from the wood carried); said with which pickaxe, from what, and that without it rock and netherrack dug by hand drop nothing and only the blocks carried can be laid |
| `fetch_stems` | root | fetch stems from the Nether's forests for a pickaxe, make it, then choose the leg again | no pickaxe is carried and none can be made for want of wood, not while a fetch that gained nothing rests; said as upkeep's fetch_stems: the planks wanted for the pickaxe and a spare against those carried, the nearest stems known with the forest's kind, what spawns there and a route survey, or that none is known and the gathering's legs are asked (note 658) |
| `blocks_then_cross` | root | mine netherrack for blocks here first, then go straight at the fortress in view with them | a fortress is in view and the bot is not on its floors, and the crossing straight at its nearest floor (else brick) is as fortress_approach offers it (blocks_then_cross); said as there, with the fortress's set-aside and, where Jev left the fortress from this spot with this way among its ways in, that (taken here it is carried out, not the ways in asked again) |
| `stay_in_fortress` | root | stay in the fortress and walk its corridors again for blazes for three minutes, the least lately walked first | the bot is on the fortress's floors, has walked every floor it has seen that it can reach running on into unseen space, and some floor it has walked is twelve or more steps off; said with the floors seen and walked, how far the floors joined to here run (a small room walked again is paced), the times asked there, the minutes there and the blazes seen near it |
| `wait_at_spawner` | root | wait by the spawner seen for three minutes, the hunt taking each blaze it makes | on the fortress's floors with nothing left to walk to, and a spawner has been seen through open air (never one behind a wall); said with where it is, whether floors seen join it to the bot and how many steps, how it makes blazes, and how the last wait there ended; the walk there is on foot, and where it finds no way the way there is asked once |
| `unwalked_[1-3]` (pattern) | root | go to the fortress's unwalked floors seen across a gap, on foot first, the way there asked where the walk finds none | on the fortress's floors with nothing left to walk to, and floors of it are seen that no floor seen joins to the bot; up to three, nearest first, each said with how far, how many floors and how many run on unseen, the way across along the ground (fortress-map.js crossing: the cells of lava lying on the floor to cover, rock to dig and open air to span, and the seconds; round the lava too, where there is a way round), else the nearest crossing in a straight line and what lies between, and how the last try ended |
| `back_to_fortress` | root | go back into the fortress in view that was left or set aside | two dozen or more fortress bricks are in view but left behind or set aside, except where the bot stands on the spot it was set aside from as nothing to walk to (from there the same look sets it aside again at once) or where Jev chose to leave it over its ways in (from there going back asks the same ways again); said in the state instead; said with when and why, how far the nearest is, and the blazes seen near it |
| `return_for_blocks` | root | go back through the portal to the Overworld for stone | a leg runs out of the blocks carried and the way back through the portal is at hand; said with the nearest portal known |
| `go_to_blazes_about` | root | go to the blazes about now, on foot first, the way there asked where the walk finds none | blazes the bot knows of now (in sight or heard through the walls) are within ninety-six blocks and more than twelve off, not where the busiest sighting was made in the last minute, and not at a place Jev left; said with how many, how many in sight, the nearest and how far, and how the last try at them ended |
| `go_to_blazes` | root | go to where blazes were seen, on foot first, the way there asked where the walk finds none | the hunt has seen blazes in this dimension more than twelve blocks from the bot; said with the busiest place, how many times and how lately, how many were in sight and how many heard through walls, the hunt's own walks back and how they ended, which way it lies and whether the bot has stood within 32 blocks of it (the one sign there is a walk there), and how the last try from the search ended; not a place Jev left (fortress_approach other_way) within its ten minutes |

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

**What does the speaker want done with Jev's dream: set one (a built-in one or one in the speaker's own words), ask, pause, resume, or clear?**

- When: A message routed as dream.
- Batched question, choice; stakes high; ledger kind `dream`
- Bar: 0.75: clearing the dream below 0.75 and setting one below 0.65 are confirmed in words first; the rest are reversible
- Jev unreachable: the request fails and the player is told "I'm having trouble thinking right now"
- Options built in: src/dream.js (resolveDream)

### `dream_text_fit`

**Are the words given as a dream one concrete thing the bot can do?**

- When: Setting a custom dream, after the operation is chosen.
- Batched question, choice; stakes low; ledger kind `dream`
- Bar: none
- Jev unreachable: the custom dream is not set and the player is told "I'm having trouble thinking right now"
- Options built in: src/dream.js (checkCustomText)

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

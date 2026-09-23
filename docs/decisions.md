# Every question Jev is asked

Generated from `src/decisions` by `node scripts/decisions-doc.js`. Do not edit by hand: change the definition and regenerate.

Each question is defined once: what it asks and when, what a wrong answer costs (stakes), the bar its answer must clear and what happens below it, what happens when Jev cannot be reached, and where its options are built. The decision trees also declare every option they can offer, and the runner checks each tree against that catalogue: an undeclared option fails the tests and is logged as a bug in play. Every tree is asked through one runner (`decide`) and every batched question through `ask`; nothing else in `src` calls the model.

60 questions: 12 decision trees and 48 batched questions.

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

**What should the bot handle next: the player's request, sleep, a shelter, or food (and which food)?**

- When: Each survival step when night is coming or food is short, unless one option is the only one (then it is taken without asking) or a chosen shelter or food top-up is still being carried out.
- Decision tree, choice; stakes high; ledger kind `survival`
- Bar: 0.2 at every level of the tree: a coin flip between the night, food and the request goes to the safety order, not to whichever side edged it
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (step: the tree), src/foraging.js (forageChoices: the food options)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `continue_request` | root | carry on with the request | it is not night, or it is night and the bot is armed, armoured and has a bed to fall back on (stay up) |
| `sleep_in_bed` | root | sleep in a bed | bedtime, a bed is carried (with room to place it) or one is in reach, and no mob within ten blocks |
| `secure_shelter` | root | seal a shelter for the night | night is coming and no bed is on offer |
| `obtain_food` | root | get food | food carried is under the reserve and hunger or a stock top-up calls for it (not at night when shelter is needed) |
| `cook_[a-z_]+` (pattern) | obtain_food | cook a carried ingredient | raw food and fuel are carried; the output is safe food |
| `prepare_hunting_sword` | obtain_food | make a wooden sword to hunt with | animals are in view and no weapon is carried |
| `hunt_\d+` (pattern) | obtain_food | hunt this animal | an adult food animal in view is reachable on safe surface ground |
| `go_home_for_food` | obtain_food | walk home and eat from its stores | the base has bread, ripe wheat or a cow to spare within reach |
| `village_food` | obtain_food | take ripe crops and hay from a remembered village | a village with crops or hay is remembered within reach |
| `search_food` | obtain_food | walk to another dry area to look for animals | none of the other food options is feasible |
| `return_for_food` | obtain_food | go back through the portal for food | off the Overworld, where nothing is safe to eat |

## combat

### `ranged_response`

**A mob that shoots is in clear view at bow range: shoot it, run for cover, or dig in?**

- When: A shooting mob is in clear view at bow range, a bow and arrows are carried, health is eight or more and no melee mob is within three blocks.
- Decision tree, choice; stakes high; ledger kind `survival`
- Bar: 0.2 at every level of the tree: unsure, the health rule decides: shoot while healthy, otherwise retreat
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/survival.js (rangedChoice)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `shoot_\d+` (pattern) | root | shoot this mob | it is in clear view with a solved arrow path (up to three targets) |
| `retreat` | root | run for cover out of its sight | always |
| `dig_in` | root | seal a two-block pocket here | twelve or more building blocks are carried |

### `encounter_stance`

**Hostile mobs are on the bot: fight here, go up, dig into the wall, seal in, run, or shoot?**

- When: An encounter the reflexes (the swing at arm's length, a shield against an arrow in flight, off a ledge) have not settled, with two or more stances possible; held while the same kinds of mob are about, for fifteen seconds, and until health falls by six. Only with JEV_ENCOUNTERS=1.
- Decision tree, choice; stakes high; ledger kind `combat`
- Bar: 0.35 at every level of the tree: unsure, the encounter rules decide as they did before the experiment
- Jev unreachable: stops: no safe default
- Options built in: src/survival.js (stanceOptions)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `fight` | root | fight where the bot stands | a sword, axe or trident is carried and health is eight or more |
| `pillar` | root | go two blocks up and fight from there | two scaffold blocks carried and three clear blocks overhead |
| `bunker` | root | dig into the nearby wall and fight at the doorway | a wall is near and health is ten or more |
| `seal` | root | seal a pocket and wait | four or more building blocks are carried |
| `retreat` | root | run for footing out of reach and sight | always |
| `shoot_\d+` (pattern) | root | shoot this mob with the bow | health eight or more, nothing that bites within three blocks, and a clear arrow path (up to two targets) |

### `hunt_target`

**The request needs a mob's drop: which observed mob should the bot fight now, or leave them for now?**

- When: A mob hunt step with at least one candidate that passed the fight-readiness and isolation checks.
- Decision tree, choice; stakes high; ledger kind `combat`
- Bar: none: every target offered already passed canBegin and isolated; a close call between fighting and leaving it is a preference, and the outage default is the same nearest target
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/mob-hunt.js (huntObserved)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `hunt_\d+` (pattern) | root | fight this mob | observed, reachable, isolated from others of its kind, and the bot fit to fight |
| `defer` | root | leave them for now | always |

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

### `opportunistic_ore`

**An ore is within six blocks along the way: take a short detour for it, or carry on?**

- When: Every third mining or tunnelling step with a useful ore in reach (coal while fuel is short, and nether gold while pearls are short, are taken by rule without asking).
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
| `fetch_cache` | root | fetch the things left in a field cache | a full field cache between 48 and 512 blocks away |
| `deep_dark` | root | an expedition to the deep dark | in the Overworld with an iron pickaxe or better, healthy and fed, no warden rest, and no city already done |
| `trade` | root | trade at a remembered village | a village is remembered within 256 blocks and emeralds or spare items to sell are carried |
| `torches` | root | craft torches | coal is carried and fewer than eight torches |
| `harvest_and_bake` | root | harvest the home plot and bake bread | wheat on the home plot is ripe |
| `tend_farm` | root | tend the home plot | the home plot needs tilling, planting or a look |
| `breed_cows` | root | breed the cows in the home pen | two adult cows are penned and wheat is carried |
| `lure_cows` | root | lead loose cows into the home pen | the pen has fewer than two cows and cows are in view |
| `stock_stash` | root | put spares in the stash chest | the stash chest is within reach and spares are carried |
| `long_game` | root | work toward beating the game | the dream is to beat the game and its ladder is not complete |

### `stillness_detour`

**The bot has stood still twenty seconds: what useful thing should it do from here for a few minutes?**

- When: Twenty seconds without movement, digging, pickup, fighting or healing, outside a permitted wait; a single option is taken without asking.
- Decision tree, choice; stakes low; ledger kind `idle`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/work.js (breakStillness), src/stillness.js (the rule)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `night_mine` | root | dig a mine from here for the night | night in the Overworld, a pickaxe, health ten or more and nothing watching |
| `mine_nearby` | root | dig a useful ore in view | an ore within sixteen blocks with no lava beside it |
| `look_around` | root | walk twenty-four blocks somewhere new | by day in the Overworld |
| `cook_food` | root | cook the raw food carried | by day in the Overworld, and raw meat is carried |
| `stone_tools` | root | make stone tools | by day in the Overworld, and a stone pickaxe, axe or sword is missing |
| `stock_wood` | root | stock up to sixteen logs | by day in the Overworld, and fewer than sixteen logs are carried and a tree is in view |
| `explore` | root | explore the nearest unexplored area | by day in the Overworld, and in the Overworld, with an unexplored area within 512 blocks of home |
| `loot` | root | open the chests of a remembered structure | by day in the Overworld, and in the Overworld, with a ruined portal, dungeon, temple or mineshaft within 256 blocks whose chests are unopened |
| `earn_xp` | root | smelt raw ore for experience | by day in the Overworld, and eight or more of a raw ore are carried, gear is still unenchanted and the experience level is under thirty |
| `enchant` | root | enchant gear at the enchanting table | by day in the Overworld, and a table is carried, in view or remembered, lapis is carried, the experience level is five or more, and gear is unenchanted |
| `trial_chambers` | root | an expedition to the trial chambers | by day in the Overworld, and in the Overworld with an iron pickaxe or better, healthy and fed |
| `fetch_cache` | root | fetch the things left in a field cache | by day in the Overworld, and a full field cache between 48 and 512 blocks away |
| `deep_dark` | root | an expedition to the deep dark | by day in the Overworld, and in the Overworld with an iron pickaxe or better, healthy and fed, no warden rest, and no city already done |
| `trade` | root | trade at a remembered village | by day in the Overworld, and a village is remembered within 256 blocks and emeralds or spare items to sell are carried |
| `torches` | root | craft torches | by day in the Overworld, and coal is carried and fewer than eight torches |
| `harvest_and_bake` | root | harvest the home plot and bake bread | by day in the Overworld, and wheat on the home plot is ripe |
| `tend_farm` | root | tend the home plot | by day in the Overworld, and the home plot needs tilling, planting or a look |
| `breed_cows` | root | breed the cows in the home pen | by day in the Overworld, and two adult cows are penned and wheat is carried |
| `lure_cows` | root | lead loose cows into the home pen | by day in the Overworld, and the pen has fewer than two cows and cows are in view |
| `stock_stash` | root | put spares in the stash chest | by day in the Overworld, and the stash chest is within reach and spares are carried |

## strategy

### `win_strategy`

**On the way to beating the game, which of the open steps, or which side trip, should the bot do next?**

- When: Each step of the beat-the-game ladder in the Overworld while more than one thing is open; the answer holds until the ladder's next step or the options change, or ten minutes pass. A side trip runs once and then rests ten minutes.
- Decision tree, choice; stakes medium; ledger kind `strategy`
- Bar: none
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/strategy.js (strategyOptions), src/game-progress.js (openRungs), src/work.js (sideTrips)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `stage_[a-z_]+` (pattern) | root | the ladder's later stage | past the preparation ladder in the Overworld (pearls, the crossing, the stronghold): the fallback |
| `deep_dark` | root | an expedition to the deep dark | in the Overworld with an iron pickaxe or better, health sixteen and hunger fourteen or more, no warden rest, and no city already done |
| `trial_chambers` | root | an expedition to the trial chambers | in the Overworld with an iron pickaxe or better, healthy and fed, and the chambers not already done |
| `explore` | root | explore the nearest unexplored area | in the Overworld with an unexplored area within 512 blocks of home |
| `fetch_cache` | root | fetch the things left in a field cache | a chest left before an earlier trip, full, between 48 and 512 blocks away |
| `rung_[a-z_]+` (pattern) | root | a rung of the ladder | the ladder's next rung (the fallback), and each rung after it the ladder may reach while the ones before it wait (shield, iron sword, bucket, golden boots, bow, arrows, diamond sword); pickaxes and armour are never skipped |
| `loot` | root | open the chests of a remembered structure | by day, health fourteen or more and hunger twelve or more, with an unlooted ruined portal, dungeon, temple or mineshaft within 256 blocks |
| `trade` | root | trade at a remembered village | by day and fit, with a village remembered and something to sell or spend |
| `enchant` | root | enchant gear at the enchanting table | by day and fit, with a table known, lapis carried, level five or more and gear unenchanted |

## recovery

### `recovery_action`

**After repeated failure at a step, which offered recovery action is most likely to unblock the request?**

- When: The same step has failed three times, or a failure was Blocked.
- Batched question, choice; stakes medium; ledger kind `recovery`
- Bar: 0.6: unsure, or none, nothing is done from the advice
- Jev unreachable: the failure goes on to persist (a clean slate and a backoff)
- Options built in: src/recovery-options.js (the options), src/recovery-adviser.js (askJev)

## endgame

### `dragon_fight`

**In the Ender Dragon fight, what is the most useful action now?**

- When: Each step of the dragon fight in the End.
- Decision tree, choice; stakes high; ledger kind `end`
- Bar: 0.2 at every level of the tree: unsure, the fixed order decides: out of danger, crystals, head, arrow, position
- Jev unreachable: the code's own order walks the tree (recorded as a code default, and said once in chat)
- Options built in: src/end-combat.js (fightEndStep)

| Option | Level | What it is | Offered when |
| --- | --- | --- | --- |
| `crystal_\d+` (pattern) | root | shoot this healing crystal | in view with a solved arrow path and not missed repeatedly |
| `shoot_dragon` | root | shoot the flying dragon | a bow, arrows and a clear trajectory |
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

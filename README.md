# JevBot

A local Mineflayer bot that uses TypeSafe's Jev to interpret Minecraft chat, resolve items through a dynamic catalog hierarchy, and choose ongoing actions. Ordinary code executes and verifies survival tasks. Jev can connect through TypeSafe or OpenRouter. An optional OpenRouter LLM generates custom building schematics and advises on recovery when Jev gets stuck.

The broader target is a survival companion that can obtain food and shelter, maintain tools, avoid hazards, and follow player requests on Normal difficulty. See `GOAL.md` for the acceptance criteria. House construction and two full day/night cycles have passed on Normal difficulty; the complete survival acceptance remains unfinished.

Available requests include `Jev come here`, `Jev follow me`, `Jev craft a chest`, `Jev make eight birch stairs`, `Jev get me a pumpkin`, and `Jev build a mansion out of cherry`. Item routing covers the full Minecraft 26.1 catalog. Acquisition expands the selected item's crafting, smelting, tool, and block-drop dependencies; catalog recognition does not mean every item is obtainable yet. Shears are planned for grass plants; intact grass blocks require an existing Silk Touch tool. Enchanting, farming and trading are not implemented.

The original development targets remain:

- `build a house`: a 5×5 shelter with 96 floor, wall and roof blocks, an open doorway, and clear interior.
- `get me 32 purple concrete`: gather ingredients, craft dye and powder, harden it in water, collect the concrete, and confirm pickup by the requesting player.
- `find a way to the Nether`: use an existing portal or acquire a frame and ignition materials, build a portal, and verify entry into the Nether.

These workflows are **under live testing**. A house has passed in a natural world. Gathering and delivering 32 concrete blocks, plus constructing and entering a Nether portal, have passed in a prepared resource world. Natural-world concrete and Nether runs remain incomplete. See `PROGRESS.md` for evidence and remaining work.

## Join and watch locally

Open **Minecraft Java Edition 26.1**, choose **Multiplayer → Direct Connection**, and enter one of these addresses on the machine running the servers:

| Address | World |
| --- | --- |
| `localhost:25570` | Player world: fresh natural terrain, Survival mode with Peaceful difficulty, with interactive **Jev** |
| `localhost:25567` | Flat survival test world with prepared resources; used for current mechanics trials |
| `localhost:25566` | Natural survival world, seed 12345; the completed house is at X 83, Y 136, Z −32 |
| `localhost:25565` | Original development server |
| `localhost:25568` | Fresh natural world on Normal difficulty, seed 95812; a verified house is at X −7, Y 67, Z 3 |
| `localhost:25569` | Isolated Normal-difficulty endurance trials; separate from the player world |
| `localhost:25571` | Isolated natural Normal concrete-delivery trial |
| `localhost:25572` | Isolated natural Normal Nether-progression trial |

Press **F3** to see your coordinates, and **Tab** to see online players. Acceptance bots are named `Trial<run-id>` and leave when their trial ends. They execute their assigned test and do not accept chat commands. Trial logs and checkpoints are in `artifacts/<run-id>/events.jsonl` and `goal.json`.

To run the interactive bot in the player world, use:

```sh
MC_HOST=127.0.0.1 MC_PORT=25570 MC_VERSION=26.1 MC_USERNAME=Jev npm start
```

Then send `Jev come here`, `Jev follow me`, `Jev craft a chest`, `Jev get me a pumpkin`, `Jev build a house`, `Jev get me 32 purple concrete`, or `Jev find a way to the Nether` in game chat. Use `Jev status`, `Jev stop`, and `Jev resume` to inspect or control its task. The nickname `Jev` works regardless of the bot's Minecraft username; addressing its full username also works. Keep the terminal open to see each action, position, and blocker. Concrete delivery requires the requesting player to be nearby and able to pick up the items.

The test servers bind to localhost, so these addresses work on this computer. World files are local and excluded from Git; cloning this repository does not start a Minecraft server.

## Run

```sh
npm install
cp .env.example .env
# Set TYPESAFE_API_KEY or OPENROUTER_API_KEY, plus Minecraft connection settings.
npm start
```

Use Node 22 or newer, as required by Mineflayer. The local servers run Minecraft 26.1. Credentials stay in `.env`. Say the bot's name before a request if other players are chatting.

`stop` cancels the active task and pauses autonomous movement between requests, including while a reconnect is loading the world. `status` reports the task or current survival action. `resume` retries saved progress, or reactivates idle survival if no task remains. A new supported request replaces the old one after its current action has stopped. Running tasks automatically resume after a disconnect or process restart; cancelled or blocked tasks require `resume`. Connections retry with a bounded backoff; explicitly shutting down the process stops retries.

After death, Jev respawns through a fresh connection and replans from actual inventory. It can retrieve matching drops at a nearby, loaded death location via an observed route without digging, scaffolding, water crossings, or known hostiles. Retrieval is bounded to five attempts/30 seconds within the five-minute drop window, and defers to immediate survival needs. Three deaths within ten minutes pause work for an explicit `resume`. A controlled live trial verified retrieval and resumption; this does not establish safe recovery through hostile terrain or from distant deaths.

When three consecutive attempts fail without progress, or the executor reaches a concrete blocker, Jev can ask `anthropic/claude-fable-5.1` for help through OpenRouter. The adviser sees the original request, current inventory/tool durability, nearby terrain and threats, recipe alternatives, failed routes and recent attempts. It selects up to three executable recovery options: gather useful supplies or observed alternative ingredients, approach from a reachable nearby position, choose another supported shelter site, or return toward the surface. Jev checks and executes those steps, then resumes the same objective; ordinary world/inventory verification still determines success.

This is enabled automatically with `OPENROUTER_API_KEY`; `RECOVERY_ADVISER=off` disables it and `OPENROUTER_RECOVERY_MODEL` overrides the model. Without a key, normal Jev decisions, bounded retries and honest blockers continue. Advice has a 45-second request timeout, a one-minute call cooldown, at most two calls for the same failure and six per saved goal. Plans expire after five minutes; each action gets at most twelve execution steps/two minutes. Stop, air loss and nearby threats interrupt the adviser. Death, dimension changes, changed requests and stale positions invalidate plans. The saved goal's `recoveryAdvice` records observations, selected actions, model usage and outcomes; credentials are never written there. LLM advice cannot issue operator commands or arbitrary code. Recovery is limited to implemented actions, so an accurate diagnosis can still end in a concrete blocker. A controlled trial with three injected navigation failures passed a real Fable call, two real repositioning actions, and the retained “come here” objective at full health. A retained natural flooded-shaft diagnostic received useful advice but still failed its staircase escape; that is not a successful recovery claim.


State is stored under `.bot-state/`, separately for each server and bot identity. House coordinates are fixed once selected. Completion comes from world/inventory checks, never solely from a model's opinion.

In Creative mode, Jev takes requested items and building materials directly from the Creative inventory, preserves existing inventory slots, and confirms server inventory updates. Item delivery still checks actual recipient pickup. This path is gated by the bot's server-reported Creative mode and is unavailable in Survival. Normal walking/following is supported; following a player through the air is not implemented.

## Building designer

Describe a structure in chat, for example `Jev build a compact cherry mansion with two floors and big windows`. Jev routes the request to the building tool. A simple `Jev build a house` keeps the existing 5×5 shelter workflow; `make two beds` remains an inventory recipe request.

With `OPENROUTER_API_KEY` set, the designer uses `anthropic/claude-fable-5.1` by default (`OPENROUTER_BUILD_MODEL` overrides it). It receives the request, nearby ground survey, game mode, dimension, inventory, supported block palette and construction limits. It returns cuboid regions describing a schematic. Code checks dimensions, palette, grounded connectivity, entrance, stair headroom and interior floor access before selecting a site. An invalid draft gets one repair attempt with the validation error.

OpenRouter is optional. In the default `BUILD_DESIGNER=auto` mode, a missing key or two failed designer attempts selects a Jev template fallback. Jev chooses a cottage, mansion or tower, one to three floors, size and a material through the actual block catalog. Code assembles a stepped roof, windows, entrance and accessible stairs. The bot announces this fallback and reports a blocker for unsupported shapes instead of silently substituting a different structure. Set `BUILD_DESIGNER=jev` to always use templates, or `openrouter` to require a generated design.

Designs, material lists, site coordinates and progress are saved with the goal. Resume reuses the saved schematic and checks actual blocks; it does not generate a new design. Jev chooses gathering, clearing and placement work. Survival obtains materials through the existing dependencies; Creative uses the Creative inventory. Building never autonomously invokes `/fill`, `/give` or another operator command. An unexpected block added to the surveyed work area stops construction for inspection.

Current generated-design limits are 25×16×25, 256 regions, 16 palette entries and 6,000 solid blocks. The supported palette contains full cubes; oriented stairs/doors, fluids, gravity blocks and redstone behavior are outside this executor. It requires a loaded, dry site with a supported entrance and at most three blocks of ground variation. Large builds and rare Survival materials can still encounter movement or acquisition blockers. Custom designs do not yet become remembered survival shelters. A controlled Creative trial completed an 865-block Fable-designed cherry mansion; a fresh connection verified every block/opening and walked both floors without digging or scaffolding. This is construction evidence, not proof of gathering a mansion’s materials in Survival.

Jev remains a decision model through either provider. `JEV_PROVIDER=openrouter` uses the OpenRouter Decisions API with `typesafe/jev-1.13`; this is separate from the generative designer. If no provider is specified, an existing TypeSafe key takes precedence, otherwise the OpenRouter key is used for Jev.

## Requested operator commands

The player world enables command blocks and gives Jev operator level 4. `MC_COMMAND_USERS` lists the player names allowed to request operator commands (currently DoloresDoodle in the local configuration). An empty list disables this entry point.

- `Jev get me a command block` uses the Creative inventory and ordinary verified delivery.
- `Jev please make it daytime`, `Jev stop the rain`, or `Jev set the difficulty to peaceful` change world settings.
- `Jev teleport me to you` moves the speaker to Jev; `Jev teleport yourself to me` moves Jev to the speaker.
- `Jev put me in Creative`, `Jev summon a cow at my position`, and `Jev enable keep inventory when we die` are also classified from natural language.
- Exact commands remain available with `Jev run /...`, for example `Jev run /time query daytime`. They execute as Jev, so `@s` and relative coordinates refer to Jev.

`src/command-classifier.js` builds nested Jev choices from the actual server command tree, then selects typed arguments from server completions, the item catalog, online players, observed positions, and values present in the request. The current 26.1 operator catalog exposes 90 root commands. A final semantic check compares the assembled command with the request before dispatch. This is selection and validation, with no generated command text. Complex free-form NBT/JSON or missing arguments may require an exact command; catalog coverage does not mean every phrasing or argument form is understood.

Commands require a fresh player-chat event from an allowed sender. They are unavailable to the autonomous planner, and ordinary bot speech cannot send slash commands. Commands pause active work, append the request, classification judgments, and dispatch record to `.bot-state/<identity>-commands.jsonl`, and are never replayed by resume, restart, or failure recovery. Server replies are relayed when received. Ask a new command explicitly to run it again. Operator permissions do not make normal gathering/building switch to commands on its own.

## Execution

`src/objectives.js` batches independent Jev questions for outcome, quantity, delivery, and player target. Quantity options come from numbers/phrases actually present in the request. `src/catalog.js` builds nested choices from all 1,506 registry items, with lexical hints and bounded category/family/variant branches. Jev traverses those choices; there is no fixed item-command whitelist. `src/knowledge.js` expands 887 craftable outputs and 61 smeltable outputs from the server's recipe and loot data in `data/vanilla-26.1.json`, including ingredient alternatives, harvest tools, and special drops. Regenerate it with `python3 scripts/extract-knowledge.py <inner-server-26.1.jar>`. Known recipes and arithmetic stay in code. Jev selects among feasible observed resource targets, with recorded decisions and stale-state checks.

`src/plan.js` resolves material, crafting, smelting and tool dependencies. Ingredients are reserved while expanding recipes so shared dependencies cannot spend the same materials twice. Recipes are checked against installed Minecraft data in tests.

`src/work.js` repeatedly observes inventory and executes the next missing dependency. It records failed mining coordinates, explores with a persistent search history, uses bounded navigation, and saves progress after actions. Failures produce a concrete blocker; five consecutive execution errors or an exhausted search stop the task for inspection.

Crafting executes one recipe at a time and reconciles the server inventory, cursor, and unused grid ingredients before replanning. The 26.1 client can optimistically report several outputs before server reconciliation; only verified inventory satisfies a dependency.

House building uses nested Jev choices through `src/decisions.js`: current priority → subtask → bounded action. Options include site selection, resource targets, clearing, and placement. Conditional branch questions are batched, unavailable options are rejected, and changed observations discard stale answers. Logs and saved state contain the observed state, options, selected path, probabilities, latency, and token usage; “Jev status” shows the latest path.

`src/survival.js` preserves the player request while preparing shelter or food. Jev chooses between work, shelter, and observed food targets; at night, ordinary outdoor work waits for shelter. Code handles immediate air, eating, and threat interruptions; an exposed hostile interrupts mining/navigation and triggers a bounded escape. Ordinary route planning, ore selection and staircase excavation keep distance from observed hostiles, while allowing retreat if a mob has already approached. Route feasibility checks continue partial searches within their deadline rather than treating the first time slice as failure. Completed houses become remembered refuges: Jev can temporarily seal their two-block doorway and reopen it on exit. Small emergency shelters remain available when no home is nearby. Both paths verify the enclosure and exit. Shelter material counts are checked again after navigation, which can spend scaffolding or alter natural walls.

Between requests the same controller maintains a food reserve and seeks shelter on hostile difficulties. On Peaceful it waits nearby unless a real survival need arises. Food collection hunts observed cows, pigs, sheep, or chickens, remembers failed targets, and verifies actual ingredient pickup. Raw chicken never counts as edible reserve. Cooking choices come from the server's smelting catalog and carried ingredients; the existing dependency planner obtains missing tools, furnace materials, and fuel. Jev selects among cooking and observed hunting targets. Surface food routes inspect loaded columns, permit natural tree canopies, exclude underground destinations and paths, and prohibit cave excavation during search and pursuit while permitting carried scaffolding.

A controlled Normal test started empty, hunted chickens, gathered wood/stone, crafted a pickaxe and furnace, cooked the chicken, and ate one to restore hunger from 16 to 20 at full health. Its prepared terrain and externally induced hunger make it mechanics evidence. A separate uninterrupted natural Normal trial has now built its house, hunted/cooked food and survived two full cycles by returning to shelter both nights. Natural eating/healing has since been observed in a resumed Normal diagnostic; natural tool replacement, broader farming, and reliable hostile-cave travel still need validation. Nether task sequencing and the legacy concrete checkpoint path remain deterministic; new item requests use the catalog planner.

New work requires an explicit “Jev …” or login-name prefix. This prevents other bots' acknowledgements from becoming commands. Short stop, cancel, status, and resume controls also work without a prefix.

Jev classifies item recipients separately: “craft me a chest” requests delivery, while “craft a chest,” “collect lapis for yourself,” and “get eight blocks and keep them” leave the output in its inventory.

Resource expeditions carry spare wood, a stone-or-better pickaxe, and a portable crafting table. Outside Peaceful mode, preparation also requires a safe food reserve of 12 hunger points before descending, even at full hunger. Catalog item requests prepare these supplies when a recipe needs underground resources beyond immediate digging reach; ordinary surface pickups keep their direct path. Unobserved crafted objects are not treated as raw resource deposits: an obsidian plan must obtain a diamond pickaxe instead of searching for ender chests. `src/tunneling.js` excavates supported staircase steps and rejects liquids, missing footing, and protected building foundations. Navigation limits drops, avoids digging straight down, and waits for landing before another action. Shelter material gathering stays at the site's surface elevation and protects its approach. If positioning spends a selected shelter material, sealing rechecks the remaining shell and chooses from the actual remaining stock.

`src/compatibility.js` contains application-side workarounds for mining-speed tags, named difficulty packets in 26.1, pathfinder results that otherwise share mutable search nodes, nearby animals incorrectly overwriting the player's oxygen reading, and player collision dimensions. Collision dimensions now match Minecraft's float precision, preventing tiny wall overlaps that caused repeated server corrections and blocked jumping. Navigation can recover once from an already stuck position by walking toward the center of an inspected solid floor cell, within its original deadline. A retained-world diagnostic reproduced the old bug, verified recovery, and repeated the route without corrections at full health. Low air interrupts work and triggers a swimming route back to breathable air. Three controlled dives passed without damage; broad underwater exploration remains unproven. Installed dependency files remain unmodified.

`src/agent.js`, `src/act.js`, and much of `src/skills.js` contain the earlier experimental flat action loop. They remain available for comparison, but `index.js` now runs the verified objective executor. Other free-form commands from the experimental loop are not currently routed by the new entry point.

## Tests

```sh
npm test
npm run plan
node scripts/eval-intents.js
node scripts/eval-decisions.js
node scripts/eval-survival.js
JEV_PROVIDER=openrouter node scripts/eval-intents.js
MC_PORT=25567 node scripts/designer-test.js
# Separate controlled recovery test; apply its printed setup, then create setup-ready.
MC_PORT=25567 node scripts/recovery-adviser-test.js
# Add DESIGN_BUILD=1 for the controlled Creative fixture; perform its printed setup first.
MC_HOST=127.0.0.1 MC_PORT=25567 node scripts/commands-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 node scripts/creative-house-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 node scripts/movement-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 node scripts/tool-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 node scripts/recovery-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 node scripts/expedition-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 EXPEDITION_FOOD=1 EXPEDITION_SITE=1000 node scripts/expedition-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 node scripts/recipe-alternative-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 node scripts/hostile-route-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 COOK_SITE=800 node scripts/cooking-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 ACCEPT_SCENARIO=controlled node scripts/shelter-test.js
MC_HOST=127.0.0.1 MC_PORT=25567 ACCEPT_SCENARIO=controlled node scripts/food-test.js
MC_HOST=127.0.0.1 MC_PORT=25566 MC_VERSION=26.1 npm run accept -- build a house
MC_HOST=127.0.0.1 MC_PORT=25566 MC_VERSION=26.1 npm run accept -- get me 32 purple concrete
MC_HOST=127.0.0.1 MC_PORT=25566 MC_VERSION=26.1 npm run accept -- find a way to the Nether
```

The acceptance runner joins with a new player identity, checks that its inventory is empty and its mode is survival, interprets the actual request through Jev, and records events plus the saved goal under `artifacts/<run-id>/`. It never grants items, teleports, or changes game mode. The default deadline is 30 minutes (`ACCEPT_TIMEOUT_MS` overrides it).

The separate tool-mechanics test gathers ingredients, crafts a wooden pickaxe, repeatedly mines/reuses cobblestone, and verifies replacement before breakage. It passed on prepared Survival/Peaceful terrain: the old tool retained 52 uses and the replacement acquired its first use. For a crowded fixture, an optional initially nonexistent `TOOL_SETUP_FILE` makes the test wait after printing its username; prepare a clear starting location, record any console setup, then create that file. The recorded passing trial used a setup teleport, so it is controlled debugging rather than Normal survival acceptance.

The separate operator-command test prints its temporary identities and setup file. On an isolated fixture, grant those identities OP, set the bot to Creative and time to night, then create the printed setup file. It verifies requested commands and observed effects, impersonation rejection, ordinary item delivery, and restart without command replay. Remove the temporary OP roles afterward. `scripts/eval-commands.js` additionally checks ten natural-language requests against a read-only command-catalog connection named TreeProbe on port 25567, which needs temporary OP to see the full tree; it never dispatches the inferred commands.

Set `ACCEPT_CYCLES=2` on a fresh Normal trial to continue autonomous survival after the useful request completes. Success then also requires 48,000 uninterrupted world ticks since the initial empty-inventory observation. The runner rejects resumed cycle trials and records death or other failures. This mode has a 55-minute default deadline.

`scripts/recovery-test.js` separately exercises the real chat entry point. Its printed setup uses an isolated fixture's console to position test players and logs, kick the bot, and inject death. It verifies crafting, automatic reconnect, persistent stop across reconnect/process restart, actual dropped-item retrieval, and resumption of the same request without bot-issued commands. These injected faults and setup teleports make it a controlled mechanics test, not survival acceptance.

`scripts/cooking-test.js` prints fixture setup and synchronization files, then hunts and cooks from an empty inventory. Choose unused prepared ground with `COOK_SITE`. After cooking, apply the printed hunger effect, acknowledge setup using its file, clear the effect as soon as the script requests it, and acknowledge that too. Eating requires both an observed consumed item and an increased food bar; later replenishment does not erase that evidence. Restore the isolated fixture's difficulty afterward. This test must not be counted as unmodified natural-world acceptance.

A separate local vanilla test server is kept in `.test-server/` on port 25566, bound to localhost, with seed 12345 and peaceful difficulty. It is separate from the existing server on 25565. Server files, credentials, goal state and trial artifacts are excluded from Git.

## Current limits

Natural terrain exploration, underground progression, restart recovery during furnace work, and survival in hostile difficulty still need end-to-end validation and improvements. Tool replacement and delivery have passed controlled mechanics checks; that does not establish sustained tool maintenance or resource supply during natural exploration. Delivery records server pickup events and has passed an independent recipient-inventory check in the controlled world. A Nether frame requires mined obsidian; lava-bucket casting is not implemented.

Fresh Normal endurance trial `mu7j1633` passed exactly 48,000 elapsed ticks without death after independently verifying its house. It gathered and cooked chicken and sheltered both nights; health and hunger remained 20 throughout. This proves the two-cycle/useful-request requirement, while eating and tool replacement still have controlled evidence only. The earlier food-search and navigation failures remain recorded in `PROGRESS.md` and their artifact directories.

A controlled flat fixture also runs on port 25567. `node scripts/fixture-commands.js` prints setup commands that place trees, exposed resources, flowers, and water. Run them only before a trial. Label these trials with `ACCEPT_SCENARIO=controlled-resources`; they do not establish natural-world search performance.

To resume a stopped trial without granting items or resetting its survival progress, set `ACCEPT_RESUME=<run-id>` with the original server port. The runner reuses the original player identity and original empty-inventory evidence.

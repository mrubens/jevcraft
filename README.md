# JevBot

A local Mineflayer bot that uses TypeSafe's Jev to interpret Minecraft chat and choose ongoing house-building actions. Ordinary code executes and verifies survival tasks. No OpenRouter token is required.

The broader target is a survival companion that can obtain food and shelter, maintain tools, avoid hazards, and follow player requests on Normal difficulty. See `GOAL.md` for the proposed expanded acceptance criteria. House construction has passed on Normal difficulty; extended autonomous survival is not yet demonstrated.

The current development target is:

- `build a house`: a 5×5 shelter with 96 floor, wall and roof blocks, an open doorway, and clear interior.
- `get me 32 purple concrete`: gather ingredients, craft dye and powder, harden it in water, collect the concrete, and confirm pickup by the requesting player.
- `find a way to the Nether`: use an existing portal or acquire a frame and ignition materials, build a portal, and verify entry into the Nether.

These workflows are **under live testing**. A house has passed in a natural world. Gathering and delivering 32 concrete blocks, plus constructing and entering a Nether portal, have passed in a prepared resource world. Natural-world concrete and Nether runs remain incomplete. See `PROGRESS.md` for evidence and remaining work.

## Join and watch locally

Open **Minecraft Java Edition 26.1**, choose **Multiplayer → Direct Connection**, and enter one of these addresses on the machine running the servers:

| Address | World |
| --- | --- |
| `localhost:25567` | Flat survival test world with prepared resources; used for current mechanics trials |
| `localhost:25566` | Natural survival world, seed 12345; the completed house is at X 83, Y 136, Z −32 |
| `localhost:25565` | Original development server |
| `localhost:25568` | Fresh natural world on Normal difficulty, seed 95812; a verified house is at X −7, Y 67, Z 3 |

Press **F3** to see your coordinates, and **Tab** to see online players. Acceptance bots are named `Trial<run-id>` and leave when their trial ends. They execute their assigned test and do not accept chat commands. Trial logs and checkpoints are in `artifacts/<run-id>/events.jsonl` and `goal.json`.

To run the interactive bot in the flat world, use:

```sh
MC_HOST=127.0.0.1 MC_PORT=25567 MC_VERSION=26.1 MC_USERNAME=JevBot npm start
```

Then send `Jev build a house`, `Jev get me 32 purple concrete`, or `Jev find a way to the Nether` in game chat. Use `Jev status`, `Jev stop`, and `Jev resume` to inspect or control its task. The nickname `Jev` works regardless of the bot's Minecraft username; addressing its full username also works. Keep the terminal open to see each action, position, and blocker. Concrete delivery requires the requesting player to be nearby and able to pick up the items.

The test servers bind to localhost, so these addresses work on this computer. World files are local and excluded from Git; cloning this repository does not start a Minecraft server.

## Run

```sh
npm install
cp .env.example .env
# Set TYPESAFE_API_KEY and Minecraft connection settings in .env.
npm start
```

Use Node 22 or newer, as required by Mineflayer. The local servers run Minecraft 26.1. Credentials stay in `.env`. Say the bot's name before a request if other players are chatting.

`stop` cancels the active task. `status` reports it. `resume` retries saved progress. A new supported request replaces the old one, after its current action has stopped. Running tasks automatically resume when the bot process restarts; cancelled or blocked tasks require `resume`.

State is stored under `.bot-state/`, separately for each server and bot identity. House coordinates are fixed once selected. Completion comes from world/inventory checks, never solely from a model's opinion.

## Execution

`src/objectives.js` asks Jev parallel typed questions for the requested outcome, material, and quantity, validates the answer, and provides goal persistence and house verification.

`src/plan.js` resolves material, crafting, smelting and tool dependencies. Ingredients are reserved while expanding recipes so shared dependencies cannot spend the same materials twice. Recipes are checked against installed Minecraft data in tests.

`src/work.js` repeatedly observes inventory and executes the next missing dependency. It records failed mining coordinates, explores with a persistent search history, uses bounded navigation, and saves progress after actions. Failures produce a concrete blocker; five consecutive execution errors or an exhausted search stop the task for inspection.

House building now uses nested Jev choices through `src/decisions.js`: current priority → subtask → bounded action. Options include site selection, resource targets, clearing, placement, and eating carried food. Conditional branch questions are batched, unavailable options are rejected, and changed observations discard stale answers. Logs and saved state contain the selected path, probabilities, latency, and token usage; “Jev status” shows the latest path. Immediate air/critical hunger responses stay in code. Foraging, threat escape, nighttime shelter, and idle survival are still unfinished; concrete and Nether task sequencing remains deterministic for now.

New work requires an explicit “Jev …” or login-name prefix. This prevents other bots' acknowledgements from becoming commands. Short stop, cancel, status, and resume controls also work without a prefix.

Resource expeditions carry spare wood, a stone pickaxe, and a portable crafting table. `src/tunneling.js` excavates supported staircase steps and rejects liquids, missing footing, and protected building foundations. Navigation limits drops, avoids digging straight down, and waits for landing before another action. `src/vitals.js` checks hunger and air during tasks; autonomous foraging, threat response, and overnight behavior are still incomplete.

`src/compatibility.js` contains application-side workarounds for mining-speed tags, named difficulty packets in 26.1, pathfinder results that otherwise share mutable search nodes, and nearby animals incorrectly overwriting the player's oxygen reading. Low air interrupts work and triggers a swimming route back to breathable air. Three controlled dives passed without damage; broad underwater exploration remains unproven. Installed dependency files remain unmodified.

`src/agent.js`, `src/act.js`, and much of `src/skills.js` contain the earlier experimental flat action loop. They remain available for comparison, but `index.js` now runs the verified objective executor. Other free-form commands from the experimental loop are not currently routed by the new entry point.

## Tests

```sh
npm test
npm run plan
node scripts/eval-decisions.js
MC_HOST=127.0.0.1 MC_PORT=25566 MC_VERSION=26.1 npm run accept -- build a house
MC_HOST=127.0.0.1 MC_PORT=25566 MC_VERSION=26.1 npm run accept -- get me 32 purple concrete
MC_HOST=127.0.0.1 MC_PORT=25566 MC_VERSION=26.1 npm run accept -- find a way to the Nether
```

The acceptance runner joins with a new player identity, checks that its inventory is empty and its mode is survival, interprets the actual request through Jev, and records events plus the saved goal under `artifacts/<run-id>/`. It never grants items, teleports, or changes game mode. The default deadline is 30 minutes (`ACCEPT_TIMEOUT_MS` overrides it).

A separate local vanilla test server is kept in `.test-server/` on port 25566, bound to localhost, with seed 12345 and peaceful difficulty. It is separate from the existing server on 25565. Server files, credentials, goal state and trial artifacts are excluded from Git.

## Current limits

Natural terrain exploration, tool replacement, underground progression, restart recovery during furnace work, and survival in hostile difficulty still need end-to-end validation and improvements. Delivery records server pickup events and has passed an independent recipient-inventory check in the controlled world. A Nether frame requires mined obsidian; lava-bucket casting is not implemented.

A controlled flat fixture also runs on port 25567. `node scripts/fixture-commands.js` prints setup commands that place trees, exposed resources, flowers, and water. Run them only before a trial. Label these trials with `ACCEPT_SCENARIO=controlled-resources`; they do not establish natural-world search performance.

To resume a stopped trial without granting items or resetting its survival progress, set `ACCEPT_RESUME=<run-id>` with the original server port. The runner reuses the original player identity and original empty-inventory evidence.

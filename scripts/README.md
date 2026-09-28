# scripts/

Tools, evals, trials and controlled tests around the bot. Everything here runs against Minecraft Java 26.1 through mineflayer, in offline mode on `127.0.0.1`. Scripts that call Jev read `TYPESAFE_API_KEY` (or `OPENROUTER_API_KEY` with `JEV_PROVIDER`) from `.env`. Most write what they saw to `artifacts/<name>-<id>/` (`events.jsonl`, `result.json`), which is ignored by git.

Anything that joins a server should be pointed at a **disposable** one: controlled tests place blocks, give items and change game settings. They refuse the interactive ports 25565 and 25577, and most require an explicit `MC_PORT`.

The ports and server folders the development setup uses (all ignored by git; bring your own server in each):

| Port | Folder | Used for |
|---|---|---|
| 25567 | `.test-fixture` | controlled fixture tests |
| 25568 | `.test-survival` | survival tests |
| 25574 | `.test-combat` | the arena and drills |
| 25578 | `.test-endgame` | endgame rehearsal |
| 25579 | `.test-acceptance` | acceptance runs |
| 25580 | `.test-replay` | the long dream run, recorded with ServerReplay |
| 25581 | `.clean-run` | first-days trials |
| 25582+ | `.clean-run-<port>` | more first-days and midgame trials side by side |

Scripts that stage a world write commands to the server's console through a named pipe, `<folder>/console.in`. [`server/start.sh.example`](server/start.sh.example) is a start script that sets that up; copy it into a server folder beside a 26.1 server jar.

## Running the bot and development

- `check-node.js`: the `npm test` pretest; fails early on a Node older than `engines.node`.
- `try-plan.js` (`npm run plan`): the recipe planner offline, for an item, a count and optional nearby blocks. No server, no key.
- `live-test.js` (`npm run live`): a second client types chat to a running bot and prints what it says and where it goes.
- `build-followup-test.js` (`npm run build-followup`): a build, then a follow-up to it; non-zero exit on failure.
- `decisions-doc.js`: writes `docs/decisions.md` from `src/decisions`; `--check` is what the test suite runs.

## Evals (live Jev calls, no game server)

- `eval-intents.js`: chat to intent, including negations and operator commands.
- `eval-decisions.js`: trade-off judgments with one right answer.
- `eval-end-decisions.js`: End combat judgments over bounded scenarios.
- `eval-survival.js`: refuge and cooking judgments on a stubbed bot.
- `eval-commands.js`: natural language to a server command, checked against a real command tree (needs a server on 25567 where the probe has temporary OP).
- `companion-routing-test.js`, `memory-routing-test.js`, `implicit-memory-routing-test.js`, `implicit-memory-design-test.js`: bundle, craft, find and memory routing.

## Trials and runs

- `trials/`: trial servers from scratch. `setup.sh <N>` fetches Java 25, the 26.1.2 server and Fabric with ServerReplay into `../.tools` and makes N server folders from 25581 (each records Jev to `recordings/players`); `supervisor.sh <port>` restarts a bot whose flight record goes quiet for 60 s; `watch.sh <ports>` returns when a trial's verdict is done or failed; `harvest.sh <port>` stops a passed first-days trial and saves its world to `.trial-sources/` and its bot state to an archive, for `midgame.js start`.
- `first-days.js`: the first-three-days trial. `start <world>` makes a fresh world on `.clean-run` (25581) and a fresh bot (its pid in `.bot-state/pids/`); `verdict` audits the run from its flight recording; `status` lists trials. New worlds get a datapack giving spectators night vision.
- `acceptance.js` (`npm run accept`): a Survival acceptance run with a fresh identity and empty inventory, on an isolated `MC_PORT`.
- `audit-day.js`: a day's audit from the flight recorder: stillness, water, retries, pacing, damage and inference cost (`AUDIT_IDENTITY`).
- `flight.js`: flight-recorder frames around a moment, or `--deaths` (`--label`).
- `stillness-report.js`: time spent standing still, hour by hour, from the survival state.

## Arena and drills (`.test-combat`, 25574)

- `trials/arena-start.sh`: makes `.test-combat` in the main checkout (the 26.1.2 jar and Java 25 from `../.tools`, a flat world, port 25574; `ARENA_DIR`/`ARENA_PORT` for a second arena) and runs it with the console pipe and `logs/arena-console.log` the arena reads.
- `arena.js`: combat drills staged from real deaths, repeated and scored; `ARENA_JEV=1` asks Jev for the stance, `ARENA_PREFER=close_in,hunt_*` answers those options wherever offered (one stand measured at a time), and every answer is logged with what was offered. Set `ARENA_WATCHER` to a player name to be put in Spectator on the bot.
- `blaze-probe.js`: one or more blazes at a set distance against a player in iron standing with the shield down, up, or up for each volley (read from the blaze's glow); `PROBE_SWORD`, `PROBE_UP`, `PROBE_HOLE`, `PROBE_OFF` vary the hand, the height, a hole round the player and the facing.
- `terrain.js`: terrain drills (flooded ore, ledges) against the real movement and mining code.
- `threat-probe.js`: what the danger layer makes of each mob.
- `shield-probe.js`: stances against skeletons, measured; the results are in its header and in the stance question's guidance.
- `endgame.js`: the stronghold, the End entry and the dragon with the ladder's own handlers (`.test-endgame`, 25578); `ENDGAME_JEV=1` asks Jev.

## Controlled test worlds

Each stages its setup with commands and then lets the bot use ordinary Survival actions, often with a second client as witness or receiver. None of them counts as a natural acceptance run.

- **Movement and terrain:** `aim-test`, `air-test`, `ascent-test`, `canopy-descent-test`, `canopy-travel-test`, `fall-test`, `hostile-route-test`, `pillar-test`, `planted-water-test`, `swim-test`, `shore-recovery-test`, `boat-test`, `movement-test`, `unreachable-test`.
- **Gathering, crafting and smelting:** `acquisition-accounting-test`, `batch-test`, `fuel-batch-test`, `foliage-mining-test`, `drop-collection-test`, `mining-passage-test`, `furnace-recovery-test`, `station-replacement-test`, `workstation-test`, `workstation-access-test`, `tool-test`, `tool-request-recovery-test`, `recipe-alternative-test`, `expedition-test`, `food-test`, `cooking-test`.
- **Delivery:** `chest-delivery-test`, `ledge-delivery-test`, `return-delivery-test`, `full-inventory-delivery-test`, `bundle-capacity-test`.
- **Building and shelter:** `build-shapes-test`, `building-regression-test`, `door-building-test`, `oriented-building-test`, `terrain-build-test`, `designer-test`, `verify-schematic`, `shelter-test`, `shelter-approach-test`, `shelter-supplies-test`, `snow-shelter-test`.
- **Combat, recovery and the End:** `combat-test`, `retreat-test`, `mob-hunt-test`, `archery-test`, `eye-search-test`, `end-entry-test`, `end-fight-test`, `recovery-test`, `recovery-routes-test`, `recovery-adviser-test`.
- **Chat, session and memory:** `control-test` (stop, resume, restart), `commands-test`, `companion-live-test`, `memory-live-test`, `implicit-memory-live-test`.

Read a test's header before running it: it names the port, the setup it stages and whether it needs a key.

### Older and one-off

Kept for the record; they load but reproduce a specific moment and may need a retained world or hand setup: `lava-route-test` (a copy of world `mu7sfld6`), `surface-recovery-test` and `navigation-test` (a retained failure world), `dry-mining-test` and `portal-support-test` (early, hard-coded ports), `creative-test` and `creative-house-test` (Creative switched by hand), `fixture-commands` (an early world layout, unused).

## Data and assets

- `extract-knowledge.py`: rebuilds `data/vanilla-26.1.json` (recipes, tags, loot) from a vanilla `server-26.1.jar`.
- `generate-schematics.js`: asks the designer for a schematic and writes it to `data/schematics/` (`OPENROUTER_API_KEY`).

## Libraries (`scripts/lib`)

- `arena.js`: drill definitions, staging commands and scoring.
- `terrain.js`: terrain drill builds.
- `audit.js`: flight-recorder analysis shared by `audit-day.js` and the first-days verdict.
- `win-witness.js`: watches live packets during an acceptance run to confirm a win.
- `flooded-cave.json`: a block capture of a flooded cave, for the terrain drills.

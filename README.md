# JevBot

A Minecraft companion you can talk to in game chat. Ask Jev to gather supplies, build something, find a biome, or follow you on an adventure.

JevBot uses [Mineflayer](https://github.com/PrismarineJS/mineflayer) to play and [TypeSafe’s Jev](https://typesafe.ai/) to understand requests and choose actions. An optional LLM through [OpenRouter](https://openrouter.ai/) designs custom structures and helps with recovery. Recipes, movement, inventory handling, and checks that work is actually finished live in code.

**Experimental, targeting Minecraft Java Edition 26.1.** Gathering, building, exploration, and survival support are available, but difficult terrain and long tasks can still need help. Fully autonomous game completion is a development goal, not a finished capability.

[Quick start](#quick-start) · [Chat commands](#talking-to-jev) · [Building](#building) · [Observatory](#watching-jev) · [Roadmap](ROADMAP.md)

## What Jev can do

- **Gather and craft.** Resolve items from the Minecraft catalog and work through recipes, ingredients, harvest tools, smelting, and concrete hardening.
- **Combine requests.** Plan shared materials for multiple outputs, batch compatible gathering and crafting steps, and track each delivery. Full diamond armor means all four pieces.
- **Build from descriptions.** Turn a request and nearby world observations into a saved schematic, gather its materials, prepare suitable ground, and place the blocks. Without a generative model, Jev can use configurable building templates.
- **Explore with you.** Come, follow, find observed blocks and creatures, search for biomes, swim, and use boats for suitable surveyed crossings.
- **Remember your world.** Save named places and personal notes, recall past tasks, and return to remembered locations after reconnecting.
- **Handle survival needs.** Seek food and shelter, cook and eat, prepare tools, respond to hazards, and attempt recovery without forgetting the player’s request.
- **Show its work.** Inspect terrain, inventory, activity, and decisions in a local 3D Observatory. Stop and resume tasks from chat or the live viewer.

## Quick start

You need:

- Node.js **22 or newer** and npm.
- A running **Minecraft Java Edition 26.1** server and a Minecraft client to play alongside the bot. The repository does not include or start a game server.
- A **TypeSafe API key or OpenRouter API key**. The bot runs locally; model calls require network access.

### 1. Install

```sh
git clone https://github.com/mrubens/jevcraft.git
cd jevcraft
npm ci
cp .env.example .env
```

### 2. Configure

Edit `.env` with your server address and one model provider:

```dotenv
TYPESAFE_API_KEY=your_typesafe_key
# Alternatively, set OPENROUTER_API_KEY=your_openrouter_key

MC_HOST=localhost
MC_PORT=25565
MC_VERSION=26.1
MC_USERNAME=Jev
MC_AUTH=offline

JEV_DASHBOARD_PORT=3040
```

Use `MC_AUTH=offline` when your server supports offline authentication. For an authenticated server, use `MC_AUTH=microsoft` with the bot’s Minecraft account and complete the sign-in prompt. Your own player and the bot need separate identities.

### 3. Start and join

```sh
npm start
```

Join the same server from **Multiplayer → Direct Connection** in Minecraft. Then try:

```text
Jev come here
Jev craft me a chest
Jev build a house
```

With the dashboard setting above, open [the live Observatory](http://127.0.0.1:3040/?session=live). Keep the bot process running while you play.

## Talking to Jev

Start a request with **“Jev …”** or the bot’s configured username. These are examples, not a fixed command vocabulary:

| Request | What it does |
| --- | --- |
| `Jev come here` | Move toward the speaker. |
| `Jev follow me` | Keep following the speaker until stopped or replaced by another task. |
| `Jev get me a pumpkin` | Find, collect, and deliver one pumpkin. |
| `Jev make eight birch stairs` | Gather ingredients and craft the requested quantity. |
| `Jev give me full diamond armor and a bed` | Plan all four armor pieces and one bed together, sharing their material requirements. |
| `Jev get me 32 purple concrete` | Obtain ingredients, craft powder, harden it in water, and deliver the blocks. |
| `Jev find a cherry biome` | Explore using observed biome data. |
| `Jev find a sheep` | Look for and approach a sheep without attacking it. |
| `Jev build a small cherry mansion` | Request a custom building design. |
| `Jev find a way to the Nether` | Work toward a portal and verify entry; survival progression remains experimental. |

**“For me” requests delivery.** `Jev craft me a chest` brings the chest to you; `Jev craft a chest` keeps it in the bot’s inventory. Stay nearby for handovers. If there is no safe throwing spot, Jev can use a nearby chest or make and place one, verify the stored items, and tell you its coordinates. Ordinary handoffs still require observed pickup by the intended player. Chest deposits are saved separately in the delivery evidence, so Jev tells you where to collect them and avoids repeating a confirmed deposit after a restart.

| Control | Effect |
| --- | --- |
| `Jev status` | Describe the current task or survival activity. |
| `Jev stop` | Cancel active movement and pause work, saving progress. |
| `Jev resume` | Continue a saved task or resume idle survival behavior. |

A new request replaces the active task. Put related item requests in one message to have them planned together. Combined requests support up to 16 different item types, with shared recipe dependencies, reserved outputs, and saved delivery progress.

Running tasks resume after reconnects and process restarts. Stopped or blocked tasks wait for `resume`. State is stored in `.bot-state/`, separately for each server and bot identity.

## Memory

Jev keeps a local notebook across reconnects and restarts. Try:

```text
Jev remember this as home
Jev go home
Jev where is home?
Jev remember I prefer cherry planks
Jev get me two of my favorite planks
Jev what did I ask you to do last time?
Jev make another one like last time
Jev forget home
```

“Here” means the speaking player's observed position, not Jev's. Named places
include their dimension; Jev walks there through ordinary gameplay and reports
when a place is in another dimension. Remembering or recalling something does not
replace the active task. “Again” starts a fresh copy of a remembered gathering,
crafting, building, discovery, or saved-place request; `resume` continues saved
progress. Memory never replays operator commands.

Each player's notes and places are separate. Explicit current instructions take
priority over remembered preferences. Item interpretation and building design can
use those preferences. Completed discoveries and builds also save useful places,
and recent resource observations are shared between tasks, with fresh block checks
and expiry. Remembered locations are last-known observations, not a guarantee that
blocks, creatures, or structures are still there. Chest inventories are not tracked.

Jev also learns a **soft wood preference from ordinary requests**. After
“Jev give me a cherry log,” “Jev give me two planks” favors cherry planks without
needing a separate `remember` instruction. This carries across logs, planks,
wooden variants, simple houses, and the building designer. Current instructions
come first, then explicit notes such as “I prefer birch,” then the most recent
learned choice. The custom designer balances inferred preferences against local
materials instead of treating them as required ingredients.

These choices are player-specific and survive restarts. Jev does not learn a new
preference from its own defaults, repeated tasks, negated requests, or supplies
ordered for someone else. “Jev what wood do I prefer?” explains what he noticed;
“Jev forget my wood preference” can remove the learned choice. Task history stays
available for recall, but does not recreate erased preferences.

The notebook keeps up to 32 notes, 32 places, and 24 task summaries per player
(with server-wide bounds). `Jev what do you remember?` gives a short summary;
`Jev forget everything you remember about me` clears that player's notebook.
Notebook files live in `.bot-state/*-memory.json` and are excluded from Git.
Set `MC_WORLD_ID` to give a replacement world at the same server address a fresh
memory namespace. This setting does not reset saved gameplay tasks.

## Building

Describe the structure, material, and features you want:

```text
Jev build a compact cherry mansion with two floors and big windows
Jev build a small sandstone watchtower
Jev build a cobblestone sculpture
```

With an OpenRouter key, the designer receives the request, nearby terrain, inventory, game mode, and supported materials. It produces a schematic that Jev saves and executes. In Survival, Jev gathers materials through ordinary recipes; in Creative, it uses the Creative inventory.

Jev prefers level ground but can also cut natural terrain, fill gaps, and prepare a shallow-water foundation. Site preparation has bounded excavation and fill limits, protects recognizable existing builds, and stops if unexpected blocks appear. The saved design and site are reused on resume.

The current executor supports full-cube structures up to **25 × 16 × 25 blocks**, with at most **6,000 solid blocks** and **16 materials**. Oriented stairs and doors, fluids, gravity blocks, and working redstone are not supported schematic elements. These limits apply to construction; inventory crafting can still make items such as stairs.

Without an OpenRouter key, Jev selects and configures cottage, mansion, or tower templates. Unsupported shapes report a limitation. With a key, failed custom designs stay on the schematic repair path rather than silently becoming a template. A simple `Jev build a house` uses the compact shelter workflow.

## Model configuration

Jev handles request interpretation and ordinary action selection through either provider. The optional generative model has two separate jobs: building design and advice when repeated attempts get stuck.

| Setting | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | Use Jev through TypeSafe. |
| `OPENROUTER_API_KEY` | Use Jev through OpenRouter and enable optional design/recovery calls. |
| `JEV_PROVIDER` | Force `typesafe` or `openrouter`. Otherwise, a TypeSafe key takes precedence. |
| `TYPESAFE_DEFAULT_MODEL` | TypeSafe decision model; default `jev-latest`. |
| `OPENROUTER_JEV_MODEL` | OpenRouter decision model; default `typesafe/jev-1.13`. |
| `BUILD_DESIGNER` | `auto` uses OpenRouter when configured, otherwise templates; `jev` always uses templates; `openrouter` requires generated designs. |
| `OPENROUTER_BUILD_MODEL` | Generative building model. |
| `RECOVERY_ADVISER` | `auto` enables advice when an OpenRouter key is available; `off` disables it. |
| `OPENROUTER_RECOVERY_MODEL` | Generative recovery model. |

Both generative model settings currently default to `anthropic/claude-fable-5.1`; configure model IDs available to your OpenRouter account. Recovery advice selects from implemented actions and has call, time, and execution limits. It cannot run arbitrary code or operator commands.

See [`.env.example`](.env.example) for connection and viewer settings. Keep credentials in `.env`, which is excluded from Git.

## Watching Jev

The **Observatory** is a local browser view of the bot’s loaded surroundings, with:

- Orbit, behind-the-bot, first-person, and top-down cameras.
- Terrain textures from your local Minecraft installation, plus route and building overlays.
- Inventory, health, activity, and recorded decision choices.
- A timeline, recording export/import, and live stop/resume controls.

Enable it with `JEV_DASHBOARD_PORT=3040` when starting the bot. To browse recordings and the illustrated demo without connecting a bot:

```sh
npm run harness
```

Open [localhost:3040](http://127.0.0.1:3040). Use a different port if a live viewer is already running. The standalone viewer does not control Minecraft. See the [Observatory guide](docs/observatory.md) for controls, texture configuration, and recording details.

## Optional operator commands

Jev can translate explicit player requests such as `Jev make it daytime`, `Jev stop the rain`, or `Jev teleport me to you` into server commands. To enable this, grant the bot the required server permissions and list allowed players:

```dotenv
MC_COMMAND_USERS=YourPlayerName,AnotherPlayer
```

Leave this empty to disable command requests. Exact commands also work, for example `Jev run /time query daytime`. They execute as the bot, so `@s` and relative coordinates refer to Jev.

Operator commands require a fresh request from an allowed player and are never used autonomously for gathering, building, or recovery. Stop/resume and reconnects do not replay them. Complex command arguments may need an exact slash command.

## Development

The application is CommonJS JavaScript. The main pieces are:

| Area | Entry points |
| --- | --- |
| Connection, chat, and persistence | `index.js`, `src/session.js`, `src/objectives.js` |
| Jev requests and catalog routing | `src/typesafe.js`, `src/catalog.js`, `src/decisions.js` |
| Recipes, combined tasks, and execution | `src/knowledge.js`, `src/batch-plan.js`, `src/item-bundle.js`, `src/work.js` |
| Survival, travel, and recovery | `src/survival.js`, `src/movement.js`, `src/boats.js`, `src/recovery-adviser.js` |
| Schematics and viewer | `src/designer.js`, `src/harness/`, `public/harness/` |

Typed model decisions choose among feasible options. Code owns recipe arithmetic, action execution, cancellation, and verification against actual inventory and world observations.

Run the local checks without a Minecraft server or API key:

```sh
npm test
```

`npm run plan` prints what the planner would do for a request, using the same
`src/knowledge.js` planner and extracted recipe data the bot executes in game.
Pass an item, a quantity, a starting inventory, and the blocks the bot can see:

```sh
npm run plan -- cherry_planks 8
npm run plan -- iron_pickaxe 1 oak_log=10,cobblestone=30
npm run plan -- diamond 1 '' spruce_log
```

Observed blocks are cheaper than speculative ones, so the chosen route shifts
with the last argument exactly as it does in game. Run it with no arguments for
a set of built-in cases, including one that is deliberately impossible.

Classifier evaluations make live model calls but do not require a game server:

```sh
node scripts/eval-intents.js
node scripts/companion-routing-test.js
```

Gameplay tests need a **separate, disposable Minecraft server**. Read each script’s setup instructions first; controlled fixtures can place blocks, grant items, or change game settings. For an acceptance trial against a separately prepared server:

```sh
MC_HOST=127.0.0.1 MC_PORT=25579 MC_VERSION=26.1 npm run accept -- build a house
```

The acceptance runner requires an explicit isolated port, uses a separate bot identity, and writes evidence under `artifacts/`. A controlled fixture passing is not proof that the same task works from an empty inventory in a natural world.

For contributions, include a reproducible request, expected behavior, relevant configuration, and what you tested. Bug reports are most useful with the Minecraft version, game mode/difficulty, and a short log or Observatory recording. Review recordings before sharing: they can contain chat, player names, and world coordinates.

## Current limitations

- Recognizing an item does not guarantee a working Survival acquisition path. Farming, trading, and enchanting are not implemented; some blocks need an already enchanted tool.
- Rare resources, complex terrain, large builds, and long expeditions can still get stuck. Recovery can only use actions the bot knows how to execute.
- Boat travel requires loaded, level water and observed shores within its survey range; open-ocean exploration and flying follow are not supported.
- Building preparation does not clear arbitrary player structures or handle deep-water and lava foundations.
- `Jev beat Minecraft` starts an experimental progression objective. Reliable fresh-start Nether progression and a complete dragon defeat with a living return remain unfinished.

See the [roadmap](ROADMAP.md) for priorities and planned improvements.

# JevBot

A Minecraft companion you talk to in game chat, built to show what a [System One](https://docs.typesafe.ai/concepts/system-one) model is good at. Ask Jev to gather supplies, build something, find a biome, or follow you on an adventure. Every judgment the bot makes about what you meant and what to do next is a typed answer from [TypeSafe's Jev](https://typesafe.ai/), with a probability attached, and you can watch each one happen in a local 3D Observatory.

**Experimental, targeting Minecraft Java Edition 26.1.** Gathering, building, exploration, and survival support work; difficult terrain and long tasks can still need help. Fully autonomous game completion is a development goal, not a finished capability.

[Quick start](#quick-start) · [How Jev is used](#how-jev-is-used) · [Chat commands](#talking-to-jev) · [Building](#building) · [Observatory](#watching-jev-think) · [Roadmap](ROADMAP.md)

## Why this project exists

Most "AI plays Minecraft" bots hand a large language model the whole problem and parse whatever prose comes back. JevBot does the opposite. Code owns Minecraft: recipes, movement, inventory, safety, and the checks that work is actually finished. Jev is asked only the questions code cannot answer, and it answers with a typed choice and how sure it is, in a few hundred milliseconds:

- *Is this message for me, and what does it want?*
- *Which of these catalog items did the player mean?*
- *Should I keep building or get under cover before dark?*
- *Which of these three sources of wood is worth walking to?*
- *Does the design that came back actually answer the request?*

When Jev is not sure enough, the bot asks a one-line question instead of guessing. When something has failed repeatedly, Jev picks between recovery options that code has already checked, and only if it is unsure does an optional generative model get a turn. The result is a bot whose behaviour you can inspect answer by answer, that costs about two thousand tokens per chat request, and that never executes anything the model invented.

## What Jev can do

- **Gather and craft.** Resolve items from the real Minecraft catalog and work through recipes, ingredients, harvest tools, smelting, and concrete hardening.
- **Combine requests.** Plan shared materials for several outputs, batch compatible gathering and crafting, and track each delivery. Full diamond armor means all four pieces.
- **Build from descriptions.** Turn a request and nearby terrain into a schematic, gather its materials, prepare the ground, and place the blocks. Without a generative model, Jev configures building templates.
- **Explore with you.** Come, follow, find observed blocks and creatures, search for biomes, swim, and use boats for surveyed crossings.
- **Remember your world.** Save named places and notes, recall past tasks, learn a wood preference from ordinary requests, and return to remembered locations after reconnecting.
- **Handle survival needs.** Seek food and shelter, cook and eat, replace worn tools, respond to hazards, and recover without forgetting your request.
- **Show its work.** Inspect terrain, inventory, activity, and every Jev judgment in a local 3D Observatory. Stop and resume from chat or the viewer.

## Quick start

You need:

- Node.js **22 or newer** and npm.
- A running **Minecraft Java Edition 26.1** server and a client to play alongside the bot. The repository does not include or start a game server.
- A **TypeSafe API key** (or an OpenRouter key). The bot runs locally; model calls require network access.

### 1. Install

```sh
git clone https://github.com/mrubens/jevcraft.git
cd jevcraft
npm ci
cp .env.example .env
```

### 2. Configure

Edit `.env` with your server address and a model provider:

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

Use `MC_AUTH=offline` when your server allows it. For an authenticated server, use `MC_AUTH=microsoft` with the bot's own Minecraft account and complete the sign-in prompt. Your player and the bot need separate identities.

### 3. Start and join

```sh
npm start
```

Join the same server from **Multiplayer → Direct Connection**, then try:

```text
Jev come here
Jev craft me a chest
Jev build a house
```

Open [the live Observatory](http://127.0.0.1:3040/?session=live) and keep the bot process running while you play.

## How Jev is used

Jev answers three kinds of question: a **Choice** among options code lists, a **Noul** (a yes/no probability), and a **Score** along described levels. Every question the bot asks is built from the real game state, and every answer is checked against the options that were offered before anything runs. This is the complete map of where the model sits.

| Moment | What Jev is asked | Primitive | What code does with the answer |
| --- | --- | --- | --- |
| A chat message arrives | Whether it is addressed to the bot, whether it asks for action or is just talk, which of fifteen objectives it is, the quantity, the recipient, a target player, the wood species chosen, how much the wording presses for speed, and speculatively: which word-overlap catalog item is meant, what kind of thing to find, and what a note says about wood | Noul + Choices + a Score, one batched call | Routes to a handler. Below a confidence bar the bot asks a one-line question instead; the bar is higher for builds, commands and long journeys. Urgency travels with the task into later trade-offs |
| The item is not settled | Which branch of the real item catalog holds it, one level at a time | Choice per hop | Copies the catalog name. An unsure leaf with a close runner-up becomes "did you mean X or Y?" |
| Several outputs are named | For each catalog branch, whether it holds one of the requested outputs; then coverage, quantity and recipient per item | Nouls, then Choices | Builds the combined plan; incomplete coverage asks the player |
| A memory request | What operation it is, which saved entry it means, which verbatim span is the place name, which observed position is "here" | Choices over spans | Saves, recalls, forgets, or walks. Jev cannot invent a name or a coordinate |
| A step needs materials | Which **source** to work: sources differ in block, count within reach, distance and climb | Choice per tree level | Picks the nearest block inside the chosen source. A single feasible option is never sent to Jev |
| Dusk or hunger while working | Continue the request, secure a shelter, or forage; and which forage option | Choice | Eating carried food and air are rules in code, not choices |
| A build request | Whether it continues a standing structure and where it goes; in template mode, which style, floors, size and material | Choices | The generative designer draws custom shapes; templates need no generation |
| A design comes back | Whether the validated design answers the request in kind, scale and material | Noul | A poor fit goes back to the designer with Jev's verdict as feedback, before hours of placing blocks |
| Something keeps failing | Which code-checked recovery action is most likely to unblock the original request | Choice | Executes it under a budget. An unsure Jev, or a repeat of the same failure, escalates to the optional generative adviser |
| A boat, an ore, a mob, a stronghold, the dragon | Whether a surveyed crossing is worth a boat; whether a nearby ore is worth a detour; the next bounded combat or search action | Choices | Bounded, verified execution with safety reflexes in code |
| An operator command | Each branch of the server's own command tree, the argument roles, then whether the result faithfully implements the request | Choices + Noul | Runs the command once, only from allowed players, only above a faithfulness bar |

[How Jev thinks](docs/how-jev-thinks.md) walks through one recorded request with the real answers, confidences, latency and token counts, and ships the trace so you can open it in the Observatory.

The two places a generative model is used, both optional and both through OpenRouter, are the ones that need generation: drawing a custom schematic from a request and terrain survey, and reasoning about a failure Jev could not judge. Everything else is selection, and selection is what a System One model does well.

If Jev cannot be reached (the service is down, a request times out), the bot does not stop. The same decision tree is walked with a code default, shelter before food before the request and otherwise the first option listed, the decision is recorded as a *code default*, and the bot says so once in chat and once more when Jev is back. The Observatory shows those decisions in their own colour, so an outage is visible rather than silent.

Two design rules run through all of it. **Jev chooses, code enumerates**: the model never sees an option code did not construct and check, so it cannot invent a coordinate, a command or a quantity. **Confidence is a second axis**: the answer says what, the probability says whether to act, and thresholds scale with what a mistake would cost.

## Talking to Jev

Start a request with **"Jev …"** or the bot's configured username. These are examples, not a fixed vocabulary:

| Request | What it does |
| --- | --- |
| `Jev come here` | Move toward the speaker. |
| `Jev follow me` | Keep following until stopped or replaced. |
| `Jev get me a pumpkin` | Find, collect, and deliver one pumpkin. |
| `Jev make eight birch stairs` | Gather ingredients and craft the quantity. |
| `Jev give me full diamond armor and a bed` | Plan all four pieces and a bed together, sharing materials. |
| `Jev get me 32 purple concrete` | Obtain ingredients, craft powder, harden it in water, deliver. |
| `Jev find a cherry biome` | Explore using observed biome data. |
| `Jev find a sheep` | Look for and approach a sheep without attacking it. |
| `Jev build a small cherry mansion` | Request a custom building design. |
| `Jev find a way to the Nether` | Work toward a portal and verify entry; survival progression remains experimental. |

**"For me" requests delivery.** `Jev craft me a chest` brings the chest to you; `Jev craft a chest` keeps it. Stay nearby for handovers. If there is no safe throwing spot, Jev can use or place a nearby chest, verify the stored items, and tell you its coordinates.

| Control | Effect |
| --- | --- |
| `Jev status` | Describe the current task or survival activity. |
| `Jev stop` | Cancel active movement and pause work, saving progress. |
| `Jev resume` | Continue a saved task or resume idle survival behaviour. |

A new request replaces the active task. Put related item requests in one message to have them planned together. Combined requests support up to 16 item types. Running tasks resume after reconnects and restarts; stopped or blocked tasks wait for `resume`. State lives in `.bot-state/`, per server and bot identity.

If Jev is not sure what you meant, it says so and asks: *"I'm not sure whether you want me to design and build something or build a small house. Could you say it another way?"* or *"Did you mean short grass or grass block?"* Nothing starts until you answer.

## Give Jev a dream

Jev doesn't have to wait to be told what to do. Give it a dream and it chases it whenever nothing else needs it:

```text
Jev your dream is to build a village
Jev your dream is to beat the game
Jev what's your dream?
Jev set your dream aside
Jev chase your dream
Jev forget your dream
```

With **build a village**, code lists the parts a village still lacks from the buildings that actually stand, and Jev picks the next one and scores how village-like the place already is. The part is then chosen from a shelf of forty-five ready-made, validated designs (cottages, a mansion, a tower, wells, farm plots, chapels, barns, lamp posts, plazas) with Jev picking the design that suits what already stands, so no generative model is ever called. Each part goes beside the newest one so the village grows as a cluster, and the Observatory shows the dream and the village score on every event.

With **beat the game**, the idle loop hands Jev the survival ladder: stone tools, a stone sword, an iron pickaxe, a shield, an iron sword, a bucket, a home base, iron armour, then the Nether, blaze rods, Eyes of Ender, the stronghold and the dragon. Each rung is something the planner can already do, and progress is only ever read off the world, never off a counter.

A chat request always takes priority and the dream resumes afterwards. Setting it aside stops the current milestone and holds it; chasing it again picks the partly built milestone back up. A milestone that could not be finished waits out a cool-down. Between milestones, with shelter and food sufficient, Jev also chooses among small chores: cooking raw food it carries, making stone tools, stocking wood, and once the base stands, tending the farm, baking bread and breeding the cows.

### Home base

Deaths and food have been the recurring cost of the beat-the-game run: six times the full kit was lost to a death that then cost a climb from world spawn, and every food reserve was a hunt of unknown length. So the ladder has a **home** rung, taken after the bucket and before the long descents, the order any survival walkthrough keeps: iron tools, then a base and a bed, then the mine.

- **One site per world.** Code looks for level, tillable ground beside water near the first Overworld portal the bot has used, else the house it built, else where it stands, and keeps it in the shared survival state so every later request and restart sees the same base.
- **A bed first.** Wool from sheep (the same chase that gets mutton), a bed crafted through the ordinary recipe path, placed and used once so the respawn point moves home. A missing bed reopens the rung.
- **A wheat plot.** A wooden hoe, nine cells of farmland against the water, seeds from clearing grass (kept in the pockets now rather than tossed), planted and left to grow. Growth takes in-game time, so the plot is tended on return visits rather than watched.
- **A cow pen.** A fenced five-by-five ring with a gate, two cows led in with wheat and bred for steak, cooked through the existing furnace path.
- **A stash chest.** Eight planks, placed once beside the foot of the bed right after the bed is claimed, and remembered in the base state with its contents as of the last time the lid was opened.

The chest holds a **spare kit**: a stone pickaxe and a stone sword (iron when there is an iron one to spare), eight logs, a stack of cobblestone, eight pieces of cooked food, a crafting table, a furnace, and a water bucket if a second one is carried. "Stock the stash" is an idle chore like the farm ones, offered whenever the pockets hold something the kit is short of, and Jev chooses it or not: the best tool of each kind stays in hand and the next best goes in, wood and stone go in beyond what a descent keeps, food goes in beyond the twelve-point expedition reserve. Before a Nether crossing the ladder also leaves the valuables at home when the base is within reach: diamonds once the diamond pickaxe exists, gold, emeralds, raw ore and every iron ingot beyond eight. On a respawn at the bed, or whenever the bot is within reach of the base with an empty kit, a **restock** rung runs ahead of the preparation rungs and takes out what the pockets are short of plus whatever the next rung was about to go and gather, so a death costs a walk of two blocks rather than an hour from a wooden pickaxe. The decision to restock is read from the remembered contents; the walk only happens when the chest has something, and a chest found missing reopens the home rung for another.

The idle chores then include tending the farm, harvesting and baking, leading cows in and breeding them, stocking the stash, and Jev chooses between them like the rest. The food rules treat bread and steak at the base as a reserve within reach: when the base is within about a hundred and thirty blocks and has something to eat, walking home replaces the wander for animals, and it stands beside any hunt that is actually in view for Jev to weigh. Everything is read off the world: farmland, crop age, fence blocks, cows inside the ring, the bed's two halves.

## Memory

Jev keeps a local notebook across reconnects and restarts:

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

"Here" means the speaking player's observed position. Named places include their dimension. "Again" starts a fresh copy of a remembered request; `resume` continues saved progress. Memory never replays operator commands.

Jev also learns a **soft wood preference from ordinary requests**: after "Jev give me a cherry log", "Jev give me two planks" favours cherry. Current instructions come first, then explicit notes such as "I prefer birch", then the most recent learned choice. `Jev what wood do I prefer?` explains it; `Jev forget my wood preference` removes it. Each player's notes and places are separate, and `Jev forget everything you remember about me` clears a notebook. Notebook files live in `.bot-state/*-memory.json`, excluded from Git. Set `MC_WORLD_ID` to give a replacement world at the same address a fresh memory namespace.

## Building

Describe the structure, material, and features you want:

```text
Jev build a compact cherry mansion with two floors and big windows
Jev build a small sandstone watchtower
Jev build a cobblestone sculpture
```

With an OpenRouter key, the designer receives the request, a terrain heightmap, inventory, game mode, and the supported palette, and returns a schematic. Code validates its geometry; Jev judges whether it answers the request; then the bot gathers materials through ordinary recipes (or the Creative inventory) and builds it. Jev prefers level ground but can cut terrain, fill gaps, and set a foundation in shallow water, within bounded earthworks that protect existing builds.

The executor supports structures up to **25 × 16 × 25 blocks** in the ordinary case and larger ones when a request calls for it, with at most **16 materials**. Stairs, slabs and wooden doors carry their orientation; fluids, gravity blocks and redstone are not supported schematic elements.

Without an OpenRouter key, Jev selects and configures cottage, mansion, or tower templates. A plain `Jev build a house` uses the compact shelter workflow. Ask to extend, finish, or change a building Jev already built and it works out which one you mean.

## Model configuration

| Setting | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | Use Jev through TypeSafe. |
| `OPENROUTER_API_KEY` | Use Jev through OpenRouter and enable the optional design and recovery models. |
| `JEV_PROVIDER` | Force `typesafe` or `openrouter`. Otherwise a TypeSafe key takes precedence. |
| `TYPESAFE_DEFAULT_MODEL` | TypeSafe decision model; default `jev-latest`. |
| `OPENROUTER_JEV_MODEL` | OpenRouter decision model; default `typesafe/jev-1.13`. |
| `BUILD_DESIGNER` | `auto` uses OpenRouter when configured, otherwise templates; `jev` always uses templates; `openrouter` requires generated designs. |
| `OPENROUTER_BUILD_MODEL` | Generative building model. |
| `RECOVERY_ADVISER` | `auto` lets Jev, then the generative model, advise on repeated failures; `off` disables both. |
| `OPENROUTER_RECOVERY_MODEL` | Generative recovery model. |

Both generative settings default to `anthropic/claude-fable-5.1`. Recovery advice, from either model, can only select implemented actions and has call, time, and execution limits. See [`.env.example`](.env.example) for connection and viewer settings. Keep credentials in `.env`, which is excluded from Git.

## Watching Jev think

The **Observatory** is a local browser view of the bot's surroundings and reasoning:

- Orbit, behind-the-bot, first-person, and top-down cameras over the loaded terrain, with textures from your local Minecraft installation and route and build overlays.
- **Inside Jev's head**: a running count of Jev calls, their median latency, tokens, and how often Jev asked the player instead of acting. For each decision, the question that was asked at every branch, the options offered, their probabilities, and how confident the answer was. Single-option steps are labelled as never having reached the model.
- **This run**: a persistent ledger of the current request or dream, kept by the bot across restarts: elapsed time, restarts, Jev calls and tokens, split by the kind of question asked. Every finished run adds a line to [`docs/run-ledger.md`](docs/run-ledger.md).
- Each chat request as its own event, with every typed answer from the interpretation call and the catalog walk that named the item; clarifying questions with the confidence that caused them; recovery events that say whether Jev or the generative adviser chose.
- A timeline, replay, recording export and import, and live stop and resume.

Enable it with `JEV_DASHBOARD_PORT=3040` when starting the bot, or browse recordings and the illustrated sample without a bot:

```sh
npm run harness
```

Open [localhost:3040](http://127.0.0.1:3040). See the [Observatory guide](docs/observatory.md) for controls, textures, and recordings.

## Optional operator commands

Jev can translate explicit requests such as `Jev make it daytime` or `Jev teleport me to you` into server commands, walking the server's own command tree one branch at a time and checking the result against the request before running it. Grant the bot the required permissions and list allowed players:

```dotenv
MC_COMMAND_USERS=YourPlayerName,AnotherPlayer
```

Leave this empty to disable command requests. Commands execute as the bot, require a fresh request from an allowed player, and are never used autonomously for gathering, building, or recovery.

## Development

The application is CommonJS JavaScript. The main pieces are:

| Area | Entry points |
| --- | --- |
| Connection, chat, and persistence | `index.js`, `src/session.js`, `src/objectives.js` |
| Jev questions and catalog routing | `src/typesafe.js`, `src/catalog.js`, `src/decisions.js`, `src/decision-options.js` |
| Recipes, combined tasks, and execution | `src/knowledge.js`, `src/batch-plan.js`, `src/item-bundle.js`, `src/work.js` |
| Survival, travel, and recovery | `src/survival.js`, `src/movement.js`, `src/boats.js`, `src/recovery-adviser.js` |
| Schematics, design review, and viewer | `src/designer.js`, `src/design-review.js`, `src/harness/`, `public/harness/` |

Run the local checks without a Minecraft server or API key:

```sh
npm test
```

`npm run plan` prints what the planner would do for a request, using the same planner and extracted recipe data the bot executes in game:

```sh
npm run plan -- cherry_planks 8
npm run plan -- iron_pickaxe 1 oak_log=10,cobblestone=30
```

Two evaluations make live Jev calls but need no game server. The intent eval sends forty-nine chat messages through the interpreter and checks the routing, item, quantity and recipient. The decision eval holds the judgments code cannot make from a rule, such as whether to keep working at dusk and which source of wood to walk to:

```sh
node scripts/eval-intents.js
node scripts/eval-decisions.js
```

Both write their full judgments to `artifacts/` so a regression can be read, not just counted.

Gameplay tests need a **separate, disposable Minecraft server**. Read each script's setup instructions first; controlled fixtures can place blocks, grant items, or change game settings. For an acceptance trial:

```sh
MC_HOST=127.0.0.1 MC_PORT=25579 MC_VERSION=26.1 npm run accept -- build a house
```

The acceptance runner requires an explicit isolated port, a separate bot identity, and writes evidence under `artifacts/`. A controlled fixture passing is not proof that the same task works from an empty inventory in a natural world.

Contributions are most useful when they turn a concrete gameplay failure into a small reproducible test and an improvement to a general capability. See [CONTRIBUTING.md](CONTRIBUTING.md) for the two design rules, what to include with each kind of change, and how the evals fit in. Review Observatory recordings before sharing them: they can contain chat, player names, and world coordinates. Unit tests run on every push and pull request; the live Jev evals run on `main` when the repository has a TypeSafe key configured.

JevBot is released under the [MIT License](LICENSE).

## Current limitations

- Recognizing an item does not guarantee a working Survival acquisition path. Farming is limited to the home plot's wheat; trading and enchanting are not implemented; some blocks need an already enchanted tool.
- Rare resources, complex terrain, large builds, and long expeditions can still get stuck. Recovery can only use actions the bot knows how to execute.
- Boat travel requires loaded, level water and observed shores within its survey range; open-ocean exploration and flying follow are not supported.
- Building preparation does not clear arbitrary player structures or handle deep-water and lava foundations.
- `Jev beat Minecraft` starts an experimental progression objective. Reliable fresh-start Nether progression and a complete dragon defeat with a living return remain unfinished.

See the [roadmap](ROADMAP.md) for priorities and planned improvements.

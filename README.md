# jevcraft

jevcraft is a Minecraft Survival bot built on [mineflayer](https://github.com/PrismarineJS/mineflayer). Code handles the mechanics: pathfinding, digging, crafting, combat moves. The judgment calls go to [TypeSafe's Jev](https://typesafe.ai/), a [System One](https://docs.typesafe.ai/concepts/system-one) model that picks one option from a typed list in about 0.2 seconds.

The goal is to beat the game from a fresh world with an empty inventory ([GOAL.md](GOAL.md)). This README describes how the bot is set up and what we learned running it. The bot can also be used as a chat companion; see [the end of this file](#using-jev-as-a-chat-companion).

| | |
|---|---|
| ![Jev kills a wither skeleton on a fortress bridge](docs/media/wither-skeleton-kill.gif) | ![Jev kills a blaze on a fortress bridge](docs/media/blaze-kill.gif) |
| Killing a wither skeleton (Jev chose `shield_guard`, p=0.98). | Killing a blaze for a rod (`close_in`, p=0.42). |
| ![Jev steps through his portal into the Nether](docs/media/nether-entered.gif) | ![A ghast's fireball knocks Jev into lava](docs/media/ghast-death.gif) |
| Entering the Nether 7 minutes into a fresh world. | Knocked into lava by a ghast fireball (`fight`, p=0.22). |

The clips are rendered with ReplayMod from recordings of the trials.

## Status (2026-09-28)

- The first three in-game days (iron tools and armor, a shield, a bed, a home, no deaths) pass reliably.
- Fresh worlds reach the Nether in 7 to 30 minutes, and usually find a fortress.
- Blaze rods are the current wall. A handful of trials have taken one or two rods; none has taken the six needed. Most deaths are blazes at a spawner, ghast fireballs pushing the bot into lava, and running out of health in the Nether with little food.
- The dragon has only been fought from staged worlds.

Every trial and fix is logged in [docs/trial-notes.md](docs/trial-notes.md).

## How it works

Code decides what is possible. Jev decides what to do.

- Code builds the options from the game state. Jev never names a coordinate, item or command, and its pick is checked against what was offered.
- Each option's description says what it does, what it costs (damage and seconds, against the bot's actual health) and what it gains toward the goal. Mob behavior and numbers such as fireball knockback are taken from the game's own code and checked on a test server.
- Every play question also offers `none_good` ("the move a player would make is not listed"). Picking it logs a missing option and takes the best listed one. Those logs became a worklist for new options.
- If only one option is possible, Jev is not asked.
- Each question has a code fallback, used only if the service is down or too slow.

There are 91 questions, defined in [src/decisions/](src/decisions/index.js) and listed in [docs/decisions.md](docs/decisions.md). They cover fight stances, routes, when to give up on a goal, how to get out of lava or fire, and which part of the bot (survival, eating, work) gets the next turn. [How Jev thinks](docs/how-jev-thinks.md) walks through one request end to end.

Speed is what makes this work. A fight stance has to be chosen while a blaze is firing. Measured answers averaged 0.17 to 0.18 seconds, at about 500 decisions per trial per hour.

## What we tried and learned

**Confidence gates.** At first, a low-confidence pick was handed to hand-written rules. In practice the rules then played most of the hard moments. We now take Jev's pick at any confidence on play questions. Confidence bars remain only for requests from a person (chat, server commands, builds that replace something).

**Reflexes.** Lava escapes, fire escapes, creeper dodges and shield use used to run before Jev was asked. Several deaths started with a reflex (note 548). They are now questions, such as `body_way` for lava, fire and suffocation, with code only as the fallback (note 549).

**Who gets the turn.** Survival, eating and work each used to take control by their own rules. Now each states a claim and Jev picks one (`turn_priority`, [src/arbiter.js](src/arbiter.js)). The question can hang, so the arbiter falls back if the bot is hurt while waiting or five seconds pass.

**Fix facts, not add rules.** When Jev chooses badly, the fix is almost always a wrong price, a false fact or a missing option, not a new threshold. Example (note 614): Jev kept choosing cover with a blaze four blocks away. The cause was that the aggressive option was only offered with a shield, several options claimed a shield the bot didn't have, and no option said what it gained toward the rods. Fixing those changed the answers.

**Loops.** Deaths are easy to spot. Trials that stay busy without progressing are not: pacing a bridge for 70 minutes, or sitting in a sealed pocket for half an hour. Each feature used to keep its own list of what had failed, and none saw the others; one question was answered the same way 4,423 times. We replaced them with a single ledger ([src/tried.js](src/tried.js), note 571). An option that came to nothing twice rests for five minutes. When every option rests, the parent question is asked instead and told what failed. Waits and held stances are ledger entries too. A hold ends when something it was chosen on changes, not on a timer (notes 599, 611).

**Goal budgets.** Each step of the game (for example, "obtain blaze rods") gets ten minutes without progress. Then Jev is asked whether to keep going, change plan, or set it aside.

**Prices from the right fight.** Quoting an arena average against three distant blazes to a bot facing four at a spawner made charging in look cheap (note 602). Prices now come from the fight at hand.

**Blaze tactics.** We built boxing in, lighting the spawner, a corner ambush and retreating to heal, and measured them in an arena. At a live spawner none beat walking in and fighting. The safe ones produce no rods. They are still offered, with their measured numbers (note 606).

**A second model.** A generative model reviewing recovery decisions agreed with Jev, took 14 seconds, and cost about a hundred times more. We removed it.

**Judging trials.** Judging by deaths alone missed some of the worst trials, which never died. The progress audit and trail maps now flag trials that aren't getting anywhere.

## How we iterated

1. Run 7 to 20 trials in parallel, one Minecraft server each. Most start from saved stages (entering the Nether, reaching a fortress) so the hard parts get many attempts per hour.
2. A watcher reports each death or loop. The progress audit and trail maps catch trials that are stuck without failing.
3. A Claude subagent triages each failure in its own git worktree. It fixes the cause in general, adds tests that fail without the fix, checks the recorded question against live Jev before and after, and writes a trial note. Notes 500 to 616 were written this way.
4. Fixes are merged in a separate worktree after `npm test`, a `JEV_ARBITER=shadow` check and the replay suite. Bots run from the main checkout. Merging there once crashed 23 bots on conflict markers.
5. Bots pick up new code with a quiet restart: each quits once no mob is within 16 blocks, or after five minutes, and its supervisor restarts it.

## Tools

- **Flight record** ([src/recorder/](src/recorder/index.js)): one frame per second plus one per decision, with options, probabilities and latency.
- **Death timeline** ([scripts/death-timeline.js](scripts/death-timeline.js)): a trial's last seconds, frame by frame, with each decision.
- **Replay suite** ([scripts/replay-suite.js](scripts/replay-suite.js)): recorded questions from past failures, each with acceptable and forbidden answers, asked live five times. It runs in seconds with no server.
- **Arena** ([scripts/arena.js](scripts/arena.js)): staged fights (blaze spawner, wither skeletons, hoglins) that measure damage, time to kill and deaths. Its numbers are quoted to Jev.
- **Stage saves** ([checkpoint.sh](scripts/trials/checkpoint.sh), [start-stage.sh](scripts/trials/start-stage.sh)): world snapshots every 30 seconds, promoted to a stage save the first time a trial reaches the Nether or a fortress.
- **Trail maps** ([trail-map.js](scripts/trials/trail-map.js)): a top-down PNG of where a trial walked, colored by activity. They make pacing and circling easy to see.
- **Progress audit** ([progress-audit.js](scripts/trials/progress-audit.js)): time since the last milestone, new ground covered, repeated questions, wait share. `--cohort` compares all trials before and after a deploy.
- **Replays** ([death-camera.js](scripts/trials/death-camera.js), [highlights.js](scripts/trials/highlights.js)): trial servers record with ServerReplay, and these scripts write a third-person camera path around deaths and notable moments for rendering in ReplayMod.

Trial setup and ports are in [scripts/README.md](scripts/README.md).

## Running many trials on one machine

- CPU runs out first. Twenty trials saturated 16 cores and bots stalled 2 to 4 seconds at a time, which kills them in fights. About 14 is the practical limit.
- Disk fills quietly. Death snapshots reached 53 GB in a day; they are now kept for six hours with a free-space floor.
- On macOS, `pkill -f ... -P 1` matches far more than intended and once killed every trial server. Stop processes by PID only.
- The decision service has outages. The bot uses fallbacks and says so in chat; deaths during an outage aren't triaged.
- Anything that watches trials needs a timeout. A hung check once kept the watcher silent for five hours.

## Code map

| Area | Where |
| --- | --- |
| Questions, `none_good`, escalation | [src/decisions/](src/decisions/index.js) |
| TypeSafe client | [src/typesafe.js](src/typesafe.js) |
| Turn arbiter | [src/arbiter.js](src/arbiter.js) |
| Ledger and holds | [src/tried.js](src/tried.js), [src/holds.js](src/holds.js) |
| Survival and body dangers | [src/survival.js](src/survival.js), [src/body.js](src/body.js) |
| Fight prices | [src/combat-estimate.js](src/combat-estimate.js), [src/blaze-stand.js](src/blaze-stand.js) |
| Game ladder | [src/game-progress.js](src/game-progress.js), [src/work.js](src/work.js) |
| Nether travel | [src/nether-travel.js](src/nether-travel.js), [src/fortress-map.js](src/fortress-map.js) |
| Movement | [src/movement.js](src/movement.js), [src/motion.js](src/motion.js) |
| Trials | [scripts/trials/](scripts/trials/), [scripts/midgame.js](scripts/midgame.js) |

More in [docs/](docs/README.md), including the [rule audit](docs/rule-audit.md) of what code still decides.

---

## Using Jev as a chat companion

The same bot takes requests in game chat: gather, craft, build, explore, or pursue a long-term goal.

You need Node.js 22+, a Minecraft Java 26.1 server you run, and a TypeSafe or OpenRouter API key.

```sh
git clone https://github.com/mrubens/jevcraft.git
cd jevcraft
npm ci
cp .env.example .env   # set TYPESAFE_API_KEY and MC_HOST/MC_PORT
npm start
```

Use `MC_AUTH=microsoft` on an authenticated server, with the bot's own account. Start messages with "Jev":

| Request | What it does |
| --- | --- |
| `Jev follow me` | Follow until stopped. |
| `Jev get me a pumpkin` | Find, collect and deliver one. |
| `Jev give me full diamond armor and a bed` | Plan all items together. |
| `Jev find a cherry biome` | Explore. |
| `Jev build a small cherry mansion` | Design and build. |
| `Jev your dream is to beat the game` | A standing goal, pursued when idle. |
| `Jev remember this as home` / `Jev go home` | Named places. |
| `Jev status` / `stop` / `resume` | Control the current task. |

A new request replaces the current one, and tasks survive restarts (state is in `.bot-state/`). When a request is ambiguous, Jev asks. Building in Survival uses templates or 45 ready-made designs; in Creative with an OpenRouter key, a generative model can draw a schematic. Server commands work only for players in `MC_COMMAND_USERS`, and are never used on the bot's own initiative. Settings are in [.env.example](.env.example).

## Development

```sh
npm test                        # about 2,000 tests, no server or key
node scripts/replay-suite.js    # recorded decisions, asked live
```

Gameplay tests, trials and the arena need a separate, disposable server. See [CONTRIBUTING.md](CONTRIBUTING.md). Flight records and logs can contain chat, player names and coordinates, so review them before sharing. The [roadmap](ROADMAP.md) has what's next. MIT License ([LICENSE](LICENSE)).

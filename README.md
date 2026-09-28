# jev-craft

jev-craft is a harness that lets a decision model play Minecraft Survival. The model is [TypeSafe's Jev](https://typesafe.ai/), a [System One](https://docs.typesafe.ai/concepts/system-one) model: it takes a state and a set of typed options and returns a choice with probabilities, in about 0.2 seconds. The bot is built on [mineflayer](https://github.com/PrismarineJS/mineflayer). Code owns the mechanics of the game. Jev makes the judgments: when to fight or run, which way to go, when a plan has stopped working.

The goal is the whole game from a fresh world with an empty inventory: Overworld, Nether, blaze rods, Eyes of Ender, the stronghold and the dragon ([GOAL.md](GOAL.md)). Getting there has meant running many trials in parallel and triaging every death and every loop. This README is mostly about what that taught us: how to give a model real agency in a game, how to present decisions to it, and how to build the loop that improves the harness. Jev can also be used as an in-game chat companion; that material is [further down](#using-jev-as-a-chat-companion).

- [Where it stands](#where-it-stands)
- [The split: mineflayer and code for mechanics, Jev for judgment](#the-split-code-for-mechanics-jev-for-judgment)
- [Giving Jev agency](#giving-jev-agency)
- [How a decision is presented](#how-a-decision-is-presented)
- [How fixes are made](#how-fixes-are-made)
- [Loops, progress and the ledger](#loops-progress-and-the-ledger)
- [The iteration loop](#the-iteration-loop)
- [Tools and artifacts](#tools-and-artifacts)
- [Running many trials at once](#running-many-trials-at-once)
- [What did not work](#what-did-not-work)
- [Code map](#code-map)
- [Using Jev as a chat companion](#using-jev-as-a-chat-companion)

## Where it stands

As of 2026-09-28:

- **The Overworld is mostly solved.** Fresh worlds reach the Nether in roughly 7 to 30 minutes of play.
- **Fortresses are found often**, and many trials reach one.
- **Blaze rods are the wall.** For most of the run's history, no trial had taken a single rod (note 577). On 2026-09-28 a few did: the fresh world mid-242-ba reached the Nether in 7 minutes and a fortress at minute 35 and took two rods; mid-243-ah (Nether at 23, fortress at 44) and mid-242-ba-fortress-4 took one each; the progress audit counts 5 fortress-start trials with a first rod. All then died to blazes. Six are needed.
- **The current killers** are blazes at a live spawner, ghast fireballs that push the bot off a ledge into lava (notes 610, 612), and low health that never comes back in the Nether, where there is little food (note 607).

The first-days milestone, three in-game days with no deaths and iron tools, armor, a shield, a bed and a home by minute 45, has passed repeatedly ([GOAL.md](GOAL.md#where-it-stands)). The dragon has been fought in rehearsals from staged worlds, never reached from a fresh start. Every trial and what it changed is in [docs/trial-notes.md](docs/trial-notes.md), newest first.

## The split: code for mechanics, Jev for judgment

Most "LLM plays Minecraft" projects hand a large model the whole problem and parse what comes back. jev-craft splits the work the other way.

**Code, mostly mineflayer and its plugins, owns the mechanics:**

- **Movement.** Pathfinding is `mineflayer-pathfinder` with custom movement rules in [src/movement.js](src/movement.js): lava shores, jumps priced by what is under the gap, and moves refused where they would drop a gravel or sand floor lying on lava (note 592).
- **Digging.** A dig guard wraps `bot.dig` ([src/skills.js](src/skills.js) `digGuardPlugin`) and refuses a dig that would let lava in, drop the bot into lava, or collapse the gravel or sand floor it stands on (note 600).
- **Physics.** Knockback, falls and whether a step holds are checked with prismarine-physics ([src/motion.js](src/motion.js), [src/combat-estimate.js](src/combat-estimate.js)).
- **Crafting.** Recipes, smelting and plans come from the real game data ([src/knowledge.js](src/knowledge.js), [src/plan.js](src/plan.js), [src/batch-plan.js](src/batch-plan.js)).
- **Building.** Bridging, pillaring, shelters and schematics ([src/bridging.js](src/bridging.js), [src/shelter.js](src/shelter.js), [src/builds.js](src/builds.js)).
- **Feasibility.** Code works out what is possible right now: which routes exist, which blocks are carried, which stances can be carried out from here.
- **Bookkeeping.** What has been tried, and what came of it.

Built-in skills live in `src/*.js`, one file per capability: [src/tunneling.js](src/tunneling.js), [src/blaze-tactics.js](src/blaze-tactics.js), [src/nether-travel.js](src/nether-travel.js), [src/portal-cast.js](src/portal-cast.js), [src/mob-hunt.js](src/mob-hunt.js), [src/healing.js](src/healing.js), and so on. A skill knows *how* to do something. It does not decide *whether* to do it.

**Jev owns the judgments.** It picks the stance in a fight, the way toward a fortress, whether to keep at a rung of the game or set it aside, which way out of lava, and which layer of the bot gets the turn. All 91 questions are defined in [src/decisions/](src/decisions/index.js) and listed with their options in [docs/decisions.md](docs/decisions.md), which is generated from that code.

Two rules keep the line sharp ([CONTRIBUTING.md](CONTRIBUTING.md)):

1. **Jev chooses, code enumerates.** The model never names a coordinate, an item or a command. Code builds the options from the game state, and Jev's pick is checked against what was offered before anything runs.
2. **Judgments go to Jev, with the facts.** Offer a real choice as options, with the numbers that bear on it. Do not settle it with a rule.

## Giving Jev agency

The operator's standing instruction was: *"Let Jev choose: judgments go to Jev as options with honest facts, not hidden rules. Hard rules only for physical safety."* It took several passes to take that seriously.

**Pass 1: confidence gates came off play decisions.** Early on, a stance Jev picked with low confidence went to hand-written rules for fifteen seconds. Now Jev's pick is taken at any confidence on every play question. Confidence bars remain only where a person is on the other end: a chat request, a server command, a build that would replace something. Below the bar, the bot asks the player. [docs/rule-audit.md](docs/rule-audit.md) lists each rule that was handed over and the probe that checked it.

**Pass 2: hidden options came out.** Health thresholds that hid a stance, a creeper dance that ran before the question was asked, and a three-failure rule that moved on by itself all became options with their costs stated.

**Pass 3: reflexes went to Jev (note 549).** The operator asked: "Which reflexes do we have? Can we get rid of them and just ask Jev". The answer was yes, for almost all of them:

- **Lava, fire, suffocation and air** are one question, `body_way` ([src/body.js](src/body.js)). Each way out comes with where it goes, how many seconds it takes, and how long the body lasts at the current damage rate.
- **The encounter's first moves** are stance options: holding on a one-block span, fighting from an edge, blocking a creeper's line.
- **The shield** is `shield_policy`. A shot is in the air for less time than an answer takes, so Jev is asked in advance what to do about the shooters that are around.

Code still acts in these moments, but only as each question's **fallback**: the answer used when Jev cannot be reached or has not answered in time. The fallback is part of the question's definition (`define` in [src/decisions/index.js](src/decisions/index.js)), not a rule that runs first.

**Pass 4: who acts is Jev's too (notes 536, 539).** The survival layer, the meal and the work each used to take the turn by their own rules. Now each layer states what it would do as a *claim* with the facts behind it. The arbiter ([src/arbiter.js](src/arbiter.js)) sends two or more claims to Jev as one question, `turn_priority`. This is live on every trial. `JEV_ARBITER=shadow` keeps the old order, logged beside Jev's ruling for comparison. The one lesson that pushed back (note 539): a question can hang. So the arbiter watches its own question and gives the turn by the fallback if the bot is hurt while waiting or five seconds pass.

This only works because of speed. Answers come back in about 0.2 seconds. Note 530 measured 518 to 539 decisions an hour per trial at 0.17 to 0.18 seconds on average, the slowest 0.8. A frontier LLM taking several seconds per call could not make a stance decision while a blaze is firing. A System One model can.

## How a decision is presented

Every question is a tree of typed options. Each option has a `description` that says three things: what the option does, what it costs in damage and seconds from this bot's health, and what it gains toward the goal. Here is a real question from the replay suite (case `poisoned-by-witch-apple-offered`, from note 442). The bot is at 1 health, poisoned, in full iron, with a witch 19 blocks off. The descriptions are shortened here:

> **fight**: Fight here ... about 10.2 seconds and 14.4 damage to kill them all, from 1 health (more than the bot has) ... At 1 health, 1 potion from the witch (about 6 each after armour) end it.
>
> **pillar**: Go two blocks straight up ... Two up does not stop a witch (throws potions up) ...
>
> **eat_golden_apple**: Eat the golden apple now (2 carried): about 1.6 seconds eating while the mobs hit, then four extra health as absorption and regeneration of about eight health over five seconds.
>
> **retreat**: Run for footing out of the mobs' reach and sight ... A witch walks after a player it has seen and throws within about ten blocks; a run that stays in its sight stays in its reach.

The phrase "more than the bot has" does a lot of work. So do the facts about each mob's behavior, which are read from the game's own code.

**The state carries the context a player would have.** Besides health, armor, threats and a fight estimate, play questions get:

- `riskNow`: how bad things are right now.
- `deathWouldCost`: what would drop, the walk back from respawn, and the real minutes to make it all again.
- `healing`: whether health comes back here at all.
- `runClock` and pace: minutes spent, set against how fast a practiced player gets there.
- `recentPositions`: where the bot has been over the last few minutes, so it can see a loop.
- The ledger's record of what was already tried from here (below).

The shared guidance explaining each of these fields is added to the instructions only when the field is present (`withRealTime` in [src/decisions/index.js](src/decisions/index.js)).

**`none_good` is always on offer.** Every play question with two or more options also offers "none of these options are good: the move a player would make here is not among them." Picking it records a missing option in the log, and the best listed option is taken in the meantime. The recorded misses became a worklist: many options in [docs/decisions.md](docs/decisions.md) exist because Jev said one was missing. Two confident `none_good` answers in a row to the same situation mark that question as spent, and the question above it is asked instead (note 599).

**A question with one feasible option is not asked.** The one way is taken and logged as such. The decision log then shows how often the model was actually needed.

For the full anatomy of one request, with real latencies and token counts, see [How Jev thinks](docs/how-jev-thinks.md).

## How fixes are made

When Jev chooses badly in a trial, the fix is almost never a rule. The question to ask is: *what did Jev not know, or what did the code get wrong about the game?* The operator's shorthand was "no bandaids; give Jev facts, not hidden thresholds." In practice, a fix is usually one of three things:

- **An honest fact.** A price was wrong, a fact was false, or something the choice turns on was missing.
- **A price from the game's own numbers.** How far a blaze hovers, when a spawner fails in light, and how hard a ghast fireball pushes were all read from the 26.1.2 server jar, then checked on a test server.
- **The missing option.** Offer the whole game tree: every route a player would really consider, as an option with its price.

Note 614 is a typical example. The operator, watching a trial, said: "It seems like it should charge the thing more." A blaze was four blocks off, and Jev kept choosing cover and retreat. The triage found no bad judgment, but several things the question got wrong:

> close_in ... was offered only with a shield in the off hand; this bot had none, so neither question could offer it. ... several facts were false or missing. ... fight_at_spawner, dig_in_at_spawner, box_here and corner_ambush each said "the shield up" ... with no shield carried. ... And no option said what it gains toward the rods: cover, heal, retreat and seal were priced in damage alone.

The fix offered `close_in` without a shield, priced accordingly. It added `charge_nearest`, which goes after one blaze and asks again after the kill. It corrected the false facts. And every blaze option now says what it gains toward the rods; for cover, heal, retreat and defer, that is nothing. No threshold was added, and Jev still decides.

Each fix is tested twice:

- **Unit tests** that fail without the fix.
- **A live probe.** The recorded question is asked of Jev five times before the change and five times after. If the answers don't move, the fix hasn't landed yet.

## Loops, progress and the ledger

Deaths are easy to see. The harder failure is a bot that is **busy but not progressing**: walking back and forth at a fortress for seventy minutes (note 558), or sitting in a sealed pocket for half an hour (notes 589, 597). The operator pushed to judge trials by progress, not only by deaths, and most of the harness's structure came out of that.

**One ledger of what was tried ([src/tried.js](src/tried.js), note 571).** Every place that offered ways used to keep its own memory of what had failed. There were seven or more such memories, each with its own radius and clock, and none saw the others. On one trial, `fortress_approach` was answered `other_way` 4,423 times. Now every answer, asked or taken as the only way, is a ledger entry with its question, where it was going, and what came of it: progressed, blocked with a reason, waited, or pending. Every play question reads the ledger:

- An option tried from here recently and come to nothing says so in its description.
- Come to nothing twice, it **rests** for five minutes, left out and listed in `waysResting`.
- When every option rests, the question is **not asked again**. Its parent is asked instead, told what failed below (`whatFailedBelow`). Parents are declared in each question's definition: step, way, plan, rung.

**Waits and holds are entries too (notes 599, 611).** The first ledger left out the layer where most of the day's loops lived: stances, pockets, pillars and `turn_priority`. Now a wait records the scene it began in. If that scene did not change (same health, same place, same mobs, no swing), the wait came to nothing and rests like any other way. A held stance ([src/holds.js](src/holds.js)) ends when something observed contradicts what it was chosen on, not when a clock runs out. Note 611 found four leaks in the hold rule, among them that nested answers were never held and that a hold could fall out of a capped ledger. Each was fixed in general.

**Rungs have a budget (notes 583, 588, 605).** Each rung of the game ladder, such as "obtain blaze rods", gets ten minutes on the wall clock with nothing to show: no milestone, no new best distance to its target, no new ground. Then `rung_progress` asks Jev whether to keep at it, change the plan, or set it aside, with what has been tried in front of it. Setting aside and taking up again are both Jev's answers.

## The iteration loop

The harness improved through a loop that ran for days with an operator (an AI agent) and a human user:

1. **About 14 to 20 trials run in parallel**, each on its own Minecraft server and port. Some start from fresh worlds. Most start from saved stages (below), so the hard parts get tried many times an hour.
2. **A watcher wakes the operator** on a death or a loop. Every hour or so the operator also runs the progress audit and looks at trail maps for trials that are busy but getting nowhere.
3. **Each death, loop or stall is triaged by an Opus subagent** in its own git worktree. It reads the flight record, the death timeline and the world's region files, finds the cause, and fixes the general rule: facts, prices or options, not a special case. It adds tests that fail without the fix, probes live Jev five times on the recorded question before and after, and writes a numbered entry in [docs/trial-notes.md](docs/trial-notes.md). Notes 500 to 614 were written this way.
4. **Fixes are squash-merged in a separate merge worktree.** There they run through `npm test` (about 2,000 tests, no network), a `JEV_ARBITER=shadow` check, and the replay suite. Then main is fast-forwarded. Merging in the main checkout directly once crashed 23 running bots, because the bots load code from that checkout and it briefly held conflict markers.
5. **Running bots pick up the new code through a quiet restart.** The operator touches `.bot-state/restart-requested`. Each bot quits once nothing hostile is within sixteen blocks and it stands on dry ground, or after five minutes ([src/quiet-restart.js](src/quiet-restart.js)), and its supervisor starts it again. Killing bots mid-fight had caused deaths right after restarts.
6. **Every three hours a Fable subagent gives read-only design advice** on the open problems. The operator acts on the advice that holds up and doesn't wait on the rest. One review found that holds and stances were exempt from the ledger, which explained a whole class of loops (note 599). Another recommended one shared ledger instead of seven separate memories (note 571).

## Tools and artifacts

These tools were built as the loop needed them. Each exists because something was being missed.

**The flight record** ([src/recorder/](src/recorder/index.js)). What the bot saw and did, one frame a second and one at every decision, in `.bot-state/flight/`. Each decision is framed the moment Jev answers, with its options, probabilities and latency. `node scripts/flight.js --deaths` prints the frames before each death.

**Death timeline** ([scripts/death-timeline.js](scripts/death-timeline.js)). A trial's last seconds, frame by frame: health, position, who held the turn, the mobs about, and each Jev decision with its weights, how long it took and the health when it was asked. `--options` prints the option descriptions. This is the first thing a triage reads.

**Replay suite** ([scripts/replay-suite.js](scripts/replay-suite.js), [evals/replays/cases.jsonl](evals/replays/cases.jsonl)). Recorded questions from deaths and loops, each with the answers that are acceptable and the ones that are forbidden. Each case is asked live five times, in seconds, with no Minecraft server. A case passes when most answers are expected and at most a third are forbidden. Some cases are marked `known`: gaps that are listed, not failed. Borderline cases get loosened when every option is fatal. In the witch case above, at 1 health, the apple and the retreat are both accepted, because neither is clearly right. It runs before every merge that touches what Jev is told.

**The arena** ([scripts/arena.js](scripts/arena.js), [scripts/lib/arena.js](scripts/lib/arena.js)). Drills staged on a separate server, such as a live blaze spawner, a wither skeleton pair or a hoglin herd. Each drill runs the real survival and hunting code against the encounter and measures damage, time to kill, rods taken and deaths. `ARENA_LOADOUT=trial` uses the kit trials actually carry. `ARENA_PREFER` forces one tactic, to measure it alone. The arena's rows are quoted to Jev in the option descriptions ("as measured"). Note 606 built four player tactics against blazes (a box with a window, lighting the spawner, a corner ambush, retreating to heal). None beat walking straight in (`close_in`) at a live four-blaze spawner. The ones that were safe once set up, but killed nothing, are offered with their numbers. The ones that could not be done under fire are offered only in the arena.

**Stage saves** ([scripts/trials/checkpoint.sh](scripts/trials/checkpoint.sh), [start-stage.sh](scripts/trials/start-stage.sh)). Every 30 seconds, each trial's world and bot state go into a ring of snapshots. When the bot dies, the last three are kept. The first time a trial reaches the Nether or a fortress, a snapshot is promoted to a stage save. `start-stage.sh <port> fortress` starts a new trial from the least-used save, so most trials start at the hard part. [start-fresh.sh](scripts/trials/start-fresh.sh) starts one from a first-days world instead.

**Trail maps** ([scripts/trials/trail-map.js](scripts/trials/trail-map.js), note 562). One PNG per trial: a top-down map of the ground it walked, read from the server's saved region files, with a side view underneath. The path is colored by what the bot was doing, with a dot each minute, deaths and mobs marked, and the audit's flags in the header. A bot pacing a bridge, stuck on a pillar or circling a fortress wall is obvious at a glance. Written with a pure-JS PNG writer and no new dependencies. The human user especially liked these.

**Progress audit** ([scripts/trials/progress-audit.js](scripts/trials/progress-audit.js), notes 558, 573, 598). Per trial over a recent window, it reports:

- Where the trial is, and how long since its last milestone.
- Minutes by step or rung.
- New ground covered against ground walked before.
- The questions asked most and their commonest answer.
- The loop measures: `reaskAfterHold`, `quickNothing` (answers that came back within seconds with nothing to show), `stallShare`, `waitShare`, the stance rate while nothing changes, and the longest `none_good` run.

Each flag states its threshold. `--cohort <time>` sums the measures over every trial before and after a deploy, which is how a fix is shown to have worked, or not (note 611 traced a deploy after which re-asks following a hold jumped from about 7 an hour to about 103).

**Death replays.** Trial servers run Fabric with ServerReplay, which records the bot from join to leave. [scripts/trials/death-camera.js](scripts/trials/death-camera.js) writes a third-person camera path around each death into the replay, so ReplayMod can render real footage of what happened.

**Supporting scripts:**

- [watch.sh](scripts/trials/watch.sh) returns when a trial's verdict is done or has failed by a death or a loop. Each check has a two-minute limit; a check that hung once kept it silent for five hours while trials failed.
- [supervisor.sh](scripts/trials/supervisor.sh) restarts a bot whose flight record goes quiet for 60 seconds.
- [scripts/midgame.js](scripts/midgame.js) starts a trial and gives it a verdict. It also makes a watching player (`TRIAL_WATCHER`, DoloresDoodle by default) an operator on every trial server, so the human can spectate ([spectate.sh](scripts/trials/spectate.sh)).
- [setup.sh](scripts/trials/setup.sh) builds the trial servers from scratch: Java 25, the 26.1.2 server, Fabric and ServerReplay.

The ports and server folders are listed in [scripts/README.md](scripts/README.md).

## Running many trials at once

Operational lessons from running 14 to 20 trials on one 16-core machine:

- **CPU is the real limit.** Twenty trials saturated 16 cores, and bots stalled for 2 to 4 seconds at a time, which is fatal in a fight. The cap became about 14. The ReplayMod client is closed when not in use. The human user later asked for 7, to keep the machine usable.
- **Disk fills quietly.** Death snapshots reached 53 GB (190 deaths in a day). Now a death keeps three snapshots for six hours, and the oldest go first when free space drops below 25 GB ([checkpoint.sh](scripts/trials/checkpoint.sh)).
- **Never pattern-kill processes.** On macOS, a subagent's `pkill -f ... -P 1` killed every process with "1" in its command line, including every trial server. Agents now stop only the exact process IDs they started, and restarts go through the quiet-restart file.
- **The decision service can go down.** During outages (503s and 520s) the bot walks each question's fallback and says so once in chat. Deploys and triage pause until the service is healthy, and deaths during an outage are not triaged: they say nothing about Jev.
- **A watcher needs its own watchdog.** Any check that can hang needs a time limit (see `watch.sh`).
- **Slow answers are usually the service, not the prompt.** Note 614 found stance questions of 1,500 and 8,000 tokens equally slow in the same minute, and equally fast a minute later.

## What did not work

- **Confidence gates on play.** Handing an unsure pick to rules for fifteen seconds meant the rules played most of the hard moments. Taking Jev's pick at any confidence, with honest prices, did better.
- **Reflexes run before the question.** They pre-empted Jev in exactly the moments that mattered, and several deaths started with a reflex (note 548).
- **Per-feature memories of failure.** Seven or more separate "tried here" lists, each blind to the others, produced loops of thousands of re-asks (note 571).
- **Clock-based holds.** Asking a held stance again every fifteen seconds produced 48 identical answers over a crossbow piglin that never shot (note 590). Holds now end on observed change.
- **Prices from the wrong fight.** Quoting the arena's median against three distant blazes to a bot facing four at a spawner made `close_in` look cheap (note 602). Prices now come from the fight at hand.
- **Player tactics that sound right.** Boxing in, lighting the spawner and corner ambushes are safe, but at a live spawner they don't produce rods (note 606).
- **A second opinion from a generative model** on recovery decisions agreed with Jev in fourteen seconds at a hundred times the cost, and was removed ([How Jev thinks](docs/how-jev-thinks.md#when-things-go-wrong)).
- **Judging trials by deaths alone.** Several of the worst trials never died. They walked in circles for an hour.

## Code map

| Area | Where |
| --- | --- |
| Every question Jev is asked; `decide`, `none_good`, escalation | [src/decisions/](src/decisions/index.js) |
| The TypeSafe client | [src/typesafe.js](src/typesafe.js) |
| Who gets the turn (`turn_priority`) | [src/arbiter.js](src/arbiter.js) |
| The ledger of what was tried | [src/tried.js](src/tried.js), [src/decisions/repeats.js](src/decisions/repeats.js) |
| Stance holds | [src/holds.js](src/holds.js) |
| Stall detection and waits | [src/stillness.js](src/stillness.js) |
| Survival, stances, the body's dangers | [src/survival.js](src/survival.js), [src/body.js](src/body.js), [src/vitals.js](src/vitals.js) |
| Fight prices | [src/combat-estimate.js](src/combat-estimate.js), [src/blaze-stand.js](src/blaze-stand.js), [src/risk.js](src/risk.js) |
| The game ladder and its rungs | [src/game-progress.js](src/game-progress.js), [src/strategy.js](src/strategy.js), [src/work.js](src/work.js) |
| Nether travel and fortresses | [src/nether-travel.js](src/nether-travel.js), [src/fortress-map.js](src/fortress-map.js) |
| Movement and pathfinding rules | [src/movement.js](src/movement.js), [src/terrain.js](src/terrain.js), [src/motion.js](src/motion.js) |
| Flight recording | [src/recorder/](src/recorder/index.js) |
| Trial scripts | [scripts/trials/](scripts/trials/), [scripts/midgame.js](scripts/midgame.js), [scripts/first-days.js](scripts/first-days.js) |

Further reading:

- [How Jev thinks](docs/how-jev-thinks.md): one request, end to end.
- [Every question](docs/decisions.md): the generated list of questions and options.
- [Rule audit](docs/rule-audit.md): what code still decides.
- [Trial notes](docs/trial-notes.md): the lab notebook.
- [docs/](docs/README.md): everything else.

---

## Using Jev as a chat companion

The same bot is a Minecraft companion you talk to in game chat. Ask it to gather, craft, build, find a biome, or chase a long-term goal. Every judgment about what you meant goes through the same questions and is logged.

### Quick start

You need:

- Node.js 22 or newer.
- A Minecraft Java Edition 26.1 server you run. The repository does not include one.
- A TypeSafe API key, or an OpenRouter key.

```sh
git clone https://github.com/mrubens/jev-craft.git
cd jev-craft
npm ci
cp .env.example .env
```

Edit `.env`:

```dotenv
TYPESAFE_API_KEY=your_typesafe_key
# or OPENROUTER_API_KEY=your_openrouter_key

MC_HOST=localhost
MC_PORT=25565
MC_VERSION=26.1
MC_USERNAME=Jev
MC_AUTH=offline
```

Use `MC_AUTH=microsoft` on an authenticated server, with the bot's own account. Then start the bot with `npm start`, join the same server, and try `Jev come here`, `Jev craft me a chest` or `Jev build a house`. The console prints each step and the decision behind it.

### Talking to Jev

Start a message with "Jev" or the bot's username. These are examples, not a fixed vocabulary:

| Request | What it does |
| --- | --- |
| `Jev follow me` | Follow until stopped or replaced. |
| `Jev get me a pumpkin` | Find, collect and deliver one. |
| `Jev give me full diamond armor and a bed` | Plan all five items together, sharing materials. |
| `Jev get me 32 purple concrete` | Craft the powder, harden it in water, deliver. |
| `Jev find a cherry biome` | Explore using observed biome data. |
| `Jev build a small cherry mansion` | Design and build a structure. |
| `Jev find a way to the Nether` | Build or find a portal and cross. |
| `Jev status` / `stop` / `resume` | Report, pause or continue the current task. |

"For me" means delivery: `Jev craft me a chest` brings it to you. A new request replaces the active one. Tasks survive reconnects and restarts; state lives in `.bot-state/`. When Jev is unsure what you meant, it asks ("Did you mean short grass or grass block?") instead of guessing. The confidence it needs scales with the stakes: 0.5 to come here, 0.65 for builds and the Nether, 0.75 to forget something.

### Dreams

Give Jev a standing goal and it pursues it whenever nothing else needs it:

```text
Jev your dream is to beat the game
Jev your dream is to build a village
Jev set your dream aside
Jev chase your dream
```

**Beat the game** follows the survival ladder: stone tools, iron, a shield, a bucket, a home base with a bed, farm and stash chest, iron armor, then the Nether, blaze rods, Eyes of Ender, the stronghold and the dragon. Progress is read from the world, never from a counter.

**Build a village** has Jev pick the next part from what already stands, choosing from 45 validated designs.

A chat request always comes first, and the dream resumes afterward.

### Memory

```text
Jev remember this as home
Jev go home
Jev remember I prefer cherry planks
Jev make another one like last time
Jev forget home
```

Places carry their dimension. Jev also learns a soft wood preference from ordinary requests. Notebooks are per player, in `.bot-state/*-memory.json`.

### Building

In Creative with an OpenRouter key, a generative designer draws a schematic from the request and a terrain survey. Code validates it, and Jev judges whether it answers the request before any blocks are placed. In Survival, Jev configures cottage, mansion or tower templates, or picks from 45 ready-made designs in `data/schematics`. Structures go up to 25 × 16 × 25 in the ordinary case, with at most 16 materials. Jev never builds over a structure it did not place.

### Configuration

| Setting | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | Use Jev through TypeSafe. |
| `OPENROUTER_API_KEY` | Use Jev through OpenRouter, and enable the Creative designer. |
| `JEV_PROVIDER` | Force `typesafe` or `openrouter`. |
| `TYPESAFE_DEFAULT_MODEL` | Default `jev-latest`. |
| `OPENROUTER_JEV_MODEL` | Default `typesafe/jev-1.13`. |
| `BUILD_DESIGNER` | `auto`, `jev` (templates only) or `openrouter`. |
| `OPENROUTER_BUILD_MODEL` | The generative building model; default `anthropic/claude-opus-5.5`. |
| `RECOVERY_ADVISER` | `jev` (default) or `off`. |
| `JEV_ARBITER` | Live by default; `shadow` keeps the old turn order and logs Jev's ruling beside it. |
| `JEV_FLIGHT` | `0` turns off the flight recording. |
| `MC_COMMAND_USERS` | Players allowed to ask for server commands (see below). |

See [.env.example](.env.example) for the rest. Keep credentials in `.env`, which git ignores.

**Operator commands.** With `MC_COMMAND_USERS` set and the bot given permissions, requests like `Jev make it daytime` are translated into server commands. Jev walks the server's own command tree and checks the result against the request before running it. Commands are never used on the bot's own initiative.

### Seeing what Jev decided

- **The console** prints a JSON line per step, with the decision, its path and Jev's probabilities.
- **The decision trail** is kept with each task in `.bot-state/`, including one-way steps and fallback decisions.
- **The flight recording** is in `.bot-state/flight/`, kept for a day. `node scripts/audit-day.js` audits a day for standing still, retries and damage.
- **The run ledger**, `.bot-state/run-ledger.md`, has calls, tokens and latency per run.

### Development

```sh
npm test                           # about 2,000 tests, no server or key
npm run plan -- iron_pickaxe 1     # the recipe planner, offline
node scripts/replay-suite.js       # recorded decisions, asked live
node scripts/eval-intents.js       # chat routing, asked live
node scripts/eval-decisions.js     # trade-off judgments, asked live
```

Gameplay tests, trials and the arena need a separate, disposable server. [scripts/README.md](scripts/README.md) lists every script and its port. Contributions are most useful when they turn a concrete failure into a test and a general fix; see [CONTRIBUTING.md](CONTRIBUTING.md). Flight records and logs can contain chat, player names and coordinates, so review them before sharing.

The [roadmap](ROADMAP.md) has what comes next. jev-craft is released under the [MIT License](LICENSE).

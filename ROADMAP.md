# Roadmap

The goal is to beat Minecraft from a fresh Survival world with an empty inventory, with Jev making the judgment calls and no help from commands, kits or a person ([GOAL.md](GOAL.md)). The items are in order of priority, without dates. Where things stand is in the [README](README.md#where-it-stands) and the [trial notes](docs/trial-notes.md).

## Done

- The first three in-game days, passed by four trials so far (`scripts/first-days.js`). Two passes in a row is still open.
- Reaching the Nether from a fresh world (15 of 40 on 2026-09-28, median 28 minutes) and finding a fortress.
- Most reflexes and hand-written rules handed to Jev as questions ([rule audit](docs/rule-audit.md)).

## Now: blaze rods

Six rods from a fortress without dying. A few trials have taken one or two. What kills the bot:

- Blazes at a live spawner. The arena shows walking in and fighting is the only tactic that gets rods; the work is in pricing it honestly and knowing when to leave and heal.
- Ghast and blaze fireballs pushing the bot off a ledge into lava.
- Low health that doesn't come back in the Nether, where food is scarce.

Alongside: trials that stay busy without progressing (pacing, sitting in a shelter, flipping between two plans). The progress audit and trail maps flag these.

The milestone is two fortress runs in a row that reach six rods and twelve pearls with no deaths and no loops.

## Next: the End

- Ender pearls: endermen in warped forests, or bartering with piglins.
- Eyes of Ender, following their flight to a stronghold, and finding the portal room.
- The dragon: crystals, the fight, food, falls and the exit portal. So far it has only been fought from staged worlds.
- One continuous run from a fresh world, checked independently: Normal difficulty, no item grants, teleports, Creative mode or manual help.

## Companion

The chat companion runs on the same code, so the game work improves it too. Open items: longer multi-item requests without repeated work, keeping a request through a death or disconnect, oriented blocks (stairs, slabs, doors) in builds, and farming, breeding and trading as ways to get items.

## Tooling

- Faster, more reliable trial infrastructure on one machine.
- More replay cases from real failures, so changes to what Jev is told are checked before they ship.
- Better camera paths for rendered replays (the camera sometimes clips into blocks).

Contributions are most useful when they turn a concrete failure into a small test and a general fix; see [CONTRIBUTING.md](CONTRIBUTING.md).

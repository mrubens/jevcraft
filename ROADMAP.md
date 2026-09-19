# Roadmap

The aim is a useful Minecraft companion: describe an outcome, and Jev works toward it, handles ordinary setbacks, and stays understandable while you play together. Eventually, that includes beating Minecraft from a fresh Survival start.

These are development priorities, not release dates. Existing capabilities and setup instructions are in the [README](README.md).

## First: a more reliable companion

- **Finish combined tasks efficiently.** Strengthen shared material planning, inventory reservations, furnace recovery, and delivery across long requests. Avoid repeated gathering trips and duplicate handovers after interruptions.
- **Keep moving in natural terrain.** Improve swimming, shore exits, uneven footing, cave access, and getting off scaffolding. Detect a failed approach and try a different one before repeating it.
- **Recover without losing the request.** Improve tool replacement, food preparation, death recovery, and resuming after a disconnect. Make blockers specific enough for a player to understand and help with.
- **Leave tall canopies safely.** Leaf-covered access works in controlled tests, but the preserved natural run `mu8yf4yy` still needs a supported descent to lower logs and ground. Nighttime shelter preparation must also avoid repeatedly requesting ground-level dirt from an unreachable perch.
- **Make interruptions predictable.** Keep stop responsive during travel, model calls, crafting, and construction. Preserve the useful parts of a task when it is paused or replaced.
- **Keep chat brief and useful.** Report meaningful changes and explain problems in everyday language; keep detailed diagnostics in the Observatory.

Success looks like an ordinary play session in which Jev completes multi-item requests, survives routine interruptions, and resumes without repeating work or requiring a restart.

## Next: better building and exploration

- **Make custom builds dependable.** Improve material estimates, inventory-sized construction batches, reachable placement order, and cleanup across a wider range of advisor-generated structures.
- **Prepare more useful sites.** Extend natural-ground leveling and supported foundations while protecting existing builds. Account for the cost of earthworks when choosing a location.
- **Expand the building vocabulary.** Add block-state-aware placement for stairs, slabs, doors, and other oriented blocks, with checks that entrances and usable spaces work as intended.
- **Travel farther with purpose.** Improve persistent resource and biome search, route memory, and return trips. Extend boats beyond short, fully observed crossings.
- **Learn more acquisition methods.** Add farming, breeding, trading, and enchanting so catalog requests can use more of Minecraft’s progression paths.

Success looks like Jev finding supplies beyond the immediate area, returning reliably, and building varied, usable structures from descriptions with ordinary Survival materials.

## Longer term: complete the Survival journey

- **Reach the Nether from a fresh start.** Gather supplies, maintain tools, build or use a portal, and establish a survivable route home.
- **Obtain End supplies naturally.** Find suitable mobs, acquire blaze rods and pearls, and craft Eyes of Ender through ordinary gameplay.
- **Reach and activate a stronghold portal.** Follow observed Eye trajectories, navigate to the portal room, and prepare for the End.
- **Defeat the dragon and return alive.** Handle crystals, combat, food, falls, and the exit portal as one continuous objective.
- **Verify the whole run independently.** Complete a fresh natural Normal-difficulty run from empty inventory, without item grants, teleports, Creative mode, privileged locating, or manual gameplay assistance. Individual mechanics tests do not satisfy this milestone.

## Alongside the gameplay work

- **Easier setup:** clearer configuration, connection diagnostics, and contributor instructions.
- **Repeatable validation:** automated checks and reproducible isolated gameplay fixtures, with failures that are easy to inspect.
- **Better observability:** clearer material plans, progress, blockers, and model usage in the Observatory; recordings that make regressions easier to reproduce.
- **Version maintenance:** keep Minecraft recipes, protocol compatibility, and supported-version documentation aligned.

Contributions are especially useful when they turn a concrete gameplay failure into a small, reproducible test and an improvement to a general capability.

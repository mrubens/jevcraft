# Roadmap

The aim is a useful Minecraft companion: describe an outcome, and Jev works toward it, handles ordinary setbacks, and stays understandable while you play together. Eventually, that includes beating Minecraft from a fresh Survival start.

These are development priorities, not release dates. Existing capabilities and setup instructions are in the [README](README.md).

## Now: the first three days, played by Jev

- **Pass the first-days audit on two fresh worlds in a row.** No deaths, no step retried in a loop, never standing still outside a shelter, and iron tools, iron armour, a shield, a bed and a home within three in-game days (`scripts/first-days.js`). The best trials reach everything but the armour; [trial notes](docs/trial-notes.md) record each run.
- **Hand the remaining judgments to Jev.** The [rule audit](docs/rule-audit.md) lists the choices code still makes (when a hunt is worth starting, what a trip away from home needs, whether to go back for dropped items). Each becomes options with the facts, and a code default only for when Jev cannot be reached.
- **Give Jev better facts.** Most bad choices in the trials were a missing fact, not a missing rule: that the furnace cooks on its own, that dawn had come, what a fight would cost this bot. Keep measuring (the arena, the trials) and put the measurements in the questions.

## Alongside: a more reliable companion

- **Finish combined tasks efficiently.** Shared material planning, inventory reservations, furnace recovery, and verified delivery across long requests, with the chest as a fallback when a handoff is difficult.
- **Keep moving in natural terrain.** Swimming, shore exits, uneven footing, cave access, and getting off scaffolding; a failed approach is tried a different way before it is repeated.
- **Recover without losing the request.** Tool replacement, food, death recovery, and resuming after a disconnect, with blockers specific enough for a player to help with.
- **Make interruptions predictable.** Stop stays responsive during travel, model calls, crafting and construction, and the useful parts of a paused task are kept.
- **Keep chat brief and useful.** Meaningful changes and plain-language problems in chat; the detail in the decision log and flight recording.

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

## Throughout: tooling and upkeep

- **Easier setup:** clearer configuration, connection diagnostics, and contributor instructions.
- **Repeatable validation:** automated checks and reproducible isolated gameplay fixtures, with failures that are easy to inspect.
- **Better observability:** clearer material plans, progress, blockers, and model usage in the logs; recordings that make regressions easier to reproduce.
- **Version maintenance:** keep Minecraft recipes, protocol compatibility, and supported-version documentation aligned.

Contributions are especially useful when they turn a concrete gameplay failure into a small, reproducible test and an improvement to a general capability.

# The goal

jev-craft is built toward one demonstration: a decision model can play Minecraft Survival and make the decisions. Starting with an empty inventory in a fresh natural world on Normal difficulty, the bot should gather, craft, eat, shelter, fight, mine and build its way through the Overworld and the Nether, craft Eyes of Ender, find a stronghold, enter the End, defeat the Ender Dragon and return alive. Code owns the rules of the game and carries actions out; every judgment along the way is [Jev](https://typesafe.ai/)'s, asked as a choice among options code has checked, with the facts that bear on it.

It is also a companion: chat requests ("Jev build a house", "get me 32 purple concrete", "find a way to the Nether") are carried out in the same survival conditions, preserved across interruptions for food, shelter and danger, and resumed after a stop, a disconnect or a death.

## The bar for a result

- A run counts only from a fresh natural world, empty inventory, Normal difficulty, with no item grants, teleports, Creative mode, time or difficulty changes, privileged locating commands, or help from a player. Controlled worlds are fine for debugging and are labelled as such.
- An outcome is verified against the world: blocks placed, items in the recipient's inventory, the dimension actually entered, the dragon actually dead. Recognising a request or reaching an intermediate step is not the outcome.
- Failed runs are kept and reported as failures, not relabelled.

## Where it stands

The current milestone is the first three in-game days done well, measured by `scripts/first-days.js` on two fresh worlds in a row: no deaths, no step retried in a loop, never standing still or pacing for over a minute outside a shelter or bed, and iron tools, iron armour, a shield, a bed and a home. Trial 50 (2026-09-25) was the first to pass, with every milestone and nothing failed; trial 72 (the same day, twenty-one trials and twenty-three fixes later) the second. The goal asks for two in a row. [docs/trial-notes.md](docs/trial-notes.md) records every trial and what it changed.

Earlier companion milestones (the house, the concrete delivery and two full day/night cycles from empty natural starts; stop, status, resume and restart) have passed; a fresh natural run to the Nether and the full game remain open. The [roadmap](ROADMAP.md) has the order of work.

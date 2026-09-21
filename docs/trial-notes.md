# Trial notes

Running observations from acceptance trials on the isolated Normal Survival server (`.test-acceptance`, port 25579), with the opportunities they point at. Newest first. Each trial's full log is under `artifacts/<run>/events.jsonl`.

## muar64lo · 2026-09-21 · "build a house" + 2 cycles · controlled (nights skipped) · in progress

**So far.** First run with the never-give-up loop. A creeper followed the bot from spawn: four escapes in the first thirty steps for four logs.

**Opportunities.**

16. *A short hop does not shake a creeper.* Creepers do not burn in daylight and follow to about sixteen blocks; the flee puts six blocks between them and the bot goes back to the same tree, so the same creeper interrupts again a minute later. Sprint past the follow range, or move the work to a source on the far side of it, before resuming. Whether to relocate the work or just outrun it is a fair question for Jev; the distance is a rule.

## muaqvemv · 2026-09-21 · "build a house" + 2 cycles · controlled (nights skipped) · FAIL at the house, by a rule that has since been removed

**What happened.** Started at day (the console set it). Narration was live for the first time: "Getting oak log from the oak log 8 blocks away", "Crafting 96 oak planks", "Clearing the site", two creeper escapes. Clearing the site hit stone with no pickaxe; after three failures Jev's recovery pick chose "gather a stone pickaxe" on its own, at 0.6+ confidence, the bot got cobblestone, crafted the pickaxe and went back ("Okay, back to your request"). No generative adviser involved. Then the house tree came up empty: every placement on the lowest layer had failed once in the last two minutes, the two-minute suppression excluded all of them, and `No feasible house action remains` was a terminal Blocked. Run over with 97 planks and two pickaxes in hand.

**Opportunities.**

13. *Suppression is a preference, not a veto.* When every candidate has failed recently, offer them all again rather than nothing. Fixed.
14. *Nothing should be terminal except the player, the game, or an impossible ask.* The request loop no longer has a failure budget or a step budget: after retries, Jev's recovery pick and moving on, it says so once, shakes itself loose (soft blocks, then natural walls, then the floor onto a safe landing), leaves a failing resource for elsewhere, backs off for a growing pause up to a minute, and goes again. Idle survival does the same. Only definitional impossibilities (bedrock in Survival, a mob that does not spawn in Peaceful) are explained and parked. Done after this run.
15. *Per-tree narration is noise.* "Getting oak log from the oak log 8 blocks away" repeated for every trunk. A resource is now announced once with its count; the crafting, building and survival lines stay.

## muapyq2c · 2026-09-21 · "build a house" + 2 cycles · house PASS, endurance FAIL at 22,720 of 48,000 ticks

**So far.** Dusk arrived a minute in. Jev chose `secure_shelter` over the house at 0.9+ confidence, crafted twelve planks, gathered dirt and sealed itself in. No errors, no recovery, no OpenRouter call. Then it waited.

**Opportunities.**

7. *Sleep through the night instead of waiting it out.* A night is nine and a half real minutes of nothing. A bed is three wool and three planks, and there were sheep at spawn. Whether to dig in or to fetch wool and sleep is a Jev trade-off (sheep distance, daylight left, hunger, how hurried the player sounded), and sleeping also resets the spawn point beside the shelter, which helps death recovery. Spectators are excluded from the sleep check.

   What it takes, in order: (a) a passive-mob handler in `mob-policy.js` so sheep count as a wool source without the full iron armour and shield the blaze and enderman encounters demand, and a colour check so only white sheep are hunted for a white bed; (b) two-cell oriented bed placement in the executor, since a bed is not in the buildable palette; (c) a `sleep_in_bed` survival option using mineflayer's `bot.sleep`, guarded by its own monster-nearby rule, with wake handling and the shelter fallback if sleep is refused; (d) a `make_a_bed` option at dusk when white sheep are observed within reach and daylight remains. Roughly a day of work with tests; the survival tree and the source machinery it plugs into already exist.

8. *A house needs a bed anyway.* Once (b) and (c) exist, the compact house should get a bed inside it, which makes every later night at home a five-second affair and sets the respawn point at the house.

**Later in the run.** Dawn at 04:13; Jev left the shelter, resumed logs, hit one unreachable tree, set it aside and moved to the next without any adviser (the new escape hatch), reached 25 logs, crafted 96 planks, built the house and verified it at tick 5678. Then idle survival wanted a food reserve (Normal asks for twelve points before night, though hunger was full), Jev chose `obtain_food → search_food`, and the bot wandered 75 blocks from the house and 30 blocks down to the shore. There it stood under a two-block gravel lip, which the surface observer reads as underground. No walking route to a "surface" landing was accepted, the staircase excavation demanded a pickaxe, the pickaxe needed wood, and wood is a surface resource: `Cannot excavate a surface exit`. Jev's recovery pick and then the generative adviser both chose "return to the surface", which failed the same way. Five failures, blocked. Never hurt, never hungry.

**Opportunities.**

9. *A hand-diggable overhang needs no pickaxe.* Gravel, dirt and sand come away in the hand; the tool rule should look at what is actually overhead before bootstrapping a pickaxe. Fixed after this run.
10. *"Underground" is too coarse near cliffs and shores.* A block under a lip on a beach is not a cave. The observer could look for sky within a few blocks sideways before treating the spot as enclosed, and the route search for a landing could allow a short swim.
11. *Food searches should not walk the bot off a cliff and out of sight of home.* Foraging with a full stomach and no food reserve is reasonable, but the search wandered 75 blocks and 30 down; bounding it to the surface around the house, or making distance part of what Jev weighs, would keep the bot where it can shelter.
12. *The runner's failure budget hides the good half.* This run completed the useful request cleanly; a single survival dead end ended it. Reporting the house PASS and the endurance FAIL separately, as the runner now logs them, is right; the roadmap should say the same.


## muappqyo · 2026-09-21 · "build a house" + 2 cycles · FAIL after 2.5 minutes

**What happened.** Fresh spawn at (-520, 93, 176) in an oak forest. Jev chose between two log sources at every step (335 to 425 ms a call, 0.9+ confidence) and gathered six logs from four trees, moving along a hillside. It reserved a house site at (-543, 93, 180) and then went for the oak tree directly beside it, whose trunk sits on a ledge two blocks up with leaves over the approach. `approachDryMining` found no standing position for any block of that tree. After three failures recovery ran: Jev answered *none* at 0.39 (right: the offered options were footings within three blocks and a dirt pile), the generative adviser proposed relocating and gathering twelve dirt, the dirt was gathered, the relocation route was gone by the time it ran, and the next attempt hit the same tree. Blocked, run over. Never died, never hungry.

**Opportunities.**

1. *A single unreachable tree must never end a request.* The plain error from the approach became the goal's terminal `Blocked`. It should mark that tree unreachable for a while and move on to the next source, and when no source is left nearby, explore for another tree. The world had dozens.
2. *Failure suppression was defeated by its own keys.* A source is keyed by its nearest block; once that key was marked failed, the same tree came back under its next-nearest block as a "new" source, six times in a row. Suppression has to match the whole cluster, not the seed block.
3. *Recovery needs an option that changes the situation.* Every offered footing was within three blocks of where the bot already stood. "Leave this area and look for the resource elsewhere" was the right answer and it was not on the list, so Jev said none and the expensive adviser was asked for nothing better.
4. *Reserving the house site next to the unreachable tree* made the later tree choice worse: the reserved cells are excluded from mining, narrowing an already awkward approach. Site selection could prefer spots not adjacent to standing trees, or reserve later.
5. *One Jev call per block.* Every step re-asked which source to work, even mid-tree. Committing to a chosen source until it is exhausted or fails would cut calls by most of an order of magnitude on gathering and read more like intent.
6. *Only-option decisions dominate the trail.* Eleven of twenty-seven decisions had a single source and cost no call. That is correct, and the Observatory shows it, but it means the interesting Jev choices are the ones between two trees a few blocks apart; the more valuable judgment (keep gathering here versus walk to that grove) is not yet a question.

**Jev versus OpenRouter in this run.** All 27 routing and action decisions were Jev. OpenRouter was asked once, for recovery, after Jev declined to pick. Without an OpenRouter key this run would have ended at the same place a minute sooner.

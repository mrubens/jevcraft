# Trial notes

Running observations from acceptance trials on the isolated Normal Survival server (`.test-acceptance`, port 25579), with the opportunities they point at. Newest first. Each trial's full log is under `artifacts/<run>/events.jsonl`.

## muapyq2c · 2026-09-21 · "build a house" + 2 cycles · in progress

**So far.** Dusk arrived a minute in. Jev chose `secure_shelter` over the house at 0.9+ confidence, crafted twelve planks, gathered dirt and sealed itself in. No errors, no recovery, no OpenRouter call. Then it waited.

**Opportunities.**

7. *Sleep through the night instead of waiting it out.* A night is nine and a half real minutes of nothing. A bed is three wool and three planks, and there were sheep at spawn. Whether to dig in or to fetch wool and sleep is a Jev trade-off (sheep distance, daylight left, hunger, how hurried the player sounded), and sleeping also resets the spawn point beside the shelter, which helps death recovery. Spectators are excluded from the sleep check.

   What it takes, in order: (a) a passive-mob handler in `mob-policy.js` so sheep count as a wool source without the full iron armour and shield the blaze and enderman encounters demand, and a colour check so only white sheep are hunted for a white bed; (b) two-cell oriented bed placement in the executor, since a bed is not in the buildable palette; (c) a `sleep_in_bed` survival option using mineflayer's `bot.sleep`, guarded by its own monster-nearby rule, with wake handling and the shelter fallback if sleep is refused; (d) a `make_a_bed` option at dusk when white sheep are observed within reach and daylight remains. Roughly a day of work with tests; the survival tree and the source machinery it plugs into already exist.

8. *A house needs a bed anyway.* Once (b) and (c) exist, the compact house should get a bed inside it, which makes every later night at home a five-second affair and sets the respawn point at the house.

**Later in the run.** Dawn at 04:13; Jev left the shelter, resumed logs, hit one unreachable tree, set it aside and moved to the next without any adviser (the new escape hatch), reached 25 logs, crafted 96 planks and started placing the house. No deaths, no recovery escalation, no OpenRouter call so far.

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

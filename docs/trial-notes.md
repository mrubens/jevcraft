# Trial notes

Running observations from acceptance trials on the isolated Normal Survival server (`.test-acceptance`, port 25579), with the opportunities they point at. Newest first. Each trial's full log is under `artifacts/<run>/events.jsonl`.

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

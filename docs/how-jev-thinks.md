# How Jev thinks

A walk through one chat request, with the real numbers from a recorded run, to show what the model is asked, what it answers, and what code does in between. The recording is in [`traces/get-me-a-pumpkin.json`](traces/get-me-a-pumpkin.json), as JSON frames to follow along with.

## One message, one call

A player types:

```text
Jev get me a pumpkin
```

Code does the cheap things first. It strips the bot's name, pulls out any numbers ("a" means one), and finds the catalog items whose names overlap the words in the message: pumpkin, carved pumpkin, pumpkin pie, pumpkin seeds. Then it sends **one** request to Jev with that state and up to fourteen typed questions. Some are the routing questions every message needs. Others are speculative: they only matter if the message turns out to be a certain kind of request, but they cost nothing extra to ask in the same batch and save a round trip when their branch is taken.

| Question | Primitive | Answer | Confidence |
| --- | --- | --- | --- |
| Instruction to act, or discussion? | Choice | request | 1.00 |
| Which of sixteen objectives? | Choice | obtain | 1.00 |
| Which listed catalog item is meant? *(speculative)* | Choice | pumpkin | 1.00 |
| How many? | Choice over numbers found in the text | 1 | 1.00 |
| One output or several? | Choice | single | 1.00 |
| Who receives it? | Choice | speaker | 0.98 |
| Which player, if this were come/follow? *(speculative)* | Choice | TestPlayer | 0.88 |
| Wood species chosen in this message? *(speculative)* | Choice | none | 1.00 |
| What kind of thing, if this were a find request? *(speculative)* | Choice | block | 0.87 |
| Is this a personal fact to remember? | Noul | no (0.02) | |

When the message does not start with Jev's name, one more question rides in the same batch: is it addressed to the bot at all (a Noul)? With the name in front, that is already settled and is not asked.

That call took 443 ms and used 3,486 input and 606 output tokens. The item question came back confident, so the catalog walk that would otherwise follow, three to five more calls, never ran. The bot said "I'll get 1 pumpkin for TestPlayer" and started.

Every answer is checked before it is used. An objective that is not one of the sixteen offered, a quantity that was not in the message, a recipient outside the three offered: each throws rather than acting. Jev cannot name something code did not offer.

## When the answer is not sure enough

The same call, for the message `Jev make me something`, put the objective at *craft* with 0.54 confidence, and the item question answered *none* because nothing in the catalog overlaps "something". The bot replied:

> I could not match the requested item. Use its Minecraft item name so I can work out the recipe.

For `Jev bring me grass`, the catalog walk can end with *short grass* and *grass block* close together. Below 0.5 confidence with a runner-up above 0.25, the bot asks instead of guessing:

> Did you mean short grass or grass block?

And when the objective itself is unsure, the bot names the two readings it is torn between:

> I'm not sure whether you want me to design and build something or build a small house. Could you say it another way?

The threshold depends on what a mistake would cost. A misheard "come here" wastes a few seconds, so it acts above 0.5. A misheard "build a castle" wastes an afternoon, so builds, server commands, the trip to the Nether and beating the game need 0.65. What cannot be undone asks for more: forgetting needs 0.75, and forgetting everything also needs the player to have said so; taking the dream away needs 0.75; an unsure edit of a standing building is built fresh beside it instead.

## Deciding what to do next

Once a request is running, the bot loops: observe the world, work out the feasible next actions, do one, verify it. Jev is consulted only when there is a real choice. In the pumpkin run there was not: the plan was "take a pumpkin from the Creative inventory", one feasible action, so no call was made. A question with one option is not asked at all: the one way is taken and said in the log, and only real choices go in the decision log, so it shows how often the model was actually needed.

Nor is a question asked again and again for nothing. When the same question comes back with the same facts, its last answer given and nothing measurable coming of it (no new ground, nothing gained, no block dug or placed), the next asking says so in its facts; and when that answer came back at once twice running, the question is not asked a third time: the answer is held as failed, said to the questions that follow, and the stuck step goes to the stall path, where Jev chooses a detour.

When there is a choice, it is a semantic one. Gathering wood in Survival, code finds the reachable logs and groups them into *sources*: a source is a block type, how many of it are within reach, how far it is, and how much climbing. Jev is asked which source, with the request in front of it, and code picks the nearest block inside the source it chose. In the decision eval, asked to build a *birch* house with six oak logs four blocks away and six birch logs twenty-two blocks away, Jev chose birch at 0.96. Asked for a house with no species named, it chose three close logs over nine far ones at 0.95.

At dusk the choice is between spending the next action on the request and getting under cover first. Jev sees the time, the ticks of daylight left, whether a shelter is already verified and how far it is, hunger, and the request. With no shelter and seven hundred ticks of light, it chose shelter at 0.99. That is a judgment code could only make with a threshold someone guessed; Jev makes it from the situation.

Some things are never a choice. Eating carried food when hungry is a rule. Surfacing for air is a rule. A hostile mob within reach interrupts whatever Jev was asked mid-call. The model decides between good options; code decides what is not optional.

## When things go wrong

If a step fails three times in a row, code enumerates the recovery actions it could take from here: gather footing blocks, return to the surface, move to one of six surveyed standing spots, and so on. Each is something it has already checked it can do. Jev is asked which one is most likely to unblock the original request, or *none*.

If the service itself is unreachable, the tree is walked with a code default instead, shelter before food before the request and otherwise the first option listed, and the decision is recorded as a *code default* so the log shows where a judgment is missing. The bot keeps working through the outage and says once in chat that it is on defaults, and once that Jev is back.

In a recorded run, the bot had a birch log ready but the player had left the area. Jev answered *none* at 0.83: no option would make the player visible. Jev's turn took under a second. An earlier version then asked a generative model for a second opinion; it agreed, in fourteen seconds and at about a hundred times the cost, and has since been removed: recovery is Jev's call alone.

## Designs get a second opinion

A custom build in Creative is the one place a generative model draws something. Code validates the geometry: connected, buildable, an entrance you can walk through. Then Jev is asked a single Noul: does this design answer the request in kind, scale and material? A castle that came back as a hut is buildable and wrong. Below 0.5 the drawing goes back to the designer with Jev's verdict as feedback, before anyone spends an hour placing blocks.

## What to take from this

- **Jev chooses; code enumerates.** The model never sees an option that code did not construct and check.
- **Ask everything at once.** Independent questions over the same state go in one call, speculative ones included.
- **Confidence is a second axis.** The answer says what; the probability says whether to act; the threshold scales with the stakes.
- **Rules stay rules.** If code knows the threshold, it should not ask.
- **Escalate, do not default.** The expensive model is for the failure the cheap one could not judge.

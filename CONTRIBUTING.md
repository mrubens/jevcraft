# Contributing

JevBot exists to show what a System One model is good at, so the most useful contributions are the ones that keep the line between Jev and code sharp. Read [How Jev thinks](docs/how-jev-thinks.md) first; it is short and it is the design.

## The two rules

1. **Jev chooses, code enumerates.** Never let the model name a coordinate, an item, a quantity or a command. Code builds the options from the real game state, Jev picks one, code checks the pick is one it offered before acting.
2. **Judgments go to Jev, with the facts.** The point of the project is that a decision model plays the game. When the bot faces a choice between reasonable alternatives (fight or run, shelter or keep working, which ore, how much, what to drop), put it to Jev as options and give it the numbers that bear on the choice: distances, what is carried, what an option costs, what the arena measured. Do not add a rule that pre-empts the question, hides an option behind a threshold, or overrides an unsure answer; the fallback (a code default used only when Jev cannot be reached) is the one place a rule answers. Code keeps the mechanics (how an action is carried out, air, pathing), what is possible right now, and reflexes faster than a question (the swing at arm's length, a shield against an arrow already in flight).

When Jev makes a bad choice in a trial, the fix is usually a missing fact, not a rule: find what the question did not say, add it to the state or the option's description, and ask again (a quick probe against the live model is the fastest check). The [rule audit](docs/rule-audit.md) lists the choices still made in code.

When you add a question, define it in [`src/decisions`](src/decisions/index.js): its full meaning in the instructions and option descriptions (question ids are not sent to the model), the code's fallback for an outage, and, for questions a person is on the other end of, the confidence below which the bot asks instead. Regenerate [docs/decisions.md](docs/decisions.md) with `node scripts/decisions-doc.js`; a test fails if it is stale.

## Setting up

```sh
npm ci
cp .env.example .env   # add a TypeSafe key; a Minecraft server is optional
npm test               # no network, no server
```

Node 22 or newer. `npm test` runs about eleven hundred tests in about twenty seconds and needs no key.

## Kinds of change, and what to include

**A gameplay fix.** Start from a concrete failure: the chat request, what happened, what should have happened. Reproduce it in a unit test with a mocked bot where you can (see `test/` for the fixtures), or in one of the controlled world scripts under `scripts/` when it needs a real server. Say in the pull request which you did and what you ran.

**A change to what Jev is asked.** Add or update a case in `scripts/eval-intents.js` or `scripts/eval-decisions.js` and run it; both make live calls and write their judgments to `artifacts/`. Paste the summary line. If a case is a matter of taste (two defensible answers), do not add it: evals hold judgments with one right answer.

**A README or docs change.** Keep claims tied to something that runs: a test, an eval, a preserved run under `artifacts/`.

## Bug reports

Include the Minecraft version, game mode and difficulty, the exact chat request, and a short log or the flight-recording frames around the problem (`node scripts/flight.js`). Review them before attaching: it can contain chat, player names and world coordinates.

## Style

CommonJS, no build step, no new dependencies without a reason in the pull request. Comments explain why, not what. Error messages that reach the player are plain English.

Acceptance claims are held to a high bar: a controlled fixture passing is not evidence that the same request works from an empty inventory in a natural world. Say which it was.

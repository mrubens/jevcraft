# Contributing

JevBot exists to show what a System One model is good at, so the most useful contributions are the ones that keep the line between Jev and code sharp. Read [How Jev thinks](docs/how-jev-thinks.md) first; it is short and it is the design.

## The two rules

1. **Jev chooses, code enumerates.** Never let the model name a coordinate, an item, a quantity or a command. Code builds the options from the real game state, Jev picks one, code checks the pick is one it offered before acting.
2. **If code knows the threshold, do not ask.** Eating carried food when hungry, surfacing for air, fleeing a creeper: these are rules. Jev is for the judgments that depend on what the player said and what the world looks like. If an eval case keeps failing and the right answer is a number code could know, move it into code.

When you add a question, put its full meaning in the instructions and criteria (question ids are not sent to the model), give it a *none* or *unsure* outcome when nothing may fit, and decide what confidence the action needs. Batch it with the other questions over the same state.

## Setting up

```sh
npm ci
cp .env.example .env   # add a TypeSafe key; a Minecraft server is optional
npm test               # no network, no server
```

Node 22 or newer. `npm test` runs in about ten seconds and needs no key.

## Kinds of change, and what to include

**A gameplay fix.** Start from a concrete failure: the chat request, what happened, what should have happened. Reproduce it in a unit test with a mocked bot where you can (see `test/` for the fixtures), or in one of the controlled world scripts under `scripts/` when it needs a real server. Say in the pull request which you did and what you ran.

**A change to what Jev is asked.** Add or update a case in `scripts/eval-intents.js` or `scripts/eval-decisions.js` and run it; both make live calls and write their judgments to `artifacts/`. Paste the summary line. If a case is a matter of taste (two defensible answers), do not add it: evals hold judgments with one right answer.

**An Observatory change.** Include what it looks like on the illustrated demo (`npm run harness`, then the *Illustrated run* session) and on a recording.

**A README or docs change.** Keep claims tied to something that runs: a test, an eval, a preserved run under `artifacts/`.

## Bug reports

Include the Minecraft version, game mode and difficulty, the exact chat request, and a short log or an exported Observatory trace. Review a trace before attaching it: it can contain chat, player names and world coordinates.

## Style

CommonJS, no build step, no new dependencies without a reason in the pull request. Comments explain why, not what. Error messages that reach the player are plain English.

Acceptance claims are held to a high bar: a controlled fixture passing is not evidence that the same request works from an empty inventory in a natural world. Say which it was.

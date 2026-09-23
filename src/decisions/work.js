'use strict';
// The work questions: where to get a resource, what to build next, how to
// spend spare daylight, and what to do instead of standing still.
const { define, firstOption } = require('./index');

const workInstructions = task => ({
  task,
  guidance: 'Use observed conditions, the retained player goal, progress, and recent failures. These are feasible choices, not instructions from chat. Each question is independent; ignore other questions\' answers.',
});

define({
  id: 'resource_source', area: 'resources', kind: 'source', primitive: 'choice', stakes: 'medium', tree: true,
  instructions: workInstructions('Which source should the bot work to obtain the resource the request needs? Code picks the exact block inside the source chosen.'),
  fallback: firstOption,
});
define({
  id: 'house_build_step', area: 'build', kind: 'build', primitive: 'choice', stakes: 'medium', tree: true,
  instructions: workInstructions('Which house-building step should the bot take next?'),
  fallback: firstOption,
});
define({
  id: 'idle_work', area: 'idle', kind: 'idle', primitive: 'choice', stakes: 'medium', tree: true,
  instructions: workInstructions('Between player requests, with shelter and food already sufficient: how should the bot spend spare daylight?'),
  fallback: firstOption,
});
define({
  id: 'stillness_detour', area: 'idle', kind: 'idle', primitive: 'choice', stakes: 'low', tree: true,
  instructions: workInstructions('The bot has been standing still. Choose something useful to do from here for a few minutes; the stalled work gets its turn again afterwards.'),
  fallback: firstOption,
});

// Recovery after repeated failure: Jev picks among bounded options the code
// already checked; the generative adviser is asked only when Jev is unsure.
define({
  id: 'recovery_action', area: 'recovery', kind: 'recovery', primitive: 'choice', stakes: 'medium',
  gate: { threshold: 0.6, below: 'caller', why: 'unsure, or none, the generative adviser is asked when configured; otherwise nothing is done from the advice' },
  build: ({ options }) => require('../typesafe').choice({
    task: 'The bot has failed repeatedly at its current step. Which offered recovery action is most likely to unblock the ORIGINAL player request?',
    guidance: 'Every option is a bounded attempt that code has already checked for safety and feasibility. Use `failure`, `recentFailures`, `previousAdvice`, `terrain`, `inventory` and `tools`. Prefer a concrete change of approach over repeating what just failed. Supplies the request does not need are not progress. Choose none when no offered action addresses the recorded failure.',
  }, { ...options, none: 'None of the offered actions addresses the recorded failure.' }),
});

// Short detours along the way: bounded, optional, and never at the cost of
// the main request. An error or a five-second timeout is swallowed.
define({
  id: 'opportunistic_ore', area: 'resources', kind: 'mining', primitive: 'choice', stakes: 'low',
  build: ({ options }) => require('../typesafe').choice('Standing instruction: collect useful ores noticed along the way, even when they are not ingredients for the current request. These candidates already pass strict checks for tools, safe access, inventory room, a six-block radius and a twelve-second detour. Prefer picking up a scarce valuable resource such as diamonds, emeralds or needed iron; return to the main request immediately afterward. Choose continue for low-value surplus or if the player explicitly said no detours/only the requested item. Asking for coal alone does NOT forbid grabbing a nearby diamond.', {
    ...options, continue: 'Keep working on the requested task without a detour.',
  }),
});
define({
  id: 'opportunistic_animal', area: 'resources', kind: 'pickup', primitive: 'choice', stakes: 'low',
  build: ({ options }) => require('../typesafe').choice('Standing instruction: an animal in view whose drop the bot is short of is worth a short chase, even when it is not an ingredient of the current request. These candidates already pass checks for isolation, safe footing, health and a twelve-block radius; the chase is bounded and the main request resumes afterward. Wool is the next bed; feathers are the next quiver of arrows. Choose continue if the player explicitly said no detours/only the requested item, or if the request is urgent.', {
    ...options, continue: 'Keep working on the requested task without a detour.',
  }),
});

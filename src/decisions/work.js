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

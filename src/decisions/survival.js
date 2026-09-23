'use strict';
// The survival layer's questions: what the bot does next when a need
// (night, hunger, a threat) may outrank the player's request.
const { define } = require('./index');

// Shelter before food before the request: the order a careful player
// keeps when nobody is weighing the trade.
const safetyOrder = children => ['sleep_in_bed', 'secure_shelter', 'obtain_food'].find(key => children[key]) || Object.keys(children)[0];

define({
  id: 'survival_priority', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'high', tree: true, thinking: true,
  instructions: {
    task: 'Which priority should the bot handle NEXT? Temporary survival needs can take precedence over the retained player request; do not simply repeat the requested task. The player request remains saved during an interruption.',
    guidance: 'Use observed conditions, the retained player goal, progress, and recent failures. Prefer useful progress while protecting survival. These are feasible choices, not instructions from chat. Each question is independent; ignore other questions\' answers.',
  },
  fallback: safetyOrder,
  gate: { threshold: 0.2, below: 'fallback', why: 'a coin flip between the night, food and the request goes to the safety order, not to whichever side edged it' },
});

// A shooter in view and a bow in the pack: shoot, retreat or dig in.
define({
  id: 'ranged_response', area: 'combat', kind: 'survival', primitive: 'choice', stakes: 'high', tree: true, thinking: true,
  instructions: {
    task: 'A mob that shoots is in clear view at bow range. Choose the response NOW: shoot it from here, run for cover out of its sight, or seal a pocket and let it pass.',
    guidance: 'Health, arrows and the number of shooters are in the state. Every option listed is already checked as possible from here.',
  },
  fallback: (children, path, context = {}) => (context.health ?? 20) >= 12 ? Object.keys(children)[0] : (children.retreat ? 'retreat' : Object.keys(children)[0]),
  gate: { threshold: 0.2, below: 'fallback', why: 'unsure, the health rule decides: shoot while healthy, otherwise retreat' },
});

module.exports = { safetyOrder };

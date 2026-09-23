'use strict';
// Fights chosen on purpose: which target a hunt takes on, and the Ender
// Dragon fight's next action.
const { define, firstOption } = require('./index');
const { endDecisionInstructions } = require('./end-state');

define({
  id: 'hunt_target', area: 'combat', kind: 'combat', primitive: 'choice', stakes: 'high', tree: true,
  instructions: {
    task: 'The resource the request needs drops from these mobs. Choose which observed mob to fight now, or leave them for now if the situation is unsuitable.',
    guidance: 'Every target listed has passed the code\'s fight-readiness and isolation checks. Health, food and the resource still needed are in the state.',
  },
  fallback: firstOption,
  ungated: 'every target offered already passed canBegin and isolated; a close call between fighting and leaving it is a preference, and the outage default is the same nearest target',
});

// Out of danger first, then the crystals that heal the dragon, then the
// head within reach, then an arrow, then a better position, then a watch.
function endFallback(safe) {
  return children => {
    const keys = Object.keys(children), find = test => keys.find(test);
    return (!safe && find(k => k.startsWith('move_'))) || find(k => k.startsWith('crystal_')) || find(k => k === 'strike_head') ||
      find(k => k === 'shoot_dragon') || find(k => k.startsWith('move_')) || keys[0];
  };
}

define({
  id: 'dragon_fight', area: 'endgame', kind: 'end', primitive: 'choice', stakes: 'high', tree: true,
  instructions: endDecisionInstructions,
  fallback: (children, path, context = {}) => endFallback(context.safe)(children),
  gate: { threshold: 0.2, below: 'fallback', why: 'unsure, the fixed order decides: out of danger, crystals, head, arrow, position' },
});

module.exports = { endFallback };

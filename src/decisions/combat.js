'use strict';
// Fights chosen on purpose: which target a hunt takes on, and the Ender
// Dragon fight's next action.
const { define, firstOption } = require('./index');
const { endDecisionInstructions } = require('./end-state');

define({
  id: 'hunt_target', area: 'combat', kind: 'combat', primitive: 'choice', stakes: 'high', tree: true,
  question: 'The request needs a mob\'s drop: which observed mob should the bot fight now, or leave them for now?',
  trigger: 'A mob hunt step with at least one candidate that passed the fight-readiness and isolation checks.',
  source: 'src/mob-hunt.js (huntObserved)',
  options: [
    { pattern: 'hunt_\\d+', label: 'fight this mob', when: 'observed, reachable, isolated from others of its kind, and the bot fit to fight', level: 'root', dynamic: true },
    { key: 'defer', label: 'leave them for now', when: 'always', level: 'root' },
  ],
  instructions: {
    task: 'The resource the request needs drops from these mobs. Choose which observed mob to fight now, or leave them for now if the situation is unsuitable.',
    guidance: 'Every target listed has passed the code\'s fight-readiness and isolation checks. Health, food and the resource still needed are in the state.',
  },
  fallback: firstOption,
  ungated: 'every target offered already passed canBegin and isolated; a close call between fighting and leaving it is a preference, and the outage default is the same nearest target',
});

// Out of danger first, then the crystals that heal the dragon, then a bed
// by the perched head, then the head within reach, then an arrow, then a better position, then a watch.
function endFallback(safe) {
  return children => {
    const keys = Object.keys(children), find = test => keys.find(test);
    return (!safe && find(k => k.startsWith('move_'))) || find(k => k.startsWith('crystal_')) || find(k => k === 'bed_bomb') || find(k => k === 'strike_head') ||
      find(k => k === 'shoot_dragon') || find(k => k.startsWith('move_')) || keys[0];
  };
}

define({
  id: 'dragon_fight', area: 'endgame', kind: 'end', primitive: 'choice', stakes: 'high', tree: true,
  question: 'In the Ender Dragon fight, what is the most useful action now?',
  trigger: 'Each step of the dragon fight in the End.',
  source: 'src/end-combat.js (fightEndStep)',
  options: [
    { pattern: 'crystal_\\d+', label: 'shoot this healing crystal', when: 'in view with a solved arrow path and not missed repeatedly', level: 'root', dynamic: true },
    { key: 'shoot_dragon', label: 'shoot the flying dragon', when: 'a bow, arrows and a clear trajectory', level: 'root' },
    { key: 'bed_bomb', label: 'blow a bed beside the perched dragon\'s head', when: 'the dragon perched, a bed carried, health fourteen or more, and a trench line within twelve blocks', level: 'root' },
    { key: 'strike_head', label: 'strike the perched dragon\'s head', when: 'the head is within sword reach', level: 'root' },
    { pattern: 'move_[a-z0-9_,.:-]+', label: 'move along this checked route', when: 'a safe surveyed route toward a crystal, the dragon or away from danger', level: 'root', dynamic: true },
    { key: 'observe', label: 'wait one second and watch', when: 'on a safe spot with the dragon in view, fewer than five idle watches in a row', level: 'root' },
  ],
  instructions: endDecisionInstructions,
  fallback: (children, path, context = {}) => endFallback(context.safe)(children),
  gate: { threshold: 0.2, below: 'fallback', why: 'unsure, the fixed order decides: out of danger, crystals, head, arrow, position' },
});

module.exports = { endFallback };

'use strict';
// Fights chosen on purpose: which target a hunt takes on, and the Ender
// Dragon fight's next action.
const { define, firstOption } = require('./index');
const { endDecisionInstructions } = require('./end-state');

define({
  id: 'hunt_target', area: 'combat', kind: 'combat', primitive: 'choice', stakes: 'high', tree: true,
  question: 'The request needs a mob\'s drop: which observed mob should the bot fight now, or leave them for now?',
  trigger: 'A mob hunt step with at least one candidate in view that is reachable and isolated, the bot on ground it can fight from (dry, not on a one-wide span, air to breathe).',
  source: 'src/mob-hunt.js (huntObserved, fitness, fitnessSays)',
  options: [
    { pattern: 'hunt_\\d+', label: 'fight this mob', when: 'observed, reachable, isolated from others of its kind; said with the one fight\'s estimate and the bot\'s fitness: health against the fourteen the code once required, hunger and whether health comes back, food carried, fire, and the kit', level: 'root', dynamic: true },
    { key: 'defer', label: 'leave them for now', when: 'always; said with the fitness, and what the hunt does meanwhile when the bot is short of it (food, cover, health)', level: 'root' },
  ],
  instructions: {
    task: 'The resource the request needs drops from these mobs. Choose which observed mob to fight now, or leave them for now if the situation is unsuitable.',
    guidance: 'Every target listed is reachable and isolated. fitness is the bot\'s state for a fight: the code once refused one under fourteen health or hunger, without a full kit, or with hunger under eighteen and nothing to eat (health comes back only at eighteen or more); those are facts here, not rules. A bot alight in the Nether has nothing to put the fire out. Health, food and the resource still needed are in the state.',
  },
  fallback: firstOption,
  ungated: 'every target offered is reachable and isolated and the bot has footing for a fight; the fitness is said in full on every option, a close call between fighting and leaving it is a preference, and the outage default is the same nearest target',
});

// The kit for a fight, offered and not required (src/mob-hunt.js
// kitChoice): the planner once required it, and a Nether blaze hunt with a
// stone sword planned iron ore it could not dig there, 1,130 times in
// twenty-five minutes (mid-227-r-nether-1, note 476).
define({
  id: 'combat_kit', area: 'combat', kind: 'combat', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'Pieces of the combat kit (iron-or-better sword, helmet, chestplate, leggings, boots, a shield) are missing: go on with what is carried, make them here first, or go back to the Overworld for them?',
  trigger: 'Before a hunt of a mob that fights back, or the crossing into the Nether or the End, with a piece of the kit neither carried nor set aside, and more than one way on; held ten minutes while the same options stand.',
  source: 'src/mob-hunt.js (prepareCombatGear, kitChoice, kitPieces)',
  options: [
    { key: 'fight_with_carried', label: 'go on with what is carried', when: 'always; said with the weapon and armour carried and one fight\'s estimate against the mob hunted', level: 'root' },
    { key: 'make_kit_here', label: 'make the pieces that can be made here first', when: 'a missing piece can be made from sources in this dimension; said with the iron it takes and the steps', level: 'root' },
    { key: 'return_for_kit', label: 'go back to the Overworld for the pieces', when: 'outside the Overworld, a missing piece made only from Overworld ore; said with the iron, the ore and the trip to the portal', level: 'root' },
  ],
  instructions: {
    task: 'A fight needs a kit the bot is short of. Choose to go on with what is carried, to make the missing pieces here, or to go back to the Overworld for them.',
    guidance: 'Each option says what it costs: the fight as it would go with what is worn and held, the iron and steps to make a piece, the walk to the portal. Fighting without armour is a real choice, not a rule broken; iron ore is found only in the Overworld.',
  },
  fallback: (children, path, context = {}) => children[context.fallback] ? context.fallback : Object.keys(children)[0],
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
  ungated: 'Jev\'s pick is taken at any confidence and asked again each step; the fixed order (out of danger, crystals, head, arrow, position) answers only when Jev cannot be reached',
});

module.exports = { endFallback };

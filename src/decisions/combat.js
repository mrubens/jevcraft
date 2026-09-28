'use strict';
// Fights chosen on purpose: which target a hunt takes on, and the Ender
// Dragon fight's next action.
const { define, firstOption } = require('./index');
const { endDecisionInstructions } = require('./end-state');

define({
  id: 'hunt_target', area: 'combat', parent: 'rung_progress', kind: 'combat', primitive: 'choice', stakes: 'high', tree: true,
  question: 'The request needs a mob\'s drop: which observed mob should the bot fight now, or leave them for now?',
  trigger: 'A mob hunt step with at least one candidate in view that is reachable and isolated, or on a blaze hunt a blaze within twenty-four, in sight or heard through the walls, and a stand to take them from, the bot on ground it can fight from (dry, not on a one-wide span, air to breathe). A blaze whose every way in the open ends within a fireball\'s push of lava or a deep drop is not offered to fight in the open (notFoughtInTheOpen in the state).',
  source: 'src/mob-hunt.js (huntObserved, fitness, fitnessSays)',
  options: [
    { pattern: 'hunt_\\d+', label: 'fight this mob', when: 'observed, reachable, isolated from others of its kind; said in a sentence with where it is and whether it is in sight or only heard, how it is fought with what is carried, what it drops and that the resource is what the request needs, the fight\'s estimate (with the others that reach the bot there fighting too, a shooter in sight within its reach or anything else within sixteen, and the one alone beside it; a blaze spawner near said) and the bot\'s fitness: health against the fourteen the code once required, hunger and whether health comes back, food carried, fire, and the kit', level: 'root', dynamic: true },
    { key: 'dig_in_and_fight', label: 'dig a hole into the brick or netherrack and take the blazes from inside it', when: 'a blaze hunt with a blaze within twenty-four (in sight or heard), a sword or axe carried, and rock for the hole beside the bot or a wall within five blocks; said as the encounter stance of that name, with the push where the bot stands; held until a rod is in hand, the blazes are quiet twenty seconds or two minutes pass, then the rods picked up', level: 'root' },
    { key: 'fight_at_spawner', label: 'take the blazes at their spawner\'s cage, under a ceiling', when: 'a blaze hunt with a blaze within twenty-four (in sight or heard), a spawner within twenty-four and a cell within three of it under a ceiling, no drop or lava within a push, within twenty-four blocks of walking; held as the hole is', level: 'root' },
    { key: 'back_to_wall', label: 'take the blazes from footing with a wall at its back', when: 'a blaze hunt with a blaze within twenty-four (in sight or heard) and such footing within eight blocks of walking; held as the hole is', level: 'root' },
    { key: 'defer', label: 'leave them for now', when: 'always; said with the fitness, the shooters that still reach the bot where it stands (leaving is not out of their fire), and what the hunt does meanwhile when the bot is short of it (food, cover, health)', level: 'root' },
  ],
  instructions: {
    task: 'The resource the request needs drops from these mobs. Choose which observed mob to fight now, or leave them for now if the situation is unsuitable.',
    guidance: 'Every target listed is reachable, with no crowd of other kinds beside it; where other mobs reach the bot, its fight is priced with them. fitness is the bot\'s state for a fight: the code once refused one under fourteen health or hunger, without a full kit, or with hunger under eighteen and nothing to eat (health comes back only at eighteen or more); those are facts here, not rules. A bot alight in the Nether has nothing to put the fire out. Health, food and the resource still needed are in the state; on a blaze hunt, blazes says how many are about, seen or heard, at what heights, a spawner seen, and that blaze rods come from nothing else. A stand (a hole, the spawner\'s cage, a wall at the back) is priced as the fight in the open is: the price of each, set against leaving them, is the choice.',
  },
  fallback: firstOption,
  ungated: 'every target offered is reachable and isolated and the bot has footing for a fight; the fitness is said in full on every option, a close call between fighting and leaving it is a preference, and the outage default is the same nearest target',
});

// The kit for a fight, offered and not required (src/mob-hunt.js
// kitChoice): the planner once required it, and a Nether blaze hunt with a
// stone sword planned iron ore it could not dig there, 1,130 times in
// twenty-five minutes (mid-227-r-nether-1, note 476).
define({
  id: 'combat_kit', area: 'combat', parent: 'rung_progress', kind: 'combat', primitive: 'choice', stakes: 'medium', tree: true,
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
  id: 'dragon_fight', area: 'endgame', parent: null, kind: 'end', primitive: 'choice', stakes: 'high', tree: true,
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

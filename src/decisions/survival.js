'use strict';
// The survival layer's questions: what the bot does next when a need
// (night, hunger, a threat) may outrank the player's request.
const { define } = require('./index');

// Shelter before food before the request: the order a careful player
// keeps when nobody is weighing the trade.
const safetyOrder = children => ['sleep_in_bed', 'secure_shelter', 'obtain_food'].find(key => children[key]) || Object.keys(children)[0];

// The food sources, shared by the priority tree's obtain_food branch.
const FOOD_OPTIONS = [
  { pattern: 'cook_[a-z_]+', label: 'cook a carried ingredient', when: 'raw food and fuel are carried; the output is safe food', level: 'obtain_food', dynamic: true },
  { key: 'prepare_hunting_sword', label: 'make a wooden sword to hunt with', when: 'animals are in view and no weapon is carried', level: 'obtain_food' },
  { pattern: 'hunt_\\d+', label: 'hunt this animal', when: 'an adult food animal in view is reachable on safe surface ground', level: 'obtain_food', dynamic: true },
  { key: 'go_home_for_food', label: 'walk home and eat from its stores', when: 'the base has bread, ripe wheat or a cow to spare within reach', level: 'obtain_food' },
  { key: 'village_food', label: 'take ripe crops and hay from a remembered village', when: 'a village with crops or hay is remembered within reach', level: 'obtain_food' },
  { key: 'search_food', label: 'walk to another dry area to look for animals', when: 'none of the other food options is feasible', level: 'obtain_food' },
  { key: 'return_for_food', label: 'go back through the portal for food', when: 'off the Overworld, where nothing is safe to eat', level: 'obtain_food' },
];

define({
  id: 'survival_priority', area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'high', tree: true, thinking: true,
  question: 'What should the bot handle next: the player\'s request, sleep, a shelter, or food (and which food)?',
  trigger: 'Each survival step when night is coming or food is short, unless one option is the only one (then it is taken without asking) or a chosen shelter or food top-up is still being carried out.',
  source: 'src/survival.js (step: the tree), src/foraging.js (forageChoices: the food options)',
  instructions: {
    task: 'Which priority should the bot handle NEXT? Temporary survival needs can take precedence over the retained player request; do not simply repeat the requested task. The player request remains saved during an interruption.',
    guidance: 'Use observed conditions, the retained player goal, progress, and recent failures. Prefer useful progress while protecting survival. These are feasible choices, not instructions from chat. Each question is independent; ignore other questions\' answers.',
  },
  options: [
    { key: 'continue_request', label: 'carry on with the request', when: 'it is not night, or it is night and the bot is armed, armoured and has a bed to fall back on (stay up)', level: 'root' },
    { key: 'sleep_in_bed', label: 'sleep in a bed', when: 'bedtime, a bed is carried (with room to place it) or one is in reach, and no mob within ten blocks', level: 'root' },
    { key: 'secure_shelter', label: 'seal a shelter for the night', when: 'night is coming and no bed is on offer', level: 'root' },
    { key: 'obtain_food', label: 'get food', when: 'food carried is under the reserve and hunger or a stock top-up calls for it (not at night when shelter is needed)', level: 'root' },
    ...FOOD_OPTIONS,
  ],
  fallback: safetyOrder,
  gate: { threshold: 0.2, below: 'fallback', why: 'a coin flip between the night, food and the request goes to the safety order, not to whichever side edged it' },
});

// A shooter in view and a bow in the pack: shoot, retreat or dig in.
define({
  id: 'ranged_response', area: 'combat', kind: 'survival', primitive: 'choice', stakes: 'high', tree: true, thinking: true,
  question: 'A mob that shoots is in clear view at bow range: shoot it, run for cover, or dig in?',
  trigger: 'A shooting mob is in clear view at bow range, a bow and arrows are carried, health is eight or more and no melee mob is within three blocks.',
  source: 'src/survival.js (rangedChoice)',
  instructions: {
    task: 'A mob that shoots is in clear view at bow range. Choose the response NOW: shoot it from here, run for cover out of its sight, or seal a pocket and let it pass.',
    guidance: 'Health, arrows and the number of shooters are in the state. Every option listed is already checked as possible from here.',
  },
  options: [
    { pattern: 'shoot_\\d+', label: 'shoot this mob', when: 'it is in clear view with a solved arrow path (up to three targets)', level: 'root', dynamic: true },
    { key: 'retreat', label: 'run for cover out of its sight', when: 'always', level: 'root' },
    { key: 'dig_in', label: 'seal a two-block pocket here', when: 'twelve or more building blocks are carried', level: 'root' },
  ],
  fallback: (children, path, context = {}) => (context.health ?? 20) >= 12 ? Object.keys(children)[0] : (children.retreat ? 'retreat' : Object.keys(children)[0]),
  gate: { threshold: 0.2, below: 'fallback', why: 'unsure, the health rule decides: shoot while healthy, otherwise retreat' },
});

module.exports = { safetyOrder, FOOD_OPTIONS };

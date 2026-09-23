'use strict';
// The dream: what the player wants done with it, and, while building a
// village, which part next and how village-like the place already is.
const { choice, score } = require('../typesafe');
const { define } = require('./index');

// Every dream operation is the player's call. Taking the dream away closes
// its run and cannot be undone, and giving a new one replaces the old: both
// need a surer answer than a question about it does.
const OPERATIONS = {
  set_beat_the_game: 'Give Jev the dream of beating the game: your dream is to beat the game, dream of beating Minecraft, go for the dragon when you have nothing else to do.',
  set_build_a_village: 'Give Jev the dream of building a village: your dream is to build a village, dream of a village, keep adding houses whenever you are free.',
  query: 'Ask what the dream is, or how it is going: what is your dream, what are you working toward, how is the village coming along.',
  pause: 'Set the dream aside for now without forgetting it: pause your dream, stop chasing your dream for now, take a break from the village.',
  resume: 'Pick the dream back up: chase your dream, get back to your dream, carry on with the village.',
  clear: 'Take the dream away: forget your dream, no more dream, give up on the village for good.',
  none: 'None of these; a quoted, hypothetical or negated statement, or a request about something else.',
};
define({
  id: 'dream_operation', source: 'src/dream.js (resolveDream)', unreachable: 'the request fails and the player is told "I\'m having trouble thinking right now"', question: 'What does the speaker want done with Jev\'s dream: set one, ask, pause, resume, or clear?', trigger: 'A message routed as dream.', area: 'dream', kind: 'dream', primitive: 'choice', stakes: 'high',
  gate: { threshold: 0.75, below: 'caller', why: 'clearing the dream below 0.75 and setting one below 0.65 are confirmed in words first; the rest are reversible' },
  bars: { clear: 0.75, set: 0.65 },
  build: () => choice('What does the speaker want to do with Jev\'s dream?', OPERATIONS),
});
define({
  id: 'village_progress', batch: 'village', source: 'src/dream.js (chooseVillagePart)', unreachable: 'the village dream step fails and is set aside for two minutes', question: 'How complete is the village, judged from what stands?', trigger: 'Each step of the build-a-village dream.', area: 'dream', kind: 'dream', primitive: 'score', stakes: 'low',
  build: ({ levels }) => score('How complete is the village described in `standing`, judged from what stands and how the buildings sit together?', levels),
});
define({
  id: 'village_part', batch: 'village', source: 'src/dream.js (chooseVillagePart over villageCandidates)', unreachable: 'the village dream step fails and is set aside for two minutes', question: 'Which part should the village get next, or is it done?', trigger: 'Each step of the build-a-village dream, while parts are on offer.', area: 'dream', kind: 'dream', primitive: 'choice', stakes: 'medium',
  build: ({ candidates }) => choice({
    task: 'The bot is building a village on its own. Which part should it add next?',
    guidance: 'Dwellings first, then a landmark or a centre, then the pieces that make it read as a village. Consider what already stands in `standing` and its counts. Choose done when adding more would not make it more of a village.',
  }, { ...candidates, done: 'The village is complete enough; do not add another building.' }),
});

module.exports = { OPERATIONS };

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
  set_custom: 'Give Jev a dream of its own wording: any single thing a chat request could ask for, done once when Jev has nothing else to do and then finished: your dream is to build a castle by the lake, your dream is to get me a stack of diamonds, your dream is to find a cherry biome. Only when the message says what the dream is; the words after "dream is to" become the dream.',
  query: 'Ask what the dream is, or how it is going: what is your dream, what are you working toward, how is the village coming along.',
  pause: 'Set the dream aside for now without forgetting it: pause your dream, stop chasing your dream for now, take a break from the village.',
  resume: 'Pick the dream back up: chase your dream, get back to your dream, carry on with the village.',
  clear: 'Take the dream away: forget your dream, no more dream, give up on the village for good.',
  none: 'None of these; a quoted, hypothetical or negated statement (if your dream were to build a castle...), or a request about something else.',
};
define({
  id: 'dream_operation', source: 'src/dream.js (resolveDream)', unreachable: 'the request fails and the player is told "I\'m having trouble thinking right now"', question: 'What does the speaker want done with Jev\'s dream: set one (a built-in one or one in the speaker\'s own words), ask, pause, resume, or clear?', trigger: 'A message routed as dream.', area: 'dream', kind: 'dream', primitive: 'choice', stakes: 'high',
  gate: { threshold: 0.75, below: 'caller', why: 'clearing the dream below 0.75 and setting one below 0.65 are confirmed in words first; the rest are reversible' },
  bars: { clear: 0.75, set: 0.65 },
  build: () => choice('What does the speaker want to do with Jev\'s dream?', OPERATIONS),
});
// Whether words given as a custom dream are one thing the bot can go and do.
// The request routing says what kind of request it would be; this says whether
// it is a task at all, since "make the base nicer" routes as a build.
const TEXT_FIT = {
  doable: 'One thing the bot could go and do, and tell when it is done: build a castle by the lake, get a stack of diamonds, find a cherry biome, craft a set of iron armor, go to the village.',
  vague: 'A wish about how things should be or feel, with no one thing to do or no way to tell it is finished: make the base nicer, be a good friend, make everyone happy, do something cool.',
  several: 'Two or more separate jobs in one sentence: get a stack of diamonds and then build a castle and find a cherry biome.',
};
define({
  id: 'dream_text_fit', source: 'src/dream.js (checkCustomText)', unreachable: 'the custom dream is not set and the player is told "I\'m having trouble thinking right now"', question: 'Are the words given as a dream one concrete thing the bot can do?', trigger: 'Setting a custom dream, after the operation is chosen.', area: 'dream', kind: 'dream', primitive: 'choice', stakes: 'low',
  build: () => choice('The player gave the bot a dream in their own words, in `dream_text`: something it will do once, when nothing else needs it. Is it one concrete thing it can go and do?', TEXT_FIT),
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

module.exports = { OPERATIONS, TEXT_FIT };

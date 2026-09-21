'use strict';
const { choice, score } = require('./typesafe');

// A standing goal for when nobody has asked for anything: the thing the bot
// works toward on its own. Code enumerates what could come next from what
// it can observe and can already build; Jev chooses the next milestone; the
// idle loop hands that milestone to the request runner exactly as if a
// player had typed it. A player request still replaces it, "stop" pauses
// it, and progress is only ever read off the world, never off a counter.
const AMBITIONS = {
  beat_the_game: { title: 'beat the game', description: 'Progress through Survival: tools, iron, the Nether, blaze rods, Eyes of Ender, the stronghold, the dragon, and back alive.' },
  build_a_village: { title: 'build a village', description: 'Build a cluster of usable buildings, arranged together, that reads as a village.' },
};

// The village vocabulary: what the bot can build today, and how many of each
// a village wants. Custom parts need the generative designer; without it the
// templates cover dwellings, a landmark and a centre.
const VILLAGE_PARTS = {
  cottage: { request: 'build a small cottage', limit: 4, custom: false, description: 'A small cottage: the basic dwelling. A village wants several, near each other.' },
  mansion: { request: 'build a two floor mansion', limit: 1, custom: false, description: 'A larger two-floor house for the village centre.' },
  tower: { request: 'build a tall watchtower', limit: 1, custom: false, description: 'A watchtower that marks the village from a distance.' },
  well: { request: 'build a small stone well with a little roof', limit: 1, custom: true, description: 'A well at the heart of the village.' },
  farm: { request: 'build a small fenced farm plot with a water channel', limit: 1, custom: true, description: 'A farm plot beside the houses.' },
  chapel: { request: 'build a small stone chapel with a steeple', limit: 1, custom: true, description: 'A chapel with a steeple as the second landmark.' },
};
const PART_WORDS = { cottage: /cottage|small house|hut/i, mansion: /mansion/i, tower: /tower/i, well: /\bwell\b/i, farm: /farm/i, chapel: /chapel|church/i };

function villageState(structures = []) {
  const standing = structures.filter(s => s.standing >= 50 && s.status === 'complete');
  const counts = Object.fromEntries(Object.keys(VILLAGE_PARTS).map(part => [part, standing.filter(s => PART_WORDS[part].test(s.request || s.name || '')).length]));
  return { standing, counts, total: standing.length };
}

function villageCandidates(structures, { customDesigns = false } = {}) {
  const { counts } = villageState(structures);
  return Object.fromEntries(Object.entries(VILLAGE_PARTS)
    .filter(([part, spec]) => counts[part] < spec.limit && (customDesigns || !spec.custom))
    .map(([part, spec]) => [part, `${spec.description} (${counts[part]} standing, up to ${spec.limit}.)`]));
}

const VILLAGE_LEVELS = [
  'Empty land, or a single building standing alone.',
  'Two or three buildings near each other, no centre or landmark yet.',
  'Several dwellings with a centre or a landmark; recognisably a settlement.',
  'A full village: several dwellings, a landmark, a centre, arranged together with nothing obviously missing.',
];

// Which part next, and how village-like the place already is. The Score is
// the hill-climbing signal and the gauge people will watch.
async function chooseVillagePart(client, { structures, customDesigns = false, signal } = {}) {
  const state = villageState(structures), candidates = villageCandidates(structures, { customDesigns });
  const questions = {
    progress: score('How complete is the village described in `standing`, judged from what stands and how the buildings sit together?', VILLAGE_LEVELS),
    ...(Object.keys(candidates).length ? { part: choice({
      task: 'The bot is building a village on its own. Which part should it add next?',
      guidance: 'Dwellings first, then a landmark or a centre, then the pieces that make it read as a village. Consider what already stands in `standing` and its counts. Choose done when adding more would not make it more of a village.',
    }, { ...candidates, done: 'The village is complete enough; do not add another building.' }) } : {}),
  };
  const response = await client.systemOne({ signal, state: { standing: state.standing.map(s => ({ name: s.name, request: s.request, size: s.size, distance: s.distance, standing: s.standing })),
    counts: state.counts, offered: Object.keys(candidates) }, questions });
  const part = response.answers?.part?.choice, progress = response.answers?.progress;
  if (part !== undefined && part !== 'done' && !Object.hasOwn(candidates, part)) throw new Error('Jev chose a village part that was not offered');
  return { part: part === 'done' || part === undefined ? null : part, done: part === 'done' || !Object.keys(candidates).length,
    score: Number.isFinite(progress?.score) ? progress.score : null, confidence: progress?.confidence, levels: VILLAGE_LEVELS,
    judgments: response.answers, usage: response.usage, state };
}

// Where a new part goes: beside the newest standing structure, so the
// village grows as a cluster rather than a scatter.
function besideNewest(structures) {
  const newest = [...structures].filter(s => s.standing >= 50).sort((a, b) => Date.parse(b.builtAt || 0) - Date.parse(a.builtAt || 0))[0];
  return newest ? { ...(newest.entrance || newest.origin) } : null;
}

// The next request the ambition wants run, as a goal spec the session can
// launch. Null means the ambition is satisfied for now.
async function nextAmbitionRequest(client, standing, { structures = [], customDesigns = false, signal } = {}) {
  if (!standing?.ambition || !AMBITIONS[standing.ambition]) return null;
  if (standing.ambition === 'beat_the_game') {
    return { kind: 'win', request: 'beat the game', ambition: 'beat_the_game', from: standing.setBy };
  }
  const chosen = await chooseVillagePart(client, { structures, customDesigns, signal });
  if (chosen.done || !chosen.part) return { done: true, ambition: 'build_a_village', villageScore: chosen.score, judgments: chosen.judgments, usage: chosen.usage };
  const anchor = besideNewest(structures);
  return { kind: 'build', request: VILLAGE_PARTS[chosen.part].request, ambition: 'build_a_village', villagePart: chosen.part,
    villageScore: chosen.score, villageJudgments: chosen.judgments, usage: chosen.usage, from: standing.setBy,
    ...(anchor ? { buildAnchor: anchor, buildContinuation: { mode: 'fresh', placement: 'beside_target', judgments: chosen.judgments } } : {}) };
}

// Whether the idle loop should hand the ambition another request now.
// Never while a player's own request is saved and unfinished, never twice
// in a row on a request that was parked, and never inside the cool-down.
const COOLDOWN_MS = 10 * 60 * 1000;
function shouldLaunchAmbition(standing, lastGoal, { now = Date.now(), ready = true } = {}) {
  if (!standing?.ambition || standing.satisfiedAt || !ready) return false;
  if (lastGoal && !lastGoal.ambition && ['pending', 'running', 'recovering', 'cancelled'].includes(lastGoal.status)) return false;
  if (lastGoal?.ambition && ['pending', 'running', 'recovering'].includes(lastGoal.status)) return false;
  if (standing.lastAttemptAt && now - standing.lastAttemptAt < COOLDOWN_MS && lastGoal?.ambition && lastGoal.status !== 'complete') return false;
  return true;
}

// How the player sets, asks about or clears the standing goal in chat.
const OPERATIONS = {
  set_beat_the_game: 'Make beating the game the standing goal: your goal is to beat the game, work on beating Minecraft when you are free, go for the dragon when you have nothing else to do.',
  set_build_a_village: 'Make building a village the standing goal: build a village when you are free, your goal is a village, keep adding houses when nothing else is going on.',
  query: 'Ask what the standing goal is, or how it is going: what is your goal, what are you working toward, how is the village coming along.',
  clear: 'Remove the standing goal: forget your goal, stop working on the village, no more long-term goal.',
  none: 'None of these; a quoted, hypothetical or negated statement, or a request about something else.',
};
async function resolveAmbition(client, spec) {
  const response = await client.systemOne({ state: { request: spec.request, speaker: spec.from,
    guidance: 'The standing goal is what the bot works toward when nobody has asked for anything. Setting it does not start work immediately if a request is active.' },
  questions: { operation: choice('What does the speaker want to do with the bot\'s standing goal?', OPERATIONS) } });
  const operation = response.answers?.operation?.choice;
  if (!Object.hasOwn(OPERATIONS, operation)) throw new Error('Invalid ambition operation');
  if (operation === 'none') return { ...spec, kind: 'clarify', message: 'You can say "Jev your goal is to beat the game" or "Jev build a village when you are free", ask what my goal is, or tell me to forget it.', clarification: { reason: 'ambition_unclear' } };
  return { ...spec, kind: 'ambition', ambition: { operation, key: operation.startsWith('set_') ? operation.slice(4) : undefined, judgment: response.answers.operation }, usage: response.usage };
}

module.exports = { AMBITIONS, VILLAGE_PARTS, VILLAGE_LEVELS, villageState, villageCandidates, chooseVillagePart, besideNewest, nextAmbitionRequest, shouldLaunchAmbition, resolveAmbition, COOLDOWN_MS };

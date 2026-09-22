'use strict';
const { choice, score } = require('./typesafe');

// A dream for when nobody has asked for anything: the thing the bot
// works toward on its own. Code enumerates what could come next from what
// it can observe and can already build; Jev chooses the next milestone; the
// idle loop hands that milestone to the request runner exactly as if a
// player had typed it. A player request still replaces it, "stop" pauses
// it, and progress is only ever read off the world, never off a counter.
const DREAMS = {
  beat_the_game: { title: 'beat the game', description: 'Progress through Survival: tools, iron, the Nether, blaze rods, Eyes of Ender, the stronghold, the dragon, and back alive.' },
  build_a_village: { title: 'build a village', description: 'Build a cluster of usable buildings, arranged together, that reads as a village.' },
};

// The village vocabulary: the parts a village wants and how many of each.
// A part is on offer only when the schematic shelf holds a design for it,
// so nothing here ever needs a generative model.
const VILLAGE_PARTS = {
  cottage: { limit: 4, description: 'A small cottage: the basic dwelling. A village wants several, near each other.' },
  mansion: { limit: 1, description: 'A larger house for the village centre.' },
  tower: { limit: 1, description: 'A watchtower that marks the village from a distance.' },
  pavilion: { limit: 1, description: 'An open pavilion or gallery: a gathering place between the houses.' },
  monument: { limit: 1, description: 'A monument or sculpture as a landmark at the heart of the village.' },
  well: { limit: 1, description: 'A well at the heart of the village.' },
  farm: { limit: 2, description: 'A farm plot beside the houses.' },
  chapel: { limit: 1, description: 'A chapel with a steeple as the second landmark.' },
  barn: { limit: 1, description: 'A barn for the farm side of the village.' },
  lamp: { limit: 6, description: 'A lamp post for the lanes between the houses; a few of these, spread out, make it feel lived in.' },
  plaza: { limit: 1, description: 'A paved square that gives the village a middle.' },
};
const PART_WORDS = { cottage: /cottage|small house|hut/i, mansion: /mansion/i, tower: /tower/i, pavilion: /pavilion|gallery/i, monument: /monument|sculpture|pyramid|statue/i, well: /\bwell\b/i, farm: /farm/i, chapel: /chapel|church/i, barn: /barn/i, lamp: /lamp/i, plaza: /plaza|square/i };

function villageState(structures = []) {
  const standing = structures.filter(s => s.standing >= 50 && s.status === 'complete');
  const counts = Object.fromEntries(Object.keys(VILLAGE_PARTS).map(part => [part, standing.filter(s => PART_WORDS[part].test(s.request || s.name || '')).length]));
  return { standing, counts, total: standing.length };
}

function villageCandidates(structures, { available = Object.keys(VILLAGE_PARTS) } = {}) {
  const { counts } = villageState(structures);
  return Object.fromEntries(Object.entries(VILLAGE_PARTS)
    .filter(([part, spec]) => counts[part] < spec.limit && available.includes(part))
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
async function chooseVillagePart(client, { structures, available, signal } = {}) {
  const state = villageState(structures), candidates = villageCandidates(structures, { available });
  const questions = {
    progress: score('How complete is the village described in `standing`, judged from what stands and how the buildings sit together?', VILLAGE_LEVELS),
    ...(Object.keys(candidates).length ? { part: choice({
      task: 'The bot is building a village on its own. Which part should it add next?',
      guidance: 'Dwellings first, then a landmark or a centre, then the pieces that make it read as a village. Consider what already stands in `standing` and its counts. Choose done when adding more would not make it more of a village.',
    }, { ...candidates, done: 'The village is complete enough; do not add another building.' }) } : {}),
  };
  const response = await client.systemOne({ signal, kind: 'dream', state: { standing: state.standing.map(s => ({ name: s.name, request: s.request, size: s.size, distance: s.distance, standing: s.standing })),
    counts: state.counts, offered: Object.keys(candidates) }, questions });
  const part = response.answers?.part?.choice, progress = response.answers?.progress;
  if (part !== undefined && part !== 'done' && !Object.hasOwn(candidates, part)) throw new Error('Jev chose a village part that was not offered');
  // No answer to a question that was asked is a failed call, not "done":
  // treated as done, one bad response closed the dream for good.
  if (part === undefined && Object.keys(candidates).length) throw new Error('Jev gave no village part');
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

// The next request the dream wants run, as a goal spec the session can
// launch. Null means the dream is satisfied for now.
async function nextDreamRequest(client, standing, { structures = [], shelf = [], signal } = {}) {
  if (!standing?.dream || !DREAMS[standing.dream]) return null;
  if (standing.dream === 'beat_the_game') {
    return { kind: 'win', request: 'beat the game', dream: 'beat_the_game', from: standing.setBy };
  }
  const available = [...new Set(shelf.map(e => e.part))];
  const chosen = await chooseVillagePart(client, { structures, available, signal });
  if (chosen.done || !chosen.part) return { done: true, dream: 'build_a_village', villageScore: chosen.score, judgments: chosen.judgments, usage: chosen.usage };
  // Then which design from the shelf: a second Jev choice, over real
  // schematics, that ends with a validated design and no generative call.
  const design = await require('./schematic-library').chooseSchematic(client, { part: chosen.part, entries: shelf, structures, signal });
  if (!design) throw new Error(`No design on the shelf could be chosen for the ${chosen.part}`);
  const anchor = besideNewest(structures);
  return { kind: 'build', request: `build ${design.entry.summary.name} (${chosen.part})`, dream: 'build_a_village', villagePart: chosen.part,
    design: { source: design.entry.source, backend: 'schematic-library', libraryId: design.entry.id, createdAt: new Date().toISOString(), judgments: design.judgments, usage: design.usage },
    villageScore: chosen.score, villageJudgments: chosen.judgments, usage: chosen.usage, from: standing.setBy,
    ...(anchor ? { buildAnchor: anchor, buildContinuation: { mode: 'fresh', placement: 'beside_target', judgments: chosen.judgments } } : {}) };
}

// Whether the idle loop should hand the dream another request now.
// Never while a player's own request is saved and unfinished, never twice
// in a row on a request that was parked, and never inside the cool-down.
const COOLDOWN_MS = 10 * 60 * 1000;
// A launch that failed outright (Jev unreachable, an unusable answer) is
// not retried on the next half-second tick. It was, whenever the last goal
// was not a dream: a hot loop of failing calls that also kept the idle
// loop, and with it foraging and shelter, from ever running.
const FAILED_LAUNCH_MS = 2 * 60 * 1000;
function shouldLaunchDream(standing, lastGoal, { now = Date.now(), ready = true } = {}) {
  if (!standing?.dream || standing.satisfiedAt || standing.paused || !ready) return false;
  if (standing.failedAt && now - standing.failedAt < FAILED_LAUNCH_MS) return false;
  if (lastGoal && !lastGoal.dream && ['pending', 'running', 'recovering', 'cancelled'].includes(lastGoal.status)) return false;
  if (lastGoal?.dream && ['pending', 'running', 'recovering'].includes(lastGoal.status)) return false;
  if (standing.lastAttemptAt && now - standing.lastAttemptAt < COOLDOWN_MS && lastGoal?.dream && lastGoal.status !== 'complete') return false;
  return true;
}

// How the player gives, asks about, pauses, resumes or takes back the dream
// in chat. A dream is something the player gives Jev, not something Jev
// chose for itself, so every one of these is the player's call.
const OPERATIONS = {
  set_beat_the_game: 'Give Jev the dream of beating the game: your dream is to beat the game, dream of beating Minecraft, go for the dragon when you have nothing else to do.',
  set_build_a_village: 'Give Jev the dream of building a village: your dream is to build a village, dream of a village, keep adding houses whenever you are free.',
  query: 'Ask what the dream is, or how it is going: what is your dream, what are you working toward, how is the village coming along.',
  pause: 'Set the dream aside for now without forgetting it: pause your dream, stop chasing your dream for now, take a break from the village.',
  resume: 'Pick the dream back up: chase your dream, get back to your dream, carry on with the village.',
  clear: 'Take the dream away: forget your dream, no more dream, give up on the village for good.',
  none: 'None of these; a quoted, hypothetical or negated statement, or a request about something else.',
};
async function resolveDream(client, spec) {
  const response = await client.systemOne({ kind: 'dream', state: { request: spec.request, speaker: spec.from,
    guidance: 'The dream is what Jev chases when nobody has asked for anything. Giving one does not interrupt a request that is active.' },
  questions: { operation: choice('What does the speaker want to do with Jev\'s dream?', OPERATIONS) } });
  const operation = response.answers?.operation?.choice;
  if (!Object.hasOwn(OPERATIONS, operation)) throw new Error('Invalid dream operation');
  if (operation === 'none') return { ...spec, kind: 'clarify', message: 'You can give me a dream ("Jev your dream is to build a village", "your dream is to beat the game"), ask what it is, tell me to chase it or set it aside, or tell me to forget it.', clarification: { reason: 'dream_unclear' } };
  return { ...spec, kind: 'dream', dream: { operation, key: operation.startsWith('set_') ? operation.slice(4) : undefined, judgment: response.answers.operation }, usage: response.usage };
}

module.exports = { FAILED_LAUNCH_MS, DREAMS, VILLAGE_PARTS, VILLAGE_LEVELS, villageState, villageCandidates, chooseVillagePart, besideNewest, nextDreamRequest, shouldLaunchDream, resolveDream, COOLDOWN_MS };

'use strict';

// A dream for when nobody has asked for anything: the thing the bot
// works toward on its own. Code enumerates what could come next from what
// it can observe and can already build; Jev chooses the next milestone; the
// idle loop hands that milestone to the request runner exactly as if a
// player had typed it. A player request still replaces it, "stop" pauses
// it, and progress is only ever read off the world, never off a counter.
const DREAMS = {
  beat_the_game: { title: 'beat the game', description: 'Progress through Survival: tools, iron, the Nether, blaze rods, Eyes of Ender, the stronghold, the dragon, and back alive.' },
  build_a_village: { title: 'build a village', description: 'Build a cluster of usable buildings, arranged together, that reads as a village.' },
  // A player's own words: one request, pursued once (the text is in the standing).
  custom: { title: 'do what I was asked', description: 'Do one request the player gave as a dream, when nothing else needs the bot.' },
};

// What a dream is called in chat: the player's own words for a custom one.
const dreamTitle = standing => standing?.dream === 'custom' ? standing.text : DREAMS[standing?.dream]?.title;

// The village vocabulary: the parts a village wants and how many of each.
// A part is on offer only when the schematic shelf holds a design for it,
// so in Survival nothing here ever needs a generative model. In Creative the
// designer draws the part instead (nextDreamRequest).
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
  const response = await require('./decisions').ask(client, { signal, state: { standing: state.standing.map(s => ({ name: s.name, request: s.request, size: s.size, distance: s.distance, standing: s.standing })),
    counts: state.counts, offered: Object.keys(candidates) }, questions: {
    progress: ['village_progress', { levels: VILLAGE_LEVELS }],
    part: Object.keys(candidates).length && ['village_part', { candidates }],
  } });
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
async function nextDreamRequest(client, standing, { structures = [], shelf = [], designer = false, signal, interpretRequest } = {}) {
  if (!standing?.dream || !DREAMS[standing.dream]) return null;
  if (standing.dream === 'custom') {
    if (!standing.text) throw new Error('The custom dream has no text');
    // The text goes through the same routing a chat request gets, now, with
    // the world as it is (what is carried, what stands nearby).
    const spec = await (interpretRequest || (() => { throw new Error('No way to read the custom dream as a request'); }))(standing.text);
    if (!spec || NOT_A_TASK.has(spec.kind)) throw new Error(`My dream "${standing.text}" did not come out as something I can do`);
    return { ...spec, request: standing.text, dream: 'custom', source: 'dream', dreamSetAt: standing.setAt, from: standing.setBy };
  }
  if (standing.dream === 'beat_the_game') {
    return { kind: 'win', request: 'beat the game', dream: 'beat_the_game', from: standing.setBy };
  }
  const available = [...new Set(shelf.map(e => e.part))];
  const chosen = await chooseVillagePart(client, { structures, available, signal });
  if (chosen.done || !chosen.part) return { done: true, dream: 'build_a_village', villageScore: chosen.score, judgments: chosen.judgments, usage: chosen.usage };
  const anchor = besideNewest(structures);
  const placement = anchor ? { buildAnchor: anchor, buildContinuation: { mode: 'fresh', placement: 'beside_target', judgments: chosen.judgments } } : {};
  // With the generative designer (Creative), the part is drawn for this
  // village rather than taken off the shelf: the shelf still says which
  // parts a village can have, not what they look like.
  if (designer) {
    return { kind: 'build', request: `build ${VILLAGE_PARTS[chosen.part].description.replace(/^A /, 'a ').replace(/\.$/, '')}`, dream: 'build_a_village', villagePart: chosen.part,
      villageScore: chosen.score, villageJudgments: chosen.judgments, usage: chosen.usage, from: standing.setBy, ...placement };
  }
  // Then which design from the shelf: a second Jev choice, over real
  // schematics, that ends with a validated design and no generative call.
  const design = await require('./schematic-library').chooseSchematic(client, { part: chosen.part, entries: shelf, structures, signal });
  if (!design) throw new Error(`No design on the shelf could be chosen for the ${chosen.part}`);
  return { kind: 'build', request: `build ${design.entry.summary.name} (${chosen.part})`, dream: 'build_a_village', villagePart: chosen.part,
    design: { source: design.entry.source, backend: 'schematic-library', libraryId: design.entry.id, createdAt: new Date().toISOString(), judgments: design.judgments, usage: design.usage },
    villageScore: chosen.score, villageJudgments: chosen.judgments, usage: chosen.usage, from: standing.setBy, ...placement };
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
// `resting` is the shared memory's word on a launch that failed recently
// (session.js sets it aside for FAILED_LAUNCH_MS).
function shouldLaunchDream(standing, lastGoal, { now = Date.now(), ready = true, resting = false } = {}) {
  if (!standing?.dream || standing.satisfiedAt || standing.paused || !ready) return false;
  if (resting) return false;
  if (lastGoal && !lastGoal.dream && ['pending', 'running', 'recovering', 'cancelled'].includes(lastGoal.status)) return false;
  if (lastGoal?.dream && ['pending', 'running', 'recovering'].includes(lastGoal.status)) return false;
  if (standing.lastAttemptAt && now - standing.lastAttemptAt < COOLDOWN_MS && lastGoal?.dream && lastGoal.status !== 'complete') return false;
  return true;
}

// A custom dream is one request, pursued to completion once. It ends when the
// request it launched completes, and is set aside (not retried forever) after
// this many attempts that ended blocked or could not launch.
const CUSTOM_ATTEMPTS = 3;
// Routed kinds that are not something the bot can be sent off to do.
const NOT_A_TASK = new Set(['clarify', 'other', 'dream', 'memory', 'status', 'stop', 'resume', 'operator_command']);
const CUSTOM_TEXT_MAX = 200;

// The words after "dream is to": the request the player wants pursued.
// Code cuts the text out of the message; Jev has already said this is a
// custom dream, and the request pipeline says whether it can be done.
function customText(message) {
  const match = String(message || '').replace(/\s*\(yes, now\)\s*$/i, '').match(/\b(?:dream|goal|wish|ambition)\s+(?:is|would be|will be)\s+to\s+(.+)$/is);
  const text = match?.[1].replace(/\s+/g, ' ').replace(/[\s.!]+$/, '').trim();
  return text || null;
}

// Whether the text is a single request the chat pipeline can classify,
// through the same routing a chat request gets, without launching it.
async function checkCustomText(client, text, { from, username, context = {} } = {}) {
  const [probe, fit] = await Promise.all([
    require('./objectives').interpret(client, `${username || 'Jev'} ${text}`, from, username, { ...context, continueBuilds: undefined }),
    require('./decisions').ask(client, { state: { dream_text: text, speaker: from }, questions: { fit: ['dream_text_fit'] } }),
  ]);
  const verdict = fit.answers?.fit?.choice;
  if (!Object.hasOwn(TEXT_FIT, verdict)) throw new Error('Invalid dream text judgment');
  return { ok: !!probe && !NOT_A_TASK.has(probe.kind) && verdict === 'doable', probe, fit: verdict };
}

// Called before each attempt: an attempt that ended blocked counts once
// (by the goal's creation time); a launch that failed counts where it fails.
function noteCustomAttempt(standing, lastGoal) {
  if (standing?.dream !== 'custom') return;
  if (lastGoal?.dream === 'custom' && lastGoal.dreamSetAt === standing.setAt && lastGoal.status === 'blocked' && standing.countedGoal !== lastGoal.createdAt) {
    standing.failures = (standing.failures || 0) + 1; standing.countedGoal = lastGoal.createdAt;
  }
}

// 'done': the request has completed. 'give_up': too many failed attempts.
function customVerdict(standing, lastGoal) {
  if (standing?.dream !== 'custom' || standing.satisfiedAt || standing.paused) return null;
  if (lastGoal?.dream === 'custom' && lastGoal.dreamSetAt === standing.setAt && lastGoal.status === 'complete') return 'done';
  return (standing.failures || 0) >= CUSTOM_ATTEMPTS ? 'give_up' : null;
}

// What the dream is and how it is going, in words, for "what is your dream".
// `lastGoal` is the saved request; only one this dream launched counts.
function dreamReport(standing, lastGoal) {
  if (!standing?.dream) return "I don't have a dream yet. You could give me one: to beat the game, to build a village, or anything you could ask me to do, like build a castle by the lake.";
  const title = dreamTitle(standing);
  if (standing.dream !== 'custom') return standing.satisfiedAt ? `My dream was to ${title}, and I think it's done for now. Tell me to chase it again if you want more.`
    : standing.paused ? `My dream is to ${title}, but I'm keeping it aside until you tell me to chase it.`
    : `My dream is to ${title}. I chase it whenever nothing else needs me.`;
  if (standing.satisfiedAt) return `My dream was to ${title}, and it is done. Tell me to chase it again, or give me a new dream, if you want more.`;
  if (standing.paused) return (standing.failures || 0) >= CUSTOM_ATTEMPTS
    ? `My dream is to ${title}, but I set it aside after ${standing.failures} tries that did not work. Say "chase your dream" to try again.`
    : `My dream is to ${title}, but I'm keeping it aside until you tell me to chase it.`;
  const mine = lastGoal?.dream === 'custom' && lastGoal.dreamSetAt === standing.setAt ? lastGoal : null;
  const going = mine && ['pending', 'running', 'recovering'].includes(mine.status) ? " I'm working on it now."
    : standing.failures ? ` It has not worked out yet: ${standing.failures} ${standing.failures === 1 ? 'try' : 'tries'} so far.`
    : ' I will start when nothing else needs me.';
  return `My dream is to ${title}. I do it once and then it is done.${going}`;
}

// How the player gives, asks about, pauses, resumes or takes back the dream
// in chat. A dream is something the player gives Jev, not something Jev
// chose for itself, so every one of these is the player's call.
const { OPERATIONS, TEXT_FIT } = require('./decisions/dream');
async function resolveDream(client, spec, { username, context } = {}) {
  const response = await require('./decisions').ask(client, { state: { request: spec.request, speaker: spec.from,
    guidance: 'The dream is what Jev chases when nobody has asked for anything. Giving one does not interrupt a request that is active.' },
  questions: { operation: ['dream_operation'] } });
  const operation = response.answers?.operation?.choice;
  if (!Object.hasOwn(OPERATIONS, operation)) throw new Error('Invalid dream operation');
  // Taking the dream away closes its run and cannot be undone, and giving a
  // new one replaces the old: both need a surer answer than a question
  // about it does. Pausing is reversible and is not held back.
  const bars = require('./decisions').question('dream_operation').bars;
  const needed = operation === 'clear' ? bars.clear : operation.startsWith('set_') ? bars.set : 0;
  const confidence = response.answers.operation?.confidence;
  const text = operation === 'set_custom' ? customText(spec.request) : null;
  if (Number.isFinite(confidence) && confidence < needed) {
    return { ...spec, kind: 'clarify', message: operation === 'clear'
      ? 'Do you want me to give up my dream for good? Say "Jev forget your dream" to be sure, or "Jev pause your dream" to set it aside.'
      : `Should my dream be to ${text || DREAMS[operation.slice(4)].title}? Say "Jev your dream is to ${text || DREAMS[operation.slice(4)].title}" to be sure.`,
    clarification: { reason: 'dream_unsure', operation, confidence, threshold: needed } };
  }
  if (operation === 'none') return { ...spec, kind: 'clarify', message: 'You can give me a dream ("Jev your dream is to build a village", "your dream is to beat the game", or any one request, like "your dream is to build a castle by the lake"), ask what it is, tell me to chase it or set it aside, or tell me to forget it.', clarification: { reason: 'dream_unclear' } };
  if (operation === 'set_custom') {
    const suggestion = 'Give me a dream I could do as a request, like "your dream is to build a castle by the lake" or "your dream is to get me a stack of diamonds", or say it as a request and I will do it now.';
    if (!text) return { ...spec, kind: 'clarify', message: `What should my dream be? Say it like "Jev your dream is to build a castle by the lake".`, clarification: { reason: 'dream_no_text' } };
    if (text.length > CUSTOM_TEXT_MAX) return { ...spec, kind: 'clarify', message: `That is too long for one dream. ${suggestion}`, clarification: { reason: 'dream_not_a_request' } };
    const checked = await checkCustomText(client, text, { from: spec.from, username, context });
    if (!checked.ok) return { ...spec, kind: 'clarify', message: checked.probe?.kind === 'clarify' && checked.probe.message
      ? `I could not take "${text}" as a dream yet: ${checked.probe.message} ${suggestion}` : `I do not know how to do "${text}" as a request, so I will not keep it as a dream. ${suggestion}`,
    clarification: { reason: 'dream_not_a_request', text, routed: checked.probe?.kind, fit: checked.fit } };
    return { ...spec, kind: 'dream', dream: { operation, key: 'custom', text, probe: checked.probe, judgment: response.answers.operation }, usage: response.usage };
  }
  return { ...spec, kind: 'dream', dream: { operation, key: operation.startsWith('set_') ? operation.slice(4) : undefined, judgment: response.answers.operation }, usage: response.usage };
}

module.exports = { FAILED_LAUNCH_MS, CUSTOM_ATTEMPTS, NOT_A_TASK, DREAMS, dreamTitle, customText, checkCustomText, noteCustomAttempt, customVerdict, dreamReport, VILLAGE_PARTS, VILLAGE_LEVELS, villageState, villageCandidates, chooseVillagePart, besideNewest, nextDreamRequest, shouldLaunchDream, resolveDream, COOLDOWN_MS };

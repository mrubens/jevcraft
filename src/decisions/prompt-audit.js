'use strict';
// What Jev is told, read for what is false where it is asked (note 677).
//
// A bot sealed in a Nether pocket at hunger 16 with nothing to eat, where no
// health comes back and no day comes, was asked pocket_next with the
// Overworld's guidance ("use the time of day... zombies and skeletons in the
// open burn once the sun is up... a night is about eleven minutes") and a
// state that said daylight: 'day'; it answered stay 0.48 against
// go_for_food 0.25. Nothing checked what a question says against the place
// it is asked in. This does, mechanically, for two kinds of falsehood:
//   overworld   an Overworld-only fact (the sun, day and night, dusk and
//               dawn, beds, the dark's spawning, the surface, trees, the sky,
//               weather) said in a question asked off the Overworld, in its
//               guidance, its state or its options; and the day's fields
//               (timeOfDay, night, daylight...) sent there;
//   contradiction  a question at odds with itself: its state says it is day
//               and an option waits for the dawn, its healing says no health
//               comes back and an option says the bot is healing, its
//               guidance names a record never sent with it.
// Run over the recorded questions by scripts/audit-prompts.js and
// test/prompt-audit.test.js; decide() runs it under the test runner on every
// question the tests build, so a builder that says the sun rises in the
// Nether fails a test (JEV_PROMPT_AUDIT=0 turns that off).

const norm = d => String(d || '').replace(/^minecraft:/, '') || null;
const OVERWORLD = 'overworld';
const offOverworld = dim => !!dim && norm(dim) !== OVERWORLD;
const placeName = dim => norm(dim) === 'the_end' ? 'the End' : 'the Nether';

// The day's fields: true only on the Overworld, where the clock turns day
// into night. Off it they are a clock that means nothing there.
const DAY_FIELDS = ['timeOfDay', 'night', 'daylight', 'minutesToDawn', 'daylightMinutesRemaining', 'daylightTicksRemaining', 'sleepPossibleFrom', 'nightsWithoutSleep', 'phantoms', 'dusk', 'dawn', 'bedtime', 'dawnAt', 'nightStartsAt', 'hostileMobsSpawnAtNight', 'sleepPossible'];
// A day field at any depth, as it goes out; one that says there is no day
// here (healing's daylight off the Overworld) is the truth, and stays.
const isDayField = (key, value) => DAY_FIELDS.includes(key) && !(typeof value === 'string' && SAID_NOT_SO.test(value));
function dayFieldsIn(value, at = 'state', out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => dayFieldsIn(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { if (isDayField(k, v)) out.push({ at: `${at}.${k}`, key: k, value: v }); else dayFieldsIn(v, `${at}.${k}`, out); }
  return out;
}
function withoutDayFields(value) {
  if (Array.isArray(value)) return value.map(withoutDayFields);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) if (!isDayField(k, v)) out[k] = withoutDayFields(v);
  return out;
}

// Words true only of the Overworld. A clause that also says it is of the
// Overworld (the food there, the night on the other side) or says the thing
// is not so here (no daylight comes, nothing burns off) is not flagged.
const OVERWORLD_TERMS = [
  ['the sun', /\b(sun(rise|set|light)?|sun is up|sun's up)\b/i],
  ['daylight', /\bdaylight\b/i],
  ['dawn or dusk', /\b(dawn|dusk|sunrise|sunset|morning|evening)\b/i],
  ['night', /\b(night(s|fall|time)?|tonight)\b/i],
  ['the time of day', /\b(time of day|by day|daytime|a day is|day comes|until day)\b/i],
  ['burning undead', /\b(zombies?|skeletons?|undead)\b[^.;]*\bburn/i],
  ['sleep and beds', /\b(sleep\w*|bedtime|bed nook|the bed|a bed|carried bed)\b/i],
  ['weather', /\b(rain(s|ing)?|thunder\w*|storm|weather)\b/i],
  ['the surface', /\b(surface|open sky|under the sky|the sky)\b/i],
  ['trees', /\b(trees?|saplings?)\b/i],
  ['spawning by the dark', /\b(spawn\w* (in|by) the dark|dark enough for (monsters|mobs|hostiles))\b/i],
];
const SAID_OF_ELSEWHERE = /\b(overworld|other side|through the portal|back through|surface's|topside)\b/i;
const SAID_NOT_SO = /\b(no|not|never|neither|nor|none|without|nothing)\b[^.;]{0,40}\b(day|daylight|night|dawn|sun|burn\w*|sky|trees?|beds?|sleep|surface|weather|rain|morning)\b|\b(day|daylight|night|dawn|sun|sky|trees?|surface)\b[^.;]{0,30}\b(does not|do not|never|nor)\b|\bexplode/i;
// Off the Overworld, a clause claiming the Overworld's facts; on it, one
// claiming the Nether's (no day comes) with no place named.
const NETHER_CLAIM = /\bno (day|daylight|day or night|night) (comes|here|and no night)\b/i;
const NAMES_A_PLACE = /\b(nether|the end|overworld|off the overworld|outside the overworld)\b/i;

const clauses = s => String(s).split(/(?<=[.;!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);

// Every string in a value with where it sits.
function strings(value, at, out = []) {
  if (typeof value === 'string') out.push({ at, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, at ? `${at}.${k}` : k, out);
  return out;
}

// The request's parts: the guidance, the state, each option's words.
function partsOf({ instructions, state, tree }) {
  const parts = [];
  if (instructions) for (const k of ['task', 'guidance']) if (instructions[k]) parts.push({ at: `instructions.${k}`, text: instructions[k], kind: 'guidance' });
  // The trail is history (what the bot was doing where), not a claim.
  for (const s of strings(state || {}, 'state')) if (!/^state\.recentPositions\b/.test(s.at)) parts.push({ ...s, kind: 'state' });
  const visit = (children, path) => {
    for (const [key, node] of Object.entries(children || {})) {
      if (key === 'none_good') continue;
      for (const s of strings(node?.description, `option ${[...path, key].join('/')}`)) parts.push({ ...s, kind: 'option' });
      if (node?.children) visit(node.children, [...path, key]);
    }
  };
  visit(tree, []);
  return parts;
}

// Overworld-only facts off the Overworld. `except` is terms a question
// may say there (a bed carried, which the options say explodes).
function overworldFindings({ id, dimension, instructions, state, tree }) {
  const found = [];
  if (!dimension) return found;
  if (!offOverworld(dimension)) {
    for (const p of partsOf({ instructions, state, tree })) for (const c of clauses(p.text)) {
      if (NETHER_CLAIM.test(c) && !NAMES_A_PLACE.test(c)) found.push({ class: 'contradiction', rule: 'nether-claim-on-the-overworld', id, dimension, at: p.at, term: 'no day', clause: c });
    }
    return found;
  }
  for (const f of dayFieldsIn(state || {})) found.push({ class: 'overworld', rule: 'day-field', id, dimension, at: f.at, term: f.key, clause: `${f.key}: ${JSON.stringify(f.value)}` });
  for (const p of partsOf({ instructions, state, tree })) for (const c of clauses(p.text)) {
    if (SAID_OF_ELSEWHERE.test(c) || SAID_NOT_SO.test(c)) continue;
    const hit = OVERWORLD_TERMS.find(([, re]) => re.test(c));
    if (hit) found.push({ class: 'overworld', rule: `overworld-${p.kind}`, id, dimension, at: p.at, term: hit[0], clause: c });
  }
  return found;
}

// A question at odds with itself.
const WAITS_FOR_DAWN = /\buntil (dawn|daylight|morning)\b|\bminutes to dawn\b/i;
const SAYS_HEALING = /\bhealing from\b|\bhealth (is )?coming back\b/i;
const HEALING_NO = /^no\b/i;
function contradictionFindings({ id, dimension, instructions, state, tree }) {
  const found = [];
  const parts = partsOf({ instructions, state, tree });
  // Day by the state, a wait for the dawn in the words.
  const day = state && (state.night === false || /^day\b/.test(String(state.daylight || '')) || /^day\b/.test(String(state.healing?.daylight || '')));
  if (day) for (const p of parts) if (p.kind !== 'state') for (const c of clauses(p.text)) if (WAITS_FOR_DAWN.test(c) && !SAID_NOT_SO.test(c)) found.push({ class: 'contradiction', rule: 'day-yet-waits-for-dawn', id, dimension, at: p.at, term: 'dawn', clause: c });
  // No health back by the state, health coming back in the words.
  const noHeal = HEALING_NO.test(String(state?.healing?.healthComesBack || ''));
  if (noHeal) for (const p of parts) if (p.kind !== 'state') for (const c of clauses(p.text)) if (SAYS_HEALING.test(c) && !/\bnot healing\b|\bno health\b|\bnot\b[^.;]{0,20}\bheal|\b(eat\w*|once|when|until|if|after)\b/i.test(c)) found.push({ class: 'contradiction', rule: 'no-healing-yet-healing', id, dimension, at: p.at, term: 'healing', clause: c });
  return found;
}

// The records a guidance names by their field names (camelCase, as the
// state carries them), for the corpus to check each is ever sent.
const FIELD = /`([a-z]+[A-Z][A-Za-z]*)`|\b([a-z]+[A-Z][A-Za-z]*)\b/g;
function fieldsNamed(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(FIELD)) out.add(m[1] || m[2]);
  return [...out];
}
function keysOf(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach(v => keysOf(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); keysOf(v, out); }
  return out;
}

function audit(request) {
  return [...overworldFindings(request), ...contradictionFindings(request)];
}

// The shared glosses' own fields: said only when the field is there.
const GLOSSED = new Set(['riskNow', 'deathWouldCost', 'recentDeaths', 'sameAnswerAgain', 'lastAnswersCameToNothing', 'answersThatCameToNothing', 'waysResting', 'whatFailedBelow', 'recentPositions', 'runClock', 'blockStock', 'makingAPickaxe', 'sculk', 'withoutFood', 'tripBackForFood', 'hoglinHunt', 'healing']);

module.exports = { withoutDayFields, dayFieldsIn, audit, overworldFindings, contradictionFindings, fieldsNamed, keysOf, clauses, partsOf, DAY_FIELDS, OVERWORLD_TERMS, offOverworld, norm, placeName, GLOSSED, SAID_NOT_SO, SAID_OF_ELSEWHERE };

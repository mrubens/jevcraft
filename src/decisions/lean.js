'use strict';
// The question as it goes out: the same facts in fewer words (note 672).
//
// Jev is a System One model, asked for a quick judgment, and on 2026-09-28
// and 29 it was asked 5.3 times a bot-minute, a median of 8,200 characters
// (p90 20,600, the largest 88,800). Re-asked on the recorded cases with
// each field dropped, the options moved the most answers and the shared
// records few; said as prose, the same records moved answers too. So what
// goes out keeps every option's words and every record's shape, and loses
// only what is said twice or never read:
//   - numbers to a tenth (19.599998474121094 is 19.6);
//   - fields with nothing in them (null) left out;
//   - the same words twice in a list said once, with how often;
//   - deathWouldCost's note, recentPositions' held places run together
//     (LEAN);
//   - playedAnswers to its rows for this situation (RECORDS).
// Applied in one place, the client's request (typesafe.js exchange), so
// every question and every replay goes out the same way, while what the
// code built stays in the decision record and in the tests' stubs. The
// builders' own words are theirs to make lean; test/lean.test.js holds each
// question to its ceiling on the replay fixtures.

// Characters a request may come to as sent, on the replay fixtures
// (evals/replays/cases.jsonl): test/lean.test.js fails over it. CAP for a
// question not named below; the rest are held at what they came to on
// 2026-09-29 (note 672), a ratchet to lower as their builders are made
// lean, never to raise. The options and the questions' own guidance carry
// what moves the answer (re-asked with each option cut to its first
// sentence, 135 of 247 answers moved, 42 cases lost), so they are not cut
// here: their builders are where the words go.
const CAP = 2500;
const CEILING = { encounter_stance: 27500, stillness_detour: 16000, pocket_next: 15500, nether_gather: 14000, unstuck_move: 12500,
  fortress_approach: 12000, portal_plan: 11500, hunt_target: 11500, kit_food: 10500, fortress_leg: 9500, upkeep: 8500,
  bastion_raid: 8500, body_way: 7000, fortress_visit: 6000, shelter_method: 5000, nether_food_kit: 5000, rung_progress: 5000,
  way_down: 4500, while_cooking: 4500, climb_out: 4000, leave_nether: 4000, empty_spawner: 3900, surface_trip: 3000 };
// empty_spawner (note 704): the plain cap was set on its full-health cases;
// in the lull at low health, with heal_first and the lull's ways, it came to
// about 3,080 as built before stash_rods, and 3,820 with it and the rods'
// fact (rodsCarried), which moved the replay case from 0 of 5 to 10 of 10.
// turn_priority (note 752): its first fixture, 25595's hoglin on the span,
// comes to about 6,500 as sent (live asks were a median 4,666 characters in
// note 672's count; this one carries the drop into the lava said twice and
// the reach said on both options). Held there, not above.
CEILING.turn_priority = 6600;
// survival_priority (note 755): its first fixture, 25594's seal under the
// rock at full health, comes to about 11,900 as sent (the state's death
// cost, positions and the night's hunts and stash said whole). Held there.
CEILING.survival_priority = 12000;
const ceilingOf = id => CEILING[id] ?? CAP;

class Said { constructor(s) { this.s = s; } }
const round = n => Number.isInteger(n) ? n : Math.round(n * 10) / 10;
function tidy(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? round(v) : v;
  // The same words said again in a list are said once, with how often:
  // whatFailedBelow carried one escalation five times over (note 672).
  if (Array.isArray(v)) {
    const out = [], times = new Map();
    for (const x of v) {
      if (typeof x !== 'string') { out.push(tidy(x)); continue; }
      if (times.has(x)) { times.set(x, times.get(x) + 1); continue; }
      times.set(x, 1); out.push(new Said(x));
    }
    return out.map(e => e instanceof Said ? (times.get(e.s) > 1 ? `${e.s} (${times.get(e.s)} times)` : e.s) : e);
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined) continue;
      out[k] = tidy(x);
    }
    return out;
  }
  return v;
}

// Each shared record in its own shape, less what it says twice or what the
// question never turns on. Said as prose instead, the same figures moved
// answers (runClock alone 10 of 34 near-even cases, 6 of them the replay's
// expected answer lost; riskNow, recentPositions and healing about as
// many): Jev reads these records in the shape it has always had them.
// runClock goes whole: cut to the four ways that took the most minutes, it
// still moved a replay case (basalt-delta-walk-off-25583, none_good 3 of
// 10 against none), and dropped it moved more answers than any other
// shared record (21 of 206).
const LEAN = {
  // What a death would lose, less the fields with nothing in them and the
  // note that says what every death does.
  deathWouldCost(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return d;
    const { note: _note, ...rest } = d;
    return rest;
  },
  // The trail with a place held run together: the same cell and the same
  // doing fifteen seconds apart, said once with how many looks it held.
  recentPositions(t) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.places)) return t;
    const places = [];
    for (const p of t.places) {
      const last = places.at(-1);
      if (last && last.x === p.x && last.y === p.y && last.z === p.z && last.doing === p.doing) { last.looks = (last.looks || 1) + 1; continue; }
      places.push({ ...p });
    }
    return { ...t, places };
  },
};

// The table of what followed each kind of answer in the bot's own past
// fights (playedAnswers, note 661), to the rows for the situation it is in
// (its first sentence) and what the rest says that is not a count of past
// fights. Re-asked without it, 4 of 12 answers moved (between two asks of
// the same question, 5 of 247), so the rows stay; the tables after them,
// how the rods came in the fights that took one, were the self-referential
// part. playedRecord moved 4 of 32 dropped, and cut to its rows it moved a
// replay case to its forbidden answer (span-toward-a-fortress-38-up), so it
// is sent whole; blazeCounts (note 665) is too new to have been measured,
// and is sent whole.
const RECORDS = { playedAnswers: 1 };
const COUNTS_FIGHTS = /\b\d+ (fights?|deaths?|rods?)\b|\d+%/;
function recordSays(s, first) {
  if (typeof s !== 'string') return s;
  const all = sentences(s);
  if (all.length <= first) return s;
  return [...all.slice(0, first), ...all.slice(first).filter(x => !COUNTS_FIGHTS.test(x))].join(' ');
}

function leanState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    let x = v;
    try { if (LEAN[k]) x = LEAN[k](v); else if (RECORDS[k]) x = recordSays(v, RECORDS[k]); } catch (_) { x = v; }
    out[k] = x;
  }
  return tidy(out);
}

// Sentences, split where a sentence ends and a capital begins.
const sentences = s => String(s).split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
// An option's words go as they are, but for their numbers. A sentence
// every option said was tried said once beside the question instead: on
// span-ghast-walled-toward-push, where every option said the bot stands
// walled toward the ghast's push, Jev took none_good 17 times in 20 against
// 2 in 20 with each option saying it (note 672). What is true whichever is
// chosen still bears on how each option ends.
const leanDescription = d => d && typeof d === 'object' ? tidy(d) : d;

// The whole request as it goes out: the state lean, and each choice's
// options with their numbers to a tenth. JEV_LEAN=0 sends it as built.
function leanRequest(request) {
  if (process.env.JEV_LEAN === '0') return request;
  const { state, questions } = request;
  const out = {};
  for (const [id, q] of Object.entries(questions || {})) {
    if (q?.type !== 'choice' || !q.criteria || typeof q.criteria !== 'object') { out[id] = q; continue; }
    out[id] = { ...q, criteria: Object.fromEntries(Object.entries(q.criteria).map(([k, d]) => [k, leanDescription(d)])) };
  }
  return { state: leanState(state), questions: out };
}

module.exports = { CAP, CEILING, ceilingOf, leanState, leanRequest, tidy, sentences, LEAN };

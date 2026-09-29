'use strict';
// An answer that ended in its first second (note 695).
//
// On 25591 (mid-242-jb, 22:19:51 to 22:19:54Z on 2026-09-29) nine questions
// were answered in three seconds, each answer's action ending within a
// second of being chosen and the next question asked at once: upkeep
// fetch_stems, nether_gather cross_to_2 ("Not bridging with a piglin 17
// blocks off able to see me"), floor_to_2 (no route to the foot of the way
// down), cross_to_1 (the piglin again), leave_nether search_on,
// fortress_visit go_in, fortress_approach return_for_blocks (the way back
// began as a hunt for wood), nether_gather without, leave_nether wait_here.
// Since 18:00Z, 632 of 10,701 plan answers (6%) ended in a failure within
// two seconds, and 1,057 runs of three or more answers came within five
// seconds (scripts/instant-failures.js).
//
// The first cure is not to offer what its own first check refuses (the
// span's check, the pathfinder's walk to the way down, the trip home's first
// move). What still ends at once is read here, at the next question asked
// of any loop: an answer that starts something that takes time
// (intention.js TIMED), chosen under two seconds before, the bot within two
// blocks of where it was chosen, nothing come of it, and not cut short by
// the survival layer. It rests from where it was chosen with its reason
// (tried.hold, five minutes), and every question asked in the next half
// minute says it: which answer, how soon it ended and why, and how many
// ended so in a row.
const tried = require('./tried');

const AT_ONCE_MS = 2000, MOVED = 2, SAID_MS = 30000, KEEP = 8;
const P = v => v && Number.isFinite(v.x) ? v : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const words = s => String(s || '').replaceAll('_', ' ');
const secs = ms => `${Math.max(0.1, Math.round(ms / 100) / 10)} seconds`;

function committing(q, method) {
  try { return require('./intention').committing(q, String(method || '').split('/').at(-1)); } catch (_) { return false; }
}

// A question asked as the answer's own means (the approach under go_in,
// the gathering under a walk back) is its action under way, not its end.
function means(q, e) {
  if (q === e.q) return false;
  try { if (underOf(q, e.q)) return true; } catch (_) { /* no tree */ }
  try { return !!require('./intention').wayOf(q, { q: e.q, choice: String(e.method).split('/').at(-1) }); } catch (_) { return false; }
}
function underOf(q, above) {
  const { parentOf } = require('./decisions');
  const seen = new Set();
  for (let p = parentOf(q); p && !seen.has(p); p = parentOf(p)) { if (p === above) return true; seen.add(p); }
  return false;
}
// Read at the start of question `q`: the answer given last, if it ended at
// once and another question is being asked in its place, rested and kept;
// else null. Ended is known two ways: its entry settled as come to nothing,
// or a failure noted while it was the answer being carried out (work.js
// noteError). Its own question asked again at once is the ledger's and the
// quick-return rule's (tried.js, repeats.js note 570), which say it there.
function check(bot, goal, q, now = Date.now()) {
  const e = goal?.tried?.entries?.at(-1);
  if (!e || e.atOnceRead || e.held || e.cut || e.waiting) return null;
  if (!['pending', 'blocked'].includes(e.outcome) || now - e.at > AT_ONCE_MS) return null;
  if (!committing(e.q, e.method)) return null;
  const here = P(bot?.entity?.position);
  if (!here || !e.place || dist(here, e.place) > MOVED) return null;
  const f = goal.lastFailure;
  const failed = !!(f?.why && f.at >= e.at && f.by && f.by.q === e.q && f.by.method === e.method && f.by.at === e.at);
  if (q === e.q || !(e.outcome === 'blocked' || failed) || means(q, e)) return null;
  e.atOnceRead = true;
  if (e.outcome === 'pending') tried.settle(bot, goal, { q: e.q, now });
  if (e.outcome !== 'blocked' || e.cut) return null;
  const why = String((failed ? f.why : null) || e.why || 'it ended with nothing come of it').slice(0, 200);
  const method = e.method, target = e.target || null;
  const ended = { q: e.q, method, at: e.at, endedAt: now, why, ...(target ? { target } : {}) };
  tried.hold(bot, goal, e.q, [method], `ended ${secs(now - e.at)} after it was chosen: ${why}`, { target, now });
  goal.atOnce = [...(goal.atOnce || []).filter(a => now - a.endedAt < SAID_MS), ended].slice(-KEEP);
  console.log(`[at once] ${e.q}/${method} ended ${secs(now - e.at)} after it was chosen: ${why}; it rests from here`);
  return ended;
}

// The facts line for a question asked in the half minute after: each
// answer that ended at once, newest last.
function says(goal, now = Date.now()) {
  const list = (goal?.atOnce || []).filter(a => now - a.endedAt < SAID_MS);
  if (!list.length) return null;
  const one = a => `${words(a.method)} (${words(a.q)}), chosen ${secs(now - a.at)} ago, ended ${secs(a.endedAt - a.at)} after: ${a.why}; it rests from where it was chosen for 5 minutes`;
  if (list.length === 1) return one(list[0]);
  const span = Math.round((now - list[0].at) / 1000);
  return `${list.length} answers in the last ${span} seconds each ended within ${AT_ONCE_MS / 1000} seconds of being chosen, each now resting from where it was chosen: ${list.map(one).join('; ')}`;
}

module.exports = { check, says, AT_ONCE_MS, SAID_MS };

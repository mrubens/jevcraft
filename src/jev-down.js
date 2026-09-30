'use strict';
// Jev down: no decision is made by code (the user, 2026-09-30: "I don't
// want jev fallbacks. If jev is down, decisions aren't made.").
//
// Every question used to carry a fallback, the code's own order, walked
// when TypeSafe errored, timed out or was not configured, and the bot went
// on acting on it. Now a question Jev cannot answer is not answered: the
// asker holds where it is (its step stops, the walk and the keys held are
// let go, nothing new is chosen) and asks again with a backoff. The body's
// own physics goes on meanwhile: the reflexes that are rules (lava, fire,
// a hot floor, a head in a block, the breath, the shot in the air, note
// 676, the one-shot line, note 701) stop the hold through the task's check,
// as they stop anything, and the two questions whose unanswered form is
// physical safety (body_way, shot_answer) are answered by their safety rule.
// When Jev answers again, the question held is not acted on with the facts
// it was built from: it comes back stale, and its caller asks it fresh.
//
// Said once an outage: '[jev down]' in the log, and in chat that the bot is
// waiting for Jev; and '[jev down] back' with Jev's return.

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504, 529]);
// Whether an error is Jev not being reachable (an outage, a timeout, a
// connection refused, a garbled answer, the breaker open, no client), as
// against a question rejected (a 4xx: a bug to fix, thrown as before) or a
// stop of the bot's own (a cancel, the air, a threat, a stall). The caller
// looks at its own signal first: a stop of its own is a stop, not an outage.
const STOPS = new Set(['Cancelled', 'NeedsAir', 'NeedsSafety', 'Stalled', 'Blocked', 'CutShort', 'EndEmergency', 'BadAnswer']);
const unreachable = err => {
  if (!err || STOPS.has(err.name)) return false;
  if (err.name === 'TypeSafeError') return !err.status || TRANSIENT.has(err.status);
  return true;
};

class JevDown extends Error {
  constructor(message) { super(message); this.name = 'JevDown'; }
}

// Asked again after 1, 2, 4, 8 and then every 15 seconds. The tests shorten
// it (setBackoff) so a held question is not seconds of a test.
let BACKOFF = [1000, 2000, 4000, 8000, 15000];
const setBackoff = steps => { BACKOFF = steps; };
const backoffFor = attempt => BACKOFF[Math.min(attempt, BACKOFF.length - 1)];

// The outage, kept on the bot while it lasts (and one per process with no
// bot, for the tests and the scripts).
const noBot = {};
const holder = bot => bot || noBot;

// Held: the step stops where it is. The walk's goal and the keys held are
// let go; the crouch is kept (a crouch on a magma block is the body's own
// rule, and a crouch at an edge keeps it on it). An aside question (a
// shooter's warning) holds nothing: it is asked beside the turn's holder.
function holdStill(bot) {
  if (!bot) return;
  try { bot.pathfinder?.setGoal?.(null); } catch (_) { /* not walking */ }
  for (const key of ['forward', 'back', 'left', 'right', 'sprint', 'jump']) { try { bot.setControlState?.(key, false); } catch (_) { /* no controls */ } }
}

// The first failure of an outage: said once, in the log and in chat.
function down(bot, goal, id, err, { aside = false, log = console.log } = {}) {
  const h = holder(bot);
  const reason = String(err?.message || err || 'no answer').slice(0, 200);
  if (!aside) holdStill(bot);
  if (h._jevDown) h._jevDown.lastAt = Date.now();
  if (!h._jevDown) {
    h._jevDown = { since: Date.now(), lastAt: Date.now(), reason, questions: [id], asks: 0 };
    log(`[jev down] ${id}: ${reason}; no decision is made until Jev answers: holding, asking again`);
    try { bot?.chat?.("Jev isn't answering, so I'm waiting here until it does."); } catch (_) { /* no chat */ }
    if (goal) goal.jevOutage = { since: new Date(h._jevDown.since).toISOString(), reason };
  } else if (!h._jevDown.questions.includes(id)) {
    h._jevDown.questions.push(id);
    log(`[jev down] ${id} held too`);
  }
  return h._jevDown;
}

// An answer after an outage: said once, and the outage ends.
function back(bot, goal, id, { log = console.log } = {}) {
  const h = holder(bot);
  const was = h._jevDown;
  if (goal?.jevOutage) delete goal.jevOutage;
  if (!was) return null;
  delete h._jevDown;
  const seconds = Math.round((Date.now() - was.since) / 1000);
  log(`[jev down] back: ${id} answered after ${seconds}s down (${was.questions.join(', ')} held); what was held is asked fresh`);
  try { bot?.chat?.('Jev is back.'); } catch (_) { /* no chat */ }
  return { ...was, seconds };
}

// Whether the bot is waiting for Jev now: a question failed within the last
// minute and none has been answered since. A mark left by a hold that was
// stopped (a reflex took the turn) and never asked again lapses, so the
// stall watch and the arbiter's clock cannot stay off for good.
const STALE_MS = 60000;
const isDown = (bot, now = Date.now()) => { const d = holder(bot)._jevDown; return !!d && now - (d.lastAt || d.since) < STALE_MS; };

// The wait before the next ask, cut short by the signal (the task's check,
// a reflex, the air): then the signal's reason is thrown, as any stop is.
async function pause(attempt, signal) {
  const ms = backoffFor(attempt);
  await require('node:timers/promises').setTimeout(ms, undefined, signal ? { signal } : undefined).catch(err => { throw signal?.reason || err; });
}

// The same, looked at through `check` every tenth of a second (a batched
// question has no watcher of its own): a stop it throws ends the wait.
async function pauseChecked(attempt, check, every = 100) {
  const end = Date.now() + backoffFor(attempt);
  for (;;) {
    check();
    const left = end - Date.now();
    if (left <= 0) return;
    await require('node:timers/promises').setTimeout(Math.min(every, left));
  }
}

// Under the test runner a question held this many times running is a test
// that forgot its stand-in, not an outage: it fails instead of hanging.
const TEST_ASKS = 200;
const testHeld = [];

module.exports = { unreachable, JevDown, down, back, isDown, holdStill, pause, pauseChecked, backoffFor, setBackoff, TEST_ASKS, testHeld, TRANSIENT };

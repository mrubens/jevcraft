'use strict';
// The same question, the same facts, the same answer, and nothing came of
// it (note 560). The progress audit (note 558) found Jev asked portal_method
// 532 times in fifteen minutes, answered cast_frame every time, each pass
// ending at once on a slot with nowhere to stand; survival_priority 222
// times for the same walk to a sheep with no route; night_mine_target every
// two seconds for an ore the walk never reached; and a pillar against a
// piglin that could not get up to the bot chosen every fifteen seconds for
// minutes while the crossing waited. Each answer returned and the step
// asked again, told nothing of the answer before.
//
// Here every question about playing the game is remembered by its facts
// (a fingerprint of its state and options, clocks left out and the numbers
// in words set aside, so "failed 3,466 times" is the same fact as "failed
// 3,467 times") and its answer. Asked again with the same facts after the
// same answer, with nothing measurable between (no new ground, nothing
// worth keeping gained, no block dug or placed, no progress the stall
// watch saw), the answer is said to have come to nothing, in the question's
// own facts. And when it came back at once, twice running, it is not asked
// a third time: it is held as failed, said, and the stall path (a detour,
// Jev's) takes the step.

// What changes with time alone: never part of the facts compared.
const CLOCK = /^(at|askedAt|since|until|t0|stages|secondsAgo|minutesAgo|timeOfDay|time|age|runClock|recentPositions|recentDeaths|daylight|daylightTicksRemaining|lastHalfHourBy|minutesBy|minutesPlayed|minutesSinceStart|hasHadTheTurnSeconds|didNothingWithItSeconds|sameAnswerAgain|lastAnswersCameToNothing|answersThatCameToNothing|workWaits)$/i;
const TIMELY = /(Seconds|Minutes|Ms|Ago|Ticks)$|^(minutes|seconds)[A-Z]/;
function fingerprint(state, tree) {
  const seen = new WeakSet();
  const norm = v => {
    if (typeof v === 'string') return v.replace(/\d[\d,]*(\.\d+)?/g, '#');
    if (typeof v === 'number') return Math.round(v);
    if (!v || typeof v !== 'object') return v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(norm);
    const out = {};
    for (const k of Object.keys(v).sort()) if (!CLOCK.test(k) && !TIMELY.test(k) && typeof v[k] !== 'function') out[k] = norm(v[k]);
    return out;
  };
  const options = {};
  const visit = (children, into) => { for (const [k, n] of Object.entries(children || {})) { into[k] = { d: norm(n?.description) }; if (n?.children) visit(n.children, into[k].c = {}); } };
  visit(tree, options);
  return JSON.stringify([norm(state), options]);
}

// What counts as something coming of an answer: the stall watch's own
// measures (stillness.js), read directly so an answer that ends in a
// fraction of a second is judged before the watch's next look.
const GROUND = 3;
function mark(bot) {
  const p = bot?.entity?.position;
  let worth = 0; try { worth = require('../stillness').worth?.(bot) ?? 0; } catch (_) { /* no inventory */ }
  return { x: p?.x, y: p?.y, z: p?.z, worth, blocks: bot?._stalls?.marked || 0, progressAt: bot?._stalls?.progressAt || 0 };
}
function cameOf(before, now, since) {
  const moved = Number.isFinite(before.x) && Number.isFinite(now.x) ? Math.hypot(now.x - before.x, now.y - before.y, now.z - before.z) : 0;
  if (moved > GROUND) return `moved ${Math.round(moved)} blocks`;
  if (now.worth !== before.worth) return 'what is carried changed';
  if (now.blocks !== before.blocks) return 'a block was dug or placed';
  if (now.progressAt > since) return 'the stall watch saw progress';
  return null;
}

// Why the last answer ended, when something said so after it was given:
// the work's own failure (work.js noteError), a survival walk with no route.
function whyItEnded(bot, goal, since) {
  const f = goal?.lastFailure;
  if (f?.why && f.at >= since) return f.why;
  const w = bot?._survivalState?.walkFailed;
  if (w?.says && w.at >= since) return w.says;
  return null;
}

// Came back "at once": the next asking within this of the answer. The
// loops that went nowhere asked again every 0.1 to 4 seconds; a wait asks
// again at ten seconds or more.
const AT_ONCE_MS = 5000;
// Held after the second such answer, not the first: one answer that ends
// at once can be a step taken (a block dug down a pillar, a door opened);
// two in a row with the same facts and nothing between are a loop.
const HOLD_AFTER = 2;
// What is remembered: a run of the same answer, broken by new facts, a
// new answer, or something measurable coming of it.
const KEEP_MS = 10 * 60000;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const span = ms => ms < 90000 ? plural(Math.max(1, Math.round(ms / 1000)), 'second') : plural(Math.round(ms / 60000), 'minute');
function says(run, now) {
  const at = run.gaps.every(g => g <= AT_ONCE_MS);
  return `${run.choice.replaceAll('_', ' ')} was chosen ${plural(run.times, 'time')} in the last ${span(now - run.first)} with these same facts, and nothing measurable came of ${run.times === 1 ? 'it' : 'any of them'} (no new ground, nothing gained, no block dug or placed)` +
    `${at && run.times > 1 ? `; each came back within ${(s => s === 1 ? 'a second' : `${s} seconds`)(Math.max(1, Math.ceil(Math.max(...run.gaps) / 1000)))}` : ''}${run.why ? `: ${run.why}` : ''}`;
}

// Before asking: the run this question is in, if its last answer came to
// nothing with these same facts. -> { run, says, hold } or null
function before(bot, goal, id, print, { now = Date.now(), waiting = false } = {}) {
  const memo = bot?._repeats;
  const run = memo?.[id];
  if (!run || now - run.at > KEEP_MS) return null;
  if (run.print !== print) return null;
  const came = cameOf(run.mark, mark(bot), run.at);
  if (came) { delete memo[id]; return null; }
  if (!run.counted) {
    run.counted = true;
    run.gaps.push(now - run.at);
    run.why = whyItEnded(bot, goal, run.at) || run.why;
  }
  const hold = !waiting && run.times >= HOLD_AFTER && run.gaps.length >= HOLD_AFTER && run.gaps.slice(-HOLD_AFTER).every(g => g <= AT_ONCE_MS);
  return { run, says: says(run, now), hold };
}

// The answers that came back at once, whatever the facts (note 570). The
// fingerprint above changes with the facts, and a question whose answer
// moves its own target (a place left, the next place asked) or turns
// between two answers never meets the same facts twice: mid-242-ac-nether-
// 2-fortress-1 answered fortress_approach 351 times in ten minutes, other
// way 345 of them, each back within half a second; portal_way's
// around_right and around_left each came back within 0.3 of a second
// having moved nothing (note 568). So each question also keeps its last
// answers in a row that came back within AT_ONCE_MS with nothing
// measurable between, whatever was answered and whatever the facts: said
// from the first, held at the third.
const QUICK_HOLD = 3;
function quickBefore(bot, goal, id, { now = Date.now(), waiting = false } = {}) {
  const q = bot?._answers?.[id];
  if (!q?.last) return null;
  if (!q.last.judged) {
    q.last.judged = true;
    const gap = now - q.last.at;
    // Another piece of work asking is another run of answers.
    if (gap > AT_ONCE_MS || q.last.goal !== goal || cameOf(q.last.mark, mark(bot), q.last.at)) q.streak = [];
    else q.streak = [...(q.streak || []), { choice: q.last.choice, gap, at: q.last.at, why: whyItEnded(bot, goal, q.last.at) }].slice(-8);
  }
  const streak = q.streak || [];
  if (!streak.length) return null;
  return { streak, says: quickSays(streak, now), hold: !waiting && streak.length >= QUICK_HOLD };
}
function quickSays(streak, now) {
  const counts = {};
  for (const s of streak) counts[s.choice] = (counts[s.choice] || 0) + 1;
  const answers = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c.replaceAll('_', ' ')} ${plural(n, 'time')}`).join(', ');
  const slowest = Math.max(1, Math.ceil(Math.max(...streak.map(s => s.gap)) / 1000));
  const why = streak.map(s => s.why).filter(Boolean).at(-1);
  const first = streak.length === 1
    ? `the last answer, ${answers.replace(/ 1 time$/, '')}, came back within ${slowest === 1 ? 'a second' : `${slowest} seconds`} and nothing measurable came of it`
    : `the last ${streak.length} answers to this question in a row (${answers}, in the last ${span(now - streak[0].at)}) each came back within ${slowest === 1 ? 'a second' : `${slowest} seconds`} and nothing measurable came of any of them`;
  return `${first} (no new ground, nothing gained, no block dug or placed), whatever the facts said between${why ? `; the last ended: ${why}` : ''}`;
}

// After answering: the answer joins the run, or starts one.
function after(bot, id, print, choice, { now = Date.now(), goal = null } = {}) {
  if (!bot || !choice) return;
  const answers = bot._answers ||= {};
  const q = answers[id] ||= { streak: [] };
  q.last = { choice, at: now, mark: mark(bot), judged: false, goal };
  const memo = bot._repeats ||= {};
  const run = memo[id];
  if (run && run.print === print && run.choice === choice && run.counted) Object.assign(run, { times: run.times + 1, at: now, mark: mark(bot), counted: false });
  else memo[id] = { print, choice, times: 1, first: now, at: now, mark: mark(bot), gaps: [], counted: false };
}

// A run held as failed is said, for two minutes, in every question about
// the game that follows (the detour's too).
const SAID_MS = 2 * 60000;
function held(bot, id, text, now = Date.now()) {
  if (!bot) return;
  const list = (bot._cameToNothing || []).filter(h => now - h.at < SAID_MS && h.id !== id);
  bot._cameToNothing = [...list, { id, says: text, at: now }];
  if (bot._repeats) delete bot._repeats[id];
  if (bot._answers) delete bot._answers[id];
}
function heldSays(bot, now = Date.now()) {
  const list = (bot?._cameToNothing || []).filter(h => now - h.at < SAID_MS);
  return list.length ? list.map(h => `${h.id.replaceAll('_', ' ')}: ${h.says}`) : null;
}

module.exports = { fingerprint, mark, cameOf, before, quickBefore, after, held, heldSays, says, quickSays, AT_ONCE_MS, HOLD_AFTER, QUICK_HOLD, GROUND };

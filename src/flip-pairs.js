'use strict';
// Two steps that trade the turn rest together (note 699).
//
// Five of 44 trials since 20:00Z on 2026-09-29 ended as loops, all flip
// pairs: mine and tunnel at one diamond ore, enter nether and cast portal at
// a frame with no lava carried, mine and the stall's detour, tunnel and
// stalk mob, hunt mob and stalk mob boxed in beside a blaze. The stall watch
// saw a flip (stillness.js flipWatch, four trades in 45 seconds) and asked
// the stall's question, with the flip only in the ledger's list; only the
// step in hand was set aside, and the answer (another way eight blocks off,
// a night mine, work free) led back into the same two steps: of 119 flips
// raised since 18:00Z, 29 were the same pair again within ten minutes and
// sixteen blocks.
//
// Here a pair that traded with nothing gained on the rung's measure
// (rung-measure.js) is kept by place, with its trades counted over ten
// minutes, and rests together from where it traded: the two trading again
// there during the rest is raised at the first trade, not the fourth, and the
// question above (the rung's) is told the pair, the count, what did not
// change and the rest, with keeping at it from here not offered while it
// rests.
const REST_MS = 5 * 60000;        // the pair rests together this long from where it traded
const MEMORY_MS = 10 * 60000;     // trades of one pair here are counted over this
const NEAR = 16;                  // "here": within this of where the pair traded
const REACH = 5;                  // the rest holds within this of where it traded (the flip's own reach)

const words = s => String(s || '').replaceAll('_', ' ');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const P = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) } : null;
const home = goal => goal?.survival || goal || {};
const keyOf = names => [...names].map(String).sort().join('|');
const ago = ms => { const s = Math.max(1, Math.round(ms / 1000)); return s < 90 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.round(s / 60)} minutes`; };
const nth = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
// Steps that are an answer to a stall, not the work: resting them would
// rest the stall's own answers. A pair with one of them rests its other side.
const ANSWERS = new Set(['detour', 'persist', 'shake_loose', 'work_free']);
// The questions a raise goes to.
const ASKED = new Set(['rung_progress', 'stillness_detour']);

function list(goal, now = Date.now()) {
  const h = home(goal);
  h.flipPairs = (h.flipPairs || []).filter(e => now - e.at < MEMORY_MS || e.until > now);
  return h.flipPairs;
}

// A flip raised: counted with the same pair's earlier trades here.
// -> the pair's entry { pair, trades, times, first, at, until, where, rungSays, lastAnswer }
function note(goal, { names, trades, seconds, where, rungSays = null, now = Date.now() }) {
  const key = keyOf(names), here = P(where);
  const all = list(goal, now);
  let e = all.find(x => x.key === key && here && x.where && dist(x.where, here) <= NEAR);
  if (!e) { e = { key, pair: key.split('|'), trades: 0, times: 0, first: now, where: here }; all.push(e); }
  // The answer given to the question the last raise went to (the ledger
  // has it): it led back into the two.
  else {
    const since = e.at;
    const given = (goal?.tried?.entries || []).filter(x => ASKED.has(x.q) && x.at >= since && x.at <= now).at(-1);
    e.lastAnswer = given ? { q: given.q, answer: given.method, at: given.at } : null;
  }
  e.trades += trades; e.times += 1; e.at = now; e.until = now + REST_MS; e.seconds = seconds; e.lastTrades = trades;
  if (here) e.where = here;
  e.rungSays = rungSays || null;
  return e;
}
// The pair `names` resting together at `where` now, or null.
// A pair with one of the stall's own answers in it is said, not held: its
// other side is the work, and the stall's question is how it goes on.
function resting(goal, names, where, now = Date.now()) {
  const key = keyOf(names), here = P(where);
  if ([...names].some(n => ANSWERS.has(n))) return null;
  return list(goal, now).find(e => e.key === key && e.until > now && here && e.where && dist(e.where, here) <= REACH) || null;
}
// Any pair with `name` in it resting at `where`, the stall's own answers
// aside.
function restingWith(goal, name, where, now = Date.now()) {
  const here = P(where);
  if (!name || ANSWERS.has(name)) return null;
  return list(goal, now).find(e => e.pair.includes(name) && e.until > now && here && e.where && dist(e.where, here) <= REACH) || null;
}

// As the question's facts say it.
function says(e, now = Date.now(), { again = false } = {}) {
  if (!e) return null;
  const [a, b] = e.pair.map(words);
  const at = e.where ? ` at (${e.where.x}, ${e.where.y}, ${e.where.z})` : '';
  const head = again
    ? `the ${a} and the ${b} traded the turn again${at} while they rested together`
    : `the ${a} and the ${b} traded the turn ${e.lastTrades ?? e.trades} times in ${e.seconds ?? '?'} seconds${at}`;
  const count = e.times > 1 ? `; the ${nth(e.times)} time the two have traded here in ${ago(now - e.first)}, ${e.trades} trades in all` : '';
  const last = e.lastAnswer && e.times > 1 ? `; the last answer here, ${words(e.lastAnswer.answer)} (${words(e.lastAnswer.q)}), led back into them ${ago(e.at - e.lastAnswer.at)} later` : '';
  const mins = Math.max(1, Math.ceil((e.until - now) / 60000));
  const held = !e.pair.some(n => ANSWERS.has(n));
  const rest = e.until <= now ? '' : held
    ? `. They rest together from here ${mins} more minute${mins === 1 ? '' : 's'}: the two trading again within ${REACH} blocks of here comes back to this question at the first trade`
    : `. One of the two is an answer to the stall itself, so the pair is said, not held`;
  return `${head}, ${e.rungSays || 'nothing gained on the rung'}${count}${last}${rest}.`;
}
// The pair in words, "mine and tunnel".
const pairSays = e => e ? e.pair.map(words).join(' and ') : '';

module.exports = { note, resting, restingWith, says, pairSays, list, REST_MS, MEMORY_MS, NEAR, REACH, ANSWERS };

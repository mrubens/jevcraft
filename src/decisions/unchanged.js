'use strict';
// An answer that changed nothing is not asked for again at once (note 724).
//
// Fable's check-in of 04:58Z on 2026-09-30, problem 2: survival_priority
// answered secure_shelter 38 times in 7 seconds on 25594 and about 45 times
// in 8 seconds on 25585, both already sealed; 25588 answered unstuck_move
// pillar 9 times at once; 25590 crossing_kit cross_now 19 times in ten
// minutes. Each answer ended with nothing different and the same question
// was asked again, and the repeat rule (repeats.js) said so only after about
// forty asks. Notes 659 to 719 patched this question by question.
//
// The one rule, for every question about playing the game:
//   - when an answer is given, what the bot is then is kept with it: the
//     block it stands in, what it carries (every item's count), the blocks
//     dug or placed so far (stillness.js markCell), the health band, and the
//     question's own facts (repeats.situation, clocks and counts aside);
//   - when the same question comes back and none of the first four has
//     changed, that answer changed nothing. The next asking says so, in the
//     facts (answerChangedNothing) and on the option: "X was chosen N
//     seconds ago and changed nothing";
//   - and if the question's facts are the same too (note 749: the options
//     offered and the kinds of mob that threaten; digest below), it is not asked again
//     yet: the bot holds, its reflexes still watching (the task's check, the
//     air, the caller's interrupt), until the block, the carried things, the
//     blocks or the health band change, or a short wait passes (HOLD_MS:
//     ten seconds after the answer, thirty after two in a row, a minute
//     after three), said in the words above;
//   - an option whose own goal the state already satisfies (a node with
//     `satisfied`: why, set by its builder) is not offered, and that is said
//     as a fact (alreadySo), as a wait that cannot come is (waits.js).
// Not held, only said: the body's own questions (body_way, shot_answer), the
// stance against mobs about, and the routing and stall questions, whose
// answers come at every turn of an emergency (index.js NEVER_HELD, SAY_ONLY).

const HOLD_MS = [10000, 30000, 60000];
// The tests' clock (test/support/jev-stand-in.js), as jev-down.js's backoff.
const setHold = ms => { HOLD_MS.splice(0, HOLD_MS.length, ...ms); };
// Said, never held: the body's physics (SAFETY_RULED), the stance and the
// shield against mobs about (SAY_ONLY), the routing and the stall's own
// question (NEVER_HELD), all in index.js.
// And the dragon fight: what its answers wait on is the dragon's flight,
// which is no part of the bot's mark. The rehearsal of 2026-10-03 (23:31:35
// to 23:32:05Z) stood thirty seconds held after a shot that did not loose,
// the dragon circling in range (note 1136).
const NOT_HELD = new Set(['body_way', 'shot_answer', 'encounter_stance', 'ranged_response', 'turn_priority', 'stillness_detour', 'dragon_fight']);
const KEPT_MS = 10 * 60000;
const LOOK_MS = 250;

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const words = s => String(s || '').replaceAll('_', ' ').replaceAll('/', ' / ');
const secs = ms => plural(Math.max(1, Math.round(ms / 1000)), 'second');

// Health in bands of four, full on its own: a scratch is not a change, a
// heart or two is.
const band = h => !Number.isFinite(h) ? null : h >= 20 ? 5 : Math.floor(Math.max(0, h) / 4);
function markOf(bot) {
  const p = bot?.entity?.position;
  const inv = {};
  try { for (const i of bot?.inventory?.items?.() || []) inv[i.name] = (inv[i.name] || 0) + i.count; } catch (_) { /* no inventory */ }
  return { p: p && Number.isFinite(p.x) ? { x: p.x, y: p.y, z: p.z } : null, inv, blocks: bot?._stalls?.marked || 0, band: band(bot?.health), health: Number.isFinite(bot?.health) ? bot.health : null };
}
// What changed between two marks, in words, or null for nothing.
function changed(a, b) {
  if (!a || !b) return 'nothing to compare';
  if (a.p && b.p) {
    const d = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z);
    if (d >= 1) return `moved ${d < 1.5 ? 'a block' : plural(Math.round(d), 'block')}`;
  }
  const names = new Set([...Object.keys(a.inv || {}), ...Object.keys(b.inv || {})]);
  const diff = [...names].map(n => [n, (b.inv?.[n] || 0) - (a.inv?.[n] || 0)]).filter(([, d]) => d);
  if (diff.length) return `what is carried changed (${diff.slice(0, 4).map(([n, d]) => `${d > 0 ? '+' : ''}${d} ${words(n)}`).join(', ')}${diff.length > 4 ? ', ...' : ''})`;
  if ((a.blocks || 0) !== (b.blocks || 0)) return 'a block was dug or placed';
  if (a.band !== b.band) return `health went from ${Math.round(a.health)} to ${Math.round(b.health)}`;
  return null;
}

const holdFor = run => HOLD_MS[Math.min(Math.max(run, 1), HOLD_MS.length) - 1];

// The question's own facts, as the answer could have changed them (note
// 749): the options offered, by their keys, and the mobs that threaten, by
// kind. Before note 749 it was the whole state less the record of the
// answers (RECORD below) and its clocks and counts (repeats.fingerprint);
// the state drifts between two askings with nothing the answer could touch
// changed (riskNow's count of mobs within 24, the healing line, a stall's
// strikes, a fortress's passes), and the hold was missed. Read from the
// flight records of 2026-09-30 from 06:00Z: of 1,276 askings whose last
// answer changed nothing (same block, same things carried, same health
// band), 1,127 had facts that differed, 226 of them with the same options.
// What the answer was meant to change is the mark (markOf: the block, what
// is carried, blocks dug or placed, the health band) and the options on
// offer (a key names its thing, define's `names`, so an option for a new
// thing is a new key); a mob coming or going is the one change in the world
// the survival layer's own reflexes may be waiting on it to say, so the kinds
// that threaten count too, their distances and counts not.
const RECORD = /^(last[A-Z]\w*|recent\w*|\w*(SoFar|Resting|JustNow|Tried|AtOnce|Ago)|tried|strikes|failed|failures|notOffered\w*|notNow|underWay|leastBad\w*|planAnswers\w*|reversal|previous\w*|waysResting|whatFailedBelow|answerChangedNothing|sameAnswerAgain|answersThatCameToNothing|sameSceneSoFar|situation|legsClosed|waysLeft|workedOnRung|stretch)$/;
const THREAT_KEY = /^(threats?\w*|\w*Threats?|hostiles?\w*|\w*Hostiles?|mobs|shooters|kinds)$/;
const MOB_NAME = s => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/[^a-z ].*$/, '').trim();
function threatKinds(state) {
  const kinds = new Set(), seen = new WeakSet();
  const take = v => {
    if (typeof v === 'string') { const n = MOB_NAME(v); if (n) kinds.add(n); return; }
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach(take); return; }
    if (typeof v.name === 'string') kinds.add(MOB_NAME(v.name));
    if (Array.isArray(v.kinds)) v.kinds.forEach(take);
  };
  const visit = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 4 || seen.has(v)) return;
    for (const [k, x] of Object.entries(v)) { if (RECORD.test(k)) continue; if (THREAT_KEY.test(k)) take(x); else if (x && typeof x === 'object' && !Array.isArray(x)) visit(x, depth + 1); }
  };
  visit(state && typeof state === 'object' ? state : {}, 0);
  return [...kinds].filter(Boolean).sort();
}
function digest(state, tree) {
  const keys = [];
  const visit = (children, pre) => { for (const [k, n] of Object.entries(children || {})) { if (k === 'none_good') continue; if (n?.children) visit(n.children, [...pre, k]); else keys.push([...pre, k].join('/')); } };
  visit(tree, []);
  return `${keys.sort().join(',')}|${threatKinds(state).join(',')}`;
}

// Before asking `id`: its last answer, if nothing has changed since.
// -> null or { choice, run, sameFacts, holdMs (left to hold), says(heldMs, why) }
function before(bot, id, digest, { now = Date.now() } = {}) {
  const memo = bot?._unchanged;
  const m = memo?.[id];
  if (!m) return null;
  if (now - m.at > KEPT_MS) { delete memo[id]; return null; }
  if (changed(m.mark, markOf(bot))) { delete memo[id]; return null; }
  const run = m.run + 1;
  const sameFacts = m.digest != null && m.digest === digest;
  const holdMs = sameFacts ? Math.max(0, holdFor(run) - (now - m.at)) : 0;
  return { choice: m.choice, run, sameFacts, at: m.at, holdMs, mark: m.mark };
}
// The words, once the hold (if any) is over: on the option and in the facts.
function says(last, { heldMs = 0, ended = null, now = Date.now() } = {}) {
  const what = `${words(last.choice)} was chosen ${secs(now - last.at)} ago and changed nothing (the bot on the same block, carrying the same, no block dug or placed, health as it was)`;
  const runs = last.run > 1 ? `; the last ${last.run} answers to this question in a row changed nothing` : '';
  const held = heldMs > 0 ? `; this question was held ${secs(heldMs)} for something to change${ended ? `, and ${ended}` : ''}` : '';
  return { facts: `${what}${runs}${held}.`, option: `Chosen ${secs(now - last.at)} ago, and it changed nothing${last.run > 1 ? ` (${plural(last.run, 'answer')} in a row to this question changed nothing)` : ''}.` };
}

// Held: until the mark changes, the check throws (a reflex, the air, the
// task stopped), or the time is up. -> { heldMs, ended }
async function hold(bot, last, ms, { check = () => {}, sleep = t => new Promise(r => setTimeout(r, t)) } = {}) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    await sleep(Math.min(LOOK_MS, ms - (Date.now() - start)));
    check();
    const c = changed(last.mark, markOf(bot));
    if (c) return { heldMs: Date.now() - start, ended: `then ${c}`, changed: c };
  }
  return { heldMs: Date.now() - start, ended: 'nothing changed meanwhile' };
}

// After an answer Jev gave: kept with the bot as it is now. `run` is the
// number of answers in a row before this one that changed nothing.
function after(bot, id, { choice, digest, run = 0, now = Date.now() } = {}) {
  if (!bot || !choice) return;
  (bot._unchanged ||= {})[id] = { choice, at: now, mark: markOf(bot), digest, run };
}

// Options whose goal is already so: left out and said, unless every option
// is (then each says it on itself). -> { tree, facts }
function satisfiedGate(tree) {
  const facts = [], out = {};
  for (const [key, node] of Object.entries(tree || {})) {
    if (node?.satisfied) { facts.push(`${words(key)}: not offered, already so: ${String(node.satisfied).replace(/\.$/, '')}.`); continue; }
    out[key] = node;
  }
  if (!facts.length) return { tree, facts };
  if (!Object.keys(out).length) return { tree: Object.fromEntries(Object.entries(tree).map(([k, n]) => [k, { ...n, description: typeof n.description === 'string' ? `${n.description} Already so: ${n.satisfied}` : n.description }])), facts: [] };
  return { tree: out, facts };
}

// The rule over recorded asks (scripts/unchanged-asks.js): each ask
// { t, id, choice, mark, digest } in order; the asks the rule would have
// held (not sent) are returned. An ask held is replaced by the one that
// comes after the hold ends, at the first ask at or after its end or after
// a change.
function replay(asks) {
  const memo = {}, held = [];
  for (const a of asks) {
    if (NOT_HELD.has(a.id)) continue;
    const m = memo[a.id];
    let run = 0;
    if (m && a.t - m.at <= KEPT_MS && !changed(m.mark, a.mark)) {
      run = m.run + 1;
      if (m.digest != null && m.digest === a.digest && a.t - m.at < holdFor(run)) { held.push(a); continue; }
    }
    memo[a.id] = { at: a.t, mark: a.mark, digest: a.digest, run };
  }
  return held;
}

module.exports = { HOLD_MS, setHold, KEPT_MS, NOT_HELD, RECORD, band, digest, threatKinds, markOf, changed, holdFor, before, says, hold, after, satisfiedGate, replay };

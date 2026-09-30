'use strict';
// Every answer's run is checked for what it changed (note 765).
//
// The reviewer's check-in of 20:11Z on 2026-09-30, problem 2: "Chosen
// options that change nothing are not recorded failed." 25590 chose
// climb_out's wood_first four times from about the same place under seven
// blocks of sand (20:04 to 20:19Z); each run returned in 0.2 seconds, the
// ledger said it once "toward the same place" and forgot it when the exit
// it aimed at moved six blocks, and it was put first again three minutes
// later. The standing retreat (752h), the seal pass (755b) and the idle
// night mine (755c) were the same thing, each fixed on its own.
//
// Here, for every answer given to a question about playing the game (asked,
// the one way taken, or held by its commitment), what the bot is when it is
// given is kept: where it stands, what it carries (every item's count), the
// blocks dug or placed (stillness.js markCell), its health and hunger, its
// dimension, and how far it is from the answer's target. The answer changed
// something once the bot has moved a block, what it carries has changed, a
// block has been dug or placed, health or hunger has come up, or it is in
// another dimension. Health falling is not something the answer did.
//
// Judged when its question is asked again (the run has come back, whatever
// the time), or once its own stated time has passed (the option's "about N
// seconds", its `seconds`, a stance's `expects`), FLOOR_MS at least, at the
// next question asked of any loop (sweep), whichever comes first. The floor
// is the records' (scripts/zero-delta.js over 114.7 bot-hours since 12:00Z
// on 2026-09-30): judged at 3 seconds, 3,090 answers still under way had
// changed nothing, and 2,969 of them changed something within the next 30
// seconds (a walk's path being found, a stair begun); at 30 seconds 130 and
// 87; at 90 seconds 17 and 4. A run that comes back is judged at once.
// Having changed nothing, the answer failed:
//   - its ledger entry (tried.js) is blocked with what did not change, and
//     marked `noop`: while the bot is within `sameStall` blocks of where it
//     was chosen (16; a question may say less: a move is its cell) and
//     carries no kind of thing it did not then, up to NOOP_MS, it is said on
//     its option and listed last, not first; a second such from the same
//     stall rests it (left out while another way is open, the ledger's
//     REST_AFTER);
//   - its commitment (commit.js) ends: "it changed nothing";
//   - the next asking of its question says it (answerChangedNothing:
//     "wood first was chosen 10 seconds ago and changed nothing: ...").
// Not judged: a wait meant to change nothing, which says so where it is
// declared (the option catalogue's `wait: true`, index.js WAIT_ANSWERS, a
// keep-on answer, intention.js KEEP, or a node's own `changesNothing`), an
// entry the ledger judges as a wait by its world (tried.js, note 599), and a
// run cut short by the survival layer.

const FLOOR_MS = 90000;
const CAP_MS = 10 * 60000;
const NOOP_NEAR = 16;
const NOOP_MS = 10 * 60000;
const SAID_MS = 2 * 60000;

const P = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? { x: v.x, y: v.y, z: v.z } : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const words = s => String(s || '').replaceAll('_', ' ').replaceAll('/', ' / ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const secs = ms => ms <= 90000 ? plural(Math.max(1, Math.round(ms / 1000)), 'second') : plural(Math.round(ms / 60000), 'minute');
const norm = d => String(d || '').replace(/^minecraft:/, '') || null;
const off = () => process.env.JEV_OUTCOME === '0';

// The option's own stated time, in ms: its `seconds`, a stance's price
// (`expects.seconds`), else its words: the figure said "in all", or the
// first "about N seconds/minutes". FLOOR_MS at least, CAP_MS at most; the
// floor where nothing is stated.
const TIME = /(\d+(?:\.\d+)?)\s*(second|minute)s?/;
function statedMs(node) {
  const n = Number.isFinite(node?.seconds) ? node.seconds : Number.isFinite(node?.expects?.seconds) ? node.expects.seconds : null;
  let ms = n != null ? n * 1000 : null;
  if (ms == null) {
    const d = typeof node?.description === 'string' ? node.description : '';
    const all = d.match(/about (\d+(?:\.\d+)?)\s*(second|minute)s? in all/) || d.match(new RegExp(`${TIME.source} in all`));
    const first = all || d.match(new RegExp(`about ${TIME.source}`));
    if (first) ms = Number(first[1]) * (first[2] === 'minute' ? 60000 : 1000);
  }
  return Math.min(CAP_MS, Math.max(FLOOR_MS, Number.isFinite(ms) ? ms : 0));
}

// The bot as the check reads it. Without an inventory to read nothing is
// judged (a mark that cannot tell what is carried is no mark).
function markOf(bot, target = null) {
  const p = P(bot?.entity?.position);
  if (!p || typeof bot?.inventory?.items !== 'function') return null;
  const inv = {};
  try { for (const i of bot.inventory.items() || []) inv[i.name] = (inv[i.name] || 0) + i.count; } catch (_) { return null; }
  const t = P(target);
  return { p, inv, blocks: bot?._stalls?.marked || 0, health: Number.isFinite(bot?.health) ? bot.health : null, food: Number.isFinite(bot?.food) ? bot.food : null,
    dimension: norm(bot?.game?.dimension), ...(t ? { target: t, targetD: dist(p, t) } : {}) };
}
// The same from a flight record's snapshot (scripts/zero-delta.js): no
// count of blocks dug or placed there, so digs and placings are read from
// what is carried alone.
function markOfSnapshot(s, target = null) {
  const p = P(s?.position);
  if (!p) return null;
  const t = P(target);
  return { p, inv: s?.inventory ? { ...s.inventory } : null, blocks: null, health: Number.isFinite(s?.health) ? s.health : null, food: Number.isFinite(s?.food) ? s.food : null,
    dimension: norm(s?.dimension), ...(t ? { target: t, targetD: dist(p, t) } : {}) };
}

// What the answer changed between two marks, in words, or null for
// nothing. `b.inv` null (a frame without the inventory) reads as unchanged.
function effect(a, b) {
  if (!a || !b) return null;
  if (a.dimension && b.dimension && a.dimension !== b.dimension) return `went to the ${words(b.dimension).replace(/^the /, '')}`;
  if (a.p && b.p) {
    const d = dist(a.p, b.p);
    if (d >= 1) return `moved ${d < 1.5 ? 'a block' : plural(Math.round(d), 'block')}${a.target && Number.isFinite(a.targetD) ? `, ${Math.round(dist(b.p, a.target))} blocks from its target (${Math.round(a.targetD)} when chosen)` : ''}`;
  }
  if (a.inv && b.inv) {
    const names = new Set([...Object.keys(a.inv), ...Object.keys(b.inv)]);
    const diff = [...names].map(n => [n, (b.inv[n] || 0) - (a.inv[n] || 0)]).filter(([, d]) => d);
    if (diff.length) return `what is carried changed (${diff.slice(0, 4).map(([n, d]) => `${d > 0 ? '+' : ''}${d} ${words(n)}`).join(', ')}${diff.length > 4 ? ', ...' : ''})`;
  }
  if (Number.isFinite(a.blocks) && Number.isFinite(b.blocks) && a.blocks !== b.blocks) return 'a block was dug or placed';
  if (Number.isFinite(a.health) && Number.isFinite(b.health) && b.health - a.health >= 1) return `health came up from ${Math.round(a.health)} to ${Math.round(b.health)}`;
  if (Number.isFinite(a.food) && Number.isFinite(b.food) && b.food - a.food >= 1) return `hunger came up from ${a.food} to ${b.food}`;
  return null;
}
// What stayed the same, in words: said as the failure.
function nothingSays(a, b) {
  const hurt = Number.isFinite(a?.health) && Number.isFinite(b?.health) && a.health - b.health >= 1 ? `, health fell from ${Math.round(a.health)} to ${Math.round(b.health)}` : '';
  const target = a?.target && Number.isFinite(a.targetD) ? `, still ${Math.round(a.targetD)} blocks from its target` : '';
  return `the bot on the same block, carrying the same, no block dug or placed${target}${hurt}`;
}

// A wait meant to change nothing, declared: why, or null.
function waitWhy(spec, key, node) {
  const leaf = String(key || '').split('/').at(-1);
  if (node?.changesNothing) return String(node.changesNothing);
  if (spec?.options?.some(o => o.wait && (o.key === leaf || (o.pattern && new RegExp(`^(?:${o.pattern})$`).test(leaf))))) return 'a wait, declared in its catalogue';
  let WAIT_ANSWERS = null, KEEP = null;
  try { WAIT_ANSWERS = require('./index').WAIT_ANSWERS; } catch (_) { /* loading */ }
  try { KEEP = require('../intention').KEEP; } catch (_) { /* loading */ }
  if (WAIT_ANSWERS?.has(leaf)) return 'a wait by what it is';
  if (KEEP?.test(leaf)) return 'keeps on with what is under way';
  return null;
}

// After an answer (asked, the one way, or held): kept on the bot. A held
// answer (its commitment carrying it on) keeps the mark of the answer it
// carries on, so its time runs from when it was first chosen.
function begin(bot, goal, spec, path, node, { target = null, held = false, now = Date.now() } = {}) {
  if (off() || !bot || !spec || !path?.length) return null;
  const memo = bot._outcome ||= {};
  const key = path.join('/');
  const was = memo[spec.id];
  if (held && was && was.key === key) return was;
  const mark = markOf(bot, node?.target || target);
  if (!mark) { delete memo[spec.id]; return null; }
  memo[spec.id] = { q: spec.id, key, at: now, mark, ms: statedMs(node), wait: waitWhy(spec, key, node), sameStall: Number.isFinite(spec.sameStall) ? spec.sameStall : NOOP_NEAR };
  return memo[spec.id];
}

// The ledger's entry the answer is being carried out under: the latest of
// its question and answer since it was given, pending or blocked.
function entryOf(goal, o) {
  const list = goal?.tried?.entries || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.q !== o.q) continue;
    if (e.at < o.at - 1000) return null;
    if (e.method === o.key && ['pending', 'blocked'].includes(e.outcome) && !e.held) return e;
  }
  return null;
}

// Judge one kept answer now. `asked`: its question is being asked again
// (the run came back), judged whatever the time; else only once its stated
// time has passed. -> null (not yet, or not judged), { changed } or { failed }
function judge(bot, goal, id, { asked = false, now = Date.now() } = {}) {
  const memo = bot?._outcome;
  const o = memo?.[id];
  if (!o) return null;
  if (!asked && now - o.at < o.ms) return null;
  delete memo[id];
  const here = markOf(bot);
  const changed = effect(o.mark, here);
  if (changed) return { changed };
  if (o.wait) return { waited: o.wait };
  // Cut short by the survival layer (tried.cut), or a wait the ledger
  // judges by its world (note 599): not this rule's.
  const e = entryOf(goal, o);
  if (e && (e.cut || e.waiting)) return { cut: e.cut || 'a wait, judged by its world' };
  const took = now - o.at;
  const within = took <= o.ms ? `within ${secs(took)} (its own time ${secs(o.ms)})` : `in its own time, ${secs(o.ms)}`;
  const nothing = nothingSays(o.mark, here);
  let why = null;
  try { why = require('./repeats').whyItEnded(bot, goal, o.at); } catch (_) { why = null; }
  const says = `${words(o.key)} was chosen ${secs(took)} ago and changed nothing ${within}: ${nothing}${why ? `; it ended: ${String(why).replace(/\.$/, '')}` : ''}`;
  const f = { q: id, key: o.key, at: o.at, judgedAt: now, says, place: o.mark.p, dimension: o.mark.dimension, kinds: Object.keys(o.mark.inv || {}), sameStall: o.sameStall };
  if (e) {
    // The ledger's own judgment first (tried.js settle, its words kept): a
    // question under the rung judged by the rung's measure may have seen
    // what this does not (a new best), and then it is not a no-op.
    const tried = require('../tried');
    if (e.outcome === 'pending') tried.settle(bot, goal, { q: id, now });
    if (e.outcome !== 'blocked') return { settled: e.outcome, gained: e.gained || null };
    const own = `its run changed nothing ${within}: ${nothing}`;
    e.why = (e.why && !/its run changed nothing/.test(e.why) ? `${String(e.why).replace(/\.$/, '')}; ${own}` : own).slice(0, 300);
    Object.assign(e, { until: now + NOOP_MS, noop: { near: o.sameStall, until: now + NOOP_MS, kinds: f.kinds, ...(o.mark.dimension ? { dimension: o.mark.dimension } : {}) } });
    if (!e.place && o.mark.p) e.place = { x: o.mark.p.x, y: o.mark.p.y, z: o.mark.p.z };
  }
  try { require('./commit').end(bot, id, `it changed nothing ${within}`); } catch (_) { /* no commitment */ }
  (bot._outcomeSaid ||= {})[id] = f;
  console.log(`[changed nothing] ${id}: ${says}${e ? '; recorded failed' : ''}`);
  return { failed: f };
}
// At each question asked: every kept answer whose own time has passed.
function sweep(bot, goal, { now = Date.now(), except = null } = {}) {
  const out = [];
  for (const id of Object.keys(bot?._outcome || {})) if (id !== except) { const j = judge(bot, goal, id, { now }); if (j?.failed) out.push(j.failed); }
  return out;
}
// Said at the next asking of its question, once: -> { says, recorded } or
// null (`recorded`: the failure's consequence alone, for beside other words).
function says(bot, id, { now = Date.now() } = {}) {
  const f = bot?._outcomeSaid?.[id];
  if (!f) return null;
  delete bot._outcomeSaid[id];
  if (now - f.judgedAt > SAID_MS) return null;
  const recorded = `recorded as failed: listed last from here while the bot is within ${plural(f.sameStall, 'block')} of where it was chosen and carries nothing new (up to ${secs(NOOP_MS)}), and not offered there once it has changed nothing twice.`;
  return { says: `${f.says}; ${recorded}`, recorded };
}

// Whether a ledger entry's no-op rest holds now, for the bot `here`
// carrying `kinds`.
function noopHolds(e, { here, kinds = null, dimension = null, now = Date.now() } = {}) {
  const n = e?.noop;
  if (!n || !(n.until > now) || !e.place || !here) return false;
  if (n.dimension && dimension && n.dimension !== dimension) return false;
  if (dist(e.place, here) > (n.near ?? NOOP_NEAR)) return false;
  if (kinds && n.kinds && kinds.some(k => !n.kinds.includes(k))) return false;
  return true;
}

// Over recorded answers (scripts/zero-delta.js): the rule walked in order.
// Each answer { t, id, key, place, kinds, dimension, failed, exempt,
// sameStall, sayOnly } in time order; -> { said, kept }: the answers given
// with a no-op of theirs from the same stall said on them (listed last), and
// those the rest would have kept off offer (two no-ops from the same stall;
// never a say-only question's).
function replay(answers) {
  const noops = [], kept = [], said = [];
  for (const a of answers) {
    const before = noops.filter(r => r.id === a.id && r.key === a.key && noopHolds({ place: r.place, noop: { near: r.sameStall, until: r.until, kinds: r.kinds, dimension: r.dimension } }, { here: a.place, kinds: a.kinds, dimension: a.dimension, now: a.t }));
    if (before.length >= 2 && !a.sayOnly) { kept.push({ ...a, restedBy: before }); continue; }
    if (before.length) said.push({ ...a, saidOf: before });
    if (a.failed && !a.exempt) noops.push({ id: a.id, key: a.key, place: a.place, kinds: a.kinds, dimension: a.dimension, sameStall: a.sameStall ?? NOOP_NEAR, until: a.t + NOOP_MS });
  }
  return { said, kept };
}

module.exports = { FLOOR_MS, CAP_MS, NOOP_NEAR, NOOP_MS, statedMs, markOf, markOfSnapshot, effect, nothingSays, waitWhy, begin, judge, sweep, says, noopHolds, entryOf, replay };

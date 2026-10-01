'use strict';
// A place or a target that keeps failing, whatever asked for it (note 777).
//
// The ledger (tried.js) reads an option's failures by its own question and
// answer: the same key toward the same target, or the same key from about
// here. A walk to the same spot under another question or another key, and a
// run of walks from one spot to targets each new, read as untried. From
// 2026-10-01 00:41Z to 02:50Z, 366 of 1,165 navigation stalls came at a spot
// stalled at twice before, 329 of them on a walk to the same goal as one of
// those; and 25592 (mid-220-ac, 02:51-02:54Z) asked night_mine_target 13
// times in three minutes from within a few blocks, ore after ore, nearly
// every walk there ending in no route or a stall within seconds.
//
// Two facts, read from the ledger's failed ways (no route, a stalled or
// timed-out walk, no safe step, no nearer) and the walks' own stall memory
// (skills.js stallsToward):
//   toward  a target that the ways to, tried from within sixteen blocks of
//           here, have failed twice in the last ten minutes, whatever
//           question or answer they were (from farther off it is another
//           way there);
//   here    a spot from which ways to two or more other targets have failed
//           in the last ten minutes: the place, not the target, may be what
//           fails.
// Each is said on every option that goes there, and an option it is said on
// rests as one that failed twice does (REST_MS from the last), left out while
// another way is open and escalating to the question above when none is.
//
// Every walk's end, once (note 785). The two facts above read only what
// reached the ledger (a step's failure, an option's) and the stall memory,
// so a walk that failed inside a step that went on, a pathfinder's search
// that ran out of time ("Took to long to decide path to goal!", no stall
// and no no-route), and a survey that found no way were no fact anywhere:
// 25589's night mine re-picked ore_0 after a stall, 25593's lava 27 blocks
// off at its own height failed on the search's time and nothing ever came
// at it another way, and 25595 stalled seven times in two minutes at one
// spot with no question asked. Now every walk (skills.js navigate) is
// recorded when it ends with its kind (arrived, no route, search timeout,
// stall, timed out, ended short, no nearer, interrupted), where it began,
// where it was going and the blocks walked (noteWalk, bot._walks, and the
// flight record's walk_end frame), and both facts read those walks:
//   once    a single failed way toward the target from about here is said
//           on the option going there, with its kind and how far it got,
//           and where the failure was the route itself (no route, the
//           search out of time, a stall, ended short) what coming at it
//           straight at this height costs instead (bridging.js
//           surveyCrossing, the cells, the rock, the seconds); not rested;
//   pacing  walks begun from about here that keep failing with no question
//           answered between (three, or two to the same goal) are not
//           walked again: the walk is refused with the facts (WalksFailing,
//           a stall to its callers), which ends the step, and the next
//           question is asked with them. This takes the place of note
//           777's third-walk ban (two stalls toward one goal, refused
//           whatever was asked between): what Jev chooses knowing the
//           failures is walked.
const WINDOW_MS = 10 * 60000;
const TARGET_NEAR = 4;   // the same target
const HERE = 4;          // from about here
const FROM = 16;         // toward a target, from about here (tried.js TARGET_FROM)
const TIMES = 2;
const PACING = 3;        // failed walks from about here with no question between
const THREAT_NEAR = 8;   // a mob this near: the walk is the body's, never refused
const SAME_FAILURE_MS = 15000; // a stall and the ledger's failure of the walk it ended are one failure
const WALK_KEEP_MS = 15 * 60000, WALK_KEEP = 96;
const REACH = 4.5;       // at the goal already: no walk is wanted (note 777b)
const STRAIGHT_ACROSS = 64, STRAIGHT_RISE = 3, STRAIGHT_CELLS = 48;
const WAY_FAILED = /no route|no path|not gaining|navigation timed out|without moving|without getting closer|no nearer|no safe|stall|unreachable|out of reach|can't reach|cannot reach|can't get (at|to)|not walked a third time|took to long to decide path|ended before reaching|the walk is not begun/i;
// The kinds a walk ends with; all but arrived, interrupted and refused are
// a way that failed.
const KINDS = ['arrived', 'no_route', 'search_timeout', 'stall', 'timed_out', 'ended_short', 'no_nearer', 'interrupted', 'refused'];
const FAILED = new Set(['no_route', 'search_timeout', 'stall', 'timed_out', 'ended_short', 'no_nearer']);
// The route itself failed (not a walk cut short): coming at it another way
// is what is priced.
const ROUTE_FAILED = new Set(['no_route', 'search_timeout', 'stall', 'ended_short', 'timed_out']);
const KIND_SAYS = {
  stall: 'the walk stalled', search_timeout: "the pathfinder's search for a route ran out of time", no_route: 'no route',
  timed_out: 'the walk ran out of its time', ended_short: 'the walk ended short of it', no_nearer: 'came no nearer', no_safe: 'no safe step', failed: 'it failed',
};

const P = v => v && Number.isFinite(v.x) && Number.isFinite(v.z) ? { x: v.x, y: Number.isFinite(v.y) ? v.y : null, z: v.z } : null;
const dist = (a, b) => Number.isFinite(a.y) && Number.isFinite(b.y) ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Math.hypot(a.x - b.x, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ago = ms => ms < 90000 ? plural(Math.max(1, Math.round(ms / 1000)), 'second') : plural(Math.round(ms / 60000), 'minute');
const at = p => `(${Math.floor(p.x)}, ${Number.isFinite(p.y) ? Math.floor(p.y) : '?'}, ${Math.floor(p.z)})`;
const dimOf = bot => String(bot?.game?.dimension || 'overworld').replace(/^minecraft:/, '');
const round1 = v => v && { x: Math.round(v.x * 10) / 10, y: Number.isFinite(v.y) ? Math.round(v.y * 10) / 10 : null, z: Math.round(v.z * 10) / 10 };

// A way that failed, from the ledger: blocked for a reason a way fails by.
const wayFailed = e => e?.outcome === 'blocked' && !e.wait && !e.held && (e.noNearer || WAY_FAILED.test(String(e.why || '')));
// The kind of a failure said in words (a ledger entry's why).
const kindOfWhy = why => /took to long to decide path/i.test(why) ? 'search_timeout' : /stall|navigation timed out without|without reaching new ground|not walked a third time|the walk is not begun/i.test(why) ? 'stall'
  : /no route|no path|unreachable|out of reach|can't reach|cannot reach|can't get (at|to)/i.test(why) ? 'no_route' : /navigation timed out/i.test(why) ? 'timed_out' : /ended before reaching/i.test(why) ? 'ended_short'
  : /no safe/i.test(why) ? 'no_safe' : /no nearer|not gaining|without getting closer|without moving/i.test(why) ? 'no_nearer' : 'failed';

// The kind a walk ended with, from what it threw (skills.js navigate).
function kindOf(err) {
  const name = err?.name, m = String(err?.message || err || '');
  if (name === 'WalksFailing') return 'refused';
  if (name === 'Timeout' || /Took to long to decide path/.test(m)) return 'search_timeout';
  if (name === 'NoRoute' || name === 'NoPath' || /^No route|No path to the goal/.test(m)) return 'no_route';
  if (name === 'NavigationCorrectionLoop' || /without reaching new ground/.test(m)) return 'stall';
  if (/navigation timed out/.test(m)) return 'timed_out';
  if (/ended before reaching/.test(m)) return 'ended_short';
  if (/no nearer|not gaining|without getting closer/i.test(m)) return 'no_nearer';
  return 'interrupted';
}

// A walk ended: recorded once on the bot, by dimension, and framed in the
// flight record (walk_end). -> the entry
function noteWalk(bot, { kind, goal = null, from = null, to = null, startedAt = null, at: when = Date.now(), blocks = null, why = null, walk = null } = {}) {
  if (!bot || !KINDS.includes(kind)) return null;
  const g = P(goal), f = P(from), t = P(to || bot.entity?.position);
  const entry = { kind, dim: dimOf(bot), at: when, ...(Number.isFinite(startedAt) ? { startedAt } : {}), ...(g ? { goal: round1(g) } : {}), ...(f ? { from: round1(f) } : {}), ...(t ? { to: round1(t) } : {}),
    ...(Number.isFinite(blocks) ? { blocks: Math.round(blocks * 10) / 10 } : {}), ...(g && t ? { left: Math.round(dist(g, t) * 10) / 10 } : {}), ...(g && f ? { began: Math.round(dist(g, f) * 10) / 10 } : {}),
    ...(why ? { why: String(why).slice(0, 160) } : {}), ...(walk != null ? { walk } : {}) };
  bot._walks = [...(bot._walks || []).filter(w => when - w.at < WALK_KEEP_MS), entry].slice(-WALK_KEEP);
  try { bot.emit?.('walk_end', entry); } catch (_) { /* the record only */ }
  return entry;
}

// The failed walks in this dimension in the window, newest last: the walks'
// own ends, and the stall memory's walks not among them (skills.js
// noteStallSpot: a stall written there by a walk that is not one of these).
// -> [{ at, kind, goal, from, to, blocks, left, why, walk }]
function failedWalks(bot, now = Date.now()) {
  const dim = dimOf(bot), out = [];
  for (const w of bot?._walks || []) if (FAILED.has(w.kind) && w.dim === dim && now - w.at < WINDOW_MS && w.at <= now) out.push(w);
  const walks = new Set(out.map(w => w.walk).filter(v => v != null));
  for (const s of bot?._stallSpots || []) {
    if (s.dim && s.dim.replace(/^minecraft:/, '') !== dim) continue;
    for (const g of s.goals || []) {
      if (now - g.at >= WINDOW_MS || g.at > now || (g.walk != null && walks.has(g.walk))) continue;
      if (g.walk != null) walks.add(g.walk);
      out.push({ at: g.at, kind: 'stall', goal: { x: g.x, y: g.y, z: g.z }, ...(g.from ? { from: g.from } : {}), to: { x: s.x, y: s.y, z: s.z }, walk: g.walk ?? null, spot: true });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Failures, newest last, one per failure (a stall and the ledger's entry for
// the walk it ended, close in time, are one).
function merged(list) {
  const out = [];
  for (const f of list.sort((a, b) => a.at - b.at)) {
    const same = out.find(o => Math.abs(o.at - f.at) <= SAME_FAILURE_MS && (!o.target || !f.target || dist(o.target, f.target) <= TARGET_NEAR));
    if (same) { same.why ||= f.why; same.kind = same.walked ? same.kind : f.kind || same.kind; if (f.walked) Object.assign(same, { walked: f.walked, left: f.left, blocks: f.blocks }); continue; }
    out.push({ ...f });
  }
  return out;
}
const fromOf = w => w.from || w.to || null;

// The ways to about `target` that failed in the window: the ledger's and the
// walks' own. -> [{ at, why, kind, target, walked, blocks, left }]
function towardFailures(bot, goal, target, { now = Date.now(), here = null } = {}) {
  const t = P(target), h = P(here || bot?.entity?.position);
  if (!t) return [];
  const near = p => !h || !p || dist(p, h) <= FROM;
  const list = [];
  for (const e of goal?.tried?.entries || []) {
    const when = e.settledAt || e.at;
    if (!e.target || now - when >= WINDOW_MS || !wayFailed(e) || dist(e.target, t) > TARGET_NEAR || !near(e.place)) continue;
    list.push({ at: when, why: e.why || null, kind: kindOfWhy(e.why || ''), target: e.target, q: e.q, method: e.method });
  }
  for (const w of failedWalks(bot, now)) {
    if (!w.goal || dist(w.goal, t) > TARGET_NEAR || !near(fromOf(w))) continue;
    list.push({ at: w.at, why: w.why || null, kind: w.kind, target: w.goal, walked: true, blocks: w.blocks, left: w.left, stall: w.kind === 'stall' });
  }
  return merged(list);
}

// The ways from about `here` that failed in the window, by target: the
// ledger's tried from here, and the walks begun (or stalled) about here.
// -> [{ at, why, kind, target }] one per target (the latest), newest last
function hereFailures(bot, goal, here, { now = Date.now() } = {}) {
  const h = P(here);
  if (!h) return [];
  const list = [];
  for (const e of goal?.tried?.entries || []) {
    const when = e.settledAt || e.at;
    if (!e.target || !e.place || now - when >= WINDOW_MS || !wayFailed(e) || dist(e.place, h) > HERE) continue;
    list.push({ at: when, why: e.why || null, kind: kindOfWhy(e.why || ''), target: e.target });
  }
  for (const w of failedWalks(bot, now)) {
    if (!w.goal) continue;
    const begun = w.from && dist(w.from, h) <= HERE, stuck = w.spot && w.to && dist(w.to, h) <= HERE;
    if (begun || stuck) list.push({ at: w.at, why: w.why || null, kind: w.kind, target: w.goal, walked: true, stall: w.kind === 'stall' });
  }
  const byTarget = [];
  for (const f of merged(list)) {
    const same = byTarget.find(o => dist(o.target, f.target) <= TARGET_NEAR);
    if (same) { if (f.at > same.at) Object.assign(same, f); continue; }
    byTarget.push(f);
  }
  return byTarget.sort((a, b) => a.at - b.at);
}

const whySays = list => {
  const kinds = {};
  for (const f of list) { const k = KIND_SAYS[f.kind || kindOfWhy(f.why || '')] || KIND_SAYS.failed; kinds[k] = (kinds[k] || 0) + 1; }
  return Object.entries(kinds).map(([k, n]) => n > 1 ? `${k} ${n} times` : k).join(', ');
};
// One failure said: its kind, and how far the walk got.
const onceSays = (f, t, now) => `The last way to about ${at(t)} from about here failed ${ago(now - f.at)} ago: ${KIND_SAYS[f.kind] || KIND_SAYS.failed}${f.walked && Number.isFinite(f.blocks) ? `, ${Math.round(f.blocks)} blocks walked` : ''}${f.walked && Number.isFinite(f.left) ? `, ending ${Math.round(f.left)} blocks from it` : ''}.`;

// Coming at it straight at this height instead, priced, where the failure
// was the route itself and the target is about level and not far: the
// cells, the rock dug with what is carried, the blocks laid over open air,
// the seconds and where it ends (bridging.js surveyCrossing, the crossing's
// own survey). '' where none is read.
function straightSays(bot, t, list) {
  try {
    const here = bot?.entity?.position;
    if (!here || typeof bot.blockAt !== 'function' || !list.some(f => ROUTE_FAILED.has(f.kind))) return '';
    if (!Number.isFinite(t.y) || Math.abs(t.y - here.y) > STRAIGHT_RISE || flat(t, here) > STRAIGHT_ACROSS) return '';
    const s = require('./bridging').surveyCrossing(bot, { x: t.x, y: t.y, z: t.z }, { cells: STRAIGHT_CELLS });
    if (!s.cells || s.gain < 1) return s.stoppedBy ? ` Straight at it at this height is no way either: ${s.stoppedBy} at the first cell.` : '';
    const nt = require('./nether-travel');
    const work = [s.dig ? `${s.dig} block${s.dig === 1 ? '' : 's'} of rock dug${s.noPickaxe ? ' by hand' : ''}` : null, s.bridge ? `${s.bridge} laid over open air` : null].filter(Boolean).join(' and ') || 'over open ground';
    const left = Math.round(s.from - s.gain);
    return ` Straight at it at this height instead: ${s.cells} blocks, ${work}, about ${nt.crossingSeconds(s)} seconds, ending ${left <= 2 ? 'at it' : `${left} blocks from it`}${s.stoppedBy && left > 2 ? ` (there, ${s.stoppedBy})` : ''}.`;
  } catch (_) { return ''; }
}

// The fact on an option going to `target`, from about `here`, or null.
// -> { says, until, kind: 'toward' | 'here' | 'once' }; `until` 0 where it
// does not rest (one failure said).
function read(bot, goal, target, { here = null, now = Date.now(), restMs = 5 * 60000 } = {}) {
  const t = P(target);
  if (!t || !goal) return null;
  const toward = towardFailures(bot, goal, t, { now, here });
  if (toward.length >= TIMES) {
    const until = toward.at(-1).at + restMs;
    return { kind: 'toward', until, n: toward.length,
      says: `Ways to about ${at(t)} have failed ${toward.length} times in the last ${ago(now - toward[0].at)}, whatever was asked (${whySays(toward)}), the last ${ago(now - toward.at(-1).at)} ago.${straightSays(bot, t, toward)}` };
  }
  const h = P(here || bot?.entity?.position);
  if (!h) return null;
  const others = hereFailures(bot, goal, h, { now }).filter(f => dist(f.target, t) > TARGET_NEAR);
  if (others.length >= TIMES) {
    const until = others.at(-1).at + restMs;
    return { kind: 'here', until, n: others.length,
      says: `From about here, ways to ${others.length} other places have failed in the last ${ago(now - others[0].at)} (${whySays(others)}; ${others.slice(-3).map(f => at(f.target)).join(', ')}): the place may be what fails, not the target.` };
  }
  if (toward.length === 1) return { kind: 'once', until: 0, n: 1, says: `${onceSays(toward[0], t, now)}${straightSays(bot, t, toward)}` };
  return null;
}

// The walk about to begin from here toward `there`, refused where walks from
// about here keep failing with no question answered since (the last answer
// to a question about the work, decide's bot._lastAnswer; within the
// window): two toward about the same goal, or PACING to any. Never where no
// walk is wanted (at the goal, or within reach of it). The fact, or null.
function pacingSays(bot, there, { now = Date.now(), atGoal = false } = {}) {
  const here = P(bot?.entity?.position), g = P(there);
  if (!here || atGoal) return null;
  if (g && dist(g, here) <= REACH) return null;
  // Never the body's own walks: a way off from a mob in reach, a meal's or
  // the air's (the vitals' turn) is the safety layer's, not the work's.
  if (bot?._turn?.holder === 'vitals') return null;
  try { if (require('./danger').threats(bot, THREAT_NEAR).length) return null; } catch (_) { /* no world */ }
  const since = Math.max(now - WINDOW_MS, bot?._lastAnswer?.at || 0);
  const fails = failedWalks(bot, now).filter(w => w.at > since && w.from && dist(w.from, here) <= HERE);
  if (!fails.length) return null;
  // Refused once since the last failure, the next walk begins (note 798):
  // the refusal is there to put the failures to the next question, and when
  // no question is answered after it (one option taken unasked, an answer
  // held) refusing again only stands the bot still. 25597 had 80 walks
  // refused under blaze fire (2026-10-01 10:57-11:08Z), mid-231-ai 50, each
  // "since the last question was answered" by a question not asked again.
  const refusedSince = (bot?._walks || []).some(w => w.kind === 'refused' && w.at > fails.at(-1).at && w.at <= now && w.from && dist(w.from, here) <= HERE);
  if (refusedSince) return null;
  const asked = bot?._lastAnswer?.at && now - bot._lastAnswer.at < WINDOW_MS ? `since the last question was answered (${bot._lastAnswer.id.replaceAll('_', ' ')}, ${ago(now - bot._lastAnswer.at)} ago)` : `in the last ${ago(now - fails[0].at)} with no question answered`;
  const toward = g ? fails.filter(w => w.goal && dist(w.goal, g) <= TARGET_NEAR) : [];
  if (toward.length >= TIMES) {
    const spots = [...new Set(toward.map(w => at(w.to || w.from)))].join(' and ');
    return `walks to ${at(g)} begun from about here failed ${toward.length} times ${asked} (${whySays(toward)}, ending at ${spots}), the last ${ago(now - toward.at(-1).at)} ago: not walked again from here until a question is answered`;
  }
  if (fails.length >= PACING) {
    const targets = [...new Set(fails.filter(w => w.goal).map(w => at(w.goal)))].slice(-4).join(', ');
    return `${fails.length} walks begun from about here failed ${asked} (${whySays(fails)}${targets ? `; going to ${targets}` : ''}), the last ${ago(now - fails.at(-1).at)} ago: not walked again from here until a question is answered`;
  }
  return null;
}

// The last failed walk from about here with a place it was going (for the
// stall's question: the way straight at it). -> the walk, or null.
function lastFailedWalk(bot, { now = Date.now(), within = 2 * 60000, here = null } = {}) {
  const h = P(here || bot?.entity?.position);
  if (!h) return null;
  return failedWalks(bot, now).filter(w => w.goal && now - w.at < within && ROUTE_FAILED.has(w.kind) && fromOf(w) && dist(fromOf(w), h) <= FROM).at(-1) || null;
}

module.exports = { read, towardFailures, hereFailures, wayFailed, WAY_FAILED, WINDOW_MS, TARGET_NEAR, HERE, FROM, TIMES, PACING, KINDS, FAILED, ROUTE_FAILED, KIND_SAYS, kindOf, kindOfWhy, noteWalk, failedWalks, pacingSays, lastFailedWalk, straightSays };

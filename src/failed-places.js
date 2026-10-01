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
const WINDOW_MS = 10 * 60000;
const TARGET_NEAR = 4;   // the same target
const HERE = 4;          // from about here
const FROM = 16;         // toward a target, from about here (tried.js TARGET_FROM)
const TIMES = 2;
const SAME_FAILURE_MS = 15000; // a stall and the ledger's failure of the walk it ended are one failure
const WAY_FAILED = /no route|no path|not gaining|navigation timed out|without moving|without getting closer|no nearer|no safe|stall|unreachable|out of reach|can't reach|cannot reach|can't get (at|to)|not walked a third time/i;

const P = v => v && Number.isFinite(v.x) && Number.isFinite(v.z) ? { x: v.x, y: Number.isFinite(v.y) ? v.y : null, z: v.z } : null;
const dist = (a, b) => Number.isFinite(a.y) && Number.isFinite(b.y) ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Math.hypot(a.x - b.x, a.z - b.z);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ago = ms => ms < 90000 ? plural(Math.max(1, Math.round(ms / 1000)), 'second') : plural(Math.round(ms / 60000), 'minute');
const at = p => `(${Math.floor(p.x)}, ${Number.isFinite(p.y) ? Math.floor(p.y) : '?'}, ${Math.floor(p.z)})`;
const dimOf = bot => String(bot?.game?.dimension || 'overworld').replace(/^minecraft:/, '');

// A way that failed, from the ledger: blocked for a reason a way fails by.
const wayFailed = e => e?.outcome === 'blocked' && !e.wait && !e.held && (e.noNearer || WAY_FAILED.test(String(e.why || '')));

// Failures, newest last, one per failure (a stall and the ledger's entry for
// the walk it ended, close in time, are one).
function merged(list) {
  const out = [];
  for (const f of list.sort((a, b) => a.at - b.at)) {
    const same = out.find(o => Math.abs(o.at - f.at) <= SAME_FAILURE_MS && (!o.target || !f.target || dist(o.target, f.target) <= TARGET_NEAR));
    if (same) { same.why ||= f.why; same.stall ||= f.stall; continue; }
    out.push({ ...f });
  }
  return out;
}

// The ways to about `target` that failed in the window: the ledger's and the
// walks' stalls. -> [{ at, why, target, stall }]
function towardFailures(bot, goal, target, { now = Date.now(), here = null } = {}) {
  const t = P(target), h = P(here || bot?.entity?.position);
  if (!t) return [];
  const near = p => !h || !p || dist(p, h) <= FROM;
  const list = [];
  for (const e of goal?.tried?.entries || []) {
    const when = e.settledAt || e.at;
    if (!e.target || now - when >= WINDOW_MS || !wayFailed(e) || dist(e.target, t) > TARGET_NEAR || !near(e.place)) continue;
    list.push({ at: when, why: e.why || null, target: e.target, q: e.q, method: e.method });
  }
  try {
    for (const s of require('./skills').stallsToward(bot, t, now)) if (near(s.spot)) list.push({ at: s.at, why: `a walk to it stalled at ${at(s.spot)}`, target: s.goal, stall: true });
  } catch (_) { /* no stall memory */ }
  return merged(list);
}

// The ways from about `here` that failed in the window, by target: the
// ledger's tried from here, and the walks that stalled about here.
// -> [{ at, why, target }] one per target (the latest), newest last
function hereFailures(bot, goal, here, { now = Date.now() } = {}) {
  const h = P(here);
  if (!h) return [];
  const list = [];
  for (const e of goal?.tried?.entries || []) {
    const when = e.settledAt || e.at;
    if (!e.target || !e.place || now - when >= WINDOW_MS || !wayFailed(e) || dist(e.place, h) > HERE) continue;
    list.push({ at: when, why: e.why || null, target: e.target });
  }
  const dim = dimOf(bot);
  for (const s of bot?._stallSpots || []) {
    if (s.dim && s.dim.replace(/^minecraft:/, '') !== dim) continue;
    if (dist({ x: s.x, y: s.y, z: s.z }, h) > HERE) continue;
    for (const g of s.goals || []) if (now - g.at < WINDOW_MS) list.push({ at: g.at, why: `stalled at ${at(s)}`, target: { x: g.x, y: g.y, z: g.z }, stall: true });
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
  for (const f of list) {
    const k = f.stall || /stall|navigation timed out/i.test(f.why || '') ? 'the walk stalled' : /no route|no path/i.test(f.why || '') ? 'no route' : /no safe/i.test(f.why || '') ? 'no safe step' : /no nearer|not gaining|without getting closer/i.test(f.why || '') ? 'came no nearer' : 'it failed';
    kinds[k] = (kinds[k] || 0) + 1;
  }
  return Object.entries(kinds).map(([k, n]) => n > 1 ? `${k} ${n} times` : k).join(', ');
};

// The fact on an option going to `target`, from about `here`, or null.
// -> { says, until, kind: 'toward' | 'here' }
function read(bot, goal, target, { here = null, now = Date.now(), restMs = 5 * 60000 } = {}) {
  const t = P(target);
  if (!t || !goal) return null;
  const toward = towardFailures(bot, goal, t, { now, here });
  if (toward.length >= TIMES) {
    const until = toward.at(-1).at + restMs;
    return { kind: 'toward', until, n: toward.length,
      says: `Ways to about ${at(t)} have failed ${toward.length} times in the last ${ago(now - toward[0].at)}, whatever was asked (${whySays(toward)}), the last ${ago(now - toward.at(-1).at)} ago.` };
  }
  const h = P(here || bot?.entity?.position);
  if (!h) return null;
  const others = hereFailures(bot, goal, h, { now }).filter(f => dist(f.target, t) > TARGET_NEAR);
  if (others.length >= TIMES) {
    const until = others.at(-1).at + restMs;
    return { kind: 'here', until, n: others.length,
      says: `From about here, ways to ${others.length} other places have failed in the last ${ago(now - others[0].at)} (${whySays(others)}; ${others.slice(-3).map(f => at(f.target)).join(', ')}): the place may be what fails, not the target.` };
  }
  return null;
}

module.exports = { read, towardFailures, hereFailures, wayFailed, WAY_FAILED, WINDOW_MS, TARGET_NEAR, HERE, TIMES };

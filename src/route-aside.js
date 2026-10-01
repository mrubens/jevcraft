'use strict';
// A destination the walk found no route to, again and again from about the
// same place, set aside with its reason (note 775).
//
// 25589 (mid-226-ac, 02:02 to 02:11Z on 2026-10-01) stood within seven
// blocks of (-541, 79, 725) in the Nether for nine minutes while every work
// step began with a walk to (73, 79, 493), 657 blocks off: "No route from
// here to (73, 79, 493) (noPath): the way passes along a drop that would
// kill", 398 times, the loop's counter said in chat to "attempt 130". The
// step's failure went up to the question its ledger named (persist), which
// held its last answer and asked nothing, and the step ran again at once.
// A route that failed three times from within sixteen blocks of here in ten
// minutes is not tried again from here for ten minutes: the step that
// wanted it goes to the stall's question with that said, and the walks that
// read this (a batch left cooking, work.js) leave it out.
const SAME_TARGET = 2, FROM_HERE = 16, WINDOW_MS = 10 * 60000, AFTER = 3, REST_MS = 10 * 60000, KEEP = 32;
const floorOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const dist = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const coordsOf = text => { const m = String(text || '').match(/No route from here to \((-?\d+), (-?\d+), (-?\d+)\)/); return m ? { x: +m[1], y: +m[2], z: +m[3] } : null; };
// Where a failure was going: the error's own destination, else the words.
function destinationOf(err) {
  const d = err?.destination;
  if (d && Number.isFinite(d.x) && Number.isFinite(d.z)) return { x: Math.floor(d.x), y: Number.isFinite(d.y) ? Math.floor(d.y) : null, z: Math.floor(d.z) };
  return coordsOf(err?.message ?? err);
}
const sameTarget = (a, b) => flat(a, b) <= SAME_TARGET && (a.y == null || b.y == null || Math.abs(a.y - b.y) <= SAME_TARGET);
const state = goal => (goal.routeAside ||= { fails: [], aside: [] });
function prune(goal, now) {
  const s = state(goal);
  s.fails = s.fails.filter(f => now - f.at < WINDOW_MS).slice(-KEEP);
  s.aside = s.aside.filter(a => a.until > now).slice(-KEEP);
  return s;
}
// The set-aside entry for this destination that stands from `here`, if any.
function asideFor(goal, target, here, now = Date.now()) {
  if (!goal?.routeAside || !target) return null;
  const s = prune(goal, now);
  return s.aside.find(a => sameTarget(a, target) && (!here || dist(a.from, here) <= FROM_HERE)) || null;
}
// One failure noted; set aside on the third from about here. Returns
// { target, count, aside, newly, says } or null when the error names no place.
function noteFailure(goal, err, here, now = Date.now()) {
  const target = destinationOf(err);
  if (!goal || !target || !here) return null;
  const s = prune(goal, now), from = floorOf(here);
  const why = String(err?.message ?? err).replace(/^No route from here to \([^)]*\) ?/, '').replace(/^\((noPath|partial|timeout)\)(: )?/, '').slice(0, 140) || 'no route';
  s.fails.push({ ...target, from, at: now, why });
  const mine = s.fails.filter(f => sameTarget(f, target) && dist(f.from, from) <= FROM_HERE);
  let aside = asideFor(goal, target, from, now), newly = false;
  if (!aside && mine.length >= AFTER) {
    const span = Math.max(1, Math.round((now - mine[0].at) / 1000));
    aside = { ...target, from, at: now, until: now + REST_MS, count: mine.length, seconds: span, why, distance: Math.round(dist(from, { ...target, y: target.y ?? from.y })) };
    s.aside.push(aside); newly = true;
  }
  return { target, count: mine.length, aside, newly, says: aside ? asideSays(aside, now) : null };
}
const at = p => `(${p.x}, ${p.y ?? '~'}, ${p.z})`;
function asideSays(a, now = Date.now()) {
  const left = Math.max(1, Math.ceil((a.until - now) / 60000));
  return `the route to ${at(a)}, ${a.distance} blocks off, found no way ${a.count} times from about here in ${a.seconds} second${a.seconds === 1 ? '' : 's'} (${a.why}); it is set aside from within ${FROM_HERE} blocks of ${at(a.from)} for ${left} more minute${left === 1 ? '' : 's'}, and the step that wanted it is not tried again from here`;
}
const chatSays = a => `No way to ${at(a)} from here, ${a.distance} blocks off: ${a.why}. I've set it aside and I'll choose something else.`;

// The relocations the stall's question offers (recovery-options.js) move to
// footing a few blocks off and take the work up again; where the work's
// failure is the same after each from about here, a move of a few blocks
// changed nothing about it, said on every relocation offered (note 775).
const failureKey = error => { const c = coordsOf(error); return c ? `route:${c.x},${c.z}` : String(error || '').replace(/-?\d+(\.\d+)?/g, '#').slice(0, 60); };
function noteRelocation(goal, here, to, error, now = Date.now()) {
  if (!goal || !here || !to) return;
  goal.relocationsTried = [...(goal.relocationsTried || []).filter(r => now - r.at < WINDOW_MS), { at: now, from: floorOf(here), to: floorOf(to), failure: failureKey(error) }].slice(-12);
}
function relocationsTried(goal, here, error, now = Date.now()) {
  if (!goal?.relocationsTried || !here || !error) return [];
  const key = failureKey(error), from = floorOf(here);
  return goal.relocationsTried.filter(r => now - r.at < WINDOW_MS && r.failure === key && dist(r.from, from) <= FROM_HERE);
}
function relocationSays(list, option, here, error, now = Date.now()) {
  if (!list?.length || !option?.position) return '';
  const p = option.position, same = list.find(r => dist(r.to, p) <= 2);
  const ago = r => `${Math.max(1, Math.round((now - r.at) / 1000))} seconds ago`;
  const target = coordsOf(error), far = target && here ? Math.round(flat(target, here)) : null;
  const route = target && far > 32 ? ` The work's failure is the route to ${at(target)}, ${far} blocks off: footing a few blocks from here does not change that route.` : '';
  return ` Tried: ${same ? `this same footing ${ago(same)}` : `${list.length} move${list.length === 1 ? '' : 's'} to footing near here in the last ${Math.max(1, Math.round((now - list[0].at) / 60000))} minute${now - list[0].at < 90000 ? '' : 's'} (the last to ${at(list.at(-1).to)}, ${ago(list.at(-1))})`}, and the work failed the same way after ${list.length === 1 && same ? 'it' : 'each'}, the bot back within ${FROM_HERE} blocks of where it began.${route}`;
}
module.exports = { noteRelocation, relocationsTried, relocationSays, failureKey, noteFailure, asideFor, asideSays, chatSays, destinationOf, coordsOf, sameTarget, SAME_TARGET, FROM_HERE, WINDOW_MS, AFTER, REST_MS };

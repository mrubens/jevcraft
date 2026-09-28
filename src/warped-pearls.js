'use strict';
// Pearls from the warped forest. Endermen spawn there in numbers and leave
// a player be who does not look at them, so the eyes' pearls are a walk to
// the forest and a string of fights one at a time, not an Overworld night
// spent walking about hoping one shows (the user, 2026-09-23: "walking
// around looking for endermen sucks").
//
// A forest remembered (exploration.js notices them) is walked to and hunted
// in. None known: the Nether is swept for one in legs of sixty-four blocks,
// eight at most, then the search rests half an hour and the ladder falls
// back to the Overworld hunt. A hunt in the forest that brings no pearl in
// fifteen minutes rests too.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { setAside, isSetAside } = require('./progress');

const LEG = 64, SEARCH_LEGS = 8, SEARCH_MS = 15 * 60 * 1000, REST_MS = 30 * 60 * 1000, STALL_MS = 15 * 60 * 1000;
const HEADINGS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const inNether = l => /nether/.test(String(l.dimension || ''));

// A warped forest remembered anywhere in the Nether, and whether the walk
// there rests (exploration.js goToLandmark sets a trip that came no nearer
// aside half an hour).
const tripKey = l => `${l.kind}:${l.x},${l.z}`;
const tripOpen = (goal, l, now = Date.now()) => !isSetAside(goal, 'landmark_trip', tripKey(l), now);
const warpedKnown = (goal, now = Date.now()) => (goal.landmarks || []).filter(l => l.kind === 'warped_forest' && inNether(l) && tripOpen(goal, l, now));
// Whether the pearls should come from the forest now: one known whose walk
// does not rest, or a search for one. A known forest whose walk rested was
// planned every pass and returned at once, twenty passes a second, until
// the progress watch failed it over and over (mid-242-ae-nether-3-fortress-1,
// note 583).
function warpedOpen(goal, now = Date.now()) {
  if (isSetAside(goal, 'rung', 'warped_pearls', now)) return false;
  return warpedKnown(goal, now).length > 0 || !isSetAside(goal, 'rung', 'warped_search', now);
}

async function warpedPearls(bot, task, goal, save, actions, stage, { now = Date.now } = {}) {
  const exploration = require('./exploration');
  actions.notice?.(bot, goal, save);
  const known = exploration.knownLandmarks(bot, goal, 'warped_forest', 512).find(k => tripOpen(goal, k.landmark, now()));
  if (known) {
    const arrived = await exploration.goToLandmark(bot, task, goal, save, ['warped_forest'], { navigate: actions.navigate, reach: 512, arrive: 16 });
    // A walk that came no nearer sets the trip aside: said as the step's own
    // failure, with where and why, and kept in the ledger, not a quiet
    // return the progress watch calls "No measurable progress" (note 583).
    if (!arrived && !tripOpen(goal, known.landmark, now())) {
      const l = known.landmark, w = l.lastWalk;
      const why = `The walk to the warped forest at (${l.x}, ${l.z}), ${Math.round(known.distance)} blocks off, came no nearer${w?.why ? `: ${w.why}` : ''}; that walk rests half an hour`;
      require('./tried').record(bot, goal, { q: 'step', method: 'warped_pearls', target: { x: l.x, y: Number.isFinite(l.y) ? l.y : Math.round(bot.entity.position.y), z: l.z }, outcome: 'blocked', why });
      throw new Error(why);
    }
    if (!arrived) return false;
    // In the forest: the ordinary hunt, which takes the endermen in view.
    const watch = goal.warpedHunt ||= { since: now(), best: count(bot, 'ender_pearl') };
    if (count(bot, 'ender_pearl') > watch.best) { watch.best = count(bot, 'ender_pearl'); watch.since = now(); }
    if (now() - watch.since > STALL_MS) {
      setAside(goal, 'rung', 'warped_pearls', 'fifteen minutes in the warped forest without a pearl', REST_MS); delete goal.warpedHunt; save();
      bot.chat?.('No pearls from the warped forest for a while. Trying another way.');
      return false;
    }
    goal.step = { action: 'warped_pearls', at: { x: known.landmark.x, y: known.landmark.y, z: known.landmark.z }, pearls: count(bot, 'ender_pearl') }; save();
    await actions.acquireStep(bot, task, 'ender_pearl', stage.count, goal, save);
    return true;
  }
  // None known: sweep for one.
  const search = goal.warpedSearch ||= { legs: 0, heading: Math.floor(Math.random() * 4), fails: 0, tries: 0, startedAt: now() };
  search.startedAt ||= now();
  // Legs are ground covered, not attempts: on the first live search every
  // walk failed at once on Nether ground and eight "legs" went in a second.
  // And time spent, not tries: stuck on a pillar, twenty-four tries went in
  // a minute. Eight legs, or a quarter of an hour, and the search rests.
  if (search.legs >= SEARCH_LEGS || now() - search.startedAt > SEARCH_MS) {
    setAside(goal, 'rung', 'warped_search', `${SEARCH_LEGS} legs without a warped forest`, REST_MS); delete goal.warpedSearch; save();
    bot.chat?.('No warped forest found. Pearls the other way for now.');
    return false;
  }
  const here = bot.entity.position;
  const [dx, dz] = HEADINGS[search.heading % 4];
  const leg = new Vec3(Math.round(here.x + dx * LEG), Math.max(40, Math.min(90, Math.round(here.y))), Math.round(here.z + dz * LEG));
  goal.step = { action: 'warped_search', leg: search.legs + 1, target: { x: leg.x, y: leg.y, z: leg.z } }; save();
  if (search.legs === 0 && !search.said) { search.said = true; bot.chat?.('Looking for a warped forest: endermen, and their pearls.'); }
  const before = Math.hypot(leg.x - here.x, leg.z - here.z);
  const seen = () => { actions.notice?.(bot, goal, save); return warpedKnown(goal).length > 0; };
  const start = bot.entity.position.clone();
  try { await actions.navigate(bot, task, new goals.GoalNearXZ(leg.x, leg.z, 8), { timeoutMs: 45000, stallMs: 8000, stopWhen: seen }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  // No way on foot: through the netherrack, as the fortress sweep goes.
  if (bot.entity.position.distanceTo(start) < 2 && actions.tunnel && !warpedKnown(goal).length) {
    try { await actions.tunnel(bot, task, goal, save, leg); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; search.lastError = err.message; }
  }
  const after = Math.hypot(leg.x - bot.entity.position.x, leg.z - bot.entity.position.z);
  search.tries = (search.tries || 0) + 1;
  if (after < before - 16 || warpedKnown(goal).length) { search.legs++; search.fails = 0; }
  else if (after < before - 1) search.fails = 0;
  else if (++search.fails >= 3) { search.heading++; search.fails = 0; }
  save();
  return true;
}

module.exports = { warpedKnown, warpedOpen, warpedPearls, SEARCH_LEGS, LEG };

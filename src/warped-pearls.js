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

const LEG = 64, FOREST_REACH = 512, SEARCH_LEGS = 8, SEARCH_MS = 15 * 60 * 1000, REST_MS = 30 * 60 * 1000, STALL_MS = 15 * 60 * 1000;
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
// In the Nether (`bot` given there), a forest counts only as the step
// counts one, within its reach: 25597 (mid-242-gf) remembered one 1,020
// blocks off, the sweep's rest was no rest while it did, and the sweep
// started again the second it rested, "Looking for a warped forest" and
// "No warped forest found" four times in sixteen seconds (note 685).
function warpedOpen(goal, now = Date.now(), { bot = null } = {}) {
  if (isSetAside(goal, 'rung', 'warped_pearls', now)) return false;
  const here = bot?.entity?.position && /nether/.test(String(bot.game?.dimension || ''));
  const known = here ? require('./exploration').knownLandmarks(bot, goal, 'warped_forest', FOREST_REACH).filter(k => tripOpen(goal, k.landmark, now)) : warpedKnown(goal, now);
  return known.length > 0 || !isSetAside(goal, 'rung', 'warped_search', now);
}

async function warpedPearls(bot, task, goal, save, actions, stage, { now = Date.now } = {}) {
  const exploration = require('./exploration');
  actions.notice?.(bot, goal, save);
  // The forest this step walks to: one in this dimension within 512 blocks
  // whose walk does not rest. The sweep's legs counted any forest
  // remembered, farther or resting too, as found: mid-242-gb (25593) had a
  // leg "found" each tenth of a second, eight in under a second, and said
  // "Looking for a warped forest" and "No warped forest found" three times
  // in a second each (note 680).
  const toWalk = () => exploration.knownLandmarks(bot, goal, 'warped_forest', FOREST_REACH).find(k => tripOpen(goal, k.landmark, now())) || null;
  const known = toWalk();
  if (known) {
    const arrived = await exploration.goToLandmark(bot, task, goal, save, ['warped_forest'], { navigate: actions.navigate, reach: 512, arrive: 16 });
    // A walk that came no nearer sets the trip aside: said as the step's own
    // failure, with where and why, and kept in the ledger, not a quiet
    // return the progress watch calls "No measurable progress" (note 583).
    if (!arrived && !tripOpen(goal, known.landmark, now())) {
      const l = known.landmark, w = l.lastWalk;
      const noRoute = /no route/i.test(w?.why || '');
      // A hard "No route" (the pathfinder found none at all, not a stall a
      // second leg might close through the walk's own digging): the
      // staircase the sweep tries for a heading it cannot walk, tried here
      // too, toward a forest already known, before its trip rests. 25595
      // (mid-242-vh) had two known forests end "No route" one after the
      // other and fell straight to the blind sweep, four navigation stalls
      // in, never digging toward either forest it already had (critic
      // 08:17Z, note 736).
      if (noRoute && actions.tunnel) {
        const target = new Vec3(l.x, Number.isFinite(l.y) ? l.y : bot.entity.position.y, l.z);
        const before = bot.entity.position.distanceTo(target);
        try { await actions.tunnel(bot, task, goal, save, target, { within: goal.step }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
        if (bot.entity.position.distanceTo(target) < before - 4) { save(); return true; }
      }
      const why = `The walk to the warped forest at (${l.x}, ${l.z}), ${Math.round(known.distance)} blocks off, came no nearer${w?.why ? `: ${w.why}` : ''}${noRoute ? `; tried and unreachable on foot${actions.tunnel ? ', a staircase toward it gaining no ground either' : ''}` : ''}; that walk rests half an hour`;
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
    const knownOnes = (goal.landmarks || []).filter(l => l.kind === 'warped_forest').length;
    setAside(goal, 'rung', 'warped_search', knownOnes ? `${SEARCH_LEGS} legs without reaching a warped forest (${knownOnes} known, not reached)` : `${SEARCH_LEGS} legs without a warped forest`, REST_MS); delete goal.warpedSearch; save();
    // Forests known but not reached are said as that (note 970): 25597
    // (mid-242-pf-nether-1, 2026-10-03 02:58:24Z) said "No warped forest
    // found" with 84, 119 and 206 warped stems known 48 to 51 blocks off.
    const knownForests = (goal.landmarks || []).filter(l => l.kind === 'warped_forest' && (!l.dimension || /nether/.test(l.dimension))).length;
    bot.chat?.(knownForests ? `The warped forest${knownForests === 1 ? '' : 's'} known could not be reached. Pearls the other way for now.` : 'No warped forest found. Pearls the other way for now.');
    return false;
  }
  const here = bot.entity.position;
  const [dx, dz] = HEADINGS[search.heading % 4];
  const leg = new Vec3(Math.round(here.x + dx * LEG), Math.max(40, Math.min(90, Math.round(here.y))), Math.round(here.z + dz * LEG));
  goal.step = { action: 'warped_search', leg: search.legs + 1, target: { x: leg.x, y: leg.y, z: leg.z } }; save();
  if (search.legs === 0 && !search.said) { search.said = true; bot.chat?.('Looking for a warped forest: endermen, and their pearls.'); }
  const before = Math.hypot(leg.x - here.x, leg.z - here.z);
  const seen = () => { actions.notice?.(bot, goal, save); return !!toWalk(); };
  const start = bot.entity.position.clone();
  let walkWhy = null, stairWhy = null;
  try { await actions.navigate(bot, task, new goals.GoalNearXZ(leg.x, leg.z, 8), { timeoutMs: 45000, stallMs: 8000, stopWhen: seen, passing: true }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; walkWhy = String(err.message || err).slice(0, 120); }
  // No way on foot: through the netherrack, as the fortress sweep goes. The
  // staircase is this step's phase, not a step of its own: named 'tunnel'
  // in turn with 'warped_search', the two traded names every pass and the
  // flip watch called it two steps handing the turn back and forth (note
  // 588), as it had obsidian's tunnel (tunneling.js).
  if (bot.entity.position.distanceTo(start) < 2 && actions.tunnel && !toWalk()) {
    try { await actions.tunnel(bot, task, goal, save, leg, { within: goal.step }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; stairWhy = String(err.message || err).slice(0, 160); }
  }
  search.lastError = `the walk ${walkWhy ? `failed (${walkWhy})` : bot.entity.position.distanceTo(start) < 2 ? 'came no nearer' : 'went on'}${actions.tunnel ? `, the staircase ${stairWhy ? `failed (${stairWhy})` : 'came no nearer'}` : ''}`;
  const after = Math.hypot(leg.x - bot.entity.position.x, leg.z - bot.entity.position.z);
  search.tries = (search.tries || 0) + 1;
  if (after < before - 16 || toWalk()) { search.legs++; search.fails = 0; delete search.spent; }
  else if (after < before - 1) search.fails = 0;
  else if (++search.fails >= 3) {
    // A heading that came to nothing three times is kept with where it was
    // tried from; every heading come to nothing from about one spot is the
    // sweep spent from there, said as the step's failure with each
    // heading's why and rested as a trip that came no nearer is. On 25600
    // (mid-242-ae-nether-2-fortress-2, note 588) every walk found no route
    // and every staircase no floor to step onto, from a ledge of its own
    // stairs; the search turned heading every three tries, 233 tries and no
    // leg, and would have gone on for its quarter of an hour.
    const at = bot.entity.position;
    const spent = search.spent && Math.hypot(search.spent.from.x - at.x, search.spent.from.z - at.z) <= SPENT_NEAR ? search.spent
      : (search.spent = { from: { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) }, headings: {} });
    spent.headings[HEADING_NAMES[search.heading % 4]] = search.lastError;
    search.heading++; search.fails = 0;
    if (Object.keys(spent.headings).length >= HEADINGS.length) {
      const why = `The sweep for a warped forest got nowhere from (${spent.from.x}, ${spent.from.y}, ${spent.from.z}): every heading came to nothing (${Object.entries(spent.headings).map(([h, w]) => `${h}: ${w}`).join('; ')}); the sweep rests half an hour`;
      setAside(goal, 'rung', 'warped_search', why.slice(0, 300), REST_MS); delete goal.warpedSearch; save();
      require('./tried').record(bot, goal, { q: 'step', method: 'warped_pearls', outcome: 'blocked', why });
      throw new Error(why);
    }
  }
  save();
  return true;
}
const SPENT_NEAR = 8;
const HEADING_NAMES = ['east', 'south', 'west', 'north'];

module.exports = { warpedKnown, warpedOpen, warpedPearls, SEARCH_LEGS, LEG };

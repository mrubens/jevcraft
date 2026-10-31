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

const SEARCH_AWAY_MS = 5 * 60 * 1000, RETRY_NEAR = 32, NEARER_BY = 24;
const LEG = 64, FOREST_REACH = 512, SEARCH_LEGS = 8, SEARCH_MS = 15 * 60 * 1000, REST_MS = 30 * 60 * 1000, STALL_MS = 15 * 60 * 1000, AWAY_MS = 60 * 1000, TUNNEL_NEAR = 96;
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
  // From the Overworld (`bot` given there), a forest counts as it will on
  // the far side: within the step's reach of where the crossing comes out,
  // the nearest portal known in the Nether to the bot's place there (an
  // eighth of its place here), or that place itself (note 1109). Counted
  // from here with no reach, a forest remembered far off sent the bot
  // through the portal, where no forest was in reach and the search rested,
  // and back, and through again: 25591 crossed four times in four minutes
  // (20:42 to 20:46Z).
  const over = !here && bot?.entity?.position && /overworld/.test(String(bot.game?.dimension || ''));
  const arrival = over ? (() => {
    const at = { x: bot.entity.position.x / 8, z: bot.entity.position.z / 8 };
    const portals = (goal.portals || []).filter(p => /nether/.test(String(p.dimension || ''))).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
    return portals[0] && Math.hypot(portals[0].x - at.x, portals[0].z - at.z) <= 128 ? portals[0] : at;
  })() : null;
  const known = here ? require('./exploration').knownLandmarks(bot, goal, 'warped_forest', FOREST_REACH).filter(k => tripOpen(goal, k.landmark, now))
    : warpedKnown(goal, now).filter(l => !arrival || Math.hypot(l.x - arrival.x, l.z - arrival.z) <= FOREST_REACH);
  return known.length > 0 || !isSetAside(goal, 'rung', 'warped_search', now);
}

// Whether the bot stands in a warped forest: the biome at its feet, or
// warped nylium within six blocks.
function inForest(bot) {
  try {
    const here = bot.entity.position.floored(), id = bot.registry?.biomesByName?.warped_forest?.id;
    if (id != null && bot.blockAt?.(here)?.biome?.id === id) return true;
    const nylium = bot.registry?.blocksByName?.warped_nylium?.id;
    return nylium != null && typeof bot.findBlocks === 'function' && bot.findBlocks({ matching: [nylium], maxDistance: 6, count: 1 }).length > 0;
  } catch (_) { return false; }
}

// The nearest warped nylium within 64 with room to stand on it, as the cell above it (note 2258): the forest's own floor, loaded
// round the bot, nearer and lower than the point the forest was first seen from.
function nyliumFloor(bot) {
  try {
    const id = bot.registry?.blocksByName?.warped_nylium?.id; if (id == null || typeof bot.findBlocks !== 'function') return null;
    const here = bot.entity.position, open = c => { const b = bot.blockAt(c); return b && b.boundingBox === 'empty' && !/lava|fire/.test(b.name); };
    const cells = bot.findBlocks({ matching: [id], maxDistance: 64, count: 60 }).map(p => p.offset(0, 1, 0)).filter(c => open(c) && open(c.offset(0, 1, 0)));
    // At the endermen's own height where they are in sight (note 2264): the slot fights only those within four of its mouth's level,
    // and forest-5 (2026-10-26 22:3x to 22:5xZ) walked to the nearest nylium on high ledges at y 97 to 100 and ended three sessions
    // 'none of the 3 about has a line to the mouth (all more than 4 blocks over or under it)'.
    const men = Object.values(bot.entities || {}).filter(e => e.name === 'enderman' && e.isValid !== false && e.position && e.position.distanceTo(here) <= 64);
    if (men.length) { const level = cells.filter(c => men.some(e => Math.abs(e.position.y - c.y) <= 3)); if (level.length) cells.splice(0, cells.length, ...level); }
    // Nearest by the walk's measure: a block up or down costs about as much as three across.
    cells.sort((a, b) => (Math.hypot(a.x - here.x, a.z - here.z) + 3 * Math.abs(a.y - here.y)) - (Math.hypot(b.x - here.x, b.z - here.z) + 3 * Math.abs(b.y - here.y)));
    return cells[0] || null;
  } catch (_) { return null; }
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
  // Standing in a forest counts as one known, its walk resting or not, and
  // whether or not it was ever noted (note 1072).
  const feet = bot.entity.position.floored();
  // A forest part rested for a dry spell (note 2265) is not counted as one stood in: the next forest known, or the sweep for one.
  const dry = goal.warpedDry && goal.warpedDry.until > now() ? goal.warpedDry : null;
  const inDry = dry && Math.hypot(feet.x - dry.x, feet.z - dry.z) <= 48;
  const known = toWalk() || (inForest(bot) && !inDry ? { landmark: { kind: 'warped_forest', x: feet.x, y: feet.y, z: feet.z }, distance: 0 } : null);
  if (known) {
    // In the forest already (its biome underfoot, or its nylium within six
    // blocks): arrived, wherever in it the landmark's own point lies (note
    // 1072). 25593 (2026-10-03 15:08Z), back in the Nether with all seven
    // rods in its chests and standing in its forest at (-64, 59, 28), walked
    // at the point noted for it at (-75, 28) on another level, "33 blocks
    // off, came no nearer", rested the forest, and went sweeping for another.
    // To the nearest warped nylium the body can stand on first (note 2258): the landmark's point is where the forest was first
    // seen, often on a ledge or a cliff above the way, and the walks to it ended 18 to 44 blocks short (full-1 'No route' at 20,
    // full-4 'navigation timed out' at 44 with the point 34 above, full-6 'No route' at 18, full-7 eight walks refused; the
    // user, 2026-10-26: 'we gotta be able to solve that'). Any of the forest's floor is the forest (inForest).
    if (!inForest(bot) && actions.navigate) {
      // The floor a flight was dug toward is kept for the next passes while it is near its time (note 2681): the pick
      // follows the endermen's level when any is in view, and mid-full-9-forest-5 (25591, 2026-10-31 07:2xZ) had it flip
      // between (89, 40, 370) and (135, 63, 363) as endermen on a terrace came in and out of its sixty-four blocks, each
      // pass walking or digging toward the other.
      const kept = bot._forestFloorDug && bot._forestFloorDug.target && bot._forestFloorDug.at > Date.now() - 180000 ? bot._forestFloorDug.target : null;
      const floor = kept && (() => { try { const b = bot.blockAt(kept.offset(0, -1, 0)); return b && b.name === 'warped_nylium'; } catch (_) { return false; } })() ? kept : nyliumFloor(bot);
      if (floor) {
        const t0 = Date.now(), d0 = Math.round(floor.distanceTo(bot.entity.position));
        let walkWhy = null;
        try { await actions.navigate(bot, task, new goals.GoalNear(floor.x, floor.y, floor.z, 2), { timeoutMs: 45000, stallMs: 8000 }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; walkWhy = String(err.message || err); }
        // The floor walk that finds no route at all, the bot at the landmark's point already (note 2669): dug toward as
        // the landmark walk is below (note 736), not asked again at every pass. full-238 (25588, 2026-10-31 05:57 to
        // 06:07Z), 7 rods banked and on its pearls, stood on a ledge at (54 to 72, 47, 9 to 21) beside its forest with the
        // floor 17 to 33 blocks off across a gap, 'not reached, 17 off in 0 s' at every pass for ten minutes, 'no route'
        // eight walks running, hunting endermen it could not get to; the landmark's point under its feet read as arrived.
        // A walk that comes back inside two seconds short of the floor found no way as surely as one that says so (note 2670):
        // full-238's floor walks ended 'not reached, 34 off in 0 s' and threw nothing, so note 2669's test never ran.
        // Dug again at once while each pass gains ground, and once in two minutes where it does not (note 2678): the two-minute
        // rest of note 2669 held for every pass, and mid-full-9-forest-5 (25591, 2026-10-31 07:08Z) gained four blocks of
        // the twenty-three down to its floor in seven seconds, then stood for the rest.
        const dugBefore = bot._forestFloorDug || null, offNow = floor.distanceTo(bot.entity.position);
        const gaining = dugBefore && dugBefore.off - offNow >= 1;
        if (!inForest(bot) && ((walkWhy && /no route/i.test(walkWhy)) || (Date.now() - t0 < 2000 && offNow > 4)) && actions.tunnel && (gaining || !(bot._forestFloorDugAt > Date.now() - 120000))) {
          bot._forestFloorDugAt = Date.now();
          console.log(`[warped] no route to the forest's floor at (${floor.x}, ${floor.y}, ${floor.z}) from (${feet.x}, ${feet.y}, ${feet.z}), ${Math.round(offNow)} off${gaining ? ` (${Math.round(dugBefore.off - offNow)} nearer since the last dig)` : ''}: digging toward it`);
          // A whole flight, not one step (note 2680): the tunnel action is one staircase step, and a pass here dug one
          // block and then measured it against the two-minute rest, so mid-full-9-forest-5 (25591, 2026-10-31 07:00 to
          // 07:30Z), its floor nineteen blocks below a ledge, dug a block every pass or two for half an hour and stood 17
          // off at the end. The steps go on while they gain toward the floor (three in a row gaining under half a block
          // ends the flight), to the forest, or for a minute.
          const fl = new Vec3(floor.x, floor.y, floor.z), dugAt = Date.now(); let steps = 0, flat = 0, last = fl.distanceTo(bot.entity.position), ended = null;
          try {
            while (!inForest(bot) && Date.now() - dugAt < 60000 && steps < 48 && flat < 3) {
              await actions.tunnel(bot, task, goal, save, fl, { within: goal.step });
              steps++;
              const off = fl.distanceTo(bot.entity.position);
              flat = last - off < 0.5 ? flat + 1 : 0; last = off;
            }
          } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; ended = String(err.message || err).slice(0, 160); }
          console.log(`[warped] the dig toward the floor: ${steps} step${steps === 1 ? '' : 's'} in ${Math.round((Date.now() - dugAt) / 1000)} s, ${Math.round(fl.distanceTo(bot.entity.position))} off${ended ? `, ended: ${ended}` : flat >= 3 ? ', the last steps gained nothing' : ''}`);
          bot._forestFloorDug = { off: floor.distanceTo(bot.entity.position), at: Date.now(), target: fl };
        }
        console.log(`[warped] to the forest's floor at (${floor.x}, ${floor.y}, ${floor.z}), ${d0} blocks off: ${inForest(bot) ? 'in the forest' : `not reached, ${Math.round(floor.distanceTo(bot.entity.position))} off`} in ${Math.round((Date.now() - t0) / 1000)} s`);
      }
    }
    const arrived = inForest(bot) ? known.landmark : (await exploration.goToLandmark(bot, task, goal, save, ['warped_forest'], { navigate: actions.navigate, reach: 512, arrive: 16 })) || (inForest(bot) ? known.landmark : null);
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
      // So too a walk that ran out of its time with the forest near (note
      // 1073): 25593 (2026-10-03 15:08:59Z), all seven rods in its chests,
      // 33 blocks from its forest and 19 under it, "navigation timed out
      // without reaching new ground", rested the forest half an hour and
      // swept for another, 89 tries at a leg none of which walked.
      if ((noRoute || known.distance <= TUNNEL_NEAR) && actions.tunnel) {
        const target = new Vec3(l.x, Number.isFinite(l.y) ? l.y : bot.entity.position.y, l.z);
        const before = bot.entity.position.distanceTo(target);
        try { await actions.tunnel(bot, task, goal, save, target, { within: goal.step }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
        // Ground gained toward it: its walk's rest is let go, and the next
        // pass goes on toward it (the rest kept, the next pass swept for
        // another forest with this one half reached).
        if (bot.entity.position.distanceTo(target) < before - 4) { require('./progress').attemptsFor(goal).clear('landmark_trip', tripKey(l)); save(); return true; }
        // And the Nether's own crossing straight at it, dug through the rock
        // and laid over the gaps, as the way to a portal or a fortress is
        // made where no walk goes (nether-travel.js crossToward, note 1120).
        // 25592 (2026-10-03 21:19:13Z), seven rods in its chests and its
        // forest 87 blocks off, had the walk end "No route ... the way
        // passes along a drop that would kill" and the staircase gain
        // nothing in a second; the forest rested half an hour, and eight
        // legs of the sweep later it said "The warped forest known could
        // not be reached" and went back to the Overworld.
        try {
          const crossed = await require('./nether-travel').crossToward(bot, task, goal, save, target, { what: 'the warped forest' });
          if (crossed.tried && bot.entity.position.distanceTo(target) < before - 4) { require('./progress').attemptsFor(goal).clear('landmark_trip', tripKey(l)); save(); return true; }
        } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      }
      const why = `The walk to the warped forest at (${l.x}, ${l.z}), ${Math.round(known.distance)} blocks off, came no nearer${w?.why ? `: ${w.why}` : ''}${noRoute ? `; tried and unreachable on foot${actions.tunnel ? ', a staircase toward it gaining no ground either' : ''}` : ''}; that walk rests half an hour`;
      require('./tried').record(bot, goal, { q: 'step', method: 'warped_pearls', target: { x: l.x, y: Number.isFinite(l.y) ? l.y : Math.round(bot.entity.position.y), z: l.z }, outcome: 'blocked', why });
      throw new Error(why);
    }
    if (!arrived) return false;
    // In the forest: the ordinary hunt, which takes the endermen in view.
    const watch = goal.warpedHunt ||= { since: now(), best: count(bot, 'ender_pearl') };
    // The fifteen minutes are minutes in the forest (note 1065): a watch not
    // looked at for a minute (the bot away, dead, or in the Overworld) begins
    // again, as does one whose pearls are no longer carried. 25590
    // (2026-10-03 14:26 to 14:32Z), eight rods in its chests, came back into
    // the Nether for pearls, reached the forest, and was told at once "No
    // pearls from the warped forest for a while" by a watch begun before it
    // left; it went back to the Overworld five minutes after it came.
    if (now() - (watch.lastAt || watch.since) > AWAY_MS || count(bot, 'ender_pearl') < watch.best) { watch.since = now(); watch.best = count(bot, 'ender_pearl'); }
    watch.lastAt = now();
    if (count(bot, 'ender_pearl') > watch.best) { watch.best = count(bot, 'ender_pearl'); watch.since = now(); }
    if (now() - watch.since > STALL_MS) {
      // This part of the forest rests, not the forests (note 2265): the step's whole rest sent the ladder on to carrying the rods
      // home, and the forest trial forest-6 (2026-10-26 23:14 to 00:14Z, 6 pearls in its first 16 minutes, then the endermen about
      // its slots killed) walked home with the rods for its last 44 minutes, 6 pearls short. Its walk rests, and so does the
      // ground within 48 of here; the next pass walks to another forest known or sweeps for one.
      const l = known.landmark;
      setAside(goal, 'landmark_trip', tripKey(l), 'fifteen minutes in this part of the warped forest without a pearl', REST_MS);
      goal.warpedDry = { x: feet.x, z: feet.z, until: now() + REST_MS }; delete goal.warpedHunt; save();
      console.log(`[warped] fifteen minutes without a pearl at (${feet.x}, ${feet.z}): this part of the forest rests; another forest known, or the sweep for one, next`);
      bot.chat?.('No pearls here for a while. Trying another part of the forest.');
      return false;
    }
    goal.step = { action: 'warped_pearls', at: { x: known.landmark.x, y: known.landmark.y, z: known.landmark.z }, pearls: count(bot, 'ender_pearl') }; save();
    await actions.acquireStep(bot, task, 'ender_pearl', stage.count, goal, save);
    return true;
  }
  // A forest known whose walk rests, come NEARER_BY blocks nearer than where
  // that walk failed (or within RETRY_NEAR of it): the rest was from there,
  // and from here it is walked at again (note 1120). 25592's sweep passed 52
  // blocks from its rested forest, 35 nearer than where the walk had failed.
  for (const k of exploration.knownLandmarks(bot, goal, 'warped_forest', FOREST_REACH)) {
    if (tripOpen(goal, k.landmark, now())) continue;
    const from = k.landmark.lastWalk?.from, failedAt = from ? Math.hypot(k.landmark.x - from.x, k.landmark.z - from.z) : null;
    // Always nearer than where it last failed, so a forest that cannot be
    // reached is not walked at again from the same spot.
    if (failedAt != null && (k.distance <= failedAt - NEARER_BY || (k.distance <= RETRY_NEAR && k.distance <= failedAt - 8))) {
      require('./progress').attemptsFor(goal).clear('landmark_trip', tripKey(k.landmark)); save();
      return true;
    }
  }
  // None known: sweep for one.
  const search = goal.warpedSearch ||= { legs: 0, heading: Math.floor(Math.random() * 4), fails: 0, tries: 0, startedAt: now() };
  search.startedAt ||= now();
  // The clock and the legs are the search's own, begun again after five
  // minutes away from it (note 1109, as the forest's watch since note
  // 1065): 25591 (2026-10-03 20:42:44Z), back in the Nether for pearls
  // after ninety minutes in the Overworld, nine rods and seven pearls in
  // its chest, was told twelve seconds in "The warped forests known could
  // not be reached. Pearls the other way for now" by a search begun before
  // it left, and went back through the portal.
  if (now() - (search.lastAt || search.startedAt) > SEARCH_AWAY_MS) Object.assign(search, { legs: 0, fails: 0, tries: 0, startedAt: now() });
  search.lastAt = now();
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
  // Nor by a staircase, on a ledge whose every side drops to lava: a span
  // laid toward the leg (note 2023). full-1 (2026-10-22 02:32 and 04:43Z),
  // twice on a Nether ledge at (114, 90, 28) and (137, 51, 8), found every
  // heading's walk without a route past a deadly drop and every staircase
  // with no safe step, rested the sweep within a minute each time, and went
  // back through the portal with no pearl: five crossings in five hours.
  let crossWhy = null;
  if (bot.entity.position.distanceTo(start) < 2 && actions.cross && !toWalk()) {
    try { crossWhy = await actions.cross(bot, task, goal, save, leg); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; crossWhy = String(err.message || err).slice(0, 160); }
  }
  search.lastError = `the walk ${walkWhy ? `failed (${walkWhy})` : bot.entity.position.distanceTo(start) < 2 ? 'came no nearer' : 'went on'}${actions.tunnel ? `, the staircase ${stairWhy ? `failed (${stairWhy})` : 'came no nearer'}` : ''}${actions.cross && crossWhy ? `, the span ${crossWhy}` : ''}`;
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

module.exports = { inForest, warpedKnown, warpedOpen, warpedPearls, SEARCH_LEGS, LEG };

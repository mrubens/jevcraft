'use strict';
// Getting about the Nether when the way on foot ends. The crossing is made
// and then the wall: legs that walk into the lava sea's cliffs and ledges,
// the fortress search standing at y 95 with its next leg's target out of
// reach on foot (mid-215-d, note 251), and the way back to the portal lost
// two hundred and fifty blocks off (mid-211-c, note 241). A player goes by
// other means: straight through the netherrack, or across on blocks laid
// ahead, at the height they stand. And when that too comes to nothing, the
// choices that answer the Nether (food from its hoglins, a portal of its
// own, going on without the Overworld) are Jev's, with what each needs.
const { Vec3 } = require('vec3');
const { surveyCrossing, bridgeTo, blocksCarried } = require('./bridging');
const { advance, setAside, isSetAside } = require('./progress');

const inNether = bot => /nether/.test(String(bot.game?.dimension || ''));
const countOf = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const retryable = err => !['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name);

// A stretch of a crossing: as far as a leg on foot toward a portal goes
// (work.js portalLeg), and the survey looks no further ahead.
const CROSS_STRETCH = 32;
// A sneaking player covers about 1.3 blocks a second; the span is crouched
// from its first block to its last (bridging.js).
const SNEAK_SPEED = 1.3;
// A block laid: six tenths of a second (survival.js BLOCK_SECONDS).
const BLOCK_SECONDS = 0.6;

// Ground made is a new nearest approach, as for every walk (skills.js
// navigation progress): a leg that went some way in and came back out, or
// shuffled along a ledge, made none. By more than a block, the size of a
// step. `record` keeps the best; a fresh record starts at `from`.
function nearer(record, distance, from) {
  if (!Number.isFinite(record.best) && Number.isFinite(from)) record.best = from;
  return !advance(record, distance, { epsilon: 1 });
}

// About how long a surveyed crossing takes: the walk crouched, each block
// laid, each dug with the tool that digs it.
const crossingSeconds = s => Math.round(s.cells / SNEAK_SPEED + s.bridge * BLOCK_SECONDS + (s.digSeconds || 0));

function crossingSays(s, what) {
  const work = [];
  if (s.dig) work.push(`digging ${s.dig} block${s.dig === 1 ? '' : 's'} of rock`);
  if (s.bridge) work.push(`laying ${s.bridge} block${s.bridge === 1 ? '' : 's'} over open ${s.overLava ? `air and lava (${s.overLava} of them over lava)` : 'air'}`);
  if (!work.length) work.push('over ground already open');
  return `Go straight at ${what} at the height the bot stands, ${s.cells} blocks, ${work.join(' and ')}, crouched all the way so a step does not go over an edge: about ${crossingSeconds(s)} seconds. ` +
    `${s.carried} blocks carried${s.bridge ? `, ${s.carried - s.bridge} left after` : ''}. It ends ${Math.round(s.gain)} blocks nearer, ${Math.round(s.from - s.gain)} from it` +
    `${s.stoppedBy ? `; there, ${s.stoppedBy}` : ''}. Rock is dug only where no lava or water is behind it.`;
}

// Straight at `target`, through rock and over air or lava, at this height,
// as far as the survey shows it can go: the way a player gets on where the
// pathfinder's walk ended. Returns the survey and whether it was tried.
// A crossing that ended no nearer rests, from this eight-block area toward
// this target, with why: mid-235-e's fortress search took the crossing
// forty times in a few minutes on an island in the lava sea, each run
// returning within a second with nothing laid, and the stall answered with
// it again each time (2026-09-27).
const CROSS_REST_MS = 5 * 60000;
const crossKey = (bot, target) => { const h = bot.entity.position; return `${Math.floor(h.x / 8)},${Math.floor(h.z / 8)}>${Math.round(target.x)},${Math.round(target.z)}`; };
const crossingResting = (bot, goal, target) => isSetAside(goal, 'crossing', crossKey(bot, target));
async function crossToward(bot, task, goal, save, target, { what = 'the target' } = {}) {
  if (!inNether(bot) || typeof bot.blockAt !== 'function') return { tried: false };
  if (crossingResting(bot, goal, target)) return { tried: false, resting: true };
  const survey = surveyCrossing(bot, target, { cells: CROSS_STRETCH });
  if (!survey.cells || survey.gain < 1) return { tried: false, survey };
  goal.step = { action: 'cross_toward', what, target: { x: Math.round(target.x), y: Math.round(target.y), z: Math.round(target.z) },
    cells: survey.cells, dig: survey.dig, bridge: survey.bridge, carried: survey.carried }; save();
  const key = crossKey(bot, target), before = flat(target, bot.entity.position);
  let why = null;
  try { await bridgeTo(bot, task, target, { maxBlocks: survey.bridge, maxSteps: survey.cells }); }
  catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; goal.lastCrossError = err.message; save(); }
  if (before - flat(target, bot.entity.position) < 1) { setAside(goal, 'crossing', key, why || 'it laid nothing nearer', CROSS_REST_MS); save(); }
  return { tried: true, survey };
}

// What a sweep leg would meet along a heading at the height the bot stands,
// cell by cell before it is chosen: open air the bot walks through and sees
// from, rock the crossing digs blind, lava or unloaded ground that stops it.
// mid-205-m spent fifty-one of its sixty Nether minutes on legs of ninety-
// odd blocks at y 96 to 104 straight through solid netherrack, about six
// seconds a cell, thirteen legs and nothing seen from inside the rock (note
// 394, 2026-09-27): the leg kept the height it started at and went the way
// the compass said, whatever lay that way. Now each heading is surveyed and
// the leg is Jev's to choose (mob-hunt.js chooseLeg), with these facts.
const WALK_SPEED = 4.3;
// Measured on mid-205-m: two blocks dug a cell, about six seconds a cell.
const ROCK_CELL_SECONDS = 6;
// Open air over a drop this deep is a cavern or the lava sea's edge, where a
// fortress is seen from afar (its bricks are found within 128 blocks).
const CAVERN_DROP = 4;
const passable = b => !b || b.boundingBox === 'empty';
// A cell of open air with no floor under it is crossed only on a block laid
// there, crouched: the crossing's pace (crossingSeconds), not a walk.
// mid-211-s-nether-4 and mid-202-o, in a basalt delta with nothing carried,
// were told a leg south was "94 of open air, about 34 seconds" and chose it
// some thirty times; every one ended at the ledge (note 480).
const LAY_CELL_SECONDS = 1 / SNEAK_SPEED + BLOCK_SECONDS;
// The cells a leg's first stretch is said by, run by run.
const FIRST_CELLS = 16;
const FIRST_SAYS = { rock: 'rock to dig', floor: 'open air with a floor', gap: 'open air with no floor under it', lava: 'open air over lava a block down' };
function firstSays(survey) {
  if (!survey?.first?.length && !survey?.stoppedBy) return '';
  const runs = (survey.first || []).map(r => `${r.n} of ${FIRST_SAYS[r.kind]}`);
  const stop = Number.isInteger(survey.stoppedAt) && survey.stoppedAt < FIRST_CELLS ? `, then ${survey.stoppedBy}` : '';
  if (!runs.length) return ` The first cell: ${survey.stoppedBy}.`;
  return ` The first ${Math.min(FIRST_CELLS, survey.cells)} cell${Math.min(FIRST_CELLS, survey.cells) === 1 ? '' : 's'}, in order: ${runs.join(', ')}${stop}.`;
}
function surveyLeg(bot, heading, { cells = 96, from = null, blocks = null } = {}) {
  if (typeof bot.blockAt !== 'function' || !bot.entity?.position) return null;
  const [dx, dz] = heading;
  const carried = blocks ?? blocksCarried(bot);
  const out = { cells: 0, open: 0, rock: 0, cavern: 0, lay: 0, carried, runsOut: null, reach: 0, reachSeconds: null, stoppedBy: null, stoppedAt: null, first: [] };
  let here = from || bot.entity.position.floored(), seconds = 0;
  // The first cells as runs of what they are (rock, floor, no floor):
  // what the leg meets before anything else, said with it (legSays).
  const note = kind => { if (out.cells >= FIRST_CELLS) return; const last = out.first.at(-1); if (last?.kind === kind) last.n++; else out.first.push({ kind, n: 1 }); };
  for (let n = 0; n < cells; n++) {
    const next = here.offset(dx, 0, dz);
    const body = [next, next.offset(0, 1, 0)].map(p => bot.blockAt(p));
    if (body.some(b => !b)) { out.stoppedBy = 'unloaded ground'; out.stoppedAt = out.cells; break; }
    if (body.some(b => /lava|fire/.test(b.name || ''))) { out.stoppedBy = 'lava in the way'; out.stoppedAt = out.cells; break; }
    if (body.some(b => !passable(b))) { note('rock'); out.rock++; seconds += ROCK_CELL_SECONDS; }
    else {
      out.open++;
      const floor = bot.blockAt(next.offset(0, -1, 0));
      if (floor && floor.boundingBox === 'block') { note('floor'); seconds += 1 / WALK_SPEED; }
      else {
        note(floor && /lava/.test(floor.name || '') ? 'lava' : 'gap');
        // The first cell needing a block past those carried: the leg ends there.
        if (out.lay >= carried && out.runsOut === null) { out.runsOut = out.cells; out.reachSeconds = Math.round(seconds); }
        out.lay++; seconds += LAY_CELL_SECONDS;
      }
      let depth = 0;
      for (; depth < CAVERN_DROP; depth++) { const b = bot.blockAt(next.offset(0, -1 - depth, 0)); if (!b || !passable(b) || /lava/.test(b.name || '')) break; }
      if (depth >= CAVERN_DROP) out.cavern++;
      if (out.runsOut === null) out.reach++;
    }
    out.cells++; here = next;
  }
  out.seconds = Math.round(seconds);
  return out;
}

// The leg as a fact: what is open, what is rock and about how long, that
// nothing is seen from inside the rock, and the blocks it needs laid
// against the blocks carried.
function legSays(survey, { direction, length, y }) {
  if (!survey) return `Go ${direction} ${length} blocks at y ${y}. Not surveyed from here.`;
  const parts = [];
  if (survey.open) parts.push(`${survey.open} of open air${survey.cavern ? ` (${survey.cavern} of them over a drop of four or more: a cavern or the lava sea's edge, where a fortress is seen from afar)` : ''}`);
  if (survey.rock) parts.push(`${survey.rock} of rock to dig (about ${ROCK_CELL_SECONDS} seconds a cell, and nothing is seen from inside it)`);
  const stop = survey.stoppedBy ? ` ${survey.stoppedBy[0].toUpperCase()}${survey.stoppedBy.slice(1)} stops it at cell ${survey.stoppedAt}.` : '';
  const lay = survey.lay || 0, carried = survey.carried ?? 0, short = Number.isInteger(survey.runsOut);
  const blocks = !lay ? '' : ` ${lay} of the open cells have no floor: it needs ${lay} block${lay === 1 ? '' : 's'} laid, crouched, about ${Math.round(LAY_CELL_SECONDS * 10) / 10} seconds a cell, ${carried} carried: ` +
    (short ? `the blocks run out at cell ${survey.runsOut}, about ${survey.reachSeconds} seconds in, where the leg stops with none to lay.` : `${carried - lay} left after.`);
  return `Go ${direction} ${length} blocks at y ${y}: of the ${survey.cells} cells ahead, ${parts.join(' and ') || 'none open'}; about ${survey.seconds} seconds${short ? ' with the blocks for all of it' : ''}.${blocks}${stop}${firstSays(survey)}`;
}

// The floor below: going down to the ground and walking it, where the
// ground allows. mid-244-ad-nether-2 laid a one-wide span ninety blocks long
// at y 74 over a netherrack cavern whose floor was walkable fifteen to
// twenty blocks down, piglins on it, ran out of blocks and chose to go back
// for more twenty-eight times; mid-244-ad-nether-1 laid a diagonal one at
// y 63 over a crimson forest walkable at y 32 to 45 and, 186 blocks from
// its portal, was asked the way back ninety-five times in ten minutes
// (note 568). Every way on was a straight level line at the height it
// stood: the leg's cells ahead at y N (surveyLeg), its target at that
// height (mob-hunt.js fortressLegTarget), the crossing at the feet's
// height (surveyCrossing), and the pathfinder, which drops three at most
// and digs no netherrack, found nothing down from a span. A player crosses
// the Nether on its floors where they are walkable (forests, soul sand
// valleys, netherrack caverns) and bridges only across lava or a void.
// Here the floor is found (floorBelow), the way down to it (wayDown: a walk,
// the drops a body takes, steps dug down through rock) and the floor that
// way (walkFloor: floor to walk, rises, lava on it, gaps, the mobs by it),
// each priced for Jev's question beside the level ways.
const FLOOR_LOOK = 48;
// A floor this far below the feet or more is a way of its own: the drop a
// cavern's view is counted from (CAVERN_DROP).
const FLOOR_BELOW = CAVERN_DROP;
// The columns each way round the bot its height is read from, and how many
// of them must show ground that far down.
const FLOOR_SAMPLE = 16, FLOOR_SEEN = 8;
// How far across the way down is looked for, and the cells looked at: a
// span is walked back along to its start, sixty blocks out and more.
const DOWN_REACH = 64, DOWN_NODES = 8000;
// Floor cells a way along it needs among its cells to be offered.
const FLOOR_WALKABLE = 8;
// A fall's damage weighed against seconds in finding the way down.
const DAMAGE_SECONDS = 4;
// A block of height climbed by a block laid under the feet, or a step dug.
const CLIMB_SECONDS = 1.2;
// On soul sand a walk goes at about four tenths of its pace.
const SOUL_PACE = 0.4;
const NETHER_MOBS = /^(piglin|piglin_brute|hoglin|zoglin|zombified_piglin|magma_cube|ghast|blaze|wither_skeleton|skeleton|enderman)$/;
const burns = b => /lava|fire/.test(b?.name || '');
const openCell = b => !!b && b.boundingBox === 'empty' && !burns(b);
const solidCell = b => !!b && b.boundingBox === 'block' && !burns(b);
// Feet at `feet` stand: a floor under, body and head open, nothing burning.
function stands(bot, feet) {
  return solidCell(bot.blockAt(feet.offset(0, -1, 0))) && openCell(bot.blockAt(feet)) && openCell(bot.blockAt(feet.offset(0, 1, 0)));
}
const lavaBeside = (bot, feet) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => [0, -1].some(dy => /lava/.test(bot.blockAt(feet.offset(dx, dy, dz))?.name || '')));
// The deepest drop a body takes: its damage (a point a block past three)
// under half the health, as the staircase's drops are judged.
const deepestDrop = bot => Math.min(DROP_DEEPEST, Math.ceil((bot.health ?? 20) / 2) + 2);
const DROP_DEEPEST = 24;
const hasPickaxe = bot => (bot.inventory?.items?.() || []).some(i => /_pickaxe$/.test(i.name));
const HEADS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const median = list => { const s = list.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// The first ground under a column, from the height `y` down: the feet's
// height on it, or lava, or a wall at `y` itself; null past what is loaded.
function groundUnder(bot, x, z, y, look = FLOOR_LOOK) {
  for (let dy = 0; dy <= look; dy++) {
    const b = bot.blockAt(new Vec3(x, y - dy, z));
    if (!b) return null;
    if (/lava/.test(b.name || '')) return { lava: true, y: y - dy };
    if (b.boundingBox !== 'block') continue;
    if (dy === 0) return { wall: true };
    if (dy === 1) return { y };
    return openCell(bot.blockAt(new Vec3(x, y - dy + 2, z))) ? { y: y - dy + 1, name: b.name } : null;
  }
  return null;
}

// The floor round the bot: the ground under the columns out to sixteen each
// way, where it lies four or more below the feet. Its height is the middle
// of those; null where fewer than eight columns show it (the bot is on the
// ground, or over the lava sea).
function floorBelow(bot, from = null) {
  if (typeof bot.blockAt !== 'function' || !bot.entity?.position) return null;
  const start = from || require('./terrain').restingCell(bot) || bot.entity.position.floored();
  const deep = [];
  let lava = 0;
  for (const [dx, dz] of HEADS) for (let k = 1; k <= FLOOR_SAMPLE; k++) {
    const g = groundUnder(bot, start.x + dx * k, start.z + dz * k, start.y);
    if (g?.lava && start.y - g.y >= FLOOR_BELOW) lava++;
    else if (Number.isFinite(g?.y) && start.y - g.y >= FLOOR_BELOW) deep.push(g.y);
  }
  if (deep.length < FLOOR_SEEN) return null;
  const y = median(deep);
  return { y, depth: start.y - y, columns: deep.length, lava, from: start };
}

// The way down to feet at `floorY` or lower from where the bot stands,
// within thirty-two across: walked (a step up or level), a drop a body
// takes (landing on no lip beside lava or a deadly drop, as the pathfinder
// lands), or, with a pickaxe, a step dug down into rock with nothing
// flowing behind it (the staircase's step). The cheapest by seconds and a
// fall's damage. Null where none is found.
// The world read once a cell for a search that looks at each many times.
function cachedView(bot) {
  const cells = new Map();
  const view = Object.create(bot);
  view.blockAt = p => { const k = `${p.x},${p.y},${p.z}`; if (!cells.has(k)) cells.set(k, bot.blockAt(p)); return cells.get(k); };
  return view;
}
function wayDown(live, floorY, { from = null, reach = DOWN_REACH, nodes = DOWN_NODES } = {}) {
  const bot = cachedView(live);
  const start = from || require('./terrain').restingCell(bot) || bot.entity.position.floored();
  const health = bot.health ?? 20, deepest = deepestDrop(bot), pick = hasPickaxe(bot);
  const { dropNear } = require('./terrain'), { safeExcavation } = require('./tunneling');
  const key = p => `${p.x},${p.y},${p.z}`;
  const best = new Map([[key(start), 0]]), prev = new Map();
  const heap = [{ p: start, cost: 0 }];
  const push = n => { heap.push(n); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j].cost <= heap[i].cost) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].cost < heap[m].cost) m = l; if (r < heap.length && heap[r].cost < heap[m].cost) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  const digTime = b => { if (typeof b.digTime !== 'function') return ROCK_CELL_SECONDS / 2; const tool = require('./skills').cheapestTool?.(bot, b); return b.digTime(tool?.type ?? null, false, false, false, [], {}) / 1000; };
  const edgeDeadly = p => { const e = dropNear(bot, p, 1); return e && (e.into === 'lava' || e.damage >= health / 2); };
  let seen = 0, end = null;
  while (heap.length && seen < nodes) {
    const { p, cost } = pop();
    if (cost > best.get(key(p))) continue;
    seen++;
    if (p.y <= floorY) { end = p; break; }
    for (const [dx, dz] of HEADS) {
      const n = p.offset(dx, 0, dz);
      if (Math.abs(n.x - start.x) > reach || Math.abs(n.z - start.z) > reach) continue;
      const moves = [];
      if (stands(bot, n) && !lavaBeside(bot, n)) moves.push({ to: n, seconds: 1 / WALK_SPEED });
      else if (stands(bot, n.offset(0, 1, 0)) && openCell(bot.blockAt(p.offset(0, 2, 0))) && !lavaBeside(bot, n.offset(0, 1, 0))) moves.push({ to: n.offset(0, 1, 0), seconds: 1 / WALK_SPEED + 0.3 });
      else if (openCell(bot.blockAt(n)) && openCell(bot.blockAt(n.offset(0, 1, 0)))) {
        // Over the edge: where the body comes down.
        for (let k = 1; k <= deepest + 1; k++) {
          const b = bot.blockAt(n.offset(0, -k, 0));
          if (!b || burns(b)) break;
          if (b.boundingBox !== 'block') continue;
          const fall = k - 1, land = n.offset(0, -fall, 0);
          if (fall < 1 || fall > deepest || lavaBeside(bot, land)) break;
          if (fall >= 2 && edgeDeadly(land)) break;
          moves.push({ to: land, seconds: 1 / WALK_SPEED + fall * 0.1, fall, damage: Math.max(0, fall - 3) });
          break;
        }
      }
      // A step dug down into rock, a pickaxe carried: the cells from the
      // head's height ahead down to the new feet, each natural and with
      // nothing flowing in behind it, and a floor under.
      if (pick && !moves.length) {
        const to = n.offset(0, -1, 0), floor = bot.blockAt(to.offset(0, -1, 0));
        if (solidCell(floor) && !lavaBeside(bot, to)) {
          let secs = 0, dug = 0, ok = true;
          for (const c of [n.offset(0, 1, 0), n, to]) {
            const b = bot.blockAt(c);
            if (!b || burns(b)) { ok = false; break; }
            if (b.boundingBox !== 'block' && openCell(b)) continue;
            if (!b.diggable || !NATURAL_ROCK.test(b.name || '') || !safeExcavation(bot, c)) { ok = false; break; }
            dug++; secs += digTime(b);
          }
          if (ok && dug) moves.push({ to, seconds: 1 / WALK_SPEED + secs, dug });
        }
      }
      for (const m of moves) {
        const c = cost + m.seconds + (m.damage || 0) * DAMAGE_SECONDS, k = key(m.to);
        if (m.to.y < floorY - 2 || c >= (best.get(k) ?? Infinity)) continue;
        best.set(k, c); prev.set(k, { from: p, ...m }); push({ p: m.to, cost: c });
      }
    }
  }
  if (!end) return null;
  const way = { end, cells: 0, seconds: 0, damage: 0, drops: [], dug: 0, maxDrop: 0, path: [] };
  for (let at = end; !at.equals(start);) {
    const step = prev.get(key(at));
    way.cells++; way.seconds += step.seconds; way.damage += step.damage || 0; way.dug += step.dug || 0;
    if (step.fall >= 2) { way.drops.unshift(step.fall); way.maxDrop = Math.max(way.maxDrop, step.fall); }
    way.path.unshift(at); at = step.from;
  }
  way.seconds = Math.round(way.seconds);
  way.across = Math.round(Math.hypot(end.x - start.x, end.z - start.z));
  way.from = start;
  return way;
}
const NATURAL_ROCK = /^(netherrack|crimson_nylium|warped_nylium|soul_sand|soul_soil|basalt|blackstone|nether_wart_block|warped_wart_block|shroomlight|crimson_stem|warped_stem|crimson_hyphae|warped_hyphae|gravel|glowstone|nether_gold_ore|nether_quartz_ore)$/;

// Columns along a heading, or straight toward a target (the crossing's
// cells: along whichever axis has farther to go).
function headingColumns(from, [dx, dz], cells) { return Array.from({ length: cells }, (_, i) => ({ x: from.x + dx * (i + 1), z: from.z + dz * (i + 1) })); }
function lineColumns(from, target, cells) {
  const out = []; let x = from.x, z = from.z;
  for (let i = 0; i < cells; i++) {
    const ddx = Math.floor(target.x) - x, ddz = Math.floor(target.z) - z;
    if (Math.abs(ddx) <= 1 && Math.abs(ddz) <= 1) break;
    if (Math.abs(ddx) >= Math.abs(ddz)) x += Math.sign(ddx); else z += Math.sign(ddz);
    out.push({ x, z });
  }
  return out;
}

// The floor along `columns` from feet at `from`, following the ground: a
// step up one or down three is walked; lava on the floor, or open air with
// no ground within what a body drops, is a block laid; a rise of two to
// six a climb (a block laid under the feet a block of height, or a step
// dug); a higher wall rock to dig; a deeper drop a body takes is a fall.
// With the mobs within eight of the ground walked.
function walkFloor(bot, from, columns, { blocks = null } = {}) {
  const carried = blocks ?? blocksCarried(bot), deepest = deepestDrop(bot);
  const out = { cells: 0, floor: 0, lava: 0, gap: 0, rise: 0, climb: 0, drops: 0, damage: 0, rock: 0, lay: 0, soul: 0, magma: 0, carried, runsOut: null, seconds: 0, stoppedBy: null, stoppedAt: null, mobs: {}, lowest: from.y, highest: from.y, first: [] };
  const walked = [];
  const note = kind => { if (out.cells >= FIRST_CELLS) return; const last = out.first.at(-1); if (last?.kind === kind) last.n++; else out.first.push({ kind, n: 1 }); };
  let h = from.y;
  for (const { x, z } of columns) {
    const at = y => new Vec3(x, y, z), b = y => bot.blockAt(at(y));
    if ([h - 1, h, h + 1].some(y => !b(y))) { out.stoppedBy = 'unloaded ground'; out.stoppedAt = out.cells; break; }
    let stand = null;
    for (const y of [h, h - 1, h - 2, h - 3, h + 1]) {
      if (!stands(bot, at(y))) continue;
      if (y < h && ![h, h + 1].every(c => openCell(b(c)))) continue;
      stand = y; break;
    }
    let kind;
    if (stand !== null) {
      kind = 'floor'; out.floor++; h = stand;
      const under = b(h - 1)?.name || '';
      if (/soul_s(and|oil)/.test(under)) { out.soul++; out.seconds += 1 / (WALK_SPEED * SOUL_PACE); } else out.seconds += 1 / WALK_SPEED;
      if (/magma_block/.test(under)) out.magma++;
    } else if (burns(b(h)) || burns(b(h + 1)) || /lava/.test(b(h - 1)?.name || '')) {
      kind = 'lava'; out.lava++;
    } else if (!openCell(b(h)) || !openCell(b(h + 1))) {
      let up = null;
      for (let k = 2; k <= 6; k++) if (stands(bot, at(h + k))) { up = k; break; }
      if (up) { kind = 'rise'; out.rise++; out.climb += up; out.seconds += up * CLIMB_SECONDS; h += up; }
      else { kind = 'rock'; out.rock++; out.seconds += ROCK_CELL_SECONDS; }
    } else {
      let fall = null;
      for (let k = 4; k <= deepest; k++) { const c = b(h - k - 1); if (!c || burns(c)) break; if (c.boundingBox === 'block') { if (!lavaBeside(bot, at(h - k))) fall = k; break; } }
      if (fall) { kind = 'drop'; out.drops++; out.damage += fall - 3; h -= fall; out.seconds += 1 / WALK_SPEED; }
      else { kind = 'gap'; out.gap++; }
    }
    if (kind === 'lava' || kind === 'gap') {
      if (out.lay >= carried && out.runsOut === null) out.runsOut = out.cells;
      out.lay++; out.seconds += LAY_CELL_SECONDS;
    }
    note(kind);
    walked.push(at(h));
    out.lowest = Math.min(out.lowest, h); out.highest = Math.max(out.highest, h);
    out.cells++;
  }
  out.seconds = Math.round(out.seconds);
  out.end = walked.at(-1) || from;
  // The mobs by the ground walked: within eight across and eight up or down
  // of a cell of it.
  for (const e of Object.values(bot.entities || {})) {
    if (!NETHER_MOBS.test(e?.name || '') || e.isValid === false || !e.position) continue;
    if (walked.some(p => Math.hypot(e.position.x - p.x - 0.5, e.position.z - p.z - 0.5) <= 8 && Math.abs(e.position.y - p.y) <= 8)) out.mobs[e.name] = (out.mobs[e.name] || 0) + 1;
  }
  return out;
}

const FLOOR_FIRST = { floor: 'floor to walk', lava: 'lava on the floor', gap: 'open air with no ground a body drops to', rise: 'a rise to climb', rock: 'wall to dig', drop: 'a drop to take' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// The way down said: how far across and down, walked, dropped or dug, the
// seconds and the damage.
function wayDownSays(down) {
  const w = down.way, parts = [`${w.cells} step${w.cells === 1 ? '' : 's'} ending ${w.across} blocks across from here`];
  if (w.drops.length) parts.push(`dropping ${w.drops.join(', ')} (${w.damage ? `about ${w.damage} damage` : 'no damage'})`);
  if (w.dug) parts.push(`digging ${plural(w.dug, 'block')} of rock for the steps down`);
  return `The way down to the floor ${down.depth} blocks below (y ${down.y}, seen under ${down.columns} of the 64 columns round the bot) is ${parts.join(', ')}: about ${w.seconds} seconds, found on the ground and rock about the bot, walked upright by the pathfinder.`;
}
function floorWalkSays(f, { along }) {
  const parts = [];
  if (f.floor) parts.push(`${f.floor} of floor to walk${f.soul ? ` (${f.soul} of soul sand or soil, at under half the pace)` : ''}${f.magma ? ` (${f.magma} of magma, which burns to stand on)` : ''}`);
  if (f.rise) parts.push(`${plural(f.rise, 'rise')} to climb, ${f.climb} blocks of height in all`);
  if (f.drops) parts.push(`${plural(f.drops, 'drop')} to take, about ${f.damage} damage`);
  if (f.lava) parts.push(`${f.lava} of lava on the floor`);
  if (f.gap) parts.push(`${f.gap} of open air with no ground a body drops to`);
  if (f.rock) parts.push(`${f.rock} of wall to dig (about ${ROCK_CELL_SECONDS} seconds a cell)`);
  const lay = !f.lay ? ' No block is laid.' : ` The lava and open air need ${f.lay} block${f.lay === 1 ? '' : 's'} laid, ${f.carried} carried: ${Number.isInteger(f.runsOut) ? `they run out at cell ${f.runsOut}` : `${f.carried - f.lay} left after`}.`;
  const mobs = Object.entries(f.mobs).map(([n, c]) => `${c} ${n.replaceAll('_', ' ')}${c === 1 ? '' : 's'}`);
  const firstRuns = f.first.map(r => `${r.n} of ${FLOOR_FIRST[r.kind]}`).join(', ');
  return `On the floor, of the ${f.cells} cells ${along}: ${parts.join(', ') || 'none open'}, ${f.lowest === f.highest ? `all at y ${f.lowest}` : `from y ${f.lowest} to ${f.highest}`}; about ${f.seconds} seconds.${lay}` +
    `${f.stoppedBy ? ` ${capital(f.stoppedBy)} stops it at cell ${f.stoppedAt}.` : ''}${firstRuns ? ` The first cells, in order: ${firstRuns}.` : ''}` +
    ` ${mobs.length ? `By the floor that way: ${mobs.join(', ')}.` : 'No mobs are known by the floor that way.'}`;
}
const capital = s => `${s[0].toUpperCase()}${s.slice(1)}`;
// The height back up: to the height the bot stands, or to what it is going to.
function backUpSays(down, upTo, what) {
  const up = Math.round(upTo - down.y);
  if (up < 3) return '';
  return ` ${capital(what)} is ${up} blocks above the floor: that height is climbed again at the end (a block laid under the feet a block of height, the ground's own slopes where they rise, or a staircase dug), ${down.carried} blocks carried.`;
}
// The floor under the bot and the way down to it, or null.
function floorWay(bot) {
  const floor = floorBelow(bot);
  if (!floor) return null;
  const way = wayDown(bot, floor.y + 1, { from: floor.from });
  return way ? { ...floor, way, carried: blocksCarried(bot) } : null;
}
// Down the way found, by the pathfinder: its drops allowed as deep as the
// way's deepest, the rock of the steps down let dug, and the cells of the
// way walked though an edge is beside them (the choice was Jev's, said
// with the drops). Reached when the feet are within two of the floor.
async function goDown(bot, task, down, navigate) {
  const m = bot.pathfinder?.movements, end = down.end || down.way?.end || down, floorY = down.floorY ?? down.y;
  const cells = new Set((down.path || down.way?.path || []).map(p => `${p.x},${p.y},${p.z}`));
  const kept = m ? { maxDropDown: m.maxDropDown } : null, freed = [];
  if (m) {
    m.maxDropDown = Math.max(m.maxDropDown ?? 3, down.maxDrop ?? down.way?.maxDrop ?? 0);
    if ((down.dug ?? down.way?.dug) && m.blocksCantBreak?.delete) for (const [name, b] of Object.entries(bot.registry?.blocksByName || {})) if (NATURAL_ROCK.test(name) && m.blocksCantBreak.has(b.id)) { m.blocksCantBreak.delete(b.id); freed.push(b.id); }
  }
  let why = null;
  try {
    const { goals } = require('mineflayer-pathfinder');
    await navigate(bot, task, new goals.GoalNear(end.x, end.y, end.z, 1), { timeoutMs: 60000, stallMs: 8000, besideLava: n => cells.has(`${n.x},${n.y},${n.z}`) });
  } catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
  finally { if (m) { m.maxDropDown = kept.maxDropDown; for (const id of freed) m.blocksCantBreak.add(id); } }
  const y = Math.floor(bot.entity.position.y);
  return y <= floorY + 2 ? { reached: true } : { reached: false, why: `${why ? `${why}; ` : ''}it ended at y ${y}, the floor at y ${floorY}` };
}
// The floor toward a target: the way down and the floor along the straight
// line from where the way down ends.
function floorToward(bot, down, target, cells = 96) {
  return walkFloor(bot, down.way.end, lineColumns(down.way.end, target, cells));
}
// Down, then a stretch of the floor toward the target on foot (the
// pathfinder, bridging where the floor has lava or a gap): what the way
// down and the floor come to. One that ends no lower and no nearer rests
// from this eight-block area toward this target, with why, as a crossing
// does.
const floorKey = (bot, target) => { const h = bot.entity.position; return `${Math.floor(h.x / 8)},${Math.floor(h.y / 8)},${Math.floor(h.z / 8)}>${Math.round(target.x)},${Math.round(target.z)}`; };
async function walkFloorToward(bot, task, goal, save, target, down, navigate) {
  const key = floorKey(bot, target), before = bot.entity.position.clone();
  goal.step = { action: 'floor_toward', target: { x: Math.round(target.x), y: Math.round(target.y), z: Math.round(target.z) }, floorY: down.y, down: { x: down.way.end.x, y: down.way.end.y, z: down.way.end.z } }; save();
  const done = await goDown(bot, task, down, navigate);
  let why = done.why || null;
  if (done.reached) {
    const here = bot.entity.position, d = Math.hypot(target.x - here.x, target.z - here.z), step = Math.min(CROSS_STRETCH, Math.max(0, d - 4)) / (d || 1);
    const { goals } = require('mineflayer-pathfinder');
    try { await navigate(bot, task, new goals.GoalNearXZ(here.x + (target.x - here.x) * step, here.z + (target.z - here.z) * step, 4), { timeoutMs: 30000, stallMs: 8000 }); }
    catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
  }
  const lower = before.y - bot.entity.position.y >= 2, nearer = flat(target, before) - flat(target, bot.entity.position) >= 1;
  if (!lower && !nearer) { setAside(goal, 'floor_toward', key, why || 'it came no lower and no nearer', CROSS_REST_MS); save(); }
  return { reached: done.reached, lower, nearer, why };
}
function floorTowardSays(down, floor, { what, target }) {
  const off = Math.round(Math.hypot(target.x - down.way.end.x, target.z - down.way.end.z));
  return `Go down to the floor and walk it toward ${what}. ${wayDownSays(down)} ${floorWalkSays(floor, { along: `on the straight line toward it (${off} blocks from the foot of the way down)` })}` +
    `${backUpSays(down, target.y, what)}`;
}

// Whether food is why the bot is going back: hungry, with nothing to eat
// or the return for food chosen.
function foodReason(bot, goal) {
  if ((bot.food ?? 20) >= 18) return false;
  const { hasFood } = require('./mob-policy');
  return !hasFood(bot) || [goal.survivalAction?.action, goal.step?.action, goal.lastStruggleStep?.action].includes('return_for_food');
}

// Where the stalled Nether work was going: a portal on the way back, a
// fortress leg or the bricks seen, the tunnel's target; with the food trip,
// the nearest Nether portal known.
function legTarget(bot, goal) {
  const steps = [goal.step, goal.lastStruggleStep].filter(Boolean);
  for (const s of steps) {
    const p = s.portal || s.target || s.found;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      const portal = !!s.portal || /portal/.test(s.action || '');
      return { at: new Vec3(p.x, p.y ?? bot.entity.position.y, p.z), what: portal ? 'the portal back' : s.action === 'find_fortress' ? 'the fortress search\'s leg' : 'where the work was going', portal };
    }
  }
  const t = goal.fortressSearch?.target;
  if (t) return { at: new Vec3(t.x, t.y, t.z), what: 'the fortress search\'s leg', portal: false };
  if (foodReason(bot, goal)) {
    const here = bot.entity.position;
    const p = (goal.portals || []).filter(q => q.dimension === 'nether').sort((a, b) => flat(a, here) - flat(b, here))[0];
    if (p) return { at: new Vec3(p.x, p.y, p.z), what: 'the portal back', portal: true };
  }
  return null;
}

// Hoglins known: in view now within thirty-two blocks, and seen earlier
// (sightings.js), with the nearest.
function hoglinsKnown(bot, goal) {
  const here = bot.entity.position;
  const inView = Object.values(bot.entities || {}).filter(e => e.name === 'hoglin' && e.isValid !== false && e.position && e.position.distanceTo(here) <= 32)
    .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
  const seen = require('./sightings').sighted(bot, goal, 'hoglin').filter(s => s.distance > 32 && s.distance <= 192);
  return { inView, seen };
}

// The hoglin as food: what it drops and what one costs to kill, from the
// game's numbers (combat-estimate.js), and whether health comes back.
function hoglinSays(bot, known) {
  const { fightEstimate } = require('./combat-estimate');
  const { defenseWeapon } = require('./combat');
  const nearest = known.inView[0];
  const weapon = defenseWeapon(bot)?.name || null, armour = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
  const one = fightEstimate({ threats: [{ name: 'hoglin', distance: nearest ? nearest.position.distanceTo(bot.entity.position) : 8, visible: true }], armour, weapon, health: bot.health,
    shield: bot.inventory?.slots?.[45]?.name === 'shield' }).fightHere;
  const where = nearest ? `${known.inView.length} in view within thirty-two blocks, the nearest ${Math.round(nearest.position.distanceTo(bot.entity.position))} blocks off`
    : `none in view; ${known.seen[0].says}`;
  const others = require('./danger').threats(bot, 32).filter(t => t.entity.name !== 'hoglin');
  const crowd = others.length ? ` Also within thirty-two blocks: ${[...new Set(others.map(t => t.entity.name.replaceAll('_', ' ')))].slice(0, 5).join(', ')}.` : '';
  return `Hunt a hoglin for its meat (${where}): each drops two to four raw porkchops, safe to eat raw at three hunger each, eight cooked. ` +
    `A hoglin has forty health and hits for about six, throwing the bot about three blocks, off an edge if there is one beside it. ` +
    `One with ${weapon ? `the ${weapon.replaceAll('_', ' ')}` : 'bare hands'}: about ${one.seconds} seconds and ${one.damageTaken} damage, from ${Math.round(bot.health ?? 20)} health. ` +
    `Two minutes, and six health lost ends it.${(bot.food ?? 20) < 18 ? ` Health does not come back meanwhile: hunger ${bot.food}.` : ''}${crowd}`;
}

// The Overworld side of a portal built here: the game puts it at the
// Nether's x and z times eight, and links to a portal of its own there
// within 128 blocks instead of building one.
function portalHereSays(bot, goal) {
  const here = bot.entity.position;
  const x = Math.round(here.x * 8), z = Math.round(here.z * 8);
  const home = (goal.portals || []).filter(p => p.dimension === 'overworld').sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  const far = home && Math.round(Math.hypot(home.x - x, home.z - z));
  const lighter = countOf(bot, 'flint_and_steel') ? 'flint and steel' : 'a fire charge';
  const supports = require('./build-sites').portalSupports(bot).count;
  return `Build a portal here from the obsidian carried (${countOf(bot, 'obsidian')}; a frame without its corners takes ten) and light it with ${lighter}, with three ordinary blocks to stand the lintel on while it goes up (${supports} carried), then go through. ` +
    `It comes out in the Overworld near ${x}, ${z}${home ? `, ${far} blocks from the portal the bot came through${far <= 128 ? ', close enough that the game links to that one' : ': a new place, with a new portal there'}` : ''}.`;
}

// The stalled Nether work's answers beside "another way" (work.js
// answerStall): each only where it can help, with what it needs. mid-211-c
// was offered "another way" and "mine nearby" 1,546 times, 250 blocks from
// its portal and short of food, and mined nearby 907 times (note 241); and
// mid-215-d's fortress search took "another way", the one detour, without
// asking, again and again (note 251).
function netherAnswers(bot, task, goal, save, { survival, actions = {} } = {}) {
  if (!inNether(bot) || !bot.entity?.position) return {};
  const answers = {};
  const target = legTarget(bot, goal);
  if (target && typeof bot.blockAt === 'function') {
    const survey = surveyCrossing(bot, target.at, { cells: CROSS_STRETCH });
    if (survey.cells && survey.gain >= 1 && !crossingResting(bot, goal, target.at)) answers.cross_toward = { target: target.at, description: crossingSays(survey, `${target.what}, ${Math.round(flat(target.at, bot.entity.position))} blocks off${Math.abs(target.at.y - bot.entity.position.y) >= 4 ? ` and ${Math.abs(Math.round(target.at.y - bot.entity.position.y))} blocks ${target.at.y > bot.entity.position.y ? 'up' : 'down'}` : ''}`),
      run: async () => {
        // The leg goes on from where the crossing ends, not a new one.
        if (!target.portal && goal.fortressSearch && !goal.fortressSearch.target) goal.fortressSearch.target = { x: target.at.x, y: target.at.y, z: target.at.z };
        await crossToward(bot, task, goal, save, target.at, { what: target.what });
      } };
    // Down to the floor and along it toward the same target, where the
    // ground below is walkable and a way down is found (note 568).
    const down = !isSetAside(goal, 'floor_toward', floorKey(bot, target.at)) && actions.navigate ? floorWay(bot) : null;
    const floor = down && floorToward(bot, down, target.at);
    if (floor && floor.floor >= FLOOR_WALKABLE) answers.floor_toward = { target: target.at, description: floorTowardSays(down, floor, { what: target.what, target: target.at }),
      run: async () => {
        if (!target.portal && goal.fortressSearch && !goal.fortressSearch.target) goal.fortressSearch.target = { x: target.at.x, y: down.y, z: target.at.z };
        await walkFloorToward(bot, task, goal, save, target.at, down, actions.navigate);
      } };
  }
  const food = foodReason(bot, goal);
  if (food && survival?.foodHunt) {
    const known = hoglinsKnown(bot, goal);
    if (known.inView.length || known.seen.length) answers.hoglin_food = { description: hoglinSays(bot, known),
      run: async () => {
        if (!known.inView.length && actions.navigate) await require('./sightings').walkToSighting(bot, task, goal, save, 'hoglin', known.seen[0], actions.navigate);
        survival.foodHunt(goal, save, 'hoglin');
      } };
  }
  const returning = food || !!target?.portal;
  const lighter = countOf(bot, 'flint_and_steel') + countOf(bot, 'fire_charge') > 0;
  if (returning && countOf(bot, 'obsidian') >= 10 && lighter && require('./build-sites').portalSupports(bot).count >= 3 && actions.portalHere && !isSetAside(goal, 'portal_here', 'nether'))
    answers.portal_here = { description: portalHereSays(bot, goal),
      run: async () => {
        try { for (let i = 0; i < 4; i++) { task.check(); if (await actions.portalHere(bot, task, goal, save)) return; } }
        catch (err) { task.check(); if (!retryable(err)) throw err; setAside(goal, 'portal_here', 'nether', err, 600000); save(); }
      } };
  if (food && !isSetAside(goal, 'nether_return', 'food')) {
    const { foodSupply } = require('./foraging');
    const points = foodSupply(bot);
    const meals = bot.inventory.items().filter(i => require('./vitals').safeFood(bot, i)).map(i => `${i.count} ${i.name.replaceAll('_', ' ')}`).join(', ');
    const starve = { peaceful: 'no hunger at all', easy: 'starving takes health down to ten and no further', normal: 'starving takes health down to one and no further', hard: 'starving kills' }[String(bot.game?.difficulty || 'normal')] || '';
    answers.keep_on = { description: `Stay in the Nether and go on without the Overworld for twenty minutes: ${points ? `eat what is carried (${meals}, ${points} food points)` : 'nothing edible is carried'}, and go on with the work. Hunger ${bot.food}: health comes back only at eighteen or more${starve ? `, and ${starve}` : ''}. With nothing to eat below eighteen, no fight is started: the blazes wait.`,
      run: async () => {
        setAside(goal, 'nether_return', 'food', 'Jev chose to go on in the Nether without going back for food', 20 * 60000);
        delete goal.stockFood; save();
      } };
  }
  return answers;
}

module.exports = { walkFloorToward, floorKey, floorBelow, wayDown, walkFloor, floorWay, goDown, floorToward, floorTowardSays, floorWalkSays, wayDownSays, backUpSays, headingColumns, lineColumns, FLOOR_WALKABLE, LAY_CELL_SECONDS, WALK_SPEED, crossingResting, CROSS_REST_MS, inNether, nearer, crossToward, surveyLeg, legSays, ROCK_CELL_SECONDS, CAVERN_DROP, crossingSays, crossingSeconds, foodReason, legTarget, hoglinsKnown, hoglinSays, portalHereSays, netherAnswers, CROSS_STRETCH };

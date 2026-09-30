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
const blockStock = require('./block-stock');
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
    `${s.carried} blocks carried${s.bridge ? `, ${s.carried - s.bridge} left after` : ''}.${s.bridge ? blockStock.afterSays({ noPickaxe: s.noPickaxe, left: s.carried - s.bridge }) : ''} It ends ${Math.round(s.gain)} blocks nearer, ${Math.round(s.from - s.gain)} from it` +
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
// `beat`: the nearest the bot has come to the target so far (a portal's
// approach record). A stretch that ends no nearer than that walks ground the
// bot has made already, and is not made: the way on from where it stands is
// something else's, and the walk over its own tunnel took it from the work
// the crossing left for the next pass (note 629).
async function crossToward(bot, task, goal, save, target, { what = 'the target', beat = null } = {}) {
  if (!inNether(bot) || typeof bot.blockAt !== 'function') return { tried: false };
  if (crossingResting(bot, goal, target)) return { tried: false, resting: true };
  const survey = surveyCrossing(bot, target, { cells: CROSS_STRETCH });
  if (!survey.cells || survey.gain < 1) return { tried: false, survey };
  // The span's own check before its first cell, as its offers read it.
  const refused = require('./bridging').spanRefused(bot);
  if (refused) return { tried: false, survey, madeAlready: `a crossing straight at ${what} is not begun: ${refused.says}` };
  if (Number.isFinite(beat) && flat(target, survey.end) >= beat - 1) {
    return { tried: false, survey, madeAlready: `a crossing straight at ${what} would go ${survey.cells} blocks and end ${Math.round(flat(target, survey.end))} blocks from it, no nearer than the ${Math.round(beat)} the bot has already come` };
  }
  goal.step = { action: 'cross_toward', what, target: { x: Math.round(target.x), y: Math.round(target.y), z: Math.round(target.z) },
    cells: survey.cells, dig: survey.dig, bridge: survey.bridge, carried: survey.carried }; save();
  // The crossing lays and digs its own way, not by the walk: gold beside
  // where it starts is looked for first, as a walk looks (note 653).
  try { await require('./opportunistic-mining').mineInPassing(bot, task, goal, save, { navigate: require('./skills').navigate, dig: require('./work').dig }, task.opportunityClient || null); }
  catch (err) { task.check(); if (!retryable(err)) throw err; }
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
// Only where the blocks' own dig times are not known (note 677): that one
// trial's netherrack by hand was said of every leg, basalt at twelve and a
// half seconds a cell by hand and netherrack at a third of a second with a
// pickaxe alike.
const ROCK_CELL_SECONDS = 6;
// A cell's dig by the blocks in it and the cheapest tool carried for each.
function cellDigSeconds(bot, blocks) {
  let s = 0;
  for (const b of blocks) {
    if (!b || passable(b)) continue;
    if (typeof b.digTime !== 'function') { s += ROCK_CELL_SECONDS / 2; continue; }
    let tool = null; try { tool = require('./skills').cheapestTool?.(bot, b) || null; } catch (_) { tool = null; }
    try { s += b.digTime(tool?.type ?? null, false, false, false, [], {}) / 1000; } catch (_) { s += ROCK_CELL_SECONDS / 2; }
  }
  return s;
}
// Open air over a drop this deep is a cavern or the lava sea's edge, where a
// fortress is seen from afar (its bricks are found within 128 blocks).
const CAVERN_DROP = 4;
const passable = b => !b || b.boundingBox === 'empty';
// Whether a cell of rock may be dug by the rule every dig keeps (no lava or
// water behind it). Required when used: tunneling.js reaches this module.
const safeDig = (bot, p) => require('./tunneling').safeExcavation(bot, p);
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
  const out = { cells: 0, open: 0, rock: 0, cavern: 0, lay: 0, carried, noPickaxe: !require('./block-stock').pickaxeCarried(bot), runsOut: null, reach: 0, reachSeconds: null, stoppedBy: null, stoppedAt: null, first: [], stepped: 0, laid: 0 };
  let here = from || bot.entity.position.floored(), seconds = 0;
  const y0 = here.y;
  // The first cells as runs of what they are (rock, floor, no floor):
  // what the leg meets before anything else, said with it (legSays).
  const note = kind => { if (out.cells >= FIRST_CELLS) return; const last = out.first.at(-1); if (last?.kind === kind) last.n++; else out.first.push({ kind, n: 1 }); };
  const solid = b => !!b && b.boundingBox === 'block' && !/lava|fire/.test(b.name || '');
  const clear = b => !!b && passable(b) && !/lava|fire|water/.test(b.name || '');
  // A floor the bot laid itself (a span, a pillar's top): its own way.
  let laidAt = null;
  try { laidAt = require('./own-blocks').laidAt; } catch (_) { laidAt = null; }
  const own = p => { try { return !!laidAt?.(bot, p); } catch (_) { return false; } };
  // The walk takes a step of one block up or down where the ground does,
  // and the leg is walked (the pathfinder first): its line follows the
  // ground within a block of the height it starts at. Read at that height
  // alone, mid-242-gb's own span a block below or above its feet was "rock
  // to dig" or "no floor, 90 blocks to lay", and it walked the one span
  // four times, its blocks spent (note 680).
  const stepTo = next => {
    // Up: the cell ahead solid, the one over it open with room for the
    // head, and room over the head where the bot stands.
    if (here.y + 1 <= y0 + 1 && solid(bot.blockAt(next)) && clear(bot.blockAt(next.offset(0, 1, 0))) && clear(bot.blockAt(next.offset(0, 2, 0))) && clear(bot.blockAt(here.offset(0, 2, 0)))) return next.offset(0, 1, 0);
    // Down: the cell ahead open with no floor, the one under it open and
    // floored.
    const under = next.offset(0, -1, 0);
    if (here.y - 1 >= y0 - 1 && clear(bot.blockAt(next)) && clear(bot.blockAt(next.offset(0, 1, 0))) && clear(bot.blockAt(under)) && solid(bot.blockAt(under.offset(0, -1, 0)))) return under;
    return null;
  };
  for (let n = 0; n < cells; n++) {
    const next = here.offset(dx, 0, dz);
    const level = [next, next.offset(0, 1, 0)].map(p => bot.blockAt(p));
    const levelWalks = level.every(b => b && passable(b) && !/lava|fire/.test(b.name || '')) && solid(bot.blockAt(next.offset(0, -1, 0)));
    const step = levelWalks || level.some(b => !b) ? null : stepTo(next);
    if (step) {
      note('floor'); out.open++; out.stepped++; seconds += 1 / WALK_SPEED;
      if (own(step.offset(0, -1, 0))) out.laid++;
      if (out.runsOut === null) out.reach++;
      out.cells++; here = step;
      continue;
    }
    const body = level;
    if (body.some(b => !b)) { out.stoppedBy = 'unloaded ground'; out.stoppedAt = out.cells; break; }
    if (body.some(b => /lava|fire/.test(b.name || ''))) { out.stoppedBy = 'lava in the way'; out.stoppedAt = out.cells; break; }
    // Rock with lava or water behind it is not dug, by the rule every dig
    // keeps (tunneling.js safeExcavation): the leg stops there. Counted as
    // rock to dig, mid-244-ab-nether-2's legs from a pocket over the lava
    // sea were offered ninety-six blocks long and each ended at once, "lava
    // or water behind the netherrack" (note 572).
    const walled = [next, next.offset(0, 1, 0)].find((p, k) => !passable(body[k]) && !safeDig(bot, p));
    if (walled) { out.stoppedBy = `${String(bot.blockAt(walled)?.name || 'rock').replaceAll('_', ' ')} with lava or water behind it (not dug)`; out.stoppedAt = out.cells; break; }
    // With no pickaxe the leg digs its rock by hand at the game's times
    // (hand-dig.js: basalt 6.25 s, blackstone 7.5, bricks 10), dropping
    // nothing; only a block that does not break at all (bedrock) stops it.
    // Notes 687 and 692 stopped it at basalt, blackstone and bricks as
    // blocks "no hand digs" (note 705).
    const hard = out.noPickaxe ? body.find(b => !passable(b) && !require('./block-stock').handDigs(bot, b)) : null;
    if (hard) { out.stoppedBy = `${String(hard.name || 'rock').replaceAll('_', ' ')}, which does not break`; out.stoppedAt = out.cells; break; }
    if (body.some(b => !passable(b))) { note('rock'); out.rock++; out.rockBlocks = (out.rockBlocks || 0) + body.filter(b => !passable(b)).length; const dig = cellDigSeconds(bot, body); out.rockSeconds = (out.rockSeconds || 0) + dig; seconds += dig; }
    else {
      out.open++;
      const floor = bot.blockAt(next.offset(0, -1, 0));
      if (floor && floor.boundingBox === 'block') { note('floor'); seconds += 1 / WALK_SPEED; if (own(next.offset(0, -1, 0))) out.laid++; }
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
  out.end = { x: here.x, y: here.y, z: here.z };
  return out;
}

// The walk a leg takes first: the pathfinder toward its end (the legs are
// "walked by the pathfinder first, then straight across where the walk gives
// out"). Said beside the line's cells, which are read at this height from
// this cell: 25584 (mid-244-gg, 16:49Z on 2026-09-30) was told leg_east was
// "64 of rock to dig ... about 256 seconds", and the pathfinder took it 58
// blocks back along its own span in 17 seconds; then leg_west back, then the
// search's leg_north walked east again first, three crossings of the same
// sixty blocks (note 751b). `state` is the search's coverage, for the steps
// on ground stood on before. '' where no pathfinder is at hand.
const LEG_WALK_SURVEY_MS = 500;
async function legWalkSays(bot, task, target, { state = null, keep = null, i = null } = {}) {
  if (!bot.pathfinder?.movements || !(bot.pathfinder.getPathFromTo || bot.pathfinder.getPathTo)) return '';
  const { goals } = require('mineflayer-pathfinder');
  let route = null;
  try { route = await require('./skills').surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalNearXZ(target.x, target.z, 8), LEG_WALK_SURVEY_MS); }
  catch (err) { task.check(); if (!retryable(err)) throw err; return ''; }
  const path = route?.path || [];
  if (path.length < 2) return ' The pathfinder finds no walk on foot from here: the leg goes straight along the line as said.';
  const here = bot.entity.position, end = path.at(-1);
  if (keep && i !== null) keep[i] = { x: end.x, y: end.y, z: end.z };
  const gain = Math.round(flat(target, here) - flat(target, end));
  const coverage = require('./nether-coverage'), dim = coverage.dimOf(bot);
  const stood = state ? path.filter(n => coverage.stoodAt(state, dim, n.x, n.z)).length : 0;
  const placed = path.reduce((n, q) => n + (q.toPlace?.length || 0), 0), dug = path.reduce((n, q) => n + (q.toBreak?.length || 0), 0);
  const seconds = Math.round(path.length / WALK_SPEED + placed * LAY_CELL_SECONDS + dug * ROCK_CELL_SECONDS / 2);
  const reaches = route.status === 'success';
  const work = [placed && `laying ${placed} block${placed === 1 ? '' : 's'}`, dug && `digging ${dug}`].filter(Boolean).join(' and ');
  const back = stood * 2 >= path.length ? `, a walk back over ground already walked and looked from` : '';
  return ` Walked first by the pathfinder, before any digging: its route ${reaches ? 'reaches the leg\'s end' : gain >= 1 ? `goes ${gain} blocks nearer the leg's end, to (${Math.round(end.x)}, ${Math.round(end.y)}, ${Math.round(end.z)})` : 'makes no ground toward the leg\'s end'} in ${path.length} steps${work ? `, ${work}` : ''}, about ${seconds} seconds, ${stood} of them on ground the bot has stood on before${back}; ${reaches ? 'the line\'s cells said here are dug only where that walk fails' : 'from where it ends the leg goes straight on'}.`;
}

// The leg as a fact: what is open, what is rock and about how long, that
// nothing is seen from inside the rock, and the blocks it needs laid
// against the blocks carried.
function legSays(survey, { direction, length, y }) {
  if (!survey) return `Go ${direction} ${length} blocks at y ${y}. Not surveyed from here.`;
  const parts = [];
  if (survey.open) parts.push(`${survey.open} of open air${survey.cavern ? ` (${survey.cavern} of them over a drop of four or more: a cavern or the lava sea's edge, where a fortress is seen from afar)` : ''}`);
  if (survey.rock) parts.push(`${survey.rock} of rock to dig (about ${Math.round((survey.rockSeconds ?? survey.rock * ROCK_CELL_SECONDS) / survey.rock * 10) / 10} seconds a cell ${survey.noPickaxe ? 'by hand, no pickaxe carried, dropping nothing' : 'with the pickaxe carried'}, and nothing is seen from inside it)`);
  const stop = survey.stoppedBy ? ` ${survey.stoppedBy[0].toUpperCase()}${survey.stoppedBy.slice(1)} stops it at cell ${survey.stoppedAt}.` : '';
  const lay = survey.lay || 0, carried = survey.carried ?? 0, short = Number.isInteger(survey.runsOut);
  const blocks = !lay ? '' : ` ${lay} of the open cells have no floor: it needs ${lay} block${lay === 1 ? '' : 's'} laid, crouched, about ${Math.round(LAY_CELL_SECONDS * 10) / 10} seconds a cell, ${carried} carried: ` +
    (short ? `the blocks run out at cell ${survey.runsOut}, about ${survey.reachSeconds} seconds in, where the leg stops with none to lay.` : `${carried - lay} left after.`) + blockStock.afterSays({ noPickaxe: survey.noPickaxe, left: short ? 0 : carried - lay });
  const steps = survey.stepped ? ` It steps a block up or down ${survey.stepped} time${survey.stepped === 1 ? '' : 's'} where the ground does.` : '';
  const laid = survey.laid ? ` ${survey.laid} of its cells are on blocks the bot laid itself: its own span, walked before.` : '';
  // Short of blocks, said first as what it is (note 751c): 25593 took
  // leg_north with 88 blocks for 96 cells of open air, "about 131 seconds
  // with the blocks for all of it", and ran out at cell 88.
  const cannot = short ? `It needs ${lay} blocks laid and ${carried} ${carried === 1 ? 'is' : 'are'} carried: it cannot be done with what is carried, and stops at cell ${survey.runsOut} with none to lay. ` : '';
  return `${cannot}Go ${direction} ${length} blocks at y ${y}: of the ${survey.cells} cells ahead, ${parts.join(' and ') || 'none open'}; about ${survey.seconds} seconds${short ? ' with the blocks for all of it' : ''}.${blocks}${stop}${steps}${laid}${firstSays(survey)}`;
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
  const out = { cells: 0, floor: 0, lava: 0, gap: 0, rise: 0, climb: 0, drops: 0, damage: 0, rock: 0, lay: 0, soul: 0, magma: 0, carried, runsOut: null, seconds: 0, stoppedBy: null, stoppedAt: null, mobs: {}, mobsPrice: '', lowest: from.y, highest: from.y, first: [] };
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
  const near = [];
  for (const e of Object.values(bot.entities || {})) {
    if (!NETHER_MOBS.test(e?.name || '') || e.isValid === false || !e.position) continue;
    if (walked.some(p => Math.hypot(e.position.x - p.x - 0.5, e.position.z - p.z - 0.5) <= 8 && Math.abs(e.position.y - p.y) <= 8)) { out.mobs[e.name] = (out.mobs[e.name] || 0) + 1; near.push(e); }
  }
  out.mobsPrice = mobsPriceSays(bot, near);
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
// What the mobs listed by a way cost if they all came at the bot on it, at the
// health it has, and whether health comes back after. mid-208-k-nether-3-
// fortress-6 (25587) chose the way down to the floor at 10 health told only
// "By the floor that way: 2 hoglins" (its state said that fighting all the
// mobs about was 43 damage), was struck by both at the foot of it, 10 to 5.9,
// and then 1.9, and died (note 626).
function mobsPriceSays(bot, mobs) {
  if (!mobs?.length) return '';
  try {
    const { fightEstimate } = require('./combat-estimate'), { defenseWeapon, shooter } = require('./combat');
    const armour = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
    const fight = fightEstimate({ threats: mobs.slice(0, 8).map(e => ({ name: e.name, distance: 2, shoots: !!shooter(e), visible: true })), armour,
      weapon: defenseWeapon(bot)?.name || null, health: bot.health ?? 20, shield: bot.inventory?.slots?.[45]?.name === 'shield' }).fightHere;
    const r = n => Math.round(n * 10) / 10, health = r(bot.health ?? 20);
    const heals = (bot.food ?? 20) < 18 && !(bot.inventory?.items?.() || []).some(i => { try { return require('./vitals').safeFood?.(bot, i); } catch (_) { return false; } });
    return ` If ${mobs.length === 1 ? 'it' : 'they all'} came at the bot on that way, fighting ${mobs.length === 1 ? 'it' : 'them'} is about ${r(fight.damageTaken)} damage from ${health} health${fight.healthAfter <= 0 ? ' (more than the bot has)' : ''}${heals ? `; nothing carried is food and hunger ${bot.food} is under eighteen, so none of that health comes back` : ''}.`;
  } catch (_) { return ''; }
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
    ` ${mobs.length ? `By the floor that way: ${mobs.join(', ')}.${f.mobsPrice || ''}` : 'No mobs are known by the floor that way.'}`;
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
// The pathfinder as the way down walks it: its drops allowed as deep as the
// way's deepest and the rock of its steps let dug, for `fn`'s while. The
// walk down and its survey before it is offered (downRoute) share it.
async function withDownMovements(bot, down, fn) {
  const m = bot.pathfinder?.movements;
  const kept = m ? { maxDropDown: m.maxDropDown } : null, freed = [];
  if (m) {
    m.maxDropDown = Math.max(m.maxDropDown ?? 3, down.maxDrop ?? down.way?.maxDrop ?? 0);
    if ((down.dug ?? down.way?.dug) && m.blocksCantBreak?.delete) for (const [name, b] of Object.entries(bot.registry?.blocksByName || {})) if (NATURAL_ROCK.test(name) && m.blocksCantBreak.has(b.id)) { m.blocksCantBreak.delete(b.id); freed.push(b.id); }
  }
  try { return await fn(m); }
  finally { if (m) { m.maxDropDown = kept.maxDropDown; for (const id of freed) m.blocksCantBreak.add(id); } }
}
const downEnd = down => down.end || down.way?.end || down;
// Whether the pathfinder finds the way down's walk from here, as goDown
// will ask it: the check the floor way is offered by (note 695). 25591's
// floor_to_2 was offered from the survey of the ground alone and ended
// "no route" in its first 30 ms. -> { found, why } (found null: not
// surveyed, no pathfinder).
async function downRoute(bot, task, down, timeoutMs = 1500) {
  if (!bot.pathfinder?.movements || !(bot.pathfinder.getPathFromTo || bot.pathfinder.getPathTo)) return { found: null };
  const end = downEnd(down);
  const { goals } = require('mineflayer-pathfinder');
  let route = null;
  try { route = await withDownMovements(bot, down, m => require('./skills').surveyRoute(bot, task, m, new goals.GoalNear(end.x, end.y, end.z, 1), timeoutMs)); }
  catch (err) { task.check(); if (!retryable(err)) throw err; return { found: null }; }
  if (route?.status === 'success') return { found: true };
  // Out of time is not no route: the walk itself has a minute.
  if (route?.status !== 'noPath') return { found: null };
  return { found: false, why: `the pathfinder finds no route to the foot of the way down at (${Math.round(end.x)}, ${Math.round(end.y)}, ${Math.round(end.z)})` };
}
async function goDown(bot, task, down, navigate) {
  const end = downEnd(down), floorY = down.floorY ?? down.y;
  const cells = new Set((down.path || down.way?.path || []).map(p => `${p.x},${p.y},${p.z}`));
  let why = null;
  await withDownMovements(bot, down, async () => {
    try {
      const { goals } = require('mineflayer-pathfinder');
      await navigate(bot, task, new goals.GoalNear(end.x, end.y, end.z, 1), { timeoutMs: 60000, stallMs: 8000, passing: true, besideLava: n => cells.has(`${n.x},${n.y},${n.z}`) });
    } catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
  });
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
    try { await navigate(bot, task, new goals.GoalNearXZ(here.x + (target.x - here.x) * step, here.z + (target.z - here.z) * step, 4), { timeoutMs: 30000, stallMs: 8000, passing: true }); }
    catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
  }
  const lower = before.y - bot.entity.position.y >= 2, nearer = flat(target, before) - flat(target, bot.entity.position) >= 1;
  if (!lower && !nearer) { setAside(goal, 'floor_toward', key, why || 'it came no lower and no nearer', CROSS_REST_MS); save(); }
  return { reached: done.reached, lower, nearer, why };
}
function floorTowardSays(down, floor, { what, target }) {
  const off = Math.round(Math.hypot(target.x - down.way.end.x, target.z - down.way.end.z));
  // Where the foot lies against where the bot stands: the way down is the
  // one found, whichever way it goes. mid-242-ah-nether-1-fortress-5's way
  // down "toward the portal back", 99 blocks off, ended 158 from it, and
  // the trip back for food at 1.1 health was left there (note 622).
  const here = down.from ? Math.round(Math.hypot(target.x - down.from.x, target.z - down.from.z)) : null;
  const versus = here === null || Math.abs(off - here) < 2 ? '' : off > here
    ? `: the way down ends ${off - here} blocks farther from ${what} than the bot stands now, ${here} off`
    : `, ${here - off} nearer than where the bot stands now`;
  return `Go down to the floor and walk it toward ${what}. ${wayDownSays(down)} ${floorWalkSays(floor, { along: `on the straight line toward it (${off} blocks from the foot of the way down${versus})` })}` +
    `${backUpSays(down, target.y, what)}`;
}

// Jev's choice to go on in the Nether without the trip back for food
// (keep_on, twenty minutes), kept with the health it was made at and said
// where the trip is offered again. The trip used to be left out for those
// twenty minutes whatever came after: mid-242-ba-fortress-1 kept on at 10.1
// health, was at 2.2 forty seconds later, and its pocket's way to food
// offered only a hoglin 123 blocks off (note 607).
const KEEP_ON_WHY = 'Jev chose to go on in the Nether without going back for food';
// What going on without food does to the fights, as it is (note 708):
// under hunger 18 with nothing to eat the hunt goes looking for no blaze
// (mob-hunt.js prepareMobHunt: the search goes on instead), but a blaze in
// reach is still the hunt's claim and its fight is asked. "No fight is
// started" was said, and 25591 chose keep_on and said "I'm going after a
// blaze" in the same second.
function keepOnFightSays(bot) {
  let fed = true; try { fed = (bot.food ?? 20) >= 18 || require('./foraging').foodSupply(bot) > 0; } catch (_) { fed = true; }
  return fed ? 'Fights go on as they come.' : 'The hunt goes looking for no blaze meanwhile (the search goes on), but a blaze met in reach is still offered as a fight.';
}
const keepOnWhy = bot => `${KEEP_ON_WHY}, at ${Math.round((bot.health ?? 20) * 10) / 10} health and hunger ${bot.food}`;
function keepOnSays(bot, goal, now = Date.now()) {
  const { attemptsFor, keyOf } = require('./progress');
  const e = attemptsFor(goal).entries[keyOf('nether_return', 'food')];
  if (!e || !(e.until > now)) return '';
  const m = Math.round((now - e.at) / 60000), at = /at ([\d.]+) health/.exec(e.why || '')?.[1];
  return ` Jev chose ${m ? `${m} minute${m === 1 ? '' : 's'} ago` : 'under a minute ago'}${at ? `, at ${at} health,` : ''} to go on in the Nether without this trip for twenty minutes; health is ${Math.round((bot.health ?? 20) * 10) / 10} now.`;
}

// The trip back for food Jev chose and that is what has stopped here: what the
// options that end it or take it up again do to it. mid-243-ag (25589) chose
// go_back at 3.5 health with the portal 277 blocks off, the crossing stalled
// at a drop, and the stall's answers were gather dirt, gather cobblestone and
// keep_on: none good came first each time (0.33, 0.39, 0.41), the best listed
// was taken, and that was keep_on, which dropped the trip. Its words said
// "go on without the Overworld for twenty minutes" and nothing of the trip
// they ended (note 626).
function standingTripSays(bot, goal, option, now = Date.now()) {
  const held = goal?.leaveNether;
  if (!held || held.reason !== 'food' || held.pick !== 'go_back' || !(now - held.at < 30 * 60000)) return '';
  const m = Math.round((now - held.at) / 60000), ago = m ? `${m} minute${m === 1 ? '' : 's'} ago` : 'under a minute ago';
  let far = null; try { far = require('./game-progress').portalDistance(bot, goal); } catch (_) { far = null; }
  const off = Number.isFinite(far) ? `, ${far} blocks from the portal` : '';
  return option === 'keep_on'
    ? ` It ends the trip back for food that Jev chose ${ago} and that has stopped here${off}: the walk home is given up, not stalled.`
    : ` The trip back for food that Jev chose ${ago} is the walk that has stopped here${off}; this tries the walk again from here, at ${Math.round((bot.health ?? 20) * 10) / 10} health.`;
}

// The trip back for food chosen: held as leave_nether's go_back is (game-
// progress.js netherLeaveHeld), so the walk back goes on across passes, and
// the keep-on it replaces is ended.
function chooseReturnForFood(goal, now = Date.now()) {
  require('./progress').attemptsFor(goal).clear('nether_return', 'food');
  goal.leaveNether = { reason: 'food', pick: 'go_back', until: 0, at: now };
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
// the nearest Nether portal known. Standing on or among a found fortress's
// own bricks (state.inFortressSince) is arrival, not a leg still under way:
// find_fortress's own `found` there is the nearest brick to wherever the
// bot already stands, so offering it as a "leg" is a crossing to itself.
// 25583 (mid-242-vh, 08:57-09:02Z) was offered "cross_toward: the fortress
// search's leg, 3 blocks off" four times while inside its fortress with
// blazes near, and 25590 and 25588 (~09:00Z) stalled on a "leg" whose own
// target was, in fact, wherever they were already standing (note 739b).
function legTarget(bot, goal) {
  const arrived = !!goal.fortressSearch?.inFortressSince;
  const steps = [goal.step, goal.lastStruggleStep].filter(Boolean);
  for (const s of steps) {
    const p = s.portal || s.target || (arrived && s.action === 'find_fortress' ? null : s.found);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      const portal = !!s.portal || /portal/.test(s.action || '');
      return { at: new Vec3(p.x, p.y ?? bot.entity.position.y, p.z), what: portal ? 'the portal back' : s.action === 'find_fortress' ? 'the fortress search\'s leg' : s.action === 'nether_gather' && s.what ? s.what : 'where the work was going', portal };
    }
  }
  const t = !arrived && goal.fortressSearch?.target;
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
  const all = require('./sightings').sighted(bot, goal, 'hoglin').filter(s => s.distance > 32 && s.distance <= 192);
  // A place the walk to found no way to rests five minutes (nether-food.js
  // huntHoglin): the hoglin there is seen again from afar at the next look,
  // and on 25598 the hunt was chosen at it and failed the same way eight
  // times in five minutes (note 682). Said, not hidden.
  const now = Date.now(), resting = (goal?.netherFood?.noWay || []).filter(w => w.until > now);
  const noWayAt = s => resting.find(w => Math.hypot(w.x - s.x, w.z - s.z) <= 24);
  const seen = all.filter(s => !noWayAt(s));
  const noWay = all.filter(s => noWayAt(s)).map(s => ({ ...s, walk: noWayAt(s) }));
  return { inView, seen, noWay };
}

// One hoglin fought at the health the bot has, from the game's numbers
// (combat-estimate.js): the fight's seconds and damage, and its blows
// through the armour worn. Whether the hunt can be won at all is said, not
// left to be worked out: mid-242-ba-fortress-1, at 2.2 health with nothing
// to eat, was told "about 12.6 seconds and 17.2 damage, from 2 health" and
// "six health lost ends it", and chose the hunt (note 607).
function hoglinFight(bot, distance = 8) {
  const { fightEstimate, MOBS, afterArmour, armourOf } = require('./combat-estimate');
  const { defenseWeapon } = require('./combat');
  const weapon = defenseWeapon(bot)?.name || null, armour = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
  const one = fightEstimate({ threats: [{ name: 'hoglin', distance, visible: true }], armour, weapon, health: bot.health,
    shield: bot.inventory?.slots?.[45]?.name === 'shield' }).fightHere;
  const worn = armourOf(armour), r = n => Math.round(n * 10) / 10, health = r(bot.health ?? 20);
  const least = r(afterArmour(MOBS.hoglin.least, worn)), most = r(afterArmour(MOBS.hoglin.most, worn));
  const verdict = one.damageTaken >= health
    ? `more than the ${health} health left: at this health the bot is dead before the hoglin is`
    : one.damageTaken >= health / 2 ? `leaving about ${r(health - one.damageTaken)} of the ${health} health` : `leaving about ${r(health - one.damageTaken)} health`;
  const blows = least >= health ? `its weakest blow through the armour worn, about ${least}, is as much as the health left: one blow ends the bot`
    : most >= health ? `a blow is ${least} to ${most} through the armour worn: one of its harder blows ends the bot` : `a blow is ${least} to ${most} through the armour worn`;
  return { weapon, one, health, least, most, lost: one.damageTaken >= health,
    says: `One hoglin with ${weapon ? `the ${weapon.replaceAll('_', ' ')}` : 'bare hands'}: about ${one.seconds} seconds and ${one.damageTaken} damage, ${verdict}; ${blows}.` };
}

// The hunts of a hoglin for its meat that Jev chose (survival.js foodHunt),
// from the flight records of 2026-09-28 (node scripts/nether-trips.js --hunts,
// note 626): none brought meat in 66. The bot walks to where a hoglin was seen
// and finds none within thirty-two blocks (gone), or fights it and is told to
// stop at six health lost (lost).
const HOGLIN_HUNTS = { day: '2026-09-28', started: 66, meat: 0, gone: 61, lost: 5 };

// The hoglin as food: what it drops and what one costs to kill, from the
// game's numbers (combat-estimate.js), and whether health comes back.
function hoglinSays(bot, known) {
  const nearest = known.inView[0];
  const fight = hoglinFight(bot, nearest ? nearest.position.distanceTo(bot.entity.position) : 8);
  const far = known.seen[0]?.distance, { NETHER_TRIPS } = require('./game-progress');
  const walk = !nearest && known.seen[0] ? ` The walk there is about ${Math.round(far / 4.3)} seconds at a walk${far >= NETHER_TRIPS.over ? ` and if nothing stops it (the Nether's walks made ${NETHER_TRIPS.slow} to ${NETHER_TRIPS.fast} blocks a minute over ${NETHER_TRIPS.day}, stops counted: about ${Math.max(1, Math.round(far / NETHER_TRIPS.fast))} to ${Math.max(1, Math.round(far / NETHER_TRIPS.slow))} minutes)` : ''}, at ${fight.health} health, and the hoglin may have moved on.` : '';
  const where = nearest ? `${known.inView.length} in view within thirty-two blocks, the nearest ${Math.round(nearest.position.distanceTo(bot.entity.position))} blocks off`
    : `none in view; ${known.seen[0].says}`;
  const others = require('./danger').threats(bot, 32).filter(t => t.entity.name !== 'hoglin');
  const crowd = others.length ? ` Also within thirty-two blocks: ${[...new Set(others.map(t => t.entity.name.replaceAll('_', ' ')))].slice(0, 5).join(', ')}.` : '';
  const ends = fight.health <= 6 ? `Two minutes, or six health lost, ends the hunt; at ${fight.health} health that six is more than the bot has.` : 'Two minutes, and six health lost ends it.';
  const h = HOGLIN_HUNTS;
  const record = ` How the hunts of a hoglin for its meat went over ${h.day}'s trials in the Nether: ${h.started} begun, ${h.meat} brought meat; ${h.gone} ended at the place a hoglin was seen with none within thirty-two blocks (they move on), ${h.lost} in a fight that took six health.`;
  return `Hunt a hoglin for its meat (${where}): each drops two to four raw porkchops, safe to eat raw at three hunger each, eight cooked. ` +
    `A hoglin has forty health and hits for three to eight before armour, throwing the bot about three blocks, off an edge if there is one beside it. ` +
    `${fight.says}${walk} ${ends}${record}${(bot.food ?? 20) < 18 ? ` Health does not come back meanwhile: hunger ${bot.food}.` : ''}${crowd}`;
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
  // A fortress floor known overhead within a climb's reach: the climb with
  // what is carried, or the blocks dug for it first, as the approach offers
  // it. 25591 stood 15 under its fortress's bricks with 231 blocks and was
  // asked this question five times with only a level crossing, a walk off
  // and working free on offer (note 694).
  if (actions.dig && goal.fortressSearch) {
    const mh = require('./mob-hunt');
    const overhead = mh.fortressOverhead(bot, goal);
    if (overhead) {
      const climb = mh.climbWays(bot, task, goal, save, actions, goal.fortressSearch, overhead);
      for (const [k, o] of Object.entries(mh.climbOffers(climb, overhead, goal.fortressSearch))) answers[k] = { target: o.target, description: o.description, run: async () => { await o.run(); } };
      if (climb.noPillar && answers.cross_toward) answers.cross_toward.description += ` Up to the fortress floor: ${climb.noPillar}.`;
    }
  }
  const food = foodReason(bot, goal);
  if (food && survival?.foodHunt) {
    const known = hoglinsKnown(bot, goal);
    if (known.inView.length || known.seen.length) answers.hoglin_food = { description: hoglinSays(bot, known),
      run: () => require('./nether-food').huntHoglin(bot, task, goal, save, known, { navigate: actions.navigate, survival, method: 'walk' }) };
  }
  const returning = food || !!target?.portal;
  const lighter = countOf(bot, 'flint_and_steel') + countOf(bot, 'fire_charge') > 0;
  if (returning && countOf(bot, 'obsidian') >= 10 && lighter && require('./build-sites').portalSupports(bot).count >= 3 && actions.portalHere && !isSetAside(goal, 'portal_here', 'nether'))
    answers.portal_here = { description: portalHereSays(bot, goal),
      run: async () => {
        try { for (let i = 0; i < 4; i++) { task.check(); if (await actions.portalHere(bot, task, goal, save)) return; } }
        catch (err) { task.check(); if (!retryable(err)) throw err; setAside(goal, 'portal_here', 'nether', err, 600000); save(); }
      } };
  // The trip back for food itself, with its walk and the food over there:
  // mid-235-q-nether-2-fortress-4, at 4 health with nothing to eat and its
  // portal 67 blocks off, was offered a hoglin 47 blocks off and an ore, and
  // answered none good (0.82); the hoglin was taken as the best listed
  // (note 607). Offered while keep_on holds too, said with when it was
  // chosen and at what health.
  let tripClosed = null; try { tripClosed = food ? require('./mob-hunt').tripHomeClosed(bot, goal) : null; } catch (_) { tripClosed = null; }
  if (food && actions.returnOverworld && !tripClosed) {
    let there = ''; try { there = require('./healing').overworldFoodSays(bot, goal) || ''; } catch (_) { there = ''; }
    answers.return_for_food = { description: `Go back through the portal to the Overworld for food, hunted and cooked there, and come back fed. ${require('./game-progress').portalTrip(bot, goal)}${there ? ` ${there}` : ''}${keepOnSays(bot, goal)}${standingTripSays(bot, goal, 'return_for_food')}`,
      run: async () => {
        chooseReturnForFood(goal);
        goal.step = { action: 'return_for_food', health: bot.health, food: bot.food }; goal.stockFood = true; save();
        await actions.returnOverworld(bot, task, goal, save);
      } };
  }
  // Going on without food is not offered where one hit ends the bot and
  // health cannot come back (last-hit.js, note 706).
  if (food && !isSetAside(goal, 'nether_return', 'food') && !require('./last-hit').lastHit(bot)) {
    const { foodSupply } = require('./foraging');
    const points = foodSupply(bot);
    const meals = bot.inventory.items().filter(i => require('./vitals').safeFood(bot, i)).map(i => `${i.count} ${i.name.replaceAll('_', ' ')}`).join(', ');
    const starve = { peaceful: 'no hunger at all', easy: 'starving takes health down to ten and no further', normal: 'starving takes health down to one and no further', hard: 'starving kills' }[String(bot.game?.difficulty || 'normal')] || '';
    answers.keep_on = { description: `Stay in the Nether and go on without the Overworld for twenty minutes: ${points ? `eat what is carried (${meals}, ${points} food points)` : 'nothing edible is carried'}, and go on with the work. Hunger ${bot.food}: health comes back only at eighteen or more${starve ? `, and ${starve}` : ''}. ${keepOnFightSays(bot)}${standingTripSays(bot, goal, 'keep_on')}`,
      run: async () => {
        setAside(goal, 'nether_return', 'food', keepOnWhy(bot), 20 * 60000);
        delete goal.stockFood; save();
      } };
  }
  // Food as a resource of the stay (nether-food.js): the ways to it asked
  // next, each priced, where little is carried or health cannot come back.
  try {
    const restock = require('./nether-food').restockFoodOption(bot, task, goal, save, { actions, survival, client: actions.client });
    if (restock) answers.restock_food = restock;
  } catch (_) { /* no food routes from here */ }
  return answers;
}

module.exports = { legWalkSays, mobsPriceSays, standingTripSays, HOGLIN_HUNTS, walkFloorToward, downRoute, withDownMovements, floorKey, floorBelow, wayDown, walkFloor, floorWay, goDown, floorToward, floorTowardSays, floorWalkSays, wayDownSays, backUpSays, headingColumns, lineColumns, FLOOR_WALKABLE, LAY_CELL_SECONDS, WALK_SPEED, crossingResting, CROSS_REST_MS, inNether, nearer, crossToward, surveyLeg, legSays, ROCK_CELL_SECONDS, CAVERN_DROP, crossingSays, crossingSeconds, foodReason, keepOnWhy, keepOnSays, keepOnFightSays, chooseReturnForFood, legTarget, hoglinsKnown, hoglinFight, hoglinSays, portalHereSays, netherAnswers, CROSS_STRETCH };

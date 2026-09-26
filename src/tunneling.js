'use strict';
const { Vec3 } = require('vec3');
const { opportunisticMining } = require('./opportunistic-mining');
const { opportunisticPickups } = require('./opportunistic-pickups');
const { goals } = require('mineflayer-pathfinder');
const { reservedForConstruction } = require('./build-sites');
const { safeFromHostiles, hostileEntities } = require('./danger');
const { fitToFight } = require('./mob-policy');
const { advance, attemptsFor, setAside, isSetAside } = require('./progress');
const { surveyRoute } = require('./skills');
const { dryPassable: passable, dryBodySpace } = require('./terrain');
const { descendPillar } = require('./pillar-recovery');

const directions = [new Vec3(1, 0, 0), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(0, 0, -1)];
const faces = [...directions, new Vec3(0, 1, 0), new Vec3(0, -1, 0)];
// Natural terrain, plus the blocks the bot lays itself: a dig-in's
// cobblestone across the stairs is not a wall to retreat from, it is
// yesterday's shelter. Registered builds stay protected by reservation.
// Ground as the world makes it. Sandstone was missing, and trial 32's bot
// sat under a beach at y 57 with every step up "sandstone in the way",
// pacing one block and back until the audit called it a loop (2026-09-25):
// deserts, beaches, badlands and caves are made of these too. And leaves:
// trial 56 stood on a jungle canopy at y 79, every step down "jungle leaves
// in the way", and paced on the leaves until the audit called it a loop.
const natural = /^(stone|deepslate|granite|diorite|andesite|tuff|calcite|dripstone_block|pointed_dripstone|smooth_basalt|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|grass_block|mud|clay|moss_block|gravel|sand|red_sand|sandstone|red_sandstone|terracotta|(white|orange|yellow|red|brown|light_gray)_terracotta|snow_block|cobblestone|cobbled_deepslate|netherrack|soul_sand|soul_soil|basalt|blackstone|nether_bricks|nether_brick_fence|nether_brick_stairs|nether_brick_slab|nether_brick_wall|end_stone)$|_ore$|_leaves$/;
const dangerous = block => !block || ['lava', 'water', 'fire', 'magma_block', 'powder_snow'].includes(block.name);
const falling = block => block && (['sand', 'red_sand', 'gravel'].includes(block.name) || block.name.endsWith('_concrete_powder'));

function safeExcavation(bot, p) {
  if (faces.some(f => dangerous(bot.blockAt(p.plus(f))))) return false;
  // Removing a support can drop an entire sand/gravel column and release
  // water that was not adjacent to the original dig cell.
  for (let height = 1; height <= 16; height++) {
    const above = p.offset(0, height, 0), block = bot.blockAt(above);
    if (dangerous(block)) return false;
    if (!falling(block)) return true;
    if (faces.some(f => dangerous(bot.blockAt(above.plus(f))))) return false;
  }
  return false;
}

// A shaft that gains no ground is a shaft that has found a ledge or a wall
// it cannot pass: an hour went by shuffling along one. Forty-eight steps
// without a new best starts over (see tunnelStep).
//
// The best is the closest the shaft has been. It used to be reset to any
// distance within half a block of it, so it crept outward and a bot pacing
// 19, 20, 21, 20, 19 reset the count on every return.
//
// A different destination is a different race: the fortress sweep and the
// approach shaft share this record, and a best of three blocks from an
// approach made every step of the next ninety-six-block leg "not gaining".
// A mob that moves a few blocks is still the same target.
function noteProgress(tunnel, target, gap) {
  if (tunnel.target && Math.hypot(tunnel.target.x - target.x, tunnel.target.y - target.y, tunnel.target.z - target.z) > 8) {
    delete tunnel.best; tunnel.sinceBest = 0;
  }
  tunnel.target = { x: target.x, y: target.y, z: target.z };
  // Ground gained also clears the retreat count. It was counted over the
  // shaft's whole life, so once twenty-four had piled up over hours every
  // dead end was final, however much ground had been made in between.
  const progress = { best: tunnel.best, looks: tunnel.sinceBest };
  if (!advance(progress, gap)) { tunnel.retreats = 0; tunnel.staleRounds = 0; }
  tunnel.best = progress.best; tunnel.sinceBest = progress.looks;
  return tunnel.sinceBest;
}

function claimBlockers(bot) {
  if (!fitToFight(bot)) return false;
  const near = hostileEntities(bot, 24);
  const kinds = [...new Set(near.map(e => e.name))];
  if (!near.length || near.length > 2 || kinds.length !== 1 || kinds[0] === 'creeper') return false;
  bot._huntingEntity = { name: kinds[0], until: Date.now() + 5000, clearingWay: true };
  return true;
}

function stairOptions(bot, goal, target, { approach = false } = {}) {
  // Closing on a mob on purpose. The hostile *is* the destination, so the
  // filter that keeps a travelling shaft clear of mobs rules out every
  // forward cell, and the fallback below then picks whichever direction is
  // furthest from them: the target pulls the bot one way, the safety rule
  // shoves it back the other, and it paces between two blocks forever.
  // That is what the live run did for an hour, six blocks from its blazes.
  // Only the quarry is let off, though: every other mob still counts, or
  // the shaft dug straight into a wither skeleton on its way to a blaze.
  // Hemmed in by those others on every forward cell, it digs on regardless
  // rather than be pushed back.
  if (approach) {
    const quarry = bot._huntingEntity?.name;
    const others = hostileEntities(bot, 64).filter(e => e.name !== quarry && e.position.distanceTo(target) > 2);
    const clear = stairChoices(bot, goal, target, { hostiles: others, approach: true });
    if (clear.length) return clear;
    const toward = stairChoices(bot, goal, target, { hostiles: false, approach: true });
    if (toward.length) return toward;
  }
  const first = stairChoices(bot, goal, target, { hostiles: true });
  // Pinned by a mob it can beat: two skeletons standing nine blocks up the
  // slope in the shade held the way to the surface for ten minutes, every
  // cell toward it "closer to a shooter", at full health in diamond. A pair
  // at most, of one kind and no creeper, and only while fit: they are
  // claimed as the hunt claims its quarry, the steps toward them are open,
  // and the defence layer swings when one is in reach.
  const here = bot.entity.position.floored().distanceTo(target), gains = list => list.some(c => c.destination.distanceTo(target) < here - 0.1);
  if (!gains(first) && first.blocked?.['a hostile'] && claimBlockers(bot)) {
    const through = stairChoices(bot, goal, target, { hostiles: true });
    if (gains(through)) return through;
  }
  if (first.length) return first;
  // Mobs in the cave around a shaft can rule out every direction as
  // unsafe, and the shaft freezes for as long as they stay: the second
  // run stood in its pocket for ten attempts with five mobs around it.
  // Rock is a wall to them too. Dig on, in the direction that gains the
  // most ground from the nearest of them.
  const hostiles = hostileEntities(bot, 24);
  if (!hostiles.length) return first;
  // Surrounded, every direction loses a little ground; the one that loses
  // least is still the way on, and going deeper is ground gained too.
  const nearest = p => Math.min(...hostiles.map(h => h.position.distanceTo(p.offset(0.5, 0, 0.5))));
  return stairChoices(bot, goal, target, { hostiles: false })
    .sort((a, b) => nearest(b.destination) - nearest(a.destination) || a.score - b.score);
}

function stairChoices(bot, goal, target, { hostiles, approach = false }) {
  const feet = bot.entity.position.floored();
  // An exit being dug by hand clears stone without a tool: slowly, and for
  // the way out rather than the drops. Nothing else digs without one.
  const byHand = !!goal.surfaceReturn?.byHand;
  const dy = Math.sign(target.y - feet.y);
  const heights = dy ? [dy, 0] : [0];
  const choices = [];
  // What a filter took out, for the cells that would have got closer: a
  // filter that removes every step toward the target should say so, not
  // leave the least-bad sideways step to pass for progress.
  const here = feet.distanceTo(target), blocked = {};
  const block = (destination, why) => { if (destination.distanceTo(target) < here - 0.1) blocked[why] = (blocked[why] || 0) + 1; };
  for (const d of directions) for (const height of heights) {
    let destination = feet.plus(d).offset(0, height, 0);
    // A drop of up to three onto solid ground, where the cell has no floor:
    // under a jungle canopy the leaves end in air above the ground, and
    // trial 56 could go no further down than the leaves.
    let dropTo = null;
    if (height <= 0 && passable(bot.blockAt(destination.offset(0, -1, 0))) && !dangerous(bot.blockAt(destination.offset(0, -1, 0)))) {
      for (let n = 2; n <= 4; n++) {
        const below = bot.blockAt(destination.offset(0, -n, 0));
        if (!below || dangerous(below)) break;
        if (below.boundingBox === 'block') { if (!falling(below)) dropTo = destination.offset(0, -n + 1, 0); break; }
      }
    }
    if (hostiles && !safeFromHostiles(bot, destination.offset(0.5, 0, 0.5), Array.isArray(hostiles) ? hostiles : undefined)) { block(destination, 'a hostile'); continue; }
    const floor = bot.blockAt((dropTo || destination).offset(0, -1, 0));
    if (dangerous(floor) || falling(floor) || floor.boundingBox !== 'block') { block(destination, dangerous(floor) ? 'lava or water underfoot' : 'no floor'); continue; }
    if (bot.pathfinder?.movements?.allowedPosition && !bot.pathfinder.movements.allowedPosition(destination)) { block(destination, 'a forbidden cell'); continue; }
    const clear = [];
    // A jump needs three blocks of headroom in the cell we leave. Inspect and
    // clear that ceiling first, but never drop sand/gravel onto our own head.
    if (height > 0 && !passable(bot.blockAt(feet.offset(0, 2, 0)))) {
      if (falling(bot.blockAt(feet.offset(0, 2, 0))) || falling(bot.blockAt(feet.offset(0, 3, 0)))) continue;
      clear.push(feet.offset(0, 2, 0));
    }
    for (let y = Math.max(feet.y + 1, destination.y + 1); y >= destination.y; y--) clear.push(new Vec3(destination.x, y, destination.z));
    let why = null;
    const safe = clear.every(p => {
      const cell = bot.blockAt(p);
      if (dangerous(cell)) { why = 'lava or water in the way'; return false; }
      if (passable(cell)) return true;
      if (!natural.test(cell.name) || !cell.diggable) { why = `${cell.name.replaceAll('_', ' ')} in the way`; return false; }
      if (reservedForConstruction(goal, p, { from: feet })) { why = 'a building in the way'; return false; }
      if (!safeExcavation(bot, p)) { why = 'water or lava behind the rock'; return false; }
      if (byHand || !cell.harvestTools || bot.inventory.items().some(i => cell.harvestTools[i.type])) return true;
      why = `no tool for ${cell.name.replaceAll('_', ' ')}`; return false;
    });
    if (!safe) { block(destination, why); continue; }
    const visits = goal.tunnel?.visited?.[`${destination}`] || 0;
    // A travelling shaft is penalised for going back over its own cells, or
    // it loops. A shaft dug straight at a fixed target is not: after a few
    // hundred steps in one pocket every cell there carried forty visits, the
    // least-visited one won whatever its distance, and the bot walked
    // 19, 20, 21, 19, 20, 21 for an hour six blocks from its blazes. Closer
    // is the only score that means anything for an approach.
    const score = approach ? destination.distanceTo(target) + (dy > 0 && height === 0 ? 0.5 : 0)
      : destination.distanceTo(target) + visits * 16 + (dy > 0 && height === 0 ? 4 : 0);
    // A drop lands below the cell it steps into; scored where it lands.
    if (dropTo) choices.push({ destination: dropTo, clear, score: score - (destination.distanceTo(target) - dropTo.distanceTo(target)), drop: destination.y - dropTo.y });
    else choices.push({ destination, clear, score });
  }
  const sorted = choices.sort((a, b) => a.score - b.score);
  sorted.blocked = blocked;
  return sorted;
}

// Every step toward the target was filtered out, and what is left only goes
// sideways or back: for a dig at a fixed target that is not progress, and
// taking it is how the night mine paced under an ore behind water.
class NoSafeWay extends Error {
  constructor(target, blocked) {
    const reasons = Object.keys(blocked);
    super(`No safe way toward ${target}: ${reasons.join(', ') || 'nothing closer can be dug'}`);
    this.name = 'NoSafeWay'; this.blockedBy = reasons;
  }
}

const STALE_ROUNDS = 3, STAIRCASE_REST_MS = 10 * 60000;
class StaircaseStalled extends Error {
  constructor(target, why) { super(`The staircase toward ${target} is set aside (${why}); trying another way`); this.name = 'StaircaseStalled'; }
}
// By the eight-block area: the way-up target is the nearest landing, and it
// moves a block or two with every step taken toward it.
const area = t => ({ x: Math.floor(t.x / 8) * 8, y: Math.floor(t.y / 8) * 8, z: Math.floor(t.z / 8) * 8 });
const staircaseResting = (goal, target) => isSetAside(goal, 'staircase', area(target));

async function tunnelStep(bot, task, goal, save, target, { dig, navigate, approach = false, strict = false, within = null, retreat = retreatForTunnel }) {
  if (staircaseResting(goal, target)) throw new StaircaseStalled(target, attemptsFor(goal).why('staircase', area(target)));
  goal.tunnel ||= { entrance: { ...bot.entity.position.floored() }, steps: 0, visited: {} };
  const tunnel = goal.tunnel;
  // A spent budget is a shaft that has wandered, not a reason to stop: the
  // count outlived seven climbs of the dream run and then refused every
  // dig. Start a fresh shaft from here with a clean map of visited cells.
  if (tunnel.steps >= 512) {
    Object.assign(tunnel, { entrance: { ...bot.entity.position.floored() }, steps: 0, visited: {}, retreats: 0, retreatVisited: {}, rounds: (tunnel.rounds || 0) + 1 });
    delete tunnel.workPosition; save();
  }
  const options = stairOptions(bot, goal, target, { approach });
  const choice = options[0];
  goal.tunnel.lastBlocked = options.blocked && Object.keys(options.blocked).length ? options.blocked : undefined;
  // A dig at a fixed target (strict) stops here when nothing it can take gets
  // closer and a filter is why; a travelling shaft still goes round.
  const closer = choice && choice.destination.distanceTo(target) < bot.entity.position.floored().distanceTo(target) - 0.1;
  if (strict && !closer && options.blocked && Object.keys(options.blocked).length) throw new NoSafeWay(target, options.blocked);
  // No step at all, and the retreat did not move the bot either: that is a
  // staircase getting nowhere too. The live replay of trial 32 sat one block
  // below a beach, every step up filtered out, and returned at once five
  // times a second for two minutes, the landing chosen again each time.
  if (!choice) {
    const before = bot.entity.position.clone();
    let stuck = null;
    try { await retreat(bot, task, goal, save, { navigate }); }
    catch (err) { if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err; stuck = err; }
    // Retreats with no step between are the staircase getting nowhere too,
    // however far each one walks: mid-110-d and mid-100-b backed off a
    // flooded stair to a dry cell, found no step there either, backed off
    // again, and the audit called the flip between the two (2026-09-25).
    // A retreat is for a landing with another way on. This one comes from
    // the landing of the last, which had none either: the staircase is
    // rested now, not after a count. first-days-211 backed off three times
    // in eleven seconds on its way to iron and the audit called the flip
    // before the old count of four was reached (2026-09-26).
    const landingHadNone = (tunnel.retreatsWithoutStep || 0) >= 1;
    tunnel.retreatsWithoutStep = (tunnel.retreatsWithoutStep || 0) + 1;
    if (landingHadNone) {
      tunnel.retreatsWithoutStep = 0; tunnel.noWay = 0;
      const why = `backed off to a landing with no step toward it there either (${Object.entries(options.blocked || {}).map(([k, n]) => `${k} ${n}`).join(', ') || 'nothing open'})`;
      setAside(goal, 'staircase', area(target), why, STAIRCASE_REST_MS);
      save();
      throw new StaircaseStalled(target, why);
    }
    if (bot.entity.position.distanceTo(before) >= 0.5) { tunnel.noWay = 0; save(); if (stuck) throw stuck; return; }
    // Nowhere to back off to, and no step: nothing more to try from here.
    tunnel.noWay = (tunnel.noWay || 0) + 1;
    if (tunnel.noWay >= 1) {
      tunnel.noWay = 0;
      const why = `no safe step toward it (${Object.entries(options.blocked || {}).map(([k, n]) => `${k} ${n}`).join(', ') || 'nothing open'})`;
      setAside(goal, 'staircase', area(target), why, STAIRCASE_REST_MS);
      save();
      throw new StaircaseStalled(target, why);
    }
    save();
    if (stuck) throw stuck;
    return;
  }
  tunnel.noWay = 0; tunnel.retreatsWithoutStep = 0;
  noteProgress(tunnel, target, bot.entity.position.distanceTo(target));
  tunnel.visited[`${choice.destination}`] = (tunnel.visited[`${choice.destination}`] || 0) + 1;
  tunnel.steps++;
  // A round that gains nothing starts again, but keeps its best and the map
  // of cells it has walked. Both used to be reset: each round measured
  // itself from wherever it began and walked the same cells as new, and the
  // dream run went up and down one twenty-five-block fortress corridor,
  // ninety-six blocks from its portal, for eighty-eight rounds. Three rounds
  // with no new best and the staircase to this target is set aside, so the
  // caller tries another way.
  // Two cells in turn is a round that has already failed: a way up whose
  // climbing step was blocked went (-1050, 312), (-1051, 312) and back for
  // as long as the forty-eight steps lasted, and three rounds of that is
  // a hundred and forty-four.
  const pacing = tunnel.sinceBest >= 8 && tunnel.visited[`${choice.destination}`] >= 4;
  // Pacing where the round began: the next round would start in the same
  // few cells and pace them again. Trial 64 was in an air pocket in an
  // underground lake, every way down water; three rounds of that were
  // fifty seconds and a loop, when the first had already shown it.
  const entrance = tunnel.entrance && new Vec3(tunnel.entrance.x, tunnel.entrance.y, tunnel.entrance.z);
  if (pacing && entrance && entrance.distanceTo(bot.entity.position.floored()) <= 3) {
    const why = `paced the same few cells round where the round began, ${Math.round(tunnel.best ?? bot.entity.position.distanceTo(target))} blocks from it`;
    Object.assign(tunnel, { staleRounds: 0, visited: {} }); delete tunnel.best;
    setAside(goal, 'staircase', area(target), why, STAIRCASE_REST_MS);
    save();
    throw new StaircaseStalled(target, why);
  }
  if (tunnel.sinceBest >= 48 || pacing) {
    tunnel.staleRounds = (tunnel.staleRounds || 0) + 1;
    Object.assign(tunnel, { entrance: { ...bot.entity.position.floored() }, steps: 0, retreats: 0, retreatVisited: {}, rounds: (tunnel.rounds || 0) + 1, sinceBest: 0 });
    delete tunnel.workPosition;
    if (tunnel.staleRounds >= STALE_ROUNDS) {
      const why = `${STALE_ROUNDS} rounds without getting closer than ${Math.round(tunnel.best)} blocks`;
      Object.assign(tunnel, { staleRounds: 0, visited: {} }); delete tunnel.best;
      setAside(goal, 'staircase', area(target), why, STAIRCASE_REST_MS);
      save();
      throw new StaircaseStalled(target, why);
    }
    save();
    throw new Error(`The staircase toward ${target} is not gaining on it; starting round ${tunnel.rounds + 1}`);
  }
  // A tunnel dug inside another step (obsidian's walk to lava) is that
  // step's phase: named 'tunnel' in turn with 'make_obsidian', the two
  // flipped every few seconds while the shaft went down a block at a time,
  // and mid-110-a failed on the loop (2026-09-25).
  const tunnelling = { target: { ...target }, destination: { ...choice.destination }, steps: tunnel.steps };
  goal.step = within ? { ...within, phase: 'tunnel', ...tunnelling } : { action: 'tunnel', ...tunnelling };
  save();
  for (const p of choice.clear) {
    // Gravel can fall into a cleared headspace. Recheck it before entering.
    for (let tries = 0; !passable(bot.blockAt(p)); tries++) {
      task.check();
      if (tries >= 5) throw new Error('Falling blocks keep obstructing the staircase');
      if (!safeExcavation(bot, p)) throw new Error('Staircase excavation exposed a liquid or unstable wet ceiling');
      await dig(bot, task, p);
    }
  }
  const floor = bot.blockAt(choice.destination.offset(0, -1, 0));
  if (dangerous(floor) || floor.boundingBox !== 'block') throw new Error('Staircase footing changed during excavation');
  // One block away: walked in seconds or not at all. At the default fifteen
  // seconds without movement, and a recovery try after, a stair that could not
  // be stepped onto cost thirty seconds a time in trial 16 (2026-09-24).
  await navigate(bot, task, new goals.GoalBlock(choice.destination.x, choice.destination.y, choice.destination.z), { timeoutMs: 6000, stallMs: 2500 });
  tunnel.workPosition = { ...bot.entity.position.floored() };
  tunnel.dimension = bot.game?.dimension;
  save();
  // The shaft walls are where most ore is seen, and the mine step's own
  // check never ran here: coal for the next smelt went by unmined.
  const step = goal.step;
  await opportunisticMining(bot, task, goal, save, { drops: tunnel.resource || null }, { navigate, dig });
  await opportunisticPickups(bot, task, goal, save, { drops: tunnel.resource || null }, { navigate });
  goal.step = step;
}

// Resource work survives food, tool and shelter interruptions. Each resource
// retains its own shaft; returning walks through existing space before any new
// excavation is allowed. An unreachable saved shaft has a bounded retry budget.
async function resourceTunnelStep(bot, task, goal, save, target, resource, actions) {
  const dimension = bot.game?.dimension || 'overworld', key = `${dimension}:${resource}`;
  goal.miningSites ||= {};
  const site = goal.miningSites[key] ||= { entrance: { ...bot.entity.position.floored() }, steps: 0, visited: {}, dimension, resource };
  goal.tunnel = site;
  const work = site.workPosition && new Vec3(site.workPosition.x, site.workPosition.y, site.workPosition.z);
  // A saved worksite well behind the bot is a shaft it has outrun: the bot
  // walked back thirty blocks to one while twelve from its portal. An
  // inspected staircase close by is still resumed; only one more than
  // eight blocks farther from the target than the bot is replaced by here.
  const sameTarget = site.target && Math.hypot(site.target.x - target.x, site.target.y - target.y, site.target.z - target.z) < 4;
  if (work && sameTarget && work.distanceTo(target) > bot.entity.position.distanceTo(target) + 8) {
    site.workPosition = { ...bot.entity.position.floored() }; save();
  } else if (work && work.distanceTo(bot.entity.position) > 6 && !(site.rejoinBlockedUntil > Date.now())) {
    const movement = bot.pathfinder.movements;
    const previous = { canDig: movement.canDig, allow1by1towers: movement.allow1by1towers, scafoldingBlocks: movement.scafoldingBlocks };
    Object.assign(movement, { canDig: false, allow1by1towers: false, scafoldingBlocks: [] });
    try {
      task.check();
      const destination = new goals.GoalNear(work.x, work.y, work.z, 1);
      const route = await surveyRoute(bot, task, movement, destination, 1200);
      if (route.status !== 'success') throw new Error('No existing route to the saved mining worksite');
      goal.step = { action: 'return_to_mine', resource, destination: { ...work } }; save();
      await actions.navigate(bot, task, destination, { timeoutMs: 30000, stallMs: 5000 });
      site.rejoinFailures = 0; save(); return;
    } catch (err) {
      task.check();
      if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      site.rejoinFailures = (site.rejoinFailures || 0) + 1;
      site.lastRejoinError = err.message;
      if (site.rejoinFailures >= 3) site.rejoinBlockedUntil = Date.now() + 120000;
      save(); throw err;
    } finally { Object.assign(movement, previous); }
  }
  await tunnelStep(bot, task, goal, save, target, actions);
}

// A wet or blocked shaft is not permission to dig through liquids. Walk back
// through existing space to a dry landing and choose another approach next.
async function retreatForTunnel(bot, task, goal, save, { navigate }) {
  const start = bot.entity.position.floored(), tunnel = goal.tunnel;
  if ((tunnel.retreats || 0) >= 24) { const err = new Error('No dry underground approach after 24 retreats'); err.name = 'Blocked'; throw err; }
  const dry = p => dryBodySpace(bot, p);
  const wetStart = [start, start.offset(0, 1, 0)].some(p => bot.blockAt(p)?.name === 'water');
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, allow1by1towers: movement.allow1by1towers,
    scafoldingBlocks: movement.scafoldingBlocks, allowedPosition: movement.allowedPosition };
  const allowed = p => p.y >= start.y - 2 && (dry(p) || (wetStart && p.y >= start.y && start.distanceTo(new Vec3(p.x, p.y, p.z)) <= 8 &&
    [0, 1].every(dy => ['water', 'air', 'cave_air'].includes(bot.blockAt(new Vec3(p.x, p.y + dy, p.z))?.name)))) &&
    (!previous.allowedPosition || previous.allowedPosition(p));
  Object.assign(movement, { canDig: false, allow1by1towers: false, scafoldingBlocks: [], allowedPosition: allowed });
  try {
    const matching = bot.registry.blocksArray.filter(b => natural.test(b.name) && !['sand', 'gravel'].includes(b.name)).map(b => b.id);
    const candidates = bot.findBlocks({ matching, maxDistance: 16, count: 128, useExtraInfo: b => {
      const p = b.position.offset(0, 1, 0);
      return p.y >= start.y - 2 && p.y <= start.y + 8 && !p.equals(start) && dry(p) && safeFromHostiles(bot, p);
    } }).map(p => p.offset(0, 1, 0));
    // Retreat should first retrace the inspected staircase. Penalizing visited
    // steps hid a one-block escape behind twelve unreachable unexplored areas.
    // Repeated retreats to the same cell still lose priority and remain bounded.
    const cost = p => p.distanceTo(start) - (tunnel.visited?.[`${p}`] ? 16 : 0) + (tunnel.retreatVisited?.[`${p}`] || 0) * 16;
    candidates.sort((a, b) => cost(a) - cost(b));
    const checked = new Set();
    for (const p of candidates) {
      task.check();
      const area = `${Math.floor(p.x / 3)},${Math.floor(p.y / 3)},${Math.floor(p.z / 3)}`;
      if (checked.has(area)) continue;
      checked.add(area); if (checked.size > 12) break;
      const destination = new goals.GoalBlock(p.x, p.y, p.z);
      const route = await surveyRoute(bot, task, movement, destination, 500);
      if (route.status !== 'success' || !(route.path || []).every(allowed)) continue;
      tunnel.retreats = (tunnel.retreats || 0) + 1;
      tunnel.retreatVisited ||= {}; tunnel.retreatVisited[`${p}`] = (tunnel.retreatVisited[`${p}`] || 0) + 1;
      goal.step = { action: 'retreat_from_tunnel', from: { ...start }, destination: { ...p }, retreats: tunnel.retreats };
      save();
      await navigate(bot, task, destination, { timeoutMs: 15000, stallMs: 4000 });
      if (!dry(bot.entity.position.floored())) throw new Error('Tunnel retreat landing changed before arrival');
      save(); return;
    }
    if (await descendPillar(bot, task, goal, save)) return;
    throw new Error('No existing dry route away from the blocked staircase');
  } finally { Object.assign(movement, previous); }
}

module.exports = { natural, NoSafeWay, StaircaseStalled, staircaseResting, noteProgress, stairOptions, tunnelStep, resourceTunnelStep, retreatForTunnel, safeExcavation };

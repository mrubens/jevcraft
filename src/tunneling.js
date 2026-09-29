'use strict';
const { Vec3 } = require('vec3');
const { opportunisticMining } = require('./opportunistic-mining');
const { opportunisticPickups } = require('./opportunistic-pickups');
const { goals } = require('mineflayer-pathfinder');
const { reservedForConstruction } = require('./build-sites');
const { safeFromHostiles, hostileEntities, pushersAbout } = require('./danger');
const { fitToFight } = require('./mob-policy');
const { advance, attemptsFor, setAside, isSetAside, keyOf } = require('./progress');
const { surveyRoute } = require('./skills');
const { dryPassable: passable, dryBodySpace, dropNear } = require('./terrain');
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
// The Nether's forest floor and its trees too: mid-242-k's fortress leg met
// a block of crimson nylium at head height and paced three cells for minutes,
// every way south "crimson nylium in the way" (2026-09-27).
// Packed and blue ice too: dug, they leave no water, and mid-231-m under a
// frozen lake had every heading refused for "packed ice in the way"
// (the Fable advice on note 432). Plain ice melts to water and is not here.
const natural = /^(packed_ice|blue_ice|stone|deepslate|granite|diorite|andesite|tuff|calcite|dripstone_block|pointed_dripstone|smooth_basalt|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|grass_block|mud|clay|moss_block|gravel|sand|red_sand|sandstone|red_sandstone|terracotta|(white|orange|yellow|red|brown|light_gray)_terracotta|snow_block|cobblestone|cobbled_deepslate|netherrack|crimson_nylium|warped_nylium|nether_wart_block|warped_wart_block|shroomlight|crimson_stem|warped_stem|crimson_hyphae|warped_hyphae|glowstone|soul_sand|soul_soil|basalt|blackstone|nether_bricks|nether_brick_fence|nether_brick_stairs|nether_brick_slab|nether_brick_wall|end_stone)$|_ore$|_leaves$/;
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
  const nether = /nether/.test(String(bot.game?.dimension || ''));
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
    // Open air under the step is a gap the staircase does not cross: it
    // steps on ground and digs rock, and a gap is a span's or a pillar's,
    // laid from blocks carried (mob-hunt.js fortressApproaches, work.js
    // portalWay). Said as such: "no floor 6" read as a count of nothing.
    if (dangerous(floor) || falling(floor) || floor.boundingBox !== 'block') { block(destination, dangerous(floor) ? 'lava or water underfoot' : 'no floor to step onto (a gap, for a span or a pillar)'); continue; }
    // Nor onto a lip beside a deadly drop: a step down carries on past its
    // cell, and a stop mid-step leaves the body going. mid-244-q stepped two
    // down onto a one-block ledge over a ravine, a skeleton's alert stopped
    // the step, and it went on over the edge, forty-three blocks to the
    // rails below (2026-09-27). Deadly as the Nether crouch counts it.
    // A drop onto it, always: the fall's drift is the body's own. A step
    // (level, or one down onto the floor under it) while something about
    // can push the bot over (danger.js pushersAbout): with nothing that
    // can, a player steps onto a fortress bridge's edge, and mid-235-p-
    // nether-3-fortress-2's staircases onto its floors were all refused so
    // with nothing about (note 541).
    const edge = dropNear(bot, dropTo || destination, 1);
    if (edge && (edge.into === 'lava' || edge.damage >= (bot.health ?? 20) / 2)) {
      if (dropTo) { block(destination, 'a drop onto a lip beside a deadly drop'); continue; }
      if (pushersAbout(bot).length) { block(destination, 'a deadly drop beside the step while something about can push the bot'); continue; }
    }
    if (bot.pathfinder?.movements?.allowedPosition && !bot.pathfinder.movements.allowedPosition(destination)) { block(destination, 'a forbidden cell'); continue; }
    // In the Nether, not a step the walk onto it refuses (movement.js
    // besideLavaRefused, note 516): lava in a cell round it where a touch
    // is death or a push is in line (note 660), or an edge that falls into
    // lava while something can push. The stair was dug and then never stood on, the
    // walk to it "No route ... the way passes beside lava", and mid-243-ch
    // went down to that landing and back up the pathfinder's way every few
    // seconds for five minutes, its leg turned twice there (note 652).
    if (nether && typeof bot.pathfinder?.movements?.besideLavaRefused === 'function') {
      const refused = bot.pathfinder.movements.besideLavaRefused(dropTo || destination);
      if (refused) { block(destination, refused === 'lava' ? 'lava beside the step where a touch is death or a push is in line (the walk onto it refuses it)' : 'a deadly drop beside the step while something about can push the bot'); continue; }
    }
    const clear = [];
    // A jump needs three blocks of headroom in the cell we leave. Inspect and
    // clear that ceiling first, but never drop sand/gravel onto our own head.
    if (height > 0 && !passable(bot.blockAt(feet.offset(0, 2, 0)))) {
      if (falling(bot.blockAt(feet.offset(0, 2, 0))) || falling(bot.blockAt(feet.offset(0, 3, 0)))) continue;
      clear.push(feet.offset(0, 2, 0));
    }
    // Nor into a cell with sand or gravel standing over its head: dug out,
    // it falls into the head cell as the bot steps in. mid-242-n tunnelled
    // under a gravel column at y 36 and suffocated in its own stair, twenty
    // to none (2026-09-27).
    if (falling(bot.blockAt(destination.offset(0, 2, 0)))) { block(destination, 'gravel or sand over the way'); continue; }
    for (let y = Math.max(feet.y + 1, destination.y + 1); y >= destination.y; y--) clear.push(new Vec3(destination.x, y, destination.z));
    let why = null;
    const safe = clear.every(p => {
      const cell = bot.blockAt(p);
      if (dangerous(cell)) { why = 'lava or water in the way'; return false; }
      if (passable(cell)) return true;
      if (!natural.test(cell.name) || !cell.diggable) { why = `${cell.name.replaceAll('_', ' ')} in the way`; return false; }
      if (reservedForConstruction(goal, p, { from: feet })) { why = 'a building in the way'; return false; }
      if (!safeExcavation(bot, p)) { why = 'water or lava behind the rock'; return false; }
      // A block soft enough to dig by hand in a moment is dug without its
      // tool: the tool is for the drop, and a stair wants the room, not the
      // drop. mid-231-j's stairs up a mountain were "no tool for snow block"
      // and rested ten minutes (2026-09-27).
      if (byHand || require('./block-stock').handDigs(bot, cell)) return true;
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

// Seconds a block takes to dig with the best tool carried, by hand where
// none serves (netherrack by hand: 2 seconds; a wooden pickaxe: 0.3).
function digSeconds(bot, block) {
  if (!block || typeof block.digTime !== 'function') return null;
  let tool = null;
  try { tool = require('./skills').cheapestTool(bot, block); } catch (_) { tool = null; }
  return block.digTime(tool?.type ?? null, false, false, false, [], {}) / 1000;
}

// The staircase toward `target`, looked at from here before it is begun:
// whether a step from here gains ground with what is carried (a block under
// hardness one is dug without its tool, netherrack among them), and roughly
// what the stair takes: a step for each block of height or across, whichever
// is more, each dug as the first one is. mid-242-ch-fortress-10 (25591,
// note 678) stood on netherrack 10 blocks straight above its portal with no
// pickaxe, and the way back went for wood for one it did not need.
// Said and offered only for a target this near across: farther, the stair
// is one way among the crossing's and the walk's, not the way to it.
const STAIR_ACROSS = 16;
function stairFromHere(bot, goal, target) {
  if (typeof bot?.blockAt !== 'function' || !bot.entity?.position || !target) return null;
  const feet = bot.entity.position.floored(), here = feet.distanceTo(target);
  let choices;
  try { choices = stairChoices(bot, goal, target, { hostiles: false }); } catch (_) { return null; }
  const step = choices.find(c => c.destination.distanceTo(target) < here - 0.1);
  if (!step) return { gains: false, blocked: blockedSays(choices.blocked) };
  const dug = step.clear.map(p => bot.blockAt(p)).filter(b => b && b.boundingBox === 'block');
  // Each step as the first one digs, or at least two cells of the rock
  // underfoot where the first step is open (a stair digs its way).
  const under = bot.blockAt(feet.offset(0, -1, 0)), rock = under?.boundingBox === 'block' ? digSeconds(bot, under) ?? 0 : 0;
  const perStep = Math.max(dug.reduce((s, b) => s + (digSeconds(bot, b) ?? 0), 0), 2 * rock) + 0.25;
  const steps = Math.max(Math.abs(target.y - feet.y), Math.round(Math.hypot(target.x - feet.x, target.z - feet.z)));
  const byHand = dug.filter(b => b.harvestTools && !(bot.inventory?.items?.() || []).some(i => b.harvestTools[i.type])).map(b => b.name);
  return { gains: true, steps, seconds: Math.max(1, Math.round(steps * perStep)), byHand: [...new Set(byHand)] };
}

// The stair said in a few words, for an option or a fact.
function stairSays(bot, stair, target) {
  if (!stair) return '';
  const dy = Math.round(target.y - bot.entity.position.y);
  const which = dy < 0 ? 'down' : dy > 0 ? 'up' : 'across';
  if (!stair.gains) return `A stair dug ${which} to it gains no ground from here (${stair.blocked}).`;
  const hand = stair.byHand.length ? `, ${stair.byHand.map(n => n.replaceAll('_', ' ')).join(' and ')} dug by hand (no drops)` : '';
  return `A stair dug ${which} to it: about ${stair.steps} steps, about ${stair.seconds} seconds${hand}.`;
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
// How far a retreat looks for a dry landing (retreatForTunnel).
const RETREAT_REACH = 16;
class StaircaseStalled extends Error {
  // The landing it stalled at and what blocked each step from there travel
  // with it, for the stall's question to say (work.js answerStall).
  constructor(target, why, { landing = null, blocked = null, cave = null } = {}) {
    super(`The staircase toward ${target} is set aside (${why}); trying another way`); this.name = 'StaircaseStalled'; this.why = why;
    if (landing) this.landing = landing;
    if (blocked) this.blocked = blocked;
    if (cave) this.cave = cave;
  }
}
// Each reason with how many of the steps nearer it refused.
const blockedSays = blocked => Object.entries(blocked || {}).map(([k, n]) => `${k}: ${n} of the steps nearer`).join('; ') || 'nothing open';
// A landing with no step on is resting by where it is, whatever the target:
// the way-down target is new every round, and mid-230-s's rest by the
// target's area never met the same area twice while it stepped out to
// (367, 75, 999) and backed off again nine times in two minutes (note 485).
// Kept apart by the way it was going, up, down or level.
// And by the heading from it, one of eight: keyed by the landing and up or
// down alone, one stall rested every staircase from there, and the deep
// lava's sixteen headings, each refused at once from the same landing, all
// rested within seconds (mid-237-g, "every way rests" three times in six
// minutes, note 487). A stall says nothing of the ways it did not try.
const landingKey = (landing, target) => {
  const a = area(landing), dy = Math.sign(target.y - landing.y);
  const dx = target.x - landing.x, dz = target.z - landing.z;
  const heading = Math.hypot(dx, dz) < 2 ? 'straight' : ((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  return `${a.x},${a.y},${a.z} ${dy > 0 ? 'up' : dy < 0 ? 'down' : 'level'} ${heading}`;
};
// A staircase stalled at a landing: rested by the target's area and by the
// landing's, and kept on the goal as the fact the stall question gives Jev.
// A cave met under the next stair travels with it too (caveUnder), for the
// way's question to offer the way down into it (work.js portalMethod).
function staircaseStalled(goal, save, target, why, { landing, blocked, cave } = {}) {
  setAside(goal, 'staircase', area(target), why, STAIRCASE_REST_MS);
  if (landing) setAside(goal, 'staircase_from', landingKey(landing, target), why, STAIRCASE_REST_MS);
  goal.staircaseStalled = { why, at: Date.now(), target: { x: target.x, y: target.y, z: target.z }, ...(landing ? { landing: { x: landing.x, y: landing.y, z: landing.z } } : {}), ...(blocked ? { blocked } : {}), ...(cave ? { cave } : {}) };
  save();
  return new StaircaseStalled(target, why, { landing: goal.staircaseStalled.landing, blocked, cave });
}
// The cave under a stair cell that would open a pit: how far the body
// falls from the feet to its floor, where that floor is, what is down
// there, and the target's depth against it. mid-226-f's stairs toward its
// lava at (363, 66, 230) met a cave under the next stair and were only
// "set aside (refusing to open a drop)", four times over, the depth never
// looked at (mid-214-f, mid-226-f, note 490).
function caveUnder(bot, p, target, deepest = 48) {
  const feet = bot.entity.position.floored();
  let depth = 0, into = 'ground';
  for (let dy = 1; dy <= deepest; dy++) {
    const b = bot.blockAt(p.offset(0, -dy, 0));
    if (!b) { into = 'unknown'; break; }
    if (/lava/.test(b.name)) { into = 'lava'; break; }
    if (/water/.test(b.name)) { into = 'water'; break; }
    if (b.boundingBox === 'block') break;
    depth = dy;
    if (dy === deepest) into = 'unknown';
  }
  const standY = p.y - depth;
  return { at: { x: p.x, y: p.y, z: p.z }, landing: { x: feet.x, y: feet.y, z: feet.z }, depth, fall: feet.y - standY, floorY: standY - 1, standY, into,
    targetY: Math.round(target.y), target: { x: target.x, y: target.y, z: target.z } };
}
// Said within the two hundred characters a rest keeps of its why.
const caveSays = c => `a cave under the stair at (${c.at.x}, ${c.at.y}, ${c.at.z}), a fall of ${c.fall}${c.into === 'ground' ? ` to its floor at y ${c.floorY}` : c.into === 'unknown' ? ', its floor not in view' : ` into ${c.into}`} (the target at y ${c.targetY})`;
// A rest already standing, met again: the stall it is, on the goal as
// such, the rest neither renewed nor lengthened. Thrown bare, mid-214-f's
// stall question had strikes and no failure, and the staircase resting
// was met every half second for its ten minutes (note 488).
function staircaseStillResting(goal, save, target, kind, key) {
  const entry = attemptsFor(goal).entries[keyOf(kind, key)], why = entry?.why || 'the staircase toward it is resting';
  const prev = goal.staircaseStalled;
  // The set-aside keeps two hundred characters of the why.
  if (String(prev?.why).slice(0, 200) !== why || !(prev.at >= (entry?.at ?? 0))) { goal.staircaseStalled = { why, at: entry?.at ?? Date.now() }; save(); }
  const rest = goal.staircaseStalled;
  return new StaircaseStalled(target, why, { landing: rest.landing, blocked: rest.blocked, cave: rest.cave });
}
// By the eight-block area: the way-up target is the nearest landing, and it
// moves a block or two with every step taken toward it.
const area = t => ({ x: Math.floor(t.x / 8) * 8, y: Math.floor(t.y / 8) * 8, z: Math.floor(t.z / 8) * 8 });
const staircaseResting = (goal, target) => isSetAside(goal, 'staircase', area(target));
// Why the staircase toward `target` rests, as its set-aside said it.
const staircaseWhy = (goal, target) => attemptsFor(goal).why('staircase', area(target)) || 'the staircase toward it is resting';
// When it is taken up again (0 when it is not resting).
const staircaseUntil = (goal, target) => attemptsFor(goal).entries[keyOf('staircase', area(target))]?.until || 0;
// What an option whose way is a staircase says while it rests, by the
// target's area or, from `from`, by the landing and heading (tunnelStep
// meets either at once): why, and when it is taken up again. Null while
// open. Offered bare, a resting way was chosen fresh and threw before a
// step: the portal way (note 482), the stall question (note 488), the
// lava (note 494), and mid-202-o-nether-2's seek_fortress_height, chosen
// at 0.64 to 0.87 for three minutes with its staircase resting (note 500).
function restingSays(goal, target, from = null, now = Date.now()) {
  const rest = restingWay(goal, target, from, now);
  return rest && `${rest.what} is set aside (${rest.why}), taken up again in ${rest.minutes} minute${rest.minutes === 1 ? '' : 's'}`;
}
// The same rest as parts: what rests, why, and until when. For a caller
// that holds a way until the rest ends (work.js nearRest): read by the
// area alone, mid-214-g's held lava met a rest the step could not see.
function restingWay(goal, target, from = null, now = Date.now()) {
  const ways = [['staircase', area(target), 'the staircase toward it']];
  if (from) ways.push(['staircase_from', landingKey(new Vec3(Math.floor(from.x), Math.floor(from.y), Math.floor(from.z)), target), 'the staircase toward it from here']);
  for (const [kind, key, what] of ways) {
    const entry = attemptsFor(goal).entries[keyOf(kind, key)];
    if (!(entry?.until > now)) continue;
    return { what, why: entry.why || 'resting', until: entry.until, minutes: Math.max(1, Math.ceil((entry.until - now) / 60000)) };
  }
  return null;
}
// The way into lava is the staircase to the block above it: that is where
// it is dug toward (obsidian.js), so that is the area it rests by. A pool
// judged by its own block is judged by the area below: mid-229-m stood
// five blocks from its only pool, (342, 47, 33), every staircase into it
// resting in the areas at y 48, and the pool's own area at y 40 said it
// was open; the step arrived there, did nothing, and ran twenty-five times
// a second until persist put it back, again and again (2026-09-27).
const lavaWay = lava => new Vec3(lava.x, lava.y + 1, lava.z);
const lavaResting = (goal, lava) => staircaseResting(goal, lavaWay(lava));
// The rest lifted, the way it was for having been taken another way (the
// cave gone down into, work.js intoCave).
const liftStaircaseRest = (goal, target) => attemptsFor(goal).clear('staircase', area(target));
// Every way to something rests, until a time: nothing the step can do
// changes that before then, so it is not tried again and again; it goes
// to Jev as the fact it is (work.js).
class WaysResting extends Error {
  constructor(message, until) { super(message); this.name = 'WaysResting'; this.until = until; }
}

async function tunnelStep(bot, task, goal, save, target, { dig, navigate, place = null, approach = false, strict = false, within = null, retreat = retreatForTunnel }) {
  if (staircaseResting(goal, target)) throw staircaseStillResting(goal, save, target, 'staircase', area(target));
  const from = bot.entity.position.floored();
  if (isSetAside(goal, 'staircase_from', landingKey(from, target))) throw staircaseStillResting(goal, save, target, 'staircase_from', landingKey(from, target));
  goal.tunnel ||= { entrance: { ...bot.entity.position.floored() }, steps: 0, visited: {} };
  const tunnel = goal.tunnel;
  // Where a way down began at the surface, remembered: the way back up is
  // the stairs already dug (surface.js returnToSurface). mid-207-k spent
  // forty-four of its minutes climbing, each time digging a new staircase
  // up beside the one it came down (note 452; the Fable advice).
  try {
    const feet = bot.entity.position.floored();
    if (target.y < feet.y - 4 && require('./surface').surfaceObserver(bot)(feet)) {
      const dim = String(bot.game?.dimension || ''), list = goal.surfaceEntrances ||= [];
      if (!list.some(e => e.dimension === dim && Math.hypot(e.x - feet.x, e.y - feet.y, e.z - feet.z) < 4)) {
        list.push({ x: feet.x, y: feet.y, z: feet.z, dimension: dim, at: Date.now() });
        if (list.length > 8) list.splice(0, list.length - 8);
        save();
      }
    }
  } catch (_) { /* no surface to judge by */ }
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
    const before = bot.entity.position.clone(), landing = before.floored();
    // Progress is ground gained, not a step taken: a landing with no step
    // on is measured against the last one it backed off from, both against
    // today's target (it moves), by the distance to it or the height gained
    // toward it. Nothing gained, and the cycle between is over: stepping out
    // and backing off again gets no further. mid-230-s stepped out to
    // (367, 75, 999) and backed off nine times in two minutes, each step out
    // clearing the count of retreats (note 485). A landing past the
    // retreat's reach is another stretch of shaft, measured afresh.
    const last = tunnel.lastLanding && new Vec3(tunnel.lastLanding.x, tunnel.lastLanding.y, tunnel.lastLanding.z);
    if (last && last.distanceTo(landing) <= RETREAT_REACH) {
      const nearer = last.distanceTo(target) - landing.distanceTo(target), deeper = Math.sign(target.y - landing.y) * (landing.y - last.y);
      if (Math.max(nearer, deeper) < 1) {
        delete tunnel.lastLanding; tunnel.retreatsWithoutStep = 0; tunnel.noWay = 0;
        throw staircaseStalled(goal, save, target, `gained no ground from the landing at ${landing} since backing off there last, ${Math.round(landing.distanceTo(target))} blocks from it; every step on was blocked (${blockedSays(options.blocked)})`,
          { landing, blocked: options.blocked });
      }
    }
    tunnel.lastLanding = { x: landing.x, y: landing.y, z: landing.z };
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
      tunnel.retreatsWithoutStep = 0; tunnel.noWay = 0; delete tunnel.lastLanding;
      throw staircaseStalled(goal, save, target, `backed off to a landing at ${landing} with no step toward it there either (${blockedSays(options.blocked)})`, { landing, blocked: options.blocked });
    }
    if (bot.entity.position.distanceTo(before) >= 0.5) { tunnel.noWay = 0; save(); if (stuck) throw stuck; return; }
    // Nowhere to back off to, and no step: nothing more to try from here.
    tunnel.noWay = (tunnel.noWay || 0) + 1;
    if (tunnel.noWay >= 1) {
      tunnel.noWay = 0; delete tunnel.lastLanding;
      throw staircaseStalled(goal, save, target, `no safe step toward it from ${landing} (${blockedSays(options.blocked)})`, { landing, blocked: options.blocked });
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
  // Pacing anywhere is the same: a new round begun where it paced begins
  // in those cells. mid-243-af-fortress-1 and mid-243-ag-fortress-3's
  // staircases back to the portal paced three cells ((-145, 60, 337) to
  // (-145, 60, 339)), started a round there, went to the crossing between
  // rounds and paced again, "turning between tunnel and cross toward" each
  // time, before the second round's pacing rested the staircase (note 603).
  const entrance = tunnel.entrance && new Vec3(tunnel.entrance.x, tunnel.entrance.y, tunnel.entrance.z);
  if (pacing) {
    const where = entrance && entrance.distanceTo(bot.entity.position.floored()) <= 3 ? 'round where the round began' : `about ${choice.destination}`;
    const why = `paced the same few cells ${where}, ${Math.round(tunnel.best ?? bot.entity.position.distanceTo(target))} blocks from it`;
    Object.assign(tunnel, { staleRounds: 0, visited: {} }); delete tunnel.best;
    throw staircaseStalled(goal, save, target, why);
  }
  if (tunnel.sinceBest >= 48) {
    tunnel.staleRounds = (tunnel.staleRounds || 0) + 1;
    Object.assign(tunnel, { entrance: { ...bot.entity.position.floored() }, steps: 0, retreats: 0, retreatVisited: {}, rounds: (tunnel.rounds || 0) + 1, sinceBest: 0 });
    delete tunnel.workPosition;
    if (tunnel.staleRounds >= STALE_ROUNDS) {
      const why = `${STALE_ROUNDS} rounds without getting closer than ${Math.round(tunnel.best)} blocks`;
      Object.assign(tunnel, { staleRounds: 0, visited: {} }); delete tunnel.best;
      throw staircaseStalled(goal, save, target, why);
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
  let destination = choice.destination;
  for (const p of choice.clear) {
    // Gravel can fall into a cleared headspace. Recheck it before entering.
    for (let tries = 0; !passable(bot.blockAt(p)); tries++) {
      task.check();
      if (tries >= 5) throw new Error('Falling blocks keep obstructing the staircase');
      if (!safeExcavation(bot, p)) throw new Error('Staircase excavation exposed a liquid or unstable wet ceiling');
      // The stair reaches the roof of a cave: a floor under it first, as a
      // player sets a block in the gap and digs on. Stood on, the stair is
      // the cell dug, not the drop past it.
      if (require('./work').opensPit(bot, p)) {
        await floorStair(bot, task, goal, save, target, p, { dig, place });
        destination = p.clone();
        continue;
      }
      // A dig refused for the drop it would open is not refused less next
      // pass: the staircase rests, as for no safe step. mid-242-j's stairs
      // toward iron were refused so four times a pass and turned with the
      // mine step until the flip watch ended the trial (2026-09-27).
      try { await dig(bot, task, p, { requireDrops: false }); }
      catch (err) {
        if (!/Refusing to (open a drop|open lava|dig directly beneath)/.test(err.message || '')) throw err;
        // Through the stall's own record, for the stall question's failure
        // (mid-214-f, note 488), and the cave under it said.
        const cave = /open a drop/.test(err.message) ? caveUnder(bot, p, target) : null;
        throw staircaseStalled(goal, save, target, err.message.toLowerCase() + (cave ? `: ${caveSays(cave)}` : ''), { cave });
      }
    }
  }
  const floor = bot.blockAt(destination.offset(0, -1, 0));
  if (dangerous(floor) || floor.boundingBox !== 'block') throw new Error('Staircase footing changed during excavation');
  // One block away: walked in seconds or not at all. At the default fifteen
  // seconds without movement, and a recovery try after, a stair that could not
  // be stepped onto cost thirty seconds a time in trial 16 (2026-09-24).
  await navigate(bot, task, new goals.GoalBlock(destination.x, destination.y, destination.z), { timeoutMs: 6000, stallMs: 2500 });
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

// A stair cell over open air two deep (work.js opensPit): dug, and a
// carried building block set in the gap under it before any step, against
// a face beside or below the gap. With no block carried or no face to set
// it against, the staircase rests with the cave said: how far down its
// floor is and the target's depth against it (mid-214-f, mid-226-f,
// mid-229-m, note 490). The fall is the body's safety; the way on is not
// ended silently.
const FLOOR_FACES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
async function floorStair(bot, task, goal, save, target, p, { dig, place }) {
  const { buildingMaterials } = require('./shelter');
  const gap = p.offset(0, -1, 0);
  const material = require('./shelter').buildingItem(bot);
  const face = FLOOR_FACES.some(([x, y, z]) => bot.blockAt(gap.offset(x, y, z))?.boundingBox === 'block');
  if (!material || !face) {
    const cave = caveUnder(bot, p, target);
    throw staircaseStalled(goal, save, target, `refusing to open a drop beside the feet: ${caveSays(cave)}; ${!material ? 'no building block carried' : 'no face beside the gap'} to floor the stair`, { cave });
  }
  await dig(bot, task, p, { requireDrops: false, openPit: true });
  try { await (place || require('./work').place)(bot, task, gap, material.name); }
  catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    const cave = caveUnder(bot, p, target);
    throw staircaseStalled(goal, save, target, `the floor for the stair over a cave would not go in (${String(err.message).slice(0, 50)}): ${caveSays(cave)}`, { cave });
  }
  if (bot.blockAt(gap)?.boundingBox !== 'block') {
    const cave = caveUnder(bot, p, target);
    throw staircaseStalled(goal, save, target, `the floor for the stair over a cave did not land: ${caveSays(cave)}`, { cave });
  }
  console.log(`[tunnel] floored the stair at ${p} over a cave with ${material.name}`);
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
    const candidates = bot.findBlocks({ matching, maxDistance: RETREAT_REACH, count: 128, useExtraInfo: b => {
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

// The ways down to a depth when no ore is in view: eight headings, near first.
function descentTargets(feet, depth) {
  const unit = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  return [24, 48].flatMap(r => unit.map(([dx, dz]) => feet.offset(Math.round(dx * r / Math.hypot(dx, dz)), depth - feet.y, Math.round(dz * r / Math.hypot(dx, dz)))));
}

module.exports = { STAIR_ACROSS, stairFromHere, stairSays, digSeconds, caveUnder, liftStaircaseRest, landingKey, STAIRCASE_REST_MS, descentTargets, natural, NoSafeWay, StaircaseStalled, WaysResting, staircaseResting, staircaseWhy, staircaseUntil, restingSays, restingWay, lavaWay, lavaResting, noteProgress, stairOptions, tunnelStep, resourceTunnelStep, retreatForTunnel, safeExcavation };

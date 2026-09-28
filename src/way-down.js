'use strict';
// Down off a top the bot cannot walk off (note 565). mid-243-ab stood for an
// hour on its own scattered tower twenty blocks over the forest canopy: every
// side fell twenty to forty blocks, the fall rule (movement.js overFall,
// maxDropDown) refused each drop, and the only moves the pathfinder had left
// were blocks laid to rise, so every walk to a sheep climbed and the tower
// grew from 105 to 129. descend_pillar, the one way down there was, digs a
// block only over a solid block with two open sides, and the tower's own
// shelter rings and gaps refused it after a block or two. No question named
// the way down, and the walks said only "no route".
//
// Here the top is read (perchOf): the ground a walk reaches from the feet,
// without digging or laying, and what every side of it falls to. Where no
// side comes down within three blocks, the ways down that exist are listed
// with what each costs (waysDown): digging down through the column under
// the feet, each fall on the way said with its damage; pouring the water
// bucket at the feet and riding the waterfall down; stepping off a side
// whose fall the bot survives. Jev chooses (way_down), the code carries it
// out, and the walk goes on from the ground.
//
// On a view of the world, as unstuck.js is, so a replay of a top and the
// live bot read the same: view.name(p) is the block name at p, or null.
const { Vec3 } = require('vec3');
const { DIRS, isWater, open, solid } = require('./unstuck');

const UP = new Vec3(0, 1, 0), DOWN = new Vec3(0, -1, 0);
const isLava = n => /lava/.test(n || '');
const DEEPEST = 64;
const SAFE_FALL = 3;
// What cannot be dug to come down: the frame of a portal, a container.
const FIXED = /^(bedrock|obsidian|crying_obsidian|end_portal_frame|nether_portal|end_portal|barrier|chest|trapped_chest|barrel|spawner|reinforced_deepslate)$|shulker_box$/;
const diggable = n => solid(n) && !FIXED.test(n);

// The fall under a cell open at the feet: how many open cells down, and
// what ends it. `into` is ground, water, lava or unknown (not loaded).
function fallUnder(view, cell, reach = DEEPEST) {
  for (let n = 0; n < reach; n++) {
    const name = view.name(cell.offset(0, -n - 1, 0));
    if (name == null) return { n, into: 'unknown' };
    if (isLava(name)) return { n, into: 'lava' };
    if (isWater(name)) return { n, into: 'water' };
    if (!open(name)) return { n, into: 'ground', landing: name };
  }
  return { n: reach, into: 'unknown' };
}
const damageOf = (fall, into) => into === 'water' ? 0 : Math.max(0, fall - SAFE_FALL);

// The top: the cells a walk reaches from `feet` without digging or laying a
// block (level, a step up, a drop of three at most), and each side of them
// that falls further. A wall of the bot's own blocks is dug through as a
// walk would: with ground under it, the walk goes on past it. Null where
// the walk reaches `radius` blocks out, or a way down within three: not a
// top. Otherwise { cells, edges, least }, least the smallest fall off it.
function perchOf(view, feet, { radius = 6, maxCells = 160 } = {}) {
  const name = p => view.name(p);
  const standable = c => open(name(c)) && !isWater(name(c)) && open(name(c.plus(UP))) && !isWater(name(c.plus(UP))) && solid(name(c.plus(DOWN)));
  if (!standable(feet)) return null;
  const key = c => `${c.x},${c.y},${c.z}`;
  const seen = new Map([[key(feet), { cell: feet, viaDig: false }]]), queue = [feet], edges = [];
  const reach = (c, viaDig) => {
    if (seen.has(key(c))) return;
    seen.set(key(c), { cell: c, viaDig }); queue.push(c);
  };
  while (queue.length) {
    const c = queue.shift(), from = seen.get(key(c));
    if (Math.max(Math.abs(c.x - feet.x), Math.abs(c.z - feet.z)) > radius || seen.size > maxCells) return null;
    for (const [dir, d] of Object.entries(DIRS)) {
      const s = c.plus(d), atFeet = name(s), atHead = name(s.plus(UP));
      if (atFeet == null || atHead == null) continue;
      if (isLava(atFeet) || isLava(atHead)) continue;
      if (open(atFeet) && open(atHead)) {
        if (isWater(atFeet)) { edges.push({ from: c, dir, cell: s, fall: 0, into: 'water', viaDig: from.viaDig }); continue; }
        // The fall from the feet's height: the open cells under the side
        // cell, landing on what ends them.
        const under = fallUnder(view, s);
        if (under.into === 'ground' && under.n <= SAFE_FALL) { reach(s.offset(0, -under.n, 0), from.viaDig); continue; }
        edges.push({ from: c, dir, cell: s, fall: under.n, into: under.into, landing: under.landing, viaDig: from.viaDig });
        continue;
      }
      // A step up onto a block beside, head room over it and over the feet.
      if (solid(atFeet) && open(atHead) && !isWater(atHead) && open(name(s.offset(0, 2, 0))) && open(name(c.offset(0, 2, 0)))) { reach(s.plus(UP), from.viaDig); continue; }
      // A wall: dug through, what is under it.
      if ((diggable(atFeet) || open(atFeet)) && (diggable(atHead) || open(atHead))) {
        const floor = name(s.plus(DOWN));
        if (solid(floor)) { reach(s, true); continue; }
        const under = fallUnder(view, s);
        if (under.into === 'ground' && under.n <= SAFE_FALL) { reach(s.offset(0, -under.n, 0), true); continue; }
        edges.push({ from: c, dir, cell: s, fall: under.n, into: under.into, landing: under.landing, viaDig: from.viaDig, wall: [[s, atFeet], [s.plus(UP), atHead]].filter(([, n]) => solid(n)).map(([p, n]) => ({ cell: p, name: n })) });
      }
    }
  }
  // A way down into water is a way down; a side that falls into lava or
  // the unloaded is no way at all, but the top is still a top.
  const falls = edges.filter(e => e.into === 'ground');
  if (!falls.length && !edges.some(e => e.into === 'lava' || e.into === 'unknown')) return null;
  const cells = [...seen.values()].filter(s => !s.viaDig).map(s => s.cell);
  const measured = edges.filter(e => e.into === 'ground').map(e => e.fall);
  return { feet, cells, edges, least: measured.length ? Math.min(...measured) : null };
}

// Seconds to dig a block, as the game reckons it, with the best pickaxe
// carried (or none): stone and ore take a pickaxe to break at speed, and
// break by hand at five times their hardness; the rest by hand at one and
// a half. About, not exact: it is said as about.
const HARDNESS = { dirt: .5, coarse_dirt: .5, rooted_dirt: .5, podzol: .5, mycelium: .6, grass_block: .6, mud: .5, sand: .5, red_sand: .5, gravel: .6, clay: .6, snow_block: .2, soul_sand: .5, soul_soil: .5,
  cobblestone: 2, mossy_cobblestone: 2, stone: 1.5, andesite: 1.5, diorite: 1.5, granite: 1.5, tuff: 1.5, calcite: .75, deepslate: 3, cobbled_deepslate: 3.5, netherrack: .4, blackstone: 1.5, basalt: 1.25,
  nether_bricks: 2, sandstone: .8, red_sandstone: .8, end_stone: 3, furnace: 3.5, crafting_table: 2.5, glowstone: .3, packed_ice: .5, ice: .5 };
const PICK_SPEED = { wooden_pickaxe: 2, stone_pickaxe: 4, iron_pickaxe: 6, diamond_pickaxe: 8, netherite_pickaxe: 9, golden_pickaxe: 12 };
const stony = n => /stone|deepslate|granite|diorite|andesite|tuff|calcite|netherrack|basalt|blackstone|nether_bricks|furnace|_ore$|end_stone|sandstone/.test(n) && !/^(sand|red_sand|soul_sand)$/.test(n);
function digSeconds(name, pickaxe) {
  const hard = HARDNESS[name] ?? (/_log$|_planks$|_wood$|_stem$/.test(name) ? 2 : /_leaves$/.test(name) ? .2 : 1.5);
  if (stony(name)) return Math.round((pickaxe ? hard * 1.5 / (PICK_SPEED[pickaxe] || 2) : hard * 5) * 10) / 10;
  return Math.round(hard * 1.5 * 10) / 10;
}

// Down the column under `from`, a block at a time, until the feet stand
// where perchOf finds no top: what is dug, each drop on the way, and where
// it ends. Never a fall that hurts: it stops on the block over one, and
// says it (stopsOver). `blocked` says why the first block cannot be dug.
function digColumn(view, from, { pickaxe = null, pickaxeUses = 0, maxDigs = 80 } = {}) {
  const dug = new Set();
  const seen = { name: p => dug.has(`${p}`) ? 'air' : view.name(p) };
  const digs = [];
  let feet = from, uses = pickaxeUses, seconds = 0, most = 0;
  const done = extra => ({ from, digs, seconds: Math.round(seconds), endsAt: feet, usesSpent: pickaxeUses - uses, mostFall: most, ...extra });
  for (let i = 0; i < maxDigs; i++) {
    if (!perchOf(seen, feet)) return done({ off: true });
    const floor = feet.plus(DOWN), floorName = seen.name(floor);
    const stop = why => digs.length ? done({ stopsAt: why }) : { from, blocked: why };
    if (floorName == null) return stop('what is under the feet is not loaded');
    if (!diggable(floorName)) return stop(`a ${said(floorName)} under the feet that cannot be dug`);
    const under = fallUnder(seen, floor);
    if (under.into === 'lava') return stop(`lava ${under.n + 1} under the ${said(floorName)} at ${floor.y}`);
    if (under.into === 'unknown') return stop('the column under the feet runs into what is not loaded');
    const fall = under.n + 1, hurt = damageOf(fall, under.into);
    if (hurt > 0) return digs.length ? done({ stopsOver: { fall, damage: hurt, at: floor.y, name: floorName } }) : { from, blocked: `a fall of ${fall} under the ${said(floorName)} underfoot`, over: { fall, damage: hurt } };
    const withPick = stony(floorName) && pickaxe && uses > 0;
    const s = digSeconds(floorName, withPick ? pickaxe : null);
    if (withPick) uses--;
    seconds += s + 0.3;
    digs.push({ cell: floor, name: floorName, seconds: s });
    dug.add(`${floor}`);
    most = Math.max(most, fall);
    feet = floor.offset(0, -under.n, 0);
    if (under.into === 'water') return done({ off: true, water: true });
  }
  return done({ stopsAt: `${maxDigs} blocks dug` });
}

// The column down from the open side cell `side`, for the water: open all
// the way to what it lands on.
function waterfall(view, side) {
  const under = fallUnder(view, side);
  if (under.into !== 'ground' && under.into !== 'water') return null;
  return { fall: under.n, landsOn: under.landing || 'water', bottom: side.offset(0, -under.n, 0) };
}

const said = n => String(n).replaceAll('_', ' ');
const where = p => `(${p.x}, ${p.y}, ${p.z})`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function countNames(digs) {
  const by = {};
  for (const d of digs) by[d.name] = (by[d.name] || 0) + 1;
  return Object.entries(by).map(([n, c]) => `${c} ${said(n)}`).join(', ');
}

// Every way down from the top, each with its cost. `carried` is { item:
// count }; `pickaxe` the best carried and `pickaxeUses` its uses left.
function waysDown(view, perch, { health = 20, carried = {}, pickaxe = null, pickaxeUses = 0, nether = false } = {}) {
  const { feet, cells, edges } = perch;
  const ways = {};
  // Where a ride or a step lands: somewhere a walk goes on, or another top
  // of the same tower (its own shelter rings, a ledge of its blocks).
  const stillUp = at => { try { const up = perchOf(view, at); return up ? { least: up.least } : null; } catch (_) { return null; } };
  const landsSays = up => up ? `; it lands still up on the tower, with no way down at a walk from there${up.least != null ? ` (its sides fall ${up.least} or more)` : ''}` : '; a walk goes on from there';
  const stepOver = c => c.x === feet.x && c.y === feet.y && c.z === feet.z ? '' : ` from ${where(c)} on the top, ${Math.round(Math.hypot(c.x - feet.x, c.z - feet.z)) || 1} block${Math.round(Math.hypot(c.x - feet.x, c.z - feet.z)) > 1 ? 's' : ''} over`;
  // Dig down: the column of the top that comes off it, else the one that
  // gets lowest; then the quickest.
  const columns = cells.map(c => digColumn(view, c, { pickaxe, pickaxeUses })).filter(c => !c.blocked && c.digs.length)
    .sort((a, b) => !!b.off - !!a.off || a.endsAt.y - b.endsAt.y || a.seconds - b.seconds);
  const col = columns[0];
  if (col) {
    const byHand = col.digs.filter(d => stony(d.name)).length - col.usesSpent;
    const end = col.off ? `It ends ${feet.y - col.endsAt.y} blocks lower, at ${where(col.endsAt)}${col.water ? ', in water' : ''}, where a walk goes on.`
      : col.stopsOver ? `It stops ${feet.y - col.endsAt.y} blocks lower, at ${where(col.endsAt)}, still on the tower: the ${said(col.stopsOver.name)} under the feet there has a fall of ${col.stopsOver.fall} under it (about ${col.stopsOver.damage} health), so it is not dug, and the way down is asked again from there.`
        : `It stops ${feet.y - col.endsAt.y} blocks lower, at ${where(col.endsAt)}, still on the tower (${col.stopsAt}), and the way down is asked again from there.`;
    ways.dig_down = {
      description: `Dig down through the column under the feet${stepOver(col.from)}, a block at a time, dropping with each and never into a fall that hurts: ${plural(col.digs.length, 'block')} to dig (${countNames(col.digs)}), about ${col.seconds} seconds${col.usesSpent ? `, ${plural(col.usesSpent, 'pickaxe use')}` : ''}${byHand > 0 ? `; ${plural(byHand, 'stone block')} of them by hand, ${pickaxe ? 'the pickaxe worn out before then' : 'with no pickaxe'}` : ''}; no drop on the way is more than ${plural(col.mostFall, 'block')}. ${end}`,
      plan: { kind: 'dig_down', from: col.from, endsAt: col.endsAt, off: !!col.off, seconds: col.seconds } };
  }
  // The water: poured at the feet it runs off every open side and falls to
  // the ground; the bot steps off into it and sinks down the fall, no fall
  // damage in water. Not in the Nether, where water boils away.
  if ((carried.water_bucket || 0) > 0 && !nether) {
    const rides = [];
    // An open side, or a wall of the top's own blocks dug out first: the
    // bot's night shelter on the tower is walled on every side.
    for (const c of cells) for (const [dir, d] of Object.entries(DIRS)) {
      const side = c.plus(d), wall = [side, side.plus(UP)].filter(p => solid(view.name(p))).map(p => ({ cell: p, name: view.name(p) }));
      if (wall.some(w => !diggable(w.name)) || [side, side.plus(UP)].some(p => isWater(view.name(p)) || isLava(view.name(p)) || view.name(p) == null)) continue;
      const fall = waterfall(view, side);
      if (!fall || fall.fall <= SAFE_FALL) continue;
      rides.push({ from: c, dir, side, wall, ...fall, far: Math.hypot(c.x - feet.x, c.z - feet.z) + wall.length, up: stillUp(fall.bottom) });
    }
    // Down to where a walk goes on first, then the longest ride, then the
    // nearest place to pour from.
    rides.sort((a, b) => !!a.up - !!b.up || b.fall - a.fall || a.far - b.far);
    const ride = rides[0];
    if (ride) ways.ride_water = {
      description: `${ride.wall.length ? `Dig out the ${ride.wall.map(w => said(w.name)).join(' and ')} of the wall on the ${ride.dir} side${stepOver(ride.from)}, then pour` : `Pour`} the water bucket at the feet${ride.wall.length ? '' : stepOver(ride.from)} and step off the ${ride.dir} side into the waterfall it makes: ${ride.fall} blocks down to the ${said(ride.landsOn)} at ${where(ride.bottom.plus(DOWN))}, with no fall damage in the water${landsSays(ride.up)}. The water takes about ${Math.ceil(ride.fall / 4) + 1} seconds to reach the bottom before the step; the bucket comes back empty and the water stays up here (any water refills it).`,
      plan: { kind: 'ride_water', from: ride.from, dir: ride.dir, side: ride.side, bottom: ride.bottom, fall: ride.fall, off: !ride.up, wall: ride.wall.map(w => w.cell) } };
  }
  // A side the bot survives stepping off: its fall said with its damage.
  // Armour does not soften a fall.
  const steps = edges.filter(e => !e.viaDig && (e.into === 'ground' || e.into === 'water') && (e.wall || []).every(w => diggable(w.name))).map(e => ({ ...e, damage: damageOf(e.fall, e.into), up: stillUp(e.cell.offset(0, -e.fall, 0)) }))
    .filter(e => e.damage < health - 1).sort((a, b) => !!a.up - !!b.up || a.damage - b.damage);
  const step = steps[0];
  if (step) ways.step_off = {
    description: `${step.wall?.length ? `Dig out the ${step.wall.map(w => said(w.name)).join(' and ')} of the wall on the ${step.dir} side${stepOver(step.from)} and step off there` : `Step off the ${step.dir} side${stepOver(step.from)}`}: ${step.into === 'water' ? `a drop of ${step.fall} into water, no damage` : `a fall of ${step.fall} blocks onto the ${said(step.landing || 'ground')} costs about ${step.damage} health, leaving about ${Math.round(health - step.damage)}; armour does not soften a fall`}${landsSays(step.up)}.`,
    plan: { kind: 'step_off', from: step.from, dir: step.dir, fall: step.fall, damage: step.damage, off: !step.up, wall: (step.wall || []).map(w => w.cell) } };
  return ways;
}

// What the way down is told besides its options.
function perchSays(perch) {
  const falls = perch.edges.filter(e => e.into === 'ground').map(e => e.fall);
  const lava = perch.edges.some(e => e.into === 'lava');
  return `The bot stands on a top at ${where(perch.feet)} with no way down at a walk: ${falls.length ? `its sides fall ${Math.min(...falls)} to ${Math.max(...falls)} blocks` : 'no side comes down to ground'}${lava ? ', one into lava' : ''}, and a walk will not step down more than three; a walk from up here finds no route, and one that lays blocks only builds higher.`;
}

// ---------------------------------------------------------------- live

const PICKS = ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'wooden_pickaxe'];
function liveView(bot) {
  const carried = {};
  for (const i of bot.inventory.items()) carried[i.name] = (carried[i.name] || 0) + i.count;
  const picks = bot.inventory.items().filter(i => PICKS.includes(i.name));
  const best = PICKS.find(n => picks.some(i => i.name === n)) || null;
  const uses = picks.reduce((n, i) => n + Math.max(0, (bot.registry?.itemsByName?.[i.name]?.maxDurability || 0) - (i.durabilityUsed || 0)), 0);
  return { name: p => bot.blockAt(p)?.name ?? null, carried, pickaxe: best, pickaxeUses: uses };
}

// The top the bot stands on, or null: on the ground, out of water, in the
// survival game.
function livePerch(bot) {
  try {
    if (!bot?.entity?.position || typeof bot.blockAt !== 'function' || bot.entity.onGround !== true) return null;
    if (bot.game?.gameMode && bot.game.gameMode !== 'survival') return null;
    if (bot.entity.isInWater || bot.entity.isInLava || bot.vehicle) return null;
    const feet = bot.entity.position.floored();
    return perchOf(liveView(bot), feet);
  } catch (_) { return null; }
}

// Whether a walk's goal lies on the top itself, or above it: then it is no
// walk off the top.
function goalOnTop(goal, perch) {
  if (!goal) return true;
  try {
    if (typeof goal.isEnd === 'function' && perch.cells.some(c => goal.isEnd(c))) return true;
  } catch (_) { /* a goal that cannot say */ }
  // Above the top and near it (a portal overhead the pillar climbs to);
  // a hill far off that stands higher is still reached from the ground.
  const at = Number.isFinite(goal.x) && Number.isFinite(goal.y) && Number.isFinite(goal.z) ? goal : goal.entity?.position;
  if (!at || !Number.isFinite(at.y)) return false;
  return at.y > perch.feet.y + 1 && Math.hypot(at.x - perch.feet.x, at.z - perch.feet.z) <= 8;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const centre = c => new Vec3(c.x + .5, c.y, c.z + .5);

async function stand(bot, task, cell) {
  const { move } = require('./motion');
  const here = bot.entity.position.floored();
  if (here.x !== cell.x || here.y !== cell.y || here.z !== cell.z) {
    const { goals } = require('mineflayer-pathfinder');
    await require('./skills').navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 15000, stallMs: 5000 });
  }
  // Over the middle of the column, crouched: a body half on the next block
  // is held up by it when the one under the middle goes.
  const target = centre(cell);
  const off = () => Math.hypot(bot.entity.position.x - target.x, bot.entity.position.z - target.z);
  if (off() > .15) await move(bot, task, { label: 'way_down_centre', look: target.offset(0, 1.6, 0), until: () => off() <= .15, maxMs: 1500 });
  bot.clearControlStates?.();
}

// Down and still: on the ground below `below`, or at rest in water there
// when `inWater` allows it (not while sinking down a waterfall).
async function landed(bot, task, below, ms, { inWater = true } = {}) {
  const deadline = Date.now() + ms;
  let since = 0;
  while (Date.now() < deadline) {
    task.check();
    const p = bot.entity.position;
    if ((bot.entity.onGround || (inWater && bot.entity.isInWater)) && p.y < below && Math.abs(bot.entity.velocity?.y ?? 0) < .1) {
      since ||= Date.now();
      if (Date.now() - since >= 200) return true;
    } else since = 0;
    await sleep(50);
  }
  return false;
}

async function digDown(bot, task, plan) {
  const { equipBestTool } = require('./skills');
  const { digWithAirGuard, checkAir } = require('./vitals');
  await stand(bot, task, new Vec3(plan.from.x, plan.from.y, plan.from.z));
  for (let i = 0; i < 80; i++) {
    task.check(); checkAir(bot);
    const view = liveView(bot), feet = bot.entity.position.floored();
    if (!perchOf(view, feet)) return true;
    const floor = feet.plus(DOWN), block = bot.blockAt(floor);
    if (!block || !diggable(block.name)) throw new Error(`The ${block ? said(block.name) : 'unloaded block'} under the feet cannot be dug`);
    const under = fallUnder(view, floor);
    if (under.into === 'lava' || under.into === 'unknown') throw new Error(`The column under the feet runs into ${under.into === 'lava' ? 'lava' : 'what is not loaded'}`);
    // Never into a fall that hurts: stopped there, the way down is asked
    // again from the block over it.
    if (damageOf(under.n + 1, under.into) > 0) return i > 0;
    await stand(bot, task, feet);
    await equipBestTool(bot, block);
    await digWithAirGuard(bot, task, block);
    if (!await landed(bot, task, feet.y - .5, 3000 + 150 * under.n)) throw new Error(`Did not land after digging the ${said(block.name)} at ${floor.y}`);
  }
  throw new Error('Dug eighty blocks down and still on a top');
}

// The wall between the bot and the side it goes off by: the head's block
// first, so nothing is left over the opening.
async function digWall(bot, task, cells = []) {
  const { equipBestTool } = require('./skills');
  const { digWithAirGuard } = require('./vitals');
  for (const c of [...cells].sort((a, b) => b.y - a.y)) {
    const block = bot.blockAt(new Vec3(c.x, c.y, c.z));
    if (!block || open(block.name)) continue;
    if (!diggable(block.name)) throw new Error(`The ${said(block.name)} in the wall cannot be dug`);
    await equipBestTool(bot, block);
    await digWithAirGuard(bot, task, block);
  }
}

async function rideWater(bot, task, plan) {
  const { move } = require('./motion');
  const from = new Vec3(plan.from.x, plan.from.y, plan.from.z), side = new Vec3(plan.side.x, plan.side.y, plan.side.z);
  const bottom = new Vec3(plan.bottom.x, plan.bottom.y, plan.bottom.z);
  await stand(bot, task, from);
  await digWall(bot, task, plan.wall);
  const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  if (!bucket) throw new Error('No water bucket carried');
  await bot.equip(bucket, 'hand');
  // Straight down onto the floor under the feet: the water goes into the
  // feet's own cell and runs off the open sides.
  await bot.look(bot.entity.yaw, -Math.PI / 2, true);
  bot.activateItem(); await sleep(100); bot.deactivateItem?.();
  const wet = () => isWater(bot.blockAt(from)?.name);
  for (let i = 0; i < 20 && !wet(); i++) { task.check(); await sleep(50); }
  if (!wet()) throw new Error('The water did not go down at the feet');
  // Down to the ground before the step: water runs a block every quarter
  // second, and a body outruns it.
  const deadline = Date.now() + (plan.fall / 4 + 4) * 1000;
  while (!isWater(bot.blockAt(bottom)?.name)) {
    task.check();
    if (Date.now() > deadline) throw new Error(`The waterfall did not reach the ground at ${where(bottom)}`);
    await sleep(100);
  }
  const health = bot.health;
  await move(bot, task, { label: 'way_down_waterfall', sneak: false, why: 'stepping off the top into the waterfall poured to ride down', look: centre(side).offset(0, 0.5, 0), maxMs: 2500,
    until: () => { const f = bot.entity.position.floored(); return f.x === side.x && f.z === side.z; } });
  bot.clearControlStates?.();
  if (!await landed(bot, task, bottom.y + .6, (plan.fall * 0.6 + 6) * 1000, { inWater: false })) throw new Error('Did not come down the waterfall');
  if ((bot.health ?? 20) < health - 1) console.log(`[way down] the waterfall ride cost ${Math.round(health - bot.health)} health`);
  return true;
}

async function stepOff(bot, task, plan) {
  const { move } = require('./motion');
  const from = new Vec3(plan.from.x, plan.from.y, plan.from.z), side = from.plus(DIRS[plan.dir]);
  await stand(bot, task, from);
  await digWall(bot, task, plan.wall);
  await move(bot, task, { label: 'way_down_step_off', sneak: false, why: `stepping off the top: a fall of ${plan.fall} chosen for about ${plan.damage} health`, look: centre(side).offset(0, 0.5, 0), maxMs: 2000,
    until: () => { const f = bot.entity.position.floored(); return f.x === side.x && f.z === side.z; } });
  bot.clearControlStates?.();
  if (!await landed(bot, task, from.y - 1, 3000 + plan.fall * 100)) throw new Error('Did not land after stepping off');
  return true;
}

const RUN = { dig_down: digDown, ride_water: rideWater, step_off: stepOff };
const TRIED_MS = 10 * 60000;

// Without Jev, the way that comes off the top safely, else the one that
// gets lower safely, else the fall.
function fallbackWay(ways) {
  const order = [['dig_down', w => w.plan.off], ['ride_water', w => w.plan.off], ['dig_down', () => true], ['ride_water', () => true], ['step_off', () => true]];
  return (order.find(([k, ok]) => ways[k] && ok(ways[k])) || [Object.keys(ways)[0]])[0];
}

// Before a walk off a top: asked which way down, and carried out, and
// asked again from wherever that left the bot while it is still on a top
// (a ring of the tower's own blocks, the block over a fall). True when it
// came off, false when there was no top, nothing to offer, the walk's
// goal is on the top or above it, or a way failed.
async function comeDownFirst(bot, task, walkGoal, { client = task?.opportunityClient, goal = bot?._goal, save = () => {}, rounds = 4 } = {}) {
  if (!client || bot._wayDownRunning) return false;
  let perch = livePerch(bot);
  if (!perch || goalOnTop(walkGoal, perch)) return false;
  bot._wayDownRunning = true;
  try {
    for (let round = 0; perch && round < rounds; round++) {
      // A mob at hand is the stance question's, whose come_down is its way.
      try { if (require('./danger').immediateThreat(bot)) return false; } catch (_) { /* no world */ }
      if (!await oneWayDown(bot, task, walkGoal, perch, { client, goal, save })) return false;
      perch = livePerch(bot);
    }
    return !perch;
  } finally { bot._wayDownRunning = false; }
}

async function oneWayDown(bot, task, walkGoal, perch, { client, goal, save }) {
  const view = liveView(bot), health = bot.health ?? 20;
  const ways = waysDown(view, perch, { health, carried: view.carried, pickaxe: view.pickaxe, pickaxeUses: view.pickaxeUses, nether: /nether/.test(String(bot.game?.dimension || '')) });
  if (!Object.keys(ways).length) { console.log(`[way down] none from ${where(perch.feet)}: ${perchSays(perch)}`); return false; }
  const now = Date.now();
  const tried = (bot._wayDownTried || []).filter(t => now - t.at < TRIED_MS);
  const tree = Object.fromEntries(Object.entries(ways).map(([k, w]) => [k, { description: w.description }]));
  const point = Number.isFinite(walkGoal?.x) && Number.isFinite(walkGoal?.z) ? walkGoal : walkGoal?.entity?.position;
  const state = { top: perchSays(perch), health: Math.round(health), food: bot.food,
    ...(point ? { walkingTo: `${where({ x: Math.round(point.x), y: Math.round(Number.isFinite(point.y) ? point.y : perch.feet.y), z: Math.round(point.z) })}, ${Math.round(Math.hypot(point.x - perch.feet.x, point.z - perch.feet.z))} blocks off` } : {}),
    ...(goal?.survivalAction?.action ? { walkFor: said(goal.survivalAction.action) } : goal?.step?.action ? { walkFor: said(goal.step.action) } : {}),
    carried: { waterBucket: view.carried.water_bucket || 0, buildingBlocks: ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'stone', 'andesite', 'diorite', 'granite', 'tuff'].reduce((n, k) => n + (view.carried[k] || 0), 0), pickaxe: view.pickaxe ? `${said(view.pickaxe)}, ${view.pickaxeUses} uses left` : 'none' },
    ...(tried.length ? { triedLately: tried.map(t => `${said(t.way)} ${Math.round((now - t.at) / 1000)} s ago: ${t.result}`) } : {}) };
  const { decide } = require('./decisions');
  const decision = await decide('way_down', { client, bot, task, goal, save, tree, state, context: { fallback: fallbackWay(ways) } });
  if (decision.stale) return false;
  const choice = decision.path.at(-1), way = ways[choice];
  if (!way) return false;
  const before = bot.entity.position.clone();
  try {
    bot.chat?.({ dig_down: 'No way down from up here at a walk. Digging down through the column.', ride_water: 'No way down from up here at a walk. Riding a waterfall down.', step_off: 'No way down from up here at a walk. Jumping off.' }[choice]);
    const moved = await RUN[choice](bot, task, way.plan);
    const down = Math.round(before.y - bot.entity.position.y);
    bot._wayDownTried = [...tried, { way: choice, at: Date.now(), result: moved ? `came down ${down} blocks` : 'came down nothing' }].slice(-6);
    console.log(`[way down] ${choice}: from ${where(before.floored())} to ${where(bot.entity.position.floored())}`);
    return !!moved && down > 0;
  } catch (err) {
    task.check();
    if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err;
    bot._wayDownTried = [...tried, { way: choice, at: Date.now(), result: `failed after coming down ${Math.max(0, Math.round(before.y - bot.entity.position.y))} blocks: ${String(err.message || err).slice(0, 120)}` }].slice(-6);
    console.log(`[way down] ${choice} failed: ${err.message}`);
    return false;
  } finally { bot.clearControlStates?.(); }
}

module.exports = { perchOf, waysDown, digColumn, digSeconds, fallUnder, perchSays, livePerch, liveView, goalOnTop, comeDownFirst, fallbackWay, digDown, rideWater, stepOff, SAFE_FALL };

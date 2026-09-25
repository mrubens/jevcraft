'use strict';
// Getting unstuck, one move at a time, chosen by Jev. The escape routines
// grew one per trap (a step placed at the waterline, a notch cut in the
// bank, a staircase, a lid dug, a pillar), each with its own order and its
// own give-up rule. Here the code lists the single moves possible from
// where the bot stands, each with what the code can work out about it
// (what would be dug, what would fall or flow in, whether it gains height,
// whether it ends on dry ground or under open sky, how often the bot has
// stood there), and Jev picks the next one. The code does it, looks again,
// and asks again.
//
// It works on a view of the world rather than the bot, so a replay of a
// trap and the live bot use the same moves:
//   view.name(p)      the block name at p (a Vec3)
//   view.carried      { item: count }
//   view.pickaxe      the best pickaxe carried, or null
const { Vec3 } = require('vec3');
const { natural } = require('./tunneling');

const DIRS = { north: new Vec3(0, 0, -1), east: new Vec3(1, 0, 0), south: new Vec3(0, 0, 1), west: new Vec3(-1, 0, 0) };
const UP = new Vec3(0, 1, 0), DOWN = new Vec3(0, -1, 0);
const OPEN = /^(air|cave_air|void_air|short_grass|tall_grass|fern|large_fern|dead_bush|snow|leaf_litter|torch|wall_torch|.*_flower|dandelion|poppy|vine|glow_lichen)$/;
const isWater = n => /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(n || '');
const isLava = n => /lava/.test(n || '');
const falls = n => /^(sand|red_sand|gravel)$|_concrete_powder$/.test(n || '');
const open = n => OPEN.test(n || '') || isWater(n);
const solid = n => !!n && !open(n) && !isLava(n);
const PLACEABLE = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'andesite', 'diorite', 'granite', 'tuff', 'stone', 'deepslate', 'sandstone', 'gravel', 'sand'];
const ORE = /_ore$/;
// Stone and ore take a pickaxe; the rest comes away in the hand.
function digSeconds(name, view, inWater) {
  const stony = /stone|deepslate|granite|diorite|andesite|tuff|calcite|terracotta|basalt|netherrack/.test(name) || ORE.test(name);
  if (stony && !view.pickaxe) return null;
  const s = stony ? (view.pickaxe === 'wooden_pickaxe' ? 1.2 : 0.6) : 0.5;
  return Math.round(s * (inWater ? 5 : 1) * 10) / 10;
}

// Open sky over a cell: nothing but open blocks up to the top of the view.
function skyAbove(view, p, reach = 40) {
  for (let y = 1; y <= reach; y++) { const n = view.name(p.offset(0, y, 0)); if (n == null) return true; if (!open(n) || isWater(n)) return false; }
  return true;
}
const dryFooting = (view, feet) => !isWater(view.name(feet)) && solid(view.name(feet.plus(DOWN)));
// At the surface, not at the bottom of a hole: open sky here, and a cell
// beside at the same level open to the sky too.
const atSurface = (view, feet) => skyAbove(view, feet) && Object.values(DIRS).some(d => open(view.name(feet.plus(d))) && !isWater(view.name(feet.plus(d))) && skyAbove(view, feet.plus(d)));

// What digging a cell would do, besides open it: sand or gravel over it
// comes down, and water or lava beside or over it flows in.
function digEffects(view, cell, bot = null) {
  const effects = [];
  let fallen = 0;
  for (let y = 1; y <= 8 && falls(view.name(cell.offset(0, y, 0))); y++) fallen++;
  if (fallen) effects.push(`${fallen} block${fallen > 1 ? 's' : ''} of ${view.name(cell.offset(0, 1, 0)).replaceAll('_', ' ')} above would fall into it${bot && cell.x === bot.x && cell.z === bot.z && cell.y > bot.y ? ', onto the bot\'s head' : ''}`);
  const touching = [UP, ...Object.values(DIRS)].map(d => view.name(cell.plus(d)));
  if (touching.some(isLava)) effects.push('lava beside it would flow in');
  else if (touching.some(isWater)) effects.push('water beside it would flow in');
  return effects;
}

// What a dug cell opens onto: the cell past it, the way the dig goes. The
// digs round trial 63's bot all said "water beside it would flow in", the
// same for the one that opened onto a dry cave and the one under a lake;
// Jev dug up into the lake and the bot drowned.
function opensOnto(view, beyond) {
  const n = view.name(beyond);
  if (n == null) return 'what is past it is not loaded';
  if (isLava(n)) return 'it opens onto lava';
  if (isWater(n)) return 'it opens onto water';
  if (open(n)) return 'it opens onto open air';
  return `past it is more ${n.replaceAll('_', ' ')}`;
}

// Every single move from here, each with its facts. `goal` is 'dry' (out
// of water onto solid ground) or 'sky' (open sky over dry ground).
function localMoves(view, feet, { goal = 'sky', visits = {}, target = null, from = null } = {}) {
  const moves = [];
  const inWater = isWater(view.name(feet));
  const headroom = open(view.name(feet.offset(0, 2, 0))) && !isWater(view.name(feet.offset(0, 2, 0)));
  const where = p => {
    const facts = { endsAt: { x: p.x, y: p.y, z: p.z }, rises: p.y - feet.y, dryFooting: dryFooting(view, p), openSkyAbove: skyAbove(view, p), atSurface: atSurface(view, p), timesStoodThere: visits[`${p}`] || 0 };
    // Under water, whether the head comes up into air there: trial 63
    // swam up into a flooded cell under a stone lid and drowned.
    if (inWater) facts.breathes = !isWater(view.name(p.plus(UP))) && open(view.name(p.plus(UP)));
    if (target) facts.blocksToTarget = Math.round(p.distanceTo(target));
    if (from) facts.blocksFromStart = Math.round(Math.hypot(p.x - from.x, p.z - from.z));
    return facts;
  };
  const standable = p => open(view.name(p)) && open(view.name(p.plus(UP))) && !isLava(view.name(p)) && !isLava(view.name(p.plus(UP)));
  for (const [dir, d] of Object.entries(DIRS)) {
    const level = feet.plus(d);
    // A walk or a swim to the next cell at the same level, dropping at most
    // three onto something solid.
    if (standable(level)) {
      let land = level;
      for (let n = 0; n < 3 && !isWater(view.name(land)) && open(view.name(land.plus(DOWN))) && !isLava(view.name(land.plus(DOWN))); n++) land = land.plus(DOWN);
      if (isWater(view.name(land)) || solid(view.name(land.plus(DOWN)))) moves.push({ key: `step_${dir}`, does: `${inWater ? 'Swim' : 'Walk'} one block ${dir}${land.y < feet.y ? `, dropping ${feet.y - land.y}` : ''}.`, kind: 'move', to: land, ...where(land) });
    }
    // Up a block onto the next cell: the cell over the head must be open to
    // rise into, out of water too (the game lifts a swimmer only then).
    const up = level.plus(UP);
    if (headroom && solid(view.name(level)) && standable(up)) moves.push({ key: `climb_${dir}`, does: `${inWater ? 'Climb out of the water' : 'Jump up'} onto the block ${dir}.`, kind: 'move', to: up, ...where(up) });
    // A block dug beside: at the feet, at the head, or one over (for a climb).
    for (const [part, cell] of [['feet', level], ['head', level.plus(UP)], ['over', level.offset(0, 2, 0)]]) {
      const name = view.name(cell);
      if (!solid(name) || !natural.test(name)) continue;
      const seconds = digSeconds(name, view, inWater);
      if (seconds == null) continue;
      moves.push({ key: `dig_${dir}_${part}`, does: `Dig the ${name.replaceAll('_', ' ')} ${dir}, at ${part === 'over' ? 'the level over the head' : `${part} height`} (about ${seconds} s).`, kind: 'dig', cell, effects: [opensOnto(view, cell.plus(d)), ...digEffects(view, cell, feet)] });
    }
    // A block placed into water or air beside, at the feet: a step at the
    // waterline, or a wall.
    const block = PLACEABLE.find(n => (view.carried?.[n] || 0) > 0);
    if (block && open(view.name(level)) && [DOWN, ...Object.values(DIRS)].some(f => solid(view.name(level.plus(f))))) {
      moves.push({ key: `place_${dir}`, does: `Put a ${block.replaceAll('_', ' ')} into the ${isWater(view.name(level)) ? 'water' : 'space'} ${dir}, at the feet: a step up${inWater ? ' out of the water' : ''}.`, kind: 'place', cell: level, block });
    }
  }
  // Straight up: dig what is over the head, swim up, or pillar.
  const over = feet.offset(0, 2, 0), overName = view.name(over);
  if (solid(overName) && natural.test(overName)) {
    const seconds = digSeconds(overName, view, inWater);
    if (seconds != null) moves.push({ key: 'dig_up', does: `Dig the ${overName.replaceAll('_', ' ')} over the head (about ${seconds} s).`, kind: 'dig', cell: over, effects: [opensOnto(view, over.plus(UP)), ...digEffects(view, over, feet)] });
  }
  if (inWater && isWater(view.name(feet.plus(UP)))) moves.push({ key: 'swim_up', does: 'Swim up a block.', kind: 'move', to: feet.plus(UP), ...where(feet.plus(UP)) });
  const block = PLACEABLE.find(n => (view.carried?.[n] || 0) > 0);
  if (block && !inWater && headroom && solid(view.name(feet.plus(DOWN)))) moves.push({ key: 'pillar', does: `Jump and put a ${block.replaceAll('_', ' ')} under the feet: up a block where it stands.`, kind: 'pillar', block, to: feet.plus(UP), ...where(feet.plus(UP)) });
  // Down: dig the floor, when not over water or lava.
  const floor = feet.plus(DOWN), floorName = view.name(floor);
  if (!inWater && solid(floorName) && natural.test(floorName) && !isWater(view.name(floor.plus(DOWN))) && !isLava(view.name(floor.plus(DOWN)))) {
    const seconds = digSeconds(floorName, view, false);
    if (seconds != null) moves.push({ key: 'dig_down', does: `Dig the ${floorName.replaceAll('_', ' ')} underfoot and drop a block (about ${seconds} s).`, kind: 'dig', cell: floor, effects: digEffects(view, floor) });
  }
  // 'away': off a spot every walk failed from, onto dry ground eight blocks off.
  const done = goal === 'dry' ? dryFooting(view, feet)
    : goal === 'away' ? dryFooting(view, feet) && !!from && Math.hypot(feet.x - from.x, feet.z - from.z) >= 8
      : dryFooting(view, feet) && atSurface(view, feet);
  return { moves, done, here: { feet: { x: feet.x, y: feet.y, z: feet.z }, inWater, headInWater: isWater(view.name(feet.plus(UP))), headroomToRise: headroom, dryFooting: dryFooting(view, feet), openSkyAbove: skyAbove(view, feet), atSurface: atSurface(view, feet) } };
}

// The moves as Jev is shown them: one option each, with its facts.
function describeMove(m) {
  const facts = [];
  if (m.effects?.length) facts.push(m.effects.join('; '));
  if (m.to) {
    facts.push(m.rises > 0 ? `rises ${m.rises}` : m.rises < 0 ? `goes down ${-m.rises}` : 'same level');
    if (m.dryFooting) facts.push('ends on dry ground');
    if (m.breathes === true) facts.push('the head comes out into air there');
    else if (m.breathes === false) facts.push('the head is still under water there');
    if (m.atSurface) facts.push('ends at the surface');
    else if (m.openSkyAbove) facts.push('ends under open sky, in a hole');
    if (m.timesStoodThere) facts.push(`stood there ${m.timesStoodThere} time${m.timesStoodThere > 1 ? 's' : ''} already`);
    if (m.blocksToTarget != null) facts.push(`${m.blocksToTarget} blocks from the target after`);
    if (m.blocksFromStart != null) facts.push(`${m.blocksFromStart} blocks from where it got stuck`);
  }
  return `${m.does}${facts.length ? ` ${facts.join('; ')}.` : ''}`;
}

// The live bot's view: the blocks it sees and what it carries.
const PICKS = ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'wooden_pickaxe'];
function liveView(bot) {
  const carried = {};
  for (const i of bot.inventory.items()) carried[i.name] = (carried[i.name] || 0) + i.count;
  return { name: p => bot.blockAt(p)?.name ?? null, carried, pickaxe: PICKS.find(n => carried[n]) || null };
}

// Where the bot has to get: out of water onto dry ground, or up to the
// surface. Null where it is neither in water nor under cover.
function aimFor(bot, { walksFailing = false } = {}) {
  const view = liveView(bot), feet = bot.entity.position.floored();
  if (isWater(view.name(feet))) return { goal: 'dry', aim: 'out of the water onto dry ground' };
  // Below the surface as the rest of the bot judges it (surface.js): at
  // the bottom of an open shaft the sky is in view and the bot is still in
  // a hole.
  const surface = require('./surface');
  if (surface.hasSurface(bot) && !surface.surfaceObserver(bot)(bot.entity.position) && !atSurface(view, feet)) return { goal: 'sky', aim: 'up to dry ground at the surface' };
  // On the surface with every walk failing from here: trial 34 stood six
  // minutes in an alcove on a mountainside, a cliff on the open side, every
  // route out needing a dig or a climb a walk will not make.
  if (walksFailing) return { goal: 'away', aim: 'off this spot, onto dry ground at least eight blocks away', from: { x: feet.x, y: feet.y, z: feet.z } };
  return null;
}

// One move, done on the live bot.
async function perform(bot, task, m, { dig }) {
  const { move } = require('./motion');
  const feet = bot.entity.position.floored();
  const inWater = isWater(bot.blockAt(feet)?.name);
  const equipBlock = async name => { const item = bot.inventory.items().find(i => i.name === name); if (!item) throw new Error(`No ${name} carried`); await bot.equip(item, 'hand'); };
  if (m.kind === 'move') {
    const to = m.to, up = to.y > feet.y;
    const keys = m.key === 'swim_up' ? ['jump'] : up || inWater ? ['forward', 'jump'] : ['forward'];
    await move(bot, task, { label: `unstuck_${m.key}`, keys, sneak: false, why: `one move out of being stuck: ${m.key.replaceAll('_', ' ')}`,
      look: to.offset(0.5, up ? 1.1 : 0.6, 0.5), maxMs: 2500, tick: 50,
      until: () => { const f = bot.entity.position.floored(); return m.key === 'swim_up' ? f.y >= to.y : f.x === to.x && f.z === to.z && f.y >= to.y - (to.y < feet.y ? 3 : 0) && (bot.entity.onGround || isWater(bot.blockAt(f)?.name)); } });
    return;
  }
  if (m.kind === 'dig') { await dig(bot, task, m.cell, { requireDrops: false }); return; }
  if (m.kind === 'place') {
    await equipBlock(m.block);
    const faces = [DOWN, ...Object.values(DIRS)].map(f => [m.cell.plus(f), f.scaled(-1)]);
    const anchor = faces.find(([p]) => solid(bot.blockAt(p)?.name));
    if (!anchor) throw new Error('Nothing solid to place against');
    await bot.placeBlock(bot.blockAt(anchor[0]), anchor[1]);
    return;
  }
  if (m.kind === 'pillar') {
    // One block of the pillar routine: the look down first, the block placed
    // a tick after the feet clear the cell.
    const placed = await require('./pillar-recovery').pillarUp(bot, task, feet.y + 1, { dig, maxBlocks: 1, threats: false });
    if (!placed) throw new Error('The block did not go under the feet');
  }
}

// Working free, Jev choosing each move: until the bot is where it has to
// be, the moves run out, or four in a row change nothing.
async function workFree(bot, task, goal, save, { client, dig, maxMoves = 24, aim = aimFor(bot) } = {}) {
  if (!aim || !client) return false;
  const { decide } = require('./decisions');
  const fatal = err => ['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err?.name);
  const record = goal.unstuck = { aim: aim.aim, since: new Date().toISOString(), moves: [], visits: {} };
  bot.chat?.(`Stuck. Working my way ${aim.goal === 'dry' ? 'out of the water' : aim.goal === 'away' ? 'off this spot' : 'up'} one move at a time.`);
  let still = 0;
  for (let n = 0; n < maxMoves; n++) {
    task.check();
    const feet = bot.entity.position.floored();
    record.visits[`${feet}`] = (record.visits[`${feet}`] || 0) + 1;
    const view = liveView(bot);
    const { moves, done, here } = localMoves(view, feet, { goal: aim.goal, visits: record.visits, from: aim.from ? new Vec3(aim.from.x, aim.from.y, aim.from.z) : null });
    const surfaced = aim.goal === 'sky' && here.dryFooting && require('./surface').surfaceObserver(bot)(bot.entity.position);
    if (done || surfaced) { record.out = true; save(); return true; }
    if (!moves.length) return false;
    const tree = Object.fromEntries(moves.map(m => [m.key, { description: describeMove(m) }]));
    const decision = await decide('unstuck_move', { client, bot, task, goal, save, tree,
      // Breath, in seconds: a full bar is fifteen under water.
      state: { aim: aim.aim, here, carried: view.carried, recentMoves: record.moves.slice(-6), health: bot.health, food: bot.food,
        ...(here.inWater ? { breathSecondsLeft: Math.round((bot.oxygenLevel ?? 20) * 0.75) } : {}) } });
    if (decision.stale) continue;
    const m = moves.find(x => x.key === decision.path.at(-1));
    const before = bot.entity.position.clone(), blocks = m.cell ? bot.blockAt(m.cell)?.name : null;
    goal.step = { action: 'work_free', move: m.key, aim: aim.goal }; save();
    let failure = null;
    try { await perform(bot, task, m, { dig }); }
    catch (err) { task.check(); if (fatal(err)) throw err; failure = err.message; }
    const after = bot.entity.position.floored();
    const changed = before.distanceTo(bot.entity.position) >= 0.5 || (m.cell && bot.blockAt(m.cell)?.name !== blocks);
    still = changed ? 0 : still + 1;
    record.moves.push({ move: m.key, result: failure ? `failed: ${failure}` : `${changed ? '' : 'nothing changed; '}now at ${after.x},${after.y},${after.z}` });
    save();
    if (still >= 4) return false;
  }
  return false;
}

module.exports = { liveView, aimFor, perform, workFree, localMoves, describeMove, atSurface, skyAbove, dryFooting, digEffects, DIRS, isWater, falls, open, solid };

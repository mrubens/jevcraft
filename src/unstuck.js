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
const terrain = require('./terrain');

const DIRS = { north: new Vec3(0, 0, -1), east: new Vec3(1, 0, 0), south: new Vec3(0, 0, 1), west: new Vec3(-1, 0, 0) };
const UP = new Vec3(0, 1, 0), DOWN = new Vec3(0, -1, 0);
const OPEN = /^(air|cave_air|void_air|short_grass|tall_grass|fern|large_fern|dead_bush|snow|leaf_litter|torch|wall_torch|.*_flower|dandelion|poppy|vine|glow_lichen)$/;
const isWater = n => /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(n || '');
const isLava = n => /lava/.test(n || '');
const falls = n => /^(sand|red_sand|gravel)$|_concrete_powder$/.test(n || '');
const open = n => OPEN.test(n || '') || isWater(n);
const solid = n => !!n && !open(n) && !isLava(n);
// The wart blocks too, as a span is laid with them (bridging.js LAID, note
// 622): at the end of its own span twenty over the floor with thirty-two
// warped wart blocks carried, the one block offered to put was gravel.
const PLACEABLE = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'andesite', 'diorite', 'granite', 'tuff', 'stone', 'deepslate', 'sandstone', 'nether_wart_block', 'warped_wart_block', 'gravel', 'sand'];
const ORE = /_ore$/;
// Stone and ore take a pickaxe; the rest comes away in the hand.
function digSeconds(name, view, inWater) {
  const stony = /stone|deepslate|granite|diorite|andesite|tuff|calcite|terracotta|basalt|netherrack/.test(name) || ORE.test(name);
  if (stony && !view.pickaxe) return null;
  // Wood by hand is slow: a plank is three seconds without an axe (note 615).
  const woody = /_planks$|_log$|_wood$|_stem$|_hyphae$|_fence$|_slab$|_stairs$/.test(name) && !/^nether_brick/.test(name);
  const s = stony ? (view.pickaxe === 'wooden_pickaxe' ? 1.2 : 0.6) : woody ? (view.axe ? 0.6 : 3) : 0.5;
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
  // Over the bot's head, what flows in comes down on it: trial 77 dug up
  // out of the top of its own pillar shaft into rock with water beside it,
  // told only that the water "would flow in", and the water filled the
  // shaft it stood in.
  const overhead = bot && cell.x === bot.x && cell.z === bot.z && cell.y > bot.y;
  const shaft = overhead && [bot, bot.plus(UP)].every(c => Object.values(DIRS).every(d => solid(view.name(c.plus(d)))));
  if (touching.some(isLava)) effects.push(overhead ? 'lava beside it would pour down onto the bot' : 'lava beside it would flow in');
  else if (touching.some(isWater)) effects.push(overhead ? `water beside it would pour down onto the bot${shaft ? ' and fill the one-block shaft it stands in, with no way to swim out' : ''}` : 'water beside it would flow in');
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

// Where the air is through the water a dig lets in: the swim from the feet,
// through the dug cell and the water past it, to a water cell with air
// over it, within `reach` blocks' swim; and whether that water stands at
// the head's height, so the pocket fills over the head. mid-244-y dug into
// a sealed lake whose air was twenty blocks off, told only "it opens onto
// water", and drowned under its lid (note 477).
function waterAir(view, cell, feet, { reach = 32, nodes = 4096 } = {}) {
  const queue = [{ p: cell, n: 1 }], seen = new Set([`${cell}`]);
  let floods = false;
  for (let i = 0; i < queue.length && i < nodes; i++) {
    const { p, n } = queue[i];
    if (isWater(view.name(p)) && p.y >= feet.y + 1) floods = true;
    const over = view.name(p.plus(UP));
    if (i > 0 && isWater(view.name(p)) && over != null && open(over) && !isWater(over)) return { swim: n, floods: floods || p.y >= feet.y + 1 };
    if (n >= reach) continue;
    for (const d of [UP, ...Object.values(DIRS), DOWN]) {
      const next = p.plus(d);
      if (seen.has(`${next}`) || !isWater(view.name(next))) continue;
      seen.add(`${next}`); queue.push({ p: next, n: n + 1 });
    }
  }
  return { swim: null, floods };
}

// A block at p for the lava rules (terrain.js standsInLava, hangingFloor):
// the live view's own, or one made from the name (a replay's view).
function blockOf(view, p) {
  if (typeof view.block === 'function') return view.block(p);
  const n = view.name(p);
  if (n == null) return null;
  return { name: n, boundingBox: solid(n) ? 'block' : 'empty' };
}
const atOfView = view => q => blockOf(view, new Vec3(q.x, q.y, q.z));
// Where the body stands at `feet` is in lava: the game's own test, the
// body's box against each lava cell's surface over the floor (note 580).
const landsInLava = (view, feet) => terrain.standsInLava(atOfView(view), feet);

// The fall under an opened cell, down to the next solid block or water:
// a dig down or to the side was told what it opened onto and nothing of
// the drop past it (the decision audit, 2026-09-25). A fall of more than
// three blocks hurts, a point a block past three. A fall that ends in lava
// says so, with what a touch costs this body (view.lavaTouch): on 25583
// the step south was told "one block past it, a drop of 7 blocks under it:
// falling 7 blocks costs about 4 health", and the seven blocks ended in
// the lava sea; the step ran on past its cell and the body burned from
// 19.6 to nothing (note 600).
function dropInto(view, cell, { reach = 24 } = {}) {
  let n = 0;
  for (; n < reach; n++) {
    const name = view.name(cell.offset(0, -n - 1, 0));
    if (name == null) return { n, into: 'unknown' };
    if (isWater(name)) return { n, into: 'water' };
    if (isLava(name)) return { n, into: 'lava' };
    if (!open(name)) return { n, into: 'ground' };
  }
  return { n, into: 'none' };
}
function dropBelow(view, cell, { reach = 24, extra = 0 } = {}) {
  const { n, into } = dropInto(view, cell, { reach });
  if (into === 'lava') return `${n ? `a drop of ${n} block${n === 1 ? '' : 's'} into lava under it` : 'lava right under it'}: a fall there is into the lava${view.lavaTouch ? ` (${view.lavaTouch})` : ''}`;
  if (!n) return null;
  if (into === 'unknown') return `a drop of ${n}+ blocks under it, the rest not loaded`;
  if (into === 'water') return `a drop of ${n} block${n === 1 ? '' : 's'} into water under it`;
  if (into === 'none') return `no floor within ${reach} blocks under it: a fall that costs ${reach + extra - 3} health or more${ofHealth(view, reach + extra - 3)}`;
  const fall = n + extra;
  return `a drop of ${n} block${n === 1 ? '' : 's'} under it${fall > 3 ? `: falling ${fall} blocks costs about ${fall - 3} health${ofHealth(view, fall - 3)}` : ''}`;
}
// A fall's cost against the health the bot has, as a touch of lava is
// (terrain.js lavaTouchSays): at 1.1 health for twenty minutes, mid-242-
// ah-nether-1-fortress-5's steps were said "falling 20 blocks costs about
// 17 health" and nothing of what that is to 1.1 (note 622).
function ofHealth(view, damage) {
  const hp = Number.isFinite(view.health) ? Math.round(view.health * 10) / 10 : null;
  if (hp === null) return '';
  return damage >= hp ? `, more than the ${hp} health the bot has: the fall is death` : `, of the ${hp} health the bot has`;
}

// A block dug to work free: natural ground, or one the bot laid itself
// (view.laid, own-blocks.js), whatever it is made of. Planks are not
// ground, and a house is left standing; but the cover the bot put round
// itself is its own to leave through: two trials walled in by the oak
// planks of their own cover were offered only a cobblestone into the one
// open cell and the dig of it again, for eighty and ninety minutes (note
// 615).
const laidOf = (view, p) => (typeof view.laid === 'function' ? view.laid(p) : null) || null;
const diggable = (view, p, name) => solid(name) && (natural.test(name) || !!laidOf(view, p));
const hhmm = at => new Date(at).toISOString().slice(11, 16);
function ownSays(view, p) {
  if (natural.test(view.name(p) || '')) return '';
  const laid = laidOf(view, p);
  return laid ? `, a block the bot laid itself${Number.isFinite(laid.at) ? ` at ${hhmm(laid.at)}Z` : ''}` : '';
}

// Every single move from here, each with its facts. `goal` is 'dry' (out
// of water onto solid ground) or 'sky' (open sky over dry ground).
// `breathS` is the breath there is, in seconds, less the margin (a full bar
// by default).
function localMoves(view, feet, { goal = 'sky', visits = {}, target = null, from = null, breathS = 13 } = {}) {
  let moves = [];
  const notOffered = [];
  const inWater = isWater(view.name(feet));
  const headroom = open(view.name(feet.offset(0, 2, 0))) && !isWater(view.name(feet.offset(0, 2, 0)));
  const where = p => {
    const facts = { endsAt: { x: p.x, y: p.y, z: p.z }, rises: p.y - feet.y, dryFooting: dryFooting(view, p), openSkyAbove: skyAbove(view, p), atSurface: atSurface(view, p), timesStoodThere: visits[`${p}`] || 0 };
    // Under water, whether the head comes up into air there: trial 63
    // swam up into a flooded cell under a stone lid and drowned.
    if (inWater) facts.breathes = !isWater(view.name(p.plus(UP))) && open(view.name(p.plus(UP)));
    // Under water there, how far up the air is, or that the water runs to a
    // ceiling: trial 77 swam up a column flooded to the rock, "up" being
    // the aim, and drowned at the top of it.
    if (isWater(view.name(p.plus(UP)))) {
      let n = 2;
      while (n < 24 && isWater(view.name(p.offset(0, n, 0)))) n++;
      const top = view.name(p.offset(0, n, 0));
      facts.airUp = top != null && open(top) && !isWater(top) ? n : null;
      facts.ceilingUp = facts.airUp == null && top != null ? n : null;
    }
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
      // What lies one past it, where a step that runs on ends up: mid-236-h
      // swam a block south onto dry ground, ran on past it and fell
      // fifty-eight blocks into a ravine the option never named (note 474).
      const past = land.plus(d), pastOpen = open(view.name(past)) && open(view.name(past.plus(UP)));
      const pastDrop = pastOpen ? dropBelow(view, past) : null;
      // Past it into lava: the step is crouched where it stays level, and
      // said, a run past its cell being a fall into the lava (note 600).
      const pastLava = pastOpen && dropInto(view, past).into === 'lava';
      if (isWater(view.name(land)) || solid(view.name(land.plus(DOWN)))) moves.push({ key: `step_${dir}`, does: `${inWater ? 'Swim' : 'Walk'} one block ${dir}${land.y < feet.y ? `, dropping ${feet.y - land.y}` : ''}.`, kind: 'move', to: land, ...(pastDrop ? { effects: [`one block past it, ${pastDrop}`] } : {}), ...(pastLava ? { pastLava: true } : {}), ...where(land) });
    }
    // Up a block onto the next cell: the cell over the head must be open to
    // rise into, out of water too (the game lifts a swimmer only then).
    const up = level.plus(UP);
    if (headroom && solid(view.name(level)) && standable(up)) moves.push({ key: `climb_${dir}`, does: `${inWater ? 'Climb out of the water' : 'Jump up'} onto the block ${dir}.`, kind: 'move', to: up, ...where(up) });
    // A block dug beside: at the feet, at the head, or one over (for a climb).
    for (const [part, cell] of [['feet', level], ['head', level.plus(UP)], ['over', level.offset(0, 2, 0)]]) {
      const name = view.name(cell);
      if (!diggable(view, cell, name)) continue;
      const seconds = digSeconds(name, view, inWater);
      if (seconds == null) continue;
      const drop = part !== 'over' && (part === 'feet' || open(view.name(level))) ? dropBelow(view, level) : null;
      moves.push({ key: `dig_${dir}_${part}`, does: `Dig the ${name.replaceAll('_', ' ')} ${dir}, at ${part === 'over' ? 'the level over the head' : `${part} height`}${ownSays(view, cell)} (about ${seconds} s).`, kind: 'dig', cell, seconds, effects: [opensOnto(view, cell.plus(d)), ...(drop ? [drop] : []), ...digEffects(view, cell, feet)] });
    }
    // A block placed into water or air beside, at the feet: a step at the
    // waterline, or a wall.
    // Gravel or sand put where nothing holds it under falls at once: not a
    // step. On 25592 a gravel went into the space east over a fifteen-block
    // drop, fell into the lava sea, and the climb onto it read the block
    // before it went and took the body down after it (note 600).
    const holdsUnder = solid(view.name(level.plus(DOWN)));
    const block = PLACEABLE.find(n => (view.carried?.[n] || 0) > 0 && (holdsUnder || !falls(n)));
    const fallsOnly = !block && open(view.name(level)) && !isWater(view.name(level)) && PLACEABLE.some(n => (view.carried?.[n] || 0) > 0);
    if (fallsOnly) notOffered.push(`place ${dir}: a block that falls (${PLACEABLE.filter(n => (view.carried?.[n] || 0) > 0).map(n => n.replaceAll("_", " ")).join(", ")}) put there falls at once, nothing under it holding it${(() => { const d = dropBelow(view, level); return d ? ` (${d})` : ""; })()}`);
    if (block && open(view.name(level)) && [DOWN, ...Object.values(DIRS)].some(f => solid(view.name(level.plus(f))))) {
      // A step out of the water only where there is air over the step: in a
      // column flooded to its ceiling it is a block with water on it.
      // first-days-232 was offered "a step up out of the water" twice under
      // a granite lid with nine seconds of breath, and drowned (2026-09-26).
      const over = view.name(level.plus(UP)), overThat = view.name(level.offset(0, 2, 0));
      const stepOut = !inWater || (open(over) && !isWater(over) && open(overThat) && !isWater(overThat));
      moves.push({ key: `place_${dir}`, does: `Put a ${block.replaceAll('_', ' ')} into the ${isWater(view.name(level)) ? 'water' : 'space'} ${dir}, at the feet: ${stepOut ? `a step up${inWater ? ' out of the water' : ''}` : 'a block to stand on, with water over it: still under water there'}.`, kind: 'place', cell: level, block });
    }
  }
  // Straight up: dig what is over the head, swim up, or pillar.
  const over = feet.offset(0, 2, 0), overName = view.name(over);
  if (diggable(view, over, overName)) {
    const seconds = digSeconds(overName, view, inWater);
    if (seconds != null) moves.push({ key: 'dig_up', does: `Dig the ${overName.replaceAll('_', ' ')} over the head${ownSays(view, over)} (about ${seconds} s).`, kind: 'dig', cell: over, seconds, effects: [opensOnto(view, over.plus(UP)), ...digEffects(view, over, feet)] });
  }
  if (inWater && isWater(view.name(feet.plus(UP)))) moves.push({ key: 'swim_up', does: 'Swim up a block.', kind: 'move', to: feet.plus(UP), ...where(feet.plus(UP)) });
  const block = PLACEABLE.find(n => (view.carried?.[n] || 0) > 0);
  if (block && !inWater && headroom && solid(view.name(feet.plus(DOWN)))) moves.push({ key: 'pillar', does: `Jump and put a ${block.replaceAll('_', ' ')} under the feet: up a block where it stands.`, kind: 'pillar', block, to: feet.plus(UP), ...where(feet.plus(UP)) });
  // Down: dig the floor, when not over water or lava.
  const floor = feet.plus(DOWN), floorName = view.name(floor);
  if (!inWater && diggable(view, floor, floorName) && !isWater(view.name(floor.plus(DOWN))) && !isLava(view.name(floor.plus(DOWN)))) {
    const seconds = digSeconds(floorName, view, false);
    const drop = dropBelow(view, floor, { extra: 1 });
    if (seconds != null) moves.push({ key: 'dig_down', does: `Dig the ${floorName.replaceAll('_', ' ')} underfoot${ownSays(view, floor)} and drop a block (about ${seconds} s).`, kind: 'dig', cell: floor, seconds, effects: [opensOnto(view, floor.plus(DOWN)), ...(drop ? [drop] : []), ...digEffects(view, floor)] });
  }
  // 'away': off a spot every walk failed from, onto dry ground eight blocks off.
  const done = goal === 'dry' ? dryFooting(view, feet)
    : goal === 'away' ? dryFooting(view, feet) && !!from && Math.hypot(feet.x - from.x, feet.z - from.z) >= 8
      : dryFooting(view, feet) && atSurface(view, feet);
  // No dig that lets lava in beside the body: it runs into the bot's cells
  // in a second. mid-92-s, working up out of a night mine, dug the rock
  // beside and over its head with lava behind it, the option saying so,
  // and burned in what poured in (2026-09-26). The other moves stay Jev's.
  moves = moves.filter(m => m.kind !== 'dig' || !(m.effects || []).some(e => /^lava beside it/.test(e)));
  // No move that ends with the body in lava (terrain.js standsInLava: a
  // floor under the lava's surface, the soul sand shore of note 580), and
  // none that drops the floor stood on into lava or a fall of half the
  // health (a block laid or dug beside the lowest of a column of gravel or
  // sand resting on nothing, note 592). Physical safety: said in `here`,
  // not offered.
  const at = atOfView(view), body = { x: feet.x + 0.5, y: feet.y, z: feet.z + 0.5 };
  moves = moves.filter(m => {
    if (m.to && landsInLava(view, m.to)) { notOffered.push(`${m.key.replaceAll('_', ' ')}: the body would stand in lava at (${m.to.x}, ${m.to.y}, ${m.to.z})`); return false; }
    // The floor dug out from under the feet: the body falls where the dig opens.
    if (m.key === 'dig_down' && dropInto(view, m.cell).into === 'lava') { notOffered.push(`dig down: the body would fall into lava under (${m.cell.x}, ${m.cell.y}, ${m.cell.z})`); return false; }
    // The one check every dig near the body goes through (terrain.js
    // digExposes, the dig guard on bot.dig): said here, not offered.
    const exposes = m.kind === 'dig' ? terrain.digExposes(at, body, m.cell, { health: view.health ?? 20 }) : null;
    if (exposes) { notOffered.push(`${m.key.replaceAll('_', ' ')}: ${exposes}`); return false; }
    const changed = m.kind === 'pillar' ? feet : m.cell;
    const drops = changed && !inWater ? terrain.floorDrops(at, floor, changed) : null;
    if (drops && terrain.floorDropDeadly(drops, view.health ?? 20)) { notOffered.push(`${m.key.replaceAll('_', ' ')}: ${terrain.floorDropSays(drops, floor)}`); return false; }
    const hangs = m.to ? terrain.hangingFloor(at, m.to.plus(DOWN)) : null;
    // Onto a floor of gravel or sand resting on nothing over lava: the next
    // block changed beside it drops it, and one just put there is already
    // going (25592, note 600). Not offered.
    if (hangs && terrain.floorDropDeadly(hangs, view.health ?? 20)) { notOffered.push(`${m.key.replaceAll('_', ' ')}: ${terrain.floorDropSays(hangs, m.to.plus(DOWN)).replace('underfoot', 'it would end on')}`); return false; }
    return true;
  });
  for (const m of moves) m.from = feet;
  // A dig that lets water in says where that water's air is. And none that
  // fills the pocket over the head with the air farther than the breath
  // there is: air is physical safety (mid-244-y, note 477). With the head
  // under already, the dig does not take it under: the fact alone.
  const { STEP_S } = require('./vitals'), reach = Math.floor(breathS / STEP_S), headDry = !isWater(view.name(feet.plus(UP)));
  moves = moves.filter(m => {
    if (m.kind !== 'dig' || ![UP, ...Object.values(DIRS)].some(d => isWater(view.name(m.cell.plus(d))))) return true;
    const { swim, floods } = waterAir(view, m.cell, feet, { reach });
    m.letsWater = true;
    m.effects.push(swim != null ? `the nearest air through that water is a swim of ${swim} block${swim === 1 ? '' : 's'} from here (about ${Math.round(swim * STEP_S * 10) / 10} s)` : `no air through that water within a swim of ${reach} blocks`);
    return !(headDry && floods && (swim == null || swim * STEP_S + (m.seconds || 0) > breathS));
  });
  return { moves, done, here: { feet: { x: feet.x, y: feet.y, z: feet.z }, inWater, headInWater: isWater(view.name(feet.plus(UP))), headroomToRise: headroom, dryFooting: dryFooting(view, feet), openSkyAbove: skyAbove(view, feet), atSurface: atSurface(view, feet), ...(notOffered.length ? { notOffered } : {}) } };
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
    if (m.airUp != null) facts.push(`air ${m.airUp} blocks straight up from there`);
    else if (m.ceilingUp != null) facts.push(`water up to a ceiling ${m.ceilingUp} blocks up from there: no air that way`);
    if (m.atSurface) facts.push('ends at the surface');
    else if (m.openSkyAbove) facts.push('ends under open sky, in a hole');
    if (m.timesStoodThere) facts.push(`stood there ${m.timesStoodThere} time${m.timesStoodThere > 1 ? 's' : ''} already`);
    if (m.blocksToTarget != null) facts.push(`${m.blocksToTarget} blocks from the target after`);
    if (m.blocksFromStart != null) facts.push(`${m.blocksFromStart} blocks from where it got stuck`);
  }
  // The same move from the same cell before, and that it never got there:
  // mid-72-e chose to climb south out of a pool ten times in ten minutes,
  // told only in recentMoves that each ended where it began (2026-09-26).
  if (m.failedHere) facts.push(`tried from here ${m.failedHere} time${m.failedHere > 1 ? 's' : ''} already and it did not get there`);
  return `${m.does}${facts.length ? ` ${facts.join('; ')}.` : ''}`;
}

// The shooters past the sixteen blocks the threats are read within whose
// fire reaches the bot (a ghast to 64), the push over a drop where the bot
// stands (survival.js blastOverSays), and each move's end where that push
// does or no longer does carry the body over: { shooters, here, moves }.
function pushFacts(bot, feet, moves) {
  const out = { shooters: [], here: null, moves: new Map() };
  let s;
  try { s = require('./survival'); } catch (_) { return out; }
  let pushers = [];
  try { pushers = s.shotPushers(bot); } catch (_) { return out; }
  out.shooters = pushers.filter(t => t.distance > 16).slice(0, 4).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), visible: !!t.visible }));
  if (!pushers.some(t => t.visible)) return out;
  try { out.here = s.blastOverSays(bot)?.says?.trim() || null; } catch (_) { out.here = null; }
  const health = bot.health ?? 20;
  const hereOver = !!s.pushAtSays(bot, feet, { health, pushers });
  for (const m of moves) {
    if (!m.to) continue;
    const there = s.pushAtSays(bot, m.to, { health, pushers });
    if (there) out.moves.set(m.key, ` There ${there}${hereOver ? ', as it does here' : ', where here it does not'}.`);
    else if (hereOver) out.moves.set(m.key, ' There a push from the shooter in sight no longer carries the body over the drop it does here.');
  }
  return out;
}

// The live bot's view: the blocks it sees and what it carries.
const PICKS = ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'wooden_pickaxe'];
function liveView(bot) {
  const carried = {};
  for (const i of bot.inventory.items()) carried[i.name] = (carried[i.name] || 0) + i.count;
  let lavaTouch = null;
  try { lavaTouch = terrain.lavaTouchSays(bot); } catch (_) { /* no body to price */ }
  const { laidAt } = require('./own-blocks');
  return { name: p => bot.blockAt(p)?.name ?? null, block: p => bot.blockAt(p) ?? null, laid: p => laidAt(bot, p), carried, pickaxe: PICKS.find(n => carried[n]) || null,
    axe: Object.keys(carried).find(n => n.endsWith('_axe') && !n.endsWith('_pickaxe')) || null, health: bot.health ?? 20, lavaTouch };
}

// Walled in where it stands (every side closed at the feet or the head),
// and how much of it is the bot's own: said on the offer to work free, so
// the question says the walls are its own planks and not only that every
// walk failed (note 615). Null when a side is open.
function walledSays(view, feet) {
  const sides = Object.values(DIRS).map(d => [feet.plus(d), feet.plus(d).plus(UP)]);
  if (!sides.every(cells => cells.some(c => !open(view.name(c))))) return null;
  const round = [...sides.flat(), feet.offset(0, 2, 0)].filter(c => solid(view.name(c)));
  const own = round.filter(c => laidOf(view, c));
  if (!own.length) return 'walled in where it stands: every side is closed at the feet or the head';
  const names = [...new Set(own.map(c => view.name(c).replaceAll('_', ' ')))].join(', ');
  const at = Math.min(...own.map(c => laidOf(view, c).at).filter(Number.isFinite));
  return `walled in where it stands: every side is closed at the feet or the head, ${own.length} of the ${round.length} blocks round it its own (${names}${Number.isFinite(at) ? `, laid from ${hhmm(at)}Z` : ''}), which it can dig through`;
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

function moveReached(m, feet, after, { failure = null, changed = false } = {}) {
  return !failure && (m.to ? after.x === m.to.x && after.z === m.to.z && (m.to.y <= feet.y || after.y >= m.to.y) : changed);
}

// One move, done on the live bot.
async function perform(bot, task, m, { dig }) {
  const { move } = require('./motion');
  const feet = bot.entity.position.floored();
  const inWater = isWater(bot.blockAt(feet)?.name);
  const equipBlock = async name => { const item = bot.inventory.items().find(i => i.name === name); if (!item) throw new Error(`No ${name} carried`); await bot.equip(item, 'hand'); };
  // A move read from another cell is not this cell's: on 25583 the moves
  // were read while the body fell from y 41 to 38 (the feet taken at 40),
  // and the step south "dropping 1" was run from the cell under, against
  // a wall, and slid off the ledge into the lava sea (note 600).
  if (m.from && !feet.equals(m.from)) throw new Error(`The body is at (${feet.x}, ${feet.y}, ${feet.z}), not at (${m.from.x}, ${m.from.y}, ${m.from.z}) where the move was read`);
  if (m.kind === 'move') {
    const to = m.to, up = to.y > feet.y;
    const keys = m.key === 'swim_up' ? ['jump'] : up || inWater ? ['forward', 'jump'] : ['forward'];
    // Crouched where the step stays level and past it is a fall into lava:
    // the crouch holds the body at the edge it runs on to.
    const sneak = !!m.pastLava && !up && to.y === feet.y && !inWater;
    // Only through its own two columns, the feet's and the target's: a body
    // pressed against a wall slides along it, and on 25583 slid a block east
    // off the ledge it stood on (note 600). Stopped where it leaves them.
    const guard = require('./motion').within(bot, [feet, to], `the ${m.key.replaceAll('_', ' ')}`);
    await move(bot, task, { label: `unstuck_${m.key}`, keys, sneak, why: `one move out of being stuck: ${m.key.replaceAll('_', ' ')}`,
      look: to.offset(0.5, up ? 1.1 : 0.6, 0.5), maxMs: 2500, tick: 50, guard,
      // In the cell is enough: waiting to be on the ground there kept the
      // keys down, and a swimmer's jump out of the water onto land is not
      // on the ground, so forward ran on past it (mid-236-h, note 474).
      until: () => { const f = bot.entity.position.floored(); return m.key === 'swim_up' ? f.y >= to.y : f.x === to.x && f.z === to.z && f.y >= to.y - (to.y < feet.y ? 3 : 0); } });
    bot.clearControlStates?.();
    // Then still until it lands, the keys up.
    for (let n = 0; n < 10 && bot.entity.onGround === false && !isWater(bot.blockAt(bot.entity.position.floored())?.name); n++) { task.check(); await new Promise(r => setTimeout(r, 50)); }
    return;
  }
  if (m.kind === 'dig') { await dig(bot, task, m.cell, { requireDrops: false, dropInto: m.key === 'dig_down' }); return; }
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

// Until the body is on the ground or in a liquid, up to two seconds.
async function landed(bot, task, { maxMs = 2000, tick = 50 } = {}) {
  const inLiquid = () => /water|lava|bubble_column/.test(bot.blockAt?.(bot.entity.position.floored())?.name || '');
  for (const end = Date.now() + maxMs; bot.entity.onGround === false && !inLiquid() && Date.now() < end;) { task.check(); await new Promise(r => setTimeout(r, tick)); }
}

// Working free, Jev choosing each move: until the bot is where it has to
// be, the moves run out, or four in a row change nothing.
async function workFree(bot, task, goal, save, { client, dig, maxMoves = 24, aim = aimFor(bot) } = {}) {
  if (!aim || !client) return false;
  const { decide } = require('./decisions');
  const fatal = err => ['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err?.name);
  // Stuck again at the same aim within ten minutes is the same spell: its
  // moves and visits are kept, so what failed is still known.
  const prior = goal.unstuck?.aim === aim.aim && Date.now() - Date.parse(goal.unstuck.since) < 600000 ? goal.unstuck : null;
  const record = goal.unstuck = prior ? { ...prior, moves: (prior.moves || []).slice(-24), visits: prior.visits || {} } : { aim: aim.aim, since: new Date().toISOString(), moves: [], visits: {} };
  bot.chat?.(`Stuck. Working my way ${aim.goal === 'dry' ? 'out of the water' : aim.goal === 'away' ? 'off this spot' : 'up'} one move at a time.`);
  let still = 0;
  const { checkThreats } = require('./danger');
  for (let n = 0; n < maxMoves; n++) {
    task.check(); checkThreats(bot);
    // Read from where the body stands, not a cell it is falling through:
    // on 25583 the moves were read at y 40 with the body falling from 41 to
    // 38, and every move was a move from the wrong cell (note 600).
    await landed(bot, task);
    const feet = bot.entity.position.floored();
    record.visits[`${feet}`] = (record.visits[`${feet}`] || 0) + 1;
    const view = liveView(bot);
    const { moves, done, here } = localMoves(view, feet, { goal: aim.goal, visits: record.visits, from: aim.from ? new Vec3(aim.from.x, aim.from.y, aim.from.z) : null, breathS: require('./vitals').breathSeconds(bot) });
    const surfaced = aim.goal === 'sky' && here.dryFooting && require('./surface').surfaceObserver(bot)(bot.entity.position);
    if (done || surfaced) { record.out = true; save(); return true; }
    if (!moves.length) return false;
    const failedHere = key => record.moves.filter(r => r.move === key && r.from === `${feet}` && !r.reached).length;
    // A shooter whose blast can push the bot over a drop that kills (a
    // ghast in sight): where it does so here, and at each move's end, said
    // on the move. mid-243-af-fortress-5 stepped north off the one cell of
    // its ledge a push could not carry over the edge, the ghast 47 blocks
    // off in sight and in none of this, and its fireball threw the body
    // off the ledge, 32 down (note 621).
    const push = pushFacts(bot, feet, moves);
    const tree = Object.fromEntries(moves.map(m => [m.key, { description: describeMove({ ...m, failedHere: failedHere(m.key) }) + (push.moves.get(m.key) || '') }]));
    const decision = await decide('unstuck_move', { client, bot, task, goal, save, tree,
      // Breath, in seconds: a full bar is fifteen under water.
      state: { aim: aim.aim, here, carried: view.carried, recentMoves: record.moves.slice(-6), health: bot.health, food: bot.food,
        // The mobs about while it works free, seen or not (the decision
        // audit), and the shooters farther off whose fire reaches the bot.
        threats: (() => { try { return require('./danger').threats(bot, 16).slice(0, 6).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), visible: t.visible })); } catch (_) { return []; } })(),
        ...(push.shooters.length ? { shootersFartherOff: push.shooters } : {}),
        ...(push.here ? { pushHere: push.here } : {}),
        // And whenever a move could flood the pocket, not only in water
        // already: mid-244-y chose its dig into a lake with no breath in
        // the state (note 477).
        ...(here.inWater || moves.some(m => m.letsWater) ? { breathSecondsLeft: Math.round((bot.oxygenLevel ?? 20) * 0.75) } : {}) } });
    if (decision.stale) continue;
    const m = moves.find(x => x.key === decision.path.at(-1));
    const before = bot.entity.position.clone(), blocks = m.cell ? bot.blockAt(m.cell)?.name : null;
    goal.step = { action: 'work_free', move: m.key, aim: aim.goal }; save();
    let failure = null;
    // A mob come close ends the spell for the survival layer, as it ends
    // any work: mid-110-q climbed east out of a hole, one move at a time,
    // while a creeper walked up to it, and was blown up from eighteen
    // health in iron (2026-09-26). Checked before the move and through it.
    checkThreats(bot);
    const previousInterrupt = task.interruptCheck;
    task.interruptCheck = () => { previousInterrupt?.(); checkThreats(bot); };
    try { await perform(bot, task, m, { dig }); }
    catch (err) { task.check(); if (fatal(err)) throw err; failure = err.message; }
    finally { task.interruptCheck = previousInterrupt; }
    const after = bot.entity.position.floored();
    const changed = before.distanceTo(bot.entity.position) >= 0.5 || (m.cell && bot.blockAt(m.cell)?.name !== blocks);
    still = changed ? 0 : still + 1;
    // Got there: the column, and the height when the move rises. A pillar
    // rises in its own column, so the column alone always said so:
    // first-days-204's pillar failed from one cell eleven times in two
    // minutes, each recorded as got there, and each offered again as
    // "rises 1" with nothing said of the failures (2026-09-26).
    const reached = moveReached(m, feet, after, { failure, changed });
    record.moves.push({ move: m.key, from: `${feet}`, reached, result: failure ? `failed: ${failure}` : `${changed ? '' : 'nothing changed; '}now at ${after.x},${after.y},${after.z}` });
    save();
    if (still >= 4) return false;
  }
  return false;
}

module.exports = { pushFacts, walledSays, moveReached, dropBelow, dropInto, landsInLava, landed, waterAir, liveView, aimFor, perform, workFree, localMoves, describeMove, atSurface, skyAbove, dryFooting, digEffects, DIRS, isWater, falls, open, solid };

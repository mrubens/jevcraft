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
// warped wart blocks carried, the one block offered to put was gravel. And
// the wools (shelter.js LAST_MATERIALS, note 619), all before the gravel
// and the sand, which fall.
// The nether woods after the wart blocks (note 635): a bot at the end of its
// span with five warped stems and a gravel was offered the gravel only.
const PLACEABLE = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'andesite', 'diorite', 'granite', 'tuff', 'stone', 'deepslate', 'sandstone', 'nether_wart_block', 'warped_wart_block', ...require('./shelter').NETHER_WOOD, ...require('./shelter').LAST_MATERIALS, 'gravel', 'sand'];
const ORE = /_ore$/;
// What floors a gap when no block of the list above is carried (note 650): a
// fence, which holds and does not fall, and the crafting table, a full block.
// Not for a pillar or a block at the feet: a fence is a block and a half tall,
// so the body jumping over the cell it stands in cannot have one put there
// (the game refuses a block that overlaps the body), and it cannot be stepped
// onto from the floor beside. In a gap at floor level it is a step of half a
// block up, a bar a quarter of a block wide, walked crouched. Two trials
// stranded on their own spans carried fifteen oak fences the whole time
// (25586, 25598): "0 carried that can be laid".
const FENCE = /_fence$/;
function bridgeStock(view) {
  const carried = view.carried || {}, count = names => names.reduce((n, k) => n + (carried[k] || 0), 0);
  const full = PLACEABLE.filter(n => !falls(n) && carried[n] > 0);
  if (full.length) return { name: full[0], count: count(full), kind: 'block' };
  const fences = Object.keys(carried).filter(n => FENCE.test(n) && carried[n] > 0);
  if (fences.length) return { name: fences[0], count: count(fences.filter(n => n === fences[0])), kind: 'fence' };
  if (carried.crafting_table > 0) return { name: 'crafting_table', count: carried.crafting_table, kind: 'table' };
  return null;
}

// The ground a floor laid from the gap `gap` would come to: the floor the bot
// stands on, and the cells joined to it (a span, an island), are not ground
// (they are what it is stuck on); ground is a floor cell of the same plane or
// one up or down that is not joined to them, with room over it to stand. A
// walk of open cells at the gap's level, four ways, to the first cell with
// such a floor beside it: `cells` is the gap cells that take a block, `to`
// the ground reached. null where none is within `reach`, or the bot stands on
// ground that is not an island (more than `island` joined cells).
function islandOf(view, floor, { limit = 150 } = {}) {
  const seen = new Set([`${floor}`]), queue = [floor], dist = new Map([[`${floor}`, 0]]);
  const standOn = c => solid(view.name(c)) && open(view.name(c.plus(UP))) && open(view.name(c.offset(0, 2, 0)));
  for (let i = 0; i < queue.length; i++) {
    if (queue.length > limit) return null;
    const c = queue[i];
    // Diagonals too: a span laid on a slant touches cell to cell at a corner,
    // and a cell with a block of the bot's own on it (the cover it put up)
    // is walked round.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const dy of [0, 1, -1]) {
      const q = c.offset(dx, dy, dz);
      if (seen.has(`${q}`) || !standOn(q)) continue;
      seen.add(`${q}`); queue.push(q); dist.set(`${q}`, dist.get(`${c}`) + 1);
    }
  }
  // The cells in the order found, and how many steps along the floor each is.
  seen.cells = queue; seen.dist = dist;
  return seen;
}
// Searching from `starts` ([{ c, n, from }]: a gap cell, its count and the
// cell of the floor it is beside) across open cells at each start's level, four
// ways, for ground: the first floor beside a walked cell that is not part of
// `island`, has room to stand and is itself joined to more than a hundred and
// fifty cells of floor (islandOf gives up past its limit: a span laid back to
// the shore is ground at its far end). -> { cells, to, from } or null.
function groundSearch(view, starts, island, { reach = 24, nodes = 8000 } = {}) {
  if (!island) return null;
  const empty = c => { const n = view.name(c); return n != null && open(n) && !isLava(n) && !isWater(n); };
  const clear = c => [1, 2, 3].every(dy => empty(new Vec3(c.x, c.y + dy, c.z)));
  const big = new Map();
  const isBig = c => { const k = `${c}`; if (!big.has(k)) big.set(k, islandOf(view, c) === null); return big.get(k); };
  const groundAt = (x, y, z) => [0, 1, -1].map(dy => new Vec3(x, y + dy, z)).find(c => solid(view.name(c)) && !island.has(`${c}`) && empty(c.plus(UP)) && empty(c.offset(0, 2, 0)) && isBig(c));
  const seen = new Set(starts.map(s => `${s.c}`)), queue = starts.map(s => ({ ...s }));
  for (let i = 0; i < queue.length && i < nodes; i++) {
    const { c, n, from } = queue[i];
    if (!empty(c) || !clear(c)) continue;
    for (const d of Object.values(DIRS)) {
      const q = c.plus(d), found = groundAt(q.x, c.y, q.z);
      if (found) return { cells: n, to: found, from };
    }
    if (n >= reach) continue;
    for (const d of Object.values(DIRS)) {
      const q = c.plus(d);
      if (seen.has(`${q}`)) continue;
      seen.add(`${q}`); queue.push({ c: q, n: n + 1, from });
    }
  }
  return null;
}
const groundRun = (view, gap, island, opts) => groundSearch(view, [{ c: gap, n: 1, from: null }], island, opts);
// What the floor stood on is, when it is a small one (a span, an island): its
// size, and the nearest ground that is not part of it from any of its cells,
// in cells of gap and steps along the floor to the cell it is laid from
// (note 650: 25585 stood fourteen cells along a bar from the tip and eight
// from land, its price said from the cell it stood at, twelve, only).
function floorFacts(view, feet, island) {
  if (!island) return null;
  const starts = [];
  for (const c of island.cells) for (const d of Object.values(DIRS)) starts.push({ c: c.plus(d), n: 1, from: c });
  const found = groundSearch(view, starts, island, { nodes: 12000 });
  const along = found && found.from ? island.dist.get(`${found.from}`) : null;
  const size = island.size;
  return `a floor of ${size} cell${size === 1 ? '' : 's'}, joined to no ground (a span or an island)${found
    ? `; the nearest ground that is not part of it is ${found.cells} cell${found.cells === 1 ? '' : 's'} of gap from the floor cell at (${found.from.x}, ${found.from.y}, ${found.from.z})${along ? `, ${along} step${along === 1 ? '' : 's'} along it from here` : ', the cell stood on'}, at (${found.to.x}, ${found.to.y}, ${found.to.z})`
    : '; no ground that is not part of it within 24 cells of open air of any of its cells'}`;
}
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

// The blocks a pillar is built of, in the order they are put down: the rock
// kinds a pillar has always been built of, then what a span is laid with, the
// nether woods, the wool, and last what falls (put on a floor that holds it).
const pillarBlocks = () => [...new Set([...require('./pillar-recovery').SCAFFOLD, ...PLACEABLE])];
const listed = carried => Object.entries(carried).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replaceAll('_', ' ')}`).join(', ');

// Straight up through the rock over the head, out into open space above it
// (note 635): the way off a span in the lava sea, whose every step is a drop
// into lava. mid-242-ae-nether-2-fortress-6 stood fifty minutes at the end of
// its own span at y 40, its moves one block each (a pillar of gravel that
// never went down, a step onto nothing), with air six blocks up, then
// fourteen of netherrack, then a cave floor: a column the pillar routine
// (pillar-recovery.js pillarUp, which digs what is over the head and lays a
// block under the feet) climbs, each block dug funding the next to lay. Null
// when there is nothing to climb (no rock over the head, or open air to the
// limit); otherwise { move } or { blocked: why it is not offered }.
function risePlan(view, feet, { reach = 48 } = {}) {
  if (isWater(view.name(feet)) || !solid(view.name(feet.plus(DOWN)))) return null;
  const headName = view.name(feet.plus(UP));
  if (headName == null || !open(headName) || isWater(headName)) return null;
  const { DIGGABLE_ABOVE } = require('./pillar-recovery');
  const rock = [];
  let top = null, blocked = null, firstRock = null;
  for (let y = feet.y + 1; y <= feet.y + reach; y++) {
    const c = new Vec3(feet.x, y, feet.z), n = view.name(c);
    if (n == null) { blocked = 'the rest of the column is not loaded'; break; }
    if (isLava(n) || isWater(n)) { blocked = `${n} in the column at y ${y}`; break; }
    const wet = Object.values(DIRS).map(d => c.plus(d)).find(q => isLava(view.name(q)) || isWater(view.name(q)));
    if (wet) { blocked = `${view.name(wet).replaceAll('_', ' ')} beside the column at (${wet.x}, ${wet.y}, ${wet.z})`; break; }
    if (open(n)) {
      const next = view.name(c.plus(UP));
      if (rock.length && next != null && open(next) && !isWater(next) && !isLava(next)) { top = y; break; }
      continue;
    }
    if (!DIGGABLE_ABOVE.test(n) || falls(n)) { blocked = `${n.replaceAll('_', ' ')} in the way at y ${y}${falls(n) ? ', and it would fall on the head' : ''}`; break; }
    if (firstRock === null) firstRock = y;
    rock.push({ y, name: n });
  }
  if (!rock.length && !blocked) return null;
  if (top === null && !blocked) blocked = `no open space above the rock within ${reach} blocks`;
  if (blocked) return { blocked: `rise straight up through the rock over the head: ${blocked}` };
  const rise = top - feet.y;
  // What is laid before the first dig comes from the pack: the pillar puts a
  // block down under each rise, and clears the cell over the head first.
  const before = Math.max(0, firstRock - feet.y - 2);
  const blocks = pillarBlocks();
  const carried = Object.fromEntries(blocks.filter(n => (view.carried?.[n] || 0) > 0).map(n => [n, view.carried[n]]));
  const have = Object.values(carried).reduce((a, b) => a + b, 0);
  const uses = view.pickaxe ? (Number.isFinite(view.pickaxeUses) ? view.pickaxeUses : Infinity) : 0;
  const funds = new Set([...require('./pillar-recovery').SCAFFOLD, 'stone']);
  let left = uses, seconds = rise, drops = 0;
  for (const r of rock) {
    const withTool = left > 0 && view.pickaxe;
    if (withTool) { left--; if (funds.has(r.name)) drops++; }
    seconds += withTool ? (digSeconds(r.name, view, false) ?? 1.2) : /netherrack|basalt|blackstone|_nylium|soul|dirt|gravel|sand/.test(r.name) ? 2 : 7.5;
  }
  const kinds = [...new Set(rock.map(r => r.name.replaceAll('_', ' ')))].slice(0, 3).join(', ');
  const tool = view.pickaxe ? `the ${view.pickaxe.replaceAll('_', ' ')}${Number.isFinite(view.pickaxeUses) ? ` (${view.pickaxeUses} uses left${view.pickaxeUses < rock.length ? `, the last ${rock.length - view.pickaxeUses} by hand, which drop nothing` : ''})` : ''}` : 'bare hands (nothing dropped)';
  // Fences carried do not count (note 650): a pillar block goes under the feet
  // as the body jumps over the cell, and a fence is a block and a half tall.
  const fenced = Object.entries(view.carried || {}).filter(([n, c]) => FENCE.test(n) && c > 0);
  const fenceSays = fenced.length ? `; the ${fenced.map(([n, c]) => `${c} ${n.replaceAll("_", " ")}${c === 1 ? "" : "s"}`).join(", ")} carried cannot be laid under the feet (a fence is a block and a half tall, and the body jumping over its cell cannot have one put there)` : "";
  if (have < before) return { blocked: `rise straight up through the rock over the head: ${before} blocks to lay before the rock, ${have} carried that can be laid${fenceSays}` };
  if (have + drops < rise) return { blocked: `rise straight up through the rock over the head: ${rise} blocks to lay in all, ${have} carried and ${drops} dropped by the rock dug on the way${fenceSays}` };
  const airCells = firstRock - feet.y - 1;
  const does = `Rise straight up through the rock over the head: ${airCells} block${airCells === 1 ? '' : 's'} of open air, then ${rock.length} of ${kinds}, dug from below with ${tool}, then open space at y ${top} (${rise} up, at (${feet.x}, ${top}, ${feet.z})). A block goes under the feet at each of the ${rise} steps: the first ${before} from the pack (${listed(carried)}), the rest from the rock dug on the way (${drops} dropped). About ${Math.round(seconds)} seconds. The shaft is one block wide, with no lava or water in or beside it and nothing over the head that falls; it ends on the rock's top, not over the drop under this span.`;
  return { move: { key: 'rise_through', does, kind: 'rise', top, rise, blocks, seconds: Math.round(seconds), effects: [] } };
}

// A whole walk off the spot, for the 'away' aim: to the nearest cell at
// least eight blocks from where it got stuck that is dry ground with no lava
// in the eight cells round it, over the ground as it stands (a step level,
// one up, or down as far as three; nothing dug or laid), taking as few cells
// beside lava as the ground allows. In the Nether the pathfinder's walks
// take no cell with lava beside it (movement.js besideLavaRefused), and in
// a basalt delta, where the lava lies in pools level with the floor, that
// is every cell: 25583 (mid-243-cg) stood thirty minutes on a cell of
// blackstone at 1.8 health, every walk "no route", its moves single steps
// onto the cells beside it and back, while a walk of nine cells, two of
// them beside lava, came off the delta's lava onto dry ground eight blocks
// north (note 655). The cells beside lava are said and walked crouched,
// one at a time; a drop of two or more onto one, or a jump up onto one, is
// not taken (movement.js, notes 514 and 220-e: the body carries on past
// the cell it was aimed at). -> { path: [Vec3], lavaSide, to } or null.
const WALK_OFF_REACH = 16, WALK_OFF_NODES = 4000, LAVA_SIDE_COST = 100;
function lavaBeside(view, c) {
  for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
    if (!dx && !dz) continue;
    for (const dy of [-1, 0, 1]) if (isLava(view.name(c.offset(dx, dy, dz)))) return true;
  }
  return false;
}
function walkOffPlan(view, feet, from, { reach = WALK_OFF_REACH, nodes = WALK_OFF_NODES, away = 8 } = {}) {
  if (!from || isWater(view.name(feet))) return null;
  const empty = c => { const n = view.name(c); return n != null && open(n) && !isWater(n) && !isLava(n); };
  const stand = c => empty(c) && empty(c.plus(UP)) && solid(view.name(c.plus(DOWN))) && !/magma|campfire|fire/.test(view.name(c.plus(DOWN)) || '');
  const start = { cost: 0, c: feet, prev: null };
  const best = new Map([[`${feet}`, start]]);
  const frontier = [start];
  let found = null;
  for (let i = 0; i < nodes && frontier.length; i++) {
    let k = 0;
    for (let j = 1; j < frontier.length; j++) if (frontier[j].cost < frontier[k].cost) k = j;
    const cur = frontier.splice(k, 1)[0];
    if (cur.stale) continue;
    const c = cur.c;
    if (cur.prev && Math.hypot(c.x - from.x, c.z - from.z) >= away && !lavaBeside(view, c)) { found = cur; break; }
    for (const d of Object.values(DIRS)) for (const dy of [0, 1, -1, -2, -3]) {
      const q = c.plus(d).offset(0, dy, 0);
      if (Math.abs(q.x - feet.x) > reach || Math.abs(q.z - feet.z) > reach || !stand(q)) continue;
      // Up needs the head's room over the cell stood on; down, the column
      // over the landing open from the level stood on.
      if (dy === 1 && !empty(c.offset(0, 2, 0))) continue;
      if (dy < 0 && ![...Array(-dy + 1).keys()].every(n => empty(c.plus(d).offset(0, 1 - n, 0)))) continue;
      const side = lavaBeside(view, q);
      if (side && (dy <= -2 || dy === 1)) continue;
      const cost = cur.cost + 1 + (side ? LAVA_SIDE_COST : 0), key = `${q}`, was = best.get(key);
      if (was && was.cost <= cost) continue;
      if (was) was.stale = true;
      const node = { cost, c: q, prev: cur, side };
      best.set(key, node); frontier.push(node);
    }
  }
  if (!found) return null;
  const path = [];
  let lavaSide = 0;
  for (let n = found; n && n.prev; n = n.prev) { path.unshift(n.c); if (n.side) lavaSide++; }
  return { path, lavaSide, to: found.c };
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
    // Lava beside the cell it ends on, as the walk off says of its cells:
    // 25583's step north onto such a cell was said as "ends on dry ground"
    // only (note 655).
    if (!inWater && lavaBeside(view, p)) facts.lavaBeside = true;
    if (target) facts.blocksToTarget = Math.round(p.distanceTo(target));
    if (from) facts.blocksFromStart = Math.round(Math.hypot(p.x - from.x, p.z - from.z));
    return facts;
  };
  // The floor stood on, and the cells joined to it: a small island or none
  // (islandOf), read once and only when a move needs it.
  let island;
  const ownIsland = () => island === undefined ? (island = inWater ? null : islandOf(view, feet.plus(DOWN))) : island;
  const standable = p => open(view.name(p)) && open(view.name(p.plus(UP))) && !isLava(view.name(p)) && !isLava(view.name(p.plus(UP)));
  // A step down onto a floor that is not the floor stood on, from a floor that
  // is a small island: what that floor is, and the way back up. The step
  // north of 25598's span tip drops two onto a post of three netherrack over
  // the lava, and was said only "dropping 2".
  const landsApart = land => {
    if (land.y >= feet.y || isWater(view.name(land)) || !ownIsland()) return null;
    const floor = land.plus(DOWN);
    if (ownIsland().has(`${floor}`)) return null;
    const there = islandOf(view, floor);
    if (there === null) return 'it lands on ground joined to a hundred and fifty cells of floor or more, not on the floor stood on';
    return `it lands on a floor of ${there.size} cell${there.size === 1 ? '' : 's'} that is not joined to the floor stood on${feet.y - land.y > 1 ? ` (the way back up is ${feet.y - land.y} blocks, and a jump climbs one)` : ''}`;
  };
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
      if (isWater(view.name(land)) || solid(view.name(land.plus(DOWN)))) moves.push({ key: `step_${dir}`, does: `${inWater ? 'Swim' : 'Walk'} one block ${dir}${land.y < feet.y ? `, dropping ${feet.y - land.y}` : ''}${landsApart(land) ? `, and ${landsApart(land)}` : ''}.`, kind: 'move', to: land, ...(pastDrop ? { effects: [`one block past it, ${pastDrop}`] } : {}), ...(pastLava ? { pastLava: true } : {}), ...where(land), ...(/^it lands on a floor of/.test(landsApart(land) || '') ? { dryFooting: false } : {}) });
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
  // A floor laid across a gap beside, and the floor of a cell beside taken
  // up to lay it with. A bot on an island of its own blocks over the lava
  // sea, a cell short of its span and nothing carried to put down, stood
  // fifteen minutes and then a ghast's fireball threw it off: every walk was
  // "no route" (a jump over lava is not taken), the moves offered were
  // steps on the island and gravel that falls, and the four blocks under its
  // feet were the blocks to bridge with (note 625).
  const stock = bridgeStock(view);
  const carriedBlock = stock?.name || null;
  const pieces = (n, kind) => `${n} ${kind === 'fence' ? (n === 1 ? 'fence' : 'fences') : n === 1 ? 'block' : 'blocks'}`;
  const lostTakes = [];
  for (const [dir, d] of Object.entries(DIRS)) {
    const gap = feet.plus(d).plus(DOWN), beyond = gap.plus(d);
    if (inWater || !solid(view.name(feet.plus(DOWN)))) break;
    if (carriedBlock && open(view.name(gap)) && !isLava(view.name(gap)) && !isWater(view.name(gap)) && open(view.name(feet.plus(d))) && open(view.name(feet.plus(d).plus(UP))) && (stock.kind !== 'fence' || open(view.name(feet.plus(d).offset(0, 2, 0))))) {
      const leads = solid(view.name(beyond)) ? `the floor beyond it, ${dir}, is solid: it joins that ground` : `beyond it, ${dir}, there is no floor`;
      // How far the ground the bot is not on lies by this way, against what
      // is carried (note 650): 25598 stood on the tip of a span nine cells
      // from rock it could have crossed to with the fifteen fences it carried.
      const run = groundRun(view, gap, ownIsland());
      const ground = !ownIsland() ? '' : run
        ? `By way of this cell the nearest ground that is not part of what the bot stands on is ${run.cells} cell${run.cells === 1 ? '' : 's'} of gap away, at (${run.to.x}, ${run.to.y}, ${run.to.z}): ${stock.count >= run.cells ? `${run.cells} of the ${pieces(stock.count, stock.kind)} carried would reach it` : `${pieces(stock.count, stock.kind)} carried, ${run.cells - stock.count} short of it`}. `
        : `By way of this cell no ground that is not part of what the bot stands on lies within 24 cells of open air (${pieces(stock.count, stock.kind)} carried). `;
      const what = stock.kind === 'fence'
        ? `Put ${/^[aeiou]/.test(stock.name) ? 'an' : 'a'} ${stock.name.replaceAll('_', ' ')} into the gap in the floor ${dir}, against the floor stood on: a floor cell to walk onto, not a whole block: a bar a quarter of a block wide and a block and a half tall, its top half a block over the floor beside it, so it is walked crouched (a step up of half a block, no jump; a crouched body is held at the edge of the bar and does not walk off it), one bar wide, and a fence cannot be pillared on`
        : stock.kind === 'table'
          ? `Put the crafting table into the gap in the floor ${dir}, against the floor stood on: a whole block to walk onto; it is the crafting table${stock.count === 1 ? ' carried, the only one' : ''}, and it stays where it is put`
          : `Put a ${carriedBlock.replaceAll('_', ' ')} into the gap in the floor ${dir}, against the floor stood on: a floor cell to walk onto`;
      moves.push({ key: `bridge_${dir}`, does: `${ground}${what}; ${leads}; ${dropBelow(view, gap) ? `under it, ${dropBelow(view, gap)}` : 'ground close under it'}.`, kind: 'place', cell: gap, block: carriedBlock, to: null, groundCells: run?.cells ?? null, groundSays: ground });
    }
    // The floor of the cell beside, when nothing is carried to put down and
    // the block is the bot's own: one block of it to carry, the rest stays.
    // Only where the block dug has a floor to land on: dug from over the lava
    // sea it drops out of its cell and burns, and the dig was refused (work.js
    // opensPit) every time in 25598 while it was offered, 228 in a day (note
    // 650).
    if (!stock && diggable(view, gap, view.name(gap)) && !!laidOf(view, gap) && solid(view.name(feet.plus(DOWN))) && open(view.name(feet.plus(d)))) {
      const seconds = digSeconds(view.name(gap), view, false);
      const lands = dropInto(view, gap);
      if (seconds != null && lands.n > 0 && lands.into !== 'ground') { lostTakes.push([dir, lands.into]); continue; }
      if (seconds != null) moves.push({ key: `take_floor_${dir}`, does: `Dig up the ${view.name(gap).replaceAll('_', ' ')} in the floor ${dir}, a block the bot laid itself${Number.isFinite(laidOf(view, gap).at) ? ` at ${hhmm(laidOf(view, gap).at)}Z` : ''} (about ${seconds} s) and pick it up, to put down somewhere else: the floor stood on stays; that cell of the floor is gone, ${dropBelow(view, gap) ? `a drop there: ${dropBelow(view, gap)}` : 'ground close under it'}.`, kind: 'dig', cell: gap, seconds, effects: [] });
    }
  }
  // The four ways side by side: a way longer than the shortest says so, as Jev
  // took the eight-cell way over the six with the same ground at both ends.
  const runs = moves.filter(m => m.groundCells != null);
  if (runs.length > 1) {
    const best = runs.reduce((a, b) => b.groundCells < a.groundCells ? b : a);
    for (const m of runs) if (m.groundCells > best.groundCells) m.does = m.does.replace(m.groundSays, `${m.groundSays.trimEnd()} The shortest of the ways from here is ${best.key.replace('bridge_', '')}, ${best.groundCells} cells. `);
  }
  if (lostTakes.length) notOffered.push(`take up the floor beside (${lostTakes.map(([dir]) => dir).join(', ')}): the block dug drops out of its cell with nothing under the cell to hold it, into ${lostTakes.some(([, into]) => into === 'lava') ? 'lava, and burns' : 'a fall'}; nothing is picked up and that cell of the floor is gone`);
  // Straight up: dig what is over the head, swim up, or pillar.
  const over = feet.offset(0, 2, 0), overName = view.name(over);
  if (diggable(view, over, overName)) {
    const seconds = digSeconds(overName, view, inWater);
    if (seconds != null) moves.push({ key: 'dig_up', does: `Dig the ${overName.replaceAll('_', ' ')} over the head${ownSays(view, over)} (about ${seconds} s).`, kind: 'dig', cell: over, seconds, effects: [opensOnto(view, over.plus(UP)), ...digEffects(view, over, feet)] });
  }
  if (inWater && isWater(view.name(feet.plus(UP)))) moves.push({ key: 'swim_up', does: 'Swim up a block.', kind: 'move', to: feet.plus(UP), ...where(feet.plus(UP)) });
  const block = PLACEABLE.find(n => (view.carried?.[n] || 0) > 0);
  if (block && !inWater && headroom && solid(view.name(feet.plus(DOWN)))) moves.push({ key: 'pillar', does: `Jump and put a ${block.replaceAll('_', ' ')} under the feet: up a block where it stands.`, kind: 'pillar', block, to: feet.plus(UP), ...where(feet.plus(UP)) });
  const rising = risePlan(view, feet);
  if (rising?.move) moves.push(rising.move);
  else if (rising?.blocked) notOffered.push(rising.blocked);
  // Down: dig the floor, when not over water or lava.
  const floor = feet.plus(DOWN), floorName = view.name(floor);
  if (!inWater && diggable(view, floor, floorName) && !isWater(view.name(floor.plus(DOWN))) && !isLava(view.name(floor.plus(DOWN)))) {
    const seconds = digSeconds(floorName, view, false);
    const drop = dropBelow(view, floor, { extra: 1 });
    if (seconds != null) moves.push({ key: 'dig_down', does: `Dig the ${floorName.replaceAll('_', ' ')} underfoot${ownSays(view, floor)} and drop a block (about ${seconds} s).`, kind: 'dig', cell: floor, seconds, effects: [opensOnto(view, floor.plus(DOWN)), ...(drop ? [drop] : []), ...digEffects(view, floor)] });
  }
  // The server keeps putting the body back here: what this client sees may
  // not be what the server has. The moves above are read from the view; this
  // one asks the server, and its answer is taken for the view (server-truth.js).
  if (view.corrections) {
    const c = view.corrections;
    moves.push({ key: 'ask_server', kind: 'resync', effects: [], does: `Ask the server what the blocks round the body are: it answers a use of a block's face with the block it holds there, and this client's view is made to match its answer (nothing is placed or broken; the shield or an empty hand does the asking). The server put the body back ${c.times} times in ${c.withinSeconds} seconds here, as it does when a move would put the body into a block the server has and the view does not${c.askedAbout ? `; it was asked ${c.secondsAgo} seconds ago about ${c.askedAbout} blocks and ${c.viewDiffered.length ? 'its answer differed from the view at ' + c.viewDiffered.map(x => `(${x.x}, ${x.y}, ${x.z})`).join(', ') : 'its answers matched the view'}` : ''}.` });
  }
  // The whole walk off, where single steps are what is offered: more than
  // one cell, so not a step already listed.
  if (goal === 'away' && from && !inWater) {
    const walk = walkOffPlan(view, feet, from);
    if (walk && walk.path.length > 1) {
      const rise = walk.to.y - feet.y, off = Math.round(Math.hypot(walk.to.x - from.x, walk.to.z - from.z));
      const side = walk.lavaSide;
      moves.push({ key: 'walk_off', kind: 'walk', path: walk.path, to: walk.to, lavaSide: side,
        does: `Walk off this spot to (${walk.to.x}, ${walk.to.y}, ${walk.to.z}), ${walk.path.length} cells over the ground as it stands (nothing dug or laid${rise ? `, ${rise > 0 ? `${rise} up` : `${-rise} down`} in all` : ''}), onto dry ground with no lava in the eight cells round it, ${off} blocks from where it got stuck. ${side ? `${side} of its cells ${side === 1 ? 'has' : 'have'} lava beside it (level with the feet or the floor, a block to the side or corner to corner), walked crouched one cell at a time; a misstep or a push there is into the lava${view.lavaTouch ? ` (${view.lavaTouch})` : ''}. The walks the bot makes on its own take no cell beside lava in the Nether, so they find no way here.` : 'None of its cells has lava beside it.'}`,
        effects: [], ...where(walk.to) });
    }
  }
  // 'away': off a spot every walk failed from, onto dry ground eight blocks off.
  const done = goal === 'dry' ? dryFooting(view, feet)
    : goal === 'away' ? dryFooting(view, feet) && !!from && Math.hypot(feet.x - from.x, (feet.y - from.y) || 0, feet.z - from.z) >= 8
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
  const floorSays = ownIsland() ? floorFacts(view, feet, ownIsland()) : null;
  return { moves, done, here: { feet: { x: feet.x, y: feet.y, z: feet.z }, inWater, headInWater: isWater(view.name(feet.plus(UP))), headroomToRise: headroom, dryFooting: dryFooting(view, feet), openSkyAbove: skyAbove(view, feet), atSurface: atSurface(view, feet), ...(floorSays ? { floor: floorSays } : {}), ...(notOffered.length ? { notOffered } : {}) } };
}

// The moves as Jev is shown them: one option each, with its facts.
function describeMove(m) {
  const facts = [];
  if (m.effects?.length) facts.push(m.effects.join('; '));
  if (m.to) {
    facts.push(m.rises > 0 ? `rises ${m.rises}` : m.rises < 0 ? `goes down ${-m.rises}` : 'same level');
    if (m.dryFooting) facts.push('ends on dry ground');
    if (m.lavaBeside) facts.push('lava beside the cell it ends on (level with the feet or the floor, a block to the side or corner to corner): a misstep or a push there is into the lava');
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
  const pickaxe = PICKS.find(n => carried[n]) || null;
  const held = pickaxe && bot.inventory.items().find(i => i.name === pickaxe), most = pickaxe && bot.registry?.itemsByName?.[pickaxe]?.maxDurability;
  const pickaxeUses = held && most ? Math.max(0, most - (held.durabilityUsed || 0)) : null;
  return { name: p => bot.blockAt(p)?.name ?? null, block: p => bot.blockAt(p) ?? null, laid: p => laidAt(bot, p), carried, pickaxe, pickaxeUses,
    axe: Object.keys(carried).find(n => n.endsWith('_axe') && !n.endsWith('_pickaxe')) || null, health: bot.health ?? 20, lavaTouch,
    corrections: (() => { try { return bot.serverTruth?.says?.() || null; } catch (_) { return null; } })() };
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
  if (m.kind === 'rise') return !failure && after.y >= m.top;
  return !failure && (m.to ? after.x === m.to.x && after.z === m.to.z && (m.to.y <= feet.y || after.y >= m.to.y) : changed);
}

// One move, done on the live bot.
async function perform(bot, task, m, { dig }) {
  const { move } = require('./motion');
  const feet = bot.entity.position.floored();
  const inWater = isWater(bot.blockAt(feet)?.name);
  const equipBlock = async name => { const item = bot.inventory.items().find(i => i.name === name); if (!item) throw new Error(`No ${name} carried`); await bot.equip(item, 'hand'); };
  // Asking the server is not a move from a cell: the body jitters over a
  // block's top while the server holds it (79.07 and 78.99), and the cell it
  // floors to changes with each look.
  if (m.kind === 'resync') {
    if (!bot.serverTruth) throw new Error('No way to ask the server here');
    m.result = await bot.serverTruth.resyncAround(task);
    return;
  }
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
  // The walk off, a cell at a time as the steps are made: crouched where
  // the cell has lava beside it and the step stays level, and stopped
  // where the body is not in the cell the last step was for.
  if (m.kind === 'walk') {
    for (const cell of m.path) {
      task.check();
      const at = bot.entity.position.floored();
      const step = { key: m.key, kind: 'move', to: cell, from: at, pastLava: cell.y === at.y && lavaBeside(liveView(bot), cell) };
      await perform(bot, task, step, { dig });
      await landed(bot, task);
      const now = bot.entity.position.floored();
      if (now.x !== cell.x || now.z !== cell.z) throw new Error(`The walk off stopped at (${now.x}, ${now.y}, ${now.z}), short of (${cell.x}, ${cell.y}, ${cell.z})`);
    }
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
    // With the block the move names: pillarUp's own list is the rock kinds,
    // and a pillar of the gravel offered failed 48 times on 25586 with "The
    // block did not go under the feet" (note 635).
    const { pillarUp, SCAFFOLD } = require('./pillar-recovery');
    const placed = await pillarUp(bot, task, feet.y + 1, { dig, maxBlocks: 1, threats: false, blocks: [m.block, ...SCAFFOLD] });
    if (!placed) throw new Error('The block did not go under the feet');
    return;
  }
  if (m.kind === 'rise') {
    const placed = await require('./pillar-recovery').pillarUp(bot, task, m.top, { dig, maxBlocks: m.rise + 4, blocks: m.blocks });
    if (!placed) throw new Error('The pillar would not rise');
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
        ...(view.corrections ? { serverCorrections: view.corrections } : {}),
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
    const changed = before.distanceTo(bot.entity.position) >= 0.5 || (m.cell && bot.blockAt(m.cell)?.name !== blocks) || (m.kind === 'resync' && m.result?.corrected?.length > 0);
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

module.exports = { walkOffPlan, lavaBeside, islandOf, groundRun, floorFacts, bridgeStock, pushFacts, walledSays, moveReached, dropBelow, dropInto, landsInLava, landed, waterAir, liveView, aimFor, perform, workFree, localMoves, risePlan, describeMove, atSurface, skyAbove, dryFooting, digEffects, DIRS, isWater, falls, open, solid };

'use strict';
// Pockets full is a quiet way to stall: iron ore mined and never picked up,
// a crafting grid that spills its contents on the ground, seven furnaces
// nobody asked for. The dream run reached that state with twelve stacks of
// cobblestone and a stack each of the granites. A miner keeps a few stacks
// of stone for shelters and tools and lets the rest lie. Everything not in
// the table below is kept: tools, food, ores, ingots, wood, the rare stuff.
// Wheat seeds are kept up to a stack: clearing grass is how the home plot
// gets planted, and tossing them was how the plot stayed bare.
const SURPLUS = Object.freeze({
  // Two stacks: the Nether crossing waits for 128 blocks (work.js), and a
  // tidy that dropped all past one would send it back for more, round and
  // round.
  // Tuff, diorite, andesite, granite, terracotta and sandstone lay as well
  // as cobblestone: they are counted in the building budget below (note
  // 780), kept after the crossing kit's kinds and dropped before them.
  cobblestone: 128, cobbled_deepslate: 64, dirt: 32, gravel: 16, sand: 0, red_sand: 0,
  calcite: 0, netherrack: 128,
  // A soul sand valley's staircase: mid-92-o carried 105 soul soil and 104
  // soul sand out of one, four slots of nothing it builds with (soul sand
  // slows the walk it would bridge with).
  soul_sand: 0, soul_soil: 0,
  leaf_litter: 32, short_grass: 0, seagrass: 0, kelp: 0, wheat_seeds: 32, raw_copper: 16, copper_ingot: 16,
  furnace: 2, crafting_table: 2, snowball: 0, ice: 0, clay_ball: 0, flint: 8,
});
const FREE_SLOTS = 4;

// Spare gear, when stone alone does not make room: pockets holding two
// swords, two diamond pickaxes, three shields and a second helmet, leggings
// and boots had no slot for raw chicken, and chicken after chicken was
// killed and left lying at the bot's feet. The best of each tool is kept (and
// one spare pickaxe, the tool a long dig wears out); armour no better than
// what is worn goes, and so does a second of the rest.
const TIERS = ['wooden', 'leather', 'golden', 'stone', 'chainmail', 'iron', 'diamond', 'netherite'];
const tier = name => TIERS.findIndex(t => name.startsWith(`${t}_`));
const TOOL = /_(sword|pickaxe|axe|shovel|hoe)$/, ARMOUR = /_(helmet|chestplate|leggings|boots)$/;
const SINGLES = new Set(['flint_and_steel', 'shears', 'fishing_rod', 'shield', 'bow', 'crossbow']);
const WORN = { helmet: 5, chestplate: 6, leggings: 7, boots: 8 };
// One pair of golden boots is not a spare: they are the Nether's piglin
// gold, carried beside the iron. Counted as boots no better than the iron
// ones worn, the pair was crafted and tossed twice in one day audit, and
// the golden-boots rung ran out its time mining gold for a third.
// The uses a tool needs to count as a spare: the crossing kit's own measure.
const soundUses = () => { try { return require('./crossing-kit').SPARE_PICKAXE_DURABILITY ?? 24; } catch (_) { return 24; } };
function spares(bot, keep = new Set()) {
  const gold = bot.inventory.items().find(i => i.name === 'golden_boots');
  const items = bot.inventory.items().filter(i => !keep.has(i.name) && i !== gold);
  const out = [];
  const byKind = {};
  for (const item of items) {
    const kind = TOOL.test(item.name) ? item.name.match(TOOL)[1] : ARMOUR.test(item.name) ? item.name.match(ARMOUR)[1] : SINGLES.has(item.name) ? item.name : null;
    if (kind) (byKind[kind] ||= []).push(item);
  }
  // A tool with the uses a spare needs (crossing-kit.js, 24) is kept before
  // a better tier nearly worn out (note 749c): 25598 at 14:14:57Z made a
  // stone pickaxe (131 uses) for the crossing's spare, the tidy kept its two
  // iron ones (247 and 22 uses) and threw the stone one, and the kit, which
  // counts only pickaxes with 24 uses or more, asked for it again: made and
  // thrown twice in 13 seconds, win_strategy asked 11 times in 36 seconds.
  const usesOf = i => { const max = bot.registry?.itemsByName?.[i.name]?.maxDurability; return max ? max - (i.durabilityUsed || 0) : Infinity; };
  const SOUND_USES = soundUses(), sound = i => usesOf(i) >= SOUND_USES;
  for (const [kind, list] of Object.entries(byKind)) {
    list.sort((a, b) => (sound(b) - sound(a)) || (tier(b.name) - tier(a.name)) || (usesOf(b) - usesOf(a)));
    if (kind in WORN) {
      const worn = bot.inventory.slots?.[WORN[kind]];
      const keepOne = worn ? list.filter(i => tier(i.name) > tier(worn.name)).slice(0, 1) : list.slice(0, 1);
      out.push(...list.filter(i => !keepOne.includes(i)));
    } else if (kind === 'pickaxe') {
      // A pickaxe with a spare's uses is not the tidy's to throw: how many
      // are carried is the pickaxe budget's and Jev's (upkeep's
      // spare_pickaxe). 25597 (mid-241-cd, 15:21:05Z) chose spare_pickaxe six
      // times, made a stone pickaxe (131 uses) beside an iron one (111) and
      // another stone one, and the tidy left it on the floor at the next
      // step, "My pockets are full, so I'm leaving 1 stone pickaxe here",
      // with 53 orange terracotta carried (note 754b). Worn ones past two go.
      out.push(...list.slice(2).filter(i => !sound(i)));
    } else out.push(...list.slice(1));
  }
  // The weakest first.
  return out.sort((a, b) => tier(a.name) - tier(b.name));
}

// Room for `count` more of `name`: a free slot, or stacks of it with that
// much space between them. A craft's output comes whole: four planks with
// room for one merge none, and the rest has nowhere to go (mid-241-v, note 496).
function roomFor(bot, name, count = 1) {
  if ((bot.inventory.emptySlotCount?.() ?? 1) > 0) return true;
  return bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + Math.max(0, (i.stackSize || 64) - i.count), 0) >= count;
}

// `keep` is what the work in hand is for: "get me 64 sand" with full
// pockets mined the sand, dropped it as surplus, and mined it again.
// Everything over a cap: each kind's own (capOf) and each budget's (BUDGETS).
function surplus(bot, keep = new Set(), ctx = {}) {
  return overCaps(countsOf(bot), { dimension: bot.game?.dimension, keep, ...ctx }).map(({ name, count }) => ({ name, count }));
}
const countsOf = bot => { const counts = {}; for (const item of bot.inventory.items()) counts[item.name] = (counts[item.name] || 0) + item.count; return counts; };

// Kept by budget, not kind by kind (note 780). The bots ran with 34 or more
// of 36 slots in use 52% of the time in the records from 2026-09-30 12Z,
// and the tidy, which drops only what is over a cap, found nothing over one
// in half the minutes it was crowded: cobblestone, cobbled deepslate, dirt
// and netherrack each sat under a cap of its own (128, 64, 32, 128: six
// slots of blocks that all do the same job), beside terracotta of five
// colors, moss, saplings, eggs, rail and spider eyes that had no cap at
// all. The room question was asked 2.9 times a bot-hour, and full
// pockets were where most pickaxes were thrown (note 779). A budget holds
// kinds that do one job as one count, kept in the order given (the first
// kept first; the last goes first): building blocks are one budget of 128,
// the crossing kit's own two stacks (crossing-kit.js NETHER_BLOCKS), the
// ghast-proof stone kept before tuff, the granites, terracotta and
// sandstone, and those before netherrack and dirt. In the Nether its
// basalt and bricks count too. Boats are one: a boat crosses water, and
// five kinds of boat are five slots.
const BUILDING_KEEP_ORDER = ['cobblestone', 'cobbled_deepslate', 'blackstone', 'stone', 'deepslate', 'nether_bricks', 'basalt', 'smooth_basalt',
  'tuff', 'andesite', 'diorite', 'granite', /^(\w+_)?terracotta$/, /^(red_)?sandstone$/, 'netherrack', 'dirt', 'coarse_dirt'];
const orderMatch = (o, n) => typeof o === 'string' ? o === n : o.test(n);
const NETHER_ONLY_BLOCKS = /^(nether_bricks|basalt|smooth_basalt)$/;
const BUILDING_BUDGET = 128;
const BUDGETS = [
  { label: 'building blocks', says: 'one budget across kinds for bridging and pillaring',
    test: (n, dim) => BUILDING_KEEP_ORDER.some(o => orderMatch(o, n)) && (!NETHER_ONLY_BLOCKS.test(n) || /nether/.test(String(dim || ''))),
    order: BUILDING_KEEP_ORDER, budget: ctx => Math.max(BUILDING_BUDGET, ctx.kitWants || 0), off: ctx => !!ctx.blocksShort },
  { label: 'boats', says: 'a boat crosses water; one of any wood is all a crossing uses', test: n => /_(boat|raft)$/.test(n) && !/chest_/.test(n), budget: () => 1 },
];
const budgetOf = (name, dim) => BUDGETS.find(b => b.test(name, dim)) || null;
// Kinds no rung on the way to the dragon wants (note 780), kept to none
// when the pockets are crowded: mob drops no recipe the run makes takes
// (rotten flesh, spider eyes, scutes, hides, membranes, ink, eggs), ores and
// metal no rung spends (redstone), what no way lays (rail, nether brick
// fences, and outside the Nether basalt and bricks), and finds with no use
// (NO_USE). What the work
// in hand is for, and what the ladder's next rung takes, is kept all the
// same (`keep`). The keepsakes (home-stash.js: wool, string, feathers,
// bones, leather, gunpowder, flint, coal, seeds) are not among them: a rung
// or the home's chest spends each. With a home chest known, these are the
// chest's keepers (home-stash.js stashes oddities), not dropped.
// (ctx.homeChest).
const NO_RUNG = /^(rotten_flesh|spider_eye|armadillo_scute|rabbit_hide|rabbit_foot|phantom_membrane|magma_cream|ink_sac|glow_ink_sac|slime_ball|egg|brown_egg|blue_egg|redstone|glowstone_dust|rail|wither_skeleton_skull|ominous_bottle|cocoa_beans|snowball|clay_ball|nether_brick_fence|nether_brick_stairs|cobweb|hay_block|.*_sapling)$/;
const capFor = (name, dim, ctx = {}) => {
  const own = capOf(name);
  if (own !== undefined) return own;
  if (NO_USE.test(name) || (NO_RUNG.test(name) && !ctx.homeChest)) return 0;
  if (/^(basalt|smooth_basalt|nether_bricks)$/.test(name) && !/nether/.test(String(dim || ''))) return 0;
  return undefined;
};
// Why a kind is past what is kept, said on the tidy's own line and on the
// room question.
function capWhy(name, dim) {
  const b = budgetOf(name, dim);
  if (b) return `${b.label} past the ${b.label === 'building blocks' ? BUILDING_BUDGET : b.budget({})} kept in all`;
  if (NO_USE.test(name)) return 'no use on the way to the dragon';
  if (NO_RUNG.test(name) || (capFor(name, dim) === 0)) return 'nothing on the way to the dragon takes it';
  return `past the ${capFor(name, dim)} worth keeping`;
}

// What is over a cap, kind by kind and budget by budget: [{ name, count,
// why }]. A budget counts what `keep` holds but never drops it; what goes is
// taken from the end of the budget's keep order (dirt before netherrack
// before cobblestone), and with blocks short for a way on (note 751d) the
// building budget is off.
function overCaps(counts, ctx = {}) {
  const keep = ctx.keep || new Set(), dim = ctx.dimension;
  const out = [];
  const inBudget = new Set();
  for (const b of BUDGETS) {
    const names = Object.keys(counts).filter(n => b.test(n, dim));
    names.forEach(n => inBudget.add(n));
    if (!names.length || b.off?.(ctx)) continue;
    const rank = n => { const i = (b.order || []).findIndex(o => orderMatch(o, n)); return i < 0 ? 999 : i; };
    // Kept first: what `keep` holds, then the budget's order, then the most carried.
    const order = names.sort((x, y) => (keep.has(y) - keep.has(x)) || (rank(x) - rank(y)) || (counts[y] - counts[x]));
    let left = b.budget(ctx);
    order.forEach((n, pos) => {
      const own = capOf(n);
      const keeps = keep.has(n) ? counts[n] : Math.min(counts[n], Math.max(0, left), own ?? Infinity);
      left -= keeps;
      // `goes`: the budget's last kept goes first (dirt before cobblestone).
      if (counts[n] > keeps) out.push({ name: n, count: counts[n] - keeps, tier: 1, goes: -pos, why: own !== undefined && keeps === own && left > 0 ? `past the ${own} worth keeping` : capWhy(n, dim) });
    });
  }
  for (const [name, count] of Object.entries(counts)) {
    if (inBudget.has(name) || keep.has(name)) continue;
    // Coal is never the tidy's to throw (it smelts and lights); past two
    // stacks it is only said, on the room question (ctx.sayCoal).
    if (/^(coal|charcoal)$/.test(name) && !ctx.sayCoal) continue;
    const cap = capFor(name, dim, ctx);
    if (cap !== undefined && count > cap) out.push({ name, count: count - cap, tier: cap === 0 ? 0 : 2, goes: 0, why: capWhy(name, dim) });
  }
  return out;
}

// The tidy's plan for pockets as counted (name -> count): what to drop, in
// order, to bring the free slots back to FREE_SLOTS (the headroom a pick-up,
// a craft's output and a furnace's take each want). Only drops that free a
// slot are made (a part of a stack frees none), the most slots first.
// Pure, so the flight records' pockets can be tidied on paper
// (scripts/pocket-pressure.js).
function tidyPlan(counts, { free, dimension, keep = new Set(), blocksShort = false, kitWants = 0, homeChest = false, stackOf = () => 64, headroom = FREE_SLOTS } = {}) {
  if (!(free < headroom)) return [];
  const slots = (n, c) => Math.ceil(c / Math.max(1, stackOf(n)));
  const plan = overCaps(counts, { dimension, keep, blocksShort, kitWants, homeChest })
    .map(d => ({ ...d, slots: slots(d.name, counts[d.name]) - slots(d.name, counts[d.name] - d.count) }))
    .filter(d => d.slots > 0)
    // The most slots first; at one slot each, a kind kept to none before a
    // budget's last kind before a stack past its own cap.
    .sort((a, b) => (b.slots - a.slots) || (a.tier - b.tier) || (a.goes - b.goes) || (b.count - a.count));
  const out = [];
  for (const d of plan) {
    if (free >= headroom) break;
    out.push(d); free += d.slots;
  }
  return out;
}

// What the budgets read from the goal: blocks short for a way on (note
// 751d: the building budget is off) and the blocks the crossing's kit counts.
function tidyContext(bot, goal) {
  let blocksShort = false, kitWants = 0;
  const homeChest = !!goal?.survival?.home?.stash;
  try { blocksShort = !!require('./block-stock').blocksShortNow(goal); } catch (_) { blocksShort = false; }
  try { kitWants = require('./crossing-kit').kitBlocksWanted(bot, goal || {}); } catch (_) { kitWants = 0; }
  return { blocksShort, kitWants, homeChest };
}

// The items the ladder's next rung takes or uses (its catalog plan's
// consumes and requires), kept by the tidy as the room question keeps them;
// read again at most every 30 s.
const rungSeen = new WeakMap();
function rungNeeds(bot, goal) {
  if (goal?.kind !== 'win') return [];
  const seen = rungSeen.get(goal);
  if (seen && Date.now() - seen.at < 30000) return seen.names;
  const names = new Set();
  try {
    const stage = require('./game-progress').nextGameStage(bot, goal);
    if (stage?.item) {
      names.add(stage.item);
      const { catalogPlan, planningInventory } = require('./work');
      for (const st of catalogPlan(bot, stage.item, stage.count || 1, planningInventory(bot), goal) || []) for (const k of Object.keys({ ...st.consumes, ...st.requires })) names.add(k);
    }
  } catch (_) { /* no stage read: nothing more kept */ }
  rungSeen.set(goal, { at: Date.now(), names: [...names] });
  return [...names];
}

function crowded(bot) {
  const free = bot.inventory.emptySlotCount?.();
  return Number.isInteger(free) ? free < FREE_SLOTS : false;
}

// Part stacks of one kind merged (note 780): two part stacks of cobblestone
// are two slots where one would do, and the drops below go a stack at a
// time. Only with no window open (a click there is the window's).
async function consolidate(bot, task) {
  if (bot.currentWindow || typeof bot.moveSlotItem !== 'function') return 0;
  let merged = 0;
  const byName = {};
  for (const i of bot.inventory.items()) if ((i.stackSize || 64) > 1 && i.slot !== undefined) (byName[i.name] ||= []).push(i);
  for (const list of Object.values(byName)) {
    if (list.length < 2) continue;
    const size = list[0].stackSize || 64, total = list.reduce((n, i) => n + i.count, 0);
    if (Math.ceil(total / size) >= list.length) continue;
    list.sort((a, b) => b.count - a.count);
    for (let src = list.length - 1; src > 0; src--) {
      const dst = list.findIndex((i, k) => k < src && i.count < size);
      if (dst < 0) break;
      task?.check?.();
      try { await bot.moveSlotItem(list[src].slot, list[dst].slot); merged++; }
      catch (_) { break; }
      const moved = Math.min(size - list[dst].count, list[src].count);
      list[dst].count += moved; list[src].count -= moved;
      if (list[src].count > 0) break;
    }
  }
  return merged;
}

// Whole stacks of a kind, the smallest first, until `count` are gone or the
// next stack is bigger than what is left to drop.
async function dropCount(bot, task, name, count) {
  let left = count, gone = 0;
  const stacks = bot.inventory.items().filter(i => i.name === name).sort((a, b) => a.count - b.count);
  for (const stack of stacks) {
    if (stack.count > left) break;
    task?.check?.();
    if (bot.tossStack) await bot.tossStack(stack);
    else await bot.toss(stack.type ?? bot.registry?.itemsByName?.[name]?.id, null, stack.count);
    left -= stack.count; gone += stack.count;
  }
  // A bot with no stack list to toss from (or one stack over what goes):
  // the count itself, the first stacks found.
  if (!gone && left > 0 && !bot.tossStack) {
    const type = bot.registry?.itemsByName?.[name]?.id;
    if (type !== undefined) { await bot.toss(type, null, left); gone = left; }
  }
  return gone;
}

// Drop what is over the cap, biggest surplus first, until the pockets have
// room again. Returns what was dropped so the caller can say so once.
// A stack dropped at the feet is picked straight back up. Throw it behind,
// away from where the work is heading (or behind the way the bot faces),
// upward so it carries, and out of reach: the day audit's cobblestone went
// 189, 64, 125 at one crafting table, and 128, 64, 128 at a furnace.
// The way with the most open air at head height, so a thrown stack flies
// clear: thrown along the way it faced, in a one-wide tunnel at diamond
// depth, the stack hit the wall, dropped at the feet and was picked up
// again two seconds later, and mid-92-a failed on "no room in my pockets
// for diamond" three times over (2026-09-25).
function openDirection(bot) {
  if (typeof bot.blockAt !== 'function') return null;
  const feet = bot.entity.position.floored();
  let best = null;
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let open = 0;
    for (let k = 1; k <= 6; k++) {
      const b = bot.blockAt(feet.offset(x * k, 1, z * k));
      if (!b || b.boundingBox !== 'empty') break;
      open = k;
    }
    if (!best || open > best.open) best = { x, z, open };
  }
  return best && best.open >= 2 ? best : null;
}

async function faceAway(bot, away) {
  if (typeof bot.lookAt !== 'function' || !bot.entity?.position) return;
  const here = bot.entity.position;
  let d;
  if (away && Number.isFinite(away.x)) d = { x: here.x - away.x, z: here.z - away.z };
  else d = openDirection(bot) || (() => { const yaw = bot.entity.yaw || 0; return { x: Math.sin(yaw), z: Math.cos(yaw) }; })();
  const norm = Math.hypot(d.x, d.z) || 1;
  try { await bot.lookAt(here.offset(d.x / norm * 4, 2.2, d.z / norm * 4), true); } catch (_) {}
}

// The tidy, at the work loop's turn between steps (work.js keepRoom): part
// stacks merged, then what is over a cap or a budget dropped until
// FREE_SLOTS are free again (or, forced, all of it), then spare gear.
// `ctx` carries what the budgets read: blocks short for a way on (note
// 751d) and what the crossing's kit counts.
async function tidyInventory(bot, task, { force = false, away = null, keep = new Set(), ctx = {} } = {}) {
  if (!force && !crowded(bot)) return [];
  if (!force) { await consolidate(bot, task); if (!crowded(bot)) return []; }
  // Rotten flesh is kept to none only beside other food: where it is the
  // only food carried, it is the next meal.
  const foods = bot.registry?.foodsByName || {};
  if (!bot.inventory.items().some(i => foods[i.name] && i.name !== 'rotten_flesh')) keep = new Set([...keep, 'rotten_flesh']);
  const stackOf = n => bot.registry?.itemsByName?.[n]?.stackSize || 64;
  const free = bot.inventory.emptySlotCount?.() ?? 0;
  const plan = force ? overCaps(countsOf(bot), { dimension: bot.game?.dimension, keep, ...ctx }).sort((a, b) => b.count - a.count)
    : tidyPlan(countsOf(bot), { free, dimension: bot.game?.dimension, keep, stackOf, ...ctx });
  const dropped = [];
  if (plan.length) await faceAway(bot, away);
  for (const { name, count, why } of plan) {
    task?.check?.();
    if (bot.registry?.itemsByName?.[name]?.id === undefined) continue;
    let gone = 0;
    try { gone = await dropCount(bot, task, name, count); }
    catch (err) { task?.check?.(); break; }
    if (gone) dropped.push({ name, count: gone, why });
    if (!force && !crowded(bot)) break;
  }
  if (crowded(bot)) for (const item of spares(bot, keep)) {
    task?.check?.();
    try { await (bot.tossStack ? bot.tossStack(item) : bot.toss(item.type, null, item.count)); dropped.push({ name: item.name, count: item.count, why: 'spare gear' }); }
    catch (err) { task?.check?.(); break; }
    if (!crowded(bot)) break;
  }
  return dropped;
}

// Room for something wanted, now. Everything under its cap is still
// cheaper than food or ore: with 190 cobblestone, 104 coal and 67
// netherrack, all under their caps, the tidy found nothing to drop and four
// hundred hunts in a row were refused for want of one slot. Stacks go in
// this order, the smallest first, down to the floor each keeps.
//
// The second day audit smelted with thirty-four kinds in thirty-six slots
// and nothing on this list to drop: a stack of nether wart (the run does
// not brew), an egg, a stack of seeds under its floor, fifty-one netherrack
// under its floor in the Overworld. Netherrack is kept in the Nether, where
// it is the bridge and the pillar; elsewhere cobblestone does that job. The
// seeds go last, whole, when nothing else is left.
const nether = bot => /nether/.test(String(bot.game?.dimension || ''));
const EXPENDABLE = [
  ['dirt', 0], ['gravel', 0], [/_sapling$/, 0], ['nether_brick_fence', 0], ['leaf_litter', 16], ['short_grass', 0],
  ['nether_wart', 0], ['egg', 0], ['poisonous_potato', 0], ['spider_eye', 0],
  ['netherrack', bot => nether(bot) ? 96 : 0], ['cobbled_deepslate', 0], ['cobblestone', bot => nether(bot) ? 64 : 128], ['soul_sand', 0], ['nether_bricks', 0],
  ['wheat_seeds', 8], ['raw_copper', 0], ['copper_ingot', 0], ['rotten_flesh', 0], ['wheat_seeds', 0],
];
// A reserve of building blocks is never thrown away: sixteen are a step out
// of a cliff-banked lake, a wall against a creeper, a pillar out of a pit.
// The live run had none when it needed one and drowned digging stone.
const BLOCK_RESERVE = 16;
// Cobblestone is kept to two stacks: the Nether is crossed with them
// (work.js NETHER_BLOCKS), and one kept lost to the tidy is gathered again.
// In the Nether, where netherrack is the blocks, one.
const BUILDING = /^(dirt|cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|tuff|deepslate|netherrack|nether_bricks|blackstone|basalt|end_stone)$|_planks$/;
const blockStock = bot => bot.inventory.items().filter(i => BUILDING.test(i.name)).reduce((n, i) => n + i.count, 0);

// What goes when the pockets are full is Jev's: every stack, with what it is
// (the only pickaxe, part of the block reserve, what the work in hand is
// for), and "nothing" (go without what the room was for). Up to three
// stacks a time.
// Decorative finds with no use on the way to the dragon, said as such.
const LIGHTER = /^(flint_and_steel|fire_charge)$/;
const NO_USE = /^(pink_petals|.*_tulip|dandelion|poppy|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|lily_pad|sunflower|lilac|rose_bush|peony|.*_mushroom|pointed_dripstone|dripstone_block|leaf_litter|short_grass|fern|dead_bush|sugar_cane|bamboo|cactus|.*_carpet|.*_dye|wildflowers|moss_block|pale_moss_block|azalea|flowering_azalea|big_dripleaf|small_dripleaf|.*_roots|glow_lichen|vine|spore_blossom|amethyst_block|nether_wart_block|warped_wart_block|music_disc_.*)$/;
async function jevMakesRoom(bot, task, name, keep, purpose = null, goal = null, room = () => roomFor(bot, name), count = 1) {
  const client = task?.opportunityClient;
  if (!client) return null;
  const { decide } = require('./decisions');
  // Food stays where it is all there is (food-keep.js, note 690): 25598
  // dropped 12 cooked beef in a fortress for a chest's gold ingot.
  const { foodStays, foodSays, isFood } = require('./food-keep');
  const { VALUABLES } = require('./home-stash');
  // A golden apple is not ordinary food (note 656, note 722): a bite is an
  // emergency heal (regeneration and four absorption hearts), the
  // enchanted one five minutes of fire resistance besides, the one steady
  // answer to a blaze's fire. 25581 dropped its only one for a stick, told
  // just "4 food points". Said as what it is, not folded into "food".
  const LIFESAVER = /^(golden_apple|enchanted_golden_apple)$/;
  goal ||= bot._goal || null;
  const foodKept = foodStays(bot, goal);
  // Food outranks a stick, a fence, an egg: with nothing flagged as junk,
  // 25597 was offered its mutton to make room for a stick, dropped it, and
  // spent six minutes hunting the food back (note 730). Ordinary food is
  // the last resort to drop, not an equal choice beside everything else
  // carried; it is only offered up front for something that itself
  // outranks food (a valuable ore, or more food). A golden apple is not
  // ordinary food (note 656, note 722): it keeps its own place in line,
  // offered once no junk is left, same as before.
  // On the way to the Nether with its food short, the food carried is that
  // rung's stock: it is not offered below a valuable either (note 771b:
  // 25589 at 03:08:19Z, 2026-10-01, dropped 18 beef, 54 food points, for a
  // gold ingot from a minecart chest, 8 of 80 points carried after; its
  // food rung then spent about 13 minutes on one sheep with an 89-block
  // climb, and the beef was never gone back for).
  const crossing = crossingFood(bot, goal);
  const worthMoreThanFood = (Object.hasOwn(VALUABLES, name) && !crossing?.short) || isFood(bot, name) || LIFESAVER.test(name);
  const ordinaryFood = n => isFood(bot, n) && !LIFESAVER.test(n);
  for (let round = 0; round < 3 && !room(); round++) {
    const counts = {};
    for (const i of bot.inventory.items()) counts[i.name] = (counts[i.name] || 0) + i.count;
    // What has no use, and what is over its keeping cap, first: with
    // thirty-six slots full of coal, dripstone and petals, mid-83-a was
    // offered them among its tools and chose to drop nothing five times,
    // told only "go without the cobblestone" (2026-09-25).
    // Coal is never tossed by the tidy (kit), but past two stacks it is said:
    // mid-83-a carried four, and two smelt a hundred and twenty-eight things.
    const cap = capOf;
    // Over a cap of its own, past its budget (building blocks are one count
    // across kinds), or a kind no rung takes (note 780): the same reckoning
    // the tidy drops by, with what the room is for and the step's own kept.
    const shortGoal = require('./block-stock').blocksShortNow(goal);
    const overList = overCaps(counts, { dimension: bot.game?.dimension, keep: new Set([...keep, name]), sayCoal: true, ...tidyContext(bot, goal) });
    const overBy = Object.fromEntries(overList.map(d => [d.name, d]));
    const over = n => !!overBy[n];
    const junk = n => NO_USE.test(n) || over(n);
    // Never offered (note 754d): the tool the step in hand needs (its tool,
    // what it requires) and the last pickaxe carried. 25593 (mid-237-bf,
    // 17:08Z, y -54) was asked what to drop for the cobblestone its mine
    // step (requires iron_pickaxe) was digging, was offered that pickaxe,
    // its only one, and dropped it; then climbed 78 stairs with a stone axe.
    const stepTools = new Set();
    for (const st of [goal?.step, goal?.step?.detail].filter(Boolean)) {
      if (typeof st.tool === 'string') stepTools.add(st.tool);
      for (const k of Object.keys(st.requires || {})) if (TOOL.test(k)) stepTools.add(k);
    }
    const picks = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name));
    const heldBack = i => stepTools.has(i.name) || (picks.length === 1 && picks[0] === i);
    const withheld = [...new Set(bot.inventory.items().filter(heldBack).map(i => i.name))];
    let stacks = bot.inventory.items().filter(i => i.name !== name && !keep.has(i.name) && !(foodKept && isFood(bot, i.name)) && !heldBack(i))
      .sort((a, b) => (junk(b.name) ? 1 : 0) - (junk(a.name) ? 1 : 0));
    if (!worthMoreThanFood) {
      const withoutFood = stacks.filter(i => !ordinaryFood(i.name));
      // Ordinary food is offered only once nothing else carried is left to drop.
      if (withoutFood.length) stacks = withoutFood;
    }
    if (!stacks.length) return false;
    // Junk goes before anything the run cannot easily replace: 25581 dropped
    // its only golden apple for a stick with cobblestone and dirt sitting
    // over their caps a step away (note 722). Where dirt, surplus stone or a
    // flower alone would give the room, that is what is offered; a valuable,
    // a life-saver or a tool is only asked about once no junk is left.
    const junkOnly = stacks.filter(i => junk(i.name));
    const kind = n => (TOOL.test(n) && n.match(TOOL)[1]) || null;
    // With no junk, what is dug again in seconds goes next, offered alone:
    // building blocks past the reserve, gravel, sand, terracotta (note 754b);
    // the rest is asked about only once none of that is left. 25584
    // (mid-244-gc, 15:21Z) made room for eight lava buckets one at a time and
    // was offered its flint and steel and its two golden apples beside 64
    // cobblestone, 32 smooth basalt and 32 dirt, and dropped both: notes 722
    // and 730 held only while some junk was left.
    // Blocks the crossing's kit counts are cheap only past what it wants:
    // 25593 dropped its 128 cobblestone for lava buckets and the next step
    // mined 64 back for the kit (note 754d).
    const ck = require('./crossing-kit'), kitWants = ck.kitBlocksWanted(bot, goal), kitHas = kitWants ? ck.netherBlocks(bot) : 0;
    const KIT_KIND = /^(cobblestone|cobbled_deepslate|netherrack|blackstone|stone|deepslate|dirt)$/;
    // Blocks the binding limit of the ways on: not cheap while short (note 751d).
    const shortNow = require('./block-stock').blocksShortNow(goal);
    const cheap = i => (BUILDING.test(i.name) && !shortNow && blockStock(bot) - i.count >= BLOCK_RESERVE && !(kitWants && KIT_KIND.test(i.name) && kitHas - i.count < kitWants)) || /^(gravel|sand|red_sand|smooth_basalt|soul_sand|soul_soil|calcite|mud|clay|.*terracotta)$/.test(i.name);
    const tiers = [junkOnly, stacks.filter(cheap)];
    stacks = tiers.find(t => t.length) || stacks;
    // What each stack is to the work in hand and the ladder's next step,
    // and the stacks that matter most when gone: the only food, the only
    // weapon, the water bucket, the valuables (the decision audit,
    // 2026-09-25).
    const needed = new Set();
    // What a step uses and does not consume is needed too: the pickaxe the
    // next rung mines with, the table it crafts at.
    for (const st of [goal?.step, goal?.step?.detail].filter(Boolean)) {
      for (const k of ['item', 'drops', 'block', 'input', 'fuel']) if (typeof st[k] === 'string') needed.add(st[k]);
      for (const k of Object.keys({ ...st.consumes, ...st.requires })) needed.add(k);
    }
    let nextRung = null;
    try {
      const stage = goal?.kind === 'win' ? require('./game-progress').nextGameStage(bot, goal) : null;
      if (stage?.item) {
        const { catalogPlan, planningInventory } = require('./work');
        for (const st of catalogPlan(bot, stage.item, stage.count || 1, planningInventory(bot), goal) || []) for (const k of Object.keys({ ...st.consumes, ...st.requires })) needed.add(`rung:${k}`);
        nextRung = stage.phase;
      }
    } catch (_) { nextRung = null; }
    const food = n => !!bot.registry?.foodsByName?.[n];
    const weapon = n => /_(sword|axe)$|^(bow|crossbow|trident)$/.test(n);
    const tree = {};
    // Each stack keyed by its item (keys.js, note 749), and where two stacks
    // share an item, by its slot too: not by its place in this sorted list.
    const named = new Set();
    const keyOf = (stack, n) => { const base = `drop_${stack.name}`; if (!named.has(base)) { named.add(base); return base; } return `${base}_slot${stack.slot ?? n}`; };
    stacks.slice(0, 24).forEach((stack, n) => {
      const notes = [];
      const k = kind(stack.name);
      if (k && !bot.inventory.items().some(i => i !== stack && kind(i.name) === k)) notes.push(`the only ${k}`);
      if (BUILDING.test(stack.name) && blockStock(bot) - stack.count < BLOCK_RESERVE) notes.push(`part of the ${BLOCK_RESERVE}-block reserve for pillars, walls and pockets`);
      if (BUILDING.test(stack.name) && shortNow) notes.push(`blocks to lay: ${shortNow.what} needs ${shortNow.need} laid and ${blockStock(bot)} are carried, so dropped, these are blocks the ways on are short of`);
      if (kitWants && KIT_KIND.test(stack.name) && kitHas - stack.count < kitWants) notes.push(`blocks the crossing's kit counts for the Nether (${kitHas} carried of ${kitWants}): dropped, ${Math.min(stack.count, kitWants - (kitHas - stack.count))} are mined again for it before the crossing`);
      if (LIFESAVER.test(stack.name)) {
        const enchanted = stack.name === 'enchanted_golden_apple';
        const only = !bot.inventory.items().some(i => i !== stack && LIFESAVER.test(i.name));
        notes.push(`an emergency heal, not ordinary food: a bite gives a few seconds of regeneration and four absorption hearts${enchanted ? ', and five minutes of fire resistance, the one steady answer to a blaze\'s fire' : ''}${only ? `; the only one carried, and made again only from an apple and ${enchanted ? '8 gold blocks (72 gold ingots)' : '8 gold nuggets'}` : ''}`);
      } else if (food(stack.name)) {
        notes.push(bot.inventory.items().some(i => i !== stack && food(i.name)) ? 'food' : 'the only food carried');
        if (crossing && isFood(bot, stack.name)) notes.push(crossingDropSays(bot, crossing, stack));
      }
      if (weapon(stack.name) && !bot.inventory.items().some(i => i !== stack && weapon(i.name))) notes.push('the only weapon');
      // The cast frame's buckets, said for the frame whether it is begun or
      // only chosen: mid-211-f dropped its water bucket twice for planks
      // with the frame chosen, told only that water breaks a fall
      // (2026-09-26).
      const casting = goal?.portalFrame?.cast || goal?.portalMethod?.kind === 'cast';
      if (stack.name === 'water_bucket') notes.push(`the water bucket: breaks a fall, puts out fire, turns lava to stone${casting ? `; and the water that turns each block of the portal frame being cast to obsidian: without it the frame cannot be cast, and another is a bucket (three iron) and a trip to water (${require('./water').waterKnown(bot).says})` : ''}`);
      // A water cauldron is the one thing that puts a fire out in the Nether
      // (note 634): the cauldron and the bucket that fills it are kept for
      // that, said as what they are for.
      if (stack.name === 'cauldron') notes.push(`for a fire on the body in the Nether: put down and filled from a water bucket (${counts.water_bucket ? `${counts.water_bucket} carried` : 'none carried: a bucket of water first'}), a body that steps into it is put out at once, in the Nether too; seven iron ingots to make another`);
      if (stack.name === 'water_bucket' && counts.cauldron) notes.push('and the water for the cauldron carried: emptied into it, it fills it, in the Nether as anywhere (a poured bucket evaporates there)');
      if (stack.name === 'lava_bucket' && casting) notes.push('lava for the portal frame being cast in place, a bucket a block');
      if (stack.name === 'bucket' && casting) notes.push('a bucket for the lava of the portal frame being cast in place, a bucket a block');
      // The portal's lighter, said on the way to the dragon: mid-241-v
      // dropped its only flint and steel for four sticks, told only its name
      // and count (note 496).
      if (LIGHTER.test(stack.name) && goal?.kind === 'win' && !/end/.test(String(bot.game?.dimension || ''))) {
        const only = !bot.inventory.items().some(i => i !== stack && LIGHTER.test(i.name));
        notes.push(`lights the Nether portal, the way to the blaze rods and back${nether(bot) ? ' (relit when a ghast puts it out)' : ''}${only ? '; the only lighter carried: without it no portal is lit, and another flint and steel takes an iron ingot and a flint' : ''}`);
      }
      if (Object.hasOwn(VALUABLES, stack.name)) notes.push('a valuable');
      if (needed.has(stack.name)) notes.push('needed by the step in hand');
      else if (needed.has(`rung:${stack.name}`)) notes.push(`needed by the ladder's next step (${nextRung.replaceAll('_', ' ')})`);
      if (NO_USE.test(stack.name)) notes.push('no use on the way to the dragon');
      if (over(stack.name)) notes.push(overSays(bot, counts, stack.name, overBy[stack.name]));
      // Nothing flagged is not nothing lost: with no junk to offer, 25597
      // was shown its oak fence and raw copper with no word of what either
      // costs, next to its mutton with none either, and picked the mutton
      // (note 730). What is not flagged one of the above still costs a way
      // to get another, said so rather than left blank.
      if (!notes.length) notes.push('no flagged use for the run ahead, but not junk either: another would mean finding, mining, trading or crafting one again');
      tree[keyOf(stack, n)] = { description: `Drop ${stack.count} ${stack.name.replaceAll('_', ' ')} (${counts[stack.name]} carried in all)${notes.length ? `: ${notes.join('; ')}` : ''}.`, stack };
    });
    const unlisted = stacks.length - Math.min(stacks.length, 24);
    const keptSays = withheld.length ? ` Not offered: ${withheld.map(n => n.replaceAll('_', ' ')).join(', ')} (${withheld.map(n => stepTools.has(n) ? 'the tool the step in hand needs' : 'the last pickaxe').join('; ')}).` : '';
    tree.none = { description: `Drop nothing and go without the ${name.replaceAll('_', ' ')}${purpose ? `: ${purpose} cannot go on without it, and fails and is tried again` : ''}.${keptSays}${NO_USE.test(name) ? ` The ${name.replaceAll('_', ' ')} itself has no use on the way to the dragon.` : ''}${unlisted ? ` ${unlisted} more stack${unlisted === 1 ? ' is' : 's are'} carried and not listed here.` : ''}` };
    // Two questions, asked together: whether to drop anything, and which
    // stack if so. Asked as one, the stacks split the vote: mid-83-b's
    // pointed dripstone, dripstone and mushroom took 0.15, 0.14 and 0.05,
    // "nothing" 0.24 won, and a stone pickaxe went uncrafted for want of a
    // slot, again and again (2026-09-25).
    const drops = Object.entries(tree).filter(([k]) => k !== 'none');
    const junkCount = drops.filter(([, o]) => junk(o.stack.name)).length;
    const asked = {
      drop: { description: `Drop one stack to make room for the ${count > 1 ? `${count} ` : ''}${name.replaceAll('_', ' ')}: ${drops.length} stacks to choose from${junkCount ? `, ${junkCount} of them with no use on the way to the dragon or more than is worth keeping` : ', none of them without a use: each is gear, food or material the run needs'}. Which one is the next question.`,
        children: Object.fromEntries(drops.map(([k, o]) => [k, { description: o.description }])) },
      none: { description: tree.none.description },
    };
    let decision;
    try {
      decision = await decide('inventory_drop', { client, bot, task, tree: asked,
        state: { roomFor: name, carriedKinds: Object.keys(counts).length, freeSlots: bot.inventory.emptySlotCount?.() ?? 0, keeping: [...keep],
          ...(goal?.step ? { stepInHand: goal.step } : {}), ...(unlisted ? { stacksNotListed: unlisted } : {}), ...(foodKept ? { foodNotListed: `The food carried is kept: ${foodKept}.` } : {}),
          keptByTheTidy: keptSaysAll(bot, counts, { blocksShort: shortGoal, keep }) } });
    } catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return null; }
    if (decision.stale) continue;
    const pick = decision.path.at(-1);
    console.log(`[room] for ${name}: Jev chose ${pick}${tree[pick]?.stack ? ` (${tree[pick].stack.count} ${tree[pick].stack.name})` : ''}`);
    if (pick === 'none') return false;
    const stack = tree[pick]?.stack;
    if (!stack) return null;
    task?.check?.();
    try { await (bot.tossStack ? bot.tossStack(stack) : bot.toss(stack.type, null, stack.count)); }
    catch (err) { task?.check?.(); return null; }
    // Food dropped is said: it left 25598's pockets with no word (note 690).
    const dropped = foodSays(bot, [stack]);
    if (dropped) bot.chat?.(`Dropping ${dropped} to make room for the ${name.replaceAll('_', ' ')}.`);
    // Remembered where it fell, for the food rung to offer the walk back
    // while it lies there (note 771b).
    if (dropped && goal) noteDroppedFood(bot, goal, stack);
  }
  // Three rounds and still no room, without Jev ever saying "nothing": the
  // tidy's own order, not "no room". mid-79-a's diamond was refused four
  // times, half a second a time, nothing thrown (2026-09-25).
  return room() || null;
}

// A stack over what is kept, said with the budget it is counted in: the
// kinds counted, how many are kept in all and in what order they go.
function overSays(bot, counts, name, d) {
  const dim = bot.game?.dimension, b = budgetOf(name, dim);
  if (!b) return capFor(name, dim) === 0 ? `${d.why}: the tidy keeps none` : `more than the ${capFor(name, dim)} worth keeping (${d.count} of the ${counts[name]} carried past it)`;
  const names = Object.keys(counts).filter(n => b.test(n, dim));
  const total = names.reduce((n, k) => n + counts[k], 0), kept = b.label === 'building blocks' ? BUILDING_BUDGET : b.budget({});
  const rank = n => b.order.findIndex(o => orderMatch(o, n));
  const order = b.order ? names.slice().sort((x, y) => rank(x) - rank(y)) : [];
  return `${b.label}, ${b.says}: ${total} carried (${names.map(n => `${counts[n]} ${n.replaceAll('_', ' ')}`).join(', ')}), more than the ${kept} worth keeping in all${order.length > 1 ? `, kept ${order[0].replaceAll('_', ' ')} first and ${order.at(-1).replaceAll('_', ' ')} last` : ''}; ${d.count} of these are past it`;
}
// What the tidy keeps and why, said on the room question (note 780): the
// budgets that apply to what is carried, and what keeps the rest.
function keptSaysAll(bot, counts, { blocksShort = null, keep = new Set() } = {}) {
  const dim = bot.game?.dimension;
  const parts = [];
  for (const b of BUDGETS) {
    const names = Object.keys(counts).filter(n => b.test(n, dim));
    if (!names.length) continue;
    const total = names.reduce((n, k) => n + counts[k], 0);
    const kept = b.label === 'building blocks' ? BUILDING_BUDGET : b.budget({});
    parts.push(b.label === 'building blocks' && blocksShort
      ? `building blocks: all ${total} kept, a way on is short of blocks (${blocksShort.what} needs ${blocksShort.need})`
      : `${b.label}: ${total} carried, ${kept} kept in all (${b.says})`);
  }
  const kept = [...keep].filter(n => counts[n]);
  if (kept.length) parts.push(`kept whatever the count, for the work in hand: ${kept.map(n => n.replaceAll('_', ' ')).join(', ')}`);
  parts.push(`the tidy drops what is past these, and kinds no rung takes, by itself when fewer than ${FREE_SLOTS} slots are free`);
  return `${parts.join('; ')}.`;
}

// Whether one more of `name` is past what is kept (its cap or its budget):
// a pick-up of it only makes the tidy's work (opportunistic-pickups.js).
function atKeep(bot, name, ctx = {}) {
  const counts = countsOf(bot);
  counts[name] = (counts[name] || 0) + 1;
  return overCaps(counts, { dimension: bot.game?.dimension, ...ctx }).some(d => d.name === name);
}

// The crossing's food, where the bot is on the way to the Nether in the
// Overworld (a win goal, the Nether not yet entered): the stay's points
// and what is carried; `short` while under them.
function crossingFood(bot, goal) {
  if (goal?.kind !== 'win' || !/overworld/.test(String(bot?.game?.dimension || 'overworld')) || goal.gameProgress?.milestones?.nether_entered) return null;
  let want = 0;
  try { want = require('./crossing-kit').netherStay(bot, goal).points; } catch (_) { return null; }
  const carried = require('./food-keep').carriedPoints(bot);
  return { want, carried, short: carried < want };
}
// A food stack's drop said against the Nether's food rung: the points it
// takes off what is carried, how short of the stay that leaves, and the
// minutes such food took to gather in the record (food-errand.js).
function crossingDropSays(bot, crossing, stack) {
  const pts = (bot.registry?.foodsByName?.[stack.name]?.foodPoints || 0) * stack.count;
  const after = crossing.carried - pts, short = Math.max(0, crossing.want - after);
  const perMinute = require('./food-errand').RESERVE_RECORD.all.perMinute;
  return `the Nether food rung's stock: ${crossing.carried} of the ${crossing.want} points the stay wants carried, ${pts} of them in this stack; dropped, ${after} carried and ${short} short, about ${Math.max(1, Math.round(pts / perMinute))} minutes of food errands to gather again at the record's ${perMinute} points a minute`;
}
// Food dropped for room, remembered with where it fell: items on the ground
// vanish five minutes after they fall (DROP_LASTS_MS).
const DROP_LASTS_MS = 5 * 60000;
function noteDroppedFood(bot, goal, stack) {
  const p = bot.entity?.position;
  if (!p) return;
  const points = (bot.registry?.foodsByName?.[stack.name]?.foodPoints || 0) * stack.count;
  const list = (goal.droppedFood || []).filter(d => Date.now() - d.at < DROP_LASTS_MS);
  list.push({ at: Date.now(), x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dimension: String(bot.game?.dimension || 'overworld'), item: stack.name, count: stack.count, points });
  goal.droppedFood = list.slice(-5);
}

// `count` is how many must fit, a craft's whole output; `room` overrides the
// test when the thing is not in the pockets yet (on the cursor, say).
async function makeRoom(bot, task, name, { keep = new Set(), away = null, purpose = null, goal = null, count = 1, room = () => roomFor(bot, name, count) } = {}) {
  if (room()) return true;
  // The tidy's own rule first (note 780): part stacks merged, and what is
  // past its cap or its budget, or a kind no rung takes, dropped until the
  // headroom is back. Of 646 room questions answered from 2026-09-30 12Z,
  // all 642 matched to their pockets were asked with such a stack carried (redstone, rail,
  // saplings, terracotta, rotten flesh, blocks past 128), and Jev dropped a
  // crafting table, gravel or coal, or went without, beside them. Only what
  // the rule leaves no room for is asked.
  goal ||= bot._goal || null;
  try {
    const kept = new Set([...keep, name, ...rungNeeds(bot, goal)]);
    const dropped = await tidyInventory(bot, task, { away, keep: kept, ctx: tidyContext(bot, goal) });
    if (dropped.length) console.log(`[room] for ${name}: the tidy dropped ${dropped.map(d => `${d.count} ${d.name} (${d.why})`).join(', ')}`);
  } catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  if (room()) return true;
  await faceAway(bot, away);
  const chosen = await jevMakesRoom(bot, task, name, keep, purpose, goal, room, count);
  if (chosen !== null) return chosen;
  // Junk before tools: with forty-six nether brick fences in the pockets the
  // tidy threw out the stone pickaxe first, and the ladder, counting the
  // worn diamond pickaxes as spent, made another and threw it out again.
  for (const [match, floorOf] of EXPENDABLE) {
    if (room()) return true;
    const floor = typeof floorOf === 'function' ? floorOf(bot) : floorOf;
    const test = typeof match === 'string' ? n => n === match : n => match.test(n);
    const stacks = bot.inventory.items().filter(i => test(i.name) && i.name !== name && !keep.has(i.name)).sort((a, b) => a.count - b.count);
    let total = stacks.reduce((n, i) => n + i.count, 0);
    for (const stack of stacks) {
      if (room() || total - stack.count < floor) break;
      if (BUILDING.test(stack.name) && blockStock(bot) - stack.count < BLOCK_RESERVE) continue;
      task?.check?.();
      try { await (bot.tossStack ? bot.tossStack(stack) : bot.toss(stack.type, null, stack.count)); total -= stack.count; }
      catch (err) { task?.check?.(); break; }
    }
  }
  if (!room()) await tidyInventory(bot, task, { force: true, keep: new Set([...keep, name]), away, ctx: tidyContext(bot, goal) });
  return room();
}

// How many of an item are worth keeping, where there is a cap: past it the
// tidy drops them first (coal is never tossed, but past two stacks it is said).
function capOf(name) { return SURPLUS[name] ?? (name === 'coal' ? 128 : undefined); }
module.exports = { tidyContext, rungNeeds, tidyPlan, overCaps, consolidate, dropCount, capFor, capWhy, atKeep, keptSaysAll, BUDGETS, BUILDING_BUDGET, BUDGET_BLOCKS: /^(cobblestone|cobbled_deepslate|netherrack|blackstone|stone|deepslate|dirt|coarse_dirt)$/, NO_RUNG, crossingFood, crossingDropSays, noteDroppedFood, DROP_LASTS_MS, NO_USE, capOf, openDirection, makeRoom, tidyInventory, surplus, spares, roomFor, crowded, faceAway, blockStock, BLOCK_RESERVE, SURPLUS, FREE_SLOTS };

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
  cobblestone: 128, cobbled_deepslate: 64, dirt: 32, gravel: 16, sand: 0, red_sand: 0,
  diorite: 0, andesite: 0, granite: 0, tuff: 0, calcite: 0, netherrack: 128,
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
function spares(bot, keep = new Set()) {
  const gold = bot.inventory.items().find(i => i.name === 'golden_boots');
  const items = bot.inventory.items().filter(i => !keep.has(i.name) && i !== gold);
  const out = [];
  const byKind = {};
  for (const item of items) {
    const kind = TOOL.test(item.name) ? item.name.match(TOOL)[1] : ARMOUR.test(item.name) ? item.name.match(ARMOUR)[1] : SINGLES.has(item.name) ? item.name : null;
    if (kind) (byKind[kind] ||= []).push(item);
  }
  for (const [kind, list] of Object.entries(byKind)) {
    list.sort((a, b) => tier(b.name) - tier(a.name));
    if (kind in WORN) {
      const worn = bot.inventory.slots?.[WORN[kind]];
      const keepOne = worn ? list.filter(i => tier(i.name) > tier(worn.name)).slice(0, 1) : list.slice(0, 1);
      out.push(...list.filter(i => !keepOne.includes(i)));
    } else out.push(...list.slice(kind === 'pickaxe' ? 2 : 1));
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
function surplus(bot, keep = new Set()) {
  const counts = {};
  for (const item of bot.inventory.items()) counts[item.name] = (counts[item.name] || 0) + item.count;
  return Object.entries(counts).filter(([name, count]) => name in SURPLUS && !keep.has(name) && count > SURPLUS[name])
    .map(([name, count]) => ({ name, count: count - SURPLUS[name] }));
}

function crowded(bot) {
  const free = bot.inventory.emptySlotCount?.();
  return Number.isInteger(free) ? free < FREE_SLOTS : false;
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

async function tidyInventory(bot, task, { force = false, away = null, keep } = {}) {
  if (!force && !crowded(bot)) return [];
  await faceAway(bot, away);
  const dropped = [];
  for (const { name, count } of surplus(bot, keep).sort((a, b) => b.count - a.count)) {
    task?.check?.();
    const type = bot.registry?.itemsByName?.[name]?.id;
    if (type === undefined) continue;
    try { await bot.toss(type, null, count); dropped.push({ name, count }); }
    catch (err) { task?.check?.(); break; }
    if (!force && !crowded(bot)) break;
  }
  if (crowded(bot)) for (const item of spares(bot, keep)) {
    task?.check?.();
    try { await (bot.tossStack ? bot.tossStack(item) : bot.toss(item.type, null, item.count)); dropped.push({ name: item.name, count: item.count }); }
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
const NO_USE = /^(pink_petals|.*_tulip|dandelion|poppy|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|lily_pad|sunflower|lilac|rose_bush|peony|.*_mushroom|pointed_dripstone|dripstone_block|leaf_litter|short_grass|fern|dead_bush|sugar_cane|bamboo|cactus|.*_carpet|.*_dye)$/;
async function jevMakesRoom(bot, task, name, keep, purpose = null, goal = null, room = () => roomFor(bot, name), count = 1) {
  const client = task?.opportunityClient;
  if (!client) return null;
  const { decide } = require('./decisions');
  // Food stays where it is all there is (food-keep.js, note 690): 25598
  // dropped 12 cooked beef in a fortress for a chest's gold ingot.
  const { foodStays, foodSays, isFood } = require('./food-keep');
  goal ||= bot._goal || null;
  const foodKept = foodStays(bot, goal);
  for (let round = 0; round < 3 && !room(); round++) {
    const counts = {};
    for (const i of bot.inventory.items()) counts[i.name] = (counts[i.name] || 0) + i.count;
    // What has no use, and what is over its keeping cap, first: with
    // thirty-six slots full of coal, dripstone and petals, mid-83-a was
    // offered them among its tools and chose to drop nothing five times,
    // told only "go without the cobblestone" (2026-09-25).
    // Coal is never tossed by the tidy (kit), but past two stacks it is said:
    // mid-83-a carried four, and two smelt a hundred and twenty-eight things.
    const cap = n => SURPLUS[n] ?? (n === 'coal' ? 128 : undefined);
    const over = n => cap(n) !== undefined && counts[n] > cap(n);
    const stacks = bot.inventory.items().filter(i => i.name !== name && !keep.has(i.name) && !(foodKept && isFood(bot, i.name)))
      .sort((a, b) => (NO_USE.test(b.name) || over(b.name) ? 1 : 0) - (NO_USE.test(a.name) || over(a.name) ? 1 : 0));
    if (!stacks.length) return false;
    const kind = n => (TOOL.test(n) && n.match(TOOL)[1]) || null;
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
    const { VALUABLES } = require('./home-stash');
    const tree = {};
    stacks.slice(0, 24).forEach((stack, n) => {
      const notes = [];
      const k = kind(stack.name);
      if (k && !bot.inventory.items().some(i => i !== stack && kind(i.name) === k)) notes.push(`the only ${k}`);
      if (BUILDING.test(stack.name) && blockStock(bot) - stack.count < BLOCK_RESERVE) notes.push(`part of the ${BLOCK_RESERVE}-block reserve for pillars, walls and pockets`);
      if (food(stack.name)) notes.push(bot.inventory.items().some(i => i !== stack && food(i.name)) ? 'food' : 'the only food carried');
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
      if (over(stack.name)) notes.push(`more than the ${cap(stack.name)} worth keeping`);
      tree[`drop_${n}`] = { description: `Drop ${stack.count} ${stack.name.replaceAll('_', ' ')} (${counts[stack.name]} carried in all)${notes.length ? `: ${notes.join('; ')}` : ''}.`, stack };
    });
    const unlisted = stacks.length - Math.min(stacks.length, 24);
    tree.none = { description: `Drop nothing and go without the ${name.replaceAll('_', ' ')}${purpose ? `: ${purpose} cannot go on without it, and fails and is tried again` : ''}.${NO_USE.test(name) ? ` The ${name.replaceAll('_', ' ')} itself has no use on the way to the dragon.` : ''}${unlisted ? ` ${unlisted} more stack${unlisted === 1 ? ' is' : 's are'} carried and not listed here.` : ''}` };
    // Two questions, asked together: whether to drop anything, and which
    // stack if so. Asked as one, the stacks split the vote: mid-83-b's
    // pointed dripstone, dripstone and mushroom took 0.15, 0.14 and 0.05,
    // "nothing" 0.24 won, and a stone pickaxe went uncrafted for want of a
    // slot, again and again (2026-09-25).
    const drops = Object.entries(tree).filter(([k]) => k !== 'none');
    const junk = drops.filter(([, o]) => NO_USE.test(o.stack.name) || over(o.stack.name)).length;
    const asked = {
      drop: { description: `Drop one stack to make room for the ${count > 1 ? `${count} ` : ''}${name.replaceAll('_', ' ')}: ${drops.length} stacks to choose from${junk ? `, ${junk} of them with no use on the way to the dragon or more than is worth keeping` : ', none of them without a use: each is gear, food or material the run needs'}. Which one is the next question.`,
        children: Object.fromEntries(drops.map(([k, o]) => [k, { description: o.description }])) },
      none: { description: tree.none.description },
    };
    let decision;
    try {
      decision = await decide('inventory_drop', { client, bot, task, tree: asked,
        state: { roomFor: name, carriedKinds: Object.keys(counts).length, freeSlots: bot.inventory.emptySlotCount?.() ?? 0, keeping: [...keep],
          ...(goal?.step ? { stepInHand: goal.step } : {}), ...(unlisted ? { stacksNotListed: unlisted } : {}), ...(foodKept ? { foodNotListed: `The food carried is kept: ${foodKept}.` } : {}) } });
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
  }
  // Three rounds and still no room, without Jev ever saying "nothing": the
  // tidy's own order, not "no room". mid-79-a's diamond was refused four
  // times, half a second a time, nothing thrown (2026-09-25).
  return room() || null;
}

// `count` is how many must fit, a craft's whole output; `room` overrides the
// test when the thing is not in the pockets yet (on the cursor, say).
async function makeRoom(bot, task, name, { keep = new Set(), away = null, purpose = null, goal = null, count = 1, room = () => roomFor(bot, name, count) } = {}) {
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
  if (!room()) await tidyInventory(bot, task, { force: true, keep: new Set([...keep, name]), away });
  return room();
}

module.exports = { openDirection, makeRoom, tidyInventory, surplus, spares, roomFor, crowded, faceAway, blockStock, BLOCK_RESERVE, SURPLUS, FREE_SLOTS };

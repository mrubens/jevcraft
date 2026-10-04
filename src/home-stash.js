'use strict';
const { setAside, isSetAside } = require('./progress');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countOf } = require('./skills');
const { checkAir, safeFood } = require('./vitals');
const { checkThreats } = require('./danger');
const { openChest } = require('./chest-delivery');
const { TOOL_TIERS } = require('./plan');

// A spare kit in a chest beside the bed. The dream run died eight times
// and every death cost the whole kit and a climb back up the ladder from a
// wooden pickaxe: findings 36 to 52 in the trial notes are one death after
// another followed by the same hour of gathering. A bed moves the respawn
// home; a chest beside it means the respawn starts with a pickaxe, a sword,
// wood, stone, food and workstations instead of bare hands. Code owns the
// kit, the rules for what is spare and what is short, and the chest
// mechanics; Jev only chooses "stock the stash" among the other chores.
//
// The chest lives in the base state (goal.survival.home.stash) with its
// contents as of the last time the lid was opened, so the ladder can decide
// to restock from memory and only walks to the chest when it has something.
// The Overworld's reserve the record bears out (food-reserve.js, note 796):
// what the stash leaves in the pockets and the day's kit takes.
const KIT_FOOD_POINTS = require('./food-reserve').FLOOR.overworld;
const RETRY_MS = 10 * 60 * 1000;
const NEAR = 6;

const pos = p => new Vec3(p.x, p.y, p.z);
const plain = p => ({ x: p.x, y: p.y, z: p.z });
const base = () => require('./home-base');
const isChest = block => block?.name === 'chest';
const toolKind = name => /_(pickaxe|sword)$/.exec(name || '')?.[1] || null;
const toolTier = name => { const m = /^(\w+)_(pickaxe|sword|axe|shovel|hoe)$/.exec(name || ''); return m ? TOOL_TIERS.indexOf(m[1]) + 1 : 0; };
const durabilityLeft = (bot, item) => { const max = bot.registry?.itemsByName?.[item.name]?.maxDurability; return max ? max - (item.durabilityUsed || 0) : Infinity; };
const usable = (bot, item) => { const max = bot.registry?.itemsByName?.[item.name]?.maxDurability; return !max || durabilityLeft(bot, item) >= max * 0.2; };
const foodPoints = (bot, name) => bot.registry?.foodsByName?.[name]?.foodPoints || 0;
const stackSize = (bot, name) => bot.registry?.itemsByName?.[name]?.stackSize || 64;
const itemId = (bot, name) => bot.registry?.itemsByName?.[name]?.id;
const isBucket = name => name === 'bucket' || name === 'water_bucket';
const words = name => String(name).replaceAll('_', ' ');
const bestFirst = bot => (a, b) => toolTier(b.name) - toolTier(a.name) || durabilityLeft(bot, b) - durabilityLeft(bot, a);

// The kit: what a respawned bot needs to get from the bed back to where it
// died without a rung of gathering. `count` is what the chest holds; `keep`
// is what stays in the pockets when stocking; `low` is the carried level at
// which the chest is drawn on. Tools, food and the bucket have their own
// rules below: the best tool of each kind is kept and the next best is the
// spare; food is measured in points against the expedition reserve; a water
// bucket is only ever a spare, never gathered for the chest.
const SPARE_KIT = Object.freeze([
  { slot: 'pickaxe', count: 1, tool: 'pickaxe', label: 'a pickaxe' },
  { slot: 'sword', count: 1, tool: 'sword', label: 'a sword' },
  { slot: 'logs', count: 8, keep: 8, low: 2, matches: name => /_log$/.test(name), label: 'logs' },
  { slot: 'cobblestone', count: 64, keep: 64, low: 16, matches: name => name === 'cobblestone', label: 'cobblestone' },
  { slot: 'food', count: 8, food: true, label: 'cooked food' },
  { slot: 'crafting_table', count: 1, keep: 1, low: 0, matches: name => name === 'crafting_table', label: 'a crafting table' },
  { slot: 'furnace', count: 1, keep: 1, low: 0, matches: name => name === 'furnace', label: 'a furnace' },
  // A bed for the road: the respawn already has one under it, the pockets
  // want one for the first dusk away from home.
  { slot: 'bed', count: 1, keep: 1, low: 0, matches: name => /_bed$/.test(name), label: 'a bed' },
  { slot: 'water_bucket', count: 1, bucket: true, optional: true, label: 'a water bucket' },
]);

// What goes in the chest before a Nether trip: nothing here is any use on
// the far side of the portal and all of it burns with the body. Diamonds
// stay in the pockets until the diamond pickaxe exists, because the pickaxe
// is what the portal's obsidian needs; a few iron ingots are kept for a
// replacement tool where there is no ore.
const VALUABLES = Object.freeze({
  diamond: bot => countOf(bot, 'diamond_pickaxe') ? 0 : Infinity, emerald: 0, gold_ingot: 0, raw_gold: 0, raw_iron: 0,
  iron_ingot: 8, copper_ingot: 0, lapis_lazuli: 16, amethyst_shard: 0, netherite_ingot: 0, netherite_scrap: 0,
});

// Keepsakes: useless now, precious later. String and feathers are a bow
// and arrows, wool is the next bed, leather is a book, bones are bone meal
// for the plot, gunpowder is a TNT charge, flint is a fire, and a stack of
// seeds replants the plot after a creeper. None of it is worth carrying
// through a death, all of it is worth a walk to the chest later. `keep` is
// what stays in the pockets; everything over it goes in whenever the bot
// is at home stocking the chest, and comes out again when a rung or a plan
// step consumes it. Nether and End supplies keep what the eyes need (the
// ladder counts them in the pockets; a chest full of pearls would send the
// bot back through the portal for more), gold keeps what golden boots
// need until the boots exist, iron keeps a tool's worth, and diamonds stay
// out until the diamond pickaxe is made.
const STACK = 64;
const bootsCarried = items => items.some(i => i.name === 'golden_boots');
const KEEPSAKES = Object.freeze([
  { label: 'wool', matches: name => /_wool$/.test(name), keep: 3 },
  { label: 'string', matches: name => name === 'string', keep: 0 },
  { label: 'feathers', matches: name => name === 'feather', keep: 0 },
  // Eight bones stay in the pockets: a wild wolf is tamed where it is met.
  { label: 'bones', matches: name => name === 'bone', keep: 8 },
  { label: 'bone meal', matches: name => name === 'bone_meal', keep: 0 },
  { label: 'gunpowder', matches: name => name === 'gunpowder', keep: 0 },
  { label: 'arrows', matches: name => name === 'arrow', keep: 32 },
  { label: 'leather', matches: name => name === 'leather', keep: 0 },
  { label: 'flint', matches: name => name === 'flint', keep: 8 },
  { label: 'iron', matches: name => name === 'iron_ingot', keep: 8 },
  { label: 'raw iron', matches: name => name === 'raw_iron', keep: 8 },
  { label: 'gold', matches: name => name === 'gold_ingot', keep: (bot, items) => bootsCarried(items) ? 0 : 4 },
  { label: 'raw gold', matches: name => name === 'raw_gold', keep: (bot, items) => bootsCarried(items) ? 0 : Math.max(0, 4 - totalOf(items, n => n === 'gold_ingot')) },
  { label: 'diamonds', matches: name => name === 'diamond', keep: (bot, items) => items.some(i => i.name === 'diamond_pickaxe') ? 0 : Infinity },
  { label: 'ender pearls', matches: name => name === 'ender_pearl', keep: 16 },
  { label: 'blaze rods', matches: name => name === 'blaze_rod', keep: 8 },
  { label: 'blaze powder', matches: name => name === 'blaze_powder', keep: 16 },
  // A portal's worth stays in the pockets: it builds the frame, and in the
  // Nether it rebuilds one a ghast has broken.
  { label: 'obsidian', matches: name => name === 'obsidian', keep: 10 },
  { label: 'logs', matches: name => /_log$/.test(name), keep: 8 },
  { label: 'coal', matches: name => name === 'coal' || name === 'charcoal', keep: 16 },
  { label: 'seeds', matches: name => /_seeds$/.test(name), keep: STACK },
  { label: 'wheat', matches: name => name === 'wheat', keep: STACK },
  { label: 'carrots', matches: name => name === 'carrot', keep: STACK },
  { label: 'potatoes', matches: name => name === 'potato', keep: STACK },
]);
const keepsakeOf = name => KEEPSAKES.find(k => k.matches(name)) || null;
const isKeepsake = name => !!keepsakeOf(name);
// Anything the kit has a slot for: what a respawn needs is worth picking up.
const isKitMaterial = (bot, name) => SPARE_KIT.some(slot => !slot.tool && slotFits(bot, slot, name)) || (toolKind(name) !== null && toolTier(name) >= 2);

function slotFits(bot, slot, name) {
  if (slot.tool) return toolKind(name) === slot.tool && toolTier(name) >= 2;
  if (slot.food) return safeFood(bot, { name });
  if (slot.bucket) return name === 'water_bucket';
  return slot.matches(name);
}

const totalOf = (items, test) => items.filter(i => test(i.name)).reduce((n, i) => n + i.count, 0);
const pointsOf = (bot, items) => items.filter(i => safeFood(bot, i)).reduce((n, i) => n + i.count * foodPoints(bot, i.name), 0);
const contentsOf = home => home.stash?.contents || {};
const storedIn = (bot, home, slot) => Object.entries(contentsOf(home)).filter(([name]) => slotFits(bot, slot, name)).reduce((n, [, c]) => n + c, 0);

// What the pockets can spare for one kit slot, best first, as stacks.
function spares(bot, slot, items) {
  if (slot.tool) {
    const tools = items.filter(i => slotFits(bot, slot, i.name) && usable(bot, i)).sort(bestFirst(bot));
    return tools.slice(1).map(i => ({ item: i.name, count: 1 }));
  }
  if (slot.food) {
    let points = pointsOf(bot, items);
    const out = [];
    for (const i of [...items].filter(i => safeFood(bot, i)).sort((a, b) => foodPoints(bot, b.name) - foodPoints(bot, a.name))) {
      const each = foodPoints(bot, i.name);
      const n = Math.min(i.count, Math.floor((points - KIT_FOOD_POINTS) / each));
      if (n > 0) { out.push({ item: i.name, count: n }); points -= n * each; }
    }
    return out;
  }
  if (slot.bucket) {
    const n = Math.min(totalOf(items, n => n === 'water_bucket'), totalOf(items, isBucket) - 1);
    return n > 0 ? [{ item: 'water_bucket', count: n }] : [];
  }
  return spareByType(items, slot.matches, slot.keep);
}

// What the pockets can spare of one family of stackables, by type, biggest
// pile first, after `moved` (what earlier rules already put in the chest).
function spareByType(items, matches, keep, moved = {}) {
  const counts = {};
  for (const i of items) if (matches(i.name)) counts[i.name] = (counts[i.name] || 0) + i.count;
  for (const name of Object.keys(counts)) counts[name] = Math.max(0, counts[name] - (moved[name] || 0));
  let spare = Object.values(counts).reduce((n, c) => n + c, 0) - keep;
  const out = [];
  for (const [name, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    if (spare <= 0) break;
    const n = Math.min(count, spare); if (n > 0) out.push({ item: name, count: n }); spare -= n;
  }
  return out;
}

// The moves from pockets to chest: kit slots the chest is short of, filled
// from what the pockets can spare, then the keepsakes over what the pockets
// keep, and before the Nether the valuables. Each rule sees what the ones
// before it already moved, so a log is a kit log or a keepsake, never both.
// What the chest holds of the bulk things at most: past this they stay in
// the pockets (and the tidy's rules) instead. The dream run's chest held
// 216 coal in four stacks, 103 raw iron and 99 lapis, and with all
// twenty-seven slots taken every deposit before the Nether failed, nine
// times over, while the ladder waited on it.
const CHEST_MAX = Object.freeze({ coal: 64, charcoal: 64, raw_iron: 64, raw_gold: 64, lapis_lazuli: 64, iron_ingot: 64, bone: 16, feather: 32, leather: 32, flint: 16 });
const woolCap = 16;
function capped(home, name, count, moved) {
  const cap = /_wool$/.test(name) ? woolCap : CHEST_MAX[name];
  if (cap === undefined) return count;
  return Math.max(0, Math.min(count, cap - (contentsOf(home)[name] || 0) - (moved[name] || 0)));
}

// Food goes in only where it may leave the pockets (food-keep.js, note
// 690): not in the Nether, not on the valuables trip before it, and not
// while the crossing is ahead; there the food carried is the stay's.
function stashDeposits(bot, home, { valuables = false, items = bot.inventory.items(), goal = bot._goal } = {}) {
  const moves = [], moved = {};
  const foodKept = valuables || !!require('./food-keep').foodStays(bot, goal);
  const record = move => {
    const count = capped(home, move.item, move.count, moved);
    if (count <= 0) return;
    moves.push({ ...move, count }); moved[move.item] = (moved[move.item] || 0) + count;
  };
  for (const slot of SPARE_KIT) {
    if (slot.food && foodKept) continue;
    let need = slot.count - storedIn(bot, home, slot);
    for (const spare of spares(bot, slot, items)) {
      if (need <= 0) break;
      const count = Math.min(spare.count, need);
      record({ item: spare.item, count, slot: slot.slot }); need -= count;
    }
  }
  for (const keepsake of KEEPSAKES) {
    const keep = typeof keepsake.keep === 'function' ? keepsake.keep(bot, items) : keepsake.keep;
    for (const spare of spareByType(items, keepsake.matches, keep, moved)) record({ ...spare, keepsake: keepsake.label });
  }
  if (valuables) {
    for (const [name, keep] of Object.entries(VALUABLES)) {
      const limit = typeof keep === 'function' ? keep(bot) : keep;
      // A keepsake move of the same valuable is the valuables trip's too.
      for (const move of moves) if (move.item === name && move.keepsake) move.valuable = true;
      const count = totalOf(items, n => n === name) - limit - (moved[name] || 0);
      if (count > 0) record({ item: name, count, valuable: true });
    }
  }
  return moves;
}

// The moves from chest to pockets: kit slots the pockets have run low on,
// and whatever the ladder's next rung is about to go and gather.
// The food a restock tops the pockets up to. Twelve points is a day's work;
// the Nether needs twenty-four, and a restock that stopped at twelve sent
// the bot hunting for cows that were not there, gave up, and walked into
// the Nether with nothing, eight cooked beef left behind in the chest.
// Forty since: with twenty-four, mid-92-p wanted food three minutes after
// reaching its fortress and mid-83-j went home hungry from its spawner
// (2026-09-26); a blaze fight is paid for in hunger, healing back.
// Eighty since note 607: the whole stay the goal needs (crossing-kit.js
// netherStay), two hours for a practiced player at about forty hunger an
// hour; with forty, the fortress cohort of 2026-09-28 sat for minutes at a
// time under eight health with nothing to eat, and most of those stretches
// ended in a death.
const NETHER_FOOD_POINTS = 80;
// One reserve (food-reserve.js, note 796): the crossing's want, or the
// Overworld's floor the record bears out (12 points, KIT_FOOD_POINTS).
const foodTarget = (goal, bot = null) => goal?.preparingNether ? (bot ? require('./food-reserve').crossingWant(bot, goal) : NETHER_FOOD_POINTS) : KIT_FOOD_POINTS;

function stashWithdrawals(bot, home, wants = [], { items = bot.inventory.items(), foodPoints: target = KIT_FOOD_POINTS } = {}) {
  const stored = { ...contentsOf(home) }, moves = [];
  const take = (name, count, why) => {
    const n = Math.min(count, stored[name] || 0);
    if (n <= 0) return 0;
    stored[name] -= n;
    const existing = moves.find(m => m.item === name && m.slot === why.slot && m.want === why.want);
    if (existing) existing.count += n; else moves.push({ item: name, count: n, ...why });
    return n;
  };
  const storedTools = kind => Object.keys(stored).filter(name => toolKind(name) === kind && stored[name] > 0).sort((a, b) => toolTier(b) - toolTier(a));
  for (const slot of SPARE_KIT) {
    if (slot.tool) {
      if (!items.some(i => slotFits(bot, slot, i.name) && usable(bot, i))) for (const name of storedTools(slot.tool)) if (take(name, 1, { slot: slot.slot })) break;
    } else if (slot.food) {
      // The slot's eight pieces are a day's kit; food for the Nether stay
      // is taken by its points (note 607).
      let points = pointsOf(bot, items), pieces = 0;
      const cap = target > KIT_FOOD_POINTS ? Infinity : slot.count;
      const foods = Object.keys(stored).filter(name => safeFood(bot, { name })).sort((a, b) => foodPoints(bot, b) - foodPoints(bot, a));
      for (const name of foods) {
        while (points < target && pieces < cap && take(name, 1, { slot: slot.slot })) { points += foodPoints(bot, name); pieces++; }
      }
    } else if (slot.bucket) {
      if (!items.some(i => isBucket(i.name))) take('water_bucket', 1, { slot: slot.slot });
    } else if (totalOf(items, slot.matches) <= slot.low) {
      let need = slot.count - totalOf(items, slot.matches);
      for (const name of Object.keys(stored).filter(slot.matches)) { if (need <= 0) break; need -= take(name, need, { slot: slot.slot }); }
    }
  }
  for (const want of wants) {
    const kind = toolKind(want.item);
    // A tool the kit rule is already taking answers the rung too.
    if (kind) { if (!moves.some(m => toolKind(m.item) === kind && toolTier(m.item) >= toolTier(want.item))) for (const name of storedTools(kind)) if (toolTier(name) >= toolTier(want.item) && take(name, 1, { want: want.item })) break; }
    else if (want.item === 'bucket') { if (!moves.some(m => isBucket(m.item))) take('water_bucket', 1, { want: want.item }) || take('bucket', 1, { want: want.item }); }
    else take(want.item, want.count || 1, { want: want.item });
  }
  return moves;
}

// What the ladder's next rung would go and gather, for the chest to answer:
// the rung's own item, and with the home known, the wool for its bed and
// the ingredients of its plan that the chest holds, so a keepsake put away
// last week is a walk to the chest and not a hunt.
function rungWants(bot, rung, { home = null, goal = null } = {}) {
  if (!rung) return [];
  const wants = [];
  if (rung.action === 'acquire') wants.push({ item: rung.item, count: Math.max(1, (rung.count || 1) - countOf(bot, rung.item)) });
  if (rung.action === 'acquire_set') wants.push(...(rung.items || []).map(item => ({ item, count: 1 })));
  if (rung.action === 'gather_wool' && home) wants.push(...woolWants(bot, home, rung.count || 3));
  if (['acquire', 'acquire_set'].includes(rung.action) && home) wants.push(...planWants(bot, home, rung, goal));
  return wants;
}

// A bed is three wool of one colour: the carried colour's shortfall if the
// chest has it, else any colour the chest has a whole bed of.
function woolWants(bot, home, needed) {
  const stored = contentsOf(home), carried = base().woolCarried(bot);
  if ((stored[`${carried.colour}_wool`] || 0) >= needed) return [{ item: `${carried.colour}_wool`, count: needed }];
  const whole = Object.keys(stored).find(name => /_wool$/.test(name) && stored[name] >= 3);
  return whole ? [{ item: whole, count: 3 }] : [];
}

// The ingredients of the rung's plan that the chest holds. The plan is read
// backwards: a step whose product the chest already covers is skipped with
// everything under it, so a chest of ingots answers the craft and the mine
// and smelt beneath it are never asked for. What the pockets hold is spent
// before the chest is.
function planWants(bot, home, rung, goal) {
  const stored = contentsOf(home);
  if (!Object.keys(stored).some(name => stored[name] > 0) || !bot.findBlocks) return [];
  let plan;
  try {
    const { catalogPlan, planningInventory } = require('./work');
    const outputs = rung.action === 'acquire_set' ? (rung.items || []).map(item => ({ item, count: 1 })) : rung.item;
    plan = catalogPlan(bot, outputs, rung.count || 1, planningInventory(bot), goal || {});
  } catch (_) { return []; }
  return planIngredients(bot, stored, plan);
}

function planIngredients(bot, stored, plan) {
  const carried = {};
  for (const i of bot.inventory.items()) carried[i.name] = (carried[i.name] || 0) + i.count;
  const wants = {}, covered = {};
  for (const step of [...plan].reverse()) {
    const produced = Object.entries(step.produces || {});
    if (produced.length && produced.every(([name, n]) => (covered[name] || 0) >= n)) { for (const [name, n] of produced) covered[name] -= n; continue; }
    for (const [name, n] of Object.entries(step.consumes || {})) {
      const own = Math.min(n, carried[name] || 0); carried[name] = (carried[name] || 0) - own;
      const take = Math.min(n - own, (stored[name] || 0) - (wants[name] || 0));
      if (take > 0) { wants[name] = (wants[name] || 0) + take; covered[name] = (covered[name] || 0) + take; }
    }
  }
  return Object.entries(wants).map(([item, count]) => ({ item, count }));
}

function stashStatus(bot, home) {
  const at = base().layout(home).chest;
  const block = bot.blockAt(pos(at));
  return { at, loaded: !!block, placed: isChest(block) };
}

function forgetChest(home) {
  if (!home.stash) return;
  delete home.stash.position; home.stash.contents = {}; home.stash.lostAt = new Date().toISOString();
}

function rememberContents(home, window) {
  const contents = {};
  for (const i of window.containerItems()) contents[i.name] = (contents[i.name] || 0) + i.count;
  home.stash = { ...home.stash, contents, seenAt: new Date().toISOString() };
  return contents;
}

const describeContents = contents => Object.entries(contents).map(([name, count]) => `${count} ${words(name)}`).join(', ');
const describeMoves = moves => {
  const counts = {};
  for (const m of moves) counts[m.item] = (counts[m.item] || 0) + m.count;
  return Object.entries(counts).map(([name, count]) => `${count} ${words(name)}`).join(', ');
};

// The restock rung: at the base (or within reach of it) with the chest
// holding something the pockets are short of or the ladder is about to go
// and gather. Read from memory of the chest; the walk happens only when
// there is something to take.
function restockStage(bot, goal, wants = [], { now = Date.now() } = {}) {
  const { homeOf, homeDistance, HOME_REACH } = base();
  const home = homeOf(bot, goal);
  if (!home?.stash?.position || homeDistance(bot, home) > HOME_REACH) return null;
  if (isSetAside(goal, 'stash', 'chest', now)) return null;
  const moves = stashWithdrawals(bot, home, wants, { foodPoints: foodTarget(goal, bot) }).filter(m => !isSetAside(goal, 'restock_item', m.item, now));
  if (!moves.length) return null;
  return { phase: 'home_restock', action: 'restock', items: moves };
}

// Ground under the chest cell, laid from the bottom up where it is open:
// trial 98's chest was blown up by a creeper and took the ground under it,
// and "no adjacent solid anchor" came back three times from a cell with a
// crater under it and water beside it (2026-09-25).
async function groundUnder(bot, task, actions, cell) {
  const { SCAFFOLD } = require('./pillar-recovery');
  const open = [];
  for (let dy = 1; dy <= 3; dy++) {
    const b = bot.blockAt(cell.offset(0, -dy, 0));
    if (!b || b.boundingBox === 'block') break;
    open.push(cell.offset(0, -dy, 0));
  }
  if (!open.length) return;
  if (bot.blockAt(cell.offset(0, -open.length - 1, 0))?.boundingBox !== 'block') throw new Error(`No ground within three blocks under the chest at ${cell}`);
  for (const p of open.reverse()) {
    const filler = bot.inventory.items().find(i => SCAFFOLD.includes(i.name));
    if (!filler) throw new Error(`No block to lay under the chest at ${cell}`);
    await actions.place(bot, task, p, filler.name);
  }
}

async function placeStashChest(bot, task, goal, save, home, actions) {
  const { chest } = base().layout(home);
  goal.step = { action: 'place_chest', at: chest }; save();
  task.check(); checkAir(bot); checkThreats(bot);
  if (!isChest(bot.blockAt(pos(chest)))) {
    await base().clearStray(bot, task, actions, [chest, { x: chest.x, y: chest.y + 1, z: chest.z }]);
    await groundUnder(bot, task, actions, pos(chest));
    await actions.place(bot, task, pos(chest), 'chest');
  }
  if (!isChest(bot.blockAt(pos(chest)))) throw new Error('The chest did not go beside the bed');
  home.stash = { ...home.stash, position: plain(chest), placedAt: new Date().toISOString(), contents: home.stash?.contents || {} };
  delete home.stash.lostAt; save();
}

async function approachChest(bot, task, goal, save, home, actions) {
  const { homeDistance, goHome } = base();
  const at = home.stash.position;
  if (homeDistance(bot, home) > NEAR || !bot.blockAt(pos(at))) await goHome(bot, task, goal, save, home, actions);
  task.check(); checkAir(bot); checkThreats(bot);
  await actions.navigate(bot, task, new goals.GoalNear(at.x, at.y, at.z, 2), { timeoutMs: 30000, stallMs: 8000 });
  const block = bot.blockAt(pos(at));
  if (!isChest(block)) { forgetChest(home); save(); throw new Error('The stash chest is not where it was placed'); }
  // A chest will not open under a solid block. A night shelter built at the
  // base put one on the lid, and every fetch of the food inside failed.
  const lid = bot.blockAt(pos(at).offset(0, 1, 0));
  if (lid && lid.boundingBox === 'block' && lid.diggable && !/chest|bed$|furnace|crafting_table/.test(lid.name)) {
    task.check();
    await actions.dig(bot, task, lid.position || pos(at).offset(0, 1, 0), { requireDrops: false });
  }
  return block;
}

async function withChest(bot, task, goal, save, home, actions, work) {
  const block = await approachChest(bot, task, goal, save, home, actions);
  const window = await openChest(bot, task, block);
  try {
    if (bot._syncWindow) await bot._syncWindow(window);
    rememberContents(home, window); save();
    return await work(window);
  } finally {
    try { if (bot._syncWindow) await bot._syncWindow(window); } catch (_) {}
    rememberContents(home, window); save();
    window.close();
  }
}

// A stackable item moves by type; a tool moves by slot, so the spare goes
// in and the one the bot keeps stays in its hand.
async function moveIn(bot, window, move) {
  if (stackSize(bot, move.item) === 1) {
    const kind = toolKind(move.item);
    const candidates = window.items().filter(i => kind ? toolKind(i.name) === kind && toolTier(i.name) >= 2 && usable(bot, i) : i.name === move.item).sort(bestFirst(bot));
    const kept = kind ? candidates[0] : null;
    const item = candidates.find(i => i !== kept && i.name === move.item);
    if (!item) throw new Error(`No spare ${words(move.item)} to put away`);
    const slot = window.firstEmptyContainerSlot();
    if (slot === null || slot === undefined) throw new Error('The stash chest is full');
    await bot.moveSlotItem(item.slot, slot);
    return;
  }
  await window.deposit(itemId(bot, move.item), null, move.count);
}

async function moveOut(bot, window, move) {
  if (stackSize(bot, move.item) === 1) {
    const item = window.containerItems().filter(i => i.name === move.item).sort(bestFirst(bot))[0];
    if (!item) throw new Error(`No ${words(move.item)} in the stash chest after all`);
    const slot = window.firstEmptyInventorySlot();
    if (slot === null || slot === undefined) throw new Error('No room in my pockets for the kit');
    await bot.moveSlotItem(item.slot, slot);
    return;
  }
  await window.withdraw(itemId(bot, move.item), null, move.count);
}

// Put spares (and, before the Nether, valuables) in the chest. The moves
// are worked out again against the real contents once the lid is open.
async function stockStash(bot, task, goal, save, home, actions, { valuables = false, only = null } = {}) {
  const planned = stashDeposits(bot, home, { valuables, goal }).filter(m => !only || only(m));
  if (!planned.length) return [];
  const step = () => { goal.step = { action: valuables ? 'stash_valuables' : 'stock_stash', items: planned }; save(); };
  step();
  return withChest(bot, task, goal, save, home, actions, async window => {
    // The walk home has its own step; back at the chest, this is the step again.
    step();
    const stored = [];
    for (const move of stashDeposits(bot, home, { valuables, items: window.items(), goal }).filter(m => !only || only(m))) {
      task.check();
      // Only what fits: a free slot, or room in a stack of the same item.
      if (!chestRoomFor(bot, window, move.item)) continue;
      try { await moveIn(bot, window, move); stored.push(move); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    // Food put away is said, with what stays carried (note 690).
    const food = require('./food-keep').foodSays(bot, stored);
    if (food) bot.chat?.(`Put ${food} in the chest; ${require('./food-keep').carriedPoints(bot)} food points stay in my pockets.`);
    home.stash.stockedAt = new Date().toISOString();
    home.stash.slots = containerSlots(window);
    if (freeContainerSlots(window) === 0) home.stash.fullAt = new Date().toISOString(); else delete home.stash.fullAt;
    return stored;
  });
}

const containerSlots = window => Number.isInteger(window.inventoryStart) ? window.inventoryStart : 27;
const freeContainerSlots = window => Array.isArray(window.slots) ? window.slots.slice(0, containerSlots(window)).filter(i => !i).length : 1;
function chestRoomFor(bot, window, name) {
  if (freeContainerSlots(window) > 0) return true;
  const size = stackSize(bot, name);
  return size > 1 && typeof window.containerItems === 'function' && window.containerItems().some(i => i.name === name && i.count < size);
}

// A full single chest becomes a double one: a second chest beside it,
// facing the same way, which the game joins to the first. Once; a chest
// that will not join is taken back up and the stash stays as it is.
async function expandStash(bot, task, goal, save, home, actions) {
  const at = pos(home.stash.position);
  const block = bot.blockAt(at);
  if (!isChest(block)) return false;
  const props = typeof block.getProperties === 'function' ? block.getProperties() : {};
  if (props.type && props.type !== 'single') return false;
  const facing = props.facing || 'north';
  const sides = /north|south/.test(facing) ? [new Vec3(1, 0, 0), new Vec3(-1, 0, 0)] : [new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
  const cell = sides.map(d => at.plus(d)).find(c => {
    const here = bot.blockAt(c), floor = bot.blockAt(c.offset(0, -1, 0)), above = bot.blockAt(c.offset(0, 1, 0));
    return here && ['air', 'cave_air', 'short_grass', 'leaf_litter', 'snow'].includes(here.name) && floor?.boundingBox === 'block' && above?.boundingBox === 'empty';
  });
  if (!cell) return false;
  goal.step = { action: 'expand_stash', at: plain(cell), facing }; save();
  if (!countOf(bot, 'chest')) {
    if (!actions.acquireStep) return false;
    await actions.acquireStep(bot, task, 'chest', 1, goal, save);
  }
  await actions.place(bot, task, cell, 'chest', { properties: { facing } });
  const placed = bot.blockAt(cell);
  const joined = isChest(placed) && (typeof placed.getProperties !== 'function' || (placed.getProperties().type || 'single') !== 'single');
  if (!joined) {
    if (isChest(placed) && actions.dig) { try { await actions.dig(bot, task, cell); } catch (err) { task.check(); } }
    return false;
  }
  home.stash.second = plain(cell); home.stash.expandedAt = new Date().toISOString(); delete home.stash.fullAt; save();
  bot.chat?.('The stash chest was full, so I made it a double chest.');
  return true;
}

// Take the kit out: what the pockets are short of and what the ladder wants.
async function restockFromStash(bot, task, goal, save, home, actions, wants = []) {
  const step = () => { goal.step = { action: 'restock', items: stashWithdrawals(bot, home, wants, { foodPoints: foodTarget(goal, bot) }) }; save(); };
  step();
  // Room first, with the lid shut (nothing can be dropped from an open
  // window): with thirty-six slots taken the spare pickaxe had nowhere to
  // go, and the chest was opened and shut once a second for twenty seconds.
  const planned = goal.step.items || [];
  const { makeRoom } = require('./inventory-tidy');
  const keep = new Set(planned.map(m => m.item));
  for (const move of planned) { task.check(); await makeRoom(bot, task, move.item, { keep, goal, away: pos(home.stash.position) }); }
  try {
    const taken = await withChest(bot, task, goal, save, home, actions, async window => {
      step();
      const taken = [];
      for (const move of stashWithdrawals(bot, home, wants, { items: window.items(), foodPoints: foodTarget(goal, bot) })) {
        task.check();
        try { await moveOut(bot, window, move); taken.push(move); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      }
      home.stash.restockedAt = new Date().toISOString();
      return taken;
    });
    // Nothing came out: the same plan would open the chest again at once.
    // Its items rest a quarter of an hour, not thirty tries.
    if (!taken.length) { for (const move of planned) setAside(goal, 'restock_item', move.item, 'the restock took nothing', 900000); save(); }
    return taken;
  } catch (err) {
    if (!['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name) && home.stash) { setAside(goal, 'stash', 'chest', err, RETRY_MS); save(); }
    throw err;
  }
}

// Before a Nether trip: leave the valuables at home. True when there is
// nothing to leave or no chest to leave it in; false after a deposit, so
// the ladder looks again with lighter pockets.
async function stashValuables(bot, task, goal, save, actions, { now = Date.now() } = {}) {
  const { homeOf, homeDistance, HOME_REACH } = base();
  const home = homeOf(bot, goal);
  if (!home?.stash?.position || homeDistance(bot, home) > HOME_REACH) return true;
  if (isSetAside(goal, 'stash', 'chest', now) || isSetAside(goal, 'stash', 'valuables', now)) return true;
  if (!stashDeposits(bot, home, { valuables: true }).some(m => m.valuable)) return true;
  let stored = [];
  try { stored = await stockStash(bot, task, goal, save, home, actions, { valuables: true }); }
  catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    if (home.stash) { setAside(goal, 'stash', 'chest', err, RETRY_MS); save(); }
    return false;
  }
  // Full: a second chest once, and otherwise the trip goes on with what
  // could not be stored. Returning false with nothing stored asked again,
  // nine times, and the portal waited on a chest with no room.
  if (home.stash?.fullAt && !isSetAside(goal, 'stash', 'expand', now)) {
    let expanded = false;
    try { expanded = await expandStash(bot, task, goal, save, home, actions); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    if (!expanded) { setAside(goal, 'stash', 'expand', 'could not add a second chest', 60 * 60 * 1000); save(); }
    else return false;
  }
  if (!stored.some(m => m.valuable)) { setAside(goal, 'stash', 'valuables', 'nothing more fits', RETRY_MS); save(); return true; }
  return false;
}

// A spare pickaxe and sword left in the chest before a Nether trip (note
// 1045): what the chest lacks of them, a spare of each carried or what the
// pockets make one from (iron ingots first, three and two; else cobblestone;
// two sticks and one, or the wood for them). On 2026-10-03 thirteen of
// fourteen trials had a bed and a stash chest and twelve of the chests were
// empty; the four deaths in the Nether that were played on were back in the
// Nether 22 to 52 minutes later, a median 37, the kit mined and smelted
// again from bare hands. -> { home, far, lacks, makes, holds, says } or null
const REGEAR = Object.freeze({ day: '2026-10-03', deaths: 4, min: 22, max: 52, median: 37 });
// And the deaths that followed a death, the bot back bare (night-record.js
// BARE, note 1114): what a sword in the chest by the bed is against (note
// 1115). The spare kit was offered 183 times at the crossing on 2026-10-03
// (12:00 to 20:00Z) and taken none, told only of the minutes of regearing.
function bareAgainSays() {
  try {
    const { BARE } = require('./night-record');
    return ` And on ${BARE.day} (${BARE.from} to ${BARE.to}), of ${BARE.deaths} deaths ${BARE.again10} were followed by another of the same trial within ten minutes and ${BARE.again20} within twenty, the bot back with empty hands among the mobs by its bed: a sword and a pickaxe in the chest are in hand the moment it is back.`;
  } catch (_) { return ''; }
}
function spareKitOffer(bot, goal, { now = Date.now() } = {}) {
  if (bot.game?.gameMode !== 'survival' || !/overworld/.test(String(bot.game?.dimension || 'overworld'))) return null;
  const { homeOf, homeDistance, HOME_REACH } = base();
  const home = homeOf(bot, goal);
  if (!home?.stash?.position || homeDistance(bot, home) > HOME_REACH) return null;
  if (isSetAside(goal, 'stash', 'chest', now) || isSetAside(goal, 'stash', 'spare_kit', now)) return null;
  const items = bot.inventory.items();
  const n = name => countOf(bot, name);
  const sticks = n('stick') + 4 * items.filter(i => /_planks$/.test(i.name)).reduce((c, i) => c + i.count, 0) / 2 + 8 * items.filter(i => /_(log|stem)$/.test(i.name)).reduce((c, i) => c + i.count, 0);
  let ingots = n('iron_ingot'), stone = n('cobblestone') + n('cobbled_deepslate') + n('blackstone'), sticksLeft = sticks;
  const lacks = [], makes = [], spare = [];
  for (const slot of SPARE_KIT.filter(k => k.tool)) {
    if (storedIn(bot, home, slot) >= slot.count) continue;
    lacks.push(slot.tool);
    if (spares(bot, slot, items).length) { spare.push(slot.tool); continue; }
    const head = slot.tool === 'pickaxe' ? 3 : 2, handle = slot.tool === 'pickaxe' ? 2 : 1;
    if (sticksLeft < handle) continue;
    if (ingots >= head) { makes.push({ item: `iron_${slot.tool}`, from: `${head} of the ${n('iron_ingot')} iron ingots carried` }); ingots -= head; sticksLeft -= handle; }
    else if (stone >= head) { makes.push({ item: `stone_${slot.tool}`, from: `${head} of the stone carried` }); stone -= head; sticksLeft -= handle; }
  }
  if (!makes.length && !spare.length) return null;
  const far = Math.round(homeDistance(bot, home)), holds = describeContents(contentsOf(home));
  const made = makes.length ? `make ${makes.map(m => `a spare ${words(m.item)} (${m.from})`).join(' and ')}, a few seconds at a crafting table, and ` : '';
  const carried = spare.length ? `${makes.length ? 'with ' : ''}the spare ${spare.join(' and ')} carried` : '';
  return { home, far, lacks, makes, holds,
    says: `Leave a spare kit in the stash chest at home first, ${far} blocks off, about ${Math.max(5, Math.round(far / 4.3))} seconds each way: ${made}leave ${makes.length ? `${makes.length === 1 ? 'it' : 'them'}${carried ? ` ${carried}` : ''}` : carried} there (the chest holds ${holds || 'nothing yet'}). A death in the Nether comes back to life at the bed with empty hands, and what is in the chest is taken up from there: on ${REGEAR.day} the ${REGEAR.deaths} deaths in the Nether with the chest empty were back in the Nether ${REGEAR.min} to ${REGEAR.max} minutes later, a median ${REGEAR.median}, the kit mined and smelted again.${bareAgainSays()}` };
}
// The spare kit, asked on its own at home (spare_kit_now, note 1222): leave
// it now, or go on. It was one answer of the crossing's question beside
// crossing now and each top-up: from 06:00 to 14:10Z on 2026-10-04 it was
// offered there 109 times and taken once (0.05 on the mean), where Jev takes
// a spare pickaxe at upkeep most times it is offered; of nineteen deaths
// from 08:00 to 10:15Z, six were a bot's second, back bare among the mobs
// by its bed, and gear rungs were a fifth to a quarter of the long trials'
// played minutes. Asked once for what the chest lacks, and again after half
// an hour. -> true when a step was used on it
const SPARE_ASK_MS = 30 * 60000;
const TODAY = 'On 2026-10-04 (08:00 to 10:15Z) six of nineteen deaths were a bot\'s second, back with empty hands among the mobs by its bed, and making the kit again was a fifth to a quarter of the long trials\' played minutes.';
async function askSpareKit(bot, task, goal, save, actions, client, { now = Date.now() } = {}) {
  if (!client || goal?.kind !== 'win') return false;
  const offer = spareKitOffer(bot, goal, { now });
  if (!offer) return false;
  const sig = offer.lacks.join(','), a = goal.spareKitAsked;
  if (a && a.sig === sig && now - a.at < SPARE_ASK_MS) return false;
  goal.spareKitAsked = { sig, at: now }; save?.();
  const tree = {
    leave_spare_kit: { description: `${offer.says} ${TODAY}` },
    go_on: { description: `Go on without leaving one: the chest at home holds ${offer.holds || 'nothing yet'}, and a death comes back to life at the bed with empty hands. ${TODAY} Asked again in half an hour, or when what the chest lacks changes.` },
  };
  let decision;
  try { decision = await require('./decisions').decide('spare_kit_now', { client, bot, task, goal, save, tree, state: { blocksToHome: offer.far, chestLacks: offer.lacks, chestHolds: offer.holds || 'nothing', health: bot.health, food: bot.food } }); }
  catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[spare_kit_now] not asked: ${String(err.message || err).slice(0, 200)}`); return false; }
  if (decision.stale || decision.path?.at(-1) !== 'leave_spare_kit') return false;
  await leaveSpareKit(bot, task, goal, save, actions, offer);
  return true;
}
// Made, carried home and put in. -> the moves stored
async function leaveSpareKit(bot, task, goal, save, actions, offer) {
  for (const m of offer.makes) {
    goal.step = { action: 'spare_kit', item: m.item }; save();
    try { await actions.acquireStep(bot, task, m.item, countOf(bot, m.item) + 1, goal, save); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[spare kit] the ${words(m.item)} was not made: ${String(err.message || err).slice(0, 160)}`); }
  }
  let stored = [];
  try { stored = await stockStash(bot, task, goal, save, offer.home, actions, { only: m => m.slot === 'pickaxe' || m.slot === 'sword' }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[spare kit] not put in the chest: ${String(err.message || err).slice(0, 160)}`); }
  if (!stored.length) { setAside(goal, 'stash', 'spare_kit', 'nothing went into the chest', RETRY_MS); save(); }
  else bot.chat?.(`Left ${describeMoves(stored)} in the chest at home: a kit to come back to.`);
  return stored;
}

// The chore Jev chooses between the others: stock the chest with spares.
function stashChores(bot, goal) {
  const { homeOf, homeDistance, HOME_REACH } = base();
  const home = homeOf(bot, goal);
  if (!home?.stash?.position) return {};
  const distance = Math.round(homeDistance(bot, home));
  if (distance > HOME_REACH) return {};
  const moves = stashDeposits(bot, home, { goal });
  if (!moves.length) return {};
  const holds = describeContents(contentsOf(home));
  const kit = describeMoves(moves.filter(m => m.slot)), keepsakes = describeMoves(moves.filter(m => m.keepsake));
  const what = [kit && `so a respawn starts with a kit: ${kit}`, keepsakes && `to keep for later: ${keepsakes}`].filter(Boolean).join(', and ');
  return { stock_stash: { description: `Put spares in the stash chest beside the bed (${distance} blocks away) ${what}. The chest holds ${holds || 'nothing yet'}.`,
    run: (b, t, g, s, a) => stockStash(b, t, g, s, home, a) } };
}

module.exports = { withChest, moveIn, chestRoomFor, CHEST_MAX, expandStash, SPARE_KIT, VALUABLES, KEEPSAKES, KIT_FOOD_POINTS, NETHER_FOOD_POINTS, slotFits, keepsakeOf, isKeepsake, isKitMaterial, stashDeposits, stashWithdrawals, rungWants, planIngredients, stashStatus, forgetChest, rememberContents,
  spareKitOffer, leaveSpareKit, askSpareKit, REGEAR,
  restockStage, placeStashChest, stockStash, restockFromStash, stashValuables, stashChores, describeContents };

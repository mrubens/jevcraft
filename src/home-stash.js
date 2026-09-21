'use strict';
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
const KIT_FOOD_POINTS = 12;
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
  iron_ingot: 8, copper_ingot: 0, lapis_lazuli: 0, amethyst_shard: 0, netherite_ingot: 0, netherite_scrap: 0,
});

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
  let spare = totalOf(items, slot.matches) - slot.keep;
  const out = [];
  for (const i of [...items].filter(i => slot.matches(i.name)).sort((a, b) => b.count - a.count)) {
    if (spare <= 0) break;
    const n = Math.min(i.count, spare); out.push({ item: i.name, count: n }); spare -= n;
  }
  return out;
}

// The moves from pockets to chest: kit slots the chest is short of, filled
// from what the pockets can spare, and before the Nether the valuables.
function stashDeposits(bot, home, { valuables = false, items = bot.inventory.items() } = {}) {
  const moves = [];
  for (const slot of SPARE_KIT) {
    let need = slot.count - storedIn(bot, home, slot);
    for (const spare of spares(bot, slot, items)) {
      if (need <= 0) break;
      const count = Math.min(spare.count, need);
      moves.push({ item: spare.item, count, slot: slot.slot }); need -= count;
    }
  }
  if (valuables) {
    for (const [name, keep] of Object.entries(VALUABLES)) {
      const limit = typeof keep === 'function' ? keep(bot) : keep;
      const count = totalOf(items, n => n === name) - limit;
      if (count > 0) moves.push({ item: name, count, valuable: true });
    }
  }
  return moves;
}

// The moves from chest to pockets: kit slots the pockets have run low on,
// and whatever the ladder's next rung is about to go and gather.
function stashWithdrawals(bot, home, wants = [], { items = bot.inventory.items() } = {}) {
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
      let points = pointsOf(bot, items), pieces = 0;
      const foods = Object.keys(stored).filter(name => safeFood(bot, { name })).sort((a, b) => foodPoints(bot, b) - foodPoints(bot, a));
      for (const name of foods) {
        while (points < KIT_FOOD_POINTS && pieces < slot.count && take(name, 1, { slot: slot.slot })) { points += foodPoints(bot, name); pieces++; }
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

// What the ladder's next rung would go and gather, for the chest to answer.
function rungWants(bot, rung) {
  if (!rung) return [];
  if (rung.action === 'acquire') return [{ item: rung.item, count: Math.max(1, (rung.count || 1) - countOf(bot, rung.item)) }];
  if (rung.action === 'acquire_set') return (rung.items || []).map(item => ({ item, count: 1 }));
  return [];
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
const describeMoves = moves => moves.map(m => `${m.count} ${words(m.item)}`).join(', ');

// The restock rung: at the base (or within reach of it) with the chest
// holding something the pockets are short of or the ladder is about to go
// and gather. Read from memory of the chest; the walk happens only when
// there is something to take.
function restockStage(bot, goal, wants = [], { now = Date.now() } = {}) {
  const { homeOf, homeDistance, HOME_REACH } = base();
  const home = homeOf(bot, goal);
  if (!home?.stash?.position || homeDistance(bot, home) > HOME_REACH) return null;
  if (home.stash.failedAt && now - Date.parse(home.stash.failedAt) < RETRY_MS) return null;
  const moves = stashWithdrawals(bot, home, wants);
  if (!moves.length) return null;
  return { phase: 'home_restock', action: 'restock', items: moves };
}

async function placeStashChest(bot, task, goal, save, home, actions) {
  const { chest } = base().layout(home);
  goal.step = { action: 'place_chest', at: chest }; save();
  task.check(); checkAir(bot); checkThreats(bot);
  if (!isChest(bot.blockAt(pos(chest)))) await actions.place(bot, task, pos(chest), 'chest');
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
async function stockStash(bot, task, goal, save, home, actions, { valuables = false } = {}) {
  const planned = stashDeposits(bot, home, { valuables });
  if (!planned.length) return [];
  const step = () => { goal.step = { action: valuables ? 'stash_valuables' : 'stock_stash', items: planned }; save(); };
  step();
  return withChest(bot, task, goal, save, home, actions, async window => {
    // The walk home has its own step; back at the chest, this is the step again.
    step();
    const stored = [];
    for (const move of stashDeposits(bot, home, { valuables, items: window.items() })) {
      task.check();
      try { await moveIn(bot, window, move); stored.push(move); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; break; }
    }
    home.stash.stockedAt = new Date().toISOString();
    return stored;
  });
}

// Take the kit out: what the pockets are short of and what the ladder wants.
async function restockFromStash(bot, task, goal, save, home, actions, wants = []) {
  const step = () => { goal.step = { action: 'restock', items: stashWithdrawals(bot, home, wants) }; save(); };
  step();
  try {
    return await withChest(bot, task, goal, save, home, actions, async window => {
      step();
      const taken = [];
      for (const move of stashWithdrawals(bot, home, wants, { items: window.items() })) {
        task.check();
        try { await moveOut(bot, window, move); taken.push(move); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; break; }
      }
      home.stash.restockedAt = new Date().toISOString();
      return taken;
    });
  } catch (err) {
    if (!['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name) && home.stash) { home.stash.failedAt = new Date().toISOString(); save(); }
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
  if (home.stash.failedAt && now - Date.parse(home.stash.failedAt) < RETRY_MS) return true;
  if (!stashDeposits(bot, home, { valuables: true }).some(m => m.valuable)) return true;
  try { await stockStash(bot, task, goal, save, home, actions, { valuables: true }); }
  catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    if (home.stash) { home.stash.failedAt = new Date(now).toISOString(); save(); }
  }
  return false;
}

// The chore Jev chooses between the others: stock the chest with spares.
function stashChores(bot, goal) {
  const { homeOf, homeDistance, HOME_REACH } = base();
  const home = homeOf(bot, goal);
  if (!home?.stash?.position) return {};
  const distance = Math.round(homeDistance(bot, home));
  if (distance > HOME_REACH) return {};
  const moves = stashDeposits(bot, home);
  if (!moves.length) return {};
  const holds = describeContents(contentsOf(home));
  return { stock_stash: { description: `Put spares in the stash chest beside the bed (${distance} blocks away) so a respawn starts with a kit: ${describeMoves(moves)}. The chest holds ${holds || 'nothing yet'}.`,
    run: (b, t, g, s, a) => stockStash(b, t, g, s, home, a) } };
}

module.exports = { SPARE_KIT, VALUABLES, KIT_FOOD_POINTS, slotFits, stashDeposits, stashWithdrawals, rungWants, stashStatus, forgetChest, rememberContents,
  restockStage, placeStashChest, stockStash, restockFromStash, stashValuables, stashChores, describeContents };

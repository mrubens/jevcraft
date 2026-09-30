'use strict';
// Trading with villagers. Emeralds come from what the run has to spare
// (coal by the hundred, sticks, wheat, rotten flesh, paper, iron, leather,
// string) and go on what the run needs: ender pearls from a cleric, arrows
// and a bow from a fletcher, armour and tools better than what is carried,
// food when the reserve is low.
//
// At a remembered village each adult villager in reach is opened and its
// offers read (kept ten minutes), then one trade is made: Jev picks among
// the feasible ones (decisions/work.js, trade_choice).
const { goals } = require('mineflayer-pathfinder');
const { countOf } = require('./skills');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');
const { setAside, isSetAside } = require('./progress');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const OFFERS_MS = 600000, READ_REACH = 24, EMERALD_BANK = 40;
// What may be sold, and how much of each is kept back.
const KEEP = { coal: 16, stick: 8, wheat: 6, rotten_flesh: 0, paper: 3, iron_ingot: 8, leather: 3, string: 3, feather: 4, bone: 0,
  pumpkin: 0, melon_slice: 0, potato: 4, carrot: 4, beetroot: 0, flint: 8, gunpowder: 0 };
const TIER = { leather: 1, chainmail: 2, golden: 2, iron: 3, diamond: 4, netherite: 5, wooden: 1, stone: 2 };
const tierOf = name => { const m = /^(\w+?)_(helmet|chestplate|leggings|boots|sword|pickaxe|axe)$/.exec(name); return m ? TIER[m[1]] || 0 : 0; };
const kindOf = name => /_(helmet|chestplate|leggings|boots|sword|pickaxe|axe)$/.exec(name)?.[1];

// What the run wants to buy, and why; null when it does not.
function wantOf(bot, name, { pearlsShort = true } = {}) {
  if (name === 'ender_pearl' && pearlsShort) return 'ender pearls for the eyes of ender';
  if (name === 'arrow' && countOf(bot, 'arrow') < 64) return 'arrows for the dragon and its crystals';
  if (name === 'bow' && !countOf(bot, 'bow')) return 'a bow';
  if (['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'golden_carrot', 'cooked_mutton'].includes(name) &&
    bot.inventory.items().filter(i => bot.registry.foodsByName?.[i.name]).reduce((n, i) => n + i.count, 0) < 12) return 'food for the reserve';
  const kind = kindOf(name);
  if (kind) {
    const worn = [5, 6, 7, 8].map(s => bot.inventory.slots?.[s]).filter(Boolean);
    const have = Math.max(0, ...[...bot.inventory.items(), ...worn].filter(i => kindOf(i.name) === kind).map(i => tierOf(i.name)));
    if (tierOf(name) > have) return `a better ${kind} than the one carried`;
  }
  return null;
}
const spare = (bot, name) => name in KEEP ? Math.max(0, countOf(bot, name) - KEEP[name]) : 0;

const villagerData = (bot, e) => e.metadata?.[bot.registry.entitiesByName.villager?.metadataKeys?.indexOf('villager_data')];
const baby = (bot, e) => e.metadata?.[bot.registry.entitiesByName[e.name]?.metadataKeys?.indexOf('baby')] === true;
function villagersNear(bot, reach = READ_REACH) {
  const here = bot.entity.position;
  return Object.values(bot.entities || {}).filter(e => e.name === 'villager' && e.isValid !== false && e.position && !baby(bot, e) &&
    e.position.distanceTo(here) <= reach).sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
}
const idOf = e => String(e.uuid || e.id);

// Each trade as the bot sees it: what goes in, what comes out, whether it
// can be made now and why it would be.
function describe(bot, villager, trade, index, opts) {
  const input = { name: trade.inputItem1?.name, count: trade.realPrice ?? trade.inputItem1?.count };
  const input2 = trade.hasItem2 && trade.inputItem2?.name ? { name: trade.inputItem2.name, count: trade.inputItem2.count } : null;
  const output = { name: trade.outputItem?.name, count: trade.outputItem?.count };
  const affordable = countOf(bot, input.name) >= input.count && (!input2 || countOf(bot, input2.name) >= input2.count);
  const open = !trade.tradeDisabled && (trade.maximumNbTradeUses == null || trade.nbTradeUses < trade.maximumNbTradeUses);
  const buy = input.name === 'emerald' && output.name !== 'emerald' ? wantOf(bot, output.name, opts) : null;
  const sell = output.name === 'emerald' && spare(bot, input.name) >= input.count && !input2 ? `spare ${input.name.replaceAll('_', ' ')} for emeralds` : null;
  return { villager: idOf(villager), index, input, input2, output, feasible: affordable && open && !!(buy || sell), kind: buy ? 'buy' : sell ? 'sell' : null, why: buy || sell };
}

async function readOffers(bot, task, goal, save, villager, { navigate }) {
  const state = goal.trading ||= { offers: {}, trades: [] };
  const known = state.offers[idOf(villager)];
  if (known && Date.now() - known.at < OFFERS_MS) return known;
  const p = villager.position.floored();
  if (villager.position.distanceTo(bot.entity.position) > 3) await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2), { timeoutMs: 20000, stallMs: 5000 });
  const window = await bot.openVillager(villager);
  try {
    const data = villagerData(bot, villager);
    state.offers[idOf(villager)] = { at: Date.now(), profession: String(data?.profession ?? data?.villagerProfession ?? '').replace(/^minecraft:/, '') || undefined,
      trades: (window.trades || []).map(t => ({ inputItem1: { name: t.inputItem1?.name, count: t.inputItem1?.count }, realPrice: t.realPrice,
        hasItem2: t.hasItem2, inputItem2: t.inputItem2 && { name: t.inputItem2.name, count: t.inputItem2.count },
        outputItem: { name: t.outputItem?.name, count: t.outputItem?.count }, tradeDisabled: t.tradeDisabled,
        nbTradeUses: t.nbTradeUses, maximumNbTradeUses: t.maximumNbTradeUses })) };
  } finally { window.close(); }
  save();
  return state.offers[idOf(villager)];
}

// The feasible trades among the villagers read, wanted buys first.
function tradeOptions(bot, goal, villagers, opts = {}) {
  const out = [];
  for (const v of villagers) {
    const offers = goal.trading?.offers?.[idOf(v)];
    (offers?.trades || []).forEach((t, i) => { const d = describe(bot, v, t, i, opts); if (d.feasible) out.push({ ...d, entity: v, profession: offers.profession }); });
  }
  const emeralds = countOf(bot, 'emerald');
  // Saving for pearls: a pearl on offer that cannot yet be paid for keeps
  // the emeralds from going on anything else, and the sales go on. The
  // first drill spent its three emeralds on arrows in front of a cleric
  // selling pearls for five.
  const pearlOnOffer = villagers.some(v => (goal.trading?.offers?.[idOf(v)]?.trades || []).some(t => t.outputItem?.name === 'ender_pearl' && !t.tradeDisabled &&
    (t.maximumNbTradeUses == null || t.nbTradeUses < t.maximumNbTradeUses)));
  const saving = opts.pearlsShort !== false && pearlOnOffer && !out.some(o => o.kind === 'buy' && o.output.name === 'ender_pearl');
  return out.filter(o => o.kind === 'sell' ? (saving || emeralds < EMERALD_BANK) : (!saving || o.output.name === 'ender_pearl')).sort((a, b) => (a.kind === 'buy' ? 0 : 1) - (b.kind === 'buy' ? 0 : 1) ||
    (a.output.name === 'ender_pearl' ? -1 : 0) - (b.output.name === 'ender_pearl' ? -1 : 0));
}

async function makeTrade(bot, task, goal, save, option, { navigate }) {
  const v = option.entity, p = v.position.floored();
  if (v.position.distanceTo(bot.entity.position) > 3) await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2), { timeoutMs: 20000, stallMs: 5000 });
  const before = countOf(bot, option.output.name);
  const window = await bot.openVillager(v);
  try { await bot.trade(window, option.index, 1); }
  finally {
    try { if (bot._syncWindow) await bot._syncWindow(window); } catch (_) { /* best effort */ }
    window.close();
    try { if (bot._syncWindow) await bot._syncWindow(bot.inventory); } catch (_) { /* best effort */ }
  }
  await sleep(200);
  const got = countOf(bot, option.output.name) - before;
  const state = goal.trading ||= { offers: {}, trades: [] };
  state.trades.push({ at: new Date().toISOString(), kind: option.kind, gave: option.input, gave2: option.input2, got: { name: option.output.name, count: got }, profession: option.profession });
  state.trades = state.trades.slice(-50);
  delete state.offers[idOf(v)]; // prices and stock change with a trade
  save();
  const phrase = i => `${i.count} ${i.name.replaceAll('_', ' ')}`;
  bot.chat?.(got > 0 ? `Traded ${phrase(option.input)}${option.input2 ? ` and ${phrase(option.input2)}` : ''} for ${phrase({ name: option.output.name, count: got })}.` : 'The trade did not go through.');
  return got > 0;
}

// Whether a trade trip is worth offering: a village remembered within
// reach, and something to sell or emeralds to spend.
function tradeWorthwhile(bot, goal, reach = 256) {
  const { knownVillages } = require('./villages');
  if (!knownVillages(bot, goal, reach).length) return false;
  if (isSetAside(goal, 'trade_trip', 'village')) return false;
  return countOf(bot, 'emerald') > 0 || Object.keys(KEEP).some(name => spare(bot, name) >= 8);
}

// One trade: to the village if needed, the offers read, one chosen and made.
async function tradeStep(bot, task, goal, save, { navigate, decide, client, pearlsShort = true } = {}) {
  task.check(); checkAir(bot); checkThreats(bot);
  let villagers = villagersNear(bot);
  if (!villagers.length) {
    const { knownVillages } = require('./villages');
    const village = knownVillages(bot, goal, 256)[0]?.village;
    if (!village) return false;
    goal.step = { action: 'go_to_village', to: { x: village.x, z: village.z }, why: 'trading' }; save();
    try { await navigate(bot, task, new goals.GoalNearXZ(village.x, village.z, 8), { timeoutMs: 120000, stallMs: 10000, sprint: true }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    villagers = villagersNear(bot);
    if (!villagers.length) { setAside(goal, 'trade_trip', 'village', 'no villager found at the village', 1800000); save(); return false; }
  }
  for (const v of villagers.slice(0, 6)) {
    task.check();
    if (isSetAside(goal, 'trade_villager', idOf(v))) continue;
    goal.step = { action: 'read_trades', villager: idOf(v) }; save();
    try { await readOffers(bot, task, goal, save, v, { navigate }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'trade_villager', idOf(v), err, 600000); save(); }
  }
  const options = tradeOptions(bot, goal, villagers, { pearlsShort });
  if (!options.length) { setAside(goal, 'trade_trip', 'village', 'no trade worth making', 1200000); save(); return false; }
  const tree = {};
  for (const o of options.slice(0, 8)) {
    const key = `${o.kind}_${o.output.name}_${o.index}`;
    if (tree[key]) continue;
    tree[key] = { description: { action: o.kind === 'buy' ? `Buy ${o.output.count} ${o.output.name.replaceAll('_', ' ')} for ${o.input.count} ${o.input.name.replaceAll('_', ' ')}${o.input2 ? ` and ${o.input2.count} ${o.input2.name.replaceAll('_', ' ')}` : ''}`
      : `Sell ${o.input.count} ${o.input.name.replaceAll('_', ' ')} for ${o.output.count} emerald${o.output.count === 1 ? '' : 's'}`, why: o.why, villager: o.profession || 'villager' },
      run: () => makeTrade(bot, task, goal, save, o, { navigate }) };
  }
  let made = false;
  if (decide) {
    const decision = await decide('trade_choice', { client, bot, task, goal, save, tree,
      state: { situation: 'At a village with the offers read. Choose one trade, or none.', emeralds: countOf(bot, 'emerald'), pearls: countOf(bot, 'ender_pearl'),
        arrows: countOf(bot, 'arrow'), retainedRequest: goal.retainedRequest || goal.request || null } });
    if (decision.stale || !decision.action) return false;
    made = await decision.action.run();
  } else made = await Object.values(tree)[0].run();
  return made;
}

module.exports = { KEEP, EMERALD_BANK, wantOf, spare, describe, tradeOptions, tradeWorthwhile, tradeStep, villagersNear, readOffers, makeTrade };

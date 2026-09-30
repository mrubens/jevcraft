'use strict';
// What an option needs that is not there, said where the option is built
// (note 754). 25589 (mid-243-je, 12:09 to 12:19Z on 2026-09-30) stood walled
// in at y -30 in deepslate with no pickaxe and no wood, 79 iron ingots,
// 225 cobblestone and 129 coal carried. The stall's detours offered
// stone_tools "from cobblestone and sticks" and torches "from the 129 coal"
// with no stick and nothing to make one from, a walk to the river 91 blocks
// off and an unexplored area "5 seconds there and back"; each chosen ended at
// once in "No route from here (noPath)": the craft's first step was a walk to
// a tree it could not reach, and the walks could not leave the cell.
//
// The rule, for every offer built from the pockets and the ground:
//   - a craft's chain is read from the pockets (work.js catalogPlan): where
//     it begins with fetching something from the world other than what the
//     option is for (sticks need planks, planks need logs), the option says
//     so, with the fetch, and is not said as made from what is carried;
//   - walled in where it stands (every side closed at the feet or the head,
//     unstuck.js walledOf) with no pickaxe, no walk leaves the cell, and a
//     walk (or a craft that begins with one) is not offered: what digging out
//     costs by hand is said instead, where the question is asked; with a
//     pickaxe the walk is offered with the digging out said first.

const words = s => String(s || '').replaceAll('_', ' ');
const WALK_KEYS = /^(explore|travel_\w+|look_around|loot|trade|fetch_cache|take_home_bed|stock_wood)$/;
// Steps the pockets and a table or furnace do; the rest are the world's.
const POCKET_STEPS = new Set(['craft', 'smelt', 'creative_inventory']);

// Walled in where it stands, and whether a pickaxe is carried: null when a
// side is open. `says` is the digging out, by hand at the rock's own time.
function walledIn(bot) {
  if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return null;
  // Every cell round the feet and the head read: a cell not loaded is not
  // a wall.
  const feet = bot.entity.position.floored();
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const y of [0, 1]) if (!bot.blockAt(feet.offset(x, y, z))) return null;
  let u, view, w;
  try { u = require('./unstuck'); view = u.liveView(bot); w = u.walledOf(view, feet); } catch (_) { return null; }
  if (!w) return null;
  const pick = (bot.inventory?.items?.() || []).find(i => /_pickaxe$/.test(i.name));
  const kinds = [...new Set(w.round.map(c => view.name(c)).filter(Boolean))];
  const hd = require('./hand-dig');
  const rock = kinds.find(n => hd.handRule(bot, n).breaks) || hd.rockAt(bot);
  const says = pick
    ? `walled in where it stands (${kinds.map(words).join(', ')} on every side): a walk from here digs its way out first with the ${words(pick.name)}`
    : `walled in where it stands (${kinds.map(words).join(', ')} on every side) with no pickaxe: no walk leaves the cell until a way is dug, ${hd.handPaceSays(bot, { rock })}`;
  return { pickaxe: pick?.name || null, kinds, says };
}

// The world steps a craft's chain begins with, read from the pockets as
// they are: [{ action, what, count }], empty where the pockets make it.
function worldSteps(bot, item, count, goal = {}) {
  let plan;
  try {
    const w = require('./work');
    plan = w.catalogPlan(bot, item, count, w.planningInventory(bot), goal) || [];
  } catch (_) { return []; }
  return plan.filter(st => !POCKET_STEPS.has(st.action))
    .map(st => ({ action: st.action, what: st.drops || st.item || st.block || st.resource || null, count: st.count || 1 }))
    .filter(st => st.what && st.what !== item);
}

// A craft's chain said: "no sticks can be made from the pockets (0 logs,
// 0 planks, 0 sticks): sticks need planks and planks need logs, and this
// begins by fetching 1 oak log".
function chainSays(bot, item, steps, goal = {}) {
  const fetch = steps.map(st => `${st.action === 'mine' ? 'mining' : words(st.action)} ${st.count} ${words(st.what)}`).join(', then ');
  const items = bot.inventory?.items?.() || [];
  const sum = re => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
  const wood = steps.some(st => /_log$|_stem$|_planks$|^stick$/.test(st.what));
  const lacks = wood ? `no sticks can be made from the pockets (${sum(/_log$|_stem$/)} logs, ${sum(/_planks$/)} planks, ${sum(/^stick$/)} sticks): sticks need planks and planks need logs, so ` : '';
  let near = null;
  if (wood) { try { near = require('./pickaxe-budget').nearestWood(bot, goal); } catch (_) { near = null; } }
  return `Not from the pockets as they are: ${lacks}this begins by ${fetch}${wood ? `: ${near ? near.says : 'no wood is known near here'}` : ''}.`;
}

// The offers screened: each craft said with what its chain lacks, each walk
// offered only where the bot can leave the cell, said with the digging out.
// `withheld` lists what was left out and why, for the question's situation.
function screenOffers(bot, goal, options, { withheld: before = null } = {}) {
  const withheld = (before?.keys || []).map(key => ({ key }));
  let walled;
  const walledNow = () => (walled === undefined ? (walled = walledIn(bot)) : walled);
  for (const [key, option] of Object.entries(options || {})) {
    if (!option || option.screened) continue;
    option.screened = true;
    // A craft (an item fetched through the planner, no run of its own).
    let steps = [];
    if (option.item && !option.run && key !== 'long_game') steps = worldSteps(bot, option.item, option.count || 1, goal);
    const walks = WALK_KEYS.test(key) || Number.isFinite(option.walkBlocks) || steps.length > 0;
    if (walks && walledNow() && !walledNow().pickaxe) {
      withheld.push({ key });
      delete options[key];
      continue;
    }
    if (steps.length) option.description = `${String(option.description || '').replace(/\s+$/, '')} ${chainSays(bot, option.item, steps, goal)}`;
    if (walks && walledNow()?.pickaxe) option.description = `${String(option.description || '').replace(/\s+$/, '')} It is ${walledNow().says}.`;
  }
  if (withheld.length) Object.defineProperty(options, 'withheld', { value: { keys: withheld.map(w => w.key), says: withheldSays(walledNow(), withheld) }, enumerable: false, configurable: true });
  return options;
}

function withheldSays(walled, withheld) {
  if (!withheld.length) return null;
  return `Not offered from here: ${withheld.map(w => words(w.key)).join(', ')}; the bot is ${walled?.says || 'walled in where it stands'}.`;
}

module.exports = { walledIn, worldSteps, chainSays, screenOffers, withheldSays, WALK_KEYS };

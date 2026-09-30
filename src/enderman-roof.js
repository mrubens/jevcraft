'use strict';
// The classic enderman roof. An enderman is 2.9 blocks tall and its own
// attack needs it to path into the target's cell; a cell under three
// blocks of headroom is not one it can path into, so a lid one block above
// the bot's own head (or a two-high gap already there) keeps every
// enderman that walks up to it from ever landing a hit, while the bot's
// own sword still reaches out and strikes its legs where it stands.
// combat-estimate.js's MOBS.enderman `note` already carries this fact to
// Jev's stance and hunt-approach questions (note 718); this is the tactic
// itself, cheap and no walls, offered beside the full pocket `seal`
// already builds (note 713's own "not fixed", and 718's "the next real
// option to add"): one block and a few seconds, not eight to thirty for a
// shell on every side, and the bot goes on fighting under it instead of
// waiting blind.
const shelter = require('./shelter');

// A cell within `radius` of `feet` that is already under a solid ceiling
// two blocks up, with its own feet and head cells open: a gap the bot
// could stand in and fight from without placing anything. Nearest first.
function existingGap(bot, feet, radius = 3) {
  const cells = [];
  for (let dx = -radius; dx <= radius; dx++)
    for (let dz = -radius; dz <= radius; dz++)
      cells.push(feet.offset(dx, 0, dz));
  cells.sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet));
  for (const c of cells) {
    const floor = bot.blockAt(c.offset(0, -1, 0));
    if (!floor || floor.boundingBox !== 'block') continue;
    if (!shelter.replaceable(bot.blockAt(c)) || !shelter.replaceable(bot.blockAt(c.offset(0, 1, 0)))) continue;
    const cap = bot.blockAt(c.offset(0, 2, 0));
    if (!cap || cap.boundingBox !== 'block') continue;
    return c;
  }
  return null;
}

// Whether a lid can go up right where the bot stands: the cell two above
// its feet (one above its head) must be open to place against, and the
// bot must be carrying a block.
function canCapHere(bot, feet) {
  const cap = bot.blockAt(feet.offset(0, 2, 0));
  return !!cap && shelter.replaceable(cap) && shelter.materialStock(bot) >= 1;
}

// The plan Jev is priced against: a gap already there within a couple of
// steps (no blocks, a few seconds' walk), a lid placed overhead where the
// bot stands (one block, about a second), or neither (no material, no gap,
// nowhere to place against).
function roofPlan(bot) {
  const { feetCell } = require('./terrain');
  const feet = feetCell(bot);
  const already = bot.blockAt(feet.offset(0, 2, 0));
  if (already && already.boundingBox === 'block') return { kind: 'here', cell: feet, blocks: 0, seconds: 0 };
  const gap = existingGap(bot, feet);
  if (gap) return { kind: 'gap', cell: gap, blocks: 0, seconds: Math.max(1, Math.round(gap.distanceTo(feet) / 4)) };
  if (canCapHere(bot, feet)) return { kind: 'place', cell: feet, blocks: 1, seconds: 2 };
  return null;
}

// Take the plan: stand pat if already capped, walk the short step into an
// existing gap, or place the one block overhead. Returns true once the bot
// is under cover, ready for the fight stance to take over the swinging.
async function takeRoof(bot, task, actions, plan) {
  if (!plan) return false;
  const { feetCell } = require('./terrain');
  if (plan.kind === 'here') return true;
  if (plan.kind === 'gap') {
    if (feetCell(bot).equals(plan.cell)) return true;
    const { goals } = require('mineflayer-pathfinder');
    try { await actions.navigate(bot, task, new goals.GoalBlock(plan.cell.x, plan.cell.y, plan.cell.z), { timeoutMs: 4000, stallMs: 1500 }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return false; }
    return feetCell(bot).equals(plan.cell);
  }
  if (plan.kind === 'place') {
    const material = shelter.buildingItem(bot)?.name;
    if (!material) return false;
    try { await actions.place(bot, task, plan.cell.offset(0, 2, 0), material, { stay: true }); return true; }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return false; }
  }
  return false;
}

module.exports = { existingGap, canCapHere, roofPlan, takeRoof };

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

// A block goes in against a face (the game's rule): the lid two up needs a
// solid block beside it at its own level. Over open ground there is none,
// and the lid never went in: 'the lid at (-370, 69, -59) was not placed:
// Cannot place cobblestone at (-370, 69, -59): no adjacent solid anchor'
// (full-192, 25588, 2026-10-30 13:52Z, slain by the enderman eight seconds
// on), and 259 of the day's stance asks carried the same failure in what was
// not offered (note 2588). Where nothing is beside it, a post goes up first:
// three blocks in the cell beside the bot, floor to the lid's level, and the
// lid against the post's top. Four blocks, not one, and priced so.
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const lidAnchored = (bot, lid) => SIDES.some(([dx, dz]) => bot.blockAt(lid.offset(dx, 0, dz))?.boundingBox === 'block');
// Something standing in the cells: a block does not go in on a body.
const bodyIn = (bot, cells) => Object.values(bot.entities || {}).some(e => e && e !== bot.entity && e.position && cells.some(c =>
  Math.abs(e.position.x - (c.x + 0.5)) < 0.8 && Math.abs(e.position.z - (c.z + 0.5)) < 0.8 && e.position.y < c.y + 1 && e.position.y + (e.height || 1.8) > c.y));
function postFor(bot, feet) {
  for (const [dx, dz] of SIDES) {
    const base = feet.offset(dx, 0, dz);
    if (bot.blockAt(base.offset(0, -1, 0))?.boundingBox !== 'block') continue;
    const cells = [0, 1, 2].map(dy => base.offset(0, dy, 0));
    if (!cells.every(c => shelter.replaceable(bot.blockAt(c)))) continue;
    if (bodyIn(bot, cells)) continue;
    return cells;
  }
  return null;
}
// Whether a lid can go up right where the bot stands, and what it takes: the
// cell two above its feet (one above its head) open, a face beside it or a
// post that gives one, and the blocks for it carried.
function canCapHere(bot, feet) {
  const lid = feet.offset(0, 2, 0), cap = bot.blockAt(lid);
  if (!cap || !shelter.replaceable(cap)) return null;
  if (lidAnchored(bot, lid)) return shelter.materialStock(bot) >= 1 ? { post: [], blocks: 1 } : null;
  const post = postFor(bot, feet);
  return post && shelter.materialStock(bot) >= 4 ? { post, blocks: 4 } : null;
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
  const cap = canCapHere(bot, feet);
  if (cap) return { kind: 'place', cell: feet, blocks: cap.blocks, post: cap.post, seconds: cap.blocks === 1 ? 2 : 4 };
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
    // Why it was not taken, left on the plan for the next question (note 1952).
    try { await actions.navigate(bot, task, new goals.GoalBlock(plan.cell.x, plan.cell.y, plan.cell.z), { timeoutMs: 4000, stallMs: 1500 }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; plan.why = `the walk to the gap at (${plan.cell.x}, ${plan.cell.y}, ${plan.cell.z}) failed: ${String(err.message || err).slice(0, 120)}`; }
    if (feetCell(bot).equals(plan.cell)) return true;
    plan.why ||= `the walk ended short of the gap at (${plan.cell.x}, ${plan.cell.y}, ${plan.cell.z})`;
    // The gap not reached, the lid goes up where the bot stands instead, where one can (note 2610): the walk the
    // pathfinder refused 'along a drop' or timed out left the bot in the open with the endermen on it. full-226 (25592,
    // 2026-10-30 23:02:56Z), at y 81 in the Nether with two endermen about, took cap_fight at 0.88 for a gap 3 blocks
    // off, the walk ended 'No route from here ... the way passes along a drop', and the fight that followed in the open
    // took 16.2 of 20 health in 2.6 seconds; of the day's 580 cap fights, 8 ended at the gap's walk.
    const feet = feetCell(bot), cap = canCapHere(bot, feet);
    if (!cap) return false;
    const whyWalk = plan.why;
    const placed = await placeLid(bot, task, actions, { ...plan, kind: 'place', cell: feet, post: cap.post, blocks: cap.blocks });
    plan.why = `${whyWalk}; ${placed.ok ? `the lid went up where the bot stood instead, at (${feet.x}, ${feet.y + 2}, ${feet.z})` : placed.why}`;
    return placed.ok;
  }
  if (plan.kind === 'place') {
    const placed = await placeLid(bot, task, actions, plan);
    if (!placed.ok) plan.why = placed.why;
    return placed.ok;
  }
  plan.why = 'no way to a lid from here';
  return false;
}
// The post first where the lid has no face of its own (note 2588), then the lid two over the cell. -> { ok, why }
async function placeLid(bot, task, actions, plan) {
  const { feetCell } = require('./terrain');
  const material = shelter.buildingItem(bot)?.name;
  if (!material) return { ok: false, why: 'no block carried for the lid' };
  const lid = plan.cell.offset(0, 2, 0);
  // Placed by this stance's run before: the stance is held run after run.
  if (feetCell(bot).equals(plan.cell) && bot.blockAt(lid)?.boundingBox === 'block') return { ok: true };
  for (const c of plan.post || []) {
    if (bot.blockAt(c)?.boundingBox === 'block') continue;
    try { await actions.place(bot, task, c, material, { stay: true }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return { ok: false, why: `the post's block at (${c.x}, ${c.y}, ${c.z}) for the lid was not placed: ${String(err.message || err).slice(0, 80)}` }; }
  }
  try { await actions.place(bot, task, lid, material, { stay: true }); return { ok: true }; }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return { ok: false, why: `the lid at (${lid.x}, ${lid.y}, ${lid.z}) was not placed: ${String(err.message || err).slice(0, 80)}` }; }
}

module.exports = { existingGap, canCapHere, roofPlan, takeRoof };

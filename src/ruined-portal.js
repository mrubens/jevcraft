'use strict';
// A ruined portal is a way into the Nether that needs no diamonds: its
// frame is mostly standing, its chest often holds obsidian, flint and steel
// or a fire charge, and what is missing is placed like any block. The bot
// used ruins only as obsidian to mine with a diamond pickaxe and chests to
// loot; the user asked that Jev have the game's other ways as choices
// (2026-09-26).
//
// A frame is the portal's minimal ten blocks, no corners, four wide and five
// high, along x or along z. `u` runs along the frame, `y` up.
const { Vec3 } = require('vec3');

const AXES = { x: new Vec3(1, 0, 0), z: new Vec3(0, 0, 1) };
const FRAME_UY = [[1, 0], [2, 0], [1, 4], [2, 4], [0, 1], [0, 2], [0, 3], [3, 1], [3, 2], [3, 3]];
const INTERIOR_UY = [[1, 1], [2, 1], [1, 2], [2, 2], [1, 3], [2, 3]];
const CORNERS_UY = [[0, 0], [3, 0], [0, 4], [3, 4]];

const at = (origin, axis, u, y) => new Vec3(origin.x, origin.y, origin.z).plus(AXES[axis].scaled(u)).offset(0, y, 0);
function frameCells(origin, axis = 'x') {
  return {
    blocks: FRAME_UY.map(([u, y]) => at(origin, axis, u, y)),
    interior: INTERIOR_UY.map(([u, y]) => at(origin, axis, u, y)),
    corners: CORNERS_UY.map(([u, y]) => at(origin, axis, u, y)),
  };
}
// Beside the frame, across it: where to stand to place its blocks.
const across = axis => (axis === 'x' ? new Vec3(0, 0, 1) : new Vec3(1, 0, 0));

const OPEN = /^(air|cave_air|void_air|short_grass|tall_grass|fern|large_fern|dead_bush|vine|snow|fire|soul_fire|.*_flower|dandelion|poppy|leaf_litter)$/;
// Blocks only a diamond pickaxe takes out.
const DIAMOND_ONLY = /^(obsidian|crying_obsidian|respawn_anchor|ancient_debris|netherite_block)$/;
const UNBREAKABLE = /^(bedrock|barrier|end_portal_frame|reinforced_deepslate)$/;

// The best frame through the obsidian near a ruin: every placement of the
// ten cells that puts one of the ruin's obsidian blocks in a frame slot, on
// either axis, scored by the obsidian already standing. What each fit still
// needs is counted: slots to fill, blocks to dig out of slots and the
// inside, and whether any of that needs a diamond pickaxe.
function fitRuin(bot, centre, { radius = 10, diamondPickaxe = false } = {}) {
  const id = bot.registry.blocksByName.obsidian?.id;
  if (id === undefined) return null;
  const seeds = bot.findBlocks({ matching: id, maxDistance: radius, count: 64, point: new Vec3(centre.x, centre.y, centre.z) });
  const tried = new Set();
  let best = null;
  for (const seed of seeds) for (const axis of Object.keys(AXES)) for (const [u, y] of FRAME_UY) {
    const origin = seed.minus(AXES[axis].scaled(u)).offset(0, -y, 0);
    const key = `${axis}:${origin}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const fit = judge(bot, origin, axis, { diamondPickaxe });
    if (!fit || fit.blocked || fit.have < 3) continue;
    if (!best || fit.have > best.have || (fit.have === best.have && fit.digs.length < best.digs.length)) best = fit;
  }
  return best;
}

function judge(bot, origin, axis, { diamondPickaxe }) {
  const cells = frameCells(origin, axis);
  const name = p => bot.blockAt(p)?.name;
  if ([...cells.blocks, ...cells.interior].some(p => name(p) == null)) return null;
  let have = 0, needsDiamond = false, blocked = false;
  const fill = [], digs = [];
  for (const p of cells.blocks) {
    const n = name(p);
    if (n === 'obsidian') { have++; continue; }
    fill.push(p);
    if (OPEN.test(n)) continue;
    if (UNBREAKABLE.test(n) || /lava|water/.test(n)) { blocked = true; continue; }
    if (DIAMOND_ONLY.test(n)) needsDiamond = true;
    digs.push(p);
  }
  for (const p of cells.interior) {
    const n = name(p);
    if (OPEN.test(n)) continue;
    if (UNBREAKABLE.test(n) || /lava/.test(n)) { blocked = true; continue; }
    if (DIAMOND_ONLY.test(n)) needsDiamond = true;
    digs.push(p);
  }
  // The frame's bottom stands on something: the portal needs no floor, but
  // the placing does.
  if (blocked || (needsDiamond && !diamondPickaxe)) return { origin, axis, have, fill, digs, needsDiamond, blocked: true };
  return { origin, axis, have, fill, digs, needsDiamond, blocked: false };
}

// Adopt a fit as the frame the portal step builds and lights.
function adopt(fit) {
  const cells = frameCells(fit.origin, fit.axis);
  return { origin: { x: fit.origin.x, y: fit.origin.y, z: fit.origin.z }, axis: fit.axis, ruin: true,
    blocks: cells.blocks.sort((a, b) => a.y - b.y).map(p => ({ x: p.x, y: p.y, z: p.z })),
    interior: cells.interior.map(p => ({ x: p.x, y: p.y, z: p.z })) };
}

module.exports = { AXES, frameCells, across, fitRuin, judge, adopt, DIAMOND_ONLY };

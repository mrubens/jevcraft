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
// A frame of any size the game lights (note 2308): `size` is the inside, w wide (2 to 21) and h high (3 to 21); the
// minimal frame, 2 by 3 inside, is the default. A giant ruined portal stands larger than the minimal frame, and only
// the minimal one was fitted through it: full-10's ruin (2026-10-27) had 18 obsidian standing and was said to need a
// diamond pickaxe; the user watching: 'It looks like a very large frame ... Seems like some of it could be reused'.
function uyCells({ w = 2, h = 3 } = {}) {
  const blocks = [], interior = [];
  for (let u = 1; u <= w; u++) blocks.push([u, 0], [u, h + 1]);
  for (let y = 1; y <= h; y++) blocks.push([0, y], [w + 1, y]);
  for (let u = 1; u <= w; u++) for (let y = 1; y <= h; y++) interior.push([u, y]);
  return { blocks, interior, corners: [[0, 0], [w + 1, 0], [0, h + 1], [w + 1, h + 1]] };
}
function frameCells(origin, axis = 'x', size = null) {
  const uy = size ? uyCells(size) : { blocks: FRAME_UY, interior: INTERIOR_UY, corners: CORNERS_UY };
  return {
    blocks: uy.blocks.map(([u, y]) => at(origin, axis, u, y)),
    interior: uy.interior.map(([u, y]) => at(origin, axis, u, y)),
    corners: uy.corners.map(([u, y]) => at(origin, axis, u, y)),
  };
}
// Beside the frame, across it: where to stand to place its blocks.
const across = axis => (axis === 'x' ? new Vec3(0, 0, 1) : new Vec3(1, 0, 0));

const OPEN = /^(air|cave_air|void_air|short_grass|tall_grass|fern|large_fern|dead_bush|vine|snow|fire|soul_fire|.*_flower|dandelion|poppy|leaf_litter)$/;
// Blocks only a diamond pickaxe takes out.
const DIAMOND_ONLY = /^(obsidian|crying_obsidian|respawn_anchor|ancient_debris|netherite_block)$/;
const UNBREAKABLE = /^(bedrock|barrier|end_portal_frame|reinforced_deepslate)$/;

// The best frame through the obsidian near a ruin: every placement of a frame, the minimal one and larger ones up to
// the ruin's own span (note 2308), that puts one of the ruin's obsidian blocks in a frame slot, on either axis. Scored
// first by the obsidian it stands on, counted from the blocks found (no block read per cell), then the best few
// judged: the fewest slots to fill, then the fewest blocks to dig. What each fit still needs is counted: slots to
// fill, blocks to dig out of slots and the inside, and whether any of that needs a diamond pickaxe.
const MAX_INSIDE = { w: 8, h: 9 };
function fitRuin(bot, centre, { radius = 10, diamondPickaxe = false } = {}) {
  const id = bot.registry.blocksByName.obsidian?.id;
  if (id === undefined) return null;
  const seeds = bot.findBlocks({ matching: id, maxDistance: radius, count: 64, point: new Vec3(centre.x, centre.y, centre.z) });
  if (!seeds.length) return null;
  const standing = new Set(seeds.map(p => `${p.x},${p.y},${p.z}`));
  const span = k => Math.max(...seeds.map(p => p[k])) - Math.min(...seeds.map(p => p[k]));
  const maxW = Math.min(MAX_INSIDE.w, Math.max(2, Math.max(span('x'), span('z')) - 1)), maxH = Math.min(MAX_INSIDE.h, Math.max(3, span('y') - 1));
  const sizes = [];
  for (let w = 2; w <= maxW; w++) for (let h = 3; h <= maxH; h++) sizes.push({ w, h, uy: uyCells({ w, h }) });
  const tried = new Set(), scored = [];
  for (const seed of seeds) for (const axis of Object.keys(AXES)) for (const size of sizes) for (const [u, y] of size.uy.blocks) {
    const origin = seed.minus(AXES[axis].scaled(u)).offset(0, -y, 0);
    const key = `${axis}:${origin}:${size.w}x${size.h}`;
    if (tried.has(key)) continue;
    tried.add(key);
    let have = 0;
    for (const [uu, yy] of size.uy.blocks) { const q = at(origin, axis, uu, yy); if (standing.has(`${q.x},${q.y},${q.z}`)) have++; }
    if (have < 3) continue;
    scored.push({ origin, axis, size, have, fill: size.uy.blocks.length - have });
  }
  scored.sort((a, b) => a.fill - b.fill || b.have - a.have || a.size.w * a.size.h - b.size.w * b.size.h);
  let best = null;
  for (const c of scored.slice(0, 24)) {
    const fit = judge(bot, c.origin, c.axis, { diamondPickaxe, size: c.size.w === 2 && c.size.h === 3 ? null : { w: c.size.w, h: c.size.h } });
    if (!fit || fit.blocked || fit.have < 3) continue;
    if (!best || fit.fill.length < best.fill.length || (fit.fill.length === best.fill.length && fit.digs.length < best.digs.length)) best = fit;
  }
  return best;
}

function judge(bot, origin, axis, { diamondPickaxe, size = null }) {
  const cells = frameCells(origin, axis, size);
  const name = p => bot.blockAt(p)?.name;
  if ([...cells.blocks, ...cells.interior].some(p => name(p) == null)) return null;
  let have = 0, needsDiamond = false, blocked = false;
  const fill = [], digs = [], diamondDigs = [];
  for (const p of cells.blocks) {
    const n = name(p);
    if (n === 'obsidian') { have++; continue; }
    fill.push(p);
    if (OPEN.test(n)) continue;
    if (UNBREAKABLE.test(n) || /lava|water/.test(n)) { blocked = true; continue; }
    if (DIAMOND_ONLY.test(n)) { needsDiamond = true; diamondDigs.push(n); }
    digs.push(p);
  }
  for (const p of cells.interior) {
    const n = name(p);
    if (OPEN.test(n)) continue;
    if (UNBREAKABLE.test(n) || /lava/.test(n)) { blocked = true; continue; }
    if (DIAMOND_ONLY.test(n)) { needsDiamond = true; diamondDigs.push(n); }
    digs.push(p);
  }
  // The frame's bottom stands on something: the portal needs no floor, but
  // the placing does.
  const fit = { origin, axis, size: size || { w: 2, h: 3 }, slots: cells.blocks.length, have, fill, digs, diamondDigs, needsDiamond };
  return { ...fit, blocked: blocked || (needsDiamond && !diamondPickaxe) };
}

// What a fit needs, said (note 2308): the frame's size, what stands, the slots to fill and what is in the way,
// with what only a diamond pickaxe takes out named.
function fitSays(fit, { obsidian = 0 } = {}) {
  if (!fit) return null;
  const { w, h } = fit.size, short = Math.max(0, fit.fill.length - obsidian);
  const kinds = {}; for (const n of fit.diamondDigs || []) kinds[n] = (kinds[n] || 0) + 1;
  const diamond = Object.entries(kinds).map(([n, c]) => `${c} ${n.replaceAll('_', ' ')}`).join(' and ');
  return `the best frame through its standing obsidian is ${w} by ${h} inside, ${fit.slots} blocks, ${fit.have} of them standing: ${fit.fill.length} to fill, obsidian placed like any block (${obsidian} carried${short ? `, ${short} short` : ', enough'})${fit.digs.length ? `; ${fit.digs.length} block${fit.digs.length === 1 ? '' : 's'} to dig out of its slots and inside${diamond ? `, ${diamond} of them, taken out only with a diamond pickaxe` : ''}` : ''}`;
}

// Adopt a fit as the frame the portal step builds and lights.
function adopt(fit) {
  const big = fit.size && !(fit.size.w === 2 && fit.size.h === 3) ? { w: fit.size.w, h: fit.size.h } : null;
  const cells = frameCells(fit.origin, fit.axis, big);
  return { origin: { x: fit.origin.x, y: fit.origin.y, z: fit.origin.z }, axis: fit.axis, ruin: true, ...(big ? { size: big } : {}),
    blocks: cells.blocks.sort((a, b) => a.y - b.y).map(p => ({ x: p.x, y: p.y, z: p.z })),
    interior: cells.interior.map(p => ({ x: p.x, y: p.y, z: p.z })) };
}

module.exports = { AXES, frameCells, across, fitRuin, judge, adopt, fitSays, DIAMOND_ONLY };

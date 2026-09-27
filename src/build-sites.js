'use strict';
const { Vec3 } = require('vec3');
const air = block => block && ['air', 'cave_air', 'void_air'].includes(block.name);

function reservedForConstruction(goal, p, { from = null } = {}) {
  // A dug-in pocket is one night's stop, not construction: reserving its
  // cells froze the tunnel at the pocket against a fortress wall, thirty-eight
  // rounds of "no route away from the blocked staircase".
  // Nor is a saved shelter a wall around the bot standing in it: mid-87-a
  // sealed itself into one forty blocks down, every step out of it was "a
  // building in the way", and the way up was refused forty times in two
  // minutes (2026-09-25). Its shell is dug through to leave, and put back
  // if the shelter is used again. A house is left alone either way.
  const inside = s => from && s.kind !== 'house' && Math.abs(from.x - s.origin.x) <= 1 && Math.abs(from.z - s.origin.z) <= 1 && Math.abs(from.y - s.origin.y) <= 1;
  if (goal.survival?.shelters?.some(s => !s.emergency && !inside(s) && Math.abs(p.x - s.origin.x) <= 2 && Math.abs(p.z - s.origin.z) <= 2 && p.y >= s.origin.y - 2 && p.y <= s.origin.y + 2)) return true;
  const bounds = goal.blueprint?.bounds;
  if (bounds && p.x >= bounds.min.x - 2 && p.x <= bounds.max.x + 2 && p.z >= bounds.min.z - 2 && p.z <= bounds.max.z + 2 && p.y >= bounds.min.y - 1) return true;
  const house = goal.blueprint?.origin;
  if (house && Math.abs(p.x - house.x) <= 3 && Math.abs(p.z - house.z) <= 4 && p.y >= house.y - 4) return true;
  // The home base: its plot, pen and bed footprint, and three blocks under
  // it, so no staircase undermines the plot. Trial 19's mine went down from
  // the base through the plot, and the plot's repair and tilling flipped
  // from the tunnel below it until the audit called the loop (2026-09-24).
  // The base's own work digs there by hand, not by this rule.
  const home = goal.survival?.home;
  if (home?.origin && home.direction) {
    const o = home.origin, d = home.direction, a = { x: -d.z, z: d.x };
    const corners = [[-1, -3], [-1, 3], [8, -3], [8, 3]].map(([u, v]) => ({ x: o.x + d.x * u + a.x * v, z: o.z + d.z * u + a.z * v }));
    const xs = corners.map(c => c.x), zs = corners.map(c => c.z);
    if (p.x >= Math.min(...xs) && p.x <= Math.max(...xs) && p.z >= Math.min(...zs) && p.z <= Math.max(...zs) && p.y >= o.y - 3 && p.y <= o.y + 4) return true;
  }
  // The frame and a block about it, along whichever axis it runs.
  const portal = goal.portalFrame?.origin;
  if (!portal) return false;
  const [along, acrossAxis] = goal.portalFrame.axis === 'z' ? ['z', 'x'] : ['x', 'z'];
  return p[along] >= portal[along] - 1 && p[along] <= portal[along] + 4 &&
    Math.abs(p[acrossAxis] - portal[acrossAxis]) <= 2 && p.y >= portal.y - 4;
}

function portalSiteClear(bot, origin) {
  const o = new Vec3(origin.x, origin.y, origin.z);
  // Check the entire frame and both walking approaches at one ground level.
  for (let x = 0; x < 4; x++) for (let z = -1; z <= 1; z++) {
    if (bot.blockAt(o.offset(x, -1, z))?.boundingBox !== 'block') return false;
    for (let y = 0; y < (z === 0 ? 5 : 2); y++) if (!air(bot.blockAt(o.offset(x, y, z)))) return false;
  }
  return true;
}

function selectPortalSite(bot, { avoid = [] } = {}) {
  const feet = bot.entity.position.floored();
  // A portal can stand on deepslate beside the lava lake the obsidian came
  // from; climbing sixty blocks to find grass is a wasted hour.
  const ids = ['grass_block', 'dirt', 'stone', 'sand', 'deepslate', 'tuff', 'cobbled_deepslate', 'cobblestone', 'andesite', 'diorite', 'granite', 'netherrack']
    .map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  const surfaces = bot.findBlocks({ matching: ids, maxDistance: 24, count: 128,
    useExtraInfo: b => air(bot.blockAt(b.position.offset(0, 1, 0))) && air(bot.blockAt(b.position.offset(0, 2, 0))),
  }).map(p => p.offset(0, 1, 0)).sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet));
  // Not within six of a site left for failing (work.js buildPortalFrame).
  return surfaces.find(p => portalSiteClear(bot, p) && !avoid.some(q => q.distanceTo(p) < 6)) || null;
}

// Temporary portal anchors can use ordinary non-burning full blocks already
// collected underground. Obsidian stays reserved for the actual frame.
const portalSupportBlocks = new Set(['dirt', 'cobblestone', 'cobbled_deepslate', 'stone', 'deepslate',
  'andesite', 'diorite', 'granite', 'tuff', 'sandstone', 'red_sandstone', 'netherrack', 'end_stone']);
function portalSupports(bot) {
  const counts = {};
  for (const item of bot.inventory.items()) if (portalSupportBlocks.has(item.name)) counts[item.name] = (counts[item.name] || 0) + item.count;
  const materials = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return { count: materials.reduce((sum, [, count]) => sum + count, 0), material: materials[0]?.[0] };
}

module.exports = { reservedForConstruction, portalSiteClear, selectPortalSite, portalSupports };

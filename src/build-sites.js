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
  // Not the doorway, the cells in front of and behind the opening: those are
  // the way in. mid-242-m's portal was boxed in by its own cast walls there,
  // every stair toward it "a building in the way", and the walk back to it
  // failed until the loop watch ended the trial (2026-09-27).
  const doorway = p[along] >= portal[along] + 1 && p[along] <= portal[along] + 2 && Math.abs(p[acrossAxis] - portal[acrossAxis]) >= 1 &&
    Math.abs(p[acrossAxis] - portal[acrossAxis]) <= 2 && p.y >= portal.y + 1 && p.y <= portal.y + 3;
  if (doorway) return false;
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

// For a frame cast in place, where it stands is paid for once a bucket:
// every block still owed is a trip from the site to the lava and back, so
// the sites are ranked by the walk to them plus those trips (portal-cast.js
// lavaTrip), not by nearness to the bot alone. 25589 (mid-243-jg,
// 2026-09-30 12:53-13:06Z) climbed from beside its lava for a site, found
// one 43 blocks off and 18 up, and made each of its ten buckets a round
// trip of about two and a half minutes (note 753b). `cast`: { lava, trips }.
// A bucket's round trip from a site to the lava, in seconds: the walk there
// and back at four blocks a second, and three seconds a block of height
// where it rises or falls more than eight (a staircase each trip).
function bucketTrip(site, lava) {
  const distance = Math.hypot(lava.x - site.x, lava.y - site.y, lava.z - site.z), rise = Math.abs(site.y - lava.y);
  return { distance: Math.round(distance), rise: Math.round(rise), below: Math.round(site.y - lava.y), seconds: Math.round(distance * 2 / 4.3 + (rise > 8 ? rise * 3 : 0)) };
}
function siteCost(feet, p, cast) {
  const walk = p.distanceTo(feet) / 4.3;
  if (!cast?.lava) return walk;
  return walk + bucketTrip(p, cast.lava).seconds * Math.max(1, cast.trips || 1);
}
function selectPortalSite(bot, { avoid = [], cast = null } = {}) {
  const feet = bot.entity.position.floored();
  // A portal can stand on deepslate beside the lava lake the obsidian came
  // from; climbing sixty blocks to find grass is a wasted hour.
  const ids = ['grass_block', 'dirt', 'stone', 'sand', 'deepslate', 'tuff', 'cobbled_deepslate', 'cobblestone', 'andesite', 'diorite', 'granite', 'netherrack']
    .map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  const surfaces = bot.findBlocks({ matching: ids, maxDistance: 24, count: 128,
    useExtraInfo: b => air(bot.blockAt(b.position.offset(0, 1, 0))) && air(bot.blockAt(b.position.offset(0, 2, 0))),
  }).map(p => p.offset(0, 1, 0)).sort((a, b) => siteCost(feet, a, cast) - siteCost(feet, b, cast));
  // Not within six of a site left for failing (work.js buildPortalFrame).
  return surfaces.find(p => portalSiteClear(bot, p) && !avoid.some(q => q.distanceTo(p) < 6)) || null;
}

// A site for the frame dug out of the rock where none stands open: the
// frame's cells and its two approaches (as portalSiteClear reads them), each
// natural ground a pickaxe digs, nothing liquid beside any, nothing that
// falls over one, the floor under all of it solid, and the bot's feet in
// it so every cell is in reach. Underground beside the lava Jev chose to
// cast at, "no site level and dry down here" was a climb to open sky:
// mid-220-h went up six stairs, walked back down to the lava, and up again,
// thirteen minutes, for a site a minute of digging makes (note 531).
const SITE_ROCK = /^(stone|deepslate|tuff|andesite|diorite|granite|calcite|dirt|coarse_dirt|rooted_dirt|grass_block|cobblestone|cobbled_deepslate|mossy_cobblestone|netherrack|blackstone|basalt|smooth_basalt|dripstone_block|clay|terracotta|\w+_terracotta|(deepslate_)?\w+_ore)$/;
const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/;
const FALLS = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|pointed_dripstone)$|_concrete_powder$/;
function portalSiteCells(o) {
  const cells = [];
  for (let x = 0; x < 4; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y < (z === 0 ? 5 : 2); y++) cells.push(o.offset(x, y, z));
  return cells;
}
// Not only the cells about the feet (`radius`): a flat floor cut within a
// few blocks, at the feet's level or a block either way, each priced by its
// digging, the walk to it and, for a cast, its bucket trips (siteCost). With
// the feet's own site the only one looked at, 25598 (mid-241-bc,
// 2026-09-30 13:24:25Z), gone down to y 50 to cast beside its lava, was
// offered only the climb, 78 blocks above that lava, and took it (note 753b).
function portalSiteDig(bot, { avoid = [], radius = 0, cast = null } = {}) {
  const feet = bot.entity.position.floored();
  let best = null;
  const origins = [];
  // Its floor the bot's own: a site whose floor is under the feet digs
  // out the block the bot stands on.
  for (let x = 0; x < 4; x++) for (let z = -1; z <= 1; z++) origins.push(feet.offset(-x, 0, -z));
  if (radius > 0) for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (const dy of [0, -1, 1]) {
    const o = feet.offset(dx, dy, dz);
    if (!origins.some(q => q.equals(o))) origins.push(o);
  }
  const price = (o, n) => n * 1.5 + siteCost(feet, o, cast);
  for (const o of origins) {
    if (avoid.some(q => q.distanceTo(o) < 6)) continue;
    const cells = portalSiteCells(o), keys = new Set(cells.map(String));
    let ok = true;
    for (let fx = 0; fx < 4 && ok; fx++) for (let fz = -1; fz <= 1 && ok; fz++) {
      const floor = bot.blockAt(o.offset(fx, -1, fz));
      if (!floor || floor.boundingBox !== 'block' || FALLS.test(floor.name)) ok = false;
    }
    const dig = [];
    for (const c of cells) {
      if (!ok) break;
      const b = bot.blockAt(c);
      if (!b) { ok = false; break; }
      if (air(b)) continue;
      if (!SITE_ROCK.test(b.name) || b.diggable === false) { ok = false; break; }
      dig.push(c);
    }
    // Nothing that flows in or falls in once the cells are open.
    for (const c of cells) {
      if (!ok) break;
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
        const n = c.offset(...d);
        if (keys.has(String(n))) continue;
        const b = bot.blockAt(n);
        if (!b || LIQUID.test(b.name) || [true, 'true'].includes(b.getProperties?.().waterlogged) || (d[1] === 1 && FALLS.test(b.name))) { ok = false; break; }
      }
    }
    if (ok && (!best || price(o, dig.length) < price(best.origin, best.cells.length))) best = { origin: o, cells: dig };
  }
  if (!best) return null;
  const kinds = [...new Set(best.cells.map(c => bot.blockAt(c).name.replaceAll('_', ' ')))].slice(0, 4);
  return { ...best, kinds };
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

module.exports = { bucketTrip, siteCost, reservedForConstruction, portalSiteClear, selectPortalSite, portalSiteDig, portalSiteCells, portalSupports };

'use strict';
// Knowing what is around: which parts of the world the bot has been
// through, and what it found there. The player asked for exploring as a
// way to spend spare daylight, because a village (beds, food, trades) or a
// ruined portal (obsidian, a frame half built) is worth far more known in
// advance than stumbled on in a hurry.
//
// The map is coarse: 64-block areas, each remembered once walked through,
// with when and in what biome. Every trip counts (the main loops mark the
// area the bot is in, whatever it is doing); an exploring trip only picks
// where to go next: the nearest unexplored area around home, so the known
// map grows outward from the base rather than wherever the bot wandered.
// All of it is kept in the per-world store with the portals and villages.
const { goals } = require('mineflayer-pathfinder');
const { setAside, isSetAside } = require('./progress');

const AREA = 64, REACH = 8, LEG_MS = 90000, SAME_PORTAL = 24;
const dimensionOf = bot => String(bot.game?.dimension || 'overworld').replace(/^minecraft:/, '').replace(/^the_/, '');
const areaOf = (where, x, z) => ({ key: `${where}:${Math.floor(x / AREA)},${Math.floor(z / AREA)}`, ax: Math.floor(x / AREA), az: Math.floor(z / AREA) });
const centre = (ax, az) => ({ x: ax * AREA + AREA / 2, z: az * AREA + AREA / 2 });

// The area the bot stands in is explored. Cheap enough for every step.
function markExplored(bot, goal, { now = Date.now() } = {}) {
  const here = bot.entity?.position;
  if (!here) return false;
  const where = dimensionOf(bot), { key } = areaOf(where, here.x, here.z);
  goal.explored ||= {};
  if (goal.explored[key]) { goal.explored[key].seenAt = now; return false; }
  let biome;
  try { const b = bot.blockAt(here.floored())?.biome; biome = (bot.registry?.biomes?.[b?.id]?.name || b?.name || '').replace('minecraft:', '') || undefined; } catch (_) {}
  goal.explored[key] = { firstAt: now, seenAt: now, ...(biome ? { biome } : {}) };
  return true;
}

// What is worth coming back to, each with a detector over the blocks in
// view. Villages keep their own record (villages.js: beds, hay, the bell);
// everything else is a landmark: kind, place, when seen, a detail or two.
//   ruined_portal    obsidian, often a chest with gold, a frame half built
//   lava_pool        surface lava: water on lava is obsidian, the cheapest portal
//   dungeon          a spawner in mossy cobblestone, with chests
//   mineshaft        rails and cobwebs: chests, rails, string, exposed ores
//   desert_temple    chiseled sandstone over orange terracotta: loot chests
//   jungle_temple    tripwire and mossy stone in the jungle: loot chests
//   nether_fortress  nether brick: blazes, the rods for the eyes
//   bastion          blackstone with gold: gold blocks to barter with
const block = (bot, name) => bot.registry?.blocksByName?.[name]?.id;
const find = (bot, names, maxDistance = 48, count = 64) => {
  const ids = names.map(n => block(bot, n)).filter(id => id !== undefined);
  return ids.length ? bot.findBlocks({ matching: ids, maxDistance, count }) : [];
};
const near = (bot, p, names, r = 2) => { for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) if (names.includes(bot.blockAt(p.offset(dx, dy, dz))?.name)) return true; return false; };
const at = (p, detail = {}) => ({ x: p.x, y: p.y, z: p.z, ...detail });
const DETECTORS = [
  { kind: 'ruined_portal', dimension: 'overworld', same: 24, detect: bot => {
    const found = find(bot, ['crying_obsidian', 'obsidian']);
    const sign = found.find(p => bot.blockAt(p)?.name === 'crying_obsidian' || near(bot, p, ['netherrack', 'magma_block']));
    return sign && at(sign, { obsidian: found.filter(p => p.distanceTo(sign) <= 8 && bot.blockAt(p)?.name === 'obsidian').length });
  } },
  { kind: 'lava_pool', dimension: 'overworld', same: 32, detect: bot => {
    const open = find(bot, ['lava'], 32, 96).filter(p => bot.blockAt(p.offset(0, 1, 0))?.boundingBox === 'empty' && !/lava/.test(bot.blockAt(p.offset(0, 1, 0))?.name || ''));
    const seed = open.find(p => open.filter(q => q.distanceTo(p) <= 4).length >= 6);
    return seed && at(seed, { lava: open.filter(q => q.distanceTo(seed) <= 6).length });
  } },
  { kind: 'dungeon', dimension: 'overworld', same: 16, detect: bot => {
    const spawner = find(bot, ['spawner'], 32, 8).find(p => near(bot, p, ['mossy_cobblestone', 'cobblestone'], 4));
    return spawner && at(spawner);
  } },
  { kind: 'mineshaft', dimension: 'overworld', same: 48, detect: bot => {
    const rails = find(bot, ['rail'], 32, 32);
    const rail = rails.find(p => near(bot, p, ['cobweb'], 6));
    return rail && at(rail, { rails: rails.length });
  } },
  { kind: 'desert_temple', dimension: 'overworld', same: 32, detect: bot => {
    const carved = find(bot, ['chiseled_sandstone'], 48, 16);
    const temple = carved.length >= 4 && carved.find(p => find(bot, ['orange_terracotta'], 48, 4).some(q => q.distanceTo(p) <= 16));
    return temple && at(temple);
  } },
  { kind: 'jungle_temple', dimension: 'overworld', same: 32, detect: bot => {
    const hook = find(bot, ['tripwire_hook'], 32, 8).find(p => near(bot, p, ['mossy_cobblestone', 'chiseled_stone_bricks'], 4));
    return hook && at(hook);
  } },
  { kind: 'nether_fortress', dimension: 'nether', same: 96, detect: bot => {
    const bricks = find(bot, ['nether_bricks', 'nether_brick_fence', 'nether_brick_stairs'], 64, 128);
    if (bricks.length < 24) return null;
    const here = bot.entity.position;
    const nearest = bricks.sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
    return at(nearest, { bricks: bricks.length });
  } },
  { kind: 'bastion', dimension: 'nether', same: 64, detect: bot => {
    const gilded = find(bot, ['gilded_blackstone', 'gold_block'], 48, 16).filter(p => near(bot, p, ['polished_blackstone_bricks', 'blackstone', 'cracked_polished_blackstone_bricks'], 3));
    return gilded.length ? at(gilded[0], { gold: gilded.length }) : null;
  } },
];
const LANDMARK_KINDS = DETECTORS.map(d => d.kind);

function rememberLandmark(goal, kind, where, place, now = Date.now()) {
  const detector = DETECTORS.find(d => d.kind === kind);
  goal.landmarks ||= [];
  const known = goal.landmarks.find(l => l.kind === kind && l.dimension === where && Math.hypot(l.x - place.x, l.z - place.z) < (detector?.same || 32));
  if (known) { known.seenAt = now; for (const [k, v] of Object.entries(place)) if (typeof v === 'number' && !['x', 'y', 'z'].includes(k)) known[k] = Math.max(known[k] || 0, v); return { landmark: known, isNew: false }; }
  const entry = { kind, ...place, dimension: where, firstAt: now, seenAt: now };
  goal.landmarks.push(entry);
  return { landmark: entry, isNew: true };
}

const phrase = kind => kind.replaceAll('_', ' ');
const detail = l => l.obsidian ? ` (${l.obsidian} obsidian)` : l.gold ? ` (gold: ${l.gold})` : '';

// The landmark look the main loops make, on the villages' cheap schedule:
// every thirtieth step, on entering a new area, or once moved on. Every
// detector that applies to this dimension looks; a first sighting is said.
const looks = new WeakMap();
function noticeLandmarks(bot, goal, save, { now = Date.now(), every = 30, moved = 32, force = false } = {}) {
  const here = bot.entity?.position;
  if (!here) return [];
  const newArea = markExplored(bot, goal, { now });
  const look = looks.get(bot) || { steps: 0, at: null };
  looks.set(bot, look);
  look.steps++;
  const far = !look.at || Math.hypot(look.at.x - here.x, look.at.z - here.z) > moved;
  if (!force && !newArea && !far && look.steps < every) return [];
  look.steps = 0; look.at = { x: here.x, z: here.z };
  if (typeof bot.findBlocks !== 'function') { if (newArea) save(); return []; }
  const where = dimensionOf(bot), found = [];
  for (const detector of DETECTORS.filter(d => d.dimension === where)) {
    let place = null;
    try { place = detector.detect(bot); } catch (_) { place = null; }
    if (!place) continue;
    const { landmark, isNew } = rememberLandmark(goal, detector.kind, where, place, now);
    found.push(landmark);
    if (isNew) {
      goal.survivalAction = { action: 'landmark_found', kind: detector.kind, position: { x: landmark.x, y: landmark.y, z: landmark.z }, at: new Date(now).toISOString() };
      bot.chat?.(`Found a ${phrase(detector.kind)} at ${landmark.x}, ${landmark.z}${detail(landmark)}.`);
    }
  }
  if (found.length || newArea) save();
  return found;
}

// Remembered landmarks of a kind in this dimension, nearest first.
function knownLandmarks(bot, goal, kind, reach = Infinity) {
  const here = bot.entity?.position, where = dimensionOf(bot);
  if (!here) return [];
  return (goal.landmarks || []).filter(l => l.kind === kind && l.dimension === where)
    .map(landmark => ({ landmark, distance: Math.round(Math.hypot(landmark.x - here.x, landmark.z - here.z)) }))
    .filter(l => l.distance <= reach).sort((a, b) => a.distance - b.distance);
}

// Where the next exploring leg goes: the nearest unexplored area within
// eight areas (512 blocks) of home, weighed half again by its distance from
// home, so the map fills in around the base first. Areas the walk could not
// reach rest for half an hour.
function unexploredArea(bot, goal, { home } = {}) {
  const here = bot.entity?.position;
  if (!here) return null;
  const where = dimensionOf(bot), origin = home || { x: here.x, z: here.z };
  const o = areaOf(where, origin.x, origin.z);
  let best = null;
  for (let dx = -REACH; dx <= REACH; dx++) for (let dz = -REACH; dz <= REACH; dz++) {
    const ax = o.ax + dx, az = o.az + dz, key = `${where}:${ax},${az}`;
    if (goal.explored?.[key] || isSetAside(goal, 'explore_area', key)) continue;
    const c = centre(ax, az);
    const score = Math.hypot(c.x - here.x, c.z - here.z) + 0.5 * Math.hypot(c.x - origin.x, c.z - origin.z);
    if (!best || score < best.score) best = { key, ...c, score, fromHere: Math.round(Math.hypot(c.x - here.x, c.z - here.z)) };
  }
  return best;
}

function explorationSummary(goal, where = 'overworld') {
  const areas = Object.keys(goal.explored || {}).filter(k => k.startsWith(`${where}:`)).length;
  const landmarks = {};
  for (const l of goal.landmarks || []) if (l.dimension === where) landmarks[l.kind] = (landmarks[l.kind] || 0) + 1;
  return { areas, villages: (goal.villages || []).filter(v => v.dimension === where).length, landmarks };
}
const summaryText = known => [`${known.areas} areas walked`, `${known.villages} village${known.villages === 1 ? '' : 's'}`,
  ...Object.entries(known.landmarks).map(([kind, n]) => `${n} ${phrase(kind)}${n === 1 ? '' : 's'}`)].join(', ');

// One leg: walk to the target area's centre (the pathfinder, a minute and a
// half at most), marking and looking on the way through the main loop's
// own calls, and look around on arrival. A leg that makes no ground sets
// its area aside.
async function exploreStep(bot, task, goal, save, { navigate, home, noticeVillage } = {}) {
  const target = unexploredArea(bot, goal, { home });
  if (!target) return false;
  const start = bot.entity.position.clone();
  goal.step = { action: 'explore', area: target.key, target: { x: Math.round(target.x), z: Math.round(target.z) }, distance: target.fromHere, known: explorationSummary(goal, dimensionOf(bot)) };
  save();
  try { await navigate(bot, task, new goals.GoalNearXZ(target.x, target.z, 12), { timeoutMs: LEG_MS, stallMs: 8000 }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  const gained = Math.hypot(target.x - start.x, target.z - start.z) - Math.hypot(target.x - bot.entity.position.x, target.z - bot.entity.position.z);
  noticeLandmarks(bot, goal, save, { force: true });
  noticeVillage?.(bot, goal, save, { force: true });
  const arrived = Math.hypot(target.x - bot.entity.position.x, target.z - bot.entity.position.z) <= 24;
  if (arrived) { goal.explored ||= {}; goal.explored[target.key] ||= { firstAt: Date.now(), seenAt: Date.now() }; }
  else if (gained < 8) setAside(goal, 'explore_area', target.key, 'the walk there made no ground', 1800000);
  save();
  return arrived || gained >= 8;
}

module.exports = { AREA, DETECTORS, LANDMARK_KINDS, areaOf, markExplored, rememberLandmark, noticeLandmarks, knownLandmarks, unexploredArea, explorationSummary, summaryText, exploreStep };

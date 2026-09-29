'use strict';
const { Vec3 } = require('vec3');
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
//   warped_forest    warped nylium and stems: endermen, and their pearls
//   trial_chambers   tuff and copper halls, trial spawners and vaults
//   deep_dark        sculk below y 0: the biome ancient cities are built in
//   ancient_city     deepslate tiles and bricks among sculk, or the
//                    reinforced deepslate of its portal frame: loot chests
const block = (bot, name) => bot.registry?.blocksByName?.[name]?.id;
const find = (bot, names, maxDistance = 48, count = 64) => {
  const ids = names.map(n => block(bot, n)).filter(id => id !== undefined);
  return ids.length ? bot.findBlocks({ matching: ids, maxDistance, count }) : [];
};
const near = (bot, p, names, r = 2) => { for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) if (names.includes(bot.blockAt(p.offset(dx, dy, dz))?.name)) return true; return false; };
const at = (p, detail = {}) => ({ x: p.x, y: p.y, z: p.z, ...detail });
// The nearest loaded column of a biome, sampled every sixteen blocks out to
// `reach` at the bot's height (Nether biomes are three-dimensional; this is
// the height the bot would walk at).
function biomeNear(bot, name, { reach = 128, step = 16 } = {}) {
  const here = bot.entity?.position?.floored?.();
  if (!here || typeof bot.blockAt !== 'function') return null;
  let best = null;
  for (let dx = -reach; dx <= reach; dx += step) for (let dz = -reach; dz <= reach; dz += step) {
    const b = bot.blockAt(here.offset(dx, 0, dz));
    if (!b?.biome) continue;
    const biome = String(bot.registry?.biomes?.[b.biome.id]?.name || b.biome.name || '').replace('minecraft:', '');
    if (biome !== name) continue;
    const d = dx * dx + dz * dz;
    if (!best || d < best.d) best = { d, p: here.offset(dx, 0, dz) };
  }
  return best ? at(best.p, { biome: true }) : null;
}
// The biome under the bot, and the others within the loaded area with their
// distance and direction: what lives where is Jev's to know (sheep graze in
// plains and meadows, not deserts), so the questions carry it. Sampled on a
// thirty-two block grid, looked at once every ten seconds.
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
// A biome of another dimension is not where the bot is (note 677): a block
// read with biome id 0 in the Nether was said as badlands, "mineshafts at
// the surface with gold ore high up", to a bot in a basalt delta.
const dimensionOfBot = bot => String(bot.game?.dimension || '').replace(/^minecraft:/, '').replace(/^the_/, '');
const biomeName = (bot, b) => {
  if (!b?.biome) return null;
  const entry = bot.registry?.biomes?.[b.biome.id];
  const here = dimensionOfBot(bot);
  if (entry?.dimension && here && entry.dimension !== here) return null;
  return String(entry?.name || b.biome.name || '').replace('minecraft:', '') || null;
};
const biomeViews = new WeakMap();
function biomeView(bot, { reach = 128, step = 32, now = Date.now() } = {}) {
  const cached = biomeViews.get(bot);
  if (cached && now - cached.at < 10000) return cached.view;
  const here = bot.entity?.position?.floored?.();
  if (!here || typeof bot.blockAt !== 'function') return null;
  const nearest = new Map();
  for (let dx = -reach; dx <= reach; dx += step) for (let dz = -reach; dz <= reach; dz += step) {
    const name = biomeName(bot, bot.blockAt(here.offset(dx, 0, dz)));
    if (!name) continue;
    const d = Math.round(Math.hypot(dx, dz));
    if (!nearest.has(name) || d < nearest.get(name).distance) nearest.set(name, { biome: name, distance: d, direction: d ? COMPASS[((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8] : 'here', x: here.x + dx, z: here.z + dz });
  }
  const current = biomeName(bot, bot.blockAt(here));
  // What each holds, from the game's tables (biomes.js).
  const { biomeFacts } = require('./biomes');
  const has = name => { const facts = biomeFacts(name); return facts ? { has: facts } : {}; };
  const view = { biome: current, ...(biomeFacts(current) ? { biomeHas: biomeFacts(current) } : {}),
    biomesNearby: [...nearest.values()].filter(b => b.biome !== current).sort((a, b) => a.distance - b.distance).slice(0, 6).map(b => ({ ...b, ...has(b.biome) })) };
  biomeViews.set(bot, { at: now, view });
  return view;
}

// What lies each way: the biomes along a heading, sampled every sixteen
// blocks as far as the world is loaded, run together into stretches, each
// with what it holds. For choosing which way to search: trial 35's search
// for wood circled a desert coast for eight minutes, turning away from
// water at every third walk, with badlands and land beyond to the south-west.
const HEADINGS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
function biomeRay(bot, heading, { reach = 128, step = 16 } = {}) {
  const here = bot.entity?.position?.floored?.();
  if (!here || typeof bot.blockAt !== 'function') return [];
  const angle = heading * Math.PI / 4, stretches = [];
  for (let d = step; d <= reach; d += step) {
    const b = bot.blockAt(here.offset(Math.round(Math.cos(angle) * d), 0, Math.round(Math.sin(angle) * d)));
    const name = biomeName(bot, b);
    if (!name) break;
    const last = stretches.at(-1);
    if (last?.biome === name) last.to = d;
    else stretches.push({ biome: name, from: d, to: d });
  }
  const { biomeFacts } = require('./biomes');
  return stretches.map(s => ({ ...s, ...(biomeFacts(s.biome) ? { has: biomeFacts(s.biome) } : {}) }));
}

// The ground itself along a heading: at each sample, whether the top of
// the ground is water. Biomes miss a desert lake: trial 35's heading north
// read "desert all the way" across forty blocks of water.
function surfaceRay(bot, heading, { reach = 128, step = 4 } = {}) {
  const here = bot.entity?.position?.floored?.();
  if (!here || typeof bot.blockAt !== 'function') return [];
  const angle = heading * Math.PI / 4, out = [];
  for (let d = step; d <= reach; d += step) {
    const x = here.x + Math.round(Math.cos(angle) * d), z = here.z + Math.round(Math.sin(angle) * d);
    let top = null;
    for (let y = here.y + 24; y >= here.y - 24; y--) {
      const b = bot.blockAt(new Vec3(x, y, z));
      if (!b) break;
      if (!/^(air|cave_air|void_air|short_grass|tall_grass|fern|dead_bush|short_dry_grass|tall_dry_grass|snow|.*_flower)$/.test(b.name)) { top = b; break; }
    }
    if (!top) break;
    out.push({ d, x, z, y: top.position.y, water: /water|seagrass|kelp/.test(top.name) });
  }
  return out;
}
// The first water along a heading and the land past it, from the ground.
function waterAhead(ray) {
  const wet = ray.find(r => r.water);
  if (!wet) return null;
  const across = ray.find(r => r.d > wet.d && !r.water);
  const last = ray.filter(r => r.d < (across?.d ?? Infinity) && r.water).at(-1);
  return { from: wet.d, to: last?.d ?? wet.d, landAt: across || null };
}

// A heading said for a choice: the biomes that way, where water starts and
// whether land comes again past it, and whether trees were seen that way.
const WATER_BIOME = /ocean|river/;
function headingFacts(stretches, ground = null) {
  if (!stretches.length) return 'nothing loaded that way';
  const words = n => n.replaceAll('_', ' ');
  const trees = stretches.find(st => st.has && !/no trees/.test(st.has) && /trees|bamboo|mangroves/.test(st.has));
  // The ground's own water where it was sampled; the biomes' otherwise.
  let water;
  if (ground?.length) {
    const w = waterAhead(ground);
    water = w ? `water on the ground from ${w.from} to ${w.to} blocks${w.landAt ? `, land again past it at ${w.landAt.d} (a swim of about ${w.to - w.from + 4})` : ' to the edge of what is loaded'}` : `dry ground all the way to ${ground.at(-1).d} blocks`;
  } else {
    const wet = stretches.find(st => WATER_BIOME.test(st.biome));
    const past = wet && stretches.find(st => st.from > wet.to && !WATER_BIOME.test(st.biome));
    water = wet ? `water from ${wet.from} blocks${past ? `, land again past it at ${past.from}` : ' to the edge of what is loaded'}` : `land all the way to ${stretches.at(-1).to} blocks`;
  }
  return `${stretches.map(st => words(st.biome)).join(', then ')}; ${water}; ${trees ? `trees in the ${words(trees.biome)} from ${trees.from} blocks` : 'no trees in any biome seen that way'}`;
}

// Across water that lies along the chosen heading, to the land past it:
// the surface search walks only on dry ground, and every way out of trial
// 35's desert crossed a river, a lake or the sea.
async function swimAcross(bot, task, goal, save, heading) {
  const { move } = require('./motion');
  const { checkAir } = require('./vitals');
  const ahead = waterAhead(surfaceRay(bot, heading, { reach: 96, step: 2 }));
  if (!ahead || ahead.from > 32 || !ahead.landAt) return false;
  const angle = heading * Math.PI / 4, start = bot.entity.position.clone();
  const along = () => (bot.entity.position.x - start.x) * Math.cos(angle) + (bot.entity.position.z - start.z) * Math.sin(angle);
  const land = ahead.landAt;
  goal.step = { action: 'swim_across', heading: HEADINGS[heading], water: { from: ahead.from, to: ahead.to }, land: { x: land.x, z: land.z } }; save();
  bot.chat?.(`Water to the ${HEADINGS[heading]}. Swimming across it, about ${ahead.to - ahead.from + 4} blocks.`);
  const water = () => /water/.test(bot.blockAt(bot.entity.position.floored())?.name || '');
  let stuck = 0;
  // A mob at the swimmer is answered, not swum on from: mid-231-f swam on
  // for sixteen seconds with a drowned hitting it from twelve to nothing
  // (2026-09-27).
  const { checkThreats } = require('./danger');
  for (let n = 0; n < 40; n++) {
    task.check(); checkAir(bot); checkThreats(bot);
    if (along() >= land.d - 1 && !water() && bot.entity.onGround) return true;
    const was = along();
    await move(bot, task, { label: 'swim_across', keys: ['forward', 'jump'], sneak: false, why: 'across the water on the chosen heading', guard: () => checkThreats(bot),
      look: new Vec3(land.x + 0.5, Math.max(land.y + 1.6, bot.entity.position.y + 1.2), land.z + 0.5), maxMs: 2000, tick: 50,
      until: () => along() >= land.d - 1 && !water() && bot.entity.onGround });
    if (along() - was < 0.8) { if (++stuck >= 3) return along() > 4; } else stuck = 0;
  }
  return along() > 4;
}

// The biomes worth a walk from here: another biome, far enough off that
// the walk takes the bot somewhere new, nearest first, each said with what
// it holds. A general side trip (work.js sideTrips) and the wool search's
// choice (home-base.js) are built from them.
function biomeTrips(bot, { min = 24, limit = 4 } = {}) {
  const view = biomeView(bot);
  if (!view || !/overworld/.test(String(bot.game?.dimension || 'overworld'))) return [];
  // Not the cave biomes: sampled at the feet they are underground, and trial
  // 34 set off for the dripstone caves with its bed still to make.
  return view.biomesNearby.filter(b => b.distance >= min && !/^(dripstone_caves|lush_caves|deep_dark)$/.test(b.biome)).slice(0, limit)
    .map(b => ({ ...b, says: `the ${b.biome.replaceAll('_', ' ')} ${b.distance} blocks ${b.direction}${b.has ? ` (${b.has})` : ''}` }));
}

const DETECTORS = [
  // An igloo always has a bed in it: in the snowy plains and taiga, where
  // there are no sheep, it is the bed (trial 107 found none, the user asked
  // what players do without sheep, 2026-09-25). A bed among snow blocks.
  { kind: 'igloo', dimension: 'overworld', same: 16, detect: bot => {
    const beds = find(bot, bot.registry.blocksArray.filter(b => /_bed$/.test(b.name)).map(b => b.name), 48, 16);
    const bed = beds.find(p => { let snow = 0; for (let dx = -4; dx <= 4; dx++) for (let dy = -1; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) if (bot.blockAt(p.offset(dx, dy, dz))?.name === 'snow_block') snow++; return snow >= 12; });
    return bed && at(bed, { beds: 1, igloo: true });
  } },
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
  { kind: 'deep_dark', dimension: 'overworld', same: 64, detect: bot => {
    const sculk = find(bot, ['sculk', 'sculk_vein', 'sculk_sensor', 'sculk_catalyst', 'sculk_shrieker'], 32, 64).filter(p => p.y < 0);
    return sculk.length >= 12 ? at(sculk[0], { sculk: sculk.length }) : null;
  } },
  { kind: 'ancient_city', dimension: 'overworld', same: 96, detect: bot => {
    const frame = find(bot, ['reinforced_deepslate'], 48, 4).filter(p => p.y < -20);
    if (frame.length) return at(frame[0], { frame: frame.length });
    const built = find(bot, ['deepslate_tiles', 'deepslate_bricks', 'cracked_deepslate_tiles', 'cracked_deepslate_bricks', 'polished_deepslate', 'chiseled_deepslate'], 48, 64).filter(p => p.y < -20);
    if (built.length < 16) return null;
    const sculk = find(bot, ['sculk', 'sculk_vein', 'sculk_sensor', 'sculk_shrieker'], 48, 16);
    const seed = built.find(p => sculk.some(q => q.distanceTo(p) <= 16));
    return seed ? at(seed, { built: built.length }) : null;
  } },
  { kind: 'trial_chambers', dimension: 'overworld', same: 64, detect: bot => {
    const marks = find(bot, ['trial_spawner', 'vault'], 48, 8);
    if (marks.length) return at(marks[0], { marks: marks.length });
    const tuff = find(bot, ['tuff_bricks', 'chiseled_tuff', 'chiseled_tuff_bricks', 'polished_tuff'], 48, 64).filter(p => p.y < 10);
    if (tuff.length < 16) return null;
    const copper = find(bot, ['copper_grate', 'waxed_copper_grate', 'copper_bulb', 'waxed_copper_bulb', 'oxidized_copper_grate', 'waxed_oxidized_copper_grate'], 48, 8);
    const seed = tuff.find(p => copper.some(q => q.distanceTo(p) <= 16));
    return seed ? at(seed, { tuff: tuff.length }) : null;
  } },
  { kind: 'nether_fortress', dimension: 'nether', same: 96, detect: bot => {
    const bricks = find(bot, ['nether_bricks', 'nether_brick_fence', 'nether_brick_stairs'], 64, 128);
    if (bricks.length < 24) return null;
    const here = bot.entity.position;
    const nearest = bricks.sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
    return at(nearest, { bricks: bricks.length });
  } },
  // Endermen spawn thickly in the warped forest and let a player be who
  // does not look at them: the pearls for the eyes, without a night walk.
  // The blocks within forty-eight, or failing that the chunks' own biome
  // anywhere in the loaded ground: the first live search walked legs past
  // ground it had loaded and never looked at.
  { kind: 'warped_forest', dimension: 'nether', same: 96, detect: bot => {
    const warped = find(bot, ['warped_nylium', 'warped_stem', 'warped_wart_block'], 48, 64);
    return warped.length >= 24 ? at(warped[0], { warped: warped.length }) : biomeNear(bot, 'warped_forest');
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
  const known = goal.landmarks.find(l => l.kind === kind && l.dimension === where && Math.hypot(l.x - place.x, (l.y ?? place.y) - (place.y ?? l.y), l.z - place.z) < (detector?.same || 32));
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
  // The bot's own portal is obsidian beside the netherrack it placed: not a
  // ruin. The first live "ruined portal" was its own frame, which the
  // obsidian step would then have mined.
  const own = [...(goal.portals || []), ...(goal.portalFrame?.blocks || [])].filter(p => !p.dimension || p.dimension === where);
  for (const detector of DETECTORS.filter(d => d.dimension === where)) {
    let place = null;
    try { place = detector.detect(bot); } catch (_) { place = null; }
    if (!place) continue;
    if (detector.kind === 'ruined_portal' && own.some(p => Math.hypot(p.x - place.x, p.z - place.z) <= 12)) continue;
    const { landmark, isNew } = rememberLandmark(goal, detector.kind, where, place, now);
    found.push(landmark);
    if (isNew) {
      // Said once, in Jev's voice, by the narration: it was said twice,
      // "Found a lava pool at..." and then "Found something worth remembering".
      goal.survivalAction = { action: 'landmark_found', kind: detector.kind, what: `${phrase(detector.kind)} at ${landmark.x}, ${landmark.z}${detail(landmark)}`, position: { x: landmark.x, y: landmark.y, z: landmark.z }, at: new Date(now).toISOString() };
    }
  }
  if (found.length || newArea) save();
  return found;
}

// Remembered landmarks of a kind in this dimension, nearest first.
function knownLandmarks(bot, goal, kind, reach = Infinity) {
  const here = bot.entity?.position, where = dimensionOf(bot);
  if (!here) return [];
  const { inQuietZone } = require('./sculk');
  return (goal.landmarks || []).filter(l => l.kind === kind && l.dimension === where && !inQuietZone(goal, { x: l.x, y: l.y ?? here.y, z: l.z }))
    .map(landmark => ({ landmark, distance: Math.round(Math.hypot(landmark.x - here.x, (landmark.y ?? here.y) - here.y, landmark.z - here.z)) }))
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
  try { await navigate(bot, task, new goals.GoalNearXZ(target.x, target.z, 12), { timeoutMs: LEG_MS, stallMs: 8000, sprint: true }); }
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

// A walk whose route search ran out of time: the pathfinder gives up
// planning after a few seconds (its think timeout), which a walk of a
// hundred and fifty blocks over rough ground outruns. It found no way and
// no lack of one.
const planningTimedOut = err => err?.name === 'Timeout' || /took to long to decide path/i.test(String(err?.message || ''));

// A trip to the nearest remembered landmark of the given kinds (or the
// cheapest by `cost`: lava carried on to a frame, obsidian.js collectLava),
// in order of preference: one leg of up to two minutes, sprinting while food
// allows. A landmark the walk makes no ground toward rests half an hour.
// Returns the landmark when the bot is within `arrive` of it, false while on
// the way, and null when there is none to go to.
async function goToLandmark(bot, task, goal, save, kinds, { navigate, reach = 512, arrive = 12, filter = () => true, cost = null } = {}) {
  let choice = null;
  for (const kind of kinds) {
    const known = knownLandmarks(bot, goal, kind, reach).filter(k => filter(k.landmark) && !isSetAside(goal, 'landmark_trip', `${k.landmark.kind}:${k.landmark.x},${k.landmark.z}`));
    choice = cost ? known.map(k => ({ k, c: cost(k.landmark) })).sort((a, b) => a.c - b.c)[0]?.k : known[0];
    if (choice) break;
  }
  if (!choice) return null;
  const { landmark } = choice, key = `${landmark.kind}:${landmark.x},${landmark.z}`;
  if (choice.distance <= arrive) return landmark;
  const before = choice.distance, from = bot.entity.position.clone();
  goal.step = { action: 'go_to_landmark', kind: landmark.kind, target: { x: landmark.x, y: landmark.y, z: landmark.z }, distance: before }; save();
  // To the place itself, depth and all: a walk that judged only the map
  // stopped on the grass over a buried dungeon and "looted" nothing.
  const goal3 = landmark.y === undefined ? new goals.GoalNearXZ(landmark.x, landmark.z, Math.max(2, arrive - 4)) : new goals.GoalNear(landmark.x, landmark.y, landmark.z, Math.max(2, arrive - 4));
  const distanceNow = () => Math.hypot(landmark.x - bot.entity.position.x, (landmark.y ?? bot.entity.position.y) - bot.entity.position.y, landmark.z - bot.entity.position.z);
  let timedOut = false, walkWhy = null;
  try { await navigate(bot, task, goal3, { timeoutMs: 120000, stallMs: 8000, sprint: true }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; timedOut = planningTimedOut(err); walkWhy = String(err.message || err).slice(0, 160); }
  // Its search out of time, a leg of the way on foot, thirty-two blocks
  // toward it, as to a portal (work.js portalLeg): read as a walk that came
  // no nearer, mid-230-u set aside the four lava pools within two hundred
  // blocks in twenty seconds, five seconds a pool (note 524).
  const flat = Math.hypot(landmark.x - from.x, landmark.z - from.z);
  if (timedOut && distanceNow() > arrive && before - distanceNow() < 8 && flat > 16) {
    const k = Math.min(32, flat - 8) / flat;
    try { await navigate(bot, task, new goals.GoalNearXZ(from.x + (landmark.x - from.x) * k, from.z + (landmark.z - from.z) * k, 4), { timeoutMs: 30000, stallMs: 8000, sprint: true }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
  const after = distanceNow();
  if (after <= arrive) return landmark;
  // Ground made is a new nearest approach, not a walk that ended nearer
  // than it began: mid-242-b walked toward a lava pool at y 24 along a
  // partial route thirty-three times, each walk a little way in and back
  // out, and never came nearer than the first (2026-09-26).
  const best = landmark.nearest ?? before;
  landmark.nearest = Math.min(best, after);
  // How the walk ended, kept with the place: said where the place is
  // offered (the rung set aside for it, note 583), not only "no nearer".
  landmark.lastWalk = { at: Date.now(), from: { x: Math.round(from.x), y: Math.round(from.y), z: Math.round(from.z) }, began: Math.round(before), ended: Math.round(after), ...(walkWhy ? { why: walkWhy } : {}) };
  if (before - after < 8 || after >= best - 1) { setAside(goal, 'landmark_trip', key, `the walk there came no nearer than before (${Math.round(before)} blocks off to ${Math.round(after)})${walkWhy ? `: ${walkWhy}` : ''}`, 1800000); }
  save();
  return false;
}

// What the bot has found, in a sentence: for "what have you found?".
function foundSentence(known = {}, where = 'overworld') {
  const villages = (known.villages || []).filter(v => v.dimension === where);
  const landmarks = (known.landmarks || []).filter(l => l.dimension === where);
  const areas = Object.keys(known.explored || {}).filter(k => k.startsWith(`${where}:`)).length;
  if (!villages.length && !landmarks.length) return areas ? `I've walked ${areas} areas and found nothing worth remembering yet.` : "I haven't explored yet.";
  const counts = {};
  for (const l of landmarks) counts[l.kind] = (counts[l.kind] || 0) + 1;
  const parts = [...(villages.length ? [`${villages.length} village${villages.length === 1 ? '' : 's'}`] : []),
    ...Object.entries(counts).map(([kind, n]) => `${n} ${phrase(kind)}${n === 1 ? '' : 's'}`)];
  return `I've walked ${areas} areas and found ${parts.join(', ')}.`;
}

// The findings as memory entries for chat: recalled ("what have you
// found?", "where is the nearest village?") and visited ("go to the
// village"). They are the world's, not a player's, so they are never forgotten.
function foundEntries(known = {}) {
  const villages = (known.villages || []).map(v => ({ kind: 'village', x: v.x, y: v.y, z: v.z, dimension: v.dimension, firstAt: v.seenAt }));
  return [...villages, ...(known.landmarks || [])].map(l => ({ kind: l.kind, label: phrase(l.kind), position: { x: l.x, y: l.y, z: l.z },
    dimension: l.dimension, firstAt: l.firstAt }));
}

module.exports = { biomeView, biomeTrips, biomeRay, headingFacts, surfaceRay, waterAhead, swimAcross, HEADINGS, foundEntries, goToLandmark, foundSentence, AREA, DETECTORS, LANDMARK_KINDS, areaOf, markExplored, rememberLandmark, noticeLandmarks, knownLandmarks, unexploredArea, explorationSummary, summaryText, exploreStep };

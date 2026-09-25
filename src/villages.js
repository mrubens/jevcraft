'use strict';
const { setAside, isSetAside } = require('./progress');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');
const { countOf } = require('./skills');

// Villages, remembered the way portals are: a list on the goal, per
// dimension, deduplicated by distance. A village is what the beat-the-game
// ladder keeps walking past: beds already made, wheat already grown, hay
// stacked beside the farms. Code notices the village, remembers it and
// offers it as a rung or a forage option; the existing decisions choose.
//
// Trading is out of scope for now. TODO: a cleric villager sells ender
// pearls for emeralds, which would turn the enderman hunt into a walk.
const VILLAGE_RADIUS = 48;
const SAME_VILLAGE = 64;
const BED_REACH = 200;
const FOOD_REACH = 120;
const SCAN_EVERY = 30;
const SCAN_MOVED = 32;
const RETRY_MS = 20 * 60 * 1000;
const CROPS = { wheat: { ripe: 7, seed: 'wheat_seeds' }, carrots: { ripe: 7, seed: 'carrot' }, potatoes: { ripe: 7, seed: 'potato' } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pos = p => new Vec3(p.x, p.y, p.z);
const plain = p => ({ x: p.x, y: p.y, z: p.z });
const dimension = bot => String(bot.game?.dimension || 'overworld').replace(/^minecraft:/, '').replace(/^the_/, '');
const isBed = block => /_bed$/.test(block?.name || '');
const bedsCarried = bot => bot.inventory.items().filter(i => /_bed$/.test(i.name)).reduce((n, i) => n + (i.count || 1), 0);

function findAll(bot, names, { radius = VILLAGE_RADIUS, count = 64, point } = {}) {
  const ids = names.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  if (!ids.length || !bot.findBlocks) return [];
  return bot.findBlocks({ matching: ids, maxDistance: radius, count, point: point || bot.entity.position }) || [];
}
const bedNames = bot => bot.registry.blocksArray.filter(b => /_bed$/.test(b.name)).map(b => b.name);
const centroid = points => {
  const sum = points.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y, z: s.z + p.z }), { x: 0, y: 0, z: 0 });
  return { x: Math.round(sum.x / points.length), y: Math.round(sum.y / points.length), z: Math.round(sum.z / points.length) };
};

// What is in the loaded world around a point: a bell, several hay bales,
// or villagers make a village. The centre is the bell when there is one.
// Beds are counted by their head half, so a bed is one bed and not two.
function observeVillage(bot, { radius = VILLAGE_RADIUS, point = bot.entity?.position } = {}) {
  if (!point) return null;
  const bell = findAll(bot, ['bell'], { radius, count: 1, point })[0];
  const hay = findAll(bot, ['hay_block'], { radius, count: 64, point });
  const villagers = Object.values(bot.entities || {}).filter(e => e.name === 'villager' && e.isValid !== false && e.position?.distanceTo(point) <= radius);
  if (!bell && hay.length < 3 && villagers.length < 2) return null;
  const centre = bell ? plain(bell) : centroid([...hay, ...villagers.map(v => v.position.floored())]);
  const halves = findAll(bot, bedNames(bot), { radius, count: 128, point: pos(centre) });
  const heads = halves.filter(p => bot.blockAt(p)?.getProperties?.()?.part === 'head');
  return { ...centre, bell: bell ? plain(bell) : undefined, beds: heads.length || Math.ceil(halves.length / 2), hay: hay.length, villagers: villagers.length };
}

// One entry per village: a second look from the far side of the same
// village updates the counts rather than adding a neighbour.
function rememberVillage(goal, save, village, where, now = Date.now()) {
  goal.villages ||= [];
  const known = goal.villages.find(v => v.dimension === where && Math.hypot(v.x - village.x, v.z - village.z) < SAME_VILLAGE);
  if (known) {
    known.seenAt = now; known.beds = Math.max(known.beds || 0, village.beds); known.hay = Math.max(known.hay || 0, village.hay);
    if (village.bell && !known.bell) Object.assign(known, { bell: village.bell, x: village.x, y: village.y, z: village.z });
    save();
    return { village: known, isNew: false };
  }
  const entry = { x: village.x, y: village.y, z: village.z, dimension: where, seenAt: now, bell: village.bell, beds: village.beds, hay: village.hay };
  goal.villages.push(entry); save();
  return { village: entry, isNew: true };
}

// The cheap, rare check the main loops call every step: it looks every
// thirtieth step or once the bot has moved on, and only in the Overworld.
// A new village is announced once through the ordinary survival narration
// and recorded in the flight recording the same way.
const scans = new WeakMap();
function noticeVillage(bot, goal, save, { now = Date.now(), every = SCAN_EVERY, moved = SCAN_MOVED, force = false } = {}) {
  const here = bot.entity?.position;
  if (!here || dimension(bot) !== 'overworld') return null;
  const scan = scans.get(bot) || { steps: 0, at: null };
  scans.set(bot, scan);
  scan.steps++;
  const far = !scan.at || Math.hypot(scan.at.x - here.x, scan.at.z - here.z) > moved;
  if (!force && !far && scan.steps < every) return null;
  scan.steps = 0; scan.at = { x: here.x, z: here.z };
  // A look that fails (a chunk on its way out, a world not yet loaded) is
  // no village, never a failed step of whatever the bot was doing.
  let seen = null;
  try { seen = observeVillage(bot); } catch (_) { return null; }
  if (!seen) return null;
  const { village, isNew } = rememberVillage(goal, save, seen, dimension(bot), now);
  if (isNew) {
    goal.survivalAction = { action: 'village_found', position: { x: village.x, y: village.y, z: village.z }, beds: village.beds, hay: village.hay, at: new Date(now).toISOString() };
    save();
  }
  return village;
}

// Remembered villages in this dimension within reach, nearest first.
function knownVillages(bot, goal, reach = Infinity) {
  const here = bot.entity?.position;
  if (!here) return [];
  const where = dimension(bot);
  return (goal.villages || []).filter(v => v.dimension === where)
    .map(village => ({ village, distance: Math.round(Math.hypot(village.x - here.x, (village.y ?? here.y) - here.y, village.z - here.z)) }))
    .filter(v => v.distance <= reach).sort((a, b) => a.distance - b.distance);
}

// The bed rung's cheaper shape: a village with beds within two hundred
// blocks is a walk, a sheep is a search. Offered ahead of the wool hunt;
// a village that could not be reached three times waits twenty minutes.
function villageBedRung(bot, goal, { now = Date.now() } = {}) {
  if (isSetAside(goal, 'village_bed', 'any', now)) return null;
  const near = knownVillages(bot, goal, BED_REACH).find(({ village }) => village.beds > 0);
  if (near) return { phase: 'bed', action: 'village_bed', village: near.village, distance: near.distance };
  // An igloo remembered with its bed still in it, taken the same way.
  const igloo = require('./exploration').knownLandmarks(bot, goal, 'igloo', BED_REACH).find(({ landmark }) => landmark.beds > 0);
  return igloo ? { phase: 'bed', action: 'village_bed', village: igloo.landmark, distance: igloo.distance } : null;
}

async function walkToVillage(bot, task, village, actions, range = 6) {
  const centre = pos(village.bell || village);
  if (bot.entity.position.distanceTo(centre) <= 24) return;
  await actions.navigate(bot, task, new goals.GoalNear(centre.x, centre.y, centre.z, range), { timeoutMs: 120000, stallMs: 15000, sprint: true });
}

async function collectDrops(bot, task, actions, near, names, until, limit = 12) {
  await sleep(400);
  const drops = Object.values(bot.entities).filter(e => names.includes(e.getDroppedItem?.()?.name) && e.position.distanceTo(near) < 10);
  for (const drop of drops.slice(0, limit)) {
    task.check();
    if (until()) return;
    const d = drop.position.floored();
    await actions.navigate(bot, task, new goals.GoalNear(d.x, d.y, d.z, 0.5), { timeoutMs: 8000, stallMs: 3000, stopWhen: () => until() || bot.entities[drop.id] !== drop || drop.isValid === false });
    await sleep(150);
  }
}

// Walk to the village and dig up a bed: it drops itself. The village
// remembers one bed fewer; a village with none left hands the rung back
// to the sheep.
async function takeVillageBed(bot, task, goal, save, village, actions) {
  task.check(); checkAir(bot);
  const attempt = goal.villageBed ||= { attempts: 0 };
  attempt.attempts++;
  if (attempt.attempts > 3) { delete goal.villageBed; setAside(goal, 'village_bed', 'any', 'not reached in three tries', RETRY_MS); save(); throw new Error('The village bed was not reached in three tries; back to the sheep for now'); }
  const before = bedsCarried(bot);
  goal.step = { action: 'village_bed', village: { x: village.x, z: village.z, ...(village.igloo ? { igloo: true } : {}) }, beds: village.beds }; save();
  await walkToVillage(bot, task, village, actions);
  const here = bot.entity.position;
  // Never the bed on the home's own bed cells: trial 84's home stood in a
  // village, its bed was taken back as a village bed and placed again eight
  // times in eight seconds, and the audit called the loop.
  const own = (() => {
    try {
      const base = require('./home-base'), home = base.homeOf(bot, goal);
      if (!home) return [];
      const { bed } = base.layout(home);
      return [bed.foot, bed.head].map(pos);
    } catch (_) { return []; }
  })();
  const halves = findAll(bot, bedNames(bot), { radius: VILLAGE_RADIUS, count: 128, point: pos(village.bell || village) })
    .filter(p => !own.some(o => o.equals(p)))
    .sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
  if (!halves.length) {
    village.beds = 0; delete goal.villageBed; save();
    throw new Error(village.igloo ? 'No bed left in the igloo' : 'No bed left in the village');
  }
  const target = halves[0];
  goal.step = { action: 'village_bed', village: { x: village.x, z: village.z, ...(village.igloo ? { igloo: true } : {}) }, bed: plain(target) }; save();
  checkThreats(bot);
  await actions.dig(bot, task, target, { requireDrops: false, done: () => !isBed(bot.blockAt(target)) });
  await collectDrops(bot, task, actions, target, bedNames(bot), () => bedsCarried(bot) > before, 4);
  if (bedsCarried(bot) <= before) throw new Error('The village bed did not end up in my pockets');
  village.beds = Math.max(0, (village.beds || 1) - 1); village.seenAt = Date.now();
  delete goal.villageBed; save();
}

// Ripe crops within the village: wheat, carrots and potatoes at full age.
function ripeCrops(bot, centre, radius = 32) {
  return findAll(bot, Object.keys(CROPS), { radius, count: 64, point: pos(centre) })
    .map(p => ({ position: p, block: bot.blockAt(p) }))
    .filter(({ block }) => block && CROPS[block.name] && Number(block.getProperties?.().age ?? 0) >= CROPS[block.name].ripe);
}

// The forage option: what the village has to eat, when it is remembered
// within reach. Ripe crops and hay counts are read off the world when the
// village is loaded, and off memory when it is not.
function villageFood(bot, goal) {
  const near = knownVillages(bot, goal, FOOD_REACH)[0];
  if (!near) return null;
  const { village, distance } = near;
  const centre = village.bell || village;
  const loaded = !!bot.blockAt?.(pos(centre));
  const crops = loaded ? ripeCrops(bot, centre).length : 0;
  const hay = loaded ? findAll(bot, ['hay_block'], { radius: VILLAGE_RADIUS, count: 64, point: pos(centre) }).length : village.hay || 0;
  if (loaded) village.hay = hay;
  if (!crops && !hay) return null;
  return { village, distance, ripeCrops: crops, hayBales: hay, loaded };
}

// Take what is ripe, put the seed back, and bake bread from the wheat;
// a hay bale or two makes up the wheat when the farms are bare. The
// villagers keep their houses, their bell and their planted rows.
async function eatFromVillage(bot, task, goal, save, village, actions) {
  task.check(); checkAir(bot);
  const centre = village.bell || village;
  await walkToVillage(bot, task, village, actions);
  const before = { wheat: countOf(bot, 'wheat'), carrot: countOf(bot, 'carrot'), potato: countOf(bot, 'potato') };
  const crops = ripeCrops(bot, centre).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, 8);
  const replant = [];
  for (const { position, block } of crops) {
    task.check(); checkAir(bot); checkThreats(bot);
    goal.step = { action: 'village_harvest', crop: block.name, cell: plain(position), cells: crops.length }; save();
    const crop = block.name;
    await actions.dig(bot, task, position, { requireDrops: false, done: () => bot.blockAt(position)?.name !== crop });
    replant.push({ position, seed: CROPS[crop].seed });
  }
  if (crops.length) await collectDrops(bot, task, actions, pos(centre), ['wheat', 'wheat_seeds', 'carrot', 'potato'], () => false);
  for (const { position, seed } of replant) {
    task.check();
    // Keep one of a crop that is itself the seed, so a carrot patch feeds
    // the bot and stays a carrot patch.
    if (countOf(bot, seed) < (seed === 'wheat_seeds' ? 1 : 2)) continue;
    const farmland = bot.blockAt(position.offset(0, -1, 0));
    if (farmland?.name !== 'farmland' || bot.blockAt(position)?.name !== 'air') continue;
    const item = bot.inventory.items().find(i => i.name === seed);
    if (!item) continue;
    await bot.equip(item, 'hand');
    await bot.lookAt(position.offset(0.5, 0, 0.5), true);
    try { await bot.placeBlock(farmland, new Vec3(0, 1, 0)); } catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; }
  }
  // One bale is nine wheat, three loaves: enough. The second is only for a
  // drop that got away.
  const enough = () => countOf(bot, 'wheat') + countOf(bot, 'hay_block') * 9 >= 3;
  if (!enough()) {
    const bales = findAll(bot, ['hay_block'], { radius: VILLAGE_RADIUS, count: 8, point: pos(centre) })
      .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)).slice(0, 2);
    for (const bale of bales) {
      if (enough()) break;
      task.check(); checkAir(bot); checkThreats(bot);
      goal.step = { action: 'village_hay', cell: plain(bale) }; save();
      await actions.dig(bot, task, bale, { requireDrops: false, done: () => bot.blockAt(bale)?.name !== 'hay_block' });
      await collectDrops(bot, task, actions, bale, ['hay_block'], () => countOf(bot, 'hay_block') > 0, 2);
      village.hay = Math.max(0, (village.hay || 1) - 1);
    }
  }
  save();
  const wheat = countOf(bot, 'wheat') + countOf(bot, 'hay_block') * 9;
  if (wheat >= 3) { await actions.acquireStep(bot, task, 'bread', countOf(bot, 'bread') + Math.floor(wheat / 3), goal, save); return; }
  if (countOf(bot, 'carrot') > before.carrot || countOf(bot, 'potato') > before.potato) return;
  throw new Error('Nothing ripe at the village after all');
}

module.exports = { VILLAGE_RADIUS, BED_REACH, FOOD_REACH, observeVillage, rememberVillage, noticeVillage, knownVillages, villageBedRung, takeVillageBed, ripeCrops, villageFood, eatFromVillage };

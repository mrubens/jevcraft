'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { choice } = require('./typesafe');
const { resolveItem } = require('./catalog');
const { dryPassable, damagingTerrain } = require('./terrain');
const { safeFromHostiles } = require('./danger');
const { surfaceMovement } = require('./surface');
const { surveyRoute } = require('./skills');

function discoveryCatalog(registry, kind) {
  const entries = kind === 'biome' ? registry.biomesArray : registry.entitiesArray.filter(e => ['animal', 'mob', 'water_creature', 'ambient', 'hostile', 'passive'].includes(e.type) || /mobs/i.test(e.category || ''));
  const groups = {};
  for (const entry of entries) (groups[entry.category || entry.type || 'other'] ||= []).push(entry);
  const tree = {};
  for (const [category, members] of Object.entries(groups)) {
    for (let start = 0; start < members.length; start += 24) {
      const page = members.slice(start, start + 24);
      tree[`${category}_${start / 24}`] = { description: `${category}: ${page.map(e => e.name).join(', ')}`,
        children: Object.fromEntries(page.map(e => [e.name, { name: e.name, description: `${e.displayName || e.name}${e.dimension ? ` (${e.dimension})` : ''}` }])) };
    }
  }
  return tree;
}

const CATEGORY_QUESTION = () => choice('Assuming the player wants to FIND something in the world, what kind of thing is it? A biome is an environment such as a cherry grove; a sheep is a living entity; a cherry log is a block. This locates things through exploration, without commands.', {
  biome: 'A biome or environment to visit.', entity: 'A living animal, creature or mob to find without attacking it.',
  block: 'A block or plant to locate, rather than collect.', none: 'No supported biome, living entity or block.',
});

// The category question can be asked speculatively in the same batch as the
// request interpretation; a caller that already has that answer passes it.
async function resolveDiscovery(client, registry, request, { category } = {}) {
  const root = category ? { answers: { category } } : await client.systemOne({ state: { request }, questions: { category: CATEGORY_QUESTION() } });
  const kind = root.answers?.category?.choice, judgments = [root];
  if (kind === 'none') return { target: null, judgments };
  if (!['biome', 'entity', 'block'].includes(kind)) throw new Error('Invalid discovery category');
  if (kind === 'block') {
    const resolution = await resolveItem(client, registry, request);
    return { target: registry.blocksByName[resolution.item] ? { kind, name: resolution.item } : null, judgments: [...judgments, resolution] };
  }
  let children = discoveryCatalog(registry, kind);
  for (let depth = 0; depth < 3; depth++) {
    const answer = await client.systemOne({ state: { request, targetKind: kind }, questions: { target: choice('Choose the catalog branch or exact target matching the requested biome or creature. Names and members come from this Minecraft version. Cherry biome means cherry_grove. Do not replace the requested species with a nearby alternative.', {
      ...Object.fromEntries(Object.entries(children).map(([key, node]) => [key, node.description])), none: 'No match in this catalog.',
    }) } });
    judgments.push(answer);
    const key = answer.answers?.target?.choice;
    if (key === 'none') return { target: null, judgments };
    if (!Object.hasOwn(children, key)) throw new Error('Discovery target outside the offered catalog');
    if (children[key].name) return { target: { kind, name: key }, judgments };
    children = children[key].children;
  }
  throw new Error('Discovery catalog depth exceeded');
}

function biomeAt(bot, p) {
  const biome = bot.blockAt(p)?.biome;
  // prismarine-biome captures the pre-login registry array. Modern login
  // replaces that array, leaving blocks with an ID but an empty name. Resolve
  // the received ID against the current server registry, never static IDs.
  return (bot.registry.biomes?.[biome?.id]?.name || biome?.name || '').replace('minecraft:', '');
}
const biomeDefinition = (registry, name) => registry.biomesByName[name] || registry.biomesByName[`minecraft:${name}`] || registry.biomesArray.find(b => b.name === name);
const point = p => new Vec3(p.x, p.y, p.z);

// Follow a retained heading into new terrain. The old small concentric rings
// repeatedly revisited the spawn area and could not find distant tree species.
function explorationTarget(search, resource, position) {
  if (!search.frontier) {
    const seed = [...resource].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 0);
    search.frontier = { heading: seed % 8, legs: 0 };
  }
  const state = search.frontier;
  const target = state.target && point(state.target);
  if (!target || Math.hypot(position.x - target.x, position.z - target.z) < 24 || search.walksWithoutProgress >= 3) {
    if (target && search.walksWithoutProgress >= 3) state.heading = (state.heading + 1) % 8;
    const angle = state.heading * Math.PI / 4;
    state.target = { x: Math.round(position.x + Math.cos(angle) * 512), y: position.y, z: Math.round(position.z + Math.sin(angle) * 512) };
    state.legs++; search.walksWithoutProgress = 0; delete search.progressLeg;
  }
  return point(state.target);
}

async function biomeLocations(bot, task, name) {
  const locations = [], center = bot.entity.position.floored();
  const minY = bot.game.minY ?? -64, maxY = minY + (bot.game.height ?? 384) - 1;
  // Only inspect received chunks. Never use seed prediction or server locate.
  for (let dx = -80; dx <= 80; dx += 16) {
    task.check();
    for (let dz = -80; dz <= 80; dz += 16) {
      const p = center.offset(dx, 0, dz);
      if (!bot.blockAt(p)) continue;
      // Biome identity is three-dimensional; confirm again at the standing
      // height instead of mistaking an overhead biome for one we can visit.
      if (![center.y, Math.min(maxY, center.y + 48), Math.max(minY, center.y - 48)].some(y => biomeAt(bot, new Vec3(p.x, y, p.z)) === name)) continue;
      for (let y = maxY; y >= minY; y--) {
        const floor = bot.blockAt(new Vec3(p.x, y, p.z));
        if (!floor) break;
        if (/_leaves$|_log$|_wood$/.test(floor.name)) continue;
        if (floor.boundingBox !== 'block' && floor.name !== 'water') continue;
        const stand = new Vec3(p.x, y + 1, p.z);
        if (!damagingTerrain.has(floor.name) && dryPassable(bot.blockAt(stand)) && dryPassable(bot.blockAt(stand.offset(0, 1, 0))) &&
          biomeAt(bot, stand) === name && safeFromHostiles(bot, stand)) locations.push(stand);
        break;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return locations.sort((a, b) => a.distanceTo(center) - b.distanceTo(center));
}

async function discoverStep(bot, task, goal, save, { navigate, explore, boatTravel }) {
  const target = goal.discoveryTarget;
  if (!target || !['biome', 'entity', 'block'].includes(target.kind)) throw new Error('Missing discovery target');
  const state = goal.discovery ||= { visits: 0, observed: [] };
  const dim = String(bot.game.dimension).replace('minecraft:', '').replace('the_', '');
  const required = target.kind === 'biome' && biomeDefinition(bot.registry, target.name)?.dimension?.replace('the_', '');
  if (required && required !== dim) { const error = new Error(`${target.name} is in ${required}; I am in ${dim}. Take me there, then say resume.`); error.name = 'Blocked'; throw error; }
  const finish = (position, extra = {}) => {
    state.found = { ...target, position: { ...position }, dimension: bot.game.dimension, observedAt: new Date().toISOString(), ...extra };
    goal.step = { action: 'found', ...state.found }; save(); return true;
  };
  if (target.kind === 'biome' && biomeAt(bot, bot.entity.position) === target.name) return finish(bot.entity.position);
  if (target.kind === 'entity') {
    const entries = Object.values(bot.entities).filter(e => e.name === target.name && e.isValid !== false && e.position &&
      e.position.distanceTo(bot.entity.position) <= 80).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
    const entity = entries[0];
    if (entity) {
      const hostile = /hostile/i.test(bot.registry.entitiesByName[target.name]?.category || '');
      const radius = hostile ? 24 : 4;
      const visible = () => {
        if (bot.entities[entity.id] !== entity || entity.isValid === false || entity.position.distanceTo(bot.entity.position) > radius + 2) return false;
        const eye = bot.entity.position.offset(0, 1.62, 0), delta = entity.position.offset(0, .8, 0).minus(eye);
        const hit = bot.world?.raycast?.(eye, delta.unit(), delta.norm());
        return !hit || eye.distanceTo(hit.intersect || hit.position) >= delta.norm() - 1;
      };
      if (visible()) return finish(entity.position, { entityId: entity.id });
      goal.step = { action: 'approach_found_creature', entity: target.name, position: { ...entity.position } }; save();
      await navigate(bot, task, new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, radius), { timeoutMs: 12000, stallMs: 4000, stopWhen: visible });
      if (visible()) return finish(entity.position, { entityId: entity.id });
      return false;
    }
  }
  let candidates = [];
  if (target.kind === 'biome') candidates = await biomeLocations(bot, task, target.name);
  if (target.kind === 'block') {
    const id = bot.registry.blocksByName[target.name]?.id;
    candidates = id === undefined ? [] : bot.findBlocks({ matching: id, maxDistance: 96, count: 16 });
    const near = candidates.find(p => p.distanceTo(bot.entity.position) <= 6 && (!bot.canSeeBlock || bot.canSeeBlock(bot.blockAt(p))));
    if (near) return finish(near);
  }
  state.observed = candidates.slice(0, 16).map(p => ({ ...p })); save();
  if (candidates[0] && boatTravel && await boatTravel(candidates[0])) return false;
  const policy = target.kind === 'biome' ? surfaceMovement(bot) : null;
  try {
    for (const p of candidates.slice(0, 8)) {
      if (!safeFromHostiles(bot, p)) continue;
      const destination = target.kind === 'biome' ? new goals.GoalBlock(p.x, p.y, p.z) : new goals.GoalNear(p.x, p.y, p.z, 3);
      const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 500);
      if (route.status !== 'success') continue;
      goal.step = { action: 'approach_discovery', ...target, position: { ...p } }; save();
      await navigate(bot, task, destination, { timeoutMs: 20000, stallMs: 5000 });
      // The next step verifies the living entity/biome/block again.
      return false;
    }
  } finally { policy?.restore(); }
  state.visits++;
  goal.step = { action: 'explore', ...target, currentBiome: biomeAt(bot, bot.entity.position), visits: state.visits }; save();
  await explore(bot, task, goal, save, `discover:${target.kind}:${target.name}`, { surfaceOnly: true, frontier: true });
  return false;
}

module.exports = { CATEGORY_QUESTION, discoveryCatalog, resolveDiscovery, biomeAt, biomeLocations, explorationTarget, discoverStep };

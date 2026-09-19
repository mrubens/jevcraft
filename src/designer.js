'use strict';
const { Vec3 } = require('vec3');
const { surfaceObserver } = require('./surface');
const { checkAir } = require('./vitals');
const { regionProperties, buildFootprint, matchesOwnership } = require('./build-blocks');
const { isDoor, isWoodenDoor } = require('./doors');
const MODEL = 'anthropic/claude-fable-5.1';
const LIMITS = { width: 25, height: 16, depth: 25, regions: 256, blocks: 6000 };
const vectorSchema = { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 };
const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['name', 'description', 'size', 'palette', 'regions', 'entrance'], properties: {
    name: { type: 'string' }, description: { type: 'string' }, size: vectorSchema,
    palette: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 16 },
    regions: { type: 'array', minItems: 1, maxItems: LIMITS.regions, items: { type: 'object', additionalProperties: false,
      required: ['from', 'to', 'block', 'properties'], properties: { from: vectorSchema, to: vectorSchema, block: { type: 'string' },
        properties: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['facing', 'half'], properties: {
          facing: { anyOf: [{ type: 'string', enum: ['north', 'east', 'south', 'west'] }, { type: 'null' }] },
          half: { anyOf: [{ type: 'string', enum: ['top', 'bottom'] }, { type: 'null' }] },
        } }] } } } },
    entrance: { anyOf: [vectorSchema, { type: 'null' }] },
  } };
const replaceable = b => b && (['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'leaf_litter', 'snow', 'vine'].includes(b.name) || /_leaves$|_log$/.test(b.name));
const naturalGround = b => b?.boundingBox === 'block' && /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|stone|deepslate|granite|diorite|andesite|tuff|sand|red_sand|gravel|sandstone|red_sandstone|terracotta)$/.test(b.name);

// Restrict the designer to geometry the current placement executor can verify
// exactly. Stairs/slabs and wooden doors carry explicit states; gravity
// blocks, fluids and commands are not treated as ordinary solid cubes.
function buildPalette(registry) {
  return registry.blocksArray.filter(b => registry.itemsByName[b.name] && b.boundingBox === 'block' &&
    b.diggable !== false && b.hardness >= 0 &&
    (/_(planks|concrete|terracotta|wool|bricks|stained_glass|stairs|slab)$/.test(b.name) || isWoodenDoor(registry, b.name) ||
      ['glass', 'stone', 'smooth_stone', 'cobblestone', 'mossy_cobblestone', 'bricks', 'quartz_block', 'smooth_quartz',
        'sandstone', 'smooth_sandstone', 'red_sandstone', 'polished_andesite', 'polished_diorite', 'polished_granite',
        'dirt', 'terracotta', 'sea_lantern', 'glowstone', 'diamond_block', 'iron_block', 'gold_block', 'emerald_block', 'copper_block', 'lapis_block', 'coal_block', 'redstone_block', 'netherite_block'].includes(b.name))).map(b => b.name).sort();
}
const vec = a => new Vec3(...a);
function validateSchematic(input, registry) {
  const fail = message => { throw new Error(`Invalid building schematic: ${message}`); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('expected an object');
  if (Object.keys(input).some(k => !SCHEMA.required.includes(k))) fail('unknown top-level field');
  for (const key of ['name', 'description']) if (typeof input[key] !== 'string' || input[key].length > 800) fail(`invalid ${key}`);
  const vector = (v, label) => { if (!Array.isArray(v) || v.length !== 3 || v.some(n => !Number.isInteger(n))) fail(`invalid ${label}`); };
  vector(input.size, 'size');
  if (input.size.some((n, i) => n < 3 || n > [LIMITS.width, LIMITS.height, LIMITS.depth][i])) fail('dimensions exceed build limits');
  const palette = new Set([...buildPalette(registry), 'air']);
  if (!Array.isArray(input.palette) || !input.palette.length || input.palette.length > 16 || input.palette.some(n => !palette.has(n))) fail(`unsupported block palette: ${input.palette?.filter?.(n => !palette.has(n)).join(', ') || 'invalid palette'}`);
  if (!Array.isArray(input.regions) || !input.regions.length || input.regions.length > LIMITS.regions) fail('invalid region count');
  const cells = new Map(), key = p => `${p.x},${p.y},${p.z}`;
  for (const region of input.regions) {
    if (!region || Object.keys(region).some(k => !['from', 'to', 'block', 'properties'].includes(k))) fail('invalid region');
    vector(region.from, 'region from'); vector(region.to, 'region to');
    if (region.from.some((n, i) => n < 0 || region.to[i] < n || region.to[i] >= input.size[i])) fail('region out of bounds');
    if (region.block !== 'air' && !input.palette.includes(region.block)) fail('region block not in palette');
    let properties;
    try { properties = regionProperties(region.block, region.properties); } catch (err) { fail(err.message); }
    if (properties && region.from[1] === 0) fail('oriented blocks need a full-block foundation below y=1');
    for (let x = region.from[0]; x <= region.to[0]; x++) for (let y = region.from[1]; y <= region.to[1]; y++) for (let z = region.from[2]; z <= region.to[2]; z++) {
      const p = { x, y, z };
      if (region.block === 'air') cells.delete(key(p)); else cells.set(key(p), { ...p, material: region.block, ...(properties && { properties }) });
    }
  }
  for (const cell of [...cells.values()].filter(p => isDoor(p.material))) {
    const upper = buildFootprint(cell)[1], floor = cells.get(key({ ...cell, y: cell.y - 1 }));
    if (upper.y >= input.size[1] || cells.has(key(upper))) fail('a door needs a free cell above its bottom position');
    if (!floor || floor.properties) fail('a door needs a full-block floor directly below it');
    cells.set(key(upper), upper);
  }
  if (!cells.size || cells.size > LIMITS.blocks) fail('invalid total block count');
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const connected = new Set(), queue = [...cells.values()].filter(p => p.y === 0);
  if (!queue.length) fail('no foundation');
  for (const p of queue) connected.add(key(p));
  for (let i = 0; i < queue.length; i++) for (const d of directions) {
    const p = vec(d).plus(queue[i]), k = key(p);
    if (cells.has(k) && !connected.has(k)) { connected.add(k); queue.push(cells.get(k)); }
  }
  if (connected.size !== cells.size) fail('floating disconnected blocks');
  let access = null;
  const notes = [];
  if (input.entrance !== null) {
    vector(input.entrance, 'entrance');
    const e = vec(input.entrance);
    if (input.entrance.some((n, i) => n < 0 || n >= input.size[i]) || e.y < 1 || e.y + 1 >= input.size[1]) fail('entrance must be inside the build bounds with standing headroom');
    const passable = p => !cells.has(key(p)) || isDoor(cells.get(key(p)).material);
    if (!passable(e) || !passable(e.offset(0, 1, 0)) || !cells.has(key(e.offset(0, -1, 0)))) fail('entrance needs a floor and two clear blocks or a wooden door');
    // Access informs placement and quality diagnostics. Interior/roof design
    // belongs to the designer; this approximate walk graph is not a veto on it.
    const walkable = p => p.x >= 0 && p.z >= 0 && p.x < input.size[0] && p.z < input.size[2] && p.y >= 1 && p.y + 1 < input.size[1] &&
      cells.has(key(p.offset(0, -1, 0))) && !isDoor(cells.get(key(p.offset(0, -1, 0))).material) && passable(p) && passable(p.offset(0, 1, 0));
    const reached = new Set([key(e)]), walking = [e];
    for (let i = 0; i < walking.length; i++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [-1, 0, 1]) {
      const p = walking[i], next = p.offset(dx, dy, dz), k = key(next);
      const allowsDoor = q => { const c = cells.get(key(q)); return !isDoor(c?.material) || dy === 0 && (['north', 'south'].includes(c.properties.facing) ? dx === 0 : dz === 0); };
      if (!reached.has(k) && walkable(next) && allowsDoor(p) && allowsDoor(next) && (dy <= 0 || !cells.has(key(p.offset(0, 2, 0))))) { reached.add(k); walking.push(next); }
    }
    // Pyramids, porches and inset facades have real doors inside their bounding
    // box. Require an actual walkable path to its edge, not a particular index.
    access = walking.find(p => [0, input.size[0] - 1].includes(p.x) || [0, input.size[2] - 1].includes(p.z));
    if (!access) fail('entrance has no walkable route to the exterior edge');
    const inaccessible = {};
    for (let x = 1; x < input.size[0] - 1; x++) for (let y = 1; y < input.size[1] - 1; y++) for (let z = 1; z < input.size[2] - 1; z++) {
      const p = new Vec3(x, y, z);
      if (walkable(p) && !reached.has(key(p))) inaccessible[y] = (inaccessible[y] || 0) + 1;
    }
    const blockedFloor = Object.entries(inaccessible).find(([, count]) => count >= 9);
    if (blockedFloor) notes.push({ kind: 'accessibility', y: Number(blockedFloor[0]), standingCells: blockedFloor[1],
      message: 'Some upper surfaces have no walking route from the entrance. They may be roof or decorative areas; this does not prevent construction.' });
  }
  const blocks = [...cells.values()];
  const empty = [];
  for (let x = 0; x < input.size[0]; x++) for (let y = 0; y < input.size[1]; y++) for (let z = 0; z < input.size[2]; z++) {
    if (!cells.has(`${x},${y},${z}`)) empty.push({ x, y, z });
  }
  const materials = blocks.filter(p => !p.companion).reduce((m, p) => { m[p.material] = (m[p.material] || 0) + 1; return m; }, {});
  return { source: input, blocks, empty, materials, notes, access: access && [access.x, access.y, access.z] };
}

function surveyForDesign(bot) {
  const o = bot.entity.position.floored(), terrain = [];
  for (let dx = -24; dx <= 24; dx += 4) for (let dz = -24; dz <= 24; dz += 4) {
    for (let y = o.y + 12; y >= o.y - 12; y--) {
      const p = o.offset(dx, y - o.y, dz), b = bot.blockAt(p);
      if (!b) break;
      if (naturalGround(b) && replaceable(bot.blockAt(p.offset(0, 1, 0)))) { terrain.push({ dx, dz, groundY: y, block: b.name }); break; }
    }
  }
  const nearby = new Set(terrain.map(cell => cell.block));
  const ids = bot.registry.blocksArray.filter(b => /_log$|^(stone|sand|red_sand|sandstone|red_sandstone|dirt)$/.test(b.name)).map(b => b.id);
  for (const p of bot.findBlocks?.({ matching: ids, maxDistance: 32, count: 64 }) || []) nearby.add(bot.blockAt(p)?.name);
  const stock = Object.fromEntries(bot.inventory.items().map(i => [i.name, 0]));
  for (const i of bot.inventory.items()) stock[i.name] += i.count;
  const local = new Set(Object.keys(stock).filter(name => buildPalette(bot.registry).includes(name)));
  for (const name of new Set([...nearby, ...Object.keys(stock)])) if (name?.endsWith('_log')) local.add(name.replace('_log', '_planks'));
  if (nearby.has('stone')) local.add('cobblestone');
  if (nearby.has('sand')) local.add('sandstone');
  if (nearby.has('red_sand')) local.add('red_sandstone');
  if (nearby.has('dirt')) local.add('dirt');
  for (const name of [...local]) for (const suffix of ['stairs', 'slab', 'door']) {
    const variant = `${name.replace(/_planks$/, '')}_${suffix}`;
    if (buildPalette(bot.registry).includes(variant)) local.add(variant);
  }
  const { planCatalog } = require('./knowledge');
  const materialGuide = [...local].map(block => {
    try {
      const plan = planCatalog(bot.registry, block, 64, stock, { nearby: [...nearby] });
      return { block, carried: stock[block] || 0, for64Blocks: plan.map(s => ({ action: s.action, item: s.item || s.drops, count: s.count })) };
    } catch { return { block, carried: stock[block] || 0, acquisition: 'No executable acquisition plan; use only what is carried' }; }
  });
  return { dimension: bot.game.dimension, gameMode: bot.game.gameMode, position: { ...o }, terrain,
    materials: { locallyObservedSources: [...nearby], practicalPalette: materialGuide,
      catalogMeaning: 'availableBlocks lists supported block types, NOT supplies available here. Unlisted decorative materials may require distant biomes or another dimension.' },
    inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })), limits: LIMITS, availableBlocks: buildPalette(bot.registry) };
}

async function designBuilding(bot, task, request, { fetchImpl = fetch, apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.OPENROUTER_BUILD_MODEL || MODEL, previousDraft, feedback, memory } = {}) {
  if (!apiKey) { const e = new Error('Building designer needs OPENROUTER_API_KEY in the local .env'); e.name = 'Blocked'; throw e; }
  const world = surveyForDesign(bot), controller = new AbortController();
  const schema = structuredClone(SCHEMA);
  const allowed = [...world.availableBlocks, 'air'];
  schema.properties.palette.items.enum = allowed;
  schema.properties.regions.items.properties.block.enum = allowed;
  const timer = setTimeout(() => controller.abort(new Error('Building designer timed out')), 180000);
  const watcher = setInterval(() => { try { task.check(); checkAir(bot); } catch (e) { controller.abort(e); } }, 100);
  try {
    task.check();
    const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 10000, reasoning: { effort: 'low' }, provider: { require_parameters: true },
        messages: [{ role: 'system', content: `Design an attractive, usable Minecraft structure matching the player request. Return only a schematic, never commands or code. Coordinates are local [x,y,z] inside size. Regions are inclusive filled cuboids, applied in order; air carves openings. Unspecified cells are air. Use only availableBlocks, at most 16 palette entries and ${LIMITS.regions} regions; dimensions at most 25x16x25 and at most ${LIMITS.blocks} solid blocks. All solid components must connect to a foundation at y=0. Follow the requested shape rather than forcing every structure to be a house. Include floors, walls, a roof, windows and walkable interiors only when appropriate. Sculptures, monuments, arches and other structures need not have rooms or a doorway: use entrance:null when the structure is not meant to be entered. For structures meant to be entered, provide a usable entrance. In Survival, use world.materials.practicalPalette for the main structure unless the request specifies another material. The for64Blocks recipes show the real gathering effort: prefer abundant carried supplies or cheap local materials. For an ordinary request without a size, aim for 80-200 solid blocks total; spend detail on shape, proportions and openings, not large bulk. Larger explicitly requested builds may use the full limits. Do not add Nether-only blocks, rare biome blocks, or smelted decorative variants unless the player requested them or enough are already carried. If a light block is not locally practical, leave a window/skylight instead. These are design choices, not reasons to ask the player questions. Make mansions visibly larger and architecturally richer than simple houses, with connected rooms and a usable entrance. For an enterable structure, reserve a two-block-high entrance opening at y>=1 with a floor directly beneath it; entrance gives its bottom air cell. Inset entrances are allowed when a supported, two-block-high walking route reaches an exterior edge of the bounding box. Every interior floor must be reachable from the entrance by walking and one-block jumps; carve the floor above each staircase to leave jumping headroom over the current step as well as the destination. Stairs and slabs are available. Every stair region needs properties:{facing:"north"|"east"|"south"|"west",half:"bottom"|"top"}. Facing points toward the high side of bottom stairs (north=-z, south=+z, east=+x, west=-x). Every slab region needs properties:{facing:null,half:"bottom"|"top"}. Other blocks use properties:null. Stair corners join automatically; do not specify shape, waterlogging or double slabs. Use full blocks for structural supports and entrance floors; stairs/slabs are useful for steps, roofs and trim. Wooden doors are available. A door region specifies only its lower cell, with properties:{facing:"north"|"east"|"south"|"west",half:null}. Code adds the upper cell and counts one inventory door for the pair. Leave the cell above it free and put a full block directly below it. Facing follows the walking direction through the doorway, for example south for entering from a north wall. A usable entrance may contain a door. Do not specify hinges, open states, or upper door halves; Minecraft handles them. Design compactly with cuboids rather than listing thousands of individual blocks. The surveyed terrain informs the scale and style; code will choose and revalidate a nearby supported site.` },
          { role: 'user', content: JSON.stringify({ request, world, memory }) },
          ...(previousDraft ? [{ role: 'assistant', content: JSON.stringify(previousDraft) },
            { role: 'user', content: `The schematic failed validation: ${feedback}. Correct this issue while preserving the requested structure and materials. Do not replace it with a different building type. Check all geometry, connections, entrance access and walkable interior floors before returning it. Return the full corrected schematic.` }] : [])],
        response_format: { type: 'json_schema', json_schema: { name: 'minecraft_schematic', strict: true, schema } } }),
    });
    if (!response.ok) throw new Error(`Building designer request failed (${response.status})`);
    const result = await response.json(); task.check();
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Building designer returned no schematic');
    if (content.length > 200000) throw new Error('Building designer response exceeded the schematic size limit');
    const draft = JSON.parse(content);
    let validated;
    try { validated = validateSchematic(draft, bot.registry); }
    catch (err) { err.draft = draft; throw err; }
    return { ...validated, model, createdAt: new Date().toISOString(), usage: result.usage, world };
  } finally { clearTimeout(timer); clearInterval(watcher); }
}

function selectSchematicSite(bot, schematic) {
  const o = bot.entity.position.floored(), [width, height, depth] = schematic.source.size;
  const isSurface = surfaceObserver(bot);
  const positions = [];
  for (const dx of [5, -width - 5, 12, -width - 12]) for (const dz of [5, -depth - 5, 12, -depth - 12]) positions.push(o.offset(dx, 0, dz));
  for (const candidate of positions) {
    const ground = new Map();
    for (let x = 0; x < width; x++) for (let z = 0; z < depth; z++) {
      for (let y = o.y + 4; y >= o.y - 4; y--) {
        const p = new Vec3(candidate.x + x, y, candidate.z + z);
        if (naturalGround(bot.blockAt(p)) && replaceable(bot.blockAt(p.offset(0, 1, 0))) && isSurface(p.offset(0, 1, 0))) { ground.set(`${x},${z}`, y); break; }
      }
    }
    if (ground.size !== width * depth) continue;
    const baseY = Math.max(...ground.values());
    if (baseY - Math.min(...ground.values()) > 3) continue;
    const origin = new Vec3(candidate.x, baseY, candidate.z);
    const blocks = schematic.blocks.map(p => ({ ...p, ...origin.offset(p.x, p.y, p.z) }));
    // Unspecified foundation cells retain natural terrain rather than leaving
    // a moat around an inset facade. Air above the ground is verified exactly.
    const empty = schematic.empty.map(p => ({ ...origin.offset(p.x, p.y, p.z) }))
      .filter(p => p.y > ground.get(`${p.x - origin.x},${p.z - origin.z}`));
    if ([...blocks, ...empty].some(p => p.y > ground.get(`${p.x - origin.x},${p.z - origin.z}`) && !replaceable(bot.blockAt(new Vec3(p.x, p.y, p.z))))) continue;
    for (const p of schematic.blocks.filter(p => p.y === 0)) for (let y = ground.get(`${p.x},${p.z}`) + 1; y < baseY; y++) {
      blocks.push({ x: origin.x + p.x, y, z: origin.z + p.z, material: p.properties ? 'cobblestone' : p.material });
    }
    const e = vec(schematic.access || schematic.source.entrance || [Math.floor(width / 2), 1, 0]), direction = e.z === 0 ? new Vec3(0, 0, -1) : e.z === depth - 1 ? new Vec3(0, 0, 1) : e.x === 0 ? new Vec3(-1, 0, 0) : new Vec3(1, 0, 0);
    const entrance = origin.plus(e).plus(direction);
    if (!replaceable(bot.blockAt(entrance)) || !replaceable(bot.blockAt(entrance.offset(0, 1, 0))) || !naturalGround(bot.blockAt(entrance.offset(0, -1, 0)))) continue;
    const initialBlocks = {};
    for (const p of [...blocks, ...empty]) {
      const b = bot.blockAt(new Vec3(p.x, p.y, p.z));
      if (b && !['air', 'cave_air', 'void_air'].includes(b.name)) initialBlocks[`${p.x},${p.y},${p.z}`] = b.stateId ?? b.name;
    }
    return { origin: { ...origin }, blocks, empty, entrance: { ...entrance }, initialBlocks,
      bounds: { min: { x: origin.x, y: baseY - 3, z: origin.z }, max: { x: origin.x + width - 1, y: baseY + height - 1, z: origin.z + depth - 1 } } };
  }
  return require('./build-terrain').planTerrainSite(bot, schematic, { naturalGround, replaceable });
}
function canClearSchematicBlock(blueprint, owned, block) {
  if (!block) return false;
  if (['air', 'cave_air', 'void_air'].includes(block.name)) return true;
  const p = block.position, key = `${p.x},${p.y},${p.z}`, state = block.stateId ?? block.name;
  // Ordinary water flow and covered grass changing to dirt are natural state
  // changes during earthworks, not newly placed player construction.
  const original = blueprint.initialNames?.[key];
  if (original === 'water' && block.name === 'water' || original === 'grass_block' && block.name === 'dirt') return true;
  return blueprint.initialBlocks?.[key] === state || matchesOwnership(block, owned?.[key]);
}
function schematicScaffolding(bot, goal) {
  const { blueprint, buildOwned = {} } = goal;
  if (!blueprint.bounds) return [];
  const planned = new Set(blueprint.blocks.map(p => `${p.x},${p.y},${p.z}`));
  const { min, max } = blueprint.bounds;
  return Object.entries(buildOwned).flatMap(([key, state]) => {
    const p = new Vec3(...key.split(',').map(Number));
    if (planned.has(key) || p.x < min.x - 3 || p.x > max.x + 3 || p.z < min.z - 3 || p.z > max.z + 3 || p.y < min.y || p.y > max.y + 3) return [];
    const block = bot.blockAt(p);
    return ['dirt', 'cobblestone'].includes(block?.name) && (block.stateId ?? block.name) === state ? [{ ...p }] : [];
  });
}
module.exports = { MODEL, LIMITS, SCHEMA, buildPalette, validateSchematic, surveyForDesign, designBuilding, selectSchematicSite, canClearSchematicBlock, schematicScaffolding };

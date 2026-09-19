'use strict';
const { Vec3 } = require('vec3');
const { surfaceObserver } = require('./surface');
const { checkAir } = require('./vitals');
const MODEL = 'anthropic/claude-fable-5.1';
const LIMITS = { width: 25, height: 16, depth: 25, regions: 256, blocks: 6000 };
const vectorSchema = { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 };
const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['name', 'description', 'size', 'palette', 'regions', 'entrance'], properties: {
    name: { type: 'string' }, description: { type: 'string' }, size: vectorSchema,
    palette: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 16 },
    regions: { type: 'array', minItems: 1, maxItems: LIMITS.regions, items: { type: 'object', additionalProperties: false,
      required: ['from', 'to', 'block'], properties: { from: vectorSchema, to: vectorSchema, block: { type: 'string' } } } },
    entrance: { anyOf: [vectorSchema, { type: 'null' }] },
  } };
const replaceable = b => b && (['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'leaf_litter', 'snow', 'vine'].includes(b.name) || /_leaves$|_log$/.test(b.name));
const naturalGround = b => b?.boundingBox === 'block' && /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|stone|deepslate|granite|diorite|andesite|tuff|sand|red_sand|gravel|sandstone|red_sandstone|terracotta)$/.test(b.name);

// Restrict the designer to geometry the current placement executor can verify
// exactly. Oriented doors/stairs, gravity blocks, fluids and commands are not
// silently treated as ordinary solid cubes.
function buildPalette(registry) {
  return registry.blocksArray.filter(b => registry.itemsByName[b.name] && b.boundingBox === 'block' &&
    b.diggable !== false && b.hardness >= 0 &&
    (/_(planks|concrete|terracotta|wool|bricks|stained_glass)$/.test(b.name) ||
      ['glass', 'stone', 'smooth_stone', 'cobblestone', 'mossy_cobblestone', 'bricks', 'quartz_block', 'smooth_quartz',
        'sandstone', 'smooth_sandstone', 'red_sandstone', 'polished_andesite', 'polished_diorite', 'polished_granite',
        'dirt', 'terracotta', 'sea_lantern', 'glowstone'].includes(b.name))).map(b => b.name).sort();
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
    if (!region || Object.keys(region).some(k => !['from', 'to', 'block'].includes(k))) fail('invalid region');
    vector(region.from, 'region from'); vector(region.to, 'region to');
    if (region.from.some((n, i) => n < 0 || region.to[i] < n || region.to[i] >= input.size[i])) fail('region out of bounds');
    if (region.block !== 'air' && !input.palette.includes(region.block)) fail('region block not in palette');
    for (let x = region.from[0]; x <= region.to[0]; x++) for (let y = region.from[1]; y <= region.to[1]; y++) for (let z = region.from[2]; z <= region.to[2]; z++) {
      const p = { x, y, z };
      if (region.block === 'air') cells.delete(key(p)); else cells.set(key(p), { ...p, material: region.block });
    }
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
  if (input.entrance !== null) {
    vector(input.entrance, 'entrance');
    const e = vec(input.entrance);
    if (input.entrance.some((n, i) => n < 0 || n >= input.size[i]) || e.y < 1 || e.y + 1 >= input.size[1]) fail('entrance must be inside the build bounds with standing headroom');
    if (cells.has(key(e)) || cells.has(key(e.offset(0, 1, 0))) || !cells.has(key(e.offset(0, -1, 0)))) fail('entrance needs a floor and two clear blocks');
    // Check ordinary walking/jumping access, including jump headroom. A pretty
    // upper floor with a staircase blocked by its own ceiling is not usable.
    const walkable = p => p.x >= 0 && p.z >= 0 && p.x < input.size[0] && p.z < input.size[2] && p.y >= 1 && p.y + 1 < input.size[1] &&
      cells.has(key(p.offset(0, -1, 0))) && !cells.has(key(p)) && !cells.has(key(p.offset(0, 1, 0)));
    const reached = new Set([key(e)]), walking = [e];
    for (let i = 0; i < walking.length; i++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [-1, 0, 1]) {
      const p = walking[i], next = p.offset(dx, dy, dz), k = key(next);
      if (!reached.has(k) && walkable(next) && (dy <= 0 || !cells.has(key(p.offset(0, 2, 0))))) { reached.add(k); walking.push(next); }
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
    if (blockedFloor) fail(`unreachable interior floor at y=${blockedFloor[0]} (${blockedFloor[1]} standing cells). Connect every room/floor to the entrance with one-block steps and clear two-block standing/jumping headroom above each stair; carve the upper floor over the stairs`);
  }
  const blocks = [...cells.values()];
  const empty = [];
  for (let x = 0; x < input.size[0]; x++) for (let y = 0; y < input.size[1]; y++) for (let z = 0; z < input.size[2]; z++) {
    if (!cells.has(`${x},${y},${z}`)) empty.push({ x, y, z });
  }
  const materials = blocks.reduce((m, p) => { m[p.material] = (m[p.material] || 0) + 1; return m; }, {});
  return { source: input, blocks, empty, materials, access: access && [access.x, access.y, access.z] };
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
  return { dimension: bot.game.dimension, gameMode: bot.game.gameMode, position: { ...o }, terrain,
    inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })), limits: LIMITS, availableBlocks: buildPalette(bot.registry) };
}

async function designBuilding(bot, task, request, { fetchImpl = fetch, apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.OPENROUTER_BUILD_MODEL || MODEL, previousDraft, feedback } = {}) {
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
        messages: [{ role: 'system', content: `Design an attractive, usable Minecraft structure matching the player request. Return only a schematic, never commands or code. Coordinates are local [x,y,z] inside size. Regions are inclusive filled cuboids, applied in order; air carves openings. Unspecified cells are air. Use only availableBlocks, at most 16 palette entries and ${LIMITS.regions} regions; dimensions at most 25x16x25 and at most ${LIMITS.blocks} solid blocks. All solid components must connect to a foundation at y=0. Follow the requested shape rather than forcing every structure to be a house. Include floors, walls, a roof, windows and walkable interiors only when appropriate. Sculptures, monuments, arches and other structures need not have rooms or a doorway: use entrance:null when the structure is not meant to be entered. For structures meant to be entered, provide a usable entrance. In Survival, prefer common locally available materials and modest scale unless the user explicitly asks for rare materials or a huge build; do not add Nether-only decorative materials by default. Make mansions visibly larger and architecturally richer than simple houses, with connected rooms and a usable entrance. For an enterable structure, reserve a two-block-high entrance opening at y>=1 with a floor directly beneath it; entrance gives its bottom air cell. Inset entrances are allowed when a supported, two-block-high walking route reaches an exterior edge of the bounding box. Every interior floor must be reachable from the entrance by walking and one-block jumps; carve the floor above each staircase to leave jumping headroom over the current step as well as the destination. Use full-block stepped roof/stair geometry when needed; oriented block states and doors are not available in this executor. Design compactly with cuboids rather than listing thousands of individual blocks. The surveyed terrain informs the scale and style; code will choose and revalidate a nearby supported site.` },
          { role: 'user', content: JSON.stringify({ request, world }) },
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
    const blocks = schematic.blocks.map(p => ({ ...origin.offset(p.x, p.y, p.z), material: p.material }));
    // Unspecified foundation cells retain natural terrain rather than leaving
    // a moat around an inset facade. Air above the ground is verified exactly.
    const empty = schematic.empty.map(p => ({ ...origin.offset(p.x, p.y, p.z) }))
      .filter(p => p.y > ground.get(`${p.x - origin.x},${p.z - origin.z}`));
    if ([...blocks, ...empty].some(p => p.y > ground.get(`${p.x - origin.x},${p.z - origin.z}`) && !replaceable(bot.blockAt(new Vec3(p.x, p.y, p.z))))) continue;
    for (const p of schematic.blocks.filter(p => p.y === 0)) for (let y = ground.get(`${p.x},${p.z}`) + 1; y < baseY; y++) {
      blocks.push({ x: origin.x + p.x, y, z: origin.z + p.z, material: p.material });
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
  return null;
}
function canClearSchematicBlock(blueprint, owned, block) {
  if (!block) return false;
  if (['air', 'cave_air', 'void_air'].includes(block.name)) return true;
  const p = block.position, key = `${p.x},${p.y},${p.z}`, state = block.stateId ?? block.name;
  return blueprint.initialBlocks?.[key] === state || owned?.[key] === state;
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
    return block?.name === 'dirt' && (block.stateId ?? block.name) === state ? [{ ...p }] : [];
  });
}
module.exports = { MODEL, LIMITS, SCHEMA, buildPalette, validateSchematic, surveyForDesign, designBuilding, selectSchematicSite, canClearSchematicBlock, schematicScaffolding };

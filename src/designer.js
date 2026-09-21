'use strict';
const { Vec3 } = require('vec3');
const { surfaceObserver } = require('./surface');
const { checkAir } = require('./vitals');
const { regionProperties, buildFootprint, matchesOwnership } = require('./build-blocks');
const { isDoor, isWoodenDoor } = require('./doors');
const { thinking } = require('./speech');
const MODEL = 'anthropic/claude-fable-5.1';
const LIMITS = { width: 25, height: 16, depth: 25, regions: 256, blocks: 6000 };
const CEILING = { width: 48, height: 32, depth: 48, regions: 256, blocks: 12000 };
const SECONDS_PER_BLOCK = 1.2;
// How far around itself Jev reports the lie of the land, and how finely. A
// 48-block window was no room to choose in when the building itself came out
// 41 across, which is how a castle ended up with nowhere flat to stand.
//
// Writing the heightmap as plain rows rather than one JSON object per sample
// is what makes this affordable at all. It is still the largest thing Jev
// says: dense numeric text tokenizes at roughly 1.4 characters per token, not
// the ~3.6 of prose, so every sample costs a token or two however tersely it
// is written. Measured against a real design call, every block for sixty-four
// in each direction came to about 46k of a 57k-token prompt, and prompt
// processing is most of the wait before Jev can say anything.
//
// Every other block is a quarter of the samples for a quarter of the cost, and
// still sixteen times the density this started at. Ground between two samples
// two blocks apart holds no surprise worth forty thousand tokens.
// Surface materials change far more slowly again, so they are sampled every
// MATERIAL_EVERY heights instead of at every one.
const SURVEY = { radius: 64, step: 2, depth: 24 };
const MATERIAL_EVERY = 4;
const vectorSchema = { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 };
const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['name', 'description', 'size', 'palette', 'regions', 'entrance', 'existingOffset', 'site'], properties: {
    name: { type: 'string' }, description: { type: 'string' }, size: vectorSchema,
    palette: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 16 },
    regions: { type: 'array', minItems: 1, maxItems: CEILING.regions, items: { type: 'object', additionalProperties: false,
      required: ['from', 'to', 'block', 'properties'], properties: { from: vectorSchema, to: vectorSchema, block: { type: 'string' },
        properties: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['facing', 'half'], properties: {
          facing: { anyOf: [{ type: 'string', enum: ['north', 'east', 'south', 'west'] }, { type: 'null' }] },
          half: { anyOf: [{ type: 'string', enum: ['top', 'bottom'] }, { type: 'null' }] },
        } }] } } } },
    entrance: { anyOf: [vectorSchema, { type: 'null' }] },
    existingOffset: { anyOf: [vectorSchema, { type: 'null' }] },
    site: { anyOf: [vectorSchema, { type: 'null' }] },
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
function occupiedByBody(bot, cells) {
  const bodies = Object.values(bot.entities || {})
    .filter(e => e !== bot.entity && e.position && e.name !== 'item' && e.isValid !== false);
  if (!bodies.length) return false;
  const half = 0.35;
  return cells.some(p => bodies.some(e =>
    e.position.x + half > p.x && e.position.x - half < p.x + 1 &&
    e.position.z + half > p.z && e.position.z - half < p.z + 1 &&
    e.position.y + (e.height || 1.8) > p.y && e.position.y < p.y + 1));
}
function validateSchematic(input, registry) {
  const fail = message => { throw new Error(`Invalid building schematic: ${message}`); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('expected an object');
  if (Object.keys(input).some(k => !SCHEMA.required.includes(k))) fail('unknown top-level field');
  for (const key of ['name', 'description']) if (typeof input[key] !== 'string' || input[key].length > 800) fail(`invalid ${key}`);
  const vector = (v, label) => { if (!Array.isArray(v) || v.length !== 3 || v.some(n => !Number.isInteger(n))) fail(`invalid ${label}`); };
  vector(input.size, 'size');
  const caps = [CEILING.width, CEILING.height, CEILING.depth], axes = ['width', 'height', 'depth'];
  input.size.forEach((n, i) => {
    if (n > caps[i]) fail(`${axes[i]} is ${n}, and the most Jev can build is ${caps[i]}`);
    if (n < 1) fail(`${axes[i]} is ${n}, and every dimension must be at least 1`);
  });
  const palette = new Set([...buildPalette(registry), 'air']);
  if (!Array.isArray(input.palette) || !input.palette.length || input.palette.length > 16 || input.palette.some(n => !palette.has(n))) fail(`unsupported block palette: ${input.palette?.filter?.(n => !palette.has(n)).join(', ') || 'invalid palette'}`);
  if (!Array.isArray(input.regions) || !input.regions.length || input.regions.length > CEILING.regions) fail('invalid region count');
  const cells = new Map(), carved = new Set(), key = p => `${p.x},${p.y},${p.z}`;
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
      if (region.block === 'air') { cells.delete(key(p)); carved.add(key(p)); }
      else { carved.delete(key(p)); cells.set(key(p), { ...p, material: region.block, ...(properties && { properties }) }); }
    }
  }
  for (const cell of [...cells.values()].filter(p => isDoor(p.material))) {
    const upper = buildFootprint(cell)[1], floor = cells.get(key({ ...cell, y: cell.y - 1 }));
    if (upper.y >= input.size[1] || cells.has(key(upper))) fail('a door needs a free cell above its bottom position');
    if (!floor || floor.properties) fail('a door needs a full-block floor directly below it');
    cells.set(key(upper), upper);
  }
  if (!cells.size || cells.size > CEILING.blocks) fail(`that is ${cells.size} blocks, and the most Jev can build is ${CEILING.blocks}`);
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
  // An edit redraws a whole building, so it reports where the existing one
  // sits inside its new bounds. That is what lets the result be placed over
  // the real thing instead of beside it, and what makes removal expressible:
  // anything left out of the new drawing is cleared away.
  // Where on the surveyed ground this building wants to stand, as the same
  // [dx, dz] the terrain grid uses.
  let site = null;
  if (Array.isArray(input.site)) {
    if (input.site.length !== 3 || input.site.some(n => !Number.isInteger(n)) || Math.abs(input.site[0]) > SURVEY.radius || Math.abs(input.site[2]) > SURVEY.radius) fail('site must be a [dx, dy, dz] offset inside the surveyed area');
    if (Math.abs(input.site[1]) > SURVEY.depth) fail('site height is outside the surveyed depth');
    site = [...input.site];
  } else if (input.site !== null && input.site !== undefined) fail('invalid site');
  let existingOffset = null;
  if (input.existingOffset !== null && input.existingOffset !== undefined) {
    vector(input.existingOffset, 'existingOffset');
    if (input.existingOffset.some((n, i) => n < 0 || n >= input.size[i])) fail('existingOffset must lie inside the new bounds');
    existingOffset = [...input.existingOffset];
  }
  const blocks = [...cells.values()];
  const empty = [];
  for (let x = 0; x < input.size[0]; x++) for (let y = 0; y < input.size[1]; y++) for (let z = 0; z < input.size[2]; z++) {
    if (!cells.has(`${x},${y},${z}`)) empty.push({ x, y, z, ...(carved.has(`${x},${y},${z}`) && { carved: true }) });
  }
  const materials = blocks.filter(p => !p.companion).reduce((m, p) => { m[p.material] = (m[p.material] || 0) + 1; return m; }, {});
  return { source: input, blocks, empty, materials, notes, existingOffset, site, access: access && [access.x, access.y, access.z] };
}

function surveyForDesign(bot) {
  const o = bot.entity.position.floored();
  const span = (SURVEY.radius * 2) / SURVEY.step + 1;
  const heights = [], surface = [], palette = [], indexOf = new Map();
  const nearby = new Set();
  for (let iz = 0; iz < span; iz++) {
    const row = [], materials = [];
    for (let ix = 0; ix < span; ix++) {
      const dx = -SURVEY.radius + ix * SURVEY.step, dz = -SURVEY.radius + iz * SURVEY.step;
      let ground = null;
      for (let y = o.y + SURVEY.depth; y >= o.y - SURVEY.depth; y--) {
        const p = o.offset(dx, y - o.y, dz), b = bot.blockAt(p);
        if (!b) break;
        if (naturalGround(b) && replaceable(bot.blockAt(p.offset(0, 1, 0)))) { ground = { y, name: b.name }; break; }
      }
      row.push(ground ? ground.y : null);
      if (ground) nearby.add(ground.name);
      if (iz % MATERIAL_EVERY || ix % MATERIAL_EVERY) continue;
      if (ground && !indexOf.has(ground.name)) { indexOf.set(ground.name, palette.length); palette.push(ground.name); }
      materials.push(ground ? indexOf.get(ground.name) : null);
    }
    heights.push(row);
    if (!(iz % MATERIAL_EVERY)) surface.push(materials);
  }
  const terrain = {
    step: SURVEY.step, radius: SURVEY.radius,
    note: `heights[iz][ix] is the ground height at dx = -${SURVEY.radius} + ix*${SURVEY.step}, dz = -${SURVEY.radius} + iz*${SURVEY.step}, relative to Jev; null where no ground was found. surface uses the same layout at ${SURVEY.step * MATERIAL_EVERY}-block spacing, indexing surfacePalette.`,
    heights, surface, surfacePalette: palette,
  };
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
  const free = bot.game?.gameMode === 'creative';
  const materialGuide = [...local].map(block => {
    if (free) return { block };
    try {
      const plan = planCatalog(bot.registry, block, 64, stock, { nearby: [...nearby] });
      return { block, carried: stock[block] || 0, for64Blocks: plan.map(s => ({ action: s.action, item: s.item || s.drops, count: s.count })) };
    } catch { return { block, carried: stock[block] || 0, acquisition: 'No executable acquisition plan; use only what is carried' }; }
  });
  return { dimension: bot.game.dimension, gameMode: bot.game.gameMode, position: { ...o }, terrain,
    existingStructures: bot.buildRegistry?.describe(bot, o, bot.game.dimension) || [],
    materials: { locallyObservedSources: [...nearby], practicalPalette: materialGuide,
      catalogMeaning: 'The response schema enumerates the supported block types. That is what Jev can place, NOT what is available here: unlisted decorative materials may require distant biomes or another dimension.' },
    inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })), limits: LIMITS, ceiling: CEILING };
}

async function readDesign(response, report) {
  const body = response.body;
  // A stubbed or non-streaming reply still answers in one piece.
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
    const whole = await response.json(), choice = whole.choices?.[0];
    return { content: choice?.message?.content, finishReason: choice?.finish_reason, usage: whole.usage };
  }
  const decoder = new TextDecoder();
  let buffer = '', content = '', finishReason, usage;
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let parsed;
      try { parsed = JSON.parse(payload); } catch (_) { continue; }
      const choice = parsed.choices?.[0];
      content += choice?.delta?.content || '';
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (parsed.usage) usage = parsed.usage;
      report?.(content);
    }
  }
  return { content, finishReason, usage };
}

// What Jev can honestly say about a design that is still being written. The
// model reasons before it writes anything, so the first stretch has no content
// to report at all and only silence to break.
function designProgress(say) {
  let named = false, sized = false, drawing = false, spoke = Date.now();
  const rarely = () => Date.now() - spoke >= 45000 && (spoke = Date.now(), true);
  return text => {
    if (!text) { if (rarely()) say('Still working it out.'); return; }
    // The first content ends the quiet stretch, so the drawing reports itself
    // on its own clock rather than firing the moment it begins.
    if (!drawing) { drawing = true; spoke = Date.now(); }
    if (!named) {
      const name = /"name"\s*:\s*"([^"]{1,60})"/.exec(text);
      if (name) { named = true; say(`I'm calling it ${name[1]}.`); }
    }
    if (!sized) {
      const size = /"size"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(text);
      if (size) { sized = true; say(`It comes out ${size[1]} by ${size[3]}, and ${size[2]} tall.`); }
    }
    // Vanilla kicks a chatty client, so the drawing is reported rarely.
    const drawn = (text.match(/"block"\s*:/g) || []).length;
    if (drawn && rarely()) say(`Still drawing: ${drawn} piece${drawn === 1 ? '' : 's'} so far.`);
  };
}

async function designBuilding(bot, task, request, { fetchImpl = fetch, apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.OPENROUTER_BUILD_MODEL || MODEL, previousDraft, feedback, memory, editing } = {}) {
  memory = require('./preferences').preferenceContext(memory);
  if (!apiKey) { const e = new Error('Building designer needs OPENROUTER_API_KEY in the local .env'); e.name = 'Blocked'; throw e; }
  const world = surveyForDesign(bot), controller = new AbortController();
  const schema = structuredClone(SCHEMA);
  const allowed = [...buildPalette(bot.registry), 'air'];
  schema.properties.palette.items.enum = allowed;
  schema.properties.regions.items.properties.block.enum = allowed;
  // A castle is a far longer answer than a hut: the model reasons for a while
  // and then writes it out at a few dozen tokens a second. Three minutes was
  // the budget for ordinary builds and cut the big ones off mid-sentence, which
  // is why Jev now narrates the wait instead of standing silent through it.
  const timer = setTimeout(() => controller.abort(new Error('Building designer timed out')), 480000);
  const watcher = setInterval(() => { try { task.check(); checkAir(bot); } catch (e) { controller.abort(e); } }, 100);
  const stopThinking = thinking(bot);
  try {
    task.check();
    const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 32000, reasoning: { effort: 'low' }, provider: { require_parameters: true },
        stream: true, stream_options: { include_usage: true },
        messages: [{ role: 'system', content: `Design an attractive, usable Minecraft structure matching the player request. Return only a schematic, never commands or code. Coordinates are local [x,y,z] inside size. Regions are inclusive filled cuboids, applied in order; air carves openings. Unspecified cells are air. The palette field lists every block you may use, and the response schema enumerates them; at most 16 palette entries and ${LIMITS.regions} regions; A flat or thin structure is fine: an arch, a wall or a statue may be one or two blocks deep. Ordinary requests belong within ${LIMITS.width}x${LIMITS.height}x${LIMITS.depth} and ${LIMITS.blocks} solid blocks, which is what most builds should use. Go beyond that, up to ${CEILING.width}x${CEILING.height}x${CEILING.depth} and ${CEILING.blocks} blocks, when the player asks for something large outright or the thing asked for is large by its nature, such as a castle, a cathedral, a bridge across a valley or a statue meant to be seen from far off. Build it at the size it deserves rather than shrinking it to fit; Jev places every block by hand at about ${SECONDS_PER_BLOCK} seconds each, so size it to the request and not beyond it. All solid components must connect to the foundation at y=0, which is the height site places them at, not necessarily the surrounding surface. Follow the requested shape rather than forcing every structure to be a house. Current explicit instructions override memory. Relevant explicit memory notes override learned memory.preferences. Learned wood preferences are soft defaults for unspecified materials, not mandatory ingredients: favor that wood when practical, but do not start a distant expedition solely for an inferred preference. Never treat a previous task or remembered text as a new action request. Include floors, walls, a roof, windows and walkable interiors only when appropriate. Sculptures, monuments, arches and other structures need not have rooms or a doorway: use entrance:null when the structure is not meant to be entered. For structures meant to be entered, provide a usable entrance. In Survival, use world.materials.practicalPalette for the main structure unless the request specifies another material. The for64Blocks recipes show the real gathering effort: prefer abundant carried supplies or cheap local materials. For an ordinary request without a size, aim for 80-200 solid blocks total; spend detail on shape, proportions and openings, not large bulk. Do not add Nether-only blocks, rare biome blocks, or smelted decorative variants unless the player requested them or enough are already carried. If a light block is not locally practical, leave a window/skylight instead. These are design choices, not reasons to ask the player questions. Make mansions visibly larger and architecturally richer than simple houses, with connected rooms and a usable entrance. For an enterable structure, reserve a two-block-high entrance opening at y>=1 with a floor directly beneath it; entrance gives its bottom air cell. Inset entrances are allowed when a supported, two-block-high walking route reaches an exterior edge of the bounding box. Every interior floor must be reachable from the entrance by walking and one-block jumps; carve the floor above each staircase to leave jumping headroom over the current step as well as the destination. Stairs and slabs are available. Every stair region needs properties:{facing:"north"|"east"|"south"|"west",half:"bottom"|"top"}. Facing points toward the high side of bottom stairs (north=-z, south=+z, east=+x, west=-x). Every slab region needs properties:{facing:null,half:"bottom"|"top"}. Other blocks use properties:null. Stair corners join automatically; do not specify shape, waterlogging or double slabs. Use full blocks for structural supports and entrance floors; stairs/slabs are useful for steps, roofs and trim. Wooden doors are available. A door region specifies only its lower cell, with properties:{facing:"north"|"east"|"south"|"west",half:null}. Code adds the upper cell and counts one inventory door for the pair. Leave the cell above it free and put a full block directly below it. Facing follows the walking direction through the doorway, for example south for entering from a north wall. A usable entrance may contain a door. Do not specify hinges, open states, or upper door halves; Minecraft handles them. Design compactly with cuboids rather than listing thousands of individual blocks. When \`editing\` is present the player wants an existing building changed, and its exact schematic is given in its own local coordinates. Return the COMPLETE building as it should end up, existing parts and changes together, and set existingOffset to the local position the old building's [0,0,0] now occupies in your drawing. Any cell you leave out is torn down, so this expresses whatever the request actually means: adding a wing or a balcony, opening a wall, taking a roof off, raising a storey, reshaping or redecorating. You are free to alter the original where the request calls for it; keep the parts it does not. The result must be ONE connected building: every part you add shares a face with the existing structure or with something else you add, never floating beside it with air in between. Match the existing materials and proportions unless asked otherwise, and keep the whole result within the size limits. For a fresh build with nothing to change, set existingOffset to null. world.terrain is the lie of the land around Jev: a heightmap covering ${SURVEY.radius} blocks in every direction, sampled every ${SURVEY.step} blocks, with terrain.note explaining how to read it. Read it as ground: flat shelves, slopes, ridges, hollows and water. Design for that ground rather than for a flat plain, and set site to the [dx, dy, dz] the building should stand on, relative to world.position, where dy puts local y=0 at the height you want, choosing ground that suits it: level enough for its footprint, and a hilltop, a shoreline or a clearing where the request calls for one. Take the slope into account in the design itself. You may set the building into the ground rather than on top of it: put local y=0 below the surrounding surface and carve the rooms with explicit air regions, and the ground inside them is dug out for you, up to ${SITE.excavate} blocks. Cells you simply leave unmentioned keep whatever ground is already there, so a cellar or a hall in a hillside must be carved with air on purpose. Step or raise the foundation where the ground falls away instead, when the building belongs on the surface. Code proves the spot before building and will look elsewhere if it does not hold, so choose the best ground you can see rather than the nearest. Use site:null only when nowhere in view suits it. world.existingStructures lists buildings already standing here: match the materials and proportions of any the request adjoins.` },
          { role: 'user', content: JSON.stringify({ request, world, memory, editing }) },
          ...(previousDraft ? [{ role: 'assistant', content: JSON.stringify(previousDraft) },
            { role: 'user', content: `The schematic failed validation: ${feedback}. Correct this issue while preserving the requested structure and materials. Do not replace it with a different building type. Check all geometry, connections, entrance access and walkable interior floors before returning it. Return the full corrected schematic.` }] : [])],
        response_format: { type: 'json_schema', json_schema: { name: 'minecraft_schematic', strict: true, schema } } }),
    });
    if (!response.ok) throw new Error(`Building designer request failed (${response.status})`);
    const { content, finishReason, usage } = await readDesign(response, designProgress(message => {
      try { bot.chat(message); } catch (_) { /* an aside is never worth failing the design over */ }
    }));
    task.check();
    // Say when the answer ran out of room rather than reporting an empty one:
    // the retry can only shorten the design if it knows that is the problem.
    if (finishReason === 'length') {
      throw new Error('the design was too long to finish writing; use fewer, larger cuboid regions to describe the same structure');
    }
    if (typeof content !== 'string' || !content) throw new Error('Building designer returned no schematic');
    if (content.length > 200000) throw new Error('Building designer response exceeded the schematic size limit');
    const draft = JSON.parse(content);
    let validated;
    try { validated = validateSchematic(draft, bot.registry); }
    catch (err) { err.draft = draft; throw err; }
    return { ...validated, model, createdAt: new Date().toISOString(), usage, world };
  } finally { clearTimeout(timer); clearInterval(watcher); stopThinking(); }
}

// How far the foundation may step down over natural terrain, and how much
// plinth that is allowed to cost. Beyond this the earthworks planner is a
// better answer than an increasingly tall pedestal.
const SITE = { step: 8, plinth: 600, preserved: 0.12, rings: 3, spacing: 3, excavate: 1200 };

// Where to try putting the structure. Without a requested spot this keeps the
// original four-by-four spread around the bot; with one it centres the
// footprint on that spot and widens in rings, so a blocked exact placement
// still lands beside what the player pointed at rather than across the valley.
function sitePositions(bot, width, depth, anchor, at) {
  // An edit is not looking for somewhere to go: it belongs exactly where the
  // building it redraws already stands.
  if (at) return [new Vec3(at.x, at.y, at.z)];
  if (!anchor) {
    const o = bot.entity.position.floored(), positions = [];
    for (const dx of [5, -width - 5, 12, -width - 12]) for (const dz of [5, -depth - 5, 12, -depth - 12]) positions.push(o.offset(dx, 0, dz));
    return positions;
  }
  const o = new Vec3(Math.floor(anchor.x), Math.floor(anchor.y), Math.floor(anchor.z));
  const corner = o.offset(-Math.floor(width / 2), 0, -Math.floor(depth / 2)), positions = [];
  for (let ring = 0; ring <= SITE.rings; ring++) {
    for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
      positions.push(corner.offset(dx * SITE.spacing, 0, dz * SITE.spacing));
    }
  }
  return positions.slice(0, 24);
}

/**
 * Choose where the structure stands.
 *
 * `anchor` is a requested spot ("build it here", "next to the barn"). `owned`
 * is the set of cells earlier Jev structures claim: those count as ground to
 * stand on and as material to build into, so an extension can attach to what
 * is already there. Blocks belonging to neither terrain nor Jev are the
 * player's: a small number of them are preserved and built around rather than
 * demolished, and too many of them rule the site out.
 */
function selectSchematicSite(bot, schematic, { anchor, prefer, owned = new Set(), at, baseY: floor } = {}) {
  anchor = anchor || prefer;
  const o = bot.entity.position.floored(), [width, height, depth] = schematic.source.size;
  const isSurface = surfaceObserver(bot);
  const key = p => `${p.x},${p.y},${p.z}`;
  const ours = p => owned.has(key(p));
  // Jev's own walls are a legitimate floor and a legitimate thing to build into.
  const standable = p => naturalGround(bot.blockAt(p)) || ours(p);
  const clearable = p => replaceable(bot.blockAt(p)) || ours(p);
  const scored = [];
  for (const candidate of sitePositions(bot, width, depth, anchor, at)) {
    const ground = new Map();
    for (let x = 0; x < width; x++) for (let z = 0; z < depth; z++) {
      for (let y = candidate.y + SITE.step; y >= candidate.y - SITE.step; y--) {
        const p = new Vec3(candidate.x + x, y, candidate.z + z);
        if (standable(p) && clearable(p.offset(0, 1, 0)) && (ours(p) || isSurface(p.offset(0, 1, 0)))) { ground.set(`${x},${z}`, y); break; }
      }
    }
    if (!at && ground.size !== width * depth) continue;
    if (at) { ground.clear(); for (let x = 0; x < width; x++) for (let z = 0; z < depth; z++) ground.set(`${x},${z}`, at.y); }
    // The design may set its own floor to cut into a slope. Left to code, the
    // base is the highest ground under the footprint, which can only ever put
    // the building on top of the hill.
    const baseY = at ? at.y : Number.isFinite(floor) ? floor : Math.max(...ground.values());
    // Uneven ground is answered with a stepped foundation rather than by
    // flattening the landscape, but a cliff must not become a pedestal.
    if (!at && !Number.isFinite(floor) && baseY - Math.min(...ground.values()) > SITE.step) continue;
    const plinth = schematic.blocks.filter(p => p.y === 0)
      .reduce((total, p) => total + Math.max(0, baseY - ground.get(`${p.x},${p.z}`) - 1), 0);
    if (plinth > SITE.plinth) continue;
    const origin = new Vec3(candidate.x, baseY, candidate.z);
    let blocks = schematic.blocks.map(p => ({ ...p, ...origin.offset(p.x, p.y, p.z) }));
    // Unspecified foundation cells retain natural terrain rather than leaving
    // a moat around an inset facade. Air above the ground is verified exactly.
    // Air the design asked for stays asked for even underground: that is a
    // cellar or a hall cut into the slope. Air nobody mentioned keeps whatever
    // terrain is already there, so an inset facade does not dig itself a moat.
    let empty = schematic.empty.map(p => ({ ...origin.offset(p.x, p.y, p.z), carved: p.carved }))
      .filter(p => p.carved || p.y > ground.get(`${p.x - origin.x},${p.z - origin.z}`));
    const excavation = empty.filter(p => p.carved && naturalGround(bot.blockAt(new Vec3(p.x, p.y, p.z)))).length;
    if (excavation > SITE.excavate) continue;
    // Anything above ground that is neither replaceable nor ours belongs to the
    // player. Build around it: drop those cells from the plan instead of
    // demolishing them, and walk away from a site that is mostly someone's house.
    const occupied = p => p.y > ground.get(`${p.x - origin.x},${p.z - origin.z}`) && !clearable(new Vec3(p.x, p.y, p.z));
    const preserved = [...blocks, ...empty].filter(occupied).map(p => ({ x: p.x, y: p.y, z: p.z }));
    if (preserved.length > (blocks.length + empty.length) * SITE.preserved) continue;
    if (preserved.length) {
      const skip = new Set(preserved.map(key));
      blocks = blocks.filter(p => !skip.has(key(p)));
      empty = empty.filter(p => !skip.has(key(p)));
    }
    for (const p of schematic.blocks.filter(p => p.y === 0)) for (let y = ground.get(`${p.x},${p.z}`) + 1; y < baseY; y++) {
      blocks.push({ x: origin.x + p.x, y, z: origin.z + p.z, material: p.properties ? 'cobblestone' : p.material });
    }
    // A structure cannot be built through whoever asked for it.
    if (occupiedByBody(bot, blocks)) continue;

    const e = vec(schematic.access || schematic.source.entrance || [Math.floor(width / 2), 1, 0]), direction = e.z === 0 ? new Vec3(0, 0, -1) : e.z === depth - 1 ? new Vec3(0, 0, 1) : e.x === 0 ? new Vec3(-1, 0, 0) : new Vec3(1, 0, 0);
    const entrance = origin.plus(e).plus(direction);
    // A doorway above the ground floor - a balcony, a second storey - is
    // reached from inside the structure, and validateSchematic has already
    // checked it has a floor there. Requiring natural ground outside it as well
    // rejects every elevated entrance, which is precisely what a balcony is.
    const grounded = e.y <= 1;
    if (!clearable(entrance) || !clearable(entrance.offset(0, 1, 0)) ||
      (grounded && !standable(entrance.offset(0, -1, 0)))) continue;
    const initialBlocks = {}, initialNames = {};
    for (const p of [...blocks, ...empty]) {
      const b = bot.blockAt(new Vec3(p.x, p.y, p.z));
      if (b && !['air', 'cave_air', 'void_air'].includes(b.name)) { initialBlocks[key(p)] = b.stateId ?? b.name; initialNames[key(p)] = b.name; }
    }
    const site = { origin: { ...origin }, blocks, empty, entrance: { ...entrance }, initialBlocks, initialNames,
      ...(preserved.length ? { preserved } : {}),
      bounds: { min: { x: origin.x, y: baseY - SITE.step, z: origin.z }, max: { x: origin.x + width - 1, y: baseY + height - 1, z: origin.z + depth - 1 } } };
    // Prefer a site that disturbs least: no preserved player blocks, then the
    // shallowest foundation, then closest to what the player asked for.
    // Prefer a site that disturbs least: no preserved player blocks, then the
    // shallowest foundation, then closest to what the player asked for.
    scored.push({ site, cost: preserved.length * 100 + plinth + (anchor ? origin.distanceTo(new Vec3(anchor.x, anchor.y, anchor.z)) : 0) });
    if (!preserved.length && plinth === 0) break;
  }
  if (scored.length) return scored.sort((a, b) => a.cost - b.cost)[0].site;
  const earthworks = where => require('./build-terrain').planTerrainSite(bot, schematic, { naturalGround, replaceable, at: where });
  if (prefer) return earthworks(prefer);
  if (anchor) return null;
  return earthworks();
}
function canClearSchematicBlock(blueprint, owned, block) {
  if (!block) return false;
  if (['air', 'cave_air', 'void_air'].includes(block.name)) return true;
  const p = block.position, key = `${p.x},${p.y},${p.z}`, state = block.stateId ?? block.name;
  // Ordinary water flow and covered grass changing to dirt are natural state
  // changes during earthworks, not newly placed player construction.
  const original = blueprint.initialNames?.[key];
  if (original === 'water' && block.name === 'water' || original === 'grass_block' && block.name === 'dirt') return true;
  // Leaves decay while Jev works, which rewrites their distance and persistence
  // and so their state id. Foliage still being the same foliage is the world
  // carrying on, not the player putting something in the way, and the site
  // planner counted on clearing it in the first place.
  if (original === block.name && replaceable(block)) return true;
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
module.exports = { MODEL, LIMITS, CEILING, SECONDS_PER_BLOCK, SURVEY, SCHEMA, designProgress, buildPalette, validateSchematic, surveyForDesign, designBuilding, selectSchematicSite, canClearSchematicBlock, schematicScaffolding };

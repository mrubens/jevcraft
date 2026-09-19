'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { MODEL, buildPalette, validateSchematic, designBuilding, selectSchematicSite, canClearSchematicBlock, schematicScaffolding } = require('../src/designer');
const { designedBuildStep } = require('../src/work');
const { reservedForConstruction } = require('../src/build-sites');
const { Task } = require('../src/skills');
const { templateSchematic, designWithJev } = require('../src/build-templates');
function draft() {
  return { name: 'Cherry pavilion', description: 'A supported open pavilion', size: [5, 5, 5],
    palette: ['cherry_planks', 'glass', 'air'], entrance: [2, 1, 0], regions: [
      { from: [0, 0, 0], to: [4, 0, 4], block: 'cherry_planks' },
      { from: [0, 1, 4], to: [4, 4, 4], block: 'cherry_planks' },
      { from: [1, 2, 4], to: [3, 2, 4], block: 'glass' },
      { from: [0, 4, 0], to: [4, 4, 4], block: 'cherry_planks' },
    ] };
}
function world() {
  const bot = new EventEmitter();
  Object.assign(bot, { registry, entity: { position: new Vec3(0.5, 64, 0.5) },
    game: { dimension: 'overworld', gameMode: 'survival', minY: 0, height: 128 },
    inventory: { items: () => [{ name: 'oak_log', count: 2 }] },
    blockAt: p => { const name = p.y <= 63 ? 'grass_block' : 'air'; return { name, position: p, boundingBox: p.y <= 63 ? 'block' : 'empty', stateId: registry.blocksByName[name].defaultState, diggable: true }; } });
  return bot;
}
test('schematic expands overlapping regions into exact materials with no duplicate cells', () => {
  const d = validateSchematic(draft(), registry);
  assert.equal(d.blocks.length, 65);
  assert.equal(d.materials.glass, 3);
  assert.equal(d.materials.cherry_planks, 62);
  assert.equal(d.empty.length, 60);
  assert(buildPalette(registry).includes('cherry_planks'));
  assert(!buildPalette(registry).includes('command_block'));
  assert(!buildPalette(registry).includes('sand'));
});
test('schematic rejects unknown execution fields, unsupported blocks, unbounded geometry and unusable entrances', () => {
  for (const mutate of [
    d => { d.command = '/fill'; },
    d => { d.palette.push('command_block'); },
    d => { d.size = [99999, 99999, 99999]; },
    d => { d.regions[0].to[0] = 5; },
    d => { d.regions[0].from[1] = -1; },
    d => { d.entrance = [-1, 1, 1]; },
    d => { d.entrance = [0, 1, 4]; },
    d => { d.regions.push({ from: [2, 2, 2], to: [2, 2, 2], block: 'glass' }); },
  ]) {
    const d = draft(); mutate(d);
    assert.throws(() => validateSchematic(d, registry), /Invalid building schematic/);
  }
});
test('site planning preserves existing buildings and unbuilt foundation terrain, and reserves the full footprint', () => {
  const bot = world(), d = validateSchematic(draft(), registry);
  d.source.size = [13, 5, 13];
  const site = selectSchematicSite(bot, d);
  assert(site);
  assert(site.empty.every(p => p.y > 63));
  assert(reservedForConstruction({ blueprint: site }, new Vec3(site.origin.x + 12, 63, site.origin.z + 12)));
  const natural = bot.blockAt(new Vec3(site.origin.x, 63, site.origin.z));
  assert(canClearSchematicBlock(site, {}, natural));
  assert(!canClearSchematicBlock(site, {}, { ...natural, name: 'chest', stateId: 123456 }));
  const scaffold = { ...natural, position: natural.position.offset(0, 2, 0), name: 'dirt', stateId: 1234 };
  assert(canClearSchematicBlock(site, { [`${scaffold.position.x},${scaffold.position.y},${scaffold.position.z}`]: 1234 }, scaffold));
  const original = bot.blockAt;
  bot.blockAt = p => p.y === 64 ? { ...original(p), name: 'oak_planks', boundingBox: 'block' } : original(p);
  assert.equal(selectSchematicSite(bot, d), null);
});
test('designer submits the requested model, catalog schema and observed world, without persisting credentials', async () => {
  let body;
  const memory = { notes: [{ note: 'I prefer cherry planks' }] };
  const result = await designBuilding(world(), new Task('design'), 'build cherry', {
    apiKey: 'test-secret', model: MODEL, memory,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer test-secret');
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(draft()) } }] }) };
    },
  });
  assert.equal(body.model, MODEL);
  assert(body.response_format.json_schema.schema.properties.palette.items.enum.includes('cherry_planks'));
  assert(!body.response_format.json_schema.schema.properties.palette.items.enum.includes('command_block'));
  const state = JSON.parse(body.messages[1].content);
  assert.deepEqual(state.memory, memory);
  assert.equal(state.request, 'build cherry');
  assert.equal(state.world.inventory[0].name, 'oak_log');
  assert(state.world.terrain.length > 0);
  assert(state.world.materials.practicalPalette.some(entry => entry.block === 'oak_stairs'));
  assert(state.world.materials.practicalPalette.some(entry => entry.block === 'oak_slab'));
  assert(!JSON.stringify(result).includes('test-secret'));
});

test('the retained advisor pavilion uses stairs and slabs with explicit states', () => {
  const source = require('./fixtures/oak-stair-pavilion.json');
  const d = validateSchematic(source, registry);
  assert.deepEqual(d.materials, { oak_planks: 86, oak_stairs: 40, oak_slab: 9 });
  assert.equal(d.blocks.filter(p => p.properties).length, 49);
  assert.deepEqual(d.source, source);
});
test('invalid draft is retained for a bounded repair with concrete feedback', async () => {
  const bad = draft(); bad.regions[0].to[0] = 50;
  const respond = value => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) });
  let error;
  try { await designBuilding(world(), new Task('design'), 'test', { apiKey: 'test', fetchImpl: respond(bad) }); }
  catch (e) { error = e; }
  assert.deepEqual(error.draft, bad);
  await designBuilding(world(), new Task('design'), 'test', { apiKey: 'test', previousDraft: error.draft, feedback: error.message,
    fetchImpl: async (_url, options) => {
      const messages = JSON.parse(options.body).messages;
      assert.deepEqual(JSON.parse(messages[2].content), bad);
      assert(messages[3].content.includes('region out of bounds'));
      return respond(draft())();
    } });
});
test('stop aborts an outstanding designer request promptly', async () => {
  const task = new Task('design');
  await assert.rejects(designBuilding(world(), task, 'test', { apiKey: 'test', fetchImpl: async (_url, { signal }) => {
    task.cancel();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } }), { name: 'Cancelled' });
});
test('saved completed schematic resumes by verification without another model call', async () => {
  const bot = world(), design = validateSchematic(draft(), registry), blueprint = selectSchematicSite(bot, design);
  const cells = new Map(blueprint.blocks.map(p => [`${p.x},${p.y},${p.z}`, p.material]));
  bot.blockAt = p => ({ name: cells.get(`${p.x},${p.y},${p.z}`) || 'air' });
  const goal = JSON.parse(JSON.stringify({ design, blueprint }));
  assert.equal(await designedBuildStep(bot, new Task('resume'), goal, () => {}, null), true);
  assert.equal(bot.listenerCount('blockPlaced'), 0);
});

test('every template has supported geometry and walkable access to each floor', () => {
  for (const style of ['cottage', 'mansion', 'tower']) for (const floors of [1, 2, 3]) for (const size of ['normal', 'large']) {
    const d = validateSchematic(templateSchematic({ style, floors, size, material: 'cherry_planks' }), registry);
    const occupied = new Set(d.blocks.map(p => `${p.x},${p.y},${p.z}`));
    const solid = (x, y, z) => occupied.has(`${x},${y},${z}`);
    const walkable = (x, y, z) => x >= 0 && z >= 0 && x < d.source.size[0] && z < d.source.size[2] &&
      solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z);
    const queue = [d.source.entrance], seen = new Set([queue[0].join(',')]);
    for (let i = 0; i < queue.length; i++) {
      const [x, y, z] = queue[i];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [-1, 0, 1]) {
        const next = [x + dx, y + dy, z + dz], key = next.join(',');
        if (!seen.has(key) && walkable(...next) && (dy <= 0 || !solid(x, y + 2, z))) { seen.add(key); queue.push(next); }
      }
    }
    for (let floor = 0; floor < floors; floor++) assert(queue.some(p => p[1] === floor * 4 + 1 && p[0] >= 3 && p[2] >= 6), `${style}/${floors}/${size}: floor ${floor} reachable`);
  }
});

test('an inset entrance with an open walkway is accepted and the site approach uses its exterior edge', () => {
  const source = draft(); source.entrance = [2, 1, 1];
  const result = validateSchematic(source, registry);
  assert(result.access[0] === 0 || result.access[0] === 4 || result.access[2] === 0 || result.access[2] === 4);
  const bot = world(), before = bot.blockAt;
  bot.blockAt = p => p.y <= 63 ? { ...before(p), name: 'sand' } : before(p);
  const site = selectSchematicSite(bot, result);
  assert(site, 'Natural desert sand is a valid building site');
  assert(site.entrance.x < site.origin.x || site.entrance.x >= site.origin.x + 5 || site.entrance.z < site.origin.z || site.entrance.z >= site.origin.z + 5);
});

test('the retained real custom draft validates without changing any of its geometry', () => {
  const source = require('./fixtures/inset-custom-design.json');
  const result = validateSchematic(source, registry);
  assert.equal(result.blocks.length, 2255);
  assert.deepEqual(result.source, source);
  assert.deepEqual(result.access, [12, 1, 0]);
});

test('a saved custom plan is revalidated without changing its shape or calling a template', async t => {
  const previous = process.env.OPENROUTER_API_KEY, previousMode = process.env.BUILD_DESIGNER;
  process.env.OPENROUTER_API_KEY = 'test'; process.env.BUILD_DESIGNER = 'auto';
  t.after(() => {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous;
    if (previousMode === undefined) delete process.env.BUILD_DESIGNER; else process.env.BUILD_DESIGNER = previousMode;
  });
  const source = draft(); source.entrance = [2, 1, 1];
  const goal = { request: 'build my unusual structure', designDraft: source, designAttempts: 2, designError: 'entrance must be on an exterior edge' };
  t.mock.method(global, 'fetch', () => { throw new Error('Valid saved geometry needs no new model call'); });
  await designedBuildStep(world(), new Task('recheck'), goal, () => {}, { systemOne: () => { throw new Error('Do not substitute a template'); } });
  assert.deepEqual(goal.design.source, source);
  assert.equal(goal.designDraft, undefined);
  assert.equal(goal.design.backend, 'validated-saved-draft');
});

test('invalid custom geometry gets another advisor repair instead of falling into fixed templates', async t => {
  const previous = process.env.OPENROUTER_API_KEY, previousMode = process.env.BUILD_DESIGNER;
  process.env.OPENROUTER_API_KEY = 'test'; process.env.BUILD_DESIGNER = 'auto';
  t.after(() => {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous;
    if (previousMode === undefined) delete process.env.BUILD_DESIGNER; else process.env.BUILD_DESIGNER = previousMode;
  });
  const bad = draft(); bad.regions[0].to[0] = 30;
  const goal = { request: 'build an arch', designDraft: bad, designAttempts: 2 }, bot = world(); bot.chat = () => {};
  let calls = 0;
  t.mock.method(global, 'fetch', async (_url, options) => {
    calls++;
    const messages = JSON.parse(options.body).messages;
    assert(messages.at(-1).content.includes('region out of bounds'));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(draft()) } }] }) };
  });
  await designedBuildStep(bot, new Task('repair'), goal, () => {}, { systemOne: () => { throw new Error('Do not substitute a template'); } });
  assert.equal(calls, 1); assert.equal(goal.designAttempts, 3); assert(goal.design);
});

test('a sealed interior entrance is rejected and a non-enterable sculpture needs no invented door', () => {
  const source = { name: 'Monument', description: 'A solid stone monument', size: [5, 5, 5], palette: ['stone'],
    regions: [{ from: [0, 0, 0], to: [4, 4, 4], block: 'stone' }], entrance: null };
  const monument = validateSchematic(source, registry);
  assert.equal(monument.blocks.length, 125);
  assert(selectSchematicSite(world(), monument));
  source.regions.push({ from: [2, 1, 2], to: [2, 2, 2], block: 'air' });
  source.entrance = [2, 1, 2];
  assert.throws(() => validateSchematic(source, registry), /no walkable route to the exterior/);
});

test('a closed stairwell is a diagnostic note, not a reason to reject the designers geometry', () => {
  const d = templateSchematic({ style: 'mansion', floors: 2, size: 'normal', material: 'cherry_planks' });
  d.regions.push({ from: [1, 4, 1], to: [11, 4, 11], block: 'cherry_planks' });
  const result = validateSchematic(d, registry);
  assert(result.notes.some(note => note.kind === 'accessibility'));
  assert.deepEqual(result.source, d);
});

test('Jev fallback retains structured judgments and rejects requests outside its templates', async () => {
  const client = { model: 'jev-test', systemOne: async () => ({ answers: {
    style: { choice: 'mansion' }, floors: { choice: '2' }, size: { choice: 'normal' }, material: { choice: 'default' },
  } }) };
  const design = await designWithJev(world(), new Task('fallback'), 'build a mansion', client);
  assert.equal(design.backend, 'jev-template');
  assert.equal(design.judgments.floors.choice, '2');
  assert(design.materials.oak_planks > 0);
  await assert.rejects(designWithJev(world(), new Task('fallback'), 'build a dragon statue', {
    systemOne: async () => ({ answers: { style: { choice: 'unsupported' } } }),
  }), { name: 'Blocked' });
});

test('building tool uses the Jev fallback without invoking a text model', async t => {
  const previous = process.env.BUILD_DESIGNER;
  process.env.BUILD_DESIGNER = 'jev';
  t.after(() => { if (previous === undefined) delete process.env.BUILD_DESIGNER; else process.env.BUILD_DESIGNER = previous; });
  t.mock.method(global, 'fetch', () => { throw new Error('Generative API must not be called'); });
  const bot = world(), messages = []; bot.chat = m => messages.push(m);
  const goal = { request: 'build a cottage' };
  await designedBuildStep(bot, new Task('fallback'), goal, () => {}, {
    systemOne: async () => ({ answers: { style: { choice: 'cottage' }, floors: { choice: '1' }, size: { choice: 'normal' }, material: { choice: 'default' } } }),
  });
  assert.equal(goal.design.backend, 'jev-template');
  assert(messages.some(m => m.includes('cottage')));
  assert(messages.every(m => !/templates|schematic|model/.test(m)), 'Player chat uses ordinary words');
  assert.equal(goal.designAttempts, undefined);
});

test('construction stops before overwriting an unexpected block added after the survey', async () => {
  const bot = world(), design = validateSchematic(draft(), registry), blueprint = selectSchematicSite(bot, design);
  const changed = new Vec3(blueprint.origin.x + 2, blueprint.origin.y + 1, blueprint.origin.z + 2), original = bot.blockAt;
  bot.blockAt = p => p.equals(changed) ? { position: p, name: 'chest', stateId: 999999, diggable: true } : original(p);
  await assert.rejects(designedBuildStep(bot, new Task('test'), { design, blueprint }, () => {}, null), /preserving the unexpected chest/);
  assert.equal(bot.listenerCount('blockPlaced'), 0);
});

test('scaffolding cleanup includes nearby bot dirt but preserves designed, changed and unowned blocks', () => {
  const bot = world(), design = validateSchematic(draft(), registry), blueprint = selectSchematicSite(bot, design);
  const o = blueprint.origin, dirt = registry.blocksByName.dirt.defaultState;
  const scaffold = new Vec3(o.x - 1, o.y + 1, o.z), changed = scaffold.offset(-1, 0, 0), planned = new Vec3(o.x, o.y, o.z);
  const block = p => ({ position: p, name: p.equals(changed) ? 'chest' : 'dirt', stateId: p.equals(changed) ? 999999 : dirt });
  bot.blockAt = block;
  const key = p => `${p.x},${p.y},${p.z}`;
  const buildOwned = { [key(scaffold)]: dirt, [key(changed)]: dirt, [key(planned)]: dirt, '1000,64,1000': dirt };
  assert.deepEqual(schematicScaffolding(bot, { blueprint, buildOwned }), [{ ...scaffold }]);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { validateSchematic, selectSchematicSite, canClearSchematicBlock } = require('../src/designer');
const { PREP_LIMITS } = require('../src/build-terrain');
const source = { name: 'Pavilion', description: 'Open building', size: [5, 5, 5], palette: ['oak_planks'], entrance: [2, 1, 0], regions: [
  { from: [0, 0, 0], to: [4, 0, 4], block: 'oak_planks' },
  { from: [0, 1, 4], to: [4, 4, 4], block: 'oak_planks' },
  { from: [0, 4, 0], to: [4, 4, 4], block: 'oak_planks' },
] };
function world(kind) {
  return { registry, game: { minY: 0, height: 128 }, entity: { position: new Vec3(.5, 64, .5) },
    blockAt: point => {
      const p = point.floored(), ground = kind === 'hills' ? 63 + (Math.abs(p.x) % 5 === 0 ? 4 : 0) : kind === 'deep' ? 50 : 61;
      const name = p.y <= ground ? 'stone' : p.y <= 63 && kind !== 'hills' ? kind === 'lava' ? 'lava' : 'water' : 'air';
      const data = registry.blocksByName[name];
      return { name, position: p, stateId: data.defaultState, diggable: data.diggable, boundingBox: data.boundingBox, getProperties: () => ({ level: 0 }) };
    } };
}

test('uneven natural ground becomes a bounded cut/fill plan with a usable approach', () => {
  const bot = world('hills'), site = selectSchematicSite(bot, validateSchematic(source, registry));
  assert(site?.terrain); assert.equal(site.terrain.kind, 'level_ground');
  assert(site.terrain.clear.length); assert(site.terrain.fill.length);
  assert(site.terrain.changedBlocks <= PREP_LIMITS.changes);
  const filled = new Map(site.blocks.map(p => [new Vec3(p.x, p.y, p.z).toString(), p]));
  for (const p of site.terrain.fill) {
    assert(filled.has(new Vec3(p.x, p.y, p.z).toString()), 'permanent supports are part of final verification');
    assert(canClearSchematicBlock(site, {}, bot.blockAt(new Vec3(p.x, p.y, p.z))));
  }
  const entry = new Vec3(site.entrance.x, site.entrance.y, site.entrance.z);
  assert(filled.has(entry.offset(0, -1, 0).toString()) || bot.blockAt(entry.offset(0, -1, 0)).boundingBox === 'block');
});

test('shallow source water can support an island foundation but deep water and lava cannot', () => {
  const schematic = validateSchematic(source, registry), bot = world('water');
  const site = selectSchematicSite(bot, schematic);
  assert(site?.terrain); assert.equal(site.terrain.kind, 'shore_foundation');
  assert.equal(site.origin.y, 63, 'island floor must stay at the waterline for swimming access');
  assert(site.terrain.fill.some(p => bot.blockAt(new Vec3(p.x, p.y, p.z)).name === 'water'));
  assert.equal(selectSchematicSite(world('deep'), schematic), null);
  assert.equal(selectSchematicSite(world('lava'), schematic), null);
  bot.blockAt = () => null;
  assert.equal(selectSchematicSite(bot, schematic), null);
});

test('earthworks reject recognizable buildings and preserve later changes to a reserved cell', () => {
  const bot = world('hills'), schematic = validateSchematic(source, registry);
  const original = bot.blockAt;
  bot.blockAt = p => { const b = original(p); return b.name === 'stone' ? { ...b, name: 'oak_planks' } : b; };
  assert.equal(selectSchematicSite(bot, schematic), null);
  bot.blockAt = original;
  const site = selectSchematicSite(bot, schematic), p = new Vec3(...Object.values(site.terrain.clear[0]));
  assert(!canClearSchematicBlock(site, {}, { ...original(p), name: 'chest', stateId: 999999 }));
});

test('natural flow changes in a snapshotted water cell do not cancel foundation work', () => {
  const bot = world('water'), site = selectSchematicSite(bot, validateSchematic(source, registry));
  const p = site.terrain.fill.find(p => bot.blockAt(new Vec3(p.x, p.y, p.z)).name === 'water');
  const block = bot.blockAt(new Vec3(p.x, p.y, p.z));
  assert(canClearSchematicBlock(site, {}, { ...block, stateId: block.stateId + 1 }));
  assert(!canClearSchematicBlock(site, {}, { ...block, name: 'lava', stateId: 88888 }));
});

test('terrain fill restocks by the cells remaining, not by holding a single block', () => {
  const { terrainShortage } = require('../src/work');
  const cells = count => Array.from({ length: count }, (_, i) => ({ x: i, y: 64, z: 0, material: 'cobblestone' }));
  const carrying = (count, gameMode = 'survival') =>
    ({ game: { gameMode }, inventory: { items: () => count ? [{ name: 'cobblestone', count }] : [] } });
  assert.deepEqual(terrainShortage(carrying(0), cells(40)), { item: 'cobblestone', count: 40 });
  assert.deepEqual(terrainShortage(carrying(1), cells(40)), { item: 'cobblestone', count: 40 },
    'one block is not a supply for forty cells');
  assert.equal(terrainShortage(carrying(40), cells(40)), null);
  assert.deepEqual(terrainShortage(carrying(0), cells(200)), { item: 'cobblestone', count: 64 }, 'capped at a stack');
  // Creative placement consumes nothing, so a single block really does cover the layer.
  assert.equal(terrainShortage(carrying(1, 'creative'), cells(40)), null);
  assert.deepEqual(terrainShortage(carrying(0, 'creative'), cells(40)), { item: 'cobblestone', count: 1 });
  assert.equal(terrainShortage(carrying(0), []), null, 'nothing left to fill needs nothing');
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { BuildRegistry, resolveBuildContinuation, MAX_BUILDS } = require('../src/builds');
const { validateSchematic, selectSchematicSite, LIMITS, CEILING } = require('../src/designer');

const source = { name: 'Pavilion', description: 'Open building', size: [5, 5, 5], palette: ['oak_planks'], entrance: [2, 1, 0], regions: [
  { from: [0, 0, 0], to: [4, 0, 4], block: 'oak_planks' },
  { from: [0, 1, 4], to: [4, 4, 4], block: 'oak_planks' },
  { from: [0, 4, 0], to: [4, 4, 4], block: 'oak_planks' },
] };
const schematic = () => validateSchematic(source, registry);

// A flat world at y<=61 with named blocks painted on top of it.
function world({ ground = 61, blocks = {} } = {}) {
  return {
    registry, game: { minY: 0, height: 128, dimension: 'overworld', gameMode: 'creative' },
    entity: { position: new Vec3(.5, 62, .5) },
    blockAt: point => {
      const p = point.floored();
      const name = blocks[`${p.x},${p.y},${p.z}`] || (p.y <= ground ? 'stone' : 'air');
      const data = registry.blocksByName[name];
      if (!data) return null;
      return { name, position: p, stateId: data.defaultState, diggable: data.diggable,
        boundingBox: data.boundingBox, shapes: data.boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : [], getProperties: () => ({}) };
    },
  };
}

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-builds-'));
  test.after?.(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'builds.json');
}

function buildGoal(name, origin, cells) {
  return { kind: 'build', request: `build a ${name}`, from: 'Player',
    design: { source: { ...source, name } },
    blueprint: { origin, entrance: { x: origin.x + 2, y: origin.y + 1, z: origin.z - 1 },
      bounds: { min: { ...origin }, max: { x: origin.x + 4, y: origin.y + 4, z: origin.z + 4 } },
      blocks: cells, empty: [] } };
}

test('a finished structure is remembered across restarts and updated in place', () => {
  const file = scratch();
  const goal = buildGoal('Barn', { x: 0, y: 62, z: 0 }, [{ x: 0, y: 62, z: 0, material: 'oak_planks' }]);
  const registryA = new BuildRegistry(file);
  registryA.remember(goal, { dimension: 'overworld' });
  assert(goal.buildId, 'the goal carries the structure id for later steps');

  const reloaded = new BuildRegistry(file);
  assert.equal(reloaded.all('overworld').length, 1);
  assert.equal(reloaded.find(goal.buildId).status, 'unfinished');
  assert.equal(reloaded.find(goal.buildId).name, 'Barn');
  assert.equal(reloaded.all('nether').length, 0, 'structures belong to the dimension they stand in');

  registryA.remember(goal, { dimension: 'overworld', status: 'complete' });
  const after = new BuildRegistry(file);
  assert.equal(after.all('overworld').length, 1, 'the same structure is updated, not duplicated');
  assert.equal(after.find(goal.buildId).status, 'complete');
  assert(after.find(goal.buildId).createdAt <= after.find(goal.buildId).updatedAt);
});

test('only the most recent structures are kept whole', () => {
  const registryA = new BuildRegistry(null);
  for (let i = 0; i < MAX_BUILDS + 3; i++) {
    registryA.remember(buildGoal(`Hut ${i}`, { x: i * 8, y: 62, z: 0 }, [{ x: i * 8, y: 62, z: 0, material: 'oak_planks' }]), { dimension: 'overworld' });
  }
  const names = registryA.all('overworld').map(e => e.name);
  assert.equal(names.length, MAX_BUILDS);
  assert(names.includes(`Hut ${MAX_BUILDS + 2}`)); assert(!names.includes('Hut 0'));
});

test('a village of twenty parts fits, and an unfinished one is let go before a standing one', () => {
  assert(MAX_BUILDS >= 20, 'every part of a village stays known');
  const registry = new BuildRegistry(null);
  registry.remember(buildGoal('Cottage 0', { x: 0, y: 62, z: 0 }, [{ x: 0, y: 62, z: 0, material: 'oak_planks' }]), { dimension: 'overworld', status: 'complete' });
  registry.remember(buildGoal('Half a well', { x: 8, y: 62, z: 0 }, [{ x: 8, y: 62, z: 0, material: 'oak_planks' }]), { dimension: 'overworld', status: 'unfinished' });
  for (let i = 1; i < MAX_BUILDS; i++) {
    registry.remember(buildGoal(`Cottage ${i}`, { x: 16 + i * 8, y: 62, z: 0 }, [{ x: 16 + i * 8, y: 62, z: 0, material: 'oak_planks' }]), { dimension: 'overworld', status: 'complete' });
  }
  const names = registry.all('overworld').map(e => e.name);
  assert(names.includes('Cottage 0'), 'the oldest standing cottage is still known');
  assert(!names.includes('Half a well'), 'the unfinished part went first');
});

test('past work is claimed as Jev\'s own only while the blocks still match', () => {
  const store = new BuildRegistry(null);
  const goal = buildGoal('Barn', { x: 0, y: 62, z: 0 },
    [{ x: 0, y: 62, z: 0, material: 'oak_planks' }, { x: 1, y: 62, z: 0, material: 'oak_planks' }]);
  store.remember(goal, { dimension: 'overworld' });
  const bounds = goal.blueprint.bounds;

  const standing = world({ blocks: { '0,62,0': 'oak_planks', '1,62,0': 'oak_planks' } });
  assert.deepEqual(Object.keys(store.ownership(standing, bounds, 'overworld')).sort(), ['0,62,0', '1,62,0']);

  // A cell someone replaced is no longer Jev's to clear.
  const changed = world({ blocks: { '0,62,0': 'oak_planks', '1,62,0': 'chest' } });
  assert.deepEqual(Object.keys(store.ownership(changed, bounds, 'overworld')), ['0,62,0']);

  // The build currently in progress must not inherit ownership of itself.
  assert.deepEqual(Object.keys(store.ownership(standing, bounds, 'overworld', goal.buildId)), []);
  assert.equal(store.claimed('overworld').size, 2);
  assert.equal(store.claimed('overworld', goal.buildId).size, 0);
});

test('a requested spot places the structure there instead of beside the bot', () => {
  const bot = world();
  const anchor = new Vec3(40, 62, -30);
  const chosen = selectSchematicSite(bot, schematic(), { anchor });
  assert(chosen, 'the requested spot is buildable');
  assert(Math.abs(chosen.origin.x - anchor.x) <= 6 && Math.abs(chosen.origin.z - anchor.z) <= 6,
    `origin ${JSON.stringify(chosen.origin)} should sit at the requested spot`);

  // Without a requested spot the ordinary search still applies, including its
  // earthworks fallback; with one, an unusable spot is reported, never moved.
  const unanchored = selectSchematicSite(bot, schematic());
  assert(unanchored);
  assert(Math.abs(unanchored.origin.x - anchor.x) > 6 || Math.abs(unanchored.origin.z - anchor.z) > 6,
    'without a requested spot it still picks its own site near the bot');
});

test('an extension stands on and builds into Jev\'s own structure', () => {
  const blocks = {}, owned = new Set();
  // A wide platform of Jev's planks where bare terrain would be refused.
  for (let x = 20; x <= 60; x++) for (let z = -50; z <= -10; z++) {
    blocks[`${x},62,${z}`] = 'oak_planks';
    owned.add(`${x},62,${z}`);
  }
  const bot = world({ blocks });
  const anchor = new Vec3(40, 63, -30);
  assert.equal(selectSchematicSite(bot, schematic(), { anchor }), null,
    'planks are not natural ground, so on their own they are player property to stay off');
  const chosen = selectSchematicSite(bot, schematic(), { anchor, owned });
  assert(chosen, 'its own structure is somewhere it may stand and build');
  assert.equal(chosen.origin.y, 62, 'the new work ties into the existing floor rather than stacking above it');
});

test('a few blocks in the way are built around, and a site full of them is refused', () => {
  const anchor = new Vec3(40, 62, -30);
  const inTheWay = { '40,63,-30': 'chest', '41,63,-30': 'chest' };
  const chosen = selectSchematicSite(world({ blocks: inTheWay }), schematic(), { anchor });
  assert(chosen, 'a couple of player blocks do not rule out the site');
  const kept = new Set((chosen.preserved || []).map(p => `${p.x},${p.y},${p.z}`));
  for (const key of Object.keys(inTheWay)) {
    if (!kept.has(key)) continue;
    // Preserved cells are dropped from the plan, so nothing ever clears them.
    assert(!chosen.blocks.some(p => `${p.x},${p.y},${p.z}` === key), 'a preserved block is not scheduled for placement');
    assert(!chosen.empty.some(p => `${p.x},${p.y},${p.z}` === key), 'a preserved block is not required to be air');
  }

  const crowded = {};
  for (let x = 20; x <= 60; x++) for (let z = -50; z <= -10; z++) for (let y = 62; y <= 66; y++) crowded[`${x},${y},${z}`] = 'chest';
  assert.equal(selectSchematicSite(world({ blocks: crowded }), schematic(), { anchor }), null,
    'a site that is mostly someone else\'s building is refused rather than quietly moved');
});

test('continuing existing work can only name a structure that was offered', async () => {
  const builds = [{ id: 'barn-1', name: 'Barn', request: 'build a barn', status: 'complete', origin: { x: 0, y: 62, z: 0 }, distance: 9 }];
  const client = answers => ({ systemOne: async () => ({ answers }) });

  const extend = await resolveBuildContinuation(client({ mode: { choice: 'edit' }, target: { choice: 'barn-1' }, placement: { choice: 'beside_target' } }), 'add a porch', builds);
  assert.equal(extend.mode, 'edit'); assert.equal(extend.target.id, 'barn-1'); assert.equal(extend.placement, 'beside_target');
  // An edit tears out what the new drawing leaves out: an unsure one is
  // built fresh beside the structure instead.
  const unsure = await resolveBuildContinuation(client({ mode: { choice: 'edit', confidence: 0.55 }, target: { choice: 'barn-1', confidence: 0.9 }, placement: { choice: 'anywhere' } }), 'do something with the barn', builds);
  assert.equal(unsure.mode, 'fresh'); assert.equal(unsure.placement, 'beside_target'); assert(unsure.unsureEdit);

  await assert.rejects(resolveBuildContinuation(client({ mode: { choice: 'edit' }, target: { choice: 'invented' }, placement: { choice: 'anywhere' } }), 'x', builds),
    /unoffered structure/);
  await assert.rejects(resolveBuildContinuation(client({ mode: { choice: 'demolish' } }), 'x', builds),
    /Invalid build continuation mode/);

  // Continuing needs something to continue; without a target it is a new build.
  const stray = await resolveBuildContinuation(client({ mode: { choice: 'finish' }, target: { choice: 'none' }, placement: { choice: 'here' } }), 'x', builds);
  assert.equal(stray.mode, 'fresh'); assert.equal(stray.placement, 'here');

  // With nothing built yet there is nothing to continue, but where the
  // structure goes still matters: asking only later made "build it here"
  // silently ignored until a second structure existed.
  const asked = [];
  const first = await resolveBuildContinuation({ systemOne: async ({ questions }) => {
    asked.push(...Object.keys(questions)); return { answers: { placement: { choice: 'here' } } };
  } }, 'build a watchtower here', []);
  assert.deepEqual(asked, ['placement'], 'no structures means no continuation questions');
  assert.equal(first.mode, 'fresh'); assert.equal(first.target, null); assert.equal(first.placement, 'here');
});

test('an extension attaches outside the structure, not on top of its own origin', async () => {
  // origin is the min corner, so a new footprint centred there is buried inside
  // the building it is meant to adjoin; the entrance is outside by construction.
  const target = { id: 'tower-1', name: 'Watchtower', request: 'build a watchtower', status: 'complete',
    origin: { x: -28, y: 71, z: -22 }, entrance: { x: -25, y: 72, z: -15 }, distance: 6 };
  const answered = await resolveBuildContinuation(
    { systemOne: async () => ({ answers: { mode: { choice: 'edit' }, target: { choice: 'tower-1' }, placement: { choice: 'beside_target' } } }) },
    'add a balcony to this tower', [target]);
  assert.equal(answered.mode, 'edit');
  assert.deepEqual(answered.target.entrance, { x: -25, y: 72, z: -15 },
    'the entrance travels with the offered structure so routing can attach to it');
});

test('a structure is never planned through the player who asked for it', () => {
  const bot = world();
  const anchor = new Vec3(40, 62, -30);
  const clear = selectSchematicSite(bot, schematic(), { anchor });
  assert(clear, 'empty ground at the requested spot is buildable');

  // Minecraft refuses to place a block intersecting a body, so a footprint over
  // the speaker fails every placement with "the block is still air".
  bot.entities = { 1: { name: 'player', username: 'Player', position: new Vec3(clear.origin.x + 1.5, clear.origin.y, clear.origin.z + 1.5), height: 1.8 } };
  const moved = selectSchematicSite(bot, schematic(), { anchor });
  assert(moved, 'it builds beside the player rather than refusing');
  const occupied = moved.blocks.some(p =>
    p.x === Math.floor(clear.origin.x + 1.5) && p.z === Math.floor(clear.origin.z + 1.5) &&
    p.y >= clear.origin.y && p.y < clear.origin.y + 2);
  assert(!occupied, 'no solid cell is planned inside the player');

  // The bot steps aside before placing, so its own body never rules a site out.
  bot.entities = {};
  bot.entity = { position: new Vec3(clear.origin.x + 1.5, clear.origin.y, clear.origin.z + 1.5) };
  assert(selectSchematicSite(bot, schematic(), { anchor }), 'the builder does not block its own site');
});

test('a balcony door six blocks up does not need ground beneath it', () => {
  // An elevated entrance is reached from inside the structure. validateSchematic
  // already checks it has a floor there, so also demanding natural ground
  // outside it rejects every balcony and every upper storey.
  const elevated = { ...source, size: [5, 8, 5], entrance: [2, 6, 0], regions: [
    { from: [0, 0, 0], to: [4, 0, 4], block: 'oak_planks', properties: null },
    { from: [0, 1, 4], to: [4, 7, 4], block: 'oak_planks', properties: null },
    { from: [0, 1, 0], to: [0, 7, 0], block: 'oak_planks', properties: null },
    { from: [4, 1, 0], to: [4, 7, 0], block: 'oak_planks', properties: null },
    { from: [0, 5, 0], to: [4, 5, 4], block: 'oak_planks', properties: null },
  ] };
  const schematic = validateSchematic(elevated, registry);
  assert.deepEqual(schematic.source.entrance, [2, 6, 0], 'the design really does put its door upstairs');
  const site = selectSchematicSite(world(), schematic, { anchor: new Vec3(40, 62, -30) });
  assert(site, 'an upstairs doorway is not a reason to refuse the whole site');
  assert.equal(site.entrance.y, site.origin.y + 6, 'the recorded entrance stays where the design put it');

  // A ground-level doorway still needs something to stand on outside it.
  const hovering = { ...source, size: [5, 5, 5], entrance: [2, 1, 0] };
  const onGround = selectSchematicSite(world(), validateSchematic(hovering, registry), { anchor: new Vec3(40, 62, -30) });
  assert(onGround, 'flat ground still supports an ordinary entrance');
});

test('a structure barely begun and abandoned is not offered as something to continue', () => {
  // A false start and a finished building are both "unfinished" in the
  // registry. Without knowing how much of each is really there, the request
  // classifier picks between them by name, and "the tower" lands on rubble.
  const store = new BuildRegistry(null);
  const cells = n => Array.from({ length: n }, (_, i) => ({ x: i, y: 62, z: 0, material: 'oak_planks' }));
  store.remember(buildGoal('Standing Tower', { x: 0, y: 62, z: 0 }, cells(8)), { dimension: 'overworld' });
  store.remember(buildGoal('Abandoned Tower', { x: 40, y: 62, z: 0 }, cells(8).map(c => ({ ...c, x: c.x + 40 }))), { dimension: 'overworld' });
  // Only the first structure's planks were ever placed.
  const built = new Set(cells(8).map(c => `${c.x},${c.y},${c.z}`));
  const bot = world({ blocks: Object.fromEntries([...built].map(k => [k, 'oak_planks'])) });

  const offered = store.describe(bot, new Vec3(0, 62, 0), 'overworld');
  assert.deepEqual(offered.map(o => o.name), ['Standing Tower'], 'only what is actually there is on the table');
  assert.equal(offered[0].standing, 100);
});

test('rebuilding the same place updates that structure instead of listing it twice', () => {
  // A new goal has no buildId, so keying only on that appends a second entry
  // for one building and offers the classifier the same tower under two names.
  const store = new BuildRegistry(null);
  const at = { x: 10, y: 62, z: 0 }, cell = [{ x: 10, y: 62, z: 0, material: 'oak_planks' }];
  const first = buildGoal('Watchtower', at, cell);
  store.remember(first, { dimension: 'overworld' });
  const second = buildGoal('Watchtower Balcony', at, cell);
  store.remember(second, { dimension: 'overworld' });

  assert.equal(store.all('overworld').length, 1, 'one structure stands there, so one entry describes it');
  assert.equal(store.all('overworld')[0].name, 'Watchtower Balcony', 'the latest design is what is there now');
  assert.equal(second.buildId, first.buildId, 'and the goal carries on with that structure');

  store.remember(buildGoal('Shed', { x: 40, y: 62, z: 0 }, cell), { dimension: 'overworld' });
  assert.equal(store.all('overworld').length, 2, 'a different place is still a different structure');
});

test('a thin structure like an arch is buildable, and an oversized one says which axis', () => {
  // The size cap is about how long a build takes to place block by block, which
  // says nothing about a floor under each axis. A rainbow two blocks deep was
  // rejected as if it were too large, and the retry kept shrinking it.
  const arch = { name: 'Rainbow Arch', description: 'An arch two blocks deep', size: [15, 8, 2],
    palette: ['red_wool', 'orange_wool'], entrance: null, regions: [
      { from: [0, 0, 0], to: [0, 6, 1], block: 'red_wool' },
      { from: [14, 0, 0], to: [14, 6, 1], block: 'red_wool' },
      { from: [0, 7, 0], to: [14, 7, 1], block: 'orange_wool' },
    ] };
  const built = validateSchematic(arch, registry);
  assert.equal(built.source.size[2], 2, 'two blocks deep is a shape, not a violation');
  assert(built.blocks.length > 0);

  // An ordinary request should stay small, but something big by nature is
  // built at the size it deserves rather than shrunk to fit.
  const wide = { ...arch, size: [40, 8, 2], regions: [
    { from: [0, 0, 0], to: [0, 6, 1], block: 'red_wool' },
    { from: [39, 0, 0], to: [39, 6, 1], block: 'red_wool' },
    { from: [0, 7, 0], to: [39, 7, 1], block: 'orange_wool' },
  ] };
  assert(validateSchematic(wide, registry), 'past the everyday size, still well inside what Jev will attempt');
  assert(CEILING.width > LIMITS.width && CEILING.blocks > LIMITS.blocks, 'the everyday size is the smaller of the two');

  assert.throws(() => validateSchematic({ ...arch, size: [CEILING.width + 1, 8, 2] }, registry),
    new RegExp(`width is ${CEILING.width + 1}, and the most Jev can build is ${CEILING.width}`),
    'the retry is told which axis and by how much, not just that it is too big');
  assert.throws(() => validateSchematic({ ...arch, size: [15, CEILING.height + 1, 2] }, registry), /^(?!.*width).*height is/s);
});

test('changing a building is one mode, and restoring it is another', () => {
  // "Get rid of the bank part on top and just make it a pig" was routed to
  // repair, whose whole promise is to leave the design alone: Jev looked the
  // building over, found nothing broken, and considered the job done. The
  // mode names are the only thing the classifier reads, and "extend" reads as
  // adding, so taking something away had nowhere else to land.
  const { MODES } = require('../src/builds');
  assert(!('extend' in MODES), 'no mode is named for adding alone');
  assert(MODES.edit, 'there is a mode for changing a building');

  for (const word of ['taking part of it away', 'reshaping', 'redecorating']) {
    assert(MODES.edit.includes(word), `edit covers ${word}`);
  }
  assert(/never for changing the design/i.test(MODES.repair),
    'repair says outright that it is not for design changes');
  assert(!/\badd\b/i.test(MODES.repair) && !/remove|reshape/i.test(MODES.repair),
    'and does not invite them either');
});

test('a new part owns nothing of its neighbours, so their walls are never taken for scaffolding', () => {
  const store = new BuildRegistry(null);
  const cottage = buildGoal('Cottage', { x: 0, y: 62, z: 0 }, [{ x: 0, y: 62, z: 0, material: 'cobblestone' }, { x: 1, y: 62, z: 0, material: 'cobblestone' }]);
  store.remember(cottage, { dimension: 'overworld' });
  const standing = world({ blocks: { '0,62,0': 'cobblestone', '1,62,0': 'cobblestone' } });
  const bounds = { min: { x: -3, y: 60, z: -3 }, max: { x: 4, y: 66, z: 3 } };
  assert.deepEqual(store.ownership(standing, bounds, 'overworld', undefined, { only: 'lamp-post' }), {}, 'a lamp post beside it owns none of the cottage');
  assert.deepEqual(Object.keys(store.ownership(standing, bounds, 'overworld', undefined, { only: cottage.buildId })).sort(), ['0,62,0', '1,62,0'], 'an edit of the cottage owns the cottage');
});

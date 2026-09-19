'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { Vec3 } = require('vec3');
const { installBlockSearch } = require('../src/block-search');
const registry = require('prismarine-registry')('26.1');
const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);

function fixture() {
  const bot = Object.assign(new EventEmitter(), { registry, _client: new EventEmitter(),
    supportFeature: name => registry.supportFeature(name),
    game: { minY: -64, height: 384, dimension: 'overworld' }, entity: { position: new Vec3(-0.5, -43, 0.5) },
    world: new World().sync });
  require('mineflayer/lib/plugins/blocks')(bot, { version: '26.1' });
  for (let x = -2; x <= 1; x++) for (let z = -2; z <= 1; z++) {
    const chunk = new Chunk();
    for (let lx = 0; lx < 16; lx++) for (let y = -48; y < -32; y++) for (let lz = 0; lz < 16; lz++) {
      const ore = (lx * 31 + lz * 17 + y * 13 + x * 7 + z * 19) % 127 === 0;
      chunk.setBlockStateId(new Vec3(lx, y, lz), registry.blocksByName[ore ? 'iron_ore' : 'stone'].defaultState);
    }
    bot.world.setColumn(x, z, chunk);
  }
  const original = bot.findBlocks;
  installBlockSearch(bot);
  return { bot, original };
}
const names = results => results.map(p => p.toString());

test('fast numeric search preserves Mineflayer results across negative coordinates, radius, count and predicates', async () => {
  const { bot, original } = fixture();
  for (const maxDistance of [4, 16, 48]) for (const count of [1, 32]) for (const useExtraInfo of [false, b => b.position.y < -40 && b.position.x >= -15]) {
    const options = { matching: [registry.blocksByName.iron_ore.id], maxDistance, count, useExtraInfo };
    const expected = names(original(options));
    assert.deepEqual(names(bot.findBlocks(options)), expected);
    assert.deepEqual(names(await bot.findBlocksAsync(options)), expected);
  }
  assert.deepEqual(bot.findBlocks({ matching: [], maxDistance: 48 }), []);
  const missing = { matching: registry.blocksByName.diamond_ore.id, maxDistance: 48 };
  assert.deepEqual(bot.findBlocks(missing), original(missing));
  const custom = { matching: b => b?.name === 'iron_ore', maxDistance: 8, count: 4 };
  assert.deepEqual(names(bot.findBlocks(custom)), names(original(custom)), 'Custom matchers retain upstream behavior');
});

test('sparse resource scan constructs detailed blocks only for matching cells', () => {
  const { bot } = fixture(), originalBlockAt = bot.blockAt;
  let inspected = 0, accepted = 0;
  bot.blockAt = p => { inspected++; return originalBlockAt(p); };
  const found = bot.findBlocks({ matching: [registry.blocksByName.iron_ore.id], maxDistance: 48, count: 32,
    useExtraInfo: () => { accepted++; return true; } });
  assert.equal(found.length, 32);
  assert.equal(inspected, accepted);
  assert(inspected < 1000, `Sparse search should not construct every stone block (${inspected})`);
});

test('expensive rejected candidates yield to heartbeats and cancellation', async () => {
  const { bot } = fixture();
  let cancelled = false, checked = 0, heartbeat = false;
  const timer = setTimeout(() => { heartbeat = true; cancelled = true; }, 15);
  try {
    await assert.rejects(bot.findBlocksAsync({ matching: registry.blocksByName.stone.id, maxDistance: 48, count: 1,
      useExtraInfo: () => { const end = performance.now() + .1; while (performance.now() < end) {} return false; } },
    () => { checked++; if (cancelled) throw new Error('task cancelled'); }), /task cancelled/);
    assert(heartbeat); assert(checked >= 2);
  } finally { clearTimeout(timer); }
});

test('a dimension change interrupts an in-flight scan', async () => {
  const { bot } = fixture();
  const timer = setTimeout(() => { bot.game.dimension = 'the_nether'; }, 15);
  try {
    await assert.rejects(bot.findBlocksAsync({ matching: registry.blocksByName.stone.id, maxDistance: 48, count: 1,
      useExtraInfo: () => { const end = performance.now() + .1; while (performance.now() < end) {} return false; } }), /World changed/);
  } finally { clearTimeout(timer); }
});

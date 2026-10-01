'use strict';
// Note 795. The event loop's holds (2026-09-30T06Z to 10-01T04:57Z): 2,818
// of 2 seconds or more in the bot logs, 79% of their seconds in minutes when
// five or more bots held at once (the machine), and the bots' own share in
// synchronous world searches that built a mineflayer Block for every cell of
// stone round them: the climb's landing search, explore's ground, the swim's
// shore, the catalog's look about, the portal in view. Each is cut by
// refusals read from the cell's state before the Block is built, each one a
// cell its predicate refuses anyway; the sky over a cell is read by state,
// an empty section passed whole; the climb's, explore's and the shore's
// searches give the game its turn as they read. The same cells found.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('26.1');
const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
const { installBlockSearch, worldCells, findBlocksYielding } = require('../src/block-search');

// A bot on mineflayer's own blockAt and findBlocks over a prismarine world,
// the block search installed as compatibility.js does: a world of stone and
// deepslate with caves, a lake, slabs, top trapdoors, leaves, logs, lava,
// cobwebs and open sky, chunks -2..1 loaded, from y -64 to 100.
function fixture({ at = new Vec3(0.5, 20, 0.5), kindAt = defaultWorld } = {}) {
  const bot = Object.assign(new EventEmitter(), { registry, _client: new EventEmitter(),
    supportFeature: name => registry.supportFeature(name), entities: {},
    game: { minY: -64, height: 384, dimension: 'overworld' }, entity: { position: at.clone() },
    world: new World().sync });
  require('mineflayer/lib/plugins/blocks')(bot, { version: '26.1' });
  const state = (name, props) => {
    const b = registry.blocksByName[name];
    if (!props) return b.defaultState;
    const Block = require('prismarine-block')(registry);
    return Block.fromProperties(name, props, 0).stateId;
  };
  for (let cx = -2; cx <= 1; cx++) for (let cz = -2; cz <= 1; cz++) {
    const chunk = new Chunk({ minY: -64, worldHeight: 384 });
    for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) for (let y = -64; y < 100; y++) {
      const kind = kindAt(cx * 16 + lx, y, cz * 16 + lz);
      if (kind) chunk.setBlockStateId(new Vec3(lx, y, lz), Array.isArray(kind) ? state(...kind) : state(kind));
    }
    bot.world.setColumn(cx, cz, chunk);
  }
  const original = bot.findBlocks;
  installBlockSearch(bot);
  return { bot, original };
}
function defaultWorld(x, y, z) {
  const h = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
  const ground = 40 + ((x * 3 + z * 5) % 7 + 7) % 7;
  if (y > ground) {
    if (y === ground + 1 && h % 41 === 0) return ['oak_slab', { type: 'bottom' }];
    if (y === ground + 2 && h % 37 === 0) return ['oak_trapdoor', { half: 'top', open: false, waterlogged: false }];
    if (y <= ground + 4 && h % 53 === 0) return 'oak_leaves';
    if (y <= ground + 3 && h % 59 === 0) return 'oak_log';
    if (y <= ground + 2 && Math.abs(x + 12) <= 4 && Math.abs(z - 6) <= 4) return 'water';
    return null;
  }
  if (y >= 10 && y <= 14 && Math.abs(x) <= 9 && Math.abs(z) <= 9) return h % 47 === 0 ? 'cobweb' : h % 61 === 0 ? 'lava' : null;
  if (y >= 18 && y <= 22 && (Math.abs(x - 5) <= 3 || Math.abs(z + 4) <= 2)) return null;
  if (y < -10) return 'deepslate';
  return h % 29 === 0 ? 'dirt' : h % 31 === 0 ? 'gravel' : 'stone';
}
const names = list => list.map(String);
// The bot as it was before note 795: a blockAt that is not the world's own.
const asBefore = bot => Object.assign(Object.create(bot), { blockAt: (p, extra) => bot.blockAt(p, extra) });

test('openAbove and exposed find what the predicate alone finds, and build far fewer Blocks', () => {
  const { terrain } = { terrain: require('../src/terrain') };
  for (const at of [new Vec3(0.5, 20, 0.5), new Vec3(-12.5, 46, 6.5), new Vec3(3.5, 47, -20.5)]) {
    const { bot } = fixture({ at });
    const real = bot.blockAt;
    let built = 0;
    bot.blockAt = (p, e) => { built++; return real(p, e); };
    bot._worldBlockAt = bot.blockAt;
    const ids = ['stone', 'deepslate', 'dirt', 'gravel'].map(n => registry.blocksByName[n].id);
    const twoClear = b => terrain.dryPassable(bot.blockAt(b.position.offset(0, 1, 0))) && terrain.dryPassable(bot.blockAt(b.position.offset(0, 2, 0)));
    const standing = b => require('../src/mining-access').dryStanding(bot, b.position.offset(0, 1, 0));
    for (const useExtraInfo of [twoClear, standing]) {
      built = 0;
      const want = bot.findBlocks({ matching: ids, maxDistance: 32, count: 300, useExtraInfo });
      const plain = built; built = 0;
      const have = bot.findBlocks({ matching: ids, maxDistance: 32, count: 300, openAbove: 2, useExtraInfo });
      assert.deepEqual(names(have), names(want), `${at}: the same cells`);
      assert(want.length > 0, `${at}: something found`);
      assert(built * 5 < plain, `${at}: ${built} Blocks built against ${plain}`);
    }
    const faces = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].map(f => new Vec3(...f));
    const exposed = b => faces.some(f => ['air', 'cave_air', 'void_air'].includes(bot.blockAt(b.position.plus(f))?.name));
    built = 0;
    const want = bot.findBlocks({ matching: ids, maxDistance: 32, count: 48, useExtraInfo: exposed });
    const plain = built; built = 0;
    assert.deepEqual(names(bot.findBlocks({ matching: ids, maxDistance: 32, count: 48, exposed: true, useExtraInfo: exposed })), names(want));
    assert(built * 3 < plain, `${at}: exposed built ${built} against ${plain}`);
  }
});

test('a slab, a top trapdoor, leaves or water over the floor are left to the predicate; only a full cube or a hazard is refused unread', () => {
  // A floor whose head cell holds a top trapdoor stands a body (dryBodySpace
  // passes it: its shape starts 0.81 up); the full cube over the next floor
  // does not.
  const kindAt = (x, y, z) => {
    if (y < 40) return 'stone';
    if (y === 40) return x === 0 && z === 0 ? 'stone' : x === 2 && z === 0 ? 'stone' : x === 4 && z === 0 ? 'stone' : null;
    if (x === 0 && z === 0 && y === 42) return ['oak_trapdoor', { half: 'top', open: false, waterlogged: false }];
    if (x === 2 && z === 0 && y === 42) return 'stone';
    if (x === 4 && z === 0 && y === 41) return 'water';
    return null;
  };
  const { bot } = fixture({ at: new Vec3(0.5, 41, 0.5), kindAt });
  const ids = [registry.blocksByName.stone.id];
  const standing = b => b.position.y === 40 && require('../src/mining-access').dryStanding(bot, b.position.offset(0, 1, 0));
  const want = bot.findBlocks({ matching: ids, maxDistance: 8, count: 10, useExtraInfo: standing });
  assert.deepEqual(names(bot.findBlocks({ matching: ids, maxDistance: 8, count: 10, openAbove: 2, useExtraInfo: standing })), names(want));
  assert.deepEqual(names(want), [String(new Vec3(0, 40, 0))], 'the floor under the top trapdoor stands a body; under stone or water none does');
});

test('the sky over a cell read by state says what reading Block by Block said, an empty section passed whole', () => {
  const { surfaceObserver } = require('../src/surface');
  for (const at of [new Vec3(0.5, 20, 0.5), new Vec3(-12.5, 46, 6.5)]) {
    const { bot } = fixture({ at });
    assert(worldCells(bot), 'the world\'s own blockAt is read by state');
    assert.equal(worldCells(asBefore(bot)), null, 'a view over the bot is read Block by Block');
    const fast = surfaceObserver(bot), slow = surfaceObserver(asBefore(bot));
    let open = 0, n = 0;
    for (let x = -40; x < 40; x += 3) for (let z = -40; z < 40; z += 3) for (let y = -60; y < 120; y += 4) {
      const p = new Vec3(x + 0.5, y, z + 0.5), a = fast(p);
      assert.equal(a, slow(p), `${p}`);
      n++; if (a) open++;
    }
    assert(open > 0 && open < n, `${at}: both open and covered cells read (${open} of ${n})`);
  }
  // The open column over a point on the ground: a few sections, not every cell.
  const { bot } = fixture({ at: new Vec3(3.5, 50, 3.5) });
  let reads = 0;
  const column = bot.world.getColumnAt(new Vec3(3, 50, 3)), get = column.getBlockStateId.bind(column);
  column.getBlockStateId = p => { reads++; return get(p); };
  assert.equal(surfaceObserver(bot)(new Vec3(3.5, 50, 3.5)), true);
  assert(reads < 40, `${reads} cells read to the world's top`);
});

test('the climb\'s landings, explore\'s ground and the shore\'s landings are the same cells as before', async () => {
  const surface = require('../src/surface'), work = require('../src/work'), shore = require('../src/shore');
  const { dryStanding } = require('../src/mining-access');
  for (const at of [new Vec3(0.5, 20, 0.5), new Vec3(-12.5, 46, 6.5), new Vec3(3.5, 47, -20.5)]) {
    const { bot, original } = fixture({ at });
    // Before: mineflayer's own findBlocks (no state refusals), Block by Block.
    const before = Object.assign(asBefore(bot), { findBlocks: o => original(o) });
    const start = bot.entity.position.floored();
    const landings = surface.surfaceCandidates(before, start);
    assert.deepEqual(names(surface.surfaceCandidates(bot, start)), names(landings));
    assert.deepEqual(names(await surface.surfaceCandidatesYielding(bot, start)), names(landings));
    const ids = work.exploreLandIds(bot);
    const ground = work.exploreLand(before, ids, null);
    assert.deepEqual(names(work.exploreLand(bot, ids, null)), names(ground));
    assert(ground.length > 0);
    const waterY = Math.floor(at.y), safe = b => p => p.y >= waterY - 3 && dryStanding(b, p);
    assert.deepEqual(names(await shore.shoreLandYielding(bot, safe(bot))), names(shore.shoreLand(before, safe(before))));
    assert.deepEqual(names([shore.landingsAbout(bot, [], { reach: 32 }).nearest].filter(Boolean).map(p => new Vec3(p.x, p.y, p.z))),
      names([shore.landingsAbout(before, [], { reach: 32 }).nearest].filter(Boolean).map(p => new Vec3(p.x, p.y, p.z))));
  }
});

test('a search that yields lets a timer run while it reads, and a cancelled task ends it', async () => {
  const { bot } = fixture();
  const ids = ['stone', 'deepslate'].map(n => registry.blocksByName[n].id);
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 1);
  const slowPredicate = () => { const end = Date.now() + 0.05; while (Date.now() < end); return false; };
  try {
    await findBlocksYielding(bot, { matching: ids, maxDistance: 6, count: 1, useExtraInfo: slowPredicate });
    assert(ticks > 0, 'the game had turns while the search read');
    let cancelled = false;
    setTimeout(() => { cancelled = true; }, 20);
    await assert.rejects(findBlocksYielding(bot, { matching: ids, maxDistance: 16, count: 1, useExtraInfo: slowPredicate },
      () => { if (cancelled) throw new Error('task cancelled'); }), /task cancelled/);
  } finally { clearInterval(timer); }
  // A bot with no findBlocksAsync (a test's world): the plain search.
  assert.deepEqual(await findBlocksYielding({ findBlocks: () => [1, 2] }, {}), [1, 2]);
});

test('the portal in view is found by its id, the same portal as by a function of the Block', () => {
  const kindAt = (x, y, z) => y < 64 ? 'netherrack' : (x === 9 && z === -7 && y >= 64 && y <= 66) ? 'nether_portal' : null;
  const { bot, original } = fixture({ at: new Vec3(0.5, 64, 0.5), kindAt });
  bot.game.dimension = 'the_nether';
  const { portalBack } = require('../src/mob-hunt');
  const back = portalBack(bot, {}, bot.entity.position);
  const want = original({ matching: b => b?.name === 'nether_portal', maxDistance: 64 })[0];
  assert.equal(String(back.portal), String(want));
  assert.match(back.says, /the one in view 11 blocks off at 9, 64, -7/);
});

test('a hold reaches the flight record, and a slow search is kept for the watch to name', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-795-'));
  try {
    const recorder = require('../src/recorder').startRecorder({ directory: dir, label: 'lag-test' });
    assert.equal(typeof recorder.record, 'function');
    recorder.record({ kind: 'lag', label: 'event loop held 3.1s', detail: { lagMs: 3100, slow: 'findBlocks 2900 ms (src/surface.js:690)' } });
    const frame = recorder.trace.frames.at(-1);
    assert.equal(frame.kind, 'lag');
    assert.equal(frame.detail.slow, 'findBlocks 2900 ms (src/surface.js:690)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const lines = [];
  const bot = { findBlocks: () => { const t = Date.now(); while (Date.now() - t < 30); return [1]; } };
  require('../src/slow-calls').install(bot, { log: l => lines.push(l), slowMs: 10 });
  bot.findBlocks({ maxDistance: 8 });
  assert.equal(lines.length, 1);
  assert.equal(bot._slowLast.what, 'findBlocks');
  assert(bot._slowLast.ms >= 10 && Date.now() - bot._slowLast.at < 1000);
  assert.match(bot._slowLast.caller, /test\/note-795\.test\.js|note-795/);
});

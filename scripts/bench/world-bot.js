'use strict';
// A bot standing in a saved world, for timing the synchronous world searches
// offline (note 795): the world's region files read into prismarine-world
// columns (each block at its kind's default state), the bot's blockAt as
// mineflayer's, findBlocks as mineflayer's with the bot's own block search
// (src/block-search.js) installed over it, as src/compatibility.js does live.
// Not a test of behavior: no physics, no entities, no pathfinder.
const { Vec3 } = require('vec3');
const { readChunk } = require('../lib/save-spot');

function worldBot(worldDir, at, { dimension = 'overworld', radiusChunks = 6, version = '26.1' } = {}) {
  const registry = require('prismarine-registry')(version);
  const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
  const minY = dimension === 'overworld' ? -64 : 0, height = dimension === 'overworld' ? 384 : 256;
  const world = new World(null).sync;
  const cx0 = Math.floor(at.x / 16), cz0 = Math.floor(at.z / 16);
  const stateOf = new Map();
  const state = name => {
    if (!stateOf.has(name)) stateOf.set(name, registry.blocksByName[name]?.defaultState ?? registry.blocksByName.stone.defaultState);
    return stateOf.get(name);
  };
  let loaded = 0;
  for (let cx = cx0 - radiusChunks; cx <= cx0 + radiusChunks; cx++) for (let cz = cz0 - radiusChunks; cz <= cz0 + radiusChunks; cz++) {
    let sections; try { sections = readChunk(worldDir, dimension, cx, cz); } catch (_) { sections = null; }
    if (!sections) continue;
    const column = new Chunk({ minY, worldHeight: height });
    const p = new Vec3(0, 0, 0);
    for (const [sy, sec] of Object.entries(sections)) {
      const baseY = Number(sy) * 16;
      if (baseY < minY || baseY >= minY + height) continue;
      if (!sec.indices) {
        const s = state(sec.palette[0]); if (s === 0 || /^(air|cave_air|void_air)$/.test(sec.palette[0])) continue;
        for (let i = 0; i < 4096; i++) { p.x = i & 15; p.z = (i >> 4) & 15; p.y = baseY + (i >> 8); column.setBlockStateId(p, s); }
        continue;
      }
      const ids = sec.palette.map(state);
      for (let i = 0; i < 4096; i++) { p.x = i & 15; p.z = (i >> 4) & 15; p.y = baseY + (i >> 8); column.setBlockStateId(p, ids[sec.indices[i]]); }
    }
    world.setColumn(cx, cz, column); loaded++;
  }
  const bot = {
    registry, version, world, entities: {}, username: 'Jev', health: 20, food: 20,
    game: { minY, height, dimension }, entity: { position: new Vec3(at.x, at.y, at.z), velocity: new Vec3(0, 0, 0), onGround: true, height: 1.8, yaw: 0, pitch: 0, eyeHeight: 1.62 },
    inventory: { items: () => [], slots: [] }, heldItem: null, controlState: {},
    on() {}, once() {}, removeListener() {}, emit() {},
  };
  // mineflayer's own blockAt and findBlocks (lib/plugins/blocks.js), as
  // test/block-search.test.js loads them.
  const { EventEmitter } = require('node:events');
  Object.setPrototypeOf(bot, EventEmitter.prototype); EventEmitter.call(bot);
  delete bot.on; delete bot.once; delete bot.removeListener; delete bot.emit;
  Object.assign(bot, { _client: new EventEmitter(), supportFeature: name => registry.supportFeature(name) });
  require('mineflayer/lib/plugins/blocks')(bot, { version });
  require('../../src/block-search').installBlockSearch(bot);
  return { bot, loaded };
}

// Milliseconds a call takes: the median of `runs`, after one warm run.
function time(fn, runs = 5) {
  fn();
  const all = [];
  for (let i = 0; i < runs; i++) { const t0 = process.hrtime.bigint(); fn(); all.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  all.sort((a, b) => a - b);
  return Math.round(all[Math.floor(runs / 2)]);
}

module.exports = { worldBot, time };

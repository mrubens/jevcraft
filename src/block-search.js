'use strict';
const { Vec3 } = require('vec3');
const { iterators: { OctahedronIterator } } = require('prismarine-world');
const { performance } = require('node:perf_hooks');
const { setImmediate: yieldToGame } = require('node:timers/promises');

// Mineflayer constructs a full Block (light, biome, entities, shapes) for every
// cell in a candidate section. Numeric catalog searches only need that object
// after its state ID matches. Keep the upstream traversal and nearest ordering.
function* scan(bot, options) {
  const types = new Set(Array.isArray(options.matching) ? options.matching : [options.matching]);
  if (!types.size) return [];
  const point = (options.point || bot.entity.position).floored();
  const distance = options.maxDistance || 16, count = options.count || 1;
  const start = new Vec3(Math.floor(point.x / 16), Math.floor(point.y / 16), Math.floor(point.z / 16));
  const iterator = new OctahedronIterator(start, Math.ceil((distance + 8) / 16));
  const visited = new Set(), blocks = [], states = bot.registry.blocksByStateId;
  const matches = state => types.has(states[state]?.id);
  let next = start, layer = 0;
  while (next) {
    const key = next.toString(), column = bot.world.getColumn(next.x, next.z);
    const sectionY = next.y - (bot.game.minY >> 4);
    if (column && sectionY >= 0 && sectionY < (bot.game.height >> 4) && !visited.has(key)) {
      const section = column.sections[sectionY];
      if (section && (!section.palette || section.palette.some(matches))) {
        const p = new Vec3(0, next.y * 16, 0), local = new Vec3(0, p.y, 0);
        scanColumn: for (let x = 0; x < 16; x++) {
          p.x = next.x * 16 + x; local.x = x;
          for (let y = 0; y < 16; y++) {
            if (bot.world.getColumn(next.x, next.z) !== column) break scanColumn;
            p.y = next.y * 16 + y; local.y = p.y;
            for (let z = 0; z < 16; z++) {
              p.z = next.z * 16 + z; local.z = z;
              if (p.distanceTo(point) > distance || !matches(column.getBlockStateId(local))) continue;
              if (typeof options.useExtraInfo === 'function') {
                const block = bot.blockAt(p);
                if (!block || !types.has(block.type) || !options.useExtraInfo(block)) continue;
              }
              blocks.push(p.clone());
            }
            // Bound each slice even when predicates reject every resource.
            yield;
          }
        }
      }
      visited.add(key);
    }
    if (layer !== iterator.apothem && blocks.length >= count) break;
    layer = iterator.apothem;
    next = iterator.next();
    yield;
  }
  return blocks.sort((a, b) => a.distanceTo(point) - b.distanceTo(point)).slice(0, count);
}

function supported(bot, options) {
  const ids = Array.isArray(options.matching) ? options.matching : [options.matching];
  return ids.every(Number.isInteger) && bot.world?.getColumn && bot.registry?.blocksByStateId &&
    Number.isInteger(bot.game?.minY) && Number.isInteger(bot.game?.height);
}

function installBlockSearch(bot) {
  if (bot.findBlocksAsync) return;
  const original = bot.findBlocks;
  bot.findBlocks = options => {
    if (!supported(bot, options)) return original(options);
    const search = scan(bot, options);
    let result; do { result = search.next(); } while (!result.done);
    return result.value;
  };
  bot.findBlocksAsync = async (options, check = () => {}) => {
    check();
    if (!supported(bot, options)) return bot.findBlocks(options);
    const search = scan(bot, options), world = bot.world, dimension = bot.game.dimension;
    let deadline = performance.now() + 8;
    for (;;) {
      if (bot.world !== world || bot.game.dimension !== dimension) throw new Error('World changed during resource search');
      const result = search.next();
      if (result.done) { check(); return result.value; }
      if (performance.now() >= deadline) {
        await yieldToGame();
        check();
        deadline = performance.now() + 8;
      }
    }
  };
}

module.exports = { installBlockSearch };

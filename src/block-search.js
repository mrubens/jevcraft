'use strict';
const { Vec3 } = require('vec3');
const { iterators: { OctahedronIterator } } = require('prismarine-world');
const { performance } = require('node:perf_hooks');
const { setImmediate: yieldToGame } = require('node:timers/promises');

// Mineflayer constructs a full Block (light, biome, entities, shapes) for every
// cell in a candidate section. Numeric catalog searches only need that object
// after its state ID matches. Keep the upstream traversal and nearest ordering.
//
// Two refusals by state, read before that Block is built (note 795), each
// for a predicate that refuses the cell anyway. Underground every cell of
// stone matched a landing or a shore search and was built and handed to a
// predicate that wanted two clear cells over it: the climb's landing search
// built about 340 thousand Blocks a call at 236's cave (233 ms on a quiet
// machine, 2.4 to 3.1 s live among fourteen trials).
//   openAbove: n  a cell with no room for a body in any of the n cells over
//                 it is not a candidate: a full cube (a 'block' box whose one
//                 shape is the whole cell) or one of terrain.js's travel
//                 hazards (water, lava, fire, cobweb ...), which dryPassable
//                 and dryBodySpace both refuse;
//   exposed: true a cell with no air (air, cave_air, void_air) on any of
//                 its six faces is not a candidate.
// A cell over or beside it that is not loaded is left to the predicate.
function noBodyTest(registry) {
  const Block = require('prismarine-block')(registry), { travelHazards } = require('./terrain'), known = new Map();
  return state => {
    let refused = known.get(state);
    if (refused === undefined) {
      let b = null; try { b = Block.fromStateId(state, 0); } catch (_) { b = null; }
      const shape = b?.shapes?.length === 1 ? b.shapes[0] : null;
      refused = !!b && (travelHazards.has(b.name) || (b.boundingBox === 'block' && !!shape &&
        shape[0] === 0 && shape[1] === 0 && shape[2] === 0 && shape[3] === 1 && shape[4] === 1 && shape[5] === 1));
      known.set(state, refused);
    }
    return refused;
  };
}
function coveredAbove(column, local, n, top, noBody, at) {
  at.x = local.x; at.z = local.z;
  for (let k = 1; k <= n; k++) {
    at.y = local.y + k;
    if (at.y >= top) return false;
    if (noBody(column.getBlockStateId(at))) return true;
  }
  return false;
}
const FACES = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
function airOnAFace(bot, p, airStates, at) {
  const bottom = bot.game.minY, top = bottom + bot.game.height;
  for (const [dx, dy, dz] of FACES) {
    at.x = p.x + dx; at.y = p.y + dy; at.z = p.z + dz;
    if (at.y < bottom || at.y >= top || !bot.world.getColumnAt?.(at)) return true;
    if (airStates.has(bot.world.getBlockStateId(at))) return true;
  }
  return false;
}
function airStatesOf(registry) {
  return new Set(['air', 'cave_air', 'void_air'].flatMap(n => { const b = registry.blocksByName[n]; return b ? Array.from({ length: b.maxStateId - b.minStateId + 1 }, (_, i) => b.minStateId + i) : []; }));
}

// The states a section holds: its palette, or the one value of a section
// all of one kind (a single-value section, as the server sends the air over
// the ground and much of the stone under it, keeps no palette), or null for
// the global palette.
function paletteOf(section) {
  if (!section) return null;
  if (section.palette) return section.palette;
  return section.data && 'value' in section.data ? [section.data.value] : null;
}

function* scan(bot, options) {
  const types = new Set(Array.isArray(options.matching) ? options.matching : [options.matching]);
  if (!types.size) return [];
  const point = (options.point || bot.entity.position).floored();
  const distance = options.maxDistance || 16, count = options.count || 1;
  const start = new Vec3(Math.floor(point.x / 16), Math.floor(point.y / 16), Math.floor(point.z / 16));
  const iterator = new OctahedronIterator(start, Math.ceil((distance + 8) / 16));
  const visited = new Set(), blocks = [], states = bot.registry.blocksByStateId;
  const matches = state => types.has(states[state]?.id);
  const openAbove = Number.isInteger(options.openAbove) && options.openAbove > 0 ? options.openAbove : 0;
  const noBody = openAbove ? (bot._noBodyState ||= noBodyTest(bot.registry)) : null;
  const airStates = options.exposed ? (bot._airStates ||= airStatesOf(bot.registry)) : null;
  const top = bot.game.minY + bot.game.height, above = new Vec3(0, 0, 0), beside = new Vec3(0, 0, 0);
  let next = start, layer = 0;
  while (next) {
    const key = next.toString(), column = bot.world.getColumn(next.x, next.z);
    const sectionY = next.y - (bot.game.minY >> 4);
    if (column && sectionY >= 0 && sectionY < (bot.game.height >> 4) && !visited.has(key)) {
      const section = column.sections[sectionY];
      const palette = paletteOf(section);
      if (section && (!palette || palette.some(matches))) {
        const p = new Vec3(0, next.y * 16, 0), local = new Vec3(0, p.y, 0);
        scanColumn: for (let x = 0; x < 16; x++) {
          p.x = next.x * 16 + x; local.x = x;
          for (let y = 0; y < 16; y++) {
            if (bot.world.getColumn(next.x, next.z) !== column) break scanColumn;
            p.y = next.y * 16 + y; local.y = p.y;
            for (let z = 0; z < 16; z++) {
              p.z = next.z * 16 + z; local.z = z;
              if (p.distanceTo(point) > distance || !matches(column.getBlockStateId(local))) continue;
              if (openAbove && coveredAbove(column, local, openAbove, top, noBody, above)) continue;
              if (airStates && !airOnAFace(bot, p, airStates, beside)) continue;
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

// The world's own cells by state (note 795), for a reader that asks only
// what a cell's kind says (its name, its box): each state's answer kept, and
// a section none of whose states answers yes passed whole. Null where the
// bot's blockAt is not mineflayer's own read of the world (a test's world, a
// view over the bot), which is then read Block by Block as before.
// -> { firstUp(x, from, to, z, test) } the first height in [from, to) whose
// cell `test` takes (an unloaded column taken), or null.
function worldCells(bot) {
  if (!bot._worldBlockAt || bot.blockAt !== bot._worldBlockAt || typeof bot.world?.getColumnAt !== 'function') return null;
  const registry = bot.registry, Block = require('prismarine-block')(registry);
  const minY = bot.game?.minY ?? -64, at = new Vec3(0, 0, 0);
  const answers = new WeakMap();
  const answerOf = (test, state) => {
    let known = answers.get(test);
    if (!known) answers.set(test, known = new Map());
    let yes = known.get(state);
    if (yes === undefined) { let b = null; try { b = Block.fromStateId(state, 0); } catch (_) { b = null; } yes = !!test(b); known.set(state, yes); }
    return yes;
  };
  return {
    firstUp(x, from, to, z, test) {
      at.x = x; at.y = from; at.z = z;
      const column = bot.world.getColumnAt(at);
      if (!column) return from < to ? from : null;
      at.x = x & 15; at.z = z & 15;
      for (let y = from; y < to;) {
        const section = column.sections?.[(y - minY) >> 4];
        const palette = section ? paletteOf(section) : [0];
        if (palette && !palette.some(state => answerOf(test, state))) { y = ((y - minY) >> 4) * 16 + minY + 16; continue; }
        at.y = y;
        if (answerOf(test, column.getBlockStateId(at))) return y;
        y++;
      }
      return null;
    },
  };
}

// A search that gives the game its turn every 8 ms (findBlocksAsync) where
// the bot has one: while a search held the loop the body was not defended,
// no physics, no shield, no hurt watchdog (note 795). `check` is asked at
// each turn (a cancelled task ends the search). The same cells as
// bot.findBlocks while the world stands still.
async function findBlocksYielding(bot, options, check = () => {}) {
  return typeof bot.findBlocksAsync === 'function' ? bot.findBlocksAsync(options, check) : bot.findBlocks(options);
}

function installBlockSearch(bot) {
  if (typeof bot.blockAt === 'function' && !bot._worldBlockAt) bot._worldBlockAt = bot.blockAt;
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

module.exports = { installBlockSearch, worldCells, findBlocksYielding };

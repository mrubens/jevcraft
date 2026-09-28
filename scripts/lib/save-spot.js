'use strict';
// Where a stage save leaves the bot standing (note 641), read from the save's
// own world files, never edited: the block under the feet, how much floor is
// round it, and what lies under that. A trial started from a save is a test
// of what comes next only if the bot is somewhere the next thing can be met;
// seven of the eight deaths on mid-242-bb-nether-1-215842 were on or beside
// the cobblestone span the save was taken on, one block wide, five blocks
// over the lava sea, in a ghast's cavern: a fireball's push off it was the
// death, in 2 to 3 seconds, at full health.
//
// Reads one chunk of one region file (Anvil: a 4 KiB-sector header, zlib
// chunks, block states as a palette and bit-packed indices, entries not
// spanning longs since 1.16). Any file, chunk or format it cannot read is
// "unknown", which no rule counts against a save.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIMENSION_DIRS = {
  the_nether: [['dimensions', 'minecraft', 'the_nether'], ['DIM-1']],
  overworld: [['dimensions', 'minecraft', 'overworld'], []],
  the_end: [['dimensions', 'minecraft', 'the_end'], ['DIM1']],
};
const AIR = /^(air|cave_air|void_air)$/;
// A fall this far, on to anything, is 20 or more damage.
const FATAL_FALL = 23;
const LIQUID = /^(lava|water)$/;

function regionFile(worldDir, dimension, cx, cz) {
  const rx = Math.floor(cx / 32), rz = Math.floor(cz / 32);
  for (const parts of DIMENSION_DIRS[dimension] || DIMENSION_DIRS.overworld) {
    const file = path.join(worldDir, ...parts, 'region', `r.${rx}.${rz}.mca`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// The chunk's sections as { [y]: { palette: [name], indices: [4096] | null } },
// or null where the chunk is not in the file.
function readChunk(worldDir, dimension, cx, cz, { nbt = require('prismarine-nbt') } = {}) {
  const file = regionFile(worldDir, dimension, cx, cz);
  if (!file) return null;
  const fd = fs.openSync(file, 'r');
  let raw;
  try {
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, ((cx & 31) + (cz & 31) * 32) * 4);
    const sector = head.readUIntBE(0, 3);
    if (!sector) return null;
    const size = Buffer.alloc(5);
    fs.readSync(fd, size, 0, 5, sector * 4096);
    const length = size.readUInt32BE(0), type = size[4];
    const body = Buffer.alloc(length - 1);
    fs.readSync(fd, body, 0, length - 1, sector * 4096 + 5);
    raw = type === 2 ? zlib.inflateSync(body) : type === 1 ? zlib.gunzipSync(body) : type === 3 ? body : null;
  } finally { fs.closeSync(fd); }
  if (!raw) return null;
  const tag = nbt.simplify(nbt.parseUncompressed(raw));
  const sections = {};
  for (const sec of tag.sections || tag.Level?.sections || []) {
    const states = sec.block_states || sec.BlockStates && { palette: sec.Palette, data: sec.BlockStates };
    if (!states?.palette?.length) continue;
    const palette = states.palette.map(p => String(p.Name).replace('minecraft:', ''));
    let indices = null;
    if (palette.length > 1 && states.data?.length) {
      const bits = Math.max(4, Math.ceil(Math.log2(palette.length))), per = Math.floor(64 / bits), mask = (1n << BigInt(bits)) - 1n;
      const longs = states.data.map(([hi, lo]) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0));
      indices = new Array(4096);
      for (let i = 0; i < 4096; i++) indices[i] = Number((longs[Math.floor(i / per)] >> BigInt((i % per) * bits)) & mask);
    }
    sections[sec.Y] = { palette, indices };
  }
  return sections;
}

// A reader of blocks by coordinate for one save's dimension: name, 'air' for
// a section not stored, null where the chunk is unknown.
function blockReader(worldDir, dimension, opts = {}) {
  const chunks = new Map();
  return (x, y, z) => {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), key = `${cx},${cz}`;
    if (!chunks.has(key)) { let c = null; try { c = readChunk(worldDir, dimension, cx, cz, opts); } catch (_) { /* unknown */ } chunks.set(key, c); }
    const chunk = chunks.get(key);
    if (!chunk) return null;
    const sec = chunk[Math.floor(y / 16)];
    if (!sec) return 'air';
    if (!sec.indices) return sec.palette[0];
    return sec.palette[sec.indices[((y & 15) * 16 + (z & 15)) * 16 + (x & 15)]];
  };
}

// How the bot stands, from a reader: { floor: the block under the feet, ring:
// how many of the nine cells round and under the feet hold a body up, over:
// what the first thing under the floor is ('lava', 'water', 'ground', 'void'),
// dropBlocks: the air between, narrow, deadly } or null where the blocks are
// not known. Narrow is a floor one or two cells wide (at most four of the nine
// are floor: a span is three); deadly is narrow with lava at the bottom of a
// drop of three or more, where a push off the edge cannot be walked out of, or
// a drop of 23 or more, a fall that kills.
const solid = name => name && !AIR.test(name) && !LIQUID.test(name) && !/fire|button|carpet|sign|torch$/.test(name);
function standing(read, pos, { reach = 80 } = {}) {
  const bx = Math.floor(pos.x), bz = Math.floor(pos.z), floorY = Math.floor(pos.y + 1e-6) - 1;
  const floor = read(bx, floorY, bz);
  // Nothing solid under the feet is a bot saved in the air (a jump, a fall) or
  // a block the region did not keep: the spot is not known from it.
  if (floor == null || !solid(floor)) return null;
  let ring = 0, unknown = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const b = read(bx + dx, floorY, bz + dz);
    if (b == null) unknown++; else if (solid(b)) ring++;
  }
  let over = 'ground', dropBlocks = 0;
  for (let y = floorY - 1; y >= floorY - reach; y--) {
    const b = read(bx, y, bz);
    if (b == null) { over = 'unknown'; break; }
    if (AIR.test(b)) { dropBlocks++; continue; }
    over = b === 'lava' ? 'lava' : b === 'water' ? 'water' : 'ground';
    break;
  }
  if (dropBlocks === reach) over = 'void';
  const narrow = ring <= 4 && unknown === 0;
  return { floor, ring, over, dropBlocks, narrow, deadly: narrow && ((over === 'lava' && dropBlocks >= 3) || dropBlocks >= FATAL_FALL) };
}

// The spot of a save: { x, y, z, ...standing } or { error } where unreadable.
function spotOf(snapshotDir, vitals, opts = {}) {
  if (!vitals?.position) return null;
  const dimension = vitals.dimension || 'overworld';
  try {
    const read = opts.read || blockReader(path.join(snapshotDir, 'world'), dimension, opts);
    const s = standing(read, vitals.position, opts);
    return s ? { x: Math.round(vitals.position.x * 10) / 10, y: Math.round(vitals.position.y * 10) / 10, z: Math.round(vitals.position.z * 10) / 10, ...s } : null;
  } catch (err) { return { error: String(err.message).slice(0, 80) }; }
}

// In words, for the listing and the pick's reason.
function spotSays(spot) {
  if (!spot || spot.error) return '';
  const wide = spot.ring <= 3 ? 'one block' : 'two blocks';
  if (spot.deadly) return spot.over === 'lava' ? `stands on a span ${wide} wide over lava (${spot.dropBlocks} blocks of air, then lava): a push off it is death` : `stands on a span ${wide} wide over a drop of ${spot.dropBlocks} blocks: a push off it is death`;
  return '';
}

module.exports = { readChunk, blockReader, standing, spotOf, spotSays };

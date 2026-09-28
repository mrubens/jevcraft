'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { encodePng, canvas, decodeSection, savedWorld, trailOf } = require('../scripts/trials/trail-map');

// A tiny NBT writer, for a chunk the map reads back.
const tag = { byte: 1, string: 8, list: 9, compound: 10, longs: 12 };
function name(s) { const b = Buffer.from(s, 'utf8'), n = Buffer.alloc(2); n.writeUInt16BE(b.length); return Buffer.concat([n, b]); }
function payload(t, v) {
  if (t === tag.byte) return Buffer.from([v & 255]);
  if (t === tag.string) return name(v);
  if (t === tag.longs) { const n = Buffer.alloc(4); n.writeInt32BE(v.length); const b = Buffer.alloc(v.length * 8); v.forEach((x, i) => b.writeBigUInt64BE(x, i * 8)); return Buffer.concat([n, b]); }
  if (t === tag.list) { const [et, items] = v; const h = Buffer.alloc(5); h[0] = et; h.writeInt32BE(items.length, 1); return Buffer.concat([h, ...items.map(x => payload(et, x))]); }
  return Buffer.concat([...Object.entries(v).map(([k, [tt, vv]]) => Buffer.concat([Buffer.from([tt]), name(k), payload(tt, vv)])), Buffer.from([0])]);
}
// Palette indices packed four bits each, sixteen to a long, low bits first.
function pack(indices, bits = 4) {
  const per = Math.floor(64 / bits), out = [];
  for (let i = 0; i < indices.length; i += per) {
    let v = 0n; for (let j = 0; j < per && i + j < indices.length; j++) v |= BigInt(indices[i + j]) << BigInt(j * bits);
    out.push(v);
  }
  return out;
}

test('a section decodes to the block at each position', () => {
  const idx = Array.from({ length: 4096 }, (_, i) => i % 3);
  const data = Buffer.alloc(pack(idx).length * 8); pack(idx).forEach((x, i) => data.writeBigUInt64BE(x, i * 8));
  const s = decodeSection({ palette: [{ Name: 'minecraft:air' }, { Name: 'minecraft:lava' }, { Name: 'minecraft:netherrack' }], data });
  assert.deepEqual(s.pal, ['air', 'lava', 'netherrack']);
  for (const i of [0, 1, 2, 17, 4095]) assert.equal(s.idx[i], i % 3);
});

test('the saved world reads a chunk from a region file, and knows what it lacks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-'));
  // Chunk (1, 2): section 4 (y 64 to 79) lava at its floor layer, air above.
  const idx = Array.from({ length: 4096 }, (_, i) => (i >> 8) === 0 ? 1 : 0);
  const chunk = payload(tag.compound, {
    Status: [tag.string, 'minecraft:full'],
    sections: [tag.list, [tag.compound, [{ Y: [tag.byte, 4], block_states: [tag.compound, { palette: [tag.list, [tag.compound, [{ Name: [tag.string, 'minecraft:air'] }, { Name: [tag.string, 'minecraft:lava'] }]]], data: [tag.longs, pack(idx)] }] }]]],
  });
  const nbt = Buffer.concat([Buffer.from([tag.compound]), name(''), chunk.subarray(0)]);
  const body = zlib.deflateSync(nbt), sector = Buffer.alloc(Math.ceil((body.length + 5) / 4096) * 4096);
  sector.writeUInt32BE(body.length + 1, 0); sector[4] = 2; body.copy(sector, 5);
  const header = Buffer.alloc(8192); header.writeUInt32BE((2 << 8) | (sector.length / 4096), (1 + 2 * 32) * 4);
  fs.writeFileSync(path.join(dir, 'r.0.0.mca'), Buffer.concat([header, sector]));
  const w = savedWorld(dir);
  assert.equal(w.blockAt(16 + 3, 64, 32 + 5), 'lava');
  assert.equal(w.blockAt(16 + 3, 65, 32 + 5), 'air');
  assert.equal(w.blockAt(16 + 3, 100, 32 + 5), 'air', 'a section not saved in a saved chunk is air');
  assert.equal(w.blockAt(0, 64, 0), undefined, 'a chunk not in the file is unknown');
  assert.equal(w.blockAt(-1, 64, 0), undefined, 'a region not on disk is unknown');
});

test('a PNG is written that inflates back to its pixels', () => {
  const c = canvas(3, 2, [10, 20, 30]); c.set(1, 1, [255, 0, 0]); c.text(0, 0, 'x×', [1, 2, 3], 1);
  const png = encodePng(c);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 3); assert.equal(png.readUInt32BE(20), 2);
  const len = png.readUInt32BE(33), raw = zlib.inflateSync(png.subarray(41, 41 + len));
  assert.equal(raw.length, 2 * (3 * 3 + 1));
  assert.deepEqual([...raw.subarray(10 + 1 + 3, 10 + 1 + 6)], [255, 0, 0]);
});

test('each position is colored by what the run clock says it was on, else its step', () => {
  const t0 = Date.parse('2026-09-27T20:00:00Z');
  const pos = (t, step) => ({ t, snapshot: { position: { x: t - t0, y: 70, z: 0 }, dimension: 'the_nether', step: { action: step } } });
  const clock = { t: t0 + 30000, snapshot: { goal: { gameProgress: { clock: { recent: [[t0 + 15000, 'obtain_blaze_rods: cross_toward', 15000], [t0 + 30000, 'hold_on_span', 15000]] } } } } };
  const pts = trailOf([pos(t0 + 5000, 'x'), pos(t0 + 20000, 'x'), clock, pos(t0 + 40000, 'find_fortress')]);
  assert.deepEqual(pts.map(p => p.doing), ['cross_toward', 'hold_on_span', 'find_fortress']);
  assert.equal(pts[0].dim, 'the_nether');
});

test('a trial with no saved world still draws its walk, mobs and death', () => {
  const { render } = require('../scripts/trials/trail-map');
  const { measure } = require('../scripts/trials/progress-audit');
  const t0 = Date.parse('2026-09-27T20:00:00Z'), frames = [];
  for (let s = 0; s < 600; s += 2) frames.push({ kind: 'observation', t: t0 + s * 1000, at: new Date(t0 + s * 1000).toISOString(),
    snapshot: { position: { x: Math.abs((s % 40) - 20), y: 70, z: 0 }, dimension: 'the_nether', health: s < 590 ? 20 : 0, mobs: [{ name: 'blaze', id: 1, at: { x: 5, y: 72, z: 6 }, seen: true }] } });
  const m = measure({ frames, history: [], from: t0, to: t0 + 600000, trial: {}, botLog: null, minutes: 10, historyMinutes: 30 });
  const r = render({ port: 1, world: 'no-such-world', m, frames, from: t0, to: t0 + 600000, minutes: 10 });
  assert.equal(r.png.subarray(1, 4).toString(), 'PNG');
  assert.equal(r.deaths, 1); assert.equal(r.mobs, 1); assert.equal(r.points, 300);
});

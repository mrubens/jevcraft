// A trial world's blocks, read from its saved region files, a layer at a time
// from the top: node scripts/region-map.js <dimension dir> x0 y0 z0 x1 y1 z1
// (the dimension dir as .clean-run-<port>/<world>/dimensions/minecraft/the_nether).
// Read-only; the save lags the live world by up to its autosave.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const nbt = require('prismarine-nbt');
const [dir, ...n] = process.argv.slice(2); const [x0, y0, z0, x1, y1, z1] = n.map(Number);
const chunks = new Map();
async function chunk(cx, cz) {
  const k = cx + ',' + cz; if (chunks.has(k)) return chunks.get(k);
  const f = path.join(dir, 'region', `r.${cx >> 5}.${cz >> 5}.mca`); const buf = fs.readFileSync(f);
  const i = 4 * ((cx & 31) + (cz & 31) * 32); const off = (buf.readUIntBE(i, 3)) * 4096;
  if (!off) { chunks.set(k, null); return null; }
  const len = buf.readUInt32BE(off), comp = buf[off + 4]; const data = buf.subarray(off + 5, off + 4 + len);
  const raw = comp === 2 ? zlib.inflateSync(data) : comp === 1 ? zlib.gunzipSync(data) : data;
  const { parsed } = await nbt.parse(raw); const s = nbt.simplify(parsed);
  chunks.set(k, s); return s;
}
async function blockAt(x, y, z) {
  const c = await chunk(x >> 4, z >> 4); if (!c) return '?';
  const sec = (c.sections || []).find(s => s.Y === (y >> 4)); if (!sec || !sec.block_states) return '?';
  const pal = sec.block_states.palette; if (pal.length === 1) return pal[0].Name.replace('minecraft:', '');
  const bits = Math.max(4, Math.ceil(Math.log2(pal.length))); const per = Math.floor(64 / bits);
  const idx = ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);
  const long = sec.block_states.data[Math.floor(idx / per)]; const v = BigInt.asUintN(64, BigInt(Array.isArray(long) ? (BigInt(long[0]) << 32n) | BigInt.asUintN(32, BigInt(long[1])) : long));
  const p = Number((v >> BigInt((idx % per) * bits)) & ((1n << BigInt(bits)) - 1n));
  const b = pal[p]; return b.Name.replace('minecraft:', '') + (b.Properties?.level ? ':' + b.Properties.level : '');
}
(async () => {
  const letters = {}; let next = 0; const ch = n => { if (n === 'air' || n === 'cave_air') return '.'; if (/^water/.test(n)) return '~'; if (!(n in letters)) letters[n] = String.fromCharCode(65 + next++ % 26) + (next > 26 ? "'" : ''); return letters[n]; };
  for (let y = y1; y >= y0; y--) { console.log('y', y); for (let z = z0; z <= z1; z++) { let row = ''; for (let x = x0; x <= x1; x++) row += ch(await blockAt(x, y, z)).padEnd(2); console.log(String(z).padStart(5), row); } }
  console.log(letters, 'x from', x0);
})();

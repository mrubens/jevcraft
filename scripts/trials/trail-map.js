'use strict';
// A picture of what each trial has been doing. The text logs and the audit
// (progress-audit.js) hide what a person sees at a glance: walking back and
// forth on a bridge, pillared up out of reach of a piglin, circling a
// fortress wall. This draws, per trial, one PNG of the last minutes:
//   - a top-down map of the ground it moved over, from the server's own saved
//     region files (read-only; the server saves them every few minutes, so the
//     newest blocks may be missing), cut at the bot's height: each column
//     shows the first block below head height, walls bright, the floor plain,
//     ground farther below dimmer the deeper it is, open air black and
//     unsaved chunks checkered;
//   - a side view (the long axis of the walk against height) below it;
//   - the path over the window, colored by what the run clock says it was on
//     (a work step or a survival stance), with a dot a minute, start and end,
//     deaths, and the mobs it knew of at their last positions;
//   - a header: world, port, window, milestone, minutes by step, and the
//     audit's flags for the trial, each with what raised it.
//   node scripts/trials/trail-map.js [auto | port ...] [--minutes 15] [--history 60] [--out dir]
// auto (the default) finds the running midgame servers as watch.sh does.
// JEV_ROOT reads another checkout's servers and records (from a worktree).
// --view (a first-person render) needs prismarine-viewer, which is not
// installed; the flag says so and is otherwise ignored.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const audit = require('./progress-audit');

const ROOT = audit.ROOT;

// ---------------------------------------------------------------- PNG + canvas

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// RGB, eight bits, no filtering: the flat colors of a map deflate well as is.
function encodePng({ w, h, px }) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
function canvas(w, h, bg = [16, 16, 20]) {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { px[i * 3] = bg[0]; px[i * 3 + 1] = bg[1]; px[i * 3 + 2] = bg[2]; }
  const c = { w, h, px };
  c.set = (x, y, col, a = 1) => {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    if (a >= 1) { px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; return; }
    px[i] = px[i] + (col[0] - px[i]) * a; px[i + 1] = px[i + 1] + (col[1] - px[i + 1]) * a; px[i + 2] = px[i + 2] + (col[2] - px[i + 2]) * a;
  };
  c.rect = (x, y, rw, rh, col, a = 1) => { for (let j = Math.max(0, Math.floor(y)); j < Math.min(h, Math.floor(y + rh)); j++) for (let i = Math.max(0, Math.floor(x)); i < Math.min(w, Math.floor(x + rw)); i++) c.set(i, j, col, a); };
  c.disc = (cx, cy, r, col, a = 1) => { for (let j = Math.floor(cy - r); j <= cy + r; j++) for (let i = Math.floor(cx - r); i <= cx + r; i++) if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) c.set(i, j, col, a); };
  c.ring = (cx, cy, r, col, t = 1.5) => { for (let j = Math.floor(cy - r - t); j <= cy + r + t; j++) for (let i = Math.floor(cx - r - t); i <= cx + r + t; i++) { const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy); if (Math.abs(d - r) <= t / 2) c.set(i, j, col); } };
  c.line = (x0, y0, x1, y1, col, r = 1, a = 1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let k = 0; k <= n; k++) { const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n; if (r <= 0.6) c.set(x, y, col, a); else c.disc(x, y, r, col, a); }
  };
  c.text = (x, y, s, col = [230, 230, 230], scale = 2) => {
    let cx = x;
    for (const ch of ascii(s)) {
      const g = GLYPHS[ch.charCodeAt(0) - 32] || GLYPHS[31];
      for (let col5 = 0; col5 < 5; col5++) for (let row = 0; row < 8; row++) if (g[col5] >> row & 1) c.rect(cx + col5 * scale, y + row * scale, scale, scale, col);
      cx += 6 * scale;
    }
    return cx;
  };
  // Text on a dark box, for labels over the map.
  c.label = (x, y, s, col, scale = 1) => { c.rect(x - 1, y - 1, String(s).length * 6 * scale + 1, 8 * scale + 2, [0, 0, 0], 0.7); c.text(x, y, s, col, scale); };
  return c;
}

// The font has ASCII only; the audit's words have a few more.
const ascii = s => String(s).replace(/×/g, 'x').replace(/[—–]/g, '-').replace(/…/g, '...').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, '?');

// The classic 5×8 font, ASCII 32 to 126, a column a byte, low bit at the top.
const GLYPHS = ('0000000000 00005f0000 0007000700 147f147f14 242a7f2a12 2313086462 3649562050 0008070300 001c224100 0041221c00 2a1c7f1c2a 08083e0808 0080703000 0808080808 0000606000 2010080402 '
  + '3e5149453e 00427f4000 7249494946 2141494d33 1814127f10 2745454539 3c4a494931 4121110907 3649494936 464949291e 0000140000 0040340000 0008142241 1414141414 0041221408 0201590906 '
  + '3e415d594e 7c1211127c 7f49494936 3e41414122 7f4141413e 7f49494941 7f09090901 3e41415173 7f0808087f 00417f4100 2040413f01 7f08142241 7f40404040 7f021c027f 7f0408107f 3e4141413e '
  + '7f09090906 3e4151215e 7f09192946 2649494932 03017f0103 3f4040403f 1f2040201f 3f4038403f 6314081463 0304780403 6159494d43 007f414141 0204081020 004141417f 0402010204 4040404040 '
  + '0003070800 2054547840 7f28444438 3844444428 384444287f 3854545418 00087e0902 18a4a49c78 7f08040478 00447d4000 2040403d00 7f10284400 00417f4000 7c0478047c 7c08040478 3844444438 '
  + 'fc18242418 18242418fc 7c08040408 4854545424 04043f4424 3c4040207c 1c2040201c 3c4030403c 4428102844 4c9090907c 4464544c44 0008364100 0000770000 0041360800 0201020402').split(' ')
  .map(h => [0, 1, 2, 3, 4].map(i => parseInt(h.slice(i * 2, i * 2 + 2), 16)));

// ------------------------------------------------------------ the saved world

// Just enough NBT for a chunk's sections: every tag read, the numbers the map
// has no use for skipped, long arrays kept as their bytes.
function readNbt(buf) {
  let o = 0;
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; };
  function payload(t) {
    switch (t) {
      case 1: return buf.readInt8(o++);
      case 2: o += 2; return buf.readInt16BE(o - 2);
      case 3: o += 4; return buf.readInt32BE(o - 4);
      case 4: o += 8; return null;
      case 5: o += 4; return null;
      case 6: o += 8; return null;
      case 7: { const n = buf.readInt32BE(o); o += 4 + n; return null; }
      case 8: return str();
      case 9: { const et = buf[o++], n = buf.readInt32BE(o); o += 4; const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a; }
      case 10: { const obj = {}; for (;;) { const tt = buf[o++]; if (!tt) return obj; const name = str(); obj[name] = payload(tt); } }
      case 11: { const n = buf.readInt32BE(o); o += 4 + n * 4; return null; }
      case 12: { const n = buf.readInt32BE(o); o += 4; const v = buf.subarray(o, o + n * 8); o += n * 8; return v; }
      default: throw new Error(`nbt tag ${t}`);
    }
  }
  const t = buf[o++]; str(); return payload(t);
}

// A section's palette indices, packed as 1.16+ packs them (no index across
// two longs), four bits at least.
function decodeSection(bs) {
  const pal = (bs?.palette || []).map(p => String(p.Name).replace(/^minecraft:/, ''));
  if (pal.length <= 1 || !bs.data) return { pal, idx: null };
  const bits = Math.max(4, Math.ceil(Math.log2(pal.length))), per = Math.floor(64 / bits), mask = (1 << bits) - 1, d = bs.data;
  const idx = new Uint16Array(4096);
  for (let i = 0; i < 4096; i++) {
    const li = (i / per) | 0, sh = (i % per) * bits;
    const hi = d.readUInt32BE(li * 8), lo = d.readUInt32BE(li * 8 + 4);
    idx[i] = sh + bits <= 32 ? (lo >>> sh) & mask : sh >= 32 ? (hi >>> (sh - 32)) & mask : ((lo >>> sh) | (hi << (32 - sh))) & mask;
  }
  return { pal, idx };
}

// The blocks of one dimension, from its region files. undefined is a block the
// files do not have (a chunk not saved yet, or not generated).
function savedWorld(regionDir) {
  const regions = new Map(), chunks = new Map();
  let lastKey = null, last = null;
  const stats = { chunks: 0, unsaved: 0, lz4: 0 };
  function region(rx, rz) {
    const key = `${rx},${rz}`;
    if (regions.has(key)) return regions.get(key);
    let r = null;
    try {
      const buf = fs.readFileSync(path.join(regionDir, `r.${rx}.${rz}.mca`));
      if (buf.length >= 8192) r = buf;
    } catch (_) {}
    regions.set(key, r); return r;
  }
  function load(cx, cz) {
    const buf = region(cx >> 5, cz >> 5);
    if (!buf) return null;
    const loc = buf.readUInt32BE(((cx & 31) + (cz & 31) * 32) * 4), off = (loc >>> 8) * 4096;
    if (!loc || off + 5 > buf.length) return null;
    try {
      const len = buf.readUInt32BE(off), type = buf[off + 4];
      let data = buf.subarray(off + 5, off + 4 + len);
      if (type & 0x80) data = fs.readFileSync(path.join(regionDir, `c.${cx}.${cz}.mcc`));
      const kind = type & 0x7f;
      const raw = kind === 1 ? zlib.gunzipSync(data) : kind === 2 ? zlib.inflateSync(data) : kind === 3 ? data : null;
      if (!raw) { stats.lz4++; return null; }
      const nbt = readNbt(raw);
      if (nbt.Status && !/full$/.test(nbt.Status)) return null;
      const sections = new Map();
      for (const s of nbt.sections || []) if (s.block_states) sections.set(s.Y, { raw: s.block_states });
      return { sections };
    } catch (_) { return null; }
  }
  function chunkAt(cx, cz) {
    const key = cx * 100003 + cz;
    if (key === lastKey) return last;
    let c = chunks.get(key);
    if (c === undefined) { c = load(cx, cz); chunks.set(key, c); stats.chunks++; if (!c) stats.unsaved++; }
    lastKey = key; last = c; return c;
  }
  function blockAt(x, y, z) {
    const c = chunkAt(x >> 4, z >> 4);
    if (!c) return undefined;
    const s = c.sections.get(y >> 4);
    if (!s) return 'air';
    if (!s.pal) Object.assign(s, decodeSection(s.raw));
    return s.idx ? s.pal[s.idx[((y & 15) << 8) | ((z & 15) << 4) | (x & 15)]] : s.pal[0] || 'air';
  }
  return { blockAt, stats };
}

function regionDirOf(port, world, dimension) {
  const base = path.join(ROOT, port === 25581 ? '.clean-run' : `.clean-run-${port}`, world);
  const dim = String(dimension || 'overworld').replace(/^minecraft:/, '');
  const modern = path.join(base, 'dimensions', 'minecraft', dim, 'region');
  if (fs.existsSync(modern)) return modern;
  return path.join(base, dim === 'the_nether' ? 'DIM-1' : dim === 'the_end' ? 'DIM1' : '', 'region');
}

// ------------------------------------------------------------ colors

const AIR = new Set(['air', 'cave_air', 'void_air']);
const BLOCK_COLORS = [
  [/^lava$/, '#ff7a00'], [/^(water|bubble_column)$/, '#2a5bd7'], [/^netherrack$/, '#6e2424'],
  [/nether_brick|^chiseled_nether_bricks|^cracked_nether_bricks/, '#6a2f86'], [/^red_nether_brick/, '#7a1a3a'],
  [/^soul_(sand|soil)$/, '#5b4636'], [/basalt/, '#55555c'], [/blackstone|gilded/, '#2e2a34'], [/^magma_block$/, '#b04a12'],
  [/^glowstone$/, '#f4d97a'], [/^nether_quartz_ore$/, '#c4a8a4'], [/^nether_gold_ore$/, '#c09a40'], [/^ancient_debris$/, '#6a4a3a'],
  [/^crimson_nylium$/, '#9a2226'], [/^warped_nylium$/, '#1f7a70'], [/crimson_(stem|hyphae)|crimson_planks/, '#7a2e4c'], [/warped_(stem|hyphae)|warped_planks/, '#3a6a74'],
  [/^nether_wart_block$/, '#861010'], [/^warped_wart_block$/, '#178078'], [/^shroomlight$/, '#f0a050'], [/^bone_block$/, '#e0dcc6'],
  [/^crying_obsidian$/, '#3a0e5a'], [/^obsidian$/, '#1e1430'], [/^nether_portal$/, '#9a3aff'], [/fire$/, '#ff4a10'], [/^bedrock$/, '#303030'],
  [/^gravel$/, '#8a8480'], [/deepslate|^tuff/, '#505058'], [/^(stone|cobblestone|andesite|diorite|granite|calcite|smooth_stone|stone_bricks?|mossy_cobblestone)(_|$)/, '#808080'],
  [/_ore$/, '#9a9090'], [/^grass_block$/, '#5f9a3a'], [/^(dirt|coarse_dirt|rooted_dirt|podzol|mud|farmland|dirt_path)$/, '#7a5535'],
  [/^(red_)?sand$/, '#dbcf8e'], [/sandstone/, '#cfc08a'], [/snow/, '#eef4f6'], [/ice$/, '#9cc4f2'], [/leaves$/, '#3a7a2a'],
  [/(_log|_wood)$/, '#6b4e2c'], [/planks|_slab$|_stairs$|_fence|_door|trapdoor|crafting|chest|barrel|furnace/, '#a8864f'],
  [/glass/, '#c8e8f0'], [/wool$|_bed$/, '#d8d8d8'], [/terracotta/, '#9a5a3a'], [/^clay$/, '#9aa0b0'], [/torch|lantern/, '#ffd060'],
  [/grass|fern|flower|bush|vine|roots|fungus|sprouts|kelp|seagrass|lily|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower/, '#4f8a38'],
  [/cobweb/, '#e8e8e8'],
];
const colorCache = new Map();
function blockColor(name) {
  let c = colorCache.get(name);
  if (c) return c;
  const hit = BLOCK_COLORS.find(([re]) => re.test(name));
  if (hit) c = rgb(hit[1]);
  else { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; c = [90 + h % 80, 90 + (h >> 8) % 80, 90 + (h >> 16) % 80]; }
  colorCache.set(name, c); return c;
}
const shade = (c, k) => c.map(v => Math.max(0, Math.min(255, Math.round(v * k))));
const UNKNOWN = [[38, 38, 44], [52, 52, 58]];

// Path colors: bright, apart from lava and the ground, one per step or stance.
const PATH_COLORS = ['#00e5ff', '#ffee00', '#ff3df2', '#7dff3a', '#ffffff', '#6fa8ff', '#ff8a80', '#64ffda', '#b388ff', '#ffc400', '#c6ff00', '#ff80ab'].map(rgb);
const OTHER = rgb('#9e9e9e');

const MOBS = {
  blaze: ['BZ', '#ffd000'], wither_skeleton: ['WS', '#b0b0b0'], piglin: ['PG', '#ff9ec4'], piglin_brute: ['PB', '#ff5fa0'], zombified_piglin: ['ZP', '#9ccc65'],
  ghast: ['GH', '#ffffff'], hoglin: ['HG', '#c08040'], zoglin: ['ZG', '#e0a070'], magma_cube: ['MC', '#ff5a1f'], strider: ['ST', '#c04060'],
  skeleton: ['SK', '#dddddd'], zombie: ['ZB', '#4caf50'], creeper: ['CR', '#76ff03'], spider: ['SP', '#8d6e63'], cave_spider: ['CS', '#26a69a'],
  enderman: ['EN', '#ce93d8'], witch: ['WI', '#7e57c2'], drowned: ['DR', '#4dd0e1'], husk: ['HU', '#d7b98e'], stray: ['SR', '#b3e5fc'],
  slime: ['SL', '#8bc34a'], silverfish: ['SF', '#90a4ae'], warden: ['WD', '#00bcd4'], phantom: ['PH', '#5c6bc0'], pillager: ['PL', '#9e9e9e'],
};
const mobStyle = name => {
  if (MOBS[name]) return { code: MOBS[name][0], color: rgb(MOBS[name][1]) };
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { code: name.slice(0, 2).toUpperCase(), color: [120 + h % 120, 120 + (h >> 8) % 120, 120 + (h >> 16) % 120] };
};

// ------------------------------------------------------------ the trail

const human = s => String(s).replaceAll('_', ' ');
const hm = t => new Date(t).toISOString().slice(11, 16);
const dimName = d => String(d || '?').replace(/^minecraft:/, '');

// Each position of the window, with what it was on: the run clock says it
// (a work step by its rung, a survival action by name), each of its samples
// covering the seconds before it; after its last sample, the frame's step.
function trailOf(frames) {
  const recent = frames.filter(f => f.snapshot?.goal?.gameProgress?.clock?.recent).at(-1)?.snapshot.goal.gameProgress.clock.recent || [];
  const points = [];
  let k = 0;
  for (const f of frames) {
    const s = f.snapshot;
    if (!s?.position) continue;
    while (k < recent.length && recent[k][0] < f.t) k++;
    let doing = k < recent.length && recent[k][0] - recent[k][2] <= f.t + 1000 ? recent[k][1] : null;
    if (!doing) doing = s.step?.action || s.goal?.step?.action || 'no step';
    doing = String(doing).replace(/^[a-z_ ]+: /, '');
    points.push({ t: f.t, x: s.position.x, y: s.position.y, z: s.position.z, dim: dimName(s.dimension), doing, health: s.health });
  }
  return points;
}

function mobsOf(frames, dim) {
  const last = new Map();
  for (const f of frames) {
    if (dimName(f.snapshot?.dimension) !== dim) continue;
    for (const m of f.snapshot?.mobs || []) if (m?.at && m.name) last.set(m.id ?? `${m.name}@${m.at.x},${m.at.z}`, { name: m.name, ...m.at, seen: !!m.seen, t: f.t });
  }
  return [...last.values()];
}

function deathsOf(points) {
  const out = [];
  let prev = null;
  for (const p of points) { if (typeof p.health !== 'number') continue; if (prev !== null && p.health <= 0 && prev > 0) out.push(p); prev = p.health; }
  return out;
}

// ------------------------------------------------------------ drawing

function render({ port, world, m, frames, from, to, minutes }) {
  const all = trailOf(frames);
  const dim = all.at(-1)?.dim || dimName(m.dimension);
  const points = all.filter(p => p.dim === dim);
  const otherDims = [...new Set(all.filter(p => p.dim !== dim).map(p => p.dim))];
  const mobs = mobsOf(frames, dim), deaths = deathsOf(points);
  const W = savedWorld(regionDirOf(port, world, dim));

  // Minutes by what it was on, for the colors and the legend.
  const byDoing = new Map();
  for (let i = 1; i < points.length; i++) byDoing.set(points[i - 1].doing, (byDoing.get(points[i - 1].doing) || 0) + Math.min(points[i].t - points[i - 1].t, 5000));
  const ranked = [...byDoing.entries()].sort((a, b) => b[1] - a[1]);
  const colorOf = new Map(ranked.slice(0, PATH_COLORS.length).map(([k], i) => [k, PATH_COLORS[i]]));
  const pathColor = d => colorOf.get(d) || OTHER;

  // The ground to draw: the walk and its deaths, a margin around, at least 48 blocks a side.
  const xs = points.map(p => p.x), zs = points.map(p => p.z), ys = points.map(p => p.y);
  const at = points.at(-1) || { x: 0, y: 64, z: 0 };
  let x0 = Math.floor(Math.min(...xs, at.x)) - 12, x1 = Math.ceil(Math.max(...xs, at.x)) + 12;
  let z0 = Math.floor(Math.min(...zs, at.z)) - 12, z1 = Math.ceil(Math.max(...zs, at.z)) + 12;
  const grow = (a, b) => { const need = 48 - (b - a); return need > 0 ? [a - Math.floor(need / 2), b + Math.ceil(need / 2)] : [a, b]; };
  [x0, x1] = grow(x0, x1); [z0, z1] = grow(z0, z1);
  const MAX = 880, bw = x1 - x0, bh = z1 - z0;
  const scale = Math.max(0.25, Math.min(8, Math.floor(Math.min(MAX / bw, MAX / bh) * 4) / 4));
  const mapW = Math.ceil(bw * scale), mapH = Math.ceil(bh * scale);

  // The slice: from head height at the walk's usual height.
  const sortedY = [...ys].sort((a, b) => a - b);
  const feet = Math.floor(sortedY[Math.floor(sortedY.length / 2)] ?? at.y);
  const headY = feet + 1, deepest = feet - 48;
  const cols = new Array(bw * bh);
  for (let z = 0; z < bh; z++) for (let x = 0; x < bw; x++) {
    let out = null;
    for (let y = headY; y >= deepest; y--) {
      const b = W.blockAt(x0 + x, y, z0 + z);
      if (b === undefined) { out = 'unknown'; break; }
      if (!AIR.has(b)) {
        const rel = y - (feet - 1);
        // Deeper is dimmer, but lava and water keep their hue: a lava sea
        // forty blocks under a bridge is still lava. Past three below the
        // floor the column is hatched too (a drop).
        const fluid = b === 'lava' || b === 'water';
        const k = rel >= 1 ? 1.2 : rel === 0 ? 0.92 : Math.max(fluid ? 0.75 : 0.4, 0.85 + rel / 30);
        out = shade(blockColor(b), k); if (rel < -3) out.drop = true; break;
      }
    }
    cols[z * bw + x] = out;
  }

  // Side view: the long axis of the walk against height, cut through the walk.
  const alongX = (Math.max(...xs) - Math.min(...xs)) >= (Math.max(...zs) - Math.min(...zs));
  const h0 = alongX ? x0 : z0, hn = alongX ? bw : bh;
  const across = new Array(hn).fill(null);
  for (const p of points) { const i = Math.floor(alongX ? p.x : p.z) - h0; if (i >= 0 && i < hn) (across[i] ||= []).push(alongX ? p.z : p.x); }
  const cut = across.map(a => a && Math.floor(a.reduce((s, v) => s + v, 0) / a.length));
  let lastCut = cut.find(v => v !== null) ?? Math.floor(alongX ? at.z : at.x);
  for (let i = 0; i < hn; i++) { if (cut[i] === null) cut[i] = lastCut; else lastCut = cut[i]; }
  // Down to the ground under the walk, up to 96 blocks: the first block
  // under the feet in the columns two either side, so a bridge or a pillar
  // (its own column solid) shows the lava or the grass it stands over.
  let under = Math.min(...ys, at.y);
  for (let i = 0; i < points.length; i += Math.max(1, Math.floor(points.length / 200))) {
    const p = points[i];
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      for (let y = Math.floor(p.y) - 1; y > p.y - 64; y--) { const b = W.blockAt(Math.floor(p.x) + dx, y, Math.floor(p.z) + dz); if (b === undefined) break; if (!AIR.has(b)) { under = Math.min(under, y); break; } }
    }
  }
  const yHi = Math.ceil(Math.max(...ys, at.y)) + 8, yLo = Math.max(Math.floor(under) - 6, yHi - 96);
  const sideScale = Math.min(scale, 360 / (yHi - yLo));
  const sideH = Math.ceil((yHi - yLo) * sideScale);

  // Header lines, from the audit.
  const header = [];
  header.push([`${world}  port ${port}  ${dim}  ${hm(from)}-${hm(to)}Z (${minutes} min)  trial ${m.trialMinutes ?? '?'} min${m.phase ? `  on ${human(m.phase)}` : ''}`, [255, 255, 255]]);
  header.push([`last milestone: ${m.lastMilestone ? `${human(m.lastMilestone.name)} ${m.lastMilestone.minutesAgo} min ago` : 'none'}; deaths in window ${deaths.length}; last frame ${m.lastFrameMinutesAgo ?? '?'} min ago`, [210, 210, 210]]);
  header.push([`doing (min): ${m.byDoing.map(([k, v]) => `${human(k)} ${v}`).join(', ') || 'no clock'}`, [210, 210, 210]]);
  const g = m.ground;
  header.push([`ground: ${g.newCells}/${g.cells} columns new; walked ${g.walked}, net ${g.net ?? '-'}, farthest ${g.farthest}; dug ~${g.dug}, laid ~${g.laid}; blazes in sight ${m.blazesInSight}`, [210, 210, 210]]);
  if (m.fortress) header.push([`fortress: ${m.fortress.passes} passes, ${m.fortress.minutesThere} min there, blazes near ${m.fortress.blazesSeenNear}${m.fortress.lastPass ? `, last pass ${m.fortress.lastPass.reached}/${m.fortress.lastPass.stretches} stretches` : ''}`, [210, 210, 210]]);
  if (m.questions.top.length) header.push([`asked: ${m.questions.top.slice(0, 3).map(q => `${q.id} ${q.count}x (${q.same}x ${q.answer})`).join(', ')}; none good ${m.questions.noneGood}/${m.questions.byJev}`, [210, 210, 210]]);
  for (const f of m.flags) header.push([`FLAG ${f.id}: ${f.text}`, [255, 110, 90]]);
  if (!m.flags.length) header.push([`no flags: ${m.verdict}`, [120, 230, 120]]);
  if (otherDims.length) header.push([`also in ${otherDims.join(', ')} this window (not drawn)`, [255, 200, 90]]);

  const PANEL = 360, PAD = 16, TS = 2, LH = 20;
  const imgW = Math.max(PAD + 34 + mapW + PAD + PANEL, 1100);
  const wrapAt = Math.floor((imgW - 2 * PAD) / (6 * TS));
  const wrapped = [];
  for (const [s, c] of header) {
    let line = '';
    for (const word of ascii(s).split(' ')) {
      if (line && (line + ' ' + word).length > wrapAt) { wrapped.push([line, c]); line = '   ' + word; }
      else line = line ? line + ' ' + word : word;
    }
    wrapped.push([line, c]);
  }
  const headH = PAD + wrapped.length * LH + 8;
  const mapX = PAD + 34, mapY = headH + 22, sideY = mapY + mapH + 44;
  const imgH = Math.max(sideY + sideH + 30, mapY + 600);
  const c = canvas(imgW, imgH);
  wrapped.forEach(([s, col], i) => c.text(PAD, PAD + i * LH, s, col, TS));

  // The map.
  for (let py = 0; py < mapH; py++) for (let px = 0; px < mapW; px++) {
    const bx = Math.floor(px / scale), bz = Math.floor(py / scale);
    const v = cols[bz * bw + bx];
    const col = v === 'unknown' || v === undefined ? UNKNOWN[((bx >> 2) + (bz >> 2)) & 1] : v || [0, 0, 0];
    c.set(mapX + px, mapY + py, v?.drop && (px + py) % 4 === 0 ? shade(col, 0.45) : col);
  }
  // Chunk lines and their coordinates, north up.
  const step = scale >= 2 ? 16 : scale >= 0.75 ? 32 : 64;
  for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) { const px = mapX + (x - x0) * scale; c.rect(px, mapY, 1, mapH, [255, 255, 255], 0.12); c.text(px - 6, mapY - 12, String(x), [170, 170, 170], 1); }
  for (let z = Math.ceil(z0 / step) * step; z < z1; z += step) { const py = mapY + (z - z0) * scale; c.rect(mapX, py, mapW, 1, [255, 255, 255], 0.12); c.text(PAD, py - 3, String(z).padStart(5), [170, 170, 170], 1); }
  c.text(mapX, mapY - 22, `top-down, north up, x across; cut at feet y ${feet}: walls bright, floor plain, a drop hatched`.slice(0, Math.max(40, Math.floor(mapW / 6))), [170, 170, 170], 1);
  const mx = x => mapX + (x - x0) * scale, mz = z => mapY + (z - z0) * scale;
  const lw = Math.max(1, Math.min(2.2, scale * 0.45));
  drawTrail(c, points, p => [mx(p.x), mz(p.z)], pathColor, lw, to);
  for (const mob of mobs) {
    const [px, py] = [mx(mob.x), mz(mob.z)];
    if (px < mapX || py < mapY || px >= mapX + mapW || py >= mapY + mapH) continue;
    const st = mobStyle(mob.name);
    c.disc(px, py, 4.5, [0, 0, 0]); if (mob.seen) c.disc(px, py, 3.5, st.color); else c.ring(px, py, 3, st.color, 1.6);
    c.label(px + 6, py - 4, st.code, st.color, 1);
  }
  for (const d of deaths) { const [px, py] = [mx(d.x), mz(d.z)]; c.line(px - 7, py - 7, px + 7, py + 7, [255, 30, 30], 1.6); c.line(px - 7, py + 7, px + 7, py - 7, [255, 30, 30], 1.6); c.label(px + 9, py - 4, `died ${hm(d.t)}`, [255, 80, 80], 1); }

  // The side view.
  const sx = h => mapX + (h - h0) * scale, sy = y => sideY + (yHi - y) * sideScale;
  for (let py = 0; py < sideH; py++) for (let px = 0; px < mapW; px++) {
    const h = Math.floor(px / scale), y = Math.floor(yHi - (py + 0.5) / sideScale);
    const b = h < hn ? (alongX ? W.blockAt(h0 + h, y, cut[h]) : W.blockAt(cut[h], y, h0 + h)) : undefined;
    const col = b === undefined ? UNKNOWN[((h >> 2) + (y >> 2)) & 1] : AIR.has(b) ? [0, 0, 0] : blockColor(b);
    c.set(mapX + px, sideY + py, col);
  }
  for (let y = Math.ceil(yLo / 8) * 8; y <= yHi; y += 8) { c.rect(mapX, sy(y), mapW, 1, [255, 255, 255], 0.12); c.text(PAD, sy(y) - 3, `y${y}`.padStart(5), [170, 170, 170], 1); }
  c.text(mapX, sideY - 22, `side view: ${alongX ? 'x' : 'z'} across, y up; cut at the walk's ${alongX ? 'z' : 'x'}`.slice(0, Math.max(40, Math.floor(mapW / 6))), [170, 170, 170], 1);
  drawTrail(c, points, p => [sx(alongX ? p.x : p.z), sy(p.y)], pathColor, lw, to);
  for (const d of deaths) { const [px, py] = [sx(alongX ? d.x : d.z), sy(d.y)]; c.line(px - 6, py - 6, px + 6, py + 6, [255, 30, 30], 1.4); c.line(px - 6, py + 6, px + 6, py - 6, [255, 30, 30], 1.4); }
  for (const mob of mobs) {
    const [px, py] = [sx(alongX ? mob.x : mob.z), sy(mob.y)];
    const h = Math.floor(alongX ? mob.x : mob.z) - h0;
    if (h < 0 || h >= hn || Math.abs((alongX ? mob.z : mob.x) - cut[h]) > 16) continue;
    if (px < mapX || py < sideY || px >= mapX + mapW || py >= sideY + sideH) continue;
    const st = mobStyle(mob.name); c.disc(px, py, 4, [0, 0, 0]); c.disc(px, py, 3, st.color);
  }

  // The legend.
  let ly = mapY, lx = mapX + mapW + PAD + 8;
  c.text(lx, ly, 'path, by step or stance (min)', [255, 255, 255], 1); ly += 14;
  for (const [k, ms] of ranked.slice(0, 16)) { c.rect(lx, ly + 1, 14, 6, pathColor(k)); c.text(lx + 20, ly, `${human(k).slice(0, 40)} ${(ms / 60000).toFixed(1)}`, [220, 220, 220], 1); ly += 12; }
  ly += 8;
  c.disc(lx + 6, ly + 4, 5, [40, 220, 90]); c.text(lx + 20, ly, `start ${points[0] ? hm(points[0].t) : '-'}`, [220, 220, 220], 1); ly += 14;
  c.ring(lx + 6, ly + 4, 5, [255, 60, 60], 2.5); c.text(lx + 20, ly, `end ${points.at(-1) ? hm(points.at(-1).t) : '-'} (now at ${Math.round(at.x)}, ${Math.round(at.y)}, ${Math.round(at.z)})`, [220, 220, 220], 1); ly += 14;
  c.disc(lx + 6, ly + 4, 3, [255, 255, 255]); c.text(lx + 20, ly, 'a dot a minute, "-N" = N min before the end', [220, 220, 220], 1); ly += 14;
  c.line(lx, ly, lx + 12, ly + 8, [255, 30, 30], 1.2); c.line(lx, ly + 8, lx + 12, ly, [255, 30, 30], 1.2); c.text(lx + 20, ly, 'death', [220, 220, 220], 1); ly += 20;
  c.text(lx, ly, 'mobs known, last position (filled: in sight)', [255, 255, 255], 1); ly += 14;
  const kinds = new Map(); for (const mob of mobs) kinds.set(mob.name, (kinds.get(mob.name) || 0) + 1);
  const outside = mobs.filter(mob => mob.x < x0 || mob.x >= x1 || mob.z < z0 || mob.z >= z1).length;
  if (outside) { c.text(lx, ly, `(${outside} of ${mobs.length} beyond the map's edge)`, [160, 160, 160], 1); ly += 12; }
  for (const [name, n] of [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) { const st = mobStyle(name); c.disc(lx + 6, ly + 4, 4, st.color); c.text(lx + 20, ly, `${st.code} ${human(name)} x${n}`, [220, 220, 220], 1); ly += 12; }
  if (!kinds.size) { c.text(lx + 20, ly, 'none', [160, 160, 160], 1); ly += 12; }
  ly += 8;
  c.text(lx, ly, 'terrain', [255, 255, 255], 1); ly += 14;
  for (const [name, label] of [['lava', 'lava'], ['water', 'water'], ['netherrack', 'netherrack'], ['nether_bricks', 'nether brick'], ['soul_sand', 'soul sand/soil'], ['basalt', 'basalt'], ['blackstone', 'blackstone'], ['gravel', 'gravel'], ['stone', 'stone'], ['deepslate', 'deepslate'], ['grass_block', 'grass'], ['dirt', 'dirt'], ['oak_log', 'wood'], ['cobblestone', 'cobble (often placed)']]) {
    c.rect(lx, ly + 1, 14, 7, blockColor(name)); c.text(lx + 20, ly, label, [220, 220, 220], 1); ly += 11;
  }
  c.rect(lx, ly + 1, 14, 7, [0, 0, 0]); c.rect(lx, ly + 1, 14, 7, [255, 255, 255], 0.05); c.text(lx + 20, ly, 'air to 48 below (a drop)', [220, 220, 220], 1); ly += 11;
  c.rect(lx, ly + 1, 7, 7, UNKNOWN[0]); c.rect(lx + 7, ly + 1, 7, 7, UNKNOWN[1]); c.text(lx + 20, ly, 'not in the saved region files', [220, 220, 220], 1); ly += 16;
  c.text(lx, ly, `${Math.round(scale * 100) / 100} px a block; ${W.stats.chunks} chunks read, ${W.stats.unsaved} not saved`, [150, 150, 150], 1);
  return { png: encodePng(c), dim, points: points.length, mobs: mobs.length, deaths: deaths.length, stats: W.stats };
}

// The walk: a dark edge under the colored line so it reads over any ground,
// the segments blended so ground walked many times shows brighter, then the
// minute dots and the start and end.
function drawTrail(c, points, xy, color, lw, to) {
  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 12) continue; // a teleport or a respawn
    segs.push([xy(a), xy(b), color(a.doing)]);
  }
  for (const [[ax, ay], [bx, by]] of segs) c.line(ax, ay, bx, by, [0, 0, 0], lw + 1, 0.5);
  for (const [[ax, ay], [bx, by], col] of segs) c.line(ax, ay, bx, by, col, lw, 0.75);
  if (!points.length) return;
  // Minutes that fall on the same spot (pacing) share one label: "-1,5,13".
  const ticks = [];
  let j = 0;
  for (let k = Math.floor((to - points[0].t) / 60000); k >= 1; k--) {
    const t = to - k * 60000;
    while (j < points.length - 1 && points[j + 1].t <= t) j++;
    const [x, y] = xy(points[j]);
    c.disc(x, y, 3.5, [0, 0, 0]); c.disc(x, y, 2.5, [255, 255, 255]);
    const near = ticks.find(g => Math.hypot(g.x - x, g.y - y) < 14);
    if (near) near.ks.push(k); else ticks.push({ x, y, ks: [k] });
  }
  for (const g of ticks) c.label(g.x + 5, g.y + 3, '-' + g.ks.sort((a, b) => a - b).join(','), [255, 255, 255], 1);
  const [sx, sy] = xy(points[0]), [ex, ey] = xy(points.at(-1));
  c.disc(sx, sy, 6, [0, 0, 0]); c.disc(sx, sy, 5, [40, 220, 90]); c.label(sx + 8, sy - 12, 'S', [40, 220, 90], 1);
  c.ring(ex, ey, 6, [0, 0, 0], 4.5); c.ring(ex, ey, 6, [255, 60, 60], 2.5); c.label(ex + 9, ey + 2, 'E', [255, 90, 90], 1);
}

// ------------------------------------------------------------ main

function main() {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
  const minutes = Number(opt('minutes', 15)), historyMinutes = Number(opt('history', 60));
  const out = path.resolve(opt('out', path.join(ROOT, 'artifacts', 'trails')));
  if (argv.includes('--view')) console.log('--view: prismarine-viewer is not installed (it and its headless renderer, node-canvas-webgl, are large native dependencies); only the maps are drawn.');
  const named = argv.filter((a, i) => /^\d+$/.test(a) && !/^--/.test(argv[i - 1] || ''));
  const trials = named.length ? named.map(p => ({ port: Number(p), world: audit.worldOn(Number(p)) })).filter(t => t.world) : audit.runningPorts();
  fs.mkdirSync(out, { recursive: true });
  const began = Date.now(), now = Date.now(), stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:]/g, '');
  for (const t of trials) {
    const t0 = Date.now();
    try {
      const w = audit.trialWindow(t, { minutes, historyMinutes, now });
      const m = audit.measure({ ...w, minutes, historyMinutes });
      if (!w.frames.some(f => f.snapshot?.position)) { console.log(`${t.port} ${t.world}: no positions in the last ${minutes} min`); continue; }
      const r = render({ ...t, m, frames: w.frames, from: w.from, to: w.to, minutes });
      const file = path.join(out, `${t.world}-${stamp}Z.png`);
      fs.writeFileSync(file, r.png);
      console.log(`${t.port} ${t.world}: ${file} (${r.dim}, ${r.points} positions, ${r.mobs} mobs, ${r.deaths} deaths, ${m.flags.map(f => f.id).join(',') || 'no flags'}; ${Date.now() - t0} ms)`);
    } catch (e) { console.log(`${t.port} ${t.world}: failed, ${e.stack || e.message}`); }
  }
  console.log(`${trials.length} trial(s) in ${((Date.now() - began) / 1000).toFixed(1)} s`);
}

if (require.main === module) main();
module.exports = { encodePng, canvas, readNbt, decodeSection, savedWorld, trailOf, render };

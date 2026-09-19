'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { unzipSync } = require('fflate');

const root = 'assets/minecraft/';
const sides = ['east', 'west', 'up', 'down', 'south', 'north']; // Three.js BoxGeometry order.
const unavailable = { available: false, label: 'Block colors', blocks: {}, textures: {} };
const safeName = name => typeof name === 'string' && /^[a-z0-9_/-]+$/.test(name) && !name.includes('..');
function resource(name) {
  if (typeof name !== 'string') return null;
  name = name.replace(/^minecraft:/, '');
  return safeName(name) && name.startsWith('block/') ? name : null;
}

function clientJar({ jar = process.env.MINECRAFT_CLIENT_JAR, version = process.env.MC_VERSION || '26.1', directory = process.env.MINECRAFT_HOME } = {}) {
  if (jar) return path.resolve(jar);
  if (!/^[a-zA-Z0-9_.-]+$/.test(version) || version.includes('..')) return null;
  directory ||= process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/minecraft') :
    process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), '.minecraft') : path.join(os.homedir(), '.minecraft');
  return path.join(directory, 'versions', version, `${version}.jar`);
}

function readPack(bytes, version = 'local') {
  let expanded = 0;
  const files = unzipSync(bytes, { filter: file => {
    if (file.name !== 'version.json' && !/^assets\/minecraft\/(?:textures\/block\/[a-z0-9_/-]+\.png(?:\.mcmeta)?|(?:models\/block|blockstates)\/[a-z0-9_/-]+\.json)$/.test(file.name)) return false;
    if (file.originalSize > 8 * 1024 * 1024 || (expanded += file.originalSize) > 64 * 1024 * 1024) throw new Error('Texture pack is too large');
    return true;
  } });
  const json = name => { try { return JSON.parse(Buffer.from(files[name]).toString('utf8')); } catch { return null; } };
  const pngs = new Map(), textures = {}, models = new Map();
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.startsWith(root + 'textures/block/') || !name.endsWith('.png')) continue;
    const png = Buffer.from(bytes);
    if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) continue;
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 32768 || width * height > 16 * 1024 * 1024) continue;
    const key = name.slice((root + 'textures/').length, -4);
    const animation = json(name + '.mcmeta')?.animation;
    const w = animation?.width || (animation ? Math.min(width, height) : width);
    const h = animation?.height || (animation ? w : height);
    if (![w, h].every(Number.isInteger) || w < 1 || h < 1 || w > width || h > height) continue;
    const first = animation?.frames?.[0], index = typeof first === 'number' ? first : first?.index || 0;
    const columns = Math.floor(width / w), rows = Math.floor(height / h);
    const frame = Number.isInteger(index) && index >= 0 && index < columns * rows ? index : 0;
    textures[key] = { url: `/textures/${key}.png`, crop: [(frame % columns) * w, Math.floor(frame / columns) * h, w, h] };
    pngs.set(key, png);
  }
  function model(name, seen = new Set()) {
    name = resource(name);
    if (!name || seen.has(name) || seen.size > 24) return null;
    if (models.has(name)) return models.get(name);
    const own = json(`${root}models/${name}.json`);
    if (!own) return null;
    const parent = model(own.parent, new Set([...seen, name]));
    const value = { textures: { ...parent?.textures, ...own.textures }, elements: own.elements || parent?.elements || [] };
    models.set(name, value); return value;
  }
  function reference(value, dictionary) {
    const seen = new Set();
    while (typeof value === 'string' && value.startsWith('#')) {
      if (seen.has(value) || seen.size > 24) return null;
      seen.add(value); value = dictionary[value.slice(1)];
    }
    const name = resource(value); return textures[name] ? name : null;
  }
  const blocks = {};
  const blockNames = Object.keys(files).filter(n => n.startsWith(root + 'blockstates/') && n.endsWith('.json')).map(n => n.slice((root + 'blockstates/').length, -5));
  for (const name of blockNames) {
    const state = json(`${root}blockstates/${name}.json`);
    let shape = model(`block/${name}`);
    if (!shape) {
      const variants = Object.entries(state?.variants || {}).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(v => ({ ...v, key })));
      variants.sort((a, b) => (Number(!!a.x) + Number(!!a.y) + Number(/snowy=true|half=top/.test(a.key))) - (Number(!!b.x) + Number(!!b.y) + Number(/snowy=true|half=top/.test(b.key))));
      shape = model(variants[0]?.model || state?.multipart?.[0]?.apply?.model);
    }
    const fallback = reference(shape?.textures?.particle, shape?.textures || {}) || (textures[`block/${name}`] ? `block/${name}` : null);
    blocks[name] = sides.map(side => {
      const planes = (shape?.elements || []).filter(e => e.faces?.[side]).map(e => {
        const axis = /east|west/.test(side) ? 0 : /up|down/.test(side) ? 1 : 2;
        const area = [0, 1, 2].filter(i => i !== axis).reduce((v, i) => v * Math.abs(e.to[i] - e.from[i]), 1);
        return { element: e, face: e.faces[side], area, bounds: JSON.stringify([e.from, e.to]) };
      }).sort((a, b) => b.area - a.area);
      // Preserve coincident grass overlays without flattening unrelated stair/pane surfaces together.
      const layers = planes.filter(p => p.bounds === planes[0]?.bounds).map(p => ({ texture: reference(p.face.texture, shape.textures), tinted: p.face.tintindex >= 0 })).filter(p => p.texture);
      if (layers.length) return layers;
      const fluid = /^(water|bubble_column)$/.test(name) ? 'block/water_still' : name === 'lava' ? 'block/lava_still' : null;
      return fluid && textures[fluid] ? [{ texture: fluid, tinted: fluid.includes('water') }] : fallback ? [{ texture: fallback, tinted: false }] : [];
    });
  }
  if (!pngs.size) throw new Error('No Minecraft block textures found');
  const label = String(json('version.json')?.name || version).slice(0, 80);
  return { manifest: { available: true, label: `Minecraft ${label}`, blocks, textures }, pngs };
}

function createTextures(options) {
  let pending;
  async function load() {
    if (!pending) pending = (async () => {
      try {
        const file = clientJar(options);
        if (!file || (await fs.stat(file)).size > 256 * 1024 * 1024) throw new Error('Client jar unavailable');
        return readPack(await fs.readFile(file), options?.version);
      } catch { return { manifest: unavailable, pngs: new Map() }; }
    })();
    return pending;
  }
  return { async manifest() { return (await load()).manifest; }, async png(name) { return (await load()).pngs.get(name); } };
}
module.exports = { createTextures, readPack, clientJar };

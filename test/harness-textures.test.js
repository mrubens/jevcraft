'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const { readPack, createTextures, clientJar } = require('../src/harness/textures');
const { startHarness } = require('../src/harness/server');

// Generated fixture headers; tests do not contain or redistribute Minecraft assets.
function png(width = 16, height = 16) {
  const bytes = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  bytes.writeUInt32BE(width,16); bytes.writeUInt32BE(height,20); return bytes;
}
function pack() {
  const files = {}, put = (name, value) => { files[`assets/minecraft/${name}.json`] = strToU8(JSON.stringify(value)); };
  files['version.json'] = strToU8('{"name":"fixture"}');
  files['private.json'] = strToU8('{"secret":"not a texture"}');
  for (const name of ['bark','end','dirt','grass','overlay']) files[`assets/minecraft/textures/block/${name}.png`] = png();
  files['assets/minecraft/textures/block/water_still.png'] = png(16,64);
  files['assets/minecraft/textures/block/water_still.png.mcmeta'] = strToU8('{"animation":{"frames":[{"index":2}]}}');
  const cube = { from: [0,0,0], to: [16,16,16], faces: Object.fromEntries(['east','west','north','south','up','down'].map(side => [side, { texture: ['up','down'].includes(side) ? '#end' : '#side' }])) };
  put('models/block/column', { elements: [cube], textures: { particle: '#side', side: '#all' } });
  put('models/block/log', { parent: 'minecraft:block/column', textures: { all: 'block/bark', end: 'minecraft:block/end' } });
  put('blockstates/log', { variants: { '': { model: 'block/log' } } });
  put('models/block/grass', { textures: { side: 'block/dirt', end: 'block/grass', overlay: 'block/overlay' }, elements: [cube, { ...cube, faces: { east: { texture: '#overlay', tintindex: 0 } } }] });
  put('blockstates/grass', { variants: { '': { model: 'block/grass' } } });
  put('blockstates/water', { variants: { '': { model: 'block/water' } } });
  put('blockstates/no_texture', { variants: { '': { model: 'block/unknown' } } });
  return zipSync(files);
}

test('client textures resolve inherited aliases, face layers and animation frames without exposing other jar files', () => {
  const { manifest, pngs } = readPack(pack());
  assert.equal(manifest.label, 'Minecraft fixture');
  assert.equal(manifest.blocks.log[0][0].texture, 'block/bark');
  assert.equal(manifest.blocks.log[2][0].texture, 'block/end');
  assert.deepEqual(manifest.blocks.grass[0], [{ texture: 'block/dirt', tinted: false }, { texture: 'block/overlay', tinted: true }]);
  assert.deepEqual(manifest.textures['block/water_still'].crop, [0,32,16,16]);
  assert.deepEqual(manifest.blocks.water[0], [{ texture: 'block/water_still', tinted: true }]);
  assert.deepEqual(manifest.blocks.no_texture[0], []);
  assert.equal(pngs.has('private.json'), false);
  assert.equal(JSON.stringify(manifest).includes('secret'), false);
});

test('texture lookup uses the selected client version and falls back cleanly without a client jar', async () => {
  assert.equal(clientJar({ directory: '/game', version: '26.1', jar: '' }), path.join('/game','versions','26.1','26.1.jar'));
  assert.equal(clientJar({ directory: '/game', version: '../../etc', jar: '' }), null);
  const source = createTextures({ jar: path.join(os.tmpdir(), 'no-such-jev-client.jar') });
  assert.equal((await source.manifest()).available, false);
  assert.equal(await source.png('block/stone'), undefined);
  assert.throws(() => readPack(Buffer.from('not a jar')));
});

test('texture HTTP routes serve only whitelisted PNGs and preserve same-origin protection', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-textures-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const jar = path.join(dir,'client.jar'); await fs.writeFile(jar, pack());
  const harness = await startHarness({ port: 0, textureOptions: { jar } }); t.after(() => harness.close());
  const manifest = await (await fetch(harness.url + '/api/textures')).json();
  assert.equal(manifest.available, true); assert(!JSON.stringify(manifest).includes(dir));
  const response = await fetch(harness.url + manifest.textures['block/bark'].url);
  assert.equal(response.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png());
  for (const route of ['/textures/private.json','/textures/block/missing.png','/textures/%2e%2e%2f.env','/textures.js/../../.env']) assert.equal((await fetch(harness.url + route)).status,404);
  assert.equal((await fetch(harness.url + '/api/textures', { headers: { Origin: 'https://example.com' } })).status,403);
});

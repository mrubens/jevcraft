'use strict';
// Note 641: where a stage save leaves the bot standing, and how often one save
// is started from. mid-242-bb-nether-1-215842 was taken on a cobblestone span
// one block wide, five blocks over the lava sea: seven of its eight deaths in
// an hour were on or beside it, a ghast's fireball pushing the bot off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const nbt = require('prismarine-nbt');
const stage = require('../scripts/lib/stage-select');
const spot = require('../scripts/lib/save-spot');

const tmp = name => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));

// A one-chunk region file at chunk (0, 0): `cells` is a function (x, y, z) ->
// block name for the cells that are not air; sections 1 and 2 (y 16 to 47)
// are written the way the server writes them (palette and 4-bit indices).
function writeRegion(worldDir, cells, { dimension = 'the_nether' } = {}) {
  const dir = path.join(worldDir, 'dimensions', 'minecraft', dimension, 'region');
  fs.mkdirSync(dir, { recursive: true });
  const sections = [];
  for (const Y of [1, 2]) {
    const names = ['air'];
    const idx = new Array(4096).fill(0);
    for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const name = cells(x, Y * 16 + y, z);
      if (!name || name === 'air') continue;
      if (!names.includes(name)) names.push(name);
      idx[(y * 16 + z) * 16 + x] = names.indexOf(name);
    }
    const bits = Math.max(4, Math.ceil(Math.log2(names.length))), per = Math.floor(64 / bits);
    const longs = [];
    for (let i = 0; i < Math.ceil(4096 / per); i++) {
      let v = 0n;
      for (let j = 0; j < per && i * per + j < 4096; j++) v |= BigInt(idx[i * per + j]) << BigInt(j * bits);
      longs.push([Number(BigInt.asIntN(32, v >> 32n)), Number(BigInt.asIntN(32, v & 0xffffffffn))]);
    }
    sections.push({ Y: nbt.byte(Y), block_states: nbt.comp({ palette: nbt.list(nbt.comp(names.map(Name => ({ Name: nbt.string('minecraft:' + Name) })))), data: nbt.longArray(longs) }) });
  }
  const tag = nbt.comp({ sections: nbt.list(nbt.comp(sections.map(s => ({ Y: s.Y, block_states: s.block_states })))) });
  const body = zlib.deflateSync(nbt.writeUncompressed(tag, 'big'));
  const file = Buffer.alloc(8192 + Math.ceil((body.length + 5) / 4096) * 4096);
  file.writeUIntBE((2 << 8) | Math.ceil((body.length + 5) / 4096), 0, 4);
  file.writeUInt32BE(body.length + 1, 8192);
  file[8196] = 2;
  body.copy(file, 8197);
  fs.writeFileSync(path.join(dir, 'r.0.0.mca'), file);
}

// The lava sea under y 32, a cobblestone span one block wide along z at x 5, y 36.
const spanWorld = (x, y, z) => y < 32 ? 'lava' : (y === 36 && x === 5 ? 'cobblestone' : null);

test('note 641: a save standing on a one-block span over lava is read from the region file as deadly', () => {
  const world = tmp('spot'); writeRegion(world, spanWorld);
  const read = spot.blockReader(world, 'the_nether');
  assert.equal(read(5, 36, 8), 'cobblestone');
  assert.equal(read(6, 36, 8), 'air');
  assert.equal(read(6, 20, 8), 'lava');
  const here = spot.standing(read, { x: 5.5, y: 37, z: 8.5 });
  assert.equal(here.floor, 'cobblestone');
  assert.equal(here.ring, 3);
  assert.equal(here.over, 'lava');
  assert.equal(here.dropBlocks, 4);
  assert.equal(here.narrow, true);
  assert.equal(here.deadly, true);
  assert.match(spot.spotSays(here), /span one block wide over lava \(4 blocks of air, then lava\): a push off it is death/);
});

test('note 641: a floor three blocks across, or ground under the span, is not a deadly spot', () => {
  const world = tmp('spot-wide');
  writeRegion(world, (x, y, z) => y < 32 ? 'lava' : (y === 36 && x >= 4 && x <= 6 ? 'cobblestone' : null));
  const read = spot.blockReader(world, 'the_nether');
  const wide = spot.standing(read, { x: 5.5, y: 37, z: 8.5 });
  assert.equal(wide.narrow, false);
  assert.equal(wide.deadly, false);
  assert.equal(spot.spotSays(wide), '');
  const low = tmp('spot-low');
  writeRegion(low, (x, y, z) => y === 36 && x === 5 ? 'cobblestone' : y === 34 ? 'netherrack' : null);
  const onGround = spot.standing(spot.blockReader(low, 'the_nether'), { x: 5.5, y: 37, z: 8.5 });
  assert.equal(onGround.over, 'ground');
  assert.equal(onGround.deadly, false);
});

test('note 641: a bot saved in the air, or in a chunk the world did not keep, is an unknown spot and counts against nothing', () => {
  const world = tmp('spot-unknown'); writeRegion(world, spanWorld);
  const read = spot.blockReader(world, 'the_nether');
  assert.equal(spot.standing(read, { x: 5.5, y: 40.5, z: 8.5 }), null);
  assert.equal(spot.standing(read, { x: 500.5, y: 37, z: 8.5 }), null);
  assert.equal(spot.spotOf(path.join(world, 'nowhere'), { position: { x: 5.5, y: 37, z: 8.5 }, dimension: 'the_nether' }), null);
  assert.equal(spot.spotOf(world, null), null);
  const snap = tmp('spot-of'); fs.renameSync(world, path.join(snap, 'world'));
  const s = spot.spotOf(snap, { position: { x: 5.5, y: 37, z: 8.5 }, dimension: 'the_nether' });
  assert.equal(s.deadly, true);
  assert.equal(s.x, 5.5);
});

const snap = (name, { health = 20, hunger = 20, food = 60, started = 0, last = 0, recent = 0, deadly = false, stage: at = 'fortress' } = {}) =>
  ({ name, stage: at, dir: `/x/${name}`, source: stage.sourceWorld(name), started, last, recent, vitals: { health, hunger, foodPoints: food },
    spot: deadly ? { deadly: true, narrow: true, ring: 3, over: 'lava', dropBlocks: 4 } : null });

test('note 641: a save on a span over lava is not a start while others qualify, and the pick says it left it out', () => {
  const stages = { fortress: [snap('mid-1-a-100000', { deadly: true }), snap('mid-2-b-100000'), snap('mid-3-c-100000'), snap('mid-4-d-100000')], nether: [] };
  const seen = new Set();
  for (let i = 0; i < 6; i++) { const pick = stage.choose(stages, 'fortress'); seen.add(pick.snapshot.name); pick.snapshot.started++; }
  assert.deepEqual([...seen].sort(), ['mid-2-b-100000', 'mid-3-c-100000', 'mid-4-d-100000']);
  const pick = stage.choose(stages, 'fortress');
  assert.equal(pick.rule, 'qualifying');
  assert.match(pick.why, /3 of 4 fortress saves/);
  assert.match(pick.why, /fortress stage: 1 on a span over lava or a deadly drop left out/);
  assert.deepEqual(stage.allShortfalls(stages.fortress[0]).length, 1);
  assert.match(stage.allShortfalls(stages.fortress[0])[0], /a push off it is death/);
});

test('note 641: with the span save out, two qualifying fortress saves are too few and the start is a nether one', () => {
  const stages = {
    fortress: [snap('mid-1-a-100000', { deadly: true }), snap('mid-2-b-100000'), snap('mid-3-c-100000')],
    nether: [snap('mid-9-z-100000', { stage: 'nether', deadly: true }), snap('mid-8-y-100000', { stage: 'nether', started: 5 })],
  };
  const pick = stage.choose(stages, 'fortress');
  assert.equal(pick.rule, 'fallback-nether');
  assert.equal(pick.snapshot.name, 'mid-8-y-100000');
  // and when nothing qualifies anywhere, a save off a span is still preferred to one on it
  const none = stage.choose({ fortress: [snap('mid-1-a-100000', { deadly: true })], nether: [snap('mid-9-z-100000', { stage: 'nether', deadly: true }), snap('mid-8-y-100000', { stage: 'nether', hunger: 10, started: 9 })] }, 'fortress');
  assert.equal(none.rule, 'fallback-nether-any');
  assert.equal(none.snapshot.name, 'mid-8-y-100000');
});

test('note 641: a save started four times in the last hour rests, and the rest can be changed or turned off', () => {
  const stages = { fortress: [snap('mid-1-a-100000', { recent: 4 }), snap('mid-2-b-100000', { recent: 3, started: 9 }), snap('mid-3-c-100000', { started: 9 }), snap('mid-4-d-100000', { started: 9 })], nether: [] };
  assert.equal(stage.choose(stages, 'fortress').snapshot.name === 'mid-1-a-100000', false);
  assert.match(stage.allShortfalls(stages.fortress[0])[0], /started 4 times in the last hour \(rests at 4\)/);
  assert.deepEqual(stage.allShortfalls(stages.fortress[1]), []);
  assert.match(stage.choose(stages, 'fortress', { maxPerHour: 3 }).why, /only 2 of 4 fortress saves qualify.*\(fortress stage: 2 resting after 3 starts in the hour left out\)/);
  assert.equal(stage.choose(stages, 'fortress', { maxPerHour: 0 }).snapshot.name, 'mid-1-a-100000');
  assert.match(stage.listing(stages, 'fortress'), /mid-1-a-100000\s+1-a\s+20\s+20\s+60\s+0\s+4\s+.*no: started 4 times in the last hour/);
});

test('note 641: the starts of the last hour come from the log beside the saves, not from the saves', async () => {
  const root = tmp('starts'), dir = path.join(root, '.trial-checkpoints', 'stages', 'fortress', 'mid-1-a-100000');
  fs.mkdirSync(path.join(dir, 'world', 'players', 'data'), { recursive: true }); fs.mkdirSync(path.join(dir, 'state'));
  const tag = nbt.comp({ Health: nbt.float(20), foodLevel: nbt.int(20), foodSaturationLevel: nbt.float(5), Dimension: nbt.string('minecraft:the_nether'),
    Pos: nbt.list(nbt.double([5.5, 37, 8.5])), Inventory: nbt.list(nbt.comp([{ id: nbt.string('minecraft:cooked_mutton'), count: nbt.int(8) }])) });
  fs.writeFileSync(path.join(dir, 'world', 'players', 'data', 'abc.dat'), zlib.gzipSync(nbt.writeUncompressed(tag, 'big')));
  writeRegion(path.join(dir, 'world'), spanWorld);
  const now = Date.parse('2026-09-28T23:30:00Z'), at = m => new Date(now - m * 60000).toISOString().replace('.000', '');
  fs.writeFileSync(path.join(root, '.trial-checkpoints', 'stage-starts.log'), [
    `${at(5)}\tfortress\tmid-1-a-100000`, `${at(59)}\tfortress\tmid-1-a-100000`, `${at(61)}\tfortress\tmid-1-a-100000`,
    `${at(10)}\tnether\tmid-1-a-100000`, `${at(3)}\tfortress\tmid-2-b-100000`, 'garbage', ''].join('\n'));
  assert.deepEqual(stage.recentStarts(root, now), { 'fortress/mid-1-a-100000': 2, 'nether/mid-1-a-100000': 1, 'fortress/mid-2-b-100000': 1 });
  const before = fs.readdirSync(dir, { recursive: true }).sort();
  const [s] = await stage.readStage(root, 'fortress', { now });
  assert.equal(s.recent, 2);
  assert.deepEqual(s.vitals.position, { x: 5.5, y: 37, z: 8.5 });
  assert.equal(s.spot.deadly, true);
  assert.match(stage.allShortfalls(s).join('; '), /span one block wide over lava/);
  assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), before);
});

test('a fortress start goes to the source world with the fewest trials running now, before the fewest starts ever', () => {
  const stages = { fortress: [snap('mid-242-ee-125002', { started: 8 }), snap('mid-242-dh-100822', { started: 16 }), snap('mid-242-bb-100000', { started: 20 })], nether: [] };
  assert.equal(stage.choose(stages, 'fortress').snapshot.name, 'mid-242-ee-125002');
  const pick = stage.choose(stages, 'fortress', { running: { '242-ee': 3, '242-dh': 1 } });
  assert.equal(pick.snapshot.name, 'mid-242-bb-100000');
  assert.match(pick.why, /0 running now/);
  assert.equal(stage.choose(stages, 'fortress', { running: { '242-ee': 1, '242-dh': 1, '242-bb': 1 } }).snapshot.name, 'mid-242-ee-125002');
});

test('the trials running now are read from each listening trial server\'s level-name, the port being started left out', () => {
  const root = tmp('running');
  const serve = (dir, port, level) => { fs.mkdirSync(path.join(root, dir), { recursive: true }); fs.writeFileSync(path.join(root, dir, 'server.properties'), `server-port=${port}\nlevel-name=${level}\n`); };
  serve('.clean-run', 25581, 'mid-243-fg');
  serve('.clean-run-25584', 25584, 'mid-242-ee-fortress-9');
  serve('.clean-run-25585', 25585, 'mid-242-ee-fortress-10');
  serve('.clean-run-25586', 25586, 'mid-242-ee-fortress-3');
  serve('.clean-run-25601', 25601, 'retry-214-a-182443-1');
  const up = new Set([25581, 25584, 25585, 25601]);
  assert.deepEqual(stage.runningSources(root, { listening: p => up.has(p) }), { '243-fg': 1, '242-ee': 2 });
  assert.deepEqual(stage.runningSources(root, { exceptPort: 25585, listening: p => up.has(p) }), { '243-fg': 1, '242-ee': 1 });
});

test('a fortress save without a pickaxe or blocks to lay is not a start (the crossing kit, note 673)', () => {
  assert.deepEqual(stage.kitOf([{ id: 'minecraft:iron_pickaxe', count: 1 }, { id: 'minecraft:cobblestone', count: 40 }, { id: 'minecraft:cooked_beef', count: 8 }]), { pickaxes: 1, blocks: 40 });
  const v = { health: 20, hunger: 20, foodPoints: 80 };
  assert.match(stage.shortfalls({ ...v, pickaxes: 0, blocks: 64 }).join(';'), /0 pickaxes \(under 1\)/);
  assert.match(stage.shortfalls({ ...v, pickaxes: 1, blocks: 6 }).join(';'), /6 blocks to lay \(under 32\)/);
  assert.deepEqual(stage.shortfalls({ ...v, pickaxes: 2, blocks: 64 }), []);
  assert.deepEqual(stage.shortfalls(v), [], 'a save read before the kit was recorded is judged without it');
});

'use strict';
// mid-243-bf (25581, 2026-09-28, note 632): the view had air where the server
// held dirt, and the server put the body back a thousand times in two minutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const truth = require('../src/server-truth');
const { Task } = require('../src/skills');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BLOCKS = {
  0: { name: 'air', boundingBox: 'empty' },
  1: { name: 'stone', boundingBox: 'block' },
  10: { name: 'dirt', boundingBox: 'block' },
  20: { name: 'oak_door', boundingBox: 'block' },
};
const key = p => `${p.x},${p.y},${p.z}`;

// A client and a server. `view` is what the bot sees, `server` what the
// game holds, both by cell. The server answers a use of a face with the
// reference block and the block across the face (handleUseItemOn), and a
// finished dig by breaking the block unless it `refuses` (says nothing).
function world({ view = {}, server = {}, position = new Vec3(23.5, 79.07, -4.5), offhand = { name: 'shield' }, held = { name: 'cobblestone' }, refuses = false, breakAfterMs = 30 } = {}) {
  const seen = new Map(Object.entries(view)), truthy = new Map(Object.entries(server));
  const client = new EventEmitter();
  client.writes = [];
  const bot = new EventEmitter();
  const at = p => { const id = seen.get(key(p)) ?? (p.y <= 77 ? 1 : 0); return { ...BLOCKS[id], stateId: id, type: id, position: new Vec3(p.x, p.y, p.z) }; };
  Object.assign(bot, {
    _client: client, entity: { position }, heldItem: held, inventory: { slots: { 45: offhand } },
    supportFeature: () => true, blockAt: at,
    _updateBlockState: (p, id) => { seen.set(key(p), id); bot.emit('blockUpdate', null, at(p)); },
    dug: [],
  });
  // Mineflayer's own handling of what the server says.
  client.on('block_change', packet => seen.set(key(packet.location), packet.type));
  const say = (p, id) => { truthy.set(key(p), id); client.emit('block_change', { location: { x: p.x, y: p.y, z: p.z }, type: id }); };
  const held_ = p => truthy.get(key(p)) ?? seen.get(key(p)) ?? (p.y <= 77 ? 1 : 0);
  client.write = (name, packet) => {
    client.writes.push({ name, packet });
    if (name !== 'block_place') return;
    const dirs = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][packet.direction];
    const ref = packet.location, dest = new Vec3(ref.x + dirs[0], ref.y + dirs[1], ref.z + dirs[2]);
    setTimeout(() => { say(ref, held_(ref)); say(dest, held_(dest)); }, 5);
  };
  // Mineflayer's dig: the block is gone from the view when the time is up
  // and the promise resolves on that local write.
  bot.dig = async block => {
    bot.dug.push(key(block.position));
    await sleep(10);
    bot._updateBlockState(block.position, 0);
    if (!refuses) setTimeout(() => say(block.position, 0), breakAfterMs);
  };
  return { bot, client, seen, truthy, say };
}

test('a dig is finished when the server says the block is gone', async () => {
  const w = world({ view: { '23,78,-5': 10 }, server: { '23,78,-5': 10 } });
  truth.confirmDigs(w.bot, { confirmMs: 120 });
  await w.bot.dig(w.bot.blockAt(new Vec3(23, 78, -5)));
  assert.equal(w.bot.dug.length, 1);
  assert.equal(w.client.writes.length, 0, 'the server was not asked: it had said');
  assert.equal(w.bot.blockAt(new Vec3(23, 78, -5)).name, 'air');
});

test('a dig the server did not carry out asks it, puts its block back in the view, tries once more and then says so', async () => {
  const w = world({ view: { '23,78,-5': 10 }, server: { '23,78,-5': 10 }, refuses: true });
  truth.confirmDigs(w.bot, { confirmMs: 120 });
  const events = [];
  w.bot.on('dig_unconfirmed', e => events.push(e));
  await assert.rejects(w.bot.dig(w.bot.blockAt(new Vec3(23, 78, -5))), { name: 'DigNotConfirmed', message: /server did not break the dirt at \(23, 78, -5\)/ });
  assert.equal(w.bot.dug.length, 2, 'the dig was tried once more');
  assert.equal(w.bot.blockAt(new Vec3(23, 78, -5)).name, 'dirt', 'the view has what the server has');
  const ask = w.client.writes.find(x => x.name === 'block_place');
  assert(ask, 'the server was asked');
  // Through the block under the cell, its top face, with the shield's hand.
  assert.deepEqual([ask.packet.location.x, ask.packet.location.y, ask.packet.location.z, ask.packet.direction, ask.packet.hand], [23, 77, -5, 1, 1]);
  assert.equal(events.length, 1);
});

test('a dig of a block the server had already broken ends well: its answer is air', async () => {
  const w = world({ view: { '23,78,-5': 10 }, server: { '23,78,-5': 0 }, refuses: true });
  truth.confirmDigs(w.bot, { confirmMs: 120 });
  await w.bot.dig(w.bot.blockAt(new Vec3(23, 78, -5)));
  assert.equal(w.bot.dug.length, 1);
  assert.equal(w.bot.blockAt(new Vec3(23, 78, -5)).name, 'air');
});

test('nothing is asked with a block, a bucket or a tool that changes ground in the hands', async () => {
  for (const [offhand, held, expected] of [[{ name: 'torch' }, { name: 'cobblestone' }, null], [null, { name: 'iron_pickaxe' }, 1], [{ name: 'torch' }, { name: 'iron_pickaxe' }, 0], [{ name: 'shield' }, { name: 'water_bucket' }, 1], [{ name: 'torch' }, { name: 'stone_axe' }, null], [{ name: 'torch' }, null, 0]]) {
    assert.equal(truth.probeHand({ inventory: { slots: { 45: offhand } }, heldItem: held })?.hand ?? null, expected, `${offhand?.name}/${held?.name}`);
  }
  const w = world({ view: { '23,78,-5': 10 }, server: { '23,78,-5': 10 }, refuses: true, offhand: { name: 'torch' }, held: { name: 'cobblestone' } });
  truth.confirmDigs(w.bot, { confirmMs: 120 });
  await assert.rejects(w.bot.dig(w.bot.blockAt(new Vec3(23, 78, -5))), { name: 'DigNotConfirmed' });
  assert.equal(w.client.writes.length, 0, 'no use of a face with a block in hand');
  assert.equal(w.bot.blockAt(new Vec3(23, 78, -5)).name, 'dirt', 'not asked, the block is put back in the view');
});

test('a door is never the block asked through', () => {
  const w = world({ view: { '23,77,-5': 20 } });
  const cell = new Vec3(23, 78, -5);
  const ref = truth.referenceFor(w.bot, cell);
  assert(!ref || ref.block.name !== 'oak_door');
  assert.equal(truth.referenceFor(w.bot, new Vec3(23, 80, -5)), null, 'open air on every side');
});

test('the server put the body back over a block the view lacks: asked about the cells round the body, the view is corrected and the facts say so', async () => {
  // The body held 0.07 over dirt the view shows as air.
  const w = world({ view: { '23,78,-5': 0, '23,77,-5': 10 }, server: { '23,78,-5': 10, '23,77,-5': 10 } });
  truth.serverTruthPlugin(w.bot);
  for (let i = 0; i < 9; i++) w.bot.emit('forcedMove');
  w.bot.serverTruth.noteLoop({ position: w.bot.entity.position, count: 4, seconds: 0.4 });
  const before = w.bot.serverTruth.says();
  assert.match(before.says, /put the body back where it was 9 times/);
  assert.match(before.says, /held 0\.07 over the top of \(23, 78, -5\), which the view says is air/);
  const reply = await w.bot.serverTruth.resyncAround(new Task('test', 'resync'), { loop: { count: 4, seconds: 0.4 } });
  assert.deepEqual(reply.corrected, [{ x: 23, y: 78, z: -5, was: 'air', now: 'dirt' }]);
  assert.equal(w.bot.blockAt(new Vec3(23, 78, -5)).name, 'dirt');
  const after = w.bot.serverTruth.says();
  assert.equal(after.viewDiffered.length, 1);
  assert.match(after.says, /its answer differed from the view at \(23, 78, -5\): the view had air, the server has dirt, now in the view/);
  assert.doesNotMatch(after.says, /held 0\.07 over/, 'the view is right now');
});

test('asked and answered the same, the facts say the view matched', async () => {
  const w = world({ view: { '23,77,-5': 10 }, server: { '23,77,-5': 10 }, position: new Vec3(23.5, 78, -4.5) });
  truth.serverTruthPlugin(w.bot);
  w.bot.serverTruth.noteLoop({ position: w.bot.entity.position, count: 4, seconds: 0.4 });
  const reply = await w.bot.serverTruth.resyncAround(new Task('test', 'resync'));
  assert.equal(reply.corrected.length, 0);
  assert(reply.asked > 0 && reply.answered > 0);
  assert.match(w.bot.serverTruth.says().says, /answers matched the view/);
});

test('whatever the bot is doing, five corrections in two seconds at one place ask the server, at most three times a minute', async () => {
  const w = world({ view: { '23,78,-5': 0, '23,77,-5': 10 }, server: { '23,78,-5': 10, '23,77,-5': 10 } });
  truth.serverTruthPlugin(w.bot);
  const resyncs = [];
  w.bot.on('view_resync', e => resyncs.push(e));
  for (let i = 0; i < 4; i++) w.bot.emit('forcedMove');
  await sleep(50);
  assert.equal(resyncs.length, 0, 'four is a walk\'s own count, not this watcher\'s');
  w.bot.emit('forcedMove');
  await sleep(600);
  assert.equal(resyncs.length, 1);
  assert.deepEqual(resyncs[0].corrected, [{ x: 23, y: 78, z: -5, was: 'air', now: 'dirt' }]);
  assert.equal(w.bot.blockAt(new Vec3(23, 78, -5)).name, 'dirt');
  assert.match(w.bot.serverTruth.says().says, /differed from the view at \(23, 78, -5\)/);
  // The same place again and again: asked twice more, then left to Jev's move.
  for (let round = 0; round < 5; round++) { for (let i = 0; i < 5; i++) w.bot.emit("forcedMove"); await sleep(120); }
  assert.equal(resyncs.length, 3);
});

test('no loop near the body, or an old one, says nothing', () => {
  const w = world({});
  truth.serverTruthPlugin(w.bot);
  assert.equal(w.bot.serverTruth.says(), null);
  w.bot.serverTruth.noteLoop({ position: new Vec3(40, 79, -4), count: 5, seconds: 1 });
  assert.equal(w.bot.serverTruth.says(), null, 'far from here');
  w.bot.serverTruth.noteLoop({ position: w.bot.entity.position, count: 5, seconds: 1 });
  w.bot._correctionLoops.at(-1).at -= 400000;
  assert.equal(w.bot.serverTruth.says(), null, 'six minutes ago');
});

// A walk whose body the server keeps putting back: the pathfinder never
// arrives while corrections flood; after the view is corrected it does.
function pinnedWalk({ corrected }) {
  const bot = new EventEmitter();
  const controls = {};
  let attempts = 0, flood;
  const asked = [];
  Object.assign(bot, {
    entity: { position: new Vec3(23.5, 79.07, -4.5), onGround: false },
    blockAt: p => ({ name: p.y === 78 ? 'air' : 'stone', shapes: [], boundingBox: 'empty', position: p }),
    clearControlStates: () => { for (const k of Object.keys(controls)) controls[k] = false; },
    setControlState: (k, v) => { controls[k] = v; },
    lookAt: async () => {},
    pathfinder: {
      goto: () => {
        attempts++;
        if (attempts === 1) { flood = setInterval(() => bot.emit('forcedMove'), 10); return new Promise(() => {}); }
        return Promise.resolve();
      },
      setGoal: () => clearInterval(flood),
    },
    serverTruth: {
      noteLoop: details => asked.push(['loop', details.count]),
      resyncAround: async (_task, { loop }) => { asked.push(['ask', loop.count]); if (corrected) bot.entity.onGround = true; return { asked: 5, answered: 5, corrected: corrected ? [{ x: 23, y: 78, z: -5, was: 'air', now: 'dirt' }] : [] }; },
    },
  });
  return { bot, asked, attempts: () => attempts, dispose: () => clearInterval(flood) };
}

test('a walk pinned by the server asks it what is there, and walks again with the view it answers', async () => {
  const { navigate } = require('../src/skills');
  const w = pinnedWalk({ corrected: true });
  try {
    await navigate(w.bot, new Task('test', 'pinned'), {}, { timeoutMs: 3000 });
    assert.equal(w.attempts(), 2, 'walked again once the view was corrected');
    assert.deepEqual(w.asked.map(a => a[0]), ['loop', 'ask']);
    assert.equal(w.bot.listenerCount('forcedMove'), 0);
  } finally { w.dispose(); }
});

test('a walk pinned by the server that finds the view right fails with the facts said', async () => {
  const { navigate } = require('../src/skills');
  const w = pinnedWalk({ corrected: false });
  try {
    await assert.rejects(navigate(w.bot, new Task('test', 'pinned'), {}, { timeoutMs: 3000 }), err => {
      assert.match(err.message, /^Repeated server movement corrections at the same position$/, 'the problem text is the audit\'s key and stays');
      assert.match(err.facts, /corrections in \d+ s; the server was asked about 5 blocks round the body and its answers matched the view/);
      return true;
    });
  } finally { w.dispose(); }
});

// The unstuck moves (src/unstuck.js): read from the view, and one that asks.
const { localMoves, describeMove, perform } = require('../src/unstuck');
const stoneWorld = (extra = {}) => ({ name: p => (p.y >= 80 ? 'air' : p.y === 79 && p.x === 23 && p.z === -5 ? 'air' : 'stone'), carried: {}, pickaxe: 'iron_pickaxe', ...extra });

test('ask_server is offered only when the server has been putting the body back, and says how often and what was found', () => {
  const feet = new Vec3(23, 79, -5);
  assert(!localMoves(stoneWorld(), feet).moves.some(m => m.key === 'ask_server'));
  const corrections = { times: 340, withinSeconds: 118, at: { x: 23, y: 79, z: -5 }, secondsAgo: 30, askedAbout: 0, viewDiffered: [], says: 'x' };
  const moves = localMoves(stoneWorld({ corrections }), feet).moves;
  const ask = moves.find(m => m.key === 'ask_server');
  assert.equal(ask.kind, 'resync');
  assert.match(describeMove(ask), /Ask the server what the blocks round the body are.*nothing is placed or broken.*put the body back 340 times in 118 seconds here/);
  const again = localMoves(stoneWorld({ corrections: { ...corrections, askedAbout: 30, secondsAgo: 12, viewDiffered: [{ x: 23, y: 78, z: -5, was: 'air', now: 'dirt' }] } }), feet).moves.find(m => m.key === 'ask_server');
  assert.match(describeMove(again), /asked 12 seconds ago about 30 blocks and its answer differed from the view at \(23, 78, -5\)/);
});

test('the ask_server move asks the server whichever cell the jittering body floors to', async () => {
  const w = world({ view: { '23,78,-5': 0, '23,77,-5': 10 }, server: { '23,78,-5': 10, '23,77,-5': 10 }, position: new Vec3(23.5, 78.996, -4.5) });
  truth.serverTruthPlugin(w.bot);
  w.bot.serverTruth.noteLoop({ position: w.bot.entity.position, count: 4, seconds: 0.4 });
  const move = { key: 'ask_server', kind: 'resync', from: new Vec3(23, 79, -5) };
  await perform(w.bot, new Task('test', 'ask'), move, { dig: async () => { throw new Error('no dig'); } });
  assert.deepEqual(move.result.corrected, [{ x: 23, y: 78, z: -5, was: 'air', now: 'dirt' }]);
});

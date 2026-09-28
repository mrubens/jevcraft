'use strict';
// The ghast's facts from the 26.1.2 jar, and the strike that sends its
// fireball back (src/ghast.js, note 551).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const ghast = require('../src/ghast');

test('a ghast fireball\'s flight each way, from the jar\'s gain and drag', () => {
  // Out: starts four blocks ahead at 0.1 a tick; back: the look, one block a tick.
  assert.equal(ghast.outSeconds(20), 1);
  assert.equal(ghast.outSeconds(40), 1.7);
  assert.equal(ghast.backSeconds(30), 1.1);
  assert(ghast.backSeconds(40) < ghast.outSeconds(40));
});

test('arrows at a ghast: at least 6 a hit to forty blocks, 5 from fifty, two either way for its ten health', () => {
  assert.deepEqual([ghast.arrowAt(30).damage, ghast.arrowAt(30).arrows], [6, 2]);
  assert.deepEqual([ghast.arrowAt(55).damage, ghast.arrowAt(55).arrows], [5, 2]);
});

test('a block a ghast\'s blast never breaks is one of blast resistance about 4 or more', () => {
  const registry = require('minecraft-data')('26.1');
  const carry = names => ({ registry, inventory: { items: () => names.map(([name, count]) => ({ name, count })) } });
  const materials = new Set(['netherrack', 'cobblestone', 'oak_planks', 'basalt', 'dirt']);
  assert(ghast.HOLDS_AT > 3 && ghast.HOLDS_AT < 4.2);
  assert.equal(ghast.blastProofMaterial(carry([['netherrack', 60], ['cobblestone', 3]]), materials), 'cobblestone');
  assert.equal(ghast.blastProofMaterial(carry([['basalt', 5]]), materials), 'basalt', 'basalt 4.2 holds');
  assert.equal(ghast.blastProofMaterial(carry([['oak_planks', 20], ['dirt', 9]]), materials), null);
  assert.match(ghast.coverSays(carry([['oak_planks', 20]]), materials), /None of the blocks carried holds: the cover can be blown out by the fireball it stops\. Carried that it can break: oak planks \(20, blast resistance 3\)/);
});

// A server and a mineflayer client as they are for a ghast's fireball
// (note 574): the server ticks every 50 ms and flies the fireball as
// AbstractHurtingProjectile.tick does, sends its place only every ten ticks
// (and at once when struck), with its motion as the packet carries it
// (blocks a tick); it takes
// a strike while the fireball's box is within six blocks of the eyes, and
// sends a struck one along the look last sent. The client's physics tick
// comes between the server's, emits 'physicsTick' and then sends its look.
// Time is the world's own (a tick is 50 ms of it), run five times as fast.
function fireballWorld({ distance, rise = 6, spawnTick = 3, wallMs = 10 }) {
  const { EventEmitter } = require('node:events');
  const bot = new EventEmitter();
  bot._client = new EventEmitter();
  bot.entity = { position: new Vec3(0.5, 64, 0.5) };
  const eye = bot.entity.position.offset(0, 1.62, 0), middle = bot.entity.position.offset(0, 0.9, 0);
  const g = { id: 21, name: 'ghast', position: new Vec3(0.5 + distance, 64 + rise, 0.5), height: 4, isValid: true };
  bot.entities = { 21: g };
  const queue = [], out = { landed: 0, killed: 0, taken: 0, strikes: 0 };
  let pending = null, sentLook = null, lastQueued = null;
  bot.lookAt = async (p, force) => { assert.equal(force, true); pending = p.minus(eye).normalize(); };
  bot.attack = e => { out.strikes++; queue.push({ attack: e.id }); };
  let ball = null, tick = 0, clock = 0;
  const boxDistance = c => Math.hypot(Math.max(0, Math.abs(eye.x - c.x) - 0.5), Math.max(0, Math.abs(eye.y - c.y) - 0.5), Math.max(0, Math.abs(eye.z - c.z) - 0.5));
  const near = (a, v, box, pad) => { for (let i = 0; i <= 10; i++) { const p = a.plus(v.scaled(i / 10)); if (p.x >= box.min.x - pad && p.x <= box.max.x + pad && p.y >= box.min.y - pad && p.y <= box.max.y + pad && p.z >= box.min.z - pad && p.z <= box.max.z + pad) return true; } return false; };
  const send = () => {
    const e = bot.entities[ball.id];
    e.position = ball.centre.offset(0, -0.5, 0); e.velocity = ball.v.clone();
    bot.emit('entityMoved', e);
    bot._client.emit('entity_velocity', { entityId: ball.id, velocity: { x: ball.v.x, y: ball.v.y, z: ball.v.z } });
  };
  const serverTick = () => {
    tick++; clock = tick * 50;
    for (const p of queue.splice(0)) {
      if (p.look) sentLook = p.look;
      if (p.attack && ball && p.attack === ball.id && boxDistance(ball.centre) <= 6) { out.taken++; ball.v = sentLook; ball.back = true; ball.sync = true; }
    }
    if (tick === spawnTick) {
      const centre = g.position.offset(0, 2, 0), dir = middle.minus(centre).normalize();
      ball = { id: 40, centre: centre.plus(dir.scaled(4)), v: dir.scaled(0.1), age: 0 };
      bot.entities[40] = { id: 40, name: 'fireball', position: ball.centre.offset(0, -0.5, 0), velocity: ball.v.clone(), height: 1, isValid: true };
      bot._client.emit('spawn_entity', { entityId: 40, type: 52, x: ball.centre.x, y: ball.centre.y - 0.5, z: ball.centre.z, velocity: { x: ball.v.x, y: ball.v.y, z: ball.v.z } });
      return;
    }
    if (!ball) return;
    ball.age++;
    const n = ball.v.norm(); ball.v = ball.v.plus(ball.v.scaled(0.1 / n)).scaled(0.95);
    const ghastBox = { min: g.position.offset(-2, 0, -2), max: g.position.offset(2, 4, 2) };
    const botBox = { min: bot.entity.position.offset(-0.3, 0, -0.3), max: bot.entity.position.offset(0.3, 1.8, 0.3) };
    const gone = why => { out[why]++; bot.entities[ball.id].isValid = false; delete bot.entities[ball.id]; ball = null; };
    if (ball.back && near(ball.centre, ball.v, ghastBox, 0.5)) { gone('killed'); g.isValid = false; bot.emit('entityDead', g); return; }
    if (!ball.back && near(ball.centre, ball.v, botBox, 0.5)) return gone('landed');
    ball.centre = ball.centre.plus(ball.v);
    if (ball.age > 120) { delete bot.entities[ball.id]; ball = null; return; }
    if (ball.age % 10 === 0 || ball.sync) { ball.sync = false; send(); }
  };
  const clientTick = () => { clock = tick * 50 + 25; bot.emit('physicsTick'); if (pending && pending !== lastQueued) { queue.push({ look: pending }); lastQueued = pending; } };
  const timers = [setInterval(serverTick, wallMs)];
  const start = setTimeout(() => timers.push(setInterval(clientTick, wallMs)), wallMs / 2);
  return { bot, g, out, now: () => clock, stop: () => { clearTimeout(start); timers.forEach(clearInterval); } };
}

for (const distance of [22, 30, 44, 60]) {
  test(`a ghast ${distance} blocks off: its fireball, sent where it was only every ten ticks, is flown between and struck while the server takes it, and goes back into the ghast (note 574)`, async () => {
    const w = fireballWorld({ distance });
    try {
      const r = await ghast.returnFireball(w.bot, { check: () => {} }, w.g, { seconds: 4, now: w.now });
      assert.equal(w.out.landed, 0, `landed: ${JSON.stringify({ ...w.out, ...r })}`);
      assert(w.out.taken >= 1, `the server took no strike: ${JSON.stringify({ ...w.out, ...r })}`);
      assert.equal(w.out.killed, 1, JSON.stringify({ ...w.out, ...r }));
      assert.equal(r.ghastGone, true);
      assert.equal(r.killed, 1);
      assert.equal(r.came, 1);
      assert.equal(r.struck, 1);
      assert.equal(r.sentBack, 1, JSON.stringify(r));
      assert.equal(r.landed, 0);
    } finally { w.stop(); }
  });
}

test('a fireball that lands, struck at nothing in reach, is counted landed', async () => {
  // The bot looks away and never strikes: attack is refused.
  const w = fireballWorld({ distance: 30 });
  w.bot.attack = () => { throw new Error('no strike'); };
  try {
    const r = await ghast.returnFireball(w.bot, { check: () => {} }, w.g, { seconds: 2.5, now: w.now });
    assert.equal(w.out.landed, 1);
    assert.deepEqual([r.came, r.struck, r.sentBack, r.landed, r.killed], [1, 0, 0, 1, 0]);
  } finally { w.stop(); }
});

test('where a fireball is between its updates: the jar\'s gain and drag from its last place and motion', () => {
  const at = ghast.flyTicks({ x: 0, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 2);
  // (1 + 0.1) x 0.95 = 1.045, then (1.045 + 0.1) x 0.95 = 1.08775.
  assert.ok(Math.abs(at.position.x + 2.13275) < 1e-9, at.position.x);
  assert.ok(Math.abs(at.velocity.x + 1.08775) < 1e-9);
});

test('ghastNote is said only with a ghast within its reach', () => {
  const near = [{ entity: { name: 'ghast' }, distance: 31 }];
  assert.match(ghast.ghastNote(near, 3.1), /^ The ghast 31 blocks off fires only at a bot it can see within 64 blocks: its fireball about 1 second after it has a line, then one every 3 seconds while it keeps it, each taking about 1\.4 seconds to cross 31 blocks and about 3\.1 after armour where it lands\. It drifts through the air at random and walks no way/);
  assert.equal(ghast.ghastNote([{ entity: { name: 'ghast' }, distance: 70 }], 3.1), '');
  assert.equal(ghast.ghastNote([{ entity: { name: 'zombie' }, distance: 5 }], 3.1), '');
});

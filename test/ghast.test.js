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

test('the fireball is struck once it comes within five blocks, the look on the ghast, and the watch ends when the ghast is gone', async () => {
  const g = { id: 21, name: 'ghast', position: new Vec3(30.5, 70, 0.5), height: 4, isValid: true };
  const ball = { id: 40, name: 'fireball', position: new Vec3(12.5, 66, 0.5), velocity: new Vec3(-1.5, -0.2, 0), isValid: true };
  const looks = [], attacks = [];
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 21: g, 40: ball },
    lookAt: async p => { looks.push(p); }, attack: e => { attacks.push(e.id); } };
  const watching = ghast.returnFireball(bot, { check: () => {} }, g, { seconds: 2 });
  await new Promise(r => setTimeout(r, 120));
  assert.deepEqual(attacks, [], 'twelve blocks off: not yet');
  ball.position = new Vec3(4.5, 65.5, 0.5);
  await new Promise(r => setTimeout(r, 120));
  assert.deepEqual(attacks, [40], 'within five: struck, once');
  assert(looks.at(-1).equals(new Vec3(30.5, 72, 0.5)), 'looking at the ghast\'s middle as it is struck');
  g.isValid = false;
  const r = await watching;
  assert.equal(r.ghastGone, true);
  assert.equal(r.strikes, 1);
});

test('ghastNote is said only with a ghast within its reach', () => {
  const near = [{ entity: { name: 'ghast' }, distance: 31 }];
  assert.match(ghast.ghastNote(near, 3.1), /^ The ghast 31 blocks off fires only at a bot it can see within 64 blocks: its fireball about 1 second after it has a line, then one every 3 seconds while it keeps it, each taking about 1\.4 seconds to cross 31 blocks and about 3\.1 after armour where it lands\. It drifts through the air at random and walks no way/);
  assert.equal(ghast.ghastNote([{ entity: { name: 'ghast' }, distance: 70 }], 3.1), '');
  assert.equal(ghast.ghastNote([{ entity: { name: 'zombie' }, distance: 5 }], 3.1), '');
});

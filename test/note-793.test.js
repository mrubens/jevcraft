'use strict';
// Note 793. The Overworld deaths on fresh trials, Jev up (66, 2026-09-30T08:40Z
// to the Jev-down at 2026-10-01T04:57:47Z): in 46 a stance question of the
// last minute offered the retreat with no way ("No way found yet: 2 of 12
// spots tried", or "No way out"), the bot's own footing of the minutes
// before never looked at; and 22 died under a stance priced at or past the
// health it was chosen at, held on its price, so its damage end lay past
// the death (scripts/fatal-spans.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const WB = require('../src/way-back');
const danger = require('../src/danger');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { groundBot } = require('./fixtures/saved-ground');

const trailOf = (cells, now = Date.now(), every = 400) => {
  const trail = { cells: [] };
  cells.forEach(([x, y, z], i) => WB.noteCell(trail, { x, y, z }, now - (cells.length - 1 - i) * every));
  return trail;
};
const along = (from, to, y = 64) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => [from + Math.sign(to - from) * i, y, 0]);

test('the way back along its own footing: to the first cell six off and four further from every mob, passing none of them (note 793)', () => {
  const now = Date.now();
  const trail = trailOf(along(-15, 0), now);
  const here = { x: 0.5, y: 64, z: 0.5 };
  const zombies = [{ name: 'zombie', x: 2.5, y: 64, z: 0.5 }, { name: 'zombie', x: 3.5, y: 64, z: 0.5 }];
  const way = WB.find(trail, here, zombies, { now });
  assert.deepEqual(way.end, { x: -6, y: 64, z: 0 });
  assert.equal(way.gain, 6, 'from 2 blocks to 8 from the nearer zombie');
  assert.equal(way.blocks, 6);
  assert.equal(way.cells.length, 7);
  assert.equal(way.nearest.name, 'zombie');
  assert.match(WB.says(way), /^ A way is found: back the way it came, 6 blocks along 7 cells it stood on in the last \d+ seconds, to \(-6, 64, 0\), 6 blocks further from every mob about than here \(the nearest, a zombie, 8 blocks from it\), passing none of them, about 1\.1 seconds at a run\.$/);
  // A zombie standing on it, behind: the way back passes it, and is none.
  const behind = WB.find(trail, here, [...zombies, { name: 'zombie', x: -3.5, y: 64, z: 0.5 }], { now, explain: true });
  assert.equal(behind.none, true);
  assert.match(behind.why, /^the way back passes the zombie 4 blocks off$/);
  // The zombie at arm's length is not walked through: a trail that doubles
  // back past it is no way.
  const doubled = trailOf([...along(-10, 2), [2, 64, 1], [1, 64, 1], [0, 64, 1]], now);
  const arm = WB.find(doubled, { x: 0.5, y: 64, z: 1.5 }, [{ name: 'zombie', x: 1.6, y: 64, z: 0.6 }], { now, explain: true });
  assert.equal(arm.none, true, 'its cells at x 1 and 2 are nearer the zombie than the bot is');
});

test('no way back up a shaft it dug, a drop it came down or a pillar of its own, said why; loops cut; a sparse trail read coarse (note 793)', () => {
  const now = Date.now(), zombie = [{ name: 'zombie', x: 2.5, y: 58, z: 0.5 }];
  // Dug straight down from y 70 to 58, then along to x 0... and the zombie.
  const shaft = trailOf([...Array.from({ length: 7 }, (_, i) => [-3, 64 - i, 0]), [-2, 58, 0], [-1, 58, 0], [0, 58, 0]], now);
  const dug = WB.find(shaft, { x: 0.5, y: 58, z: 0.5 }, zombie, { now, explain: true });
  assert.equal(dug.none, true);
  assert.equal(dug.why, 'the way came down a shaft it dug');
  // A drop of four onto the floor: not walked back up.
  const drop = trailOf([[-6, 62, 0], [-5, 62, 0], [-4, 62, 0], [-3, 58, 0], [-2, 58, 0], [-1, 58, 0], [0, 58, 0]], now);
  assert.equal(WB.find(drop, { x: 0.5, y: 58, z: 0.5 }, zombie, { now, explain: true }).why, 'the way came down a drop it cannot walk back up');
  // A loop: a cell stood on again cuts the way back to it.
  const loop = { cells: [] };
  for (const c of [[0, 64, 0], [1, 64, 0], [2, 64, 0], [3, 64, 0], [2, 64, 0]]) WB.noteCell(loop, { x: c[0], y: c[1], z: c[2] }, now);
  assert.deepEqual(loop.cells.map(c => c.x), [0, 1, 2]);
  // A jump of more than eight (a respawn, a portal) starts it over.
  WB.noteCell(loop, { x: 40, y: 64, z: 0 }, now);
  assert.deepEqual(loop.cells.map(c => c.x), [40]);
  // The flight record's frames, about a second apart, read coarse.
  const sparse = trailOf([[-20, 64, 0], [-15, 64, 0], [-10, 64, 0], [-5, 64, 0], [0, 64, 0]], now, 1000);
  const z = [{ name: 'zombie', x: 2.5, y: 64, z: 0.5 }];
  assert.equal(WB.find(sparse, { x: 0.5, y: 64, z: 0.5 }, z, { now }), null, 'five blocks between cells is no walk on the bot\'s own trail');
  assert.deepEqual(WB.find(sparse, { x: 0.5, y: 64, z: 0.5 }, z, { now, coarse: true }).end, { x: -10, y: 64, z: 0 });
});

// A tunnel at y -14 (25591 mid-239-ax 01:49:50Z on 2026-10-01 had "No way
// out: none of the 12 spots further from every mob has a route that passes
// none of them" while its footing of the 105 seconds before led 16 blocks
// back, 8 further from every mob): a corridor along x, the mobs at its end.
function tunnel() {
  const rows = [], box = { x: [-24, 6], y: [-16, -12], z: [-2, 2] };
  for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
    let r = '';
    for (let x = box.x[0]; x <= box.x[1]; x++) r += (y === -14 || y === -13) && z === 0 ? 'a' : 'b';
    rows.push(r);
  }
  return { box, palette: ['air', 'stone'], rows };
}

test('the retreat scouted in a tunnel offers the way back, said, and runs it along the cells stood on (25591 mid-239-ax, note 793)', async () => {
  const bot = groundBot(tunnel(), { at: new Vec3(0.5, -14, 0.5), health: 15.2, food: 15, worn: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], items: [['iron_sword', 1], ['cobblestone', 20]],
    mobs: [{ id: 1, name: 'zombie', at: new Vec3(3.5, -14, 0.5), height: 1.95 }, { id: 2, name: 'zombie', at: new Vec3(5.5, -14, 0.5), height: 1.95 }] });
  bot._wayBack = trailOf(along(-20, 0, -14));
  const goals = [];
  const survival = new Survival(bot, { navigate: async (b, task, goal) => { goals.push(goal); b.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); } }, { state: { shelters: [] } });
  const threats = danger.threats(bot, 24);
  // No footing of the scout's own: as the 12 spots tried with no route.
  survival.escapeFootings = () => ({ about: threats.map(t => t.entity), footing: [], far: [], near: [], heavy: false, persistent: false, radius: 20 });
  const scout = await survival.scoutRetreat(new Task('x'), threats);
  assert.deepEqual(scout.destination, { x: -6, y: -14, z: 0 });
  assert.equal(scout.back.cells.length, 7);
  assert.equal(scout.gain, 6);
  const retreat = survival.stanceOptions(new Task('x'), {}, () => {}, threats, false).retreat;
  assert.match(retreat.description, /A way is found: back the way it came, 6 blocks along 7 cells it stood on in the last \d+ seconds, to \(-6, -14, 0\), 6 blocks further from every mob about than here \(the nearest, a zombie, 9 blocks from it\), passing none of them, about 1\.1 seconds at a run\./);
  assert.ok(retreat.expects, 'priced as a run with a way');
  assert.equal(await survival.runAway(new Task('x'), {}, () => {}, threats), true);
  assert.deepEqual(goals.map(g => g.x), [-4, -6], 'legs of four cells along the way it came');
  assert.equal(survival.bot.entity.position.x, -5.5);
});

test('with no way back, the retreat says why: here a shaft it dug (note 793)', async () => {
  const bot = groundBot(tunnel(), { at: new Vec3(0.5, -14, 0.5), health: 12, food: 15, items: [['iron_sword', 1]],
    mobs: [{ id: 1, name: 'zombie', at: new Vec3(3.5, -14, 0.5), height: 1.95 }] });
  bot._wayBack = trailOf([...Array.from({ length: 6 }, (_, i) => [-2, -8 - i, 0]), [-1, -14, 0], [0, -14, 0]]);
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const threats = danger.threats(bot, 24);
  survival.escapeFootings = () => ({ about: threats.map(t => t.entity), footing: [new Vec3(-9, -14, 0)], far: [], near: [], heavy: false, persistent: false, radius: 20 });
  const scout = await survival.scoutRetreat(new Task('x'), threats);
  assert.equal(scout.destination, undefined);
  assert.equal(scout.backWhy, 'the way came down a shaft it dug');
  const retreat = survival.stanceOptions(new Task('x'), {}, () => {}, threats, false).retreat;
  assert.match(retreat.description, /No way out: none of the 0 spots|Nowhere to run to/);
  assert.match(retreat.description, /Nor back the way it came: the way came down a shaft it dug\./);
});

test('a hold gives way at six health lost or half the health it was chosen at, whichever is less; a price past the health is no hold to the death (25583 mid-242-yd 09:15:16Z, note 793)', () => {
  assert.equal(danger.holdLoss(20), 6);
  assert.equal(danger.holdLoss(8), 4);
  assert.equal(danger.holdLoss(4.9), 2.45);
  // 25583: shield_guard at 4.9 health priced 38.7 in fifteen seconds; on its
  // price it gave way only past the death.
  const priced = { damage: 38.7, seconds: 15, oneHit: 2.9 };
  assert.equal(danger.pacedLoss(4.9, priced, 5), 2.45);
  // A price well inside the health is the line as before.
  assert.equal(Math.round(danger.pacedLoss(20, { damage: 4.5, seconds: 15, oneHit: 1 }, 15) * 10) / 10, 5.5);
  assert.equal(Math.round(danger.pacedLoss(20, { damage: 4.5, seconds: 15, oneHit: 1 }, 30, { extended: true }) * 10) / 10, 10, 'held on past its seconds, at its rate, and still half at most');
  // The reflexes give way to the stance held only until then.
  const bot = { health: 2.5, _stance: { choice: 'shield_guard', health: 4.9, at: Date.now(), running: true } };
  assert.ok(danger.stanceHeld(bot));
  bot.health = 2.4;
  assert.ok(!danger.stanceHeld(bot));
  bot._stance.health = 20; bot.health = 14.1;
  assert.ok(danger.stanceHeld(bot), 'at 20, six is still the line');
  bot.health = 14;
  assert.ok(!danger.stanceHeld(bot));
});

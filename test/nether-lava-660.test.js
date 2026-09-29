'use strict';
// Note 660: the Nether's rule of no cell with lava round it (movement.js
// besideLavaRefused, note 516) priced instead of refused, as note 541 did for
// edges. In a basalt delta every cell has lava round it: 25583 (mid-243-cg)
// had one cell to walk on for 174 minutes, and 25589 walked 325 minutes
// never sighting a fortress. Refused now only where a touch of lava is death
// to this body and the lava lies a block to a side, or where something that
// can push the bot is in line with the lava.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { groundBot } = require('./fixtures/saved-ground');
const { Task, surveyRoute } = require('../src/skills');
const { lavaRound, lavaAlongSays, LAVA_SIDE_COST } = require('../src/movement');

const DELTA = require('./fixtures/basalt-delta-mid-243-cg.json');
const SPAN = require('./fixtures/span-end-mid-243-cd.json');
const IRON = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'];

// A bot on the saved ground, the Nether's floor at y 0 (the saved-ground
// bot has none, and the pathfinder's drops look for one).
function onGround(fixture, at, opts) {
  const bot = groundBot(fixture, { dimension: 'the_nether', worn: IRON, ...opts, at });
  bot.game.minY = 0;
  return bot;
}
const deltaBot = opts => onGround(DELTA, new Vec3(-20.7, 101, -18.5), { health: 1.84, ...opts });
const FEET = new Vec3(-21, 101, -19);
const nameOf = bot => (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name;
// Every cell the walk can reach from `from` over the ground as it stands.
function walkable(bot, from, limit = 4000) {
  const m = bot.pathfinder.movements;
  Object.assign(m, { canDig: false, allow1by1towers: false, scafoldingBlocks: [] });
  const seen = new Map([[`${from}`, from]]), queue = [from];
  while (queue.length && seen.size < limit) {
    const n = queue.shift();
    for (const k of m.getNeighbors({ x: n.x, y: n.y, z: n.z, remainingBlocks: 0 })) {
      const c = new Vec3(k.x, k.y, k.z);
      if (!seen.has(`${c}`)) { seen.set(`${c}`, c); queue.push(c); }
    }
  }
  return [...seen.values()];
}

test('25583 in the basalt delta at 1.8 health: the walk no longer has one cell; it takes the cells with lava only corner to corner, none with it a block to a side while a touch is death, and finds the dry ground eight blocks north (note 660)', async () => {
  const bot = deltaBot();
  const cells = walkable(bot, FEET);
  assert(cells.length >= 50, `the walkable set: ${cells.length} cells (it was the one stood on)`);
  const nameAt = nameOf(bot);
  assert(cells.some(c => lavaRound(nameAt, c).cells.length), 'cells with lava round them are walked');
  assert(!cells.some(c => !c.equals(FEET) && lavaRound(nameAt, c).sides), 'none with lava a block to a side: a touch at 1.8 health is death');
  const fresh = deltaBot(), m = fresh.pathfinder.movements;
  const route = await surveyRoute(fresh, new Task('survey'), m, new goals.GoalNear(-22, 98, -27, 1), 3000);
  assert.equal(route.status, 'success');
  assert(route.lava && route.lava.beside >= 1 && route.lava.touching === 0, JSON.stringify(route.lava));
  const says = lavaAlongSays(route.lava, fresh);
  assert.match(says, /^\d+ of its cells (has|have) lava round (it|them) \(at the floor, the feet or the head, a block off\), all of it corner to corner: walked crouched, which stops the body at the edge of its floor but not against a hit; a misstep or a push there is into the lava\. One touch of lava .* a touch is death\.$/);
});

test('25583\'s ground at full health in iron: a touch is not death, so cells with lava a block to a side are walked too, each at its cost (note 660)', () => {
  const bot = deltaBot({ health: 20 });
  const nameAt = nameOf(bot);
  const cells = walkable(bot, FEET);
  assert(cells.length > walkable(deltaBot(), FEET).length, 'more ground than at 1.8 health');
  assert(cells.some(c => lavaRound(nameAt, c).sides), 'a cell with lava a block to a side is walked');
  // The same step priced: the cost of a cell with lava round it over one without.
  const m = bot.pathfinder.movements;
  const from = cells.find(c => m.getNeighbors({ x: c.x, y: c.y, z: c.z, remainingBlocks: 0 }).some(n => lavaRound(nameAt, n).cells.length) &&
    m.getNeighbors({ x: c.x, y: c.y, z: c.z, remainingBlocks: 0 }).some(n => !lavaRound(nameAt, n).cells.length && n.y === c.y && Math.abs(n.x - c.x) + Math.abs(n.z - c.z) === 1));
  const next = m.getNeighbors({ x: from.x, y: from.y, z: from.z, remainingBlocks: 0 }).filter(n => n.y === from.y && Math.abs(n.x - from.x) + Math.abs(n.z - from.z) === 1);
  const dry = next.find(n => !lavaRound(nameAt, n).cells.length), wet = next.find(n => lavaRound(nameAt, n).cells.length);
  if (wet) assert(wet.cost >= dry.cost + LAVA_SIDE_COST, `the cell with lava round it costs more: ${wet.cost} against ${dry.cost}`);
});

test('with a ghast over the delta the lava in line with its push is refused, whatever the health (note 660)', () => {
  const bot = deltaBot({ health: 20, mobs: [{ id: 5, name: 'ghast', at: new Vec3(0, 106, -19), height: 4, width: 4 }] });
  const m = bot.pathfinder.movements, nameAt = nameOf(bot);
  const cells = walkable(bot, FEET);
  for (const c of cells.filter(c => !c.equals(FEET))) {
    // The push comes from the east: no cell walked has lava west of it.
    assert(!lavaRound(nameAt, c).cells.some(([dx]) => dx < 0), `${c} has lava on the far side from the ghast`);
  }
  // Of the ground walked with nothing about, a cell with lava west of it is refused, and one with lava only east, north or
  // south of it is walked at its cost: the push carries the body west (the cells level with the ghast north to south, where
  // its line runs within a few degrees of due west).
  const open = walkable(deltaBot({ health: 20 }), FEET).filter(c => lavaRound(nameAt, c).cells.length && Math.abs(c.z + 18.5) <= 3);
  const west = open.filter(c => lavaRound(nameAt, c).cells.some(([dx]) => dx < 0)), away = open.filter(c => lavaRound(nameAt, c).cells.every(([dx]) => dx >= 0));
  assert(west.length && away.length, `${west.length} with lava west, ${away.length} with none west`);
  for (const c of west) { assert.equal(m.besideLavaRefused(c), 'lava', `${c}`); assert.equal(m._lavaWhy, 'push'); }
  for (const c of away) assert.equal(m.besideLavaRefused(c), null, `${c}`);
});

test('on 25589\'s shore of the lava sea, the lava west and north of the cell: walked with nothing about; refused with a blaze over the sea to the south-west, whose push is toward the lava north of it; walked with one due west, whose push is away from both (note 660)', () => {
  const at = new Vec3(-134, 32, 153);
  const shore = (mobs, health = 20) => onGround(SPAN, new Vec3(-134.5, 32, 154.5), { health, mobs });
  let bot = shore([]);
  assert.deepEqual(lavaRound(nameOf(bot), at), { cells: [[-1, -1, 0], [0, -1, -1], [-1, -1, -1]], sides: 2 });
  assert.equal(bot.pathfinder.movements.besideLavaRefused(at), null);
  bot = shore([{ id: 9, name: 'blaze', at: new Vec3(-141.5, 34, 160.5) }]);
  assert.equal(bot.pathfinder.movements.besideLavaRefused(at), 'lava');
  assert.equal(bot.pathfinder.movements._lavaWhy, 'push');
  bot = shore([{ id: 9, name: 'blaze', at: new Vec3(-141.5, 34, 154.5) }]);
  assert.equal(require('../src/danger').pushersAbout(bot).length, 1, 'the blaze is in sight and can push');
  assert.equal(bot.pathfinder.movements.besideLavaRefused(at), null);
  // The same cell at 1.8 health: the lava a block to a side, and a touch is death.
  bot = shore([], 1.8);
  assert.equal(bot.pathfinder.movements.besideLavaRefused(at), 'lava');
  assert.equal(bot.pathfinder.movements._lavaWhy, 'touch');
});

test('under fire resistance a touch costs nothing: the lava round a cell is walked at 1.8 health (note 660)', () => {
  const bot = onGround(SPAN, new Vec3(-134.5, 32, 154.5), { health: 1.8 });
  const fr = bot.registry.effectsArray.find(e => /fire_?resistance/i.test(e.name));
  bot.entity.effects = { [fr.id]: { id: fr.id, amplifier: 0, duration: 20 * 180, at: Date.now() } };
  assert.equal(require('../src/body').fireResistant(bot), true);
  assert.equal(bot.pathfinder.movements.besideLavaRefused(new Vec3(-134, 32, 153)), null);
});

test('the walk crouches on a cell with lava round it at the feet or the head, not only beside a drop into lava (note 660)', async () => {
  const skills = require('../src/skills');
  const probe = deltaBot({ health: 20 }), nameAt = nameOf(probe);
  // A cell of the delta's ground whose lava is at the feet or the head only: no drop beside it, so the edge crouch did
  // not hold it.
  const cell = walkable(probe, FEET).find(c => { const l = lavaRound(nameAt, c).cells; return l.length && l.every(([, dy]) => dy >= 0); });
  assert(cell, 'such a cell on the delta');
  assert.equal(require('../src/terrain').dropNear(probe, cell, 1), null, 'no drop beside it');
  const bot = onGround(DELTA, cell.offset(0.5, 0, 0.5), { health: 20 });
  bot.entity.onGround = true;
  const sneaks = [];
  bot.setControlState = (k, v) => { if (k === 'sneak') sneaks.push(v); bot.controlState = { ...(bot.controlState || {}), [k]: v }; };
  bot.pathfinder.goto = () => { bot.emit('physicsTick'); return Promise.resolve(); };
  await skills.navigate(bot, new Task('walk'), new goals.GoalNear(cell.x, cell.y, cell.z, 1), { timeoutMs: 2000 });
  assert.equal(sneaks[0], true, `crouched at ${cell}: ${JSON.stringify(sneaks)}`);
});

test('a search that found part of a way and no more ("No path to the goal!") says the lava rule\'s reason, as the empty route does (note 660)', async () => {
  // In a scratch world at 5 health the walk back along a causeway through lava pools was refused with the pathfinder's
  // own "No path to the goal!", the reason lost.
  const skills = require('../src/skills');
  const bot = deltaBot();
  bot.pathfinder.goto = () => {
    Object.assign(bot.pathfinder.movements, { lavaRefusals: 3, lavaRefusedFor: { touch: 3 } });
    return Promise.reject(Object.assign(new Error('No path to the goal!'), { name: 'NoPath' }));
  };
  await assert.rejects(skills.navigate(bot, new Task('walk'), new goals.GoalBlock(-22, 98, -27), { timeoutMs: 2000 }),
    err => err.name === 'NoRoute' && /^No route from here to \(-22, 98, -27\) \(noPath\): the way passes beside lava where a touch of it is death at this health$/.test(err.message));
  // With no cell refused by the rule, the pathfinder's own error is left as it was.
  bot.pathfinder.goto = () => Promise.reject(Object.assign(new Error('No path to the goal!'), { name: 'NoPath' }));
  await assert.rejects(skills.navigate(bot, new Task('walk'), new goals.GoalBlock(-22, 98, -27), { timeoutMs: 2000 }), err => err.name === 'NoPath');
});

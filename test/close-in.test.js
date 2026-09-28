'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task, navigate } = require('../src/skills');
const { Survival } = require('../src/survival');
const { canStrike } = require('../src/combat');

// A walk on open stone, simulated: the pathfinder walks the bot at a
// player's pace toward its goal (the mob itself for a follow, the goal's
// spot otherwise), and the mob walks in at its own pace to a block off.
function closingField({ gap, mobSpeed, walk = 4.3, name = 'wither_skeleton', height = 2.4 }) {
  const mob = { id: 7, name, type: 'hostile', position: new Vec3(0.5 + gap, 64, 0.5), height, width: 0.7, isValid: true };
  const swings = [];
  let pathGoal = null, reachAt = null;
  const start = Date.now();
  const reached = () => { if (reachAt === null && canStrike(bot, mob)) reachAt = Date.now() - start; };
  const bot = Object.assign(new EventEmitter(), { game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, time: { timeOfDay: 18000 },
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0 }, oxygenLevel: 20, health: 20, food: 20,
    entities: { 7: mob }, heldItem: { name: 'iron_sword' }, inventory: { items: () => [{ name: 'iron_sword' }], slots: {} },
    world: { raycast: () => null },
    blockAt: p => { const f = p.floored(); return { name: f.y < 64 ? 'stone' : 'air', position: f, boundingBox: f.y < 64 ? 'block' : 'empty' }; },
    // Sprinting: no critical's jump, so the swing is the plain one at once.
    getControlState: k => k === 'sprint', setControlState() {}, clearControlStates() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {},
    deactivateItem() {}, activateItem() {}, attack: e => reached() || swings.push({ at: Date.now(), gap: e.position.distanceTo(bot.entity.position) }) });
  bot.pathfinder = { movements: { canDig: true, allow1by1towers: true, maxDropDown: 4 },
    setGoal: g => { pathGoal = g; },
    goto: goal => new Promise(resolve => {
      pathGoal = goal;
      const timer = setInterval(() => {
        if (pathGoal !== goal) { clearInterval(timer); resolve(); return; }
        goal.hasChanged?.();
        if (goal.isEnd(bot.entity.position.floored())) { clearInterval(timer); resolve(); return; }
        const there = goal.entity ? goal.entity.position : new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5);
        const way = there.minus(bot.entity.position); way.y = 0;
        bot.entity.position = bot.entity.position.plus(way.scaled(Math.min(1, walk * 0.05 / Math.max(way.norm(), 1e-6))));
        reached();
      }, 50);
    }) };
  const clock = setInterval(() => {
    const way = bot.entity.position.minus(mob.position); way.y = 0;
    if (way.norm() > 1) mob.position.add(way.scaled(Math.min(way.norm() - 1, mobSpeed * 0.05) / way.norm()));
    reached();
  }, 50);
  return { bot, mob, swings, start, stop: () => clearInterval(clock), reachAt: () => reachAt };
}

async function charged(field) {
  const survival = new Survival(field.bot, { navigate });
  survival.report = () => {};
  try { return await survival.charge(new Task('fight'), {}, () => {}, { entity: field.mob, distance: field.mob.position.distanceTo(field.bot.entity.position), visible: true }, false, { chosen: true }); }
  finally { field.stop(); }
}

test('the charge ends and swings as the sword reaches the mob, going after it where it is now (notes 550, 555)', async () => {
  // mid-235-p-nether-4: a wither skeleton seven blocks off; the charge routed
  // to the spot it started from and ended only there or on a stall. It walked
  // four seconds with the skeleton at 0.9 to 1.8 and took three hits first.
  const field = closingField({ gap: 7, mobSpeed: 2.7 });
  assert.equal(await charged(field), true);
  assert(field.reachAt() !== null, 'the sword reached it');
  assert.equal(field.swings.length, 1, 'struck once the charge ended');
  const late = field.swings[0].at - field.start - field.reachAt();
  assert(late <= 250, `the swing came ${late} ms after the sword could reach, not at the spot the mob started from`);
  assert(field.swings[0].gap > 2, `struck at the first reach (${field.swings[0].gap.toFixed(1)} blocks), not walked in onto the mob`);
});

test('a mob that stands still is walked to and struck from the sword\'s reach', async () => {
  const field = closingField({ gap: 7, mobSpeed: 0 });
  assert.equal(await charged(field), true);
  assert.equal(field.swings.length, 1);
  assert(field.swings[0].gap > 2.5, `struck from ${field.swings[0].gap.toFixed(1)} blocks`);
  assert(field.swings[0].at - field.start < 1500, 'about a second of walking for the four blocks to reach');
});

test('a mob that walks away is followed where it goes, not to where it stood', async () => {
  const field = closingField({ gap: 5, mobSpeed: 0 });
  const away = setInterval(() => { field.mob.position.x += 0.12; }, 50);
  try { assert.equal(await charged(field), true); } finally { clearInterval(away); }
  assert.equal(field.swings.length, 1, 'caught and struck');
});

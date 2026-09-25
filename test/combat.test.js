'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { defenseWeapon, strikeTarget, defendNearby, aim, shooter, shotTargets, shoot, raiseShield, lowerShield } = require('../src/combat');

function fixture() {
  const spider = { id: 7, name: 'cave_spider', position: new Vec3(2, 64, 0.5), width: 0.7, height: 0.5, isValid: true };
  const items = [{ name: 'diamond_pickaxe', type: 1 }, { name: 'cobblestone', type: 2 }], attacks = [];
  const bot = { health: 20, oxygenLevel: 20, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 7: spider },
    world: { raycast: () => null }, inventory: { items: () => items }, pathfinder: { setGoal: () => {} },
    clearControlStates: () => {}, lookAt: async () => {},
    equip: async item => { bot.heldItem = item; }, unequip: async () => { bot.heldItem = null; },
    attack: target => attacks.push(target),
  };
  return { bot, spider, items, attacks };
}

test('immediate defense uses a carried tool against a visible hostile in reach without chasing', async () => {
  const { bot, spider, attacks } = fixture(), goal = {};
  assert.equal(defenseWeapon(bot).name, 'diamond_pickaxe');
  assert(await defendNearby(bot, new Task('defend'), goal, () => {}));
  assert.deepEqual(attacks, [spider]); assert.equal(bot.heldItem.name, 'diamond_pickaxe');
  assert.equal(goal.survivalAction.action, 'defend'); assert.equal(goal.survivalAction.target, 'cave_spider');
  assert.equal(bot.entity.position.x, 0.5);
});

test('defense never attacks players, passive animals, covered mobs or targets beyond reach', async () => {
  for (const situation of ['player', 'cow', 'covered', 'distant']) {
    const { bot, spider, attacks } = fixture();
    if (situation === 'covered') { bot.world.raycast = () => ({ intersect: new Vec3(1, 65, 0.5) }); spider.position.x = 2.8; }
    else if (situation === 'distant') spider.position.x = 8;
    else spider.name = situation;
    assert.equal(strikeTarget(bot), undefined);
    assert.equal(await defendNearby(bot, new Task('defend'), {}, () => {}), false);
    assert.equal(attacks.length, 0);
  }
});

test('cooldowns prevent attack spam and leave creeper retreat available', async () => {
  const { bot, spider, attacks } = fixture();
  bot._defenseAttackAt = Date.now();
  assert(await defendNearby(bot, new Task('defend'), {}, () => {}));
  assert.equal(attacks.length, 0);
  spider.name = 'creeper';
  assert.equal(await defendNearby(bot, new Task('defend'), {}, () => {}), false);
});

test('defense rechecks the target after equipping and honors cancellation', async () => {
  const { bot, spider, attacks } = fixture();
  bot.equip = async () => { delete bot.entities[spider.id]; };
  assert.equal(await defendNearby(bot, new Task('defend'), {}, () => {}), false);
  assert.equal(attacks.length, 0);
  const task = new Task('cancelled'); task.cancel();
  await assert.rejects(defendNearby(bot, task, {}, () => {}), { name: 'Cancelled' });
});

test('a mob at arm\'s length on a staircase is struck even when the stair edge hides its head', async () => {
  const { bot, spider, attacks } = fixture();
  spider.position = new Vec3(1.5, 65, 0.5);
  bot.world.raycast = () => ({ intersect: new Vec3(1, 66, 0.5) });
  assert.equal(strikeTarget(bot)?.entity, spider);
  assert(await defendNearby(bot, new Task('defend'), {}, () => {}));
  assert.deepEqual(attacks, [spider]);
});

test('bow aim rises above the straight line with distance and leads a moving target', () => {
  const origin = new Vec3(.5, 65.52, .5);
  const near = aim(origin, new Vec3(10.5, 64.9, .5)), far = aim(origin, new Vec3(20.5, 64.9, .5));
  assert(near.drop > 0 && far.drop > near.drop, 'gravity costs more pitch at twenty blocks than at ten');
  assert(near.lead < 1e-6 && Math.abs(near.yaw - Math.atan2(-10, 0)) < 1e-6, 'a standing target is aimed at straight, with no lead');
  assert(Math.abs(near.distance - Math.hypot(10, .62)) < 1e-6);
  const moving = aim(origin, new Vec3(10.5, 64.9, .5), new Vec3(0, 0, .2));
  assert(Math.abs(moving.lead - .2 * moving.ticks) < 1e-6 && moving.aimPoint.z > .5, 'the aim point sits ahead of a target walking across');
  assert.equal(aim(origin, new Vec3(300, 64, 0)), null, 'out of range is no shot');
});

test('only shooters in clear view at bow range are listed for an arrow, and only with a bow and arrows', () => {
  const registry = require('minecraft-data')('26.1');
  const skeleton = { id: 1, name: 'skeleton', position: new Vec3(10.5, 64, .5), width: .6, height: 1.99, isValid: true };
  const items = [{ name: 'bow', count: 1, durabilityUsed: 0 }, { name: 'arrow', count: 5 }];
  const bot = { registry, entity: { position: new Vec3(.5, 64, .5) }, entities: { 1: skeleton },
    inventory: { items: () => items, slots: {} }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }) };
  const threat = (entity, distance, visible = true) => { bot.entities = { [entity.id]: entity }; return { entity, distance, visible }; };
  assert.deepEqual(shotTargets(bot, [threat(skeleton, 10)]).map(t => t.entity), [skeleton]);
  assert.equal(shotTargets(bot, [threat(skeleton, 3)]).length, 0, 'at three blocks it is the sword\'s');
  assert.equal(shotTargets(bot, [threat(skeleton, 25)]).length, 0, 'too far for a sure arrow');
  assert.equal(shotTargets(bot, [threat(skeleton, 10, false)]).length, 0, 'not in view');
  assert.equal(shotTargets(bot, [threat({ ...skeleton, name: 'zombie' }, 10)]).length, 0, 'a zombie is met with the sword');
  assert.equal(shotTargets(bot, [threat({ ...skeleton, name: 'piglin', heldItem: { name: 'golden_sword' } }, 10)]).length, 0);
  assert.equal(shotTargets(bot, [threat({ ...skeleton, name: 'piglin', heldItem: { name: 'crossbow' } }, 10)]).length, 1, 'a crossbow piglin shoots');
  assert(shooter({ name: 'ghast' }) && shooter({ name: 'blaze' }) && !shooter({ name: 'wither_skeleton' }));
  bot.world.raycast = () => ({ position: new Vec3(5, 65, 0) });
  assert.equal(shotTargets(bot, [threat(skeleton, 10)]).length, 0, 'no clear arc');
  bot.world.raycast = () => null;
  items[1].count = 0; assert.equal(shotTargets(bot, [threat(skeleton, 10)]).length, 0, 'no arrows');
  items[1].count = 5; items[0].durabilityUsed = registry.itemsByName.bow.maxDurability - 3;
  assert.equal(shotTargets(bot, [threat(skeleton, 10)]).length, 0, 'a bow about to break');
});

test('a shot lowers the shield to draw, releases after the draw, then covers behind the shield again', async () => {
  const registry = require('minecraft-data')('26.1');
  const skeleton = { id: 1, name: 'skeleton', position: new Vec3(10.5, 64, .5), width: .6, height: 1.99, isValid: true };
  const arrows = { name: 'arrow', count: 5 }, events = [];
  const bot = Object.assign(new (require('node:events').EventEmitter)(), { registry, health: 20, oxygenLevel: 20, quickBarSlot: 0,
    game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, entity: { position: new Vec3(.5, 64, .5) }, entities: { 1: skeleton },
    inventory: { items: () => [{ name: 'bow', count: 1, durabilityUsed: 0 }, arrows], slots: { 45: { name: 'shield' } } },
    world: { raycast: () => null }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { setGoal() {} }, clearControlStates() {}, equip: async i => { bot.heldItem = i; events.push(`equip ${i.name}`); },
    look: async (yaw, pitch) => { bot.lastSentRotation = { yaw: (Math.PI - yaw) * 180 / Math.PI, pitch: -pitch * 180 / Math.PI }; },
    activateItem: offHand => events.push(offHand ? 'raise shield' : 'draw'),
    deactivateItem: () => { events.push('release'); if (events.includes('draw') && !events.includes('release', events.indexOf('draw'))) return; },
    setQuickBarSlot: () => {},
  });
  bot.deactivateItem = () => {
    const drawing = events.at(-1) === 'draw';
    events.push(drawing ? 'release' : 'lower shield');
    if (drawing) { arrows.count--; bot.emit('entitySpawn', { id: 9, name: 'arrow', position: bot.entity.position.offset(0, 1.52, 0), velocity: new Vec3(3, 0, 0) }); }
  };
  assert(raiseShield(bot)); assert(!raiseShield(bot), 'already up');
  const shot = await shoot(bot, new Task('shot'), skeleton, { threatCheck: () => {}, chargeMs: 0 });
  assert.equal(shot.target, 'skeleton'); assert.equal(arrows.count, 4);
  assert.deepEqual(events, ['raise shield', 'lower shield', 'equip bow', 'draw', 'release', 'raise shield']);
  lowerShield(bot); assert.equal(events.at(-1), 'lower shield'); lowerShield(bot); assert.equal(events.length, 7, 'lowering twice is once');
});

test('a swing jumps for a critical hit when it safely can, and swings plainly under a low roof, beside a drop, or at a creeper', async () => {
  const { strike, critReady } = require('../src/combat');
  const { Vec3 } = require('vec3');
  const ground = p => p.y < 10 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' };
  const make = (blockAt = ground) => {
    const bot = { entity: { position: new Vec3(0.5, 10, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, entities: {}, controlState: {}, attacks: [],
      blockAt, lookAt: async () => {}, attack(t) { this.attacks.push(this.entity.onGround ? 'ground' : 'air'); },
      setControlState(k, v) { this.controlState[k] = v; if (k === 'jump' && v) { setTimeout(() => { this.entity.onGround = false; this.entity.velocity = new Vec3(0, 0.4, 0); }, 20); setTimeout(() => { this.entity.velocity = new Vec3(0, -0.2, 0); }, 60); } } };
    const zombie = { id: 1, name: 'zombie', position: new Vec3(2, 10, 0.5), height: 1.95, width: 0.6, isValid: true };
    bot.entities[1] = zombie; bot.world = { raycast: () => null };
    return { bot, zombie };
  };
  const open = make();
  assert.equal(critReady(open.bot, open.zombie), true);
  assert.equal(await strike(open.bot, new Task('crit'), open.zombie), 'critical');
  assert.deepEqual(open.bot.attacks, ['air'], 'the swing lands on the way down');
  assert(open.bot.entity.velocity.y < 0, 'after the top of the jump, not on the way up');
  const low = make(p => p.y < 10 || p.y === 12 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' });
  assert.equal(critReady(low.bot, low.zombie), false, 'a two-block roof leaves no room for the jump');
  assert.equal(await strike(low.bot, new Task('plain'), low.zombie), 'plain');
  const edge = make(p => (p.y < 10 && p.z >= 0) ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' });
  assert.equal(critReady(edge.bot, edge.zombie), false, 'not with a drop beside it');
  // Trial 114: jumped for a crit on a zombie with a creeper under four blocks off, and was blown up mid-jump.
  const withCreeper = make();
  withCreeper.bot.entities[2] = { id: 2, name: 'creeper', position: new Vec3(-3, 10, 0.5), isValid: true };
  assert.equal(critReady(withCreeper.bot, withCreeper.zombie), false, 'not with a creeper close');
  withCreeper.bot.entities[2].position = new Vec3(-8, 10, 0.5);
  assert.equal(critReady(withCreeper.bot, withCreeper.zombie), true, 'a creeper eight blocks off is not close');
  const c = make(); c.zombie.name = 'creeper';
  assert.equal(critReady(c.bot, c.zombie), false, 'never at a creeper');
});

test('a crit jump that comes down out of reach is not tried again at that mob: the next swings are plain', async () => {
  const { strike } = require('../src/combat');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0.5, 10, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, entities: {}, controlState: {}, attacks: [],
    blockAt: p => p.y < 10 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }, lookAt: async () => {},
    attack() { this.attacks.push('hit'); }, world: { raycast: () => null },
    // The jump lands a step up the stair, out of the zombie's reach.
    setControlState(k, v) { this.controlState[k] = v; if (k === 'jump' && v) { setTimeout(() => { this.entity.onGround = false; this.entity.velocity = new Vec3(0, 0.4, 0); }, 20);
      setTimeout(() => { this.entity.velocity = new Vec3(0, -0.2, 0); this.entity.position = new Vec3(0.5, 14, 0.5); }, 60); setTimeout(() => { this.entity.onGround = true; }, 90); } } };
  const zombie = { id: 7, name: 'zombie', position: new Vec3(2, 10, 0.5), height: 1.95, width: 0.6, isValid: true };
  bot.entities[7] = zombie;
  assert.equal(await strike(bot, new Task('stairs'), zombie), 'missed');
  bot.entity.position = new Vec3(0.5, 10, 0.5);
  assert.equal(await strike(bot, new Task('stairs'), zombie), 'plain', 'no second jump at the same zombie');
  assert.deepEqual(bot.attacks, ['hit']);
});

test('beside a neutral zombified piglin the sword does not sweep: the swing is made with a pickaxe', async () => {
  const { strike } = require('../src/combat');
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const sword = { name: 'diamond_sword', count: 1 }, pickaxe = { name: 'diamond_pickaxe', count: 1 };
  const bot = { registry, entity: { position: new Vec3(0.5, 10, 0.5), onGround: false, velocity: new Vec3(0, 0, 0) }, entities: {}, controlState: {}, attacks: [], heldItem: sword,
    inventory: { items: () => [sword, pickaxe] }, equip: async item => { bot.heldItem = item; },
    blockAt: p => p.y < 10 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }, lookAt: async () => {},
    attack(t) { this.attacks.push(`${this.heldItem.name}>${t.name}`); }, world: { raycast: () => null } };
  const hoglin = { id: 1, name: 'hoglin', position: new Vec3(2, 10, 0.5), height: 1.4, width: 1.4, isValid: true };
  bot.entities[1] = hoglin;
  bot.entities[2] = { id: 2, name: 'zombified_piglin', position: new Vec3(3, 10, 1.5), isValid: true, metadata: {} };
  assert.equal(await strike(bot, new Task('bystander'), hoglin), 'unswept');
  assert.deepEqual(bot.attacks, ['diamond_pickaxe>hoglin']);
  delete bot.entities[2]; bot.heldItem = sword; bot.attacks = [];
  assert.equal(await strike(bot, new Task('alone'), hoglin), 'plain', 'with nobody beside it the sword swings as before');
  assert.deepEqual(bot.attacks, ['diamond_sword>hoglin']);
});

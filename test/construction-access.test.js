'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3'), { goals } = require('mineflayer-pathfinder');
const registry = require('minecraft-data')('26.1');
const { ConstructionGoal, constructionMovement, chooseConstructionWork } = require('../src/construction-access');
const { Task } = require('../src/skills');
function fixture() {
  const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
  const world = new World(() => new Chunk()).sync;
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.setColumn(x, z, new Chunk());
  const set = (p, name) => world.setBlockStateId(p, registry.blocksByName[name].defaultState);
  const bot = { registry, world, blockAt: p => world.getBlock(p), entity: { position: new Vec3(.5, 64, .5) },
    game: { gameMode: 'survival' }, oxygenLevel: 20, pathfinder: { movements: { canDig: true, scafoldingBlocks: [1, 2], exclusionAreasPlace: [] } } };
  return { bot, set };
}
test('earthworks can reach a high bank from below without an adjacent walking cell', () => {
  const { bot, set } = fixture(), p = new Vec3(2, 67, 0);
  for (let y = 63; y <= 67; y++) set(new Vec3(2, y, 0), 'sand');
  const reach = new ConstructionGoal(bot, p, 'dig');
  assert(reach.reachable(bot.entity.position));
  assert(!new goals.GoalGetToBlock(p.x, p.y, p.z).isEnd(bot.entity.position.floored()));
  assert(!reach.reachable(new Vec3(2.5, 68, .5)), 'never dig standing support');
  assert(!reach.reachable(new Vec3(2.5, 69, .5)), 'never undermine the column below standing support');
  set(new Vec3(1, 66, 0), 'stone');
  assert(!reach.reachable(bot.entity.position), 'intervening rock hides the high target');
});
test('placement destination requires a visible anchor, not just proximity', () => {
  const { bot, set } = fixture(), p = new Vec3(3, 65, 0);
  set(p.offset(0, -1, 0), 'stone');
  let reach = new ConstructionGoal(bot, p, 'place');
  assert(reach.reachable(bot.entity.position));
  for (let y = 63; y <= 68; y++) for (let z = -2; z <= 2; z++) set(new Vec3(1, y, z), 'stone');
  assert(!reach.reachable(bot.entity.position));
  assert(new goals.GoalNear(p.x, p.y, p.z, 4).isEnd(bot.entity.position.floored()), 'old proximity goal would stop behind wall');
});
test('access cannot demolish the structure or spend its stone as scaffolding', () => {
  const { bot } = fixture(), m = bot.pathfinder.movements, previous = { ...m };
  const restore = constructionMovement(bot, { blueprint: { blocks: [{ x: 1, y: 64, z: 0 }] } });
  assert.equal(m.canDig, false); assert.deepEqual(m.scafoldingBlocks, [registry.itemsByName.dirt.id, registry.itemsByName.cobblestone.id]);
  bot.inventory = { items: () => [{ name: 'cobblestone', type: registry.itemsByName.cobblestone.id, count: 24 }] };
  assert.equal(m.countScaffoldingItems(), 24);
  assert.equal(m.exclusionAreasPlace[0]({ position: new Vec3(1, 64, 0) }), 100);
  restore(); assert.deepEqual(m, previous);
});
test('an unreachable nearest cut does not prevent selecting a reachable farther one', async () => {
  const { bot, set } = fixture();
  const blocked = new Vec3(2, 69, 0), reachable = new Vec3(4, 64, 0);
  set(blocked, 'sand'); set(reachable, 'sand');
  bot.pathfinder.getPathTo = (_m, goal) => ({ status: goal.pos.equals(blocked) ? 'noPath' : 'success' });
  const result = await chooseConstructionWork(bot, new Task('cuts'), {}, [blocked, reachable].map(position => ({ position, operation: 'dig' })));
  assert(result.position.equals(reachable));
});

test('scaffold cleanup never places new access and spare stone excludes the building reserve', () => {
  const { bot } = fixture();
  bot.inventory = { items: () => [{ name: 'cobblestone', count: 24 }] };
  const goal = { blueprint: { blocks: [{ x: 2, y: 64, z: 0, material: 'cobblestone' }] } };
  let restore = constructionMovement(bot, goal);
  assert.equal(bot.pathfinder.movements.countScaffoldingItems(), 23); restore();
  goal.buildPhase = 'cleanup'; restore = constructionMovement(bot, goal);
  assert.equal(bot.pathfinder.movements.countScaffoldingItems(), 0);
  assert.equal(bot.pathfinder.movements.getScaffoldingItem(), null); restore();
});

test('cleanup walks to a remote scaffold before removing the nearby access back to it', async () => {
  const { bot, set } = fixture(), remote = new Vec3(8, 65, 0), near = new Vec3(2, 65, 0);
  set(remote, 'dirt'); set(near, 'dirt');
  let paths = 0;
  bot.pathfinder.getPathTo = (_m, destination) => { paths++; assert(destination.pos.equals(remote)); return { status: 'success' }; };
  const result = await chooseConstructionWork(bot, new Task('cleanup order'), { buildPhase: 'cleanup' }, [
    { position: near, operation: 'dig', priority: -1 }, { position: remote, operation: 'dig', priority: -2 },
  ]);
  assert(result.position.equals(remote)); assert.equal(paths, 1);
});

test('water construction rises out of a submerged pocket before choosing its next work face', async () => {
  const { bot, set } = fixture();
  bot.entity.position = new Vec3(.5, 64.3, .5);
  set(new Vec3(0, 64, 0), 'water'); set(new Vec3(0, 65, 0), 'water');
  set(new Vec3(2, 64, 0), 'stone');
  const controls = [];
  bot.setControlState = (name, value) => { controls.push([name, value]); if (value) bot.entity.position.y = 65.2; };
  const result = await chooseConstructionWork(bot, new Task('swimming construction'), {}, [{ position: new Vec3(2, 65, 0), operation: 'place' }]);
  assert(result); assert.deepEqual(controls, [['jump', true], ['jump', false]]);
});

test('cancelling a construction swim releases jump immediately', async () => {
  const { bot, set } = fixture(), task = new Task('cancel swim'), controls = [];
  bot.entity.position = new Vec3(.5, 64.3, .5);
  set(new Vec3(0, 64, 0), 'water'); set(new Vec3(0, 65, 0), 'water');
  bot.setControlState = (name, value) => { controls.push([name, value]); if (value) task.cancel(); };
  await assert.rejects(chooseConstructionWork(bot, task, {}, []), { name: 'Cancelled' });
  assert.deepEqual(controls, [['jump', true], ['jump', false]]);
});

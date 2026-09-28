'use strict';
// Note 621: mid-243-af-fortress-5 (25584), 17:54:24Z on 2026-09-28. The bot
// had stood two minutes on a few blocks of its own and the fortress's
// bricks at y 65, thirty-two over the cavern floor, every walk "no route",
// and worked free one move at a time (unstuck_move). A ghast came back into
// sight 47 blocks north at (-187.8, 59.1, -231.4). The question's state
// said "threats: []" (read within sixteen blocks) and no move said the
// push: step_north (0.67) took the bot from (-190, 66, -185), where a push
// from the north stops against what stands south of it, to (-190, 66,
// -186), where it carries the body over the drop; the fireball 1.2 seconds
// later threw it 3.8 blocks south and 32 down. The region is as saved after
// the death (test/fixtures/fortress-ledge-mid-243-af5.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { threats } = require('../src/danger');
const { pushAtSays, blastOverSays } = require('../src/survival');
const { pushFacts, localMoves, liveView } = require('../src/unstuck');
const { groundBot } = require('./fixtures/saved-ground');

const F = require('./fixtures/fortress-ledge-mid-243-af5.json');
const GHAST = { id: 2266, name: 'ghast', at: new Vec3(-187.8, 59.1, -231.4), height: 4, width: 4 };
function ledgeBot(at = new Vec3(-189.5, 66, -184.5)) {
  const bot = groundBot(F, { at, health: 19.2, food: 16, dimension: 'the_nether', worn: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'golden_boots'], held: 'iron_sword',
    items: [['iron_sword', 1], ['wooden_pickaxe', 1], ['gravel', 13], ['nether_brick_fence', 4], ['water_bucket', 1]], mobs: [GHAST] });
  bot.inventory.slots[45] = { name: 'shield' };
  return bot;
}

test('the ghast 47 blocks north is in sight, and its push carries the body over the drop from the cell north but not from where the bot stood (mid-243-af-fortress-5, 17:54:24)', () => {
  const bot = ledgeBot();
  assert.ok(threats(bot, 64).find(t => t.entity.name === 'ghast')?.visible, 'the ghast has a line on the bot');
  assert.equal(pushAtSays(bot, new Vec3(-190, 66, -185)), null, 'where the bot stood, a push from the north does not carry it over');
  assert.match(pushAtSays(bot, new Vec3(-190, 66, -186)) || '', /a fireball from the ghast 47 blocks off that lands there pushes the body over the drop \d blocks? south, a fall of \d+ blocks/);
});

test('each move of the unstuck question says where the ghast\'s push carries the body over from its end, and the shooter past sixteen blocks is in its state (note 621)', () => {
  const bot = ledgeBot();
  const feet = bot.entity.position.floored();
  const { moves } = localMoves(liveView(bot), feet, { goal: 'away', visits: {}, from: null, breathS: 15 });
  const north = moves.find(m => m.key === 'step_north');
  assert.ok(north, `step north is offered: ${moves.map(m => m.key).join(', ')}`);
  const push = pushFacts(bot, feet, moves);
  assert.deepEqual(push.shooters, [{ name: 'ghast', distance: 47, visible: true }]);
  assert.equal(push.here, null, 'no push over the drop from where it stands');
  assert.match(push.moves.get('step_north'), /There a fireball from the ghast 47 blocks off that lands there pushes the body over the drop .* south, .*, where here it does not\./);
});

test('from the cell north, where the push carries it over, it is said here, and a move back out of it says so (note 621)', () => {
  const bot = ledgeBot(new Vec3(-189.5, 66, -185.36));
  const feet = bot.entity.position.floored();
  assert.match(blastOverSays(bot)?.says || '', /here that carries it over the drop 3 blocks south, a fall of \d+ blocks/);
  const { moves } = localMoves(liveView(bot), feet, { goal: 'away', visits: {}, from: null, breathS: 15 });
  const push = pushFacts(bot, feet, moves);
  assert.match(push.here, /The ghast 47 blocks off has the bot in sight/);
  const south = moves.find(m => m.key === 'step_south');
  assert.ok(south, `step south is offered: ${moves.map(m => m.key).join(', ')}`);
  assert.match(push.moves.get('step_south'), /no longer carries the body over the drop it does here/);
});

test('with no ghast in sight, nothing is added', () => {
  const bot = ledgeBot();
  delete bot.entities[GHAST.id];
  const feet = bot.entity.position.floored();
  const { moves } = localMoves(liveView(bot), feet, { goal: 'away', visits: {}, from: null, breathS: 15 });
  const push = pushFacts(bot, feet, moves);
  assert.deepEqual(push, { shooters: [], here: null, moves: new Map() });
});

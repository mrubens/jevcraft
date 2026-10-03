// Note 840: work chosen at turn_priority over survival's answer to the mobs
// about leaves them be for 15 seconds, as keep_working does, and says so.
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const arbiter = require('../src/arbiter');

const fakeBot = () => ({ entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 17, oxygenLevel: 20, entities: {} });
const claim = (layer, action, extra = {}) => ({ layer, action, urgency: layer === 'survival' ? 'pressing' : 'routine', facts: {}, run: async () => true, ...extra });
const skeleton = { entity: { name: 'skeleton', id: 3590, position: new Vec3(15, 64, 5) }, distance: 15.9, visible: true };

test('25595 (21:50:26Z): work chosen over survival with a skeleton 16 off leaves it be 15 seconds, said on the work; survival chosen leaves nothing waved', async () => {
  let tree = null;
  const decide = async (id, o) => { tree = o.tree; return { path: ['work'] }; };
  const bot = fakeBot();
  const out = await arbiter.arbitrate(bot, [claim('work', 'food_near_frame'), claim('survival', 'escape_threat')], { state: {}, decide, mobs: [skeleton] });
  assert.equal(out.winner.layer, 'work');
  assert.deepEqual(bot._wavedOff?.ids, [3590]);
  assert(bot._wavedOff.until - Date.now() > 14000);
  assert.match(tree.work.description.does, /Chosen over survival's answer to the mobs about, they are left be for 15 seconds as the encounter's keep_working leaves them/);
  const bot2 = fakeBot();
  await arbiter.arbitrate(bot2, [claim('work', 'food_near_frame'), claim('survival', 'escape_threat')], { state: {}, decide: async () => ({ path: ['survival'] }), mobs: [skeleton] });
  assert.equal(bot2._wavedOff, undefined);
});

test('the mob the work\'s own check stops on is left be too, where it stands past the ruling\'s six blocks (note 1116)', async () => {
  // 25589 (2026-10-03 21:09:47Z): work answered at 0.58 with a blaze 8 blocks off; the work stopped nine milliseconds on at "Threat nearby: blaze at 8 blocks" and the turn was asked again, 26 askings in a quarter hour.
  const blaze = { id: 77, name: 'blaze', type: 'hostile', position: new Vec3(8, 64, 0), height: 1.8, width: 0.6, isValid: true };
  const bot = { ...fakeBot(), entities: { 77: blaze }, game: { dimension: 'the_nether' }, world: { raycast: () => null }, blockAt: () => ({ name: 'air', boundingBox: 'empty' }), inventory: { items: () => [], slots: [] } };
  const { immediateThreat } = require('../src/danger');
  assert.equal(immediateThreat(bot)?.entity?.id, 77, 'the work\'s check stops on it');
  const out = await arbiter.arbitrate(bot, [claim('work', 'tunnel'), claim('survival', 'escape_threat')], { state: {}, decide: async () => ({ path: ['work'] }), mobs: [] });
  assert.equal(out.winner.layer, 'work');
  assert.deepEqual(bot._wavedOff?.ids, [77]);
  assert.equal(immediateThreat(bot), undefined, 'left be: the work goes on');
});

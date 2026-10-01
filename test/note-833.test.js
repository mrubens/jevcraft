// Note 833: a creeper out of sight at every look for a minute, kept past
// its lighting reach, stands off; in sight once, or within three, it does not.
const test = require('node:test'), assert = require('node:assert/strict');
const H = require('../src/held-off');

function watched(d, { seenAt = null } = {}) {
  const bot = {}, entity = { id: 9, name: 'creeper' }, t0 = Date.now() - 70000;
  for (let t = t0; t <= Date.now(); t += 5000) H.observe(bot, [{ entity, distance: d, visible: seenAt !== null && Math.abs(t - seenAt) < 2500 }], t);
  return { bot, t: { entity, distance: d, visible: false } };
}

test('25584: an unseen creeper 4 blocks off for over a minute stands off; at 2.5, or seen in the minute, it does not', () => {
  let { bot, t } = watched(4);
  assert(H.stoodOff(bot, t), 'unseen at 4 for the minute: stands off');
  ({ bot, t } = watched(2.5));
  assert.equal(H.stoodOff(bot, t), null, 'within its lighting reach');
  ({ bot, t } = watched(4, { seenAt: Date.now() - 30000 }));
  assert.equal(H.stoodOff(bot, t), null, 'in sight within the minute');
  ({ bot, t } = watched(4));
  assert.equal(H.stoodOff(bot, { ...t, visible: true }), null, 'in sight now');
});

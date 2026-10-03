// Note 1124: a walker coming at the bot now does not stand off, however the minute behind it reads.
// 25594 (2026-10-03 22:07:56Z): a wither skeleton 5.9 blocks off and walking at it was said to have "stood off 136 seconds ... not a threat that stops the work".
const test = require('node:test'), assert = require('node:assert/strict');
const H = require('../src/held-off');

function watched(distances) {
  const bot = {}, entity = { id: 9, name: 'wither_skeleton' }, t0 = Date.now() - (distances.length - 1) * 5000;
  distances.forEach((d, i) => H.observe(bot, [{ entity, distance: d, visible: true }], t0 + i * 5000));
  return { bot, entity };
}

test('a wither skeleton that wandered 6 to 33 blocks off for two minutes stands off while it keeps away, and not while it is closing on the bot (note 1124)', () => {
  // Kept at sixteen blocks for the whole last minute and more (the window's first look is not left to the millisecond).
  const far = [6.4, 9, 14, 20, 27, 33, 30, 26, 22, 18, ...Array(16).fill(16)];
  const { bot, entity } = watched(far);
  assert(H.stoodOff(bot, { entity, distance: 16, visible: true }), 'keeping off: it stands off');
  // Coming: a block a second or more, within twelve blocks.
  assert.equal(H.stoodOff(bot, { entity, distance: 5.9, visible: true, approach: 3.9 }), null, 'closing at its walk');
  // Or nearer by two blocks than at the last look, the speed not known.
  const near = watched([6.4, 9, 14, 20, 27, 33, 30, 26, 22, 18, ...Array(15).fill(16), 8.5]);
  assert.equal(H.stoodOff(near.bot, { entity: near.entity, distance: 5.9, visible: true }), null, 'two blocks nearer than at the last look');
});

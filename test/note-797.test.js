'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { siteHoldEnds } = require('../src/work');

// 25585 (mid-227-ag, 2026-10-01 10:41-10:47Z): "here deep" held through 546
// failures of one slot's "Nowhere to stand to pour", three a second.
const WHY = 'Nowhere to stand to pour into the frame slot at (-191, 42, -698): the stand made for it at (-192, 42, -699) could not be walked to';
const frameAt = () => ({ origin: { x: -193, y: 41, z: -698 }, siteFailed: { cast: 4, n: 2, whys: { [WHY]: 2 }, slot: { x: -191, y: 42, z: -698 }, kind: 'Nowhere to stand to pour' } });
const botAt = (x, y, z) => ({ entity: { position: new Vec3(x, y, z) } });

test('an answer kept at the frame\'s failure ends when it fails the same way three times with the bot where it was (note 797)', () => {
  const frame = frameAt(), bot = botAt(-190.5, 42, -700.5);
  const answered = { cast: 4, kind: 'Nowhere to stand to pour', at: Date.now(), pick: 'here_deep' };
  assert.equal(siteHoldEnds(bot, frame, answered, 4, WHY), null);
  assert.equal(siteHoldEnds(bot, frame, answered, 4, WHY), null);
  const ends = siteHoldEnds(bot, frame, answered, 4, WHY);
  assert.match(ends, /^the answer kept failed the same way 3 times at the frame slot \(-191, 42, -698\) with the bot where it was, nothing changed/);
});

test('the count starts again when the bot moves, the failure differs, or the slot differs', () => {
  const frame = frameAt();
  const answered = { cast: 4, kind: 'Nowhere to stand to pour', at: Date.now(), pick: 'here_deep' };
  assert.equal(siteHoldEnds(botAt(-190.5, 42, -700.5), frame, answered, 4, WHY), null);
  assert.equal(siteHoldEnds(botAt(-190.5, 42, -700.5), frame, answered, 4, WHY), null);
  // Moved three blocks: tried from somewhere new.
  assert.equal(siteHoldEnds(botAt(-187.5, 42, -700.5), frame, answered, 4, WHY), null);
  assert.equal(answered.same.n, 1);
  assert.equal(siteHoldEnds(botAt(-187.5, 42, -700.5), frame, answered, 4, `${WHY} again`), null);
  assert.equal(answered.same.n, 1);
});

test('the earlier ends hold: a block in, a failure of another kind, and three minutes', () => {
  const bot = botAt(-190.5, 42, -700.5);
  assert.match(siteHoldEnds(bot, frameAt(), { cast: 3, kind: 'Nowhere to stand to pour', at: Date.now() }, 4, WHY), /^a block went in since \(4 of ten cast, from 3\)/);
  assert.match(siteHoldEnds(bot, frameAt(), { cast: 4, kind: 'No stand reached', at: Date.now() }, 4, WHY), /^a failure of another kind came/);
  assert.match(siteHoldEnds(bot, frameAt(), { cast: 4, kind: 'Nowhere to stand to pour', at: Date.now() - 4 * 60000 }, 4, WHY), /^its 3 minutes at the frame's failures passed/);
});

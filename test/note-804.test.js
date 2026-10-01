'use strict';
// Trial note 804: turn_priority's work and hunt say what each does in a
// pursuit: the stalk walks up and watches, the hunt strikes; and the pearls
// wanted are the run's, not the step's one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimSays } = require('../src/arbiter');

test('the stalk says it strikes nothing; the hunt of the same kind says it is the work\'s strike (note 804)', () => {
  const work = claimSays({ layer: 'work', action: 'stalk_mob', facts: { doing: 'stalk mob', request: 'beat the game' } });
  assert.match(work, /^Go on with the work: stalk mob \(toward "beat the game"\): it walks up to the mob it is after and watches it, digs toward it or opens a way to it; it strikes nothing itself, the hunt does\./);
  const hunt = claimSays({ layer: 'hunt', action: 'hunt', facts: { entity: 'enderman', distance: 6.1, item: 'ender_pearl', have: 0, want: 13, health: 20, ownPursuit: 'stalk_mob' } });
  assert.match(hunt, /^The work in hand is this pursuit: its stalk mob walks up to the enderman and watches, and strikes only through this hunt\. Hunt /);
  assert.match(hunt, /\(0 of 13 carried\)/);
  // Other work: as before.
  assert.match(claimSays({ layer: 'work', action: 'mine', facts: { doing: 'mine' } }), /^Go on with the work: mine\.$/);
});

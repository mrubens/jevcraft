'use strict';
// Note 1080: the stance build's profile switch: off, the build runs as it
// is; a profile's heaviest functions are those of this code, by inclusive time.
const test = require('node:test');
const assert = require('node:assert/strict');
const sp = require('../src/stance-profile');

test('with no flag file the build is called once and its result returned, nothing said', () => {
  if (sp.enabled()) return; // a live checkout with the switch on
  const said = [];
  assert.equal(sp.around(() => 42, l => said.push(l)), 42);
  assert.deepEqual(said, []);
});

test('the heaviest functions of a profile: inclusive time, this code only, a function counted once a stack', () => {
  const frame = (functionName, url) => ({ functionName, url, lineNumber: 1 });
  const profile = { nodes: [
    { id: 1, callFrame: frame('(root)', ''), children: [2] },
    { id: 2, callFrame: frame('blazeStands', 'file:///x/src/blaze-stand.js'), children: [3, 4] },
    { id: 3, callFrame: frame('holeSite', 'file:///x/src/blaze-stand.js'), children: [5] },
    { id: 4, callFrame: frame('standCost', 'file:///x/src/blaze-stand.js') },
    { id: 5, callFrame: frame('blockAt', 'file:///x/node_modules/mineflayer/lib/blocks.js') },
  ], samples: [5, 5, 3, 4], timeDeltas: [100000, 100000, 50000, 20000] };
  assert.deepEqual(sp.heaviest(profile), ['blazeStands blaze-stand.js 270 ms', 'holeSite blaze-stand.js 250 ms', 'standCost blaze-stand.js 20 ms']);
});

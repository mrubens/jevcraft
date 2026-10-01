// Note 832: a trip back for food chosen in the Nether is counted on arrival
// though the ladder's return_overworld took the step's place on the way,
// and the Nether first that would undo it says so.
const test = require('node:test'), assert = require('node:assert/strict');
const { noteFoodTrip } = require('../src/game-progress');
const { cameOutSays } = require('../src/strategy');

const bot = dim => ({ game: { dimension: dim }, inventory: { items: () => [] }, registry: require('minecraft-data')('26.1') });

test('25597: the food trip chosen in the Nether is the food trip on arrival, the step having become return_overworld; nether_first says it', () => {
  const goal = { step: { action: 'return_overworld' }, foodTripChosen: Date.now() - 6000 };
  noteFoodTrip(bot('the_nether'), goal);
  assert.equal(goal.foodTrip, undefined, 'not yet: still in the Nether');
  noteFoodTrip(bot('overworld'), goal);
  assert(goal.foodTrip?.at, 'counted on arrival');
  assert.equal(goal.foodTripChosen, undefined);
  assert.match(cameOutSays(bot('overworld'), goal), /The bot came out of the Nether \d+ seconds ago for food \(going back through the portal for it was chosen there\) and carries 0 food points now: going in now leaves that trip/);
  assert.equal(cameOutSays(bot('overworld'), {}), '');
});

// Note 828: a creeper out of sight lights only once it sees the bot; the
// retreat's scout is cut short for one in sight within seven or any within
// its lighting reach, not for 25595's, four below and unseen at 4.2.
const test = require('node:test'), assert = require('node:assert/strict');
const { scoutBudget, SCOUT_MS, SCOUT_FAR_MS } = require('../src/survival');
const t = (name, distance, visible = true) => ({ entity: { name }, distance, visible });

test('25595: an unseen creeper at 4.2 leaves the scout its long search; in sight at 6 or unseen at 2.5 it is cut short', () => {
  assert.equal(scoutBudget([t('creeper', 4.2, false)]), SCOUT_FAR_MS);
  assert.equal(scoutBudget([t('creeper', 6, true)]), SCOUT_MS);
  assert.equal(scoutBudget([t('creeper', 2.5, false)]), SCOUT_MS);
});

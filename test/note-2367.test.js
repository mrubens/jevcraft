// note 2367: a pass of the turns that never ends quits for the supervisor.
const test = require('node:test');
const assert = require('node:assert');
const { watchStuck, STUCK_MS } = require('../src/quiet-restart');

const run = async (bot, opts) => { let quit = false; const stop = watchStuck(bot, { every: 5, exit: () => { quit = true; }, watched: () => true, ...opts }); await new Promise(r => setTimeout(r, 600)); stop(); return quit; };

test('no pass ended in ten minutes, supervised, in the Overworld: the bot quits', async () => {
  const t0 = Date.now();
  const bot = { entity: {}, game: { dimension: 'overworld' }, _arbiterShadow: { at: t0 - STUCK_MS - 1000, gave: 'work' }, quit() {} };
  assert.equal(await run(bot, { startedAt: t0 - STUCK_MS - 2000 }), true);
});

test('a pass ended a moment ago, or the End, or no supervisor: it stays', async () => {
  const t0 = Date.now();
  assert.equal(await run({ entity: {}, game: { dimension: 'overworld' }, _arbiterShadow: { at: t0 }, quit() {} }, { startedAt: t0 - STUCK_MS - 2000 }), false);
  assert.equal(await run({ entity: {}, game: { dimension: 'the_end' }, _arbiterShadow: { at: t0 - STUCK_MS - 1000 }, quit() {} }, { startedAt: 0 }), false);
  assert.equal(await run({ entity: {}, game: { dimension: 'overworld' }, _arbiterShadow: { at: 0 }, quit() {} }, { startedAt: 0, watched: () => false }), false);
});

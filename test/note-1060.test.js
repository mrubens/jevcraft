'use strict';
// Note 1060: a thing made is something gained though what it was made of is
// gone: mining and crafting in turn with a new tool in the pockets is not
// two steps trading the turn.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const stillness = require('../src/stillness');

function watchedBot(at, pockets) {
  const bot = new EventEmitter();
  Object.assign(bot, { entity: { position: at.clone() }, inventory: { items: () => Object.entries(pockets).map(([name, count]) => ({ name, count })) }, game: { gameMode: 'survival', dimension: 'overworld' }, placeBlock: async () => {} });
  stillness.watchStalls(bot, () => null);
  return { bot, stop: () => stillness.unwatchStalls(bot) };
}
function flips(bot, goal, steps, between) {
  let t = 5_000_000, raised = null;
  for (const [i, step] of steps.entries()) { t += 7000; goal.step = step; between(i); raised = stillness.flipWatch(bot, goal, t) || raised; }
  return raised;
}
const mine = { action: 'mine', block: 'stone', drops: 'cobblestone', count: 3 }, craft = item => ({ action: 'craft', item, count: 1 });

test('25593 back to life: cobblestone mined, a stone pickaxe and a stone sword made of it and of the sticks, is not a flip', () => {
  // Its pockets as the flight record has them: 18 things that are not
  // filler at 13:36:41 and 18 at 13:37:14, the two oak planks gone to sticks.
  const pockets = { stick: 2, oak_log: 3, oak_planks: 2, wooden_pickaxe: 1 };
  const { bot, stop } = watchedBot(new Vec3(115.3, 60, 138.5), pockets);
  try {
    const goal = { kind: 'win', rungTime: { phase: 'iron_pickaxe' } };
    // Each look is at a step's beginning: the pickaxe is made inside the
    // mine's own step (a better tool for it), the sticks and the sword in
    // the crafts, each after its look.
    const raised = flips(bot, goal, [mine, craft('stick'), mine, craft('stone_sword'), mine], i => {
      if (i === 1) { pockets.stone_pickaxe = 1; pockets.stick = 0; }
      if (i === 2) { pockets.stick = 4; pockets.oak_planks = 0; }
      if (i === 4) { pockets.stone_sword = 1; pockets.stick = 3; }
    });
    assert.equal(raised, null, raised?.why);
  } finally { stop(); }
});

test('the same names with nothing made are the flip they were', () => {
  const pockets = { oak_log: 3, wooden_pickaxe: 1 };
  const { bot, stop } = watchedBot(new Vec3(115.3, 60, 138.5), pockets);
  try {
    const raised = flips(bot, { kind: 'win', rungTime: { phase: 'iron_pickaxe' } }, [mine, craft('stone_sword'), mine, craft('stone_sword'), mine], () => {});
    assert.match(raised?.why || '', /^turning between mine and craft 4 times/);
  } finally { stop(); }
});

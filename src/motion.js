'use strict';
// The one way to move the bot by holding keys instead of routing. Every
// fall on the live run came from code that did it by hand: the portal walk
// held forward for eight seconds through the portal and off its platform,
// the bridge stood upright at the end of its span, the step into a hole
// walked on when it missed, the walk to a drop went over a roof edge. Each
// needed its own edge rule and each missed a case. Here the rules are kept
// once:
//
//   - crouched by default: a sneaking player cannot walk off an edge. Not
//     crouching needs a reason, which is kept with the move.
//   - a stop condition, checked every tick, and a hard cap of five seconds.
//   - every key given back as it was, whatever happens.
//   - the move is named on the bot while it lasts, so the flight recorder
//     can say who was holding the keys.
//
// A test fails on any movement key held anywhere else.
const MOVEMENT = new Set(['forward', 'back', 'left', 'right', 'jump', 'sprint']);
const HORIZONTAL = new Set(['forward', 'back', 'left', 'right']);
const MAX_MS = 5000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function move(bot, task, { label, keys = ['forward'], sneak = true, why, look, until = () => false, guard = () => {}, maxMs = 1500, tick = 25 } = {}) {
  if (!label) throw new Error('A held-key move needs a name');
  for (const key of keys) if (!MOVEMENT.has(key)) throw new Error(`Not a movement key: ${key}`);
  if (!sneak && keys.some(key => HORIZONTAL.has(key)) && !why) throw new Error(`${label}: walking upright needs a reason`);
  const limit = Math.min(maxMs, MAX_MS);
  // Always yield once: a move whose goal is already met returns before its
  // first tick, and a loop of those never lets the connection's keepalive
  // through (the arena server timed the bot out mid-drill).
  await new Promise(resolve => setImmediate(resolve));
  if (look) await bot.lookAt(look, true);
  task.check();
  const touched = [...new Set([...keys, ...(sneak ? ['sneak'] : [])])];
  const held = key => !!(bot.getControlState ? bot.getControlState(key) : bot.controlState?.[key]);
  const previous = Object.fromEntries(touched.map(key => [key, held(key)]));
  const controller = { name: label, keys: [...keys], sneak, why, since: Date.now() };
  bot._controller = controller;
  try {
    if (sneak) bot.setControlState('sneak', true);
    for (const key of keys) bot.setControlState(key, true);
    const started = Date.now();
    while (Date.now() - started < limit) {
      task.check(); guard();
      if (until()) return true;
      await sleep(tick);
    }
    return !!until();
  } finally {
    for (const key of touched) bot.setControlState(key, previous[key]);
    if (bot._controller === controller) bot._controller = null;
  }
}

module.exports = { move, MOVEMENT, MAX_MS };

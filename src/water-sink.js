'use strict';
// The game's own rule for the sneak key in water (LivingEntity.goDownInWater,
// called each tick the key is held in water: 0.04 a tick downward), which the
// body's physics here do not carry (note 1070). With no key a body in water
// sinks 0.025 a tick, half a block a second; with the sneak key about 3.7 a
// second. 25584 (2026-10-03 14:53:07 to 14:53:41Z) rode a waterfall of 27
// blocks with its head under at half a block a second, and the swim to air
// it chose at air 0, its way to air four blocks further down, held the sneak
// key for the sinking and sank on at the same half block: drowned from 20
// health a block over the ground.
const SNEAK_SINK = 0.04, SINK_PACE = 3.7;

function install(bot) {
  if (!bot || bot._sinkWatch || typeof bot.on !== 'function') return;
  bot._sinkWatch = true;
  bot.on('physicsTick', () => {
    const e = bot.entity;
    if (e?.isInWater && e.velocity && !e.onGround && bot.controlState?.sneak && !bot.controlState?.jump) e.velocity.y -= SNEAK_SINK;
  });
}

module.exports = { install, SNEAK_SINK, SINK_PACE };

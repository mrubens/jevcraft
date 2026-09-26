'use strict';
// A rider is where its mount is. The server moves a mount and not what
// rides it, and mineflayer keeps the rider where it mounted: in
// first-days-213 a husk on a camel husk lanced the bot from two blocks, 16.3
// health to 7.5, while every layer had it fourteen blocks off, and the bot
// died four times in two minutes (2026-09-26). The rider is kept at its
// mount, seated about three quarters of the mount's height up.
const { Vec3 } = require('vec3');

function seat(vehicle) {
  return vehicle.position.offset(0, (vehicle.height || 1) * 0.75, 0);
}

let botEntity = null;
function placeRiders(vehicle) {
  for (const rider of vehicle?.passengers || []) {
    if (!rider?.position || rider.vehicle !== vehicle || rider === botEntity) continue;
    const at = seat(vehicle);
    rider.position = rider.position instanceof Vec3 ? rider.position.set(at.x, at.y, at.z) : at;
    placeRiders(rider);
  }
}

function ridersPlugin(bot) {
  bot.on('entityMoved', placeRiders);
  bot.on('entityAttach', (rider, vehicle) => { if (vehicle) placeRiders(vehicle); });
  // Mounted by set_passengers, the modern packet, with no event of its own:
  // after mineflayer's handler has linked them.
  bot._client?.on?.('set_passengers', ({ entityId }) => setImmediate(() => placeRiders(bot.entities?.[entityId])));
  bot.once?.('spawn', () => { botEntity = bot.entity; });
}

module.exports = { ridersPlugin, placeRiders, seat };

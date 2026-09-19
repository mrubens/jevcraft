'use strict';
const installed = Symbol('observed furnace properties');

function installFurnaceProperties(bot) {
  if (typeof bot.openFurnace !== 'function' || bot.openFurnace[installed]) return;
  const original = bot.openFurnace;
  bot.openFurnace = async function (...args) {
    const readings = new Map();
    let furnace, closed = false;
    const observe = packet => {
      if (furnace && packet.windowId !== furnace.id) return;
      if (![0, 1, 2, 3].includes(packet.property) || !Number.isInteger(packet.value) || packet.value < 0) return;
      if (!readings.has(packet.windowId)) readings.set(packet.windowId, {});
      readings.get(packet.windowId)[packet.property] = packet.value;
    };
    const apply = () => {
      const values = readings.get(furnace.id) || {};
      if (values[1] !== undefined) { furnace.totalFuel = values[1]; furnace.totalFuelSeconds = values[1] / 20; }
      if (values[0] !== undefined) {
        furnace.fuelSeconds = values[0] / 20;
        furnace.fuel = values[1] > 0 ? values[0] / values[1] : values[0] === 0 ? 0 : null;
      }
      if (values[3] !== undefined) { furnace.totalProgress = values[3]; furnace.totalProgressSeconds = values[3] / 20; }
      if (values[2] !== undefined) {
        furnace.progress = values[3] > 0 ? values[2] / values[3] : values[2] === 0 ? 0 : null;
        furnace.progressSeconds = values[3] === undefined ? null : Math.max(0, values[3] - values[2]) / 20;
      }
    };
    const cleanup = () => {
      closed = true;
      bot._client.removeListener('craft_progress_bar', observe);
      bot.removeListener('end', cleanup);
      furnace?.removeListener('update', apply);
      furnace?.removeListener('close', cleanup);
      readings.clear();
    };
    // Mineflayer subscribes after awaiting openBlock. Properties sent in the
    // same socket read as windowOpen can precede that continuation, permanently
    // losing the initial totalFuel and making a burning furnace look empty.
    bot._client.on('craft_progress_bar', observe);
    bot.once('end', cleanup);
    try {
      furnace = await original.apply(this, args);
      if (closed) {
        furnace.emit('close'); // Release upstream listeners without sending a packet after disconnect.
        throw new Error('Disconnected while opening the furnace');
      }
      // The observer runs before the upstream property handler; its update
      // event runs afterward. Reconcile before application update listeners,
      // including when remaining ticks precede the total-duration packet.
      furnace.on('update', apply);
      furnace.once('close', cleanup);
      apply();
      return furnace;
    } catch (error) { cleanup(); throw error; }
  };
  bot.openFurnace[installed] = true;
}

module.exports = { installFurnaceProperties };

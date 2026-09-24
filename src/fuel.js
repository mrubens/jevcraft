'use strict';
// Vanilla FuelValues: a plank burns for 300 ticks and a normal smelt takes 200.
// Plank membership is extracted from the server's planks/non_flammable_wood
// tags. Coal is the fuel a miner already carries: one lump smelts eight items,
// so a furnace fed with it never sends the bot back up for wood mid-dig.
const fuelPlanks = Object.freeze(require('../data/vanilla-26.1.json').fuelPlanks);
const SMELT_TICKS = 200;
// Leaf litter burns a hundred ticks, half an item: measured on the arena
// server (2026-09-24). Carried by the stack from every forest floor, it is
// fuel that costs nothing (the user's idea).
const BURN_TICKS = Object.freeze({ coal: 1600, charcoal: 1600, coal_block: 16000, blaze_rod: 2400, dried_kelp_block: 4000, leaf_litter: 100 });
const ITEMS_PER_PLANK = 300 / SMELT_TICKS;
// Preferred over planks whenever enough is carried, best value first.
// Not blaze rods: they burn well, and they are the eyes of ender.
const CARRIED_FUELS = Object.freeze(['coal', 'charcoal', 'coal_block', 'dried_kelp_block', 'leaf_litter']);
const isFuel = name => fuelPlanks.includes(name) || name in BURN_TICKS;
const itemsPerFuel = name => (fuelPlanks.includes(name) ? 300 : BURN_TICKS[name] || 0) / SMELT_TICKS;
const fuelUnits = (name, items) => Math.ceil(items / itemsPerFuel(name));
module.exports = { fuelPlanks, ITEMS_PER_PLANK, BURN_TICKS, CARRIED_FUELS, isFuel, itemsPerFuel, fuelUnits };

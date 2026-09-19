'use strict';
// Vanilla FuelValues: a plank burns for 300 ticks and a normal smelt takes 200.
// Membership is extracted from the server's planks/non_flammable_wood tags.
const fuelPlanks = Object.freeze(require('../data/vanilla-26.1.json').fuelPlanks);
const ITEMS_PER_PLANK = 300 / 200;
module.exports = { fuelPlanks, ITEMS_PER_PLANK };

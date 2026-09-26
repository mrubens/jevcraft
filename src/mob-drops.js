'use strict';
// What each hostile mob drops and what that is for, from the game's loot
// tables: said with a choice to go out and hunt them. Every kill also gives
// experience. Asked only "stay or mine", Jev could not weigh a night of
// spiders against a bed with no sheep in five hundred blocks.
const BONES = { items: ['bone', 'arrow', 'bow'], drops: 'up to two bones and two arrows, now and then its bow', for: 'bone meal grows the wheat at once and bones tame wolves; arrows and a bow are the bow step' };
const FLESH = { items: ['rotten_flesh', 'iron_ingot', 'carrot', 'potato'], drops: 'rotten flesh, rarely an iron ingot, a carrot or a potato', for: 'rotten flesh is food in a pinch that may bring on hunger' };
const STRING = { items: ['string', 'spider_eye'], drops: 'up to two string, now and then a spider eye', for: 'four string craft a white wool (three wool a bed), and string makes bows' };
const MOB_DROPS = {
  spider: STRING, cave_spider: STRING,
  skeleton: BONES, stray: BONES, bogged: BONES, parched: BONES,
  zombie: FLESH, husk: FLESH, zombie_villager: FLESH,
  drowned: { items: ['rotten_flesh', 'copper_ingot', 'trident'], drops: 'rotten flesh, now and then a copper ingot', for: 'rotten flesh is food in a pinch that may bring on hunger' },
  creeper: { items: ['gunpowder'], drops: 'up to two gunpowder', for: 'TNT and fireworks; no step on the ladder needs it' },
  enderman: { items: ['ender_pearl'], drops: 'an ender pearl half the time', for: 'pearls and blaze powder make the eyes of ender that find and open the stronghold' },
  witch: { items: ['redstone', 'glowstone_dust', 'stick', 'sugar', 'glass_bottle', 'gunpowder', 'spider_eye'], drops: 'redstone, glowstone, sticks, sugar and bottles', for: 'potions and redstone later; nothing early' },
  // The Nether's meat: the food there is (nether-travel.js). Raw porkchop is
  // safe to eat.
  hoglin: { items: ['porkchop', 'leather'], drops: 'two to four raw porkchops, now and then leather', for: 'food: raw porkchop is safe to eat, three hunger each, and in the Nether little else is' },
  slime: { items: ['slime_ball'], drops: 'slimeballs from the small ones', for: 'leads and sticky pistons' },
};

module.exports = { MOB_DROPS };

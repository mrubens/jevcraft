'use strict';
// A step of the plan as it is said in chat (note 911). The plan's own names
// ("the ladder", "the obtain blaze rods", "the bank rods", "the reach
// nether") are the code's and read as nothing to someone watching: the
// user, watching 25592 on 2026-10-02, "Jev talks about 'the ladder' and I
// don't know if that will make sense to people". -> a noun phrase with its
// article ("the hunt for blaze rods"); an item's name as "the iron pickaxe".
const SPOKEN = {
  bank_rods: 'the trip to bank my blaze rods', obtain_blaze_rods: 'the hunt for blaze rods', obtain_ender_pearls: 'the hunt for ender pearls',
  reach_nether: 'the way to the Nether', nether_food: 'the food for the Nether', nether_blocks: 'the blocks for the Nether', nether_pickaxe: 'the pickaxe for the Nether',
  find_stronghold: 'the search for the stronghold', enter_end: 'the way into the End', defeat_dragon: 'the dragon fight', restock_supplies: 'the trip home for supplies',
  iron_armour: 'the iron armour', home_site: 'a place for a home', home_stash: 'the chest at home', work_in_hand: 'this', rods_waiting: 'the wait for more blazes',
};
const spoken = name => { const k = String(name || '').trim().replaceAll(' ', '_'); return SPOKEN[k] || `the ${k.replaceAll('_', ' ')}`; };
const Spoken = name => { const s = spoken(name); return s[0].toUpperCase() + s.slice(1); };
module.exports = { spoken, Spoken, SPOKEN };

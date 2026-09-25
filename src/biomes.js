'use strict';
// What each Overworld biome holds, from the game's generation and spawn
// tables: the ground, the trees, the animals that spawn there and the
// structures found there. Said with every biome Jev is shown, underfoot or
// nearby, so a choice of where to go is made knowing what is there. Asked
// with the names alone, Jev sent a bot looking for sheep out to sea.
const FARM = 'sheep, cows, pigs and chickens spawn';
const OCEAN = 'open water; squid, cod and dolphins; no land animals; shipwrecks and ocean ruins';
const BIOME_FACTS = {
  plains: `grass, few trees; ${FARM}, and horses and donkeys; villages`,
  sunflower_plains: `grass and sunflowers, few trees; ${FARM}, and horses and donkeys`,
  meadow: 'grass and flowers on a mountainside, few trees; sheep, rabbits and donkeys spawn; villages',
  forest: `oak and birch trees; ${FARM}, and wolves`,
  flower_forest: `oak and birch trees, flowers; ${FARM}, and rabbits`,
  birch_forest: `birch trees; ${FARM}`,
  old_growth_birch_forest: `tall birch trees; ${FARM}`,
  dark_forest: `dark oak trees and giant mushrooms, dark under the canopy so monsters spawn by day; ${FARM}; woodland mansions`,
  pale_garden: 'pale oak trees, dark, creakings at night; no animals spawn',
  taiga: `spruce trees, sweet berries; ${FARM}, and wolves, rabbits and foxes; villages`,
  old_growth_pine_taiga: `tall spruce, podzol and mossy boulders, sweet berries; ${FARM}, and wolves, rabbits and foxes`,
  old_growth_spruce_taiga: `tall spruce, podzol and mossy boulders, sweet berries; ${FARM}, and wolves, rabbits and foxes`,
  snowy_taiga: `spruce trees under snow; ${FARM}, and wolves, rabbits and foxes; villages`,
  snowy_plains: 'snow, few trees; rabbits and polar bears spawn, strays among the skeletons; villages and igloos',
  ice_spikes: 'packed ice spikes and snow, no trees; rabbits and polar bears spawn',
  grove: 'spruce on snowy slopes, powder snow; wolves, rabbits and foxes spawn',
  snowy_slopes: 'snow, ice and powder snow on a mountainside, no trees; goats and rabbits spawn',
  jagged_peaks: 'snow and stone peaks, no trees; goats spawn',
  frozen_peaks: 'ice and snow peaks, no trees; goats spawn',
  stony_peaks: 'bare stone peaks, no trees; nothing spawns',
  cherry_grove: 'cherry trees on a mountainside; sheep, pigs and rabbits spawn',
  windswept_hills: `stone hills, emerald ore, a few oak and spruce; ${FARM}, and llamas`,
  windswept_gravelly_hills: `gravel and stone hills, emerald ore; ${FARM}, and llamas`,
  windswept_forest: `stone hills under oak and spruce, emerald ore; ${FARM}, and llamas`,
  swamp: `shallow water, oaks with vines, clay and lily pads; ${FARM}, and frogs; slimes at night; witch huts`,
  mangrove_swamp: 'mangroves and mud in shallow water; frogs spawn, no farm animals',
  jungle: `jungle trees, melons, cocoa; ${FARM}, and parrots and ocelots; jungle temples`,
  sparse_jungle: `scattered jungle trees, melons; ${FARM}, and parrots and ocelots`,
  bamboo_jungle: `bamboo and jungle trees; ${FARM}, and parrots, ocelots and pandas; jungle temples`,
  savanna: `acacia trees, grass; ${FARM}, and horses, donkeys and armadillos; villages`,
  savanna_plateau: `acacia trees on a plateau; ${FARM}, and horses, donkeys, llamas and armadillos; villages`,
  windswept_savanna: `acacia trees on broken hills; ${FARM}, and horses, donkeys and armadillos`,
  desert: 'sand, sandstone and cactus, no trees and no water; rabbits spawn, husks among the zombies; villages and desert temples',
  badlands: 'terracotta and red sand, no trees; armadillos spawn; mineshafts at the surface with gold ore high up',
  eroded_badlands: 'terracotta spires and red sand, no trees; armadillos spawn; mineshafts at the surface with gold ore high up',
  wooded_badlands: 'terracotta and red sand with oaks on top; armadillos spawn; mineshafts at the surface with gold ore high up',
  mushroom_fields: 'mycelium and giant mushrooms, no trees; mooshrooms spawn and no monsters do',
  beach: 'sand at the water\'s edge; turtles spawn',
  snowy_beach: 'snowy sand at the water\'s edge; nothing spawns',
  stony_shore: 'stone at the water\'s edge; nothing spawns',
  river: 'water, sand, clay and gravel; squid and salmon spawn',
  frozen_river: 'iced water, sand and clay; salmon spawn',
  ocean: OCEAN,
  deep_ocean: `${OCEAN}; ocean monuments with guardians`,
  cold_ocean: `${OCEAN}, and salmon`,
  deep_cold_ocean: `${OCEAN}, and salmon; ocean monuments with guardians`,
  lukewarm_ocean: `${OCEAN}, and tropical fish`,
  deep_lukewarm_ocean: `${OCEAN}, and tropical fish; ocean monuments with guardians`,
  warm_ocean: 'open water, coral reefs; tropical fish and pufferfish, no land animals; shipwrecks and ocean ruins',
  frozen_ocean: 'water under ice floes and icebergs; salmon, and polar bears on the ice; shipwrecks and ocean ruins',
  deep_frozen_ocean: 'deep water under ice; salmon, and polar bears on the ice; ocean monuments with guardians',
  dripstone_caves: 'underground: pointed dripstone and copper ore; drowned in the water',
  lush_caves: 'underground: moss, glow berries and clay pools; axolotls spawn',
  deep_dark: 'deep underground: sculk and the warden; ancient cities',
};

function biomeFacts(name) {
  return BIOME_FACTS[String(name || '').replace('minecraft:', '')] || null;
}

module.exports = { BIOME_FACTS, biomeFacts };

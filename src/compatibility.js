'use strict';

// minecraft-data can emit a harvest restriction tag as the mining material.
// This makes diamond-pickaxe obsidian mining take 75 seconds instead of 9.4.
// https://github.com/PrismarineJS/mineflayer/issues/3921
// Keep harvestTools intact; only recover the tool-speed group when every
// permitted harvest tool establishes that this is a pickaxe block.
function fixMiningMaterials(registry) {
  if (!registry.materials['mineable/pickaxe']) return;
  for (const block of registry.blocksArray) {
    if (!/^incorrect_for_.*_tool$/.test(block.material || '')) continue;
    const tools = Object.keys(block.harvestTools || {}).map(id => registry.items[id]?.name);
    if (tools.length && tools.every(name => name?.endsWith('_pickaxe'))) block.material = 'mineable/pickaxe';
  }
}

function compatibilityPlugin(bot) {
  // 26.1's protocol decoder returns named difficulty values; Mineflayer's
  // game plugin still indexes a numeric lookup table and loses that value.
  bot._client.on('difficulty', packet => {
    const names = ['peaceful', 'easy', 'normal', 'hard'];
    const difficulty = typeof packet.difficulty === 'number' ? names[packet.difficulty] : packet.difficulty;
    if (names.includes(difficulty)) bot.game.difficulty = difficulty;
  });
}

function fixPathfinderResults() {
  const AStar = require('mineflayer-pathfinder/lib/astar');
  const patched = Symbol.for('jevbot.independentPathResults');
  if (AStar.prototype[patched]) return;
  const original = AStar.prototype.makeResult;
  AStar.prototype.makeResult = function (...args) {
    const result = original.apply(this, args);
    // The upstream search returns its internal Move objects. Path smoothing
    // then changes their coordinates, and execution shifts their action lists.
    // Continuing a partial search reuses those altered nodes: we observed
    // waypoints sinking farther on successive ticks. Return independent moves.
    result.path = result.path.map(move => Object.assign(Object.create(Object.getPrototypeOf(move)), move, {
      toBreak: move.toBreak.map(p => p.clone ? p.clone() : { ...p }),
      toPlace: move.toPlace.map(p => ({ ...p, ...(p.returnPos ? { returnPos: p.returnPos.clone() } : {}) })),
    }));
    return result;
  };
  AStar.prototype[patched] = true;
}

module.exports = { fixMiningMaterials, compatibilityPlugin, fixPathfinderResults };

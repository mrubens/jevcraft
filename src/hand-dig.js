'use strict';
// The game's rule for breaking a block by hand, from minecraft-data's
// hardness and harvestTools: every block with a hardness of zero or more
// breaks with a bare hand. Where no harvest tool is required it takes
// hardness x 1.5 seconds and drops; where one is, hardness x 5 seconds and
// nothing drops. Bedrock and the like (no hardness, or below zero) do not
// break. Checked on a scratch server (26.1.2, note 705): netherrack 2 s,
// basalt 6.25, blackstone 7.5, nether bricks 10, stone 7.5, each broken
// and none dropped; soul sand 0.75 s, dropped.
// Notes 687 and 692 had "netherrack yes; basalt, blackstone and nether
// bricks: no hand digs them", and legs, staircases and options were closed
// or said so; 25589 (critic-20260930T0034Z item 1) sat at its fortress with
// its blaze room a tunnel away, told "Blackstone, which no hand digs".

const registry = bot => bot?.registry || require('minecraft-data')('26.1');

// The block's data: a block object (its own hardness and harvestTools), or a
// name read from the registry.
function dataOf(bot, block) {
  if (!block) return null;
  if (typeof block === 'string') return registry(bot).blocksByName?.[block] || null;
  if (block.hardness !== undefined || block.harvestTools !== undefined) return block;
  return block.name ? registry(bot).blocksByName?.[block.name] || null : null;
}

// Whether the hand gets the drop: no harvest tool required.
const handDrops = (bot, block) => { const d = dataOf(bot, block); return !!d && !(d.harvestTools && Object.keys(d.harvestTools).length); };

// Seconds to break it by hand (the game's ticks: hardness x 30 where the
// hand harvests it, x 100 where not, rounded up to a tick). Null where it
// does not break. `inWater`: five times as long with the head under water.
function handSeconds(bot, block, { inWater = false } = {}) {
  const d = dataOf(bot, block);
  const h = d?.hardness;
  if (!Number.isFinite(h) || h < 0 || d.diggable === false) return null;
  const ticks = Math.ceil(h * (handDrops(bot, d) ? 30 : 100) * (inWater ? 5 : 1));
  return ticks / 20;
}

// The rule for one block: { breaks, seconds, drops }.
function handRule(bot, block, opts = {}) {
  const seconds = handSeconds(bot, block, opts);
  return { breaks: seconds !== null, seconds, drops: seconds !== null && handDrops(bot, block) };
}

const words = n => String(n || 'rock').replaceAll('_', ' ');
const secs = s => s < 10 ? `${Math.round(s * 100) / 100}`.replace(/\.?0+$/, '') : `${Math.round(s)}`;

// A few kinds said in plain words: "basalt about 6.25 s, blackstone about
// 7.5 s by hand, dropping nothing".
function handSays(bot, names) {
  const kinds = [...new Set(names)].map(n => [n, handRule(bot, n)]).filter(([, r]) => r.breaks);
  if (!kinds.length) return '';
  const none = kinds.every(([, r]) => !r.drops), all = kinds.every(([, r]) => r.drops);
  return `${kinds.map(([n, r]) => `${words(n)} about ${secs(r.seconds)} s`).join(', ')} a block by hand${none ? ', dropping nothing' : all ? '' : ' (only what needs no pickaxe drops)'}`;
}

// The Nether's rock by hand, the words every way that digs without a
// pickaxe says it with.
const NETHER_ROCK = ['netherrack', 'basalt', 'blackstone', 'nether_bricks'];
const OVERWORLD_ROCK = ['stone', 'deepslate'];
const rockByHand = (bot, nether = true) => handSays(bot, nether ? NETHER_ROCK : OVERWORLD_ROCK);

module.exports = { handRule, handSeconds, handDrops, handSays, rockByHand, NETHER_ROCK, OVERWORLD_ROCK };

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

// The rock the bot is in, and the one pace by hand every option says (note
// 754). 25589 (mid-243-je, 12:17Z) stood in deepslate at y -30 with no
// pickaxe: work_free said "about 7.5 seconds a block" (stone), each move
// "about 15 s by hand" (deepslate, the game's time), spare_pickaxe "seven
// seconds a block" and wood_reserve "two blocks a minute by stairs, or seven
// straight up", all stone figures, in the same minute. The rock is read
// round the bot (the most common kind in the cells about it that the hand
// breaks); where none is read, by the dimension and the height (deepslate
// under y 0 in the Overworld).
const ROCK_READ = /^(stone|deepslate|tuff|andesite|diorite|granite|calcite|netherrack|basalt|blackstone|end_stone|dirt|gravel|sand|sandstone|terracotta|.*_terracotta)$/;
const STAIR_WALK_SECONDS = 1.2, RISE_SECONDS = 1;
function rockAt(bot) {
  const p = bot?.entity?.position;
  const dim = String(bot?.game?.dimension || '');
  const fallback = /nether/.test(dim) ? 'netherrack' : /end/.test(dim) ? 'end_stone' : p && p.y < 0 ? 'deepslate' : 'stone';
  if (!p || typeof bot.blockAt !== 'function') return fallback;
  const counts = {};
  const f = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  const at = (x, y, z) => { try { return bot.blockAt(p.floored ? p.floored().offset(x, y, z) : { x: f.x + x, y: f.y + y, z: f.z + z }); } catch (_) { return null; } };
  for (let x = -2; x <= 2; x++) for (let y = -1; y <= 3; y++) for (let z = -2; z <= 2; z++) {
    const b = at(x, y, z);
    if (b?.name && ROCK_READ.test(b.name)) counts[b.name] = (counts[b.name] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : fallback;
}
// The pace by hand in that rock: seconds a block, a stair up (three blocks
// dug a block of height and a step walked, surface.js stairwayCost) and a
// block straight up (one dug, a block risen).
function handPace(bot, rock = rockAt(bot)) {
  const r = handRule(bot, rock);
  const seconds = r.breaks ? r.seconds : handSeconds(bot, 'stone') ?? 7.5;
  const stairSeconds = Math.round((3 * seconds + STAIR_WALK_SECONDS) * 10) / 10;
  const stairPerMinute = Math.round(60 / stairSeconds * 10) / 10;
  const straightPerMinute = Math.round(60 / (seconds + RISE_SECONDS) * 10) / 10;
  return { rock, seconds, drops: r.drops, stairSeconds, stairPerMinute, straightPerMinute,
    minutesUp: (blocks, { straight = false } = {}) => Math.max(1, Math.round(blocks / (straight ? straightPerMinute : stairPerMinute))) };
}
// In words: "deepslate comes away by hand at about 15 s a block, dropping
// nothing: a staircase climbs about 1.3 blocks a minute, straight up about
// 3.8".
function handPaceSays(bot, { rock = rockAt(bot), climb = true } = {}) {
  const p = handPace(bot, rock);
  return `${words(p.rock)} comes away by hand at about ${secs(p.seconds)} s a block${p.drops ? '' : ', dropping nothing'}${climb ? `: a staircase climbs about ${p.stairPerMinute} blocks a minute by hand, straight up about ${p.straightPerMinute}` : ''}`;
}

module.exports = { handRule, handSeconds, handDrops, handSays, rockByHand, NETHER_ROCK, OVERWORLD_ROCK, rockAt, handPace, handPaceSays };

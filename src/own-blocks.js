'use strict';
// The fortress blocks the bot laid itself, and the fortress's own it dug
// out. It carries nether bricks and pillars and spans with them, and digs
// its way through walls and piers; a brick it laid is not the fortress,
// and the foot of a hole it dug into a pier is not a floor of it.
// mid-242-bb (25581, 15:02 to 15:07 on 2026-09-28) was asked the way "to
// the fortress, 7 blocks off and 2 up" again and again about two nether
// bricks it had stacked at (-79, 44, 127) twelve minutes before, then about
// the foot of a shaft it had dug up a bridge's pier at 14:38, the bridge's
// deck thirty blocks overhead (note 613). Noted as the world says a block
// changed near the bot (a block laid or dug shows so, whichever way it was
// laid or dug: the pathfinder's scaffold, a pillar, a span, a staircase),
// dropped when the ground no longer says so, and kept with the fortress
// search across restarts.
const { Vec3 } = require('vec3');
const OWN_BLOCKS = new Set(['nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_brick_slab', 'nether_brick_wall']);
// A block laid or dug is within the bot's reach of where it stands.
const REACH = 7;
const MOST = 512;
const keyOf = p => `${p.x},${p.y},${p.z}`;

function remember(map, k, at) {
  map.delete(k); map.set(k, at);
  while (map.size > MOST) map.delete(map.keys().next().value);
}
function noteChange(bot, was, now, at = Date.now()) {
  const p = now?.position || was?.position;
  if (!p) return;
  const laid = bot._ownBlocks ||= new Map(), dug = bot._ownDug ||= new Map();
  const k = keyOf(p);
  const is = OWN_BLOCKS.has(now?.name), wasOne = OWN_BLOCKS.has(was?.name);
  if (is === wasOne) return;
  const here = bot.entity?.position;
  const near = !!here && Math.hypot(p.x + 0.5 - here.x, p.y + 0.5 - here.y, p.z + 0.5 - here.z) <= REACH;
  if (is) {
    // Put back where it dug one is the fortress's again; else its own.
    if (dug.has(k)) dug.delete(k);
    else if (near) remember(laid, k, at);
  } else if (laid.has(k)) laid.delete(k);
  else if (near) remember(dug, k, at);
}

function ownBlocksPlugin(bot) {
  if (bot._ownBlocksWatched) return;
  bot._ownBlocksWatched = true;
  bot.on?.('blockUpdate', (was, now) => { try { noteChange(bot, was, now); } catch (_) { /* a change missed */ } });
}

// Noted this session merged into the search's record (`state[field]`), and
// those the ground no longer bears out (read so where it is loaded) dropped.
function merged(bot, state, field, noted, holds) {
  const kept = state ? (state[field] ||= {}) : {};
  for (const [k, t] of noted || []) kept[k] = t;
  if (typeof bot.blockAt === 'function') {
    for (const k of Object.keys(kept)) {
      const [x, y, z] = k.split(',').map(Number);
      let b = null; try { b = bot.blockAt(new Vec3(x, y, z)); } catch (_) { b = null; }
      if (b && !holds(b)) { delete kept[k]; noted?.delete(k); }
    }
  }
  const keys = Object.keys(kept);
  if (keys.length > MOST) for (const k of keys.sort((a, b) => kept[a] - kept[b]).slice(0, keys.length - MOST)) delete kept[k];
  return new Set(Object.keys(kept));
}
// The bot's own blocks, as a set of "x,y,z" (state.own); and, kept on the
// bot for fortressFloors, the fortress's cells it dug out (state.dug).
function ownSet(bot, state) {
  bot._ownDugSet = merged(bot, state, 'dug', bot._ownDug, b => !OWN_BLOCKS.has(b.name));
  return merged(bot, state, 'own', bot._ownBlocks, b => OWN_BLOCKS.has(b.name));
}
// Dug out by the bot: the cells over a floor it made by digging.
const dugOut = (bot, p) => !!bot._ownDugSet?.has(keyOf(p));

module.exports = { OWN_BLOCKS, ownBlocksPlugin, noteChange, ownSet, dugOut, keyOf };

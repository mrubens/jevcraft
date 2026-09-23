'use strict';
// A chest on the spot before something risky, when home is too far to walk
// the valuables back to. The dream run went into the Nether five hundred
// blocks from its base with fifty-eight raw iron, a stack of lapis and its
// ingots in the pockets, all of it lost to one lava fall. A player puts a
// chest down by the portal, leaves what the far side has no use for, and
// takes it back on the way home. (The user's suggestion, 2026-09-23.)
//
// The chest is remembered in goal.caches with its contents, like the home
// stash, and the same rules decide what goes in (the valuables and
// keepsakes, not the respawn kit, which belongs beside the bed) and what
// fits. It is emptied again once the ladder is past the Nether, or when
// the bot passes it with room in its pockets and nothing left to cross for.
const { Vec3 } = require('vec3');
const { countOf } = require('./skills');
const { setAside, isSetAside } = require('./progress');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');

const REACH = 48;
const pos = p => new Vec3(p.x, p.y, p.z);
const plain = p => ({ x: p.x, y: p.y, z: p.z });
const overworld = bot => /overworld/.test(String(bot.game?.dimension || 'overworld'));
const stash = () => require('./home-stash');
const base = () => require('./home-base');
const dryAir = b => !!b && ['air', 'cave_air', 'short_grass', 'tall_grass', 'fern', 'snow', 'leaf_litter'].includes(b.name);

// The cache seen as a home, so the stash's chest code serves it.
const asHome = cache => ({ origin: cache.position, stash: { position: cache.position, contents: cache.contents || {} } });
const cacheMove = m => !!(m.valuable || m.keepsake);

function homeTooFar(bot, goal) {
  const { homeOf, homeDistance, HOME_REACH } = base();
  const home = homeOf(bot, goal);
  return !home?.stash?.position || homeDistance(bot, home) > HOME_REACH;
}

// What would go in a chest here, now.
function cacheDeposits(bot) {
  return stash().stashDeposits(bot, asHome({ position: { x: 0, y: 0, z: 0 }, contents: {} }), { valuables: true }).filter(cacheMove);
}

// A cell for the chest: in reach, on solid dry ground, air over it.
function chestCell(bot) {
  const feet = bot.entity.position.floored();
  const cells = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dz) continue;
    const c = feet.offset(dx, dy, dz);
    const floor = bot.blockAt(c.offset(0, -1, 0));
    if (floor?.boundingBox !== 'block' || /water|lava|sand|gravel/.test(floor.name) || !dryAir(bot.blockAt(c)) || !dryAir(bot.blockAt(c.offset(0, 1, 0)))) continue;
    cells.push(c);
  }
  return cells.sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))[0] || null;
}

// Before the crossing. True when there is nothing to leave or no need of a
// cache (home is in reach: the home stash takes them), or after one was
// filled, so the crossing is not held up either way; a failure rests.
async function cacheValuables(bot, task, goal, save, actions, { reason = 'the Nether', now = Date.now() } = {}) {
  if (!overworld(bot) || !homeTooFar(bot, goal) || isSetAside(goal, 'field_cache', 'here', now)) return true;
  const moves = cacheDeposits(bot);
  if (!moves.some(m => m.valuable)) return true;
  try {
    task.check(); checkAir(bot); checkThreats(bot);
    goal.step = { action: 'field_cache', items: moves, reason }; save();
    if (!countOf(bot, 'chest')) await actions.acquireStep(bot, task, 'chest', 1, goal, save);
    const cell = chestCell(bot);
    if (!cell) throw new Error('No dry spot beside me for a chest');
    await actions.place(bot, task, cell, 'chest');
    if (bot.blockAt(cell)?.name !== 'chest') throw new Error('The chest did not go down');
    const cache = { position: plain(cell), dimension: String(bot.game?.dimension || 'overworld'), contents: {}, placedAt: new Date(now).toISOString(), reason };
    (goal.caches ||= []).push(cache); save();
    const home = asHome(cache);
    const stored = await stash().stockStash(bot, task, goal, save, home, actions, { valuables: true, only: cacheMove });
    cache.contents = home.stash.contents; save();
    const what = stored.filter(m => m.valuable).map(m => `${m.count} ${m.item.replaceAll('_', ' ')}`).slice(0, 4).join(', ');
    bot.chat?.(`Leaving ${what || 'my valuables'} in a chest here before ${reason}. I'll pick them up on the way back.`);
  } catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    setAside(goal, 'field_cache', 'here', err, 20 * 60 * 1000); save();
  }
  return true;
}

// The nearest cache in this dimension with something in it.
function nearCache(bot, goal, reach = REACH) {
  const here = bot.entity.position, dimension = String(bot.game?.dimension || 'overworld');
  return (goal.caches || []).filter(c => c.dimension === dimension && Object.values(c.contents || {}).some(n => n > 0) && !isSetAside(goal, 'field_cache_take', `${c.position.x},${c.position.z}`))
    .map(c => ({ cache: c, distance: Math.hypot(c.position.x - here.x, c.position.z - here.z) }))
    .filter(c => c.distance <= reach).sort((a, b) => a.distance - b.distance)[0] || null;
}

// On the way back: everything in the cache comes out, room made first.
async function emptyCache(bot, task, goal, save, actions, cache) {
  const key = `${cache.position.x},${cache.position.z}`;
  const home = asHome(cache);
  const wants = Object.entries(cache.contents || {}).filter(([, n]) => n > 0).map(([item, count]) => ({ item, count }));
  goal.step = { action: 'field_cache_take', at: cache.position, items: wants }; save();
  try {
    const taken = await stash().restockFromStash(bot, task, goal, save, home, actions, wants);
    cache.contents = home.stash.contents || {}; cache.emptiedAt = new Date().toISOString(); save();
    if (!taken.length) setAside(goal, 'field_cache_take', key, 'nothing came out', 20 * 60 * 1000);
    else bot.chat?.('Picked my valuables back up from the chest.');
  } catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    if (/not where it was placed/.test(err.message)) { cache.contents = {}; cache.lostAt = new Date().toISOString(); }
    setAside(goal, 'field_cache_take', key, err, 20 * 60 * 1000);
  }
  save();
  return true;
}

module.exports = { REACH, cacheValuables, cacheDeposits, chestCell, nearCache, emptyCache, homeTooFar };

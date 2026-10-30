'use strict';
// What of value was seen lying, remembered where it fell and until it vanishes (note 2495). The pickups each had their
// own few seconds and gave up for good when those ran out; once the drop was out of the sixteen blocks the loot option
// looked at, it was forgotten. The user, 2026-10-29: 'Shouldn't jev always have an option to get valuable stuff within
// reach, as long as it doesn't despawn?' Each drop is offered (upkeep, fetch_drops) until it is taken or gone; a walk
// that fails ends that try only, and is said on the next offer.
const { Vec3 } = require('vec3');

// Copper is not among them (note 2586): nothing on the way to the dragon takes it, and 9 of the day's 19 'reached, not
// picked up' walks (2026-10-30) were for raw copper, one lying in a pool five blocks up walked to nine times (full-174).
const VALUABLE = /^(diamond|emerald|raw_iron|raw_gold|iron_ingot|gold_ingot|ender_pearl|blaze_rod|ender_eye|obsidian|flint|ancient_debris|netherite_scrap|netherite_ingot|bow|crossbow|shield|bucket|water_bucket|lava_bucket|golden_apple|bed|[a-z_]*_bed|(diamond|iron|netherite)_(pickaxe|sword|axe|shovel|helmet|chestplate|leggings|boots)|golden_boots|copper_(helmet|chestplate|leggings|boots))$/;
// An item entity lasts five minutes in loaded ground (6000 ticks), its clock running only while a player is near enough
// to keep the chunk ticking (about 176 blocks with this server's view).
const LIFE_MS = 5 * 60000, TICKING = 176, SEEN_GONE = 24, KEEP = 40;

function memory(bot) { return (bot._dropMemory ||= { drops: new Map(), installed: false }); }

function install(bot) {
  const m = memory(bot);
  if (m.installed) return;
  m.installed = true;
  // What the bot throws itself (the tidy's drops, a barter's ingots) is not a find (note 2518): the tidy dropped a golden
  // chestplate as no rung's and the memory offered it back, nine times over on full-98 (25589, 2026-10-29 16:2xZ). The
  // item of each toss is kept a few seconds and its entity, coming out at the bot, is not remembered.
  const tossed = [];
  for (const fn of ['tossStack', 'toss']) {
    const orig = typeof bot[fn] === 'function' ? bot[fn].bind(bot) : null;
    if (!orig) continue;
    bot[fn] = async (...args) => {
      let name = null;
      try { name = fn === 'tossStack' ? args[0]?.name : bot.registry?.items?.[args[0]]?.name; } catch (_) { name = null; }
      if (name) tossed.push({ name, at: Date.now() });
      while (tossed.length > 40) tossed.shift();
      return orig(...args);
    };
  }
  const ownToss = (name, p) => tossed.some(t => t.name === name && Date.now() - t.at < 4000) && bot.entity?.position && p.distanceTo(bot.entity.position) <= 4;
  const look = e => {
    let it = null; try { it = e?.name === 'item' || e?.entityType === bot.registry?.entitiesByName?.item?.id ? e.getDroppedItem?.() : null; } catch (_) { it = null; }
    if (!it || !VALUABLE.test(it.name) || !e.position) return;
    const known = m.drops.get(e.id);
    if (!known && ownToss(it.name, e.position)) return;
    if (known) { known.at = e.position.clone(); known.count = it.count || known.count; return; }
    m.drops.set(e.id, { id: e.id, name: it.name, count: it.count || 1, at: e.position.clone(), dimension: bot.game?.dimension, seenAt: Date.now(), tries: 0 });
    while (m.drops.size > KEEP) m.drops.delete(m.drops.keys().next().value);
  };
  const gone = e => {
    const d = m.drops.get(e?.id);
    if (!d) return;
    // Gone from near the bot: taken, burnt or vanished. Gone from far off: only out of the bot's view, still lying.
    if (!bot.entity?.position || d.dimension !== bot.game?.dimension || bot.entity.position.distanceTo(d.at) <= SEEN_GONE) m.drops.delete(e.id);
  };
  bot.on('entitySpawn', look); bot.on('entityUpdate', look); bot.on('entityGone', gone);
  // Where it lies as it moves (note 2560): 'entityUpdate' is the metadata only, and a drop that fell kept the place it
  // was first seen. full-146 (25588, 2026-10-30 02:0xZ) was sent to raw iron at (34, 33, 57), 'reached, not picked up
  // (the entity at (34.0, 23.0, 57.1), 10.3 from the bot)': it had fallen ten blocks down a hole after it was seen.
  bot.on('entityMoved', e => { const d = m.drops.get(e?.id); if (d && e.position) d.at = e.position.clone(); });
  // Where the bot died, kept as long as its drops last (note 2536): the corpse run's own record is gone once that run
  // ends or is given up, and full-106 (25588, 2026-10-29 18:3xZ) was offered its death's diamond and iron chestplate
  // 75 blocks under it, 'No route from here'.
  bot.on('death', () => { const p = bot.entity?.position; if (p) { m.deaths = [...(m.deaths || []).filter(d => Date.now() - d.at < LIFE_MS), { x: p.x, y: p.y, z: p.z, dimension: bot.game?.dimension, at: Date.now() }]; } });
}

// The remembered drops still lying in this dimension, with the time each has left.
function remembered(bot, now = Date.now()) {
  const m = memory(bot), here = bot.entity?.position;
  if (!here) return [];
  const out = [];
  for (const [id, d] of m.drops) {
    const left = d.seenAt + LIFE_MS - now;
    if (left <= 0) { m.drops.delete(id); continue; }
    if (d.dimension !== bot.game?.dimension) continue;
    // Not there where it would be seen (note 2528): merged into another stack, picked up or gone while the bot was too far
    // to hear of it. full-103 (25591, 2026-10-29 17:1xZ) was sent back for two raw iron 2 and 3 blocks off that were no
    // longer lying, 'reached, not picked up', no pickup even begun.
    if (here.distanceTo(d.at) <= 16 && !bot.entities?.[id]) { m.drops.delete(id); continue; }
    const live = bot.entities?.[id]; if (live?.position) d.at = live.position.clone();
    out.push({ ...d, distance: Math.round(here.distanceTo(d.at)), dy: Math.round(d.at.y - here.y), secondsLeft: Math.round(left / 1000) });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

const words = n => n.replaceAll('_', ' ');
// The option, or null: every valuable drop remembered, with where, how long it has and what came of the last try.
// A death's drops are the corpse run's (corpse-run.js, its staircases and digs), not this walk's (note 2521): full-103
// (25591, 2026-10-29 16:3xZ) had its death's water bucket, iron sword and iron boots offered here 54 blocks down, and the
// walk came to 'No path to the goal!' for each.
function deathAt(bot) {
  try {
    const goal = bot._goal, rec = goal?.survival?.recovery;
    if (rec?.status === 'pending' && rec.position) return rec.position;
    const cr = require('./corpse-run').corpseRun(bot, goal);
    return cr?.position || null;
  } catch (_) { return null; }
}
function fetchOption(bot) {
  const dead = deathAt(bot);
  const deaths = (memory(bot).deaths || []).filter(d => Date.now() - d.at < LIFE_MS && d.dimension === bot.game?.dimension);
  const byDeath = d => deaths.some(x => Math.hypot(d.at.x - x.x, d.at.y - x.y, d.at.z - x.z) <= 8);
  // Not a drop a few seconds old (note 2532): the dig that made it takes it up itself, and the memory's walk sent at once
  // found its item not yet read and took nothing, 'reached, not picked up' (full-109, 25592, 2026-10-29 17:5xZ, raw iron
  // 2 blocks off from an ore just dug through five blocks).
  const all = remembered(bot).filter(d => d.distance <= 96 && d.secondsLeft >= 15 && Date.now() - d.seenAt >= 3000 && !(dead && Math.hypot(d.at.x - dead.x, d.at.y - dead.y, d.at.z - dead.z) <= 8) && !byDeath(d));
  // Walked to twice from about here and not taken: left out of the walk until the bot has moved (note 2586), and said.
  const hereNow = bot.entity.position;
  const leftOut = all.filter(d => d.tries >= 2 && d.missFrom && Math.hypot(d.missFrom.x - hereNow.x, d.missFrom.z - hereNow.z) <= 8);
  const lying = all.filter(d => !leftOut.includes(d));
  if (!lying.length) return null;
  const list = lying.slice(0, 8).map(d => `${d.count} ${words(d.name)} ${d.distance} blocks off${Math.abs(d.dy) >= 3 ? ` (${Math.abs(d.dy)} ${d.dy < 0 ? 'down' : 'up'})` : ''}, about ${d.secondsLeft >= 90 ? `${Math.round(d.secondsLeft / 60)} minutes` : `${d.secondsLeft} seconds`} before it vanishes${d.tries ? `, tried ${d.tries} time${d.tries > 1 ? 's' : ''} (last: ${d.lastWhy})` : ''}`).join('; ');
  const far = Math.max(...lying.slice(0, 8).map(d => d.distance));
  const seconds = Math.max(5, Math.round(far * 2 / 4.3 + lying.length * 2));
  const triedSays = lying.slice(0, 8).filter(d => d.tries).map(d => `${words(d.name)} walked to ${d.tries === 1 ? 'once' : `${d.tries} times`}, not taken${d.lastWhy ? ` (${String(d.lastWhy).slice(0, 90)})` : ''}`);
  const leftSays = leftOut.length ? ` Left out, walked to twice from about here and not taken: ${leftOut.slice(0, 3).map(d => `${words(d.name)} ${d.distance} blocks off`).join(', ')}.` : '';
  return {
    description: `Go and pick up what of value was seen lying: ${list}. About ${seconds} seconds there and back where the walk is plain; the walk may dig. Dropped things last five minutes while the bot is within ${TICKING} blocks, then vanish.${triedSays.length ? ` ${triedSays.join('; ')}.` : ''}${leftSays}`,
    run: async (b, t) => {
      const { goals } = require('mineflayer-pathfinder'), { navigate } = require('./skills'), { collectNearbyDrops } = require('./drop-collection');
      const before = new Map(lying.map(d => [d.name, (b.inventory?.items?.() || []).filter(i => i.name === d.name).reduce((s, i) => s + i.count, 0)]));
      const took = [], misses = [];
      for (const d of lying.slice(0, 8)) {
        t?.check?.();
        const m = memory(b).drops.get(d.id);
        if (!m) continue;
        let why = null;
        try {
          // The walk's time by the distance, not a fixed few seconds: twelve at the least, three a block beyond.
          if (b.entity.position.distanceTo(d.at) > 4) await navigate(b, t, new goals.GoalNear(d.at.x, d.at.y, d.at.z, 2), { timeoutMs: Math.max(12000, d.distance * 3000), stallMs: 8000 });
          require('./drop-collection').forgetRest(b, d.name, d.at.clone ? d.at.clone() : new Vec3(d.at.x, d.at.y, d.at.z), 6);
          // Jev's choice, made with the mobs about in its state, as the walk back to the bot's own drops is (note 2287): the
          // pickup's own filter left out every drop a block nearer a mob than the bot, seen or behind rock, and full-111
          // (25591, 2026-10-29 18:2xZ), eight zombies, creepers and skeletons in the caves about and none in sight, stood a
          // block from its raw iron, 'reached, not picked up', no spot tried. A hit still goes to the survival layer (note 2535).
          await collectNearbyDrops(b, t, d.name, { origin: d.at.clone ? d.at.clone() : new Vec3(d.at.x, d.at.y, d.at.z), radius: 6, timeoutMs: 15000, waitForSpawnMs: 1500, allowExcavation: true, hostilesOk: true });
        } catch (err) { if (['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; why = String(err.message || err).slice(0, 100); }
        // The walk ended a cell short (note 2586): the game takes up a drop within about a block of the body's edge and
        // half a block of its height, and 'reached, not picked up (... 1.7 to 2.1 from the bot, in air)' was five of the
        // day's walks (full-172, full-174, full-179, full-185, 2026-10-30). The bot steps onto the drop's own cell.
        try {
          const e = b.entities?.[d.id];
          const count = () => (b.inventory?.items?.() || []).filter(i => i.name === d.name).reduce((s, i) => s + i.count, 0);
          if (!why && e?.position && e.isValid !== false && count() <= (before.get(d.name) || 0)) {
            const off = e.position.distanceTo(b.entity.position), dy = e.position.y - b.entity.position.y;
            if (off > 1 && off <= 2.5 && Math.abs(dy) <= 1.2) {
              const c = e.position.floored();
              await navigate(b, t, new goals.GoalBlock(c.x, c.y, c.z), { timeoutMs: 4000, stallMs: 2000, pickup: true, hostilesOk: true });
              await new Promise(r => setTimeout(r, 800));
            }
          }
        } catch (err) { if (['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
        const now = (b.inventory?.items?.() || []).filter(i => i.name === d.name).reduce((s, i) => s + i.count, 0);
        if (now > (before.get(d.name) || 0)) { took.push(`${now - before.get(d.name)} ${words(d.name)}`); before.set(d.name, now); memory(b).drops.delete(d.id); }
        else if (memory(b).drops.has(d.id)) {
          m.tries++; m.missFrom = { x: b.entity.position.x, z: b.entity.position.z };
          // What was there when the walk took nothing (note 2552): 'reached, not picked up' came back on full-109, full-111,
          // full-123 and full-136 (2026-10-29) with the drill's cases all taken; the entity, its place now, the bot's
          // distance and the block it lies in are said, so the next one names its cause.
          let there = '';
          if (!why) {
            try {
              const e = b.entities?.[d.id];
              if (!e) there = ' (the entity is gone)';
              else {
                const at = e.position, cell = b.blockAt?.(at.floored());
                there = ` (the entity at (${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)}), ${at.distanceTo(b.entity.position).toFixed(1)} from the bot, in ${cell?.name || '?'}, ${e.isValid === false ? 'not valid' : 'valid'}, free slots ${b.inventory?.emptySlotCount?.() ?? '?'})`;
              }
            } catch (_) { there = ''; }
          }
          m.lastWhy = why || `reached, not picked up${there}`;
        }
        if (!took.some(t => t.endsWith(words(d.name)))) misses.push(`${words(d.name)} at (${Math.floor(d.at.x)}, ${Math.floor(d.at.y)}, ${Math.floor(d.at.z)}) from ${b.entity.position.floored()}: ${why || (memory(b).drops.has(d.id) ? (m.lastWhy || 'reached, not picked up') : 'gone when the walk came')}`);
      }
      // Each miss said (note 2518): twelve of the day's walks 'took nothing' with no word of why.
      console.log(`[drops] the walk for what was seen lying: ${took.length ? `took ${took.join(', ')}` : 'took nothing'}${misses.length ? `; not taken: ${misses.slice(0, 3).join('; ')}` : ''}`);
      return took.length > 0;
    },
  };
}

module.exports = { install, remembered, fetchOption, VALUABLE };

'use strict';
// What of value was seen lying, remembered where it fell and until it vanishes (note 2495). The pickups each had their
// own few seconds and gave up for good when those ran out; once the drop was out of the sixteen blocks the loot option
// looked at, it was forgotten. The user, 2026-10-29: 'Shouldn't jev always have an option to get valuable stuff within
// reach, as long as it doesn't despawn?' Each drop is offered (upkeep, fetch_drops) until it is taken or gone; a walk
// that fails ends that try only, and is said on the next offer.
const { Vec3 } = require('vec3');

const VALUABLE = /^(diamond|emerald|raw_iron|raw_gold|raw_copper|iron_ingot|gold_ingot|copper_ingot|ender_pearl|blaze_rod|ender_eye|obsidian|flint|ancient_debris|netherite_scrap|netherite_ingot|bow|crossbow|shield|bucket|water_bucket|lava_bucket|golden_apple|bed|[a-z_]*_bed|(diamond|iron|golden|stone|netherite|copper)_(pickaxe|sword|axe|shovel|helmet|chestplate|leggings|boots))$/;
// An item entity lasts five minutes in loaded ground (6000 ticks), its clock running only while a player is near enough
// to keep the chunk ticking (about 176 blocks with this server's view).
const LIFE_MS = 5 * 60000, TICKING = 176, SEEN_GONE = 24, KEEP = 40;

function memory(bot) { return (bot._dropMemory ||= { drops: new Map(), installed: false }); }

function install(bot) {
  const m = memory(bot);
  if (m.installed) return;
  m.installed = true;
  const look = e => {
    let it = null; try { it = e?.name === 'item' || e?.entityType === bot.registry?.entitiesByName?.item?.id ? e.getDroppedItem?.() : null; } catch (_) { it = null; }
    if (!it || !VALUABLE.test(it.name) || !e.position) return;
    const known = m.drops.get(e.id);
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
    out.push({ ...d, distance: Math.round(here.distanceTo(d.at)), dy: Math.round(d.at.y - here.y), secondsLeft: Math.round(left / 1000) });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

const words = n => n.replaceAll('_', ' ');
// The option, or null: every valuable drop remembered, with where, how long it has and what came of the last try.
function fetchOption(bot) {
  const lying = remembered(bot).filter(d => d.distance <= 96 && d.secondsLeft >= 15);
  if (!lying.length) return null;
  const list = lying.slice(0, 8).map(d => `${d.count} ${words(d.name)} ${d.distance} blocks off${Math.abs(d.dy) >= 3 ? ` (${Math.abs(d.dy)} ${d.dy < 0 ? 'down' : 'up'})` : ''}, about ${d.secondsLeft >= 90 ? `${Math.round(d.secondsLeft / 60)} minutes` : `${d.secondsLeft} seconds`} before it vanishes${d.tries ? `, tried ${d.tries} time${d.tries > 1 ? 's' : ''} (last: ${d.lastWhy})` : ''}`).join('; ');
  const far = Math.max(...lying.slice(0, 8).map(d => d.distance));
  const seconds = Math.max(5, Math.round(far * 2 / 4.3 + lying.length * 2));
  return {
    description: `Go and pick up what of value was seen lying: ${list}. About ${seconds} seconds there and back where the walk is plain; the walk may dig. Dropped things last five minutes while the bot is within ${TICKING} blocks, then vanish.`,
    run: async (b, t) => {
      const { goals } = require('mineflayer-pathfinder'), { navigate } = require('./skills'), { collectNearbyDrops } = require('./drop-collection');
      const before = new Map(lying.map(d => [d.name, (b.inventory?.items?.() || []).filter(i => i.name === d.name).reduce((s, i) => s + i.count, 0)]));
      const took = [];
      for (const d of lying.slice(0, 8)) {
        t?.check?.();
        const m = memory(b).drops.get(d.id);
        if (!m) continue;
        let why = null;
        try {
          // The walk's time by the distance, not a fixed few seconds: twelve at the least, three a block beyond.
          if (b.entity.position.distanceTo(d.at) > 4) await navigate(b, t, new goals.GoalNear(d.at.x, d.at.y, d.at.z, 2), { timeoutMs: Math.max(12000, d.distance * 3000), stallMs: 8000 });
          await collectNearbyDrops(b, t, d.name, { origin: d.at.clone ? d.at.clone() : new Vec3(d.at.x, d.at.y, d.at.z), radius: 6, timeoutMs: 15000, waitForSpawnMs: 0, allowExcavation: true });
        } catch (err) { if (['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; why = String(err.message || err).slice(0, 100); }
        const now = (b.inventory?.items?.() || []).filter(i => i.name === d.name).reduce((s, i) => s + i.count, 0);
        if (now > (before.get(d.name) || 0)) { took.push(`${now - before.get(d.name)} ${words(d.name)}`); before.set(d.name, now); memory(b).drops.delete(d.id); }
        else if (memory(b).drops.has(d.id)) { m.tries++; m.lastWhy = why || 'reached, not picked up'; }
      }
      console.log(`[drops] the walk for what was seen lying: ${took.length ? `took ${took.join(', ')}` : 'took nothing'}`);
      return took.length > 0;
    },
  };
}

module.exports = { install, remembered, fetchOption, VALUABLE };

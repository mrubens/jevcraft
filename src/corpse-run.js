'use strict';
// Back for what a death dropped, as a player goes. With the kit restore off
// (2026-09-23), every death cost the iron kit, the sword, the rods and the
// pearls: the survival layer's own pickup only looks within 128 blocks of
// the respawn and for half a minute, and most deaths are far from the bed.
// Dropped items only age while their chunk is loaded, so a death far from
// the respawn keeps its drops until the bot comes near again; one close to
// the respawn has the game's five minutes from the death.
//
// A death in the Nether waits for the next Nether trip (the ladder goes
// back there for its rods anyway, in a kit made again first); nothing is
// fetched from the End, where drops fall into the void.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, countOf } = require('./skills');
const { collectNearbyDrops } = require('./drop-collection');

const WORTH = /^(diamond|emerald|iron_ingot|gold_ingot|raw_iron|raw_gold|blaze_rod|blaze_powder|ender_pearl|ender_eye|obsidian|shield|bow|crossbow|arrow|bucket|water_bucket|lava_bucket|flint_and_steel|golden_apple|enchanted_golden_apple|trial_key|ominous_trial_key|ancient_debris|netherite_ingot|netherite_scrap|diamond_block|iron_block|gold_block|golden_carrot|cooked_beef|cooked_porkchop|cooked_mutton|bread)$|_(helmet|chestplate|leggings|boots|sword|pickaxe|axe)$/;
const CHEAP = /^(wooden|stone)_(sword|pickaxe|axe)$/;
const TICKING = 128, DESPAWN_MS = 5 * 60000, MARGIN_MS = 20000, KEEP_MS = 3 * 3600000, LEG_MS = 120000, ARRIVE = 6;
const ARMOUR = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };
const dim = name => String(name || 'overworld').replace(/^minecraft:/, '').replace(/^the_/, '');
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function worth(items = {}) {
  const out = {};
  for (const [name, count] of Object.entries(items)) if (count > 0 && WORTH.test(name) && !CHEAP.test(name)) out[name] = count;
  return out;
}

// The run for the last death, made the first time it is looked at after
// the survival layer's own nearby pickup has finished; null when there is
// nothing to go back for now.
function corpseRun(bot, goal, now = Date.now()) {
  const survival = goal.survival || {};
  const death = (survival.deaths || []).at(-1), recovery = survival.recovery;
  if (!death) return null;
  if (goal.corpseRun?.deathAt !== death.at) {
    if (recovery?.at !== death.at || recovery.status === 'pending') return null;
    const items = worth(recovery.inventoryBeforeDeath);
    for (const [name, count] of Object.entries(recovery.recovered || {})) if (items[name] && (items[name] -= count) <= 0) delete items[name];
    const where = dim(death.dimension);
    goal.corpseRun = { deathAt: death.at, position: { ...death.position }, dimension: where, items, passes: 0, stuck: 0,
      status: where === 'end' ? 'void' : death.lava ? 'burned' : Object.keys(items).length ? 'open' : 'nothing',
      respawn: dim(bot.game?.dimension) === where ? { ...bot.entity.position } : null };
  }
  const run = goal.corpseRun;
  if (run.status !== 'open') return null;
  if (now - Date.parse(run.deathAt) > KEEP_MS) { run.status = 'stale'; return null; }
  if (dim(bot.game?.dimension) !== run.dimension) return null;
  // When the drops started to age: at the death, if the bot came back to
  // life within the loaded ground round them; else when it came near.
  if (!run.loadedAt && run.respawn && flat(run.respawn, run.position) <= TICKING) run.loadedAt = run.deathAt;
  if (!run.loadedAt && flat(bot.entity.position, run.position) <= TICKING) run.loadedAt = new Date(now).toISOString();
  if (run.loadedAt && now - Date.parse(run.loadedAt) > DESPAWN_MS - MARGIN_MS) { run.status = 'despawned'; return null; }
  return run;
}

const listed = items => Object.entries(items).map(([name, n]) => `${n > 1 ? `${n} ` : ''}${name.replace(/_/g, ' ')}`).join(', ');

async function wearRecovered(bot) {
  for (const item of bot.inventory.items()) {
    const slot = ARMOUR[item.name.split('_').pop()];
    if (!slot || bot.inventory.slots?.[{ head: 5, torso: 6, legs: 7, feet: 8 }[slot]]) continue;
    try { await bot.equip(item, slot); } catch (_) { /* worn next time the kit is readied */ }
  }
}

async function corpseRunStep(bot, task, goal, save, { move = navigate, collect = collectNearbyDrops } = {}) {
  const run = corpseRun(bot, goal);
  if (!run) { save(); return false; }
  const spot = new Vec3(run.position.x, run.position.y, run.position.z);
  if (!run.announced) {
    run.announced = true;
    bot.chat?.(`Going back for what I dropped when I died, ${Math.round(flat(bot.entity.position, spot))} blocks off: ${listed(run.items)}.`);
  }
  goal.step = { action: 'corpse_run', to: { ...run.position }, items: { ...run.items } }; save();
  const before = flat(bot.entity.position, spot);
  if (before > ARRIVE) {
    try { await move(bot, task, new goals.GoalNearXZ(spot.x, spot.z, 3), { timeoutMs: LEG_MS, stallMs: 8000, sprint: true }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    const after = flat(bot.entity.position, spot);
    if (after > ARRIVE) {
      if (before - after < 8 && ++run.stuck >= 3) {
        run.status = 'unreachable'; bot.chat?.(`I can't get back to where I died. I'll make do without those things.`);
      }
      save(); return true;
    }
  }
  // At the spot: what is lying there, a stack at a time while it pays.
  let got = 0;
  for (const name of Object.keys(run.items)) {
    for (let tries = 0; tries < 4 && run.items[name] > 0; tries++) {
      task.check();
      const had = countOf(bot, name);
      try { await collect(bot, task, name, { origin: spot, radius: 12, timeoutMs: 12000, allowExcavation: true }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      const gained = countOf(bot, name) - had;
      if (gained <= 0) break;
      got += gained;
      if ((run.items[name] -= gained) <= 0) delete run.items[name];
    }
  }
  run.passes++;
  if (got) await wearRecovered(bot);
  if (!Object.keys(run.items).length) { run.status = 'done'; bot.chat?.('Got my things back.'); }
  else if (!got || run.passes >= 2) {
    run.status = got ? 'partial' : 'gone';
    bot.chat?.(got ? `Got some of it back. The rest is gone: ${listed(run.items)}.` : `Nothing left where I died. Lava or time took it.`);
  }
  save();
  return true;
}

module.exports = { corpseRun, corpseRunStep, worth };

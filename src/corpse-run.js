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
// Three dimensions: a death in a mine under the bed is not beside the bed.
const flat = (a, b) => Math.hypot(a.x - b.x, (a.y ?? b.y) - (b.y ?? a.y), a.z - b.z);

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
    // What was worn drops with the rest (recovery.js records it apart from
    // the pockets): mid-242-aa's iron helmet and chestplate were never on
    // its list (note 559).
    const dropped = { ...(recovery.inventoryBeforeDeath || {}) };
    for (const name of death.worn || []) dropped[name] = (dropped[name] || 0) + 1;
    const items = worth(dropped);
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
  // life within the loaded ground round them; else when it came near. The
  // clock runs whether or not the bot is fit to go: it is the game's.
  if (!run.loadedAt && run.respawn && flat(run.respawn, run.position) <= TICKING) run.loadedAt = run.deathAt;
  if (!run.loadedAt && flat(bot.entity.position, run.position) <= TICKING) run.loadedAt = new Date(now).toISOString();
  if (run.loadedAt && now - Date.parse(run.loadedAt) > DESPAWN_MS - MARGIN_MS) { run.status = 'despawned'; return null; }
  // Whether it is fit to go is Jev's to weigh (corpse_run, told what was
  // about at the death, what it wore then and wears now); the kit or
  // daylight is the fallback's rule only (corpseRunStep). As a gate here it
  // kept the kit's own way back shut until the kit was made again:
  // mid-242-aa came back through its Nether portal thirteen blocks from its
  // iron sword, iron armor, bucket and pickaxe, unarmored, was never
  // asked, and died to a wither skeleton half an hour later in no armor
  // and with a stone sword (note 559).
  return run;
}

// Daylight is no help below ground: the dream run went back unarmoured by
// day to a cave at y 15 where two zombies had just killed it, and they
// killed it again (2026-09-24). Below sea level the kit is needed as in the
// Nether.
const SEA_LEVEL = 60;
function fitToGo(bot, where) {
  const { kitReady } = require('./mob-policy');
  if (kitReady(bot)) return true;
  if (dim(bot.game?.dimension) !== 'overworld') return false;
  if (where && where.y < SEA_LEVEL) return false;
  const t = bot.time?.timeOfDay ?? 0;
  return t < 12500 || t >= 23500;
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
  // Jev's to weigh, once a death: what was about when the bot died there,
  // against what it would get back.
  const client = task.opportunityClient;
  // With no one to ask, the old rule: the kit worn (in the Nether or under
  // ground), or daylight. The dream run walked back to a fortress's edge
  // with no armor for the armor it had dropped there, and the wither
  // skeleton that killed it once killed it again (2026-09-24 00:49).
  if (!run.choice && !client && !fitToGo(bot, run.position)) { save(); return false; }
  if (!run.choice && client) {
    const death = (goal.survival?.deaths || []).at(-1) || {};
    const about = (death.about || []).map(t => `a ${t.name.replaceAll('_', ' ')} ${t.distance} blocks off`).join(', ');
    const wornNow = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
    const far = Math.round(flat(bot.entity.position, spot));
    const left = run.loadedAt ? Math.max(0, Math.round((DESPAWN_MS - (Date.now() - Date.parse(run.loadedAt))) / 1000)) : null;
    const t = bot.time?.timeOfDay ?? 0, night = t >= 12500 && t < 23500;
    const tree = {
      go_back: { description: `Go back for ${listed(run.items)}: ${far} blocks off${Math.abs(spot.y - bot.entity.position.y) > 4 ? `, at y ${Math.round(spot.y)}` : ''}. ${left === null ? 'They last until the bot comes within 128 blocks, then five minutes.' : `About ${left} seconds before they vanish.`} When the bot died there, ${about ? `about it were ${about}` : 'nothing hostile was in view'}; it wore ${death.worn?.length ? death.worn.map(n => n.replaceAll('_', ' ')).join(', ') : 'no armour'} then and wears ${wornNow.length ? wornNow.map(n => n.replaceAll('_', ' ')).join(', ') : 'no armour'} now. It is ${night ? 'night' : 'day'}.` },
      leave_them: { description: `Leave them and go on with what is carried: ${listed(worth(Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])))) || 'nothing worth listing'}. What was dropped is made again, or found, later.` },
    };
    const decision = await require('./decisions').decide('corpse_run', { client, bot, task, goal, save, tree,
      state: { distance: far, secondsLeft: left, aboutAtDeath: death.about || [], wornAtDeath: death.worn || [], wornNow, night } });
    if (decision.stale) return false;
    if (decision.fallback && !fitToGo(bot, run.position)) { save(); return false; }
    run.choice = decision.fallback ? 'go_back' : decision.path.at(-1); save();
    if (run.choice === 'leave_them') { run.status = 'left'; save(); return false; }
  }
  if (!run.announced) {
    run.announced = true;
    bot.chat?.(`Going back for what I dropped when I died, ${Math.round(flat(bot.entity.position, spot))} blocks off: ${listed(run.items)}.`);
  }
  goal.step = { action: 'corpse_run', to: { ...run.position }, items: { ...run.items } }; save();
  const before = flat(bot.entity.position, spot);
  if (before > ARRIVE) {
    try { await move(bot, task, new goals.GoalNear(spot.x, spot.y, spot.z, 3), { timeoutMs: LEG_MS, stallMs: 8000, sprint: true }); }
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

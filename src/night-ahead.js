'use strict';
// The coming night, said by day on the strategy question (note 2158): when
// dusk is, how long the night to dawn is, and what it is spent on given what
// is carried. full-6 (2026-10-26 05:13Z), back to life with 16 dirt and 3
// beef, 6 minutes of daylight left, chose the bed rung, searched for sheep
// till dusk, and sat the 11-minute night sealed in with nothing to dig with,
// twice over; it was told the daylight left, not what the night would be.
// Over the 145-hour runs the nights stand at 999 to 1279 minutes sealed
// waiting against 151 to 172 night-mining and 21 to 23 asleep.
const { DAY } = require('./day');

// Dusk to dawn in real minutes (a tick is a twentieth of a second).
const NIGHT_MINUTES = Math.round((DAY.DAWN - DAY.DUSK) / 1200 * 10) / 10;

const count = (items, re) => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
const label = name => String(name).replaceAll('_', ' ');

// Whether the night can be a mine: a pickaxe carried, or one makeable from
// what is carried (a table and a wooden pickaxe take two logs; a stone one
// three cobblestone besides).
function pickaxeSays(items) {
  const pick = items.find(i => /_pickaxe$/.test(i.name));
  if (pick) return `a ${label(pick.name)} is carried`;
  const logs = count(items, /_log$/), planks = count(items, /_planks$/), sticks = count(items, /^stick$/), cobble = count(items, /^(cobblestone|cobbled_deepslate)$/), iron = count(items, /^iron_ingot$/);
  const wood = logs * 4 + planks; // planks' worth
  const table = items.some(i => i.name === 'crafting_table');
  // A table is 4 planks; a pickaxe 3 planks and 2 sticks (1 plank).
  const woodForPick = table ? 4 : 8;
  if (wood + sticks / 2 >= woodForPick || (table && (sticks >= 2 && planks >= 3))) {
    const make = iron >= 3 ? 'an iron pickaxe' : cobble >= 3 ? 'a stone pickaxe' : 'a wooden pickaxe';
    return `no pickaxe is carried, but ${make} can be made from what is carried (${logs ? `${logs} logs` : `${planks} planks`}${sticks ? `, ${sticks} sticks` : ''}${table ? ', a crafting table' : ''}${cobble ? `, ${cobble} cobblestone` : ''}${iron ? `, ${iron} iron ingots` : ''})`;
  }
  return `no pickaxe is carried and none can be made from what is carried (${logs} logs, ${planks} planks${table ? ', a crafting table' : ', no crafting table'}: a table and a wooden pickaxe take two logs' worth of planks)`;
}

// Where the bot is against the night (note 2306): under rock the night changes nothing, the dark and the mobs of a
// cave are the same by day; it is the surface the night costs. full-10 (25586, 2026-10-27 17:39Z), 54 blocks down
// with lava for the portal owed at depth, was told a night awake is 'about eight and a half real minutes ... sealed
// in or night-mining', chose the bed rung and climbed for a village 95 blocks off at night; the user watching: 'It
// doesn't make sense for him to go above ground to try to gather a bed at night'.
function underSays(bot) {
  let up = null; try { up = require('./levels').depthHere(bot); } catch (_) { up = null; }
  if (!Number.isFinite(up) || up < 4) return '';
  // The light here and what is worn (note 2323): monsters spawn where the block light is 0, by day as by night, so the
  // cave is not safer than the surface for being under rock. full-12 (25588, 2026-10-27 21:22Z), told 'down here the
  // night changes nothing', was shot dead at y 26 in the dark with nothing worn, two skeletons and two creepers about.
  let light = null;
  try { const b = bot.blockAt?.(bot.entity.position.floored()); light = Number.isFinite(b?.light) ? b.light : null; } catch (_) { light = null; }
  const worn = (() => { try { return [5, 6, 7, 8].map(i => bot.inventory?.slots?.[i]).filter(Boolean).length; } catch (_) { return null; } })();
  const lightSays = light === null ? '' : light === 0 ? ' The block light here is 0: monsters spawn here, by day as by night.' : ` The block light here is ${light}: monsters spawn only where it is 0, in the dark about it.`;
  const wornSays = worn === null ? '' : worn === 0 ? ' Nothing is worn: every hit lands whole.' : ` ${worn} of 4 armour pieces worn.`;
  return ` The bot is ${up} blocks under open sky: down here the night changes nothing, a cave is as dark and its mobs the same by day, and the mining goes on through it; the night costs time at the surface, where mobs spawn on the open ground and a night awake there is waited out sealed in or fought.${lightSays}${wornSays}`;
}
// The spawn point's distance, where a bed slept in is it.
function spawnSays(bot) {
  const foot = bot._survivalState?.spawnBed?.foot, here = bot.entity?.position;
  if (!foot || !here) return '';
  return ` The spawn point is the bed slept in at (${foot.x}, ${foot.y}, ${foot.z}), ${Math.round(Math.hypot(foot.x - here.x, foot.z - here.z))} blocks off: a death comes back to life there.`;
}
// The fact, or null off the Overworld or with no clock. By night (note 2306): how long to dawn, and where the bot is
// against it; it was said by day alone, and by night the bed's flat cost of a night stood unanswered.
function nightAheadSays(bot, goal, now = Date.now()) {
  const t = bot.time?.timeOfDay;
  if (!Number.isFinite(t)) return null;
  if (!/overworld/.test(String(bot.game?.dimension || 'overworld'))) return null;
  if (t >= DAY.DUSK && t < DAY.DAWN) {
    const toDawn = Math.round((DAY.DAWN - t) / 1200 * 10) / 10;
    return `Night now: dawn in about ${toDawn} real minutes.${underSays(bot)}${spawnSays(bot)}`;
  }
  const minutes = Math.round(((DAY.DUSK - t + 24000) % 24000) / 1200 * 10) / 10;
  const items = bot.inventory?.items?.() || [];
  const bed = items.some(i => /_bed$/.test(i.name));
  const by = goal?.gameProgress?.clock?.byDoing || {};
  const mins = k => Math.round((by[k] || 0) / 60000);
  const run = `This run so far: ${mins('wait_in_shelter')} minutes sealed waiting through nights, ${mins('night_mine')} night-mining, ${mins('sleep')} asleep.`;
  return `Dusk in about ${minutes} real minutes; the night from dusk to dawn is about ${NIGHT_MINUTES} real minutes. How a night is spent: asleep, in seconds, with a bed set down at bedtime (${bed ? 'a bed is carried' : 'no bed is carried'}); or mining from a sealed pocket, which keeps the rock's shelter and gains ore and stone, with a pickaxe (${pickaxeSays(items)}); or sealed in, gaining nothing.${underSays(bot)}${spawnSays(bot)} ${run}`;
}

// This run's own nights, for the bed questions (note 2180): the minutes sealed waiting, mining and asleep so far,
// and the waiting's share of the run's play. full-3 waited 21.8 hours of its 150 (15%) with a bed standing far off
// and none carried; the bed question had said the fleet's record and nothing of this run's own.
function runNightsSays(goal) {
  const clock = goal?.gameProgress?.clock;
  if (!clock?.byDoing) return '';
  const by = clock.byDoing, mins = k => Math.round((by[k] || 0) / 60000);
  const waited = mins('wait_in_shelter'), played = Math.round((clock.playedMs || 0) / 60000);
  if (!played) return '';
  const share = Math.round(waited / played * 100);
  const hours = n => n >= 90 ? `${Math.round(n / 6) / 10} hours` : `${n} minutes`;
  return ` This run so far: ${hours(waited)} sealed in waiting through nights (${share}% of its ${hours(played)} of play), ${hours(mins('night_mine'))} night-mining, ${hours(mins('sleep'))} asleep; a night with a bed carried and set down at bedtime passes in seconds, one waited out awake is about ${NIGHT_MINUTES} real minutes.`;
}

// The body against the coming night (note 2773, the user 2026-11-01 'Build that'): from five real minutes before dusk
// and through the night, the health, the hunger and the food carried, whether health comes back through the night as
// things stand (the game heals at hunger 18 or more), and the food animals within 32. full-312 (25592, 2026-11-01 04:5xZ)
// came to dusk underground at 11.7 health, hunger 17 and nothing to eat; its food search went for the surface, the climb
// out was resting, and it sealed in for the night with health that could not come back.
const FOOD_ANIMALS = /^(cow|pig|sheep|chicken|rabbit|mooshroom|salmon|cod)$/;
function nightBodySays(bot) {
  const t = bot.time?.timeOfDay;
  if (!Number.isFinite(t) || !/overworld/.test(String(bot.game?.dimension || 'overworld'))) return null;
  const toDusk = ((DAY.DUSK - t + 24000) % 24000) / 1200, atNight = t >= DAY.DUSK && t < DAY.DAWN;
  if (!atNight && toDusk > 5) return null;
  const health = Math.round((bot.health ?? 20) * 10) / 10, hunger = bot.food ?? 20;
  let points = 0, carried = [];
  try { points = Math.round(require('./foraging').foodSupply(bot) || 0); } catch (_) { points = 0; }
  try { const foods = bot.registry?.foodsByName || {}; carried = (bot.inventory?.items?.() || []).filter(i => foods[i.name] && !/^(rotten_flesh|spider_eye|poisonous_potato|pufferfish|suspicious_stew)$/.test(i.name)).map(i => `${i.count} ${label(i.name)}`); } catch (_) { carried = []; }
  const heals = hunger >= 18 ? 'health comes back while hunger stays at 18 or more' : carried.length ? `health comes back once something is eaten to bring hunger to 18 (hunger ${hunger} now)` : `health does not come back through the night: hunger ${hunger} is under the 18 the game heals at, and nothing carried is food`;
  const here = bot.entity?.position;
  const kinds = {};
  if (here) for (const e of Object.values(bot.entities || {})) if (e?.position && FOOD_ANIMALS.test(e.name || '') && e.position.distanceTo(here) <= 32) { const k = kinds[e.name] ||= { n: 0, d: Infinity }; k.n++; k.d = Math.min(k.d, Math.round(e.position.distanceTo(here))); }
  const animals = Object.entries(kinds).map(([k, v]) => `${v.n} ${label(k)}${v.n === 1 ? '' : 's'} (nearest ${v.d} blocks)`).join(', ');
  const when = atNight ? `Night now, dawn in about ${Math.round((DAY.DAWN - t) / 1200 * 10) / 10} real minutes` : `Dusk in about ${Math.round(toDusk * 10) / 10} real minutes, then about ${NIGHT_MINUTES} real minutes of night`;
  return `${when}. Health ${health}, hunger ${hunger}; food carried: ${carried.length ? carried.join(', ') : 'none'}${points ? ` (${points} food points)` : ''}; ${heals}. Food animals within 32: ${animals || 'none seen'}. A night sealed in or mining keeps the health it begins with where it cannot heal; the food got before dusk is the healing through it.`;
}

module.exports = { nightAheadSays, nightBodySays, pickaxeSays, runNightsSays, NIGHT_MINUTES };

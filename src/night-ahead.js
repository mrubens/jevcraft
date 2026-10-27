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
  return ` The bot is ${up} blocks under open sky: down here the night changes nothing, a cave is as dark and its mobs the same by day, and the mining goes on through it; the night costs time at the surface, where mobs spawn on the open ground and a night awake there is waited out sealed in or fought.`;
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

module.exports = { nightAheadSays, pickaxeSays, runNightsSays, NIGHT_MINUTES };

'use strict';
// A craft that makes nothing, said and rested (note 690). 25588 (mid-243-ha,
// 20:02 to 20:07Z) clicked four sticks from two planks fourteen times in
// five minutes, each "Timed out waiting for world/inventory update: stick
// after crafting, twice", while the stone pickaxe, the upkeep and the
// stillness detours each asked for the same craft again, told of it only on
// the one answer that had chosen it. A furnace window its unstuck moves had
// opened was still open, and the server takes no click in the pockets' grid
// while one is. The failure is the bot's, not an answer's: every question
// is told, and the craft of that item rests as a failed way does in the
// ledger (tried.js: two in ten minutes rest it five), said when refused.
const { WINDOW_MS, REST_AFTER, REST_MS } = require('./tried');

const words = name => String(name).replaceAll('_', ' ');
const ago = ms => ms < 90000 ? `${Math.max(1, Math.round(ms / 1000))} seconds` : `${Math.round(ms / 60000)} minutes`;
const times = n => n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;

function recent(bot, now = Date.now()) {
  const list = (bot._craftFailures || []).filter(f => now - f.at < WINDOW_MS);
  bot._craftFailures = list;
  return list;
}

function noteCraftFailure(bot, item, reason, now = Date.now()) {
  const p = bot.entity?.position;
  recent(bot, now).push({ item, at: now, reason: String(reason || '').slice(0, 200), ...(p ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : {}) });
}

// A craft that made its output ends the item's run of failures.
function noteCraftMade(bot, item) {
  if (bot._craftFailures?.length) bot._craftFailures = bot._craftFailures.filter(f => f.item !== item);
}

// The item's failures, and until when its craft rests (null if it does not).
function craftRest(bot, item, now = Date.now()) {
  const mine = recent(bot, now).filter(f => f.item === item);
  if (mine.length < REST_AFTER) return null;
  const last = mine.at(-1), until = last.at + REST_MS;
  if (until <= now) return null;
  return { until, count: mine.length, says: `Crafting ${words(item)} made nothing ${times(mine.length)} in the last ${ago(now - mine[0].at)} (the last ${ago(now - last.at)} ago: ${last.reason}). It rests ${ago(until - now)} more.` };
}

// Every craft that made nothing lately, one line each, for every question.
function craftFailuresSay(bot, now = Date.now()) {
  const by = {};
  for (const f of recent(bot, now)) (by[f.item] ||= []).push(f);
  const lines = Object.entries(by).map(([item, list]) => craftRest(bot, item, now)?.says ||
    `Crafting ${words(item)} made nothing ${times(list.length)} in the last ${ago(now - list[0].at)} (the last ${ago(now - list.at(-1).at)} ago: ${list.at(-1).reason}).`);
  return lines.length ? lines.join(' ') : null;
}

module.exports = { noteCraftFailure, noteCraftMade, craftRest, craftFailuresSay };

'use strict';
// Wolves: tamed with bones, a companion that fights skeletons and zombies
// beside the bot and costs nothing to keep. The user, 2026-09-23, asked for
// wolves and more breeding.
//
// Two tamed at most. A wolf attacks whatever its owner hits, so before a
// Nether or End crossing (zombified piglins, endermen) they are told to sit
// where they are; pets do not follow through a portal anyway. Back in the
// Overworld they are stood up again when the bot passes them.
const { goals } = require('mineflayer-pathfinder');
const { countOf } = require('./skills');
const { setAside, isSetAside } = require('./progress');

const TAME_MAX = 2, REACH = 24;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = (bot, name) => (bot.registry?.entitiesByName?.wolf?.metadataKeys || []).indexOf(name);
const flags = (bot, e) => e.metadata?.[key(bot, 'flags')] ?? 0;
const tamed = (bot, e) => (flags(bot, e) & 0x04) !== 0;
const sitting = (bot, e) => (flags(bot, e) & 0x01) !== 0;
const baby = (bot, e) => e.metadata?.[key(bot, 'baby')] === true;
const ownerOf = (bot, e) => String(e.metadata?.[key(bot, 'owneruuid')] || '').replace(/-/g, '').toLowerCase();
const myId = bot => String(bot.player?.uuid || bot.uuid || '').replace(/-/g, '').toLowerCase();
const near = (bot, e, r) => e.position && e.position.distanceTo(bot.entity.position) <= r;
const wolvesAround = (bot, r = REACH) => Object.values(bot.entities || {}).filter(e => e.name === 'wolf' && e.isValid !== false && near(bot, e, r));

function myWolves(bot, r = 64) {
  const me = myId(bot);
  return wolvesAround(bot, r).filter(e => tamed(bot, e) && (!me || ownerOf(bot, e) === me));
}
function wildWolf(bot, goal) {
  return wolvesAround(bot).filter(e => !tamed(bot, e) && !baby(bot, e) && !isSetAside(goal, 'tame_wolf', e.id))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] || null;
}

// A wolf can be tamed now: one wild in view, bones in hand, fewer than two
// kept, and in the Overworld.
function tameReady(bot, goal) {
  if (!/overworld/.test(String(bot.game?.dimension || 'overworld'))) return false;
  const kept = (goal.wolves || []).filter(w => !w.lostAt).length;
  return kept < TAME_MAX && countOf(bot, 'bone') >= 1 && !!wildWolf(bot, goal);
}

// Walk to the wolf and feed it bones until it is tamed (a third of bones
// tame, on average) or the bones run out.
async function tameWolf(bot, task, goal, save, { navigate }) {
  const wolf = wildWolf(bot, goal);
  if (!wolf) return false;
  goal.step = { action: 'tame_wolf', wolf: wolf.id, bones: countOf(bot, 'bone') }; save();
  for (let tries = 0; tries < 12 && countOf(bot, 'bone') > 0 && !tamed(bot, wolf); tries++) {
    task.check();
    if (bot.entities[wolf.id] !== wolf || wolf.isValid === false) break;
    if (!near(bot, wolf, 3)) {
      try { await navigate(bot, task, new goals.GoalFollow(wolf, 2), { timeoutMs: 12000, stallMs: 4000, stopWhen: () => near(bot, wolf, 2.5) }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      if (!near(bot, wolf, 3.5)) continue;
    }
    const bone = bot.inventory.items().find(i => i.name === 'bone');
    await bot.equip(bone, 'hand');
    await bot.lookAt(wolf.position.offset(0, 0.5, 0), true);
    bot.useOn(wolf);
    await sleep(700);
  }
  if (!tamed(bot, wolf)) { setAside(goal, 'tame_wolf', wolf.id, 'bones gone before it took', 20 * 60 * 1000); save(); return false; }
  (goal.wolves ||= []).push({ id: wolf.id, uuid: wolf.uuid, tamedAt: new Date().toISOString() }); save();
  bot.chat?.(`Tamed a wolf. It'll follow me and fight beside me.`);
  return true;
}

// Sit (before a crossing) or stand (back in the Overworld) every wolf of the
// bot's in reach. Right-click with an empty hand toggles it.
async function commandWolves(bot, task, goal, save, sit) {
  const wolves = myWolves(bot, 16).filter(w => sitting(bot, w) !== sit);
  if (!wolves.length) return false;
  if (bot.heldItem) { try { await bot.unequip('hand'); } catch (_) { /* toggling with an item works too */ } }
  for (const wolf of wolves) {
    task.check();
    await bot.lookAt(wolf.position.offset(0, 0.5, 0), true);
    bot.useOn(wolf);
    await sleep(300);
  }
  goal.wolfOrder = { sit, at: new Date().toISOString(), wolves: wolves.length }; save();
  if (sit) bot.chat?.(wolves.length === 1 ? 'Stay here. Back soon.' : `Stay here, all ${wolves.length} of you. Back soon.`);
  return true;
}

module.exports = { TAME_MAX, tamed, sitting, myWolves, wildWolf, tameReady, tameWolf, commandWolves };

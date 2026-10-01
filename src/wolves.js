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
// A wolf seen and out of view is a trip when it was this near (note 644): the
// option had been one only for a wolf within 24 blocks in view, and was
// offered once on 2026-09-28's fresh worlds, where wolves stood in the
// entity lists of about one flight file in fifty and every bot that met one
// was 30 blocks past it by the next question.
const TRIP = 64;
// One bone in three tames, each feeding: the chance that n bones take.
const MOST = ['none', 'one', 'two', 'three', 'four'][TAME_MAX] || String(TAME_MAX);
const takes = n => 1 - Math.pow(2 / 3, Math.max(0, n));
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

// A wild adult, for the sightings: a tamed wolf beside the bot, or a pup, is
// not one to walk back to.
const wild = (bot, e) => !tamed(bot, e) && !baby(bot, e);

// The nearest wolf remembered (sightings.js), within a trip's reach.
function sightedWolf(bot, goal) {
  try { return require('./sightings').sighted(bot, goal || {}, 'wolf').find(s => s.distance <= TRIP && !isSetAside(goal || {}, 'tame_wolf', `${s.x},${s.z}`)) || null; }
  catch (_) { return null; }
}

// A wolf can be tamed now, or is a trip away: one wild in view, or seen
// within 64 blocks and remembered; bones in hand, fewer than two kept, and in
// the Overworld.
function tameReady(bot, goal) {
  if (!/overworld/.test(String(bot.game?.dimension || 'overworld'))) return false;
  const kept = (goal.wolves || []).filter(w => !w.lostAt).length;
  return kept < TAME_MAX && countOf(bot, 'bone') >= 1 && (!!wildWolf(bot, goal) || !!sightedWolf(bot, goal));
}

// What the trip is, said with the option: where the wolf is, the odds the
// bones carried give, what a tamed wolf does and does not do, and what the
// Overworld cost the fresh worlds of 2026-09-28 (62 midgame trials from
// first-days saves): zombies (8), creepers (5), skeletons (3) and spiders (2)
// were 18 of the 23 deaths before the Nether. Not a promise that a wolf would have stopped
// them: it fights what attacks the bot and what the bot strikes, goes for
// skeletons unasked, and leaves a creeper alone.
function tameSays(bot, goal, { walk = () => '' } = {}) {
  const bones = countOf(bot, 'bone'), here = bot.entity.position;
  const near = wildWolf(bot, goal), far = near ? null : sightedWolf(bot, goal);
  const kept = (goal.wolves || []).filter(w => !w.lostAt).length;
  const where = near ? `the wolf in view, ${Math.round(near.position.distanceTo(here))} blocks off`
    : `the wolf seen ${far.minutesAgo ? `${far.minutesAgo} minute${far.minutesAgo === 1 ? '' : 's'} ago` : 'just now'}, ${far.distance} blocks ${far.direction} (${far.x}, ${far.z}), out of view now: walked to, and forgotten if it is not there`;
  const pct = n => Math.round(takes(n) * 100);
  return `Tame ${where}, with the ${bones} bone${bones === 1 ? '' : 's'} carried: each bone tames it one time in three, so ${bones === 1 ? 'one bone takes' : `${bones} bones take`} in ${pct(bones)} of tries${bones < 3 ? ` (three bones, ${pct(3)}; skeletons drop bones)` : ''}. A tamed wolf follows the bot and comes to it when it strays, fights whatever attacks the bot or whatever the bot strikes, goes for skeletons on its own, and does not attack a creeper. ${kept ? `${kept} tamed already; ${MOST} at most. ` : `${MOST[0].toUpperCase()}${MOST.slice(1)} at most. `}It is told to sit before a Nether or End crossing, and pets do not follow through a portal. Zombies (8), creepers (5), skeletons (3) and spiders (2) were 18 of the 23 deaths before the Nether in 2026-09-28's 62 fresh worlds; a wolf fights zombies that attack the bot and skeletons, not creepers. Costs the bones and the walk, nothing to keep.${walk(near ? near.position.distanceTo(here) : far.distance)}`;
}

// Walk to the wolf and feed it bones until it is tamed (a third of bones
// tame, on average) or the bones run out.
async function tameWolf(bot, task, goal, save, { navigate }) {
  let wolf = wildWolf(bot, goal);
  // Out of view: to where it was seen, and forgotten there if it is gone.
  if (!wolf) {
    const seen = sightedWolf(bot, goal);
    if (!seen) return false;
    goal.step = { action: 'tame_wolf', to: { x: seen.x, y: seen.y, z: seen.z }, bones: countOf(bot, 'bone') }; save();
    const found = await require('./sightings').walkToSighting(bot, task, goal, save, 'wolf', seen, navigate);
    wolf = found ? wildWolf(bot, goal) : null;
    if (!wolf) { setAside(goal, 'tame_wolf', `${seen.x},${seen.z}`, 'gone from where it was seen', 20 * 60 * 1000); save(); return false; }
  }
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
  if (bot.heldItem) { try { await require('./skills').emptyHand(bot); } catch (_) { /* toggling with an item works too */ } }
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

module.exports = { TAME_MAX, TRIP, takes, wild, sightedWolf, tameSays, tamed, sitting, myWolves, wildWolf, tameReady, tameWolf, commandWolves };

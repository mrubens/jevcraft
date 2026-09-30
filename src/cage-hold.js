'use strict';
// The fight at the cage (note 700): the blaze rods the work in hand and a
// live spawner within sixteen blocks, where it makes blazes while the bot
// stays. Being there is the plan, not the bot standing still.
//
// 25585 (mid-242-ca-fortress-13, 2026-09-29 22:50 to 23:05Z) boxed itself
// 2.2 blocks from the cage at (-204, 57, -150), took one blaze hit, and at
// 23:01:20 the stall watch sent it to stillness_detour, where work_free
// called its own box "walled in where it stands" with the goal "dry ground
// at least eight blocks away"; unstuck_move then dug down about thirty
// times, none_good on top, y 53 to y 37 through the fortress's foundation,
// 18 blazes in sight and no rod. Nothing in the stall's question said the
// box was the rod farm, and no answer opened it toward the cage or stayed.
//
// 25591 (mid-242-jb, 22:58Z), at good health beside the cage at (158, 64,
// 356) with a stone sword, was sent by upkeep's fetch_stems for 2 warped
// stems 396 blocks off with no route: the no-pickaxe lead (note 687) put
// the pickaxe first where the rods in hand need a sword.
const { Vec3 } = require('vec3');

const RANGE = 16;            // the spawner tries only with a player this near (BaseSpawner)
const HOLD_MS = 60000;       // a stay: every try comes within 40 s of the last
const HOLD_NEAR = 4;         // a stay held from about the spot it was chosen at
const SWORDS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword'];
const words = s => String(s || '').replaceAll('_', ' ');
const at3 = c => `(${c.x}, ${c.y}, ${c.z})`;
const hhmm = t => new Date(t).toISOString().slice(11, 16);
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));

function swordCarried(bot) {
  const names = new Set((bot?.inventory?.items?.() || []).map(i => i.name));
  return SWORDS.find(n => names.has(n)) || null;
}
// What Jev chose that put the bot at the cage, as the goal keeps it: a box or
// a hole built there (empty-spawner.js buildAndHold), a stand or a wait by
// it, or a stay chosen at a stall. -> { what, at } or null
function chosenThere(goal) {
  const built = goal?.emptySpawner?.built;
  const wait = goal?.fortressSearch?.spawnerWait;
  const hold = goal?.cageHold;
  const list = [
    built?.at && { what: `the ${words(built.key).replace(/^box (here|at spawner)$/, 'box')} built there`, at: built.at },
    wait?.startedAt && { what: wait.chosen === 'empty_spawner' ? 'the stand taken there' : 'the wait there', at: wait.startedAt },
    hold?.at && { what: `the ${words(hold.choice)} chosen there`, at: hold.at },
  ].filter(Boolean).sort((a, b) => b.at - a.at);
  return list[0] || null;
}
// -> { cage, off, need, sword, chosen, where } or null
function cageFight(bot, goal) {
  if (!bot?.entity?.position || !inNether(bot) || !goal) return null;
  let need = 0;
  try { need = require('./blaze-stand').rodsNeeded(bot, goal); } catch (_) { need = 0; }
  if (!(need > 0)) return null;
  let known = null;
  try { known = require('./empty-spawner').knownSpawner(bot, goal); } catch (_) { known = null; }
  if (!known || known.off > RANGE) return null;
  return { cage: known.cage, off: known.off, need, sword: swordCarried(bot), chosen: chosenThere(goal), where: `the spawner at ${at3(known.cage)}` };
}
const centre = cage => new Vec3(cage.x + 0.5, cage.y + 0.5, cage.z + 0.5);

// A stay at the cage Jev chose, while it runs and the bot is about where it
// was chosen: a wait, not the bot standing still (stillness.js stepWait).
// A box or a hole Jev chose to build by the cage (empty-spawner.js
// buildAndHold) is such a stay for its first minute too.
function holding(bot, goal, now = Date.now()) {
  if (!bot?.entity?.position) return null;
  const p = bot.entity.position;
  const near = h => !h.from || Math.hypot(p.x - h.from.x, p.y - h.from.y, p.z - h.from.z) <= HOLD_NEAR;
  const h = goal?.cageHold;
  if (h && h.until > now && near(h)) return h;
  const b = goal?.emptySpawner?.built;
  if (b?.at && now - b.at < HOLD_MS && near(b) && cageFight(bot, goal)) return { choice: b.key, at: b.at, until: b.at + HOLD_MS, from: b.from };
  return null;
}
// How the last stay went, said with the next offer of one.
function lastSays(goal, bot, now = Date.now()) {
  const h = goal?.cageHold;
  if (!h?.at || now - h.at > 10 * 60000) return '';
  const rods = require('./skills').countOf(bot, 'blaze_rod') - (h.rods || 0);
  return ` The last, ${words(h.choice)} at ${hhmm(h.at)}Z: ${rods > 0 ? `${rods} rod${rods === 1 ? '' : 's'} since` : 'no rod since'}.`;
}
function beginHold(bot, goal, save, choice, now = Date.now()) {
  const p = bot.entity.position.floored(), fight = cageFight(bot, goal);
  goal.cageHold = { choice, at: now, until: now + HOLD_MS, from: { x: p.x, y: p.y, z: p.z }, rods: require('./skills').countOf(bot, 'blaze_rod'), ...(fight ? { cage: { x: fight.cage.x, y: fight.cage.y, z: fight.cage.z } } : {}) };
  save?.();
  return goal.cageHold;
}

// The slit: the blocks on the line from the eyes to the cage, where one to
// three stand between and each comes away (the bot's own, or rock a carried
// tool or a hand takes). Dug, the cage and the blazes it puts beside it
// have a line in, one line, from the front. Every dig goes through the dig
// guard (terrain.js digExposes). -> { cells: [{ cell, name, own }], says } or
// null (the line open already, or not to be opened so).
const SLIT_MAX = 3, EYE = 1.62;
function slitLine(bot, cage) {
  const feet = bot.entity.position.floored();
  const from = new Vec3(bot.entity.position.x, feet.y + EYE, bot.entity.position.z), to = centre(cage);
  const len = from.distanceTo(to), steps = Math.ceil(len / 0.2);
  const seen = new Set(), cells = [];
  for (let n = 1; n < steps; n++) {
    const c = from.plus(to.minus(from).scaled(n / steps)).floored();
    const k = `${c}`;
    if (seen.has(k) || c.equals(cage)) continue;
    seen.add(k);
    const b = bot.blockAt?.(c);
    if (!b || b.boundingBox !== 'block') continue;
    if (/bedrock|obsidian|spawner|lava|chest/.test(b.name) || !(b.hardness >= 0) || b.hardness >= 50) return null;
    if (!require('./block-stock').handDigs(bot, b)) return null;
    let own = null; try { own = require('./own-blocks').laidAt(bot, c); } catch (_) { own = null; }
    cells.push({ cell: c, name: b.name, own });
    if (cells.length > SLIT_MAX) return null;
  }
  if (!cells.length) return null;
  const says = cells.map(x => `the ${words(x.name)} at ${at3(x.cell)}${x.own ? `, laid by the bot${Number.isFinite(x.own.at) ? ` at ${hhmm(x.own.at)}Z` : ''}` : ''}`).join('; ');
  return { cells, says };
}

// The stall's ways at the cage: open a slit toward it, stay and fight, or go
// to a blaze already out. `dig` as the work has it. -> { open_slit?,
// stay_and_fight?, go_to_blaze_about? }
function stallAnswers(bot, task, goal, save, fight, { dig, now = Date.now(), navigate = null } = {}) {
  const out = {};
  const clock = (() => { try { const sc = require('./spawner-clock'); return sc.clockSays(sc.nextTry(bot, fight.cage, now)); } catch (_) { return null; } })();
  const blazes = (() => { try { return require('./danger').threats(bot, RANGE).filter(t => t.entity.name === 'blaze'); } catch (_) { return []; } })();
  const unseen = blazes.filter(t => !t.visible).length;
  const about = blazes.length ? ` ${blazes.length} blaze${blazes.length === 1 ? '' : 's'} within 16${unseen ? `, ${unseen} out of sight` : ''}.` : '';
  // The cap: while it is met, no more come, whatever the delay says (note
  // 729: 25598 held a box 36+ minutes with 12 to 15 about, most out of
  // sight, and no option said the spawner had already given all it could
  // until some of those left or died).
  const cap = (() => { try { return require('./spawner-clock').capSays(bot, fight.cage, { threats: blazes }); } catch (_) { return null; } })();
  const last = lastSays(goal, bot, now);
  const slit = slitOption(bot, task, goal, save, fight, { dig, about });
  if (slit) out.open_slit = slit;
  out.stay_and_fight = { description: `Stay here, ${fight.off} blocks from the cage, a minute and fight what comes.${clock ? ` ${clock}.` : ''}${about}${cap ? ` ${cap}` : ''} ${fight.need} rod${fight.need === 1 ? '' : 's'} still needed.${last}`,
    run: async () => { bot.chat?.(`Staying at the spawner to fight: ${fight.need} more rod${fight.need === 1 ? '' : 's'} needed.`); beginHold(bot, goal, save, 'stay_and_fight'); } };
  // The rods already made are in the blazes already out, most of them
  // behind rock while the cap holds none more back: a line to the nearest
  // one, on foot, is the way on the cap itself does not offer.
  if (navigate) {
    const mh = require('./mob-hunt');
    const known = mh.blazesAbout(bot);
    const nearest = known.find(b => !b.visible) || known[0];
    if (nearest) {
      const p = nearest.entity.position.floored();
      out.go_to_blaze_about = { description: `Go to the nearest blaze already out, ${mh.blazesAboutSays(known)}, on foot, one at a time: the fight there is asked as it is met.${cap ? ` ${cap}` : ''}`,
        run: async () => { bot.chat?.('Going to a blaze already out, not waiting on the cage for more.');
          try { await navigate(bot, task, new (require('mineflayer-pathfinder').goals.GoalNear)(p.x, p.y, p.z, 3), { timeoutMs: 20000, stallMs: 5000 }); } catch (err) { task.check(); } } };
    }
  }
  return out;
}

// The slit as a way: said with what the bot then sees of where the blazes
// come (blaze-tactics.js spawnLine, note 708). -> option or null
function slitOption(bot, task, goal, save, fight, { dig, about = null } = {}) {
  const slit = slitLine(bot, fight.cage);
  if (!slit || !dig) return null;
  if (about === null) {
    const blazes = (() => { try { return require('./danger').threats(bot, RANGE).filter(t => t.entity.name === 'blaze'); } catch (_) { return []; } })();
    const unseen = blazes.filter(t => !t.visible).length;
    about = blazes.length ? ` ${blazes.length} blaze${blazes.length === 1 ? '' : 's'} within 16${unseen ? `, ${unseen} out of sight` : ''}.` : '';
  }
  let then = '';
  try {
    const T = require('./blaze-tactics');
    const l = T.spawnLine(bot, bot.entity.position.floored(), fight.cage, { open: slit.cells.map(x => x.cell) });
    then = ` Then it sees ${T.lineWords(l)}.`;
  } catch (_) { then = ''; }
  return { description: `Open a slit toward the cage: dig ${slit.cells.length === 1 ? 'the block' : `the ${slit.cells.length} blocks`} on the line from the eyes to it (${slit.says}), then stay a minute and fight what comes into that line.${then}${about}`,
    run: async () => {
      bot.chat?.(`Opening a slit toward the spawner and staying to fight: ${fight.need} more rod${fight.need === 1 ? '' : 's'} needed.`);
      for (const x of slit.cells) { task.check(); await dig(bot, task, x.cell, { requireDrops: false }); }
      beginHold(bot, goal, save, 'open_slit');
    } };
}

// Said on work_free at the cage: where it leads.
function workFreeSays(fight) {
  return ` It leads away from ${fight.where}, ${fight.off} blocks off, where the rods are fought for${fight.chosen ? `; the walls round it are ${fight.chosen.what} at ${hhmm(fight.chosen.at)}Z` : ''}.`;
}

// No pickaxe carried at the cage, a sword carried: the rods in hand need the
// sword, not a pickaxe. -> the words, or null
function swordNotPickaxe(bot, goal) {
  if ((bot?.inventory?.items?.() || []).some(i => /_pickaxe$/.test(i.name))) return null;
  const fight = cageFight(bot, goal);
  if (!fight?.sword) return null;
  const sword = words(fight.sword), off = `${fight.off} block${fight.off === 1 ? '' : 's'} off`;
  return { fight, lead: `No pickaxe is carried; the rods need a sword, not a pickaxe, and ${/^[aeiou]/.test(fight.sword) ? 'an' : 'a'} ${sword} is carried.`,
    leaves: `It leaves the spawner ${off}, where the rods are, and they need a sword, which is carried.`,
    makes: `The rods at the spawner ${off} need a sword, which is carried, not a pickaxe.`,
    carryOn: `Carry on with the fight at the spawner ${off}, with the ${sword}: a blaze needs a sword, not a pickaxe;` };
}

module.exports = { cageFight, holding, beginHold, stallAnswers, slitOption, workFreeSays, swordNotPickaxe, swordCarried, slitLine, chosenThere, RANGE, HOLD_MS, HOLD_NEAR };

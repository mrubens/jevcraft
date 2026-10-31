'use strict';
// A deliberate death to come back to life at the bed with a fresh start, as
// a route on the Nether's wood search when the bot stands with no pickaxe and
// no block (note 2173; the user, 2026-10-26 08:40Z: offer it, its cost said,
// never run unasked). full-7 spent 83% of a Nether stay with no pickaxe (note
// 2132), and of the day's 43 none_good answers on nether_gather, 41 were a
// bot that could neither dig nor span. What it costs: everything carried
// drops here and vanishes in five minutes (the rods and pearls among it), the
// respawn is at the bed last slept in or the world spawn, and the full runs'
// record puts the time from a death to the kit worn and held again at 73
// minutes (49 of 115 bot-hours in the day to 2026-10-26 08:00Z, 40 deaths).
// What the same spot has come to on the full runs (the decision records of 2026-10-25 06:00Z to 10-26 09:00Z): the
// spells in the Nether with no pickaxe and no block, read from the asks whose state said so, ten minutes apart at most.
const SPELLS = Object.freeze({ window: '2026-10-25 06:00Z to 10-26 09:00Z', count: 19, minutes: 239, median: 9, longest: 115, longestNoneGood: 60, died: 1, otherwise: 18 });
const spellsSays = () => `On the full runs (${SPELLS.window}) a bot stood in the Nether with no pickaxe and no block ${SPELLS.count} times, ${SPELLS.minutes} minutes in all (the median spell about ${SPELLS.median} minutes, the longest ${SPELLS.longest}, with ${SPELLS.longestNoneGood} 'none good' answers in it): ${SPELLS.died} of the ${SPELLS.count} ended in a death, ${SPELLS.otherwise} in a pickaxe or blocks got, or the portal reached, on the ground the bot could walk.`;
const REKIT = Object.freeze({ window: '2026-10-25 06:00Z to 10-26 08:00Z', deaths: 40, minutesEach: 73, shareOfTime: 43 });
const DEATH_WAIT_MS = 90000;
const words = s => String(s || '').replaceAll('_', ' ');

// Whether the way is on offer: the Nether, no pickaxe, no block, lava known within reach. -> { lava } or null
function offered(bot, goal, { lava = null } = {}) {
  if (!/nether/.test(String(bot.game?.dimension || ''))) return null;
  const items = bot.inventory?.items?.() || [];
  if (items.some(i => /_pickaxe$/.test(i.name))) return null;
  let blocks = 0; try { blocks = require('./bridging').blocksCarried(bot); } catch (_) { blocks = items.filter(i => /cobblestone|netherrack|dirt|planks|stone$/.test(i.name)).length; }
  if (blocks > 0) return null;
  if (!lava || !(lava.distance <= 64)) return null;
  return { lava };
}

// The option's words: the drop, the respawn, the lava, the record.
function says(bot, goal, { lava }) {
  const items = bot.inventory?.items?.() || [];
  const stacks = items.length;
  const valued = items.filter(i => /blaze_rod|ender_pearl|ender_eye|blaze_powder|diamond|gold_ingot|iron_ingot|_sword$|shield|_helmet$|_chestplate$|_leggings$|_boots$|bed$/.test(i.name)).map(i => `${i.count} ${words(i.name)}${i.count > 1 && !/s$/.test(i.name) ? 's' : ''}`);
  const sp = bot.spawnPoint, here = bot.entity?.position;
  const bed = goal?.survival?.spawnBed?.foot;
  const respawn = bed ? `the bed at (${bed.x}, ${bed.y}, ${bed.z}) in the Overworld` : sp ? `the world spawn at (${Math.round(sp.x)}, ${Math.round(sp.y)}, ${Math.round(sp.z)}) in the Overworld, with nothing` : 'the world spawn, with nothing';
  let worth = ''; try { worth = goal?.kind === 'win' ? ` ${require('./eye-need').says(bot, goal, { brief: true })}` : ''; } catch (_) { worth = ''; }
  // Priced both ways in minutes, the trade first (note 2409, the user 2026-10-28 18:2xZ: 'Yeah change it', on whether
  // Jev was weighing a death fairly): the option led with what drops and 'nothing is got back', its only time figure the
  // 73 minutes of a full kit made again, which is not what a bot with no pickaxe and no block has to lose; it was taken
  // once in four days, and only as the least bad (full-4, 2026-10-28 01:12Z, none good 0.75).
  const lost = valued.length ? `what is carried and not stashed is lost: ${valued.join(', ')}${stacks > valued.length ? `, and ${stacks - valued.length} other stack${stacks - valued.length === 1 ? '' : 's'}` : ''}` : `nothing of worth is carried: ${stacks} stack${stacks === 1 ? '' : 's'} of the rest drop${stacks === 1 ? 's' : ''} and vanish${stacks === 1 ? 'es' : ''}`;
  return `Die here on purpose and come back to life at ${respawn}, a position reset as speedrunners use it: walk into the lava ${lava.distance} blocks off at (${lava.at.x}, ${lava.at.y}, ${lava.at.z}) and stay in it, about ${Math.max(1, Math.round(lava.distance / 4.3 + 5))} seconds. The trade in minutes: with no pickaxe and no block the bot can only walk the ground here; ${(t => t.charAt(0).toLowerCase() + t.slice(1))(spellsSays().trim())} Dying, the bot stands at the bed in the Overworld within a minute, able to cut wood and make a pickaxe there in a few more; ${lost}. Where wood for a chest is carried, the armour, tools, iron, gold, diamonds, rods, pearls, eyes and food go into a chest here first and stay for the next trip. The Nether portal and this place are left as they are. For scale, a death that loses a whole kit cost about ${REKIT.minutesEach} minutes on the full runs (${REKIT.window}); a death here loses only what is listed.${worth}`;
}

// Carried out: the flag that stands the body's lava rule and the survival layer down for a minute and a half, the
// walk to the lava, the step in, and the wait for the death. -> true when the bot died.
async function run(bot, task, goal, save, { lava, navigate, move }) {
  { const kept = await stashFirst(bot, task, goal, save); console.log(`[respawn fresh] the goal's items before the chosen death: ${kept}`); }
  goal.deliberateDeath = { at: Date.now(), why: 'Jev chose to come back to life fresh (respawn_fresh)' }; save?.();
  bot.chat?.('Nothing to dig or span with here. Starting over from the bed.');
  const { goals } = require('mineflayer-pathfinder');
  const from = bot.entity?.position?.floored?.();
  try { await navigate(bot, task, new goals.GoalNear(lava.at.x, lava.at.y, lava.at.z, 2), { timeoutMs: 60000, stallMs: 8000 }); } catch (err) { task.check(); if (['Cancelled'].includes(err.name)) throw err; console.log(`[respawn fresh] the walk to the lava at (${lava.at.x}, ${lava.at.y}, ${lava.at.z}) from ${from}: ${String(err.message || err).slice(0, 140)}`); }
  const began = Date.now();
  while (Date.now() - began < DEATH_WAIT_MS && (bot.health ?? 0) > 0 && bot.isAlive !== false) {
    task.check();
    try { await move(bot, task, { label: 'respawn_fresh', keys: ['forward'], sneak: false, intoLava: true, why: 'into the lava, as Jev chose', look: new (require('vec3').Vec3)(lava.at.x + 0.5, lava.at.y + 0.5, lava.at.z + 0.5), maxMs: 1500, tick: 50, until: () => (bot.health ?? 0) <= 0 }); }
    catch (err) { if (err.name === 'Cancelled') throw err; }
  }
  return (bot.health ?? 0) <= 0 || bot.isAlive === false;
}

// The End's way (note 2236): no pickaxe and nothing to eat, so the health lost does not come back and no hole can be dug,
// with the island's edge known within reach -> { edge } or null. 25590's stronghold-1-dragon-328 (2026-10-26 16:44 to
// 16:49Z) stood five minutes at 1.3 health, hunger 11 to 9, 'nothing to eat ... none known', no pickaxe, one crystal left,
// with moves, shoot_dragon and observe its only options, and was slain by the body.
function offeredEnd(bot, goal, { edge = null } = {}) {
  if (!/end/.test(String(bot.game?.dimension || ''))) return null;
  const items = bot.inventory?.items?.() || [];
  if (items.some(i => /_pickaxe$/.test(i.name))) return null;
  let food = []; try { food = require('./healing').foodCarried(bot) || []; } catch (_) { food = []; }
  if (food.length || items.some(i => /cooked_|bread|apple|carrot|potato|melon_slice|chorus_fruit|beef|porkchop|mutton|chicken|rabbit|cod|salmon|rotten_flesh|stew|pie/.test(i.name))) return null;
  if (!edge || !(edge.distance <= 48)) return null;
  return { edge };
}
function saysEnd(bot, goal, { edge }, { dragonHealth = null } = {}) {
  const items = bot.inventory?.items?.() || [];
  const stacks = items.length;
  const valued = items.filter(i => /blaze_rod|ender_pearl|ender_eye|diamond|gold_ingot|iron_ingot|_sword$|bow$|arrow|shield|_helmet$|_chestplate$|_leggings$|_boots$|bed$|bucket|_boat$/.test(i.name)).map(i => `${i.count} ${words(i.name)}`).join(', ');
  const sp = bot.spawnPoint;
  const bed = goal?.survival?.spawnBed?.foot;
  const respawn = bed ? `the bed at (${bed.x}, ${bed.y}, ${bed.z}) in the Overworld` : sp ? `the world spawn at (${Math.round(sp.x)}, ${Math.round(sp.y)}, ${Math.round(sp.z)}) in the Overworld` : 'the world spawn in the Overworld';
  const health = Number(bot.health ?? 0).toFixed(1), hunger = bot.food ?? 20;
  // The trade first, in minutes, as the Nether's (note 2417, after 2409; the user 2026-10-28: 'Yes'): stuck on the island
  // with no pickaxe and nothing to eat against the walk back from the bed, what is lost by name, the whole kit's 73
  // minutes last and for scale.
  const lost = valued ? `what is carried and not stashed is lost at once in the void: ${valued}` : `nothing of worth is carried: ${stacks} stack${stacks === 1 ? '' : 's'} of the rest ${stacks === 1 ? 'is' : 'are'} lost in the void`;
  return `Die here on purpose and come back to life at ${respawn}, a position reset as speedrunners use it: walk off the island's edge ${edge.distance} blocks ${edge.side} at (${edge.at.x}, ${edge.at.z}) into the void, about ${Math.max(2, Math.round(edge.distance / 4.3 + 2))} seconds. The trade in minutes: here, with no pickaxe and nothing to eat, health ${health} at hunger ${hunger} does not come back and no hole can be dug, and the End has no food but chorus fruit on the outer islands; dying, the bot stands at the bed in the Overworld within a minute, where food and a pickaxe are minutes away, and the stronghold's portal stays open for the way back in. ${lost.charAt(0).toUpperCase() + lost.slice(1)}. Where wood for a chest is carried, the armour, tools, iron, gold, diamonds, rods, pearls, eyes and food go into a chest here first. The dragon keeps its health${dragonHealth != null ? ` (${Math.round(dragonHealth)} of 200)` : ''}. For scale, a death that loses a whole kit cost about ${REKIT.minutesEach} minutes on the full runs (${REKIT.deaths} deaths, ${REKIT.window}); a death here loses only what is listed.`;
}
async function runEnd(bot, task, goal, save, { edge, navigate, move }) {
  { const kept = await stashFirst(bot, task, goal, save); console.log(`[respawn fresh] the goal's items before the chosen death: ${kept}`); }
  goal.deliberateDeath = { at: Date.now(), why: 'Jev chose to come back to life fresh from the End (respawn_fresh)' }; save?.();
  bot.chat?.('No pickaxe and nothing to eat here. Starting over from the bed.');
  const { goals } = require('mineflayer-pathfinder');
  const { Vec3 } = require('vec3');
  const y = Math.floor(bot.entity.position.y);
  try { await navigate(bot, task, new goals.GoalNear(edge.at.x, y, edge.at.z, 1), { timeoutMs: 60000, stallMs: 8000 }); } catch (err) { task.check(); if (['Cancelled'].includes(err.name)) throw err; }
  const began = Date.now(), beyond = new Vec3(edge.at.x + edge.dx * 3 + 0.5, y + 1.6, edge.at.z + edge.dz * 3 + 0.5);
  while (Date.now() - began < DEATH_WAIT_MS && (bot.health ?? 0) > 0 && bot.isAlive !== false) {
    task.check();
    try { await move(bot, task, { label: 'respawn_fresh', keys: ['forward', 'sprint'], sneak: false, why: 'off the island\'s edge into the void, as Jev chose', look: beyond, maxMs: 1500, tick: 50, intoFall: true, acrossGap: true, until: () => bot.entity.position.y < y - 3 }); }
    catch (err) { if (err.name === 'Cancelled') throw err; }
    if (bot.entity.position.y < y - 3) { for (let i = 0; i < 400 && (bot.health ?? 0) > 0 && bot.isAlive !== false; i++) await new Promise(r => setTimeout(r, 100)); break; }
  }
  return (bot.health ?? 0) <= 0 || bot.isAlive === false;
}

// The goal's items put in a chest where the bot stands before the chosen death (note 2251; the user, 2026-10-26:
// 'Jev could even make a chest to store stuff before dying to save time'): rods, powder, pearls and eyes dropped at a
// death in lava or the void are gone at once, and a chest beside the spot keeps them for the walk back (rod-stash.js
// collects them). Made from wood carried; none carried, it is said and the death goes on as chosen.
async function stashFirst(bot, task, goal, save) {
  const RS = require('./rod-stash'), W = require('./work');
  // Everything of worth, not the goal's items alone (the user, 2026-10-26: 'It should probably stash anything valuable?'):
  // the armour taken off first (worn, it drops at the death too), then what the run would remake after a death.
  for (const slot of ['head', 'torso', 'legs', 'feet']) { try { await bot.unequip?.(slot); } catch (_) { /* kept on */ } }
  const VALUED = /^(blaze_rod|blaze_powder|ender_pearl|ender_eye|diamond|emerald|obsidian|flint_and_steel|bow|crossbow|arrow|shield|bucket|water_bucket|lava_bucket|golden_apple|golden_carrot|bread|cake)$|^(iron|gold|raw_iron|raw_gold|copper)_(ingot|block|nugget)$|^raw_(iron|gold)$|^(diamond|iron|netherite|golden|chainmail|stone)_(helmet|chestplate|leggings|boots|sword|pickaxe|axe|shovel)$|^netherite_|_bed$|^cooked_|^enchanted_/;
  const names = [...new Set((bot.inventory?.items?.() || []).map(i => i.name).filter(n => VALUED.test(n)))];
  const what = names.map(n => ({ item: n, count: RS.countOf(bot, n) })).filter(w => w.count > 0);
  if (!what.length) return 'nothing to keep';
  const site = RS.chestCell(bot, { underFire: true }), making = RS.chestMaking(bot);
  if (!site) return 'no cell for a chest within reach';
  if (!making) return 'no chest carried and not wood enough for one';
  try {
    const ok = await RS.stashRods(bot, task, goal, save, { acquireStep: W.acquireStep, place: W.place }, { site, making, what, names }, { step: 'stash_before_respawn', rest: ['respawn_stash', 'here'], chat: (items, where) => `Left ${items} in a chest at ${where} before starting over.` });
    if (ok) { const e = (goal.rodStashes || []).find(x => x.position && x.position.x === site.cell.x && x.position.y === site.cell.y && x.position.z === site.cell.z); if (e) { e.all = true; save?.(); } }
    return ok ? `kept in a chest at (${site.cell.x}, ${site.cell.y}, ${site.cell.z})` : 'the chest was not filled';
  } catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return String(err.message || err).slice(0, 80); }
}

// Whether the flag stands now (the lava rule and the survival step read it).
const standing = (goal, now = Date.now()) => !!goal?.deliberateDeath && now - goal.deliberateDeath.at < DEATH_WAIT_MS;

module.exports = { offered, says, run, standing, spellsSays, SPELLS, REKIT, DEATH_WAIT_MS, offeredEnd, saysEnd, runEnd };

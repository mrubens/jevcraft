'use strict';
// An errand away from a known fortress, said with what it leaves (note 702).
//
// 25590 (mid-242-kb, 2026-09-29 23:43Z) stood 52 blocks from its fortress at
// (226, 43, 242), 14 health, hunger 10 and nothing to eat, and upkeep's
// fetch_stems (0.57) sent it for stems at (145, 43, 105), 140 blocks off: the
// option said the wood and the forests, not that the fortress was the work
// and would be 140 blocks behind, nor that the walk went at a health that
// would not come back. A hit took 4 on the way and a hoglin and a ghast held
// it at (163, 35, 114). Note 700 said the leaving only at a live spawner;
// here it is said wherever a fortress is known and the rods are wanted.
// And a hoglin in reach there, with nothing to eat, is the food (note 682's
// hoglin facts).

const { Vec3 } = require('vec3');
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));
const r = n => Math.round(n);
const r1 = n => Math.round(n * 10) / 10;

// The fortress the work is going to, as the search keeps it. -> Vec3 or null
function fortressAt(goal) {
  const fs = goal?.fortressSearch;
  const f = fs?.approach?.found || fs?.found;
  return f && Number.isFinite(f.x) && Number.isFinite(f.z) ? new Vec3(f.x, Number.isFinite(f.y) ? f.y : 64, f.z) : null;
}
function rodsWanted(bot, goal) {
  try { return require('./blaze-stand').rodsNeeded(bot, goal) > 0; } catch (_) { return false; }
}
// Health and hunger it walks with, and whether health comes back on the way.
function walksWith(bot) {
  const health = r1(bot.health ?? 20), hunger = bot.food ?? 20;
  let points = 0;
  try { points = require('./foraging').foodSupply(bot); } catch (_) { points = 0; }
  const back = hunger >= 18 ? 'health comes back on the way' : points > 0 ? `health comes back once the ${points} food points carried are eaten` : 'nothing to eat carried: health does not come back on the way';
  return `It walks with ${health} health and hunger ${hunger}; ${back}.`;
}
// -> the words, or null where no fortress is known or the rods are not wanted.
// `to`: where the errand goes (a Vec3-like), when known.
function awaySays(bot, goal, to = null) {
  if (!bot?.entity?.position || !inNether(bot) || !rodsWanted(bot, goal)) return null;
  const fort = fortressAt(goal);
  if (!fort) return null;
  const here = bot.entity.position;
  const now = r(fort.distanceTo(here));
  const there = to && Number.isFinite(to.x) ? r(fort.distanceTo(new Vec3(to.x, Number.isFinite(to.y) ? to.y : here.y, to.z))) : null;
  const leaves = there != null
    ? `It takes the bot from the fortress ${now} blocks off now to ${there} blocks from it, and the way back after is as far.`
    : `The fortress is ${now} blocks off now; the errand leaves it.`;
  return `${leaves} ${walksWith(bot)}`;
}
// The same, as a fact for a question's state.
function awayFacts(bot, goal) {
  if (!bot?.entity?.position || !inNether(bot) || !rodsWanted(bot, goal)) return null;
  const fort = fortressAt(goal);
  if (!fort) return null;
  return { blocksOff: r(fort.distanceTo(bot.entity.position)), at: { x: fort.x, y: fort.y, z: fort.z }, walksWith: walksWith(bot) };
}

// A hoglin within `reach` when food is what the bot lacks (nothing to eat
// carried, or hunger under 18 with too little to fill it): killed, it is the
// food. -> the words, or null
const HOGLIN_REACH = 16;
function hoglinFoodSays(bot, danger = null) {
  if (!bot?.entity?.position || !inNether(bot)) return null;
  const hunger = bot.food ?? 20;
  let points = 0;
  try { points = require('./foraging').foodSupply(bot); } catch (_) { points = 0; }
  const lacking = points === 0 || (hunger < 18 && points < 20 - hunger);
  if (!lacking) return null;
  const list = (danger || Object.values(bot.entities || {}).filter(e => e?.name === 'hoglin' && e.position).map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position) })))
    .filter(t => t.entity?.name === 'hoglin' && t.distance <= HOGLIN_REACH).sort((a, b) => a.distance - b.distance);
  if (!list.length) return null;
  return ` The hoglin ${r1(list[0].distance)} blocks off is food: 2 to 4 porkchops (3 hunger each raw, 8 cooked) when killed; ${points ? `${points} food points` : 'nothing to eat'} carried at hunger ${hunger}${hunger < 18 ? ', and health does not come back until something is eaten' : ''}.`;
}

module.exports = { fortressAt, awaySays, awayFacts, walksWith, hoglinFoodSays, HOGLIN_REACH };

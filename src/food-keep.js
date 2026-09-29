'use strict';
// Food that leaves the pockets (note 690). On 25598 at 18:59:27 the bot
// looted a fortress chest with its pockets full and Jev, asked what to drop
// for a gold ingot, dropped the 12 cooked beef and then the 3 cooked mutton
// (inventory_drop, logged only as "[room] for gold_ingot: Jev chose
// drop_15"); a second later restock_food was asked with nothing to eat.
// Note 664 counted 6,608 food points leaving packs with no eating and no
// death over two days. The ways food left: dropped for room (the room
// question offered every food stack), put in the stash chest over the kit's
// twelve points (also on the valuables trip before the Nether), and packed
// into a chest before a bastion raid in the Nether.
//
// The rule, physical and not a judgment: where the food carried is all
// there is, it stays in the pockets. In the Nether that is always (no
// animal there reliably gives meat: none of 66 hoglin hunts on 2026-09-28
// brought any, note 664); in the Overworld it is while the Nether crossing
// is ahead on the game's ladder, whose stay eats what is carried. Anywhere
// else food may go, and when it does it is said.
const { safeFood } = require('./vitals');

const words = name => String(name).replaceAll('_', ' ');
const nether = bot => /nether/.test(String(bot?.game?.dimension || ''));
const overworld = bot => /overworld/.test(String(bot?.game?.dimension || 'overworld'));
const isFood = (bot, name) => { try { return safeFood(bot, { name }); } catch (_) { return false; } };
const pointsOf = (bot, name) => bot?.registry?.foodsByName?.[name]?.foodPoints || 0;

// The game's ladder has the crossing ahead: it is being prepared for, or
// the next step is to enter the Nether (the rods are still wanted).
function crossingAhead(bot, goal) {
  if (!goal || !overworld(bot)) return false;
  if (goal.preparingNether) return true;
  if (goal.kind !== 'win') return false;
  try {
    const stage = require('./game-progress').nextGameStage(bot, goal);
    return stage?.action === 'enter_nether' || stage?.phase === 'reach_nether';
  } catch (_) { return false; }
}

// Why the food carried stays in the pockets here, or null where it may go.
function foodStays(bot, goal = bot?._goal) {
  if (nether(bot)) return 'in the Nether the food carried is all there is: nothing there reliably gives meat, and more is a trip home';
  if (crossingAhead(bot, goal)) return 'the Nether crossing is ahead, and the stay there eats only what is carried';
  return null;
}

// "12 cooked beef (96 food points)", for moves or stacks of food.
function foodSays(bot, moves) {
  const food = (moves || []).filter(m => isFood(bot, m.item || m.name));
  if (!food.length) return null;
  const counts = {};
  for (const m of food) { const n = m.item || m.name; counts[n] = (counts[n] || 0) + m.count; }
  const points = Object.entries(counts).reduce((s, [n, c]) => s + c * pointsOf(bot, n), 0);
  return `${Object.entries(counts).map(([n, c]) => `${c} ${words(n)}`).join(', ')} (${points} food points)`;
}

// Food points carried, the safe kinds.
function carriedPoints(bot) {
  return (bot?.inventory?.items?.() || []).filter(i => isFood(bot, i.name)).reduce((s, i) => s + i.count * pointsOf(bot, i.name), 0);
}

module.exports = { foodStays, crossingAhead, foodSays, carriedPoints, isFood };

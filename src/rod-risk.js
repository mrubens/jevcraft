'use strict';
// The rods at risk (note 759): what a death now costs the blaze-rod stage,
// said with every question in the Nether while rods are carried. 25588
// (mid-242-zh, 2026-09-30 16:32Z) carried 5 of the 7 rods its goal wanted
// among eight blazes; its hunt_target, encounter_stance and body_way said
// "5 of 7 carried" on the hunt option at most, and nothing of what a death
// there would take. It died at 1.8 health burning, and the 5 rods with it.
//
// The record (scripts/rod-stage.js over the flight records 2026-09-29T23:00Z
// to 2026-09-30T17:00Z): every life that carried a rod in the Nether, by the
// most it carried, and how it ended; a life went on across a deploy's
// restart. None carried a rod out of the Nether in that window.
const RECORD = Object.freeze({ from: '2026-09-29T23:00Z', to: '2026-09-30T17:00Z', lives: 80, died: 70, out: 0, rodsLost: 183,
  // k: [lives that carried k or more, died with them, carried out]
  reached: { 1: [80, 70, 0], 2: [55, 49, 0], 3: [36, 32, 0], 4: [19, 17, 0], 5: [13, 13, 0], 6: [7, 7, 0], 7: [2, 2, 0] } });

const countOf = (bot, name) => (bot?.inventory?.items?.() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The record's row for `k` rods carried, said.
function recordSays(k) {
  const r = RECORD.reached[Math.max(1, Math.min(7, k))], at = Math.max(1, Math.min(7, k));
  return `In the trials of ${RECORD.from} to ${RECORD.to}, ${r[0]} lives carried ${at} or more rods in the Nether: ${r[1]} died with them${r[2] ? `, ${r[2]} carried them out` : ', none carried them out'}${r[0] - r[1] - r[2] > 0 ? ` (${r[0] - r[1] - r[2]} ended with the trial)` : ''}.`;
}

// In the Nether with a rod or its powder carried and rods still wanted: what
// a death drops, what the chests hold, and the record. Null otherwise.
function risk(bot, goal) {
  if (!bot?.inventory || !inNether(bot)) return null;
  const rods = countOf(bot, 'blaze_rod'), powder = countOf(bot, 'blaze_powder'), pearls = countOf(bot, 'ender_pearl');
  const carried = rods + Math.floor(powder / 2);
  if (!carried) return null;
  let n = null; try { n = require('./eye-need').need(bot, goal || {}); } catch (_) { n = null; }
  if (n && !n.rodsWanted) return null;
  const inChest = n?.stashed?.rods || 0;
  const drops = [plural(rods, 'blaze rod'), powder ? `${powder} blaze powder` : null, pearls ? plural(pearls, 'ender pearl') : null].filter(Boolean).join(', ');
  const of = n ? `, ${n.rodsWanted} wanted${inChest ? `, ${inChest} more in a chest` : ''}; ${n.rodsLeft ? `${n.rodsLeft} still needed` : 'none still needed'}` : '';
  const keep = keepSays(bot, goal);
  const says = `${plural(carried, 'rod')} carried${of}. A death here drops the ${drops} where the bot falls (lava burns them, on the ground they vanish five minutes after) and it comes back to life in the Overworld. ${recordSays(carried)}${keep ? ` ${keep}` : ''}`;
  return { carried, inChest, wanted: n?.rodsWanted ?? null, left: n?.rodsLeft ?? null, keep, says };
}

// What could keep them here: a chest carried, the wood for one, one of the
// bot's own known near. Of the 34 blaze deaths that dropped 2 or more rods in
// the record's window, 24 carried neither a chest nor the wood for one
// (25588 among them): stash_rods could not be offered at all.
function keepSays(bot, goal) {
  const items = bot?.inventory?.items?.() || [];
  const sum = re => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
  if (sum(/^chest$/)) return 'A chest is carried to keep them in (stash_rods).';
  let near = null; try { near = bot.entity ? require('./rod-stash').nearStash(bot, goal) : null; } catch (_) { near = null; }
  if (near) return `The bot's chest ${Math.round(near.d)} blocks off can keep them (stash_rods).`;
  const table = sum(/^crafting_table$/) > 0, wood = sum(/_planks$/) + 4 * sum(/_(log|stem|wood|hyphae)$/);
  if (wood >= (table ? 8 : 12)) return 'No chest is carried; the wood carried makes one to keep them in (stash_rods).';
  return 'No chest is carried and no wood to make one (8 planks, and 4 more for a table): nothing here keeps them, and every rod carried is lost with a death.';
}

module.exports = { RECORD, risk, recordSays, keepSays };

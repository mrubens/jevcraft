'use strict';
// Which pickaxe digs and which is kept whole, the pockets read whole, and
// what became of the last spare (note 779).
//
// Measured over the flight records from 2026-09-30 12:00Z to 2026-10-01 05Z
// (scripts/pickaxe-ledger.js): of 1,178 pickaxes made beside another sound
// one (stone or better, 24 uses or more: the crossing kit's spare), 322 were
// worn under 24 while carried, 291 of them with the other sound one still
// carried, a median 6.6 minutes after they were made. The digging tool was
// the cheapest that harvests (skills.js cheapestTool, the dream run's rule),
// so a stone spare beside an iron pickaxe was dug with first: 25581's spare
// went from 131 uses to 3 in twelve minutes and the kit's pickaxe rung
// opened again with the iron one carried whole. 85,534 of 218,542 uses were
// spent by a lower tier while a better sound one was carried.
//
// The rule: of the sound pickaxes carried, the one made last beside another
// is the spare, and digging uses the others first (the cheapest of them that
// harvests, as before); the spare digs only a block none of the others
// harvests, or once it is the only sound one left, when it is the pickaxe in
// use and no longer a spare. What wore it, and how it left the kit's count,
// is kept and said where another spare is weighed.

const SOUND_USES = 24; // crossing-kit.js SPARE_PICKAXE_DURABILITY
const PICK_TIER = { stone: 2, copper: 2, iron: 3, diamond: 4, netherite: 5 };
const words = s => String(s || '').replaceAll('_', ' ');
const LAST_KEEP_MS = 60 * 60000;

// The pockets read whole: the item list and what sits outside it for a
// moment, the cursor and the pockets' own crafting grid (slots 1 to 4). A
// pickaxe picked up by a click or left in the grid is still carried.
function carriedItems(bot) {
  const inv = bot?.inventory;
  const items = inv?.items?.() || [];
  const extra = [];
  if (inv?.selectedItem) extra.push(inv.selectedItem);
  for (let slot = 1; slot <= 4; slot++) { const it = inv?.slots?.[slot]; if (it) extra.push(it); }
  return extra.length ? [...items, ...extra] : items;
}

function usesOf(bot, item) {
  const max = bot?.registry?.itemsByName?.[item?.name]?.maxDurability;
  return max ? max - (item.durabilityUsed || 0) : Infinity;
}
const tierOf = name => PICK_TIER[(/^(\w+)_pickaxe$/.exec(name || '') || [])[1]] || 0;
const sound = (bot, item) => tierOf(item.name) >= 2 && usesOf(bot, item) >= SOUND_USES;
const pickaxes = bot => carriedItems(bot).filter(i => /_pickaxe$/.test(i.name));
const soundPickaxes = bot => pickaxes(bot).filter(i => sound(bot, i));

// What the bot is doing, for the wear's record.
function doing(bot, goal) {
  return bot?._survivalGoal?.step?.action || goal?.step?.action || bot?._goal?.step?.action || 'other';
}

function endSpare(goal, tag, ended, now = Date.now()) {
  goal.pickaxeSpareLast = { ...tag, ended, endedAt: now };
  delete goal.pickaxeSpare;
}

// The spare carried now, settled against the pockets: its wear since last
// read is put to what the bot is doing; one gone, worn under a spare's uses
// or left the only sound one ends its tag, with why. Null when there is none.
function spareOf(bot, goal = bot?._goal, now = Date.now()) {
  const tag = goal?.pickaxeSpare;
  if (!tag || !bot?.inventory?.items) return null;
  // Pockets not read yet (a join, a respawn's first ticks) settle nothing.
  if (!carriedItems(bot).length) return null;
  const same = pickaxes(bot).filter(i => i.name === tag.name && usesOf(bot, i) <= tag.uses);
  // The one with the most uses at or under what the spare had: kept whole,
  // it is the fullest of its name.
  const item = same.sort((a, b) => usesOf(bot, b) - usesOf(bot, a))[0] || null;
  if (!item) {
    const more = pickaxes(bot).some(i => i.name === tag.name);
    endSpare(goal, tag, tag.uses <= 2 ? `broke at ${tag.uses} uses` : `left the pockets with ${tag.uses} uses${more ? ` (another ${words(tag.name)} is carried with more)` : ''}`, now);
    return null;
  }
  const uses = usesOf(bot, item);
  if (uses < tag.uses) {
    const by = doing(bot, goal);
    tag.wornBy = { ...(tag.wornBy || {}) };
    tag.wornBy[by] = (tag.wornBy[by] || 0) + (tag.uses - uses);
    if (tag.others) tag.wornWithOther = (tag.wornWithOther || 0) + (tag.uses - uses);
    tag.uses = uses;
  }
  const others = soundPickaxes(bot).filter(i => i !== item);
  tag.others = others.length;
  if (uses < SOUND_USES) { endSpare(goal, tag, `worn under ${SOUND_USES} uses (${uses} left)`, now); return null; }
  if (!others.length) { endSpare(goal, tag, `became the pickaxe in use, the other no longer sound`, now); return null; }
  return item;
}

// A pickaxe just made beside another sound one is the spare.
function noteMade(bot, goal, name, why = null, now = Date.now()) {
  if (!goal || !/_pickaxe$/.test(name || '')) return null;
  const max = bot?.registry?.itemsByName?.[name]?.maxDurability;
  if (!max) return null;
  spareOf(bot, goal, now);
  const made = pickaxes(bot).filter(i => i.name === name && usesOf(bot, i) === max);
  if (!made.length) return null;
  const others = soundPickaxes(bot).filter(i => i !== made[0]);
  if (!others.length || tierOf(name) < 2) return null;
  // A spare still carried and sound beside the new one becomes a pickaxe in
  // use: the newest is kept whole.
  if (goal.pickaxeSpare) endSpare(goal, goal.pickaxeSpare, `made the pickaxe in use when another spare was made`, now);
  goal.pickaxeSpare = { name, uses: max, made: max, at: now, why: why || null, wornBy: {}, others: others.length,
    beside: others.map(i => `${words(i.name)} (${usesOf(bot, i)} uses)`).join(', ') };
  return goal.pickaxeSpare;
}

// The spare kept whole, said; and what became of the last one.
function spareSays(bot, goal, now = Date.now()) {
  if (!goal) return '';
  const spare = spareOf(bot, goal, now);
  const parts = [];
  const wornSays = tag => {
    const list = Object.entries(tag.wornBy || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${words(k)} ${n}`);
    return list.length ? ` (${list.join(', ')})` : '';
  };
  const mins = ms => Math.max(1, Math.round(ms / 60000));
  if (spare) {
    const tag = goal.pickaxeSpare;
    parts.push(`The spare, ${words(tag.name)} with ${tag.uses} uses, is kept whole: digging uses the other pickaxes first, and the spare only a block none of them harvests or once it is the only sound one${tag.made - tag.uses > 0 ? `; ${tag.made - tag.uses} of its uses were spent since it was made ${mins(now - tag.at)} minutes ago${wornSays(tag)}` : ''}.`);
  }
  const last = goal.pickaxeSpareLast;
  if (last && now - last.endedAt <= LAST_KEEP_MS) {
    const spent = (last.made || 0) - (last.uses || 0);
    parts.push(`The last spare, ${/^iron/.test(last.name) ? 'an' : 'a'} ${words(last.name)} made ${mins(now - last.at)} minutes ago${last.beside ? ` beside ${last.beside}` : ''}, ${last.ended} ${mins(now - last.endedAt)} minutes ago${spent > 0 ? `; ${spent} of its ${last.made} uses were dug${wornSays(last)}${last.wornWithOther ? `, ${last.wornWithOther} of them with another sound pickaxe carried` : ''}` : ''}.`);
  }
  return parts.join(' ');
}

module.exports = { carriedItems, usesOf, soundPickaxes, spareOf, noteMade, spareSays, SOUND_USES, LAST_KEEP_MS };

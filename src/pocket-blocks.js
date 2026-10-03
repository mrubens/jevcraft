'use strict';
// Blocks made from what is carried (note 1029): nine coal a coal block,
// four glowstone dust a glowstone, nine raw copper a block of it, four
// quartz a quartz block. A span's end with nothing to lay and no pickaxe to
// dig more is short only of blocks, and a player there crafts them from the
// pack. 25594 (mid-243-kc-fortress-8, 2026-10-03 09:00 to 09:20Z), two blaze
// rods carried, stood at the end of its own span 20 cells of open air from
// the basalt ahead, no pickaxe, "0 blocks carried", with 132 coal, 19
// glowstone dust, 19 raw copper and a crafting table in its pack: 20 blocks'
// worth. It was asked 72 questions in fifteen minutes, 38 answered none good.
const KEEP_COAL = 8;
// [what is carried, how many make one, the block, whether the recipe wants a table (three by three)]
const RECIPES = [['coal', 9, 'coal_block', true], ['glowstone_dust', 4, 'glowstone', false], ['raw_copper', 9, 'raw_copper_block', true], ['quartz', 4, 'quartz_block', false]];
const BLOCKS = RECIPES.map(r => r[2]);
const CRAFT_SECONDS = 2, TABLE_SECONDS = 3;
const countOf = (bot, name) => (bot?.inventory?.items?.() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const words = n => String(n).replaceAll('_', ' ');

// What the pockets make. -> { makes: [{ block, count, from, each, used, carried }], total, seconds, table } or null
function offer(bot) {
  if (!bot?.inventory) return null;
  const items = bot.inventory.items();
  const table = countOf(bot, 'crafting_table') > 0 || items.filter(i => /_planks$/.test(i.name)).reduce((n, i) => n + i.count, 0) + 4 * items.filter(i => /_(log|stem|wood|hyphae)$/.test(i.name)).reduce((n, i) => n + i.count, 0) >= 4;
  const makes = [];
  for (const [from, each, block, wantsTable] of RECIPES) {
    if (wantsTable && !table) continue;
    const carried = countOf(bot, from), spare = from === 'coal' ? Math.max(0, carried - KEEP_COAL) : carried;
    const count = Math.floor(spare / each);
    if (count) makes.push({ block, count, from, each, used: count * each, carried, table: wantsTable });
  }
  const total = makes.reduce((n, m) => n + m.count, 0);
  if (!total) return null;
  const needsTable = makes.some(m => m.table);
  return { makes, total, table: needsTable, seconds: makes.length * CRAFT_SECONDS + (needsTable ? TABLE_SECONDS : 0) };
}

function says(bot, o, { carried = null, short = null } = {}) {
  const list = o.makes.map(m => `${plural(m.count, words(m.block))} from ${m.used} of the ${m.carried} ${words(m.from)} (${m.each} each${m.from === 'coal' ? `, ${KEEP_COAL} kept for fuel` : ''})`).join(', ');
  const have = carried == null ? '' : ` ${carried === 0 ? 'None is' : `${carried} ${carried === 1 ? 'is' : 'are'}`} carried now.`;
  const enough = short == null ? '' : ` The way ahead is short of ${plural(short, 'block')}: ${o.total + (carried || 0) >= short ? 'these cover it' : `these leave it ${short - o.total - (carried || 0)} short`}.`;
  return `Make blocks to lay from what is carried: ${list}: ${plural(o.total, 'block')} in about ${o.seconds} seconds${o.table ? ' at a crafting table set down here' : ' in the hand'}, with no walk and nothing dug. They are laid as any block is (a coal block burns where fire reaches it; glowstone and the others do not).${have}${enough}`;
}

// Craft them, one kind at a time. -> the blocks made
async function run(bot, task, goal, save, o, { acquireStep } = {}) {
  const step = acquireStep || require('./work').acquireStep;
  let made = 0;
  for (const m of o.makes) {
    const want = countOf(bot, m.block) + m.count;
    goal.step = { action: 'blocks_from_pockets', item: m.block, count: m.count }; save?.();
    for (let i = 0; i < 4 && countOf(bot, m.block) < want; i++) {
      task?.check?.();
      const before = countOf(bot, m.block);
      try { await step(bot, task, m.block, want, goal, save); }
      catch (err) { task?.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[blocks] the ${words(m.block)} was not made: ${String(err.message || err).slice(0, 160)}`); break; }
      if (countOf(bot, m.block) === before && i >= 1) break;
    }
    made += Math.max(0, countOf(bot, m.block) - (want - m.count));
  }
  console.log(`[blocks] ${made} of ${o.total} blocks made from the pack`);
  return made;
}

module.exports = { RECIPES, BLOCKS, KEEP_COAL, offer, says, run };

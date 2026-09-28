'use strict';

// The stock of blocks as a finite thing, said where it is one (note 642).
// mid-243-ah-fortress-7 (25589) began at a fortress with 90 blocks and no
// pickaxe, spent all of them in three minutes on two crossings of the lava
// sea (each priced "N left after", the last "0 left after"), and stood on
// 15 blocks of its own span for the rest of three hours: no block is dug
// without a pickaxe (rock, basalt, netherrack and bricks drop nothing by
// hand, and a laid block taken up drops nothing either), so every way that
// needed a block stopped at its first gap. The options said what they
// spent; none said that with no pickaxe it was never renewed, and no
// question after said the stock was gone or what would make it again.

const carriedOf = (bot, re) => (bot.inventory?.items?.() || []).filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
const pickaxeCarried = bot => carriedOf(bot, /_pickaxe$/) > 0;
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));

const NO_RETURN = 'No pickaxe is carried, so no block comes back: rock, basalt, netherrack and bricks dug by hand drop nothing, and a block laid and taken up drops nothing.';

// After a way that lays blocks: what is left is all there will be, and what
// none left means. `noPickaxe` is on every survey (bridging.js
// surveyCrossing, nether-travel.js surveyLeg).
function afterSays({ noPickaxe, left }) {
  if (!noPickaxe) return '';
  if (left <= 0) return ` ${NO_RETURN} After it none is left to lay, and none can be had here: every way from where it ends that lays a block (a gap crossed, a climb built) is closed until a pickaxe is made, and the floor already laid or standing is all the floor there is.`;
  return ` No pickaxe is carried: none of the ${left} left comes back or can be dug.`;
}

// What making a pickaxe takes and what is carried toward it: three planks,
// cobblestone, blackstone or iron ingots and two sticks, at a crafting
// table (four planks; a log or stem makes four planks).
function makingSays(bot) {
  const planks = carriedOf(bot, /_planks$/), logs = carriedOf(bot, /_(log|stem|hyphae|wood)$/), sticks = carriedOf(bot, /^stick$/);
  const heads = { 'iron ingots': carriedOf(bot, /^iron_ingot$/), cobblestone: carriedOf(bot, /^(cobblestone|cobbled_deepslate)$/), blackstone: carriedOf(bot, /^blackstone$/) };
  const table = carriedOf(bot, /^crafting_table$/) > 0;
  const woodPlanks = planks + logs * 4;
  const carried = Object.entries(heads).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
  const needPlanks = (table ? 0 : 4) + (sticks >= 2 ? 0 : 2);
  return `A pickaxe is three planks, cobblestone, blackstone or iron ingots and two sticks made at a crafting table (four planks; a log or stem makes four planks). Carried: ${carried.join(', ') || 'none of the three heads'}; ${sticks} stick${sticks === 1 ? '' : 's'}; ${planks} plank${planks === 1 ? '' : 's'}${logs ? ` and ${logs} log${logs === 1 ? '' : 's'} or stem${logs === 1 ? '' : 's'}` : ''}; ${table ? 'a crafting table' : 'no crafting table'}. ` +
    (woodPlanks >= needPlanks + (Object.values(heads).some(n => n >= 3) ? 0 : 3)
      ? 'The wood carried is enough for the table and the sticks.'
      : `The table and the sticks need ${needPlanks} planks' worth of wood${Object.values(heads).some(n => n >= 3) ? '' : ' beside the three planks for a wooden head'}, and ${woodPlanks} is carried: wood is what is missing.`);
}

// The standing fact, in the Nether with no pickaxe: how many blocks can be
// laid, that none comes back, and what would make a pickaxe. Null where
// there is a pickaxe (blocks are dug, restock_blocks prices it), and out of
// the Nether.
function stockSays(bot) {
  if (!bot?.entity || !inNether(bot) || bot.game?.gameMode === 'creative' || typeof bot.inventory?.items !== 'function') return null;
  if (pickaxeCarried(bot)) return null;
  const laid = require('./bridging').blocksCarried(bot);
  return {
    canBeLaid: laid,
    pickaxe: 'none carried',
    ...(laid ? { comesBack: NO_RETURN } : { none: `no block that holds is carried and none can be had: ${NO_RETURN} Every walk, crossing or climb that needs a block stops at its first gap; only floor already there is walked, and a crafting table and a pickaxe are the way to blocks again.` }),
    makingAPickaxe: makingSays(bot),
  };
}

module.exports = { stockSays, afterSays, makingSays, pickaxeCarried, NO_RETURN };

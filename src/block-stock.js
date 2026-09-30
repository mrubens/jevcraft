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

// What the trip home is for, from what is carried: with a pickaxe, stone
// for the spans; with none, the pickaxe and whichever of blocks (fewer than
// 16) and wood is missing. Said the same on the option and in chat as it
// starts: 25591's chat said "for a pickaxe and blocks" with 146 blocks
// carried, its option "for a pickaxe and wood" (note 695).
const KIT_BLOCKS = 16;
function kitLacks(bot) {
  if (!bot?.inventory?.items || pickaxeCarried(bot)) return ['stone to lay spans with'];
  const laid = require('./bridging').blocksCarried(bot);
  const wood = carriedOf(bot, /_(log|stem|hyphae|wood|planks)$/) > 0;
  return ['a pickaxe', ...(laid < KIT_BLOCKS ? ['blocks'] : []), ...(wood ? [] : ['wood'])];
}
const listSays = xs => xs.join(', ').replace(/, ([^,]*)$/, ' and $1');

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

// A block the staircase, the legs and the crossings can dig with no
// pickaxe: by the game's rule (hand-dig.js) every block with a hardness
// breaks by hand, slowly where it wants a tool, and then drops nothing.
// Notes 687 and 692 had basalt, blackstone and nether bricks as blocks no
// hand digs; each breaks by hand in 6.25 to 10 seconds (note 705).
function handDigs(bot, block) {
  if (!block || block.boundingBox !== 'block') return true;
  if ((bot?.inventory?.items?.() || []).some(i => block.harvestTools?.[i.type])) return true;
  return require('./hand-dig').handRule(bot, block).breaks;
}

// The rock here by hand, by the dimension: the words every way that digs
// without a pickaxe says it with ("netherrack about 2 s, basalt about
// 6.25 s, ... a block by hand, dropping nothing").
const hardRock = bot => require('./hand-dig').rockByHand(bot, inNether(bot));

// What going on without a pickaxe for `minutes` leaves the bot unable to
// do, said on the choice to go on (upkeep's carry_on) where it bites.
// 25589 (mid-242-dd-fortress-22) was asked the upkeep 42 times from 16:06
// to 20:21 with no pickaxe and answered carry_on 37 of them, "see to this
// later; asked again in five minutes" the whole of what going on was said
// to cost, while every way into its fortress dug or laid (note 687).
function goingOnSays(bot, minutes = 5) {
  if (!bot?.inventory?.items || bot.game?.gameMode === 'creative' || pickaxeCarried(bot)) return '';
  const laid = require('./bridging').blocksCarried(bot);
  return ` No pickaxe is carried: for the next ${minutes} minutes rock is dug by hand (${hardRock(bot)})${laid ? `, and a span or pillar has only the ${laid} block${laid === 1 ? '' : 's'} carried` : ', and no block is carried to pillar or span a gap'}.`;
}

// The straight line from the feet to `target` as a staircase with no
// pickaxe digs it: the feet's and the head's cells in order, the rock and
// its seconds by hand (hand-dig.js), up to the first cell that does not
// break at all (bedrock). -> { steps, handSeconds, stopAt, stopName }
// (stopAt: blocks along the line to it, null where the line is clear).
function handLine(bot, target, { cells = 128 } = {}) {
  const from = bot?.entity?.position?.floored?.();
  if (!from || !target || typeof bot.blockAt !== 'function') return null;
  const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z, n = Math.min(cells, Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)));
  const seen = new Set([`${from.x},${from.y},${from.z}`, `${from.x},${from.y + 1},${from.z}`]);
  let handSeconds = 0;
  for (let i = 1; i <= n; i++) {
    const x = Math.round(from.x + dx * i / n), y = Math.round(from.y + dy * i / n), z = Math.round(from.z + dz * i / n);
    for (const h of [0, 1]) {
      const key = `${x},${y + h},${z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = bot.blockAt(new (require('vec3').Vec3)(x, y + h, z));
      if (!b || b.boundingBox !== 'block') continue;
      const rule = require('./hand-dig').handRule(bot, b);
      if (!rule.breaks) return { steps: n, handSeconds: Math.round(handSeconds), stopAt: i, stopName: String(b.name || 'rock').replaceAll('_', ' ') };
      handSeconds += rule.seconds;
    }
  }
  return { steps: n, handSeconds: Math.round(handSeconds), stopAt: null, stopName: null };
}

// A way that digs, said with what digging by hand does to it: where no
// first step toward it gains (tunneling.js stairFromHere) or its line meets
// a block that does not break within a few blocks, it is not a way (the
// caller does not offer it); else the words it carries, the seconds by
// hand said. 25585's staircase up from y 36 was offered with no step
// that gained and ended "no route" (note 687).
const HAND_LINE_MIN = 3;
function handWaySays(bot, stair, line = null) {
  if (!bot?.inventory?.items || pickaxeCarried(bot)) return { offered: true, says: '' };
  if (stair && !stair.gains) return { offered: false, says: `no pickaxe carried, and no step toward it can be dug from here (${stair.blocked || 'nothing nearer can be dug'})` };
  if (line?.stopName && line.stopAt < HAND_LINE_MIN) return { offered: false, says: `${line.stopName} ${line.stopAt} block${line.stopAt === 1 ? '' : 's'} along the straight line to it, which does not break` };
  const secs = line ? ` (about ${line.handSeconds} seconds of digging on the straight line to it${line.stopName ? `, up to ${line.stopName} about ${line.stopAt} blocks along, which does not break` : ''})` : '';
  return { offered: true, says: ` No pickaxe is carried: rock is dug by hand, ${hardRock(bot)}${secs}.` };
}

// The question's first line where no pickaxe is carried and a way to one is
// on offer: what the ways here lack without it, and which get one. `ways`
// are the keys of the ways to a pickaxe offered; `closed` what was not
// offered for want of one.
function pickaxeLead(bot, ways = [], closed = [], { closedSays = 'not offered for want of one' } = {}) {
  if (!ways.length || !bot?.inventory?.items || pickaxeCarried(bot)) return null;
  const laid = require('./bridging').blocksCarried(bot);
  return `No pickaxe is carried: rock is dug only by hand (${hardRock(bot)}), and ${laid ? `a span or pillar has only the ${laid} carried` : 'no block that holds is carried to span or pillar with'}${closed.length ? `; ${closedSays}: ${closed.join('; ')}` : ''}. ${ways.join(' and ')} get${ways.length === 1 ? 's' : ''} one first.`;
}
// The tree with the ways to a pickaxe first, the rest in their order.
function pickaxeFirstOrder(options, ways = ['make_pickaxe', 'fetch_stems']) {
  return Object.fromEntries([...ways.filter(k => options[k]).map(k => [k, options[k]]), ...Object.entries(options).filter(([k]) => !ways.includes(k))]);
}

// A way chosen that failed for want of a pickaxe (a dig refused for the
// tool, a leg or crossing out of blocks with none to come back) ends the
// upkeep's "carry on" hold taken with no pickaxe: going on was chosen for
// five minutes on the ways that did not need one, and the first that did
// has now said so. The upkeep is asked again at the next pass, told how
// the hold ended (note 687). Called by the ledger (tried.js) as an answer
// settles blocked.
const WANTS_PICKAXE = /no tool for|harvest tool|out of blocks|none to lay|no pickaxe/i;
function pickaxeWanted(bot, goal, { q = null, method = null, why = '', at = Date.now() } = {}) {
  const hold = goal?.upkeepHold;
  if (!hold?.noPickaxe || !(hold.until > Date.now()) || !WANTS_PICKAXE.test(String(why || ''))) return false;
  if (bot?.inventory?.items && pickaxeCarried(bot)) return false;
  if (Number.isFinite(hold.since) && at < hold.since) return false;
  goal.upkeepHoldEnded = { q, method: String(method || 'a way').replaceAll('_', ' '), why: String(why).slice(0, 120), at: Date.now() };
  delete goal.upkeepHold;
  return true;
}

// The blocks a bare hand digs that drop themselves and stand as a block
// (the game's rule: a block with no harvest tool drops by hand; netherrack,
// basalt, blackstone, magma and nether bricks need a pickaxe for any drop).
// In the Nether: soul sand and soil, the wart blocks and shroomlight. Gravel
// drops too but falls, and the pillars and spans do not lay it; stems are
// wood, fetched for a pickaxe (fetch_stems).
// 25585 (mid-242-gf-fortress-1) stood at y 41 under its fortress's floors, 26
// up, with no pickaxe, no wood and no blocks, and nothing said whether any
// block at all could be had there (note 692).
const HAND_BLOCKS = ['soul_sand', 'soul_soil', 'nether_wart_block', 'warped_wart_block', 'shroomlight'];
const handBlocksCarried = bot => carriedOf(bot, new RegExp(`^(${HAND_BLOCKS.join('|')})$`));
// What a hand gets here: the hand-dropping blocks that can be dug from
// ground walked to, and the words for it. -> { n, sources, found, says }.
function handGather(bot, { reach = 16, walk = 32 } = {}) {
  let found = { sources: [], reachable: {}, unreachable: {} };
  try { found = require('./bridging').spanBlockSources(bot, { reach, walk, names: HAND_BLOCKS }); } catch (_) { /* nothing looked at */ }
  const n = found.sources.length;
  const kinds = Object.entries(found.reachable).map(([k, c]) => `${c} ${k.replaceAll('_', ' ')}`).join(', ');
  const rule = `rock is dug by hand, ${hardRock(bot)} (the game's rule: rock drops only to a pickaxe)`;
  const says = n
    ? `By hand here: ${rule}; what a hand does get is ${kinds} within ${reach} blocks, dug from ground walked to (they drop by hand and can be laid).`
    : `Nothing dug by hand within ${reach} blocks drops a block that can be laid: ${rule}, and no soul sand, soul soil or wart block can be dug from ground walked to here (gravel drops, but falls, and is not laid).`;
  return { n, sources: found.sources, found, says };
}

module.exports = { kitLacks, listSays, KIT_BLOCKS, HAND_BLOCKS, handBlocksCarried, handGather, pickaxeWanted, WANTS_PICKAXE, stockSays, afterSays, makingSays, pickaxeCarried, handDigs, handLine, goingOnSays, handWaySays, hardRock, pickaxeLead, pickaxeFirstOrder, NO_RETURN };

'use strict';
// Blocks from the shore (note 974): at the end of its own span with nothing
// to lay and nothing to dig, a player walks back along the span to solid
// rock, digs a stack there and comes back with it. Nothing offered that:
// the block gathers dig what is in reach of where the bot stands or walk to
// a known place by the pathfinder, and from a span over the lava sea both
// come to nothing. 25590 (mid-242-wb-fortress-6, 2026-10-03 04:00 to
// 04:15Z), two pickaxes carried, stood at the end of its span 27 blocks out
// over the lava sea, a fortress with seven blazes in sight 57 blocks on, 33
// of its 83 answers none_good; 25594 the same on a span from a pillar's top.
// The way back is the way in the bot keeps (walk-out.js): its own cells.
const { Vec3 } = require('vec3');
const ROCK = /^(netherrack|blackstone|basalt|soul_soil|soul_sand|stone|deepslate|cobblestone|dirt|andesite|diorite|granite|tuff)$/;
const BACK_MOST = 128, LEG = 12, WANT = 48, DIG_SECONDS = 1.5, WALK = 4.3;

const at = c => new Vec3(c[0], c[1], c[2]);
const rock = b => !!b && b.boundingBox === 'block' && ROCK.test(b.name);
// Rock to quarry about a cell stood in: its floor and the block under it,
// and two or more of the walls round the feet.
function rockAbout(bot, c) {
  if (!rock(bot.blockAt(c.offset(0, -1, 0))) || !rock(bot.blockAt(c.offset(0, -2, 0)))) return false;
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([x, z]) => rock(bot.blockAt(c.offset(x, 0, z)))).length;
  return sides >= 2;
}

// -> { cell, back, trail } or null: the nearest cell back along the way in
// with rock about it, where the bot stands with none and carries a pickaxe.
function offer(bot, goal, { want = WANT } = {}) {
  if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return null;
  if (!/nether/.test(String(bot.game?.dimension || ''))) return null;
  if (!(bot.inventory?.items?.() || []).some(i => /_pickaxe$/.test(i.name))) return null;
  const here = bot.entity.position.floored();
  if (rockAbout(bot, here)) return null;
  const cells = require('./walk-out').wayInOf(bot, goal)?.cells || [];
  if (cells.length < 2) return null;
  // Where the bot is on its way: the latest cell within three blocks.
  let i = -1;
  for (let k = cells.length - 1; k >= 0; k--) { const c = cells[k]; if (Math.hypot(c[0] - here.x, c[1] - here.y, c[2] - here.z) <= 3) { i = k; break; } }
  if (i < 0) return null;
  for (let k = i - 1; k >= Math.max(0, i - BACK_MOST); k--) {
    const c = at(cells[k]);
    if (!bot.blockAt(c)) break;
    if (rockAbout(bot, c)) return { cell: c, back: i - k, from: i, to: k, want, seconds: Math.round((i - k) * 2 / WALK + want * DIG_SECONDS) };
  }
  return null;
}

function says(bot, o) {
  const carried = require('./bridging').blocksCarried(bot);
  return `Go back along the way the bot came to solid rock, ${o.back} cells back at (${o.cell.x}, ${o.cell.y}, ${o.cell.z}), dig up to ${o.want} blocks there with the pickaxe carried (about ${DIG_SECONDS} seconds a block) and come back here with them: about ${o.seconds} seconds in all. Here there is no rock to dig (the bot stands on a span or a ledge of its own, ${carried} blocks carried to lay); the way back is its own cells, walked before. The way on is asked again here with the blocks.`;
}

async function run(bot, task, goal, save, o, { navigate }) {
  const { goals } = require('mineflayer-pathfinder');
  const bridging = require('./bridging');
  const cells = require('./walk-out').wayInOf(bot, goal)?.cells || [];
  const start = bot.entity.position.floored(), had = bridging.blocksCarried(bot);
  goal.step = { action: 'blocks_from_shore', to: { x: o.cell.x, y: o.cell.y, z: o.cell.z }, back: { x: start.x, y: start.y, z: start.z } }; save?.();
  const walk = async (from, to) => {
    const dir = Math.sign(to - from) || 1;
    for (let k = from; k !== to;) {
      task.check();
      k = dir > 0 ? Math.min(to, k + LEG) : Math.max(to, k - LEG);
      const c = cells[k]; if (!c) break;
      // The last leg ends in the cell itself: a block short of it is still the span.
      await navigate(bot, task, k === to ? new goals.GoalBlock(c[0], c[1], c[2]) : new goals.GoalNear(c[0], c[1], c[2], 1), { timeoutMs: 30000, stallMs: 8000 });
    }
  };
  let why = null;
  try {
    await walk(o.from, o.to);
    for (let r = 0; r < 6 && bridging.blocksCarried(bot) - had < o.want; r++) {
      const got = await bridging.quarryHere(bot, task, o.want - (bridging.blocksCarried(bot) - had));
      if (!got.gained) break;
    }
  } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; why = String(err.message || err).slice(0, 160); }
  const gained = bridging.blocksCarried(bot) - had;
  // Back to where it stood, with whatever was got.
  try { if (gained > 0) { await walk(o.to, o.from); await navigate(bot, task, new goals.GoalNear(start.x, start.y, start.z, 1), { timeoutMs: 15000, stallMs: 5000 }); } }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; why ||= String(err.message || err).slice(0, 160); }
  console.log(`[shore] ${gained} blocks from the rock ${o.back} cells back${why ? `: ${why}` : ''}`);
  if (!gained) throw Object.assign(new Error(`No blocks were got from the rock ${o.back} cells back${why ? `: ${why}` : ''}`), { name: 'Blocked' });
  return { gained };
}

module.exports = { offer, says, run, rockAbout, WANT };

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
  // Along its own cells: the pathfinder's walk a leg at a time, and where it
  // finds no route, crouched a cell at a time on the keys (note 995). A span
  // one wide over the lava sea is a way "along a drop that would kill" to
  // the pathfinder, and it is the bot's own way back: of the first five
  // trips live (2026-10-03) four ended "no route" at the first leg, and
  // 25597, left at its span's end with no block, was knocked off it by a
  // blaze's fireball from 28 blocks (06:16:13Z).
  const solidAt = c => bot.blockAt(c)?.boundingBox === 'block';
  const creep = async (from, to) => {
    const dir = Math.sign(to - from) || 1;
    for (let k = from + dir; dir > 0 ? k <= to : k >= to; k += dir) {
      task.check();
      const c = cells[k]; if (!c) throw new Error('the way back has no more cells');
      const cell = at(c), feet = bot.entity.position.floored();
      if (feet.equals(cell)) continue;
      if (Math.abs(cell.x - feet.x) + Math.abs(cell.z - feet.z) > 2 || Math.abs(cell.y - feet.y) > 1) throw new Error(`the next cell of the way back at (${cell.x}, ${cell.y}, ${cell.z}) is not beside the bot`);
      if (!solidAt(cell.offset(0, -1, 0)) || solidAt(cell) || solidAt(cell.offset(0, 1, 0))) throw new Error(`the way back is broken at (${cell.x}, ${cell.y}, ${cell.z})`);
      if (!await bridging.creepTo(bot, task, cell, 2500, cell.y > feet.y ? ['forward', 'jump'] : ['forward'])) throw new Error(`could not step to (${cell.x}, ${cell.y}, ${cell.z}) on the way back`);
    }
  };
  // Once the pathfinder has refused a leg the rest is crept: each refusal
  // costs its own seconds, and the span does not change under the bot.
  let creeping = false;
  const nearest = (lo, hi) => { const p = bot.entity.position; let best = lo, bd = Infinity; for (let j = Math.max(0, lo); j <= Math.min(cells.length - 1, hi); j++) { const q = cells[j]; const dd = Math.hypot(q[0] + 0.5 - p.x, q[1] - p.y, q[2] + 0.5 - p.z); if (dd < bd) { bd = dd; best = j; } } return best; };
  const walk = async (from, to) => {
    const dir = Math.sign(to - from) || 1;
    for (let k = from; k !== to;) {
      task.check();
      const leg = dir > 0 ? Math.min(to, k + LEG) : Math.max(to, k - LEG);
      const c = cells[leg]; if (!c) break;
      if (!creeping) {
        // The last leg ends in the cell itself: a block short of it is still the span.
        try { await navigate(bot, task, leg === to ? new goals.GoalBlock(c[0], c[1], c[2]) : new goals.GoalNear(c[0], c[1], c[2], 1), { timeoutMs: 10000, stallMs: 3000 }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; creeping = true; }
      }
      if (creeping) await creep(nearest(Math.min(from, to), Math.max(from, to)), leg);
      k = leg;
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
  try { if (gained > 0) { await walk(o.to, o.from); if (!creeping) await navigate(bot, task, new goals.GoalNear(start.x, start.y, start.z, 1), { timeoutMs: 15000, stallMs: 5000 }); } }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; why ||= String(err.message || err).slice(0, 160); }
  console.log(`[shore] ${gained} blocks from the rock ${o.back} cells back${why ? `: ${why}` : ''}`);
  if (!gained) throw Object.assign(new Error(`No blocks were got from the rock ${o.back} cells back${why ? `: ${why}` : ''}`), { name: 'Blocked' });
  return { gained };
}

module.exports = { offer, says, run, rockAbout, WANT };

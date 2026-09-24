'use strict';
// Torches: where it is dark enough for monsters to spawn, and putting light
// there. Since 1.18 a monster spawns only at block light 0, and a torch gives
// 14, one less a block, so a cell within thirteen steps of a torch (along
// the grid) is lit. Mineflayer on 26.1 does not apply the server's light
// updates (a torch set beside the bot read light 0 at every distance, the
// arena, 2026-09-24), so light is worked out here from the sources in view.
// Walls between are not counted: a little optimistic in a cave, never in
// the open.
const { Vec3 } = require('vec3');

const EMISSION = {
  torch: 14, wall_torch: 14, lantern: 15, soul_torch: 10, soul_wall_torch: 10, soul_lantern: 10, glowstone: 15, sea_lantern: 15,
  jack_o_lantern: 15, lava: 15, campfire: 15, shroomlight: 15, redstone_torch: 7, redstone_wall_torch: 7, end_rod: 14, froglight: 15,
  ochre_froglight: 15, verdant_froglight: 15, pearlescent_froglight: 15,
};
const taxicab = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

function lightSources(bot, centre, radius = 16) {
  const ids = Object.keys(EMISSION).map(n => bot.registry?.blocksByName?.[n]?.id).filter(id => id !== undefined);
  if (!ids.length || typeof bot.findBlocks !== 'function') return [];
  return (bot.findBlocks({ matching: ids, maxDistance: radius + 15, count: 256, point: centre }) || [])
    .map(p => ({ position: p, emission: EMISSION[bot.blockAt(p)?.name] || 0 })).filter(s => s.emission);
}

// Block light at a cell from the sources, walls not counted.
function blockLight(cell, sources) {
  return Math.max(0, ...sources.map(s => s.emission - taxicab(cell, s.position)));
}

const solidTop = b => !!b && b.boundingBox === 'block' && !/farmland|slab|stairs|leaves|glass|ice|fence|wall|_bed$|chest|furnace|crafting_table|torch|lantern/.test(b.name);
const clearCell = b => !b || (b.boundingBox === 'empty' && !/water|lava/.test(b.name));
// Where a monster could stand: solid ground, two clear cells over it.
function spawnable(bot, cell) {
  return solidTop(bot.blockAt(cell.offset(0, -1, 0))) && clearCell(bot.blockAt(cell)) && clearCell(bot.blockAt(cell.offset(0, 1, 0)));
}

// The cells among `cells` (standing cells) a monster could spawn in: block
// light 0. Open ground counts: under the sky monsters spawn there at night,
// and a torch stops that as it does in a cave.
function darkCells(bot, cells, sources = null) {
  const list = cells.map(c => new Vec3(c.x, c.y, c.z));
  const lit = sources || lightSources(bot, list[0] || bot.entity.position);
  return list.filter(c => spawnable(bot, c) && blockLight(c, lit) === 0);
}

// Torches enough to light them: the cell covering most of the dark ones,
// again and again. Returns the cells to put torches in.
function torchPlan(cells, max = 8) {
  let dark = cells.slice();
  const plan = [];
  while (dark.length && plan.length < max) {
    let best = null, covered = -1;
    for (const c of dark) { const n = dark.filter(d => taxicab(c, d) < 14).length; if (n > covered) { best = c; covered = n; } }
    plan.push(best);
    dark = dark.filter(d => taxicab(best, d) >= 14);
  }
  return plan;
}

// Every standing cell over the ground in a square around `centre`: what a
// home, or the ground around the bot, is lit by.
function groundCells(bot, centre, radius) {
  const cells = [];
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    for (let dy = 3; dy >= -3; dy--) {
      const c = centre.offset(x, dy, z);
      if (spawnable(bot, c)) { cells.push(c); break; }
    }
  }
  return cells;
}

async function placeTorches(bot, task, actions, cells, { max = 8 } = {}) {
  let placed = 0;
  for (const cell of cells.slice(0, max)) {
    task.check();
    if (!bot.inventory.items().some(i => i.name === 'torch')) break;
    if (!spawnable(bot, cell)) continue;
    try { await actions.place(bot, task, cell, 'torch'); placed++; }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
  return placed;
}

module.exports = { EMISSION, lightSources, blockLight, spawnable, darkCells, torchPlan, groundCells, placeTorches };

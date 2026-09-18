'use strict';

// ---------------------------------------------------------------------------
// A spatial view of the world, for the state.
//
// Until this existed the bot was choosing where to put its fortieth block with
// no picture of the first thirty-nine: the state carried position, health and
// inventory, but not one block of terrain. Everything spatial lived inside the
// prose of individual options ("break the grass_block 1.4 north"), which gives
// no sense of shape, of what has been built, or of what is still a hole.
//
// This renders the immediate surroundings as a small stack of maps — one per
// height — marking what is solid, what is open, and which blocks the bot laid
// itself. It is compact on purpose: ~700 characters for an 11x11x5 volume.
// ---------------------------------------------------------------------------

const SOLID = '#';
const EMPTY = '.';
const PLACED = 'o';
const BOT = '@';
const UNKNOWN = '?';

/**
 * @param {object} bot            live mineflayer bot
 * @param {Set<string>} placed    "x,y,z" keys of blocks this bot has placed
 * @param {object} [opts]
 */
function terrainView(bot, placed = new Set(), { radius = 5, below = 1, above = 3 } = {}) {
  const me = bot.entity.position.floored();
  const layers = {};

  for (let dy = -below; dy <= above; dy++) {
    const y = me.y + dy;
    const rows = [];
    // One row per z (north at the top), one character per x (west on the left),
    // so the map reads the way a player looking down at the ground would see it.
    for (let dz = -radius; dz <= radius; dz++) {
      let row = '';
      for (let dx = -radius; dx <= radius; dx++) {
        const x = me.x + dx, z = me.z + dz;
        if (dx === 0 && dz === 0 && (dy === 0 || dy === 1)) { row += BOT; continue; }
        const block = bot.blockAt(new (require('vec3').Vec3)(x, y, z));
        if (!block) { row += UNKNOWN; continue; }
        if (placed.has(`${x},${y},${z}`)) { row += PLACED; continue; }
        row += block.boundingBox === 'block' ? SOLID : EMPTY;
      }
      rows.push(row);
    }
    const label = dy === 0 ? `y=${y} (the bot's feet)`
      : dy === 1 ? `y=${y} (the bot's head)`
        : dy < 0 ? `y=${y} (below the bot)`
          : `y=${y} (above the bot)`;
    layers[label] = rows;
  }

  return {
    how_to_read:
      `Each layer is a map of one height. Rows run north to south, characters run west to east. ` +
      `The centre of every layer is where the bot stands. ` +
      `'${SOLID}' is a solid block, '${EMPTY}' is open air, '${PLACED}' is a block this bot placed itself, ` +
      `'${BOT}' is the bot, '${UNKNOWN}' is not loaded.`,
    centre: { x: me.x, y: me.y, z: me.z },
    west_edge_x: me.x - radius,
    north_edge_z: me.z - radius,
    layers,
  };
}

/** A compact list of what the bot has built, so progress is visible as shape. */
function builtSoFar(placed, limit = 60) {
  const keys = [...placed].slice(-limit);
  if (keys.length === 0) return null;
  const pts = keys.map((k) => k.split(',').map(Number));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), zs = pts.map((p) => p[2]);
  return {
    block_count: placed.size,
    positions: keys.map((k) => k.replace(/,/g, ' ')),
    bounding_box: {
      x: [Math.min(...xs), Math.max(...xs)],
      y: [Math.min(...ys), Math.max(...ys)],
      z: [Math.min(...zs), Math.max(...zs)],
    },
  };
}

module.exports = { terrainView, builtSoFar };

'use strict';
// A bot on a saved region's ground (a fixture of rows by y then z, one char
// per x, the palette index; see ledge-hoglin-25589.json), with the real
// pathfinder's route search over it (mineflayer-pathfinder AStar and the
// bot's own movements, movement.js configureMovements), for replaying the
// recorded states of a trial (note 604).
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');

const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);

function groundOf(fixture) {
  const { box, palette, rows } = fixture;
  const zs = box.z[1] - box.z[0] + 1;
  const cache = new Map();
  return p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    if (x < box.x[0] || x > box.x[1] || y < box.y[0] || y > box.y[1] || z < box.z[0] || z > box.z[1]) return null;
    const key = `${x},${y},${z}`;
    if (cache.has(key)) return cache.get(key);
    const c = rows[(y - box.y[0]) * zs + (z - box.z[0])].charCodeAt(x - box.x[0]);
    const name = palette[c >= 97 ? c - 97 : c - 65 + 26];
    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
    b.position = new Vec3(x, y, z);
    cache.set(key, b);
    return b;
  };
}

// mobs: [{ id, name, at: Vec3, height, width }]
function groundBot(fixture, { at, health = 20, food = 20, mobs = [], items = [], worn = [], held = null, dimension = 'overworld' }) {
  const blockAt = groundOf(fixture);
  const entities = Object.fromEntries(mobs.map(m => [m.id, { id: m.id, name: m.name, type: 'hostile', position: m.at.clone(), height: m.height ?? 1.7, width: m.width ?? 0.6, isValid: true, metadata: m.metadata || [] }]));
  const inv = items.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }));
  const slots = Object.fromEntries(worn.map((name, i) => [5 + i, { name }]));
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', game: { dimension, gameMode: 'survival', difficulty: 'normal' }, health, food, oxygenLevel: 20, entities, time: { timeOfDay: 6000 },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, -0.08, 0), eyeHeight: 1.62, yaw: 0, pitch: 0 },
    inventory: { items: () => inv, slots, emptySlotCount: () => 10 },
    heldItem: held ? { name: held } : null,
    blockAt,
    world: { raycast(from, dir, max) { for (let t = 0; t <= max; t += 0.05) { const p = from.plus(dir.scaled(t)), b = blockAt(p); if (b && b.boundingBox === 'block') return Object.assign(b, { intersect: p }); } return null; } },
    findBlocks({ matching, maxDistance = 16, count = 1, useExtraInfo = () => true, point = bot.entity.position }) {
      const ids = new Set([].concat(matching)), found = [];
      const c = point.floored(), r = Math.ceil(maxDistance);
      for (let x = c.x - r; x <= c.x + r; x++) for (let y = c.y - r; y <= c.y + r; y++) for (let z = c.z - r; z <= c.z + r; z++) {
        const b = blockAt(new Vec3(x, y, z));
        if (!b || !ids.has(b.type) || b.position.distanceTo(point) > maxDistance) continue;
        if (useExtraInfo(b)) found.push(b.position);
      }
      return found.sort((a, b) => a.distanceTo(point) - b.distanceTo(point)).slice(0, count);
    },
    lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {}, chat() {},
    clearControlStates() {}, setControlState() {}, getControlState: () => false, activateItem() {}, deactivateItem() {},
  });
  bot.pathfinder = { setMovements(m) { this.movements = m; }, setGoal() {}, isMoving: () => false };
  const { configureMovements } = require('../../src/movement');
  const movements = configureMovements(bot);
  bot.pathfinder.movements = movements;
  movements.allowEntityDetection = false;
  const AStar = require('mineflayer-pathfinder/lib/astar'), Move = require('mineflayer-pathfinder/lib/move');
  // The pathfinder's own search, from where the bot stands.
  bot.pathfinder.getPathFromTo = function * (m, start, goal, { timeout = 2000 } = {}) {
    const p = start.floored();
    const search = new AStar(new Move(p.x, p.y, p.z, m.countScaffoldingItems(), 0), m, goal, Math.max(timeout, 2000), 1e9, -1);
    yield { result: search.compute(), astarContext: search };
  };
  bot.pathfinder.getPathTo = (m, goal, timeout) => bot.pathfinder.getPathFromTo(m, bot.entity.position, goal, { timeout }).next().value.result;
  return bot;
}

module.exports = { groundOf, groundBot, registry };

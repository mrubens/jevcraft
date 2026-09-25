'use strict';
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../../src/skills');
const home = require('../../src/home-base');

const LEVEL = 63;
const key = p => `${p.x},${p.y},${p.z}`;

// A flat grass world at y=63 with whatever ponds and blocks a test sets,
// and a bot whose hoe, seeds, bed and gate placements do what the server
// would do. Everything the module reads is observed, so the mock only has
// to change blocks the way Minecraft does.
function world({ ponds = [], items = [], position = new Vec3(0.5, LEVEL + 1, 0.5), loaded = () => true } = {}) {
  const blocks = new Map();
  const set = (p, name, props = {}) => blocks.set(key(p), { name, props });
  for (const pond of ponds) for (const p of pond) set(p, 'water');
  const nameAt = p => blocks.get(key(p))?.name ?? (p.y < LEVEL ? 'stone' : p.y === LEVEL ? 'grass_block' : 'air');
  const solid = name => !['air', 'water', 'short_grass', 'wheat'].includes(name) && !/_bed$|_fence$|_fence_gate$/.test(name) || /_fence$|_fence_gate$|_bed$/.test(name);
  const blockAt = p => {
    if (!loaded(p)) return null;
    const entry = blocks.get(key(p)), name = nameAt(p);
    return { name, position: new Vec3(p.x, p.y, p.z), boundingBox: solid(name) && name !== 'water' ? 'block' : 'empty', diggable: true, type: registry.blocksByName[name]?.id,
      getProperties: () => entry?.props || {} };
  };
  const stack = (name, count, durabilityUsed = 0) => ({ name, count, type: registry.itemsByName[name].id, stackSize: registry.itemsByName[name].stackSize, durabilityUsed });
  const stacks = items.map(([name, count, durabilityUsed]) => stack(name, count, durabilityUsed));
  const give = (name, count) => { const s = stacks.find(i => i.name === name); if (s && s.stackSize > 1) s.count += count; else stacks.push(stack(name, count)); };
  const take = (name, count = 1) => { const s = stacks.find(i => i.name === name); if (!s) return; s.count -= count; if (s.count <= 0) stacks.splice(stacks.indexOf(s), 1); };
  const bot = Object.assign(new EventEmitter(), {
    registry, inventory: { items: () => stacks.filter(i => i.count > 0), slots: [], emptySlotCount: () => 36 - stacks.length }, entities: {}, said: [],
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal', minY: 0, height: 128 }, time: { timeOfDay: 3000, age: 100000 },
    entity: { id: 1, position: position.clone(), yaw: 0 }, health: 20, food: 20, heldItem: null, isSleeping: false,
    blockAt, world: { raycast: () => null },
    findBlocks: ({ matching, maxDistance, count, point, useExtraInfo }) => {
      const centre = point || bot.entity.position, found = [];
      for (let x = Math.floor(centre.x - maxDistance); x <= centre.x + maxDistance; x++) for (let z = Math.floor(centre.z - maxDistance); z <= centre.z + maxDistance; z++) for (let y = LEVEL - 1; y <= LEVEL + 1; y++) {
        const b = blockAt(new Vec3(x, y, z));
        if (b && matching.includes(b.type) && (!useExtraInfo || useExtraInfo(b))) found.push(b.position);
        if (found.length >= count) return found;
      }
      return found;
    },
    pathfinder: { movements: {}, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} },
    clearControlStates() {}, chat(line) { bot.said.push(line); },
    lookAt: async () => {},
    equip: async item => { bot.heldItem = item; },
    unequip: async () => { bot.heldItem = null; },
    activateBlock: async block => {
      if (/_hoe$/.test(bot.heldItem?.name || '') && ['grass_block', 'dirt'].includes(block.name)) set(block.position, 'farmland', { moisture: 7 });
      else if (/_bed$/.test(block.name)) bot.emit('message', { json: { translate: 'block.minecraft.set_spawn' }, toString: () => 'Respawn point set' });
      else if (/_fence_gate$/.test(block.name)) set(block.position, block.name, { open: !block.getProperties().open });
    },
    placeBlock: async (ref, face) => {
      const p = ref.position.plus(face), held = bot.heldItem?.name;
      if (!held) throw new Error('nothing held');
      if (held === 'wheat_seeds' && ref.name === 'farmland') { set(p, 'wheat', { age: 0 }); take('wheat_seeds'); return; }
      if (/_bed$/.test(held)) {
        // The head goes the way the bot is looking: from its standing spot toward the clicked cell.
        const d = { x: Math.sign(p.x - Math.floor(bot.entity.position.x)), z: Math.sign(p.z - Math.floor(bot.entity.position.z)) };
        set(p, held, { part: 'foot' }); set(p.offset(d.x, 0, d.z), held, { part: 'head' }); take(held); return;
      }
      set(p, held, /_fence_gate$/.test(held) ? { open: false } : {}); take(held);
    },
    useOn: entity => { if (bot.heldItem?.name === 'wheat' && entity.name === 'cow') { take('wheat'); entity.fed = (entity.fed || 0) + 1; } },
    wake: async () => { bot.isSleeping = false; },
    emit: (...args) => EventEmitter.prototype.emit.apply(bot, args),
  });
  const actions = {
    calls: [],
    navigate: async (b, t, goal) => { actions.calls.push(['navigate', goal.x ?? goal.entity?.name]); if (goal.entity) b.entity.position = goal.entity.position.clone(); else if (goal.x !== undefined) b.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); },
    place: async (b, t, p, material) => { actions.calls.push(['place', material]); set(p, material); take(material); },
    dig: async (b, t, p) => { actions.calls.push(['dig', nameAt(p)]); if (nameAt(p) === 'wheat') { give('wheat', 1); give('wheat_seeds', 1); } set(p, 'air'); },
    acquireStep: async (b, t, item, count) => { actions.calls.push(['acquire', item, count]); },
    explore: async (b, t, g, s, resource) => { actions.calls.push(['explore', resource]); },
  };
  return { bot, blocks, set, give, take, actions, nameAt, stacks };
}

const pond = (x, z, size = 3) => { const cells = []; for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) cells.push(new Vec3(x + dx, LEVEL, z + dz)); return cells; };
const goalWith = (bot, extra = {}) => ({ kind: 'win', request: 'beat the game', survival: { shelters: [] }, ...extra });

// A finished base: claimed bed, planted plot, fenced pen and a chest beside
// the bed. Growth takes in-game time, so the plot is tended on return visits.
async function establishedHome({ items = [['wooden_hoe', 1]], chest = true, walled = true } = {}) {
  const w = world({ ponds: [pond(20, 0)], items });
  const goal = goalWith(w.bot, { portals: [{ x: 0, y: LEVEL + 1, z: 0, dimension: 'overworld' }] }), task = new Task('home'), save = () => {};
  const site = home.chooseBaseSite(w.bot, goal);
  const h = home.establishHome(goal, site);
  const l = home.layout(h);
  for (const p of l.plot) { w.set(p, 'farmland'); w.set(new Vec3(p.x, p.y + 1, p.z), 'wheat', { age: 3 }); }
  w.set(l.bed.foot, 'white_bed'); w.set(l.bed.head, 'white_bed'); h.bed.claimedAt = '2026-09-21T00:00:00Z';
  if (chest) { w.set(l.chest, 'chest'); h.stash = { position: { ...l.chest }, placedAt: '2026-09-21T00:00:00Z', contents: {} }; }
  for (const f of l.pen.fences) w.set(f, 'oak_fence'); w.set(l.pen.gate, 'oak_fence_gate', { open: false });
  h.plot.plantedAt = new Date().toISOString(); h.plot.checkedAt = h.plot.plantedAt;
  // The wall round home is its own option (home-wall.js); most tests are of the rest.
  if (walled) h.walledAt = '2026-09-21T00:00:00Z';
  return { ...w, goal, task, save, home: h, layout: l };
}

module.exports = { LEVEL, registry, world, pond, goalWith, establishedHome };

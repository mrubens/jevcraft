'use strict';
// A small world with the game's rule for falling blocks, and a bot standing
// in it (notes 768, 768b): a block that falls, with no block under it, comes
// down its column to the first block that holds it and lands in the cell
// over it; a body's cells do not hold it; a torch in the cell it lands in
// breaks it into an item.
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);

const FALLS = /^(sand|red_sand|gravel)$/;

// A small world with the falling-block rule, and a bot standing in it.
function sim({ cells = {}, ground = y => (y <= 55 ? 'andesite' : y <= 63 ? 'sandstone' : 'air'), feet = new Vec3(0, 56, 0), items = [] } = {}) {
  const world = new Map(Object.entries(cells));
  const nameAt = p => world.get(`${p.x},${p.y},${p.z}`) ?? ground(p.y, p);
  const log = { buried: 0, broken: 0, digs: [], refused: [] };
  const inv = items.map(([name, count, extra = {}]) => ({ name, count, type: registry.itemsByName[name].id, ...extra }));
  const bot = {
    registry, game: { gameMode: 'survival', dimension: 'overworld', minY: -64, height: 384 }, health: 20, food: 18,
    entity: { position: new Vec3(feet.x + 0.5, feet.y, feet.z + 0.5), onGround: true },
    entities: {},
    inventory: { items: () => inv.filter(i => i.count > 0), slots: [] },
    blockAt: q => {
      const p = new Vec3(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z));
      const b = Block.fromStateId(registry.blocksByName[nameAt(p)].defaultState, 0);
      b.position = p;
      return b;
    },
    pathfinder: { movements: {} },
    equip: async item => { bot.held = item; },
    placeBlock: async (ref, face) => {
      const p = ref.position.plus(face);
      if (bot.held?.name !== 'torch' || bot.held.count < 1) throw new Error('nothing to place');
      world.set(`${p.x},${p.y},${p.z}`, 'torch'); bot.held.count--;
    },
    recipesFor: id => (id === registry.itemsByName.torch.id && inv.some(i => /^(coal|charcoal)$/.test(i.name) && i.count) && inv.some(i => i.name === 'stick' && i.count) ? [{ torch: true }] : []),
    craft: async () => {
      inv.find(i => /^(coal|charcoal)$/.test(i.name) && i.count).count--; inv.find(i => i.name === 'stick' && i.count).count--;
      const t = inv.find(i => i.name === 'torch'); if (t) t.count += 4; else inv.push({ name: 'torch', count: 4, type: registry.itemsByName.torch.id });
    },
  };
  const body = () => { const f = bot.entity.position.floored(); return [f, f.offset(0, 1, 0)].map(c => `${c.x},${c.y},${c.z}`); };
  const set = (p, n) => world.set(`${p.x},${p.y},${p.z}`, n);
  // A dig: the cell opens, then what falls over it comes down.
  bot.dig = async block => {
    const p = block.position;
    log.digs.push({ at: `${p.x},${p.y},${p.z}`, name: block.name });
    const wasTorch = /torch/.test(block.name);
    set(p, 'air');
    if (wasTorch) { const t = inv.find(i => i.name === 'torch'); if (t) t.count++; else inv.push({ name: 'torch', count: 1, type: registry.itemsByName.torch.id }); }
    gravity(p.x, p.z);
  };
  function gravity(x, z) {
    for (let y = -63; y < 320; y++) {
      const p = new Vec3(x, y, z);
      if (!FALLS.test(nameAt(p))) continue;
      const below = bot.blockAt(p.offset(0, -1, 0));
      if (below.boundingBox === 'block') continue;
      set(p, 'air');
      let q = p.offset(0, -1, 0);
      while (bot.blockAt(q).boundingBox !== 'block' && !/torch/.test(nameAt(q))) q = q.offset(0, -1, 0);
      if (/torch/.test(nameAt(q))) { log.broken++; continue; }
      const land = q.offset(0, 1, 0);
      set(land, nameAt(p) === 'air' ? 'sand' : 'sand');
      if (body().includes(`${land.x},${land.y},${land.z}`)) log.buried++;
    }
  }
  return { bot, world, log, set, nameAt, inv };
}
module.exports = { sim };

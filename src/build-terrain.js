'use strict';
const { Vec3 } = require('vec3');
const { surfaceObserver } = require('./surface');
const key = p => `${p.x},${p.y},${p.z}`;
const air = b => b && ['air', 'cave_air', 'void_air'].includes(b.name);
const PREP_LIMITS = { cut: 4, fill: 6, changes: 2400 };

// A surveyed, bounded earthwork plan: cut natural high ground and fill low
// ground/shallow water. Unknown columns, lava and recognizable builds rule out
// a site. Every cell is snapshotted before the first shovel or block placement.
function planTerrainSite(bot, schematic, { naturalGround, replaceable, at }) {
  const o = bot.entity.position.floored(), [width, height, depth] = schematic.source.size;
  const isSurface = surfaceObserver(bot), columns = new Map(), candidates = [];
  const entry = new Vec3(...(schematic.access || schematic.source.entrance || [Math.floor(width / 2), 1, 0]));
  if (entry.y !== 1) return null;
  const direction = entry.z === 0 ? new Vec3(0, 0, -1) : entry.z === depth - 1 ? new Vec3(0, 0, 1) : entry.x === 0 ? new Vec3(-1, 0, 0) : new Vec3(1, 0, 0);
  const column = (x, z) => {
    const k = `${x},${z}`;
    if (columns.has(k)) return columns.get(k);
    let water, found = null;
    for (let y = o.y + 8; y >= o.y - 10; y--) {
      const p = new Vec3(x, y, z), block = bot.blockAt(p);
      if (!block) break;
      if (block.name === 'water') {
        if (Number(block.getProperties?.().level || 0) !== 0) break;
        water ??= y;
        if (water - y >= PREP_LIMITS.fill) break;
      } else if (naturalGround(block)) {
        if (isSurface(new Vec3(x, (water ?? y) + 1, z))) found = { x, z, ground: y, water };
        break;
      } else if (!replaceable(block)) break;
    }
    columns.set(k, found); return found;
  };
  const foundation = new Set(schematic.blocks.filter(p => p.y === 0).map(p => `${p.x},${p.z}`));
  const offsets = at ? [[at.x - o.x, at.z - o.z]]
    : [5, -width - 5, 12, -width - 12].flatMap(dx => [5, -depth - 5, 12, -depth - 12].map(dz => [dx, dz]));
  for (const [dx, dz] of offsets) {
    const footprint = [];
    for (let x = -1; x <= width; x++) for (let z = -1; z <= depth; z++) footprint.push(column(o.x + dx + x, o.z + dz + z));
    if (footprint.some(c => !c)) continue;
    const heights = footprint.map(c => c.water ?? c.ground).sort((a, b) => a - b);
    const median = heights[Math.floor(heights.length / 2)];
    const waterline = Math.max(-Infinity, ...footprint.filter(c => c.water !== undefined).map(c => c.water));
    for (const base of new Set([Math.max(median, waterline), Math.max(median + 1, waterline)])) {
    const origin = o.offset(dx, base - o.y, dz), cuts = new Map(), fill = new Map(), deck = new Map();
    const shape = new Map(schematic.blocks.map(p => [key(origin.offset(p.x, p.y, p.z)), p.material]));
    let valid = true;
    const prepareColumn = (c, top) => {
      if (!c || c.ground - top > PREP_LIMITS.cut || top - c.ground > PREP_LIMITS.fill) { valid = false; return; }
      deck.set(`${c.x},${c.z}`, top);
      for (let y = c.ground; y > top; y--) {
        const p = new Vec3(c.x, y, c.z), b = bot.blockAt(p);
        if (!naturalGround(b)) { valid = false; return; }
        cuts.set(key(p), { ...p });
      }
      for (let y = c.ground + 1; y <= top; y++) {
        const p = new Vec3(c.x, y, c.z), b = bot.blockAt(p);
        if (!b || !(replaceable(b) || b.name === 'water')) { valid = false; return; }
        fill.set(key(p), { ...p, material: 'cobblestone' });
      }
    };
    for (const c of footprint) prepareColumn(c, base - (foundation.has(`${c.x - origin.x},${c.z - origin.z}`) ? 1 : 0));
    // Replace water at the actual floor with its designed material now. Without
    // this, the survey rejects a waterline floor and unnecessarily raises the
    // whole island one block beyond an ordinary swimming exit.
    for (const p of schematic.blocks.filter(p => p.y === 0)) {
      const q = origin.offset(p.x, p.y, p.z);
      if (bot.blockAt(q)?.name === 'water') fill.set(key(q), { ...p, ...q });
    }
    // A short ordinary staircase joins the prepared apron to surrounding land.
    // It is permanent access, not disposable construction scaffolding.
    let reached = false, previous = base;
    for (let n = 2; valid && n <= 7; n++) {
      const p = origin.plus(entry).plus(direction.scaled(n)), c = column(p.x, p.z);
      if (!c) { valid = false; break; }
      const top = Math.max(previous - 1, Math.min(previous + 1, c.water ?? c.ground));
      prepareColumn(c, top); previous = top;
      if (top === c.ground || c.water !== undefined && top <= c.water) { reached = true; break; }
    }
    if (!valid || !reached || cuts.size + fill.size > PREP_LIMITS.changes) continue;
    const blocks = schematic.blocks.map(p => ({ ...p, ...origin.offset(p.x, p.y, p.z) }));
    for (const p of fill.values()) if (!shape.has(key(p))) blocks.push(p);
    // offset() returns a bare Vec3, which silently dropped the mark saying a
    // cell is a room the design asked for. Rooms below the prepared deck are
    // exactly the ones worth keeping: that is the part cut into the ground.
    const emptyMap = new Map(schematic.empty.map(p => ({ ...origin.offset(p.x, p.y, p.z), ...(p.carved && { carved: true }) }))
      .filter(p => p.carved || p.y > (deck.get(`${p.x},${p.z}`) ?? base)).map(p => [key(p), { ...p }]));
    // Reserve standing/head space along all added approach cells.
    for (const [xz, top] of deck) {
      const [x, z] = xz.split(',').map(Number);
      if (x >= origin.x && x < origin.x + width && z >= origin.z && z < origin.z + depth) continue;
      for (const y of [top + 1, top + 2]) emptyMap.set(`${x},${y},${z}`, { x, y, z });
    }
    const initialBlocks = {}, initialNames = {};
    for (const p of [...blocks, ...emptyMap.values(), ...cuts.values()]) {
      const block = bot.blockAt(new Vec3(p.x, p.y, p.z));
      if (!block || !(naturalGround(block) || replaceable(block) || block.name === 'water')) { valid = false; break; }
      if (block.name === 'water' && !fill.has(key(p))) { valid = false; break; }
      if (!air(block)) { initialBlocks[key(p)] = block.stateId ?? block.name; initialNames[key(p)] = block.name; }
    }
    if (!valid) continue;
    // Plants/logs above a cut or in the approach are cleared top-down too.
    for (const p of emptyMap.values()) if (!air(bot.blockAt(new Vec3(p.x, p.y, p.z)))) cuts.set(key(p), p);
    if (cuts.size + fill.size > PREP_LIMITS.changes) continue;
    const all = [...blocks, ...emptyMap.values(), ...cuts.values()];
    candidates.push({ origin: { ...origin }, blocks, empty: [...emptyMap.values()], entrance: { ...origin.plus(entry).plus(direction) }, initialBlocks, initialNames,
      terrain: { clear: [...cuts.values()], fill: [...fill.values()], changedBlocks: cuts.size + fill.size,
        kind: footprint.some(c => c.water !== undefined) ? 'shore_foundation' : 'level_ground' },
      bounds: { min: { x: Math.min(...all.map(p => p.x)), y: Math.min(...all.map(p => p.y)), z: Math.min(...all.map(p => p.z)) },
        max: { x: Math.max(...all.map(p => p.x)), y: base + height - 1, z: Math.max(...all.map(p => p.z)) } } });
    }
  }
  return candidates.sort((a, b) => a.terrain.changedBlocks - b.terrain.changedBlocks ||
    new Vec3(a.origin.x, a.origin.y, a.origin.z).distanceTo(o) - new Vec3(b.origin.x, b.origin.y, b.origin.z).distanceTo(o))[0] || null;
}

module.exports = { planTerrainSite, PREP_LIMITS };

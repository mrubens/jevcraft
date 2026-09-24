'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { endPocket, pocketPlan } = require('../src/end-pocket');

function platform() {
  const dug = new Set(), placed = new Map();
  const name = p => placed.get(`${p}`) || (dug.has(`${p}`) ? 'air' : p.y <= 60 ? 'end_stone' : 'air');
  const items = [{ name: 'cobblestone', count: 20 }];
  let angry = true;
  const bot = { entity: { position: new Vec3(0.5, 61, 0.5), onGround: true }, inventory: { items: () => items }, health: 14,
    blockAt: p => { const f = p.floored(); const n = name(f); return { name: n, position: f, boundingBox: n === 'air' ? 'empty' : 'block' }; },
    equip: async () => {}, placeBlock: async (ref, face) => { placed.set(`${ref.position.plus(face)}`, 'cobblestone'); angry = false; } };
  const dig = async (b, t, p) => { dug.add(`${p}`); placed.delete(`${p}`); if (p.y < bot.entity.position.y) bot.entity.position = new Vec3(0.5, p.y, 0.5); };
  const hostileEntities = () => angry ? [{ name: 'enderman' }, { name: 'enderman' }] : [];
  return { bot, dug, placed, dig, hostileEntities };
}

test('against endermen in the End: three down into end stone, capped, waited out, and back up', async t => {
  const w = platform();
  assert(pocketPlan(w.bot));
  const pillared = [];
  const recovery = require('../src/pillar-recovery'), kept = recovery.pillarUp;
  recovery.pillarUp = async (b, t, y) => { pillared.push(y); };
  t.after?.(() => { recovery.pillarUp = kept; });
  const steps = [];
  assert.equal(await endPocket(w.bot, new Task('end'), { dig: w.dig, hostileEntities: w.hostileEntities, waitMs: 2000, report: a => steps.push(a.action) }), true);
  assert(['(0, 60, 0)', '(0, 59, 0)', '(0, 58, 0)'].every(k => w.dug.has(k)), [...w.dug].join(' '));
  assert.deepEqual(steps, ['end_pocket', 'end_pocket_leave']);
  assert.deepEqual(pillared, [61], 'climbed back to the surface');
});

test('no pocket over the void or with nothing to cap it', () => {
  const w = platform();
  w.bot.inventory.items = () => [];
  assert.equal(pocketPlan(w.bot), null);
  const v = platform();
  v.bot.blockAt = p => ({ name: p.y === 60 ? 'end_stone' : 'air', position: p.floored(), boundingBox: p.y === 60 ? 'block' : 'empty' });
  assert.equal(pocketPlan(v.bot), null);
});

test('no pocket with water poured beside it: it would run in under the cap', () => {
  const w = platform();
  const inner = w.bot.blockAt;
  w.bot.blockAt = p => { const f = p.floored(); return f.x === 1 && f.y === 61 && f.z === 0 ? { name: 'water', position: f, boundingBox: 'empty' } : inner(p); };
  assert.equal(pocketPlan(w.bot), null);
});

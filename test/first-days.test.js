'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { milestones } = require('../scripts/first-days');

test('the first-days milestones: iron tools, iron armour worn, a shield, a bed and a home', () => {
  const snapshot = { inventory: { iron_pickaxe: 1, diamond_sword: 1 }, equipment: { head: 'iron_helmet', torso: 'iron_chestplate', legs: 'iron_leggings', feet: 'golden_boots', offhand: 'shield' } };
  const state = { survival: { home: { bed: { claimedAt: 'x' }, stash: { position: { x: 0, y: 0, z: 0 } } } }, gameProgress: { phase: 'golden_boots' } };
  const m = milestones(snapshot, state);
  assert.equal(m.iron_pickaxe, true); assert.equal(m.iron_sword, true); assert.equal(m.shield, true); assert.equal(m.bed, true); assert.equal(m.home, true);
  assert.equal(m.iron_armour, false, 'golden boots are not iron armour');
  snapshot.inventory.iron_boots = 1;
  assert.equal(milestones(snapshot, state).iron_armour, false, 'carried and not worn: three pieces worn');
  snapshot.equipment.feet = 'iron_boots';
  assert.equal(milestones(snapshot, state).iron_armour, true);
  assert.equal(milestones({ inventory: {}, equipment: {} }, {}).home, false);
});

test('pacing is a minute of walking back and forth that gains nothing; the same walk making a pickaxe is work', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { analyse } = require('../scripts/lib/audit');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacing-'));
  const identity = 'test-Jev', t0 = Date.parse('2026-09-24T05:00:00Z');
  const frames = [];
  const minute = (start, inventoryAt) => {
    for (let i = 0; i <= 60; i++) {
      const x = i % 8 < 4 ? (i % 4) * 2 : 8 - (i % 4) * 2;
      frames.push({ kind: 'observation', at: new Date(start + i * 1000).toISOString(), snapshot: { position: { x, y: 64, z: 0 }, step: { action: 'mine' } } });
      if (i % 10 === 0) frames.push({ kind: 'action', at: new Date(start + i * 1000 + 1).toISOString(), snapshot: { position: { x, y: 64, z: 0 }, inventory: inventoryAt(i) } });
    }
  };
  minute(t0, () => ({ cobblestone: 5, stick: 2 }));
  minute(t0 + 120000, i => ({ cobblestone: 5, stick: 2, ...(i >= 40 ? { iron_pickaxe: 1 } : {}) }));
  fs.writeFileSync(path.join(dir, `${identity}-2026-09-24T04-59-00-000Z.jsonl`), frames.map(f => JSON.stringify(f)).join('\n'));
  const a = analyse({ identity, from: t0 - 1000, to: t0 + 200000, dir });
  assert.equal(a.pacing.length, 1, JSON.stringify(a.pacing));
  assert(a.pacing[0].from < t0 + 60000, 'the empty-handed minute, not the one that made a pickaxe');
  fs.rmSync(dir, { recursive: true });
});

test('a milestone counts once reached at any time in the trial: a pickaxe worn out later is still reached', () => {
  // Trial 79: everything by minute 34, the iron pickaxe worn out at minute 50.
  const { reached } = require('../scripts/first-days');
  const frames = [
    { snapshot: { inventory: { iron_pickaxe: 1, iron_sword: 1, shield: 1 }, equipment: { head: 'iron_helmet', torso: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' } } },
    { snapshot: { inventory: { stone_pickaxe: 1, iron_sword: 1, shield: 1 } } },
  ];
  const m = reached(frames, { survival: { home: { bed: { claimedAt: 'x' }, stash: { position: {} } } } });
  assert.deepEqual(['iron_pickaxe', 'iron_sword', 'iron_armour', 'shield', 'bed', 'home'].filter(k => !m[k]), []);
  const never = reached([{ snapshot: { inventory: { stone_pickaxe: 1 } } }], {});
  assert.equal(never.iron_pickaxe, false, 'never had one: not reached');
});

test('each milestone keeps the time it was first reached; the home its own saved times', () => {
  const { reached } = require('../scripts/first-days');
  const t0 = Date.parse('2026-09-25T10:00:00Z');
  const frames = [
    { t: t0 + 5 * 60000, snapshot: { inventory: { stone_pickaxe: 1 } } },
    { t: t0 + 20 * 60000, snapshot: { inventory: { iron_pickaxe: 1 } } },
    { t: t0 + 50 * 60000, snapshot: { inventory: { stone_pickaxe: 1 } } },
  ];
  const state = { survival: { home: { bed: { claimedAt: new Date(t0 + 30 * 60000).toISOString() }, stash: { position: {}, placedAt: new Date(t0 + 40 * 60000).toISOString() } } } };
  const m = reached(frames, state);
  assert.equal(m.at.iron_pickaxe, t0 + 20 * 60000, 'first reached at minute 20, worn out by 50');
  assert.equal(m.at.bed, t0 + 30 * 60000);
  assert.equal(m.at.home, t0 + 40 * 60000, 'the later of the bed claimed and the stash placed');
});

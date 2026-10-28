'use strict';
// The user, 2026-10-24: 'add the ender chest as an option' (note 2058): its store kept through every death.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

function bot(items) {
  return { game: { gameMode: 'survival', dimension: 'overworld' }, entity: { position: new Vec3(10.5, 64, 0.5) },
    inventory: { items: () => items.map(([name, count]) => ({ name, count })), slots: [] },
    _survivalState: { spawnBed: { foot: { x: 0, y: 64, z: 0 } }, deaths: [] } };
}
const lit = { gameProgress: { milestones: { stronghold_located: { at: 1 } } }, endPortal: { neededEyes: 0 } };

test('an ender chest is offered with an eye to spare and the obsidian to be had, beside the bed slept in', () => {
  const { enderChestOption } = require('../src/strategy');
  const o = enderChestOption(bot([['ender_eye', 2], ['obsidian', 8]]), lit);
  assert.ok(o);
  assert.deepEqual(o.rung, { phase: 'ender_chest', action: 'acquire', item: 'ender_chest', count: 1 });
  assert.match(o.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Make an ender chest \(eight obsidian round an eye of ender: all 2 eyes carried are spare, the portal lit; 8 obsidian carried\) and put it beside the bed slept in, 10 blocks off\. What is put in it stays through every death/);
  assert.match(enderChestOption(bot([['ender_pearl', 1], ['blaze_rod', 1], ['diamond_pickaxe', 1], ['water_bucket', 1]]), lit).description, /an eye made from an ender pearl and blaze powder carried, the portal lit; the obsidian made from lava and water/);
  // Offered as soon as one eye is had or can be made, one of the portal's spent (the user, 2026-10-25, note 2086).
  assert.match(enderChestOption(bot([['ender_eye', 2], ['obsidian', 8]]), {}).description, /one of the 2 eyes carried, one of the \d+ the portal still wants: the pearl and half a rod are to get again \(on this run's clock so far the pearls took 0 minutes and the rods 0\)/);
  const clock = { gameProgress: { clock: { byDoing: { 'obtain_ender_pearls: hunt_mob': 40 * 60000, 'obtain_blaze_rods: find_fortress': 25 * 60000, 'obtain_blaze_rods: hunt_mob': 20 * 60000 } } } };
  assert.match(enderChestOption(bot([['ender_pearl', 1], ['blaze_rod', 1], ['obsidian', 8]]), clock).description, /an eye made from an ender pearl and blaze powder carried, one of the \d+ the portal still wants: .*the pearls took 40 minutes and the rods 45\)/);
  assert.equal(enderChestOption(bot([['ender_pearl', 1], ['obsidian', 8]]), {}), null, 'no rod or powder: no eye to be made');
  assert.equal(enderChestOption(bot([['ender_eye', 2]]), lit), null, 'no obsidian and no way to it');
  assert.equal(enderChestOption(bot([['ender_eye', 2], ['obsidian', 8]]), { ...lit, bedKit: { ender: true } }), null, 'one stands by the bed');
});

test('the chest by the bed, with an ender chest carried, is the ender chest', () => {
  const { bedKitChores } = require('../src/bed-kit');
  const registry = require('prismarine-registry')('26.1');
  const items = [{ name: 'ender_chest', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'stone_sword', count: 1 }, { name: 'iron_chestplate', count: 1 }];
  const slots = []; slots[6] = { name: 'iron_chestplate', count: 1 };
  const b = { registry, game: { dimension: 'overworld', gameMode: 'survival' }, entity: { position: new Vec3(701.5, 103, 294.5) }, inventory: { items: () => items, slots },
    _survivalState: { spawnBed: { foot: { x: 700, y: 103, z: 293 }, head: { x: 701, y: 103, z: 293 } }, deaths: [] },
    blockAt: p => (p.y < 103 ? { name: 'stone', boundingBox: 'block' } : p.y === 103 && (p.x === 700 || p.x === 701) && p.z === 293 ? { name: 'black_bed', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }) };
  const chores = bedKitChores(b, { kind: 'win', survival: {} });
  assert.ok(chores.kit_by_bed, Object.keys(chores).join(','));
  assert.match(chores.kit_by_bed.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Put the ender chest carried \(its store kept through every death and opened the same at any ender chest\) beside the bed slept in/);
});

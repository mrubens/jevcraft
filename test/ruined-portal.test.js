'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { fitRuin, frameCells, adopt } = require('../src/ruined-portal');
const { reservedForConstruction } = require('../src/build-sites');

// A world of named blocks around a ruin, grass below y 64, air above.
const world = named => {
  const registry = require('minecraft-data')('26.1');
  const nameAt = p => named.get(`${p.x},${p.y},${p.z}`) || (p.y < 64 ? 'grass_block' : 'air');
  return { registry, blockAt: p => ({ name: nameAt(p), position: p }),
    findBlocks: ({ matching, point, maxDistance }) => [...named.entries()].filter(([, n]) => registry.blocksByName[n]?.id === matching)
      .map(([k]) => new Vec3(...k.split(',').map(Number))).filter(p => !point || p.distanceTo(point) <= maxDistance) };
};

test('a ruined portal along z is fitted: the obsidian standing, the slots to fill, what to dig from inside', () => {
  // The user (2026-09-26): the ways into the Nether without diamonds, as Jev's choices.
  const o = new Vec3(10, 64, 20), cells = frameCells(o, 'z'), named = new Map();
  cells.blocks.slice(0, 7).forEach(p => named.set(`${p.x},${p.y},${p.z}`, 'obsidian'));
  named.set(`${cells.interior[0].x},${cells.interior[0].y},${cells.interior[0].z}`, 'netherrack');
  const fit = fitRuin(world(named), o);
  assert.equal(fit.axis, 'z');
  assert.deepEqual(fit.origin, o);
  assert.equal(fit.have, 7);
  assert.equal(fit.fill.length, 3);
  assert.deepEqual(fit.digs.map(String), [String(cells.interior[0])]);
  const frame = adopt(fit);
  assert.equal(frame.ruin, true); assert.equal(frame.blocks.length, 10); assert.equal(frame.interior.length, 6);
});

test('crying obsidian in a slot needs a diamond pickaxe: without one, only a frame that leaves it be', () => {
  const o = new Vec3(0, 64, 0), cells = frameCells(o, 'x'), named = new Map();
  cells.blocks.slice(0, 8).forEach(p => named.set(`${p.x},${p.y},${p.z}`, 'obsidian'));
  named.set(`${cells.blocks[8].x},${cells.blocks[8].y},${cells.blocks[8].z}`, 'crying_obsidian');
  const without = fitRuin(world(named), o);
  assert(!without || (without.have < 8 && !without.needsDiamond), 'no fit that needs the crying obsidian out');
  const fit = fitRuin(world(named), o, { diamondPickaxe: true });
  assert.equal(fit.have, 8); assert.equal(fit.needsDiamond, true);
});

test('the frame being finished is kept from other work along whichever axis it runs', () => {
  const goal = { portalFrame: { origin: { x: 10, y: 64, z: 20 }, axis: 'z' } };
  assert(reservedForConstruction(goal, { x: 10, y: 66, z: 23 }), 'along z, in the frame');
  assert(!reservedForConstruction(goal, { x: 13, y: 66, z: 20 }), 'three across is not the frame');
});

test('a ruin short of obsidian says the missing blocks are obsidian and what making them takes', () => {
  // mid-218-a: three of ten standing, told the rest were "placed like any block"; three hours on the diamond route.
  const { ruinSays } = require('../src/work');
  const k = { distance: 142, landmark: { obsidian: 3 } };
  const short = ruinSays(k, { obsidian: 0, diamonds: 6, diamondPickaxe: false });
  assert.match(short, /7 of the frame's ten are missing and are obsidian/);
  assert.match(short, /7 short; those are made by pouring water on lava and mined with a diamond pickaxe \(none carried; three diamonds make one, 6 carried\)/);
  assert.match(ruinSays(k, { obsidian: 8, diamonds: 0, diamondPickaxe: false }), /8 carried, enough/);
});

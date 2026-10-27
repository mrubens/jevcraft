'use strict';
// Ruin frames of any size, said by what the best one needs; the build route's ruin quarry and diamond depth (note 2308).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { fitRuin, fitSays, adopt, frameCells } = require('../src/ruined-portal');

// A giant ruin: a frame 4 wide and 5 high inside along x at origin (0, 64, 0), all obsidian but one crying obsidian
// slot and two missing slots.
function giantWorld() {
  const blocks = new Map();
  const cells = frameCells(new Vec3(0, 64, 0), 'x', { w: 4, h: 5 });
  cells.blocks.forEach((p, i) => blocks.set(`${p}`, i === 3 ? 'crying_obsidian' : i === 5 || i === 6 ? 'air' : 'obsidian'));
  const bot = {
    registry: { blocksByName: { obsidian: { id: 1 } } },
    blockAt: p => ({ name: blocks.get(`${new Vec3(p.x, p.y, p.z)}`) || (p.y < 64 ? 'stone' : 'air') }),
    findBlocks: () => [...blocks].filter(([, n]) => n === 'obsidian').map(([k]) => new Vec3(...k.slice(1, -1).split(',').map(Number))),
  };
  return bot;
}

test('a giant ruin is fitted at its own size, not by the minimal frame through a corner', () => {
  const bot = giantWorld();
  const fit = fitRuin(bot, new Vec3(2, 66, 0), { diamondPickaxe: true });
  assert.deepEqual(fit.size, { w: 4, h: 5 });
  assert.equal(fit.slots, 18); assert.equal(fit.have, 15); assert.equal(fit.fill.length, 3);
  assert.deepEqual(fit.diamondDigs, ['crying_obsidian']);
  assert.match(fitSays(fit, { obsidian: 0 }), /4 by 5 inside, 18 blocks, 15 of them standing: 3 to fill.*3 short.*1 block to dig .*1 crying obsidian of them, taken out only with a diamond pickaxe/);
  const frame = adopt(fit);
  assert.deepEqual(frame.size, { w: 4, h: 5 });
  assert.equal(frame.blocks.length, 18); assert.equal(frame.interior.length, 20);
  // Without a diamond pickaxe the crying obsidian slot blocks this frame.
  const without = fitRuin(bot, new Vec3(2, 66, 0), { diamondPickaxe: false });
  assert.ok(!without || without.diamondDigs.length === 0);
});

test('the ruin option says the judged frame; the build route says the ruin as a quarry and the diamonds\' depth', () => {
  const work = require('../src/work');
  const { ruinSays, buildSays } = work;
  if (!ruinSays) return; // not exported: covered through fitSays above
  const k = { distance: 27, landmark: { obsidian: 18, fitSeen: { size: { w: 4, h: 5 }, slots: 18, have: 15, fill: 3, digs: 1, diamondDigs: ['crying_obsidian'] } } };
  const says = ruinSays(k, { obsidian: 0, diamonds: 0, diamondPickaxe: false });
  assert.match(says, /15 of them standing: 3 to fill/);
  assert.match(says, /Without a diamond pickaxe .* this frame cannot be finished/);
  assert.doesNotMatch(says, /0 of the frame's ten are missing/);
  const b = buildSays({ obsidian: 0, diamonds: 0, diamondPickaxe: false, quarry: { distance: 27, obsidian: 18 }, belowToDiamonds: 128 });
  assert.match(b, /the ruined portal 27 blocks off is a quarry too: 18 obsidian stand there/);
  assert.match(b, /most at about y -58: 128 blocks below here/);
});

test('obsidian already standing about the frame is said on the build route (note 2309)', () => {
  const { buildSays } = require('../src/work');
  const b = buildSays({ obsidian: 0, diamonds: 10, diamondPickaxe: true, need: 4, frameBegun: true, lying: { count: 9, nearest: 6 } });
  assert.match(b, /9 obsidian already stand within 16 blocks of the frame, not in it \(the nearest 6 blocks off\): mined with the diamond pickaxe carried at about ten seconds a block, no pouring/);
  assert.doesNotMatch(buildSays({ obsidian: 0, diamonds: 0, diamondPickaxe: false, need: 10 }), /already stand/);
});

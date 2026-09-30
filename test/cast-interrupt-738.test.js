'use strict';
// Trial notes 738 (2026-09-30, 08:30-08:40Z critic window): 25584 and 25591
// left a cast frame's slot for "a lava pool" every time a mob interrupted
// the cast, and the "casting the portal frame" announcement gave no sign of
// whether that was the frame's first bucket or its ninth. The frame and its
// buckets carried were never actually lost across the interruption
// (goal.step, frame.cast and frame.castTemp are saved before every await
// that could throw), but the work claim Jev sees on resume named only the
// step's action and phase ("cast portal (obsidian), wall"), not what the
// frame already had or what was still needed. These tests hold the words
// Jev sees on resume to that: a cast_portal step now says how many of the
// ten are cast and what is carried toward the next one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { frameCells } = require('../src/ruined-portal');
const { workClaim } = require('../src/work');

const newFrame = (origin = new Vec3(-2, 49, 47)) => ({ origin, axis: 'x', cast: true, castTemp: [],
  blocks: frameCells(origin, 'x').blocks.map(p => ({ x: p.x, y: p.y, z: p.z })) });

// A frame with `n` of its ten slots already obsidian (the rest whatever
// castOrder found there, here plain stone).
function fakeBot(carried, frame, obsidianAt = []) {
  const items = Object.entries(carried).map(([name, count]) => ({ name, count }));
  const obsidian = new Set(obsidianAt.map(p => `${p.x},${p.y},${p.z}`));
  return { registry, entities: {}, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'overworld' },
    inventory: { items: () => items }, entity: { position: frame.origin, height: 1.8, width: 0.6 },
    blockAt: p => ({ name: obsidian.has(`${p.x},${p.y},${p.z}`) ? 'obsidian' : 'stone', boundingBox: 'block' }) };
}

test('a cast_portal step resumed after an interruption says how many of the ten are cast, not just its phase', () => {
  const frame = newFrame();
  const goal = { portalFrame: frame, step: { action: 'cast_portal', item: 'obsidian', slot: { x: -2, y: 49, z: 47 }, phase: 'wall' } };
  const bot = fakeBot({ lava_bucket: 1 }, frame, frame.blocks.slice(0, 4));
  const claim = workClaim(goal, bot);
  assert.match(claim.facts.doing, /cast portal \(obsidian\), wall/);
  assert.match(claim.facts.doing, /4 of ten cast/, `expected the frame's progress in: ${claim.facts.doing}`);
  assert.match(claim.facts.doing, /1 lava bucket carried toward the next/, `expected what is carried in: ${claim.facts.doing}`);
});

test('a cast_portal step with nothing cast yet and nothing carried says so plainly, not just the phase name', () => {
  const frame = newFrame();
  const goal = { portalFrame: frame, step: { action: 'cast_portal', item: 'obsidian', slot: { x: -2, y: 49, z: 47 }, phase: 'fetch_lava' } };
  const bot = fakeBot({}, frame, []);
  const claim = workClaim(goal, bot);
  assert.match(claim.facts.doing, /0 of ten cast/);
  assert.match(claim.facts.doing, /nothing carried toward the next/);
});

test('a cast resumed with both buckets in hand says both are carried', () => {
  const frame = newFrame();
  const goal = { portalFrame: frame, step: { action: 'cast_portal', item: 'obsidian', slot: { x: -2, y: 49, z: 47 }, phase: 'lava' } };
  const bot = fakeBot({ lava_bucket: 1, water_bucket: 1 }, frame, frame.blocks.slice(0, 9));
  const claim = workClaim(goal, bot);
  assert.match(claim.facts.doing, /9 of ten cast/);
  assert.match(claim.facts.doing, /1 lava bucket and 1 water bucket carried toward the next/);
});

test('a non-cast work step is said as before, with no frame progress appended', () => {
  const goal = { step: { action: 'fill_bucket', item: 'water_bucket' } };
  const claim = workClaim(goal, null);
  assert.equal(claim.facts.doing, 'fill bucket (water bucket)');
});

test('a cast_portal step with no bot to hand (shadow arbiter reads, or an early ruling) still says the phase, not throwing', () => {
  const frame = newFrame();
  const goal = { portalFrame: frame, step: { action: 'cast_portal', item: 'obsidian', slot: { x: -2, y: 49, z: 47 }, phase: 'wall' } };
  const claim = workClaim(goal, null);
  assert.equal(claim.facts.doing, 'cast portal (obsidian), wall');
});

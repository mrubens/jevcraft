'use strict';
// The one way to move the bot by holding keys instead of routing. Every
// fall on the live run came from code that did it by hand: the portal walk
// held forward for eight seconds through the portal and off its platform,
// the bridge stood upright at the end of its span, the step into a hole
// walked on when it missed, the walk to a drop went over a roof edge. Each
// needed its own edge rule and each missed a case. Here the rules are kept
// once:
//
//   - crouched by default: a sneaking player cannot walk off an edge. Not
//     crouching needs a reason, which is kept with the move.
//   - a stop condition, checked every tick, and a hard cap of five seconds.
//   - every key given back as it was, whatever happens.
//   - the move is named on the bot while it lasts, so the flight recorder
//     can say who was holding the keys.
//
// A test fails on any movement key held anywhere else.
const MOVEMENT = new Set(['forward', 'back', 'left', 'right', 'jump', 'sprint']);
const HORIZONTAL = new Set(['forward', 'back', 'left', 'right']);
const MAX_MS = 5000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const { Vec3 } = require('vec3');

// Fire and lava are never walked into on held keys. The pathfinder keeps
// off them (movement.js blocksToAvoid); a held key knows nothing of the
// cells ahead, and a crouch does not stop a drop into a cell with no
// collision box. mid-218-m-nether-3 came out of its portal into a soul sand
// valley at 7.7 health, and the step back out of the sheet (work.js
// enterPortal) went off the frame's edge into the soul fire in front: eight
// seconds of burning after it, and no water to be had in the Nether (note
// 502). The cells the body is about to take, and any it would drop through
// to the floor, are read every tick. A move that starts in fire or lava is
// a way out of it and is left alone.
const BURNING = new Set(['fire', 'soul_fire', 'lava']);
const HALF = 0.3;
const columnsAt = (x, z) => {
  const out = [];
  for (let cx = Math.floor(x - HALF); cx <= Math.floor(x + HALF); cx++) for (let cz = Math.floor(z - HALF); cz <= Math.floor(z + HALF); cz++) out.push([cx, cz]);
  return out;
};
const at = (bot, x, y, z) => bot.blockAt(new Vec3(x, y, z));
// A cell of the body, feet to head, in a column.
function bodyCell(bot, x, z, feet, head) {
  for (let y = head; y >= feet; y--) { const b = at(bot, x, y, z); if (BURNING.has(b?.name)) return { name: b.name, x, y, z }; }
  return null;
}
// The fall from under the feet to the first floor, in a column.
function dropCell(bot, x, z, below) {
  for (let y = below; y >= below - 4; y--) {
    const b = at(bot, x, y, z);
    if (!b) return null;
    if (BURNING.has(b.name)) return { name: b.name, x, y, z };
    if (b.boundingBox === 'block') return null;
  }
  return null;
}
// Feet, head, and the cell a standing body is held up by (soul sand's top
// is at .875, inside the feet's own cell).
const span = p => ({ feet: Math.floor(p.y + 0.01), head: Math.floor(p.y + 1.8), floor: Math.floor(p.y - 0.01) });
function bodyBurning(bot) {
  const p = bot.entity?.position;
  if (!p || typeof bot.blockAt !== 'function') return null;
  const { feet, head } = span(p);
  for (const [x, z] of columnsAt(p.x, p.z)) { const hit = bodyCell(bot, x, z, feet, head); if (hit) return hit; }
  return null;
}
// Half a block ahead and most of one: the body's cells in the columns it
// comes into, and, where nothing under the body holds it up there, the
// drop below them. A floor still under part of the body is a floor: a
// span over the lava sea is walked with the body's side over the lava.
function burningAhead(bot, keys) {
  const p = bot.entity?.position, yaw = bot.entity?.yaw;
  if (!p || typeof bot.blockAt !== 'function' || !Number.isFinite(yaw)) return null;
  // prismarine-physics: forward is (-sin yaw, -cos yaw), right (cos yaw, -sin yaw).
  const f = keys.includes('forward') - keys.includes('back'), s = keys.includes('right') - keys.includes('left');
  if (!f && !s) return null;
  let dx = -f * Math.sin(yaw) + s * Math.cos(yaw), dz = -f * Math.cos(yaw) - s * Math.sin(yaw);
  const n = Math.hypot(dx, dz); dx /= n; dz /= n;
  const now = new Set(columnsAt(p.x, p.z).map(c => `${c}`));
  const { feet, head, floor } = span(p);
  for (const reach of [0.5, 0.85]) {
    const cols = columnsAt(p.x + dx * reach, p.z + dz * reach);
    const fresh = cols.filter(c => !now.has(`${c}`));
    for (const [x, z] of fresh) { const hit = bodyCell(bot, x, z, feet, head); if (hit) return hit; }
    if (cols.some(([x, z]) => at(bot, x, floor, z)?.boundingBox === 'block')) continue;
    for (const [x, z] of fresh) { const hit = dropCell(bot, x, z, floor); if (hit) return hit; }
  }
  return null;
}

async function move(bot, task, { label, keys = ['forward'], sneak = true, why, look, until = () => false, guard = () => {}, maxMs = 1500, tick = 25 } = {}) {
  if (!label) throw new Error('A held-key move needs a name');
  for (const key of keys) if (!MOVEMENT.has(key)) throw new Error(`Not a movement key: ${key}`);
  if (!sneak && keys.some(key => HORIZONTAL.has(key)) && !why) throw new Error(`${label}: walking upright needs a reason`);
  const limit = Math.min(maxMs, MAX_MS);
  // Always yield once: a move whose goal is already met returns before its
  // first tick, and a loop of those never lets the connection's keepalive
  // through (the arena server timed the bot out mid-drill).
  await new Promise(resolve => setImmediate(resolve));
  if (look) await bot.lookAt(look, true);
  // The heading the move was aimed at, held for its whole length: mid-72-e
  // held forward to climb south out of a pool and was found facing north,
  // pressed against the far bank, ten times in ten minutes (2026-09-26).
  // Whatever turned it, the keys are pressed along the aim.
  const aim = look && Number.isFinite(bot.entity?.yaw) && typeof bot.look === 'function' ? { yaw: bot.entity.yaw, pitch: bot.entity.pitch } : null;
  task.check();
  const touched = [...new Set([...keys, ...(sneak ? ['sneak'] : [])])];
  const held = key => !!(bot.getControlState ? bot.getControlState(key) : bot.controlState?.[key]);
  const previous = Object.fromEntries(touched.map(key => [key, held(key)]));
  const controller = { name: label, keys: [...keys], sneak, why, since: Date.now() };
  bot._controller = controller;
  const escaping = !!bodyBurning(bot);
  const refused = () => {
    const hit = !escaping && burningAhead(bot, keys);
    if (!hit) return false;
    // Said on the bot, for the caller to go another way and say why.
    bot._moveRefused = controller.refused = { label, ...hit, at: Date.now() };
    console.log(`[motion] ${label}: ${hit.name.replace('_', ' ')} at (${hit.x}, ${hit.y}, ${hit.z}) ahead; not walked into`);
    return true;
  };
  try {
    if (refused()) return false;
    if (sneak) bot.setControlState('sneak', true);
    for (const key of keys) bot.setControlState(key, true);
    const started = Date.now();
    while (Date.now() - started < limit) {
      task.check(); guard();
      if (until()) return true;
      if (refused()) return false;
      if (aim && Math.abs(Math.atan2(Math.sin(bot.entity.yaw - aim.yaw), Math.cos(bot.entity.yaw - aim.yaw))) > 0.05) {
        controller.turned = (controller.turned || 0) + 1;
        if (controller.turned === 1) console.log(`[motion] ${label}: turned from ${aim.yaw.toFixed(2)} to ${bot.entity.yaw.toFixed(2)} mid-move; turned back`);
        // The keys let go while the heading is wrong, and pressed again once
        // it is right: held through the turn, they walk the bot the way it
        // was turned. mid-215-e's crossing on a span over the lava sea was
        // turned about by a swing at a hoglin behind it, and forward took it
        // off the other end, thirty-five blocks down (2026-09-26).
        for (const key of keys) if (HORIZONTAL.has(key)) bot.setControlState(key, false);
        await bot.look(aim.yaw, aim.pitch, true);
        for (const key of keys) if (HORIZONTAL.has(key)) bot.setControlState(key, true);
      }
      await sleep(tick);
    }
    return !!until();
  } finally {
    for (const key of touched) bot.setControlState(key, previous[key]);
    if (bot._controller === controller) bot._controller = null;
  }
}

module.exports = { move, burningAhead, bodyBurning, MOVEMENT, MAX_MS };

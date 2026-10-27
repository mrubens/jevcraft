'use strict';
// A place's height against the bot's and the walks toward it that failed, said beside a flat distance (note 2301).
// The user, watching full-10 (2026-10-27 16:4xZ) on a mountain: 'Seems lost on a mountain', then 'fix the sheep search.
// and anywhere else that ignores height'. The flocks were offered as '2 sheep, 49 blocks south-west' with nothing of
// the climb, and a flock 6 blocks above the bot at y 120 had two walks fail 'no route' before the next was chosen.
const RISE = 4;

// ', 34 blocks up' / ', 20 blocks down' / '' within a few blocks of the bot's height or with no height known.
function heightSays(bot, at) {
  const y = bot?.entity?.position?.y;
  if (!Number.isFinite(at?.y) || !Number.isFinite(y)) return '';
  const dy = Math.round(at.y - y);
  return Math.abs(dy) < RISE ? '' : `, ${Math.abs(dy)} blocks ${dy > 0 ? 'up' : 'down'}`;
}

// '; 2 walks toward it from about here failed (no route)' / '' from the bot's own record of walks.
function wayFailedSays(bot, at) {
  let fails = [];
  try {
    const fp = require('./failed-places');
    fails = fp.failedWalks(bot).filter(w => w.goal && w.from && Math.hypot(w.goal.x - at.x, w.goal.z - at.z) <= fp.TARGET_NEAR && Math.hypot(w.from.x - bot.entity.position.x, w.from.z - bot.entity.position.z) <= fp.HERE);
  } catch (_) { fails = []; }
  if (!fails.length) return '';
  const kinds = [...new Set(fails.map(w => String(w.kind || w.why || 'failed').replaceAll('_', ' ')))].slice(0, 2).join(', ');
  return `; ${fails.length} walk${fails.length === 1 ? '' : 's'} toward it from about here failed (${kinds})`;
}

// The ground's top at a column, looked for within 64 above and below the bot, or null where it is not loaded.
function groundAt(bot, x, z) {
  const here = bot?.entity?.position;
  if (!here || typeof bot.blockAt !== 'function') return null;
  const { Vec3 } = require('vec3');
  for (let y = Math.min(319, Math.floor(here.y) + 64); y >= Math.max(-64, Math.floor(here.y) - 64); y--) {
    const b = bot.blockAt(new Vec3(Math.floor(x), y, Math.floor(z)));
    if (!b) return null;
    if (b.boundingBox === 'block' && !/leaves|log$/.test(b.name)) return y + 1;
  }
  return null;
}

module.exports = { heightSays, wayFailedSays, groundAt, RISE };

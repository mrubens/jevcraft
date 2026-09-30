'use strict';
// The hits the bot has taken lately, by source (note 752b).
//
// 25594 (mid-239-bd, 13:04:38 to 13:05:08Z) went from 20 to 0 in 27 seconds
// looting a chest at y 13: a skeleton six blocks off landed the hits, but at
// 4 health every stance option opened "The spider 18 blocks off, the hardest
// hitter ..." (blowsSay ranks biters by blow and reach, and leaves a shooter
// out), and shot_answer's shield_up and keep_on said nothing of the two hits
// that landed with the shield up (13 to 9, 2 to 0), from a side the shield
// did not face: a second attacker. What is hitting the bot now, and from
// where, is the first fact of any question about the mobs.
const KEEP_MS = 60000, RECENT_MS = 20000;

// Where a point lies from the bot as it faces: in front, to the left, to
// the right or behind (mineflayer's yaw: facing (-sin yaw, -cos yaw)).
function sideOf(bot, p) {
  const e = bot?.entity;
  if (!e?.position || !p || !Number.isFinite(e.yaw)) return null;
  const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
  const dx = p.x - e.position.x, dz = p.z - e.position.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return null;
  const dot = (fx * dx + fz * dz) / len, cross = (fx * dz - fz * dx) / len;
  if (dot >= 0.5) return 'in front';
  if (dot <= -0.5) return 'behind';
  return cross > 0 ? 'to the right' : 'to the left';
}

// One hit, as the hurt listener sees it (survival.js).
function note(bot, source, now = Date.now()) {
  if (!bot) return;
  const shield = !!bot._shieldRaised;
  const entry = { at: now, name: source?.name || null, id: source?.id ?? null, health: bot.health ?? null, shield,
    side: source?.position ? sideOf(bot, source.position) : null };
  bot._hitLog = [...(bot._hitLog || []).filter(h => now - h.at < KEEP_MS), entry];
}

// Every fall of health, whatever the server named as its source (note
// 752d): 25598 (15:00:36 to 15:00:41Z) fell 19.1 to 6.7 in nine blows of
// 1.4 with the shield up, two zombies about, one behind; the stance was
// told "2 hits in the last 20 seconds" of the one named. The hurt event
// names a source only where the server's damage event came with one.
function install(bot) {
  if (!bot || bot._hitLogHealth || typeof bot.on !== 'function') return;
  let last = bot.health;
  bot._hitLogHealth = () => {
    const hp = bot.health, now = Date.now();
    if (Number.isFinite(last) && Number.isFinite(hp) && hp < last - 0.05) noteDrop(bot, last, hp, now);
    last = hp;
  };
  bot.on('health', bot._hitLogHealth);
}
function noteDrop(bot, from, to, now = Date.now()) {
  bot._dropLog = [...(bot._dropLog || []).filter(d => now - d.at < KEEP_MS), { at: now, from, to, shield: !!bot._shieldRaised }];
}
function drops(bot, { now = Date.now(), ms = RECENT_MS } = {}) {
  return (bot?._dropLog || []).filter(d => now - d.at <= ms);
}

function recent(bot, { now = Date.now(), ms = RECENT_MS } = {}) {
  return (bot?._hitLog || []).filter(h => now - h.at <= ms);
}

// The mobs that hit the bot lately, most hits first, each with where it is
// now when it is in `list` (danger.js threats' shape).
function hitters(bot, list = [], { now = Date.now(), ms = RECENT_MS } = {}) {
  const by = new Map();
  for (const h of recent(bot, { now, ms })) {
    if (!h.name) continue;
    const k = h.id ?? h.name;
    const e = by.get(k) || { name: h.name, id: h.id, hits: 0, last: 0, sides: new Set(), shielded: 0 };
    e.hits++; e.last = Math.max(e.last, h.at); if (h.side) e.sides.add(h.side); if (h.shield) e.shielded++;
    by.set(k, e);
  }
  return [...by.values()].map(e => ({ ...e, t: (list || []).find(t => t.entity?.id === e.id) || (list || []).filter(t => t.entity?.name === e.name).sort((a, b) => a.distance - b.distance)[0] || null }))
    .sort((a, b) => b.hits - a.hits || b.last - a.last);
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// "Hitting the bot now: ..." with each hitter's hits, the last, where it is
// and the side; and a hit taken with the shield up, from a side the shield
// did not face, said as a second attacker. '' when nothing hit lately.
function says(bot, list = [], { now = Date.now(), ms = RECENT_MS } = {}) {
  const hs = hitters(bot, list, { now, ms });
  const ds = drops(bot, { now, ms });
  const named = hs.reduce((n, h) => n + h.hits, 0);
  // The blows by the health itself, where more fell than were named.
  const r1 = v => Math.round(v * 10) / 10;
  const fell = ds.length > named ? ` Health fell ${ds.length} times in the last ${Math.round(ms / 1000)} seconds, ${r1(ds[0].from)} to ${r1(ds.at(-1).to)} health${ds.every(d => d.shield) ? ', every one with the shield up' : ds.some(d => d.shield) ? `, ${ds.filter(d => d.shield).length} with the shield up` : ''}${named ? `; the server named the source of ${named}` : ''}.` : '';
  if (!hs.length) return fell ? `Hitting the bot now:${fell}` : '';
  const each = hs.slice(0, 3).map(h => {
    const where = h.t ? `${Math.round(h.t.distance * 10) / 10} blocks off${h.t.visible === false ? ', out of sight' : ''}` : 'not in view now';
    const sides = h.sides.size ? `, from ${[...h.sides].join(' and ')}` : '';
    const shield = h.shielded ? `; ${h.shielded === h.hits ? (h.hits === 1 ? 'it' : 'each') : h.shielded} landed with the shield up` : '';
    return `the ${String(h.name).replaceAll('_', ' ')} ${where} (${plural(h.hits, 'hit')} in the last ${Math.round(ms / 1000)} seconds, the last ${Math.max(0, Math.round((now - h.last) / 1000))} seconds ago${sides}${shield})`;
  });
  const shieldedBehind = recent(bot, { now, ms }).filter(h => h.shield && h.side && h.side !== 'in front');
  const second = shieldedBehind.length ? ` A hit landed with the shield up from ${[...new Set(shieldedBehind.map(h => h.side))].join(' and ')}: the shield covers only the side the bot faces, so something there is striking too.` : '';
  return `Hitting the bot now: ${each.join('; ')}.${fell}${second}`;
}

module.exports = { install, note, noteDrop, drops, recent, hitters, says, sideOf, RECENT_MS };

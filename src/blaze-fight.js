'use strict';
// The fight with the blazes here, as it has gone (note 2540): when it began (a blaze first within 24 blocks of here),
// the blazes killed since and under what stance, how many are about now and the most at once. full-114 (25587,
// 2026-10-29 19:46 to 20:03Z) stood fifteen minutes boxed by its spawner (box in line, box here, dig down, hold box),
// no blaze killed, the spawner going on spawning until fourteen were about, and was fireballed dead; each stance was
// asked with nothing said of how the fight had gone. full-116 (25588, 19:49Z) had its rod a minute after charging.
const NEAR = 24, PLACE = 32, GONE_MS = 3 * 60000, KEEP_MS = 30 * 60000;

function fight(bot) { return (bot._blazeFight ||= { installed: false, current: null, kills: [] }); }
const blazesNear = bot => Object.values(bot.entities || {}).filter(e => e?.name === 'blaze' && e.isValid !== false && e.position && bot.entity?.position && e.position.distanceTo(bot.entity.position) <= NEAR);
const stanceNow = bot => bot._goal?.survivalAction?.stance ? bot._goal.survivalAction.action : (bot._goal?.survivalAction?.action || null);

// The fight's record brought up to now: begun where a blaze is near and none was a while, kept while they are.
function look(bot, now = Date.now()) {
  const f = fight(bot), here = bot.entity?.position;
  if (!here) return f.current;
  const near = blazesNear(bot);
  const c = f.current;
  if (c && (now - c.lastSeen > GONE_MS || Math.hypot(here.x - c.x, here.z - c.z) > PLACE)) f.current = null;
  if (near.length) {
    if (!f.current) f.current = { x: here.x, y: here.y, z: here.z, began: now, lastSeen: now, most: near.length, dimension: bot.game?.dimension };
    f.current.lastSeen = now; f.current.most = Math.max(f.current.most, near.length);
  }
  return f.current;
}

function install(bot) {
  const f = fight(bot);
  if (f.installed) return;
  f.installed = true;
  const tick = setInterval(() => { try { look(bot); } catch (_) { /* none */ } }, 5000); tick.unref?.();
  bot.once?.('end', () => clearInterval(tick));
  bot.on('entityDead', e => {
    try {
      if (e?.name !== 'blaze' || !bot.entity?.position || !e.position || e.position.distanceTo(bot.entity.position) > NEAR) return;
      const now = Date.now(), c = look(bot, now);
      f.kills = [...f.kills.filter(k => now - k.at < KEEP_MS), { at: now, stance: stanceNow(bot), step: bot._goal?.step?.action || null, x: e.position.x, z: e.position.z }];
      console.log(`[blaze] one killed ${Math.round(e.position.distanceTo(bot.entity.position))} blocks off under ${String(stanceNow(bot) || bot._goal?.step?.action || 'nothing').replaceAll('_', ' ')}${c ? `, ${killsIn(bot, c).length} in this fight of ${Math.round((now - c.began) / 60000)} minutes` : ''}`);
    } catch (_) { /* a record only */ }
  });
}

function killsIn(bot, c) { return fight(bot).kills.filter(k => k.at >= c.began && Math.hypot(k.x - c.x, k.z - c.z) <= PLACE + NEAR); }

// The fact for a question asked with blazes about, or null.
function says(bot, now = Date.now()) {
  const c = look(bot, now);
  if (!c) return null;
  const kills = killsIn(bot, c), minutes = Math.max(0, Math.round((now - c.began) / 60000)), about = blazesNear(bot).length;
  const by = {};
  for (const k of kills) { const s = String(k.stance || k.step || 'nothing').replaceAll('_', ' '); by[s] = (by[s] || 0) + 1; }
  const last = kills.at(-1);
  return `The fight with the blazes here began ${minutes ? `${minutes} minute${minutes === 1 ? '' : 's'}` : 'under a minute'} ago (a blaze first within ${NEAR} blocks): ${kills.length ? `${kills.length} killed since (${Object.entries(by).map(([s, n]) => `${n} under ${s}`).join(', ')}), the last ${Math.max(1, Math.round((now - last.at) / 60000))} minute${Math.round((now - last.at) / 60000) > 1 ? 's' : ''} ago` : 'none killed since'}; ${about} about within ${NEAR} now, the most at once ${c.most}. A spawner goes on spawning while the blazes it made live, up to about six near it.`;
}

module.exports = { install, look, says, NEAR };

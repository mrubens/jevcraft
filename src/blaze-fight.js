'use strict';
// The fight with the blazes here, as it has gone (note 2540): when it began (a blaze first within 24 blocks of here),
// the blazes killed since and under what stance, how many are about now and the most at once. full-114 (25587,
// 2026-10-29 19:46 to 20:03Z) stood fifteen minutes boxed by its spawner (box in line, box here, dig down, hold box),
// no blaze killed, the spawner going on spawning until fourteen were about, and was fireballed dead; each stance was
// asked with nothing said of how the fight had gone. full-116 (25588, 19:49Z) had its rod a minute after charging.
// The day's kills by stance (note 2557): full-139 (25589, 2026-10-30 01:2xZ) held box here 108 seconds by its spawner, 14 of
// 20 health gone, none killed, and burned dead; across the day's logs every '[blaze] one killed' came under charge
// nearest, close in or take cover.
// The despawn (note 2542): full-116 (25588, 2026-10-29 20:4xZ) came back from its food trip to fifteen blazes about its
// spawner, none killed in two minutes, and was slain; how a crowd that big goes away was not said.
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
  // What each stance of this fight has cost and come to (note 2554): full-130 (25590, 2026-10-30 00:4xZ) had its six
  // kills under close in, charge nearest and take cover, then held back to wall and corner ambush with 14 to 19 blazes
  // about, 7.9 health gone in 23 seconds under the ambush, and was burned dead with 3 rods; full-125 the same at 31.
  const held = {};
  for (const e of (bot._stanceLedger || []).filter(e => e.since >= c.began)) {
    const k = String(e.choice).replaceAll('_', ' '), h = held[k] ||= { seconds: 0, lost: 0 };
    h.seconds += e.seconds; h.lost += e.lost;
  }
  const costs = Object.entries(held).filter(([, h]) => h.seconds >= 5).map(([k, h]) => `${k} held ${h.seconds >= 90 ? `${Math.round(h.seconds / 60)} minutes` : `${Math.round(h.seconds)} s`}, ${Math.round(h.lost * 10) / 10} health lost, ${by[k] || 0} killed`);
  return `The fight with the blazes here began ${minutes ? `${minutes} minute${minutes === 1 ? '' : 's'}` : 'under a minute'} ago (a blaze first within ${NEAR} blocks): ${kills.length ? `${kills.length} killed since (${Object.entries(by).map(([s, n]) => `${n} under ${s}`).join(', ')}), the last ${Math.max(1, Math.round((now - last.at) / 60000))} minute${Math.round((now - last.at) / 60000) > 1 ? 's' : ''} ago` : 'none killed since'}; ${about} about within ${NEAR} now, the most at once ${c.most}.${costs.length ? ` Each stance in this fight so far: ${costs.join('; ')}.` : ''} A spawner goes on spawning while the blazes it made live, up to about six near it. On the full runs of 2026-10-29 and 30 the blazes killed came under charge nearest (17), close in (7) and take cover (1), and none under any other stance: box here, box in line, corner ambush, await in reach, back to wall, dig down and seal were held minutes at a time with none killed, while the blazes about grew.${about >= 6 || c.most >= 6 ? ` Blazes, the spawner's as any, despawn as other hostile mobs do: every one at once with the bot more than 128 blocks off, and at random, most within a minute or so, with it more than 32 off; within 32 they stay.` : ''}`;
}

module.exports = { install, look, says, NEAR };

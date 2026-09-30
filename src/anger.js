'use strict';
// A neutral mob turned on the bot, and why (note 703).
//
// 25592 (mid-242-dc-fortress-25) died at 00:09:50Z with 4 of 7 rods: the
// stance chosen was box_here with five zombified piglins within fifteen
// blocks, the nearest 2.9 blocks off, none of them in any option (calm ones
// are no threat), and 2 s later three of them took it from 20 to none. The
// box's builder swings at what is in reach (blaze-tactics strikeInReach),
// and a zombified piglin was on its list whether angry or not. A hit on one
// brings every one of its kind within its follow range (35 blocks across,
// 10 up or down) on the player who struck, for 20 to 39 seconds, longer
// while they see the player (the game's ZombifiedPiglin.alertOthers and its
// persistent anger); a piglin struck brings the adult piglins about it.
// Before this, the bot counted one as angry only after one of its kind had
// hurt the bot.
//
// Here: the bot's own hit on one, from the server's damage event (the
// source is the bot), angers it and its group about where it was struck;
// and one with its arms up (the mob flags' aggressive bit, set while it is
// attacking a target) coming at the bot or at its reach is hunting the bot,
// whatever turned it. Each is said with why.

// Its group, how far its call reaches (across, and up or down), and how
// long the anger lasts after the last hit (the game's longest).
const GROUP = {
  zombified_piglin: { across: 35, up: 10, ms: 40000 },
  piglin: { across: 16, up: 16, ms: 30000 },
};
// One hunting the bot: its arms up and a block a second nearer, or within
// four blocks.
const CLOSING = 1, AT = 4, TRACK_MS = 2000, TRACK_MIN_MS = 400;
const AGGRESSIVE = 0x04;

const words = s => String(s || '').replaceAll('_', ' ');
const secs = ms => Math.max(1, Math.round(ms / 1000));

// The server's word that something was hurt, and by whom: the bot's hit on
// a neutral of a group angers it and the group about it.
function heard(bot, packet, now = Date.now()) {
  const me = bot?.entity?.id;
  if (me === undefined || !packet) return null;
  const by = [packet.sourceCauseId, packet.sourceDirectId].map(n => Number.isFinite(n) ? n - 1 : null);
  if (!by.includes(me) || packet.entityId === me) return null;
  const e = bot.entities?.[packet.entityId];
  if (!e?.name || !GROUP[e.name] || !e.position) return null;
  const struck = bot._struckNeutral ||= {};
  struck[e.name] = { id: e.id, at: now, x: e.position.x, y: e.position.y, z: e.position.z };
  return struck[e.name];
}
function install(bot) {
  if (!bot?._client?.on || bot._angerHeard) return;
  bot._angerHeard = true;
  bot._client.on('damage_event', packet => { try { heard(bot, packet); } catch (_) { /* heard next time */ } });
}

// The aggressive bit of the mob flags: the game sets it while a mob's melee
// goal runs at a target (MeleeAttackGoal.start), and clears it when it stops.
function aggressive(bot, e) {
  const keys = bot?.registry?.entitiesByName?.[e?.name]?.metadataKeys;
  const i = Array.isArray(keys) ? keys.indexOf('mob_flags') : -1;
  const v = i >= 0 ? e.metadata?.[i] : undefined;
  return typeof v === 'number' && (v & AGGRESSIVE) !== 0;
}
// How much nearer to the bot it has come, blocks a second, over the last
// second or two.
function closing(bot, e, now) {
  const here = bot.entity?.position, p = e.position;
  if (!here || !p) return 0;
  const tracks = bot._neutralTracks ||= new Map();
  const samples = tracks.get(e.id) || [];
  if (!samples.length || now - samples.at(-1).at >= 100) samples.push({ at: now, x: p.x, y: p.y, z: p.z });
  while (samples.length && now - samples[0].at > TRACK_MS + 500) samples.shift();
  tracks.set(e.id, samples);
  if (tracks.size > 128) for (const [id, s] of tracks) if (!s.length || now - s.at(-1).at > 5000) tracks.delete(id);
  const old = samples.find(s => now - s.at <= TRACK_MS && now - s.at >= TRACK_MIN_MS);
  if (!old) return 0;
  const was = Math.hypot(old.x - here.x, old.y - here.y, old.z - here.z), is = p.distanceTo(here);
  return (was - is) / ((now - old.at) / 1000);
}

// Why this neutral is after the bot, or null.
function angerOf(bot, e, now = Date.now()) {
  const g = GROUP[e?.name];
  if (!g || !e.position || e.isValid === false) return null;
  const s = bot?._struckNeutral?.[e.name];
  if (s && now - s.at < g.ms) {
    if (s.id === e.id) return { why: `the bot struck it ${secs(now - s.at)} seconds ago`, struck: true };
    if (Math.hypot(e.position.x - s.x, e.position.z - s.z) <= g.across && Math.abs(e.position.y - s.y) <= g.up)
      return { why: `the bot struck one of its group ${secs(now - s.at)} seconds ago, ${Math.round(e.position.distanceTo(s))} blocks from it`, struck: true };
  }
  if (bot?._hurtBy?.[e.name] > now - g.ms) return { why: `one of them hit the bot ${secs(now - bot._hurtBy[e.name])} seconds ago` };
  if (aggressive(bot, e)) {
    const d = bot.entity?.position ? e.position.distanceTo(bot.entity.position) : Infinity;
    const c = closing(bot, e, now);
    if (d <= AT || c >= CLOSING) return { why: d <= AT ? `its arms are up, ${Math.round(d * 10) / 10} blocks off` : `its arms are up and it is coming at the bot, ${Math.round(c * 10) / 10} blocks a second` };
  } else closing(bot, e, now);
  return null;
}
const angry = (bot, e, now = Date.now()) => !!angerOf(bot, e, now);

// Said of an angry one where a mob's reach is said: it hunts the bot, and
// its group with it, by any way round.
function angrySays(bot, e, now = Date.now()) {
  const a = angerOf(bot, e, now);
  if (!a) return null;
  const g = GROUP[e.name];
  return `angry (${a.why}): it hunts the bot with its group, any way round, from up to ${g.across} blocks, while the anger lasts`;
}

// The calm ones close by, for the stance: what a swing near them costs.
function calmAbout(bot, radius = 8, now = Date.now()) {
  const here = bot?.entity?.position;
  if (!here) return null;
  const calm = Object.values(bot.entities || {}).filter(e => GROUP[e?.name] && e.position && e.isValid !== false && e.position.distanceTo(here) <= radius && !angry(bot, e, now)
    && !(e.name === 'piglin' && !wearsGold(bot)));
  if (!calm.length) return null;
  const by = {};
  for (const e of calm) (by[e.name] ||= []).push(Math.round(e.position.distanceTo(here) * 10) / 10);
  return Object.entries(by).map(([name, ds]) => `${ds.length} ${words(name)}${ds.length === 1 ? '' : 's'} within ${radius} (nearest ${Math.min(...ds)}), not angry: a hit on one, a sword's sweep too, turns every one within ${GROUP[name].across} blocks on the bot`).join('; ');
}
const wearsGold = bot => [5, 6, 7, 8].some(slot => /^golden_/.test(bot.inventory?.slots?.[slot]?.name || ''));

module.exports = { GROUP, heard, install, aggressive, angerOf, angry, angrySays, calmAbout };

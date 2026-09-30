'use strict';
// A question asked round and round goes up (note 749).
//
// The live critic of 11:14Z on 2026-09-30, item 1: 25594 asked sheep_search
// 67 times in 13 minutes, about every 5 seconds, pacing a box of forest and
// jungle 40 by 75 blocks: 1,382 blocks walked, ending 46 from where it began,
// none_good Jev's likeliest answer at 52 of the 67. Every rule before this
// one judges an answer "from about here" (four blocks: the ledger, tried.js;
// the least bad, least-bad.js; none good spent, repeats.js) or "with the same
// facts" (unchanged.js, repeats.js): a loop that walks 25 blocks between
// askings meets neither, and was asked as if each asking were the first.
//
// Here each question about playing the game keeps its spell: its askings,
// each within SPELL_GAP_MS of the one before, with where the first was asked,
// what was carried then, how far the bot has walked since, and how many times
// none_good was Jev's likeliest answer. At the next asking:
//   - from the third asking of a spell on, it is said in the facts
//     (spellSoFar): "asked N times in the last M minutes, each within a
//     minute of the one before; walked W blocks and is D from where these
//     askings began; nothing new carried; none of its options was good at K";
//   - and the spell goes up, to the question above (define's `parent`), with
//     that said and the answers it gave resting from here, when either:
//       none_good was the likeliest answer at NONE_GOOD_TOPS or more of its
//       last NONE_GOOD_OF askings (Jev saying the move is missing, again and
//       again, wherever the bot has walked meanwhile); or
//       it has gone nowhere: NOWHERE_ASKS askings or more over NOWHERE_MS or
//       more, and the bot is fewer than NOWHERE_BLOCKS from where the spell
//       began with nothing new carried.
//   A question with nothing above, or one whose answers come at every turn
//   of an emergency (the stance, the body's way, the shield, the routing),
//   is said, never sent up.

const SPELL_GAP_MS = 60000;
const SAID_FROM = 3;
const NONE_GOOD_TOPS = 3;
const NONE_GOOD_OF = 5;
const NOWHERE_ASKS = 6;
const NOWHERE_MS = 90000;
const NOWHERE_BLOCKS = 48;
// Or this many askings going nowhere, however quick (note 749b: 25591's 25
// in 70 seconds never reached the ninety).
const NOWHERE_ASKS_ANY = 12;
// Said, never sent up (index.js SAY_ONLY and NEVER_HELD).
const NOT_SENT_UP = new Set(['turn_priority', 'stillness_detour', 'encounter_stance', 'shot_answer', 'body_way', 'ranged_response']);

const words = s => String(s || '').replaceAll('_', ' ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const span = ms => ms < 90000 ? plural(Math.max(1, Math.round(ms / 1000)), 'second') : plural(Math.round(ms / 60000), 'minute');
const P = v => v && Number.isFinite(v.x) ? { x: v.x, y: v.y, z: v.z } : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dim = bot => String(bot?.game?.dimension || '').replace(/^minecraft:/, '');
const off = () => process.env.JEV_LOOPS === '0';

// What is carried, by kind: a spell that brought a new kind of thing, or more
// of what is worth keeping, went somewhere.
function carriedOf(bot) {
  const kinds = {};
  try { for (const i of bot?.inventory?.items?.() || []) kinds[i.name] = (kinds[i.name] || 0) + i.count; } catch (_) { /* no inventory */ }
  return { kinds, health: Number.isFinite(bot?.health) ? bot.health : null };
}
// More of a thing already carried past what is worth keeping (inventory-
// tidy.js capOf) is not a gain (note 749b): 25591's night mine dug coal at
// 135 to 148 carried, 25 askings in 70 seconds, and each coal read as the
// spell going somewhere. Nor the blocks that fill a tunnel (FILLER).
// Where no cap is kept, a full stack: 25591's lapis went 65 to 69 in the
// same spell, 'enchanting', which nothing on the ladder does.
const STACK = 64;
const capOf = name => { let c; try { c = require('../inventory-tidy').capOf(name); } catch (_) { c = undefined; } return c ?? STACK; };
const filler = name => { try { return require('../stillness').FILLER?.test(name); } catch (_) { return false; } };
function gainedSince(a, b) {
  if (!a || !b) return null;
  const fresh = Object.keys(b.kinds).filter(k => !a.kinds[k] && !filler(k));
  if (fresh.length) return `${fresh.slice(0, 3).map(words).join(', ')} now carried`;
  const more = Object.keys(b.kinds).filter(k => b.kinds[k] > (a.kinds[k] || 0) && !filler(k) && !((a.kinds[k] || 0) >= capOf(k)));
  if (more.length) return `more ${more.slice(0, 3).map(words).join(', ')} carried`;
  return null;
}
const surplusSays = (a, b) => {
  const past = Object.keys(b?.kinds || {}).filter(k => !filler(k) && b.kinds[k] > (a?.kinds?.[k] || 0) && (a?.kinds?.[k] || 0) >= capOf(k));
  return past.length ? `; more ${past.map(k => `${words(k)} (${b.kinds[k]} carried, past the ${capOf(k)} worth keeping)`).join(', ')}, which is not a gain` : '';
};

// The judgment over a spell as it stands, at `here` with `carried`.
// -> { says, why } (why: the reason it goes up, or null)
function judge(s, { here, carried, now }) {
  const n = s.n, ms = now - s.first;
  const net = s.start.p && here ? Math.round(dist(s.start.p, here)) : null;
  const walked = Math.round(s.walked + (s.lastP && here ? dist(s.lastP, here) : 0));
  const gained = gainedSince(s.start.carried, carried);
  const top = Object.entries(s.choices).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${words(k)} ${plural(v, 'time')}`).join(', ');
  const says = `asked ${plural(n, 'time')} in the last ${span(ms)}, each within ${span(SPELL_GAP_MS)} of the one before (answered ${top})` +
    `${net !== null ? `; the bot walked ${plural(walked, 'block')} meanwhile and is ${plural(net, 'block')} from where these askings began` : ''}` +
    `; ${gained ? gained : 'nothing new carried since the first of them'}${surplusSays(s.start.carried, carried)}` +
    `${Number.isFinite(s.start.carried?.health) && Number.isFinite(carried?.health) && Math.round(carried.health) !== Math.round(s.start.carried.health) ? `; health ${Math.round(s.start.carried.health)} then, ${Math.round(carried.health)} now` : ''}` +
    `${s.ng ? `; none of its options was good at ${s.ng} of them` : ''}`;
  let why = null;
  const lately = (s.tops || []).slice(-NONE_GOOD_OF), ngLately = lately.filter(Boolean).length;
  if (ngLately >= NONE_GOOD_TOPS) why = `none of its options was good at ${ngLately} of its last ${lately.length} askings`;
  else if (n >= NOWHERE_ASKS && (ms >= NOWHERE_MS || n >= NOWHERE_ASKS_ANY) && net !== null && net < NOWHERE_BLOCKS && !gained) why = `${n} askings over ${span(ms)} have gone nowhere: ${plural(net, 'block')} from where they began with nothing new carried`;
  return { says, why, net, walked, gained };
}

// Before asking `id`: its spell, if this asking continues one.
// -> null or { n, says, why, choices }
function before(bot, id, { now = Date.now() } = {}) {
  if (off() || !bot) return null;
  const s = bot._spells?.[id];
  if (!s) return null;
  if (now - s.last > SPELL_GAP_MS || (s.dimension && dim(bot) && s.dimension !== dim(bot))) { delete bot._spells[id]; return null; }
  const j = judge({ ...s, n: s.n + 1 }, { here: P(bot.entity?.position), carried: carriedOf(bot), now });
  return { n: s.n + 1, says: j.says, why: NOT_SENT_UP.has(id) ? null : j.why, choices: Object.keys(s.choices), said: s.n + 1 >= SAID_FROM || !!j.why };
}

// After an answer: the spell goes on, or begins.
function after(bot, id, { choice, noneGoodTop = false, now = Date.now() } = {}) {
  if (off() || !bot || !choice) return;
  const memo = bot._spells ||= {};
  const here = P(bot.entity?.position);
  let s = memo[id];
  if (!s || now - s.last > SPELL_GAP_MS || (s.dimension && dim(bot) && s.dimension !== dim(bot))) {
    s = memo[id] = { first: now, last: now, n: 0, ng: 0, tops: [], walked: 0, lastP: here, start: { p: here, carried: carriedOf(bot) }, dimension: dim(bot) || null, choices: {} };
  }
  if (s.lastP && here) s.walked += dist(s.lastP, here);
  s.lastP = here; s.last = now; s.n++;
  if (noneGoodTop) s.ng++;
  s.tops = [...(s.tops || []), !!noneGoodTop].slice(-NONE_GOOD_OF);
  s.choices[choice] = (s.choices[choice] || 0) + 1;
}
function reset(bot, id) { if (bot?._spells) delete bot._spells[id]; }

// The rule over recorded asks (scripts/ask-loops.js): each ask { t, id,
// choice, pos, dimension, inventory, noneGood } in order. Returns the asks
// that would have been sent, and why others were not: an ask at which a spell
// goes up is not sent (the question above is asked in its place); from there
// the answers that spell gave rest from about there (NEAR) for REST_MS, so
// the recorded asks after it that chose one of them from about there were
// asked with that answer not on offer (counted apart: what Jev would have
// chosen instead is not in the record).
const parentOf = id => { try { return require('./index').question(id).parent || null; } catch (_) { return null; } };
function replay(asks, { restMs = 5 * 60000, near = 4 } = {}) {
  const sent = [], why = { wentUp: 0, askedWithoutRested: 0 }, ups = [];
  const bots = {};
  const botOf = a => {
    const b = bots.x ||= { entity: { position: null }, game: { dimension: null }, inventory: { items: () => [] } };
    b.entity.position = a.pos; b.game.dimension = a.dimension;
    b.inventory = { items: () => Object.entries(a.inventory || {}).map(([name, count]) => ({ name, count })) };
    return b;
  };
  const rests = [];
  for (const a of asks) {
    const bot = botOf(a);
    const r = NOT_SENT_UP.has(a.id) || !parentOf(a.id) ? null : before(bot, a.id, { now: a.t });
    if (r?.why) {
      why.wentUp++;
      ups.push({ t: a.t, id: a.id, n: r.n, why: r.why, says: r.says });
      for (const c of r.choices) rests.push({ id: a.id, choice: c, at: a.t, pos: a.pos });
      reset(bot, a.id);
      continue;
    }
    if (rests.some(x => x.id === a.id && x.choice === a.choice && a.t - x.at < restMs && x.pos && a.pos && dist(x.pos, a.pos) <= near)) why.askedWithoutRested++;
    sent.push(a);
    after(bot, a.id, { choice: a.choice, noneGoodTop: !!a.noneGood, now: a.t });
  }
  return { sent, why, ups };
}

module.exports = { before, after, reset, judge, replay, carriedOf, SPELL_GAP_MS, SAID_FROM, NONE_GOOD_TOPS, NONE_GOOD_OF, NOWHERE_ASKS, NOWHERE_MS, NOWHERE_BLOCKS, NOT_SENT_UP };

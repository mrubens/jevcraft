'use strict';
// A rung set aside holds like a trip (note 749).
//
// Setting a rung aside is an answer that takes time to mean anything: the
// work goes on without it. It was undone in seconds by another question's
// option taking it back: 25592 at 12:18:53Z chose surface_trip's stay_below
// ("leave the iron pickaxe ... rather than climb all the way up for 1 oak
// log") and six seconds later win_strategy said "Back to the iron pickaxe
// after all: I set it aside 5 seconds ago"; 25588 at 12:34:46Z set the reach
// nether aside at rung_progress and win_strategy's nether_first took it back
// four seconds later; 25589 alternated set_aside and nether_first, two
// surface climbs in two minutes (the live critic, 12:19Z and 12:45Z).
// rung_progress's own take_up was already held from about where it was set
// aside (game-progress.js asideStands, note 600); win_strategy's options that
// take a rung back (`takeBack` on their nodes) were not.
//
// Here, for every question: a rung set aside is stamped at the next asking
// after it with where the bot stands, what it carries and its health band.
// An option whose node takes back a rung (`takeBack: phase`) is not offered
// while that set-aside holds, and that is said (asideHolds): it holds until
// something named changes (the bot HOLD_NEAR blocks or more from where it was
// set aside, a new kind of thing carried, the health band), or HOLD_MS pass.
// Where every option would be left out, all stay on offer with it said.

const HOLD_MS = 5 * 60000;
const HOLD_NEAR = 16;
const words = s => String(s || '').replaceAll('_', ' ');
const ago = ms => { const s = Math.max(1, Math.round(ms / 1000)); return s < 90 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.round(s / 60)} minutes`; };
const band = h => !Number.isFinite(h) ? null : h >= 20 ? 5 : Math.floor(Math.max(0, h) / 4);
const kindsOf = bot => { try { return [...new Set((bot?.inventory?.items?.() || []).map(i => i.name))]; } catch (_) { return []; } };
const off = () => process.env.JEV_ASIDES === '0';

function entriesOf(goal) {
  try { return Object.values(require('../progress').attemptsFor(goal).entries).filter(e => e.action === 'rung'); } catch (_) { return []; }
}
// Each rung set aside and not yet stamped: stamped with the bot as it is.
function stamp(bot, goal, now = Date.now()) {
  const p = bot?.entity?.position;
  if (!p) return;
  for (const e of entriesOf(goal)) if (e.until > now && !e.held749) e.held749 = { where: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }, kinds: kindsOf(bot), band: band(bot.health), stampedAt: now };
}
// Whether the set-aside of `phase` holds now. -> words, or null
function holds(bot, goal, phase, now = Date.now()) {
  if (off()) return null;
  const e = entriesOf(goal).find(x => String(x.target) === String(phase) && x.until > now);
  const h = e?.held749, p = bot?.entity?.position;
  if (!h || !p || now - e.at > HOLD_MS) return null;
  const moved = Math.hypot(h.where.x + 0.5 - p.x, h.where.y - p.y, h.where.z + 0.5 - p.z);
  if (moved >= HOLD_NEAR) return null;
  if (kindsOf(bot).some(k => !h.kinds.includes(k))) return null;
  if (band(bot.health) !== h.band) return null;
  return `the ${words(phase)} was set aside ${ago(now - e.at)} ago (${String(e.why || '').slice(0, 160)}), ${Math.round(moved)} blocks from here, and nothing named has changed since (no new kind of thing carried, health as it was): taking it back is not offered until the bot is ${HOLD_NEAR} blocks from there, carries something new, its health changes, or ${Math.round(HOLD_MS / 60000)} minutes have passed`;
}
// The tree less the options that would take back a rung whose set-aside
// holds. -> { tree, facts }
function gate(bot, goal, tree, now = Date.now()) {
  if (off() || !goal || !tree) return { tree, facts: [] };
  stamp(bot, goal, now);
  const facts = [], out = {};
  for (const [key, node] of Object.entries(tree)) {
    const said = node?.takeBack ? holds(bot, goal, node.takeBack, now) : null;
    if (said) { facts.push(`${words(key)}: not offered: ${said}.`); continue; }
    out[key] = node;
  }
  if (!facts.length || !Object.keys(out).length) return { tree, facts: facts.length ? facts.map(f => f.replace(': not offered:', ': on offer, nothing else is:')) : [] };
  return { tree: out, facts };
}

module.exports = { gate, holds, stamp, HOLD_MS, HOLD_NEAR };

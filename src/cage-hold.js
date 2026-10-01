'use strict';
// The fight at the cage (note 700): the blaze rods the work in hand and a
// live spawner within sixteen blocks, where it makes blazes while the bot
// stays. Being there is the plan, not the bot standing still.
//
// 25585 (mid-242-ca-fortress-13, 2026-09-29 22:50 to 23:05Z) boxed itself
// 2.2 blocks from the cage at (-204, 57, -150), took one blaze hit, and at
// 23:01:20 the stall watch sent it to stillness_detour, where work_free
// called its own box "walled in where it stands" with the goal "dry ground
// at least eight blocks away"; unstuck_move then dug down about thirty
// times, none_good on top, y 53 to y 37 through the fortress's foundation,
// 18 blazes in sight and no rod. Nothing in the stall's question said the
// box was the rod farm, and no answer opened it toward the cage or stayed.
//
// 25591 (mid-242-jb, 22:58Z), at good health beside the cage at (158, 64,
// 356) with a stone sword, was sent by upkeep's fetch_stems for 2 warped
// stems 396 blocks off with no route: the no-pickaxe lead (note 687) put
// the pickaxe first where the rods in hand need a sword.
const { Vec3 } = require('vec3');

const RANGE = 16;            // the spawner tries only with a player this near (BaseSpawner)
const HOLD_MS = 60000;       // a stay: every try comes within 40 s of the last
const HOLD_NEAR = 4;         // a stay held from about the spot it was chosen at
const SWORDS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword'];
const words = s => String(s || '').replaceAll('_', ' ');
const at3 = c => `(${c.x}, ${c.y}, ${c.z})`;
const hhmm = t => new Date(t).toISOString().slice(11, 16);
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));

function swordCarried(bot) {
  const names = new Set((bot?.inventory?.items?.() || []).map(i => i.name));
  return SWORDS.find(n => names.has(n)) || null;
}
// What Jev chose that put the bot at the cage, as the goal keeps it: a box or
// a hole built there (empty-spawner.js buildAndHold), a stand or a wait by
// it, or a stay chosen at a stall. -> { what, at } or null
function chosenThere(goal) {
  const built = goal?.emptySpawner?.built;
  const wait = goal?.fortressSearch?.spawnerWait;
  const hold = goal?.cageHold;
  const list = [
    built?.at && { what: `the ${words(built.key).replace(/^box (here|at spawner)$/, 'box')} built there`, at: built.at },
    wait?.startedAt && { what: wait.chosen === 'empty_spawner' ? 'the stand taken there' : 'the wait there', at: wait.startedAt },
    hold?.at && { what: `the ${words(hold.choice)} chosen there`, at: hold.at },
  ].filter(Boolean).sort((a, b) => b.at - a.at);
  return list[0] || null;
}
// -> { cage, off, need, sword, chosen, where } or null
function cageFight(bot, goal) {
  if (!bot?.entity?.position || !inNether(bot) || !goal) return null;
  let need = 0;
  try { need = require('./blaze-stand').rodsNeeded(bot, goal); } catch (_) { need = 0; }
  if (!(need > 0)) return null;
  let known = null;
  try { known = require('./empty-spawner').knownSpawner(bot, goal); } catch (_) { known = null; }
  if (!known || known.off > RANGE) return null;
  return { cage: known.cage, off: known.off, need, sword: swordCarried(bot), chosen: chosenThere(goal), where: `the spawner at ${at3(known.cage)}` };
}
const centre = cage => new Vec3(cage.x + 0.5, cage.y + 0.5, cage.z + 0.5);

// The held plan at the cage (note 774). 25584 (mid-229-aa, 2026-10-01
// 00:55 to 01:07Z, the cage at (209, 62, -270)) stood ten minutes walled in
// five from the cage: box_here (encounter_stance, hunt_target) and
// open_slit (empty_spawner) each undid the other, the slit digging "the
// netherrack at (206, 62, -267), laid by the bot at 01:03Z" that cover had
// put in the box's window; each hold was cut within seconds by "Threat
// nearby: blaze at 4 to 6 blocks" and "small_fireball", turn_priority
// turned between work, survival and hunt every few seconds, 0 blazes
// killed, 30.9 health lost, then dead. Since 06:00Z on 2026-09-30, 160 box,
// slit and stand answers at 49 cages held a median 15.7 s, 100 of them cut
// by a threat thrown at the step, 60 undone by another question, and the box
// and the slit undid each other 45 times (scripts/cage-stays.js).
// A box (its window the slit, blaze-tactics.js slitWindow), a hole or a slit
// chosen at the cage, from whichever question, is one plan: kept here,
// held until it kills (a blaze killed or a rod carried since), or fails
// (six health gone since it began, the bot out of its cell, a blaze inside
// the box), or its time (PLAN_MS) passes with neither; its openings (the
// window and the slit) take no block while it holds. Its answer is judged by
// what it killed, not by the bot's moving or the blocks it dug (outcome.js
// judgeBy, note 765) and holds as a commitment until then (commit.js kills,
// note 764). While the bot is in it, only a blaze inside it or a hit through
// it is a threat that ends the step (danger.js shelterKeepsOff).
// INSIDE: a blaze whose middle is this near the bot's across is in the
// bot's own cell, inside the box; one in the window (about a block off) is
// the one the box is for, struck through it.
const PLAN_MS = 3 * 60000, INSIDE = 0.9, HIT_MS = 4000, PLAN_HEALTH = 6;
const P = v => v && { x: v.x, y: v.y, z: v.z };
const V = v => v && new Vec3(v.x, v.y, v.z);
const killsOf = bot => bot?._kills?.blaze || 0;
// The plan's end, or null while it holds: said in words.
function planEnd(bot, h, now = Date.now()) {
  if (h.endedBy) return h.endedBy;
  if (!(h.until > now)) return `its ${Math.round(PLAN_MS / 60000)} minutes passed`;
  const rods = require('./skills').countOf(bot, 'blaze_rod');
  if (Number.isFinite(h.kills) && killsOf(bot) > h.kills) return `${killsOf(bot) - h.kills === 1 ? 'a blaze' : `${killsOf(bot) - h.kills} blazes`} killed`;
  if (Number.isFinite(h.rods) && rods > h.rods) return `${rods - h.rods === 1 ? 'a rod' : `${rods - h.rods} rods`} carried`;
  if (Number.isFinite(h.health) && h.health - (bot.health ?? 20) >= PLAN_HEALTH) return `${Math.round((h.health - (bot.health ?? 20)) * 10) / 10} health gone since it began`;
  if (h.box && insideBlaze(bot)) return 'a blaze came inside the box';
  return null;
}
function insideBlaze(bot) {
  const p = bot?.entity?.position;
  if (!p) return null;
  return Object.values(bot.entities || {}).find(e => e?.name === 'blaze' && e.isValid !== false && e.position && Math.hypot(e.position.x - p.x, e.position.z - p.z) <= INSIDE && Math.abs(e.position.y - p.y) < 2) || null;
}
// A stay at the cage Jev chose, while it runs and the bot is about where it
// was chosen: a wait, not the bot standing still (stillness.js stepWait).
// A box or a hole Jev chose to build by the cage (empty-spawner.js
// buildAndHold) is such a stay for its first minute too; a box held as the
// cage's plan (note 774) until it kills or fails.
function holding(bot, goal, now = Date.now()) {
  if (!bot?.entity?.position) return null;
  const p = bot.entity.position;
  const near = h => !h.from || Math.hypot(p.x - h.from.x, p.y - h.from.y, p.z - h.from.z) <= (h.box ? 1.5 : HOLD_NEAR);
  const h = goal?.cageHold;
  if (h && h.until > now && near(h)) {
    const end = planEnd(bot, h, now);
    if (!end) return h;
    h.endedBy = end; h.until = Math.min(h.until, now); h.endedAt = h.endedAt || now;
    console.log(`[cage plan] ${words(h.choice)} at ${hhmm(h.at)}Z ended: ${end}`);
    return null;
  }
  const b = goal?.emptySpawner?.built;
  if (b?.at && now - b.at < HOLD_MS && near(b) && cageFight(bot, goal) && !(h?.box && h.at >= b.at)) return { choice: b.key, at: b.at, until: b.at + HOLD_MS, from: b.from };
  return null;
}
// The held plan, with the bot in its box or at its slit: what the threat
// rule reads. -> the plan or null
function shelterHeld(bot, goal = bot?._goal, now = Date.now()) {
  const h0 = goal?.cageHold;
  if (!h0 || !(h0.box || h0.openings?.length) || !(h0.until > now)) return null;
  const h = holding(bot, goal, now);
  return h && (h.box || h.openings?.length) ? h : null;
}
// A blaze or its fireball is not a threat that ends the step while the
// bot holds the cage's plan in its box or at its slit (note 774): only one
// inside the box (its middle within INSIDE of the bot across) or a hit landed through it
// (hurt by a blaze or its fire in the last HIT_MS) is. -> true to keep it off
function shelterKeepsOff(bot, t, now = Date.now()) {
  const name = t?.entity?.name;
  if (name !== 'blaze' && name !== 'small_fireball') return false;
  if (!shelterHeld(bot, bot?._goal, now)) return false;
  if (name === 'blaze' && t.entity.position && Math.hypot(t.entity.position.x - bot.entity.position.x, t.entity.position.z - bot.entity.position.z) <= INSIDE && Math.abs(t.entity.position.y - bot.entity.position.y) < 2) return false;
  const hit = ['blaze', 'small_fireball'].some(k => now - (bot._hurtBy?.[k] || 0) < HIT_MS);
  return !hit;
}
// The cells the held plan keeps open (its window and the slit past it):
// no block goes into them while it holds. -> Set of "(x, y, z)" keys
function openings(bot, goal = bot?._goal, now = Date.now()) {
  const h0 = goal?.cageHold;
  if (!h0 || !(h0.box || h0.openings?.length) || !(h0.until > now)) return new Set();
  const h = holding(bot, goal, now);
  const list = h?.box?.openings || h?.openings || [];
  return new Set(list.map(c => `(${c.x}, ${c.y}, ${c.z})`));
}
// What ends the plan's answer as a commitment (decisions/commit.js, note
// 764): a kill, health falling a band, the bot off its cell, its time; the
// plan's own end (a blaze inside, a hit through) is said with them.
const planCommit = () => ({ until: { kills: true, health: true, moved: 3, seconds: PLAN_MS / 1000, also: ['a blaze comes inside the box or a hit lands through it'] } });
// The node fields that make an answer at the cage one plan: judged by what
// it killed (outcome.js judgeBy, note 765), over its own time, and held as
// a commitment until then.
const planNode = () => ({ judgeBy: 'kills', seconds: PLAN_MS / 1000, commit: planCommit() });
// The held box as blaze-tactics.js's site, for its hold to run again.
function siteOf(h) {
  if (!h?.box) return null;
  const b = h.box;
  return { cell: V(b.cell), window: V(b.window), walls: (b.walls || []).map(V), slit: (b.slit || []).map(V), digs: [], dig: null };
}
// How the last stay went, said with the next offer of one.
function lastSays(goal, bot, now = Date.now()) {
  const h = goal?.cageHold;
  if (!h?.at || now - h.at > 10 * 60000) return '';
  const rods = require('./skills').countOf(bot, 'blaze_rod') - (h.rods || 0);
  const kills = Number.isFinite(h.kills) ? killsOf(bot) - h.kills : null;
  return ` The last, ${words(h.choice)} at ${hhmm(h.at)}Z: ${kills != null ? `${kills === 1 ? 'a blaze' : `${kills} blazes`} killed and ` : ''}${rods > 0 ? `${rods} rod${rods === 1 ? '' : 's'} since` : 'no rod since'}${h.endedBy ? `; it ended: ${h.endedBy}` : ''}.`;
}
// `site`: a box (blaze-tactics.js boxSite) held as the plan; `openings`:
// the cells a slit opened. Either makes it the cage's held plan (note 774),
// held PLAN_MS unless it kills or fails first; a plain stay holds HOLD_MS.
function beginHold(bot, goal, save, choice, now = Date.now(), { site = null, openings: open = null } = {}) {
  const p = bot.entity.position.floored(), fight = cageFight(bot, goal);
  const plan = !!site || !!open?.length;
  const box = site ? { cell: P(site.cell), window: P(site.window), walls: (site.walls || []).map(P), slit: (site.slit || []).map(P),
    openings: require('./blaze-tactics').openingsOf(site).map(P) } : null;
  goal.cageHold = { choice, at: now, until: now + (plan ? PLAN_MS : HOLD_MS), from: P(site?.cell || p), rods: require('./skills').countOf(bot, 'blaze_rod'),
    kills: killsOf(bot), health: bot.health ?? 20, ...(box ? { box } : {}), ...(!box && open?.length ? { openings: open.map(P) } : {}),
    ...(fight ? { cage: { x: fight.cage.x, y: fight.cage.y, z: fight.cage.z } } : {}) };
  try { require('./rung-measure').watchKills(bot); } catch (_) { /* no events */ }
  save?.();
  return goal.cageHold;
}
// A box built or held at a live cage still owed rods, from whichever
// question chose it (blaze-stand.js runTactic): the cage's plan, begun once
// for its cell, not restarted by its own hold running again.
function boxPlanned(bot, goal, save, choice, site, now = Date.now()) {
  if (!goal || !site?.cell || !cageFight(bot, goal)) return null;
  const h = holding(bot, goal, now);
  if (h?.box && h.box.cell.x === site.cell.x && h.box.cell.y === site.cell.y && h.box.cell.z === site.cell.z) return h;
  return beginHold(bot, goal, save, choice || 'box_here', now, { site });
}

// The slit: the blocks on the line from the eyes to the cage, where one to
// three stand between and each comes away (the bot's own, or rock a carried
// tool or a hand takes). Dug, the cage and the blazes it puts beside it
// have a line in, one line, from the front. Every dig goes through the dig
// guard (terrain.js digExposes). -> { cells: [{ cell, name, own }], says } or
// null (the line open already, or not to be opened so).
const SLIT_MAX = 3, EYE = 1.62;
function slitLine(bot, cage, goal = bot?._goal) {
  const feet = bot.entity.position.floored();
  // Never through a wall of the cage's held box (note 774): its slit is its
  // window, cut with the build.
  const walls = new Set((goal?.cageHold?.until > Date.now() && goal.cageHold.box?.walls || []).map(c => `(${c.x}, ${c.y}, ${c.z})`));
  const from = new Vec3(bot.entity.position.x, feet.y + EYE, bot.entity.position.z), to = centre(cage);
  const len = from.distanceTo(to), steps = Math.ceil(len / 0.2);
  const seen = new Set(), cells = [];
  for (let n = 1; n < steps; n++) {
    const c = from.plus(to.minus(from).scaled(n / steps)).floored();
    const k = `${c}`;
    if (seen.has(k) || c.equals(cage)) continue;
    seen.add(k);
    const b = bot.blockAt?.(c);
    if (!b || b.boundingBox !== 'block') continue;
    if (/bedrock|obsidian|spawner|lava|chest/.test(b.name) || !(b.hardness >= 0) || b.hardness >= 50 || walls.has(k)) return null;
    if (!require('./block-stock').handDigs(bot, b)) return null;
    let own = null; try { own = require('./own-blocks').laidAt(bot, c); } catch (_) { own = null; }
    cells.push({ cell: c, name: b.name, own });
    if (cells.length > SLIT_MAX) return null;
  }
  if (!cells.length) return null;
  const says = cells.map(x => `the ${words(x.name)} at ${at3(x.cell)}${x.own ? `, laid by the bot${Number.isFinite(x.own.at) ? ` at ${hhmm(x.own.at)}Z` : ''}` : ''}`).join('; ');
  return { cells, says };
}

// The stall's ways at the cage: open a slit toward it, stay and fight, or go
// to a blaze already out. `dig` as the work has it. -> { open_slit?,
// stay_and_fight?, go_to_blaze_about? }
function stallAnswers(bot, task, goal, save, fight, { dig, now = Date.now(), navigate = null } = {}) {
  const out = {};
  const clock = (() => { try { const sc = require('./spawner-clock'); return sc.clockSays(sc.nextTry(bot, fight.cage, now)); } catch (_) { return null; } })();
  const blazes = (() => { try { return require('./danger').threats(bot, RANGE).filter(t => t.entity.name === 'blaze'); } catch (_) { return []; } })();
  const unseen = blazes.filter(t => !t.visible).length;
  const about = blazes.length ? ` ${blazes.length} blaze${blazes.length === 1 ? '' : 's'} within 16${unseen ? `, ${unseen} out of sight` : ''}.` : '';
  // The cap: while it is met, no more come, whatever the delay says (note
  // 729: 25598 held a box 36+ minutes with 12 to 15 about, most out of
  // sight, and no option said the spawner had already given all it could
  // until some of those left or died).
  const cap = (() => { try { return require('./spawner-clock').capSays(bot, fight.cage, { threats: blazes }); } catch (_) { return null; } })();
  const last = lastSays(goal, bot, now);
  const slit = slitOption(bot, task, goal, save, fight, { dig, about });
  if (slit) out.open_slit = slit;
  out.stay_and_fight = { description: `Stay here, ${fight.off} blocks from the cage, a minute and fight what comes.${clock ? ` ${clock}.` : ''}${about}${cap ? ` ${cap}` : ''} ${fight.need} rod${fight.need === 1 ? '' : 's'} still needed.${last}`,
    run: async () => { bot.chat?.(`Staying at the spawner to fight: ${fight.need} more rod${fight.need === 1 ? '' : 's'} needed.`); beginHold(bot, goal, save, 'stay_and_fight'); } };
  // The rods already made are in the blazes already out, most of them
  // behind rock while the cap holds none more back: a line to the nearest
  // one, on foot, is the way on the cap itself does not offer.
  if (navigate) {
    const mh = require('./mob-hunt');
    const known = mh.blazesAbout(bot);
    const nearest = known.find(b => !b.visible) || known[0];
    if (nearest) {
      const p = nearest.entity.position.floored();
      out.go_to_blaze_about = { description: `Go to the nearest blaze already out, ${mh.blazesAboutSays(known)}, on foot, one at a time: the fight there is asked as it is met.${cap ? ` ${cap}` : ''}`,
        run: async () => { bot.chat?.('Going to a blaze already out, not waiting on the cage for more.');
          try { await navigate(bot, task, new (require('mineflayer-pathfinder').goals.GoalNear)(p.x, p.y, p.z, 3), { timeoutMs: 20000, stallMs: 5000 }); } catch (err) { task.check(); } } };
    }
  }
  return out;
}

// The slit as a way: said with what the bot then sees of where the blazes
// come (blaze-tactics.js spawnLine, note 708). -> option or null
function slitOption(bot, task, goal, save, fight, { dig, about = null } = {}) {
  const slit = slitLine(bot, fight.cage, goal);
  if (!slit || !dig) return null;
  if (about === null) {
    const blazes = (() => { try { return require('./danger').threats(bot, RANGE).filter(t => t.entity.name === 'blaze'); } catch (_) { return []; } })();
    const unseen = blazes.filter(t => !t.visible).length;
    about = blazes.length ? ` ${blazes.length} blaze${blazes.length === 1 ? '' : 's'} within 16${unseen ? `, ${unseen} out of sight` : ''}.` : '';
  }
  let then = '';
  try {
    const T = require('./blaze-tactics');
    const l = T.spawnLine(bot, bot.entity.position.floored(), fight.cage, { open: slit.cells.map(x => x.cell) });
    then = ` Then it sees ${T.lineWords(l)}.`;
  } catch (_) { then = ''; }
  // Inside the spawner's own spawn range (blaze-tactics.js BOX_NEAR, note
  // 740) a blaze can spawn already at the wall the slit is dug through, not
  // only come into the line once it is open: said, since the slit does not
  // move the bot to a cell picked for that, only opens where it already
  // stands.
  const inRange = (() => { try { return fight.off <= require('./blaze-tactics').SPAWN_RANGE; } catch (_) { return false; } })();
  const rangeSays = inRange ? ' It is inside the spawner\'s own spawn range (up to four blocks across): a blaze can spawn already at the wall behind the slit, not only come into the line dug through it.' : '';
  return { ...planNode(), description: `Open a slit toward the cage: dig ${slit.cells.length === 1 ? 'the block' : `the ${slit.cells.length} blocks`} on the line from the eyes to it (${slit.says}), then stay a minute and fight what comes into that line.${then}${rangeSays}${about}`,
    run: async () => {
      bot.chat?.(`Opening a slit toward the spawner and staying to fight: ${fight.need} more rod${fight.need === 1 ? '' : 's'} needed.`);
      for (const x of slit.cells) { task.check(); await dig(bot, task, x.cell, { requireDrops: false }); }
      beginHold(bot, goal, save, 'open_slit', Date.now(), { openings: slit.cells.map(x => x.cell) });
    } };
}

// Pulling back out of sight from a stacked spawner (note 774). 25584 held
// five blocks from its cage with 19 to 34 blazes within 16 for ten minutes:
// the spawner caps only those within its own range of the cage (six), and
// those it made that drifted past it are as many again and more, each one
// shooting whenever it sees the bot. The game's own rules (the 26.1.2 jar):
// a spawner makes none while no player is within 16 of it, and its delay
// stops; a blaze shoots only with a line to its target; a monster with no
// player within 32 blocks for 30 seconds is removed at random, one chance
// in 800 a tick after that (about half within another 28 seconds, about
// nine in ten within 90). Offered with STACKED or more within 16, priced by
// the walk (its own blocks dug first where it is walled in) and the blazes
// in sight on it now.
const STACKED = 20, PULL_STEPS = 48, PULL_WAIT_MS = 90000, FAR = 33;
// The nearest cell the bot can walk to (its own blocks dug where they wall
// it in) past 16 of the cage with no blaze about in line, preferring one 33
// or more from every blaze known about. -> { cell, steps, digs, far, seen } or null
function pullBackSite(bot, cage, blazes) {
  const T = require('./blaze-tactics'), bunker = require('./bunker');
  const own = c => { try { return !!require('./own-blocks').laidAt(bot, c); } catch (_) { return false; } };
  const feet = bot.entity.position.floored(), c0 = centre(cage);
  const enter = (c, d) => {
    const body = [c, c.offset(0, 1, 0)].map(x => bot.blockAt(x));
    const under = bot.blockAt(c.offset(0, -1, 0));
    if (!under || under.boundingBox !== 'block' || /lava|magma/.test(under.name)) return null;
    let digs = 0;
    for (let i = 0; i < 2; i++) {
      const b = body[i];
      if (!b) return null;
      if (/lava|water|fire/.test(b.name)) return null;
      if (b.boundingBox === 'block') { if (!own([c, c.offset(0, 1, 0)][i])) return null; digs++; }
    }
    return digs;
  };
  const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
  const seen = new Set([`${feet}`]);
  let ring = [{ cell: feet, steps: 0, digs: 0 }], best = null, fallback = null;
  for (let n = 1; n <= PULL_STEPS && ring.length; n++) {
    const next = [];
    for (const r of ring) for (const s of SIDES) for (const dy of [0, 1, -1]) {
      const to = r.cell.plus(s).offset(0, dy, 0), k = `${to}`;
      if (seen.has(k)) continue;
      const d = enter(to);
      if (d == null) continue;
      seen.add(k);
      const step = { cell: to, steps: n, digs: r.digs + d, prev: r };
      next.push(step);
      const off = to.offset(0.5, 0.5, 0.5).distanceTo(c0);
      if (off <= RANGE + 1) continue;
      const inLine = T.seeing(bot, blazes, to).length;
      if (inLine) continue;
      const far = blazes.every(e => e.position.distanceTo(to.offset(0.5, 1, 0.5)) >= FAR);
      if (far && !best) best = { ...step, off: Math.round(off), far: true };
      if (!fallback) fallback = { ...step, off: Math.round(off), far };
    }
    if (best) break;
    ring = next;
  }
  void bunker;
  const pick = best || fallback;
  if (!pick) return null;
  const path = [];
  for (let r = pick; r && r.steps > 0; r = r.prev) path.unshift(r.cell);
  return { cell: pick.cell, steps: pick.steps, digs: pick.digs, off: pick.off, far: pick.far, path };
}
function pullBackOption(bot, task, goal, save, fight, { navigate = null, now = Date.now() } = {}) {
  if (!navigate) return null;
  let about = [];
  try { about = require('./danger').threats(bot, 48).filter(t => t.entity.name === 'blaze'); } catch (_) { about = []; }
  const within16 = about.filter(t => t.distance <= RANGE);
  if (within16.length < STACKED) return null;
  const site = pullBackSite(bot, fight.cage, about.map(t => t.entity));
  if (!site) return null;
  let atCap = 0, cap = 6;
  try { const sc = require('./spawner-clock'); atCap = sc.nearCage(bot, fight.cage, { threats: about }); cap = sc.CAP; } catch (_) { atCap = 0; }
  const unseen = within16.filter(t => !t.visible).length, seeing = about.filter(t => t.visible).length;
  const secs = Math.round((site.steps / 4.3 + site.digs * 0.6) * 10) / 10;
  const description = `Pull back out of their sight: ${site.digs ? `dig out through ${site.digs === 1 ? 'a block' : `${site.digs} blocks`} of the bot's own and ` : ''}walk ${site.steps} blocks (about ${secs} seconds${seeing ? `, ${seeing} blaze${seeing === 1 ? '' : 's'} in sight now` : ''}) to a cell ${site.off} from the cage, past 16 and in no blaze's line, ${site.far ? '33 or more from every blaze known about' : 'not yet 32 from all of them'}, and wait there up to ${Math.round(PULL_WAIT_MS / 1000)} seconds, then back to the cage. ` +
    `${within16.length} blazes are within 16 (${unseen} out of sight); ${atCap} of them within the spawner's own range of the cage, which it caps at ${cap}${atCap >= cap ? ': at its cap it makes none more' : ''}; the other ${within16.length - atCap} are blazes it already made that drifted off, and each shoots whenever it sees the bot. By the game's rules: past 16 of the cage the spawner makes none and its delay stops; a blaze shoots only with a line to the bot; a monster with no player within 32 blocks for 30 seconds is removed at random, one chance in 800 a tick (about half within another 28 seconds, about nine in ten within 90), so ${site.far ? 'waiting there thins the stack' : 'the stack stays while the bot is within 32 of them'}. ${fight.need} rod${fight.need === 1 ? '' : 's'} still needed: none meanwhile.`;
  return { description, secs,
    run: async () => {
      bot.chat?.(`Too many blazes stacked here (${within16.length}): pulling back out of their sight for a minute or so.`);
      const { goals } = require('mineflayer-pathfinder');
      goal.step = { action: 'pull_back_from_spawner', target: { x: site.cell.x, y: site.cell.y, z: site.cell.z }, blazes: within16.length, health: bot.health }; save?.();
      // Its own blocks on the way dug first, a cell at a time (the walk
      // itself digs nothing), then the walk.
      const solidAt = c => bot.blockAt(c)?.boundingBox === 'block';
      const lastDig = site.path.map(c => solidAt(c) || solidAt(c.offset(0, 1, 0))).lastIndexOf(true);
      for (let i = 0; i <= lastDig; i++) {
        const c = site.path[i];
        task.check();
        for (const b of [c.offset(0, 1, 0), c]) if (solidAt(b)) await require('./bunker').digCell(bot, task, b);
        await navigate(bot, task, new goals.GoalBlock(c.x, c.y, c.z), { timeoutMs: 3000, stallMs: 1500, onFoot: true });
      }
      await navigate(bot, task, new goals.GoalBlock(site.cell.x, site.cell.y, site.cell.z), { timeoutMs: Math.max(8000, site.steps * 600), stallMs: 4000, onFoot: true });
      const until = Date.now() + PULL_WAIT_MS;
      goal.cagePullBack = { at: Date.now(), until, from: within16.length, cell: { x: site.cell.x, y: site.cell.y, z: site.cell.z } }; save?.();
      while (Date.now() < until) {
        task.check();
        let near = 0;
        try { near = require('./danger').threats(bot, 16).filter(t => t.entity.name === 'blaze' && t.visible).length; } catch (_) { near = 0; }
        if (near) break;
        await new Promise(r => setTimeout(r, 1000));
      }
    } };
}

// Said on work_free at the cage: where it leads.
function workFreeSays(fight) {
  return ` It leads away from ${fight.where}, ${fight.off} blocks off, where the rods are fought for${fight.chosen ? `; the walls round it are ${fight.chosen.what} at ${hhmm(fight.chosen.at)}Z` : ''}.`;
}

// No pickaxe carried at the cage, a sword carried: the rods in hand need the
// sword, not a pickaxe. -> the words, or null
function swordNotPickaxe(bot, goal) {
  if ((bot?.inventory?.items?.() || []).some(i => /_pickaxe$/.test(i.name))) return null;
  const fight = cageFight(bot, goal);
  if (!fight?.sword) return null;
  const sword = words(fight.sword), off = `${fight.off} block${fight.off === 1 ? '' : 's'} off`;
  return { fight, lead: `No pickaxe is carried; the rods need a sword, not a pickaxe, and ${/^[aeiou]/.test(fight.sword) ? 'an' : 'a'} ${sword} is carried.`,
    leaves: `It leaves the spawner ${off}, where the rods are, and they need a sword, which is carried.`,
    makes: `The rods at the spawner ${off} need a sword, which is carried, not a pickaxe.`,
    carryOn: `Carry on with the fight at the spawner ${off}, with the ${sword}: a blaze needs a sword, not a pickaxe;` };
}

module.exports = { pullBackOption, pullBackSite, STACKED, PULL_WAIT_MS, planCommit, planNode, cageFight, holding, beginHold, boxPlanned, shelterHeld, shelterKeepsOff, openings, siteOf, planEnd, insideBlaze, PLAN_MS, INSIDE, HIT_MS, PLAN_HEALTH, stallAnswers, slitOption, workFreeSays, swordNotPickaxe, swordCarried, slitLine, chosenThere, RANGE, HOLD_MS, HOLD_NEAR };

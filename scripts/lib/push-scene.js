'use strict';
// The scene of each Nether death by lava or a fall (note 769), for
// scripts/lava-deaths.js --pushes: where the bot stood before it went over,
// what put it over, what it was doing, how long the pusher had been near,
// and what the last question's options said about a push. Read-only: the
// flight frames the caller kept, and the trial's saved world (never
// edited), which is the world as it is now: a block a blast broke since, or
// one the bot dug or laid after, reads as it is now.
const fs = require('node:fs');
const path = require('node:path');

// Blocks the Nether does not make: on a Nether floor they were laid by the
// bot (its spans, rails and pillars). Netherrack it both finds and lays.
const LAID = /^(cobblestone|cobbled_deepslate|dirt|coarse_dirt|gravel|sand|stone|andesite|diorite|granite|tuff|deepslate|smooth_basalt|.*_planks|.*_log|.*_wool|glass|oak_leaves|end_stone)$/;
const MELEE = new Set(['hoglin', 'zoglin', 'zombified_piglin', 'piglin', 'piglin_brute', 'magma_cube', 'wither_skeleton', 'skeleton', 'zombie', 'spider', 'enderman']);
const round = n => Math.round(n * 10) / 10;

function worldAt(root, port, t) {
  const dir = path.join(root, 'artifacts', 'midgame');
  let best = null;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    if (String(j.port) !== String(port)) continue;
    const s = Date.parse(j.startedAt);
    if (!(s <= t)) continue;
    if (!best || s > best.s) best = { s, world: j.world };
  }
  return best?.world || null;
}
const worldCache = new Map();
function worldReader(root, port, world) {
  const key = `${port}/${world}`;
  if (worldCache.has(key)) return worldCache.get(key);
  const base = path.join(root, String(port) === '25581' ? '.clean-run' : `.clean-run-${port}`, world);
  const dirs = [path.join(base, 'dimensions', 'minecraft', 'the_nether', 'region'), path.join(base, 'DIM-1', 'region')];
  const dir = dirs.find(d => fs.existsSync(d));
  const r = dir ? require('../trials/trail-map').savedWorld(dir) : null;
  worldCache.set(key, r);
  return r;
}
const solidName = n => !!n && !/^(air|cave_air|void_air|lava|water|fire|soul_fire|.*_button|.*torch.*|nether_portal|crimson_roots|warped_roots|nether_sprouts|twisting_vines.*|weeping_vines.*|crimson_fungus|warped_fungus|brown_mushroom|red_mushroom)$/.test(n);

// The footing as the save has it: the floor's width across (the fewer
// cells of the two ways through the feet, each capped at five), the sides
// open over a drop and those walled, the floor's block, and the drop's
// depth and what is under it.
function footingOf(w, pos) {
  const x = Math.floor(pos.x), y = Math.floor(pos.y + 0.01), z = Math.floor(pos.z);
  const at = (a, b, c) => w.blockAt(a, b, c);
  let floorName = at(x, y - 1, z);
  if (floorName === undefined) return { unknown: true };
  // Standing over a cell with no floor now: the body's corner was on a
  // block beside it, or the floor has gone since (a blast, a dig).
  let gone = false;
  if (!solidName(floorName)) {
    const corner = [[0.3, 0.3], [0.3, -0.3], [-0.3, 0.3], [-0.3, -0.3]].map(([a, b]) => [Math.floor(pos.x + a), Math.floor(pos.z + b)]).find(([a, c]) => solidName(at(a, y - 1, c)));
    if (corner) return { ...footingOf(w, { x: corner[0] + 0.5, y: pos.y, z: corner[1] + 0.5 }), onCornerOf: true, bodyAt: { x: round(pos.x), z: round(pos.z) } };
    gone = true;
  }
  const floored = (a, c) => solidName(at(a, y - 1, c)) && !solidName(at(a, y, c));
  const run = (dx, dz) => { let n = 0; for (let k = 1; k <= 4; k++) { if (!floored(x + dx * k, z + dz * k)) break; n++; } return n; };
  const widthX = 1 + run(1, 0) + run(-1, 0), widthZ = 1 + run(0, 1) + run(0, -1);
  // Two wide where a square of two by two cells stood on holds the feet
  // (narrow-footing.js widthAt): a span's corner is one wide.
  const sq = n => { for (let x0 = -(n - 1); x0 <= 0; x0++) for (let z0 = -(n - 1); z0 <= 0; z0++) { let all = true; for (let i = 0; i < n && all; i++) for (let j = 0; j < n && all; j++) all = (x0 + i === 0 && z0 + j === 0) || floored(x + x0 + i, z + z0 + j); if (all) return true; } return false; };
  const square = widthX < 2 || widthZ < 2 ? 1 : sq(3) ? 3 : sq(2) ? 2 : 1;
  const sides = {};
  const drop = (a, c) => {
    if (solidName(at(a, y, c)) || solidName(at(a, y + 1, c))) return null;
    for (let dy = 1; dy <= 64; dy++) {
      const n = at(a, y - dy, c);
      if (n === undefined) return { fall: dy, into: 'unknown' };
      if (n === 'lava') return { fall: dy - 1, into: 'lava' };
      if (solidName(n)) return dy - 1 >= 3 ? { fall: dy - 1, into: 'ground' } : null;
    }
    return { fall: 64, into: 'void' };
  };
  const names = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] };
  for (const [k, [dx, dz]] of Object.entries(names)) {
    const d = drop(x + dx, z + dz);
    sides[k] = d ? `${d.into === 'lava' ? 'lava' : d.into} ${d.fall} down` : solidName(at(x + dx, y, z + dz)) ? 'wall' : 'floor';
  }
  const open = Object.entries(sides).filter(([, v]) => /down$/.test(v)).map(([k]) => k);
  const lavaDown = Object.values(sides).map(v => v.match(/^lava (\d+) down$/)).filter(Boolean).map(m => Number(m[1]));
  // Where in its cell the body stood, from the nearest open edge.
  const edge = open.map(k => k === 'east' ? x + 1 - pos.x : k === 'west' ? pos.x - x : k === 'south' ? z + 1 - pos.z : pos.z - z);
  return { cell: { x, y, z }, floor: floorName, floorGone: gone, laid: LAID.test(floorName || ''), width: square, widthX, widthZ, sides, open,
    overLava: lavaDown.length ? Math.min(...lavaDown) : null, fromEdge: edge.length ? round(Math.min(...edge)) : null };
}

const hurtOf = label => {
  const m = String(label || '').match(/^hurt: (.*?)(?: by (.*))?$/);
  return m ? { how: m[1], by: m[2] || null } : null;
};

// A bot over the saved world, for the rule's own functions
// (narrow-footing.js): the floor stood on put back where the save no
// longer has it (a blast broke it after).
function savedBot(w, floorAt = null) {
  const { Vec3 } = require('vec3');
  return { entity: { width: 0.6, position: new Vec3(0, 0, 0) }, health: 20, game: { dimension: 'the_nether' },
    blockAt: v => {
      let n = floorAt && v.x === floorAt.x && v.y === floorAt.y && v.z === floorAt.z ? 'netherrack' : w.blockAt(v.x, v.y, v.z);
      if (n === undefined) return null;
      return { name: n, boundingBox: solidName(n) ? 'block' : 'empty', position: v };
    } };
}
// Would the rule have moved the bot before it went over? At the answer
// that chose a stance that stands still (or the frame it was first held
// at), the plan from the saved ground and the mobs the frames listed, and
// its seconds beside the seconds the bot stood there before it left.
function simulate(scene, w, F, left, stanceFrame, footing) {
  if (!w || !stanceFrame?.pos) return null;
  const nf = require('../../src/narrow-footing');
  const fr = scene.frames;
  const mobsRaw = ([...fr].reverse().find(f => f.mobs && f.t <= stanceFrame.t + 100 && f.t >= stanceFrame.t - 3000) || fr.find(f => f.mobs && f.t > stanceFrame.t && f.t <= Math.min(left.t, stanceFrame.t + 1500)))?.mobs || [];
  const mobsAt = mobsRaw.map(m => ({ ...m, d: m.at ? Math.hypot(m.at.x - stanceFrame.pos.x, m.at.y - stanceFrame.pos.y, m.at.z - stanceFrame.pos.z) : m.d }));
  const blocks = [...fr].reverse().find(f => f.blocks != null && f.t <= stanceFrame.t + 2000)?.blocks ?? 0;
  const floorAt = footing?.floorGone && footing.cell ? { x: footing.cell.x, y: footing.cell.y - 1, z: footing.cell.z } : null;
  const bot = savedBot(w, floorAt);
  const { Vec3 } = require('vec3');
  const pos = new Vec3(stanceFrame.pos.x, stanceFrame.pos.y, stanceFrame.pos.z);
  bot.entity.position = pos;
  let plan = null;
  try { plan = nf.planFromRecord(bot, pos, mobsAt, { health: stanceFrame.health ?? 20, carried: blocks }); } catch (e) { return { error: e.message }; }
  const had = round((left.t - stanceFrame.t) / 1000);
  if (!plan) {
    let f = null; try { f = nf.footingAt(bot, require('../../src/terrain').restingCell(bot, pos) || pos.floored()); } catch (_) { f = null; }
    return { fires: false, why: !f ? 'no footing read' : !f.narrow ? `footing ${f.width} wide${f.deadly.length ? '' : ', no side open over a drop that kills'}` : 'no pusher in reach listed', had };
  }
  const secs = plan.choice === 'back' ? plan.back.seconds : plan.choice === 'walls' ? plan.walls.seconds : null;
  return { fires: true, choice: plan.choice, seconds: secs, had, beforePush: secs != null && secs < had, pushers: plan.pushers.map(p => `${p.name} ${round(p.distance)}`), blocks,
    to: plan.back ? { ...plan.back.cell, steps: plan.back.steps } : null, wallBlocks: plan.walls.need };
}

function analyze(scene, root) {
  const fr = scene.frames;
  const death = fr.length - 1;
  // Where it landed: the first lava hurt of the last run of them, else the death.
  let landing = death;
  for (let i = death; i >= 0 && fr[i].t >= scene.t - 15000; i--) {
    if (fr[i].hurt?.label === 'hurt: lava') landing = i;
    else if (landing !== death && fr[i].onGround && fr[i].pos && fr[i].pos.y > fr[landing].pos.y + 1.5) break;
  }
  const landY = fr[landing].pos?.y;
  // The footing: the last frame on the ground a block and a half or more
  // over where it landed, within twenty seconds.
  let foot = -1;
  for (let i = landing; i >= 0 && fr[i].t >= fr[landing].t - 20000; i--) if (fr[i].onGround && fr[i].pos && landY != null && fr[i].pos.y >= landY + 1.5) { foot = i; break; }
  const level = foot < 0;
  if (level) for (let i = landing - 1; i >= 0; i--) if (fr[i].onGround && fr[i].pos) { foot = i; break; }
  if (foot < 0) return { port: scene.port, at: scene.at, cause: scene.cause, note: 'no footing in the frames kept' };
  const F = fr[foot];
  const left = fr.slice(foot + 1, landing + 1).find(f => f.onGround === false) || fr[Math.min(foot + 1, landing)];
  const fell = level ? 0 : round(F.pos.y - landY);
  // What pushed it: the last hurt that is not the lava or fire in the three
  // seconds before it left the ground (and up to when it did).
  const hurts = fr.filter(f => f.hurt && f.t >= F.t - 3000 && f.t <= left.t + 250 && !/lava|fire/.test(f.hurt.label)).map(f => ({ t: f.t, ...hurtOf(f.hurt.label) }));
  const lastHurt = hurts.at(-1) || null;
  // The mobs at the footing (the nearest full frame before it left).
  const mobFrame = [...fr.slice(0, foot + 2)].reverse().find(f => f.mobs && f.t >= F.t - 4000);
  // The distance from where each was listed to the feet (a frame's own
  // figure can be from an older look: 25585's hoglin listed at 8.2 stood
  // 1.2 blocks off).
  const dist = (m, p) => m.at && p ? Math.hypot(m.at.x - p.x, m.at.y - p.y, m.at.z - p.z) : m.d;
  const mobs = (mobFrame?.mobs || []).map(m => ({ ...m, d: dist(m, F.pos) })).sort((a, b) => a.d - b.d);
  // A biter at arm's length: at the footing, or in the first full frame
  // after it left (the frames between list no mobs), measured from where
  // the body was then.
  const after = fr.slice(foot + 1).find(f => f.mobs && f.pos && f.t <= left.t + 1000);
  const close = mobs.find(m => m.d <= 3.2 && MELEE.has(m.name)) || (after?.mobs || []).map(m => ({ ...m, d: dist(m, F.pos) })).find(m => m.d <= 3.2 && MELEE.has(m.name));
  const ghast = mobs.find(m => m.name === 'ghast');
  // Hops with no key held, no walk and no health lost in the six seconds
  // before it left: a blow the shield took (knockback with its hop).
  const hops = [];
  for (let i = Math.max(1, fr.findIndex(f => f.t >= F.t - 6000)); i <= foot + 1 && i < fr.length; i++) {
    const f = fr[i], p = fr[i - 1];
    if (f.onGround === false && p.onGround && !f.keys.includes('jump') && !f.pathing && !f.controller && f.health >= (p.health ?? 0) - 0.01 && f.pos && p.pos && f.pos.y > p.pos.y + 0.05) hops.push(f.t);
  }
  // A shot that came as it left (the shot reflex's frames: a fireball
  // that landed, met the shield or burst beside the body).
  const shot = fr.filter(f => f.shot && f.t >= F.t - 1500 && f.t <= left.t + 400).at(-1)?.shot || null;
  const walking = F.pathing || F.controller || left.pathing || left.controller || ['forward', 'back', 'left', 'right', 'sprint'].some(k => F.keys.includes(k) || left.keys.includes(k));
  let pusher = null, how = null;
  if (lastHurt && lastHurt.by) { pusher = lastHurt.by; how = /explosion/.test(lastHurt.how) ? 'blast' : lastHurt.how === 'fireball' ? 'fireball' : lastHurt.how === 'arrow' ? 'arrow' : 'blow'; }
  else if (lastHurt) { how = lastHurt.how; }
  else if (shot) { pusher = shot.name === 'small_fireball' ? 'blaze' : shot.name === 'fireball' ? 'ghast' : shot.name; how = `${shot.name} ${shot.landed ? 'landed' : 'burst without a hit'}, shield ${shot.shield || '?'}`; }
  else if (close && hops.length) { pusher = close.name; how = 'blows the shield took (knock with a hop, no health lost)'; }
  else if (close) { pusher = close.name; how = 'at arm\'s length, no hurt recorded'; }
  else if (walking) how = `its own walk (${F.controller || (F.pathing ? 'pathfinder' : F.keys.join('+'))})`;
  else how = 'nothing recorded';
  // How long the pusher had been near: back from when it left, while the
  // full frames keep listing it (within 8 for a biter, anywhere for a
  // ghast or a blaze), gaps of up to ten seconds.
  let nearFor = null;
  if (pusher) {
    const far = pusher === 'ghast' || pusher === 'blaze' ? 64 : 8;
    let since = left.t, lastSeen = left.t;
    for (let i = foot + 1; i >= 0; i--) {
      const f = fr[i];
      if (!f.mobs) continue;
      if (f.mobs.some(m => m.name === pusher && (f.pos && m.at ? Math.hypot(m.at.x - f.pos.x, m.at.y - f.pos.y, m.at.z - f.pos.z) : m.d) <= far)) { since = f.t; lastSeen = f.t; } else if (lastSeen - f.t > 10000) break;
    }
    nearFor = round((left.t - since) / 1000);
  }
  // The last question answered before it left, and the last stance.
  const decisions = fr.filter(f => f.decision && f.t <= left.t && f.t >= left.t - 60000);
  const last = decisions.at(-1) || null;
  const stanceQ = decisions.filter(f => /stance|shot_answer|span|rail|survival_priority/.test(f.decision.id)).at(-1) || null;
  const said = q => {
    if (!q) return null;
    const chosen = q.decision.path.at(-1), text = q.decision.options[chosen] || '';
    const has = re => re.test(text);
    return { question: q.decision.id, chosen, secondsBefore: round((left.t - q.t) / 1000), offered: Object.keys(q.decision.options),
      saysDrop: has(/drop of|into lava|over the drop|over the edge/), saysPushOver: has(/push|knock|throw/) && has(/drop|lava|edge/),
      saysShieldKnock: has(/blocked blow knocks the bot|knocks the bot back even|shield.{0,60}still (knocks|pushes)/), saysWidth: has(/one block wide|one-wide|two wide/),
      saysPushDeaths: has(/pushed off|push deaths?|push.{0,40}died/) };
  };
  const sa = F.sa, saAge = F.saAt ? round((F.t - Date.parse(F.saAt)) / 1000) : null;
  const world = worldAt(root, scene.port, scene.t);
  const w = world ? worldReader(root, scene.port, world) : null;
  let footing = null;
  try { footing = w ? footingOf(w, F.pos) : null; } catch (e) { footing = { error: e.message }; }
  // The frame the stance that stood still was chosen at (or first held at).
  const STATIONARY = require('../../src/narrow-footing').STATIONARY;
  let stanceFrame = null;
  const chosen = decisions.filter(f => STATIONARY.has(f.decision.path.at(-1))).at(-1);
  if (chosen && left.t - chosen.t <= 30000) stanceFrame = chosen;
  else if (STATIONARY.has(sa)) stanceFrame = fr.slice(0, foot + 1).find(f => f.sa === sa && f.t >= F.t - 30000) || F;
  const sim = stanceFrame ? simulate(scene, w, F, left, stanceFrame, footing) : null;
  return { port: scene.port, at: scene.at, cause: scene.cause, world, level, fell, sim, stance: stanceFrame ? (stanceFrame.decision?.path.at(-1) || sa) : null,
    stood: { x: round(F.pos.x), y: round(F.pos.y), z: round(F.pos.z), at: F.at, health: round(F.health ?? 0) }, footing,
    pusher, how, hurtsBefore: hurts.map(h => `${h.how}${h.by ? ` by ${h.by}` : ''}`), shieldHops: hops.length,
    nearest: mobs.slice(0, 3).map(m => `${m.name} ${round(m.d)}${m.seen === false ? ' unseen' : ''}`), ghastListed: !!ghast,
    nearFor, held: sa, heldForS: saAge, step: F.step, turn: F.turn, walking: !!walking,
    lastQuestion: said(last), lastStance: stanceQ && stanceQ !== last ? said(stanceQ) : null };
}

function report(scenes, { root, asJson }) {
  const rows = scenes.map(s => analyze(s, root));
  const pushed = rows.filter(r => !r.level && r.pusher);
  const tally = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const summary = {
    deaths: rows.length, byCause: tally(rows, r => r.cause), level: rows.filter(r => r.level).length, fellOff: rows.filter(r => !r.level).length,
    fellOffPushed: pushed.length, byPusher: tally(pushed, r => `${r.pusher}: ${r.how}`),
    fellOffByHeld: tally(rows.filter(r => !r.level), r => r.held || 'nothing'),
    footingWidth: tally(rows.filter(r => !r.level && r.footing && !r.footing.unknown && !r.footing.error), r => r.footing.width >= 3 ? '3+' : String(r.footing.width)),
    laidFloor: rows.filter(r => !r.level && r.footing?.laid).length,
    stationaryHeld: rows.filter(r => !r.level && r.stance).length,
    ruleFires: rows.filter(r => r.sim?.fires).length, ruleBeforePush: rows.filter(r => r.sim?.beforePush).length,
    ruleBy: tally(rows.filter(r => r.sim?.fires), r => r.sim.choice),
  };
  if (asJson) { console.log(JSON.stringify({ summary, rows }, null, 2)); return; }
  console.log(JSON.stringify(summary, null, 2));
  for (const r of rows) {
    const f = r.footing;
    const where = !f ? 'no save' : f.unknown ? 'save has no chunk' : f.error ? `save error ${f.error}` : `floor ${f.floorGone ? `gone now (${f.floor})` : f.floor}${f.laid ? ' (laid)' : ''}${f.onCornerOf ? ' (body on its corner)' : ''}, ${f.width} wide (${f.widthX} by ${f.widthZ}), open ${f.open.join('/') || 'none'}${f.overLava != null ? `, lava ${f.overLava} down` : ''}, ${f.fromEdge ?? '?'} from the edge`;
    const q = r.lastStance || r.lastQuestion;
    console.log(`\n${r.port} ${r.at} ${r.world || '?'} ${r.cause}: ${r.level ? 'level (no fall)' : `fell ${r.fell}`} from (${r.stood.x}, ${r.stood.y}, ${r.stood.z}) at ${r.stood.health}; ${where}`);
    console.log(`  pushed: ${r.pusher || '-'} ${r.how}; hurts before: ${r.hurtsBefore.join(', ') || 'none'}; shield hops ${r.shieldHops}; nearest ${r.nearest.join(', ') || 'none'}; near for ${r.nearFor ?? '-'} s`);
    console.log(`  held: ${r.held || '-'} (${r.heldForS ?? '-'} s), step ${r.step || '-'}, turn ${r.turn || '-'}${r.walking ? ', walking' : ''}`);
    if (r.sim) console.log(`  rule (${r.stance}): ${r.sim.error ? `error ${r.sim.error}` : r.sim.fires ? `fires, ${r.sim.choice}${r.sim.seconds != null ? ` ${r.sim.seconds} s` : ''}${r.sim.to ? ` to (${r.sim.to.x}, ${r.sim.to.y}, ${r.sim.to.z}) ${r.sim.to.steps} steps` : ''}, walls ${r.sim.wallBlocks} blocks with ${r.sim.blocks} carried; ${r.sim.had} s stood before it left: ${r.sim.beforePush ? 'moved before the push' : 'not before the push'}; pushers ${r.sim.pushers.join(', ')}` : `does not fire (${r.sim.why}), ${r.sim.had} s stood`}`);
    for (const x of [r.lastQuestion, r.lastStance].filter(Boolean)) console.log(`  ${x.question} -> ${x.chosen} (${x.secondsBefore} s before; offered ${x.offered.join(',')}): drop ${x.saysDrop}, push over ${x.saysPushOver}, shield knock ${x.saysShieldKnock}, width ${x.saysWidth}`);
  }
}
module.exports = { analyze, report, footingOf, worldAt, savedBot, simulate };

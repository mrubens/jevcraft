'use strict';
// Where the time before the first blaze fight goes (note 667). The user,
// watching trials live: "a lot of times ... the bot is just doing something
// extremely stupid like walking back and forth, standing still ... I could
// accept a lot of dying if it's coming from blazes, but a lot of times the bot
// is just struggling to even get there." This measures that time, no behavior
// change: every bot-minute of every trial from its start until its first
// blaze fight (or its end), each called progress, upkeep or waste, the waste
// by a named pattern, and each minute put to the rung and step it was on and
// the question in hand.
//
//   node scripts/wasted-minutes.js [--until rod|fight] [--since ISO] [--to ISO] [--port N] [--top 25] [--examples 3] [--json out.json]
//   node scripts/wasted-minutes.js --window <port> <fromISO> <toISO>   (each minute of one window, with what decided it)
// JEV_ROOT reads another checkout's records (from a worktree).
//
// Each bucket also says how much of its time the body stood still (under
// 0.05 blocks between frames) and how much of it was without a pickaxe.
// A trial: artifacts/midgame/<world>.json, from its start to its end as the
// progress audit finds it (progress-audit.js trialRecords). A blaze fight is
// blaze-record.js's: in the Nether, a blaze in sight within 24 blocks, or the
// bot hurt by a blaze's fireball or blow. Bot time is the gaps under a minute
// between flight frames (flight-commit.js GAP_MS), charged to the minute the
// earlier frame is in; a minute is a minute of the trial's clock.
//
// A minute is PROGRESS when one of these came in it:
//   milestone   a milestone of the bot's record new to the trial, the Nether
//               entered, a fortress walked to (midgame.js reached)
//   rung        a rung measure improved (src/rung-measure.js: a distance to
//               the fortress, to a fortress found or the step's target a new
//               nearest by more than NEARER, the nearest kept BEST_KEEP_MS)
//   item        a thing on the ladder (LADDER below) carried above the most of
//               it carried so far in this life, up to what the ladder has a
//               use for (NEED: one flint, two pickaxes)
//   sighted     a structure or place first seen in the trial (the
//               landmark_found stance: fortress, bastion, ruined portal,
//               warped forest, lava pool...; a fortress in a question's state)
//   ground      NEW_COLUMNS or more block columns stood on that were not
//               stood on before in this life (a crossing that advanced, a
//               tunnel that went on, a walk to somewhere new)
// SLOW (a crawl) when the only progress was a distance nearer or new columns,
//               under SLOW_BLOCKS of either in the minute (a walk covers about
//               250): by what moved the body, span (bridging.js creeping cell
//               to cell), climb (a pillar or stairs), dig, bridge or walk.
//               A sliver of that is not what the minute was when the answers
//               flipped, a wait or a fight held 30 s, or 20+ blocks were
//               walked (pacing if the net is under 6, else old ground). The
//               ranked buckets hold the crawls with the waste.
// JEV DOWN when Jev could not be reached for 30 s or more of the minute and
// nothing above came in it (scripts/lib/jev-down.js, note 781): its own
// bucket, off the bot-hours and the shares, since no decision could be made.
// A death in such a minute is still 'died'.
// UPKEEP when none of those came but the minute kept the body going: food
// points carried up, eating with hunger under 20, health up by 2 or more,
// wood or coal gathered, blocks stocked by a restock step, fighting a mob
// that is not a blaze (hurt, or a fight stance current).
// WASTE otherwise, by the first pattern that holds (the causes before the
// look of it):
//   died                   the bot died in the minute
//   night wait             sleep, a bed, waiting for day
//   shelter sitting        a shelter, bunker, box, pillar top, nook or cover held
//   waiting out a rest     the until_rest_ends detour, rods_waiting
//   stuck/unstuck          persist, detour, shake loose, unstuck_move,
//                          stillness_detour, climb_out, or navigation stalls
//   failed route again     a route that failed 3+ times in 10 min failed again
//                          ('no route', 'No path', 'No way on', can't reach...)
//   flipping               the step or a question's answer going back and
//                          forth between two, 4+ changes
//   re-asking              one question asked 3+ times in the minute
//   bridging, no advance   a crossing step (cross_toward, rail_span,
//                          floor_toward) laying blocks with no progress
//   tunneling by hand      a tunnel step, or ground dug while moving, no progress
//   digging in place       4+ ground blocks dug, under 3 blocks from where it began
//   pacing                 walked 20+ blocks, ended under 6 from where it began
//   standing still         walked under 3 blocks
//   old ground             moving over ground already stood on, nothing gained
const fs = require('fs');
const path = require('path');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const RM = require('../src/rung-measure');
const JD = require('./lib/jev-down');

const MINUTE = 60000;
const GAP_MS = 60000;
const NEW_COLUMNS = 8;
const SLOW_BLOCKS = 10;
// How far apart two sightings of a kind are to be two places (a fortress or
// a forest is large; a lava pool or a dungeon small).
const SAME_PLACE = { fortress: 96, nether_fortress: 96, warped_forest: 96, bastion: 64, other: 24 };
const FIGHT_RANGE = 24;
const CURRENT_MS = 8000;           // a survival action is what the bot is doing for this long after it is set (audit.js)
const FAIL_WINDOW = 10 * MINUTE, FAIL_AGAIN = 3;
const HELD_MS = 30000;             // a wait counts when it held 30 s of the minute
const SINCE_DEFAULT = '2026-09-28T00:00:00Z';

const LADDER = /^((wooden|stone|iron|diamond)_(pickaxe|sword|axe|shovel)|iron_(helmet|chestplate|leggings|boots)|golden_(helmet|chestplate|leggings|boots)|shield|bucket|water_bucket|lava_bucket|bow|crossbow|flint_and_steel|fire_charge|obsidian|crying_obsidian|blaze_rod|blaze_powder|ender_pearl|ender_eye|raw_iron|iron_ingot|iron_ore|deepslate_iron_ore|diamond|raw_gold|gold_ingot|flint|crafting_table|furnace|.*_bed|fire_resistance_potion|potion)$/;
// How many of a thing the ladder has a use for: one more past that is not the
// rung's (rung-measure.js: "a flint picked up on the way is not the rung's").
// A pickaxe and a bucket two, a spare; unnamed, no cap.
const NEED = { raw_gold: 4, gold_ingot: 4, flint: 1, flint_and_steel: 1, fire_charge: 1, shield: 1, water_bucket: 1, lava_bucket: 1, bucket: 2, crafting_table: 1, furnace: 1, bow: 1, crossbow: 1 };
const needOf = k => NEED[k] ?? (/_(pickaxe)$/.test(k) ? 2 : /_(sword|axe|shovel|helmet|chestplate|leggings|boots|bed)$/.test(k) ? 1 : Infinity);
const MATERIALS = /^(.*_log|.*_planks|.*_stem|stick|coal|charcoal|.*_wool|string|leather)$/;
const GROUND = /^(cobblestone|cobbled_deepslate|netherrack|dirt|coarse_dirt|rooted_dirt|gravel|stone|deepslate|andesite|diorite|granite|tuff|calcite|basalt|smooth_basalt|blackstone|sand|red_sand|sandstone|soul_sand|soul_soil|end_stone|nether_bricks|magma_block|glowstone|crimson_nylium|warped_nylium|clay|mud)$/;
let FOOD = null;
const foodPoints = name => {
  if (!FOOD) { try { FOOD = require('minecraft-data')('26.1').foodsByName; } catch (_) { FOOD = {}; } }
  return name === 'rotten_flesh' || name === 'spider_eye' ? 0 : FOOD[name]?.foodPoints || 0;
};

const NIGHT = /^(sleep|sleep_in_bed|sleep_failed|bed_nook|bed_left|bed_recover|wait_for_day|wait_for_day_sealed|wait_for_bedtime)$/;
const SHELTER = /^(wait_in_shelter|pillar_hold|back_to_wall|nook_hold|out_of_sight_hold|out_of_sight|take_cover|box_here|dig_in|dig_in_bunker|dig_nook|shaft_pocket|stay_up|seal_shelter|hold_bunker|hold_box|dig_bunker|box_in|hold_on_span|hold_defensive_position|work_in_pocket)$/;
const REST = /^(rods_waiting)$/;
const STALL_STEP = /^(persist|shake_loose)$/;
const STALL_Q = /^(unstuck_move|stillness_detour|climb_out)$/;
const FIGHT = /^(creeper_close_in|creeper_dance|fight|charge|charge_nearest|defend|close_in|close_on_shooter|corner_ambush|fight_from_footing|dig_in_and_fight|block_creeper|creeper_back_off|leave_reach|block_shot)$/;
const CROSSING = /^(cross_toward|rail_span|floor_toward|swim_across)$/;
const TUNNEL = /^(tunnel|dig_toward_them|tunnel_out|dig_to_shore|dig_in_to_recover)$/;
const RESTOCK = /^(restock_blocks|collect_nearby_resource|nether_gather|wood_reserve|gather_wool|shear_sheep)$/;
const ROUTE_FAIL = /no route|no path|no way on|can't reach|cannot reach|can not reach|out of reach|no existing route|came no nearer|cannot get to|navigation timed out|no reachable/i;

// Where a step is going, by the fields the steps name it with (a survey of the
// observations of 2026-09-29): not a cell stood in or a block worked on.
const STEP_TARGET = ['target', 'destination', 'goingTo', 'portal', 'frame', 'to', 'at', 'origin', 'position', 'spawner'];
const dimOf = d => String(d || '').replace(/^minecraft:/, '').replace(/^the_/, '');
const pt = v => v && Number.isFinite(v.x) && Number.isFinite(v.z) ? { x: v.x, y: Number.isFinite(v.y) ? v.y : 64, z: v.z } : null;
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const round = (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n;
const iso = t => new Date(t).toISOString().slice(0, 19) + 'Z';
const hm = t => new Date(t).toISOString().slice(11, 16);
const human = s => String(s ?? '').replaceAll('_', ' ');
const midgameStart = at => { const m = at.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };
const isBlazeHurt = d => d && (d.type === 'fireball' || d.type === 'mob_attack') && d.cause === 'blaze';

// ---------------------------------------------------------------- frames

// What a minute's verdict needs of a frame, small (a trial is tens of thousands of frames).
function slim(f, t) {
  const s = f.snapshot || {}, o = { t, kind: f.kind };
  // Jev down's evidence (scripts/lib/jev-down.js, note 781).
  const jd = JD.evidenceOf(f);
  if (jd) { if (jd.back) o.jb = 1; else { o.jd = jd.kind; if (jd.marked) o.jm = 1; } }
  if (s.position && Number.isFinite(s.position.x)) o.p = { x: s.position.x, y: s.position.y, z: s.position.z };
  if (s.dimension) o.dim = dimOf(s.dimension);
  if (typeof s.health === 'number') o.hp = s.health;
  if (s.controller?.name) o.ctl = String(s.controller.name);
  if (typeof s.food === 'number') o.food = s.food;
  const st = s.step || s.goal?.step;
  if (st?.action) o.step = { a: st.action, c: st.choice || null, target: STEP_TARGET.map(k => pt(st[k])).find(Boolean) || null, found: st.action === 'find_fortress' ? pt(st.found) || pt(st.walking) : null, walking: !!st.walking,
    dig: Number.isFinite(st.dig) ? st.dig : null, bridge: Number.isFinite(st.bridge) ? st.bridge : null };
  const sa = s.survivalAction || s.goal?.survivalAction;
  if (sa?.action) o.sa = { a: sa.action, at: Date.parse(sa.at) || null, kind: sa.kind || null, pos: pt(sa.position) };
  // Only the observations' pockets: they sum each item over its stacks, where
  // the other frames' name one stack (a decision frame's cobblestone flickered
  // 61 against the observation's between frames three seconds apart).
  if (f.kind === 'observation' && s.inventory && typeof s.inventory === 'object') { o.inv = {}; for (const [k, v] of Object.entries(s.inventory)) if (+v) o.inv[k] = +v; }
  const gp = s.goal?.gameProgress;
  if (gp) { o.phase = gp.phase || null; o.ms = Object.keys(gp.milestones || {}).filter(k => gp.milestones[k]); }
  if (Array.isArray(s.mobs)) o.blaze = s.mobs.some(m => m.name === 'blaze' && m.seen && m.d <= FIGHT_RANGE);
  if (f.kind === 'damage') { o.hurt = String(f.detail?.cause || f.detail?.type || '?'); o.blazeHurt = isBlazeHurt(f.detail); }
  if (f.kind === 'decision') {
    const d = s.decision;
    if (d?.id && !d.stale) o.dec = { id: d.id, at: Date.parse(d.at) || t, answer: (d.path || []).join('/') || '?', only: !!d.only, noneGood: !!d.noneGood, fortress: Number.isFinite(d.state?.fortress?.distance) ? d.state.fortress.distance : null };
  }
  if (/^(error|no_route|navigation_stall|navigation_recovery)$/.test(f.kind)) {
    o.label = String(f.kind === 'no_route' ? `no route (${f.detail?.status || '?'})` : f.label || f.kind).slice(0, 200);
    o.goal = pt(f.detail?.goal);
  }
  if (f.kind === 'chat' && f.detail?.from === 'Jev' && f.detail?.message) o.say = String(f.detail.message).slice(0, 160);
  return o;
}

// The flight files of a port in time order, with the next file's start.
function portFiles(port, dir = FLIGHT) {
  const identity = `127_0_0_1-${port}-Jev`;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  const files = names.filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl'))
    .map(f => ({ f: path.join(dir, f), start: midgameStart(f.slice(identity.length + 1)) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  files.forEach((x, i) => { x.next = files[i + 1]?.start ?? Infinity; });
  return files;
}

// The trial's frames from its start until a blaze fight (the first frame of
// it kept) or its end. -> { frames, fightAt }
function readTrial({ port, start, end, dir = FLIGHT, files = null }) {
  const frames = [];
  let fightAt = null;
  // A file named before the trial's start can still hold its first frames
  // (a bot that stayed up across the start); one named after its end cannot.
  for (const { f, start: fs0, next } of files || portFiles(port, dir)) {
    if (next < start - GAP_MS || fs0 > end) continue;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const t = frameAt(line);
      if (!(t >= start && t <= end)) continue;
      let o; try { o = slim(JSON.parse(line), t); } catch (_) { continue; }
      frames.push(o);
    }
    text = null;
    if (UNTIL === 'fight' && frames.some(isFight)) break;
  }
  frames.sort((a, b) => a.t - b.t);
  const i = UNTIL === 'fight' ? frames.findIndex(isFight) : firstRodGain(frames);
  if (i >= 0) { fightAt = frames[i].t; frames.length = i; }
  return { frames, fightAt };
}
const isFight = o => o.dim === 'nether' && (o.blaze || o.blazeHurt);
// Where a trial's counted time ends: 'rod' (the default) at the first blaze
// rod gained over what the trial began with, so the minutes at a fortress
// before any rod (walking in and out of it, the approach ping-pong) count;
// 'fight' (--until fight) at the first blaze in fighting range, as note 667
// measured. A fortress save reaches a blaze in a median 6.9 minutes, and its
// loops at the fortress fell outside the old cut (Fable, 2026-09-29 19:47Z).
let UNTIL = 'rod';
function firstRodGain(frames) {
  let base = null;
  for (let i = 0; i < frames.length; i++) {
    const inv = frames[i].inv;
    if (!inv) continue;
    const rods = inv.blaze_rod || 0;
    if (base === null) { base = rods; continue; }
    if (rods > base) return i;
  }
  return -1;
}

// ---------------------------------------------------------------- minutes

// Each minute of the trial's clock with what happened in it, the state carried
// through the minutes (this life's ground and most carried, the nearest of
// each distance, milestones, sightings, route failures, the answers given).
function minutesOf(frames, { start }) {
  const bins = new Map();
  const bin = k => { let b = bins.get(k); if (!b) bins.set(k, b = { k, from: start + k * MINUTE, botMs: 0, frames: [] }); return b; };
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], b = bin(Math.floor((f.t - start) / MINUTE));
    b.frames.push(f);
    const n = frames[i + 1];
    if (n && n.t - f.t <= GAP_MS && n.t >= f.t) b.botMs += n.t - f.t;
  }
  const out = [...bins.values()].sort((a, b) => a.k - b.k);
  // Jev down (note 781): how much of each minute was in a spell.
  const spells = JD.spellsOf(frames);

  const life = { cols: new Set(), most: null, lastInv: null };
  const seen = { ms: new Set(), msBase: false, landmarks: {}, found: [], fortress: false, nether: false };
  const best = {};
  const fails = [];
  const answers = {};   // question id -> [{ at, answer }]
  let phase = null, dim = null, hp = null, food = null, lastSa = null, lastStep = null, lastDec = null;
  const firstPhase = frames.find(f => f.phase)?.phase || null;

  for (const b of out) {
    const m = b.m = { jevDownMs: Math.min(MINUTE, JD.overlapMs(spells, b.from, b.from + MINUTE)), jevDownKind: spells.find(sp => sp.to >= b.from && sp.from <= b.from + MINUTE)?.kind || null, walked: 0, net: 0, extent: 0, newCols: 0, dug: 0, laid: 0, items: [], materials: [], foodGain: 0, hpRise: 0, eating: false,
      milestones: [], sighted: [], nearer: [], deaths: 0, dy: 0, stillMs: 0, movedMs: 0, ctl: {}, doing: {}, steps: {}, decs: [], fails: [], stalls: 0, labels: {}, hurtBy: {}, said: [], positions: 0 };
    let first = null, prevP = null, prevT = null, hpLow = hp, lastFood = food, startInv = life.lastInv;
    const stepSeq = [], looks = {};
    for (const f of b.frames) {
      if (f.phase) phase = f.phase;
      const dt = prevT === null ? 0 : Math.min(f.t - prevT, 5000);
      prevT = f.t;
      // Death: health to nothing. A new life: its ground and its most carried begin again.
      if (typeof f.hp === 'number') {
        if (hp !== null && hp > 0 && f.hp <= 0) { m.deaths++; life.cols = new Set(); life.most = null; life.lastInv = null; startInv = null; prevP = null; }
        if (hp !== null && f.hp > 0 && hpLow !== null) m.hpRise = Math.max(m.hpRise, f.hp - hpLow);
        if (hpLow === null || f.hp < hpLow) hpLow = f.hp;
        hp = f.hp;
      }
      if (typeof f.food === 'number') { if (lastFood !== null && f.food > lastFood) m.eating = true; lastFood = f.food; food = f.food; }
      if (f.dim) {
        if (dim && dim !== 'nether' && f.dim === 'nether' && hp > 0 && !seen.nether) { m.milestones.push('the Nether entered'); }
        if (f.dim === 'nether') seen.nether = true;
        dim = f.dim;
      }
      if (f.ms) {
        const fresh = f.ms.filter(k => !seen.ms.has(k));
        if (seen.msBase) for (const k of fresh) m.milestones.push(human(k));
        for (const k of fresh) seen.ms.add(k);
        seen.msBase = true;
      }
      if (f.step) {
        lastStep = f.step;
        if (f.step.dig > 0) m.stepDig = true;
        if (f.step.bridge > 0) m.stepBridge = true;
        if (f.step.a === 'find_fortress' && f.step.walking && !seen.walking) { seen.walking = true; m.milestones.push('a fortress walked to'); }
        const fp = f.step.found;
        // A fortress is a hundred blocks and more across: a point found within
        // SAME_PLACE of one found before is that one again, seen from elsewhere
        // (1017, 74 then 1000, 149 then 1036, 149 on one stuck minute).
        if (fp && !seen.found.some(q => flat(q, fp) <= SAME_PLACE.fortress)) { seen.found.push(fp); m.sighted.push(`a fortress found at ${Math.round(fp.x)}, ${Math.round(fp.z)}`); }
      }
      if (f.sa) {
        lastSa = f.sa;
        if (f.sa.a === 'landmark_found' && f.sa.at && f.sa.at >= b.from - CURRENT_MS) {
          const p = f.sa.pos, kind = f.sa.kind || 'landmark', near = SAME_PLACE[kind] ?? SAME_PLACE.other;
          const known = seen.landmarks[kind] ||= [];
          if (!known.some(q => !p || flat(q, p) <= near)) { if (p) known.push(p); else known.push({ x: NaN, z: NaN }); m.sighted.push(human(kind)); }
        }
      }
      // What it was doing: the survival action while current, else the step.
      const sa = lastSa && lastSa.at && f.t - lastSa.at < CURRENT_MS && lastSa.a !== 'landmark_found' ? lastSa.a : null;
      const doing = sa || lastStep?.a || 'no step';
      if (dt) { m.doing[doing] = (m.doing[doing] || 0) + dt; if (lastStep) m.steps[lastStep.a + (lastStep.c ? `:${lastStep.c}` : '')] = (m.steps[lastStep.a + (lastStep.c ? `:${lastStep.c}` : '')] || 0) + dt; }
      // Flips are counted on the work step: a survival action and the step
      // it serves (return_to_surface over ascend_to_surface) trade names
      // every few seconds without going back and forth.
      const work = lastStep ? lastStep.a + (lastStep.c ? `:${lastStep.c}` : '') : null;
      if (work && stepSeq.at(-1) !== work) stepSeq.push(work);
      if (f.p && f.dim) {
        m.positions++;
        const col = `${f.dim}:${Math.floor(f.p.x)}:${Math.floor(f.p.z)}`;
        if (!life.cols.has(col)) { life.cols.add(col); m.newCols++; }
        if (prevP && prevP.dim === f.dim) {
          const s = d3(prevP.p, f.p), gap = Math.min(f.t - prevP.t, 5000);
          if (s < 20) m.walked += s;
          if (s < 0.05) m.stillMs += gap; else m.movedMs += gap;
        }
        prevP = f;
        if (!first || first.dim !== f.dim) first = f;
        m.extent = Math.max(m.extent, flat(first.p, f.p));
        m.net = flat(first.p, f.p);
        m.dy = f.p.y - first.p.y;
        // The rung's distances: to the fortress found, the step's target.
        const dists = [];
        if (lastStep?.found) dists.push([`found:${Math.round(lastStep.found.x / 16)},${Math.round(lastStep.found.z / 16)}@${f.dim}`, d3(f.p, lastStep.found), 'the fortress found']);
        if (lastStep?.target) dists.push([`step:${lastStep.a}:${Math.round(lastStep.target.x / 4)},${Math.round(lastStep.target.y / 4)},${Math.round(lastStep.target.z / 4)}@${f.dim}`, d3(f.p, lastStep.target), `the ${human(lastStep.a)} target`]);
        for (const [key, v, what] of dists) look(looks, key, v, f.t, what);
      }
      if (f.dec) {
        if (!m.decs.some(d => d.id === f.dec.id && d.at === f.dec.at)) {
          m.decs.push(f.dec);
          lastDec = f.dec;
          if (!f.dec.only) (answers[f.dec.id] ||= []).push({ at: f.dec.at, answer: f.dec.answer.split('/')[0] });
          if (f.dec.fortress !== null) {
            if (!seen.fortress) { seen.fortress = true; m.sighted.push(`a fortress in view, ${Math.round(f.dec.fortress)} blocks off`); }
            look(looks, `fortress@${f.dim || dim}`, f.dec.fortress, f.t, 'the fortress');
          }
        }
      }
      if (f.inv) {
        if (!life.most) life.most = { ...f.inv };
        else {
          for (const [k, v] of Object.entries(f.inv)) {
            if (v <= (life.most[k] || 0)) continue;
            if (LADDER.test(k) && (life.most[k] || 0) < needOf(k)) m.items.push(`${k} ${life.most[k] || 0}→${v}`);
            else if (MATERIALS.test(k)) m.materials.push(k);
            life.most[k] = v;
          }
        }
        if (!startInv) startInv = life.lastInv || f.inv;
        life.lastInv = f.inv;
      }
      if (f.label) {
        if (/^navigation (stall|recovery)/.test(f.label) || f.kind === 'navigation_stall' || f.kind === 'navigation_recovery') m.stalls++;
        else {
          const key = human(f.label).replace(/-?\d+(\.\d+)?/g, 'N').slice(0, 90);
          m.labels[key] = (m.labels[key] || 0) + 1;
          if (ROUTE_FAIL.test(f.label)) {
            const g = f.goal || (() => { const x = f.label.match(/\((-?\d+), (-?\d+), (-?\d+)\)/); return x ? { x: +x[1], y: +x[2], z: +x[3] } : null; })();
            const fk = g ? `to ${Math.round(g.x / 4) * 4}, ${Math.round(g.y / 4) * 4}, ${Math.round(g.z / 4) * 4}` : key;
            fails.push({ t: f.t, key: fk });
            m.fails.push(fk);
          }
        }
      }
      if (f.hurt && !f.blazeHurt) m.hurtBy[f.hurt] = (m.hurtBy[f.hurt] || 0) + 1;
      if (f.say && m.said.length < 3) m.said.push(f.say);
      if (f.ctl) m.ctl[f.ctl] = (m.ctl[f.ctl] || 0) + 1;
    }
    nearerOf(looks, best, m);
    // What it could dig with: a pickaxe in the pockets at the minute's last look.
    if (life.lastInv) m.pickaxe = Object.keys(life.lastInv).some(k => /_pickaxe$/.test(k));
    // Blocks dug or laid and food gathered, as the minute's net change in
    // what is carried (the pockets flicker between frames ten seconds apart:
    // 29 dirt gone and back, so a sum of the steps overcounts).
    if (startInv && life.lastInv && startInv !== life.lastInv) {
      let ground = 0, fp = 0;
      for (const k of new Set([...Object.keys(startInv), ...Object.keys(life.lastInv)])) {
        const dv = (life.lastInv[k] || 0) - (startInv[k] || 0);
        if (GROUND.test(k)) ground += dv;
        fp += dv * foodPoints(k);
      }
      if (ground > 0) m.dug = ground; else m.laid = -ground;
      if (fp > 0) m.foodGain = fp;
    }
    // Flipping: the doing trading between two names, or one question's
    // first answers between two over this minute and the two before.
    m.stepFlips = flipsOf(stepSeq);
    m.answerFlips = 0;
    for (const [id, list] of Object.entries(answers)) {
      const recent = list.filter(a => a.at >= b.from - 2 * MINUTE && a.at < b.from + MINUTE);
      if (!recent.some(a => a.at >= b.from)) continue;
      const n = flipsOf(recent.map(a => a.answer));
      if (n > m.answerFlips) { m.answerFlips = n; m.answerFlipQ = id; }
    }
    m.failedAgain = m.fails.filter(k => fails.filter(x => x.key === k && x.t > b.from + MINUTE - FAIL_WINDOW && x.t < b.from + MINUTE).length >= FAIL_AGAIN).length;
    m.phase = phase || firstPhase;
    m.dimension = dim;
    m.food = food; m.health = hp;
    m.lastDec = lastDec;
  }
  return out;
}

// Changes in a sequence that only trades between two names.
function flipsOf(seq) {
  const s = seq.filter((x, i) => i === 0 || x !== seq[i - 1]);
  let best = 0;
  for (let i = 0; i < s.length; i++) {
    const names = new Set([s[i]]);
    let j = i + 1;
    for (; j < s.length; j++) { names.add(s[j]); if (names.size > 2) break; }
    best = Math.max(best, j - i - 1);
  }
  return best;
}

// A new nearest by more than NEARER against a nearest still fresh
// (rung-measure.js observe/judge): the first look at a distance is its
// baseline, not a gain.
// Each distance looked at in the minute: its first and its last value.
function look(looks, key, v, t, what) {
  const l = looks[key];
  if (!l) looks[key] = { first: v, firstT: t, last: v, lastT: t, what };
  else { l.last = v; l.lastT = t; }
}
// A distance is nearer when it ENDS the minute a new nearest by more than
// NEARER against the nearest kept (rung-measure.js observe/judge: the look
// an answer ends on, against the base it began from): a walk toward a mark
// and back again is not nearer. The first look at a distance is its base,
// a nearest kept BEST_KEEP_MS is stale.
function nearerOf(looks, best, m) {
  for (const [key, l] of Object.entries(looks)) {
    let b = best[key];
    if (!b || l.firstT - b.at >= RM.BEST_KEEP_MS) b = best[key] = { v: l.first, at: l.firstT };
    // Against the minute's own first look too: a mark looked at again after
    // minutes on another step is not nearer now for the walk made then.
    const base = Math.min(b.v, l.first);
    if (l.last < base - RM.NEARER) m.nearer.push({ key, what: l.what, from: Math.round(base), to: Math.round(l.last) });
    if (l.last < b.v - RM.NEARER) best[key] = { v: l.last, at: l.lastT };
  }
}

// ---------------------------------------------------------------- verdicts

// Where the minute ended from where it began, up and down counted: a
// descent of thirteen blocks to a lava pool is not pacing.
const net3 = m => Math.hypot(m.net, m.dy);
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0] || null;
const heldMs = (o, re) => Object.entries(o).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0);

// The waits, by what held 30 s or more of the minute.
function waitOf(m) {
  const doingTop = top(m.doing)?.[0] || 'no step';
  if (heldMs(m.doing, NIGHT) >= HELD_MS || heldMs(m.steps, /^(sleep|wait_for_day)/) >= HELD_MS) return { cls: 'waste', pattern: 'night wait', why: doingTop };
  if (heldMs(m.doing, SHELTER) >= HELD_MS) return { cls: 'waste', pattern: 'shelter sitting', why: doingTop };
  if (heldMs(m.steps, /:until_rest_ends$/) >= HELD_MS || heldMs(m.doing, REST) >= HELD_MS) return { cls: 'waste', pattern: 'waiting out a rest', why: doingTop };
  return null;
}

// -> { cls: 'progress' | 'upkeep' | 'waste', pattern, why }
function classify(m) {
  const P = [];
  if (m.milestones.length) P.push(`milestone: ${m.milestones.join(', ')}`);
  if (m.nearer.length) P.push(`rung: ${m.nearer.map(n => `nearer ${n.what} ${n.from}→${n.to}`).join(', ')}`);
  if (m.items.length) P.push(`item: ${m.items.slice(0, 4).join(', ')}`);
  if (m.sighted.length) P.push(`sighted: ${m.sighted.join(', ')}`);
  if (m.newCols >= NEW_COLUMNS) P.push(`ground: ${m.newCols} new columns`);
  const wait = waitOf(m);
  if (m.deaths) return { cls: 'waste', pattern: 'died', why: `died (${Object.keys(m.hurtBy).join(', ') || 'no hurt frame'})${m.jevDownMs >= HELD_MS ? ', Jev down' : ''}${P.length ? ` (${P.join('; ')})` : ''}` };
  // Jev down for half the minute or more, nothing gained: its own bucket,
  // not waste (note 781). No decision could be made; from 04:57Z on
  // 2026-10-01 the 402s' persists were filed under "stuck/unstuck".
  if (m.jevDownMs >= HELD_MS && !P.length) return { cls: 'jev_down', pattern: 'Jev down', why: `${Math.round(m.jevDownMs / 1000)} s of the minute with Jev not answering (${m.jevDownKind || 'unknown'})` };
  if (P.length) {
    // A crawl: nothing but a distance a little nearer or a few new columns,
    // under SLOW_BLOCKS in the minute (a walk is about 250 blocks a minute).
    const onlyWay = P.every(p => /^(rung|ground):/.test(p));
    const gain = Math.max(0, ...m.nearer.map(n => n.from - n.to));
    const sliver = onlyWay && gain < SLOW_BLOCKS && m.newCols < SLOW_BLOCKS, also = `(${P.join('; ')})`;
    // Nearer to one mark and then another, ending where it began, with no
    // new ground: back and forth between legs is pacing whatever it passed.
    if (onlyWay && m.walked >= 2 * SLOW_BLOCKS && net3(m) < 6 && m.newCols < NEW_COLUMNS)
      return { cls: 'waste', pattern: 'pacing', why: `walked ${round(m.walked)}, net ${round(m.net)} (${P.join('; ')})` };
    if (sliver) {
      // A sliver nearer is not what the minute was: the answers going back
      // and forth, a wait that crept a little first, a fight, or 20+
      // blocks walked over old ground (back and forth, or round about).
      if (m.stepFlips >= 4 || m.answerFlips >= 4) return { cls: 'waste', pattern: 'flipping', why: `${m.answerFlips >= 4 ? `${m.answerFlipQ} answer changed ${m.answerFlips} times` : `step changed ${m.stepFlips} times`} between two ${also}` };
      if (wait) return { ...wait, why: `${wait.why} ${also}` };
      if (heldMs(m.doing, FIGHT) >= HELD_MS) return { cls: 'upkeep', pattern: 'fighting (not blazes)', why: `${top(m.doing)[0]} ${also}` };
      if (m.walked >= 2 * SLOW_BLOCKS) return net3(m) < 6 ? { cls: 'waste', pattern: 'pacing', why: `walked ${round(m.walked)}, net ${round(m.net)} ${also}` }
        : { cls: 'waste', pattern: 'old ground', why: `walked ${round(m.walked)}, net ${round(m.net)}, ${m.newCols} new columns ${also}` };
      // Else a crawl. How it went: the controller that moved the body first (bridging.js's
      // creep onto the next cell of a span, bridge_step; pillar-recovery.js's
      // jump, pillar_up), then the body (up more than along is a climb),
      // then the step's own plan (the cells a crossing digs or bridges).
      const how = m.ctl.bridge_step ? 'span' : m.ctl.pillar_up || (m.dy >= 3 && m.dy > m.net) ? 'climb'
        : m.stepDig || heldMs(m.steps, TUNNEL) >= HELD_MS || m.dug > 0 ? 'dig' : m.stepBridge || m.laid > 0 ? 'bridge' : 'walk';
      return { cls: 'slow', pattern: `crawling (${how})`, why: `${P.join('; ')}; under ${SLOW_BLOCKS} blocks in the minute` };
    }
    return { cls: 'progress', pattern: P[0].split(':')[0], why: P.join('; ') };
  }
  const doingTop = top(m.doing)?.[0] || 'no step';
  if (m.foodGain >= 2) return { cls: 'upkeep', pattern: 'food gathered', why: `${m.foodGain} food points` };
  if (m.eating && m.food !== null) return { cls: 'upkeep', pattern: 'eating', why: `hunger up to ${m.food}` };
  if (m.hpRise >= 2) return { cls: 'upkeep', pattern: 'healing', why: `health up ${round(m.hpRise, 1)}` };
  if (Object.keys(m.hurtBy).length || heldMs(m.doing, FIGHT) >= 15000) return { cls: 'upkeep', pattern: 'fighting (not blazes)', why: Object.keys(m.hurtBy).join(', ') || doingTop };
  if (m.materials.length) return { cls: 'upkeep', pattern: 'materials', why: [...new Set(m.materials)].join(', ') };
  if (m.dug >= 4 && heldMs(m.steps, RESTOCK) >= HELD_MS) return { cls: 'upkeep', pattern: 'stocking blocks', why: `${m.dug} blocks` };

  if (wait) return wait;
  const stallQ = m.decs.filter(d => STALL_Q.test(d.id)).length;
  if (heldMs(m.doing, STALL_STEP) + heldMs(m.steps, /^detour(?!:until_rest_ends)/) >= HELD_MS || stallQ || m.stalls >= 2)
    return { cls: 'waste', pattern: 'stuck/unstuck', why: `${stallQ ? `${stallQ} unstuck questions, ` : ''}${m.stalls} stalls, ${doingTop}` };
  if (m.failedAgain) return { cls: 'waste', pattern: 'failed route again', why: [...new Set(m.fails)].slice(0, 2).join('; ') };
  if (m.stepFlips >= 4) return { cls: 'waste', pattern: 'flipping', why: `step changed ${m.stepFlips} times between two` };
  if (m.answerFlips >= 4) return { cls: 'waste', pattern: 'flipping', why: `${m.answerFlipQ} answer changed ${m.answerFlips} times between two` };
  const asked = {};
  for (const d of m.decs) if (!d.only) asked[d.id] = (asked[d.id] || 0) + 1;
  const most = top(asked);
  if (most && most[1] >= 3) return { cls: 'waste', pattern: 're-asking', why: `${most[0]} ${most[1]} times` };
  if (heldMs(m.steps, CROSSING) >= HELD_MS && m.laid >= 1) return { cls: 'waste', pattern: 'bridging, no advance', why: `${m.laid} laid, ${m.newCols} new columns` };
  if (heldMs(m.steps, TUNNEL) >= HELD_MS || (m.dug >= 4 && net3(m) >= 3)) return { cls: 'waste', pattern: 'tunneling by hand', why: `${m.dug} dug, net ${round(m.net)}` };
  if (m.dug >= 4) return { cls: 'waste', pattern: 'digging in place', why: `${m.dug} dug, net ${round(m.net)}` };
  if (m.walked >= 20 && net3(m) < 6) return { cls: 'waste', pattern: 'pacing', why: `walked ${round(m.walked)}, net ${round(m.net)}` };
  if (m.walked < 3) return { cls: 'waste', pattern: 'standing still', why: `walked ${round(m.walked, 1)}` };
  return { cls: 'waste', pattern: 'old ground', why: `walked ${round(m.walked)}, net ${round(m.net)}, ${m.newCols} new columns` };
}

// The step (rung: what it was doing) and the question in hand for a minute.
function attribution(m) {
  const doing = top(m.doing)?.[0] || 'no step';
  const step = `${m.phase ? human(m.phase) : '?'}: ${human(doing)}`;
  const asked = {};
  for (const d of m.decs) if (!d.only) { const k = `${d.id} → ${d.answer.split('/')[0]}`; asked[k] = (asked[k] || 0) + 1; }
  const most = top(asked);
  let question = most ? most[0] : null;
  if (!question && m.lastDec && !m.lastDec.only) question = `${m.lastDec.id} → ${m.lastDec.answer.split('/')[0]}`;
  return { step, question: question ? human(question) : 'none asked' };
}

// ---------------------------------------------------------------- report

function analyse({ since, to = Infinity, ports = null, dir = FLIGHT, progress = null }) {
  const audit = require('./trials/progress-audit');
  let trials = audit.trialRecords({ since: since - 1, flight: dir }).filter(t => t.port && t.start < to);
  if (ports) trials = trials.filter(t => ports.includes(Number(t.port)));
  const filesByPort = new Map();
  const rows = [], trialsOut = [];
  trials.forEach((tr, i) => {
    if (!filesByPort.has(tr.port)) filesByPort.set(tr.port, portFiles(tr.port, dir));
    const end = Math.min(tr.end, to);
    const { frames, fightAt } = readTrial({ port: tr.port, start: tr.start, end, files: filesByPort.get(tr.port) });
    const bins = minutesOf(frames, { start: tr.start });
    const kind = /\/stages\/fortress\//.test(tr.source || '') ? 'fortress checkpoint' : /\/stages\/nether\//.test(tr.source || '') ? 'nether checkpoint' : 'fresh';
    let botMs = 0, wasteMs = 0, downMs = 0;
    for (const b of bins) {
      if (!b.botMs) continue;
      const v = classify(b.m), a = attribution(b.m);
      rows.push({ port: tr.port, world: tr.world, kind, from: b.from, ms: b.botMs, ...v, ...a, m: b.m });
      if (v.cls === 'jev_down') { downMs += b.botMs; continue; }
      botMs += b.botMs; if (v.cls === 'waste') wasteMs += b.botMs;
    }
    trialsOut.push({ world: tr.world, port: tr.port, kind, start: tr.start, end, fightAt, minutesToFight: fightAt ? round((fightAt - tr.start) / MINUTE, 1) : null, botHours: botMs / 3600000, wasteHours: wasteMs / 3600000, jevDownHours: downMs / 3600000 });
    if (progress) progress(i + 1, trials.length, tr.world);
  });
  return { rows, trials: trialsOut };
}

// Consecutive minutes of one trial in one bucket, as windows.
function windowsOf(rows, keyOf) {
  const out = new Map();
  let cur = null;
  for (const r of rows) {
    const key = keyOf(r);
    if (cur && cur.key === key && cur.world === r.world && r.from - cur.last === MINUTE) { cur.last = r.from; cur.ms += r.ms; cur.rows.push(r); continue; }
    cur = { key, world: r.world, port: r.port, first: r.from, last: r.from, ms: r.ms, rows: [r] };
    (out.get(key) || out.set(key, []).get(key)).push(cur);
  }
  return out;
}

// What a window shows, from its minutes: the walk, the questions, the labels.
function describe(w) {
  const sum = (f) => w.rows.reduce((n, r) => n + f(r.m), 0);
  const decs = {}, labels = {}, said = [];
  let noneGood = 0;
  for (const r of w.rows) {
    for (const d of r.m.decs) { if (d.only) continue; const k = `${d.id}→${d.answer.split('/').slice(0, 2).join('/')}`; decs[k] = (decs[k] || 0) + 1; if (d.noneGood) noneGood++; }
    for (const [k, v] of Object.entries(r.m.labels)) labels[k] = (labels[k] || 0) + v;
    for (const s of r.m.said) if (said.length < 2 && !said.includes(s)) said.push(s);
  }
  const ranked = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} x${v}`).join('; ');
  return { port: w.port, world: w.world, from: iso(w.first), to: iso(w.last + MINUTE), minutes: w.rows.length, botMinutes: round(w.ms / MINUTE, 1),
    walked: round(sum(m => m.walked)), newColumns: sum(m => m.newCols), dug: sum(m => m.dug), laid: sum(m => m.laid),
    stillShare: round(sum(m => m.stillMs) / Math.max(1, sum(m => m.stillMs + m.movedMs)), 2),
    why: w.rows[0].why, decisions: ranked(decs) || 'none', noneGood, labels: ranked(labels) || 'none', said };
}

function report({ rows: all, trials }, { topN = 25, examples = 3 } = {}) {
  const H = ms => ms / 3600000;
  // Jev-down minutes are their own bucket, off the bot-hours and the shares (note 781).
  const rows = all.filter(r => r.cls !== 'jev_down'), jevDownMs = all.reduce((n, r) => n + (r.cls === 'jev_down' ? r.ms : 0), 0);
  const total = rows.reduce((n, r) => n + r.ms, 0);
  const by = (keyOf, filter = () => true) => { const o = {}; for (const r of rows) if (filter(r)) { const k = keyOf(r); o[k] = (o[k] || 0) + r.ms; } return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const cls = Object.fromEntries(by(r => r.cls));
  // The ranked buckets are the waste and the crawls: both are the bot not getting there.
  const waste = r => r.cls === 'waste' || r.cls === 'slow';
  const bucketKey = r => `${r.pattern} | ${r.step} | ${r.question}`;
  const wins = windowsOf(rows.filter(waste), bucketKey);
  const buckets = by(bucketKey, waste).slice(0, topN).map(([k, ms]) => {
    const [pattern, step, question] = k.split(' | ');
    const ws = (wins.get(k) || []).sort((a, b) => b.ms - a.ms);
    const picked = [], worlds = new Set();
    for (const w of ws) { if (picked.length >= examples) break; if (worlds.has(w.world)) continue; worlds.add(w.world); picked.push(w); }
    for (const w of ws) { if (picked.length >= examples) break; if (!picked.includes(w)) picked.push(w); }
    const still = ws.reduce((n, w) => n + w.rows.reduce((k, r) => k + r.m.stillMs, 0), 0), moved = ws.reduce((n, w) => n + w.rows.reduce((k, r) => k + r.m.movedMs, 0), 0);
    return { pattern, step, question, botHours: round(H(ms), 2), share: round(ms / total, 3), trials: new Set(ws.map(w => w.world)).size, windows: ws.length,
      stillShare: round(still / Math.max(1, still + moved), 2),
      noPickaxe: (() => { const rs = ws.flatMap(w => w.rows).filter(r => r.m.pickaxe !== undefined); return rs.length ? round(rs.filter(r => !r.m.pickaxe).length / rs.length, 2) : null; })(),
      examples: picked.map(describe) };
  });
  const byKind = {};
  for (const r of rows) { const k = byKind[r.kind] ||= { botMs: 0, wasteMs: 0, slowMs: 0 }; k.botMs += r.ms; if (r.cls === 'waste') k.wasteMs += r.ms; if (r.cls === 'slow') k.slowMs += r.ms; }
  const fought = trials.filter(t => t.fightAt);
  const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
  return {
    trials: trials.length, trialsWithFight: fought.length, medianMinutesToFight: med(fought.map(t => t.minutesToFight)),
    botHours: round(H(total), 1), jevDownHours: round(H(jevDownMs), 2), progressHours: round(H(cls.progress || 0), 1), upkeepHours: round(H(cls.upkeep || 0), 1), slowHours: round(H(cls.slow || 0), 1), wasteHours: round(H(cls.waste || 0), 1),
    wasteShare: round((cls.waste || 0) / total, 3), slowShare: round((cls.slow || 0) / total, 3),
    byStart: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { botHours: round(H(v.botMs), 1), wasteShare: round(v.wasteMs / v.botMs, 3), slowShare: round(v.slowMs / v.botMs, 3) }])),
    patterns: by(r => `${r.cls}: ${r.pattern}`).map(([k, ms]) => ({ pattern: k, botHours: round(H(ms), 2), share: round(ms / total, 3) })),
    patternStep: by(r => `${r.pattern} | ${r.step}`, waste).slice(0, topN).map(([k, ms]) => ({ bucket: k, botHours: round(H(ms), 2) })),
    buckets,
  };
}

function table(r) {
  const out = [];
  const pct = x => `${round(x * 100, 1)}%`;
  out.push(`Trials: ${r.trials} (${r.trialsWithFight} reached a blaze fight; median ${r.medianMinutesToFight ?? '-'} min to it). Bot-hours before the first blaze fight: ${r.botHours}.`);
  if (r.jevDownHours) out.push(`Jev down (not counted above or below): ${r.jevDownHours} h.`);
  out.push(`Progress ${r.progressHours} h, crawling ${r.slowHours} h (${pct(r.slowShare)}), upkeep ${r.upkeepHours} h, waste ${r.wasteHours} h (${pct(r.wasteShare)} wasted; ${pct(r.wasteShare + r.slowShare)} with the crawls).`);
  out.push(`By start: ${Object.entries(r.byStart).map(([k, v]) => `${k} ${v.botHours} h, ${pct(v.wasteShare)} wasted, ${pct(v.slowShare)} crawling`).join('; ')}.`);
  out.push('', 'By pattern:');
  for (const p of r.patterns) out.push(`  ${p.pattern.padEnd(36)} ${String(p.botHours).padStart(7)} h  ${pct(p.share)}`);
  out.push('', 'Waste and crawls by pattern x step:');
  for (const p of r.patternStep) out.push(`  ${String(p.botHours).padStart(6)} h  ${p.bucket}`);
  out.push('', 'Waste and crawl buckets, pattern x step x question:');
  r.buckets.forEach((b, i) => {
    out.push(`${String(i + 1).padStart(2)}. ${b.botHours} h (${pct(b.share)}), ${b.trials} trials, ${b.windows} windows, still ${Math.round(b.stillShare * 100)}%${b.noPickaxe ? `, no pickaxe ${Math.round(b.noPickaxe * 100)}%` : ''}: ${b.pattern} | ${b.step} | ${b.question}`);
    for (const e of b.examples) {
      out.push(`      ${e.port} ${e.world} ${e.from.slice(5, 16)}-${e.to.slice(11, 16)}Z (${e.minutes} min): walked ${e.walked}, ${e.newColumns} new cols, still ${Math.round(e.stillShare * 100)}% of the time; ${e.why}`);
      out.push(`        asked: ${e.decisions}${e.noneGood ? ` (${e.noneGood} none good)` : ''}; labels: ${e.labels}${e.said.length ? `; said: "${e.said[0].slice(0, 90)}"` : ''}`);
    }
  });
  return out.join('\n');
}

// One window, a minute a line: what decided each.
function windowLines(port, from, to, dir = FLIGHT) {
  const audit = require('./trials/progress-audit');
  const tr = audit.trialRecords({ since: -Infinity, flight: dir }).filter(t => Number(t.port) === Number(port) && t.start < to && t.end > from).sort((a, b) => b.start - a.start)[0];
  const start = tr ? tr.start : from;
  const { frames, fightAt } = readTrial({ port, start, end: to, dir });
  const out = [`${port} ${tr?.world || '?'} trial from ${iso(start)}${fightAt ? `, first blaze fight ${iso(fightAt)}` : ''}`];
  for (const b of minutesOf(frames, { start })) {
    if (b.from + MINUTE <= from || !b.botMs) continue;
    const v = classify(b.m), a = attribution(b.m), m = b.m;
    out.push(`${hm(b.from)} ${String(round(b.botMs / 1000)).padStart(2)}s ${v.cls.padEnd(8)} ${v.pattern.padEnd(22)} | ${a.step} | ${a.question} | walked ${round(m.walked)} net ${round(m.net)} extent ${round(m.extent)} new ${m.newCols} dug ${m.dug} laid ${m.laid} | ${v.why}`);
  }
  return out.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
  UNTIL = opt('until', 'rod') === 'fight' ? 'fight' : 'rod';
  const time = s => { const t = Date.parse(s); if (!Number.isFinite(t)) throw new Error(`not a time: ${s}`); return t; };
  const w = argv.indexOf('--window');
  if (w >= 0) { console.log(windowLines(Number(argv[w + 1]), time(argv[w + 2]), time(argv[w + 3]))); return; }
  const since = time(opt('since', SINCE_DEFAULT)), to = opt('to') ? time(opt('to')) : Infinity;
  const ports = opt('port') ? String(opt('port')).split(',').map(Number) : null;
  const a = analyse({ since, to, ports, progress: (i, n, world) => process.stderr.write(`\r${i}/${n} ${world}`.padEnd(64)) });
  process.stderr.write('\n');
  const r = report(a, { topN: Number(opt('top', 25)), examples: Number(opt('examples', 3)) });
  const json = opt('json');
  if (json) fs.writeFileSync(json, JSON.stringify({ since: iso(since), ...r, trialsList: a.trials.map(t => ({ ...t, start: iso(t.start), end: iso(t.end), fightAt: t.fightAt && iso(t.fightAt), botHours: round(t.botHours, 2), wasteHours: round(t.wasteHours, 2) })) }, null, 1));
  console.log(table(r));
}

if (require.main === module) main();
module.exports = { firstRodGain, setUntil: u => { UNTIL = u; }, analyse, slim, minutesOf, classify, attribution, flipsOf, windowsOf, report, table, readTrial, isFight, NEW_COLUMNS, LADDER };

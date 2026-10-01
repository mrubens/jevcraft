#!/usr/bin/env node
'use strict';
// How the stance question priced the mobs about, from the flight records
// (note 770): the live critic's 23:39Z items 1 and 2 (25585 dodging a
// skeleton at arm's length behind every option's word of a creeper 16 to
// 24 blocks off; 25598 shielding a zombie while a skeleton shot it, and
// hits landing in the quarter second a raised shield takes to block).
//   1. encounter_stance answers whose mob-by-blow sentence (blowsSay) named
//      a mob farther than the nearest threat in the question's own state,
//      and of those, a creeper past the sixteen blocks it sets on a player
//      from; and those framed by time ("Farther off, ...", note 770).
//   2. hides (out_of_sight, take_cover, nook, bunker, seal, pillar, dig_in)
//      chosen with a shooter within three blocks.
//   3. hits (damage frames with a mob or an arrow as the cause) that landed
//      with the shield rising (raised within the quarter second before it
//      blocks), per 100 hits, by what was in hand before: a stance answered
//      in the second before (its switch or re-ask), else the survival
//      action in force (a guard's own strike, a charge, the swing reflex,
//      the shot reflex's raise), and where the recorder kept it (note 770)
//      what lowered the shield last.
//   4. stances asked again because their mobs stayed out of sight and no
//      nearer (note 752j), and how soon the next stance question came.
//   node scripts/stance-pricing.js [--since ISO] [--to ISO] [--json]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const since = Date.parse(opt('--since', '2026-09-30T06:00:00Z'));
const to = opt('--to', null) ? Date.parse(opt('--to')) : Infinity;
const HIDES = new Set(['out_of_sight', 'take_cover', 'nook', 'bunker', 'seal', 'pillar', 'dig_in']);
const SHOOTERS = new Set(['skeleton', 'stray', 'bogged', 'parched', 'pillager', 'blaze', 'ghast', 'witch', 'piglin', 'drowned', 'breeze']);
const FOLLOW = { zombie: 35, husk: 35, drowned: 35, zombie_villager: 35, zombified_piglin: 35, enderman: 64, blaze: 48, pillager: 32, ravager: 32, creaking: 32, warden: 24, breeze: 24, vindicator: 12, piglin_brute: 12, evoker: 12, illusioner: 18 };

const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };
const fileStart = name => { const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
// The blow's lead (survival.js blowsSay): "The zombie 17 blocks off, out of
// sight, hits for ..." or "The creeper 23.8 blocks off goes off ...".
const BLOWS = /(?:^|\. |: )(Farther off[^:]*: )?[Tt]he ([a-z_ ]+?) ([\d.]+) blocks off(?:, out of sight)?(?:, the (?:hardest hitter|first)[^,]*)?,? (hits for|goes off|is about [\d.]+ seconds of walking)/;
// What was in force when a hit landed with the shield rising, by kind.
const SHIELD_STANCES = new Set(['shield_guard', 'shield_the_charge', 'shield_the_blast']);
const HOLDING = new Set(['take_cover', 'back_to_wall', 'corner_ambush', 'box_here', 'box_at_spawner', 'dig_in', 'dig_in_at_spawner', 'bunker', 'seal', 'nook', 'out_of_sight', 'pillar', 'stand_by_spawner', 'nook_hold', 'pillar_hold', 'out_of_sight_hold', 'shaft_pocket', 'pillar_from']);
const CLOSING = new Set(['fight', 'charge', 'charge_shooter', 'charge_nearest', 'close_in', 'fight_from_footing', 'strike_from_above', 'rail_and_fight']);
const bucketOf = by => /^encounter_stance answered/.test(by) ? 'a stance answered in the second before (a switch or re-ask)'
  : /^shot_answer answered/.test(by) ? 'a shot_answer in the second before (the raise it answered)'
  : (a => SHIELD_STANCES.has(a) ? 'a shield stance (the guard\'s own strikes)' : HOLDING.has(a) ? 'a holding stance (the step lowering it between passes)' : CLOSING.has(a) ? 'a fight or a charge (its swings)' : a === 'defend' ? 'the swing reflex (defend)' : a === 'block_shot' ? 'the shot reflex raising it for a shot' : 'other work or reflexes')(by.replace(/^under /, ''));
// The lead as note 770's rule would give it, from the question's own
// estimate: the mob whose first harm comes soonest, those past their follow
// range left out, and behind a hit or a shooter now, framed by its seconds.
const SPEED = { zombie: 2.28, husk: 2.28, drowned: 2.28, zombie_villager: 2.28, skeleton: 2.7, stray: 2.7, creeper: 2.7, spider: 3.89, cave_spider: 3.89, piglin: 2.7, piglin_brute: 5.29, hoglin: 3.89, zoglin: 3.89, wither_skeleton: 3.89, enderman: 3.89, magma_cube: 2.2, slime: 2.2, witch: 2.7, vindicator: 3.8 };
function simulatedLead(d, desc) {
  const mobs = (d.state?.estimate?.mobs || []).filter(m => !m.apart);
  const hitNow = /^(Hitting the bot now|Shooting at the bot from here)/.test(desc);
  const named = new Set([...desc.matchAll(/Hitting the bot now: the ([a-z_ ]+?) [\d.]+ blocks off/g)].map(m => m[1].replaceAll(' ', '_')));
  const kept = mobs.filter(m => !(m.distance > (FOLLOW[m.name] ?? 16)) || named.has(m.name));
  const arrives = m => Math.max(0, m.distance - (m.name === 'creeper' ? 3 : 1.5)) / (SPEED[m.name] || 2.5) + (m.name === 'creeper' ? 1.5 : 0);
  const cands = kept.filter(m => !m.shoots && m.hitsBot > 0 && !m.far).sort((a, b) => arrives(a) - arrives(b));
  const lead = cands[0];
  if (!lead) return null;
  return { mob: lead, framed: (hitNow && arrives(lead) >= 2) || (lead.name === 'creeper' && Math.max(0, lead.distance - 3) / 2.7 >= 5) };
}

const totals = { simWithLead: 0, simFarther: 0, simFartherUnframed: 0, simCreeperPast: 0, risingBucket: {}, stances: 0, withBlows: 0, fartherLead: 0, fartherUnframed: 0, creeperPastFollow: 0, creeperPastFollowUnframed: 0, hides: 0, hidesShooter3: 0, shooter3Asks: 0, hits: 0, rising: 0, risingBy: {}, loweredBy: {}, unseenReasks: 0, unseenReaskFollowed: 0 };
const examples = { fartherLead: [], hidesShooter3: [], rising: [] };

async function readFile(file) {
  const port = (file.match(/-(\d{5})-Jev-/) || [])[1];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  const answered = []; // [{t, id, choice}]
  const stanceTimes = [];
  const unseen = [];
  for await (const line of rl) {
    if (!line) continue;
    const isDecision = line.startsWith('{"kind":"decision"');
    const isDamage = line.startsWith('{"kind":"damage"');
    if (!isDecision && !isDamage) continue;
    const t = frameAt(line);
    if (!(t >= since && t <= to)) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    if (isDecision) {
      const d = o.snapshot?.decision;
      if (!d?.id) continue;
      const choice = d.judgments?.[0]?.choice || d.path?.[0];
      answered.push({ t, id: d.id, choice });
      if (d.id !== 'encounter_stance') continue;
      stanceTimes.push(t);
      totals.stances++;
      const threats = d.state?.threats || [];
      const nearest = threats.slice().sort((a, b) => a.distance - b.distance)[0];
      const why = d.state?.previousStance?.askedAgainFor || '';
      if (/out of sight and no nearer/.test(why)) unseen.push(t);
      const desc = Object.values(d.options || {})[0]?.description || '';
      const m = BLOWS.exec(desc);
      if (m) {
        totals.withBlows++;
        const name = m[2].replaceAll(' ', '_'), dist = Number(m[3]);
        if (nearest && dist > nearest.distance + 1) {
          totals.fartherLead++;
          if (!m[1]) totals.fartherUnframed++;
          if (examples.fartherLead.length < 6) examples.fartherLead.push(`${port} ${new Date(t).toISOString().slice(11, 19)} ${name} ${dist} led, nearest ${nearest.name} ${nearest.distance}`);
        }
        if (name === 'creeper' && dist > (FOLLOW.creeper ?? 16)) { totals.creeperPastFollow++; if (!m[1]) totals.creeperPastFollowUnframed++; }
      }
      const sim = simulatedLead(d, desc);
      if (sim) {
        totals.simWithLead++;
        if (nearest && sim.mob.distance > nearest.distance + 1) { totals.simFarther++; if (!sim.framed) totals.simFartherUnframed++; }
        if (sim.mob.name === 'creeper' && sim.mob.distance > 16) totals.simCreeperPast++;
      }
      const shooter3 = threats.some(x => (x.shoots || SHOOTERS.has(x.name)) && x.distance <= 3 && x.visible !== false);
      if (shooter3) totals.shooter3Asks++;
      if (HIDES.has(choice)) {
        totals.hides++;
        if (shooter3) {
          totals.hidesShooter3++;
          if (examples.hidesShooter3.length < 8) examples.hidesShooter3.push(`${port} ${new Date(t).toISOString().slice(11, 19)} ${choice} with ${threats.filter(x => x.distance <= 3).map(x => `${x.name} ${x.distance}`).join(', ')}`);
        }
      }
    } else {
      const det = o.detail || {};
      if (!det.cause || det.type === 'fall' || det.type === 'lava' || det.type === 'explosion') continue;
      if (!/mob_attack|arrow|trident|mob_projectile|fireball|thrown/.test(det.type || '')) continue;
      totals.hits++;
      const keys = o.snapshot?.keys || [];
      if (!keys.includes('shield_rising')) continue;
      totals.rising++;
      // What was in hand before the raise: a question answered in the
      // second before the hit, else the survival action in force.
      const recent = answered.filter(a => t - a.t <= 1000 && t >= a.t).at(-1);
      const sa = o.snapshot?.goal?.survivalAction?.action || 'none';
      const by = recent && (recent.id === 'encounter_stance' || recent.id === 'shot_answer') ? `${recent.id} answered (${recent.choice}) in the second before` : `under ${sa}`;
      totals.risingBy[by] = (totals.risingBy[by] || 0) + 1;
      totals.risingBucket[bucketOf(by)] = (totals.risingBucket[bucketOf(by)] || 0) + 1;
      const lowered = o.snapshot?.shieldLowered?.by;
      if (lowered) totals.loweredBy[lowered] = (totals.loweredBy[lowered] || 0) + 1;
      if (examples.rising.length < 8) examples.rising.push(`${port} ${new Date(t).toISOString().slice(11, 19)} ${det.cause} ${by}`);
    }
  }
  for (const u of unseen) {
    totals.unseenReasks++;
    if (stanceTimes.some(s => s > u && s - u <= 10000)) totals.unseenReaskFollowed++;
  }
}

async function main() {
  const dir = path.join(ROOT, '.bot-state', 'flight');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && f.includes('-Jev-'))
    .filter(f => { const s = fileStart(f); return !(s > to) && fs.statSync(path.join(dir, f)).mtimeMs >= since; })
    .map(f => path.join(dir, f));
  for (const f of files) await readFile(f);
  if (args.includes('--json')) { console.log(JSON.stringify({ files: files.length, totals, examples }, null, 1)); return; }
  const pct = (a, b) => b ? `${Math.round(a / b * 1000) / 10}%` : '-';
  console.log(`Flight records ${new Date(since).toISOString()} on: ${files.length} files`);
  console.log(`encounter_stance answers: ${totals.stances}; with a blow's lead ${totals.withBlows}`);
  console.log(`  lead named a mob farther than the nearest threat: ${totals.fartherLead} (${pct(totals.fartherLead, totals.withBlows)}), not framed by its time ${totals.fartherUnframed}`);
  console.log(`  lead named a creeper past its 16 blocks: ${totals.creeperPastFollow}, not framed by its time ${totals.creeperPastFollowUnframed}`);
  console.log(`  as note 770's rule would lead, from each question's own estimate: ${totals.simWithLead} with a lead; farther than the nearest threat ${totals.simFarther}, not framed by its time ${totals.simFartherUnframed}; a creeper past its 16 blocks ${totals.simCreeperPast}`);
  console.log(`hides chosen: ${totals.hides}; with a shooter in sight within 3 blocks ${totals.hidesShooter3} (of ${totals.shooter3Asks} stance answers with one)`);
  console.log(`hits by a mob or its shot: ${totals.hits}; shield rising ${totals.rising} (${Math.round(totals.rising / Math.max(1, totals.hits) * 1000) / 10} per 100)`);
  for (const [k, n] of Object.entries(totals.risingBucket).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
  if (args.includes('--detail')) for (const [k, n] of Object.entries(totals.risingBy).sort((a, b) => b[1] - a[1])) console.log(`    ${n}  ${k}`);
  if (Object.keys(totals.loweredBy).length) { console.log('  lowered last by (recorded):'); for (const [k, n] of Object.entries(totals.loweredBy).sort((a, b) => b[1] - a[1])) console.log(`    ${n}  ${k}`); }
  console.log(`stances asked again for mobs out of sight and no nearer (752j): ${totals.unseenReasks}, another stance within 10 s ${totals.unseenReaskFollowed}`);
  for (const [k, v] of Object.entries(examples)) if (v.length) console.log(`${k}:\n  ${v.join('\n  ')}`);
}
main().catch(e => { console.error(e); process.exit(1); });

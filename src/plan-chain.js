'use strict';
// Plan answers that take no time, and answers that turn back on one just
// given (note 705).
//
// On 25589 (mid-242-cf-nether-1-fortress-25, 00:32:36 to 39Z on 2026-09-30)
// nine questions about the plan were answered in three seconds from one
// block: fortress_leg leg_south, fortress_approach walk_route (no path at
// once), keep_searching ("Leaving this fortress for now"), fortress_leg
// go_to_blazes_about, fortress_approach other_way, fortress_leg fetch_stems,
// nether_gather without, fortress_leg back_to_fortress, fortress_approach
// cross_level: leave the fortress, go to its blazes, back to it. None of
// them failed in a way note 695 reads (at-once.js takes an answer that
// starts something and ends at once): keep_searching, other_way and without
// end by what they are, handing the turn to the next loop's question, and
// intention.js ends what holds on them. So each question was asked as if
// it were the first.
//
// Here every answer to a question about the plan (intention.js GATED) is
// kept with when and where. (1) The next such question hears the answers
// just before it from this spot that took no time, and, where the last one
// turned back on one of them (the same topic, the other side), says it as
// a reversal: "go to blazes about (fortress leg), chosen 1 second ago,
// reverses keep searching (fortress approach), chosen 2 seconds ago from
// here: leave this fortress". An option that would turn back on the last
// answer, or on the answer holding as the intention when its own question
// is asked again, says so on itself, with what changed since. (2) More than
// CHAIN_N different plan answers in a row, each asked within GAP_MS of the
// one before and from within MOVED blocks, is not asked on: the rung's
// question is asked once with the chain said.

const CHAIN_N = 5;        // answers in a chain before the next is not asked
const GAP_MS = 5000;      // an answer followed this soon: nothing took time
const MOVED = 3;          // blocks: the same spot
const REVERSAL_MS = 10000;
const KEEP = 12;

const words = s => String(s || '').replaceAll('_', ' ');
const P = v => v && Number.isFinite(v.x) ? { x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, z: Math.round(v.z * 10) / 10 } : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const ago = ms => { const s = Math.max(1, Math.round(ms / 1000)); return s < 90 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.round(s / 60)} minutes`; };
const off = () => process.env.JEV_PLAN_CHAIN === '0';
const plan = q => { try { return require('./intention').GATED.has(q); } catch (_) { return false; } };

// The sides an answer takes: going to a thing or leaving it.
const SIDES = [
  { topic: 'fortress', toward: /^(fortress_leg\/(blazes_\w+|back_to_fortress|go_to_blazes(_about)?|go_to_spawner(_\d+)?|unwalked_\d+|stay_in_fortress|wait_at_spawner)|fortress_visit\/go_in|fortress_approach\/(walk_route|cross_level|tunnel|blocks_then_\w+|pillar_up|dig_through|descend|cover_lava|scoop_lava|span_round))$/,
    away: /^(fortress_approach|fortress_leg|fortress_visit)\/(keep_searching|leave_fortress)$/, towardSays: 'go to this fortress', awaySays: 'leave this fortress' },
  { topic: 'pickaxe', toward: /^(fortress_leg|fortress_approach|nether_gather)\/(fetch_stems|make_pickaxe|portal_trip|wood_in_view)$/,
    away: /^nether_gather\/without$/, towardSays: 'get a pickaxe', awaySays: 'go on without a pickaxe' },
  { topic: 'overworld', toward: /^(fortress_visit|leave_nether)\/go_back$|^(fortress_leg|fortress_approach|nether_food_kit|restock_food)\/return_for_(food|blocks)$/,
    away: /^fortress_visit\/go_in$|^leave_nether\/search_on$/, towardSays: 'go back through the portal', awaySays: 'stay in the Nether and go on' },
  // 25581 chose cast_at_lava (portal_method) and in the same second chose
  // climb (surface_trip), undoing the stand it had just taken to work by the
  // lava (note 714).
  { topic: 'portal_site', toward: /^portal_plan\/(build_new|(?:here|beside|new_site)_(?:pool_\d+|deep|sight)|into_cave|clear_blocker|other_stand|ruin_\d+)$/,
    away: /^surface_trip\/(climb|mine_first)$/, towardSays: 'work here on the portal', awaySays: 'climb to open sky' },
];
function sidesOf(path) {
  const out = [];
  for (const s of SIDES) { if (s.toward.test(path)) out.push({ topic: s.topic, side: 'toward', says: s.towardSays }); else if (s.away.test(path)) out.push({ topic: s.topic, side: 'away', says: s.awaySays }); }
  return out;
}
// The side of `before` that `now` turns back on, or null.
function reverses(now, before) {
  const b = sidesOf(before);
  for (const s of sidesOf(now)) { const o = b.find(x => x.topic === s.topic && x.side !== s.side); if (o) return { topic: s.topic, before: o.says, now: s.says }; }
  return null;
}
const pathOf = e => `${e.q}/${e.choice}`;

// After an answer to a question about the plan.
function note(bot, goal, q, pathKeys, { now = Date.now() } = {}) {
  if (off() || !goal || !plan(q) || !Array.isArray(pathKeys) || !pathKeys.length) return;
  const place = P(bot?.entity?.position);
  const list = (goal.planAnswers || []).filter(e => now - e.at < 10 * 60000);
  list.push({ q, choice: String(pathKeys.at(-1)), at: now, ...(place ? { place } : {}), health: Number.isFinite(bot?.health) ? Math.round(bot.health * 10) / 10 : null, food: Number.isFinite(bot?.food) ? bot.food : null });
  goal.planAnswers = list.slice(-KEEP);
}

// The answers just before now from this spot, none of which took time: the
// tail of the record, each within GAP_MS of the next (and the last within
// GAP_MS of now), all within MOVED of here.
function chainOf(bot, goal, now = Date.now()) {
  const list = goal?.planAnswers || [], here = P(bot?.entity?.position);
  // An escalation by the ledger (a way resting, the question above told) is
  // a handing on with the failure said: the chain begins again after it.
  const cut = Math.max(0, ...(goal?.tried?.escalations || []).map(x => Number(x.at) || 0));
  const out = [];
  let next = now;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (next - e.at > GAP_MS || e.at <= cut) break;
    if (here && e.place && dist(here, e.place) > MOVED) break;
    out.unshift(e); next = e.at;
  }
  return out;
}
const oneSays = e => `${words(e.choice)} (${words(e.q)})`;
function chainSays(chain, now = Date.now()) {
  if (!chain.length) return null;
  const secs = Math.max(1, Math.round((now - chain[0].at) / 1000));
  const turns = [];
  for (let i = 1; i < chain.length; i++) for (let j = i - 1; j >= 0; j--) { const r = reverses(pathOf(chain[i]), pathOf(chain[j])); if (r) { turns.push(`${words(chain[i].choice)} turned back on ${words(chain[j].choice)} (${r.before})`); break; } }
  return `${chain.length} plan answer${chain.length === 1 ? '' : 's'} in the last ${secs} second${secs === 1 ? '' : 's'} from this spot, none of which took any time: ${chain.map(oneSays).join(', ')}${turns.length ? `; ${turns.length} of them turned back on one before: ${turns.join('; ')}` : ''}`;
}

// At the start of a question about the plan: a chain too long is not asked
// on. -> { says } to ask the rung's question with, or null.
function check(bot, goal, q, now = Date.now()) {
  if (off() || !goal || goal.kind !== 'win' || !plan(q)) return null;
  const chain = chainOf(bot, goal, now);
  // Counted by the different answers in it: the same answer given again and
  // again is the ledger's (its tries and rests, tried.js; the quick-return
  // rule, repeats.js), which rest it and say so.
  if (new Set(chain.map(pathOf)).size < CHAIN_N) return null;
  const says = `${chainSays(chain, now)}; ${words(q)} was not asked again`;
  goal.planAnswers = [];
  goal.planChainStopped = { at: now, n: chain.length, says };
  console.log(`[plan chain] ${says}`);
  return { says, chain };
}

// The facts and the option notes for a question about the plan being asked
// now: the chain before it, the last answer's reversal, and each option
// that would turn back on the last answer (or on what holds, asked again).
// -> { recent, reversal, tags: { key: words } }
function facts(bot, goal, q, tree, now = Date.now()) {
  const out = { recent: null, reversal: null, tags: {} };
  if (off() || !goal || !plan(q) || !tree) return out;
  const chain = chainOf(bot, goal, now);
  if (chain.length >= 2) out.recent = chainSays(chain, now);
  const last = chain.at(-1);
  if (last) {
    for (let j = chain.length - 2; j >= 0; j--) {
      if (now - chain[j].at > REVERSAL_MS) break;
      const r = reverses(pathOf(last), pathOf(chain[j]));
      if (r) { out.reversal = `${oneSays(last)}, chosen ${ago(now - last.at)} ago, reverses ${oneSays(chain[j])}, chosen ${ago(now - chain[j].at)} ago from here: ${r.before}`; break; }
    }
  }
  // The options that turn back on the last answer from here, or on the last
  // answer to this same question (its own question asked again, within ten
  // minutes), said with what changed since. 25588 chose go_back at 1.2
  // health and hunger 9, and go_in at the same question three minutes later
  // with both the same (critic-20260930T0034Z item 2).
  const own = (goal.planAnswers || []).filter(e => e.q === q && now - e.at < 10 * 60000).at(-1);
  const against = [...(last && now - last.at <= REVERSAL_MS ? [last] : []), ...(own && own !== last ? [own] : [])];
  for (const key of Object.keys(tree)) {
    for (const e of against) {
      const r = reverses(`${q}/${key}`, pathOf(e));
      if (!r) continue;
      const r1 = v => Math.round(v * 10) / 10;
      const since = [Number.isFinite(e.health) && Number.isFinite(bot?.health) ? `health ${r1(e.health)} then, ${r1(bot.health)} now` : null,
        Number.isFinite(e.food) && Number.isFinite(bot?.food) ? `hunger ${e.food} then, ${bot.food} now` : null].filter(Boolean).join(', ');
      out.tags[key] = ` It turns back on ${oneSays(e)}, chosen ${ago(now - e.at)} ago (${r.before})${since && now - e.at >= 30000 ? `; ${since}` : ''}.`;
      break;
    }
  }
  return out;
}

module.exports = { note, check, facts, chainOf, chainSays, reverses, sidesOf, CHAIN_N, GAP_MS, MOVED, REVERSAL_MS };

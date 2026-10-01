'use strict';
// An answer is a commitment with its end stated (note 764).
//
// Fable's check-in of 14:06Z on 2026-09-30, problem 2: asking was still poll
// driven. Since 13:20Z 56.6% of asks came within 30 s of the same question's
// last, 330 asks a bot-hour; night_mine_target was 93% re-asks, turn_priority
// 892 asks in a few hours. Note 749's loop rule sends a spell up once it has
// gone round; it did not change when a question is asked. Each caller asked
// whenever its loop came round (a target dug, a pass of the step, a minute
// on a clock), and the answer lasted until then.
//
// Here an answer holds until what ends it happens. What ends it is declared
// with the question (define's `commit`) or on the option (a node's `commit`),
// and said on the option Jev chooses from:
//   as        which later option carries the same answer on: by default its
//             key; a policy answer names what it goes on with (the night
//             mine's "ore:iron_ore": any iron ore offered carries it on)
//   until     the named facts whose change ends it, read against the bot as
//             it was when the answer was given:
//               health   the health band falls (fours), or comes back to full
//               hunger   the food band changes (6 and under, under 18, 18+)
//               threats  the mobs that threaten within 16 blocks: a kind not
//                        there then, more of a kind than then, or a kind gone
//                        (none within 20)
//               items    { item: line }: what is carried crosses the line
//               moved    N: the bot is N blocks or more from where it was
//               arrives  N: within N blocks of the answer's target
//               seconds  N: that long since the answer
//               newOption true: an option (by `as`) is offered that was not
//                        then
//               kills    true: a blaze killed near the bot since (the cage's
//                        plan, note 774: held until it kills or fails)
//               throughFailures true: its try failing in the ledger does
//                        not end it (an answer to a failure, held through
//                        more of the same; the caller ends it on another
//                        kind, note 767)
//             and always: the dimension changing, a death, the answer no
//             longer on offer (rested, gone, withheld), its try coming to
//             nothing in the ledger (tried.js), its caller ending it (end()),
//             and MAX_MS.
// While it holds, asking the question again returns the held answer (the
// option that carries it on in the tree just built) without asking Jev. The
// caller that polls gets the answer it was given. When it ends, the next
// asking says how (lastCommitment), and Jev answers afresh.
//
// Replayed over the flight records by scripts/ask-loops.js --commit, with the
// same conditions read from each ask's snapshot (factsFromSnapshot).

const MAX_MS = 10 * 60000;
const THREAT_R = 16, THREAT_GONE_R = 20;
const FOOD_BANDS = [6, 17];
const KEPT_ENDED_MS = 2 * 60000;

const words = s => String(s || '').replaceAll('_', ' ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const secs = ms => ms < 90000 ? plural(Math.max(1, Math.round(ms / 1000)), 'second') : plural(Math.round(ms / 60000), 'minute');
const P = v => v && Number.isFinite(v.x) ? { x: v.x, y: v.y, z: v.z } : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const norm = d => String(d || '').replace(/^minecraft:/, '') || null;
const off = () => process.env.JEV_COMMIT === '0';

// Health in bands of four, full on its own (unchanged.js band).
const healthBand = h => !Number.isFinite(h) ? null : h >= 20 ? 5 : Math.floor(Math.max(0, h) / 4);
const foodBand = f => FOOD_BANDS.filter(b => (Number.isFinite(f) ? f : 20) > b).length;

// The facts the conditions read, from the bot now.
function factsOf(bot, goal, now = Date.now()) {
  const inv = {};
  try { for (const i of bot?.inventory?.items?.() || []) inv[i.name] = (inv[i.name] || 0) + i.count; } catch (_) { /* no inventory */ }
  let mobs = [];
  try { mobs = bot?.entity?.position ? require('../danger').threats(bot, THREAT_GONE_R).map(t => ({ name: t.entity?.name, d: t.distance })) : []; } catch (_) { mobs = []; }
  return { t: now, pos: P(bot?.entity?.position), dimension: norm(bot?.game?.dimension), health: bot?.health ?? null, food: bot?.food ?? null, inv, threats: threatCounts(mobs), deaths: (goal?.survival?.deaths || []).length, kills: Object.values(bot?._kills || {}).reduce((n, k) => n + (k || 0), 0) };
}
// The same facts from a flight record's snapshot (scripts/ask-loops.js).
function factsFromSnapshot(s, t, deaths = 0) {
  return { t, pos: P(s?.position), dimension: norm(s?.dimension), health: s?.health ?? null, food: s?.food ?? null, inv: { ...(s?.inventory || {}) },
    threats: threatCounts((s?.mobs || []).map(m => ({ name: m.name, d: m.d }))), deaths };
}
// Kind -> [count within 16, count within 20].
function threatCounts(mobs) {
  const out = {};
  for (const m of mobs || []) {
    if (!m?.name || !Number.isFinite(m.d) || m.d > THREAT_GONE_R) continue;
    const c = (out[m.name] ||= [0, 0]);
    if (m.d <= THREAT_R) c[0]++;
    c[1]++;
  }
  return out;
}

// What changed in the threats, in words, or null.
function threatsChanged(then, now) {
  for (const [k, [n16]] of Object.entries(now || {})) {
    const was = then?.[k];
    if (n16 && !was?.[0] && !was?.[1]) return `a ${words(k)} came within ${THREAT_R} blocks`;
    if (n16 > (was?.[1] || 0)) return `more ${words(k)}s within ${THREAT_R} blocks (${n16}, from ${was?.[0] || 0})`;
  }
  for (const [k, [n16]] of Object.entries(then || {})) if (n16 && !now?.[k]?.[1]) return `the ${words(k)} about is gone`;
  return null;
}

// The conditions in words, for the option and the facts: a list of parts.
function untilParts(until = {}) {
  const out = [];
  if (until.arrives) out.push('it arrives');
  if (until.items) for (const [item, line] of Object.entries(until.items)) if (Number.isFinite(line)) out.push(`${words(item)} carried reaches ${line}`);
  if (until.health) out.push('health falls a band of four (or is full again)');
  if (until.hunger) out.push('hunger crosses 6 or 18');
  if (until.threats) out.push('the mobs about change (a new kind, more of one, or they are gone)');
  if (until.newOption) out.push(typeof until.newOption === 'string' && /ore/.test(until.newOption) ? 'a kind of ore not offered now is' : 'something new is offered');
  if (until.moved) out.push(`the bot is ${until.moved} blocks from here`);
  if (until.kills) out.push('a blaze is killed');
  // What its caller ends it on (end()), said with the rest (note 767).
  if (Array.isArray(until.also)) out.push(...until.also);
  // An answer to a failure holds through more of the same (its caller ends
  // it on another kind): the portal cast kept at its site (note 767).
  out.push(until.throughFailures ? 'it is no longer on offer' : 'it fails or is no longer on offer');
  out.push(`${secs(Math.min(until.seconds ? until.seconds * 1000 : MAX_MS, MAX_MS))} pass`);
  return out;
}
const untilSays = until => untilParts(until).join(', ');

// Why a commitment has ended, in words, or null while it holds.
// `offered`: the set of `as` values offered now.
function endedBy(c, now, { offered = null, ledger = null } = {}) {
  const u = c.until || {};
  const age = now.t - c.at;
  if (c.endedBy) return c.endedBy;
  if (now.dimension && c.facts.dimension && now.dimension !== c.facts.dimension) return `the bot went to the ${words(now.dimension).replace(/^the /, '')}`;
  if (now.deaths > (c.facts.deaths || 0)) return 'the bot died';
  if (age >= Math.min(u.seconds ? u.seconds * 1000 : MAX_MS, MAX_MS)) return `${secs(age)} passed`;
  if (ledger) return ledger;
  if (offered && !offered.has(c.as)) return 'it is no longer on offer';
  if (u.arrives && c.target && now.pos && dist(now.pos, c.target) <= u.arrives) return 'it arrived';
  if (u.moved && c.facts.pos && now.pos && dist(now.pos, c.facts.pos) >= u.moved) return `the bot is ${Math.round(dist(now.pos, c.facts.pos))} blocks from where it was chosen`;
  if (u.items) for (const [item, line] of Object.entries(u.items)) {
    if (!Number.isFinite(line)) continue;
    const a = (c.facts.inv?.[item] || 0) >= line, b = (now.inv?.[item] || 0) >= line;
    if (a !== b) return `${words(item)} carried ${b ? 'reached' : 'fell under'} ${line} (${now.inv?.[item] || 0})`;
  }
  if (u.health) {
    const a = healthBand(c.facts.health), b = healthBand(now.health);
    if (a != null && b != null && (b < a || (b === 5 && a !== 5))) return `health went from ${Math.round(c.facts.health)} to ${Math.round(now.health)}`;
  }
  if (u.hunger && foodBand(c.facts.food) !== foodBand(now.food)) return `hunger went from ${c.facts.food} to ${now.food}`;
  if (u.kills && (now.kills || 0) > (c.facts.kills || 0)) return `${now.kills - (c.facts.kills || 0) === 1 ? 'a blaze was' : `${now.kills - (c.facts.kills || 0)} were`} killed`;
  if (u.threats) { const w = threatsChanged(c.facts.threats, now.threats); if (w) return w; }
  if (u.newOption && offered) { const only = typeof u.newOption === 'string' ? new RegExp(u.newOption) : null; const fresh = [...offered].find(a => !c.offered?.includes(a) && (!only || only.test(a))); if (fresh) return `${words(fresh.replace(/^[a-z]+:/, ''))} is offered, which was not`; }
  return null;
}

// The line a policy's item is held to (the night mine's ore): what is
// carried plus what the next rung still wants of it, or the worth keeping
// where the rung wants none and less is carried; null where neither.
function needLine(carried, more, cap) {
  if (Number.isFinite(more) && more > 0) return carried + more;
  if (Number.isFinite(cap) && carried < cap) return cap;
  return null;
}
// The commitment an answer makes, from the question's definition and the
// chosen node: null for an answer that holds nothing.
function spec(def, key, node) {
  const own = node?.commit, base = def?.commit;
  if (own === false || (!own && !base)) return null;
  const pick = x => typeof x === 'function' ? x(key, node) : x;
  const b = base ? { as: pick(base.as), until: pick(base.until) } : {};
  const c = own ? { as: pick(own.as), until: pick(own.until) } : {};
  if (base?.only && !base.only.test(key) && !own) return null;
  const until = { ...(b.until || {}), ...(c.until || {}) };
  return { as: c.as || b.as || null, until };
}
// The leaves of a tree, by path ('obtain_food/hunt_12').
function leaves(tree, pre = [], out = []) {
  for (const [k, n] of Object.entries(tree || {})) {
    if (k === 'none_good') continue;
    if (n?.children) leaves(n.children, [...pre, k], out); else out.push({ path: [...pre, k].join('/'), key: k, node: n });
  }
  return out;
}
const leafAt = (tree, path) => { let n = { children: tree }; for (const k of String(path).split('/')) n = n?.children?.[k]; return n || null; };
// Every leaf's `as` -> its path, in a tree.
function offeredAs(def, tree) {
  const out = new Map();
  for (const { path, key, node } of leaves(tree)) {
    const s = spec(def, key, node);
    const as = s?.as || path;
    if (!out.has(as)) out.set(as, path);
  }
  return out;
}

// Before asking: the answer held, or how it ended. ->
//   { held: { path, node, says } } | { ended: says } | null
function before(bot, goal, def, tree, { now = Date.now(), ledgerEntry = undefined } = {}) {
  if (off() || !bot) return null;
  const memo = bot._commits ||= {};
  const c = memo[def.id];
  if (!c) return null;
  if (c.ended) { if (now - c.ended.at > KEPT_ENDED_MS) delete memo[def.id]; return c.ended.said ? null : (c.ended.said = true, { ended: c.ended.says }); }
  const offered = offeredAs(def, tree);
  const entry = ledgerEntry !== undefined ? ledgerEntry : lastEntry(goal, def.id, c.key, c.at);
  const ledger = entry?.outcome === 'blocked' && !c.until?.throughFailures ? `it came to nothing${entry.why ? ` (${entry.why})` : ''}` : null;
  const why = endedBy(c, factsOf(bot, goal, now), { offered: new Set(offered.keys()), ledger });
  if (why) {
    const says = `${words(c.key)} (${words(def.id)}), chosen ${secs(now - c.at)} ago to hold until ${c.untilSays}, ended: ${why}; asked afresh`;
    c.ended = { at: now, says, said: true };
    console.log(`[commit] ${def.id}: ${says}`);
    return { ended: says };
  }
  const path = offered.get(c.as);
  c.held = (c.held || 0) + 1;
  const says = `${words(c.key)} was chosen ${secs(now - c.at)} ago and holds until ${c.untilSays}`;
  return { held: { path: path.split('/'), node: leafAt(tree, path), says, since: c.at, times: c.held } };
}
// The latest ledger entry of this answer since it was given.
function lastEntry(goal, q, key, at) {
  const list = goal?.tried?.entries || [];
  for (let i = list.length - 1; i >= 0; i--) { const e = list[i]; if (e.q === q && e.at >= at) return e.method === key || String(e.method).split('/').at(-1) === key ? e : null; }
  return null;
}
// After Jev's answer: the commitment it makes, kept with the bot.
function after(bot, goal, def, path, node, tree, { target = null, now = Date.now() } = {}) {
  if (off() || !bot || !path?.length) return null;
  const memo = bot._commits ||= {};
  const key = path.at(-1);
  const s = spec(def, key, node);
  if (!s) { delete memo[def.id]; return null; }
  memo[def.id] = { key: path.join('/'), as: s.as || path.join('/'), until: s.until, untilSays: untilSays(s.until), at: now, facts: factsOf(bot, goal, now), target: P(node?.target || target), offered: [...offeredAs(def, tree).keys()] };
  return memo[def.id];
}
// The caller ends it: the answer failed, or is done.
function end(bot, id, why) {
  const c = bot?._commits?.[id];
  if (c && !c.ended) c.endedBy = String(why || 'ended by its caller').slice(0, 200);
}
const drop = (bot, id) => { if (bot?._commits) delete bot._commits[id]; };
const holding = (bot, id) => { const c = bot?._commits?.[id]; return c && !c.ended && !c.endedBy ? c : null; };

// What ends each answer that would hold, said to Jev beside the options,
// in one line: what ends them all, and what ends each of its own.
function holdsSays(def, tree) {
  const each = [];
  for (const { path, key, node } of leaves(tree)) {
    const s = spec(def, key, node);
    if (s) each.push({ path, parts: untilParts(s.until) });
  }
  if (!each.length) return null;
  const common = each[0].parts.filter(p => each.every(e => e.parts.includes(p)));
  const own = each.map(e => ({ path: e.path, parts: e.parts.filter(p => !common.includes(p)) })).filter(e => e.parts.length);
  return `${each.map(e => words(e.path)).join(', ')}: chosen, each holds (the question not asked again meanwhile) until ${common.join(', ')}${own.length ? `; and ${own.map(e => `${words(e.path)} until ${e.parts.join(', ')}`).join('; ')}` : ''}.`;
}

// Over recorded asks of one question, in order: which would have been held.
// Each ask { t, id, choice, key, node, tree, facts, ledgerBlocked }.
// -> { sent: [ask], held: [ask], ends: { why: n } }
function replay(def, asks) {
  const sent = [], held = [], ends = {};
  let c = null;
  for (const a of asks) {
    if (c) {
      const offered = offeredAs(def, a.tree);
      c.failed ||= a.failedSince;
      const why = endedBy(c, a.facts, { offered: new Set(offered.keys()), ledger: c.failed ? 'it failed' : null });
      if (!why) { held.push(a); continue; }
      const k = why.replace(/-?\d+(\.\d+)?/g, 'N').replace(/^(a|more|the) .*(came within|blocks \(|about is gone).*$/, 'the mobs about changed').replace(/^.* (reached|fell under) N.*$/, 'carried crossed its line').replace(/^.* is offered, which was not$/, 'something new offered');
      ends[k] = (ends[k] || 0) + 1;
      c = null;
    }
    sent.push(a);
    const path = a.choice;
    const node = path ? leafAt(a.tree, path) : null;
    const s = node ? spec(def, path.split('/').at(-1), node) : null;
    if (s) c = { key: path, as: s.as || path, until: s.until, at: a.t, facts: a.facts, target: P(node?.target), offered: [...offeredAs(def, a.tree).keys()] };
  }
  return { sent, held, ends };
}

module.exports = { MAX_MS, THREAT_R, factsOf, factsFromSnapshot, threatCounts, threatsChanged, healthBand, foodBand, untilSays, untilParts, endedBy, needLine, spec, offeredAs, before, after, end, drop, holding, holdsSays, leaves, leafAt, replay };

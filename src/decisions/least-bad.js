'use strict';
// "None of these is good" changes what is asked next (note 693).
//
// Jev's none_good says the move a player would make is not on the list. The
// code took the best listed by Jev's own weights, and the next asking offered
// the same list again: a re-ask by another name. Of 35,085 questions in the
// flight records of 2026-09-29 from 12:00Z to 21:40Z, 3,659 (10%) had
// none_good on top; at the next asking of the same question 1,913 of 3,370
// (57%) had it on top again, 2,467 came within thirty seconds, and 600 took
// the same fallback. 25581 at 21:36Z: hunt_target none good 0.36 on top, and
// defer (0.32) taken with a blaze five blocks off at full health, sword and
// shield carried.
//
// Here the answer taken as the least bad is remembered with the options it
// was taken from, where, and what the bot had then (repeats.js mark). At the
// next asking of the same question:
//   - it is said, in the facts (leastBadLast) and on the option itself:
//     "Jev said none of these was good; this was taken as the least bad",
//     with what came of it;
//   - asked again with the same options from about here with nothing come of
//     the least bad (the ledger's own judgment, tried.js; health lost is a
//     change), the same set is not asked again: the least bad is held from
//     here and the question above (define's `parent`) is asked with the none
//     good said (escalate), as a way resting everywhere is;
//   - and a wait or a keep-on taken as the least bad PASSIVE_RUN times running
//     with nothing changed is not taken so again: the best other listed is,
//     and that is said.
// The stance (encounter_stance) keeps its own rules (stance-scene.js, notes
// 659 and 691).

const { mark, cameOf } = require('./repeats');

const KEPT_MS = 10 * 60000;   // remembered this long
const NEAR = 4;               // "from about here"
const HURT = 4;               // health lost since: a change (intention.js HURT)
const PASSIVE_RUN = 2;        // a passive least bad, times running, before another is taken
const PASSIVE = /^(defer|wait\w*|\w+_wait|keep_on|carry_on|go_on|keep_at_it|keep_working|continue_request|search_on|until_rest_ends|stay|stay_here|rest_to_heal|hold\w*)$/;
const OWN_RULES = new Set(['encounter_stance']);

const words = s => String(s || '').replaceAll('_', ' ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ago = ms => { const s = Math.max(1, Math.round(ms / 1000)); return s < 90 ? plural(s, 'second') : plural(Math.round(s / 60), 'minute'); };
const leafKeys = tree => {
  const out = [];
  const visit = (children, pre) => { for (const [k, n] of Object.entries(children || {})) { if (k === 'none_good') continue; if (n?.children) visit(n.children, [...pre, k]); else out.push([...pre, k].join('/')); } };
  visit(tree, []);
  return out.sort();
};
const isPassive = key => PASSIVE.test(String(key || '').split('/').at(-1));
const applies = id => !OWN_RULES.has(id);

// What came of the least bad since it was taken: words, or null for nothing.
// The ledger's settled entry where there is one (the rung's measure, a wait's
// world, a walk's nearest approach); else the repeat rule's own measure.
function cameSince(bot, goal, id, m, now) {
  if (Number.isFinite(m.health) && Number.isFinite(bot?.health) && m.health - bot.health >= HURT) return `health ${Math.round(m.health)} to ${Math.round(bot.health)}`;
  const e = (goal?.tried?.entries || []).filter(x => x.q === id && x.method === m.key && x.at >= m.at - 1000 && x.outcome !== 'pending').at(-1);
  if (e) {
    if (e.outcome === 'progressed') return e.gained || 'something came of it';
    if (e.outcome === 'waited') return e.gained || 'its world changed';
    if (e.outcome === 'cut') return `cut short: ${e.why || 'the survival layer took the turn'}`;
    if (e.outcome === 'done' || e.outcome === 'impossible') return e.outcome === 'done' ? 'done' : `impossible: ${e.why || ''}`;
    return null;
  }
  const here = bot?.entity?.position;
  if (m.place && here && Math.hypot(here.x - m.place.x, here.y - m.place.y, here.z - m.place.z) > NEAR) return `moved ${Math.round(Math.hypot(here.x - m.place.x, here.y - m.place.y, here.z - m.place.z))} blocks`;
  return m.mark ? cameOf(m.mark, mark(bot, goal, id), m.at) : null;
}
const nothingSays = (bot, goal, id, m) => {
  const e = (goal?.tried?.entries || []).filter(x => x.q === id && x.method === m.key && x.at >= m.at - 1000 && x.outcome === 'blocked').at(-1);
  return e?.why ? `nothing came of it: ${String(e.why).replace(/\.$/, '')}` : 'nothing came of it (no new ground, nothing gained, no block dug or placed)';
};

// Before asking: the least bad taken at this question's last asking, if it
// was one. -> null or { key, says, optionSays, unchanged, runs, passive }
function before(bot, goal, id, tree, { now = Date.now() } = {}) {
  if (!bot || !applies(id)) return null;
  const m = bot._leastBad?.[id];
  if (!m) return null;
  if (now - m.at > KEPT_MS) { delete bot._leastBad[id]; return null; }
  const came = cameSince(bot, goal, id, m, now);
  const here = bot.entity?.position;
  const near = !m.place || !here || Math.hypot(here.x - m.place.x, here.y - m.place.y, here.z - m.place.z) <= NEAR;
  const sameSet = leafKeys(tree).join(',') === m.set.join(',');
  const unchanged = !came && near && sameSet;
  const times = m.runs > 1 ? `, ${plural(m.runs, 'time')} running from here` : '';
  const since = came ? `since then: ${came}` : nothingSays(bot, goal, id, m);
  const says = `${ago(now - m.at)} ago Jev said none of these options was good (none good ${m.p}); ${words(m.key)} was taken as the least bad${times}, and ${since}${sameSet ? '' : '. The options have changed since'}`;
  const optionSays = `Taken as the least bad ${ago(now - m.at)} ago${times}: Jev said none of these was good, and ${came ? `since then: ${came}` : 'nothing came of it'}.`;
  return { key: m.key, says, optionSays, unchanged, sameSet, runs: m.runs, passive: isPassive(m.key), came };
}

// The option taken as the least bad, from Jev's weights, and why. A passive
// one taken so PASSIVE_RUN times running with nothing changed is passed over
// for the best other (said); with no other, it is taken and that is said.
// `pick(key)` walks the key's branch: -> path array
function choose(id, keys, weights, last, pick) {
  const sorted = keys.slice().sort((a, b) => (weights[b] || 0) - (weights[a] || 0));
  let best = sorted[0], path = pick(best), passedOver = null;
  const lastKey = last?.unchanged ? last.key : null;
  const run = path.join('/') === lastKey ? last.runs : 0;
  if (applies(id) && isPassive(path.join('/')) && run >= PASSIVE_RUN) {
    const other = sorted.map(k => [k, pick(k)]).find(([, p]) => !isPassive(p.join('/')));
    if (other) {
      passedOver = `${words(path.join('/'))} had been taken as the least bad ${plural(run, 'time')} running with nothing changed (a wait or keep-on is taken so at most ${plural(PASSIVE_RUN, 'time')} running); ${words(other[1].join('/'))}, the best other listed, was taken`;
      best = other[0]; path = other[1];
    }
  }
  return { best, path, passedOver };
}

// After the answer: remembered when it was none good, forgotten when Jev
// chose a listed option.
function after(bot, goal, id, tree, decision, last, { now = Date.now() } = {}) {
  if (!bot || !applies(id)) return;
  const memo = bot._leastBad ||= {};
  if (!decision?.noneGood || !decision.path?.length) { delete memo[id]; return; }
  const key = decision.path.join('/');
  const runs = last?.unchanged && last.key === key ? last.runs + 1 : 1;
  const weights = decision.judgments?.[0]?.probabilities || {};
  const p = Math.round((weights.none_good || 0) * 100) / 100;
  const here = bot.entity?.position;
  memo[id] = { key, at: now, runs, p, set: leafKeys(tree), place: here ? { x: here.x, y: here.y, z: here.z } : null, health: Number.isFinite(bot.health) ? bot.health : null, mark: mark(bot, goal, id) };
}

// The option at `key` ('a/b') with its words added.
function sayOn(tree, key, said) {
  const parts = String(key).split('/');
  const step = (children, i) => {
    const k = parts[i], n = children?.[k];
    if (!n) return children;
    const node = i === parts.length - 1
      ? { ...n, description: typeof n.description === 'string' ? `${n.description} ${said}` : { ...(n.description || {}), leastBad: said } }
      : n.children ? { ...n, children: step(n.children, i + 1) } : n;
    return { ...children, [k]: node };
  };
  return step(tree, 0);
}

module.exports = { before, after, choose, sayOn, leafKeys, isPassive, applies, PASSIVE_RUN, KEPT_MS, NEAR, HURT };

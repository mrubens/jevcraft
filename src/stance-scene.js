'use strict';
// A stance answer holds until a fact it was chosen on changes (note 659).
//
// 25590 (mid-242-cd, 2026-09-29 03:57 to 04:12Z) stood on a ledge at y 35 over
// the lava, three health, hunger 17 and nothing to eat, no blocks, a magma cube
// hopping two to four blocks below it out of the sword's reach and a crossbow
// piglin eight off: encounter_stance was asked 189 times in fifteen and a half
// minutes, a median half second apart, 114 of them "none of these is good".
// Nothing about the scene changed. Each answer ended at once (the guard with no
// biter that could come, the fight with nothing in reach, the step off the
// ledge with no route) or held fifteen seconds and was asked again because the
// cube had hopped into or out of sight. The idle rule (note 596) keys on each
// mob within a block of where it stood, and a hopping cube is never there
// twice; the none-good rule (note 599) keys on the whole state's fingerprint,
// which a cube's split or a tenth of a block changed each time.
//
// The scene here is what a stance's outcome turns on, each said in words:
//   - the health in whole hearts (the game's own display), and the hunger;
//   - each mob by kind and where it stands to the bot: within the sword's
//     reach (combat.canStrike), within 8 blocks, within 16, farther, or
//     unable to get to the bot at all; and in sight or not (a mob that loses
//     sight of the bot gives it up; a shooter shoots only with a line);
//   - a hit taken, the blocks carried, the shield in the off hand, the block
//     the bot stands on, and the blaze rods carried.
// While that is unchanged:
//   - an answer that came to nothing in it (failed, or a stance whose point
//     is to strike that struck nothing, with nothing else done) is left out
//     while two or more other ways stay on offer, said in notOfferedNow, as
//     the idle rule does;
//   - an answer that held (a wait held its time, a fight that struck) is
//     taken again without asking, said to the next question; asked again
//     once the scene changes, or at holds.js's cap (five minutes since the
//     last asking), when the rung's question is due too;
//   - asked again, the question says the scene unchanged, since when, and
//     what each answer in it came to (sameSceneSoFar), and a none-good
//     answer is counted by this scene: twice in it and the question is
//     spent here and escalated to its parent (decisions/index.js).
const { HOLD_CAP_MS } = require('./holds');

const NEAR = 8, ABOUT = 16;
// Answers that are one act or a leave of the mobs, not a stance to keep:
// eaten, drunk, run, or the work gone back to (holds.js does not hold these
// on either, survival.js stanceStep).
const ONCE = new Set(['eat', 'eat_golden_apple', 'drink_fire_resistance', 'retreat', 'leave_reach', 'come_down', 'keep_working']);
const name = s => String(s || '').replaceAll('_', ' ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const secs = ms => { const s = Math.max(1, Math.round(ms / 1000)); return s < 90 ? plural(s, 'second') : plural(Math.round(s / 60), 'minute'); };
const BAND_SAYS = { reach: 'within the sword\'s reach', near: `within ${NEAR} blocks and out of the sword's reach`, about: `${NEAR} to ${ABOUT} blocks off`, far: `more than ${ABOUT} blocks off`, apart: 'unable to get to the bot' };

// The scene now. `danger` in danger.js's threats shape; `apart` the ids that
// cannot get to the bot; `strikes(entity)` the combat rule (a swing reaches
// it from here); `blocks` the building blocks carried.
function sceneOf(bot, danger = [], { apart = new Set(), strikes = () => false, blocks = 0 } = {}) {
  const p = bot?.entity?.position;
  const health = bot?.health ?? 20;
  const mobs = (danger || []).filter(t => t?.entity).map(t => {
    let reach = false; try { reach = !!strikes(t.entity); } catch (_) { reach = false; }
    const band = apart.has?.(t.entity.id) ? 'apart' : reach ? 'reach' : t.distance <= NEAR ? 'near' : t.distance <= ABOUT ? 'about' : 'far';
    return { name: t.entity.name, band, sight: !!t.visible };
  }).sort((a, b) => `${a.name}${a.band}${a.sight}`.localeCompare(`${b.name}${b.band}${b.sight}`));
  let rods = 0; try { rods = (bot.inventory?.items?.() || []).filter(i => i.name === 'blaze_rod').reduce((n, i) => n + (i.count || 0), 0); } catch (_) { rods = 0; }
  const facts = { hearts: Math.ceil(health / 2), health: Math.round(health * 10) / 10, food: bot?.food ?? 20, mobs, hurtAt: bot?._recentHurtAt || 0, blocks,
    shield: bot?.inventory?.slots?.[45]?.name === 'shield', feet: p ? `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}` : null, rods };
  const { health: _h, ...keyed } = facts;
  return { key: JSON.stringify(keyed), facts };
}

const mobsSay = mobs => {
  if (!mobs.length) return 'no mob about';
  const counts = new Map();
  for (const m of mobs) { const k = `${name(m.name)}|${BAND_SAYS[m.band]}${m.sight ? ', in sight' : ', out of sight'}`; counts.set(k, (counts.get(k) || 0) + 1); }
  return [...counts].map(([k, n]) => { const [who, where] = k.split('|'); return `${n === 1 ? `the ${who}` : `${n} ${who}s`} ${where}`; }).join(', ');
};
const factsSay = f => `health ${f.health} (${plural(f.hearts, 'heart')}), hunger ${f.food}, ${mobsSay(f.mobs)}, ${plural(f.blocks, 'block')} carried, ${f.shield ? 'the shield in the off hand' : 'no shield in the off hand'}, ${f.rods ? `${plural(f.rods, 'blaze rod')} carried` : 'no blaze rod'}`;
// What differs between two scenes, in words.
function changed(a, b) {
  const out = [];
  if (a.hearts !== b.hearts) out.push(`health from ${a.health} to ${b.health}`);
  if (a.food !== b.food) out.push(`hunger from ${a.food} to ${b.food}`);
  if (a.hurtAt !== b.hurtAt) out.push('a hit was taken');
  if (JSON.stringify(a.mobs) !== JSON.stringify(b.mobs)) out.push(`the mobs, from ${mobsSay(a.mobs)} to ${mobsSay(b.mobs)}`);
  if (a.blocks !== b.blocks) out.push(`the blocks carried from ${a.blocks} to ${b.blocks}`);
  if (a.shield !== b.shield) out.push(b.shield ? 'the shield taken to the off hand' : 'the shield out of the off hand');
  if (a.feet !== b.feet) out.push('the bot on another block');
  if (a.rods !== b.rods) out.push(`the blaze rods carried from ${a.rods} to ${b.rods}`);
  return out;
}

// The book of the scene now, kept on the survival state: begun again when the
// scene changes, with what changed and how the last one went.
// A scene come back to within holds.js's cap is the same scene: its book is
// taken up again. On the ledge the cube dropped out of the mobs about for a
// moment and came back, and each return was a new scene with nothing learned.
const KEPT = 8;
function observe(state, scene, now = Date.now()) {
  const was = state.stanceScene;
  if (was && was.key === scene.key) { was.facts = scene.facts; return was; }
  const recent = (state.stanceScenesRecent || []).filter(b => b.key !== was?.key && now - (b.answers.at(-1)?.at ?? b.since) < HOLD_CAP_MS);
  if (was?.answers?.length) recent.push(was);
  const back = recent.find(b => b.key === scene.key);
  state.stanceScenesRecent = recent.filter(b => b !== back).slice(-KEPT);
  if (back) { back.facts = scene.facts; state.stanceScene = back; return back; }
  // A scene passed through with no answer keeps the one before it.
  const before = was?.answers?.length ? { since: was.since, until: now, answers: tally(was), change: changed(was.facts, scene.facts) } : was?.before ? { ...was.before, change: changed(was.facts, scene.facts) } : null;
  state.stanceScene = { key: scene.key, facts: scene.facts, since: now, answers: [], ...(before ? { before } : {}) };
  return state.stanceScene;
}
// An answer given in the scene (asked, or held without asking).
function answered(state, { choice, asked = true, noneGood = false, striking = false, start = null, now = Date.now() }) {
  const book = state.stanceScene;
  if (!book || !choice) return;
  book.answers.push({ choice, at: now, asked, ...(noneGood ? { noneGood: true } : {}), striking, start, acted: false, failed: false });
  if (book.answers.length > 60) book.answers.splice(0, book.answers.length - 60);
}
// Its run ended: whether it acted, failed, and why.
function ran(state, { choice, done, acted, why = null, now = Date.now() }) {
  const a = state.stanceScene?.answers?.at(-1);
  if (!a || a.choice !== choice) return;
  a.acted ||= !!acted; a.failed ||= !done; a.endedAt = now;
  if (why) a.why = String(why).slice(0, 200);
}
const cameToNothing = a => !a.acted && (a.failed || a.striking);
// The answers that came to nothing in this scene, each choice's latest.
function nothingHere(book) {
  const out = new Map();
  for (const a of book?.answers || []) if (cameToNothing(a)) out.set(a.choice, { choice: a.choice, times: (out.get(a.choice)?.times || 0) + 1, at: a.at, why: a.why || null });
    else out.delete(a.choice);
  return [...out.values()];
}
// The answer held without asking, or null: the last one, if it held (not come
// to nothing), is on offer, is a stance to keep, and the last asking is within
// holds.js's cap.
function holdFor(book, offered, now = Date.now()) {
  const last = book?.answers?.at(-1);
  if (!last || last.failed || cameToNothing(last) || ONCE.has(last.choice) || !offered.includes(last.choice)) return null;
  const asked = book.answers.filter(a => a.asked).at(-1);
  if (!asked || now - asked.at >= HOLD_CAP_MS) return null;
  return { choice: last.choice, askedAt: asked.at };
}
// Whether the hold's cap has come with the scene unchanged: then the question
// is asked, and the rung's question is due.
function capped(book, now = Date.now()) {
  const last = book?.answers?.at(-1), asked = book?.answers?.filter(a => a.asked).at(-1);
  return !!last && !last.failed && !cameToNothing(last) && !ONCE.has(last.choice) && !!asked && now - asked.at >= HOLD_CAP_MS;
}
function tally(book) {
  const by = new Map();
  for (const a of book.answers) {
    const t = by.get(a.choice) || { choice: a.choice, times: 0, asked: 0, nothing: 0, held: 0, noneGood: 0, why: null };
    t.times++; if (a.asked) t.asked++; if (a.noneGood) t.noneGood++;
    if (cameToNothing(a)) { t.nothing++; if (a.why) t.why = a.why; } else t.held++;
    by.set(a.choice, t);
  }
  return [...by.values()];
}
const tallySays = list => list.map(t => `${name(t.choice)} ${plural(t.times, 'time')}${t.asked !== t.times ? ` (${t.times - t.asked} of them held without asking)` : ''}${t.nothing ? `, ${t.nothing === t.times ? (t.times === 1 ? 'it' : 'each') : t.nothing} came to nothing${t.why ? ` (the last: ${t.why.replace(/\.$/, '')})` : ''}` : ''}${t.held && t.nothing ? `, ${t.held} held` : t.held ? ', held' : ''}${t.noneGood ? `, ${t.noneGood} of them taken as the likeliest listed after "none of these is good"` : ''}`).join('; ');
// Said to the question: the scene unchanged and what its answers came to, or
// what changed since the last scene's answers. -> string or null
function says(book, now = Date.now()) {
  if (!book) return null;
  const parts = [];
  if (book.answers.length) {
    const list = tally(book), asks = book.answers.filter(a => a.asked).length, ng = book.answers.filter(a => a.noneGood).length;
    parts.push(`Nothing a stance turns on has changed here for ${secs(now - book.since)}: ${factsSay(book.facts)}, no hit taken and the bot on the same block. In that time the stance was answered ${plural(book.answers.length, 'time')} (${plural(asks, 'asking')}): ${tallySays(list)}.${ng ? ` "None of these is good" was the answer ${plural(ng, 'time')} in this scene; the likeliest listed was carried out each time, and a second in the same scene sends it to the question above.` : ''} An answer that holds is kept without asking while none of this changes; one that came to nothing is left out while two or more other ways stay on offer. What changes the scene: a heart of health, the hunger, a mob coming into or out of the sword's reach or across ${NEAR} or ${ABOUT} blocks, into or out of sight, or unable to get to the bot, a hit taken, a block placed or dug, the shield, a step to another block, a rod.`);
  }
  if (book.before) parts.push(`${parts.length ? 'Before this scene' : 'The scene has just changed'} (${book.before.change.join('; ') || 'a new encounter'}): over the ${secs(book.before.until - book.before.since)} before, ${tallySays(book.before.answers)}.`);
  return parts.length ? parts.join(' ') : null;
}

// A quiet scene (note 700): no mob within NEAR, no hit in the last ten
// seconds, and every way on offer priced under a point of damage in the next
// fifteen seconds. 25581 (mid-242-dh-fortress-24, 23:03:59 to 23:05:12Z)
// changed stance about every second against crossbow piglins 11 to 16
// blocks off, nearly every way "about 0 damage": each stance ran and ended
// (a nook with no route, a fight with nothing in reach), the work went on,
// and the push rule took the turn back for the same piglins at once. The
// scene hold never held, for the piglins crossing sight and sixteen blocks
// and the blocks carried going 16, 17, 18, 19 changed its key each time, and
// most answers came to nothing. In a quiet scene the answer given holds for
// the fifteen seconds it was priced over: the same mobs do not take the turn
// again meanwhile unless one comes within NEAR, a hit lands, or another comes.
// -> { ids, says } or null
const QUIET_MS = 15000, QUIET_DAMAGE = 1, QUIET_HURT_MS = 10000;
function quietOf(bot, danger = [], options = {}, now = Date.now()) {
  const mobs = (danger || []).filter(t => t?.entity);
  if (!mobs.length || mobs.some(t => t.distance <= NEAR)) return null;
  if (bot?._recentHurtAt > now - QUIET_HURT_MS) return null;
  const priced = Object.values(options || {}).map(o => o?.expects?.damage).filter(Number.isFinite);
  if (priced.length < 2 || priced.some(d => d >= QUIET_DAMAGE)) return null;
  return { ids: mobs.map(t => t.entity.id), until: now + QUIET_MS,
    says: `Every way here is priced under ${QUIET_DAMAGE} damage in the next fifteen seconds and no mob is within ${NEAR} blocks: whatever is chosen holds those fifteen seconds, and these mobs do not take the turn from the work again meanwhile unless one comes within ${NEAR}, a hit lands, or another comes.` };
}

// Where the blaze fight has been, in this life: the place (the first stance
// with a blaze about, within 24 blocks of it the same place), since when, the
// rods and health gained and lost there, and each stance taken there with the
// rods and the health that came while it was the answer. Said to the question
// with blazes about (hereSoFar).
const PLACE = 24;
function exposure(state, bot, { blazes = false, now = Date.now() } = {}) {
  const p = bot?.entity?.position;
  if (!p) return null;
  let rods = 0; try { rods = (bot.inventory?.items?.() || []).filter(i => i.name === 'blaze_rod').reduce((n, i) => n + (i.count || 0), 0); } catch (_) { rods = 0; }
  const dim = String(bot.game?.dimension || '');
  let x = state.blazePlace;
  // Another place, another dimension, or another life (the rods carried here
  // gone): a new record.
  const away = x && (x.dimension !== dim || Math.hypot(p.x - x.at.x, p.y - x.at.y, p.z - x.at.z) > PLACE || (x.rods > 0 && rods === 0));
  if (!x || away) {
    if (!blazes) { if (away) delete state.blazePlace; return null; }
    x = state.blazePlace = { at: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) }, dimension: dim, since: now, rods, health: bot.health ?? 20, lost: 0, gained: 0, answers: {}, last: null };
  }
  // What came while the last answer stood.
  const dr = rods - x.rods, dh = (bot.health ?? 20) - x.health;
  if (x.last) { const a = x.answers[x.last] ||= { times: 0, rods: 0, lost: 0 }; if (dr > 0) a.rods += dr; if (dh < 0) a.lost += -dh; }
  if (dr > 0) x.gained += dr;
  if (dh < 0) x.lost += -dh;
  x.rods = rods; x.health = bot.health ?? 20;
  return x;
}
function exposureAnswered(state, choice) {
  const x = state.blazePlace;
  if (!x || !choice) return;
  (x.answers[choice] ||= { times: 0, rods: 0, lost: 0 }).times++;
  x.last = choice;
}
const r1 = v => Math.round(v * 10) / 10;
function exposureSays(x, now = Date.now()) {
  if (!x) return null;
  const list = Object.entries(x.answers).sort((a, b) => b[1].times - a[1].times).map(([k, a]) => `${name(k)} ${plural(a.times, 'time')}, ${a.rods ? `${plural(a.rods, 'rod')} while it stood` : 'no rod'}, ${r1(a.lost)} health lost while it stood`);
  return `At this place (the blaze fight first met at ${x.at.x}, ${x.at.y}, ${x.at.z}, within ${PLACE} blocks of it) for ${secs(now - x.since)} in this life: ${plural(x.gained, 'blaze rod')} gained here (${plural(x.rods, 'rod')} carried now), ${r1(x.lost)} health lost here in all.${list.length ? ` The stances taken here: ${list.join('; ')}.` : ''}`;
}

module.exports = { quietOf, QUIET_MS, sceneOf, observe, answered, ran, nothingHere, holdFor, capped, says, changed, tally, cameToNothing, exposure, exposureAnswered, exposureSays, ONCE, NEAR, ABOUT, PLACE };

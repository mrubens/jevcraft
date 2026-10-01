'use strict';
// Food or the work: one answer, held (note 784).
//
// The same choice was asked in three places, each on its own clock: the
// survival claim for food beside the work at turn_priority (re-asked every
// minute the scene moved), survival_priority's obtain_food beside
// continue_request (asked again as soon as turn_priority had given survival
// the turn for that very food), and the source within it (search_food held
// 45 seconds, a herd walk two minutes, a hunt its kind three; carrying on
// five minutes, by its own rule). From 2026-09-30 12:00Z to 2026-10-01
// 04:57Z (scripts/food-asks.js, 584 records, 209.5 bot-hours) there were
// 5,455 food questions, 3,643 food answers, and 1,459 errands of which 510
// gained no food in 562 minutes; 269 survival_priority food answers came
// straight after turn_priority had answered the same food over the work, and
// 707 of turn_priority's 1,759 food-claim askings were "a minute passed" or
// "no ruling" with nothing about the food changed.
//
// Here the answer to food or the work is one record, held with its end
// stated, read by every place that asked it:
//   food   (a way to food chosen: survival_priority's obtain_food, the
//          turn given to the survival claim for food, pocket_next's
//          go_for_food) holds until food is eaten or carried (hunger up, or
//          more safe food carried than when chosen), hunger falls under a
//          line it was above (18, where health comes back; 6), health falls
//          a band of four, the way chosen fails (its ledger entry blocked:
//          an error, no route, note 765's run that changed nothing), the
//          dimension changes, a death, or its priced time passes (twice the
//          minutes to the food chosen, two to ten).
//          While it holds: the claim says it and the turn's ruling is
//          renewed past "a minute passed"; survival_priority does not offer
//          carrying on and runs the way chosen unasked while it is on offer.
//   work   (continue_request, or the work given the turn over the claim for
//          food) holds until hunger falls two from when it was chosen or
//          under 18 or to 6, health falls four, the night needs a shelter,
//          the dimension changes, a death, or the minutes the record's drain
//          takes hunger two lower (two to ten). While it holds no food is
//          claimed or asked.
// The question that begins one is priced from the record: the minutes to
// each way to food with what such ways got in the record where the bot is,
// the ways that failed here said as facts, the hunger drain until the next
// line, and the work set aside.

const MIN_MS = 2 * 60000, MAX_MS = 10 * 60000;
const HEALS_AT = 18, SPRINT_AT = 6;
const HURT = 4;
const FAILED_MS = 30 * 60000, FAILED_NEAR = 32;

// Hunger lost a played hour, from the same records (food-asks.js
// hungerDrainAnHour): 24.7 in all; 25.4 at y 56 or above in the Overworld,
// 23.7 under it, 26.4 in the Nether.
const DRAIN = Object.freeze({ all: 24.7, surface: 25.4, under: 23.7, nether: 26.4 });
const RECORD_WINDOW = '2026-09-30 12:00Z to 2026-10-01 04:57Z';
// Each kind of way to food in the record: answers, those that had food eaten
// or carried within ten minutes, deaths within them, and the median minutes
// to the food (food-asks.js sourceRecord). Places: 'under' is the Overworld
// under y 56 (most of it under rock), 'surface' at y 56 or above.
const SOURCE_RECORD = Object.freeze({
  hunt: { all: [659, 633, 0, 0.1], surface: [659, 633, 0, 0.1] },
  herd_walk: { all: [1028, 699, 44, 1.2], under: [528, 283, 23, 2.8], surface: [500, 416, 21, 0.6] },
  search: { all: [304, 180, 21, 1.7], under: [172, 76, 16, 2.6], surface: [132, 104, 5, 1.2] },
  home: { all: [53, 37, 0, 0.7], under: [18, 3, 0, 0.7], surface: [35, 34, 0, 1.1] },
  village: { all: [3, 1, 0, 0.4] },
  cook: { all: [228, 209, 0, 0.9], nether: [19, 11, 0, 1.2], under: [79, 77, 0, 0.9], surface: [130, 121, 0, 0.8] },
  meal: { all: [30, 30, 0, 0] },
  portal: { all: [56, 13, 4, 1.7], nether: [56, 13, 4, 1.7] },
  hoglin: { all: [38, 7, 5, 0.9], nether: [38, 7, 5, 0.9] },
  restock: { all: [58, 11, 7, 0.8], nether: [58, 11, 7, 0.8] },
});

const words = s => String(s || '').replaceAll('_', ' ');
const plural = (n, w, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return plural(m, 'minute'); };
const ago = ms => ms < 90000 ? plural(Math.max(1, Math.round(ms / 1000)), 'second') : mins(ms);
const P = v => v && Number.isFinite(v.x) ? { x: v.x, y: v.y, z: v.z } : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dimOf = bot => String(bot?.game?.dimension || 'overworld').replace(/^minecraft:/, '');
const clamp = ms => Math.max(MIN_MS, Math.min(MAX_MS, ms));
const healthBand = h => !Number.isFinite(h) ? null : h >= 20 ? 5 : Math.floor(Math.max(0, h) / 4);

// Where the bot is, as the record's places are kept.
function placeOf(bot) {
  const d = dimOf(bot);
  if (/nether/.test(d)) return 'nether';
  if (/end/.test(d)) return 'end';
  const y = bot?.entity?.position?.y;
  return Number.isFinite(y) && y < 56 ? 'under' : 'surface';
}
const PLACE_WORDS = { under: 'begun in the Overworld under y 56', surface: 'begun in the Overworld at y 56 or above', nether: 'begun in the Nether', all: 'all of them' };

// The kind of way to food a key is (the record's kinds).
function sourceKind(key) {
  const k = String(key || '').split('/').at(-1);
  if (/^hunt_\d+$/.test(k)) return 'hunt';
  if (/^seen_food_\d+$/.test(k)) return 'herd_walk';
  if (k === 'search_food') return 'search';
  if (k === 'go_home_for_food') return 'home';
  if (k === 'village_food') return 'village';
  if (/^cook_/.test(k)) return 'cook';
  if (k === 'eat_carried') return 'meal';
  if (k === 'return_for_food') return 'portal';
  if (/^hoglin_/.test(k)) return 'hoglin';
  if (/^(restock_food|get_food_here|raid_bastion|mushroom_stew)$/.test(k)) return 'restock';
  return null;
}
const FOOD_WAY = /^(obtain_food|go_for_food|eat_carried|restock_food|return_for_food|hoglin_\w+|cook_\w+|seen_food_\d+|search_food|go_home_for_food|village_food|get_food_here|raid_bastion|mushroom_stew|hunt_\d+)$/;

// What such ways came to in the record, where the bot is (else all).
function recordSays(kind, place) {
  const r = SOURCE_RECORD[kind];
  if (!r) return '';
  const at = r[place] ? place : 'all', [n, food, died, median] = r[at];
  return `in the record (${RECORD_WINDOW}) such ways had food eaten or carried within ten minutes ${food} of ${n} times, ${PLACE_WORDS[at]}${died ? `, ${died} ending in a death first` : ''}${food ? `, the food about ${median < 1 ? 'under a minute' : mins(median * 60000)} after the choice (the median)` : ''}`;
}

// The minutes to a way to food, from its option: the walk and the climb
// first where they are said, else the record's median for its kind.
function minutesOf(key, node, place) {
  const d = node?.description;
  let ms = 0, said = false;
  if (d && typeof d === 'object') {
    if (Number.isFinite(d.walkSeconds)) { ms += d.walkSeconds * 1000; said = true; }
    const climb = String(d.climbFirst || '');
    const m = climb.match(/(\d+(?:\.\d+)?) (real )?minutes?/), s = climb.match(/(\d+) seconds/);
    if (m) { ms += Number(m[1]) * 60000; said = true; } else if (s) { ms += Number(s[1]) * 1000; said = true; }
    if (Number.isFinite(d.cookSeconds)) { ms += d.cookSeconds * 1000; said = true; }
  }
  if (said) return ms;
  const r = SOURCE_RECORD[sourceKind(key)];
  const row = r?.[place] || r?.all;
  return row ? row[3] * 60000 : null;
}

// The drain: hunger now against the next lines, at the record's rate where
// the bot is, and what the food carried puts off. -> { says, toNextMs, rate }
function drain(bot, supply = 0) {
  const place = placeOf(bot), rate = DRAIN[place] || DRAIN.all;
  const hunger = bot?.food ?? 20, perMs = rate / 3600000;
  const lines = [];
  if (hunger >= HEALS_AT) lines.push({ at: HEALS_AT - 1, ms: (hunger - (HEALS_AT - 1)) / perMs, says: 'under eighteen (where health stops coming back)' });
  if (hunger > SPRINT_AT) lines.push({ at: SPRINT_AT, ms: (hunger - SPRINT_AT) / perMs, says: 'to six (where sprinting stops)' });
  const twoMs = 2 / perMs;
  const lineSays = lines.length ? `it falls ${lines.map(l => `${l.says} in about ${mins(l.ms)}`).join(' and ')}` : '';
  const carried = supply > 0 ? `; the ${supply} food points carried, eaten as it falls, put that off about ${mins(supply / perMs)} more` : '; nothing carried puts it off';
  return { rate, toNextMs: lines[0]?.ms ?? 0, twoMs,
    says: `Hunger ${hunger}: at the record's ${rate} hunger an hour of play (${place === 'nether' ? 'in the Nether' : place === 'under' ? 'in the Overworld under y 56' : 'in the Overworld at y 56 or above'}), ${lineSays || 'it is at the last line already'}${carried}.` };
}

// The ways to food that failed here lately, from the ledger (tried.js): its
// food answers blocked within thirty minutes and 32 blocks. -> [{ key, n, why, agoMs }]
function failedWays(goal, bot, now = Date.now()) {
  const here = P(bot?.entity?.position);
  const out = new Map();
  for (const e of goal?.tried?.entries || []) {
    if (!['blocked', 'impossible'].includes(e.outcome) || now - e.at > FAILED_MS) continue;
    const key = String(e.method || '').split('/').at(-1);
    if (!FOOD_WAY.test(key) || /^(obtain_food|go_for_food)$/.test(key)) continue;
    if (here && e.place && dist(here, e.place) > FAILED_NEAR) continue;
    const w = out.get(key) || { key, n: 0, why: null, at: 0 };
    w.n++; if (e.at >= w.at) { w.at = e.at; w.why = e.why || 'it came to nothing'; }
    out.set(key, w);
  }
  return [...out.values()].map(w => ({ key: w.key, n: w.n, why: w.why, agoMs: now - w.at }));
}
const failedSays = (w, { name = true } = {}) => `${name ? `${words(w.key)} ` : ''}failed here ${w.n === 1 ? 'once' : `${w.n} times`} in the last ${Math.round(FAILED_MS / 60000)} minutes, the last ${ago(w.agoMs)} ago: ${w.why}`;

// The work set aside meanwhile, named.
function workSays(goal) {
  const step = goal?.step?.action ? words(goal.step.action) : null;
  const rung = goal?.gameProgress?.phase ? words(goal.gameProgress.phase) : null;
  return step ? `${step}${rung && rung !== step ? ` (the ladder's ${rung})` : ''}` : rung ? `the ladder's ${rung}` : 'the request';
}

// The question priced: the facts beside food or the work. `children` are
// the obtain_food ways on offer. -> { facts, foodSays, workSays }
function price(bot, goal, { children = {}, supply = 0, now = Date.now() } = {}) {
  const place = placeOf(bot);
  const failed = failedWays(goal, bot, now);
  const ways = Object.entries(children || {}).map(([key, node]) => {
    const ms = minutesOf(key, node, place), kind = sourceKind(key);
    const f = failed.find(w => w.key === key);
    return { key, ms, kind, failed: f || null };
  }).sort((a, b) => (a.failed ? 1 : 0) - (b.failed ? 1 : 0) || (a.ms ?? 1e9) - (b.ms ?? 1e9));
  const nearest = ways.find(w => !w.failed && w.ms != null) || null;
  const d = drain(bot, supply);
  const work = workSays(goal);
  const waySays = w => `${words(w.key)}, about ${w.ms != null ? (w.ms < 60000 ? `${Math.max(1, Math.round(w.ms / 1000))} seconds` : mins(w.ms)) : 'an unknown time'} to the food${w.kind ? `; ${recordSays(w.kind, place)}` : ''}${w.failed ? `; ${failedSays(w.failed, { name: false })}` : ''}`;
  // The reserve's record for what is carried (note 796).
  const fr = require('./food-reserve');
  const reserveSays = fr.keeps(bot, goal) ? fr.sayHere(bot, supply) : null;
  const facts = {
    waysToFood: ways.map(waySays),
    ...(failed.length ? { failedHere: failed.map(w => failedSays(w)) } : {}),
    hungerDrain: d.says,
    ...(reserveSays ? { foodReserve: `${supply} food points carried. ${reserveSays}` } : {}),
    workSetAside: work,
  };
  const foodSays = `Food or the work: ${nearest ? `the nearest way to food here is ${waySays(nearest)}` : 'no way to food here has a known time'}${failed.length ? `. Failed here: ${failed.map(w => failedSays(w)).join('; ')}` : ''}. ${d.says}${reserveSays ? ` ${reserveSays}` : ''} The work set aside meanwhile: ${work}. Chosen, ${FOOD_HOLDS}`;
  const workHoldSays = `Chosen over food, ${WORK_HOLDS} ${d.says}`;
  return { facts, foodSays, workSays: workHoldSays, nearest, drain: d };
}
const FOOD_HOLDS = 'the way to food holds (neither the work nor another way asked) until food is eaten or carried, hunger falls under a line it is above (eighteen, six), health falls a band of four, the way fails, or twice its minutes to the food pass (two to ten).';
const WORK_HOLDS = 'the work holds and no food is asked until hunger falls two from now (or under eighteen, or to six), health falls four, the food carried falls under the reserve kept (where it is at or over it now), the night needs a shelter, or the minutes the drain takes hunger two lower pass (two to ten).';

// Begin the plan: Jev's answer to food or the work, kept on `holder` (the
// survival layer's state). `minutesMs`: the way's priced minutes, for food.
function begin(holder, bot, { choice, by, key = null, need = null, supply = 0, minutesMs = null, goal = null, now = Date.now() }) {
  if (!holder || !bot) return null;
  const d = drain(bot, supply);
  const ms = choice === 'food' ? clamp(minutesMs != null ? 2 * minutesMs : 3 * 60000) : clamp(d.twoMs);
  const plan = { choice, by, ...(key ? { key, keyAt: now } : {}), ...(need ? { need } : {}), at: now, ms,
    facts: { food: bot.food ?? 20, health: bot.health ?? 20, supply, floor: require('./food-reserve').floorFor(bot, goal), dimension: dimOf(bot), deaths: (goal?.survival?.deaths || []).length, pos: P(bot.entity?.position) } };
  holder.foodChoice = plan;
  console.log(`[food plan] ${choice} chosen (${by}${key ? `: ${key}` : ''}), holds until ${untilSays(plan)}`);
  return plan;
}
// A way to food chosen under a food plan already held: the plan's way, and
// its time priced again from now.
function setWay(holder, key, minutesMs, now = Date.now()) {
  const p = holder?.foodChoice;
  if (!p || p.choice !== 'food') return null;
  p.key = key; p.keyAt = now; p.by = 'survival_priority';
  p.ms = Math.max(p.ms, (now - p.at) + clamp(minutesMs != null ? 2 * minutesMs : 3 * 60000));
  return p;
}
const reserveHolds = p => (p.facts.floor ?? 1) > 1 && (p.facts.supply ?? 0) >= p.facts.floor;
function untilSays(p) {
  return p.choice === 'food'
    ? `food is eaten or carried, hunger falls under ${p.facts.food >= HEALS_AT ? 'eighteen' : 'six'}, health falls a band of four, the way chosen fails, or ${mins(p.ms)} pass`
    : `hunger falls to ${Math.max(0, p.facts.food - 2)}${p.facts.food >= HEALS_AT ? ' (or under eighteen)' : ''}, health falls four, ${reserveHolds(p) ? `the food carried falls under the ${p.facts.floor} points kept, ` : ''}the night needs a shelter, or ${mins(p.ms)} pass`;
}

// Why the plan has ended, or null while it holds.
function endOf(p, bot, { supply = 0, goal = null, needsShelter = false, now = Date.now() } = {}) {
  if (!p) return null;
  if (dimOf(bot) !== p.facts.dimension) return `the bot went to the ${words(dimOf(bot)).replace(/^the /, '')}`;
  if ((goal?.survival?.deaths || []).length > (p.facts.deaths || 0)) return 'the bot died';
  if (now - p.at >= p.ms) return `${mins(now - p.at)} passed`;
  const food = bot?.food ?? 20, hp = bot?.health ?? 20;
  if (p.choice === 'work') {
    if (needsShelter) return 'the night needs a shelter';
    // The food carried run down under the reserve since the work was chosen
    // (food-reserve.js, note 796): the healing eats it in a minute (the
    // median from under twelve to none in the record), and the next asking
    // came with nothing carried.
    const floor = p.facts.floor ?? 1;
    if (floor > 1 && (p.facts.supply ?? 0) >= floor && supply < floor) return `the food carried fell under the reserve: ${p.facts.supply} to ${supply} food points, under the ${floor} kept`;
    if (food <= p.facts.food - 2 || (p.facts.food >= HEALS_AT && food < HEALS_AT) || (p.facts.food > SPRINT_AT && food <= SPRINT_AT)) return `hunger fell from ${p.facts.food} to ${food}`;
    if (hp <= p.facts.health - HURT) return `health fell from ${Math.round(p.facts.health)} to ${Math.round(hp)}`;
    return null;
  }
  if (food > p.facts.food) return `food was eaten: hunger ${p.facts.food} to ${food}`;
  if (supply > p.facts.supply) return `food is carried: ${p.facts.supply} to ${supply} food points`;
  if ((p.facts.food >= HEALS_AT && food < HEALS_AT) || (p.facts.food > SPRINT_AT && food <= SPRINT_AT)) return `hunger fell from ${p.facts.food} to ${food}`;
  const a = healthBand(p.facts.health), b = healthBand(hp);
  if (a != null && b != null && b < a) return `health fell from ${Math.round(p.facts.health)} to ${Math.round(hp)}`;
  if (p.key) {
    const leaf = String(p.key).split('/').at(-1);
    const e = (goal?.tried?.entries || []).filter(x => x.at >= (p.keyAt ?? p.at) - 1000 && String(x.method || '').split('/').at(-1) === leaf).at(-1);
    if (e && ['blocked', 'impossible'].includes(e.outcome)) return `the way chosen failed: ${e.why || 'it came to nothing'}`;
  }
  return null;
}

// The plan in force, or null; one whose end has come is ended here and kept
// as `foodChoiceEnded` (said once at the next asking).
function holding(holder, bot, ctx = {}) {
  const p = holder?.foodChoice;
  if (!p) return null;
  const why = endOf(p, bot, ctx);
  if (!why) return p;
  end(holder, why, ctx.now ?? Date.now());
  return null;
}
function end(holder, why, now = Date.now()) {
  const p = holder?.foodChoice;
  if (!p) return;
  holder.foodChoiceEnded = { choice: p.choice, by: p.by, ...(p.key ? { key: p.key } : {}), at: p.at, endedAt: now, why: String(why).slice(0, 200) };
  console.log(`[food plan] ${p.choice} (${p.by}${p.key ? `: ${p.key}` : ''}), chosen ${ago(now - p.at)} ago, ended: ${why}`);
  delete holder.foodChoice;
}
// The food plan as it stands, read without ending it (the holds that say a
// food errand waits on them: healWaitSays, the pocket, the night mine).
function heldFood(holder, now = Date.now()) {
  const p = holder?.foodChoice;
  return p?.choice === 'food' && now - p.at < p.ms ? p : null;
}
function says(p, now = Date.now()) {
  return `${p.choice === 'food' ? `food first${p.key ? ` (${words(String(p.key).split('/').at(-1))})` : ''}` : 'the work over food'}, chosen ${ago(now - p.at)} ago at ${words(p.by)} at hunger ${p.facts.food} and health ${Math.round(p.facts.health)}, holds until ${untilSays(p)}`;
}
function endedSays(holder, now = Date.now()) {
  const e = holder?.foodChoiceEnded;
  if (!e || now - e.endedAt > 2 * 60000 || e.said) return null;
  e.said = true;
  return `${e.choice === 'food' ? 'food first' : 'the work over food'} (${words(e.by)}), chosen ${ago(now - e.at)} ago, ended: ${e.why}`;
}

// Over the recorded asks of one record (food-asks.js scan's replay hook):
// which food asks the plan would have held, by the same rules read from the
// frames. Jev's answers after an ask the plan would not have sent cannot be
// replayed; each recorded answer is taken as given, and a held ask is one
// whose question and choice the plan would have answered already.
function replayRecord(rec, R) {
  const fa = require('../scripts/food-asks');
  const out = (R.under784 ||= { sent: 0, held: 0, heldById: {}, ends: {}, errandsNotBegun: 0, deadMinutesNotBegun: 0, workHeldAsks: 0, foodHeldAsks: 0, doubleAsk: 0 });
  let plan = null;
  const frameAt = t => { let last = null; for (const f of rec.frames) { if (f.t > t) break; last = f; } return last; };
  const failedBetween = (a, b) => rec.frames.some(f => f.t > a && f.t <= b && f.failed);
  const endWhy = (p, a) => {
    const f = frameAt(a.t) || a;
    if (a.t - p.at >= p.ms) return 'time';
    if (f.dim !== p.dim) return 'dimension';
    if (rec.frames.some(x => x.t > p.at && x.t <= a.t && x.health === 0)) return 'death';
    if (p.choice === 'work') {
      if (f.food <= p.food - 2 || (p.food >= 18 && f.food < 18) || (p.food > 6 && f.food <= 6)) return 'hunger fell';
      if (f.health <= p.health - HURT) return 'health fell';
      return null;
    }
    if (f.food > p.food || f.carried > p.carried) return 'fed';
    if ((p.food >= 18 && f.food < 18) || (p.food > 6 && f.food <= 6)) return 'hunger fell';
    if (healthBand(f.health) < healthBand(p.health)) return 'health fell';
    if (p.walked && failedBetween(p.at, a.t)) return 'way failed';
    return null;
  };
  for (const a of rec.asks) {
    if (!a.c || !['survival_priority', 'turn_priority'].includes(a.id)) continue;
    if (plan) {
      const why = endWhy(plan, a);
      if (why) { out.ends[`${plan.choice}: ${why}`] = (out.ends[`${plan.choice}: ${why}`] || 0) + 1; plan = null; }
    }
    // Held: turn_priority's claim for food is not asked while either plan
    // holds (a work plan withdraws the claim; a food plan's ruling renews);
    // survival_priority is not asked while a work plan holds, nor while a
    // food plan holds with the same way chosen again.
    const leaf = a.path.at(-1);
    const sameWay = plan?.choice === 'food' && plan.key && a.c.food && sourceKind(plan.key) === sourceKind(leaf) && sourceKind(leaf) !== 'hunt';
    // Under a work plan, survival_priority asked for another need (the
    // night's shelter, a rest) is that need's question: the plan ends there.
    if (plan?.choice === 'work' && a.id === 'survival_priority' && !a.c.food && !a.c.work) { out.ends['work: another need asked'] = (out.ends['work: another need asked'] || 0) + 1; plan = null; }
    // turn_priority: under a food plan only the re-asks the plan's renewal
    // answers ("a minute passed", "no ruling") with the food given the turn
    // again; under a work plan only where no third claim (vitals) would
    // still put the question.
    const why = String(a.d?.state?.why || '');
    const claims = a.d?.state?.claims || [];
    const turnHeld = a.id === 'turn_priority' && (plan?.choice === 'food'
      ? a.c.leaf === 'survival:obtain_food' && /^(a minute passed|no ruling)/.test(why)
      : a.c.leaf === 'work' && claims.every(l => ['survival', 'work'].includes(l)));
    const held = plan && (turnHeld || (a.id === 'survival_priority' && (plan.choice === 'work' ? a.c.work : sameWay)));
    if (held) {
      out.held++; out.heldById[a.id] = (out.heldById[a.id] || 0) + 1;
      if (plan.choice === 'work') out.workHeldAsks++; else out.foodHeldAsks++;
      continue;
    }
    // A work plan held and the recorded answer went to food: the errand it
    // began would not have begun under the plan (its minutes counted when
    // it gained nothing).
    if (plan?.choice === 'work' && a.c.food && (a.id === 'survival_priority' || (a.d?.state?.claims || []).every(l => ['survival', 'work'].includes(l)))) {
      out.held++; out.heldById[a.id] = (out.heldById[a.id] || 0) + 1; out.workHeldAsks++;
      const e = R.errands.find(x => x.port === a.port && x.from === a.t);
      if (e) { out.errandsNotBegun++; if (!e.gainedAt) out.deadMinutesNotBegun += e.minutes; }
      continue;
    }
    if (plan?.choice === 'food' && a.id === 'survival_priority' && plan.by === 'turn_priority' && plan.at > a.t - 15000) out.doubleAsk++;
    out.sent++;
    const f = frameAt(a.t) || a;
    if (a.c.food) {
      if (plan?.choice === 'food') { plan.key = leaf; plan.walked = /^(seen_food_\d+|search_food|go_home_for_food|village_food|return_for_food)$/.test(leaf); continue; }
      plan = { choice: 'food', by: a.id, key: a.id === 'survival_priority' ? leaf : null, walked: /^(seen_food_\d+|search_food|go_home_for_food|village_food|return_for_food)$/.test(leaf), at: a.t, ms: clamp(2 * (minutesOf(leaf, leafNode(a.d, a.path), fa.placeOf(a.dim, a.y) === 'nether' ? 'nether' : (a.y < 56 ? 'under' : 'surface')) ?? 90000)), food: f.food, health: f.health, carried: f.carried, dim: f.dim };
    } else if (a.c.work) {
      plan = { choice: 'work', by: a.id, at: a.t, ms: clamp(2 / ((DRAIN[a.y < 56 ? 'under' : 'surface'] || DRAIN.all) / 3600000)), food: f.food, health: f.health, carried: f.carried, dim: f.dim };
    } else plan = null;
  }
}
function leafNode(d, path) { let n = { children: d?.options }; for (const k of path || []) n = n?.children?.[k]; return n || null; }
function replaySummary(R) {
  const u = R.under784 || {};
  const round = n => Math.round(n * 10) / 10;
  const asked = u.sent + u.held;
  return { askedBefore: asked, sentUnder784: u.sent, heldUnder784: u.held, heldById: u.heldById, heldUnderAWorkPlan: u.workHeldAsks, heldUnderAFoodPlan: u.foodHeldAsks,
    survivalPriorityAfterTurnFood: u.doubleAsk, plansEndedBy: u.ends, errandsNotBegunUnderAWorkPlan: u.errandsNotBegun, deadMinutesNotBegun: round(u.deadMinutesNotBegun || 0) };
}

module.exports = { heldFood, DRAIN, SOURCE_RECORD, RECORD_WINDOW, MIN_MS, MAX_MS, FOOD_HOLDS, WORK_HOLDS, placeOf, sourceKind, recordSays, minutesOf, drain, failedWays, failedSays, workSays, price, begin, setWay, untilSays, endOf, holding, end, says, endedSays, replayRecord, replaySummary };

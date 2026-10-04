'use strict';
const { DAY } = require('./day');
const { barterReady, barterGold, bastionKnown } = require('./bartering');
const { isSetAside, setAside, attemptsFor } = require('./progress');
const { bedCarried, woolCarried, homeOf } = require('./home-base');
const { restockStage, rungWants } = require('./home-stash');
const { villageBedRung } = require('./villages');
const { eyeTarget, rodsFor, EYES_WANTED } = require('./eye-need');

const dimension = bot => String(bot.game?.dimension || '').replace(/^minecraft:/, '').replace(/^the_/, '');
const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const position = bot => bot.entity?.position && { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z };
function milliseconds(value) {
  try {
    const result = Array.isArray(value) ? Number((BigInt(value[0]) << 32n) | BigInt(value[1] >>> 0)) : Number(value);
    return Number.isSafeInteger(result) && result > 0 ? result : null;
  } catch (_) { return null; }
}

function observeProgress(bot, goal, now = Date.now()) {
  const progress = goal.gameProgress ||= { version: 1, startedAt: now, milestones: {} };
  const milestones = progress.milestones, where = dimension(bot);
  for (const [name, present] of [['nether_entered', where === 'nether'], ['end_entered', where === 'end'],
    ['eyes_obtained', count(bot, 'ender_eye') >= 12]]) {
    if (present && !milestones[name]) milestones[name] = { at: now, dimension: where, position: position(bot) };
  }
  // When the bot came into the dimension it is in, for a choice made in
  // one stay there to end with that stay (netherLeaveHeld).
  if (where && progress.here?.dimension !== where) progress.here = { dimension: where, at: now };
  return progress;
}

// These are observations, not permission to use server commands. The vanilla
// 26.1 kill_dragon advancement requires this player to kill an Ender Dragon.
// Old advancement timestamps, a despawn, or death/respawn cannot prove victory.
function watchGameProgress(bot, goal, save, { now = Date.now } = {}) {
  observeProgress(bot, goal, now());
  const onGame = () => { observeProgress(bot, goal, now()); save(); };
  const onAdvancements = packet => {
    const progress = goal.gameProgress;
    if (!progress.milestones.end_entered) return;
    for (const entry of packet.progressMapping || []) {
      if (entry.key !== 'minecraft:end/kill_dragon') continue;
      const at = milliseconds(entry.value?.find(c => c.criterionIdentifier === 'killed_dragon')?.criterionProgress);
      if (!at || at < progress.startedAt || at < progress.milestones.end_entered.at || at > now() + 60000) continue;
      progress.milestones.dragon_defeated = { at, source: 'minecraft:end/kill_dragon', criterion: 'killed_dragon' };
      save();
    }
  };
  const onExit = packet => {
    const progress = goal.gameProgress;
    if (![4, 'win_game'].includes(packet.reason) || dimension(bot) !== 'end' ||
      !progress.milestones.dragon_defeated || bot.health <= 0 || bot.isAlive === false) return;
    progress.milestones.exit_portal_used = { at: now(), dimension: 'end', position: position(bot), source: 'game_state_change:win_game' };
    save();
  };
  const onDeath = () => {
    goal.gameProgress.lastDeathAt = now();
    delete goal.gameProgress.milestones.exit_portal_used;
    delete goal.gameProgress.milestones.returned_alive;
    save();
  };
  bot.on('game', onGame); bot.on('spawn', onGame); bot.on('death', onDeath);
  bot._client.on('advancements', onAdvancements); bot._client.on('game_state_change', onExit);
  return () => {
    bot.removeListener('game', onGame); bot.removeListener('spawn', onGame); bot.removeListener('death', onDeath);
    bot._client.removeListener('advancements', onAdvancements); bot._client.removeListener('game_state_change', onExit);
  };
}

function verifyGameCompletion(bot, goal) {
  const progress = goal.gameProgress, m = progress?.milestones;
  if (!m?.nether_entered || !m.eyes_obtained || !m.end_entered || !m.dragon_defeated || !m.exit_portal_used) return false;
  const lastDeath = Math.max(progress.lastDeathAt || 0, ...(goal.survival?.deaths || []).map(d =>
    typeof d.at === 'number' ? d.at : Date.parse(d.at) || 0));
  return bot.game.gameMode === 'survival' && bot.health > 0 && bot.isAlive !== false && dimension(bot) === 'overworld' &&
    m.dragon_defeated.source === 'minecraft:end/kill_dragon' && m.dragon_defeated.at >= progress.startedAt &&
    m.dragon_defeated.at >= m.end_entered.at &&
    m.exit_portal_used.source === 'game_state_change:win_game' &&
    m.exit_portal_used.at >= m.dragon_defeated.at && m.exit_portal_used.at > lastDeath;
}

// The early rungs of the ladder, each visible within minutes. "Reach the
// Nether" as a first stage hid hours of preparation behind one label.
const TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
const tierOf = name => { const m = /^(\w+)_(pickaxe|sword|axe)$/.exec(name); return m ? TIERS.indexOf(m[1]) + 1 : 0; };
// The stash first: a respawn at the bed with empty pockets, or a rung the
// chest beside the bed can answer, is a walk of two blocks rather than an
// hour of gathering. Read from memory of the chest, so a chest with nothing
// in it costs nothing.
function preparationStage(bot, goal = {}) {
  const rung = preparationRung(bot, goal);
  if (!rung) return null;
  const home = homeOf(bot, goal);
  if (!home?.stash?.position) return rung;
  const wants = rungWants(bot, rung, { home, goal });
  const restock = restockStage(bot, goal, wants);
  if (restock) return { ...restock, action: 'home', home: { ...restock, wants } };
  return rung;
}
// Rungs that may wait their turn. Twenty minutes of work on one without
// finishing puts the choice of what next to Jev again (timeRung): "a rung
// every couple of minutes", not a day on a shield. A wait only reorders
// the ladder. A set-aside rung comes back as soon as nothing
// else is left, so nothing on this list is ever skipped on the way to the
// Nether. Pickaxes and armour are not on it: nothing after them works
// without them.
// The bed too: nothing after it needs it to start, and on a savanna with no
// sheep trial 25 walked five hundred blocks for wool with the iron pickaxe
// never on offer (2026-09-24).
// And the home's pond, plot and pen: the armour does not need them, and a
// plot that would not till held trial 28's ladder short of the armour.
// The rest of the home too (its site, levelling, chest and bed): trial 39
// placed its bed and could not walk back to claim it, and the bed's step
// held the armour off the ladder with ninety-three raw iron in the pack.
// The home is off the ladder now (a side trip, strategy.js homeOption);
// its steps stay here so a chosen one is timed as a rung (timeRung) and the
// choice is put to Jev again after twenty minutes of it.
// Iron armour may wait too: a player goes to the Nether with an iron
// pickaxe, a bucket and food, and twenty-four ingots of armour were a
// quarter of the midgame trials' time before it (the scoreboard,
// 2026-09-26). What going without costs is said with the Nether-first
// option, hit by hit, for the mobs there.
const ARMOUR_PIECES = ['iron_armour', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
// The crossing's kit may wait too (crossing-kit.js kitRungs, note 673).
const DEFERRABLE = new Set(['bed', 'home_site', 'home_level', 'home_stash', 'home_bed', 'home_water', 'home_plot', 'home_pen', 'shield', 'iron_sword', 'bucket', 'golden_boots', 'bow', 'arrows', 'diamond_sword', ...ARMOUR_PIECES, 'nether_pickaxe', 'nether_blocks', 'nether_food', 'nether_chest']);
const RUNG_BUDGET_MS = 20 * 60 * 1000, RUNG_WAIT_MS = 30 * 60 * 1000;
function preparationRung(bot, goal = {}, now = Date.now()) {
  const resting = attemptsFor(goal).of('rung', now);
  // Set aside because Jev chose to go without them (the Nether first, or
  // the crossing's kit gone on with what is carried): they wait for the
  // Nether, not for the next pass. Brought straight back, the arrows were
  // the only step on offer again the moment the Nether was chosen, and
  // mid-241-a chose the Nether first twice and hunted skeletons for three
  // hours (2026-09-26). The rest come back when nothing else is left.
  // That was all or nothing: one rung resting for another reason brought
  // every one back, and mid-242-x, its iron boots left by the kit's go-on,
  // was handed the bow and then the diamond sword it had just left for the
  // Nether, chose the Nether first again five times a second, and stalled
  // (note 498).
  // The crossing's kit is not handed back that way: a kit rung set aside for
  // any reason waits out its rest, and the crossing goes on without it
  // (note 673). Handed back, a food search that had stalled was the step
  // again the moment it was set aside.
  const rung = ladderRung(bot, goal, new Set(Object.keys(resting)));
  // Ordered by level (note 776): of the rungs that may wait, the ones owed
  // at the level the portal is cast at come last (openRungs).
  if (rung && DEFERRABLE.has(rung.phase)) {
    const ordered = openRungs(bot, goal, now);
    if (ordered.length && ordered.some(r => r.phase === rung.phase) && DEFERRABLE.has(ordered[0].phase)) return ordered[0];
  }
  return rung || ladderRung(bot, goal, new Set([...goingWithout(resting), ...kitResting(resting)]));
}
// Rungs that may wait and show no benefit in the record are optional before
// the Nether (note 776, kit-record.js needBeforeNether): the ladder does not
// hand them; each is offered at win_strategy with its minutes and its
// record, and one Jev chooses (goal.rungOptIn) is on the ladder until it is
// made, set aside, the Nether first is chosen, or OPT_IN_MS pass. The home's steps
// are a side trip of their own (strategy.js homeOption), not this.
// Between 2026-09-30 20:00Z and 2026-10-01 03:00Z the ladder handed them
// 162 pre-Nether minutes unasked (116 of the bed's 193, 23 of the iron
// armour's 56); the food for the Nether (848 minutes, 23% of every
// pre-Nether minute, 20 of 79 trials finished it) was Jev's choice each
// time, with the food the ladder's default and the Nether the alternative.
const OPT_IN_MS = 30 * 60000;
const familyOf = phase => require('./kit-record').familyOf(phase);
const optionalRung = phase => DEFERRABLE.has(phase) && !/^home_/.test(phase) && !require('./kit-record').needBeforeNether(phase);
// Before the first Nether entry only: the record is of first Nether stays,
// and after one the ladder rebuilds what a death took as it did.
const beforeNether = goal => !goal?.gameProgress?.milestones?.nether_entered;
const skipsOptional = (goal, phase) => beforeNether(goal) && optionalRung(phase) && !optedIn(goal, phase);
// goal.rungOptIn: { [rung family]: when chosen }, the armour's pieces one
// family, the beds another (kit-record.js familyOf).
function optedIn(goal, phase, now = Date.now()) {
  const at = goal?.rungOptIn?.[familyOf(phase)];
  return Number.isFinite(at) && now - at < OPT_IN_MS;
}
function optIn(goal, phase, now = Date.now()) {
  if (!optionalRung(phase)) return;
  goal.rungOptIn = Object.fromEntries(Object.entries(goal.rungOptIn || {}).filter(([, at]) => Number.isFinite(at) && now - at < OPT_IN_MS));
  goal.rungOptIn[familyOf(phase)] = now;
}
// A chosen optional rung made is no longer chosen: lost again (the food
// eaten, the bed set down), it is optional again, not handed back on the
// old choice. Read each game step; the rungs still open counted with every
// optional one on.
function settleOptIns(bot, goal, now = Date.now()) {
  if (!goal?.rungOptIn) return;
  const open = new Set(), skipped = new Set();
  let blocked = false;
  for (let i = 0; i < 16; i++) {
    let rung = null;
    try { rung = ladderRung(bot, goal, skipped, { allOptional: true }); } catch (_) { rung = null; }
    // A tool that may not wait stands before the rest: what lies past it is
    // not read from here, and no choice is dropped for it.
    if (rung && skipped.has(rung.phase)) { blocked = true; break; }
    if (!rung) break;
    skipped.add(rung.phase); open.add(familyOf(rung.phase));
  }
  for (const [fam, at] of Object.entries(goal.rungOptIn)) if ((!blocked && !open.has(fam)) || !(now - at < OPT_IN_MS)) delete goal.rungOptIn[fam];
  if (!Object.keys(goal.rungOptIn).length) delete goal.rungOptIn;
}
// The optional rungs the ladder passes over from here, in its order, each
// as the ladder would hand it were it chosen: what win_strategy offers
// beside the ladder's own next. A rung resting is not among them.
function optionalRungs(bot, goal = {}, now = Date.now()) {
  if (!beforeNether(goal)) return [];
  const skipped = new Set(Object.keys(attemptsFor(goal).of('rung', now)));
  const out = [];
  for (let i = 0; i < 16; i++) {
    let rung = null;
    try { rung = ladderRung(bot, goal, skipped, { allOptional: true }); } catch (_) { rung = null; }
    if (!rung || skipped.has(rung.phase) || out.some(r => r.phase === rung.phase)) break;
    skipped.add(rung.phase);
    if (skipsOptional(goal, rung.phase)) out.push(rung);
  }
  return out;
}
const kitResting = resting => Object.keys(resting).filter(k => require('./crossing-kit').KIT_PHASES.has(k));
// The Overworld's endermen chosen first (note 831) is going without them too.
const GOING_WITHOUT = /Nether first|fight with what is carried|for the pearls first/;
const goingWithout = resting => new Set(Object.keys(resting).filter(k => GOING_WITHOUT.test(resting[k].why || '')));
// The rungs Jev set aside to go without, in ladder order, each with when it
// comes back on its own: what the ladder would hand back were they lifted.
// Said with the Nether, where taking one up again is a route of its own.
function asideRungs(bot, goal = {}, now = Date.now()) {
  const resting = attemptsFor(goal).of('rung', now), without = goingWithout(resting);
  const skipped = new Set(Object.keys(resting).filter(k => !without.has(k)));
  const out = [];
  for (let i = 0; i < 12; i++) {
    // An optional rung set aside to go without is one of them (note 776).
    const rung = ladderRung(bot, goal, skipped, { allOptional: true });
    if (!rung || !without.has(rung.phase)) break;
    out.push({ ...rung, until: resting[rung.phase].until });
    skipped.add(rung.phase);
  }
  return out;
}
// The rungs set aside that the ladder would take up now were their rest
// lifted, each with why and when: what taking one back would mean from here.
// Read from a copy of the goal with the one rest cleared, so a rung the
// ladder would not reach here (the shield, left for the Nether, while in the
// Nether) is not offered. On 25600 the rods were set aside with their
// fortress 66 blocks off and the pearls that replaced them stalled for ten
// minutes, the stall's question never offering the rods back, and Jev
// answered none_good seven times (note 588).
function takeBackRungs(bot, goal = {}, now = Date.now()) {
  const resting = attemptsFor(goal).of('rung', now);
  const out = [];
  for (const [phase, entry] of Object.entries(resting)) {
    if (!/^[a-z_]+$/.test(phase) || phase === goal.rungTime?.phase) continue;
    let next = null;
    try { const probe = JSON.parse(JSON.stringify(goal)); attemptsFor(probe).clear('rung', phase); if (probe.elsewhere?.phase === phase) delete probe.elsewhere; next = nextGameStage(bot, probe); }
    catch (_) { next = null; }
    if (next?.phase === phase) out.push({ phase, why: entry.why, at: entry.at, until: entry.until });
  }
  return out;
}
// A span of time in words: seconds under a minute and a half, else minutes.
const agoSays = ms => { const s = Math.max(1, Math.round(ms / 1000)); return ms < 90000 ? `${s} second${s === 1 ? "" : "s"}` : `${Math.round(ms / 60000)} minutes`; };
// Whether what a rung was set aside for still stands from here (work.js
// answerStall's set_aside_rung keeps it: the ways below resting from where
// it was set aside, until the first comes off rest, or the ledger's rest for
// an answer): within four blocks of that place and before that time, taking
// it up again meets the same. mid-242-af-fortress-1 set the rods aside at
// 11:33:56, and the stall's question took them up at 11:33:57 ("set aside
// 1 minutes ago"); mid-242-af-nether-2-fortress-1's leave_nether took them
// up in the same second three times over (note 600). -> the words, or null.
function asideStands(bot, goal, phase, now = Date.now()) {
  const a = goal?.rungAside, here = bot?.entity?.position;
  if (!a || a.phase !== phase || !(a.until > now) || !a.where || !here) return null;
  const { NEAR } = require('./tried');
  const off = Math.hypot(a.where.x + 0.5 - here.x, a.where.y - here.y, a.where.z + 0.5 - here.z);
  if (off > NEAR) return null;
  return `the ${phase.replaceAll('_', ' ')} taken up again: set aside ${agoSays(now - a.at)} ago from about here for this: ${a.why}; that stands ${agoSays(a.until - now)} more from here, and taken up now it meets the same. It is offered again once the bot is more than ${NEAR} blocks from there or that time is out.`;
}
// Taking a rung back: its rest lifted, a "go on here" or a held way out of
// the Nether for it dropped, and its clock started afresh.
// A rung set aside, said on any option that would take it straight back
// up (win_strategy's stage, the Nether now): when and why, what it was
// stuck on, and when it comes back on its own. 25593 (mid-242-ig) set the
// reach nether aside at the rung's question at 21:50:13 ("I keep getting
// stuck on the reach nether") and win_strategy took it straight back 65
// seconds later and twice more, its option saying only the kit (note 694).
function rungAsideSays(goal, phase, now = Date.now()) {
  const entry = attemptsFor(goal).of('rung', now)[phase];
  if (!entry) return null;
  const aside = goal.rungAside?.phase === phase ? goal.rungAside : null;
  const minutes = Math.max(1, Math.ceil((entry.until - now) / 60000));
  const at = new Date(entry.until).toISOString().slice(11, 16);
  // Said as of when it was set aside, not as now: the tried counts inside
  // it (mine nearby, tried N times) are that moment's, and may no longer
  // hold by the time this is read again, minutes into the rest (note 728).
  const stuck = aside?.why ? ` Stuck on, as it stood when set aside: ${String(aside.why).slice(0, 160).replace(/\.$/, '')}.` : '';
  return `The ${phase.replaceAll('_', ' ')} was set aside ${agoSays(now - entry.at)} ago (${String(entry.why).slice(0, 120)}).${stuck} It comes back on its own in ${minutes} minute${minutes === 1 ? '' : 's'} (${at}Z); taken now, that rest is cut short and what it was stuck on is before it again.`;
}
function takeBackRung(goal, phase) {
  // Taken back, an optional rung is chosen (note 776).
  optIn(goal, phase);
  if (goal.rungAside?.phase === phase) delete goal.rungAside;
  attemptsFor(goal).clear('rung', phase);
  if (goal.elsewhere?.phase === phase) delete goal.elsewhere;
  if (goal.leaveNether?.reason === phase) delete goal.leaveNether;
  if (goal.rungClocks?.[phase]) goal.rungClocks[phase].reasked = 0;
  delete goal.rungTime;
}

// The pearls' route when Jev chose one (pearl-routes.js): held half an
// hour, or until the pearls are carried.
const PEARL_ROUTE_MS = 30 * 60000;
const pearlRouteHeld = (goal, now = Date.now()) => goal.pearlRoute && goal.pearlRoute.until > now ? goal.pearlRoute : null;

// The rungs open now, in ladder order: the first, and then each rung the
// ladder would go on to if the ones before it waited their turn, for as long
// as those before it may wait (DEFERRABLE). A rung that may not wait, or one
// already set aside, closes the list. What Jev chooses among (strategy.js).
function openRungs(bot, goal = {}, now = Date.now(), { ordered = true } = {}) {
  const skipped = new Set(Object.keys(attemptsFor(goal).of('rung', now)));
  const out = [];
  for (let i = 0; i < 12; i++) {
    const rung = ladderRung(bot, goal, skipped);
    if (!rung || out.some(r => r.phase === rung.phase)) break;
    out.push(rung);
    if (!DEFERRABLE.has(rung.phase)) break;
    skipped.add(rung.phase);
  }
  return ordered ? levelOrder(bot, goal, out) : out;
}
// The rungs that may wait, ordered so each level is visited once (note
// 776, levels.js levelPlan): what the pockets make now first, then what is
// owed at the level the portal is not cast at, and last what is owed where
// its lava is, the portal cast there after them. With no lava owed, the
// level the bot is at goes first. A rung that may not wait keeps its place
// at the end. Ladder order within each group.
function levelOrder(bot, goal, rungs) {
  const waits = rungs.filter(r => DEFERRABLE.has(r.phase));
  if (waits.length < 2) return rungs;
  let plan = null;
  try { plan = require('./levels').levelPlan(bot, goal); } catch (_) { plan = null; }
  if (!plan?.last) return rungs;
  const key = r => { const at = plan.of[r.phase]; return !at ? 0 : at === plan.last ? 2 : 1; };
  const sorted = waits.map((r, i) => ({ r, i, k: key(r) })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.r);
  return [...sorted, ...rungs.filter(r => !DEFERRABLE.has(r.phase))];
}
// Every rung still open on the ladder from here, deferrable or not, as far
// as the ladder names a new one with the ones before it set aside: what the
// ladder still wants made (note 771: a smelt batch sized to the iron the
// rungs ahead want, not to one rung's three ingots at a time).
function rungsOpenAhead(bot, goal = {}, now = Date.now()) {
  const skipped = new Set(Object.keys(attemptsFor(goal).of('rung', now)));
  const out = [];
  for (let i = 0; i < 16; i++) {
    let rung = null;
    try { rung = ladderRung(bot, goal, skipped); } catch (_) { rung = null; }
    if (!rung || out.some(r => r.phase === rung.phase)) break;
    out.push(rung);
    skipped.add(rung.phase);
  }
  return out;
}
function ladderRung(bot, goal, waiting, { allOptional = false } = {}) {
  // An optional rung (note 776) is the ladder's only when Jev chose it, or
  // for optionalRungs' listing of them all.
  const ready = rung => rung && !waiting.has(rung.phase) && (allOptional || !skipsOptional(goal, rung.phase)) ? rung : null;
  // Equipped gear lives outside inventory.items(): armour in slots 5 to 8,
  // the shield in the off-hand at 45. A shield on the arm is not a missing shield.
  const equipped = [5, 6, 7, 8, 45].map(slot => bot.inventory.slots?.[slot]).filter(Boolean);
  // The cursor and the crafting grid are carried too: a pickaxe there for a
  // click is not a pickaxe gone (note 779).
  const inHand = require('./pickaxe-roles').carriedItems(bot);
  const carried = [...inHand, ...equipped].map(i => i.name);
  // A tool about to break does not count as a tool: the rung fires again
  // while the old one still works, so the spare is made above ground and
  // not after the shaft goes dark. Twenty percent of durability is enough
  // to finish a trip and get back to a crafting table.
  // Or sixty-four uses, whichever is less: a fifth of a diamond pickaxe is
  // three hundred uses, and at two hundred and two the dream run counted
  // both of its diamond pickaxes spent and made stone ones for an hour.
  const usable = item => { const max = bot.registry?.itemsByName?.[item.name]?.maxDurability; return !max || max - (item.durabilityUsed || 0) >= Math.min(max * 0.2, 64); };
  const sound = [...inHand, ...equipped].filter(usable).map(i => i.name);
  // A sword is a sword to its last ten swings (note 1250): the fifth of its
  // uses kept back for a pickaxe is a trip out of a mine, and a sword wants
  // none. 25593 (2026-10-04 18:13 to 19:00Z), five pearls and seven rods
  // just banked, an iron sword with 34 swings left in its hand, was asked
  // 'stone sword ... every fight is with bare hands' 58 times in 47 minutes
  // under the rock with no wood for the stick; 25591 the same at 16:25Z with
  // an iron sword at 40.
  const swings = item => { const max = bot.registry?.itemsByName?.[item.name]?.maxDurability; return !max || max - (item.durabilityUsed || 0) >= 10; };
  const swords = [...inHand, ...equipped].filter(i => /_sword$/.test(i.name) && swings(i)).map(i => i.name);
  const best = kind => Math.max(0, ...(kind === 'sword' ? swords : sound.filter(n => n.endsWith(`_${kind}`))).map(tierOf));
  // A worn tool is still in the inventory, so the replacement is one more
  // than what is carried; asking for one would be satisfied by the worn one.
  const another = item => ({ phase: item, action: 'acquire', item, count: carried.filter(n => n === item).length + 1 });
  // A piece of iron armour still to make whose rung is not resting (the
  // armour rung below, read ahead).
  const armourOwed = () => {
    const lacks = ['helmet', 'chestplate', 'leggings', 'boots']
      .filter(piece => !carried.some(name => (/^(iron|diamond|netherite)_/.test(name) || (piece === 'boots' && name === 'golden_boots')) && name.endsWith(`_${piece}`)));
    const gold = !carried.includes('golden_boots') && ready({ phase: 'golden_boots' });
    const owed = lacks.filter(piece => !(piece === 'boots' && gold)).map(piece => `iron_${piece}`);
    return owed.length > 0 && ready({ phase: lacks.length === 4 ? 'iron_armour' : owed[0] });
  };
  // A spare may wait its turn: with a worn pickaxe of the tier still carried
  // and working, the rung Jev left (surface_trip, a climb for its wood) is
  // not handed straight back. mid-229-q's spare, the iron one at 49 uses,
  // took a 97-minute climb that wore out both pickaxes (note 511). With none
  // that works, nothing after it can start, and it cannot wait.
  const spare = (item, tier) => waiting.has(item) && carried.some(n => n.endsWith('_pickaxe') && tierOf(n) >= tier);
  // The pickaxe made is the best the heads carried make: the sticks and the
  // table are the same for either, and three iron ingots carried make one
  // with nearly twice the uses of stone that also mines the diamonds.
  // mid-243-ga, its iron pickaxe worn out 72 blocks down with 69 ingots
  // carried, was sent after "another stone pickaxe" (note 671).
  const ingots = bot.inventory.items().filter(i => i.name === 'iron_ingot').reduce((n, i) => n + i.count, 0);
  if (best('pickaxe') < 2 && !spare('stone_pickaxe', 2)) return ingots >= 3 && !waiting.has('iron_pickaxe') ? another('iron_pickaxe') : another('stone_pickaxe');
  if (best('sword') < 2) return another('stone_sword');
  // A bed before the mine. Walled in and waiting was the largest share of
  // the run's standing still, and a night slept passes in seconds; the bed
  // is carried, not left at home, so any dusk anywhere can end that way.
  // Three wool from a sheep, three planks; a search that finds no sheep
  // is set aside for twenty minutes rather than wandering all day.
  // Once the base's bed is claimed the rung is met: the carried one became
  // that bed, and a second sheep hunt before the plot and the pen is a
  // delay for a bed that far trips seldom get to use.
  // The bed, the home and the armour can each be left for later (a rung
  // that failed twice without progress, work.js persist): nothing after them
  // needs them to start. The tools before them cannot.
  if (!carried.some(n => /_bed$/.test(n)) && !goal.survival?.home?.bed?.claimedAt && !isSetAside(goal, 'bed_search', 'wool') && ready({ phase: 'bed' })) return bedRung(bot, goal);
  // After the first Nether entry, with a stone pickaxe that works carried
  // and a piece of armour still to make and not set aside, the iron goes to
  // what is worn before another iron pickaxe: stone mines the iron, the
  // rock and the netherrack, and three ingots are near half the leggings.
  // 25591 (2026-10-03 18:57 to 20:28Z), back from the Nether with nine rods
  // and seven pearls in its chest, was handed the iron pickaxe seven times,
  // with no other rung beside it, as each one wore out on the tunnels to
  // the ore: ninety minutes for one pair of leggings (note 1108).
  const pickAfterArmour = best('pickaxe') < 3 && !spare('iron_pickaxe', 3) && best('pickaxe') >= 2 && !beforeNether(goal) && armourOwed();
  if (best('pickaxe') < 3 && !spare('iron_pickaxe', 3) && !pickAfterArmour) return another('iron_pickaxe');
  if (!carried.includes('shield') && ready({ phase: 'shield' })) return { phase: 'shield', action: 'acquire', item: 'shield', count: 1 };
  if (best('sword') < 3 && ready({ phase: 'iron_sword' })) return another('iron_sword');
  if (!carried.includes('bucket') && !carried.includes('water_bucket') && ready({ phase: 'bucket' })) return { phase: 'bucket', action: 'acquire', item: 'bucket', count: 1 };
  // The home base is not a rung: it is a side trip offered with what it
  // buys and what it takes (strategy.js homeOption). It had stood here,
  // seven steps ahead of the armour, as "the walkthrough order every
  // speedrunner keeps"; no speedrunner builds a base, and none of it is on
  // the way to the pearls (the critical review, 2026-09-26).
  // Armour is four rungs, not one label. The Nether trip needs all of it,
  // and each piece is a visible step rather than "reach the Nether" for an
  // hour while twenty-four ingots accumulate.
  // One rung for the whole set, planned together: twenty-four ingots in one
  // smelt with one fuel allowance, instead of four mine-smelt-craft trips.
  const worn = carried;
  // Golden boots count for the feet: one piece of gold keeps piglins
  // neutral, which is the whole encounter class that shot the run dead.
  const short = ['helmet', 'chestplate', 'leggings', 'boots']
    .filter(piece => !worn.some(name => (/^(iron|diamond|netherite)_/.test(name) || (piece === 'boots' && name === 'golden_boots')) && name.endsWith(`_${piece}`)));
  // The feet are the golden boots' where those are still to be made (the
  // rung below): no iron boots made first to be taken off for them (note 1020).
  const goldFeet = !carried.includes('golden_boots') && ready({ phase: 'golden_boots' });
  const missing = short.filter(piece => !(piece === 'boots' && goldFeet)).map(piece => `iron_${piece}`);
  const armourPhase = short.length === 4 ? 'iron_armour' : missing[0];
  if (missing.length && ready({ phase: armourPhase })) return { phase: armourPhase, action: 'acquire_set', item: missing[0], items: missing, count: missing.length };
  // The iron pickaxe that waited for the armour (note 1108).
  if (pickAfterArmour) return another('iron_pickaxe');
  if (!carried.includes('golden_boots') && ready({ phase: 'golden_boots' })) return { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  // Most of the run's deaths were arrows: skeletons in the caves, crossbow
  // piglins in the Nether, and a bot that could only answer at arm's length.
  // A bow and a quiver before the portal, so a shooter at ten blocks is a
  // target rather than a reason to run. A bow about to break is no bow.
  // The bow is a night rung. Its string comes off spiders, which the surface
  // has after dusk and the day does not: a daylight search for one walked
  // seven hundred blocks across the map and into the sea. By day, with no
  // spider in view and no string in hand, the ladder goes on to the sword.
  const t = bot.time?.timeOfDay, dark = t >= DAY.DARK && t < DAY.DAWN;
  const spiderNear = Object.values(bot.entities || {}).some(e => e.name === 'spider' && e.position?.distanceTo?.(bot.entity.position) < 32 &&
    !isSetAside(goal, 'hunt_target', e.uuid || e.id));
  const string = bot.inventory.items().filter(i => i.name === 'string').reduce((n, i) => n + (i.count || 1), 0);
  const arrows = bot.inventory.items().filter(i => i.name === 'arrow').reduce((n, i) => n + (i.count || 1), 0);
  if (dark || spiderNear || string >= 3 || sound.includes('bow')) {
    if (!sound.includes('bow') && ready({ phase: 'bow' })) return { phase: 'bow', action: 'acquire', item: 'bow', count: carried.filter(n => n === 'bow').length + 1 };
    if (sound.includes('bow') && arrows < 16 && ready({ phase: 'arrows' })) return { phase: 'arrows', action: 'acquire', item: 'arrow', count: 16 };
  }
  // Daylight is for the deep: two diamonds make the sword that ends a blaze
  // or a piglin in two swings, and the caves on the way are where spiders
  // live by day. The night rungs come round again at dusk.
  // With the sword in hand and the sun up, the ladder is done for now: the
  // walk to the portal takes the day, and dusk brings the bow rung back.
  if (best('sword') < 4 && ready({ phase: 'diamond_sword' })) return another('diamond_sword');
  // Last before the portal, the crossing's kit: a spare pickaxe, blocks and
  // food for the stay (crossing-kit.js kitRungs, note 673).
  // Back through the portal for food (return_for_food, chosen in the
  // Nether): the food rung is handed on arrival whatever rest it had, the
  // errand the answer promised (note 763: 25584 mid-244-ak, 20:36:04Z, came
  // out at hunger 18 with some food carried, the food rung resting from an
  // earlier go_without, and the ladder sent it straight back in with none
  // gathered). Taken off once the food is met or thirty minutes pass.
  const trip = goal.foodTrip && Date.now() - goal.foodTrip.at < FOOD_TRIP_MS;
  for (const rung of require('./crossing-kit').kitRungs(bot, goal)) if (ready(rung) || (trip && rung.phase === 'nether_food')) return rung;
  return null;
}
const FOOD_TRIP_MS = 30 * 60000;

// How a bed is had, the first one or one to carry: three wool of a colour
// carried is a craft; a remembered village with beds is a walk of known
// length, and a sheep is a search, so the village bed comes first when one
// is within reach; else the wool (sheep, shears, string, cobwebs:
// home-base.js gatherWool).
function bedRung(bot, goal, phase = 'bed') {
  const wool = woolCarried(bot);
  // Mixed wool dyed white first, then the bed (home-base.js woolCarried).
  if (wool.dyed) return { phase, action: 'acquire', item: 'white_wool', count: 3 };
  if (wool.count >= 3) return { phase, action: 'acquire', item: `${wool.colour}_bed`, count: 1 };
  const village = villageBedRung(bot, goal);
  if (village) return { ...village, phase };
  return { phase, action: 'gather_wool', count: 3 - wool.count };
}

// A second bed, to carry, once the base's bed is claimed and none is in
// the pockets: the bed rung is met by the base's, and the six midgame
// trials of 2026-09-26 carried none after the home was built but one. A
// night underground was then a pocket or a night mine, about seven real
// minutes, and the climb back up was 110 of their 408 minutes. Not a rung:
// strategy.js offers it beside the ladder, with what it buys and costs,
// and it is Jev's to take. A wool search set aside is not offered.
// The chest at home answers first, as it does the bed rung.
function carryBedRung(bot, goal = {}) {
  if (bot.game?.gameMode !== 'survival' || dimension(bot) !== 'overworld') return null;
  if (!goal.survival?.home?.bed?.claimedAt || bedCarried(bot) || isSetAside(goal, 'bed_search', 'wool')) return null;
  const rung = bedRung(bot, goal, 'carry_bed');
  const home = homeOf(bot, goal);
  if (home?.stash?.position) {
    const wants = rungWants(bot, rung, { home, goal });
    const restock = restockStage(bot, goal, wants);
    if (restock) return { ...restock, phase: 'carry_bed', action: 'home', home: { ...restock, wants } };
  }
  return rung;
}

// The rungs that are the fighting kit: tools, shield, armour, and the
// golden boots the Nether's piglins look for. The rest of the ladder (bed,
// bucket, bow, the better sword) waits while supplies are in hand.
// The crossing's kit with it, rods still to get (note 673), unless set aside.
const GEAR = /^(stone_pickaxe|stone_sword|iron_pickaxe|shield|iron_armour|iron_(helmet|chestplate|leggings|boots)|golden_boots|nether_(pickaxe|blocks|food))$/;
const NOT_GEAR = new Set(['iron_sword', 'bucket', 'bow', 'arrows', 'diamond_sword']);
function gearStage(bot, goal) {
  const rung = ladderRung(bot, goal, new Set([...NOT_GEAR, ...kitResting(attemptsFor(goal).of('rung'))]));
  if (!rung || !GEAR.test(rung.phase)) return null;
  const home = homeOf(bot, goal);
  if (home?.stash?.position) {
    const wants = rungWants(bot, rung, { home, goal });
    const restock = restockStage(bot, goal, wants);
    if (restock) return { ...restock, action: 'home', home: { ...restock, wants } };
  }
  return rung;
}

// Where the Nether side of a remembered Overworld portal is: the game
// puts it at the Overworld x and z over eight (or links to a portal of
// its own near there). Walked to when no Nether portal is remembered.
function cameThrough(goal, here) {
  if (!here) return null;
  return (goal?.portals || []).filter(p => p.dimension === 'overworld')
    .map(p => ({ x: Math.floor(p.x / 8), y: Math.round(here.y), z: Math.floor(p.z / 8), from: p, estimated: true })).sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0] || null;
}

// How the walks back to a portal in the Nether went over the trials of
// 2026-09-28 (scripts/nether-trips.js, note 626): 181 trips of over sixty
// blocks and a minute, from a bot that had chosen to go back, made 17 blocks a
// minute in all and 23 when they moved at all, the stops for mobs, edges and
// drops counted: the walk at 4.3 blocks a second the option used to be priced
// at was about ten times too short. 22 of them came out in the Overworld, 18
// ended in a death and the rest were given up, set aside or stalled; of the 33
// begun under eight health 4 got through and 6 died.
const NETHER_TRIPS = { day: '2026-09-28', trips: 181, over: 60, slow: 17, fast: 30, arrived: 22, died: 18, lowTrips: 33, lowArrived: 4, lowDied: 6 };
// The measured pace against the walk: said only where the walk is long enough
// for it to count and the bot is in the Nether.
function netherPaceSays(bot, d) {
  if (dimension(bot) !== 'nether' || !(d >= NETHER_TRIPS.over)) return { seconds: d / 4.3, says: '' };
  const { slow, fast } = NETHER_TRIPS, r = n => Math.max(1, Math.round(n));
  const low = (bot.health ?? 20) < 8;
  return { seconds: d / ((slow + fast) / 2) * 60, says: ` In the Nether the bot's walks back to a portal made ${slow} to ${fast} blocks a minute over ${NETHER_TRIPS.day}'s trials, the stops for mobs, edges and drops counted: about ${r(d / fast)} to ${r(d / slow)} minutes, not seconds. Of ${NETHER_TRIPS.trips} such walks of over ${NETHER_TRIPS.over} blocks ${NETHER_TRIPS.arrived} came out in the Overworld, ${NETHER_TRIPS.died} ended in a death and the rest were given up, set aside or stalled${low ? `; of the ${NETHER_TRIPS.lowTrips} begun under eight health ${NETHER_TRIPS.lowArrived} came out and ${NETHER_TRIPS.lowDied} died` : ''}.` };
}

// How far the portal the trip back would use is: the nearest remembered here,
// or where the game put the one the bot came through.
function portalDistance(bot, goal = {}) {
  const where = dimension(bot), here = bot.entity?.position;
  if (!here) return null;
  const known = (goal.portals || []).filter(p => p.dimension === where);
  const at = known.sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0] || (where === 'nether' ? cameThrough(goal, here) : null);
  return at ? Math.round(Math.hypot(at.x - here.x, at.z - here.z)) : null;
}

// The trip through a portal, said from the portals remembered here.
function portalTrip(bot, goal = {}) {
  const where = dimension(bot), here = bot.entity?.position;
  const known = here ? (goal.portals || []).filter(p => p.dimension === where) : [];
  // A Nether portal not seen since the crossing is still where the game put
  // it: by the Overworld portal's x and z over eight. mid-242-ba-fortress-1
  // remembered only its Overworld portal, and its way back was said as
  // looked for first (note 607).
  const came = where === 'nether' && !known.length ? cameThrough(goal, here) : null;
  // Every way the walk back begins with resting or refused from here: said
  // as that, not as seconds at a walk (mob-hunt.js tripHomeClosed, note 706).
  if (where === 'nether' && (came || known.length)) {
    let closed = null; try { closed = require('./mob-hunt').tripHomeClosed(bot, goal); } catch (_) { closed = null; }
    if (closed) return closed.says;
  }
  if (came) {
    const d = Math.round(Math.hypot(came.x - here.x, came.z - here.z));
    const pace = netherPaceSays(bot, d);
    return `No portal here has been seen since the crossing, but the one the bot came through from the Overworld portal at (${came.from.x}, ${came.from.z}) comes out near (${came.x}, ${came.z}) here, ${d} blocks off, about ${Math.round(d / 4.3)} seconds at a walk once the way is found and nothing stops it, and back through it after.${pace.says}${arrivalSays(bot, pace.seconds)}${wayBackSays(bot, { x: came.x, y: here.y, z: came.z })}`;
  }
  if (!known.length) return where === 'overworld' ? 'No portal is remembered here: one is found or built first (ten obsidian, or a bucket and a lava pool).' : `No portal is remembered in the ${where}: the way back is open only once one comes into view.`;
  const nearest = known.slice().sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
  const d = Math.round(Math.hypot(nearest.x - here.x, nearest.z - here.z));
  const pace = netherPaceSays(bot, d);
  // Up or down as well as across: the walk's seconds are the flat walk's,
  // and a portal ten blocks straight below is not two seconds off. 25591
  // was told "10 blocks off, about 2 seconds at a walk" of its portal 8
  // across and 10 below, with no pickaxe and no blocks (note 678).
  const dy = Math.round((nearest.y ?? here.y) - here.y);
  const stair = Math.abs(dy) > 2 && where === 'nether' && d <= require('./tunneling').STAIR_ACROSS ? stairWay(bot, goal, nearest) : '';
  const height = Math.abs(dy) > 2 ? ` It lies ${Math.abs(dy)} blocks ${dy < 0 ? 'below' : 'above'} as well: the seconds are the walk across, and a way ${dy < 0 ? 'down' : 'up'} is its own.${stair ? ` ${stair}` : ''}` : '';
  return `The nearest portal remembered is ${d} blocks off, about ${Math.round(d / 4.3)} seconds at a walk${where === 'nether' && pace.says ? ' if nothing stops it' : ''}, and back through one after.${height}${pace.says}${where === 'overworld' ? '' : arrivalSays(bot, pace.seconds)}${where === 'nether' ? wayBackSays(bot, nearest) : ''}`;
}

// The stair to a portal up or down from here, said (tunneling.js).
function stairWay(bot, goal, portal) {
  try {
    const t = require('./tunneling'), at = new (require('vec3').Vec3)(portal.x, portal.y, portal.z);
    return t.stairSays(bot, t.stairFromHere(bot, goal, at), at);
  } catch (_) { return ''; }
}

// What the walk back to a Nether portal crosses, and what it can cost at
// this health: the straight line's lava, what one touch of lava costs this
// body now, and whether health comes back on the way. mid-235-p-nether-3-
// fortress-4 was told only "140 blocks off, about 33 seconds at a walk" at
// 4.5 health with nothing to eat, went back along the lava sea's shore and
// burned to death from 3.5 after one step into its edge (note 580).
// Ghasts and angry piglins about the bot now: said plainly on the trip
// home, not hidden and not a gate (tripHomeClosed is the gate, on what a
// walk can begin with; this is the honest risk on top of that a walk that
// can begin still carries, note 711). A count and the nearest distance,
// nothing tuned to any one trial.
function routeThreatsSays(bot) {
  const here = bot.entity?.position;
  if (!here || typeof bot.entities !== 'object') return '';
  const ents = Object.values(bot.entities || {});
  const said = [];
  const ghasts = ents.filter(e => e?.name === 'ghast' && e.isValid !== false && e.position && e.position.distanceTo(here) <= 40);
  if (ghasts.length) said.push(`${ghasts.length} ghast${ghasts.length === 1 ? '' : 's'} within 40 blocks (nearest ${Math.round(Math.min(...ghasts.map(e => e.position.distanceTo(here))))}), its fireball the risk over open ground or lava`);
  try {
    const anger = require('./anger');
    const angryOnes = ents.filter(e => anger.GROUP[e?.name] && e.isValid !== false && e.position && e.position.distanceTo(here) <= 24 && anger.angry(bot, e));
    if (angryOnes.length) said.push(`${angryOnes.length} angry piglin${angryOnes.length === 1 ? '' : 's'} within 24 blocks (nearest ${Math.round(Math.min(...angryOnes.map(e => e.position.distanceTo(here))))}), hunting the bot any way round`);
  } catch (_) { /* no anger tracking on this bot */ }
  return said.length ? ` On the way now: ${said.join('; ')}.` : '';
}
function wayBackSays(bot, portal) {
  let line = null;
  try { line = require('./work').lineSays(bot, portal); } catch (_) { line = null; }
  const overLava = !!line && / over lava/.test(line);
  // Said where the line crosses lava, and wherever a touch would be death:
  // the lava sea lies under much of the Nether, and the line read from the
  // top block down (lineSays) saw ground all the way where mid-235-p's walk
  // went down to the sea's shore.
  let touch = '';
  try { const terrain = require('./terrain'); touch = overLava || terrain.lavaTouch(bot).deadly ? terrain.lavaTouchSays(bot) : ''; } catch (_) { touch = ''; }
  const hunger = bot.food ?? 20;
  const food = (bot.inventory?.items?.() || []).some(i => { try { return require('./vitals').safeFood?.(bot, i); } catch (_) { return false; } });
  const health = Math.round((bot.health ?? 20) * 10) / 10;
  const heals = health >= 20 ? '' : hunger >= 18 ? ` Health comes back on the way at hunger ${hunger}, about a point every four seconds.` : food ? '' : ` Health does not come back on the way: hunger ${hunger}, under eighteen, and nothing to eat; ${health} health is what it walks with.`;
  // Whether the crossing at this height reaches it, with what is carried
  // and the tool in hand (note 629): the line above is ground seen, not a way.
  let reach = ''; try { reach = require('./nether-gather').reachSays(bot, portal); } catch (_) { reach = ''; }
  const threats = routeThreatsSays(bot);
  return `${line ? ` ${line}` : ''}${reach ? ` ${reach}` : ''}${touch ? ` ${touch}` : ''}${heals}${threats}`;
}

// The hour the Overworld side is at when the bot comes out there: the
// clock runs on in the Nether. mid-202-o-nether-3 went back at hunger
// seventeen, came out into the night, sealed itself in and was 330 blocks
// off by the morning's food search (note 495).
function arrivalSays(bot, seconds = 0) {
  const now = bot.time?.timeOfDay;
  if (!Number.isFinite(now)) return '';
  const t = (now + Math.round(seconds * 20)) % 24000;
  if (t >= DAY.DARK && t < DAY.DAWN) return ` It comes out in the Overworld at night, about ${Math.round((DAY.DAWN - t) / 1200)} minutes before dawn: mobs spawn about a player on the surface till then.`;
  if (t >= DAY.DUSK) return ` It comes out in the Overworld at dusk, about ${Math.round((DAY.DARK - t) / 1200)} minutes before dark.`;
  return ` It comes out in the Overworld by day, about ${Math.round((DAY.DUSK - (t >= DAY.DAWN ? t - 24000 : t)) / 1200)} minutes of daylight left.`;
}

// A trip to another dimension for what a step needs from there, chosen by
// Jev (elsewhereStep, or the kit's return_for_kit): the way there, then
// each item made there, then the ladder as before. Kept an hour at most.
const ERRAND_MS = 60 * 60000;
function errandStage(bot, goal, where, now = Date.now()) {
  const errand = goal.errand;
  if (!errand || now - (errand.at || 0) > ERRAND_MS) return null;
  // Set aside (Jev's set_aside_rung, or the loop's for a step it cannot do
  // here), the errand waits its rest like any rung. It was read nowhere:
  // mid-243-af-nether-3-fortress-1's errand for an oak log set itself aside
  // ninety times a minute for ten minutes, each pass the same way back that
  // needed the log, and Jev's set_aside_rung twice changed nothing (note 603).
  if (isSetAside(goal, 'rung', 'errand', now)) return null;
  const left = (errand.items || []).filter(i => count(bot, i.item) < i.count);
  // Nothing named to bring is a trip there, and the ladder there after.
  if (errand.items?.length ? !left.length : where === errand.dimension) return null;
  const why = { for: errand.for };
  if (where === errand.dimension) return { phase: 'errand', action: 'acquire', item: left[0].item, count: left[0].count, ...why };
  if (where === 'nether' && errand.dimension === 'overworld') return { phase: 'errand', action: 'return_overworld', ...why };
  if (where === 'overworld' && errand.dimension === 'nether') return { phase: 'errand', action: 'enter_nether', ...why };
  return null;
}

// A step whose sources are all in another dimension, set aside for it (the
// loop's WrongDimension, work.js), is said as that: the stage is the
// choice of routes (elsewhereStep), not the same step again. The set-aside
// had been made and never read here, and mid-227-r-nether-1 planned iron
// ore in the Nether 1,130 times in twenty-five minutes (note 476). Jev's
// "go on here" is read too: the step waits its half hour.
const ELSEWHERE_WAIT_MS = 30 * 60000;
const goingOnHere = (goal, phase, now = Date.now()) => goal.elsewhere?.phase === phase && goal.elsewhere.pick === 'on_here' && now - goal.elsewhere.at < ELSEWHERE_WAIT_MS;
const ELSEWHERE = /only found in the|in another dimension/;
function asideStage(goal, stage, skip) {
  if (skip.has(stage.phase) || goingOnHere(goal, stage.phase)) return null;
  if (!isSetAside(goal, 'rung', stage.phase)) return stage;
  const why = attemptsFor(goal).why('rung', stage.phase) || '';
  // Set aside for another reason, it waits its turn like any rung.
  return ELSEWHERE.test(why) ? { ...stage, action: 'elsewhere', acquire: stage.action, why } : null;
}

// Why a step waits and until when, as its set-aside said it.
function rodsRest(goal, phase = 'obtain_blaze_rods', now = Date.now()) {
  const entry = attemptsFor(goal).entries[require('./progress').keyOf('rung', phase)];
  return entry?.until > now ? { why: entry.why || 'set aside', until: entry.until } : { why: goingOnHere(goal, phase, now) ? 'Jev chose to go on here first' : 'set aside', until: 0 };
}
// Jev's "go back" for this reason, kept while the reason stands: the rest
// it was asked with, or ten minutes for a trip back for food. And only for
// the stay it was chosen in: once out of the Nether it is done, and a way
// in again is its own crossing (crossing_kit). mid-218-m-nether-3 went back
// for food at 20:59, Jev chose to cross again with none at 21:03, and on
// the far side the held "go back" turned it round at once, stepping out of
// the sheet into the soul fire before it (note 502).
// The minutes sealed in a pocket on the way are not the trip's (sealedAt,
// the wait's start): mid-242-ab-nether-3-fortress-1 chose to go back for
// food at 06:27, was sealed in against a blaze at 06:28, and at 06:37, still
// sealed in, the trip lapsed; the leave went back to the rung and the trip
// became one more thing to choose again (note 597).
const NETHER_LEAVE_MS = 10 * 60000;
function netherLeaveHeld(goal, reason, now = Date.now(), { sealedAt = 0 } = {}) {
  const held = goal.leaveNether;
  if (!held || held.reason !== reason || held.pick !== 'go_back') return false;
  if (goal.gameProgress?.here?.at > held.at) return false;
  // The way back failing below it (a flip of the staircase and the
  // crossing, a step's failure) is owed to leave_nether: asked again with
  // it said, not held. mid-243-af-fortress-1 and mid-243-ag-fortress-3 held
  // go_back while the staircase back paced three cells (note 603).
  if (require('./tried').owed(goal, 'leave_nether', now)) return false;
  const upTo = sealedAt > held.at && sealedAt < now ? sealedAt : now;
  return held.until ? held.until > now && rodsRest(goal, reason, now).until === held.until : upTo - held.at < NETHER_LEAVE_MS;
}

// The trip back for food, held, is the work only while the work would make
// it: the hunt's rule (mob-hunt.js prepareMobHunt) goes back with hunger
// under eighteen and nothing safe to eat, unless keep_on set the trip aside.
// Fed, or with food carried, the work goes on with the rung, and a pocket's
// leave said as the trip was not what leaving did. mid-243-fa (25583, note
// 670) chose the trip at 10:58, ate to 20, chose go_on at the food kit, and
// sat thirteen minutes sealed in 19 blocks from its fortress, the leave told
// as 84 blocks to the portal with 18 deaths in 181 such walks; stay answered
// every time.
function foodTripDrives(bot, goal, now = Date.now(), opts = {}) {
  if (!netherLeaveHeld(goal, 'food', now, opts)) return false;
  if ((bot?.food ?? 20) >= 18) return false;
  if (require('./mob-policy').hasFood(bot)) return false;
  return !require('./progress').isSetAside(goal, 'nether_return', 'food', now);
}

// The rods step waits in the Nether: going back, the step taken up again,
// or other work here till its rest ends, as Jev chooses (leave_nether).
// Asked once for each rest: "wait here" met again is every way resting,
// said (work.js persist), and "go back" is kept (netherLeaveHeld).
async function leaveNetherStep(bot, task, goal, save, stage, actions = {}, now = Date.now()) {
  const { WaysResting } = require('./tunneling');
  const minutes = stage.until ? Math.max(1, Math.ceil((stage.until - now) / 60000)) : 0;
  const rest = minutes ? `, taken up again in ${minutes} minute${minutes === 1 ? '' : 's'}` : '';
  const waits = `The blaze rods step waits (${stage.why})${rest}.`;
  // Other work until the rest ends, as Jev chose: the stage's own work, a
  // piece at a time (work.js holdForRest), not the rods step thrown as a
  // failure at every pass. Thrown, "The blaze rods step waits" went to
  // persist as the step failing, the stall's question asked again what
  // leave_nether had just answered, and every pass after met the throw
  // again: 25590 threw it every forty-five seconds for six minutes, each
  // round a stall of the set-aside rung and working free (note 605).
  // Chosen as other work and the work on offer run out, the hold ends and
  // this question is asked again, the wait said as idle (note 675).
  const otherWork = async (idle = true) => {
    if (!actions.hold_for_rest) throw new WaysResting(`${waits} Jev chose other work in the Nether until then.`, stage.until);
    const done = await actions.hold_for_rest(bot, task, goal, save, { reason: 'step:rods_waiting', until: stage.until, why: `${waits} Jev chose ${idle ? 'to wait here' : 'other work in the Nether'} until then.`, idle });
    if (done === false && goal.leaveNether?.pick === 'wait_here') { delete goal.leaveNether; save(); }
    return false;
  };
  const held = goal.leaveNether;
  // An idle wait held for a rest whose cause standing does not change waits
  // for nothing (waits.js, note 698): not held, asked again.
  const heldForNothing = held?.pick === 'wait_here' && held.idle === true && require('./waits').restEnds(bot, { what: 'the rods step\'s rest', until: stage.until, cause: stage.why, idle: true, now }).comes === false;
  if (held?.reason === stage.phase && held.pick === 'wait_here' && stage.until && held.until === stage.until && !heldForNothing) return otherWork(held.idle !== false);
  const search = goal.fortressSearch;
  const searched = search ? ` The fortress search so far: ${search.legs || 0} leg${search.legs === 1 ? '' : 's'} in ${search.since ? Math.round((now - search.since) / 60000) : 0} minutes${search.lastLegError ? `; the last ended: ${search.lastLegError}` : ''}.` : '';
  let tripClosed = null; try { tripClosed = require('./mob-hunt').tripHomeClosed(bot, goal); } catch (_) { tripClosed = null; }
  const tree = tripClosed ? {} : {
    go_back: { description: `Go back to the Overworld while the rods wait. ${portalTrip(bot, goal)} Back there the ladder's next step is the Nether again for the rods; the trip is for what the Overworld gives meanwhile (food, ore, the stash), and the way in again is the same portal.${searched}` },
  };
  // Not taken up again where what they were set aside for still stands
  // (asideStands): mid-242-af-nether-2-fortress-1 set the rods aside and
  // took them up here in the same second, three times (note 600). Said.
  const standing = asideStands(bot, goal, stage.phase, now);
  if (!standing) tree.search_on = { description: `Take the rods step up again now, its rest lifted: the fortress search goes on from here.${searched}` };
  // What the hold has on offer from here, said: with nothing, waiting here
  // is standing idle, and said as that. mid-242-ca-nether-1 (25585) chose
  // "other work in the Nether" at 0.87 at 01:32:27 on 2026-09-29 and stood
  // twenty minutes on its span with nothing on offer (note 675).
  const offer = stage.until && actions.rest_work ? await actions.rest_work(bot, task, goal, save, { until: stage.until }) : null;
  const idle = offer ? offer.idle : undefined;
  if (stage.until) tree.wait_here = { description: offer
    ? `${idle ? 'Wait here' : 'Other work in the Nether, chosen a piece at a time,'} until the rods step's rest ends${rest}, then the rods again. ${offer.says}`
    : `Other work in the Nether until the rods step's rest ends${rest}, then the rods again; what the work is, is asked then.`,
    // Idle, for a rest whose cause standing here does not change, it waits
    // for nothing and is not offered (waits.js, note 698): 25591 chose it 32
    // times of 32 for "go on without the warped stem" (mid-242-jb).
    waits: require('./waits').restEnds(bot, { what: 'the rods step\'s rest', until: stage.until, cause: stage.why, idle: !!idle, now }) };
  // With nothing else on offer the trip stays, said as it stands.
  if (!Object.keys(tree).length) tree.go_back = { description: `Go back to the Overworld while the rods wait. ${portalTrip(bot, goal)}` };
  const decision = await require('./decisions').decide('leave_nether', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree,
    state: { ...(tripClosed && !tree.go_back ? { tripHome: tripClosed.says } : {}), waiting: stage.phase.replaceAll('_', ' '), why: stage.why, rodsTheGoalWants: require('./eye-need').says(bot, goal), ...(minutes ? { minutesLeft: minutes } : {}), ...(standing ? { searchOnNotOffered: standing } : {}), dimension: dimension(bot), health: bot.health, food: bot.food, blazeRods: count(bot, 'blaze_rod') } });
  if (decision.stale) return false;
  const pick = decision.path.at(-1);
  goal.leaveNether = { reason: stage.phase, pick, until: stage.until || 0, at: now, ...(pick === 'wait_here' && idle !== undefined ? { idle } : {}) }; save();
  if (pick === 'search_on') { attemptsFor(goal).clear('rung', stage.phase); delete goal.elsewhere; save(); return false; }
  if (pick === 'wait_here') return otherWork(idle !== false);
  if (actions.return_overworld) await actions.return_overworld(bot, task, goal, save);
  return false;
}

// The rods (and pearls) the ladder wants are carried: ready for the
// Overworld. Before note 711 this ran return_overworld unconditionally,
// every pass, whatever stood between the bot and the portal: no check of
// whether the walk could even begin (mob-hunt.js tripHomeClosed, held for
// every other offer of the trip home since note 706, but not this one, the
// one trip that matters most), and no held intention, so a preemption
// (a threat, a stall) lost the trip and the next pass started the walk over
// from wherever the bot now stood. Measured on the flight records of
// 2026-09-29T00:00Z on: of 169 stretches with a rod carried and the step
// aimed at the portal, 165 broke off within the recorder's own gap (most
// under thirty seconds) for some other action with the rods still in the
// Nether, 4 got out; mid-242-jb (25591) carried 5 rods at 1.6 to 3.8 health
// for two hours or so, each stretch a few seconds, never arriving.
// Now: closed from here (a leg, the crossing, the staircase, all resting)
// waits, plainly, instead of walking into it again; open, going is Jev's
// go_back (leave_nether, the same question and the same held intention
// note 689 already gives it, note 705's portal target, note 706's honest
// "cannot be reached from here"), asked once and taken without asking
// where nothing else is on offer (decisions.js, "one way: taken and said,
// not asked"), so this is not a new judgment for Jev where there plainly
// is none, but it is a held intention, protected the same as any other,
// and its risk (a ghast, an angry piglin, lava on the line) is said with
// it (wayBackSays' routeThreatsSays), not hidden.
async function readyForHomeStep(bot, task, goal, save, actions = {}) {
  let tripClosed = null; try { tripClosed = require('./mob-hunt').tripHomeClosed(bot, goal); } catch (_) { tripClosed = null; }
  if (tripClosed) {
    const why = `The rods (and pearls) the ladder wants are carried, but ${tripClosed.says}`;
    if (!actions.hold_for_rest) { const { WaysResting } = require('./tunneling'); throw new WaysResting(why, tripClosed.until); }
    await actions.hold_for_rest(bot, task, goal, save, { reason: 'step:return_with_blaze_supplies', until: tripClosed.until, why: `${why} Jev chose other work in the Nether until then.`, idle: false });
    return false;
  }
  const health = bot.health ?? 20, hunger = bot.food ?? 20;
  const tree = { go_back: { description: `Go back to the Overworld: the rods (and pearls) the ladder wants are carried. ${portalTrip(bot, goal)}` } };
  // A real second way where healing first is real: hurt, but able to heal
  // (hunger eighteen or more), same as fortress_visit's heal_first. With a
  // real choice offered, Jev's answer is asked, not the fallback default,
  // and is kept as the held intention (note 689); the one-way default
  // (decisions.js, "taken and said, not asked") begins no intention, so a
  // forced go_back at full health, low risk, stays unheld and re-derived
  // each pass same as before note 711, cheaply.
  const healable = health < 20 && hunger >= 18;
  if (healable) { const secs = Math.max(1, Math.round((20 - health) * 4)); tree.heal_first = { description: `Do not go yet: wait where the bot stands until health is full, about ${secs} seconds at hunger ${hunger} (a point every four seconds), then go back with the rods carried.` }; }
  const decision = await require('./decisions').decide('leave_nether', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree,
    state: { ready: 'the rods (and pearls) the ladder wants are carried', dimension: dimension(bot), health, food: hunger, blazeRods: count(bot, 'blaze_rod'), rodsTheGoalWants: require('./eye-need').says(bot, goal) } });
  if (decision.stale) return false;
  const pick = decision.path.at(-1);
  goal.leaveNether = { reason: 'return_with_blaze_supplies', pick, at: Date.now() }; save();
  if (pick === 'heal_first') {
    const secs = Math.max(1, Math.round((20 - health) * 4));
    const until = Date.now() + Math.min(180000, Math.max(15000, secs * 1000));
    if (actions.hold_for_rest) await actions.hold_for_rest(bot, task, goal, save, { reason: 'step:heal_before_home', until, why: `Healing before the walk home with the rods: about ${secs} seconds at hunger ${hunger}.`, idle: true });
    return false;
  }
  if (actions.return_overworld) await actions.return_overworld(bot, task, goal, save);
  return false;
}

function nextGameStage(bot, goal, skip = new Set()) {
  if (verifyGameCompletion(bot, goal)) return { phase: 'complete' };
  const where = dimension(bot), m = goal.gameProgress?.milestones || {};
  const errand = errandStage(bot, goal, where);
  if (errand) return errand;
  // In the Nether with eyes of ender in the pack: out with them, before anything else there (note 1264).
  // (Eight eyes or more, or the search begun: a few eyes made early are the hunt's own business.)
  if (where === 'nether' && (count(bot, 'ender_eye') >= 8 || (count(bot, 'ender_eye') > 0 && (goal.strongholdSearch?.bearings || []).length >= 1))) return { phase: 'eyes_out', action: 'return_overworld', for: 'the eyes of ender carried: nothing in the Nether takes one' };
  // Rods banked (rod-bank.js, note 760): out through the portal and into a
  // chest on the Overworld side while that is under way; taken out there once
  // the rods carried and banked are what the goal wants.
  require('./rod-bank').bankOnArrival(bot, goal, where);
  const bank = require('./rod-bank').bankStage(bot, goal, where);
  if (bank) return bank;
  const banked = require('./rod-bank').collectHere(bot, goal);
  if (banked) return banked;
  // Early game only: once any Nether or End supply is in hand, the run has
  // moved past preparation and the later stages own what to fetch next.
  // The first Nether entry is not that line: a death empties the pockets,
  // and a climb that skips the ladder because the milestone is set walks
  // back to the portal with a stone pickaxe, no bucket and no gold, which
  // is how three Nether trips went in with less than the first one.
  const supplies = ['ender_eye', 'blaze_rod', 'blaze_powder', 'ender_pearl'].reduce((n, name) => n + count(bot, name), 0);
  if (where === 'overworld' && !supplies) { const prep = preparationStage(bot, goal); if (prep) return prep; }
  // The kit a fight needs is rebuilt whatever supplies are carried: blaze
  // rods from the stash, taken before the armour lost in a lava death was
  // made again, skipped the ladder, and the bot went through the Nether and
  // back in no armour and died to one creeper on the far shore.
  if (where === 'overworld' && supplies) { const gear = gearStage(bot, goal); if (gear) return gear; }
  if (where === 'end') return m.dragon_defeated ? { phase: 'return_alive', action: 'exit_end' } : { phase: 'defeat_dragon', action: 'fight_dragon' };
  // Survey throws deliberately spend eyes. Do not send Jev back to the Nether
  // after each throw while it still has a spare and twelve portal eyes. A
  // pending pickup gets a chance before deciding whether supplies are short.
  // The frames still empty: the number saved with the portal, else read off
  // the frames the milestone holds; with neither, the ring is gone to and
  // its frames counted there, while an eye is held to put in one (note
  // 1210). With no number saved the way to the End was open at any count of
  // eyes, none too: 25594
  // (2026-10-04 08:20 to 11:53Z), its twelve eyes lost at a death and its
  // portal's twelve frames empty, was three and a half hours on the End's
  // kit, stalking skeletons for arrows, with no eye and no pearl.
  const framesOf = m.stronghold_located?.frames;
  const portalNeed = m.stronghold_located && (Number.isInteger(goal.endPortal?.neededEyes) ? goal.endPortal.neededEyes
    : Array.isArray(framesOf) && framesOf.length ? framesOf.filter(f => !f.eye).length : null);
  // Eyes in the bot's Overworld chest are held (eye-bank.js, note 1193): the End's kit is seen to with them put away.
  const eyesBanked = require('./eye-bank').banked(goal);
  if (where === 'overworld' && m.stronghold_located && (Number.isInteger(portalNeed) ? count(bot, 'ender_eye') + eyesBanked >= portalNeed : count(bot, 'ender_eye') + eyesBanked >= 1)) return { phase: 'enter_end', action: 'enter_end' };
  // The search goes with the spare in the pack and the twelve put away, where that was chosen (eye-bank.js, note 1197).
  if (where === 'overworld' && !m.stronghold_located && goal.strongholdSearch && ((count(bot, 'ender_eye') + eyesBanked >= EYES_WANTED && count(bot, 'ender_eye') >= 1) || goal.strongholdSearch.pendingPickup)) {
    return { phase: 'find_stronghold', action: 'find_stronghold' };
  }
  // The one number of enough (eye-need.js): the twelve frames and the spare
  // the stronghold search throws with, thirteen eyes, seven rods, thirteen
  // pearls; the frames still empty once the portal is found. It was sixteen
  // eyes and eight rods, said nowhere (note 648). Execution always replans
  // from inventory, so loss, crafting batches and partial pickups do not
  // advance a fake counter.
  const target = eyeTarget(goal), eyes = count(bot, 'ender_eye') + eyesBanked;
  const rods = rodsFor(target - eyes, count(bot, 'blaze_powder'));
  // Eyes, rods, powder and pearls in the stash chest are the chest's first:
  // the run set off for the fortress with six blaze rods left at home.
  if (where === 'overworld') {
    const wants = [];
    if (eyes < target) wants.push({ item: 'ender_eye', count: target - eyes });
    if (count(bot, 'blaze_rod') < rods) wants.push({ item: 'blaze_rod', count: rods - count(bot, 'blaze_rod') }, { item: 'blaze_powder', count: 2 * (rods - count(bot, 'blaze_rod')) });
    if (count(bot, 'ender_pearl') < target - eyes) wants.push({ item: 'ender_pearl', count: target - eyes - count(bot, 'ender_pearl') });
    const restock = wants.length && restockStage(bot, goal, wants);
    if (restock) { const supply = restock.items.filter(m => m.want); if (supply.length) return { ...restock, phase: 'restock_supplies', action: 'home', home: { ...restock, items: supply, wants } }; }
  }
  // In the Nether a chest the bot left rods in is held (rod-stash.js, note
  // 704): the hunt counts it, and it is taken out before the portal walk.
  // Elsewhere the rods carried are what the eyes are made of.
  const kept = where === 'nether' ? require('./rod-stash').stashed(goal) : null;
  // The eyes in the bot's Overworld chest are in `eyes` already (eyesBanked):
  // not taken off a second time as the chest's (note 1265). 25593
  // (2026-10-04 23:27 to 23:32Z), twelve eyes put in its chest and one pearl
  // wanted, read the pearl short on the Overworld side and every one had on
  // the Nether side (thirteen less twelve less twelve), and went through
  // its portal and straight back three times.
  const keptEyes = Math.max(0, (kept?.ender_eye || 0) - eyesBanked);
  const keptRods = kept ? rodsFor(target - eyes - keptEyes, count(bot, 'blaze_powder') + kept.blaze_powder) : rods;
  // In the Overworld with pearls still wanted, the rods in the bot's chests
  // on either side are held as they are in the Nether (note 1056): counted
  // by what is carried alone, a bot with every rod banked was short of
  // seven there and held seven in the Nether. 25593 (2026-10-03 12:54 to
  // 13:05Z), six rods in its Overworld chest and one in the Nether, crossed
  // its portal six times in eleven minutes, "the Nether now" on one side
  // and "heading back to the Overworld" on the other. With the pearls had,
  // the rods carried are what the eyes are made of, as before.
  const keptAll = where === 'overworld' ? require('./rod-stash').stashed(goal) : null;
  const pearlsWanting = count(bot, 'ender_pearl') + (keptAll?.ender_pearl || 0) < target - eyes;
  const rodsShort = keptAll && pearlsWanting
    ? count(bot, 'blaze_rod') + (keptAll.blaze_rod || 0) < rodsFor(target - eyes - (keptAll.ender_eye || 0), count(bot, 'blaze_powder') + (keptAll.blaze_powder || 0))
    : count(bot, 'blaze_rod') + (kept?.blaze_rod || 0) < keptRods;
  const pearlsHereShort = count(bot, 'ender_pearl') + (kept?.ender_pearl || 0) < target - eyes - keptEyes;
  const collect = where === 'nether' && kept?.chests.length ? require('./rod-stash').collectStage(bot, goal) : null;
  // The pearls from the Overworld's endermen, Jev's route while the rods
  // wait (pearl-routes.js): back through the portal, and there the pearls
  // before the Nether again. Without it, short of rods in the Overworld the
  // ladder went straight back into the Nether, and the Overworld's hunt was
  // no route at all while the rods were short (note 588).
  const pearlsShort = count(bot, 'ender_pearl') < target - eyes;
  const overworldPearls = pearlsShort && pearlRouteHeld(goal)?.pick === 'overworld';
  if (overworldPearls && where === 'nether' && !rodsShort && collect) return collect;
  if (overworldPearls && where === 'nether') return { phase: 'obtain_ender_pearls', action: 'return_overworld', item: 'ender_pearl', count: target - eyes, via: 'overworld_hunt' };
  // On the way to the Nether, an enderman in reach is a way to the pearls
  // the rods' trip passes (pearl-order.js, note 790): asked as in the Nether.
  if (rodsShort && where === 'overworld' && !overworldPearls && pearlsShort) {
    const order = require('./pearl-order').orderStage(bot, goal, { count: target - eyes, phase: 'reach_nether' });
    if (order) return order;
  }
  // In the Overworld with every pearl had and the rods short only in the
  // pack, the rest in the bot's chest on this side: the chest is the step,
  // resting from a take that failed or not, not the Nether (note 1263).
  // 25593 (2026-10-04 23:04 to 23:13Z), five rods and seven pearls carried
  // and two rods and six pearls in its chest a block off, a take refused
  // ('Still in the chest') and the chest rested ten minutes, went through
  // its portal and back twice 'for rods' with all of it in its pack.
  if (rodsShort && where === 'overworld' && keptAll && !pearlsWanting) {
    const over = require('./rod-stash').stashes(goal).filter(c => c.dimension === 'overworld' && require('./rod-stash').withContents(c));
    const rodsOver = over.reduce((n, c) => n + (c.contents?.blaze_rod || 0), 0), powderOver = over.reduce((n, c) => n + (c.contents?.blaze_powder || 0), 0), eyesOver = over.reduce((n, c) => n + (c.contents?.ender_eye || 0), 0);
    if (count(bot, 'blaze_rod') + rodsOver >= rodsFor(target - eyes - eyesOver, count(bot, 'blaze_powder') + powderOver)) {
      const take = require('./rod-stash').collectStage(bot, goal, Date.now(), { resting: true });
      if (take) return take;
    }
  }
  if (rodsShort && where !== 'nether' && !overworldPearls) return { phase: 'reach_nether', action: 'enter_nether' };
  // Out for the Overworld's endermen (the route held): the hunt here, not the
  // rods' stage, whose acquire walked straight back to the portal (note 831:
  // 25593, 2026-10-01 16:30 to 16:47Z, crossed five times in twelve minutes,
  // out for the pearls and in again for the rods).
  if (overworldPearls && where === 'overworld') return { phase: 'obtain_ender_pearls', action: 'pearl_patrol', item: 'ender_pearl', count: target - eyes, via: 'overworld_hunt' };
  if (rodsShort) {
    const rodStage = asideStage(goal, { phase: 'obtain_blaze_rods', action: 'acquire', item: 'blaze_rod', count: keptRods - (kept?.blaze_rod || 0) }, skip);
    // The pearls beside the rods (pearl-order.js, note 788): with a way to
    // them real from here, which first is Jev's, asked and held; a pearl way
    // held is the step while it stays real. The rods first by rule never
    // reached the pearls in the trials but with the rods resting.
    if (rodStage && where === 'nether' && pearlsHereShort) {
      const order = require('./pearl-order').orderStage(bot, goal, { count: target - eyes });
      if (order) return order;
    }
    if (rodStage) return rodStage;
  }
  // Short of pearls with gold on hand and a piglin in view: barter before
  // going back. The enderman hunt in the Overworld is the other way.
  if (where === 'nether' && pearlsHereShort && barterReady(bot, goal)) return { phase: 'obtain_ender_pearls', action: 'barter', item: 'ender_pearl', count: target - eyes };
  // No gold to throw (none, or too little for the boots worn first and a
  // throw, note 616), and a bastion remembered: its gold blocks first.
  if (where === 'nether' && pearlsHereShort && !barterGold(bot).throwable && bastionKnown(bot, goal) && !isSetAside(goal, 'rung', 'bastion_gold'))
    return { phase: 'obtain_ender_pearls', action: 'bastion_gold', item: 'gold_ingot' };
  // Pearls from the warped forest while here: one known, or a sweep for one
  // (warped-pearls.js), before the walk back.
  const warped = require('./warped-pearls');
  if (where === 'nether' && pearlsHereShort && warped.warpedOpen(goal, Date.now(), { bot }))
    return { phase: 'obtain_ender_pearls', action: 'warped_pearls', item: 'ender_pearl', count: target - eyes };
  // Short of rods here only when that step waits (asideStage): the way back
  // is said as that, not as rods carried home.
  // Short of rods, that step waiting: leaving is Jev's (leaveNetherStep),
  // or kept once Jev chose it. It had gone back unasked whenever the rods
  // were set aside for any reason not their sources (note 495).
  if (where === 'nether' && rodsShort) {
    return netherLeaveHeld(goal, 'obtain_blaze_rods') ? { phase: 'return_overworld', action: 'return_overworld' } : { phase: 'obtain_blaze_rods', action: 'rods_waiting', ...rodsRest(goal) };
  }
  if (where === 'nether' && collect) return collect;
  if (where === 'nether') return { phase: 'return_with_blaze_supplies', action: 'home_with_rods' };
  if (where !== 'overworld') return { phase: 'unknown_dimension', action: 'unsupported_dimension' };
  // A cleric's pearls, when a village is remembered and a pearl trade has
  // been read there (trading.js): a walk and some emeralds instead of an
  // enderman hunt. Set aside like any rung when it stops paying.
  const pearlOffer = Object.values(goal.trading?.offers || {}).some(o => (o.trades || []).some(t => t.outputItem?.name === 'ender_pearl' && !t.tradeDisabled));
  if (count(bot, 'ender_pearl') < target - eyes && pearlOffer && !isSetAside(goal, 'rung', 'trade_pearls') && require('./villages').knownVillages(bot, goal, 512).length)
    return { phase: 'obtain_ender_pearls', action: 'trade', item: 'ender_pearl', count: target - eyes };
  // A warped forest (remembered, or looked for) beats a night walk here:
  // the Overworld hunt is the fallback once the Nether search has rested.
  if (count(bot, 'ender_pearl') < target - eyes && warped.warpedOpen(goal, Date.now(), { bot }) && !overworldPearls)
    return { phase: 'obtain_ender_pearls', action: 'enter_nether', item: 'ender_pearl', count: target - eyes, via: 'warped_forest' };
  // Endermen when they show, and something worth doing while they do not:
  // walking rings about looking for one was the dullest hour of the run
  // (the user, 2026-09-23). The patrol hunts one in view and otherwise
  // goes on an expedition or explores new ground (work.js pearl_patrol).
  if (count(bot, 'ender_pearl') < target - eyes) return { phase: 'obtain_ender_pearls', action: 'pearl_patrol', item: 'ender_pearl', count: target - eyes };
  if (eyes < target) return { phase: 'craft_eyes', action: 'acquire', item: 'ender_eye', count: target - eyesBanked };
  if (!m.stronghold_located) return { phase: 'find_stronghold', action: 'find_stronghold' };
  return { phase: 'enter_end', action: 'enter_end' };
}

// Working time on the current rung: gaps between steps (a night in a
// shelter, a stop) count at most half a minute, so only time spent on it
// runs the budget down.
// One clock per rung, kept while other steps come and go: a single clock
// reset on every change of phase, and a stash-restock step alternating
// with the rung restarted it each time, so twenty minutes never ran out.
function timeRung(bot, goal, phase, now = Date.now()) {
  const clocks = goal.rungClocks ||= {};
  // A clock untouched for half an hour belongs to a rung that was finished
  // and has come round again (a lost shield): it starts from nothing.
  if (clocks[phase] && now - clocks[phase].lastAt > 30 * 60000) delete clocks[phase];
  const rung = clocks[phase] ||= { activeMs: 0, lastAt: now };
  const previous = goal.rungTime?.phase === phase ? rung.lastAt : now;
  rung.activeMs += Math.min(30000, Math.max(0, now - previous)); rung.lastAt = now;
  goal.rungTime = { phase, ...rung };
  // Every twenty working minutes without finishing, the strategy is asked
  // again with the minutes said (minutesWorkedOn): another open rung can
  // go first, and that is Jev's to weigh, not a set-aside by rule.
  if (!DEFERRABLE.has(phase) || rung.activeMs < RUNG_BUDGET_MS * ((rung.reasked || 0) + 1)) return false;
  rung.reasked = (rung.reasked || 0) + 1; delete goal.strategy;
  return true;
}

// The run's own clock, for every choice to see. Each question said the
// minutes of its own option and none said the run's: mid-207-i kept a
// surface frame through three askings, seventy minutes on the way into
// the Nether, told each time only of the twenty just gone (the user: "Jev
// doesn't care about time", 2026-09-27). Played time is counted from the
// trail's samples, a gap (a restart) at most half a minute, and by what
// the bot was on: a survival action by its name, work by its rung and step.
function tallyClock(goal, doing, now = Date.now()) {
  const progress = goal?.gameProgress;
  if (!progress || !doing) return;
  const clock = progress.clock ||= { startedAt: now, lastAt: now, playedMs: 0, byDoing: {} };
  const dt = Math.min(30000, Math.max(0, now - clock.lastAt));
  clock.lastAt = now; clock.playedMs += dt;
  clock.byDoing[doing] = (clock.byDoing[doing] || 0) + dt;
  const recent = clock.recent ||= [];
  recent.push([now, doing, dt]);
  while (recent.length && now - recent[0][0] > 30 * 60000) recent.shift();
}
const minutes = ms => Math.round(ms / 60000);
const byMinutes = pairs => Object.fromEntries(Object.entries(pairs).filter(([, ms]) => ms >= 30000).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, ms]) => [k.replaceAll('_', ' '), minutes(ms)]));
function runClock(goal, now = Date.now()) {
  const clock = goal?.gameProgress?.clock;
  if (!clock) return null;
  const reached = {};
  for (const [name, m] of Object.entries(goal.gameProgress.milestones || {})) {
    if (!Number.isFinite(m?.at)) continue;
    reached[name.replaceAll('_', ' ')] = m.at < clock.startedAt ? 'before this clock began' : `${Math.round((m.at - clock.startedAt) / 60000)} minutes in`;
  }
  const last = {};
  for (const [, doing, dt] of clock.recent || []) last[doing] = (last[doing] || 0) + dt;
  return {
    minutesPlayed: Math.round(clock.playedMs / 60000), minutesSinceStart: Math.round((now - clock.startedAt) / 60000),
    reached, ...(goal.gameProgress.phase ? { nowOn: goal.gameProgress.phase.replaceAll('_', ' ') } : {}),
    minutesBy: byMinutes(clock.byDoing), lastHalfHourBy: byMinutes(last),
  };
}

function noteFoodTrip(bot, goal, save = () => {}, now = Date.now()) {
  if (dimension(bot) === 'overworld' && (goal.step?.action === 'return_for_food' || now - (goal.foodTripChosen || 0) < FOOD_TRIP_MS) && !goal.foodTrip) { goal.foodTrip = { at: now }; delete goal.foodTripChosen; save(); }
}
async function gameStep(bot, task, goal, save, actions) {
  task.check();
  if (bot.game.gameMode !== 'survival') throw Object.assign(new Error('The game-completion task requires Survival mode'), { name: 'Blocked' });
  const progress = observeProgress(bot, goal);
  await require('./mob-policy').wearBestArmour(bot);
  // Gold for the piglins before the stage in hand, where the pack makes it (mob-hunt.js goldForPiglins, note 908).
  if (await require('./mob-hunt').goldForPiglins(bot, task, goal, save, actions)) return false;
  // And a sword, where none is carried and the pack makes one (note 1256).
  if (await require('./mob-hunt').swordFromPack(bot, task, goal, save, actions)) return false;
  // The rods carried are asked about at the ladder's own step in the Nether,
  // whatever the rung in hand (rod-bank.js askBank, note 929), by the
  // question's own pacing (once for each count of rods, again after ten
  // minutes). It was asked at a cage, in a blaze's hunt, at the pearl order
  // and on the fortress search (note 928); 25593 (mid-239-ac-fortress-4,
  // 2026-10-02 18:40 to 18:45Z) came back on the search for a warped forest
  // with five rods in its pack, was not asked, and burned with them.
  if (dimension(bot) === 'nether') {
    let banked = null;
    try { banked = await require('./rod-bank').askBank(bot, task, goal, save, actions, actions?.client || task.opportunityClient); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err; }
    if (banked === 'banked') return false;
    // The pearls carried are asked about at the ladder's own step too, whatever the rung in hand (mob-hunt.js pearlsNow, note 1266).
    let kept = null;
    try { kept = await require('./mob-hunt').pearlsNow(bot, task, goal, save, actions.stashActions || actions, actions?.client || task.opportunityClient, { any: true }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err; }
    if (kept === 'kept') return false;
  }
  // The spare kit by the bed, asked on its own where it can be left (home-
  // stash.js askSpareKit, note 1222).
  if (dimension(bot) === 'overworld' && actions?.spare_kit) {
    let left = false;
    try { left = await actions.spare_kit(bot, task, goal, save); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err; }
    if (left) return false;
  }
  // Out of the Nether on a food trip (note 763): kept until the food rung
  // is met or set aside by choice, or thirty minutes pass.
  // The trip back for food chosen in the Nether is kept to arrival
  // (foodTripChosen): the ladder's own return_overworld step took its place
  // on the way, and the trip was never counted (note 832: 25597, 12:56Z,
  // out for food with none and straight back in).
  noteFoodTrip(bot, goal, save);
  if (goal.foodTrip && (Date.now() - goal.foodTrip.at >= FOOD_TRIP_MS || !require('./crossing-kit').kitRungs(bot, goal).some(r => r.phase === 'nether_food'))) { delete goal.foodTrip; save(); }
  settleOptIns(bot, goal);
  let stage = nextGameStage(bot, goal);
  // Back for what the last death dropped, before anything else: close to
  // the respawn its drops have five minutes (corpse-run.js).
  if (actions.corpse_run && stage.phase !== 'complete' && await actions.corpse_run(bot, task, goal, save)) return false;
  // Strategy: which of the open rungs, or a side trip, is Jev's to choose
  // (strategy.js). A side trip that ran is this step's work.
  if (actions.strategy && stage.phase !== 'complete') {
    const chosen = await actions.strategy(bot, task, goal, save, stage);
    // A side trip that ran, or the question held through a Jev outage (asked
    // fresh at the next step, note 707).
    if (chosen?.ran || chosen?.stale) return false;
    if (chosen?.stage) stage = chosen.stage;
    // A choice that only set steps aside did nothing in the world: the
    // ladder moves on at once to what it leaves next. Kept as the step, it
    // was work that never progressed (mid-242-x, note 498).
    if (chosen?.replan) stage = nextGameStage(bot, goal);
  }
  // Back in the Overworld and not crossing: wolves left sitting stand up.
  if (actions.wolves && goal.wolfOrder?.sit && dimension(bot) === 'overworld' && !['enter_nether', 'reach_nether', 'enter_end'].includes(stage.action)) await actions.wolves(bot, task, goal, save, false);
  // Back in the Overworld with nothing left to cross for: a field cache in
  // reach is emptied before the ladder goes on.
  if (actions.take_cache && !['enter_nether', 'reach_nether'].includes(stage.action) && stage.phase !== 'complete') {
    if (await actions.take_cache(bot, task, goal, save)) return false;
  }
  progress.phase = stage.phase; goal.step = { action: 'game_progression', ...stage };
  // The rods waiting out their set-aside are not the rung in hand (tried.js
  // rungOf): not timed as it, and the stall's question does not name it.
  // Timed here, the waiting stage put the set-aside rung back in rungTime at
  // every pass, and the stall watch and the stall's question ("keep at the
  // obtain blaze rods another way") went on naming it (25590, note 605).
  if (stage.action === 'rods_waiting' && isSetAside(goal, 'rung', stage.phase)) delete goal.rungTime;
  else timeRung(bot, goal, stage.phase);
  save();
  if (stage.phase === 'complete') {
    progress.milestones.returned_alive = { at: Date.now(), dimension: 'overworld', position: position(bot) }; save(); return true;
  }
  // A plan that needs another dimension's blocks is not begun here: the
  // routes are Jev's (elsewhereStep).
  if (stage.action === 'acquire') await actions.acquireStep(bot, task, stage.item, stage.count, goal, save, { elsewhere: away => elsewhereStep(bot, task, goal, save, stage, away, actions) });
  else if (stage.action === 'elsewhere') await elsewhereStep(bot, task, goal, save, stage, null, actions);
  else if (stage.action === 'rods_waiting') await leaveNetherStep(bot, task, goal, save, stage, actions);
  else if (stage.action === 'pearl_order') await require('./pearl-order').ask(bot, task, goal, save, actions);
  else if (stage.action === 'collect_rod_stash') await require('./rod-stash').collect(bot, task, goal, save, actions.stashActions || actions);
  else if (stage.action === 'bank_rods') await require('./rod-bank').bank(bot, task, goal, save, actions.stashActions || actions);
  else if (stage.action === 'home_with_rods') await readyForHomeStep(bot, task, goal, save, actions);
  else if (stage.action === 'nether_food') {
    if (!actions.nether_food) throw Object.assign(new Error('Game progression is blocked at the food for the Nether: the nether food action is not implemented here. Earlier progress is saved.'), { name: 'Blocked' });
    await actions.nether_food(bot, task, goal, save, stage);
  }
  else if (stage.action === 'gather_wool') {
    if (!actions.gather_wool) throw Object.assign(new Error('Game progression is blocked at the bed: the gather wool action is not implemented here. Earlier progress is saved.'), { name: 'Blocked' });
    await actions.gather_wool(bot, task, goal, save, stage);
  }
  else if (stage.action === 'home') {
    if (!actions.home) throw Object.assign(new Error('Game progression is blocked at the home base: the home action is not implemented here. Earlier progress is saved.'), { name: 'Blocked' });
    await actions.home(bot, task, goal, save, stage.home);
  }
  else if (stage.action === 'village_bed') {
    if (!actions.village_bed) throw Object.assign(new Error('Game progression is blocked at the bed: the village bed action is not implemented here. Earlier progress is saved.'), { name: 'Blocked' });
    await actions.village_bed(bot, task, goal, save, stage);
  }
  else if (stage.action === 'acquire_set') await (actions.acquireSetStep || (async (b, t, items, g, sv) => { for (const item of items) if (!await actions.acquireStep(b, t, item, 1, g, sv)) return false; return true; }))(bot, task, stage.items, goal, save);
  else {
    // Gather combat supplies in the Overworld before a first Nether trip;
    // iron ore is not available to repair this dependency once inside.
    // The rest of the crossing's kit (food, health, blocks, a spare pickaxe,
    // wood, the valuables left at home or in a chest here) is said at the
    // crossing itself and topping it up is Jev's (work.js
    // crossingKitReady): gates here, one after another and none of them
    // said, were a second ladder between "Nether first" and the portal (the
    // decision review, 2026-09-26).
    // Wolves sit here: they attack what the bot hits, and the far side is
    // zombified piglins and endermen.
    if (['enter_nether', 'enter_end'].includes(stage.action) && actions.wolves) await actions.wolves(bot, task, goal, save, true);
    // At home past the ladder, valuables go in whatever comes next, not
    // only before the Nether: the dream run walked a day with sixty lapis,
    // thirty-six raw iron and nineteen ingots, and after the kit restore was
    // stopped a death took all of it. The keepsakes' keeps hold back what
    // the stage spends (pearls, rods, eyes, the diamonds before the pickaxe).
    // Before the Nether the walk home is offered with the kit instead.
    if (stage.action !== 'enter_nether' && actions.stash_valuables && !await actions.stash_valuables(bot, task, goal, save)) return false;
    // Not on the trip chosen for the kit a death left on the far side, as
    // the bot stands (corpse-run.js kitTrip): 25584 (2026-10-04 15:48Z)
    // chose it and was sent for oak logs and iron armour first (note 1234).
    const kitTrip = stage.for === require('./corpse-run').KIT_ERRAND && goal.corpseRun?.status === 'open';
    if (stage.action === 'enter_nether' && await require('./mob-hunt').goldForPiglins(bot, task, goal, save, actions, { crossing: true })) return false;
    // No eye of ender goes through the portal to the Nether (eye-bank.js bankBeforeNether, note 1264).
    if (stage.action === 'enter_nether' && dimension(bot) === 'overworld' && (count(bot, 'ender_eye') >= 8 || (count(bot, 'ender_eye') > 0 && (goal.strongholdSearch?.bearings || []).length >= 1))) {
      await require('./eye-bank').bankBeforeNether(bot, task, goal, save, actions.stashActions || actions);
      // Put away or not, the step ends here: with an eye still in the pack the portal is not walked through.
      return false;
    }
    if (stage.action === 'enter_nether' && !kitTrip && actions.prepare_combat && !await actions.prepare_combat(bot, task, goal, save)) return false;
    if (stage.action === 'enter_end' && actions.prepare_end && !await actions.prepare_end(bot, task, goal, save)) return false;
    const execute = actions[stage.action];
    if (!execute) throw Object.assign(new Error(`Game progression is blocked at ${stage.phase.replaceAll('_', ' ')}: the ${stage.action.replaceAll('_', ' ')} action is not implemented yet. Earlier progress is saved.`), { name: 'Blocked' });
    await execute(bot, task, goal, save);
  }
  return false;
}

// The step on the ladder cannot be done in this dimension: its plan mines
// blocks found only in another (`away`, knowledge.js elsewhereOf), or the
// loop set it aside for that (asideStage). The ladder says so, and going
// there or going on here with the ladder's next step is Jev's choice. Gone
// there, the errand is what is mined there and brought back.
async function elsewhereStep(bot, task, goal, save, stage, away, actions = {}, now = Date.now()) {
  const where = dimension(bot), words = s => String(s || '').replaceAll('_', ' ');
  const record = goal.wrongDimension?.phase === stage.phase || !away ? goal.wrongDimension : null;
  // Set aside by the loop, the plan from here says what is found there.
  if (!away && actions.planFor && stage.item) {
    try { away = require('./knowledge').elsewhereOf(actions.planFor(bot, stage.item, stage.count || 1, goal), bot.game?.dimension, [{ item: stage.item, count: stage.count || 1 }]); }
    catch (_) { away = null; }
  }
  const to = away?.dimension || record?.to || (where === 'nether' ? 'overworld' : null);
  const tree = {};
  if (to && to !== where) {
    const mined = away ? Object.entries(away.mines).map(([block, n]) => `${n} ${words(block)}`).join(', ') : words(record?.block || '');
    const bring = away?.bring?.length ? away.bring : [];
    tree[`go_${to}`] = { description: `Go to the ${to} for the ${words(stage.phase)}: ${mined ? `${mined}, found only there` : 'its sources are there'}${bring.length ? `, and back with ${bring.map(i => `${i.count} ${words(i.item)}`).join(', ')}` : ''}. ${portalTrip(bot, goal)}${stage.why ? ` Here it failed so: ${stage.why}.` : ''}` };
  }
  const next = nextGameStage(bot, goal, new Set([stage.phase]));
  if (next && next.phase !== stage.phase && !['return_overworld', 'enter_nether', 'elsewhere'].includes(next.action)) {
    tree.on_here = { description: `Leave the ${words(stage.phase)} for half an hour and go on here with ${words(next.phase)}${next.item ? ` (${next.count || ''} ${words(next.item)})` : ''}; it comes back after.` };
  }
  if (!Object.keys(tree).length) throw Object.assign(new Error(`The ${words(stage.phase)} cannot be done in the ${where}, and no way to where it can is known`), { name: 'Blocked' });
  const decision = await require('./decisions').decide('rung_elsewhere', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree,
    state: { step: words(stage.phase), ...(stage.item ? { item: `${stage.count || ''} ${words(stage.item)}` } : {}), dimension: where, ...(away ? { minedElsewhere: away.mines, bringBack: away.bring } : {}), ...(record?.error ? { failure: record.error } : {}) } });
  if (decision.stale) return false;
  const pick = decision.path.at(-1);
  if (pick === 'on_here') {
    goal.elsewhere = { phase: stage.phase, pick, at: now };
    setAside(goal, 'rung', stage.phase, 'Jev chose to go on here first', ELSEWHERE_WAIT_MS);
  } else {
    // Brought back is what the other dimension gives; the whole step is
    // done there when nothing narrower is known.
    const items = away?.bring?.length ? away.bring.map(i => ({ item: i.item, count: count(bot, i.item) + i.count }))
      : record?.step?.drops ? [{ item: record.step.drops, count: count(bot, record.step.drops) + (record.step.count || 1) }] : [];
    goal.errand = { dimension: to, items, for: stage.phase, at: now };
    attemptsFor(goal).clear('rung', stage.phase); delete goal.elsewhere;
  }
  goal.step = { action: 'elsewhere', phase: stage.phase, choice: pick }; save();
  return false;
}

// The steps still open on the ladder, each with what making it takes from
// the pockets as they are: said to Jev wherever it chooses how to spend
// time, so a choice to wait is made knowing what waiting leaves undone. A
// pocket sat out a night with a stone pickaxe and no iron, three of the
// steps ahead waiting on iron, told only that the bed was next.
function rungsAhead(bot, goal = {}, planFor = null) {
  if (goal.kind !== 'win') return [];
  let rungs;
  try { rungs = openRungs(bot, goal); } catch (_) { return []; }
  const words = s => String(s || '').replaceAll('_', ' ');
  return rungs.slice(0, 4).map(rung => {
    let takes = null;
    if (planFor && rung.item) {
      try {
        const plan = planFor(bot, rung.item, rung.count || 1, goal);
        if (plan?.length) takes = plan.map(st => `${st.action.replaceAll('_', ' ')} ${st.count || 1} ${words(st.item || st.block || st.mob)}`).join(', then ');
      } catch (_) { /* no plan from here */ }
    }
    const why = require('./strategy').RUNG_WHY[rung.phase];
    return { step: words(rung.phase), ...(why ? { for: why } : {}), ...(rung.item ? { item: `${rung.count > 1 ? `${rung.count} ` : ''}${words(rung.item)}` } : {}), ...(takes ? { takes } : {}) };
  });
}

module.exports = { noteFoodTrip, settleOptIns, skipsOptional, optionalRung, optedIn, optIn, optionalRungs, levelOrder, OPT_IN_MS, rungAsideSays, portalDistance, NETHER_TRIPS, netherPaceSays, cameThrough, agoSays, asideStands, takeBackRungs, takeBackRung, pearlRouteHeld, PEARL_ROUTE_MS, portalTrip, arrivalSays, leaveNetherStep, readyForHomeStep, routeThreatsSays, netherLeaveHeld, foodTripDrives, errandStage, elsewhereStep, tallyClock, runClock, bedRung, carryBedRung, rungsAhead, timeRung, preparationRung, openRungs, rungsOpenAhead, DEFERRABLE, RUNG_BUDGET_MS, RUNG_WAIT_MS, dimension, observeProgress, watchGameProgress, verifyGameCompletion, nextGameStage, preparationStage, gameStep, asideRungs, GOING_WITHOUT };

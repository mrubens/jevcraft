'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { threats, immediateThreat, checkThreats } = require('./danger');
const shelter = require('./shelter');
const { decideTree, announceFallback } = require('./decisions');
const { maintainVitals, chooseFood, checkAir } = require('./vitals');
const { foodSupply, forageChoices } = require('./foraging');
const { bedCarried, placeOriented, isBed, homeOf, layout, homeChores } = require('./home-base');
const { readyEquipment } = require('./mob-policy');
const { verifyHouse } = require('./objectives');
const { recoverItems } = require('./recovery');
const { surveyRoute, countOf } = require('./skills');
const { defendNearby, defenseWeapon, shooter, shotTargets, shoot, lowerShield } = require('./combat');
const { reservedForConstruction } = require('./build-sites');
const { reachShore } = require('./shore');
const { surfaceObserver } = require('./surface');
const { thinking } = require('./speech');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pos = p => new Vec3(p.x, p.y, p.z);
const night = bot => bot.time?.timeOfDay >= 11500 && bot.time.timeOfDay < 23000;
// Lava within two blocks sideways or one below: a knockback lands in it.
function lavaBeside(bot, p) {
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 0; dy++) {
    if (bot.blockAt(new Vec3(p.x + dx, p.y + dy, p.z + dz))?.name === 'lava') return true;
  }
  return false;
}
// Hostiles that daylight does not remove and that keep following.
const PERSISTENT_THREATS = new Set(['creeper', 'spider', 'cave_spider', 'enderman', 'witch', 'pillager', 'vindicator', 'husk', 'drowned']);
const RANGED = new Set(['skeleton', 'stray', 'bogged', 'pillager', 'witch', 'blaze', 'ghast', 'piglin', 'breeze', 'wither_skeleton']);
const shelterNeeded = bot => bot.game.difficulty !== 'peaceful' && bot.game.dimension === 'overworld' &&
  bot.time?.timeOfDay >= 9500 && bot.time.timeOfDay < 23000;
// The server lets a player sleep from 12541 until 23458; with the only
// survival player in bed the night passes in a hundred ticks.
const SLEEP_FROM = 12541, SLEEP_UNTIL = 23458;
const sleepable = bot => bot.time?.timeOfDay >= SLEEP_FROM && bot.time.timeOfDay <= SLEEP_UNTIL;
// Three cells in a line: where the bot stands, the bed's foot, its head.
// Level floor under both bed cells, air at feet and head height.
// The bed at the base, when it stands and is within a short walk: the
// first night of run two was spent walled in two blocks from it.
// Within a short walk means within a hundred blocks: the second run walled
// itself in thirty blocks from its bed because the bed was out of view.
// A bed remembered as claimed counts while its chunk is unloaded; a bed
// seen to be gone does not.
const HOME_BED_WALK = 96;
function nearbyHomeBed(bot, goal) {
  const home = homeOf(bot, goal);
  if (!home?.bed?.claimedAt) return null;
  const { bed } = layout(home);
  const foot = pos(bed.foot), block = bot.blockAt(foot);
  if (foot.distanceTo(bot.entity.position) > HOME_BED_WALK || (block && !isBed(block))) return null;
  return { foot, head: pos(bed.head), stand: pos(bed.stand), placed: true };
}
function bedSite(bot) {
  const feet = bot.entity.position.floored();
  const floor = p => bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block';
  const free = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !/water|lava/.test(b.name); };
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const foot = feet.offset(dx, 0, dz), head = feet.offset(2 * dx, 0, 2 * dz);
    if ([foot, head].every(p => floor(p) && free(p) && free(p.offset(0, 1, 0)))) return { stand: feet, foot, head };
  }
  return null;
}
const emptySite = (bot, refuge) => refuge.kind !== 'house' && !refuge.verifiedAt &&
  shelter.shell(refuge.origin).every(p => shelter.replaceable(bot.blockAt(p)));

// Minecraft actions are injected to avoid a dependency cycle with the work
// executor. The state lives on the retained goal and can also be shared by an
// idle companion session. No survival interruption replaces the player request.
class Survival {
  constructor(bot, actions, { state, client } = {}) {
    this.bot = bot; this.actions = actions; this.client = client;
    this.state = state || { shelters: [] };
    this.state.shelters ||= [];
    if (!bot._survivalHurtListener) {
      bot._survivalHurtListener = entity => { if (entity === bot.entity) bot._recentHurtAt = Date.now(); };
      bot.on('entityHurt', bot._survivalHurtListener);
    }
  }

  currentShelter() {
    const bot = this.bot;
    return this.state.shelters.filter(s => (!(s.avoidUntil > Date.now()) || shelter.inside(bot, s)) && s.dimension === bot.game.dimension &&
      pos(s.origin).distanceTo(bot.entity.position) < 128 && bot.blockAt(pos(s.origin)) &&
      // An unfinished emergency site is useful only while nearby. After a
      // descent or a gathering trip, choose a new local site instead of hauling
      // supplies back up a tree. Retain old records to protect partial work.
      (s.verifiedAt || s.kind === 'house' || shelter.inside(bot, s) ||
        (pos(s.origin).distanceTo(bot.entity.position) <= 12 && Math.abs(s.origin.y - bot.entity.position.y) <= 3)) &&
      // A pocket well below is not worth the walk back down when a new one
      // costs five blocks: the by-hand climb lost a day's height each dusk.
      !(s.kind !== 'house' && !shelter.inside(bot, s) && s.origin.y < bot.entity.position.y - 6 && shelter.materialStock(bot) >= 16))
      .sort((a, b) => pos(a.origin).distanceTo(bot.entity.position) + (a.verifiedAt ? 0 : 32) -
        pos(b.origin).distanceTo(bot.entity.position) - (b.verifiedAt ? 0 : 32))[0];
  }

  rememberHouse(blueprint) {
    if (!blueprint || !verifyHouse(this.bot, blueprint).ok) return false;
    if (this.state.shelters.some(s => s.kind === 'house' && s.dimension === this.bot.game.dimension && pos(s.origin).equals(pos(blueprint.origin)))) return false;
    this.state.shelters.push({ kind: 'house', origin: { ...blueprint.origin }, blueprint,
      dimension: this.bot.game.dimension, verifiedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    return true;
  }

  report(goal, save, action) {
    goal.survivalAction = { ...action, at: new Date().toISOString() }; save();
  }

  async flee(task, goal, save) {
    const bot = this.bot;
    // A swing can buy room, but it must not consume the escape action. Ending
    // the turn after every hit trapped an unarmed bot in a losing melee loop.
    lowerShield(bot);
    const swung = await defendNearby(bot, task, goal, save);
    const danger = threats(bot).filter(t => t.visible);
    if (!danger.length) return;
    // A mob at arm's length is fought, swing after swing, while health holds:
    // a route search between swings is seconds of free hits, and nothing
    // outruns a zombie in a tunnel anyway. Low health falls through to the
    // escape search below.
    const armed = /_(sword|axe)$|^trident$/.test(defenseWeapon(bot)?.name || '');
    if (swung && armed && bot.health >= 8 && danger.some(t => t.distance <= 2.2)) {
      this.report(goal, save, { action: 'fight', threats: danger.filter(t => t.distance <= 2.2).map(t => t.entity.name), health: bot.health });
      return;
    }
    if (await this.rangedChoice(task, goal, save, danger, armed)) return;
    await this.escape(task, goal, save, danger, armed);
  }

  // A shooter in view at bow range, and a bow in the pack: running from a
  // skeleton is how most of the dream run's deaths went, arrows in the back.
  // Code lists the shots that have a clear arc, the retreat and the pocket;
  // Jev picks. Without Jev: shoot while health holds and nothing is at arm's
  // length, otherwise retreat. A melee mob within three blocks is the swing
  // and escape rules' business, not a moment to draw a bow.
  async rangedChoice(task, goal, save, danger, armed) {
    const bot = this.bot;
    if (bot.health < 8 || danger.some(t => t.distance <= 3 && !shooter(t.entity))) return false;
    const targets = shotTargets(bot, danger).slice(0, 3);
    if (!targets.length) return false;
    const tree = {};
    for (const t of targets) tree[`shoot_${t.entity.id}`] = { description: { action: 'Shoot this mob with the bow from where the bot stands. It is in clear view at bow range and shoots back; each arrow takes about a second to draw, standing still.',
      entity: t.entity.name, distance: Math.round(t.distance), arrowsCarried: countOf(bot, 'arrow') }, run: () => this.shootAt(task, goal, save, t) };
    tree.retreat = { description: 'Run for footing out of its range and out of its sight; the mob keeps shooting while the bot runs.', run: () => this.escape(task, goal, save, danger, armed) };
    if (shelter.materialStock(bot) >= 12) tree.dig_in = { description: 'Seal a two-block pocket where the bot stands and wait for it to lose interest.', run: () => this.sealHere(task, goal, save, danger) };
    const state = { health: bot.health, food: bot.food, arrowsCarried: countOf(bot, 'arrow'), recentSurvivalAction: goal.survivalAction,
      threats: danger.map(t => ({ name: t.entity.name, distance: Math.round(t.distance), shoots: shooter(t.entity) })) };
    const fallback = children => bot.health >= 12 ? Object.keys(children)[0] : 'retreat';
    const decision = await this.decide(task, goal, save, { state, tree, fallback, kind: 'survival',
      isFresh: () => Math.abs(bot.health - state.health) < 4 && targets.some(t => bot.entities[t.entity.id] === t.entity && t.entity.isValid !== false) });
    if (decision.stale) return true;
    await decision.action.run();
    return true;
  }

  async shootAt(task, goal, save, threat) {
    const bot = this.bot, target = threat.entity;
    this.report(goal, save, { action: 'shoot', target: target.name, entityId: target.id, distance: Number(threat.distance.toFixed(1)), arrows: countOf(bot, 'arrow'), health: bot.health });
    // The target is the point; the draw stops only for a melee mob closing
    // to arm's length, which the next loop meets with the sword.
    const threatCheck = b => {
      if (threats(b, 3).some(t => t.entity !== target && !shooter(t.entity) && (t.visible || t.distance <= 2))) throw Object.assign(new Error('A mob closed to arm\'s length during the draw'), { name: 'ShotInterrupted' });
    };
    try {
      const shot = await shoot(bot, task, target, { threatCheck });
      goal.survivalAction = { ...goal.survivalAction, released: true, arrowId: shot.arrowId, ticks: Number(shot.ticks.toFixed(1)), at: new Date().toISOString() }; save();
    } catch (err) {
      task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err;
      goal.survivalAction = { ...goal.survivalAction, released: false, reason: err.message, at: new Date().toISOString() }; save();
    }
    delete this.state.trappedSince;
  }

  async escape(task, goal, save, danger, armed) {
    const bot = this.bot;
    lowerShield(bot);
    this.report(goal, save, { action: 'escape_threat', threats: danger.map(t => ({ name: t.entity.name, distance: t.distance })) });
    const movements = bot.pathfinder.movements;
    const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
    Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
    try {
      const ids = ['grass_block', 'dirt', 'stone', 'sand', 'gravel', 'cobblestone'].map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
      const distance = p => Math.min(...danger.map(t => t.entity.position.distanceTo(p)));
      // A creeper does not burn off at dawn and follows to about sixteen
      // blocks. A six-block hop from one only buys a minute before it is back
      // at the same tree; the escape from a mob that persists has to reach
      // past its follow range, or the same creeper interrupts all morning.
      const persistent = danger.some(t => PERSISTENT_THREATS.has(t.entity.name));
      const footing = bot.findBlocks({ matching: ids, maxDistance: persistent ? 40 : 20, count: 512,
        useExtraInfo: b => shelter.solid(b) && shelter.replaceable(bot.blockAt(b.position.offset(0, 1, 0))) && shelter.replaceable(bot.blockAt(b.position.offset(0, 2, 0))),
      }).map(p => p.offset(0, 1, 0)).filter(p => !(this.state.failedEscapes?.[`${p}`] > Date.now() - 60000) && !lavaBeside(bot, p));
      const gaining = p => distance(p) >= distance(bot.entity.position) + 4;
      // Beside lava, one knockback is the end: the dream run died that way at
      // its pouring spot, in full iron, with the diamond pickaxe. Get two
      // blocks from the lava first, whatever the mob does meanwhile.
      if (lavaBeside(bot, bot.entity.position.floored())) {
        const dry = footing.filter(p => p.distanceTo(bot.entity.position) <= 8).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
        for (const p of dry.slice(0, 6)) {
          const route = await surveyRoute(bot, task, movements, new goals.GoalBlock(p.x, p.y, p.z), 150);
          if (route.status !== 'success') continue;
          this.report(goal, save, { action: 'leave_lava_edge', destination: { ...p }, threats: danger.map(t => t.entity.name) });
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(p.x, p.y, p.z), { timeoutMs: 5000, stallMs: 2000 }); } catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; }
          return;
        }
      }
      // The far spots first when the chaser persists; the ordinary hop is the
      // fallback, because standing still beside a creeper is never the answer.
      const far = persistent ? footing.filter(p => p.distanceTo(bot.entity.position) >= 20 && distance(p) >= 20).sort((a, b) => distance(b) - distance(a)) : [];
      const near = footing.filter(p => p.distanceTo(bot.entity.position) >= 6 && gaining(p)).sort((a, b) => distance(b) - distance(a));
      const candidates = [...far.slice(0, 12), ...near.slice(0, 12)];
      for (const p of candidates) {
        const destination = new goals.GoalBlock(p.x, p.y, p.z);
        const route = await surveyRoute(bot, task, movements, destination, 150);
        if (route.status !== 'success') continue;
        // Do not run through another hostile to escape the closest one.
        if (route.path.some(point => danger.some(t => t.entity.position.distanceTo(pos(point)) < Math.min(4, t.distance - 1)))) continue;
        try { await this.actions.navigate(bot, task, destination, { timeoutMs: persistent ? 14000 : 7000, stallMs: 3000 }); delete this.state.trappedSince; return; }
        catch (err) {
          task.check(); if (err.name === 'NeedsAir') throw err;
          this.state.failedEscapes ||= {}; this.state.failedEscapes[`${p}`] = Date.now(); save();
          // Reobserve positions after a partial escape instead of running the
          // next stale route against the old mob positions.
          return;
        }
      }
      // Cornered with stone in hand: a wall between us and the mob beats a
      // hold. Only the cell one step toward it, and only while that cell is
      // still empty; a mob already in it is fought, not walled.
      // A wall on one side is not cover: a skeleton shot the bot while it
      // hid from a piglin. With a ranged mob in view and no way out, close
      // every open side into a two-block pocket and let it pass. Against a
      // melee mob alone, the single wall toward it is enough.
      const nearest = danger[0];
      if (danger.some(t => RANGED.has(t.entity.name)) && await this.sealHere(task, goal, save, danger)) { delete this.state.trappedSince; return; }
      if (await this.wallOff(task, goal, save, danger)) { delete this.state.trappedSince; return; }
      // No way out and a mob a few blocks off, shooting: standing still is
      // how a crossbow piglin took half the bot's health. Armed and able,
      // close the gap so the fight rule can do its work.
      if (armed && bot.health >= 12 && nearest.distance > 2.2 && nearest.distance <= 8 && !lavaBeside(bot, nearest.entity.position.floored())) {
        this.report(goal, save, { action: 'charge', target: nearest.entity.name, distance: Number(nearest.distance.toFixed(1)) });
        const t = nearest.entity.position;
        try { await this.actions.navigate(bot, task, new goals.GoalNear(t.x, t.y, t.z, 1), { timeoutMs: 4000, stallMs: 2000 }); }
        catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; }
        await defendNearby(bot, task, goal, save);
        delete this.state.trappedSince; return;
      }
      // In a narrow tunnel, wait for the next bounded defensive action rather
      // than spending five failed route searches while a mob hits us. The
      // encounter still has a deadline and reports a concrete blocker.
      this.state.trappedSince ||= Date.now();
      if (Date.now() - this.state.trappedSince > 30000) {
        const error = new Error('No safe escape after 30 seconds of defending the constrained position'); error.name = 'Blocked'; throw error;
      }
      this.report(goal, save, { action: 'hold_defensive_position', threats: danger.map(t => t.entity.name),
        reason: 'No safe retreat; defend visible hostiles that enter reach' });
      for (let n = 0; n < 2; n++) { task.check(); checkAir(bot); await sleep(100); }
    } finally { Object.assign(movements, previous); bot.clearControlStates(); }
  }

  // A saved shelter is only useful if there is a way to it. Forty blocks up
  // a shaft at dusk, the surface shelter from last night is not a shelter,
  // and the dream run spent a whole night failing to path to it. One that
  // cannot be reached is set aside for a while so a pocket can be sealed
  // where the bot stands.
  async reachableRefuge(task, goal, save, refuge) {
    const bot = this.bot;
    if (!refuge || shelter.inside(bot, refuge)) return refuge;
    const o = pos(refuge.origin);
    if (o.distanceTo(bot.entity.position) <= 6 || !bot.pathfinder?.movements) return refuge;
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalNear(o.x, o.y, o.z, 2), 400);
    if (route.status === 'success') return refuge;
    refuge.avoidUntil = Date.now() + 600000;
    this.report(goal, save, { action: 'shelter_unreachable', origin: refuge.origin, reason: route.status });
    return null;
  }

  async refugeStep(task, goal, save) {
    const bot = this.bot;
    if (await reachShore(bot, task, goal, save, { move: this.actions.navigate })) return;
    let refuge = await this.reachableRefuge(task, goal, save, this.currentShelter());
    if (!refuge) {
      // Beside a lava lake nothing within twelve blocks has a safe shell;
      // look further before giving the night up as unsafe.
      let sites = shelter.shelterSites(bot, goal);
      if (!sites.length) sites = shelter.shelterSites(bot, goal, 32);
      let site;
      for (const p of sites) {
        if ((await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalBlock(p.x, p.y, p.z), 150)).status === 'success') { site = p; break; }
      }
      if (!site) throw new Error('No reachable, supported 3 by 3 shelter site observed');
      refuge = { origin: { ...site }, dimension: bot.game.dimension, createdAt: new Date().toISOString() };
      this.state.shelters.push(refuge); save();
    }
    const missing = shelter.missingShell(bot, refuge);
    const stock = shelter.materialStock(bot);
    // Navigation can consume scaffold blocks or clear natural walls. Keep a
    // small travel reserve, then recheck the actual shell after entering.
    const required = missing.length + (shelter.inside(bot, refuge) ? 0 : 4);
    if (stock < required) {
      // A site selected above a mining pocket can reserve every block needed
      // to escape it. Reach that still-empty site before searching for supplies;
      // approachRefuge relaxes only this reservation and restores it afterwards.
      if (bot.entity.position.y < refuge.origin.y && emptySite(bot, refuge)) {
        this.report(goal, save, { action: 'return_to_surface', target: refuge.origin });
        task.interruptCheck = () => checkThreats(bot);
        try {
          const o = refuge.origin;
          await this.approachRefuge(task, goal, refuge, new goals.GoalBlock(o.x, o.y, o.z));
        } finally { task.interruptCheck = undefined; }
        return;
      }
      if (shelter.inside(bot, refuge)) {
        await this.leave(task, goal, save, refuge);
        if (shelter.inside(bot, refuge)) return;
      }
      this.report(goal, save, { action: 'gather_shelter_materials', need: required, carried: stock, origin: refuge.origin });
      task.interruptCheck = () => checkThreats(bot);
      try {
        const supply = shelter.supplyTarget(bot, required - stock);
        await this.actions.acquireStep(bot, task, supply.item, supply.count, goal, save,
          { minimumMiningY: Math.min(refuge.origin.y, bot.entity.position.floored().y) - 1 });
      } finally { task.interruptCheck = undefined; }
      return;
    }
    if (!shelter.inside(bot, refuge)) {
      // Reenter a previously sealed room through a verified two-block exit.
      if (shelter.sealed(bot, refuge)) {
        const exit = shelter.exits(bot, refuge).sort((a, b) => a.outside.distanceTo(bot.entity.position) - b.outside.distanceTo(bot.entity.position))[0];
        if (!exit) throw new Error('The saved shelter has no safe approach');
        await this.actions.navigate(bot, task, new goals.GoalBlock(exit.outside.x, exit.outside.y, exit.outside.z), { timeoutMs: 20000 });
        await this.actions.dig(bot, task, exit.door.offset(0, 1, 0), { requireDrops: false });
        await this.actions.dig(bot, task, exit.door, { requireDrops: false });
      }
      const o = pos(refuge.origin);
      await this.approachRefuge(task, goal, refuge, new goals.GoalBlock(o.x, o.y, o.z));
    }
    if (shelter.materialStock(bot) < shelter.missingShell(bot, refuge).length) return;
    this.report(goal, save, { action: 'seal_shelter', origin: refuge.origin });
    const threat = immediateThreat(bot);
    const blocks = shelter.missingShell(bot, refuge).sort((a, b) => {
      // Finish a full-height wall on the threat-facing side first. Roof comes
      // last so every placement has a solid adjacent anchor.
      const rank = p => p.y < refuge.origin.y
        ? -1000 + Math.abs(p.x - refuge.origin.x) + Math.abs(p.z - refuge.origin.z)
        : (p.y === refuge.origin.y + 2 ? 1000 : 0) +
          (threat ? Math.hypot(p.x - threat.entity.position.x, p.z - threat.entity.position.z) * 10 : 0) + p.y - refuge.origin.y;
      return rank(a) - rank(b);
    });
    for (const p of blocks) {
      task.check(); checkAir(bot);
      const material = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name))?.name;
      if (!material) throw new Error('Shelter material inventory changed before sealing');
      // Snow/vegetation is being cleared to seal a room, not harvested. A
      // shovel must not become a prerequisite for emergency shelter.
      if (!['air', 'cave_air', 'void_air'].includes(bot.blockAt(p)?.name)) await this.actions.dig(bot, task, p, { requireDrops: false });
      try { await this.actions.place(bot, task, p, material); }
      catch (err) {
        task.check();
        // Reaching a placement can spend the selected block as scaffolding.
        // Other shelter blocks may still be available: reobserve the shell
        // and choose from current inventory on the next bounded step.
        if (err.name === 'Blocked' && !bot.inventory.items().some(i => i.name === material && i.count > 0) && shelter.materialStock(bot) > 0) {
          save(); return;
        }
        throw err;
      }
      save();
    }
    if (!shelter.inside(bot, refuge) || !shelter.sealed(bot, refuge)) throw new Error('Shelter verification failed');
    refuge.verifiedAt = new Date().toISOString();
    this.report(goal, save, { action: 'sheltered', origin: refuge.origin, health: bot.health });
  }

  async approachRefuge(task, goal, refuge, destination) {
    const bot = this.bot, movement = bot.pathfinder?.movements;
    const previous = movement?.exclusionAreasBreak;
    // Selecting a still-empty surface site must not forbid excavating the
    // natural approach beneath it. That reservation used to invalidate the
    // very route which had just selected the site from an underground start.
    // Existing/partial walls and every other construction remain protected.
    if (emptySite(bot, refuge) && movement && bot._constructionProtection) {
      const approaching = { ...goal, survival: { ...this.state, shelters: this.state.shelters.filter(s => s !== refuge) } };
      movement.exclusionAreasBreak = (previous || []).filter(rule => rule !== bot._constructionProtection);
      movement.exclusionAreasBreak.push(block => reservedForConstruction(approaching, block.position) ? 100 : 0);
    }
    try { await this.actions.navigate(bot, task, destination, { timeoutMs: 20000 }); }
    finally { if (movement) movement.exclusionAreasBreak = previous; }
  }

  // Shot at with no way out: build the whole shell where the bot stands and
  // register it as tonight's pocket, so the next loop sees a sealed shelter
  // and waits inside until nothing is watching, instead of digging straight
  // back out into the arrows. The eighth death was exactly that.
  async sealHere(task, goal, save, danger) {
    const bot = this.bot;
    if (shelter.materialStock(bot) < 12) return this.digIn(task, goal, save, danger);
    const origin = bot.entity.position.floored();
    let refuge = this.state.shelters.find(s => s.origin.x === origin.x && s.origin.y === origin.y && s.origin.z === origin.z && s.dimension === bot.game.dimension);
    if (!refuge) { refuge = { origin: { ...origin }, dimension: bot.game.dimension, createdAt: new Date().toISOString(), emergency: true }; this.state.shelters.push(refuge); save(); }
    this.report(goal, save, { action: 'dig_in', threats: danger.map(t => t.entity.name), cells: shelter.missingShell(bot, refuge).length });
    // The nearest cells first: the ones a mob could step into.
    const material = () => bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name))?.name;
    const cells = shelter.missingShell(bot, refuge).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    for (const p of cells) {
      task.check();
      const name = material(); if (!name) break;
      if (danger.some(t => t.entity.position.floored().equals(p))) continue;
      try { await this.actions.place(bot, task, p, name); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
    }
    if (shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)) { refuge.verifiedAt = new Date().toISOString(); save(); }
    return true;
  }

  async digIn(task, goal, save, danger) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function') return false;
    const material = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name) && i.count >= 4)?.name;
    if (!material) return false;
    const feet = bot.entity.position.floored();
    const cells = [];
    for (const d of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) for (const dy of [0, 1]) {
      const p = feet.plus(d).offset(0, dy, 0);
      if (shelter.replaceable(bot.blockAt(p)) && !danger.some(t => t.entity.position.floored().equals(p))) cells.push(p);
    }
    if (shelter.replaceable(bot.blockAt(feet.offset(0, 2, 0)))) cells.push(feet.offset(0, 2, 0));
    if (!cells.length) return false;
    this.report(goal, save, { action: 'dig_in', threats: danger.map(t => t.entity.name), cells: cells.length });
    let placed = 0;
    for (const p of cells) {
      task.check();
      try { await this.actions.place(bot, task, p, material); placed++; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
    }
    return placed > 0;
  }

  async wallOff(task, goal, save, danger) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function') return false;
    const material = bot.inventory.items().find(i => shelter.buildingMaterials.has(i.name) && i.count >= 2)?.name;
    if (!material) return false;
    const feet = bot.entity.position.floored();
    const walls = [];
    for (const t of danger) {
      if (t.distance > 6) continue;
      const dx = t.entity.position.x - bot.entity.position.x, dz = t.entity.position.z - bot.entity.position.z;
      const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
      if (!step.x && !step.z) continue;
      const cell = feet.plus(step);
      if (walls.some(w => w.equals(cell))) continue;
      // Empty cell, and the mob not standing in it.
      if (![cell, cell.offset(0, 1, 0)].every(p => shelter.replaceable(bot.blockAt(p)))) continue;
      if (t.entity.position.floored().equals(cell) || t.entity.position.distanceTo(cell.offset(0.5, 0, 0.5)) < 0.9) continue;
      walls.push(cell);
    }
    if (!walls.length) return false;
    this.report(goal, save, { action: 'wall_off', threats: danger.map(t => t.entity.name), cells: walls.map(p => ({ ...p })) });
    for (const cell of walls) {
      for (const p of [cell, cell.offset(0, 1, 0)]) {
        task.check();
        try { await this.actions.place(bot, task, p, material); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; return walls.length > 0 && p !== cell; }
      }
    }
    return true;
  }

  async leave(task, goal, save, refuge, reason) {
    const bot = this.bot;
    // "Morning. Back to it." only when it is morning; a shelter left at
    // night for the bed, or with mobs outwaited, says so.
    reason ||= shelterNeeded(bot) ? 'Moving on.' : undefined;
    // Mobs that can see in, or are at the wall; the rest are behind rock.
    const danger = threats(bot).filter(t => t.visible || t.distance < 6);
    const formal = shelter.exits(bot, refuge).filter(exit => danger.every(t => t.entity.position.distanceTo(exit.outside) > 20));
    // A pocket sealed in a staircase has no two-block exit: its door is the
    // closure the bot placed, and the way on is dug from there.
    const pocket = !formal.length && shelter.closures(bot, refuge).filter(door => danger.every(t => t.entity.position.distanceTo(door) > 20));
    const exit = formal[0] || (pocket.length ? { door: pocket[0], outside: null } : null);
    if (!exit) { await this.wait(task, goal, save, 'Nearby threats still block the shelter exits'); return; }
    this.report(goal, save, { action: 'leave_shelter', origin: refuge.origin, reason });
    // Opening our temporary closure is necessary even if the last pick broke.
    // Bare-handed stone clearing loses its drop but must not imprison the bot
    // inside a one-cell shelter with no room to place a crafting table.
    // A pocket is one night's stop, not a home: every closure comes down so
    // the staircase continues in both directions, and the pocket is
    // forgotten so its shell no longer stands reserved against the climb.
    const doors = exit.outside ? [exit.door] : pocket;
    for (const door of doors) {
      await this.actions.dig(bot, task, door.offset(0, 1, 0), { requireDrops: false });
      await this.actions.dig(bot, task, door, { requireDrops: false });
    }
    // Any dug-in shelter is one night's stop: left behind, it is forgotten,
    // so its shell no longer stands reserved against the next staircase.
    // Only a house persists. The bot bounced between the two floor cells of
    // a pocket it had just left, every other cell around it reserved.
    if (refuge.kind !== 'house') { this.state.shelters = this.state.shelters.filter(s => s !== refuge); save(); }
    if (exit.outside) await this.actions.navigate(bot, task, new goals.GoalBlock(exit.outside.x, exit.outside.y, exit.outside.z), { timeoutMs: 10000 });
  }

  // One Jev decision over a tree the code built, recorded with the state
  // and the options so the Observatory can show what was asked. Without a
  // client the fallback rule walks the tree, as it does during an outage.
  async decide(task, goal, save, { state, tree, fallback, kind, isFresh = () => true, interrupt = () => {} }) {
    const bot = this.bot;
    let decision;
    if (!this.client) {
      const key = fallback(tree, []);
      decision = { path: [key], action: tree[key].children ? Object.values(tree[key].children)[0] : tree[key] };
    } else {
      const controller = new AbortController();
      const watcher = setInterval(() => { try { task.check(); checkAir(bot); interrupt(); } catch (err) { controller.abort(err); } }, 100);
      const stopThinking = thinking(bot);
      try { decision = await decideTree(this.client, { state, tree, signal: controller.signal, fallback, kind, isFresh }); }
      finally { clearInterval(watcher); stopThinking(); }
      task.check(); checkAir(bot); interrupt();
      announceFallback(bot, goal, decision);
    }
    if (!decision.stale && decision.action.valid && !decision.action.valid()) decision.stale = true;
    goal.decisions ||= [];
    goal.decisions.push({ at: new Date().toISOString(), path: decision.path, state, options: JSON.parse(JSON.stringify(tree)),
      latencyMs: decision.latencyMs, usage: decision.usage, judgments: decision.judgments, stale: decision.stale, fallback: decision.fallback });
    goal.decisions = goal.decisions.slice(-40); save();
    return decision;
  }

  // The carried bed goes down where the night caught us and comes back up
  // at dawn. A sleep the server refuses (a mob within eight blocks, another
  // survival player awake) hands the night to the shelter path instead.
  async sleepStep(task, goal, save) {
    const bot = this.bot, item = bedCarried(bot), placed = nearbyHomeBed(bot, goal), site = placed || (item && bedSite(bot));
    if (!site) throw new Error('No level ground beside me for the bed');
    this.report(goal, save, { action: 'sleep', at: { ...site.foot }, home: !!placed });
    if (placed) {
      // A walk that fails is a route problem, not a bed problem: the shelter
      // path takes this night's next two minutes, and the bed stays in play.
      // The stand cell first (it is laid out to be reachable), then two and
      // three blocks from the foot: a single goal failed from twenty blocks.
      const approaches = [[site.stand, 1], [site.foot, 2], [site.foot, 3]];
      let reached = false, lastError = null;
      for (const [p, range] of approaches) {
        try { await this.actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, range), { timeoutMs: 45000, stallMs: 8000 }); reached = site.foot.distanceTo(bot.entity.position) <= 3.5; }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; lastError = err; }
        if (reached) break;
      }
      if (!reached) { this.state.bedRouteFailedAt = Date.now(); this.report(goal, save, { action: 'sleep_failed', reason: `no way to the bed: ${lastError?.message || 'not close enough'}` }); throw lastError || new Error('No way to the bed'); }
      if (!isBed(bot.blockAt(site.foot))) throw new Error('The bed at the base is not where it was left');
    }
    else await placeOriented(bot, task, this.actions, site.stand, site.foot, item, () => isBed(bot.blockAt(site.foot)) && isBed(bot.blockAt(site.head)));
    let slept = false;
    try {
      // The server confirms the sleep a moment after the click, and refuses
      // it with a message. The first bedtime read the flag before either
      // arrived and built a shelter beside the bed.
      let refused = null;
      const onMessage = message => { const key = message?.json?.translate || message?.translate || String(message || ''); if (/bed\.(not_safe|too_far_away|obstructed|occupied|no_sleep)/.test(key)) refused = key; };
      bot.on?.('message', onMessage);
      try {
        const before = bot.time?.timeOfDay;
        await bot.sleep(bot.blockAt(site.foot));
        // The ground truth is the clock: with the only survival player in
        // bed the server jumps to morning within a hundred ticks. The
        // sleeping flag is a hint, and a refusal is only final once the
        // clock has had its chance.
        const started = Date.now(), jumped = () => !sleepable(bot) || bot.time?.timeOfDay < before;
        while (Date.now() - started < 15000 && !jumped() && !(refused && Date.now() - started > 6000)) { task.check(); await sleep(200); }
        slept = jumped();
        if (bot.isSleeping) { try { await bot.wake(); } catch (_) {} }
        if (!slept && refused) throw new Error(`The server refused the sleep: ${refused}`);
        if (!slept) throw new Error('The night did not pass in bed');
      } finally { bot.removeListener?.('message', onMessage); }
    } catch (err) { task.check(); this.state.sleepFailedAt = Date.now(); this.state.lastSleepError = err.message; this.report(goal, save, { action: 'sleep_failed', reason: err.message }); }
    finally {
      // The carried bed comes back up; the base's bed stays where it is.
      if (!placed) {
        for (const p of [site.foot, site.head]) if (isBed(bot.blockAt(p))) { try { await this.actions.dig(bot, task, p, { requireDrops: false }); } catch (_) { task.check(); } }
        await sleep(800);
        if (!bedCarried(bot)) { try { await this.actions.navigate(bot, task, new goals.GoalNear(site.foot.x, site.foot.y, site.foot.z, 0.5), { timeoutMs: 4000, stallMs: 2000 }); await sleep(600); } catch (_) { task.check(); } }
      }
      save();
    }
    if (!slept) throw new Error(this.state.lastSleepError || 'The night did not pass in bed');
    delete this.state.sleepFailedAt; delete this.state.nightPlan;
    this.report(goal, save, { action: 'leave_shelter', reason: 'Morning. Back to it.' });
  }

  async wait(task, goal, save, reason = 'Waiting for daylight inside the verified shelter') {
    this.report(goal, save, { action: 'wait_in_shelter', reason });
    for (let i = 0; i < 50; i++) { task.check(); await sleep(100); }
  }

  async step(task, goal, save, onStep = () => {}) {
    const bot = this.bot;
    goal.survival = this.state;
    task.interruptCheck = undefined;
    // A shield raised to cover the last shot comes down at the next look:
    // every branch below may walk, and a raised shield is sneaking speed.
    lowerShield(bot);
    if (bot.game.gameMode === 'creative') {
      await recoverItems(bot, task, this.state.recovery, save, this.actions.navigate);
      return false;
    }
    if (this.rememberHouse(goal.blueprint)) save();
    await maintainVitals(bot, task, action => this.report(goal, save, action));
    const refuge = this.currentShelter();
    if (refuge && shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)) {
      delete this.state.trappedSince;
      // A mob behind twenty blocks of rock is not a reason to stay sealed in
      // past dawn: underground there is always one somewhere. Wait for the
      // ones that can see in, or are at the wall.
      // Cave mobs do not burn off at dawn. A mob that can see in keeps the
      // bot inside for a few minutes, not the whole day: after that it leaves
      // armed and lets the fight-or-flee rules take over.
      const watched = !shelterNeeded(bot) && threats(bot).some(t => t.distance < 20 && (t.visible || t.distance < 6));
      if (watched) this.state.watchedSince ||= Date.now(); else delete this.state.watchedSince;
      const outwaited = watched && Date.now() - this.state.watchedSince > 180000;
      // A sealed pocket within a walk of the base's bed is left for it: the
      // night passes in the bed, not behind the wall.
      // Only from a pocket on the surface: a walk to the bed from a pocket
      // down a shaft fails, and the night is better spent behind the wall.
      // From the surface, or from a pocket within ten blocks of the bed's
      // level (the stairs' last stretch): open the pocket and let the
      // go-home rule climb and walk. From deep down, the night is better
      // spent behind the wall.
      const homeBed = sleepable(bot) && !watched && !(this.state.sleepFailedAt > Date.now() - 600000) && !(this.state.bedRouteFailedAt > Date.now() - 120000) && nearbyHomeBed(bot, goal);
      const shallow = homeBed && (surfaceObserver(bot)(bot.entity.position) || Math.abs(homeBed.foot.y - bot.entity.position.y) <= 10);
      if (shallow) { delete this.state.watchedSince; await this.leave(task, goal, save, refuge, 'Off to bed.'); }
      else if ((shelterNeeded(bot) || watched) && !outwaited) await this.wait(task, goal, save);
      else { delete this.state.watchedSince; await this.leave(task, goal, save, refuge); }
      onStep(goal); return true;
    }
    const emergency = immediateThreat(bot);
    if (emergency) {
      // Sealing a nearby prepared site is faster than a long retreat. Otherwise
      // get clear first; ordinary digging must never continue under fire.
      // With a mob already at arm's length there is no sealing it out: the
      // third death was six zombies in the shell cells and a bot placing
      // blocks against them until its health ran out.
      const adjacent = threats(bot).some(t => t.visible && t.distance <= 2.2);
      if (!adjacent && refuge && pos(refuge.origin).distanceTo(bot.entity.position) < 3 && shelter.materialStock(bot) >= shelter.missingShell(bot, refuge).length) await this.refugeStep(task, goal, save);
      else await this.flee(task, goal, save);
      onStep(goal); return true;
    }
    delete this.state.trappedSince;
    // A bed in the pockets moves the whole question to bedtime: no site to
    // reserve at 9500, no blocks to gather, and at 12541 the choice is
    // sleep, or stay up armed because the dark is what the request needs.
    const bed = bedCarried(bot), homeBed = nearbyHomeBed(bot, goal);
    const routeBlocked = this.state.bedRouteFailedAt > Date.now() - 120000;
    const underground = bot.game.dimension === 'overworld' && !surfaceObserver(bot)(bot.entity.position);
    const bedReady = (!!bed || (!!homeBed && !routeBlocked)) && bot.game.dimension === 'overworld' && !(this.state.sleepFailedAt > Date.now() - 600000);
    // Dusk with a bed at home: head there before bedtime rather than start
    // the walk from the bottom of a shaft at 12541. The second run chose the
    // bed thirty blocks down its mine and the walk failed at once.
    // A failed direct walk pauses the walk, not the climb: the stairs out
    // of a shaft are a different route from a path search to the bed.
    // Home before bedtime: wait by the bed rather than hand the minute back
    // to the work loop, which dived to the lava site and was climbed out of
    // again every ten seconds until 12541.
    if (homeBed && shelterNeeded(bot) && bot.time.timeOfDay >= 11000 && bot.time.timeOfDay < SLEEP_FROM && homeBed.foot.distanceTo(bot.entity.position) <= 6 && !immediateThreat(bot)) {
      // The minute before bedtime is a chore, not a wait: the stash, the
      // wheat, the cows; and once, the plot grows a column for the next day.
      const chores = homeChores(bot, goal);
      const chore = ['stock_stash', 'harvest_and_bake', 'tend_farm', 'breed_cows'].map(k => chores[k]).find(Boolean) || Object.values(chores)[0];
      const home = homeOf(bot, goal);
      if (chore) {
        this.report(goal, save, { action: 'evening_chore', chore: Object.keys(chores).find(k => chores[k] === chore) });
        try { await chore.run(bot, task, goal, save, this.actions); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      } else if (home?.completedAt && !home.plotWide) {
        home.plotWide = true; save();
        this.report(goal, save, { action: 'grow_plot' });
      } else {
        this.report(goal, save, { action: 'wait_for_bedtime', ticks: SLEEP_FROM - bot.time.timeOfDay });
        for (let i = 0; i < 10; i++) { task.check(); await sleep(100); }
      }
      onStep(goal); return true;
    }
    const homeWalk = homeBed && shelterNeeded(bot) && homeBed.foot.distanceTo(bot.entity.position) > 6 && !immediateThreat(bot) && (underground || !routeBlocked);
    if (homeWalk && (bot.time.timeOfDay >= 11000 || underground) && !(this.state.sleepFailedAt > Date.now() - 600000)) {
      this.report(goal, save, { action: 'go_home_for_night', distance: Math.round(homeBed.foot.distanceTo(bot.entity.position)), underground });
      // Out of the shaft by the stairs it dug, then home over the ground:
      // a path search from the bottom of a mine to a bed timed out. A
      // stumble on the stairs is retried next tick; only the walk itself
      // failing sets the bed aside, and only for two minutes.
      if (underground && this.actions.surfaceStep) {
        try { await this.actions.surfaceStep(bot, task, goal, save); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      } else if (bot.time.timeOfDay < SLEEP_FROM) {
        try { await this.actions.navigate(bot, task, new goals.GoalNear(homeBed.foot.x, homeBed.foot.y, homeBed.foot.z, 3), { timeoutMs: 60000, stallMs: 8000 }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; this.state.bedRouteFailedAt = Date.now(); }
      }
      if (underground || bot.time.timeOfDay < SLEEP_FROM) { onStep(goal); return true; }
    }
    const plan = this.state.nightPlan?.until > Date.now() ? this.state.nightPlan : null;
    const stayingUp = plan?.plan === 'stay_up';
    // Before bedtime, a bed anywhere in reach (a walk that just failed
    // included) means no sealing in yet: the walk is retried in two minutes
    // and the shelter thirty blocks from the bed was the worse night.
    const bedInReach = (!!bed || !!homeBed) && bot.game.dimension === 'overworld';
    const needsShelter = shelterNeeded(bot) && !(bedInReach && bot.time.timeOfDay < SLEEP_FROM) && !stayingUp;
    // A shelter once chosen is a plan, not a question for every tick: the
    // second run climbed its shaft for a shelter, was asked again at the
    // top, went back down to the mine, and was asked again at the bottom.
    if (needsShelter && plan?.plan === 'shelter' && !(bedReady && sleepable(bot))) { await this.refugeStep(task, goal, save); onStep(goal); return true; }
    if (!needsShelter && this.state.recovery?.status === 'pending') {
      this.report(goal, save, { action: 'recover_items', origin: this.state.recovery.position });
      if (await recoverItems(bot, task, this.state.recovery, save, this.actions.navigate)) { onStep(goal); return true; }
    }
    const expeditionFood = (goal.preparingExpedition || goal.preparingEnd) && bot.game.difficulty !== 'peaceful';
    const desiredFood = goal.preparingEnd ? 64 : 12;
    // A missing reserve is worth a hunt while the bot is already on the
    // surface, where the animals are. Underground it is worth the climb only
    // once hunger is real: the dream run was leaving its iron shaft at 18 of
    // 20 to walk the surface for a chicken.
    // Off the Overworld there is nothing to hunt and nowhere to climb to:
    // food is a reason to go back through the portal, and only real hunger.
    const offWorld = !/overworld/.test(String(bot.game.dimension || 'overworld'));
    const hungerTrigger = offWorld ? 8 : surfaceObserver(bot)(bot.entity.position) ? 18 : 12;
    // A reserve is worth a few minutes of looking, not the whole day: a
    // stock-driven search that finds nothing in five minutes is set aside for
    // twenty, and only real hunger forages meanwhile. The seventh climb spent
    // half an hour on a bare mountain searching for a chicken at full hunger.
    const hungry = bot.food <= hungerTrigger;
    const stockDriven = !offWorld && (goal.stockFood || expeditionFood || (goal.kind === 'survive' && bot.game.difficulty !== 'peaceful'));
    const now = Date.now();
    if (foodSupply(bot) >= desiredFood) delete this.state.foodSearch;
    if (!hungry && stockDriven && foodSupply(bot) < desiredFood) {
      const search = this.state.foodSearch ||= { since: now };
      if (this.state.foodStockPausedUntil > now) { /* paused */ }
      else if (now - search.since > 300000) { this.state.foodStockPausedUntil = now + 1200000; delete this.state.foodSearch; save(); }
    }
    const stockPaused = this.state.foodStockPausedUntil > now;
    const needsFood = foodSupply(bot) < desiredFood && (hungry || (stockDriven && !stockPaused));
    if (!needsShelter && !needsFood) return false;
    const state = { playerRequest: goal.request, retainedGoal: goal.kind, timeOfDay: bot.time.timeOfDay,
      playerUrgency: goal.urgency ? { level: goal.urgency.level, meaning: 'How much the wording of the request pressed for speed: relaxed, ordinary or pressed. Pressure is a reason to keep working while it is still safe, never a reason to skip shelter once night is close.' } : undefined,
      health: bot.health, food: bot.food, safeFoodCarried: !!chooseFood(bot),
      survivalFacts: { difficulty: bot.game.difficulty, hostileMobsSpawnAtNight: true,
        nightStartsAt: 11500, dawnAt: 23000, daylightTicksRemaining: Math.max(0, 11500 - bot.time.timeOfDay),
        bedCarried: !!bed, homeBedNearby: !!homeBed, sleepPossibleFrom: SLEEP_FROM, armedAndArmoured: readyEquipment(bot),
        shelterReady: !!refuge?.verifiedAt, shelterDistance: refuge ? Math.round(pos(refuge.origin).distanceTo(bot.entity.position)) : null },
      recentSurvivalAction: goal.survivalAction, carriedBuildingBlocks: shelter.materialStock(bot),
      foodReserve: { foodPoints: foodSupply(bot), desiredMinimum: desiredFood, hungerMaximum: 20, starvationAt: 0,
        requiredBeforeExpedition: !!expeditionFood } };
    const armed = readyEquipment(bot);
    const canStayUp = night(bot) && needsShelter && bedReady && armed;
    const tree = (night(bot) && needsShelter && !canStayUp) || (expeditionFood && needsFood) ? {} : {
      continue_request: { description: canStayUp ? 'Stay up tonight, armed and armoured, and keep working the request outside: spiders and the other night mobs are what a hunt for string needs, and the bed is one action away whenever the night has nothing more to give. Two minutes at a time, then this question again.'
        : goal.kind === 'survive' ? 'Wait nearby between player requests when survival preparations are already sufficient.' : 'Spend the next action on the player request while outside. Suitable when hunger and the remaining daylight leave time for survival preparations afterwards, or when a verified shelter is already close enough to reach.',
        run: async () => { if (canStayUp) { this.state.nightPlan = { plan: 'stay_up', until: Date.now() + 120000 }; this.report(goal, save, { action: 'stay_up' }); } } },
    };
    // Sleep is an option where the bed fits: two level cells beside the
    // feet. In a one-wide shaft it is not, and the shelter path digs in.
    if (needsShelter && bedReady && sleepable(bot) && ((homeBed && !underground) || bedSite(bot)) && !threats(bot).some(t => t.distance < 10)) tree.sleep_in_bed = { description: 'Put the carried bed down here and sleep. The night passes in seconds, nothing is built or spent, and the request resumes at dawn.', run: () => this.sleepStep(task, goal, save) };
    // A bed within reach makes a shelter the worse answer in every case, so
    // it is not offered beside one: the question that remains at night is
    // sleep or stay up, which is the one worth asking.
    if (needsShelter && !tree.sleep_in_bed) tree.secure_shelter = { description: 'Prepare and enter a sealed shelter before hostile mobs spawn at night. Reserve a nearby site, obtain missing blocks, then seal the room; keep the player request saved.',
      run: async () => { this.state.nightPlan = { plan: 'shelter', until: Date.now() + 120000 }; await this.refugeStep(task, goal, save); } };
    if (needsFood && !(night(bot) && needsShelter)) tree.obtain_food = { description: 'Obtain safe food to restore hunger and maintain a reserve for healing and the coming night. Keep the player request saved.',
      children: offWorld && this.actions.returnOverworld ? { return_for_food: { description: 'Go back through the portal to the Overworld, where food can be hunted and cooked; nothing here is safe to eat.',
        run: async () => { goal.survivalAction = { action: 'return_for_food', at: new Date().toISOString() }; save(); await this.actions.returnOverworld(bot, task, goal, save); } } }
        : await forageChoices(bot, task, goal, save, this.actions, this.state) };
    if (!this.client) {
      if (needsShelter) await (tree.sleep_in_bed || tree.secure_shelter).run();
      else await Object.values(tree.obtain_food.children)[0].run();
      onStep(goal); return true;
    }
    // Without Jev, shelter comes before food and food before the request:
    // the order a careful player keeps when nobody is weighing the trade.
    const fallback = children => ['sleep_in_bed', 'secure_shelter', 'obtain_food'].find(key => children[key]) || Object.keys(children)[0];
    if (needsShelter && tree.sleep_in_bed && Object.keys(tree).length === 1) { await tree.sleep_in_bed.run(); onStep(goal); return true; }
    const decision = await this.decide(task, goal, save, { state, tree, fallback, kind: 'survival', interrupt: () => checkThreats(bot),
      isFresh: () => bot.health === state.health && bot.food === state.food && !immediateThreat(bot) });
    onStep(goal);
    if (decision.stale) return true;
    await decision.action.run();
    return decision.path[0] !== 'continue_request';
  }
}

module.exports = { Survival, night, shelterNeeded, lavaBeside, bedSite, nearbyHomeBed, sleepable, SLEEP_FROM };

'use strict';
const { Movements } = require('mineflayer-pathfinder');
const { fixMiningMaterials, fixPathfinderResults } = require('./compatibility');
const { hostileEntities, safeFromHostiles } = require('./danger');
const { Vec3 } = require('vec3');
const Move = require('mineflayer-pathfinder/lib/move');
const { damagingTerrain, swimmingBlocks, swimmableWater, edgeHeld, standsInLava, floorDrops, floorDropDeadly } = require('./terrain');
const { isDoor, doorAt, doorAllowsDirection } = require('./doors');

// Parkour, where a miss costs nothing: with it off, the only way across a
// crack in the ground was a block laid in it, and the bot built little
// bridges over every one. The pathfinder's own jumps are kept (level, up a
// block, down a block; two-block gaps only while sprinting) when every
// column jumped over is survivable: ground or water within five blocks
// down and nothing that burns. A deep crevice or lava is bridged or walked
// round as before.
const GAP_FALL_MAX = 5, GAP_MAX = 2;
const LAVA_EDGE_COST = 4;
// The eight cells round a standing cell, and how far down a drop is
// measured: terrain.js's AROUND and dropNear's deepest.
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DROP_DEEPEST = 48;
const BURNS = /lava|fire|magma_block|campfire/;
const netherOf = bot => /nether/.test(String(bot?.game?.dimension || ''));
function gapSurvivable(movements, node, dir, k = 1) {
  for (let dy = -1; dy >= -(GAP_FALL_MAX + 1); dy--) {
    const b = movements.getBlock(node, dir.x * k, dy, dir.z * k);
    if (!b) return false;
    if (BURNS.test(b.name || '')) return false;
    if (b.liquid) return /water/.test(b.name || '');
    if (b.physical) return true;
  }
  return false;
}

class SurvivalMovements extends Movements {
  // No parkour in the Nether at all, whatever a step sets and the loop
  // restores: a jump that falls short there is the lava sea (the gap-jump
  // rule below; note 516).
  get allowParkour() { return this._allowParkour && !netherOf(this.bot); }
  set allowParkour(on) { this._allowParkour = on; }
  getMoveParkourForward(node, dir, neighbors) {
    if (!this.allowGapJumps || this.bot?._gapJumpsOffUntil > Date.now()) return;
    // No gap jumps in the Nether: a jump that falls short lands where the
    // body goes, and over the lava sea that is the sea. mid-243-g and
    // mid-229-f each went into it on a fortress leg with the route running
    // and no hit taken, twenty blocks down (2026-09-27); a gap there is
    // bridged or walked round.
    if (netherOf(this.bot)) return;
    const found = [];
    super.getMoveParkourForward(node, dir, found);
    for (const move of found) {
      const d = Math.abs(move.x - node.x) + Math.abs(move.z - node.z);
      // Level or down, never up: a jump across a gap and a block up at a
      // walk fell short, and the bot jumped at it for minutes.
      if (d - 1 > GAP_MAX || move.y > node.y || node.y - move.y > 1) continue;
      let safe = true;
      for (let k = 1; k < d && safe; k++) safe = gapSurvivable(this, node, dir, k);
      if (safe) neighbors.push(move);
    }
  }
  getMoveForward(node, direction, neighbors) {
    const target = new Vec3(node.x + direction.x, node.y, node.z + direction.z);
    const here = this.getBlock(node, 0, 0, 0), there = this.getBlock(node, direction.x, 0, direction.z);
    if (!isDoor(here.name) && !isDoor(there.name)) {
      // No bridge over a drop that hurts: the block goes into the floor
      // cell and the bot steps onto it unsneaking, over the void. mid-87-d
      // walked its own scaffolding along a ravine toward a herd and went
      // twenty-six blocks down at full health, as mid-87-c had off a cliff's
      // corner (2026-09-26). Over a short gap it bridges as before.
      const floor = this.getBlock(node, direction.x, -1, direction.z);
      if (!floor.physical && !there.liquid) {
        let landing = false;
        for (let dy = -2; dy >= -5 && !landing; dy--) {
          const below = this.getBlock(node, direction.x, dy, direction.z);
          if (below.physical || below.liquid) landing = !damagingTerrain.has(below.name);
          if (below.physical || below.liquid) break;
        }
        if (!landing) return;
      }
      return super.getMoveForward(node, direction, neighbors);
    }
    const doors = [];
    for (const [block, p] of [[here, node], [there, target]]) {
      if (!isDoor(block.name)) continue;
      const door = doorAt(this.bot, p);
      if (!door || !doorAllowsDirection(door, direction)) return;
      doors.push(door);
    }
    const floor = this.getBlock(node, direction.x, -1, direction.z), head = this.getBlock(node, direction.x, 1, direction.z);
    // Ordinary level thresholds only. Do not open a door onto a drop or use
    // its thin panel as a walking support or a substitute for headroom.
    if (!floor.physical || Math.abs(floor.height - node.y) > .01 || !isDoor(there.name) && (!there.safe || !head.safe)) return;
    const cost = 1 + this.exclusionStep(there) + this.getNumEntitiesAt(there.position, 0, 0, 0) * this.entityCost;
    if (cost > 100) return;
    const interactions = doors.filter(d => !d.getProperties().open).map(d => ({ ...d.position, dx: 0, dy: 0, dz: 0, useOne: true }));
    const move = new Move(target.x, target.y, target.z, node.remainingBlocks, cost + interactions.length, [], interactions);
    if (isDoor(there.name)) move.doorway = { ...target };
    neighbors.push(move);
  }

  getNeighbors(node) {
    const neighbors = super.getNeighbors(node);
    if (!this._hostileObservation || Date.now() - this._hostileObservation.at > 250) {
      this._hostileObservation = { at: Date.now(), entities: hostileEntities(this.bot, 64) };
    }
    // Upstream checks body space but accepts a damaging solid as the floor.
    // A ruined portal's magma must not become an ordinary walking surface.
    const kept = neighbors.filter(next => ![-1, 0, 1].some(dy => damagingTerrain.has(this.getBlock(next, 0, dy, 0).name)) &&
      (!this.allowedPosition || this.allowedPosition(next)) &&
      safeFromHostiles(this.bot, new Vec3(next.x + 0.5, next.y, next.z + 0.5), this._hostileObservation.entities));
    // A cell with lava beside it costs more than open ground: a path along
    // the lava sea's edge is a step's drift from it, and mid-92-o, walking a
    // soul sand shore on a fortress leg, went a block and a half into the
    // sea and burned from sixteen to seven (2026-09-26). Taken only when
    // it is much the shorter way.
    // In the Nether, a cell beside a drop into lava or a fall that kills
    // costs the same: a step's drift or a mob's push off it ends the same
    // way. mid-227-a and mid-227-b were routed along ledges high over the
    // lava sea on fortress legs, magma cubes about, and each went over and
    // fifty blocks down into the lava (notes 217 and 248, 2026-09-26). Now
    // refused outright (below); the cost stays for a walk that opts out.
    const nether = netherOf(this.bot);
    // No drop of two or more onto a cell with lava beside it: a fall carries
    // the body on past the cell it was aimed at, and the path cannot steer
    // it back until it lands. mid-220-e, on a fortress leg, dropped three
    // blocks to the lava sea's shore and went on into the sea (2026-09-27).
    const lavaBy = next => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => [0, -1].some(dy => this.getBlock(next, dx, dy, dz)?.name === 'lava'));
    // Nor a jump up onto one, across: the jump's arc carries the body on
    // past the cell as the fall does. mid-235-p-fortress-3 jumped out of a
    // trench onto the cells beside a lava flow at 14.6 health and its side
    // went into the flow; fifteen seconds of burning after (note 514).
    const airborne = next => node.y - next.y >= 2 || next.y > node.y && (next.x !== node.x || next.z !== node.z);
    // No block laid level beside the floor where a miss ends in lava: the
    // pathfinder lays it by backing to the edge crouched, and off the ground
    // mid-jump a crouch holds nothing. mid-235-p-nether-2, towering beside
    // its own span over the lava sea at 8.1 health, backed off the tower's
    // top to lay a block beside it, fell five onto the one-wide span and
    // slid off into the sea (note 514). Over lava a span is Jev's to choose
    // (cross_toward), said with its cost.
    const missIntoLava = p => (p.dx || p.dz) && !p.useOne && p.dy === 0 && this.fallIntoLava({ x: p.x + p.dx, y: p.y + 1, z: p.z + p.dz });
    for (let i = kept.length - 1; i >= 0; i--) {
      if (airborne(kept[i]) && lavaBy(kept[i]) || kept[i].toPlace?.some(missIntoLava)) kept.splice(i, 1);
      // Nor a drop or a jump onto a lip beside a deadly drop, pushers or
      // not: the body's own drift carries on past the cell (the staircase's
      // rule, mid-244-q). A step there is the edge rule below (note 541).
      else if (nether && airborne(kept[i]) && !this.besideLava?.(kept[i]) && this.deadlyDropBeside(kept[i])) { kept.splice(i, 1); this.edgeRefusals = (this.edgeRefusals || 0) + 1; }
      // In the Nether no cell a block sideways of lava, or of an edge whose
      // fall ends in lava or costs half the health, whatever the move:
      // refused one kind of move at a time, the pathfinder's routes found
      // the next, and both of note 514's burns were its own (mid-235-p-
      // nether-2, mid-235-p-fortress-3). mid-243-q-nether-1, on a ledge
      // thirteen over the lava sea, was knocked off by a ghast's fireball
      // into the sea with no shore to climb onto (note 516). With no water
      // there, lava beside the feet or below the edge is the end. A one-wide
      // span or bridge over the sea is such an edge: crossing it is Jev's
      // (cross_toward, cross_level), crouched, its cost said; a walk that
      // needs such cells opts out by name (besideLava).
      else if (nether) {
        const why = this.besideLavaRefused(kept[i]);
        if (why) { kept.splice(i, 1); this.lavaRefusals = (this.lavaRefusals || 0) + (why === 'lava' ? 1 : 0); this.edgeRefusals = (this.edgeRefusals || 0) + (why === 'edge' ? 1 : 0); }
      }
    }
    // In every dimension, no move that leaves the ground beside a fall that
    // kills (note 545, overFall below).
    for (let i = kept.length - 1; i >= 0; i--) if (this.overFall(node, kept[i]) || this.climbOverFall(node, kept[i])) kept.splice(i, 1);
    // Nor a block laid or dug beside a floor that falls with it (note 592,
    // dropsFloor below).
    for (let i = kept.length - 1; i >= 0; i--) if (this.dropsFloor(node, kept[i])) kept.splice(i, 1);
    for (const next of kept) {
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => [0, -1].some(dy => this.getBlock(next, dx, dy, dz)?.name === 'lava')) ||
        (nether && this.deadlyDropBeside(next))) next.cost += LAVA_EDGE_COST;
    }
    // Nor back onto the edge the bot has just stepped back from, while the
    // mobs it stepped back from are about (terrain.js holdOffEdge); save the
    // cells of the step's own way off it (edgeTaken). The step off the edge
    // held the cells beside the drop round the feet before it walked, and on
    // a one-wide path those are the way off: mid-242-bb-fortress-2's found
    // no route three times with a ghast 45 to 55 blocks off (note 612).
    return this.bot?._edgeHold ? kept.filter(next => this.edgeTaken?.(next) || !edgeHeld(this.bot, next, this._hostileObservation.entities)) : kept;
  }

  // Note 545, a fall-height check on the walk's own moves, in every
  // dimension: a move whose body is off the ground or backing blind is
  // refused where the fall it can run into lands in lava or costs half the
  // health or more. Two such moves:
  //  - a drop of two or more, or a gap jump: the body carries on past the
  //    cell it was aimed at, in its direction. mid-244-ac dropped three from
  //    a cave floor onto a one-wide ledge at walking pace, missed it, and
  //    fell forty to its death at full health; the lava-shore rule above
  //    (mid-220-e) is this for lava only. Measured one cell on, and the cells
  //    either side of that.
  //  - a block laid level beside the floor: the pathfinder backs to the edge
  //    crouched, turning as it goes, and a crouch holds nothing off the
  //    ground. mid-235-q-nether-2-fortress-2, in the Overworld at 10.6
  //    health, towered one block and backed off the tower's top mid-jump,
  //    its yaw not yet round, the other way from the block it meant to lay,
  //    and fell six into a lava pool. Measured on every side of the cell it
  //    backs from, since the way it drifts is not the way it means to go.
  // Walking level beside an edge is not refused here: on the ground the
  // body stops where its feet do.
  overFall(node, next) {
    const health = this.bot?.health ?? 20;
    const dx = Math.sign(next.x - node.x), dz = Math.sign(next.z - node.z);
    const reach = Math.max(Math.abs(next.x - node.x), Math.abs(next.z - node.z));
    if ((dx || dz) && (node.y - next.y >= 2 || reach >= 2)) {
      const ahead = dx && dz ? [[dx, dz], [dx, 0], [0, dz]] : dx ? [[dx, 0], [dx, 1], [dx, -1]] : [[0, dz], [1, dz], [-1, dz]];
      for (const [ax, az] of ahead) { const fall = this.fallOff(next, ax, az, health); if (fall) return fall; }
    }
    for (const p of next.toPlace || []) {
      if (p.useOne || p.dy !== 0 || !(p.dx || p.dz)) continue;
      const feet = { x: p.x, y: p.y + 1, z: p.z };
      for (const [ax, az] of AROUND) { const fall = this.fallOff(feet, ax, az, health); if (fall) return fall; }
    }
    return null;
  }
  // Note 592: gravel, sand and the other blocks that fall lie on the lava
  // sea's beaches resting on the lava, and stay until a block beside the
  // lowest of them is laid or dug (terrain.js floorDrops). A move that lays
  // or digs such a block while the body stands on that floor, or before it
  // steps onto it, drops the floor and the body: refused where that ends in
  // lava or costs half the health. mid-243-af-nether-1's crossing laid a
  // block against the gravel under its feet at the sea's edge and went in
  // with it; the pathfinder lays its bridging blocks the same way. A block
  // laid under the body on a jump (a tower) holds it wherever the floor
  // goes.
  dropsFloor(node, next) {
    const changed = [];
    for (const p of next.toPlace || []) {
      if (p.useOne) continue;
      const c = { x: p.x + p.dx, y: p.y + p.dy, z: p.z + p.dz };
      if (c.x === node.x && c.y === node.y && c.z === node.z) continue;
      changed.push(c);
    }
    for (const b of next.toBreak || []) changed.push({ x: b.x, y: b.y, z: b.z });
    if (!changed.length) return null;
    const at = p => { const b = this.getBlock(p, 0, 0, 0); return b.name === undefined ? null : { name: b.name, boundingBox: b.physical ? 'block' : 'empty' }; };
    const health = this.bot?.health ?? 20;
    for (const floor of [{ x: node.x, y: node.y - 1, z: node.z }, { x: next.x, y: next.y - 1, z: next.z }]) {
      for (const c of changed) { const h = floorDrops(at, floor, c); if (floorDropDeadly(h, health)) return h; }
    }
    return null;
  }

  // Note 565: no block laid to rise from a cell whose four sides all fall
  // more than three, on a walk whose goal is no higher. The fall rule above
  // refuses every drop and every block laid level off such a top, and what
  // the search had left were blocks laid to climb: a tower up (getMoveUp)
  // or a step laid on the side and jumped onto (getMoveJumpUp). mid-243-ab's
  // walks to sheep on the ground from the forest canopy built a staircase
  // into the air and a tower on it, 97 to 129, twenty and more over the
  // canopy, every walk "no route" and every one a block or two higher. A
  // goal above (a portal overhead) still climbs; the way down off a top is
  // way-down.js's, asked before the walk.
  climbOverFall(node, next) {
    if (next.y <= node.y || !(next.toPlace || []).some(p => p.dy === 1)) return false;
    const goalY = this.walkGoalY;
    if (!Number.isFinite(goalY) || goalY > node.y) return false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cell = this.getBlock(node, dx, 0, dz);
      if (cell.name === undefined || cell.physical || cell.liquid) return false;
      let open = 0;
      for (let dy = 1; dy <= 4; dy++) {
        const under = this.getBlock(node, dx, -dy, dz);
        if (under.name === undefined || under.physical || under.liquid) break;
        open++;
      }
      if (open <= 3) return false;
    }
    return true;
  }

  // The fall from the cell beside `feet` (dx, dz), open at the feet: into
  // lava at any depth, or onto ground whose damage (a point a block past
  // three) is half the health or more; water breaks it. Unknown is no fact.
  fallOff(feet, dx, dz, health = 20) {
    const cell = this.getBlock(feet, dx, 0, dz);
    if (cell.name === undefined || cell.physical) return null;
    if (/lava/.test(cell.name)) return { into: 'lava', fall: 0 };
    if (cell.liquid) return null;
    const deadly = Math.min(DROP_DEEPEST, Math.ceil(health / 2) + 4);
    for (let dy = 1; dy <= deadly; dy++) {
      const under = this.getBlock(feet, dx, -dy, dz);
      if (under.name === undefined) return null;
      if (/lava/.test(under.name)) return { into: 'lava', fall: dy - 1 };
      if (under.liquid) return null;
      if (under.physical) {
        if (this.landsInLava(feet, dx, dy, dz)) return { into: 'lava', fall: dy - 1 };
        return dy - 1 - 3 >= health / 2 ? { into: 'ground', fall: dy - 1 } : null;
      }
    }
    return { into: 'deep', fall: deadly };
  }
  // Whether the body landing on the block `dy` under the cell (dx, dz) from
  // `feet` stands in lava there (terrain.js standsInLava): the lava sea's
  // soul sand shore, level with the sea, is in it. mid-235-p-nether-3-
  // fortress-4 and mid-235-p-nether-4-fortress-3 went off a soul sand ledge
  // a block and then another onto that shore walking back to the portal,
  // no cell of the route beside lava (note 580).
  landsInLava(feet, dx, dy, dz) {
    if (dy < 2) return false;
    const at = p => { const b = this.getBlock(p, 0, 0, 0); return b.name === undefined ? null : b; };
    return standsInLava(at, { x: feet.x + dx, y: feet.y - dy + 1, z: feet.z + dz });
  }

  // The note 516 rule for a cell: 'lava' for lava in any of the eight
  // cells round it at the feet, the head or the floor, or an edge there
  // whose fall ends in lava; 'edge' for an edge whose fall costs half the
  // health; null for neither. `besideLava` is the opt-out: a predicate of
  // cells the caller has chosen to take all the same.
  // An edge is refused only while something about can push the bot over
  // it (danger.js pushersAbout); with nothing that can, it is walked at its
  // cost, as a player walks a fortress bridge. mid-235-p-nether-3-fortress-
  // 2 reached none of its fortress's stretches in seventy-three minutes,
  // every bridge edge refused with nothing about (note 541). Lava itself
  // beside the feet stays refused: a misstep there is the burn.
  besideLavaRefused(next) {
    if (this.besideLava?.(next)) return null;
    if (AROUND.some(([dx, dz]) => [1, 0, -1].some(dy => /lava/.test(this.getBlock(next, dx, dy, dz)?.name || '')))) return 'lava';
    const drop = this.deadlyDropBeside(next);
    if (!drop || !require('./danger').pushersAbout(this.bot).length) return null;
    // An escape offered along the edge, its cells beside the drop said and
    // priced by the push (survival.js routeEdge), walks the cells it was
    // offered with (edgeTaken): the bot stands beside the drop already, and
    // refused, mid-243-ah-fortress-5's way out of a ghast's line was
    // offered and refused four times on its ridge over the lava sea while
    // the ghast fired (note 610). Lava beside the feet stays refused.
    if (this.edgeTaken?.(next)) return null;
    return drop.into === 'lava' ? 'lava' : 'edge';
  }

  // Where a body with its feet at `feet`, over nothing, comes down: into
  // lava, or two or more onto a cell with lava beside it (the mid-220-e
  // rule above). Unknown is no fact.
  fallIntoLava(feet) {
    for (let dy = 1; dy <= DROP_DEEPEST; dy++) {
      const under = this.getBlock(feet, 0, -dy, 0);
      if (under.name === undefined) return false;
      if (/lava/.test(under.name)) return true;
      if (under.liquid) return false;
      if (!under.physical) continue;
      if (this.landsInLava(feet, 0, dy, 0)) return true;
      if (dy - 1 < 2) return false;
      const landing = { x: feet.x, y: feet.y - dy + 1, z: feet.z };
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => [0, -1].some(y => this.getBlock(landing, dx, y, dz)?.name === 'lava'));
    }
    return false;
  }

  // What lies below each cell round `node` that the body could go over: the
  // same cells, and the same measure, as the step back from an edge
  // (terrain.js dropAt and dropNear): open at the feet, no floor within
  // three, and then lava, or a fall whose damage is half the health or more.
  // Read through the pathfinder's own block view and kept for a second, so
  // a search over the same ledge measures each column once.
  deadlyDropBeside(node) {
    const now = Date.now();
    if (!this._drops || now - this._drops.at > 1000) this._drops = { at: now, cells: new Map() };
    const health = this.bot?.health ?? 20;
    for (const [dx, dz] of AROUND) {
      const key = `${node.x + dx},${node.y},${node.z + dz}`;
      let drop = this._drops.cells.get(key);
      if (drop === undefined) { drop = this.dropFrom(node, dx, dz, health); this._drops.cells.set(key, drop); }
      if (drop && (drop.into === 'lava' || drop.damage >= health / 2)) return drop;
    }
    return null;
  }
  // Measured no deeper than a fall that already costs half the health: the
  // lava sea is fifty blocks under the ledges, and every column of a search
  // over it was read to the bottom.
  dropFrom(node, dx, dz, health = 20) {
    const deadly = Math.min(DROP_DEEPEST, Math.ceil(health / 2) + 4);
    const cell = this.getBlock(node, dx, 0, dz);
    // Lava level with the feet is the lava-beside cost's; unknown is no fact.
    if (cell.physical || cell.liquid || cell.name === undefined) return null;
    for (let dy = 1; dy <= deadly; dy++) {
      const under = this.getBlock(node, dx, -dy, dz);
      if (under.name === undefined) return null;
      if (/lava/.test(under.name)) return { into: 'lava', fall: dy - 1, damage: Infinity };
      if (under.liquid) return { into: 'water', fall: dy - 1, damage: 0 };
      if (under.physical) {
        if (this.landsInLava(node, dx, dy, dz)) return { into: 'lava', fall: dy - 1, damage: Infinity };
        return dy <= 3 ? null : { into: 'ground', fall: dy - 1, damage: Math.max(0, dy - 1 - 3) };
      }
    }
    return { into: 'deep', fall: deadly, damage: Math.max(0, deadly - 3) };
  }

  getLandingBlock(node, direction) {
    // Upstream starts two blocks down. At a deep riverbank that skips the
    // upper water cell and proposes an underwater landing, which our surface
    // policy correctly rejects. Enter the actual surface instead.
    const edge = this.getBlock(node, direction.x, -1, direction.z);
    if (swimmableWater(edge) && edge.safe && this.getBlock(node, direction.x, 0, direction.z).safe &&
      !this.getBlock(node, direction.x, 0, direction.z).liquid) return edge;
    // Upstream compares against the floor block, one below the eventual
    // feet position. Convert that bound so a three-block allowance really
    // permits a three-block drop, then validate the returned landing height.
    const limit = this.maxDropDown;
    try {
      this.maxDropDown = limit + 1;
      const landing = super.getLandingBlock(node, direction);
      return landing && node.y - landing.position.y <= limit ? landing : null;
    } finally { this.maxDropDown = limit; }
  }

  getMoveJumpUp(node, direction, neighbors) {
    if (!swimmableWater(this.getBlock(node, 0, 0, 0))) return super.getMoveJumpUp(node, direction, neighbors);
    const bank = this.getBlock(node, direction.x, 0, direction.z);
    const head = this.getBlock(node, 0, 1, 0);
    const above = this.getBlock(node, direction.x, 1, direction.z);
    const clearance = this.getBlock(node, direction.x, 2, direction.z);
    // Buoyancy supplies the starting height. Comparing a bank against the
    // water block *below* the swimmer made every deep-water exit too tall.
    if (!bank.physical || bank.height - node.y > 1.2 || !head.safe || head.liquid ||
      !above.safe || above.liquid || !clearance.safe || clearance.liquid) return;
    const cost = 2 + this.liquidCost + this.exclusionStep(above) +
      this.getNumEntitiesAt(above.position, 0, 0, 0) * this.entityCost;
    if (cost <= 100) neighbors.push(new Move(above.position.x, above.position.y, above.position.z, node.remainingBlocks, cost, [], []));
  }

  // Up a water column, as a player swims up a waterfall or a flooded shaft:
  // the upstream graph has no upward move in water at all, so a waterfall
  // the physics climbs in six seconds was "no path" (the arena, 2026-09-25).
  // Only where the column comes out into air within twenty blocks: about
  // six seconds at the three and a half a second measured, well inside a
  // breath of fifteen.
  getMoveUp(node, neighbors) {
    if (!swimmableWater(this.getBlock(node, 0, 0, 0))) return super.getMoveUp(node, neighbors);
    const open = b => b.safe && !b.liquid;
    if (!(swimmableWater(this.getBlock(node, 0, 1, 0)) || open(this.getBlock(node, 0, 1, 0)))) return;
    let n = 1;
    while (n <= 20 && swimmableWater(this.getBlock(node, 0, n, 0))) n++;
    if (n > 20 || !open(this.getBlock(node, 0, n, 0))) return;
    neighbors.push(new Move(node.x, node.y + 1, node.z, node.remainingBlocks, 1 + this.liquidCost, [], []));
  }

  getMoveDiagonal(node, direction, neighbors) {
    // Diagonal jumps and swimming corners can look traversable to the graph
    // while the full player body catches the adjacent wall. Route those moves
    // through cardinal cells so the executor can align before stepping up/out.
    if (this.getBlock(node, 0, 0, 0).liquid || this.getBlock(node, direction.x, 0, direction.z).liquid) return;
    // A diagonal crosses both corner cells with the player's full width.
    // The upstream graph accepts it when just one corner is traversable,
    // which can skim the other corner's lava even with a dry destination.
    for (const [dx, dz] of [[direction.x, 0], [0, direction.z]]) {
      if ([-1, 0, 1].some(dy => {
        const block = this.getBlock(node, dx, dy, dz);
        return damagingTerrain.has(block.name) || dy <= 0 && block.liquid;
      })) return;
      // Nor a corner over a fall that hurts: the body's width swings over
      // the corner cell as it cuts across, and a little drift is a fall.
      // mid-87-c walked from a cliff-top toward a herd, cut the corner of a
      // twenty-five-block drop, and died at full health (2026-09-25).
      let floor = false;
      for (let dy = -1; dy >= -4 && !floor; dy--) {
        const below = this.getBlock(node, dx, dy, dz);
        // Lava is no floor: counted as a liquid first, a corner over it
        // passed for one.
        if (damagingTerrain.has(below.name) || /lava/.test(below.name || '')) break;
        if (below.physical || below.liquid || below.climbable) floor = true;
      }
      if (!floor) return;
    }
    const candidates = [];
    super.getMoveDiagonal(node, direction, candidates);
    neighbors.push(...candidates.filter(next => next.y <= node.y));
  }

  getMoveDown(node, neighbors) {
    // General navigation must not excavate a shaft beneath the bot's feet.
    // Underground work uses explicit, inspected staircase actions.
    if (this.getBlock(node, 0, -1, 0).climbable) super.getMoveDown(node, neighbors);
  }
}

// The pathfinder digs its way through terrain with whatever tool digs
// fastest, which is the iron pickaxe, on every block of every tunnel. That
// is how the dream run lost three iron pickaxes to stone. It digs with the
// cheapest tool that harvests the block, the same policy as the bot's own digs.
function installToolPolicy(bot) {
  if (!bot.pathfinder) return;
  const { cheapestTool } = require('./skills');
  bot.pathfinder.bestHarvestTool = block => cheapestTool(bot, block);
}

function configureMovements(bot) {
  fixMiningMaterials(bot.registry);
  fixPathfinderResults();
  installToolPolicy(bot);
  const movement = new SurvivalMovements(bot);
  for (const name of swimmingBlocks) if (bot.registry.blocksByName[name]) movement.liquids.add(bot.registry.blocksByName[name].id);
  for (const block of bot.registry.blocksArray) if (isDoor(block.name)) movement.fences.add(block.id);
  for (const name of damagingTerrain) {
    const block = bot.registry.blocksByName[name];
    if (block) movement.blocksToAvoid.add(block.id);
  }
  // Farmland is walked around, not over: a landing on it turns it back to
  // dirt, and the base's plot was retilled after every visit. Tilling and
  // planting stand beside the cell, so nothing needs to step on it.
  if (bot.registry.blocksByName.farmland) movement.blocksToAvoid.add(bot.registry.blocksByName.farmland.id);
  // A portal is stepped into on purpose (work.js enterPortal walks up to it
  // and steps in), never on the way somewhere else: mid-87-l's fortress
  // search set out from beside its Nether portal, walked through the sheet
  // and back, and crossed between the worlds every ten seconds (2026-09-26).
  if (bot.registry.blocksByName.nether_portal) movement.blocksToAvoid.add(bot.registry.blocksByName.nether_portal.id);
  // The pathfinder pillars and bridges with dirt and cobblestone only. In
  // the Nether the pockets hold netherrack, and with the cobblestone spent
  // on one span the bot could neither climb to the fortress nor cross to
  // it. Any plain stone the bot carries will do for scaffolding.
  // The wart blocks as well, as a span is laid with them (bridging.js
  // LAID, note 622).
  for (const name of ['netherrack', 'cobbled_deepslate', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'blackstone', 'basalt', 'deepslate', 'end_stone', 'nether_wart_block', 'warped_wart_block']) {
    const id = bot.registry.itemsByName[name]?.id;
    if (id !== undefined && !movement.scafoldingBlocks.includes(id)) movement.scafoldingBlocks.push(id);
  }
  movement.canDig = true;
  movement.allow1by1towers = true;
  // Parkour on, filtered to the one-block level jump (getMoveParkourForward),
  // and off in the Nether (the allowParkour getter).
  movement.allowParkour = true;
  movement.allowGapJumps = true;
  movement.allowSprinting = false;
  movement.maxDropDown = 3;
  // The defaults, kept for the main loop to restore each tick: a policy a
  // step applies and never restores on an error path otherwise cripples
  // every later path search with someone else's restrictions.
  bot._movementDefaults = { canDig: true, allow1by1towers: true, allowParkour: true, allowSprinting: false, maxDropDown: 3,
    scafoldingBlocks: [...movement.scafoldingBlocks], allowedPosition: undefined, besideLava: undefined, edgeTaken: undefined };
  // Pathfinder otherwise treats water as a safe landing at ANY depth,
  // even when a cliff has ledges between the bot and that water.
  movement.infiniteLiquidDropdownDistance = false;
  // Crossing ordinary water should be cheaper than constructing a road.
  // The old liquid cost (4) plus default place cost (1) made a block bridge
  // win even across a small pond. Keep bridging available for actual gaps.
  movement.liquidCost = 1;
  movement.placeCost = 6;
  // Let navigation clear vegetation and soft terrain. Resource mining stays
  // explicit, and navigation cannot tear down plank houses or stone machines.
  const soft = /^(dirt|grass_block|coarse_dirt|rooted_dirt|podzol|sand|gravel|snow|short_grass|tall_grass|fern|large_fern|leaf_litter|mushroom_stem|red_mushroom_block|brown_mushroom_block)$|_leaves$|_log$/;
  for (const block of bot.registry.blocksArray) {
    if (!soft.test(block.name)) movement.blocksCantBreak.add(block.id);
  }
  bot.pathfinder.setMovements(movement);
  updateDigCapabilities(bot);
  return movement;
}

function updateDigCapabilities(bot) {
  const movement = bot.pathfinder.movements;
  // Natural rock may obstruct an escape or a mountain path. Crafted blocks
  // remain protected, and each active construction area has its own exclusion.
  for (const name of ['stone', 'deepslate', 'granite', 'diorite', 'andesite', 'tuff']) {
    const block = bot.registry.blocksByName[name];
    if (!block) continue;
    const canHarvest = bot.inventory.items().some(item => item.name.endsWith('_pickaxe') && block.harvestTools?.[item.type]);
    if (canHarvest) movement.blocksCantBreak.delete(block.id);
    else movement.blocksCantBreak.add(block.id);
  }
}
// Note 545's fall rule for a walk that is not the pathfinder's (the fire
// reflex's run on the keys): the deadly fall, if any, from the eight cells
// round `feet`, read from the world as fallOff reads the pathfinder's
// blocks. A body at a run carries on past the cell it stops on; a cell
// with such a fall beside it is not one to run to. mid-208-k-nether-2 ran
// out of a fire at 19.5 health, its last cell by an edge, and went on over
// it, forty-seven blocks into lava (note 548).
function fallBeside(bot, feet, health = bot?.health ?? 20) {
  const shim = { getBlock: (p, dx, dy, dz) => {
    const b = bot.blockAt?.(new Vec3(p.x + dx, p.y + dy, p.z + dz));
    return b ? { name: b.name, physical: b.boundingBox === 'block', liquid: /water|lava/.test(b.name) } : {};
  }, landsInLava: (at, dx, dy, dz) => dy >= 2 && standsInLava(p => bot.blockAt?.(new Vec3(p.x, p.y, p.z)), { x: at.x + dx, y: at.y - dy + 1, z: at.z + dz }) };
  for (const [dx, dz] of AROUND) { const fall = SurvivalMovements.prototype.fallOff.call(shim, feet, dx, dz, health); if (fall) return fall; }
  return null;
}

module.exports = { fallBeside, configureMovements, updateDigCapabilities, installToolPolicy, SurvivalMovements, gapSurvivable };

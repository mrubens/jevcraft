'use strict';
// One line of chat when the bot starts on something new: a different source,
// a different kind of work, or survival taking over. It is the cheapest window
// there is into what Jev decided, and a player watching from behind should
// never have to guess why the bot turned around. Nothing here repeats a line
// for the same phase, and nothing speaks more often than the gap allows,
// because vanilla kicks a chatty client.
const MIN_GAP_MS = 4000;
// The same creeper interrupting five times is one story, not five: an escape
// from the same kind of mob is announced once within this window, and once
// the chase has been quiet for a while the bot says it thinks it got away.
const ESCAPE_REPEAT_MS = 120000;
const ESCAPE_QUIET_MS = 12000;
const name = value => String(value || '').replace(/^minecraft:/, '').replaceAll('_', ' ');
// "Getting 5 oak log" reads badly. Mass nouns stay as they are; the rest
// take an s, and a torch takes an es.
const MASS = /(^| )(cobblestone|cobbled deepslate|dirt|sand|red sand|gravel|coal|charcoal|raw iron|raw gold|raw copper|string|wool|wheat|bread|flint|leather|obsidian|iron|gold|copper|redstone|lapis lazuli|glowstone dust|gunpowder|netherrack|stone|granite|andesite|diorite|tuff|deepslate|clay|snow|kelp|paper|sugar|glass|ice|blaze powder|bone meal|water|lava|milk|beef|pork|porkchop|mutton|chicken|cod|salmon|rotten flesh|glow ink sac|ink sac)$/;
const plural = (count, value) => {
  const n = name(value);
  if (!(count > 1) || MASS.test(n) || /(s|planks|seeds|boots|leggings)$/.test(n)) return n;
  return /(ch|sh|x)$/.test(n) ? `${n}es` : `${n}s`;
};

const SURVIVAL = {
  gather_shelter_materials: "Night's coming, so I'm gathering blocks to dig in first.",
  seal_shelter: 'Sealing myself in for the night.',
  sheltered: "I'm safe inside. I'll wait for morning.",
  sleep: 'Night. Bedding down.',
  // Only a trip worth the name: "heading home to bed" ten blocks from the
  // bed, then "home before bedtime", read as a bot talking to itself (the
  // user, 2026-09-24).
  go_home_for_night: (goal, action) => (action.distance ?? 99) > 24 ? 'Getting dark. Heading home to bed.' : null,
  wait_for_bedtime: "Home before dark. Waiting for bedtime.",
  evening_chore: (goal, action) => `Home before dark. ${({ stock_stash: 'Stocking the chest', harvest_and_bake: 'Harvesting and baking', tend_farm: 'Tending the plot', breed_cows: 'Breeding the cows' })[action.chore] || 'A chore'} before bed.`,
  grow_plot: 'Home before dark. The plot can be bigger; one more row tomorrow.',
  sleep_failed: (goal, action) => `Couldn't sleep: ${String(action.reason || '').replace(/^The server refused the sleep: /, '').replaceAll('_', ' ').replace(/^block\.minecraft\./, '')}.`,
  stay_up: "Staying up tonight; there's work the dark is good for.",
  leave_shelter: (goal, action) => action.reason || "Morning. Back to it.",
  escape_threat: (goal, action) => `Something hostile is close${action.threats?.length ? ` (${[...new Set(action.threats.map(t => name(t.name || t)))].join(', ')})` : ''}, moving away.`,
  hold_defensive_position: 'Cornered. Holding here and defending.',
  dig_in_bunker: (goal, action) => `Too many of them out here (${[...new Set(action.threats || [])].join(', ')}). Digging into the rock to meet them one at a time.`,
  fight: (goal, action) => `Fighting ${[...new Set((action.threats || []).map(name))].join(' and ')}.`,
  charge: (goal, action) => `No way out, so I'm going for the ${name(action.target)}.`,
  // Named when known: "something is shooting" was said of a blaze in plain
  // sight, and read as the bot not seeing it (the user, 2026-09-24).
  dig_in: (goal, action) => {
    const known = [...new Set((action.threats || []).map(t => name(t.name || t)))];
    return known.length ? `Walling off from the ${known.join(' and the ')} until it passes.` : 'Something is shooting at me, so I\'m digging in until it passes.';
  },
  wall_off: 'Cornered, so I\'m walling the tunnel shut.',
  leave_lava_edge: 'Getting away from the lava before anything else.',
  return_to_surface: 'Heading back up to the surface.',
  recover_items: "Going back for the things I dropped.",
  gather_food: (goal, action) => `Getting something to eat first${action.item ? `: ${name(action.item)}` : ''}.`,
  search_food: 'Looking for food nearby.',
  return_for_food: 'Nothing to eat here. Heading back through the portal for food.',
  cook_food: 'Cooking food.',
  go_home_for_food: 'Heading home for something to eat.',
  village_found: "There's a village here. Worth remembering.",
  landmark_found: 'Found something worth remembering.',
  village_food: 'Heading to the village for something to eat.',
  prepare_hunting_weapon: 'Making a weapon so I can hunt.',
  reach_shore: 'Swimming for the shore.',
  surface: 'Coming up for air.',
};

// What the source Jev chose looks like, from the recorded decision tree.
function sourceDescription(decision, key) {
  if (!decision?.options || !key) return null;
  const stack = [decision.options];
  while (stack.length) {
    const children = stack.pop();
    for (const [k, node] of Object.entries(children || {})) {
      if (k === key && node.description && typeof node.description === 'object') return node.description;
      if (node.children) stack.push(node.children);
    }
  }
  return null;
}

function stepLine(goal, step, decision) {
  if (!step?.action) return null;
  const detail = step.detail && typeof step.detail === 'object' ? step.detail : null;
  switch (step.action) {
    case 'combined_request': return detail ? stepLine(goal, detail, decision) : null;
    // Once per resource, not once per tree: which trunk Jev picked is in the
    // Observatory, and a line per tree drowned the lines that mattered.
    case 'mine': return `Getting ${step.count ? `${step.count} ` : ''}${plural(step.count, step.drops || step.block)}.`;
    case 'craft': return `Crafting ${step.count ? `${step.count} ` : ''}${plural(step.count, step.item)}.`;
    case 'smelt': return `Smelting ${step.count > 1 ? `${step.count} ` : ''}${plural(step.count, step.item)}.`;
    case 'harden': return 'Hardening concrete in water.';
    case 'make_obsidian': return `Making ${step.count ? `${step.count} ` : ''}obsidian: water on lava.`;
    case 'fill_bucket': return 'Fetching water.';
    case 'hunt_mob': return `Going after a ${name(step.entity)} for ${name(step.item)}.`;
    case 'strike_out': return 'Striking out somewhere new.';
    case 'stock_food_for_nether': return 'Stocking up on food before the Nether.';
    case 'return_for_food': return 'Out of food. Heading back through the portal to eat.';
    case 'find_fortress': return step.walking ? 'In the fortress. Looking for blazes.' : step.found ? 'A fortress. Heading for it.' : `Sweeping for a fortress, leg ${step.legs || 1}.`;
    case 'collect': return `Picking up ${name(step.item || step.drops)}.`;
    case 'place': case 'build': case 'build_schematic':
      return `Building${goal.kind === 'house' ? ' the house' : goal.design?.source?.name ? ` ${goal.design.source.name}` : ''}.`;
    case 'clear': return 'Clearing the site.';
    case 'prepare_build_site': return 'Preparing the ground.';
    case 'find_build_site': return 'Looking for a level spot to build.';
    case 'return_to_site': return 'Heading back to the site.';
    case 'deliver': return `Bringing you ${step.count ? `${step.count} ` : ''}${name(step.item)}.`;
    case 'prepare_expedition_food': return 'Stocking up on food before the trip.';
    case 'refuel_furnace': return 'Refuelling the furnace.';
    case 'return_overworld': return 'Heading back to the Overworld.';
    case 'return_to_portal': return 'Walking back to my portal.';
    case 'home_site': return step.origin ? `Picking a spot for a home base beside the water at ${step.origin.x}, ${step.origin.z}.` : 'Looking for level ground beside water for a home base.';
    case 'return_home': return 'Walking back to the base.';
    case 'gather_wool': return 'Getting wool for a bed.';
    case 'explore': return step.target ? `Exploring toward ${step.target.x}, ${step.target.z} to see what is there.` : 'Exploring.';
    case 'village_bed': return step.village ? `Going to the village at ${step.village.x}, ${step.village.z} for a bed.` : 'Going to the village for a bed.';
    case 'village_harvest': return `Taking the ripe ${name(step.crop)} from the village farm.`;
    case 'village_hay': return 'Taking a hay bale for bread.';
    case 'place_bed': return 'Setting up a bed at the base.';
    case 'claim_bed': return 'Using the bed so I respawn at home.';
    case 'till': return 'Tilling the plot.';
    case 'plant': return 'Planting wheat.';
    case 'harvest': return 'Harvesting the wheat.';
    case 'bake': return `Baking ${step.loaves ? `${step.loaves} ` : ''}bread.`;
    case 'build_pen': return 'Fencing the cow pen.';
    case 'lure_cows': return 'Leading cows into the pen.';
    case 'breed_cows': return 'Breeding the cows.';
    case 'take_steak': return 'Taking a steak from the pen.';
    case 'place_chest': return 'Putting a chest beside the bed for a spare kit.';
    case 'stock_stash': return 'Stocking the stash chest with spares.';
    case 'restock': return 'Taking my spare kit out of the stash chest.';
    case 'stash_valuables': return 'Leaving my valuables in the stash chest while I am home.';
    case 'idle': return {
      cook_food: `Quiet for now, so I'll cook the ${name(step.item).replace(/^(cooked|baked) /, '')}.`,
      stone_tools: `Quiet for now, so I'll make a ${name(step.item)}.`,
      stock_wood: 'Quiet for now, so I\'ll stock up on wood.',
      torches: 'Quiet for now, so I\'ll make some torches.',
      long_game: `Nothing needs me right now, so I'll work on the long game: ${name(step.phase)}.`,
      tend_farm: "Quiet for now, so I'll tend the farm.",
      harvest_and_bake: "Quiet for now, so I'll harvest the wheat and bake some bread.",
      breed_cows: "Quiet for now, so I'll breed the cows.",
      lure_cows: "Quiet for now, so I'll bring some cows into the pen.",
      stock_stash: "Quiet for now, so I'll stock the stash chest.",
    }[step.choice] || null;
    case 'game_progression': return `Working toward beating the game: ${name(step.phase)}.`;
    default: return null;
  }
}

// The key that has to change before another line is spoken. A source is part
// of it, so a new tree is a new line, but a continued source is not.
function stepKey(goal, step, decision) {
  if (!step?.action) return null;
  const inner = step.action === 'combined_request' && step.detail && typeof step.detail === 'object' ? step.detail : step;
  const target = inner.item || inner.drops || inner.block || inner.material || inner.entity || inner.choice || inner.phase || '';
  const action = ['place', 'build', 'build_schematic'].includes(inner.action) ? 'build' : inner.action;
  return `${action}:${target}`;
}

function narrate(bot, goal, { now = Date.now() } = {}) {
  if (typeof bot?.chat !== 'function' || !goal) return null;
  const state = goal.narrated ||= {};
  const speak = line => {
    if (!line || (state.at && now - state.at < MIN_GAP_MS)) return false;
    try { bot.chat(line); } catch (_) { return false; }
    state.at = now; state.line = line;
    return true;
  };
  const action = goal.survivalAction;
  const escape = state.escape;
  if (escape && !escape.resolved && now - escape.at >= ESCAPE_QUIET_MS && !(action?.action === 'escape_threat' && action.at !== state.survival)) {
    if (speak('I think I lost it.')) { escape.resolved = true; return 'I think I lost it.'; }
    return null;
  }
  if (action?.at && action.at !== state.survival) {
    const phrase = SURVIVAL[action.action];
    let line = typeof phrase === 'function' ? phrase(goal, action) : phrase;
    if (action.action === 'escape_threat') {
      const names = [...new Set((action.threats || []).map(t => name(t.name || t)))].sort().join(',');
      const repeat = escape && escape.names === names && now - escape.at < ESCAPE_REPEAT_MS;
      state.escape = { at: now, names, resolved: false, announced: repeat ? escape.announced : false };
      if (repeat) { state.survival = action.at; return null; }
    }
    // Any survival line repeated word for word inside the window is the same
    // news again: five food searches in a row read as a stuck bot.
    if (line && state.lastSurvivalLine?.line === line && now - state.lastSurvivalLine.at < ESCAPE_REPEAT_MS) { state.survival = action.at; return null; }
    if (!phrase || !line || speak(line)) { state.survival = action.at; if (line) state.lastSurvivalLine = { line, at: now }; return line || null; }
    return null;
  }
  const decision = goal.decisions?.at(-1);
  const key = stepKey(goal, goal.step, decision);
  if (!key || key === state.step) return null;
  const line = stepLine(goal, goal.step, decision);
  // A step with nothing to say (a tunnel segment, a climb) must not reset
  // the key, or the resource line fires again after every one of them.
  if (!line) return null;
  if (speak(line)) { state.step = key; return line; }
  return null;
}

module.exports = { narrate, stepLine, stepKey, SURVIVAL, MIN_GAP_MS };

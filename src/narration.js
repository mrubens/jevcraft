'use strict';
// One line of chat when the bot starts on something new: a different source,
// a different kind of work, or survival taking over. It is the cheapest window
// there is into what Jev decided, and a player watching from behind should
// never have to guess why the bot turned around. Nothing here repeats a line
// for the same phase, and nothing speaks more often than the gap allows,
// because vanilla kicks a chatty client.
const MIN_GAP_MS = 4000;
const name = value => String(value || '').replace(/^minecraft:/, '').replaceAll('_', ' ');

const SURVIVAL = {
  gather_shelter_materials: "Night's coming, so I'm gathering blocks to dig in first.",
  seal_shelter: 'Sealing myself in for the night.',
  sheltered: "I'm safe inside. I'll wait for morning.",
  leave_shelter: (goal, action) => action.reason || "Morning. Back to it.",
  escape_threat: (goal, action) => `Something hostile is close${action.threats?.length ? ` (${[...new Set(action.threats.map(t => name(t.name || t)))].join(', ')})` : ''}, moving away.`,
  hold_defensive_position: 'Cornered. Holding here and defending.',
  return_to_surface: 'Heading back up to the surface.',
  recover_items: "Going back for the things I dropped.",
  gather_food: (goal, action) => `Getting something to eat first${action.item ? `: ${name(action.item)}` : ''}.`,
  search_food: 'Looking for food nearby.',
  cook_food: 'Cooking food.',
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
    case 'mine': return `Getting ${step.count ? `${step.count} ` : ''}${name(step.drops || step.block)}.`;
    case 'craft': return `Crafting ${step.count ? `${step.count} ` : ''}${name(step.item)}.`;
    case 'smelt': return `Smelting ${name(step.item)}.`;
    case 'harden': return 'Hardening concrete in water.';
    case 'fill_bucket': return 'Fetching water.';
    case 'hunt_mob': return `Going after a ${name(step.entity)} for ${name(step.item)}.`;
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
    default: return null;
  }
}

// The key that has to change before another line is spoken. A source is part
// of it, so a new tree is a new line, but a continued source is not.
function stepKey(goal, step, decision) {
  if (!step?.action) return null;
  const inner = step.action === 'combined_request' && step.detail && typeof step.detail === 'object' ? step.detail : step;
  const target = inner.item || inner.drops || inner.block || inner.material || inner.entity || '';
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
  if (action?.at && action.at !== state.survival) {
    const phrase = SURVIVAL[action.action];
    const line = typeof phrase === 'function' ? phrase(goal, action) : phrase;
    if (!phrase || speak(line)) { state.survival = action.at; return line || null; }
    return null;
  }
  const decision = goal.decisions?.at(-1);
  const key = stepKey(goal, goal.step, decision);
  if (!key || key === state.step) return null;
  const line = stepLine(goal, goal.step, decision);
  if (!line || speak(line)) { state.step = key; return line; }
  return null;
}

module.exports = { narrate, stepLine, stepKey, SURVIVAL, MIN_GAP_MS };

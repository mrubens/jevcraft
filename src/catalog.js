'use strict';
const { choice } = require('./typesafe');
const { resolvedPreferenceContext } = require('./preferences');
const words = text => String(text).toLowerCase().replace(/[_-]/g, ' ').replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
const stem = word => word.endsWith('ies') ? word.slice(0, -3) + 'y' : word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
const ignored = new Set(['jev', 'jevbot', 'get', 'bring', 'me', 'some', 'a', 'an', 'the', 'of', 'please', 'make', 'craft', 'build', 'give', 'collect', 'gather', 'find', 'can', 'you', 'i', 'want', 'need', 'stack', 'half', 'using', 'with', 'from', 'house', 'shelter']);
const aliases = {
  wood: ['oak_log', 'oak_planks', 'birch_log', 'spruce_log', 'jungle_log'],
  wooden: ['oak_planks', 'oak_log'], grass: ['short_grass', 'grass_block', 'tall_grass'],
  rock: ['cobblestone', 'stone'], torch: ['torch'], bench: ['crafting_table'],
  crafting: ['crafting_table'], light: ['torch', 'lantern', 'glowstone'],
};
const categoryOf = (registry, item) => registry.blocksByName[item.name] ? 'blocks' : registry.foodsByName?.[item.name] ? 'food' : item.maxDurability ? 'equipment' : 'items';

// Broad lexical retrieval supplies candidates; Jev chooses their meaning.
// These words never decide the requested action or silently select an item.
function itemCandidates(registry, request, { limit = 48, blocksOnly = false } = {}) {
  const tokens = words(request).map(stem).filter(w => !ignored.has(w) && !/^\d+$/.test(w));
  const named = new Set(tokens.flatMap(t => aliases[t] || []));
  const query = words(request).join(' ');
  return registry.itemsArray.filter(item => !blocksOnly || registry.blocksByName[item.name]?.boundingBox === 'block')
    .map(item => {
      const parts = words(item.name).map(stem);
      const matched = parts.filter(p => tokens.includes(p));
      const phrase = words(item.name).join(' ');
      const score = matched.length * 5 + matched.length / parts.length + (named.has(item.name) ? 2 : 0) +
        (new RegExp(`(?:^| )${phrase}(?: |$)`).test(query) ? parts.length * 4 : 0);
      return { item, score };
    }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit).map(row => row.item);
}

function itemChoices(items) {
  return { ...Object.fromEntries(items.map(item => [item.name, item.name === 'short_grass'
    ? 'Short Grass: the grass plant/vegetation; collected with shears.' : item.name === 'grass_block'
      ? 'Grass Block: dirt topped with grass; collecting the intact turf block requires Silk Touch.'
      : `${item.displayName} (${item.name})`])), none: 'No offered item matches the requested item or material.' };
}

function catalogTree(registry, { blocksOnly = false } = {}) {
  const items = registry.itemsArray.filter(item => !blocksOnly || registry.blocksByName[item.name]?.boundingBox === 'block');
  const categories = {};
  const descriptions = { blocks: 'All placeable blocks and objects: terrain, plants, building materials, chests, beds, furnaces, crafting tables, torches, and other placed utility objects.',
    food: 'Foods and edible ingredients.', equipment: 'Tools, weapons, armor, and equipment with durability.',
    items: 'Non-placeable inventory items: resources, ingredients, dyes, vehicles and buckets. Placeable objects such as chests and furnaces belong to blocks.' };
  for (const item of items) {
    const category = categoryOf(registry, item);
    (categories[category] ||= []).push(item);
  }
  function subdivide(members, depth = 0) {
    if (members.length <= 28) return Object.fromEntries(members.map(item => [item.name, { item: item.name, description: itemChoices([item])[item.name] }]));
    const groups = {};
    for (const item of members) {
      const parts = item.name.split('_');
      // Families come from actual catalog names. A large family is divided
      // again by variant prefix, so adding an item does not add code handlers.
      const family = depth === 0 ? parts.at(-1) : parts.slice(0, depth).join('_');
      (groups[family] ||= []).push(item);
    }
    if (Object.keys(groups).length === 1 && depth > 5) throw new Error('Could not partition the Minecraft item catalog');
    const branches = Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([family, group]) => [family, {
      description: `${family.replaceAll('_', ' ')} family (${group.length} items): ${group.slice(0, 6).map(i => i.displayName).join(', ')}${group.length > 6 ? ', and other variants' : ''}`,
      children: subdivide(group, depth + 1),
    }]));
    if (Object.keys(branches).length <= 28) return branches;
    const entries = Object.entries(branches);
    const pages = {};
    for (let i = 0; i < entries.length; i += 20) {
      const page = entries.slice(i, i + 20);
      pages[`families_${i / 20}`] = { description: `Catalog families: ${page.map(([name]) => name.replaceAll('_', ' ')).join(', ')}`,
        children: Object.fromEntries(page) };
    }
    return pages;
  }
  return Object.fromEntries(Object.entries(categories).map(([key, members]) => [key, { description: descriptions[key], children: subdivide(members) }]));
}

// A leaf pick this unsure, with a real runner-up, is a question for the
// player rather than a coin toss executed for the next ten minutes.
const AMBIGUOUS = { confidence: 0.5, runnerUp: 0.25 };

async function resolveItem(client, registry, request, { blocksOnly = false, context = {}, noted } = {}) {
  context = { ...context, memory: await resolvedPreferenceContext(client, registry, context.memory, { noted }) };
  const suggestions = itemCandidates(registry, request, { blocksOnly }).map(item => ({ item: item.name, category: categoryOf(registry, item) }));
  const path = [];
  const judgments = [];
  const started = performance.now();
  let children = catalogTree(registry, { blocksOnly });
  const contains = (node, item) => node.item === item || !!node.children && Object.values(node.children).some(child => contains(child, item));
  for (let depth = 0; depth < 12; depth++) {
    const keys = Object.keys(children);
    let selected = keys[0];
    if (keys.length !== 1) {
      // A family's name alone can be misleading: grass_block belongs to the
      // block family, while short_grass belongs to grass. Show actual relevant
      // descendants at every branch without removing any catalog options.
      const options = Object.fromEntries(keys.map(key => {
        const matches = suggestions.filter(s => contains(children[key], s.item)).slice(0, 8).map(s => s.item);
        return [key, `${children[key].description}${matches.length ? `. Relevant catalog entries in this branch: ${matches.join(', ')}` : ''}`];
      }));
      const response = await client.systemOne({ kind: 'catalog', state: { request, selectedCatalogPath: path, lexicalSuggestions: suggestions, ...context }, questions: {
        item: choice({ task: blocksOnly ? 'Select the next catalog branch containing the requested building material.' :
          'Select the next catalog branch containing the item the player wants obtained or crafted. Select the requested output, not a tool or ingredient needed to obtain it.',
        guidance: 'Each branch is generated from the actual Minecraft catalog. Match the requested species, color, and item kind. Current explicit choices override memory. For an unspecified wood variant, use relevant explicit memory notes first, then memory.preferences as a soft default; a remembered species applies to logs, planks, and wooden variants, not unrelated items. If there is no relevant wood preference, use oak as the ordinary unspecified wood default. Do not add outputs or infer a new player choice from a default. Bare grass means the grass plant unless grass block/turf is specified. Lexical suggestions are hints, not restrictions. Choose none only if none of these branches contains the requested item.' },
        { ...options, none: 'No branch contains the requested item or material.' }),
      } });
      selected = response.answers?.item?.choice;
      judgments.push({ path: [...path], options, answer: response.answers?.item, usage: response.usage });
      if (selected === 'none') return { item: null, path, judgments, latencyMs: Math.round(performance.now() - started) };
      if (!Object.hasOwn(children, selected)) throw new Error('Jev selected an item outside the Minecraft catalog hierarchy');
      const answer = response.answers.item;
      if (children[selected].item && Number.isFinite(answer.confidence) && answer.confidence < AMBIGUOUS.confidence) {
        const runnerUp = Object.entries(answer.probabilities || {}).filter(([key]) => key !== selected && children[key]?.item)
          .sort(([, a], [, b]) => b - a)[0];
        if (runnerUp && runnerUp[1] >= AMBIGUOUS.runnerUp) {
          return { item: null, ambiguous: [children[selected].item, children[runnerUp[0]].item], path, judgments, latencyMs: Math.round(performance.now() - started) };
        }
      }
    }
    path.push(selected);
    const node = children[selected];
    if (node.item) return { item: node.item, path, judgments, latencyMs: Math.round(performance.now() - started) };
    children = node.children;
  }
  throw new Error('Minecraft catalog classification exceeded its depth limit');
}

module.exports = { itemCandidates, itemChoices, catalogTree, resolveItem, AMBIGUOUS };

'use strict';
// Grow the schematic shelf with the generative designer, on purpose and
// once. Each design costs a real OpenRouter call, so this is never run by the
// bot; a person runs it, looks at what came back, and commits what they like.
//
//   node scripts/generate-schematics.js cottage "a snug spruce cottage with a porch"
//   node scripts/generate-schematics.js chapel "a stone chapel with a bell tower" --name stone-bell-chapel
//
// The result is validated exactly as a live design would be and written to
// data/schematics/<name>.json with its part, so the village can choose it.
require('../src/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { validateSchematic, buildPalette, LIMITS, SCHEMA, MODEL } = require('../src/designer');
const { PARTS, LIBRARY_DIR } = require('../src/schematic-library');
const registry = require('minecraft-data')('26.1');

const [part, ...rest] = process.argv.slice(2);
const nameIndex = rest.indexOf('--name');
const name = nameIndex >= 0 ? rest.splice(nameIndex, 2)[1] : null;
const request = rest.join(' ');
if (!PARTS.includes(part) || !request) { console.error(`Usage: node scripts/generate-schematics.js <${PARTS.join('|')}> "<description>" [--name slug]`); process.exit(2); }
if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY is needed to generate a design'); process.exit(2); }

(async () => {
  const schema = structuredClone(SCHEMA), allowed = [...buildPalette(registry), 'air'];
  schema.properties.palette.items.enum = allowed; schema.properties.regions.items.properties.block.enum = allowed;
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENROUTER_BUILD_MODEL || MODEL, max_tokens: 16000, reasoning: { effort: 'low' }, provider: { require_parameters: true },
      messages: [{ role: 'system', content: `Design a Minecraft ${part} for a village, as a schematic: local [x,y,z] inside size, inclusive cuboid regions applied in order, air carves openings, unspecified cells are air, at most 16 palette entries and ${LIMITS.regions} regions, within ${LIMITS.width}x${LIMITS.height}x${LIMITS.depth} and ${LIMITS.blocks} solid blocks, everything connected to the foundation at y=0. Stairs need properties {facing, half}; slabs {facing:null, half}; doors {facing, half:null}; other blocks properties:null. An enterable building needs a two-block-high entrance at y>=1 with a floor beneath, given as its bottom air cell; set entrance:null for structures not meant to be entered. Set site to null and existingOffset to null. Aim for 80 to 400 solid blocks; spend detail on shape and openings.` },
        { role: 'user', content: JSON.stringify({ part, request }) }],
      response_format: { type: 'json_schema', json_schema: { name: 'minecraft_schematic', strict: true, schema } } }),
  });
  if (!response.ok) throw new Error(`Designer request failed (${response.status})`);
  const result = await response.json();
  const draft = JSON.parse(result.choices?.[0]?.message?.content || 'null');
  const validated = validateSchematic(draft, registry);
  const slug = (name || draft.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  const file = path.join(LIBRARY_DIR, `${slug}.json`);
  const { site: _site, existingOffset: _offset, ...source } = draft;
  fs.writeFileSync(file, JSON.stringify({ part, origin: `Generated on request: ${request}`, source }, null, 1));
  console.log(JSON.stringify({ file, name: draft.name, size: draft.size, blocks: validated.blocks.length, materials: validated.materials, usage: result.usage }));
})().catch(err => { console.error(err.message); process.exit(1); });

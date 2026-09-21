'use strict';
const fs = require('fs');
const path = require('path');
const { choice } = require('./typesafe');
const { validateSchematic } = require('./designer');
const { templateSchematic } = require('./build-templates');
const { generatedEntries } = require('./schematic-generators');

// A shelf of ready-made designs the bot can build without asking a
// generative model for anything. Files under data/schematics are validated
// schematic sources with a `part` (cottage, mansion, tower, well, farm,
// chapel, pavilion, monument); template variants fill in the basic parts.
// Jev chooses between the designs on the shelf, which is the kind of
// question it is for; drawing a new one is not.
const LIBRARY_DIR = path.join(__dirname, '..', 'data', 'schematics');
const PARTS = ['cottage', 'mansion', 'tower', 'well', 'farm', 'chapel', 'pavilion', 'monument', 'barn', 'lamp', 'plaza'];

function templateEntries() {
  const entries = [];
  for (const material of ['oak_planks', 'spruce_planks', 'cobblestone', 'stone']) {
    entries.push({ id: `template-cottage-${material}`, part: 'cottage', source: templateSchematic({ style: 'cottage', floors: 1, size: 'normal', material }) });
    entries.push({ id: `template-cottage-2-${material}`, part: 'cottage', source: templateSchematic({ style: 'cottage', floors: 2, size: 'normal', material }) });
  }
  for (const material of ['oak_planks', 'cobblestone']) {
    entries.push({ id: `template-mansion-${material}`, part: 'mansion', source: templateSchematic({ style: 'mansion', floors: 2, size: 'normal', material }) });
    entries.push({ id: `template-tower-${material}`, part: 'tower', source: templateSchematic({ style: 'tower', floors: 3, size: 'normal', material }) });
  }
  return entries;
}

function fileEntries(dir = LIBRARY_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(file => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const source = raw.source || raw;
    return { id: file.replace(/\.json$/, ''), part: raw.part || source.part, origin: raw.origin, source };
  });
}

// Everything on the shelf that the executor can actually build here, with a
// summary a decision can be made from.
function library(registry, { dir = LIBRARY_DIR, parts = PARTS } = {}) {
  const entries = [];
  for (const entry of [...fileEntries(dir), ...templateEntries(), ...generatedEntries()]) {
    if (!parts.includes(entry.part)) continue;
    let validated;
    try { validated = validateSchematic(stripPart(entry.source), registry); } catch (err) { continue; }
    const [width, height, depth] = validated.source.size;
    entries.push({ id: entry.id, part: entry.part, origin: entry.origin, source: validated.source,
      summary: { name: validated.source.name, description: validated.source.description, size: `${width}x${depth}, ${height} tall`,
        blocks: validated.blocks.length, materials: Object.entries(validated.materials).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m, n]) => `${n} ${m.replaceAll('_', ' ')}`).join(', ') } });
  }
  return entries;
}
const stripPart = source => { const { part: _part, ...rest } = source; return rest; };

// Which design from the shelf suits this village. Jev sees what stands, in
// what materials and at what scale, and every candidate's summary.
async function chooseSchematic(client, { part, entries, structures = [], signal } = {}) {
  const candidates = entries.filter(e => e.part === part);
  if (!candidates.length) return null;
  if (candidates.length === 1 || !client) return { entry: candidates[0], judgments: null, usage: null };
  const options = Object.fromEntries(candidates.map(e => [e.id, `${e.summary.name}: ${e.summary.description || ''} ${e.summary.size}, ${e.summary.blocks} blocks, mostly ${e.summary.materials}.`]));
  const response = await client.systemOne({ signal, kind: 'design', state: {
    standing: structures.map(s => ({ name: s.name, request: s.request, size: s.size, materials: s.materials, distance: s.distance })),
    part, guidance: 'Pick the design that best fits beside the buildings already standing: matching or complementary materials, a scale in keeping with the rest, and variety across the village rather than the same house repeated. Every option is buildable here.',
  }, questions: { design: choice(`Which ${part} design should the bot build next for this village?`, options) } });
  const answer = response.answers?.design;
  if (!answer || !Object.hasOwn(options, answer.choice)) throw new Error('Jev chose a design that is not on the shelf');
  return { entry: candidates.find(e => e.id === answer.choice), judgments: answer, usage: response.usage };
}

module.exports = { library, chooseSchematic, templateEntries, fileEntries, PARTS, LIBRARY_DIR };

"""Extract factual recipe/tag data from the matching vanilla server jar.

Usage: python3 scripts/extract-knowledge.py path/to/server-26.1.jar
Minecraft-data supplies item identities and normal block drops at runtime. The
server's recipe catalog supplements it with ingredient alternatives and smelts.
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

jar = Path(sys.argv[1])
plain = lambda s: s.removeprefix('minecraft:')
with zipfile.ZipFile(jar) as archive:
    tags = {name.removeprefix('data/minecraft/tags/item/').removesuffix('.json'):
            json.loads(archive.read(name)).get('values', [])
            for name in archive.namelist() if name.startswith('data/minecraft/tags/item/') and name.endswith('.json')}
    block_tags = {name.removeprefix('data/minecraft/tags/block/').removesuffix('.json'):
                  json.loads(archive.read(name)).get('values', [])
                  for name in archive.namelist() if name.startswith('data/minecraft/tags/block/') and name.endswith('.json')}

    def block_values(value, visited=frozenset()):
        if isinstance(value, list):
            return sorted(set(v for element in value for v in block_values(element, visited)))
        if isinstance(value, dict):
            return block_values(value['id'], visited)
        if value.startswith('#'):
            tag = plain(value[1:])
            return [] if tag in visited else block_values(block_tags.get(tag, []), visited | {tag})
        return [plain(value)]
    resource_tags = {tag: block_values('#minecraft:' + tag) for tag in ['flowers', 'logs_that_burn']}

    def ingredient(value, visited=frozenset()):
        if isinstance(value, list):
            return sorted(set(v for element in value for v in ingredient(element, visited)))
        if isinstance(value, dict):
            return ingredient(value.get('item') or ('#' + value['tag'] if 'tag' in value else value['id']), visited)
        if value.startswith('#'):
            tag = plain(value[1:])
            if tag in visited:
                return []
            return ingredient(tags.get(tag, []), visited | {tag})
        return [plain(value)]

    recipes = {}
    smelting = {}
    for name in archive.namelist():
        if not name.startswith('data/minecraft/recipe/') or not name.endswith('.json'):
            continue
        data = json.loads(archive.read(name))
        kind = plain(data['type'])
        result = data.get('result')
        if not result:
            continue
        output = plain(result if isinstance(result, str) else result['id'])
        if kind == 'smelting':
            smelting.setdefault(output, set()).update(ingredient(data['ingredient']))
        elif kind in ('crafting_shaped', 'crafting_shapeless'):
            recipe = {'id': Path(name).stem, 'count': result.get('count', 1), 'category': data.get('category', 'misc')}
            if 'pattern' in data:
                recipe['shape'] = [[ingredient(data['key'][cell]) if cell != ' ' else None for cell in row] for row in data['pattern']]
            else:
                recipe['ingredients'] = [ingredient(value) for value in data['ingredients']]
            recipes.setdefault(output, []).append(recipe)

    # Preserve exact conditions for special block drops rather than assuming
    # the normal drops table represents shears/Silk Touch behavior.
    # Preserve the exact loot rules for the mob acquisition handlers. Random
    # counts remain random; the executor must verify actual inventory pickup.
    entity_loot = {entity: json.loads(archive.read(f'data/minecraft/loot_table/entities/{entity}.json'))
                   for entity in ['blaze', 'enderman', 'spider', 'cow', 'mooshroom', 'pig', 'sheep', 'chicken', 'rabbit']}
    special = {}
    ordinary_self = set()
    for name in archive.namelist():
        if not name.startswith('data/minecraft/loot_table/blocks/') or not name.endswith('.json'):
            continue
        block = Path(name).stem
        data = json.loads(archive.read(name))
        def visit(node, conditions=()):
            if isinstance(node, list):
                for child in node:
                    visit(child, conditions)
            elif isinstance(node, dict):
                active = (*conditions, *node.get('conditions', []))
                if node.get('type') == 'minecraft:item' and plain(node.get('name', '')) == block:
                    text = json.dumps(active)
                    if 'silk_touch' in text or 'minecraft:shears' in text:
                        special.setdefault(block, []).append(list(active))
                    elif 'minecraft:match_tool' not in text:
                        ordinary_self.add(block)
                for key in ('pools', 'entries', 'children'):
                    if key in node:
                        visit(node[key], active)
        visit(data)

output = {'version': '26.1', 'source': 'Vanilla Minecraft server recipe, item/block-tag, block-loot and supported entity-loot catalogs',
          'sha256': hashlib.sha256(jar.read_bytes()).hexdigest(),
          'recipes': recipes, 'smelting': {key: sorted(values) for key, values in smelting.items()},
          'specialDrops': special, 'ordinarySelfDrops': sorted(ordinary_self), 'resourceTags': resource_tags,
          'entityLoot': entity_loot,
          # FuelValues.vanillaBurnTimes adds #planks at 300 ticks, then removes
          # #non_flammable_wood. Keep membership from the matching server tags.
          'fuelPlanks': sorted(set(ingredient('#minecraft:planks')) - set(ingredient('#minecraft:non_flammable_wood')))}
destination = Path(__file__).resolve().parent.parent / 'data' / 'vanilla-26.1.json'
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps(output, separators=(',', ':')) + '\n')
print(json.dumps({'file': str(destination), 'craftableItems': len(recipes), 'smeltableItems': len(smelting), 'specialDrops': len(special)}))

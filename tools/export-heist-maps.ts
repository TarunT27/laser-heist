/** Writes the authoritative map geometry for the Blender environment build (tools/build_heist_hd.py). */
import { writeFileSync, mkdirSync } from 'node:fs';
import { MAPS } from '../shared/heist';
mkdirSync('art', { recursive: true });
writeFileSync('art/heist-maps.json', JSON.stringify(MAPS, null, 1));
console.log(`wrote art/heist-maps.json (${MAPS.length} maps)`);

/** Writes the getaway street grid for the Blender city build (tools/build_getaway_city.py). */
import { writeFileSync, mkdirSync } from 'node:fs';
import { BLOCKS, CITY, DROPOFF, HALF, HOUSE, roadAt } from '../client/heist/getaway-sim';
mkdirSync('art', { recursive: true });
const layout = { half: HALF, road: CITY.road, block: CITY.block, blocks: CITY.blocks, roads: Array.from({ length: CITY.blocks + 1 }, (_, k) => roadAt(k)), rects: BLOCKS, dropoff: DROPOFF, house: HOUSE };
writeFileSync('art/getaway-city.json', JSON.stringify(layout, null, 1));
console.log(`wrote art/getaway-city.json (${BLOCKS.length} blocks, ${layout.half * 2} m square)`);

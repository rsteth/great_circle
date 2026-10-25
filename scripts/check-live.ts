// Explicit opt-in: one bounded Overpass request, no retries. Never run on install/build.
import { writeFile } from 'node:fs/promises';
import { CLIENT_USER_AGENT, loadNetwork } from '../src/routing/overpass';
import { solve } from '../src/routing/solve';
import { toGpx } from '../src/routing/gpx';
import type { Settings } from '../src/routing/types';
const settings: Settings = { center: { lat: 49.289, lon: -123.128 }, start: { lat: 49.289, lon: -123.128 }, radiusM: 1000, targetKm: 3, tolerance: 0.2, surface: 'mixed', style: 'quiet' };
console.log('One bounded live request: Vancouver West End, 1 km search radius. No retries.');
const { data } = await loadNetwork(settings, new AbortController().signal, { userAgent: CLIENT_USER_AGENT });
await writeFile('/tmp/great-circle-live-osm.json', JSON.stringify(data));
console.log(`Received ${data.elements.length} actual OSM elements.`);
const route = solve(data, settings);
await writeFile('/tmp/great-circle-live.gpx', toGpx(route));
console.log(JSON.stringify({ distanceKm: route.lengthM / 1000, error: route.error, roundness: route.roundness, repeated: route.repeated, points: route.points.length, snapM: route.snapM, candidates: route.candidates, closed: JSON.stringify(route.points[0]) === JSON.stringify(route.points.at(-1)), notes: route.notes, timestamp: route.dataTimestamp }, null, 2));

import { offset } from '../src/routing/geo';
import type { OsmData, OsmNode, OsmWay, Settings } from '../src/routing/types';
export const center = { lat: 49.299, lon: -123.133 };
export function circleFixture(count = 64, radius = 1000): { data: OsmData; settings: Settings } {
  const nodes: OsmNode[] = Array.from({ length: count }, (_, i) => ({ type: 'node', id: i + 1, ...offset(center, radius * Math.cos(i * Math.PI * 2 / count), radius * Math.sin(i * Math.PI * 2 / count)) }));
  const way: OsmWay = { type: 'way', id: 1000, nodes: [...nodes.map(n => n.id), 1], tags: { highway: 'cycleway', surface: 'asphalt' } };
  return { data: { elements: [...nodes, way], osm3s: { timestamp_osm_base: '2026-10-25T12:00:00Z' } }, settings: { center, start: nodes[0], targetKm: 2 * Math.PI * radius / 1000, radiusM: 2500, style: 'quiet', surface: 'mixed', tolerance: 0.2 } };
}

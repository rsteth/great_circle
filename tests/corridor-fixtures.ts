import { compileCoverage, type Coverage } from '../src/routing/coverage';
import { offset } from '../src/routing/geo';
import { circleFixture, center } from './fixtures';
import type { OsmData, OsmNode, OsmWay } from '../src/routing/types';
export function selectCompleteWays(full: OsmData, coverage: Coverage): OsmData {
  // Mock the server's *query* buffer, before the client's conservative margin.
  const region = compileCoverage(coverage.kind === 'corridor' ? { ...coverage, clipMarginM: 0 } : { ...coverage, radiusM: coverage.radiusM + 25 });
  const nodes = new Map(full.elements.filter((element): element is OsmNode => element.type === 'node').map(node => [node.id, node]));
  const ways = full.elements.filter((element): element is OsmWay => element.type === 'way' && element.nodes.some((id, index) => index > 0 && nodes.has(id) && nodes.has(element.nodes[index - 1]) && region.intersects(nodes.get(id)!, nodes.get(element.nodes[index - 1])!)));
  const wayIds = new Set(ways.map(way => way.id)), nodeIds = new Set(ways.flatMap(way => way.nodes));
  const relations = full.elements.filter(element => element.type === 'relation' && element.members.some(member => member.type === 'way' && wayIds.has(member.ref)));
  return { elements: [...[...nodes.values()].filter(node => nodeIds.has(node.id)), ...ways, ...relations], osm3s: full.osm3s };
}
export function denseGrid(): OsmData {
  const nodes: OsmNode[] = [], ways: OsmWay[] = []; const count = 25;
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) nodes.push({ type: 'node', id: y * count + x + 1, ...offset(center, (x - 12) * 250, (y - 12) * 250) });
  const add = (a: number, b: number) => ways.push({ type: 'way', id: 10000 + ways.length, nodes: [a, b], tags: { highway: 'cycleway', surface: 'asphalt' } });
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) { const id = y * count + x + 1; if (x < count - 1) add(id, id + 1); if (y < count - 1) add(id, id + count); }
  return { elements: [...nodes, ...ways] };
}
export function ringRoads(bridge = false): OsmData {
  const original = circleFixture(64, 2000).data.elements.filter((element): element is OsmNode => element.type === 'node');
  const nodes = [...original]; let ids = nodes.map(node => node.id);
  if (bridge) {
    nodes.push({ type: 'node', id: 100, ...offset(center, 765.3668647, 2400) }, { type: 'node', id: 101, ...offset(center, -765.3668647, 2400) });
    ids = [...ids.slice(0, 13), 100, 101, ...ids.slice(20)];
  }
  ids.push(ids[0]);
  const ways: OsmWay[] = ids.slice(1).map((id, index) => ({ type: 'way', id: 10000 + index, nodes: [ids[index], id], tags: { highway: 'cycleway', surface: 'asphalt' } }));
  return { elements: [...nodes, ...ways] };
}
export function ruralTree(): OsmData {
  const nodes: OsmNode[] = Array.from({ length: 61 }, (_, index) => ({ type: 'node', id: index + 1, ...offset(center, (index - 30) * 100, 0) }));
  return { elements: [...nodes, ...nodes.slice(1).map((node, index): OsmWay => ({ type: 'way', id: 10000 + index, nodes: [nodes[index].id, node.id], tags: { highway: 'residential', surface: 'asphalt' } }))] };
}

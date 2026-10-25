import { describe, expect, it } from 'vitest';
import { bicycleAccess, buildGraph, directions, turnAllowed } from '../src/routing/graph';
import { angleDelta, distance, offset, roundness, trackLength } from '../src/routing/geo';
import { chooseAnchors, shortestPath, solve, validateSettings } from '../src/routing/solve';
import { toGpx } from '../src/routing/gpx';
import { queryFor } from '../src/routing/overpass';
import type { Edge, OsmData, OsmNode, OsmRelation, OsmWay } from '../src/routing/types';
import { center, circleFixture } from './fixtures';

describe('directed bicycle graph', () => {
  it('respects bicycle-specific direction and opposite lanes', () => {
    expect(directions({ oneway: 'yes' })).toEqual([true, false]);
    expect(directions({ oneway: 'reversible' })).toEqual([false, false]);
    expect(directions({ oneway: '-1' })).toEqual([false, true]);
    expect(directions({ junction: 'roundabout' })).toEqual([true, false]);
    expect(directions({ oneway: 'yes', 'oneway:bicycle': 'no' })).toEqual([true, true]);
    expect(directions({ oneway: 'yes', cycleway: 'opposite_lane' })).toEqual([true, true]);
    expect(directions({ oneway: 'yes', cycleway: 'opposite_lane', 'oneway:bicycle': 'yes' })).toEqual([true, false]);
    expect(directions({ 'bicycle:forward': 'no' })).toEqual([false, true]);
  });
  it('does not interpret motor-vehicle access as bicycle access', () => {
    expect(bicycleAccess({ highway: 'residential', motor_vehicle: 'no' })).toBe(true);
    expect(bicycleAccess({ highway: 'residential', access: 'private' })).toBe(false);
    expect(bicycleAccess({ highway: 'cycleway', access: 'no', bicycle: 'designated' })).toBe(true);
    expect(bicycleAccess({ highway: 'residential', bicycle: 'dismount' })).toBe(false);
    expect(bicycleAccess({ highway: 'residential', bicycle: 'destination' })).toBe(false);
    expect(bicycleAccess({ highway: 'path' })).toBe(false);
    expect(bicycleAccess({ highway: 'path', bicycle: 'yes' })).toBe(true);
    expect(bicycleAccess({ highway: 'steps', bicycle: 'yes' })).toBe(false);
    expect(bicycleAccess({ highway: 'residential', 'bicycle:conditional': 'no @ (sunset-sunrise)' })).toBe(false);
    expect(bicycleAccess({ barrier: 'gate' }, true)).toBe(false);
    expect(bicycleAccess({ barrier: 'gate', bicycle: 'yes' }, true)).toBe(true);
  });
  it('retains intermediate geometry and clips all edges to the search area', () => {
    const { data, settings } = circleFixture();
    data.elements.push({ type: 'node', id: 999, ...offset(center, 5000, 0) }, { type: 'way', id: 9999, nodes: [1, 999], tags: { highway: 'residential' } });
    const graph = buildGraph(data, settings);
    expect(graph.nodes.size).toBe(64);
    expect(graph.nodes.has(999)).toBe(false);
    expect(graph.edges.get(1)?.map(e => e.to).sort()).toEqual([2, 64]);
  });
  it('requires known paved tags in paved mode and removes blocked barrier nodes', () => {
    const { data, settings } = circleFixture();
    (data.elements[0] as OsmNode).tags = { barrier: 'gate', access: 'private' };
    expect(buildGraph(data, settings).nodes.has(1)).toBe(false);
    const way = data.elements.at(-1) as OsmWay;
    delete way.tags!.surface;
    expect(() => buildGraph(data, { ...settings, surface: 'paved' })).toThrow('No usable cycling network');
  });
  it('handles via-node restrictions, bicycle exceptions and conservative via-way exclusion', () => {
    const { data, settings } = circleFixture();
    const restriction: OsmRelation = { type: 'relation', id: 500, tags: { type: 'restriction', restriction: 'no_left_turn' }, members: [{ type: 'way', ref: 1000, role: 'from' }, { type: 'way', ref: 2000, role: 'to' }, { type: 'node', ref: 2, role: 'via' }] };
    data.elements.push(restriction);
    const graph = buildGraph(data, settings);
    const previous = graph.edges.get(1)!.find(e => e.to === 2)!;
    const forbidden = { ...previous, from: 2, to: 3, way: 2000 };
    expect(turnAllowed(graph, previous, forbidden)).toBe(false);
    expect(turnAllowed(graph, previous, { ...forbidden, way: 1000 })).toBe(true);
    restriction.tags!.restriction = 'only_right_turn';
    const only = buildGraph(data, settings);
    expect(turnAllowed(only, previous, forbidden)).toBe(true);
    expect(turnAllowed(only, previous, { ...forbidden, way: 1000 })).toBe(false);
    restriction.tags!.except = 'bus; bicycle';
    expect(buildGraph(data, settings).turns.size).toBe(0);
    restriction.tags!['restriction:bicycle:conditional'] = 'no_left_turn @ (Mo-Fr)';
    expect(() => buildGraph(data, settings)).toThrow('No usable cycling network');
    delete restriction.tags!['restriction:bicycle:conditional'];
    delete restriction.tags!.except;
    restriction.members[2] = { type: 'way', ref: 3000, role: 'via' };
    expect(() => buildGraph(data, settings)).toThrow('No usable cycling network');
  });
});

describe('circle search and export', () => {
  it('chooses distinct anchors inside each angular sector', () => {
    const { data, settings } = circleFixture();
    const graph = buildGraph(data, settings);
    const anchors = chooseAnchors(graph, 1, center, 1000, false)!;
    expect(anchors).toHaveLength(8);
    expect(new Set(anchors).size).toBe(8);
    anchors.forEach((id, i) => {
      const point = graph.nodes.get(id)!;
      const expected = offset(center, Math.cos(i * Math.PI / 4) * 1000, Math.sin(i * Math.PI / 4) * 1000);
      expect(distance(point, expected)).toBeLessThan(5);
    });
    expect(angleDelta(Math.PI * 2 - 0.1, 0.1)).toBeCloseTo(0.2);
  });
  it('finds a closed ring, reports true geometry distance, and exports every point', () => {
    const { data, settings } = circleFixture();
    const route = solve(data, settings);
    expect(route.points[0]).toEqual(route.points.at(-1));
    expect(route.points).toHaveLength(65);
    expect(route.roundness).toBeGreaterThan(0.99);
    expect(route.error).toBeLessThan(0.01);
    expect(route.repeated).toBe(0);
    expect(route.lengthM).toBeCloseTo(trackLength(route.points), 6);
    const gpx = toGpx(route, 'A & B <Ride>');
    expect(gpx.match(/<trkpt /g)).toHaveLength(route.points.length);
    expect(gpx).toContain('A &amp; B &lt;Ride&gt;');
    expect(gpx).toContain('version="1.1"');
    expect(gpx).toContain('OpenStreetMap contributors');
    expect(gpx).not.toMatch(/NaN|undefined/);
  });
  it('keeps a one-way ring directed all the way around', () => {
    const { data, settings } = circleFixture();
    (data.elements.at(-1) as OsmWay).tags!.oneway = 'yes';
    const route = solve(data, settings);
    const graph = buildGraph(data, settings);
    for (let i = 1; i < route.points.length; i++) {
      const from = [...graph.nodes].find(([, n]) => n.lat === route.points[i - 1].lat && n.lon === route.points[i - 1].lon)![0];
      const to = [...graph.nodes].find(([, n]) => n.lat === route.points[i].lat && n.lon === route.points[i].lon)![0];
      expect(graph.edges.get(from)!.some(e => e.to === to)).toBe(true);
    }
    expect(route.repeated).toBe(0);
  });
  it('fails honestly for impossible targets, disconnected graphs, and incomplete responses', () => {
    const { data, settings } = circleFixture();
    expect(() => solve(data, { ...settings, targetKm: 30, tolerance: 0.1 })).toThrow('No sufficiently circular');
    const disconnected = { ...data, elements: [...data.elements.filter(e => e.type === 'node'), { type: 'way' as const, id: 9001, nodes: Array.from({ length: 32 }, (_, i) => i + 1), tags: { highway: 'cycleway' } }, { type: 'way' as const, id: 9002, nodes: Array.from({ length: 32 }, (_, i) => i + 33), tags: { highway: 'cycleway' } }] };
    expect(() => solve(disconnected, settings)).toThrow('No sufficiently circular');
    expect(() => solve({ elements: [] }, settings)).toThrow('No usable cycling network');
    expect(() => solve({ ...data, remark: 'runtime error: timeout' }, settings)).toThrow('incomplete data');
    const line: OsmData = { elements: [...Array.from({ length: 6 }, (_, i) => ({ type: 'node' as const, id: i + 1, ...offset(center, 200 * i, 0) })), { type: 'way', id: 100, nodes: [1, 2, 3, 4, 5, 6], tags: { highway: 'cycleway' } }] };
    expect(() => solve(line, { ...settings, start: center })).toThrow('No sufficiently circular');
    expect(() => solve(data, { ...settings, start: offset(center, -2200, 0) })).toThrow('within 300 m');
    expect(roundness([center, offset(center, 100, 0), center])).toBe(0);
  });
  it('preserves incoming turn state across anchors and the start/finish seam', () => {
    const { data, settings } = circleFixture(16);
    const graph = buildGraph(data, settings);
    const previous: Edge = { from: 99, to: 1, way: 700, length: 10, factor: 1, surfaceKnown: true };
    graph.turns.set(1, [{ from: 700, to: 1000, only: false, uturn: false }]);
    expect(shortestPath(graph, 1, 3, { previous })).toBeNull();
    const incoming = graph.edges.get(16)!.find(e => e.to === 1)!;
    const first = graph.edges.get(1)!.find(e => e.to === 2)!;
    graph.turns.set(1, [{ from: incoming.way, to: first.way, only: false, uturn: false }]);
    expect(shortestPath(graph, 15, 1, { first })).toBeNull();
  });
  it('validates inputs and bounds the query to a single area with restriction relations', () => {
    const { settings } = circleFixture();
    expect(() => validateSettings({ ...settings, targetKm: NaN })).toThrow('target distance');
    expect(() => validateSettings({ ...settings, radiusM: 9000 })).toThrow('search radius');
    expect(() => validateSettings({ ...settings, start: offset(center, 10000, 0) })).toThrow('outside');
    expect(queryFor(settings)).toContain('[timeout:25][maxsize:33554432]');
    expect(queryFor(settings)).toContain('rel(bw.roads)["type"="restriction"]');
  });
});

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RoutingEngine } from '../src/routing/engine';
import { solve } from '../src/routing/solve';
import { buildGraph } from '../src/routing/graph';
import { toGpx } from '../src/routing/gpx';
import { distance, offset } from '../src/routing/geo';
import { circleFixture } from './fixtures';
import type { OsmData, Settings } from '../src/routing/types';

describe('prepared network reuse preserves route semantics', () => {
  it('reuses only the prepared graph across starts/tolerance and preserves exact GPX', () => {
    const { data, settings } = circleFixture(96, 850); settings.circleRadiusM = 850;
    const engine = new RoutingEngine(); engine.setData(data);
    const first = engine.solve(settings); expect(first.timing.graphCached).toBe(false);
    expect(toGpx(first.route)).toBe(toGpx(solve(data, settings)));
    const next = { ...settings, tolerance: 0.3, start: data.elements.find(element => element.type === 'node' && element.id === 25)! } as Settings;
    const second = engine.solve(next); expect(second.timing.graphCached).toBe(true);
    expect(toGpx(second.route)).toBe(toGpx(solve(data, next)));
    expect(second.timing.anchorNodeProjections).toBe(96); // shared for all six UI candidates
    expect(second.timing.pathExpansions).toBeGreaterThan(0);
    expect(second.timing.totalMs).toBeGreaterThanOrEqual(second.timing.searchMs);
  });
  it('keys prepared graphs by exact boundary and preferences; keeps only two', () => {
    const { data, settings } = circleFixture(); const engine = new RoutingEngine(); engine.setData(data);
    engine.solve(settings);
    expect(engine.solve({ ...settings, style: 'balanced' }).timing.graphCached).toBe(false);
    expect(engine.solve({ ...settings, radiusM: 2400 }).timing.graphCached).toBe(false);
    expect(engine.solve(settings).timing.graphCached).toBe(false); // LRU evicted first
    expect(engine.solve(settings).timing.graphCached).toBe(true);
    expect(engine.solve({ ...settings, surface: 'paved' }).timing.graphCached).toBe(false);
    engine.setData(structuredClone(data)); expect(engine.solve(settings).timing.graphCached).toBe(false);
  });
  it('does not reuse permissive graphs for paved-only or disconnected/changed bounds', () => {
    const fixture = circleFixture(); const data = structuredClone(fixture.data);
    for (const way of data.elements) if (way.type === 'way') way.tags!.surface = 'gravel';
    const engine = new RoutingEngine(); engine.setData(data); engine.solve(fixture.settings);
    expect(() => engine.solve({ ...fixture.settings, surface: 'paved' })).toThrow('No usable cycling network');
    const small = { ...fixture.settings, center: offset(fixture.settings.center, 800, 0), radiusM: 1000 };
    expect(() => engine.solve(small)).toThrow(); expect(() => solve(data, small)).toThrow();
  });
  it('keeps complete restriction relations while clipping a reused larger dataset', () => {
    const { data, settings } = circleFixture(64, 850);
    const outside = { type: 'node' as const, id: 5000, ...offset(settings.center, 1800, 0) };
    const expanded: OsmData = { elements: [...data.elements, outside,
      { type: 'way', id: 5001, nodes: [1, 5000], tags: { highway: 'residential', surface: 'asphalt' } },
      { type: 'relation', id: 6000, tags: { type: 'restriction', restriction: 'no_left_turn' }, members: [{ type: 'way', ref: 1000, role: 'from' }, { type: 'way', ref: 5001, role: 'to' }, { type: 'node', ref: 1, role: 'via' }] },
    ] };
    const selected = { ...settings, radiusM: 1000 };
    const graph = buildGraph(expanded, selected);
    expect(graph.nodes.has(5000)).toBe(false); expect(graph.turns.get(1)).toHaveLength(1);
    for (const edges of graph.edges.values()) for (const edge of edges) {
      expect(distance(graph.nodes.get(edge.from)!, selected.center)).toBeLessThanOrEqual(1000);
      expect(distance(graph.nodes.get(edge.to)!, selected.center)).toBeLessThanOrEqual(1000);
    }
    const engine = new RoutingEngine(); engine.setData(expanded);
    expect(toGpx(engine.solve(selected).route)).toBe(toGpx(solve(expanded, selected)));
  });
});

// Golden exports were produced by frozen published baseline cfb2be0, before any
// caching/precomputation changes. GPX includes exact traversed geometry/order.
describe('published-baseline route/export parity', () => {
  it('matches the frozen 512-node circle export byte for byte', () => {
    const { data, settings } = circleFixture(512, 1000); settings.circleRadiusM = 1000;
    const engine = new RoutingEngine(); engine.setData(data);
    for (let i = 0; i < 2; i++) expect(createHash('sha256').update(toGpx(engine.solve(settings).route)).digest('hex')).toBe('b13fd849200ce89df575cd0346bb715e98aea5ae9920590f6c888a89153a9cfc');
  });
  it('matches the frozen actual OSM export, metrics and prepared-cache result', () => {
    const raw = gunzipSync(readFileSync(new URL('./data/vancouver-west-end-2026-10-25.osm.json.gz', import.meta.url)));
    expect(createHash('sha256').update(raw).digest('hex')).toBe('ec1ddc51603b2b0f63c8ecf67970deab999ce9de200a638d127c9e59d6c28a16');
    const settings: Settings = { center: { lat: 49.289, lon: -123.128 }, start: { lat: 49.289, lon: -123.128 }, radiusM: 1000, targetKm: 3, tolerance: 0.2, surface: 'mixed', style: 'quiet' };
    const engine = new RoutingEngine(); engine.setData(JSON.parse(raw.toString()));
    for (let i = 0; i < 2; i++) {
      const { route, timing } = engine.solve(settings);
      expect(createHash('sha256').update(toGpx(route)).digest('hex')).toBe('8b10c1811ceb29398dab233977af79b5203cbd3ee5d5983c2baae9c4b034dbec');
      expect(route.points).toHaveLength(199); expect(route.lengthM).toBe(3264.457950349883); expect(route.candidates).toBe(28); expect(timing.graphCached).toBe(i === 1);
    }
  });
});

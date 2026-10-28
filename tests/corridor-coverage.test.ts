import { describe, expect, it } from 'vitest';
import { compileCoverage, coverageCost, coverageKey, covers, expandCoverage, initialCoverage, validateCoverage, type Corridor } from '../src/routing/coverage';
import { changeCircle, pointOnCircle } from '../src/circle';
import { offset } from '../src/routing/geo';
import { buildGraph, turnAllowed } from '../src/routing/graph';
import { solve } from '../src/routing/solve';
import { toGpx } from '../src/routing/gpx';
import { circleFixture } from './fixtures';
import type { OsmData } from '../src/routing/types';

describe('closed-polyline coverage semantics', () => {
  it('bounds a 10 km corridor by area/vertices independently of route variation', () => {
    const settings = changeCircle(circleFixture().settings, { radiusM: 10000 });
    const coverage = initialCoverage(settings) as Corridor;
    validateCoverage(coverage); expect(coverage.line).toHaveLength(97); expect(coverageCost(coverage).areaM2).toBeLessThan(110000000);
    expect(coverageKey(initialCoverage({ ...settings, tolerance: 0.3 }))).toBe(coverageKey(coverage));
    expect(() => validateCoverage({ ...coverage, halfWidthM: 5000 })).toThrow('budget');
  });
  it('rejects widened buffers crossing the unsupported date line', () => {
    const selected=changeCircle(circleFixture().settings,{center:{lat:49.289,lon:179.975},radiusM:500});
    const coverage=initialCoverage(selected) as Corridor;validateCoverage(coverage);
    expect(expandCoverage(coverage,[{lat:49.289,lon:179.9867}])).toBeUndefined();
  });
  it('never advertises an interior disk or a shifted ring as covered', () => {
    const settings = changeCircle(circleFixture().settings, { radiusM: 2000 });
    const coverage = initialCoverage(settings) as Corridor;
    expect(covers(coverage, { kind: 'disk', center: settings.center, radiusM: 200 })).toBe(false);
    expect(covers(coverage, initialCoverage(changeCircle(settings, { radiusM: 1900 })))).toBe(false);
    const expanded = expandCoverage(coverage, [pointOnCircle(settings.center, 2400, 90)])!;
    expect(covers(expanded, coverage)).toBe(true); expect(covers(coverage, expanded)).toBe(false);
    expect(compileCoverage(coverage).contains(settings.center)).toBe(false);
  });
  it('rejects a chord through the hole even with both endpoints in the band', () => {
    const settings = changeCircle(circleFixture().settings, { radiusM: 2000 }), coverage = initialCoverage(settings);
    const shape = compileCoverage(coverage), west = pointOnCircle(settings.center, 2000, 270), east = pointOnCircle(settings.center, 2000, 90);
    expect(shape.contains(west)).toBe(true); expect(shape.contains(east)).toBe(true); expect(shape.segment(west, east)).toBe(false);
    expect(shape.segment(pointOnCircle(settings.center, 2000, 85), east)).toBe(true);
  });
  it('allows a segment across overlapping known buffers, without endpoint-only shortcuts', () => {
    const center = circleFixture().settings.center;
    const line = [[-1000,0],[1000,0],[1000,1500],[-1000,1500],[-1000,0]].map(([x,y]) => offset(center,x,y));
    const coverage: Corridor = { kind:'corridor',center,line,halfWidthM:225,clipMarginM:25,patches:[] };
    expect(compileCoverage(coverage).segment(offset(center,-900,0),offset(center,900,0))).toBe(true);
    expect(compileCoverage(coverage).segment(offset(center,-1000,100),offset(center,1000,1400))).toBe(false);
  });
  it('preserves crossing ways and their turn rules while excluding unknown geometry', () => {
    const fixture = circleFixture(64,2000), settings=changeCircle(fixture.settings,{radiusM:2000});
    const centerNode={type:'node' as const,id:5000,...settings.center};
    const data:OsmData={elements:[...fixture.data.elements,centerNode,{type:'way',id:5001,nodes:[1,5000,33],tags:{highway:'residential',surface:'asphalt'}},{type:'relation',id:6000,tags:{type:'restriction',restriction:'no_left_turn'},members:[{type:'way',ref:1000,role:'from'},{type:'way',ref:5001,role:'to'},{type:'node',ref:1,role:'via'}]}]};
    const graph=buildGraph(data,settings,initialCoverage(settings));expect(graph.nodes.has(5000)).toBe(false);expect(graph.turns.get(1)).toHaveLength(1);
    expect(graph.frontier!.length).toBeGreaterThan(0);
    const previous=graph.edges.get(64)!.find(edge=>edge.to===1)!;expect(turnAllowed(graph,previous,{from:1,to:5000,way:5001,length:2000,factor:1,surfaceKnown:true})).toBe(false);
    const route=solve(data,settings,()=>{},{graph});expect(route.points).toHaveLength(65);expect(toGpx(route)).toBe(toGpx(solve(data,settings)));
  });
});

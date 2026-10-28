import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { changeCircle } from '../src/circle';
import { compileCoverage, coverageCost, expandCoverage, initialCoverage, CoverageGapError } from '../src/routing/coverage';
import { RoutingEngine } from '../src/routing/engine';
import { buildGraph, turnAllowed } from '../src/routing/graph';
import { distance, trackLength } from '../src/routing/geo';
import { toGpx } from '../src/routing/gpx';
import { planRoute } from '../src/routing/plan';
import { chooseAnchors, loopCore, returnableComponent, shortestPath, solve } from '../src/routing/solve';
import type { loadNetwork, NetworkResult } from '../src/routing/overpass';
import type { Edge, OsmData } from '../src/routing/types';
const read = (phase: string): OsmData => JSON.parse(gunzipSync(readFileSync(new URL(`./data/vancouver-corridor-${phase}-2026-10-28.osm.json.gz`, import.meta.url))).toString());
const selected=changeCircle({center:{lat:49.289,lon:-123.128},start:{lat:49.289,lon:-123.128},radiusM:1000,targetKm:3,tolerance:.3,surface:'mixed',style:'quiet'},{radiusM:500,bearing:180});
function expandedCoverage() {
  const coverage=initialCoverage(selected);if(coverage.kind!=='corridor')throw new Error('fixture coverage');
  let gaps;try{solve(read('initial'),selected,()=>{},{graph:loopCore(buildGraph(read('initial'),selected,coverage))});}catch(error){if(error instanceof CoverageGapError)gaps=error.gaps;else throw error;}
  if(!gaps)throw new Error('expected initial gap');return expandCoverage(coverage,gaps)!;
}
it('preserves the original 86% anchor failure and proves it also exists in the older same-center disk',()=>{
  const snapshots=[{data:read('expanded'),coverage:expandedCoverage()},{data:JSON.parse(gunzipSync(readFileSync(new URL('./data/vancouver-west-end-2026-10-25.osm.json.gz',import.meta.url))).toString()),coverage:undefined}];
  for(const {data,coverage} of snapshots){
    let graph=loopCore(buildGraph(data,selected,coverage));const start=[...graph.nodes.values()].sort((a,b)=>distance(a,selected.start)-distance(b,selected.start))[0];graph=returnableComponent(graph,start.id);
    let closest=Infinity;
    for(const scale of[1,.9,1.1])for(const clockwise of[true,false]){
      const radius=500*scale,anchors=chooseAnchors(graph,start.id,selected.center,radius,clockwise)!;const edges:Edge[]=[],used=new Set<string>();
      for(let i=0;i<anchors.length;i++){const path=shortestPath(graph,anchors[i],anchors[(i+1)%anchors.length],{previous:edges.at(-1),first:i===anchors.length-1?edges[0]:undefined,center:selected.center,radius,used});if(!path?.length)break;edges.push(...path);for(const edge of path)used.add(`${Math.min(edge.from,edge.to)}/${Math.max(edge.from,edge.to)}`);}
      if(edges.at(-1)?.to===start.id){const length=trackLength([start,...edges.map(edge=>graph.nodes.get(edge.to)!)]);closest=Math.min(closest,Math.abs(length-selected.targetKm*1000)/(selected.targetKm*1000));}
    }
    expect(closest).toBeCloseTo(.8646438453219065,10);
  }
});
it('replays both actual snapshots offline and recovers a valid loop using bounded alternative junction anchors', async () => {
  const snapshots=[read('initial'),read('expanded')],engine=new RoutingEngine();let index=0,totalBytes=0;let finalNetwork:NetworkResult|undefined;
  const load:typeof loadNetwork=async(settings,_signal,_client,options={})=>{
    const data=snapshots[index++],coverage=options.coverage??initialCoverage(settings),bytes=Buffer.byteLength(JSON.stringify(data)),cost=coverageCost(coverage);totalBytes+=bytes;
    options.budget!.remainingRequests--;options.budget!.remainingBytes-=bytes;options.budget!.remainingElements-=data.elements.length;
    return finalNetwork={data,datasetId:String(index),cached:false,coverage,sourceCoverage:coverage,timing:{fetchMs:0,parseMs:0,bytes,cacheHit:false,elements:data.elements.length,queryAreaM2:cost.areaM2,queryVertices:cost.vertices}};
  };
  const search=async(network:NetworkResult,settings:typeof selected,signal:AbortSignal,progress:(message:string)=>void)=>{signal.throwIfAborted();engine.setData(network.data,network.sourceCoverage);return{...engine.solve(settings,progress,network.coverage),transferMs:0};};
  const result=await planRoute(selected,new AbortController().signal,()=>{},search,{load});
  expect(index).toBe(2);expect(result.metrics.requests).toBe(2);expect(result.metrics.elements).toBe(22353);expect(result.metrics.bytes).toBe(totalBytes);expect(totalBytes).toBe(3018641);
  const route=result.route;expect(route.lengthM).toBeCloseTo(3729.6444202340294,6);expect(route.error).toBeLessThanOrEqual(.3);expect(route.roundness).toBeGreaterThanOrEqual(.3);expect(route.repeated).toBeLessThanOrEqual(.2);expect(route.notes.join(' ')).toContain('junction anchors');expect(route.points[0]).toEqual(route.points.at(-1));
  const graph=buildGraph(finalNetwork!.data,selected,finalNetwork!.coverage),known=compileCoverage(finalNetwork!.coverage),edges:Edge[]=[];
  const nodes=new Map([...graph.nodes.values()].map(node=>[`${node.lat}/${node.lon}`,node.id]));
  for(let i=1;i<route.points.length;i++){
    expect(known.segment(route.points[i-1],route.points[i])).toBe(true);
    const edge=graph.edges.get(nodes.get(`${route.points[i-1].lat}/${route.points[i-1].lon}`)!)!.find(edge=>edge.to===nodes.get(`${route.points[i].lat}/${route.points[i].lon}`))!;
    expect(edge).toBeDefined();expect(turnAllowed(graph,edges.at(-1),edge)).toBe(true);edges.push(edge);
  }
  expect(turnAllowed(graph,edges.at(-1),edges[0])).toBe(true);expect(toGpx(route).match(/<trkpt /g)).toHaveLength(route.points.length);
});

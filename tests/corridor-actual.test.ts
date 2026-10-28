import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { changeCircle } from '../src/circle';
import { coverageCost, initialCoverage } from '../src/routing/coverage';
import { RoutingEngine } from '../src/routing/engine';
import { planRoute, PlanningFailure } from '../src/routing/plan';
import type { loadNetwork, NetworkResult } from '../src/routing/overpass';
import type { OsmData } from '../src/routing/types';
const read = (phase: string): OsmData => JSON.parse(gunzipSync(readFileSync(new URL(`./data/vancouver-corridor-${phase}-2026-10-28.osm.json.gz`, import.meta.url))).toString());
it('replays the two actual snapshots offline and rejects the 86%-off-target candidate honestly', async () => {
  const selected=changeCircle({center:{lat:49.289,lon:-123.128},start:{lat:49.289,lon:-123.128},radiusM:1000,targetKm:3,tolerance:.3,surface:'mixed',style:'quiet'},{radiusM:500,bearing:180});
  const snapshots=[read('initial'),read('expanded')],engine=new RoutingEngine();let index=0,totalBytes=0;
  const load:typeof loadNetwork=async(settings,_signal,_client,options={})=>{
    const data=snapshots[index++],coverage=options.coverage??initialCoverage(settings),bytes=Buffer.byteLength(JSON.stringify(data)),cost=coverageCost(coverage);totalBytes+=bytes;
    options.budget!.remainingRequests--;options.budget!.remainingBytes-=bytes;options.budget!.remainingElements-=data.elements.length;
    return{data,datasetId:String(index),cached:false,coverage,sourceCoverage:coverage,timing:{fetchMs:0,parseMs:0,bytes,cacheHit:false,elements:data.elements.length,queryAreaM2:cost.areaM2,queryVertices:cost.vertices}};
  };
  const search=async(network:NetworkResult,settings:typeof selected,signal:AbortSignal,progress:(message:string)=>void)=>{signal.throwIfAborted();engine.setData(network.data,network.sourceCoverage);return{...engine.solve(settings,progress,network.coverage),transferMs:0};};
  let failure:unknown;try{await planRoute(selected,new AbortController().signal,()=>{},search,{load});}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(PlanningFailure);const stopped=failure as PlanningFailure;
  expect(stopped.phase).toBe('search');expect(stopped.message).toContain('86%');expect(index).toBe(2);
  expect(stopped.metrics.requests).toBe(2);expect(stopped.metrics.elements).toBe(8478+13875);expect(stopped.metrics.bytes).toBe(totalBytes);expect(totalBytes).toBeLessThan(32*1024*1024);
});

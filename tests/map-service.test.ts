import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeCircle, pointOnCircle } from '../src/circle';
import { expandCoverage, initialCoverage, type Corridor } from '../src/routing/coverage';
import { circleFixture } from './fixtures';
const fixture=circleFixture();
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T13:00:00Z'));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('explicit HTTP map-service failures, no live network',()=>{
 it('preserves HTTP 502 and visible Retry-After when discarding its body fails; never retries automatically',async()=>{
  const client=await import('../src/routing/overpass');const bad=new Response(new ReadableStream({cancel(){throw new TypeError('broken error body')}}),{status:502,headers:{'Retry-After':'120'}});const fetch=vi.fn().mockResolvedValueOnce(bad).mockImplementation(()=>Promise.resolve(Response.json(fixture.data)));vi.stubGlobal('fetch',fetch);
  let error:unknown;try{await client.loadNetwork(fixture.settings,new AbortController().signal);}catch(cause){error=cause;}expect(error).toBeInstanceOf(client.MapServiceError);expect((error as Error).message).toContain('HTTP 502: Bad Gateway');expect((error as Error).message).toContain('120 seconds');expect((error as InstanceType<typeof client.MapServiceError>).detail).toMatchObject({status:502,retryAfterSeconds:120,queryVertices:1,queryBytes:new TextEncoder().encode(client.queryFor(fixture.settings)).byteLength});
  await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toThrow('wait 120');vi.setSystemTime(Date.now()+119000);await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toThrow('wait 1');expect(fetch).toHaveBeenCalledTimes(1);vi.setSystemTime(Date.now()+1000);await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).resolves.toMatchObject({cached:false});expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('honors an HTTP-date Retry-After and falls back to 30 seconds for invalid headers',async()=>{
  for(const[header,seconds]of[[new Date(Date.now()+75000).toUTCString(),75],['bad-date',30],['9'.repeat(400),30]] as const){vi.resetModules();const client=await import('../src/routing/overpass');const fetch=vi.fn().mockResolvedValue(new Response('bad gateway',{status:502,headers:{'Retry-After':header}}));vi.stubGlobal('fetch',fetch);await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toMatchObject({detail:{status:502,retryAfterSeconds:seconds}});await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toThrow(`wait ${seconds}`);expect(fetch).toHaveBeenCalledTimes(1);}
 });
 it('keeps complete initial cached roads after an expansion 502, without caching its error body or extending coverage',async()=>{
  const client=await import('../src/routing/overpass'),selected=changeCircle(fixture.settings,{radiusM:2000}),base=initialCoverage(selected) as Corridor,expanded=expandCoverage(base,[pointOnCircle(selected.center,2300,90)])!;
  const fetch=vi.fn().mockResolvedValueOnce(Response.json(fixture.data)).mockResolvedValueOnce(new Response(JSON.stringify(fixture.data),{status:502,headers:{'Retry-After':'60'}})).mockImplementation(()=>Promise.resolve(Response.json(fixture.data)));vi.stubGlobal('fetch',fetch);
  const first=await client.loadNetwork(selected,new AbortController().signal);vi.setSystemTime(Date.now()+30000);await expect(client.loadNetwork(selected,new AbortController().signal,undefined,{coverage:expanded})).rejects.toThrow('502');const retained=await client.loadNetwork(selected,new AbortController().signal);expect(retained.cached).toBe(true);expect(retained.datasetId).toBe(first.datasetId);expect(retained.sourceCoverage).toEqual(base);expect(retained.coverage).toEqual(base);expect(retained.data).toBe(first.data);await expect(client.loadNetwork(selected,new AbortController().signal,undefined,{coverage:expanded})).rejects.toThrow('wait 60');expect(fetch).toHaveBeenCalledTimes(2);vi.setSystemTime(Date.now()+60000);const next=await client.loadNetwork(selected,new AbortController().signal,undefined,{coverage:expanded});expect(next.cached).toBe(false);expect(next.datasetId).not.toBe(first.datasetId);expect(next.sourceCoverage).toEqual(expanded);expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('reports the initial failing step/status in generation metrics and never starts search',async()=>{
  const client=await import('../src/routing/overpass'),{planRoute}=await import('../src/routing/plan');const fetch=vi.fn().mockResolvedValue(new Response('bad gateway',{status:502,headers:{'Retry-After':'45'}})),search=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(planRoute(fixture.settings,new AbortController().signal,()=>{},search,{load:client.loadNetwork})).rejects.toMatchObject({phase:'download',metrics:{requests:1,mapFailure:{stage:'initial',status:502,retryAfterSeconds:45}}});expect(fetch).toHaveBeenCalledTimes(1);expect(search).not.toHaveBeenCalled();
 });
 it('reports a connection-step failure while retaining initial coverage and never issuing a third request',async()=>{
  const client=await import('../src/routing/overpass'),{planRoute}=await import('../src/routing/plan'),coverage=await import('../src/routing/coverage');const selected=changeCircle(fixture.settings,{radiusM:2000}),fetch=vi.fn().mockResolvedValueOnce(Response.json(fixture.data)).mockResolvedValueOnce(new Response('bad gateway',{status:502}));vi.stubGlobal('fetch',fetch);
  const search=vi.fn(async()=>{vi.setSystemTime(Date.now()+30000);throw new coverage.CoverageGapError('gap',[selected.start]);});
  await expect(planRoute(selected,new AbortController().signal,()=>{},search,{load:client.loadNetwork})).rejects.toMatchObject({phase:'download',metrics:{requests:2,mapFailure:{stage:'connection',status:502,retryAfterSeconds:30}}});expect(fetch).toHaveBeenCalledTimes(2);expect(search).toHaveBeenCalledTimes(1);expect((await client.loadNetwork(selected,new AbortController().signal)).cached).toBe(true);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('ignores late aborted responses without replacing a newer backoff or caching stale roads',async()=>{
  for(const lateStatus of[200,502]){
   vi.resetModules();vi.setSystemTime(new Date('2026-10-28T13:00:00Z'));const client=await import('../src/routing/overpass');let resolve!:(response:Response)=>void;const fetch=vi.fn().mockImplementationOnce(()=>new Promise<Response>(done=>{resolve=done})).mockResolvedValueOnce(new Response('bad gateway',{status:502,headers:{'Retry-After':'120'}}));vi.stubGlobal('fetch',fetch);
   const controller=new AbortController(),pending=client.loadNetwork(fixture.settings,controller.signal).then(()=>undefined,error=>error);controller.abort();await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toThrow('wait 30');expect(fetch).toHaveBeenCalledTimes(1);
   vi.setSystemTime(Date.now()+30000);await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toMatchObject({detail:{status:502,retryAfterSeconds:120}});vi.setSystemTime(Date.now()+5000);
   resolve(lateStatus===200?Response.json(fixture.data):new Response('late gateway',{status:502,headers:{'Retry-After':'300'}}));expect(await pending).toMatchObject({name:'AbortError'});await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toThrow('wait 115');expect(fetch).toHaveBeenCalledTimes(2);
  }
 });

});

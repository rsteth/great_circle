import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeCircle, pointOnCircle } from '../src/circle';
import { expandCoverage, initialCoverage, type Corridor } from '../src/routing/coverage';
import { circleFixture } from './fixtures';
const fixture = circleFixture();
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(100000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('bounded polite corridor requests', () => {
  it('queries a closed buffered line with complete way nodes/relations, never inner-way subtraction', async () => {
    const client = await import('../src/routing/overpass'), selected = changeCircle(fixture.settings,{radiusM:10000});
    const query=client.queryFor(selected);expect(query).toContain('around:775,');expect(query).toContain('node(w.roads)');expect(query).toContain('rel(bw.roads)');expect(query).not.toContain('->.inner');expect(query.length).toBeLessThan(16000);
    const fetch=vi.fn().mockImplementation(()=>Promise.resolve(Response.json(fixture.data)));vi.stubGlobal('fetch',fetch);
    const first=await client.loadNetwork(selected,new AbortController().signal);expect(first.sourceCoverage.kind).toBe('corridor');expect(first.coverage.kind).toBe('corridor');
    const repeated=await client.loadNetwork({...selected,tolerance:0.3},new AbortController().signal);expect(repeated.cached).toBe(true);expect(repeated.datasetId).toBe(first.datasetId);expect(fetch).toHaveBeenCalledTimes(1);
    await expect(client.loadNetwork({...fixture.settings,center:selected.center,radiusM:1000},new AbortController().signal)).rejects.toThrow('wait');
  });
  it('reuses known expanded coverage but never mislabels its interior as complete', async () => {
    const client=await import('../src/routing/overpass'),selected=changeCircle(fixture.settings,{radiusM:2000});
    const base=initialCoverage(selected) as Corridor,expanded=expandCoverage(base,[pointOnCircle(selected.center,2300,90)])!;
    const fetch=vi.fn().mockImplementation(()=>Promise.resolve(Response.json(fixture.data)));vi.stubGlobal('fetch',fetch);
    const first=await client.loadNetwork(selected,new AbortController().signal,undefined,{coverage:expanded});
    const next=await client.loadNetwork(selected,new AbortController().signal);expect(next.cached).toBe(true);expect(next.coverage).toEqual(expanded);expect(next.datasetId).toBe(first.datasetId);
    await expect(client.loadNetwork({...fixture.settings,radiusM:1000},new AbortController().signal)).rejects.toThrow('wait');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('starts a full failure cooldown after a slow network failure, parse error and incomplete 200', async () => {
    const client=await import('../src/routing/overpass');const fetch=vi.fn().mockImplementationOnce(async()=>{vi.setSystemTime(Date.now()+45000);throw new TypeError('connection');}).mockImplementationOnce(()=>Promise.resolve(new Response('bad json'))).mockImplementationOnce(()=>Promise.resolve(Response.json({...fixture.data,remark:'timeout'})));vi.stubGlobal('fetch',fetch);
    for (const text of ['Could not reach','invalid data','incomplete data']) {
      await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toThrow(text);
      await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toThrow('wait 30');vi.setSystemTime(Date.now()+30000);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('bounds aggregate bytes/elements/requests and permits cancelling a cooldown wait', async () => {
    const client=await import('../src/routing/overpass'),selected=changeCircle(fixture.settings,{radiusM:2000});
    const base=initialCoverage(selected) as Corridor,expanded=expandCoverage(base,[selected.start])!;
    const fetch=vi.fn().mockImplementation(()=>Promise.resolve(Response.json(fixture.data)));vi.stubGlobal('fetch',fetch);
    const budget=client.newFetchBudget();budget.remainingBytes=JSON.stringify(fixture.data).length+5;
    await client.loadNetwork(selected,new AbortController().signal,undefined,{budget});expect(budget.remainingRequests).toBe(1);
    const controller=new AbortController();const waiting=client.loadNetwork(selected,controller.signal,undefined,{coverage:expanded,budget,waitForCooldown:true});controller.abort();await expect(waiting).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now()+30000);await expect(client.loadNetwork(selected,new AbortController().signal,undefined,{coverage:expanded,budget})).rejects.toThrow('byte budget');expect(fetch).toHaveBeenCalledTimes(2);expect(budget.remainingRequests).toBe(0);
    vi.setSystemTime(Date.now()+30000);await expect(client.loadNetwork({...selected,center:{lat:49.4,lon:-123.1},start:pointOnCircle({lat:49.4,lon:-123.1},2000,90)},new AbortController().signal,undefined,{budget})).rejects.toThrow('budget');expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects incomplete selected-way geometry and does not cache it', async () => {
    const client=await import('../src/routing/overpass'),fetch=vi.fn().mockResolvedValue(Response.json({elements:[{type:'way',id:1,nodes:[1,2],tags:{highway:'cycleway'}}]}));vi.stubGlobal('fetch',fetch);
    await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toThrow('incomplete way geometry');
    await expect(client.loadNetwork(fixture.settings,new AbortController().signal)).rejects.toThrow('wait 30');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('enforces the 10 km geometry/config maximum before any fetch', async () => {
    const client=await import('../src/routing/overpass'),selected=changeCircle(fixture.settings,{radiusM:10000});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(client.loadNetwork({...selected,circleRadiusM:10001},new AbortController().signal)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  });
});

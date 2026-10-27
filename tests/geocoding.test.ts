import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
let search:typeof import('../src/geocoding').searchPlaces;
const response=(features:unknown[])=>new Response(JSON.stringify({features}),{headers:{'Content-Type':'application/json'}});
const feature={geometry:{type:'Point',coordinates:[13.4,52.5]},properties:{name:'Berlin',city:'Berlin',country:'Germany'}};
beforeEach(async()=>{vi.resetModules();vi.useFakeTimers();vi.setSystemTime(100000);search=(await import('../src/geocoding')).searchPlaces;});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('manual Photon search',()=>{
  it('sends only query and limit; validates places and caches normalized queries',async()=>{
    const fetch=vi.fn().mockResolvedValue(response([feature,{...feature,geometry:{type:'Point',coordinates:[0,89]}}]));vi.stubGlobal('fetch',fetch);
    const result=await search(' Berlin ',new AbortController().signal);expect(result).toEqual([{point:{lat:52.5,lon:13.4},label:'Berlin, Germany'}]);
    const url=new URL(fetch.mock.calls[0][0]);expect([...url.searchParams]).toEqual([['q','Berlin'],['limit','5']]);
    expect(await search('berlin',new AbortController().signal)).toEqual(result);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('throttles uncached requests and honors Retry-After without automatic retry',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('',{status:429,headers:{'Retry-After':'120'}}));vi.stubGlobal('fetch',fetch);
    await expect(search('one',new AbortController().signal)).rejects.toThrow('429');vi.advanceTimersByTime(31000);await expect(search('two',new AbortController().signal)).rejects.toThrow('Wait');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts, rejects malformed/oversized data and does not cache failures',async()=>{
    const controller=new AbortController();controller.abort();const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(search('Berlin',controller.signal)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(new Response('{}'));await expect(search('Berlin',new AbortController().signal)).rejects.toThrow('invalid');vi.advanceTimersByTime(1100);
    fetch.mockResolvedValueOnce(new Response('x'.repeat(1048577)));await expect(search('Berlin',new AbortController().signal)).rejects.toThrow('too large');
  });
  it('forwards cancellation and bounds an unresponsive search',async()=>{
    vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason));})));
    const controller=new AbortController(), pending=search('Berlin',controller.signal);controller.abort();await expect(pending).rejects.toThrow();vi.advanceTimersByTime(1100);
    const timeout=search('Paris',new AbortController().signal);const check=expect(timeout).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(10001);await check;
  });
});

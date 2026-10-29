import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {exampleSettings,readSelection,writeSelection} from '../src/selection';
import {validateSettings} from '../src/routing/solve';
import {createLoopPlanner} from '../server/loop';
import {requestLoop} from '../src/loop/client';
it('accepts finite continuous variation within the existing 10–30% interval and preserves saved precision',()=>{
 for(const tolerance of [.1,.101,.173,.299,.3]){const settings={...exampleSettings(),tolerance};expect(()=>validateSettings(settings)).not.toThrow();let raw='';expect(writeSelection(settings,{setItem:(_key,value)=>{raw=value}})).toBe(true);expect(readSelection({getItem:()=>raw})?.tolerance).toBe(tolerance);}
 for(const tolerance of [NaN,Infinity,-Infinity,.099,.301,0,-1,'0.2',null])expect(()=>validateSettings({...exampleSettings(),tolerance:tolerance as number})).toThrow('Choose valid route preferences');
});
it('a fractional tolerance reaches the planner and its explicit larger-loop warning passes client validation',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./data/ors-la-intersection-2026-10-29.json',import.meta.url),'utf8'));let requests=0;
 const planner=createLoopPlanner({route:async()=>{const f=fixture.responses[requests++].body.features[0];return{points:f.geometry.coordinates.map(([lon,lat]:number[])=>({lat,lon})),distanceM:f.properties.summary.distance,waypoints:f.properties.way_points,surface:f.properties.extras.surface.values};}});
 const settings={...fixture.settings,tolerance:.173},result=await planner({settings,requestId:'fine-variation'},new AbortController().signal);expect(result.status).toBe('ok');if(result.status!=='ok')return;expect(result.route.distanceNotice?.tolerance).toBe(.173);expect(requests).toBe(2);
 const parsed=await requestLoop(settings,'fine-variation',new AbortController().signal,async()=>Response.json(result));expect(parsed).toEqual(result);
});

import { describe, expect, it } from 'vitest';
import { bearingTo, changeCircle } from '../src/circle';
import { exampleSettings, readSelection, SELECTION_KEY, writeSelection } from '../src/selection';
import { circleFixture } from './fixtures';
describe('verified initial example and one local user selection',()=>{
 it('uses the exact verified small case when no selection exists',()=>{
  expect(readSelection({getItem:()=>null})).toBeUndefined();const value=exampleSettings();expect(value.center).toEqual({lat:49.289,lon:-123.128});expect(value.circleRadiusM).toBe(500);expect(value.targetKm).toBeCloseTo(Math.PI);expect(bearingTo(value.center,value.start)).toBeCloseTo(180);expect(value.tolerance).toBe(.3);expect(value.style).toBe('quiet');expect(value.surface).toBe('mixed');
 });
 it('round-trips a chosen center, radius, Start and tolerance without migrating to the example',()=>{
  const selected=changeCircle(circleFixture().settings,{radiusM:2300,bearing:73,center:{lat:48.86,lon:2.35}});selected.tolerance=.1;const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}};
  expect(writeSelection(selected,storage)).toBe(true);expect([...values.keys()]).toEqual([SELECTION_KEY]);expect(readSelection(storage)).toEqual(selected);expect(readSelection(storage)?.center).not.toEqual(exampleSettings().center);
 });
 it('ignores invalid, corrupt, unknown-version or inaccessible storage without throwing',()=>{
  for(const raw of ['{','null',JSON.stringify({version:2,settings:exampleSettings()}),JSON.stringify({version:1,settings:{...exampleSettings(),circleRadiusM:10001}}),JSON.stringify({version:1,settings:{...exampleSettings(),center:{lat:NaN,lon:0}}})])expect(readSelection({getItem:()=>raw})).toBeUndefined();
  expect(readSelection({getItem:()=>{throw new Error('storage disabled')}})).toBeUndefined();expect(writeSelection(exampleSettings(),{setItem:()=>{throw new Error('storage disabled')}})).toBe(false);
 });
});

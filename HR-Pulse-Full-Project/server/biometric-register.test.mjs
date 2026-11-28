import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../public/attendance-module.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('const plT='),html.indexOf('function plTrip('));
function register(...days){
  const context=vm.createContext({PL:{ver:{}},DEDUP_MIN:5,GRACE:15,MIN_P:7,dutyCode:h=>h-1<4?'A':h-1<7?'HD':'P'});
  vm.runInContext(source,context);
  const employee=['E1','','Employee','Staff',days.join('')];
  return day=>context.plDay(employee,day);
}

test('C shift consumes the next calendar date OUT without a false missing punch or mismatch',()=>{
  const day=register('P2100----','P----0500');
  assert.equal(day(1).o,300);
  assert.equal(day(1).h,8);
  assert.equal(day(1).night,true);
  assert.equal(day(1).mism,false);
  assert.equal(day(2).continuation,true);
  assert.equal(day(2).mism,false);
  assert.equal(day(2).sys,'—');
});
test('calendar exports with morning OUT and evening IN support consecutive C duties',()=>{
  const day=register('P21002100','P05002100','P05002100','P05000500');
  for(const d of [1,2,3]){
    assert.equal(day(d).sh,'C');
    assert.equal(day(d).h,8);
    assert.equal(day(d).sys,'P');
  }
  assert.equal(day(4).continuation,true);
});
test('already paired overnight punches are not reassigned',()=>{
  const day=register('P21000500','P21000500');
  assert.equal(day(1).h,8);
  assert.equal(day(2).h,8);
});
test('preserves daytime duty IN when consuming a separate morning OUT',()=>{
  const day=register('P2100----','P06000500','P05001300');
  assert.equal(day(1).h,8);
  assert.equal(day(2).i,360);
  assert.equal(day(2).o,null);
  assert.equal(day(3).h,8);
});
test('does not steal an A shift pair or invent an OUT at the end of an upload',()=>{
  const day=register('P2100----','P05001300','P2100----');
  assert.equal(day(1).sys,'MP');
  assert.equal(day(2).h,8);
  assert.equal(day(3).sys,'MP');
});

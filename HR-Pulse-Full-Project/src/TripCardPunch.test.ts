import {expect,it} from 'vitest';
import html from '../public/attendance-module.html?raw';
import page from './AttendanceManagement.tsx?raw';

/* The Trip card punch tab (20 Nov 2026) lives in the legacy attendance module;
   run its sheet reader and day logic here with a stand-in Excel reader. */
const code=html.slice(html.indexOf('function rcParse('),html.indexOf('async function rcUpload('));
const d=(day:number)=>new Date(2026,1,day);
const sheet=[['EMPLOYEE ID','NAME','DESIGNATION',d(1),'DUTY',d(2),'DUTY',d(3),'DUTY'],
 ['E001','RAVI KUMAR','DUMPER OPERATOR','P',1,'P',2,0,null],
 ['E002','AMIT SINGH','DOZER OPERATOR',0,null,0,null,null,null],
 [null,'blank row']];
const XLSX={utils:{sheet_to_json:()=>sheet}};
const views:Record<string,unknown>={};
const api=new Function('XLSX','VIEWS','RC','pad','MON','tcase','esc','kpi','$','toast','AUDIT','R','loadXLSX',code+';return {tpParse,tpDay,tpMonth,TP};')(
 XLSX,views,{up:{}},(n:number)=>String(n).padStart(2,'0'),['Jan','Feb','Mar'],(x:string)=>x.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()),(x:string)=>x,()=>'',()=>({}),()=>{},[],()=>({}),async()=>{});

it('reads the trip card sheet into day by day trip card punches',()=>{
 const data=api.tpParse({SheetNames:['Operator'],Sheets:{Operator:{}}});
 expect(data.label).toBe('Feb 2026');expect(data.days).toBe(3);
 expect(data.emps.map((e:string[])=>[e[0],e[1],e[7]])).toEqual([['E001','Ravi Kumar','Operator'],['E002','Amit Singh','Operator']]);
 const [ravi,amit]=data.emps;
 expect([1,2,3].map(n=>api.tpDay(ravi,n))).toEqual([{st:'P',duty:1},{st:'P',duty:2},{st:'0',duty:0}]);
 expect(api.tpMonth(ravi)).toEqual({p:2,duties:3,dbl:1,na:0});
 expect(api.tpMonth(amit).p).toBe(0);
 expect(typeof views.tpunch).toBe('function');
});

it('adds the Trip card punch tab beside the ESSL punch log',()=>{
 expect(page).toContain(">Trip card punch</button>");
 expect(page).toContain("tab==='tripPunch'?'tpunch'");
 expect(page.indexOf('ESSL punch log (Excel)')).toBeLessThan(page.indexOf('>Trip card punch<'));
 expect(page.indexOf('>Trip card punch<')).toBeLessThan(page.indexOf('>Biometric vs trip card<'));
 expect(html).toContain("['tpunch','Trip Card Punch']");
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {loadHrDirectory} from './hr-directory-bridge.mjs';
test('requires employee report permission before querying records',async()=>{
 let queried=false;await assert.rejects(loadHrDirectory({pool:{query(){queried=true;}},profile:{permissions:{}},user:{}}),e=>e.status===403);assert.equal(queried,false);
});
test('projects the visible live roster only and excludes vacancies and private metadata',async()=>{
 const directory={sites:[{id:'s',label:'Sasti OB',group:'WCL'}],matrix:{'s|A':[{name:'Employee',empId:'E1',contact:'secret',passwordHash:'never-return'},{name:'',status:'VACANT'}]}};
 const result=await loadHrDirectory({pool:{query:async()=>({rows:[]})},profile:{permissions:{hrDesktopAccess:['Employee Master']}},user:{},masterNames:[],buildDirectory:()=>directory,mergeSuperiors:d=>d,viewerContext:()=>({}),forViewer:d=>({...d,matrix:{'s|A':d.matrix['s|A'].map(p=>({...p,contact:'**********'}))}})});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].contact,'**********');assert.equal(result.rows[0].passwordHash,undefined);assert.equal(result.rows[0].site,'Sasti OB');assert.equal(result.source,'Caliber Pulse C-Directory');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegram,sameTrialSubmission,nextFreeTrialNumber} from './telegram.mjs';
import {trialRoleLabels} from './trial-access.mjs';

const hierarchy={code:'NCL-DUDE',data:{group:'NCL',steps:Object.values(trialRoleLabels).map(label=>({label,approvers:['ankit']}))}};
const fields=(name,mobile='1234567894')=>({'Name of candidate':name,'Mobile no.':mobile});

test('a resend of the same Part 1 form keeps its number; another form holding it does not',()=>{
 const saved={site:'Dudhichua OB East',stage:'PART1',clientId:'a',fields:fields('Vishal')};
 assert.equal(sameTrialSubmission(saved,{site:'Dudhichua OB East',clientId:'a',fields:fields('Vishal')}),true);
 assert.equal(sameTrialSubmission(saved,{site:'Dudhichua OB East',clientId:'b',fields:fields('Vishal')}),false);
 assert.equal(sameTrialSubmission({...saved,site:'Jayant OB East'},{site:'Dudhichua OB East',clientId:'a',fields:fields('Vishal')}),false);
 assert.equal(sameTrialSubmission({...saved,fields:{...fields('Vishal'),Result:'PASS'}},{site:'Dudhichua OB East',clientId:'a',fields:fields('Vishal')}),false);
 const legacy={site:'Dudhichua OB East',stage:'PART1',fields:fields('Vishal')};
 assert.equal(sameTrialSubmission(legacy,{site:'Dudhichua OB East',clientId:'a',fields:fields(' vishal ')}),true);
 assert.equal(sameTrialSubmission(legacy,{site:'Dudhichua OB East',clientId:'a',fields:fields('Kamalakar','1234678992')}),false);
});

test('the next free number follows the highest number saved in the series',async()=>{
 let like='';
 const db={query:async(sql,values)=>{like=values[0];return {rows:[{code:'TF/2026-27/0001'},{code:'TF/2026-27/0012'},{code:'TF/2026-27/draft'}]};}};
 assert.equal(await nextFreeTrialNumber(db,'TF/2026-27/0001'),'TF/2026-27/0013');
 assert.equal(like,'TF/2026-27/%');
});

test('Part 1 whose number another site already used is saved under the next free number for the Driver Trainer',async()=>{
 const inserted=[];
 const db={release(){},query:async(sql,values=[])=>{
  if(sql.includes("kind='joiningHierarchies'"))return {rows:[hierarchy]};
  if(sql.includes("kind='trialForms' AND code=$1"))return {rows:values[0]==='TF/2026-27/0001'?[{id:'jayant',data:{site:'Jayant OB East',stage:'PART1',fields:fields('Someone else','9999999999')}}]:[]};
  if(sql.includes('code LIKE $1'))return {rows:[{code:'TF/2026-27/0001'},{code:'TF/2026-27/0004'}]};
  if(sql.startsWith('INSERT INTO hr_records')){inserted.push({code:values[0],data:values[2]});return {rows:[{id:'new-'+values[0]}]};}
  return {rows:[]};
 }};
 const out=await createTelegram({query:db.query,connect:async()=>db}).telegramApi({actor:'ankit',name:'Ankit Tiwari',permissions:{hrDesktopAccess:['Employee Master'],site:'NCL-DUDE'}},'trial-part1','POST',{
  site:'Dudhichua OB East',region:'NCL',group:'OB / COAL',company:'CMLL',department:'Driver',
  candidates:[{formNo:'TF/2026-27/0001',clientId:'local-1',fields:{...fields('Vishal Suresh Jadhao'),'Trial date & time':'2026-11-20T11:43'}}],
 });
 assert.deepEqual(out.formNos,['TF/2026-27/0005']);
 assert.deepEqual(inserted.map(row=>[row.code,row.data.stage,row.data.clientId]),[['TF/2026-27/0005','PART1','local-1']]);
 assert.match(out.telegram.message,/Form No: TF\/2026-27\/0005/);
});

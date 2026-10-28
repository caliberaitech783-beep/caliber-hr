import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAadhaarReader,cleanAadhaarResult} from './aadhaar-ocr.mjs';
const profile={actor:'tester',permissions:{hrDesktopAccess:['Employee Master']}};
const input={mime:'image/jpeg',content:Buffer.from([255,216,255,224]).toString('base64')};
const fields={name:'Test Person',dob:'2000-02-29',gender:'Female',uid:'',address:'D/O: Test Parent',relationName:'Test Parent',relationType:'D/O'};
const success=()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(fields)}]}}]}));
test('uses a server-only key and structured extraction in one request',async()=>{
 let calls=0;
 const read=createAadhaarReader({apiKey:'test-secret',fetchImpl:async(url,options)=>{calls++;assert.ok(url.endsWith(':generateContent'));assert.ok(!url.includes('test-secret'));assert.equal(options.headers['x-goog-api-key'],'test-secret');const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.contents[0].parts[0].inlineData.data,input.content);return success();}});
 assert.deepEqual((await read(profile,input)).details,fields);assert.equal(calls,1);
});
test('rejects unauthorized callers and invalid files before contacting Gemini',async()=>{
 const read=createAadhaarReader({apiKey:'test',fetchImpl:()=>{throw Error('must not call');}});
 await assert.rejects(read({...profile,permissions:{}},input),{status:403});
 await assert.rejects(read(profile,{...input,content:'abcd'}),{status:400});
 await assert.rejects(read(profile,{...input,mime:'application/pdf'}),{status:400});
});
test('does not expose upstream errors or automatically retry paid requests',async()=>{
 let calls=0;const read=createAadhaarReader({apiKey:'secret',fetchImpl:async()=>{calls++;return new Response('secret upstream details',{status:403});}});
 await assert.rejects(read(profile,input),error=>error.status===503&&!error.message.includes('secret'));assert.equal(calls,1);
});
test('limits repeated scans and resets the limit after one minute',async()=>{
 let time=100;const read=createAadhaarReader({apiKey:'test',fetchImpl:async()=>success(),now:()=>time});
 for(let i=0;i<6;i++)await read(profile,input);
 await assert.rejects(read(profile,input),{status:429});time+=60001;assert.ok(await read(profile,input));
});
test('rejects concurrent scans by one account and releases slot after failure',async()=>{
 let release;const read=createAadhaarReader({apiKey:'test',fetchImpl:()=>new Promise(resolve=>{release=resolve;})});
 const pending=read(profile,input);await assert.rejects(read(profile,input),{status:429});release(new Response('',{status:429}));await assert.rejects(pending,{status:429});
});
test('does not infer parent from care-of and clears malformed fields',()=>{
 const value=cleanAadhaarResult({...fields,dob:'2001-02-29',uid:'123456789012',gender:'unknown',relationType:'C/O'});
 assert.equal(value.dob,'');assert.equal(value.uid,'');assert.equal(value.gender,'');assert.equal(value.relationName,'');assert.equal(value.name,fields.name);
});
test('rejects truncated or invalid model output',async()=>{
 const read=createAadhaarReader({apiKey:'test',fetchImpl:async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]}))});
 await assert.rejects(read(profile,input),{status:502});
});

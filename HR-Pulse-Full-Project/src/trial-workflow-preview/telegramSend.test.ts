import {afterEach,expect,it,vi} from 'vitest';
import {sendPart1} from './telegramSend';
import {DOCS,type Trial} from './records';

afterEach(()=>{vi.restoreAllMocks();sessionStorage.clear();});

it('persists Aadhaar and driving licence files with the submitted trial',async()=>{
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
 const request=vi.spyOn(window,'fetch').mockResolvedValue(Response.json({batchId:'',telegram:{message:'',recipients:0,connected:[]}}));
 const row:Trial={id:'trial',formNo:'TF/2026-27/1',stage:'trainer',result:'',site:'Jayant OB East',name:'Candidate',father:'Parent',dob:'2000-01-01',mobile:'9876543210',aadhaar:'234500000000',address:'Address',dl:'DL1',dlValid:'2028-01-01',referredBy:'Referrer',employer:'',batch:'',createdAt:'2026-11-19',trialDate:'2026-11-19T10:00',photo:'',post:'Driver',experience:'1',vehicles:['Dumper/Tipper'],otherVehicle:'',docs:Object.fromEntries(DOCS.map(([key])=>[key,{seen:'',remarks:''}])) as Trial['docs'],history:[]};
 await sendPart1([row],{company:'CMLL',site:'Jayant OB East',region:'NCL',group:'OB / COAL',department:'Driver'},{aadhaar:new File(['aadhaar'],'aadhaar.jpg',{type:'image/jpeg'}),drivingLicence:new File(['licence'],'licence.jpg',{type:'image/jpeg'})});
 const body=JSON.parse(String(request.mock.calls[0][1]?.body));
 expect(body.candidates[0].clientId).toBe('trial');
 request.mockResolvedValue(Response.json({batchId:'',formNos:['TF/2026-27/0007'],telegram:{message:'',recipients:0,connected:[]}}));
 expect((await sendPart1([row],{company:'CMLL',site:'Jayant OB East',region:'NCL',group:'OB / COAL',department:'Driver'})).formNos).toEqual(['TF/2026-27/0007']);
 expect(body.candidates[0].attachments).toEqual(expect.arrayContaining([expect.objectContaining({kind:'aadhaar',name:'aadhaar.jpg'}),expect.objectContaining({kind:'drivingLicence',name:'licence.jpg'})]));
});

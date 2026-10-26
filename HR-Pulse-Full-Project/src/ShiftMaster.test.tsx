import {expect,it} from 'vitest';
import {blueprintShifts} from './ShiftMaster';
it('matches site-specific blueprint times without assigning unknown sites a schedule',()=>{
 expect(blueprintShifts({code:'CMLL-HO',name:'Chandrapur HO'}).map(r=>[r.startTime,r.endTime])).toEqual([['10:00','19:00']]);
 expect(blueprintShifts({code:'WCL-MAJRI',name:'Majri OB'})[2]).toMatchObject({startTime:'20:00',endTime:'04:00',nightShift:'Yes'});
 expect(blueprintShifts({code:'NCL-DUDE',name:'Dudhichua OB East'})[0].startTime).toBe('05:00');
 expect(blueprintShifts({code:'OTHER',name:'Unknown site'})).toEqual([]);
});

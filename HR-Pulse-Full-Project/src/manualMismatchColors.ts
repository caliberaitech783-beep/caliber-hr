export type ManualMismatchTone='match'|'absent-present'|'present-absent'|'miss-present'|'half-present'|'miss-absent'|'half-absent'|'other-difference'|'trip-only'|'bio-only'|'empty';

export const MANUAL_MISMATCH_LEGEND=[
 ['P / P','Both present','match'],
 ['A / A','Both absent','match'],
 ['A / P','Biometric absent · Trip present','absent-present'],
 ['P / A','Biometric present · Trip absent','present-absent'],
 ['MP / P','Biometric miss punch · Trip present','miss-present'],
 ['HD / P','Biometric half day · Trip present','half-present'],
 ['MP / A','Biometric miss punch · Trip absent','miss-absent'],
 ['HD / A','Biometric half day · Trip absent','half-absent'],
] as const;

export const MANUAL_MISMATCH_COLOURS:Record<ManualMismatchTone,{fill:string;text:string}>={
 match:{fill:'EAF3DE',text:'27500A'},
 'absent-present':{fill:'FAEEDA',text:'633806'},
 'present-absent':{fill:'FCEBEB',text:'791F1F'},
 'miss-present':{fill:'EEEDFE',text:'3C3489'},
 'half-present':{fill:'FFF3CD',text:'664D03'},
 'miss-absent':{fill:'FFD6F1',text:'8A075E'},
 'half-absent':{fill:'E6F1FB',text:'0C447C'},
 'other-difference':{fill:'F3E8FF',text:'5B216B'},
 'trip-only':{fill:'FAEEDA',text:'633806'},
 'bio-only':{fill:'FCEBEB',text:'791F1F'},
 empty:{fill:'F3F0F7',text:'6B5A80'},
};

export function manualMismatchTone(bio:string,trip:string):ManualMismatchTone{
 if(!bio&&!trip)return 'empty';
 if(!bio)return 'trip-only';
 if(!trip)return 'bio-only';
 if(bio===trip)return 'match';
 if(bio==='A'&&trip==='P')return 'absent-present';
 if(bio==='P'&&trip==='A')return 'present-absent';
 if(bio==='MP'&&trip==='P')return 'miss-present';
 if(bio==='HD'&&trip==='P')return 'half-present';
 if(bio==='MP'&&trip==='A')return 'miss-absent';
 if(bio==='HD'&&trip==='A')return 'half-absent';
 return 'other-difference';
}

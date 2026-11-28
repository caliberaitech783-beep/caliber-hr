export function requiredEmployeeDetail(label:string):boolean;
export function missingJoiningField(office?:Record<string,unknown>,options?:{workingHours?:boolean}):string|undefined;
export function siteProjectMismatch(office?:Record<string,unknown>):string;

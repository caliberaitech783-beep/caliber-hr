export type WorkingHoursEntry={sheet:string;row:number;employeeId:string;name:string;hours:string};
export type WorkingHoursProblem=WorkingHoursEntry&{reason:string};
export function readWorkingHoursSheets(sheets:{name:string;rows:unknown[][]}[]):{entries:WorkingHoursEntry[];problems:WorkingHoursProblem[];sheets:{sheet:string;rows:number;read:number;idColumn?:string;hoursColumn?:string;note?:string}[]};

export const WORKING_HOURS_FIELD:'Working Hours *';
export const WORKING_HOURS_OPTIONS:readonly string[];
export function normalizeWorkingHours(value:unknown):string|null;
export function sheetWorkingHours(value:unknown):string|null;
export function workingHoursProblem(value:unknown):string;
export function workingHoursNumber(value:unknown):number|null;

/* VTC Form rules on screen; the same as server/vtc.mjs (and Pulse-II's VTC Master). */
export const VTC_FIRST_DATE='2026-11-01',VTC_MAX_DAYS=92,VTC_DAYS_AHEAD=60;
const DAY=86_400_000;
export const indiaToday=(now=new Date())=>new Date(now.getTime()+330*60_000).toISOString().slice(0,10);

export function vtcProblem(data:Record<string,unknown>,today=indiaToday()){
  const from=String(data.fromDate||''),to=String(data.toDate||'');
  if(from&&from<VTC_FIRST_DATE)return 'From date must be on or after 01-11-2026.';
  if(from&&to&&to<from)return 'To date must be on or after the From date.';
  if(from&&to&&Math.round((Date.parse(to)-Date.parse(from))/DAY)+1>VTC_MAX_DAYS)return `A VTC course can be at most ${VTC_MAX_DAYS} days.`;
  const latest=new Date(Date.parse(today)+VTC_DAYS_AHEAD*DAY).toISOString().slice(0,10);
  if(from>latest||to>latest)return `Dates can be at most ${VTC_DAYS_AHEAD} days ahead of today.`;
  if(data.vtcStatus==='Completed'&&to&&to>today)return 'Completed can be chosen only when the To date is today or earlier.';
  return '';
}
export const latestVtcDate=(today=indiaToday())=>new Date(Date.parse(today)+VTC_DAYS_AHEAD*DAY).toISOString().slice(0,10);

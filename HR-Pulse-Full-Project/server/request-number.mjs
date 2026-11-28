/* Running request numbers, one count per kind that starts at 0001 and never resets.
   OD:        OD0001/<dd-mm-yyyy>/<Emp ID>      (date = OD from date)
   Gate pass: GP No.0001/<dd-mm-yyyy>/<Emp ID>  (date = pass date)
   VTC:       VTC0001/<dd-mm-yyyy>/<Caliber ID> (date = VTC from date)
   Transfer:  TR0001/<dd-mm-yyyy>/<Emp ID>      (date = transfer date)
   A request keeps its serial when edited; the date and Emp ID follow the saved values. */
const formats={
  outDutyRequests:{prefix:'OD',pattern:'^OD([0-9]+)/',lock:'hr-od-serial',date:'outDutyDate'},
  gatePasses:{prefix:'GP No.',pattern:'^GP No\\.([0-9]+)/',lock:'hr-gate-pass-serial',date:'passDate'},
  vtcRequests:{prefix:'VTC',pattern:'^VTC([0-9]+)/',lock:'hr-vtc-serial',date:'fromDate'},
  employeeTransfers:{prefix:'TR',pattern:'^TR([0-9]+)/',lock:'hr-transfer-serial',date:'transferDate'},
};
const ddmmyyyy=d=>{const s=String(d||'');return `${s.slice(8,10)}-${s.slice(5,7)}-${s.slice(0,4)}`;};
export const requestCode=(kind,serial,date,empCode)=>`${formats[kind].prefix}${String(serial).padStart(4,'0')}/${ddmmyyyy(date)}/${empCode||''}`;
export function requestSerial(kind,code){const m=new RegExp(formats[kind].pattern).exec(String(code||''));return m?Number(m[1]):0;}
export async function nextRequestCode(db,kind,existingCode,input){
  const f=formats[kind];
  const empCode=(await db.query("SELECT code FROM hr_records WHERE id::text=$1 AND kind='employees'",[String(input.employeeId||'')])).rows[0]?.code||String(input.empCode||'');
  let serial=requestSerial(kind,existingCode);
  if(!serial){
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[f.lock]);
    serial=Number((await db.query('SELECT COALESCE(MAX((substring(code from $2))::int),0)+1 AS next FROM hr_records WHERE kind=$1',[kind,f.pattern])).rows[0]?.next)||1;
  }
  return requestCode(kind,serial,input[f.date],empCode);
}

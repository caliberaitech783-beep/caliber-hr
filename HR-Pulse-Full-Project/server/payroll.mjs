import {siteIds} from './scope.mjs';

const fail = (message,status=400) => Object.assign(new Error(message),{status});
const groups = {
  structure:['basic','hra','fixedAllowance'],
  adjustments:['allowance','deduction'],
  overtime:['hours','hourlyRate'],
  bonus:['bonus','incentive'],
  statutory:['pf','esic','pt','tds'],
  settlement:['leaveEncashment','gratuity','otherDues','recovery','alreadyPaid']
};

function numbers(input,keys) {
  return Object.fromEntries(keys.map(key=>{
    const value=input[key];
    if(typeof value!=='number' || !Number.isFinite(value) || value<0 || value>100000000 ||
        Math.abs(value*100-Math.round(value*100))>0.00001) throw fail('Enter a valid amount for '+key);
    return [key,value];
  }));
}

const round = n => Math.round((n+Number.EPSILON)*100)/100;
export function calculatePayroll(structure,inputs,month) {
  const [year,m]=month.split('-').map(Number);
  const days=new Date(Date.UTC(year,m,0)).getUTCDate();
  const paidDays=inputs.paidDays??days;
  // A public holiday worked is paid twice (PH rule, owner 28 Nov 2026), so paid days may pass the month's days, never twice them.
  if(!Number.isFinite(paidDays)||paidDays<0||paidDays>days*2||!Number.isInteger(paidDays*2))
    throw fail('Paid days must be from 0 to twice the days of the month (a worked public holiday is paid twice), in whole or half days.');
  const earnings=Object.fromEntries(groups.structure.map(k=>[k,round(structure[k]*paidDays/days)]));
  Object.assign(earnings,{allowance:inputs.allowance??0,overtime:round((inputs.hours??0)*(inputs.hourlyRate??0)),bonus:inputs.bonus??0,incentive:inputs.incentive??0});
  const deductions=Object.fromEntries(['deduction',...groups.statutory].map(k=>[k,inputs[k]??0]));
  const sum=obj=>round(Object.values(obj).reduce((a,b)=>a+b,0));
  const gross=sum(earnings),withheld=sum(deductions);
  return {days,paidDays,earnings,deductions,gross,withheld,net:round(gross-withheld)};
}

const scoped="kind='employees' AND ($1::text[] IS NULL OR data->>'siteId'=ANY($1))";
export async function payroll(db,profile,method,params,input) {
  const menus=profile.permissions.hrDesktopAccess||[];
  if(!menus.includes('Payroll Management')) throw fail('Payroll Management is not assigned to your account.',403);
  const scope=await siteIds(db,profile);
  const employeeId=params.get('employee'), month=params.get('month');
  if(method==='GET'&&!employeeId) {
    return (await db.query(`SELECT id,code,name FROM hr_records WHERE ${scoped}
      AND (status IN ('ACTIVE','APPROVED','INACTIVE') OR EXISTS
      (SELECT 1 FROM hr_payroll_period WHERE employee_id=hr_records.id)) ORDER BY name,code`,[scope])).rows;
  }
  if(!employeeId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||month<'1900-01') throw fail('Select an employee and payroll month.');
  const employee=(await db.query(`SELECT id,name,code,status FROM hr_records WHERE ${scoped} AND id=$2 ${method==='POST'?'FOR UPDATE':''}`,[scope,employeeId])).rows[0];
  if(!employee) throw fail('Employee unavailable.',404);
  const history=(await db.query('SELECT month,amounts,reason FROM hr_salary_structure WHERE employee_id=$1 ORDER BY month DESC',[employeeId])).rows;
  const structure=history.find(s=>s.month<=month);
  const period=(await db.query('SELECT * FROM hr_payroll_period WHERE employee_id=$1 AND month=$2',[employeeId,month])).rows[0];
  const exit=(await db.query('SELECT month FROM hr_payroll_period WHERE employee_id=$1 AND settlement IS NOT NULL',[employeeId])).rows[0];
  const inputs=period?.inputs??{};
  const preview=structure?calculatePayroll(structure.amounts,inputs,month):null;
  if(method==='GET') return {employee,history,inputs,preview,version:period?.version??0,slip:period?.slip??null,settlement:period?.settlement??null,exitMonth:exit?.month??null};
  if(exit && (month>=exit.month || !period?.slip)) throw fail('Full and final settlement has closed this employee’s payroll.',409);
  const {action}=input;
  if(input.version!==(period?.version??0)||input.structureMonth!==(structure?.month??null))
    throw fail('Payroll changed. Reload the period before saving.',409);
  if(period?.slip && action!=='settlement') throw fail('This payroll is finalized.',409);
  if(['structure','revision'].includes(action)){
    if(!['ACTIVE','APPROVED'].includes(employee.status)) throw fail('Salary structures require an active employee.');
    if(action==='structure'?history.length>0:!structure||month<=history[0].month)
      throw fail('Use the initial structure once, then revise from a later month.',409);
    const later=await db.query('SELECT 1 FROM hr_payroll_period WHERE employee_id=$1 AND month >= $2 AND slip IS NOT NULL LIMIT 1',[employeeId,month]);
    if(later.rowCount) throw fail('A finalized payroll already covers this effective period.',409);
    const amounts=numbers(input,groups.structure);
    if(!amounts.basic) throw fail('Basic salary must be positive.');
    const reason=typeof input.reason==='string'?input.reason.trim():'';
    if(reason.length>500 || (action==='revision'&&!reason)) throw fail('Enter a revision reason of up to 500 characters.');
    await db.query('INSERT INTO hr_salary_structure(employee_id,month,amounts,reason,actor) VALUES($1,$2,$3,$4,$5)',[employeeId,month,amounts,reason,profile.actor]);
    await db.query("UPDATE hr_payroll_period SET inputs=inputs-'statutoryReviewed',version=version+1 WHERE employee_id=$1 AND month >= $2 AND slip IS NULL",[employeeId,month]);
  } else {
    if(!structure) throw fail('Save an effective salary structure first.');
    let slip=null,settlement=null;
    if(action==='finalize'){
      if(!inputs.statutoryReviewed) throw fail('Review and save statutory deductions before finalizing.');
      if(preview.net<0) throw fail('Deductions exceed earnings.');
      slip={...preview,employee:{name:employee.name,code:employee.code},month,structureMonth:structure.month};
    } else if(action==='settlement'){
      if(!period?.slip) throw fail('Finalize the last monthly payroll first.');
      const later=await db.query('SELECT 1 FROM hr_payroll_period WHERE employee_id=$1 AND month>$2 AND slip IS NOT NULL LIMIT 1',[employeeId,month]);
      if(later.rowCount) throw fail('Use the last finalized payroll month.');
      const values=numbers(input,groups.settlement);
      settlement={...values,net:round(period.slip.net+values.leaveEncashment+values.gratuity+values.otherDues-values.recovery-values.alreadyPaid)};
    } else if(action==='days'){
      calculatePayroll(structure.amounts,{...inputs,paidDays:numbers(input,['paidDays']).paidDays},month);
      inputs.paidDays=input.paidDays;
    } else if(['adjustments','overtime','bonus','statutory'].includes(action)){
      const values=numbers(input,groups[action]);
      if(action==='overtime'&&(values.hours>744 || (values.hours>0 && !values.hourlyRate))) throw fail('Check overtime hours and hourly rate.');
      Object.assign(inputs,values);
    } else throw fail('Unknown payroll operation.');
    if(!slip&&!settlement) inputs.statutoryReviewed=action==='statutory';
    await db.query(`INSERT INTO hr_payroll_period(employee_id,month,inputs,slip,settlement) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(employee_id,month) DO UPDATE SET inputs=excluded.inputs,version=hr_payroll_period.version+1,
      slip=COALESCE(hr_payroll_period.slip,excluded.slip),settlement=COALESCE(hr_payroll_period.settlement,excluded.settlement)`,[employeeId,month,inputs,slip,settlement]);
  }
  await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,'payroll',$3,$4)",[profile.actor,action,employeeId,{month}]);
  return {ok:true};
}

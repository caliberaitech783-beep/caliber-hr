import {useEffect,useState,type FormEvent} from 'react';
import {createPortal} from 'react-dom';
import './payroll.css';
import {api,downloadBlob} from './api';
import {CFG,PT_STATES,annTax,epf,pt,ptKey} from './salaryCalc';

type Employee={id:string;code:string;name:string};
type Amounts=Record<string,number>;
type Structure={month:string;amounts:Amounts;reason:string};
type Summary={paidDays:number;days:number;earnings:Amounts;deductions:Amounts;gross:number;withheld:number;net:number};
type Slip=Summary&{employee:Pick<Employee,'name'|'code'>;month:string;structureMonth:string};
type Period={history:Structure[];inputs:Partial<Amounts>&{statutoryReviewed?:boolean};version:number;preview:Summary|null;slip:Slip|null;settlement:Amounts|null;exitMonth:string|null};
const labels:Record<string,string>={
  basic:'Basic salary',hra:'House rent allowance',fixedAllowance:'Other fixed allowance',paidDays:'Paid days',
  allowance:'Additional allowance',deduction:'Other deduction',hours:'Overtime hours',hourlyRate:'Overtime rate per hour',
  overtime:'Overtime pay',bonus:'Bonus',incentive:'Incentive',pf:'Employee PF',esic:'Employee ESIC',pt:'Professional tax',tds:'TDS',
  leaveEncashment:'Leave encashment',gratuity:'Gratuity',otherDues:'Other dues',recovery:'Recovery',alreadyPaid:'Amount already paid',net:'Settlement balance'
};
const workflows=[
  {id:'structure',name:'Salary structure',fields:['basic','hra','fixedAllowance']},
  {id:'days',name:'Monthly payroll processing',fields:['paidDays']},
  {id:'revision',name:'Salary revision',fields:['basic','hra','fixedAllowance']},
  {id:'adjustments',name:'Allowances & deductions',fields:['allowance','deduction']},
  {id:'overtime',name:'Overtime calculations',fields:['hours','hourlyRate']},
  {id:'bonus',name:'Bonus & incentives',fields:['bonus','incentive']},
  {id:'slip',name:'Payslip generation',fields:[]},
  {id:'statutory',name:'PF / ESIC / PT / TDS',fields:['pf','esic','pt','tds']},
  {id:'settlement',name:'Full & final settlement',fields:['leaveEncashment','gratuity','otherDues','recovery','alreadyPaid']}
];
const money=(n:number)=>n.toLocaleString('en-IN',{style:'currency',currency:'INR'});
function summaryLines(s:Summary):[string,string][] {
  const amounts=(a:Amounts):[string,string][]=>Object.entries(a).map(([k,v])=>[labels[k],money(v)]);
  return [['Paid days',s.paidDays+' / '+s.days],...amounts(s.earnings),['Gross pay',money(s.gross)],...amounts(s.deductions),['Total deductions',money(s.withheld)],['Net pay',money(s.net)]];
}
function Breakdown({summary}:{summary:Summary}){
  return <div className="table-scroll"><table><tbody>{summaryLines(summary).map(([label,value])=><tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table></div>;
}
function downloadSlip(s:Slip){
  const text=['CALIBER HR · PAYSLIP',s.month,s.employee.name+' · '+s.employee.code,'',...summaryLines(s).map(line=>line.join('    '))].join('\r\n');
  downloadBlob('Payslip-'+s.employee.code+'-'+s.month+'.txt',new Blob([text],{type:'text/plain;charset=utf-8'}));
}

function StatutoryEstimate({summary,structure,month,onEstimate}:{summary:Summary;structure:Structure;month:string;onEstimate:(amounts:Amounts)=>void}){
  const [state,setState]=useState(''),[scheme,setScheme]=useState('STD');
  function estimate(){
    const monthNumber=Number(month.slice(5));
    const monthlySalary=Object.values(structure.amounts).reduce((sum,value)=>sum+value,0);
    const projectedTaxable=summary.gross+monthlySalary*11-CFG.std;
    onEstimate({
      pf:epf(summary.earnings.basic),
      esic:structure.amounts.basic<=CFG.esicLimit?Math.ceil(summary.earnings.basic*CFG.esicRate):0,
      pt:pt(summary.gross,ptKey(state,scheme),monthNumber),
      tds:Math.round(annTax(Math.max(0,projectedTaxable))/12)
    });
  }
  return <details><summary>Estimate using the Standard Salary master</summary>
    <p>Uses the project’s salary master and projects eleven full salary months for TDS. Review eligibility, state rules and year-to-date tax before saving.</p>
    <div className="record-form"><label>PT state<select value={state} onChange={e=>setState(e.target.value)}><option value="">Select state</option>{PT_STATES.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Standard scheme<select value={scheme} onChange={e=>setScheme(e.target.value)}><option value="STD">Standard Salary</option><option value="STDW">Standard Salary (Women)</option></select></label></div>
    <button type="button" disabled={!state} onClick={estimate}>Fill estimated deductions</button></details>;
}

export default function PayrollProcessing({grant}:{grant:string}){
  const [employees,setEmployees]=useState<Employee[]>([]),[employee,setEmployee]=useState('');
  const [tab,setTab]=useState('structure');
  const [payrollDate,setPayrollDate]=useState(()=>{
    const today=new Date();
    return [today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  });
  const month=payrollDate.slice(0,7);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let current=true;
    setLoading(true);setError('');
    api<Employee[]>(grant,'payroll').then(rows=>{if(current){setEmployees(rows);setEmployee(rows[0]?.id||'');}})
      .catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});
    return ()=>{current=false;};
  },[grant,retry]);
  return <section className="data-card"><h2>Payroll Processing</h2>
    <div className="payroll-workflows" role="group" aria-label="Payroll workflows">{workflows.map(x=><button type="button" key={x.id} aria-pressed={tab===x.id} onClick={()=>setTab(x.id)}>{x.name}</button>)}</div>
    {error&&<p role="alert" className="error">{error} <button onClick={()=>setRetry(retry+1)}>Retry</button></p>}
    {loading?<p role="status">Loading employees…</p>:!employees.length?<p>No employees available for payroll.</p>:<>
      <div className="record-form"><label>Employee<select value={employee} onChange={e=>setEmployee(e.target.value)}>{employees.map(e=><option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select></label>
      <label>Payroll date<input type="date" value={payrollDate} onChange={e=>setPayrollDate(e.target.value)}/></label></div>
      {month&&employee&&<EmployeePeriod key={grant+employee+month} grant={grant} employee={employee} month={month} tab={tab}/>}</>}
  </section>;
}

function EmployeePeriod({grant,employee,month,tab}:{grant:string;employee:string;month:string;tab:string}){
  const path='payroll?'+new URLSearchParams({employee,month});
  const [data,setData]=useState<Period|null>(null),[tick,setTick]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [estimate,setEstimate]=useState<Amounts|null>(null),[estimateVersion,setEstimateVersion]=useState(0);
  useEffect(()=>{
    let current=true;
    api<Period>(grant,path).then(result=>{if(current)setData(result);}).catch(e=>{if(current)setError(e.message);});
    return ()=>{current=false;};
  },[grant,path,tick]);
  function reload(){setData(null);setEstimate(null);setTick(n=>n+1);setError('');}
  const effective=data?.history.find(s=>s.month<=month);
  async function save(action:string,fields:Record<string,unknown>={}){
    if(!data||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      await api(grant,path,'POST',{action,...fields,version:data.version,structureMonth:effective?.month??null});
      setNotice(action==='finalize'?'Payroll finalized. Your payslip is ready.':'Saved.');
      reload();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const flow=workflows.find(x=>x.id===tab)!;
  const isStructure=tab==='structure'||tab==='revision';
  const locked=!!data?.exitMonth || (!!data?.slip && tab!=='settlement');
  const canEdit=!locked && (tab==='structure'?!data?.history.length:!!effective)
    && (tab!=='settlement'||!!data?.slip) && (tab!=='revision'||month>(data?.history[0]?.month??''));
  function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=new FormData(e.currentTarget);
    const values:Record<string,unknown>=Object.fromEntries(flow.fields.map(k=>[k,Number(form.get(k))]));
    if(tab==='revision')values.reason=form.get('reason');
    if(tab==='settlement'&&data?.slip){
      const balance=data.slip.net+Number(values.leaveEncashment)+Number(values.gratuity)+Number(values.otherDues)-Number(values.recovery)-Number(values.alreadyPaid);
      if(!window.confirm('Close payroll for this employee with a settlement balance of '+money(balance)+'?'))return;
    }
    void save(tab,values);
  }
  return <>
    {error&&<p className="error" role="alert">{error} <button onClick={reload}>Reload period</button></p>}
    {notice&&<p role="status">{notice}</p>}
    {!data?!error&&<p>Loading payroll…</p>:<>
      <h3>{flow.name}</h3>
      {data.exitMonth&&<p>Payroll closed with the {data.exitMonth} settlement.</p>}
      {!effective&&tab!=='structure'&&<p>Save a salary structure effective in or before this month.</p>}
      {isStructure&&data.history.length>0&&<div className="table-scroll"><table><thead><tr>{['Effective month','Basic salary','House rent allowance','Other fixed allowance','Revision reason'].map(s=><th key={s}>{s}</th>)}</tr></thead>
        <tbody>{data.history.map(s=><tr key={s.month}><td>{s.month}</td>{flow.fields.map(k=><td key={k}>{money(s.amounts[k])}</td>)}<td>{s.reason||'Initial structure'}</td></tr>)}</tbody></table></div>}
      {tab==='revision'&&!canEdit&&!locked&&effective&&<p>Select a month after the latest salary structure to record a revision.</p>}
      {tab==='statutory'&&<p>Enter the reviewed employee deductions for {month}. Save zero for any deduction that does not apply.</p>}
      {tab==='statutory'&&canEdit&&effective&&data.preview&&<StatutoryEstimate summary={data.preview} structure={effective} month={month} onEstimate={amounts=>{setEstimate(amounts);setEstimateVersion(n=>n+1);}}/>}
      {tab==='days'&&<p>Monthly salary components are prorated by paid days over the calendar days in this month.</p>}
      {tab==='settlement'&&<p>{data.slip?'Settlement includes final monthly net pay of '+money(data.slip.net)+'. Enter amounts already paid to avoid paying them twice.':'Finalize the employee’s last payroll month to calculate the settlement.'}</p>}
      {tab!=='slip'&&(canEdit||(!isStructure&&effective&&tab!=='settlement')||data.settlement&&tab==='settlement')&&<form key={tab+'-'+data.version+'-'+estimateVersion} onSubmit={submit}>
        <div className="record-form">{flow.fields.map(k=><label key={k}>{labels[k]}{!['hours','paidDays'].includes(k)&&' (₹)'}<input name={k} type="number" min="0" max={k==='paidDays'?data.preview?.days:undefined} step={k==='paidDays'?0.5:0.01} required disabled={!canEdit||busy}
          defaultValue={tab==='statutory'&&estimate?estimate[k]:isStructure?effective?.amounts[k]??0:tab==='settlement'?data.settlement?.[k]??0:k==='paidDays'?data.preview?.paidDays:data.inputs[k]??0}/></label>)}
          {tab==='revision'&&<label>Revision reason<input required maxLength={500} name="reason"/></label>}</div>
        {canEdit&&<div className="form-actions"><button disabled={busy} className="primary">{tab==='settlement'?'Finalize settlement':tab==='statutory'?'Save reviewed deductions':'Save '+flow.name.toLowerCase()}</button></div>}
      </form>}
      {tab==='overtime'&&data.preview&&<p>Overtime pay: {money(data.preview.earnings.overtime)}</p>}
      {tab==='days'&&data.preview&&<><h3>{data.slip?'Finalized payroll':'Payroll preview'}</h3><Breakdown summary={data.slip??data.preview}/>
        {!locked&&<div className="form-actions">{!data.inputs.statutoryReviewed&&<p>Review statutory deductions before finalizing.</p>}<button className="primary" disabled={busy||!data.inputs.statutoryReviewed} onClick={()=>{if(window.confirm('Finalize this monthly payroll and issue the payslip?'))void save('finalize');}}>Finalize monthly payroll</button></div>}</>}
      {tab==='slip'&&(data.slip?<><p>{data.slip.employee.name} · {data.slip.employee.code} · {data.slip.month}</p><Breakdown summary={data.slip}/>
        {createPortal(<article className="payroll-print"><h1>Caliber HR · Payslip</h1><p>{data.slip.employee.name} · {data.slip.employee.code} · {data.slip.month}</p><Breakdown summary={data.slip}/></article>,document.body)}
        <div className="form-actions"><button onClick={()=>downloadSlip(data.slip!)}>Download payslip (.txt)</button><button onClick={()=>window.print()}>Print / Save PDF</button></div></>:<p>The payslip will be available when monthly payroll is finalized.</p>)}
      {tab==='settlement'&&data.settlement&&<h3>Settlement balance {money(data.settlement.net)}</h3>}
    </>}
  </>;
}

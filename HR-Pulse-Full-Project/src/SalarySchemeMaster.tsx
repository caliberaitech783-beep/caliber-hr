import {useState} from 'react';
import {IndianRupee,Lock} from 'lucide-react';
import './shift-master.css';
import './salary-scheme-master.css';
import {CFG,DEFAULT_MESS_SITES,MESS_PLANS,SCH,SKILL_CATEGORIES} from './salaryCalc';
import UpdateSalaryScheme from './UpdateSalaryScheme';

/* Read-only view of the salary masters. Values are fixed in salaryCalc.ts (from Salary_Scheme_Master.xlsx
   and MESS_DEDUCTION_SITE_WISE.xlsx) and cannot be changed from the app. */
const TABS=['HPC Salary','Non-HPC Salary','Standard Salary','Update New Salary Scheme'] as const;
const schemeRows=()=>[{name:'Standard Salary (Corporate / Head Office)',pf:!!SCH.STD.pf,esic:!!SCH.STD.esic,pt:SCH.STD.pt?'As per state':'None',tds:!!SCH.STD.tds,remark:'Corporate / head office'},
 {name:'Standard Salary (Women)',pf:!!SCH.STDW.pf,esic:!!SCH.STDW.esic,pt:SCH.STDW.pt?'Women slab where the state has one':'None',tds:!!SCH.STDW.tds,remark:'Women PT slab picked automatically (e.g. Maharashtra – Women)'},
 {name:'Without Compliance',pf:!!SCH.WC.pf,esic:!!SCH.WC.esic,pt:SCH.WC.pt?'As per state':'None',tds:!!SCH.WC.tds,remark:'Salary paid without statutory deductions'}];
const FY_START='2026-04';
const inr=(n:number)=>'₹'+n.toLocaleString('en-IN');
const pct=(n:number)=>(n*100).toLocaleString('en-IN')+'%';
const wageRows=()=>SKILL_CATEGORIES.map(c=>({code:c.label.split(' – ')[0],category:c.label.split(' – ')[1],rate:c.value}));
const slabRows=()=>CFG.slabs.map((s,i)=>({from:s[0],to:CFG.slabs[i+1]?.[0]??null,rate:s[1]}));
const MONTHS=Array.from({length:12},(_,i)=>{const[y,mo]=FY_START.split('-').map(Number);const d=new Date(y,mo-1+i,1);return {label:d.toLocaleString('en-IN',{month:'short',year:'numeric'}),days:new Date(d.getFullYear(),d.getMonth()+1,0).getDate()};});
const V=({label,value,note}:{label:string;value:string;note?:string})=><div className="salary-kv"><span>{label}</span><b>{value}</b>{note&&<small>{note}</small>}</div>;

export default function SalarySchemeMaster({actor='',canApprove=false}:{actor?:string;canApprove?:boolean}){
 const[tab,setTab]=useState<typeof TABS[number]>('HPC Salary'),[scheme,setScheme]=useState(0),[,bump]=useState(0);
 const SCHEMES=schemeRows(),sch=SCHEMES[scheme],WAGE=wageRows(),SLABS=slabRows();
 return <section className="shift-master salary-scheme">
  <div className="shift-title"><span className="shift-icon"><IndianRupee/></span><div><small>MASTER CONFIGURATION · B5</small><h1>Salary Scheme Master</h1><p>Wage rates, calculation parameters, mess, TDS and scheme rules used by the Employment Details salary fields.</p></div></div>
  <div className="module-tabs salary-tabs" aria-label="Salary scheme menus">{TABS.map(t=><button type="button" key={t} className={tab===t?'selected':''} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</div>
  {tab!=='Update New Salary Scheme'&&<p className="salary-locked"><Lock/>Approved master – values can only change through "Update New Salary Scheme" with Director approval.</p>}

  {tab==='HPC Salary'&&<div className="shift-grid">
   <div>
    <div className="shift-card"><h2>1. HPC wage rate master (per day)</h2><div className="shift-table-wrap"><table><thead><tr><th>Code</th><th>Category</th><th>Daily wage rate (₹)</th><th>Gross for {CFG.days} days</th></tr></thead><tbody>
     {WAGE.map(w=><tr key={w.code}><td><b>{w.code}</b></td><td>{w.category}</td><td>{inr(w.rate)}</td><td>{inr(w.rate*CFG.days)}</td></tr>)}
    </tbody></table></div><p className="shift-footnote">Source: HPC (High Power Committee) rates. Govt Wage Rate on the joining form is picked from this table by Skill Category.</p></div>
    <div className="shift-card"><h2>2. Calculation parameters</h2><div className="salary-kvs">
     <V label="Basic days limit" value={String(CFG.days)} note="Earnings up to this many paid days = Basic (A); days above = Other Allowance (B)"/>
     <V label="EPF rate" value={pct(CFG.epfRate)+' of Basic'} note="Applied on Basic when Basic ≤ ceiling"/>
     <V label="EPF Basic ceiling" value={inr(CFG.epfCeil)} note="Basic above this → fixed EPF"/>
     <V label="EPF fixed amount above ceiling" value={inr(CFG.epfFixed)} note="Fixed EPF when Basic > ceiling"/>
     <V label="ESIC" value="Not applicable at NCL"/>
     <V label="Mess deduction" value="See site-wise mess master (3)"/>
    </div></div>
    <div className="shift-card"><h2>4. TDS master – new tax regime (Sec 115BAC)</h2><div className="salary-kvs">
     <V label="Standard deduction" value={inr(CFG.std)+' / year'}/>
     <V label="Sec 87A rebate – taxable income limit" value={inr(CFG.rebate)} note="Up to this → no tax; marginal relief just above"/>
     <V label="Health & education cess" value={pct(CFG.cess)} note="On tax after rebate"/>
     <V label="Projection months" value="12"/>
    </div><div className="shift-table-wrap" style={{marginTop:18}}><table><thead><tr><th>Income above (₹)</th><th>Up to (₹)</th><th>Tax rate</th></tr></thead><tbody>
     {SLABS.map((s,i)=><tr key={i}><td>{inr(s.from)}</td><td>{s.to===null?'and above':inr(s.to)}</td><td>{pct(s.rate)}</td></tr>)}
    </tbody></table></div></div>
   </div>
   <div>
    <div className="shift-card"><h2>Calculation flow – HPC rate</h2><ol className="salary-flow">
     <li><b>Paid days</b> = P (present) + Leave</li><li><b>Wage earnings</b> = Wage rate × Paid days</li><li><b>Gross</b> = Wage earnings + Other income</li>
     <li><b>A – Basic</b> = Wage rate × Paid days, up to {CFG.days} days</li><li><b>B – Other Allowance</b> = Wage rate × days above {CFG.days}</li>
     <li><b>EPF</b> on Basic: ≤ {inr(CFG.epfCeil)} → {pct(CFG.epfRate)}; above → {inr(CFG.epfFixed)}</li><li><b>ESIC</b> nil (NCL)</li><li><b>PT</b> as per employee PT State (PT Master)</li><li><b>Mess</b> as per site-wise mess master</li>
     <li><b>TDS</b> new regime, year-to-date method</li><li><b>Net</b> = Gross − deductions · <b>Ex-gratia</b> = Wage rate × (OT + PH days) · <b>Payable</b> = Net + Ex-gratia</li></ol></div>
   </div>
  </div>}

  {tab==='Non-HPC Salary'&&<div className="shift-grid">
   <div>
    <div className="shift-card"><h2>1. Scheme rules</h2><div className="shift-table-wrap"><table><thead><tr><th>Rule</th><th>Value</th><th>Note</th></tr></thead><tbody>
     <tr><td>Basic unit-days cap</td><td>{CFG.days}</td><td>Basic = Govt rate × MIN(Unit days, cap)</td></tr>
     <tr><td>Per-day salary</td><td>Salary ÷ Month days</td><td>Rounded to nearest rupee: paise below 50 → down, 50 and above → up</td></tr>
     <tr><td>Unit days</td><td>Earnings ÷ Govt rate</td><td>Rounded to 2 decimals</td></tr>
     <tr><td>Other Allowance</td><td>Earnings − Basic</td><td>Keeps Basic + Other Allowance = Earnings exactly</td></tr>
     <tr><td>Ex-gratia (OT / PH)</td><td>Per-day salary × days</td><td>Not the govt wage rate</td></tr>
     <tr><td>Deductions</td><td>Same as HPC</td><td>EPF, ESIC nil, PT, Mess, TDS – see HPC Salary</td></tr>
    </tbody></table></div></div>
    <div className="shift-card"><h2>Calculation flow – Non-HPC (fixed salary)</h2><ol className="salary-flow">
     <li><b>Month days</b> = days in the payroll month (28 / 29 / 30 / 31)</li><li><b>Per-day salary</b> = ROUND(Fixed monthly salary ÷ Month days)</li><li><b>Salary earnings</b> = Per-day salary × Paid days</li><li><b>Gross</b> = Salary earnings + Other income</li>
     <li><b>Unit days</b> = Salary earnings ÷ Govt wage rate of the category</li><li><b>A – Basic</b> = Govt wage rate × MIN(Unit days, {CFG.days})</li><li><b>B – Other Allowance</b> = Salary earnings − Basic</li>
     <li><b>Deductions</b> same as HPC: EPF on Basic, ESIC nil, PT slab, Mess, TDS</li><li><b>Net</b> = Gross − deductions · <b>Ex-gratia</b> = Per-day salary × (OT + PH days) · <b>Payable</b> = Net + Ex-gratia</li></ol></div>
   </div>
   <div>
    <div className="shift-card"><h2>2. Month days master (FY {FY_START.slice(0,4)}-{+FY_START.slice(2,4)+1})</h2><div className="shift-table-wrap"><table><thead><tr><th>Month</th><th>Days</th></tr></thead><tbody>{MONTHS.map(x=><tr key={x.label}><td>{x.label}</td><td>{x.days}</td></tr>)}</tbody></table></div><p className="shift-footnote">Used for the Non-HPC per-day salary (Salary ÷ Month days).</p></div>
    <div className="shift-card"><h2>Govt wage rate (linked from HPC master)</h2><div className="shift-table-wrap"><table><thead><tr><th>Code</th><th>Category</th><th>Govt rate (₹/day)</th></tr></thead><tbody>{WAGE.map(w=><tr key={w.code}><td><b>{w.code}</b></td><td>{w.category}</td><td>{inr(w.rate)}</td></tr>)}</tbody></table></div></div>
   </div>
  </div>}

  {(tab==='HPC Salary'||tab==='Non-HPC Salary')&&<div className="shift-card salary-sites"><h2>3. Site-wise mess deduction master</h2><div className="shift-table-wrap"><table><thead><tr><th>Site</th><th>Company</th><th>Category</th><th>Duty / rate type</th><th>Deduction</th><th>Food</th><th>Remark</th></tr></thead><tbody>
   {DEFAULT_MESS_SITES.map(S=>{const rows=S.plans?1:Math.max(S.rules.length,1),head=<><td rowSpan={rows}><b>{S.site}</b></td><td rowSpan={rows}>{S.company}</td></>;
    if(S.plans)return <tr key={S.site} className="salary-site-first">{head}<td colSpan={5}><b>Mess plan – worker chooses:</b> {MESS_PLANS.filter(p=>p.t!=='none').map(p=>p.label).join(', ')}<small>Applies to HPC and Non-HPC, Camp and Non-Camp. Per day = rate × paid days · Per month = fixed amount.</small></td></tr>;
    if(!S.rules.length)return <tr key={S.site} className="salary-site-first">{head}<td colSpan={5}>No deduction</td></tr>;
    return S.rules.map((r,ri)=><tr key={S.site+ri} className={ri===0?'salary-site-first':''}>{ri===0&&head}<td>{r.category==='Camp'?'Camp (Non-local)':'Non-Camp (Local)'}</td><td>{r.duty==='HPC'?'HPC Rate (8 hrs duty)':'Fixed Rate (12 hrs duty)'}</td><td>{r.rate?`₹${r.rate} per ${r.per}`:'No deduction'}</td><td>{r.food}</td><td>{r.remark}</td></tr>);})}
  </tbody></table></div><p className="shift-footnote">From MESS_DEDUCTION_SITE_WISE. At Sasti OB the ₹100 / ₹70 Fixed-rate rows are individually approved rates offered as "Special Approval (food)" on the joining form. Mess does not apply to Standard schemes.</p></div>}

  {tab==='Standard Salary'&&<>
   <div className="module-tabs salary-subtabs" aria-label="Standard salary schemes">{SCHEMES.map((s,i)=><button type="button" key={s.name} className={scheme===i?'selected':''} aria-pressed={scheme===i} onClick={()=>setScheme(i)}>{s.name}</button>)}</div>
   <div className="shift-grid">
    <div>
     <div className="shift-card"><h2>1. Salary structure – {sch.name}</h2><div className="salary-kvs">
      <V label="A – Basic" value={pct(CFG.basicPct)+' of earned gross'}/>
      <V label="B – HRA" value={pct(CFG.hraPct)+' of Basic'}/>
      <V label="C – Medical" value={inr(CFG.medical)+' per month'} note="Paid on paid days: Medical × Paid days ÷ Month days"/>
      <V label="D – Special Allowance" value="Balance" note="Earned gross − (A + B + C)"/>
      <V label="E – Other Allowance" value="Per employee" note="Entered monthly in the salary summary"/>
     </div></div>
     <div className="shift-card"><h2>2. Statutory deduction rules</h2>{sch.pf||sch.esic?<div className="salary-kvs">
      <V label="PF rate on Basic" value={pct(CFG.epfRate)} note={`Basic ₹0 – ${inr(CFG.epfCeil)} → ${pct(CFG.epfRate)} of Basic`}/>
      <V label="PF Basic ceiling" value={inr(CFG.epfCeil)} note="Linked to HPC master"/>
      <V label="PF fixed above ceiling" value={inr(CFG.epfFixed)}/>
      <V label="ESIC rate on Basic" value={pct(CFG.esicRate)} note="Employee share, rounded up"/>
      <V label="ESIC Basic limit" value={inr(CFG.esicLimit)} note="Basic above this → nil ESIC (checked on full-month Basic)"/>
     </div>:<p className="shift-help">Without Compliance: salary is paid without PF, ESIC, PT or TDS deductions. Mess / food deduction does not apply to Standard schemes either.</p>}</div>
    </div>
    <div>
     <div className="shift-card"><h2>3. Scheme matrix – which deductions apply</h2><div className="shift-table-wrap"><table><thead><tr><th>Scheme</th><th>PF</th><th>ESIC</th><th>PT slab</th><th>TDS</th></tr></thead><tbody>
      {SCHEMES.map((s,i)=><tr key={s.name} className={scheme===i?'salary-current':'salary-row'} onClick={()=>setScheme(i)}><td>{s.name}<small>{s.remark}</small></td><td>{s.pf?'Y':'N'}</td><td>{s.esic?'Y':'N'}</td><td>{s.pt}</td><td>{s.tds?'Y':'N'}</td></tr>)}
     </tbody></table></div><p className="shift-footnote">TDS is income tax and applies by law when taxable income exceeds the rebate limit. PT: state-wise PT Master (Maharashtra has separate men / women slabs).</p></div>
     <div className="shift-card"><h2>Calculation flow – Standard salary</h2><ol className="salary-flow">
      <li><b>Earned gross</b> = Monthly gross × Paid days ÷ Month days (Paid days = P + WO + Leave)</li><li><b>A – Basic</b> = {pct(CFG.basicPct)} of Earned gross</li><li><b>B – HRA</b> = {pct(CFG.hraPct)} of Basic</li>
      <li><b>C – Medical</b> = {inr(CFG.medical)} × Paid days ÷ Month days</li><li><b>D – Special Allowance</b> = Earned gross − (A + B + C)</li><li><b>E – Other Allowance</b> per employee</li>
      {sch.pf&&<li><b>PF</b> on Basic: ≤ {inr(CFG.epfCeil)} → {pct(CFG.epfRate)}; above → {inr(CFG.epfFixed)}</li>}{sch.esic&&<li><b>ESIC</b> on Basic: ≤ {inr(CFG.esicLimit)} → {pct(CFG.esicRate)}; above → nil</li>}
      <li><b>PT</b>: {sch.pt}</li><li><b>TDS</b>: {sch.tds?'new regime, year-to-date':'not deducted'}</li><li><b>Net salary</b> = Earned gross total − Total deduction</li></ol></div>
    </div>
   </div></>}
  {tab==='Update New Salary Scheme'&&<UpdateSalaryScheme actor={actor} canApprove={canApprove} onApplied={()=>bump(n=>n+1)}/>}
 </section>}

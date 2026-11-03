import {useEffect,useState} from 'react';
import {IndianRupee,Plus,Save,Trash2} from 'lucide-react';
import './shift-master.css';
import './salary-scheme-master.css';

/* Defaults come from Salary_Scheme_Master.xlsx (HPC_Master, NonHPC_Master, Standard_Master, Formula Guide). */
type WageRow={code:string;category:string;rate:number};
type MessRow={option:string;type:'None'|'Per day'|'Per month';rate:number};
type Slab={from:number;to:number|null;rate:number};
type FixedRow={code:string;name:string;category:string;joining:number|'';revised:number|'';from:string};
type Master={
 wage:WageRow[];mess:MessRow[];
 hpc:{basicDays:number;epfRate:number;epfCeil:number;epfFixed:number};
 tds:{std:number;rebate:number;cess:number;months:number;slabs:Slab[]};
 fixed:FixedRow[];fyStart:string;
 standard:{basicPct:number;hraPct:number;medical:number;esicRate:number;esicLimit:number};
};
export const DEFAULT_MASTER:Master={
 wage:[{code:'A',category:'Unskilled',rate:1341},{code:'B',category:'Semi-Skilled',rate:1375},{code:'C',category:'Skilled',rate:1409},{code:'D',category:'Highly Skilled',rate:1443}],
 mess:[{option:'No',type:'None',rate:0},{option:'₹150 per day',type:'Per day',rate:150},{option:'₹113 per day',type:'Per day',rate:113},{option:'₹500 per month',type:'Per month',rate:500}],
 hpc:{basicDays:26,epfRate:12,epfCeil:25000,epfFixed:3000},
 tds:{std:75000,rebate:1200000,cess:4,months:12,slabs:[{from:0,to:400000,rate:0},{from:400000,to:800000,rate:5},{from:800000,to:1200000,rate:10},{from:1200000,to:1600000,rate:15},{from:1600000,to:2000000,rate:20},{from:2000000,to:2400000,rate:25},{from:2400000,to:null,rate:30}]},
 fixed:[{code:'E006',name:'',category:'C',joining:'',revised:'',from:''},{code:'E007',name:'',category:'C',joining:'',revised:'',from:''},{code:'E008',name:'',category:'C',joining:'',revised:'',from:''}],
 fyStart:'2026-04',
 standard:{basicPct:50,hraPct:50,medical:1250,esicRate:0.75,esicLimit:21000}};
const STORAGE='hr-pulse.salary-scheme-master';
export function loadSalarySchemeMaster():Master{try{const raw=localStorage.getItem(STORAGE);return raw?{...DEFAULT_MASTER,...JSON.parse(raw)}:DEFAULT_MASTER;}catch{return DEFAULT_MASTER;}}

const TABS=['HPC Salary','Non-HPC Salary','Standard Salary'] as const;
const SCHEMES=[{name:'Standard Salary (Corporate / Head Office)',pf:true,esic:true,pt:'As per state',tds:true,remark:'Corporate / head office'},
 {name:'Standard Salary (Women)',pf:true,esic:true,pt:'Women slab where the state has one',tds:true,remark:'Women PT slab picked automatically (e.g. Maharashtra – Women)'},
 {name:'Without Compliance',pf:false,esic:false,pt:'None',tds:false,remark:'Salary paid without statutory deductions'}];
const inr=(n:number)=>'₹'+n.toLocaleString('en-IN');
const num=(v:string)=>v===''?0:+v;

export default function SalarySchemeMaster(){
 const[tab,setTab]=useState<typeof TABS[number]>('HPC Salary'),[scheme,setScheme]=useState(0),[m,setM]=useState<Master>(loadSalarySchemeMaster),[saved,setSaved]=useState(''),[dirty,setDirty]=useState(false);
 const set=(patch:Partial<Master>)=>{setM(current=>({...current,...patch}));setDirty(true);setSaved('');};
 useEffect(()=>{if(!saved)return;const t=setTimeout(()=>setSaved(''),3000);return()=>clearTimeout(t);},[saved]);
 function save(){localStorage.setItem(STORAGE,JSON.stringify(m));setDirty(false);setSaved('Salary scheme master saved.');}
 function reset(){setM(DEFAULT_MASTER);setDirty(true);setSaved('');}
 const rateOf=(code:string)=>m.wage.find(w=>w.code===code)?.rate||0;
 const months=Array.from({length:12},(_,i)=>{const[y,mo]=m.fyStart.split('-').map(Number);const d=new Date(y,mo-1+i,1);return {label:d.toLocaleString('en-IN',{month:'short',year:'numeric'}),days:new Date(d.getFullYear(),d.getMonth()+1,0).getDate()};});
 const Num=({v,on,step,w}:{v:number|'';on:(n:number|'')=>void;step?:number;w?:number})=><input type="number" step={step||1} value={v} style={w?{width:w}:undefined} onChange={e=>on(e.target.value===''?'':+e.target.value)}/>;
 return <section className="shift-master salary-scheme">
  <div className="shift-title"><span className="shift-icon"><IndianRupee/></span><div><small>MASTER CONFIGURATION · B5</small><h1>Salary Scheme Master</h1><p>Wage rates, calculation parameters, mess, TDS and scheme rules used by the Employment Details salary fields.</p></div></div>
  <div className="module-tabs salary-tabs" aria-label="Salary scheme menus">{TABS.map(t=><button type="button" key={t} className={tab===t?'selected':''} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</div>
  <div className="salary-toolbar">{saved?<span className="shift-success">{saved}</span>:<span className="salary-dirty">{dirty?'Unsaved changes':'All changes saved'}</span>}<button type="button" className="shift-remove" onClick={reset}>Reset to Excel defaults</button><button type="button" className="shift-add salary-save" onClick={save}><Save/>Save master</button></div>

  {tab==='HPC Salary'&&<div className="shift-grid">
   <div>
    <div className="shift-card"><h2>1. HPC wage rate master (per day)</h2><div className="shift-table-wrap"><table><thead><tr><th>Code</th><th>Category</th><th>Daily wage rate (₹)</th><th>Gross for {m.hpc.basicDays} days</th></tr></thead><tbody>
     {m.wage.map((w,i)=><tr key={w.code}><td><b>{w.code}</b></td><td><input value={w.category} onChange={e=>set({wage:m.wage.map((x,j)=>j===i?{...x,category:e.target.value}:x)})}/></td><td><Num v={w.rate} on={n=>set({wage:m.wage.map((x,j)=>j===i?{...x,rate:n===''?0:n}:x)})}/></td><td>{inr(w.rate*m.hpc.basicDays)}</td></tr>)}
    </tbody></table></div><p className="shift-footnote">Source: HPC (High Power Committee) rates as provided. Govt Wage Rate on the joining form is picked from this table by Skill Category.</p></div>
    <div className="shift-card"><h2>2. Calculation parameters</h2><div className="shift-fields">
     <label>Basic days limit<Num v={m.hpc.basicDays} on={n=>set({hpc:{...m.hpc,basicDays:num(String(n))}})}/><small>Earnings up to this many paid days = Basic (A); days above = Other Allowance (B)</small></label>
     <label>EPF rate (% of Basic)<Num v={m.hpc.epfRate} step={0.5} on={n=>set({hpc:{...m.hpc,epfRate:num(String(n))}})}/><small>Applied on Basic when Basic ≤ ceiling</small></label>
     <label>EPF Basic ceiling (₹)<Num v={m.hpc.epfCeil} on={n=>set({hpc:{...m.hpc,epfCeil:num(String(n))}})}/><small>Basic above this → fixed EPF</small></label>
     <label>EPF fixed amount above ceiling (₹)<Num v={m.hpc.epfFixed} on={n=>set({hpc:{...m.hpc,epfFixed:num(String(n))}})}/><small>Fixed EPF when Basic &gt; ceiling</small></label>
     <label>ESIC<input value="Not applicable at NCL" readOnly/></label>
     <label>Mess deduction<input value="See Mess master →" readOnly/></label>
    </div></div>
    <div className="shift-card"><h2>4. TDS master – new tax regime (Sec 115BAC)</h2><div className="shift-fields">
     <label>Standard deduction (₹/year)<Num v={m.tds.std} on={n=>set({tds:{...m.tds,std:num(String(n))}})}/></label>
     <label>Sec 87A rebate – taxable income limit (₹)<Num v={m.tds.rebate} on={n=>set({tds:{...m.tds,rebate:num(String(n))}})}/></label>
     <label>Health &amp; education cess (%)<Num v={m.tds.cess} step={0.5} on={n=>set({tds:{...m.tds,cess:num(String(n))}})}/></label>
     <label>Projection months<Num v={m.tds.months} on={n=>set({tds:{...m.tds,months:num(String(n))}})}/></label>
    </div><div className="shift-table-wrap" style={{marginTop:18}}><table><thead><tr><th>Income above (₹)</th><th>Up to (₹)</th><th>Tax rate (%)</th></tr></thead><tbody>
     {m.tds.slabs.map((s,i)=><tr key={i}><td>{inr(s.from)}</td><td>{s.to===null?'and above':<Num v={s.to} on={n=>set({tds:{...m.tds,slabs:m.tds.slabs.map((x,j)=>j===i?{...x,to:num(String(n))}:j===i+1?{...x,from:num(String(n))}:x)}})}/>}</td><td><Num v={s.rate} on={n=>set({tds:{...m.tds,slabs:m.tds.slabs.map((x,j)=>j===i?{...x,rate:num(String(n))}:x)}})}/></td></tr>)}
    </tbody></table></div><p className="shift-footnote">Taxable income up to the rebate limit → no tax; marginal relief just above it. Cess applies on tax after rebate.</p></div>
   </div>
   <div>
    <div className="shift-card"><h2>3. Mess master</h2><div className="shift-table-wrap"><table><thead><tr><th>Mess option</th><th>Type</th><th>Rate (₹)</th></tr></thead><tbody>
     {m.mess.map((r,i)=><tr key={i}><td><input value={r.option} onChange={e=>set({mess:m.mess.map((x,j)=>j===i?{...x,option:e.target.value}:x)})}/></td><td><select value={r.type} onChange={e=>set({mess:m.mess.map((x,j)=>j===i?{...x,type:e.target.value as MessRow['type']}:x)})}><option>None</option><option>Per day</option><option>Per month</option></select></td><td><Num v={r.rate} on={n=>set({mess:m.mess.map((x,j)=>j===i?{...x,rate:num(String(n))}:x)})}/></td></tr>)}
    </tbody></table></div><p className="shift-footnote">Per day = rate × paid days · Per month = fixed amount, not reduced for absent days. Site-wise camp / non-camp rules are in the site master.</p></div>
    <div className="shift-card"><h2>Calculation flow – HPC rate</h2><ol className="salary-flow">
     <li><b>Paid days</b> = P (present) + Leave</li><li><b>Wage earnings</b> = Wage rate × Paid days</li><li><b>Gross</b> = Wage earnings + Other income</li>
     <li><b>A – Basic</b> = Wage rate × Paid days, up to {m.hpc.basicDays} days</li><li><b>B – Other Allowance</b> = Wage rate × days above {m.hpc.basicDays}</li>
     <li><b>EPF</b> on Basic: ≤ {inr(m.hpc.epfCeil)} → {m.hpc.epfRate}%; above → {inr(m.hpc.epfFixed)}</li><li><b>ESIC</b> nil (NCL)</li><li><b>PT</b> as per employee PT State (PT Master)</li><li><b>Mess</b> as per mess option / site master</li>
     <li><b>TDS</b> new regime, year-to-date method</li><li><b>Net</b> = Gross − deductions · <b>Ex-gratia</b> = Wage rate × (OT + PH days) · <b>Payable</b> = Net + Ex-gratia</li></ol></div>
   </div>
  </div>}

  {tab==='Non-HPC Salary'&&<div className="shift-grid">
   <div>
    <div className="shift-card"><h2>1. Scheme rules</h2><div className="shift-table-wrap"><table><thead><tr><th>Rule</th><th>Value</th><th>Note</th></tr></thead><tbody>
     <tr><td>Basic unit-days cap</td><td>{m.hpc.basicDays}</td><td>Basic = Govt rate × MIN(Unit days, cap)</td></tr>
     <tr><td>Per-day salary</td><td>Salary ÷ Month days</td><td>Rounded to nearest rupee: paise below 50 → down, 50 and above → up</td></tr>
     <tr><td>Unit days</td><td>Earnings ÷ Govt rate</td><td>Rounded to 2 decimals</td></tr>
     <tr><td>Other Allowance</td><td>Earnings − Basic</td><td>Keeps Basic + Other Allowance = Earnings exactly</td></tr>
     <tr><td>Ex-gratia (OT / PH)</td><td>Per-day salary × days</td><td>Not the govt wage rate</td></tr>
     <tr><td>Deductions</td><td>Same as HPC</td><td>EPF, ESIC nil, PT, Mess, TDS – see HPC Salary</td></tr>
    </tbody></table></div></div>
    <div className="shift-card"><h2>4. Fixed salary master</h2><div className="shift-table-wrap"><table className="salary-fixed"><thead><tr><th>Emp code</th><th>Employee name</th><th>Category</th><th>Govt rate (₹/day)</th><th>Salary at joining (₹)</th><th>Revised salary (₹)</th><th>Effective from</th><th>Salary in use (₹)</th><th></th></tr></thead><tbody>
     {m.fixed.map((f,i)=>{const upd=(p:Partial<FixedRow>)=>set({fixed:m.fixed.map((x,j)=>j===i?{...x,...p}:x)});const inUse=f.revised!==''&&f.from?f.revised:f.joining;
      return <tr key={i}><td><input value={f.code} onChange={e=>upd({code:e.target.value})}/></td><td><input value={f.name} onChange={e=>upd({name:e.target.value})}/></td><td><select value={f.category} onChange={e=>upd({category:e.target.value})}>{m.wage.map(w=><option key={w.code} value={w.code}>{w.code} – {w.category}</option>)}</select></td><td>{inr(rateOf(f.category))}</td><td><Num v={f.joining} on={n=>upd({joining:n})}/></td><td><Num v={f.revised} on={n=>upd({revised:n})}/></td><td><input type="date" value={f.from} onChange={e=>upd({from:e.target.value})}/></td><td><b>{inUse===''?'–':inr(inUse)}</b></td><td><button type="button" className="shift-remove" aria-label="Remove row" onClick={()=>set({fixed:m.fixed.filter((_,j)=>j!==i)})}><Trash2/></button></td></tr>;})}
     {!m.fixed.length&&<tr><td colSpan={9} className="shift-empty">No fixed-salary employees yet</td></tr>}
    </tbody></table></div><button type="button" className="shift-add salary-save" onClick={()=>set({fixed:[...m.fixed,{code:'',name:'',category:m.wage[0]?.code||'A',joining:'',revised:'',from:''}]})}><Plus/>Add employee</button>
    <p className="shift-footnote">Salary in use = Revised salary once an effective-from date is set, otherwise Salary at joining.</p></div>
   </div>
   <div>
    <div className="shift-card"><h2>2. Month days master</h2><label className="salary-inline">Financial year starts<input type="month" value={m.fyStart} onChange={e=>set({fyStart:e.target.value})}/></label><div className="shift-table-wrap"><table><thead><tr><th>Month</th><th>Days</th></tr></thead><tbody>{months.map(x=><tr key={x.label}><td>{x.label}</td><td>{x.days}</td></tr>)}</tbody></table></div><p className="shift-footnote">Used for the Non-HPC per-day salary (Salary ÷ Month days).</p></div>
    <div className="shift-card"><h2>3. Govt wage rate (linked from HPC master)</h2><div className="shift-table-wrap"><table><thead><tr><th>Code</th><th>Category</th><th>Govt rate (₹/day)</th></tr></thead><tbody>{m.wage.map(w=><tr key={w.code}><td><b>{w.code}</b></td><td>{w.category}</td><td>{inr(w.rate)}</td></tr>)}</tbody></table></div><p className="shift-footnote">Edit these under HPC Salary.</p></div>
   </div>
  </div>}

  {tab==='Standard Salary'&&<>
   <div className="module-tabs salary-subtabs" aria-label="Standard salary schemes">{SCHEMES.map((s,i)=><button type="button" key={s.name} className={scheme===i?'selected':''} aria-pressed={scheme===i} onClick={()=>setScheme(i)}>{s.name}</button>)}</div>
   <div className="shift-grid">
    <div>
     <div className="shift-card"><h2>1. Salary structure – {SCHEMES[scheme].name}</h2><div className="shift-fields">
      <label>A – Basic (% of earned gross)<Num v={m.standard.basicPct} step={1} on={n=>set({standard:{...m.standard,basicPct:num(String(n))}})}/></label>
      <label>B – HRA (% of Basic)<Num v={m.standard.hraPct} step={1} on={n=>set({standard:{...m.standard,hraPct:num(String(n))}})}/></label>
      <label>C – Medical (₹ per month)<Num v={m.standard.medical} on={n=>set({standard:{...m.standard,medical:num(String(n))}})}/><small>Paid on paid days: Medical × Paid days ÷ Month days</small></label>
      <label>D – Special Allowance<input value="Balance: Earned gross − (A + B + C)" readOnly/></label>
      <label>E – Other Allowance<input value="Per employee – entered monthly" readOnly/></label>
     </div></div>
     <div className="shift-card"><h2>2. Statutory deduction rules</h2>{SCHEMES[scheme].pf||SCHEMES[scheme].esic?<div className="shift-fields">
      <label>PF rate on Basic (%)<Num v={m.hpc.epfRate} step={0.5} on={n=>set({hpc:{...m.hpc,epfRate:num(String(n))}})}/><small>Basic ₹0 – {inr(m.hpc.epfCeil)} → {m.hpc.epfRate}% of Basic</small></label>
      <label>PF Basic ceiling (₹)<Num v={m.hpc.epfCeil} on={n=>set({hpc:{...m.hpc,epfCeil:num(String(n))}})}/><small>Linked to HPC master</small></label>
      <label>PF fixed above ceiling (₹)<Num v={m.hpc.epfFixed} on={n=>set({hpc:{...m.hpc,epfFixed:num(String(n))}})}/></label>
      <label>ESIC rate on Basic (%)<Num v={m.standard.esicRate} step={0.05} on={n=>set({standard:{...m.standard,esicRate:num(String(n))}})}/><small>Employee share, rounded up</small></label>
      <label>ESIC Basic limit (₹)<Num v={m.standard.esicLimit} on={n=>set({standard:{...m.standard,esicLimit:num(String(n))}})}/><small>Basic above this → nil ESIC (checked on full-month Basic)</small></label>
     </div>:<p className="shift-help">Without Compliance: salary is paid without PF, ESIC, PT or TDS deductions. Mess / food deduction does not apply to Standard schemes either.</p>}</div>
    </div>
    <div>
     <div className="shift-card"><h2>3. Scheme matrix – which deductions apply</h2><div className="shift-table-wrap"><table><thead><tr><th>Scheme</th><th>PF</th><th>ESIC</th><th>PT slab</th><th>TDS</th></tr></thead><tbody>
      {SCHEMES.map((s,i)=><tr key={s.name} className={scheme===i?'salary-current':''} onClick={()=>setScheme(i)}><td>{s.name}<small>{s.remark}</small></td><td>{s.pf?'Y':'N'}</td><td>{s.esic?'Y':'N'}</td><td>{s.pt}</td><td>{s.tds?'Y':'N'}</td></tr>)}
     </tbody></table></div><p className="shift-footnote">TDS is income tax and applies by law when taxable income exceeds the rebate limit. PT: state-wise PT Master (Maharashtra has separate men / women slabs).</p></div>
     <div className="shift-card"><h2>Calculation flow – Standard salary</h2><ol className="salary-flow">
      <li><b>Earned gross</b> = Monthly gross × Paid days ÷ Month days (Paid days = P + WO + Leave)</li><li><b>A – Basic</b> = {m.standard.basicPct}% of Earned gross</li><li><b>B – HRA</b> = {m.standard.hraPct}% of Basic</li>
      <li><b>C – Medical</b> = {inr(m.standard.medical)} × Paid days ÷ Month days</li><li><b>D – Special Allowance</b> = Earned gross − (A + B + C)</li><li><b>E – Other Allowance</b> per employee</li>
      {SCHEMES[scheme].pf&&<li><b>PF</b> on Basic: ≤ {inr(m.hpc.epfCeil)} → {m.hpc.epfRate}%; above → {inr(m.hpc.epfFixed)}</li>}{SCHEMES[scheme].esic&&<li><b>ESIC</b> on Basic: ≤ {inr(m.standard.esicLimit)} → {m.standard.esicRate}%; above → nil</li>}
      <li><b>PT</b>: {SCHEMES[scheme].pt}</li><li><b>TDS</b>: {SCHEMES[scheme].tds?'new regime, year-to-date':'not deducted'}</li><li><b>Net salary</b> = Earned gross total − Total deduction</li></ol></div>
    </div>
   </div></>}
 </section>}

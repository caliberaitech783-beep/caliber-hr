import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {CFG,MESS_PLANS,PT_STATES,R,SALARY_TYPES,SCH,SKILL_CATEGORIES,compute,fmt,fmt2,foodRule,isStd,loadMessSites,siteInfo,specialRates,type CalcInput,type SalaryType} from './salaryCalc';

type Row=[string,number,string?,string?];
const row=(l:string,v:number,sub='',cls=''):Row=>[l,v,sub,cls];
function Rows({rows}:{rows:Row[]}){return <tbody>{rows.map(([l,v,sub,cls],i)=><tr key={i} className={cls}><td>{l}{sub&&<small>{sub}</small>}</td><td className="r">{fmt(v)}</td></tr>)}</tbody>}

function F({label,required,hint,children,id,hidden}:{label:string;required?:boolean;hint?:ReactNode;children:ReactNode;id:string;hidden?:boolean}){
 return <label className="joining-field salary-field" htmlFor={id} hidden={hidden}><span>{label}{required&&<b> *</b>}</span>{children}{hint&&<small className="salary-hint">{hint}</small>}</label>}

/* Links the top-bar selection (group / company / region / site) and the form's Resident + Gender fields to the salary fields. */
export type SalaryDefaults={employeeGroup?:'Corporate / HO'|'OB / COAL';company?:string;region?:string;site?:string};
const MESS_SITE_FOR:Record<string,string>={'Sasti OB':'Sasti OB','Dhoptala OB':'Dhoptala OB','Majri OB':'Majri OB','Gauri Pauni OB':'Gouri Pauni OB','Jayant OB East':'Jayant OB East','Jayant OB West':'Jayant OB West','Dudhichua OB East':'Dhudhichua OB East','Dudhichua OB West':'Dhudhichua OB West'};
const PT_STATE_FOR:Record<string,string>={WCL:'Maharashtra',NCL:'Madhya Pradesh','Corporate / HO':'Maharashtra'};
export function salaryAutoFill(d:SalaryDefaults,gender:string,resident:string){
 const corporate=d.employeeGroup==='Corporate / HO';
 return {'Salary Type':corporate?(/^f/i.test(gender)?'STDW':'STD'):'HPC','Site / Project':MESS_SITE_FOR[d.site||'']||'','PT State':PT_STATE_FOR[d.region||'']||PT_STATE_FOR[corporate?'Corporate / HO':'']||'',
  'Accommodation Category':/local$/i.test(resident)&&!/non-local/i.test(resident)?'NonCamp':resident?'Camp':''};}
export default function SalaryFields({enforce=true,defaults={}}:{enforce?:boolean;defaults?:SalaryDefaults}){
 /* DOM-driven on purpose: the joining form restores and persists field values directly on the inputs,
    so the salary fields read their values from the DOM (like the original HTML) instead of React state. */
 const box=useRef<HTMLDivElement>(null),[,tick]=useState(0),[open,setOpen]=useState(false),sites=useMemo(loadMessSites,[]);
 const read=(name:string)=>(box.current?.querySelector<HTMLInputElement|HTMLSelectElement>(`[name="${name}"]`)?.value)||'';
 const sync=()=>tick(n=>n+1);
 const formValue=(name:string)=>(box.current?.closest('form')?.querySelector<HTMLInputElement|HTMLSelectElement>(`[name="${name}"]`)?.value)||'';
 /* Auto-fill from the top bar: only fields the user has not set by hand (data-auto marks values we filled). */
 const autoFill=()=>{const fill=salaryAutoFill(defaults,formValue('Gender'),formValue('Resident'));let changed=false;
  for(const [name,value] of Object.entries(fill)){const el=box.current?.querySelector<HTMLSelectElement>(`select[name="${name}"]`);if(!el||!value)continue;const manual=el.value&&el.dataset.auto!==el.value;if(manual||el.value===value)continue;if(![...el.options].some(o=>o.value===value))continue;el.value=value;el.dataset.auto=value;changed=true;}
  if(changed)sync();};
 useEffect(()=>{const t=setTimeout(()=>{autoFill();sync();},0);const form=box.current?.closest('form');const onChange=()=>{autoFill();sync();};form?.addEventListener('change',onChange);form?.addEventListener('input',sync);return()=>{clearTimeout(t);form?.removeEventListener('change',onChange);form?.removeEventListener('input',sync);};},[]);
 useEffect(()=>{autoFill();},[defaults.employeeGroup,defaults.company,defaults.region,defaults.site]);
 const stype=read('Salary Type') as SalaryType,cat=read('Skill Category'),gn=read('Monthly Gross Salary'),site=read('Site / Project'),acc=read('Accommodation Category')||'Camp',plan=read('Mess Plan'),sp=read('Special Approval (food)'),state=read('PT State')||PT_STATES[0];
 const st=isStd(stype),r=+cat||0,sal=+String(gn).replace(/[^0-9]/g,'')||0,S=siteInfo(site,sites),hasPlan=!st&&!!stype&&!!S?.plans,sp0=specialRates(site,sites),hasSp=!st&&stype==='NON'&&sp0.length>1;
 const fr=foodRule(site,stype,acc,hasSp?sp:'',hasPlan?plan:'',sites),typeLabel=SALARY_TYPES.find(x=>x.value===stype)?.label||'',catLabel=SKILL_CATEGORIES.find(x=>String(x.value)===cat)?.label||'';
 const base:CalcInput={r,sal,md:31,pd:26,month:10,oi:0,ot:0,ph:0,od:0,site,acc,sp,plan,state};
 let preview:ReactNode=null;
 if(stype==='HPC'&&r){const x=compute(stype,base);preview=<><span><b>HPC Rate</b> · 26 days</span><span>Basic <b>{fmt(x.basic)}</b></span><span>EPF <b>{fmt(x.pf)}</b></span><span>Food <b>{fmt(x.mess)}</b></span></>;}
 else if(stype==='NON'&&r&&sal){const x=compute(stype,base);preview=<><span><b>Non-HPC</b> · 26 of 31 days</span><span>Per day <b>{fmt(x.perday)}</b></span><span>Earnings <b>{fmt(x.earn)}</b> = {x.unit.toFixed(2)} unit days</span><span>Basic <b>{fmt(x.basic)}</b> + OA <b>{fmt(x.oa)}</b></span></>;}
 else if(st&&sal){const x=compute(stype,{...base,pd:31});preview=<><span><b>{SCH[stype].name}</b> · full month</span><span>Basic <b>{fmt(x.basic)}</b></span><span>HRA <b>{fmt(x.hra)}</b></span><span>Medical <b>{fmt(x.med)}</b></span><span>Special <b>{fmt(x.spl)}</b></span><span>PF <b>{fmt(x.pf)}</b> · ESIC <b>{fmt(x.esic)}</b></span></>;}
 const canOpen=!!stype&&(st||!!cat)&&(stype==='HPC'||!!sal);
 return <div className="salary-fields" ref={box}>
  <F id="salary-type" label="Salary Type" required={enforce}>
   <select id="salary-type" name="Salary Type" required={enforce} defaultValue="" onChange={sync}><option value="">Select</option>{SALARY_TYPES.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
   <input type="hidden" name="Salary Structure / Scheme" value={typeLabel} readOnly/>
   <small className="salary-hint">Decides which salary master and calculation are used</small></F>
  <F id="skill-category" label="Skill Category" required={enforce} hint="As per HPC wage rate master" hidden={st}>
   <select id="skill-category" name="Skill Category" required={enforce&&!st} defaultValue="" onChange={sync}><option value="">Select</option>{SKILL_CATEGORIES.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></F>
  <F id="govt-wage-rate" label="Govt Wage Rate (per day)" hidden={st}><input id="govt-wage-rate" name="Govt Wage Rate (per day)" className="salary-ro" readOnly value={r?fmt(r)+' / day':''} placeholder="Auto from Skill Category"/></F>
  <F id="gross-salary-26" label="Gross Salary (for 26 days)" hint="Actual gross each month = Wage Rate × Paid Days" hidden={stype!=='HPC'}><input id="gross-salary-26" name="Gross Salary (for 26 days)" className="salary-ro" readOnly value={r?`${fmt(r*26)}  (${fmt(r)} × 26)`:''} placeholder="Auto: Wage Rate × Paid Days"/></F>
  <F id="monthly-gross-salary" label="Monthly Gross Salary" required={enforce} hint={st?'Monthly gross – split into Basic 50%, HRA, Medical, Special Allowance; paid on paid days':'Fixed salary – paid as (Salary ÷ month days, rounded to ₹) × paid days'} hidden={!(stype==='NON'||st)}>
   <input id="monthly-gross-salary" name="Monthly Gross Salary" required={enforce&&(stype==='NON'||st)} inputMode="numeric" placeholder="₹" defaultValue="" onInput={sync}/></F>
  <F id="site-project" label="Site / Project" required={enforce} hint={S?`Company: ${S.company}`+(S.plans?' · mess plan site – choose per day or per month below':''):(defaults.company?`Company: ${defaults.company}`:'Auto from the site selected above')}>
   <select id="site-project" name="Site / Project" required={enforce} defaultValue="" onChange={sync}><option value="">Select</option>{sites.map(k=><option key={k.site}>{k.site}</option>)}</select></F>
  <F id="accommodation-category" label="Accommodation Category" required={enforce} hint="Decides the food (mess) deduction at the site" hidden={st||hasPlan}>
   <select id="accommodation-category" name="Accommodation Category" defaultValue="Camp" onChange={sync}><option value="Camp">Camp (Non-local)</option><option value="NonCamp">Non-Camp (Local)</option></select></F>
  <F id="mess-deduction" label="Food (Mess) Deduction" hint={fr?`Food: ${fr.food} · ${fr.rem}`:'HPC / Non-HPC only – from the site-wise food deduction master'} hidden={st}>
   <input id="mess-deduction" name="Mess Deduction" className="salary-ro" readOnly value={fr?.label||''} placeholder="Auto from Site + Category + Salary Type"/></F>
  <F id="mess-plan" label="Mess Plan" required={enforce} hint="Per day = rate × paid days · Per month = fixed amount" hidden={!hasPlan}>
   <select id="mess-plan" name="Mess Plan" required={enforce&&hasPlan} defaultValue="" onChange={sync}><option value="">Select</option>{MESS_PLANS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></F>
  <F id="special-approval" label="Special Approval (food)" hint="Individual rate approved for this worker" hidden={!hasSp}>
   <select id="special-approval" name="Special Approval (food)" defaultValue="" onChange={sync}><option value="">None – as per site master</option>{sp0.slice(1).map(p=><option key={p.id} value={p.id}>₹{p.r} per day – {p.rem}</option>)}</select></F>
  <F id="pt-state" label="PT State" required={enforce} hint="Professional Tax slab from PT Master (state-wise)">
   <select id="pt-state" name="PT State" defaultValue={PT_STATES[0]} onChange={sync}>{PT_STATES.map(s=><option key={s}>{s}</option>)}</select></F>
  <div className={'salary-preview'+(canOpen?' ready':'')} role={canOpen?'button':undefined} tabIndex={canOpen?0:-1} onClick={()=>canOpen&&setOpen(true)} onKeyDown={e=>{if(canOpen&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setOpen(true);}}}>
   {preview?<><div className="salary-preview-chips">{preview}</div><span className="salary-preview-link">View full salary summary ›</span></>:<span><b>Salary preview</b> – select Salary Type and fill the salary fields</span>}
  </div>
  {open&&<SalarySummary stype={stype} r={r} sal={sal} site={site} acc={acc} sp={hasSp?sp:''} plan={hasPlan?plan:''} state={state} catLabel={catLabel} onClose={()=>setOpen(false)}/>}
 </div>}

type SummaryProps={stype:string;r:number;sal:number;site:string;acc:string;sp:string;plan:string;state:string;catLabel:string;onClose:()=>void};
function SalarySummary({stype:t,r,sal,site,acc,sp,plan,state,catLabel,onClose}:SummaryProps){
 const st=isStd(t),non=t==='NON',hpc=t==='HPC';
 const[mon,setMon]=useState('2026-10'),[p,setP]=useState(''),[wo,setWo]=useState('0'),[lv,setLv]=useState('0'),[pdIn,setPdIn]=useState('26'),[oi,setOi]=useState('0'),[ot,setOt]=useState('0'),[ph,setPh]=useState('0'),[od,setOd]=useState('0'),[mb,setMb]=useState<string|null>(null),[yg,setYg]=useState(''),[yt,setYt]=useState(''),[ex,setEx]=useState(''),[dwm,setDwm]=useState<number|null>(null);
 const[y,m]=mon.split('-').map(Number),md=new Date(y||2026,m||1,0).getDate(),fyM=((m||1)-4+12)%12,mbVal=mb===null?fyM:Math.min(+mb||0,fyM);
 const P=p===''?md:(+p||0),WO=hpc||non?0:(+wo||0),LV=+lv||0,sum=non?(+pdIn||0):P+WO+LV,pd=Math.min(sum,md);
 const num=(v:string)=>v===''?null:+v;
 const o:CalcInput={ytd:{mb:mbVal,g:num(yg),t:num(yt)},exp:num(ex)||0,r,sal,md,pd,month:m,oi:+oi||0,ot:+ot||0,ph:+ph||0,od:+od||0,site,acc,sp,plan,state};
 const x=useMemo(()=>compute(t,o),[t,JSON.stringify(o)]);
 const k=st?SCH[t]:null,off=' – not applicable for this scheme',fd=x.food,tOn=!(k&&!k.tds);
 let E:Row[]=[];
 if(hpc)E=[row('Wage rate',r,'Govt rate per day'),row('Wage earnings',x.earn,`${fmt(r)} × ${pd} paid days`),row('A – Basic',x.basic,'Rate × min(paid days, 26)','sub'),row('B – Other Allowance',x.oa,'Rate × days above 26','sub')];
 else if(non)E=[row('Fixed monthly salary',sal),row('Per-day salary',x.perday,`${fmt(sal)} ÷ ${md} = ${fmt2(x.exact)} → ${fmt(x.perday)} (paise ${(x.exact%1)>=.5?'50 or more → up':'below 50 → down'})`),
  row('Salary earnings',x.earn,`${fmt(x.perday)} × ${pd} paid days · ${x.unit.toFixed(2)} unit days`),row('A – Basic',x.basic,`Govt rate ${fmt(r)} × ${x.bdays} whole unit days (${x.unit.toFixed(2)} → ${x.bdays}${Math.floor(x.unit)>CFG.days?', max 26':''})`,'sub'),row('B – Other Allowance',x.oa,'Earnings − Basic (decimal unit days'+(x.unit>CFG.days?' + days above 26)':')'),'sub')];
 else E=[row('Monthly gross salary',sal),row('Earned gross',x.eg,`${fmt(sal)} × ${pd} ÷ ${md} days`),row('A – Basic',x.basic,'50% of earned gross','sub'),row('B – HRA',x.hra,'50% of Basic','sub'),row('C – Medical',x.med,`₹1,250 × ${pd} ÷ ${md} days`,'sub'),row('D – Special Allowance',x.spl,'Earned gross − (A + B + C)','sub')];
 E.push(row(st?'E – Other Allowance':'Other income',o.oi||0,st?'':'Outside Basic – no EPF',st?'sub':''),row(st?'Earned gross total':'Gross salary',x.gross,'','t'));
 const ptRow=(CFG.PT[x.ptKey]||[]).find(rw=>x.gross>=rw[0]&&x.gross<=rw[1]);
 const ptTxt=k&&!k.pt?'No PT'+off:(!CFG.PT[x.ptKey]?`${state} – no PT on salary`:`${x.ptKey} slab`+(ptRow&&ptRow[4]===m?' – special-month rate':''));
 const D:Row[]=[row(st?'PF':'EPF',x.pf,k&&!k.pf?'No PF'+off:(x.basic>CFG.epfCeil?'Basic above ₹25,000 → fixed':'12% of Basic')),
  row('ESIC',x.esic,st?(k!.esic?(x.fullBasic>CFG.esicLimit?`Not eligible – full Basic ${fmt(x.fullBasic)} above ₹21,000`:`Eligible (full Basic ${fmt(x.fullBasic)} ≤ ₹21,000) – 0.75% of earned Basic ${fmt(x.basic)}`):'No ESIC'+off):'Not applicable at NCL'),
  row('Professional Tax',x.pt,ptTxt)];
 if(!st)D.push(row('Food (mess)',x.mess,!site?'Select site':(fd?.t==='day'?`${site} · ${pd} days × ₹${fd.r}${fd.by?' (special approval – '+fd.by+')':fd.id?' (mess plan)':''}`:`${site} · ${fd?.label}`)));
 D.push(row('TDS (new regime)',x.tds,k&&!k.tds?'No TDS'+off:'Year-to-date method – see TDS working'),row('Other deduction',x.od),row('Total deductions',x.ded,'','t'));
 const TX:Row[]=[row('OT',x.exot,`${o.ot} days × ${fmt(x.perday||0)} (rounded to ₹)`),row('PH',x.exph,`${o.ph} days × ${fmt(x.perday||0)}`),row('Total ex-gratia',x.ex,'','t')];
 const TW:Row[]=tOn?[row('Gross paid so far',x.ytdG,`${x.mb} month(s) before this month${yg===''?' – auto: '+fmt(x.exp)+' × '+x.mb:''}`),row('This month',x.gross+x.ex,st?'Earned gross':'Gross + ex-gratia'),row('Remaining months',x.exp*x.rem,`${fmt(x.exp)} × ${x.rem} month(s) to March`),
  row('Estimated annual salary',x.annual,'','t'),row('Less standard deduction',-CFG.std),row('Taxable income',x.ti,x.ti<=CFG.rebate?'Up to ₹12 lakh – nil tax (Sec 87A)':'','t'),row('Annual tax incl. 4% cess',x.atax,x.ti>CFG.rebate&&x.ti<1275000?'Marginal relief applied':''),row('Less TDS deducted so far',-x.ytdT,yt===''?'auto estimate':''),
  row('TDS this month',x.tds,`(${fmt(x.atax)} − ${fmt(x.ytdT)}) ÷ ${x.rem+1} month(s) incl. this month`,'t')]:[];
 /* day-wise drill-down: Non-HPC and Standard schemes (not HPC) */
 const DWM=dwm??md,H=non?['Paid days','Earnings','Unit days','A – Basic','B – Other allow.','EPF','Food','PT','TDS','Total ded.','Net']:['Paid days','Earned gross','A – Basic','B – HRA','C – Medical','D – Special','PF','ESIC','PT','TDS','Total ded.','Net'];
 const drill:{cells:string[];cur:boolean;lim:boolean}[]=[];if(!hpc){let lim=false;for(let d=1;d<=DWM;d++){const z=compute(t,{...o,md:DWM,pd:d,oi:0,ot:0,ph:0,od:0,month:0,ytd:null});
  const cells=non?[String(d),fmt(z.earn),z.unit.toFixed(2),fmt(z.basic),fmt(z.oa),fmt(z.pf),fmt(z.mess),fmt(z.pt),fmt(z.tds),fmt(z.ded),fmt(z.net)]:[String(d),fmt(z.eg),fmt(z.basic),fmt(z.hra),fmt(z.med),fmt(z.spl),fmt(z.pf),fmt(z.esic),fmt(z.pt),fmt(z.tds),fmt(z.ded),fmt(z.net)];
  const isLim=non&&z.unit>26&&!lim;if(isLim)lim=true;drill.push({cells,cur:d===pd&&DWM===md,lim:isLim});}}
 useEffect(()=>{document.querySelector('.salary-dwt tr.cur')?.scrollIntoView({block:'center'});},[DWM,pd,md]);
 const dwsub=non?` · per-day ${fmt2(sal/DWM)} → ${fmt(R(sal/DWM))} (${fmt(sal)} ÷ ${DWM})`:st?` · ${SCH[t].name} · ${fmt(sal)} ÷ ${DWM} days`:'';
 const ni=(label:string,v:string,set:(s:string)=>void,extra:Record<string,unknown>={})=><div><label>{label}</label><input type="number" value={v} onChange={e=>set(e.target.value)} {...extra}/></div>;
 return <div className="salary-ov" onClick={onClose}><div className="salary-md" role="dialog" aria-label="Salary Summary" onClick={e=>e.stopPropagation()}>
  <div className="salary-mh"><h4>Salary Summary <span className="salary-tag">{st?SCH[t].name:(hpc?'HPC Rate · ':'Non-HPC · ')+catLabel}</span></h4><button type="button" className="salary-x" aria-label="Close" onClick={onClose}><X/></button></div>
  <div className="salary-mi">
   <div><label>Payroll month</label><input type="month" value={mon} onChange={e=>setMon(e.target.value)}/></div>
   <div><label>Month days</label><input readOnly value={md}/></div>
   {!non&&ni('P – Present',p===''?String(md):p,setP,{min:0,max:md})}
   {!non&&!hpc&&ni('WO – Week off',wo,setWo,{min:0,max:md})}
   {!non&&ni('Leave (paid)',lv,setLv,{min:0,max:md})}
   <div><label>{non?'Paid days':'Total paid days'}</label>{non?<input type="number" min={0} max={md} className={sum>md?'bad':''} value={pdIn} onChange={e=>setPdIn(e.target.value)}/>:<input readOnly className={sum>md?'bad':''} value={pd}/>}</div>
  </div>
  <div className="salary-mi salary-mi2">
   {ni(st?'Other allowance (₹)':'Other income (₹)',oi,setOi)}
   {!st&&ni('OT days',ot,setOt,{step:.5,min:0})}
   {!st&&ni('PH days',ph,setPh,{step:.5,min:0})}
   {ni('Other deduction (₹)',od,setOd)}
  </div>
  {tOn&&<div className="salary-mi salary-mi2 salary-ytd">
   <div style={{gridColumn:'1/3'}}><label>TDS – year to date <span style={{fontWeight:400,color:'#8a8699'}}>(blank = auto estimate)</span></label><div className="salary-ytd-note">Enter actuals from earlier payrolls this financial year for exact TDS</div></div>
   <div><label>Months paid before this month</label><input type="number" min={0} max={11} value={mb===null?fyM:mb} onChange={e=>setMb(e.target.value)}/></div>
   {ni('Gross paid so far (₹)',yg,setYg,{placeholder:'auto'})}
   {ni('TDS deducted so far (₹)',yt,setYt,{placeholder:'auto'})}
   {ni('Expected monthly gross (₹)',ex,setEx,{placeholder:'auto'})}
  </div>}
  <div className="salary-days">
   <span>Paid days</span>
   {non?<span className="eq">{pd} of {md} days</span>:<><span className="c">P {P}</span>{!hpc&&<>+<span className="c">WO {WO}</span></>}+<span className="c">Leave {LV}</span>=<span className="eq">{pd} of {md} days</span></>}
   {sum>md&&<span className="warn">⚠ {sum} entered – locked at {md} (month days)</span>}
   {!st&&<span className="ot">OT {o.ot} days · PH {o.ph} days</span>}
  </div>
  <div className="salary-cols">
   <div><table><thead><tr><th>Earnings</th><th className="r">₹</th></tr></thead><Rows rows={E}/></table></div>
   <div><table><thead><tr><th>Deductions</th><th className="r">₹</th></tr></thead><Rows rows={D}/></table>
    {tOn&&<table style={{marginTop:14}}><thead><tr><th>TDS working (new regime)</th><th className="r">₹</th></tr></thead><Rows rows={TW}/></table>}
    {!st&&<table style={{marginTop:14}}><thead><tr><th>Ex-gratia</th><th className="r">₹</th></tr></thead><Rows rows={TX}/></table>}</div>
  </div>
  <div className="salary-tot"><div><span>Gross</span><b>{fmt(x.gross)}</b></div><div><span>Total deductions</span><b>{fmt(x.ded)}</b></div><div><span>Net amount</span><b>{fmt(x.net)}</b></div><div className="pay"><span>Total payable</span><b>{fmt(x.pay)}</b></div></div>
  {!hpc&&<div className="salary-dw"><div className="salary-dwh"><div><b>Day-wise drill-down</b><small>{dwsub}</small></div><div className="salary-tb">{[28,29,30,31].map(d=><button type="button" key={d} className={d===DWM?'on':''} onClick={()=>setDwm(d)}>{d} days</button>)}</div></div>
   <div className="salary-dwt"><table><thead><tr>{H.map((h,i)=><th key={h} className={i?'r':''}>{h}</th>)}</tr></thead><tbody>{drill.map((d,i)=><tr key={i} className={(d.cur?'cur ':'')+(d.lim?'lim':'')}>{d.cells.map((c,j)=><td key={j} className={j?'r':''}>{j===d.cells.length-1?<b>{c}</b>:c}</td>)}</tr>)}</tbody></table></div></div>}
  <div className="salary-note">Estimate for the month shown. All amounts rounded to the nearest rupee (paise below 50 → down, 50 and above → up). PT: state-wise PT Master on monthly gross (Maharashtra ₹300 in February; MP same amount every month). Food (mess) deduction is site-wise and applies to HPC and Non-HPC only. HPC paid days = P + Leave; Standard = P + Week off + Leave; Non-HPC = paid days. Drill-down uses normal monthly PT and assumes the other 11 months at full salary for TDS. TDS: new regime, year-to-date method (Sec 192) – nil up to ₹12 lakh taxable.</div>
 </div></div>}

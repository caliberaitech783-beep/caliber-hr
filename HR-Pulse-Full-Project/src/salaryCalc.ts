/* Salary masters and calculation – ported from the Employment Details salary spec.
   In production these settings come from HPC_Master / NonHPC_Master / Standard_Master. */
export type SalaryType=''|'HPC'|'NON'|'STD'|'STDW'|'WC';
export const SALARY_TYPES:{value:SalaryType;label:string}[]=[
 {value:'HPC',label:'HPC Rate (Govt daily wage)'},{value:'NON',label:'Non-HPC (Fixed monthly salary)'},
 {value:'STD',label:'Standard Salary (Corporate / Head Office)'},{value:'STDW',label:'Standard Salary (Women)'},{value:'WC',label:'Without Compliance'}];
export const SKILL_CATEGORIES=[{value:1341,label:'A – Unskilled'},{value:1375,label:'B – Semi-Skilled'},{value:1409,label:'C – Skilled'},{value:1443,label:'D – Highly Skilled'}];
export const PT_STATES=['Madhya Pradesh','Maharashtra','Odisha','Delhi','Haryana','Uttar Pradesh','Rajasthan','Uttarakhand','Himachal Pradesh','Jammu & Kashmir','Chandigarh','Goa','Arunachal Pradesh','Chhattisgarh'];

type PtRow=[number,number,number,number?,number?];
export const CFG={days:26,epfRate:.12,epfCeil:25000,epfFixed:3000,std:75000,rebate:1200000,cess:.04,
 slabs:[[0,0],[400000,.05],[800000,.10],[1200000,.15],[1600000,.20],[2000000,.25],[2400000,.30]] as [number,number][],
 /* PT Master – state-wise, monthly gross: [from, to, PT per month, special-month PT, special month no.] */
 PT:{'Madhya Pradesh':[[0,18750,0],[18751,25000,125],[25001,33333,166],[33334,1e12,208]],
     'Maharashtra – Men':[[0,7500,0],[7501,10000,175],[10001,1e12,200,300,2]],
     'Maharashtra – Women':[[0,25000,0],[25001,1e12,200,300,2]],
     'Odisha':[[0,13333,0],[13334,25000,125],[25001,1e12,200,300,3]]} as Record<string,PtRow[]>,   /* states not listed = no PT */
 basicPct:.5,hraPct:.5,medical:1250,esicRate:.0075,esicLimit:21000};

/* Site-wise FOOD (mess) DEDUCTION MASTER – HPC and Non-HPC only. key = SalaryType|Category */
export type FoodRule={t:'day'|'month'|'none';r:number;food:string;rem:string;label?:string;id?:string;by?:string;workers?:number};
const NOD:FoodRule={t:'none',r:0,food:'Allowed',rem:'No deduction'};
type Site={co:string;plans?:boolean;rules:Record<string,FoodRule>;special?:FoodRule[]};
export const SITES:Record<string,Site>={
 'Mairi OB':{co:'CMLL',rules:{'HPC|Camp':{t:'day',r:205,food:'Allowed',rem:'HPC Rate (8 hrs duty)'},'HPC|NonCamp':{t:'day',r:102.5,food:'Allowed',rem:'HPC Rate (8 hrs duty)'},'NON|Camp':{...NOD,rem:'Fixed Rate (12 hrs duty) – no deduction'}}},
 'Dhoptala OB':{co:'CMLL',rules:{'HPC|Camp':{t:'day',r:205,food:'Allowed',rem:'HPC Rate (8 hrs duty)'},'HPC|NonCamp':{t:'none',r:0,food:'Not allowed',rem:'HPC Rate – no food, no deduction'},'NON|Camp':{...NOD,rem:'Fixed Rate (12 hrs duty) – no deduction'}}},
 'Gouri Pauni OB':{co:'CMLL',rules:{'HPC|Camp':{t:'day',r:205,food:'Allowed',rem:'HPC Rate (8 hrs duty)'},'HPC|NonCamp':{t:'none',r:0,food:'Not allowed',rem:'HPC Rate – no food, no deduction'},'NON|Camp':{...NOD,rem:'Fixed Rate (12 hrs duty) – no deduction'}}},
 'Sasti OB':{co:'CMPL SCR JV',rules:{'HPC|Camp':{t:'day',r:205,food:'Allowed',rem:'HPC Rate (8 hrs duty)'},'HPC|NonCamp':{t:'none',r:0,food:'Not allowed',rem:'HPC Rate – no food, no deduction'},'NON|Camp':{...NOD,rem:'Fixed Rate (12 hrs duty) – no deduction'}},
   special:[{id:'S100',t:'day',r:100,workers:2,food:'Allowed',rem:'Fixed Rate (12 hrs duty)',by:'PM Sir'},{id:'S70',t:'day',r:70,workers:1,food:'Allowed',rem:'Fixed Rate (12 hrs duty)',by:'PM Sir'}]},
 /* sites with a mess PLAN – worker chooses per-day or per-month (HPC & Non-HPC, Camp & Non-Camp) */
 'Jayant OB':{co:'',plans:true,rules:{}},
 'Dhudichua West':{co:'',plans:true,rules:{}},
 'Dhudichua East':{co:'',plans:true,rules:{}}};
export const PLANS=[{id:'D113',t:'day',r:113,label:'₹113 per day'},{id:'D150',t:'day',r:150,label:'₹150 per day'},{id:'M500',t:'month',r:500,label:'₹500 per month (fixed)'},{id:'NO',t:'none',r:0,label:'No mess – food not taken'}] as const;
export const SCH:Record<string,{name:string;pf:number;esic:number;pt:number;tds:number}>={
 STD:{name:'Standard Salary',pf:1,esic:1,pt:1,tds:1},STDW:{name:'Standard Salary (Women)',pf:1,esic:1,pt:1,tds:1},WC:{name:'Without Compliance',pf:0,esic:0,pt:0,tds:0}};

/* helpers */
export const R=(n:number)=>Math.round(n);   // nearest rupee: paise below 50 down, 50 and above up
export const fmt=(n:number)=>(n<0?'− ₹':'₹')+Math.abs(R(n)).toLocaleString('en-IN');
export const fmt2=(n:number)=>'₹'+n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
export const isStd=(t:string)=>t in SCH;
export function annTax(ti:number){if(ti<=CFG.rebate)return 0;let t=0;CFG.slabs.forEach((s,i)=>{const nx=CFG.slabs[i+1];if(ti>s[0])t+=(Math.min(ti,nx?nx[0]:ti)-s[0])*s[1];});return Math.min(t,ti-CFG.rebate)*(1+CFG.cess);}
export function ptKey(state:string,t:string){return state==='Maharashtra'?(t==='STDW'?'Maharashtra – Women':'Maharashtra – Men'):state;}
export function pt(g:number,key:string,month:number){const rows=CFG.PT[key];if(!rows||!g)return 0;const s=rows.find(x=>g>=x[0]&&g<=x[1]);if(!s)return 0;return s[4]&&month===s[4]?(s[3] as number):s[2];}
export function foodRule(site:string,t:string,acc:string,spId:string,planId:string):FoodRule|null{const S=SITES[site];if(!S||isStd(t)||!t)return null;
 if(S.plans){const p=PLANS.find(x=>x.id===planId);return p?{t:p.t,r:p.r,id:p.id,label:p.label,food:p.t==='none'?'Not taken':'Allowed',rem:`Mess plan – ${p.t==='day'?'per day × paid days':p.t==='month'?'fixed per month':'no deduction'}`}
   :{t:'none',r:0,food:'–',rem:'Select a mess plan',label:'Select mess plan (per day / per month)'};}
 if(spId&&S.special){const p=S.special.find(x=>x.id===spId);if(p)return {...p,food:'Allowed',label:`₹${p.r} per day – special approval (${p.by})`};}
 const r=S.rules[`${t}|${acc}`]||S.rules['*']||{...NOD,rem:'Not defined in site master – no deduction'};
 return {...r,label:r.t==='day'?`₹${r.r} per day`:r.t==='month'?`₹${r.r} per month (fixed)`:(r.food==='Not allowed'?'No deduction – food not allowed':'No deduction')};}
export function messAmt(f:FoodRule|null,pd:number){if(!f)return 0;return f.t==='day'?R(f.r*pd):f.t==='month'?f.r:0;}
export function epf(b:number){return !b?0:(b<=CFG.epfCeil?R(b*CFG.epfRate):CFG.epfFixed);}
export function expGross(t:string,o:{r:number;sal:number}){return t==='HPC'?o.r*CFG.days:o.sal;}

export type CalcInput={r:number;sal:number;md:number;pd:number;month:number;oi?:number;ot?:number;ph?:number;od?:number;site:string;acc:string;sp:string;plan:string;state:string;exp?:number;ytd?:{mb:number;g:number|null;t:number|null}|null};
export type CalcResult=Record<string,number>&{k?:{pf:number;esic:number;pt:number;tds:number;name:string};food:FoodRule|null;ptKey:string};
/* one calculation used by preview, summary and drill-down */
export function compute(t:string,o:CalcInput):CalcResult{
 const x:Record<string,number>={};let k:{pf:number;esic:number;pt:number;tds:number;name?:string}={pf:1,esic:0,pt:1,tds:1};
 if(t==='HPC'){x.perday=o.r;x.earn=R(o.r*o.pd);x.basic=R(o.r*Math.min(o.pd,CFG.days));x.oa=x.earn-x.basic;}
 else if(t==='NON'){x.exact=o.sal/o.md;x.perday=R(x.exact);x.earn=R(x.perday*o.pd);x.unit=o.r?x.earn/o.r:0;x.bdays=Math.min(Math.floor(x.unit),CFG.days);x.basic=o.r*x.bdays;x.oa=x.earn-x.basic;}   /* Basic on whole unit days only; decimal part → Other Allowance */
 else{k=SCH[t];x.eg=R(o.sal*o.pd/o.md);x.basic=R(x.eg*CFG.basicPct);x.hra=R(x.basic*CFG.hraPct);x.med=R(CFG.medical*o.pd/o.md);x.spl=x.eg-x.basic-x.hra-x.med;x.earn=x.eg;x.perday=0;}
 x.gross=x.earn+(o.oi||0);
 x.exot=isStd(t)?0:R(x.perday*(o.ot||0));x.exph=isStd(t)?0:R(x.perday*(o.ph||0));x.ex=x.exot+x.exph;
 const key=ptKey(o.state,t);
 x.pf=k.pf?epf(x.basic):0;
 x.fullBasic=isStd(t)?R(o.sal*CFG.basicPct):0;   /* ESIC eligibility on full-month Basic, not earned Basic */
 x.esic=isStd(t)&&k.esic&&x.basic&&x.fullBasic<=CFG.esicLimit?Math.ceil(x.basic*CFG.esicRate):0;
 x.pt=k.pt?pt(x.gross,key,o.month):0;const food=foodRule(o.site,t,o.acc,o.sp,o.plan);x.mess=isStd(t)?0:messAmt(food,o.pd);   /* no mess deduction in Standard schemes */
 const exp=o.exp||expGross(t,o);x.exp=exp;
 if(o.ytd){ /* Sec 192 method: YTD actuals + this month + expected × months left */
  const y=o.ytd;x.rem=(3-o.month+12)%12;x.mb=y.mb;x.ytdG=y.g!==null?y.g:exp*y.mb;
  x.ytdT=y.t!==null?y.t:R(annTax(Math.max(0,exp*12-CFG.std))/12)*y.mb;
  x.annual=x.ytdG+x.gross+x.ex+exp*x.rem;x.ti=Math.max(0,x.annual-CFG.std);x.atax=annTax(x.ti);
  x.tds=k.tds?Math.max(0,R((x.atax-x.ytdT)/(x.rem+1))):0;}
 else{ /* preview / drill-down: other 11 months assumed at full salary, spread over 12 */
  x.annual=x.gross+x.ex+exp*11;x.ti=Math.max(0,x.annual-CFG.std);x.atax=annTax(x.ti);x.tds=k.tds?R(x.atax/12):0;}
 x.od=o.od||0;
 x.ded=x.pf+x.esic+x.pt+x.mess+x.tds+x.od;x.net=x.gross-x.ded;x.pay=x.net+x.ex;
 return Object.assign(x,{k:isStd(t)?SCH[t]:undefined,food,ptKey:key}) as CalcResult;}

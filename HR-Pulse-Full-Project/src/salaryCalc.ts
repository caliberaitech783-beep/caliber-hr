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

/* Site-wise FOOD (mess) DEDUCTION MASTER – from MESS_DEDUCTION_SITE_WISE.xlsx. HPC and Non-HPC only. */
export type FoodRule={t:'day'|'month'|'none';r:number;food:string;rem:string;label?:string;id?:string;by?:string;workers?:number};
export type MessRule={category:'Camp'|'NonCamp';duty:'HPC'|'Fixed';rate:number|null;per:'day'|'month';food:'Allowed'|'Not Allowed';remark:string};
export type MessPlan={id:string;t:'day'|'month'|'none';r:number;label:string};
export type MessSite={site:string;company:string;plans:boolean;rules:MessRule[]};
export const MESS_PLANS:MessPlan[]=[{id:'D113',t:'day',r:113,label:'₹113 per day'},{id:'D150',t:'day',r:150,label:'₹150 per day'},{id:'M500',t:'month',r:500,label:'₹500 per month (fixed)'},{id:'NO',t:'none',r:0,label:'No mess – food not taken'}];
const HPC_CAMP:MessRule={category:'Camp',duty:'HPC',rate:205,per:'day',food:'Allowed',remark:'Only for HPC Rate (8 hrs duty)'};
const FIX_CAMP:MessRule={category:'Camp',duty:'Fixed',rate:null,per:'day',food:'Allowed',remark:'Fixed Rate (12 hrs duty)'};
const HPC_NONCAMP_NO:MessRule={category:'NonCamp',duty:'HPC',rate:null,per:'day',food:'Not Allowed',remark:'Only for HPC Rate (8 hrs duty)'};
export const DEFAULT_MESS_SITES:MessSite[]=[
 {site:'Jayant OB East',company:'CMLL',plans:true,rules:[]},
 {site:'Jayant OB West',company:'CMLL',plans:true,rules:[]},
 {site:'Dhudhichua OB West',company:'CMLL',plans:true,rules:[]},
 {site:'Dhudhichua OB East',company:'CMLL',plans:true,rules:[]},
 {site:'Majri OB',company:'CMLL',plans:false,rules:[HPC_CAMP,{category:'NonCamp',duty:'HPC',rate:102.5,per:'day',food:'Allowed',remark:'Only for HPC Rate (8 hrs duty)'},FIX_CAMP]},
 {site:'Dhoptala OB',company:'CMLL',plans:false,rules:[HPC_CAMP,HPC_NONCAMP_NO,FIX_CAMP]},
 {site:'Gouri Pauni OB',company:'CMLL',plans:false,rules:[HPC_CAMP,HPC_NONCAMP_NO,FIX_CAMP]},
 {site:'Sasti OB',company:'CMPL SCR JV',plans:false,rules:[HPC_CAMP,HPC_NONCAMP_NO,FIX_CAMP,
  {category:'Camp',duty:'Fixed',rate:100,per:'day',food:'Allowed',remark:'Fixed Rate (12 hrs duty) – special approval'},
  {category:'Camp',duty:'Fixed',rate:70,per:'day',food:'Allowed',remark:'Fixed Rate (12 hrs duty) – special approval'}]}];
export function loadMessSites():MessSite[]{return DEFAULT_MESS_SITES;}   /* fixed master – not editable from the app */
export const siteNames=(sites:MessSite[]=loadMessSites())=>sites.map(s=>s.site);
export const siteInfo=(site:string,sites:MessSite[]=loadMessSites())=>sites.find(s=>s.site===site)||null;
/* Non-HPC at a site: the first Fixed-duty rule is the standard one; any further Fixed rules are individually approved special rates */
export const specialRates=(site:string,sites:MessSite[]=loadMessSites())=>{const S=siteInfo(site,sites);if(!S)return [];return S.rules.filter(r=>r.duty==='Fixed'&&r.rate).map((r,i)=>({id:`SP${i}`,r:r.rate as number,rem:r.remark}));};
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
export function foodRule(site:string,t:string,acc:string,spId:string,planId:string,sites:MessSite[]=loadMessSites()):FoodRule|null{const S=siteInfo(site,sites);if(!S||isStd(t)||!t)return null;
 if(S.plans){const p=MESS_PLANS.find(x=>x.id===planId);return p?{t:p.t,r:p.r,id:p.id,label:p.label,food:p.t==='none'?'Not taken':'Allowed',rem:`Mess plan – ${p.t==='day'?'per day × paid days':p.t==='month'?'fixed per month':'no deduction'}`}
   :{t:'none',r:0,food:'–',rem:'Select a mess plan',label:'Select mess plan (per day / per month)'};}
 if(spId&&t==='NON'){const p=specialRates(site,sites).find(x=>x.id===spId);if(p)return {t:'day',r:p.r,id:p.id,food:'Allowed',rem:p.rem,label:`₹${p.r} per day – special approval`};}
 const duty=t==='HPC'?'HPC':'Fixed',r=S.rules.find(x=>x.duty===duty&&x.category===acc)||(duty==='Fixed'?S.rules.find(x=>x.duty==='Fixed'):undefined);
 if(!r)return {t:'none',r:0,food:'Allowed',rem:'Not defined in site master – no deduction',label:'No deduction'};
 const tt=r.rate?(r.per==='month'?'month':'day'):'none';
 return {t:tt,r:r.rate||0,food:r.food,rem:r.remark,label:tt==='day'?`₹${r.rate} per day`:tt==='month'?`₹${r.rate} per month (fixed)`:(r.food==='Not Allowed'?'No deduction – food not allowed':'No deduction')};}
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

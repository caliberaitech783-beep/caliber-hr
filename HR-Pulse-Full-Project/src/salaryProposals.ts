import {CFG,DEFAULT_MESS_SITES,SCH,SKILL_CATEGORIES,type MessSite} from './salaryCalc';

/* A proposal is a full editable copy of the salary scheme master. It only takes effect once the Director approves it. */
export type SchemeFlags={pf:boolean;esic:boolean;pt:boolean;tds:boolean};
export type MasterValues={
 wage:{code:string;category:string;rate:number}[];
 days:number;epfRate:number;epfCeil:number;epfFixed:number;
 std:number;rebate:number;cess:number;slabs:{from:number;to:number|null;rate:number}[];
 basicPct:number;hraPct:number;medical:number;esicRate:number;esicLimit:number;
 schemes:{STD:SchemeFlags;STDW:SchemeFlags;WC:SchemeFlags};
 sites:MessSite[]};
export type GrFile={name:string;type:string;size:number;dataUrl:string};
export type Proposal={id:string;createdAt:string;by:string;note:string;status:'Pending'|'Approved'|'Rejected';master:MasterValues;gr:GrFile|null;decidedAt?:string;decidedBy?:string;remark?:string;changes:string[]};

const PENDING='hr-pulse.salary-scheme.proposals',ACTIVE='hr-pulse.salary-scheme.active';
const flags=(k:string):SchemeFlags=>({pf:!!SCH[k].pf,esic:!!SCH[k].esic,pt:!!SCH[k].pt,tds:!!SCH[k].tds});
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
/* Snapshot of the master as it is right now (approved values if any, else the Excel defaults). */
export function currentMaster():MasterValues{return clone({
 wage:SKILL_CATEGORIES.map(c=>({code:c.label.split(' – ')[0],category:c.label.split(' – ')[1],rate:c.value})),
 days:CFG.days,epfRate:CFG.epfRate*100,epfCeil:CFG.epfCeil,epfFixed:CFG.epfFixed,
 std:CFG.std,rebate:CFG.rebate,cess:CFG.cess*100,slabs:CFG.slabs.map((s,i)=>({from:s[0],to:CFG.slabs[i+1]?.[0]??null,rate:s[1]*100})),
 basicPct:CFG.basicPct*100,hraPct:CFG.hraPct*100,medical:CFG.medical,esicRate:CFG.esicRate*100,esicLimit:CFG.esicLimit,
 schemes:{STD:flags('STD'),STDW:flags('STDW'),WC:flags('WC')},sites:DEFAULT_MESS_SITES});}
/* Make an approved master the live one (mutates the shared masters so the joining form and summary use it). */
export function applyMaster(m:MasterValues){
 SKILL_CATEGORIES.splice(0,SKILL_CATEGORIES.length,...m.wage.map(w=>({value:w.rate,label:`${w.code} – ${w.category}`})));
 CFG.days=m.days;CFG.epfRate=m.epfRate/100;CFG.epfCeil=m.epfCeil;CFG.epfFixed=m.epfFixed;CFG.std=m.std;CFG.rebate=m.rebate;CFG.cess=m.cess/100;
 CFG.slabs.splice(0,CFG.slabs.length,...m.slabs.map(s=>[s.from,s.rate/100] as [number,number]));
 CFG.basicPct=m.basicPct/100;CFG.hraPct=m.hraPct/100;CFG.medical=m.medical;CFG.esicRate=m.esicRate/100;CFG.esicLimit=m.esicLimit;
 (Object.keys(m.schemes) as (keyof MasterValues['schemes'])[]).forEach(k=>{const f=m.schemes[k];Object.assign(SCH[k],{pf:+f.pf,esic:+f.esic,pt:+f.pt,tds:+f.tds});});
 DEFAULT_MESS_SITES.splice(0,DEFAULT_MESS_SITES.length,...clone(m.sites));}
export function loadActive():{master:MasterValues;proposal:string|null}|null{try{const raw=localStorage.getItem(ACTIVE);return raw?JSON.parse(raw):null;}catch{return null;}}
export function loadProposals():Proposal[]{try{const raw=localStorage.getItem(PENDING);return raw?JSON.parse(raw):[];}catch{return [];}}
export function saveProposals(list:Proposal[]){localStorage.setItem(PENDING,JSON.stringify(list));}
/* Approving replaces the live master immediately. */
export function approve(list:Proposal[],id:string,by:string,remark:string){const next=list.map(p=>p.id===id?{...p,status:'Approved' as const,decidedAt:new Date().toISOString(),decidedBy:by,remark}:p);const p=next.find(x=>x.id===id)!;localStorage.setItem(ACTIVE,JSON.stringify({master:p.master,proposal:id}));applyMaster(p.master);saveProposals(next);return next;}
export function reject(list:Proposal[],id:string,by:string,remark:string){const next=list.map(p=>p.id===id?{...p,status:'Rejected' as const,decidedAt:new Date().toISOString(),decidedBy:by,remark}:p);saveProposals(next);return next;}
/* Human-readable list of what a proposal changes versus the live master. */
export function diff(a:MasterValues,b:MasterValues):string[]{const out:string[]=[];const inr=(n:number)=>'₹'+n.toLocaleString('en-IN');
 b.wage.forEach((w,i)=>{const o=a.wage[i];if(!o)out.push(`New wage category ${w.code} – ${w.category}: ${inr(w.rate)}/day`);else if(o.rate!==w.rate||o.category!==w.category)out.push(`Wage ${w.code} – ${w.category}: ${inr(o.rate)} → ${inr(w.rate)} per day`);});
 const n=(k:keyof MasterValues,label:string,f=(x:number)=>String(x))=>{if(a[k]!==b[k])out.push(`${label}: ${f(a[k] as number)} → ${f(b[k] as number)}`);};
 n('days','Basic days limit');n('epfRate','EPF rate',x=>x+'%');n('epfCeil','EPF Basic ceiling',inr);n('epfFixed','EPF fixed above ceiling',inr);n('std','Standard deduction',inr);n('rebate','Sec 87A rebate limit',inr);n('cess','Cess',x=>x+'%');
 n('basicPct','Basic %',x=>x+'%');n('hraPct','HRA %',x=>x+'%');n('medical','Medical',inr);n('esicRate','ESIC rate',x=>x+'%');n('esicLimit','ESIC Basic limit',inr);
 if(JSON.stringify(a.slabs)!==JSON.stringify(b.slabs))out.push('TDS slabs changed');
 (Object.keys(b.schemes) as (keyof MasterValues['schemes'])[]).forEach(k=>{if(JSON.stringify(a.schemes[k])!==JSON.stringify(b.schemes[k]))out.push(`${k==='STD'?'Standard Salary':k==='STDW'?'Standard Salary (Women)':'Without Compliance'} deduction flags changed`);});
 if(JSON.stringify(a.sites)!==JSON.stringify(b.sites))out.push('Site-wise mess deduction master changed');
 return out;}
/* Called once at startup so an approved scheme is live before any form renders. */
export function restoreApproved(){const a=loadActive();if(a)applyMaster(a.master);}

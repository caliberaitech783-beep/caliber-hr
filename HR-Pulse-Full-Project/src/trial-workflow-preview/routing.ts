/* Browser copy of server/trial-routing.mjs (owner, 20 Nov 2026), used to show who approves at each step.
   Site HR → Driver Trainer → PM → Office HR → Regional HR (region-wise) → Directors (final) → Active.
   server/trial-routing.test.mjs checks that both tables match. */
import type {Role} from './records';

export const TRIAL_REGIONAL_HR = [
  {region:'NCL',employeeId:'CMPL3399',name:'Vinod Pinjarkar',username:'vinodpinjarkar',sites:['NCL-JAYANT','NCL-JAYANT-W','NCL-DUDE','NCL-DUDW']},
  {region:'WCL',employeeId:'CMPL18114',name:'Virat Singh',username:'viratsingh',sites:['WCL-SASTI','WCL-MAJRI','WCL-DHOPTALA','WCL-GAURI']},
] as const;
export const TRIAL_DIRECTORS = [
  {name:'Mohit Chadda',username:'mohitchadda'},
  {name:'Manish Chadda',username:'manishchadda'},
  {name:'Rahul Chadda',username:'rahulchadda'},
] as const;

/* Site names as they appear in the HR app → site code. */
const SITE_CODES: [RegExp,string][] = [
  [/jayant.*west/i,'NCL-JAYANT-W'],[/jayant/i,'NCL-JAYANT'],
  [/dh?u+dh?ichua.*west/i,'NCL-DUDW'],[/dh?u+dh?ichua/i,'NCL-DUDE'],
  [/sasti/i,'WCL-SASTI'],[/majri/i,'WCL-MAJRI'],[/dh?(u|o)ptala/i,'WCL-DHOPTALA'],[/gauri|pauni/i,'WCL-GAURI'],
];
export const siteCode = (site: string) => SITE_CODES.find(([pattern])=>pattern.test(site))?.[1] || '';
export const regionalHrFor = (site: string) => {const code=siteCode(site);return TRIAL_REGIONAL_HR.find(item=>(item.sites as readonly string[]).includes(code));};

export type RouteStep = {role: Role | 'active'; label: string; who: string};
export function trialRoute(site: string): RouteStep[] {
  const regional = regionalHrFor(site);
  return [
    {role:'hr',label:'Site HR',who:'Starts the form'},
    {role:'trainer',label:'Driver Trainer',who:'Trial result'},
    {role:'pm',label:'PM',who:'Project Manager'},
    {role:'ohr',label:'Office HR',who:'Site office HR'},
    {role:'rhr',label:'Regional HR',who:regional?`${regional.name} (${regional.employeeId.replace('CMPL','')})`:'As per hierarchy'},
    {role:'director',label:'Directors',who:TRIAL_DIRECTORS.map(d=>d.name.split(' ')[0]).join(' / ')+' · final'},
    {role:'active',label:'Active',who:'Cleared to join'},
  ];
}

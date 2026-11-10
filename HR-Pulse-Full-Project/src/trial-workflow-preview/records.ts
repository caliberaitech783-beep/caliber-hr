export const ROLES = {hr: 'Site HR', trainer: 'Driver Trainer', pm: 'PM', rhr: 'Regional HR', director: 'Director'} as const;
export type Role = keyof typeof ROLES;
export const NEXT = {pm: 'rhr', rhr: 'director', director: 'done'} as const;
export type Approver = keyof typeof NEXT;
export const canApprove = (role: Role): role is Approver => Object.hasOwn(NEXT, role);
export const STAGES = [
  ['trainer', 'Trial pending', 'With Driver Trainer'],
  ['pm', 'PM approval', 'With PM'],
  ['rhr', 'Regional HR', 'With Regional HR'],
  ['director', 'Directors', 'With Directors'],
  ['done', 'Completed', 'Completed'],
  ['rejected', 'Rejected', 'Rejected'],
] as const;
export type Stage = typeof STAGES[number][0];
export const VEHICLES = ['Dumper/Tipper','Excavator','Loader','Dozer','Grader','Water Tanker','Other'];
export const DOCS = [
  ['dl','Original driving licence (valid, correct class)'],
  ['hemm','Licence class (HEMM / LMV / Heavy)'],
  ['aadhaar','Aadhaar card'],
  ['medical','Medical fitness certificate (incl. eyesight)'],
  ['exp','Experience certificate'],
] as const;
export type Post = 'Driver' | 'Operator';
export type Result = 'PASS' | 'FAIL' | '';
export type Check = {seen: string; remarks: string};
export type Candidate = {
  name: string; father: string; dob: string; mobile: string; aadhaar: string; address: string; photo: string;
  post: Post; vehicles: string[]; otherVehicle: string; dl: string; dlValid: string; experience: string;
  employer: string; trialDate: string; referredBy: string; docs: Record<typeof DOCS[number][0],Check>;
};
export type History = {role: Role; action: string; by: string; at: string; note?: string};
export type Trial = Candidate & {
  id: string; formNo: string; batch: string; site: string; createdAt: string;
  stage: Stage; result: Result; history: History[]; outcome?: Outcome & {trainer: string; at: string};
};
export type Outcome = {result: Result; post: Post; machine: string; reason: string; retrial: string; remarks: string};
export const post = (value: string): Post => value === 'Operator' ? 'Operator' : 'Driver';
export const equipment = (row: Candidate) => row.vehicles.map(item => item === 'Other' ? row.otherVehicle || item : item).join(', ');
export const status = (row: Trial) => row.stage === 'done'
  ? row.result === 'PASS' ? 'Cleared to join' : 'Closed – fail'
  : STAGES.find(([stage]) => row.stage === stage)?.[2] || '';
const INDIA = 'Asia/Kolkata';
export const indiaDay = (time = new Date()) => time.toLocaleDateString('sv-SE', {timeZone: INDIA});
export const indiaTime = (time = new Date()) => time.toLocaleTimeString('en-GB', {timeZone: INDIA, hour:'2-digit',minute:'2-digit'});
export const localDateTime = () => indiaDay()+'T'+indiaTime();
export const date = (value: string) => value ? value.slice(0,10).split('-').reverse().join('-') : '';
export const dateTime = (value: string) => value.endsWith('Z')
  ? date(indiaDay(new Date(value)))+' '+indiaTime(new Date(value))
  : [date(value),value.slice(11,16)].filter(Boolean).join(' ');
export function nextNumber(records: Trial[], offset = 0) {
  const [year, month] = indiaDay().split('-').map(Number);
  const start = month < 4 ? year-1 : year;
  const prefix = `TF/${start}-${String(start+1).slice(-2)}/`;
  const last = Math.max(0,...records.filter(row => row.formNo.startsWith(prefix)).map(row => Number(row.formNo.slice(prefix.length))||0));
  return prefix+String(last+offset+1).padStart(4,'0');
}
export function licenceDate(value: string) {
  if (!value) return '';
  const parts = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  const iso = parts ? `${parts[3].length===2?'20':''}${parts[3]}-${parts[2].padStart(2,'0')}-${parts[1].padStart(2,'0')}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const parsed = new Date(iso);
  return Number.isFinite(+parsed)&&parsed.toISOString().slice(0,10)===iso ? iso : '';
}
export function candidateProblem(candidate: Candidate, records: Trial[]) {
  if (!candidate.name) return 'Enter the candidate name.';
  if (!/^\d{10}$/.test(candidate.mobile)) return 'Mobile number must be 10 digits.';
  if (candidate.aadhaar && !/^\d{12}$/.test(candidate.aadhaar)) return 'Enter a 12-digit Aadhaar number or leave it blank.';
  if (candidate.aadhaar && records.some(row => row.aadhaar === candidate.aadhaar && row.stage !== 'rejected' && row.result !== 'FAIL'))
    return 'This Aadhaar already has a pending or passed trial.';
  if (!candidate.vehicles.length || candidate.vehicles.includes('Other') && !candidate.otherVehicle) return 'Choose the vehicle or enter the other equipment.';
  if (!candidate.trialDate) return 'Set the trial date and time.';
  if (candidate.docs.dl.seen !== 'Yes' || candidate.docs.medical.seen !== 'Yes') return 'Mark the driving licence and medical fitness certificate as seen.';
  return '';
}
export function resultMessage(row: Trial) {
  const cleared = row.stage === 'done' && row.result === 'PASS';
  return [
    cleared ? '🎉 CLEARED TO JOIN' : '🚛 VEHICLE TRIAL RESULT','', 'Result: ✅ PASS',
    'Name: '+row.name, 'Post: '+(row.outcome?.post || row.post),
    'Vehicle: '+(row.outcome?.machine || equipment(row)),
    'Experience: '+(row.experience ? row.experience+' years':'–'), 'Referred by: '+(row.referredBy||'–'),
    'Trial date: '+date(row.trialDate), 'Form No: '+row.formNo, 'Trial by: '+(row.outcome?.trainer||'–'),
    cleared ? 'Approved by: PM, Regional HR, Directors' : 'Status: '+(row.stage === 'pm' ? 'Sent to PM for approval' : status(row)), 'Site: '+row.site,
  ].join('\n');
}

/* Real Telegram delivery for the trial workflow (Vehicle Trial Result bot):
   Part 1 submit  → "Trial Form Submitted" (single) or batch message + PDF sheet, to the Part 1 recipients (driver trainer)
   Trainer result → single result message, or "BULK VEHICLE TRIAL RESULT" + Excel sheet + attachments, to the Part 2 recipients (PM …)
   Recipients are set in the Trial Form › Telegram recipients tables (Approval Management permission). */
import {api, savedSession} from '../api';
import {utils as xlsxUtils, write as xlsxWrite} from 'xlsx';
import {equipment, type Trial} from './records';
import {reviewTrial,type ReviewRecord} from './reviewQueue';
import type {TrialChecklistDocuments} from '../trialHandoff';

export type Delivery = {message: string; recipients: number; connected: string[]; bot?: string; configured?: boolean; issues?: string[]};
export type TrialScope = {company: string; site: string; region: string; group: string; department: string};
export type TrialTrainer = {actor:string;name:string;site:string;reason?:string;roles?:string[];overview?:boolean};
const target = ({site, region, group, company}: TrialScope) => ({site, region, group, company});
type Attachment = {name: string; mime: string; data: string; kind?:'photo'|'trialResult'|'drivingVideo'|'aadhaar'|'drivingLicence'};
const dlClassDetails = (row: Trial) => (row.dlClasses||[]).map(item=>[
  `Class / Code: ${item.code||'–'}`,`Issued by: ${item.issuedBy||'–'}`,`Date of issue: ${item.dateOfIssue||'–'}`,
  `Vehicle category: ${item.vehicleCategory||'–'}`,`Badge number: ${item.badgeNumber||'–'}`,
  `Badge issued date: ${item.badgeIssuedDate||'–'}`,`Badge issued by: ${item.badgeIssuedBy||'–'}`,
].join(' | ')).join('\n');

const fields = (row: Trial): Record<string,string> => ({
  'Name of candidate': row.name, "Father's name": row.father, 'Date of birth / Age': row.dob, 'Mobile no.': row.mobile, 'Aadhaar no.': row.aadhaar,
  'Address': row.address, 'Post applied for': row.post, 'Vehicle / equipment for trial': equipment(row), 'Other equipment': '',
  'Driving licence no.': row.dl, 'DL class details':dlClassDetails(row), 'DL issue date':row.dlIssue||'',
  'DL valid up to dates':(row.dlValidDates?.length?row.dlValidDates:row.dlValid.split(',').map(value=>value.trim()).filter(Boolean)).join('\n'),
  'Total experience (years)': row.experience, 'Previous employer': row.employer,
  'Trial date & time': row.trialDate, 'Referred by': row.referredBy, 'Trial Conducted by':row.trialConductedBy||'',
  ...(row.outcome ? {'Result': row.outcome.result, 'If PASS – recommended for': row.outcome.result==='PASS' ? row.outcome.post : '', 'Machine': row.outcome.machine,
    'If FAIL – reason': row.outcome.reason, 'Examiner name': row.outcome.trainer, 'Trial conducted by': row.outcome.trainer, 'Examiner remarks': row.outcome.remarks} : {}),
});
const dataUrl = (name: string, url: string, kind?:Attachment['kind']): Attachment | null => {
  const m = String(url||'').match(/^data:([^;,]+)[^,]*,(.*)$/);
  return m ? {name: name+(m[1].includes('png')?'.png':m[1].includes('pdf')?'.pdf':'.jpg'), mime: m[1], data: m[2],kind} : null;
};
const fileAttachment = (file?: File,kind?:Attachment['kind']) => new Promise<Attachment | null>(resolve => {
  if (!file || file.size > 4*1024*1024) {resolve(null); return;}
  const reader = new FileReader();
  reader.onload = () => {const m = String(reader.result||'').match(/^data:([^;,]+)[^,]*,(.*)$/); resolve(m ? {name: file.name, mime: m[1], data: m[2],kind} : null);};
  reader.onerror = () => resolve(null);
  reader.readAsDataURL(file);
});
const grantOrThrow = () => {const grant = savedSession()?.grant; if (!grant) throw new Error('Sign in again to send on Telegram.'); return grant;};

export async function fetchTrialTrainer(scope:TrialScope):Promise<TrialTrainer>{
  return api<TrialTrainer>(grantOrThrow(),'telegram/trial-trainer','POST',target(scope));
}
export async function fetchReviewQueue(scope:TrialScope):Promise<Trial[]>{
  const out=await api<{rows:ReviewRecord[]}>(grantOrThrow(),'telegram/trial-review-queue','POST',target(scope));
  return (out.rows||[]).map(reviewTrial).filter((row):row is Trial=>Boolean(row));
}

/* Human-readable delivery line for the popup. */
export function deliveryStatus(d: Delivery, names: (key: string) => string = key => key) {
  if (d.configured===false) return 'Vehicle Trial Result bot is not configured on the server (TELEGRAM_TRIAL_BOT_TOKEN).';
  if (!d.recipients) return 'No Telegram recipient is set for this step – assign the approver in Approval Master.';
  const base = d.connected.length ? `Sent to ${d.connected.map(names).join(', ')} via @${d.bot||'the trial bot'}.` : 'Queued – the recipients have not opened the trial bot yet (they must tap Start).';
  return d.issues?.length ? base+' '+d.issues.join(' · ') : base;
}

export async function sendPart1(created: Trial[], scope: TrialScope, documents:TrialChecklistDocuments={}): Promise<Delivery & {formNos: string[]}> {
  const grant = grantOrThrow();
  const documentAttachments=await Promise.all([fileAttachment(documents.aadhaar,'aadhaar'),fileAttachment(documents.drivingLicence,'drivingLicence')]);
  const out = await api<{batchId: string; formNos?: string[]; telegram: Delivery}>(grant, 'telegram/trial-part1', 'POST', {
    heading: scope.site, ...target(scope), department: scope.department, trialBy: 'driver trainer', batchId: created[0]?.batch || '',
    candidates: created.map(row => ({formNo: row.formNo, clientId: row.id, fields: fields(row), attachments: [dataUrl('photo', row.photo,'photo'),...documentAttachments].filter(Boolean)})),
  });
  // The server gives a form the next free number when another site already holds the browser's number.
  return {...out.telegram, formNos: created.map((row,index)=>out.formNos?.[index] || row.formNo)};
}

export async function sendResults(changed: Trial[], resultFiles: Map<string, File | undefined>, drivingVideos: Map<string, File | undefined>, trialBy: string, scope: TrialScope): Promise<Delivery> {
  const grant = grantOrThrow();
  const batchId = changed.length > 1 ? (changed[0].batch || 'B-'+changed[0].formNo.replace(/\W+/g,'').slice(-6).toUpperCase()) : '';
  const rows = await Promise.all(changed.map(async row => ({
    formNo: row.formNo, fields: fields(row),
    attachments: [dataUrl('photo', row.photo,'photo'), await fileAttachment(resultFiles.get(row.id),'trialResult'), await fileAttachment(drivingVideos.get(row.id),'drivingVideo')].filter(Boolean),
  })));
  if (!batchId) {
    const out = await api<{telegram: Delivery}>(grant, 'telegram/trial-result', 'POST', {
      ...rows[0], heading: scope.site, ...target(scope), department: scope.department, batchId: changed[0].batch || '', trialBy,
    });
    return out.telegram;
  }
  /* Two Excel files: PASSED and FAILED candidates. */
  const sheetFor = (list: Trial[]) => {
    const sheet = xlsxUtils.json_to_sheet(list.map((row, i) => ({
      '#': i+1, 'Form No': row.formNo, 'Name': row.name, 'Post': row.outcome?.post || row.post, 'Vehicle': row.outcome?.machine || equipment(row),
      'Experience (yrs)': row.experience, 'Referred by': row.referredBy, 'Aadhaar': row.aadhaar, 'Mobile': row.mobile, 'Trial date': row.trialDate,
      'Result': row.result, 'Reason (if FAIL)': row.outcome?.reason || '', 'Remarks': row.outcome?.remarks || '', 'Trial by': row.outcome?.trainer || trialBy, 'Site': row.site, 'Batch': batchId,
    })));
    const wb = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(wb, sheet, 'Trial results');
    return xlsxWrite(wb, {type: 'base64', bookType: 'xlsx'});
  };
  const passedRows = changed.filter(row => row.result==='PASS'), failedRows = changed.filter(row => row.result!=='PASS');
  const xlsxPass = passedRows.length ? sheetFor(passedRows) : '', xlsxFail = failedRows.length ? sheetFor(failedRows) : '';
  const out = await api<{telegram: Delivery}>(grant, 'telegram/trial-batch-result', 'POST', {
    batchId, trialBy, xlsxPass, xlsxFail, heading: scope.site, ...target(scope), department: scope.department,
    rows, results: changed.map(row => ({formNo: row.formNo, result: row.result, reason: row.outcome?.reason || '', remarks: row.outcome?.remarks || ''})),
  });
  return out.telegram;
}

/* Approval stages: PM → Office HR → Regional HR → Directors (final → "Joining approved" to everyone). */
export async function sendApproval(changed: Trial[], reviewer: 'pm'|'ohr'|'rhr'|'director', approved: boolean, note: string, by: string, at: string, resultFiles: (id: string) => Promise<File | undefined>, scope: TrialScope): Promise<Delivery> {
  const grant = grantOrThrow();
  const rows = await Promise.all(changed.map(async row => ({
    formNo: row.formNo, fields: fields(row), history: row.history, trialBy: row.outcome?.trainer || '',
    docs: Object.fromEntries(Object.entries(row.docs || {}).map(([k, v]) => [k, (v as {seen: string}).seen])),
    attachments: [dataUrl('photo', row.photo,'photo'), await fileAttachment(row.outcome?.attachment ? await resultFiles(row.outcome.attachment.id) : undefined,'trialResult'), await fileAttachment(row.outcome?.videoAttachment ? await resultFiles(row.outcome.videoAttachment.id) : undefined,'drivingVideo')].filter(Boolean),
  })));
  let xlsx = '';
  if (approved && reviewer === 'director' && changed.length > 1) {
    const sheet = xlsxUtils.json_to_sheet(changed.map((row, i) => ({
      '#': i+1, 'Form No': row.formNo, 'Name': row.name, 'Post': row.outcome?.post || row.post, 'Vehicle': row.outcome?.machine || equipment(row), 'Mobile': row.mobile, 'Aadhaar': row.aadhaar, 'Trial date': row.trialDate, 'Site': row.site,
      'Joining date': '', 'Employee code': '', 'Bank account': '', 'IFSC': '', 'UAN': '', 'ESIC': '', 'Nominee': '', 'Emergency contact': '', 'Form B entry': '', 'VTC / induction': '', 'PPE / ID card / gate pass': '',
    })));
    const wb = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(wb, sheet, 'Joining list');
    xlsx = xlsxWrite(wb, {type: 'base64', bookType: 'xlsx'});
  }
  const out = await api<{telegram: Delivery}>(grant, 'telegram/trial-approval', 'POST', {
    reviewer, approved, note, by, at, rows, xlsx, ...target(scope), department: scope.department, batchId: changed.length > 1 ? changed[0].batch : changed[0].batch || '',
  });
  return out.telegram;
}

/* Decisions taken on Telegram (Approve / Decline buttons) for the given forms. */
export type SyncRow = {formNo: string; history: Trial['history']; stage: string; pendingRole: string; status: string};
export async function fetchDecisions(formNos: string[]): Promise<SyncRow[]> {
  const grant = savedSession()?.grant;
  if (!grant || !formNos.length) return [];
  const out = await api<{rows: SyncRow[]}>(grant, 'telegram/trial-sync', 'POST', {formNos});
  return out.rows || [];
}

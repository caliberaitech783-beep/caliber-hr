/* Real Telegram delivery for the trial workflow (Vehicle Trial Result bot):
   Part 1 submit  → "Trial Form Submitted" (single) or batch message + PDF sheet, to the Part 1 recipients (driver trainer)
   Trainer result → single result message, or "BULK VEHICLE TRIAL RESULT" + Excel sheet + attachments, to the Part 2 recipients (PM …)
   Recipients are set in the Trial Form › Telegram recipients tables (Approval Management permission). */
import {api, savedSession} from '../api';
import {utils as xlsxUtils, write as xlsxWrite} from 'xlsx';
import {equipment, type Trial} from './records';
import {loadSelection} from '../TrialForm';
/* Region (NCL / WCL …) and employee group come from the top-bar selection; the server sends only to recipients scoped to this site / group. */
const target = (scope: Scope) => {const sel = loadSelection(); return {site: scope.site || sel.site, region: sel.region, group: sel.employeeGroup, company: scope.company || sel.company};};

export type Delivery = {message: string; recipients: number; connected: string[]; bot?: string; configured?: boolean; issues?: string[]};
type Scope = {company: string; site: string; department: string};
type Attachment = {name: string; mime: string; data: string};

const fields = (row: Trial): Record<string,string> => ({
  'Name of candidate': row.name, "Father's name": row.father, 'Date of birth / Age': row.dob, 'Mobile no.': row.mobile, 'Aadhaar no.': row.aadhaar,
  'Address': row.address, 'Post applied for': row.post, 'Vehicle / equipment for trial': equipment(row), 'Other equipment': '',
  'Driving licence no. & class': row.dl, 'DL valid up to': row.dlValid, 'Total experience (years)': row.experience, 'Previous employer': row.employer,
  'Trial date & time': row.trialDate, 'Referred by': row.referredBy,
  ...(row.outcome ? {'Result': row.outcome.result, 'If PASS – recommended for': row.outcome.result==='PASS' ? row.outcome.post : '', 'Machine': row.outcome.machine,
    'If FAIL – reason': row.outcome.reason, 'Examiner name': row.outcome.trainer, 'Trial conducted by': row.outcome.trainer, 'Examiner remarks': row.outcome.remarks} : {}),
});
const dataUrl = (name: string, url: string): Attachment | null => {
  const m = String(url||'').match(/^data:([^;,]+)[^,]*,(.*)$/);
  return m ? {name: name+(m[1].includes('png')?'.png':m[1].includes('pdf')?'.pdf':'.jpg'), mime: m[1], data: m[2]} : null;
};
const fileAttachment = (file?: File) => new Promise<Attachment | null>(resolve => {
  if (!file || file.size > 4*1024*1024) {resolve(null); return;}
  const reader = new FileReader();
  reader.onload = () => {const m = String(reader.result||'').match(/^data:([^;,]+)[^,]*,(.*)$/); resolve(m ? {name: file.name, mime: m[1], data: m[2]} : null);};
  reader.onerror = () => resolve(null);
  reader.readAsDataURL(file);
});
const grantOrThrow = () => {const grant = savedSession()?.grant; if (!grant) throw new Error('Sign in again to send on Telegram.'); return grant;};

/* Human-readable delivery line for the popup. */
export function deliveryStatus(d: Delivery, names: (key: string) => string = key => key) {
  if (d.configured===false) return 'Vehicle Trial Result bot is not configured on the server (TELEGRAM_TRIAL_BOT_TOKEN).';
  if (!d.recipients) return 'No Telegram recipient is set for this step – add them under Telegram recipients.';
  const base = d.connected.length ? `Sent to ${d.connected.map(names).join(', ')} via @${d.bot||'the trial bot'}.` : 'Queued – the recipients have not opened the trial bot yet (they must tap Start).';
  return d.issues?.length ? base+' '+d.issues.join(' · ') : base;
}

export async function sendPart1(created: Trial[], scope: Scope): Promise<Delivery> {
  const grant = grantOrThrow();
  const out = await api<{batchId: string; telegram: Delivery}>(grant, 'telegram/trial-part1', 'POST', {
    heading: scope.site, ...target(scope), department: scope.department, trialBy: 'driver trainer', batchId: created[0]?.batch || '',
    candidates: created.map(row => ({formNo: row.formNo, fields: fields(row), attachments: [dataUrl('photo', row.photo)].filter(Boolean)})),
  });
  return out.telegram;
}

export async function sendResults(changed: Trial[], resultFiles: Map<string, File | undefined>, trialBy: string, scope: Scope): Promise<Delivery> {
  const grant = grantOrThrow();
  const batchId = changed.length > 1 ? (changed[0].batch || 'B-'+changed[0].formNo.replace(/\W+/g,'').slice(-6).toUpperCase()) : '';
  const rows = await Promise.all(changed.map(async row => ({
    formNo: row.formNo, fields: fields(row),
    attachments: [dataUrl('photo', row.photo), await fileAttachment(resultFiles.get(row.id))].filter(Boolean),
  })));
  if (!batchId) {
    const out = await api<{telegram: Delivery}>(grant, 'telegram/trial-result', 'POST', {
      ...rows[0], heading: scope.site, ...target(scope), department: scope.department, batchId: changed[0].batch || '', trialBy,
    });
    return out.telegram;
  }
  const sheet = xlsxUtils.json_to_sheet(changed.map((row, i) => ({
    '#': i+1, 'Form No': row.formNo, 'Name': row.name, 'Post': row.outcome?.post || row.post, 'Vehicle': row.outcome?.machine || equipment(row),
    'Experience (yrs)': row.experience, 'Referred by': row.referredBy, 'Aadhaar': row.aadhaar, 'Mobile': row.mobile, 'Trial date': row.trialDate,
    'Result': row.result, 'Reason (if FAIL)': row.outcome?.reason || '', 'Remarks': row.outcome?.remarks || '', 'Trial by': row.outcome?.trainer || trialBy, 'Site': row.site, 'Batch': batchId,
  })));
  const wb = xlsxUtils.book_new();
  xlsxUtils.book_append_sheet(wb, sheet, 'Trial results');
  const xlsx = xlsxWrite(wb, {type: 'base64', bookType: 'xlsx'});
  const out = await api<{telegram: Delivery}>(grant, 'telegram/trial-batch-result', 'POST', {
    batchId, trialBy, xlsx, heading: scope.site, ...target(scope), department: scope.department,
    rows, results: changed.map(row => ({formNo: row.formNo, result: row.result, reason: row.outcome?.reason || '', remarks: row.outcome?.remarks || ''})),
  });
  return out.telegram;
}

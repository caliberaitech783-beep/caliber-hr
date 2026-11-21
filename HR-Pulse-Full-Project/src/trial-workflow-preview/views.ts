import {date, dateTime, DOCS, equipment, indiaDay, indiaTime, isClearedForJoining, isOtpRole, ROLES, status, votesText, type Outcome, type Role, type Trial} from './records';
import {regionalHrFor} from './routing';
import {siteDisplayName} from '../siteNames';

const escapes: Record<string,string> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,char=>escapes[char]);
export const resultPill = (row: Trial) => row.result === 'PASS' ? '<span class="pill p-pass">PASS</span>'
  : row.result === 'FAIL' ? '<span class="pill p-fail">FAIL</span>' : '<span class="pill p-wait">Trial pending</span>';
export const stagePill = (row: Trial) => `<span class="pill ${row.stage === 'done' && row.result === 'PASS' ? 'p-pass' : row.stage === 'done' || row.stage === 'rejected' ? 'p-fail' : 'p-stage'}">${esc(status(row))}</span>`;
const candidateLink = (row: Trial) => `<button type="button" class="link" data-open="${esc(row.id)}">${esc(row.name)}</button>`;
export function table(headers: string[], rows: string, width?: number) {
  return `<div class="scroll"><table class="t"${width ? ` style="min-width:${width}px"` : ''}><thead><tr>${headers.map(item=>`<th scope="col">${item}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
/* Site name column, with the site's region (NCL / WCL) under it (owner, 21 Nov 2026). */
const siteCell = (site: string) => {
  if (!site) return '<span class="muted">–</span>';
  const region = regionalHrFor(site)?.region;
  return `${esc(siteDisplayName(site))}${region ? `<div class="muted small">${esc(region)}</div>` : ''}`;
};
export function overviewTable(records: Trial[], canOpenJoining = false) {
  return table(['Form no.','Candidate','Site name','Post','Vehicle','Exp','Referred by','Trial date','Result','Status'], records.map(row=>`
    <tr><td class="mono">${esc(row.formNo)}</td><td>${candidateLink(row)}<div class="muted small">${esc(row.mobile)}</div></td>
    <td>${siteCell(row.site)}</td><td>${esc(row.post)}</td><td>${esc(equipment(row))}</td><td>${esc(row.experience)}${row.experience?' yrs':''}</td>
    <td>${esc(row.referredBy)}</td><td>${esc(dateTime(row.trialDate))}</td><td>${resultPill(row)}</td><td>${stagePill(row)}${canOpenJoining&&isClearedForJoining(row)?` <button type="button" class="btn pri sm" data-join-trial="${esc(row.id)}" aria-label="Open Step 2 for ${esc(row.name)}">Open Step 2</button>`:''}</td></tr>`).join(''));
}
/* Two or more Driver Trainers: a Yes / No tick for every trainer; PASS only when all say Yes (owner, 20 Nov 2026). */
function voteTable(draft: Outcome | undefined, prefix: string, disabled: string) {
  const votes = draft?.votes;
  if (!votes || votes.length < 2) return '';
  const cells = (actor: string, name: string, vote: string) => (['YES','NO'] as const).map(choice=>
    `<td style="text-align:center"><input type="checkbox" data-vote="${esc(actor)}" data-v="${choice}" aria-label="${prefix}${choice==='YES'?'Yes':'No'} from ${esc(name)}" ${vote===choice?'checked':''} ${disabled}></td>`).join('');
  const summary = draft.result==='PASS' ? '✅ PASS – every trainer said Yes' : draft.result==='FAIL' ? `❌ FAIL – No from ${esc(votes.filter(v=>v.vote==='NO').map(v=>v.name).join(', '))}` : `Tick Yes or No for every trainer (${votes.filter(v=>!v.vote).length} left)`;
  return `<table class="t vote-table" aria-label="${prefix}Trainer votes"><thead><tr><th scope="col">#</th><th scope="col">Driver Trainer</th><th scope="col" style="text-align:center">✅ Yes</th><th scope="col" style="text-align:center">❌ No</th></tr></thead>
    <tbody>${votes.map((v,i)=>`<tr><td>${i+1}</td><td>${esc(v.name)}</td>${cells(v.actor,v.name,v.vote)}</tr>`).join('')}</tbody></table>
    <p class="small vote-result" role="status"><b>Result: ${summary}</b></p>`;
}
function resultFields(id: string, name: string, draft?: Outcome, allowed = false, file?: File, video?: File, optimizingVideo = false) {
  const prefix = name ? esc(name) + ': ' : '';
  const disabled = allowed ? '' : 'disabled';
  const passDisabled = allowed && draft?.result === 'PASS' ? '' : 'disabled';
  const failDisabled = allowed && draft?.result === 'FAIL' ? '' : 'disabled';
  const row = (label: string, control: string) =>
    `<div class="row"><div class="k">${label}</div><div class="v">${control}</div></div>`;
  const resultButtons = (['PASS','FAIL'] as const).map(result=>{
    const active = draft?.result === result;
    return `<button type="button" data-res="${result}" aria-pressed="${active}" aria-label="${prefix}${result}" class="${result.toLowerCase()} ${active?'on':''}" ${disabled}>${result}</button>`;
  }).join('');
  const posts = (['Driver','Operator'] as const).map(option=>
    `<label class="chk"><input type="radio" name="recommended-${esc(id)}" data-f="post" value="${option}" aria-label="${prefix}Recommend ${option}" ${draft?.post===option?'checked':''} ${passDisabled}> ${option}</label>`
  ).join('');
  return `<div class="rows trainer-fields">
    ${row('Trial result files *', `
      <span class="trial-upload-actions">
        <button type="button" class="btn pri" data-choose-result-file aria-label="${prefix}${file?'Replace trial result file':'Upload trial result'}" ${disabled}>${file?'Replace file':'Upload trial result'}</button>
        <button type="button" class="btn pri" data-choose-driving-video aria-label="${prefix}${video?'Replace driving video':'Upload Driving Video'}" ${allowed&&!optimizingVideo?'':'disabled'}>${optimizingVideo?'Optimizing video…':video?'Replace video':'Upload Driving Video'}</button>
      </span>
      <span class="note">Result required: PDF, JPG or PNG · Driving video optional, automatically optimized to 480p, 15 FPS (AV1 → VP9 → H.264)</span>
      ${file ? `<span class="trial-result-filename" role="status">${esc(file.name)}</span><button type="button" class="btn sm" data-remove-result-file ${disabled}>Remove file</button>` : ''}
      ${video ? `<span class="trial-result-filename" role="status">${esc(video.name)}</span><button type="button" class="btn sm" data-remove-driving-video ${disabled}>Remove video</button>` : ''}`)}
    ${row('Result', voteTable(draft, prefix, disabled) || `<div class="pf">${resultButtons}</div>`)}
    ${row('If PASS – recommended for', `
      <div class="recommended-post" role="group" aria-label="${prefix}Recommended post">${posts}</div>
      <label class="trainer-machine">Machine <input type="text" data-f="machine" aria-label="${prefix}Machine" value="${esc(draft?.machine)}" ${passDisabled}></label>`)}
    ${row(`If FAIL – reason${draft?.result==='FAIL'?' *':''}`, `<input type="text" data-f="reason" aria-label="${prefix}Failure reason" value="${esc(draft?.reason)}" ${draft?.result==='FAIL'?'required aria-required="true"':''} ${failDisabled}>`)}
    ${row('Trial conducted by', `<input type="text" class="trainer-frozen" data-f="trainer" aria-label="${prefix}Trial conducted by" value="${esc(draft?.trainer)}" placeholder="Fetched from Driver Trainer hierarchy" readonly>`)}
    ${row('Examiner remarks', `<input type="text" data-f="remarks" aria-label="${prefix}Examiner remarks" value="${esc(draft?.remarks)}" ${disabled}>`)}
  </div>`;
}
export function trainerForms(records: Trial[], draftFor: (row: Trial) => Outcome, allowed: boolean, files: ReadonlyMap<string, File>, videos: ReadonlyMap<string, File>, optimizingVideos:ReadonlySet<string>) {
  if (!records.length) {
    return `<p class="note trainer-empty">Submit a candidate in Part 1 to enable the trial result upload.</p>${resultFields('empty','')}`;
  }
  return records.map(row=>{
    const checks = [['DL',row.docs.dl],['Aadhaar',row.docs.aadhaar],['Medical',row.docs.medical]] as const;
    return `<article class="trainer-card" data-id="${esc(row.id)}">
      <div class="trainer-card-head">
        ${candidateLink(row)}
        <span class="muted small mono">${esc(row.formNo)}${row.batch?' · '+esc(row.batch):''}</span>
        <span class="small">${esc(equipment(row))} · ${esc(dateTime(row.trialDate))}${row.experience?' · '+esc(row.experience)+' yrs':''}</span>
        <span class="muted small">${checks.map(([label,check])=>label+(check.seen==='Yes'?' ✓':' –')).join(' · ')}</span>
      </div>
      ${resultFields(row.id,row.name,draftFor(row),allowed,files.get(row.id),videos.get(row.id),optimizingVideos.has(row.id))}
    </article>`;
  }).join('');
}
export function approvalTable(records: Trial[], selected: Set<string>) {
  const all = records.every(row=>selected.has(row.id));
  return table([`<input type="checkbox" id="apAll" aria-label="Select all forms" ${all?'checked':''}>`,
    'Form no.','Candidate','Post · Machine','Result','Trainer','Trial date','Last step'], records.map(row=>{
    const last=row.history.at(-1);
    return `<tr><td><input type="checkbox" data-sel="${esc(row.id)}" aria-label="Select ${esc(row.name)}" ${selected.has(row.id)?'checked':''}></td>
      <td class="mono">${esc(row.formNo)}</td><td>${candidateLink(row)}<div class="muted small">Ref: ${esc(row.referredBy)||'–'}</div></td>
      <td>${esc(row.outcome?.post||row.post)} · ${esc(row.outcome?.machine||equipment(row))}</td>
      <td>${resultPill(row)}${row.outcome?.reason?`<div class="small muted">${esc(row.outcome.reason)}</div>`:''}</td><td>${esc(row.outcome?.trainer)}</td>
      <td>${esc(dateTime(row.trialDate))}</td><td class="small">${last?esc(ROLES[last.role])+': '+esc(last.by):''}<div class="muted">${esc(dateTime(last?.at||''))}</div></td></tr>`;
  }).join(''));
}
export function detailView(row: Trial, role: Role, canOpenJoining = false, otpApproval = false) {
  const item = (label: string,value: string) => `<div class="row"><div class="k">${label}</div><div class="v">${value||'<span class="muted">–</span>'}</div></div>`;
  const section = (data: [string,string][])=>data.map(([label,value])=>item(label,esc(value))).join('');
  const out=row.outcome;
  const dlClasses=(row.dlClasses||[]).map(item=>[item.code,item.issuedBy,item.dateOfIssue&&date(item.dateOfIssue),item.vehicleCategory,item.badgeNumber,item.badgeIssuedDate&&date(item.badgeIssuedDate),item.badgeIssuedBy].filter(Boolean).join(' · ')).join('; ');
  const dlValidDates=(row.dlValidDates?.length?row.dlValidDates:row.dlValid.split(',')).map(value=>date(value.trim())).filter(Boolean).join('; ');
  const photo=/^data:image\/jpeg;base64,[\w+/=]+$/.test(row.photo) ? `<img src="${esc(row.photo)}" alt="Photo of ${esc(row.name)}" style="width:120px;height:150px;object-fit:cover;border-radius:6px">` : '<span class="muted small">No photo</span>';
  const signs = Object.entries(ROLES).map(([key,label])=>{
    const entry=[...row.history].reverse().find(h=>h.role===key)
      // A result saved before the trainer's step was recorded still names who conducted the trial.
      ||(key==='trainer'&&out&&row.result?{role:'trainer',action:'Trial result: '+row.result,by:out.trainer,at:out.at}:undefined);
    const cls=!entry?'wait':entry.action==='Rejected'||key==='trainer'&&row.result==='FAIL'?'no':'ok';
    const action=entry ? key==='trainer'?row.result:entry.action : row.stage===key?'Pending':'–';
    return `<div class="sig ${cls}"><b>${label}</b><span class="st">${esc(action)}</span><span>${esc(entry?.by)}</span><span class="muted">${entry?.at?esc(date(indiaDay(new Date(entry.at)))):''}</span></div>`;
  }).join('');
  return `<div class="panel-head"><div><h2>${esc(row.name)}</h2><span class="mono muted small">${esc(row.formNo)}${row.batch?' · Batch '+esc(row.batch):''} · ${esc(row.site)}</span></div>
      <div class="actions">${stagePill(row)}${canOpenJoining&&isClearedForJoining(row)?'<button type="button" class="btn pri sm" data-open-joining>Open Step 2</button>':''}${row.result==='PASS'?'<button type="button" class="btn tg sm" id="mTelegram">Telegram message</button>':''}<button type="button" class="btn sm" id="mClose">Close</button></div></div>
    <div class="secbar">Part 1 – Candidate details <em>Site HR</em></div>
    <div class="grid-form"><div class="rows">${section([
      ["Father's name",row.father],['Date of birth',date(row.dob)],['Mobile no.',row.mobile],['Aadhaar no.',row.aadhaar],['Address',row.address],
      ['Post applied for',row.post],['Vehicle / equipment',equipment(row)],['Driving licence no.',row.dl],['Class details',dlClasses],['DL issue date',date(row.dlIssue||'')],['DL valid up to',dlValidDates],
      ['Experience',row.experience?row.experience+' years':''],['Previous employer',row.employer],['Trial date &amp; time',dateTime(row.trialDate)],['Referred by',row.referredBy],['Trial Conducted by',row.trialConductedBy||''],
    ])}</div><div class="photo">${photo}</div></div>
    <div class="secbar">Document check</div>
    ${table(['Document','Seen','Remarks'],DOCS.map(([key,label])=>`<tr><td>${label}</td><td>${esc(row.docs[key]?.seen)||'–'}</td><td>${esc(row.docs[key]?.remarks)}</td></tr>`).join(''),420)}
    <div class="secbar">Part 2 – Trial result <em>Driver Trainer</em></div>
    <div class="rows" style="border:1px solid var(--line-strong)">${item('Result',resultPill(row))}${section([
      ['If PASS – recommended for',out && row.result==='PASS'?[out.post,out.machine].filter(Boolean).join(' – '):''],['If FAIL – reason',out?.reason||''],
      ['Trial conducted by',out?.trainer||''],...(out?.votes?.length?[['Trainer votes',votesText(out.votes)] as [string,string]]:[]),['Examiner remarks',out?.remarks||''],
    ])}${out?.attachment ? item('Trial result file', `<button type="button" class="link trial-result-filename" data-download-result>Download ${esc(out.attachment.name)}</button>`) : ''}${out?.videoAttachment ? item('Driving video', `<button type="button" class="link trial-result-filename" data-download-driving-video>Download ${esc(out.videoAttachment.name)}</button>`) : ''}</div>
    <div class="secbar">Approvals</div><div class="sigs">${signs}</div>
    ${row.history.filter(h=>h.note).map(h=>`<p class="note"><b>${esc(ROLES[h.role])} (${esc(h.by)}):</b> ${esc(h.note)}</p>`).join('')}
    ${row.stage===role && ['pm','ohr','rhr','director'].includes(role) ? `<div class="actions"><input id="mNote" aria-label="Decision note" placeholder="Note (required to reject)"><button type="button" class="btn no" data-decide="reject">Reject</button><button type="button" class="btn ok" data-decide="approve">Approve as ${ROLES[role]}</button>${isOtpRole(role)&&otpApproval?'<span class="note">Out of station? Office HR can request an OTP on the CALIBER Trial Status bot.</span>':''}</div>`:''}`;
}

/* Office HR: forms waiting for the PM's or Directors' OTP, one OTP per batch. */
export type OtpGroup = {key: string; reviewer: 'pm'|'director'; rows: Trial[]; expires: string; busy: boolean; note?: string};
export function otpPanel(groups: OtpGroup[]) {
  if (!groups.length) return '';
  const who = (g: OtpGroup) => g.reviewer==='pm' ? 'PM' : 'Directors';
  return `<div class="otp-panel"><h3>OTP approvals – Directors</h3>
    <p class="note">Backup for when the Directors are out of station: they can also approve directly in HRMS or on Telegram. Press Request OTP: the OTP goes on the CALIBER Trial Status bot to all three Directors. Ask them for it, type it here and press Verify. Valid 15 minutes, single use.</p>
    ${table(['Approval of','Candidates','OTP'],groups.map(g=>`<tr data-otp="${esc(g.key)}"><td><b>${g.reviewer==='pm'?'PM':'Directors (final)'}</b></td>
      <td>${g.rows.map(r=>`${candidateLink(r)} <span class="mono muted small">${esc(r.formNo)}</span>`).join('<br>')}</td>
      <td>${g.expires
        ? `<span class="otp-entry"><input data-otp-code inputmode="numeric" maxlength="6" autocomplete="one-time-code" aria-label="OTP from ${who(g)} for ${esc(g.rows.map(r=>r.name).join(', '))}" placeholder="6-digit OTP">
           <button type="button" class="btn ok sm" data-otp-verify ${g.busy?'disabled':''}>Verify</button>
           <button type="button" class="btn sm" data-otp-request ${g.busy?'disabled':''}>Resend OTP</button>
           ${g.note?`<span class="small otp-warn" role="status">Not delivered yet – ${esc(g.note)} Valid till ${esc(indiaTime(new Date(g.expires)))}.</span>`:`<span class="muted small">Sent to ${who(g)} · valid till ${esc(indiaTime(new Date(g.expires)))}</span>`}</span>`
        : `<button type="button" class="btn pri sm" data-otp-request ${g.busy?'disabled':''}>${g.busy?'Sending…':'Request OTP from '+who(g)}</button>`}</td></tr>`).join(''))}</div>`;
}

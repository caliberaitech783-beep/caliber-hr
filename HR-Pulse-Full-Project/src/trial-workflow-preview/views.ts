import {date, dateTime, DOCS, equipment, indiaDay, ROLES, status, type Outcome, type Role, type Trial} from './records';

const escapes: Record<string,string> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,char=>escapes[char]);
export const resultPill = (row: Trial) => row.result === 'PASS' ? '<span class="pill p-pass">PASS</span>'
  : row.result === 'FAIL' ? '<span class="pill p-fail">FAIL</span>' : '<span class="pill p-wait">Trial pending</span>';
export const stagePill = (row: Trial) => `<span class="pill ${row.stage === 'done' && row.result === 'PASS' ? 'p-pass' : row.stage === 'done' || row.stage === 'rejected' ? 'p-fail' : 'p-stage'}">${esc(status(row))}</span>`;
const candidateLink = (row: Trial) => `<button type="button" class="link" data-open="${esc(row.id)}">${esc(row.name)}</button>`;
export function table(headers: string[], rows: string, width?: number) {
  return `<div class="scroll"><table class="t"${width ? ` style="min-width:${width}px"` : ''}><thead><tr>${headers.map(item=>`<th scope="col">${item}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
export function overviewTable(records: Trial[]) {
  return table(['Form no.','Candidate','Post','Vehicle','Exp','Referred by','Trial date','Result','Status'], records.map(row=>`
    <tr><td class="mono">${esc(row.formNo)}</td><td>${candidateLink(row)}<div class="muted small">${esc(row.mobile)}</div></td>
    <td>${esc(row.post)}</td><td>${esc(equipment(row))}</td><td>${esc(row.experience)}${row.experience?' yrs':''}</td>
    <td>${esc(row.referredBy)}</td><td>${esc(dateTime(row.trialDate))}</td><td>${resultPill(row)}</td><td>${stagePill(row)}</td></tr>`).join(''));
}
export function trainerTable(records: Trial[], draftFor: (row: Trial) => Outcome, allowed: boolean) {
  return table(['Candidate','Vehicle · Trial','Docs','Result','If PASS – recommended for','If FAIL – reason','Trial conducted by','Examiner remarks'],
    records.map(row=>{
      const d = draftFor(row);
      const id=esc(row.id), name=esc(row.name);
      const dl = row.docs.dl.seen === 'Yes' ? '✓' : '–';
      const a = row.docs.aadhaar.seen === 'Yes' ? '✓' : '–';
      const m = row.docs.medical.seen === 'Yes' ? '✓' : '–';
      const passDisabled=allowed && d.result==='PASS'?'':'disabled', failDisabled=allowed&&d.result==='FAIL'?'':'disabled';
      return `<tr data-id="${id}"><td>${candidateLink(row)}<div class="muted small mono">${esc(row.formNo)}${row.batch?' · '+esc(row.batch):''}</div></td>
        <td>${esc(equipment(row))}<div class="muted small">${esc(dateTime(row.trialDate))}${row.experience?' · '+esc(row.experience)+' yrs':''}</div></td>
        <td class="small mono" title="DL · Aadhaar · Medical">${dl} ${a} ${m}</td>
        <td><div class="pf">${(['PASS','FAIL'] as const).map(result=>`<button type="button" data-res="${result}" aria-pressed="${d.result===result}" aria-label="${name}: ${result}" class="${result.toLowerCase()} ${d.result===result?'on':''}" ${allowed?'':'disabled'}>${result}</button>`).join('')}</div></td>
        <td><div class="recommended-post" role="group" aria-label="${name}: Recommended post">
          ${(['Driver','Operator'] as const).map(option=>`<label class="chk"><input type="radio" name="recommended-${id}" data-f="post" value="${option}" aria-label="${name}: Recommend ${option}" ${d.post===option?'checked':''} ${passDisabled}> ${option}</label>`).join('')}
        </div>
        <input type="text" data-f="machine" aria-label="${name}: Machine" value="${esc(d.machine)}" placeholder="Machine" ${passDisabled}></td>
        <td><input type="text" data-f="reason" aria-label="${name}: Failure reason" value="${esc(d.reason)}" placeholder="Reason" ${failDisabled}></td>
        <td><input type="text" data-f="trainer" aria-label="${name}: Trial conducted by" value="${esc(d.trainer)}" placeholder="Your name if blank" ${allowed?'':'disabled'}></td>
        <td><input type="text" data-f="remarks" aria-label="${name}: Examiner remarks" value="${esc(d.remarks)}" ${allowed?'':'disabled'}></td></tr>`;
    }).join(''));
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
export function detailView(row: Trial, role: Role) {
  const item = (label: string,value: string) => `<div class="row"><div class="k">${label}</div><div class="v">${value||'<span class="muted">–</span>'}</div></div>`;
  const section = (data: [string,string][])=>data.map(([label,value])=>item(label,esc(value))).join('');
  const out=row.outcome;
  const photo=/^data:image\/jpeg;base64,[\w+/=]+$/.test(row.photo) ? `<img src="${esc(row.photo)}" alt="Photo of ${esc(row.name)}" style="width:120px;height:150px;object-fit:cover;border-radius:6px">` : '<span class="muted small">No photo</span>';
  const signs = Object.entries(ROLES).map(([key,label])=>{
    const entry=[...row.history].reverse().find(h=>h.role===key);
    const cls=!entry?'wait':entry.action==='Rejected'||key==='trainer'&&row.result==='FAIL'?'no':'ok';
    const action=entry ? key==='trainer'?row.result:entry.action : row.stage===key?'Pending':'–';
    return `<div class="sig ${cls}"><b>${label}</b><span class="st">${esc(action)}</span><span>${esc(entry?.by)}</span><span class="muted">${entry?esc(date(indiaDay(new Date(entry.at)))):''}</span></div>`;
  }).join('');
  return `<div class="panel-head"><div><h2>${esc(row.name)}</h2><span class="mono muted small">${esc(row.formNo)}${row.batch?' · Batch '+esc(row.batch):''} · ${esc(row.site)}</span></div>
      <div class="actions">${stagePill(row)}${row.result==='PASS'?'<button type="button" class="btn tg sm" id="mTelegram">Telegram message</button>':''}<button type="button" class="btn sm" id="mClose">Close</button></div></div>
    <div class="secbar">Part 1 – Candidate details <em>Site HR</em></div>
    <div class="grid-form"><div class="rows">${section([
      ["Father's name",row.father],['Date of birth',date(row.dob)],['Mobile no.',row.mobile],['Aadhaar no.',row.aadhaar],['Address',row.address],
      ['Post applied for',row.post],['Vehicle / equipment',equipment(row)],['DL no. &amp; class',row.dl],['DL valid up to',date(row.dlValid)],
      ['Experience',row.experience?row.experience+' years':''],['Previous employer',row.employer],['Trial date &amp; time',dateTime(row.trialDate)],['Referred by',row.referredBy],
    ])}</div><div class="photo">${photo}</div></div>
    <div class="secbar">Document check</div>
    ${table(['Document','Seen','Remarks'],DOCS.map(([key,label])=>`<tr><td>${label}</td><td>${esc(row.docs[key]?.seen)||'–'}</td><td>${esc(row.docs[key]?.remarks)}</td></tr>`).join(''),420)}
    <div class="secbar">Part 2 – Trial result <em>Driver Trainer</em></div>
    <div class="rows" style="border:1px solid var(--line-strong)">${item('Result',resultPill(row))}${section([
      ['If PASS – recommended for',out && row.result==='PASS'?[out.post,out.machine].filter(Boolean).join(' – '):''],['If FAIL – reason',out?.reason||''],
      ['Trial conducted by',out?.trainer||''],['Examiner remarks',out?.remarks||''],
    ])}</div>
    <div class="secbar">Approvals</div><div class="sigs">${signs}</div>
    ${row.history.filter(h=>h.note).map(h=>`<p class="note"><b>${esc(ROLES[h.role])} (${esc(h.by)}):</b> ${esc(h.note)}</p>`).join('')}
    ${row.stage===role && ['pm','rhr','director'].includes(role) ? `<div class="actions"><input id="mNote" aria-label="Decision note" placeholder="Note (required to reject)"><button type="button" class="btn no" data-decide="reject">Reject</button><button type="button" class="btn ok" data-decide="approve">Approve as ${ROLES[role]}</button></div>`:''}`;
}

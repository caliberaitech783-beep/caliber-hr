import template from './screen.html?raw';
import css from './screen.css?raw';
import type {AadhaarDetails} from '../geminiOcr';
import {candidateProblem, canApprove, date, DOCS, equipment, indiaDay, indiaTime, licenceDate, localDateTime,
  NEXT, nextNumber, post, resultMessage, ROLES, VEHICLES, type Candidate, type Outcome, type Role, type Trial} from './records';
import {approvalTable, detailView, esc, overviewTable, trainerForms} from './views';

type Tab = 'aadhaar' | 'hr' | 'trainer' | 'approve' | 'overview';
type Scope = {company: string; site: string; owner: string; name: string; department: string};
const tabs: Tab[] = ['aadhaar','hr','trainer','approve','overview'];
const roleTab: Record<Role,Tab> = {hr:'aadhaar',trainer:'trainer',pm:'approve',rhr:'approve',director:'approve'};
const blankRow = () => ({name:'',father:'',mobile:'',aadhaar:'',dl:'',dlValid:'',experience:'',referredBy:'',dlSeen:false,aSeen:false,medSeen:false});
const defaultOutcome = (row: Trial): Outcome => ({result:'',post:row.post,machine:equipment(row),reason:'',trainer:'',remarks:''});
const digits = (value: string) => value.replace(/\D/g,'');
const sorted = (rows: Trial[]) => [...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
const check = (seen = '', remarks = '') => ({seen,remarks});
const empty = (title: string, message: string, action = '') => `<div class="empty"><b>${esc(title)}</b><span>${esc(message)}</span>${action}</div>`;

export function mountTrialPreview(root: ShadowRoot, scope: Scope, aadhaar: {
  reset: () => void;
  setDisabled: (disabled: boolean) => void;
}) {
  const style = document.createElement('style');
  style.textContent = css;
  const frame = document.createElement('div');
  frame.innerHTML = template;
  root.replaceChildren(style,frame);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => frame.querySelector<T>(selector)!;
  const $$ = <T extends HTMLElement = HTMLElement>(selector: string) => Array.from(frame.querySelectorAll<T>(selector));
  const value = (selector: string) => $<HTMLInputElement>(selector).value.trim();
  const persistKey = 'hrPulse.localTrialWorkflow.v1:' + JSON.stringify([scope.owner,scope.company,scope.site]);
  const site = scope.site || 'JAYANT OB EAST';
  const defaults = () => post(scope.department);
  const drafts = new Map<string,Outcome>();
  const selected = new Set<string>();
  const effects = new AbortController();
  let tab: Tab = 'aadhaar', role: Role = 'hr', records: Trial[] = [], bulk = Array.from({length:3},blankRow);
  let photo = '', photoLoading = false, photoVersion = 0, photoUrl = '', detailId = '', toastTimer: ReturnType<typeof setTimeout>;
  let aadhaarScanPending = false;
  let modalFocus: HTMLElement | null = null;
  let telegramFocus: HTMLElement | null = null;

  function toast(message: string) {
    const alert = $('#toast');
    alert.textContent = message;
    alert.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{alert.hidden = true;},3000);
  }
  function read(): Trial[] {
    const data: unknown = JSON.parse(localStorage.getItem(persistKey) || '[]');
    if (!Array.isArray(data) || data.some(item=>!item || typeof item.formNo !== 'string' || !Array.isArray(item.history)
      || !Array.isArray(item.vehicles) || typeof item.createdAt !== 'string' || !item.docs)) {
      throw new Error('The saved preview records could not be read.');
    }
    return data;
  }
  function commit(update: (latest: Trial[])=>Trial[]) {
    try {
      const next = update(read());
      localStorage.setItem(persistKey,JSON.stringify(next));
      records = next;
      refresh();
      return true;
    } catch (error) {
      toast(error instanceof DOMException ? 'Could not save. Browser storage is unavailable or full.' : (error as Error).message);
      return false;
    }
  }
  function signer() {
    const name = value('#myName');
    if (!name) {toast('Enter your name at the top for the sign-off.'); $('#myName').focus();}
    return name;
  }
  function showTab(next: Tab) {
    tab = next;
    $$<HTMLButtonElement>('#tabs button').forEach(button=>{
      const active = button.dataset.tab===next;
      button.classList.toggle('on',active);
      button.setAttribute('aria-pressed',String(active));
    });
    tabs.forEach(item=>{$('#v-'+item).hidden = item !== next;});
    if (tab==='overview') renderOverview();
    if (tab==='trainer') renderTrainer();
    if (tab==='approve') renderApprovals();
  }
  function renderOverview() {
    const query = value('#search').toLowerCase();
    const rows = sorted(records).filter(row=>
      [row.name,row.formNo,row.mobile,row.referredBy,equipment(row)].join(' ').toLowerCase().includes(query));
    $('#ovTitle').textContent = `All candidates (${rows.length})`;
    $('#ovList').innerHTML = !records.length
      ? empty('No trial forms yet','Site HR starts here: add one candidate, or a whole trial batch at once.','<button type="button" class="btn pri" data-go="hr">Add candidates</button>')
      : !rows.length ? empty('No matches','Clear the search to show everyone.') : overviewTable(rows);
  }
  const waiting = () => sorted(records.filter(row=>row.stage==='trainer')).reverse();
  const approvals = () => canApprove(role) ? sorted(records.filter(row=>row.stage===role)) : [];
  const draftFor = (row: Trial) => {
    let draft = drafts.get(row.id);
    if (!draft) {draft = defaultOutcome(row); drafts.set(row.id,draft);}
    return draft;
  };
  function renderTrainer() {
    const rows = waiting();
    $('#trCount').textContent = rows.length ? `· ${rows.length} waiting` : '';
    $('#trList').innerHTML = trainerForms(rows,draftFor,role==='trainer');
    $('#trRoleWarn').hidden = role==='trainer';
    for (const selector of ['#trAllPass','#trSubmit']) $<HTMLButtonElement>(selector).disabled = role!=='trainer'||!rows.length;
  }
  function syncSelection(rows = approvals()) {
    const all = frame.querySelector<HTMLInputElement>('#apAll');
    if (all) {
      const count = rows.filter(row=>selected.has(row.id)).length;
      all.checked = count===rows.length;
      all.indeterminate = count>0&&count<rows.length;
    }
    for (const selector of ['#apApprove','#apReject']) $<HTMLButtonElement>(selector).disabled = !selected.size;
  }
  function renderApprovals() {
    const allowed = canApprove(role), rows = approvals();
    $('#apTitle').textContent = allowed ? `${ROLES[role]} approval queue` : 'Approvals';
    $('#apRoleWarn').hidden = allowed;
    $('#apRoleWarn').textContent = 'Approvals go PM → Regional HR → Directors. Switch “Working as” to one of them to approve.';
    $<HTMLInputElement>('#apNote').disabled = !allowed;
    for (const id of selected) if (!rows.some(row=>row.id===id)) selected.delete(id);
    $('#apList').innerHTML = !allowed ? '' : !rows.length
      ? empty(`Nothing waiting for ${ROLES[role]}`,'Forms arrive here once the previous step signs off.') : approvalTable(rows,selected);
    syncSelection(rows);
  }
  function refresh() {
    for (const [selector,count] of [['#bTrainer',waiting().length],['#bApprove',approvals().length]] as const) {
      $(selector).textContent = String(count);
      $(selector).hidden = !count;
    }
    $('#sFormNo').textContent = 'Form No. '+nextNumber(records);
    $('#hrRoleWarn').hidden = role==='hr';
    updateSingleActions();
    $<HTMLButtonElement>('#bSubmit').disabled = role!=='hr';
    showTab(tab);
  }
  function createCandidates(candidates: Candidate[], batch: boolean) {
    if (role!=='hr' || photoLoading || (!batch && aadhaarScanPending)) return false;
    const name = signer();
    if (!name) return false;
    if (!candidates.length) {toast('Add at least one candidate.');return false;}
    let created: Trial[] = [];
    if (!commit(latest=>{
      const seen = new Set<string>(), at = new Date().toISOString(), batchId = batch ? 'B-'+crypto.randomUUID().slice(0,6).toUpperCase() : '';
      created = candidates.map((candidate,i)=>{
        const problem = candidateProblem(candidate,latest);
        if (problem) throw new Error((candidate.name ? candidate.name+': ' : '')+problem);
        if (candidate.aadhaar && seen.has(candidate.aadhaar)) throw new Error(candidate.name+': Aadhaar is repeated in this batch.');
        seen.add(candidate.aadhaar);
        return {...candidate,id:crypto.randomUUID(),formNo:nextNumber(latest,i),batch:batchId,site,stage:'trainer',result:'',createdAt:at,
          history:[{role:'hr',by:name,at,action:batch?`Submitted Part 1 (batch ${batchId})`:'Submitted Part 1'}]};
      });
      return [...latest,...created];
    })) return false;
    toast(batch ? `Batch ${created[0].batch}: ${created.length} candidates sent to Driver Trainer.` : `${created[0].formNo} sent to Driver Trainer.`);
    return true;
  }
  function resetSingle() {
    ++photoVersion;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = '';
    photo = '';
    photoLoading = false;
    aadhaarScanPending = false;
    aadhaar.reset();
    $<HTMLFormElement>('#single').reset();
    $('#photoBox').innerHTML = 'Upload photo<br><span class="muted">camera or gallery</span>';
    $('#f_vother').hidden = true;
    $<HTMLInputElement>('#f_trial').value = localDateTime();
    $<HTMLInputElement>(`input[name="f_post"][value="${defaults()}"]`).checked = true;
    updateSingleActions();
  }
  function updateSingleActions() {
    const canEdit = role === 'hr';
    $<HTMLButtonElement>('#sSubmit').disabled = !canEdit || photoLoading || aadhaarScanPending;
    $<HTMLButtonElement>('#aadhaarContinue').disabled = aadhaarScanPending;
  }
  function setAadhaarBusy(busy: boolean) {
    aadhaarScanPending = busy;
    updateSingleActions();
  }
  function fillAadhaarDetails(details: AadhaarDetails) {
    if (!aadhaarScanPending || effects.signal.aborted) return '';
    const enteredNumber = digits(value('#f_aadhaar'));
    if (details.uid && enteredNumber.length === 12 && enteredNumber !== details.uid) {
      return 'This card has a different Aadhaar number. Check the card and retry.';
    }
    const fields = [
      ['#f_name', details.name], ['#f_father', details.relationName], ['#f_dob', details.dob],
      ['#f_aadhaar', details.uid], ['#f_address', details.address],
    ] as const;
    let filled = 0;
    for (const [selector, detail] of fields) {
      const control = $<HTMLInputElement>(selector);
      if (!detail || control.value.trim()) continue;
      control.value = detail;
      if (control.value) filled++;
    }
    return filled
      ? 'Aadhaar details filled. Verify them before submitting.'
      : 'The scan added no new details. Review the form or enter the missing details manually.';
  }
  $('#f_veh').innerHTML = VEHICLES.map(item=>`<label class="chk"><input type="checkbox" name="f_vehicle" value="${esc(item)}"> ${esc(item)}</label>`).join('')
    + '<input id="f_vother" type="text" placeholder="Other machine" aria-label="Other machine" style="max-width:180px" hidden>';
  $('#f_docs').innerHTML = DOCS.map(([key,label])=>`<tr><td>${label}</td><td><select id="d_${key}" aria-label="${label} seen"><option value="">Select</option><option>Yes</option><option>No</option></select></td><td><input type="text" id="dr_${key}" aria-label="${label} remarks"></td></tr>`).join('');
  $('#b_veh').innerHTML = VEHICLES.map(item=>`<option>${esc(item)}</option>`).join('');
  resetSingle();
  $<HTMLInputElement>('#b_trial').value = localDateTime();
  $<HTMLSelectElement>('#b_post').value = defaults();
  $('#f_veh').addEventListener('change',event=>{
    const input=event.target as HTMLInputElement;
    if (input.value==='Other') $('#f_vother').hidden = !input.checked;
  });
  $<HTMLInputElement>('#f_photo').onchange = event=>{
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024) {
      toast('Choose a JPEG, PNG or WebP photo up to 5 MB.');return;
    }
    const version = ++photoVersion;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    const url=URL.createObjectURL(file), img=new Image();
    photoUrl=url;
    photoLoading=true;
    updateSingleActions();
    const finish = () => {
      URL.revokeObjectURL(url);
      if (version!==photoVersion) return false;
      photoUrl='';
      photoLoading=false;
      updateSingleActions();
      return true;
    };
    img.onload=()=>{
      if (!finish()) return;
      try {
        const canvas=document.createElement('canvas'), scale=Math.min(1,240/Math.max(img.width,img.height));
        canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
        const context=canvas.getContext('2d');
        if (!context) throw new Error();
        context.drawImage(img,0,0,canvas.width,canvas.height);
        photo=canvas.toDataURL('image/jpeg',.8);
        const preview=document.createElement('img');
        preview.src=photo;preview.alt='Candidate photo';
        $('#photoBox').replaceChildren(preview);
      } catch {toast('Could not open this photo.');}
    };
    img.onerror=()=>{if(finish())toast('Could not open this photo.');};
    img.src=url;
  };
  $('#sReset').onclick=resetSingle;
  $<HTMLFormElement>('#single').onsubmit=event=>{
    event.preventDefault();
    const vehicles=$$<HTMLInputElement>('input[name="f_vehicle"]:checked').map(input=>input.value);
    if (createCandidates([{
      name:value('#f_name'),father:value('#f_father'),dob:value('#f_dob'),mobile:value('#f_mobile'),aadhaar:digits(value('#f_aadhaar')),
      address:value('#f_address'),photo,post:post(value('input[name="f_post"]:checked')),vehicles,
      otherVehicle:vehicles.includes('Other')?value('#f_vother'):'',dl:value('#f_dl'),dlValid:value('#f_dlvalid'),
      experience:value('#f_exp'),employer:value('#f_prev'),trialDate:value('#f_trial'),referredBy:value('#f_ref'),
      docs:Object.fromEntries(DOCS.map(([key])=>[key,check(value('#d_'+key),value('#dr_'+key))])) as Candidate['docs'],
    }],false)) resetSingle();
  };

  const columns = [
    ['name','Name','text','Full name'],['father',"Father's name",'text',''],['mobile','Mobile','tel','10 digits'],
    ['aadhaar','Aadhaar','text',''],['dl','DL no. & class','text','DL – class'],['dlValid','DL valid','date',''],
    ['experience','Experience','text','yrs'],['referredBy','Referred by','text',''],
  ] as const;
  const confirmations = [['dlSeen','DL seen'],['aSeen','Aadhaar seen'],['medSeen','Medical seen']] as const;
  function renderBulk() {
    $('#bTable tbody').innerHTML = bulk.map((row,i)=>`<tr><td class="mono">${i+1}</td>${columns.map(([key,label,type,placeholder])=>
      `<td><input type="${type}" data-row="${i}" data-field="${key}" value="${esc(row[key])}" aria-label="Row ${i+1}: ${esc(label)}" placeholder="${placeholder}"></td>`).join('')}
      ${confirmations.map(([key,label])=>`<td style="text-align:center"><input type="checkbox" data-row="${i}" data-field="${key}" aria-label="Row ${i+1}: ${label}" ${row[key]?'checked':''}></td>`).join('')}
      <td><button type="button" class="btn sm" data-delete="${i}" aria-label="Remove row ${i+1}">✕</button></td></tr>`).join('');
  }
  $('#bTable').oninput = event=>{
    const input=event.target as HTMLInputElement;
    const row=bulk[Number(input.dataset.row)];
    if (!row) return;
    const field=columns.find(([key])=>key===input.dataset.field);
    const flag=confirmations.find(([key])=>key===input.dataset.field);
    if (field) row[field[0]]=input.value;
    if (flag) row[flag[0]]=input.checked;
  };
  $('#bTable').onclick=event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-delete]');
    if (button) {bulk.splice(Number(button.dataset.delete),1);renderBulk();}
  };
  $('#bAdd').onclick=()=>{bulk.push(blankRow());renderBulk();};
  $('#b_veh').onchange=()=>{$('#b_other_label').hidden=value('#b_veh')!=='Other';};
  $('#b_pasteBtn').onclick=()=>{
    const lines=value('#b_paste').split(/\r?\n/).filter(line=>line.trim());
    if (!lines.length) return toast('Paste some rows first.');
    const parsed=lines.map(line=>{
      const cells=(line.includes('\t')?line.split('\t'):line.split(',')).map(cell=>cell.trim());
      const [name='',father='',mobile='',aadhaar='',dl='',rawDate='',experience='',referredBy='']=cells;
      return {bad:cells.length>8||!name||Boolean(rawDate&&!licenceDate(rawDate)),
        row:{...blankRow(),name,father,mobile:digits(mobile),aadhaar:digits(aadhaar),dl,dlValid:licenceDate(rawDate),experience,referredBy}};
    });
    const invalid=parsed.findIndex(item=>item.bad);
    if (invalid>=0) return toast(`Check the name, columns and DL date on pasted row ${invalid+1}.`);
    bulk=[...bulk.filter(row=>columns.some(([key])=>row[key].trim())),...parsed.map(item=>item.row)];
    $<HTMLTextAreaElement>('#b_paste').value='';
    renderBulk();
    toast(`${parsed.length} rows added. Confirm the documents you checked.`);
  };
  $('#bSubmit').onclick=()=>{
    const vehicle=value('#b_veh');
    const candidates=bulk.filter(row=>columns.some(([key])=>row[key].trim())).map((row):Candidate=>({
      name:row.name.trim(),father:row.father.trim(),mobile:row.mobile.trim(),aadhaar:digits(row.aadhaar),dl:row.dl.trim(),
      dlValid:row.dlValid,experience:row.experience.trim(),referredBy:row.referredBy.trim()||value('#b_ref'),
      dob:'',address:'',photo:'',employer:'',post:post(value('#b_post')),vehicles:[vehicle],
      otherVehicle:vehicle==='Other'?value('#b_other'):'',trialDate:value('#b_trial'),
      docs:{dl:check(row.dlSeen?'Yes':'No'),hemm:check(),aadhaar:check(row.aSeen?'Yes':'No'),medical:check(row.medSeen?'Yes':'No'),exp:check()},
    }));
    if(createCandidates(candidates,true)){bulk=Array.from({length:3},blankRow);renderBulk();}
  };

  function submitResults() {
    if (role!=='trainer') return;
    const name = signer();
    if (!name) return;
    const rows=waiting().filter(row=>drafts.get(row.id)?.result);
    if (!rows.length) return toast('Set PASS or FAIL for at least one candidate.');
    const invalid=rows.find(row=>drafts.get(row.id)?.result==='FAIL'&&!drafts.get(row.id)?.reason.trim());
    if (invalid) return toast(`Enter the fail reason for ${invalid.name}.`);
    const ids=new Set(rows.map(row=>row.id)), at=new Date().toISOString(), changed: Trial[]=[];
    if (!commit(latest=>{
      if (latest.filter(row=>ids.has(row.id)&&row.stage==='trainer').length!==ids.size) throw new Error('The trainer queue changed. Reopen it and try again.');
      return latest.map(row=>{
        if(!ids.has(row.id)) return row;
        const d=drafts.get(row.id)!;
        const next: Trial={...row,stage:'pm',result:d.result,outcome:{
          ...d,machine:d.result==='PASS'?d.machine.trim():'',reason:d.result==='FAIL'?d.reason.trim():'',
          remarks:d.remarks.trim(),trainer:d.trainer.trim()||name,at,
        },history:[...row.history,{role:'trainer',action:'Trial result: '+d.result,by:name,at}]};
        changed.push(next);
        return next;
      });
    })) return;
    for(const id of ids) drafts.delete(id);
    const passed=changed.filter(row=>row.result==='PASS');
    toast(`${changed.length} results sent to PM – ${passed.length} pass, ${changed.length-passed.length} fail.`);
    if(passed.length) showTelegram(passed.map(resultMessage),'Trial PASS – sent to PM for approval');
  }
  $('#trList').onclick=event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-res]');
    if (!button || role!=='trainer') return;
    const row=waiting().find(item=>item.id===button.closest<HTMLElement>('[data-id]')?.dataset.id);
    if (!row) return;
    const result=button.dataset.res;
    if (result!=='PASS'&&result!=='FAIL') return;
    const draft=draftFor(row);
    draft.result=draft.result===result?'':result;
    renderTrainer();
    $$<HTMLButtonElement>('#trList [data-res]').find(item=>
      item.dataset.res===result&&item.closest<HTMLElement>('[data-id]')?.dataset.id===row.id)?.focus();
  };
  $('#trList').oninput=event=>{
    if (role!=='trainer') return;
    const input=event.target as HTMLInputElement;
    const row=waiting().find(item=>item.id===input.closest<HTMLElement>('[data-id]')?.dataset.id);
    if (!row) return;
    const draft=draftFor(row), field=input.dataset.f;
    if (field==='post') draft.post=post(input.value);
    else if(field==='machine'||field==='reason'||field==='trainer'||field==='remarks') draft[field]=input.value;
  };
  $('#trAllPass').onclick=()=>{
    if(role!=='trainer') return;
    for(const row of waiting()){const draft=draftFor(row);if(!draft.result)draft.result='PASS';}
    renderTrainer();
  };
  $('#trSubmit').onclick=submitResults;

  function decide(approved: boolean, ids: string[], note: string) {
    const reviewer=role;
    if (!canApprove(reviewer)) return false;
    const name=signer();
    if (!name) return false;
    if (!ids.length) {toast('Select at least one form.');return false;}
    if (!approved&&!note) {toast('Write a note to explain the rejection.');return false;}
    const at=new Date().toISOString(), changed: Trial[]=[];
    if(!commit(latest=>{
      if (latest.filter(row=>ids.includes(row.id)&&row.stage===reviewer).length!==ids.length) throw new Error('The approval queue changed. Select the forms again.');
      return latest.map(row=>{
        if (!ids.includes(row.id)) return row;
        const next: Trial={...row,stage:approved?NEXT[reviewer]:'rejected',
          history:[...row.history,{role:reviewer,action:approved?'Approved':'Rejected',by:name,at,note}]};
        changed.push(next);
        return next;
      });
    })) return false;
    ids.forEach(id=>selected.delete(id));
    $<HTMLInputElement>('#apNote').value='';
    toast(`${changed.length} form(s) ${approved?'approved':'rejected'} by ${ROLES[reviewer]}.`);
    renderApprovals();
    if(approved&&reviewer==='director'){
      const passed=changed.filter(row=>row.result==='PASS');
      if (passed.length) showTelegram(passed.map(resultMessage),'Cleared to join – final approval');
    }
    return true;
  }
  $('#apList').onchange=event=>{
    const input=event.target as HTMLInputElement;
    if (input.id==='apAll'){
      selected.clear();
      if(input.checked) approvals().forEach(row=>selected.add(row.id));
      $$<HTMLInputElement>('#apList [data-sel]').forEach(box=>{box.checked=input.checked;});
    } else if(input.dataset.sel){
      if(input.checked) selected.add(input.dataset.sel);else selected.delete(input.dataset.sel);
    }
    syncSelection();
  };
  for (const [selector,approved] of [['#apApprove',true],['#apReject',false]] as const) {
    $(selector).onclick=()=>{
      if (!decide(approved,[...selected],value('#apNote'))&&!approved) $('#apNote').focus();
    };
  }
  function openDetails(id: string, source: HTMLElement) {
    const row=records.find(item=>item.id===id);
    if (!row) return;
    detailId=id;
    modalFocus=source;
    $('#modalBox').innerHTML=detailView(row,role);
    $('#modal').hidden=false;
    $('#mClose').focus();
  }
  function closeDetails(restore=true) {
    $('#modal').hidden=true;
    detailId='';
    if(restore && modalFocus?.isConnected) modalFocus.focus();
    modalFocus=null;
  }
  $('#modal').onclick=event=>{
    const target=event.target as HTMLElement;
    if(target.id==='modal'||target.id==='mClose') return closeDetails();
    if(target.id==='mTelegram'){
      const row=records.find(item=>item.id===detailId);
      if (row?.result==='PASS') showTelegram([resultMessage(row)],row.stage==='done'?'Cleared to join':'Trial PASS');
    }
    if (target.dataset.decide){
      const approved=target.dataset.decide==='approve';
      if(decide(approved,[detailId],value('#mNote'))) closeDetails($('#tgpop').hidden===true);
      else if(!approved) $('#mNote').focus();
    }
  };

  function showTelegram(messages: string[], summary: string) {
    const text=messages.join('\n\n———\n\n'), time=indiaTime();
    telegramFocus=root.activeElement instanceof HTMLElement ? root.activeElement : null;
    $('#tgpop').innerHTML=`<div class="tghead"><div class="tgav">CT</div><div><div class="nm">${esc(scope.company||'CMLL')} Trial Bot</div><div class="sub">${esc(summary)} · ${messages.length} message${messages.length===1?'':'s'} · Preview only</div></div><button type="button" aria-label="Close Telegram preview" id="tgClose">×</button></div>
      <div class="tgbody">${messages.map(message=>`<div class="bubble">${esc(message)}<span class="tm">${time}</span></div>`).join('')}<textarea id="tgText" aria-label="Telegram message text" readonly hidden>${esc(text)}</textarea></div>
      <div class="tgfoot"><button type="button" class="btn tg" id="tgCopy">Copy for Telegram</button><button type="button" class="btn" id="tgClose2">Close</button></div>`;
    $('#tgpop').hidden=false;
    $('#tgClose').focus();
    $('#tgClose').onclick=$('#tgClose2').onclick=closeTelegram;
    $('#tgCopy').onclick=async()=>{
      try{await navigator.clipboard.writeText(text);toast('Copied for Telegram.');}
      catch{
        const field=$<HTMLTextAreaElement>('#tgText');
        field.hidden=false;
        field.focus();
        field.select();
        toast('Copy the selected text.');
      }
    };
  }
  function closeTelegram() {
    $('#tgpop').hidden=true;
    if(telegramFocus?.isConnected&&!telegramFocus.closest('[hidden]')) telegramFocus.focus();
    else if (!$('#modal').hidden) $('#mClose').focus();
    else $<HTMLButtonElement>('#tabs .on').focus();
    telegramFocus=null;
  }
  $('#tgPassList').onclick=()=>{
    const today=indiaDay();
    const rows=records.filter(row=>row.result==='PASS'&&row.outcome&&indiaDay(new Date(row.outcome.at))===today);
    if (!rows.length) return toast('No PASS results recorded today.');
    const lines=rows.map((row,i)=>`${i+1}. ${row.name} – ${row.outcome?.post||row.post}, ${row.outcome?.machine||equipment(row)}, ${row.experience||'–'} yrs, Ref: ${row.referredBy||'–'}`);
    showTelegram([[`📋 TRIAL PASS LIST – ${date(today)}`,'',...lines,'',`Total passed: ${rows.length}`].join('\n')],"Today's pass list");
  };

  frame.addEventListener('keydown',event=>{
    const activeDialog=!$('#tgpop').hidden?$('#tgpop'):!$('#modal').hidden?$('#modal'):null;
    if (!activeDialog) return;
    if (event.key==='Escape'){
      event.stopPropagation();
      if (activeDialog.id==='tgpop')closeTelegram();else closeDetails();
    }
    if (event.key==='Tab'){
      const focusables=[...activeDialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not([hidden])')];
      const first=focusables[0],last=focusables.at(-1);
      if (event.shiftKey&&root.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&root.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  frame.addEventListener('click',event=>{
    const target=(event.target as Element).closest<HTMLElement>('[data-open],[data-go]');
    if (!target) return;
    if (target.dataset.open) openDetails(target.dataset.open,target);
    else if(target.dataset.go==='hr')showTab('hr');
  });
  $('#tabs').onclick=event=>{
    const target=(event.target as Element).closest<HTMLButtonElement>('[data-tab]');
    const next=tabs.find(item=>item===target?.dataset.tab);
    if (next) showTab(next);
  };
  $('#search').oninput=renderOverview;
  function setCandidateMode(single: boolean) {
    $('#single').hidden=!single;$('#bulk').hidden=single;
    $$<HTMLButtonElement>('#hrMode button').forEach(item=>{
      const active = (item.dataset.m === 'single') === single;
      item.classList.toggle('on', active);
      item.setAttribute('aria-pressed', String(active));
    });
  }
  $('#hrMode').onclick=event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-m]');
    if(button) setCandidateMode(button.dataset.m === 'single');
  };
  $('#aadhaarContinue').onclick=()=>{
    setCandidateMode(true);
    showTab('hr');
    $('#part1Title').focus();
  };
  $<HTMLSelectElement>('#role').onchange=event=>{
    const next=(event.target as HTMLSelectElement).value;
    if(!Object.hasOwn(ROLES,next)) return;
    role=next as Role;
    aadhaar.setDisabled(role!=='hr');
    tab=roleTab[role];
    selected.clear();
    $<HTMLInputElement>('#apNote').value='';
    refresh();
  };
  window.addEventListener('storage',event=>{
    if (event.key!==persistKey) return;
    try{records=read();refresh();}
    catch {toast('Could not read the saved preview records.');}
  },{signal:effects.signal});
  $('#company').textContent=scope.company||'CMLL';
  $('#sitePill').textContent=site.toUpperCase();
  $<HTMLInputElement>('#myName').value=scope.name;
  $('#storeNote').textContent='Saved in this browser only.';
  try{records=read();}
  catch {toast('Could not read the saved preview records.');}
  setCandidateMode(true);
  renderBulk();
  refresh();
  function dispose() {
    effects.abort();
    clearTimeout(toastTimer);
    ++photoVersion;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    root.replaceChildren();
  }
  return {dispose, fillAadhaarDetails, setAadhaarBusy};
}

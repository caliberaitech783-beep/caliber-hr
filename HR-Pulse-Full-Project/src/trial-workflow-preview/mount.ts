import template from './screen.html?raw';
import css from './screen.css?raw';
import {savedSession} from '../api';
import {readGeminiAadhaar, type AadhaarDetails,type DrivingLicenceDetails} from '../geminiOcr';
import {applyBulkAadhaar, blankBulkRow, bulkColumns, bulkConfirmations, downloadBulkWorkbook, hasBulkCandidate, readBulkWorkbook} from './bulkCandidates';
import {candidateProblem, canApprove, date, DOCS, equipment, indiaDay, indiaTime, isClearedForJoining, licenceDate, localDateTime,
  NEXT, nextNumber, normalizeTrialApproval, post, resultMessage, ROLES, STAGES, VEHICLES, type Candidate, type DrivingLicenceClass, type Outcome, type Role, type Trial} from './records';
import {approvalTable, detailView, esc, overviewTable, trainerForms} from './views';
import {getTrialResultFile, removeTrialResultFiles, saveTrialResultFiles} from './trialResultFiles';
import {deliveryStatus, fetchReviewQueue, fetchTrialTrainer, sendApproval, sendPart1, sendResults, type TrialScope} from './telegramSend';
import {siteDisplayName} from '../siteNames';
import {findPreviousTrial} from './previousTrial';
import type {TrialMatch} from '../TrialAadhaarHistory';
import {optimizeDrivingVideo} from './optimizeDrivingVideo';
import type {TrialChecklistDocuments} from '../trialHandoff';

type Tab = 'aadhaar' | 'hr' | 'trainer' | 'approve' | 'overview';
type Scope = TrialScope & {owner: string; legacyOwner?: string; name: string;designation?:string};
export type PrepareJoining = (rows: Trial[]) => Promise<(() => void) | void>;
const tabs: Tab[] = ['aadhaar','hr','trainer','approve','overview'];
const roleTab: Record<Role,Tab> = {hr:'aadhaar',trainer:'trainer',pm:'approve',ohr:'approve',rhr:'approve',director:'approve'};
/* Tabs each role may open: Site HR → Aadhaar + Part 1; Driver Trainer → Part 2; approvers → Approvals; everyone → All candidates. */
const roleTabs: Record<Role,Tab[]> = {hr:['aadhaar','hr','overview'],trainer:['trainer'],pm:['approve','overview'],ohr:['approve','overview'],rhr:['approve','overview'],director:['approve','overview']};
const defaultOutcome = (row: Trial): Outcome => ({result:'',post:row.post,machine:equipment(row),reason:'',trainer:'',remarks:''});
const digits = (value: string) => value.replace(/\D/g,'');
const sorted = (rows: Trial[]) => [...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
const check = (seen = '', remarks = '') => ({seen,remarks});
const empty = (title: string, message: string, action = '') => `<div class="empty"><b>${esc(title)}</b><span>${esc(message)}</span>${action}</div>`;
export const sameDocumentBirthDate=(aadhaarDob:string,licenceDob:string)=>Boolean(aadhaarDob&&aadhaarDob===licenceDob);

export function mountTrialPreview(root: ShadowRoot, scope: Scope, aadhaar: {
  reset: () => void;
  setDisabled: (disabled: boolean) => void;
  documents?: () => TrialChecklistDocuments;
}, onCleared?: PrepareJoining) {
  const style = document.createElement('style');
  style.textContent = css;
  const frame = document.createElement('div');
  frame.innerHTML = template;
  root.replaceChildren(style,frame);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => frame.querySelector<T>(selector)!;
  const $$ = <T extends HTMLElement = HTMLElement>(selector: string) => Array.from(frame.querySelectorAll<T>(selector));
  const value = (selector: string) => $<HTMLInputElement>(selector).value.trim();
  const storagePrefix='hrPulse.localTrialWorkflow.v1:';
  const keyFor = (owner: string) => storagePrefix + JSON.stringify([owner,scope.company,scope.site]);
  const persistKey = keyFor(scope.owner);
  const legacyKey = scope.legacyOwner && scope.legacyOwner!==scope.owner ? keyFor(scope.legacyOwner) : undefined;
  const site = scope.site;
  const defaults = () => post(scope.department);
  const drafts = new Map<string,Outcome>();
  const draftFiles = new Map<string,File>();
  const draftVideos = new Map<string,File>();
  const optimizingVideos = new Set<string>();
  const selected = new Set<string>();
  const effects = new AbortController();
  let tab: Tab = 'aadhaar', role: Role = 'hr', stageFilter = '', records: Trial[] = [], bulk = Array.from({length:3},blankBulkRow);
  let trainerName = savedSession()?.grant ? '' : scope.name;
  let photo = '', photoLoading = false, photoVersion = 0, photoUrl = '', detailId = '', toastTimer: ReturnType<typeof setTimeout>;
  let aadhaarScanPending = false,aadhaarBirthDate='',drivingLicenceBusy=false,drivingLicenceReady=false;
  let aadhaarHistoryPending=false, aadhaarLookupVersion=0, checkedAadhaar='';
  let aadhaarHistoryFocus:HTMLElement|null=null;
  let bulkBusy = false;
  let roleLocked = false;
  let submittingResults = false;
  let submittingApproval = false;
  let modalFocus: HTMLElement | null = null;
  let telegramFocus: HTMLElement | null = null;
  let afterTelegram: (()=>void) | undefined;
  let openingJoining = false;

  function toast(message: string) {
    const alert = $('#toast');
    alert.textContent = message;
    alert.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{alert.hidden = true;},3000);
  }
  function readKey(key: string): Trial[] {
    const data: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(data) || data.some(item=>!item || typeof item.formNo !== 'string' || !Array.isArray(item.history)
      || !Array.isArray(item.vehicles) || typeof item.createdAt !== 'string' || !item.docs)) {
      throw new Error('The saved preview records could not be read.');
    }
    return (data as Trial[]).map(normalizeTrialApproval);
  }
  function read(): Trial[] {
    const current = readKey(persistKey);
    if (!legacyKey) return current;
    // Read the old sign-in key as well as the current HR actor key without rewriting the original records.
    const merged = new Map(current.map(row=>[row.id,row]));
    for (const row of readKey(legacyKey)) {
      const saved = merged.get(row.id);
      if (!saved || row.history.length > saved.history.length) merged.set(row.id,row);
    }
    return [...merged.values()];
  }
  function previousTrialRows() {
    const rows=new Map(records.map(row=>[row.id,row]));
    const profile=savedSession()?.profile;
    const access=profile?.permissions;
    if(!access||access.site||/site|location/i.test(String(access.adminLevel||'')))return [...rows.values()];
    const owners=new Set([scope.owner,scope.legacyOwner].filter(owner=>owner&&owner!=='local'));
    for(let index=0;index<localStorage.length;index++){
      const key=localStorage.key(index);
      if(!key?.startsWith(storagePrefix)||key===persistKey||key===legacyKey)continue;
      try {
        const [owner]=JSON.parse(key.slice(storagePrefix.length));
        if(!owners.has(owner))continue;
        for(const row of readKey(key)){
          const existing=rows.get(row.id);
          if(!existing||row.history.length>existing.history.length)rows.set(row.id,row);
        }
      } catch {/* Other site records can still be checked by the API. */}
    }
    return [...rows.values()];
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
    if(!roleTabs[role].includes(next))next=roleTab[role];
    tab = next;
    $('#pipe').hidden = role==='trainer'||next==='aadhaar';
    $('#tabs').hidden=role==='trainer';
    $('.preview-label').hidden=role==='trainer';
    $$<HTMLButtonElement>('#tabs button').forEach(button=>{
      const active = button.dataset.tab===next;
      button.classList.toggle('on',active);
      button.setAttribute('aria-pressed',String(active));
      button.hidden = !roleTabs[role].includes(button.dataset.tab as Tab);
    });
    tabs.forEach(item=>{$('#v-'+item).hidden = item !== next;});
    if (tab==='overview') renderOverview();
    if (tab==='trainer') renderTrainer();
    if (tab==='approve') renderApprovals();
  }
  function renderOverview() {
    const query = value('#search').toLowerCase();
    const rows = sorted(records).filter(row=>(!stageFilter||row.stage===stageFilter)
      && [row.name,row.formNo,row.mobile,row.referredBy,equipment(row)].join(' ').toLowerCase().includes(query));
    $('#ovTitle').textContent = (STAGES.find(([stage])=>stage===stageFilter)?.[2] || 'All candidates') + ` (${rows.length})`;
    $('#ovList').innerHTML = !records.length
      ? empty('No trial forms yet','Site HR starts here: add one candidate, or a whole trial batch at once.','<button type="button" class="btn pri" data-go="hr">Add candidates</button>')
      : !rows.length ? empty('No matches','Clear the search or select the stage again to show everyone.') : overviewTable(rows,Boolean(onCleared));
  }
  const waiting = () => sorted(records.filter(row=>row.stage==='trainer')).reverse();
  const approvals = () => canApprove(role) ? sorted(records.filter(row=>row.stage===role)) : [];
  const draftFor = (row: Trial) => {
    let draft = drafts.get(row.id);
    if (!draft) {draft = {...defaultOutcome(row),trainer:trainerName}; drafts.set(row.id,draft);}
    return draft;
  };
  function renderTrainer() {
    const rows = waiting();
    const canEdit = role==='trainer' && !submittingResults;
    for(const selector of ['#trResultPicker','#trVideoPicker']){
      const picker=$<HTMLInputElement>(selector);
      picker.disabled=!canEdit||!rows.length;
      if(!rows.some(row=>row.id===picker.dataset.trialId))picker.dataset.trialId=rows[0]?.id||'';
    }
    $('#trCount').textContent = rows.length ? `· ${rows.length} waiting` : '';
    $('#trList').innerHTML = trainerForms(rows,draftFor,canEdit,draftFiles,draftVideos,optimizingVideos);
    $('#trRoleWarn').hidden = role==='trainer';
    $('#trSubmit').textContent = submittingResults ? 'Saving results…' : 'Submit results → send to PM';
    $<HTMLButtonElement>('#trSubmit').disabled = !canEdit||!rows.length;
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
    $('#apRoleWarn').textContent = 'Approvals go PM → Office HR → Regional HR → Directors. Switch “Working as” to one of them to approve.';
    $<HTMLInputElement>('#apNote').disabled = !allowed;
    for (const id of selected) if (!rows.some(row=>row.id===id)) selected.delete(id);
    $('#apList').innerHTML = !allowed ? '' : !rows.length
      ? empty(`Nothing waiting for ${ROLES[role]}`,'Forms arrive here once the previous step signs off.') : approvalTable(rows,selected);
    syncSelection(rows);
  }
  function refresh() {
    $('#pipe').innerHTML = STAGES.filter(([stage])=>stage==='trainer'||stage==='done'||stage==='rejected').map(([stage,label])=>{
      const active=stageFilter===stage, number=stage==='trainer'?'Step 1':stage==='done'?'✓':'✕';
      return `<button type="button" data-stage="${stage}" class="${active?'on':''}" aria-pressed="${active}"><span class="step">${number}</span><span class="n">${records.filter(row=>row.stage===stage).length}</span><span class="l">${label}</span></button>`;
    }).join('');
    for (const [selector,count] of [['#bTrainer',waiting().length],['#bApprove',approvals().length]] as const) {
      $(selector).textContent = String(count);
      $(selector).hidden = !count;
    }
    $('#sFormNo').textContent = 'Form No. '+nextNumber(records);
    $('#hrRoleWarn').hidden = role==='hr';
    updateSingleActions();
    updateBulkActions();
    showTab(tab);
  }
  function createCandidates(candidates: Candidate[], batch: boolean) {
    if (role!=='hr' || photoLoading || (!batch && (aadhaarScanPending||aadhaarHistoryPending))) return false;
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
    if (savedSession()?.grant) void sendPart1(created,scope,aadhaar.documents?.())
      .then(d=>{if(!effects.signal.aborted) showTelegram([d.message],batch?`Batch ${created[0].batch} – sent to driver trainer (PDF sheet attached)`:'Trial Form Submitted – sent to driver trainer',undefined,deliveryStatus(d));})
      .catch(error=>{if(!effects.signal.aborted) toast('Telegram: '+(error instanceof Error?error.message:'could not send'));});
    return true;
  }
  function resetSingle() {
    ++photoVersion;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = '';
    photo = '';
    photoLoading = false;
    aadhaarScanPending = false;aadhaarBirthDate='';
    drivingLicenceBusy=false;drivingLicenceReady=false;
    resetAadhaarHistoryCheck();
    aadhaar.reset();
    $<HTMLFormElement>('#single').reset();
    renderDrivingLicenceClasses([]);
    renderDrivingLicenceValidDates([]);
    $$<HTMLInputElement>('#single input[data-aadhaar-locked]').forEach(control => { control.readOnly = false; delete control.dataset.aadhaarLocked; control.title = ''; });
    $$<HTMLInputElement>('#single input[data-driving-licence-locked]').forEach(control => { control.readOnly = false; delete control.dataset.drivingLicenceLocked; control.title = ''; });
    $('#photoBox').innerHTML = 'Upload photo<br><span class="muted">camera or gallery</span>';
    $('#f_vother').hidden = true;
    $<HTMLInputElement>('#f_trial').value = localDateTime();
    $<HTMLInputElement>(`input[name="f_post"][value="${defaults()}"]`).checked = true;
    const vehicle=({
      'Loader Operator':'Loader','Dumper Operator':'Dumper/Tipper','Grader Operator':'Grader','Excavator Operator':'Excavator','Drill Operator':'Other',
    } as Record<string,string>)[scope.designation||''];
    if(vehicle){
      const choice=$<HTMLInputElement>(`input[name="f_vehicle"][value="${vehicle}"]`);choice.checked=true;
      if(vehicle==='Other'){$<HTMLInputElement>('#f_vother').hidden=false;$<HTMLInputElement>('#f_vother').value='Drill';}
    }
    updateSingleActions();
  }
  function updateSingleActions() {
    const canEdit = role === 'hr';
    $<HTMLButtonElement>('#sSubmit').disabled = !canEdit || photoLoading || aadhaarScanPending || aadhaarHistoryPending;
    $<HTMLButtonElement>('#aadhaarContinue').disabled = aadhaarScanPending || aadhaarHistoryPending || drivingLicenceBusy || !drivingLicenceReady;
  }
  function setAadhaarBusy(busy: boolean) {
    aadhaarScanPending = busy;
    updateSingleActions();
  }
  function setDrivingLicenceBusy(busy:boolean){drivingLicenceBusy=busy;updateSingleActions();}
  function setDrivingLicenceReady(ready:boolean){drivingLicenceReady=ready;updateSingleActions();}
  const dlClassFields: (keyof DrivingLicenceClass)[]=['code','issuedBy','dateOfIssue','vehicleCategory','badgeNumber','badgeIssuedDate','badgeIssuedBy'];
  function renderDrivingLicenceClasses(rows:DrivingLicenceClass[]){
    $('#f_dlclasses').innerHTML=(rows.length?rows:[{code:'',issuedBy:'',dateOfIssue:'',vehicleCategory:'',badgeNumber:'',badgeIssuedDate:'',badgeIssuedBy:''}]).map((row,index)=>
      `<tr data-dl-class-row>${dlClassFields.map(field=>`<td><input type="${field==='dateOfIssue'||field==='badgeIssuedDate'?'date':'text'}" data-dl-class="${field}" aria-label="Driving licence class ${index+1} ${field}" value="${esc(row[field])}"></td>`).join('')}</tr>`
    ).join('');
  }
  function renderDrivingLicenceValidDates(dates:string[]){
    const values=[dates[0]||'',dates[1]||''],labels=['Valid up to (TR)','Valid up to (NT)'];
    $('#f_dlvalids').innerHTML=values.map((value,index)=>`<label class="dl-valid"><span>${labels[index]}</span><input type="date" data-dl-valid aria-label="${labels[index]}" value="${esc(value)}"></label>`).join('');
  }
  function drivingLicenceClasses(){
    return $$<HTMLTableRowElement>('[data-dl-class-row]').map(row=>Object.fromEntries(dlClassFields.map(field=>[field,row.querySelector<HTMLInputElement>(`[data-dl-class="${field}"]`)?.value.trim()||''])) as DrivingLicenceClass).filter(row=>Object.values(row).some(Boolean));
  }
  function drivingLicenceValidDates(){return $$<HTMLInputElement>('[data-dl-valid]').map(input=>input.value).filter(Boolean);}
  function lockDrivingLicenceScanned(control:HTMLInputElement){
    if(!control.value)return;
    control.readOnly=true;
    control.dataset.drivingLicenceLocked='1';
    control.title='Filled from the driving licence – cannot be edited';
  }
  function fillDrivingLicenceDetails(details:DrivingLicenceDetails){
    if(!sameDocumentBirthDate(aadhaarBirthDate,details.dob)){drivingLicenceReady=false;updateSingleActions();throw new Error('Aadhaar and driving licence dates of birth do not match. Upload documents belonging to the same person.');}
    const licenceNumber=$<HTMLInputElement>('#f_dl'),issueDate=$<HTMLInputElement>('#f_dlissue');
    licenceNumber.readOnly=false;issueDate.readOnly=false;
    licenceNumber.value=details.licenceNumber;
    renderDrivingLicenceClasses(details.classDetails);
    issueDate.value=details.issueDate;
    renderDrivingLicenceValidDates(details.validUpto);
    [licenceNumber,issueDate,...$$<HTMLInputElement>('[data-dl-class],[data-dl-valid]')].forEach(lockDrivingLicenceScanned);
    drivingLicenceReady=true;updateSingleActions();
  }
  /* Values read from the Aadhaar card are locked: HR cannot retype them, only a new scan can replace them. */
  function lockScanned(control: HTMLInputElement) {
    control.readOnly = true;
    control.dataset.aadhaarLocked = '1';
    control.title = 'Filled from the Aadhaar card – cannot be edited';
  }
  function fillAadhaarDetails(details: AadhaarDetails) {
    if (!aadhaarScanPending || effects.signal.aborted) return '';
    const enteredNumber = digits(value('#f_aadhaar'));
    if (details.uid && enteredNumber.length === 12 && enteredNumber !== details.uid) {
      return 'This card has a different Aadhaar number. Check the card and retry.';
    }
    aadhaarBirthDate=details.dob;
    const fields = [
      ['#f_name', details.name], ['#f_father', details.relationName], ['#f_dob', details.dob],
      ['#f_aadhaar', details.uid], ['#f_address', details.address],
    ] as const;
    let filled = 0;
    for (const [selector, detail] of fields) {
      const control = $<HTMLInputElement>(selector);
      if (!detail) continue;
      if (control.value.trim() && !control.readOnly) continue;
      control.value = detail;
      if (control.value) { filled++; lockScanned(control); }
    }
    if(/^\d{12}$/.test(details.uid)&&digits(value('#f_aadhaar'))===details.uid)void checkAadhaarHistory(details.uid);
    return filled
      ? 'Aadhaar details filled and locked – they come from the card and cannot be edited.'
      : 'The scan added no new details. Review the form or enter the missing details manually.';
  }
  function resetAadhaarHistoryCheck() {
    ++aadhaarLookupVersion;
    checkedAadhaar='';
    aadhaarHistoryPending=false;
  }
  async function checkAadhaarHistory(number:string) {
    const grant=savedSession()?.grant;
    if(!grant||checkedAadhaar===number||aadhaarHistoryPending)return;
    const version=++aadhaarLookupVersion;
    aadhaarHistoryPending=true;
    updateSingleActions();
    const previous=await findPreviousTrial(number,previousTrialRows(),grant);
    if(effects.signal.aborted||version!==aadhaarLookupVersion)return;
    aadhaarHistoryPending=false;
    updateSingleActions();
    if(digits(value('#f_aadhaar'))!==number||savedSession()?.grant!==grant)return;
    if(!previous.unavailable)checkedAadhaar=number;
    if(previous.match)showAadhaarHistory([{match:previous.match}]);
    else if(previous.unavailable)toast('Could not check previous trials. Scan the card again to retry.');
  }
  function showAadhaarHistory(results:{match:TrialMatch;scan?:number}[]) {
    const active=root.activeElement||document.activeElement;
    aadhaarHistoryFocus=active instanceof HTMLElement?active:null;
    $('#aadhaarHistoryTitle').textContent=results.length===1?'Previous trial found':'Previous trials found';
    $('#aadhaarHistoryResults').innerHTML=results.map(({match,scan})=>{
      const failed=match.result==='FAIL';
      return `<div class="aadhaar-history-result ${failed?'p-fail':'p-pass'}">
        <strong>${scan===undefined?'':`Scan ${scan}: `}${failed?'FAIL':'PASS'}</strong>
        <dl><dt>Equipment</dt><dd>${esc(match.equipment||'Not recorded')}</dd>
        <dt>Site</dt><dd>${esc(match.site?siteDisplayName(match.site):'Not recorded')}</dd>
        ${failed?`<dt>Reason</dt><dd>${esc(match.failureReason||'Not recorded')}</dd>`:''}</dl>
      </div>`;
    }).join('');
    $('.wrap').inert=true;
    $('#aadhaarHistory').hidden=false;
    $('#aadhaarHistoryClose').focus();
  }
  function closeAadhaarHistory() {
    $('#aadhaarHistory').hidden=true;
    $('.wrap').inert=false;
    if(aadhaarHistoryFocus?.isConnected&&aadhaarHistoryFocus!==document.body)aadhaarHistoryFocus.focus();
    else $<HTMLButtonElement>('#tabs .on').focus();
    aadhaarHistoryFocus=null;
  }
  $('#aadhaarHistoryClose').onclick=closeAadhaarHistory;
  $('#aadhaarHistory').onclick=event=>{if(event.target===$('#aadhaarHistory'))closeAadhaarHistory();};
  $('#f_aadhaar').addEventListener('input',()=>{
    resetAadhaarHistoryCheck();
    updateSingleActions();
  });
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
    const dlClasses=drivingLicenceClasses(),dlValidDates=drivingLicenceValidDates();
    if (createCandidates([{
      name:value('#f_name'),father:value('#f_father'),dob:value('#f_dob'),mobile:value('#f_mobile'),aadhaar:digits(value('#f_aadhaar')),
      address:value('#f_address'),photo,post:post(value('input[name="f_post"]:checked')),vehicles,
      otherVehicle:vehicles.includes('Other')?value('#f_vother'):'',dl:value('#f_dl'),dlClasses,dlIssue:value('#f_dlissue'),dlValid:dlValidDates.join(', '),dlValidDates,
      experience:value('#f_exp'),employer:value('#f_prev'),trialDate:value('#f_trial'),referredBy:value('#f_ref'),trialConductedBy:value('#f_conducted'),
      docs:Object.fromEntries(DOCS.map(([key])=>[key,check(value('#d_'+key),value('#dr_'+key))])) as Candidate['docs'],
    }],false)) resetSingle();
  };

  function updateBulkActions() {
    for (const control of $$<HTMLButtonElement|HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('#bulk button, #bulk input, #bulk select, #bulk textarea')) {
      control.disabled = bulkBusy || role!=='hr';
    }
  }
  function renderBulk() {
    $('#bTable tbody').innerHTML = bulk.map((row,i)=>`<tr><td class="mono">${i+1}</td>${bulkColumns.map(([key,label,type,placeholder])=>
      `<td><input type="${type}" data-row="${i}" data-field="${key}" value="${esc(row[key])}" aria-label="Row ${i+1}: ${esc(label)}" placeholder="${placeholder}"></td>`).join('')}
      ${bulkConfirmations.map(([key,label])=>`<td style="text-align:center"><input type="checkbox" data-row="${i}" data-field="${key}" aria-label="Row ${i+1}: ${label}" ${row[key]?'checked':''}></td>`).join('')}
      <td><button type="button" class="btn sm" data-delete="${i}" aria-label="Remove row ${i+1}">✕</button></td></tr>`).join('');
    updateBulkActions();
  }
  $('#bTable').oninput = event=>{
    if (bulkBusy || role!=='hr') return;
    const input=event.target as HTMLInputElement;
    const row=bulk[Number(input.dataset.row)];
    if (!row) return;
    const field=bulkColumns.find(([key])=>key===input.dataset.field);
    const flag=bulkConfirmations.find(([key])=>key===input.dataset.field);
    if (field) row[field[0]]=input.value;
    if (flag) row[flag[0]]=input.checked;
  };
  $('#bTable').onclick=event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-delete]');
    if (button) {bulk.splice(Number(button.dataset.delete),1);renderBulk();}
  };
  $('#bAdd').onclick=()=>{bulk.push(blankBulkRow());renderBulk();};
  $('#b_veh').onchange=()=>{$('#b_other_label').hidden=value('#b_veh')!=='Other';};
  $('#b_pasteBtn').onclick=()=>{
    const lines=value('#b_paste').split(/\r?\n/).filter(line=>line.trim());
    if (!lines.length) return toast('Paste some rows first.');
    const parsed=lines.map(line=>{
      const cells=(line.includes('\t')?line.split('\t'):line.split(',')).map(cell=>cell.trim());
      const [name='',father='',mobile='',aadhaar='',dl='',rawDate='',experience='',referredBy='']=cells;
      return {bad:cells.length>8||!name||Boolean(rawDate&&!licenceDate(rawDate)),
        row:{...blankBulkRow(),name,father,mobile:digits(mobile),aadhaar:digits(aadhaar),dl,dlValid:licenceDate(rawDate),experience,referredBy}};
    });
    const invalid=parsed.findIndex(item=>item.bad);
    if (invalid>=0) return toast(`Check the name, columns and DL date on pasted row ${invalid+1}.`);
    bulk=[...bulk.filter(hasBulkCandidate),...parsed.map(item=>item.row)];
    $<HTMLTextAreaElement>('#b_paste').value='';
    renderBulk();
    toast(`${parsed.length} rows added. Confirm the documents you checked.`);
  };
  function bulkStatus(message: string, issues: string[] = []) {
    $('#bUploadStatus').textContent = message;
    $('#bUploadStatus').hidden = !message;
    $('#bUploadIssues').innerHTML = issues.map(issue=>`<li>${esc(issue)}</li>`).join('');
    $('#bUploadIssues').hidden = !issues.length;
  }
  function setBulkBusy(busy: boolean) {
    bulkBusy = busy;
    $<HTMLSelectElement>('#role').disabled = busy||roleLocked;
    updateBulkActions();
  }
  async function importBulkExcel(file: File) {
    if (!/\.xlsx?$/i.test(file.name)) {
      bulkStatus('Choose an Excel workbook in .xlsx or .xls format.');
      return;
    }
    bulkStatus('Reading Excel workbook…');
    const rows = await readBulkWorkbook(file);
    if (effects.signal.aborted) return;
    bulk = [...bulk.filter(hasBulkCandidate),...rows];
    bulkStatus(`${rows.length} candidate ${rows.length===1?'row':'rows'} imported. Review the details before submitting.`);
  }
  async function scanBulkAadhaar(files: File[]) {
    const grant = savedSession()?.grant;
    if (!grant) {
      bulkStatus('Sign in again before scanning Aadhaar.');
      return;
    }
    const rows = bulk.filter(hasBulkCandidate);
    const issues: string[] = [];
    const duplicates:{match:TrialMatch;scan:number}[]=[];
    const checked=new Set<string>();
    const historyRows=previousTrialRows();
    let applied = 0;
    for (const [index,file] of files.entries()) {
      if (effects.signal.aborted) return;
      if (savedSession()?.grant!==grant) {
        issues.push(`Sign in again to scan the remaining ${files.length-index} files.`);
        break;
      }
      bulkStatus(`Scanning Aadhaar ${index+1} of ${files.length}…`);
      try {
        if (!/\.(jpe?g|png|pdf)$/i.test(file.name)) throw new Error('Choose a JPG, PNG or PDF.');
        const details = await readGeminiAadhaar(file,grant);
        if (effects.signal.aborted) return;
        applyBulkAadhaar(rows,details);
        applied++;
        const number=details.uid;
        if(/^\d{12}$/.test(number)&&!checked.has(number)){
          checked.add(number);
          const previous=await findPreviousTrial(number,historyRows,grant);
          if(effects.signal.aborted||savedSession()?.grant!==grant)return;
          if(previous.match)duplicates.push({match:previous.match,scan:index+1});
          else if(previous.unavailable)issues.push(`${file.name}: Could not check previous trials.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The scan failed.';
        issues.push(`${file.name}: ${message}`);
      }
    }
    if (applied) bulk = rows;
    bulkStatus(`${applied} of ${files.length} Aadhaar scans applied. Review the rows before submitting.`,issues);
    if(duplicates.length)showAadhaarHistory(duplicates);
  }
  for (const [button,selector,load] of [
    ['#bExcelUpload','#bExcelFile',(files: File[])=>importBulkExcel(files[0])],
    ['#bScanUpload','#bScanFiles',scanBulkAadhaar],
  ] as const) {
    const input = $<HTMLInputElement>(selector);
    $(button).onclick = ()=>input.click();
    input.onchange = async ()=>{
      const files = Array.from(input.files??[]);
      input.value = '';
      if (!files.length || bulkBusy || role!=='hr') return;
      setBulkBusy(true);
      try {await load(files);}
      catch (error) {
        if (!effects.signal.aborted) bulkStatus(error instanceof Error ? error.message : 'Could not read the selected file.');
      } finally {
        if (!effects.signal.aborted) {
          setBulkBusy(false);
          renderBulk();
        }
      }
    };
  }
  $('#bExcelTemplate').onclick=downloadBulkWorkbook;
  $('#bSubmit').onclick=()=>{
    if (bulkBusy) return;
    const vehicle=value('#b_veh');
    const candidates=bulk.filter(hasBulkCandidate).map((row):Candidate=>({
      name:row.name.trim(),father:row.father.trim(),mobile:row.mobile.trim(),aadhaar:digits(row.aadhaar),dl:row.dl.trim(),
      dlValid:row.dlValid,experience:row.experience.trim(),referredBy:row.referredBy.trim()||value('#b_ref'),
      dob:row.dob,address:row.address.trim(),photo:'',employer:'',post:post(value('#b_post')),vehicles:[vehicle],
      otherVehicle:vehicle==='Other'?value('#b_other'):'',trialDate:value('#b_trial'),
      docs:{dl:check(row.dlSeen?'Yes':'No'),hemm:check(),aadhaar:check(row.aSeen?'Yes':'No'),medical:check(row.medSeen?'Yes':'No'),exp:check()},
    }));
    if(createCandidates(candidates,true)){bulk=Array.from({length:3},blankBulkRow);bulkStatus('');renderBulk();}
  };

  async function submitResults() {
    if (role!=='trainer'||submittingResults) return;
    const name = signer();
    if (!name) return;
    const rows=waiting().filter(row=>drafts.get(row.id)?.result);
    if (!rows.length) return toast('Set PASS or FAIL for at least one candidate.');
    const invalid=rows.find(row=>drafts.get(row.id)?.result==='FAIL'&&!drafts.get(row.id)?.reason.trim());
    if (invalid) return toast(`Enter the fail reason for ${invalid.name}.`);
    const missingResult=rows.find(row=>!draftFiles.has(row.id));
    if(missingResult)return toast(`Upload the trial result file for ${missingResult.name}.`);
    const optimizingVideo=rows.find(row=>optimizingVideos.has(row.id));
    if(optimizingVideo)return toast(`Wait for the driving video optimization for ${optimizingVideo.name}.`);
    const missingVideo=rows.find(row=>!draftVideos.has(row.id));
    if(missingVideo)return toast(`Upload the driving video for ${missingVideo.name}.`);
    if(savedSession()?.grant){
      submittingResults=true;
      try{
        const trainer=await fetchTrialTrainer(scope);
        if(effects.signal.aborted)return;
        setTrainer(trainer.name);
        if(!trainerName)return toast(trainer.reason||'Assign a Driver Trainer in the active site hierarchy before submitting.');
        if(trainer.roles&&!trainer.roles.includes('trainer'))return toast('Your Pulse ID is no longer assigned as Driver Trainer for this site.');
      }catch(error){
        if(!effects.signal.aborted)toast(error instanceof Error?error.message:'Could not load the Driver Trainer hierarchy. Try again.');
        return;
      }finally{submittingResults=false;}
    }
    if(!trainerName)return toast('Assign a Driver Trainer in the active site hierarchy before submitting.');
    const ids=new Set(rows.map(row=>row.id)), at=new Date().toISOString(), changed: Trial[]=[];
    const files = new Map(rows.flatMap(row=>{
      const file = draftFiles.get(row.id);
      return file ? [[row.id,{id:crypto.randomUUID(),file}] as const] : [];
    }));
    const videos = new Map(rows.flatMap(row=>{
      const file = draftVideos.get(row.id);
      return file ? [[row.id,{id:crypto.randomUUID(),file}] as const] : [];
    }));
    const storedFiles=[...files.values(),...videos.values()];
    if (storedFiles.length) {
      submittingResults = true;
      $<HTMLSelectElement>('#role').disabled = true;
      renderTrainer();
      try {
        await saveTrialResultFiles(storedFiles);
      } catch {
        if (!effects.signal.aborted) {
          toast('Could not save the trial result files. Check browser storage or remove a file and try again.');
        }
        return;
      } finally {
        submittingResults = false;
        $<HTMLSelectElement>('#role').disabled = roleLocked;
        if (!effects.signal.aborted && tab==='trainer') renderTrainer();
      }
    }
    const latest=read();
    if(latest.filter(row=>ids.has(row.id)&&row.stage==='trainer').length!==ids.size)return toast('The trainer queue changed. Reopen it and try again.');
    latest.forEach(row=>{
        if(!ids.has(row.id)) return;
        const d=drafts.get(row.id)!;
        const attachment=files.get(row.id);
        const videoAttachment=videos.get(row.id);
        const next: Trial={...row,stage:'pm',result:d.result,outcome:{
          ...d,machine:d.result==='PASS'?d.machine.trim():'',reason:d.result==='FAIL'?d.reason.trim():'',
          remarks:d.remarks.trim(),trainer:d.trainer.trim()||name,at,
          attachment:attachment && {id:attachment.id,name:attachment.file.name},
          videoAttachment:videoAttachment && {id:videoAttachment.id,name:videoAttachment.file.name},
        },history:[...row.history,{role:'trainer',action:'Trial result: '+d.result,by:name,at}]};
        changed.push(next);
    });
    let delivery:Awaited<ReturnType<typeof sendResults>>|undefined;
    if(savedSession()?.grant){
      submittingResults=true;renderTrainer();
      try{
        delivery=await sendResults(changed,new Map(changed.map(row=>[row.id,files.get(row.id)?.file])),new Map(changed.map(row=>[row.id,videos.get(row.id)?.file])),name,scope);
      }catch(error){
        if(!effects.signal.aborted)toast(error instanceof Error?error.message:'Could not send results to PM. Try again.');
        await removeTrialResultFiles(storedFiles.map(file=>file.id)).catch(()=>{});
        return;
      }finally{submittingResults=false;if(!effects.signal.aborted)renderTrainer();}
    }
    const committed = !effects.signal.aborted && commit(current=>current.map(row=>changed.find(next=>next.id===row.id)||row));
    if (!committed) {
      if (storedFiles.length) await removeTrialResultFiles(storedFiles.map(file=>file.id)).catch(()=>{});
      return;
    }
    for (const id of ids) {
      drafts.delete(id);
      draftFiles.delete(id);
      draftVideos.delete(id);
    }
    const passed=changed.filter(row=>row.result==='PASS');
    toast(`${changed.length} results sent to PM – ${passed.length} pass, ${changed.length-passed.length} fail.`);
    if(delivery)showTelegram([delivery.message],'Trial result – sent to PM for approval',undefined,deliveryStatus(delivery));
    else if(passed.length)showTelegram(passed.map(resultMessage),'Trial PASS – sent to PM for approval');
  }
  function focusResultUpload(id: string, selector='[data-choose-result-file]') {
    $$<HTMLButtonElement>('#trList '+selector).find(button=>
      button.closest<HTMLElement>('[data-id]')?.dataset.id===id)?.focus();
  }
  $('#trList').onclick=event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-res],[data-choose-result-file],[data-remove-result-file],[data-choose-driving-video],[data-remove-driving-video]');
    if (!button || role!=='trainer' || submittingResults) return;
    const card=button.closest<HTMLElement>('[data-id]');
    const row=waiting().find(item=>item.id===card?.dataset.id);
    if (!row) return;
    if (button.hasAttribute('data-choose-result-file')) {
      const picker=$<HTMLInputElement>('#trResultPicker');
      picker.dataset.trialId=row.id;picker.click();
      return;
    }
    if (button.hasAttribute('data-choose-driving-video')) {
      const picker=$<HTMLInputElement>('#trVideoPicker');
      picker.dataset.trialId=row.id;picker.click();
      return;
    }
    if (button.hasAttribute('data-remove-result-file')) {
      draftFiles.delete(row.id);
      renderTrainer();
      focusResultUpload(row.id);
      return;
    }
    if (button.hasAttribute('data-remove-driving-video')) {
      draftVideos.delete(row.id);
      renderTrainer();
      focusResultUpload(row.id,'[data-choose-driving-video]');
      return;
    }
    const result=button.dataset.res;
    if (result!=='PASS'&&result!=='FAIL') return;
    const draft=draftFor(row);
    draft.result=draft.result===result?'':result;
    renderTrainer();
    $$<HTMLButtonElement>('#trList [data-res]').find(item=>
      item.dataset.res===result&&item.closest<HTMLElement>('[data-id]')?.dataset.id===row.id)?.focus();
  };
  $('#trList').oninput=event=>{
    if (role!=='trainer'||submittingResults) return;
    const input=event.target as HTMLInputElement;
    const field=input.dataset.f;
    if (!field) return;
    const row=waiting().find(item=>item.id===input.closest<HTMLElement>('[data-id]')?.dataset.id);
    if (!row) return;
    const draft=draftFor(row);
    if (field==='post') draft.post=post(input.value);
    else if(field==='machine'||field==='reason'||field==='remarks') draft[field]=input.value;
  };
  const receiveTrialFile=async (event:Event)=>{
    const input=event.target as HTMLInputElement;
    const isResult=input.hasAttribute('data-result-file'),isVideo=input.hasAttribute('data-driving-video');
    if (role!=='trainer'||submittingResults||!isResult&&!isVideo) return;
    const file=input.files?.[0];
    input.value='';
    const row=waiting().find(item=>item.id===input.dataset.trialId);
    if (!file||!row) return;
    if (!file.size) {
      toast(`The ${isVideo?'driving video':'trial result file'} is empty. Choose another file.`);
      return;
    }
    if(isVideo){
      if (!(file.type||'').startsWith('video/')&&!/\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(file.name)) {
        toast('Choose a video file.');
        return;
      }
      optimizingVideos.add(row.id);draftVideos.delete(row.id);renderTrainer();
      toast(`Optimizing the driving video for ${row.name}…`);
      try{
        const optimized=await optimizeDrivingVideo(file,{signal:effects.signal});
        if(effects.signal.aborted)return;
        draftVideos.set(row.id,optimized.file);
        toast(`Driving video optimized as ${optimized.format.label}.`);
      }catch(error){
        if(!effects.signal.aborted)toast(error instanceof Error?error.message:'Could not optimize the driving video.');
      }finally{
        optimizingVideos.delete(row.id);
        if(!effects.signal.aborted){renderTrainer();focusResultUpload(row.id,'[data-choose-driving-video]');}
      }
      return;
    } else {
      if (!/\.(pdf|jpe?g|png)$/i.test(file.name) || (file.type && !['application/pdf','image/jpeg','image/png'].includes(file.type))) {
        toast('Choose a PDF, JPG or PNG trial result file.');
        return;
      }
      draftFiles.set(row.id,file);
    }
    renderTrainer();
    focusResultUpload(row.id,isVideo?'[data-choose-driving-video]':'[data-choose-result-file]');
  };
  $('#trResultPicker').onchange=receiveTrialFile;
  $('#trVideoPicker').onchange=receiveTrialFile;
  $('#trSubmit').onclick=()=>void submitResults();

  async function decide(approved: boolean, ids: string[], note: string) {
    if(submittingApproval)return false;
    const reviewer=role;
    if (!canApprove(reviewer)) return false;
    const name=signer();
    if (!name) return false;
    if (!ids.length) {toast('Select at least one form.');return false;}
    if (!approved&&!note) {toast('Write a note to explain the rejection.');return false;}
    const at=new Date().toISOString(), changed: Trial[]=[];
    let delivery:Awaited<ReturnType<typeof sendApproval>>|undefined;
    if(savedSession()?.grant){
      const current=read().filter(row=>ids.includes(row.id)&&row.stage===reviewer);
      if(current.length!==ids.length){toast('The approval queue changed. Select the forms again.');return false;}
      const proposed=current.map(row=>({...row,stage:approved?NEXT[reviewer]:'rejected',history:[...row.history,{role:reviewer,action:approved?'Approved':'Rejected',by:name,at,note}]} as Trial));
      submittingApproval=true;
      try{delivery=await sendApproval(proposed,reviewer,approved,note,name,at,getTrialResultFile,scope);}
      catch(error){toast(error instanceof Error?error.message:'Could not save the approval. Try again.');return false;}
      finally{submittingApproval=false;}
      if(effects.signal.aborted)return false;
    }
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
    const passed=changed.filter(row=>row.result==='PASS');
    const cleared=approved&&reviewer==='director'?passed.filter(isClearedForJoining):[];
    const prepared=onCleared&&cleared.length?prepareJoining(cleared):undefined;
    const onClose=prepared?()=>void openJoining(prepared):undefined;
    const summary=!approved?`Rejected by ${ROLES[reviewer]}`:reviewer==='director'?'Final approval by Directors – cleared to join':`Approved by ${ROLES[reviewer]} – sent to ${ROLES[NEXT[reviewer] as Role]||'next stage'}`;
    if(delivery)showTelegram(delivery.message.split('\n\n———\n\n'),summary,onClose,deliveryStatus(delivery));
    else if(approved&&reviewer==='director'&&passed.length) showTelegram(passed.map(resultMessage),'Cleared to join – final approval',onClose);
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
    $(selector).onclick=async()=>{
      if (!await decide(approved,[...selected],value('#apNote'))&&!approved) $('#apNote').focus();
    };
  }
  function openDetails(id: string, source: HTMLElement) {
    const row=records.find(item=>item.id===id);
    if (!row) return;
    detailId=id;
    modalFocus=source;
    $('#modalBox').innerHTML=detailView(row,role,Boolean(onCleared));
    $('#modal').hidden=false;
    $('#mClose').focus();
  }
  function closeDetails(restore=true) {
    $('#modal').hidden=true;
    detailId='';
    if(restore && modalFocus?.isConnected) modalFocus.focus();
    modalFocus=null;
  }
  async function downloadTrialResult(attachment: NonNullable<Outcome['attachment']>) {
    try {
      const file=await getTrialResultFile(attachment.id);
      if (effects.signal.aborted) return;
      if (!file) return toast('The trial result file is unavailable in this browser.');
      const url=URL.createObjectURL(file);
      const link=document.createElement('a');
      link.href=url;
      link.download=attachment.name;
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch {
      if (!effects.signal.aborted) toast('Could not open the trial result file.');
    }
  }
  $('#modal').onclick=async event=>{
    const target=event.target as HTMLElement;
    if(target.id==='modal'||target.id==='mClose') return closeDetails();
    if(target.hasAttribute('data-open-joining')){
      const row=records.find(item=>item.id===detailId);
      if (row&&isClearedForJoining(row)&&!openingJoining) void openJoining(prepareJoining([row]));
    }
    if(target.hasAttribute('data-download-result')){
      const attachment=records.find(row=>row.id===detailId)?.outcome?.attachment;
      if (attachment) void downloadTrialResult(attachment);
    }
    if(target.hasAttribute('data-download-driving-video')){
      const attachment=records.find(row=>row.id===detailId)?.outcome?.videoAttachment;
      if (attachment) void downloadTrialResult(attachment);
    }
    if(target.id==='mTelegram'){
      const row=records.find(item=>item.id===detailId);
      if (row?.result==='PASS') showTelegram([resultMessage(row)],row.stage==='done'?'Cleared to join':'Trial PASS');
    }
    if (target.dataset.decide){
      const approved=target.dataset.decide==='approve';
      if(await decide(approved,[detailId],value('#mNote'))) closeDetails($('#tgpop').hidden===true);
      else if(!approved) $('#mNote').focus();
    }
  };

  async function prepareJoining(rows: Trial[]) {
    openingJoining=true;
    try {return await onCleared?.(rows);}
    catch {if (!effects.signal.aborted) toast('Could not prepare the joining draft. In All candidates, select Open Step 2 to try again.');}
    finally {openingJoining=false;}
  }
  async function openJoining(prepared: ReturnType<typeof prepareJoining>) {
    const open=await prepared;
    if (!effects.signal.aborted) open?.();
  }
  function showTelegram(messages: string[], summary: string, onClose?: ()=>void, status = 'Preview only') {
    const text=messages.join('\n\n———\n\n'), time=indiaTime();
    telegramFocus=root.activeElement instanceof HTMLElement ? root.activeElement : null;
    afterTelegram=onClose;
    $('#tgpop').innerHTML=`<div class="tghead"><div class="tgav">CT</div><div><div class="nm">${esc(scope.company||'CMLL')} Trial Bot</div><div class="sub">${esc(summary)} · ${esc(status)}</div></div><button type="button" aria-label="Close Telegram preview" id="tgClose">×</button></div>
      <div class="tgbody">${messages.map(message=>`<div class="bubble">${esc(message)}<span class="tm">${time}</span></div>`).join('')}<textarea id="tgText" aria-label="Telegram message text" readonly hidden>${esc(text)}</textarea></div>
      <div class="tgfoot"><button type="button" class="btn tg" id="tgCopy">Copy for Telegram</button><button type="button" class="btn ${onClose?'pri':''}" id="tgClose2">${onClose?'Open Step 2':'Close'}</button></div>`;
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
    const done=afterTelegram;
    afterTelegram=undefined;
    done?.();
  }
  $('#tgPassList').onclick=()=>{
    const today=indiaDay();
    const rows=records.filter(row=>row.result==='PASS'&&row.outcome&&indiaDay(new Date(row.outcome.at))===today);
    if (!rows.length) return toast('No PASS results recorded today.');
    const lines=rows.map((row,i)=>`${i+1}. ${row.name} – ${row.outcome?.post||row.post}, ${row.outcome?.machine||equipment(row)}, ${row.experience||'–'} yrs, Ref: ${row.referredBy||'–'}`);
    showTelegram([[`📋 TRIAL PASS LIST – ${date(today)}`,'',...lines,'',`Total passed: ${rows.length}`].join('\n')],"Today's pass list");
  };

  frame.addEventListener('keydown',event=>{
    const activeDialog=!$('#aadhaarHistory').hidden?$('#aadhaarHistory'):!$('#tgpop').hidden?$('#tgpop'):!$('#modal').hidden?$('#modal'):null;
    if (!activeDialog) return;
    if (event.key==='Escape'){
      event.stopPropagation();
      if (activeDialog.id==='aadhaarHistory')closeAadhaarHistory();
      else if (activeDialog.id==='tgpop')closeTelegram();
      else closeDetails();
    }
    if (event.key==='Tab'){
      const focusables=[...activeDialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not([hidden])')];
      const first=focusables[0],last=focusables.at(-1);
      if (event.shiftKey&&root.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&root.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  frame.addEventListener('click',event=>{
    const target=(event.target as Element).closest<HTMLElement>('[data-open],[data-go],[data-join-trial]');
    if (!target) return;
    if (target.dataset.open) openDetails(target.dataset.open,target);
    else if(target.dataset.go==='hr')showTab('hr');
    else if(target.dataset.joinTrial&&!openingJoining){
      const row=records.find(item=>item.id===target.dataset.joinTrial);
      if (row&&isClearedForJoining(row)) void openJoining(prepareJoining([row]));
    }
  });
  $('#tabs').onclick=event=>{
    const target=(event.target as Element).closest<HTMLButtonElement>('[data-tab]');
    const next=tabs.find(item=>item===target?.dataset.tab);
    if (next&&roleTabs[role].includes(next)) {
      if(next==='overview'&&stageFilter){stageFilter='';tab=next;refresh();}
      else showTab(next);
    }
  };
  $('#pipe').onclick=event=>{
    if(role==='trainer')return;
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-stage]');
    if(!button?.dataset.stage) return;
    const stage=button.dataset.stage;
    stageFilter=stage===stageFilter?'':stage;
    tab='overview';
    refresh();
    $<HTMLButtonElement>(`#pipe [data-stage="${stage}"]`).focus();
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
  /* Telegram approvals: PM / Office HR / Regional HR / Director can tap Approve or Decline on their phone.
     Every 20 s (and on load) decisions recorded on the server are merged into the browser records, so the form
     leaves that approver's queue here too. */
  async function syncFromServer() {
    if (effects.signal.aborted || !savedSession()?.grant) return;
    try{
      const queue=await fetchReviewQueue(scope);
      if(effects.signal.aborted)return;
      if(queue.length)commit(latest=>{
        const merged=[...latest];
        for(const remote of queue){
          const index=merged.findIndex(row=>row.formNo===remote.formNo);
          if(index<0)merged.push(remote);
          else{
            const local=merged[index];
            if(local.result==='PASS'&&local.name===remote.name&&local.mobile===remote.mobile){
              // Keep browser attachments, while the server supplies shared review decisions.
              if(Date.parse(remote.outcome!.at)<Date.parse(local.outcome?.at||''))continue;
              const history=[...local.history.filter(h=>!canApprove(h.role)),...remote.history];
              merged[index]=normalizeTrialApproval({...local,history});
            }
          }
        }
        return merged;
      });
    }catch{/* Existing browser records remain available if the queue cannot be fetched. */}
  }
  void syncFromServer();
  const syncTimer = setInterval(() => { if (document.visibilityState==='visible') void syncFromServer(); }, 20000);
  effects.signal.addEventListener('abort', () => clearInterval(syncTimer));
  window.addEventListener('storage',event=>{
    if (event.key!==persistKey && event.key!==legacyKey) return;
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
  function setTrainer(name:string,reason=''){
    trainerName=name.trim();
    for(const draft of drafts.values())draft.trainer=trainerName;
    if(tab==='trainer')renderTrainer();
    if(!trainerName&&reason)toast(reason);
  }
  function setRoles(assigned?:string[]){
    if(!assigned)return;
    const allowed=[...new Set(assigned.filter((item):item is Role=>Object.hasOwn(ROLES,item)))] as Role[];
    const select=$<HTMLSelectElement>('#role');
    for(const option of [...select.options])if(!allowed.includes(option.value as Role))option.remove();
    if(!allowed.length){
      select.add(new Option('No Trial Hierarchy role assigned',''));
      select.value='';roleLocked=true;select.disabled=true;aadhaar.setDisabled(true);
      $$<HTMLButtonElement>('#tabs button').forEach(button=>button.hidden=true);
      tabs.forEach(item=>$('#v-'+item).hidden=true);
      toast('Your Pulse ID is not assigned to this site in Trial Hierarchy.');
      return;
    }
    role=allowed[0];select.value=role;roleLocked=allowed.length===1;select.disabled=roleLocked;
    aadhaar.setDisabled(role!=='hr');tab=roleTab[role];selected.clear();refresh();
  }
  return {dispose, fillAadhaarDetails, setAadhaarBusy,setDrivingLicenceBusy,setDrivingLicenceReady,fillDrivingLicenceDetails,setTrainer,setRoles};
}

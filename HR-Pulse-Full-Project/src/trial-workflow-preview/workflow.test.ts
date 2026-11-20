import {afterEach, describe, expect, it, vi} from 'vitest';
import {act,fireEvent,render,waitFor} from '@testing-library/react';
import {createElement} from 'react';
import {utils,write} from 'xlsx';
import TrialWorkflowPreview from './TrialWorkflowPreview';
import {sameDocumentBirthDate,type PrepareJoining} from './mount';
import * as trialResultFiles from './trialResultFiles';
import * as telegramSend from './telegramSend';
import {reviewTrial} from './reviewQueue';
import type {Trial} from './records';

vi.mock('./optimizeDrivingVideo',()=>({optimizeDrivingVideo:vi.fn(async(file:File)=>({file,format:{label:'WebM/AV1'}}))}));
vi.mock('./telegramSend',async()=>({...await vi.importActual<typeof import('./telegramSend')>('./telegramSend'),fetchReviewQueue:vi.fn(async()=>[])}));

const scope = {company:'CMLL',site:'Jayant OB East',region:'NCL',group:'OB / COAL',name:'Sample Signer',owner:'sample',department:'Driver'};
const hierarchyTrainer={roles:['hr','trainer','pm','ohr','rhr','director'],actor:'sajadali',name:'Sajad Ali',site:'Jayant OB East'};
let dispose: (()=>void)|undefined;
function setup(overrides: Partial<typeof scope> = {},onCleared?: PrepareJoining) {
  dispose?.();
  const {container,unmount,getByLabelText,getByRole} = render(createElement(TrialWorkflowPreview,{...scope,...overrides,onCleared}));
  const root = container.querySelector('div')!.shadowRoot!;
  dispose = unmount;
  const el = <T extends HTMLElement=HTMLElement>(selector: string) => {
    const node=root.querySelector<T>(selector);
    if (!node) throw new Error('Missing element: '+selector);
    return node;
  };
  const click = (selector: string) => act(()=>{el<HTMLElement>(selector).click();});
  const input = (selector: string, value: string) => fireEvent.input(el(selector),{target:{value}});
  const change = (selector: string,value: string) => fireEvent.change(el(selector),{target:{value}});
  return {root,el,click,input,change,getByLabelText,getByRole};
}
afterEach(()=>{
  dispose?.();
  dispose=undefined;
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('Trial workflow preview',()=>{
  it('sends a Part 1 form that never reached the server again and takes the number the server kept',async()=>{
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
    const key='hrPulse.localTrialWorkflow.v1:'+JSON.stringify([scope.owner,scope.company,scope.site]);
    const unsent={id:'local-1',formNo:'TF/2026-27/0001',stage:'trainer',result:'',site:scope.site,name:'Vishal Suresh Jadhao',father:'',dob:'',mobile:'1234567894',aadhaar:'',address:'',dl:'',dlValid:'',referredBy:'',employer:'',batch:'',createdAt:'2026-11-20T06:13:00Z',trialDate:'2026-11-20T11:43',photo:'',post:'Driver',experience:'',vehicles:['Water Tanker'],otherVehicle:'',docs:{dl:{seen:'Yes',remarks:''},hemm:{seen:'',remarks:''},aadhaar:{seen:'',remarks:''},medical:{seen:'Yes',remarks:''},exp:{seen:'',remarks:''}},history:[{role:'hr',by:'Ankit',at:'2026-11-20T06:13:00Z',action:'Submitted Part 1'}]};
    localStorage.setItem(key,JSON.stringify([unsent]));
    const request=vi.spyOn(window,'fetch').mockImplementation(async url=>Response.json(
      String(url).endsWith('/trial-part1')?{batchId:'',formNos:['TF/2026-27/0009'],telegram:{message:'',recipients:1,connected:[]}}:{...hierarchyTrainer,roles:['hr']}));
    setup();
    await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)||'[]')[0]).toMatchObject({formNo:'TF/2026-27/0009',sent:true}));
    const part1=request.mock.calls.filter(([url])=>String(url).endsWith('/trial-part1'));
    expect(part1).toHaveLength(1);
    expect(JSON.parse(String(part1[0][1]?.body)).candidates[0]).toMatchObject({formNo:'TF/2026-27/0001',clientId:'local-1'});
  });
  it('shows the admin trial overview before selecting a site without enabling actions',async()=>{
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
    vi.spyOn(window,'fetch').mockResolvedValue(Response.json({roles:[],overview:true,name:''}));
    const {el}=setup({site:'',region:''});
    await waitFor(()=>expect(el('#v-overview').hidden).toBe(false));
    expect(el('#role')).toHaveValue('observer');
    expect(el('#ovList')).toHaveTextContent('Select a region and site to view trial records');
    expect(el('#ovList').querySelector('[data-go="hr"]')).toBeNull();
    expect(el('#sSubmit')).toBeDisabled();expect(el('#trSubmit')).toBeDisabled();
  });
  it.each([
    {roles:[],overview:true,option:'observer',panel:'overview'},
    {roles:['hr'],overview:false,option:'hr',panel:'aadhaar'},
    {roles:['trainer'],overview:false,option:'trainer',panel:'trainer'},
    {roles:['pm'],overview:false,option:'pm',panel:'approve'},
    {roles:['ohr'],overview:false,option:'ohr',panel:'approve'},
    {roles:['rhr'],overview:false,option:'rhr',panel:'approve'},
    {roles:['director'],overview:false,option:'director',panel:'approve'},
  ])('shows only assigned roles: $option',async({roles,overview,option,panel})=>{
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
    vi.spyOn(window,'fetch').mockResolvedValue(Response.json({...hierarchyTrainer,roles,overview}));
    const {el,root}=setup();
    await waitFor(()=>expect(el<HTMLSelectElement>('#role').value).toBe(option));
    expect(Array.from(el<HTMLSelectElement>('#role').options,item=>item.value)).toEqual([option]);
    expect(el('#v-'+panel).hidden).toBe(false);
    if(overview){
      expect(el('#sSubmit')).toBeDisabled();expect(el('#trSubmit')).toBeDisabled();
      fireEvent.change(el('#role'),{target:{value:'hr'}});
      expect(el('#v-overview').hidden).toBe(false);
      expect(root.querySelector('[data-open-joining]')).toBeNull();
    }
  });
  it('hides the workflow when no role is assigned or access lookup fails',async()=>{
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
    vi.spyOn(window,'fetch').mockResolvedValue(Response.json({roles:[],overview:false}));
    const {el,getByRole}=setup();
    await waitFor(()=>expect(el('#toast')).toHaveTextContent('not assigned'));
    for(const panel of ['aadhaar','hr','trainer','approve','overview'])expect(el('#v-'+panel).hidden).toBe(true);
    expect(getByRole('button',{name:'Upload A/D'})).toBeDisabled();
  });
  it.each(['pm','ohr','rhr','director'])('gives %s Approvals plus a read-only completed-candidate view',role=>{
    const {root,el,change,click}=setup();
    change('#role',role);
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>('#tabs button')).filter(button=>!button.hidden).map(button=>button.dataset.tab)).toEqual(['approve','overview']);
    expect(el('#v-approve')).not.toHaveAttribute('hidden');
    click('[data-tab="overview"]');
    expect(el('#v-overview')).not.toHaveAttribute('hidden');
    expect(el('#pipe')).not.toHaveAttribute('hidden');
    change('#role','hr');
    expect(el('[data-tab="overview"]')).not.toHaveAttribute('hidden');
    change('#role','trainer');
    expect(el('[data-tab="overview"]')).not.toHaveAttribute('hidden');
  });

  it('shows only trial results when working as Driver Trainer',()=>{
    const {el,change}=setup();
    change('#role','trainer');
    expect(el('#v-trainer').hidden).toBe(false);
    expect(el('#pipe').hidden).toBe(false);
    expect(el('#tabs').hidden).toBe(false);
    expect(el('[data-tab="overview"]').hidden).toBe(false);
    for(const section of ['aadhaar','hr','approve','overview'])expect(el('#v-'+section).hidden).toBe(true);
    change('#role','pm');
    expect(el('#tabs').hidden).toBe(false);
    expect(el('[data-tab="overview"]').hidden).toBe(false);
    expect(el('#v-approve').hidden).toBe(false);
  });
  it('requires the referrer and trial conductor',()=>{
    const {el,click}=setup();
    click('[data-tab="hr"]');
    expect(el('#f_ref')).toBeRequired();
    expect(el('#f_conducted')).toBeRequired();
  });
  it('loads a trainer PASS into the PM queue without opening joining details',async()=>{
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
    vi.spyOn(window,'fetch').mockResolvedValue(Response.json({...hierarchyTrainer,roles:['pm']}));
    const row=reviewTrial({id:'shared-trial',formNo:'TF/2026-27/0001',site:scope.site,resultAt:'2026-11-19T12:00:00Z',
      fields:{Result:'PASS','Name of candidate':'Shared Candidate','Mobile no.':'9876543210'}})!;
    vi.mocked(telegramSend.fetchReviewQueue).mockResolvedValueOnce([row]);
    const onCleared=vi.fn();const {el}=setup({},onCleared);
    await waitFor(()=>expect(el('#apList')).toHaveTextContent('Shared Candidate'));
    expect(el('#apList')).toHaveTextContent('TF/2026-27/0001');
    expect(onCleared).not.toHaveBeenCalled();
    expect(el('#bTrainer')).toHaveTextContent('0');
  });
  it('reloads a trainer saved in another tab without losing the candidate draft',async()=>{
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
    const request=vi.spyOn(window,'fetch').mockImplementation(async url=>Response.json(
      String(url).endsWith('/trial-trainer')?{roles:hierarchyTrainer.roles,actor:'',name:'',site:scope.site}:{}
    ));
    const {el,click,input,change}=setup();
    await waitFor(()=>expect(el('#v-aadhaar').hidden).toBe(false));
    click('[data-tab="hr"]');
    input('#f_name','Hierarchy Candidate');
    input('#f_mobile','9876543210');
    input('#f_conducted','Trial Form Trainer');
    click('input[name="f_vehicle"][value="Excavator"]');
    change('#d_dl','Yes');
    change('#d_medical','Yes');
    fireEvent.submit(el('#single'));
    change('#role','trainer');
    await waitFor(()=>expect(el('[data-f="trainer"]')).toHaveValue('Trial Form Trainer'));
    request.mockImplementation(async()=>Response.json(hierarchyTrainer));
    fireEvent.focus(window);
    await waitFor(()=>expect(el('[data-f="trainer"]')).toHaveValue('Trial Form Trainer'));
    expect(el('#trList')).toHaveTextContent('Hierarchy Candidate');
    click('[aria-label="Hierarchy Candidate: PASS"]');
    const resultPicker=el('#trResultPicker'),videoPicker=el('#trVideoPicker');
    click('[aria-label="Hierarchy Candidate: Upload trial result"]');
    request.mockImplementation(async()=>Response.json({...hierarchyTrainer,name:'Updated Trainer'}));
    fireEvent.focus(window);
    await waitFor(()=>expect(el('[data-f="trainer"]')).toHaveValue('Trial Form Trainer'));
    expect(el('#trResultPicker')).toBe(resultPicker);
    expect(resultPicker.isConnected).toBe(true);
    fireEvent.change(resultPicker,{target:{files:[new File(['result'],'result.pdf',{type:'application/pdf'})]}});
    expect(el('#trList')).toHaveTextContent('result.pdf');
    click('[aria-label="Hierarchy Candidate: Upload Driving Video"]');
    expect(el('#trVideoPicker')).toBe(videoPicker);
    fireEvent.change(videoPicker,{target:{files:[new File(['video'],'trial.mp4',{type:'video/mp4'})]}});
    await waitFor(()=>expect(el('#trList')).toHaveTextContent('trial.mp4'));
    vi.spyOn(trialResultFiles,'saveTrialResultFiles').mockResolvedValue();
    request.mockImplementation(async url=>Response.json(String(url).endsWith('/trial-trainer')
      ?{...hierarchyTrainer,name:'New Trainer',roles:['trainer']}
      :{telegram:{message:'Sent',recipients:1,connected:[]}}));
    click('#trSubmit');
    await waitFor(()=>expect(el('#bTrainer')).toHaveTextContent('0'));
    const stored=JSON.parse(localStorage.getItem('hrPulse.localTrialWorkflow.v1:'+JSON.stringify([scope.owner,scope.company,scope.site]))!);
    expect(stored[0].outcome.trainer).toBe('Trial Form Trainer');
  });
  it('requires the Aadhaar and driving licence dates of birth to match',()=>{
    expect(sameDocumentBirthDate('2000-01-02','2000-01-02')).toBe(true);
    expect(sameDocumentBirthDate('02-01-2000','2000-01-02')).toBe(true);
    expect(sameDocumentBirthDate('02/01/2000','02.01.2000')).toBe(true);
    expect(sameDocumentBirthDate('2000-01-02','2001-03-04')).toBe(false);
    expect(sameDocumentBirthDate('','2000-01-02')).toBe(false);
    expect(sameDocumentBirthDate('unreadable','2000-01-02')).toBe(false);
  });
  it('copies and freezes Trial conducted by from the Part 1 Trial Form',async()=>{
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
    const request=vi.spyOn(window,'fetch').mockResolvedValue(Response.json(hierarchyTrainer));
    const {el,click,input,change}=setup();
    await waitFor(()=>expect(el('#v-aadhaar').hidden).toBe(false));
    click('[data-tab="hr"]');
    input('#f_name','Hierarchy Candidate');
    input('#f_mobile','9876543210');
    input('#f_conducted','Trial Form Trainer');
    click('input[name="f_vehicle"][value="Excavator"]');
    change('#d_dl','Yes');
    change('#d_medical','Yes');
    fireEvent.submit(el('#single'));
    change('#role','trainer');
    await waitFor(()=>expect(el('[aria-label="Hierarchy Candidate: Trial conducted by"]')).toHaveValue('Trial Form Trainer'));
    expect(el('[aria-label="Hierarchy Candidate: Trial conducted by"]')).toHaveAttribute('readonly');
    expect(el('[aria-label="Hierarchy Candidate: Trial conducted by"]')).toHaveClass('trainer-frozen');
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/\/telegram\/trial-trainer$/),expect.objectContaining({method:'POST'}));
  });
  it('scans Aadhaar with the signed-in session and fills only empty candidate fields',async()=>{
    const grant = 'a'.repeat(43);
    sessionStorage.setItem('hrPulseSession', JSON.stringify({grant}));
    const details = {
      name:'Sample Candidate', relationName:'Sample Parent', dob:'2000-01-02',
      uid:'234500000000', address:'Sample Address', gender:'',
    };
    const scan = vi.spyOn(window,'fetch')
      .mockResolvedValueOnce(Response.json(hierarchyTrainer))
      .mockResolvedValueOnce(Response.json({details}))
      .mockResolvedValueOnce(Response.json({matches:[]}))
      .mockResolvedValueOnce(Response.json({details:{name:'Different Name',dob:'2000-01-02',licenceNumber:'DL-123',classDetails:[
        {code:'HMV',issuedBy:'MH29',dateOfIssue:'2020-01-02',vehicleCategory:'TR',badgeNumber:'298/PSV/12',badgeIssuedDate:'2021-03-04',badgeIssuedBy:'MH29'},
        {code:'LMV',issuedBy:'MH29',dateOfIssue:'2020-02-03',vehicleCategory:'NT',badgeNumber:'',badgeIssuedDate:'',badgeIssuedBy:''},
      ],issueDate:'2020-01-02',validUpto:['2027-01-02','2030-01-02']}}));
    const {root,el,click,input,getByLabelText,getByRole,change} = setup();
    await waitFor(()=>expect(el('#v-aadhaar').hidden).toBe(false));
    click('[data-tab="hr"]');
    input('#f_name','Verified Name');
    click('[data-tab="aadhaar"]');
    const file = new File(['%PDF-1.7'],'sample-aadhaar.pdf',{type:'application/pdf'});
    fireEvent.click(getByRole('button',{name:'Upload A/D'}));
    fireEvent.click(getByRole('button',{name:'Upload Aadhaar Image'}));
    expect(getByRole('button',{name:'Camera'})).toBeEnabled();
    expect(getByRole('button',{name:'Gallery / Document'})).toBeEnabled();
    fireEvent.change(getByLabelText('Choose Aadhaar card from gallery'),{target:{files:[file]}});
    expect(getByRole('status')).toHaveTextContent('Reading image 1');
    expect(el('#aadhaarContinue')).toBeDisabled();
    await waitFor(()=>expect(getByRole('status')).toHaveTextContent('Aadhaar details filled'));
    expect(getByLabelText('Uploaded Aadhaar image 1 PDF preview')).toBeInTheDocument();
    expect(scan).toHaveBeenCalledWith(expect.stringMatching(/\/api\/aadhaar\/scan$/),expect.objectContaining({
      method:'POST',
      headers:{Authorization:'Bearer '+grant,'Content-Type':'application/json'},
    }));
    fireEvent.click(getByRole('button',{name:'Upload A/D'}));
    fireEvent.click(getByRole('button',{name:'Upload Front Driving License Image'}));
    expect(getByRole('button',{name:'Camera'})).toBeEnabled();
    expect(getByRole('button',{name:'Gallery / Document'})).toBeEnabled();
    expect(getByLabelText('Capture front driving licence image')).toHaveAttribute('capture','environment');
    const licenceImage=new File(['image-bytes'],'front.jpg',{type:'image/jpeg'});
    fireEvent.change(getByLabelText('Choose front driving licence image'),{target:{files:[licenceImage]}});
    await waitFor(()=>expect(document.querySelector('img[alt="Uploaded front driving licence preview"]')).toHaveAttribute('src',expect.stringMatching(/^blob:/)));
    expect(el('#aadhaarContinue')).toBeDisabled();
    fireEvent.change(getByLabelText('Choose front driving licence image'),{target:{files:[file]}});
    fireEvent.click(getByRole('button',{name:'Upload A/D'}));
    fireEvent.click(getByRole('button',{name:'Upload Back Driving License Image'}));
    expect(getByRole('button',{name:'Camera'})).toBeEnabled();
    expect(getByRole('button',{name:'Gallery / Document'})).toBeEnabled();
    expect(getByLabelText('Capture back driving licence image')).toHaveAttribute('capture','environment');
    fireEvent.change(getByLabelText('Choose back driving licence image'),{target:{files:[file]}});
    expect(getByLabelText('Uploaded front driving licence PDF preview')).toBeInTheDocument();
    expect(getByLabelText('Uploaded back driving licence PDF preview')).toBeInTheDocument();
    await waitFor(()=>expect(el('#f_dl')).toHaveValue('DL-123'));
    expect(el<HTMLInputElement>('[aria-label="Valid up to (TR)"]')).toHaveValue('2027-01-02');
    expect(el<HTMLInputElement>('[aria-label="Valid up to (NT)"]')).toHaveValue('2030-01-02');
    click('#aadhaarContinue');
    expect(el('#v-hr').hidden).toBe(false);
    expect(el('#v-aadhaar').hidden).toBe(true);
    expect(el('#f_name')).toHaveValue('Verified Name');
    expect(el('#f_father')).toHaveValue(details.relationName);
    expect(el('#f_dob')).toHaveValue(details.dob);
    expect(el('#f_aadhaar')).toHaveValue(details.uid);
    expect(el('#f_address')).toHaveValue(details.address);
    expect(el('#sSubmit')).toBeEnabled();
    expect(el('#aadhaarHistory')).not.toBeVisible();
    expect(localStorage.length).toBe(0);

    expect(el('#f_dl')).toHaveValue('DL-123');
    expect(el('#f_dlissue')).toHaveValue('2020-01-02');
    expect(root.querySelectorAll('[data-dl-class-row]')).toHaveLength(2);
    expect(el('[data-dl-class="code"]')).toHaveValue('HMV');
    expect(el('[data-dl-class="badgeNumber"]')).toHaveValue('298/PSV/12');
    expect([...root.querySelectorAll<HTMLInputElement>('[data-dl-valid]')].map(input=>input.value)).toEqual(['2027-01-02','2030-01-02']);
    click('[data-tab="aadhaar"]');
    expect(el('#f_aadhaar')).toHaveValue(details.uid);
    expect(el('#sSubmit')).toBeEnabled();
    click('#sReset');
    expect(getByLabelText('Choose front driving licence image')).toBeEnabled();
    expect(getByRole('button',{name:'Upload A/D'})).toBeEnabled();
    change('#role','trainer');
    expect(getByLabelText('Choose front driving licence image')).toBeDisabled();
  });

  it.each([
    {result:'PASS',className:'p-pass',equipment:'Excavator',site:'Jayant OB East',failureReason:''},
    {result:'FAIL',className:'p-fail',equipment:'Dozer',site:'Sasti OB',failureReason:'Unsafe handling'},
  ])('shows a $result popup immediately after uploading a matching Aadhaar',async match=>{
    const grant='a'.repeat(43);
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant}));
    const uid='234500000000';
    const fetch=vi.spyOn(window,'fetch')
      .mockResolvedValueOnce(Response.json(hierarchyTrainer))
      .mockResolvedValueOnce(Response.json({details:{uid,name:'Sample Candidate',relationName:'',dob:'',address:'',gender:''}}))
      .mockResolvedValueOnce(Response.json({matches:[match]}));
    const {el,click,getByLabelText}=setup();
    await waitFor(()=>expect(el('#v-aadhaar').hidden).toBe(false));
    const file=new File(['%PDF-1.7'],'sample-aadhaar.pdf',{type:'application/pdf'});
    fireEvent.change(getByLabelText('Choose Aadhaar card from gallery'),{target:{files:[file]}});
    await waitFor(()=>expect(el('#aadhaarHistory')).toBeVisible());
    const popup=el('#aadhaarHistory');
    expect(el('.aadhaar-history-result')).toHaveClass(match.className);
    expect(popup).toHaveTextContent(match.result);
    expect(popup).toHaveTextContent(match.equipment);
    expect(popup).toHaveTextContent(match.site);
    expect(popup).not.toHaveTextContent(uid);
    if(match.failureReason)expect(popup).toHaveTextContent(match.failureReason);
    else expect(popup).not.toHaveTextContent('Reason');
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/telegram\/trial-history$/),expect.objectContaining({
      method:'POST',body:JSON.stringify({aadhaar:uid}),
    }));
    click('#aadhaarHistoryClose');
    expect(popup).not.toBeVisible();
    expect(el('#aadhaarContinue')).toBeDisabled();
  });

  it('finds a past pass saved for the same account at another site',async()=>{
    const uid='234500000000';
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile:{actor:scope.owner,permissions:{application:'HR'}}}));
    const savedPass={id:'saved-pass',formNo:'TF/2026-27/0002',createdAt:'2026-10-18',history:[],docs:{},
      stage:'done',result:'PASS',aadhaar:uid,site:'Sasti OB',trialDate:'2026-10-18',vehicles:['Excavator']};
    const prefix='hrPulse.localTrialWorkflow.v1:';
    localStorage.setItem(prefix+JSON.stringify([scope.owner,scope.company,'Sasti OB']),JSON.stringify([savedPass]));
    localStorage.setItem(prefix+JSON.stringify(['another-owner',scope.company,'Majri OB']),JSON.stringify([
      {...savedPass,id:'unrelated-pass',site:'Majri OB',trialDate:'2026-11-10',vehicles:['Grader']},
    ]));
    vi.spyOn(window,'fetch')
      .mockResolvedValueOnce(Response.json(hierarchyTrainer))
      .mockResolvedValueOnce(Response.json({details:{uid,name:'Sample Candidate',relationName:'',dob:'',address:'',gender:''}}))
      .mockResolvedValueOnce(Response.json({matches:[{result:'FAIL',site:'Jayant OB East',equipment:'Dozer',trialDate:'2026-11-01'}]}));
    const {el,getByLabelText}=setup();
    await waitFor(()=>expect(el('#v-aadhaar').hidden).toBe(false));
    const file=new File(['%PDF-1.7'],'sample-aadhaar.pdf',{type:'application/pdf'});
    fireEvent.change(getByLabelText('Choose Aadhaar card from gallery'),{target:{files:[file]}});
    await waitFor(()=>expect(el('#aadhaarHistory')).toBeVisible());
    expect(el('#aadhaarHistoryResults')).toHaveTextContent('PASS');
    expect(el('#aadhaarHistoryResults')).toHaveTextContent('Excavator');
    expect(el('#aadhaarHistoryResults')).toHaveTextContent('Sasti OB');
    expect(el('#aadhaarHistoryResults')).not.toHaveTextContent('Majri OB');
  });

  it('imports Excel candidates and applies multiple scans without overwriting confirmed details',async()=>{
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
    const workbook=utils.book_new();
    utils.book_append_sheet(workbook,utils.aoa_to_sheet([
      ['Aadhaar No','Medical','Name','Mobile','DL valid','DL seen'],
      [234500000000,'Yes','Verified Candidate',9876543210,new Date('2027-11-21T00:00:00Z'),'Yes'],
    ]),'Candidates');
    const bytes=write(workbook,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
    const excel=new File([bytes],'sample.xlsx');
    Object.defineProperty(excel,'arrayBuffer',{value:async()=>bytes});
    const details={name:'Read Candidate',relationName:'Sample Parent',dob:'2000-01-02',uid:'234500000000',address:'Sample Address',gender:''};
    vi.spyOn(window,'fetch')
      .mockResolvedValueOnce(Response.json(hierarchyTrainer))
      .mockResolvedValueOnce(Response.json({details}))
      .mockResolvedValueOnce(Response.json({matches:[]}))
      .mockResolvedValueOnce(Response.json({details:{...details,uid:''}}))
      .mockResolvedValueOnce(Response.json({details:{...details,name:'New Candidate',uid:'234500000001'}}))
      .mockResolvedValueOnce(Response.json({matches:[{result:'FAIL',site:'Sasti OB',equipment:'Dozer',failureReason:'Unsafe handling'}]}));
    const {el,click,input,change}=setup();
    await waitFor(()=>expect(el('#v-aadhaar').hidden).toBe(false));
    click('[data-tab="hr"]');
    click('[data-m="bulk"]');
    fireEvent.change(el('#bExcelFile'),{target:{files:[excel]}});
    await waitFor(()=>expect(el('#bUploadStatus')).toHaveTextContent('1 candidate row imported'));
    expect(el('[aria-label="Row 1: DL valid"]')).toHaveValue('2027-11-21');
    expect(el('[aria-label="Row 1: Mobile"]')).toHaveValue('9876543210');
    expect(el('[aria-label="Row 1: Medical seen"]')).toBeChecked();

    const scans=['matched.pdf','masked.pdf','new.pdf'].map(name=>new File(['%PDF-1.7'],name,{type:'application/pdf'}));
    fireEvent.change(el('#bScanFiles'),{target:{files:scans}});
    expect(el('#bSubmit')).toBeDisabled();
    await waitFor(()=>expect(el('#bUploadStatus')).toHaveTextContent('2 of 3 Aadhaar scans applied'));
    expect(el('#aadhaarHistory')).toHaveTextContent('Scan 3: FAIL');
    expect(el('#aadhaarHistory')).toHaveTextContent('Unsafe handling');
    click('#aadhaarHistoryClose');
    expect(el('#bUploadIssues')).toHaveTextContent('masked.pdf');
    expect(el('[aria-label="Row 1: Name"]')).toHaveValue('Verified Candidate');
    expect(el('[aria-label="Row 1: Date of birth"]')).toHaveValue('2000-01-02');
    expect(el('[aria-label="Row 1: Address"]')).toHaveValue('Sample Address');
    expect(el('[aria-label="Row 1: Aadhaar seen"]')).not.toBeChecked();
    expect(el('[aria-label="Row 2: Name"]')).toHaveValue('New Candidate');
    input('[aria-label="Row 2: Mobile"]','9876543211');
    click('[aria-label="Row 2: DL seen"]');
    click('[aria-label="Row 2: Medical seen"]');
    click('#bSubmit');
    change('#role','trainer');
    expect(el('#trList')).toHaveTextContent('Verified Candidate');
    expect(el('#trList')).toHaveTextContent('New Candidate');
  });

  it('checks documents and keeps a trial result attachment through approval and reload',async()=>{
    const network = vi.spyOn(window,'fetch').mockRejectedValue(new Error('Network is disabled in the preview'));
    const saved = new Map<string,File>();
    const file = new File(['%PDF-1.7'],'signed-result.pdf',{type:'application/pdf'});
    const video = new File(['video'],'driving-trial.mp4',{type:'video/mp4'});
    vi.spyOn(trialResultFiles,'saveTrialResultFiles')
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockImplementation(async attachments=>{for (const attachment of attachments) saved.set(attachment.id,attachment.file);});
    vi.spyOn(trialResultFiles,'getTrialResultFile').mockImplementation(async id=>saved.get(id));
    const createUrl = vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:trial-result');
    vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    const download = vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    const openJoining=vi.fn();
    const onCleared=vi.fn(async (_rows: Trial[])=>openJoining);
    const {el,click,input,change} = setup({},onCleared);
    change('#role','trainer');
    expect(el('#trList')).toHaveTextContent('Submit a candidate in Part 1');
    expect(el('#trList [aria-label="PASS"]')).toBeDisabled();
    expect(el('#trList [aria-label="Trial conducted by"]')).toHaveAttribute('readonly');
    expect(el('#trList [data-choose-result-file]')).toBeDisabled();
    expect(el('#trList [data-choose-driving-video]')).toBeDisabled();
    change('#role','hr');
    click('[data-tab="overview"]');
    click('[data-go="hr"]');
    input('#f_name','Sample Pass');
    input('#f_mobile','9876543210');
    input('#f_conducted','Trial Form Trainer');
    click('input[name="f_vehicle"][value="Excavator"]');
    change('#d_dl','Yes');
    fireEvent.submit(el('#single'));
    expect(el('#toast').textContent).toContain('medical fitness certificate');
    expect(el('#bTrainer').hidden).toBe(true);
    change('#d_medical','Yes');
    fireEvent.submit(el('#single'));
    expect(el('#bTrainer')).toHaveTextContent('1');

    change('#role','director');
    expect(el('#apList').textContent).toContain('Nothing waiting for Director');
    change('#role','trainer');
    expect(el('[aria-label="Sample Pass: Trial conducted by"]')).toHaveAttribute('readonly');
    expect(el('[aria-label="Sample Pass: Trial conducted by"]')).toHaveValue('Trial Form Trainer');
    expect(el('[aria-label="Sample Pass: Trial conducted by"]')).toHaveClass('trainer-frozen');
    expect(el('[aria-label="Sample Pass: Upload trial result"]')).toBeEnabled();
    expect(el('[aria-label="Sample Pass: Upload Driving Video"]')).toBeEnabled();
    expect(el('.trial-upload-actions')).toContainElement(el('[aria-label="Sample Pass: Upload trial result"]'));
    expect(el('.trial-upload-actions')).toContainElement(el('[aria-label="Sample Pass: Upload Driving Video"]'));
    click('[aria-label="Sample Pass: PASS"]');
    click('#trSubmit');
    expect(el('#toast')).toHaveTextContent('Upload the trial result file for Sample Pass');
    fireEvent.change(el('[data-result-file]'),{target:{files:[file]}});
    click('#trSubmit');
    expect(el('#toast')).toHaveTextContent('Upload the driving video for Sample Pass');
    fireEvent.change(el('[data-driving-video]'),{target:{files:[video]}});
    expect(el('#trList')).toHaveTextContent(file.name);
    await waitFor(()=>expect(el('#trList')).toHaveTextContent(video.name));
    click('[aria-label="Sample Pass: Recommend Operator"]');
    input('[aria-label="Sample Pass: Machine"]','Sample excavator');
    input('[aria-label="Sample Pass: Examiner remarks"]','Completed the inspection');
    click('#trSubmit');
    expect(el('#trSubmit')).toBeDisabled();
    await waitFor(()=>expect(el('#toast')).toHaveTextContent('Could not save the trial result files'));
    expect(el('#trList')).toHaveTextContent(file.name);
    expect(el('#trList')).toHaveTextContent(video.name);
    expect(el('#bTrainer')).toHaveTextContent('1');
    click('#trSubmit');
    await waitFor(()=>expect(el('#toast')).toHaveTextContent('results sent to PM'));
    // The trainer who submitted never gets the Telegram message popup; it goes to the assigned PM.
    expect(el('#tgpop').hidden).toBe(true);
    expect(onCleared).not.toHaveBeenCalled();
    for (const role of ['pm','ohr','rhr','director']) {
      change('#role',role);
      expect(el('#apList').textContent).toContain('Sample Pass');
      click('#apAll');
      click('#apApprove');
    }
    // No approver gets the popup either; Site HR opens Step 2 from All candidates.
    expect(el('#tgpop').hidden).toBe(true);
    expect(onCleared).not.toHaveBeenCalled();
    change('#role','hr');
    click('[data-tab="overview"]');
    click('[data-join-trial]');
    await waitFor(()=>expect(onCleared).toHaveBeenCalledWith([expect.objectContaining({stage:'done',result:'PASS',name:'Sample Pass'})],expect.objectContaining({aadhaar:undefined,drivingLicence:undefined})));
    await waitFor(()=>expect(openJoining).toHaveBeenCalledOnce());
    click('[data-stage="done"]');
    expect(el('#ovTitle')).toHaveTextContent('Completed (1)');
    expect(el('#ovList').textContent).toContain('Cleared to join');
    click('#ovList [data-open]');
    expect(el('#modalBox').textContent).toContain('Approvals');
    expect(el('#modalBox').textContent).toContain('Operator – Sample excavator');
    expect(el('#modalBox').textContent).toContain('Sample Signer');
    expect(el('#modalBox').textContent).toContain('Completed the inspection');
    expect(el('#modalBox .sigs').textContent).toContain('DirectorApproved');
    const next = setup();
    next.click('[data-tab="overview"]');
    expect(next.el('#ovList').textContent).toContain('Cleared to join');
    next.click('#ovList [data-open]');
    expect(next.el('[data-download-result]')).toHaveTextContent('Download signed-result.pdf');
    expect(next.el('[data-download-driving-video]')).toHaveTextContent('Download driving-trial.mp4');
    next.click('[data-download-result]');
    next.click('[data-download-driving-video]');
    await waitFor(()=>expect(download).toHaveBeenCalledTimes(2));
    expect(createUrl).toHaveBeenCalledWith(file);
    expect(createUrl).toHaveBeenCalledWith(video);
    expect((download.mock.contexts[0] as HTMLAnchorElement).download).toBe(file.name);
    expect((download.mock.contexts[1] as HTMLAnchorElement).download).toBe(video.name);
    const other = setup({site:'Another site'});
    other.click('[data-tab="overview"]');
    expect(other.el('#ovList').textContent).toContain('No trial forms yet');
    expect(network).not.toHaveBeenCalled();
  });

  it('submits a bulk batch, requires a reason for FAIL and records a rejection note',async()=>{
    vi.spyOn(trialResultFiles,'saveTrialResultFiles').mockResolvedValue();
    const {el,click,input,change} = setup();
    click('[data-tab="hr"]');
    click('[data-m="bulk"]');
    input('#b_paste','Batch Candidate\t\t9876543211\t\tDL Class\t21-11-2027\t4\nSecond Candidate\t\t9876543212');
    click('#b_pasteBtn');
    expect(el<HTMLInputElement>('[aria-label="Row 1: DL valid"]').value).toBe('2027-11-21');
    click('#bSubmit');
    expect(el('#toast').textContent).toContain('medical fitness certificate');
    for (const i of [1,2]) {
      click(`[aria-label="Row ${i}: DL seen"]`);
      click(`[aria-label="Row ${i}: Medical seen"]`);
    }
    click('#bSubmit');
    expect(el('#bTrainer')).toHaveTextContent('2');

    change('#role','trainer');
    click('[aria-label="Batch Candidate: FAIL"]');
    expect(el('[aria-label="Batch Candidate: Failure reason"]')).toBeRequired();
    click('#trSubmit');
    expect(el('#toast').textContent).toContain('Enter the fail reason');
    input('[aria-label="Batch Candidate: Failure reason"]','Did not complete trial safely');
    const batchCard=el('[aria-label="Batch Candidate: Upload trial result"]').closest<HTMLElement>('[data-id]')!;
    fireEvent.click(batchCard.querySelector('[data-choose-result-file]')!);
    fireEvent.change(el('#trResultPicker'),{target:{files:[new File(['result'],'batch-result.pdf',{type:'application/pdf'})]}});
    const refreshedCard=el('[aria-label="Batch Candidate: Upload Driving Video"]').closest<HTMLElement>('[data-id]')!;
    fireEvent.click(refreshedCard.querySelector('[data-choose-driving-video]')!);
    fireEvent.change(el('#trVideoPicker'),{target:{files:[new File(['video'],'batch-driving.mp4',{type:'video/mp4'})]}});
    await waitFor(()=>expect(el('#trList')).toHaveTextContent('batch-driving.mp4'));
    click('#trSubmit');
    await waitFor(()=>expect(el('#bTrainer')).toHaveTextContent('1'));
    expect(el('#tgpop').hidden).toBe(true);
    change('#role','pm');
    click('[aria-label="Select Batch Candidate"]');
    click('#apReject');
    expect(el('#toast').textContent).toContain('explain the rejection');
    input('#apNote','Review again after re-training');
    click('#apReject');
    change('#role','hr');
    click('[data-tab="overview"]');
    expect(el('#ovList').textContent).toContain('Rejected');
    click('#ovList [data-open]');
    expect(el('#modalBox').textContent).toContain('Review again after re-training');
    expect(el('#modalBox').textContent).toContain('Did not complete trial safely');
    expect(el('#modalBox').textContent).not.toContain('Re-trial');
    expect(el('#modalBox').textContent).not.toContain('Cleared to join');
  });
});

describe('OTP approval and several Driver Trainers (owner, 20 Nov 2026)',()=>{
  const signedIn=()=>sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
  const passed=()=>reviewTrial({id:'otp-trial',formNo:'TF/2026-27/0042',site:scope.site,resultAt:'2026-11-19T12:00:00Z',
    fields:{Result:'PASS','Name of candidate':'Otp Candidate','Mobile no.':'9876543210'}})!;
  it('PM cannot approve directly; Office HR requests the PM OTP, enters it and the form moves to Office HR',async()=>{
    signedIn();
    const request=vi.spyOn(window,'fetch').mockImplementation(async url=>{
      const path=String(url);
      if(path.endsWith('/trial-otp'))return Response.json({expires:'2026-11-20T12:15:00Z',sentTo:['gulnawaz'],telegram:{message:'',recipients:1,connected:['gulnawaz']}});
      if(path.endsWith('/trial-otp-verify'))return Response.json({approved:true,at:'2026-11-20T12:05:00Z',by:'PM Sir (OTP entered by Sample Signer)',stage:'ohr',rows:[],telegram:{message:'',recipients:1,connected:['apurvakopulwar']}});
      return Response.json({...hierarchyTrainer,roles:['pm','ohr']});
    });
    vi.mocked(telegramSend.fetchReviewQueue).mockResolvedValueOnce([passed()]);
    const {el,click,input,change}=setup();
    await waitFor(()=>expect(el('#apList')).toHaveTextContent('Otp Candidate'));
    change('#role','pm');
    click('#apAll');
    expect(el('#apApprove')).toBeDisabled();
    expect(el('#apRoleWarn')).toHaveTextContent('You approve by OTP');
    change('#role','ohr');
    expect(el('#apList .otp-panel')).toHaveTextContent('Otp Candidate');
    click('[data-otp-request]');
    await waitFor(()=>expect(el('[data-otp-code]')).toBeInTheDocument());
    const sent=request.mock.calls.find(([url])=>String(url).endsWith('/trial-otp'));
    expect(JSON.parse(String(sent![1]?.body))).toMatchObject({reviewer:'pm',formNos:['TF/2026-27/0042'],site:scope.site});
    input('[data-otp-code]','482913');
    click('[data-otp-verify]');
    await waitFor(()=>expect(root(el).querySelector('#apList .otp-panel')).toBeNull());
    expect(el('#apList')).toHaveTextContent('Otp Candidate');
    const verify=request.mock.calls.find(([url])=>String(url).endsWith('/trial-otp-verify'));
    expect(JSON.parse(String(verify![1]?.body))).toMatchObject({reviewer:'pm',otp:'482913'});
  });
  it('a site with three Driver Trainers ticks Yes / No for each; one No makes it FAIL',async()=>{
    signedIn();
    const trainers=[{actor:'t1',name:'Rakesh Singh'},{actor:'t2',name:'Mahesh Patel'},{actor:'t3',name:'Imran Khan'}];
    vi.spyOn(window,'fetch').mockImplementation(async url=>Response.json(String(url).endsWith('/trial-trainer')?{...hierarchyTrainer,trainers}:{batchId:'',formNos:[],telegram:{message:'',recipients:1,connected:[]}}));
    const {el,click,input,change}=setup();
    await waitFor(()=>expect(el('#v-aadhaar').hidden).toBe(false));
    click('[data-tab="hr"]');
    input('#f_name','Vote Candidate');
    input('#f_mobile','9876543210');
    click('input[name="f_vehicle"][value="Excavator"]');
    change('#d_dl','Yes');
    change('#d_medical','Yes');
    fireEvent.submit(el('#single'));
    change('#role','trainer');
    await waitFor(()=>expect(el('[aria-label="Vote Candidate: Trainer votes"]')).toBeInTheDocument());
    expect(el('#trList').querySelector('[aria-label="Vote Candidate: PASS"]')).toBeNull();
    click('[aria-label="Vote Candidate: Yes from Rakesh Singh"]');
    click('[aria-label="Vote Candidate: Yes from Mahesh Patel"]');
    expect(el('.vote-result')).toHaveTextContent('1 left');
    click('[aria-label="Vote Candidate: No from Imran Khan"]');
    expect(el('.vote-result')).toHaveTextContent('FAIL – No from Imran Khan');
    click('[aria-label="Vote Candidate: Yes from Imran Khan"]');
    expect(el('.vote-result')).toHaveTextContent('PASS – every trainer said Yes');
  });
});
function root(el:(selector:string)=>HTMLElement){return el('#apList').getRootNode() as ShadowRoot;}

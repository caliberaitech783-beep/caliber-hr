import {afterEach, describe, expect, it, vi} from 'vitest';
import {fireEvent,waitFor} from '@testing-library/react';
import {mountTrialPreview} from './mount';

const scope = {company:'CMLL',site:'Jayant OB East',name:'Sample Signer',owner:'sample',department:'Driver'};
let dispose: (()=>void)|undefined;
function setup(overrides: Partial<typeof scope> = {}) {
  dispose?.();
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const root = host.attachShadow({mode:'open'});
  dispose = mountTrialPreview(root,{...scope,...overrides});
  const el = <T extends HTMLElement=HTMLElement>(selector: string) => {
    const node=root.querySelector<T>(selector);
    if (!node) throw new Error('Missing element: '+selector);
    return node;
  };
  const click = (selector: string) => el<HTMLElement>(selector).click();
  const input = (selector: string, value: string) => fireEvent.input(el(selector),{target:{value}});
  const change = (selector: string,value: string) => fireEvent.change(el(selector),{target:{value}});
  return {root,el,click,input,change};
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
  it('scans Aadhaar with the signed-in session and fills only empty candidate fields',async()=>{
    const grant = 'a'.repeat(43);
    sessionStorage.setItem('hrPulseSession', JSON.stringify({grant}));
    const details = {
      name:'Sample Candidate', relationName:'Sample Parent', dob:'2000-01-02',
      uid:'234500000000', address:'Sample Address', gender:'',
    };
    const scan = vi.spyOn(window,'fetch')
      .mockResolvedValueOnce(Response.json({details}))
      .mockResolvedValueOnce(Response.json({error:'The card could not be read.'}, {status:422}));
    const {el,click,input} = setup();
    click('[data-tab="hr"]');
    input('#f_name','Verified Name');
    click('[data-tab="aadhaar"]');
    const file = new File(['%PDF-1.7'],'sample-aadhaar.pdf',{type:'application/pdf'});
    fireEvent.change(el('#aadhaarFile'),{target:{files:[file]}});
    expect(el('#aadhaarScanStatus')).toHaveTextContent('Scanning Aadhaar');
    expect(el('#aadhaarContinue')).toBeDisabled();
    await waitFor(()=>expect(el('#aadhaarScanStatus')).toHaveTextContent('Aadhaar details filled'));
    expect(scan).toHaveBeenCalledWith(expect.stringMatching(/\/api\/aadhaar\/scan$/),expect.objectContaining({
      method:'POST',
      headers:{Authorization:'Bearer '+grant,'Content-Type':'application/json'},
    }));
    click('#aadhaarContinue');
    expect(el('#v-hr').hidden).toBe(false);
    expect(el('#v-aadhaar').hidden).toBe(true);
    expect(el('#f_name')).toHaveValue('Verified Name');
    expect(el('#f_father')).toHaveValue(details.relationName);
    expect(el('#f_dob')).toHaveValue(details.dob);
    expect(el('#f_aadhaar')).toHaveValue(details.uid);
    expect(el('#f_address')).toHaveValue(details.address);
    expect(el('#sSubmit')).toBeEnabled();
    expect(localStorage.length).toBe(0);

    click('[data-tab="aadhaar"]');
    fireEvent.change(el('#aadhaarFile'),{target:{files:[file]}});
    await waitFor(()=>expect(el('#aadhaarScanStatus')).toHaveTextContent('The card could not be read.'));
    expect(el('#f_aadhaar')).toHaveValue(details.uid);
    expect(el('#sSubmit')).toBeEnabled();
  });

  it('checks documents, moves a single PASS through each approval, and persists the final status without calling HR or Telegram',()=>{
    const network = vi.spyOn(window,'fetch').mockRejectedValue(new Error('Network is disabled in the preview'));
    const {el,click,input,change} = setup();
    click('[data-tab="overview"]');
    click('[data-go="hr"]');
    input('#f_name','Sample Pass');
    input('#f_mobile','9876543210');
    click('input[name="f_vehicle"][value="Excavator"]');
    change('#d_dl','Yes');
    fireEvent.submit(el('#single'));
    expect(el('#toast').textContent).toContain('medical fitness certificate');
    expect(el('[data-stage="trainer"] .n').textContent).toBe('0');
    change('#d_medical','Yes');
    fireEvent.submit(el('#single'));
    expect(el('[data-stage="trainer"] .n').textContent).toBe('1');

    change('#role','director');
    expect(el('#apList').textContent).toContain('Nothing waiting for Director');
    change('#role','trainer');
    click('#trAllPass');
    click('#trSubmit');
    expect(el('#tgpop').textContent).toContain('Sent to PM for approval');
    expect(el('#tgpop').textContent).not.toContain('CLEARED TO JOIN');
    click('#tgClose2');
    for (const [role,next] of [['pm','rhr'],['rhr','director'],['director','done']]) {
      change('#role',role);
      click('#apAll');
      click('#apApprove');
      expect(el(`[data-stage="${next}"] .n`).textContent).toBe('1');
    }
    expect(el('#tgpop').textContent).toContain('CLEARED TO JOIN');
    click('#tgClose2');
    click('[data-stage="done"]');
    expect(el('#ovList').textContent).toContain('Cleared to join');
    click('#ovList [data-open]');
    expect(el('#modalBox').textContent).toContain('Approvals');
    expect(el('#modalBox .sigs').textContent).toContain('DirectorApproved');
    const next = setup();
    next.click('[data-tab="overview"]');
    expect(next.el('#ovList').textContent).toContain('Cleared to join');
    const other = setup({site:'Another site'});
    other.click('[data-tab="overview"]');
    expect(other.el('#ovList').textContent).toContain('No trial forms yet');
    expect(network).not.toHaveBeenCalled();
  });

  it('submits a bulk batch, requires a reason for FAIL and records a rejection note',()=>{
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
    expect(el('[data-stage="trainer"] .n').textContent).toBe('2');

    change('#role','trainer');
    click('[aria-label="Batch Candidate: FAIL"]');
    click('#trSubmit');
    expect(el('#toast').textContent).toContain('Enter the fail reason');
    input('[aria-label="Batch Candidate: Failure reason"]','Did not complete trial safely');
    click('#trSubmit');
    expect(el('[data-stage="trainer"] .n').textContent).toBe('1');
    expect(el('#tgpop').hidden).toBe(true);
    change('#role','pm');
    click('[aria-label="Select Batch Candidate"]');
    click('#apReject');
    expect(el('#toast').textContent).toContain('explain the rejection');
    input('#apNote','Review again after re-training');
    click('#apReject');
    click('[data-stage="rejected"]');
    expect(el('#ovList').textContent).toContain('Rejected');
    click('#ovList [data-open]');
    expect(el('#modalBox').textContent).toContain('Review again after re-training');
    expect(el('#modalBox').textContent).toContain('Did not complete trial safely');
    expect(el('#modalBox').textContent).not.toContain('Cleared to join');
  });
});

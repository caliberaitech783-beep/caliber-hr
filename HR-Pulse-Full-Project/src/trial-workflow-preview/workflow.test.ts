import {afterEach, describe, expect, it, vi} from 'vitest';
import {act,fireEvent,render,waitFor} from '@testing-library/react';
import {createElement} from 'react';
import TrialWorkflowPreview from './TrialWorkflowPreview';

const scope = {company:'CMLL',site:'Jayant OB East',name:'Sample Signer',owner:'sample',department:'Driver'};
let dispose: (()=>void)|undefined;
function setup(overrides: Partial<typeof scope> = {}) {
  dispose?.();
  const {container,unmount,getByLabelText,getByRole} = render(createElement(TrialWorkflowPreview,{...scope,...overrides}));
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
    const {el,click,input,getByLabelText,getByRole,change} = setup();
    click('[data-tab="hr"]');
    input('#f_name','Verified Name');
    click('[data-tab="aadhaar"]');
    const file = new File(['%PDF-1.7'],'sample-aadhaar.pdf',{type:'application/pdf'});
    fireEvent.click(getByRole('button',{name:'Upload Aadhaar Image 1'}));
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
    fireEvent.change(getByLabelText('Choose second Aadhaar image'),{target:{files:[file]}});
    await waitFor(()=>expect(getByRole('status')).toHaveTextContent('The card could not be read.'));
    expect(getByLabelText('Uploaded Aadhaar image 1 PDF preview')).toBeInTheDocument();
    expect(getByLabelText('Uploaded Aadhaar image 2 PDF preview')).toBeInTheDocument();
    fireEvent.click(getByRole('button',{name:'Remove Image 2'}));
    expect(getByRole('status')).toHaveTextContent('Aadhaar image 2 removed');
    expect(el('#f_aadhaar')).toHaveValue(details.uid);
    expect(el('#sSubmit')).toBeEnabled();
    click('#sReset');
    expect(getByLabelText('Choose second Aadhaar image')).toBeEnabled();
    expect(getByRole('button',{name:'Upload Aadhaar Image 1'})).toBeEnabled();
    change('#role','trainer');
    expect(getByLabelText('Choose second Aadhaar image')).toBeDisabled();
  });

  it('checks documents, moves a single PASS through each approval, and persists the final status without calling HR or Telegram',()=>{
    const network = vi.spyOn(window,'fetch').mockRejectedValue(new Error('Network is disabled in the preview'));
    const {el,click,input,change} = setup();
    change('#role','trainer');
    expect(el('#trList')).toHaveTextContent('Submit a candidate in Part 1');
    expect(el('#trList [aria-label="PASS"]')).toBeDisabled();
    expect(el('#trList [aria-label="Trial conducted by"]')).toBeDisabled();
    change('#role','hr');
    click('[data-tab="overview"]');
    click('[data-go="hr"]');
    input('#f_name','Sample Pass');
    input('#f_mobile','9876543210');
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
    expect(el('[aria-label="Sample Pass: Trial conducted by"]')).toBeEnabled();
    click('#trAllPass');
    click('[aria-label="Sample Pass: Recommend Operator"]');
    input('[aria-label="Sample Pass: Machine"]','Sample excavator');
    input('[aria-label="Sample Pass: Trial conducted by"]','Sample Trainer');
    input('[aria-label="Sample Pass: Examiner remarks"]','Completed the inspection');
    click('#trSubmit');
    expect(el('#tgpop').textContent).toContain('Sent to PM for approval');
    expect(el('#tgpop').textContent).not.toContain('CLEARED TO JOIN');
    click('#tgClose2');
    for (const role of ['pm','rhr','director']) {
      change('#role',role);
      expect(el('#apList').textContent).toContain('Sample Pass');
      click('#apAll');
      click('#apApprove');
    }
    expect(el('#tgpop').textContent).toContain('CLEARED TO JOIN');
    click('#tgClose2');
    click('[data-stage="done"]');
    expect(el('#ovTitle')).toHaveTextContent('Completed (1)');
    expect(el('#ovList').textContent).toContain('Cleared to join');
    click('#ovList [data-open]');
    expect(el('#modalBox').textContent).toContain('Approvals');
    expect(el('#modalBox').textContent).toContain('Operator – Sample excavator');
    expect(el('#modalBox').textContent).toContain('Sample Trainer');
    expect(el('#modalBox').textContent).toContain('Completed the inspection');
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
    expect(el('#bTrainer')).toHaveTextContent('2');

    change('#role','trainer');
    click('[aria-label="Batch Candidate: FAIL"]');
    click('#trSubmit');
    expect(el('#toast').textContent).toContain('Enter the fail reason');
    input('[aria-label="Batch Candidate: Failure reason"]','Did not complete trial safely');
    click('#trSubmit');
    expect(el('#bTrainer')).toHaveTextContent('1');
    expect(el('#tgpop').hidden).toBe(true);
    change('#role','pm');
    click('[aria-label="Select Batch Candidate"]');
    click('#apReject');
    expect(el('#toast').textContent).toContain('explain the rejection');
    input('#apNote','Review again after re-training');
    click('#apReject');
    click('[data-tab="overview"]');
    expect(el('#ovList').textContent).toContain('Rejected');
    click('#ovList [data-open]');
    expect(el('#modalBox').textContent).toContain('Review again after re-training');
    expect(el('#modalBox').textContent).toContain('Did not complete trial safely');
    expect(el('#modalBox').textContent).not.toContain('Re-trial');
    expect(el('#modalBox').textContent).not.toContain('Cleared to join');
  });
});

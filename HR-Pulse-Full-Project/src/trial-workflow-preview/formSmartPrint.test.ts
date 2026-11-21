import {afterEach, describe, expect, it, vi} from 'vitest';
import ExcelJS from 'exceljs';
import {reviewTrial} from './reviewQueue';
import {detailView} from './views';
import {availableSections, FORM_PAGE_SIZES, formWorkbook, nextLayout, normalizePageRanges, normalizePrintOptions, openFormSmartPrint,
  pageBreaks, pdfFromPages, printSheetHtml, selectedPages, layoutStorageKey} from './formSmartPrint';

/* Owner, 21 Nov 2026: Smart Print on the vehicle trial form, with every feature of Pulse's Smart Print. */
const trial=()=>reviewTrial({id:'t1',formNo:'TF/2026-27/0019',site:'Jayant OB East',resultAt:'2026-11-21T06:51:00Z',
  fields:{'Name of candidate':'Avinash Thakur',"Father's name":'Budhi Singh','Mobile no.':'9285197208',Result:'PASS','Trial conducted by':'PARSURAM YADAV','Referred by':'AMIT SINGH'},
  history:[{role:'pm',action:'Approved',by:'Pm Name',at:'2026-11-21T07:00:00Z',note:'Good driver'}]})!;

afterEach(()=>{document.body.replaceChildren();localStorage.clear();sessionStorage.clear();vi.restoreAllMocks();});

describe('trial form Smart Print',()=>{
  it('the form window has a Smart Print button',()=>{
    expect(detailView(trial(),'hr')).toContain('id="mSmartPrint"');
  });
  it('prints the same values as the form, only the ticked sections',()=>{
    const row=trial();
    const all=printSheetHtml(row,availableSections(row).map(section=>section.id));
    for(const text of ['Avinash Thakur','TF/2026-27/0019','Budhi Singh','PARSURAM YADAV','Document check','Approvals','Good driver'])expect(all).toContain(text);
    const some=printSheetHtml(row,['result']);
    expect(some).toContain('PARSURAM YADAV');
    expect(some).not.toContain('Budhi Singh');
    expect(some).not.toContain('Document check');
  });
  it('offers approval notes only when the form has one',()=>{
    expect(availableSections(trial()).map(section=>section.id)).toContain('notes');
    expect(availableSections({...trial(),history:[]}).map(section=>section.id)).not.toContain('notes');
  });
  it('checks pages, sides and copies like Pulse',()=>{
    expect(normalizePageRanges(' 1-3, 5 ')).toBe('1-3,5');
    expect(()=>normalizePageRanges('3-1')).toThrow();
    expect(()=>normalizePageRanges('a')).toThrow();
    expect(normalizePrintOptions({copies:250,duplex:'long-edge'})).toEqual({pages:'',duplex:'long-edge',copies:99});
    expect(normalizePrintOptions({copies:0,duplex:'x'})).toEqual({pages:'',duplex:'one-sided',copies:1});
    expect(selectedPages('2-9',3)).toEqual([2,3]);
    expect(selectedPages('',2)).toEqual([1,2]);
  });
  it('never cuts a line in half and keeps a section bar with the line under it',()=>{
    const blocks=[{top:0,bottom:40},{top:40,bottom:60,bar:true},{top:60,bottom:110},{top:110,bottom:150}];
    // The line at 60-110 does not fit page 1, so page 1 ends before its section bar (40), not at 60.
    expect(pageBreaks(blocks,150,100)).toEqual([[0,40],[40,110],[110,150]]);
  });
  it('names saved layouts and refuses duplicates',()=>{
    const first=nextLayout([],['details','result'],'  Short form ');
    expect(first).toEqual({number:1,name:'Short form',sections:['details','result']});
    expect(()=>nextLayout([first],['details'],'short FORM')).toThrow(/already exists/);
    expect(()=>nextLayout([first],[],'Empty')).toThrow();
  });
  it('builds a PDF with one page per image at the chosen paper size',async()=>{
    const blob=pdfFromPages([{bytes:new Uint8Array([255,216,255,217]),width:10,height:10,heightPx:100}],FORM_PAGE_SIZES[0]);
    const text=await blob.text();
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 1');
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
  });
  it('exports the ticked sections to Excel',async()=>{
    const blob=await formWorkbook(trial(),['details','result']);
    const book=new ExcelJS.Workbook();
    await book.xlsx.load(await blob.arrayBuffer());
    const values=book.worksheets[0].getSheetValues().flat().map(String).join(' ');
    expect(values).toContain('Budhi Singh');
    expect(values).toContain('PARSURAM YADAV');
    expect(values).not.toContain('Document check'.toUpperCase());
  });
  it('dialog: section ticks, saved layouts, page size then print options, export choice',async()=>{
    sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile:{name:'Site Hr',login:'sitehr'}}));
    const print=vi.fn(async()=>{}),exportExcel=vi.fn(async()=>{}),exportPdf=vi.fn(async()=>{});
    const host=document.createElement('div');document.body.append(host);
    const {dialog}=openFormSmartPrint(host,trial(),{print,exportExcel,exportPdf});
    const q=<T extends HTMLElement>(selector: string)=>dialog.querySelector<T>(selector)!;
    const byText=(text: string)=>[...dialog.querySelectorAll('button')].find(node=>node.textContent===text)!;
    expect(dialog.textContent).toContain('6 of 6 sections');
    q<HTMLInputElement>('input[data-section="documents"]').click();
    expect(dialog.textContent).toContain('5 of 6 sections');
    expect(q('.smart-print-paper').textContent).not.toContain('Document check');
    vi.spyOn(window,'prompt').mockReturnValue('No documents');
    byText('Save as new layout').click();
    expect(JSON.parse(localStorage.getItem(layoutStorageKey('sitehr'))!)[0]).toMatchObject({name:'No documents'});
    expect(q<HTMLSelectElement>('select').selectedOptions[0].textContent).toBe('No documents');
    byText('Print saved layout').click();
    byText('A3 · 297 × 420 mm portrait').click();
    expect(dialog.textContent).toContain('Print options · A3');
    const copies=q<HTMLInputElement>('input[aria-label="Copies"]');
    copies.value='2';copies.dispatchEvent(new Event('input'));
    byText('Print now').click();
    await vi.waitFor(()=>expect(print).toHaveBeenCalled());
    const [, sections, page, options]=print.mock.calls[0] as unknown as [unknown,string[],{name:string},{copies:number}];
    expect(sections).not.toContain('documents');
    expect(page.name).toBe('A3');
    expect(options.copies).toBe(2);
    byText('Print/Export').click();
    byText('Excel (.xlsx)').click();
    await vi.waitFor(()=>expect(exportExcel).toHaveBeenCalled());
    byText('Print/Export').click();
    byText('PDF').click();
    byText('A4 · 210 × 297 mm portrait').click();
    await vi.waitFor(()=>expect(exportPdf).toHaveBeenCalled());
    vi.spyOn(window,'confirm').mockReturnValue(true);
    byText('Delete saved layout').click();
    expect(JSON.parse(localStorage.getItem(layoutStorageKey('sitehr'))!)).toEqual([]);
    dialog.querySelector<HTMLButtonElement>('[aria-label="Close Smart Print"]')!.click();
    expect(dialog.isConnected).toBe(false);
  });
});

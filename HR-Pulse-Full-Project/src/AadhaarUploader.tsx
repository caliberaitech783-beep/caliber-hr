import {useEffect, useRef, useState, type ChangeEvent} from 'react';
import {Camera, Images, Trash2, Upload, X, ZoomIn} from 'lucide-react';
import {savedSession} from './api';
import {readGeminiAadhaar, type AadhaarDetails} from './geminiOcr';

import { combineAadhaarSides } from './trial-workflow-preview/combineAadhaarSides';

type Props = {
  combineSides?: boolean;
  singleDocument?: boolean;
  photo?: File;
  photo2?: File;
  onPhoto?: (file?: File) => void;
  onPhoto2?: (file?: File) => void;
  fillDetails: (details: AadhaarDetails, slot: 1 | 2) => string;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
  showScanInstructions?: boolean;
  primaryButtonLabel?: string;
  secondaryDocumentLabel?: string;
  hideSecond?: boolean;
  hidePrimary?: boolean;
  openMenu?: boolean;
  onMenuChange?: (open: boolean) => void;
};

const imageTypes = '.jpg,.jpeg,.png,image/jpeg,image/png';
const documentTypes = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';

function usePreview(file?: File) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    const url = file ? URL.createObjectURL(file) : '';
    setPreview(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [file]);
  return preview;
}

function ZoomablePreview({url, label, combined=false, pdf=false}: {url:string; label:string; combined?:boolean; pdf?:boolean}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="aadhaar-zoom-trigger" aria-label={`Enlarge ${label}`} onClick={() => {dialog.current?.showModal(); setOpen(true);}}>
      {pdf
        ? <object className="aadhaar-preview aadhaar-pdf-preview" data={url} type="application/pdf" tabIndex={-1} style={{pointerEvents:'none'}} aria-label={label}/>
        : <img className="aadhaar-preview" src={url} alt={label} style={combined ? {maxHeight:'none'} : undefined}/>}
      <ZoomIn aria-hidden="true"/>
    </button>
    <dialog ref={dialog} className="aadhaar-zoom-dialog" aria-label={`Enlarged ${label}`} onClose={() => setOpen(false)}>
      <button type="button" aria-label="Close enlarged image" onClick={() => dialog.current?.close()}><X/></button>
      {pdf
        ? open && <object data={url} type="application/pdf" aria-label="Enlarged PDF document" style={{display:'block',width:'100%',height:'78vh'}}><a href={url} target="_blank" rel="noreferrer">Open PDF</a></object>
        : <div className="aadhaar-zoom-scroll"><img src={url} alt={`Enlarged ${label}`}/></div>}
    </dialog>
  </>;
}

export default function AadhaarUploader({
  photo, photo2, onPhoto, onPhoto2, fillDetails, disabled, onBusy, showScanInstructions = true,
  primaryButtonLabel = 'Upload Aadhar Front Image', secondaryDocumentLabel, hideSecond = false,
  singleDocument = false, combineSides = false, hidePrimary = false, openMenu, onMenuChange,
}: Props) {
  const [localMenuOpen, setLocalMenuOpen] = useState(false);
  const menuOpen=openMenu??localMenuOpen;
  const setMenuOpen=(open:boolean)=>{setLocalMenuOpen(open);onMenuChange?.(open);};
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstFile, setFirstFile] = useState(photo);
  const [secondFile, setSecondFile] = useState(photo2);
  const reading = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const addBack = useRef<HTMLInputElement>(null);
  const [combined,setCombined] = useState(false);
  const second = useRef<HTMLInputElement>(null);
  const files = [onPhoto ? photo : firstFile, onPhoto2 ? photo2 : secondFile];
  const previews = [usePreview(files[0]), usePreview(files[1])];
  const saveFirst = onPhoto ?? setFirstFile;
  const saveSecond = onPhoto2 ?? setSecondFile;
  const locked = disabled || busy;
  useEffect(() => () => { reading.current = false; }, []);

  async function select(event: ChangeEvent<HTMLInputElement>, slot: 1 | 2, append = false) {
    const selected = Array.from(event.currentTarget.files ?? []);
    if (!selected.length) return;
    const sides = append && files[0] ? [files[0], ...selected] : selected;
    let file = sides[0];
    event.currentTarget.value = '';
    if (!file || disabled || reading.current) return;
    if (!/\.(jpe?g|png|pdf)$/i.test(file.name) && !['image/jpeg','image/png','application/pdf'].includes(file.type)) {
      setStatus('Please upload Aadhaar in JPG, JPEG, PNG, or PDF format.');
      return;
    }
    if (combineSides && sides.length > 1) {
      if (sides.length !== 2 || sides.some(side => !/\.(jpe?g|png)$/i.test(side.name) && !['image/jpeg','image/png'].includes(side.type))) {
        setStatus('Choose two JPG or PNG images, front first and back second.');
        return;
      }
      reading.current = true;
      setBusy(true);
      onBusy?.(true);
      setStatus('Combining Aadhaar front and back…');
      try {
        file = await combineAadhaarSides(sides[0], sides[1]);
        if (!reading.current) return;
      } catch {
        if (reading.current) {
          setStatus('Could not combine these images. Choose two readable JPG or PNG photos.');
          reading.current = false;
          setBusy(false);
          onBusy?.(false);
        }
        return;
      }
    }
    setCombined(combineSides && sides.length === 2);
    (slot === 1 ? saveFirst : saveSecond)(file);
    if (singleDocument && files[1]) saveSecond(undefined);
    setMenuOpen(false);
    if(slot===2&&secondaryDocumentLabel){
      setStatus(`${secondaryDocumentLabel} uploaded.`);
      return;
    }
    reading.current = true;
    setBusy(true);
    onBusy?.(true);
    setStatus(`Reading image ${slot} with Gemini…`);
    try {
      const grant = savedSession()?.grant;
      if (!grant) throw new Error('Sign in again before scanning Aadhaar.');
      const details = await readGeminiAadhaar(file, grant);
      if (reading.current) setStatus(fillDetails(details, slot));
    } catch (error) {
      if (reading.current) {
        const message = error instanceof Error ? error.message : 'The image reader is unavailable.';
        setStatus(`Aadhaar image ${slot} saved. ${message} Please fill or verify the details manually.`);
      }
    } finally {
      if (reading.current) {
        reading.current = false;
        setBusy(false);
        onBusy?.(false);
      }
    }
  }

  function remove(index: number) {
    (index === 0 ? saveFirst : saveSecond)(undefined);
    setMenuOpen(false);
    setStatus(index===1&&secondaryDocumentLabel?`${secondaryDocumentLabel} removed.`:`Aadhaar image ${index + 1} removed.`);
  }

  return <section className="aadhaar-upload">
    <p>{singleDocument?'Upload a complete Aadhaar card as JPG, JPEG, PNG, or PDF. A two-page PDF stays together. For separate front and back photos, select both together, front first.':combineSides?'Choose the Aadhaar front and back photos together, front first, or upload the front and then add the back. You can also upload one image or PDF.':secondaryDocumentLabel?`Upload one Aadhaar image and one ${secondaryDocumentLabel} in JPG, JPEG, PNG, or PDF format.`:'Upload up to two Aadhaar images in JPG, JPEG, PNG, or PDF format.'}{showScanInstructions &&
      ' Images and PDFs are sent to Google Gemini to read the details. Use an unlocked PDF up to 1.3 MB. Verify the extracted fields before saving.'}</p>
    <div className="aadhaar-upload-actions">
      {!hidePrimary&&<button disabled={locked} type="button" className="employee-import" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Upload/>{primaryButtonLabel}</button>}
      {menuOpen && <div className="aadhaar-source-menu">
        <button disabled={locked} type="button" onClick={() => camera.current?.click()}><Camera/>Camera</button>
        <button disabled={locked} type="button" onClick={() => gallery.current?.click()}><Images/>Gallery / Document</button>
      </div>}
      {!hideSecond&&<button disabled={locked} type="button" className="employee-import" onClick={() => second.current?.click()}><Upload/>{secondaryDocumentLabel?`Upload ${secondaryDocumentLabel}`:'Upload Aadhar Back Image'}</button>}
      <input disabled={locked} ref={camera} className="employee-import-input" aria-label="Capture Aadhaar card" type="file" accept={imageTypes} capture="environment" onChange={event => void select(event, 1)}/>
      <input disabled={locked} ref={gallery} multiple={combineSides} className="employee-import-input" aria-label="Choose Aadhaar card from gallery" type="file" accept={documentTypes} onChange={event => void select(event, 1)}/>
      {combineSides && !singleDocument && files[0] && !combined && !/\.pdf$/i.test(files[0].name) && files[0].type !== 'application/pdf' && <>
        <button type="button" disabled={locked} className="employee-import" onClick={()=>addBack.current?.click()}>Add Aadhaar back image</button>
        <input ref={addBack} disabled={locked} className="employee-import-input" aria-label="Choose Aadhaar back image" type="file" accept={imageTypes} onChange={event=>void select(event,1,true)}/>
      </>}
      {!hideSecond&&<input disabled={locked} ref={second} className="employee-import-input" aria-label={secondaryDocumentLabel?`Choose ${secondaryDocumentLabel}`:'Choose second Aadhaar image'} type="file" accept={documentTypes} onChange={event => void select(event, 2)}/>}
    </div>
    {previews.map((preview, index) => preview && <div className="aadhaar-preview-row" key={index}>
      {files[index]?.type === 'application/pdf' || /\.pdf$/i.test(files[index]?.name || '')
        ? <ZoomablePreview url={preview} pdf label={index===1&&secondaryDocumentLabel?`Uploaded ${secondaryDocumentLabel} PDF preview`:`Uploaded Aadhaar image ${index + 1} PDF preview`}/>
        : <ZoomablePreview url={preview} combined={combined} label={combined?"Aadhaar front and back":index===1&&secondaryDocumentLabel?`Uploaded ${secondaryDocumentLabel} preview`:`Uploaded Aadhaar image ${index + 1} preview`}/>}
      <button disabled={locked} type="button" className="aadhaar-remove" onClick={() => remove(index)}><Trash2/>{index===1&&secondaryDocumentLabel?`Remove ${secondaryDocumentLabel}`:`Remove Image ${index + 1}`}</button>
    </div>)}
    {status && <p className="aadhaar-status" role="status">{status}</p>}
  </section>;
}

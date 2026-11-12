import {useEffect, useRef, useState, type ChangeEvent} from 'react';
import {Camera, Images, Trash2, Upload} from 'lucide-react';
import {savedSession} from './api';
import {readGeminiAadhaar, type AadhaarDetails} from './geminiOcr';

type Props = {
  photo?: File;
  photo2?: File;
  onPhoto?: (file?: File) => void;
  onPhoto2?: (file?: File) => void;
  fillDetails: (details: AadhaarDetails, slot: 1 | 2) => string;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
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

export default function AadhaarUploader({photo, photo2, onPhoto, onPhoto2, fillDetails, disabled, onBusy}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstFile, setFirstFile] = useState(photo);
  const [secondFile, setSecondFile] = useState(photo2);
  const reading = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const second = useRef<HTMLInputElement>(null);
  const files = [onPhoto ? photo : firstFile, onPhoto2 ? photo2 : secondFile];
  const previews = [usePreview(files[0]), usePreview(files[1])];
  const saveFirst = onPhoto ?? setFirstFile;
  const saveSecond = onPhoto2 ?? setSecondFile;
  const locked = disabled || busy;
  useEffect(() => () => { reading.current = false; }, []);

  async function select(event: ChangeEvent<HTMLInputElement>, slot: 1 | 2) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || disabled || reading.current) return;
    if (!/\.(jpe?g|png|pdf)$/i.test(file.name) && !['image/jpeg','image/png','application/pdf'].includes(file.type)) {
      setStatus('Please upload Aadhaar in JPG, JPEG, PNG, or PDF format.');
      return;
    }
    (slot === 1 ? saveFirst : saveSecond)(file);
    setMenuOpen(false);
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
    setStatus(`Aadhaar image ${index + 1} removed.`);
  }

  return <section className="aadhaar-upload">
    <p>Upload up to two Aadhaar images in JPG, JPEG, PNG, or PDF format. Images and PDFs are sent to Google Gemini to read the details. Use an unlocked PDF up to 1.3 MB. Verify the extracted fields before saving.</p>
    <div className="aadhaar-upload-actions">
      <button disabled={locked} type="button" className="employee-import" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><Upload/>Upload Aadhaar Image 1</button>
      {menuOpen && <div className="aadhaar-source-menu">
        <button disabled={locked} type="button" onClick={() => camera.current?.click()}><Camera/>Camera</button>
        <button disabled={locked} type="button" onClick={() => gallery.current?.click()}><Images/>Gallery / Document</button>
      </div>}
      <button disabled={locked} type="button" className="employee-import" onClick={() => second.current?.click()}><Upload/>Upload Aadhaar Image 2</button>
      <input disabled={locked} ref={camera} className="employee-import-input" aria-label="Capture Aadhaar card" type="file" accept={imageTypes} capture="environment" onChange={event => void select(event, 1)}/>
      <input disabled={locked} ref={gallery} className="employee-import-input" aria-label="Choose Aadhaar card from gallery" type="file" accept={documentTypes} onChange={event => void select(event, 1)}/>
      <input disabled={locked} ref={second} className="employee-import-input" aria-label="Choose second Aadhaar image" type="file" accept={documentTypes} onChange={event => void select(event, 2)}/>
    </div>
    {previews.map((preview, index) => preview && <div className="aadhaar-preview-row" key={index}>
      {files[index]?.type === 'application/pdf' || /\.pdf$/i.test(files[index]?.name || '')
        ? <object className="aadhaar-preview aadhaar-pdf-preview" data={preview} type="application/pdf" aria-label={`Uploaded Aadhaar image ${index + 1} PDF preview`}><span>{files[index]?.name}</span></object>
        : <img className="aadhaar-preview" src={preview} alt={`Uploaded Aadhaar image ${index + 1} preview`}/>}
      <button disabled={locked} type="button" className="aadhaar-remove" onClick={() => remove(index)}><Trash2/>Remove Image {index + 1}</button>
    </div>)}
    {status && <p className="aadhaar-status" role="status">{status}</p>}
  </section>;
}

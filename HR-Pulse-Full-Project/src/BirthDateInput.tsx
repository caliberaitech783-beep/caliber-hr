import {useId,useLayoutEffect,useRef,useState,type InputHTMLAttributes,type ChangeEvent} from 'react';
import {ageText} from './age';
import {dobDisplay,dobIso} from './dobFormat';
import './birth-date.css';
export const isBirthDateField=(label:string)=>/date\s*of\s*birth|\bdob\b|^dateOfBirth$/i.test(label);
export const isAadhaarField=(label:string)=>/^(?:aadhaar|aadhar)(?:\s*(?:no\.?|number|card(?:\s*(?:no\.?|number))?))?(?:\s*\*)?$/i.test(label.trim());
export function AgeDisplay({value,label='Age'}:{value:string;label?:string}){return <span className="birth-age" aria-label={label} aria-live="polite">{ageText(value)||'—'}</span>;}
type Props=InputHTMLAttributes<HTMLInputElement>&{birthDate?:boolean;aadhaar?:boolean;showAge?:boolean;onBirthDateValue?:(value:string)=>void};
export default function FormInput({birthDate,aadhaar,showAge=true,onBirthDateValue,...props}:Props){
 return birthDate||isBirthDateField(props.name||props['aria-label']||'')?<BirthDateInput {...props} showAge={showAge} onBirthDateValue={onBirthDateValue}/>:aadhaar||isAadhaarField(props.name||props['aria-label']||'')?<AadhaarInput {...props}/>:<input {...props}/>;
}
function AadhaarInput(props:InputHTMLAttributes<HTMLInputElement>){
 const clean=(input:HTMLInputElement)=>{const next=input.value.replace(/\D/g,'').slice(0,12);if(next!==input.value)Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,next);};
 return <input {...props} type="text" inputMode="numeric" minLength={12} maxLength={12} pattern="[0-9]{12}" title="Enter exactly 12 Aadhaar digits" onInput={event=>{clean(event.currentTarget);props.onInput?.(event);}} onChange={event=>{clean(event.currentTarget);props.onChange?.(event);}} onPaste={event=>{if(props.readOnly||props.disabled)return;event.preventDefault();const input=event.currentTarget,digits=event.clipboardData.getData('text').replace(/\D/g,''),start=input.selectionStart??input.value.length,end=input.selectionEnd??start,next=(input.value.slice(0,start)+digits+input.value.slice(end)).slice(0,12);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,next);input.dispatchEvent(new Event('input',{bubbles:true}));}}/>;
}
function BirthDateInput({showAge,onBirthDateValue,...props}:Omit<Props,'birthDate'|'aadhaar'>){
 const canonical=useRef<HTMLInputElement>(null),writing=useRef(false),visible=useRef<HTMLInputElement>(null),notify=useRef(onBirthDateValue),lastEmitted=useRef<string|undefined>(undefined),caret=useRef<number|null>(null),id=useId(),[text,setText]=useState(()=>dobDisplay(String(props.value??props.defaultValue??'')));notify.current=onBirthDateValue;
 useLayoutEffect(()=>{const control=canonical.current;if(!control)return;const sync=()=>{if(writing.current)return;setText(dobDisplay(control.value));notify.current?.(dobIso(dobDisplay(control.value)));};sync();control.addEventListener('input',sync);control.addEventListener('change',sync);return()=>{control.removeEventListener('input',sync);control.removeEventListener('change',sync);};},[]);
 useLayoutEffect(()=>{if(props.value!==undefined&&String(props.value)!==lastEmitted.current){const display=dobDisplay(String(props.value));setText(display);if(canonical.current)canonical.current.value=dobIso(display);notify.current?.(dobIso(display));}},[props.value]);
 function change(event:ChangeEvent<HTMLInputElement>){let raw=event.target.value;const previous=text;
  // Backspace over an automatic slash also removes the preceding digit.
  if(previous.endsWith('/')&&raw===previous.slice(0,-1))raw=raw.slice(0,-1);
  const count=raw.slice(0,event.target.selectionStart??raw.length).replace(/\D/g,'').length;caret.current=Math.min(10,count+(count>=2?1:0)+(count>=4?1:0));const display=dobDisplay(raw),iso=dobIso(display);lastEmitted.current=iso;setText(display);
  const control=canonical.current;if(control){control.value=iso;notify.current?.(iso);props.onChange?.({...event,target:control,currentTarget:control});writing.current=true;control.dispatchEvent(new Event('input',{bubbles:true}));writing.current=false;}
 }
 useLayoutEffect(()=>{if(caret.current!==null&&visible.current===document.activeElement){visible.current?.setSelectionRange(caret.current,caret.current);caret.current=null;}visible.current?.setCustomValidity(text&&!dobIso(text)?'Enter a valid date of birth as DD/MM/YYYY.':'');},[text]);
 const control=<><input {...props} ref={visible} name={undefined} type="text" inputMode="numeric" min={undefined} max={undefined} minLength={10} maxLength={10} pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" placeholder="DD/MM/YYYY" defaultValue={undefined} value={text} onInput={undefined} onChange={change} aria-label={props['aria-label']||props.name} aria-describedby={[props['aria-describedby'],showAge?id:''].filter(Boolean).join(' ')||undefined}/><input ref={canonical} type="hidden" disabled={props.disabled} name={props.name} defaultValue={dobIso(dobDisplay(String(props.value??props.defaultValue??'')))}/></>;
 return showAge?<span className="birth-date-pair">{control}<span className="birth-age-field" id={id}><span className="birth-age-heading">Age</span><AgeDisplay value={dobIso(text)}/></span></span>:control;
}

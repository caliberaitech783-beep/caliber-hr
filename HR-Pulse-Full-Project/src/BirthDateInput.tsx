import {useId,useLayoutEffect,useRef,useState,type InputHTMLAttributes} from 'react';
import {ageText} from './age';
import './birth-date.css';
export const isBirthDateField=(label:string)=>/date\s*of\s*birth|\bdob\b|^dateOfBirth$/i.test(label);
export function AgeDisplay({value,label='Age'}:{value:string;label?:string}){return <span className="birth-age" aria-label={label} aria-live="polite">{ageText(value)||'—'}</span>;}
type Props=InputHTMLAttributes<HTMLInputElement>&{birthDate?:boolean;showAge?:boolean;onBirthDateValue?:(value:string)=>void};
export default function FormInput({birthDate,showAge=true,onBirthDateValue,...props}:Props){
 return birthDate||isBirthDateField(props.name||props['aria-label']||'')?<BirthDateInput {...props} showAge={showAge} onBirthDateValue={onBirthDateValue}/>:<input {...props}/>;
}
function BirthDateInput({showAge,onBirthDateValue,...props}:Omit<Props,'birthDate'>){
 const input=useRef<HTMLInputElement>(null),notify=useRef(onBirthDateValue),id=useId(),[dob,setDob]=useState(String(props.value??props.defaultValue??''));notify.current=onBirthDateValue;
 useLayoutEffect(()=>{const control=input.current;if(!control)return;const sync=()=>{setDob(control.value);notify.current?.(control.value);};sync();control.addEventListener('input',sync);control.addEventListener('change',sync);return()=>{control.removeEventListener('input',sync);control.removeEventListener('change',sync);};},[]);
 useLayoutEffect(()=>{if(props.value!==undefined){setDob(String(props.value));notify.current?.(String(props.value));}},[props.value]);
 const control=<input {...props} ref={input} aria-label={props['aria-label']||props.name} aria-describedby={[props['aria-describedby'],showAge?id:''].filter(Boolean).join(' ')||undefined}/>;
 return showAge?<span className="birth-date-pair">{control}<span className="birth-age-field" id={id}><span className="birth-age-heading">Age</span><AgeDisplay value={dob}/></span></span>:control;
}

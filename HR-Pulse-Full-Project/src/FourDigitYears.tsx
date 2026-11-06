import {useLayoutEffect,useRef,type FormEvent,type ReactNode} from 'react';
const temporal=new Set(['date','month','datetime-local']);
function yearOnly(input:HTMLInputElement){return [input.name,input.getAttribute('aria-label')||'',...[...(input.labels||[])].map(label=>label.textContent||'')].some(label=>/^year(?: of passing)?(?:\s*\*)?(?:\s+\d+)?$/i.test(label.trim()));}
function limits(input:HTMLInputElement){
 if(temporal.has(input.type)){
  const suffix=input.type==='month'?'':input.type==='datetime-local'?'-01T00:00':'-01';
  const min='1000-01'+suffix,max=input.type==='month'?'9999-12':input.type==='datetime-local'?'9999-12-31T23:59':'9999-12-31';
  if(!input.min||Number(input.min.split('-')[0])<1000)input.min=min;
  if(!input.max||Number(input.max.split('-')[0])>9999)input.max=max;
 }else if(yearOnly(input)){
  input.min='1000';input.max='9999';input.maxLength=4;input.inputMode='numeric';
  if(input.type==='text')input.pattern='[0-9]{4}';
 }
}
// Capture before form handlers so controlled state, drafts and submissions receive the same value.
export default function FourDigitYears({children}:{children:ReactNode}){
 const root=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{const container=root.current;if(!container)return;const scan=()=>container.querySelectorAll('input').forEach(limits);scan();const observer=new MutationObserver(scan);observer.observe(container,{childList:true,subtree:true,attributes:true,attributeFilter:['type','name','aria-label']});return()=>observer.disconnect();},[]);
 function restrict(event:FormEvent<HTMLDivElement>){const input=event.target;if(!(input instanceof HTMLInputElement))return;limits(input);const next=temporal.has(input.type)?input.value.replace(/^(\d{4})\d+(?=-)/,'$1'):yearOnly(input)?input.value.replace(/\D/g,'').slice(0,4):input.value;if(next!==input.value)Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,next);}
 return <div ref={root} style={{display:'contents'}} onInputCapture={restrict} onChangeCapture={restrict}>{children}</div>;
}

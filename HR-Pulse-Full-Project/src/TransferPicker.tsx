import {useEffect,useId,useState} from 'react';

type Props={
  label:string;
  value:string;
  options:{label:string;value:string}[];
  placeholder:string;
  disabled:boolean;
  required?:boolean;
  savedLabel?:string;
  onChange:(value:string)=>void;
};

export default function TransferPicker({label,value,options,placeholder,disabled,required,savedLabel,onChange}:Props){
  const id=useId();
  const [query,setQuery]=useState<string|null>(null);
  const [active,setActive]=useState(-1);
  const open=query!==null&&!disabled;
  const selected=options.find(option=>option.value===value)?.label||savedLabel||'';
  const terms=(query||'').toLowerCase().trim().split(/\s+/);
  const matches=open?options.filter(option=>terms.every(term=>option.label.toLowerCase().includes(term))):[];
  const activeId=open&&matches[active]?`${id}-${active}`:undefined;
  useEffect(()=>{if(activeId)document.getElementById(activeId)?.scrollIntoView?.({block:'nearest'});},[activeId]);
  const close=()=>{setQuery(null);setActive(-1);};
  const choose=(next:string)=>{onChange(next);close();};

  return <div className="transfer-picker">
    <input role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open}
      aria-controls={open?id:undefined} aria-activedescendant={activeId} aria-required={required}
      required={required&&!value} ref={input=>{input?.setCustomValidity(required&&!value&&query?'Choose an option from the list.':'');}}
      autoComplete="off" disabled={disabled} placeholder={placeholder} value={query??selected}
      onClick={()=>{if(query===null)setQuery('');}}
      onBlur={close} onChange={event=>{setQuery(event.target.value);setActive(-1);}}
      onKeyDown={event=>{
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
          event.preventDefault();
          if(!open){setQuery('');setActive(0);return;}
          const next=active+(event.key==='ArrowDown'?1:-1);
          setActive(Math.max(0,Math.min(matches.length-1,next)));
        }
        if(open&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
        if(open&&event.key==='Enter'){
          event.preventDefault();
          const match=matches[active]||(matches.length===1?matches[0]:undefined);
          if(match)choose(match.value);
        }
      }}/>
    {open&&<div className="transfer-picker-menu">
      <div role="listbox" aria-label={label} id={id}>
        {matches.map((option,index)=><div id={`${id}-${index}`} role="option" key={option.value}
          aria-selected={option.value===value} data-active={index===active}
          onMouseDown={event=>event.preventDefault()} onClick={event=>{event.preventDefault();choose(option.value);}}>{option.label}</div>)}
      </div>
      {!matches.length&&<div role="status">No matches</div>}
    </div>}
  </div>;
}

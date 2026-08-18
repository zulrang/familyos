import React from 'react';
import {Icon} from './Icon.jsx';
export function Checkbox({checked=false,tone='teal',size=26,shape='rounded',onChange,label}){
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={()=>onChange&&onChange(!checked)} style={{width:size,height:size,flex:'0 0 auto',borderRadius:shape==='circle'?'var(--radius-pill)':'var(--radius-xs)',border:checked?'1px solid transparent':'1px solid var(--check-idle-border)',background:checked?`var(--member-${tone})`:'var(--check-idle)',color:checked?`var(--member-${tone}-ink)`:'transparent',display:'inline-flex',alignItems:'center',justifyContent:'center',cursor:'pointer',transition:'background var(--dur-fast) var(--ease-standard)'}}>{checked?<Icon name="check" size={Math.round(size*.62)}/>:null}</button>;
}

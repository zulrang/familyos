import React from 'react';
import {Icon} from './Icon.jsx';
const H={sm:36,md:44};
export function Button({children,variant='secondary',size='md',icon,disabled,onClick,style}){
  const base={display:'inline-flex',alignItems:'center',gap:8,height:H[size],padding:size==='sm'?'0 14px':'0 18px',border:'1px solid var(--border-hairline)',borderRadius:'var(--radius-pill)',background:'var(--surface-card)',color:'var(--text-body)',font:'var(--type-card-meta)',cursor:disabled?'default':'pointer',opacity:disabled?.45:1,transition:'background var(--dur-fast) var(--ease-standard),transform var(--dur-fast) var(--ease-standard)',boxShadow:'var(--shadow-raise)'};
  const v=variant==='primary'?{background:'var(--brand-blue)',color:'var(--text-on-fill)',border:'1px solid transparent'}:variant==='ghost'?{background:'transparent',border:'1px solid transparent',boxShadow:'none'}:null;
  return <button type="button" disabled={disabled} onClick={onClick} style={{...base,...v,...style}}>{icon?<Icon name={icon} size={size==='sm'?16:18}/>:null}{children}</button>;
}

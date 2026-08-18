import React from 'react';
import {Icon} from './Icon.jsx';
export function IconButton({icon,size=44,label,onClick,style}){
  return <button type="button" aria-label={label} onClick={onClick} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:size,height:size,borderRadius:'var(--radius-pill)',border:'1px solid var(--border-hairline)',background:'var(--surface-card)',color:'var(--text-body)',cursor:'pointer',boxShadow:'var(--shadow-raise)',...style}}><Icon name={icon} size={Math.round(size*.45)}/></button>;
}

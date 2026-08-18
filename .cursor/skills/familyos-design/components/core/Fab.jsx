import React from 'react';
import {Icon} from './Icon.jsx';
export function Fab({icon='plus',size=64,label='Add',onClick,style}){
  return <button type="button" aria-label={label} onClick={onClick} style={{position:'absolute',right:26,bottom:26,width:size,height:size,borderRadius:'var(--radius-pill)',border:'none',background:'var(--brand-blue)',color:'var(--text-on-fill)',boxShadow:'var(--shadow-fab)',display:'inline-flex',alignItems:'center',justifyContent:'center',cursor:'pointer',...style}}><Icon name={icon} size={Math.round(size*.44)}/></button>;
}

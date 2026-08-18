import React from 'react';
import {Checkbox} from '../core/Checkbox.jsx';
export function ListRow({label,emoji,checked=false,tone='sand',onToggle,style}){
  return <div style={{display:'flex',alignItems:'center',gap:9,padding:'var(--pad-list-row)',borderRadius:'var(--radius-list-row)',background:`var(--member-${tone})`,opacity:checked?.55:1,...style}}>
    {emoji?<span style={{fontSize:16,lineHeight:1}}>{emoji}</span>:null}
    <span style={{font:'var(--type-card-meta)',color:'var(--text-title)',textDecoration:checked?'line-through':'none',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
    <span style={{marginLeft:'auto'}}><Checkbox checked={checked} tone={tone} onChange={onToggle} label={label}/></span>
  </div>;
}

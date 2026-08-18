import React from 'react';
import {Checkbox} from '../core/Checkbox.jsx';
export function TaskRow({label,time,checked=false,tone='blush',style}){
  return <div style={{display:'flex',alignItems:'center',gap:10,padding:'var(--pad-list-row)',borderRadius:'var(--radius-list-row)',background:checked?`var(--member-${tone})`:`var(--member-${tone}-soft)`,...style}}>
    <span style={{display:'flex',flexDirection:'column',minWidth:0}}>
      <span style={{font:'var(--type-card-meta)',color:'var(--text-title)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
      {time?<span style={{font:'var(--fw-semibold) var(--fs-caption)/1.2 var(--font-sans)',color:'var(--text-muted)',marginTop:2}}>{time}</span>:null}
    </span>
    <span style={{marginLeft:'auto'}}><Checkbox checked={checked} tone={tone} shape="circle" label={label}/></span>
  </div>;
}

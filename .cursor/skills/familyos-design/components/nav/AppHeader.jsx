import React from 'react';
import {Icon} from '../core/Icon.jsx';
export function AppHeader({title,time,temp,weatherIcon='cloud-sun',actions,style}){
  return <header style={{display:'flex',alignItems:'center',gap:18,padding:'14px 24px 10px',...style}}>
    <h1 style={{font:'var(--type-screen-title)',letterSpacing:'var(--tracking-tight)'}}>{title}</h1>
    {time?<span style={{font:'var(--fw-semibold) var(--fs-heading)/1 var(--font-sans)',color:'var(--text-body)'}}>{time}</span>:null}
    {temp?<span style={{display:'inline-flex',alignItems:'center',gap:7,font:'var(--fw-semibold) var(--fs-heading)/1 var(--font-sans)',color:'var(--text-body)'}}><Icon name={weatherIcon} size={24} strokeColor="var(--accent-amber)"/>{temp}</span>:null}
    <span style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10}}>{actions}</span>
  </header>;
}

import React from 'react';
import {Badge} from '../core/Badge.jsx';
export function DayHeader({weekday,date,today=false,style}){
  return <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 0 8px 18px',...style}}>
    <span style={{font:'var(--type-day-label)',color:'var(--text-title)'}}>{weekday}{today?'':' '+date}</span>
    {today?<Badge tone="coral" size={30}>{date}</Badge>:null}
  </div>;
}

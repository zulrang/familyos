import React from 'react';
import {Avatar} from '../core/Avatar.jsx';
import {StatPill} from '../core/StatPill.jsx';
import {ProgressBar} from '../core/ProgressBar.jsx';
import {TimeOfDayTabs} from './TimeOfDayTabs.jsx';
export function MemberColumn({name,src,tone='blush',done=0,total=20,points,activeTab='morning',onTab,children,style}){
  return <section style={{display:'flex',flexDirection:'column',minWidth:0,flex:'1 1 0',...style}}>
    <div style={{borderRadius:'var(--radius-panel)',background:`var(--member-${tone}-soft)`,padding:'12px 14px 14px',display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <Avatar name={name} src={src} tone={tone} size={38}/>
        <span style={{font:'var(--type-section)',color:'var(--text-title)'}}>{name}</span>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <StatPill icon="check" value={`${done}/${total}`} tone={tone}/>
        {points!=null?<StatPill icon="star" value={points} tone="sand"/>:null}
      </div>
      <ProgressBar value={done} max={total} tone={tone}/>
      <TimeOfDayTabs active={activeTab} tone={tone} onSelect={onTab}/>
    </div>
    <div style={{display:'flex',flexDirection:'column',gap:'var(--gap-list-row)'}}>{children}</div>
  </section>;
}

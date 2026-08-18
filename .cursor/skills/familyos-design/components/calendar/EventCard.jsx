import React from 'react';
import {AvatarStack} from '../core/AvatarStack.jsx';
export function EventCard({title,time,tone='teal',multi=false,people=[],height,onClick,style}){
  return <div onClick={onClick} style={{position:'relative',display:'flex',flexDirection:'column',height,minHeight:64,padding:'10px 12px',borderRadius:'var(--radius-event)',background:multi?'var(--stripe-multi)':`var(--member-${tone})`,color:'var(--text-title)',cursor:onClick?'pointer':'default',overflow:'hidden',...style}}>
    <span style={{font:'var(--type-card-title)'}}>{title}</span>
    {time?<span style={{font:'var(--type-card-meta)',color:'var(--neutral-700)',marginTop:2}}>{time}</span>:null}
    {people.length?<span style={{marginTop:'auto',alignSelf:'flex-end'}}><AvatarStack people={people} size={28}/></span>:null}
  </div>;
}

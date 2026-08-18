import React from 'react';
import {Icon} from './Icon.jsx';
export function StatPill({icon='check',value,tone='sage',style}){
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:'var(--radius-pill)',background:`var(--member-${tone}-soft)`,color:`var(--member-${tone}-ink)`,font:'var(--fw-bold) var(--fs-caption)/1 var(--font-sans)',...style}}><Icon name={icon} size={13}/>{value}</span>;
}

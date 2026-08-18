import React from 'react';
export function AllDayBar({label,tone='sage',multi=false,style}){
  return <div style={{display:'flex',alignItems:'center',height:34,padding:'0 14px',borderRadius:'var(--radius-pill)',background:multi?'var(--stripe-multi)':`var(--member-${tone}-soft)`,color:'var(--text-title)',font:'var(--type-card-title)',...style}}>{label}</div>;
}

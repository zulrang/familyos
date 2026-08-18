import React from 'react';
export function ProgressBar({value=0,max=100,tone='teal',height=10,style}){
  const pct=Math.max(0,Math.min(100,(value/(max||1))*100));
  return <span style={{display:'block',height,borderRadius:'var(--radius-pill)',background:`var(--member-${tone}-soft)`,overflow:'hidden',...style}}><span style={{display:'block',width:pct+'%',height:'100%',borderRadius:'var(--radius-pill)',background:`var(--member-${tone})`,transition:'width var(--dur-slow) var(--ease-out-soft)'}}/></span>;
}

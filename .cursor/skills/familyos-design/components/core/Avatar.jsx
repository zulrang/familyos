import React from 'react';
export function Avatar({name='',src,tone='teal',size=34,ring=true,style}){
  const initial=(name||'?').trim().charAt(0).toUpperCase();
  return <span title={name} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:size,height:size,borderRadius:'var(--radius-pill)',background:`var(--member-${tone}-soft)`,color:`var(--member-${tone}-ink)`,font:`var(--fw-bold) ${Math.round(size*.42)}px/1 var(--font-sans)`,boxShadow:ring?'0 0 0 2px var(--white)':'none',overflow:'hidden',flex:'0 0 auto',...style}}>{src?<img src={src} alt={name} style={{width:'100%',height:'100%',objectFit:'cover'}}/>:initial}</span>;
}

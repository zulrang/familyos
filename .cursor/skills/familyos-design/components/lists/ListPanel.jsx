import React from 'react';
import {Badge} from '../core/Badge.jsx';
import {Icon} from '../core/Icon.jsx';
export function ListPanel({title,count,tone='sand',children,footer,style}){
  return <section style={{display:'flex',flexDirection:'column',minWidth:0,borderRadius:'var(--radius-panel)',background:`var(--member-${tone}-soft)`,overflow:'hidden',...style}}>
    <header style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px 10px'}}>
      <h2 style={{font:'var(--type-section)',color:'var(--text-title)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{title}</h2>
      <span style={{marginLeft:'auto'}}><Badge tone={tone==='sand'?'amber':tone==='teal'?'teal':tone==='lilac'?'lilac':'coral'} size={24}>{count}</Badge></span>
    </header>
    <div style={{display:'flex',flexDirection:'column',gap:'var(--gap-list-row)',padding:'0 10px 10px'}}>{children}</div>
    {footer!==false?<button type="button" style={{display:'flex',alignItems:'center',gap:10,margin:'auto 10px 12px',padding:'10px 6px',border:'none',background:'transparent',color:'var(--text-faint)',font:'var(--type-section)',cursor:'pointer'}}>Add section<Icon name="chevron-up" size={20} style={{marginLeft:'auto'}}/></button>:null}
  </section>;
}

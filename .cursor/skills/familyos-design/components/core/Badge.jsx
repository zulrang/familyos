import React from 'react';
const TONE={coral:['var(--accent-coral)','var(--white)'],amber:['var(--accent-amber)','var(--white)'],teal:['var(--accent-mint)','var(--white)'],lilac:['var(--member-lilac-ink)','var(--white)'],neutral:['var(--neutral-300)','var(--neutral-700)'],quiet:['transparent','var(--text-muted)']};
export function Badge({children,tone='neutral',size=26,style}){
  const [bg,fg]=TONE[tone]||TONE.neutral;
  return <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',minWidth:size,height:size,padding:'0 7px',borderRadius:'var(--radius-pill)',background:bg,color:fg,font:'var(--fw-bold) var(--fs-caption)/1 var(--font-sans)',border:tone==='quiet'?'1px solid var(--border-card)':'none',...style}}>{children}</span>;
}

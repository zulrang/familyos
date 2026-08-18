import React from 'react';
export function TimeGutter({hours=['10 AM','11 AM','12 PM','1 PM'],rowHeight=190,width=76,style}){
  return <div style={{width,flex:`0 0 ${width}px`,position:'relative',...style}}>
    {hours.map((h,i)=><span key={h} style={{position:'absolute',top:i*rowHeight-9,right:12,font:'var(--fw-semibold) var(--fs-body)/1 var(--font-sans)',color:'var(--text-muted)'}}>{h}</span>)}
  </div>;
}

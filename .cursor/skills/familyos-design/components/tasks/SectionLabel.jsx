import React from 'react';
export function SectionLabel({children,style}){
  return <h3 style={{font:'var(--type-section)',color:'var(--text-title)',padding:'14px 4px 8px',...style}}>{children}</h3>;
}

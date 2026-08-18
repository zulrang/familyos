import React from 'react';
export function NowLine({top=0,style}){
  return <div style={{position:'absolute',left:0,right:0,top,height:2,background:'var(--now-line)',pointerEvents:'none',...style}}><span style={{position:'absolute',left:-5,top:-4,width:10,height:10,borderRadius:'var(--radius-pill)',background:'var(--now-line)'}}/></div>;
}

import React from 'react';
import {Avatar} from './Avatar.jsx';
import {Badge} from './Badge.jsx';
export function AvatarStack({people=[],max=3,size=30,style}){
  const shown=people.slice(0,max),extra=people.length-shown.length;
  return <span style={{display:'inline-flex',alignItems:'center',...style}}>{shown.map((p,i)=><Avatar key={i} {...p} size={size} style={{marginLeft:i?-8:0}}/>)}{extra>0?<Badge tone="quiet" size={size} style={{marginLeft:-8,background:'var(--white)'}}>+{extra}</Badge>:null}</span>;
}

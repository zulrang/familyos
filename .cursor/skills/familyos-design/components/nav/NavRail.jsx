import React from 'react';
import {Icon} from '../core/Icon.jsx';
export const FAMILYOS_NAV=[{id:'calendar',label:'Calendar',icon:'calendar',tone:'teal'},{id:'lists',label:'Lists',icon:'list',tone:'sand'},{id:'tasks',label:'Tasks',icon:'check',tone:'sage'},{id:'rewards',label:'Rewards',icon:'star',tone:'coral'},{id:'meals',label:'Meals',icon:'utensils',tone:'blush'},{id:'recipes',label:'Recipes',icon:'book-open',tone:'lilac'},{id:'photos',label:'Photos',icon:'image',tone:'teal'},{id:'sleep',label:'Sleep',icon:'moon',tone:'lilac'},{id:'settings',label:'Settings',icon:'settings',tone:'neutral'}];
const toneColors=tone=>tone==='neutral'?{ink:'var(--neutral-700)',soft:'var(--neutral-200)'}:{ink:`var(--member-${tone}-ink)`,soft:`var(--member-${tone}-soft)`};
export function NavRail({items=FAMILYOS_NAV,active='calendar',onSelect,brand='F',style}){
  return <nav style={{width:'var(--rail-width)',flex:'0 0 var(--rail-width)',background:'var(--surface-rail)',display:'flex',flexDirection:'column',alignItems:'stretch',...style}}>
    <div style={{height:64,display:'flex',alignItems:'center',justifyContent:'center',font:'var(--fw-semibold) 24px/1 var(--font-display)',color:'var(--neutral-600)',background:'var(--surface-rail-active)'}}>{brand}</div>
    <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
      {items.map(it=>{const on=it.id===active;const spacer=it.id==='sleep';const {ink,soft}=toneColors(it.tone);
        return <button key={it.id} type="button" onClick={()=>onSelect&&onSelect(it.id)} style={{appearance:'none',border:'none',cursor:'pointer',position:'relative',flex:'1 1 0',minHeight:0,maxHeight:94,background:on?soft:'transparent',color:on?ink:'var(--neutral-600)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:7,padding:'0 2px',marginTop:spacer?'auto':0,font:'var(--type-nav-label)',fontWeight:on?'var(--fw-bold)':undefined,transition:'background var(--dur-fast) var(--ease-standard)'}}>
          {on?<span aria-hidden="true" style={{position:'absolute',left:0,top:14,bottom:14,width:5,borderRadius:'0 5px 5px 0',background:ink}}/>:null}
          <Icon name={it.icon} size={29} strokeColor={ink}/>{it.label}
        </button>;})}
    </div>
  </nav>;
}

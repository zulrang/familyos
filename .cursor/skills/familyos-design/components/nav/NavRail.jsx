import React from 'react';
import {Icon} from '../core/Icon.jsx';
export const FAMILYOS_NAV=[{id:'calendar',label:'Calendar',icon:'calendar'},{id:'lists',label:'Lists',icon:'list'},{id:'tasks',label:'Tasks',icon:'check'},{id:'rewards',label:'Rewards',icon:'star'},{id:'meals',label:'Meals',icon:'utensils'},{id:'recipes',label:'Recipes',icon:'book-open'},{id:'photos',label:'Photos',icon:'image'},{id:'sleep',label:'Sleep',icon:'moon'},{id:'settings',label:'Settings',icon:'settings'}];
export function NavRail({items=FAMILYOS_NAV,active='calendar',onSelect,brand='F',style}){
  return <nav style={{width:'var(--rail-width)',flex:'0 0 var(--rail-width)',background:'var(--surface-rail)',display:'flex',flexDirection:'column',alignItems:'stretch',...style}}>
    <div style={{height:64,display:'flex',alignItems:'center',justifyContent:'center',font:'var(--fw-semibold) 24px/1 var(--font-display)',color:'var(--neutral-600)',background:'var(--surface-rail-active)'}}>{brand}</div>
    <div style={{display:'flex',flexDirection:'column',flex:1}}>
      {items.map(it=>{const on=it.id===active;const spacer=it.id==='sleep';
        return <button key={it.id} type="button" onClick={()=>onSelect&&onSelect(it.id)} style={{appearance:'none',border:'none',cursor:'pointer',background:on?'var(--white)':'transparent',color:on?'var(--text-title)':'var(--neutral-600)',display:'flex',flexDirection:'column',alignItems:'center',gap:6,padding:'13px 2px',marginTop:spacer?'auto':0,font:'var(--type-nav-label)',transition:'background var(--dur-fast) var(--ease-standard)'}}>
          <Icon name={it.icon} size={22}/>{it.label}
        </button>;})}
    </div>
  </nav>;
}

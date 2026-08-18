import React from 'react';
import {Icon} from '../core/Icon.jsx';
const TABS=[{id:'morning',label:'Morning',icon:'sunrise'},{id:'afternoon',label:'Afternoon',icon:'sun'},{id:'evening',label:'Evening',icon:'moon'},{id:'chores',label:'Chores',icon:'sparkles'}];
export function TimeOfDayTabs({tabs=TABS,active='morning',tone='blush',onSelect,style}){
  return <div style={{display:'flex',gap:8,justifyContent:'space-between',...style}}>
    {tabs.map(t=>{const on=t.id===active;
      return <button key={t.id} type="button" onClick={()=>onSelect&&onSelect(t.id)} style={{flex:'1 1 0',border:'none',background:'transparent',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:5,padding:0,color:on?'var(--text-title)':'var(--text-faint)',font:on?'var(--fw-bold) var(--fs-micro)/1.1 var(--font-sans)':'var(--fw-semibold) var(--fs-micro)/1.1 var(--font-sans)'}}>
        <span style={{width:36,height:36,borderRadius:'var(--radius-pill)',display:'inline-flex',alignItems:'center',justifyContent:'center',background:on?`var(--member-${tone}-soft)`:'transparent',border:on?'2px solid var(--member-'+tone+')':'2px solid transparent'}}><Icon name={t.icon} size={18} strokeColor={on?`var(--member-${tone}-ink)`:'var(--text-faint)'}/></span>
        {t.label}
      </button>;})}
  </div>;
}

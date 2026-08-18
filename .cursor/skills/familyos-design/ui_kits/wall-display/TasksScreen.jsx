const {AppHeader,Button,IconButton,MemberColumn,SectionLabel,TaskRow,Fab} = window.DS;
function TasksScreen({onAdd}){
  const [tabs,setTabs]=React.useState({});
  return <div style={{display:'flex',flexDirection:'column',height:'100%',minWidth:0,background:'var(--surface-screen)',position:'relative'}}>
    <AppHeader title="Wed, Mar 22" time="8:00 AM" temp="88°" actions={<><Button icon="eye-off">Filter</Button><IconButton icon="chevron-left" label="Previous day" size={40}/><Button size="sm">Today</Button><IconButton icon="chevron-right" label="Next day" size={40}/></>}/>
    <div style={{display:'flex',gap:14,padding:'4px 24px 24px',flex:1,minHeight:0,overflow:'hidden'}}>
      {window.TASKS.map(m=><MemberColumn key={m.name} name={m.name} tone={m.tone} done={m.done} total={m.total} points={m.points} activeTab={tabs[m.name]||'morning'} onTab={v=>setTabs(t=>({...t,[m.name]:v}))}>
        <SectionLabel>Morning</SectionLabel>
        {m.morning.map(([label,time,checked])=><TaskRow key={label} label={label} time={time} checked={checked} tone={m.tone}/>)}
        <SectionLabel>Chores</SectionLabel>
        {m.chores.map(([label,time,checked])=><TaskRow key={label} label={label} time={time} checked={checked} tone={m.tone}/>)}
      </MemberColumn>)}
    </div>
    <Fab onClick={onAdd}/>
  </div>;
}
window.TasksScreen=TasksScreen;

const {AppHeader,Button,IconButton,ListPanel,ListRow,Fab} = window.DS;
function ListsScreen({onAdd}){
  const [done,setDone]=React.useState({});
  const tog=k=>setDone(p=>({...p,[k]:!p[k]}));
  return <div style={{display:'flex',flexDirection:'column',height:'100%',minWidth:0,background:'var(--surface-screen)',position:'relative'}}>
    <AppHeader title="Wed, Mar 12" time="11:20 AM" temp="80°" actions={<><Button icon="eye-off">Filter</Button><IconButton icon="chevron-left" label="Previous day" size={40}/><Button size="sm">Today</Button><IconButton icon="chevron-right" label="Next day" size={40}/></>}/>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,padding:'4px 24px 24px',flex:1,minHeight:0}}>
      {window.LISTS.map(l=><ListPanel key={l.title} title={l.title} count={l.count} tone={l.tone} footer={l.title==='Grocery List'} style={{overflow:'hidden'}}>
        {l.items.map(([label,emoji])=><ListRow key={label} label={label} emoji={emoji} tone={l.tone} checked={!!done[l.title+label]} onToggle={()=>tog(l.title+label)}/>)}
      </ListPanel>)}
    </div>
    <Fab onClick={onAdd}/>
  </div>;
}
window.ListsScreen=ListsScreen;

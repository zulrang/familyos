const {AppHeader,Button,MemberChip,DayHeader,AllDayBar,EventCard,TimeGutter,NowLine,Fab} = window.DS;
const DAYS=[{key:'wed',weekday:'Wed',date:18,today:true},{key:'thu',weekday:'Thu',date:19},{key:'fri',weekday:'Fri',date:20},{key:'sat',weekday:'Sat',date:21},{key:'sun',weekday:'Sun',date:22}];
const ALLDAY={wed:{label:'Camping Trip',tone:'sage'},sat:{label:'Cousins Visit',multi:true}};
function CalendarScreen({onAdd}){
  const [off,setOff]=React.useState({});
  const person=id=>window.FAMILY.find(p=>p.id===id)||{};
  return <div style={{display:'flex',flexDirection:'column',height:'100%',minWidth:0,background:'var(--surface-screen)',position:'relative'}}>
    <AppHeader title="Miller Family" time="11:20 AM" temp="80°" actions={<><Button icon="columns-3">Schedule</Button><Button icon="eye-off">Filter</Button></>}/>
    <div style={{display:'flex',gap:10,padding:'0 24px 12px'}}>
      <span style={{display:'flex',alignItems:'center',gap:10,padding:'5px 20px',border:'1px solid var(--border-card)',borderRadius:'var(--radius-pill)',font:'var(--type-card-meta)',whiteSpace:'nowrap'}}>🌴 Vacation <span style={{color:'var(--text-muted)'}}>48 days</span></span>
      {window.FAMILY.map(p=><MemberChip key={p.id} {...p} active={!off[p.id]} onClick={()=>setOff(o=>({...o,[p.id]:!o[p.id]}))}/>)}
    </div>
    <div style={{display:'flex',flex:1,minHeight:0,borderTop:'1px solid var(--surface-grid-line)'}}>
      <div style={{width:76,flex:'0 0 76px'}}/>
      {DAYS.map((d,i)=><div key={d.key} style={{flex:'1 1 0',minWidth:0,borderLeft:'1px solid var(--surface-grid-line)',display:'flex',flexDirection:'column'}}>
        <DayHeader weekday={d.weekday} date={d.date} today={d.today}/>
        <div style={{height:34,padding:'0 6px'}}>{ALLDAY[d.key]?<AllDayBar {...ALLDAY[d.key]} style={{height:30}}/>:null}</div>
        <div style={{position:'relative',flex:1,overflow:'hidden',borderTop:'1px solid var(--surface-grid-line)',marginTop:8}}>
          {i===0?<TimeGutter hours={['10 AM','11 AM','12 PM','1 PM']} rowHeight={190} width={70} style={{position:'absolute',left:-76,top:44,zIndex:2}}/>:null}
          {[1,2,3].map(n=><div key={n} style={{position:'absolute',left:0,right:0,top:n*190+44,borderTop:'1px solid var(--surface-grid-line)'}}/>)}
          {(window.EVENTS[d.key]||[]).filter(e=>!e.people.length||e.people.some(id=>!off[id])).map((e,k)=>
            <div key={k} style={{position:'absolute',left:6,right:6,top:e.top+44,height:e.height}}>
              <EventCard title={e.title} time={e.time} tone={e.tone} multi={e.multi} height="100%" people={e.people.map(id=>({name:person(id).name,tone:person(id).tone}))}/>
            </div>)}
          {d.today?<NowLine top={224}/>:null}
        </div>
      </div>)}
    </div>
    <Fab onClick={onAdd}/>
  </div>;
}
window.CalendarScreen=CalendarScreen;

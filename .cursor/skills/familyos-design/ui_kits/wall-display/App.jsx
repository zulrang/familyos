const {NavRail} = window.DS;
function App(){
  const [screen,setScreen]=React.useState('calendar');
  const [toast,setToast]=React.useState(null);
  const add=()=>{setToast('New item sheet would open here');setTimeout(()=>setToast(null),1800)};
  const Screen={calendar:window.CalendarScreen,lists:window.ListsScreen,tasks:window.TasksScreen}[screen];
  return <div style={{display:'flex',height:'100%',background:'var(--surface-screen)',position:'relative'}}>
    <NavRail active={screen} onSelect={setScreen}/>
    {Screen?<Screen onAdd={add}/>:<div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',font:'var(--type-section)',color:'var(--text-faint)'}}>Not recreated — no source screenshot for this section</div>}
    {toast?<div style={{position:'absolute',left:'50%',bottom:26,transform:'translateX(-50%)',background:'var(--neutral-800)',color:'#fff',padding:'10px 18px',borderRadius:'var(--radius-pill)',font:'var(--type-card-meta)',boxShadow:'var(--shadow-panel)'}}>{toast}</div>:null}
  </div>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

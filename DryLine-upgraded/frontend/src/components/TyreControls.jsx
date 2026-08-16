import Gauge from './Gauge.jsx'

export default function TyreControls({tyre,setTyre}) {
  const update=(k,v)=>setTyre({...tyre,[k]:v})
  return <section className="card">
    <div className="eyebrow">CURRENT TYRE</div>
    <div className="controls">
      <label>Compound<select value={tyre.compound} onChange={e=>update('compound',e.target.value)}>{['SOFT','MEDIUM','HARD','INTERMEDIATE','WET'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Health<input type="range" min="10" max="100" value={tyre.health*100} onChange={e=>update('health',Number(e.target.value)/100)}/></label>
      <Gauge label="Tyre health" value={tyre.health*100}/>
      <div className="two">
        <label>Age laps<input type="number" min="0" value={tyre.age_laps} onChange={e=>update('age_laps',Number(e.target.value))}/></label>
        <label>Changes left<input type="number" min="0" max="10" value={tyre.changes_remaining} onChange={e=>update('changes_remaining',Number(e.target.value))}/></label>
      </div>
    </div>
  </section>
}

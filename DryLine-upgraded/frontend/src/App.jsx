import {useMemo,useState} from 'react'
import Gauge from './components/Gauge.jsx'
import TrendChart from './components/TrendChart.jsx'
import StrategyPanel from './components/StrategyPanel.jsx'
import SystemHealth from './components/SystemHealth.jsx'
import TyreControls from './components/TyreControls.jsx'

const API=import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function App(){
  const [result,setResult]=useState(null)
  const [preview,setPreview]=useState(null)
  const [busy,setBusy]=useState(false)
  const [tyre,setTyre]=useState({compound:'MEDIUM',health:.88,age_laps:12,changes_remaining:1,pit_loss_seconds:21})
  const [rain,setRain]=useState(.15)
  const [demoStep,setDemoStep]=useState(0)
  const session='hackathon-demo'

  const conditionClass=(result?.condition||'UNKNOWN').toLowerCase()

  async function upload(file){
    if(!file)return
    setPreview(URL.createObjectURL(file)); setBusy(true)
    const fd=new FormData(); fd.append('file',file); fd.append('session_id',session); fd.append('tyre_json',JSON.stringify(tyre)); fd.append('weather_json',JSON.stringify({rain_intensity:rain,confidence:.8})); fd.append('lap_time_seconds','90')
    try{ const r=await fetch(`${API}/api/analyze-frame`,{method:'POST',body:fd}); setResult(await r.json()) } finally{setBusy(false)}
  }

  async function demoRain(){
    const seq=[.16,.21,.29,.38,.52,.61]
    const w=seq[demoStep%seq.length]
    const now=Date.now()/1000 + demoStep*8
    const payload={session_id:session,observation:{wetness:w,racing_line_wetness:Math.max(.05,w-.12),offline_wetness:Math.min(1,w+.16),standing_water:Math.max(0,(w-.35)*.9),spray:Math.max(0,(w-.3)*.7),rain_intensity:Math.min(1,w+.15),vision_confidence:.92,frame_quality:.94,track_visible:true,timestamp:now,notes:['structured demo observation']},tyre,weather:{rain_intensity:Math.min(1,w+.12),rain_expected_minutes:4,confidence:.85},lap_time_seconds:90}
    setBusy(true)
    try{const r=await fetch(`${API}/api/ingest-observation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});setResult(await r.json());setRain(Math.min(1,w+.12));setDemoStep(x=>x+1)}finally{setBusy(false)}
  }

  async function reset(){await fetch(`${API}/api/reset/${session}`,{method:'POST'});setResult(null);setDemoStep(0)}

  return <main>
    <header><div><div className="brand">DRYLINE</div><div className="tag">LIVE TRACK STRATEGY ENGINE</div></div><div className="live"><i/> LIVE</div></header>

    <div className="toolbar">
      <label className="upload">{busy?'PROCESSING…':'UPLOAD TRACK FRAME'}<input type="file" accept="image/*" onChange={e=>upload(e.target.files?.[0])}/></label>
      <button onClick={demoRain} disabled={busy}>RUN RAIN STEP</button>
      <button className="ghost" onClick={reset}>RESET</button>
    </div>

    {result?.whiplash && <div className="whiplash">⚠ WEATHER WHIPLASH — {result.whiplash_message}</div>}
    {result && !result.accepted_frame && <div className="rejected">FRAME REJECTED — strategy held. {result.rejection_reasons?.join(', ')}</div>}

    <div className="layout">
      <section className="card frameCard">
        <div className="eyebrow">TRACK CAMERA</div>
        <div className="frame">{preview?<img src={preview}/>:<div className="trackMock"><div className="road"/><span>Upload an image or use the rain demo</span></div>}</div>
      </section>

      <section className="card conditionCard">
        <div className="eyebrow">TRACK CONDITION</div>
        <div className={`condition ${conditionClass}`}>{result?.condition||'UNKNOWN'}</div>
        <Gauge label="Filtered wetness" value={(result?.filtered_wetness||0)*100}/>
        <div className="rate"><span>Change rate</span><b>{result ? `${result.wetness_rate_per_min>=0?'+':''}${(result.wetness_rate_per_min*100).toFixed(1)}% / min`:'—'}</b></div>
        {result?.racing_line_wetness!=null && <><Gauge label="Racing line" value={result.racing_line_wetness*100}/><Gauge label="Off-line" value={result.offline_wetness*100}/></>}
      </section>

      <StrategyPanel strategy={result?.strategy}/>
      <TyreControls tyre={tyre} setTyre={setTyre}/>
      <SystemHealth system={result?.system} accepted={result?.accepted_frame} visionConfidence={result?.vision_confidence||0}/>

      <section className="card trendCard"><div className="eyebrow">TRACK WETNESS HISTORY</div><TrendChart data={result?.trend||[]}/></section>
    </div>
  </main>
}

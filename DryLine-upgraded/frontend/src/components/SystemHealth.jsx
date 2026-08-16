export default function SystemHealth({system, accepted=true, visionConfidence=0}) {
  if(!system) return null
  return <section className="card">
    <div className="eyebrow">SYSTEM HEALTH</div>
    <div className="healthRow"><b>{system.status}</b><span>Data confidence {(system.data_confidence*100).toFixed(0)}%</span></div>
    <div className="miniGrid">
      <div><span>Vision confidence</span><b>{(visionConfidence*100).toFixed(0)}%</b></div>
      <div><span>Sensor agreement</span><b>{(system.sensor_agreement*100).toFixed(0)}%</b></div>
      <div><span>Frame</span><b>{accepted?'ACCEPTED':'REJECTED'}</b></div>
      <div><span>Age</span><b>{system.frame_age_seconds.toFixed(1)}s</b></div>
    </div>
    {system.warnings?.map((x,i)=><div className="warning" key={i}>⚠ {x}</div>)}
  </section>
}

export default function Gauge({label, value, suffix='%', hint}) {
  const pct = Math.max(0, Math.min(100, Number(value || 0)))
  return <div className="gauge">
    <div className="row"><span>{label}</span><b>{pct.toFixed(0)}{suffix}</b></div>
    <div className="bar"><i style={{width:`${pct}%`}} /></div>
    {hint && <small>{hint}</small>}
  </div>
}

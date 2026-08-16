export default function StrategyPanel({strategy}) {
  if(!strategy) return <section className="card hero"><h2>TYRE STRATEGY</h2><div className="empty">No strategy yet.</div></section>
  const eta=strategy.crossover_laps ? `${strategy.crossover_laps[0]}–${strategy.crossover_laps[1]} laps` : '—'
  return <section className="card hero">
    <div className="eyebrow">TYRE STRATEGY</div>
    <div className={`action ${strategy.action}`}>{strategy.action.replaceAll('_',' ')}</div>
    <div className="strategyGrid">
      <div><span>Current</span><b>{strategy.current_tyre}</b></div>
      <div><span>Recommended</span><b>{strategy.recommended_tyre}</b></div>
      <div><span>Crossover window</span><b>{eta}</b></div>
      <div><span>Risk</span><b>{strategy.risk_score}/100</b></div>
    </div>
    <div className="reasons">{strategy.reasons?.map((x,i)=><div key={i}>• {x}</div>)}</div>
  </section>
}

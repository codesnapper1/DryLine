export default function TrendChart({data=[]}) {
  if (!data.length) return <div className="empty">Upload a frame or run the rain demo to build a trend.</div>
  const w=700,h=180,p=18
  const pts=data.map((d,i)=>{
    const x=p+(i/Math.max(1,data.length-1))*(w-2*p)
    const y=h-p-(Number(d.wetness||0))*(h-2*p)
    return `${x},${y}`
  }).join(' ')
  return <svg className="trend" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
    {[0.25,0.5,0.75].map(v=><line key={v} x1={p} x2={w-p} y1={h-p-v*(h-2*p)} y2={h-p-v*(h-2*p)} className="grid" />)}
    <polyline points={pts} fill="none" className="line" vectorEffect="non-scaling-stroke"/>
  </svg>
}

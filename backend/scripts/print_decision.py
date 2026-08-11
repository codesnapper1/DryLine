import json
import sys

t = sys.argv[1]
d = json.load(sys.stdin)
c = d.get("crossover")
eta = f" eta={c['eta_laps']}laps->{c['target_compound']}" if c else ""
print(
    f"[t={float(t):>5.0f}s] {d['displayed_label']:<8} W_line={d['w_line']:.3f} "
    f"rate={d['rate_line_per_min']:+.4f}/min div={d['divergence']:+.3f} "
    f"conf={d['confidence_ok']}{eta}  \"{d['suggestion']}\""
)

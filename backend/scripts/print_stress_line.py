import json
import sys

t = sys.argv[1]
d = json.load(sys.stdin)
print(f"[t={float(t):>4.0f}s] raw={d['raw_label']:<7} displayed={d['displayed_label']:<7} W_line={d['w_line']:.3f}")

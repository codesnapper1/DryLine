#!/usr/bin/env bash
# DRYLINE Phase 1 demo: proves the ingest -> ROI -> stub-model -> alpha-beta
# filter -> hysteresis -> label -> suggestion pipeline end to end, with no ML
# involved yet. Requires the backend running: from backend/, `uvicorn main:app
# --port 8000`.
#
# Part 1 posts one frame every simulated 10s across a 15-minute session and
# prints the decision every 50s, so you can watch WET -> DRYING -> DRY happen.
# Part 2 stress-tests the 20s dwell-time hysteresis: it parks a session right
# on the damp/dry boundary with heavy measurement noise and shows the raw
# (instantaneous) label flapping while the *displayed* label holds steady.
#
# t is passed explicitly on every request — this is what makes the arc
# deterministic and instant to run, instead of waiting 15 real minutes.

set -euo pipefail

HOST="${HOST:-http://localhost:8000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAME="$SCRIPT_DIR/dummy_frame.jpg"

# Image generation needs opencv+numpy (the backend's own deps), which may not
# be on the system python3 used for the JSON-only steps below. Point GEN_PY at
# the backend venv's interpreter if system python3 doesn't have them, e.g.:
#   GEN_PY=../.venv/Scripts/python.exe ./scripts/demo.sh
GEN_PY="${GEN_PY:-python3}"
"$GEN_PY" "$SCRIPT_DIR/gen_dummy_frame.py" "$FRAME" >/dev/null

jget() { python3 -c "import sys, json; print(json.load(sys.stdin).get('$1',''))"; }
print_decision() { python3 "$SCRIPT_DIR/print_decision.py" "$1"; }
print_stress_line() { python3 "$SCRIPT_DIR/print_stress_line.py" "$1"; }

echo "=============================================================="
echo "PART 1 -- full wet -> drying -> dry arc"
echo "=============================================================="
SESSION_JSON=$(curl -s -X POST "$HOST/session" -H "Content-Type: application/json" -d '{
  "name": "demo-arc",
  "lap_time_s": 90,
  "initial_w": 0.80,
  "drift_per_min": -0.045,
  "sine_amp": 0.02,
  "sine_period_s": 50,
  "noise_std": 0.01,
  "lag_s": 150
}')
SID=$(echo "$SESSION_JSON" | jget id)
echo "session: $SID"
echo

for T in $(seq 0 10 900); do
  RESP=$(curl -s -X POST "$HOST/session/$SID/frame" -F "image=@$FRAME" -F "t=$T")
  if [ $((T % 50)) -eq 0 ]; then
    echo "$RESP" | print_decision "$T"
  fi
done

echo
echo "-- latest /decision --"
curl -s "$HOST/session/$SID/decision" | python3 -m json.tool

CSV_PATH="$SCRIPT_DIR/demo_arc_$SID.csv"
curl -s "$HOST/session/$SID/export.csv" -o "$CSV_PATH"
echo
echo "wrote $CSV_PATH ($(wc -l < "$CSV_PATH") lines incl. header)"

echo
echo "=============================================================="
echo "PART 2 -- 20s dwell-time hysteresis stress test"
echo "=============================================================="
STRESS_JSON=$(curl -s -X POST "$HOST/session" -H "Content-Type: application/json" -d '{
  "name": "hysteresis-stress",
  "lap_time_s": 90,
  "initial_w": 0.16,
  "drift_per_min": 0.0,
  "sine_amp": 0.0,
  "sine_period_s": 50,
  "noise_std": 0.08,
  "lag_s": 0
}')
SID2=$(echo "$STRESS_JSON" | jget id)
echo "session: $SID2 (parked on the damp/dry boundary, noise_std=0.08 -- watch raw flap, displayed hold)"
echo

for T in $(seq 5 5 65); do
  curl -s -X POST "$HOST/session/$SID2/frame" -F "image=@$FRAME" -F "t=$T" | print_stress_line "$T"
done

echo
echo "done."

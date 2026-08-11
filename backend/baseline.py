"""Naive baseline: a single-call 4-class classifier (Dry/Damp/Wet/Drying) with
no temporal awareness, used for the A/B comparison against the real pipeline
(CLAUDE.md section 2's core thesis — a per-frame classifier cannot coherently
predict "Drying" at all, and will flicker). See CLAUDE.md section 9 (Demo
Mode) for how this is shown in the UI.

Not implemented yet — scaffold only (PLAN.md Phase 5).
"""

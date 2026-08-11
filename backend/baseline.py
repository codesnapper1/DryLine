"""Naive baseline: a single-call 4-class classifier (Dry/Damp/Wet/Drying) with
no temporal awareness, used for the A/B comparison against the real pipeline.
A per-frame classifier can't coherently predict "Drying" at all — that's the
whole reason this project's pipeline is built the way it is, and showing this
baseline flicker next to the real output is meant to make that visible.

Not implemented yet — scaffold only.
"""

"""Runs each validated clip in demo/clips/ through the real API end to end
(POST /session, POST /session/{id}/video) and writes the resulting series to
demo/precomputed/<clip>.json. These files ARE committed (CLAUDE.md Demo Mode)
so the guaranteed-safe replay path needs zero network and zero API calls at
demo time.

Not implemented yet — scaffold only (PLAN.md Phase 4).
"""

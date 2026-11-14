# Assumptions

Every threshold the app uses is listed here and shown in the UI.

| Assumption | Value | Where | Why |
| --- | --- | --- | --- |
| Solar angular radius | 0.267° | `sunFraction.ts`, `metrics.py` | Mean apparent radius of the Sun at 1 AU; the Sun is treated as a disk, not a point. |
| "Day" threshold | ≥ 0.5 of the solar disk above the real horizon | metrics | Half-disk is a neutral cut between lit and dark; adjustable. |
| Earth visible | Earth centre ≥ 0.5° above the real horizon | metrics | Margin for antenna pointing and DEM error; adjustable. |
| Observer / panel height | 2 m above ground | horizon masks | Typical lander deck / mast height. |
| Landing-sun normalisation | 3° above horizon = full score | `score.ts` | Initial normalisation constant, **not** a NASA requirement. |
| Longest-night normalisation | 336 h (14 days) = zero score | `score.ts` | One lunar half-day. |
| Ephemeris coverage | 2026-11-01 → 2028-12-31, hourly | pipeline | Matches the challenge planning window. |
| Horizon azimuth step | 0.5° | pipeline | 720 samples; finer than the solar diameter. |

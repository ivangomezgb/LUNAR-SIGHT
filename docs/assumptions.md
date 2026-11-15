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


## Landing light risk

`landingRisk.ts` provides a planning heuristic, **not NASA landing-safety criteria**.
The card always calls `getSeries` with the **2 m mask** (`RISK_MASK_HEIGHT_M`),
independently of the selected panel height used by report metrics and charts.
The Sun margin is centre elevation minus that mask; astronomical elevation is
relative to the local horizontal. Earth visibility uses the selected angular
clearance (report default 0.5 degrees) against the same 2 m mask.

- **High**: margin < **0.5 degrees** (`HIGH_MARGIN_DEG`) or continuous remaining
  light < **48 h** (`HIGH_SUNLIGHT_H`). Small clearance flags sensitivity to relief;
  two days is an illustrative early-operations planning reserve, not a mission requirement.
- **Medium**: otherwise margin < **1 degree** (`MEDIUM_MARGIN_DEG`) or remaining
  light < **96 h** (`MEDIUM_SUNLIGHT_H`). The wider clearance and four-day reserve
  provide an advisory buffer. If no sunset is observed and fewer than 96 hours
  ahead are sampled, assign at least medium because low risk cannot be established.
- **Low**: neither rule applies. Equality belongs to the less severe category.
  Earth loss is reported independently and does not affect this light-only level.
- Light continues while **any** solar disk is visible (`sunFrac > 0`, using
  `sunFraction` and its **0.267 degree** radius). The endpoint is the first fully
  hidden sample (`sunFrac <= 0`), **not** the adjustable half-disk day threshold
  used by `computeMetrics.hoursToSunset`. Earth loss is the first failed clearance
  sample. An already hidden body gives 0 h; no observed event gives null, displayed
  as not observed within the available sampled duration, never infinite light.
- A sunset within **24 h** (`SUNSET_LOOKAHEAD_H`) means a visible-to-hidden
  transition after landing, including the 24 h endpoint. This includes a sunset
  following sunrise when landing in darkness. Without a transition and full
  lookahead coverage the answer is No; with incomplete coverage it is Unknown.
- Times use the containing sample (floor), with no interpolation. Lookahead ends
  at the final sample timestamp, not one interval later. Unresolved events between
  samples and DEM/ephemeris quantisation limit precision. Elevation rate is a
  central finite difference of **horizontal** Sun elevation, one-sided at edges;
  it is unknown with one sample. Terrain-relative clearance can evolve differently.
- Shadows use **h / tan(horizontal solar elevation)** on flat ground. Obstacle
  height is **1 m**; default lander height is **4 m** (`DEFAULT_LANDER_HEIGHT_M`),
  configurable through the card prop. Positive finite heights are required.
  No finite illuminated-plane shadow is reported at/below 0 degrees; at 90 degrees
  its length is zero. Shadows point 180 degrees opposite solar azimuth. This
  centre-ray geometry ignores slope, penumbra and occlusion: a positive elevation
  can still be blocked by terrain. The sketch uses equal horizontal/vertical scale.
- The report defaults to **14 mission days** and a **30-day** static timeline;
  its day fraction is **0.5** and Earth clearance **0.5 degrees** for reproducibility
  from the specified URL parameters. Positive custom mission durations are allowed.
  Metric windows are clipped to coverage and labelled; unavailable timeline samples
  do not establish Earth invisibility. Non-hourly timelines are omitted because the
  existing Timeline component assumes hourly samples. Missing 2 m masks or invalid
  landing inputs show an unavailable card, without silently substituting a mask.
- Published DEM-clone p5/p50/p95 values describe their original uncertainty window
  at 2 m, not this mission or other observer heights. Validation summaries concern
  ephemeris comparisons, not the risk heuristic or terrain-shadow accuracy. Source
  versions come from published metadata; absent validation is explicitly unavailable.
  PDF export uses the browser print dialog, A4 portrait, two explicitly separated
  sheets; browser headers/footers should be disabled. Generation UTC is the report
  view creation time and the URL preserves the scenario, not a frozen data snapshot.

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

## Energy and night survival

`web/src/lib/energy.ts` is an illustrative electrical balance, not a thermal model or
NASA flight/safety requirement. The card uses real `getSeries` solar-disk visibility
and azimuth/elevation at the selected `Assumptions.heightM` (default 2 m); missing
masks or incomplete mission coverage produce an unavailable result, never invented data.

- `SOLAR_CONSTANT_W_M2 = 1361` W/m² is the adopted constant irradiance assumption.
  Sun–Moon distance variation is ignored. Rated power = constant × active area × efficiency.
- `DEFAULT_ENERGY_PARAMETERS`: azimuth-tracking vertical panel; `areaM2 = 4`,
  `efficiency = 0.3`, `panelAzDeg = 0` (north, for fixed mode), `dayLoadW = 300`,
  `nightLoadW = 120`, `batteryKWh = 15`, `roundTripEfficiency = 0.9`.
  These are explicitly labelled editable example-lander assumptions, not measured hardware.
  Rated default power is 1633.2 W. Controls store values only in component state;
  separate cards and report views do not inherit edits and URL reloads reset them.
- Tracking vertical panel power = rated power × sunFrac × cos(sunEl).
  Fixed vertical power = rated power × sunFrac × max(0, cos(sunEl) × cos(sunAz − panelAz)).
  Angles are degrees, azimuth clockwise from north. Both formulas use astronomical
  elevation and the real horizon's visible disk fraction, not terrain clearance as incidence.
- `NO_SUN_FRACTION = 0`: fully hidden disk uses survival load; any positive fraction
  uses day load, even with an unilluminated fixed panel. The dashboard day threshold
  is deliberately not used. Loads are total electrical demand, heaters included.
- `INITIAL_SOC_FRACTION = 1`: battery starts fully charged. Capacity is usable stored
  energy, with no further depth-of-discharge reserve. Charge and discharge efficiencies
  each equal sqrt(roundTripEfficiency); direct solar supply to loads incurs neither loss.
  Surplus charges up to capacity and the rest is curtailed; deficits withdraw energy
  divided by discharge efficiency. Battery charge is clamped at zero after failure;
  subsequent recharge does not erase earlier unmet load.
- `ENERGY_STEP_H = 1`: hourly samples are held constant on their following intervals.
  Exact overlap with [landing, landing + missionDays × 24 h) handles partial boundaries.
  Depletion UTC is interpolated within the constant-power interval, not a prediction
  of sub-hour solar events. Non-hourly data is rejected. Mission days are Earth days.
- Survival means stored energy would never fall below zero; exactly zero at mission
  end still supplies the requested load. First depletion is the first zero crossing
  that leads to unmet load. No arbitrary reserve or empirical safety threshold is added.
- Minimum required capacity is maximum cumulative drawdown of efficiency-adjusted
  storage flows (drawdown resets to zero on complete recharge). This includes partial
  illumination deficits, incomplete recharges and mission-edge nights, starting full.
  Margin hours = (capacity − minimum required capacity) × discharge efficiency × 1000 /
  survival watts: signed spare-capacity equivalent, not a forecast after mission end.
  It is undefined when survival load is zero. The failure verdict rounds required
  capacity UP to 0.01 kWh so the displayed lower bound is not rounded downward.
- Generation counts all panel output before storage losses/curtailment. Daily generation
  is the mission average per 24 h; mean power includes darkness. Net-deficit hours count
  power below the applicable load. Longest no-sun duration is clipped to the mission;
  energy to cross it is duration × survival watts / 1000 / discharge efficiency.
- Parameters must be finite; area, loads and capacity may be zero; panel efficiency
  is in [0, 1], round-trip efficiency in (0, 1]. Negative or missing inputs are invalid.
  No temperature, dust, degradation, self-discharge, charge/discharge power limit,
  tracker power, local lander shadows or heater thermal sizing is modelled. Those
  omissions are shown in the card's assumptions. Hatching identifies no-sun periods
  independently of colour; the solid chart line is physical charge, clamped at empty.

## Playable mission (`#/mission`): game assumptions

The terrain (LOLA), the Sun and Earth positions (SPICE) and lunar gravity are real. The rover and
power numbers below are **declared game assumptions** (rounded, VIPER-like orders of magnitude), not
mission data; they are shown in the "Game rules" panel and live in `web/src/game/sim/rules.ts`.

| Assumption | Value | Why |
| --- | --- | --- |
| Rover top speed | 0.2 m/s (time warp makes it feel faster) | VIPER-class order of magnitude. |
| Climb limit / tip-over | 15° grade / 25° cross slope | Typical planetary-rover limits, rounded. |
| Panel / antenna height | 2 m | Same height as the published 2 m horizon masks. |
| Battery, panel, loads | 2000 Wh; 450 W Sun-tracking vertical panel; 90 W avionics, +200 W driving, +150 W heater in shadow | Round numbers that make polar nights a real threat. |
| Earth link | Earth centre ≥ 0.5° above the real horizon at the rover; 0.25 MB/s | Same margin as the rest of the app. |
| Horizon at the rover | Ray march over the published 10 m and 400 m grids (≲ 51 km) plus the part of the site mask beyond them, tilt-corrected | Agrees with the published 2 m mask at the site within 0.1° (tests). |
| Sun/Earth direction | The site's ephemeris everywhere in the ±5 km play area | Direction changes < 0.2° over 5 km. |
| Far-horizon parallax | Ignored for obstacles beyond 51 km | ≲ 10 % of their (small) elevation over 5 km. |
| Terrain shading | Same horizon model, baked on a 192² grid (128² on phones) | So what you see in shadow is what drains the battery. |
| Lander (descent) | 1200 kg dry + 700 kg propellant, 6500 N throttleable engine (Isp 311 s), 1.2 m/s² lateral RCS | Small robotic lander order of magnitude; real lunar gravity 1.62 m/s². |
| Safe touchdown | Vertical speed < 2 m/s, drift < 1 m/s, slope < 8° under the legs (real 10 m terrain) | Typical robotic-lander limits, rounded. |
| Descent start | 900 m above the target, falling 18 m/s, 166 m off with 5 m/s drift | Short enough to play; the "brake now" cue appears ≥ 500 m up in free fall (tested). |

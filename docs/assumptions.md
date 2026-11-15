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

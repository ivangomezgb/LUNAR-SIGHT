# Space Apps submission: project page text and video script

Paste-ready text for the Space Apps project page (English). Numbers come from `docs/validation.md`,
`docs/psr.md` and `web/public/data/`; update them if the data is regenerated.

## Project Name

Lunar Landing Site Navigator — team Apolo404

## High-Level Project Summary

Lunar Landing Site Navigator is a web app that shows what a lander would actually see at 17 sites near the
lunar south pole, including all nine NASA Artemis III candidate regions of 2024: the real horizon, computed
from NASA LOLA elevation models out to 200 km, with the paths of the Sun and Earth across it. From that it
computes, hour by hour through 2028, the two things a south-pole mission lives or dies by: sunlight for power
and Earth visibility for communications. It shows each site in 3D and as an astronaut's 360° view, estimates
the landing light risk, the energy and battery needed to survive the night, safe slopes and the nearest
permanently shadowed regions, and works for any point of the south polar map. When a launch slips, its
"Mission delayed" mode re-ranks every site and landing time in under a second. Every number is validated:
Sun and Earth positions match JPL Horizons to 0.00003°, and our Earth visibility matches NASA's published
LOLA illumination maps at all 17 sites (r = 0.98).

## Link to Project Demo

`<YouTube or public Drive link to the 30 s video>`

## Link to Final Project

- App: https://ivangomezgb.github.io/LUNAR-SIGHT/ (mirror: https://apolo404-alunizaje.vercel.app/)
- Code: https://github.com/ivangomezgb/LUNAR-SIGHT

## Detailed Project Description

**What it does**

- **Explore**: a polar map of 17 sites — the nine Artemis III candidate regions of 2024 (including Peak near
  Cabeus B and Slater Plain, located from the official USGS navigation grids), four more from the 2022 list,
  Shackleton's rim and Mons Mouton, where IM-2 *Athena* landed. For each site:
  - a 360° panorama of the real terrain horizon with the Sun's path (gold) and Earth's path (blue, dashed),
    animated through time;
  - eight metrics (sunlight %, longest day and night, Earth visibility %, hours to sunset and Earthset,
    next Earth window, Sun at landing) and a 30-day timeline of light and contact;
  - terrain uncertainty: the p5–p95 range of sunlight over 30 NASA LOLA error-clone terrains (14 sites);
  - **landing light risk**: Sun margin above the real horizon, sunlight and Earth time left, shadow lengths,
    low / medium / high;
  - **energy and night survival**: an hourly simulation of a vertical solar panel and a battery from the real
    illumination, with the minimum battery that survives the mission (all parameters editable);
  - **slopes and safe landing area**: a ±2 km slope map from the 10 m LOLA grid, the share of the landing
    circle under 8°, and the nearest 100 m circle that is entirely safe;
  - **permanently shadowed regions**: the nearest PSR (possible water-ice cold traps) from the official LOLA
    PSR map, its size and the PSR area within 5, 10 and 20 km;
  - a printable **mission brief (PDF)**.
- **3D**: three ways to look at a site on the same time slider — a 3D overview of the real terrain lit by the
  real Sun with cast shadows and a sky dome with the Sun and Earth paths; a first-person view (eye height 2 to
  200 m); and the **astronaut 360° view**, whose horizon matches the mask within 0.2°. Lunar photometry, the
  Earth with its real phase, and an optional, clearly labelled visibility aid for sites in shadow.
- **Any point**: click anywhere on the south polar map (or type coordinates) and the browser computes an
  approximate horizon from coarse LOLA terrain, every metric, the landing risk and a realistic 3D view,
  compared with the nearest curated site; accuracy measured on the curated sites is shown.
- **Compare**: up to three sites side by side on the same date, with risk and uncertainty.
- **Mission delayed**: enter the original landing date, the delay and a tolerance. Every site × landing time
  (every 6 h) is scored with adjustable weights and hard filters; the 10 best options come with their three
  main reasons (e.g. "+38% sunlight vs original plan") and their landing light risk.
- **Validation**: every comparison and assumption, visible in the app. English and Spanish.

**How it works**

1. **Terrain**: LOLA DEMs from NASA's PGDA at 5, 10, 20 and 240 m/px, read tile by tile with HTTP range
   requests. Rays every 0.5° of azimuth with exact spherical geometry, from 5 m out to 200 km, build the
   horizon mask at observer heights of 1, 2, 5 and 10 m.
2. **Ephemerides**: NAIF SPICE (DE440, high-precision lunar orientation) gives the apparent Sun and Earth
   positions every hour, Nov 2026 – Dec 2028, converted to local azimuth and elevation.
3. **Metrics**: each hour we ask what fraction of the solar disk (radius 0.267°) is above the real horizon,
   and whether the Earth's centre is at least 0.5° above it. Metrics run in the browser, so the ranking is
   instant; the same code exists in Python and a test checks that both agree.
4. **Site points**: published reference points often fall on steep slopes, so each site is moved to the
   best-lit point with slope ≤ 8° within 1 km. The reference and the rule are shown in the app.
5. **Uncertainty**: the near-field horizon is recomputed on 30 full-surface LOLA error clones per site in
   GitHub Actions, one parallel job per site.
6. **3D / 360°**: local heightmaps with the Moon's curvature, and a ray-cast 360° distance/normal image.

**Validation**

- Sun and Earth azimuth/elevation vs JPL Horizons, 3 sites × 10 instants × 2 bodies: max error 1.05e-6°
  (azimuth) and 2.68e-5° (elevation).
- All 17 sites vs NASA's LOLA long-term illumination maps (Mazarico et al. 2011), same definition: Earth
  visibility r = 0.984 (median difference 2.4 points); sunlight r = 0.914, higher at sites we moved onto
  best-lit peaks, where the published map itself changes by tens of points within one 60 m pixel. This also
  explains the earlier Connecting Ridge gap (85.3 % ours at 2 m vs 88.4 % one pixel away).
- 360° panoramas vs horizon masks: within 0.2° in 100 % of columns at 16 of 17 sites.
- Horizon algorithm vs analytic cases (smooth Moon −0.087° at 2 m; walls), within 0.02°.
- IM-2 *Athena* (2025-03-06 17:31 UTC): Sun 2.47° high over a 0.83° horizon, consistent with the low-Sun,
  long-shadow conditions reported at landing.

**Limitations and next steps**

- "Any point" uses coarse 240 m terrain, so its horizon is approximate (mean error 0.25°); the 17 curated
  sites use 5–10 m terrain near the observer.
- Clone uncertainty exists only where NASA published LOLA error clones (not Mons Mouton, Peak near Cabeus B,
  Slater Plain).
- Slopes come from a 10 m grid: boulders and small craters are not resolved.
- Next: multi-year statistics, thermal conditions, and finer terrain for arbitrary points.

## Use of Artificial Intelligence (AI)

We used AI coding agents throughout development. **Claude Code** (Anthropic) coordinated the work, wrote the
data pipeline, the web interface and the integration, and reviewed every change. **OpenAI Codex** (GPT models)
wrote the execution plan, the metrics and ranking engine, and parts of the 3D, design and extras work. Every
AI-generated component was reviewed and covered by tests or independent references (JPL Horizons, NASA's
published illumination maps, analytic cases). Commits written with AI are marked. No AI-generated images,
video or data are presented as NASA data; the only images are NASA LOLA terrain, our own renders of it, and
the team photo.

## NASA Data

- LOLA DEMs from the Planetary Geodesy Data Archive: [PGDA 81](https://pgda.gsfc.nasa.gov/products/81)
  (5 m/px, 87°S), [PGDA 90](https://pgda.gsfc.nasa.gov/products/90) (10/20/240 m/px, hillshade),
  [PGDA 78](https://pgda.gsfc.nasa.gov/products/78) (site DEMs and error clones).
- LOLA polar illumination and permanently shadowed region maps: [PGDA 69](https://pgda.gsfc.nasa.gov/products/69)
  (Mazarico et al. 2011).
- [NAIF SPICE generic kernels](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/): DE440, lunar
  orientation, leap seconds.
- [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), for validation.
- Artemis III candidate regions: [NASA App Development Challenge 2023 data](https://www.nasa.gov/learning-resources/app-development-challenge/2023-handbook-and-coding-components).
- IM-2 *Athena* landing location: [LROC](https://lroc.im-ldi.com/images/1408).

## Space Agency Partner Data and Other References

- USGS: McClernan (2024), Lunar Grid Reference System navigation grids for the Artemis III candidate
  regions, [doi:10.5066/P1MEQ6UK](https://doi.org/10.5066/P1MEQ6UK).
- Mazarico et al. (2011), *Icarus* 211, 1066–1081, [doi:10.1016/j.icarus.2010.10.030](https://doi.org/10.1016/j.icarus.2010.10.030).
- Bussey et al. (2010), *Icarus* 208, 558–564, [doi:10.1016/j.icarus.2010.03.028](https://doi.org/10.1016/j.icarus.2010.03.028).
- Barker et al. (2021), *Planetary and Space Science*, LOLA site DEMs and clones, [doi:10.1016/j.pss.2020.105119](https://doi.org/10.1016/j.pss.2020.105119).
- [Space.com report of the IM-2 landing](https://www.space.com/the-universe/moon/intuitive-machines-lands-private-athena-lander-near-moon-south-pole-historic-touchdown).
- Software: Python (numpy, numba, scipy, pyproj, rasterio, spiceypy), TypeScript (React, Vite, D3, three.js,
  zustand); hosting on GitHub Pages and Vercel; GitHub Actions for tests and the clone ensembles.

## 30-second video script

Total 30 s. Screen recording of the published app, with English subtitles (same text as the voice-over).

| Time | Screen | Voice-over / subtitle |
| --- | --- | --- |
| 0–4 s | Explore: hero and polar map with the 17 sites | "At the Moon's south pole, the Sun never rises more than a few degrees." |
| 4–9 s | Select Connecting Ridge; the panorama animates the Sun along the real horizon | "So a few metres of terrain decide whether a lander has power — or freezes." |
| 9–14 s | 3D overview: shadows sweep the terrain, Sun and Earth paths on the sky dome; then the astronaut 360° view | "We rebuild the real NASA terrain and light it with the real Sun, hour by hour." |
| 14–19 s | Energy card and slope map (Haworth: battery runs out), PSR card | "We check power through the night, safe slopes, and nearby ice-trapping shadows." |
| 19–24 s | Mission delayed: change the delay, ranking reorders instantly | "Launch slipped three weeks? Every site and landing time is re-ranked in under a second." |
| 24–30 s | Validation: Horizons table and the Mazarico comparison, then title and URL | "Validated against JPL Horizons and NASA's illumination maps. Lunar Landing Site Navigator." |

**Recording tips**: 1920×1080. Use the shareable URLs to land on each state, and preload every page once so
nothing shows a loading spinner:

- `#/?site=connecting-ridge&t=2027-01-12T06:00Z`
- `#/3d?site=peak-near-shackleton&t=2027-01-20T12:00Z&days=30` (overview), then `&view=pano`
- `#/?site=haworth&t=2027-01-12T06:00Z` (energy: battery depletes; scroll to slopes and PSR)
- `#/replan`
- `#/validation`

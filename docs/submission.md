# Space Apps submission: project page text and video script

Paste-ready text for the Space Apps project page (English). Numbers come from `docs/validation.md`;
update them if the data is regenerated.

## Project Name

Lunar Landing Site Navigator

## High-Level Project Summary

Lunar Landing Site Navigator is a web app that shows what a lander would actually see at 15 candidate
sites near the lunar south pole: the real horizon, computed from NASA LOLA elevation models out to
200 km, with the paths of the Sun and Earth across it. From that it computes the two things a south-pole
mission lives or dies by, sunlight for power and Earth visibility for communications, hour by hour
through 2028. When a launch slips, its "Mission delayed" mode ranks every site and landing time in the
new window in under a second and explains why each option wins. Every number is validated: our Sun and
Earth positions match JPL Horizons to 0.00003°, and the IM-2 *Athena* landing is reproduced (Sun 2.5°
above a 0.8° horizon).

## Link to Project Demo

`<YouTube or public Drive link to the 30 s video>`

## Link to Final Project

- App: https://ivangomezgb.github.io/LUNAR-SIGHT/
- Code: https://github.com/ivangomezgb/LUNAR-SIGHT

## Detailed Project Description

**What it does**

- **Explore**: a polar map of 15 sites: the NASA Artemis III candidate regions, Shackleton's rim and Mons
  Mouton, where IM-2 *Athena* landed. For each site, a 360° panorama shows the real terrain horizon with the
  Sun's path (gold) and Earth's path (blue, dashed) over the mission, animated through time. The panorama
  comes with eight metrics (sunlight %, longest day and night, Earth visibility %, hours to sunset and
  Earthset, next Earth window, Sun at landing) and a 30-day timeline of light and contact.
- **Compare**: up to three sites side by side, on the same date.
- **Mission delayed**: enter the original landing date, the delay and a tolerance. The app scores every
  site × landing time (every 6 h) with weights you can adjust and hard filters (minimum light, minimum
  Earth visibility, maximum slope, Sun above the horizon at landing). It returns the 10 best options, each
  with its three main reasons, e.g. "+38% sunlight vs original plan".
- **3D and 360° views**: the local terrain lit from the real Sun direction, with shadows, and an immersive
  panorama from 2 m above the ground.
- **Validation**: every comparison and assumption, visible in the app.

**How it works**

1. **Terrain**: LOLA DEMs from NASA's PGDA at 5, 10, 20 and 240 m/px. We read only the needed tiles by HTTP
   range and march rays every 0.5° of azimuth with exact spherical geometry, from 5 m out to 200 km, to
   build the horizon mask at observer heights of 1, 2, 5 and 10 m.
2. **Ephemerides**: NAIF SPICE (DE440, high-precision lunar orientation) gives the apparent Sun and Earth
   positions every hour, Nov 2026 – Dec 2028, converted to local azimuth and elevation.
3. **Metrics**: each hour we ask what fraction of the solar disk (radius 0.267°) is above the real
   horizon, and whether the Earth's centre is at least 0.5° above it. All metrics derive from that.
   They run in the browser, so the ranking is instant. The same code exists in Python, and a test checks
   that both agree.
4. **Site points**: the published reference points often fall on steep slopes. Each site is moved to the
   best-lit point with slope ≤ 8° within 1 km. The reference and the rule are shown in the app.

**Validation**

- Sun and Earth azimuth/elevation vs JPL Horizons, over 3 sites × 10 instants × 2 bodies: max error
  1.0e-6° (azimuth) and 2.7e-5° (elevation).
- Horizon algorithm vs analytic cases (smooth Moon −0.087° at 2 m; walls), within 0.02°.
- Illumination vs Mazarico et al. (2011): 80.9 % near their best-lit Connecting Ridge point, against ~86–89 %
  published. The difference comes from the DEM, the time span and the observer height.
- IM-2 *Athena* (2025-03-06 17:31 UTC): Sun 2.47° high over a 0.83° horizon. This is consistent with the
  low-Sun, long-shadow conditions reported at landing.

**Limitations and next steps**

- Horizons are precomputed, so arbitrary coordinates need a backend or a precomputed grid.
- Surface-level DEM uncertainty is shown only where PGDA 78 clones cover a site.
- Next: more sites (Peak near Cabeus B, Slater Plain), multi-year statistics, an exportable mission
  report, and thermal and illumination-risk layers for landing.

## Use of Artificial Intelligence (AI)

We used AI coding agents throughout development. **Claude Code** (Anthropic) coordinated the work and
wrote the data pipeline, the web interface and the integration. **OpenAI Codex** wrote the execution plan,
the metrics and ranking engine, and parts of the 3D and extras work. Every AI-generated component was
reviewed and covered by tests or independent references (JPL Horizons, published illumination studies,
analytic cases). Commits written with AI are marked. No AI-generated images, video or data are presented
as NASA data.

## NASA Data

- LOLA DEMs from the Planetary Geodesy Data Archive: [PGDA 81](https://pgda.gsfc.nasa.gov/products/81)
  (5 m/px, 87°S), [PGDA 90](https://pgda.gsfc.nasa.gov/products/90) (10/20/240 m/px, hillshade),
  [PGDA 78](https://pgda.gsfc.nasa.gov/products/78) (site DEMs and error clones).
- [NAIF SPICE generic kernels](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/): DE440, lunar
  orientation, leap seconds.
- [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), for validation.
- Artemis III candidate regions: [NASA App Development Challenge 2023 data](https://www.nasa.gov/learning-resources/app-development-challenge/2023-handbook-and-coding-components).
- IM-2 *Athena* landing location: [LROC](https://lroc.im-ldi.com/images/1408).

## Space Agency Partner Data and Other References

- Bussey et al. (2010), *Icarus* 208, 558–564. Mazarico et al. (2011), *Icarus* 211, 1066–1081.
- Space.com report of the IM-2 landing time.
- Software: Python (numpy, numba, pyproj, rasterio, spiceypy), TypeScript (React, Vite, D3, three.js,
  zustand), GitHub Pages.

## 30-second video script

Total 30 s. Screen recording of the published app, with English subtitles (same text as the voice-over).

| Time | Screen | Voice-over / subtitle |
| --- | --- | --- |
| 0–4 s | Polar map, sites appear | "At the Moon's south pole, the Sun never rises more than a few degrees." |
| 4–10 s | Select Connecting Ridge; the panorama animates the Sun along the real horizon | "So a few metres of terrain decide whether a lander has power — or freezes." |
| 10–15 s | Metric cards and the timeline; Earth path dips behind a ridge | "We trace the real LOLA horizon and the Sun and Earth, hour by hour, through 2028." |
| 15–21 s | Mission delayed: move the delay slider, ranking reorders instantly | "Launch slipped three weeks? We re-rank every site and landing time in under a second." |
| 21–26 s | 3D view: shadows sweep across the terrain | "And show it in 3D, lit by the real Sun." |
| 26–30 s | Validation PASS badge, then the title and URL | "Validated against JPL Horizons to 0.00003 degrees. Lunar Landing Site Navigator." |

**Recording tips**: 1920×1080, dark theme. Use the shareable URLs to land on each state, for example
`#/?site=connecting-ridge&t=2027-01-12T06:00Z`. Preload every page once so nothing shows a loading spinner.

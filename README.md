# Lunar Landing Site Navigator

**NASA Space Apps Challenge 2026 — Lunar Landing Site Navigator.** Team **Apolo404**, Systems
Engineering students at UPTC (Sogamoso, Colombia).

A static web app that shows, for **17 lunar south-pole sites** (all nine NASA Artemis III candidate
regions of 2024, four more from the 2022 list, Shackleton's rim and the IM-2 *Athena* landing point),
the **real horizon** seen from the ground with the paths of the **Sun and Earth**; computes **power
(sunlight) and communications (Earth visibility)** metrics hour by hour through 2028; shows each site
in **3D and as an immersive 360° view**; and recommends **alternative sites and dates when a mission
slips**.

Every number comes from NASA data: LOLA digital elevation models (PGDA) for terrain, NAIF SPICE
(DE440) for ephemerides, LOLA error clones for terrain uncertainty and USGS navigation grids for the
newest regions, validated against JPL Horizons.

## Features

| Screen | What it does |
| --- | --- |
| **Explore** | Polar map of the 17 sites. Pick one to see a 2D 360° panorama: real horizon, Sun path (gold, solid) and Earth path (blue, dashed), animated through time. Eight metric cards (sunlight with its p5–p95 terrain-uncertainty band), a 30-day timeline, the **landing light risk** card, an **energy and night-survival** simulation (solar panel, loads and battery, editable) and a **slope map with the safe landing area** (from the 10 m LOLA grid), and a link to the **mission brief (PDF)**. Site and time live in the URL (`#/?site=connecting-ridge&t=2027-01-12T06:00Z`). |
| **3D** (`#/3d`) | Three ways to look at a site, sharing the same time slider and path window (`t=`, `days=` 1/14/30): **3D overview** (real LOLA terrain lit by the real Sun with cast shadows, plus a sky dome with the real Sun and Earth paths), **First person · 2 m** (stand on the terrain; mesh horizon approximate) and **Astronaut 360°** (precomputed panorama whose horizon matches the mask within 0.2°). Lunar photometry, Earth with its real phase, no invented surface detail. |
| **Compare** | Up to 3 sites side by side for the same date: panoramas, aligned timelines, metrics with the best value highlighted, landing light risk and uncertainty band. |
| **Mission delayed** | Enter the original site and date, the delay and a tolerance; every site × landing time (6 h steps) is scored with adjustable weights and hard filters. Top 10 with the three main reasons each and their landing light risk, in well under a second in the browser. |
| **Any point** (`#/free`) | Pick any point of the south-polar map (or type coordinates). The browser computes an **approximate** horizon from coarse LOLA grids (240 m + 960 m) and runs every metric, the landing risk and a realistic 3D view of that point, compared with the nearest curated site. Shareable URL (`?lat=&lon=&t=`). Accuracy measured on the curated sites is shown on the page. |
| **Mission brief** (`#/report`) | Printable A4 brief for one site and landing time: metrics, uncertainty, landing risk, panorama, timeline, assumptions and sources; "Download PDF" uses the browser's print dialog. |
| **Validation** | Our Sun/Earth azimuth and elevation vs JPL Horizons, the IM-2 *Athena* landing case, and every assumption. |
| **About** / **Apolo404** | Data, method, sources and use of AI; the team. |

English and Spanish (EN/ES switch, `?lang=es`); observer / panel height 1, 2, 5 or 10 m (`?h=`).

## Metrics

All metrics come from one hourly question: *what fraction of the solar disk is above the real
horizon, and is the Earth up?*

| Metric | Definition |
| --- | --- |
| Sunlight | mean visible fraction of the solar disk (radius 0.267°) over the mission window, % |
| Longest day / night | longest run of hours with ≥ / < 0.5 of the disk visible |
| Earth visible | % of hours with the Earth's centre ≥ 0.5° above the real horizon |
| Hours to sunset / Earthset | from the chosen time to the next loss of Sun / Earth |
| Next Earth window | start and duration of the next continuous Earth visibility |
| Sun at landing | Sun elevation above the real horizon at the landing hour |
| Terrain uncertainty | p5 / p50 / p95 of 2027 sunlight over 30 LOLA error clones (PGDA 78), 14 of 17 sites |
| Landing light risk | Sun margin above the 2 m mask, sunlight and Earth time remaining, shadow lengths, low / medium / high |
| Energy and night survival | hourly solar generation of a vertical panel from the real visible-disk series, battery state of charge, depletion time and the minimum battery that survives the mission |
| Slopes and safe area | slope from the 10 m LOLA grid (curvature removed), % of the 50–500 m circles ≤ 8° and ≤ 15°, nearest 100 m circle entirely ≤ 8° |

Thresholds are assumptions, shown and editable in the UI and listed in [`docs/assumptions.md`](docs/assumptions.md).

## How it works

```
pipeline/ (Python)                                   web/ (TypeScript, Vite + React)
  config/sites.yaml   curated sites + sources          src/lib/      metrics, ranking, risk, free point
  lln/dem.py          LOLA tiles by HTTP range          src/components panorama, map, timeline, 3D…
  lln/horizon.py      multi-scale horizon (numba)       src/pages/    Explore, 3D, Compare, Replan…
  lln/ephem.py        Sun & Earth with SPICE
  lln/terrain.py      3D heightmaps (near + far)
  lln/pano.py         360° distance + normal images
  lln/uncertainty.py  LOLA clone ensembles
  lln/freepoint.py    coarse grids + Sun/Earth vectors
  lln/validate.py     JPL Horizons comparison   ──JSON/binaries──▶  web/public/data/
  lln/export.py       sites.json, sites/<id>.json, basemap
```

- **Horizon masks**: rays every 0.5° of azimuth with exact spherical geometry, from the site out
  to 200 km, taking the maximum over three scales: LOLA 5 m/px (PGDA 81) or 10 m/px (PGDA 90) to
  7.5 km, 20 m/px to 60 km and 240 m/px to 200 km; heights 1, 2, 5 and 10 m.
- **Site points**: published reference points (e.g. the centre of each Artemis III region) often
  sit on steep slopes. `pipeline/scripts/refine_sites.py` moves each site to the best-lit point with
  slope ≤ 8° within 1 km of its reference; the reference and the selection rule are shown in the app.
  The IM-2 *Athena* site is never moved. Peak near Cabeus B and Slater Plain start from the centre of
  their official USGS navigation grid (`pipeline/scripts/usgs_region_center.py`).
- **Ephemerides**: apparent Sun and Earth positions in `MOON_ME` (DE440), hourly from
  2026-11-01 to 2028-12-31, transformed to local azimuth/elevation.
- **3D and 360°**: local tangent-plane heightmaps (curvature included) and an equirectangular
  distance/normal panorama from 2 m, both lazy-loaded (`docs/contracts-3d.md`).
- **Uncertainty**: the near-field horizon is recomputed on 30 full-surface LOLA error clones per site;
  this runs in GitHub Actions, one parallel job per site (`.github/workflows/uncertainty.yml`).
- **The browser computes the metrics** from the masks and ephemerides, so the delayed-mission ranking
  responds instantly. The same metrics exist in Python (`lln/metrics.py`) and a test checks parity.

## Validation

- Sun and Earth vs JPL Horizons, 3 sites × 10 instants × 2 bodies: max error **1.05e-6° in azimuth
  and 2.68e-5° in elevation** (threshold 0.05°).
- Horizon algorithm vs analytic cases (smooth Moon, walls), coordinate round trips < 1 m.
- 360° panoramas vs the horizon masks: within 0.2° in 100 % of columns for 16 of 17 sites.
- Any point (coarse DEM) vs the curated masks: mean 0.25°, max 2.64°; sunlight within 1.25 pp on average.
- Illumination vs published values (Mazarico et al. 2011) and the IM-2 *Athena* landing (low Sun,
  2.47° above a 0.83° horizon). Details in [`docs/validation.md`](docs/validation.md).

## Run it

```bash
# pipeline (Python 3.12)
pip install -r pipeline/requirements-dev.txt
python pipeline/scripts/download_kernels.py
python pipeline/run_all.py                    # first run downloads ~1.5 GB of LOLA tiles (cached)
python pipeline/run_all.py --terrain --pano   # 3D heightmaps and 360° panoramas
python -m pytest pipeline/tests

# web (Node 20+)
cd web
npm ci
npm run dev                                   # http://localhost:5173
npm test
npm run build                                 # static site in web/dist
```

The generated data in `web/public/data/` is committed, so the web app builds without running the
pipeline. Pushing to `main` runs the tests, validates the data (`pipeline/scripts/check_data.py`)
and deploys to GitHub Pages (`.github/workflows/deploy.yml`) and Vercel (`vercel.yml`).

## Data and references

- LOLA DEMs: [PGDA 81](https://pgda.gsfc.nasa.gov/products/81) (5 m/px, 87°S), [PGDA 90](https://pgda.gsfc.nasa.gov/products/90) (10/20/240 m/px), [PGDA 78](https://pgda.gsfc.nasa.gov/products/78) (site DEMs and error clones)
- [NAIF SPICE generic kernels](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/) (DE440, lunar orientation)
- [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- Artemis III candidate regions: [NASA App Development Challenge 2023 data](https://www.nasa.gov/learning-resources/app-development-challenge/2023-handbook-and-coding-components) and the USGS LGRS navigation grids, McClernan (2024), [doi:10.5066/P1MEQ6UK](https://doi.org/10.5066/P1MEQ6UK)
- IM-2 *Athena* landing point: [LROC](https://lroc.im-ldi.com/images/1408)
- Bussey et al. (2010), *Icarus* 208; Mazarico et al. (2011), *Icarus* 211 — south-pole illumination; Barker et al. (2021), *PSS* — LOLA site DEMs and clones
- Every site's source is in [`pipeline/config/sites.yaml`](pipeline/config/sites.yaml)

## Use of AI

This project was built with AI coding agents, as allowed by the challenge guidelines:
**Claude Code** (Anthropic) coordinated the work, wrote the pipeline, the UI and the integration and
reviewed every change, and **OpenAI Codex** (GPT-6 models) wrote the execution plan
([`docs/execution-plan-codex.md`](docs/execution-plan-codex.md)), the metrics/ranking engine and
parts of the 3D, design and extras work. Commits written with AI say so. Every number was checked
against tests or independent references; see Validation.

## License

[MIT](LICENSE)

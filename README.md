# Lunar Landing Site Navigator

**NASA Space Apps Challenge 2026 — Lunar Landing Site Navigator.**
A static web app that shows, for 15 lunar south-pole sites, the **real horizon** seen from the
ground with the paths of the **Sun and Earth**, computes **power (sunlight) and communications
(Earth visibility)** metrics, and recommends **alternative sites and dates when a mission slips**.

Every number comes from NASA data: LOLA digital elevation models (PGDA) for terrain and NAIF SPICE
(DE440) for ephemerides, validated against JPL Horizons.

## Features

| Screen | What it does |
| --- | --- |
| **Explore** | Polar map of the sites. Pick one to see a 360° panorama: real horizon, Sun path (gold, solid) and Earth path (blue, dashed), animated through time. Metric cards and a 30-day timeline of sunlight and Earth contact. Site and time live in the URL (`#/?site=connecting-ridge&t=2027-01-12T06:00Z`). |
| **3D** | Stand on the real terrain: 3D overview with cast shadows and Sun/Earth paths, first person at 2 m, and an exact-horizon 360° view. |
| **Play mission** | A short educational game on the real data (`#/mission`): drive a solar rover around a site, with sunlight and the Earth link computed at the rover's position, a battery, time warp, GPS-like navigation to typed coordinates, 6 objectives that each teach the science of polar landing sites, and a mission report compared with the site's published metrics. Game numbers are declared assumptions. |
| **Compare** | Up to 3 sites side by side for the same date, aligned timelines, best value highlighted. |
| **Mission delayed** | Enter the original site and date, the delay and a tolerance; every site × landing time (6 h steps) is scored with adjustable weights and hard filters. Top 10 with the three main reasons each (compared with the original plan), in well under a second in the browser. |
| **Validation** | Our Sun/Earth azimuth and elevation vs JPL Horizons, the IM-2 *Athena* landing case, and every assumption. |
| **About** | Data, method, sources and use of AI. |

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

Thresholds are assumptions, shown and editable in the UI and listed in [`docs/assumptions.md`](docs/assumptions.md).

## How it works

```
pipeline/ (Python)                                   web/ (TypeScript, Vite + React)
  config/sites.yaml   curated sites + sources          src/lib/      metrics engine, ranking
  lln/dem.py          LOLA tiles by HTTP range          src/components panorama, map, timeline…
  lln/horizon.py      multi-scale horizon (numba)       src/pages/    Explore, Compare, Replan…
  lln/ephem.py        Sun & Earth with SPICE
  lln/validate.py     JPL Horizons comparison   ──JSON──▶  web/public/data/
  lln/export.py       sites.json, sites/<id>.json, basemap
```

- **Horizon masks**: rays every 0.5° of azimuth with exact spherical geometry, from the site out
  to 200 km, taking the maximum over three scales: LOLA 5 m/px (PGDA 81) or 10 m/px (PGDA 90) to
  7.5 km, 20 m/px to 60 km and 240 m/px to 200 km; heights 1, 2, 5 and 10 m.
- **Site points**: published reference points (e.g. the centre of each Artemis III region) often
  sit on steep slopes. `pipeline/scripts/refine_sites.py` moves each site to the best-lit point with
  slope ≤ 8° within 1 km of its reference; the reference and the selection rule are shown in the app.
  The IM-2 *Athena* site is never moved.
- **Ephemerides**: apparent Sun and Earth positions in `MOON_ME` (DE440), hourly from
  2026-11-01 to 2028-12-31, transformed to local azimuth/elevation.
- **The browser computes the metrics** from the masks and ephemerides, so the delayed-mission ranking
  responds instantly. The same metrics exist in Python (`lln/metrics.py`) and a test checks parity.

## Validation

- Sun and Earth vs JPL Horizons, 3 sites × 10 instants × 2 bodies: max error **1.0e-6° in azimuth and
  2.7e-5° in elevation** (threshold 0.05°).
- Horizon algorithm vs analytic cases (smooth Moon, walls), coordinate round trips < 1 m.
- Illumination vs published values (Mazarico et al. 2011) and the IM-2 *Athena* landing (low Sun,
  2.47° above a 0.83° horizon). Details in [`docs/validation.md`](docs/validation.md).

## Run it

```bash
# pipeline (Python 3.12)
pip install -r pipeline/requirements-dev.txt
python pipeline/scripts/download_kernels.py
python pipeline/run_all.py            # first run downloads ~1.5 GB of LOLA tiles (cached)
python -m pytest pipeline/tests

# web (Node 20)
cd web
npm ci
npm run dev                           # http://localhost:5173
npx vitest run
npm run build                         # static site in web/dist
```

The generated data in `web/public/data/` is committed, so the web app builds without running the
pipeline. Pushing to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## Data and references

- LOLA DEMs: [PGDA 81](https://pgda.gsfc.nasa.gov/products/81) (5 m/px, 87°S), [PGDA 90](https://pgda.gsfc.nasa.gov/products/90) (10/20/240 m/px)
- [NAIF SPICE generic kernels](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/) (DE440, lunar orientation)
- [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- Artemis III candidate regions: [NASA App Development Challenge 2023 data](https://www.nasa.gov/learning-resources/app-development-challenge/2023-handbook-and-coding-components)
- IM-2 *Athena* landing point: [LROC](https://lroc.im-ldi.com/images/1408)
- Bussey et al. (2010), *Icarus* 208; Mazarico et al. (2011), *Icarus* 211 — south-pole illumination
- Every site's source is in [`pipeline/config/sites.yaml`](pipeline/config/sites.yaml)

## Use of AI

This project was built with AI coding agents, as allowed by the challenge guidelines:
**Claude Code** (Anthropic) coordinated the work and wrote the pipeline, the UI and the integration,
and **OpenAI Codex** wrote the execution plan ([`docs/execution-plan-codex.md`](docs/execution-plan-codex.md))
and the metrics/ranking engine. Commits written with AI say so. Every number was checked
against tests or independent references; see Validation.

## License

[MIT](LICENSE)

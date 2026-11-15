# Validation: Sun and Earth ephemerides vs JPL Horizons

## Method

**Our ephemerides** (`pipeline/lln/ephem.py`) use SPICE through spiceypy, with these NAIF generic kernels
(`pipeline/scripts/download_kernels.py`):

| Kernel | Role |
| --- | --- |
| `naif0012.tls` | leap seconds (UTC to TDB) |
| `de440s.bsp` | DE440 planetary ephemeris (1849–2150) |
| `pck00011.tpc` | body constants |
| `moon_pa_de440_200625.bpc` | high-precision lunar orientation (MOON_PA_DE440) |
| `moon_de440_250416.tf` | lunar frames. `MOON_ME` is an alias of `MOON_ME_DE440_ME421` (frame id 31001), which the tests check. |

1. We compute the apparent positions of SUN and EARTH once, hourly from `2026-11-01T00:00:00Z` (n = 19008). They are taken from the Moon's centre with `spkpos(..., "MOON_ME", "LT+S", "MOON")`.
2. For each site:
   - We subtract the observer vector, `(1737.4 km + elev_m) * up`, using planetocentric lat/lon. On the 1737.4 km sphere, planetocentric and geodetic are the same.
   - We project the result onto local east/north/up.
   - Azimuth is measured from north, clockwise, in [0, 360). Elevation is measured from the plane perpendicular to the sphere normal.
   - The values are stored as integer centidegrees.

**Reference** (`pipeline/lln/validate.py`): the [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), queried as follows:

- Ephemeris type: `EPHEM_TYPE=OBSERVER`, `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='E-lon,lat,alt_km'`.
- Quantities: `QUANTITIES='4'`, `ANG_FORMAT=DEG`, `CSV_FORMAT=YES`, `EXTRA_PREC=YES`.
- Times: `TIME_TYPE=UT` with a discrete `TLIST`.

These are the response headers we checked:

- `Atmos refraction: NO (AIRLESS)`. Quantity 4 is the *airless* apparent az/el: it is corrected for light time, gravitational light bending and stellar aberration, and has no refraction. If a response ever reports refraction, the parser rejects it.
- `Center pole/equ : MEAN_ME (high precision)` and `Center radii : 1737.4, 1737.4, 1737.4 km`. Horizons uses the same mean-Earth frame and the same reference sphere that we do, so its "geodetic" input is our planetocentric lat/lon. The site altitude is passed in km above that sphere.
- Horizons computes with DE441 and we use DE440. The two agree to well below our resolution over 2025–2029.

The parser finds the azimuth and elevation columns from the CSV header line just above `$$SOE`. The real responses we captured are stored in `pipeline/tests/fixtures/horizons_*.txt`, and every live response is cached in `pipeline/data/intermediate/horizons_raw/`.

**Sample**: 3 test points × 10 instants × 2 bodies = 60 rows.

- Test points: 89.90° S 0° E; 84.7906° S 29.1957° E (Athena / Mons Mouton); 69.373° S 32.319° E (Chandrayaan-3).
- Instants: spread from 2026-11-03 to 2028-12-08 at varying hours.
- `d_az` is the circular difference, wrapped to (−180, 180].

The sample covers a Sun elevation range of −21.3° to +20.9° and an Earth elevation range of −6.8° to +22.4°.

## Results (run 2026-11-14)

| | max \|d_az\| | max \|d_el\| |
| --- | --- | --- |
| Sun | < 5e-7° (rounds to 0 at 1e-6) | < 5e-7° |
| Earth | 1e-6° | 2.7e-5° (0.1″) |
| **All 60 rows** | **1.0e-6°** | **2.7e-5°** |

The threshold is 0.05°, so the comparison **passes** with a margin of more than 1000×.

- The small Earth elevation residual is about 0.1″. It probably comes from differences in light-deflection modelling between DE440 and DE441, and from the different light-time/aberration path (Moon centre plus offset, against a true topocentric solution).
- A separate check placed an observer 5 km above the sphere at 84.79° S. It gave the same agreement (Earth |d_el| ≤ 2.5e-5°), which confirms that the altitude is handled correctly.
- Elevation matters very little here. 5 km of altitude changes Earth's elevation by only about 0.0007° and the Sun's by about 2e-6°, through parallax. Dip of the horizon is a separate topic: it belongs to the DEM horizon mask, not to the ephemeris.
- Because the base vector approach already agrees with Horizons to the micro-degree, we did not need `spkcpo`. A one-off `spkcpo` (observer, LT+S) test gave identical values to 1e-8°.

Our stored values are rounded to centidegrees, which adds up to 0.005° of quantisation error. That is still 10× below the threshold.

## IM-2 case (Athena)

- **Touchdown time:** 2025-03-06T17:31:00Z ([Space.com](https://www.space.com/the-universe/moon/intuitive-machines-lands-private-athena-lander-near-moon-south-pole-historic-touchdown)).
- **Lander position:** **84.7906° S, 29.1957° E**, lying on its side inside a 20 m crater (LROC, "IM-2 Athena Seen Obliquely", <https://lroc.im-ldi.com/images/1408>).

| Quantity | Ours | Horizons |
| --- | --- | --- |
| Sun azimuth | 65.662° | 65.662° |
| Sun elevation (above the geometric horizontal) | **2.466°** | 2.466° |
| Earth elevation | 11.194° | 11.194° |

At touchdown the Sun stood only about 2.5° above the horizontal plane, so long shadows and low-angle light are expected.

`horizon_el_at_sun_az_deg` and `sun_fraction` are left `null` until the DEM step writes a 2 m horizon mask for the site. To fill them:

- Call `lln.validate.im2_case(horizon_mask_cdeg=mask, az_step=0.5)`.
- Or run `python -m lln.validate`. It picks up `data/intermediate/horizon/mons_mouton.json` (key `"2"`) automatically if the file exists; use `--im2-horizon <id>` to choose another file.

Athena sat on the floor of a 20 m crater. That local relief is below the resolution of the PGDA DEMs, so a DEM horizon only describes the regional terrain.

## Limitations

- **Geometry:** the comparison checks the geometry only: frames, light time, aberration and parallax. It does not check the terrain horizon, which comes from LOLA DEMs and is validated separately, if at all.
- **Reference:** Horizons and our code share the same JPL ephemeris family and the same lunar frame definition, so agreement shows a correct implementation, not independent physical truth. The absolute accuracy of DE440 lunar orientation (meters on the surface) is far below 0.01°.
- **Sun and Earth points:** both bodies are treated as points (disk centre). The solar disk radius (about 0.267°) is applied later, in `sunFraction`.
- **Site coordinates:** the 3 validation points are test locations. Horizons received exactly the same lat/lon/alt, so errors in the published site coordinates do not affect this comparison. Elevation was set to 0 m for all three points. The 5 km spot check above covers the altitude path.
- **Time scale:** times after the last known leap second assume no new leap second. Horizons makes the same assumption, and a new leap second would shift both by at most 1 s, which is about 0.0001°.

## How to reproduce

```bash
python pipeline/scripts/download_kernels.py          # ~46 MB, once
cd pipeline
python -m lln.validate                               # live Horizons; writes data/intermediate/validation.json
python -m lln.validate --offline                     # re-use cached raw responses
python -m pytest tests/test_ephem.py tests/test_validate.py
```

## Illumination sanity check and site-point selection

The first export used each Artemis III region's grid centre as the site point. Annual sunlight (2027, 2 m)
came out implausibly low at well-known lit places: 47.6 % at Connecting Ridge and 20.8 % at Malapert, with a
2826 h longest night. We checked for a bug before changing anything:

- **DEM reader vs rasterio**: elevations sampled at 5 sites agree with GDAL/rasterio to within the
  bilinear-vs-nearest difference (1.5–40 m on slopes). There is no flip or transposition.
- **Orientation**: mirroring or rotating the horizon mask does not give plausible values, so the azimuth
  conventions of the horizon and the ephemerides agree.
- **Published reference**: Mazarico et al. (2011, *Icarus* 211) give ~86–89 % illumination for the best point
  on Connecting Ridge, near 89.45° S 137.31° W. A 5 × 5 scan at 200 m around that point found **80.9 %** on a
  1.2° slope at 2 m, and 35 % on a 10° slope 400 m away.

So the algorithm is right and illumination simply varies a lot over a few hundred metres: grid centres often
sit on slopes or in hollows. `pipeline/scripts/refine_sites.py` therefore moves each site to the best-lit
point with slope ≤ 8° within ~1 km of its published reference (300 m grid, then 75 m). The reference
coordinate and the rule are stored in `sites.yaml` and shown in the app. The IM-2 *Athena* site is fixed.

| Site | Reference point | Selected point | Moved |
| --- | --- | --- | --- |
| Peak near Shackleton | 69.3 % | **83.4 %** | 106 m |
| de Gerlache Rim 1 | 52.1 % | **81.2 %** | 474 m |
| de Gerlache-Kocher Massif | 80.1 % | 80.1 % | 0 m |
| Connecting Ridge | 47.6 % | **79.2 %** | 270 m |
| Leibnitz Beta Plateau | 21.6 % | **74.0 %** | 1145 m |
| Malapert Massif | 20.8 % | **65.7 %** | 978 m |
| Shackleton Rim | 36.6 % | 56.5 % | 474 m |
| Amundsen Rim | 25.0 % | 53.1 % | 1042 m |
| Nobile Rim 1 | 30.4 % | 47.2 % | 949 m |
| Nobile Rim 2 | 39.9 % | 44.3 % | 546 m |
| Connecting Ridge Extension | 35.3 % | 43.5 % | 1485 m |
| Faustini Rim A | 26.6 % | 41.2 % | 456 m |
| Haworth | 10.5 % | 37.1 % | 1335 m |
| Peak near Cabeus B (USGS grid centre) | 35.6 % | **62.7 %** | 300 m |
| Slater Plain (USGS grid centre) | 1.9 % | 20.6 % | 1145 m |
| de Gerlache Rim 2 | — | not moved (no point ≤ 8° within 1 km) | — |

Remaining differences from the literature (e.g. 79–81 % vs ~86–89 % on Connecting Ridge) are expected
from different DEMs, observer heights, time spans (one year vs multi-year) and our finite scan; we do not
force agreement. Connecting Ridge Extension sees the Earth 0 % of the time: from that point the Earth stays
behind the terrain all year.

## 360° panoramas vs the horizon masks

`pipeline/lln/pano.py` ray-casts an equirectangular image (1536 × 400, 0–360° × +15° to −20°) from
2 m above each site, with the same multi-scale DEMs and spherical geometry as the masks. In each
column the sky/terrain boundary must match the site's 2 m mask within 0.2°:

- 16 of 17 sites: 100 % of columns within 0.2° (e.g. Peak near Cabeus B max 0.12°, Slater Plain max
  0.09°).
- de Gerlache Rim 2: 97.7 %, because 64 columns have horizons above +15°, the top of the image; clipped
  to the image range it is 100 %.

The first-person 3D view uses the decimated terrain mesh, so its visible horizon is only approximate
(up to ~0.44° at Connecting Ridge and ~0.61° near Shackleton); the app says so and points to the 360°
view for the exact horizon.

## Any point (coarse DEM) vs the curated sites

The free-coordinate mode (`docs/freepoint.md`) recomputes the horizon in the browser from 240 m and
960 m LOLA grids, without the 5 m near field. Run at the 15 curated sites of the time, at 2 m:

- Sun/Earth azimuth and elevation from the exported MOON_ME vectors agree with the per-site SPICE series
  to ≤ 0.01°.
- Horizon mask: mean absolute error 0.25°, max 2.64°.
- 2027 sunlight: mean absolute difference 1.25 percentage points, max 4.47.

These comparisons are shown next to every free-point result; they are not error bounds for other points.

## Sun/Earth rows precision

`validation.json` keeps our and Horizons' azimuth/elevation with 9 decimals (as in the Horizons table).
Earlier files rounded the differences to 6 decimals, which displayed most of them as 0.

## Comparison with the published LOLA long-term illumination (all 17 sites)

`pipeline/scripts/literature_check.py` → `web/public/data/literature.json`, shown on the Validation page.
Reference: the LOLA average-visibility maps of Mazarico et al. (2011) (see `docs/psr.md`), which give the % of
hourly steps with **any part** of the Sun's (or Earth's) disc above the horizon over ~18.6 years. Our headline
"sunlight" is the **mean visible fraction** of the disc, a different quantity, so here ours is recomputed with
the same definition from the published masks (Sun radius 0.267°, Earth radius 0.95°), over 2026-11..2028-12.

| Site | Sun, published % | published ±1 px | Sun, ours 1 m | Sun, ours 2 m | Earth, published % | Earth, ours 1 m |
| --- | --- | --- | --- | --- | --- | --- |
| Shackleton Rim (Point A) | 54.3 | 3.7–61.4 | 55.6 | 61.1 | 35.3 | 32.3 |
| Mons Mouton (IM-2 Athena site) | 46.5 | 42.6–47.0 | 46.9 | 47.1 | 91.8 | 94.1 |
| Connecting Ridge | 65.4 | 29.5–88.4 | 72.7 | 85.3 | 52.3 | 52.0 |
| Connecting Ridge Extension | 40.8 | 38.3–46.6 | 44.1 | 46.1 | 0.1 | 0.0 |
| de Gerlache Rim 1 | 53.9 | 47.4–79.4 | 81.3 | 87.2 | 50.4 | 61.1 |
| de Gerlache Rim 2 | 36.8 | 35.0–37.8 | 37.3 | 37.5 | 54.8 | 55.6 |
| de Gerlache-Kocher Massif | 69.1 | 38.7–78.5 | 83.6 | 83.7 | 57.1 | 62.5 |
| Amundsen Rim | 50.0 | 13.6–52.3 | 55.1 | 56.2 | 54.6 | 60.2 |
| Faustini Rim A | 43.9 | 39.9–45.5 | 46.6 | 46.6 | 50.7 | 51.2 |
| Peak Near Shackleton | 61.0 | 54.2–86.0 | 84.5 | 88.5 | 53.8 | 56.7 |
| Haworth | 38.7 | 25.1–40.2 | 40.5 | 40.5 | 55.0 | 56.4 |
| Malapert Massif | 57.0 | 41.2–66.2 | 69.4 | 69.6 | 76.2 | 71.9 |
| Leibnitz Beta Plateau | 72.5 | 55.2–74.7 | 76.5 | 81.1 | 57.7 | 58.0 |
| Nobile Rim 1 | 40.7 | 40.1–46.8 | 50.5 | 52.1 | 53.2 | 53.6 |
| Nobile Rim 2 | 45.4 | 23.2–46.1 | 46.7 | 46.7 | 68.9 | 71.5 |
| Peak near Cabeus B | 56.0 | 34.6–62.2 | 65.9 | 67.5 | 56.0 | 59.8 |
| Slater Plain | 22.5 | 19.6–24.6 | 25.7 | 25.8 | 43.5 | 44.6 |

- **Earth visibility**: r = 0.984, median |Δ| = 2.35 pp (1 m). It depends only on
  geometry, the ephemeris and the horizon, so this is an independent end-to-end check.
- **Sunlight**: r = 0.914, median |Δ| = 4.04 pp at 1 m (6.78 pp at 2 m);
  ours is within 1 pp of the published ±1-pixel range at 8/17 sites and higher elsewhere.
  Sites not moved by `refine_sites.py` or moved little agree within 0.4–3 pp (Mons Mouton, de Gerlache Rim 2,
  Haworth, Faustini Rim A, Slater Plain). The large gaps are at peaks and ridges where our site was moved to
  the best-lit point on 5 m terrain: inside a single 60 m published pixel the value changes by tens of points
  (e.g. de Gerlache Rim 1: 53.9 % at the pixel, up to 79.4 % one pixel away; ours 81.3 %). Other contributors:
  observer height (1–2 m vs unstated) and our 2-year window vs ~18.6 years.
- **Connecting Ridge, resolved**: the earlier comparison (ours 79–81 % vs ~86–89 % in Mazarico et al. 2011)
  mixed definitions. With the same definition ours is 85.3 % at 2 m, and the published map reaches 88.4 % within
  one pixel of our point.


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

# LOLA clone illumination experiment (T25)

Run from the repository root with the existing Python environment:

```powershell
python -m pipeline.lln.uncertainty --coverage-only
python -m pipeline.lln.uncertainty --clones 30 --workers 3
python -m pipeline.lln.uncertainty --clones 100 --site connecting-ridge
python -m pytest pipeline/tests/test_uncertainty.py -q
```

This requires the existing horizon intermediates, their original mosaic tile cache,
and the existing SPICE kernels. Missing original cache tiles fail explicitly.
It writes only `pipeline/data/intermediate/uncertainty/` and the gitignored download
cache `pipeline/data/raw/pgda78/`. The export integration belongs to `export.py`'s
owner. No public site JSON was edited by this task.

## Source interpretation

Read on 2026-11-14: [PGDA product 78](https://pgda.gsfc.nasa.gov/products/78),
[README](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/README), and actual GeoTIFF headers
and pixels. The README describes 5 m pixel-registered south polar stereographic
rasters with X/Y in metres, in MOON_ME of DE421. The sphere is R = 1,737,400 m,
central meridian 0 degrees, latitude of origin/true scale -90 degrees, no false offsets.
Z is height in metres above that sphere. Rasterio's affine locates the outer corner;
pixel centres are at half-pixel offsets, as in `DemWindow`.

**The `_err.tif` clones contain full perturbed surfaces, not error increments.**
For Site01 clone 0001 the metadata Z range is -523.207 to 1959.351 m;
the base range is -523.183 to 1959.496 m. Direct pixel inspection confirms similar
absolute heights (both have a median near 1200.25 m). Use the clone as the surface;
adding it to the base would double the lunar terrain elevation. Both clone and base
must be valid at a pixel; NaNs are preserved. The 2 m observer follows the ground
height sampled from each realization, rather than remaining at the base elevation.
Across the complete Site01 image, clone 0001 minus base has RMS 0.443536 m,
median -0.003296 m, and p5/p95 -0.701843/+0.723511 m.

The reference paper linked by PGDA is Barker et al. (2021),
[doi:10.1016/j.pss.2020.105119](https://doi.org/10.1016/j.pss.2020.105119).
The product page maps Site01 to Connecting Ridge, Site04 to Shackleton Rim,
Site06 to Nobile Rim 1, Site07 to Peak near Shackleton, Site11/SL2 to de Gerlache,
Site20/20v2 to Leibnitz Beta, Site23 to Malapert, Site42 to de Gerlache–Kocher,
DM1 to Amundsen, DM2 to Nobile Rim 2, SL3 to Connecting Ridge Extension,
and LM7 to Faustini Rim A. Number 78 is the product identifier, not a count of sites.

## Coverage

All 27 surface links advertised by the product page were checked with 64 KiB
single-range GETs. `coverage.json` records their actual bounds, shape, full CRS WKT,
all 15 site coordinates in projected metres, and the maximum inward edge margin.
No full surfaces or clones are downloaded for unused PGDA regions.

Fourteen points meet the 3,000 m edge-margin threshold. Mons Mouton (Athena) does
not: its nearest/best rectangle is Site20v2, with signed margin -6,993.27 m.
No uncertainty result is generated for that point.

| Project point | Selected PGDA DEM | Minimum edge margin (m) |
| --- | --- | ---: |
| shackleton-rim | Site04 | 5134.68 |
| connecting-ridge | Site01 | 7776.57 |
| connecting-ridge-extension | SL3 | 8952.39 |
| de-gerlache-rim-1 | Site11 | 7551.82 |
| de-gerlache-rim-2 | SL2 | 9997.15 |
| de-gerlache-kocher-massif | Site42 | 9997.20 |
| amundsen-rim | DM1 | 9102.07 |
| faustini-rim-a | LM7 | 9548.25 |
| peak-near-shackleton | Site07 | 7922.56 |
| haworth | Haworth | 13848.08 |
| malapert-massif | Site23 | 9522.37 |
| leibnitz-beta-plateau | Site20v2 | 12022.59 |
| nobile-rim-1 | Site06 | 9097.73 |
| nobile-rim-2 | DM2 | 9472.68 |

The margin measures rectangular extent, not valid-data coverage. The horizon ray
kernel stops at an edge or nodata; per-azimuth reach is saved in diagnostics. Only
Shackleton's rectangle truncates the requested 7.5 km disc. Each other selected
rectangle includes that disc. The run also rejects clones whose valid ray coverage
differs from the base's (the retained far contribution requires the same footprint).

## Computation and the far-field limitation

Base and clone near horizons use `lln.horizon.scale_mask`, at 0.5-degree azimuth
spacing and 5 m ray steps, starting at 5 m and stopping at DEM edge/nodata or
7,500 m. The existing exact spherical great-circle geometry handles curvature.
All realizations use an observer 2 m above their own bilinearly sampled surface.

The original horizon JSON saves only the maximum across scales, not each scale's
mask or the distance of the controlling obstruction. If `H = max(N_original, F)`,
H alone cannot recover F where the original near terrain wins. Subtraction is not
an inverse of a maximum. Initially a fixed-full-mask floor was investigated; its
one-sided suppression of horizon decreases made it unsuitable for the final output.

The existing original mosaic tile cache allows the missing information to be
recovered without modifying `horizon.py` or downloading/writing outside this task's
cache. A read-only `CachedDem` replays the **original horizon's recorded scales**,
starting at the PGDA base DEM's actual per-azimuth near reach. It uses the original
nominal observer radius (`R + existing elev_m + 2`) and the original scale sampling
steps and distance limits (7.5/60/200 km). Each successive scale starts at the
previous scale's actual reach, just as the full horizon did. This identifies which
part of the existing full maximum belongs to terrain beyond the clone footprint.
Missing original cache tiles cause a clear failure, never an implicit fetch or a
flat-terrain substitution.

The combination at each azimuth, in degrees, is:

```text
F_replayed = maximum of original cached scales beyond PGDA near reach
F_retained = min(H_existing_full, round(F_replayed * 100) / 100)
H_clone = max(F_retained, N_clone)
H_base  = max(F_retained, N_PGDA78_base)
```

The replay must reach the original full-mask distance in every direction. A far
mask more than 0.021 degrees above the existing full mask fails consistency checks;
the small allowance covers the saved site's rounded elevation and centidegree
rounding. Clipping to the existing full mask retains its published angular envelope.
The boundary sample is included in both near and far segments to avoid a gap.
Every clone must have exactly the same per-ray reach as the base; otherwise the
fixed far mask would leave a gap or overlap a changed footprint and the run fails.

This permits both increases and decreases of the near horizon while leaving the
far contribution fixed. It is conditional near-field DEM uncertainty, not total
illumination uncertainty: far DEM errors, horizontal position errors, frame errors,
and instrument model errors are excluded. PGDA 78's unperturbed base differs from
the original mosaic near surface, so diagnostics report both base-combined and
original nominal light percentages. Their difference is a source/model shift,
not clone spread. The far observer radius stays nominal to keep the far mask fixed;
the near observer follows each clone's own ground. Submetre observer-height changes
to distant rays are therefore excluded by design.

`lln.ephem.site_ephem` computes 8,760 hourly samples for UTC 2027, using the
existing SPICE kernels/DE440 MOON_ME model and the nominal horizon site elevation.
Clone elevation changes to the ephemerides are neglected (submetre versus solar
distance); terrain and observer elevations do change in horizon calculations.
`lln.metrics.compute_metrics` calculates the mean visible fraction of the finite
solar disk, in percent, at the default 2 m assumptions. Masks are rounded to
integer centidegrees, matching the shared data contract.

The output is `{illum_pct_p5, illum_pct_p50, illum_pct_p95, n_clones, window,
source}`. Percentiles use NumPy's explicit `method='linear'` (Hyndman–Fan type 7),
excluding the unperturbed base. Invalid/empty/nonfinite percentages fail the run;
failed clones are never silently dropped. Diagnostics separately retain each
clone's sunlight percentage, original/base illumination, base near mask and reach.

## Downloads and reproducibility

Downloads use plain `requests`, never `/vsicurl`, HEAD, or multipart ranges.
The server's single-range responses are checked for status 206, exact byte bounds,
content length and stable total length. Complete TIFFs are assembled from a 64 KiB
header and subsequent 1 MiB ranges, with persistent HTTP sessions, bounded retries
and atomic final rename. Interrupted transfers resume only after comparing the
remote header with the partial file and checking the total length; these fixed
published clone paths are assumed immutable. Partial files are never used as raster
inputs. Environment proxy settings are
disabled for these requests because the environment's proxy closed the connection;
direct HTTPS works. No credentials are used.

The default experiment uses the first 30 numbered clones (0001–0030), rather than
100, to bound download time and cache size. Selection is deterministic, not based
on illumination outcomes. Tail quantiles from only 30 samples are sampling-limited.
Use `--clones 100` for the larger ensemble. The real DEM cache is reusable.

The source frames differ (PGDA DE421 versus existing pipeline DE440). No additional
frame transformation is applied; this is another limitation of the experiment.

## Validation

Eleven synthetic tests cover linear percentile values and ordering, singleton and
invalid input, full-surface clone application, nodata, distant-mask preservation,
actual ray-kernel behavior under uniform translation and a raised ridge, and
replayed far masks that permit a lowered near obstruction while retaining a far ridge.
Synthetic arrays exist only in the test module. The complete pipeline suite passed
90 tests using an isolated pytest temp directory; the default system pytest temp
directory initially failed with Windows access denied. There is one pre-existing
pytest plugin deprecation warning.

The complete 30-clone Shackleton run measured p5/p50/p95 =
52.490901/54.195375/55.844238 percent. Its PGDA base gives 56.506508 percent,
versus 56.548308 percent for the existing full mask (a -0.041800 percentage-point
source/model shift). Individual clone percentages range from 51.313583 to
56.689282. Replaying with a 7.6 km projected crop padding reproduced these numbers.
The full base-plus-30-clone transfer is estimated from raster dimensions at
28.91 GB (26.93 GiB), before negligible TIFF metadata; raw cache capacity was checked.

Connecting Ridge clone 0015 was checked after producing 61.656282 percent
sunlight. In its near window the surface difference from base has RMS 0.435102 m;
the observer ground changes from 1947.373864 to 1946.187187 m. The near-horizon
change has p5/p50/p95 0.090825/0.657496/1.863977 degrees. This independently explains
why a realization with a lower observer ground can have substantially less sunlight.

<!-- UNCERTAINTY RESULTS -->

## Measured results

This table updates after each completed site. Pending means no complete ensemble output yet.

| Site | DEM | Clones | p5 (%) | p50 (%) | p95 (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shackleton-rim | Site04 | 30 | 52.4909 | 54.1954 | 55.8442 |
| mons-mouton | Not covered | — | — | — | — |
| connecting-ridge | Site01 | 30 | 68.9837 | 78.8403 | 81.4161 |
| connecting-ridge-extension | SL3 | Pending | — | — | — |
| de-gerlache-rim-1 | Site11 | Pending | — | — | — |
| de-gerlache-rim-2 | SL2 | Pending | — | — | — |
| de-gerlache-kocher-massif | Site42 | Pending | — | — | — |
| amundsen-rim | DM1 | Pending | — | — | — |
| faustini-rim-a | LM7 | Pending | — | — | — |
| peak-near-shackleton | Site07 | Pending | — | — | — |
| haworth | Haworth | Pending | — | — | — |
| malapert-massif | Site23 | Pending | — | — | — |
| leibnitz-beta-plateau | Site20v2 | Pending | — | — | — |
| nobile-rim-1 | Site06 | Pending | — | — | — |
| nobile-rim-2 | DM2 | Pending | — | — | — |

# Slopes and sampled landing area

Task B owns `web/src/lib/hazard.ts`, `web/src/components/SlopeMap.tsx`,
`web/src/styles/slope.css`, and `web/src/lib/tests/hazard.test.ts`.
This document is the threshold register for this card (rather than modifying
the assumptions file owned by another agent). No new dependencies.

## Data and method

The card lazily calls the existing `loadTerrain` decoder/cache; it uses only
the near grid, although that loader also retrieves the small far grid. Successful
calculation promises are memoized per site, including simultaneous mounts.
Failed loads are evicted; unmounted/stale requests cannot change another site's UI.
No result is substituted when data are missing. The input is the shipped
`terrain/<id>.json` and little-endian int16 `.near.bin`; the existing decoder
applies metadata scale/offset and converts -32768 to NaN.

Coordinates follow `contracts-3d.md`: x east, y north, row zero north,
origin at the actual site. Add `(x²+y²)/(2R)` to decoded tangent height to
remove the baked-in spherical drop. R is the pipeline reference sphere,
not an independently fitted terrain radius. This is the requested parabolic
approximation; elevation-dependent curvature and higher-order terms are not
modelled. Heights in the readout and relief use the corrected relative height,
not absolute lunar elevation. Central differences are
`dz/dx = (zEast-zWest)/(2*res)` and `dz/dy = (zNorth-zSouth)/(2*res)`;
the slope is `atan(hypot(dz/dx,dz/dy))` in degrees. The centre and all four
neighbours must be finite. A one-node derivative halo is read outside the map.
Inputs must cover the full map plus that halo; insufficient extent is rejected.

The shipped 1024-node even grids place the origin between four nodes. The
site-cell slope uses the nearest southeast node (east +5 m, north -5 m at
10 m spacing). Circles and relief use distances from the **exact origin**.
This differs from the existing `slope_deg_50m` site-selection estimator and
must not overwrite that metric. Some newly calculated site slopes or nearby
nodes can exceed the original selection threshold.

All percentages count equal-area node centres inside the inclusive radius,
divided by **all** such centres, including unknown slopes. Unknown percentage
is shown separately. This is a sampled-area approximation, not a polygonal
area integration. Relief is max-minus-min of finite corrected heights;
its known-height percentage is independent of slope coverage. All-missing
relief and site slope are null, not zero.

A passing circle contains only known node slopes at or below 8°. The largest
site-centred radius is rounded **down to a grid step**, strictly excluding
the nearest failing/unknown node. Zero means no positive tested radius passes;
null means the chosen site-cell slope is unknown. A wholly passing window
is labelled coverage-limited. The nearest-circle search tests the exact origin
first, then every grid node within 1 km. Every candidate is checked using
inclusive discrete circular row spans and prefix sums of failing/unknown
nodes. Candidates must fit inside coverage. Choose minimum Euclidean distance;
ties use north-to-south, then west-to-east order. Bearings are clockwise from
north, and undefined (null) for zero distance. No candidate yields null.
This is a nearest **tested grid-centre** location, not a continuous optimiser.

The 10 m spacing and the 20 m central-difference baseline smooth metre-scale
boulders and small craters. Interpret roughness as a lower-bound estimate,
not a mathematical bound on each local derivative and not flight-safety
certification. A symmetric cone apex can have zero central-difference slope.
Passing sampled nodes cannot establish that intervening terrain is safe.

## Named constants and UI disclosure

| Constant | Value | Purpose |
| --- | --- | --- |
| `SAFE_SLOPE_DEG` | 8° inclusive | Existing site-selection threshold; grid screening, not a NASA requirement. |
| `MODERATE_SLOPE_DEG` | 15° inclusive | Second descriptive area threshold, not a vehicle limit. |
| `SLOPE_BANDS_DEG` | 5, 8, 15, 25° | Upper-inclusive display bins; last finite bin >25°. Unknown is separate. |
| `WINDOW_HALF_M` | 2000 m | Map/analysis half-width; node centres lie inside ±2 km. |
| `CIRCLE_RADII_M` | 50, 100, 250, 500 m | Site-centred area summaries. |
| `SAFE_CIRCLE_RADIUS_M` | 100 m | Radius of a fully passing candidate disk. |
| `SEARCH_RADIUS_M` | 1000 m inclusive | Candidate-centre distance bound. |
| `RELIEF_RADIUS_M` | 500 m inclusive | Local relief footprint. |
| `MOON_RADIUS_M` | 1,737,400 m | Same reference sphere as `pipeline/lln/dem.py`. |
| `MAP_RING_RADII_M` | 100, 500 m | Dashed reference rings. |
| `SCALE_BAR_M` | 1000 m | Map scale bar. |

Grid resolution, quantisation and source come from metadata, not constants.
The card exposes thresholds, rings, scale, source and coverage; its expandable
method text explains the radius step (metadata spacing), denominator, nodata,
curvature constant, search tie-break and sampling limitations. Texture/label
pairs supplement colour; arrow keys inspect individual cells without row wrap.
The map raster is retained so pointer movement only redraws the cursor overlay.
Layout uses existing dashboard variables and wraps at 320 px; canvas intrinsic
dimensions are 600 × 600 for rendering only, not a physical/data resolution.
Print uses the same canvas and summary. The host must wait for loading before
opening print preview. No browser/print visual validation was available here.

## Validation against shipped data

Node 20.20.0, six calculation runs per decoded site. Observed compute time
12.9–35.8 ms, excluding fetch, decoding and canvas painting; below the ~150 ms
target in this environment, not a guarantee on every laptop/browser.
All four near grids are **10 m**, including Peak near Cabeus B: its source
is PGDA 90 LOLA **10 m/px (83S)** and its near grid does **not** change spacing.
The other three sources are PGDA 81 LOLA 5 m/px (87S), resampled to 10 m.
All tabulated circles have 100% known slopes and relief has 100% known heights.

| Site | Site slope ° | Largest passing radius m | Nearest 100 m disk distance m / bearing ° | Relief within 500 m |
| --- | ---: | ---: | --- | ---: |
| connecting-ridge | 3.539 | 20 | 96.177 / 278.973 | 74.200 m |
| peak-near-shackleton | 0.405 | 150 | 0 / undefined | 53.729 m |
| slater-plain | 7.325 | 10 | 193.003 / 16.557 | 144.304 m |
| peak-near-cabeus-b | 4.583 | 20 | 88.600 / 16.390 | 135.700 m |

Percentages below are **≤8° / ≤15°**, in circles centred on the site:

| Site | 50 m (80 nodes) | 100 m (316 nodes) | 250 m (1976 nodes) | 500 m (7860 nodes) |
| --- | --- | --- | --- | --- |
| connecting-ridge | 98.750 / 100 | 94.304 / 100 | 86.285 / 97.419 | 65.051 / 96.183 |
| peak-near-shackleton | 100 / 100 | 100 / 100 | 98.735 / 100 | 80.458 / 99.962 |
| slater-plain | 73.750 / 100 | 61.709 / 100 | 54.808 / 99.899 | 49.962 / 99.148 |
| peak-near-cabeus-b | 87.500 / 100 | 89.557 / 100 | 71.306 / 99.798 | 43.359 / 93.740 |

Eight test cases cover flat and two-axis planes, a cone, nodata propagation,
all-missing terrain, even-grid origin and deterministic ties, an offset disk
with explicit validation of every contained node, legend edges and invalid
inputs. Vitest execution is blocked in the sandbox: compile with TypeScript,
then run the same test callbacks/assertions in Node with only `describe`/`it`
replaced by synchronous wrappers. No assertions or fixtures are replaced.

Requested `npx tsc -b` / `npx eslint src` hit Windows EPERM resolving the user
directory in npx. The installed tools succeed via equivalent direct commands:

```powershell
node --preserve-symlinks --preserve-symlinks-main node_modules/typescript/bin/tsc -b
node --preserve-symlinks --preserve-symlinks-main node_modules/eslint/bin/eslint.js src
```

Translation handoff: `keys-slope.json` at the task's scratchpad path contains
English fallback keys and Spanish translations. Locale merging and mounting
are deliberately left to the integrating agent; no existing files were edited.

```tsx
import SlopeMap from '../components/SlopeMap';
<SlopeMap siteId={site.id} siteName={site.name} />
```

`siteId: string` is required; `siteName?: string` is optional (the index entry
has a name, the full `SiteData` object does not). No time/mission props needed.

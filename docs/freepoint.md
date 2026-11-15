# Free coordinates (Task C)

Implemented as an optional standalone map route and an embeddable `FreePointPanel`.
No existing application, metric, locale, map, or stylesheet was changed. All published
assets are derived from real LOLA terrain and the existing SPICE kernels. No packages
were installed. The shared raw-data junction was read without writing to it; missing
outer-grid tiles were fetched into memory using the existing NASA range-request code.

## Run and integrate

Real assets are already present in `web/public/data/free/`. To regenerate:

```powershell
cd pipeline
python -m lln.freepoint
cd ../web
$env:FREEPOINT_MEASURE='1'
npx vitest run src/lib/tests/freepoint.test.ts
Remove-Item Env:FREEPOINT_MEASURE
npm run dev
```

The generator removes stale `accuracy.json`. The measurement test writes a fresh
report only with `FREEPOINT_MEASURE=1`. The loader checks its generation timestamp
against the assets; missing/stale reports display an explicit unmeasured notice.
If the generator cannot access the cache/network, it raises instead of publishing
invented terrain. The reviewer can rerun `python -m lln.freepoint` from `pipeline/`.

Reviewer additions to App.tsx (inside the existing router/navigation):

```tsx
import { FreePointExplorer } from './components/FreePointPanel';

// Inside Routes:
<Route path="/free" element={<FreePointExplorer />} />

// Beside the existing navigation links (use the existing to/cls helpers):
<NavLink to={to('/free')} className={cls}>{t('Free coordinates')}</NavLink>
```

This provides a complete clickable basemap, keyboard coordinate form, panel,
and nearest-curated-site comparison without needing to change SiteMap.
Optional integration into the existing map instead:

```tsx
import FreePointPanel from '../components/FreePointPanel';
import { pointFromMapPixel } from '../lib/freepoint';

const [freePoint, setFreePoint] = useState<{lat: number; lon: number} | null>(null);

// In the basemap SVG's onClick, when free-coordinate mode is enabled:
const matrix = event.currentTarget.getScreenCTM();
if (matrix && basemap) {
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  setFreePoint(pointFromMapPixel(basemap, p.x, p.y));
}

// Mount below the map. Retain the coordinate form as a keyboard alternative.
{freePoint && <FreePointPanel {...freePoint} onClose={() => setFreePoint(null)} />}
```

`getScreenCTM().inverse()` accounts for viewBox cropping, aspect ratio and scaling;
do not equate CSS pixels to basemap pixels. Curated marker handlers should stop
propagation if integrated into the existing map. Do not wrap its markers in a
second interactive element. The standalone route avoids that interaction conflict.

Merge `en` and `es` from the requested scratchpad `keys-free.json` into the existing
locale dictionaries. Until the reviewer merges it, new English keys are readable
fallbacks but new Spanish text is not active. No locale files were edited here.

## Data and numerical assumptions

* `vectors.bin`: little-endian float32, kilometres, shape `[19008, 2, 3]`,
  hourly rows containing Sun xyz followed by Earth xyz. Uses `ephem.body_positions`,
  DE440, MOON_ME and LT+S, starting 2026-11-01 UTC and ending before 2029-01-01.
  This preserves the pipeline's Moon-centred apparent-position approximation;
  browser observer subtraction includes parallax but does not recompute aberration
  or light time at each surface observer. No atmospheric refraction.
* Observer ephemerides use ground elevation, exactly like published site files;
  mast heights affect the horizon only, again matching the existing metrics.
* Terrain source: NASA PGDA 90
  `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF`.
  Values are metres above the spherical 1737.4 km LOLA reference surface.
* `inner.bin`: 1696 square, 240 m pixels; covers the whole +/-200 km basemap with
  interpolation margin. `outer.bin`: 856 square, 960 m pixels, covering beyond
  +/-410 km. Each outer value is the maximum of its real 4x4 native pixels, before
  rounding. This retains distant peaks better than averaging, but can raise their
  apparent altitude and is not a rigorous upper bound after interpolation.
* Grids are int16 LE row-major; 1 metre quantization, -32768 reserved for nodata;
  `left/top` are outer pixel corners and samples use pixel centres. Float32
  vectors plus both grids total **7,674,496 bytes**, excluding small JSON headers
  and the existing basemap image. Terrain loads only upon opening a point.
* Bilinear interpolation; inner terrain preferred wherever available, otherwise
  outer. A missing sample stops the calculation with an error, never a flat mask.
  All four map corners and edge midpoints were tested for full 200 km coverage.
* Great-circle rays every 0.5 degrees, 240 m distance increments plus a final
  sample exactly at 200 km. Sample direction is `u = cos(d/R)u0 + sin(d/R)t`;
  stereographic x/y is `2R*(uy,ux)/(1-uz)`. Horizon elevation is
  `atan2((R+z)*cos(d/R)-(R+z0+h), (R+z)*sin(d/R))`.
  This is the exact spherical curvature used by horizon.py, not a parabolic drop.
* Heights 1/2/5/10 m are computed in one pass; 2 m default. There are **no samples
  inside 240 m**, no 5/10/20 m near-field terrain, no local slope or clone estimate.
  A narrow nearby obstacle can therefore be missed. Centidegrees round to nearest;
  JS/Python differ in exact half-tie convention, insignificant here and covered by
  the 0.01 degree comparison tolerance. Map bounds allow a 1 micrometre numerical
  tolerance so a coordinate converted from an exact edge is not rejected.
* Domain is the actual +/-200 km square basemap, not a latitude cutoff at -84.
  Its corners extend farther north than its edge midpoints. This deliberate change
  supports **any point within the basemap**, as requested. Outside points fail.
* Panel window: all 8760 hours of 2027 UTC. Existing `computeMetrics` is unchanged:
  solar radius 0.267 degrees, day at >=50% disk, Earth centre >=0.5 degrees above
  horizon, height selector default 2 m. Annual sunlight is the mean solar disk
  fraction, not the percentage of hours classified as day.
* Nearest curated site is determined by spherical angular distance, with no
  arbitrary distance cutoff. The expanded comparison uses the same annual window
  and selected height. The link opens the existing curated comparison page;
  free points are not added to its curated-site store. All metrics remain available
  through the returned ordinary `SiteData` and `getSeries`/`computeMetrics` APIs.

The panel visibly labels coarse accuracy and all metric/terrain thresholds, shows
the measured errors and distinguishes them from bounds at untested coordinates.
Progress is announced through a live region; changes/unmount terminate the old
worker so stale computations cannot overwrite the new point. Fetch errors are
recoverable by reselecting a point. The form provides labelled native keyboard
controls, wrapping layout, and no fixed-width page/chart. Colours and focus styles
are inherited from the existing UI; visual 320 px/WCAG verification remains for
the integration reviewer because the parallel restyling is not final here.

## Measured accuracy and performance

Browser algorithm tested at **all 15 published sites**, 720 azimuths each, 2 m:

| Measurement | Result |
| --- | ---: |
| Mean absolute mask error over 10,800 samples | 0.248374 degrees |
| Maximum absolute mask error | 2.64 degrees (Malapert Massif) |
| Mean absolute 2027 sunlight difference | 1.254414 percentage points |
| Maximum absolute 2027 sunlight difference | 4.470595 percentage points (Connecting Ridge Extension) |
| Max Sun/Earth az/el difference, published ground elevation | 0.01 degrees |

Sunlight comparison is end-to-end: coarse ground height, coarse mask and exported
float32 vectors versus each published file. The separate ephemeris parity test
uses the published elevation to isolate vector/projection precision. Errors are
not uncertainty intervals and are not guaranteed elsewhere or at other heights.
Per-site values and signed sunlight differences are in `free/accuracy.json`.

Node 20 executed the same browser computation: the first measured pass peaked at
65.4 ms per site; the warm run after map-boundary tests peaked at 26.7 ms. Timing
includes mask plus 19008-hour ephemeris, excludes asset download, React rendering
and metrics. **No real phone was tested**; <3 seconds is a target, not a claim.

## Checks (2026-11-15)

* Requested `npx tsc -b`, `npx eslint src`, `npx vitest run` were attempted.
  npx hits sandbox `EPERM lstat C:\Users\andre` before package execution.
* Direct `node --preserve-symlinks --preserve-symlinks-main
  node_modules/typescript/bin/tsc -b` passed, as did the equivalent ESLint command
  `node_modules/eslint/bin/eslint.js src`.
* Vitest still cannot load its config with those flags: esbuild cannot read an
  ancestor directory (access denied). This is a sandbox/config-loading failure.
* Honest fallback: transpiled the unchanged six freepoint test bodies and their
  production imports with the installed TypeScript compiler, loaded them in Node,
  and supplied a small `node:assert/strict` adapter for their Vitest matchers.
  All six passed, including all-site ephemeris parity/accuracy and eight boundary
  coordinates. The report was written by that same measurement test. This is not
  a claim that the complete existing Vitest suite ran.
* `python -m pytest pipeline/tests -q -p no:cacheprovider
  --basetemp="$env:TEMP\lln-ext"`: **129 passed**, one existing anyio deprecation warning.
* `python pipeline/scripts/check_data.py`: **0 problems**. Free binary contracts
  are additionally checked by four new Python tests (all passed).

Open integration items: add route/navigation or mount on the existing map, merge
translations, and verify the final UI at 320 px and on a real phone. No existing
owned-by-other-agent files or git state were changed by this task.

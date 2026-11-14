# Data & module contracts

Frozen at kickoff. Types live in `web/src/lib/types.ts` (single source of truth for field names).
`pipeline/` and `web/` communicate **only** through JSON in `web/public/data/`.

## Conventions

- Degrees in everything that crosses into the app; radians only inside functions.
- `*_cdeg` = integer hundredths of a degree.
- Azimuth from local north, clockwise (JPL Horizons convention). Longitude east-positive.
- Times: UTC ISO 8601 with `Z`. Ephemeris is hourly from `2026-11-01T00:00:00Z`, `n = 19008` (to 2029-01-01, exclusive).
- Horizon: `az_step_deg = 0.5` → 720 samples, index 0 = north. MVP height key `"2"` (2 m). Other heights optional.
- No fake data is ever published. Synthetic fixtures live only under `pipeline/tests/` and `web/src/lib/tests/`.

## Files

| File | Writer | Shape |
| --- | --- | --- |
| `web/public/data/sites.json` | `pipeline/lln/export.py` | `SiteIndexEntry[]` |
| `web/public/data/sites/<id>.json` | `pipeline/lln/export.py` | `SiteData` |
| `web/public/data/validation.json` | `pipeline/lln/validate.py` (copied by export) | `ValidationData` |
| `web/public/data/basemap.png` + `basemap.json` | `pipeline/lln/export.py` | `Basemap` |

Pipeline intermediates (not committed):

- `pipeline/data/intermediate/horizon/<id>.json` → `{ id, az_step_deg, heights_m, elev_cdeg, max_dist_m, slope_deg_50m, dem_res_m, dem_source, elev_m }`
- `pipeline/data/intermediate/ephem/<id>.json` → the `ephem` object of `SiteData`
- `pipeline/data/intermediate/validation.json` → `ValidationData`

## Web engine API (`web/src/lib/`)

```ts
// data.ts — all fetches use import.meta.env.BASE_URL
loadSites(): Promise<SiteIndexEntry[]>
loadSite(id: string): Promise<SiteData>          // cached per id
loadBasemap(): Promise<Basemap>
loadValidation(): Promise<ValidationData | null>

// sunFraction.ts
SUN_RADIUS_DEG = 0.267
sunFraction(sunElDeg, horizonElDeg): number      // 0..1
horizonAt(maskCdeg, azDeg, stepDeg = 0.5): number // degrees, circular interpolation

// metrics.ts
DEFAULT_ASSUMPTIONS: Assumptions                 // { heightM: 2, dayFraction: 0.5, earthMarginDeg: 0.5 }
hourIndex(site: SiteData, utc: string | Date): number   // floor, may be out of range
timeAtIndex(site: SiteData, i: number): Date
getSeries(site, a): Series   // cached; { sunFrac: Float32Array, earthVis: Uint8Array, sunAz, sunEl, earthAz, earthEl: Float32Array (deg), horizonSunEl, horizonEarthEl }
computeMetrics(site, startUtc, hours, a): Metrics

// score.ts
DEFAULT_WEIGHTS: Weights
score(m: Metrics, w: Weights, maxNightH = 336): number   // 0..100
rankAlternatives(sites: Map<string, SiteData>, index: SiteIndexEntry[], input: ReplanInput, a: Assumptions): RankedOption[] // top 10
```

## Metric definitions

| Metric | Definition |
| --- | --- |
| lightPct | mean of sunFraction over the window, % |
| longestDayH | longest run of hours with sunFraction ≥ dayFraction |
| longestNightH | longest run with sunFraction < dayFraction |
| earthPct | % of hours with earth_el − horizon(earth_az) ≥ earthMarginDeg |
| hoursToSunset | hours from start to first hour with sunFraction < dayFraction (0 if dark at start; null if beyond data) |
| hoursToEarthset | same with Earth visibility |
| nextEarthWindow | start and duration of the next visible Earth run starting at/after start |
| sunElAtLandingDeg | sun_el − horizon(sun_az) at the start hour |

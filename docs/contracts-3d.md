# 3D and 360° data contracts

Extends `docs/contracts.md`. Frozen before parallel work. All binaries are little-endian, row-major,
lazy-loaded only when the 3D / 360° views open.

## Local frame

Every 3D/360 product uses the site's **local tangent frame**: origin at the ground point of the site
(`elev_m`), axes **x = east, y = north, z = up** (metres). Curvature is **baked in**: a terrain point P on
the sphere is stored at its tangent-frame coordinates, so `z` already includes the drop (≈ d²/2R).
Grids are regular in (x, y): column i → x = (i − (N−1)/2)·res_m, row j → y = ((N−1)/2 − j)·res_m
(row 0 is the **north** edge). Height of grid node = z of the terrain point whose tangent-plane
projection is (x, y).

## Terrain heightmaps — `web/public/data/terrain/<id>.json` + `.near.bin` + `.far.bin`

Writer: `pipeline/lln/terrain.py`.

```json
{
  "id": "connecting-ridge",
  "frame": "local ENU tangent plane at site, curvature included",
  "near": { "file": "connecting-ridge.near.bin", "n": 1024, "res_m": 10, "dtype": "int16", "scale_m": 0.1, "offset_m": 0, "source": "PGDA 81 LOLA 5 m/px" },
  "far":  { "file": "connecting-ridge.far.bin",  "n": 256,  "res_m": 400, "dtype": "int16", "scale_m": 1.0, "offset_m": 0, "source": "PGDA 90 LOLA 240 m/px" },
  "site_elev_m": 1947.3,
  "observer_heights_m": [1, 2, 5, 10]
}
```

`z_m = value * scale_m + offset_m`. Choose `scale_m` per file so values fit int16 (e.g. near 0.1 m, or 0.25 m
when relief > 3.2 km; far 1 m). Nodata: −32768. The far grid covers ±51 km and overlaps the near grid; the
viewer hides far cells inside the near extent.

## Immersive panorama — `web/public/data/pano/<id>.json` + `.dist.bin` + `.normal.bin`

Writer: `pipeline/lln/pano.py`. Equirectangular, seen from 2 m above the site.

```json
{
  "id": "connecting-ridge", "observer_height_m": 2,
  "width": 2048, "height": 400,
  "az0_deg": 0, "el_top_deg": 15, "el_bottom_deg": -20,
  "dist": { "file": "connecting-ridge.dist.bin", "dtype": "uint16", "unit_m": 4, "sky": 0 },
  "normal": { "file": "connecting-ridge.normal.bin", "dtype": "uint8x2", "encoding": "octahedral, local ENU" },
  "max_dist_m": 200000
}
```

- Column c is centred on azimuth `(c + 0.5) * 360 / width` (from north, clockwise). Row r is centred on
  elevation `el_top − (r + 0.5) * (el_top − el_bottom) / height`.
- `dist` = distance along the ray to the first terrain hit, in `unit_m` steps (max 262 km); `0` = sky.
- `normal` = unit terrain normal at the hit in local ENU, octahedral-encoded in 2 bytes; sky pixels = 0,0.
- Consistency: in each column, the boundary between sky and terrain must match the 2 m horizon mask of
  `sites/<id>.json` within 0.2°.

## Uncertainty — fills `uncertainty` in `sites/<id>.json` (already in the contract)

Writer: `pipeline/lln/uncertainty.py` → `pipeline/data/intermediate/uncertainty/<id>.json`
`{ "illum_pct_p5", "illum_pct_p50", "illum_pct_p95", "n_clones", "window": "2027", "source" }`;
`export.py` copies it when present (integration step).

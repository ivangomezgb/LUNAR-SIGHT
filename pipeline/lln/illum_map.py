"""Illumination map: % of the year with the Sun (and the Earth) above the real horizon, for every
~80 m cell of the 10 x 10 km terrain published around each site.

Derived only from published products (no DEM download): the near (10 m) and far (400 m)
terrain grids in web/public/data/terrain/ and each site's 2 m horizon mask and ephemerides in
web/public/data/sites/. It is the same horizon model the mission game uses at the rover
(web/src/game/sim/visibility.ts): a ray march over both grids in the observer's own local
vertical, plus the part of the site mask that lies beyond the grids (tilt-corrected).

Output, per site (docs/contracts-3d.md):
  web/public/data/illum/<id>.json   metadata
  web/public/data/illum/<id>.bin    uint8 G*G sunlight then uint8 G*G Earth visibility,
                                    row 0 = north edge, value = percent * 2 (0..200)

    python -m lln.illum_map [--site ID ...] [--grid 128] [--year 2027]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from numba import njit, prange

PIPELINE_DIR = Path(__file__).resolve().parents[1]
DATA = PIPELINE_DIR.parent / "web" / "public" / "data"
OUT = DATA / "illum"
R_MOON_M = 1737400.0
SUN_RADIUS_DEG = 0.267
EYE_M = 2.0
AZ_STEP = 2.0  # deg, per-cell horizon sampling (the solar disk is 0.53 deg; interpolated)
FAR_TOL_DEG = 0.1
EARTH_MARGIN_DEG = 0.5


def load_grid(spec: dict, folder: Path) -> np.ndarray:
    raw = np.fromfile(folder / spec["file"], dtype="<i2").astype(np.float64)
    z = raw * spec["scale_m"] + spec["offset_m"]
    z[raw == -32768] = np.nan
    n = spec["n"]
    return z.reshape(n, n)


@njit(cache=True)
def _bilinear(z, res, x, y):
    n = z.shape[0]
    c = x / res + (n - 1) / 2.0
    r = (n - 1) / 2.0 - y / res
    c0 = math.floor(c)
    r0 = math.floor(r)
    if c0 < 0 or r0 < 0 or c0 + 1 >= n or r0 + 1 >= n:
        return np.nan
    fc = c - c0
    fr = r - r0
    i, j = int(r0), int(c0)
    return (z[i, j] * (1 - fc) * (1 - fr) + z[i, j + 1] * fc * (1 - fr)
            + z[i + 1, j] * (1 - fc) * fr + z[i + 1, j + 1] * fc * fr)


@njit(cache=True)
def _height(near, nres, far, fres, near_lim, x, y):
    if abs(x) <= near_lim and abs(y) <= near_lim:
        return _bilinear(near, nres, x, y)
    return _bilinear(far, fres, x, y)


@njit(cache=True)
def _march(near, nres, far, fres, near_lim, x, y, eye, az_deg):
    """Horizon elevation (deg) from eye m above (x, y) along az; NaN without terrain."""
    ground = _height(near, nres, far, fres, near_lim, x, y)
    if not (ground == ground):
        return np.nan
    oz = ground + eye
    ul = math.sqrt(x * x + y * y + (ground + R_MOON_M) ** 2)
    ux, uy, uz = x / ul, y / ul, (ground + R_MOON_M) / ul
    sx, sy = math.sin(math.radians(az_deg)), math.cos(math.radians(az_deg))
    best = -2.0
    d = nres
    while True:
        px, py = x + d * sx, y + d * sy
        is_near = abs(px) <= near_lim and abs(py) <= near_lim
        z = _height(near, nres, far, fres, near_lim, px, py)
        if not (z == z):
            break
        vx, vy, vz = px - x, py - y, z - oz
        s = (vx * ux + vy * uy + vz * uz) / math.sqrt(vx * vx + vy * vy + vz * vz)
        if s > best:
            best = s
        d += nres if is_near else fres / 2.0
    if best < -1.5:
        return np.nan
    return math.degrees(math.asin(best))


@njit(cache=True, parallel=True)
def cell_horizons(near, nres, far, fres, near_lim, xs, ys, eye, far_only, mask_step, az_step):
    """Horizon (deg) per cell and azimuth: max(local march, far-only site mask + tilt)."""
    n_cells, n_az = xs.shape[0], int(round(360.0 / az_step))
    out = np.empty((n_cells, n_az), dtype=np.float32)
    n_mask = far_only.shape[0]
    for k in prange(n_cells):
        for a in range(n_az):
            az = a * az_step
            local = _march(near, nres, far, fres, near_lim, xs[k], ys[k], eye, az)
            far_el = far_only[int(round(az / mask_step)) % n_mask]
            if far_el > -50.0:
                along = xs[k] * math.sin(math.radians(az)) + ys[k] * math.cos(math.radians(az))
                far_el += math.degrees(along / R_MOON_M)
            h = local if local == local else -90.0
            out[k, a] = max(h, far_el)
    return out


@njit(cache=True)
def _sun_fraction(sun_el, hz):
    u = (sun_el - hz) / SUN_RADIUS_DEG
    if u >= 1.0:
        return 1.0
    if u <= -1.0:
        return 0.0
    return 1.0 - (math.acos(u) - u * math.sqrt(1.0 - u * u)) / math.pi


@njit(cache=True)
def _interp(row, az, step):
    n = row.shape[0]
    x = (az % 360.0) / step
    i = int(math.floor(x))
    f = x - i
    return (1 - f) * row[i % n] + f * row[(i + 1) % n]


@njit(cache=True, parallel=True)
def accumulate(horizons, az_step, sun_az, sun_el, earth_az, earth_el, earth_margin):
    """Mean visible solar fraction and Earth-visible share per cell over the given hours."""
    n_cells, n_h = horizons.shape[0], sun_az.shape[0]
    light = np.zeros(n_cells)
    earth = np.zeros(n_cells)
    for k in prange(n_cells):
        row = horizons[k]
        s = 0.0
        e = 0.0
        for t in range(n_h):
            s += _sun_fraction(sun_el[t], _interp(row, sun_az[t], az_step))
            if earth_el[t] - _interp(row, earth_az[t], az_step) >= earth_margin:
                e += 1.0
        light[k] = s / n_h
        earth[k] = e / n_h
    return light, earth


def site_inputs(sid: str, data: Path = DATA):
    site = json.loads((data / "sites" / f"{sid}.json").read_text(encoding="utf-8"))
    meta = json.loads((data / "terrain" / f"{sid}.json").read_text(encoding="utf-8"))
    near = load_grid(meta["near"], data / "terrain")
    far = load_grid(meta["far"], data / "terrain")
    return site, meta, near, far


def far_only_mask(site, near, nres, far, fres, near_lim):
    """Site mask where it is higher than the site's own ray march (obstacle beyond the grids)."""
    mask = np.asarray(site["horizon"]["elev_cdeg"]["2"], dtype=np.float64) / 100
    step = site["horizon"]["az_step_deg"]
    out = np.full(mask.shape[0], -90.0)
    for i, m in enumerate(mask):
        local = _march(near, nres, far, fres, near_lim, 0.0, 0.0, EYE_M, i * step)
        if not (local >= m - FAR_TOL_DEG):
            out[i] = m
    return out, step


def year_window(site, year: int):
    eph = site["ephem"]
    t0 = datetime.fromisoformat(eph["t0_utc"].replace("Z", "+00:00"))
    a = datetime(year, 1, 1, tzinfo=timezone.utc)
    b = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    i0 = int((a - t0).total_seconds() // 3600 // eph["step_h"])
    i1 = int((b - t0).total_seconds() // 3600 // eph["step_h"])
    if i0 < 0 or i1 > eph["n"]:
        raise ValueError(f"{year} outside the ephemeris coverage")
    arr = lambda body, k: np.asarray(eph[body][k][i0:i1], dtype=np.float64) / 100
    return arr("sun", "az_cdeg"), arr("sun", "el_cdeg"), arr("earth", "az_cdeg"), arr("earth", "el_cdeg")


def compute(sid: str, grid: int = 128, year: int = 2027, data: Path = DATA, points=None):
    """Returns (meta, light[G,G], earth[G,G]) or, with `points`, the values at those (x, y)."""
    site, tmeta, near, far = site_inputs(sid, data)
    nres, fres = float(tmeta["near"]["res_m"]), float(tmeta["far"]["res_m"])
    half = (tmeta["near"]["n"] - 1) / 2 * nres
    near_lim = half - nres
    extent = half - 2 * nres
    far_only, mask_step = far_only_mask(site, near, nres, far, fres, near_lim)
    if points is not None:
        xs = np.array([p[0] for p in points], dtype=np.float64)
        ys = np.array([p[1] for p in points], dtype=np.float64)
    else:
        cell = 2 * extent / grid
        c = -extent + (np.arange(grid) + 0.5) * cell
        gx, gy = np.meshgrid(c, -c)  # row 0 = north
        xs, ys = gx.ravel().astype(np.float64), gy.ravel().astype(np.float64)
    hz = cell_horizons(near, nres, far, fres, near_lim, xs, ys, EYE_M, far_only, mask_step, AZ_STEP)
    light, earth = accumulate(hz, AZ_STEP, *year_window(site, year), EARTH_MARGIN_DEG)
    if points is not None:
        return light, earth
    meta = {
        "id": sid, "grid": grid, "cell_m": round(2 * extent / grid, 3), "half_m": round(extent, 3),
        "window": str(year), "observer_height_m": EYE_M,
        "light": {"file": f"{sid}.bin", "offset": 0, "dtype": "uint8", "scale_pct": 0.5},
        "earth": {"file": f"{sid}.bin", "offset": grid * grid, "dtype": "uint8", "scale_pct": 0.5},
        "earth_margin_deg": EARTH_MARGIN_DEG,
        "source": "Published LOLA terrain grids (10 m near, 400 m far) + the site's 2 m horizon beyond them; "
                  "SPICE DE440 ephemerides of the site",
    }
    return meta, light.reshape(grid, grid), earth.reshape(grid, grid)


def write(meta, light, earth, out: Path = OUT) -> None:
    out.mkdir(parents=True, exist_ok=True)
    to_u8 = lambda a: np.clip(np.rint(a * 200), 0, 200).astype(np.uint8)
    payload = to_u8(light).tobytes() + to_u8(earth).tobytes()
    tmp = out / f".{meta['id']}.bin.tmp"
    tmp.write_bytes(payload)
    os.replace(tmp, out / f"{meta['id']}.bin")
    tmp = out / f".{meta['id']}.json.tmp"
    tmp.write_text(json.dumps(meta, indent=1), encoding="utf-8")
    os.replace(tmp, out / f"{meta['id']}.json")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--site", action="append", help="site id (repeatable); default all published")
    ap.add_argument("--grid", type=int, default=128)
    ap.add_argument("--year", type=int, default=2027)
    a = ap.parse_args(argv)
    index = json.loads((DATA / "sites.json").read_text(encoding="utf-8"))
    ids = a.site or [e["id"] for e in index if (DATA / "terrain" / f"{e['id']}.json").exists()]
    for sid in ids:
        t0 = time.time()
        meta, light, earth = compute(sid, a.grid, a.year)
        write(meta, light, earth)
        g = a.grid // 2
        print(f"{sid:<28} light {100 * light.mean():5.1f}% mean, {100 * light.max():5.1f}% max, "
              f"centre {100 * light[g - 1:g + 1, g - 1:g + 1].mean():5.1f}%  ({time.time() - t0:.0f} s)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

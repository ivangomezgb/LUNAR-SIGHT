"""Horizon masks from LOLA DEMs (numba).

Geometry (deviates from the parabolic sketch in docs/development-plan.md on purpose):

* Rays follow great circles. A sample at surface distance s and azimuth a from the site
  has unit vector u = cos(s/R) u0 + sin(s/R) (cos a n0 + sin a e0), where u0, n0, e0 are the
  site's up / north / east unit vectors. It is projected to the DEM with the analytic
  south polar stereographic (sphere R, k0 = 1): x = 2R u_y / (1 - u_z), y = 2R u_x / (1 - u_z)
  (checked against pyproj in tests). So azimuth is exact local azimuth and s is true
  distance, not map distance (the map scale factor is ~1.002 at 85 S).
* Elevation is exact: P = (R + z_t) u, O = (R + z_site + h) u0, el = atan2(v.u0, |v - (v.u0)u0|)
  with v = P - O. No parabolic d^2/2R approximation; at 200 km the parabolic form
  over-estimates the drop by ~d^4/(8R^3)... and mis-states the horizontal distance; the exact
  form costs the same.
* Multi-scale: the mask is the per-azimuth max over scales (finest near, coarser far).
  Scale k starts, per azimuth, where scale k-1's ray actually stopped (its d_max, or
  earlier if it hit nodata / the edge of the window), so a gap in a fine DEM is filled by
  the next one instead of being treated as flat.
* Coverage: every ray records how far it got. If the last scale stops before d_max the
  azimuth is incomplete; `max_dist_m` = min over azimuths of the distance reached.
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit

from . import dem as demmod

R_MOON = demmod.R_MOON_M
AZ_STEP_DEG = 0.5


@njit(cache=True)
def _bilinear(z, c, r):
    c0 = int(math.floor(c))
    r0 = int(math.floor(r))
    if c0 < 0 or r0 < 0 or c0 + 1 >= z.shape[1] or r0 + 1 >= z.shape[0]:
        return np.nan
    fc = c - c0
    fr = r - r0
    return (z[r0, c0] * (1 - fc) * (1 - fr) + z[r0, c0 + 1] * fc * (1 - fr)
            + z[r0 + 1, c0] * (1 - fc) * fr + z[r0 + 1, c0 + 1] * fc * fr)


@njit(cache=True)
def horizon_mask(z, left, top, res, lat0_rad, lon0_rad, r_obs, d_start, d_max, az_step_deg,
                 R, step_m):
    """One scale. z: DEM window (m above R, NaN nodata); left/top: map coords of the window's
    outer corner; r_obs: observer radius (R + z_site + h). d_start: per-azimuth start
    distance (m). Returns (elev_deg[n_az] (-90 where no sample), reach_m[n_az])."""
    n_az = int(round(360.0 / az_step_deg))
    out = np.full(n_az, -90.0)
    reach = np.zeros(n_az)
    sl, cl = math.sin(lat0_rad), math.cos(lat0_rad)
    so, co = math.sin(lon0_rad), math.cos(lon0_rad)
    u0x, u0y, u0z = cl * co, cl * so, sl
    ex, ey, ez = -so, co, 0.0
    nx, ny, nz = -sl * co, -sl * so, cl
    ox, oy, oz = r_obs * u0x, r_obs * u0y, r_obs * u0z
    for i in range(n_az):
        a = math.radians(i * az_step_deg)
        ca, sa = math.cos(a), math.sin(a)
        dx, dy, dz = ca * nx + sa * ex, ca * ny + sa * ey, ca * nz + sa * ez
        best = -1e9
        s = d_start[i]
        reached = s
        while s <= d_max:
            th = s / R
            ct, st = math.cos(th), math.sin(th)
            ux, uy, uz = ct * u0x + st * dx, ct * u0y + st * dy, ct * u0z + st * dz
            k = 2.0 * R / (1.0 - uz)
            x = k * uy
            y = k * ux
            zt = _bilinear(z, (x - left) / res - 0.5, (top - y) / res - 0.5)
            if not (zt == zt):  # NaN: nodata or outside the window
                break
            rt = R + zt
            vx, vy, vz = rt * ux - ox, rt * uy - oy, rt * uz - oz
            up = vx * u0x + vy * u0y + vz * u0z
            hx, hy, hz = vx - up * u0x, vy - up * u0y, vz - up * u0z
            el = math.atan2(up, math.sqrt(hx * hx + hy * hy + hz * hz))
            if el > best:
                best = el
            reached = s
            s += step_m
        if best > -1e8:
            out[i] = math.degrees(best)
        # completed the scale -> d_max; stopped on nodata/edge -> last valid sample
        reach[i] = d_max if s > d_max else reached
    return out, reach


def scale_mask(win: demmod.DemWindow, lat_deg, lon_deg, r_obs, d_start, d_max,
               az_step=AZ_STEP_DEG, step_m=None):
    z = np.ascontiguousarray(win.z, dtype=np.float64)
    return horizon_mask(z, float(win.left), float(win.top), float(win.res),
                        math.radians(lat_deg), math.radians(lon_deg), float(r_obs),
                        np.ascontiguousarray(d_start, dtype=np.float64), float(d_max),
                        float(az_step), R_MOON, float(step_m or win.res))


# Scales: (source key, d_max of that scale in metres). The first scale whose file covers the
# site is the near field; 5 m (87S) and 10 m (83S) are alternatives for the near field.
NEAR_KEYS = ("lola5_87s", "lola10_83s", "lola20_80s")
NEAR_DMAX = 7500.0
MID = ("lola20_80s", 60000.0)
FAR = ("lola240_60s", 200000.0)
HEIGHTS_M = (1, 2, 5, 10)


def site_horizon(lat_deg: float, lon_deg: float, heights=HEIGHTS_M, az_step=AZ_STEP_DEG,
                 sources: dict | None = None, log=print) -> dict:
    """Multi-scale horizon for one site. Returns the horizon intermediate (without id)."""
    sources = sources or {}

    def src(key):
        if key not in sources:
            sources[key] = demmod.DemSource(key)
        return sources[key]

    x, y = demmod.latlon_to_xy(lat_deg, lon_deg)
    # near-field DEM: finest file whose valid data covers the site and the 7.5 km disc
    near = None
    for key in NEAR_KEYS:
        s = src(key)
        if not s.contains_xy(x, y, margin_m=NEAR_DMAX + 2 * s.res):
            continue
        w = s.read_window(x, y, NEAR_DMAX + 4 * s.res)
        if math.isfinite(w.sample(x, y)):
            near = (s, w)
            break
    if near is None:
        raise RuntimeError(f"no DEM covers site {lat_deg}, {lon_deg}")
    near_src, near_win = near
    z_site = near_win.sample(x, y)
    slope = demmod.slope_deg(near_win, x, y, 50.0)

    plan = [(near_src, near_win, NEAR_DMAX)]
    if near_src.key != MID[0]:
        plan.append((src(MID[0]), None, MID[1]))
    else:
        plan[0] = (near_src, None, MID[1])  # 20 m is near and mid field at once
    plan.append((src(FAR[0]), None, FAR[1]))

    n_az = int(round(360.0 / az_step))
    masks = {h: np.full(n_az, -90.0) for h in heights}
    reach = {h: np.full(n_az, near_src.res) for h in heights}
    used = []
    for s, w, dmax in plan:
        if w is None:
            w = s.read_window(x, y, dmax + 4 * s.res)
        zs = w.sample(x, y)
        log(f"    {s.key:<12} res {s.res:>5.0f} m to {dmax / 1000:5.1f} km; "
            f"z_site here {zs:9.2f} m (near {z_site:9.2f})")
        for h in heights:
            el, rch = scale_mask(w, lat_deg, lon_deg, R_MOON + z_site + h, reach[h], dmax,
                                 az_step)
            masks[h] = np.maximum(masks[h], el)
            # a ray that got nowhere in this scale keeps its previous reach
            reach[h] = np.maximum(reach[h], rch)
        used.append({"source": s.key, "label": s.label, "res_m": s.res, "d_max_m": dmax})
        del w

    h_ref = 2 if 2 in heights else heights[0]
    max_dist = float(np.min(reach[h_ref]))
    if max_dist < FAR[1]:
        bad = int(np.sum(reach[h_ref] < FAR[1]))
        log(f"    WARNING: {bad} azimuths reached only {max_dist:.0f} m (< {FAR[1]:.0f} m)")
    return {
        "az_step_deg": az_step,
        "heights_m": list(heights),
        "elev_cdeg": {str(h): [int(v) for v in np.rint(masks[h] * 100.0)] for h in heights},
        "max_dist_m": round(max_dist, 1),
        "slope_deg_50m": round(slope, 2),
        "dem_res_m": near_src.res,
        "dem_source": " + ".join(f"{u['label']} to {u['d_max_m'] / 1000:g} km" for u in used),
        "elev_m": round(float(z_site), 2),
        "scales": used,
    }

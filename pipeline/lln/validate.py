"""Validate lln.ephem against JPL Horizons and compute the IM-2 (Athena) case.

Horizons is queried as an OBSERVER ephemeris from a user-defined lunar surface site
(CENTER='coord@301', COORD_TYPE='GEODETIC', SITE_COORD='E-lon,lat,alt_km'), QUANTITIES='4'
= airless apparent azimuth / elevation (light time, stellar aberration and gravitational
light bending; no refraction on the Moon: the header says "Atmos refraction: NO (AIRLESS)").
Horizons' lunar reference surface is the 1737.4 km sphere and its body-fixed frame is
MEAN_ME (high precision) = DE440 ME, the same as ours.

CLI (run from pipeline/):
    python -m lln.validate                 # live queries, writes data/intermediate/validation.json
    python -m lln.validate --offline       # re-use cached raw responses
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests

from lln import ephem

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
PIPELINE_DIR = Path(__file__).resolve().parents[1]
OUT_PATH = PIPELINE_DIR / "data" / "intermediate" / "validation.json"
RAW_DIR = PIPELINE_DIR / "data" / "intermediate" / "horizons_raw"
THRESHOLD_DEG = 0.05
BODY_IDS = {"sun": "10", "earth": "399"}
SPICE_NAMES = {"sun": "SUN", "earth": "EARTH"}
SUN_RADIUS_DEG = 0.267  # same constant as web/src/lib/sunFraction.ts

# Validation points: planetocentric lat, east lon, elevation (m above the 1737.4 km sphere).
# These are test locations spread in latitude (pole, 84.8 S, 69.4 S); Horizons gets the
# exact same lat/lon/alt, so the comparison does not depend on how precise they are.
VALIDATION_SITES = [
    {"id": "shackleton_rim", "lat_deg": -89.90, "lon_deg": 0.0, "elev_m": 0.0},
    {"id": "mons_mouton", "lat_deg": -84.7906, "lon_deg": 29.1957, "elev_m": 0.0},
    {"id": "chandrayaan3", "lat_deg": -69.373, "lon_deg": 32.319, "elev_m": 0.0},
]
# 10 instants spread over the ephemeris window (2026-11 .. 2028-12), varied hours.
VALIDATION_TIMES = [
    "2026-11-03T06:00:00Z", "2027-01-17T13:00:00Z", "2027-04-02T20:00:00Z",
    "2027-06-15T03:00:00Z", "2027-08-29T10:00:00Z", "2027-11-12T17:00:00Z",
    "2028-01-26T00:00:00Z", "2028-04-10T07:00:00Z", "2028-07-24T14:00:00Z",
    "2028-12-08T21:00:00Z",
]

# IM-2 / Athena: LROC "IM-2 Athena Seen Obliquely" (https://lroc.im-ldi.com/images/1408):
# lander on its side inside a 20 m crater at 84.7906 S, 29.1957 E.
IM2 = {
    "site": "mons-mouton",
    "t_utc": "2025-03-06T17:31:00Z",
    "lat_deg": -84.7906,
    "lon_deg": 29.1957,
    "source_url": "https://lroc.im-ldi.com/images/1408",
    "time_source_url": "https://www.space.com/the-universe/moon/intuitive-machines-lands-private-athena-lander-near-moon-south-pole-historic-touchdown",
}

MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


# ---------------------------------------------------------------- Horizons I/O
def horizons_params(body: str, lon_e_deg: float, lat_deg: float, alt_km: float,
                    t_utc_list: list[str]) -> dict:
    tlist = " ".join(f"'{t.replace('T', ' ').replace('Z', '')}'" for t in t_utc_list)
    return {
        "format": "text", "COMMAND": f"'{BODY_IDS[body]}'", "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES", "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon_e_deg:.6f},{lat_deg:.6f},{alt_km:.6f}'",
        "TLIST": tlist, "TLIST_TYPE": "CAL", "TIME_TYPE": "UT",
        "QUANTITIES": "'4'", "ANG_FORMAT": "DEG", "CSV_FORMAT": "YES", "EXTRA_PREC": "YES",
    }


def fetch_horizons(body: str, lon_e_deg: float, lat_deg: float, alt_km: float,
                   t_utc_list: list[str]) -> str:
    r = requests.get(API, params=horizons_params(body, lon_e_deg, lat_deg, alt_km, t_utc_list),
                     timeout=90)
    r.raise_for_status()
    text = r.text
    if "$$SOE" not in text:
        raise RuntimeError(f"Horizons returned no ephemeris:\n{text[:2000]}")
    return text


def _parse_time(s: str) -> str:
    # "2026-Nov-01 00:00:00.000" -> "2026-11-01T00:00:00Z"
    date, clock = s.strip().split()
    y, mon, d = date.split("-")
    hh, mm, ss = clock.split(":")
    sec = round(float(ss))
    return f"{int(y):04d}-{MONTHS[mon]:02d}-{int(d):02d}T{int(hh):02d}:{int(mm):02d}:{sec:02d}Z"


def parse_horizons_azel(text: str) -> list[dict]:
    """Parse a CSV OBSERVER table: returns [{t_utc, az, el}] using the header columns."""
    if "$$SOE" not in text or "$$EOE" not in text:
        raise ValueError("no $$SOE/$$EOE block in Horizons output")
    head, rest = text.split("$$SOE", 1)
    body = rest.split("$$EOE", 1)[0]
    if "Atmos refraction: YES" in head:  # never expected on the Moon (AIRLESS)
        raise ValueError("Horizons output includes atmospheric refraction")
    header = None
    for line in reversed(head.strip().splitlines()):
        if "Date" in line and "," in line:
            header = [c.strip() for c in line.split(",")]
            break
    if header is None:
        raise ValueError("CSV header line not found")
    i_az = next(i for i, c in enumerate(header) if c.lower().startswith("azimuth"))
    i_el = next(i for i, c in enumerate(header) if c.lower().startswith("elevation"))
    rows = []
    for line in body.strip().splitlines():
        cols = [c.strip() for c in line.split(",")]
        if len(cols) <= max(i_az, i_el):
            continue
        rows.append({"t_utc": _parse_time(cols[0]), "az": float(cols[i_az]),
                     "el": float(cols[i_el])})
    return rows


# ---------------------------------------------------------------- math helpers
def circ_diff_deg(a: float, b: float) -> float:
    """Signed circular difference a - b in (-180, 180]."""
    d = (a - b + 180.0) % 360.0 - 180.0
    return 180.0 if d == -180.0 else d


def horizon_at(mask_cdeg, az_deg: float, step_deg: float = 0.5) -> float:
    """Horizon elevation (deg) at az with circular linear interpolation (index 0 = north)."""
    m = np.asarray(mask_cdeg, dtype=float) / 100.0
    x = (az_deg % 360.0) / step_deg
    i0 = int(math.floor(x)) % len(m)
    f = x - math.floor(x)
    return float(m[i0] * (1 - f) + m[(i0 + 1) % len(m)] * f)


def sun_fraction(sun_el_deg: float, horizon_el_deg: float) -> float:
    """Visible fraction of the solar disk above a locally flat horizon line."""
    h = (horizon_el_deg - sun_el_deg) / SUN_RADIUS_DEG  # line height vs disk centre, radii
    if h <= -1:
        return 1.0
    if h >= 1:
        return 0.0
    return (math.acos(h) - h * math.sqrt(1 - h * h)) / math.pi


def ours_azel(body: str, lat: float, lon: float, elev_m: float, t_utc_list: list[str]):
    pos = ephem.positions_at(SPICE_NAMES[body], t_utc_list)
    return ephem.topo_azel(pos, lat, lon, elev_m)


# ---------------------------------------------------------------- comparison
def compare(sites=VALIDATION_SITES, times=VALIDATION_TIMES, offline=False) -> list[dict]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for s in sites:
        for body in ("sun", "earth"):
            raw = RAW_DIR / f"horizons_{body}_{s['id']}.txt"
            if offline and raw.exists():
                text = raw.read_text(encoding="utf-8")
            else:
                text = fetch_horizons(body, s["lon_deg"], s["lat_deg"], s["elev_m"] / 1000.0, times)
                raw.write_text(text, encoding="utf-8")
            hz = {r["t_utc"]: r for r in parse_horizons_azel(text)}
            az, el = ours_azel(body, s["lat_deg"], s["lon_deg"], s["elev_m"], times)
            for t, a, e in zip(times, az, el):
                h = hz[t]
                rows.append({
                    "site": s["id"], "t_utc": t, "body": body,
                    "az_ours": round(float(a), 6), "el_ours": round(float(e), 6),
                    "az_horizons": h["az"], "el_horizons": h["el"],
                    "d_az": round(circ_diff_deg(float(a), h["az"]), 6) + 0.0,
                    "d_el": round(float(e) - h["el"], 6) + 0.0,
                })
    return rows


def summarize(rows: list[dict]) -> dict:
    max_az = max(abs(r["d_az"]) for r in rows)
    max_el = max(abs(r["d_el"]) for r in rows)
    return {"n": len(rows), "max_abs_d_az_deg": max_az, "max_abs_d_el_deg": max_el,
            "threshold_deg": THRESHOLD_DEG,
            "pass": bool(max_az <= THRESHOLD_DEG and max_el <= THRESHOLD_DEG)}


def im2_case(horizon_mask_cdeg=None, az_step: float = 0.5, elev_m: float = 0.0,
             check_horizons: bool = False) -> dict:
    """IM-2 / Athena landing case (ValidationData.im2).

    horizon_mask_cdeg: 2 m horizon mask (720 ints for az_step 0.5, index 0 = north) at the
    Athena site, if a DEM covers it; fills horizon_el_at_sun_az_deg and sun_fraction.
    elev_m: site elevation above the 1737.4 km sphere (effect on Sun/Earth angles < 0.001 deg).
    """
    t = IM2["t_utc"]
    lat, lon = IM2["lat_deg"], IM2["lon_deg"]
    s_az, s_el = (float(v[0]) for v in ours_azel("sun", lat, lon, elev_m, [t]))
    _, e_el = (float(v[0]) for v in ours_azel("earth", lat, lon, elev_m, [t]))
    hz_el = frac = None
    if horizon_mask_cdeg is not None:
        hz_el = round(horizon_at(horizon_mask_cdeg, s_az, az_step), 3)
        frac = round(sun_fraction(s_el, hz_el), 4)
    note = (f"Athena (IM-2) touchdown {t} (Space.com: {IM2['time_source_url']}); "
            f"lander position {abs(lat)} S, {lon} E from LROC ({IM2['source_url']}). "
            f"Sun/Earth from SPICE DE440 as for every site.")
    if check_horizons:
        hs = parse_horizons_azel(fetch_horizons("sun", lon, lat, elev_m / 1000, [t]))[0]
        he = parse_horizons_azel(fetch_horizons("earth", lon, lat, elev_m / 1000, [t]))[0]
        note += (f" Horizons gives sun az {hs['az']:.3f}, el {hs['el']:.3f}; "
                 f"earth el {he['el']:.3f} deg.")
    if horizon_mask_cdeg is None:
        note += " Horizon at the sun azimuth not computed (no DEM mask supplied)."
    else:
        note += (f" Local horizon at the sun azimuth {hz_el:.2f} deg (2 m); "
                 f"visible solar disk fraction {frac:.2f}.")
    return {
        "site": IM2["site"], "t_utc": t, "lat_deg": lat, "lon_deg": lon,
        "sun_az_deg": round(s_az, 3), "sun_el_deg": round(s_el, 3),
        "horizon_el_at_sun_az_deg": hz_el, "sun_fraction": frac,
        "earth_el_deg": round(e_el, 3),
        "horizon_az_step_deg": az_step if horizon_mask_cdeg is not None else None,
        "horizon_elev_cdeg": [int(v) for v in horizon_mask_cdeg] if horizon_mask_cdeg is not None else None,
        "note": note,
    }


METHOD = (
    "Ours: SPICE (spiceypy) with naif0012.tls, de440s.bsp, pck00011.tpc, "
    "moon_pa_de440_200625.bpc and moon_de440_250416.tf. Apparent (LT+S) Sun and Earth "
    "positions from the Moon's centre in MOON_ME (DE440 mean-Earth frame), computed once "
    "hourly; per site the observer vector (sphere 1737.4 km + elevation) is subtracted and "
    "projected on local east/north/up (azimuth from north, clockwise). Reference: JPL "
    "Horizons API, OBSERVER table from a geodetic lunar surface site (coord@301), "
    "QUANTITIES=4 (airless apparent azimuth/elevation, DE441, MEAN_ME high precision). "
    "3 sites x 10 instants (2026-11 to 2028-12) x Sun and Earth; d_az is circular."
)


def build(offline: bool = False, horizon_mask_cdeg=None, az_step: float = 0.5) -> dict:
    rows = compare(offline=offline)
    return {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": METHOD,
        "rows": rows,
        "summary": summarize(rows),
        "im2": im2_case(horizon_mask_cdeg, az_step, check_horizons=not offline),
    }


def _mask_from_intermediate(site_id: str):
    p = PIPELINE_DIR / "data" / "intermediate" / "horizon" / f"{site_id}.json"
    if not p.exists():
        return None, 0.5
    d = json.loads(p.read_text(encoding="utf-8"))
    return d.get("elev_cdeg", {}).get("2"), d.get("az_step_deg", 0.5)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Compare lln.ephem with JPL Horizons")
    ap.add_argument("--offline", action="store_true", help="use cached raw Horizons responses")
    ap.add_argument("--out", default=str(OUT_PATH))
    ap.add_argument("--im2-horizon", default=IM2["site"],
                    help="site id whose data/intermediate/horizon/<id>.json mask is used for IM-2")
    a = ap.parse_args(argv)
    mask, step = _mask_from_intermediate(a.im2_horizon)
    data = build(offline=a.offline, horizon_mask_cdeg=mask, az_step=step)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=1), encoding="utf-8")
    s = data["summary"]
    print(f"n={s['n']} max|d_az|={s['max_abs_d_az_deg']:.2e} deg "
          f"max|d_el|={s['max_abs_d_el_deg']:.2e} deg pass={s['pass']}")
    im = data["im2"]
    print(f"IM-2: sun az {im['sun_az_deg']} el {im['sun_el_deg']}  earth el {im['earth_el_deg']}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()

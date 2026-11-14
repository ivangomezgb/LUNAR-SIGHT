"""Hourly metrics shared with the browser engine (degrees at the boundary)."""
from datetime import datetime, timedelta, timezone
import math
import numpy as np

SUN_RADIUS_DEG = 0.267
DEFAULT_ASSUMPTIONS = dict(heightM=2, dayFraction=0.5, earthMarginDeg=0.5)


def sun_fraction(sun_el_deg, horizon_el_deg):
    u = np.clip((np.asarray(sun_el_deg) - horizon_el_deg) / SUN_RADIUS_DEG, -1, 1)
    return 1 - (np.arccos(u) - u * np.sqrt(1 - u * u)) / np.pi


def horizon_at(mask_cdeg, az_deg, step_deg=0.5):
    mask = np.asarray(mask_cdeg)
    x = np.mod(az_deg, 360) / step_deg
    i = np.floor(x).astype(int)
    f = x - i
    return ((1 - f) * mask[i % len(mask)] + f * mask[(i + 1) % len(mask)]) / 100


def _date(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value


def _iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def compute_metrics(site, start_utc, hours, assumptions=None):
    a = {**DEFAULT_ASSUMPTIONS, **(assumptions or {})}
    if not math.isfinite(hours) or hours < 0:
        raise ValueError('Invalid metric window')
    ephem = site['ephem']
    n, step = ephem['n'], ephem['step_h']
    t0 = _date(ephem['t0_utc'])
    requested = math.floor((_date(start_utc) - t0).total_seconds() / (3600 * step))
    start = max(0, min(n, requested))
    end = max(start, min(n, math.ceil(requested + hours / step)))
    height_key = str(a['heightM']).removesuffix('.0')
    mask = site['horizon']['elev_cdeg'][height_key]
    az_step = site['horizon']['az_step_deg']
    sun_el = np.asarray(ephem['sun']['el_cdeg'], dtype=np.float32) / 100
    sun_h = horizon_at(mask, np.asarray(ephem['sun']['az_cdeg']) / 100, az_step)
    earth_h = horizon_at(mask, np.asarray(ephem['earth']['az_cdeg']) / 100, az_step)
    fraction = sun_fraction(sun_el, sun_h).astype(np.float32)
    visible = np.asarray(ephem['earth']['el_cdeg']) / 100 - earth_h >= a['earthMarginDeg']
    day = fraction >= a['dayFraction']

    def longest(value):
        best = run = 0
        for item in day[start:end]:
            run = run + 1 if bool(item) == value else 0
            best = max(best, run)
        return best * step

    def until(condition):
        hits = np.flatnonzero(condition[start:n])
        return int(hits[0]) * step if hits.size else None

    next_window = None
    hits = np.flatnonzero(visible[start:n])
    if hits.size:
        first = start + int(hits[0])
        hidden = np.flatnonzero(~visible[first:n])
        if hidden.size:
            next_window = dict(startUtc=_iso(t0 + timedelta(hours=first * step)),
                               durationH=int(hidden[0]) * step)
    count = end - start
    return dict(startUtc=_iso(t0 + timedelta(hours=start * step)), hours=count * step,
                lightPct=float(np.mean(fraction[start:end], dtype=np.float64) * 100) if count else 0,
                earthPct=float(np.mean(visible[start:end]) * 100) if count else 0,
                longestDayH=longest(True), longestNightH=longest(False),
                hoursToSunset=until(~day), hoursToEarthset=until(~visible),
                nextEarthWindow=next_window,
                sunElAtLandingDeg=float(sun_el[start] - sun_h[start]) if start < n else 0)


# Also expose the contract spelling for callers sharing names with TypeScript.
computeMetrics = compute_metrics

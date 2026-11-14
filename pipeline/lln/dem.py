"""LOLA DEM access: windowed remote reads with a local block cache, coordinates, slope.

Sources (all on the 1737.4 km reference sphere, south polar stereographic, k0 = 1):

  key          file                                              res    native units
  lola5_87s    PGDA 81  LOLA_5mpp/87S/ldem_87s_5mpp.tif           5 m   km  (x1000 -> m)
  lola10_83s   PGDA 90  LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF        10 m   m
  lola20_80s   PGDA 90  LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF        20 m   m
  lola240_60s  PGDA 90  LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF      240 m   m

Units: the 87S file's GMT metadata says z#actual_range = -4.38..2.71 (km), but its pixel
values are metres: decoded tiles near the pole hold 600-1330, and at Connecting Ridge the
5 m file gives 1653.13 m vs 1653.30 m from the independent 20 m PGDA 90 mosaic. So every
source uses unit_to_m = 1, and each cached tile is range-checked (|z| < 12 km). Scale 1 /
offset 0 in all TIFFs; NaN is nodata.

Reads are tile aligned. Every native TIFF tile that is touched is cached once as
`data/raw/<key>/r<row>_c<col>.npy` (float32 metres) and reused by every site, so the
3-5 GB mosaics are never downloaded whole.
"""
from __future__ import annotations

import math
import os
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

PIPELINE_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = PIPELINE_DIR / "data" / "raw"

R_MOON_M = 1737400.0
CRS_PROJ4 = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"
GEO_PROJ4 = "+proj=longlat +R=1737400 +no_defs"

_PGDA = "https://pgda.gsfc.nasa.gov/data"
SOURCES: dict[str, dict] = {
    "hill80_80s": {  # basemap only (hillshade, not heights)
        "url": f"{_PGDA}/LOLA_20mpp/LDEM_80S_80MPP_ADJ_HILL.TIF",
        "res_m": 80.0, "unit_to_m": 1.0, "check_range": False,
        "label": "PGDA 90 LOLA hillshade 80 m/px (80S)",
    },
    "lola5_87s": {
        "url": f"{_PGDA}/LOLA_5mpp/87S/ldem_87s_5mpp.tif",
        "res_m": 5.0, "unit_to_m": 1.0,
        "label": "PGDA 81 LOLA 5 m/px (87S)",
    },
    "lola10_83s": {
        "url": f"{_PGDA}/LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF",
        "res_m": 10.0, "unit_to_m": 1.0,
        "label": "PGDA 90 LOLA 10 m/px (83S)",
    },
    "lola20_80s": {
        "url": f"{_PGDA}/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF",
        "res_m": 20.0, "unit_to_m": 1.0,
        "label": "PGDA 90 LOLA 20 m/px (80S)",
    },
    "lola240_60s": {
        "url": f"{_PGDA}/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF",
        "res_m": 240.0, "unit_to_m": 1.0,
        "label": "PGDA 90 LOLA 240 m/px (60S)",
    },
}

FETCH_THREADS = 4
HTTP_UA = "lln-pipeline/0.1 (NASA Space Apps; python-urllib)"
# The PGDA server ignores multi-range requests (answers "200 OK" with the whole file), so
# GDAL must issue one single-range request at a time (SERIAL), never multipart (YES).
GDAL_ENV = {
    "GDAL_HTTP_MULTIRANGE": "SERIAL",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.TIF",
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MAX_RETRY": "5",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "VSI_CACHE": "TRUE",
}


# ---------------------------------------------------------------- coordinates

@lru_cache(maxsize=None)
def _transformers():
    from pyproj import CRS, Transformer

    crs = CRS.from_proj4(CRS_PROJ4)
    geo = CRS.from_proj4(GEO_PROJ4)
    fwd = Transformer.from_crs(geo, crs, always_xy=True)
    inv = Transformer.from_crs(crs, geo, always_xy=True)
    return fwd, inv


def latlon_to_xy(lat_deg, lon_deg):
    """Planetocentric lat/lon (deg, east-positive) -> polar stereographic map x, y (m)."""
    fwd, _ = _transformers()
    return fwd.transform(lon_deg, lat_deg)


def xy_to_latlon(x_m, y_m):
    """Map x, y (m) -> (lat_deg, lon_deg)."""
    _, inv = _transformers()
    lon, lat = inv.transform(x_m, y_m)
    return lat, lon


def north_xy(lat_deg: float, lon_deg: float, dlat_deg: float = 0.001) -> np.ndarray:
    """Unit vector of local north in map coordinates (x east-ish, y up)."""
    x0, y0 = latlon_to_xy(lat_deg, lon_deg)
    x1, y1 = latlon_to_xy(lat_deg + dlat_deg, lon_deg)
    v = np.array([x1 - x0, y1 - y0], dtype=np.float64)
    return v / np.linalg.norm(v)


def check_crs(ds) -> None:
    """Refuse a file whose projection differs from CRS_PROJ4 (the numba kernels assume it)."""
    from pyproj import CRS

    got = CRS.from_wkt(ds.crs.to_wkt()).to_dict()
    want = CRS.from_proj4(CRS_PROJ4).to_dict()
    keys = ("proj", "lat_0", "lat_ts", "lon_0", "x_0", "y_0", "R", "units")
    for k in keys:
        a, b = got.get(k), want.get(k)
        if isinstance(a, float) or isinstance(b, float):
            ok = a is not None and b is not None and abs(float(a) - float(b)) < 1e-6
        else:
            ok = a == b
        if not ok:
            raise ValueError(f"unexpected CRS parameter {k}: {a!r} != {b!r} ({ds.name})")


# ---------------------------------------------------------------- windows

@dataclass
class DemWindow:
    """z[row, col] in metres (NaN = nodata). Pixel (col, row) centre is at
    x = left + (col + 0.5) * res, y = top - (row + 0.5) * res."""
    z: np.ndarray
    left: float
    top: float
    res: float
    source: str

    def xy_to_colrow(self, x, y):
        return (x - self.left) / self.res - 0.5, (self.top - y) / self.res - 0.5

    def sample(self, x, y) -> float:
        """Bilinear sample at map (x, y); NaN outside or on nodata."""
        c, r = self.xy_to_colrow(x, y)
        c0, r0 = int(math.floor(c)), int(math.floor(r))
        if c0 < 0 or r0 < 0 or c0 + 1 >= self.z.shape[1] or r0 + 1 >= self.z.shape[0]:
            return float("nan")
        fc, fr = c - c0, r - r0
        q = self.z[r0:r0 + 2, c0:c0 + 2].astype(np.float64)
        return float(q[0, 0] * (1 - fc) * (1 - fr) + q[0, 1] * fc * (1 - fr)
                     + q[1, 0] * (1 - fc) * fr + q[1, 1] * fc * fr)


def _tmp_path(path: Path) -> Path:
    """A temporary name unique to this process and call, next to `path`, so parallel
    workers sharing the tile cache never write the same file (os.replace is atomic)."""
    return path.with_name(f"{path.stem}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp{path.suffix}")


class TiffIndex:
    """Tile layout of a remote tiled BigTIFF (first IFD = full resolution)."""

    def __init__(self, width, height, tile_w, tile_h, offsets, counts, left, top, res,
                 compression, predictor, bits, sample_format, little_endian):
        self.width, self.height = int(width), int(height)
        self.tile_w, self.tile_h = int(tile_w), int(tile_h)
        self.offsets, self.counts = np.asarray(offsets, np.int64), np.asarray(counts, np.int64)
        self.left, self.top, self.res = float(left), float(top), float(res)
        self.compression, self.predictor = int(compression), int(predictor)
        self.bits, self.sample_format = int(bits), int(sample_format)
        self.little_endian = bool(little_endian)
        self.tiles_x = -(-self.width // self.tile_w)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = _tmp_path(path)
        np.savez(tmp, offsets=self.offsets, counts=self.counts, hdr=np.array(
            [self.width, self.height, self.tile_w, self.tile_h, self.left, self.top, self.res,
             self.compression, self.predictor, self.bits, self.sample_format,
             self.little_endian], dtype=np.float64))
        os.replace(tmp, path)

    @classmethod
    def load(cls, path: Path) -> "TiffIndex":
        d = np.load(path)
        h = d["hdr"]
        return cls(h[0], h[1], h[2], h[3], d["offsets"], d["counts"], h[4], h[5], h[6],
                   h[7], h[8], h[9], h[10], h[11])


def http_range(url: str, start: int, length: int, retries: int = 6) -> bytes:
    """GET bytes [start, start+length) and insist on a 206 with exactly that length.
    Errors are raised, never turned into nodata."""
    import http.client
    import urllib.error
    import urllib.request

    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "Range": f"bytes={start}-{start + length - 1}", "User-Agent": HTTP_UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                if r.status != 206:
                    raise IOError(f"HTTP {r.status} (expected 206) for range request")
                data = r.read()
            if len(data) != length:
                raise IOError(f"short read {len(data)} != {length}")
            return data
        except (urllib.error.URLError, http.client.HTTPException, OSError) as exc:
            last = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code in (400, 401, 404, 410):
                break  # permanent client errors; PGDA's 403 under load is transient, so retried
            if attempt + 1 < retries:
                time.sleep(min(30.0, 2.0 * 2 ** attempt))
    raise IOError(f"range {start}+{length} of {url} failed after {retries} tries: {last}")


def read_tiff_index(url: str) -> TiffIndex:
    import struct

    head = http_range(url, 0, 16)
    bo = "<" if head[:2] == b"II" else ">"
    if struct.unpack(bo + "H", head[2:4])[0] != 43:
        raise ValueError("only BigTIFF is supported")
    ifd = struct.unpack(bo + "Q", head[8:16])[0]
    n = struct.unpack(bo + "Q", http_range(url, ifd, 8))[0]
    raw = http_range(url, ifd + 8, n * 20)
    tags = {}
    for i in range(n):
        tag, typ, cnt, val = struct.unpack(bo + "HHQQ", raw[i * 20:(i + 1) * 20])
        tags[tag] = (typ, cnt, val, raw[i * 20 + 12:(i + 1) * 20])
    sizes = {3: 2, 4: 4, 12: 8, 16: 8}
    codes = {3: "H", 4: "I", 12: "d", 16: "Q"}

    def values(tag):
        typ, cnt, val, inline = tags[tag]
        nbytes = sizes[typ] * cnt
        buf = inline[:nbytes] if nbytes <= 8 else http_range(url, val, nbytes)
        return np.frombuffer(buf, dtype=np.dtype(bo + codes[typ]), count=cnt)

    w, h = int(values(256)[0]), int(values(257)[0])
    tw, th = int(values(322)[0]), int(values(323)[0])
    scale = values(33550)
    tie = values(33922)
    if abs(scale[0] - scale[1]) > 1e-9 or tie[0] != 0 or tie[1] != 0:
        raise ValueError("unexpected georeferencing")
    return TiffIndex(w, h, tw, th, values(324), values(325), tie[3], tie[4], scale[0],
                     values(259)[0], values(317)[0] if 317 in tags else 1, values(258)[0],
                     values(339)[0] if 339 in tags else 1, bo == "<")


def decode_tile(buf: bytes, idx: TiffIndex) -> np.ndarray:
    """Deflate (8 / 32946) + predictor 1/3 float32 tile -> (tile_h, tile_w) float32."""
    if idx.bits != 32 or idx.sample_format != 3:
        raise ValueError("only float32 rasters are supported")
    th, tw = idx.tile_h, idx.tile_w
    if idx.compression in (8, 32946):
        buf = zlib.decompress(buf)
    elif idx.compression != 1:
        raise ValueError(f"compression {idx.compression} not supported")
    if idx.predictor == 3:
        b = np.frombuffer(buf, dtype=np.uint8).reshape(th, tw * 4)
        b = np.cumsum(b, axis=1, dtype=np.uint8)
        # byte planes, most significant first, regardless of file byte order
        b = b.reshape(th, 4, tw).transpose(0, 2, 1)[:, :, ::-1]
        return np.ascontiguousarray(b).view("<f4").reshape(th, tw)
    if idx.predictor != 1:
        raise ValueError(f"predictor {idx.predictor} not supported")
    a = np.frombuffer(buf, dtype=np.dtype(("<" if idx.little_endian else ">") + "f4"))
    return a.reshape(th, tw).astype(np.float32)


class DemSource:
    """A remote tiled GeoTIFF read tile by tile with plain HTTP range requests.

    GDAL /vsicurl/ was tried first, but (a) the PGDA server answers multi-range requests
    with "200 OK" and the whole file, and (b) under load it returned HTTP 403, which GDAL
    silently turned into NaN tiles. This reader raises on any HTTP problem instead."""

    def __init__(self, key: str, cache_dir: Path | None = None):
        self.key = key
        self.meta = SOURCES[key]
        self.url = self.meta["url"]
        self.cache_dir = (cache_dir or RAW_DIR) / key
        self._idx = None
        self._lock = threading.Lock()

    @property
    def label(self) -> str:
        return self.meta["label"]

    @property
    def res(self) -> float:
        return self.meta["res_m"]

    def index(self) -> TiffIndex:
        with self._lock:
            if self._idx is None:
                p = self.cache_dir / "index.npz"
                if p.exists():
                    self._idx = TiffIndex.load(p)
                else:
                    self.verify_crs()
                    idx = read_tiff_index(self.url)
                    if abs(idx.res - self.res) > 1e-9:
                        raise ValueError(f"{self.key}: pixel size {idx.res} != {self.res}")
                    idx.save(p)
                    self._idx = idx
            return self._idx

    def verify_crs(self) -> None:
        """Open the header once with rasterio and check the projection (metadata only)."""
        import rasterio

        with rasterio.Env(**GDAL_ENV):
            with rasterio.open("/vsicurl/" + self.url) as ds:
                check_crs(ds)

    def geometry(self):
        i = self.index()
        return i.left, i.top, i.width, i.height, i.tile_h, i.tile_w

    def contains_xy(self, x: float, y: float, margin_m: float = 0.0) -> bool:
        left, top, w, h, _, _ = self.geometry()
        res = self.res
        return (left + margin_m <= x <= left + w * res - margin_m
                and top - h * res + margin_m <= y <= top - margin_m)

    def _block_path(self, br: int, bc: int) -> Path:
        return self.cache_dir / f"r{br}_c{bc}.npy"

    def _fetch_blocks(self, br: int, bc0: int, bc1: int) -> None:
        """Download tiles (br, bc0..bc1); one range request when they are contiguous."""
        idx = self.index()
        ks = [br * idx.tiles_x + bc for bc in range(bc0, bc1 + 1)]
        offs, cnts = idx.offsets[ks], idx.counts[ks]
        contiguous = bool(np.all(offs[1:] == offs[:-1] + cnts[:-1]) and np.all(cnts > 0))
        if contiguous:
            data = http_range(self.url, int(offs[0]), int(cnts.sum()))
            bufs = [data[int(o - offs[0]): int(o - offs[0] + c)] for o, c in zip(offs, cnts)]
        else:
            bufs = [http_range(self.url, int(o), int(c)) if c > 0 else None
                    for o, c in zip(offs, cnts)]
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        for bc, buf in zip(range(bc0, bc1 + 1), bufs):
            if buf is None:  # sparse tile = nodata, by the TIFF spec
                blk = np.full((idx.tile_h, idx.tile_w), np.nan, dtype=np.float32)
            else:
                blk = decode_tile(buf, idx) * np.float32(self.meta["unit_to_m"])
            # pixels beyond the raster edge are padding
            r_end = idx.height - br * idx.tile_h
            c_end = idx.width - bc * idx.tile_w
            if r_end < idx.tile_h:
                blk[r_end:, :] = np.nan
            if c_end < idx.tile_w:
                blk[:, c_end:] = np.nan
            fin = blk[np.isfinite(blk)]
            if self.meta.get("check_range", True) and fin.size and (
                    fin.min() < -12000.0 or fin.max() > 12000.0):
                raise ValueError(f"{self.key}: implausible heights {fin.min()}..{fin.max()} m "
                                 f"in tile r{br} c{bc}; refusing to cache")
            p = self._block_path(br, bc)
            tmp = _tmp_path(p)
            np.save(tmp, blk)
            os.replace(tmp, p)

    def _load_block(self, br: int, bc: int) -> np.ndarray:
        """Load a cached tile; a truncated or malformed file is deleted and fetched again."""
        idx = self.index()
        p = self._block_path(br, bc)
        for attempt in range(2):
            try:
                blk = np.load(p)
                if blk.shape == (idx.tile_h, idx.tile_w) and blk.dtype == np.float32:
                    return blk
                problem = f"shape {blk.shape} dtype {blk.dtype}"
            except (OSError, ValueError, EOFError) as exc:
                problem = str(exc)
            if attempt:
                raise ValueError(f"{self.key}: cached tile {p.name} is corrupt after re-fetch ({problem})")
            p.unlink(missing_ok=True)
            self._fetch_blocks(br, bc, bc)
        raise AssertionError("unreachable")

    def read_window(self, x_c: float, y_c: float, radius_m: float) -> DemWindow:
        """Square window (tile aligned, clipped to the file) covering x_c +- radius, y_c +- radius."""
        left, top, w, h, bh, bw = self.geometry()
        res = self.res
        c_lo = max(0, int(math.floor((x_c - radius_m - left) / res)))
        c_hi = min(w - 1, int(math.ceil((x_c + radius_m - left) / res)))
        r_lo = max(0, int(math.floor((top - (y_c + radius_m)) / res)))
        r_hi = min(h - 1, int(math.ceil((top - (y_c - radius_m)) / res)))
        if c_lo > c_hi or r_lo > r_hi:
            raise ValueError(f"{self.key}: window outside coverage")
        br0, br1, bc0, bc1 = r_lo // bh, r_hi // bh, c_lo // bw, c_hi // bw
        jobs = []
        max_run = max(1, (4 << 20) // (bh * bw * 3))  # ~4 MB per request
        for br in range(br0, br1 + 1):
            missing = [bc for bc in range(bc0, bc1 + 1) if not self._block_path(br, bc).exists()]
            run: list[int] = []
            for bc in missing + [None]:
                if bc is not None and (not run or (bc == run[-1] + 1 and len(run) < max_run)):
                    run.append(bc)
                    continue
                if run:
                    jobs.append((br, run[0], run[-1]))
                run = [bc] if bc is not None else []
        if jobs:
            with ThreadPoolExecutor(max_workers=FETCH_THREADS) as ex:
                for f in [ex.submit(self._fetch_blocks, *j) for j in jobs]:
                    f.result()
        z = np.empty(((br1 - br0 + 1) * bh, (bc1 - bc0 + 1) * bw), dtype=np.float32)
        for br in range(br0, br1 + 1):
            for bc in range(bc0, bc1 + 1):
                z[(br - br0) * bh:(br - br0 + 1) * bh, (bc - bc0) * bw:(bc - bc0 + 1) * bw] = \
                    self._load_block(br, bc)
        return DemWindow(z=z, left=left + bc0 * bw * res, top=top - br0 * bh * res,
                         res=res, source=self.key)


# ---------------------------------------------------------------- terrain metrics

def slope_deg(win: DemWindow, x: float, y: float, baseline_m: float = 50.0) -> float:
    """Mean slope over a baseline_m-diameter disc: least-squares plane through the DEM
    posts within baseline_m / 2 of (x, y) (at least the 3x3 neighbourhood)."""
    c, r = win.xy_to_colrow(x, y)
    rad_px = max(baseline_m / 2.0 / win.res, 1.5)
    k = int(math.ceil(rad_px))
    ci, ri = int(round(c)), int(round(r))
    rr, cc = np.mgrid[ri - k: ri + k + 1, ci - k: ci + k + 1]
    sel = (cc - c) ** 2 + (rr - r) ** 2 <= rad_px ** 2
    if rad_px < 2:  # coarse DEM: plain 3x3
        sel = (np.abs(cc - ci) <= 1) & (np.abs(rr - ri) <= 1)
    rr, cc = rr[sel], cc[sel]
    if rr.min() < 0 or cc.min() < 0 or rr.max() >= win.z.shape[0] or cc.max() >= win.z.shape[1]:
        return float("nan")
    zz = win.z[rr, cc].astype(np.float64)
    if not np.all(np.isfinite(zz)):
        return float("nan")
    xs = cc * win.res
    ys = -rr * win.res
    A = np.column_stack([xs - xs.mean(), ys - ys.mean(), np.ones_like(xs)])
    (gx, gy, _), *_ = np.linalg.lstsq(A, zz, rcond=None)
    return float(math.degrees(math.atan(math.hypot(gx, gy))))

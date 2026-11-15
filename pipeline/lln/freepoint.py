"""Export real LOLA terrain and MOON_ME vectors: python -m lln.freepoint.

Reads the shared tile cache without modifying it; missing tiles are downloaded into
memory. No invented terrain, no silent nodata filling. See docs/freepoint.md.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import dem, ephem

OUT = Path(__file__).resolve().parents[2] / 'web/public/data/free'


def quantize(z: np.ndarray) -> np.ndarray:
    good = np.isfinite(z)
    if np.any(np.abs(z[good]) > 12000):
        raise ValueError('Implausible LOLA height')
    out = np.full(z.shape, -32768, dtype='<i2')
    out[good] = np.rint(z[good]).astype('<i2')
    return out


def reduce_max(z: np.ndarray, factor: int) -> np.ndarray:
    """Conservative far-field block maximum; a missing sample remains missing."""
    h, w = z.shape
    if factor < 1 or h % factor or w % factor:
        raise ValueError('Grid dimensions must be divisible by factor')
    return z.reshape(h // factor, factor, w // factor, factor).max(axis=(1, 3))


class ReadOnlySource(dem.DemSource):
    def index(self):
        if self._idx is None:
            p = self.cache_dir / 'index.npz'
            if not p.exists():
                raise FileNotFoundError(f'Cached, CRS-verified index required: {p}')
            self._idx = dem.TiffIndex.load(p)
        return self._idx

    def tile(self, br, bc):
        i = self.index()
        p = self._block_path(br, bc)
        if p.exists():
            z = np.load(p)
        else:
            k = br * i.tiles_x + bc
            if i.counts[k] == 0:
                raise ValueError('Missing terrain tile')
            z = dem.decode_tile(dem.http_range(self.url, int(i.offsets[k]), int(i.counts[k])), i)
        if z.shape != (i.tile_h, i.tile_w) or not np.isfinite(z).all():
            raise ValueError(f'Invalid or incomplete tile {br}, {bc}')
        return z

    def square(self, radius):
        i = self.index()
        c0 = int(np.floor((-radius - i.left) / i.res))
        r0 = int(np.floor((i.top - radius) / i.res))
        n = int(np.ceil(2 * radius / i.res / 4)) * 4 + 4
        if min(c0, r0) < 0 or c0 + n > i.width or r0 + n > i.height:
            raise ValueError('Requested grid outside mosaic')
        z = np.empty((n, n), dtype=np.float32)
        for br in range(r0 // i.tile_h, (r0 + n - 1) // i.tile_h + 1):
            for bc in range(c0 // i.tile_w, (c0 + n - 1) // i.tile_w + 1):
                tile = self.tile(br, bc)
                ra, rb = max(r0, br * i.tile_h), min(r0 + n, (br + 1) * i.tile_h)
                ca, cb = max(c0, bc * i.tile_w), min(c0 + n, (bc + 1) * i.tile_w)
                z[ra-r0:rb-r0, ca-c0:cb-c0] = tile[ra-br*i.tile_h:rb-br*i.tile_h, ca-bc*i.tile_w:cb-bc*i.tile_w]
        return z, i.left + c0 * i.res, i.top - r0 * i.res


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    src = ReadOnlySource('lola240_60s')
    grids = []
    # Entire +/-200 km basemap, plus enough margin for every 200 km great circle.
    for name, radius, factor in [('inner', 203000, 1), ('outer', 410000, 4)]:
        print(f'Reading {name} LOLA grid', flush=True)
        z, left, top = src.square(radius)
        z = reduce_max(z, factor)
        q = quantize(z)
        if (q == -32768).any():
            raise ValueError('Incomplete terrain: refusing export')
        filename = f'{name}.bin'
        (OUT / filename).write_bytes(q.tobytes())
        grids.append(dict(file=filename, n=z.shape[0], left=left, top=top,
                          res_m=src.res * factor, scale_m=1, nodata=-32768,
                          source=src.url, reduction='none' if factor == 1 else '4x4 maximum'))
    vectors = np.stack([ephem.body_positions('SUN'), ephem.body_positions('EARTH')], axis=1).astype('<f4')
    (OUT / 'vectors.bin').write_bytes(vectors.tobytes())
    meta = dict(version=1, generated_utc=datetime.now(timezone.utc).isoformat(),
                frame=ephem.FRAME, abcorr=ephem.ABCORR, radius_m=dem.R_MOON_M,
                t0_utc=ephem.T0_UTC, step_h=ephem.STEP_H, n=ephem.N_HOURS,
                vectors_file='vectors.bin', vectors_layout='hour, body(sun,earth), xyz; float32 LE km',
                grids=grids, az_step_deg=0.5, max_dist_m=200000,
                heights_m=[1, 2, 5, 10], bounds_m=[-200000, -200000, 200000, 200000])
    payload = sum((OUT / g['file']).stat().st_size for g in grids) + vectors.nbytes
    if payload > 12_000_000:
        raise ValueError(f'Payload exceeds budget: {payload}')
    meta['payload_bytes'] = payload
    (OUT / 'meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
    # Old measurements must never describe newly generated assets.
    (OUT / 'accuracy.json').unlink(missing_ok=True)
    print(f'Exported {payload:,} bytes. Run the freepoint Vitest measurement next.')


if __name__ == '__main__':
    main()

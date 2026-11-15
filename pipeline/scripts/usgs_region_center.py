"""Area-weighted centre of a USGS Artemis III candidate-region navigation grid (shapefile).

    python pipeline/scripts/usgs_region_center.py pipeline/data/raw/usgs_artemis/Slater_Plain/Slater_Plain_PolarLGRS_ACC_1km_S_Grid.shp

Source: McClernan (2024), "Lunar Grid Reference System (LGRS) Down Selected Artemis III Candidate
Landing Site Navigational Grids in Artemis Condensed Coordinate (ACC) Format", USGS data release,
https://doi.org/10.5066/P1MEQ6UK. Each region is a set of grid-cell polygons in the release's polar
stereographic projection (.prj). The centre is the area-weighted centroid of all cells, computed in
that projection and converted to planetocentric latitude / east longitude. A tiny pure-Python
shapefile reader is used (polygon shapes only) so no GIS dependency is needed.
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

from pyproj import CRS, Transformer


def read_polygons(shp: Path) -> list[list[tuple[float, float]]]:
    data = shp.read_bytes()
    if struct.unpack(">i", data[:4])[0] != 9994:
        raise ValueError(f"not a shapefile: {shp}")
    rings, pos = [], 100
    while pos < len(data):
        _, length_words = struct.unpack(">ii", data[pos:pos + 8])
        rec = data[pos + 8:pos + 8 + 2 * length_words]
        pos += 8 + 2 * length_words
        shape_type = struct.unpack("<i", rec[:4])[0]
        if shape_type == 0:
            continue
        if shape_type not in (5, 15, 25):
            raise ValueError(f"unsupported shape type {shape_type}")
        num_parts, num_points = struct.unpack("<ii", rec[36:44])
        parts = list(struct.unpack(f"<{num_parts}i", rec[44:44 + 4 * num_parts])) + [num_points]
        pts = struct.unpack(f"<{2 * num_points}d", rec[44 + 4 * num_parts:44 + 4 * num_parts + 16 * num_points])
        xy = list(zip(pts[0::2], pts[1::2]))
        for a, b in zip(parts[:-1], parts[1:]):
            rings.append(xy[a:b])
    return rings


def ring_area_centroid(ring):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    a *= 0.5
    return a, (cx / (6 * a), cy / (6 * a)) if a else (0.0, (0.0, 0.0))


def region_center(shp: Path) -> dict:
    rings = read_polygons(shp)
    total = sx = sy = 0.0
    for ring in rings:
        # Shapefile outer rings are clockwise (negative signed area here); holes are counter-clockwise,
        # so summing signed areas subtracts holes correctly.
        area, (cx, cy) = ring_area_centroid(ring)
        total += area
        sx += area * cx
        sy += area * cy
    x, y = sx / total, sy / total
    crs = CRS.from_wkt(shp.with_suffix(".prj").read_text(encoding="utf-8"))
    to_geo = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
    lon, lat = to_geo.transform(x, y)
    return {"shapefile": shp.name, "cells": len(rings), "area_km2": round(abs(total) / 1e6, 2),
            "center_x_m": round(x, 2), "center_y_m": round(y, 2),
            "lat_deg": round(lat, 5), "lon_deg": round((lon + 180) % 360 - 180, 5)}


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        print(json.dumps(region_center(Path(arg))))

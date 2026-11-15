# Permanently shadowed regions and long-term illumination

`pipeline/lln/psr.py` → `web/public/data/psr/psr.json`, shown on Explore ("Permanently shadowed regions").

## Source

Official LOLA polar illumination products, read on 2026-11-15:

- Product page: [PGDA 69 — Lunar Polar Illumination](https://pgda.gsfc.nasa.gov/products/69) (E. Mazarico).
- Files: <http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/> — `LPSR_85S_060M_201608`, `LPSR_75S_120M_201608`,
  `AVGVISIB_85S_060M_201608[_EARTH]`, `AVGVISIB_75S_120M_201608[_EARTH]` (PDS3 IMG + LBL, V1.05, 2016-09,
  data set LRO-L-LOLA-4-GDR-V1.0).
- Citation: Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., Torrence, M. H. (2011). Illumination
  conditions of the lunar polar regions using LOLA topography. *Icarus* 211, 1066–1081,
  doi:10.1016/j.icarus.2010.10.030.

From the labels: polar stereographic on a 1737.4 km sphere, true scale at the pole, 60 m/px (85S map, ±151.7 km)
or 120 m/px (75S map, ±457.4 km); `LPSR` DN +20000 = permanent shadow, −20000 = not; `AVGVISIB` DN × 0.00004 =
fraction of time steps with **any part** of the solar (or Earth) disc visible. From the product page: computed
over an entire lunar nutation cycle (~18.6 years) with a one-hour step. The observer height is not stated.

## What we compute (per site)

- Map product: the 60 m map when the ±30 km search window fits inside it, else the 120 m map (Mons Mouton,
  Amundsen Rim, Malapert, Nobile Rim 2, Peak near Cabeus B).
- Nearest PSR pixel within 30 km: distance, bearing (from local north, clockwise), area of its connected region
  (8-connectivity; marked as a lower bound if it touches the window edge).
- PSR area within 5, 10 and 20 km. Map scale distortion is < 0.3 % at these latitudes and is ignored.
- Long-term Sun and Earth visibility at the site (bilinear on the product grid), used for validation.
- A 1-bit PSR overlay of ±10 km around the site (base64), drawn in the card.

Only the needed rows are fetched with HTTP range requests and cached in `pipeline/data/raw/pgda69/`.
A PSR is a cold trap where volatiles such as water ice may be stable; the product does not say ice is present.

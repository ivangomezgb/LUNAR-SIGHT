# Plan de desarrollo: Lunar Landing Site Navigator

Nov 14, 2026 · @Alejandro

## Alcance y definición de terminado

El MVP es una app web estática que, para unos 15 sitios del Polo Sur, muestra el horizonte real con el Sol y la Tierra, calcula energía y comunicación, y recomienda alternativas cuando la misión se retrasa. Todo lo demás es extra y solo entra si el MVP está publicado y validado. Basado en el [documento de estrategia](https://claude.ai/artifact/UyLiimXaWGmySNWJAeo5ME).

**MVP (obligatorio para la entrega):**

1. Lista curada de 10–15 sitios con fuente, en un mapa polar 2D; selección de hasta 3 para comparar y campo de coordenadas libres.
2. Máscara de horizonte real por sitio (LOLA 5 m/px cerca, 20 m/px lejos).
3. Posiciones del Sol y la Tierra cada hora entre noviembre de 2026 y diciembre de 2028.
4. Panorama de 360° con horizonte, trayectoria del Sol y de la Tierra, y la posición en la fecha elegida.
5. Tarjetas de métricas: % de luz, día más largo, noche más larga, % de Tierra visible, horas hasta el atardecer y hasta que se oculte la Tierra.
6. Línea de tiempo de 30 días con bandas de luz y de contacto con la Tierra.
7. Modo “Se retrasó”: ranking de sitio × fecha con pesos ajustables.
8. Página de validación: nuestro cálculo contra JPL Horizons y el caso IM-2.

**Extras, en este orden:** bandas de incertidumbre con clones de LOLA → control de altura del panel → riesgo de luz al aterrizar → escena 3D con sombras → modo Explora bilingüe → asistente en lenguaje natural → reporte exportable.

**Definición de terminado (para cualquier función):**

- Funciona en la app publicada, no solo en un computador.
- Sus números salen de datos reales y tienen una prueba o una comparación de validación.
- Tiene texto en inglés en la interfaz y está descrita en el README.
- Cualquier supuesto (umbral, altura, peso) está escrito y visible.

## Estructura del repositorio y convenciones

Un solo repositorio público con dos mitades: `pipeline/` (Python, calcula) y `web/` (TypeScript, muestra). Se comunican únicamente por los JSON de `web/public/data/`.

```text
lunar-navigator/
├── pipeline/
│   ├── config/sites.yaml        # sitios curados con fuente
│   ├── kernels/                 # kernels SPICE (no se suben; script de descarga)
│   ├── data/raw/                # DEM de LOLA (no se suben)
│   ├── lln/
│   │   ├── dem.py               # lectura por ventanas, coordenadas, pendiente
│   │   ├── horizon.py           # máscara de horizonte (numba)
│   │   ├── ephem.py             # Sol y Tierra con SPICE
│   │   ├── metrics.py           # mismas métricas que la app
│   │   ├── uncertainty.py       # clones de LOLA (extra)
│   │   ├── validate.py          # comparación con Horizons
│   │   └── export.py            # escribe los JSON de la app
│   ├── tests/
│   └── run_all.py               # corre todo el pipeline
├── web/
│   ├── public/data/             # salida del pipeline + mapa base PNG
│   └── src/
│       ├── components/          # Panorama, Timeline, SiteMap, Replan, Scene3D…
│       ├── lib/                 # sunFraction.ts, metrics.ts, score.ts, i18n.ts
│       └── pages/               # Explore, Compare, Replan, Validation, About
├── docs/                        # validation.md, assumptions.md, capturas
├── README.md                    # en inglés
└── LICENSE                      # MIT o Apache-2.0
```

**Convenciones:**

- Rama `main` siempre publicable; cada persona trabaja en ramas cortas y fusiona cada 2–3 horas.
- Commits pequeños y en inglés (`feat: horizon mask for 5 m DEM`).
- Unidades en el nombre de las variables: `elev_deg`, `dist_m`, `t_utc`.
- Grados en todo lo que viaja a la app; radianes solo dentro de funciones.
- Azimut medido desde el norte local, en sentido horario (convención de Horizons).
- Si usan IA para escribir código, anotarlo en el commit y en el README, como pide la guía.

## Contratos de datos

Acordar estos formatos en la primera hora permite que pipeline y frontend avancen en paralelo: el frontend arranca con un JSON falso del mismo formato. La app calcula las métricas en el navegador a partir de máscaras y efemérides, así el modo “Se retrasó” responde al instante.

**`web/public/data/sites.json`** (índice de sitios):

```json
[
  {
    "id": "mons-mouton",
    "name": "Mons Mouton",
    "lat_deg": -84.79,
    "lon_deg": 0.0,
    "elev_m": 6100,
    "group": "artemis",
    "tags": ["artemis", "clps", "im-2"],
    "source_url": "https://...",
    "dem_res_m": 5,
    "has_clones": false,
    "slope_deg_50m": 3.4
  }
]
```

Los valores del ejemplo son de relleno: las coordenadas reales salen de `sites.yaml`, cada una con su fuente.

**`web/public/data/sites/<id>.json`** (un archivo por sitio, carga perezosa):

```json
{
  "id": "mons-mouton",
  "generated_utc": "2026-11-14T18:00:00Z",
  "frame": "MOON_ME",
  "horizon": {
    "az_step_deg": 0.5,
    "heights_m": [1, 2, 5, 10],
    "elev_cdeg": { "1": [/* 720 enteros */], "2": [], "5": [], "10": [] }
  },
  "ephem": {
    "t0_utc": "2026-11-01T00:00:00Z",
    "step_h": 1,
    "n": 19008,
    "sun":   { "az_cdeg": [], "el_cdeg": [] },
    "earth": { "az_cdeg": [], "el_cdeg": [] }
  },
  "uncertainty": null
}
```

- `_cdeg` = centésimas de grado en enteros: el archivo pesa mucho menos que con decimales.
- `n` = horas desde `t0_utc`; 19 008 horas cubren del 1 de noviembre de 2026 al 31 de diciembre de 2028.
- `uncertainty` (extra): `{ "illum_pct_p5": …, "p50": …, "p95": … }` cuando haya clones.

**`web/public/data/validation.json`:** filas `{ site, t_utc, body, az_ours, el_ours, az_horizons, el_horizons, d_az, d_el }` y un resumen con el error máximo.

**`web/public/data/basemap.png`** + `basemap.json`: imagen del relieve sombreado del Polo Sur y la transformación de píxel a coordenadas estereográficas para ubicar los sitios.

## Pipeline de datos paso a paso

El pipeline corre una vez (con `python run_all.py`) y deja todo en `web/public/data/`. Los tiempos son estimados para un equipo que ya descargó los datos el viernes.

1. **P0 · Entorno y kernels (30 min).** `pip install rasterio numpy numba spiceypy pyproj requests pyyaml pytest`. Descargar de [NAIF generic kernels](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/): `naif0012.tls`, `de440s.bsp`, `pck00011.tpc` y los kernels de orientación lunar de DE440 (el `.bpc` de `moon_pa_de440` y su frame kernel `.tf`). Cargarlos con un meta-kernel `kernels/lln.tm`.
2. **P1 · Sitios (45 min).** Llenar `sites.yaml` con nombre, latitud, longitud y fuente. Coordenadas de las regiones de Artemis, Mons Mouton, Shackleton y Chandrayaan-3, verificadas en [Quickmap](https://quickmap.lroc.asu.edu/).
3. **P2 · DEM y pendiente (1 h).** Para cada sitio, leer solo una ventana del COG con `rasterio` (radio de 7,5 km en el DEM de 5 m/px). Convertir lat/lon ↔ coordenadas del mapa con `pyproj` usando el CRS que trae el propio archivo. Calcular la pendiente media en 50 m.
4. **P3 · Máscara de horizonte (2–3 h).** Tres escalas y se toma el máximo por azimut: 5 m/px hasta 7,5 km, 20 m/px hasta 60 km y 100–200 m/px (overviews del COG) hasta 200 km. Repetir para alturas de 1, 2, 5 y 10 m.
5. **P4 · Efemérides (1 h).** Posición del Sol y la Tierra respecto al centro de la Luna en `MOON_ME`, cada hora, **una sola vez**; luego, por sitio, transformar a azimut y elevación locales con álgebra vectorial.
6. **P5 · Exportar (45 min).** Escribir `sites.json`, un JSON por sitio y `basemap.png` (relieve sombreado reducido a unos 2048 px).
7. **P6 · Validación (1 h).** Comparar con Horizons en 3 sitios × 10 instantes y escribir `validation.json`.
8. **P7 · Caso IM-2 (30 min).** Elevación del Sol y horizonte en Mons Mouton a la hora del alunizaje de Athena, el 6 de marzo de 2025 a las 17:31 UTC ([Space.com](https://www.space.com/the-universe/moon/intuitive-machines-lands-private-athena-lander-near-moon-south-pole-historic-touchdown)).
9. **P8 · Incertidumbre (extra, 2 h).** Para los sitios con DEM de PGDA 78, repetir el horizonte cercano con los 100 clones y guardar los percentiles 5, 50 y 95 de % de luz.

**Código base — máscara de horizonte** (`lln/horizon.py`). Marcha rayos desde el sitio y guarda el ángulo máximo del terreno, restando la caída por curvatura lunar:

```python
import numpy as np
from numba import njit

R_MOON = 1737400.0  # m

@njit
def bilinear(z, col, row):
    c0, r0 = int(col), int(row)
    fc, fr = col - c0, row - r0
    return (z[r0, c0] * (1 - fc) * (1 - fr) + z[r0, c0 + 1] * fc * (1 - fr)
            + z[r0 + 1, c0] * (1 - fc) * fr + z[r0 + 1, c0 + 1] * fc * fr)

@njit
def horizon_mask(z, col0, row0, res_m, h_obs_m, north_xy, d_min_m, d_max_m, az_step=0.5):
    """z: DEM (m). col0,row0: sitio en píxeles. north_xy: vector unitario
    del norte local en coordenadas del mapa (x este, y arriba)."""
    n_az = int(round(360.0 / az_step))
    out = np.full(n_az, -90.0)
    nx, ny = north_xy[0], north_xy[1]
    ex, ey = ny, -nx                      # este = norte girado 90° horario
    z_obs = bilinear(z, col0, row0) + h_obs_m
    rows, cols = z.shape
    for i in range(n_az):
        a = np.radians(i * az_step)
        dx = np.cos(a) * nx + np.sin(a) * ex
        dy = np.cos(a) * ny + np.sin(a) * ey
        best = -1e9
        d = max(d_min_m, res_m)
        while d < d_max_m:
            c = col0 + dx * d / res_m
            r = row0 - dy * d / res_m     # las filas crecen hacia abajo
            if c < 0 or r < 0 or c >= cols - 1 or r >= rows - 1:
                break
            dh = bilinear(z, c, r) - z_obs - d * d / (2.0 * R_MOON)
            t = dh / d
            if t > best:
                best = t
            d += max(res_m, d * 0.004)    # paso fino cerca, grueso lejos
        out[i] = np.degrees(np.arctan(best))
    return out
```

El vector `north_xy` se calcula con `pyproj`: coordenadas del mapa de (lon, lat + 0,001°) menos las de (lon, lat), normalizado. Funciona en cualquier punto del Polo Sur sin derivar fórmulas de la proyección.

**Código base — Sol y Tierra** (`lln/ephem.py`). Las posiciones se calculan una vez y se reutilizan para todos los sitios:

```python
import numpy as np, spiceypy as sp

sp.furnsh("kernels/lln.tm")
R_KM = 1737.4

def body_positions(body, t0_utc, n_hours):
    et0 = sp.str2et(t0_utc)
    ets = et0 + 3600.0 * np.arange(n_hours)
    pos, _ = sp.spkpos(body, ets, "MOON_ME", "LT+S", "MOON")
    return np.asarray(pos)                # (n, 3) en km

def topo_azel(pos_km, lat_deg, lon_deg, h_m=0.0):
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.cross(up, east)
    v = pos_km - (R_KM + h_m / 1000.0) * up
    v /= np.linalg.norm(v, axis=1)[:, None]
    el = np.degrees(np.arcsin(v @ up))
    az = np.degrees(np.arctan2(v @ east, v @ north)) % 360.0
    return az, el
```

Para más precisión, `sp.spkcpo` calcula directamente desde un punto fijo en la superficie. La diferencia con esta versión será pequeña, y la validación contra Horizons dirá si importa.

**Código base — validación con Horizons** (`lln/validate.py`). Verificar la respuesta real de la API antes de confiar en el parser:

```python
import requests

API = "https://ssd.jpl.nasa.gov/api/horizons.api"

def horizons_azel(body_id, lon_e_deg, lat_deg, alt_km, t_utc):
    params = {
        "format": "json", "COMMAND": f"'{body_id}'",      # '10' Sol, '399' Tierra
        "MAKE_EPHEM": "YES", "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon_e_deg},{lat_deg},{alt_km}'",
        "TLIST": f"'{t_utc}'", "QUANTITIES": "'4'",       # azimut y elevación aparentes
        "ANG_FORMAT": "DEG", "CSV_FORMAT": "YES",
    }
    text = requests.get(API, params=params, timeout=60).json()["result"]
    row = text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()[0]
    return row  # parsear az y el según las columnas del encabezado
```

## Motor de métricas y modo “Se retrasó”

Todas las métricas salen de una sola pregunta por hora: ¿qué fracción del disco solar está sobre el horizonte real, y está la Tierra arriba? El mismo cálculo existe en Python (`metrics.py`) y en TypeScript (`metrics.ts`), y una prueba compara ambos.

**Fracción visible del Sol** (`lib/sunFraction.ts`). El Sol mide unos 0,5° de diámetro, así que se trata como disco y no como punto:

```ts
const SUN_RADIUS_DEG = 0.267; // radio angular aproximado del Sol visto desde la Luna

export function sunFraction(sunElDeg: number, horizonElDeg: number): number {
  const u = (sunElDeg - horizonElDeg) / SUN_RADIUS_DEG;
  if (u >= 1) return 1;
  if (u <= -1) return 0;
  // fracción del disco por encima de una línea recta (segmento circular)
  return 1 - (Math.acos(u) - u * Math.sqrt(1 - u * u)) / Math.PI;
}

export function horizonAt(maskCdeg: number[], azDeg: number, stepDeg = 0.5): number {
  const n = maskCdeg.length;
  const x = (((azDeg % 360) + 360) % 360) / stepDeg;
  const i = Math.floor(x) % n, j = (i + 1) % n, f = x - Math.floor(x);
  return ((1 - f) * maskCdeg[i] + f * maskCdeg[j]) / 100;
}
```

**Métricas por ventana de tiempo** (desde la hora de aterrizaje y durante la duración de la misión):

| Métrica | Cómo se calcula | Unidad |
| --- | --- | --- |
| Luz solar | Promedio de la fracción visible del Sol | % |
| Día más largo | Racha más larga de horas con fracción ≥ 0,5 | horas |
| Noche más larga | Racha más larga con fracción < 0,5 | horas |
| Tierra visible | Horas con el centro de la Tierra al menos 0,5° sobre el horizonte real (umbral ajustable) | % |
| Horas hasta el atardecer | Desde el instante elegido hasta la primera hora con fracción < 0,5 | horas |
| Horas hasta que se oculta la Tierra | Igual, con la visibilidad de la Tierra | horas |
| Próxima ventana con la Tierra | Inicio y duración de la siguiente racha visible | fecha, horas |
| Sol al aterrizar | Elevación del Sol sobre el horizonte real en la hora de aterrizaje | grados |

El umbral de 0,5° para la Tierra y el criterio de 0,5 para “día” son supuestos nuestros: se muestran en la interfaz y se pueden cambiar.

**Modo “Se retrasó”** (`lib/score.ts`):

1. **Entradas:** región o lista de sitios, fecha original, retraso (por ejemplo +3 semanas), tolerancia (± días), duración de la misión (por defecto 14 días) y pesos.
2. **Candidatos:** cada sitio × cada hora de aterrizaje posible, cada 6 horas dentro de la ventana. Con 15 sitios y 60 días son unas 3600 combinaciones; el navegador las evalúa en menos de un segundo.
3. **Filtros duros:** luz mínima, Tierra visible mínima, pendiente máxima y Sol visible al aterrizar.
4. **Puntaje:** suma ponderada normalizada a 0–100.
5. **Salida:** los 10 mejores, cada uno con sus tres razones principales (“+18 % de luz frente al plan original”) y un botón para abrirlo en el panorama.

```ts
export function score(m: Metrics, w: Weights, maxNightH = 336): number {
  const parts = [
    w.light * m.lightPct / 100,
    w.earth * m.earthPct / 100,
    w.night * (1 - Math.min(m.longestNightH / maxNightH, 1)),
    w.landingSun * Math.min(Math.max(m.sunElAtLandingDeg / 3, 0), 1),
  ];
  const total = w.light + w.earth + w.night + w.landingSun;
  return (100 * parts.reduce((a, b) => a + b, 0)) / total;
}
```

El tope de 3° para el Sol al aterrizar es un valor inicial para normalizar, no un requisito de la NASA. Si sale mal calibrado al ver los resultados, se ajusta y se documenta.

## Frontend: pantallas y componentes

La app es una SPA con Vite + React + TypeScript que lee JSON estáticos. El panorama es la pantalla estrella: debe verse impecable en la captura del video.

| Pantalla | Qué muestra | Componentes | Prioridad |
| --- | --- | --- | --- |
| Explore (inicio) | Mapa polar con los sitios; al elegir uno, panorama, métricas y línea de tiempo | `SiteMap`, `Panorama`, `MetricCards`, `Timeline`, `DateTimePicker` | MVP |
| Compare | Hasta 3 sitios lado a lado con la misma fecha; líneas de tiempo alineadas | `CompareGrid`, `Timeline` | MVP |
| Replan (“Se retrasó”) | Formulario, ranking de los 10 mejores con razones, botón “ver en panorama” | `ReplanForm`, `RankingTable`, `WeightSliders` | MVP |
| Validation | Tabla contra Horizons, error máximo, caso IM-2, supuestos | `ValidationTable`, `CaseStudy` | MVP |
| About | Datos usados, fuentes, uso de IA, equipo | Texto | MVP |
| 3D | Terreno de 10 × 10 km con luz desde la dirección real del Sol y sombras | `Scene3D` | Extra |
| Modo Explora | Interruptor que simplifica textos y agrega explicaciones, en inglés y español | `i18n`, `ExplainTip` | Extra |

**Panorama (`Panorama.tsx`, con D3 sobre SVG o canvas):**

- Eje horizontal: azimut de 0° a 360° con N, E, S, O marcados. Eje vertical: elevación de −5° a +10°, con la exageración vertical **rotulada**.
- Terreno: área rellena bajo la máscara de horizonte de la altura elegida.
- Trayectoria del Sol durante la ventana elegida (línea), tramos ocultos en gris y punto grande en la hora actual.
- Trayectoria de la Tierra con el mismo estilo y otro color, distinguible también sin color (línea punteada).
- Control deslizante de tiempo que anima ambos puntos; texto grande con “Sunset in 41 h · Earthset in 9 h”.

**Línea de tiempo (`Timeline.tsx`):** dos bandas de 30 días (luz y Tierra), con la ventana de misión sombreada y la hora de aterrizaje marcada.

**Escena 3D (extra, `Scene3D.tsx`):** Three.js con un `PlaneGeometry` desplazado por un recorte de 1024 × 1024 del DEM y una `DirectionalLight` orientada al Sol con sombras activadas. Las sombras reales sobre el terreno son el efecto visual más fuerte de la demo. CesiumJS con Cesium Moon Terrain es la alternativa, pero no deben mezclarse sus alturas con las de LOLA.

**Librerías:** `react`, `react-router`, `zustand` (estado), `d3` (panorama y línea de tiempo), `three` (3D), `i18next` (idiomas). Nada de backend.

**Detalles que suman en *Presentación*:** tema oscuro sobrio, tipografía grande en métricas, unidades siempre visibles, estados de carga claros y una URL que guarda el sitio y la fecha (`?site=mons-mouton&t=2027-01-12T06:00Z`) para compartir escenarios.

## Tablero de tareas

33 tareas en 8 fases; la ruta crítica es T04 → T09 y T07 → T08 → T13 → T14 → T16 → T18. Actualicen la columna Estado a medida que avanzan. Roles: **Datos** (DEM y horizonte), **Efemérides** (SPICE, exportación, validación), **3D** (panorama y escena), **UI** (pantallas y motor), **Pitch** (historia y entrega), **QA** (repo, despliegue, calidad). Las fases coinciden con el plan de 48 horas del documento de estrategia.

| ID | Tarea | Rol | Fase | Depende de | Estado |
| --- | --- | --- | --- | --- | --- |
| T01 | Leer recursos y congelar el alcance del MVP | Todos | 1 · Sáb 9–11 | — | Pendiente |
| T02 | Crear repo, estructura de carpetas, README base y licencia | QA | 1 · Sáb 9–11 | — | Pendiente |
| T03 | Acordar contratos JSON y crear un JSON falso de ejemplo | Efemérides + UI | 1 · Sáb 9–11 | T02 | Pendiente |
| T04 | Entorno Python, kernels y meta-kernel | Efemérides | 1 · Sáb 9–11 | T02 | Pendiente |
| T05 | Esqueleto Vite + React con rutas | UI | 1 · Sáb 9–11 | T02 | Pendiente |
| T06 | `sites.yaml` con coordenadas y fuentes | Datos | 2 · Sáb 11–15 | T01 | Pendiente |
| T07 | Lectura por ventanas del DEM, `north_xy` y pendiente | Datos | 2 · Sáb 11–15 | T04, T06 | Pendiente |
| T08 | `horizon_mask` con numba y prueba con DEM sintético | Datos | 2 · Sáb 11–15 | T07 | Pendiente |
| T09 | Posiciones del Sol y la Tierra y `topo_azel` | Efemérides | 2 · Sáb 11–15 | T04 | Pendiente |
| T10 | Mapa polar con sitios (datos falsos) | UI | 2 · Sáb 11–15 | T03, T05 | Pendiente |
| T11 | Panorama v0 con datos falsos | 3D | 2 · Sáb 11–15 | T03, T05 | Pendiente |
| T12 | Storyboard del video, nombre y logo | Pitch | 2 · Sáb 11–15 | T01 | Pendiente |
| T13 | Máscaras en 3 escalas × 4 alturas para todos los sitios | Datos | 3 · Sáb 15–20 | T08 | Pendiente |
| T14 | `export.py` y `basemap.png` | Efemérides | 3 · Sáb 15–20 | T09, T13 | Pendiente |
| T15 | `sunFraction`, `horizonAt` y `metrics.ts` | UI | 3 · Sáb 15–20 | T03 | Pendiente |
| T16 | Panorama v1 con datos reales | 3D | 3 · Sáb 15–20 | T14 | Pendiente |
| T17 | Tarjetas de métricas y línea de tiempo | UI | 3 · Sáb 15–20 | T15 | Pendiente |
| T18 | Publicar la primera versión | QA | 3 · Sáb 15–20 | T14, T16 | Pendiente |
| T19 | Validación contra Horizons y `validation.json` | Efemérides | 4 · Sáb 20 – Dom 2 | T09 | Pendiente |
| T20 | Modo “Se retrasó”: `score.ts` e interfaz | UI | 4 · Sáb 20 – Dom 2 | T17 | Pendiente |
| T21 | Pantalla Compare | 3D | 4 · Sáb 20 – Dom 2 | T16 | Pendiente |
| T22 | Pantalla Validation y caso IM-2 | Datos | 4 · Sáb 20 – Dom 2 | T19 | Pendiente |
| T23 | Prueba cruzada `metrics.py` contra `metrics.ts` | QA | 4 · Sáb 20 – Dom 2 | T15 | Pendiente |
| T24 | Capturas y grabaciones para el pitch | Pitch | 4 · Sáb 20 – Dom 2 | T18 | Pendiente |
| T25 | Incertidumbre con clones de LOLA (extra) | Datos | 6 · Dom 8–14 | T13 | Pendiente |
| T26 | Control de altura del panel (extra) | UI | 6 · Dom 8–14 | T13 | Pendiente |
| T27 | Escena 3D con sombras (extra) | 3D | 6 · Dom 8–14 | T14 | Pendiente |
| T28 | Modo Explora en inglés y español (extra) | Pitch + UI | 6 · Dom 8–14 | T17 | Pendiente |
| T29 | Video de 30 s con subtítulos en inglés | Pitch | 7 · Dom 14–19 | T24 | Pendiente |
| T30 | Página del proyecto en inglés, todos los campos | Pitch | 7 · Dom 14–19 | T22 | Pendiente |
| T31 | README, referencias, uso de IA y licencias | QA | 7 · Dom 14–19 | — | Pendiente |
| T32 | Probar enlaces en ventana privada y pedir FortiGuard | QA | 8 · Dom 19–22 | T18 | Pendiente |
| T33 | Submit for Judging (meta: 22:00) | QA | 8 · Dom 19–22 | T29–T32 | Pendiente |

La fase 5 (domingo 2:00–8:00) es de descanso por turnos. Funciones congeladas el domingo a las 14:00.

## Pruebas y validación

La validación es parte del producto: sus resultados van en la pantalla Validation y en la página del proyecto. Cada prueba tiene un criterio que se cumple o no.

| Prueba | Cómo | Criterio de aceptación |
| --- | --- | --- |
| Fracción del Sol | `pytest` con valores conocidos | u = 1 → 1; u = −1 → 0; u = 0 → 0,5; crece siempre con u |
| Horizonte sobre una Luna lisa | DEM de altura constante y observador a 2 m | Horizonte ≈ −0,087° en todos los azimuts (inclinación por curvatura: −√(2h/R)), ± 0,01° |
| Horizonte con un muro | DEM plano con un muro de altura H a distancia D en un azimut | Elevación = atan((H − h − D²/2R) / D) en ese azimut, ± 0,02° |
| Coordenadas | lat/lon → mapa → lat/lon | Error menor a 1 m |
| Sol y Tierra contra Horizons | 3 sitios × 10 instantes × 2 cuerpos | Error máximo ≤ 0,05° en azimut y elevación; publicar el valor real obtenido |
| Python contra TypeScript | Mismo sitio y ventana en `metrics.py` y `metrics.ts` | Diferencia ≤ 0,1 puntos porcentuales |
| Horizonte contra Moon Trek / Quickmap | Comparar visualmente la silueta en 3 sitios | Siluetas coherentes; capturas en `docs/validation.md` |
| Iluminación contra valores publicados | Un sitio muy iluminado de PGDA 78 (por ejemplo Connecting ridge o Shackleton rim) | Mismo orden de magnitud; documentar las diferencias, sin forzar coincidencias |
| Caso IM-2 | Sol y horizonte en Mons Mouton al alunizaje de Athena | Resultado coherente con los reportes de Sol bajo y sombras largas |
| Rendimiento | Navegador en un portátil normal | Ranking del modo “Se retrasó” < 1 s; JSON de un sitio < 2 s |

**Revisión manual antes de entregar:**

- [ ] Todas las pantallas funcionan en ventana privada, sin errores en la consola.
- [ ] Se ve bien en un celular (los jueces pueden abrirlo desde uno).
- [ ] Todo el texto visible está en inglés (el modo Explora puede ofrecer español).
- [ ] Cada número muestra su unidad y cada supuesto está explicado.
- [ ] Los enlaces del README y de la página del proyecto abren sin iniciar sesión.

## Despliegue y entrega

Publiquen temprano (sábado en la tarde) y vuelvan a publicar cada vez que `main` mejore: así el enlace que va en la entrega nunca está roto.

**Despliegue:**

1. `npm run build` en `web/` genera una carpeta estática con la app y los JSON.
2. Publicar en GitHub Pages (con una GitHub Action en cada push a `main`), Netlify o Vercel. Cualquiera sirve: elijan el que alguien del equipo ya conozca.
3. Con GitHub Pages, configurar `base` en `vite.config.ts` con el nombre del repositorio, o los archivos no cargarán.
4. Si los JSON pesan mucho para el repositorio, comprimirlos (los hostings sirven gzip) o reducir el rango de fechas.
5. Pedir la clasificación FortiGuard del dominio en cuanto exista, como recomienda la [guía de entrega](https://www.spaceappschallenge.org/resources/project-submission-guide/).

**Campos de la entrega y quién los llena:**

| Campo | Contenido | Responsable |
| --- | --- | --- |
| Project Name | Nombre corto en inglés | Pitch |
| High-Level Project Summary | Qué hicimos, cómo responde al reto y por qué importa | Pitch |
| Link to Project Demo | Video de 30 s o menos (YouTube o Drive público) | Pitch |
| Link to Final Project | App publicada y repositorio | QA |
| Detailed Project Description | Funciones, cómo funciona, validación, límites, próximos pasos | Pitch + Datos |
| Use of SI | Dónde y cómo se usó IA | QA |
| NASA Data | LOLA (PGDA), JPL Horizons, NAIF SPICE, Quickmap, Moon Trek, ShadowCam | Datos |
| Space Agency Partner Data and Other References | CSA, KASA (Danuri), ISRO; todas las librerías y fuentes | QA |

La entrega cierra el domingo a las 23:59 hora del evento local. Meta interna: enviar a las 22:00 y usar el margen solo para correcciones. Se puede reenviar las veces que haga falta antes del cierre.

## Plan B: qué recortar si vamos atrasados

Revisen el avance a las 15:00 y a las 20:00 del sábado y a las 8:00 del domingo. Si una tarea de la ruta crítica va más de 2 horas atrasada, apliquen el recorte correspondiente sin discutirlo de nuevo.

| Si a esta hora… | …no está listo esto | Recorte |
| --- | --- | --- |
| Sáb 15:00 | Máscara de horizonte en un sitio | Usar solo el DEM de 20 m/px hasta 60 km; dejar 5 m/px para después |
| Sáb 20:00 | Máscaras de todos los sitios | Bajar de 15 a 8 sitios y de 4 alturas a 1 (2 m) |
| Sáb 20:00 | Efemérides con SPICE | Descargar las series de Horizons para cada sitio y usarlas directamente |
| Dom 2:00 | Modo “Se retrasó” completo | Versión simple: solo fechas alternativas en el mismo sitio |
| Dom 2:00 | Validación contra Horizons | 1 sitio × 5 instantes; mostrar la tabla aunque sea corta |
| Dom 8:00 | Primera versión publicada y estable | Cancelar todos los extras; dedicar el domingo a pulir el MVP y el pitch |
| Dom 14:00 | Algún extra a medias | Esconderlo; nada a medias en la demo |

**La versión mínima que todavía puede ganar:** 8 sitios con horizonte real, panorama, métricas, el modo “Se retrasó” simple, validación contra Horizons y un video claro. Sin esos seis elementos, la propuesta pierde su diferencia frente a los demás equipos.

## Fuentes

- [Documento de estrategia del equipo](https://claude.ai/artifact/UyLiimXaWGmySNWJAeo5ME)
- [Lunar Landing Site Navigator: recursos oficiales](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/?tab=resources)
- [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/)
- [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) · [manual de Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html)
- [NAIF generic kernels (SPICE)](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/)
- [PGDA 81: mosaico LOLA de 5 m/px](https://pgda.gsfc.nasa.gov/products/81) · [PGDA 78: DEM de sitios con clones](https://pgda.gsfc.nasa.gov/products/78) · [PGDA 90: DEM de área grande](https://pgda.gsfc.nasa.gov/products/90)
- [Quickmap](https://quickmap.lroc.asu.edu/) · [Moon Trek](https://trek.nasa.gov/moon/)
- [Cesium Moon Terrain](https://cesium.com/platform/cesium-ion/content/cesium-moon-terrain)
- [Space.com: alunizaje de IM-2 Athena](https://www.space.com/the-universe/moon/intuitive-machines-lands-private-athena-lander-near-moon-south-pole-historic-touchdown)

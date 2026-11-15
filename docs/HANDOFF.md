# Traspaso: estado del proyecto y trabajo pendiente

Actualizado: 2026-11-14. Documento para retomar el trabajo en otra sesión (persona o agente).
Plan original: [`development-plan.md`](development-plan.md) · plan de ejecución de Codex:
[`execution-plan-codex.md`](execution-plan-codex.md) · contratos: [`contracts.md`](contracts.md).

## 1. Estado actual (MVP completo)

| Plan | Estado | Dónde |
| --- | --- | --- |
| 1. 10–15 sitios curados con fuente, mapa polar, comparar hasta 3 | ✅ 17 sitios (las 9 regiones Artemis III de 2024) | `pipeline/config/sites.yaml`, `SiteMap.tsx`, `Compare.tsx` |
| 1b. Coordenadas libres | ✅ aproximado, `#/free` | `lib/freepoint.ts`, `docs/freepoint.md` |
| 2. Máscara de horizonte real | ✅ 5/10 m → 20 m → 240 m, hasta 200 km, alturas 1/2/5/10 m | `lln/horizon.py`, `lln/dem.py` |
| 3. Sol y Tierra cada hora nov 2026 – dic 2028 | ✅ SPICE DE440, n = 19008 | `lln/ephem.py` |
| 4. Panorama 360° | ✅ SVG 2D (azimut × elevación) | `PanoramaChart.tsx`, `Panorama.tsx` |
| 5. Tarjetas de métricas | ✅ 8 métricas | `MetricCards.tsx`, `lib/metrics.ts` |
| 6. Línea de tiempo 30 días | ✅ | `Timeline.tsx` |
| 7. Modo "Se retrasó" | ✅ máx. 3 fechas por sitio, ~150 ms | `lib/score.ts`, `Replan.tsx` |
| 8. Validación Horizons + IM-2 | ✅ error máx. 2,7e-5° | `lln/validate.py`, `Validation.tsx`, `docs/validation.md` |
| T25. Incertidumbre con clones LOLA | ✅ 14/14 sitios cubiertos (30 clones, GitHub Actions) | `lln/uncertainty.py`, `docs/uncertainty.md` |
| T26. Altura del panel 1/2/5/10 m en URL | ✅ `?h=` | `state.ts`, `AssumptionsPanel.tsx` |
| T27. Escena 3D con sombras + 360° inmersivo | ✅ ruta `#/3d`, tres modos (ver §1.1) | `lln/terrain.py`, `lln/pano.py`, `Scene3D.tsx`, `ImmersivePano.tsx`, `three/sceneTools.ts` |
| Página del equipo Apolo404 | ✅ ruta `#/team` | `pages/Team.tsx`, `public/team-apolo404.*` |
| T28. Bilingüe EN/ES | ✅ `?lang=es` | `i18n.ts`, `locales/*.json` |
| Misión jugable (rover) | ✅ fases 1–5 del plan de juego: órbita con el casquete LOLA real y salto entre los 17 sitios con pronóstico (luz, Tierra, riesgo de luz), descenso pilotado sobre el terreno real, rover, energía, enlace con la Tierra, navegación por coordenadas, minimapa, 6 objetivos-lección, briefing, informe y progreso guardado | `web/src/game/`, `pages/Mission.tsx`, `docs/assumptions.md` |
| Guía de primera visita | ✅ "¿Primera vez?" en Explorar; menú reordenado (Explorar · 3D · Jugar misión · …); menú de una fila en celular | `pages/Explore.tsx`, `App.tsx`, `ui.css` |

Pruebas: 125 en `pytest pipeline/tests` (114 pasan y 11 se saltan sin kernels SPICE ni intermedios) y 18 en `cd web && npm test`,
incluida la paridad Python/TS. `npm run lint` y `npm run build` sin errores ni advertencias.

**CI** (`.github/workflows/ci.yml`, en cada PR y antes de cada despliegue): lint + pruebas + build de la web (Node 22),
pytest del pipeline (Python 3.12) y `pipeline/scripts/check_data.py`, que valida `web/public/data` contra los contratos.

**Auditoría 2026-11-14** (rama `audit-fixes`): línea base de "Se retrasó" ahora es un sitio original elegido; caché de
tiles DEM sin carreras entre procesos; export recalcula efemérides de sitios movidos; `has_clones` real; visor 3D/360
robusto en celular (textura de 8 bits) y con errores claros; validación de los JSON en la web; horizontes 2,3× más
rápidos (todas las alturas en una pasada, resultado idéntico).
Sitio publicado en GitHub Pages; el push a `main` despliega (workflow `deploy.yml`, verificado 2026-11-14).

### 1.1 Vistas de `#/3d`

`view=` en la URL elige el modo; `t=` (hora) y `days=` (1, 14 o 30) se comparten entre los tres.

| Modo | `view=` | Qué muestra | Precisión |
| --- | --- | --- | --- |
| Vista general 3D | `overview` (por defecto) | Terreno con sombras reales y un domo de direcciones del cielo: anillo N/E/S/O, círculos de 0° y +5°, trayectorias reales del Sol (dorado) y la Tierra (azul, discontinua), tenues bajo la máscara, rayos y etiquetas az/el | Elevación del domo exagerada ×6 (indicado en pantalla) |
| Primera persona · 2 m | `first` | Cámara a 2 m sobre el sitio con sombras proyectadas y las trayectorias a su ángulo real; se entra con un vuelo animado | Horizonte de la malla aproximado: hasta 0,44° (Connecting Ridge) y 0,61° (cerca de Shackleton) |
| Astronauta 360° | `pano` | Panorama precalculado desde 2 m con la máscara real y las trayectorias | Horizonte exacto: ≤ 0,2° en todas las columnas (salvo de-gerlache-rim-2, ver §4) |

`?debug=1` dibuja la máscara real en primera persona para comparar. Primer cuadro medido en Edge local:
~0,35 s a ancho de celular y ~0,75 s en escritorio (falta medir en un teléfono real).

### Resultados clave (año 2027, altura 2 m)

Luz: Peak near Shackleton 83,4 %, de Gerlache Rim 1 81,2 %, de Gerlache-Kocher 80,1 %,
Connecting Ridge 79,2 %, Leibnitz Beta 74,0 %, Malapert 65,7 %. IM-2 Athena: Sol a 2,47° sobre
un horizonte de 0,83°.

## 2. Cómo correr

```bash
pip install -r pipeline/requirements-dev.txt
python pipeline/scripts/download_kernels.py      # kernels SPICE (44 MB, gitignored)
python pipeline/run_all.py                       # horizontes → efemérides → validación → export (~1 min con caché)
python pipeline/run_all.py --terrain --pano      # + mallas 3D y panoramas 360° (~3 min)
python pipeline/run_all.py --uncertainty         # + clones PGDA 78 (≈45 min por sitio; descarga ~GB)
python pipeline/scripts/refine_sites.py          # SOLO si cambian los sitios: reubica en el punto mejor iluminado (~15 min)
python -m pytest pipeline/tests
cd web && npm ci && npm run dev                  # datos reales en web/public/data (versionados)
```

Despliegue: el push a `main` corre `.github/workflows/deploy.yml` (GitHub Pages).
**Hay que activarlo una vez**: Settings → Pages → Source: *GitHub Actions* (requiere admin del repo `ivangomezgb/LUNAR-SIGHT`).

## 3. Pendientes del plan (por prioridad)

**Entrega (Space Apps):**

- [x] GitHub Pages activo (más despliegue en Vercel, `vercel.yml`); el equipo probó la página en celular (2026-11-15).
- [ ] Pedir la clasificación FortiGuard del dominio (T32).
- [x] Nombre y logo: Apolo404 (barra superior y favicon).
- [ ] Capturas y grabaciones (T24); video de 30 s con subtítulos en inglés (T29); guion en `docs/submission.md`.
- [ ] Página del proyecto en inglés con todos los campos (T30) y envío (T33).
- [x] Eliminados `frontend/` y `backend/` (prototipo anterior "LUNAR SIGHT", sin uso).

**Extras del plan (en este orden):**

- [x] **T25 Incertidumbre**: 30 clones PGDA 78 en los 14 sitios cubiertos (Mons Mouton no está en ningún DEM
      de PGDA 78). Se calcula en la nube con `.github/workflows/uncertainty.yml`: un trabajo por sitio en paralelo
      (~45 min), que verifica el horizonte contra el publicado y luego publica solo `uncertainty` y `has_clones`.
      Para recalcular sitios: editar `pipeline/config/uncertainty-sites.json` y hacer push a `main`.
- [x] **T26 Control de altura del panel** (Connecting Ridge 1/2/5/10 m: 65,5/79,2/87,3/89,3 % de luz).
- [x] Riesgo de luz al aterrizar: tarjeta en Explora (`components/LandingRisk.tsx`, `lib/landingRisk.ts`); umbrales en
      `docs/assumptions.md` § Landing light risk.
- [x] **T27 Escena 3D con sombras** y 360° inmersivo (ver §1.1 y §5). Falta probar en un teléfono real (carga < 3 s).
- [x] **T28 Bilingüe EN/ES** (diccionario propio, sin i18next).
- [x] Reporte exportable: `#/report?site=&t=&days=&h=` (`pages/Report.tsx`), A4 de 2 páginas con "Descargar PDF"
      (impresión del navegador, sin dependencias).
- [x] Energía y supervivencia nocturna: tarjeta en Explora (`lib/energy.ts`, `components/EnergyCard.tsx`); supuestos en
      `docs/assumptions.md` § Energy and night survival.
- [x] Pendientes y zona segura de aterrizaje: mapa en Explora (`lib/hazard.ts`, `components/SlopeMap.tsx`); método y
      umbrales en `docs/hazard.md`.
- [x] Zonas de sombra permanente (PSR): tarjeta en Explora (`lln/psr.py`, `components/PsrCard.tsx`, `docs/psr.md`),
      mapas oficiales LOLA de PGDA 69 leídos por rangos.
- [x] Validación contra la literatura: `scripts/literature_check.py` + `LiteratureTable` en Validación; los 17 sitios
      contra los mapas de visibilidad media de Mazarico et al. 2011 con la misma definición (Tierra r = 0,984). Explica
      la diferencia de Connecting Ridge (definiciones distintas). Ver `docs/validation.md`.
- Descartado por decisión del equipo: asistente en lenguaje natural (una app estática no puede llamar a un modelo
  sin exponer una clave) y su variante de buscador guiado.

**Diferido por diseño:**

- [x] **Coordenadas libres** (`#/free`, ver `docs/freepoint.md`): vectores Sol/Tierra horarios en MOON_ME y DEM
      LOLA grueso (240 m + 960 m, 7,4 MB, carga diferida); un Web Worker calcula el horizonte (~0,1 s). Es
      **aproximado**: en los 15 sitios, error de máscara medio 0,25° (máx. 2,64°) y de luz 2027 medio 1,25 pp (máx.
      4,47 pp). Regenerar con `python -m lln.freepoint` desde `pipeline/`.

## 4. Mejoras pendientes y problemas conocidos

**Datos y ciencia:**

- Los sitios Artemis se reubicaron al punto con más luz y pendiente ≤ 8° dentro de 1 km del centro de la región
  (`refine_sites.py`). Mejoras posibles:
  - puntuar luz + Tierra + pendiente en vez de solo luz;
  - ampliar el radio de búsqueda;
  - usar varios años en lugar de solo 2027.
- Comparación con la literatura hecha para los 17 sitios (ver arriba). Falta la prueba visual de siluetas con Quickmap/Moon Trek.
- "Peak near Cabeus B" y "Slater Plain" (lista 2024) ya son sitios curados: centro de la cuadrícula LGRS de 1 km del
  USGS (McClernan 2024, doi:10.5066/P1MEQ6UK), calculado con `pipeline/scripts/usgs_region_center.py`
  (los shapefiles van en `pipeline/data/raw/usgs_artemis/`, gitignored; ScienceBase bloquea descargas
  automáticas). Cabeus B está al norte del mosaico de 5 m: su campo cercano usa LOLA 10 m (83° S). Ninguno de
  los dos está cubierto por los clones de PGDA 78, así que no tienen incertidumbre.
- `export.py` conserva la incertidumbre ya publicada si no hay intermedio local y la máscara de 2 m no cambió
  (los clones se calculan en GitHub Actions); un export local ya no la borra.
- Chandrayaan-3 (69,4° S) quedó fuera, porque no lo cubre ningún DEM de 80° S ni el mapa base.
- Las filas de `validation.json` guardan `d_az`/`d_el` redondeados (se ven como 0). El resumen sí tiene el valor exacto.

**Frontend:**

- Bundle principal 441 KB (135 KB gzip); `three` va aparte (478 KB, solo en `#/3d`).
- Pendiente menor: los textos de estado del 3D se traducen al cargarse, no al cambiar de idioma con la vista abierta.
- Pendiente menor: `refine_sites.py` vuelve a leer las ventanas de 20/240 m en cada uno de los 74 candidatos por sitio (cachearlas).
- `uncertainty.update_report` reescribe `docs/uncertainty.md` en cada corrida (revisar el diff antes de hacer commit).
- Panorama de de-gerlache-rim-2: 97,7 % de columnas dentro de 0,2° (su horizonte pasa de +15°, el borde de la imagen).
- El 360° usa solo sombreado Lambert: no hay sombras proyectadas por píxel (la primera persona 3D sí las tiene).
- Codex (GPT-6-Astra) tiene límite de uso: si corta a mitad de tarea no deja cambios parciales; relanzar o hacerlo con Claude.
- `basemap.png` pesa 2,6 MB y los JSON de sitios ~5,8 MB sin comprimir (Pages sirve gzip). Opciones: WebP o
  enviar las efemérides como delta o binario.

**Entorno (Windows + OneDrive):**

- La caché de tiles LOLA (`pipeline/data/raw/`, ~1,5 GB) está dentro de OneDrive y puede sincronizarse. Conviene
  excluirla de OneDrive o mover el repo fuera de OneDrive.
- `npm run dev` puede fallar con EPERM al limpiar `web/node_modules/.vite/deps` por bloqueos de OneDrive.
  Solución: borrar esa carpeta o cerrar otros procesos de Node.
- Codex CLI: pasar el prompt por stdin desde un archivo
  (`codex exec -s workspace-write -C <repo> - < prompt.txt`). Con el prompt como argumento y stdin abierto,
  se bloquea en "Reading additional input from stdin".
- Git: el push usa la cuenta `Andrea-Osorio-M` (config local `credential.https://github.com.username`).

**Lecciones de datos (no repetir):**

- El mosaico PGDA 81 de 5 m está en **metros**, aunque su etiqueta GMT diga km.
- GDAL `/vsicurl/` contra PGDA devolvió tiles en NaN sin error (respuestas 403 y multirango con 200 + archivo
  completo). `dem.py` lee el índice BigTIFF por su cuenta y pide un tile por petición, exigiendo 206.

## 5. Plan para el modelado 3D y las superficies en 360°

> Estado: implementado (ver §1.1). Este plan queda como referencia del diseño.

Antes, el "panorama 360°" era un gráfico 2D: azimut contra elevación, con el horizonte relleno. Para la demo se
propusieron dos piezas, que se pueden hacer en paralelo con la misma división pipeline → JSON/binarios → web.

### 5.1 Escena 3D local con sombras reales (T27)

**Objetivo:** un terreno de ~10 × 10 km alrededor del sitio, iluminado desde la dirección real del Sol en la
hora elegida, con sombras proyectadas, y la Tierra en el cielo.

**Pipeline** (`lln/export.py` o un nuevo `lln/terrain.py`):

1. Por sitio, recortar un DEM de 1024 × 1024 centrado en el sitio. Con el de 10 m/px cubre 10,24 km; con el de
   5 m/px, 5,12 km (más detalle). Usar la misma `DemSource.read_window` que ya cachea los tiles.
2. Exportar `web/public/data/terrain/<id>.png` como **PNG de 16 bits** en escala de grises con la altura
   cuantizada (`(z - zmin) / (zmax - zmin) * 65535`), más `terrain/<id>.json` con `{res_m, size_px, zmin_m,
   zmax_m, center_px, crs, north_deg}`. `north_deg` es la rotación del norte local respecto al eje +y del mapa,
   que hace falta para alinear el azimut del Sol.
3. Opcional: un anillo lejano de baja resolución (240 m/px hasta 50–100 km) como segunda malla, para que el
   horizonte de la escena 3D coincida con la máscara.

**Web** (`components/Scene3D.tsx`, ruta `#/3d?site=…&t=…`, con `three` ya instalado y carga perezosa):

1. `PlaneGeometry(size, size, 1023, 1023)`, con la altura en los vértices leída del PNG de 16 bits. Usar
   `UPNG`/canvas no sirve para 16 bits: decodificar con `fetch` + un decodificador PNG de 16 bits, o exportar
   `.bin` Float32/Int16 directamente (más simple). **Recomendado: `.bin` Int16 en decímetros.**
2. Curvatura: restar `d²/2R` a cada vértice. A 5 km son ~7 m; a 50 km, 720 m (indispensable en el anillo lejano).
3. `DirectionalLight` con la dirección calculada desde `sun az/el` de la hora (`getSeries` ya da `sunAz`/`sunEl`):
   `dir = (sin az · cos el, sin el, −cos az · cos el)`, rotado por `north_deg`. `castShadow` activado y
   `shadow.mapSize` de 4096 con la cámara de sombras ajustada al recorte. A elevaciones de 1–2° las sombras son
   muy largas: ajustar `shadow.bias` y `normalBias`.
4. Sin luz ambiente (o mínima, sin atmósfera): las sombras lunares son negras. Agregar un "earthshine" débil
   desde la dirección de la Tierra.
5. Cielo: esfera negra con el disco solar (0,267°) y la Tierra (~1°) en sus az/el reales; estrellas opcionales.
6. Controles: `OrbitControls` y un modo **primera persona** a 2 m sobre el sitio, que conecta con el panorama 2D.
   Reutilizar el deslizador de tiempo del panorama (estado en `state.ts`) para animar la luz.
7. Validación: con la cámara a 2 m en el sitio, la línea del horizonte renderizada debe coincidir con la máscara
   (comparar algunos azimuts) y el Sol debe ocultarse donde la métrica dice que se oculta.

**Alternativa:** CesiumJS + Cesium Moon Terrain da el globo completo, pero **no se deben mezclar** sus alturas con
las de LOLA. Si se usa, que sea solo como contexto visual.

### 5.2 Superficies en 360° (panorama inmersivo)

**Objetivo:** "pararse" en el sitio y mirar alrededor en 360° con el terreno real, no solo la silueta.

**Opción A, render precalculado en el pipeline (recomendada para la demo):**

1. En `lln/horizon.py` ya se marchan rayos por azimut. Extenderlo a una imagen **equirectangular** (p. ej.
   4096 × 1024, azimut 0–360° × elevación −15° a +15°). Para cada píxel (az, el), marchar el rayo hasta que corte
   el terreno (con los mismos DEM multiescala y la curvatura exacta) y guardar la **distancia** y la **normal**
   del punto de impacto.
2. Sombrear en la web: con la normal y la dirección del Sol de la hora elegida, `lambert = max(0, n·s)`. Las
   sombras proyectadas salen de un segundo rayo hacia el Sol desde el punto de impacto. Precalcular eso por
   hora es caro, así que se puede limitar a la ventana de misión o aproximar con la máscara de horizonte de
   puntos lejanos.
3. Exportar `pano/<id>_dist.bin` (Uint16, decenas de metros) y `pano/<id>_normal.png` (RGB).
4. Web: mostrarlo en una esfera interior de Three.js con un shader propio que reciba `sunDir` y sombree por píxel.
   Superponer las trayectorias del Sol y la Tierra (ya calculadas) y la máscara como línea de control.
   Funciona en celular y es muy liviano en tiempo de ejecución.

**Opción B, render en tiempo real desde la escena 3D:** poner la cámara de §5.1 a 2 m y renderizar a un
`CubeCamera` o `WebGLCubeRenderTarget`, y luego mostrarlo como panorama. Reutiliza todo lo de 5.1, pero el
horizonte lejano solo es correcto si se incluye el anillo de 50–200 km.

**Orden sugerido:**

1. `.bin` del DEM local + `Scene3D` con sombras (el mayor impacto visual).
2. Cámara en primera persona a 2 m, sincronizada con el tiempo del panorama.
3. Panorama inmersivo (opción A) con validación cruzada contra la máscara.
4. Anillo lejano y Tierra/Sol en el cielo.
5. Captura para el video.

**Criterios de terminado:** la línea del horizonte 3D y 360° coincide con la máscara (≤ 0,2° en azimuts de
prueba), el Sol se oculta a la hora que dice la métrica, se ve en celular y carga en < 3 s.

## 6. Arquitectura y reglas para seguir

- `pipeline/` (Python) y `web/` (TS) se comunican **solo** por `web/public/data/`. Los tipos están en `web/src/lib/types.ts`.
- Grados en todo lo que va a la app; `*_cdeg` = centésimas enteras; azimut desde el norte, en sentido horario; longitud positiva al este.
- Nunca publicar datos sintéticos. Los fixtures de desarrollo van en `web/public/dev-data/` (gitignored), con
  `VITE_DATA_DIR=dev-data npm run dev`.
- Cada supuesto se documenta en `docs/assumptions.md` y se muestra en la UI. El texto de la UI va en inglés.
- Los commits hechos con IA lo declaran (Claude Code, OpenAI Codex), como pide la guía de Space Apps.
- Para paralelizar con agentes: un frente por carpeta o archivo, con un solo escritor por archivo (ver `execution-plan-codex.md`).

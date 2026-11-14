# Traspaso: estado del proyecto y trabajo pendiente

Actualizado: 2026-11-14. Documento para retomar el trabajo en otra sesión (persona o agente).
Plan original: [`development-plan.md`](development-plan.md) · plan de ejecución de Codex:
[`execution-plan-codex.md`](execution-plan-codex.md) · contratos: [`contracts.md`](contracts.md).

## 1. Estado actual (MVP completo)

| Plan | Estado | Dónde |
| --- | --- | --- |
| 1. 10–15 sitios curados con fuente, mapa polar, comparar hasta 3 | ✅ 15 sitios | `pipeline/config/sites.yaml`, `SiteMap.tsx`, `Compare.tsx` |
| 1b. Coordenadas libres | ❌ diferido (ver §3) | — |
| 2. Máscara de horizonte real | ✅ 5/10 m → 20 m → 240 m, hasta 200 km, alturas 1/2/5/10 m | `lln/horizon.py`, `lln/dem.py` |
| 3. Sol y Tierra cada hora nov 2026 – dic 2028 | ✅ SPICE DE440, n = 19008 | `lln/ephem.py` |
| 4. Panorama 360° | ✅ SVG 2D (azimut × elevación) | `PanoramaChart.tsx`, `Panorama.tsx` |
| 5. Tarjetas de métricas | ✅ 8 métricas | `MetricCards.tsx`, `lib/metrics.ts` |
| 6. Línea de tiempo 30 días | ✅ | `Timeline.tsx` |
| 7. Modo "Se retrasó" | ✅ máx. 3 fechas por sitio, ~150 ms | `lib/score.ts`, `Replan.tsx` |
| 8. Validación Horizons + IM-2 | ✅ error máx. 2,7e-5° | `lln/validate.py`, `Validation.tsx`, `docs/validation.md` |
| T25. Incertidumbre con clones LOLA | 🟡 2/14 sitios (30 clones) | `lln/uncertainty.py`, `docs/uncertainty.md` |
| T26. Altura del panel 1/2/5/10 m en URL | ✅ `?h=` | `state.ts`, `AssumptionsPanel.tsx` |
| T27. Escena 3D con sombras + 360° inmersivo | ✅ ruta `#/3d` (`&view=pano`) | `lln/terrain.py`, `lln/pano.py`, `Scene3D.tsx`, `ImmersivePano.tsx` |
| T28. Bilingüe EN/ES | ✅ `?lang=es` | `i18n.ts`, `locales/*.json` |

Pruebas: 110 en `pytest pipeline/tests` y 13 en `cd web && npx vitest run`, incluida la paridad Python/TS.
`npm run build` compila sin errores.

### Resultados clave (año 2027, altura 2 m)

Luz: Peak near Shackleton 83,4 %, de Gerlache Rim 1 81,2 %, de Gerlache-Kocher 80,1 %,
Connecting Ridge 79,2 %, Leibnitz Beta 74,0 %, Malapert 65,7 %. IM-2 Athena: Sol a 2,47° sobre
un horizonte de 0,83°.

## 2. Cómo correr

```bash
pip install -r pipeline/requirements.txt
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

- [ ] Activar GitHub Pages y probar la URL publicada en ventana privada y en celular (T18, T32).
- [ ] Pedir la clasificación FortiGuard del dominio (T32).
- [ ] Storyboard, nombre y logo (T12); capturas y grabaciones (T24); video de 30 s con subtítulos en inglés (T29).
- [ ] Página del proyecto en inglés con todos los campos (T30) y envío (T33).
- [ ] Decidir si se eliminan `frontend/` y `backend/` (prototipo anterior "LUNAR SIGHT", sin uso).

**Extras del plan (en este orden):**

- [ ] **T25 Incertidumbre**: hecho para Connecting Ridge (69,0/78,8/81,4 %) y Shackleton Rim (52,5/54,2/55,8 %).
      Faltan 12 sitios cubiertos: `python pipeline/run_all.py --uncertainty --skip-ephem --skip-validate`
      (Mons Mouton no está en ningún DEM de PGDA 78).
- [x] **T26 Control de altura del panel** (Connecting Ridge 1/2/5/10 m: 65,5/79,2/87,3/89,3 % de luz).
- [ ] Riesgo de luz al aterrizar (Sol bajo, sombras largas, horas de luz restantes tras el aterrizaje).
- [x] **T27 Escena 3D con sombras** y 360° inmersivo (ver §5). Falta medir en celular la carga (< 3 s) y la línea del horizonte 3D contra la máscara.
- [x] **T28 Bilingüe EN/ES** (diccionario propio, sin i18next).
- [ ] Asistente en lenguaje natural; reporte exportable (PDF/PNG del escenario).

**Diferido por diseño:**

- [ ] **Coordenadas libres**: una app estática no puede calcular el horizonte de un punto cualquiera. Hay dos
      opciones. (a) Precalcular una grilla de horizontes (p. ej. cada 250 m en zonas de interés) e interpolar.
      (b) Exponer `pipeline` como API (FastAPI; ya existe un esqueleto en `backend/main.py`) que calcule a
      demanda, en ~5–10 s por punto con caché de tiles.

## 4. Mejoras pendientes y problemas conocidos

**Datos y ciencia:**

- Los sitios Artemis se reubicaron al punto con más luz y pendiente ≤ 8° dentro de 1 km del centro de la región
  (`refine_sites.py`). Mejoras posibles:
  - puntuar luz + Tierra + pendiente en vez de solo luz;
  - ampliar el radio de búsqueda;
  - usar varios años en lugar de solo 2027.
- Falta comparar la iluminación con valores publicados en más sitios (hoy solo Mazarico 2011 en Connecting Ridge:
  80,9 % nuestro contra ~86–89 % publicado). También falta la prueba visual de siluetas con Quickmap/Moon Trek (`docs/validation.md`).
- Faltan las regiones de la lista 2024 sin coordenadas publicadas: "Peak near Cabeus B" y "Slater Plain".
- Chandrayaan-3 (69,4° S) quedó fuera, porque no lo cubre ningún DEM de 80° S ni el mapa base.
- Las filas de `validation.json` guardan `d_az`/`d_el` redondeados (se ven como 0). El resumen sí tiene el valor exacto.

**Frontend:**

- La banda de luz de la línea de tiempo solo usa color: agregar una señal que no dependa del color (accesibilidad).
- 3 advertencias de lint (react-refresh en `Scene3D.tsx`). Bundle principal 429 KB (132 KB gzip); `three` va aparte (497 KB, solo en `#/3d`).
- Panorama de de-gerlache-rim-2: 97,7 % de columnas dentro de 0,2° (su horizonte pasa de +15°, el borde de la imagen).
- El 360° usa solo sombreado Lambert: no hay sombras proyectadas por píxel.
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

Hoy el "panorama 360°" es un gráfico 2D: azimut contra elevación, con el horizonte relleno. Para la demo se
proponen dos piezas, que se pueden hacer en paralelo con la misma división pipeline → JSON/binarios → web.

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

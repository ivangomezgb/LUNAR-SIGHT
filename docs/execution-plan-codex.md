## Objetivo y alcance

Entregar en **una sesión de unas 6 horas** una SPA publicada con **8 sitios reales**, horizonte a **2 m**, panorama, métricas, timeline de 30 días, comparación de hasta 3 sitios, ranking de alternativas y validación visible.

El repositorio tiene un esqueleto Vite/React en `web/`; `pipeline/` todavía no existe. Usar `web/` y dejar `frontend/` y `backend/` fuera del trabajo.

**Prioridad:** conseguir un sitio real funcionando de extremo a extremo antes de ampliar a ocho. Reservar la última hora para integración, publicación y correcciones.

## Acuerdos iniciales: primeros 20 minutos

El agente de integración congela contratos y dependencias; después arrancan los cinco frentes.

- Mantener los contratos `sites.json`, `sites/<id>.json`, `validation.json` y `basemap.*` del documento.
- Horizonte: `az_step_deg: 0.5`, `heights_m: [2]`, exactamente 720 enteros en `elev_cdeg["2"]`; `uncertainty: null`.
- Efemérides: UTC, paso horario, intervalo **[2026-11-01, 2029-01-01)**; `n = 19008`. Todos los arrays deben medir `n`.
- Azimut desde norte local, horario; longitudes positivas al este; grados y centésimas según el contrato.
- Métricas sobre intervalos **[inicio, fin)** alineados a horas. Ventanas incompletas: rechazarlas. Eventos posteriores al último dato: `null`, mostrado como “Outside data coverage”.
- Tierra visible si `el − horizonte ≥ 0.5°`; día si fracción solar `≥ 0.5`. Altura fija de 2 m y radio solar de 0.267°, visibles como supuestos.
- Precisar `validation.json`: objeto con `rows`, `summary` e `im2`; conservar los campos de fila definidos en el plan. Añadir metadatos de fuente, umbrales y estado de validación.
- Precisar `basemap.json`: CRS lunar, dimensiones y transformación afín píxel→mapa; coordenadas de píxel de cada sitio precalculadas para evitar PROJ en el navegador.
- Fixtures sintéticos únicamente en pruebas; **ningún dato ficticio se publica**.

**Regla de propiedad:** cada archivo tiene un solo escritor. Los consumidores importan o leen; solicitan cambios al propietario. Solo integración modifica dependencias, lockfile y configuración compartida.

## 1. Efemérides y validación

**Archivos nuevos, propiedad exclusiva:**

- `pipeline/lln/ephem.py`
- `pipeline/lln/validate.py`
- `pipeline/scripts/download_kernels.py`
- `pipeline/kernels/lln.tm`
- `pipeline/tests/test_ephem.py`
- `pipeline/tests/test_validate.py`
- `pipeline/tests/fixtures/horizons-response.txt`
- `docs/validation.md`

**Consume:** `pipeline/config/sites.yaml`; kernels descargados; contratos congelados.

**Produce:** `pipeline/data/intermediate/ephem/<id>.json`, con el objeto `ephem` del contrato; `pipeline/data/intermediate/validation.json`. El frente 2 publica estos resultados. Calcular vectores Sol/Tierra una vez y reutilizarlos por sitio.

**Aceptación:**

- Arrays completos, finitos; azimut `[0,360)`; elevación `[-90,90]`.
- Comparación independiente: **3 sitios × 10 instantes × 2 cuerpos**, error máximo ≤0.05°; diferencia azimutal circular.
- Publicar errores reales y solicitudes/respuestas reproducibles.
- Caso IM-2 calculado aparte para marzo de 2025, sin ampliar toda la serie del MVP.

**Riesgos y mitigación:**

- `MOON_ME`, datum de elevación y correcciones aparentes inconsistentes: comparar primero un sitio y un instante, antes de generar todo; usar observador topocéntrico consistente. Revisar configuración con el [manual de Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html).
- Parser de Horizons: guardar respuesta real, interpretar encabezados y detectar errores de API.
- SPICE bloqueado al minuto 60: series Horizons cacheadas. Si producción usa Horizons, etiquetar su procedencia; compararlas contra el mismo servicio **no constituye validación independiente**.

## 2. DEM, horizonte y exportación

**Archivos nuevos, propiedad exclusiva:**

- `pipeline/config/sites.yaml`
- `pipeline/lln/dem.py`
- `pipeline/lln/horizon.py`
- `pipeline/lln/export.py`
- `pipeline/tests/test_dem.py`
- `pipeline/tests/test_horizon.py`
- `pipeline/tests/test_export.py`
- Todos los archivos generados de `web/public/data/`: `sites.json`, `sites/<id>.json`, `validation.json`, `basemap.png`, `basemap.json`.

**Consume:** efemérides y validación del frente 1; contratos; DEM.

**Produce:** catálogo con fuentes verificadas, máscaras y paquete estático completo. Exportación determinista, validada y mediante reemplazo atómico.

**Aceptación:**

- Transformación coordenadas ida/vuelta: error <1 m.
- Luna lisa a 2 m: aproximadamente −0.087° ±0.01°.
- Muro sintético: fórmula del plan ±0.02°.
- Norte/este correctos, continuidad angular, nodata y bordes detectados.
- Ocho sitios con cobertura suficiente; ningún horizonte incompleto convertido silenciosamente en terreno plano.

**Riesgos y mitigación:**

- **Cobertura:** PGDA 81 cubre 87–90°S; el Mons Mouton de ejemplo y Chandrayaan-3 quedan fuera. Elegir los ocho sitios dentro de cobertura y con margen para el horizonte; buscar otro DEM real para IM-2 o presentar ese caso solo como comprobación solar, indicando la limitación. La fuente también especifica `MOON_ME` de DE421: documentar y resolver su consistencia con SPICE DE440. [PGDA 81](https://pgda.gsfc.nasa.gov/products/81).
- **GeoTIFF de ~3.4 GB:** probar primero metadatos, HTTP Range, organización por bloques y overviews del [archivo propuesto](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/87S/ldem_87s_5mpp.tif); no asumir que es un COG optimizado. Rasterio permite HTTPS mediante `/vsicurl/`. [Documentación](https://rasterio.readthedocs.io/en/stable/topics/vsi.html).
- Leer ventanas y cachearlas; jamás cargar el mosaico completo. Para distancias grandes, bloques o sectores con resolución reducida, evitando una matriz enorme a 5 m. Reducir `out_shape` no garantiza poco tráfico si faltan overviews.
- Sin lectura remota eficiente al minuto 30: descarga local única o DEM regional preparado. Sin máscara real al minuto 90: activar horizonte a 20 m hasta 60 km y declarar resolución/radio.
- A 200 km, revisar geometría esférica y convergencia del horizonte; el ejemplo parabólico del documento requiere comprobar su error.

## 3. Motor web y pruebas numéricas

**Archivos nuevos, propiedad exclusiva:**

- `web/src/lib/{types,data,sunFraction,metrics,score}.ts`
- `web/src/lib/tests/{data,sunFraction,metrics,score}.test.ts`
- `pipeline/lln/metrics.py`
- `pipeline/tests/test_metrics.py`
- `tests/fixtures/metrics/{input,expected}.json`

**Consume:** contratos JSON y fixtures comunes.

**Produce:** API tipada y estable: carga de catálogo/sitio, interpolación circular, series de visibilidad, métricas por ventana y ranking. Resultados con unidades explícitas; ranking devuelve sitio, fecha, puntuación, métricas y razones.

**Aceptación:**

- Fracción solar 0/0.5/1, monotonía e interpolación entre 359.5° y 0°.
- Rachas cortadas por límites, oscuridad inicial, eventos ausentes y fechas inválidas.
- Python/TypeScript: diferencia ≤0.1 puntos porcentuales y mismas duraciones.
- Filtros duros, empates deterministas y pesos totales cero controlados.
- Aproximadamente 3600 candidatos en <1 s en el equipo de demo.

**Riesgo:** recalcular todas las horas por candidato. Precalcular series y sumas acumuladas; reutilizar resultados por sitio/ventana. Validar JSON en ejecución, no confiar solo en tipos TypeScript.

## 4. Pantallas y componentes

**Archivos nuevos, propiedad exclusiva:**

- `web/src/pages/{Explore,Compare,Replan,Validation,About}.tsx`
- `web/src/components/{SiteMap,Panorama,MetricCards,Timeline,DateTimePicker,CompareGrid,ReplanForm,RankingTable,WeightSliders,ValidationTable,CaseStudy}.tsx`
- `web/src/ui.css`

**Consume:** API del frente 3; `basemap.*`; componentes de página exportados con interfaz acordada. Integración controla el montaje y navegación.

**Produce:** interfaz en inglés, tema oscuro, estados de carga/error, panorama SVG y escenarios compartibles por URL.

**Aceptación:**

- Selección → panorama → métricas/timeline → retraso → alternativa abierta en panorama.
- Compare sincroniza fecha y duración en hasta tres sitios.
- Trayectorias sin líneas falsas al cruzar 360°; Tierra punteada; exageración vertical rotulada.
- Funciona a 375 px y con teclado; cifras siempre con unidades.
- Validation diferencia resultados aprobados, fallidos y pendientes.

**Riesgo:** gastar la sesión en librerías y acabado. Usar React + SVG y estado local; omitir D3, Zustand y router si no aportan valor inmediato. Priorizar panorama y flujo completo.

## 5. Integración y despliegue

**Archivos nuevos, propiedad exclusiva:**

- `docs/contracts.md`
- `contracts/{sites,site,validation,basemap}.schema.json`
- `contracts/fixtures/{sites,site,validation,basemap}.json`
- `pipeline/{requirements.txt,run_all.py}`
- `pipeline/lln/__init__.py`
- `pipeline/scripts/check_environment.py`
- `web/vitest.config.ts`
- `web/playwright.config.ts`
- `web/tests/smoke.spec.ts`
- `.github/workflows/deploy.yml`
- `docs/assumptions.md`, `LICENSE`

**Archivos existentes exclusivos para modificar:** `README.md`, `.gitignore` si existe —crearlo si falta—, `web/package.json`, lockfile único, `web/vite.config.ts`, `web/src/{main.tsx,App.tsx,App.css,index.css}`.

**Consume:** entregables de los otros cuatro frentes.

**Produce:** comandos reproducibles, integración de páginas, CI y despliegue estático.

**Aceptación y riesgos:**

- Windows + Python 3.12: entorno virtual, instalación desde wheels y prueba de imports; evitar compilar GDAL durante la sesión. Numba opcional con alternativa NumPy.
- Node 20: fijar versión y dependencias compatibles con el Vite existente.
- Rutas con `pathlib`; sin depender de Bash ni del directorio actual.
- `pytest`, pruebas web, build y smoke publicados aprobados.
- GitHub Pages: `base` correcto y cargas usando `import.meta.env.BASE_URL`; navegación por hash para evitar 404.
- CI despliega datos ya generados; no descarga DEM ni ejecuta el pipeline pesado.
- Ningún kernel, caché o DEM en Git; publicación sin fixtures.

## Recortes deliberados

- **T06/T13:** ocho sitios, una altura; tres escalas solo si pasan las pruebas y el presupuesto de tiempo.
- **Coordenadas libres:** diferir. Una SPA estática no puede generar un horizonte real para un punto arbitrario.
- **T25–T28:** diferir clones, control de altura, 3D e idiomas.
- **T20:** conservar ranking entre sitios con paso de 6 h, duración y pesos; diferir filtros regionales avanzados. Si falla rendimiento, limitar a fechas del mismo sitio.
- **T21:** comparación sencilla reutilizando componentes.
- **T22:** IM-2 sin inferir causas del desenlace; horizonte solo si hay DEM válido del lugar.
- Diferir reporte exportable, asistente, riesgo de aterrizaje y duplicación de métricas fuera de la prueba cruzada.
- T12/T24/T29/T30/T33 quedan fuera del desarrollo técnico; preparar captura y guion breve tras estabilizar. Mantener README, fuentes y uso de IA.

## Orden de integración

| Momento | Entrega verificable |
|---|---|
| 0:00–0:20 | Contratos, propietarios, fixtures, entorno y dependencias congelados. |
| 0:20–1:00 | Cinco frentes en paralelo; UI con fixtures y primer despliegue del esqueleto. |
| 1:00–1:30 | Un sitio: DEM + horizonte + efemérides → JSON → motor → panorama publicado. Aplicar alternativas si falla. |
| 1:30–3:30 | Ampliar a ocho sitios; conectar timeline, Compare y Replan; completar validación. |
| 3:30–5:00 | Exportación final, paridad Python/TS, rendimiento y pruebas sobre URL publicada. |
| 5:00–6:00 | Congelar funciones; corregir errores, móvil, fuentes, supuestos y recorrido de demo. |

**Puerta final:** ocho horizontes reales, flujo completo publicado y validación honesta. Si falla cualquiera, recortar alcance antes de añadir funciones.
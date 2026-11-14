import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { azElToThree, loadTerrain, viewerError } from '../lib/terrain';
import type { GridSpec, Trail, ViewProps } from '../lib/terrain';
import { attachLook, disposeObject, disposeScene, marker, phaseEarth, ray, releaseRenderer, skyDome, trailLine } from './three/sceneTools';
import { t } from '../i18n';

function gridGeometry(spec: GridSpec, heights: Float32Array, max: number, hole = 0) {
  const count = Math.min(max, spec.n), positions = new Float32Array(count * count * 3), indices = new Uint32Array((count - 1) * (count - 1) * 6), valid: boolean[] = [];
  for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) {
    const col = Math.round(i * (spec.n - 1) / (count - 1)), row = Math.round(j * (spec.n - 1) / (count - 1)), k = j * count + i;
    const x = (col - (spec.n - 1) / 2) * spec.res_m, z = (row - (spec.n - 1) / 2) * spec.res_m, h = heights[row * spec.n + col];
    valid[k] = Number.isFinite(h); positions.set([x, valid[k] ? h : 0, z], k * 3);
  }
  let indexCount = 0;
  for (let j = 0; j < count - 1; j++) for (let i = 0; i < count - 1; i++) {
    const a = j * count + i, b = a + 1, c = a + count, d = c + 1;
    // Remove every far cell intersecting the near footprint, avoiding overlapping surfaces.
    if (hole && positions[a * 3] < hole && positions[d * 3] > -hole && positions[a * 3 + 2] < hole && positions[d * 3 + 2] > -hole) continue;
    if (valid[a] && valid[b] && valid[c]) { indices[indexCount++] = a; indices[indexCount++] = c; indices[indexCount++] = b; }
    if (valid[b] && valid[c] && valid[d]) { indices[indexCount++] = b; indices[indexCount++] = c; indices[indexCount++] = d; }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3)); g.setIndex(new THREE.BufferAttribute(indices.subarray(0, indexCount), 1)); g.computeVertexNormals(); return g;
}

/** Elevations on the overview dome are exaggerated so polar Sun/Earth paths (a few degrees) are readable. */
const DOME_EL_SCALE = 6;
const FP_HEIGHT_M = 2;
const SKY_R = 100000;
type Flight = { t0: number; ms: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromLook: THREE.Vector3; toLook: THREE.Vector3; done: () => void };

export default function Scene3D(props: ViewProps) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const sunLabel = useRef<HTMLSpanElement>(null), earthLabel = useRef<HTMLSpanElement>(null);
  const setModeRef = useRef<((first: boolean) => void) | null>(null);
  const firstPerson = props.mode === 'first';
  const [status, setStatus] = useState(t('Loading terrain… {0}%', { 0: 0 })), [failed, setFailed] = useState(false), [compass, setCompass] = useState('');

  useEffect(() => {
    const started = performance.now();
    const node = host.current!; const abort = new AbortController(); let cleanup = () => {};
    setStatus(t('Loading terrain… {0}%', { 0: 0 })); setFailed(false);
    loadTerrain(props.siteId, n => setStatus(t('Loading terrain… {0}%', { 0: n })), abort.signal).then(data => {
      if (abort.signal.aborted) return;
      const created: THREE.WebGLRenderer[] = [];
      try {
      const lowEnd = matchMedia('(max-width: 699px)').matches || navigator.hardwareConcurrency <= 4;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const renderer = new THREE.WebGLRenderer({ antialias: !lowEnd }); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMappingExposure = 1.25; renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.type = THREE.PCFSoftShadowMap; created.push(renderer); node.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1, .1, 400000);
      const extent = (data.meta.near.n - 1) * data.meta.near.res_m / 2;
      const material = new THREE.MeshStandardMaterial({ color: 0xaaa59d, roughness: 1 });
      for (const [spec, h, hole] of [[data.meta.near, data.near, 0], [data.meta.far, data.far, extent]] as const) { const mesh = new THREE.Mesh(gridGeometry(spec, h, hole ? spec.n : lowEnd ? 512 : 1024, hole), material); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); }
      const sun = new THREE.DirectionalLight(0xffffff, 3), earth = new THREE.DirectionalLight(0xa8bcff, .008); scene.add(sun, sun.target, earth, earth.target); sun.castShadow = true; sun.shadow.mapSize.set(lowEnd ? 2048 : 4096, lowEnd ? 2048 : 4096);
      Object.assign(sun.shadow.camera, { left: -extent * 1.5, right: extent * 1.5, top: extent * 1.5, bottom: -extent * 1.5, near: 1, far: extent * 8 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -.00002; sun.shadow.normalBias = 1.2;
      const sky = new THREE.Mesh(new THREE.SphereGeometry(180000, 32, 16), new THREE.MeshBasicMaterial({ color: 0, side: THREE.BackSide })); scene.add(sky);
      const sunDisk = marker(.267, 0xffffff, 150000), earthDisk = phaseEarth(150000); scene.add(sunDisk, earthDisk);
      // Decorative glow so the grazing Sun is easy to find; the terrain still occludes it (depth-tested).
      const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
      const gctx = glowCanvas.getContext('2d')!, grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,244,214,1)'); grad.addColorStop(.12, 'rgba(255,226,160,.55)'); grad.addColorStop(1, 'rgba(255,200,120,0)');
      gctx.fillStyle = grad; gctx.fillRect(0, 0, 128, 128);
      const glowTexture = new THREE.CanvasTexture(glowCanvas); glowTexture.colorSpace = THREE.SRGBColorSpace;
      const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      const glowSize = Math.tan(3 * Math.PI / 180) * 150000 * 2; sunGlow.scale.set(glowSize, glowSize, 1); scene.add(sunGlow);

      // Overview: site pin plus a dome of sky directions with the real Sun/Earth paths.
      const domeR = extent * 0.6;
      const overview = new THREE.Group(); scene.add(overview);
      // This pin denotes the actual dataset origin, not a lander.
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 160, 8), new THREE.MeshBasicMaterial({ color: 0xf2ce80 })); pin.position.set(0, 80, 0);
      const halo = new THREE.Mesh(new THREE.RingGeometry(50, 65, 48), new THREE.MeshBasicMaterial({ color: 0xf2ce80, side: THREE.DoubleSide })); halo.rotation.x = -Math.PI / 2; halo.position.y = 3;
      const sunRay = ray(0xf5c451), earthRay = ray(0x6fa8ff);
      const sunBall = new THREE.Mesh(new THREE.SphereGeometry(domeR * 0.025, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffd36b, depthTest: false })); sunBall.renderOrder = 12;
      const earthBall = new THREE.Mesh(new THREE.SphereGeometry(domeR * 0.022, 20, 12), new THREE.MeshBasicMaterial({ color: 0x6fa8ff, depthTest: false })); earthBall.renderOrder = 12;
      const overviewTrails = new THREE.Group();
      overview.add(pin, halo, skyDome(domeR, DOME_EL_SCALE), sunRay, earthRay, sunBall, earthBall, overviewTrails);
      // First person: the same paths at true angles, far away so the real terrain hides them.
      const fpSky = new THREE.Group(), fpTrails = new THREE.Group(); fpSky.add(fpTrails); scene.add(fpSky);
      let lastTrails: [Trail | undefined, Trail | undefined] = [undefined, undefined];
      const rebuildTrails = (p: ViewProps) => {
        for (const g of [overviewTrails, fpTrails]) for (const c of [...g.children]) { disposeObject(c); g.remove(c); }
        if (p.sunTrail) { overviewTrails.add(trailLine(p.sunTrail, domeR, 0xf5c451, { elScale: DOME_EL_SCALE, depthTest: false })); fpTrails.add(trailLine(p.sunTrail, SKY_R, 0xf5c451)); }
        if (p.earthTrail) { overviewTrails.add(trailLine(p.earthTrail, domeR, 0x6fa8ff, { elScale: DOME_EL_SCALE, dashed: true, depthTest: false })); fpTrails.add(trailLine(p.earthTrail, SKY_R, 0x6fa8ff, { dashed: true })); }
        lastTrails = [p.sunTrail, p.earthTrail];
      };
      rebuildTrails(latest.current);
      if (new URLSearchParams(location.hash.split('?')[1]).has('debug')) {
        const points = props.horizon.map((h, i) => new THREE.Vector3(...azElToThree(i * props.horizonStep, h / 100)).multiplyScalar(10000));
        points.push(points[0].clone());
        fpSky.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xf2ce80, depthTest: false })));
      }

      const overviewPose = new THREE.Vector3(extent * .7, extent * .5, extent * .7);
      const orbit = new OrbitControls(camera, renderer.domElement); orbit.enableDamping = !reducedMotion; orbit.dampingFactor = .08; orbit.maxPolarAngle = Math.PI * .49; orbit.minDistance = 20; orbit.maxDistance = extent * 5; renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', t('Lunar terrain 3D view')); orbit.listenToKeyEvents(renderer.domElement); orbit.target.set(0, 0, 0);
      let unlook = () => {};
      let first = latest.current.mode === 'first';
      let flight: Flight | null = null;
      const eye = () => new THREE.Vector3(0, FP_HEIGHT_M, 0);
      const lookAhead = () => eye().add(new THREE.Vector3(...azElToThree(latest.current.sunAz, 0)).multiplyScalar(400));
      const enterFirst = () => { first = true; orbit.enabled = false; unlook = attachLook(renderer.domElement, camera, setCompass, latest.current.sunAz); };
      const enterOverview = () => { first = false; orbit.enabled = true; orbit.target.set(0, 0, 0); orbit.update(); };
      const fly = (toPos: THREE.Vector3, toLook: THREE.Vector3, ms: number, done: () => void) => {
        const fromLook = first ? camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(400)) : orbit.target.clone();
        if (reducedMotion) { camera.position.copy(toPos); camera.lookAt(toLook); done(); return; }
        flight = { t0: performance.now(), ms, fromPos: camera.position.clone(), toPos, fromLook, toLook, done };
      };
      setModeRef.current = (toFirst: boolean) => {
        if (toFirst === first && !flight) return;
        unlook(); unlook = () => {}; orbit.enabled = false;
        if (toFirst) { if (!first) overviewPose.copy(camera.position); fly(eye(), lookAhead(), 2200, enterFirst); }
        else fly(overviewPose.clone(), new THREE.Vector3(), 1800, enterOverview);
      };
      if (first) { camera.position.copy(eye()); camera.lookAt(lookAhead()); enterFirst(); }
      else if (reducedMotion) { camera.position.copy(overviewPose); enterOverview(); }
      else { camera.position.copy(overviewPose).multiplyScalar(1.6); camera.lookAt(0, 0, 0); fly(overviewPose.clone(), new THREE.Vector3(), 2000, enterOverview); }
      const stopIntro = () => { if (flight && !first && flight.toPos.y > FP_HEIGHT_M) { flight = null; enterOverview(); } };
      renderer.domElement.addEventListener('pointerdown', stopIntro);

      let dirty = true;
      const resize = new ResizeObserver(() => { dirty = true; const w = node.clientWidth, h = node.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); resize.observe(node); renderer.setSize(node.clientWidth, node.clientHeight); camera.aspect = node.clientWidth / node.clientHeight; camera.updateProjectionMatrix();
      const place = (el: HTMLSpanElement | null, at: THREE.Vector3, show: boolean, text: string) => {
        if (!el) return;
        const v = at.clone().project(camera), visible = show && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        el.style.display = visible ? '' : 'none';
        if (!visible) return;
        el.style.transform = `translate(${((v.x + 1) / 2) * node.clientWidth}px, ${((1 - v.y) / 2) * node.clientHeight}px)`;
        if (el.textContent !== text) el.textContent = text;
      };
      const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}°`;
      let lastSun = '', lastView = '', frame = 0, firstFrame = true;
      const draw = () => {
        const p = latest.current, s = new THREE.Vector3(...azElToThree(p.sunAz, p.sunEl)), e = new THREE.Vector3(...azElToThree(p.earthAz, p.earthEl));
        let moving = false;
        if (flight) {
          const k = Math.min(1, (performance.now() - flight.t0) / flight.ms), q = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          // Fly along a gentle arc so the camera does not clip through ridges on the way down.
          camera.position.lerpVectors(flight.fromPos, flight.toPos, q); camera.position.y += Math.sin(Math.PI * q) * extent * 0.08;
          camera.lookAt(new THREE.Vector3().lerpVectors(flight.fromLook, flight.toLook, q)); moving = true;
          if (k === 1) { const done = flight.done; flight = null; done(); }
        } else if (!first) orbit.update();
        if (p.sunTrail !== lastTrails[0] || p.earthTrail !== lastTrails[1]) { rebuildTrails(p); dirty = true; }
        const inFirst = first && !flight;
        overview.visible = !inFirst; fpSky.visible = inFirst; fpSky.position.copy(camera.position);
        const sunDome = new THREE.Vector3(...azElToThree(p.sunAz, p.sunEl * DOME_EL_SCALE)).multiplyScalar(domeR);
        const earthDome = new THREE.Vector3(...azElToThree(p.earthAz, p.earthEl * DOME_EL_SCALE)).multiplyScalar(domeR);
        sunBall.position.copy(sunDome); earthBall.position.copy(earthDome);
        sunRay.geometry.setFromPoints([new THREE.Vector3(0, 30, 0), sunDome]); earthRay.geometry.setFromPoints([new THREE.Vector3(0, 30, 0), earthDome]);
        earthDisk.material.uniforms.sunDirection.value.copy(s); sun.position.copy(s).multiplyScalar(extent * 3); earth.position.copy(e).multiplyScalar(extent * 3); sunDisk.position.copy(s).multiplyScalar(150000); earthDisk.position.copy(e).multiplyScalar(150000); sunDisk.position.add(camera.position); earthDisk.position.add(camera.position); sunGlow.position.copy(sunDisk.position); sky.position.copy(camera.position);
        const sunKey = p.sunAz + ',' + p.sunEl; if (sunKey !== lastSun) { renderer.shadowMap.needsUpdate = true; lastSun = sunKey; }
        const viewKey = camera.position.toArray().join(',') + camera.quaternion.toArray().join(',') + p.sunAz + ',' + p.sunEl + ',' + p.earthAz + ',' + p.earthEl + inFirst;
        if (dirty || moving || viewKey !== lastView) {
          renderer.render(scene, camera); lastView = viewKey; dirty = false;
          place(sunLabel.current, sunDome, !inFirst, `${t('Sun')} ${p.sunAz.toFixed(0)}° · ${fmt(p.sunEl)}`);
          place(earthLabel.current, earthDome, !inFirst, `${t('Earth')} ${p.earthAz.toFixed(0)}° · ${fmt(p.earthEl)}`);
        }
        if (firstFrame) { node.dataset.firstFrameMs = (performance.now() - started).toFixed(0); performance.mark('lunar-terrain-first-frame'); firstFrame = false; }
        frame = requestAnimationFrame(draw);
      };
      draw(); setStatus('');
      cleanup = () => { setModeRef.current = null; cancelAnimationFrame(frame); renderer.domElement.removeEventListener('pointerdown', stopIntro); resize.disconnect(); unlook(); orbit.dispose(); disposeScene(scene); releaseRenderer(renderer); };
      } catch (error) { created.forEach(releaseRenderer); throw error; }
    }).catch((error: unknown) => { if (!abort.signal.aborted) { setFailed(true); setStatus(t(viewerError(error))); } });
    return () => { abort.abort(); cleanup(); };
  }, [props.siteId, props.horizon, props.horizonStep]);

  useEffect(() => { setModeRef.current?.(firstPerson); }, [firstPerson]);

  const go = props.onMode ?? (() => {});
  return <section className="expedition-renderer">
    <div ref={host} className="expedition-canvas" aria-label={t('Lunar terrain 3D view')} />
    <div className="expedition-sky-labels" aria-hidden><span ref={sunLabel} className="sky-label sky-label-sun" /><span ref={earthLabel} className="sky-label sky-label-earth" /></div>
    <div className="expedition-camera">
      <div className="expedition-cta">
        {firstPerson
          ? <button type="button" onClick={() => go('overview')}>↑ {t('Back to 3D overview')}</button>
          : <button type="button" onClick={() => go('first')}>↓ {t('First person · 2 m')}</button>}
        <button type="button" className="is-primary" onClick={() => go('pano')}>{t('Astronaut view (360°)')}</button>
      </div>
      <p>{firstPerson
        ? <>{compass}<br />{t('Mesh horizon approx. (up to ~0.6°); exact horizon in 360°.')}</>
        : <>{t('Drag to orbit · Scroll to zoom')}<br />{t('Sky dome: real Sun (gold) and Earth (blue, dashed) paths; elevation ×{0}; dim = below the horizon.', { 0: DOME_EL_SCALE })}</>}</p>
    </div>
    {status && <div className="expedition-loading" role="status">{status}{!failed && <progress max={100} value={Number(status.match(/(\d+)%/)?.[1] ?? 0)} />}</div>}
  </section>;
}

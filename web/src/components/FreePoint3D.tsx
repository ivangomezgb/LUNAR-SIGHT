import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { azElToThree, viewerError } from '../lib/terrain';
import type { Trail } from '../lib/terrain';
import { loadFreeTerrainAssets } from '../lib/freepointTerrain';
import type { FreeTerrain } from '../lib/freepointTerrain';
import { attachLook, disposeObject, disposeScene, marker, phaseEarth, ray, releaseRenderer, skyDome, trailLine } from './three/sceneTools';
import { lunarMaterial, LUNAR_EXPOSURE, SUN_INTENSITY, EARTH_INTENSITY } from './three/lunarMaterial';

/** First-person eye heights (m). 2 m is the physical observer; higher values only lift the camera. */
const EYE_HEIGHTS_M = [2, 10, 50, 200];
const DEFAULT_EYE_M = 200;
/** Intensity of the optional, clearly labelled non-physical fill light. */
const ENHANCE_FILL = 1.6;
import { t } from '../i18n';
import '../styles/freepoint3d.css';

export interface FreePoint3DProps {
  lat: number; lon: number; elevationM: number;
  sunAz: number; sunEl: number; earthAz: number; earthEl: number;
  sunTrail?: Trail; earthTrail?: Trail;
}
export default function FreePoint3D(props: FreePoint3DProps) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const modeRef = useRef<(first: boolean) => void>(() => {});
  const [first, setFirst] = useState(false), firstRef = useRef(first); firstRef.current = first;
  const [status, setStatus] = useState('Loading coarse terrain…'), [missing, setMissing] = useState(false);
  // "Enhance visibility" adds a soft NON-PHYSICAL fill light so the relief can be read when the point is in
  // shadow (the real scene is black there). Off by default; labelled in the UI.
  const [enhance, setEnhance] = useState(false), enhanceRef = useRef(enhance); enhanceRef.current = enhance;
  const setFillRef = useRef<(on: boolean) => void>(() => {});
  const [sunHidden, setSunHidden] = useState(false);
  // Camera eye height in first person. Visual only: visibility and metrics stay at the 2 m observer.
  const [eyeH, setEyeH] = useState<number>(DEFAULT_EYE_M), eyeRef = useRef(eyeH); eyeRef.current = eyeH;
  const setEyeHRef = useRef<(h: number) => void>(() => {});
  const [compass, setCompass] = useState('');
  useEffect(() => {
    const node = host.current!, started = performance.now();
    let stopped = false, cleanup = () => {};
    const worker = new Worker(new URL('../lib/freepointTerrain.ts', import.meta.url), { type: 'module' });
    setStatus('Loading coarse terrain…'); setMissing(false); delete node.dataset.firstFrameMs;
    const start = (data: FreeTerrain) => {
      if (stopped) return;
      const scene = new THREE.Scene(); let renderer: THREE.WebGLRenderer | undefined;
      try {
        const phone = matchMedia('(max-width: 699px)').matches;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        renderer = new THREE.WebGLRenderer({ antialias: !phone });
        const render = renderer;
        render.setPixelRatio(Math.min(devicePixelRatio, 2)); render.toneMapping = THREE.ACESFilmicToneMapping;
        render.toneMappingExposure = LUNAR_EXPOSURE; render.outputColorSpace = THREE.SRGBColorSpace;
        render.shadowMap.enabled = true; render.shadowMap.type = THREE.PCFShadowMap; render.shadowMap.autoUpdate = false;
        node.appendChild(render.domElement);
        const camera = new THREE.PerspectiveCamera(60, 1, .1, 600000);
        render.setSize(Math.max(1, node.clientWidth), Math.max(1, node.clientHeight));
        camera.aspect = Math.max(1, node.clientWidth) / Math.max(1, node.clientHeight); camera.updateProjectionMatrix();
        const meshes: THREE.Mesh[] = [];
        for (const patch of [data.near, data.far]) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(patch.positions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(patch.normals, 3));
          geometry.setIndex(new THREE.BufferAttribute(patch.indices, 1));
          const mesh = new THREE.Mesh(geometry, lunarMaterial()); mesh.castShadow = true; mesh.receiveShadow = true;
          scene.add(mesh); meshes.push(mesh);
        }
        const sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY), earth = new THREE.DirectionalLight(0xffffff, EARTH_INTENSITY);
        scene.add(sun, sun.target, earth, earth.target); sun.castShadow = true;
        // Soft sky fill plus an oblique key light (no shadows) so slopes read; both clearly non-physical.
        const fill = new THREE.Group();
        const fillKey = new THREE.DirectionalLight(0xdfe6f0, ENHANCE_FILL); fillKey.position.set(0.75, 0.3, 0.55).multiplyScalar(100000); // ~17 deg: grazing, like a hillshade
        fill.add(new THREE.HemisphereLight(0xc8d2e0, 0x202020, ENHANCE_FILL * 0.35), fillKey, fillKey.target);
        fill.visible = enhanceRef.current; scene.add(fill);
        sun.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
        Object.assign(sun.shadow.camera, { left: -35000, right: 35000, top: 35000, bottom: -35000, near: 1, far: 400000 });
        sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -.00002; sun.shadow.normalBias = 2;
        const sunDisk = marker(.267, 0xffffff, 250000), earthDisk = phaseEarth(250000);
        scene.add(sunDisk, earthDisk);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const context = canvas.getContext('2d')!;
        const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255,255,255,.6)'); gradient.addColorStop(.15, 'rgba(255,255,255,.15)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.scale.set(10000, 10000, 1); scene.add(glow);
        const overview = new THREE.Group(), paths = new THREE.Group(), fpPaths = new THREE.Group(); scene.add(overview, fpPaths);
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(35, 35, 600, 8), new THREE.MeshBasicMaterial({ color: 0xf2ce80 })); pin.position.y = 300;
        const sunRay = ray(0xf5c451), earthRay = ray(0x6fa8ff);
        const sunBall = marker(1, 0xf5c451, 18000), earthBall = marker(1, 0x6fa8ff, 18000);
        overview.add(pin, skyDome(18000, 6), paths, sunRay, earthRay, sunBall, earthBall);
        const orbit = new OrbitControls(camera, render.domElement); orbit.enableDamping = !reduced;
        orbit.maxPolarAngle = Math.PI * .49; orbit.minDistance = 1000; orbit.maxDistance = 120000;
        orbit.listenToKeyEvents(render.domElement); render.domElement.tabIndex = 0;
        render.domElement.setAttribute('aria-label', t('Drag to orbit · Scroll to zoom'));
        const pose = new THREE.Vector3(32000, 23000, 32000);
        // The coarse mesh (~250 m vertices) does not pass through the point's sampled ground (z = 0), so the
        // 2 m eye is placed above the MESH surface at the point; otherwise it can end up inside the terrain.
        scene.updateMatrixWorld(true);
        const down = new THREE.Raycaster(new THREE.Vector3(0, 20000, 0), new THREE.Vector3(0, -1, 0));
        const groundHit = down.intersectObjects(meshes)[0];
        const ground = groundHit ? groundHit.point.y : 0;
        const observer = new THREE.Vector3(0, ground + 2, 0);            // physical 2 m observer (Sun visibility)
        const eye = new THREE.Vector3(0, ground + eyeRef.current, 0);     // camera in first person
        let unlook = () => {}, inFirst = false, intro = !reduced, frame = 0, dirty = true;
        let lastTrails: [Trail | undefined, Trail | undefined] | null = null, lastLight = '', lastView = '';
        camera.position.copy(pose).multiplyScalar(intro ? 1.4 : 1); camera.lookAt(0, 0, 0);
        const mode = (value: boolean) => {
          intro = false; unlook(); inFirst = value; orbit.enabled = !value;
          if (value) { camera.position.copy(eye); unlook = attachLook(render.domElement, camera, setCompass, latest.current.sunAz, eyeRef.current >= 50 ? -6 : -2); }
          else { camera.position.copy(pose); orbit.target.set(0, 0, 0); camera.lookAt(0, 0, 0); render.domElement.setAttribute('aria-label', t('Drag to orbit · Scroll to zoom')); }
          dirty = true;
        };
        modeRef.current = mode;
        setFillRef.current = (on: boolean) => { fill.visible = on; dirty = true; };
        setEyeHRef.current = (h: number) => { eye.y = ground + h; if (inFirst) camera.position.copy(eye); dirty = true; };
        if (firstRef.current) mode(true);
        const stopIntro = () => { intro = false; };
        render.domElement.addEventListener('pointerdown', stopIntro);
        const resize = new ResizeObserver(() => {
          const w = Math.max(1, node.clientWidth), h = Math.max(1, node.clientHeight);
          render.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
        }); resize.observe(node);
        const raycaster = new THREE.Raycaster();
        const draw = () => {
          const p = latest.current;
          if (intro) { const k = Math.min(1, (performance.now() - started) / 1800); camera.position.copy(pose).multiplyScalar(1 + .4 * (1 - k) ** 3); intro = k < 1; }
          if (!inFirst) orbit.update();
          overview.visible = !inFirst; fpPaths.visible = inFirst;
          if (!lastTrails || lastTrails[0] !== p.sunTrail || lastTrails[1] !== p.earthTrail) {
            disposeObject(paths); paths.clear(); disposeObject(fpPaths); fpPaths.clear();
            for (const [trail, color, dashed] of [[p.sunTrail, 0xf5c451, false], [p.earthTrail, 0x6fa8ff, true]] as const) if (trail) {
              paths.add(trailLine(trail, 18000, color, { elScale: 6, dashed, depthTest: false }));
              fpPaths.add(trailLine(trail, 250000, color, { dashed }));
            }
            lastTrails = [p.sunTrail, p.earthTrail]; dirty = true;
          }
          const s = new THREE.Vector3(...azElToThree(p.sunAz, p.sunEl)), e = new THREE.Vector3(...azElToThree(p.earthAz, p.earthEl));
          const lightKey = [p.sunAz, p.sunEl, p.earthAz, p.earthEl].join(',');
          if (lightKey !== lastLight) {
            sun.position.copy(s).multiplyScalar(200000); earth.position.copy(e).multiplyScalar(200000);
            earthDisk.material.uniforms.sunDirection.value.copy(s);
            sunBall.position.set(...azElToThree(p.sunAz, Math.max(-89, Math.min(89, p.sunEl * 6)))).multiplyScalar(18000);
            earthBall.position.set(...azElToThree(p.earthAz, Math.max(-89, Math.min(89, p.earthEl * 6)))).multiplyScalar(18000);
            sunRay.geometry.setFromPoints([new THREE.Vector3(), sunBall.position]); earthRay.geometry.setFromPoints([new THREE.Vector3(), earthBall.position]);
            // Gate glare against this mesh, not an invented horizon. No glare if coverage has holes.
            scene.updateMatrixWorld(true);
            raycaster.set(observer, new THREE.Vector3(...azElToThree(p.sunAz, p.sunEl - .267)));
            const sunBlocked = raycaster.intersectObjects(meshes).length > 0 || p.sunEl < -.267;
            glow.visible = !data.near.missing && !data.far.missing && !sunBlocked;
            setSunHidden(sunBlocked);
            render.shadowMap.needsUpdate = true; lastLight = lightKey; dirty = true;
          }
          sunDisk.position.copy(s).multiplyScalar(250000).add(camera.position);
          earthDisk.position.copy(e).multiplyScalar(250000).add(camera.position); glow.position.copy(sunDisk.position); fpPaths.position.copy(camera.position);
          const view = camera.position.toArray().join(',') + camera.quaternion.toArray().join(',');
          if (dirty || view !== lastView) {
            render.render(scene, camera); dirty = false; lastView = view;
            if (!node.dataset.firstFrameMs) node.dataset.firstFrameMs = (performance.now() - started).toFixed(0);
          }
          frame = requestAnimationFrame(draw);
        };
        cleanup = () => { cancelAnimationFrame(frame); resize.disconnect(); unlook(); orbit.dispose(); render.domElement.removeEventListener('pointerdown', stopIntro); disposeScene(scene); releaseRenderer(render); };
        draw(); setStatus(''); setMissing(data.near.missing || data.far.missing);
      } catch (error) { disposeScene(scene); if (renderer) releaseRenderer(renderer); setStatus(viewerError(error)); }
    };
    worker.onmessage = ({ data }: MessageEvent<{ terrain?: FreeTerrain; error?: string }>) => {
      worker.terminate(); if (!stopped) { if (data.terrain) start(data.terrain); else setStatus(data.error ?? 'Terrain coverage incomplete'); }
    };
    worker.onerror = () => { if (!stopped) setStatus('Terrain coverage incomplete'); worker.terminate(); };
    const base = import.meta.env.BASE_URL + (import.meta.env.VITE_DATA_DIR ?? 'data').replace(/\/$/, '') + '/free/';
    loadFreeTerrainAssets(base).then(assets => {
      if (!stopped) worker.postMessage({ assets, lat: props.lat, lon: props.lon, elevation: props.elevationM });
    }).catch(() => { if (!stopped) setStatus('Free-coordinate data unavailable'); });
    return () => { stopped = true; worker.terminate(); modeRef.current = () => {}; cleanup(); };
  }, [props.lat, props.lon, props.elevationM]);
  useEffect(() => { modeRef.current(first); }, [first]);
  useEffect(() => { setFillRef.current(enhance); }, [enhance]);
  useEffect(() => { setEyeHRef.current(eyeH); }, [eyeH]);
  return <section className="free3d card" aria-label={t('Lunar terrain 3D view')}>
    <div className="free3d-toolbar">
      <span className="eyebrow">{t('Approximate - coarse DEM')}</span>
      <div role="group" aria-label={t('Camera mode')}>
        <button className={`btn ${first ? 'btn-ghost' : 'btn-primary'}`} aria-pressed={!first} onClick={() => setFirst(false)}>{t('Overview')}</button>
        <button className={`btn ${first ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={first} onClick={() => setFirst(true)}>{t('First person')}</button>
        {first && <label className="free3d-eye">{t('Eye height (visual only)')} <select value={eyeH} onChange={e => setEyeH(Number(e.target.value))}>{EYE_HEIGHTS_M.map(h => <option key={h} value={h}>{h} m</option>)}</select></label>}
        <button className={`btn ${enhance ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={enhance} onClick={() => setEnhance(v => !v)} title={t('Adds a soft fill light that does not exist on the Moon, to read the relief in shadow.')}>{t('Enhance visibility')}</button>
      </div>
    </div>
    <div className="free3d-stage">
      <div className="free3d-canvas" ref={host} />
      <div className="free3d-hud">
        {first ? <span>{compass}</span> : <span>{t('Drag to orbit · Scroll to zoom')}</span>}
        <span className="free3d-sun">{t('Sun')} {props.sunAz.toFixed(1)}° / {props.sunEl.toFixed(1)}°</span>
        <span className="free3d-earth">{t('Earth')} {props.earthAz.toFixed(1)}° / {props.earthEl.toFixed(1)}°</span>
      </div>
      {status && <div className="free3d-status" role="status">{t(status)}</div>}
      {!status && sunHidden && !enhance && <div className="free3d-dark" role="note">{t('The Sun is behind the terrain here at this hour, so the real scene is dark.')} <button type="button" className="btn btn-sm" onClick={() => setEnhance(true)}>{t('Enhance visibility')}</button></div>}
      {enhance && <div className="free3d-enhanced" role="note">{t('Enhanced visibility: non-physical fill light')}</div>}
    </div>
    <div className="free3d-caption">
      <p>{t('Coarse 240 m LOLA terrain: shapes are approximate; no 5 m detail')}</p>
      <p>{first ? t('Drag or use arrow keys to look') : t('Sky dome: real Sun (gold) and Earth (blue, dashed) paths; elevation ×{0}; dim = below the horizon.', { 0: 6 })}</p>
      <p>{t('Distant terrain uses 960 m block maxima, out to 150 km. Mesh visibility is approximate; use the horizon chart for analysis.')}</p>
      {missing && <p role="status">{t('Terrain beyond the map edge is missing; nodata holes are left open.')}</p>}
    </div>
  </section>;
}

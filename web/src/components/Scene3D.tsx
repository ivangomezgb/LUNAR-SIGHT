import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { azElToThree, loadTerrain, MISSING_3D } from '../lib/terrain';
import type { GridSpec, ViewProps } from '../lib/terrain';
import { t } from '../i18n';

export function attachLook(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, report: (s: string) => void) {
  let az = 0, el = 0, pointer: number | null = null, x = 0, y = 0;
  const update = () => { camera.lookAt(camera.position.clone().add(new THREE.Vector3(...azElToThree(az, el)))); report(t('Azimuth {0}° · Elevation {1}°', { 0: az.toFixed(1), 1: el.toFixed(1) })); };
  const down = (e: PointerEvent) => { pointer = e.pointerId; x = e.clientX; y = e.clientY; canvas.setPointerCapture(pointer); };
  const move = (e: PointerEvent) => { if (e.pointerId !== pointer) return; az = (az - (e.clientX - x) * .15 + 360) % 360; el = THREE.MathUtils.clamp(el + (e.clientY - y) * .15, -89, 89); x = e.clientX; y = e.clientY; update(); };
  const up = () => { pointer = null; };
  const key = (e: KeyboardEvent) => { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); az = (az + (e.key === 'ArrowRight' ? 2 : e.key === 'ArrowLeft' ? -2 : 0) + 360) % 360; el = THREE.MathUtils.clamp(el + (e.key === 'ArrowUp' ? 2 : e.key === 'ArrowDown' ? -2 : 0), -89, 89); update(); };
  canvas.tabIndex = 0; canvas.style.touchAction = 'none'; canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('keydown', key); update();
  return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('keydown', key); };
}
export function marker(radiusDeg: number, color: number, distance: number) {
  return new THREE.Mesh(new THREE.SphereGeometry(Math.tan(radiusDeg * Math.PI / 180) * distance, 24, 16), new THREE.MeshBasicMaterial({ color }));
}
export function disposeScene(scene: THREE.Scene) {
  scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); } if (o instanceof THREE.DirectionalLight) o.shadow.dispose(); });
}
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
export default function Scene3D(props: ViewProps) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const [firstPerson, setFirstPerson] = useState(false), [status, setStatus] = useState(t('Loading terrain… {0}%', { 0: 0 })), [compass, setCompass] = useState('');
  useEffect(() => {
    const node = host.current!; const abort = new AbortController(); let cleanup = () => {};
    setStatus(t('Loading terrain… {0}%', { 0: 0 }));
    loadTerrain(props.siteId, n => setStatus(t('Loading terrain… {0}%', { 0: n })), abort.signal).then(data => {
      if (abort.signal.aborted) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; node.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1, .1, 400000);
      const extent = (data.meta.near.n - 1) * data.meta.near.res_m / 2;
      const material = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 1 });
      for (const [spec, h, hole] of [[data.meta.near, data.near, 0], [data.meta.far, data.far, extent]] as const) { const mesh = new THREE.Mesh(gridGeometry(spec, h, hole ? spec.n : matchMedia('(max-width: 700px)').matches ? 512 : 1024, hole), material); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); }
      const sun = new THREE.DirectionalLight(0xffffff, 3), earth = new THREE.DirectionalLight(0xa8bcff, .008); scene.add(sun, sun.target, earth, earth.target); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
      Object.assign(sun.shadow.camera, { left: -extent * 1.5, right: extent * 1.5, top: extent * 1.5, bottom: -extent * 1.5, near: 1, far: extent * 8 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -.00002; sun.shadow.normalBias = .3;
      const sky = new THREE.Mesh(new THREE.SphereGeometry(180000, 32, 16), new THREE.MeshBasicMaterial({color: 0, side: THREE.BackSide})); scene.add(sky);
      const sunDisk = marker(.267, 0xffffff, 150000), earthDisk = marker(.95, 0x8bb8e8, 150000); scene.add(sunDisk, earthDisk);
      camera.position.set(firstPerson ? 0 : extent * .7, firstPerson ? 2 : extent * .5, firstPerson ? 0 : extent * .7);
      const orbit = new OrbitControls(camera, renderer.domElement); orbit.enabled = !firstPerson; orbit.target.set(0, 0, 0); if (!firstPerson) orbit.update();
      const unlook = firstPerson ? attachLook(renderer.domElement, camera, setCompass) : () => {};
      const resize = new ResizeObserver(() => { const w = node.clientWidth, h = node.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); resize.observe(node);
      let frame = 0; const draw = () => { const p = latest.current, s = new THREE.Vector3(...azElToThree(p.sunAz, p.sunEl)), e = new THREE.Vector3(...azElToThree(p.earthAz, p.earthEl)); sun.position.copy(s).multiplyScalar(extent * 3); earth.position.copy(e).multiplyScalar(extent * 3); sunDisk.position.copy(s).multiplyScalar(150000); earthDisk.position.copy(e).multiplyScalar(150000); sunDisk.position.add(camera.position); earthDisk.position.add(camera.position); sky.position.copy(camera.position); renderer.render(scene, camera); frame = requestAnimationFrame(draw); }; draw(); setStatus('');
      cleanup = () => { cancelAnimationFrame(frame); resize.disconnect(); unlook(); orbit.dispose(); disposeScene(scene); renderer.dispose(); renderer.domElement.remove(); };
    }).catch(() => { if (!abort.signal.aborted) setStatus(t(MISSING_3D)); });
    return () => { abort.abort(); cleanup(); };
  }, [props.siteId, firstPerson]);
  return <section><button type="button" className="btn" onClick={() => setFirstPerson(v => !v)}>{firstPerson ? t('Orbit camera') : t('First person · 2 m')}</button><p className="small">{firstPerson ? `${compass} · ${t('Drag or use arrow keys to look')}` : t('Drag to orbit · Scroll to zoom')}</p><div ref={host} style={{height: 'min(65vh, 650px)', minHeight: 320, position: 'relative', background: '#000', overflow: 'hidden'}} aria-label={t('Lunar terrain 3D view')} />{status && <p role="status">{status}</p>}</section>;
}


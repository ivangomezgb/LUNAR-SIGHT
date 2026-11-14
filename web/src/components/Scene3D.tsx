import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { azElToThree, loadTerrain, MISSING_3D } from '../lib/terrain';
import type { GridSpec, ViewProps } from '../lib/terrain';
import { attachLook, disposeScene, marker, phaseEarth } from './three/sceneTools';
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
export default function Scene3D(props: ViewProps) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const [firstPerson, setFirstPerson] = useState(false), [status, setStatus] = useState(t('Loading terrain… {0}%', { 0: 0 })), [compass, setCompass] = useState('');
  useEffect(() => {
    const started = performance.now();
    const node = host.current!; const abort = new AbortController(); let cleanup = () => {};
    setStatus(t('Loading terrain… {0}%', { 0: 0 }));
    loadTerrain(props.siteId, n => setStatus(t('Loading terrain… {0}%', { 0: n })), abort.signal).then(data => {
      if (abort.signal.aborted) return;
      const lowEnd = matchMedia('(max-width: 699px)').matches || navigator.hardwareConcurrency <= 4;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const renderer = new THREE.WebGLRenderer({ antialias: !lowEnd }); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMappingExposure = 1.25; renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.type = THREE.PCFSoftShadowMap; node.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1, .1, 400000);
      const extent = (data.meta.near.n - 1) * data.meta.near.res_m / 2;
      const material = new THREE.MeshStandardMaterial({ color: 0xaaa59d, roughness: 1 });
      for (const [spec, h, hole] of [[data.meta.near, data.near, 0], [data.meta.far, data.far, extent]] as const) { const mesh = new THREE.Mesh(gridGeometry(spec, h, hole ? spec.n : lowEnd ? 512 : 1024, hole), material); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); }
      const sun = new THREE.DirectionalLight(0xffffff, 3), earth = new THREE.DirectionalLight(0xa8bcff, .008); scene.add(sun, sun.target, earth, earth.target); sun.castShadow = true; sun.shadow.mapSize.set(lowEnd ? 2048 : 4096, lowEnd ? 2048 : 4096);
      Object.assign(sun.shadow.camera, { left: -extent * 1.5, right: extent * 1.5, top: extent * 1.5, bottom: -extent * 1.5, near: 1, far: extent * 8 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -.00002; sun.shadow.normalBias = 1.2;
      const sky = new THREE.Mesh(new THREE.SphereGeometry(180000, 32, 16), new THREE.MeshBasicMaterial({color: 0, side: THREE.BackSide})); scene.add(sky);
      const sunDisk = marker(.267, 0xffffff, 150000), earthDisk = phaseEarth(150000); scene.add(sunDisk, earthDisk);
      camera.position.set(firstPerson ? 0 : extent * .7, firstPerson ? 2 : extent * .5, firstPerson ? 0 : extent * .7);
      // This pin denotes the actual dataset origin, not a lander.
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 160, 8), new THREE.MeshBasicMaterial({color:0xf2ce80}));
      pin.position.set(0,80,0); pin.visible = !firstPerson; scene.add(pin);
      const halo = new THREE.Mesh(new THREE.RingGeometry(50,65,48),new THREE.MeshBasicMaterial({color:0xf2ce80,side:THREE.DoubleSide}));
      halo.rotation.x = -Math.PI/2; halo.position.y=3; halo.visible=!firstPerson; scene.add(halo);
      if (firstPerson && new URLSearchParams(location.hash.split('?')[1]).has('debug')) {
        const points = props.horizon.map((h,i)=>new THREE.Vector3(...azElToThree(i*props.horizonStep,h/100)).multiplyScalar(10000).add(camera.position));
        points.push(points[0].clone());
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({color:0xf2ce80,depthTest:false})));
      }
      const destination = camera.position.clone(); const introStarted=performance.now();
      if (!firstPerson && !reducedMotion) camera.position.multiplyScalar(1.35);
      const orbit = new OrbitControls(camera, renderer.domElement); orbit.enabled = !firstPerson; orbit.enableDamping = !reducedMotion; orbit.dampingFactor=.08; orbit.maxPolarAngle=Math.PI*.49; orbit.minDistance=20; orbit.maxDistance=extent*5; renderer.domElement.tabIndex=0; renderer.domElement.setAttribute('aria-label',t('Lunar terrain 3D view')); orbit.listenToKeyEvents(renderer.domElement); orbit.target.set(0, 0, 0); if (!firstPerson) orbit.update();
      const unlook = firstPerson ? attachLook(renderer.domElement, camera, setCompass, latest.current.sunAz) : () => {};
      let resized=true; const resize = new ResizeObserver(() => { resized=true; const w = node.clientWidth, h = node.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); resize.observe(node); renderer.setSize(node.clientWidth,node.clientHeight); camera.aspect=node.clientWidth/node.clientHeight;camera.updateProjectionMatrix();
      let lastSun = '', lastView = ''; let frame = 0, firstFrame = true, intro = !firstPerson && !reducedMotion; const cancelIntro=()=>{intro=false;}; renderer.domElement.addEventListener('pointerdown',cancelIntro); const draw = () => { const p = latest.current, s = new THREE.Vector3(...azElToThree(p.sunAz, p.sunEl)), e = new THREE.Vector3(...azElToThree(p.earthAz, p.earthEl)); if (intro) {const fraction=Math.min(1,(performance.now()-introStarted)/1800);camera.position.copy(destination).multiplyScalar(1+.35*Math.pow(1-fraction,3));if(fraction===1)intro=false;} if(!firstPerson) orbit.update(); earthDisk.material.uniforms.sunDirection.value.copy(s); sun.position.copy(s).multiplyScalar(extent * 3); earth.position.copy(e).multiplyScalar(extent * 3); sunDisk.position.copy(s).multiplyScalar(150000); earthDisk.position.copy(e).multiplyScalar(150000); sunDisk.position.add(camera.position); earthDisk.position.add(camera.position); sky.position.copy(camera.position); const sunKey=p.sunAz+','+p.sunEl; if(sunKey!==lastSun){renderer.shadowMap.needsUpdate=true;lastSun=sunKey;} const viewKey=camera.position.toArray().join(',')+camera.quaternion.toArray().join(',')+p.sunAz+','+p.sunEl+','+p.earthAz+','+p.earthEl; if(resized || viewKey!==lastView){renderer.render(scene, camera);lastView=viewKey;resized=false;} if(firstFrame){node.dataset.firstFrameMs=(performance.now()-started).toFixed(0);performance.mark('lunar-terrain-first-frame');firstFrame=false;} frame = requestAnimationFrame(draw); }; draw(); setStatus('');
      cleanup = () => { cancelAnimationFrame(frame); renderer.domElement.removeEventListener('pointerdown',cancelIntro); resize.disconnect(); unlook(); orbit.dispose(); disposeScene(scene); renderer.dispose(); renderer.domElement.remove(); };
    }).catch(() => { if (!abort.signal.aborted) setStatus(t(MISSING_3D)); });
    return () => { abort.abort(); cleanup(); };
  }, [props.siteId, firstPerson, props.horizon, props.horizonStep]);
  return <section className="expedition-renderer">
    <div ref={host} className="expedition-canvas" aria-label={t('Lunar terrain 3D view')} />
    <div className="expedition-camera"><button type="button" onClick={() => setFirstPerson(v => !v)}>{firstPerson ? t('Orbit camera') : t('First person · 2 m')}</button><p>{firstPerson ? compass : t('Drag to orbit · Scroll to zoom')}<br />{firstPerson ? t('Local mesh horizon is approximate; use 360° for the full horizon.') : t('Gold pin: landing site')}</p></div>
    {status && <div className="expedition-loading" role="status">{status}{status !== t(MISSING_3D) && <progress max={100} value={Number(status.match(/(\d+)%/)?.[1] ?? 0)} />}</div>}
  </section>;
}

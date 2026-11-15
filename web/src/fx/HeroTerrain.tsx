import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { azElToThree, loadTerrain } from '../lib/terrain';
import { gridGeometry } from '../game/render/terrainMesh';
import { marker, releaseRenderer, disposeScene } from '../components/three/sceneTools';

interface Props {
  siteId: string;
  sunAz: number; // real Sun azimuth/elevation at the landing time (deg)
  sunEl: number;
  exaggeration?: number;
}

/**
 * Hero backdrop: the site's real 10 m LOLA terrain, lit from the Sun's real direction at
 * the chosen landing time, seen by a slowly orbiting camera that leans toward the pointer.
 * Vertical relief is exaggerated (stated in the caption). Renders only while visible.
 */
export default function HeroTerrain({ siteId, sunAz, sunEl, exaggeration = 3 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sun = useRef({ az: sunAz, el: sunEl });
  sun.current = { az: sunAz, el: sunEl };
  const [on, setOn] = useState(false);

  useEffect(() => {
    const node = host.current!;
    const abort = new AbortController();
    let cleanup = () => {};
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowEnd = matchMedia('(max-width: 720px)').matches || navigator.hardwareConcurrency <= 4;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;

    const start = () => loadTerrain(siteId, undefined, abort.signal).then((data) => {
      if (abort.signal.aborted) return;
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, alpha: true, powerPreference: 'high-performance' });
      } catch { return; } // no WebGL: the CSS gradient stays
      renderer.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1.25 : 1.75));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      node.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const half = ((data.meta.near.n - 1) * data.meta.near.res_m) / 2;
      scene.fog = new THREE.Fog(0x0a0d14, half * 0.7, half * 2.4);
      const camera = new THREE.PerspectiveCamera(38, 1, 5, half * 40);
      const geo = gridGeometry(data.meta.near, data.near, lowEnd ? 160 : 320);
      const mat = new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.95, metalness: 0, flatShading: false });
      const terrain = new THREE.Mesh(geo, mat);
      terrain.scale.y = exaggeration;
      scene.add(terrain);
      // Wireframe veil on the far ring: context, not detail.
      const far = new THREE.Mesh(gridGeometry(data.meta.far, data.far, 96, half), new THREE.MeshBasicMaterial({ color: 0x334055, wireframe: true, transparent: true, opacity: 0.18 }));
      far.scale.y = exaggeration;
      scene.add(far);

      const light = new THREE.DirectionalLight(0xfff1d6, 4.2);
      const fill = new THREE.HemisphereLight(0x5a7bb0, 0x0a0a0a, 0.18); // readability only
      scene.add(light, fill);
      const disk = marker(0.9, 0xfff3d1, half * 20);
      scene.add(disk);

      const resize = () => {
        const w = node.clientWidth || 1, h = node.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.fov = w / h < 1 ? 62 : 38; // portrait phones: widen so the ridge stays in frame
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(node);
      resize();

      let visible = true, frame = 0, px = 0, py = 0, tx = 0, ty = 0;
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(performance.now()); }, { threshold: 0.01 });
      io.observe(node);
      const pointer = (e: PointerEvent) => { tx = (e.clientX / innerWidth) * 2 - 1; ty = (e.clientY / innerHeight) * 2 - 1; };
      window.addEventListener('pointermove', pointer, { passive: true });

      const t0 = performance.now();
      const draw = (now: number) => {
        const s = sun.current, dir = new THREE.Vector3(...azElToThree(s.az, s.el));
        light.position.copy(dir).multiplyScalar(half * 4);
        disk.position.copy(dir).multiplyScalar(half * 20);
        disk.visible = s.el > -0.3;
        px += (tx - px) * 0.04; py += (ty - py) * 0.04;
        // orbit opposite the Sun so lit slopes face the camera; drift slowly
        const a = (s.az + 180) * Math.PI / 180 + (reduced ? 0 : (now - t0) * 0.000025) + px * 0.25;
        const portrait = camera.aspect < 1;
        const r = half * (portrait ? 0.75 : 0.95), height = half * ((portrait ? 0.7 : 0.2) + py * 0.05);
        camera.position.set(Math.sin(a) * r, height, -Math.cos(a) * r);
        camera.lookAt(0, portrait ? -half * 0.55 : half * 0.02, 0); // portrait: a steeper look keeps lit ground in the upper half
        renderer.render(scene, camera);
      };
      const loop = (now: number) => {
        cancelAnimationFrame(frame);
        if (!visible || document.hidden) return;
        draw(now);
        if (!reduced) frame = requestAnimationFrame(loop);
      };
      const vis = () => { if (!document.hidden) loop(performance.now()); };
      document.addEventListener('visibilitychange', vis);
      draw(performance.now());
      loop(performance.now());
      setOn(true);

      cleanup = () => {
        cancelAnimationFrame(frame);
        io.disconnect();
        ro.disconnect();
        window.removeEventListener('pointermove', pointer);
        document.removeEventListener('visibilitychange', vis);
        disposeScene(scene);
        releaseRenderer(renderer);
      };
    }).catch(() => { /* hero stays as a gradient */ });

    // Let the page settle first: the hero is decoration over real content.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const handle = idle ? idle(() => start(), { timeout: 1500 }) : window.setTimeout(start, 300);
    return () => {
      abort.abort();
      if (!idle) clearTimeout(handle);
      cleanup();
    };
  }, [siteId, exaggeration]);

  return <div ref={host} className={`hero-canvas${on ? ' is-on' : ''}`} aria-hidden />;
}

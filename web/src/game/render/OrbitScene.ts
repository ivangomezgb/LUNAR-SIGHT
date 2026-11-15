// Orbital view of the lunar south pole: the published LOLA hillshade (basemap.png) draped on
// the curved polar cap, the rest of the Moon lit by the real Sun direction, the Earth at its
// real direction with its phase, and a pin per candidate site. Units: km.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Basemap, SiteIndexEntry } from '../../lib/types';
import { disposeScene, phaseEarth, releaseRenderer } from '../../components/three/sceneTools';
import { latLonToMap, mapToSphere, R_KM, upAt } from '../sim/polar';

const CAP_SEGMENTS = 128;

export interface OrbitSky { sun: [number, number, number]; earth: [number, number, number] }

export class OrbitScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.05, 2e6);
  private controls: OrbitControls;
  private sunLight = new THREE.DirectionalLight(0xffffff, 2.6);
  private earth = phaseEarth(60000);
  private pins = new Map<string, { group: THREE.Group; head: THREE.Mesh; hit: THREE.Mesh; base: THREE.Vector3 }>();
  private ring: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private node: HTMLElement;
  private resizeObs: ResizeObserver;
  private frame = 0;
  private fly: { t0: number; ms: number; from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; done: () => void } | null = null;
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private disposeInput: () => void;
  private moonCenter: THREE.Vector3;
  private cap!: THREE.Mesh;
  /** True while the camera is far from the polar sites (pins hidden). */
  far = true;
  onFar: (far: boolean) => void = () => {};
  onPick: (id: string) => void = () => {};
  onHover: (id: string | null, x: number, y: number) => void = () => {};

  constructor(node: HTMLElement, texture: HTMLImageElement, basemap: Basemap, sites: SiteIndexEntry[], colorOf: (g: string) => string, lowEnd: boolean) {
    this.node = node;
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, alpha: false, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1.5 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.setClearColor(0x020306, 1);
    node.appendChild(r.domElement);

    // The whole Moon: real size, NASA SVS CGI Moon Kit textures (LROC colour with LOLA-filled
    // poles, LOLA relief as bump), lit by the real Sun. Equirectangular textures put the north
    // pole on +Y and longitude 0 on +X; our frame has the south pole on +Y and longitude 0 on −Z,
    // hence Ry(90°)·Rx(180°).
    const moonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, bumpScale: 3 });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(R_KM - 0.6, lowEnd ? 128 : 256, lowEnd ? 64 : 128), moonMat);
    moon.position.set(0, -R_KM, 0);
    moon.quaternion.setFromEuler(new THREE.Euler(Math.PI, Math.PI / 2, 0, 'YXZ'));
    const loader = new THREE.TextureLoader(), media = `${import.meta.env.BASE_URL}media/moon/`;
    loader.load(media + 'lroc_color_poles_4k.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; moonMat.map = t; moonMat.needsUpdate = true; });
    loader.load(media + 'ldem_3_8bit.jpg', (t) => { moonMat.bumpMap = t; moonMat.needsUpdate = true; });
    this.moonCenter = new THREE.Vector3(0, -R_KM, 0);
    // A soft fill (context only) so the globe's curvature reads beyond the mapped cap.
    this.scene.add(moon, this.sunLight, new THREE.HemisphereLight(0x9aa6b8, 0x1a1a1a, 0.55));

    // The polar cap: the published hillshade on the curved surface (its relief shading is baked in).
    const tex = new THREE.Texture(texture);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    const [a, , c, , e, f] = basemap.affine, n = CAP_SEGMENTS + 1;
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = i / CAP_SEGMENTS, v = j / CAP_SEGMENTS;
      const mx = a * u * basemap.width_px + c, my = e * v * basemap.height_px + f;
      pos.set(mapToSphere(mx, my, 0.15), (j * n + i) * 3);
      uv.set([u, 1 - v], (j * n + i) * 2);
    }
    // keep the inscribed disc of the map (the corners have no hillshade)
    const rMax = (basemap.width_px * a) / 2 * 0.985, inside = (k: number) => Math.hypot(a * ((k % n) / CAP_SEGMENTS) * basemap.width_px + c, e * (Math.floor(k / n) / CAP_SEGMENTS) * basemap.height_px + f) <= rMax;
    for (let j = 0; j < CAP_SEGMENTS; j++) for (let i = 0; i < CAP_SEGMENTS; i++) {
      const k = j * n + i;
      if (inside(k) && inside(k + 1) && inside(k + n) && inside(k + n + 1)) idx.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
    }
    const cap = new THREE.BufferGeometry();
    cap.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    cap.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    cap.setIndex(idx);
    this.cap = new THREE.Mesh(cap, new THREE.MeshBasicMaterial({ map: tex, color: 0xe6e3dc }));
    this.scene.add(this.cap);

    // Site pins: a thin mast and a glowing head, coloured by group.
    for (const s of sites) {
      const m = latLonToMap(s.lat_deg, s.lon_deg), base = new THREE.Vector3(...mapToSphere(m.x, m.y, 0.2)), up = new THREE.Vector3(...upAt(m.x, m.y));
      const color = new THREE.Color(colorOf(s.group));
      const group = new THREE.Group();
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }));
      mast.position.y = 3;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshBasicMaterial({ color }));
      head.position.y = 6.2;
      const hit = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 5;
      hit.userData.id = s.id;
      group.add(mast, head, hit);
      group.position.copy(base);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      this.scene.add(group);
      this.pins.set(s.id, { group, head, hit, base });
    }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.1, 48), new THREE.MeshBasicMaterial({ color: 0xf4ce72, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.ring.visible = false;
    this.scene.add(this.ring, this.earth);

    // Globe navigation (Google-Earth-like): orbit the Moon's centre, zoom from the whole Moon to
    // ~20 km above the ground; the south pole starts facing the viewer.
    this.camera.position.copy(this.moonCenter).add(new THREE.Vector3(0, 0.78, 0.62).normalize().multiplyScalar(R_KM * 3.4));
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.07, minDistance: R_KM + 20, maxDistance: R_KM * 6, autoRotate: !this.reduced, autoRotateSpeed: 0.35, enablePan: false, zoomSpeed: 1.1 });
    this.controls.target.copy(this.moonCenter);

    this.resizeObs = new ResizeObserver(() => this.fit());
    this.resizeObs.observe(node);
    this.fit();
    this.disposeInput = this.attachPicking();
    const loop = () => { if (!document.hidden) this.draw(); this.frame = requestAnimationFrame(loop); };
    loop();
  }

  private fit() {
    const w = this.node.clientWidth || 1, h = this.node.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait phones: the site panel covers the lower half, so widen the view and draw the
    // globe's centre in the upper third (a taller virtual frame seen through an offset window).
    const portrait = w / h < 1;
    this.camera.fov = portrait ? 58 : 42;
    if (portrait) this.camera.setViewOffset(w, h * 1.6, 0, h * 0.5, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private pick(e: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const hits = this.raycaster.intersectObjects([...this.pins.values()].map((x) => x.hit));
    return hits.length ? (hits[0].object.userData.id as string) : null;
  }

  private attachPicking() {
    const el = this.renderer.domElement;
    let downAt = { x: 0, y: 0 };
    const down = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; this.controls.autoRotate = false; this.cancelIntro(); };
    const wheel = () => this.cancelIntro();
    const up = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return; // a drag, not a click
      const id = this.pick(e);
      if (id) this.onPick(id);
    };
    const move = (e: PointerEvent) => {
      const id = this.pick(e);
      el.style.cursor = id ? 'pointer' : 'grab';
      this.onHover(id, e.clientX, e.clientY);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointermove', move);
    el.addEventListener('wheel', wheel, { passive: true });
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointerup', up); el.removeEventListener('pointermove', move); el.removeEventListener('wheel', wheel); };
  }

  /** Real Sun and Earth directions (unit vectors in the polar frame). */
  setSky(sky: OrbitSky) {
    this.sunLight.position.set(...sky.sun).multiplyScalar(5000);
    this.earth.material.uniforms.sunDirection.value.set(...sky.sun);
    this.earth.position.set(...sky.earth).multiplyScalar(60000);
  }

  /** Highlight a site; with `fly`, glide the camera to look down on it from ~250 km. */
  select(id: string | null, fly = false) {
    for (const [k, p] of this.pins) p.head.scale.setScalar(k === id ? 1.9 : 1);
    const pin = id ? this.pins.get(id) : null;
    this.ring.visible = !!pin;
    if (pin) {
      this.ring.position.copy(pin.base).addScaledVector(pin.base.clone().add(new THREE.Vector3(0, R_KM, 0)).normalize(), 0.3);
      this.ring.quaternion.copy(pin.group.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
      if (fly) this.flyTo(pin.base, 260, 1600);
    }
  }

  /** Smoothly bring the camera above a surface point at `altKm`, looking at the Moon's centre. */
  flyTo(point: THREE.Vector3, altKm: number, ms = 1800) {
    const up = point.clone().sub(this.moonCenter).normalize();
    const tilt = new THREE.Vector3(0, 1, 0).cross(up).lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const to = this.moonCenter.clone().addScaledVector(up, R_KM + altKm).addScaledVector(tilt, altKm * 0.35);
    this.controls.autoRotate = false;
    if (this.reduced) { this.camera.position.copy(to); return; }
    this.fly = { t0: performance.now(), ms, from: this.camera.position.clone(), to, fromT: this.moonCenter.clone(), toT: this.moonCenter.clone(), done: () => { this.controls.enabled = true; } };
  }

  private introTimer = 0;
  /** Cinematic intro: the whole Moon first, then down to the south pole unless the user takes over. */
  playIntro(delayMs = 2200) { this.introTimer = window.setTimeout(() => this.zoomToPole(), delayMs); }
  private cancelIntro() { clearTimeout(this.introTimer); }

  /** Back to the whole Moon. */
  zoomOut() { this.flyTo(new THREE.Vector3(0, 0, 0), R_KM * 2.2, 1800); }

  /** Down to the south-polar cap with all the candidate sites. */
  zoomToPole() { this.flyTo(new THREE.Vector3(0, 0, 0), 520, 1800); }

  /** Screen position (px) of a site, for HTML labels; null when behind the camera. */
  screenOf(id: string): { x: number; y: number } | null {
    const pin = this.pins.get(id);
    if (!pin) return null;
    const v = pin.base.clone().add(new THREE.Vector3(0, 7, 0)).project(this.camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * this.node.clientWidth, y: ((1 - v.y) / 2) * this.node.clientHeight };
  }

  /** Cinematic dive from orbit to a few km above the site, then `done`. */
  descend(id: string, done: () => void) {
    const pin = this.pins.get(id);
    if (!pin) { done(); return; }
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    const up = pin.base.clone().add(new THREE.Vector3(0, R_KM, 0)).normalize();
    const side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(1, 0, 0)).normalize();
    const to = pin.base.clone().addScaledVector(up, 3).addScaledVector(side, 4);
    if (this.reduced) { this.camera.position.copy(to); this.camera.lookAt(pin.base); done(); return; }
    this.fly = { t0: performance.now(), ms: 2600, from: this.camera.position.clone(), to, fromT: this.controls.target.clone(), toT: pin.base.clone(), done };
  }

  private draw() {
    if (this.fly) {
      const f = this.fly, k = Math.min(1, (performance.now() - f.t0) / f.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(f.from, f.to, e);
      const target = f.fromT.clone().lerp(f.toT, e);
      this.camera.lookAt(target);
      if (k >= 1) { this.fly = null; f.done(); }
    } else {
      // slower spin close to the ground, like a map
      const alt = this.camera.position.distanceTo(this.moonCenter) - R_KM;
      this.controls.rotateSpeed = Math.min(1, Math.max(0.015, alt / R_KM));
      this.controls.update();
    }
    const nowFar = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0)) > 1600;
    if (nowFar !== this.far) { this.far = nowFar; this.onFar(nowFar); }
    for (const p of this.pins.values()) p.group.visible = !this.far;
    this.cap.visible = !this.far; // from afar the global mosaic covers the pole; up close the 80 m LOLA map takes over
    if (this.far) this.ring.visible = false;
    // pins keep a constant on-screen size whatever the zoom
    for (const p of this.pins.values()) p.group.scale.setScalar(Math.max(0.25, this.camera.position.distanceTo(p.base) / 110));
    if (this.ring.visible) {
      const pin = [...this.pins.values()].find((p) => p.head.scale.x > 1);
      const base = pin ? pin.group.scale.x : 1;
      this.ring.scale.setScalar(base * (this.reduced ? 1 : 1 + 0.25 * Math.sin(performance.now() / 300)));
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    clearTimeout(this.introTimer);
    cancelAnimationFrame(this.frame);
    this.disposeInput();
    this.resizeObs.disconnect();
    this.controls.dispose();
    disposeScene(this.scene);
    releaseRenderer(this.renderer);
  }
}

// Orbital view of the lunar south pole: the published LOLA hillshade (basemap.png) draped on
// the curved polar cap, the rest of the Moon lit by the real Sun direction, the Earth at its
// real direction with its phase, and a pin per candidate site. Units: km.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Basemap, SiteIndexEntry } from '../../lib/types';
import { disposeScene, phaseEarth, releaseRenderer } from '../../components/three/sceneTools';
import { latLonToMap, mapToSphere, R_KM, upAt } from '../sim/polar';
import { landerModel, type LanderModel } from './landerModel';

const CAP_SEGMENTS = 128;
const SHIP_ALT_KM = 22; // cruise altitude between stations
const SHIP_SCALE = 0.38; // metres → km × 380: the ship is drawn far larger than real so it reads from orbit
const PIN_ALT_KM = 0.2;
const smooth = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

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
  private fly: { t0: number; ms: number; from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; done: () => void; ship?: [THREE.Vector3, THREE.Vector3] } | null = null;
  // The player's ship hops between stations (the candidate sites) at cruise altitude.
  private ship: LanderModel;
  private shipPos = new THREE.Vector3();
  private shipUp = new THREE.Vector3(0, 1, 0);
  private shipFwd = new THREE.Vector3(0, 0, -1);
  private shipAt: string | null = null;
  private travel: { t0: number; ms: number; id: string; a: THREE.Vector3; b: THREE.Vector3; aFwd: THREE.Vector3; hump: number; bank: number; side: number } | null = null;
  private selected: string | null = null;
  private sunGlow: THREE.Sprite;
  private earthDir = new THREE.Vector3(0, 0.05, -1).normalize();
  /** The ship reached a station. */
  onArrive: (id: string) => void = () => {};
  /** True while the ship is flying between stations. */
  get traveling() { return !!this.travel; }
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
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.1, 48), new THREE.MeshBasicMaterial({ color: 0x4a9bff, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    this.ring.visible = false;
    this.scene.add(this.ring, this.earth);

    this.ship = landerModel();
    this.ship.glow.intensity = 0;
    this.ship.plume.visible = false;
    this.ship.group.scale.setScalar(SHIP_SCALE);
    this.ship.group.visible = false;
    this.scene.add(this.ship.group);

    // The Sun as seen from orbit: a glow at its real direction (the Earth mesh shows its real phase).
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const g = glowCanvas.getContext('2d')!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,248,230,1)'); grad.addColorStop(0.1, 'rgba(255,232,180,.65)'); grad.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const glow = Math.tan(4 * Math.PI / 180) * 50000 * 2;
    this.sunGlow.scale.set(glow, glow, 1);
    this.scene.add(this.sunGlow);

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
    // Portrait frames (phones: the site panel sits below the globe) need a wider view so the
    // whole Moon fits the narrow width.
    const portrait = w / h < 1;
    this.camera.fov = portrait ? 58 : 42;
    this.camera.clearViewOffset();
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
    this.earthDir.set(...sky.earth).normalize();
    this.sunGlow.position.set(...sky.sun).multiplyScalar(50000);
  }

  /** Where the ship parks over a station: position, local up and a heading that faces the Earth. */
  private station(id: string) {
    const pin = this.pins.get(id);
    if (!pin) return null;
    const up = pin.base.clone().sub(this.moonCenter).normalize();
    const pos = this.moonCenter.clone().addScaledVector(up, R_KM + PIN_ALT_KM + SHIP_ALT_KM);
    return { pos, up, fwd: this.facingEarth(up) };
  }

  private facingEarth(up: THREE.Vector3) {
    const f = this.earthDir.clone().addScaledVector(up, -this.earthDir.dot(up));
    return f.lengthSq() > 1e-8 ? f.normalize() : new THREE.Vector3(0, 0, -1).addScaledVector(up, -up.z).normalize();
  }

  /**
   * Chase camera looking at the ship (horizon and Earth ahead). `swing` turns the camera around
   * the ship (rad) and `pull` moves it out, for the cinematic part of a flight.
   */
  private chase(pos: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3, swing = 0, pull = 0) {
    const side = up.clone().cross(fwd).normalize();
    const back = fwd.clone().multiplyScalar(-Math.cos(swing)).addScaledVector(side, Math.sin(swing));
    const dist = 7 + pull * 30;
    return { cam: pos.clone().addScaledVector(back, dist).addScaledVector(up, 1.5 + pull * 9), look: pos.clone().addScaledVector(up, 0.3) };
  }

  /** Place the ship; `tilt` leans it forward (+) or back (−) and `roll` banks it (rad). */
  private placeShip(pos: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3, tilt = 0, roll = 0) {
    this.shipPos.copy(pos); this.shipUp.copy(up); this.shipFwd.copy(fwd);
    const back = fwd.clone().negate(), right = up.clone().cross(back).normalize();
    this.ship.group.position.copy(pos);
    this.ship.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));
    if (tilt || roll) this.ship.group.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, roll, 'XZY')));
  }

  private orbitAround(target: THREE.Vector3, min: number, max: number) {
    this.controls.target.copy(target);
    this.controls.minDistance = min;
    this.controls.maxDistance = max;
  }

  /**
   * Take the ship to station `id`: from far away the camera dives to it; from another station
   * the ship flies over the real Moon (rising mid-way) with the camera behind it.
   */
  goToStation(id: string) {
    const st = this.station(id);
    if (!st) return;
    this.select(id);
    this.cancelIntro();
    this.controls.autoRotate = false;
    if (this.travel) return;
    this.fly = null; // a new destination interrupts any camera glide
    if (!this.shipAt || this.far) {
      this.placeShip(st.pos, st.up, st.fwd);
      this.shipAt = id;
      const c = this.chase(st.pos, st.up, st.fwd);
      const arrive = () => { this.orbitAround(c.look, 2.5, 900); this.controls.enabled = true; this.onArrive(id); this.runAfterArrive(); };
      if (this.reduced) { this.camera.position.copy(c.cam); this.camera.lookAt(c.look); arrive(); return; }
      this.controls.enabled = false;
      this.fly = { t0: performance.now(), ms: 2600, from: this.camera.position.clone(), to: c.cam, fromT: this.controls.target.clone(), toT: c.look, done: arrive };
      return;
    }
    if (id === this.shipAt) {
      const c = this.chase(this.shipPos, this.shipUp, this.shipFwd);
      this.controls.enabled = false;
      this.fly = { t0: performance.now(), ms: 900, from: this.camera.position.clone(), to: c.cam, fromT: this.controls.target.clone(), toT: c.look, done: () => { this.orbitAround(c.look, 2.5, 900); this.controls.enabled = true; } };
      return;
    }
    const a = this.shipPos.clone().sub(this.moonCenter).normalize(), b = st.up;
    const distKm = a.angleTo(b) * R_KM;
    // bank into the turn: which side the destination lies on, seen from the current heading
    const toward = b.clone().addScaledVector(a, -b.dot(a)).normalize();
    const turn = Math.sign(this.shipFwd.clone().cross(toward).dot(a)) || 1;
    this.controls.enabled = false;
    this.ship.plume.visible = !this.reduced;
    this.travel = {
      t0: performance.now(), ms: this.reduced ? 1 : Math.min(8000, 3600 + distKm * 14), id, a, b, aFwd: this.shipFwd.clone(),
      // climb high enough to see the curve of the Moon on longer hops
      hump: Math.min(240, 40 + distKm * 0.9), bank: turn, side: turn,
    };
  }

  private stepTravel() {
    const tr = this.travel!, k = Math.min(1, (performance.now() - tr.t0) / tr.ms), e = ease(k);
    const th = tr.a.angleTo(tr.b), sin = Math.sin(th) || 1;
    const up = th < 1e-6 ? tr.b.clone() : tr.a.clone().multiplyScalar(Math.sin((1 - e) * th) / sin).addScaledVector(tr.b, Math.sin(e * th) / sin).normalize();
    const pos = this.moonCenter.clone().addScaledVector(up, R_KM + PIN_ALT_KM + SHIP_ALT_KM + tr.hump * Math.sin(Math.PI * e));
    const toward = tr.b.clone().addScaledVector(up, -tr.b.dot(up));
    const travelFwd = toward.lengthSq() > 1e-10 ? toward.normalize() : tr.aFwd.clone();
    // turn from the start heading into the flight, then towards the Earth on arrival
    const fwd = tr.aFwd.clone().lerp(travelFwd, smooth(0, 0.25, k)).lerp(this.facingEarth(up), smooth(0.7, 1, k)).normalize();
    const arc = Math.sin(Math.PI * k);
    // lean forward to accelerate, back to brake; bank through the turns
    const tilt = 0.38 * Math.cos(Math.PI * k) * smooth(0, 0.08, k) * (1 - smooth(0.92, 1, k));
    const roll = tr.bank * 0.45 * (smooth(0, 0.2, k) - smooth(0.15, 0.4, k) + 0.6 * (smooth(0.65, 0.8, k) - smooth(0.8, 1, k)));
    this.placeShip(pos, up, fwd, tilt, roll);
    const thr = 0.35 + 0.65 * Math.abs(Math.cos(Math.PI * k));
    this.ship.plume.scale.set(0.6 + thr * 0.5, 1 + thr * 6, 0.6 + thr * 0.5);
    this.ship.plume.position.y = 0.75 - (1 + thr * 6) / 2;
    // cinematic camera: swings to the side and pulls out mid-flight, then back behind the ship
    const c = this.chase(pos, up, fwd, tr.side * 1.25 * arc * arc, arc);
    this.camera.position.copy(c.cam);
    this.camera.lookAt(c.look);
    if (k >= 1) {
      this.travel = null;
      this.ship.plume.visible = false;
      this.shipAt = tr.id;
      this.orbitAround(c.look, 2.5, 900);
      this.controls.enabled = true;
      this.onArrive(tr.id); this.runAfterArrive();
    }
  }

  /** Highlight a site; with `fly`, glide the camera to look down on it from ~250 km. */
  select(id: string | null, fly = false) {
    this.selected = id;
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
    this.travel = null;
    const done = () => { this.orbitAround(this.moonCenter, R_KM + 20, R_KM * 6); this.controls.enabled = true; };
    if (this.reduced) { this.camera.position.copy(to); done(); return; }
    this.controls.enabled = false;
    this.fly = { t0: performance.now(), ms, from: this.camera.position.clone(), to, fromT: this.controls.target.clone(), toT: this.moonCenter.clone(), done };
  }

  private introTimer = 0;
  /** Cinematic intro: the whole Moon first, then down to the selected station unless the user takes over. */
  playIntro(delayMs = 2200) { this.introTimer = window.setTimeout(() => { if (this.selected) this.goToStation(this.selected); else this.zoomToPole(); }, delayMs); }
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

  private afterArrive: (() => void) | null = null;
  private runAfterArrive() { const next = this.afterArrive; this.afterArrive = null; next?.(); }

  /** Cinematic dive from orbit to a few km above the site, then `done`. */
  descend(id: string, done: () => void) {
    // From the whole-Moon view a straight dive would pass through the Moon (black screen):
    // first fly the ship to the station, then dive from there.
    if (this.far || !this.shipAt || this.travel) {
      if (!this.pins.get(id)) { done(); return; }
      this.afterArrive = () => this.descend(id, done);
      if (!this.travel) this.goToStation(id);
      return;
    }
    const pin = this.pins.get(id);
    if (!pin) { done(); return; }
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    const up = pin.base.clone().add(new THREE.Vector3(0, R_KM, 0)).normalize();
    const side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(1, 0, 0)).normalize();
    const to = pin.base.clone().addScaledVector(up, 3).addScaledVector(side, 4);
    this.travel = null;
    if (this.reduced) { this.camera.position.copy(to); this.camera.lookAt(pin.base); done(); return; }
    // the ship goes down ahead of the camera
    const shipTo = pin.base.clone().addScaledVector(up, 0.4);
    if (this.ship.group.visible) { this.ship.plume.visible = true; this.ship.plume.scale.set(1, 6, 1); this.ship.plume.position.y = 0.75 - 3; }
    this.fly = { t0: performance.now(), ms: 2600, from: this.camera.position.clone(), to, fromT: this.controls.target.clone(), toT: pin.base.clone(), done, ship: [this.shipPos.clone(), shipTo] };
  }

  private draw() {
    if (this.travel) {
      this.stepTravel();
    } else if (this.fly) {
      const f = this.fly, k = Math.min(1, (performance.now() - f.t0) / f.ms);
      const e = ease(k);
      this.camera.position.lerpVectors(f.from, f.to, e);
      const target = f.fromT.clone().lerp(f.toT, e);
      this.camera.lookAt(target);
      if (f.ship) this.ship.group.position.lerpVectors(f.ship[0], f.ship[1], e);
      if (k >= 1) { this.fly = null; f.done(); }
    } else {
      // slower spin close to the ground, like a map
      const alt = this.camera.position.distanceTo(this.moonCenter) - R_KM;
      const aroundShip = this.controls.target.distanceTo(this.moonCenter) > 1;
      this.controls.rotateSpeed = aroundShip ? 0.6 : Math.min(1, Math.max(0.015, alt / R_KM));
      this.controls.update();
    }
    const nowFar = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0)) > 1600;
    if (nowFar !== this.far) { this.far = nowFar; this.onFar(nowFar); }
    for (const p of this.pins.values()) p.group.visible = !this.far;
    this.cap.visible = !this.far; // from afar the global mosaic covers the pole; up close the 80 m LOLA map takes over
    this.ship.group.visible = !!this.shipAt && !this.far;
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

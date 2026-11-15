// three.js view of the surface mission: real terrain, real Sun/Earth directions with cast
// shadows, the rover, its tracks and a navigation beacon. Simulation lives in game/sim.
import * as THREE from 'three';
import { azElToThree, type TerrainData } from '../../lib/terrain';
import { marker, phaseEarth, releaseRenderer, disposeScene } from '../../components/three/sceneTools';
import { type Field, heightAt, normalAt } from '../sim/field';
import type { World } from '../sim/world';
import { gridGeometry } from './terrainMesh';
import { roverModel } from './roverModel';
import { landerModel } from './landerModel';
import type { LanderState } from '../sim/lander';
import { overlayUniform, SunlitBake, sunlitMaterial } from './sunlitTerrain';
import type { Horizon } from '../sim/visibility';

export type CameraMode = 'chase' | 'mast' | 'top';
const SKY_R = 150000;
const MAX_TRACK = 20000;

/** ENU (east, north, up) to three.js (x = east, y = up, z = south). */
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

export class SurfaceScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sun = new THREE.DirectionalLight(0xffffff, 5.5);
  private earthLight = new THREE.DirectionalLight(0xa8bcff, 0.05);
  private sunDisk = marker(0.267, 0xffffff, SKY_R);
  private sunGlow: THREE.Sprite;
  private earthDisk = phaseEarth(SKY_R);
  private sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_R * 1.2, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
  private rover = roverModel();
  private lander = landerModel();
  private dust: THREE.Points;
  private track: THREE.Line;
  private trackN = 0;
  private lastTrack = new THREE.Vector3(Infinity, 0, 0);
  private beacon = new THREE.Group();
  private resize: ResizeObserver;
  private lastShadowKey = '';
  private wheelAngle = 0;
  private firstBake = true;
  // camera orbit around the rover (user controlled)
  mode: CameraMode = 'chase';
  yaw = 0; // deg relative to the rover heading
  pitch = 18; // deg above the horizontal
  dist = 14; // m
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private disposeInput: () => void;

  private node: HTMLElement;
  private field: Field;
  private bake: SunlitBake;
  private annual!: THREE.BufferAttribute;
  private nearPositions!: ArrayLike<number>;

  constructor(node: HTMLElement, field: Field, horizon: Horizon, data: TerrainData, lowEnd: boolean) {
    this.node = node;
    this.field = field;
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.35;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1.5 : 2));
    r.shadowMap.enabled = true;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    node.appendChild(r.domElement);
    r.domElement.tabIndex = 0;

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.2, SKY_R * 1.5);
    const extent = field.near.half;
    // Near terrain: lit by the baked physics (sunlitTerrain.ts). Far ring: plain Lambert, context only.
    const nearGeo = gridGeometry(data.meta.near, data.near, lowEnd ? 512 : 1024);
    this.bake = new SunlitBake(field, horizon, nearGeo.getAttribute('position').array, lowEnd ? 128 : 192);
    nearGeo.setAttribute('sunlit', this.bake.attr);
    this.annual = new THREE.BufferAttribute(new Float32Array(nearGeo.getAttribute('position').count), 1);
    nearGeo.setAttribute('annual', this.annual);
    this.nearPositions = nearGeo.getAttribute('position').array;
    overlayUniform.value = 0;
    const near = new THREE.Mesh(nearGeo, sunlitMaterial(0xaaa59d));
    near.receiveShadow = true; // only the rover casts into the shadow map
    const far = new THREE.Mesh(gridGeometry(data.meta.far, data.far, data.meta.far.n, extent), new THREE.MeshStandardMaterial({ color: 0x9a958e, roughness: 1 }));
    this.scene.add(near, far);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 29800, far: 30200 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    // Faint fill so the player can still see the rover in shadow (game readability, not physics).
    const fill = new THREE.AmbientLight(0x8090b0, 0.03);
    this.scene.add(this.sun, this.sun.target, this.earthLight, this.earthLight.target, fill, this.sky, this.sunDisk, this.earthDisk);

    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const g = glowCanvas.getContext('2d')!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,244,214,1)'); grad.addColorStop(0.12, 'rgba(255,226,160,.5)'); grad.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const glowSize = Math.tan(3 * Math.PI / 180) * SKY_R * 2;
    this.sunGlow.scale.set(glowSize, glowSize, 1);
    this.scene.add(this.sunGlow);

    this.scene.add(this.rover.group);
    this.lander.group.visible = false;
    this.scene.add(this.lander.group);
    // Dust kicked up by the engine near the ground (a disc of points pushed outward).
    const n = 240, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 14; pos.set([Math.cos(a) * r, Math.random() * 1.5, Math.sin(a) * r], i * 3); }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xcfc6b6, size: 0.35, transparent: true, opacity: 0, depthWrite: false }));
    this.scene.add(this.dust);
    const trackGeo = new THREE.BufferGeometry();
    trackGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRACK * 3), 3));
    trackGeo.setDrawRange(0, 0);
    this.track = new THREE.Line(trackGeo, new THREE.LineBasicMaterial({ color: 0x6b6458 }));
    this.scene.add(this.track);

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 400, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 200;
    const ring = new THREE.Mesh(new THREE.RingGeometry(6, 9, 40), new THREE.MeshBasicMaterial({ color: 0x4fd1ff, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.3;
    this.beacon.add(beam, ring);
    this.beacon.visible = false;
    this.scene.add(this.beacon);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(node);
    this.fit();
    this.disposeInput = this.attachCameraInput();
  }

  private fit() {
    const w = this.node.clientWidth || 1, h = this.node.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Drag to orbit the camera around the rover, wheel or pinch to zoom. */
  private attachCameraInput() {
    const el = this.renderer.domElement;
    let id: number | null = null, px = 0, py = 0;
    const down = (e: PointerEvent) => { id = e.pointerId; px = e.clientX; py = e.clientY; el.setPointerCapture(id); };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      this.yaw -= (e.clientX - px) * 0.3;
      this.pitch = Math.max(-5, Math.min(85, this.pitch + (e.clientY - py) * 0.25));
      px = e.clientX; py = e.clientY;
    };
    const up = () => { id = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.dist = Math.max(4, Math.min(400, this.dist * Math.exp(e.deltaY * 0.001))); };
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }

  /** Visible solar-disk fraction of the terrain at (x, y) from the last finished bake. */
  sunlitAt(x: number, y: number): number { return this.bake.sample(x, y); }
  get bakeVersion(): number { return this.bake.version; }

  /** Heat-map overlay of a yearly quantity (0..1) sampled at (x, y); null hides it. */
  setOverlay(sample: ((x: number, y: number) => number) | null) {
    if (sample) {
      const a = this.annual.array as Float32Array, p = this.nearPositions;
      for (let v = 0; v < a.length; v++) { const s = sample(p[v * 3], -p[v * 3 + 2]); a[v] = Number.isFinite(s) ? s : 0; }
      this.annual.needsUpdate = true;
    }
    overlayUniform.value = sample ? 1 : 0;
  }

  setBeacon(target: { x: number; y: number } | null) {
    this.beacon.visible = !!target;
    if (target) this.beacon.position.copy(v3(target.x, target.y, heightAt(this.field, target.x, target.y)));
  }

  /**
   * Draw one frame for the world state `w`; `dt` = wall-clock seconds since the last frame.
   * With `lander` in flight the camera follows the lander and the rover stays aboard (hidden);
   * after touchdown the lander stays where it landed.
   */
  render(w: World, dt: number, lander: LanderState | null = null, flying = false) {
    const { rover, sky } = w;
    const ground = heightAt(this.field, rover.x, rover.y);
    const roverPos = v3(rover.x, rover.y, ground);
    this.rover.group.visible = !flying;
    if (lander) {
      this.lander.group.visible = true;
      this.lander.group.position.copy(v3(lander.x, lander.y, lander.z));
      const thr = flying ? lander.throttle : 0;
      this.lander.plume.visible = thr > 0.02;
      this.lander.plume.scale.set(0.6 + thr * 0.6, 1 + thr * 9, 0.6 + thr * 0.6);
      this.lander.plume.position.y = 0.75 - (1 + thr * 9) / 2;
      this.lander.glow.intensity = thr * 60;
      const alt = lander.z - heightAt(this.field, lander.x, lander.y);
      const dustOn = flying && thr > 0.05 && alt < 40;
      const dm = this.dust.material as THREE.PointsMaterial;
      dm.opacity += ((dustOn ? Math.min(0.7, thr * (1 - alt / 40)) : 0) - dm.opacity) * Math.min(1, dt * 4);
      this.dust.position.copy(v3(lander.x, lander.y, heightAt(this.field, lander.x, lander.y)));
      this.dust.rotation.y += dt * (0.6 + thr * 2);
      this.dust.scale.setScalar(1 + thr * 0.6);
    } else {
      this.lander.group.visible = false;
    }
    const pos = flying && lander ? v3(lander.x, lander.y, lander.z) : roverPos;

    // Rover pose: up = terrain normal, forward = heading projected on the slope.
    const [nx, ny, nz] = normalAt(this.field, rover.x, rover.y);
    const up = v3(nx, ny, nz).normalize();
    const h = rover.heading * Math.PI / 180;
    const fwd = v3(Math.sin(h), Math.cos(h), 0);
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const back = fwd.clone().negate(), right = up.clone().cross(back).normalize();
    this.rover.group.matrixAutoUpdate = true;
    this.rover.group.position.copy(roverPos);
    this.rover.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));
    this.wheelAngle -= (rover.speed * dt * w.warp) / 0.32;
    for (const wh of this.rover.wheels) wh.rotation.x = this.wheelAngle;
    this.rover.panel.rotation.y = -(sky.sunAz - rover.heading) * Math.PI / 180 + Math.PI; // face the Sun
    this.rover.dish.rotation.y = -(sky.earthAz - rover.heading) * Math.PI / 180 + Math.PI;
    this.rover.headlight.intensity = w.sunFrac > 0.5 ? 0 : 6;

    if (!flying && pos.distanceTo(this.lastTrack) > 1.5 && this.trackN < MAX_TRACK) {
      const arr = this.track.geometry.getAttribute('position') as THREE.BufferAttribute;
      arr.setXYZ(this.trackN++, pos.x, pos.y + 0.05, pos.z);
      arr.needsUpdate = true;
      this.track.geometry.setDrawRange(0, this.trackN);
      this.track.geometry.computeBoundingSphere();
      this.lastTrack.copy(pos);
    }

    // Sun and Earth at their real directions; the shadow box follows the rover.
    const sunDir = new THREE.Vector3(...azElToThree(sky.sunAz, sky.sunEl));
    const earthDir = new THREE.Vector3(...azElToThree(sky.earthAz, sky.earthEl));
    this.sun.position.copy(pos).addScaledVector(sunDir, 30000);
    this.sun.target.position.copy(pos);
    this.earthLight.position.copy(pos).addScaledVector(earthDir, 30000);
    this.earthLight.target.position.copy(pos);
    this.earthDisk.material.uniforms.sunDirection.value.copy(sunDir);
    if (this.firstBake) { this.bake.bakeNow(sky.sunAz, sky.sunEl); this.firstBake = false; }
    else { this.bake.request(sky.sunAz, sky.sunEl); this.bake.work(5); }
    const shadowKey = `${Math.round(sky.sunAz * 50)},${Math.round(sky.sunEl * 50)},${Math.round(rover.x * 3)},${Math.round(rover.y * 3)},${Math.round(rover.heading)}`;
    if (shadowKey !== this.lastShadowKey) { this.renderer.shadowMap.needsUpdate = true; this.lastShadowKey = shadowKey; }

    // Camera.
    const k = 1 - Math.exp(-dt * 6);
    let wantPos: THREE.Vector3, wantTarget: THREE.Vector3;
    if (flying) {
      // descent chase: behind and above the lander, farther away the higher it is
      const a = (180 + this.yaw) * Math.PI / 180, p = Math.max(8, this.pitch) * Math.PI / 180;
      const alt = lander ? lander.z - heightAt(this.field, lander.x, lander.y) : 0;
      const dist = Math.max(this.dist * 2.5, 30 + Math.min(alt, 600) * 0.12);
      wantPos = pos.clone().add(v3(Math.sin(a) * Math.cos(p) * dist, Math.cos(a) * Math.cos(p) * dist, Math.sin(p) * dist + 4));
      wantTarget = pos.clone().add(new THREE.Vector3(0, -2, 0));
    } else if (this.mode === 'mast') {
      wantPos = pos.clone().addScaledVector(up, 2.05).addScaledVector(fwd, -0.65);
      const a = (rover.heading + this.yaw) * Math.PI / 180, p = (this.pitch - 18) * 0.5 * Math.PI / 180;
      wantTarget = wantPos.clone().add(v3(Math.sin(a) * Math.cos(p), Math.cos(a) * Math.cos(p), Math.sin(p)).multiplyScalar(50));
    } else {
      const a = (rover.heading + 180 + this.yaw) * Math.PI / 180;
      const pitch = this.mode === 'top' ? 80 : this.pitch, dist = this.mode === 'top' ? Math.max(this.dist, 120) : this.dist;
      const p = pitch * Math.PI / 180;
      wantPos = pos.clone().add(v3(Math.sin(a) * Math.cos(p) * dist, Math.cos(a) * Math.cos(p) * dist, Math.sin(p) * dist + 1.5));
      // never below the terrain
      const below = heightAt(this.field, wantPos.x, -wantPos.z);
      if (Number.isFinite(below) && wantPos.y < below + 1.5) wantPos.y = below + 1.5;
      wantTarget = pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    }
    if (this.mode === 'mast') { this.camPos.copy(wantPos); this.camTarget.copy(wantTarget); }
    else { this.camPos.lerp(wantPos, this.camPos.lengthSq() ? k : 1); this.camTarget.lerp(wantTarget, this.camTarget.lengthSq() ? k : 1); }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);

    this.sky.position.copy(this.camera.position);
    this.sunDisk.position.copy(this.camera.position).addScaledVector(sunDir, SKY_R);
    this.sunGlow.position.copy(this.sunDisk.position);
    this.earthDisk.position.copy(this.camera.position).addScaledVector(earthDir, SKY_R);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposeInput();
    this.resize.disconnect();
    disposeScene(this.scene);
    (this.sunGlow.material.map as THREE.Texture | null)?.dispose();
    this.sunGlow.material.dispose();
    releaseRenderer(this.renderer);
  }
}

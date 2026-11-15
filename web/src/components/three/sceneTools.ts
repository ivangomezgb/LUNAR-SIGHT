import * as THREE from 'three';
import { azElToThree } from '../../lib/terrain';
import type { Trail } from '../../lib/terrain';
import { t } from '../../i18n';

/** Geometric phase from the real solar direction; uniform albedo, no invented geography. */
export function phaseEarth(distance: number) {
  return new THREE.Mesh(new THREE.SphereGeometry(Math.tan(.95 * Math.PI / 180) * distance, 48, 32), new THREE.ShaderMaterial({
    uniforms: { sunDirection: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 n; void main(){n=mat3(modelMatrix)*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 n; uniform vec3 sunDirection; void main(){float light=max(0.,dot(normalize(n),sunDirection));gl_FragColor=vec4(vec3(.24,.32,.42)*light + vec3(.0004,.0005,.0006),1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`,
  }));
}
export function attachLook(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, report: (s: string) => void, initialAz = 0) {
  let az = initialAz, el = -2, pointer: number | null = null, x = 0, y = 0;
  const update = () => { camera.lookAt(camera.position.clone().add(new THREE.Vector3(...azElToThree(az, el)))); report(t(['N', 'E', 'S', 'W'][Math.round(az / 90) % 4]) + ' / ' + t('Azimuth {0}° · Elevation {1}°', { 0: az.toFixed(1), 1: el.toFixed(1) })); };
  const down = (e: PointerEvent) => { pointer = e.pointerId; x = e.clientX; y = e.clientY; canvas.setPointerCapture(pointer); };
  const move = (e: PointerEvent) => { if (e.pointerId !== pointer) return; az = (az - (e.clientX - x) * .15 + 360) % 360; el = THREE.MathUtils.clamp(el + (e.clientY - y) * .15, -89, 89); x = e.clientX; y = e.clientY; update(); };
  const up = () => { pointer = null; };
  const key = (e: KeyboardEvent) => { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); az = (az + (e.key === 'ArrowRight' ? 2 : e.key === 'ArrowLeft' ? -2 : 0) + 360) % 360; el = THREE.MathUtils.clamp(el + (e.key === 'ArrowUp' ? 2 : e.key === 'ArrowDown' ? -2 : 0), -89, 89); update(); };
  canvas.setAttribute('aria-label', t('Drag or use arrow keys to look')); canvas.tabIndex = 0; canvas.style.touchAction = 'none'; canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('keydown', key); update();
  return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('keydown', key); };
}
export function marker(radiusDeg: number, color: number, distance: number) {
  return new THREE.Mesh(new THREE.SphereGeometry(Math.tan(radiusDeg * Math.PI / 180) * distance, 24, 16), new THREE.MeshBasicMaterial({ color }));
}
/** Free the GPU context now instead of waiting for garbage collection (browsers cap live contexts). */
export function releaseRenderer(renderer: THREE.WebGLRenderer) {
  renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
}
export function disposeScene(scene: THREE.Scene) {
  scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points || o instanceof THREE.Sprite) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { (m as THREE.SpriteMaterial).map?.dispose(); m.dispose(); } } if (o instanceof THREE.DirectionalLight) o.shadow.dispose(); });
}

const dim = (c: THREE.Color) => c.clone().multiplyScalar(0.28);

/**
 * Segments of a real az/el trajectory on a sphere of `radius`. Elevations are multiplied by
 * `elScale` (1 = true angles); hours below the 2 m horizon mask are drawn dim.
 */
export function trailLine(trail: Trail, radius: number, color: number, opts: { elScale?: number; dashed?: boolean; depthTest?: boolean } = {}) {
  const { elScale = 1, dashed = false, depthTest = true } = opts;
  const n = trail.az.length, pos: number[] = [], col: number[] = [];
  const bright = new THREE.Color(color), faint = dim(bright);
  for (let i = 0; i + 1 < n; i++) {
    const c = trail.visible[i] && trail.visible[i + 1] ? bright : faint;
    for (const k of [i, i + 1]) {
      const [x, y, z] = azElToThree(trail.az[k], THREE.MathUtils.clamp(trail.el[k] * elScale, -89, 89));
      pos.push(x * radius, y * radius, z * radius); col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const material = dashed
    ? new THREE.LineDashedMaterial({ vertexColors: true, dashSize: radius * 0.02, gapSize: radius * 0.014, depthTest, transparent: true })
    : new THREE.LineBasicMaterial({ vertexColors: true, depthTest, transparent: true });
  const line = new THREE.LineSegments(g, material);
  if (dashed) line.computeLineDistances();
  line.renderOrder = depthTest ? 0 : 10;
  const marks = new THREE.Points(new THREE.BufferGeometry().setFromPoints(trail.dayMarks.filter(i => i < n).map(i =>
    new THREE.Vector3(...azElToThree(trail.az[i], THREE.MathUtils.clamp(trail.el[i] * elScale, -89, 89))).multiplyScalar(radius))),
    new THREE.PointsMaterial({ color, size: 5, sizeAttenuation: false, depthTest, transparent: true }));
  marks.renderOrder = line.renderOrder;
  const group = new THREE.Group(); group.add(line, marks); return group;
}

/** Flat text label that always faces the camera. */
export function textSprite(text: string, color = '#e8eef5', px = 48) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  ctx.font = `600 ${px}px Inter, system-ui, sans-serif`;
  canvas.width = Math.ceil(ctx.measureText(text).width) + 16; canvas.height = px + 16;
  ctx.font = `600 ${px}px Inter, system-ui, sans-serif`; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 8, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.userData.aspect = canvas.width / canvas.height; sprite.renderOrder = 11; return sprite;
}

/** Sky-direction dome over the site: azimuth ring with ticks and elevation circles (scaled). */
export function skyDome(radius: number, elScale: number, elevations = [0, 5]) {
  const group = new THREE.Group(), lineMat = (opacity: number) => new THREE.LineBasicMaterial({ color: 0x9fb3c8, transparent: true, opacity, depthTest: false });
  const circle = (el: number) => new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 145 }, (_, i) =>
    new THREE.Vector3(...azElToThree(i * 2.5, el * elScale)).multiplyScalar(radius))), lineMat(el === 0 ? 0.55 : 0.22));
  for (const el of elevations) {
    const c = circle(el); c.renderOrder = 9; group.add(c);
    if (el) { const s = textSprite(`+${el}°`, '#9fb3c8', 40); s.position.set(...azElToThree(45, el * elScale)).multiplyScalar(radius); s.scale.set(radius * 0.05 * s.userData.aspect, radius * 0.05, 1); group.add(s); }
  }
  const ticks: THREE.Vector3[] = [];
  for (let az = 0; az < 360; az += 30) {
    const d = new THREE.Vector3(...azElToThree(az, 0));
    ticks.push(d.clone().multiplyScalar(radius * 0.97), d.clone().multiplyScalar(radius * (az % 90 ? 1.02 : 1.05)));
  }
  const tickLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), lineMat(0.6)); tickLines.renderOrder = 9; group.add(tickLines);
  for (const [label, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
    const s = textSprite(t(label), '#ffffff', 56); s.position.set(...azElToThree(az, 0)).multiplyScalar(radius * 1.11);
    s.scale.set(radius * 0.07 * s.userData.aspect, radius * 0.07, 1); group.add(s);
  }
  return group;
}

/** Thin line from the site to a point on the dome. */
export function ray(color: number) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }));
  line.renderOrder = 10; return line;
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse(c => {
    if (c instanceof THREE.Mesh || c instanceof THREE.Line || c instanceof THREE.Points || c instanceof THREE.Sprite) {
      c.geometry.dispose();
      for (const m of Array.isArray(c.material) ? c.material : [c.material]) { (m as THREE.SpriteMaterial).map?.dispose(); m.dispose(); }
    }
  });
}

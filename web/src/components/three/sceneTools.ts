import * as THREE from 'three';
import { azElToThree } from '../../lib/terrain';
import { t } from '../../i18n';

/** Geometric phase from the real solar direction; uniform albedo, no invented geography. */
export function phaseEarth(distance: number) {
  return new THREE.Mesh(new THREE.SphereGeometry(Math.tan(.95 * Math.PI / 180) * distance, 48, 32), new THREE.ShaderMaterial({
    uniforms: { sunDirection: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 n; void main(){n=mat3(modelMatrix)*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 n; uniform vec3 sunDirection; void main(){float light=max(0.,dot(normalize(n),sunDirection));gl_FragColor=vec4(vec3(.30,.52,.75)*light,1.);
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
  scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); } if (o instanceof THREE.DirectionalLight) o.shadow.dispose(); });
}

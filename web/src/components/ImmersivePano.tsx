import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { attachLook, disposeObject, disposeScene, marker, phaseEarth, releaseRenderer, trailLine } from './three/sceneTools';
import { azElToThree, loadPano, viewerError } from '../lib/terrain';
import type { Trail, ViewProps } from '../lib/terrain';
import { t } from '../i18n';
import { lunarPhotometry, LUNAR_EXPOSURE, SUN_INTENSITY, EARTH_INTENSITY } from './three/lunarMaterial';
export default function ImmersivePano(props: ViewProps) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const [status, setStatus] = useState<{ key: string; n?: number } | null>({ key: 'Loading panorama… {0}%', n: 0 }), [failed, setFailed] = useState(false), [compass, setCompass] = useState('');
  useEffect(() => {
    const started = performance.now();
    if (host.current) delete host.current.dataset.firstFrameMs;
    const node = host.current!, abort = new AbortController(); let cleanup = () => {};
    setStatus({ key: 'Loading panorama… {0}%', n: 0 }); setFailed(false);
    loadPano(props.siteId, n => setStatus({ key: 'Loading panorama… {0}%', n }), abort.signal).then(data => {
      if (abort.signal.aborted) return;
      const created: THREE.WebGLRenderer[] = [];
      try {
      const lowEnd = matchMedia('(max-width: 699px)').matches || navigator.hardwareConcurrency <= 4;
      const renderer = new THREE.WebGLRenderer({antialias: !lowEnd}); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = LUNAR_EXPOSURE; renderer.outputColorSpace = THREE.SRGBColorSpace; created.push(renderer); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); node.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, .01, 200); const m = data.meta;
      // 8-bit RGBA (normal * 0.5 + 0.5): float32 textures cannot be linearly filtered on many phones.
      const pixels = new Uint8Array(m.width * m.height * 4);
      for (let i = 0; i < data.distances.length; i++) { for (let k = 0; k < 3; k++) pixels[i * 4 + k] = Math.round((data.normals[i * 3 + k] * .5 + .5) * 255); pixels[i * 4 + 3] = data.distances[i] ? 255 : 0; }
      const texture = new THREE.DataTexture(pixels, m.width, m.height, THREE.RGBAFormat, THREE.UnsignedByteType); texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
      const material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          terrain: { value: texture }, sun: { value: new THREE.Vector3() },
          earthDirection: { value: new THREE.Vector3() }, top: { value: m.el_top_deg },
          bottom: { value: m.el_bottom_deg }, az0: { value: m.az0_deg ?? 0 },
        },
        vertexShader: `varying vec3 ray;
          void main() { ray = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
        fragmentShader: `
          ${lunarPhotometry}
          varying vec3 ray;
          uniform sampler2D terrain;
          uniform vec3 sun, earthDirection;
          uniform float top, bottom, az0;
          void main() {
            vec3 d = normalize(ray);
            float el = degrees(asin(d.y));
            float az = degrees(atan(d.x, -d.z));
            vec2 uv = vec2(fract((az - az0) / 360.), (top - el) / (top - bottom));
            if (el > top || el < bottom) discard;
            vec4 n = texture2D(terrain, uv);
            if (n.a < .5) discard;
            vec3 normal = normalize(n.xyz * 2. - 1.);
            // Three's east/up/south ray -> ENU surface-to-observer vector.
            vec3 viewDir = vec3(-d.x, d.z, -d.y);
            float light = ${SUN_INTENSITY.toFixed(3)} * lunarResponse(normal, sun, viewDir)
              + ${EARTH_INTENSITY.toFixed(3)} * lunarResponse(normal, earthDirection, viewDir);
            gl_FragColor = vec4(vec3(.12) * light, 1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), material));
      const sun = marker(.267, 0xffffff, 110), earth = phaseEarth(110); scene.add(sun, earth);
      const points = props.horizon.map((h, i) => new THREE.Vector3(...azElToThree(i * props.horizonStep, h / 100)).multiplyScalar(89)); if (points.length) points.push(points[0].clone());
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({color: 0xffbe55})));
      const trails = new THREE.Group(); scene.add(trails); let lastTrails: [Trail | undefined, Trail | undefined] = [undefined, undefined];
      const rebuild = (p: ViewProps) => { for (const c of [...trails.children]) { disposeObject(c); trails.remove(c); } if (p.sunTrail) trails.add(trailLine(p.sunTrail, 88, 0xf5c451)); if (p.earthTrail) trails.add(trailLine(p.earthTrail, 88, 0x6fa8ff, { dashed: true })); lastTrails = [p.sunTrail, p.earthTrail]; };
      rebuild(latest.current);
      const unlook = attachLook(renderer.domElement, camera, setCompass, latest.current.sunAz), resize = new ResizeObserver(() => { renderer.setSize(node.clientWidth, node.clientHeight); camera.aspect = node.clientWidth / node.clientHeight; camera.updateProjectionMatrix(); }); resize.observe(node);renderer.setSize(node.clientWidth,node.clientHeight);camera.aspect=node.clientWidth/node.clientHeight;camera.updateProjectionMatrix();
      let frame = 0, lastView = ''; const draw = () => { const p = latest.current; if (p.sunTrail !== lastTrails[0] || p.earthTrail !== lastTrails[1]) { rebuild(p); lastView = ''; } const dir = azElToThree(p.sunAz, p.sunEl); material.uniforms.sun.value.set(dir[0], -dir[2], dir[1]); sun.position.set(...dir).multiplyScalar(110); const earthDir=azElToThree(p.earthAz,p.earthEl); earth.position.set(...earthDir).multiplyScalar(110); earth.material.uniforms.sunDirection.value.set(...dir); material.uniforms.earthDirection.value.set(earthDir[0],-earthDir[2],earthDir[1]);
 const viewKey = camera.quaternion.toArray().join(',') + camera.aspect + ',' + node.clientWidth + ',' + node.clientHeight + dir.join(',') + earthDir.join(',') + p.sunTrail?.az.length;
 if (viewKey !== lastView) { renderer.render(scene,camera); lastView = viewKey; }
 if (!node.dataset.firstFrameMs) node.dataset.firstFrameMs = (performance.now() - started).toFixed(0);
 frame=requestAnimationFrame(draw); }; draw(); setStatus(null);
      cleanup = () => { cancelAnimationFrame(frame); unlook(); resize.disconnect(); texture.dispose(); disposeScene(scene); releaseRenderer(renderer); };
      } catch (error) { created.forEach(releaseRenderer); throw error; }
    }).catch((error: unknown) => { if (!abort.signal.aborted) { setFailed(true); setStatus({ key: viewerError(error) }); } });
    return () => {abort.abort(); cleanup();};
  }, [props.siteId, props.horizon, props.horizonStep]);
  return <section className="expedition-renderer">
    <div ref={host} className="expedition-canvas" aria-label={t('Immersive lunar panorama')} />
    <div className="expedition-camera"><div className="expedition-cta"><span className="expedition-mode-title">{t('Astronaut view · exact horizon (±0.2°)')}</span><button type="button" onClick={() => props.onMode?.('overview')}>↑ {t('Back to 3D overview')}</button></div><p>{compass}<br />{t('Drag or use arrow keys to look')}<br />{t('Orange: real 2 m horizon · gold/blue: Sun and Earth paths, dim when hidden · approximate shading, no cast shadows')}</p></div>
    {/* Translated at render time so switching EN/ES updates an open viewer. */}
    {status && <div className="expedition-loading" role="status">{t(status.key, { 0: status.n ?? 0 })}{!failed && <progress max={100} value={status.n ?? 0} />}</div>}
  </section>;
}

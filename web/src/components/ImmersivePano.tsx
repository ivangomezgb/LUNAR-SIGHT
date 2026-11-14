import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { attachLook, disposeScene, marker, phaseEarth } from './three/sceneTools';
import { azElToThree, loadPano, MISSING_3D } from '../lib/terrain';
import type { ViewProps } from '../lib/terrain';
import { t } from '../i18n';
export default function ImmersivePano(props: ViewProps) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const [status, setStatus] = useState(t('Loading panorama… {0}%', { 0: 0 })), [compass, setCompass] = useState('');
  useEffect(() => {
    const node = host.current!, abort = new AbortController(); let cleanup = () => {};
    setStatus(t('Loading panorama… {0}%', { 0: 0 }));
    loadPano(props.siteId, n => setStatus(t('Loading panorama… {0}%', { 0: n })), abort.signal).then(data => {
      if (abort.signal.aborted) return;
      const renderer = new THREE.WebGLRenderer({antialias: true}); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); node.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, .01, 200); const m = data.meta;
      const pixels = new Float32Array(m.width * m.height * 4);
      for (let i = 0; i < data.distances.length; i++) { pixels.set(data.normals.subarray(i * 3, i * 3 + 3), i * 4); pixels[i * 4 + 3] = data.distances[i] ? 1 : 0; }
      const texture = new THREE.DataTexture(pixels, m.width, m.height, THREE.RGBAFormat, THREE.FloatType); texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
      const material = new THREE.ShaderMaterial({side: THREE.BackSide, uniforms: { terrain: {value: texture}, sun: {value: new THREE.Vector3()}, earthDirection: {value: new THREE.Vector3()}, top: {value: m.el_top_deg}, bottom: {value: m.el_bottom_deg}, az0: {value: m.az0_deg ?? 0}}, vertexShader: `varying vec3 ray; void main(){ray=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`, fragmentShader: `precision highp float; varying vec3 ray; uniform sampler2D terrain; uniform vec3 sun,earthDirection; uniform float top,bottom,az0; void main(){vec3 d=normalize(ray); float el=degrees(asin(d.y)); float az=degrees(atan(d.x,-d.z)); vec2 uv=vec2(fract((az-az0)/360.),(top-el)/(top-bottom)); if(el>top||el<bottom){discard;} vec4 n=texture2D(terrain,uv); if(n.a<.5){discard;} vec3 normal=normalize(n.xyz); float light=max(0.,dot(normal,sun))+.008*max(0.,dot(normal,earthDirection)); gl_FragColor=vec4(pow(vec3(.58,.56,.53)*light,vec3(1./2.2)),1.);}` });
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), material));
      const sun = marker(.267, 0xffffff, 110), earth = phaseEarth(110); scene.add(sun, earth);
      const points = props.horizon.map((h, i) => new THREE.Vector3(...azElToThree(i * props.horizonStep, h / 100)).multiplyScalar(89)); if (points.length) points.push(points[0].clone());
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({color: 0xffbe55})));
      const unlook = attachLook(renderer.domElement, camera, setCompass, latest.current.sunAz), resize = new ResizeObserver(() => { renderer.setSize(node.clientWidth, node.clientHeight); camera.aspect = node.clientWidth / node.clientHeight; camera.updateProjectionMatrix(); }); resize.observe(node);renderer.setSize(node.clientWidth,node.clientHeight);camera.aspect=node.clientWidth/node.clientHeight;camera.updateProjectionMatrix();
      let frame = 0; const draw = () => { const p = latest.current; const dir = azElToThree(p.sunAz, p.sunEl); material.uniforms.sun.value.set(dir[0], -dir[2], dir[1]); sun.position.set(...dir).multiplyScalar(110); const earthDir=azElToThree(p.earthAz,p.earthEl); earth.position.set(...earthDir).multiplyScalar(110); earth.material.uniforms.sunDirection.value.set(...dir); material.uniforms.earthDirection.value.set(earthDir[0],-earthDir[2],earthDir[1]);
 renderer.render(scene,camera); frame=requestAnimationFrame(draw); }; draw(); setStatus('');
      cleanup = () => { cancelAnimationFrame(frame); unlook(); resize.disconnect(); texture.dispose(); disposeScene(scene); renderer.dispose(); renderer.domElement.remove(); };
    }).catch(() => {if(!abort.signal.aborted) setStatus(t(MISSING_3D));});
    return () => {abort.abort(); cleanup();};
  }, [props.siteId, props.horizon, props.horizonStep]);
  return <section className="expedition-renderer">
    <div ref={host} className="expedition-canvas" aria-label={t('Immersive lunar panorama')} />
    <div className="expedition-camera"><p>{compass}<br />{t('Drag or use arrow keys to look')}<br />{t('Orange: real 2 m horizon · Approximate shading, no cast shadows')}</p></div>
    {status && <div className="expedition-loading" role="status">{status}{status !== t(MISSING_3D) && <progress max={100} value={Number(status.match(/(\d+)%/)?.[1] ?? 0)} />}</div>}
  </section>;
}

// Procedural lander (no external assets): gold-foil body, four legs with pads, engine bell,
// a plume whose length follows the throttle, and a light that washes the ground below.
import * as THREE from 'three';

export interface LanderModel {
  group: THREE.Group;
  plume: THREE.Mesh;
  glow: THREE.PointLight;
}

export function landerModel(): LanderModel {
  const group = new THREE.Group();
  const foil = new THREE.MeshStandardMaterial({ color: 0xd4a23a, roughness: 0.32, metalness: 0.85 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.6, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7, metalness: 0.4 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 1.6, 8), foil);
  body.position.y = 2.4;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 0.5, 8), white);
  deck.position.y = 3.45;
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), white);
  tank.position.set(0, 3.9, 0);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), white);
  antenna.position.set(0.8, 4.4, 0.3);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 0.9, 16, 1, true), dark);
  bell.position.y = 1.2;
  group.add(body, deck, tank, antenna, bell);

  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4, dx = Math.cos(a), dz = Math.sin(a);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.9, 6), white);
    leg.position.set(dx * 2.0, 1.3, dz * 2.0);
    leg.lookAt(dx * 3.2, 0, dz * 3.2);
    leg.rotateX(Math.PI / 2);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.08, 12), white);
    pad.position.set(dx * 2.75, 0.04, dz * 2.75);
    group.add(leg, pad);
  }

  // Plume: additive cone; scaled by throttle every frame.
  const plume = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  plume.rotation.x = Math.PI; // tip pointing down
  plume.position.y = 0.75;
  group.add(plume);
  const glow = new THREE.PointLight(0xffc27a, 0, 120, 1.6);
  glow.position.y = 0.2;
  group.add(glow);

  group.traverse((o) => { if (o instanceof THREE.Mesh && o !== plume) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, plume, glow };
}

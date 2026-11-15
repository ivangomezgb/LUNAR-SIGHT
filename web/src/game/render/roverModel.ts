// Procedural low-poly rover (no external assets). Faces -Z (three.js forward), origin at the
// ground contact point. Six wheels, a body, a vertical Sun-tracking panel and a mast antenna.
import * as THREE from 'three';

export interface RoverModel {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  panel: THREE.Object3D;
  dish: THREE.Object3D;
  headlight: THREE.SpotLight;
}

export function roverModel(): RoverModel {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.55, metalness: 0.35 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9962c, roughness: 0.35, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 });
  const cells = new THREE.MeshStandardMaterial({ color: 0x1b2d5c, roughness: 0.25, metalness: 0.6, emissive: 0x050b1c });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 1.9), gold);
  body.position.y = 0.75;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 2.0), metal);
  deck.position.y = 1.01;
  group.add(body, deck);

  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const z of [-0.75, 0, 0.75]) for (const x of [-0.85, 0.85]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.32, z);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), metal);
    strut.position.set(x * 0.88, 0.6, z);
    group.add(w, strut);
    wheels.push(w);
  }

  // Vertical panel on a turntable: it yaws to face the Sun (like VIPER's vertical arrays).
  const panel = new THREE.Group();
  panel.position.set(0, 1.05, 0.35);
  const mastP = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), metal);
  mastP.position.y = 0.25;
  const array = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.04), cells);
  array.position.y = 0.95;
  panel.add(mastP, array);
  group.add(panel);

  // Mast with camera head and a dish that points at the Earth.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8), metal);
  mast.position.set(0.45, 1.5, -0.65);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.2), metal);
  head.position.set(0.45, 2.02, -0.65);
  const dish = new THREE.Group();
  dish.position.set(-0.45, 1.35, -0.6);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), metal);
  bowl.rotation.x = -Math.PI / 2;
  dish.add(bowl);
  group.add(mast, head, dish);

  const headlight = new THREE.SpotLight(0xfff1d6, 6, 60, Math.PI / 6, 0.5, 1.2);
  headlight.position.set(0, 1.2, -1.0);
  headlight.target.position.set(0, 0, -12);
  group.add(headlight, headlight.target);

  group.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, wheels, panel, dish, headlight };
}

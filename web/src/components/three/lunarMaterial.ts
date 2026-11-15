import * as THREE from 'three';

// A visual approximation, NOT a fitted Hapke model or a radiometric product.
// Lommel-Seeliger single scattering reduces Lambert's excessive limb darkening.
// A small Lambert component regularizes grazing angles; a broad backscatter lobe
// and mild opposition term describe particulate regolith without inventing relief.
// Both renderers use linear 0.12 grey, identical illumination and fixed exposure.
export const LUNAR_EXPOSURE = 1.25;
export const SUN_INTENSITY = 3;
export const EARTH_INTENSITY = .002;
export const lunarPhotometry = /* glsl */ `
float lunarResponse(vec3 n, vec3 l, vec3 v) {
  float mu0 = max(dot(n, l), 0.0);
  float mu = max(dot(n, v), 0.0);
  float phaseCos = clamp(dot(l, v), -1.0, 1.0);
  float opposition = 1.0 + 0.12 * exp(-acos(phaseCos) / 0.07);
  float backscatter = 0.85 + 0.15 * phaseCos;
  return (0.85 * mu0 / max(mu0 + mu, 0.001) + 0.15 * mu0)
    * backscatter * opposition / 3.14159265359;
}
`;

export function lunarMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.12, .12, .12), roughness: 1 });
  material.onBeforeCompile = shader => {
    // Keep Three's directLight.color, including its real shadow-map visibility.
    // No metallic/specular lobe, ambient floor, slope-based albedo or fake detail.
    const lighting = THREE.ShaderChunk.lights_physical_pars_fragment
      .replace('reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );', '')
      .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        'reflectedLight.directDiffuse += directLight.color * material.diffuseColor * lunarResponse(geometryNormal, directLight.direction, geometryViewDir);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', lunarPhotometry + lighting);
  };
  material.customProgramCacheKey = () => 'lunar-lommel-seeliger-v1';
  return material;
}

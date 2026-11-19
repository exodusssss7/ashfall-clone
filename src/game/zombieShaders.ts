import * as THREE from 'three';
import { ZOMBIE_VISUAL_PRESETS } from './zombieVisuals';
import type { ZombieArchetype } from './types';

/**
 * Surface role controls how strongly procedural wetness, veins, blister
 * swelling, and vertex skin deformation affect each zombie sub-mesh:
 *  -  0.0: Exposed infected skin (head, neck, jaw, torso wounds, forearms)
 *  -  0.35: Tattered damp clothing / leather / boots / hair / bone (ZERO glowing veins)
 *  -  1.0: Animated skin blister / pustule / venom sac (dark necrotic base -> taut glowing apex)
 *  - -1.0: Glossy wet eyes / mouth cavity / gums / saliva strand
 */
export type ZombieSurfaceRole = 0.0 | 0.35 | 1.0 | -1.0;

export interface ZombieRigSharedUniforms {
  uZTime: { value: number };
  uZSeed: { value: number };
  uZDetail: { value: number };
  uZDeformAmp: { value: number };
  uZLunge: { value: number };
  uZWalkPhase: { value: number };
  uZBreathAmp: { value: number };
  uZWetness: { value: number };
  uZVeinColor: { value: THREE.Color };
  uZVeinPulseSpeed: { value: number };
  uZVeinIntensity: { value: number };
  uZBlisterColor: { value: THREE.Color };
  uZBlisterAmp: { value: number };
  uZBlisterSpeed: { value: number };
  uZBlisterWobble: { value: number };
}

export function createZombieRigSharedUniforms(archetype: ZombieArchetype): ZombieRigSharedUniforms {
  const preset = ZOMBIE_VISUAL_PRESETS[archetype];
  return {
    uZTime: { value: 0 },
    uZSeed: { value: 1 },
    uZDetail: { value: 1 },
    uZDeformAmp: { value: preset.fleshDeformAmp },
    uZLunge: { value: 0 },
    uZWalkPhase: { value: 0 },
    uZBreathAmp: { value: preset.breathAmp },
    uZWetness: { value: preset.wetness },
    uZVeinColor: { value: new THREE.Color(preset.veinColorHex) },
    uZVeinPulseSpeed: { value: preset.veinPulseSpeed },
    uZVeinIntensity: { value: preset.veinIntensity },
    uZBlisterColor: { value: new THREE.Color(preset.blisterGlowHex) },
    uZBlisterAmp: { value: preset.blisterAmp },
    uZBlisterSpeed: { value: preset.blisterPulseSpeed },
    uZBlisterWobble: { value: preset.blisterWobbleAmp },
  };
}

const ZOMBIE_GLSL_COMMON = /* glsl */ `
float zmbHash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float zmbNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = zmbHash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = zmbHash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = zmbHash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = zmbHash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = zmbHash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = zmbHash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = zmbHash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = zmbHash31(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

float zmbVeinRidge(vec3 p) {
  float n1 = zmbNoise3(p);
  float n2 = zmbNoise3(p * 2.25 + vec3(4.2, 1.7, 8.9));
  float r1 = 1.0 - abs(n1 * 2.0 - 1.0);
  float r2 = 1.0 - abs(n2 * 2.0 - 1.0);
  return pow(max(r1 * 0.72 + r2 * 0.34, 0.0), 11.0);
}

vec3 zmbSmoothGrad3(vec3 p) {
  const float e = 0.06;
  float c = zmbNoise3(p);
  return vec3(
    zmbNoise3(p + vec3(e, 0.0, 0.0)) - c,
    zmbNoise3(p + vec3(0.0, e, 0.0)) - c,
    zmbNoise3(p + vec3(0.0, 0.0, e)) - c
  ) / e;
}
`;

export function createZombieInfectedMaterial(opts: {
  archetype: ZombieArchetype;
  role: ZombieSurfaceRole;
  shared: ZombieRigSharedUniforms;
  color?: number | string;
  map?: THREE.Texture | null;
  emissive?: number | string;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
}): THREE.MeshPhysicalMaterial {
  const preset = ZOMBIE_VISUAL_PRESETS[opts.archetype];
  const isCloth = opts.role > 0.2 && opts.role < 0.6;
  const isBlister = opts.role > 0.75;
  const isMouth = opts.role < -0.5;

  // Deliberate PBR material contrast (>= 0.25 roughness spread across cloth, flesh, bone, boils, wet eyes)
  const mat = new THREE.MeshPhysicalMaterial({
    color: opts.map ? 0xffffff : (opts.color ?? 0xffffff),
    map: opts.map ?? null,
    roughness:
      opts.roughness ??
      (isMouth ? 0.14 : isBlister ? 0.22 : isCloth ? 0.88 : Math.max(0.50, preset.roughnessBase + 0.08)),
    metalness: opts.metalness ?? (isCloth ? 0.03 : 0.02),
    clearcoat: isMouth ? 0.90 : isBlister ? 0.78 : isCloth ? 0.02 : preset.clearcoat * 0.28,
    clearcoatRoughness: isMouth ? 0.10 : isBlister ? 0.16 : isCloth ? 0.78 : Math.max(0.32, preset.clearcoatRoughness * 2.1),
    ior: isMouth || isBlister ? 1.40 : 1.33,
    specularIntensity: isCloth ? 0.18 : isBlister || isMouth ? 0.78 : 0.44,
    envMapIntensity: isMouth || isBlister ? 0.36 : isCloth ? 0.18 : 0.24,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    vertexColors: opts.vertexColors ?? false,
  });

  const roleUniform = { value: opts.role };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uZTime = opts.shared.uZTime;
    shader.uniforms.uZSeed = opts.shared.uZSeed;
    shader.uniforms.uZDetail = opts.shared.uZDetail;
    shader.uniforms.uZDeformAmp = opts.shared.uZDeformAmp;
    shader.uniforms.uZLunge = opts.shared.uZLunge;
    shader.uniforms.uZWalkPhase = opts.shared.uZWalkPhase;
    shader.uniforms.uZBreathAmp = opts.shared.uZBreathAmp;
    shader.uniforms.uZWetness = opts.shared.uZWetness;
    shader.uniforms.uZVeinColor = opts.shared.uZVeinColor;
    shader.uniforms.uZVeinPulseSpeed = opts.shared.uZVeinPulseSpeed;
    shader.uniforms.uZVeinIntensity = opts.shared.uZVeinIntensity;
    shader.uniforms.uZBlisterColor = opts.shared.uZBlisterColor;
    shader.uniforms.uZBlisterAmp = opts.shared.uZBlisterAmp;
    shader.uniforms.uZBlisterSpeed = opts.shared.uZBlisterSpeed;
    shader.uniforms.uZBlisterWobble = opts.shared.uZBlisterWobble;
    shader.uniforms.uZRole = roleUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uZTime;
        uniform float uZSeed;
        uniform float uZDetail;
        uniform float uZDeformAmp;
        uniform float uZLunge;
        uniform float uZWalkPhase;
        uniform float uZBreathAmp;
        uniform float uZBlisterAmp;
        uniform float uZBlisterSpeed;
        uniform float uZBlisterWobble;
        uniform float uZRole;
        varying vec3 vZLocalPos;
        varying vec3 vZLocalNorm;
        varying float vZSwell;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vZLocalPos = position;
        vZLocalNorm = normal;
        vZSwell = 0.0;

        if (uZDetail > 0.05) {
          float seedOff = uZSeed * 1.731;
          if (uZRole > 0.75) {
            // Animated blister / venom sac: base stays anchored in flesh while apex pulses organically
            float apexMask = clamp((position.y + 0.03) / 0.065, 0.15, 1.0);
            float bPhase = uZTime * uZBlisterSpeed + seedOff + dot(position, vec3(21.0, 29.0, 17.0));
            float swellWave = sin(bPhase) * 0.72 + sin(bPhase * 2.07 + 0.9) * 0.28;
            float swell = swellWave * uZBlisterAmp * 0.72 * apexMask * (0.45 + 0.55 * uZDetail);
            vZSwell = clamp((swellWave + 1.0) * 0.5, 0.0, 1.0) * apexMask;
            transformed += normal * (length(position) * swell);
            float wobT = uZTime * uZBlisterSpeed * 1.45 + seedOff;
            transformed.x += sin(wobT + position.y * 24.0) * 0.011 * uZBlisterWobble * apexMask * uZDetail;
            transformed.z += cos(wobT * 0.89 + position.x * 22.0) * 0.011 * uZBlisterWobble * apexMask * uZDetail;
          } else if (uZRole > -0.5) {
            // Subtle living-corpse breathing & flesh tremor (gentle enough to never break eye/joint alignment)
            float detailMask = smoothstep(0.05, 0.55, uZDetail);
            float breath = sin(uZTime * 2.7 + seedOff) * uZBreathAmp * 0.45 * detailMask;
            float fleshWave = sin(uZTime * 7.2 + position.y * 12.0 + position.x * 8.5 + uZWalkPhase * 2.0 + seedOff);
            float clothDamp = (uZRole > 0.2 && uZRole < 0.6) ? 0.28 : 0.48;
            float attackTense = max(0.0, uZLunge) * 0.004 * clothDamp * detailMask;
            transformed += normal * ((breath + fleshWave * uZDeformAmp * 0.5) * clothDamp * detailMask + attackTense);
          }
        }`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uZTime;
        uniform float uZSeed;
        uniform float uZDetail;
        uniform float uZWetness;
        uniform vec3 uZVeinColor;
        uniform float uZVeinPulseSpeed;
        uniform float uZVeinIntensity;
        uniform vec3 uZBlisterColor;
        uniform float uZRole;
        varying vec3 vZLocalPos;
        varying vec3 vZLocalNorm;
        varying float vZSwell;
        ${ZOMBIE_GLSL_COMMON}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float zVeinPulseOut = 0.0;
        float zWetFilmOut = 0.0;
        vec3 zWetGrad = vec3(0.0);
        if (uZDetail > 0.08) {
          vec3 sampleP = vZLocalPos * 7.6 + vec3(uZSeed * 1.37, 0.0, uZSeed * 0.71);
          vec3 flowPos = sampleP * 1.05 + vec3(0.0, uZTime * 0.16, 0.0);
          float wetFlow = zmbNoise3(flowPos);
          float wetFine = uZDetail > 0.62 ? zmbNoise3(sampleP * 2.2 - vec3(0.0, uZTime * 0.24, 0.0)) : 0.5;
          zWetFilmOut = clamp(smoothstep(0.42, 0.84, wetFlow * 0.7 + wetFine * 0.3) * uZWetness, 0.0, 1.0);
          if (uZDetail > 0.62 && uZRole > -0.8) {
            zWetGrad = zmbSmoothGrad3(flowPos);
          }

          if (uZRole > 0.75) {
            // Necrotic boil: dark inflamed rim near flesh anchor, taut glowing fluid dome at apex
            float apexTone = smoothstep(0.05, 0.85, vZSwell);
            float rimShade = mix(0.56, 1.05, apexTone);
            diffuseColor.rgb = mix(diffuseColor.rgb * rimShade, uZBlisterColor, apexTone * 0.34 * uZDetail);
            zWetFilmOut = max(zWetFilmOut, 0.88);
          } else if (uZRole < -0.5) {
            // Wet eyes / oral mucosa: crisp wet highlight without distorting painted iris/pupil
            zWetFilmOut = 0.95;
          } else if (uZRole > 0.2 && uZRole < 0.6) {
            // Tattered cloth, leather, boots, bone: subtle damp grime mottling ONLY (ZERO glowing veins!)
            float grimeShift = (wetFlow - 0.5) * 0.10;
            diffuseColor.rgb *= (1.0 + grimeShift * uZDetail) * mix(1.0, 0.88, zWetFilmOut * 0.35);
            zVeinPulseOut = 0.0;
          } else {
            // Exposed rotting flesh: clammy tissue sheen + subtle dark sub-dermal veins (never neon graffiti)
            float rotShift = (wetFlow - 0.5) * 0.10;
            diffuseColor.rgb *= (1.0 + rotShift * uZDetail) * mix(1.0, 0.82, zWetFilmOut * 0.58);
            float veinMask = zmbVeinRidge(sampleP * 1.55);
            float pulseWave = 0.25 + 0.75 * (0.5 + 0.5 * sin(uZTime * uZVeinPulseSpeed - vZLocalPos.y * 8.0 + uZSeed * 2.1));
            zVeinPulseOut = veinMask * pulseWave * uZDetail;
            diffuseColor.rgb = mix(diffuseColor.rgb, uZVeinColor * 0.24, clamp(veinMask * 0.56 * uZDetail, 0.0, 0.56));
          }
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (uZDetail > 0.08) {
          float targetWetRough = (uZRole > 0.75 || uZRole < -0.5) ? 0.14 : (uZRole > 0.2 && uZRole < 0.6) ? 0.72 : 0.30;
          roughnessFactor = mix(roughnessFactor, targetWetRough, zWetFilmOut * (0.45 + 0.35 * uZDetail));
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (uZDetail > 0.62 && uZRole > -0.8) {
          vec3 surfGrad = zWetGrad - normal * dot(zWetGrad, normal);
          float bumpAmp = (uZRole > 0.75 ? 0.20 : (uZRole > 0.2 && uZRole < 0.6) ? 0.07 : 0.13) * uZWetness * smoothstep(0.62, 1.0, uZDetail);
          normal = normalize(normal - surfGrad * bumpAmp);
        }`
      )
      .replace(
        '#include <clearcoat_normal_fragment_maps>',
        `#include <clearcoat_normal_fragment_maps>
        #ifdef USE_CLEARCOAT
        if (uZDetail > 0.62) {
          clearcoatNormal = normalize(mix(clearcoatNormal, normal, 0.42));
        }
        #endif`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (uZDetail > 0.08) {
          // Subtle sub-dermal vein glow on exposed infected flesh only
          totalEmissiveRadiance += uZVeinColor * (zVeinPulseOut * uZVeinIntensity * 0.24);
          if (uZRole > 0.75) {
            totalEmissiveRadiance += uZBlisterColor * (vZSwell * 0.28 * uZDetail);
          }
        }`
      );
  };

  mat.customProgramCacheKey = () => 'ashfall_zombie_infected_pbr_v4';
  return mat;
}

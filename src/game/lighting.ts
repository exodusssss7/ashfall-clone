import * as THREE from 'three';
import { clamp } from './isometric';
import { getDaylightInfo } from './survivalLogic';

export interface AtmosphereLightingState {
  phaseLabel: 'DAWN' | 'DAYLIGHT' | 'DUSK' | 'NIGHTFALL';
  darkness: number;
  nightT: number;
  dawnT: number;
  duskT: number;
  fogDensityScale: number;
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  sunLightOffset: THREE.Vector3;
  rimLightOffset: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  rimColor: THREE.Color;
  rimIntensity: number;
  hemiSkyColor: THREE.Color;
  hemiGroundColor: THREE.Color;
  hemiIntensity: number;
  isoFogColor: THREE.Color;
  fpsFogColor: THREE.Color;
  skyZenith: THREE.Color;
  skyMid: THREE.Color;
  skyHorizon: THREE.Color;
  cloudTop: THREE.Color;
  cloudBottom: THREE.Color;
}

const ISO_DAY = new THREE.Color('#1a2024');
const ISO_DAWN = new THREE.Color('#251e2b');
const ISO_DUSK = new THREE.Color('#1d1924');
const ISO_NIGHT = new THREE.Color('#090d16');

const FPS_DAY = new THREE.Color('#6f838b');
const FPS_DAWN = new THREE.Color('#be8a7b');
const FPS_DUSK = new THREE.Color('#915c49');
const FPS_NIGHT = new THREE.Color('#0c1321');

const SUN_DAY = new THREE.Color('#fff2d9');
const SUN_DAWN = new THREE.Color('#ffb775');
const SUN_DUSK = new THREE.Color('#ff9d5c');
const SUN_NIGHT = new THREE.Color('#6c8ec4');

const RIM_DAY = new THREE.Color('#9ec0db');
const RIM_DAWN = new THREE.Color('#80a4e8');
const RIM_DUSK = new THREE.Color('#7a6db5');
const RIM_NIGHT = new THREE.Color('#344d7d');

const HEMI_SKY_DAY = new THREE.Color('#9ec0db');
const HEMI_SKY_DAWN = new THREE.Color('#849ed1');
const HEMI_SKY_DUSK = new THREE.Color('#8d6d8c');
const HEMI_SKY_NIGHT = new THREE.Color('#1c2a4a');

const HEMI_GND_DAY = new THREE.Color('#3b3328');
const HEMI_GND_DAWN = new THREE.Color('#5e4238');
const HEMI_GND_DUSK = new THREE.Color('#4a2f2a');
const HEMI_GND_NIGHT = new THREE.Color('#0c1018');

const ZENITH_DAY = new THREE.Color('#3a6ea5');
const ZENITH_DAWN = new THREE.Color('#3b558f');
const ZENITH_DUSK = new THREE.Color('#3b325c');
const ZENITH_NIGHT = new THREE.Color('#070c1a');

const MID_DAY = new THREE.Color('#6f9ec4');
const MID_DAWN = new THREE.Color('#a482a3');
const MID_DUSK = new THREE.Color('#8e5c62');
const MID_NIGHT = new THREE.Color('#0d1629');

const HORIZ_DAY = new THREE.Color('#b6cad4');
const HORIZ_DAWN = new THREE.Color('#f4b482');
const HORIZ_DUSK = new THREE.Color('#d97d4f');
const HORIZ_NIGHT = new THREE.Color('#142038');

const CLOUD_DAY_TOP = new THREE.Color('#f5f7f5');
const CLOUD_DAWN_TOP = new THREE.Color('#ffe4bf');
const CLOUD_DUSK_TOP = new THREE.Color('#f2aa7e');
const CLOUD_NIGHT_TOP = new THREE.Color('#273552');

const CLOUD_DAY_BOT = new THREE.Color('#bccad4');
const CLOUD_DAWN_BOT = new THREE.Color('#937d99');
const CLOUD_DUSK_BOT = new THREE.Color('#875b6b');
const CLOUD_NIGHT_BOT = new THREE.Color('#161f33');

export function createAtmosphereLightingState(): AtmosphereLightingState {
  return {
    phaseLabel: 'DAYLIGHT',
    darkness: 0.08,
    nightT: 0,
    dawnT: 0,
    duskT: 0,
    fogDensityScale: 1,
    sunDir: new THREE.Vector3(0.4, 0.7, -0.5).normalize(),
    moonDir: new THREE.Vector3(-0.4, 0.4, 0.5).normalize(),
    sunLightOffset: new THREE.Vector3(-16, 26, -12),
    rimLightOffset: new THREE.Vector3(16, 14, 12),
    sunColor: SUN_DAY.clone(),
    sunIntensity: 1.65,
    rimColor: RIM_DAY.clone(),
    rimIntensity: 0.22,
    hemiSkyColor: HEMI_SKY_DAY.clone(),
    hemiGroundColor: HEMI_GND_DAY.clone(),
    hemiIntensity: 0.85,
    isoFogColor: ISO_DAY.clone(),
    fpsFogColor: FPS_DAY.clone(),
    skyZenith: ZENITH_DAY.clone(),
    skyMid: MID_DAY.clone(),
    skyHorizon: HORIZ_DAY.clone(),
    cloudTop: CLOUD_DAY_TOP.clone(),
    cloudBottom: CLOUD_DAY_BOT.clone(),
  };
}

/**
 * Computes synchronized sky, fog, sun directional key, hemisphere fill, and cool rim bounce lighting
 * across DAWN (05:30–07:30), DAYLIGHT (07:30–18:00), DUSK (18:00–20:00), and NIGHTFALL.
 * Mutates `out` in-place for zero per-frame garbage collection.
 */
export function computeAtmosphereLighting(
  timeMinutes: number,
  out: AtmosphereLightingState
): AtmosphereLightingState {
  const mins = ((timeMinutes % 1440) + 1440) % 1440;
  const { darkness, phaseLabel } = getDaylightInfo(mins);
  const nightT = clamp((darkness - 0.08) / 0.7, 0, 1);

  const dawnProgress = phaseLabel === 'DAWN' ? clamp((mins - 330) / 120, 0, 1) : 0;
  const duskProgress = phaseLabel === 'DUSK' ? clamp((mins - 1080) / 120, 0, 1) : 0;
  const dawnT = phaseLabel === 'DAWN' ? Math.sin(dawnProgress * Math.PI) : 0;
  const duskT = phaseLabel === 'DUSK' ? Math.sin(duskProgress * Math.PI) : 0;

  out.phaseLabel = phaseLabel;
  out.darkness = darkness;
  out.nightT = nightT;
  out.dawnT = dawnT;
  out.duskT = duskT;

  // Sunrise (05:30 / 330m) to Sunset (19:30 / 1170m) -> 840m solar arc across East (-X,-Z) -> Noon -> West (+X,+Z)
  const dayArc = clamp((mins - 330) / 840, -0.25, 1.25) * Math.PI;
  const sunElev = Math.sin(dayArc);
  const sunAz = Math.cos(dayArc);
  out.sunDir.set(-sunAz * 0.82, Math.max(-0.18, sunElev * 0.86), -0.42 - (1 - sunAz) * 0.14).normalize();
  out.moonDir.set(sunAz * 0.72, clamp(-sunElev * 0.65 + 0.34, 0.05, 0.88), 0.48).normalize();

  // Keep directional light elevation safe for tight ISO/FPS shadow projection while elongating dawn/dusk shadows
  const activeKeyDir = nightT > 0.72 ? out.moonDir : out.sunDir;
  const clampedElev = Math.max(0.38, Math.abs(activeKeyDir.y));
  const horizLen = Math.max(0.001, Math.hypot(activeKeyDir.x, activeKeyDir.z));
  const horizTarget = Math.sqrt(Math.max(0.05, 1 - clampedElev * clampedElev));
  out.sunLightOffset.set(
    (activeKeyDir.x / horizLen) * horizTarget * 30,
    clampedElev * 30,
    (activeKeyDir.z / horizLen) * horizTarget * 30
  );
  out.rimLightOffset.set(-out.sunLightOffset.x * 0.85, 14, -out.sunLightOffset.z * 0.85);

  // Dawn morning mist thickens fog gently near sunrise, clearing as daylight takes hold
  out.fogDensityScale = 1 + dawnT * 0.34 + duskT * 0.18;

  // Fog & background colors
  out.isoFogColor.copy(ISO_DAY).lerp(ISO_NIGHT, nightT);
  out.fpsFogColor.copy(FPS_DAY).lerp(FPS_NIGHT, nightT);
  if (dawnT > 0) {
    out.isoFogColor.lerp(ISO_DAWN, dawnT * 0.92);
    out.fpsFogColor.lerp(FPS_DAWN, dawnT * 0.92);
  } else if (duskT > 0) {
    out.isoFogColor.lerp(ISO_DUSK, duskT * 0.92);
    out.fpsFogColor.lerp(FPS_DUSK, duskT * 0.92);
  }

  // Sun / Moon key light
  out.sunColor.copy(SUN_DAY).lerp(SUN_NIGHT, nightT);
  if (dawnT > 0) {
    out.sunColor.lerp(SUN_DAWN, dawnT * 0.88);
  } else if (duskT > 0) {
    out.sunColor.lerp(SUN_DUSK, duskT * 0.88);
  }
  out.sunIntensity = 1.65 * (1 - nightT * 0.78) + dawnT * 0.28 + duskT * 0.14;

  // Hemisphere sky/ground bounce
  out.hemiSkyColor.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, nightT);
  out.hemiGroundColor.copy(HEMI_GND_DAY).lerp(HEMI_GND_NIGHT, nightT);
  if (dawnT > 0) {
    out.hemiSkyColor.lerp(HEMI_SKY_DAWN, dawnT * 0.85);
    out.hemiGroundColor.lerp(HEMI_GND_DAWN, dawnT * 0.85);
  } else if (duskT > 0) {
    out.hemiSkyColor.lerp(HEMI_SKY_DUSK, duskT * 0.85);
    out.hemiGroundColor.lerp(HEMI_GND_DUSK, duskT * 0.85);
  }
  out.hemiIntensity = 0.85 * (1 - nightT * 0.62) + dawnT * 0.14;

  // Cool opposite rim light separates silhouettes and highlights metallic edges at dawn & twilight
  out.rimColor.copy(RIM_DAY).lerp(RIM_NIGHT, nightT);
  if (dawnT > 0) {
    out.rimColor.lerp(RIM_DAWN, dawnT * 0.9);
  } else if (duskT > 0) {
    out.rimColor.lerp(RIM_DUSK, duskT * 0.9);
  }
  out.rimIntensity = 0.22 * (1 - nightT * 0.3) + dawnT * 0.34 + duskT * 0.22;

  // Sky dome gradient & clouds
  out.skyZenith.copy(ZENITH_DAY).lerp(ZENITH_NIGHT, nightT);
  out.skyMid.copy(MID_DAY).lerp(MID_NIGHT, nightT);
  out.skyHorizon.copy(HORIZ_DAY).lerp(HORIZ_NIGHT, nightT);
  out.cloudTop.copy(CLOUD_DAY_TOP).lerp(CLOUD_NIGHT_TOP, nightT);
  out.cloudBottom.copy(CLOUD_DAY_BOT).lerp(CLOUD_NIGHT_BOT, nightT);

  if (dawnT > 0) {
    out.skyZenith.lerp(ZENITH_DAWN, dawnT * 0.88);
    out.skyMid.lerp(MID_DAWN, dawnT * 0.92);
    out.skyHorizon.lerp(HORIZ_DAWN, dawnT * 0.96);
    out.cloudTop.lerp(CLOUD_DAWN_TOP, dawnT * 0.9);
    out.cloudBottom.lerp(CLOUD_DAWN_BOT, dawnT * 0.9);
  } else if (duskT > 0) {
    out.skyZenith.lerp(ZENITH_DUSK, duskT * 0.88);
    out.skyMid.lerp(MID_DUSK, duskT * 0.92);
    out.skyHorizon.lerp(HORIZ_DUSK, duskT * 0.96);
    out.cloudTop.lerp(CLOUD_DUSK_TOP, duskT * 0.88);
    out.cloudBottom.lerp(CLOUD_DUSK_BOT, duskT * 0.88);
  }

  return out;
}

import { clamp } from './isometric';
import type { WeaponId } from './types';

export type MeleeWeaponFamily = 'crowbar' | 'slash' | 'blunt_swing' | 'heavy_chop' | 'heavy_crush';

export interface FirstPersonWeaponGripPose {
  posX: number;
  posY: number;
  posZ: number;
  pitchZ: number;
  yawY: number;
  rollX: number;
}

export interface FirstPersonMeleeSwingPose {
  armPosX: number;
  armPosY: number;
  armPosZ: number;
  armRotX: number;
  armRotY: number;
  armRotZ: number;
  wristPitchZ: number;
  wristYawY: number;
  wristRollX: number;
  slashVisible: boolean;
  slashAlpha: number;
  slashProgress: number;
  slashAngleZ: number;
  slashFlipX: boolean;
  slashScale: number;
  camPitchOffset: number;
  camRollOffset: number;
  camYawOffset: number;
}

export interface ThirdPersonMeleePose {
  rightArmRotZ: number;
  rightArmRotY: number;
  rightArmRotX: number;
  torsoRotY: number;
  torsoRotZ: number;
  arcOpacity: number;
  arcRotZ: number;
  arcFlipX: boolean;
}

export function getMeleeWeaponFamily(weapon: WeaponId): MeleeWeaponFamily {
  if (weapon === 'machete') return 'slash';
  if (weapon === 'barbed_bat') return 'blunt_swing';
  if (weapon === 'axe') return 'heavy_chop';
  if (weapon === 'sledgehammer') return 'heavy_crush';
  return 'crowbar';
}

export function getFirstPersonMeleeGripPose(weapon: WeaponId): FirstPersonWeaponGripPose {
  switch (weapon) {
    case 'machete':
      // Diagonal ready guard: curved honed edge faces forward-left across the target plane
      return {
        posX: 0.02,
        posY: -0.025,
        posZ: -0.015,
        pitchZ: 1.08,
        yawY: 0.24,
        rollX: 0.56,
      };
    case 'crowbar':
      // Angled forward-up with gooseneck pry beak facing forward-left
      return {
        posX: 0.025,
        posY: -0.035,
        posZ: -0.015,
        pitchZ: 1.0,
        yawY: 0.28,
        rollX: 0.46,
      };
    case 'barbed_bat':
      // Batter's diagonal shoulder-ready stance showcasing helical barbed wire barrel
      return {
        posX: 0.02,
        posY: 0.005,
        posZ: 0.015,
        pitchZ: 1.08,
        yawY: 0.14,
        rollX: 0.34,
      };
    case 'axe':
      // Upright two-hand woodcutter stance: bearded cutting bit aims directly forward toward crosshair
      return {
        posX: 0.015,
        posY: -0.055,
        posZ: -0.025,
        pitchZ: 1.18,
        yawY: 0.24,
        rollX: 0.24,
      };
    case 'sledgehammer':
      // Heavy vertical ready stance: broad forged cheek & forward striking face clearly visible at eye level
      return {
        posX: 0.025,
        posY: -0.095,
        posZ: -0.01,
        pitchZ: 1.14,
        yawY: 0.24,
        rollX: 0.28,
      };
    default:
      return {
        posX: 0.03,
        posY: 0.01,
        posZ: 0,
        pitchZ: 0.2,
        yawY: 0,
        rollX: 0,
      };
  }
}

/**
 * Computes the camera-space direction of a weapon's striking edge vector (0, -1, 0)
 * when mounted inside `armHolder` (`rotation.y = +PI/2`) with Euler order `'ZYX'`.
 * Used for both orientation invariants and unit tests.
 */
export function computeWeaponEdgeCameraDir(grip: FirstPersonWeaponGripPose): {
  right: number;
  up: number;
  forward: number;
} {
  // Rotate (0, -1, 0) by Rx(rollX) -> Ry(yawY) -> Rz(pitchZ)
  const cr = Math.cos(grip.rollX);
  const sr = Math.sin(grip.rollX);
  const cy = Math.cos(grip.yawY);
  const sy = Math.sin(grip.yawY);
  const cp = Math.cos(grip.pitchZ);
  const sp = Math.sin(grip.pitchZ);

  // After Rx(rollX) on (0, -1, 0)
  const x1 = 0;
  const y1 = -cr;
  const z1 = -sr;

  // After Ry(yawY)
  const x2 = x1 * cy + z1 * sy;
  const y2 = y1;
  const z2 = -x1 * sy + z1 * cy;

  // After Rz(pitchZ) in weaponHolder space
  const x3 = x2 * cp - y2 * sp;
  const y3 = x2 * sp + y2 * cp;
  const z3 = z2;

  // Transform by armHolder.rotation.y = +PI/2 into fpsCamera space (-Z_cam is forward)
  // local +X -> (0, 0, -1), local +Y -> (0, 1, 0), local +Z -> (1, 0, 0)
  return {
    right: z3,
    up: y3,
    forward: x3,
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-5, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function easeOutCubic(t: number): number {
  const inv = 1 - clamp(t, 0, 1);
  return 1 - inv * inv * inv;
}

export function evaluateFirstPersonMeleePose(input: {
  weapon: WeaponId;
  progress: number;
  comboStep: number;
  hasHit: boolean;
}): FirstPersonMeleeSwingPose {
  const p = clamp(input.progress, 0, 1);
  if (p <= 0 || p >= 1) {
    return {
      armPosX: 0,
      armPosY: 0,
      armPosZ: 0,
      armRotX: 0,
      armRotY: 0,
      armRotZ: 0,
      wristPitchZ: 0,
      wristYawY: 0,
      wristRollX: 0,
      slashVisible: false,
      slashAlpha: 0,
      slashProgress: 0,
      slashAngleZ: 0,
      slashFlipX: false,
      slashScale: 1,
      camPitchOffset: 0,
      camRollOffset: 0,
      camYawOffset: 0,
    };
  }

  const family = getMeleeWeaponFamily(input.weapon);
  const isBackhand = (family === 'slash' || family === 'blunt_swing' || family === 'crowbar') && (input.comboStep & 1) === 1;
  const isHeavy = family === 'heavy_chop' || family === 'heavy_crush';

  // Phase weights:
  // 0.00..0.22: Wind-up
  // 0.22..0.46: Explosive snap strike
  // 0.46..0.70: Follow-through + impact recoil bounce
  // 0.70..1.00: Smooth recovery to ready stance
  const windUp = smoothstep(0.0, 0.22, p) * (1 - smoothstep(0.20, 0.34, p));
  const strikeRise = easeOutCubic(smoothstep(0.18, 0.46, p));
  const recover = 1 - smoothstep(0.64, 1.0, p);
  const strike = strikeRise * recover;
  const follow = Math.sin(smoothstep(0.42, 0.76, p) * Math.PI) * recover;

  const bounce =
    input.hasHit && p > 0.31 && p < 0.85
      ? Math.exp(-(p - 0.31) * 7.8) * Math.sin((p - 0.31) * 25)
      : 0;

  const slashVisible = p >= 0.16 && p <= 0.62;
  const slashProgress = slashVisible ? clamp((p - 0.16) / 0.46, 0, 1) : 0;
  const slashAlpha = slashVisible ? Math.sin(slashProgress * Math.PI) : 0;

  if (family === 'heavy_crush') {
    // Sledgehammer: high two-hand overhead pull -> crushing vertical slam -> heavy bounce & recovery
    const armPosX = windUp * 0.01 - strike * 0.16 + bounce * 0.025;
    const armPosY = windUp * 0.14 - strike * 0.17 - follow * 0.04 + bounce * 0.05;
    const armPosZ = windUp * 0.08 - strike * 0.16 + bounce * 0.035;

    const armRotX = windUp * 0.54 - strike * 1.12 - follow * 0.12 + bounce * 0.26;
    const armRotY = -windUp * 0.14 + strike * 0.28 + bounce * 0.06;
    const armRotZ = -windUp * 0.12 + strike * 0.16;

    const wristPitchZ = windUp * 0.32 - strike * 0.68 + bounce * 0.28;
    const wristYawY = strike * 0.08;
    const wristRollX = strike * 0.06;

    return {
      armPosX,
      armPosY,
      armPosZ,
      armRotX,
      armRotY,
      armRotZ,
      wristPitchZ,
      wristYawY,
      wristRollX,
      slashVisible,
      slashAlpha: slashAlpha * 0.95,
      slashProgress,
      slashAngleZ: -1.35,
      slashFlipX: false,
      slashScale: 1.14,
      camPitchOffset: windUp * 0.022 - strike * 0.048 + bounce * 0.02,
      camRollOffset: -windUp * 0.012 + strike * 0.022,
      camYawOffset: strike * 0.012,
    };
  }

  if (family === 'heavy_chop') {
    // Fire Axe: steep diagonal-overhead woodcutter cleave with slight combo side variation
    const chopSign = (input.comboStep & 1) === 1 ? -1 : 1;
    const armPosX = windUp * 0.06 - strike * 0.24 + bounce * 0.03;
    const armPosY = windUp * 0.13 - strike * 0.14 - follow * 0.03 + bounce * 0.045;
    const armPosZ = windUp * 0.07 - strike * 0.14 + bounce * 0.03;

    const armRotX = windUp * 0.48 - strike * 0.96 - follow * 0.1 + bounce * 0.24;
    const armRotY = -windUp * 0.28 + strike * (0.54 + chopSign * 0.08) + bounce * 0.1;
    const armRotZ = -windUp * 0.22 + strike * (0.44 + chopSign * 0.08);

    const wristPitchZ = windUp * 0.28 - strike * 0.56 + bounce * 0.24;
    const wristYawY = strike * 0.16;
    const wristRollX = strike * 0.22;

    return {
      armPosX,
      armPosY,
      armPosZ,
      armRotX,
      armRotY,
      armRotZ,
      wristPitchZ,
      wristYawY,
      wristRollX,
      slashVisible,
      slashAlpha: slashAlpha * 0.95,
      slashProgress,
      slashAngleZ: chopSign > 0 ? -0.78 : -0.96,
      slashFlipX: false,
      slashScale: 1.12,
      camPitchOffset: windUp * 0.018 - strike * 0.036 + bounce * 0.016,
      camRollOffset: -windUp * 0.015 + strike * 0.03,
      camYawOffset: strike * 0.018,
    };
  }

  // Machete / Barbed Bat / Crowbar: alternating forehand & backhand diagonal cleaves
  const weightScale = family === 'blunt_swing' ? 1.12 : family === 'crowbar' ? 1.0 : 0.92;
  if (isBackhand) {
    // Wind up low-left with wrist rolled so sharp edge/wire leads backhand sweep left -> right-up
    const armPosX = -windUp * 0.24 + strike * 0.06 + bounce * 0.02;
    const armPosY = -windUp * 0.06 + strike * 0.04 + bounce * 0.02;
    const armPosZ = windUp * 0.03 - strike * 0.1 + bounce * 0.02;

    const armRotX = -windUp * 0.22 + strike * 0.16 - bounce * 0.14;
    const armRotY = windUp * 0.78 - strike * 0.62 - bounce * 0.22;
    const armRotZ = windUp * 0.64 - strike * 0.42;

    const wristPitchZ = windUp * 0.12 - strike * 0.34 - bounce * 0.18;
    const wristYawY = -strike * 0.3;
    // Flip roll smoothly around weapon axis so cutting edge (-Y) faces right along backhand cut
    const wristRollX = -(windUp * 1.1 + strike * 1.45);

    return {
      armPosX,
      armPosY,
      armPosZ,
      armRotX,
      armRotY,
      armRotZ,
      wristPitchZ,
      wristYawY,
      wristRollX,
      slashVisible,
      slashAlpha,
      slashProgress,
      slashAngleZ: 0.48,
      slashFlipX: true,
      slashScale: isHeavy ? 1.1 : family === 'blunt_swing' ? 1.06 : 0.96,
      camPitchOffset: (-windUp * 0.008 + strike * 0.016) * weightScale,
      camRollOffset: (windUp * 0.014 - strike * 0.026) * weightScale,
      camYawOffset: -strike * 0.016 * weightScale,
    };
  }

  // Forehand: windup high-right -> snap diagonally down-left across crosshair
  const armPosX = windUp * 0.08 - strike * 0.34 + bounce * 0.035;
  const armPosY = windUp * 0.09 - strike * 0.11 - follow * 0.025 + bounce * 0.028;
  const armPosZ = windUp * 0.06 - strike * 0.11 + bounce * 0.025;

  const armRotX = windUp * 0.36 - strike * 0.76 - follow * 0.08 + bounce * 0.18;
  const armRotY = -windUp * 0.42 + strike * 0.94 + bounce * 0.24;
  const armRotZ = -windUp * 0.24 + strike * 0.62;

  const wristPitchZ = windUp * 0.24 - strike * 0.46 + bounce * 0.2;
  const wristYawY = strike * 0.24;
  const wristRollX = strike * 0.32;

  return {
    armPosX,
    armPosY,
    armPosZ,
    armRotX,
    armRotY,
    armRotZ,
    wristPitchZ,
    wristYawY,
    wristRollX,
    slashVisible,
    slashAlpha,
    slashProgress,
    slashAngleZ: -0.52,
    slashFlipX: false,
    slashScale: family === 'blunt_swing' ? 1.08 : 0.98,
    camPitchOffset: (windUp * 0.012 - strike * 0.022 + bounce * 0.01) * weightScale,
    camRollOffset: (-windUp * 0.012 + strike * 0.026) * weightScale,
    camYawOffset: strike * 0.016 * weightScale,
  };
}

export function evaluateThirdPersonMeleePose(input: {
  weapon: WeaponId;
  progress: number;
  comboStep: number;
}): ThirdPersonMeleePose {
  const p = clamp(input.progress, 0, 1);
  if (p <= 0 || p >= 1) {
    return {
      rightArmRotZ: 0.48,
      rightArmRotY: 0,
      rightArmRotX: 0,
      torsoRotY: 0,
      torsoRotZ: 0,
      arcOpacity: 0,
      arcRotZ: 0,
      arcFlipX: false,
    };
  }

  const family = getMeleeWeaponFamily(input.weapon);
  const windUp = smoothstep(0.0, 0.22, p) * (1 - smoothstep(0.2, 0.34, p));
  const strike = easeOutCubic(smoothstep(0.18, 0.46, p)) * (1 - smoothstep(0.65, 1.0, p));

  const isHeavy = family === 'heavy_chop' || family === 'heavy_crush';
  const isBackhand = !isHeavy && (input.comboStep & 1) === 1;
  const arcOpacity = p >= 0.18 && p <= 0.62 ? Math.sin(clamp((p - 0.18) / 0.44, 0, 1) * Math.PI) * 0.85 : 0;

  if (isHeavy) {
    return {
      rightArmRotZ: 0.55 + windUp * 1.45 - strike * 1.75,
      rightArmRotY: -windUp * 0.2 + strike * 0.35,
      rightArmRotX: 0,
      torsoRotY: windUp * 0.22 - strike * 0.34,
      torsoRotZ: windUp * 0.14 - strike * 0.24,
      arcOpacity,
      arcRotZ: family === 'heavy_crush' ? 0 : 0.24,
      arcFlipX: false,
    };
  }

  if (isBackhand) {
    return {
      rightArmRotZ: 0.55 - windUp * 0.2 + strike * 0.45,
      rightArmRotY: -windUp * 0.85 + strike * 1.85,
      rightArmRotX: 0.28,
      torsoRotY: -windUp * 0.25 + strike * 0.42,
      torsoRotZ: -0.1,
      arcOpacity,
      arcRotZ: -0.22,
      arcFlipX: true,
    };
  }

  return {
    rightArmRotZ: 0.52 + windUp * 1.05 - strike * 1.32,
    rightArmRotY: windUp * 0.85 - strike * 1.85,
    rightArmRotX: -0.25,
    torsoRotY: windUp * 0.28 - strike * 0.44,
    torsoRotZ: -0.12,
    arcOpacity,
    arcRotZ: 0.22,
    arcFlipX: false,
  };
}

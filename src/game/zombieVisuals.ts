import type { ZombieAIState, ZombieArchetype } from './types';

export type ZombieLodTier = 'full' | 'medium' | 'simple';

export interface ZombieVisualPreset {
  archetype: ZombieArchetype;
  wetness: number;
  roughnessBase: number;
  clearcoat: number;
  clearcoatRoughness: number;
  blisterAmp: number;
  blisterPulseSpeed: number;
  blisterWobbleAmp: number;
  veinColorHex: number;
  veinPulseSpeed: number;
  veinIntensity: number;
  blisterGlowHex: number;
  fleshDeformAmp: number;
  breathAmp: number;
  salivaColorHex: number;
  pusColorHex: number;
  sporeColorHex: number;
  salivaRate: number;
  oozeRate: number;
  sporeRate: number;
  spasmRate: number;
  jawRestOpen: number;
  jawSnapAmp: number;
}

export const ZOMBIE_VISUAL_PRESETS: Record<ZombieArchetype, ZombieVisualPreset> = {
  walker: {
    archetype: 'walker',
    wetness: 0.68,
    roughnessBase: 0.48,
    clearcoat: 0.64,
    clearcoatRoughness: 0.16,
    blisterAmp: 0.22,
    blisterPulseSpeed: 2.5,
    blisterWobbleAmp: 0.1,
    veinColorHex: 0x6e1f3a,
    veinPulseSpeed: 2.2,
    veinIntensity: 0.56,
    blisterGlowHex: 0x998c38,
    fleshDeformAmp: 0.014,
    breathAmp: 0.011,
    salivaColorHex: 0xc8d4b8,
    pusColorHex: 0xa4ad4b,
    sporeColorHex: 0x5d6b47,
    salivaRate: 0.36,
    oozeRate: 0.32,
    sporeRate: 0.2,
    spasmRate: 0.56,
    jawRestOpen: 0.18,
    jawSnapAmp: 0.38,
  },
  runner: {
    archetype: 'runner',
    wetness: 0.88,
    roughnessBase: 0.34,
    clearcoat: 0.84,
    clearcoatRoughness: 0.12,
    blisterAmp: 0.24,
    blisterPulseSpeed: 4.8,
    blisterWobbleAmp: 0.12,
    veinColorHex: 0xd92626,
    veinPulseSpeed: 5.2,
    veinIntensity: 0.78,
    blisterGlowHex: 0xc22b2b,
    fleshDeformAmp: 0.021,
    breathAmp: 0.016,
    salivaColorHex: 0xc94242,
    pusColorHex: 0x991c1c,
    sporeColorHex: 0x662727,
    salivaRate: 0.64,
    oozeRate: 0.46,
    sporeRate: 0.26,
    spasmRate: 1.0,
    jawRestOpen: 0.24,
    jawSnapAmp: 0.56,
  },
  bloater: {
    archetype: 'bloater',
    wetness: 0.84,
    roughnessBase: 0.36,
    clearcoat: 0.86,
    clearcoatRoughness: 0.12,
    blisterAmp: 0.34,
    blisterPulseSpeed: 3.1,
    blisterWobbleAmp: 0.18,
    veinColorHex: 0x8ad629,
    veinPulseSpeed: 2.9,
    veinIntensity: 0.88,
    blisterGlowHex: 0xb2ed40,
    fleshDeformAmp: 0.028,
    breathAmp: 0.023,
    salivaColorHex: 0xa9db46,
    pusColorHex: 0xc3f04a,
    sporeColorHex: 0x7cb832,
    salivaRate: 0.54,
    oozeRate: 0.88,
    sporeRate: 0.9,
    spasmRate: 0.46,
    jawRestOpen: 0.26,
    jawSnapAmp: 0.44,
  },
  spitter: {
    archetype: 'spitter',
    wetness: 0.9,
    roughnessBase: 0.3,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    blisterAmp: 0.26,
    blisterPulseSpeed: 3.8,
    blisterWobbleAmp: 0.14,
    veinColorHex: 0x3be0a4,
    veinPulseSpeed: 3.6,
    veinIntensity: 0.92,
    blisterGlowHex: 0x56f0be,
    fleshDeformAmp: 0.019,
    breathAmp: 0.019,
    salivaColorHex: 0x69ffbe,
    pusColorHex: 0x45e8a4,
    sporeColorHex: 0x3fd4a0,
    salivaRate: 0.8,
    oozeRate: 0.75,
    sporeRate: 0.74,
    spasmRate: 0.78,
    jawRestOpen: 0.3,
    jawSnapAmp: 0.52,
  },
};

export interface ZombieLodDecision {
  tier: ZombieLodTier;
  /** Continuous [0, 1] shader richness factor consumed by GLSL uniforms */
  shaderDetail: number;
  /** Whether close-up droplets, saliva strands, and spore puffs should spawn/update */
  enableMicroVfx: boolean;
  /** Whether blister meshes and vertex wobble should be animated */
  enableBlisterAnim: boolean;
}

export function computeZombieVisualLod(opts: {
  distance: number;
  isFps: boolean;
  isSoftwareGl?: boolean;
}): ZombieLodDecision {
  const d = Math.max(0, opts.distance);
  const soft = Boolean(opts.isSoftwareGl);

  if (opts.isFps) {
    const fullCutoff = soft ? 7.5 : 9.0;
    const medCutoff = soft ? 14.0 : 17.0;
    if (d <= fullCutoff) {
      return {
        tier: 'full',
        shaderDetail: 1.0,
        enableMicroVfx: true,
        enableBlisterAnim: true,
      };
    }
    if (d <= medCutoff) {
      const t = (d - fullCutoff) / Math.max(0.01, medCutoff - fullCutoff);
      const detail = Math.max(0.28, (1 - t) * (soft ? 0.55 : 0.65) + 0.28);
      return {
        tier: 'medium',
        shaderDetail: detail,
        enableMicroVfx: d <= fullCutoff + 3.5,
        enableBlisterAnim: true,
      };
    }
    return {
      tier: 'simple',
      shaderDetail: 0.0,
      enableMicroVfx: false,
      enableBlisterAnim: false,
    };
  }

  // 2D orthographic isometric view: keep macro silhouettes, spasms, and mid-tier sheen
  // nearby, then aggressively simplify at range to protect horde frame rates.
  const isoCutoff = soft ? 5.5 : 7.5;
  if (d <= isoCutoff) {
    return {
      tier: 'medium',
      shaderDetail: soft ? 0.42 : 0.52,
      enableMicroVfx: d <= 5.5,
      enableBlisterAnim: true,
    };
  }
  return {
    tier: 'simple',
    shaderDetail: 0.0,
    enableMicroVfx: false,
    enableBlisterAnim: false,
  };
}

export interface BlisterPulseSample {
  radialScale: number;
  axialStretch: number;
  wobbleX: number;
  wobbleZ: number;
  pressureGlow: number;
}

export function evaluateBlisterPulse(opts: {
  time: number;
  seed: number;
  archetype: ZombieArchetype;
  state: ZombieAIState;
  blisterIndex: number;
}): BlisterPulseSample {
  const preset = ZOMBIE_VISUAL_PRESETS[opts.archetype];
  const phase = opts.seed * 1.73 + opts.blisterIndex * 2.39;
  const speedBoost = opts.state === 'windup' || opts.state === 'attack' ? 1.55 : opts.state === 'chase' ? 1.2 : 1.0;
  const t = opts.time * preset.blisterPulseSpeed * speedBoost + phase;

  const primary = Math.sin(t);
  const harmonic = Math.sin(t * 2.13 + 0.8) * 0.35;
  const swellNorm = Math.max(-1, Math.min(1, primary * 0.74 + harmonic));

  const amp = preset.blisterAmp * (opts.state === 'windup' ? 1.28 : 1.0);
  const radialScale = 1 + swellNorm * amp;
  const axialStretch = 1 + swellNorm * amp * 1.15 - Math.abs(Math.cos(t * 1.37)) * amp * 0.18;

  const wobbleT = opts.time * (preset.blisterPulseSpeed * 1.65) + phase * 1.3;
  const wobbleX = Math.sin(wobbleT) * preset.blisterWobbleAmp;
  const wobbleZ = Math.cos(wobbleT * 0.87 + 0.5) * preset.blisterWobbleAmp;

  const pressureGlow = Math.max(0, Math.min(1, 0.35 + (swellNorm + 1) * 0.325));
  return { radialScale, axialStretch, wobbleX, wobbleZ, pressureGlow };
}

export interface JawAndSpasmPose {
  /** Radians to rotate lower jaw downward (positive = open mouth) */
  jawOpenAngle: number;
  headTwitchX: number;
  headTwitchY: number;
  headTwitchZ: number;
  torsoTwitchZ: number;
  armTwitchL: number;
  armTwitchR: number;
  /** True during sharp impulse frames of a jaw snap */
  isSnapping: boolean;
}

function pulseImpulse(phase01: number, width: number): number {
  if (phase01 < 0 || phase01 > width) return 0;
  const u = phase01 / width;
  return Math.sin(u * Math.PI);
}

export function evaluateJawAndSpasm(opts: {
  time: number;
  seed: number;
  archetype: ZombieArchetype;
  state: ZombieAIState;
  stateTimer: number;
}): JawAndSpasmPose {
  const preset = ZOMBIE_VISUAL_PRESETS[opts.archetype];
  if (opts.state === 'dying') {
    return {
      jawOpenAngle: preset.jawRestOpen * 1.4,
      headTwitchX: 0,
      headTwitchY: 0,
      headTwitchZ: 0,
      torsoTwitchZ: 0,
      armTwitchL: 0,
      armTwitchR: 0,
      isSnapping: false,
    };
  }

  const s = opts.seed * 0.6180339;
  const pant = (Math.sin(opts.time * (opts.archetype === 'runner' ? 7.2 : 3.6) + s * 9.0) + 1) * 0.5;

  // Periodic sudden jaw snap cycle
  const snapPeriod = opts.archetype === 'runner' ? 1.55 : opts.archetype === 'spitter' ? 2.1 : 2.8;
  const snapPhase = ((opts.time + s * 3.1) % snapPeriod + snapPeriod) % snapPeriod;
  const snapImpulse = pulseImpulse(snapPhase / snapPeriod, 0.16);
  const chatter =
    opts.state === 'windup'
      ? Math.abs(Math.sin(opts.time * 22 + s * 5)) * 0.18
      : 0;

  let jawOpenAngle = preset.jawRestOpen + pant * 0.11 + snapImpulse * preset.jawSnapAmp + chatter;
  let isSnapping = snapImpulse > 0.65;

  if (opts.state === 'windup') {
    jawOpenAngle = preset.jawRestOpen + 0.42 + chatter;
  } else if (opts.state === 'attack') {
    // Rapid snap shut right through attack strike
    const biteProg = Math.max(0, Math.min(1, 1 - opts.stateTimer / 0.24));
    jawOpenAngle = preset.jawRestOpen * 0.4 + Math.max(0, 1 - biteProg * 1.8) * 0.46;
    isSnapping = biteProg < 0.35;
  } else if (opts.state === 'alert') {
    jawOpenAngle += 0.14;
  }

  // Deterministic asymmetrical twitching spasms (brief sharp bursts every ~2.4-4s)
  const spasmPeriod = Math.max(1.3, 3.2 - preset.spasmRate * 1.4);
  const spasmPhase = ((opts.time + s * 7.3) % spasmPeriod + spasmPeriod) % spasmPeriod;
  const spasmPulse = pulseImpulse(spasmPhase / spasmPeriod, 0.14);
  const burstDir = Math.sin(Math.floor((opts.time + s * 7.3) / spasmPeriod) * 19.7 + opts.seed);
  const burstDir2 = Math.cos(Math.floor((opts.time + s * 7.3) / spasmPeriod) * 31.3 + opts.seed);
  const spasmMag = preset.spasmRate * spasmPulse * (opts.state === 'chase' || opts.state === 'windup' ? 1.25 : 1.0);

  return {
    jawOpenAngle: Math.max(0.03, Math.min(0.88, jawOpenAngle)),
    headTwitchX: burstDir * 0.16 * spasmMag,
    headTwitchY: burstDir2 * 0.24 * spasmMag,
    headTwitchZ: -burstDir * 0.19 * spasmMag,
    torsoTwitchZ: burstDir2 * 0.065 * spasmMag,
    armTwitchL: burstDir * 0.14 * spasmMag,
    armTwitchR: -burstDir2 * 0.14 * spasmMag,
    isSnapping,
  };
}

export interface SalivaStrandSample {
  phase: number;
  strandLength: number;
  strandThickness: number;
  emitDrop: boolean;
}

export function evaluateSalivaStrandCycle(opts: {
  prevPhase: number;
  dt: number;
  archetype: ZombieArchetype;
  jawOpenAngle: number;
  isSnapping: boolean;
}): SalivaStrandSample {
  const preset = ZOMBIE_VISUAL_PRESETS[opts.archetype];
  const speed = preset.salivaRate * (0.75 + Math.min(1, opts.jawOpenAngle * 1.3) * 0.55);
  let nextPhase = opts.prevPhase + Math.max(0, opts.dt) * speed;
  let emitDrop = false;

  if (nextPhase >= 1.0 || (opts.isSnapping && nextPhase > 0.45)) {
    nextPhase = nextPhase >= 1.0 ? nextPhase - Math.floor(nextPhase) : 0.08;
    emitDrop = true;
  }

  // Strand stretches downward smoothly, thins slightly just before snapping off
  const stretch = Math.min(1, nextPhase / 0.92);
  const strandLength = 0.03 + stretch * 0.14;
  const strandThickness = 1.0 - stretch * 0.42;

  return {
    phase: nextPhase,
    strandLength,
    strandThickness,
    emitDrop,
  };
}

export interface SkinDeformSample {
  deformAmp: number;
  lungeStretch: number;
}

export function evaluateSkinDeformIntensity(opts: {
  archetype: ZombieArchetype;
  animState: 'idle' | 'walk' | 'windup' | 'attack' | 'dying' | 'dodge';
  walkCycle: number;
}): SkinDeformSample {
  const preset = ZOMBIE_VISUAL_PRESETS[opts.archetype];
  if (opts.animState === 'dying') {
    return { deformAmp: preset.fleshDeformAmp * 0.35, lungeStretch: 0 };
  }
  if (opts.animState === 'attack') {
    return { deformAmp: preset.fleshDeformAmp * 1.95, lungeStretch: 1.0 };
  }
  if (opts.animState === 'windup') {
    return { deformAmp: preset.fleshDeformAmp * 1.5, lungeStretch: -0.45 };
  }
  if (opts.animState === 'walk') {
    const strideImpact = 0.75 + 0.55 * Math.abs(Math.sin(opts.walkCycle * 1.1));
    return { deformAmp: preset.fleshDeformAmp * strideImpact, lungeStretch: 0.18 };
  }
  return { deformAmp: preset.fleshDeformAmp * 0.45, lungeStretch: 0 };
}

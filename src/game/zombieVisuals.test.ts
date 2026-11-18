import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOMBIE_VISUAL_PRESETS,
  computeZombieVisualLod,
  evaluateBlisterPulse,
  evaluateJawAndSpasm,
  evaluateSalivaStrandCycle,
  evaluateSkinDeformIntensity,
} from './zombieVisuals';
import type { ZombieArchetype } from './types';

const ARCHETYPES: ZombieArchetype[] = ['walker', 'runner', 'bloater', 'spitter'];

test('all four zombie archetypes have tailored non-degenerate visual presets', () => {
  for (const arch of ARCHETYPES) {
    const p = ZOMBIE_VISUAL_PRESETS[arch];
    assert.equal(p.archetype, arch);
    assert.ok(p.wetness > 0.4 && p.wetness <= 1.0);
    assert.ok(p.clearcoat > 0.5 && p.clearcoat <= 1.0);
    assert.ok(p.blisterAmp > 0.1 && p.blisterPulseSpeed > 1.0);
    assert.ok(p.veinIntensity > 0.3 && p.veinPulseSpeed > 1.0);
    assert.ok(p.fleshDeformAmp > 0.005);
  }
  assert.ok(ZOMBIE_VISUAL_PRESETS.bloater.blisterAmp > ZOMBIE_VISUAL_PRESETS.walker.blisterAmp);
  assert.ok(ZOMBIE_VISUAL_PRESETS.bloater.sporeRate > ZOMBIE_VISUAL_PRESETS.runner.sporeRate);
  assert.ok(ZOMBIE_VISUAL_PRESETS.runner.spasmRate > ZOMBIE_VISUAL_PRESETS.bloater.spasmRate);
  assert.ok(ZOMBIE_VISUAL_PRESETS.spitter.salivaRate > ZOMBIE_VISUAL_PRESETS.walker.salivaRate);
});

test('computeZombieVisualLod grants full detail nearby in FPS and simplifies at range and in 2D iso view', () => {
  const fpsClose = computeZombieVisualLod({ distance: 3.0, isFps: true, isSoftwareGl: false });
  assert.equal(fpsClose.tier, 'full');
  assert.equal(fpsClose.shaderDetail, 1.0);
  assert.equal(fpsClose.enableMicroVfx, true);
  assert.equal(fpsClose.enableBlisterAnim, true);

  const fpsMid = computeZombieVisualLod({ distance: 12.0, isFps: true, isSoftwareGl: false });
  assert.equal(fpsMid.tier, 'medium');
  assert.ok(fpsMid.shaderDetail > 0.25 && fpsMid.shaderDetail < 1.0);

  const fpsFar = computeZombieVisualLod({ distance: 22.0, isFps: true, isSoftwareGl: false });
  assert.equal(fpsFar.tier, 'simple');
  assert.equal(fpsFar.shaderDetail, 0.0);
  assert.equal(fpsFar.enableMicroVfx, false);
  assert.equal(fpsFar.enableBlisterAnim, false);

  const isoClose = computeZombieVisualLod({ distance: 3.0, isFps: false, isSoftwareGl: false });
  assert.equal(isoClose.tier, 'medium');
  assert.ok(isoClose.shaderDetail <= 0.55 && isoClose.shaderDetail > 0);

  const isoFar = computeZombieVisualLod({ distance: 10.0, isFps: false, isSoftwareGl: false });
  assert.equal(isoFar.tier, 'simple');
  assert.equal(isoFar.shaderDetail, 0.0);
  assert.equal(isoFar.enableMicroVfx, false);
});

test('evaluateBlisterPulse produces smooth bounded swelling, wobble, and out-of-phase blisters', () => {
  const s0 = evaluateBlisterPulse({ time: 1.25, seed: 4, archetype: 'bloater', state: 'chase', blisterIndex: 0 });
  const s1 = evaluateBlisterPulse({ time: 1.25, seed: 4, archetype: 'bloater', state: 'chase', blisterIndex: 1 });

  assert.ok(Number.isFinite(s0.radialScale) && s0.radialScale > 0.5 && s0.radialScale < 1.6);
  assert.ok(Number.isFinite(s0.axialStretch) && s0.axialStretch > 0.5 && s0.axialStretch < 1.7);
  assert.ok(s0.pressureGlow >= 0 && s0.pressureGlow <= 1);
  assert.notEqual(s0.radialScale, s1.radialScale);

  let maxChaseExc = 0;
  let maxWindExc = 0;
  for (let i = 0; i < 40; i++) {
    const t = i * 0.05;
    maxChaseExc = Math.max(
      maxChaseExc,
      Math.abs(evaluateBlisterPulse({ time: t, seed: 4, archetype: 'bloater', state: 'chase', blisterIndex: 0 }).radialScale - 1)
    );
    maxWindExc = Math.max(
      maxWindExc,
      Math.abs(evaluateBlisterPulse({ time: t, seed: 4, archetype: 'bloater', state: 'windup', blisterIndex: 0 }).radialScale - 1)
    );
  }
  assert.ok(maxWindExc > maxChaseExc);
});

test('evaluateJawAndSpasm opens jaw in windup, snaps in attack, and creates bounded twitches', () => {
  const wind = evaluateJawAndSpasm({ time: 2.0, seed: 7, archetype: 'runner', state: 'windup', stateTimer: 0.2 });
  const atk = evaluateJawAndSpasm({ time: 2.0, seed: 7, archetype: 'runner', state: 'attack', stateTimer: 0.05 });
  const dead = evaluateJawAndSpasm({ time: 2.0, seed: 7, archetype: 'runner', state: 'dying', stateTimer: 0.3 });

  assert.ok(wind.jawOpenAngle > atk.jawOpenAngle);
  assert.ok(wind.jawOpenAngle <= 0.88);
  assert.equal(dead.headTwitchX, 0);
  assert.equal(dead.torsoTwitchZ, 0);
});

test('evaluateSalivaStrandCycle stretches smoothly and emits droplet on detach or snap', () => {
  let phase = 0.1;
  let emitted = false;
  let maxLen = 0;
  for (let i = 0; i < 30; i++) {
    const sample = evaluateSalivaStrandCycle({
      prevPhase: phase,
      dt: 0.1,
      archetype: 'spitter',
      jawOpenAngle: 0.45,
      isSnapping: false,
    });
    phase = sample.phase;
    maxLen = Math.max(maxLen, sample.strandLength);
    if (sample.emitDrop) emitted = true;
    assert.ok(sample.strandThickness > 0.4 && sample.strandThickness <= 1.0);
  }
  assert.equal(emitted, true);
  assert.ok(maxLen > 0.12);

  const snapped = evaluateSalivaStrandCycle({
    prevPhase: 0.65,
    dt: 0.016,
    archetype: 'runner',
    jawOpenAngle: 0.3,
    isSnapping: true,
  });
  assert.equal(snapped.emitDrop, true);
});

test('evaluateSkinDeformIntensity scales across idle, walk, windup, and attack', () => {
  const idle = evaluateSkinDeformIntensity({ archetype: 'bloater', animState: 'idle', walkCycle: 0 });
  const walk = evaluateSkinDeformIntensity({ archetype: 'bloater', animState: 'walk', walkCycle: Math.PI * 0.5 });
  const attack = evaluateSkinDeformIntensity({ archetype: 'bloater', animState: 'attack', walkCycle: 0 });

  assert.ok(walk.deformAmp > idle.deformAmp);
  assert.ok(attack.deformAmp > walk.deformAmp);
  assert.equal(attack.lungeStretch, 1.0);
});

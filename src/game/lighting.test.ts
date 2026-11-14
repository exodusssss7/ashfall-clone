import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAtmosphereLighting, createAtmosphereLightingState } from './lighting';

test('computeAtmosphereLighting gives DAWN distinct cool-sky / warm-sunrise palette and morning mist', () => {
  const dawn = computeAtmosphereLighting(6 * 60 + 25, createAtmosphereLightingState());
  const dusk = computeAtmosphereLighting(19 * 60 + 5, createAtmosphereLightingState());
  const noon = computeAtmosphereLighting(12 * 60, createAtmosphereLightingState());
  const night = computeAtmosphereLighting(23 * 60, createAtmosphereLightingState());

  assert.equal(dawn.phaseLabel, 'DAWN');
  assert.ok(dawn.dawnT > 0.85, 'expected strong dawn peak near 06:25');
  assert.equal(dawn.duskT, 0);
  assert.ok(dawn.fogDensityScale > noon.fogDensityScale, 'dawn should add gentle morning mist');
  assert.ok(dawn.rimIntensity > noon.rimIntensity, 'dawn should boost cool rim fill opposite sunrise');

  // Sun should sit above horizon during peak dawn and move higher by noon
  assert.ok(dawn.sunDir.y > 0.05 && dawn.sunDir.y < noon.sunDir.y);
  // Dawn sunrise azimuth should differ from dusk sunset azimuth (east vs west)
  assert.ok(dawn.sunDir.x * dusk.sunDir.x < 0, 'dawn sun and dusk sun should be on opposite sides of sky');

  // Dawn colors should be distinct from dusk and nightfall
  assert.notEqual(dawn.skyHorizon.getHex(), dusk.skyHorizon.getHex());
  assert.notEqual(dawn.fpsFogColor.getHex(), dusk.fpsFogColor.getHex());
  assert.ok(night.sunIntensity < dawn.sunIntensity && dawn.sunIntensity < noon.sunIntensity);
});

test('computeAtmosphereLighting mutates state cleanly with zero unexpected NaNs across 24h cycle', () => {
  const state = createAtmosphereLightingState();
  for (let m = 0; m < 1440; m += 30) {
    computeAtmosphereLighting(m, state);
    assert.ok(Number.isFinite(state.sunDir.length()) && Math.abs(state.sunDir.length() - 1) < 1e-4);
    assert.ok(Number.isFinite(state.sunLightOffset.x) && state.sunLightOffset.y > 0);
    assert.ok(Number.isFinite(state.rimIntensity) && state.rimIntensity > 0);
    assert.ok(Number.isFinite(state.hemiIntensity) && state.hemiIntensity > 0);
  }
});

test('night removes the constant ambient sources so terrain really goes dark', () => {
  const noon = computeAtmosphereLighting(12 * 60, createAtmosphereLightingState());
  const night = computeAtmosphereLighting(23 * 60, createAtmosphereLightingState());
  assert.equal(noon.envIntensity, 1);
  assert.ok(night.envIntensity <= 0.15, 'studio reflection map must fade at night');
  assert.ok(night.hemiIntensity <= noon.hemiIntensity * 0.2);
  assert.ok(night.sunIntensity <= noon.sunIntensity * 0.15);
  assert.ok(night.exposure < noon.exposure);
});

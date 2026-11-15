import test from 'node:test';
import assert from 'node:assert/strict';
import { FPS_BASE_FOV, FPS_FOV_MAX, FPS_FOV_MIN, ISO_ZOOM_MAX, ISO_ZOOM_MIN } from './firstPerson';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings';

test('sanitizeSettings preserves defaults and clamps POV fields cleanly', () => {
  const clean = sanitizeSettings(undefined);
  assert.deepEqual(clean, DEFAULT_SETTINGS);
  assert.equal(clean.defaultCameraMode, 'iso');
  assert.equal(clean.fpsFov, FPS_BASE_FOV);
  assert.equal(clean.isoZoom, 1);
  assert.equal(clean.fpsHeadBob, true);
  assert.equal(clean.invertLookY, false);

  const clamped = sanitizeSettings({
    defaultCameraMode: 'fps',
    fpsFov: 150,
    isoZoom: 0.2,
    fpsHeadBob: false,
    invertLookY: true,
  });
  assert.equal(clamped.defaultCameraMode, 'fps');
  assert.equal(clamped.fpsFov, FPS_FOV_MAX);
  assert.equal(clamped.isoZoom, ISO_ZOOM_MIN);
  assert.equal(clamped.fpsHeadBob, false);
  assert.equal(clamped.invertLookY, true);

  const lowClamp = sanitizeSettings({
    defaultCameraMode: 'invalid' as unknown as 'iso',
    fpsFov: 10,
    isoZoom: 5,
  });
  assert.equal(lowClamp.defaultCameraMode, 'iso');
  assert.equal(lowClamp.fpsFov, FPS_FOV_MIN);
  assert.equal(lowClamp.isoZoom, ISO_ZOOM_MAX);
});

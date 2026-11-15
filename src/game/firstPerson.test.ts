import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FPS_PITCH_MAX,
  FPS_PITCH_MIN,
  applyFirstPersonLookDelta,
  applyFirstPersonTouchLookDelta,
  computeFirstPersonAimWorldTarget,
  computeFirstPersonHeadBob,
  computeFirstPersonMoveVector,
  computeFirstPersonStrafeRoll,
  computeFirstPersonWeaponRaiseOffset,
  pickBestDirectionalTarget,
} from './firstPerson';

test('computeFirstPersonMoveVector aligns forward and right strafe with yaw', () => {
  // Looking East (yaw = 0): forward is +X, right strafe is +Y (South in world / +Z in 3D)
  const fEast = computeFirstPersonMoveVector(1, 0, 0);
  assert.ok(Math.abs(fEast.wx - 1) < 1e-6);
  assert.ok(Math.abs(fEast.wy) < 1e-6);

  const rEast = computeFirstPersonMoveVector(0, 1, 0);
  assert.ok(Math.abs(rEast.wx) < 1e-6);
  assert.ok(Math.abs(rEast.wy - 1) < 1e-6);

  // Looking South (yaw = PI/2): forward is +Y, right strafe is -X
  const fSouth = computeFirstPersonMoveVector(1, 0, Math.PI * 0.5);
  assert.ok(Math.abs(fSouth.wx) < 1e-6);
  assert.ok(Math.abs(fSouth.wy - 1) < 1e-6);

  const rSouth = computeFirstPersonMoveVector(0, 1, Math.PI * 0.5);
  assert.ok(Math.abs(rSouth.wx + 1) < 1e-6);
  assert.ok(Math.abs(rSouth.wy) < 1e-6);

  // Diagonal input is normalized to unit length
  const diag = computeFirstPersonMoveVector(1, 1, 0.42);
  assert.ok(Math.abs(Math.hypot(diag.wx, diag.wy) - 1) < 1e-6);

  // Zero input produces zero vector
  assert.deepEqual(computeFirstPersonMoveVector(0, 0, 1.2), { wx: 0, wy: 0 });
});

test('applyFirstPersonLookDelta wraps yaw and clamps pitch safely', () => {
  const up = applyFirstPersonLookDelta(0, 0, 0, -5000, 0.01);
  assert.equal(up.pitch, FPS_PITCH_MAX);

  const down = applyFirstPersonLookDelta(0, 0, 0, 5000, 0.01);
  assert.equal(down.pitch, FPS_PITCH_MIN);

  const wrapped = applyFirstPersonLookDelta(Math.PI - 0.1, 0, 100, 0, 0.01);
  assert.ok(wrapped.yaw <= Math.PI && wrapped.yaw >= -Math.PI);
  assert.ok(wrapped.yaw < 0);
});

test('applyFirstPersonTouchLookDelta turns both yaw and pitch smoothly for mobile touch drag', () => {
  const rightDrag = applyFirstPersonTouchLookDelta(0, 0, 120, -40);
  assert.ok(rightDrag.yaw > 0.3 && rightDrag.yaw < 1.0);
  assert.ok(rightDrag.pitch > 0.05 && rightDrag.pitch <= FPS_PITCH_MAX);

  const clamped = applyFirstPersonTouchLookDelta(0, 0, 0, 5000);
  assert.equal(clamped.pitch, FPS_PITCH_MIN);
});

test('computeFirstPersonStrafeRoll tilts smoothly with strafe speed and stays bounded', () => {
  assert.equal(computeFirstPersonStrafeRoll(1, 0), 0);
  const rightStrafe = computeFirstPersonStrafeRoll(1, 4.2);
  const leftStrafe = computeFirstPersonStrafeRoll(-1, 4.2);
  assert.ok(rightStrafe < 0 && leftStrafe > 0);
  assert.ok(Math.abs(rightStrafe + leftStrafe) < 1e-6);
});

test('computeFirstPersonWeaponRaiseOffset dips immediately after weapon switch and settles to zero', () => {
  assert.equal(computeFirstPersonWeaponRaiseOffset(0), 0);
  const startDip = computeFirstPersonWeaponRaiseOffset(0.22);
  const midDip = computeFirstPersonWeaponRaiseOffset(0.11);
  assert.ok(startDip < midDip && midDip < 0);
});

test('computeFirstPersonAimWorldTarget scales ground aim distance with downward pitch', () => {
  const flat = computeFirstPersonAimWorldTarget(10, 10, 0, 0, 5.5, 1.2, 7.5);
  assert.ok(Math.abs(flat.range - 5.5) < 1e-6);
  assert.ok(Math.abs(flat.wx - 15.5) < 1e-6);

  const steepDown = computeFirstPersonAimWorldTarget(10, 10, 0, -0.7, 5.5, 1.2, 7.5);
  assert.ok(steepDown.range < 2.0 && steepDown.range >= 1.2);
});

test('computeFirstPersonHeadBob dips during dodge and stays bounded when walking', () => {
  const idle = computeFirstPersonHeadBob(1.5, 0, false, 0);
  assert.deepEqual(idle, { eyeOffsetY: 0, swayX: 0, swayY: 0 });

  const walk = computeFirstPersonHeadBob(Math.PI * 0.5, 3.25, false, 0);
  assert.ok(Math.abs(walk.eyeOffsetY) > 0 && Math.abs(walk.eyeOffsetY) <= 0.05);

  const dodge = computeFirstPersonHeadBob(1.0, 8.4, true, 0.12);
  assert.ok(dodge.eyeOffsetY < -0.2);
});

test('pickBestDirectionalTarget prioritizes target in front of the player over slightly closer behind target', () => {
  const behind = { id: 'behind', x: 9.2, y: 10 }; // distance 0.8 behind
  const front = { id: 'front', x: 11.1, y: 10 }; // distance 1.1 in front
  const picked = pickBestDirectionalTarget(
    10,
    10,
    0,
    [behind, front],
    (item) => ({ x: item.x, y: item.y }),
    1.95
  );
  assert.equal(picked?.id, 'front');
});

test('applyFirstPersonLookDelta and applyFirstPersonTouchLookDelta support invertY vertical look', () => {
  const normal = applyFirstPersonLookDelta(0, 0, 0, -100, 0.0026, false);
  const inverted = applyFirstPersonLookDelta(0, 0, 0, -100, 0.0026, true);
  assert.ok(normal.pitch > 0);
  assert.ok(inverted.pitch < 0);
  assert.ok(Math.abs(normal.pitch + inverted.pitch) < 1e-6);

  const touchInv = applyFirstPersonTouchLookDelta(0, 0, 0, 80, undefined, true);
  assert.ok(touchInv.pitch > 0);
});

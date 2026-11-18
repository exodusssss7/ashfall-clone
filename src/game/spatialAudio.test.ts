import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISO_LISTENER_FORWARD_X,
  ISO_LISTENER_FORWARD_Z,
  computeAudioListenerPose,
  computeListenerRightSign,
  worldToAudioPosition,
} from './spatialAudio';

test('worldToAudioPosition maps tile (x,y,height) to Web Audio (x, height, y)', () => {
  const p = worldToAudioPosition({ x: 14, y: 27, height: 1.4 });
  assert.deepEqual(p, { x: 14, y: 1.4, z: 27 });
});

test('FPS listener pose tracks yaw and pitch with orthonormal forward and up vectors', () => {
  const pose = computeAudioListenerPose({
    cameraMode: 'fps',
    playerX: 10,
    playerY: 10,
    facingAngle: 0, // looking +X
    fpsPitch: 0.4,
  });

  // Forward x > 0, y > 0, z ~ 0
  assert.ok(pose.forwardX > 0.8);
  assert.ok(pose.forwardY > 0.35);
  assert.ok(Math.abs(pose.forwardZ) < 1e-6);

  // Forward dot Up must be 0 (orthonormal)
  const dot = pose.forwardX * pose.upX + pose.forwardY * pose.upY + pose.forwardZ * pose.upZ;
  assert.ok(Math.abs(dot) < 1e-6);

  // Emitter at (10, 15) (+Z relative to looking +X) is to the right (+1)
  const rightSound = computeListenerRightSign(pose, { x: 10, y: 15, height: pose.y });
  assert.ok(rightSound.pan > 0.95);

  // Emitter at (10, 5) (-Z relative to looking +X) is to the left (-1)
  const leftSound = computeListenerRightSign(pose, { x: 10, y: 5, height: pose.y });
  assert.ok(leftSound.pan < -0.95);
});

test('ISO listener pose aligns with isometric screen axes so screen-right pans right and screen-left pans left', () => {
  const pose = computeAudioListenerPose({
    cameraMode: 'iso',
    playerX: 28,
    playerY: 28,
    facingAngle: 1.2, // player aiming angle should NOT spin ISO camera stereo field
    fpsPitch: 0,
  });

  assert.equal(pose.forwardX, ISO_LISTENER_FORWARD_X);
  assert.equal(pose.forwardZ, ISO_LISTENER_FORWARD_Z);

  // In ISO, +X -Y (i.e. +x, -z in Three.js) is screen-right
  const screenRight = computeListenerRightSign(pose, { x: 33, y: 23, height: pose.y });
  assert.ok(screenRight.pan > 0.99);

  // In ISO, -X +Y (i.e. -x, +z in Three.js) is screen-left
  const screenLeft = computeListenerRightSign(pose, { x: 23, y: 33, height: pose.y });
  assert.ok(screenLeft.pan < -0.99);

  // In ISO, -X -Y is screen-up (directly forward, pan ~ 0)
  const screenUp = computeListenerRightSign(pose, { x: 23, y: 23, height: pose.y });
  assert.ok(Math.abs(screenUp.pan) < 1e-5);
});

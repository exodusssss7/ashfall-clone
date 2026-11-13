import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleRelativeTouchInput } from './drivingControls';
import { generateWorld, stepVehiclePhysics } from './survivalLogic';

test('stick maps up/down to throttle and left/right to steering independently', () => {
  assert.deepEqual(vehicleRelativeTouchInput(0, -1), { throttle: 1, steer: 0 });
  assert.deepEqual(vehicleRelativeTouchInput(0, 1), { throttle: -1, steer: 0 });
  assert.deepEqual(vehicleRelativeTouchInput(-1, 0), { throttle: 0, steer: -1 });
  assert.deepEqual(vehicleRelativeTouchInput(1, 0), { throttle: 0, steer: 1 });
  assert.deepEqual(vehicleRelativeTouchInput(1, -1), { throttle: 1, steer: 1 });
});

test('axis deadzones prevent drift; analog strength is bounded and continuous', () => {
  assert.deepEqual(vehicleRelativeTouchInput(.15, -.15), { throttle: 0, steer: 0 });
  const mid = vehicleRelativeTouchInput(.58, -.58);
  assert.ok(Math.abs(mid.throttle - .5) < 1e-10);
  assert.ok(Math.abs(mid.steer - .5) < 1e-10);
  assert.deepEqual(vehicleRelativeTouchInput(2, -2), { throttle: 1, steer: 1 });
  assert.equal(vehicleRelativeTouchInput(.1, -1).steer, 0);
});

test('forward and reverse track each car heading, with no camera-heading snap', () => {
  const base = generateWorld(1994).vehicles[0];
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2, .73]) {
    for (const y of [-1, 1]) {
      let car = { ...base, angle, speed: 0, vx: 0, vy: 0, fuel: 100 };
      const input = vehicleRelativeTouchInput(0, y);
      for (let i = 0; i < 20; i++) car = stepVehiclePhysics(car, input.throttle, input.steer, false, .05);
      assert.equal(car.angle, angle);
      const alongNose = car.vx * Math.cos(angle) + car.vy * Math.sin(angle);
      assert.ok(y < 0 ? alongNose > 0 : alongNose < 0);
      assert.ok(Math.abs(car.vx * Math.sin(angle) - car.vy * Math.cos(angle)) < 1e-8);
    }
  }
});

test('wheel steering has the same local turn at every heading and reverses yaw when backing', () => {
  const base = generateWorld(1994).vehicles[0];
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const x of [-1, 1]) {
      for (const speed of [-3, 3]) {
        const input = vehicleRelativeTouchInput(x, speed > 0 ? -1 : 1);
        const next = stepVehiclePhysics({ ...base, angle, speed }, input.throttle, input.steer, false, .05);
        assert.equal(Math.sign(next.angle - angle), Math.sign(x * speed));
      }
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MELEE_WEAPON_IDS } from './recipes';
import {
  computeWeaponEdgeCameraDir,
  evaluateFirstPersonMeleePose,
  evaluateThirdPersonMeleePose,
  getFirstPersonMeleeGripPose,
  getMeleeWeaponFamily,
} from './meleeAnimation';

test('all melee weapon grips orient striking edge forward toward crosshair rather than straight downward', () => {
  for (const weapon of MELEE_WEAPON_IDS) {
    const grip = getFirstPersonMeleeGripPose(weapon);
    const dir = computeWeaponEdgeCameraDir(grip);
    assert.ok(
      dir.forward > 0.65,
      `${weapon} striking edge forward component (${dir.forward.toFixed(3)}) must face into screen`
    );
    assert.ok(
      dir.up > -0.65,
      `${weapon} striking edge should not point steeply downward (up=${dir.up.toFixed(3)})`
    );
  }
});

test('evaluateFirstPersonMeleePose follows windup -> snap strike -> follow-through -> clean rest', () => {
  const idleStart = evaluateFirstPersonMeleePose({
    weapon: 'axe',
    progress: 0,
    comboStep: 0,
    hasHit: false,
  });
  const windUp = evaluateFirstPersonMeleePose({
    weapon: 'axe',
    progress: 0.14,
    comboStep: 0,
    hasHit: false,
  });
  const strikeMid = evaluateFirstPersonMeleePose({
    weapon: 'axe',
    progress: 0.36,
    comboStep: 0,
    hasHit: false,
  });
  const idleEnd = evaluateFirstPersonMeleePose({
    weapon: 'axe',
    progress: 1,
    comboStep: 0,
    hasHit: false,
  });

  assert.equal(idleStart.armRotX, 0);
  assert.equal(idleEnd.armRotX, 0);
  assert.ok(windUp.armRotX > 0.2, 'Axe winds up upward/back before chopping');
  assert.ok(strikeMid.armRotX < -0.45, 'Axe snaps forward/down during active strike');
  assert.equal(strikeMid.slashVisible, true);
  assert.ok(strikeMid.slashAlpha > 0.5);
  assert.equal(idleEnd.slashVisible, false);
});

test('slashing weapons alternate forehand and backhand combo swings while heavy chop/crush stay distinct', () => {
  assert.equal(getMeleeWeaponFamily('machete'), 'slash');
  assert.equal(getMeleeWeaponFamily('sledgehammer'), 'heavy_crush');
  assert.equal(getMeleeWeaponFamily('axe'), 'heavy_chop');

  const forehand = evaluateFirstPersonMeleePose({
    weapon: 'machete',
    progress: 0.36,
    comboStep: 0,
    hasHit: false,
  });
  const backhand = evaluateFirstPersonMeleePose({
    weapon: 'machete',
    progress: 0.36,
    comboStep: 1,
    hasHit: false,
  });

  assert.equal(forehand.slashFlipX, false);
  assert.equal(backhand.slashFlipX, true);
  assert.ok(forehand.armRotY > 0.2, 'Forehand sweeps left across screen');
  assert.ok(backhand.armRotY < -0.2, 'Backhand sweeps right across screen');
  assert.ok(backhand.wristRollX < -1.0, 'Backhand rolls blade so sharp edge still leads');

  const sledge = evaluateFirstPersonMeleePose({
    weapon: 'sledgehammer',
    progress: 0.36,
    comboStep: 0,
    hasHit: false,
  });
  assert.ok(Math.abs(sledge.slashAngleZ) > 1.2, 'Sledgehammer uses steep vertical crush trail');
  assert.ok(sledge.camPitchOffset < -0.02, 'Sledgehammer delivers downward camera swing punch');
});

test('impact hit confirmation adds physical bounce deflection compared to air swing', () => {
  const airSwing = evaluateFirstPersonMeleePose({
    weapon: 'barbed_bat',
    progress: 0.39,
    comboStep: 0,
    hasHit: false,
  });
  const hitSwing = evaluateFirstPersonMeleePose({
    weapon: 'barbed_bat',
    progress: 0.39,
    comboStep: 0,
    hasHit: true,
  });

  assert.notEqual(hitSwing.wristPitchZ, airSwing.wristPitchZ);
  assert.notEqual(hitSwing.armRotY, airSwing.armRotY);

  const tp = evaluateThirdPersonMeleePose({
    weapon: 'axe',
    progress: 0.38,
    comboStep: 0,
  });
  assert.ok(tp.arcOpacity > 0.4);
});

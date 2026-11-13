import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionPose,
  getLootOpenStage,
  getLootPopTransform,
  getZombieDyingFrame,
  resolvePlayerAnimState,
  resolveZombieAnimState,
} from './actionAnimation';
import {createInitialPlayer,tickSurvivalNeeds,useConsumableItem,createInitialInventory} from './survivalLogic';
test('action poses advance, remain finite and clamp at both ends',()=>{
 for(const remaining of [3,2,1.5,1,.5,0,-1]){
  const pose=actionPose({kind:'heal',label:'HEAL',duration:2,remaining});
  assert.ok(pose.progress>=0&&pose.progress<=1);assert.ok(Number.isFinite(pose.pulse));
 }
 assert.notDeepEqual(actionPose({kind:'craft',label:'',duration:2,remaining:1.7}),actionPose({kind:'craft',label:'',duration:2,remaining:1.4}));
});
test('survivor has no stamina resource before or after extended sprinting',()=>{
 let p=createInitialPlayer();for(let i=0;i<100;i++)p=tickSurvivalNeeds(p,.1,true,false);
 assert.equal('stamina' in p,false);assert.equal('maxStamina' in p,false);
});
test('water has no hidden stamina effect or waste at full hydration',()=>{
 const p={...createInitialPlayer(),thirst:100};assert.equal(useConsumableItem(p,createInitialInventory(),'water').used,false);
});

test('getLootOpenStage maps unsearched and searched progress to 0..3 sprite stages', () => {
  assert.equal(getLootOpenStage(false, 0), 0);
  assert.equal(getLootOpenStage(false, 0.9), 0);
  assert.equal(getLootOpenStage(true, 0.05), 1);
  assert.equal(getLootOpenStage(true, 0.45), 2);
  assert.equal(getLootOpenStage(true, 0.8), 3);
  assert.equal(getLootOpenStage(true, 1.0), 3);
});

test('getLootPopTransform produces finite squash/stretch bounce during popTimer and neutral rest afterwards', () => {
  assert.deepEqual(getLootPopTransform(0), { scaleX: 1, scaleY: 1, offsetY: 0 });
  const mid = getLootPopTransform(0.32, 0.48);
  assert.ok(Number.isFinite(mid.scaleX) && Number.isFinite(mid.scaleY) && Number.isFinite(mid.offsetY));
  assert.ok(mid.offsetY <= 0);
  assert.ok(Math.abs(mid.scaleX - 1) > 0.01);
});

test('resolvePlayerAnimState prioritizes dodge, attack, walk, and idle cleanly', () => {
  assert.equal(
    resolvePlayerAnimState({
      dodgeTimer: 0.12,
      meleeSwingTimer: 0.1,
      attackCooldown: 0.5,
      attackCooldownMax: 0.5,
      walkCycle: 2,
    }),
    'dodge'
  );
  assert.equal(
    resolvePlayerAnimState({
      dodgeTimer: 0,
      meleeSwingTimer: 0.12,
      attackCooldown: 0.1,
      attackCooldownMax: 0.4,
      walkCycle: 2,
    }),
    'attack'
  );
  assert.equal(
    resolvePlayerAnimState({
      dodgeTimer: 0,
      meleeSwingTimer: 0,
      attackCooldown: 0.35,
      attackCooldownMax: 0.5,
      walkCycle: 0,
    }),
    'attack'
  );
  assert.equal(
    resolvePlayerAnimState({
      dodgeTimer: 0,
      meleeSwingTimer: 0,
      attackCooldown: 0,
      attackCooldownMax: 0.5,
      walkCycle: 1.5,
    }),
    'walk'
  );
  assert.equal(
    resolvePlayerAnimState({
      dodgeTimer: 0,
      meleeSwingTimer: 0,
      attackCooldown: 0,
      attackCooldownMax: 0.5,
      walkCycle: 0,
    }),
    'idle'
  );
});

test('resolveZombieAnimState and getZombieDyingFrame map all AI states accurately', () => {
  assert.equal(resolveZombieAnimState({ state: 'dying', isMoving: true }), 'dying');
  assert.equal(resolveZombieAnimState({ state: 'windup', isMoving: false }), 'windup');
  assert.equal(resolveZombieAnimState({ state: 'attack', isMoving: false }), 'attack');
  assert.equal(resolveZombieAnimState({ state: 'chase', isMoving: true }), 'walk');
  assert.equal(resolveZombieAnimState({ state: 'recover', isMoving: false }), 'idle');

  assert.equal(getZombieDyingFrame(0.50, 0.52), 0);
  assert.equal(getZombieDyingFrame(0.28, 0.52), 1);
  assert.equal(getZombieDyingFrame(0.05, 0.52), 2);
});


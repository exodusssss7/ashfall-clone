import test from 'node:test';
import assert from 'node:assert/strict';
import { tickSprintBreathing } from './sprintBreathing';
const idle = { sprintSeconds: 0, wasSprinting: false };
test('breathing starts only after sustained sprint ends', () => {
  const running = tickSprintBreathing(idle, true, true, 3);
  assert.equal(running.playSeconds, 0);
  const end = tickSprintBreathing(running.state, false, true, .1);
  assert.ok(end.playSeconds > 3 && end.playSeconds <= 6);
  assert.equal(tickSprintBreathing(end.state, false, true, 1).playSeconds, 0);
});
test('short taps, idle and inactive gameplay do not trigger recovery', () => {
  assert.equal(tickSprintBreathing(idle, false, true, 1).playSeconds, 0);
  const tap = tickSprintBreathing(idle, true, true, .5);
  assert.equal(tickSprintBreathing(tap.state, false, true, .1).playSeconds, 0);
  assert.deepEqual(tickSprintBreathing({sprintSeconds:8,wasSprinting:true},false,false,1).state,idle);
});
test('long sprints have bounded recovery', () => {
  const run = tickSprintBreathing(idle,true,true,100);
  assert.equal(run.state.sprintSeconds,12);
  assert.equal(tickSprintBreathing(run.state,false,true,.1).playSeconds,6);
});

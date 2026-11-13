import test from 'node:test';
import assert from 'node:assert/strict';
import { ambienceMix } from './audioMix';
test('ambience follows existing day and night clock', () => {
  assert.ok(ambienceMix(720).day > .999);
  assert.ok(ambienceMix(720).night < .001);
  assert.ok(ambienceMix(0).night > .999);
  assert.ok(ambienceMix(0).day < .001);
  assert.deepEqual(ambienceMix(1440), ambienceMix(0));
});
test('dawn/dusk use a continuous equal-power crossfade', () => {
  for (const m of [330,360,390,420,450,1080,1110,1140,1170,1200]) {
    const mix = ambienceMix(m);
    assert.ok(Math.abs(mix.day ** 2 + mix.night ** 2 - 1) < 1e-10);
    const next = ambienceMix(m + .01);
    assert.ok(Math.abs(mix.night - next.night) < .001);
  }
  assert.ok(ambienceMix(390).day > .7 && ambienceMix(390).night > .7);
  assert.ok(ambienceMix(1140).day > .7 && ambienceMix(1140).night > .7);
});

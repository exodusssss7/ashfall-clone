import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceQteCursor,
  evaluateQteBeat,
  getCookingQteSpec,
  resolveCookingOutcome,
} from './cookingQte';
import { COOK_RECIPES } from './recipes';

test('every cook recipe has an accessible multi-beat QTE spec with wide sweet spots and gentle speed', () => {
  for (const recipe of COOK_RECIPES) {
    const spec = getCookingQteSpec(recipe.id);
    assert.equal(spec.recipeId, recipe.id);
    assert.ok(spec.beats.length >= 2 && spec.beats.length <= 3, `${recipe.id} should have 2-3 beats`);
    for (const beat of spec.beats) {
      assert.ok(beat.targetCenter > 0.25 && beat.targetCenter < 0.75);
      assert.ok(beat.goodWidth >= 0.36, 'good zone should be generously wide');
      assert.ok(beat.perfectWidth >= 0.14 && beat.perfectWidth < beat.goodWidth);
      assert.ok(beat.speed > 0.4 && beat.speed <= 0.85, 'needle speed should stay smooth and readable');
    }
  }
});

test('advanceQteCursor ping-pongs cleanly off 0 and 1 bounds', () => {
  const rightBounce = advanceQteCursor(0.96, 1, 2.0, 0.05);
  assert.equal(rightBounce.dir, -1);
  assert.ok(rightBounce.cursor >= 0 && rightBounce.cursor <= 1);
  assert.ok(Math.abs(rightBounce.cursor - 0.94) < 1e-6);

  const leftBounce = advanceQteCursor(0.03, -1, 2.0, 0.05);
  assert.equal(leftBounce.dir, 1);
  assert.ok(Math.abs(leftBounce.cursor - 0.07) < 1e-6);
});

test('evaluateQteBeat classifies perfect, good, and miss accurately', () => {
  const beat = { targetCenter: 0.5, goodWidth: 0.40, perfectWidth: 0.16 };
  assert.equal(evaluateQteBeat(0.5, beat).judgement, 'perfect');
  assert.equal(evaluateQteBeat(0.57, beat).judgement, 'perfect');
  assert.equal(evaluateQteBeat(0.65, beat).judgement, 'good');
  assert.equal(evaluateQteBeat(0.32, beat).judgement, 'good');
  assert.equal(evaluateQteBeat(0.80, beat).judgement, 'miss');
  assert.equal(evaluateQteBeat(0.15, beat).judgement, 'miss');
});

test('resolveCookingOutcome rewards x2 yield on prime, x1 + warmth HP on good, and never deletes ingredients on miss', () => {
  const prime2 = resolveCookingOutcome(['perfect', 'perfect'], 1);
  assert.equal(prime2.grade, 'perfect');
  assert.equal(prime2.outputAmount, 2);
  assert.equal(prime2.bonusHp, 8);

  const primeMixed = resolveCookingOutcome(['perfect', 'good'], 1);
  assert.equal(primeMixed.grade, 'perfect');
  assert.equal(primeMixed.outputAmount, 2);

  const goodFromSingle = resolveCookingOutcome(['miss', 'good', 'miss'], 1);
  assert.equal(goodFromSingle.grade, 'good');
  assert.equal(goodFromSingle.outputAmount, 1);
  assert.equal(goodFromSingle.bonusHp, 4);

  const salvaged = resolveCookingOutcome(['miss', 'miss'], 1);
  assert.equal(salvaged.grade, 'burnt');
  assert.equal(salvaged.outputAmount, 1);
  assert.equal(salvaged.bonusHp, 1);
});

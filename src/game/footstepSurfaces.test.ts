import test from 'node:test';
import assert from 'node:assert/strict';
import { footstepSurfaceForTile as surface } from './footstepSurfaces';
test('hard street surfaces stay concrete, including crosswalks', () => {
  for (const tile of ['road','sidewalk','crosswalk'] as const) assert.equal(surface(tile),'concrete');
});
test('interior floors, porch and pier use their actual material', () => {
  for (const tile of ['floor','floor_porch','pier'] as const) assert.equal(surface(tile),'planks');
  for (const tile of ['floor_bath','tile_clinic','tile_diner'] as const) assert.equal(surface(tile),'tile');
  assert.equal(surface('floor_rug'),'carpet');
});
test('grass and dirt differ; impassable water has no footsteps', () => {
  assert.equal(surface('grass'),'grass');assert.equal(surface('dirt'),'dirt');assert.equal(surface('water'),null);
});

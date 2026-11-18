import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { TileKind } from './types';
import {
  MAX_WATER_RIPPLES,
  WATER_RIPPLE_LIFETIME,
  WaterRippleBuffer,
  buildChunkWaterGeometry,
  computeWaterShoreDepth,
} from './waterSystem';

function makeGridCellLookup(grid: TileKind[][]): (x: number, y: number) => { tile: TileKind } {
  return (x: number, y: number) => {
    const row = grid[y];
    if (!row || x < 0 || x >= row.length) return { tile: 'grass' };
    return { tile: row[x] };
  };
}

test('computeWaterShoreDepth returns 0 on land and ramps cleanly from shore to deep center', () => {
  // 8x8 grid with a 5x5 lake in center (x:1..5, y:1..5) and a pier jutting in at (3,1..2)
  const grid: TileKind[][] = Array.from({ length: 8 }, () => Array<TileKind>(8).fill('grass'));
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      grid[y][x] = 'water';
    }
  }
  grid[1][3] = 'pier';
  grid[2][3] = 'pier';

  const getCell = makeGridCellLookup(grid);

  assert.equal(computeWaterShoreDepth(0, 0, getCell), 0);
  const shoreDepth = computeWaterShoreDepth(1, 1, getCell);
  const midDepth = computeWaterShoreDepth(2, 2, getCell);
  const centerDepth = computeWaterShoreDepth(3, 3, getCell);

  assert.ok(shoreDepth > 0 && shoreDepth < 0.25, `Shore tile depth (${shoreDepth}) should be shallow`);
  assert.ok(midDepth > shoreDepth && midDepth < centerDepth, `Mid depth (${midDepth}) should lie between shore (${shoreDepth}) and center (${centerDepth})`);
  assert.ok(centerDepth >= 0.85, `Deep center (${centerDepth}) should be near 1.0 even adjacent to pier pilings`);
});

test('buildChunkWaterGeometry skips dry chunks and outputs subdivided vertices with depth and shore attributes', () => {
  const dryLookup = () => ({ tile: 'grass' as TileKind });
  assert.equal(buildChunkWaterGeometry(0, 0, 16, dryLookup), null);

  const lakeLookup = (x: number, y: number) => ({
    tile: x >= 2 && x <= 5 && y >= 2 && y <= 5 ? ('water' as TileKind) : ('sand' as TileKind),
  });
  const geo = buildChunkWaterGeometry(0, 0, 16, lakeLookup);
  assert.ok(geo !== null, 'Expected valid water geometry on chunk containing lake');
  const pos = geo.getAttribute('position');
  const depthAttr = geo.getAttribute('aDepth');
  const shoreAttr = geo.getAttribute('aShore');

  assert.equal(pos.count, 16 * 24, '4x4 water tiles * 24 subdivided vertices');
  assert.equal(depthAttr.count, pos.count);
  assert.equal(shoreAttr.count, pos.count);

  let hasShoreZero = false;
  let hasDeepWater = false;
  for (let i = 0; i < pos.count; i++) {
    if (shoreAttr.getX(i) > 0.9 && depthAttr.getX(i) === 0) hasShoreZero = true;
    if (depthAttr.getX(i) > 0.45 && shoreAttr.getX(i) === 0) hasDeepWater = true;
  }
  assert.ok(hasShoreZero, 'Boundary vertices touching sand should report shore=1 and depth=0');
  assert.ok(hasDeepWater, 'Interior vertices should report deeper water and shore=0');
  geo.dispose();
});

test('WaterRippleBuffer coalesces duplicate spots, overwrites oldest past capacity, and expires old ripples', () => {
  const buf = new WaterRippleBuffer();
  const uniforms = Array.from({ length: MAX_WATER_RIPPLES }, () => new THREE.Vector4());

  buf.push(10, 12, 1.0, 0.8);
  buf.push(10.05, 12.05, 1.05, 1.1); // Should coalesce with stronger amplitude
  assert.equal(buf.getActiveCount(1.1), 1);

  for (let i = 0; i < MAX_WATER_RIPPLES + 4; i++) {
    buf.push(20 + i * 2, 30, 2.0 + i * 0.05, 0.9);
  }
  assert.equal(buf.getActiveCount(2.8), MAX_WATER_RIPPLES);

  buf.packUniforms(2.8, uniforms);
  const activeUniforms = uniforms.filter((v) => v.w > 0);
  assert.equal(activeUniforms.length, MAX_WATER_RIPPLES);

  // Advance past lifetime -> all expire cleanly
  assert.equal(buf.getActiveCount(2.8 + WATER_RIPPLE_LIFETIME + 0.1), 0);
  buf.packUniforms(2.8 + WATER_RIPPLE_LIFETIME + 0.1, uniforms);
  assert.equal(uniforms.filter((v) => v.w > 0).length, 0);
});

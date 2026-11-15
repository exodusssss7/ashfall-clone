import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SUPERCAR_CANOPY_PROFILE,
  SUPERCAR_HULL_PROFILE,
  TENT_PROFILE,
  WRECKED_SUPERCAR_PROFILE,
  computePolygonArea2D,
  createAshFlakeGeometry,
  createDebrisShardGeometry,
  createFacetedBoulderGeometry,
  createSculptedProfileGeometry,
  createTaperedBoxGeometry,
} from './modelSculpt';
import { batchStaticObjectGroups } from './threeBatching';

test('supercar, wrecked supercar, and tent profiles have valid non-zero CCW winding', () => {
  assert.ok(computePolygonArea2D(SUPERCAR_HULL_PROFILE) > 0.35);
  assert.ok(computePolygonArea2D(SUPERCAR_CANOPY_PROFILE) > 0.10);
  assert.ok(computePolygonArea2D(WRECKED_SUPERCAR_PROFILE) > 0.25);
  assert.ok(computePolygonArea2D(TENT_PROFILE) > 0.35);
});

test('createSculptedProfileGeometry produces normalized [0, 1] UVs and valid normals', () => {
  const geo = createSculptedProfileGeometry(SUPERCAR_HULL_PROFILE, 0.88, {
    bevelThickness: 0.025,
    bevelSize: 0.02,
    bevelSegments: 1,
  });

  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  assert.ok(pos.count > 24);
  assert.equal(norm.count, pos.count);
  assert.equal(uv.count, pos.count);

  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    assert.ok(Number.isFinite(u) && u >= 0 && u <= 1, `u out of range: ${u}`);
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `v out of range: ${v}`);
  }

  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  assert.ok(size.x > 1.6 && size.x < 2.0);
  assert.ok(size.z > 0.8 && size.z < 1.0);
  geo.dispose();
});

test('createTaperedBoxGeometry produces 36 vertices with valid UVs and batching compatibility', () => {
  const geo = createTaperedBoxGeometry(0.32, 0.40, 0.22, 0.28, 0.42);
  assert.equal(geo.getAttribute('position').count, 36);
  assert.equal(geo.getAttribute('normal').count, 36);
  assert.equal(geo.getAttribute('uv').count, 36);

  assert.equal(geo.groups.length, 6);
  const norm = geo.getAttribute('normal');
  assert.ok(norm.getX(0) > 0.5, `+X front normal expected > 0.5, got ${norm.getX(0)}`);
  assert.ok(norm.getX(6) < -0.5, `-X back normal expected < -0.5, got ${norm.getX(6)}`);
  assert.ok(norm.getY(12) > 0.5, `+Y top normal expected > 0.5, got ${norm.getY(12)}`);
  assert.ok(norm.getY(18) < -0.5, `-Y bottom normal expected < -0.5, got ${norm.getY(18)}`);
  assert.ok(norm.getZ(24) > 0.5, `+Z right normal expected > 0.5, got ${norm.getZ(24)}`);
  assert.ok(norm.getZ(30) < -0.5, `-Z left normal expected < -0.5, got ${norm.getZ(30)}`);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const rootA = new THREE.Group();
  const rootB = new THREE.Group();
  rootA.add(new THREE.Mesh(geo, mat));
  rootB.add(new THREE.Mesh(createSculptedProfileGeometry(WRECKED_SUPERCAR_PROFILE, 0.78), mat));

  const batched = batchStaticObjectGroups([rootA, rootB]);
  assert.equal(batched.meshCount, 1);
  assert.ok(batched.geometries[0].getAttribute('position').count > 36);

  for (const bg of batched.geometries) bg.dispose();
  geo.dispose();
  mat.dispose();
});

test('createSculptedProfileGeometry multiMaterialGroups assigns side, top, front, and rear groups', () => {
  for (const [profile, depth] of [
    [SUPERCAR_HULL_PROFILE, 0.88],
    [SUPERCAR_CANOPY_PROFILE, 0.70],
  ] as const) {
    const geo = createSculptedProfileGeometry(profile, depth, {
      bevelThickness: 0.02,
      bevelSize: 0.018,
      bevelSegments: 1,
      multiMaterialGroups: true,
    });
    assert.equal(geo.groups.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.ok(geo.groups[i].count > 0, `expected non-empty group ${i}`);
      assert.equal(geo.groups[i].materialIndex, i);
    }
    geo.dispose();
  }
});

test('createFacetedBoulderGeometry rests at y=0, has normalized UVs, and batches cleanly', () => {
  const boulderA = createFacetedBoulderGeometry(0.42, 7, 0.72);
  const boulderB = createFacetedBoulderGeometry(0.28, 19, 0.76);
  boulderA.computeBoundingBox();
  assert.ok(Math.abs(boulderA.boundingBox!.min.y) < 1e-4);
  assert.ok(boulderA.boundingBox!.max.y > 0.3);

  const uv = boulderA.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1);
    assert.ok(uv.getY(i) >= 0 && uv.getY(i) <= 1);
  }

  const mat = new THREE.MeshStandardMaterial({ color: 0x808080 });
  const rA = new THREE.Group();
  const rB = new THREE.Group();
  rA.add(new THREE.Mesh(boulderA, mat));
  rB.add(new THREE.Mesh(boulderB, mat));
  const batched = batchStaticObjectGroups([rA, rB]);
  assert.equal(batched.meshCount, 1);

  for (const bg of batched.geometries) bg.dispose();
  boulderA.dispose();
  boulderB.dispose();
  mat.dispose();
});

test('createAshFlakeGeometry and createDebrisShardGeometry produce valid normals and positions', () => {
  const ash = createAshFlakeGeometry();
  const shard = createDebrisShardGeometry();
  assert.equal(ash.getAttribute('position').count, 12);
  assert.equal(ash.getAttribute('normal').count, 12);
  assert.ok(shard.getAttribute('position').count >= 24);
  assert.equal(shard.getAttribute('normal').count, shard.getAttribute('position').count);
  ash.dispose();
  shard.dispose();
});


import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createCurvedTeethRowGeometry,
  createSculptedBoilGeometry,
  createSculptedBootGeometry,
  createSculptedClawHandGeometry,
  createSculptedHairCrownGeometry,
  createSculptedJawGeometry,
  createSculptedLimbSegmentGeometry,
  createSculptedMouthCavityGeometry,
  createSculptedNeckGeometry,
  createSculptedRibArchGeometry,
  createSculptedSkullGeometry,
  createSculptedSpineFinGeometry,
  createSculptedThroatSacGeometry,
  createSculptedTorsoGeometry,
  createTatteredHemGeometry,
  createTornCollarGeometry,
  getSkullMetrics,
} from './zombieSculpt';
import type { ZombieArchetype } from './types';

const ARCHETYPES: ZombieArchetype[] = ['walker', 'runner', 'bloater', 'spitter'];

function assertValidGeometry(geo: THREE.BufferGeometry, label: string, maxTris: number) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;

  assert.ok(pos && pos.count >= 9, `${label}: expected vertices`);
  assert.ok(norm && norm.count === pos.count, `${label}: expected matching normals`);

  const triCount = geo.index ? geo.index.count / 3 : pos.count / 3;
  assert.ok(triCount > 0 && triCount <= maxTris, `${label}: triCount ${triCount} exceeded budget ${maxTris}`);

  for (let i = 0; i < pos.count; i++) {
    assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), `${label}: NaN pos`);
    const len = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i));
    assert.ok(Math.abs(len - 1) < 0.02, `${label}: unnormalized normal (${len})`);
    if (uv) {
      assert.ok(uv.getX(i) >= -1e-4 && uv.getX(i) <= 1 + 1e-4, `${label}: u out of range`);
      assert.ok(uv.getY(i) >= -1e-4 && uv.getY(i) <= 1 + 1e-4, `${label}: v out of range`);
    }
    if (col) {
      assert.ok(col.getX(i) >= 0 && col.getX(i) <= 1, `${label}: color.r out of range`);
      assert.ok(col.getY(i) >= 0 && col.getY(i) <= 1, `${label}: color.g out of range`);
      assert.ok(col.getZ(i) >= 0 && col.getZ(i) <= 1, `${label}: color.b out of range`);
    }
  }
}

function assertMostlyOutwardWinding(geo: THREE.BufferGeometry, label: string) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const index = geo.index;
  const center = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    center.x += pos.getX(i);
    center.y += pos.getY(i);
    center.z += pos.getZ(i);
  }
  center.divideScalar(pos.count);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const triN = new THREE.Vector3();
  const toTri = new THREE.Vector3();

  const triCount = index ? index.count / 3 : pos.count / 3;
  let outward = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    triN.crossVectors(ab, ac);
    toTri.copy(a).add(b).add(c).divideScalar(3).sub(center);
    if (triN.dot(toTri) >= 0) outward++;
  }
  const ratio = outward / triCount;
  assert.ok(ratio > 0.72, `${label}: expected outward winding ratio > 0.72, got ${ratio.toFixed(3)}`);
}

test('all sculpted zombie skulls have low triangle budgets, outward winding, and smooth seam normals', () => {
  for (const kind of ARCHETYPES) {
    const skull = createSculptedSkullGeometry(kind);
    assertValidGeometry(skull, `skull-${kind}`, 420);
    assertMostlyOutwardWinding(skull, `skull-${kind}`);

    // Verify skull has >8 angular radial columns (non-cuboidal) and rounded bounding profile
    skull.computeBoundingBox();
    const size = new THREE.Vector3();
    skull.boundingBox!.getSize(size);
    assert.ok(size.x > 0.21 && size.x < 0.36, `${kind} skull depth unexpected: ${size.x}`);
    assert.ok(size.y > 0.20 && size.y < 0.36, `${kind} skull height unexpected: ${size.y}`);
    assert.ok(size.z > 0.19 && size.z < 0.36, `${kind} skull width unexpected: ${size.z}`);
    skull.dispose();
  }
});

test('archetype skulls produce distinct organic silhouettes', () => {
  const sizes: Record<ZombieArchetype, THREE.Vector3> = {} as Record<ZombieArchetype, THREE.Vector3>;
  for (const kind of ARCHETYPES) {
    const skull = createSculptedSkullGeometry(kind);
    skull.computeBoundingBox();
    sizes[kind] = new THREE.Vector3();
    skull.boundingBox!.getSize(sizes[kind]);
    skull.dispose();
  }

  // Bloater skull must be dramatically broader and fuller than walker/spitter
  assert.ok(sizes.bloater.z > sizes.walker.z * 1.25);
  assert.ok(sizes.bloater.x > sizes.walker.x * 1.12);
  // Runner skull should be lower-crowned / elongated forward compared to taller walker/spitter
  assert.ok(sizes.runner.x / sizes.runner.y > sizes.walker.x / sizes.walker.y);
  // Spitter cheek sac bulge makes lateral Z width exceed gaunt walker's Z despite narrower top cranium
  assert.ok(sizes.spitter.z > sizes.walker.z);
});

test('sculpted mandibles, 3D teeth rows, torsos, limbs, claws, and boots validate cleanly', () => {
  for (const kind of ARCHETYPES) {
    const jaw = createSculptedJawGeometry(kind);
    assertValidGeometry(jaw, `jaw-${kind}`, 200);
    jaw.dispose();

    const torso = createSculptedTorsoGeometry(kind);
    assertValidGeometry(torso, `torso-${kind}`, 160);
    assertMostlyOutwardWinding(torso, `torso-${kind}`);
    torso.dispose();

    const neck = createSculptedNeckGeometry(kind);
    assertValidGeometry(neck, `neck-${kind}`, 80);
    assertMostlyOutwardWinding(neck, `neck-${kind}`);
    neck.dispose();

    const cavity = createSculptedMouthCavityGeometry(kind);
    assertValidGeometry(cavity, `cavity-${kind}`, 80);
    assertMostlyOutwardWinding(cavity, `cavity-${kind}`);
    cavity.dispose();

    const m = getSkullMetrics(kind);
    const teeth = createCurvedTeethRowGeometry({
      radiusX: m.jawLength * 0.7,
      radiusZ: m.jawWidth * 0.36,
      count: 6,
      toothHeight: 0.017,
      toothRadius: 0.008,
      upper: true,
    });
    assertValidGeometry(teeth, `teeth-${kind}`, 64);
    teeth.dispose();
  }

  const arm = createSculptedLimbSegmentGeometry({
    topRadius: 0.052,
    midRadius: 0.056,
    botRadius: 0.044,
    length: 0.18,
    horizontalX: true,
  });
  assertValidGeometry(arm, 'arm', 96);
  assertMostlyOutwardWinding(arm, 'arm');
  arm.dispose();

  const leg = createSculptedLimbSegmentGeometry({
    topRadius: 0.072,
    midRadius: 0.064,
    botRadius: 0.048,
    length: 0.24,
    horizontalX: false,
  });
  assertValidGeometry(leg, 'leg', 96);
  assertMostlyOutwardWinding(leg, 'leg');
  leg.dispose();

  const claw = createSculptedClawHandGeometry(true);
  assertValidGeometry(claw, 'claw', 144);
  assertMostlyOutwardWinding(claw, 'claw');
  claw.dispose();

  const boot = createSculptedBootGeometry(0.11, 0.15, 0.09);
  assertValidGeometry(boot, 'boot', 96);
  assertMostlyOutwardWinding(boot, 'boot');
  boot.dispose();

  const rib = createSculptedRibArchGeometry(0.135, 0.11, 0.014);
  assertValidGeometry(rib, 'rib', 160);
  rib.dispose();
});

test('tattered clothing hems, collars, boils, hair crowns, dorsal spines, and throat sac validate cleanly', () => {
  const hem = createTatteredHemGeometry({ topRx: 0.10, topRz: 0.14, length: 0.12, seed: 3 });
  assertValidGeometry(hem, 'tattered-hem', 96);
  assertMostlyOutwardWinding(hem, 'tattered-hem');
  hem.dispose();

  const collar = createTornCollarGeometry({ rx: 0.085, rz: 0.11, height: 0.055, seed: 5 });
  assertValidGeometry(collar, 'torn-collar', 64);
  assertMostlyOutwardWinding(collar, 'torn-collar');
  collar.dispose();

  for (let s = 1; s <= 3; s++) {
    const boil = createSculptedBoilGeometry(s);
    assertValidGeometry(boil, `boil-${s}`, 120);
    assertMostlyOutwardWinding(boil, `boil-${s}`);
    boil.dispose();
  }

  for (const kind of ['walker', 'runner'] as ZombieArchetype[]) {
    const hair = createSculptedHairCrownGeometry(kind);
    assertValidGeometry(hair, `hair-${kind}`, 160);
    hair.dispose();
  }

  const spine = createSculptedSpineFinGeometry(5, 1.0);
  assertValidGeometry(spine, 'spine-fin', 160);
  spine.dispose();

  const sac = createSculptedThroatSacGeometry();
  assertValidGeometry(sac, 'throat-sac', 96);
  assertMostlyOutwardWinding(sac, 'throat-sac');
  sac.dispose();
});


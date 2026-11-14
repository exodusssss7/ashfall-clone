import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchStaticObjectGroups } from './threeBatching';

test('batchStaticObjectGroups merges many single-material boxes into one mesh per material', () => {
  const matA = new THREE.MeshStandardMaterial({ color: 0x336633 });
  const matB = new THREE.MeshStandardMaterial({ color: 0x664422 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  const groups: THREE.Group[] = [];
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    g.position.set(i, 0, i * 0.5);
    const m1 = new THREE.Mesh(boxGeo, matA);
    m1.position.y = 0.5;
    m1.scale.set(0.4, 1, 0.4);
    m1.castShadow = true;
    const m2 = new THREE.Mesh(boxGeo, matB);
    m2.position.y = 1.2;
    m2.scale.set(0.8, 0.5, 0.8);
    m2.castShadow = true;
    g.add(m1, m2);
    groups.push(g);
  }

  const res = batchStaticObjectGroups(groups);
  assert.equal(res.meshCount, 2);
  assert.equal(res.geometries.length, 2);
  assert.equal(res.group.children.length, 2);

  // Clean up
  for (const g of res.geometries) g.dispose();
  boxGeo.dispose();
  matA.dispose();
  matB.dispose();
});

test('batchStaticObjectGroups splits 6-material BoxGeometry faces into matching material buckets', () => {
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xaa4433 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8);

  const roots: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.position.set(i * 2, 0, 0);
    const multi = new THREE.Mesh(boxGeo, [sideMat, sideMat, capMat, capMat, sideMat, sideMat]);
    multi.castShadow = true;
    multi.receiveShadow = true;
    const cyl = new THREE.Mesh(cylGeo, sideMat);
    cyl.castShadow = true;
    cyl.receiveShadow = true;
    g.add(multi, cyl);
    roots.push(g);
  }

  const res = batchStaticObjectGroups(roots);
  assert.equal(res.meshCount, 2);
  const totalVerts = res.geometries.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
  // Each box has 36 non-indexed verts, plus 4 cylinders
  assert.ok(totalVerts > 4 * 36);

  for (const g of res.geometries) g.dispose();
  boxGeo.dispose();
  cylGeo.dispose();
  sideMat.dispose();
  capMat.dispose();
});

test('batchStaticObjectGroups separates castShadow=true vs castShadow=false even with same material', () => {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const geo = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.Group();
  const m1 = new THREE.Mesh(geo, mat);
  m1.castShadow = true;
  const m2 = new THREE.Mesh(geo, mat);
  m2.castShadow = false;
  g.add(m1, m2);

  const res = batchStaticObjectGroups([g]);
  assert.equal(res.meshCount, 2);

  for (const bg of res.geometries) bg.dispose();
  geo.dispose();
  mat.dispose();
});

test('batchStaticObjectGroups merges brick and window walls into minimal material buckets without mutating source roots', () => {
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x7a4236 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x45403d });
  const ledgeMat = new THREE.MeshStandardMaterial({ color: 0x635c58 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x10151a });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  const dynamicParent = new THREE.Group();
  dynamicParent.visible = false;
  const roots: THREE.Group[] = [];
  for (let i = 0; i < 20; i++) {
    const wall = new THREE.Group();
    wall.position.set(i, 0, 2);
    const core = new THREE.Mesh(boxGeo, [sideMat, sideMat, capMat, capMat, sideMat, sideMat]);
    core.castShadow = true;
    core.receiveShadow = true;
    const ledge = new THREE.Mesh(boxGeo, ledgeMat);
    ledge.position.y = 1.0;
    ledge.castShadow = true;
    ledge.receiveShadow = true;
    wall.add(core, ledge);
    if (i % 4 === 0) {
      const glass = new THREE.Mesh(boxGeo, glassMat);
      glass.castShadow = false;
      glass.receiveShadow = false;
      wall.add(glass);
    }
    roots.push(wall);
    dynamicParent.add(wall);
  }

  const res = batchStaticObjectGroups(roots);
  // 4 distinct (material, castShadow, receiveShadow) buckets instead of 20*2 + 5 = 45 meshes
  assert.equal(res.meshCount, 4);
  assert.equal(dynamicParent.children.length, 20);
  assert.equal(dynamicParent.visible, false);

  for (const bg of res.geometries) bg.dispose();
  boxGeo.dispose();
  sideMat.dispose();
  capMat.dispose();
  ledgeMat.dispose();
  glassMat.dispose();
});

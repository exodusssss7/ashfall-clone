import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface BatchBucket {
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  geos: THREE.BufferGeometry[];
}

export interface BatchResult {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  meshCount: number;
}

const _unitBoxFaces: THREE.BufferGeometry[] | null = (() => {
  const base = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const faces: THREE.BufferGeometry[] = [];
  const posAttr = base.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = base.getAttribute('normal') as THREE.BufferAttribute;
  const uvAttr = base.getAttribute('uv') as THREE.BufferAttribute;

  for (let f = 0; f < 6; f++) {
    const start = f * 6;
    const face = new THREE.BufferGeometry();
    const posArr = new Float32Array(6 * 3);
    const normArr = new Float32Array(6 * 3);
    const uvArr = new Float32Array(6 * 2);
    for (let v = 0; v < 6; v++) {
      const idx = start + v;
      posArr[v * 3] = posAttr.getX(idx);
      posArr[v * 3 + 1] = posAttr.getY(idx);
      posArr[v * 3 + 2] = posAttr.getZ(idx);

      normArr[v * 3] = normAttr.getX(idx);
      normArr[v * 3 + 1] = normAttr.getY(idx);
      normArr[v * 3 + 2] = normAttr.getZ(idx);

      uvArr[v * 2] = uvAttr.getX(idx);
      uvArr[v * 2 + 1] = uvAttr.getY(idx);
    }
    face.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    face.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
    face.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    faces.push(face);
  }
  base.dispose();
  return faces;
})();

function normalizeFragmentGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const nonIdx = geo.index ? geo.toNonIndexed() : geo.clone();
  // Ensure consistent attributes (position, normal, uv) before mergeGeometries
  for (const attrName of Object.keys(nonIdx.attributes)) {
    if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
      nonIdx.deleteAttribute(attrName);
    }
  }
  if (!nonIdx.getAttribute('uv')) {
    const count = nonIdx.getAttribute('position').count;
    nonIdx.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (!nonIdx.getAttribute('normal')) {
    nonIdx.computeVertexNormals();
  }
  return nonIdx;
}

/**
 * Merges an array of static 3D Object3D hierarchies (props or FPS upper wall segments)
 * into minimal draw-call batches keyed by `(material.id, castShadow, receiveShadow)`.
 * Supports both single-material meshes and 6-face multi-material BoxGeometry meshes.
 */
export function batchStaticObjectGroups(roots: THREE.Object3D[]): BatchResult {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  if (roots.length === 0) {
    return { group, geometries, meshCount: 0 };
  }

  const buckets = new Map<string, BatchBucket>();

  const pushFragment = (
    mat: THREE.Material,
    castShadow: boolean,
    receiveShadow: boolean,
    fragmentGeo: THREE.BufferGeometry,
    matrixWorld: THREE.Matrix4
  ) => {
    fragmentGeo.applyMatrix4(matrixWorld);
    const key = `${mat.id}_${castShadow ? 1 : 0}_${receiveShadow ? 1 : 0}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: mat, castShadow, receiveShadow, geos: [] };
      buckets.set(key, bucket);
    }
    bucket.geos.push(fragmentGeo);
  };

  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;

      if (Array.isArray(mesh.material)) {
        // Multi-material BoxGeometry: extract per-face non-indexed slices so each face merges by its material
        if (_unitBoxFaces && mesh.geometry.groups.length === 6 && mesh.material.length >= 6) {
          for (let f = 0; f < 6; f++) {
            const mat = mesh.material[f];
            if (!mat) continue;
            pushFragment(mat, mesh.castShadow, mesh.receiveShadow, _unitBoxFaces[f].clone(), mesh.matrixWorld);
          }
          return;
        }
        // Generic fallback for any other multi-material geometry
        const mat = mesh.material[0];
        if (!mat) return;
        pushFragment(
          mat,
          mesh.castShadow,
          mesh.receiveShadow,
          normalizeFragmentGeometry(mesh.geometry),
          mesh.matrixWorld
        );
        return;
      }

      pushFragment(
        mesh.material,
        mesh.castShadow,
        mesh.receiveShadow,
        normalizeFragmentGeometry(mesh.geometry),
        mesh.matrixWorld
      );
    });
  }

  let meshCount = 0;
  for (const bucket of buckets.values()) {
    if (bucket.geos.length === 0) continue;
    const merged = mergeGeometries(bucket.geos, false);
    for (const frag of bucket.geos) frag.dispose();
    if (!merged) continue;
    geometries.push(merged);
    const batchMesh = new THREE.Mesh(merged, bucket.material);
    batchMesh.castShadow = bucket.castShadow;
    batchMesh.receiveShadow = bucket.receiveShadow;
    batchMesh.matrixAutoUpdate = false;
    batchMesh.updateMatrix();
    group.add(batchMesh);
    meshCount++;
  }

  return { group, geometries, meshCount };
}

import * as THREE from 'three';

export interface ExtrudeProfileOptions {
  bevelThickness?: number;
  bevelSize?: number;
  bevelSegments?: number;
  curveSegments?: number;
  multiMaterialGroups?: boolean;
}

/**
 * Builds a centered, beveled 3D extruded geometry from a 2D (x, y) silhouette
 * and normalizes UVs via tri-planar projection into [0, 1] so high-resolution
 * pixel-art CanvasTextures map crisply without tiling or stretching.
 *
 * When `multiMaterialGroups` is true, triangles are grouped into 4 material slots:
 *   0: side (+/-Z), 1: top/bottom (+/-Y), 2: front (+X), 3: rear (-X).
 */
export function createSculptedProfileGeometry(
  points: ReadonlyArray<readonly [number, number]>,
  depth: number,
  opts: ExtrudeProfileOptions = {}
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, y], idx) => {
    if (idx === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();

  const bevelThickness = opts.bevelThickness ?? 0.02;
  const bevelSize = opts.bevelSize ?? 0.018;
  const bevelSegments = opts.bevelSegments ?? 1;

  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, depth - bevelThickness * 2),
    bevelEnabled: bevelThickness > 0 && bevelSize > 0,
    bevelThickness,
    bevelSize,
    bevelSegments,
    curveSegments: opts.curveSegments ?? 4,
  });

  // Center along Z so depth spans [-depth/2, +depth/2]
  raw.translate(0, 0, -(depth - bevelThickness * 2) * 0.5);

  // Convert to non-indexed for crisp per-face tri-planar UVs & clean normals
  const geo = raw.index ? raw.toNonIndexed() : raw;
  if (geo !== raw) raw.dispose();

  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const spanX = Math.max(1e-4, bb.max.x - bb.min.x);
  const spanY = Math.max(1e-4, bb.max.y - bb.min.y);
  const spanZ = Math.max(1e-4, bb.max.z - bb.min.z);

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);

  const classifyVertex = (i: number): 0 | 1 | 2 | 3 => {
    const nx = norm.getX(i);
    const ny = norm.getY(i);
    const nz = norm.getZ(i);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    if (az >= ax && az >= ay) return 0; // +/-Z side
    if (ay >= ax && ay >= az) return 1; // +/-Y top/bottom
    return nx >= 0 ? 2 : 3; // +X front, -X rear
  };

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const bucket = classifyVertex(i);

    let u = 0;
    let v = 0;
    if (bucket === 0) {
      u = (x - bb.min.x) / spanX;
      v = (y - bb.min.y) / spanY;
    } else if (bucket === 1) {
      u = (x - bb.min.x) / spanX;
      v = (z - bb.min.z) / spanZ;
    } else {
      u = (z - bb.min.z) / spanZ;
      v = (y - bb.min.y) / spanY;
    }
    uv[i * 2] = Math.min(1, Math.max(0, u));
    uv[i * 2 + 1] = Math.min(1, Math.max(0, v));
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  if (opts.multiMaterialGroups) {
    const buckets: [number[], number[], number[], number[]] = [[], [], [], []];
    for (let t = 0; t + 2 < pos.count; t += 3) {
      const b = classifyVertex(t);
      buckets[b].push(t, t + 1, t + 2);
    }
    const newPos = new Float32Array(pos.count * 3);
    const newUv = new Float32Array(pos.count * 2);
    geo.clearGroups();
    let writeIdx = 0;
    for (let gIdx = 0; gIdx < 4; gIdx++) {
      const list = buckets[gIdx];
      const start = writeIdx;
      for (const srcIdx of list) {
        newPos[writeIdx * 3] = pos.getX(srcIdx);
        newPos[writeIdx * 3 + 1] = pos.getY(srcIdx);
        newPos[writeIdx * 3 + 2] = pos.getZ(srcIdx);
        newUv[writeIdx * 2] = uv[srcIdx * 2];
        newUv[writeIdx * 2 + 1] = uv[srcIdx * 2 + 1];
        writeIdx++;
      }
      geo.addGroup(start, list.length, gIdx);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(newUv, 2));
  }

  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a tapered 3D frustum/prism from y = 0..height (or centered on Y)
 * with normalized [0, 1] UVs per face for sculpted limbs, torsos, jaws, and aero fins.
 */
export function createTaperedBoxGeometry(
  topW: number,
  topD: number,
  botW: number,
  botD: number,
  height: number,
  centerY = false
): THREE.BufferGeometry {
  const y0 = centerY ? -height * 0.5 : 0;
  const y1 = centerY ? height * 0.5 : height;
  const hwT = topW * 0.5;
  const hdT = topD * 0.5;
  const hwB = botW * 0.5;
  const hdB = botD * 0.5;

  // 8 corners: bottom 0..3, top 4..7
  const c: Array<[number, number, number]> = [
    [-hwB, y0, -hdB], // 0: back-left-bot
    [hwB, y0, -hdB],  // 1: front-left-bot
    [hwB, y0, hdB],   // 2: front-right-bot
    [-hwB, y0, hdB],  // 3: back-right-bot
    [-hwT, y1, -hdT], // 4: back-left-top
    [hwT, y1, -hdT],  // 5: front-left-top
    [hwT, y1, hdT],   // 6: front-right-top
    [-hwT, y1, hdT],  // 7: back-right-top
  ];

  // Quads in outward-facing CCW winding: [bl, br, tr, tl]
  // Order matches THREE.BoxGeometry material groups: [+X, -X, +Y, -Y, +Z, -Z]
  const quads: Array<[number, number, number, number]> = [
    [2, 1, 5, 6], // +X front
    [0, 3, 7, 4], // -X back
    [4, 7, 6, 5], // +Y top
    [0, 1, 2, 3], // -Y bottom
    [3, 2, 6, 7], // +Z right
    [1, 0, 4, 5], // -Z left
  ];

  const positions = new Float32Array(quads.length * 6 * 3);
  const uvs = new Float32Array(quads.length * 6 * 2);

  const quadUV: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const triOrder = [0, 1, 2, 0, 2, 3];

  let vIdx = 0;
  for (const q of quads) {
    for (const ti of triOrder) {
      const pt = c[q[ti]];
      const uv = quadUV[ti];
      positions[vIdx * 3] = pt[0];
      positions[vIdx * 3 + 1] = pt[1];
      positions[vIdx * 3 + 2] = pt[2];
      uvs[vIdx * 2] = uv[0];
      uvs[vIdx * 2 + 1] = uv[1];
      vIdx++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  for (let f = 0; f < quads.length; f++) {
    geo.addGroup(f * 6, 6, f);
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Signed 2D polygon area (positive = counter-clockwise).
 */
export function computePolygonArea2D(points: ReadonlyArray<readonly [number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area * 0.5;
}

/**
 * Sleek mid-engine wedge supercar side silhouette (X = -0.90 rear to +0.90 front, Y = ground offset).
 * Counter-clockwise winding for clean front-facing extrusions.
 */
export const SUPERCAR_HULL_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [-0.89, 0.14], // rear diffuser bottom
  [0.86, 0.12],  // front splitter chin
  [0.91, 0.21],  // sharp nose tip
  [0.74, 0.33],  // sloped front hood edge
  [0.36, 0.39],  // cowl / windshield base
  [-0.36, 0.41], // rear deck shoulder
  [-0.84, 0.40], // tail decklip
  [-0.90, 0.26], // rear fascia upper
];

/**
 * Sleek teardrop supercar cockpit canopy profile (X = rear fastback to front windshield).
 */
export const SUPERCAR_CANOPY_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [-0.43, 0.38], // fastback tail base
  [0.38, 0.37],  // raked windshield base
  [0.16, 0.62],  // front roof brow
  [-0.20, 0.62], // rear roof header
];

/**
 * Battle-damaged / collapsed wedge supercar hull profile for roadside wrecked_car props.
 */
export const WRECKED_SUPERCAR_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [-0.82, 0.10],
  [0.80, 0.09],
  [0.83, 0.18],
  [0.62, 0.29],
  [0.28, 0.35],
  [-0.34, 0.37],
  [-0.78, 0.34],
  [-0.83, 0.22],
];

/**
 * Pitched A-frame survivor tent profile (X = width, Y = height from ground).
 * Counter-clockwise winding for clean front-facing extrusions.
 */
export const TENT_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [-0.46, 0.0],
  [0.46, 0.0],
  [0.37, 0.36],
  [0.055, 0.85],
  [-0.055, 0.85],
  [-0.37, 0.36],
];

function deterministicDirHash(x: number, y: number, z: number, seed: number): number {
  const qx = Math.round(x * 1000);
  const qy = Math.round(y * 1000);
  const qz = Math.round(z * 1000);
  const n = Math.sin(qx * 0.1271 + qy * 0.3117 + qz * 0.1973 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Builds a watertight, flat-faceted granite boulder with normalized [0, 1] UVs
 * and base resting cleanly at y = 0 for single-material static chunk batching.
 */
export function createFacetedBoulderGeometry(
  radius: number,
  seed: number,
  squashY = 0.72
): THREE.BufferGeometry {
  const raw = new THREE.IcosahedronGeometry(radius, 1);
  const geo = raw.index ? raw.toNonIndexed() : raw;
  if (geo !== raw) raw.dispose();

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h1 = deterministicDirHash(x, y, z, seed);
    const h2 = deterministicDirHash(z, x, y, seed + 19);
    const scale = 0.76 + h1 * 0.38;
    const nx = x * scale * (0.9 + h2 * 0.2);
    let ny = y * scale * squashY;
    const nz = z * scale * (1.08 - h2 * 0.18);
    if (ny < -radius * 0.34) ny = -radius * 0.34;
    pos.setXYZ(i, nx, ny, nz);
    if (ny < minY) minY = ny;
  }

  geo.translate(0, -minY, 0);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const spanX = Math.max(1e-4, bb.max.x - bb.min.x);
  const spanY = Math.max(1e-4, bb.max.y - bb.min.y);
  const spanZ = Math.max(1e-4, bb.max.z - bb.min.z);

  const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const nz = Math.abs(norm.getZ(i));
    let u = 0;
    let v = 0;
    if (ny >= nx && ny >= nz) {
      u = (x - bb.min.x) / spanX;
      v = (z - bb.min.z) / spanZ;
    } else if (nz >= nx) {
      u = (x - bb.min.x) / spanX;
      v = (y - bb.min.y) / spanY;
    } else {
      u = (z - bb.min.z) / spanZ;
      v = (y - bb.min.y) / spanY;
    }
    uv[i * 2] = Math.min(1, Math.max(0, u));
    uv[i * 2 + 1] = Math.min(1, Math.max(0, v));
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a thin curled diamond ash flake geometry for ambient drifting ashfall/embers.
 */
export function createAshFlakeGeometry(): THREE.BufferGeometry {
  const verts = new Float32Array([
    // Front bent wing
    0, 0.008, 0.055,
    0.048, -0.004, 0,
    0, 0.012, -0.052,
    // Back bent wing
    0, 0.008, 0.055,
    0, 0.012, -0.052,
    -0.046, -0.006, 0.004,
    // Underside (front wing)
    0, 0.008, 0.055,
    0, 0.012, -0.052,
    0.048, -0.004, 0,
    // Underside (back wing)
    0, 0.008, 0.055,
    -0.046, -0.006, 0.004,
    0, 0.012, -0.052,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds an irregular chiseled shard geometry for wood splinters, stone chips, blood drops, and sparks.
 */
export function createDebrisShardGeometry(): THREE.BufferGeometry {
  const raw = new THREE.OctahedronGeometry(0.08, 0);
  const geo = raw.index ? raw.toNonIndexed() : raw;
  if (geo !== raw) raw.dispose();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = deterministicDirHash(x, y, z, 41);
    pos.setXYZ(
      i,
      x * (1.28 + h * 0.25),
      y * (0.68 + (1 - h) * 0.2),
      z * (0.82 + h * 0.22)
    );
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}


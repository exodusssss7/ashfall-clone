import { CHUNK_SIZE, clamp } from './isometric';

/**
 * Cube-Sphere Finite Planetary World System for Ashfall.
 *
 * Replaces unbounded flat 2D world generation with a strictly finite,
 * seamless 6-face spherified cube planet:
 *   - 6 faces x (12 x 12) chunks = 864 total chunks (221,184 tiles)
 *   - Face 0 (+Y, Ashfall Crown) centers the curated starter town (0..63, 0..63)
 *     inside local face coordinates [-64, 128) x [-64, 128).
 *   - Equal-area spherified cube mapping projects every face tile (face, gx, gy)
 *     onto the 3D unit sphere S^2 so 3D noise (elevation, rivers, biomes, highways)
 *     is mathematically seamless across all 12 cube edges and 8 cube corners.
 *   - Crossing any face edge smoothly transitions the player, vehicle, heading,
 *     and local tangent chart onto the adjacent cube face, enabling full
 *     768-tile equatorial and polar circumnavigation with zero invisible walls.
 */

export type CubeFaceId = 0 | 1 | 2 | 3 | 4 | 5;

export const CUBE_FACE_IDS: readonly CubeFaceId[] = [0, 1, 2, 3, 4, 5] as const;
export const CUBE_FACE_CHUNKS = 64; // 64x64 chunks per face (4,096 chunks/face)
export const CUBE_FACE_SIZE = CUBE_FACE_CHUNKS * CHUNK_SIZE; // 1,024 tiles per face
export const CUBE_FACE_MIN_CHUNK = -30; // chunks -30..33 => tiles -480..543 (0..63 starter town sits dead-center!)
export const CUBE_FACE_MAX_CHUNK = 33;
export const CUBE_FACE_MIN_TILE = CUBE_FACE_MIN_CHUNK * CHUNK_SIZE; // -480
export const CUBE_FACE_MAX_TILE = (CUBE_FACE_MAX_CHUNK + 1) * CHUNK_SIZE; // 544 (exclusive)
export const TOTAL_PLANET_CHUNKS = 6 * CUBE_FACE_CHUNKS * CUBE_FACE_CHUNKS; // 24,576 chunks (6,291,456 tiles!)
export const PLANET_CIRCUMFERENCE_TILES = 4 * CUBE_FACE_SIZE; // 4,096 tiles
export const PLANET_RADIUS_TILES = PLANET_CIRCUMFERENCE_TILES / (2 * Math.PI); // ~651.90 tiles
/** Scales 3D spherical noise frequencies proportionally with planet radius so hills, rivers & biomes stay natural. */
export const SPHERE_NOISE_SCALE = PLANET_RADIUS_TILES / 122.23; // ~5.3333

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CubeFaceSpec {
  id: CubeFaceId;
  code: 'CROWN' | 'TIMBER' | 'BADLANDS' | 'BASIN' | 'HIGHLANDS' | 'CALDERA';
  name: string;
  subtitle: string;
  normal: Vec3;
  /** World +gx (East on local chart) direction in 3D cube space */
  uAxis: Vec3;
  /** World +gy (South on local chart) direction in 3D cube space */
  vAxis: Vec3;
  /** Macro climate & threat flavor (blended smoothly on the sphere) */
  threatBias: number;
}

/**
 * Right-handed orthonormal basis for all 6 cube faces (uAxis x vAxis = -normal).
 * Equatorial loop (+u from Face 0): Crown (+Y) -> Timberlands (+X) -> Dead Caldera (-Y) -> Badlands (-X) -> Crown.
 * Meridional loop (+v from Face 0): Crown (+Y) -> River Basin (+Z) -> Dead Caldera (-Y) -> Highlands (-Z) -> Crown.
 */
export const CUBE_FACES: readonly CubeFaceSpec[] = [
  {
    id: 0,
    code: 'CROWN',
    name: 'ASHFALL CROWN',
    subtitle: 'Starter Crossroads & Temperate Ring',
    normal: { x: 0, y: 1, z: 0 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 0, z: 1 },
    threatBias: 0.15,
  },
  {
    id: 1,
    code: 'TIMBER',
    name: 'WHISPERING TIMBERLANDS',
    subtitle: 'Dense Pine Ridges & Rocky Caves',
    normal: { x: 1, y: 0, z: 0 },
    uAxis: { x: 0, y: -1, z: 0 },
    vAxis: { x: 0, y: 0, z: 1 },
    threatBias: 0.45,
  },
  {
    id: 2,
    code: 'BADLANDS',
    name: 'SCORCHED BADLANDS',
    subtitle: 'Cracked Highways & Military Checkpoints',
    normal: { x: -1, y: 0, z: 0 },
    uAxis: { x: 0, y: 1, z: 0 },
    vAxis: { x: 0, y: 0, z: 1 },
    threatBias: 0.65,
  },
  {
    id: 3,
    code: 'BASIN',
    name: 'EMERALD RIVER BASIN',
    subtitle: 'Braided Rivers, Bridges & Camps',
    normal: { x: 0, y: 0, z: 1 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: -1, z: 0 },
    threatBias: 0.40,
  },
  {
    id: 4,
    code: 'HIGHLANDS',
    name: 'FROSTPEAK HIGHLANDS',
    subtitle: 'Terraced Plateaus & Ridge Tunnels',
    normal: { x: 0, y: 0, z: -1 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 1, z: 0 },
    threatBias: 0.55,
  },
  {
    id: 5,
    code: 'CALDERA',
    name: 'THE DEAD CALDERA',
    subtitle: 'Antipode High-Threat Outposts',
    normal: { x: 0, y: -1, z: 0 },
    uAxis: { x: -1, y: 0, z: 0 },
    vAxis: { x: 0, y: 0, z: 1 },
    threatBias: 0.95,
  },
] as const;

export function getCubeFaceSpec(face: CubeFaceId): CubeFaceSpec {
  return CUBE_FACES[face] ?? CUBE_FACES[0];
}

export function isValidCubeFace(face: unknown): face is CubeFaceId {
  return typeof face === 'number' && Number.isInteger(face) && face >= 0 && face <= 5;
}

export function isInsideCubeFaceTile(gx: number, gy: number): boolean {
  return (
    gx >= CUBE_FACE_MIN_TILE &&
    gx < CUBE_FACE_MAX_TILE &&
    gy >= CUBE_FACE_MIN_TILE &&
    gy < CUBE_FACE_MAX_TILE
  );
}

export function isInsideCubeFaceChunk(cx: number, cy: number): boolean {
  return (
    cx >= CUBE_FACE_MIN_CHUNK &&
    cx <= CUBE_FACE_MAX_CHUNK &&
    cy >= CUBE_FACE_MIN_CHUNK &&
    cy <= CUBE_FACE_MAX_CHUNK
  );
}

/**
 * Canonical chunk key for a finite Cube-Sphere chunk.
 * Face 0 preserves legacy "cx,cy" format for backwards compatibility with saves/tests;
 * Faces 1..5 use "f<face>:cx,cy".
 */
export function cubeChunkKey(face: CubeFaceId, cx: number, cy: number): string {
  return face === 0 ? `${cx},${cy}` : `f${face}:${cx},${cy}`;
}

export function parseCubeChunkKey(key: string): { face: CubeFaceId; cx: number; cy: number } | null {
  if (key.startsWith('f')) {
    const colon = key.indexOf(':');
    if (colon < 2) return null;
    const face = Number(key.slice(1, colon));
    const [cx, cy] = key.slice(colon + 1).split(',').map(Number);
    if (!isValidCubeFace(face) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    return { face, cx, cy };
  }
  const [cx, cy] = key.split(',').map(Number);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return { face: 0, cx, cy };
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function faceFromNormal(n: Vec3): CubeFaceId {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return n.y >= 0 ? 0 : 5;
  if (ax >= ay && ax >= az) return n.x >= 0 ? 1 : 2;
  return n.z >= 0 ? 3 : 4;
}

/**
 * Converts continuous local face coordinates (gx, gy) in [-64, 128) to normalized
 * cube face coordinates (s, t) in [-1, 1].
 */
export function tileToFaceST(gx: number, gy: number): { s: number; t: number } {
  const s = ((gx - CUBE_FACE_MIN_TILE) / CUBE_FACE_SIZE) * 2 - 1;
  const t = ((gy - CUBE_FACE_MIN_TILE) / CUBE_FACE_SIZE) * 2 - 1;
  return { s, t };
}

export function faceSTToTile(s: number, t: number): { gx: number; gy: number } {
  const gx = CUBE_FACE_MIN_TILE + ((s + 1) * 0.5) * CUBE_FACE_SIZE;
  const gy = CUBE_FACE_MIN_TILE + ((t + 1) * 0.5) * CUBE_FACE_SIZE;
  return { gx, gy };
}

/**
 * Everitt / Nowell equal-area-improved spherified cube mapping.
 * Projects a point on the unit cube [-1, 1]^3 onto the unit sphere S^2
 * with dramatically less corner distortion than naive normalization.
 */
export function unitCubePointToSphere(cx: number, cy: number, cz: number): Vec3 {
  const x2 = cx * cx;
  const y2 = cy * cy;
  const z2 = cz * cz;
  const sx = cx * Math.sqrt(Math.max(0, 1 - y2 * 0.5 - z2 * 0.5 + (y2 * z2) / 3));
  const sy = cy * Math.sqrt(Math.max(0, 1 - z2 * 0.5 - x2 * 0.5 + (z2 * x2) / 3));
  const sz = cz * Math.sqrt(Math.max(0, 1 - x2 * 0.5 - y2 * 0.5 + (x2 * y2) / 3));
  const len = Math.hypot(sx, sy, sz) || 1;
  return { x: sx / len, y: sy / len, z: sz / len };
}

/**
 * Resolves any continuous coordinate (gx, gy) on a given face — including coordinates
 * that stepped beyond [-64, 128) — by folding across cube edges onto the true destination
 * face with exact 2D tangent-frame rotation (0, 90, 180, or 270 degrees).
 *
 * Derived directly from 3D face basis vectors (normal, uAxis, vAxis), so all 24 directed
 * edge crossings are guaranteed involutions and preserve right-handed orientation.
 */
export interface ResolvedCubeCoord {
  face: CubeFaceId;
  gx: number;
  gy: number;
  /** Counter-clockwise quarter turns from source face's (u, v) frame to target face's (u, v) frame */
  rotQuarterTurns: 0 | 1 | 2 | 3;
  /** True if the coordinate crossed at least one cube edge */
  crossedEdge: boolean;
}

/**
 * Performs a single exact cube-edge fold when a coordinate exceeds one face boundary.
 */
function foldSingleEdge(
  face: CubeFaceId,
  u: number, // [0, CUBE_FACE_SIZE) inside face
  v: number,
  edge: 'east' | 'west' | 'south' | 'north'
): { face: CubeFaceId; u: number; v: number; rot: 0 | 1 | 2 | 3 } {
  const S = CUBE_FACE_SIZE;
  const spec = CUBE_FACES[face];

  // Outward direction in 3D space of the crossed edge becomes the neighbor's normal!
  let edgeDir: Vec3;
  let overshoot: number;
  let alongAxis: Vec3;
  let alongOffset: number; // centered in [-S/2, S/2]

  if (edge === 'east') {
    edgeDir = spec.uAxis;
    overshoot = u - S; // >= 0
    alongAxis = spec.vAxis;
    alongOffset = v - S * 0.5;
  } else if (edge === 'west') {
    edgeDir = scale3(spec.uAxis, -1);
    overshoot = -u; // > 0
    alongAxis = spec.vAxis;
    alongOffset = v - S * 0.5;
  } else if (edge === 'south') {
    edgeDir = spec.vAxis;
    overshoot = v - S; // >= 0
    alongAxis = spec.uAxis;
    alongOffset = u - S * 0.5;
  } else {
    edgeDir = scale3(spec.vAxis, -1);
    overshoot = -v; // > 0
    alongAxis = spec.uAxis;
    alongOffset = u - S * 0.5;
  }

  const nextFace = faceFromNormal(edgeDir);
  const nextSpec = CUBE_FACES[nextFace];

  // On the neighbor face:
  // - Entering inward from the shared edge moves in direction (-spec.normal).
  // - Position along the shared edge is `alongOffset * alongAxis`.
  // - At overshoot = 0, we sit on the shared edge at (S/2) * spec.normal; moving inward
  //   by `overshoot` puts us at (S/2 - overshoot) * spec.normal + alongOffset * alongAxis.
  const posOnNext3D = add3(
    scale3(spec.normal, S * 0.5 - overshoot),
    scale3(alongAxis, alongOffset)
  );
  const nextU = S * 0.5 + dot3(posOnNext3D, nextSpec.uAxis);
  const nextV = S * 0.5 + dot3(posOnNext3D, nextSpec.vAxis);

  // Compute exact 2D frame rotation from source (uAxis, vAxis) to target (nextSpec.uAxis, nextSpec.vAxis)
  // when folded flat along the shared edge:
  //   - Crossing east/west: source uAxis maps to (edge==='east' ? -spec.normal : +spec.normal), source vAxis stays vAxis.
  //   - Crossing south/north: source vAxis maps to (edge==='south' ? -spec.normal : +spec.normal), source uAxis stays uAxis.
  const foldedU =
    edge === 'east'
      ? scale3(spec.normal, -1)
      : edge === 'west'
        ? spec.normal
        : spec.uAxis;

  const cu = dot3(foldedU, nextSpec.uAxis);
  const cv = dot3(foldedU, nextSpec.vAxis);
  let rot: 0 | 1 | 2 | 3 = 0;
  if (cu > 0.5) rot = 0;
  else if (cv > 0.5) rot = 1;
  else if (cu < -0.5) rot = 2;
  else rot = 3;

  return { face: nextFace, u: nextU, v: nextV, rot };
}

export function resolveCubeSphereCoord(
  face: CubeFaceId,
  gx: number,
  gy: number
): ResolvedCubeCoord {
  const S = CUBE_FACE_SIZE;
  let curFace: CubeFaceId = face;
  let u = gx - CUBE_FACE_MIN_TILE;
  let v = gy - CUBE_FACE_MIN_TILE;
  let totalRot = 0;
  let crossedEdge = false;

  // Iteratively fold across edges (handles corners and multi-face hops cleanly)
  for (let iter = 0; iter < 8; iter++) {
    const outEast = u >= S ? u - S : -1;
    const outWest = u < 0 ? -u : -1;
    const outSouth = v >= S ? v - S : -1;
    const outNorth = v < 0 ? -v : -1;
    const maxOut = Math.max(outEast, outWest, outSouth, outNorth);
    if (maxOut < 0) break;

    crossedEdge = true;
    let edge: 'east' | 'west' | 'south' | 'north';
    if (outEast === maxOut) edge = 'east';
    else if (outWest === maxOut) edge = 'west';
    else if (outSouth === maxOut) edge = 'south';
    else edge = 'north';

    const folded = foldSingleEdge(curFace, u, v, edge);
    curFace = folded.face;
    u = folded.u;
    v = folded.v;
    totalRot = (totalRot + folded.rot) & 3;
  }

  return {
    face: curFace,
    gx: CUBE_FACE_MIN_TILE + u,
    gy: CUBE_FACE_MIN_TILE + v,
    rotQuarterTurns: (totalRot & 3) as 0 | 1 | 2 | 3,
    crossedEdge,
  };
}

/**
 * Resolves an integer tile coordinate (gx, gy) on `face` into its canonical finite
 * Cube-Sphere face and integer tile (gx, gy) inside [-64, 127].
 */
export function resolveCubeSphereTile(
  face: CubeFaceId,
  gx: number,
  gy: number
): { face: CubeFaceId; gx: number; gy: number; rotQuarterTurns: 0 | 1 | 2 | 3; crossedEdge: boolean } {
  const igx = Math.floor(gx);
  const igy = Math.floor(gy);
  if (isInsideCubeFaceTile(igx, igy)) {
    return { face, gx: igx, gy: igy, rotQuarterTurns: 0, crossedEdge: false };
  }
  const resolved = resolveCubeSphereCoord(face, igx + 0.5, igy + 0.5);
  return {
    face: resolved.face,
    gx: clamp(Math.floor(resolved.gx), CUBE_FACE_MIN_TILE, CUBE_FACE_MAX_TILE - 1),
    gy: clamp(Math.floor(resolved.gy), CUBE_FACE_MIN_TILE, CUBE_FACE_MAX_TILE - 1),
    rotQuarterTurns: resolved.rotQuarterTurns,
    crossedEdge: resolved.crossedEdge,
  };
}

/**
 * Rotates a 2D vector (dx, dy) by `rotQuarterTurns` * 90 degrees in (u, v) plane.
 */
export function rotateVectorQuarterTurns(
  dx: number,
  dy: number,
  rotQuarterTurns: 0 | 1 | 2 | 3
): { x: number; y: number } {
  switch (rotQuarterTurns) {
    case 1:
      return { x: -dy, y: dx };
    case 2:
      return { x: -dx, y: -dy };
    case 3:
      return { x: dy, y: -dx };
    default:
      return { x: dx, y: dy };
  }
}

export function rotateAngleQuarterTurns(angle: number, rotQuarterTurns: 0 | 1 | 2 | 3): number {
  let a = angle + rotQuarterTurns * (Math.PI * 0.5);
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Maps ANY (face, wx, wy) coordinate (even past face edges!) onto its exact 3D unit sphere point S^2.
 */
export function cubeFaceToSphere(face: CubeFaceId, wx: number, wy: number): Vec3 {
  const resolved = isInsideCubeFaceTile(wx, wy)
    ? { face, gx: wx, gy: wy }
    : resolveCubeSphereCoord(face, wx, wy);
  const spec = CUBE_FACES[resolved.face];
  const { s, t } = tileToFaceST(resolved.gx, resolved.gy);
  const cx = spec.normal.x + s * spec.uAxis.x + t * spec.vAxis.x;
  const cy = spec.normal.y + s * spec.uAxis.y + t * spec.vAxis.y;
  const cz = spec.normal.z + s * spec.uAxis.z + t * spec.vAxis.z;
  return unitCubePointToSphere(cx, cy, cz);
}

/**
 * Inverse mapping: projects a 3D point on the unit sphere back to its owning
 * cube face and continuous tile coordinates (gx, gy).
 */
export function sphereToCubeFace(p: Vec3): { face: CubeFaceId; gx: number; gy: number } {
  const len = Math.hypot(p.x, p.y, p.z) || 1;
  const nx = p.x / len;
  const ny = p.y / len;
  const nz = p.z / len;

  const face = faceFromNormal({ x: nx, y: ny, z: nz });
  const spec = CUBE_FACES[face];

  // Initial gnomonic estimate on the unit cube face
  const denom = Math.max(1e-6, dot3({ x: nx, y: ny, z: nz }, spec.normal));
  let s = clamp(dot3({ x: nx, y: ny, z: nz }, spec.uAxis) / denom, -1, 1);
  let t = clamp(dot3({ x: nx, y: ny, z: nz }, spec.vAxis) / denom, -1, 1);

  // 4 iterations of damped fixed-point / Newton refinement to invert Everitt's spherified cube map
  for (let i = 0; i < 4; i++) {
    const cx = spec.normal.x + s * spec.uAxis.x + t * spec.vAxis.x;
    const cy = spec.normal.y + s * spec.uAxis.y + t * spec.vAxis.y;
    const cz = spec.normal.z + s * spec.uAxis.z + t * spec.vAxis.z;
    const est = unitCubePointToSphere(cx, cy, cz);
    const errU = dot3({ x: nx - est.x, y: ny - est.y, z: nz - est.z }, spec.uAxis);
    const errV = dot3({ x: nx - est.x, y: ny - est.y, z: nz - est.z }, spec.vAxis);
    s = clamp(s + errU * 1.15, -1, 1);
    t = clamp(t + errV * 1.15, -1, 1);
  }

  const { gx, gy } = faceSTToTile(s, t);
  return { face, gx, gy };
}

/**
 * Great-circle geodesic distance in tiles between two planetary positions.
 */
export function greatCircleDistanceTiles(
  faceA: CubeFaceId,
  ax: number,
  ay: number,
  faceB: CubeFaceId,
  bx: number,
  by: number
): number {
  const pa = cubeFaceToSphere(faceA, ax, ay);
  const pb = cubeFaceToSphere(faceB, bx, by);
  const d = clamp(dot3(pa, pb), -1, 1);
  return Math.acos(d) * PLANET_RADIUS_TILES;
}

/**
 * Converts a 3D unit sphere point to geographic Latitude (-90..+90) and Longitude (-180..+180).
 * North Pole (+90 deg) = Ashfall Crown center; South Pole (-90 deg) = Dead Caldera center.
 */
export function sphereToLatLon(p: Vec3): { latDeg: number; lonDeg: number } {
  const latDeg = (Math.asin(clamp(p.y, -1, 1)) * 180) / Math.PI;
  const lonDeg = (Math.atan2(p.x, p.z) * 180) / Math.PI;
  return { latDeg, lonDeg };
}

export interface PlanetTelemetry {
  face: CubeFaceId;
  faceCode: CubeFaceSpec['code'];
  faceName: string;
  latDeg: number;
  lonDeg: number;
  latLonLabel: string;
  spherePoint: Vec3;
  threatFactor: number; // 0 at Ashfall Crown -> 1 at Dead Caldera Antipode
  greatCircleDistFromTown: number;
}

export function samplePlanetTelemetry(face: CubeFaceId, wx: number, wy: number): PlanetTelemetry {
  const resolved = resolveCubeSphereCoord(face, wx, wy);
  const spec = CUBE_FACES[resolved.face];
  const p = cubeFaceToSphere(resolved.face, resolved.gx, resolved.gy);
  const { latDeg, lonDeg } = sphereToLatLon(p);
  const ns = latDeg >= 0 ? 'N' : 'S';
  const ew = lonDeg >= 0 ? 'E' : 'W';
  const latLonLabel = `${Math.abs(Math.round(latDeg))}°${ns} ${Math.abs(Math.round(lonDeg))}°${ew}`;
  // Smooth threat gradient from North Pole (+Y = 0) to South Pole Antipode (-Y = 1)
  const threatFactor = clamp((1 - p.y) * 0.5, 0, 1);
  const greatCircleDistFromTown = Math.acos(clamp(p.y, -1, 1)) * PLANET_RADIUS_TILES;

  return {
    face: resolved.face,
    faceCode: spec.code,
    faceName: spec.name,
    latDeg,
    lonDeg,
    latLonLabel,
    spherePoint: p,
    threatFactor,
    greatCircleDistFromTown,
  };
}

// ---------- Seamless 3D Spherical Noise (zero seams across all 12 cube edges) ----------

export function hashCoords3D(seed: number, x: number, y: number, z: number): number {
  let h = (
    seed ^
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(z | 0, 2147483647)
  ) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function hashFloat3D(seed: number, x: number, y: number, z: number): number {
  return hashCoords3D(seed, x, y, z) / 4294967296;
}

export function valueNoise3D(seed: number, x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const c000 = hashFloat3D(seed, ix, iy, iz);
  const c100 = hashFloat3D(seed, ix + 1, iy, iz);
  const c010 = hashFloat3D(seed, ix, iy + 1, iz);
  const c110 = hashFloat3D(seed, ix + 1, iy + 1, iz);
  const c001 = hashFloat3D(seed, ix, iy, iz + 1);
  const c101 = hashFloat3D(seed, ix + 1, iy, iz + 1);
  const c011 = hashFloat3D(seed, ix, iy + 1, iz + 1);
  const c111 = hashFloat3D(seed, ix + 1, iy + 1, iz + 1);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;

  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

export function fbm3D(seed: number, x: number, y: number, z: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise3D(seed + i * 131, x * freq, y * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / (norm || 1);
}

/**
 * Computes subtle planetary horizon curvature vertical droop for visual rendering.
 * Keeps near-field flat (within 10 tiles) for crisp gameplay alignment, then gently curves
 * distant terrain downward as on a finite spherical planet.
 */
export function computePlanetCurvatureDroop(dx: number, dz: number, strength = 1.0): number {
  const distSq = dx * dx + dz * dz;
  const flatRadius = 22;
  if (distSq <= flatRadius * flatRadius) return 0;
  const effectiveDist = Math.sqrt(distSq) - flatRadius;
  return -((effectiveDist * effectiveDist) / (2 * PLANET_RADIUS_TILES)) * 0.12 * strength;
}

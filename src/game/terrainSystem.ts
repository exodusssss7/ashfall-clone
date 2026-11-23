import { SPHERE_NOISE_SCALE, cubeFaceToSphere, fbm3D, isInsideCubeFaceTile, resolveCubeSphereCoord, type CubeFaceId } from './cubeSphere';
import { clamp } from './isometric';
import type { TileCell, WorldLandmark } from './types';
import { fbm2D, hashCoords, sampleOceanInfo, sampleRiverInfo, sampleRoadInfo } from './worldGen';

export const CLIFF_SLOPE_THRESHOLD = 0.82;
export const HIGH_GROUND_MIN_DELTA = 0.45;
export const BRIDGE_PEAK_HEIGHT = 0.88;
export const TUNNEL_HILL_THRESHOLD = 2.85;
export const TUNNEL_CLEARANCE = 2.8;
export const CAVE_CLEARANCE = 3.0;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export interface RockyCavePlan {
  id: string;
  name: string;
  rx: number;
  ry: number;
  gx: number;
  gy: number;
  /** Interior walkable chamber radius in tiles */
  chamberRadius: number;
  /** Direction the cave mouth opens toward ('s' = +Y, 'e' = +X) */
  mouthDir: 's' | 'e';
  /** Mouth corridor length in tiles from chamber center (5.2 base, extended per-cave until the mouth reaches open terrain) */
  mouthLen: number;
  floorY: number;
  roofY: number;
  shelterBounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface TerrainSurfaceSample {
  height: number;
  /** Base massif elevation before tunnel/cave carving (used for tunnel & cave hill roofs) */
  massifHeight: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  slope: number;
  isCliff: boolean;
  isBridge: boolean;
  bridgeAxis: 'ew' | 'ns' | 'none';
  isTunnel: boolean;
  tunnelAxis: 'ew' | 'ns' | 'none';
  tunnelRoofY: number;
  isCave: boolean;
  isCaveWall: boolean;
  isCaveMouth: boolean;
  isCaveCoveredMouth: boolean;
  caveId: string | null;
  caveRoofY: number;
  isHighGround: boolean;
}

/**
 * Computes 0 inside the starter town (0..64, 0..64) and smoothly ramps to 1 across the hilly outer frontier.
 */
export function getFrontierFactor(wx: number, wy: number, face: CubeFaceId = 0): number {
  if (face !== 0) return 1;
  const dx = wx < 0 ? -wx : wx > 64 ? wx - 64 : 0;
  const dy = wy < 0 ? -wy : wy > 64 ? wy - 64 : 0;
  const distTown = Math.hypot(dx, dy);
  return smoothstep(1.5, 14.0, distTown);
}

/**
 * Evaluates raw highland elevation (hills, ridges, terraced cliff bands, and carved river valleys)
 * on the 3D Cube-Sphere surface S^2 BEFORE road grading, bridges, tunnels, and caves are applied.
 * Sampling 3D spherical noise guarantees zero elevation seams across all 12 cube-sphere edges.
 */
export function sampleRawHillHeight(seed: number, wx: number, wy: number, face: CubeFaceId = 0): number {
  const res = isInsideCubeFaceTile(wx, wy) ? { face, gx: wx, gy: wy } : resolveCubeSphereCoord(face, wx, wy);
  const rFace = res.face;
  const rx = res.gx;
  const ry = res.gy;

  const frontier = getFrontierFactor(rx, ry, rFace);
  if (frontier <= 0.0001) return 0;

  if (seed !== heightCacheSeed) {
    rawHillCache.clear();
    terrainHeightCache.clear();
    heightCacheSeed = seed;
  }
  const cKey = quantHeightKey(rFace, rx, ry);
  const cached = rawHillCache.get(cKey);
  if (cached !== undefined) return cached;

  const ocean = sampleOceanInfo(seed, rx, ry, rFace);
  if (ocean.landMask <= 0.0001) {
    if (rawHillCache.size >= MAX_HEIGHT_CACHE_ENTRIES) rawHillCache.clear();
    rawHillCache.set(cKey, 0);
    return 0;
  }

  const river = sampleRiverInfo(seed, rx, ry, rFace);
  // Carve smooth valley floors down toward water level along rivers
  const valleyMask = smoothstep(0.032, 0.115, river.riverBand);
  if (valleyMask <= 0.0001) {
    if (rawHillCache.size >= MAX_HEIGHT_CACHE_ENTRIES) rawHillCache.clear();
    rawHillCache.set(cKey, 0);
    return 0;
  }

  // 3D spherical noise on unit sphere S^2 scaled proportionally to massive 4,096-tile globe
  const p = cubeFaceToSphere(rFace, rx, ry);
  const mFreq = 2.05 * SPHERE_NOISE_SCALE;
  const rFreq = 2.65 * SPHERE_NOISE_SCALE;
  const dFreq = 5.8 * SPHERE_NOISE_SCALE;
  const macro = fbm3D(seed + 1701, p.x * mFreq, p.y * mFreq, p.z * mFreq, 3);
  const ridgeRaw = fbm3D(seed + 1907, p.x * rFreq + 4.3, p.y * rFreq - 2.9, p.z * rFreq + 1.7, 2);
  const ridge = 1 - Math.abs(ridgeRaw * 2 - 1);
  const detail = fbm3D(seed + 2311, p.x * dFreq - 2.1, p.y * dFreq + 3.4, p.z * dFreq - 1.5, 2);

  // Smooth planetary elevation modulation: Frostpeak Highlands (-Z) & Dead Caldera (-Y) rise taller
  const highlandBoost = 1 + clamp(-p.z * 0.18 + -p.y * 0.14 - p.z * 0.08, -0.1, 0.28);

  const rolling = Math.pow(clamp((macro - 0.28) / 0.72, 0, 1), 1.15) * 4.15 * highlandBoost;
  const ridgeline = Math.pow(clamp((ridge - 0.42) / 0.58, 0, 1), 1.65) * 2.55 * highlandBoost;
  const undulation = (detail - 0.5) * 0.34;

  let h = Math.max(0, rolling + ridgeline + undulation) * frontier * valleyMask * ocean.landMask;

  // Gentle alpine terracing: sweeping drivable mountain slopes with far fewer abrupt cliff walls
  const terrace1 = smoothstep(1.65, 2.75, h);
  const terrace2 = smoothstep(3.45, 4.65, h);
  h = h * 0.85 + terrace1 * 0.50 + terrace2 * 0.62;

  // Keep immediate East starter highway test corridor (84, 28) on Face 0 gently passable
  if (rFace === 0) {
    const eastDist = Math.hypot(rx - 84, ry - 28);
    if (eastDist < 12) {
      const t = smoothstep(4, 12, eastDist);
      h = h * (0.25 + 0.75 * t);
    }
  }

  const out = clamp(h, 0, 6.2);
  if (rawHillCache.size >= MAX_HEIGHT_CACHE_ENTRIES) rawHillCache.clear();
  rawHillCache.set(cKey, out);
  return out;
}

// Memoized cave lookup per macro-region (32x32 tiles) + bounded quantized height caches
// Eliminates ~75% of repeated 3D fBM evaluations during chunk meshing, grass, vehicles & AI!
const cavePlanCache = new Map<string, RockyCavePlan | null>();
const rawHillCache = new Map<number, number>();
const terrainHeightCache = new Map<number, number>();
let heightCacheSeed = -1;
const MAX_HEIGHT_CACHE_ENTRIES = 16384;

function quantHeightKey(face: CubeFaceId, wx: number, wy: number): number {
  const qx = Math.round(wx * 4) + 32768; // 0..65535 (16 bits)
  const qy = Math.round(wy * 4) + 32768; // 0..65535 (16 bits)
  // Pack (face: 3 bits, qx: 16 bits, qy: 16 bits) cleanly into safe 53-bit JS integer!
  return face * 4294967296 + qx * 65536 + qy;
}

export function clearTerrainCaches(): void {
  cavePlanCache.clear();
  rawHillCache.clear();
  terrainHeightCache.clear();
  heightCacheSeed = -1;
}

/**
 * Deterministically places hidden Rocky Cliff Caves into elevated outer-frontier regions.
 * Guaranteed not to overlap starter town (rx/ry in 0..1), main highways, or rivers.
 */
export function getMacroRegionCave(seed: number, rx: number, ry: number, face: CubeFaceId = 0): RockyCavePlan | null {
  // Never place caves inside the 4x4 origin town sector on Face 0
  if (face === 0 && rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1) return null;

  const cacheKey = `${seed}:f${face}:${rx},${ry}`;
  if (cavePlanCache.has(cacheKey)) {
    return cavePlanCache.get(cacheKey)!;
  }

  const h = hashCoords(seed + 4999 + face * 10007, rx, ry);
  const regStartX = rx * 32;
  const regStartY = ry * 32;

  // Guarantee high discovery rate in inner frontier ring so players find rocky cliff shelters reliably
  const ringDist = Math.hypot(rx - 0.5, ry - 0.5);
  const spawnChance = ringDist <= 2.6 ? 0.68 : 0.46;
  if (((h % 1000) / 1000) > spawnChance) {
    cavePlanCache.set(cacheKey, null);
    return null;
  }

  let best: { gx: number; gy: number; score: number; hill: number } | null = null;
  for (let gy = regStartY + 8; gy <= regStartY + 23; gy += 3) {
    for (let gx = regStartX + 8; gx <= regStartX + 23; gx += 3) {
      // Keep East starter test spot clear
      if (face === 0 && Math.hypot(gx - 84, gy - 28) < 14) continue;

      const road = sampleRoadInfo(seed, gx, gy, face);
      if (road.highwayDist < 7.5) continue;
      const river = sampleRiverInfo(seed, gx, gy, face);
      if (river.riverBand < 0.08) continue;

      const hill = sampleRawHillHeight(seed, gx + 0.5, gy + 0.5, face);
      // Prefer rocky hillside benches where a cliff rises behind the cavern
      if (hill < 1.15) continue;

      // Ensure cave mouth apron is dry & road-free
      let ok = true;
      for (let dy = -4; dy <= 6 && ok; dy += 2) {
        for (let dx = -4; dx <= 6 && ok; dx += 2) {
          if (sampleRoadInfo(seed, gx + dx, gy + dy, face).isAnyRoad) ok = false;
          if (sampleRiverInfo(seed, gx + dx, gy + dy, face).inWater) ok = false;
        }
      }
      if (!ok) continue;

      // Prefer spots near elevation ~1.8..3.4 so the cliff face behind rises cleanly
      const score = hill - Math.abs(hill - 2.3) * 0.45;
      if (!best || score > best.score) {
        best = { gx, gy, score, hill };
      }
    }
  }

  if (!best) {
    cavePlanCache.set(cacheKey, null);
    return null;
  }

  const mouthDir: 's' | 'e' = (h & 1) === 0 ? 's' : 'e';
  const floorY = clamp(best.hill * 0.68, 0.75, 2.25);
  const roofY = Math.max(floorY + CAVE_CLEARANCE, best.hill + 1.45);
  const chamberRadius = 3.2;

  const plan: RockyCavePlan = {
    id: face === 0 ? `cave_${rx}_${ry}` : `f${face}_cave_${rx}_${ry}`,
    name: `Rocky Cave #${(h % 29) + 1}`,
    rx,
    ry,
    gx: best.gx,
    gy: best.gy,
    chamberRadius,
    mouthDir,
    mouthLen: 5.2,
    floorY,
    roofY,
    shelterBounds: {
      minX: best.gx - 3,
      maxX: best.gx + 3,
      minY: best.gy - 3,
      maxY: best.gy + 3,
    },
  };

  cavePlanCache.set(cacheKey, plan);

  // Guarantee the mouth corridor actually reaches open terrain. Some hillsides stamp an impassable
  // cliff band right past the default 5.2-tile mouth, sealing the cave. Only caves that are truly
  // sealed get their corridor extended (deterministically, terrain-driven, no RNG), half a tile at
  // a time, until the chamber connects to the open map. Safe from recursion: the plan is already
  // cached, so terrain sampling here never re-enters this computation.
  while (plan.mouthLen < 12.2 && isCaveMouthSealed(seed, plan, face)) {
    plan.mouthLen += 0.5;
  }

  return plan;
}

/**
 * True when no walkable route exists from the cave's mouth out to open terrain (distance > 9.5
 * from the chamber center). Walkability mirrors the game's movement rules: a point is blocked
 * when its surface is impassable cliff (the same predicate that stamps solid cliff_stone), and a
 * 0.5-tile step between neighbors must pass the same 0.68 height-step rule actors use.
 */
function isCaveMouthSealed(seed: number, cave: RockyCavePlan, face: CubeFaceId = 0): boolean {
  const ccx = cave.gx + 0.5;
  const ccy = cave.gy + 0.5;
  const step = 0.5;
  // Box trails 10 tiles behind the chamber (escapes can wrap around the hill shoulder) and
  // reaches 14.5 along the mouth direction, 10 to each side
  const inBox = (x: number, y: number) =>
    cave.mouthDir === 'e'
      ? x >= ccx - 10 && x <= ccx + 14.5 && y >= ccy - 10 && y <= ccy + 10
      : x >= ccx - 10 && x <= ccx + 10 && y >= ccy - 10 && y <= ccy + 14.5;
  const key = (ix: number, iy: number) => `${ix},${iy}`;
  const walkable = (ix: number, iy: number) => {
    const x = ccx + ix * step;
    const y = ccy + iy * step;
    if (!inBox(x, y)) return false;
    // Snap to the owning cell's center: cliff_stone stamping is decided at cell centers,
    // so point-sampling slope between cells would leak through walls the cell grid blocks
    return !sampleTerrainSurface(seed, Math.floor(x) + 0.5, Math.floor(y) + 0.5, face).isCliff;
  };
  const startIx = Math.round((cave.mouthDir === 'e' ? 2 : 0) / step);
  const startIy = Math.round((cave.mouthDir === 's' ? 2 : 0) / step);
  if (!walkable(startIx, startIy)) return true;
  const seen = new Set<string>([key(startIx, startIy)]);
  const queue: Array<[number, number]> = [[startIx, startIy]];
  while (queue.length > 0) {
    const [ix, iy] = queue.pop()!;
    const x = ccx + ix * step;
    const y = ccy + iy * step;
    // Reached open terrain: far enough out and genuinely outside the cave's own carved mouth/interior
    if (Math.hypot(x - ccx, y - ccy) > 8.6) {
      const s = sampleTerrainSurface(seed, x, y, face);
      if (!s.isCave && !s.isCaveMouth) return false;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = ix + dx;
      const ny = iy + dy;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      const wx = ccx + nx * step;
      const wy = ccy + ny * step;
      if (!walkable(nx, ny)) continue;
      if (isTerrainStepBlocked(seed, x, y, wx, wy, 0.68, face)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return true;
}

/**
 * Checks whether world coordinate (wx, wy) falls inside or near a Rocky Cliff Cave.
 */
export function findRockyCaveAt(seed: number, wx: number, wy: number, face: CubeFaceId = 0): {
  cave: RockyCavePlan;
  inInterior: boolean;
  inWallRing: boolean;
  /** True when the wall ring tile is on the camera-facing SE cutaway side (+X/+Z) */
  isFrontCutawayWall: boolean;
  inMouth: boolean;
  /** True only under the rocky overhang/lintel threshold (<= 3.15 tiles from chamber center) */
  inCoveredMouth: boolean;
  inBlendZone: boolean;
  dist: number;
} | null {
  const res = isInsideCubeFaceTile(wx, wy) ? { face, gx: wx, gy: wy } : resolveCubeSphereCoord(face, wx, wy);
  const rFace = res.face;
  const rwx = res.gx;
  const rwy = res.gy;
  const rx = Math.floor(rwx / 32);
  const ry = Math.floor(rwy / 32);

  // Check owning macro-region and immediate neighbors
  for (let dry = -1; dry <= 1; dry++) {
    for (let drx = -1; drx <= 1; drx++) {
      const cave = getMacroRegionCave(seed, rx + drx, ry + dry, rFace);
      if (!cave) continue;
      const dx = rwx - (cave.gx + 0.5);
      const dy = rwy - (cave.gy + 0.5);
      const d = Math.hypot(dx, dy);
      // Mouth corridors can extend up to 12.2 tiles on sealed caves, so the query window must cover that reach
      if (d > 12.6) continue;

      const inMouth =
        cave.mouthDir === 's'
          ? dy >= 1.5 && dy <= cave.mouthLen && Math.abs(dx) <= 1.55
          : dx >= 1.5 && dx <= cave.mouthLen && Math.abs(dy) <= 1.55;

      const inCoveredMouth =
        cave.mouthDir === 's'
          ? dy >= 1.5 && dy <= 3.15 && Math.abs(dx) <= 1.55
          : dx >= 1.5 && dx <= 3.15 && Math.abs(dy) <= 1.55;

      const inInterior = d <= cave.chamberRadius && !inMouth;
      const inWallRing = d > cave.chamberRadius && d <= cave.chamberRadius + 1.35 && !inMouth;
      // Camera looks from (+X, +Y, +Z) toward (-X, -Y, 0), so dx + dy > 0.8 faces the isometric camera
      const isFrontCutawayWall = inWallRing && dx + dy > 0.8;
      const inBlendZone = d <= 8.5;

      return {
        cave,
        inInterior,
        inWallRing,
        isFrontCutawayWall,
        inMouth,
        inCoveredMouth,
        inBlendZone,
        dist: d,
      };
    }
  }
  return null;
}

/**
 * Checks whether a tile/point is on an elevated river bridge.
 */
export function sampleBridgeInfo(seed: number, wx: number, wy: number, face: CubeFaceId = 0): {
  isBridge: boolean;
  bridgeHeight: number;
  axis: 'ew' | 'ns' | 'none';
} {
  if (face === 0 && wx >= 0 && wx < 64 && wy >= 0 && wy < 64) {
    return { isBridge: false, bridgeHeight: 0, axis: 'none' };
  }
  const road = sampleRoadInfo(seed, wx, wy, face);
  if (!road.isAnyRoad) {
    return { isBridge: false, bridgeHeight: 0, axis: 'none' };
  }
  const river = sampleRiverInfo(seed, wx, wy, face);
  if (river.riverBand >= 0.044) {
    return { isBridge: false, bridgeHeight: 0, axis: 'none' };
  }
  const archT = clamp(river.riverBand / 0.044, 0, 1);
  const arch = Math.cos(archT * Math.PI * 0.5);
  const deckH = 0.20 + arch * (BRIDGE_PEAK_HEIGHT - 0.20);
  const axis: 'ew' | 'ns' | 'none' = road.roadAxis === 'ns' ? 'ns' : 'ew';
  return { isBridge: true, bridgeHeight: deckH, axis };
}

/**
 * Checks whether a main highway cuts through a tall hill via a dark Road Tunnel.
 */
export function sampleRoadTunnelInfo(seed: number, wx: number, wy: number, face: CubeFaceId = 0): {
  isTunnel: boolean;
  isPortal: boolean;
  floorY: number;
  roofY: number;
  axis: 'ew' | 'ns' | 'none';
} {
  if (face === 0 && wx >= 0 && wx < 64 && wy >= 0 && wy < 64) {
    return { isTunnel: false, isPortal: false, floorY: 0, roofY: 0, axis: 'none' };
  }
  const road = sampleRoadInfo(seed, wx, wy, face);
  if (!road.isMainHighway && !road.isShoulder) {
    return { isTunnel: false, isPortal: false, floorY: 0, roofY: 0, axis: 'none' };
  }
  const river = sampleRiverInfo(seed, wx, wy, face);
  if (river.riverBand < 0.075) {
    return { isTunnel: false, isPortal: false, floorY: 0, roofY: 0, axis: 'none' };
  }

  const rawHill = sampleRawHillHeight(seed, wx, wy, face);
  if (rawHill < TUNNEL_HILL_THRESHOLD - 0.35) {
    return { isTunnel: false, isPortal: false, floorY: rawHill * 0.78, roofY: 0, axis: 'none' };
  }

  const floorY = 1.15 + clamp((rawHill - TUNNEL_HILL_THRESHOLD) * 0.08, 0, 0.35);
  const roofY = Math.max(floorY + TUNNEL_CLEARANCE, rawHill + 0.75);
  const axis: 'ew' | 'ns' | 'none' = road.roadAxis === 'ns' ? 'ns' : 'ew';
  const isTunnel = road.isMainHighway && rawHill >= TUNNEL_HILL_THRESHOLD;
  const isPortal =
    road.isMainHighway &&
    rawHill >= TUNNEL_HILL_THRESHOLD - 0.22 &&
    rawHill < TUNNEL_HILL_THRESHOLD + 0.26;

  return { isTunnel, isPortal, floorY, roofY, axis };
}

/**
 * Tunnel envelope cell classification shared by the renderer (threeRenderer) and movement
 * collision, so visible solid walls and blocking always agree. A core cell is tunnel interior
 * (bore plus portal-apron road cells).
 */
export function isTunnelCoreCell(seed: number, tx: number, ty: number, face: CubeFaceId = 0): boolean {
  const t = sampleRoadTunnelInfo(seed, tx + 0.5, ty + 0.5, face);
  return t.isTunnel || (t.isPortal && sampleRoadInfo(seed, tx, ty, face).isAnyRoad);
}

/**
 * Full claimed envelope: core cells plus the one-cell approach ring on the hillside just below the
 * portal band that still gets roofed/walled (roofY=0 marks the below-band branch; floorY/0.78
 * recovers rawHill).
 */
export function isTunnelClaimedCell(seed: number, tx: number, ty: number, face: CubeFaceId = 0): boolean {
  if (isTunnelCoreCell(seed, tx, ty, face)) return true;
  const t = sampleRoadTunnelInfo(seed, tx + 0.5, ty + 0.5, face);
  if (t.roofY !== 0) return false;
  if (!sampleRoadInfo(seed, tx, ty, face).isAnyRoad) return false;
  if (t.floorY / 0.78 < TUNNEL_HILL_THRESHOLD - 0.55) return false;
  return (
    isTunnelCoreCell(seed, tx - 1, ty, face) ||
    isTunnelCoreCell(seed, tx + 1, ty, face) ||
    isTunnelCoreCell(seed, tx, ty - 1, face) ||
    isTunnelCoreCell(seed, tx, ty + 1, face)
  );
}

// Renderer wall boxes on tunnel envelope edges are centered 0.05 inside the claimed cell with
// 0.24 thickness: the solid slab reaches 0.17 into the claimed cell and 0.07 into the open cell.
export const TUNNEL_WALL_FACE_CLAIMED = 0.17;
export const TUNNEL_WALL_FACE_OPEN = 0.07;
// Movement stops the point camera this far short of a wall slab so the FPS near plane (0.08)
// never enters the mesh when hugging a wall.
export const TUNNEL_WALL_CAMERA_CLEARANCE = 0.1;

/**
 * True where the renderer stands a solid wall on the shared edge of adjacent cells A and B:
 * exactly one side is a claimed tunnel cell and the unclaimed side is not a designed opening
 * (road cell in the portal band, matching the renderer's header/opening condition). This covers
 * end seals where the road stops inside the envelope as well as side/corner seals.
 */
export function isTunnelOpeningEdge(seed: number, tx: number, ty: number, ux: number, uy: number, face: CubeFaceId = 0): boolean {
  const tunnel = sampleRoadTunnelInfo(seed, tx + 0.5, ty + 0.5, face);
  if (tunnel.isPortal && sampleRoadInfo(seed, ux, uy, face).isAnyRoad) return true;
  // A river crossing or abrupt hill cutoff can end the bore without a portal-band cell.
  // Leave the continuing highway open along the bore, never through a lateral retaining wall.
  const alongBore = tunnel.axis === 'ew' ? uy === ty : tunnel.axis === 'ns' ? ux === tx : false;
  return alongBore && sampleRoadInfo(seed, ux + 0.5, uy + 0.5, face).isMainHighway;
}

export function isTunnelEdgeWall(seed: number, ax: number, ay: number, bx: number, by: number, face: CubeFaceId = 0): boolean {
  const aClaimed = isTunnelClaimedCell(seed, ax, ay, face);
  const bClaimed = isTunnelClaimedCell(seed, bx, by, face);
  if (aClaimed === bClaimed) return false;
  const ux = aClaimed ? bx : ax;
  const uy = aClaimed ? by : ay;
  return !isTunnelOpeningEdge(seed, aClaimed ? ax : bx, aClaimed ? ay : by, ux, uy, face);
}

/**
 * Returns true if tile (gx, gy) is a flanking tunnel retaining-wall shoulder adjacent to an active
 * highway road tunnel (marked solid so players/vehicles/zombies cannot clip sideways out of tunnels).
 */
export function isTunnelSideWallTile(seed: number, gx: number, gy: number, face: CubeFaceId = 0): boolean {
  if (face === 0 && gx >= 0 && gx < 64 && gy >= 0 && gy < 64) return false;
  const cx = gx + 0.5;
  const cy = gy + 0.5;
  const selfRoad = sampleRoadInfo(seed, cx, cy, face);
  if (selfRoad.isMainHighway) return false;
  const selfRiver = sampleRiverInfo(seed, cx, cy, face);
  if (selfRiver.inWater) return false;

  // Check immediate cardinal neighbors for a tunnel road tile whose perpendicular edge borders (gx, gy)
  const nTun = sampleRoadTunnelInfo(seed, cx, cy - 1, face);
  if (nTun.isTunnel && nTun.axis === 'ew') return true;
  const sTun = sampleRoadTunnelInfo(seed, cx, cy + 1, face);
  if (sTun.isTunnel && sTun.axis === 'ew') return true;
  const wTun = sampleRoadTunnelInfo(seed, cx - 1, cy, face);
  if (wTun.isTunnel && wTun.axis === 'ns') return true;
  const eTun = sampleRoadTunnelInfo(seed, cx + 1, cy, face);
  if (eTun.isTunnel && eTun.axis === 'ns') return true;

  return false;
}

/**
 * Continuous deterministic walkable elevation at any world coordinate (wx, wy).
 * Used identically by simulation physics, props, bridges, grass, vehicles, and camera.
 */
export function sampleTerrainHeight(seed: number, wx: number, wy: number, face: CubeFaceId = 0): number {
  const res = isInsideCubeFaceTile(wx, wy) ? { face, gx: wx, gy: wy } : resolveCubeSphereCoord(face, wx, wy);
  const rFace = res.face;
  const rx = res.gx;
  const ry = res.gy;

  const frontier = getFrontierFactor(rx, ry, rFace);
  if (frontier <= 0.0001) return 0;

  if (seed !== heightCacheSeed) {
    rawHillCache.clear();
    terrainHeightCache.clear();
    heightCacheSeed = seed;
  }
  const cKey = quantHeightKey(rFace, rx, ry);
  const cached = terrainHeightCache.get(cKey);
  if (cached !== undefined) return cached;

  // 1. River bridge arch overrides terrain along river-crossing road decks
  const bridge = sampleBridgeInfo(seed, rx, ry, rFace);
  if (bridge.isBridge) {
    if (terrainHeightCache.size >= MAX_HEIGHT_CACHE_ENTRIES) terrainHeightCache.clear();
    terrainHeightCache.set(cKey, bridge.bridgeHeight);
    return bridge.bridgeHeight;
  }

  const rawHill = sampleRawHillHeight(seed, rx, ry, rFace);
  let h = rawHill;

  // 2. Grade hilly roads smoothly & carve road tunnels through big ridges
  const road = sampleRoadInfo(seed, rx, ry, rFace);
  const river = sampleRiverInfo(seed, rx, ry, rFace);
  if (road.highwayDist < 6.0 && river.riverBand >= 0.036) {
    const roadBlend = 1 - smoothstep(2.3, 5.8, road.highwayDist);
    // Smoothly grade roads across hills; through tall ridges (> TUNNEL_HILL_THRESHOLD) carve tunnel floor
    let targetRoadH = rawHill * 0.76;
    if (road.isMainHighway || road.highwayDist < 3.4) {
      const tunnelCut = smoothstep(TUNNEL_HILL_THRESHOLD - 0.55, TUNNEL_HILL_THRESHOLD + 0.15, rawHill);
      const tunnelFloor = 1.15 + clamp((rawHill - TUNNEL_HILL_THRESHOLD) * 0.08, 0, 0.35);
      targetRoadH = targetRoadH * (1 - tunnelCut) + tunnelFloor * tunnelCut;
    }
    // Smoothly ramp onto river bridges at bank approaches
    if (river.riverBand < 0.068) {
      const bankT = 1 - smoothstep(0.044, 0.068, river.riverBand);
      targetRoadH = targetRoadH * (1 - bankT) + 0.20 * bankT;
    }
    h = h * (1 - roadBlend) + targetRoadH * roadBlend;
  }

  // 3. Carve flat floor inside Rocky Cliff Caves, asymmetric isometric wall massif, and smooth S/E mouth aprons
  const caveHit = findRockyCaveAt(seed, wx, wy, face);
  if (caveHit) {
    const { cave, inInterior, inMouth, inWallRing, isFrontCutawayWall, dist } = caveHit;
    if (inInterior || inMouth) {
      h = cave.floorY;
    } else if (inWallRing) {
      if (isFrontCutawayWall) {
        // Keep camera-facing SE wall ring low so isometric terrain NEVER blocks the cutaway cave interior;
        // 3D isometric cutaway walls & FPS upper shells sculpt this rim cleanly!
        h = cave.floorY + 0.55;
      } else {
        // Steep rocky massif rising dramatically behind the NW cliff chamber
        h = Math.max(cave.roofY - 0.15, h + 1.25);
      }
    } else {
      // Smooth exterior blend outside the cliff housing for BOTH South- and East-facing mouths
      const edgeT = smoothstep(cave.chamberRadius + 1.2, 8.2, dist);
      const inSouthApron =
        cave.mouthDir === 's' && wy > cave.gy + 2.0 && Math.abs(wx - (cave.gx + 0.5)) < 3.6;
      const inEastApron =
        cave.mouthDir === 'e' && wx > cave.gx + 2.0 && Math.abs(wy - (cave.gy + 0.5)) < 3.6;
      const anchorH = inSouthApron || inEastApron ? cave.floorY : Math.max(h, cave.floorY + 0.55);
      h = anchorH * (1 - edgeT) + h * edgeT;
    }
  }

  // 4. Keep water tiles flat at y = 0 so water shader aligns flush with shores
  const finalH = river.inWater ? 0 : Math.max(0, h);
  if (terrainHeightCache.size >= MAX_HEIGHT_CACHE_ENTRIES) terrainHeightCache.clear();
  terrainHeightCache.set(cKey, finalH);
  return finalH;
}

/**
 * Ground terrain mesh height used exclusively for displacing the 3D terrain plane vertices.
 * Differs from sampleTerrainHeight ONLY underneath river bridges, where the riverbed stays
 * depressed below WATER_SURFACE_Y so flowing river water passes cleanly under the 3D bridge deck!
 */
export function sampleTerrainMeshHeight(seed: number, wx: number, wy: number, face: CubeFaceId = 0): number {
  const frontier = getFrontierFactor(wx, wy, face);
  if (frontier <= 0.0001) return 0;

  const bridge = sampleBridgeInfo(seed, wx, wy, face);
  if (bridge.isBridge) {
    const river = sampleRiverInfo(seed, wx, wy, face);
    if (river.inWater || river.riverBand < 0.036) {
      // Depress riverbed beneath the water surface so animated water flows continuously under bridges
      return -0.18;
    }
    // Smooth bank abutment ramp from riverbed up to bridge edge
    const bankT = smoothstep(0.036, 0.044, river.riverBand);
    return -0.18 * (1 - bankT) + bridge.bridgeHeight * bankT;
  }

  const ocean = sampleOceanInfo(seed, wx, wy, face);
  if (ocean.inDeepSea) {
    return -0.34;
  }
  if (ocean.inShallowSea) {
    const seaT = smoothstep(0.345, 0.378, ocean.continentVal);
    return -0.34 * (1 - seaT) + -0.06 * seaT;
  }

  const river = sampleRiverInfo(seed, wx, wy, face);
  if (river.inWater) {
    return -0.14;
  }
  if (river.riverBand < 0.036) {
    const shoreT = smoothstep(0.024, 0.036, river.riverBand);
    const groundH = sampleTerrainHeight(seed, wx, wy, face);
    return -0.10 * (1 - shoreT) + groundH * shoreT;
  }

  return sampleTerrainHeight(seed, wx, wy, face);
}

/**
 * Full terrain surface inspection at (wx, wy): height, surface normal, slope, cliff, bridge, tunnel, cave.
 */
export function sampleTerrainSurface(seed: number, wx: number, wy: number, face: CubeFaceId = 0): TerrainSurfaceSample {
  const height = sampleTerrainHeight(seed, wx, wy, face);
  const massifHeight = sampleRawHillHeight(seed, wx, wy, face);
  const bridge = sampleBridgeInfo(seed, wx, wy, face);
  const tunnel = sampleRoadTunnelInfo(seed, wx, wy, face);
  const caveHit = findRockyCaveAt(seed, wx, wy, face);

  // Finite-difference surface normal (step 0.5 tiles)
  const eps = 0.5;
  const hL = sampleTerrainHeight(seed, wx - eps, wy, face);
  const hR = sampleTerrainHeight(seed, wx + eps, wy, face);
  const hD = sampleTerrainHeight(seed, wx, wy - eps, face);
  const hU = sampleTerrainHeight(seed, wx, wy + eps, face);
  const dhdx = (hR - hL) / (2 * eps);
  const dhdz = (hU - hD) / (2 * eps);
  const slope = Math.hypot(dhdx, dhdz);

  const nx = -dhdx;
  const ny = 1;
  const nz = -dhdz;
  const nLen = Math.hypot(nx, ny, nz) || 1;

  const isCave = Boolean(caveHit?.inInterior);
  const isCaveWall = Boolean(caveHit?.inWallRing);
  const isCaveMouth = Boolean(caveHit?.inMouth);
  const isCaveCoveredMouth = Boolean(caveHit?.inCoveredMouth);

  const road = sampleRoadInfo(seed, wx, wy, face);
  // Steep cliffs are impassable outside graded roads, bridges, tunnels, and cave interiors/mouths
  const isCliff =
    !bridge.isBridge &&
    !tunnel.isTunnel &&
    !tunnel.isPortal &&
    !isCave &&
    !isCaveMouth &&
    !road.isAnyRoad &&
    (isCaveWall || slope >= CLIFF_SLOPE_THRESHOLD);

  return {
    height,
    massifHeight,
    normalX: nx / nLen,
    normalY: ny / nLen,
    normalZ: nz / nLen,
    slope,
    isCliff,
    isBridge: bridge.isBridge,
    bridgeAxis: bridge.axis,
    isTunnel: tunnel.isTunnel,
    tunnelAxis: tunnel.axis,
    tunnelRoofY: tunnel.isTunnel ? tunnel.roofY : 0,
    isCave,
    isCaveWall,
    isCaveMouth,
    isCaveCoveredMouth,
    caveId: caveHit && (isCave || isCaveMouth) ? caveHit.cave.id : null,
    caveRoofY: isCave || isCaveCoveredMouth ? caveHit!.cave.roofY : 0,
    isHighGround: height >= 1.35,
  };
}

/**
 * Checks whether moving from (fromX, fromY) to (toX, toY) crosses an impassable bridge guardrail,
 * tunnel retaining wall, or sudden vertical cliff escarpment.
 */
export function isTerrainStepBlocked(
  seed: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  maxStepHeight = 0.68,
  face: CubeFaceId = 0
): boolean {
  // Fast exit inside flat starter town (0..64) on Face 0
  if (
    face === 0 &&
    fromX >= 1 &&
    fromX <= 63 &&
    fromY >= 1 &&
    fromY <= 63 &&
    toX >= 1 &&
    toX <= 63 &&
    toY >= 1 &&
    toY <= 63
  ) {
    return false;
  }

  const fromBridge = sampleBridgeInfo(seed, fromX, fromY, face);
  const toBridge = sampleBridgeInfo(seed, toX, toY, face);

  // 1. Block lateral drop-off or climb-on over elevated river bridge guardrails
  if (fromBridge.isBridge !== toBridge.isBridge) {
    const activeBridge = fromBridge.isBridge ? fromBridge : toBridge;
    const otherX = fromBridge.isBridge ? toX : fromX;
    const otherY = fromBridge.isBridge ? toY : fromY;
    const otherRoad = sampleRoadInfo(seed, otherX, otherY, face);
    const otherRiver = sampleRiverInfo(seed, otherX, otherY, face);
    // Only allow entering/exiting a bridge onto a dry road/approach, NEVER sideways into river/banks!
    if (!otherRoad.isAnyRoad || otherRiver.inWater) {
      return true;
    }
    // Also reject crossing sideways off the bridge axis into a steep drop
    if (activeBridge.bridgeHeight > 0.42 && otherRiver.riverBand < 0.04) {
      return true;
    }
  }

  // 2. Block lateral clipping out of / into highway road tunnel walls
  const fromTun = sampleRoadTunnelInfo(seed, fromX, fromY, face);
  const toTun = sampleRoadTunnelInfo(seed, toX, toY, face);
  if (fromTun.isTunnel && !toTun.isTunnel && !toTun.isPortal) {
    const toRoad = sampleRoadInfo(seed, toX, toY, face);
    if (!toRoad.isMainHighway) return true;
  }
  if (!fromTun.isTunnel && !fromTun.isPortal && toTun.isTunnel) {
    const fromRoad = sampleRoadInfo(seed, fromX, fromY, face);
    if (!fromRoad.isMainHighway) return true;
  }

  // 2b. Keep movement out of the solid walls the renderer stands on tunnel envelope edges (end
  // seals where the road stops inside the envelope, side/corner seals), both directions. The
  // camera is a point, so it must stop at the wall's visible face (slab starts 0.17 inside the
  // claimed cell / 0.07 inside the open cell, plus near-plane clearance), not at the cell
  // boundary. Designed openings (road + portal band) have no wall and stay passable. A position
  // already inside a slab (e.g. an old save) is never trapped: only entering is blocked.
  {
    const slabBlocked = (axis: 'x' | 'y', fromK: number, toK: number, fixed: number): boolean => {
      if (fromK === toK) return false;
      const dir = toK > fromK ? 1 : -1;
      const fromCell = Math.floor(fromK);
      const nCell = fromCell + dir;
      const fixedCell = Math.floor(fixed);
      const [aX, aY, bX, bY] =
        axis === 'y'
          ? [fixedCell, fromCell, fixedCell, nCell]
          : [fromCell, fixedCell, nCell, fixedCell];
      if (!isTunnelEdgeWall(seed, aX, aY, bX, bY, face)) return false;
      const lowClaimed =
        axis === 'y'
          ? isTunnelClaimedCell(seed, fixedCell, Math.min(fromCell, nCell), face)
          : isTunnelClaimedCell(seed, Math.min(fromCell, nCell), fixedCell, face);
      const boundary = Math.max(fromCell, nCell);
      const lo = boundary - (lowClaimed ? TUNNEL_WALL_FACE_CLAIMED : TUNNEL_WALL_FACE_OPEN);
      const hi = boundary + (lowClaimed ? TUNNEL_WALL_FACE_OPEN : TUNNEL_WALL_FACE_CLAIMED);
      const loLim = lo - TUNNEL_WALL_CAMERA_CLEARANCE;
      const hiLim = hi + TUNNEL_WALL_CAMERA_CLEARANCE;
      if (fromK <= loLim) return dir > 0 && toK > loLim;
      if (fromK >= hiLim) return dir < 0 && toK < hiLim;
      // from is inside the expanded slab (old save / teleport): allow only the shortest way out,
      // never passage through to the far side.
      const distLo = fromK - loLim;
      const distHi = hiLim - fromK;
      return distLo <= distHi ? dir > 0 : dir < 0;
    };
    if (slabBlocked('x', fromX, toX, fromY) || slabBlocked('y', fromY, toY, fromX)) return true;
  }

  // 3. Block climbing into/through cave walls (including low cutaway front walls) or steep vertical cliff jumps
  const toCave = findRockyCaveAt(seed, toX, toY, face);
  if (toCave && toCave.inWallRing) {
    return true;
  }

  const toRoad = sampleRoadInfo(seed, toX, toY, face);
  const toCaveOpen = Boolean(toCave && (toCave.inInterior || toCave.inMouth));
  if (!toBridge.isBridge && !toTun.isTunnel && !toRoad.isAnyRoad && !toCaveOpen) {
    const h0 = sampleTerrainHeight(seed, fromX, fromY, face);
    const h1 = sampleTerrainHeight(seed, toX, toY, face);
    const stepDist = Math.max(0.25, Math.hypot(toX - fromX, toY - fromY));
    const grade = Math.abs(h1 - h0) / stepDist;
    if (Math.abs(h1 - h0) > maxStepHeight || grade >= CLIFF_SLOPE_THRESHOLD * 1.18) {
      return true;
    }
  }

  return false;
}

/**
 * Computes movement speed multiplier from directional terrain grade.
 * Uphill slows player/vehicles/zombies proportionally; gentle downhill gives a modest glide.
 */
export function computeSlopeSpeedMultiplier(
  seed: number,
  wx: number,
  wy: number,
  dirX: number,
  dirY: number,
  isVehicle = false,
  face: CubeFaceId = 0
): number {
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen < 0.001) return 1;
  const ux = dirX / dirLen;
  const uy = dirY / dirLen;

  const step = 0.6;
  const h0 = sampleTerrainHeight(seed, wx, wy, face);
  const h1 = sampleTerrainHeight(seed, wx + ux * step, wy + uy * step, face);
  const grade = (h1 - h0) / step; // positive = uphill, negative = downhill

  if (grade > 0.04) {
    const penalty = isVehicle ? grade * 0.62 : grade * 0.48;
    return clamp(1 - penalty, isVehicle ? 0.56 : 0.66, 1.0);
  }
  if (grade < -0.06) {
    const boost = Math.min(isVehicle ? 0.14 : 0.08, Math.abs(grade) * 0.16);
    return 1 + boost;
  }
  return 1;
}

/**
 * High-ground tactical combat bonus when shooting or throwing from an elevated ridge or hill.
 */
export function computeHighGroundCombatBonus(
  shooterY: number,
  targetY: number
): { active: boolean; rangeMultiplier: number; damageMultiplier: number; elevationDelta: number } {
  const delta = shooterY - targetY;
  if (delta < HIGH_GROUND_MIN_DELTA) {
    return { active: false, rangeMultiplier: 1, damageMultiplier: 1, elevationDelta: delta };
  }
  const t = clamp((delta - HIGH_GROUND_MIN_DELTA) / 2.2, 0, 1);
  return {
    active: true,
    rangeMultiplier: 1.18 + t * 0.14, // +18% to +32% range
    damageMultiplier: 1.15 + t * 0.10, // +15% to +25% damage
    elevationDelta: delta,
  };
}

/**
 * Returns true if the tile/position is roofed & sheltered from rain and wind
 * (rocky cliff cave chamber/lintel, highway road tunnel, indoor building floor, or enclosed vehicle).
 * Outer uncovered cave mouth aprons outside the timber lintel remain exposed to weather.
 */
export function getShelterInfo(
  seed: number,
  wx: number,
  wy: number,
  cell: TileCell | null,
  inVehicle: boolean,
  face: CubeFaceId = 0
): { sheltered: boolean; label: string | null; kind: 'cave' | 'tunnel' | 'building' | 'vehicle' | null } {
  const surf = sampleTerrainSurface(seed, wx, wy, face);
  if (surf.isCave || surf.isCaveCoveredMouth) {
    return { sheltered: true, label: 'ROCKY CAVE', kind: 'cave' };
  }
  if (surf.isTunnel) {
    return { sheltered: true, label: 'ROAD TUNNEL', kind: 'tunnel' };
  }
  if (
    cell &&
    (cell.tile === 'floor' ||
      cell.tile === 'floor_rug' ||
      cell.tile === 'floor_bath' ||
      cell.tile === 'tile_clinic' ||
      cell.tile === 'tile_diner')
  ) {
    return {
      sheltered: true,
      label: 'INDOORS',
      kind: 'building',
    };
  }
  if (inVehicle) {
    return { sheltered: true, label: 'VEHICLE CABIN', kind: 'vehicle' };
  }
  return { sheltered: false, label: null, kind: null };
}

/**
 * Checks whether a candidate spawn position lies inside ANY cleared rocky cliff cave,
 * guaranteeing zombies NEVER respawn inside rocky cliffs/caves once cleared.
 */
export function isPointInsideClearedCave(
  seed: number,
  wx: number,
  wy: number,
  clearedCaveIds: ReadonlySet<string>,
  landmarks?: Iterable<WorldLandmark>,
  face: CubeFaceId = 0
): boolean {
  const caveHit = findRockyCaveAt(seed, wx, wy, face);
  if (caveHit && (caveHit.inInterior || caveHit.inMouth || caveHit.dist <= caveHit.cave.chamberRadius + 2.2)) {
    if (clearedCaveIds.has(caveHit.cave.id)) {
      return true;
    }
  }
  if (landmarks) {
    for (const lm of landmarks) {
      if (lm.kind !== 'cave' || !lm.hotspotCleared) continue;
      if (lm.shelterBounds) {
        if (
          wx >= lm.shelterBounds.minX - 2 &&
          wx <= lm.shelterBounds.maxX + 2 &&
          wy >= lm.shelterBounds.minY - 2 &&
          wy <= lm.shelterBounds.maxY + 2
        ) {
          return true;
        }
      } else if (Math.hypot(wx - (lm.gx + 0.5), wy - (lm.gy + 0.5)) <= lm.radius + 2) {
        return true;
      }
    }
  }
  return false;
}

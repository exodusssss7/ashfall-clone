import {
  CUBE_FACE_SIZE,
  PLANET_RADIUS_TILES,
  SPHERE_NOISE_SCALE,
  cubeChunkKey,
  cubeFaceToSphere,
  fbm3D,
  isInsideCubeFaceTile,
  resolveCubeSphereCoord,
  resolveCubeSphereTile,
  samplePlanetTelemetry,
  type CubeFaceId,
} from './cubeSphere';
import { CHUNK_SIZE, MAP_SIZE, clamp } from './isometric';
import { STRUCTURES } from './recipes';
import {
  findRockyCaveAt,
  getMacroRegionCave,
  isTunnelSideWallTile,
  sampleBridgeInfo,
  sampleRoadTunnelInfo,
  sampleTerrainSurface,
} from './terrainSystem';
import type {
  BiomeKind,
  DoorEntity,
  DoorStatus,
  Inventory,
  LandmarkKind,
  LootContainer,
  PropKind,
  TileCell,
  TileKind,
  Vehicle,
  WorldChunk,
  WorldLandmark,
  WorldStore,
  WorldStructure,
  ZombieArchetype,
} from './types';

export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashCoords(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function hashFloat(seed: number, x: number, y: number): number {
  return hashCoords(seed, x, y) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function valueNoise2D(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const n00 = hashFloat(seed, ix, iy);
  const n10 = hashFloat(seed, ix + 1, iy);
  const n01 = hashFloat(seed, ix, iy + 1);
  const n11 = hashFloat(seed, ix + 1, iy + 1);

  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return nx0 + (nx1 - nx0) * uy;
}

export function fbm2D(seed: number, x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(seed + i * 97, x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / (norm || 1);
}

export interface RoomZoneSpec {
  x0: number;
  y0: number;
  w: number;
  h: number;
  floorType: TileKind;
  rug?: { x0: number; y0: number; w: number; h: number };
}

export interface PartitionSpec {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BuildingDoorSpec {
  gx: number;
  gy: number;
  orientation: 'ns' | 'ew';
  status: DoorStatus;
}

export interface BuildingPropSpec {
  gx: number;
  gy: number;
  prop: PropKind;
  lootKind?: LootContainer['kind'];
  lootItems?: Partial<Inventory>;
}

export interface BuildingSpec {
  x0: number;
  y0: number;
  w: number;
  h: number;
  wallType: 'wall_brick' | 'wall_wood';
  floorType: TileKind;
  doors: BuildingDoorSpec[];
  archways?: Array<{ gx: number; gy: number }>;
  partitions?: PartitionSpec[];
  rooms?: RoomZoneSpec[];
  porch?: { x0: number; y0: number; w: number; h: number };
  props: BuildingPropSpec[];
}

export function createDoorEntity(
  gx: number,
  gy: number,
  orientation: 'ns' | 'ew',
  status: DoorStatus = 'closed'
): DoorEntity {
  return {
    id: `door_${gx}_${gy}`,
    gx,
    gy,
    orientation,
    status,
    openProgress: status === 'open' ? 1 : 0,
    hp: 85,
    maxHp: 85,
    barricadeHp: status === 'barricaded' ? 180 : 0,
    maxBarricadeHp: 180,
    lockpickProgress: 0,
    hitFlash: 0,
  };
}

export function applyDoorCellState(cell: TileCell, status: DoorStatus): void {
  cell.prop = 'door';
  if (status === 'open') {
    cell.solid = false;
    cell.blocksSight = false;
  } else {
    cell.solid = true;
    cell.blocksSight = true;
  }
}

export function applyBuildingToSetter(
  setCellProp: (gx: number, gy: number, fn: (cell: TileCell) => void) => void,
  b: BuildingSpec,
  doors: DoorEntity[],
  containers: LootContainer[],
  doorRegistry?: Set<string>
): void {
  const midX = b.x0 + Math.floor(b.w / 2);
  const midY = b.y0 + Math.floor(b.h / 2);

  if (b.porch) {
    for (let y = b.porch.y0; y < b.porch.y0 + b.porch.h; y++) {
      for (let x = b.porch.x0; x < b.porch.x0 + b.porch.w; x++) {
        setCellProp(x, y, (cell) => {
          cell.tile = 'floor_porch';
          cell.prop = 'none';
          cell.solid = false;
          cell.blocksSight = false;
        });
      }
    }
  }

  const doorCoordSet = new Set(b.doors.map((d) => `${d.gx}_${d.gy}`));
  for (let y = b.y0; y < b.y0 + b.h; y++) {
    for (let x = b.x0; x < b.x0 + b.w; x++) {
      const isEdge = x === b.x0 || x === b.x0 + b.w - 1 || y === b.y0 || y === b.y0 + b.h - 1;
      setCellProp(x, y, (cell) => {
        cell.tile = b.floorType;
        cell.prop = 'none';
        cell.solid = false;
        cell.blocksSight = false;

        if (isEdge && !doorCoordSet.has(`${x}_${y}`)) {
          cell.prop = b.wallType;
          cell.solid = true;
          cell.blocksSight = true;
          const isCorner = (x === b.x0 || x === b.x0 + b.w - 1) && (y === b.y0 || y === b.y0 + b.h - 1);
          const nearDoor = b.doors.some((d) => Math.abs(d.gx - x) <= 1 && Math.abs(d.gy - y) <= 1);
          if (
            !isCorner &&
            !nearDoor &&
            ((Math.abs(x - midX) === 2 && (y === b.y0 || y === b.y0 + b.h - 1)) ||
              (Math.abs(y - midY) === 2 && (x === b.x0 || x === b.x0 + b.w - 1)) ||
              (x === midX && (y === b.y0 || y === b.y0 + b.h - 1)) ||
              (y === midY && (x === b.x0 || x === b.x0 + b.w - 1)))
          ) {
            cell.variant = 2; // boarded window
          }
        }
      });
    }
  }

  if (b.rooms) {
    for (const room of b.rooms) {
      for (let y = room.y0; y < room.y0 + room.h; y++) {
        for (let x = room.x0; x < room.x0 + room.w; x++) {
          if (x <= b.x0 || x >= b.x0 + b.w - 1 || y <= b.y0 || y >= b.y0 + b.h - 1) continue;
          setCellProp(x, y, (cell) => {
            if (cell.prop === 'none') {
              cell.tile = room.floorType;
            }
          });
        }
      }
      if (room.rug) {
        for (let y = room.rug.y0; y < room.rug.y0 + room.rug.h; y++) {
          for (let x = room.rug.x0; x < room.rug.x0 + room.rug.w; x++) {
            if (x <= b.x0 || x >= b.x0 + b.w - 1 || y <= b.y0 || y >= b.y0 + b.h - 1) continue;
            setCellProp(x, y, (cell) => {
              if (cell.prop === 'none') {
                cell.tile = 'floor_rug';
              }
            });
          }
        }
      }
    }
  }

  if (b.partitions) {
    for (const part of b.partitions) {
      const minX = Math.min(part.x0, part.x1);
      const maxX = Math.max(part.x0, part.x1);
      const minY = Math.min(part.y0, part.y1);
      const maxY = Math.max(part.y0, part.y1);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const isOuterEdge = x === b.x0 || x === b.x0 + b.w - 1 || y === b.y0 || y === b.y0 + b.h - 1;
          if (isOuterEdge || doorCoordSet.has(`${x}_${y}`)) continue;
          setCellProp(x, y, (cell) => {
            cell.prop = 'wall_interior';
            cell.solid = true;
            cell.blocksSight = true;
          });
        }
      }
    }
  }

  if (b.archways) {
    for (const arch of b.archways) {
      setCellProp(arch.gx, arch.gy, (cell) => {
        cell.prop = 'none';
        cell.solid = false;
        cell.blocksSight = false;
      });
    }
  }

  for (const d of b.doors) {
    setCellProp(d.gx, d.gy, (cell) => {
      applyDoorCellState(cell, d.status);
      const dKey = `${d.gx}_${d.gy}`;
      if (!doorRegistry || !doorRegistry.has(dKey)) {
        doorRegistry?.add(dKey);
        doors.push(createDoorEntity(d.gx, d.gy, d.orientation, d.status));
      }
    });
  }

  for (const item of b.props) {
    setCellProp(item.gx, item.gy, (cell) => {
      if (!cell.solid && cell.prop === 'none') {
        cell.prop = item.prop;
        cell.solid = true;
        cell.blocksSight = false;
        if (item.lootKind && item.lootItems) {
          containers.push({
            id: `c_${item.gx}_${item.gy}`,
            gx: item.gx,
            gy: item.gy,
            kind: item.lootKind,
            items: { ...item.lootItems },
            searched: false,
            searchProgress: 0,
            openAnim: 0,
          });
        }
      }
    });
  }
}

export function chunkKey(cx: number, cy: number, face: CubeFaceId = 0): string {
  return cubeChunkKey(face, cx, cy);
}

export function isOriginSectorChunk(cx: number, cy: number, face: CubeFaceId = 0): boolean {
  return face === 0 && cx >= 0 && cx <= 3 && cy >= 0 && cy <= 3;
}

export function mainEwHighwayY(seed: number, gx: number): number {
  const distFromTown = gx < 0 ? -gx : gx >= 64 ? gx - 63 : 0;
  const amp = 24 * smoothstep(24, 96, distFromTown);
  const phase = (seed % 97) * 0.13;
  const wave =
    Math.sin(gx * 0.022 + phase) * 0.55 +
    (fbm2D(seed + 101, gx * 0.013, 3.7, 2) - 0.5) * 1.45;
  return 28 + wave * amp;
}

export function mainNsHighwayX(seed: number, gy: number): number {
  const distFromTown = gy < 0 ? -gy : gy >= 64 ? gy - 63 : 0;
  const amp = 24 * smoothstep(24, 96, distFromTown);
  const phase = (seed % 73) * 0.17;
  const wave =
    Math.cos(gy * 0.021 + phase) * 0.55 +
    (fbm2D(seed + 202, 7.1, gy * 0.013, 2) - 0.5) * 1.45;
  return 28 + wave * amp;
}

function secondaryEwHighwayY(seed: number, gx: number, bandIdx: number): number {
  const base = 28 + bandIdx * 108;
  const wave =
    Math.sin(gx * 0.02 + bandIdx * 1.7) * 14 +
    (fbm2D(seed + 313 + bandIdx * 17, gx * 0.014, bandIdx * 5.3, 2) - 0.5) * 26;
  return base + wave;
}

function secondaryNsHighwayX(seed: number, gy: number, bandIdx: number): number {
  const base = 28 + bandIdx * 108;
  const wave =
    Math.cos(gy * 0.02 + bandIdx * 1.9) * 14 +
    (fbm2D(seed + 419 + bandIdx * 23, bandIdx * 4.7, gy * 0.014, 2) - 0.5) * 26;
  return base + wave;
}

function countryEwLaneY(seed: number, gx: number, laneIdx: number): number {
  const base = 28 + 54 + laneIdx * 108;
  const wave =
    Math.sin(gx * 0.024 + laneIdx * 2.1 + (seed % 53) * 0.11) * 9 +
    (fbm2D(seed + 557 + laneIdx * 19, gx * 0.015, laneIdx * 3.7, 2) - 0.5) * 14;
  return base + wave;
}

function countryNsLaneX(seed: number, gy: number, laneIdx: number): number {
  const base = 28 + 54 + laneIdx * 108;
  const wave =
    Math.cos(gy * 0.024 + laneIdx * 1.7 + (seed % 47) * 0.13) * 9 +
    (fbm2D(seed + 661 + laneIdx * 23, laneIdx * 4.1, gy * 0.015, 2) - 0.5) * 14;
  return base + wave;
}

export interface RoadSample {
  isMainHighway: boolean;
  isCountryRoad: boolean;
  isAnyRoad: boolean;
  isShoulder: boolean;
  highwayDist: number;
  roadAxis: 'ew' | 'ns' | 'junction' | 'none';
  centerOffset: number;
}

export function sampleRoadInfo(
  seed: number,
  gx: number,
  gy: number,
  face: CubeFaceId = 0
): RoadSample {
  const res = isInsideCubeFaceTile(gx, gy) ? { face, gx, gy } : resolveCubeSphereCoord(face, gx, gy);
  const rFace = res.face;
  const rx = res.gx;
  const ry = res.gy;

  // Starter town sector (0..63, 0..63) on Face 0 (Ashfall Crown) stays aligned to town crossroads
  if (rFace === 0 && rx >= 0 && rx < 64 && ry >= 0 && ry < 64) {
    const dx = Math.abs(rx - 28);
    const dy = Math.abs(ry - 28);
    const d = Math.min(dx, dy);
    return {
      isMainHighway: d <= 2.1,
      isCountryRoad: false,
      isAnyRoad: d <= 2.1,
      isShoulder: d > 2.1 && d <= 3.1,
      highwayDist: d,
      roadAxis: dx <= 3 && dy <= 3 ? 'junction' : dy <= 3 ? 'ew' : dx <= 3 ? 'ns' : 'none',
      centerOffset: dy <= dx ? ry - 28 : rx - 28,
    };
  }

  // Project onto the 3D unit sphere S^2 so planetary ring highways loop seamlessly around all 6 faces
  const p = cubeFaceToSphere(rFace, rx, ry);

  // Smooth organic great-circle highway warping in 3D sphere space (scaled to massive 2,048-tile globe)
  const warpScale = 2.4 * SPHERE_NOISE_SCALE;
  const warpAmp = 0.22 / SPHERE_NOISE_SCALE;
  const warpZ = (fbm3D(seed + 101, p.x * warpScale, p.y * warpScale, p.z * warpScale, 2) - 0.5) * warpAmp;
  const warpX = (fbm3D(seed + 202, p.x * warpScale + 4.3, p.y * warpScale - 2.1, p.z * warpScale, 2) - 0.5) * warpAmp;
  const warpY = (fbm3D(seed + 313, p.x * warpScale - 3.1, p.y * warpScale + 5.7, p.z * warpScale, 2) - 0.5) * warpAmp * 1.1;

  // Near starter town on Face 0, smoothly blend the two prime meridians from town crossroads (gx=28, gy=28)
  let townBlend = 0;
  if (rFace === 0) {
    const distFromTown = Math.hypot(rx - 31.5, ry - 31.5);
    townBlend = 1 - smoothstep(32, 84, distFromTown);
  }
  const townOffsetZ = -4 / (CUBE_FACE_SIZE * 0.5); // gy=28 sits 4 tiles north of Face 0 center (gy=32)
  const townOffsetX = -4 / (CUBE_FACE_SIZE * 0.5); // gx=28 sits 4 tiles west of Face 0 center (gx=32)

  // Planetary Great-Circle & Continental Ring Highway Network:
  // 1) East-West Prime Meridian (p.z ~ 0)
  // 2) North-South Prime Meridian (p.x ~ 0)
  // 3) Equatorial Beltway (p.y ~ 0) + Northern/Southern Continental Ring Highways (p.y ~ +/-0.55)
  const zTarget = townOffsetZ * townBlend + warpZ * (1 - townBlend);
  const xTarget = townOffsetX * townBlend + warpX * (1 - townBlend);
  const yTarget = warpY;

  const distMercEW = Math.abs(p.z - zTarget) * PLANET_RADIUS_TILES;
  const distMercNS = Math.abs(p.x - xTarget) * PLANET_RADIUS_TILES;
  const distEquator = Math.abs(p.y - yTarget) * PLANET_RADIUS_TILES;
  const distNorthRing = Math.abs(p.y - (0.55 + warpY * 0.8)) * PLANET_RADIUS_TILES;
  const distSouthRing = Math.abs(p.y - (-0.55 + warpY * 0.8)) * PLANET_RADIUS_TILES;
  const distLatRing = Math.min(distEquator, distNorthRing, distSouthRing);

  let bestHwyDist = distMercEW;
  let bestAxis: 'ew' | 'ns' = 'ew';
  let bestOffset = (p.z - zTarget) * PLANET_RADIUS_TILES;

  if (distMercNS < bestHwyDist) {
    bestHwyDist = distMercNS;
    bestAxis = 'ns';
    bestOffset = (p.x - xTarget) * PLANET_RADIUS_TILES;
  }
  if (distLatRing < bestHwyDist) {
    bestHwyDist = distLatRing;
    bestAxis = rFace === 1 || rFace === 2 ? 'ns' : 'ew';
    bestOffset = (p.y - yTarget) * PLANET_RADIUS_TILES;
  }

  // Diagonal spherical country gravel backroads connecting rural interiors (away from starter town)
  let countryDist = 99;
  const nearTownSafe = rFace === 0 ? smoothstep(46, 62, Math.hypot(rx - 31.5, ry - 31.5)) : 1;
  if (nearTownSafe >= 0.9) {
    const cFreq = 3.2 * SPHERE_NOISE_SCALE;
    const cAmp = 0.16 / SPHERE_NOISE_SCALE;
    const cWarpA = (fbm3D(seed + 557, p.x * cFreq, p.y * cFreq, p.z * cFreq, 2) - 0.5) * cAmp;
    const cWarpB = (fbm3D(seed + 661, p.x * cFreq + 2.9, p.y * cFreq - 4.1, p.z * cFreq, 2) - 0.5) * cAmp;
    const dDiagA = Math.abs((p.x - p.z) * 0.70710678 - cWarpA) * PLANET_RADIUS_TILES;
    const dDiagB = Math.abs((p.x + p.z) * 0.70710678 - cWarpB) * PLANET_RADIUS_TILES;
    countryDist = Math.min(dDiagA, dDiagB);
  }

  const isMainHighway = bestHwyDist <= 2.35;
  const isCountryRoad = !isMainHighway && countryDist <= 1.35;
  const isShoulder = !isMainHighway && !isCountryRoad && (bestHwyDist <= 3.35 || countryDist <= 2.05);
  const nearJunction =
    (distMercEW <= 3.2 && distMercNS <= 3.2) ||
    (distMercEW <= 3.2 && distEquator <= 3.2) ||
    (distMercNS <= 3.2 && distEquator <= 3.2);
  const roadAxis: RoadSample['roadAxis'] = nearJunction
    ? 'junction'
    : isMainHighway || isCountryRoad
      ? bestAxis
      : 'none';

  return {
    isMainHighway,
    isCountryRoad,
    isAnyRoad: isMainHighway || isCountryRoad,
    isShoulder,
    highwayDist: Math.min(bestHwyDist, countryDist),
    roadAxis,
    centerOffset: bestOffset,
  };
}

export interface OceanSample {
  inDeepSea: boolean;
  inShallowSea: boolean;
  inSeaWater: boolean;
  inBeach: boolean;
  inDune: boolean;
  /** 0 in deep sea -> 1 far inland; used for smooth beach-to-inland elevation ramp */
  landMask: number;
  continentVal: number;
}

/**
 * Evaluates 3D spherical continental shelves across the Cube-Sphere planet.
 * Carves vast deep-sea ocean basins ringed by shallow surf zones, wide golden sandy beaches,
 * and coastal dune transitions (while keeping Face 0 starter town & immediate ring dry).
 */
export function sampleOceanInfo(
  seed: number,
  gx: number,
  gy: number,
  face: CubeFaceId = 0
): OceanSample {
  const res = isInsideCubeFaceTile(gx, gy) ? { face, gx, gy } : resolveCubeSphereCoord(face, gx, gy);
  const rFace = res.face;
  const rx = res.gx;
  const ry = res.gy;

  // Keep Face 0 Ashfall Crossroads starter town and immediate highway exits safely inland
  if (rFace === 0) {
    const dTown = Math.hypot(rx - 31.5, ry - 31.5);
    if (dTown < 92) {
      return { inDeepSea: false, inShallowSea: false, inSeaWater: false, inBeach: false, inDune: false, landMask: 1, continentVal: 0.75 };
    }
  }

  const p = cubeFaceToSphere(rFace, rx, ry);
  const cFreq = 0.72 * SPHERE_NOISE_SCALE;
  const warpFreq = 1.45 * SPHERE_NOISE_SCALE;
  const wAmp = 0.14 / SPHERE_NOISE_SCALE;
  const wx = (fbm3D(seed + 1151, p.x * warpFreq, p.y * warpFreq, p.z * warpFreq, 2) - 0.5) * wAmp;
  const wy = (fbm3D(seed + 1163, p.x * warpFreq + 3.1, p.y * warpFreq - 2.4, p.z * warpFreq + 1.7, 2) - 0.5) * wAmp;
  const wz = (fbm3D(seed + 1171, p.x * warpFreq - 2.2, p.y * warpFreq + 4.2, p.z * warpFreq - 3.3, 2) - 0.5) * wAmp;

  let cont = fbm3D(seed + 1187, (p.x + wx) * cFreq, (p.y + wy) * cFreq, (p.z + wz) * cFreq, 3);
  // Gently lift Face 0 around the starter town so the continent transitions smoothly into coastal beaches
  if (rFace === 0) {
    const dTown = Math.hypot(rx - 31.5, ry - 31.5);
    const townLift = (1 - smoothstep(92, 160, dTown)) * 0.34;
    cont = clamp(cont + townLift, 0, 1);
  }

  const inDeepSea = cont < 0.345;
  const inShallowSea = !inDeepSea && cont < 0.378;
  const inSeaWater = inDeepSea || inShallowSea;
  const inBeach = !inSeaWater && cont < 0.425;
  const inDune = !inSeaWater && !inBeach && cont < 0.455;
  const landMask = smoothstep(0.405, 0.51, cont);

  return { inDeepSea, inShallowSea, inSeaWater, inBeach, inDune, landMask, continentVal: cont };
}

export interface RiverSample {
  inWater: boolean;
  inBankSand: boolean;
  inFloodMud: boolean;
  riverBand: number;
}

export function sampleRiverInfo(
  seed: number,
  gx: number,
  gy: number,
  face: CubeFaceId = 0
): RiverSample {
  const res = isInsideCubeFaceTile(gx, gy) ? { face, gx, gy } : resolveCubeSphereCoord(face, gx, gy);
  const rFace = res.face;
  const rx = res.gx;
  const ry = res.gy;

  // Keep starter town (0..63) and immediate East exit highway (84, 28) on Face 0 dry
  if (rFace === 0) {
    const distFromTown = Math.hypot(rx - 31.5, ry - 31.5);
    const distFromEastExit = Math.hypot(rx - 84, ry - 28);
    if (distFromTown < 48 || distFromEastExit < 10) {
      return { inWater: false, inBankSand: false, inFloodMud: false, riverBand: 1 };
    }
  }

  // Domain-warped 3D spherical noise scaled proportionally to planet radius
  const p = cubeFaceToSphere(rFace, rx, ry);
  const wFreq = 2.8 * SPHERE_NOISE_SCALE;
  const wAmp = 0.26 / SPHERE_NOISE_SCALE;
  const warpX = (fbm3D(seed + 601, p.x * wFreq, p.y * wFreq, p.z * wFreq, 2) - 0.5) * wAmp;
  const warpY = (fbm3D(seed + 607, p.x * wFreq + 5.1, p.y * wFreq - 3.3, p.z * wFreq + 1.9, 2) - 0.5) * wAmp;
  const warpZ = (fbm3D(seed + 613, p.x * wFreq - 2.7, p.y * wFreq + 4.4, p.z * wFreq - 3.8, 2) - 0.5) * wAmp;

  const rFreq = 2.15 * SPHERE_NOISE_SCALE;
  const n = fbm3D(seed + 409, (p.x + warpX) * rFreq, (p.y + warpY) * rFreq, (p.z + warpZ) * rFreq, 3);
  const band = Math.abs(n - 0.5);

  // Slightly wider braided river channels in the Emerald River Basin (+Z hemisphere)
  const basinBonus = clamp(p.z * 0.005, 0, 0.005);
  const inWater = band < 0.025 + basinBonus;
  const inBankSand = !inWater && band < 0.039 + basinBonus;
  const inFloodMud = !inWater && !inBankSand && band < 0.056 + basinBonus;
  return { inWater, inBankSand, inFloodMud, riverBand: band };
}

export function sampleBiomeAt(
  seed: number,
  gx: number,
  gy: number,
  face: CubeFaceId = 0
): BiomeKind {
  const res = isInsideCubeFaceTile(gx, gy) ? { face, gx, gy } : resolveCubeSphereCoord(face, gx, gy);
  const rFace = res.face;
  const rx = res.gx;
  const ry = res.gy;

  if (rFace === 0 && rx >= 0 && rx < 64 && ry >= 0 && ry < 64) {
    return 'town_edge';
  }
  const river = sampleRiverInfo(seed, rx, ry, rFace);
  if (river.riverBand < 0.088) {
    return 'river_valley';
  }

  // Seamless 3D spherical climate (moisture & heat) scaled for grand continental biomes
  const p = cubeFaceToSphere(rFace, rx, ry);
  const bFreq = 1.95 * SPHERE_NOISE_SCALE;
  const rawMoisture = fbm3D(seed + 701, p.x * bFreq, p.y * bFreq, p.z * bFreq, 3);
  const rawHeat = fbm3D(seed + 911, p.x * bFreq + 6.4, p.y * bFreq - 3.8, p.z * bFreq + 2.2, 3);

  // Smooth hemisphere climate biases (no hard face borders!)
  const moisture = clamp(rawMoisture + p.x * 0.08 + p.z * 0.09 - (-p.x) * 0.07 - (-p.y) * 0.08, 0, 1);
  const heat = clamp(rawHeat + (-p.x) * 0.10 + (-p.y) * 0.14 - p.z * 0.05 - (-p.z) * 0.08, 0, 1);

  if (heat > 0.56 && moisture < 0.51) {
    return 'scorched_barrens';
  }
  if (moisture > 0.49) {
    return 'pine_forest';
  }
  return 'rural_meadow';
}

export function getBiomeDisplayName(biome: BiomeKind): string {
  switch (biome) {
    case 'town_edge':
      return 'ASHFALL CROSSROADS';
    case 'pine_forest':
      return 'WHISPERING PINES';
    case 'river_valley':
      return 'MUDDY RIVER VALLEY';
    case 'scorched_barrens':
      return 'SCORCHED HIGHWAY';
    case 'rural_meadow':
    default:
      return 'OVERGROWN MEADOWS';
  }
}

export function createOuterBaseCell(seed: number, gx: number, gy: number, face: CubeFaceId = 0): TileCell {
  const h = hashCoords(seed + face * 10007, gx, gy);
  const r = (h % 1000) / 1000;
  const biome = sampleBiomeAt(seed, gx, gy, face);
  const road = sampleRoadInfo(seed, gx, gy, face);
  const river = sampleRiverInfo(seed, gx, gy, face);

  // Smooth organic patch noise instead of white-noise 1x1 tile speckling
  const patch = fbm2D(seed + 111, gx * 0.14, gy * 0.14, 2) + (r - 0.5) * 0.14;
  const wear = fbm2D(seed + 223, gx * 0.22, gy * 0.22, 2) + (r - 0.5) * 0.16;

  let tile: TileKind = 'grass';
  if (biome === 'pine_forest') {
    tile = patch < 0.57 ? 'forest_floor' : patch < 0.71 ? 'grass' : 'dirt';
  } else if (biome === 'river_valley') {
    tile = patch < 0.44 ? 'mud' : patch < 0.60 ? 'grass' : patch < 0.74 ? 'forest_floor' : 'dirt';
  } else if (biome === 'scorched_barrens') {
    tile = patch < 0.52 ? 'dirt' : patch < 0.70 ? 'gravel' : 'grass';
  } else {
    tile = patch < 0.60 ? 'grass' : patch < 0.74 ? 'dirt' : 'forest_floor';
  }

  let solid = false;
  let blocksSight = false;
  let prop: PropKind = 'none';
  let variant = h % 4;

  const ocean = sampleOceanInfo(seed, gx, gy, face);

  // Carve deep sea ocean basins, wide golden sandy beaches & winding rivers
  if (ocean.inSeaWater) {
    tile = 'water';
    solid = false;
  } else if (ocean.inBeach) {
    tile = 'sand';
    solid = false;
  } else if (ocean.inDune) {
    tile = patch < 0.64 ? 'sand' : 'grass';
    solid = false;
  } else if (river.inWater) {
    tile = 'water';
    solid = false;
  } else if (river.inBankSand) {
    tile = patch < 0.65 ? 'sand' : 'mud';
  } else if (river.inFloodMud) {
    tile = patch < 0.58 ? 'mud' : tile;
  }

  // Overlay winding highways, country roads, and elevated bridges across rivers!
  const bridge = sampleBridgeInfo(seed, gx + 0.5, gy + 0.5, face);
  if (bridge.isBridge) {
    tile = 'bridge_deck';
    solid = false;
    variant = bridge.axis === 'ns' ? 2 + (h % 2) : h % 2;
  } else if (road.isMainHighway) {
    if (ocean.inSeaWater || river.inWater || river.riverBand < 0.033) {
      tile = 'bridge_deck';
      solid = false;
    } else {
      const crackedThreshold = biome === 'scorched_barrens' ? 0.44 : 0.56;
      tile = wear > crackedThreshold ? 'asphalt_cracked' : 'road';
      if (tile === 'road' && Math.abs(road.centerOffset) < 0.6 && ((gx + gy) & 1) === 0) {
        variant = 0; // centerline dash
      } else {
        variant = 1 + (h % 3);
      }
      solid = false;
    }
  } else if (road.isCountryRoad) {
    if (ocean.inSeaWater || river.inWater || river.riverBand < 0.033) {
      tile = 'bridge_deck';
      solid = false;
    } else {
      tile = wear < 0.65 ? 'gravel' : 'dirt';
      solid = false;
    }
  } else if (road.isShoulder && !river.inWater) {
    tile = wear < 0.62 ? 'gravel' : 'dirt';
  }

  // Stamp hidden Rocky Cliff Caves, solid tunnel retaining shoulders & impassable steep cliff escarpments
  const caveHit = findRockyCaveAt(seed, gx + 0.5, gy + 0.5, face);
  if (caveHit && (caveHit.inInterior || caveHit.inMouth)) {
    tile = 'cave_floor';
    prop = 'none';
    solid = false;
    blocksSight = false;
  } else if (caveHit && caveHit.inWallRing) {
    tile = 'cliff_stone';
    // Only stamp tall cliff_rock props on the NW back cliff massif; SE foreground cutaway rim
    // is rendered by the custom isometric cutaway stone shell in threeRenderer!
    prop = caveHit.isFrontCutawayWall ? 'none' : 'cliff_rock';
    solid = true;
    blocksSight = true;
  } else if (!bridge.isBridge && !river.inWater && isTunnelSideWallTile(seed, gx, gy, face)) {
    tile = 'cliff_stone';
    const tunNorth = sampleRoadTunnelInfo(seed, gx + 0.5, gy - 0.5, face).isTunnel;
    const tunWest = sampleRoadTunnelInfo(seed, gx - 0.5, gy + 0.5, face).isTunnel;
    // Camera-facing (+Z/+X) tunnel retaining wall stays low in ISO (rendered by threeRenderer cutaway curb + FPS upper wall)
    prop = tunNorth || tunWest ? 'none' : 'cliff_rock';
    solid = true;
    blocksSight = true;
  } else if (!bridge.isBridge && !river.inWater) {
    const surf = sampleTerrainSurface(seed, gx + 0.5, gy + 0.5, face);
    if (surf.isCliff) {
      const touchesBridge =
        sampleBridgeInfo(seed, gx + 1.5, gy + 0.5, face).isBridge ||
        sampleBridgeInfo(seed, gx - 0.5, gy + 0.5, face).isBridge ||
        sampleBridgeInfo(seed, gx + 0.5, gy + 1.5, face).isBridge ||
        sampleBridgeInfo(seed, gx + 0.5, gy - 0.5, face).isBridge;
      tile = 'cliff_stone';
      prop = touchesBridge ? 'none' : 'cliff_rock';
      solid = true;
      blocksSight = !touchesBridge;
    }
  }

  return {
    gx,
    gy,
    tile,
    prop,
    solid,
    blocksSight,
    variant,
    explored: false,
  };
}

interface RegionPOIPlan {
  id: string;
  kind: LandmarkKind;
  name: string;
  biome: BiomeKind;
  gx: number;
  gy: number;
  radius: number;
  threatLevel: 'low' | 'medium' | 'high';
  hotspotPacks: ZombieArchetype[];
  hasPierPond?: boolean;
  includeDrivableCar?: boolean;
}

function getMacroRegionPOI(seed: number, rx: number, ry: number, face: CubeFaceId = 0): RegionPOIPlan | null {
  // Never override the 4x4 origin sector (rx in 0..1, ry in 0..1) on Face 0 (Ashfall Crown)
  if (face === 0 && rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1) return null;

  const h = hashCoords(seed + 1337 + face * 10007, rx, ry);
  const lmPrefix = face === 0 ? 'lm' : `f${face}_lm`;
  const rng = createRng(h);

  // Leave ~18% of macro-regions as pure untamed wilderness
  if (rng() < 0.18) return null;

  const regStartX = rx * 32;
  const regStartY = ry * 32;

  // Scan candidate interior coordinates (margin 8 tiles so footprints stay localized & clean)
  let highwaySpot: { gx: number; gy: number; dist: number } | null = null;
  let riverSpot: { gx: number; gy: number } | null = null;
  let drySpot: { gx: number; gy: number } | null = null;

  const regionCave = getMacroRegionCave(seed, rx, ry, face);

  const isFootprintDryAndRoadFree = (cx: number, cy: number, pad = 6): boolean => {
    if (regionCave && Math.hypot(cx - regionCave.gx, cy - regionCave.gy) < 12) return false;
    for (let dy = -pad; dy <= pad; dy += 2) {
      for (let dx = -pad; dx <= pad; dx += 2) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (sampleRoadInfo(seed, tx, ty, face).isAnyRoad) return false;
        if (sampleRiverInfo(seed, tx, ty, face).inWater || sampleOceanInfo(seed, tx, ty, face).inSeaWater) return false;
        const surf = sampleTerrainSurface(seed, tx + 0.5, ty + 0.5, face);
        if (surf.isCliff || surf.slope > 0.44) return false;
      }
    }
    return true;
  };

  for (let gy = regStartY + 8; gy <= regStartY + 23; gy += 2) {
    for (let gx = regStartX + 8; gx <= regStartX + 23; gx += 2) {
      // Keep East highway starter test sector clean through gx = 90 on Face 0
      if (face === 0 && gx >= 56 && gx <= 92 && gy >= 22 && gy <= 35) continue;

      const road = sampleRoadInfo(seed, gx, gy, face);
      const river = sampleRiverInfo(seed, gx, gy, face);
      const tunnel = sampleRoadTunnelInfo(seed, gx + 0.5, gy + 0.5, face);

      if (road.isMainHighway && !river.inWater && !sampleOceanInfo(seed, gx, gy, face).inSeaWater && river.riverBand > 0.04 && !tunnel.isTunnel && !tunnel.isPortal) {
        if (!highwaySpot || Math.abs(road.centerOffset) < highwaySpot.dist) {
          highwaySpot = { gx, gy, dist: Math.abs(road.centerOffset) };
        }
      }
      if (!road.isAnyRoad && river.inBankSand && isFootprintDryAndRoadFree(gx, gy, 3)) {
        if (!riverSpot || (h & 1) === 0) {
          riverSpot = { gx, gy };
        }
      }
      if (!road.isAnyRoad && !river.inWater && river.riverBand > 0.065 && road.highwayDist > 7.5) {
        if (!drySpot && isFootprintDryAndRoadFree(gx, gy, 6)) {
          drySpot = { gx, gy };
        }
      }
    }
  }

  const telemetryCenter = samplePlanetTelemetry(face, regStartX + 16, regStartY + 16);
  const distRing = face === 0 ? Math.hypot(rx - 0.5, ry - 0.5) : 3.5 + telemetryCenter.threatFactor * 3;
  const roll = rng();

  // 1. Highway Pileups & Military Checkpoints on major curved highways
  if (highwaySpot && roll < 0.72) {
    const isCheckpoint = rng() < 0.48;
    const biome = sampleBiomeAt(seed, highwaySpot.gx, highwaySpot.gy, face);
    const id = `${lmPrefix}_${rx}_${ry}`;
    if (isCheckpoint) {
      return {
        id,
        kind: 'checkpoint',
        name: `Checkpoint ${Math.abs(rx) + Math.abs(ry)}-${(h % 9) + 1}`,
        biome,
        gx: highwaySpot.gx,
        gy: highwaySpot.gy,
        radius: 9,
        threatLevel: 'high',
        hotspotPacks:
          distRing > 3
            ? ['runner', 'runner', 'spitter', 'bloater', 'walker', 'walker']
            : ['runner', 'spitter', 'bloater', 'walker'],
        includeDrivableCar: rng() < 0.55,
      };
    }
    return {
      id,
      kind: 'pileup',
      name: `Highway Pileup R-${(h % 89) + 10}`,
      biome,
      gx: highwaySpot.gx,
      gy: highwaySpot.gy,
      radius: 9,
      threatLevel: 'high',
      hotspotPacks:
        distRing > 3
          ? ['runner', 'bloater', 'runner', 'walker', 'walker', 'spitter']
          : ['runner', 'bloater', 'walker', 'walker'],
      includeDrivableCar: rng() < 0.42,
    };
  }

  // 2. Riverside / Forest Campgrounds
  if (riverSpot && roll < 0.65) {
    const biome = sampleBiomeAt(seed, riverSpot.gx, riverSpot.gy, face);
    return {
      id: `${lmPrefix}_${rx}_${ry}`,
      kind: 'campground',
      name: `River Camp #${(h % 47) + 1}`,
      biome,
      gx: riverSpot.gx,
      gy: riverSpot.gy,
      radius: 7,
      threatLevel: 'medium',
      hotspotPacks: ['walker', 'walker', 'runner', 'spitter'],
    };
  }

  // 3. Dry-ground varied buildings or forest campgrounds
  if (!drySpot) return null;
  const anchor = drySpot;
  // Make sure anchor doesn't collide with East highway test coord (84, 28)
  if (face === 0 && Math.hypot(anchor.gx - 84, anchor.gy - 28) < 12) return null;

  const biome = sampleBiomeAt(seed, anchor.gx, anchor.gy, face);
  const subRoll = rng();

  if (biome === 'pine_forest' && subRoll < 0.44) {
    return {
      id: `${lmPrefix}_${rx}_${ry}`,
      kind: 'campground',
      name: `Pinewood Camp #${(h % 39) + 1}`,
      biome,
      gx: anchor.gx,
      gy: anchor.gy,
      radius: 7,
      threatLevel: 'medium',
      hotspotPacks: ['walker', 'runner', 'walker'],
      hasPierPond: rng() < 0.35,
    };
  }

  const buildingPool: LandmarkKind[] =
    biome === 'scorched_barrens'
      ? ['bunker', 'gas_station', 'outpost', 'diner', 'watchtower']
      : biome === 'pine_forest'
        ? ['watchtower', 'cabin', 'bunker', 'outpost', 'clinic']
        : biome === 'river_valley'
          ? ['farmstead', 'gas_station', 'cabin', 'diner', 'clinic']
          : ['farmstead', 'gas_station', 'diner', 'clinic', 'watchtower', 'bunker', 'cabin', 'outpost'];

  const kind = buildingPool[h % buildingPool.length];
  const labelPrefix =
    kind === 'clinic'
      ? 'Field Clinic'
      : kind === 'diner'
        ? 'Roadside Diner'
        : kind === 'outpost'
          ? 'Ranger Outpost'
          : kind === 'gas_station'
            ? 'Fuel Depot'
            : kind === 'bunker'
              ? 'Fallout Bunker'
              : kind === 'farmstead'
                ? 'Abandoned Farmstead'
                : kind === 'watchtower'
                  ? 'Fire Watchtower'
                  : 'Timber Cabin';

  const isHighThreat = kind === 'outpost' || kind === 'bunker' || distRing > 4.2;
  return {
    id: `${lmPrefix}_${rx}_${ry}`,
    kind,
    name: `${labelPrefix} ${(h % 29) + 1}`,
    biome,
    gx: anchor.gx,
    gy: anchor.gy,
    radius: kind === 'bunker' || kind === 'gas_station' ? 9 : 8,
    threatLevel: isHighThreat ? 'high' : 'medium',
    hotspotPacks:
      kind === 'bunker'
        ? ['runner', 'runner', 'bloater', 'spitter', 'walker', 'walker']
        : kind === 'outpost' || kind === 'watchtower'
          ? ['runner', 'spitter', 'bloater', 'walker']
          : kind === 'gas_station'
            ? ['runner', 'bloater', 'walker', 'walker']
            : ['walker', 'walker', 'runner'],
    includeDrivableCar: kind === 'gas_station' ? rng() < 0.72 : kind === 'farmstead' ? rng() < 0.35 : false,
  };
}

function createBuildingSpecForLandmark(poi: RegionPOIPlan, seed: number): BuildingSpec {
  const bx = poi.gx - 5;
  const by = poi.gy - 4;
  const h = hashCoords(seed + 881, poi.gx, poi.gy);

  if (poi.kind === 'clinic') {
    return {
      x0: bx,
      y0: by,
      w: 11,
      h: 9,
      wallType: 'wall_brick',
      floorType: 'tile_clinic',
      porch: { x0: bx + 4, y0: by + 9, w: 3, h: 1 },
      doors: [
        { gx: bx + 5, gy: by + 8, orientation: 'ew', status: h % 2 === 0 ? 'locked' : 'closed' },
        { gx: bx + 4, gy: by + 4, orientation: 'ew', status: 'closed' },
        { gx: bx + 6, gy: by + 2, orientation: 'ns', status: 'closed' },
      ],
      partitions: [
        { x0: bx + 1, y0: by + 4, x1: bx + 9, y1: by + 4 },
        { x0: bx + 6, y0: by + 1, x1: bx + 6, y1: by + 3 },
      ],
      rooms: [
        { x0: bx + 1, y0: by + 5, w: 9, h: 3, floorType: 'tile_clinic' },
        { x0: bx + 1, y0: by + 1, w: 5, h: 3, floorType: 'tile_clinic', rug: { x0: bx + 2, y0: by + 2, w: 2, h: 1 } },
        { x0: bx + 7, y0: by + 1, w: 3, h: 3, floorType: 'floor_bath' },
      ],
      props: [
        { gx: bx + 1, gy: by + 5, prop: 'counter' },
        { gx: bx + 2, gy: by + 5, prop: 'desk' },
        { gx: bx + 9, gy: by + 5, prop: 'bench' },
        {
          gx: bx + 9,
          gy: by + 7,
          prop: 'crate_wood',
          lootKind: 'crate_wood',
          lootItems: { cloth: 2, scrap: 1, water: 1 },
        },
        { gx: bx + 1, gy: by + 1, prop: 'bed' },
        { gx: bx + 3, gy: by + 1, prop: 'desk' },
        {
          gx: bx + 5,
          gy: by + 1,
          prop: 'med_cabinet',
          lootKind: 'med_cabinet',
          lootItems: { bandage: 2 + (h % 2), cloth: 2, water: 2 },
        },
        { gx: bx + 9, gy: by + 1, prop: 'sink_toilet' },
        { gx: bx + 7, gy: by + 1, prop: 'bench' },
      ],
    };
  }

  if (poi.kind === 'diner') {
    return {
      x0: bx,
      y0: by,
      w: 12,
      h: 9,
      wallType: 'wall_wood',
      floorType: 'tile_diner',
      porch: { x0: bx + 4, y0: by + 9, w: 3, h: 1 },
      doors: [
        { gx: bx + 5, gy: by + 8, orientation: 'ew', status: 'closed' },
        { gx: bx + 6, gy: by + 2, orientation: 'ns', status: 'open' },
        { gx: bx + 8, gy: by + 4, orientation: 'ew', status: 'closed' },
        { gx: bx + 11, gy: by + 6, orientation: 'ns', status: 'closed' },
      ],
      partitions: [
        { x0: bx + 6, y0: by + 1, x1: bx + 6, y1: by + 7 },
        { x0: bx + 6, y0: by + 4, x1: bx + 10, y1: by + 4 },
      ],
      rooms: [
        { x0: bx + 1, y0: by + 1, w: 5, h: 7, floorType: 'tile_diner' },
        { x0: bx + 7, y0: by + 1, w: 4, h: 3, floorType: 'tile_diner' },
        { x0: bx + 7, y0: by + 5, w: 4, h: 3, floorType: 'floor', rug: { x0: bx + 8, y0: by + 6, w: 2, h: 1 } },
      ],
      props: [
        { gx: bx + 1, gy: by + 1, prop: 'tv_stand' },
        { gx: bx + 3, gy: by + 1, prop: 'counter' },
        { gx: bx + 4, gy: by + 1, prop: 'counter' },
        { gx: bx + 2, gy: by + 4, prop: 'table' },
        { gx: bx + 1, gy: by + 4, prop: 'bench' },
        { gx: bx + 2, gy: by + 6, prop: 'table' },
        { gx: bx + 1, gy: by + 6, prop: 'bench' },
        { gx: bx + 8, gy: by + 1, prop: 'stove' },
        {
          gx: bx + 10,
          gy: by + 1,
          prop: 'fridge',
          lootKind: 'fridge',
          lootItems: { food: 2 + (h % 2), water: 2, raw_fish: h % 2 },
        },
        { gx: bx + 7, gy: by + 1, prop: 'counter' },
        { gx: bx + 7, gy: by + 6, prop: 'bed' },
        { gx: bx + 10, gy: by + 5, prop: 'desk' },
        {
          gx: bx + 10,
          gy: by + 7,
          prop: 'crate_wood',
          lootKind: 'crate_wood',
          lootItems: { wood: 3, scrap: 2, food: 1 },
        },
      ],
    };
  }

  if (poi.kind === 'outpost') {
    return {
      x0: bx,
      y0: by,
      w: 11,
      h: 9,
      wallType: 'wall_brick',
      floorType: 'tile_clinic',
      porch: { x0: bx - 1, y0: by + 3, w: 1, h: 3 },
      doors: [
        { gx: bx, gy: by + 4, orientation: 'ns', status: 'locked' },
        { gx: bx + 5, gy: by + 4, orientation: 'ns', status: 'locked' },
      ],
      partitions: [{ x0: bx + 5, y0: by + 1, x1: bx + 5, y1: by + 7 }],
      rooms: [
        { x0: bx + 1, y0: by + 1, w: 4, h: 7, floorType: 'tile_clinic' },
        { x0: bx + 6, y0: by + 1, w: 4, h: 7, floorType: 'floor' },
      ],
      props: [
        { gx: bx + 1, gy: by + 1, prop: 'desk' },
        { gx: bx + 3, gy: by + 1, prop: 'counter' },
        { gx: bx + 1, gy: by + 7, prop: 'bench' },
        {
          gx: bx + 9,
          gy: by + 1,
          prop: 'crate_military',
          lootKind: 'crate_military',
          lootItems: { ammo_9mm: 8 + (h % 6), ammo_shell: 3 + (h % 3), scrap: 3, molotov: h % 3 === 0 ? 1 : 0 },
        },
        { gx: bx + 6, gy: by + 1, prop: 'bed' },
        { gx: bx + 6, gy: by + 7, prop: 'desk' },
        {
          gx: bx + 9,
          gy: by + 7,
          prop: 'crate_wood',
          lootKind: 'crate_wood',
          lootItems: { bandage: 1, water: 2, cloth: 2 },
        },
      ],
    };
  }

  if (poi.kind === 'gas_station') {
    // Highway Fuel Depot: convenience mart + repair garage bay + forecourt pump island apron
    return {
      x0: bx,
      y0: by,
      w: 12,
      h: 9,
      wallType: 'wall_brick',
      floorType: 'tile_diner',
      porch: { x0: bx + 2, y0: by + 9, w: 8, h: 1 },
      doors: [
        { gx: bx + 4, gy: by + 8, orientation: 'ew', status: 'closed' },
        { gx: bx + 7, gy: by + 4, orientation: 'ns', status: 'closed' },
        { gx: bx + 9, gy: by + 8, orientation: 'ew', status: h % 2 === 0 ? 'locked' : 'closed' },
      ],
      partitions: [{ x0: bx + 7, y0: by + 1, x1: bx + 7, y1: by + 7 }],
      rooms: [
        { x0: bx + 1, y0: by + 1, w: 6, h: 7, floorType: 'tile_diner' },
        { x0: bx + 8, y0: by + 1, w: 3, h: 7, floorType: 'floor' },
      ],
      props: [
        { gx: bx + 1, gy: by + 1, prop: 'counter' },
        { gx: bx + 2, gy: by + 1, prop: 'counter' },
        {
          gx: bx + 5,
          gy: by + 1,
          prop: 'fridge',
          lootKind: 'fridge',
          lootItems: { food: 2, water: 3, hot_rations: 1 },
        },
        { gx: bx + 1, gy: by + 5, prop: 'table' },
        { gx: bx + 5, gy: by + 5, prop: 'bookshelf' },
        {
          gx: bx + 10,
          gy: by + 1,
          prop: 'crate_wood',
          lootKind: 'crate_wood',
          lootItems: { fuel: 3 + (h % 3), scrap: 4, cloth: 2 },
        },
        {
          gx: bx + 10,
          gy: by + 5,
          prop: 'crate_wood',
          lootKind: 'crate_wood',
          lootItems: { fuel: 2, molotov: 1, scrap: 3 },
        },
        { gx: bx + 8, gy: by + 1, prop: 'desk' },
      ],
    };
  }

  if (poi.kind === 'bunker') {
    // Fortified Military Fallout Bunker: reinforced brick walls, armory, medbay & barracks
    return {
      x0: bx,
      y0: by,
      w: 12,
      h: 9,
      wallType: 'wall_brick',
      floorType: 'tile_clinic',
      porch: { x0: bx + 4, y0: by + 9, w: 4, h: 1 },
      doors: [
        { gx: bx + 5, gy: by + 8, orientation: 'ew', status: 'locked' },
        { gx: bx + 5, gy: by + 4, orientation: 'ew', status: 'locked' },
        { gx: bx + 7, gy: by + 2, orientation: 'ns', status: 'closed' },
      ],
      partitions: [
        { x0: bx + 1, y0: by + 4, x1: bx + 10, y1: by + 4 },
        { x0: bx + 7, y0: by + 1, x1: bx + 7, y1: by + 3 },
      ],
      rooms: [
        { x0: bx + 1, y0: by + 5, w: 10, h: 3, floorType: 'tile_clinic' },
        { x0: bx + 1, y0: by + 1, w: 6, h: 3, floorType: 'tile_clinic' },
        { x0: bx + 8, y0: by + 1, w: 3, h: 3, floorType: 'floor_bath' },
      ],
      props: [
        { gx: bx + 1, gy: by + 5, prop: 'desk' },
        { gx: bx + 2, gy: by + 5, prop: 'counter' },
        { gx: bx + 10, gy: by + 7, prop: 'bench' },
        {
          gx: bx + 1,
          gy: by + 1,
          prop: 'crate_military',
          lootKind: 'crate_military',
          lootItems: { ammo_9mm: 14, ammo_shell: 6, molotov: 1, scrap: 4 },
        },
        {
          gx: bx + 3,
          gy: by + 1,
          prop: 'crate_military',
          lootKind: 'crate_military',
          lootItems: { ammo_9mm: 10, ammo_shell: 4, fuel: 2, hot_rations: 1 },
        },
        { gx: bx + 5, gy: by + 1, prop: 'bed' },
        {
          gx: bx + 10,
          gy: by + 1,
          prop: 'med_cabinet',
          lootKind: 'med_cabinet',
          lootItems: { bandage: 3, water: 2, cloth: 3 },
        },
        { gx: bx + 8, gy: by + 1, prop: 'sink_toilet' },
      ],
    };
  }

  if (poi.kind === 'farmstead') {
    // Abandoned Rural Farmstead: warm timber farmhouse with kitchen, pantry & bedroom
    return {
      x0: bx,
      y0: by,
      w: 12,
      h: 9,
      wallType: 'wall_wood',
      floorType: 'floor',
      porch: { x0: bx + 3, y0: by + 9, w: 5, h: 1 },
      doors: [
        { gx: bx + 5, gy: by + 8, orientation: 'ew', status: 'closed' },
        { gx: bx + 6, gy: by + 4, orientation: 'ns', status: 'closed' },
        { gx: bx + 11, gy: by + 6, orientation: 'ns', status: 'closed' },
      ],
      partitions: [{ x0: bx + 6, y0: by + 1, x1: bx + 6, y1: by + 7 }],
      rooms: [
        { x0: bx + 1, y0: by + 1, w: 5, h: 7, floorType: 'floor', rug: { x0: bx + 2, y0: by + 3, w: 3, h: 2 } },
        { x0: bx + 7, y0: by + 1, w: 4, h: 7, floorType: 'tile_diner' },
      ],
      props: [
        { gx: bx + 1, gy: by + 1, prop: 'bed' },
        { gx: bx + 4, gy: by + 1, prop: 'bookshelf' },
        { gx: bx + 1, gy: by + 6, prop: 'couch' },
        { gx: bx + 7, gy: by + 1, prop: 'stove' },
        { gx: bx + 8, gy: by + 4, prop: 'table' },
        {
          gx: bx + 10,
          gy: by + 1,
          prop: 'fridge',
          lootKind: 'fridge',
          lootItems: { food: 3, raw_fish: 2, water: 2 },
        },
        {
          gx: bx + 10,
          gy: by + 7,
          prop: 'crate_wood',
          lootKind: 'crate_wood',
          lootItems: { wood: 5, cloth: 3, fuel: 2, food: 2 },
        },
      ],
    };
  }

  if (poi.kind === 'watchtower') {
    // Elevated Fire Watchtower & Ranger Compound: compact fortified timber/brick lookout
    return {
      x0: bx + 1,
      y0: by,
      w: 9,
      h: 9,
      wallType: 'wall_wood',
      floorType: 'floor',
      porch: { x0: bx + 3, y0: by + 9, w: 5, h: 1 },
      doors: [
        { gx: bx + 5, gy: by + 8, orientation: 'ew', status: 'closed' },
        { gx: bx + 5, gy: by + 4, orientation: 'ew', status: 'closed' },
      ],
      partitions: [{ x0: bx + 2, y0: by + 4, x1: bx + 8, y1: by + 4 }],
      rooms: [
        { x0: bx + 2, y0: by + 5, w: 7, h: 3, floorType: 'floor' },
        { x0: bx + 2, y0: by + 1, w: 7, h: 3, floorType: 'floor', rug: { x0: bx + 4, y0: by + 2, w: 3, h: 1 } },
      ],
      props: [
        { gx: bx + 2, gy: by + 5, prop: 'desk' },
        { gx: bx + 8, gy: by + 5, prop: 'bookshelf' },
        { gx: bx + 2, gy: by + 1, prop: 'bed' },
        { gx: bx + 4, gy: by + 1, prop: 'stove' },
        {
          gx: bx + 8,
          gy: by + 1,
          prop: 'crate_military',
          lootKind: 'crate_military',
          lootItems: { ammo_9mm: 8, ammo_shell: 3, bandage: 2, water: 2, scrap: 3 },
        },
      ],
    };
  }

  // Timber Cabin (2-room homestead with clear front vestibule into living/kitchen & door to bedroom)
  return {
    x0: bx,
    y0: by,
    w: 11,
    h: 8,
    wallType: 'wall_wood',
    floorType: 'floor',
    porch: { x0: bx + 6, y0: by + 8, w: 3, h: 1 },
    doors: [
      { gx: bx + 7, gy: by + 7, orientation: 'ew', status: 'closed' },
      { gx: bx + 5, gy: by + 4, orientation: 'ns', status: 'closed' },
    ],
    partitions: [{ x0: bx + 5, y0: by + 1, x1: bx + 5, y1: by + 6 }],
    rooms: [
      { x0: bx + 1, y0: by + 1, w: 4, h: 6, floorType: 'floor', rug: { x0: bx + 2, y0: by + 3, w: 2, h: 2 } },
      { x0: bx + 6, y0: by + 1, w: 4, h: 6, floorType: 'floor' },
    ],
    props: [
      { gx: bx + 1, gy: by + 1, prop: 'bed' },
      { gx: bx + 1, gy: by + 6, prop: 'bookshelf' },
      { gx: bx + 4, gy: by + 1, prop: 'desk' },
      { gx: bx + 9, gy: by + 1, prop: 'stove' },
      { gx: bx + 7, gy: by + 1, prop: 'table' },
      { gx: bx + 6, gy: by + 6, prop: 'couch' },
      {
        gx: bx + 9,
        gy: by + 5,
        prop: 'crate_wood',
        lootKind: 'crate_wood',
        lootItems: { wood: 4, scrap: 2, fuel: 1, food: 1 },
      },
    ],
  };
}

export interface OuterChunkSpawnResult {
  chunk: WorldChunk;
  containers: LootContainer[];
  structures: WorldStructure[];
  vehicles: Vehicle[];
  doors: DoorEntity[];
}

export function generateOuterChunk(
  store: WorldStore,
  cx: number,
  cy: number,
  nextVehicleIdRef: { nextId: number },
  face: CubeFaceId = store.activeFace ?? 0
): OuterChunkSpawnResult {
  // Snap any out-of-face chunk request onto its canonical finite Cube-Sphere face & chunk
  const resolvedCenter = resolveCubeSphereTile(face, cx * CHUNK_SIZE + 8, cy * CHUNK_SIZE + 8);
  const rFace = resolvedCenter.face;
  const rCX = Math.floor(resolvedCenter.gx / CHUNK_SIZE);
  const rCY = Math.floor(resolvedCenter.gy / CHUNK_SIZE);
  const key = cubeChunkKey(rFace, rCX, rCY);
  const existing = store.chunks.get(key);
  if (existing) {
    return { chunk: existing, containers: [], structures: [], vehicles: [], doors: [] };
  }

  const cells: TileCell[][] = [];
  const startGX = rCX * CHUNK_SIZE;
  const startGY = rCY * CHUNK_SIZE;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const row: TileCell[] = [];
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      row.push(createOuterBaseCell(store.seed, startGX + lx, startGY + ly, rFace));
    }
    cells.push(row);
  }

  const chunk: WorldChunk = { face: rFace, cx: rCX, cy: rCY, key, cells };
  store.chunks.set(key, chunk);
  store.populatedChunks.add(key);

  const containers: LootContainer[] = [];
  const structures: WorldStructure[] = [];
  const vehicles: Vehicle[] = [];
  const doors: DoorEntity[] = [];

  const setLocal = (gx: number, gy: number, fn: (c: TileCell) => void) => {
    const lx = gx - startGX;
    const ly = gy - startGY;
    if (lx >= 0 && lx < CHUNK_SIZE && ly >= 0 && ly < CHUNK_SIZE) {
      fn(cells[ly][lx]);
    }
  };

  // Identify macro-region covering this chunk (32x32 macro-regions = 2x2 chunks)
  const rx = Math.floor(startGX / 32);
  const ry = Math.floor(startGY / 32);
  const poi = getMacroRegionPOI(store.seed, rx, ry, rFace);

  if (poi && !store.landmarks.has(poi.id)) {
    store.landmarks.set(poi.id, {
      id: poi.id,
      face: rFace,
      kind: poi.kind,
      name: poi.name,
      biome: poi.biome,
      gx: poi.gx,
      gy: poi.gy,
      radius: poi.radius,
      threatLevel: poi.threatLevel,
      discovered: false,
      hotspotSpawned: false,
      hotspotCleared: false,
      hotspotPacks: [...poi.hotspotPacks],
    });
  }

  // Register & furnish hidden Rocky Cliff Cave shelter in this macro-region
  const cavePlan = getMacroRegionCave(store.seed, rx, ry, rFace);
  if (cavePlan) {
    const caveHash = hashCoords(store.seed + 5309, cavePlan.gx, cavePlan.gy);
    if (!store.landmarks.has(cavePlan.id)) {
      store.landmarks.set(cavePlan.id, {
        id: cavePlan.id,
        face: rFace,
        kind: 'cave',
        name: cavePlan.name,
        biome: sampleBiomeAt(store.seed, cavePlan.gx, cavePlan.gy, rFace),
        gx: cavePlan.gx,
        gy: cavePlan.gy,
        radius: Math.ceil(cavePlan.chamberRadius) + 2,
        threatLevel: 'low',
        discovered: false,
        hotspotSpawned: false,
        hotspotCleared: false,
        // Occasional sleepers inside rocky cliff caves; once cleared, zombies NEVER spawn here again
        hotspotPacks: caveHash % 3 === 0 ? ['walker', 'walker'] : ['walker'],
        shelterBounds: { ...cavePlan.shelterBounds },
      });
    }

    // Furnish cave interior with dry survival crates & natural cave stalagmites
    const crate1X = cavePlan.gx - 1;
    const crate1Y = cavePlan.gy - 1;
    setLocal(crate1X, crate1Y, (cell) => {
      if (cell.tile === 'cave_floor') {
        cell.prop = 'crate_wood';
        cell.solid = true;
        cell.blocksSight = false;
        containers.push({
          id: `c_${crate1X}_${crate1Y}`,
          gx: crate1X,
          gy: crate1Y,
          kind: 'crate_wood',
          items: { wood: 4, cloth: 2, food: 2, fuel: 1, bandage: 1 },
          searched: false,
          searchProgress: 0,
          openAnim: 0,
        });
      }
    });

    const crate2X = cavePlan.gx + 1;
    const crate2Y = cavePlan.gy - 1;
    setLocal(crate2X, crate2Y, (cell) => {
      if (cell.tile === 'cave_floor' && caveHash % 2 === 0) {
        cell.prop = 'crate_wood';
        cell.solid = true;
        cell.blocksSight = false;
        containers.push({
          id: `c_${crate2X}_${crate2Y}`,
          gx: crate2X,
          gy: crate2Y,
          kind: 'crate_wood',
          items: { water: 2, scrap: 3, ammo_9mm: 6, hot_rations: 1 },
          searched: false,
          searchProgress: 0,
          openAnim: 0,
        });
      }
    });

    const stalOffsets: Array<[number, number]> =
      cavePlan.mouthDir === 's'
        ? [
            [-2, -1],
            [2, -1],
          ]
        : [
            [-1, -2],
            [-1, 2],
          ];
    for (const [sdx, sdy] of stalOffsets) {
      setLocal(cavePlan.gx + sdx, cavePlan.gy + sdy, (cell) => {
        if (cell.tile === 'cave_floor' && cell.prop === 'none') {
          cell.prop = 'cave_stalagmite';
          cell.solid = true;
          cell.blocksSight = false;
        }
      });
    }
  }

  // Detect & register Highway Road Tunnels passing through tall hills in this chunk
  let tunnelSumX = 0;
  let tunnelSumY = 0;
  let tunnelCount = 0;
  for (let ly = 0; ly < CHUNK_SIZE; ly += 2) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 2) {
      const gx = startGX + lx;
      const gy = startGY + ly;
      const tun = sampleRoadTunnelInfo(store.seed, gx + 0.5, gy + 0.5, rFace);
      if (tun.isTunnel) {
        tunnelSumX += gx;
        tunnelSumY += gy;
        tunnelCount++;
      }
    }
  }
  if (tunnelCount >= 3) {
    const tunnelId = rFace === 0 ? `tunnel_${rx}_${ry}` : `f${rFace}_tunnel_${rx}_${ry}`;
    if (!store.landmarks.has(tunnelId)) {
      const tgx = Math.round(tunnelSumX / tunnelCount);
      const tgy = Math.round(tunnelSumY / tunnelCount);
      const th = hashCoords(store.seed + 7919 + rFace * 10007, rx, ry);
      store.landmarks.set(tunnelId, {
        id: tunnelId,
        face: rFace,
        kind: 'tunnel',
        name: `Ridge Tunnel #${(th % 19) + 1}`,
        biome: sampleBiomeAt(store.seed, tgx, tgy, rFace),
        gx: tgx,
        gy: tgy,
        radius: 8,
        threatLevel: 'medium',
        discovered: false,
        hotspotSpawned: false,
        hotspotCleared: false,
        hotspotPacks: ['walker', 'runner'],
      });
    }
  }

  // Stamp Landmark POI inside this chunk
  let protectedBounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  if (poi) {
    const h = hashCoords(store.seed + 2029, poi.gx, poi.gy);
    if (poi.kind === 'pileup') {
      // Highway Pileup: wrecked chassis, barricades, burn barrel, road sign, salvage crates, rare drivable vehicle
      const offsets: Array<{ dx: number; dy: number; prop: PropKind; loot?: LootContainer['kind']; items?: Partial<Inventory> }> = [
        { dx: -2, dy: -1, prop: 'wrecked_car' },
        { dx: 1, dy: 1, prop: 'wrecked_car' },
        { dx: 3, dy: -2, prop: 'wrecked_car' },
        { dx: -3, dy: 2, prop: 'concrete_barrier' },
        { dx: 2, dy: 2, prop: 'barrel_burn' },
        { dx: -4, dy: -3, prop: 'road_sign' },
        {
          dx: 0,
          dy: -2,
          prop: 'crate_wood',
          loot: 'crate_wood',
          items: { scrap: 4, fuel: 1, ammo_9mm: 6, bandage: 1 },
        },
        {
          dx: 2,
          dy: -1,
          prop: 'crate_military',
          loot: 'crate_military',
          items: { ammo_9mm: 8, ammo_shell: 3, scrap: 2 },
        },
      ];
      for (const o of offsets) {
        const tx = poi.gx + o.dx;
        const ty = poi.gy + o.dy;
        setLocal(tx, ty, (cell) => {
          if (cell.tile !== 'water') {
            cell.prop = o.prop;
            cell.solid = true;
            cell.blocksSight = o.prop === 'wrecked_car';
            if (o.loot && o.items) {
              containers.push({
                id: `c_${tx}_${ty}`,
                gx: tx,
                gy: ty,
                kind: o.loot,
                items: { ...o.items },
                searched: false,
                searchProgress: 0,
                openAnim: 0,
              });
            }
          }
        });
      }

      if (poi.includeDrivableCar) {
        const vx = poi.gx - 4;
        const vy = poi.gy;
        if (vx >= startGX && vx < startGX + CHUNK_SIZE && vy >= startGY && vy < startGY + CHUNK_SIZE) {
          const isPolice = h % 3 === 0;
          vehicles.push({
            id: nextVehicleIdRef.nextId++,
            kind: isPolice ? 'police' : 'sedan',
            x: vx + 0.5,
            y: vy + 0.5,
            angle: (h % 2 === 0 ? 0 : Math.PI * 0.5) + 0.12,
            speed: 0,
            vx: 0,
            vy: 0,
            hp: isPolice ? 240 : 190,
            maxHp: isPolice ? 280 : 220,
            fuel: 40 + (h % 45),
            headlightsOn: false,
            sirenOn: false,
            hitFlash: 0,
            drifting: false,
            boosting: false,
            trunkItems: isPolice ? { ammo_9mm: 8, bandage: 1 } : { fuel: 2, scrap: 3 },
            trunkSearched: false,
          });
        }
      }
    } else if (poi.kind === 'checkpoint') {
      // Military Checkpoint: sandbag bunkers, barriers, burn barrel, road sign, fortified guardhouse, military crate
      const props: Array<{ dx: number; dy: number; prop: PropKind; loot?: LootContainer['kind']; items?: Partial<Inventory> }> = [
        { dx: -3, dy: -2, prop: 'sandbag_wall' },
        { dx: -2, dy: -2, prop: 'sandbag_wall' },
        { dx: 2, dy: 2, prop: 'sandbag_wall' },
        { dx: 3, dy: 2, prop: 'sandbag_wall' },
        { dx: -1, dy: 2, prop: 'concrete_barrier' },
        { dx: 1, dy: -2, prop: 'concrete_barrier' },
        { dx: -3, dy: 2, prop: 'barrel_burn' },
        { dx: 3, dy: -2, prop: 'road_sign' },
        {
          dx: -2,
          dy: -1,
          prop: 'crate_military',
          loot: 'crate_military',
          items: { ammo_9mm: 10, ammo_shell: 4, molotov: 1, scrap: 3 },
        },
      ];
      for (const p of props) {
        const tx = poi.gx + p.dx;
        const ty = poi.gy + p.dy;
        setLocal(tx, ty, (cell) => {
          if (cell.tile !== 'water') {
            if (cell.tile === 'grass' || cell.tile === 'forest_floor') cell.tile = 'gravel';
            cell.prop = p.prop;
            cell.solid = true;
            cell.blocksSight = false;
            if (p.loot && p.items) {
              containers.push({
                id: `c_${tx}_${ty}`,
                gx: tx,
                gy: ty,
                kind: p.loot,
                items: { ...p.items },
                searched: false,
                searchProgress: 0,
                openAnim: 0,
              });
            }
          }
        });
      }

      // Compact brick guardhouse tucked beside checkpoint shoulder (gx + 3..7, gy - 6..-2)
      const guardhouse: BuildingSpec = {
        x0: poi.gx + 3,
        y0: poi.gy - 6,
        w: 5,
        h: 5,
        wallType: 'wall_brick',
        floorType: 'tile_clinic',
        porch: { x0: poi.gx + 4, y0: poi.gy - 1, w: 3, h: 1 },
        doors: [{ gx: poi.gx + 5, gy: poi.gy - 2, orientation: 'ew', status: 'locked' }],
        props: [
          {
            gx: poi.gx + 4,
            gy: poi.gy - 5,
            prop: 'med_cabinet',
            lootKind: 'med_cabinet',
            lootItems: { bandage: 2, water: 2, cloth: 2 },
          },
          {
            gx: poi.gx + 6,
            gy: poi.gy - 5,
            prop: 'crate_military',
            lootKind: 'crate_military',
            lootItems: { ammo_9mm: 8, ammo_shell: 4, fuel: 1 },
          },
        ],
      };
      for (let y = guardhouse.y0 - 1; y <= guardhouse.y0 + guardhouse.h + 1; y++) {
        for (let x = guardhouse.x0 - 1; x <= guardhouse.x0 + guardhouse.w; x++) {
          setLocal(x, y, (cell) => {
            if (cell.tile === 'water') cell.tile = 'dirt';
            cell.prop = 'none';
            cell.solid = false;
            cell.blocksSight = false;
          });
        }
      }
      protectedBounds = {
        x0: guardhouse.x0 - 1,
        y0: guardhouse.y0 - 1,
        x1: guardhouse.x0 + guardhouse.w,
        y1: guardhouse.y0 + guardhouse.h + 1,
      };
      applyBuildingToSetter(setLocal, guardhouse, doors, containers);

      if (poi.includeDrivableCar) {
        const vx = poi.gx - 4;
        const vy = poi.gy + 1;
        if (vx >= startGX && vx < startGX + CHUNK_SIZE && vy >= startGY && vy < startGY + CHUNK_SIZE) {
          vehicles.push({
            id: nextVehicleIdRef.nextId++,
            kind: 'police',
            x: vx + 0.5,
            y: vy + 0.5,
            angle: 0,
            speed: 0,
            vx: 0,
            vy: 0,
            hp: 260,
            maxHp: 280,
            fuel: 55 + (h % 35),
            headlightsOn: false,
            sirenOn: false,
            hitFlash: 0,
            drifting: false,
            boosting: false,
            trunkItems: { ammo_9mm: 10, scrap: 2 },
            trunkSearched: false,
          });
        }
      }
    } else if (poi.kind === 'campground') {
      // Clear campground dirt patch + campfire + tents + fallen logs + supplies
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy <= 10) {
            setLocal(poi.gx + dx, poi.gy + dy, (cell) => {
              if (cell.tile !== 'water' && cell.tile !== 'pier') {
                cell.tile = dx * dx + dy * dy <= 2 ? 'dirt' : 'forest_floor';
                cell.prop = 'none';
                cell.solid = false;
                cell.blocksSight = false;
              }
            });
          }
        }
      }

      // Central campfire structure (registered if center tile belongs to this chunk)
      setLocal(poi.gx, poi.gy, (cell) => {
        if (cell.tile !== 'water') {
          cell.prop = 'none';
          cell.solid = false;
          structures.push({
            id: `camp_fire_${poi.gx}_${poi.gy}`,
            gx: poi.gx,
            gy: poi.gy,
            kind: 'campfire',
            hp: STRUCTURES.campfire.maxHp,
            maxHp: STRUCTURES.campfire.maxHp,
            cooldown: 0,
            hitFlash: 0,
          });
        }
      });

      const campProps: Array<{ dx: number; dy: number; prop: PropKind; loot?: LootContainer['kind']; items?: Partial<Inventory> }> = [
        { dx: -2, dy: -2, prop: 'tent' },
        { dx: 2, dy: -2, prop: 'tent' },
        { dx: 0, dy: 2, prop: 'fallen_log' },
        {
          dx: -2,
          dy: 1,
          prop: 'crate_wood',
          loot: 'crate_wood',
          items: { food: 2, water: 2, wood: 3, raw_fish: 1 },
        },
        {
          dx: 2,
          dy: 1,
          prop: 'crate_wood',
          loot: 'crate_wood',
          items: { cloth: 2, bandage: 1, fuel: 1 },
        },
      ];
      for (const cp of campProps) {
        const tx = poi.gx + cp.dx;
        const ty = poi.gy + cp.dy;
        setLocal(tx, ty, (cell) => {
          if (cell.tile !== 'water') {
            cell.prop = cp.prop;
            cell.solid = true;
            cell.blocksSight = cp.prop === 'tent';
            if (cp.loot && cp.items) {
              containers.push({
                id: `c_${tx}_${ty}`,
                gx: tx,
                gy: ty,
                kind: cp.loot,
                items: { ...cp.items },
                searched: false,
                searchProgress: 0,
                openAnim: 0,
              });
            }
          }
        });
      }

      // If pond requested, carve a cozy fishing pond + short pier adjacent South
      if (poi.hasPierPond) {
        const pondCX = poi.gx;
        const pondCY = poi.gy + 6;
        for (let py = pondCY - 2; py <= pondCY + 2; py++) {
          for (let px = pondCX - 3; px <= pondCX + 3; px++) {
            const dNorm = ((px - pondCX) / 3.2) ** 2 + ((py - pondCY) / 2.2) ** 2;
            setLocal(px, py, (cell) => {
              if (dNorm <= 1.0) {
                cell.tile = 'water';
                cell.prop = 'none';
                cell.solid = false;
                cell.blocksSight = false;
              } else if (dNorm <= 1.35) {
                cell.tile = 'sand';
              }
            });
          }
        }
        for (let py = pondCY - 2; py <= pondCY; py++) {
          setLocal(pondCX, py, (cell) => {
            cell.tile = 'pier';
            cell.prop = 'none';
            cell.solid = false;
            cell.blocksSight = false;
          });
        }
        setLocal(pondCX, pondCY - 2, (cell) => {
          cell.prop = 'fishing_post';
          cell.solid = true;
        });
      }
    } else {
      // Varied Multi-Room Building (clinic, diner, outpost, cabin)
      const spec = createBuildingSpecForLandmark(poi, store.seed);
      const apronMinX = Math.min(spec.x0, spec.porch ? spec.porch.x0 : spec.x0) - 1;
      const apronMinY = Math.min(spec.y0, spec.porch ? spec.porch.y0 : spec.y0) - 1;
      const apronMaxX = Math.max(spec.x0 + spec.w - 1, spec.porch ? spec.porch.x0 + spec.porch.w - 1 : spec.x0) + 1;
      const apronMaxY = Math.max(spec.y0 + spec.h - 1, spec.porch ? spec.porch.y0 + spec.porch.h - 1 : spec.y0) + 1;
      protectedBounds = { x0: apronMinX, y0: apronMinY, x1: apronMaxX, y1: apronMaxY };
      // Clear exterior apron so porch & doors are always unobstructed
      for (let y = apronMinY; y <= apronMaxY; y++) {
        for (let x = apronMinX; x <= apronMaxX; x++) {
          setLocal(x, y, (cell) => {
            if (cell.tile === 'water') cell.tile = 'dirt';
            cell.prop = 'none';
            cell.solid = false;
            cell.blocksSight = false;
          });
        }
      }
      applyBuildingToSetter(setLocal, spec, doors, containers);
      // Add forecourt fuel-island props & parked drivable vehicles at Fuel Depots / Bunkers / Farmsteads
      if (poi.kind === 'gas_station') {
        setLocal(spec.x0 + 1, spec.y0 + spec.h + 1, (c) => {
          if (c.tile !== 'water') { c.tile = 'road'; c.prop = 'barrel_burn'; c.solid = true; }
        });
        setLocal(spec.x0 + spec.w - 2, spec.y0 + spec.h + 1, (c) => {
          if (c.tile !== 'water') { c.tile = 'road'; c.prop = 'road_sign'; c.solid = true; }
        });
      } else if (poi.kind === 'bunker') {
        for (const ox of [1, 2, spec.w - 3, spec.w - 2]) {
          setLocal(spec.x0 + ox, spec.y0 + spec.h + 1, (c) => {
            if (c.tile !== 'water' && c.prop === 'none') { c.prop = 'sandbag_wall'; c.solid = true; }
          });
        }
      }
      if (poi.includeDrivableCar) {
        const vx = spec.x0 + Math.floor(spec.w * 0.5);
        const vy = spec.y0 + spec.h + 2;
        if (vx >= startGX && vx < startGX + CHUNK_SIZE && vy >= startGY && vy < startGY + CHUNK_SIZE) {
          vehicles.push({
            id: nextVehicleIdRef.nextId++,
            kind: h % 4 === 0 ? 'police' : 'sedan',
            x: vx + 0.5,
            y: vy + 0.5,
            angle: 0,
            speed: 0,
            vx: 0,
            vy: 0,
            hp: 220,
            maxHp: 220,
            fuel: poi.kind === 'gas_station' ? 85 : 55,
            headlightsOn: false,
            sirenOn: false,
            hitFlash: 0,
            drifting: false,
            boosting: false,
            trunkItems: poi.kind === 'gas_station' ? { fuel: 3, scrap: 2 } : { food: 2, wood: 3 },
            trunkSearched: false,
          });
        }
      }
    }
  }

  // Occasional scenic lakeside clearing in empty pine_forest or rural_meadow regions (never blocking highways or East test spot)
  const chunkRng = createRng(hashCoords(store.seed + 719 + rFace * 10007, rCX, rCY));
  if (!poi && chunkRng() < 0.14) {
    const lakeCX = startGX + 8;
    const lakeCY = startGY + 8;
    const roadNear = sampleRoadInfo(store.seed, lakeCX, lakeCY, rFace);
    if (roadNear.highwayDist > 7 && Math.hypot(lakeCX - 84, lakeCY - 28) > 10) {
      const rxLake = 3.8 + chunkRng() * 1.3;
      const ryLake = 3.5 + chunkRng() * 1.2;
      for (let ly = 2; ly < CHUNK_SIZE - 2; ly++) {
        for (let lx = 2; lx < CHUNK_SIZE - 2; lx++) {
          const gx = startGX + lx;
          const gy = startGY + ly;
          const dNorm = ((gx - lakeCX) / rxLake) ** 2 + ((gy - lakeCY) / ryLake) ** 2;
          if (dNorm <= 1.0) {
            cells[ly][lx].tile = 'water';
            cells[ly][lx].solid = false;
            cells[ly][lx].blocksSight = false;
          } else if (dNorm <= 1.35) {
            cells[ly][lx].tile = 'sand';
          }
        }
      }
      const shoreY = Math.min(startGY + CHUNK_SIZE - 2, Math.round(lakeCY + ryLake) + 1);
      for (let py = Math.round(lakeCY + 1); py <= shoreY; py++) {
        setLocal(lakeCX, py, (cell) => {
          cell.tile = 'pier';
          cell.prop = 'none';
          cell.solid = false;
          cell.blocksSight = false;
        });
      }
      setLocal(lakeCX, shoreY, (cell) => {
        if (cell.tile === 'pier') {
          cell.prop = 'fishing_post';
          cell.solid = true;
        }
      });
    }
  }

  // Biome-driven natural micro-scatter (never on roads, piers, water, or inside POI aprons)
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const cell = cells[ly][lx];
      if (cell.prop !== 'none' || cell.solid) continue;
      if (
        cell.tile === 'road' ||
        cell.tile === 'asphalt_cracked' ||
        cell.tile === 'crosswalk' ||
        cell.tile === 'sidewalk' ||
        cell.tile === 'pier' ||
        cell.tile === 'bridge_deck' ||
        cell.tile === 'cave_floor' ||
        cell.tile === 'cliff_stone' ||
        cell.tile === 'water' ||
        cell.tile === 'floor' ||
        cell.tile === 'floor_porch' ||
        cell.tile === 'floor_rug' ||
        cell.tile === 'floor_bath' ||
        cell.tile === 'tile_clinic' ||
        cell.tile === 'tile_diner'
      ) {
        continue;
      }
      if (cavePlan && Math.hypot(cell.gx - cavePlan.gx, cell.gy - cavePlan.gy) <= 6.5) {
        continue;
      }
      if (sampleRoadTunnelInfo(store.seed, cell.gx + 0.5, cell.gy + 0.5, rFace).isTunnel) {
        continue;
      }

      if (poi && Math.hypot(cell.gx - poi.gx, cell.gy - poi.gy) <= 6.2) {
        continue;
      }
      if (
        protectedBounds &&
        cell.gx >= protectedBounds.x0 &&
        cell.gx <= protectedBounds.x1 &&
        cell.gy >= protectedBounds.y0 &&
        cell.gy <= protectedBounds.y1
      ) {
        continue;
      }

      const biome = sampleBiomeAt(store.seed, cell.gx, cell.gy, rFace);
      const oceanCell = sampleOceanInfo(store.seed, cell.gx, cell.gy, rFace);
      const r = chunkRng();

      // Coherent 3D woodland grove clustering: leaves open glades & clear sightlines with sparse natural tree groves
      const sp = cubeFaceToSphere(rFace, cell.gx + 0.5, cell.gy + 0.5);
      const groveVal = fbm3D(
        store.seed + 3037,
        sp.x * 6.8 * SPHERE_NOISE_SCALE,
        sp.y * 6.8 * SPHERE_NOISE_SCALE,
        sp.z * 6.8 * SPHERE_NOISE_SCALE,
        2
      );
      const groveBoost = groveVal > 0.54 ? 1.55 : groveVal < 0.42 ? 0.35 : 0.85;

      // Coastal sandy beaches & dunes: sparse picturesque palm trees leaning toward the sea!
      if (oceanCell.inBeach || oceanCell.inDune) {
        if (oceanCell.inDune && r < 0.026 * groveBoost) {
          cell.prop = 'tree_palm';
          cell.solid = true;
          cell.blocksSight = false;
        } else if (oceanCell.inBeach && oceanCell.continentVal > 0.402 && r < 0.015) {
          cell.prop = 'tree_palm';
          cell.solid = true;
          cell.blocksSight = false;
        } else if (r < 0.022) {
          cell.prop = 'rock_boulder';
          cell.solid = true;
        }
        continue;
      }

      if (biome === 'pine_forest') {
        // Sparse alpine pine groves (~65% sparser than before for clean sightlines & driving)
        if (r < 0.044 * groveBoost) {
          cell.prop = chunkRng() < 0.84 ? 'tree_pine' : 'tree_dead';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.056) {
          cell.prop = 'fallen_log';
          cell.solid = true;
        } else if (r < 0.066) {
          cell.prop = 'rock_boulder';
          cell.solid = true;
        } else if (r < 0.070) {
          cell.prop = 'crate_wood';
          cell.solid = true;
          containers.push({
            id: `wild_crate_${cell.gx}_${cell.gy}`,
            gx: cell.gx,
            gy: cell.gy,
            kind: 'crate_wood',
            items: { wood: 3, scrap: 1, water: chunkRng() < 0.5 ? 1 : 0 },
            searched: false,
            searchProgress: 0,
            openAnim: 0,
          });
        }
      } else if (biome === 'river_valley') {
        // Sparse weeping willows & occasional oaks along river valleys
        if (r < 0.024 * groveBoost) {
          const tr = chunkRng();
          cell.prop = tr < 0.68 ? 'tree_willow' : tr < 0.90 ? 'tree_oak' : 'tree_dead';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.038) {
          cell.prop = 'rock_boulder';
          cell.solid = true;
        } else if (r < 0.048) {
          cell.prop = 'fallen_log';
          cell.solid = true;
        } else if (r < 0.052) {
          cell.prop = 'crate_wood';
          cell.solid = true;
          containers.push({
            id: `wild_crate_${cell.gx}_${cell.gy}`,
            gx: cell.gx,
            gy: cell.gy,
            kind: 'crate_wood',
            items: { raw_fish: 1, wood: 2, water: 1 },
            searched: false,
            searchProgress: 0,
            openAnim: 0,
          });
        }
      } else if (biome === 'scorched_barrens') {
        // Rare lonely charred snags & boulders
        if (r < 0.018 * groveBoost) {
          cell.prop = 'tree_dead';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.036) {
          cell.prop = 'rock_boulder';
          cell.solid = true;
        } else if (r < 0.041 && cell.tile === 'gravel') {
          cell.prop = 'wrecked_car';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.045) {
          cell.prop = 'barrel_burn';
          cell.solid = true;
        }
      } else {
        // rural_meadow: wide open sunlit grass meadows with sparse broadleaf oaks
        if (r < 0.020 * groveBoost) {
          const tr = chunkRng();
          cell.prop = tr < 0.78 ? 'tree_oak' : tr < 0.92 ? 'tree_pine' : 'tree_dead';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.028) {
          cell.prop = 'rock_boulder';
          cell.solid = true;
        } else if (r < 0.034) {
          cell.prop = 'fallen_log';
          cell.solid = true;
        } else if (r < 0.038) {
          cell.prop = 'crate_wood';
          cell.solid = true;
          containers.push({
            id: `wild_crate_${cell.gx}_${cell.gy}`,
            gx: cell.gx,
            gy: cell.gy,
            kind: 'crate_wood',
            items: { wood: 2, scrap: 2, food: chunkRng() < 0.35 ? 1 : 0 },
            searched: false,
            searchProgress: 0,
            openAnim: 0,
          });
        }
      }
    }
  }

  return { chunk, containers, structures, vehicles, doors };
}

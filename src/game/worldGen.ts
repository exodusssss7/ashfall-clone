import { CHUNK_SIZE, MAP_SIZE, clamp } from './isometric';
import { STRUCTURES } from './recipes';
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

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function isOriginSectorChunk(cx: number, cy: number): boolean {
  return cx >= 0 && cx <= 3 && cy >= 0 && cy <= 3;
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

export function sampleRoadInfo(seed: number, gx: number, gy: number): RoadSample {
  // Starter town sector (0..63, 0..63) stays aligned to town crossroads
  if (gx >= 0 && gx < 64 && gy >= 0 && gy < 64) {
    const dx = Math.abs(gx - 28);
    const dy = Math.abs(gy - 28);
    const d = Math.min(dx, dy);
    return {
      isMainHighway: d <= 2.1,
      isCountryRoad: false,
      isAnyRoad: d <= 2.1,
      isShoulder: d > 2.1 && d <= 3.1,
      highwayDist: d,
      roadAxis: dx <= 3 && dy <= 3 ? 'junction' : dy <= 3 ? 'ew' : dx <= 3 ? 'ns' : 'none',
      centerOffset: dy <= dx ? gy - 28 : gx - 28,
    };
  }

  const ewY = mainEwHighwayY(seed, gx);
  const ewSlope = (mainEwHighwayY(seed, gx + 1) - mainEwHighwayY(seed, gx - 1)) * 0.5;
  const ewDist = Math.abs(gy - ewY) / Math.hypot(1, ewSlope);

  const nsX = mainNsHighwayX(seed, gy);
  const nsSlope = (mainNsHighwayX(seed, gy + 1) - mainNsHighwayX(seed, gy - 1)) * 0.5;
  const nsDist = Math.abs(gx - nsX) / Math.hypot(1, nsSlope);

  let bestHwyDist = Math.min(ewDist, nsDist);
  let bestAxis: 'ew' | 'ns' = ewDist <= nsDist ? 'ew' : 'ns';
  let bestOffset = ewDist <= nsDist ? gy - ewY : gx - nsX;

  // Periodic outer winding highways / beltways every ~108 tiles
  const bandY = Math.round((gy - 28) / 108);
  if (bandY !== 0) {
    const sy = secondaryEwHighwayY(seed, gx, bandY);
    const sSlope = (secondaryEwHighwayY(seed, gx + 1, bandY) - secondaryEwHighwayY(seed, gx - 1, bandY)) * 0.5;
    const d = Math.abs(gy - sy) / Math.hypot(1, sSlope);
    if (d < bestHwyDist) {
      bestHwyDist = d;
      bestAxis = 'ew';
      bestOffset = gy - sy;
    }
  }

  const bandX = Math.round((gx - 28) / 108);
  if (bandX !== 0) {
    const sx = secondaryNsHighwayX(seed, gy, bandX);
    const sSlope = (secondaryNsHighwayX(seed, gy + 1, bandX) - secondaryNsHighwayX(seed, gy - 1, bandX)) * 0.5;
    const d = Math.abs(gx - sx) / Math.hypot(1, sSlope);
    if (d < bestHwyDist) {
      bestHwyDist = d;
      bestAxis = 'ns';
      bestOffset = gx - sx;
    }
  }

  // Directional winding country gravel backroads midway between highways (crosses rivers cleanly)
  const nearTownSafe = smoothstep(46, 62, Math.hypot(gx - 31.5, gy - 31.5));
  let countryDist = 99;
  if (nearTownSafe >= 0.9) {
    const laneYIdx = Math.round((gy - 82) / 108);
    const cy = countryEwLaneY(seed, gx, laneYIdx);
    const cySlope = (countryEwLaneY(seed, gx + 1, laneYIdx) - countryEwLaneY(seed, gx - 1, laneYIdx)) * 0.5;
    const cEwDist = Math.abs(gy - cy) / Math.hypot(1, cySlope);

    const laneXIdx = Math.round((gx - 82) / 108);
    const cx = countryNsLaneX(seed, gy, laneXIdx);
    const cxSlope = (countryNsLaneX(seed, gy + 1, laneXIdx) - countryNsLaneX(seed, gy - 1, laneXIdx)) * 0.5;
    const cNsDist = Math.abs(gx - cx) / Math.hypot(1, cxSlope);

    countryDist = Math.min(cEwDist, cNsDist);
    if (countryDist < bestHwyDist) {
      bestAxis = cEwDist <= cNsDist ? 'ew' : 'ns';
    }
  }

  const isMainHighway = bestHwyDist <= 2.35;
  const isCountryRoad = !isMainHighway && countryDist <= 1.35;
  const isShoulder = !isMainHighway && !isCountryRoad && (bestHwyDist <= 3.35 || countryDist <= 2.05);
  const roadAxis: RoadSample['roadAxis'] =
    ewDist <= 3.2 && nsDist <= 3.2 ? 'junction' : isMainHighway || isCountryRoad ? bestAxis : 'none';

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

export interface RiverSample {
  inWater: boolean;
  inBankSand: boolean;
  inFloodMud: boolean;
  riverBand: number;
}

export function sampleRiverInfo(seed: number, gx: number, gy: number): RiverSample {
  // Keep starter town (0..63) and immediate East exit highway (84, 28) dry
  const distFromTown = Math.hypot(gx - 31.5, gy - 31.5);
  const distFromEastExit = Math.hypot(gx - 84, gy - 28);
  if (distFromTown < 48 || distFromEastExit < 10) {
    return { inWater: false, inBankSand: false, inFloodMud: false, riverBand: 1 };
  }

  const warpX = (fbm2D(seed + 601, gx * 0.014, gy * 0.014, 2) - 0.5) * 18;
  const warpY = (fbm2D(seed + 607, gx * 0.014 + 13.7, gy * 0.014 - 8.1, 2) - 0.5) * 18;
  const n = fbm2D(seed + 409, (gx + warpX) * 0.0095, (gy + warpY) * 0.0095, 3);
  const band = Math.abs(n - 0.5);

  const inWater = band < 0.025;
  const inBankSand = !inWater && band < 0.039;
  const inFloodMud = !inWater && !inBankSand && band < 0.056;
  return { inWater, inBankSand, inFloodMud, riverBand: band };
}

export function sampleBiomeAt(seed: number, gx: number, gy: number): BiomeKind {
  if (gx >= 0 && gx < 64 && gy >= 0 && gy < 64) {
    return 'town_edge';
  }
  const river = sampleRiverInfo(seed, gx, gy);
  if (river.riverBand < 0.088) {
    return 'river_valley';
  }
  const moisture = fbm2D(seed + 701, gx * 0.0072, gy * 0.0072, 3);
  const heat = fbm2D(seed + 911, gx * 0.0072 + 21.4, gy * 0.0072 - 11.8, 3);
  if (heat > 0.57 && moisture < 0.50) {
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

export function createOuterBaseCell(seed: number, gx: number, gy: number): TileCell {
  const h = hashCoords(seed, gx, gy);
  const r = (h % 1000) / 1000;
  const biome = sampleBiomeAt(seed, gx, gy);
  const road = sampleRoadInfo(seed, gx, gy);
  const river = sampleRiverInfo(seed, gx, gy);

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
  let variant = h % 4;

  // Carve winding river & banks first
  if (river.inWater) {
    tile = 'water';
    solid = true;
  } else if (river.inBankSand) {
    tile = patch < 0.65 ? 'sand' : 'mud';
  } else if (river.inFloodMud) {
    tile = patch < 0.58 ? 'mud' : tile;
  }

  // Overlay winding highways, country roads, and full-span wooden bridges across rivers!
  if (road.isMainHighway) {
    if (river.inWater || river.riverBand < 0.033) {
      tile = 'pier';
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
    if (river.inWater || river.riverBand < 0.033) {
      tile = 'pier';
      solid = false;
    } else {
      tile = wear < 0.65 ? 'gravel' : 'dirt';
      solid = false;
    }
  } else if (road.isShoulder && !river.inWater) {
    tile = wear < 0.62 ? 'gravel' : 'dirt';
  }

  return {
    gx,
    gy,
    tile,
    prop: 'none',
    solid,
    blocksSight: false,
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

function getMacroRegionPOI(seed: number, rx: number, ry: number): RegionPOIPlan | null {
  // Never override the 4x4 origin sector (rx in 0..1, ry in 0..1)
  if (rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1) return null;

  const h = hashCoords(seed + 1337, rx, ry);
  const rng = createRng(h);

  // Leave ~18% of macro-regions as pure untamed wilderness
  if (rng() < 0.18) return null;

  const regStartX = rx * 32;
  const regStartY = ry * 32;

  // Scan candidate interior coordinates (margin 8 tiles so footprints stay localized & clean)
  let highwaySpot: { gx: number; gy: number; dist: number } | null = null;
  let riverSpot: { gx: number; gy: number } | null = null;
  let drySpot: { gx: number; gy: number } | null = null;

  const isFootprintDryAndRoadFree = (cx: number, cy: number, pad = 6): boolean => {
    for (let dy = -pad; dy <= pad; dy += 2) {
      for (let dx = -pad; dx <= pad; dx += 2) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (sampleRoadInfo(seed, tx, ty).isAnyRoad) return false;
        if (sampleRiverInfo(seed, tx, ty).inWater) return false;
      }
    }
    return true;
  };

  for (let gy = regStartY + 8; gy <= regStartY + 23; gy += 2) {
    for (let gx = regStartX + 8; gx <= regStartX + 23; gx += 2) {
      // Keep East highway starter test sector clean through gx = 90
      if (gx >= 56 && gx <= 92 && gy >= 22 && gy <= 35) continue;

      const road = sampleRoadInfo(seed, gx, gy);
      const river = sampleRiverInfo(seed, gx, gy);

      if (road.isMainHighway && !river.inWater && river.riverBand > 0.04) {
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

  const distRing = Math.hypot(rx - 0.5, ry - 0.5);
  const roll = rng();

  // 1. Highway Pileups & Military Checkpoints on major curved highways
  if (highwaySpot && roll < 0.72) {
    const isCheckpoint = rng() < 0.48;
    const biome = sampleBiomeAt(seed, highwaySpot.gx, highwaySpot.gy);
    const id = `lm_${rx}_${ry}`;
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
    const biome = sampleBiomeAt(seed, riverSpot.gx, riverSpot.gy);
    return {
      id: `lm_${rx}_${ry}`,
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
  if (Math.hypot(anchor.gx - 84, anchor.gy - 28) < 12) return null;

  const biome = sampleBiomeAt(seed, anchor.gx, anchor.gy);
  const subRoll = rng();

  if (biome === 'pine_forest' && subRoll < 0.44) {
    return {
      id: `lm_${rx}_${ry}`,
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
      ? ['outpost', 'diner', 'clinic']
      : biome === 'pine_forest'
        ? ['cabin', 'outpost', 'clinic']
        : ['diner', 'clinic', 'cabin', 'outpost'];

  const kind = buildingPool[h % buildingPool.length];
  const labelPrefix =
    kind === 'clinic'
      ? 'Field Clinic'
      : kind === 'diner'
        ? 'Roadside Diner'
        : kind === 'outpost'
          ? 'Ranger Outpost'
          : 'Timber Cabin';

  return {
    id: `lm_${rx}_${ry}`,
    kind,
    name: `${labelPrefix} ${(h % 19) + 1}`,
    biome,
    gx: anchor.gx,
    gy: anchor.gy,
    radius: 8,
    threatLevel: kind === 'outpost' ? 'high' : 'medium',
    hotspotPacks:
      kind === 'outpost'
        ? ['runner', 'spitter', 'bloater', 'walker']
        : ['walker', 'walker', 'runner'],
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
        { gx: bx + 5, gy: by + 4, orientation: 'ew', status: 'closed' },
      ],
      partitions: [{ x0: bx + 1, y0: by + 4, x1: bx + 9, y1: by + 4 }],
      rooms: [
        { x0: bx + 1, y0: by + 5, w: 9, h: 3, floorType: 'tile_clinic' },
        { x0: bx + 1, y0: by + 1, w: 9, h: 3, floorType: 'floor_bath' },
      ],
      props: [
        { gx: bx + 1, gy: by + 5, prop: 'counter' },
        { gx: bx + 9, gy: by + 5, prop: 'bench' },
        {
          gx: bx + 9,
          gy: by + 1,
          prop: 'med_cabinet',
          lootKind: 'med_cabinet',
          lootItems: { bandage: 2 + (h % 2), cloth: 2, water: 2 },
        },
        { gx: bx + 1, gy: by + 1, prop: 'sink_toilet' },
        { gx: bx + 4, gy: by + 1, prop: 'bed' },
        { gx: bx + 7, gy: by + 1, prop: 'desk' },
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
        { gx: bx + 7, gy: by + 4, orientation: 'ew', status: 'open' },
      ],
      partitions: [{ x0: bx + 6, y0: by + 1, x1: bx + 6, y1: by + 7 }],
      rooms: [
        { x0: bx + 1, y0: by + 1, w: 5, h: 7, floorType: 'tile_diner' },
        { x0: bx + 7, y0: by + 1, w: 4, h: 7, floorType: 'floor', rug: { x0: bx + 8, y0: by + 5, w: 2, h: 2 } },
      ],
      props: [
        { gx: bx + 1, gy: by + 1, prop: 'stove' },
        {
          gx: bx + 3,
          gy: by + 1,
          prop: 'fridge',
          lootKind: 'fridge',
          lootItems: { food: 2 + (h % 2), water: 2, raw_fish: h % 2 },
        },
        { gx: bx + 5, gy: by + 1, prop: 'counter' },
        { gx: bx + 2, gy: by + 5, prop: 'table' },
        { gx: bx + 1, gy: by + 5, prop: 'bench' },
        { gx: bx + 10, gy: by + 1, prop: 'tv_stand' },
        { gx: bx + 10, gy: by + 6, prop: 'bed' },
        {
          gx: bx + 7,
          gy: by + 1,
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
        { gx: bx + 3, gy: by + 7, prop: 'counter' },
        {
          gx: bx + 9,
          gy: by + 1,
          prop: 'crate_military',
          lootKind: 'crate_military',
          lootItems: { ammo_9mm: 8 + (h % 6), ammo_shell: 3 + (h % 3), scrap: 3, molotov: h % 3 === 0 ? 1 : 0 },
        },
        { gx: bx + 6, gy: by + 7, prop: 'bed' },
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

  // Timber Cabin
  return {
    x0: bx + 1,
    y0: by,
    w: 9,
    h: 8,
    wallType: 'wall_wood',
    floorType: 'floor',
    porch: { x0: bx + 4, y0: by + 8, w: 3, h: 1 },
    doors: [
      { gx: bx + 5, gy: by + 7, orientation: 'ew', status: 'closed' },
      { gx: bx + 5, gy: by + 3, orientation: 'ns', status: 'open' },
    ],
    partitions: [{ x0: bx + 5, y0: by + 1, x1: bx + 5, y1: by + 6 }],
    rooms: [
      { x0: bx + 2, y0: by + 1, w: 3, h: 6, floorType: 'floor', rug: { x0: bx + 2, y0: by + 3, w: 2, h: 2 } },
      { x0: bx + 6, y0: by + 1, w: 3, h: 6, floorType: 'floor' },
    ],
    props: [
      { gx: bx + 2, gy: by + 1, prop: 'bed' },
      { gx: bx + 2, gy: by + 6, prop: 'bookshelf' },
      { gx: bx + 8, gy: by + 1, prop: 'stove' },
      { gx: bx + 6, gy: by + 1, prop: 'table' },
      {
        gx: bx + 8,
        gy: by + 6,
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
  nextVehicleIdRef: { nextId: number }
): OuterChunkSpawnResult {
  const key = chunkKey(cx, cy);
  const cells: TileCell[][] = [];
  const startGX = cx * CHUNK_SIZE;
  const startGY = cy * CHUNK_SIZE;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const row: TileCell[] = [];
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      row.push(createOuterBaseCell(store.seed, startGX + lx, startGY + ly));
    }
    cells.push(row);
  }

  const chunk: WorldChunk = { cx, cy, key, cells };
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
  const poi = getMacroRegionPOI(store.seed, rx, ry);

  if (poi && !store.landmarks.has(poi.id)) {
    store.landmarks.set(poi.id, {
      id: poi.id,
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

  // Stamp Landmark POI inside this chunk
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

      // Compact brick guardhouse tucked beside checkpoint shoulder (gx + 4..8, gy - 6..-2)
      const guardhouse: BuildingSpec = {
        x0: poi.gx + 3,
        y0: poi.gy - 6,
        w: 5,
        h: 5,
        wallType: 'wall_brick',
        floorType: 'tile_clinic',
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
                cell.solid = true;
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
      // Clear 1-tile exterior apron so porch & doors are always unobstructed
      for (let y = spec.y0 - 1; y <= spec.y0 + spec.h + 1; y++) {
        for (let x = spec.x0 - 1; x <= spec.x0 + spec.w + 1; x++) {
          setLocal(x, y, (cell) => {
            if (cell.tile === 'water') cell.tile = 'dirt';
            cell.prop = 'none';
            cell.solid = false;
            cell.blocksSight = false;
          });
        }
      }
      applyBuildingToSetter(setLocal, spec, doors, containers);
    }
  }

  // Occasional scenic lakeside clearing in empty pine_forest or rural_meadow regions (never blocking highways or East test spot)
  const chunkRng = createRng(hashCoords(store.seed + 719, cx, cy));
  if (!poi && chunkRng() < 0.14) {
    const lakeCX = startGX + 8;
    const lakeCY = startGY + 8;
    const roadNear = sampleRoadInfo(store.seed, lakeCX, lakeCY);
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
            cells[ly][lx].solid = true;
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

      if (poi && Math.hypot(cell.gx - poi.gx, cell.gy - poi.gy) <= 6.2) {
        continue;
      }

      const biome = sampleBiomeAt(store.seed, cell.gx, cell.gy);
      const r = chunkRng();

      if (biome === 'pine_forest') {
        if (r < 0.145) {
          cell.prop = chunkRng() < 0.84 ? 'tree_pine' : 'tree_dead';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.168) {
          cell.prop = 'fallen_log';
          cell.solid = true;
        } else if (r < 0.184) {
          cell.prop = 'rock_boulder';
          cell.solid = true;
        } else if (r < 0.189) {
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
        if (r < 0.055) {
          cell.prop = chunkRng() < 0.65 ? 'tree_pine' : 'tree_dead';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.082) {
          cell.prop = 'rock_boulder';
          cell.solid = true;
        } else if (r < 0.098) {
          cell.prop = 'fallen_log';
          cell.solid = true;
        } else if (r < 0.103) {
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
        if (r < 0.052) {
          cell.prop = 'tree_dead';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.078) {
          cell.prop = 'rock_boulder';
          cell.solid = true;
        } else if (r < 0.084 && cell.tile === 'gravel') {
          cell.prop = 'wrecked_car';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.089) {
          cell.prop = 'barrel_burn';
          cell.solid = true;
        }
      } else {
        // rural_meadow
        if (r < 0.068) {
          cell.prop = chunkRng() < 0.78 ? 'tree_pine' : 'tree_dead';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.082) {
          cell.prop = 'rock_boulder';
          cell.solid = true;
        } else if (r < 0.092) {
          cell.prop = 'fallen_log';
          cell.solid = true;
        } else if (r < 0.096) {
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

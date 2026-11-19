import { clamp } from './isometric';
import type { TileCell, WorldLandmark } from './types';
import { fbm2D, hashCoords, sampleRiverInfo, sampleRoadInfo } from './worldGen';

export const CLIFF_SLOPE_THRESHOLD = 0.62;
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
export function getFrontierFactor(wx: number, wy: number): number {
  const dx = wx < 0 ? -wx : wx > 64 ? wx - 64 : 0;
  const dy = wy < 0 ? -wy : wy > 64 ? wy - 64 : 0;
  const distTown = Math.hypot(dx, dy);
  return smoothstep(1.5, 14.0, distTown);
}

/**
 * Evaluates raw highland elevation (hills, ridges, terraced cliff bands, and carved river valleys)
 * BEFORE road grading, bridges, tunnels, and caves are applied.
 */
export function sampleRawHillHeight(seed: number, wx: number, wy: number): number {
  const frontier = getFrontierFactor(wx, wy);
  if (frontier <= 0.0001) return 0;

  const river = sampleRiverInfo(seed, wx, wy);
  // Carve smooth valley floors down toward water level along rivers
  const valleyMask = smoothstep(0.032, 0.115, river.riverBand);
  if (valleyMask <= 0.0001) return 0;

  // Rolling macro hills + mountain ridge chains
  const macro = fbm2D(seed + 1701, wx * 0.0175, wy * 0.0175, 3);
  const ridgeRaw = fbm2D(seed + 1907, wx * 0.023 + 11.3, wy * 0.023 - 7.1, 2);
  const ridge = 1 - Math.abs(ridgeRaw * 2 - 1);
  const detail = fbm2D(seed + 2311, wx * 0.055 - 4.2, wy * 0.055 + 8.7, 2);

  // Boost highlands slightly near outer ring so hilly terrain & tunnels appear quickly once leaving town
  const rolling = Math.pow(clamp((macro - 0.30) / 0.70, 0, 1), 1.15) * 4.2;
  const ridgeline = Math.pow(clamp((ridge - 0.42) / 0.58, 0, 1), 1.65) * 2.8;
  const undulation = (detail - 0.5) * 0.42;

  let h = Math.max(0, rolling + ridgeline + undulation) * frontier * valleyMask;

  // Apply crisp cliff-terrace shaping around elevation 1.7 and 3.4 to create dramatic plateaus & steep cliff faces
  const terrace1 = smoothstep(1.45, 2.05, h);
  const terrace2 = smoothstep(3.15, 3.75, h);
  h = h * 0.74 + terrace1 * 1.05 + terrace2 * 1.15;

  // Keep immediate East starter highway test corridor (84, 28) gently passable
  const eastDist = Math.hypot(wx - 84, wy - 28);
  if (eastDist < 12) {
    const t = smoothstep(4, 12, eastDist);
    h = h * (0.25 + 0.75 * t);
  }

  return clamp(h, 0, 6.2);
}

// Memoized cave lookup per macro-region (32x32 tiles) for fast zero-GC runtime queries
const cavePlanCache = new Map<string, RockyCavePlan | null>();

export function clearTerrainCaches(): void {
  cavePlanCache.clear();
}

/**
 * Deterministically places hidden Rocky Cliff Caves into elevated outer-frontier regions.
 * Guaranteed not to overlap starter town (rx/ry in 0..1), main highways, or rivers.
 */
export function getMacroRegionCave(seed: number, rx: number, ry: number): RockyCavePlan | null {
  // Never place caves inside the 4x4 origin town sector
  if (rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1) return null;

  const cacheKey = `${seed}:${rx},${ry}`;
  if (cavePlanCache.has(cacheKey)) {
    return cavePlanCache.get(cacheKey)!;
  }

  const h = hashCoords(seed + 4999, rx, ry);
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
      if (Math.hypot(gx - 84, gy - 28) < 14) continue;

      const road = sampleRoadInfo(seed, gx, gy);
      if (road.highwayDist < 7.5) continue;
      const river = sampleRiverInfo(seed, gx, gy);
      if (river.riverBand < 0.08) continue;

      const hill = sampleRawHillHeight(seed, gx + 0.5, gy + 0.5);
      // Prefer rocky hillside benches where a cliff rises behind the cavern
      if (hill < 1.15) continue;

      // Ensure cave mouth apron is dry & road-free
      let ok = true;
      for (let dy = -4; dy <= 6 && ok; dy += 2) {
        for (let dx = -4; dx <= 6 && ok; dx += 2) {
          if (sampleRoadInfo(seed, gx + dx, gy + dy).isAnyRoad) ok = false;
          if (sampleRiverInfo(seed, gx + dx, gy + dy).inWater) ok = false;
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
    id: `cave_${rx}_${ry}`,
    name: `Rocky Cave #${(h % 29) + 1}`,
    rx,
    ry,
    gx: best.gx,
    gy: best.gy,
    chamberRadius,
    mouthDir,
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
  return plan;
}

/**
 * Checks whether world coordinate (wx, wy) falls inside or near a Rocky Cliff Cave.
 */
export function findRockyCaveAt(seed: number, wx: number, wy: number): {
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
  const rx = Math.floor(wx / 32);
  const ry = Math.floor(wy / 32);

  // Check owning macro-region and immediate neighbors (caves sit inside margin 8..23 so owning region suffices,
  // checking +-1 guarantees safety near edges)
  for (let dry = -1; dry <= 1; dry++) {
    for (let drx = -1; drx <= 1; drx++) {
      const cave = getMacroRegionCave(seed, rx + drx, ry + dry);
      if (!cave) continue;
      const dx = wx - (cave.gx + 0.5);
      const dy = wy - (cave.gy + 0.5);
      const d = Math.hypot(dx, dy);
      if (d > 8.5) continue;

      const inMouth =
        cave.mouthDir === 's'
          ? dy >= 1.5 && dy <= 5.2 && Math.abs(dx) <= 1.55
          : dx >= 1.5 && dx <= 5.2 && Math.abs(dy) <= 1.55;

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
export function sampleBridgeInfo(seed: number, wx: number, wy: number): {
  isBridge: boolean;
  bridgeHeight: number;
  axis: 'ew' | 'ns' | 'none';
} {
  if (wx >= 0 && wx < 64 && wy >= 0 && wy < 64) {
    return { isBridge: false, bridgeHeight: 0, axis: 'none' };
  }
  const road = sampleRoadInfo(seed, wx, wy);
  if (!road.isAnyRoad) {
    return { isBridge: false, bridgeHeight: 0, axis: 'none' };
  }
  const river = sampleRiverInfo(seed, wx, wy);
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
export function sampleRoadTunnelInfo(seed: number, wx: number, wy: number): {
  isTunnel: boolean;
  isPortal: boolean;
  floorY: number;
  roofY: number;
  axis: 'ew' | 'ns' | 'none';
} {
  if (wx >= 0 && wx < 64 && wy >= 0 && wy < 64) {
    return { isTunnel: false, isPortal: false, floorY: 0, roofY: 0, axis: 'none' };
  }
  const road = sampleRoadInfo(seed, wx, wy);
  if (!road.isMainHighway && !road.isShoulder) {
    return { isTunnel: false, isPortal: false, floorY: 0, roofY: 0, axis: 'none' };
  }
  const river = sampleRiverInfo(seed, wx, wy);
  if (river.riverBand < 0.075) {
    return { isTunnel: false, isPortal: false, floorY: 0, roofY: 0, axis: 'none' };
  }

  const rawHill = sampleRawHillHeight(seed, wx, wy);
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
 * Returns true if tile (gx, gy) is a flanking tunnel retaining-wall shoulder adjacent to an active
 * highway road tunnel (marked solid so players/vehicles/zombies cannot clip sideways out of tunnels).
 */
export function isTunnelSideWallTile(seed: number, gx: number, gy: number): boolean {
  if (gx >= 0 && gx < 64 && gy >= 0 && gy < 64) return false;
  const cx = gx + 0.5;
  const cy = gy + 0.5;
  const selfRoad = sampleRoadInfo(seed, cx, cy);
  if (selfRoad.isMainHighway) return false;
  const selfRiver = sampleRiverInfo(seed, cx, cy);
  if (selfRiver.inWater) return false;

  // Check immediate cardinal neighbors for a tunnel road tile whose perpendicular edge borders (gx, gy)
  const nTun = sampleRoadTunnelInfo(seed, cx, cy - 1);
  if (nTun.isTunnel && nTun.axis === 'ew') return true;
  const sTun = sampleRoadTunnelInfo(seed, cx, cy + 1);
  if (sTun.isTunnel && sTun.axis === 'ew') return true;
  const wTun = sampleRoadTunnelInfo(seed, cx - 1, cy);
  if (wTun.isTunnel && wTun.axis === 'ns') return true;
  const eTun = sampleRoadTunnelInfo(seed, cx + 1, cy);
  if (eTun.isTunnel && eTun.axis === 'ns') return true;

  return false;
}

/**
 * Continuous deterministic walkable elevation at any world coordinate (wx, wy).
 * Used identically by simulation physics, props, bridges, grass, vehicles, and camera.
 */
export function sampleTerrainHeight(seed: number, wx: number, wy: number): number {
  const frontier = getFrontierFactor(wx, wy);
  if (frontier <= 0.0001) return 0;

  // 1. River bridge arch overrides terrain along river-crossing road decks
  const bridge = sampleBridgeInfo(seed, wx, wy);
  if (bridge.isBridge) {
    return bridge.bridgeHeight;
  }

  const rawHill = sampleRawHillHeight(seed, wx, wy);
  let h = rawHill;

  // 2. Grade hilly roads smoothly & carve road tunnels through big ridges
  const road = sampleRoadInfo(seed, wx, wy);
  const river = sampleRiverInfo(seed, wx, wy);
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
  const caveHit = findRockyCaveAt(seed, wx, wy);
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
  if (river.inWater) {
    return 0;
  }

  return Math.max(0, h);
}

/**
 * Ground terrain mesh height used exclusively for displacing the 3D terrain plane vertices.
 * Differs from sampleTerrainHeight ONLY underneath river bridges, where the riverbed stays
 * depressed below WATER_SURFACE_Y so flowing river water passes cleanly under the 3D bridge deck!
 */
export function sampleTerrainMeshHeight(seed: number, wx: number, wy: number): number {
  const frontier = getFrontierFactor(wx, wy);
  if (frontier <= 0.0001) return 0;

  const bridge = sampleBridgeInfo(seed, wx, wy);
  if (bridge.isBridge) {
    const river = sampleRiverInfo(seed, wx, wy);
    if (river.inWater || river.riverBand < 0.036) {
      // Depress riverbed beneath the water surface so animated water flows continuously under bridges
      return -0.18;
    }
    // Smooth bank abutment ramp from riverbed up to bridge edge
    const bankT = smoothstep(0.036, 0.044, river.riverBand);
    return -0.18 * (1 - bankT) + bridge.bridgeHeight * bankT;
  }

  const river = sampleRiverInfo(seed, wx, wy);
  if (river.inWater) {
    return -0.14;
  }
  if (river.riverBand < 0.036) {
    const shoreT = smoothstep(0.024, 0.036, river.riverBand);
    const groundH = sampleTerrainHeight(seed, wx, wy);
    return -0.10 * (1 - shoreT) + groundH * shoreT;
  }

  return sampleTerrainHeight(seed, wx, wy);
}

/**
 * Full terrain surface inspection at (wx, wy): height, surface normal, slope, cliff, bridge, tunnel, cave.
 */
export function sampleTerrainSurface(seed: number, wx: number, wy: number): TerrainSurfaceSample {
  const height = sampleTerrainHeight(seed, wx, wy);
  const massifHeight = sampleRawHillHeight(seed, wx, wy);
  const bridge = sampleBridgeInfo(seed, wx, wy);
  const tunnel = sampleRoadTunnelInfo(seed, wx, wy);
  const caveHit = findRockyCaveAt(seed, wx, wy);

  // Finite-difference surface normal (step 0.5 tiles)
  const eps = 0.5;
  const hL = sampleTerrainHeight(seed, wx - eps, wy);
  const hR = sampleTerrainHeight(seed, wx + eps, wy);
  const hD = sampleTerrainHeight(seed, wx, wy - eps);
  const hU = sampleTerrainHeight(seed, wx, wy + eps);
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

  const road = sampleRoadInfo(seed, wx, wy);
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
  maxStepHeight = 0.68
): boolean {
  // Fast exit inside flat starter town (0..64)
  if (
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

  const fromBridge = sampleBridgeInfo(seed, fromX, fromY);
  const toBridge = sampleBridgeInfo(seed, toX, toY);

  // 1. Block lateral drop-off or climb-on over elevated river bridge guardrails
  if (fromBridge.isBridge !== toBridge.isBridge) {
    const activeBridge = fromBridge.isBridge ? fromBridge : toBridge;
    const otherX = fromBridge.isBridge ? toX : fromX;
    const otherY = fromBridge.isBridge ? toY : fromY;
    const otherRoad = sampleRoadInfo(seed, otherX, otherY);
    const otherRiver = sampleRiverInfo(seed, otherX, otherY);
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
  const fromTun = sampleRoadTunnelInfo(seed, fromX, fromY);
  const toTun = sampleRoadTunnelInfo(seed, toX, toY);
  if (fromTun.isTunnel && !toTun.isTunnel && !toTun.isPortal) {
    const toRoad = sampleRoadInfo(seed, toX, toY);
    if (!toRoad.isMainHighway) return true;
  }
  if (!fromTun.isTunnel && !fromTun.isPortal && toTun.isTunnel) {
    const fromRoad = sampleRoadInfo(seed, fromX, fromY);
    if (!fromRoad.isMainHighway) return true;
  }

  // 3. Block climbing into/through cave walls (including low cutaway front walls) or steep vertical cliff jumps
  const toCave = findRockyCaveAt(seed, toX, toY);
  if (toCave && toCave.inWallRing) {
    return true;
  }

  const toRoad = sampleRoadInfo(seed, toX, toY);
  const toCaveOpen = Boolean(toCave && (toCave.inInterior || toCave.inMouth));
  if (!toBridge.isBridge && !toTun.isTunnel && !toRoad.isAnyRoad && !toCaveOpen) {
    const h0 = sampleTerrainHeight(seed, fromX, fromY);
    const h1 = sampleTerrainHeight(seed, toX, toY);
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
  isVehicle = false
): number {
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen < 0.001) return 1;
  const ux = dirX / dirLen;
  const uy = dirY / dirLen;

  const step = 0.6;
  const h0 = sampleTerrainHeight(seed, wx, wy);
  const h1 = sampleTerrainHeight(seed, wx + ux * step, wy + uy * step);
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
  inVehicle: boolean
): { sheltered: boolean; label: string | null; kind: 'cave' | 'tunnel' | 'building' | 'vehicle' | null } {
  const surf = sampleTerrainSurface(seed, wx, wy);
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
  landmarks?: Iterable<WorldLandmark>
): boolean {
  const caveHit = findRockyCaveAt(seed, wx, wy);
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

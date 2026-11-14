import { clamp } from './isometric';
import type {
  DoorEntity,
  ImpactMaterial,
  PropKind,
  StructureKind,
  TileCell,
  TileKind,
  Vehicle,
  WorldStructure,
  Zombie,
} from './types';

export const BULLET_SPEED = 78;
export const PELLET_SPEED = 64;
export const HEADSHOT_MULTIPLIER_BULLET = 2.2;
export const HEADSHOT_MULTIPLIER_PELLET = 2.0;
export const FPS_CEILING_HEIGHT = 1.68;

export interface WorldHitResult {
  t: number;
  hx: number;
  hy: number;
  hz: number;
  nx: number;
  ny: number;
  nz: number;
  material: ImpactMaterial;
  allowDecal: boolean;
  vehicleId?: number;
}

export interface ZombieHitResult {
  zombie: Zombie;
  t: number;
  hx: number;
  hy: number;
  hz: number;
  isHeadshot: boolean;
}

export function computeProjectileVelocity3D(
  yaw: number,
  pitch: number,
  yawOffset: number,
  pitchOffset: number,
  speed: number
): { vx: number; vy: number; vz: number } {
  const totalYaw = yaw + yawOffset;
  const totalPitch = clamp(pitch + pitchOffset, -Math.PI * 0.45, Math.PI * 0.45);
  const cosP = Math.cos(totalPitch);
  return {
    vx: Math.cos(totalYaw) * cosP * speed,
    vy: Math.sin(totalYaw) * cosP * speed,
    vz: Math.sin(totalPitch) * speed,
  };
}

export function isIndoorCeilingTile(tile: TileKind): boolean {
  return (
    tile === 'floor' ||
    tile === 'floor_rug' ||
    tile === 'floor_bath' ||
    tile === 'tile_clinic' ||
    tile === 'tile_diner'
  );
}

export function classifySurfaceMaterial(
  tile: TileKind,
  prop: PropKind,
  structureKind?: StructureKind
): ImpactMaterial {
  if (structureKind) {
    return 'wood';
  }
  switch (prop) {
    case 'wall_brick':
    case 'wall_interior':
    case 'concrete_barrier':
    case 'sink_toilet':
      return 'stone';
    case 'wall_wood':
    case 'door':
    case 'tree_pine':
    case 'tree_dead':
    case 'crate_wood':
    case 'counter':
    case 'bench':
    case 'bed':
    case 'couch':
    case 'table':
    case 'bookshelf':
    case 'desk':
    case 'fishing_post':
    case 'tv_stand':
      return 'wood';
    case 'car_sedan':
    case 'car_police':
    case 'crate_military':
    case 'fridge':
    case 'med_cabinet':
    case 'barrel_burn':
    case 'streetlamp':
    case 'dumpster':
    case 'hydrant':
    case 'stove':
      return 'metal';
    case 'none':
    default:
      break;
  }

  switch (tile) {
    case 'water':
      return 'water';
    case 'pier':
    case 'floor':
    case 'floor_rug':
    case 'floor_porch':
      return 'wood';
    case 'grass':
    case 'dirt':
      return 'dirt';
    case 'road':
    case 'sidewalk':
    case 'crosswalk':
    case 'floor_bath':
    case 'tile_clinic':
    case 'tile_diner':
    default:
      return 'stone';
  }
}

export function mapMaterialToDecalKind(
  material: ImpactMaterial
): 'stone' | 'wood' | 'metal' | null {
  if (material === 'water') return null;
  if (material === 'wood') return 'wood';
  if (material === 'metal') return 'metal';
  return 'stone';
}

export function intersectSegmentAABB(
  x0: number,
  y0: number,
  z0: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number
): { t: number; nx: number; ny: number; nz: number } | null {
  let tMin = 0;
  let tMax = 1;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  const checkAxis = (
    p: number,
    d: number,
    bMin: number,
    bMax: number,
    axis: 0 | 1 | 2
  ): boolean => {
    if (Math.abs(d) < 1e-8) {
      return p >= bMin && p <= bMax;
    }
    const invD = 1 / d;
    let t1 = (bMin - p) * invD;
    let t2 = (bMax - p) * invD;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      nx = axis === 0 ? s : 0;
      ny = axis === 1 ? s : 0;
      nz = axis === 2 ? s : 0;
    }
    if (t2 < tMax) tMax = t2;
    return tMin <= tMax;
  };

  if (!checkAxis(x0, dx, minX, maxX, 0)) return null;
  if (!checkAxis(y0, dy, minY, maxY, 1)) return null;
  if (!checkAxis(z0, dz, minZ, maxZ, 2)) return null;

  // Ignore segments that originate already embedded inside the solid volume
  if (tMin === 0 && x0 > minX && x0 < maxX && y0 > minY && y0 < maxY && z0 > minZ && z0 < maxZ) {
    return null;
  }
  if (tMin < 0 || tMin > 1) return null;

  return { t: tMin, nx, ny, nz };
}

function getPropBounds(
  prop: PropKind,
  gx: number,
  gy: number,
  isFps: boolean
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null {
  switch (prop) {
    case 'wall_brick':
    case 'wall_wood':
      return { minX: gx, maxX: gx + 1, minY: gy, maxY: gy + 1, minZ: 0, maxZ: isFps ? 1.94 : 1.04 };
    case 'wall_interior':
      return { minX: gx, maxX: gx + 1, minY: gy, maxY: gy + 1, minZ: 0, maxZ: isFps ? 1.68 : 0.80 };
    case 'crate_wood':
    case 'crate_military':
      return { minX: gx + 0.12, maxX: gx + 0.88, minY: gy + 0.12, maxY: gy + 0.88, minZ: 0, maxZ: 0.60 };
    case 'fridge':
      return { minX: gx + 0.18, maxX: gx + 0.82, minY: gy + 0.21, maxY: gy + 0.79, minZ: 0, maxZ: 1.06 };
    case 'med_cabinet':
      return { minX: gx + 0.22, maxX: gx + 0.78, minY: gy + 0.27, maxY: gy + 0.73, minZ: 0, maxZ: 0.92 };
    case 'dumpster':
      return { minX: gx + 0.04, maxX: gx + 0.96, minY: gy + 0.19, maxY: gy + 0.81, minZ: 0, maxZ: 0.72 };
    case 'barrel_burn':
      return { minX: gx + 0.24, maxX: gx + 0.76, minY: gy + 0.24, maxY: gy + 0.76, minZ: 0, maxZ: 0.74 };
    case 'concrete_barrier':
      return { minX: gx + 0.03, maxX: gx + 0.97, minY: gy + 0.28, maxY: gy + 0.72, minZ: 0, maxZ: 0.52 };
    case 'bookshelf':
      return { minX: gx + 0.07, maxX: gx + 0.93, minY: gy + 0.30, maxY: gy + 0.70, minZ: 0, maxZ: 1.09 };
    case 'stove':
      return { minX: gx + 0.16, maxX: gx + 0.84, minY: gy + 0.17, maxY: gy + 0.83, minZ: 0, maxZ: 0.64 };
    case 'hydrant':
      return { minX: gx + 0.34, maxX: gx + 0.66, minY: gy + 0.34, maxY: gy + 0.66, minZ: 0, maxZ: 0.59 };
    case 'streetlamp':
      return { minX: gx + 0.445, maxX: gx + 0.555, minY: gy + 0.445, maxY: gy + 0.555, minZ: 0, maxZ: 1.95 };
    case 'tree_pine':
      return { minX: gx + 0.26, maxX: gx + 0.74, minY: gy + 0.26, maxY: gy + 0.74, minZ: 0, maxZ: 1.95 };
    case 'tree_dead':
      return { minX: gx + 0.32, maxX: gx + 0.68, minY: gy + 0.32, maxY: gy + 0.68, minZ: 0, maxZ: 1.50 };
    case 'counter':
    case 'desk':
    case 'table':
      return { minX: gx + 0.06, maxX: gx + 0.94, minY: gy + 0.18, maxY: gy + 0.82, minZ: 0, maxZ: 0.56 };
    case 'couch':
    case 'bench':
    case 'bed':
      return { minX: gx + 0.06, maxX: gx + 0.94, minY: gy + 0.16, maxY: gy + 0.84, minZ: 0, maxZ: 0.48 };
    case 'tv_stand':
    case 'sink_toilet':
      return { minX: gx + 0.14, maxX: gx + 0.86, minY: gy + 0.24, maxY: gy + 0.76, minZ: 0, maxZ: 0.78 };
    case 'fishing_post':
      return { minX: gx + 0.39, maxX: gx + 0.61, minY: gy + 0.39, maxY: gy + 0.61, minZ: 0, maxZ: 0.90 };
    default:
      return null;
  }
}

export function traceSegmentWorldHit(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  isFps: boolean,
  getCell: (gx: number, gy: number) => TileCell,
  doors: readonly DoorEntity[],
  structures: readonly WorldStructure[],
  vehicles: readonly Vehicle[],
  ignoreVehicleId: number | null = null
): WorldHitResult | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;

  let best: WorldHitResult | null = null;
  const consider = (
    t: number,
    nx: number,
    ny: number,
    nz: number,
    material: ImpactMaterial,
    allowDecal: boolean,
    vehicleId?: number
  ) => {
    if (best && t >= best.t) return;
    best = {
      t,
      hx: x0 + dx * t,
      hy: y0 + dy * t,
      hz: z0 + dz * t,
      nx,
      ny,
      nz,
      material,
      allowDecal,
      vehicleId,
    };
  };

  // 1. Ground plane (z = 0.02)
  if (z0 > 0.02 && z1 <= 0.02 && dz < -1e-7) {
    const t = (0.02 - z0) / dz;
    if (t >= 0 && t <= 1) {
      const hx = x0 + dx * t;
      const hy = y0 + dy * t;
      const cell = getCell(Math.floor(hx), Math.floor(hy));
      const mat = classifySurfaceMaterial(cell.tile, 'none');
      consider(t, 0, 0, 1, mat, mat !== 'water');
    }
  }

  // 2. FPS interior ceiling plane (z = FPS_CEILING_HEIGHT = 1.68)
  if (isFps && z0 < FPS_CEILING_HEIGHT && z1 >= FPS_CEILING_HEIGHT && dz > 1e-7) {
    const t = (FPS_CEILING_HEIGHT - z0) / dz;
    if (t >= 0 && t <= 1) {
      const hx = x0 + dx * t;
      const hy = y0 + dy * t;
      const cell = getCell(Math.floor(hx), Math.floor(hy));
      if (isIndoorCeilingTile(cell.tile)) {
        consider(t, 0, 0, -1, 'stone', true);
      }
    }
  }

  // 3. Static world tiles, props & lintels overlapped by the segment
  const minGX = Math.floor(Math.min(x0, x1)) - 1;
  const maxGX = Math.floor(Math.max(x0, x1)) + 1;
  const minGY = Math.floor(Math.min(y0, y1)) - 1;
  const maxGY = Math.floor(Math.max(y0, y1)) + 1;

  for (let gy = minGY; gy <= maxGY; gy++) {
    for (let gx = minGX; gx <= maxGX; gx++) {
      const cell = getCell(gx, gy);
      if (cell.prop === 'door') {
        if (isFps) {
          const lintelHit = intersectSegmentAABB(
            x0, y0, z0, dx, dy, dz,
            gx, gx + 1, gy, gy + 1, 1.02, 1.94
          );
          if (lintelHit) {
            consider(lintelHit.t, lintelHit.nx, lintelHit.ny, lintelHit.nz, 'stone', true);
          }
        }
        continue;
      }
      if (cell.prop === 'none' || cell.prop === 'car_sedan' || cell.prop === 'car_police') continue;
      const box = getPropBounds(cell.prop, gx, gy, isFps);
      if (!box) continue;
      const hit = intersectSegmentAABB(
        x0, y0, z0, dx, dy, dz,
        box.minX, box.maxX, box.minY, box.maxY, box.minZ, box.maxZ
      );
      if (hit) {
        const mat = classifySurfaceMaterial(cell.tile, cell.prop);
        const allowDecal = cell.prop !== 'streetlamp' && cell.prop !== 'fishing_post';
        consider(hit.t, hit.nx, hit.ny, hit.nz, mat, allowDecal);
      }
    }
  }

  // 4. Closed/locked/barricaded doors
  for (const d of doors) {
    if (d.status === 'open') continue;
    if (d.gx < minGX || d.gx > maxGX || d.gy < minGY || d.gy > maxGY) continue;
    const minX = d.orientation === 'ns' ? d.gx + 0.42 : d.gx;
    const maxX = d.orientation === 'ns' ? d.gx + 0.58 : d.gx + 1;
    const minY = d.orientation === 'ns' ? d.gy : d.gy + 0.42;
    const maxY = d.orientation === 'ns' ? d.gy + 1 : d.gy + 0.58;
    const hit = intersectSegmentAABB(x0, y0, z0, dx, dy, dz, minX, maxX, minY, maxY, 0, 1.0);
    if (hit) {
      consider(hit.t, hit.nx, hit.ny, hit.nz, 'wood', true);
    }
  }

  // 5. Player-built structures (barricades)
  for (const s of structures) {
    if (s.kind !== 'barricade') continue;
    if (s.gx < minGX || s.gx > maxGX || s.gy < minGY || s.gy > maxGY) continue;
    const hit = intersectSegmentAABB(
      x0, y0, z0, dx, dy, dz,
      s.gx + 0.08, s.gx + 0.92, s.gy + 0.25, s.gy + 0.75, 0, 0.92
    );
    if (hit) {
      consider(hit.t, hit.nx, hit.ny, hit.nz, 'wood', true);
    }
  }

  // 6. Dynamic Vehicles (oriented metallic hulls)
  for (const v of vehicles) {
    if (v.id === ignoreVehicleId) continue;
    const approxDist = Math.hypot(v.x - x0, v.y - y0);
    if (approxDist > Math.hypot(dx, dy) + 1.8) continue;
    const cos = Math.cos(-v.angle);
    const sin = Math.sin(-v.angle);
    const rx0 = x0 - v.x;
    const ry0 = y0 - v.y;
    const lx0 = rx0 * cos - ry0 * sin;
    const ly0 = rx0 * sin + ry0 * cos;
    const ldx = dx * cos - dy * sin;
    const ldy = dx * sin + dy * cos;

    const hit = intersectSegmentAABB(
      lx0, ly0, z0, ldx, ldy, dz,
      -0.96, 0.96, -0.52, 0.52, 0.05, 0.88
    );
    if (hit) {
      const wCos = Math.cos(v.angle);
      const wSin = Math.sin(v.angle);
      const wnx = hit.nx * wCos - hit.ny * wSin;
      const wny = hit.nx * wSin + hit.ny * wCos;
      consider(hit.t, wnx, wny, hit.nz, 'metal', true, v.id);
    }
  }

  return best;
}

function intersectSegmentCylinder(
  x0: number,
  y0: number,
  z0: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  radius: number,
  zMin: number,
  zMax: number,
  maxT: number
): number | null {
  // Z-slab interval [tZ0, tZ1]
  let tZ0 = 0;
  let tZ1 = maxT;
  if (Math.abs(dz) < 1e-8) {
    if (z0 < zMin || z0 > zMax) return null;
  } else {
    const invDz = 1 / dz;
    let ta = (zMin - z0) * invDz;
    let tb = (zMax - z0) * invDz;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
    }
    tZ0 = Math.max(tZ0, ta);
    tZ1 = Math.min(tZ1, tb);
    if (tZ0 > tZ1) return null;
  }

  // XY circle interval [tXY0, tXY1]
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  let tXY0 = 0;
  let tXY1 = maxT;

  if (a < 1e-8) {
    if (fx * fx + fy * fy > radius * radius) return null;
  } else {
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sqrtDisc = Math.sqrt(disc);
    const inv2a = 0.5 / a;
    tXY0 = Math.max(0, (-b - sqrtDisc) * inv2a);
    tXY1 = Math.min(maxT, (-b + sqrtDisc) * inv2a);
    if (tXY0 > tXY1) return null;
  }

  const tEnter = Math.max(tZ0, tXY0);
  const tExit = Math.min(tZ1, tXY1);
  if (tEnter > tExit || tEnter < 0 || tEnter > maxT) return null;
  return tEnter;
}

export function traceSegmentZombieHit(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  zombies: readonly Zombie[],
  canHeadshot: boolean,
  maxT = 1
): ZombieHitResult | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;

  let best: ZombieHitResult | null = null;
  let bestT = maxT;

  for (const z of zombies) {
    if (z.state === 'dying') continue;
    const isBloater = z.archetype === 'bloater';

    if (canHeadshot) {
      // Exact 3D model proportions matching threeModels.ts actor rig
      const headBottom = isBloater ? 0.76 : 0.70;
      const headTop = isBloater ? 1.18 : 1.08;
      const headRadius = isBloater ? 0.29 : 0.25;
      const bodyRadius = isBloater ? 0.52 : 0.39;

      const tHead = intersectSegmentCylinder(
        x0, y0, z0, dx, dy, dz,
        z.x, z.y, headRadius, headBottom, headTop, bestT
      );
      const tBody = intersectSegmentCylinder(
        x0, y0, z0, dx, dy, dz,
        z.x, z.y, bodyRadius, 0, headBottom, bestT
      );

      if (tHead !== null && (tBody === null || tHead <= tBody)) {
        bestT = tHead;
        best = {
          zombie: z,
          t: tHead,
          hx: x0 + dx * tHead,
          hy: y0 + dy * tHead,
          hz: z0 + dz * tHead,
          isHeadshot: true,
        };
      } else if (tBody !== null) {
        bestT = tBody;
        best = {
          zombie: z,
          t: tBody,
          hx: x0 + dx * tBody,
          hy: y0 + dy * tBody,
          hz: z0 + dz * tBody,
          isHeadshot: false,
        };
      }
    } else {
      const hitRadius = isBloater ? 0.55 : 0.42;
      const tBody = intersectSegmentCylinder(
        x0, y0, z0, dx, dy, dz,
        z.x, z.y, hitRadius, 0, 1.38, bestT
      );
      if (tBody !== null) {
        bestT = tBody;
        best = {
          zombie: z,
          t: tBody,
          hx: x0 + dx * tBody,
          hy: y0 + dy * tBody,
          hz: z0 + dz * tBody,
          isHeadshot: false,
        };
      }
    }
  }

  return best;
}

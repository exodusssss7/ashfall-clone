import { CHUNK_SIZE, MAP_SIZE, angleDiff, clamp, dist, readCellFromSource } from './isometric';
import type { CellSource } from './isometric';
import { STRUCTURES } from './recipes';
import type {
  ConsumableItemId,
  DoorEntity,
  DoorStatus,
  FishingState,
  Inventory,
  ItemId,
  LootContainer,
  PlayerState,
  PropKind,
  StructureKind,
  TileCell,
  TileKind,
  Vehicle,
  WorldChunk,
  WorldStore,
  WorldStructure,
} from './types';

export const VEHICLE_REPAIR_SCRAP_COST = 2;

export function createInitialInventory(): Inventory {
  return {
    wood: 6,
    scrap: 4,
    cloth: 3,
    fuel: 1,
    food: 2,
    water: 2,
    bandage: 2,
    ammo_9mm: 16,
    ammo_shell: 6,
    molotov: 1,
    raw_fish: 0,
    cooked_fish: 0,
    fish_stew: 0,
    hot_rations: 0,
  };
}

export function createInitialPlayer(spawnX = 28.5, spawnY = 28.5): PlayerState {
  return {
    x: spawnX,
    y: spawnY,
    vx: 0,
    vy: 0,
    facingAngle: Math.PI * 0.25,
    hp: 100,
    maxHp: 100,
    hunger: 88,
    thirst: 86,
    bleeding: false,
    infected: false,
    equippedWeapon: 'crowbar',
    pistolMag: 8,
    pistolMagSize: 8,
    shotgunMag: 4,
    shotgunMagSize: 4,
    reloadingTimer: 0,
    reloadingWeapon: null,
    attackCooldown: 0,
    meleeSwingTimer: 0,
    dodgeTimer: 0,
    dodgeCooldown: 0,
    dodgeDirX: 0,
    dodgeDirY: 0,
    flashlightOn: true,
    battery: 100,
    walkCycle: 0,
    stepAccumulator: 0,
    hitFlash: 0,
    invulnTimer: 0,
    scaleX: 1,
    scaleY: 1,
    buildMode: null,
  };
}

export function createIdleFishingState(): FishingState {
  return {
    phase: 'idle',
    pierGX: 0,
    pierGY: 0,
    bobberX: 0,
    bobberY: 0,
    timer: 0,
    biteDuration: 1.05,
    biteElapsed: 0,
    ripplePhase: 0,
  };
}

/**
 * Deterministic PRNG (Mulberry32) so chunks and unit tests are reproducible.
 */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCoords(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export interface ChunkSpawnResult {
  chunk: WorldChunk;
  containers: LootContainer[];
  structures: WorldStructure[];
  vehicles: Vehicle[];
  doors: DoorEntity[];
}

function applyDoorCellState(cell: TileCell, status: DoorStatus): void {
  cell.prop = 'door';
  if (status === 'open') {
    cell.solid = false;
    cell.blocksSight = false;
  } else {
    cell.solid = true;
    cell.blocksSight = true;
  }
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

function isOriginTownCoord(gx: number, gy: number): boolean {
  return gx >= 0 && gx < MAP_SIZE && gy >= 0 && gy < MAP_SIZE;
}

function mod56(v: number): number {
  return ((v % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;
}

function createBaseCell(seed: number, gx: number, gy: number): TileCell {
  const h = hashCoords(seed, gx, gy);
  const r = (h % 1000) / 1000;
  const mx = mod56(gx);
  const my = mod56(gy);

  const cell: TileCell = {
    gx,
    gy,
    tile: r < 0.16 ? 'dirt' : 'grass',
    prop: 'none',
    solid: false,
    blocksSight: false,
    variant: h % 4,
    explored: false,
  };

  // Infinite repeating 56-tile county highway avenues + sidewalks + crosswalks
  const onHwyX = mx >= 25 && mx <= 31;
  const onHwyY = my >= 25 && my <= 31;
  if (onHwyX || onHwyY) {
    const isSidewalk =
      (onHwyX && !onHwyY && (mx === 25 || mx === 31)) ||
      (onHwyY && !onHwyX && (my === 25 || my === 31)) ||
      (onHwyX && onHwyY && (mx === 25 || mx === 31) && (my === 25 || my === 31));
    cell.tile = isSidewalk ? 'sidewalk' : 'road';
    if (!isSidewalk) {
      if (onHwyY && !onHwyX) {
        cell.variant = my === 28 && Math.abs(gx) % 2 === 0 ? 0 : 1 + (Math.abs(gx + gy) % 3);
      } else {
        cell.variant = mx === 28 && Math.abs(gy) % 2 === 0 ? 0 : 1 + (Math.abs(gx + gy) % 3);
      }
    }
  }

  // Zebra crosswalk strips bordering highway intersections
  if (
    ((mx === 24 || mx === 32) && my >= 26 && my <= 30) ||
    ((my === 24 || my === 32) && mx >= 26 && mx <= 30)
  ) {
    cell.tile = 'crosswalk';
  }

  return cell;
}

interface RoomZoneSpec {
  x0: number;
  y0: number;
  w: number;
  h: number;
  floorType: TileKind;
  rug?: { x0: number; y0: number; w: number; h: number };
}

interface PartitionSpec {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface BuildingDoorSpec {
  gx: number;
  gy: number;
  orientation: 'ns' | 'ew';
  status: DoorStatus;
}

interface BuildingPropSpec {
  gx: number;
  gy: number;
  prop: PropKind;
  lootKind?: LootContainer['kind'];
  lootItems?: Partial<Inventory>;
}

interface BuildingSpec {
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

function applyBuildingToSetter(
  setCellProp: (
    gx: number,
    gy: number,
    fn: (cell: TileCell) => void
  ) => void,
  b: BuildingSpec,
  doors: DoorEntity[],
  containers: LootContainer[],
  doorRegistry?: Set<string>
): void {
  const midX = b.x0 + Math.floor(b.w / 2);
  const midY = b.y0 + Math.floor(b.h / 2);

  // Optional exterior wooden porch outside entrance
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

  // Base footprint & exterior perimeter walls
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

  // Paint room-specific floor tiles & woven rugs inside interior bounds
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

  // Interior partition walls separating rooms
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

  // Open interior archways connecting adjoining rooms
  if (b.archways) {
    for (const arch of b.archways) {
      setCellProp(arch.gx, arch.gy, (cell) => {
        cell.prop = 'none';
        cell.solid = false;
        cell.blocksSight = false;
      });
    }
  }

  // Exterior & interior swingable doors
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

  // Interior furniture & loot containers
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

export interface GeneratedWorld {
  grid: TileCell[][];
  worldStore: WorldStore;
  containers: LootContainer[];
  structures: WorldStructure[];
  vehicles: Vehicle[];
  doors: DoorEntity[];
  spawnX: number;
  spawnY: number;
}

/**
 * Populates a 16x16 world chunk deterministically for infinite exploration.
 */
export function generateChunk(
  store: WorldStore,
  cx: number,
  cy: number,
  nextVehicleIdRef: { nextId: number }
): ChunkSpawnResult {
  const key = chunkKey(cx, cy);
  const existing = store.chunks.get(key);
  if (existing) {
    return { chunk: existing, containers: [], structures: [], vehicles: [], doors: [] };
  }

  const cells: TileCell[][] = [];
  const startGX = cx * CHUNK_SIZE;
  const startGY = cy * CHUNK_SIZE;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const row: TileCell[] = [];
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      row.push(createBaseCell(store.seed, startGX + lx, startGY + ly));
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

  // Origin chunks (0..3, 0..3) are populated cleanly by seedOriginTown() on world creation.
  if (cx >= 0 && cx <= 3 && cy >= 0 && cy <= 3) {
    return { chunk, containers, structures, vehicles, doors };
  }

  const rng = createRng(hashCoords(store.seed + 719, cx, cy));
  const setLocal = (gx: number, gy: number, fn: (c: TileCell) => void) => {
    const lx = gx - startGX;
    const ly = gy - startGY;
    if (lx >= 0 && lx < CHUNK_SIZE && ly >= 0 && ly < CHUNK_SIZE) {
      fn(cells[ly][lx]);
    }
  };

  // Detect if chunk contains a major highway corridor (mod56 in 24..32)
  let hasRoadInside = false;
  for (let ly = 2; ly < CHUNK_SIZE - 2; ly++) {
    for (let lx = 2; lx < CHUNK_SIZE - 2; lx++) {
      const mx = mod56(startGX + lx);
      const my = mod56(startGY + ly);
      if ((mx >= 24 && mx <= 32) || (my >= 24 && my <= 32)) {
        hasRoadInside = true;
      }
    }
  }

  const biomeRoll = rng();

  if (!hasRoadInside && biomeRoll < 0.30) {
    // Lakeside Chunk with Wooden Fishing Pier!
    const lakeCX = startGX + 8 + Math.floor((rng() - 0.5) * 2);
    const lakeCY = startGY + 7 + Math.floor((rng() - 0.5) * 2);
    const rx = 4.6 + rng() * 1.4;
    const ry = 4.2 + rng() * 1.4;

    for (let ly = 1; ly < CHUNK_SIZE - 1; ly++) {
      for (let lx = 1; lx < CHUNK_SIZE - 1; lx++) {
        const gx = startGX + lx;
        const gy = startGY + ly;
        const dNorm = ((gx - lakeCX) / rx) ** 2 + ((gy - lakeCY) / ry) ** 2;
        if (dNorm <= 1.0) {
          cells[ly][lx].tile = 'water';
          cells[ly][lx].solid = true;
          cells[ly][lx].blocksSight = false;
        } else if (dNorm <= 1.38) {
          cells[ly][lx].tile = 'dirt';
        }
      }
    }

    // Wooden Pier stretching from southern bank into lake
    const pierX = Math.round(lakeCX);
    const shoreY = Math.min(startGY + CHUNK_SIZE - 2, Math.round(lakeCY + ry) + 1);
    for (let py = Math.round(lakeCY + 1); py <= shoreY; py++) {
      setLocal(pierX, py, (cell) => {
        cell.tile = 'pier';
        cell.prop = 'none';
        cell.solid = false;
        cell.blocksSight = false;
      });
    }
    setLocal(pierX, shoreY, (cell) => {
      if (cell.tile === 'pier') {
        cell.prop = 'fishing_post';
        cell.solid = true;
        cell.blocksSight = false;
      }
    });
    // Small tackle box on shore beside pier
    setLocal(pierX + 1, shoreY, (cell) => {
      if (!cell.solid && cell.tile !== 'water') {
        cell.prop = 'crate_wood';
        cell.solid = true;
        containers.push({
          id: `c_${pierX + 1}_${shoreY}`,
          gx: pierX + 1,
          gy: shoreY,
          kind: 'crate_wood',
          items: { wood: 2, water: 1, food: 1, raw_fish: 1 },
          searched: false,
          searchProgress: 0,
          openAnim: 0,
        });
      }
    });
  } else if (!hasRoadInside && biomeRoll < 0.68) {
    // Procedural Multi-Room Houses, Diners, Clinics & Ranger Cabins
    const bx = startGX + 2;
    const by = startGY + 3;
    const variant = Math.floor(rng() * 4);
    const spec: BuildingSpec =
      variant === 0
        ? {
            // 3-Room Suburban House (Living Room, Kitchen, Bedroom)
            x0: bx,
            y0: by,
            w: 12,
            h: 10,
            wallType: 'wall_wood',
            floorType: 'floor',
            porch: { x0: bx + 2, y0: by + 10, w: 3, h: 1 },
            doors: [
              { gx: bx + 3, gy: by + 9, orientation: 'ew', status: 'closed' },
              { gx: bx + 6, gy: by + 3, orientation: 'ns', status: 'open' },
              { gx: bx + 8, gy: by + 5, orientation: 'ew', status: 'closed' },
            ],
            partitions: [
              { x0: bx + 6, y0: by + 1, x1: bx + 6, y1: by + 8 },
              { x0: bx + 6, y0: by + 5, x1: bx + 10, y1: by + 5 },
            ],
            rooms: [
              { x0: bx + 1, y0: by + 1, w: 5, h: 8, floorType: 'floor', rug: { x0: bx + 2, y0: by + 3, w: 3, h: 3 } },
              { x0: bx + 7, y0: by + 1, w: 4, h: 4, floorType: 'tile_diner' },
              { x0: bx + 7, y0: by + 6, w: 4, h: 3, floorType: 'floor', rug: { x0: bx + 8, y0: by + 7, w: 2, h: 1 } },
            ],
            props: [
              { gx: bx + 1, gy: by + 2, prop: 'couch' },
              { gx: bx + 5, gy: by + 2, prop: 'tv_stand' },
              { gx: bx + 1, gy: by + 1, prop: 'bookshelf' },
              { gx: bx + 1, gy: by + 8, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { wood: 3, scrap: 2, cloth: 1 } },
              { gx: bx + 10, gy: by + 1, prop: 'stove' },
              { gx: bx + 7, gy: by + 1, prop: 'fridge', lootKind: 'fridge', lootItems: { food: 2, water: 2, raw_fish: 1 } },
              { gx: bx + 7, gy: by + 8, prop: 'bed' },
              { gx: bx + 10, gy: by + 8, prop: 'desk' },
            ],
          }
        : variant === 1
          ? {
              // 3-Room Rural Clinic & Pharmacy
              x0: bx,
              y0: by,
              w: 12,
              h: 10,
              wallType: 'wall_brick',
              floorType: 'tile_clinic',
              porch: { x0: bx + 4, y0: by - 1, w: 3, h: 1 },
              doors: [
                { gx: bx + 5, gy: by, orientation: 'ew', status: 'locked' },
                { gx: bx + 6, gy: by + 4, orientation: 'ew', status: 'closed' },
                { gx: bx + 6, gy: by + 6, orientation: 'ns', status: 'closed' },
              ],
              partitions: [
                { x0: bx + 1, y0: by + 4, x1: bx + 10, y1: by + 4 },
                { x0: bx + 6, y0: by + 4, x1: bx + 6, y1: by + 8 },
              ],
              rooms: [
                { x0: bx + 1, y0: by + 1, w: 10, h: 3, floorType: 'tile_clinic' },
                { x0: bx + 1, y0: by + 5, w: 5, h: 4, floorType: 'floor_bath' },
                { x0: bx + 7, y0: by + 5, w: 4, h: 4, floorType: 'floor', rug: { x0: bx + 8, y0: by + 6, w: 2, h: 2 } },
              ],
              props: [
                { gx: bx + 1, gy: by + 2, prop: 'counter' },
                { gx: bx + 9, gy: by + 2, prop: 'bench' },
                { gx: bx + 10, gy: by + 1, prop: 'med_cabinet', lootKind: 'med_cabinet', lootItems: { bandage: 2, cloth: 3, water: 1 } },
                { gx: bx + 1, gy: by + 8, prop: 'sink_toilet' },
                { gx: bx + 2, gy: by + 5, prop: 'med_cabinet', lootKind: 'med_cabinet', lootItems: { bandage: 1, water: 2 } },
                { gx: bx + 7, gy: by + 8, prop: 'bed' },
                { gx: bx + 10, gy: by + 5, prop: 'desk' },
              ],
            }
          : variant === 2
            ? {
                // 2-Room Timber Cabin & Workshop
                x0: bx + 1,
                y0: by,
                w: 10,
                h: 9,
                wallType: 'wall_wood',
                floorType: 'floor',
                porch: { x0: bx + 11, y0: by + 3, w: 1, h: 3 },
                doors: [
                  { gx: bx + 10, gy: by + 4, orientation: 'ns', status: 'closed' },
                  { gx: bx + 5, gy: by + 4, orientation: 'ns', status: 'open' },
                ],
                partitions: [{ x0: bx + 5, y0: by + 1, x1: bx + 5, y1: by + 7 }],
                rooms: [
                  { x0: bx + 2, y0: by + 1, w: 3, h: 7, floorType: 'floor', rug: { x0: bx + 2, y0: by + 3, w: 2, h: 3 } },
                  { x0: bx + 6, y0: by + 1, w: 4, h: 7, floorType: 'floor' },
                ],
                props: [
                  { gx: bx + 2, gy: by + 1, prop: 'bed' },
                  { gx: bx + 2, gy: by + 7, prop: 'bookshelf' },
                  { gx: bx + 4, gy: by + 1, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { wood: 4, scrap: 3, fuel: 1 } },
                  { gx: bx + 9, gy: by + 1, prop: 'stove' },
                  { gx: bx + 7, gy: by + 1, prop: 'table' },
                  { gx: bx + 6, gy: by + 7, prop: 'couch' },
                ],
              }
            : {
                // 3-Room Roadside Outpost & Armory
                x0: bx,
                y0: by,
                w: 11,
                h: 9,
                wallType: 'wall_brick',
                floorType: 'tile_clinic',
                porch: { x0: bx - 1, y0: by + 3, w: 1, h: 3 },
                doors: [
                  { gx: bx, gy: by + 4, orientation: 'ns', status: 'locked' },
                  { gx: bx + 5, gy: by + 3, orientation: 'ns', status: 'locked' },
                  { gx: bx + 7, gy: by + 5, orientation: 'ew', status: 'closed' },
                ],
                partitions: [
                  { x0: bx + 5, y0: by + 1, x1: bx + 5, y1: by + 7 },
                  { x0: bx + 5, y0: by + 5, x1: bx + 9, y1: by + 5 },
                ],
                rooms: [
                  { x0: bx + 1, y0: by + 1, w: 4, h: 7, floorType: 'tile_clinic' },
                  { x0: bx + 6, y0: by + 1, w: 4, h: 4, floorType: 'tile_diner' },
                  { x0: bx + 6, y0: by + 6, w: 4, h: 2, floorType: 'floor' },
                ],
                props: [
                  { gx: bx + 1, gy: by + 1, prop: 'desk' },
                  { gx: bx + 3, gy: by + 7, prop: 'counter' },
                  { gx: bx + 9, gy: by + 1, prop: 'crate_military', lootKind: 'crate_military', lootItems: { ammo_9mm: 8, ammo_shell: 3, scrap: 3 } },
                  { gx: bx + 6, gy: by + 7, prop: 'bed' },
                  { gx: bx + 9, gy: by + 7, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { food: 1, water: 1, cloth: 2 } },
                ],
              };

    applyBuildingToSetter(setLocal, spec, doors, containers);
  }

  // Spawn highway vehicles or roadblock props on highway chunks
  if (hasRoadInside) {
    for (let ly = 2; ly < CHUNK_SIZE - 2; ly++) {
      for (let lx = 2; lx < CHUNK_SIZE - 2; lx++) {
        const cell = cells[ly][lx];
        const gx = startGX + lx;
        const gy = startGY + ly;
        const mx = mod56(gx);
        const my = mod56(gy);
        if (cell.tile === 'sidewalk' && (mx === 25 || mx === 31) && Math.abs(gy) % 14 === 0 && cell.prop === 'none') {
          cell.prop = 'streetlamp';
          cell.solid = true;
        }
        if (cell.tile === 'road' && (mx === 27 || mx === 29) && (my === 10 || my === 44) && Math.abs(gx) % 16 === 6) {
          if (rng() < 0.45) {
            const isPolice = rng() < 0.35;
            vehicles.push({
              id: nextVehicleIdRef.nextId++,
              kind: isPolice ? 'police' : 'sedan',
              x: gx + 0.5,
              y: gy + 0.5,
              angle: mx === 27 ? Math.PI * 0.5 : -Math.PI * 0.5,
              speed: 0,
              vx: 0,
              vy: 0,
              hp: isPolice ? 280 : 220,
              maxHp: isPolice ? 280 : 220,
              fuel: 45 + Math.floor(rng() * 45),
              headlightsOn: false,
              sirenOn: false,
              hitFlash: 0,
              drifting: false,
              boosting: false,
              trunkItems: isPolice ? { ammo_9mm: 6, scrap: 2 } : { fuel: 1, scrap: 3, food: 1 },
              trunkSearched: false,
            });
          }
        }
      }
    }
  }

  // Wilderness trees, burn barrel camps, & wild salvage crates
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const cell = cells[ly][lx];
      if ((cell.tile === 'grass' || cell.tile === 'dirt') && cell.prop === 'none') {
        const r = rng();
        if (r < 0.085) {
          cell.prop = rng() < 0.72 ? 'tree_pine' : 'tree_dead';
          cell.solid = true;
          cell.blocksSight = true;
        } else if (r < 0.092) {
          cell.prop = 'crate_wood';
          cell.solid = true;
          containers.push({
            id: `wild_crate_${cell.gx}_${cell.gy}`,
            gx: cell.gx,
            gy: cell.gy,
            kind: 'crate_wood',
            items: {
              wood: 2 + Math.floor(rng() * 3),
              scrap: 1 + Math.floor(rng() * 2),
              water: rng() < 0.45 ? 1 : 0,
            },
            searched: false,
            searchProgress: 0,
            openAnim: 0,
          });
        } else if (r < 0.095) {
          cell.prop = 'barrel_burn';
          cell.solid = true;
        }
      }
    }
  }

  return { chunk, containers, structures, vehicles, doors };
}

export function getWorldCell(store: WorldStore, gx: number, gy: number): TileCell {
  const cx = Math.floor(gx / CHUNK_SIZE);
  const cy = Math.floor(gy / CHUNK_SIZE);
  let chunk = store.chunks.get(chunkKey(cx, cy));
  if (!chunk) {
    chunk = generateChunk(store, cx, cy, { nextId: 10000 }).chunk;
  }
  const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return chunk.cells[ly][lx];
}

export function generateWorld(seed = 1994): GeneratedWorld {
  const rng = createRng(seed);
  const grid: TileCell[][] = [];
  const containers: LootContainer[] = [];
  const structures: WorldStructure[] = [];
  const vehicles: Vehicle[] = [];
  const doors: DoorEntity[] = [];

  const worldStore: WorldStore = {
    seed,
    chunks: new Map(),
    populatedChunks: new Set(),
  };

  // Pre-build 4x4 origin chunk grid (0..63, 0..63) so starter town + outer edge transition seamlessly
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      const cells: TileCell[][] = [];
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const row: TileCell[] = [];
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const gx = cx * CHUNK_SIZE + lx;
          const gy = cy * CHUNK_SIZE + ly;
          row.push(createBaseCell(seed, gx, gy));
        }
        cells.push(row);
      }
      const key = chunkKey(cx, cy);
      worldStore.chunks.set(key, { cx, cy, key, cells });
      worldStore.populatedChunks.add(key);
    }
  }

  // Populate legacy 56x56 view backed by the exact same TileCell instances in worldStore!
  for (let gy = 0; gy < MAP_SIZE; gy++) {
    const row: TileCell[] = [];
    for (let gx = 0; gx < MAP_SIZE; gx++) {
      row.push(getWorldCell(worldStore, gx, gy));
    }
    grid.push(row);
  }

  const setCell = (gx: number, gy: number, fn: (cell: TileCell) => void) => {
    if (!isOriginTownCoord(gx, gy)) return;
    fn(getWorldCell(worldStore, gx, gy));
  };

  // Curated multi-room post-apocalyptic houses, clinics, diners & outposts with interior rooms & furnishings
  const buildings: BuildingSpec[] = [
    // 1. NW Corner: 3-Room Medical Clinic, Exam Lab & Doctor's Residence (x=14..22, y=7..22)
    {
      x0: 14,
      y0: 7,
      w: 9,
      h: 16,
      wallType: 'wall_brick',
      floorType: 'tile_clinic',
      porch: { x0: 17, y0: 23, w: 3, h: 1 },
      doors: [
        { gx: 18, gy: 22, orientation: 'ew', status: 'locked' },
        { gx: 19, gy: 15, orientation: 'ew', status: 'open' },
        { gx: 18, gy: 11, orientation: 'ns', status: 'closed' },
      ],
      partitions: [
        { x0: 14, y0: 15, x1: 22, y1: 15 },
        { x0: 18, y0: 7, x1: 18, y1: 15 },
      ],
      rooms: [
        { x0: 15, y0: 16, w: 7, h: 6, floorType: 'tile_clinic' },
        { x0: 15, y0: 8, w: 3, h: 7, floorType: 'floor', rug: { x0: 16, y0: 10, w: 1, h: 3 } },
        { x0: 19, y0: 8, w: 3, h: 7, floorType: 'floor_bath' },
      ],
      props: [
        // Front Waiting Room & Pharmacy
        { gx: 16, gy: 16, prop: 'med_cabinet', lootKind: 'med_cabinet', lootItems: { bandage: 3, cloth: 3, water: 2 } },
        { gx: 20, gy: 17, prop: 'counter' },
        { gx: 21, gy: 16, prop: 'desk' },
        { gx: 15, gy: 20, prop: 'bench' },
        { gx: 21, gy: 21, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { cloth: 2, scrap: 2, water: 1 } },
        // NW Doctor's Bedroom
        { gx: 15, gy: 8, prop: 'bed' },
        { gx: 17, gy: 8, prop: 'bookshelf' },
        { gx: 15, gy: 13, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { food: 1, cloth: 2, ammo_9mm: 4 } },
        // NE Exam & Bathroom
        { gx: 21, gy: 8, prop: 'sink_toilet' },
        { gx: 21, gy: 10, prop: 'med_cabinet', lootKind: 'med_cabinet', lootItems: { bandage: 2, water: 2 } },
        { gx: 19, gy: 8, prop: 'desk' },
      ],
    },
    // 2. NE Corner: 3-Room Roadside Diner, Commercial Kitchen & Manager's Quarters (x=34..49, y=14..22)
    {
      x0: 34,
      y0: 14,
      w: 16,
      h: 9,
      wallType: 'wall_wood',
      floorType: 'tile_diner',
      porch: { x0: 38, y0: 23, w: 3, h: 1 },
      doors: [
        { gx: 39, gy: 22, orientation: 'ew', status: 'closed' },
        { gx: 49, gy: 20, orientation: 'ns', status: 'closed' },
        { gx: 46, gy: 18, orientation: 'ew', status: 'closed' },
      ],
      archways: [{ gx: 42, gy: 18 }],
      partitions: [
        { x0: 42, y0: 14, x1: 42, y1: 22 },
        { x0: 42, y0: 18, x1: 49, y1: 18 },
      ],
      rooms: [
        { x0: 35, y0: 15, w: 7, h: 7, floorType: 'tile_diner' },
        { x0: 43, y0: 15, w: 6, h: 3, floorType: 'tile_diner' },
        { x0: 43, y0: 19, w: 6, h: 3, floorType: 'floor', rug: { x0: 45, y0: 20, w: 2, h: 1 } },
      ],
      props: [
        // Main Dining Hall
        { gx: 35, gy: 15, prop: 'tv_stand' },
        { gx: 35, gy: 16, prop: 'counter' },
        { gx: 37, gy: 15, prop: 'counter' },
        { gx: 36, gy: 19, prop: 'table' },
        { gx: 35, gy: 19, prop: 'bench' },
        { gx: 40, gy: 16, prop: 'table' },
        { gx: 40, gy: 19, prop: 'bench' },
        // Kitchen
        { gx: 47, gy: 15, prop: 'stove' },
        { gx: 43, gy: 15, prop: 'fridge', lootKind: 'fridge', lootItems: { food: 3, water: 3, raw_fish: 1 } },
        { gx: 45, gy: 15, prop: 'counter' },
        // Manager's Backroom (bed headboard flush against West partition x=42)
        { gx: 43, gy: 21, prop: 'bed' },
        { gx: 48, gy: 21, prop: 'desk' },
        { gx: 48, gy: 19, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { wood: 3, scrap: 2, food: 1 } },
      ],
    },
    // 3. SW Corner: 4-Room Suburban Ranch House (Living Room, Kitchen, Master Bedroom, Bathroom)
    {
      x0: 7,
      y0: 34,
      w: 16,
      h: 12,
      wallType: 'wall_wood',
      floorType: 'floor',
      porch: { x0: 17, y0: 33, w: 3, h: 1 },
      doors: [
        { gx: 18, gy: 34, orientation: 'ew', status: 'closed' },
        { gx: 10, gy: 45, orientation: 'ew', status: 'closed' },
        { gx: 18, gy: 40, orientation: 'ew', status: 'closed' },
        { gx: 15, gy: 42, orientation: 'ns', status: 'closed' },
      ],
      archways: [{ gx: 15, gy: 37 }],
      partitions: [
        { x0: 15, y0: 34, x1: 15, y1: 45 },
        { x0: 7, y0: 40, x1: 22, y1: 40 },
      ],
      rooms: [
        { x0: 16, y0: 35, w: 6, h: 5, floorType: 'floor', rug: { x0: 17, y0: 36, w: 3, h: 3 } },
        { x0: 8, y0: 35, w: 7, h: 5, floorType: 'tile_diner' },
        { x0: 16, y0: 41, w: 6, h: 4, floorType: 'floor', rug: { x0: 18, y0: 42, w: 2, h: 2 } },
        { x0: 8, y0: 41, w: 7, h: 4, floorType: 'floor_bath' },
      ],
      props: [
        // Living Room
        { gx: 17, gy: 38, prop: 'couch' },
        { gx: 21, gy: 37, prop: 'tv_stand' },
        { gx: 21, gy: 35, prop: 'bookshelf' },
        { gx: 16, gy: 35, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { wood: 6, scrap: 5, fuel: 1 } },
        // Kitchen & Dining
        { gx: 8, gy: 35, prop: 'stove' },
        { gx: 10, gy: 35, prop: 'fridge', lootKind: 'fridge', lootItems: { food: 2, water: 2 } },
        { gx: 12, gy: 35, prop: 'counter' },
        { gx: 9, gy: 38, prop: 'table' },
        { gx: 11, gy: 38, prop: 'bench' },
        // Master Bedroom (bed headboard against West partition x=15, clear access from bedroom rug)
        { gx: 16, gy: 44, prop: 'bed' },
        { gx: 21, gy: 44, prop: 'desk' },
        { gx: 21, gy: 41, prop: 'bookshelf' },
        { gx: 17, gy: 41, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { cloth: 3, bandage: 1, ammo_9mm: 4 } },
        // Bathroom & Utility
        { gx: 8, gy: 44, prop: 'sink_toilet' },
        { gx: 8, gy: 41, prop: 'med_cabinet', lootKind: 'med_cabinet', lootItems: { bandage: 2, water: 1 } },
        { gx: 13, gy: 44, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { scrap: 3, cloth: 2 } },
      ],
    },
    // 4. SE Corner: 3-Room Police Outpost, Locked Armory & Barracks
    {
      x0: 34,
      y0: 34,
      w: 16,
      h: 12,
      wallType: 'wall_brick',
      floorType: 'tile_clinic',
      porch: { x0: 37, y0: 33, w: 3, h: 1 },
      doors: [
        { gx: 38, gy: 34, orientation: 'ew', status: 'locked' },
        { gx: 42, gy: 37, orientation: 'ns', status: 'locked' },
        { gx: 38, gy: 40, orientation: 'ew', status: 'closed' },
        { gx: 49, gy: 42, orientation: 'ns', status: 'closed' },
      ],
      partitions: [
        { x0: 42, y0: 34, x1: 42, y1: 40 },
        { x0: 34, y0: 40, x1: 49, y1: 40 },
      ],
      rooms: [
        { x0: 35, y0: 35, w: 7, h: 5, floorType: 'tile_clinic' },
        { x0: 43, y0: 35, w: 6, h: 5, floorType: 'tile_clinic' },
        { x0: 35, y0: 41, w: 14, h: 4, floorType: 'floor', rug: { x0: 41, y0: 42, w: 3, h: 2 } },
      ],
      props: [
        // Dispatch Lobby
        { gx: 35, gy: 35, prop: 'desk' },
        { gx: 40, gy: 35, prop: 'desk' },
        { gx: 35, gy: 38, prop: 'counter' },
        { gx: 40, gy: 38, prop: 'bench' },
        // Locked Armory
        { gx: 47, gy: 35, prop: 'crate_military', lootKind: 'crate_military', lootItems: { ammo_9mm: 12, ammo_shell: 5, bandage: 1, scrap: 3 } },
        { gx: 44, gy: 35, prop: 'crate_military', lootKind: 'crate_military', lootItems: { ammo_9mm: 6, molotov: 1, scrap: 2 } },
        { gx: 48, gy: 38, prop: 'counter' },
        // Barracks & Mess (bunks neatly aligned along West brick wall x=34)
        { gx: 35, gy: 42, prop: 'bed' },
        { gx: 35, gy: 44, prop: 'bed' },
        { gx: 37, gy: 44, prop: 'bookshelf' },
        { gx: 43, gy: 43, prop: 'table' },
        { gx: 46, gy: 41, prop: 'stove' },
        { gx: 48, gy: 41, prop: 'fridge', lootKind: 'fridge', lootItems: { food: 2, water: 2 } },
      ],
    },
    // 5. West Ranger Cabin (2-Room Homestead: Living/Kitchen + Bedroom)
    {
      x0: 2,
      y0: 13,
      w: 11,
      h: 10,
      wallType: 'wall_wood',
      floorType: 'floor',
      porch: { x0: 13, y0: 17, w: 1, h: 3 },
      doors: [
        { gx: 12, gy: 18, orientation: 'ns', status: 'closed' },
        { gx: 7, gy: 18, orientation: 'ns', status: 'open' },
      ],
      partitions: [{ x0: 7, y0: 13, x1: 7, y1: 22 }],
      rooms: [
        { x0: 3, y0: 14, w: 4, h: 8, floorType: 'floor', rug: { x0: 4, y0: 16, w: 2, h: 3 } },
        { x0: 8, y0: 14, w: 4, h: 8, floorType: 'floor' },
      ],
      props: [
        { gx: 3, gy: 14, prop: 'bed' },
        { gx: 3, gy: 21, prop: 'bookshelf' },
        { gx: 5, gy: 14, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { wood: 5, food: 2, cloth: 2 } },
        { gx: 11, gy: 14, prop: 'stove' },
        { gx: 9, gy: 14, prop: 'table' },
        { gx: 8, gy: 21, prop: 'couch' },
        { gx: 11, gy: 21, prop: 'tv_stand' },
      ],
    },
    // 6. Far NW Farmhouse (2-Room Homestead with Study & Bedroom)
    {
      x0: 2,
      y0: 2,
      w: 11,
      h: 10,
      wallType: 'wall_wood',
      floorType: 'floor',
      porch: { x0: 6, y0: 12, w: 3, h: 1 },
      doors: [
        { gx: 7, gy: 11, orientation: 'ew', status: 'closed' },
        { gx: 7, gy: 6, orientation: 'ew', status: 'closed' },
      ],
      partitions: [{ x0: 2, y0: 6, x1: 12, y1: 6 }],
      rooms: [
        { x0: 3, y0: 7, w: 9, h: 4, floorType: 'floor', rug: { x0: 6, y0: 8, w: 3, h: 2 } },
        { x0: 3, y0: 3, w: 9, h: 3, floorType: 'tile_diner' },
      ],
      props: [
        { gx: 3, gy: 10, prop: 'bed' },
        { gx: 8, gy: 8, prop: 'couch' },
        { gx: 11, gy: 10, prop: 'tv_stand' },
        { gx: 3, gy: 7, prop: 'desk' },
        { gx: 11, gy: 7, prop: 'bookshelf' },
        { gx: 3, gy: 3, prop: 'stove' },
        { gx: 5, gy: 3, prop: 'fridge', lootKind: 'fridge', lootItems: { food: 3, water: 2, scrap: 3 } },
        { gx: 11, gy: 3, prop: 'crate_wood', lootKind: 'crate_wood', lootItems: { wood: 4, fuel: 1, cloth: 2 } },
      ],
    },
    // 7. South Apothecary & Living Quarters (2-Room Brick Townhouse)
    {
      x0: 12,
      y0: 47,
      w: 12,
      h: 8,
      wallType: 'wall_brick',
      floorType: 'tile_clinic',
      porch: { x0: 16, y0: 46, w: 3, h: 1 },
      doors: [
        { gx: 17, gy: 47, orientation: 'ew', status: 'closed' },
        { gx: 18, gy: 51, orientation: 'ns', status: 'closed' },
      ],
      partitions: [{ x0: 18, y0: 47, x1: 18, y1: 54 }],
      rooms: [
        { x0: 13, y0: 48, w: 5, h: 6, floorType: 'tile_clinic' },
        { x0: 19, y0: 48, w: 4, h: 6, floorType: 'floor', rug: { x0: 20, y0: 50, w: 2, h: 2 } },
      ],
      props: [
        { gx: 13, gy: 48, prop: 'med_cabinet', lootKind: 'med_cabinet', lootItems: { bandage: 2, ammo_shell: 4, water: 2 } },
        { gx: 13, gy: 53, prop: 'sink_toilet' },
        { gx: 15, gy: 48, prop: 'counter' },
        { gx: 19, gy: 48, prop: 'bed' },
        { gx: 22, gy: 53, prop: 'bookshelf' },
        { gx: 20, gy: 53, prop: 'couch' },
      ],
    },
    // 8. SE Checkpoint & Guard Bunkhouse (2-Room Outpost)
    {
      x0: 34,
      y0: 47,
      w: 15,
      h: 8,
      wallType: 'wall_brick',
      floorType: 'floor',
      porch: { x0: 40, y0: 46, w: 3, h: 1 },
      doors: [
        { gx: 41, gy: 47, orientation: 'ew', status: 'locked' },
        { gx: 41, gy: 51, orientation: 'ns', status: 'open' },
      ],
      partitions: [{ x0: 41, y0: 47, x1: 41, y1: 54 }],
      rooms: [
        { x0: 35, y0: 48, w: 6, h: 6, floorType: 'tile_clinic' },
        { x0: 42, y0: 48, w: 6, h: 6, floorType: 'floor', rug: { x0: 44, y0: 50, w: 2, h: 2 } },
      ],
      props: [
        { gx: 35, gy: 48, prop: 'crate_military', lootKind: 'crate_military', lootItems: { ammo_9mm: 8, molotov: 1, fuel: 2 } },
        { gx: 35, gy: 53, prop: 'desk' },
        { gx: 39, gy: 53, prop: 'counter' },
        { gx: 42, gy: 48, prop: 'bed' },
        { gx: 47, gy: 53, prop: 'stove' },
        { gx: 44, gy: 53, prop: 'table' },
      ],
    },
  ];

  const doorReg = new Set<string>();
  for (const b of buildings) {
    applyBuildingToSetter(setCell, b, doors, containers, doorReg);
  }

  // Guaranteed Scenic Crescent Lake & Wooden Fishing Pier just NE of Corner Diner (gx: 36..51, gy: 3..12)
  const lakeCenterX = 43.5;
  const lakeCenterY = 7.2;
  for (let gy = 2; gy <= 13; gy++) {
    for (let gx = 36; gx <= 52; gx++) {
      const dNorm = ((gx - lakeCenterX) / 6.2) ** 2 + ((gy - lakeCenterY) / 4.1) ** 2;
      setCell(gx, gy, (cell) => {
        if (dNorm <= 1.0) {
          cell.tile = 'water';
          cell.prop = 'none';
          cell.solid = true;
          cell.blocksSight = false;
        } else if (dNorm <= 1.38) {
          cell.tile = 'dirt';
        }
      });
    }
  }
  // Wooden pier jutting from south lakeshore into deep water at gx = 40, gy = 7..12
  for (let gy = 7; gy <= 12; gy++) {
    setCell(40, gy, (cell) => {
      cell.tile = 'pier';
      cell.prop = 'none';
      cell.solid = false;
      cell.blocksSight = false;
    });
  }
  setCell(40, 12, (cell) => {
    cell.prop = 'fishing_post';
    cell.solid = true;
    cell.blocksSight = false;
  });
  // Tackle supply crate beside the pier entrance
  setCell(42, 12, (cell) => {
    if (!cell.solid && cell.tile !== 'water') {
      cell.prop = 'crate_wood';
      cell.solid = true;
      containers.push({
        id: 'pier_tackle_crate',
        gx: 42,
        gy: 12,
        kind: 'crate_wood',
        items: { wood: 3, raw_fish: 1, water: 1 },
        searched: false,
        searchProgress: 0,
        openAnim: 0,
      });
    }
  });

  // Drivable vehicles parked along the avenues
  const vehicleSpots: Array<{
    id: number;
    x: number;
    y: number;
    angle: number;
    kind: 'sedan' | 'police';
    fuel: number;
    trunkItems: Partial<Inventory>;
  }> = [
    { id: 1, x: 23.0, y: 27.2, angle: 0, kind: 'police', fuel: 78, trunkItems: { ammo_9mm: 8, bandage: 1 } },
    { id: 2, x: 34.5, y: 29.8, angle: Math.PI, kind: 'sedan', fuel: 65, trunkItems: { fuel: 2, scrap: 3 } },
    { id: 3, x: 27.2, y: 19.5, angle: Math.PI * 0.5, kind: 'police', fuel: 85, trunkItems: { ammo_shell: 4, scrap: 2 } },
    { id: 4, x: 29.8, y: 37.5, angle: -Math.PI * 0.5, kind: 'sedan', fuel: 72, trunkItems: { cloth: 2, food: 1, fuel: 1 } },
    { id: 5, x: 11.5, y: 29.5, angle: 0, kind: 'sedan', fuel: 55, trunkItems: { scrap: 4, wood: 2 } },
    { id: 6, x: 42.5, y: 27.2, angle: Math.PI, kind: 'police', fuel: 90, trunkItems: { ammo_9mm: 10, water: 1 } },
  ];
  for (const v of vehicleSpots) {
    vehicles.push({
      id: v.id,
      kind: v.kind,
      x: v.x,
      y: v.y,
      angle: v.angle,
      speed: 0,
      vx: 0,
      vy: 0,
      hp: v.kind === 'police' ? 280 : 220,
      maxHp: v.kind === 'police' ? 280 : 220,
      fuel: v.fuel,
      headlightsOn: false,
      sirenOn: false,
      hitFlash: 0,
      drifting: false,
      boosting: false,
      trunkItems: v.trunkItems,
      trunkSearched: false,
    });
  }

  const spawnX = 28.5;
  const spawnY = 28.5;

  structures.push({
    id: 'starter_campfire',
    gx: 26,
    gy: 27,
    kind: 'campfire',
    hp: STRUCTURES.campfire.maxHp,
    maxHp: STRUCTURES.campfire.maxHp,
    cooldown: 0,
    hitFlash: 0,
  });

  setCell(30, 26, (cell) => {
    cell.prop = 'crate_wood';
    cell.solid = true;
  });
  containers.push({
    id: 'starter_crate',
    gx: 30,
    gy: 26,
    kind: 'crate_wood',
    items: { wood: 4, scrap: 3, food: 1, ammo_9mm: 6 },
    searched: false,
    searchProgress: 0,
    openAnim: 0,
  });

  // Crossroads streetlamps
  const lampSpots: Array<[number, number]> = [
    [25, 25],
    [31, 25],
    [25, 31],
    [31, 31],
    [13, 25],
    [43, 31],
    [25, 13],
    [31, 43],
  ];
  for (const [lx, ly] of lampSpots) {
    setCell(lx, ly, (cell) => {
      if (cell.prop === 'none') {
        cell.prop = 'streetlamp';
        cell.solid = true;
        cell.blocksSight = false;
      }
    });
  }

  // Urban survival scatter
  const urbanProps: Array<{ gx: number; gy: number; prop: TileCell['prop']; solid: boolean }> = [
    { gx: 23, gy: 16, prop: 'dumpster', solid: true },
    { gx: 50, gy: 17, prop: 'dumpster', solid: true },
    { gx: 13, gy: 37, prop: 'dumpster', solid: true },
    { gx: 33, gy: 38, prop: 'dumpster', solid: true },
    { gx: 25, gy: 22, prop: 'hydrant', solid: true },
    { gx: 31, gy: 35, prop: 'hydrant', solid: true },
    { gx: 25, gy: 34, prop: 'bench', solid: true },
    { gx: 31, gy: 22, prop: 'bench', solid: true },
    { gx: 15, gy: 26, prop: 'concrete_barrier', solid: true },
    { gx: 15, gy: 30, prop: 'barrel_burn', solid: true },
    { gx: 41, gy: 30, prop: 'concrete_barrier', solid: true },
    { gx: 41, gy: 26, prop: 'barrel_burn', solid: true },
    { gx: 26, gy: 15, prop: 'concrete_barrier', solid: true },
    { gx: 30, gy: 15, prop: 'barrel_burn', solid: true },
    { gx: 30, gy: 41, prop: 'concrete_barrier', solid: true },
    { gx: 26, gy: 41, prop: 'barrel_burn', solid: true },
  ];
  for (const up of urbanProps) {
    setCell(up.gx, up.gy, (cell) => {
      if (cell.prop === 'none') {
        cell.prop = up.prop;
        cell.solid = up.solid;
        cell.blocksSight = false;
      }
    });
  }

  // Scattered trees/crates on open origin grass (NO closed border wall so infinite exploration is open in all 4 directions!)
  for (let gy = 0; gy < 64; gy++) {
    for (let gx = 0; gx < 64; gx++) {
      const cell = getWorldCell(worldStore, gx, gy);
      if ((cell.tile === 'grass' || cell.tile === 'dirt') && cell.prop === 'none') {
        const dSpawn = dist(gx + 0.5, gy + 0.5, spawnX, spawnY);
        // Keep path around pier clear too
        const dPier = dist(gx + 0.5, gy + 0.5, 40.5, 12.5);
        if (dSpawn > 6.5 && dPier > 3.2) {
          const r = rng();
          if (r < 0.08) {
            cell.prop = rng() < 0.72 ? 'tree_pine' : 'tree_dead';
            cell.solid = true;
            cell.blocksSight = true;
          } else if (r < 0.089) {
            cell.prop = 'crate_wood';
            cell.solid = true;
            containers.push({
              id: `wild_crate_${gx}_${gy}`,
              gx,
              gy,
              kind: 'crate_wood',
              items: {
                wood: 2 + Math.floor(rng() * 3),
                scrap: 1 + Math.floor(rng() * 2),
                water: rng() < 0.5 ? 1 : 0,
              },
              searched: false,
              searchProgress: 0,
              openAnim: 0,
            });
          }
        }
      }
    }
  }

  return { grid, worldStore, containers, structures, vehicles, doors, spawnX, spawnY };
}

export function canAffordCost(inventory: Inventory, cost: Partial<Inventory>): boolean {
  for (const [key, amount] of Object.entries(cost)) {
    if (!amount) continue;
    if ((inventory[key as ItemId] ?? 0) < amount) {
      return false;
    }
  }
  return true;
}

export function spendCost(inventory: Inventory, cost: Partial<Inventory>): Inventory {
  const next = { ...inventory };
  for (const [key, amount] of Object.entries(cost)) {
    if (!amount) continue;
    const item = key as ItemId;
    next[item] = Math.max(0, (next[item] ?? 0) - amount);
  }
  return next;
}

export function pickBestFoodConsumable(inventory: Inventory): ConsumableItemId | null {
  if (inventory.fish_stew > 0) return 'fish_stew';
  if (inventory.hot_rations > 0) return 'hot_rations';
  if (inventory.cooked_fish > 0) return 'cooked_fish';
  if (inventory.food > 0) return 'food';
  if (inventory.raw_fish > 0) return 'raw_fish';
  return null;
}

export function useConsumableItem(
  player: PlayerState,
  inventory: Inventory,
  item: ConsumableItemId
): { player: PlayerState; inventory: Inventory; used: boolean; message: string } {
  if ((inventory[item] ?? 0) <= 0) {
    return { player, inventory, used: false, message: `Out of ${item.replace('_', ' ')}` };
  }

  const nextPlayer = { ...player };
  const nextInv = { ...inventory };

  if (item === 'food') {
    if (nextPlayer.hunger >= 99 && nextPlayer.hp >= nextPlayer.maxHp) {
      return { player, inventory, used: false, message: 'Already full' };
    }
    nextInv.food -= 1;
    nextPlayer.hunger = clamp(nextPlayer.hunger + 38, 0, 100);
    nextPlayer.hp = clamp(nextPlayer.hp + 8, 0, nextPlayer.maxHp);
    return { player: nextPlayer, inventory: nextInv, used: true, message: 'Ate Canned Rations (+38 Food)' };
  }

  if (item === 'cooked_fish') {
    if (nextPlayer.hunger >= 99 && nextPlayer.hp >= nextPlayer.maxHp) {
      return { player, inventory, used: false, message: 'Already full' };
    }
    nextInv.cooked_fish -= 1;
    nextPlayer.hunger = clamp(nextPlayer.hunger + 42, 0, 100);
    nextPlayer.hp = clamp(nextPlayer.hp + 14, 0, nextPlayer.maxHp);
    return { player: nextPlayer, inventory: nextInv, used: true, message: 'Ate Grilled Fish (+42 Food, +14 HP)' };
  }

  if (item === 'fish_stew') {
    if (nextPlayer.hunger >= 99 && nextPlayer.thirst >= 99 && nextPlayer.hp >= nextPlayer.maxHp) {
      return { player, inventory, used: false, message: 'Already restored' };
    }
    nextInv.fish_stew -= 1;
    nextPlayer.hunger = clamp(nextPlayer.hunger + 58, 0, 100);
    nextPlayer.thirst = clamp(nextPlayer.thirst + 40, 0, 100);
    nextPlayer.hp = clamp(nextPlayer.hp + 24, 0, nextPlayer.maxHp);
    return { player: nextPlayer, inventory: nextInv, used: true, message: 'Ate Fish Stew (+58 Food, +40 H2O, +24 HP)' };
  }

  if (item === 'hot_rations') {
    if (nextPlayer.hunger >= 99 && nextPlayer.hp >= nextPlayer.maxHp) {
      return { player, inventory, used: false, message: 'Already full' };
    }
    nextInv.hot_rations -= 1;
    nextPlayer.hunger = clamp(nextPlayer.hunger + 48, 0, 100);
    nextPlayer.hp = clamp(nextPlayer.hp + 12, 0, nextPlayer.maxHp);
    return { player: nextPlayer, inventory: nextInv, used: true, message: 'Ate Hot Rations (+48 Food, +12 HP)' };
  }

  if (item === 'raw_fish') {
    if (nextPlayer.hunger >= 99) {
      return { player, inventory, used: false, message: 'Already full' };
    }
    nextInv.raw_fish -= 1;
    nextPlayer.hunger = clamp(nextPlayer.hunger + 16, 0, 100);
    nextPlayer.thirst = clamp(nextPlayer.thirst - 5, 0, 100);
    return { player: nextPlayer, inventory: nextInv, used: true, message: 'Ate Raw Fish (+16 Food)' };
  }

  if (item === 'water') {
    if (nextPlayer.thirst >= 99) {
      return { player, inventory, used: false, message: 'Already hydrated' };
    }
    nextInv.water -= 1;
    nextPlayer.thirst = clamp(nextPlayer.thirst + 44, 0, 100);
    return { player: nextPlayer, inventory: nextInv, used: true, message: 'Drank Water (+44 Hydration)' };
  }

  if (item === 'bandage') {
    if (!nextPlayer.bleeding && nextPlayer.hp >= nextPlayer.maxHp) {
      return { player, inventory, used: false, message: 'Health is already full' };
    }
    nextInv.bandage -= 1;
    nextPlayer.bleeding = false;
    nextPlayer.hp = clamp(nextPlayer.hp + 35, 0, nextPlayer.maxHp);
    return { player: nextPlayer, inventory: nextInv, used: true, message: 'Applied Bandage (+35 HP, Bleed Stopped)' };
  }

  return { player, inventory, used: false, message: '' };
}

export function tickSurvivalNeeds(
  player: PlayerState,
  dt: number,
  isSprinting: boolean,
  nearCampfire: boolean
): PlayerState {
  const next = { ...player };

  next.hunger = clamp(next.hunger - dt * 0.24, 0, 100);
  next.thirst = clamp(next.thirst - dt * (isSprinting ? 0.52 : 0.30), 0, 100);

  if (next.bleeding) {
    next.hp = Math.max(0, next.hp - dt * 2.1);
  }
  if (next.hunger <= 0) {
    next.hp = Math.max(0, next.hp - dt * 1.4);
  }
  if (next.thirst <= 0) {
    next.hp = Math.max(0, next.hp - dt * 1.9);
  }

  if (nearCampfire && !next.bleeding && next.hunger > 60 && next.thirst > 60 && next.hp > 0) {
    next.hp = Math.min(next.maxHp, next.hp + dt * 1.4);
  }

  if (next.flashlightOn) {
    next.battery = clamp(next.battery - dt * 0.45, 0, 100);
    if (next.battery <= 0) {
      next.flashlightOn = false;
    }
  } else {
    next.battery = clamp(next.battery + dt * 1.8, 0, 100);
  }

  return next;
}

export function getDaylightInfo(timeMinutes: number): {
  darkness: number;
  phaseLabel: 'DAWN' | 'DAYLIGHT' | 'DUSK' | 'NIGHTFALL';
  formattedTime: string;
} {
  const mins = ((timeMinutes % 1440) + 1440) % 1440;
  const hh = Math.floor(mins / 60);
  const mm = Math.floor(mins % 60);
  const formattedTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

  if (mins >= 330 && mins < 450) {
    const t = (mins - 330) / 120;
    return { darkness: 0.78 * (1 - t) + 0.08 * t, phaseLabel: 'DAWN', formattedTime };
  }
  if (mins >= 450 && mins < 1080) {
    return { darkness: 0.08, phaseLabel: 'DAYLIGHT', formattedTime };
  }
  if (mins >= 1080 && mins < 1200) {
    const t = (mins - 1080) / 120;
    return { darkness: 0.08 * (1 - t) + 0.78 * t, phaseLabel: 'DUSK', formattedTime };
  }
  return { darkness: 0.78, phaseLabel: 'NIGHTFALL', formattedTime };
}

export function isTargetInMeleeArc(
  attackerX: number,
  attackerY: number,
  facingAngle: number,
  targetX: number,
  targetY: number,
  range: number,
  halfArcRad: number
): boolean {
  const d = dist(attackerX, attackerY, targetX, targetY);
  if (d > range) return false;
  if (d < 0.45) return true;
  const targetAngle = Math.atan2(targetY - attackerY, targetX - attackerX);
  return Math.abs(angleDiff(facingAngle, targetAngle)) <= halfArcRad;
}

export function canPlaceStructureAt(
  source: CellSource,
  structures: WorldStructure[],
  gx: number,
  gy: number,
  playerX: number,
  playerY: number
): boolean {
  const cell = readCellFromSource(source, gx, gy);
  if (!cell) return false;
  if (cell.solid || cell.tile === 'water' || cell.prop === 'door') return false;
  if (structures.some((s) => s.gx === gx && s.gy === gy)) return false;
  if (dist(gx + 0.5, gy + 0.5, playerX, playerY) < 0.75) return false;
  if (dist(gx + 0.5, gy + 0.5, playerX, playerY) > 4.2) return false;
  return true;
}

export function getStructureMaxHp(kind: StructureKind): number {
  return STRUCTURES[kind].maxHp;
}

const PROP_HALF_EXTENTS: Record<PropKind, { hx: number; hy: number }> = {
  none: { hx: 0.4, hy: 0.3 }, // player-built solid barricade
  wall_brick: { hx: 0.5, hy: 0.5 },
  wall_wood: { hx: 0.5, hy: 0.5 },
  wall_interior: { hx: 0.5, hy: 0.5 },
  door: { hx: 0.48, hy: 0.32 },
  stove: { hx: 0.34, hy: 0.32 },
  fishing_post: { hx: 0.14, hy: 0.14 },
  dumpster: { hx: 0.48, hy: 0.31 },
  concrete_barrier: { hx: 0.48, hy: 0.19 },
  counter: { hx: 0.44, hy: 0.25 },
  bench: { hx: 0.44, hy: 0.19 },
  bed: { hx: 0.38, hy: 0.3 },
  couch: { hx: 0.38, hy: 0.24 },
  table: { hx: 0.32, hy: 0.26 },
  bookshelf: { hx: 0.38, hy: 0.22 },
  desk: { hx: 0.36, hy: 0.24 },
  sink_toilet: { hx: 0.24, hy: 0.24 },
  tv_stand: { hx: 0.32, hy: 0.22 },
  crate_wood: { hx: 0.36, hy: 0.36 },
  crate_military: { hx: 0.36, hy: 0.36 },
  fridge: { hx: 0.3, hy: 0.3 },
  med_cabinet: { hx: 0.25, hy: 0.25 },
  barrel_burn: { hx: 0.24, hy: 0.24 },
  tree_pine: { hx: 0.2, hy: 0.2 },
  tree_dead: { hx: 0.2, hy: 0.2 },
  hydrant: { hx: 0.13, hy: 0.13 },
  streetlamp: { hx: 0.13, hy: 0.13 },
  car_police: { hx: 0.45, hy: 0.34 },
  car_sedan: { hx: 0.45, hy: 0.34 },
};

export function getTileColliderHalfExtents(cell: TileCell): { hx: number; hy: number } {
  if (cell.tile === 'water' && cell.prop === 'none') {
    return { hx: 0.48, hy: 0.48 };
  }
  return PROP_HALF_EXTENTS[cell.prop] ?? PROP_HALF_EXTENTS.none;
}

/**
 * Checks exact circle collision against tight per-prop world bounds and optional rotated vehicle hulls.
 */
export function isCircleBlocked(
  source: CellSource,
  wx: number,
  wy: number,
  radius: number,
  vehicles?: Vehicle[],
  ignoreVehicleId: number | null = null
): boolean {
  const minGX = Math.floor(wx - radius);
  const maxGX = Math.floor(wx + radius);
  const minGY = Math.floor(wy - radius);
  const maxGY = Math.floor(wy + radius);

  const rSq = radius * radius;
  for (let gy = minGY; gy <= maxGY; gy++) {
    for (let gx = minGX; gx <= maxGX; gx++) {
      const cell = readCellFromSource(source, gx, gy);
      if (!cell) return true;
      if (!cell.solid) continue;
      const { hx, hy } = getTileColliderHalfExtents(cell);
      const cx = clamp(wx, gx + 0.5 - hx, gx + 0.5 + hx);
      const cy = clamp(wy, gy + 0.5 - hy, gy + 0.5 + hy);
      const dx = wx - cx;
      const dy = wy - cy;
      if (dx * dx + dy * dy < rSq) {
        return true;
      }
    }
  }

  if (vehicles) {
    const carHalfLen = 0.72;
    const carHalfWid = 0.34;
    for (const v of vehicles) {
      if (v.id === ignoreVehicleId) continue;
      const dx = wx - v.x;
      const dy = wy - v.y;
      if (dx * dx + dy * dy > (carHalfLen + radius + 0.2) ** 2) continue;
      const cosA = Math.cos(v.angle);
      const sinA = Math.sin(v.angle);
      const lx = dx * cosA + dy * sinA;
      const ly = -dx * sinA + dy * cosA;
      const cx = clamp(lx, -carHalfLen, carHalfLen);
      const cy = clamp(ly, -carHalfWid, carHalfWid);
      const rx = lx - cx;
      const ry = ly - cy;
      if (rx * rx + ry * ry < rSq) {
        return true;
      }
    }
  }

  return false;
}

export function computeZombieSteering(
  source: CellSource,
  zx: number,
  zy: number,
  targetX: number,
  targetY: number,
  vehicles?: Vehicle[]
): { dx: number; dy: number } {
  const baseAngle = Math.atan2(targetY - zy, targetX - zx);
  const offsets = [0, 0.65, -0.65, 1.25, -1.25, 1.8, -1.8];
  const probeDist = 0.72;

  for (const off of offsets) {
    const a = baseAngle + off;
    const vx = Math.cos(a);
    const vy = Math.sin(a);
    const px = zx + vx * probeDist;
    const py = zy + vy * probeDist;
    if (!isCircleBlocked(source, px, py, 0.22, vehicles, null)) {
      return { dx: vx, dy: vy };
    }
  }
  return { dx: Math.cos(baseAngle), dy: Math.sin(baseAngle) };
}

export function getBuildTargetTile(
  playerX: number,
  playerY: number,
  facingAngle: number,
  mouseWorldX: number,
  mouseWorldY: number,
  usingVirtualAim: boolean
): { gx: number; gy: number } {
  if (usingVirtualAim) {
    const tx = playerX + Math.cos(facingAngle) * 1.65;
    const ty = playerY + Math.sin(facingAngle) * 1.65;
    return {
      gx: Math.floor(tx),
      gy: Math.floor(ty),
    };
  }
  return {
    gx: Math.floor(mouseWorldX),
    gy: Math.floor(mouseWorldY),
  };
}

export function computeCombatDamage(
  baseDamage: number,
  roll: number,
  critChance = 0.18
): { damage: number; isCrit: boolean } {
  const isCrit = roll < critChance;
  return {
    damage: isCrit ? Math.round(baseDamage * 1.6) : baseDamage,
    isCrit,
  };
}

/**
 * Finds a nearby lakeside pier or water shoreline spot suitable for casting a fishing bobber.
 */
export function findFishingSpot(
  source: CellSource,
  px: number,
  py: number
): { canFish: boolean; onPier: boolean; pierGX: number; pierGY: number; bobberX: number; bobberY: number } | null {
  const pgx = Math.floor(px);
  const pgy = Math.floor(py);
  const standingCell = readCellFromSource(source, pgx, pgy);
  const onPier = standingCell?.tile === 'pier';

  // Scan water tiles within 2.5 tiles; prefer further out water tiles (1.6-2.5 tiles away) for a realistic cast
  let bestWater: { gx: number; gy: number; score: number } | null = null;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const gx = pgx + dx;
      const gy = pgy + dy;
      const cell = readCellFromSource(source, gx, gy);
      if (!cell || cell.tile !== 'water') continue;
      const d = dist(px, py, gx + 0.5, gy + 0.5);
      if (d > 2.65) continue;
      const score = onPier ? d : 3.0 - d; // piers cast slightly deeper; shoreline requires adjacent edge
      if (!onPier && d > 1.55) continue;
      if (!bestWater || score > bestWater.score) {
        bestWater = { gx, gy, score };
      }
    }
  }

  if (!bestWater) return null;
  return {
    canFish: true,
    onPier,
    pierGX: pgx,
    pierGY: pgy,
    bobberX: bestWater.gx + 0.5,
    bobberY: bestWater.gy + 0.5,
  };
}

/**
 * Steps 2D arcade-realistic vehicle kinematics with smoother speed-adaptive steering, Turbo Boost, handbrake drift, and fuel usage.
 */
export function stepVehiclePhysics(
  vehicle: Vehicle,
  throttle: number, // -1..1
  steer: number, // -1..1
  handbrake: boolean,
  dt: number,
  boost = false
): Vehicle {
  const next = { ...vehicle };
  const hasFuel = next.fuel > 0 && next.hp > 0;
  const activeThrottle = hasFuel ? throttle : 0;
  const isBoosting = Boolean(boost && hasFuel && activeThrottle > 0.15 && !handbrake);

  const baseMaxFwd = next.kind === 'police' ? 10.8 : 9.6;
  const maxFwd = isBoosting ? baseMaxFwd * 1.36 : baseMaxFwd;
  const maxRev = -4.4;
  const baseAccel = next.kind === 'police' ? 11.8 : 9.8;
  const accel = isBoosting ? baseAccel * 1.72 : baseAccel;
  next.boosting = isBoosting;

  if (activeThrottle > 0.05) {
    next.speed = Math.min(maxFwd, next.speed + activeThrottle * accel * dt);
  } else if (activeThrottle < -0.05) {
    next.speed = Math.max(maxRev, next.speed + activeThrottle * accel * 0.85 * dt);
  } else {
    const drag = handbrake ? 10.5 : 4.4;
    if (next.speed > 0) next.speed = Math.max(0, next.speed - drag * dt);
    else if (next.speed < 0) next.speed = Math.min(0, next.speed + drag * dt);
  }

  if (handbrake && Math.abs(next.speed) > 1.4) {
    next.speed *= Math.exp(-dt * 2.2);
    next.drifting = Math.abs(steer) > 0.25;
  } else {
    next.drifting = false;
  }

  // Smooth speed-adaptive steering with high-speed stability curve
  const absSpeed = Math.abs(next.speed);
  const lowSpeedRamp = absSpeed < 0.1 ? 0 : clamp(absSpeed / 2.2, 0.28, 1);
  const highSpeedDamp = 1 - clamp(absSpeed / 26, 0, 0.24);
  const reverseFlip = next.speed < -0.15 ? -1 : 1;
  const turnMult = next.drifting ? 3.45 : 2.85;
  next.angle += steer * turnMult * lowSpeedRamp * highSpeedDamp * reverseFlip * dt;

  // Tight lateral velocity grip so cars track predictably around corners without feeling icy
  const targetVx = Math.cos(next.angle) * next.speed;
  const targetVy = Math.sin(next.angle) * next.speed;
  const grip = next.drifting ? 4.2 : 12.8;
  next.vx += (targetVx - next.vx) * Math.min(1, grip * dt);
  next.vy += (targetVy - next.vy) * Math.min(1, grip * dt);

  if (Math.abs(activeThrottle) > 0.05 && hasFuel) {
    const fuelMult = isBoosting ? 2.25 : 1.0;
    next.fuel = Math.max(0, next.fuel - dt * fuelMult * (0.45 + absSpeed * 0.075));
  }

  return next;
}

export function repairVehicleWithScrap(
  vehicle: Vehicle,
  inventory: Inventory
): { vehicle: Vehicle; inventory: Inventory; repaired: boolean; message: string } {
  if (vehicle.hp >= vehicle.maxHp) {
    return { vehicle, inventory, repaired: false, message: 'Vehicle hull is already intact' };
  }
  if (inventory.scrap < VEHICLE_REPAIR_SCRAP_COST) {
    return {
      vehicle,
      inventory,
      repaired: false,
      message: `Need ${VEHICLE_REPAIR_SCRAP_COST} Scrap to repair`,
    };
  }
  const nextInv = { ...inventory, scrap: inventory.scrap - VEHICLE_REPAIR_SCRAP_COST };
  const restored = Math.min(vehicle.maxHp, vehicle.hp + 85);
  const delta = restored - vehicle.hp;
  return {
    vehicle: { ...vehicle, hp: restored },
    inventory: nextInv,
    repaired: true,
    message: `Repaired +${delta} Hull HP`,
  };
}

export function computeRamImpact(
  speedTilesPerSec: number,
  boosting = false
): { damage: number; heavy: boolean } {
  const absSpeed = Math.abs(speedTilesPerSec);
  if (absSpeed < 1.8) return { damage: 0, heavy: false };
  const baseDamage = 14 + absSpeed * 12.5;
  const damage = Math.round(boosting ? baseDamage * 1.35 : baseDamage);
  return { damage, heavy: absSpeed >= 5.0 || boosting };
}

export function findVehicleExitPosition(
  source: CellSource,
  vx: number,
  vy: number,
  angle: number,
  vehicles?: Vehicle[],
  vehicleId: number | null = null
): { x: number; y: number } {
  const candidates = [
    angle - Math.PI * 0.5,
    angle + Math.PI * 0.5,
    angle + Math.PI,
    angle,
  ];
  for (const dir of candidates) {
    for (const distOut of [1.05, 1.45]) {
      const tx = vx + Math.cos(dir) * distOut;
      const ty = vy + Math.sin(dir) * distOut;
      if (!isCircleBlocked(source, tx, ty, 0.22, vehicles, vehicleId)) {
        return { x: tx, y: ty };
      }
    }
  }
  return { x: vx, y: vy };
}

export function toggleDoorState(door: DoorEntity, cell: TileCell): { changed: boolean; message: string } {
  if (door.status === 'locked') {
    return { changed: false, message: 'Door is locked' };
  }
  if (door.status === 'barricaded') {
    door.status = 'closed';
    door.barricadeHp = 0;
    applyDoorCellState(cell, 'closed');
    return { changed: true, message: 'Removed Barricade' };
  }
  if (door.status === 'closed') {
    door.status = 'open';
    applyDoorCellState(cell, 'open');
    return { changed: true, message: 'Opened Door' };
  }
  door.status = 'closed';
  applyDoorCellState(cell, 'closed');
  return { changed: true, message: 'Closed Door' };
}

export function barricadeDoorWithWood(
  door: DoorEntity,
  cell: TileCell,
  inventory: Inventory
): { inventory: Inventory; barricaded: boolean; message: string } {
  if (door.status === 'locked') {
    return { inventory, barricaded: false, message: 'Unlock door before barricading' };
  }
  if (door.status === 'barricaded' && door.barricadeHp >= door.maxBarricadeHp) {
    return { inventory, barricaded: false, message: 'Door already reinforced' };
  }
  if (inventory.wood < 2) {
    return { inventory, barricaded: false, message: 'Need 2 Wood to barricade door' };
  }
  const nextInv = { ...inventory, wood: inventory.wood - 2 };
  door.status = 'barricaded';
  door.openProgress = 0;
  door.barricadeHp = door.maxBarricadeHp;
  applyDoorCellState(cell, 'barricaded');
  return { inventory: nextInv, barricaded: true, message: 'Barricaded Door (-2 Wood)' };
}

export function advanceDoorLockpick(
  door: DoorEntity,
  cell: TileCell,
  step = 0.36
): { unlocked: boolean; progress: number } {
  if (door.status !== 'locked') {
    return { unlocked: true, progress: 1 };
  }
  door.lockpickProgress = Math.min(1, door.lockpickProgress + step);
  if (door.lockpickProgress >= 1) {
    door.status = 'open';
    door.lockpickProgress = 0;
    applyDoorCellState(cell, 'open');
    return { unlocked: true, progress: 1 };
  }
  return { unlocked: false, progress: door.lockpickProgress };
}

export const BED_SLEEP_HEAL = 40;
export const BED_SLEEP_MINUTES = 180;
export const BED_SLEEP_DANGER_RADIUS = 4.0;

export function canSleepSafely(
  zombies: Array<{ x: number; y: number; state: string }>,
  px: number,
  py: number
): boolean {
  for (const z of zombies) {
    if (z.state === 'dying') continue;
    if (dist(z.x, z.y, px, py) <= BED_SLEEP_DANGER_RADIUS) {
      return false;
    }
  }
  return true;
}

export function applyBedSleep(
  player: PlayerState,
  timeMinutes: number,
  day: number
): {
  player: PlayerState;
  timeMinutes: number;
  day: number;
  dayWrapped: boolean;
  healed: number;
} {
  const nextHp = Math.min(player.maxHp, player.hp + BED_SLEEP_HEAL);
  const healed = Math.max(0, nextHp - player.hp);
  let nextTime = timeMinutes + BED_SLEEP_MINUTES;
  let nextDay = day;
  let dayWrapped = false;
  if (nextTime >= 1440) {
    nextTime -= 1440;
    nextDay += 1;
    dayWrapped = true;
  }
  return {
    player: {
      ...player,
      hp: nextHp,
      hunger: Math.max(0, player.hunger - 4),
      thirst: Math.max(0, player.thirst - 5),
    },
    timeMinutes: nextTime,
    day: nextDay,
    dayWrapped,
    healed,
  };
}



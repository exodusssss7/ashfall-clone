import type { TileCell, WorldStore } from './types';

// Native pixel-art isometric tile dimensions (2:1 crisp isometric ratio)
export const TILE_W = 32;
export const TILE_H = 16;
export const PIXEL_SCALE = 2; // Rendered at exact 2x nearest-neighbor (64x32 screen px per tile)

export const MAP_SIZE = 56; // Curated starter town block footprint (chunks 0..3)
export const CHUNK_SIZE = 16;

export type CellSource = TileCell[][] | WorldStore | ((gx: number, gy: number) => TileCell | undefined);

export function readCellFromSource(source: CellSource, gx: number, gy: number): TileCell | undefined {
  if (typeof source === 'function') {
    return source(gx, gy);
  }
  if (Array.isArray(source)) {
    return source[gy]?.[gx];
  }
  const cx = Math.floor(gx / CHUNK_SIZE);
  const cy = Math.floor(gy / CHUNK_SIZE);
  const chunk = source.chunks.get(`${cx},${cy}`);
  if (!chunk) return undefined;
  const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return chunk.cells[ly]?.[lx];
}

export interface ScreenPoint {
  sx: number;
  sy: number;
}

export interface WorldPoint {
  wx: number;
  wy: number;
}

/**
 * Converts continuous world tile coordinates (wx, wy, wz) into unscaled pixel-art canvas coordinates
 * relative to world origin (0, 0).
 */
export function worldToIso(wx: number, wy: number, wz = 0): ScreenPoint {
  return {
    sx: (wx - wy) * (TILE_W * 0.5),
    sy: (wx + wy) * (TILE_H * 0.5) - wz * TILE_H,
  };
}

/**
 * Converts unscaled pixel-art canvas coordinates (relative to world origin) back to continuous world tile coordinates (z = 0 plane).
 */
export function isoToWorld(sx: number, sy: number): WorldPoint {
  const halfW = TILE_W * 0.5;
  const halfH = TILE_H * 0.5;
  return {
    wx: (sx / halfW + sy / halfH) * 0.5,
    wy: (sy / halfH - sx / halfW) * 0.5,
  };
}

export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Converts a normalized screen-space 2D direction (sx: right+, sy: down+)
 * into a normalized 2:1 isometric world-space direction vector.
 */
export function screenVectorToIsoWorld(sx: number, sy: number): { wx: number; wy: number } {
  const rawX = sx + sy;
  const rawY = sy - sx;
  const len = Math.hypot(rawX, rawY);
  if (len < 1e-6) return { wx: 0, wy: 0 };
  return { wx: rawX / len, wy: rawY / len };
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Grid DDA / step raycast to check if line of sight or bullet path is blocked by solid tiles.
 */
export function hasLineOfSight(
  source: CellSource,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  checkSightBlocking = true
): boolean {
  const totalDist = Math.hypot(bx - ax, by - ay);
  if (totalDist < 0.05) return true;
  const steps = Math.ceil(totalDist * 4);
  const dx = (bx - ax) / steps;
  const dy = (by - ay) / steps;

  for (let i = 1; i < steps; i++) {
    const px = ax + dx * i;
    const py = ay + dy * i;
    const gx = Math.floor(px);
    const gy = Math.floor(py);
    const cell = readCellFromSource(source, gx, gy);
    if (!cell) return false;
    if (checkSightBlocking ? cell.blocksSight : cell.solid) {
      return false;
    }
  }
  return true;
}

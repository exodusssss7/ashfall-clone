/**
 * Run autosave: versioned JSON snapshot of everything a run mutates, stored in
 * localStorage. The world layout itself is deterministic from the seed, so the
 * snapshot carries only entity lists, states and explored-fog bitmasks; on load
 * the world regenerates and the snapshot is overlaid (door/structure cell
 * effects are re-applied by the engine).
 *
 * Hardcore runs use the same snapshot while alive; the engine deletes the save
 * when a hardcore run ends in death.
 */

import { CHUNK_SIZE } from './isometric';
import type {
  DoorEntity,
  Inventory,
  LootContainer,
  PlayerState,
  Vehicle,
  WorldChunk,
  WorldLandmark,
  WorldStructure,
  Zombie,
} from './types';

export const SAVE_KEY = 'ashfall_save_v1';
export const SAVE_VERSION = 1;

export interface ExploredChunkBits {
  /** "cx,cy" chunk key */
  key: string;
  /** 64 hex chars = 256 bits, bit (ly * CHUNK_SIZE + lx) set when explored */
  bits: string;
}

export interface RunSnapshot {
  version: number;
  savedAt: number;
  hardcore: boolean;
  playerName: string;
  day: number;
  timeMinutes: number;
  timeLabel: string;
  kills: number;
  score: number;
  restCooldownSeconds: number;
  player: PlayerState;
  inventory: Inventory;
  hotbar?: import('./hotbarSystem').HotbarState;
  activeVehicleId: number | null;
  nextVehicleId: number;
  nextEntityId: number;
  nextPickupToastId: number;
  scoredLootSources: string[];
  populatedChunks: string[];
  landmarks: WorldLandmark[];
  containers: LootContainer[];
  structures: WorldStructure[];
  vehicles: Vehicle[];
  doors: DoorEntity[];
  zombies: Zombie[];
  explored: ExploredChunkBits[];
  clearedCaveIds?: string[];
  weatherElapsedSeconds?: number;
}

export interface RunSaveMeta {
  day: number;
  timeLabel: string;
  hardcore: boolean;
  playerName: string;
  savedAt: number;
}

// ---------- explored fog bitmask codec (CHUNK_SIZE x CHUNK_SIZE cells) ----------

const BITS_CHARS = (CHUNK_SIZE * CHUNK_SIZE) / 4; // hex chars per chunk
const HEX = '0123456789abcdef';

export function encodeExploredChunks(chunks: Map<string, WorldChunk>): ExploredChunkBits[] {
  const out: ExploredChunkBits[] = [];
  for (const [key, chunk] of chunks) {
    let bits = '';
    let any = false;
    for (let nibble = 0; nibble < BITS_CHARS; nibble++) {
      let v = 0;
      for (let b = 0; b < 4; b++) {
        const idx = nibble * 4 + b;
        const ly = Math.floor(idx / CHUNK_SIZE);
        const lx = idx % CHUNK_SIZE;
        if (chunk.cells[ly]?.[lx]?.explored) {
          v |= 1 << b;
          any = true;
        }
      }
      bits += HEX[v];
    }
    if (any) out.push({ key, bits });
  }
  return out;
}

export function decodeExploredChunks(
  chunks: Map<string, WorldChunk>,
  explored: ExploredChunkBits[]
): void {
  if (!Array.isArray(explored)) return;
  for (const entry of explored) {
    const chunk = chunks.get(entry?.key);
    if (!chunk || typeof entry.bits !== 'string' || entry.bits.length !== BITS_CHARS) continue;
    for (let nibble = 0; nibble < BITS_CHARS; nibble++) {
      const v = parseInt(entry.bits[nibble], 16);
      if (!Number.isFinite(v)) continue;
      for (let b = 0; b < 4; b++) {
        if (v & (1 << b)) {
          const idx = nibble * 4 + b;
          const ly = Math.floor(idx / CHUNK_SIZE);
          const lx = idx % CHUNK_SIZE;
          const cell = chunk.cells[ly]?.[lx];
          if (cell) cell.explored = true;
        }
      }
    }
  }
}

// ---------- validation ----------

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isObjectArray(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every(isObj);
}

/** Structural check so a corrupt or foreign save can never crash a restore. */
export function isValidSnapshot(raw: unknown): raw is RunSnapshot {
  if (!isObj(raw)) return false;
  if (raw.version !== SAVE_VERSION) return false;
  if (!isObj(raw.player) || !isNum(raw.player.x) || !isNum(raw.player.y) || !isNum(raw.player.hp)) return false;
  if (!isObj(raw.inventory)) return false;
  if (!isNum(raw.day) || !isNum(raw.timeMinutes) || !isNum(raw.kills) || !isNum(raw.score)) return false;
  if (!isNum(raw.nextVehicleId) || !isNum(raw.nextEntityId)) return false;
  if (!isStringArray(raw.populatedChunks)) return false;
  if (!isStringArray(raw.scoredLootSources)) return false;
  if (!isObjectArray(raw.landmarks)) return false;
  if (!isObjectArray(raw.containers)) return false;
  if (!isObjectArray(raw.structures)) return false;
  if (!isObjectArray(raw.vehicles)) return false;
  if (!isObjectArray(raw.doors)) return false;
  if (!isObjectArray(raw.zombies)) return false;
  if (!Array.isArray(raw.explored)) return false;
  return true;
}

export function parseRunSnapshot(json: string | null): RunSnapshot | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as unknown;
    return isValidSnapshot(raw) ? (raw as RunSnapshot) : null;
  } catch {
    return null;
  }
}

// ---------- storage ----------

export function storeRunSnapshot(save: RunSnapshot): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // storage full / denied: autosave silently skipped, run continues in memory
  }
}

export function loadRunSnapshot(): RunSnapshot | null {
  try {
    return parseRunSnapshot(typeof localStorage !== 'undefined' ? localStorage.getItem(SAVE_KEY) : null);
  } catch {
    return null;
  }
}

export function clearRunSnapshot(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}

export function getRunSaveMeta(): RunSaveMeta | null {
  const s = loadRunSnapshot();
  if (!s) return null;
  return {
    day: s.day,
    timeLabel: typeof s.timeLabel === 'string' ? s.timeLabel : '',
    hardcore: Boolean(s.hardcore),
    playerName: typeof s.playerName === 'string' ? s.playerName : '',
    savedAt: isNum(s.savedAt) ? s.savedAt : 0,
  };
}

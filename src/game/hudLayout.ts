/**
 * Edit-HUD layout store: per-element pixel offsets from the default anchor
 * positions, chosen by dragging in Edit HUD mode and persisted. Offsets are
 * applied as CSS transforms on the live elements, so the default responsive
 * anchoring stays the base and Reset restores it exactly.
 */

export type HudElementId =
  | 'vitals'
  | 'utility'
  | 'hotbar'
  | 'leftFire'
  | 'fpsAttack'
  | 'quickRail';

export interface HudOffset {
  dx: number;
  dy: number;
}

export const HUD_ELEMENT_LABELS: Record<HudElementId, string> = {
  vitals: 'Status panel',
  utility: 'Top buttons',
  hotbar: 'Item slots',
  leftFire: 'Left fire button',
  fpsAttack: 'Right fire button',
  quickRail: 'Action buttons',
};

export const HUD_ELEMENT_IDS: HudElementId[] = [
  'vitals',
  'utility',
  'hotbar',
  'leftFire',
  'fpsAttack',
  'quickRail',
];

export type HudLayout = Partial<Record<HudElementId, HudOffset>>;

const STORAGE_KEY = 'ashfall_hud_layout_v1';
const MAX_OFFSET = 420;

function clampOffset(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Math.round(v)))
    : 0;
}

function load(): HudLayout {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { dx?: unknown; dy?: unknown }>;
    const out: HudLayout = {};
    for (const id of HUD_ELEMENT_IDS) {
      const e = parsed?.[id];
      if (e && (clampOffset(e.dx) !== 0 || clampOffset(e.dy) !== 0)) {
        out[id] = { dx: clampOffset(e.dx), dy: clampOffset(e.dy) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

let current: HudLayout = load();

const listeners = new Set<(l: HudLayout) => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // storage denied: keep runtime layout
  }
  for (const fn of listeners) fn(current);
}

export function getHudLayout(): HudLayout {
  return current;
}

export function getHudOffset(id: HudElementId): HudOffset {
  return current[id] ?? { dx: 0, dy: 0 };
}

export function setHudOffset(id: HudElementId, offset: HudOffset): void {
  const dx = clampOffset(offset.dx);
  const dy = clampOffset(offset.dy);
  if (dx === 0 && dy === 0) {
    if (!(id in current)) return;
    const next = { ...current };
    delete next[id];
    current = next;
  } else {
    current = { ...current, [id]: { dx, dy } };
  }
  persist();
}

export function resetHudLayout(): void {
  current = {};
  persist();
}

export function subscribeHudLayout(fn: (l: HudLayout) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function hudOffsetTransform(id: HudElementId): string | undefined {
  const { dx, dy } = getHudOffset(id);
  return dx !== 0 || dy !== 0 ? `translate(${dx}px, ${dy}px)` : undefined;
}

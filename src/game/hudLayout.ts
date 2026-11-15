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
  /** Uniform size multiplier from Edit HUD corner-drag. 1 = default size. */
  scale?: number;
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
/** Per-button size multipliers live alongside the offsets in the same JSON doc. */
const BUTTONS_FIELD = '__buttons';
const MAX_OFFSET = 420;
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.8;

function clampOffset(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Math.round(v)))
    : 0;
}

function clampScale(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(v * 20) / 20))
    : 1;
}

function load(): HudLayout {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: HudLayout = {};
    for (const id of HUD_ELEMENT_IDS) {
      const e = parsed?.[id] as { dx?: unknown; dy?: unknown; scale?: unknown } | undefined;
      if (e && (clampOffset(e.dx) !== 0 || clampOffset(e.dy) !== 0 || clampScale(e.scale) !== 1)) {
        out[id] = { dx: clampOffset(e.dx), dy: clampOffset(e.dy), scale: clampScale(e.scale) };
      }
    }
    const btns = parsed?.[BUTTONS_FIELD];
    if (btns && typeof btns === 'object') {
      for (const [k, v] of Object.entries(btns as Record<string, unknown>)) {
        const sc = clampScale(v);
        if (sc !== 1) buttonScales[k] = sc;
      }
    }
    return out;
  } catch {
    return {};
  }
}

const buttonScales: Record<string, number> = {};
let current: HudLayout = load();

const listeners = new Set<(l: HudLayout) => void>();

function persist(): void {
  try {
    const doc: Record<string, unknown> = { ...current };
    if (Object.keys(buttonScales).length > 0) doc[BUTTONS_FIELD] = buttonScales;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // storage denied: keep runtime layout
  }
  for (const fn of listeners) fn(current);
}

export function getHudLayout(): HudLayout {
  return current;
}

export function getHudOffset(id: HudElementId): HudOffset {
  return current[id] ?? { dx: 0, dy: 0, scale: 1 };
}

export function getHudScale(id: HudElementId): number {
  return current[id]?.scale ?? 1;
}

function commit(id: HudElementId, dx: number, dy: number, scale: number): void {
  if (dx === 0 && dy === 0 && scale === 1) {
    if (!(id in current)) return;
    const next = { ...current };
    delete next[id];
    current = next;
  } else {
    current = { ...current, [id]: { dx, dy, scale } };
  }
  persist();
}

export function setHudOffset(id: HudElementId, offset: HudOffset): void {
  commit(id, clampOffset(offset.dx), clampOffset(offset.dy), current[id]?.scale ?? 1);
}

export function setHudScale(id: HudElementId, scale: number): void {
  const o = getHudOffset(id);
  commit(id, o.dx, o.dy, clampScale(scale));
}

export function getButtonScale(id: string): number {
  return buttonScales[id] ?? 1;
}

export function setButtonScale(id: string, scale: number): void {
  const sc = clampScale(scale);
  if (sc === 1) {
    if (!(id in buttonScales)) return;
    delete buttonScales[id];
  } else {
    if (buttonScales[id] === sc) return;
    buttonScales[id] = sc;
  }
  persist();
}

export function resetHudLayout(): void {
  current = {};
  for (const k of Object.keys(buttonScales)) delete buttonScales[k];
  persist();
}

/**
 * Applies saved per-button sizes as inline transforms on every element with a
 * data-btn-id attribute. Called after HUD renders and on every layout change;
 * inline styles survive React re-renders because no button manages its own
 * transform in its style prop.
 */
export function applyButtonScales(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-btn-id]').forEach((el) => {
    const id = el.dataset.btnId;
    if (!id) return;
    const s = getButtonScale(id);
    el.style.transform = s !== 1 ? `scale(${s})` : '';
    el.style.transformOrigin = s !== 1 ? 'center' : '';
  });
}

/** Anchor point each group grows/shrinks from, so resizing never pushes it off its screen edge. */
export const HUD_ELEMENT_ORIGINS: Record<HudElementId, string> = {
  vitals: 'top left',
  utility: 'top right',
  hotbar: 'bottom center',
  leftFire: 'bottom left',
  fpsAttack: 'bottom right',
  quickRail: 'bottom right',
};

export function subscribeHudLayout(fn: (l: HudLayout) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function hudOffsetTransform(id: HudElementId): string | undefined {
  const { dx, dy, scale } = getHudOffset(id);
  const parts: string[] = [];
  if (dx !== 0 || dy !== 0) parts.push(`translate(${dx}px, ${dy}px)`);
  if (scale !== undefined && scale !== 1) parts.push(`scale(${scale})`);
  return parts.length ? parts.join(' ') : undefined;
}

import { WEAPONS } from './recipes';
import type { ConsumableItemId, WeaponId } from './types';

export const HOTBAR_ROW_SIZE = 7;
export const HOTBAR_TOTAL_SLOTS = 14;
export const HOTBAR_STORAGE_KEY = 'ashfall_hotbar_v1';

export type HotbarToolId =
  | 'build_hammer'
  | 'flashlight'
  | 'barricade'
  | 'spike_trap'
  | 'campfire';

export type HotbarEntry =
  | { kind: 'weapon'; id: WeaponId }
  | { kind: 'consumable'; id: ConsumableItemId }
  | { kind: 'tool'; id: HotbarToolId };

export type HotbarSlotValue = HotbarEntry | null;

export interface HotbarState {
  slots: HotbarSlotValue[];
  expanded: boolean;
}

export interface HotbarToolMeta {
  id: HotbarToolId;
  name: string;
  short: string;
  icon: string;
  description: string;
  effect: string;
}

export const HOTBAR_TOOLS: Record<HotbarToolId, HotbarToolMeta> = {
  build_hammer: {
    id: 'build_hammer',
    name: 'Build Hammer',
    short: 'Build',
    icon: 'build',
    description: 'Enter construction placement mode for barricades, spike traps, and campfires.',
    effect: 'Toggles Build Mode ([B])',
  },
  flashlight: {
    id: 'flashlight',
    name: 'Tactical Flashlight',
    short: 'Light',
    icon: 'flashlight',
    description: 'High-beam survival torch for illuminating dark interiors and night roads.',
    effect: 'Toggles Flashlight / Headlights ([F])',
  },
  barricade: {
    id: 'barricade',
    name: 'Wooden Barricade',
    short: 'Wall',
    icon: 'barricade',
    description: 'Quick-select Wooden Barricade blueprint for immediate fortification placement.',
    effect: '3 Wood · 1 Scrap',
  },
  spike_trap: {
    id: 'spike_trap',
    name: 'Spike Trap',
    short: 'Spikes',
    icon: 'spike_trap',
    description: 'Quick-select Spike Trap blueprint to lacerate and bleed pursuing infected.',
    effect: '2 Wood · 2 Scrap',
  },
  campfire: {
    id: 'campfire',
    name: 'Campfire Kit',
    short: 'Fire',
    icon: 'campfire',
    description: 'Quick-select Campfire blueprint for warmth, light, and cooking fish or rations.',
    effect: '3 Wood · 1 Cloth',
  },
};

export const VALID_WEAPON_IDS = new Set<WeaponId>([
  'crowbar',
  'machete',
  'barbed_bat',
  'axe',
  'sledgehammer',
  'pistol',
  'shotgun',
  'lmg',
  'molotov',
]);

export const VALID_CONSUMABLE_IDS = new Set<ConsumableItemId>([
  'food',
  'water',
  'bandage',
  'raw_fish',
  'cooked_fish',
  'fish_stew',
  'hot_rations',
]);

export const VALID_TOOL_IDS = new Set<HotbarToolId>([
  'build_hammer',
  'flashlight',
  'barricade',
  'spike_trap',
  'campfire',
]);

const SLOT_KEY_LABELS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  '-',
  '=',
  '[',
  ']',
] as const;

const DEFAULT_SLOTS: HotbarSlotValue[] = [
  // Row 1 (Primary compact row: Slots 1-7)
  { kind: 'weapon', id: 'crowbar' },
  { kind: 'weapon', id: 'pistol' },
  { kind: 'weapon', id: 'shotgun' },
  { kind: 'weapon', id: 'molotov' },
  { kind: 'weapon', id: 'lmg' },
  { kind: 'consumable', id: 'bandage' },
  { kind: 'tool', id: 'build_hammer' },
  // Row 2 (Collapsible extra row: Slots 8-14)
  { kind: 'weapon', id: 'machete' },
  { kind: 'weapon', id: 'barbed_bat' },
  { kind: 'weapon', id: 'axe' },
  { kind: 'weapon', id: 'sledgehammer' },
  { kind: 'consumable', id: 'food' },
  { kind: 'consumable', id: 'water' },
  { kind: 'tool', id: 'flashlight' },
];

export function createDefaultHotbarState(): HotbarState {
  return {
    slots: DEFAULT_SLOTS.map((entry) => (entry ? { ...entry } : null)),
    expanded: false,
  };
}

export function cloneHotbarState(state: HotbarState): HotbarState {
  return {
    slots: state.slots.map((entry) => (entry ? { ...entry } : null)),
    expanded: Boolean(state.expanded),
  };
}

export function isSameHotbarEntry(
  a: HotbarSlotValue | undefined,
  b: HotbarSlotValue | undefined
): boolean {
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id;
}

export function isValidHotbarEntry(raw: unknown): raw is HotbarEntry {
  if (!raw || typeof raw !== 'object') return false;
  const candidate = raw as { kind?: unknown; id?: unknown };
  if (candidate.kind === 'weapon') {
    return typeof candidate.id === 'string' && VALID_WEAPON_IDS.has(candidate.id as WeaponId);
  }
  if (candidate.kind === 'consumable') {
    return (
      typeof candidate.id === 'string' &&
      VALID_CONSUMABLE_IDS.has(candidate.id as ConsumableItemId)
    );
  }
  if (candidate.kind === 'tool') {
    return typeof candidate.id === 'string' && VALID_TOOL_IDS.has(candidate.id as HotbarToolId);
  }
  return false;
}

export function sanitizeHotbarState(raw: unknown): HotbarState {
  const defaults = createDefaultHotbarState();
  if (!raw || typeof raw !== 'object') return defaults;
  const obj = raw as { slots?: unknown; expanded?: unknown };
  if (!Array.isArray(obj.slots)) return defaults;

  const seen = new Set<string>();
  const sanitizedSlots: HotbarSlotValue[] = new Array<HotbarSlotValue>(HOTBAR_TOTAL_SLOTS).fill(null);

  for (let i = 0; i < HOTBAR_TOTAL_SLOTS; i++) {
    const rawSlot = obj.slots[i];
    if (rawSlot === null) {
      sanitizedSlots[i] = null;
      continue;
    }
    if (isValidHotbarEntry(rawSlot)) {
      const sig = `${rawSlot.kind}:${rawSlot.id}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        sanitizedSlots[i] = { ...rawSlot } as HotbarEntry;
      }
    }
  }

  return {
    slots: sanitizedSlots,
    expanded: Boolean(obj.expanded),
  };
}

/**
 * Expands or collapses the secondary hotbar row without altering or clearing
 * any items assigned to Row 1 or Row 2 slots.
 */
export function toggleHotbarExpanded(state: HotbarState, nextExpanded?: boolean): HotbarState {
  const target = typeof nextExpanded === 'boolean' ? nextExpanded : !state.expanded;
  if (state.expanded === target) return state;
  return {
    slots: state.slots.map((entry) => (entry ? { ...entry } : null)),
    expanded: target,
  };
}

/**
 * Assigns an item/weapon/tool to a hotbar slot index (0..13).
 * If the exact same entry already sits in another slot, moves it cleanly
 * to the target slot so there are no duplicate shortcuts.
 */
export function assignHotbarSlot(
  state: HotbarState,
  slotIndex: number,
  entry: HotbarEntry
): HotbarState {
  if (slotIndex < 0 || slotIndex >= HOTBAR_TOTAL_SLOTS) return state;
  if (!isValidHotbarEntry(entry)) return state;
  const nextSlots = state.slots.map((s) => (s ? { ...s } : null));
  const existingIdx = nextSlots.findIndex((s) => isSameHotbarEntry(s, entry));
  if (existingIdx === slotIndex) return state;
  if (existingIdx !== -1) {
    nextSlots[existingIdx] = null;
  }
  nextSlots[slotIndex] = { ...entry } as HotbarEntry;
  return {
    slots: nextSlots,
    expanded: state.expanded,
  };
}

/**
 * Swaps or moves two hotbar slots directly (works across Row 1 & Row 2, empty or occupied).
 */
export function swapHotbarSlots(
  state: HotbarState,
  fromIndex: number,
  toIndex: number
): HotbarState {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= HOTBAR_TOTAL_SLOTS ||
    toIndex < 0 ||
    toIndex >= HOTBAR_TOTAL_SLOTS
  ) {
    return state;
  }
  const nextSlots = state.slots.map((s) => (s ? { ...s } : null));
  const tmp = nextSlots[fromIndex];
  nextSlots[fromIndex] = nextSlots[toIndex];
  nextSlots[toIndex] = tmp;
  return {
    slots: nextSlots,
    expanded: state.expanded,
  };
}

/**
 * Unassigns a shortcut slot without deleting any item or weapon from inventory.
 */
export function clearHotbarSlot(state: HotbarState, slotIndex: number): HotbarState {
  if (slotIndex < 0 || slotIndex >= HOTBAR_TOTAL_SLOTS) return state;
  if (state.slots[slotIndex] === null) return state;
  const nextSlots = state.slots.map((s) => (s ? { ...s } : null));
  nextSlots[slotIndex] = null;
  return {
    slots: nextSlots,
    expanded: state.expanded,
  };
}

export function resetHotbarState(preserveExpanded = true, currentExpanded = false): HotbarState {
  const def = createDefaultHotbarState();
  return {
    slots: def.slots,
    expanded: preserveExpanded ? currentExpanded : def.expanded,
  };
}

export function countRowAssignedSlots(state: HotbarState, row: 1 | 2): number {
  const start = row === 1 ? 0 : HOTBAR_ROW_SIZE;
  const end = start + HOTBAR_ROW_SIZE;
  let count = 0;
  for (let i = start; i < end; i++) {
    if (state.slots[i] !== null && state.slots[i] !== undefined) count++;
  }
  return count;
}

export function findAssignedSlotIndex(
  state: HotbarState,
  entry: HotbarEntry
): number {
  return state.slots.findIndex((s) => isSameHotbarEntry(s, entry));
}

export function getSlotKeyLabel(slotIndex: number): string {
  return SLOT_KEY_LABELS[slotIndex] ?? '';
}

export function getSlotIndexForKeyCode(code: string, shiftKey = false): number | null {
  if (shiftKey) {
    switch (code) {
      case 'Digit1': return 7;
      case 'Digit2': return 8;
      case 'Digit3': return 9;
      case 'Digit4': return 10;
      case 'Digit5': return 11;
      case 'Digit6': return 12;
      case 'Digit7': return 13;
      default: break;
    }
  }
  switch (code) {
    case 'Digit1': return 0;
    case 'Digit2': return 1;
    case 'Digit3': return 2;
    case 'Digit4': return 3;
    case 'Digit5': return 4;
    case 'Digit6': return 5;
    case 'Digit7': return 6;
    case 'Digit8': return 7;
    case 'Digit9': return 8;
    case 'Digit0': return 9;
    case 'Minus': return 10;
    case 'Equal': return 11;
    case 'BracketLeft': return 12;
    case 'BracketRight': return 13;
    default: return null;
  }
}

export function describeHotbarEntry(entry: HotbarEntry): {
  name: string;
  shortName: string;
  icon: string;
} {
  if (entry.kind === 'weapon') {
    const spec = WEAPONS[entry.id];
    const shortName =
      entry.id === 'barbed_bat'
        ? 'Bat'
        : entry.id === 'axe'
          ? 'Axe'
          : entry.id === 'sledgehammer'
            ? 'Sledge'
            : entry.id === 'pistol'
              ? 'Pistol'
              : entry.id === 'shotgun'
                ? 'Shotgun'
                : entry.id === 'lmg'
                  ? 'LMG'
                  : spec.name;
    return { name: spec.name, shortName, icon: entry.id };
  }
  if (entry.kind === 'tool') {
    const meta = HOTBAR_TOOLS[entry.id];
    return { name: meta.name, shortName: meta.short, icon: meta.icon };
  }
  // Consumable items
  switch (entry.id) {
    case 'bandage':
      return { name: 'Field Bandage', shortName: 'Heal', icon: 'bandage' };
    case 'water':
      return { name: 'Purified Water', shortName: 'Water', icon: 'water' };
    case 'food':
      return { name: 'Canned Rations', shortName: 'Food', icon: 'food' };
    case 'raw_fish':
      return { name: 'Raw Lake Fish', shortName: 'Raw Fish', icon: 'raw_fish' };
    case 'cooked_fish':
      return { name: 'Grilled Fish', shortName: 'Fish', icon: 'cooked_fish' };
    case 'fish_stew':
      return { name: 'Hearty Fish Stew', shortName: 'Stew', icon: 'fish_stew' };
    case 'hot_rations':
      return { name: 'Hot Rations', shortName: 'Meal', icon: 'hot_rations' };
  }
}

export function loadPersistedHotbarState(): HotbarState {
  try {
    if (typeof localStorage === 'undefined') return createDefaultHotbarState();
    const raw = localStorage.getItem(HOTBAR_STORAGE_KEY);
    if (!raw) return createDefaultHotbarState();
    return sanitizeHotbarState(JSON.parse(raw));
  } catch {
    return createDefaultHotbarState();
  }
}

export function savePersistedHotbarState(state: HotbarState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(HOTBAR_STORAGE_KEY, JSON.stringify(sanitizeHotbarState(state)));
  } catch {
    // ignore quota / sandbox errors
  }
}

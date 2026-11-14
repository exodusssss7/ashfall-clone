import { ITEMS } from './recipes';
import type {
  ActiveLootContainer,
  Inventory,
  ItemId,
  LootContainer,
  LootContainerEntry,
  PickupNotification,
} from './types';

export const PICKUP_TOAST_DURATION = 3.2;
export const MAX_PICKUP_NOTIFICATIONS = 5;

export const ITEM_ORDER: ItemId[] = [
  'ammo_9mm',
  'ammo_shell',
  'molotov',
  'bandage',
  'food',
  'water',
  'cooked_fish',
  'fish_stew',
  'hot_rations',
  'raw_fish',
  'fuel',
  'scrap',
  'wood',
  'cloth',
];

export function formatContainerMeta(kind: LootContainer['kind']): { title: string; subtitle: string } {
  switch (kind) {
    case 'crate_military':
      return { title: 'MILITARY AMMO CASE', subtitle: 'Heavy-gauge tactical cache' };
    case 'crate_wood':
      return { title: 'WOODEN SUPPLY CRATE', subtitle: 'Salvageable provisions & gear' };
    case 'fridge':
      return { title: 'KITCHEN REFRIGERATOR', subtitle: 'Cold-storage rations & drinks' };
    case 'med_cabinet':
      return { title: 'MEDICAL CABINET', subtitle: 'Field dressings & clinic stock' };
    case 'car_police':
      return { title: 'POLICE CRUISER TRUNK', subtitle: 'Patrol gear & emergency stash' };
    case 'car_sedan':
      return { title: 'SEDAN TRUNK', subtitle: 'Abandoned trunk compartment' };
    case 'zombie_drop':
      return { title: 'SCAVENGE POUCH', subtitle: 'Recovered field supplies' };
  }
}

export function extractLootEntries(items: Partial<Inventory> | undefined | null): LootContainerEntry[] {
  if (!items) return [];
  const entries: LootContainerEntry[] = [];
  for (const id of ITEM_ORDER) {
    const qty = items[id] ?? 0;
    if (qty > 0) entries.push({ item: id, qty });
  }
  return entries;
}

export function getPrimaryLootItem(items: Partial<Inventory> | undefined | null): ItemId | null {
  const entries = extractLootEntries(items);
  return entries.length > 0 ? entries[0].item : null;
}

export function buildActiveLootContainer(
  sourceType: 'container' | 'trunk',
  sourceId: string,
  kind: LootContainer['kind'],
  items: Partial<Inventory> | undefined | null
): ActiveLootContainer {
  const meta = formatContainerMeta(kind);
  return {
    sourceType,
    sourceId,
    kind,
    title: meta.title,
    subtitle: meta.subtitle,
    entries: extractLootEntries(items),
  };
}

export function transferSingleLootItem(
  containerItems: Partial<Inventory>,
  inventory: Inventory,
  item: ItemId
): {
  takenQty: number;
  nextContainerItems: Partial<Inventory>;
  nextInventory: Inventory;
  isEmpty: boolean;
} {
  const qty = containerItems[item] ?? 0;
  if (qty <= 0) {
    return {
      takenQty: 0,
      nextContainerItems: containerItems,
      nextInventory: inventory,
      isEmpty: extractLootEntries(containerItems).length === 0,
    };
  }
  const nextContainerItems: Partial<Inventory> = { ...containerItems };
  delete nextContainerItems[item];
  const nextInventory: Inventory = {
    ...inventory,
    [item]: (inventory[item] ?? 0) + qty,
  };
  return {
    takenQty: qty,
    nextContainerItems,
    nextInventory,
    isEmpty: extractLootEntries(nextContainerItems).length === 0,
  };
}

export function transferAllLootItems(
  containerItems: Partial<Inventory>,
  inventory: Inventory
): {
  taken: Partial<Inventory>;
  nextContainerItems: Partial<Inventory>;
  nextInventory: Inventory;
} {
  const taken: Partial<Inventory> = {};
  const nextInventory: Inventory = { ...inventory };
  for (const entry of extractLootEntries(containerItems)) {
    taken[entry.item] = (taken[entry.item] ?? 0) + entry.qty;
    nextInventory[entry.item] = (nextInventory[entry.item] ?? 0) + entry.qty;
  }
  return {
    taken,
    nextContainerItems: {},
    nextInventory,
  };
}

export function enqueuePickupNotifications(
  queue: PickupNotification[],
  items: Partial<Inventory>,
  nextIdRef: { nextId: number },
  source?: string
): PickupNotification[] {
  const next = queue.map((n) => ({ ...n }));
  for (const entry of extractLootEntries(items)) {
    const existing = next.find((n) => n.item === entry.item && n.age < 1.1 && n.source === source);
    if (existing) {
      existing.qty += entry.qty;
      existing.age = 0;
      continue;
    }
    const meta = ITEMS[entry.item];
    next.unshift({
      id: nextIdRef.nextId++,
      item: entry.item,
      qty: entry.qty,
      name: meta.name,
      color: meta.color,
      source,
      age: 0,
      duration: PICKUP_TOAST_DURATION,
    });
  }
  return next.slice(0, MAX_PICKUP_NOTIFICATIONS);
}

export function tickPickupNotifications(queue: PickupNotification[], dt: number): PickupNotification[] {
  if (queue.length === 0) return queue;
  const result: PickupNotification[] = [];
  for (const n of queue) {
    const age = n.age + dt;
    if (age < n.duration) {
      result.push({ ...n, age });
    }
  }
  return result;
}

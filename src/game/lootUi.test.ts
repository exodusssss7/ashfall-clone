import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialInventory } from './survivalLogic';
import {
  buildActiveLootContainer,
  enqueuePickupNotifications,
  extractLootEntries,
  getPrimaryLootItem,
  MAX_PICKUP_NOTIFICATIONS,
  PICKUP_TOAST_DURATION,
  tickPickupNotifications,
  transferAllLootItems,
  transferSingleLootItem,
} from './lootUi';

test('extractLootEntries sorts loot consistently and excludes zero counts', () => {
  const entries = extractLootEntries({ wood: 3, ammo_9mm: 8, scrap: 0, bandage: 1 });
  assert.deepEqual(entries, [
    { item: 'ammo_9mm', qty: 8 },
    { item: 'bandage', qty: 1 },
    { item: 'wood', qty: 3 },
  ]);
  assert.equal(getPrimaryLootItem({ wood: 2, ammo_shell: 4 }), 'ammo_shell');
});

test('transferSingleLootItem and transferAllLootItems move items cleanly into inventory', () => {
  const inv = createInitialInventory();
  const chest = { ammo_9mm: 6, food: 2, bandage: 1 };

  const single = transferSingleLootItem(chest, inv, 'ammo_9mm');
  assert.equal(single.takenQty, 6);
  assert.equal(single.nextInventory.ammo_9mm, inv.ammo_9mm + 6);
  assert.equal(single.isEmpty, false);
  assert.equal(single.nextContainerItems.ammo_9mm, undefined);

  const all = transferAllLootItems(single.nextContainerItems, single.nextInventory);
  assert.deepEqual(all.taken, { food: 2, bandage: 1 });
  assert.equal(all.nextInventory.food, inv.food + 2);
  assert.equal(all.nextInventory.bandage, inv.bandage + 1);
  assert.deepEqual(all.nextContainerItems, {});
});

test('buildActiveLootContainer maps container kind metadata accurately', () => {
  const active = buildActiveLootContainer('container', 'c_1', 'med_cabinet', { bandage: 2, water: 1 });
  assert.equal(active.title, 'MEDICAL CABINET');
  assert.equal(active.entries.length, 2);
  assert.equal(active.entries[0].item, 'bandage');
});

test('enqueuePickupNotifications merges recent identical pickups, caps stack, and expires on tick', () => {
  const ref = { nextId: 1 };
  let q = enqueuePickupNotifications([], { ammo_9mm: 4, wood: 2 }, ref, 'Supply Crate');
  assert.equal(q.length, 2);

  // Recent identical pickup from same source stacks quantity cleanly
  q = enqueuePickupNotifications(q, { ammo_9mm: 3 }, ref, 'Supply Crate');
  const ammoToast = q.find((n) => n.item === 'ammo_9mm');
  assert.equal(ammoToast?.qty, 7);

  // Stack cap enforced
  q = enqueuePickupNotifications(
    q,
    { scrap: 1, cloth: 2, fuel: 1, bandage: 1, food: 2, water: 1 },
    ref,
    'Loot'
  );
  assert.equal(q.length, MAX_PICKUP_NOTIFICATIONS);

  // Expiry on tick
  q = tickPickupNotifications(q, PICKUP_TOAST_DURATION + 0.1);
  assert.equal(q.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOTBAR_ROW_SIZE,
  HOTBAR_TOTAL_SLOTS,
  assignHotbarSlot,
  clearHotbarSlot,
  countRowAssignedSlots,
  createDefaultHotbarState,
  getSlotIndexForKeyCode,
  getSlotKeyLabel,
  resetHotbarState,
  sanitizeHotbarState,
  swapHotbarSlots,
  toggleHotbarExpanded,
} from './hotbarSystem';

test('default hotbar has 14 slots (7 primary + 7 collapsible) and starts collapsed', () => {
  const state = createDefaultHotbarState();
  assert.equal(state.slots.length, HOTBAR_TOTAL_SLOTS);
  assert.equal(HOTBAR_TOTAL_SLOTS, HOTBAR_ROW_SIZE * 2);
  assert.equal(state.expanded, false);
  assert.equal(countRowAssignedSlots(state, 1), 7);
  assert.equal(countRowAssignedSlots(state, 2), 7);
});

test('expanding and collapsing row 2 preserves every assigned slot without data loss', () => {
  let state = createDefaultHotbarState();
  state = assignHotbarSlot(state, 11, { kind: 'consumable', id: 'fish_stew' });
  state = assignHotbarSlot(state, 13, { kind: 'tool', id: 'campfire' });
  const snapshotBeforeCollapse = JSON.stringify(state.slots);

  const expanded = toggleHotbarExpanded(state, true);
  assert.equal(expanded.expanded, true);
  assert.equal(JSON.stringify(expanded.slots), snapshotBeforeCollapse);

  const collapsed = toggleHotbarExpanded(expanded, false);
  assert.equal(collapsed.expanded, false);
  assert.equal(JSON.stringify(collapsed.slots), snapshotBeforeCollapse);
  assert.deepEqual(collapsed.slots[11], { kind: 'consumable', id: 'fish_stew' });
  assert.deepEqual(collapsed.slots[13], { kind: 'tool', id: 'campfire' });

  const reopened = toggleHotbarExpanded(collapsed);
  assert.equal(reopened.expanded, true);
  assert.deepEqual(reopened.slots[11], { kind: 'consumable', id: 'fish_stew' });
  assert.deepEqual(reopened.slots[13], { kind: 'tool', id: 'campfire' });
});

test('assignHotbarSlot supports weapons, consumables, and tools and moves existing duplicates', () => {
  let state = createDefaultHotbarState();
  // Assign axe (initially in Row 2 slot 9) into Row 1 slot 0
  state = assignHotbarSlot(state, 0, { kind: 'weapon', id: 'axe' });
  assert.deepEqual(state.slots[0], { kind: 'weapon', id: 'axe' });
  assert.equal(state.slots[9], null);

  // Assign cooked_fish consumable and flashlight tool
  state = assignHotbarSlot(state, 9, { kind: 'consumable', id: 'cooked_fish' });
  state = assignHotbarSlot(state, 5, { kind: 'tool', id: 'flashlight' });
  assert.deepEqual(state.slots[9], { kind: 'consumable', id: 'cooked_fish' });
  assert.deepEqual(state.slots[5], { kind: 'tool', id: 'flashlight' });
  assert.equal(state.slots[13], null); // Flashlight moved cleanly from slot 13
});

test('swapHotbarSlots swaps across Row 1 and Row 2 including empty slots', () => {
  let state = createDefaultHotbarState();
  const s0 = state.slots[0];
  const s10 = state.slots[10];
  state = swapHotbarSlots(state, 0, 10);
  assert.deepEqual(state.slots[0], s10);
  assert.deepEqual(state.slots[10], s0);

  state = clearHotbarSlot(state, 10);
  assert.equal(state.slots[10], null);
  state = swapHotbarSlots(state, 1, 10);
  assert.equal(state.slots[1], null);
  assert.deepEqual(state.slots[10], { kind: 'weapon', id: 'pistol' });
});

test('sanitizeHotbarState recovers safely from corrupt data and deduplicates items', () => {
  const recovered = sanitizeHotbarState({
    expanded: true,
    slots: [
      { kind: 'weapon', id: 'shotgun' },
      { kind: 'weapon', id: 'shotgun' }, // duplicate
      { kind: 'consumable', id: 'bogus_item' }, // invalid
      null,
      { kind: 'tool', id: 'barricade' },
    ],
  });
  assert.equal(recovered.expanded, true);
  assert.equal(recovered.slots.length, 14);
  assert.deepEqual(recovered.slots[0], { kind: 'weapon', id: 'shotgun' });
  assert.equal(recovered.slots[1], null);
  assert.equal(recovered.slots[2], null);
  assert.equal(recovered.slots[3], null);
  assert.deepEqual(recovered.slots[4], { kind: 'tool', id: 'barricade' });
});

test('keybind mappings cover Row 1 (1..7) and Row 2 (8..], Shift+1..7)', () => {
  assert.equal(getSlotIndexForKeyCode('Digit1'), 0);
  assert.equal(getSlotIndexForKeyCode('Digit7'), 6);
  assert.equal(getSlotIndexForKeyCode('Digit8'), 7);
  assert.equal(getSlotIndexForKeyCode('BracketRight'), 13);
  assert.equal(getSlotIndexForKeyCode('Digit1', true), 7);
  assert.equal(getSlotIndexForKeyCode('Digit7', true), 13);
  assert.equal(getSlotKeyLabel(0), '1');
  assert.equal(getSlotKeyLabel(13), ']');

  const reset = resetHotbarState(true, true);
  assert.equal(reset.expanded, true);
  assert.deepEqual(reset.slots[0], { kind: 'weapon', id: 'crowbar' });
});

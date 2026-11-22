import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  X,
  Hammer,
  Backpack,
  Heart,
  Droplet,
  Utensils,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  GripVertical,
} from 'lucide-react';
import { ItemIcon } from './ItemIcon';
import { HotbarDragGhost, getHotbarSlotMeta } from './HotbarSlotView';
import {
  HOTBAR_TOOLS,
  createDefaultHotbarState,
  describeHotbarEntry,
  findAssignedSlotIndex,
  getSlotKeyLabel,
  type HotbarEntry,
  type HotbarToolId,
} from '../game/hotbarSystem';
import { CRAFT_RECIPES, ITEMS, STRUCTURES, WEAPONS } from '../game/recipes';
import { canAffordCost } from '../game/survivalLogic';
import type {
  ConsumableItemId,
  HudSnapshot,
  ItemId,
  StructureKind,
  WeaponId,
} from '../game/types';

interface Props {
  hud: HudSnapshot;
  onClose: () => void;
  onCraft: (id: string) => void;
  onUseConsumable: (id: ConsumableItemId) => void;
  onSelectWeapon: (weapon: WeaponId) => void;
  onToggleBuild: (kind?: StructureKind) => void;
  onToggleFlashlight: () => void;
  onAssignHotbarSlot: (slotIndex: number, entry: HotbarEntry) => void;
  onSwapHotbarSlots: (fromIndex: number, toIndex: number) => void;
  onClearHotbarSlot: (slotIndex: number) => void;
  onToggleHotbarExpanded: (expanded?: boolean) => void;
  onResetHotbar: () => void;
}

type PackCatalogEntry =
  | { key: string; hotbarEntry: HotbarEntry; category: 'Weapons' | 'Tools' | 'Provisions' | 'Medical' | 'Combat' }
  | { key: string; itemId: ItemId; category: 'Materials' | 'Combat' };

const WEAPON_KEYS: WeaponId[] = [
  'crowbar',
  'machete',
  'barbed_bat',
  'axe',
  'sledgehammer',
  'pistol',
  'shotgun',
  'lmg',
  'molotov',
];

const TOOL_KEYS: HotbarToolId[] = [
  'build_hammer',
  'flashlight',
  'barricade',
  'spike_trap',
  'campfire',
];

const CONSUMABLE_KEYS: ConsumableItemId[] = [
  'bandage',
  'food',
  'water',
  'raw_fish',
  'cooked_fish',
  'fish_stew',
  'hot_rations',
];

const MATERIAL_KEYS: ItemId[] = ['wood', 'scrap', 'cloth', 'fuel'];
const AMMO_KEYS: ItemId[] = ['ammo_9mm', 'ammo_shell'];

const PACK_CATALOG: PackCatalogEntry[] = [
  ...WEAPON_KEYS.map((id) => ({
    key: `weapon:${id}`,
    hotbarEntry: { kind: 'weapon', id } as HotbarEntry,
    category: (id === 'molotov' ? 'Combat' : 'Weapons') as 'Weapons' | 'Combat',
  })),
  ...TOOL_KEYS.map((id) => ({
    key: `tool:${id}`,
    hotbarEntry: { kind: 'tool', id } as HotbarEntry,
    category: 'Tools' as const,
  })),
  ...CONSUMABLE_KEYS.map((id) => ({
    key: `consumable:${id}`,
    hotbarEntry: { kind: 'consumable', id } as HotbarEntry,
    category: (id === 'bandage' ? 'Medical' : 'Provisions') as 'Medical' | 'Provisions',
  })),
  ...AMMO_KEYS.map((itemId) => ({
    key: `item:${itemId}`,
    itemId,
    category: 'Combat' as const,
  })),
  ...MATERIAL_KEYS.map((itemId) => ({
    key: `item:${itemId}`,
    itemId,
    category: 'Materials' as const,
  })),
];

const CATEGORY_NAMES = ['All', 'Weapons', 'Tools', 'Provisions', 'Medical', 'Materials', 'Combat'] as const;

const ITEM_DETAILS: Record<ItemId, { kind: string; description: string; effect?: string; action?: string }> = {
  wood: { kind: 'Material', description: 'Salvaged timber for barricades, spike traps and campfires.' },
  scrap: { kind: 'Material', description: 'Metal salvage for ammunition, defenses and vehicle repairs.' },
  cloth: { kind: 'Material', description: 'Clean fabric for field bandages, firebombs and campfires.' },
  fuel: { kind: 'Material', description: 'Gasoline for vehicles, firebombs and ammunition crafting.' },
  food: { kind: 'Provision', description: 'Ready-to-eat canned supplies.', effect: '+38 Food  /  +8 HP', action: 'EAT RATIONS' },
  water: { kind: 'Provision', description: 'Purified drinking water.', effect: '+44 H2O', action: 'DRINK WATER' },
  bandage: { kind: 'Medical', description: 'Dress a wound and stop bleeding.', effect: '+35 HP  /  Stops bleeding', action: 'APPLY BANDAGE' },
  ammo_9mm: { kind: 'Ammunition', description: 'Reserve ammunition for the 9mm pistol. Reload with [R].' },
  ammo_shell: { kind: 'Ammunition', description: 'Reserve 12-gauge shells for the pump shotgun. Reload with [R].' },
  molotov: { kind: 'Throwable', description: 'Firebomb cocktail. Drag onto hotbar or equip to ignite zones.' },
  raw_fish: { kind: 'Raw provision', description: 'Best cooked near a stove or campfire. Eating raw fish reduces hydration.', effect: '+16 Food  /  -5 H2O', action: 'EAT RAW FISH' },
  cooked_fish: { kind: 'Provision', description: 'Grilled lake fish, ready to eat.', effect: '+42 Food  /  +14 HP', action: 'EAT GRILLED FISH' },
  fish_stew: { kind: 'Provision', description: 'A hearty fish stew for long nights.', effect: '+58 Food  /  +40 H2O  /  +24 HP', action: 'EAT FISH STEW' },
  hot_rations: { kind: 'Provision', description: 'A warming meal for a tired survivor.', effect: '+48 Food  /  +12 HP', action: 'EAT HOT MEAL' },
};

interface PackDragState {
  pointerId: number;
  source:
    | { type: 'catalog'; entry: HotbarEntry; key: string }
    | { type: 'dock'; fromSlot: number; entry: HotbarEntry };
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  hoverDockSlot: number | null;
  overDockOrGrid: boolean;
}

export function CraftModal({
  hud,
  onClose,
  onCraft,
  onUseConsumable,
  onSelectWeapon,
  onToggleBuild,
  onToggleFlashlight,
  onAssignHotbarSlot,
  onSwapHotbarSlots,
  onClearHotbarSlot,
  onToggleHotbarExpanded,
  onResetHotbar,
}: Props) {
  const storageRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'pack' | 'craft'>('pack');
  const [category, setCategory] = useState<(typeof CATEGORY_NAMES)[number]>('All');
  const [selectedKey, setSelectedKey] = useState<string>('consumable:food');
  const [recipeId, setRecipeId] = useState(CRAFT_RECIPES[0].id);
  const [pendingBind, setPendingBind] = useState<HotbarEntry | null>(null);
  const [dragState, setDragState] = useState<PackDragState | null>(null);
  const dragRef = useRef<PackDragState | null>(null);
  dragRef.current = dragState;

  const hotbar = hud.hotbar ?? createDefaultHotbarState();
  const visibleEntries = PACK_CATALOG.filter(
    (entry) => category === 'All' || entry.category === category
  );
  const selectedCatalog =
    PACK_CATALOG.find((e) => e.key === selectedKey) ?? PACK_CATALOG[0];
  const recipe = CRAFT_RECIPES.find((r) => r.id === recipeId) ?? CRAFT_RECIPES[0];

  useLayoutEffect(() => {
    if (storageRef.current) storageRef.current.scrollTop = 0;
  }, [tab, category]);
  useLayoutEffect(() => {
    if (detailRef.current) detailRef.current.scrollTop = 0;
  }, [tab, selectedKey, recipeId]);

  const stock = [...CONSUMABLE_KEYS, ...MATERIAL_KEYS, ...AMMO_KEYS, 'molotov' as ItemId].filter(
    (id) => hud.inventory[id] > 0
  ).length;

  useEffect(() => {
    if (!dragState) return;

    const inspectPoint = (clientX: number, clientY: number) => {
      const els = document.elementsFromPoint(clientX, clientY);
      let hoverDockSlot: number | null = null;
      let overDockOrGrid = false;
      for (const el of els) {
        if (el instanceof HTMLElement) {
          if (el.closest('.pack-hotbar-dock') || el.closest('.pack-slot-grid')) {
            overDockOrGrid = true;
          }
          const dockEl = el.closest<HTMLElement>('[data-dock-slot]');
          if (dockEl && hoverDockSlot === null) {
            const idx = Number(dockEl.dataset.dockSlot);
            if (Number.isInteger(idx)) hoverDockSlot = idx;
          }
        }
      }
      return { hoverDockSlot, overDockOrGrid };
    };

    const onPointerMove = (e: PointerEvent) => {
      const curr = dragRef.current;
      if (!curr || e.pointerId !== curr.pointerId) return;
      const dist = Math.hypot(e.clientX - curr.startX, e.clientY - curr.startY);
      const active = curr.active || dist >= 6;
      if (!active) {
        const next = { ...curr, x: e.clientX, y: e.clientY };
        dragRef.current = next;
        setDragState(next);
        return;
      }
      const { hoverDockSlot, overDockOrGrid } = inspectPoint(e.clientX, e.clientY);
      const next: PackDragState = {
        ...curr,
        active: true,
        x: e.clientX,
        y: e.clientY,
        hoverDockSlot,
        overDockOrGrid,
      };
      dragRef.current = next;
      setDragState(next);
    };

    const finishDrag = (e: PointerEvent, cancelled: boolean) => {
      const curr = dragRef.current;
      if (!curr || e.pointerId !== curr.pointerId) return;
      dragRef.current = null;
      setDragState(null);
      if (cancelled) return;
      const { hoverDockSlot, overDockOrGrid } = inspectPoint(e.clientX, e.clientY);
      if (!curr.active) {
        if (curr.source.type === 'catalog') {
          setSelectedKey(curr.source.key);
          setPendingBind(null);
        } else {
          const dockIdx = curr.source.fromSlot;
          if (pendingBind) {
            onAssignHotbarSlot(dockIdx, pendingBind);
            setPendingBind(null);
          } else {
            const slotEntry = curr.source.entry;
            setSelectedKey(`${slotEntry.kind}:${slotEntry.id}`);
          }
        }
      } else {
        setPendingBind(null);
        if (curr.source.type === 'catalog' && hoverDockSlot !== null) {
          onAssignHotbarSlot(hoverDockSlot, curr.source.entry);
        } else if (curr.source.type === 'dock') {
          if (hoverDockSlot !== null && hoverDockSlot !== curr.source.fromSlot) {
            onSwapHotbarSlots(curr.source.fromSlot, hoverDockSlot);
          } else if (!overDockOrGrid) {
            onClearHotbarSlot(curr.source.fromSlot);
          }
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => finishDrag(e, false);
    const onPointerCancel = (e: PointerEvent) => finishDrag(e, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [
    dragState?.pointerId,
    onAssignHotbarSlot,
    onClearHotbarSlot,
    onSwapHotbarSlots,
    pendingBind,
  ]);

  const chooseCategory = (value: (typeof CATEGORY_NAMES)[number]) => {
    setCategory(value);
    const nextList = PACK_CATALOG.filter((e) => value === 'All' || e.category === value);
    if (nextList.length > 0 && !nextList.some((e) => e.key === selectedKey)) {
      setSelectedKey(nextList[0].key);
    }
  };

  const renderTileBadge = (item: PackCatalogEntry): { icon: string; name: string; count: string; empty: boolean } => {
    if ('hotbarEntry' in item) {
      const e = item.hotbarEntry;
      const desc = describeHotbarEntry(e);
      if (e.kind === 'weapon') {
        let count = 'INF';
        let empty = false;
        if (e.id === 'pistol') count = `${hud.pistolMag}/${hud.inventory.ammo_9mm}`;
        if (e.id === 'shotgun') count = `${hud.shotgunMag}/${hud.inventory.ammo_shell}`;
        if (e.id === 'molotov') {
          count = `${hud.inventory.molotov}`;
          empty = hud.inventory.molotov <= 0;
        }
        return { icon: desc.icon, name: desc.shortName, count, empty };
      }
      if (e.kind === 'consumable') {
        const qty = hud.inventory[e.id] ?? 0;
        return { icon: desc.icon, name: desc.shortName, count: `${qty}`, empty: qty <= 0 };
      }
      return { icon: desc.icon, name: desc.shortName, count: 'TOOL', empty: false };
    }
    const qty = hud.inventory[item.itemId] ?? 0;
    return {
      icon: item.itemId,
      name: ITEMS[item.itemId].short,
      count: `${qty}`,
      empty: qty <= 0,
    };
  };

  const renderDetailPanel = () => {
    if ('hotbarEntry' in selectedCatalog) {
      const e = selectedCatalog.hotbarEntry;
      const boundIdx = findAssignedSlotIndex(hotbar, e);
      const boundLabel = boundIdx >= 0 ? `SLOT [${getSlotKeyLabel(boundIdx)}]` : 'UNBOUND';
      const isPendingBind =
        pendingBind !== null && pendingBind.kind === e.kind && pendingBind.id === e.id;

      if (e.kind === 'weapon') {
        const spec = WEAPONS[e.id];
        const qtyText =
          e.id === 'molotov'
            ? `${hud.inventory.molotov}`
            : e.id === 'pistol'
              ? `${hud.pistolMag} + ${hud.inventory.ammo_9mm}`
              : e.id === 'shotgun'
                ? `${hud.shotgunMag} + ${hud.inventory.ammo_shell}`
                : 'REUSABLE';
        return (
          <>
            <div ref={detailRef} className="pack-detail-content">
              <div className="pack-detail-kind">
                {spec.isMelee ? 'MELEE WEAPON' : e.id === 'molotov' ? 'THROWABLE' : 'FIREARM'} · {boundLabel}
              </div>
              <div className="pack-detail-art">
                <ItemIcon kind={e.id} />
              </div>
              <h3>{spec.name}</h3>
              <div className="pack-owned">
                STOCK <b>{qtyText}</b>
              </div>
              <p>
                {e.id === 'molotov'
                  ? 'Glass firebomb that ignites a burning zone on impact. Drag onto any hotbar slot for quick access.'
                  : `${spec.isMelee ? 'Close-quarters melee weapon' : 'Ranged survival firearm'} with ${spec.damage} base damage and ${spec.range.toFixed(1)}m reach.`}
              </p>
              <div className="pack-effect">
                DMG {spec.damage} / REACH {spec.range.toFixed(1)}m / CD {spec.cooldown.toFixed(2)}s
              </div>
            </div>
            <div className="pack-detail-action flex flex-col gap-1.5">
              <button
                type="button"
                className="pack-primary"
                disabled={e.id === 'molotov' && hud.inventory.molotov <= 0}
                onClick={() => {
                  onSelectWeapon(e.id);
                  onClose();
                }}
              >
                {hud.equippedWeapon === e.id ? 'EQUIPPED' : 'EQUIP WEAPON'}
              </button>
              <button
                type="button"
                className={`pack-bind-btn ${isPendingBind ? 'is-armed' : ''}`}
                onClick={() => setPendingBind(isPendingBind ? null : e)}
              >
                {isPendingBind ? 'TAP A HOTBAR SLOT BELOW...' : 'BIND TO HOTBAR SLOT'}
              </button>
            </div>
          </>
        );
      }

      if (e.kind === 'tool') {
        const meta = HOTBAR_TOOLS[e.id];
        return (
          <>
            <div ref={detailRef} className="pack-detail-content">
              <div className="pack-detail-kind">SURVIVAL TOOL · {boundLabel}</div>
              <div className="pack-detail-art">
                <ItemIcon kind={meta.icon} />
              </div>
              <h3>{meta.name}</h3>
              <div className="pack-owned">
                STATUS{' '}
                <b>
                  {e.id === 'flashlight'
                    ? `${hud.battery}% (${hud.flashlightOn ? 'ON' : 'OFF'})`
                    : e.id === 'build_hammer'
                      ? hud.buildMode
                        ? 'ACTIVE'
                        : 'READY'
                      : canAffordCost(hud.inventory, STRUCTURES[e.id].cost)
                        ? 'READY'
                        : 'NEED MATS'}
                </b>
              </div>
              <p>{meta.description}</p>
              <div className="pack-effect">{meta.effect}</div>
            </div>
            <div className="pack-detail-action flex flex-col gap-1.5">
              <button
                type="button"
                className="pack-primary"
                onClick={() => {
                  if (e.id === 'flashlight') onToggleFlashlight();
                  else if (e.id === 'build_hammer') {
                    onToggleBuild();
                    onClose();
                  } else {
                    onToggleBuild(e.id);
                    onClose();
                  }
                }}
              >
                {e.id === 'flashlight'
                  ? hud.flashlightOn
                    ? 'TURN LIGHT OFF'
                    : 'TURN LIGHT ON'
                  : e.id === 'build_hammer'
                    ? 'TOGGLE BUILD MODE'
                    : 'PLACE STRUCTURE'}
              </button>
              <button
                type="button"
                className={`pack-bind-btn ${isPendingBind ? 'is-armed' : ''}`}
                onClick={() => setPendingBind(isPendingBind ? null : e)}
              >
                {isPendingBind ? 'TAP A HOTBAR SLOT BELOW...' : 'BIND TO HOTBAR SLOT'}
              </button>
            </div>
          </>
        );
      }

      // Consumable
      const detail = ITEM_DETAILS[e.id];
      const item = ITEMS[e.id];
      return (
        <>
          <div ref={detailRef} className="pack-detail-content">
            <div className="pack-detail-kind">
              {detail.kind} · {boundLabel}
            </div>
            <div className="pack-detail-art">
              <ItemIcon kind={e.id} />
            </div>
            <h3>{item.name}</h3>
            <div className="pack-owned">
              CARRIED <b>{hud.inventory[e.id]}</b>
            </div>
            <p>{detail.description}</p>
            {detail.effect && <div className="pack-effect">{detail.effect}</div>}
          </div>
          <div className="pack-detail-action flex flex-col gap-1.5">
            <button
              type="button"
              className="pack-primary"
              disabled={hud.inventory[e.id] <= 0}
              onClick={() => onUseConsumable(e.id)}
            >
              {detail.action}
            </button>
            <button
              type="button"
              className={`pack-bind-btn ${isPendingBind ? 'is-armed' : ''}`}
              onClick={() => setPendingBind(isPendingBind ? null : e)}
            >
              {isPendingBind ? 'TAP A HOTBAR SLOT BELOW...' : 'BIND TO HOTBAR SLOT'}
            </button>
          </div>
        </>
      );
    }

    // Non-assignable crafting resource / ammo
    const item = ITEMS[selectedCatalog.itemId];
    const detail = ITEM_DETAILS[selectedCatalog.itemId];
    return (
      <>
        <div ref={detailRef} className="pack-detail-content">
          <div className="pack-detail-kind">{detail.kind}</div>
          <div className="pack-detail-art">
            <ItemIcon kind={selectedCatalog.itemId} />
          </div>
          <h3>{item.name}</h3>
          <div className="pack-owned">
            CARRIED <b>{hud.inventory[selectedCatalog.itemId]}</b>
          </div>
          <p>{detail.description}</p>
        </div>
        <div className="pack-detail-action">
          <div className="pack-passive">Crafting resource or ammunition reserve.</div>
        </div>
      </>
    );
  };

  const renderDockRow = (indices: number[], rowLabel: string) => (
    <div className="pack-dock-row" role="group" aria-label={rowLabel}>
      <span className="pack-dock-row-tag">{rowLabel}</span>
      <div className="pack-dock-slots">
        {indices.map((slotIndex) => {
          const entry = hotbar.slots[slotIndex] ?? null;
          const keyLabel = getSlotKeyLabel(slotIndex);
          const meta = getHotbarSlotMeta(entry, hud, false);
          const isDropHover = dragState?.active && dragState.hoverDockSlot === slotIndex;
          const isDragSource =
            dragState?.active &&
            dragState.source.type === 'dock' &&
            dragState.source.fromSlot === slotIndex;

          return (
            <div
              key={slotIndex}
              data-dock-slot={slotIndex}
              className={`pack-dock-slot-wrap ${isDropHover ? 'is-drop-target' : ''} ${
                isDragSource ? 'is-dragging' : ''
              } ${pendingBind ? 'is-bind-armed' : ''}`}
            >
              <button
                type="button"
                aria-label={
                  entry
                    ? `${meta.shortLabel} in hotbar slot ${keyLabel}`
                    : `Empty hotbar slot ${keyLabel}`
                }
                onPointerDown={(e) => {
                  if (e.button > 0) return;
                  e.preventDefault();
                  if (pendingBind) {
                    onAssignHotbarSlot(slotIndex, pendingBind);
                    setPendingBind(null);
                    return;
                  }
                  if (!entry) return;
                  const initial: PackDragState = {
                    pointerId: e.pointerId,
                    source: { type: 'dock', fromSlot: slotIndex, entry },
                    startX: e.clientX,
                    startY: e.clientY,
                    x: e.clientX,
                    y: e.clientY,
                    active: false,
                    hoverDockSlot: slotIndex,
                    overDockOrGrid: true,
                  };
                  dragRef.current = initial;
                  setDragState(initial);
                }}
                className={`pack-dock-slot touch-none ${
                  entry ? 'is-filled' : 'is-empty'
                } ${meta.isActive ? 'is-active' : ''}`}
              >
                <span className="pack-dock-key">[{keyLabel}]</span>
                {entry ? (
                  <>
                    <ItemIcon kind={meta.icon} />
                    <span className="pack-dock-name">{meta.shortLabel}</span>
                  </>
                ) : (
                  <span className="pack-dock-empty">EMPTY</span>
                )}
              </button>
              {entry && (
                <button
                  type="button"
                  aria-label={`Clear slot ${keyLabel}`}
                  title={`Unbind [${keyLabel}]`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearHotbarSlot(slotIndex);
                  }}
                  className="pack-dock-clear"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="pack-backdrop fixed inset-0 z-30 flex items-center justify-center bg-black/65">
      <div role="dialog" aria-label="Backpack and Crafting Workbench" className="pack-dialog hud-panel">
        <header className="pack-header">
          <div className="pack-heading">
            <Backpack />
            <div>
              <h2>FIELD PACK</h2>
              <p>
                DAY {hud.day} / {hud.timeLabel} / {stock} stocked item types
              </p>
            </div>
          </div>
          <div className="pack-tabs" role="tablist" aria-label="Backpack sections">
            <button role="tab" aria-selected={tab === 'pack'} onClick={() => setTab('pack')}>
              <Backpack />
              ITEMS &amp; HOTBAR
            </button>
            <button role="tab" aria-selected={tab === 'craft'} onClick={() => setTab('craft')}>
              <Hammer />
              CRAFT
            </button>
          </div>
          <button type="button" className="pack-close" aria-label="Close Backpack" onClick={onClose}>
            <X />
          </button>
        </header>

        <div className="pack-body">
          <aside className="pack-survivor">
            <div className="pack-survivor-title">SURVIVOR</div>
            <img
              className="pack-portrait"
              src={`${import.meta.env.BASE_URL}ui/survivor.svg`}
              alt="Pixel-art survivor"
            />
            <div className="pack-vital">
              <Heart />
              <span>HEALTH</span>
              <b>{Math.round(hud.hp)}</b>
              <i style={{ width: `${hud.hp}%` }} />
            </div>
            <div className="pack-vital">
              <Utensils />
              <span>FOOD</span>
              <b>{Math.round(hud.hunger)}</b>
              <i style={{ width: `${hud.hunger}%` }} />
            </div>
            <div className="pack-vital">
              <Droplet />
              <span>H2O</span>
              <b>{Math.round(hud.thirst)}</b>
              <i style={{ width: `${hud.thirst}%` }} />
            </div>
            <div className="pack-equipped">
              <span>IN HAND</span>
              <ItemIcon kind={hud.equippedWeapon} />
              <strong>{WEAPONS[hud.equippedWeapon].name}</strong>
            </div>
          </aside>

          {tab === 'pack' ? (
            <>
              <div className="pack-center-col">
                <section ref={storageRef} key="items" className="pack-storage" aria-label="Carried items and gear">
                  <nav className="pack-filters" aria-label="Item categories">
                    {CATEGORY_NAMES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={category === c}
                        onClick={() => chooseCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </nav>

                  <div className="pack-slot-grid">
                    {visibleEntries.map((item) => {
                      const badge = renderTileBadge(item);
                      const isAssignable = 'hotbarEntry' in item;
                      const assignedIdx = isAssignable
                        ? findAssignedSlotIndex(hotbar, item.hotbarEntry)
                        : -1;
                      const isSelected = selectedCatalog.key === item.key;

                      return (
                        <button
                          type="button"
                          key={item.key}
                          data-item={item.key}
                          data-pack-assignable={isAssignable ? 'true' : 'false'}
                          className={`pack-item-slot touch-none ${isSelected ? 'is-selected' : ''} ${
                            badge.empty ? 'is-empty' : ''
                          } ${isAssignable ? 'cursor-grab' : ''}`}
                          aria-label={`${badge.name}, ${badge.count}${
                            assignedIdx >= 0 ? `, hotbar slot ${getSlotKeyLabel(assignedIdx)}` : ''
                          }`}
                          aria-pressed={isSelected}
                          onPointerDown={(e) => {
                            if (e.button > 0) return;
                            if (!isAssignable || !('hotbarEntry' in item)) {
                              setSelectedKey(item.key);
                              setPendingBind(null);
                              return;
                            }
                            e.preventDefault();
                            const initial: PackDragState = {
                              pointerId: e.pointerId,
                              source: { type: 'catalog', entry: item.hotbarEntry, key: item.key },
                              startX: e.clientX,
                              startY: e.clientY,
                              x: e.clientX,
                              y: e.clientY,
                              active: false,
                              hoverDockSlot: null,
                              overDockOrGrid: true,
                            };
                            dragRef.current = initial;
                            setDragState(initial);
                          }}
                        >
                          {assignedIdx >= 0 && (
                            <span className="pack-slot-hotkey">[{getSlotKeyLabel(assignedIdx)}]</span>
                          )}
                          {isAssignable && (
                            <GripVertical className="pack-slot-grip" aria-hidden="true" />
                          )}
                          <ItemIcon kind={badge.icon} />
                          <span className="pack-slot-name">{badge.name}</span>
                          <b className="pack-slot-count">{badge.count}</b>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Interactive 2-Row Hotbar Management Dock */}
                <section
                  data-testid="pack-hotbar-dock"
                  className="pack-hotbar-dock"
                  aria-label="Hotbar Loadout Dock"
                >
                  <div className="pack-dock-header">
                    <div className="pack-dock-title">
                      <strong>HOTBAR LOADOUT</strong>
                      <span>
                        {pendingBind
                          ? 'Click any slot below to assign selected item'
                          : 'Drag weapons, consumables, or tools into any slot'}
                      </span>
                    </div>
                    <div className="pack-dock-actions">
                      <button
                        type="button"
                        onClick={() => onToggleHotbarExpanded()}
                        className="pack-dock-btn"
                        aria-expanded={hotbar.expanded}
                        title="Toggle HUD Row 2 Visibility"
                      >
                        {hotbar.expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                        <span>ROW 2: {hotbar.expanded ? 'ON' : 'OFF'}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="pack-reset-hotbar"
                        onClick={() => {
                          setPendingBind(null);
                          onResetHotbar();
                        }}
                        className="pack-dock-btn"
                        title="Reset all 14 slots to default loadout"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>RESET KIT</span>
                      </button>
                    </div>
                  </div>

                  {renderDockRow([7, 8, 9, 10, 11, 12, 13], 'R2')}
                  {renderDockRow([0, 1, 2, 3, 4], 'R1')}
                </section>
              </div>

              <aside className="pack-details" aria-label="Selected item">
                {renderDetailPanel()}
              </aside>
            </>
          ) : (
            <>
              <section
                ref={storageRef}
                key="workbench"
                className="pack-storage pack-workbench"
                aria-label="Crafting recipes"
              >
                <div className="pack-section-heading">
                  <div>
                    <strong>WORKBENCH</strong>
                    <span>Medical supplies, munitions &amp; defenses</span>
                  </div>
                  <b>{CRAFT_RECIPES.filter((r) => canAffordCost(hud.inventory, r.cost)).length} READY</b>
                </div>
                <div className="pack-recipe-list">
                  {CRAFT_RECIPES.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      aria-pressed={r.id === recipe.id}
                      className={`pack-recipe ${r.id === recipe.id ? 'is-selected' : ''}`}
                      onClick={() => setRecipeId(r.id)}
                    >
                      <ItemIcon kind={r.outputItem ?? r.outputStructure ?? 'build'} />
                      <span>
                        <strong>{r.name}</strong>
                        <small>{r.category === 'structure' ? 'DEFENSE' : r.category.toUpperCase()}</small>
                      </span>
                      <i className={canAffordCost(hud.inventory, r.cost) ? 'ready' : 'needs'}>
                        {canAffordCost(hud.inventory, r.cost) ? 'READY' : 'NEED ITEMS'}
                      </i>
                    </button>
                  ))}
                </div>
                <div className="pack-grid-note">Choose a blueprint. Required materials are shown on the right.</div>
              </section>
              <aside className="pack-details" aria-label="Selected recipe">
                <div ref={detailRef} className="pack-detail-content">
                  <div className="pack-detail-kind">WORKBENCH / {recipe.category}</div>
                  <div className="pack-detail-art">
                    <ItemIcon kind={recipe.outputItem ?? recipe.outputStructure ?? 'build'} />
                  </div>
                  <h3>{recipe.name}</h3>
                  <p>{recipe.description}</p>
                  <div className="pack-cost-label">MATERIALS / CARRIED : NEEDED</div>
                  <div className="pack-costs">
                    {Object.entries(recipe.cost).map(([id, n]) => (
                      <div
                        key={id}
                        className={hud.inventory[id as ItemId] >= n ? 'has-cost' : 'missing-cost'}
                      >
                        <ItemIcon kind={id} />
                        <span>{ITEMS[id as ItemId].short}</span>
                        <b>
                          {hud.inventory[id as ItemId]} / {n}
                        </b>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pack-detail-action">
                  <button
                    type="button"
                    className="pack-primary"
                    disabled={!canAffordCost(hud.inventory, recipe.cost)}
                    onClick={() => onCraft(recipe.id)}
                  >
                    {recipe.outputStructure
                      ? 'PLACE IN WORLD'
                      : `CRAFT${recipe.outputAmount ? ` x${recipe.outputAmount}` : ''}`}
                  </button>
                </div>
              </aside>
            </>
          )}
        </div>

        <footer className="pack-footer">
          <span>
            {tab === 'pack'
              ? 'DRAG GEAR OR ITEMS TO HOTBAR SLOTS BELOW'
              : 'WORKBENCH / SELECT A BLUEPRINT'}
          </span>
          <span>
            Close Pack <b>[I]</b>
          </span>
        </footer>
      </div>

      {dragState?.active && (
        <HotbarDragGhost
          entry={
            dragState.source.type === 'catalog' ? dragState.source.entry : dragState.source.entry
          }
          x={dragState.x}
          y={dragState.y}
          hint={
            dragState.hoverDockSlot !== null
              ? dragState.source.type === 'dock'
                ? `Swap → [${getSlotKeyLabel(dragState.hoverDockSlot)}]`
                : `Assign → [${getSlotKeyLabel(dragState.hoverDockSlot)}]`
              : dragState.source.type === 'dock' && !dragState.overDockOrGrid
                ? 'Drop to Unbind'
                : 'Drag onto Dock Slot'
          }
        />
      )}
    </div>
  );
}

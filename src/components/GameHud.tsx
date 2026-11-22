import { getActionCues, actionCueProps, canCookAnything } from '../game/actionAlerts';
import {
  countRowAssignedSlots,
  findAssignedSlotIndex,
  getSlotKeyLabel,
  type HotbarEntry,
  type HotbarSlotValue,
} from '../game/hotbarSystem';
import { ItemIcon } from './ItemIcon';
import { HotbarDragGhost, ToolCornerMark, getHotbarSlotMeta } from './HotbarSlotView';
import { useHudDrag } from './useHudDrag';
import { applyButtonScales } from '../game/hudLayout';
import React, { useEffect, useRef, useState } from 'react';
import {
  Backpack,
  Car,
  ChevronDown,
  ChevronUp,
  CloudFog,
  CloudLightning,
  CloudRain,
  Eye,
  Flame,
  Clock3,
  Mountain,
  ShieldCheck,
  Skull,
  Thermometer,
  Utensils,
  Droplet,
  Droplets,
  Flashlight,
  Fuel,
  Gamepad2,
  Pause,
  Siren,
  SlidersHorizontal,
  Wrench,
  Zap,
} from 'lucide-react';
import { STRUCTURES, WEAPONS } from '../game/recipes';
import { canAffordCost, pickBestFoodConsumable } from '../game/survivalLogic';
import type { ConsumableItemId, HudSnapshot, StructureKind } from '../game/types';

interface HudDragState {
  pointerId: number;
  fromIndex: number;
  entry: HotbarEntry;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  hoverSlot: number | null;
  overHotbar: boolean;
}

interface GameHudProps {
  hud: HudSnapshot;
  muted: boolean;
  craftOpen: boolean;
  cookOpen: boolean;
  touchEnabled: boolean;
  editing: boolean;
  minimapRef: React.RefObject<HTMLCanvasElement | null>;
  onToggleBuild: (kind?: StructureKind) => void;
  onUseConsumable: (item: ConsumableItemId) => void;
  onToggleCraft: () => void;
  onToggleCook: () => void;
  onToggleTouch: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onPause: () => void;
  onRestart: () => void;
  onEnterExitVehicle: () => void;
  onToggleHeadlights: () => void;
  onHorn: () => void;
  onRefuel: () => void;
  onRepairVehicle: () => void;
  onPrimaryInteract: () => void;
  onBarricadeDoor: () => void;
  onOpenNavigation: () => void;
  onEditHud: () => void;
  onActivateHotbarSlot: (slotIndex: number) => void;
  onToggleHotbarExpanded: (expanded?: boolean) => void;
  onSwapHotbarSlots: (fromIndex: number, toIndex: number) => void;
  onClearHotbarSlot: (slotIndex: number) => void;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  craftOpen,
  cookOpen,
  touchEnabled,
  editing,
  minimapRef,
  onToggleBuild,
  onUseConsumable,
  onToggleCraft,
  onToggleCook,
  onToggleTouch,
  onToggleCamera,
  onPause,
  onEnterExitVehicle,
  onToggleHeadlights,
  onHorn,
  onRefuel,
  onRepairVehicle,
  onPrimaryInteract,
  onBarricadeDoor,
  onOpenNavigation,
  onEditHud,
  onActivateHotbarSlot,
  onToggleHotbarExpanded,
  onSwapHotbarSlots,
  onClearHotbarSlot,
}) => {
  const [dragState, setDragState] = useState<HudDragState | null>(null);
  const dragRef = useRef<HudDragState | null>(null);
  dragRef.current = dragState;
  const expandHoverTimerRef = useRef<number | null>(null);
  const expandedRef = useRef(Boolean(hud.hotbar?.expanded));
  expandedRef.current = Boolean(hud.hotbar?.expanded);

  // Saved per-button sizes (Edit HUD corner-drag) ride on data-btn-id attributes.
  useEffect(() => {
    applyButtonScales(document.documentElement);
  });

  useEffect(() => {
    const activeBtn = document.querySelector<HTMLElement>(
      `.equipment-bar > button[data-hotbar-active="true"]`
    );
    activeBtn?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [hud.equippedWeapon, hud.buildMode]);

  useEffect(() => {
    if (!dragState) return;

    const clearExpandTimer = () => {
      if (expandHoverTimerRef.current !== null) {
        window.clearTimeout(expandHoverTimerRef.current);
        expandHoverTimerRef.current = null;
      }
    };

    const inspectPoint = (clientX: number, clientY: number) => {
      const els = document.elementsFromPoint(clientX, clientY);
      let hoverSlot: number | null = null;
      let overExpand = false;
      let overHotbar = false;
      for (const el of els) {
        if (el instanceof HTMLElement) {
          if (el.closest('.hotbar-rows')) overHotbar = true;
          const slotEl = el.closest<HTMLElement>('[data-hotbar-slot]');
          if (slotEl && hoverSlot === null) {
            const parsed = Number(slotEl.dataset.hotbarSlot);
            if (Number.isInteger(parsed)) hoverSlot = parsed;
          }
          if (el.closest('[data-hotbar-expand]')) overExpand = true;
        }
      }
      return { hoverSlot, overExpand, overHotbar };
    };

    const onPointerMove = (e: PointerEvent) => {
      const curr = dragRef.current;
      if (!curr || e.pointerId !== curr.pointerId) return;
      const distMoved = Math.hypot(e.clientX - curr.startX, e.clientY - curr.startY);
      const active = curr.active || distMoved >= 6;
      if (!active) {
        const next = { ...curr, x: e.clientX, y: e.clientY };
        dragRef.current = next;
        setDragState(next);
        return;
      }
      const { hoverSlot, overExpand, overHotbar } = inspectPoint(e.clientX, e.clientY);
      if (overExpand && !expandedRef.current) {
        if (expandHoverTimerRef.current === null) {
          expandHoverTimerRef.current = window.setTimeout(() => {
            expandHoverTimerRef.current = null;
            onToggleHotbarExpanded(true);
          }, 180);
        }
      } else {
        clearExpandTimer();
      }
      const next: HudDragState = {
        ...curr,
        active: true,
        x: e.clientX,
        y: e.clientY,
        hoverSlot,
        overHotbar,
      };
      dragRef.current = next;
      setDragState(next);
    };

    const finishDrag = (e: PointerEvent, cancelled: boolean) => {
      const curr = dragRef.current;
      if (!curr || e.pointerId !== curr.pointerId) return;
      clearExpandTimer();
      dragRef.current = null;
      setDragState(null);
      if (cancelled) return;
      const { hoverSlot, overHotbar } = inspectPoint(e.clientX, e.clientY);
      if (!curr.active) {
        onActivateHotbarSlot(curr.fromIndex);
      } else if (hoverSlot !== null && hoverSlot !== curr.fromIndex) {
        onSwapHotbarSlots(curr.fromIndex, hoverSlot);
      } else if (!overHotbar) {
        onClearHotbarSlot(curr.fromIndex);
      }
    };

    const onPointerUp = (e: PointerEvent) => finishDrag(e, false);
    const onPointerCancel = (e: PointerEvent) => finishDrag(e, true);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      clearExpandTimer();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [dragState?.pointerId, onActivateHotbarSlot, onClearHotbarSlot, onSwapHotbarSlots, onToggleHotbarExpanded]);

  const cues = getActionCues(hud);
  const vitalsDrag = useHudDrag('vitals', editing);
  const utilityDrag = useHudDrag('utility', editing);
  const hotbarDrag = useHudDrag('hotbar', editing);
  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const foodPct = Math.max(0, Math.min(100, hud.hunger));
  const waterPct = Math.max(0, Math.min(100, hud.thirst));
  const bestFood = pickBestFoodConsumable(hud.inventory) ?? 'food';

  const hotbar = hud.hotbar ?? { slots: new Array<HotbarSlotValue>(14).fill(null), expanded: false };
  const row1Slots = hotbar.slots.slice(0, 5);
  const row2Slots = hotbar.slots.slice(7, 14);
  const row2FilledCount = countRowAssignedSlots(hotbar, 2);

  const foodSlotIdx = findAssignedSlotIndex(hotbar, { kind: 'consumable', id: bestFood });
  const waterSlotIdx = findAssignedSlotIndex(hotbar, { kind: 'consumable', id: 'water' });
  const foodKeyText = foodSlotIdx >= 0 ? ` [${getSlotKeyLabel(foodSlotIdx)}]` : '';
  const waterKeyText = waterSlotIdx >= 0 ? ` [${getSlotKeyLabel(waterSlotIdx)}]` : '';

  const startSlotPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    slotIndex: number,
    entry: HotbarSlotValue
  ) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.blur();
    if (editing) return;
    if (!entry) return;
    const initial: HudDragState = {
      pointerId: e.pointerId,
      fromIndex: slotIndex,
      entry,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      hoverSlot: slotIndex,
      overHotbar: true,
    };
    dragRef.current = initial;
    setDragState(initial);
  };

  const renderHotbarSlot = (entry: HotbarSlotValue, slotIndex: number) => {
    const keyLabel = getSlotKeyLabel(slotIndex);
    const meta = getHotbarSlotMeta(entry, hud, touchEnabled);
    const isSource = Boolean(dragState?.active && dragState.fromIndex === slotIndex);
    const isDropTarget = Boolean(
      dragState?.active && dragState.hoverSlot === slotIndex && dragState.fromIndex !== slotIndex
    );

    return (
      <button
        key={slotIndex}
        type="button"
        tabIndex={-1}
        data-hotbar-slot={slotIndex}
        data-item={entry ? `${entry.kind}:${entry.id}` : 'empty'}
        data-btn-id={`hotbar:${slotIndex}`}
        data-hotbar-active={meta.isActive ? 'true' : undefined}
        {...actionCueProps(meta.cue)}
        aria-label={
          entry
            ? `${meta.shortLabel}, slot ${keyLabel}, ${meta.badgeText}`
            : `Empty hotbar slot ${keyLabel}`
        }
        title={meta.title}
        onPointerDown={(e) => startSlotPointerDown(e, slotIndex, entry)}
        className={`${
          touchEnabled
            ? 'px-1.5 py-1.5 min-w-[46px] min-h-[44px]'
            : 'px-3 py-2 min-w-[76px]'
        } flex flex-col items-start transition-colors cursor-pointer touch-none ${
          meta.isActive ? 'hud-slot-active' : 'hud-slot hover:border-[#56615d]'
        } ${meta.isDimmed && !meta.isActive ? 'hotbar-slot-dimmed' : ''} ${
          !entry ? 'hotbar-slot-empty' : ''
        } ${isSource ? 'hotbar-slot-dragging' : ''} ${
          isDropTarget ? 'hotbar-drop-target' : ''
        }`}
      >
        <div className="w-full flex items-center justify-between gap-0.5 text-[10px] font-telemetry text-[#8a918d]">
          <span>[{keyLabel}]</span>
          <span
            className={
              meta.badgeHighlight ? 'text-[#f0d078] font-bold' : 'text-[#c7c2b6]'
            }
          >
            {meta.badgeText}
          </span>
        </div>
        <ToolCornerMark entry={entry} />
        {entry ? (
          <ItemIcon kind={meta.icon} className="equipment-icon" />
        ) : (
          <div className="equipment-icon hotbar-empty-glyph" aria-hidden="true">
            +
          </div>
        )}
        <div className="equipment-name font-tactical text-[11px] md:text-xs font-bold text-[#f0ece1] mt-0.5 whitespace-nowrap">
          {meta.shortLabel}
        </div>
      </button>
    );
  };

  return (
    <div data-touch={touchEnabled} data-camera={hud.cameraMode} className="game-hud fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 md:p-4">
      {/* Low HP peripheral crimson vignette */}
      {hud.hp <= 30 && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 90px rgba(185, 32, 32, 0.55)',
          }}
        />
      )}

      {/* Chilled / Freezing peripheral frost vignette */}
      {(hud.thermalStatus === 'chilled' || hud.thermalStatus === 'freezing') && (
        <div
          data-testid="frost-vignette"
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow:
              hud.thermalStatus === 'freezing'
                ? 'inset 0 0 110px rgba(96, 182, 245, 0.52)'
                : 'inset 0 0 70px rgba(120, 190, 240, 0.26)',
          }}
        />
      )}

      {/* TOP ROW: Compact Vitality Cluster (Left) + Day/Time & Utility Cluster (Right) */}
      <div className="flex items-start justify-between gap-2 md:gap-4">
        {/* Top-Left Survival Vitals: compact, pinned to the corner */}
        <div
          ref={vitalsDrag.ref}
          style={vitalsDrag.style}
          className={`vitals-panel hud-panel flex flex-col ${
            touchEnabled ? 'px-2 py-1 gap-0.5' : 'px-2.5 py-1.5 gap-1'
          }`}
        >
          {/* Health */}
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
              <path
                d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z"
                fill={hud.hp <= 30 ? '#eb4d4b' : '#c9453e'}
                stroke="#0d1012"
                strokeWidth="2"
              />
            </svg>
            <div className="health-track flex-1 h-2.5 bg-[#121518] border border-[#2c3331] overflow-hidden">
              <div
                className={`h-full ${hud.hp <= 30 ? 'vital-critical' : ''}`}
                style={{
                  width: `${hpPct}%`,
                  backgroundColor: hud.hp <= 30 ? '#ef5350' : '#c9453e',
                }}
              />
            </div>
            <span className="health-value font-telemetry text-xs font-bold w-10 text-right text-[#f0ece1]">
              {hud.hp} / {hud.maxHp}
            </span>
          </div>

          {/* Hunger & Thirst compact quick-use buttons */}
          <div className="flex items-center gap-2 pt-0.5 pointer-events-auto">
            <button data-btn-id="vitals:food" {...actionCueProps(cues.food)}
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => {
                e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                onUseConsumable(bestFood);
              }}
              aria-label={`Eat Food (${bestFood})${foodKeyText}`}
              title={`Eat Best Food${foodKeyText}`}
              className="flex items-center gap-1 flex-1 hover:bg-[#1d2224] px-1 py-0.5 -mx-1 rounded transition-colors cursor-pointer"
            >
              <span className="font-telemetry text-[10px] uppercase tracking-wider text-[#d99b38]">
                <Utensils className="w-3 h-3" aria-label="Food" />
              </span>
              <div className="flex-1 h-1.5 bg-[#121518] border border-[#2c3331] overflow-hidden">
                <div className="h-full bg-[#d99b38]" style={{ width: `${foodPct}%` }} />
              </div>
              <span className="font-telemetry text-[10px] text-[#c7c2b6] text-right">
                {hud.hunger}
              </span>
            </button>

            <button data-btn-id="vitals:water" {...actionCueProps(cues.water)}
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => {
                e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                onUseConsumable('water');
              }}
              aria-label={`Drink Purified Water (${hud.inventory.water} left)${waterKeyText}`}
              title={`Drink Water${waterKeyText} (x${hud.inventory.water})`}
              className="flex items-center gap-1 flex-1 hover:bg-[#1d2224] px-1 py-0.5 -mx-1 rounded transition-colors cursor-pointer"
            >
              <span className="font-telemetry text-[10px] uppercase tracking-wider text-[#4ea2d4]">
                <Droplet className="w-3 h-3" aria-label="Water" />
              </span>
              <div className="flex-1 h-1.5 bg-[#121518] border border-[#2c3331] overflow-hidden">
                <div
                  className={`h-full ${hud.thirst <= 20 ? 'vital-critical' : ''}`}
                  style={{
                    width: `${waterPct}%`,
                    backgroundColor: hud.thirst <= 20 ? '#ef5350' : '#4ea2d4',
                  }}
                />
              </div>
              <span
                className={`font-telemetry text-[10px] text-right ${
                  hud.thirst <= 20 ? 'text-[#ef5350] font-bold vital-critical' : 'text-[#c7c2b6]'
                }`}
              >
                {hud.thirst}
              </span>
            </button>
          </div>

          {/* Body Temperature & Clothing Wetness */}
          <div
            data-testid="thermal-readout"
            className="flex items-center justify-between gap-1.5 text-[10px] font-telemetry pt-0.5 border-t border-[#262b2a]"
          >
            <span
              className={`flex items-center gap-1 whitespace-nowrap ${
                hud.thermalStatus === 'freezing'
                  ? 'text-[#7cd6ff] font-bold vital-critical'
                  : hud.thermalStatus === 'chilled'
                    ? 'text-[#9bd5ff] font-bold'
                    : hud.thermalStatus === 'warmed'
                      ? 'text-[#ffba5a] font-bold'
                      : 'text-[#c7c2b6]'
              }`}
            >
              <Thermometer className="w-3 h-3 shrink-0" />
              <span>{hud.bodyTemp.toFixed(1)}°C</span>
              {hud.thermalStatus === 'freezing' && <span>· {touchEnabled ? 'FREEZE' : 'FREEZING'}</span>}
              {hud.thermalStatus === 'chilled' && <span>· {touchEnabled ? 'CHILL' : 'CHILLED'}</span>}
              {hud.thermalStatus === 'warmed' && (
                <span>
                  · {touchEnabled ? 'WARM' : 'WARMED'}
                  {hud.warmBuffSeconds > 0 ? ` ${hud.warmBuffSeconds}s` : ''}
                </span>
              )}
            </span>
            {hud.wetness >= 5 ? (
              <span className="flex items-center gap-0.5 text-[#6ec4f0] font-bold whitespace-nowrap">
                <Droplets className="w-3 h-3 shrink-0" />
                WET {hud.wetness}%
              </span>
            ) : hud.sheltered ? (
              <span className="flex items-center gap-0.5 text-[#78c796] whitespace-nowrap">
                <ShieldCheck className="w-3 h-3 shrink-0" />
                DRY
              </span>
            ) : (
              <span className="text-[#8a918d] whitespace-nowrap">DRY</span>
            )}
          </div>

          {/* Bleeding or Flashlight status text */}
          <div className="flex items-center justify-between text-[11px] font-telemetry pt-0.5 border-t border-[#262b2a]">
            <span className={hud.bleeding ? 'text-[#ff5e57] font-bold' : 'text-[#8a918d]'}>
              {hud.bleeding ? 'BLEEDING · [H] BANDAGE' : `BAT ${hud.battery}%`}
            </span>
            <span className="flex items-center gap-1 text-[#c7c2b6]">
              <Flashlight className="w-3 h-3 text-[#e8cf76]" />
              {hud.flashlightOn ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        {/* Top-Right Day/Time, Kills & Utility Controls */}
        <div ref={utilityDrag.ref} style={utilityDrag.style} className="utility-cluster flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-start gap-1.5 md:gap-2">
          <div className={`clock-panel hud-panel flex items-center ${touchEnabled ? 'px-2.5 py-1.5 gap-2.5' : 'px-3 py-2 gap-3'}`}>
            <div className="whitespace-nowrap">
              <div className="font-telemetry text-[10px] uppercase tracking-wider text-[#8a918d]">
                Day {hud.day} · {hud.dayPhaseLabel}
              </div>
              <div className={`font-telemetry font-bold leading-tight text-[#f0ece1] ${touchEnabled ? 'text-sm' : 'text-lg'}`}>
                <Clock3 className="clock-symbol" />{hud.timeLabel}
              </div>
            </div>

            <div className="h-6 w-px bg-[#2c3331]" />

            <div className="whitespace-nowrap">
              <div className="font-telemetry text-[10px] uppercase tracking-wider text-[#8a918d] flex items-center gap-1">
                {hud.weather.kind === 'storm' && <CloudLightning className="w-3 h-3 text-[#8bc9ff]" />}
                {hud.weather.kind === 'rain' && <CloudRain className="w-3 h-3 text-[#7ec4ff]" />}
                {hud.weather.kind === 'fog' && <CloudFog className="w-3 h-3 text-[#b5c2c9]" />}
                <span>
                  {hud.weather.label} · {Math.round(hud.weather.ambientTempC)}°C
                </span>
              </div>
              <div className={`font-telemetry font-bold leading-tight text-[#e8a849] ${touchEnabled ? 'text-xs' : 'text-base'}`}>
                <Skull className="clock-symbol" />{hud.kills} <span className="text-[#69706c] font-normal">/</span> {hud.score}
              </div>
            </div>
          </div>

          <div className="utility-buttons flex items-center gap-1 md:gap-1.5 pointer-events-auto">
            {(canCookAnything(hud) || cookOpen) && (
              <button data-btn-id="util:cook"
                type="button"
                tabIndex={-1}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                  onToggleCook();
                }}
                aria-label="Open Quick Cook Menu (K)"
                title="Quick Cook [K]"
                className={`hud-slot w-10 h-10 flex items-center justify-center transition-colors cursor-pointer ${
                  cookOpen
                    ? 'hud-slot-active text-[#f0a848]'
                    : 'border-[#d9822b] text-[#f0a848] hover:text-white'
                }`}
              >
                <Flame className="w-4 h-4" /><span className="utility-label">Cook</span>
              </button>
            )}

            <button data-btn-id="util:hud"
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => {
                e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                onEditHud();
              }}
              aria-label="Edit HUD Layout"
              title="Edit HUD Layout"
              className="hud-slot w-10 h-10 flex items-center justify-center text-[#c7c2b6] hover:text-white transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4" /><span className="utility-label">HUD</span>
            </button>

            <button data-btn-id="util:touch"
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => {
                e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                onToggleTouch();
              }}
              aria-label={touchEnabled ? 'Hide Touch Controls' : 'Show Touch Controls'}
              title="Toggle Touch Controls"
              className={`hud-slot w-10 h-10 flex items-center justify-center transition-colors cursor-pointer ${
                touchEnabled ? 'hud-slot-active text-[#f0d078]' : 'text-[#c7c2b6] hover:text-white'
              }`}
            >
              <Gamepad2 className="w-4 h-4" /><span className="utility-label">Touch</span>
            </button>



            <button data-btn-id="util:camera"
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => {
                e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                onToggleCamera();
              }}
              aria-label={hud.cameraMode === 'fps' ? 'Switch to Isometric 3D View (Z)' : 'Switch to First-Person View (Z)'}
              title="Toggle Camera View [Z]"
              className={`hud-slot w-10 h-10 flex items-center justify-center transition-colors cursor-pointer ${
                hud.cameraMode === 'fps' ? 'hud-slot-active text-[#f0d078]' : 'text-[#c7c2b6] hover:text-white'
              }`}
            >
              <Eye className="w-4 h-4" /><span className="utility-label">{hud.cameraMode === 'fps' ? '1P' : 'ISO'}</span>
            </button>

            <button data-btn-id="util:pause"
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => {
                e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                onPause();
              }}
              aria-label="Pause Game (Esc)"
              title="Pause [Esc]"
              className="hud-slot w-10 h-10 flex items-center justify-center text-[#c7c2b6] hover:text-white transition-colors cursor-pointer"
            >
              <Pause className="w-4 h-4" /><span className="utility-label">Pause</span>
            </button>
          </div>
          </div>

          {/* Contextual Terrain & Shelter Strip (positioned cleanly below fixed utility buttons on desktop) */}
          {(hud.sheltered || hud.highGroundActive || hud.elevation >= 0.5) && (
            <div
              data-testid="terrain-status-strip"
              className={`hud-panel px-2.5 py-1 flex items-center gap-2 text-[10px] font-telemetry tracking-wider whitespace-nowrap ${
                touchEnabled ? '' : 'mt-[50px]'
              }`}
            >
              {hud.sheltered && hud.shelterLabel && (
                <span className="flex items-center gap-1 text-[#78c796] font-bold">
                  <ShieldCheck className="w-3 h-3 shrink-0" />
                  {touchEnabled ? hud.shelterLabel : `SHELTERED · ${hud.shelterLabel}`}
                </span>
              )}
              {hud.sheltered && hud.elevation >= 0.5 && (
                <span className="text-[#4a5350]">|</span>
              )}
              {!hud.sheltered && hud.highGroundActive ? (
                <span className="flex items-center gap-1 text-[#8fd4ff] font-bold">
                  <Mountain className="w-3 h-3 shrink-0" />
                  {touchEnabled
                    ? `HIGH +DMG (${Math.round(hud.elevation * 4)}m)`
                    : `HIGH GROUND · +DMG +RNG (${Math.round(hud.elevation * 4)}m)`}
                </span>
              ) : hud.elevation >= 0.5 ? (
                <span className="flex items-center gap-1 text-[#c7c2b6]">
                  <Mountain className="w-3 h-3 shrink-0 text-[#9aa09c]" />
                  ELEV {Math.round(hud.elevation * 4)}m
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Transient Center-Top Status Banner (never crowds top corners) */}
      {hud.statusBanner && (
        <div
          className={`${
            touchEnabled ? 'hidden lg:block' : 'hidden md:block'
          } fixed top-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none hud-panel px-3.5 py-1 text-xs font-telemetry tracking-wider text-[#f0d078] whitespace-nowrap`}
        >
          {hud.statusBanner}
        </div>
      )}

      {/* BOTTOM ROW: Tactical Minimap (Left) + Center Hotbar & Contextual Prompts + Material Summary (Right) */}
      <div className="flex items-end justify-between gap-2 md:gap-4">
        {/* Tactical Radar Minimap (hidden when touch controls occupy bottom-left thumb zone) */}
        {!touchEnabled && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Open world navigation map"
            onPointerDown={(e) => {
              e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
              onOpenNavigation();
            }}
            title="World Map & Landmarks [N]"
            className="hidden sm:flex flex-col gap-1 hud-panel p-1.5 pointer-events-auto cursor-pointer text-left hover:border-[#70d9ff] transition-colors"
          >
            <canvas
              ref={minimapRef}
              width={112}
              height={112}
              className="block pixelated w-[112px] h-[112px]"
            />
            <span className="text-[9px] font-telemetry tracking-wider text-[#c7c2b6] truncate max-w-[112px]">
              {hud.currentBiomeLabel}
            </span>
          </button>
        )}

        {/* Center Contextual Prompt + Build Bar + Hotbar or Vehicle Cockpit */}
        <div className="flex flex-col items-center gap-2 mx-auto">
          {!touchEnabled && !hud.drivingVehicle && (hud.fishing || hud.nearbyPrompt || hud.nearbyVehiclePrompt) && (
            <div className="flex flex-wrap items-center justify-center gap-2 pointer-events-auto">
              {hud.fishing && (
                <button {...actionCueProps(cues.interact)}
                  type="button"
                  tabIndex={-1}
                  onPointerDown={(e) => {
                    e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                    onPrimaryInteract();
                  }}
                  className={`hud-panel px-3.5 py-1.5 text-xs font-telemetry flex items-center gap-2.5 whitespace-nowrap cursor-pointer ${
                    hud.fishing.canHook
                      ? 'border-[#ffd266] bg-[#382b12]/95 text-[#ffd266] animate-pulse'
                      : 'text-[#8fd3f4]'
                  }`}
                >
                  <span className="px-1.5 py-0.5 bg-[#2a312e] border border-[#54615b] text-[#f0ece1] font-bold">
                    E
                  </span>
                  <span className="font-bold">
                    {hud.fishing.canHook
                      ? '! BITE — REEL IN NOW !'
                      : hud.fishing.phase === 'reeling'
                        ? 'Reeling Catch...'
                        : 'Bobber on Water — Wait for Bite'}
                  </span>
                  {hud.fishing.canHook && (
                    <span className="w-16 h-1.5 bg-[#121518] border border-[#614a1a] overflow-hidden">
                      <span
                        className="block h-full bg-[#ffd266]"
                        style={{ width: `${Math.round((1 - hud.fishing.biteProgress) * 100)}%` }}
                      />
                    </span>
                  )}
                </button>
              )}

              {!hud.fishing && hud.nearbyPrompt && (
                <div className="flex items-center gap-1.5">
                  <button {...actionCueProps(cues.interact)}
                    type="button"
                    tabIndex={-1}
                    onPointerDown={(e) => {
                      e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                      onPrimaryInteract();
                    }}
                    className="hud-panel px-3 py-1 text-xs font-telemetry text-[#f0d078] hover:text-white flex items-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <span className="px-1.5 py-0.5 bg-[#2a312e] border border-[#54615b] text-[#f0ece1] font-bold">
                      {hud.nearbyPrompt.key}
                    </span>
                    <span>{hud.nearbyPrompt.label}</span>
                    {hud.nearbyPrompt.progress > 0 && (
                      <span className="w-12 h-1.5 bg-[#121518] border border-[#3a423e] overflow-hidden">
                        <span
                          className="block h-full bg-[#f0d078]"
                          style={{ width: `${Math.round(hud.nearbyPrompt.progress * 100)}%` }}
                        />
                      </span>
                    )}
                  </button>

                  {hud.nearbyPrompt.secondaryLabel && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onPointerDown={(e) => {
                        e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                        onBarricadeDoor();
                      }}
                      className="hud-panel px-2.5 py-1 text-xs font-telemetry text-[#e0bd5e] hover:text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <span className="px-1.5 py-0.5 bg-[#2a312e] border border-[#54615b] text-[#f0ece1] font-bold">
                        {hud.nearbyPrompt.secondaryKey ?? 'V'}
                      </span>
                      <span>{hud.nearbyPrompt.secondaryLabel}</span>
                    </button>
                  )}
                </div>
              )}

              {hud.nearbyVehiclePrompt && (
                <div className="flex items-center gap-1.5">
                  <button {...actionCueProps(cues.drive)}
                    type="button"
                    tabIndex={-1}
                    disabled={!hud.nearbyVehiclePrompt.canDrive}
                    onPointerDown={(e) => {
                      e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                      onEnterExitVehicle();
                    }}
                    className="hud-panel px-3 py-1 text-xs font-telemetry text-[#7ec4ff] hover:text-white disabled:opacity-55 flex items-center gap-2 whitespace-nowrap cursor-pointer border-[#4f84b8]"
                  >
                    <span className="px-1.5 py-0.5 bg-[#1e2d3b] border border-[#4f84b8] text-[#e6f3ff] font-bold">
                      G
                    </span>
                    <Car className="w-3.5 h-3.5" />
                    <span>
                      {hud.nearbyVehiclePrompt.label} ({hud.nearbyVehiclePrompt.hpPct}%)
                    </span>
                  </button>

                  {hud.nearbyVehiclePrompt.hpPct < 100 && (
                    <button {...actionCueProps(cues.nearbyRepair)}
                      type="button"
                      tabIndex={-1}
                      onPointerDown={(e) => {
                        e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                        onRepairVehicle();
                      }}
                      className={`hud-panel px-2.5 py-1 text-xs font-telemetry flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                        hud.nearbyVehiclePrompt.canRepair
                          ? 'text-[#f0d078] hover:text-white border-[#8f7236]'
                          : 'text-[#8a918d] opacity-75'
                      }`}
                    >
                      <span className="px-1.5 py-0.5 bg-[#2a312e] border border-[#54615b] text-[#f0ece1] font-bold">
                        T
                      </span>
                      <Wrench className="w-3 h-3" />
                      <span>Repair ({hud.nearbyVehiclePrompt.scrapCost} Scrap)</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {hud.isReloading && !hud.drivingVehicle && (
            <div className="hud-panel px-3 py-1 text-xs font-telemetry text-[#e8a849]">
              RELOADING {Math.round(hud.reloadProgress * 100)}%
            </div>
          )}

          {/* Vehicle Telemetry Cockpit when Driving */}
          {hud.drivingVehicle ? (
            <div className="hud-panel px-3 py-2 flex items-center gap-2.5 pointer-events-auto" data-testid="vehicle-hud">
              <div className="flex items-center gap-2 whitespace-nowrap">
                <Car className={`w-4 h-4 ${hud.drivingVehicle.kind === 'police' ? 'text-[#5cb3ff]' : 'text-[#e8a849]'}`} />
                <div>
                  <div className="font-telemetry text-[10px] uppercase tracking-wider text-[#8a918d] flex items-center gap-1.5">
                    <span>{hud.drivingVehicle.kind === 'police' ? 'Police Cruiser' : 'Sedan'}</span>
                    {hud.drivingVehicle.boosting && (
                      <span className="px-1 bg-[#d9822b] text-[#0d1012] font-bold">BOOST</span>
                    )}
                  </div>
                  <div className="font-telemetry text-sm font-bold text-[#f0ece1] leading-tight">
                    {hud.drivingVehicle.speedKmh} <span className="text-[10px] font-normal text-[#8a918d]">KM/H</span>
                  </div>
                </div>
              </div>

              <div className="h-7 w-px bg-[#2c3331]" />

              <div className="flex flex-col gap-1 min-w-[74px]">
                <div className="flex items-center justify-between text-[10px] font-telemetry">
                  <span className="text-[#d99b38]">FUEL</span>
                  <span className="text-[#f0ece1] font-bold">{hud.drivingVehicle.fuel}%</span>
                </div>
                <div className="h-1.5 bg-[#121518] border border-[#2c3331] overflow-hidden">
                  <div
                    className="h-full bg-[#d99b38]"
                    style={{ width: `${Math.max(0, Math.min(100, hud.drivingVehicle.fuel))}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1 min-w-[74px]">
                <div className="flex items-center justify-between text-[10px] font-telemetry">
                  <span className="text-[#7ec4ff]">HULL</span>
                  <span className="text-[#f0ece1] font-bold">
                    {Math.round((hud.drivingVehicle.hp / hud.drivingVehicle.maxHp) * 100)}%
                  </span>
                </div>
                <div className="h-1.5 bg-[#121518] border border-[#2c3331] overflow-hidden">
                  <div
                    className="h-full bg-[#5cb3ff]"
                    style={{
                      width: `${Math.max(0, Math.min(100, (hud.drivingVehicle.hp / hud.drivingVehicle.maxHp) * 100))}%`,
                    }}
                  />
                </div>
              </div>

              {!touchEnabled && (
                <>
                  <div className="h-7 w-px bg-[#2c3331]" />
                  <div className="flex items-center gap-1">
                    <span
                      title="Hold Shift while accelerating for Turbo Boost"
                      className={`hud-slot px-1.5 py-1 text-[10px] font-telemetry flex items-center gap-1 whitespace-nowrap ${
                        hud.drivingVehicle.boosting ? 'hud-slot-active text-[#f0d078]' : 'text-[#8a918d]'
                      }`}
                    >
                      <Zap className="w-3 h-3" />
                      SHIFT
                    </span>
                    <button {...actionCueProps(cues.fuel)}
                      type="button"
                      tabIndex={-1}
                      onPointerDown={(e) => {
                        e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                        onRefuel();
                      }}
                      title="Refuel [R]"
                      className="hud-slot px-2 py-1 text-[11px] font-telemetry text-[#d99b38] hover:text-white flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Fuel className="w-3 h-3" />
                      [R] {hud.inventory.fuel}
                    </button>
                    <button {...actionCueProps(cues.repair)}
                      type="button"
                      tabIndex={-1}
                      onPointerDown={(e) => {
                        e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                        onRepairVehicle();
                      }}
                      title={`Field Repair (${hud.drivingVehicle.repairCost} Scrap) [T]`}
                      className={`hud-slot px-2 py-1 text-[11px] font-telemetry flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        hud.drivingVehicle.hp < hud.drivingVehicle.maxHp && hud.drivingVehicle.canRepair
                          ? 'border-[#d9a436] text-[#f0d078] hover:text-white'
                          : 'text-[#8a918d]'
                      }`}
                    >
                      <Wrench className="w-3 h-3" />
                      [T]
                    </button>
                    <button {...actionCueProps(cues.light)}
                      type="button"
                      tabIndex={-1}
                      onPointerDown={(e) => {
                        e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                        onToggleHeadlights();
                      }}
                      title="Toggle Headlights [F]"
                      className={`hud-slot px-2 py-1 text-[11px] font-telemetry flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        hud.drivingVehicle.headlightsOn ? 'hud-slot-active text-[#f0d078]' : 'text-[#9aa09c]'
                      }`}
                    >
                      <Flashlight className="w-3 h-3" />
                      [F]
                    </button>
                    <button {...actionCueProps(cues.horn)}
                      type="button"
                      tabIndex={-1}
                      onPointerDown={(e) => {
                        e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                        onHorn();
                      }}
                      title={hud.drivingVehicle.kind === 'police' ? 'Horn & Siren [Q]' : 'Horn [Q]'}
                      className={`hud-slot px-2 py-1 text-[11px] font-telemetry flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        hud.drivingVehicle.sirenOn ? 'hud-slot-active text-[#7ec4ff]' : 'text-[#c7c2b6]'
                      }`}
                    >
                      <Siren className="w-3 h-3" />
                      [Q]
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onPointerDown={(e) => {
                        e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                        onEnterExitVehicle();
                      }}
                      className="hud-slot px-2.5 py-1 text-[11px] font-telemetry text-[#f0ece1] hover:border-[#eb4d4b] cursor-pointer whitespace-nowrap"
                    >
                      [G] Exit
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Build Mode Selector Strip (only visible when Build Mode is active) */}
              {hud.buildMode && (
                <div className="hud-panel px-2 py-1.5 flex items-center gap-1.5 pointer-events-auto">
                  {(['barricade', 'spike_trap', 'campfire'] as StructureKind[]).map((kind) => {
                    const spec = STRUCTURES[kind];
                    const affordable = canAffordCost(hud.inventory, spec.cost);
                    const active = hud.buildMode === kind;
                    const shortLabel =
                      kind === 'barricade' ? 'Barricade' : kind === 'spike_trap' ? 'Spikes' : 'Campfire';
                    return (
                      <button
                        key={kind}
                        type="button"
                        tabIndex={-1}
                        onPointerDown={(e) => {
                          e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                          onToggleBuild(kind);
                        }}
                        className={`px-2 py-1 text-[11px] font-telemetry border transition-colors cursor-pointer whitespace-nowrap ${
                          active
                            ? 'bg-[#363d2e] border-[#d9822b] text-[#f0ece1]'
                            : 'bg-[#161a1c] border-[#303836] text-[#9aa09c] hover:text-white'
                        } ${!affordable ? 'opacity-55' : ''}`}
                      >
                        {touchEnabled ? shortLabel : spec.name}{' '}
                        <span className="text-[10px] text-[#a8adb0]">
                          ({Object.entries(spec.cost)
                            .map(([k, v]) => `${v}${k[0].toUpperCase()}`)
                            .join(' ')})
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    tabIndex={-1}
                    onPointerDown={(e) => {
                      e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                      onToggleBuild(hud.buildMode!);
                    }}
                    className="px-2 py-1 text-[11px] font-telemetry text-[#e06c64] hover:text-white cursor-pointer"
                  >
                    X
                  </button>
                </div>
              )}

              <div className="equipped-readout"><span className="equipped-dot"/>{hud.buildMode ? STRUCTURES[hud.buildMode].name : WEAPONS[hud.equippedWeapon].name}<span className="equipped-sub">{hud.buildMode ? 'PLACEMENT' : 'EQUIPPED'}</span></div>
              {/* Expandable 2-Row Hotbar (Row 1 compact primary + collapsible Row 2 above) */}
              <div
                ref={hotbarDrag.ref}
                style={hotbarDrag.style}
                data-expanded={hotbar.expanded ? 'true' : 'false'}
                className="hotbar-wrap pointer-events-auto"
              >
                <button data-btn-id="hotbar:bag"
                  type="button"
                  tabIndex={-1}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.blur();
                    onToggleCraft();
                  }}
                  aria-label="Open Backpack and Crafting (I)"
                  title="Backpack & Craft [I]"
                  className={`bag-btn flex flex-col items-start transition-colors cursor-pointer ${
                    craftOpen ? 'bag-btn-active' : ''
                  }`}
                >
                  <div className="w-full flex items-center justify-between gap-1.5 text-[10px] font-telemetry text-[#8a918d]">
                    <span>[I]</span>
                    <Backpack className="w-3 h-3 text-[#e8a849]" />
                  </div>
                  <ItemIcon kind="bag" className="equipment-icon" />
                  <div className="equipment-name font-tactical text-[11px] md:text-xs font-bold text-[#f0ece1] mt-0.5 whitespace-nowrap">
                    Bag
                  </div>
                </button>

                <div className="hotbar-rows">
                  {hotbar.expanded && (
                    <div
                      role="region"
                      aria-label="Secondary Hotbar Row (Slots 8 to 14)"
                      data-testid="hotbar-row-2"
                      className="equipment-bar hotbar-row-2 flex items-center gap-1 md:gap-1.5"
                    >
                      {row2Slots.map((entry, idx) => renderHotbarSlot(entry, idx + 7))}
                    </div>
                  )}

                  <div
                    role="region"
                    aria-label="Primary Hotbar Row (Slots 1 to 5)"
                    data-testid="hotbar-row-1"
                    className="equipment-bar hotbar-row-1 flex items-center gap-1 md:gap-1.5"
                  >
                    {row1Slots.map((entry, idx) => renderHotbarSlot(entry, idx))}
                  </div>
                </div>

                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="hotbar-expand-btn"
                  data-hotbar-expand="true"
                  aria-expanded={hotbar.expanded}
                  aria-label={
                    hotbar.expanded
                      ? `Collapse extra hotbar row (${row2FilledCount} items kept active)`
                      : `Expand extra hotbar row (${row2FilledCount} of 7 assigned)`
                  }
                  title={`${hotbar.expanded ? 'Collapse' : 'Expand'} Extra Hotbar Row [Tab]`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.blur();
                    if (!editing) onToggleHotbarExpanded();
                  }}
                  className={`hotbar-expand-btn ${hotbar.expanded ? 'is-expanded' : ''}`}
                >
                  {hotbar.expanded ? (
                    <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
                  )}
                  <span className="hotbar-expand-key">[TAB]</span>
                  <span className="hotbar-expand-count">{row2FilledCount}/7</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Bottom-Right Compact Materials Summary (hidden when touch controls occupy bottom-right thumb zone) */}
        {!touchEnabled && (
          <div className="hidden lg:flex hud-panel px-3 py-2 gap-3 font-telemetry text-xs text-[#c7c2b6]">
            <span className="flex items-center gap-1">
              <ItemIcon kind="wood" className="w-5 h-5"/><span className="text-[#a67449] font-bold">{hud.inventory.wood}</span> Wood
            </span>
            <span>
              <span className="text-[#8f9ba3] font-bold">{hud.inventory.scrap}</span> Scrap
            </span>
            <span>
              <span className="text-[#d4cfc4] font-bold">{hud.inventory.cloth}</span> Cloth
            </span>
            <span>
              <span className="text-[#d4513b] font-bold">{hud.inventory.fuel}</span> Fuel
            </span>
          </div>
        )}
      </div>

      {dragState?.active && (
        <HotbarDragGhost
          entry={dragState.entry}
          x={dragState.x}
          y={dragState.y}
          hint={
            dragState.hoverSlot !== null && dragState.hoverSlot !== dragState.fromIndex
              ? `Swap → [${getSlotKeyLabel(dragState.hoverSlot)}]`
              : !dragState.overHotbar
                ? 'Drop to Unbind'
                : 'Drag to Slot'
          }
        />
      )}
    </div>
  );
};

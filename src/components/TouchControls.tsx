import { getActionCues, actionCueProps, canCookAnything } from '../game/actionAlerts';
import { formatRestCooldown } from '../game/restCooldown';
import { FloatingStick } from './FloatingStick';
import { useHudDrag } from './useHudDrag';
import { applyButtonScales } from '../game/hudLayout';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Car,
  Crosshair,
  DoorOpen,
  Flame,
  Flashlight,
  Fuel,
  Footprints,
  RotateCcw,
  Hammer,
  LogOut,
  PackageOpen,
  RotateCw,
  Siren,
  Sword,
  Wrench,
  Zap,
} from 'lucide-react';
import { WEAPONS, isMeleeWeapon } from '../game/recipes';
import type { HudSnapshot } from '../game/types';

interface TouchControlsProps {
  hud: HudSnapshot;
  editing?: boolean;
  onMoveStick: (nx: number, ny: number) => void;
  onAimStick: (nx: number, ny: number, active: boolean) => void;
  onFireChange: (held: boolean) => void;
  onBrakeChange: (held: boolean) => void;
  onBoostChange: (held: boolean) => void;
  onDodge: () => void;
  onReload: () => void;
  onLoot: () => void;
  onDoor: () => void;
  onBarricadeDoor: () => void;
  onRepairVehicle: () => void;
  onQuickCook: () => void;
  onToggleFlashlight: () => void;
  onEnterExitVehicle: () => void;
  onHorn: () => void;
  /** First-person only: dragging the right fire button aims while it fires. */
  onAimDelta: (dx: number, dy: number) => void;
}


/** Held buttons track every finger on them, so lifting one finger never releases a button another finger still holds.
 * Cancels and lost captures release too, so a button can never stay latched. */
function useHeldButton(apply: (held: boolean) => void, setVisual: (held: boolean) => void) {
  const ids = useRef<Set<number>>(new Set());
  const applyRef = useRef(apply); applyRef.current = apply;
  const visualRef = useRef(setVisual); visualRef.current = setVisual;
  const set = useCallback((held: boolean) => { visualRef.current(held); applyRef.current(held); }, []);
  const releaseAll = useCallback(() => { if (ids.current.size === 0) return; ids.current.clear(); set(false); }, [set]);
  useEffect(() => {
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length === 0) releaseAll(); };
    window.addEventListener('touchend', onTouchEnd, true);
    window.addEventListener('touchcancel', releaseAll, true);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('touchend', onTouchEnd, true);
      window.removeEventListener('touchcancel', releaseAll, true);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, [releaseAll]);
  const down = (e: React.PointerEvent<HTMLElement>, onFirst?: () => void) => {
    e.preventDefault(); e.stopPropagation();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    const first = ids.current.size === 0;
    ids.current.add(e.pointerId);
    if (first) { set(true); onFirst?.(); }
  };
  const up = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    if (!ids.current.delete(e.pointerId)) return;
    if (ids.current.size === 0) set(false);
  };
  const cancel = (e: React.PointerEvent<HTMLElement>) => {
    if (!ids.current.delete(e.pointerId)) return;
    if (ids.current.size === 0) set(false);
  };
  return { onPointerDown: down, onPointerUp: up, onPointerCancel: cancel, onLostPointerCapture: cancel };
}

export const TouchControls: React.FC<TouchControlsProps> = ({
  hud,
  editing = false,
  onMoveStick,
  onAimStick,
  onFireChange,
  onBrakeChange,
  onBoostChange,
  onDodge,
  onReload,
  onLoot,
  onDoor,
  onBarricadeDoor,
  onRepairVehicle,
  onQuickCook,
  onToggleFlashlight,
  onEnterExitVehicle,
  onHorn,
  onAimDelta,
}) => {
  const leftFireDrag = useHudDrag('leftFire', editing);
  const fpsAttackDrag = useHudDrag('fpsAttack', editing);
  const quickRailDrag = useHudDrag('quickRail', editing);
  const [fireHeld, setFireHeld] = useState(false);
  const [attackHeld, setAttackHeld] = useState(false);
  const [boostHeld, setBoostHeld] = useState(false);
  const isDrivingNow = Boolean(hud.drivingVehicle);
  const isFishingNow = Boolean(hud.fishing);
  const fireHold = useHeldButton((held) => {
    if (!held) { onBrakeChange(false); onFireChange(false); return; }
    if (isDrivingNow) onBrakeChange(true); else if (!isFishingNow) onFireChange(true);
  }, setFireHeld);
  const attackHold = useHeldButton((held) => {
    if (!held) { onFireChange(false); return; }
    if (!isFishingNow) onFireChange(true);
  }, setAttackHeld);

  // Drag-to-aim while the first-person fire button is held (fire + aim with one thumb).
  const attackDragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const attackHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      attackDragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      attackHold.onPointerDown(e, isFishingNow ? onLoot : undefined);
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = attackDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (dx !== 0 || dy !== 0) onAimDelta(dx, dy);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (attackDragRef.current?.pointerId === e.pointerId) attackDragRef.current = null;
      attackHold.onPointerUp(e);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (attackDragRef.current?.pointerId === e.pointerId) attackDragRef.current = null;
      attackHold.onPointerCancel(e);
    },
    onLostPointerCapture: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (attackDragRef.current?.pointerId === e.pointerId) attackDragRef.current = null;
      attackHold.onLostPointerCapture(e);
    },
  };
  const boostHold = useHeldButton(onBoostChange, setBoostHeld);
  const [isPortrait, setIsPortrait] = useState(false);
  const [dismissRotateHint, setDismissRotateHint] = useState(false);

  useEffect(() => {
    const checkOrientation = () => {
      setIsPortrait(window.innerWidth < window.innerHeight && window.innerWidth < 768);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    return () => window.removeEventListener('resize', checkOrientation);
  }, []);

  // Saved per-button sizes (Edit HUD corner-drag) ride on data-btn-id attributes.
  useEffect(() => {
    applyButtonScales(document.documentElement);
  });

  const cues = getActionCues(hud);
  const isDriving = Boolean(hud.drivingVehicle);
  const isFishing = Boolean(hud.fishing);
  const isFps = hud.cameraMode === 'fps';

  // Keep a separate left trigger like the reference; right-hand attack button or aim stick handles primary right-thumb combat.
  const showLeftTrigger = true;

  const isMeleeEquipped = isMeleeWeapon(hud.equippedWeapon);

  const combatActionLabel = isFishing
    ? hud.fishing?.canHook
      ? 'REEL!'
      : 'PULL'
    : hud.buildMode
      ? 'PLACE'
      : isMeleeEquipped
        ? 'SLASH'
        : hud.equippedWeapon === 'molotov'
          ? 'THROW'
          : 'FIRE';

  const fireLabel = isDriving ? 'DRIFT' : isFps ? combatActionLabel : hud.buildMode ? 'PLACE' : hud.equippedWeapon === 'molotov' ? 'THROW' : isFishing ? (hud.fishing?.canHook ? 'REEL!' : 'PULL') : 'FIRE';

  const renderAttackIcon = (className: string) => {
    if (hud.buildMode) return <Hammer className={className} />;
    if (isMeleeEquipped && !isFishing) return <Sword className={className} />;
    if (hud.equippedWeapon === 'molotov' && !isFishing) return <Flame className={className} />;
    if ((hud.equippedWeapon === 'pistol' || hud.equippedWeapon === 'shotgun' || hud.equippedWeapon === 'lmg') && !isFishing) {
      return <Crosshair className={className} />;
    }
    return <Flame className={className} />;
  };

  const aimStickLabel = hud.buildMode
    ? 'Aim Build'
    : isMeleeEquipped
      ? 'Aim & Swing'
      : hud.equippedWeapon === 'molotov'
        ? 'Aim & Throw'
        : 'Aim & Fire';

  const lootShortLabel = isFishing
    ? hud.fishing?.canHook
      ? 'REEL!'
      : 'REEL'
    : hud.nearbyPrompt?.action === 'sleep'
      ? 'REST'
    : hud.nearbyPrompt?.action === 'fishing'
      ? 'CAST'
      : hud.nearbyPrompt?.action === 'door'
        ? hud.nearbyPrompt.label.includes('Pick') || hud.nearbyPrompt.label.includes('Picking')
          ? 'PICK'
          : 'DOOR'
        : hud.nearbyPrompt?.action === 'cook'
          ? 'USE'
          : 'LOOT';

  return (
    <div data-camera={hud.cameraMode} className="touch-controls fixed inset-0 z-20 pointer-events-none">
      {!editing && <FloatingStick testId="touch-move-stick" side="left" label={isDriving?'Drive':'Move'} accentColor="#b7d994" onChange={(x,y)=>onMoveStick(x,y)} />}
      {!editing && !isDriving && !isFps && <FloatingStick testId="touch-aim-stick" side="right" label={aimStickLabel} accentColor="#ead39b" onChange={onAimStick} />}
      {/* While editing the HUD layout, the touch buttons stay visible but the sticks hide */}
      {/* Horizontal orientation recommendation banner if device is held vertically */}
      {isPortrait && !dismissRotateHint && (
        <div className="rotation-hint absolute top-16 left-1/2 -translate-x-1/2 pointer-events-auto hud-panel px-3 py-1.5 flex items-center gap-2 text-[11px] font-telemetry text-[#f0d078] whitespace-nowrap">
          <RotateCw className="w-3.5 h-3.5 shrink-0" />
          <span>{isFps ? 'Rotate horizontally for FPS controls' : 'Rotate horizontally for twin-stick play'}</span>
          <button
            type="button"
            onClick={() => setDismissRotateHint(true)}
            className="ml-1 px-1.5 py-0.5 bg-[#2a312e] text-[#e6e2d8] hover:text-white cursor-pointer"
          >
            OK
          </button>
        </div>
      )}

      {/* LEFT HAND CLUSTER: Movement / Steering Joystick + Contextual Left-Hand Trigger (Slash / Fire / Drift / Reel / Place) */}
      <div className="left-control-cluster absolute left-3 bottom-3 flex items-end gap-3 pointer-events-none">
        <div className="stick-spacer" style={{width:108,height:108,pointerEvents:'none'}} />

        {showLeftTrigger && (
          <button
            type="button"
            data-testid="touch-fire-btn" {...actionCueProps((isFishing ? cues.fishing! : { state: 'idle' as const, reason: fireLabel }))}
            aria-label={
              isDriving
                ? 'Handbrake Drift Button'
                : isFishing
                  ? 'Reel Fishing Line'
                  : isMeleeEquipped && isFps
                    ? 'Left Hand Slash Button'
                    : 'Left Hand Fire Button'
            }
            onPointerDown={(e) => fireHold.onPointerDown(e, isFishingNow ? onLoot : undefined)}
            onPointerUp={fireHold.onPointerUp}
            onPointerCancel={fireHold.onPointerCancel}
            onLostPointerCapture={fireHold.onLostPointerCapture}
            ref={leftFireDrag.ref}
            style={{ touchAction: 'none', ...leftFireDrag.style }}
            className={`w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center transition-transform select-none cursor-pointer ${
              fireHeld
                ? 'bg-[#c9453e] border-[#ffd266] text-white scale-95 shadow-[0_0_16px_rgba(201,69,62,0.65)]'
                : hud.fishing?.canHook
                  ? 'bg-[#45310f]/95 border-[#ffd266] text-[#ffd266] animate-pulse shadow-[0_0_18px_rgba(255,210,102,0.5)]'
                  : 'bg-[#1a1f22]/90 border-[#d9822b] text-[#f0ece1] shadow-[0_4px_14px_rgba(0,0,0,0.6)]'
            }`}
          >
            {isDriving ? <Flame className="w-5 h-5" /> : isFps ? renderAttackIcon('w-5 h-5') : <Flame className="w-5 h-5" />}
            <span className="font-telemetry text-[10px] font-bold tracking-wider mt-0.5">
              {fireLabel}
            </span>
          </button>
        )}
      </div>

      {/* RIGHT HAND CLUSTER: Driving Controls OR On-Foot Quick Utility Buttons + Aim Stick */}
      <div className={`right-control-cluster ${isDriving?'is-driving':'on-foot'} absolute right-3 bottom-3 flex items-end gap-2.5 pointer-events-none`}>
        {isDriving ? (
          <div className="grid grid-cols-3 gap-1.5">
            <button data-btn-id="veh:boost"
              type="button"
              data-testid="touch-boost-btn" {...actionCueProps(cues.boost)}
              aria-label="Turbo Boost"
              onPointerDown={(e) => boostHold.onPointerDown(e)}
              onPointerUp={boostHold.onPointerUp}
              onPointerCancel={boostHold.onPointerCancel}
              onLostPointerCapture={boostHold.onLostPointerCapture}
              style={{ touchAction: 'none' }}
              className={`min-w-[46px] min-h-[44px] rounded-lg border-2 flex flex-col items-center justify-center cursor-pointer ${
                boostHeld || hud.drivingVehicle?.boosting
                  ? 'bg-[#452e12]/95 border-[#ffd266] text-[#ffd266]'
                  : 'bg-[#14181a]/88 border-[#d9822b] text-[#f0d078]'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span className="font-telemetry text-[9px] font-bold">BOOST</span>
            </button>

            <button data-btn-id="veh:repair"
              type="button"
              data-testid="touch-repair-btn" {...actionCueProps(cues.repair)}
              aria-label="Repair Vehicle"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRepairVehicle();
              }}
              style={{ touchAction: 'none' }}
              className={`min-w-[46px] min-h-[44px] rounded-lg border-2 flex flex-col items-center justify-center cursor-pointer ${
                hud.drivingVehicle && hud.drivingVehicle.hp < hud.drivingVehicle.maxHp && hud.drivingVehicle.canRepair
                  ? 'bg-[#252b1f]/92 border-[#8be08b] text-[#8be08b]'
                  : 'bg-[#14181a]/88 border-[#3b4442] text-[#c7c2b6]'
              }`}
            >
              <Wrench className="w-4 h-4" />
              <span className="font-telemetry text-[9px] font-bold">REPAIR</span>
            </button>

            <button data-btn-id="veh:exit"
              type="button"
              data-testid="touch-exit-vehicle-btn"
              aria-label="Exit Vehicle"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEnterExitVehicle();
              }}
              style={{ touchAction: 'none' }}
              className="min-w-[46px] min-h-[44px] rounded-lg border-2 border-[#eb4d4b] bg-[#2a1818]/92 text-[#ffd8d6] flex flex-col items-center justify-center cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span className="font-telemetry text-[9px] font-bold">EXIT</span>
            </button>

            <button data-btn-id="veh:fuel"
              type="button"
              data-testid="touch-refuel-btn" {...actionCueProps(cues.fuel)}
              aria-label="Refuel Vehicle"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onReload();
              }}
              style={{ touchAction: 'none' }}
              className="min-w-[46px] min-h-[44px] rounded-lg border-2 border-[#3b4442] bg-[#14181a]/88 text-[#d99b38] flex flex-col items-center justify-center cursor-pointer"
            >
              <Fuel className="w-4 h-4" />
              <span className="font-telemetry text-[9px] font-bold">FUEL</span>
            </button>

            <button data-btn-id="veh:light"
              type="button"
              data-testid="touch-light-btn" {...actionCueProps(cues.light)}
              aria-label="Toggle Headlights"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFlashlight();
              }}
              style={{ touchAction: 'none' }}
              className={`min-w-[46px] min-h-[44px] rounded-lg border-2 flex flex-col items-center justify-center cursor-pointer ${
                hud.drivingVehicle?.headlightsOn
                  ? 'bg-[#2a2f26]/90 border-[#e8cf76] text-[#e8cf76]'
                  : 'bg-[#14181a]/88 border-[#3b4442] text-[#9aa09c]'
              }`}
            >
              <Flashlight className="w-4 h-4" />
              <span className="font-telemetry text-[9px] font-bold">LIGHT</span>
            </button>

            <button data-btn-id="veh:horn"
              type="button"
              data-testid="touch-horn-btn" {...actionCueProps(cues.horn)}
              aria-label="Car Horn or Siren"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onHorn();
              }}
              style={{ touchAction: 'none' }}
              className={`min-w-[46px] min-h-[44px] rounded-lg border-2 flex flex-col items-center justify-center cursor-pointer ${
                hud.drivingVehicle?.sirenOn
                  ? 'bg-[#1e2d3b] border-[#5cb3ff] text-[#7ec4ff]'
                  : 'bg-[#14181a]/88 border-[#3b4442] text-[#e6e2d8]'
              }`}
            >
              <Siren className="w-4 h-4" />
              <span className="font-telemetry text-[9px] font-bold">
                {hud.drivingVehicle?.kind === 'police' ? 'SIREN' : 'HORN'}
              </span>
            </button>
          </div>
        ) : (
          <>
            <div className="context-action-stack flex flex-col items-end gap-1.5">
              {hud.nearbyDoorAction && <button data-btn-id="ctx:door" type="button" data-testid="touch-door-btn" {...actionCueProps(cues.door)} aria-label={hud.nearbyDoorAction.label}
                onPointerDown={e=>{e.preventDefault();e.stopPropagation();onDoor();}} style={{touchAction:'none'}}
                className="w-full min-h-[48px] px-3 flex items-center justify-center gap-2 cursor-pointer">
                <DoorOpen className="w-5 h-5"/><span className="font-telemetry text-[10px] font-bold">{hud.nearbyDoorAction.label}</span>
              </button>}
              {canCookAnything(hud) && (
                <button data-btn-id="ctx:cook"
                  type="button"
                  data-testid="touch-cook-btn" {...actionCueProps(cues.cook)}
                  aria-label="Open Quick Cook"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onQuickCook();
                  }}
                  style={{ touchAction: 'none' }}
                  className="w-full min-h-[44px] px-2 rounded-lg border-2 border-[#d9822b] bg-[#302014]/94 text-[#ffd266] flex items-center justify-center gap-1.5 cursor-pointer shadow-[0_4px_12px_rgba(0,0,0,0.55)]"
                >
                  <Flame className="w-4 h-4 text-[#f0a848]" />
                  <span className="font-telemetry text-[10px] font-bold tracking-wider">COOK</span>
                </button>
              )}

              {hud.nearbyPrompt?.secondaryLabel && (
                <button data-btn-id="ctx:board"
                  type="button"
                  data-testid="touch-barricade-btn" {...actionCueProps(cues.board)}
                  aria-label="Barricade Door"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onBarricadeDoor();
                  }}
                  style={{ touchAction: 'none' }}
                  className="w-full min-h-[44px] px-2 rounded-lg border-2 border-[#a67449] bg-[#261d14]/94 text-[#e0bd5e] flex items-center justify-center gap-1.5 cursor-pointer shadow-[0_4px_12px_rgba(0,0,0,0.55)]"
                >
                  <Hammer className="w-4 h-4" />
                  <span className="font-telemetry text-[10px] font-bold tracking-wider">BOARD</span>
                </button>
              )}

              {hud.nearbyVehiclePrompt && (
                <div className="flex items-center gap-1.5 w-full">
                  {hud.nearbyVehiclePrompt.canDrive && (
                    <button data-btn-id="ctx:drive"
                      type="button"
                      data-testid="touch-drive-btn" {...actionCueProps(cues.drive)}
                      aria-label="Enter Vehicle"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onEnterExitVehicle();
                      }}
                      style={{ touchAction: 'none' }}
                      className="flex-1 min-h-[44px] px-2 rounded-lg border-2 border-[#5cb3ff] bg-[#1b2b38]/94 text-[#e6f3ff] flex items-center justify-center gap-1 cursor-pointer shadow-[0_4px_12px_rgba(0,0,0,0.55)]"
                    >
                      <Car className="w-4 h-4 text-[#7ec4ff]" />
                      <span className="font-telemetry text-[10px] font-bold tracking-wider">DRIVE</span>
                    </button>
                  )}
                  {hud.nearbyVehiclePrompt.hpPct < 100 && (
                    <button data-btn-id="ctx:repair"
                      type="button"
                      data-testid="touch-repair-nearby-btn" {...actionCueProps(cues.nearbyRepair)}
                      aria-label="Repair Vehicle"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRepairVehicle();
                      }}
                      style={{ touchAction: 'none' }}
                      className="min-w-[44px] min-h-[44px] px-1.5 rounded-lg border-2 border-[#d9a436] bg-[#2a2417]/94 text-[#f0d078] flex items-center justify-center cursor-pointer"
                    >
                      <Wrench className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              <div ref={quickRailDrag.ref} style={quickRailDrag.style} className="quick-action-rail grid grid-cols-2 gap-1.5">
              <button data-btn-id="rail:loot"
                type="button"
                data-testid="touch-loot-btn" {...actionCueProps(cues.interact)}
                data-loot-ready={hud.nearbyPrompt?.action === 'loot'}
                aria-hidden={hud.nearbyPrompt?.action === 'door' && !isFishing}
                tabIndex={hud.nearbyPrompt?.action === 'door' && !isFishing ? -1 : 0}
                aria-label={hud.nearbyPrompt?.action === 'sleep' ? cues.rest.reason : isFishing ? cues.fishing!.reason : 'Interact or Scavenge Nearby'}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onLoot();
                }}
                style={{ touchAction: 'none', visibility: hud.nearbyPrompt?.action === 'door' && !isFishing ? 'hidden' : undefined }}
                className={`min-w-[46px] min-h-[46px] rounded-lg border-2 flex flex-col items-center justify-center cursor-pointer ${
                  hud.fishing?.canHook
                    ? 'bg-[#45310f] border-[#ffd266] text-[#ffd266] animate-pulse'
                    : hud.nearbyPrompt || hud.fishing
                      ? 'bg-[#363d2e] border-[#f0d078] text-[#f0d078]'
                      : 'bg-[#14181a]/88 border-[#3b4442] text-[#b3b8b5]'
                }`}
              >
                <PackageOpen className="w-4 h-4" />
                <span className="font-telemetry text-[9px] font-bold">{lootShortLabel}</span>
                {hud.nearbyPrompt?.action === 'sleep' && hud.restCooldownSeconds > 0 && <span className="font-telemetry text-[8px]">{formatRestCooldown(hud.restCooldownSeconds)}</span>}
              </button>

              <button data-btn-id="rail:dodge"
                type="button"
                data-testid="touch-dodge-btn" {...actionCueProps(cues.dodge)}
                aria-label="Dodge Roll"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDodge();
                }}
                style={{ touchAction: 'none' }}
                className="min-w-[46px] min-h-[46px] rounded-lg border-2 border-[#3b4442] bg-[#14181a]/88 active:border-[#d9a436] text-[#e6e2d8] flex flex-col items-center justify-center cursor-pointer"
              >
                <Footprints className="w-4 h-4 text-[#d9a436]" />
                <span className="font-telemetry text-[9px] font-bold">DODGE</span>
              </button>

              <button data-btn-id="rail:reload"
                type="button"
                data-testid="touch-reload-btn" {...actionCueProps(cues.reload)}
                aria-label="Reload Weapon"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onReload();
                }}
                style={{ touchAction: 'none' }}
                className="min-w-[46px] min-h-[46px] rounded-lg border-2 border-[#3b4442] bg-[#14181a]/88 active:border-[#d9822b] text-[#e6e2d8] flex flex-col items-center justify-center cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 text-[#d9822b]" />
                <span className="font-telemetry text-[9px] font-bold">RELOAD</span>
              </button>

              <button data-btn-id="rail:light"
                type="button"
                data-testid="touch-light-btn" {...actionCueProps(cues.light)}
                aria-label="Toggle Flashlight"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleFlashlight();
                }}
                style={{ touchAction: 'none' }}
                className={`min-w-[46px] min-h-[46px] rounded-lg border-2 flex flex-col items-center justify-center cursor-pointer ${
                  hud.flashlightOn
                    ? 'bg-[#2a2f26]/90 border-[#e8cf76] text-[#e8cf76]'
                    : 'bg-[#14181a]/88 border-[#3b4442] text-[#9aa09c]'
                }`}
              >
                <Flashlight className="w-4 h-4" />
                <span className="font-telemetry text-[9px] font-bold">LIGHT</span>
              </button>
              </div>
            </div>

            {isFps ? (
              <button
                type="button"
                data-testid="touch-attack-btn"
                data-weapon={hud.buildMode ? 'build' : hud.equippedWeapon}
                {...actionCueProps(isFishing ? cues.fishing! : { state: 'idle' as const, reason: combatActionLabel })}
                aria-label={
                  isFishing
                    ? 'Reel Fishing Line'
                    : hud.buildMode
                      ? 'Place Structure'
                      : isMeleeEquipped
                        ? `Slash ${WEAPONS[hud.equippedWeapon].name}`
                        : hud.equippedWeapon === 'molotov'
                          ? 'Throw Molotov'
                          : 'Fire Weapon'
                }
                {...attackHandlers}
                ref={fpsAttackDrag.ref}
                style={{ touchAction: 'none', ...fpsAttackDrag.style }}
                className={`fps-attack-btn w-[72px] h-[72px] rounded-full border-2 flex flex-col items-center justify-center transition-transform select-none cursor-pointer ${
                  attackHeld
                    ? 'bg-[#c9453e] border-[#ffd266] text-white scale-95 shadow-[0_0_18px_rgba(201,69,62,0.75)]'
                    : hud.fishing?.canHook
                      ? 'bg-[#45310f]/95 border-[#ffd266] text-[#ffd266] animate-pulse shadow-[0_0_18px_rgba(255,210,102,0.55)]'
                      : 'bg-[#1a1f22]/90 border-[#d9822b] text-[#f0ece1] shadow-[0_4px_16px_rgba(0,0,0,0.65)]'
                }`}
              >
                {renderAttackIcon('w-6 h-6')}
                <span className="font-telemetry text-[11px] font-bold tracking-wider mt-0.5">
                  {combatActionLabel}
                </span>
              </button>
            ) : (
              <div className="stick-spacer" style={{width:104,height:104,pointerEvents:'none'}} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

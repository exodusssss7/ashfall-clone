import { FloatingStick } from './FloatingStick';
import React, { useEffect, useState } from 'react';
import {
  Car,
  Crosshair,
  DoorOpen,
  Flame,
  Flashlight,
  Fuel,
  Hammer,
  LogOut,
  PackageOpen,
  RotateCw,
  ShieldAlert,
  Siren,
  Wrench,
  Zap,
} from 'lucide-react';
import type { HudSnapshot } from '../game/types';

interface TouchControlsProps {
  hud: HudSnapshot;
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
}

export const TouchControls: React.FC<TouchControlsProps> = ({
  hud,
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
}) => {
  const [fireHeld, setFireHeld] = useState(false);
  const [boostHeld, setBoostHeld] = useState(false);
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

  const isDriving = Boolean(hud.drivingVehicle);
  const isFishing = Boolean(hud.fishing);
  const isMeleeOnFoot =
    !isDriving && !isFishing && !hud.buildMode && hud.equippedWeapon === 'crowbar';

  // Left-hand trigger is hidden when Crowbar is equipped on foot because Swing is integrated into the Aim Stick
  const showLeftTrigger = !isMeleeOnFoot;

  const fireLabel = isDriving
    ? 'DRIFT'
    : isFishing
      ? hud.fishing?.canHook
        ? 'REEL!'
        : 'PULL'
      : hud.buildMode
        ? 'PLACE'
        : hud.equippedWeapon === 'molotov'
          ? 'THROW'
          : 'FIRE';

  const aimStickLabel = hud.buildMode
    ? 'Aim Build'
    : hud.equippedWeapon === 'crowbar'
      ? 'Aim & Swing'
      : hud.equippedWeapon === 'molotov'
        ? 'Aim & Throw'
        : 'Aim & Fire';

  const lootShortLabel = isFishing
    ? hud.fishing?.canHook
      ? 'REEL!'
      : 'REEL'
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
    <div className="touch-controls fixed inset-0 z-20 pointer-events-none">
      <FloatingStick testId="touch-move-stick" side="left" label={isDriving?'Drive':'Move'} accentColor="#b7d994" onChange={(x,y)=>onMoveStick(x,y)} />
      {!isDriving && <FloatingStick testId="touch-aim-stick" side="right" label={aimStickLabel} accentColor="#ead39b" onChange={onAimStick} />}
      {/* Horizontal orientation recommendation banner if device is held vertically */}
      {isPortrait && !dismissRotateHint && (
        <div className="rotation-hint absolute top-16 left-1/2 -translate-x-1/2 pointer-events-auto hud-panel px-3 py-1.5 flex items-center gap-2 text-[11px] font-telemetry text-[#f0d078] whitespace-nowrap">
          <RotateCw className="w-3.5 h-3.5 shrink-0" />
          <span>Rotate horizontally for twin-stick play</span>
          <button
            type="button"
            onClick={() => setDismissRotateHint(true)}
            className="ml-1 px-1.5 py-0.5 bg-[#2a312e] text-[#e6e2d8] hover:text-white cursor-pointer"
          >
            OK
          </button>
        </div>
      )}

      {/* LEFT HAND CLUSTER: Movement / Steering Joystick + Contextual Left-Hand Trigger (Fire / Drift / Reel / Place) */}
      <div className="left-control-cluster absolute left-3 bottom-3 flex items-end gap-3 pointer-events-none">
        <div className="stick-spacer" style={{width:108,height:108,pointerEvents:'none'}} />

        {showLeftTrigger && (
          <button
            type="button"
            data-testid="touch-fire-btn"
            aria-label={isDriving ? 'Handbrake Drift Button' : isFishing ? 'Reel Fishing Line' : 'Left Hand Fire Button'}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                e.currentTarget.setPointerCapture?.(e.pointerId);
              } catch {
                // Synthetic PointerEvents may not register an active pointer id
              }
              setFireHeld(true);
              if (isDriving) onBrakeChange(true);
              else if (isFishing) onLoot();
              else onFireChange(true);
            }}
            onPointerUp={(e) => {
              e.preventDefault();
              setFireHeld(false);
              if (isDriving) onBrakeChange(false);
              else if (!isFishing) onFireChange(false);
            }}
            onPointerCancel={() => {
              setFireHeld(false);
              if (isDriving) onBrakeChange(false);
              else if (!isFishing) onFireChange(false);
            }}
            style={{ touchAction: 'none' }}
            className={`w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center transition-transform select-none cursor-pointer ${
              fireHeld
                ? 'bg-[#c9453e] border-[#ffd266] text-white scale-95 shadow-[0_0_16px_rgba(201,69,62,0.65)]'
                : hud.fishing?.canHook
                  ? 'bg-[#45310f]/95 border-[#ffd266] text-[#ffd266] animate-pulse shadow-[0_0_18px_rgba(255,210,102,0.5)]'
                  : 'bg-[#1a1f22]/90 border-[#d9822b] text-[#f0ece1] shadow-[0_4px_14px_rgba(0,0,0,0.6)]'
            }`}
          >
            <Crosshair className="w-5 h-5" />
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
            <button
              type="button"
              data-testid="touch-boost-btn"
              aria-label="Turbo Boost"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                } catch {
                  // Synthetic PointerEvents may not register an active pointer id
                }
                setBoostHeld(true);
                onBoostChange(true);
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                setBoostHeld(false);
                onBoostChange(false);
              }}
              onPointerCancel={() => {
                setBoostHeld(false);
                onBoostChange(false);
              }}
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

            <button
              type="button"
              data-testid="touch-repair-btn"
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

            <button
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

            <button
              type="button"
              data-testid="touch-refuel-btn"
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

            <button
              type="button"
              data-testid="touch-light-btn"
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

            <button
              type="button"
              data-testid="touch-horn-btn"
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
              {hud.nearbyDoorAction && <button type="button" data-testid="touch-door-btn" aria-label={hud.nearbyDoorAction.label}
                onPointerDown={e=>{e.preventDefault();e.stopPropagation();onDoor();}} style={{touchAction:'none'}}
                className="w-full min-h-[48px] px-3 flex items-center justify-center gap-2 cursor-pointer">
                <DoorOpen className="w-5 h-5"/><span className="font-telemetry text-[10px] font-bold">{hud.nearbyDoorAction.label}</span>
              </button>}
              {hud.nearCookingHeat && (
                <button
                  type="button"
                  data-testid="touch-cook-btn"
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
                <button
                  type="button"
                  data-testid="touch-barricade-btn"
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
                    <button
                      type="button"
                      data-testid="touch-drive-btn"
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
                    <button
                      type="button"
                      data-testid="touch-repair-nearby-btn"
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

              <div className="quick-action-rail grid grid-cols-2 gap-1.5">
              <button
                type="button"
                data-testid="touch-loot-btn"
                aria-hidden={hud.nearbyPrompt?.action === 'door' && !isFishing}
                tabIndex={hud.nearbyPrompt?.action === 'door' && !isFishing ? -1 : 0}
                aria-label="Interact or Scavenge Nearby"
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
              </button>

              <button
                type="button"
                data-testid="touch-dodge-btn"
                aria-label="Dodge Roll"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDodge();
                }}
                style={{ touchAction: 'none' }}
                className="min-w-[46px] min-h-[46px] rounded-lg border-2 border-[#3b4442] bg-[#14181a]/88 active:border-[#d9a436] text-[#e6e2d8] flex flex-col items-center justify-center cursor-pointer"
              >
                <Zap className="w-4 h-4 text-[#d9a436]" />
                <span className="font-telemetry text-[9px] font-bold">DODGE</span>
              </button>

              <button
                type="button"
                data-testid="touch-reload-btn"
                aria-label="Reload Weapon"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onReload();
                }}
                style={{ touchAction: 'none' }}
                className="min-w-[46px] min-h-[46px] rounded-lg border-2 border-[#3b4442] bg-[#14181a]/88 active:border-[#d9822b] text-[#e6e2d8] flex flex-col items-center justify-center cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4 text-[#d9822b]" />
                <span className="font-telemetry text-[9px] font-bold">RLD</span>
              </button>

              <button
                type="button"
                data-testid="touch-light-btn"
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

            <div className="stick-spacer" style={{width:104,height:104,pointerEvents:'none'}} />
          </>
        )}
      </div>
    </div>
  );
};

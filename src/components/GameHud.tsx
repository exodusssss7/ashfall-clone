import { ItemIcon } from './ItemIcon';
import React from 'react';
import {
  Backpack,
  Car,
  Flame,
  Flashlight,
  Fuel,
  Gamepad2,
  Hammer,
  Pause,
  RotateCcw,
  Siren,
  Volume2,
  VolumeX,
  Wrench,
  Zap,
} from 'lucide-react';
import { STRUCTURES, WEAPONS } from '../game/recipes';
import { canAffordCost, pickBestFoodConsumable } from '../game/survivalLogic';
import type { ConsumableItemId, HudSnapshot, StructureKind, WeaponId } from '../game/types';

interface GameHudProps {
  hud: HudSnapshot;
  muted: boolean;
  craftOpen: boolean;
  cookOpen: boolean;
  touchEnabled: boolean;
  minimapRef: React.RefObject<HTMLCanvasElement | null>;
  onSelectWeapon: (weapon: WeaponId) => void;
  onToggleBuild: (kind?: StructureKind) => void;
  onUseConsumable: (item: ConsumableItemId) => void;
  onToggleCraft: () => void;
  onToggleCook: () => void;
  onToggleTouch: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onRestart: () => void;
  onEnterExitVehicle: () => void;
  onToggleHeadlights: () => void;
  onHorn: () => void;
  onRefuel: () => void;
  onRepairVehicle: () => void;
  onPrimaryInteract: () => void;
  onBarricadeDoor: () => void;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  muted,
  craftOpen,
  cookOpen,
  touchEnabled,
  minimapRef,
  onSelectWeapon,
  onToggleBuild,
  onUseConsumable,
  onToggleCraft,
  onToggleCook,
  onToggleTouch,
  onToggleMute,
  onPause,
  onRestart,
  onEnterExitVehicle,
  onToggleHeadlights,
  onHorn,
  onRefuel,
  onRepairVehicle,
  onPrimaryInteract,
  onBarricadeDoor,
}) => {
  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const foodPct = Math.max(0, Math.min(100, hud.hunger));
  const waterPct = Math.max(0, Math.min(100, hud.thirst));
  const bestFood = pickBestFoodConsumable(hud.inventory) ?? 'food';

  const weaponOrder: WeaponId[] = ['crowbar', 'pistol', 'shotgun', 'molotov'];

  return (
    <div data-touch={touchEnabled} className="game-hud fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 md:p-4">
      {/* Low HP peripheral crimson vignette */}
      {hud.hp <= 30 && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 90px rgba(185, 32, 32, 0.55)',
          }}
        />
      )}

      {/* TOP ROW: Compact Vitality Cluster (Left) + Day/Time & Utility Cluster (Right) */}
      <div className="flex items-start justify-between gap-2 md:gap-4">
        {/* Top-Left Survival Vitals */}
        <div
          className={`vitals-panel hud-panel flex flex-col ${
            touchEnabled ? 'px-2.5 py-1.5 gap-1 min-w-[168px] md:min-w-[210px]' : 'px-3.5 py-2.5 gap-1.5 min-w-[205px] md:min-w-[230px]'
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
            <div className="flex-1 h-2.5 bg-[#121518] border border-[#2c3331] overflow-hidden">
              <div
                className="h-full"
                style={{
                  width: `${hpPct}%`,
                  backgroundColor: hud.hp <= 30 ? '#ef5350' : '#c9453e',
                }}
              />
            </div>
            <span className="font-telemetry text-xs font-bold w-10 text-right text-[#f0ece1]">
              {hud.hp}
            </span>
          </div>

          {/* Hunger & Thirst compact quick-use buttons */}
          <div className="flex items-center gap-2 pt-0.5 pointer-events-auto">
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onUseConsumable(bestFood);
              }}
              aria-label={`Eat Food (${bestFood}, key 6)`}
              title={`Eat Best Food [6]`}
              className="flex items-center gap-1 flex-1 hover:bg-[#1d2224] px-1 py-0.5 -mx-1 rounded transition-colors cursor-pointer"
            >
              <span className="font-telemetry text-[10px] uppercase tracking-wider text-[#d99b38]">
                Food
              </span>
              <div className="flex-1 h-1.5 bg-[#121518] border border-[#2c3331] overflow-hidden">
                <div className="h-full bg-[#d99b38]" style={{ width: `${foodPct}%` }} />
              </div>
              <span className="font-telemetry text-[10px] text-[#c7c2b6] text-right">
                {hud.hunger}
              </span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onUseConsumable('water');
              }}
              aria-label={`Drink Purified Water (${hud.inventory.water} left, key 7)`}
              title={`Drink Water [7] (x${hud.inventory.water})`}
              className="flex items-center gap-1 flex-1 hover:bg-[#1d2224] px-1 py-0.5 -mx-1 rounded transition-colors cursor-pointer"
            >
              <span className="font-telemetry text-[10px] uppercase tracking-wider text-[#4ea2d4]">
                H2O
              </span>
              <div className="flex-1 h-1.5 bg-[#121518] border border-[#2c3331] overflow-hidden">
                <div className="h-full bg-[#4ea2d4]" style={{ width: `${waterPct}%` }} />
              </div>
              <span className="font-telemetry text-[10px] text-[#c7c2b6] text-right">
                {hud.thirst}
              </span>
            </button>
          </div>

          {/* Bleeding or Flashlight status text */}
          <div className="flex items-center justify-between text-[11px] font-telemetry pt-0.5 border-t border-[#262b2a]">
            <span className={hud.bleeding ? 'text-[#ff5e57] font-bold' : 'text-[#8a918d]'}>
              {hud.bleeding ? 'BLEEDING · [5] BANDAGE' : `BAT ${hud.battery}%`}
            </span>
            <span className="flex items-center gap-1 text-[#c7c2b6]">
              <Flashlight className="w-3 h-3 text-[#e8cf76]" />
              {hud.flashlightOn ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        {/* Top-Right Day/Time, Kills & Utility Controls */}
        <div className="utility-cluster flex items-start gap-1.5 md:gap-2 shrink-0">
          <div className={`clock-panel hud-panel flex items-center ${touchEnabled ? 'px-2.5 py-1.5 gap-2.5' : 'px-3 py-2 gap-3'}`}>
            <div className="whitespace-nowrap">
              <div className="font-telemetry text-[10px] uppercase tracking-wider text-[#8a918d]">
                Day {hud.day} · {hud.dayPhaseLabel}
              </div>
              <div className={`font-telemetry font-bold leading-tight text-[#f0ece1] ${touchEnabled ? 'text-sm' : 'text-lg'}`}>
                {hud.timeLabel}
              </div>
            </div>

            <div className="h-6 w-px bg-[#2c3331]" />

            <div className="whitespace-nowrap">
              <div className="font-telemetry text-[10px] uppercase tracking-wider text-[#8a918d]">
                Kills · ({hud.worldCoords.gx}, {hud.worldCoords.gy})
              </div>
              <div className={`font-telemetry font-bold leading-tight text-[#e8a849] ${touchEnabled ? 'text-xs' : 'text-base'}`}>
                {hud.kills} <span className="text-[#69706c] font-normal">/</span> {hud.score}
              </div>
            </div>
          </div>

          <div className="utility-buttons flex items-center gap-1 md:gap-1.5 pointer-events-auto">
            {(hud.nearCookingHeat || cookOpen) && (
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
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

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleCraft();
              }}
              aria-label="Open Backpack and Crafting (I)"
              title="Backpack & Craft [I]"
              className={`hud-slot w-10 h-10 flex items-center justify-center transition-colors cursor-pointer ${
                craftOpen ? 'hud-slot-active text-[#f0d078]' : 'text-[#c7c2b6] hover:text-white'
              }`}
            >
              <Backpack className="w-4 h-4" /><span className="utility-label">Pack</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
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

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              aria-label={muted ? 'Unmute audio (M)' : 'Mute audio (M)'}
              title="Toggle Audio [M]"
              className="hud-slot w-10 h-10 flex items-center justify-center text-[#c7c2b6] hover:text-white transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}<span className="utility-label">Audio</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onRestart();
              }}
              aria-label="Restart Run"
              title="Restart Run"
              className="hidden sm:flex hud-slot w-10 h-10 items-center justify-center text-[#c7c2b6] hover:text-white transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" /><span className="utility-label">Reset</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
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
          <div className="hidden sm:block hud-panel p-1.5">
            <canvas
              ref={minimapRef}
              width={112}
              height={112}
              className="block pixelated w-[112px] h-[112px]"
            />
          </div>
        )}

        {/* Center Contextual Prompt + Build Bar + Hotbar or Vehicle Cockpit */}
        <div className="flex flex-col items-center gap-2 mx-auto">
          {!touchEnabled && !hud.drivingVehicle && (hud.fishing || hud.nearbyPrompt || hud.nearbyVehiclePrompt) && (
            <div className="flex flex-wrap items-center justify-center gap-2 pointer-events-auto">
              {hud.fishing && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
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
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
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
                      onClick={(e) => {
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
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={!hud.nearbyVehiclePrompt.canDrive}
                    onClick={(e) => {
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
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
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
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onRefuel();
                      }}
                      title="Refuel [R]"
                      className="hud-slot px-2 py-1 text-[11px] font-telemetry text-[#d99b38] hover:text-white flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Fuel className="w-3 h-3" />
                      [R] {hud.inventory.fuel}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
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
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
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
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
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
                      onClick={(e) => {
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
                        onClick={(e) => {
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
                    onClick={(e) => {
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
              {/* Main 5-Slot Hotbar + Build Toggle */}
              <div className="equipment-bar flex items-center gap-1 md:gap-1.5 pointer-events-auto">
                {weaponOrder.map((wId) => {
                  const spec = WEAPONS[wId];
                  const active = hud.equippedWeapon === wId && !hud.buildMode;
                  let ammoText = 'INF';
                  if (wId === 'pistol') ammoText = `${hud.pistolMag}/${hud.inventory.ammo_9mm}`;
                  if (wId === 'shotgun') ammoText = `${hud.shotgunMag}/${hud.inventory.ammo_shell}`;
                  if (wId === 'molotov') ammoText = `x${hud.inventory.molotov}`;

                  const shortName =
                    wId === 'pistol'
                      ? 'Pistol'
                      : wId === 'shotgun'
                        ? 'Shotgun'
                        : spec.name;

                  return (
                    <button
                      key={wId}
                      data-item={wId}
                      aria-label={`Equip ${spec.name}`}
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onSelectWeapon(wId);
                      }}
                      className={`${
                        touchEnabled
                          ? 'px-1.5 py-1.5 min-w-[50px] min-h-[44px]'
                          : 'px-3 py-2 min-w-[78px]'
                      } flex flex-col items-start transition-colors cursor-pointer ${
                        active ? 'hud-slot-active' : 'hud-slot hover:border-[#56615d]'
                      }`}
                    >
                      <div className="w-full flex items-center justify-between gap-1.5 text-[10px] font-telemetry text-[#8a918d]">
                        <span>[{spec.key}]</span>
                        <span className={active ? 'text-[#f0d078] font-bold' : 'text-[#c7c2b6]'}>
                          {ammoText}
                        </span>
                      </div>
                      <ItemIcon kind={wId} className="equipment-icon" />
                      <div className="equipment-name font-tactical text-[11px] md:text-xs font-bold text-[#f0ece1] mt-0.5 whitespace-nowrap">
                        {touchEnabled ? shortName : spec.name}
                      </div>
                    </button>
                  );
                })}

                {/* Slot 5: Quick Bandage */}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onUseConsumable('bandage');
                  }}
                  className={`hud-slot hover:border-[#56615d] ${
                    touchEnabled ? 'px-1.5 py-1.5 min-w-[48px] min-h-[44px]' : 'px-3 py-2 min-w-[74px]'
                  } flex flex-col items-start transition-colors cursor-pointer`}
                >
                  <div className="w-full flex items-center justify-between gap-1.5 text-[10px] font-telemetry text-[#8a918d]">
                    <span>[5]</span>
                    <span className="text-[#c7c2b6]">x{hud.inventory.bandage}</span>
                  </div>
                  <ItemIcon kind="bandage" className="equipment-icon" />
                  <div className="equipment-name font-tactical text-[11px] md:text-xs font-bold text-[#f0ece1] mt-0.5 whitespace-nowrap">
                    {touchEnabled ? 'Heal' : 'Bandage'}
                  </div>
                </button>

                {/* Build Mode Toggle */}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onToggleBuild();
                  }}
                  className={`${
                    touchEnabled ? 'px-1.5 py-1.5 min-w-[46px] min-h-[44px]' : 'px-3 py-2 min-w-[74px]'
                  } flex flex-col items-start transition-colors cursor-pointer ${
                    hud.buildMode ? 'hud-slot-active' : 'hud-slot hover:border-[#56615d]'
                  }`}
                >
                  <div className="w-full flex items-center justify-between gap-1.5 text-[10px] font-telemetry text-[#8a918d]">
                    <span>[B]</span>
                    <Hammer className="w-3 h-3 text-[#d9822b]" />
                  </div>
                  <ItemIcon kind="build" className="equipment-icon" />
                  <div className="equipment-name font-tactical text-[11px] md:text-xs font-bold text-[#f0ece1] mt-0.5 whitespace-nowrap">
                    Build
                  </div>
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
    </div>
  );
};

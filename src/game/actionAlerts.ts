import { COOK_RECIPES } from './recipes';
import { canAffordCost, pickBestFoodConsumable } from './survivalLogic';
import { formatRestCooldown } from './restCooldown';
import type { HudSnapshot } from './types';

export type ActionState = 'idle' | 'ready' | 'urgent' | 'timed' | 'active' | 'warning' | 'cooldown';
export interface ActionCue { state: ActionState; reason: string }
const cue = (state: ActionState, reason: string): ActionCue => ({ state, reason });
export function vehicleRepairCue(hpPct: number, canRepair: boolean): ActionCue {
  if (hpPct >= 100) return cue('idle', 'Hull intact');
  if (!canRepair) return cue('warning', 'Damaged hull: need more scrap to repair');
  return cue(hpPct <= 30 ? 'urgent' : 'ready', hpPct <= 30 ? 'Critical hull: repair now' : 'Damaged hull: repair available');
}
export function canCookAnything(h: Pick<HudSnapshot,'nearCookingHeat'|'inventory'>): boolean {
  return h.nearCookingHeat && COOK_RECIPES.some(r => canAffordCost(h.inventory, r.cost));
}
export function getActionCues(h: HudSnapshot) {
  const car = h.drivingVehicle;
  const repair = car ? vehicleRepairCue(car.hp / car.maxHp * 100, car.canRepair) : cue('idle', 'No vehicle');
  const nearbyRepair = h.nearbyVehiclePrompt ? vehicleRepairCue(h.nearbyVehiclePrompt.hpPct, h.nearbyVehiclePrompt.canRepair) : cue('idle', 'No vehicle nearby');
  const fuel = !car || car.fuel >= 95 ? cue('idle', 'Fuel sufficient')
    : h.inventory.fuel <= 0 ? cue('warning', 'Need a fuel can to refuel')
    : cue(car.fuel <= 15 ? 'urgent' : car.fuel <= 50 ? 'ready' : 'idle', car.fuel <= 15 ? 'Low fuel: refuel now' : 'Refuel available');
  const fishing = h.fishing ? h.fishing.canHook ? cue('timed', 'Fish biting: reel now!') : cue('active', h.fishing.phase === 'casting' ? 'Casting line' : h.fishing.phase === 'reeling' ? 'Reeling in catch' : 'Line cast: wait for the bite') : null;
  const rest = h.restCooldownSeconds > 0 ? cue('cooldown', `Rest in ${formatRestCooldown(h.restCooldownSeconds)} of awake play`)
    : !h.restSafe ? cue('warning', 'Unsafe to rest: infected nearby') : cue('ready', 'Rest available');
  const interact = fishing ?? (h.nearbyPrompt?.action === 'sleep' ? rest
    : h.nearbyPrompt ? cue('ready', h.nearbyPrompt.label) : cue('idle', 'Nothing in reach'));
  const mag = h.equippedWeapon === 'pistol' ? h.pistolMag : h.shotgunMag;
  const maxMag = h.equippedWeapon === 'pistol' ? h.pistolMagSize : h.shotgunMagSize;
  const reserve = h.equippedWeapon === 'pistol' ? h.inventory.ammo_9mm : h.inventory.ammo_shell;
  const firearm = h.equippedWeapon === 'pistol' || h.equippedWeapon === 'shotgun';
  const reload = !firearm ? cue('idle', 'Select a firearm to reload') : h.isReloading ? cue('active', 'Reloading')
    : mag >= maxMag ? cue('idle', 'Magazine full') : reserve <= 0 ? cue('warning', 'No reserve ammunition')
    : cue(mag === 0 ? 'urgent' : mag <= Math.ceil(maxMag * .25) ? 'ready' : 'idle', mag === 0 ? 'Magazine empty: reload now' : 'Reload available');
  const dark = h.dayPhaseLabel === 'NIGHTFALL' || h.dayPhaseLabel === 'DUSK';
  const lightOn = car ? car.headlightsOn : h.flashlightOn;
  const light = !car && h.battery <= 0 ? cue('warning', 'Flashlight battery empty') : lightOn ? cue('active', 'Lights on')
    : dark ? cue('ready', 'Dark outside: switch lights on') : cue('idle', 'Lights off');
  const cookable = canCookAnything(h);
  const cook = cookable ? cue('ready', 'Heat and ingredients ready') : cue('warning', 'Need heat and recipe ingredients');
  const food = pickBestFoodConsumable(h.inventory) !== null;
  const survival = (value: number, available: boolean, name: string) => !available
    ? cue(value <= 30 ? 'warning' : 'idle', `No ${name} available`)
    : cue(value <= 20 ? 'urgent' : value <= 55 ? 'ready' : 'idle', `${name} available`);
  return { repair, nearbyRepair, fuel, interact, fishing, rest, reload, light, cook,
    door: h.nearbyDoorAction ? cue('ready', h.nearbyDoorAction.label) : cue('idle', 'No door nearby'),
    board: h.inventory.wood >= 2 ? cue('ready', 'Barricade available (2 wood)') : cue('warning', 'Need 2 wood'),
    drive: cue(h.nearbyVehiclePrompt?.canDrive ? 'ready' : 'idle', 'Enter vehicle'),
    boost: cue(car?.boosting ? 'active' : 'idle', 'Turbo boost'),
    horn: cue(car?.sirenOn ? 'active' : 'idle', 'Horn or siren'),
    dodge: cue(h.dodgeReady ? 'idle' : 'cooldown', h.dodgeReady ? 'Dodge ready' : 'Dodge recovering'),
    food: survival(h.hunger, food, 'food'), water: survival(h.thirst, h.inventory.water > 0, 'water'),
    heal: h.inventory.bandage <= 0 ? cue(h.hp <= 30 || h.bleeding ? 'warning' : 'idle', 'Need a bandage')
      : cue(h.bleeding || h.hp <= 30 ? 'urgent' : h.hp < h.maxHp ? 'ready' : 'idle', h.bleeding ? 'Bleeding: use bandage' : 'Bandage available'),
  };
}
export const actionCueProps = (c: ActionCue) => ({ 'data-action-state': c.state, title: c.reason });

import test from 'node:test';
import assert from 'node:assert/strict';
import { getActionCues, vehicleRepairCue } from './actionAlerts';
import { createInitialInventory } from './survivalLogic';
import { BED_REST_COOLDOWN_SECONDS, tickRestCooldown, formatRestCooldown } from './restCooldown';
import type { HudSnapshot } from './types';
const hud = (patch: Partial<HudSnapshot> = {}): HudSnapshot => ({
  hp: 100, maxHp: 100, hunger: 88, thirst: 86, bleeding: false, battery: 100, flashlightOn: false,
  equippedWeapon: 'pistol', pistolMag: 12, pistolMagSize: 12, shotgunMag: 6, shotgunMagSize: 6,
  isReloading: false, inventory: createInitialInventory(), restCooldownSeconds: 0, restSafe: true,
  dodgeReady: true, dayPhaseLabel: 'DAYLIGHT', ...patch,
} as HudSnapshot);

test('repair warns steadily without scrap, pulses only for critical repairable hull', () => {
  assert.equal(vehicleRepairCue(100, true).state, 'idle');
  assert.equal(vehicleRepairCue(70, true).state, 'ready');
  assert.equal(vehicleRepairCue(30, true).state, 'urgent');
  assert.equal(vehicleRepairCue(0, false).state, 'warning');
});
test('fishing wait is steady; only the bite window pulses; cast is ready', () => {
  assert.equal(getActionCues(hud({ fishing: {phase:'waiting', canHook:false, biteProgress:0} })).interact.state, 'active');
  assert.equal(getActionCues(hud({ fishing: {phase:'bite', canHook:true, biteProgress:.4} })).interact.state, 'timed');
  assert.equal(getActionCues(hud({ nearbyPrompt: {action:'fishing',label:'Cast',key:'E',progress:0} })).interact.state, 'ready');
});
test('reload cues track actual weapon, ammunition and reload state', () => {
  const h=hud();h.inventory.ammo_9mm=10;
  assert.equal(getActionCues(h).reload.state,'idle');
  h.pistolMag=2;assert.equal(getActionCues(h).reload.state,'ready');
  h.pistolMag=0;assert.equal(getActionCues(h).reload.state,'urgent');
  h.isReloading=true;assert.equal(getActionCues(h).reload.state,'active');
  h.isReloading=false;h.inventory.ammo_9mm=0;assert.equal(getActionCues(h).reload.state,'warning');
  h.equippedWeapon='crowbar';assert.equal(getActionCues(h).reload.state,'idle');
});
test('survival cues pulse only when an urgent action has supplies', () => {
  const h=hud({hp:20,hunger:15,thirst:15});h.inventory.food=1;h.inventory.bandage=1;h.inventory.water=1;
  for(const key of ['food','water','heal'] as const)assert.equal(getActionCues(h)[key].state,'urgent');
  h.inventory.food=0;h.inventory.bandage=0;h.inventory.water=0;
  for(const key of ['food','water','heal'] as const)assert.equal(getActionCues(h)[key].state,'warning');
});
test('rest cooldown overrides readiness and unsafe rest never advertises ready', () => {
  assert.equal(getActionCues(hud({restCooldownSeconds:90})).rest.state,'cooldown');
  assert.equal(getActionCues(hud({restSafe:false})).rest.state,'warning');
  assert.equal(getActionCues(hud()).rest.state,'ready');
});
test('rest gap uses one awake minute, not the sleep clock skip or paused time', () => {
  assert.equal(BED_REST_COOLDOWN_SECONDS,60);
  assert.equal(tickRestCooldown(180,100,false),180);
  assert.equal(tickRestCooldown(180,60,true),120);
  assert.equal(tickRestCooldown(1,2,true),0);
  assert.equal(formatRestCooldown(179.1),'3:00');
  assert.equal(formatRestCooldown(59),'0:59');
});

test('cook controls only appear near heat with ingredients for at least one recipe', async () => {
  const { canCookAnything } = await import('./actionAlerts');
  const inv = (o: Record<string, number>) => ({ raw_fish: 0, water: 0, food: 0, wood: 0, ...o }) as any;
  assert.equal(canCookAnything({ nearCookingHeat: true, inventory: inv({}) }), false);
  assert.equal(canCookAnything({ nearCookingHeat: false, inventory: inv({ raw_fish: 2 }) }), false);
  assert.equal(canCookAnything({ nearCookingHeat: true, inventory: inv({ raw_fish: 1 }) }), true);
  assert.equal(canCookAnything({ nearCookingHeat: true, inventory: inv({ wood: 1 }) }), true);
});

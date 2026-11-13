import test from 'node:test';
import assert from 'node:assert/strict';
import { worldToIso, isoToWorld, hasLineOfSight, screenVectorToIsoWorld } from './isometric';
import {
  canAffordCost,
  spendCost,
  createInitialInventory,
  createInitialPlayer,
  generateWorld,
  useConsumableItem,
  tickSurvivalNeeds,
  getDaylightInfo,
  isTargetInMeleeArc,
  canPlaceStructureAt,
  computeZombieSteering,
  getBuildTargetTile,
  computeCombatDamage,
  stepVehiclePhysics,
  computeRamImpact,
  findVehicleExitPosition,
  isCircleBlocked,
  getTileColliderHalfExtents,
  getWorldCell,
  findFishingSpot,
  toggleDoorState,
  barricadeDoorWithWood,
  advanceDoorLockpick,
  repairVehicleWithScrap,
  pickBestFoodConsumable,
} from './survivalLogic';
import { COOK_RECIPES, CRAFT_RECIPES } from './recipes';

test('isometric projection round-trip preserves world coordinates', () => {
  const samples = [
    { wx: 0, wy: 0 },
    { wx: 28.5, wy: 28.5 },
    { wx: 12.25, wy: 41.75 },
  ];
  for (const s of samples) {
    const iso = worldToIso(s.wx, s.wy, 0);
    const back = isoToWorld(iso.sx, iso.sy);
    assert.ok(Math.abs(back.wx - s.wx) < 1e-6);
    assert.ok(Math.abs(back.wy - s.wy) < 1e-6);
  }
});

test('screenVectorToIsoWorld maps screen stick axes to isometric world directions', () => {
  const up = screenVectorToIsoWorld(0, -1);
  assert.ok(up.wx < -0.7 && up.wy < -0.7);
  const right = screenVectorToIsoWorld(1, 0);
  assert.ok(right.wx > 0.7 && right.wy < -0.7);
  const down = screenVectorToIsoWorld(0, 1);
  assert.ok(down.wx > 0.7 && down.wy > 0.7);
  const left = screenVectorToIsoWorld(-1, 0);
  assert.ok(left.wx < -0.7 && left.wy > 0.7);
  const zero = screenVectorToIsoWorld(0, 0);
  assert.equal(zero.wx, 0);
  assert.equal(zero.wy, 0);
});

test('generated world spawns player on open clear road/camp space and populates drivable vehicles', () => {
  const world = generateWorld(1994);
  const gx = Math.floor(world.spawnX);
  const gy = Math.floor(world.spawnY);
  assert.equal(world.grid[gy][gx].solid, false);
  // Ensure 3x3 area around spawn is unobstructed
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      assert.equal(world.grid[gy + dy][gx + dx].solid, false);
    }
  }
  assert.ok(world.containers.length >= 8);
  assert.ok(world.structures.some((s) => s.kind === 'campfire'));
  assert.ok(world.vehicles.length >= 4);
  assert.ok(world.vehicles.some((v) => v.kind === 'police'));
  assert.ok(world.doors.length >= 6);
});

test('infinite world streams deterministic chunks beyond starter sector including negative coords', () => {
  const worldA = generateWorld(1994);
  const worldB = generateWorld(1994);
  const negA = getWorldCell(worldA.worldStore, -18, -22);
  const negB = getWorldCell(worldB.worldStore, -18, -22);
  assert.equal(negA.tile, negB.tile);
  assert.equal(negA.prop, negB.prop);
  assert.equal(negA.solid, negB.solid);

  const farEast = getWorldCell(worldA.worldStore, 84, 28);
  assert.equal(farEast.tile, 'road'); // repeating county highway!
  assert.equal(farEast.solid, false);
});

test('lakeside pier spawns over water and supports fishing spot detection', () => {
  const world = generateWorld(1994);
  const pierCell = getWorldCell(world.worldStore, 40, 8);
  assert.equal(pierCell.tile, 'pier');
  assert.equal(pierCell.solid, false);

  const spot = findFishingSpot(world.worldStore, 40.5, 8.5);
  assert.ok(spot !== null);
  assert.equal(spot!.onPier, true);
  assert.equal(getWorldCell(world.worldStore, Math.floor(spot!.bobberX), Math.floor(spot!.bobberY)).tile, 'water');

  // Crossroads road has no water nearby
  assert.equal(findFishingSpot(world.worldStore, 28.5, 28.5), null);
});

test('line of sight detects solid brick walls', () => {
  const world = generateWorld(1994);
  // NW building wall around (14, 15) blocks sight from (12, 17) to (18, 17)
  assert.equal(hasLineOfSight(world.grid, 12.5, 17.5, 18.5, 17.5, true), false);
  // Open crossroads road has clear line of sight
  assert.equal(hasLineOfSight(world.grid, 27.5, 28.5, 31.5, 28.5, true), true);
});

test('crafting and cooking recipes check and deduct inventory resources accurately', () => {
  let inv = createInitialInventory();
  const barricadeRecipe = CRAFT_RECIPES.find((r) => r.id === 'craft_barricade')!;
  assert.equal(canAffordCost(inv, barricadeRecipe.cost), true);
  inv = spendCost(inv, barricadeRecipe.cost);
  assert.equal(inv.wood, 3); // started with 6, spent 3
  assert.equal(inv.scrap, 3); // started with 4, spent 1

  inv.raw_fish = 1;
  const stew = COOK_RECIPES.find((r) => r.id === 'cook_fish_stew')!;
  assert.equal(canAffordCost(inv, stew.cost), true);
  inv = spendCost(inv, stew.cost);
  inv.fish_stew += 1;
  assert.equal(inv.raw_fish, 0);
  assert.equal(inv.water, 1);
  assert.equal(pickBestFoodConsumable(inv), 'fish_stew');
});

test('consumables heal bleeding, hunger, hydration, and cooked fish meals properly', () => {
  const inv = { ...createInitialInventory(), fish_stew: 1 };
  const player = {
    ...createInitialPlayer(),
    hp: 50,
    hunger: 40,
    thirst: 35,
    bleeding: true,
  };

  const afterBandage = useConsumableItem(player, inv, 'bandage');
  assert.equal(afterBandage.used, true);
  assert.equal(afterBandage.player.bleeding, false);
  assert.equal(afterBandage.player.hp, 85);
  assert.equal(afterBandage.inventory.bandage, 1);

  const afterStew = useConsumableItem(afterBandage.player, afterBandage.inventory, 'fish_stew');
  assert.equal(afterStew.used, true);
  assert.equal(afterStew.player.hunger, 98);
  assert.equal(afterStew.player.thirst, 75);
  assert.equal(afterStew.player.hp, 100);
});

test('survival needs decay faster when sprinting and drain HP when bleeding', () => {
  const p = { ...createInitialPlayer(), bleeding: true, hp: 100 };
  const after = tickSurvivalNeeds(p, 2.0, true, false);
  assert.equal('stamina' in after, false);
  assert.ok(after.thirst < p.thirst);
  assert.ok(after.hp < 100);
});

test('day-night cycle transitions cleanly from daylight to dusk to nightfall', () => {
  const noon = getDaylightInfo(12 * 60);
  assert.equal(noon.phaseLabel, 'DAYLIGHT');
  assert.ok(noon.darkness < 0.2);

  const night = getDaylightInfo(22 * 60);
  assert.equal(night.phaseLabel, 'NIGHTFALL');
  assert.ok(night.darkness > 0.7);
});

test('melee arc and structure placement checks enforce spatial rules', () => {
  assert.equal(isTargetInMeleeArc(10, 10, 0, 11.2, 10, 1.85, 0.75), true);
  assert.equal(isTargetInMeleeArc(10, 10, 0, 8.5, 10, 1.85, 0.75), false);

  const world = generateWorld(1994);
  assert.equal(canPlaceStructureAt(world.grid, world.structures, 29, 29, 28.5, 28.5), true);
  // Cannot place directly on top of player
  assert.equal(canPlaceStructureAt(world.grid, world.structures, 28, 28, 28.5, 28.5), false);
});

test('doors support swing open/close, lockpicking, and wood barricading', () => {
  const world = generateWorld(1994);
  const closedDoor = world.doors.find((d) => d.status === 'closed')!;
  const closedCell = getWorldCell(world.worldStore, closedDoor.gx, closedDoor.gy);
  assert.equal(closedCell.solid, true);

  const opened = toggleDoorState(closedDoor, closedCell);
  assert.equal(opened.changed, true);
  assert.equal(closedDoor.status, 'open');
  assert.equal(closedCell.solid, false);
  assert.equal(closedCell.blocksSight, false);

  const inv = createInitialInventory();
  const barRes = barricadeDoorWithWood(closedDoor, closedCell, inv);
  assert.equal(barRes.barricaded, true);
  assert.equal(barRes.inventory.wood, 4);
  assert.equal(closedDoor.status, 'barricaded');
  assert.equal(closedCell.solid, true);

  const lockedDoor = world.doors.find((d) => d.status === 'locked')!;
  const lockedCell = getWorldCell(world.worldStore, lockedDoor.gx, lockedDoor.gy);
  assert.equal(toggleDoorState(lockedDoor, lockedCell).changed, false);
  advanceDoorLockpick(lockedDoor, lockedCell, 0.5);
  assert.equal(lockedDoor.status, 'locked');
  const picked = advanceDoorLockpick(lockedDoor, lockedCell, 0.5);
  assert.equal(picked.unlocked, true);
  assert.equal(lockedDoor.status, 'open');
  assert.equal(lockedCell.solid, false);
});

test('computeZombieSteering routes around solid walls', () => {
  const world = generateWorld(1994);
  // Directly left of NW clinic brick wall at x=14, y=17
  const steer = computeZombieSteering(world.grid, 13.4, 17.5, 18.5, 17.5);
  const nextX = Math.floor(13.4 + steer.dx * 0.72);
  const nextY = Math.floor(17.5 + steer.dy * 0.72);
  assert.equal(world.grid[nextY][nextX].solid, false);
});

test('getBuildTargetTile places within valid build distance during touch virtual aim', () => {
  const world = generateWorld(1994);
  // Even when virtual cursor is projected 4.5 tiles out, touch build snaps 1.65 tiles ahead
  const tile = getBuildTargetTile(28.5, 28.5, 0, 33.0, 28.5, true);
  assert.equal(canPlaceStructureAt(world.grid, world.structures, tile.gx, tile.gy, 28.5, 28.5), true);
});

test('computeCombatDamage applies critical multiplier cleanly', () => {
  const crit = computeCombatDamage(40, 0.05, 0.18);
  assert.equal(crit.isCrit, true);
  assert.equal(crit.damage, 64);

  const normal = computeCombatDamage(40, 0.5, 0.18);
  assert.equal(normal.isCrit, false);
  assert.equal(normal.damage, 40);
});

test('stepVehiclePhysics accelerates, boosts, steers, drifts, and repairs with scrap', () => {
  const world = generateWorld(1994);
  let car = { ...world.vehicles[0], speed: 0, vx: 0, vy: 0, fuel: 80, hp: 140 };
  const initialAngle = car.angle;

  for (let i = 0; i < 20; i++) {
    car = stepVehiclePhysics(car, 1, 0.8, false, 0.05, false);
  }
  assert.ok(car.speed > 4);
  assert.ok(car.angle > initialAngle);
  assert.ok(car.fuel < 80);

  let boosted = { ...world.vehicles[0], speed: 6, vx: 6, vy: 0, fuel: 80 };
  for (let i = 0; i < 20; i++) {
    boosted = stepVehiclePhysics(boosted, 1, 0, false, 0.05, true);
  }
  assert.equal(boosted.boosting, true);
  assert.ok(boosted.speed > 10.8);

  const driftingCar = stepVehiclePhysics(car, 0, 1, true, 0.05);
  assert.equal(driftingCar.drifting, true);

  const emptyFuel = stepVehiclePhysics({ ...car, fuel: 0, speed: 0 }, 1, 0, false, 0.1);
  assert.equal(emptyFuel.speed, 0);

  const repairRes = repairVehicleWithScrap(car, createInitialInventory());
  assert.equal(repairRes.repaired, true);
  assert.equal(repairRes.vehicle.hp, 225);
  assert.equal(repairRes.inventory.scrap, 2);
});

test('computeRamImpact scales damage with speed and boost and ignores stationary bumps', () => {
  const slow = computeRamImpact(0.9);
  assert.equal(slow.damage, 0);
  assert.equal(slow.heavy, false);

  const fast = computeRamImpact(7.2, false);
  const boostedFast = computeRamImpact(7.2, true);
  assert.ok(fast.damage >= 90);
  assert.ok(boostedFast.damage > fast.damage);
  assert.equal(fast.heavy, true);
});

test('findVehicleExitPosition avoids solid tiles beside the car', () => {
  const world = generateWorld(1994);
  const exit = findVehicleExitPosition(world.grid, 23.0, 27.2, 0, world.vehicles, world.vehicles[0].id);
  assert.equal(isCircleBlocked(world.grid, exit.x, exit.y, 0.22, world.vehicles, world.vehicles[0].id), false);
});

test('isCircleBlocked uses tight per-prop and rotated vehicle bounds without invisible forcefields', () => {
  const world = generateWorld(1994);
  const playerRadius = 0.22;

  // Hydrant at (25, 22) has tight 0.13 half-extent: center blocks, outer corner of same tile is walkable!
  const hydrantCell = world.grid[22][25];
  assert.equal(hydrantCell.prop, 'hydrant');
  assert.deepEqual(getTileColliderHalfExtents(hydrantCell), { hx: 0.13, hy: 0.13 });
  assert.equal(isCircleBlocked(world.grid, 25.5, 22.5, playerRadius), true);
  assert.equal(isCircleBlocked(world.grid, 25.1, 22.1, playerRadius), false);

  // Concrete barrier at (15, 26) is narrow along Y (hy=0.19): front/back sidewalk space is passable
  assert.equal(isCircleBlocked(world.grid, 15.5, 26.06, playerRadius), false);
  assert.equal(isCircleBlocked(world.grid, 15.5, 26.5, playerRadius), true);

  // Full brick wall at (14, 15) blocks seamlessly across the tile
  assert.equal(isCircleBlocked(world.grid, 14.1, 15.1, playerRadius), true);

  // Police cruiser #1 at (23.0, 27.2, angle=0): side passing at y+0.72 is clear while cabin center blocks
  const cruiser = world.vehicles[0];
  assert.equal(isCircleBlocked(world.grid, cruiser.x, cruiser.y, playerRadius, world.vehicles, null), true);
  assert.equal(isCircleBlocked(world.grid, cruiser.x, cruiser.y + 0.72, playerRadius, world.vehicles, null), false);
});

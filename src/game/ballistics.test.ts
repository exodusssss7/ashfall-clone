import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BULLET_SPEED,
  FPS_CEILING_HEIGHT,
  HEADSHOT_MULTIPLIER_BULLET,
  HEADSHOT_MULTIPLIER_PELLET,
  PELLET_SPEED,
  classifySurfaceMaterial,
  computeProjectileVelocity3D,
  mapMaterialToDecalKind,
  traceSegmentWorldHit,
  traceSegmentZombieHit,
} from './ballistics';
import type { DoorEntity, PropKind, TileCell, TileKind, Vehicle, WorldStructure, Zombie } from './types';

function makeCell(gx: number, gy: number, tile: TileKind = 'sidewalk', prop: PropKind = 'none'): TileCell {
  return {
    gx,
    gy,
    tile,
    prop,
    solid: prop !== 'none',
    blocksSight: prop === 'wall_brick' || prop === 'wall_wood' || prop === 'wall_interior',
    variant: 0,
    explored: true,
  };
}

function makeZombie(id: number, x: number, y: number, archetype: Zombie['archetype'] = 'walker'): Zombie {
  return {
    id,
    archetype,
    x,
    y,
    vx: 0,
    vy: 0,
    facingX: 1,
    facingY: 0,
    hp: 75,
    maxHp: 75,
    speed: 1.5,
    state: 'chase',
    stateTimer: 0,
    wanderTargetX: x,
    wanderTargetY: y,
    lastHeardX: null,
    lastHeardY: null,
    walkCycle: 0,
    hitFlash: 0,
    bleedTimer: 0,
    burnTimer: 0,
    hasAttackToken: false,
    scaleX: 1,
    scaleY: 1,
    koRotation: 0,
    variant: 0,
  };
}

test('modern ballistic speeds and 3D unit velocity alignment', () => {
  assert.ok(BULLET_SPEED >= 70, 'pistol bullets must travel fast like modern shooters');
  assert.ok(PELLET_SPEED >= 60, 'shotgun pellets must travel fast');
  assert.ok(HEADSHOT_MULTIPLIER_BULLET >= 2.0);
  assert.ok(HEADSHOT_MULTIPLIER_PELLET >= 1.8);

  const vel = computeProjectileVelocity3D(0, Math.PI / 6, 0, 0, BULLET_SPEED);
  const mag = Math.hypot(vel.vx, vel.vy, vel.vz);
  assert.ok(Math.abs(mag - BULLET_SPEED) < 1e-6);
  assert.ok(Math.abs(vel.vz - BULLET_SPEED * 0.5) < 1e-6);
});

test('swept world trace catches high-speed bullet hitting 1-tile brick wall with exact normal and zero tunneling', () => {
  const getCell = (gx: number, gy: number) =>
    gx === 5 && gy === 5 ? makeCell(gx, gy, 'sidewalk', 'wall_brick') : makeCell(gx, gy, 'sidewalk', 'none');

  // Segment spans 2.5 tiles in a single frame — would have tunneled past a 1-tile wall without swept trace!
  const hit = traceSegmentWorldHit(3.8, 5.5, 0.88, 6.4, 5.5, 0.88, true, getCell, [], [], []);
  assert.ok(hit !== null);
  assert.ok(Math.abs(hit.hx - 5.0) < 1e-6);
  assert.equal(hit.nx, -1);
  assert.equal(hit.ny, 0);
  assert.equal(hit.nz, 0);
  assert.equal(hit.material, 'stone');
  assert.equal(hit.allowDecal, true);
  assert.equal(mapMaterialToDecalKind(hit.material), 'stone');
});

test('swept world trace hits wooden doors, floor, ceiling, and parked vehicles with proper materials', () => {
  const getCell = (gx: number, gy: number) => {
    if (gx === 4 && gy === 4) return makeCell(gx, gy, 'floor', 'door');
    if (gx === 6 && gy === 6) return makeCell(gx, gy, 'floor', 'none');
    if (gx === 7 && gy === 7) return makeCell(gx, gy, 'water', 'none');
    return makeCell(gx, gy, 'grass', 'none');
  };
  const doors: DoorEntity[] = [
    {
      id: 'd1',
      gx: 4,
      gy: 4,
      orientation: 'ns',
      status: 'closed',
      openProgress: 0,
      hp: 100,
      maxHp: 100,
      barricadeHp: 0,
      maxBarricadeHp: 100,
      lockpickProgress: 0,
      hitFlash: 0,
    },
  ];
  const vehicles: Vehicle[] = [
    {
      id: 42,
      kind: 'sedan',
      x: 10,
      y: 10,
      angle: 0,
      speed: 0,
      vx: 0,
      vy: 0,
      hp: 100,
      maxHp: 100,
      fuel: 80,
      headlightsOn: false,
      sirenOn: false,
      hitFlash: 0,
      drifting: false,
      boosting: false,
    },
  ];
  const structs: WorldStructure[] = [];

  // Closed door -> wood
  const doorHit = traceSegmentWorldHit(3.8, 4.5, 0.8, 4.9, 4.5, 0.8, true, getCell, doors, structs, vehicles);
  assert.ok(doorHit !== null);
  assert.equal(doorHit.material, 'wood');
  assert.equal(doorHit.nx, -1);

  // Indoor ceiling -> stone, normal pointing down
  const ceilHit = traceSegmentWorldHit(6.5, 6.5, 1.3, 6.5, 6.5, FPS_CEILING_HEIGHT + 0.25, true, getCell, [], [], []);
  assert.ok(ceilHit !== null);
  assert.equal(ceilHit.nz, -1);
  assert.equal(ceilHit.material, 'stone');
  assert.equal(ceilHit.allowDecal, true);

  // Water floor -> water, no decal
  const waterHit = traceSegmentWorldHit(7.5, 7.5, 0.5, 7.5, 7.5, -0.2, true, getCell, [], [], []);
  assert.ok(waterHit !== null);
  assert.equal(waterHit.material, 'water');
  assert.equal(waterHit.allowDecal, false);

  // Vehicle -> metal, vehicleId set
  const carHit = traceSegmentWorldHit(8.0, 10.0, 0.55, 10.5, 10.0, 0.55, true, getCell, [], [], vehicles);
  assert.ok(carHit !== null);
  assert.equal(carHit.material, 'metal');
  assert.equal(carHit.vehicleId, 42);

  // Streetlamp thin pole -> metal spark hit, no overhanging decal
  const lampCell = (gx: number, gy: number) =>
    gx === 3 && gy === 3 ? makeCell(gx, gy, 'sidewalk', 'streetlamp') : makeCell(gx, gy, 'sidewalk', 'none');
  const lampHit = traceSegmentWorldHit(2.5, 3.5, 0.88, 4.0, 3.5, 0.88, true, lampCell, [], [], []);
  assert.ok(lampHit !== null);
  assert.equal(lampHit.material, 'metal');
  assert.equal(lampHit.allowDecal, false);
});

test('surface material classifier distinguishes stone, wood, metal, dirt, water', () => {
  assert.equal(classifySurfaceMaterial('road', 'wall_brick'), 'stone');
  assert.equal(classifySurfaceMaterial('sidewalk', 'wall_wood'), 'wood');
  assert.equal(classifySurfaceMaterial('road', 'dumpster'), 'metal');
  assert.equal(classifySurfaceMaterial('grass', 'none'), 'dirt');
  assert.equal(classifySurfaceMaterial('water', 'none'), 'water');
  assert.equal(classifySurfaceMaterial('sidewalk', 'none', 'barricade'), 'wood');
});

test('FPS headshot hitbox distinguishes head shots from chest shots and respects wall occlusion', () => {
  const z = makeZombie(1, 5.0, 5.0, 'walker');
  const bloater = makeZombie(2, 8.0, 8.0, 'bloater');

  // Eye-level shot at 0.88 height hits walker head
  const headHit = traceSegmentZombieHit(3.0, 5.0, 0.88, 6.0, 5.0, 0.88, [z], true);
  assert.ok(headHit !== null);
  assert.equal(headHit.zombie.id, 1);
  assert.equal(headHit.isHeadshot, true);

  // Chest-level shot at 0.50 height hits body, not head
  const bodyHit = traceSegmentZombieHit(3.0, 5.0, 0.50, 6.0, 5.0, 0.50, [z], true);
  assert.ok(bodyHit !== null);
  assert.equal(bodyHit.isHeadshot, false);

  // High miss above head (> 1.08) misses standard walker
  const missAbove = traceSegmentZombieHit(3.0, 5.0, 1.15, 6.0, 5.0, 1.15, [z], true);
  assert.equal(missAbove, null);

  // Bloater taller head (up to 1.18) catches shot at 1.12
  const bloaterHead = traceSegmentZombieHit(6.0, 8.0, 1.12, 9.0, 8.0, 1.12, [bloater], true);
  assert.ok(bloaterHead !== null);
  assert.equal(bloaterHead.isHeadshot, true);

  // Wall occlusion blocks zombie behind wall
  const occluded = traceSegmentZombieHit(3.0, 5.0, 0.88, 6.0, 5.0, 0.88, [z], true, 0.35);
  assert.equal(occluded, null);
});

test('LMG spec: full-auto, unlimited ammo, weakest per-hit firearm', async () => {
  const { WEAPONS } = await import('./recipes');
  const lmg = WEAPONS.lmg;
  assert.equal(lmg.ammoItem, undefined, 'LMG has no ammo item (unlimited ammo)');
  assert.equal(lmg.reloadTime, 0, 'LMG never reloads');
  assert.ok(lmg.pellets === 1 && lmg.cooldown <= 0.1, 'LMG is full-auto single-bullet');
  assert.ok(lmg.damage < WEAPONS.pistol.damage, 'LMG per-hit damage below pistol');
  assert.ok(lmg.damage < WEAPONS.shotgun.damage, 'LMG per-hit damage below a single shotgun pellet');
});

test('3D terrain-aware ballistics connects high-ground shots to valley zombies and blocks shots through hillsides and cave ceilings', () => {
  const getCell = (gx: number, gy: number) => makeCell(gx, gy, 'grass', 'none');
  // Hilltop at x <= 4 (elev 3.0), steep drop to valley at x >= 7 (elev 0.0)
  const hillGroundY = (wx: number) => (wx <= 4 ? 3.0 : wx >= 7 ? 0.0 : 3.0 * ((7 - wx) / 3));

  // Shooter at (3, 5) on hill (eye world-Y = 3.0 + 0.96 = 3.96) aiming down at valley zombie at (9, 5, elev 0.0, head at 0.90)
  const valleyZombie = makeZombie(10, 9.0, 5.0, 'walker');
  const worldHit = traceSegmentWorldHit(3.0, 5.0, 3.96, 9.5, 5.0, 0.7, true, getCell, [], [], [], null, hillGroundY);
  assert.equal(worldHit, null, 'clear downward sightline from ridge to valley should not hit ground');

  const zHit = traceSegmentZombieHit(3.0, 5.0, 3.96, 9.5, 5.0, 0.7, [valleyZombie], true, 1, hillGroundY);
  assert.ok(zHit !== null, 'high-ground downward shot must hit valley zombie');
  assert.equal(zHit.zombie.id, 10);
  assert.equal(zHit.isHeadshot, true);

  // Horizontal shot fired low into a rising hill mound must collide with terrain instead of passing through
  const moundGroundY = (wx: number) => (wx >= 5 && wx <= 7 ? 2.6 : 0.0);
  const hillBlock = traceSegmentWorldHit(3.0, 5.0, 0.8, 9.0, 5.0, 0.8, true, getCell, [], [], [], null, moundGroundY);
  assert.ok(hillBlock !== null, 'bullet fired into a rising hillside must impact the terrain');
  assert.equal(hillBlock.material, 'dirt');
  assert.ok(hillBlock.hx >= 4.8 && hillBlock.hx <= 5.5);

  // Upward shot inside a rocky cave hits the cave rock ceiling
  const caveCeilingY = () => 3.5;
  const ceilHit = traceSegmentWorldHit(
    5.0,
    5.0,
    2.5,
    5.0,
    5.0,
    4.2,
    true,
    getCell,
    [],
    [],
    [],
    null,
    () => 0.5,
    caveCeilingY
  );
  assert.ok(ceilHit !== null, 'upward shot inside cave must hit cave ceiling');
  assert.equal(ceilHit.material, 'stone');
  assert.equal(ceilHit.nz, -1);
});


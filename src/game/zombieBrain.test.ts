import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canZombieSeePlayer,
  computeAudibleSoundRadius,
  computeEffectiveSightRange,
  evaluateCombatPressure,
  notifyZombieOfSound,
  pickSafeAmbientSpawnPoint,
  shouldAllowAmbientSpawn,
} from './zombieBrain';
import { dist } from './isometric';
import type { PlayerState, TileCell, Zombie } from './types';

function createOpenGrid(size = 80): (gx: number, gy: number) => TileCell {
  const walls = new Set<string>();
  return (gx: number, gy: number): TileCell => {
    const isWall = walls.has(`${gx},${gy}`);
    return {
      gx,
      gy,
      tile: 'grass',
      prop: isWall ? 'wall_brick' : 'none',
      solid: isWall,
      blocksSight: isWall,
      variant: 0,
      explored: true,
    };
  };
}

function makeZombie(overrides: Partial<Zombie> = {}): Zombie {
  return {
    id: 1,
    archetype: 'walker',
    x: 20,
    y: 20,
    vx: 0,
    vy: 0,
    facingX: 1,
    facingY: 0,
    hp: 75,
    maxHp: 75,
    speed: 1.55,
    state: 'wander',
    stateTimer: 0,
    wanderTargetX: 24,
    wanderTargetY: 20,
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
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    x: 25,
    y: 20,
    vx: 0,
    vy: 0,
    facingAngle: Math.PI,
    hp: 100,
    maxHp: 100,
    hunger: 85,
    thirst: 85,
    bleeding: false,
    infected: false,
    equippedWeapon: 'crowbar',
    pistolMag: 8,
    pistolMagSize: 8,
    shotgunMag: 4,
    shotgunMagSize: 4,
    reloadingTimer: 0,
    reloadingWeapon: null,
    attackCooldown: 0,
    meleeSwingTimer: 0,
    dodgeTimer: 0,
    dodgeCooldown: 0,
    dodgeDirX: 0,
    dodgeDirY: 0,
    flashlightOn: true,
    battery: 100,
    walkCycle: 0,
    stepAccumulator: 0,
    hitFlash: 0,
    invulnTimer: 0,
    scaleX: 1,
    scaleY: 1,
    buildMode: null,
    wetness: 0,
    bodyTemp: 37.0,
    warmBuffTimer: 0,
    sheltered: false,
    elevation: 0,
    ...overrides,
  };
}

test('zombie sees player only within forward eye cone and never has 360-degree vision', () => {
  const source = createOpenGrid();
  const z = makeZombie({ x: 20, y: 20, facingX: 1, facingY: 0 }); // Facing East (+X)

  // Player 5 tiles East (directly in front of zombie's eyes) -> seen
  const playerInFront = makePlayer({ x: 25, y: 20 });
  assert.equal(canZombieSeePlayer(source, z, playerInFront, 0), true);

  // Player 2 tiles West (directly behind zombie) -> NOT seen even when very close
  const playerBehind = makePlayer({ x: 18, y: 20 });
  assert.equal(canZombieSeePlayer(source, z, playerBehind, 0), false);

  // Player 3 tiles Directly North (90 degrees perpendicular to gaze) -> outside ~55 deg half-cone
  const playerSide = makePlayer({ x: 20, y: 17 });
  assert.equal(canZombieSeePlayer(source, z, playerSide, 0), false);
});

test('solid walls block zombie line of sight even when player is inside eye cone', () => {
  const blockedTile = new Set(['22,20']);
  const source = (gx: number, gy: number): TileCell => ({
    gx,
    gy,
    tile: 'grass',
    prop: blockedTile.has(`${gx},${gy}`) ? 'wall_brick' : 'none',
    solid: blockedTile.has(`${gx},${gy}`),
    blocksSight: blockedTile.has(`${gx},${gy}`),
    variant: 0,
    explored: true,
  });

  const z = makeZombie({ x: 20.5, y: 20.5, facingX: 1, facingY: 0 });
  const p = makePlayer({ x: 25.5, y: 20.5 });
  assert.equal(canZombieSeePlayer(source, z, p, 0), false);
});

test('darkness reduces zombie sight range and flashlight only boosts visibility when shining toward zombie', () => {
  const z = makeZombie({ x: 20, y: 20, facingX: 1, facingY: 0 });
  // Player at (26, 20) facing East (0 rad, away from zombie at X=20)
  const playerFacingAway = makePlayer({ x: 26, y: 20, facingAngle: 0, flashlightOn: true });
  // Player at (26, 20) facing West (PI rad, shining flashlight toward zombie at X=20)
  const playerShiningAtZombie = makePlayer({ x: 26, y: 20, facingAngle: Math.PI, flashlightOn: true });

  const nightSightAway = computeEffectiveSightRange(z, playerFacingAway, 1.0);
  const nightSightLit = computeEffectiveSightRange(z, playerShiningAtZombie, 1.0);
  const daySight = computeEffectiveSightRange(z, playerFacingAway, 0.0);

  assert.ok(nightSightAway < daySight, 'darkness reduces sight when flashlight points away');
  assert.ok(nightSightLit > nightSightAway, 'flashlight pointed at zombie increases visibility at night');
});

test('sound notification transitions wandering zombie to alert (not chase) and attenuates through walls', () => {
  const wallSet = new Set<string>();
  const source = (gx: number, gy: number): TileCell => ({
    gx,
    gy,
    tile: 'grass',
    prop: wallSet.has(`${gx},${gy}`) ? 'wall_brick' : 'none',
    solid: wallSet.has(`${gx},${gy}`),
    blocksSight: wallSet.has(`${gx},${gy}`),
    variant: 0,
    explored: true,
  });

  const z = makeZombie({ x: 20.5, y: 20.5, facingX: -1, facingY: 0, state: 'wander' });
  // Emit sound at (27.5, 20.5) with radius 9 (distance 7)
  const heardOpen = notifyZombieOfSound(source, z, 27.5, 20.5, 9.0);
  assert.equal(heardOpen, true);
  assert.equal(z.state, 'alert'); // Investigates sound in alert state, does not immediately chase
  assert.equal(z.lastHeardX, 27.5);
  assert.equal(z.lastHeardY, 20.5);
  assert.ok(z.facingX > 0.9, 'zombie turns eyes toward heard sound origin');

  // Now place a brick wall at (23, 20): effective audible radius is attenuated (9 * 0.45 = 4.05 < dist 7)
  wallSet.add('23,20');
  const zBehindWall = makeZombie({ x: 20.5, y: 20.5, state: 'wander' });
  assert.ok(computeAudibleSoundRadius(source, 20.5, 20.5, 27.5, 20.5, 9.0) < 5.0);
  const heardBehindWall = notifyZombieOfSound(source, zBehindWall, 27.5, 20.5, 9.0);
  assert.equal(heardBehindWall, false);
  assert.equal(zBehindWall.state, 'wander');
});

test('combat-aware spawning pauses spawns during active close combat and spawns far outside sight range', () => {
  const source = createOpenGrid();
  const px = 28.5;
  const py = 28.5;

  // Two zombies actively chasing player near (30, 28) -> should block ambient spawns during combat
  const fightingZombies = [
    makeZombie({ id: 1, x: 30, y: 28, state: 'chase' }),
    makeZombie({ id: 2, x: 27, y: 29, state: 'attack' }),
  ];
  const pressure = evaluateCombatPressure(fightingZombies, px, py, 4.0);
  assert.equal(pressure.inCombat, true);
  assert.equal(pressure.engagedCount, 2);
  assert.equal(shouldAllowAmbientSpawn(fightingZombies, px, py, 16, 4.0, false), false);

  // When out of combat with low local density, ambient spawn is allowed and picks a safe distant point (>= 20 tiles)
  const calmZombies = [makeZombie({ id: 1, x: 5, y: 5, state: 'wander' })];
  assert.equal(shouldAllowAmbientSpawn(calmZombies, px, py, 16, 0, false), true);

  for (let i = 0; i < 20; i++) {
    const candidate = pickSafeAmbientSpawnPoint(source, {
      playerX: px,
      playerY: py,
      playerFacingAngle: 0,
      inCombat: false,
      existingZombies: calmZombies,
    });
    assert.ok(candidate, 'should find a valid safe spawn candidate');
    const d = dist(candidate.x, candidate.y, px, py);
    assert.ok(d >= 20 && d <= 28, `expected spawn distance in [20, 28], got ${d}`);

    // Ensure newly spawned zombie does not immediately see the player on frame 0
    const spawnedZombie = makeZombie({
      x: candidate.x,
      y: candidate.y,
      archetype: 'spitter',
      facingX: candidate.facingX,
      facingY: candidate.facingY,
      state: 'wander',
    });
    const player = makePlayer({ x: px, y: py, facingAngle: 0 });
    assert.equal(canZombieSeePlayer(source, spawnedZombie, player, 0), false);
  }
});

test('engaged zombie in close melee range maintains visual lock when player sidesteps around it', () => {
  const source = createOpenGrid();
  const playerAtSide = makePlayer({ x: 20, y: 21.1 }); // 1.1 tiles South of (20, 20)

  // Wandering zombie facing East does not see player to its side
  const wandering = makeZombie({ x: 20, y: 20, facingX: 1, facingY: 0, state: 'wander' });
  assert.equal(canZombieSeePlayer(source, wandering, playerAtSide, 0), false);

  // Engaged zombie (chase/windup) at melee range maintains visual lock so it never freezes mid-attack
  const windingUp = makeZombie({ x: 20, y: 20, facingX: 1, facingY: 0, state: 'windup' });
  assert.equal(canZombieSeePlayer(source, windingUp, playerAtSide, 0), true);
});


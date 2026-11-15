import { dist, hasLineOfSight, type CellSource } from './isometric';
import { ZOMBIE_CONFIGS } from './recipes';
import { isCircleBlocked } from './survivalLogic';
import type { PlayerState, Vehicle, Zombie, ZombieArchetype } from './types';

export interface ZombieVisionParams {
  /** Cosine of half-angle for relaxed wandering vision (~55 deg -> ~110 deg total cone). */
  wanderFovCos?: number;
  /** Cosine of half-angle for alert/chasing vision (~68 deg -> ~136 deg total cone). */
  alertFovCos?: number;
}

const DEFAULT_WANDER_FOV_COS = Math.cos((55 * Math.PI) / 180); // ~0.5736 (110 deg cone)
const DEFAULT_ALERT_FOV_COS = Math.cos((68 * Math.PI) / 180); // ~0.3746 (136 deg cone)

/**
 * Computes the effective sight distance of a zombie toward the player based on
 * archetype sightRange, ambient darkness (0..1), and whether the player's flashlight
 * is illuminating the space between them.
 */
export function computeEffectiveSightRange(
  zombie: Pick<Zombie, 'x' | 'y' | 'archetype'>,
  player: Pick<PlayerState, 'x' | 'y' | 'facingAngle' | 'flashlightOn'>,
  darkness: number
): number {
  const baseRange = ZOMBIE_CONFIGS[zombie.archetype].sightRange;
  // Ambient light reduces sight range up to 45% at full nightfall
  const clampedDarkness = Math.max(0, Math.min(1, darkness));
  const ambientMult = 1 - clampedDarkness * 0.45;

  // Flashlight only boosts visibility when it is dark and the beam points toward the zombie
  let flashlightBoost = 0;
  if (player.flashlightOn && clampedDarkness > 0.1) {
    const dx = zombie.x - player.x;
    const dy = zombie.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-4) {
      const beamDirX = Math.cos(player.facingAngle);
      const beamDirY = Math.sin(player.facingAngle);
      const alignment = (dx / d) * beamDirX + (dy / d) * beamDirY;
      // If zombie is within the player's forward flashlight cone (~100 deg total)
      if (alignment > 0.35) {
        const coneStrength = (alignment - 0.35) / 0.65;
        flashlightBoost = clampedDarkness * 0.55 * coneStrength;
      }
    }
  }

  return baseRange * Math.min(1.15, ambientMult + flashlightBoost);
}

/**
 * Evaluates whether a zombie can see the player using its forward-facing eyes (FOV cone),
 * peripheral distance falloff, illumination, and grid line-of-sight occlusion.
 */
export function canZombieSeePlayer(
  source: CellSource,
  zombie: Pick<Zombie, 'x' | 'y' | 'facingX' | 'facingY' | 'state' | 'archetype'>,
  player: Pick<PlayerState, 'x' | 'y' | 'facingAngle' | 'flashlightOn'>,
  darkness: number,
  params?: ZombieVisionParams
): boolean {
  const dx = player.x - zombie.x;
  const dy = player.y - zombie.y;
  const dToPlayer = Math.hypot(dx, dy);

  const maxSight = computeEffectiveSightRange(zombie, player, darkness);
  if (dToPlayer > maxSight) return false;

  // Normalize zombie's eye direction vector
  const fLen = Math.hypot(zombie.facingX, zombie.facingY);
  const fx = fLen > 1e-4 ? zombie.facingX / fLen : 1;
  const fy = fLen > 1e-4 ? zombie.facingY / fLen : 0;

  const isEngaged =
    zombie.state === 'chase' ||
    zombie.state === 'windup' ||
    zombie.state === 'attack' ||
    zombie.state === 'recover';

  // Check if player lies within the zombie's forward eye cone
  // (Once already engaged in close-quarters combat within 2.4 tiles, the zombie actively tracks the player)
  if (dToPlayer > 1e-4 && !(isEngaged && dToPlayer <= 2.4)) {
    const toPlayerX = dx / dToPlayer;
    const toPlayerY = dy / dToPlayer;
    const dot = fx * toPlayerX + fy * toPlayerY;

    const isHeightened = isEngaged || zombie.state === 'alert';
    const minCos = isHeightened
      ? (params?.alertFovCos ?? DEFAULT_ALERT_FOV_COS)
      : (params?.wanderFovCos ?? DEFAULT_WANDER_FOV_COS);

    if (dot < minCos) {
      return false;
    }

    // Peripheral vision has shorter effective range than direct center-gaze vision
    const coneFactor = Math.max(0, Math.min(1, (dot - minCos) / Math.max(1e-4, 1 - minCos)));
    const directionalSightRange = maxSight * (0.68 + 0.32 * coneFactor);
    if (dToPlayer > directionalSightRange) {
      return false;
    }
  }

  return hasLineOfSight(source, zombie.x, zombie.y, player.x, player.y, true);
}

/**
 * Computes the effective radius at which a zombie at (zx, zy) can hear a sound emitted at (sx, sy).
 * Solid walls between the sound source and the zombie attenuate sound propagation.
 */
export function computeAudibleSoundRadius(
  source: CellSource,
  zx: number,
  zy: number,
  sx: number,
  sy: number,
  baseRadius: number
): number {
  if (baseRadius <= 0) return 0;
  const clearPath = hasLineOfSight(source, zx, zy, sx, sy, false);
  return clearPath ? baseRadius : baseRadius * 0.45;
}

/**
 * Alerts a zombie if the sound at (sx, sy) is audible at its position.
 * Alerted zombies only learn the sound's origin (sx, sy) and investigate it;
 * they do NOT automatically know the player's live coordinates or enter chase without visual confirmation.
 */
export function notifyZombieOfSound(
  source: CellSource,
  zombie: Zombie,
  sx: number,
  sy: number,
  baseRadius: number
): boolean {
  if (zombie.state === 'dying') return false;
  const d = dist(zombie.x, zombie.y, sx, sy);
  if (d > baseRadius) return false;

  const effectiveRadius = computeAudibleSoundRadius(source, zombie.x, zombie.y, sx, sy, baseRadius);
  if (d > effectiveRadius) return false;

  zombie.lastHeardX = sx;
  zombie.lastHeardY = sy;

  // Orient eyes toward the sound source when startled from wander/alert
  if (zombie.state === 'wander' || zombie.state === 'alert') {
    if (d > 1e-4) {
      zombie.facingX = (sx - zombie.x) / d;
      zombie.facingY = (sy - zombie.y) / d;
    }
    zombie.state = 'alert';
    zombie.stateTimer = Math.max(zombie.stateTimer, 4.0);
  }
  return true;
}

export interface CombatPressureSnapshot {
  /** Number of non-dying zombies currently engaged in chase/attack states. */
  engagedCount: number;
  /** Number of non-dying zombies within the local combat neighborhood around the player. */
  nearbyCount: number;
  /** Whether the player is considered under active combat pressure. */
  inCombat: boolean;
}

/**
 * Evaluates current combat pressure around the player so the spawner never drops
 * new zombies near the player in the middle of a fight.
 */
export function evaluateCombatPressure(
  zombies: ReadonlyArray<Pick<Zombie, 'x' | 'y' | 'state'>>,
  playerX: number,
  playerY: number,
  recentCombatSeconds: number,
  localRadius = 18
): CombatPressureSnapshot {
  let engagedCount = 0;
  let nearbyCount = 0;
  for (const z of zombies) {
    if (z.state === 'dying') continue;
    const d = dist(z.x, z.y, playerX, playerY);
    if (d <= localRadius) {
      nearbyCount++;
    }
    if (
      d <= 22 &&
      (z.state === 'chase' || z.state === 'windup' || z.state === 'attack' || z.state === 'recover')
    ) {
      engagedCount++;
    }
  }
  const inCombat = engagedCount > 0 || recentCombatSeconds > 0;
  return { engagedCount, nearbyCount, inCombat };
}

/**
 * Determines whether ambient spawning should be allowed right now based on
 * total zombie cap, local neighborhood density, and active combat pressure.
 */
export function shouldAllowAmbientSpawn(
  zombies: ReadonlyArray<Pick<Zombie, 'x' | 'y' | 'state'>>,
  playerX: number,
  playerY: number,
  maxZombies: number,
  recentCombatSeconds: number,
  isNight: boolean
): boolean {
  let totalAlive = 0;
  for (const z of zombies) {
    if (z.state !== 'dying') totalAlive++;
  }
  if (totalAlive >= maxZombies) return false;

  const pressure = evaluateCombatPressure(zombies, playerX, playerY, recentCombatSeconds, 18);
  const maxLocalDensity = isNight ? 5 : 3;
  if (pressure.nearbyCount >= maxLocalDensity) return false;

  // If the player is actively fighting nearby zombies, hold off on spawning reinforcements on top of them
  if (pressure.inCombat && (pressure.engagedCount >= 2 || pressure.nearbyCount >= 2)) {
    return false;
  }

  return true;
}

export interface SpawnCandidateOptions {
  playerX: number;
  playerY: number;
  playerFacingAngle: number;
  inCombat: boolean;
  existingZombies: ReadonlyArray<Pick<Zombie, 'x' | 'y' | 'state'>>;
  vehicles?: Vehicle[];
  rng?: () => number;
}

/**
 * Picks a safe, distant spawn position for an ambient zombie:
 * - Always well outside zombie sightRange (20..28 tiles normally, 24..32 tiles if in combat)
 * - Avoids spawning directly in front of the player's movement/aim direction with open line-of-sight
 * - Avoids clustering on top of existing zombies or solid/water tiles
 */
export function pickSafeAmbientSpawnPoint(
  source: CellSource,
  opts: SpawnCandidateOptions
): { x: number; y: number; facingX: number; facingY: number; wanderTargetX: number; wanderTargetY: number } | null {
  const rng = opts.rng ?? Math.random;
  const minRad = opts.inCombat ? 24 : 20;
  const maxRad = opts.inCombat ? 32 : 28;
  const forwardX = Math.cos(opts.playerFacingAngle);
  const forwardY = Math.sin(opts.playerFacingAngle);

  let bestCandidate: {
    x: number;
    y: number;
    score: number;
  } | null = null;

  for (let attempt = 0; attempt < 14; attempt++) {
    const ang = rng() * Math.PI * 2;
    const rad = minRad + rng() * (maxRad - minRad);
    const sx = opts.playerX + Math.cos(ang) * rad;
    const sy = opts.playerY + Math.sin(ang) * rad;

    if (isCircleBlocked(source, sx, sy, 0.3, opts.vehicles, null)) continue;

    // Avoid spawning right on top of another zombie
    let tooCloseToZombie = false;
    for (const z of opts.existingZombies) {
      if (z.state === 'dying') continue;
      if (dist(sx, sy, z.x, z.y) < 3.5) {
        tooCloseToZombie = true;
        break;
      }
    }
    if (tooCloseToZombie) continue;

    const dirFromPlayerX = (sx - opts.playerX) / rad;
    const dirFromPlayerY = (sy - opts.playerY) / rad;
    const forwardDot = dirFromPlayerX * forwardX + dirFromPlayerY * forwardY;
    const hasDirectLOS = hasLineOfSight(source, opts.playerX, opts.playerY, sx, sy, true);

    // Never spawn in the player's direct forward cone with unobstructed line of sight
    if (forwardDot > 0.55 && hasDirectLOS) continue;

    // Prefer occluded positions and positions further from player's forward gaze
    const occlusionBonus = hasDirectLOS ? 0 : 6;
    const angleBonus = (1 - forwardDot) * 3;
    const distBonus = (rad - minRad) * 0.4;
    const score = occlusionBonus + angleBonus + distBonus;

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { x: sx, y: sy, score };
      if (score >= 8) break;
    }
  }

  if (!bestCandidate) return null;

  // Orient initial zombie gaze tangentially or away from player so it wanders naturally
  const toPlayerAngle = Math.atan2(opts.playerY - bestCandidate.y, opts.playerX - bestCandidate.x);
  const tangentOffset = (rng() < 0.5 ? 1 : -1) * (Math.PI * 0.45 + rng() * Math.PI * 0.45);
  const initialAngle = toPlayerAngle + tangentOffset;
  const facingX = Math.cos(initialAngle);
  const facingY = Math.sin(initialAngle);
  const wanderDist = 3.0 + rng() * 3.0;

  return {
    x: bestCandidate.x,
    y: bestCandidate.y,
    facingX,
    facingY,
    wanderTargetX: bestCandidate.x + facingX * wanderDist,
    wanderTargetY: bestCandidate.y + facingY * wanderDist,
  };
}

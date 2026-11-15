import { footstepSurfaceForTile } from './footstepSurfaces';
import { BED_REST_COOLDOWN_SECONDS, formatRestCooldown, tickRestCooldown } from './restCooldown';
import { vehicleRelativeTouchInput } from './drivingControls';
import {
  type ActionKind,
  type ActionVisual,
} from './actionAnimation';
import {
  resolveCookingOutcomeForGrade,
  type CookingGrade,
} from './cookingQte';
import { AIM_DIRECTION_DEADZONE, touchAimAttack } from './touchAim';
import { findZombieRoute, type RoutePoint } from './navigation';
import {
  canZombieSeePlayer,
  evaluateCombatPressure,
  notifyZombieOfSound,
  pickSafeAmbientSpawnPoint,
  shouldAllowAmbientSpawn,
} from './zombieBrain';
import { applyDoorCellState, getBiomeDisplayName, sampleBiomeAt } from './worldGen';
import {
  CHUNK_SIZE,
  clamp,
  dist,
  hasLineOfSight,
  isoToWorld,
  lerp,
  screenVectorToIsoWorld,
  worldToIso,
} from './isometric';
import {
  BULLET_SPEED,
  HEADSHOT_MULTIPLIER_BULLET,
  HEADSHOT_MULTIPLIER_PELLET,
  PELLET_SPEED,
  computeProjectileVelocity3D,
  mapMaterialToDecalKind,
  traceSegmentWorldHit,
  traceSegmentZombieHit,
  type WorldHitResult,
} from './ballistics';
import {
  FPS_EYE_HEIGHT,
  FPS_PITCH_MAX,
  FPS_PITCH_MIN,
  applyFirstPersonLookDelta,
  applyFirstPersonTouchLookDelta,
  computeFirstPersonAimWorldTarget,
  computeFirstPersonMoveVector,
  pickBestDirectionalTarget,
  wrapAngleRad,
} from './firstPerson';
import { ThreeIsometricRenderer } from './threeRenderer';
import { getProfile } from './profile';
import {
  SAVE_VERSION,
  clearRunSnapshot,
  decodeExploredChunks,
  encodeExploredChunks,
  getRunSaveMeta,
  loadRunSnapshot,
  storeRunSnapshot,
  type RunSnapshot,
} from './saveGame';
import { getSettings, particleBudgetScale, pixelRatioCap, subscribeSettings } from './settings';
import type { GraphicsQuality } from './settings';
import { COOK_RECIPES, CRAFT_RECIPES, STRUCTURES, WEAPONS, ZOMBIE_CONFIGS } from './recipes';
import { soundEngine } from './sound';
import {
  VEHICLE_REPAIR_SCRAP_COST,
  advanceDoorLockpick,
  applyBedSleep,
  barricadeDoorWithWood,
  canAffordCost,
  canPlaceStructureAt,
  canSleepSafely,
  computeCombatDamage,
  computeRamImpact,
  computeZombieSteering,
  createIdleFishingState,
  createInitialInventory,
  createInitialPlayer,
  findFishingSpot,
  findVehicleExitPosition,
  generateChunk,
  generateWorld,
  getBuildTargetTile,
  getDaylightInfo,
  getWorldCell,
  isCircleBlocked,
  isTargetInMeleeArc,
  pickBestFoodConsumable,
  repairVehicleWithScrap,
  spendCost,
  stepVehiclePhysics,
  tickSurvivalNeeds,
  toggleDoorState,
  useConsumableItem,
} from './survivalLogic';
import {
  buildActiveLootContainer,
  enqueuePickupNotifications,
  extractLootEntries,
  formatContainerMeta,
  tickPickupNotifications,
  transferAllLootItems,
  transferSingleLootItem,
} from './lootUi';
import type {
  ActiveLootContainer,
  BloodDecal,
  BulletImpactEffect,
  CameraMode,
  ConsumableItemId,
  DoorEntity,
  FirePatch,
  FishingState,
  FloatingText,
  GamePhase,
  HudSnapshot,
  Inventory,
  ItemId,
  LootContainer,
  NearbyActionPrompt,
  PickupNotification,
  PlayerState,
  Projectile,
  SoundRipple,
  StructureKind,
  SurfaceImpactDecal,
  TileCell,
  Vehicle,
  WeaponId,
  WorldLandmark,
  WorldStore,
  WorldStructure,
  Zombie,
  ZombieArchetype,
} from './types';

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  gravity: number;
}

const PARTICLE_POOL_SIZE = 280;
const BEST_SCORE_KEY = 'ashfall_best_score_v1';
const AUTOSAVE_INTERVAL_SECONDS = 8;

export class SurvivalEngine {
  private canvas: HTMLCanvasElement;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private threeRenderer: ThreeIsometricRenderer;
  private destroyed = false;

  private zombieRoutes = new Map<number, { points: RoutePoint[]; target: string; expires: number }>();
  private waypoint: { x: number; y: number } | null = null;

  setWaypoint(x: number | null, y: number | null): void {
    this.waypoint = x === null || y === null ? null : { x, y };
  }

  private steerZombie(z: Zombie, tx: number, ty: number): { dx: number; dy: number } {
    const directDist = dist(z.x, z.y, tx, ty);
    if (directDist <= 1.8 && hasLineOfSight(this.worldStore, z.x, z.y, tx, ty, false)) {
      const dx = tx - z.x;
      const dy = ty - z.y;
      const len = Math.hypot(dx, dy) || 1;
      return { dx: dx / len, dy: dy / len };
    }
    const target = `${Math.floor(tx)},${Math.floor(ty)}`;
    let route = this.zombieRoutes.get(z.id);
    if (!route || route.target !== target || route.expires < this.elapsedClock) {
      route = { points: findZombieRoute(this.worldStore, z.x, z.y, tx, ty, this.vehicles), target, expires: this.elapsedClock + 2.0 + (z.id % 5) * 0.11 };
      this.zombieRoutes.set(z.id, route);
    }
    while (route.points.length && dist(z.x,z.y,route.points[0].x,route.points[0].y)<0.22) route.points.shift();
    const next = route.points[0];
    if (next) {
      const dx=next.x-z.x, dy=next.y-z.y, len=Math.hypot(dx,dy)||1;
      return { dx:dx/len, dy:dy/len };
    }
    return computeZombieSteering(this.worldStore,z.x,z.y,tx,ty,this.vehicles);
  }

  private phase: GamePhase = 'title';
  private onHudUpdate: (snap: HudSnapshot) => void;
  private onPhaseChange: (phase: GamePhase) => void;
  private onRequestOpenCook?: () => void;

  private rafId: number | null = null;
  private lastTimestamp = 0;
  private hudSyncTimer = 0;
  private minimapTimer = 0;
  private lastFogGX = -999999;
  private lastFogGY = -999999;

  // World & simulation state (infinite chunk-streamed world)
  private worldStore!: WorldStore;
  private containers: LootContainer[] = [];
  private structures: WorldStructure[] = [];
  private vehicles: Vehicle[] = [];
  private doors: DoorEntity[] = [];
  private doorByTile = new Map<string, DoorEntity>();
  private actionVisual: ActionVisual | null = null;
  private animateAction(kind:ActionKind,label:string,duration=1.1):void {
    this.actionVisual={kind,label,duration,remaining:duration};
  }

  private fishing: FishingState = createIdleFishingState();
  private nextVehicleIdRef = { nextId: 100 };
  private activeVehicleId: number | null = null;
  private decals: BloodDecal[] = [];
  private impactDecals: SurfaceImpactDecal[] = [];
  private impactEffects: BulletImpactEffect[] = [];
  private zombies: Zombie[] = [];
  private projectiles: Projectile[] = [];
  private firePatches: FirePatch[] = [];
  private soundRipples: SoundRipple[] = [];
  private floatingTexts: FloatingText[] = [];
  private particles: PooledParticle[] = [];
  private particleCursor = 0;

  private player: PlayerState = createInitialPlayer();
  private inventory: Inventory = createInitialInventory();
  private activeLootSource:
    | { type: 'container'; container: LootContainer }
    | { type: 'trunk'; vehicle: Vehicle }
    | null = null;
  private activeLootContainer: ActiveLootContainer | null = null;
  private scoredLootSources = new Set<string>();
  private pickupNotifications: PickupNotification[] = [];
  private nextPickupToastId = { nextId: 1 };

  private day = 1;
  private timeMinutes = 8 * 60 + 30; // Start at 08:30 AM Day 1
  private kills = 0;
  private score = 0;
  private bestScore = 0;
  /** Hardcore runs: death permanently deletes the autosave. */
  private hardcore = false;
  private saveAvailable = false;
  private autosaveTimer = AUTOSAVE_INTERVAL_SECONDS;
  private worldSpawnX = 28.5;
  private worldSpawnY = 28.5;
  /** Edit-HUD mode freezes the world while keeping the HUD visible for dragging. */
  private hudEditMode = false;
  private spawnTimer = 2.5;
  private recentCombatTimer = 0;
  private nextEntityId = 1;
  private hitstopTimer = 0;
  private trauma = 0;
  private elapsedClock = 0;
  private muzzleFlashTimer = 0;
  private hitMarkerTimer = 0;
  private hitMarkerCrit = false;
  private hitMarkerHeadshot = false;
  private screechCooldown = 0;
  private heartbeatTimer = 0;
  private crackleTimer = 0;
  private prevBoostActive = false;
  private statusBanner: string | null = null;
  private statusBannerTimer = 0;
  private deathDelayTimer = 0;
  private pendingGameOver = false;
  private sleepTransitionTimer = 0;
  private restCooldownSeconds = 0;
  private playerVelX = 0;
  private playerVelY = 0;
  private isSprinting = false;
  private lastFrameDt = 0.016;
  private ambientAsh: Array<{ x: number; y: number; speed: number; drift: number; size: number; alpha: number }> = [];

  // Camera in unscaled isometric pixel coordinates + First-Person mode state
  private cameraMode: CameraMode = getSettings().defaultCameraMode;
  private lastSettingCameraMode: CameraMode = getSettings().defaultCameraMode;
  private fpsPitch = -0.05;
  private fpsCarLookOffset = 0;
  private fpsStrafeInput = 0;
  private weaponSwapTimer = 0;
  private isMouseDraggingLook = false;
  private skipNextPointerLockDelta = false;
  private lastDragX = 0;
  private lastDragY = 0;
  private modalOpen = false;
  private camX = 0;
  private camY = 0;
  private viewW = 1280;
  private viewH = 720;

  // Input state
  private keysHeld = new Set<string>();
  private justPressed = new Set<string>();
  private mouseScreenX = 640;
  private mouseScreenY = 360;
  private mouseWorldX = 28.5;
  private mouseWorldY = 28.5;
  private mouseDown = false;
  private mouseJustClicked = false;
  private lastBiomeLabel = '';
  private hotspotCheckTimer = 0;

  // Mobile touch virtual stick & fire state
  private virtualMoveX = 0; // normalized screen space -1..1
  private virtualMoveY = 0;
  private virtualAimActive = false;
  private virtualAimJustPressed = false;
  private virtualAimMag = 0;
  private virtualAimAngle = Math.PI * 0.25;
  private virtualFireHeld = false;
  private virtualFireJustPressed = false;
  private virtualBrakeHeld = false;
  private virtualBoostHeld = false;
  private usingVirtualAim = false;

  constructor(
    canvas: HTMLCanvasElement,
    onHudUpdate: (snap: HudSnapshot) => void,
    onPhaseChange: (phase: GamePhase) => void,
    onRequestOpenCook?: () => void
  ) {
    this.canvas = canvas;
    this.threeRenderer = new ThreeIsometricRenderer(canvas);
    const initialSettings = getSettings();
    this.cameraMode = initialSettings.defaultCameraMode;
    this.lastSettingCameraMode = initialSettings.defaultCameraMode;
    this.applyGraphicsQuality(initialSettings.graphicsQuality);
    subscribeSettings((s) => {
      this.applyGraphicsQuality(s.graphicsQuality);
      if (s.defaultCameraMode !== this.lastSettingCameraMode) {
        this.lastSettingCameraMode = s.defaultCameraMode;
        this.setCameraMode(s.defaultCameraMode, true);
      }
      if (this.phase !== 'title') {
        this.render();
      }
    });
    this.onHudUpdate = onHudUpdate;
    this.onPhaseChange = onPhaseChange;
    this.onRequestOpenCook = onRequestOpenCook;

    try {
      const saved = localStorage.getItem(BEST_SCORE_KEY);
      if (saved) this.bestScore = parseInt(saved, 10) || 0;
    } catch {
      // ignore storage errors
    }
    this.saveAvailable = loadRunSnapshot() !== null;

    // Pre-allocate zero-GC particle pool & atmospheric ash flakes
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 2,
        color: '#ffffff',
        life: 0,
        maxLife: 1,
        gravity: 9.8,
      });
    }
    for (let i = 0; i < 42; i++) {
      this.ambientAsh.push({
        x: Math.random(),
        y: Math.random(),
        speed: 0.03 + Math.random() * 0.04,
        drift: 0.015 + Math.random() * 0.025,
        size: Math.random() < 0.7 ? 1 : 2,
        alpha: 0.22 + Math.random() * 0.35,
      });
    }

    this.initWorld(true);
    this.handleResize();
    this.bindEvents();
  }

  attachMinimapCanvas(canvas: HTMLCanvasElement | null): void {
    this.minimapCanvas = canvas;
    if (canvas && this.phase === 'playing' && this.worldStore) {
      this.renderMinimap();
    }
  }

  private getCell(gx: number, gy: number): TileCell {
    return getWorldCell(this.worldStore, gx, gy);
  }

  private registerChunkSpawns(spawned: {
    containers: LootContainer[];
    structures: WorldStructure[];
    vehicles: Vehicle[];
    doors: DoorEntity[];
  }): void {
    for (const c of spawned.containers) {
      if (!this.containers.some((existing) => existing.id === c.id)) {
        this.containers.push(c);
      }
    }
    for (const s of spawned.structures) {
      if (!this.structures.some((existing) => existing.id === s.id)) {
        this.structures.push(s);
      }
    }
    for (const v of spawned.vehicles) {
      if (!this.vehicles.some((existing) => existing.id === v.id)) {
        this.vehicles.push(v);
      }
    }
    for (const d of spawned.doors) {
      const dKey = `${d.gx}_${d.gy}`;
      if (!this.doorByTile.has(dKey)) {
        this.doors.push(d);
        this.doorByTile.set(dKey, d);
      }
    }
  }

  private flushPendingChunkSpawns(): void {
    const queue = this.worldStore?.pendingSpawns;
    if (!queue || queue.length === 0) return;
    while (queue.length > 0) {
      const next = queue.shift()!;
      this.registerChunkSpawns(next);
    }
  }

  private streamChunksAround(wx: number, wy: number, radiusChunks = 3): void {
    this.flushPendingChunkSpawns();
    const pcx = Math.floor(wx / CHUNK_SIZE);
    const pcy = Math.floor(wy / CHUNK_SIZE);
    for (let cy = pcy - radiusChunks; cy <= pcy + radiusChunks; cy++) {
      for (let cx = pcx - radiusChunks; cx <= pcx + radiusChunks; cx++) {
        const key = `${cx},${cy}`;
        if (this.worldStore.populatedChunks.has(key)) continue;
        const spawned = generateChunk(this.worldStore, cx, cy, this.nextVehicleIdRef);
        this.registerChunkSpawns(spawned);
      }
    }
    this.flushPendingChunkSpawns();
  }

  private applyGraphicsQuality(q: GraphicsQuality): void {
    this.threeRenderer?.setQualityPixelRatio(pixelRatioCap(typeof window !== 'undefined' ? window.devicePixelRatio : 1));
  }

  private initWorld(titleMode: boolean, spawnOverride?: { x: number; y: number }): void {
    this.threeRenderer?.clearSceneCaches();
    this.zombieRoutes.clear();
    const world = generateWorld(1994);
    const effectiveSpawnX = spawnOverride ? spawnOverride.x : world.spawnX;
    const effectiveSpawnY = spawnOverride ? spawnOverride.y : world.spawnY;
    this.worldSpawnX = world.spawnX;
    this.worldSpawnY = world.spawnY;
    this.nextVehicleIdRef = { nextId: 100 };
    this.worldStore = world.worldStore;
    this.worldStore.pendingSpawns = [];
    this.worldStore.nextVehicleIdRef = this.nextVehicleIdRef;
    this.containers = world.containers;
    this.structures = world.structures;
    this.vehicles = world.vehicles;
    this.doors = world.doors;
    this.doorByTile.clear();
    for (const d of this.doors) {
      this.doorByTile.set(`${d.gx}_${d.gy}`, d);
    }
    this.fishing = createIdleFishingState();
    this.actionVisual = null;
    this.activeVehicleId = null;
    this.prevBoostActive = false;
    this.lastFogGX = -999999;
    this.lastFogGY = -999999;
    this.lastBiomeLabel = 'ASHFALL CROSSROADS';
    this.hotspotCheckTimer = 0.35;
    soundEngine.updateEngineSound(false, 0, false);
    this.player = createInitialPlayer(effectiveSpawnX, effectiveSpawnY);
    this.inventory = createInitialInventory();
    this.activeLootSource = null;
    this.activeLootContainer = null;
    this.pickupNotifications = [];
    this.decals = [];
    this.impactDecals = [];
    this.impactEffects = [];
    this.hitMarkerTimer = 0;
    this.hitMarkerCrit = false;
    this.hitMarkerHeadshot = false;
    this.zombies = [];
    this.projectiles = [];
    this.firePatches = [];
    this.soundRipples = [];
    this.floatingTexts = [];
    for (const p of this.particles) p.active = false;

    this.day = 1;
    this.timeMinutes = titleMode ? 17 * 60 + 45 : 8 * 60 + 30;
    this.kills = 0;
    this.score = 0;
    this.scoredLootSources.clear();
    this.spawnTimer = 5.5;
    this.recentCombatTimer = 0;
    this.hitstopTimer = 0;
    this.trauma = 0;
    this.pendingGameOver = false;
    this.deathDelayTimer = 0;
    this.sleepTransitionTimer = 0;
    this.restCooldownSeconds = 0;
    this.playerVelX = 0;
    this.playerVelY = 0;
    this.statusBanner = titleMode ? null : 'DAY 1 · EXPLORE LAKE PIER, COOK AT STOVES & OUTLAST NIGHT';
    this.statusBannerTimer = titleMode ? 0 : 4.5;

    this.streamChunksAround(effectiveSpawnX, effectiveSpawnY, 3);

    // Seed initial neighborhood zombies at safe distance (>= 14 tiles away from effective spawn)
    const initialSpots: Array<[number, number, ZombieArchetype]> = [
      [14, 28, 'walker'],
      [42, 28, 'walker'],
      [28, 13, 'walker'],
      [28, 43, 'walker'],
      [12, 18, 'walker'],
      [44, 18, 'runner'],
      [15, 42, 'walker'],
      [41, 41, 'spitter'],
      [9, 28, 'bloater'],
      [46, 28, 'walker'],
    ];
    for (const [zx, zy, arch] of initialSpots) {
      const wx = zx + 0.5;
      const wy = zy + 0.5;
      if (!this.getCell(zx, zy).solid && dist(wx, wy, effectiveSpawnX, effectiveSpawnY) >= 13.5) {
        this.spawnZombieAt(wx, wy, arch);
      }
    }

    const iso = worldToIso(this.player.x, this.player.y, 0);
    this.camX = iso.sx;
    this.camY = iso.sy;
    this.revealFogAround(this.player.x, this.player.y, 9);
    this.flushPendingChunkSpawns();
  }

  start(): void {
    this.lastTimestamp = performance.now();
    const loop = (now: number) => {
      if (this.destroyed) return;
      const rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
      this.lastFrameDt = dt;
      this.update(dt);
      this.render();
      if (this.threeRenderer.isSoftwareGl) {
        this.threeRenderer.afterDraw(() => {
          if (!this.destroyed) {
            this.rafId = requestAnimationFrame(loop);
          }
        });
      } else {
        this.rafId = requestAnimationFrame(loop);
      }
    };
    this.rafId = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.destroyed = true;
    this.releasePointerLock();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    soundEngine.stop();
    this.unbindEvents();
    this.threeRenderer.dispose();
  }

  startGame(fromGesture = true, spawnOverride?: { x: number; y: number }, opts?: { hardcore?: boolean }): void {
    if (fromGesture) {
      soundEngine.unlock();
      soundEngine.playUiClick();
    }
    // Mode is chosen explicitly at the start screen; in-run restarts keep the current mode.
    if (opts) this.hardcore = Boolean(opts.hardcore);
    this.initWorld(false, spawnOverride);
    this.fpsPitch = -0.05;
    this.fpsCarLookOffset = 0;
    this.setPhase('playing');
    this.clearInputs();
    this.autosaveTimer = AUTOSAVE_INTERVAL_SECONDS;
    this.saveNow();
    this.emitHud();
    this.render();
  }

  /** A restorable autosave exists (normal runs keep theirs; hardcore deletes it on death). */
  hasStoredRun(): boolean {
    return this.saveAvailable;
  }

  getStoredRunMeta(): { day: number; timeLabel: string; hardcore: boolean; playerName: string } | null {
    return getRunSaveMeta();
  }

  isHardcore(): boolean {
    return this.hardcore;
  }

  continueGame(fromGesture = true): boolean {
    const save = loadRunSnapshot();
    if (!save) return false;
    if (fromGesture) {
      soundEngine.unlock();
      soundEngine.playUiClick();
    }
    this.initWorld(false);
    this.applyRunSnapshot(save);
    this.fpsPitch = -0.05;
    this.fpsCarLookOffset = 0;
    this.setPhase('playing');
    this.clearInputs();
    this.autosaveTimer = AUTOSAVE_INTERVAL_SECONDS;
    this.showBanner(
      save.hardcore ? 'HARDCORE RUN RESTORED · ONE LIFE' : 'RUN RESTORED · AUTOSAVE ON',
      2.6
    );
    this.emitHud();
    this.render();
    return true;
  }

  /** Normal-mode death: wake up at the crossroads camp, gear kept, next morning. */
  respawnSafe(fromGesture = true): void {
    if (this.hardcore) return;
    if (fromGesture) {
      soundEngine.unlock();
      soundEngine.playUiClick();
    }
    const p = this.player;
    p.x = this.worldSpawnX;
    p.y = this.worldSpawnY;
    p.vx = 0;
    p.vy = 0;
    p.hp = p.maxHp;
    p.bleeding = false;
    p.infected = false;
    p.hunger = Math.max(p.hunger, 55);
    p.thirst = Math.max(p.thirst, 55);
    p.reloadingTimer = 0;
    p.reloadingWeapon = null;
    p.attackCooldown = 0;
    p.meleeSwingTimer = 0;
    p.dodgeTimer = 0;
    p.dodgeCooldown = 0;
    p.hitFlash = 0;
    p.invulnTimer = 3;
    p.scaleX = 1;
    p.scaleY = 1;
    p.buildMode = null;
    p.stepAccumulator = 0;
    this.pendingGameOver = false;
    this.deathDelayTimer = 0;
    this.trauma = 0;
    this.hitstopTimer = 0;
    this.activeVehicleId = null;
    this.activeLootSource = null;
    this.activeLootContainer = null;
    this.fishing = createIdleFishingState();
    // Time and world carry on exactly as they were: the run continues from the same
    // moment. Only the immediate wake-up spot is made survivable - zombies standing
    // inside the camp are shoved just outside it, never deleted.
    for (const z of this.zombies) {
      if (z.state === 'dying') continue;
      const d = dist(z.x, z.y, p.x, p.y);
      if (d < 5) {
        const ang = Math.atan2(z.y - p.y, z.x - p.x) || Math.random() * Math.PI * 2;
        z.x = p.x + Math.cos(ang) * 7;
        z.y = p.y + Math.sin(ang) * 7;
        z.wanderTargetX = z.x;
        z.wanderTargetY = z.y;
        z.state = 'wander';
      }
    }
    const iso = worldToIso(p.x, p.y, 0);
    this.camX = iso.sx;
    this.camY = iso.sy;
    this.lastFogGX = Math.floor(p.x);
    this.lastFogGY = Math.floor(p.y);
    this.revealFogAround(p.x, p.y, 9);
    this.setPhase('playing');
    this.clearInputs();
    this.autosaveTimer = AUTOSAVE_INTERVAL_SECONDS;
    this.showBanner('YOU WAKE AT THE CROSSROADS CAMP · GEAR RECOVERED', 3.2);
    this.saveNow();
    this.emitHud();
    this.render();
  }

  /** Edit-HUD mode: freeze the world while the HUD stays visible for drag layout editing. */
  setHudEditMode(on: boolean): void {
    if (this.hudEditMode === on) return;
    this.hudEditMode = on;
    if (on) {
      this.clearInputs();
      this.releasePointerLock();
    }
  }

  /** Rebuild the player rig and textures after the survivor appearance changes. */
  applyAppearance(): void {
    this.threeRenderer.refreshPlayerAppearance();
    this.render();
  }

  resumeGame(): void {
    if (this.phase !== 'paused') return;
    soundEngine.unlock();
    soundEngine.playUiClick();
    this.setPhase('playing');
    this.clearInputs();
    this.emitHud();
  }

  pauseGame(): void {
    if (this.phase !== 'playing') return;
    this.activeLootSource = null;
    this.activeLootContainer = null;
    this.releasePointerLock();
    soundEngine.playUiClick();
    soundEngine.updateEngineSound(false, 0, false);
    this.saveNow();
    this.setPhase('paused');
    this.clearInputs();
    this.emitHud();
  }

  returnToTitle(): void {
    this.activeLootSource = null;
    this.activeLootContainer = null;
    this.pickupNotifications = [];
    this.releasePointerLock();
    soundEngine.playUiClick();
    soundEngine.updateEngineSound(false, 0, false);
    this.initWorld(true);
    this.setPhase('title');
    this.clearInputs();
    this.emitHud();
    this.render();
  }

  private setPhase(next: GamePhase): void {
    this.phase = next;
    if (next !== 'playing') {
      this.releasePointerLock();
    }
    document.body.dataset.state = next;
    this.onPhaseChange(next);
  }

  /** Persist the current run. No-op outside active play or once the run is lost. */
  private saveNow(): void {
    if (this.phase !== 'playing' || this.pendingGameOver || this.player.hp <= 0) return;
    this.flushPendingChunkSpawns();
    const save: RunSnapshot = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      hardcore: this.hardcore,
      playerName: getProfile().name,
      day: this.day,
      timeMinutes: Math.floor(this.timeMinutes),
      timeLabel: getDaylightInfo(this.timeMinutes).formattedTime,
      kills: this.kills,
      score: this.score,
      restCooldownSeconds: this.restCooldownSeconds,
      player: { ...this.player },
      inventory: { ...this.inventory },
      activeVehicleId: this.activeVehicleId,
      nextVehicleId: this.nextVehicleIdRef.nextId,
      nextEntityId: this.nextEntityId,
      nextPickupToastId: this.nextPickupToastId.nextId,
      scoredLootSources: [...this.scoredLootSources],
      populatedChunks: [...this.worldStore.populatedChunks],
      landmarks: [...this.worldStore.landmarks.values()].map((lm) => ({
        ...lm,
        hotspotPacks: [...lm.hotspotPacks],
      })),
      containers: this.containers,
      structures: this.structures,
      vehicles: this.vehicles,
      doors: this.doors,
      zombies: this.zombies,
      explored: encodeExploredChunks(this.worldStore.chunks),
    };
    storeRunSnapshot(save);
    this.saveAvailable = true;
  }

  /** Overlay a snapshot onto the freshly regenerated deterministic world. */
  private applyRunSnapshot(save: RunSnapshot): void {
    this.hardcore = Boolean(save.hardcore);
    this.saveAvailable = true;
    this.day = Math.max(1, Math.floor(save.day));
    this.timeMinutes = ((save.timeMinutes % 1440) + 1440) % 1440;
    this.kills = Math.max(0, Math.floor(save.kills));
    this.score = Math.max(0, Math.floor(save.score));
    this.restCooldownSeconds = Math.max(0, save.restCooldownSeconds || 0);

    const p = { ...createInitialPlayer(save.player.x, save.player.y), ...save.player };
    // Strip transient combat timers so a save can never restore a stuck state.
    p.vx = 0;
    p.vy = 0;
    p.reloadingTimer = 0;
    p.reloadingWeapon = null;
    p.attackCooldown = 0;
    p.meleeSwingTimer = 0;
    p.dodgeTimer = 0;
    p.dodgeCooldown = 0;
    p.hitFlash = 0;
    p.invulnTimer = 0.6;
    p.scaleX = 1;
    p.scaleY = 1;
    p.buildMode = null;
    p.stepAccumulator = 0;
    p.hp = clamp(p.hp, 1, Math.max(1, p.maxHp || 100));
    p.hunger = clamp(p.hunger, 0, 100);
    p.thirst = clamp(p.thirst, 0, 100);
    this.player = p;
    this.inventory = { ...createInitialInventory(), ...save.inventory };

    this.containers = save.containers.map((c) => ({ ...c, items: { ...c.items } }));
    this.structures = save.structures.map((s) => ({ ...s }));
    this.vehicles = save.vehicles.map((v) => ({
      ...v,
      trunkItems: v.trunkItems ? { ...v.trunkItems } : undefined,
    }));
    this.doors = save.doors.map((d) => ({ ...d }));
    this.zombies = save.zombies.map((z) => ({ ...z, hitFlash: 0 }));

    // Entity ids must never collide with future spawns.
    let maxVehicleId = 99;
    for (const v of this.vehicles) maxVehicleId = Math.max(maxVehicleId, v.id);
    let maxEntityId = 0;
    for (const z of this.zombies) maxEntityId = Math.max(maxEntityId, z.id);
    this.nextVehicleIdRef = {
      nextId: Math.max(100, Math.floor(save.nextVehicleId), maxVehicleId + 1),
    };
    this.worldStore.nextVehicleIdRef = this.nextVehicleIdRef;
    this.nextEntityId = Math.max(1, Math.floor(save.nextEntityId), maxEntityId + 1);
    this.nextPickupToastId = { nextId: Math.max(1, Math.floor(save.nextPickupToastId || 1)) };
    this.scoredLootSources = new Set(save.scoredLootSources);

    // Regenerate every previously streamed chunk's cells (spawned entities are
    // discarded: the saved lists already carry their exact state), then re-apply
    // the tile effects of saved doors and player-built barricades.
    this.worldStore.populatedChunks = new Set(save.populatedChunks);
    for (const key of save.populatedChunks) {
      const [cx, cy] = key.split(',').map(Number);
      if (Number.isFinite(cx) && Number.isFinite(cy) && !this.worldStore.chunks.has(key)) {
        generateChunk(this.worldStore, cx, cy, this.nextVehicleIdRef);
      }
    }
    this.worldStore.pendingSpawns = [];

    this.doorByTile.clear();
    for (const d of this.doors) {
      this.doorByTile.set(`${d.gx}_${d.gy}`, d);
      applyDoorCellState(this.getCell(d.gx, d.gy), d.status);
    }
    for (const s of this.structures) {
      if (s.kind === 'barricade') this.getCell(s.gx, s.gy).solid = true;
    }

    const lm = new Map<string, WorldLandmark>();
    for (const l of save.landmarks) {
      lm.set(l.id, { ...l, hotspotPacks: Array.isArray(l.hotspotPacks) ? [...l.hotspotPacks] : [] });
    }
    this.worldStore.landmarks = lm;
    decodeExploredChunks(this.worldStore.chunks, save.explored);

    const activeId = save.activeVehicleId;
    this.activeVehicleId =
      activeId !== null && this.vehicles.some((v) => v.id === activeId) ? activeId : null;

    this.zombieRoutes.clear();
    this.spawnTimer = 3.0;
    const iso = worldToIso(this.player.x, this.player.y, 0);
    this.camX = iso.sx;
    this.camY = iso.sy;
    this.lastFogGX = Math.floor(this.player.x);
    this.lastFogGY = Math.floor(this.player.y);
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  setCameraMode(mode: CameraMode, silent = false): void {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode;
    this.isMouseDraggingLook = false;
    this.virtualAimActive = false;
    this.virtualAimJustPressed = false;
    this.virtualAimMag = 0;
    this.fpsStrafeInput = 0;
    if (mode === 'fps') {
      this.fpsPitch = -0.05;
      this.fpsCarLookOffset = 0;
      if (!silent && this.phase === 'playing') {
        soundEngine.playUiClick();
        this.showBanner(
          this.usingVirtualAim
            ? 'FIRST-PERSON MODE · DRAG RIGHT SIDE TO AIM'
            : 'FIRST-PERSON MODE · CLICK TO LOCK AIM · [Z] ISO',
          2.8
        );
      }
    } else {
      this.releasePointerLock();
      if (!silent && this.phase === 'playing') {
        soundEngine.playUiClick();
        this.showBanner('ISOMETRIC 3D MODE · [Z] FIRST-PERSON', 2.2);
      }
    }
    this.updateMouseWorld();
    this.emitHud();
    this.render();
  }

  toggleCameraMode(): void {
    this.setCameraMode(this.cameraMode === 'iso' ? 'fps' : 'iso');
  }

  setModalOpen(open: boolean): void {
    this.modalOpen = open;
    if (open) {
      this.releasePointerLock();
      this.clearInputs();
    }
  }

  private requestPointerLock(): void {
    if (this.cameraMode !== 'fps' || this.phase !== 'playing' || this.modalOpen) return;
    if (document.pointerLockElement === this.canvas) return;
    try {
      const maybePromise = (this.canvas as HTMLCanvasElement & {
        requestPointerLock?: () => Promise<void> | void;
      }).requestPointerLock?.();
      if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
        (maybePromise as Promise<void>).catch(() => {});
      }
    } catch {
      // Ignore browser gesture/sandbox pointer lock restrictions
    }
  }

  private releasePointerLock(): void {
    try {
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock?.();
      }
    } catch {
      // ignore
    }
  }

  selectWeapon(weapon: WeaponId): void {
    if (this.phase !== 'playing') return;
    this.player.buildMode = null;
    if (this.player.equippedWeapon !== weapon) {
      this.player.equippedWeapon = weapon;
      this.player.reloadingTimer = 0;
      this.player.reloadingWeapon = null;
      this.weaponSwapTimer = 0.22;
      soundEngine.playUiClick();
      this.emitHud();
    }
  }

  toggleBuildMode(kind?: StructureKind): void {
    if (this.phase !== 'playing') return;
    soundEngine.playUiClick();
    if (kind) {
      this.player.buildMode = this.player.buildMode === kind ? null : kind;
    } else {
      this.player.buildMode = this.player.buildMode ? null : 'barricade';
    }
    this.emitHud();
  }

  useConsumable(item: ConsumableItemId): boolean {
    if (this.phase !== 'playing') return false;
    const res = useConsumableItem(this.player, this.inventory, item);
    if (!res.used) {
      this.showBanner(res.message, 1.8);
      return false;
    }
    this.player = res.player;
    this.inventory = res.inventory;
    this.animateAction(item==='bandage'?'heal':item==='water'?'drink':'eat',item==='bandage'?'DRESSING WOUND':item==='water'?'DRINKING':'EATING',item==='bandage'?1.6:1.25);
    const soundKind = item === 'water' ? 'water' : item === 'bandage' ? 'bandage' : 'food';
    soundEngine.playConsume(soundKind);
    this.addFloatingText(this.player.x, this.player.y, 1.3, res.message, '#8be08b');
    this.emitHud();
    return true;
  }

  isNearCookingHeat(): boolean {
    const p = this.player;
    if (
      this.structures.some(
        (s) => s.kind === 'campfire' && dist(s.gx + 0.5, s.gy + 0.5, p.x, p.y) <= 2.45
      )
    ) {
      return true;
    }
    const pgx = Math.floor(p.x);
    const pgy = Math.floor(p.y);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cell = this.getCell(pgx + dx, pgy + dy);
        if (cell.prop === 'stove' && dist(pgx + dx + 0.5, pgy + dy + 0.5, p.x, p.y) <= 2.45) {
          return true;
        }
      }
    }
    return false;
  }

  cookRecipe(recipeId: string, grade: CookingGrade = 'good'): boolean {
    if (this.phase !== 'playing') return false;
    const recipe = COOK_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return false;
    if (!this.isNearCookingHeat()) {
      this.showBanner('Stand beside a Campfire or Kitchen Stove to cook', 1.8);
      return false;
    }
    if (!canAffordCost(this.inventory, recipe.cost)) {
      this.showBanner('Missing cooking ingredients', 1.6);
      return false;
    }
    if (recipe.outputItem && recipe.outputAmount) {
      this.inventory = spendCost(this.inventory, recipe.cost);
      const outcome = resolveCookingOutcomeForGrade(grade, recipe.outputAmount);
      this.inventory[recipe.outputItem] += outcome.outputAmount;
      if (outcome.bonusHp > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + outcome.bonusHp);
      }
      if (outcome.bonusScore > 0) {
        this.score += outcome.bonusScore;
      }
      soundEngine.playCookOutcome(outcome.grade);
      if (outcome.grade === 'perfect') {
        this.animateAction('cook', 'PRIME COOK!', 1.45);
        this.spawnParticles(this.player.x, this.player.y, 0.55, 14, '#ffd266', 2.0, 2.6, -1.6);
        this.addFloatingText(
          this.player.x,
          this.player.y,
          1.3,
          `+${outcome.outputAmount} ${recipe.name} (PRIME!)`,
          '#ffd266'
        );
      } else if (outcome.grade === 'good') {
        this.animateAction('cook', 'COOKING', 1.3);
        this.spawnParticles(this.player.x, this.player.y, 0.55, 8, '#ffbe5c', 1.5, 2.2, -1.5);
        this.addFloatingText(
          this.player.x,
          this.player.y,
          1.25,
          `+${outcome.outputAmount} ${recipe.name}`,
          '#f5c06e'
        );
      } else {
        this.animateAction('cook', 'WARM SALVAGE', 1.0);
        this.spawnParticles(this.player.x, this.player.y, 0.55, 8, '#c7b89c', 1.4, 2.0, -1.4);
        this.addFloatingText(
          this.player.x,
          this.player.y,
          1.25,
          `+${outcome.outputAmount} ${recipe.name} (Warm Salvage)`,
          '#e09c84'
        );
      }
      this.recordItemPickups({ [recipe.outputItem]: outcome.outputAmount }, 'Cooked');
      this.emitHud();
      return true;
    }
    return false;
  }

  craftRecipe(recipeId: string): boolean {
    if (this.phase !== 'playing') return false;
    const recipe = CRAFT_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return false;
    if (!canAffordCost(this.inventory, recipe.cost)) {
      this.showBanner('Insufficient materials', 1.6);
      return false;
    }

    if (recipe.outputStructure) {
      // Enter build placement mode for that structure!
      this.player.buildMode = recipe.outputStructure;
      soundEngine.playUiClick();
      this.showBanner(`Click tile to place ${recipe.name}`, 2.5);
      this.emitHud();
      return true;
    }

    if (recipe.outputItem && recipe.outputAmount) {
      this.inventory = spendCost(this.inventory, recipe.cost);
      this.inventory[recipe.outputItem] += recipe.outputAmount;
      soundEngine.playLootPickup();
      this.animateAction('craft','CRAFTING',1.5);
      this.showBanner(`Crafted ${recipe.name}`, 2.0);
      this.recordItemPickups({ [recipe.outputItem]: recipe.outputAmount }, 'Workbench');
      this.emitHud();
      return true;
    }
    return false;
  }

  private recordItemPickups(items: Partial<Inventory>, source?: string): void {
    this.pickupNotifications = enqueuePickupNotifications(
      this.pickupNotifications,
      items,
      this.nextPickupToastId,
      source
    );
  }

  private awardLootScore(): void {
    const source = this.activeLootContainer;
    if (!source || this.scoredLootSources.has(source.sourceId) || !source.entries.length) return;
    this.scoredLootSources.add(source.sourceId);
    this.score += source.sourceType === 'trunk' ? 20 : 15;
  }

  takeLootItem(item: ItemId): void {
    if (this.phase !== 'playing' || !this.activeLootSource) return;
    const src = this.activeLootSource;
    const currentItems =
      src.type === 'container' ? src.container.items : (src.vehicle.trunkItems ?? {});
    const { takenQty, nextContainerItems, nextInventory, isEmpty } = transferSingleLootItem(
      currentItems,
      this.inventory,
      item
    );
    if (takenQty <= 0) return;

    this.awardLootScore();
    this.inventory = nextInventory;
    const kind =
      src.type === 'container'
        ? src.container.kind
        : src.vehicle.kind === 'police'
          ? 'car_police'
          : 'car_sedan';
    const meta = formatContainerMeta(kind);

    if (src.type === 'container') {
      src.container.items = nextContainerItems;
      if (isEmpty) {
        src.container.searched = true;
        src.container.openAnim = Math.max(0.08, src.container.openAnim ?? 0);
        src.container.popTimer = 0.45;
      }
    } else {
      src.vehicle.trunkItems = nextContainerItems;
      if (isEmpty) {
        src.vehicle.trunkSearched = true;
      }
    }

    soundEngine.playLootPickup();
    this.recordItemPickups({ [item]: takenQty }, meta.title);

    if (isEmpty) {
      const fxX = src.type === 'container' ? src.container.gx + 0.5 : src.vehicle.x;
      const fxY = src.type === 'container' ? src.container.gy + 0.5 : src.vehicle.y;
      this.spawnParticles(fxX, fxY, 0.4, 6, '#d9b566', 2.0, 1.8);
      this.actionVisual = null;
    }
    const sourceId = src.type === 'container' ? src.container.id : `trunk_${src.vehicle.id}`;
    this.activeLootContainer = buildActiveLootContainer(src.type, sourceId, kind, nextContainerItems);
    this.emitHud();
  }

  depositLootItem(item: ItemId): void {
    if (this.phase !== 'playing' || !this.activeLootSource) return;
    const src = this.activeLootSource;
    if (src.type === 'container' && src.container.kind === 'zombie_drop') return;
    const qty = this.inventory[item] ?? 0;
    if (qty <= 0) return;
    this.inventory = { ...this.inventory, [item]: 0 };
    let kind: LootContainer['kind'];
    let sourceId: string;
    let items: Partial<Inventory>;
    if (src.type === 'container') {
      items = { ...src.container.items, [item]: (src.container.items[item] ?? 0) + qty };
      src.container.items = items; src.container.searched = false;
      kind = src.container.kind; sourceId = src.container.id;
    } else {
      items = { ...src.vehicle.trunkItems, [item]: (src.vehicle.trunkItems?.[item] ?? 0) + qty };
      src.vehicle.trunkItems = items; src.vehicle.trunkSearched = false;
      kind = src.vehicle.kind === 'police' ? 'car_police' : 'car_sedan';
      sourceId = `trunk_${src.vehicle.id}`;
    }
    this.activeLootContainer = buildActiveLootContainer(src.type, sourceId, kind, items);
    soundEngine.playUiClick();
    this.emitHud();
  }

  takeAllLoot(): void {
    if (this.phase !== 'playing' || !this.activeLootSource) return;
    const src = this.activeLootSource;
    const currentItems =
      src.type === 'container' ? src.container.items : (src.vehicle.trunkItems ?? {});
    const { taken, nextContainerItems, nextInventory } = transferAllLootItems(
      currentItems,
      this.inventory
    );
    this.awardLootScore();
    this.inventory = nextInventory;

    const kind =
      src.type === 'container'
        ? src.container.kind
        : src.vehicle.kind === 'police'
          ? 'car_police'
          : 'car_sedan';
    const meta = formatContainerMeta(kind);

    if (src.type === 'container') {
      src.container.items = nextContainerItems;
      src.container.searched = true;
      src.container.openAnim = Math.max(0.08, src.container.openAnim ?? 0);
      src.container.popTimer = 0.48;
    } else {
      src.vehicle.trunkItems = nextContainerItems;
      src.vehicle.trunkSearched = true;
    }

    const entries = extractLootEntries(taken);
    soundEngine.playLootPickup();
    if (entries.length > 0) {
      this.recordItemPickups(taken, meta.title);
    }
    const fxX = src.type === 'container' ? src.container.gx + 0.5 : src.vehicle.x;
    const fxY = src.type === 'container' ? src.container.gy + 0.5 : src.vehicle.y;
    const label =
      entries.length > 0
        ? entries
            .slice(0, 3)
            .map((e) => `+${e.qty} ${e.item.replace('ammo_', '')}`)
            .join(' · ')
        : 'Empty';
    this.addFloatingText(fxX, fxY, 1.15, label, '#f0d078');
    this.spawnParticles(fxX, fxY, 0.4, 6, '#d9b566', 2.0, 1.8);

    const sourceId = src.type === 'container' ? src.container.id : `trunk_${src.vehicle.id}`;
    this.activeLootContainer = buildActiveLootContainer(src.type, sourceId, kind, nextContainerItems);
    this.actionVisual = null;
    this.emitHud();
  }

  closeLootContainer(): void {
    if (!this.activeLootSource && !this.activeLootContainer) return;
    soundEngine.playUiClick();
    this.activeLootSource = null;
    this.activeLootContainer = null;
    this.actionVisual = null;
    this.emitHud();
  }

  private showBanner(msg: string, duration = 2.5): void {
    this.statusBanner = msg;
    this.statusBannerTimer = duration;
  }

  private clearInputs(): void {
    this.keysHeld.clear();
    this.justPressed.clear();
    this.mouseDown = false;
    this.mouseJustClicked = false;
    this.isMouseDraggingLook = false;
    this.isSprinting = false;
    this.virtualMoveX = 0;
    this.virtualMoveY = 0;
    this.virtualAimActive = false;
    this.virtualAimJustPressed = false;
    this.virtualAimMag = 0;
    this.virtualFireHeld = false;
    this.virtualFireJustPressed = false;
    this.virtualBrakeHeld = false;
    this.virtualBoostHeld = false;
  }

  setTouchMode(enabled: boolean): void {
    this.usingVirtualAim = enabled;
  }

  setVirtualMove(nx: number, ny: number): void {
    this.virtualMoveX = clamp(nx, -1, 1);
    this.virtualMoveY = clamp(ny, -1, 1);
    if (Math.hypot(nx, ny) > 0.14) {
      this.usingVirtualAim = true;
    }
  }

  setVirtualAim(nx: number, ny: number, active: boolean): void {
    soundEngine.unlock();
    const mag = Math.hypot(nx, ny);
    // Press means crossing into the outer attack ring, never mere touchdown.
    if (touchAimAttack(active, mag) && !touchAimAttack(this.virtualAimActive, this.virtualAimMag)) {
      this.virtualAimJustPressed = true;
    } else if (!touchAimAttack(active, mag)) {
      this.virtualAimJustPressed = false;
    }
    this.virtualAimActive = active;
    this.virtualAimMag = active ? clamp(mag, 0, 1) : 0;
    if (active) {
      this.usingVirtualAim = true;
      if (mag > AIM_DIRECTION_DEADZONE) {
        const w = screenVectorToIsoWorld(nx, ny);
        this.virtualAimAngle = Math.atan2(w.wy, w.wx);
      } else {
        this.virtualAimAngle = this.player.facingAngle;
      }
      this.mouseWorldX = this.player.x + Math.cos(this.virtualAimAngle) * 4.5;
      this.mouseWorldY = this.player.y + Math.sin(this.virtualAimAngle) * 4.5;
    }
  }

  applyVirtualLookDelta(dx: number, dy: number): void {
    soundEngine.unlock();
    this.usingVirtualAim = true;
    if (this.phase !== 'playing' || this.modalOpen || this.cameraMode !== 'fps') return;
    const { touchSensitivity: sens, invertLookY } = getSettings();
    if (this.activeVehicleId !== null) {
      const car = this.getActiveVehicle();
      const res = applyFirstPersonTouchLookDelta(this.fpsCarLookOffset, this.fpsPitch, dx * sens, dy * sens, undefined, invertLookY);
      this.fpsCarLookOffset = clamp(res.yaw, -Math.PI * 0.65, Math.PI * 0.65);
      this.fpsPitch = clamp(res.pitch, -0.22, 0.28);
      if (car) {
        this.player.facingAngle = wrapAngleRad(car.angle + this.fpsCarLookOffset);
      }
    } else {
      const res = applyFirstPersonTouchLookDelta(this.player.facingAngle, this.fpsPitch, dx * sens, dy * sens, undefined, invertLookY);
      this.player.facingAngle = res.yaw;
      this.fpsPitch = res.pitch;
    }
    this.updateMouseWorld();
  }

  setVirtualFire(held: boolean): void {
    soundEngine.unlock();
    this.usingVirtualAim = true;
    if (held && !this.virtualFireHeld) {
      this.virtualFireJustPressed = true;
    }
    this.virtualFireHeld = held;
  }

  setVirtualBrake(held: boolean): void {
    soundEngine.unlock();
    this.virtualBrakeHeld = held;
  }

  setVirtualBoost(held: boolean): void {
    soundEngine.unlock();
    this.virtualBoostHeld = held;
  }

  triggerDodge(): void {
    soundEngine.unlock();
    if (this.phase === 'playing') {
      this.justPressed.add('Space');
    }
  }

  triggerReload(): void {
    soundEngine.unlock();
    if (this.phase === 'playing') {
      if (this.activeVehicleId !== null) {
        this.refuelActiveVehicle();
      } else {
        this.tryStartReload();
      }
    }
  }

  triggerDoor(): void {
    soundEngine.unlock();
    if (this.phase !== 'playing' || this.activeVehicleId !== null || this.fishing.phase !== 'idle') return;
    const door = this.findNearestDoor();
    if (door) this.interactDoor(door);
  }

  private interactDoor(door: DoorEntity): void {
      this.animateAction('door',door.status==='locked'?'PICKING LOCK':'DOOR',.8);
      const cell = this.getCell(door.gx, door.gy);
      if (door.status === 'locked') {
        const res = advanceDoorLockpick(door, cell, 0.36);
        soundEngine.playLockpickClick(res.unlocked);
        this.addFloatingText(
          door.gx + 0.5,
          door.gy + 0.5,
          1.1,
          res.unlocked ? 'UNLOCKED!' : `PICKING ${Math.round(res.progress * 100)}%`,
          res.unlocked ? '#ffd266' : '#c7c2b6'
        );
      } else {
        const res = toggleDoorState(door, cell);
        if (res.changed) {
          soundEngine.playDoorSwing(door.status === 'open');
          this.addFloatingText(door.gx + 0.5, door.gy + 0.5, 1.0, res.message, '#e0bd5e');
        }
      }
      this.emitHud();
  }

  triggerLoot(): void {
    soundEngine.unlock();
    if (this.phase === 'playing') {
      this.tryLootNearby();
    }
  }

  triggerBarricadeDoor(): void {
    soundEngine.unlock();
    if (this.phase !== 'playing' || this.activeVehicleId !== null) return;
    const door = this.findNearestDoor();
    if (!door) return;
    const cell = this.getCell(door.gx, door.gy);
    const res = barricadeDoorWithWood(door, cell, this.inventory);
    this.inventory = res.inventory;
    if (res.barricaded) {
      this.animateAction('build','BOARDING',1.3);
      soundEngine.playBuildHammer();
      this.spawnParticles(door.gx + 0.5, door.gy + 0.5, 0.4, 8, '#a67449', 2.4, 2.0);
      this.addFloatingText(door.gx + 0.5, door.gy + 0.5, 1.1, 'BARRICADED', '#e0bd5e');
      this.emitSound(door.gx + 0.5, door.gy + 0.5, 6.5, true);
    } else {
      this.showBanner(res.message, 1.8);
    }
    this.emitHud();
  }

  triggerQuickCook(): void {
    soundEngine.unlock();
    if (this.phase !== 'playing' || this.activeVehicleId !== null) return;
    if (this.isNearCookingHeat()) {
      soundEngine.playUiClick();
      this.onRequestOpenCook?.();
    } else {
      this.showBanner('Move beside a Campfire or Kitchen Stove to cook', 1.8);
    }
  }

  triggerRepairVehicle(): void {
    soundEngine.unlock();
    if (this.phase !== 'playing') return;
    const target = this.getActiveVehicle() ?? this.findNearestVehicle();
    if (!target) return;
    const res = repairVehicleWithScrap(target, this.inventory);
    if (!res.repaired) {
      this.showBanner(res.message, 1.8);
      return;
    }
    const idx = this.vehicles.findIndex((v) => v.id === target.id);
    if (idx !== -1) this.vehicles[idx] = res.vehicle;
    this.inventory = res.inventory;
    this.animateAction('repair','REPAIRING',1.4);
    soundEngine.playWrenchRepair();
    this.spawnParticles(target.x, target.y, 0.45, 10, '#ffd266', 2.8, 2.0);
    this.addFloatingText(target.x, target.y, 1.25, res.message, '#7ec4ff');
    this.emitHud();
  }

  triggerFlashlight(): void {
    soundEngine.unlock();
    if (this.phase !== 'playing') return;
    const activeCar = this.getActiveVehicle();
    if (activeCar) {
      activeCar.headlightsOn = !activeCar.headlightsOn;
      soundEngine.playUiClick();
      this.emitHud();
      return;
    }
    if (this.player.battery > 1) {
      this.player.flashlightOn = !this.player.flashlightOn;
      soundEngine.playUiClick();
      this.emitHud();
    }
  }

  triggerEnterExitVehicle(): void {
    soundEngine.unlock();
    if (this.phase !== 'playing') return;

    const current = this.getActiveVehicle();
    if (current) {
      const exitPos = findVehicleExitPosition(
        this.worldStore,
        current.x,
        current.y,
        current.angle,
        this.vehicles,
        current.id
      );
      current.speed *= 0.25;
      current.drifting = false;
      current.boosting = false;
      this.prevBoostActive = false;
      this.player.x = exitPos.x;
      this.player.y = exitPos.y;
      this.player.facingAngle = current.angle;
      this.fpsCarLookOffset = 0;
      this.player.invulnTimer = Math.max(this.player.invulnTimer, 0.3);
      this.activeVehicleId = null;
      soundEngine.updateEngineSound(false, 0, false);
      soundEngine.playCarDoor();
      this.emitHud();
      return;
    }

    const nearest = this.findNearestVehicle();
    if (!nearest) return;
    if (nearest.hp <= 0) {
      this.showBanner('Vehicle wrecked — trunk searchable [E]', 2.0);
      return;
    }

    this.cancelFishing();
    this.player.buildMode = null;
    this.player.reloadingTimer = 0;
    this.player.reloadingWeapon = null;
    this.activeVehicleId = nearest.id;
    this.fpsCarLookOffset = 0;
    this.player.x = nearest.x;
    this.player.y = nearest.y;
    this.player.facingAngle = nearest.angle;
    soundEngine.playCarDoor();
    const label = nearest.kind === 'police' ? 'POLICE CRUISER' : 'SEDAN';
    this.showBanner(
      `${label} · W/S DRIVE · A/D STEER · SHIFT BOOST · SPACE DRIFT · T REPAIR · G EXIT`,
      3.5
    );
    this.emitHud();
  }

  triggerHorn(): void {
    soundEngine.unlock();
    if (this.phase !== 'playing') return;
    const car = this.getActiveVehicle();
    if (!car) return;
    soundEngine.playCarHorn(car.kind === 'police');
    if (car.kind === 'police') {
      car.sirenOn = !car.sirenOn;
      this.emitHud();
    }
    this.emitSound(car.x, car.y, car.kind === 'police' ? 14 : 10, true);
  }

  refuelActiveVehicle(): void {
    const car = this.getActiveVehicle();
    if (!car) return;
    if (car.fuel >= 96) {
      this.showBanner('Tank is already full', 1.4);
      return;
    }
    if (this.inventory.fuel <= 0) {
      this.showBanner('No Fuel cans in backpack', 1.6);
      return;
    }
    this.animateAction('refuel','REFUELING',1.2);
    this.inventory.fuel -= 1;
    car.fuel = Math.min(100, car.fuel + 45);
    soundEngine.playRefuel();
    this.addFloatingText(car.x, car.y, 1.2, '+45% FUEL', '#f0d078');
    this.emitHud();
  }

  private getActiveVehicle(): Vehicle | null {
    if (this.activeVehicleId === null) return null;
    return this.vehicles.find((v) => v.id === this.activeVehicleId) ?? null;
  }

  private findNearestVehicle(): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = 2.35;
    for (const v of this.vehicles) {
      const d = dist(this.player.x, this.player.y, v.x, v.y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  private findNearestDoor(): DoorEntity | null {
    if (this.cameraMode === 'fps') {
      return pickBestDirectionalTarget(
        this.player.x,
        this.player.y,
        this.player.facingAngle,
        this.doors,
        (d) => ({ x: d.gx + 0.5, y: d.gy + 0.5 }),
        1.65
      );
    }
    let best: DoorEntity | null = null;
    let bestD = 1.65;
    for (const d of this.doors) {
      const dd = dist(this.player.x, this.player.y, d.gx + 0.5, d.gy + 0.5);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  private handleResize = (): void => {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect?.width ?? window.innerWidth));
    const h = Math.max(240, Math.floor(rect?.height ?? window.innerHeight));
    this.viewW = w;
    this.viewH = h;
    this.threeRenderer.resize(w, h);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
      if (this.phase === 'playing' || this.phase === 'title') {
        e.preventDefault();
      }
    }

    if (this.phase === 'title') {
      if (code === 'Enter' || code === 'Space') {
        this.startGame();
      }
      return;
    }

    if (code === 'Escape' || code === 'KeyP') {
      if (this.phase === 'playing') {
        if (this.player.buildMode) {
          this.player.buildMode = null;
          this.emitHud();
        } else {
          this.pauseGame();
        }
      } else if (this.phase === 'paused') {
        this.resumeGame();
      }
      return;
    }

    if (this.phase !== 'playing' || this.modalOpen) return;

    if (!this.keysHeld.has(code)) {
      this.justPressed.add(code);
    }
    this.keysHeld.add(code);

    // Hotbar weapon, consumable, door, cooking, camera & vehicle switches
    if (code === 'KeyZ') {
      this.toggleCameraMode();
    } else if (code === 'KeyG') {
      this.triggerEnterExitVehicle();
    } else if (code === 'KeyQ') {
      this.triggerHorn();
    } else if (code === 'KeyT') {
      this.triggerRepairVehicle();
    } else if (code === 'KeyK' && this.activeVehicleId === null) {
      this.triggerQuickCook();
    } else if (code === 'KeyV' && this.activeVehicleId === null) {
      this.triggerBarricadeDoor();
    } else if (code === 'Digit1' && this.activeVehicleId === null) {
      this.selectWeapon('crowbar');
    } else if (code === 'Digit2' && this.activeVehicleId === null) {
      this.selectWeapon('pistol');
    } else if (code === 'Digit3' && this.activeVehicleId === null) {
      this.selectWeapon('shotgun');
    } else if (code === 'Digit4' && this.activeVehicleId === null) {
      this.selectWeapon('molotov');
    } else if (code === 'Digit5' && this.activeVehicleId === null) {
      this.selectWeapon('lmg');
    } else if (code === 'KeyH') {
      this.useConsumable('bandage');
    } else if (code === 'Digit6') {
      this.useConsumable(pickBestFoodConsumable(this.inventory) ?? 'food');
    } else if (code === 'Digit7') {
      this.useConsumable('water');
    } else if (code === 'KeyF') {
      this.triggerFlashlight();
    } else if (code === 'KeyB' && this.activeVehicleId === null) {
      this.toggleBuildMode();
    } else if (code === 'KeyR') {
      if (this.activeVehicleId !== null) this.refuelActiveVehicle();
      else this.tryStartReload();
    } else if (code === 'KeyE' && this.activeVehicleId === null) {
      this.tryLootNearby();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysHeld.delete(e.code);
  };

  private applyFpsMouseLookDelta(dx: number, dy: number): void {
    const { touchSensitivity: sens, invertLookY } = getSettings();
    if (this.activeVehicleId !== null) {
      const car = this.getActiveVehicle();
      const res = applyFirstPersonLookDelta(this.fpsCarLookOffset, this.fpsPitch, dx * sens, dy * sens, undefined, invertLookY);
      this.fpsCarLookOffset = clamp(res.yaw, -Math.PI * 0.65, Math.PI * 0.65);
      this.fpsPitch = res.pitch;
      if (car) {
        this.player.facingAngle = wrapAngleRad(car.angle + this.fpsCarLookOffset);
      }
    } else {
      const res = applyFirstPersonLookDelta(this.player.facingAngle, this.fpsPitch, dx * sens, dy * sens, undefined, invertLookY);
      this.player.facingAngle = res.yaw;
      this.fpsPitch = res.pitch;
    }
    this.updateMouseWorld();
  }

  private onPointerLockChange = (): void => {
    if (document.pointerLockElement === this.canvas) {
      this.skipNextPointerLockDelta = true;
      this.isMouseDraggingLook = false;
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.usingVirtualAim = false;
    if (this.cameraMode === 'fps' && this.phase === 'playing' && !this.modalOpen) {
      if (document.pointerLockElement === this.canvas) {
        if (this.skipNextPointerLockDelta) {
          this.skipNextPointerLockDelta = false;
          return;
        }
        // Guard against Chromium/OS cursor-warp spikes on pointer lock transition
        if (Math.abs(e.movementX) > 160 || Math.abs(e.movementY) > 160) return;
        this.applyFpsMouseLookDelta(clamp(e.movementX, -60, 60), clamp(e.movementY, -60, 60));
      } else if (this.isMouseDraggingLook) {
        const dx = e.clientX - this.lastDragX;
        const dy = e.clientY - this.lastDragY;
        this.lastDragX = e.clientX;
        this.lastDragY = e.clientY;
        if (Math.abs(dx) > 160 || Math.abs(dy) > 160) return;
        this.applyFpsMouseLookDelta(clamp(dx, -60, 60) * 1.35, clamp(dy, -60, 60) * 1.35);
      }
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreenX = e.clientX - rect.left;
    this.mouseScreenY = e.clientY - rect.top;
    this.updateMouseWorld();
  };

  private onMouseDown = (e: MouseEvent): void => {
    soundEngine.unlock();
    this.usingVirtualAim = false;
    if (this.phase !== 'playing' || this.modalOpen) return;

    if (this.cameraMode === 'fps') {
      this.requestPointerLock();
      this.isMouseDraggingLook = true;
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;
    }

    if (e.button === 2) {
      if (this.player.buildMode) {
        this.player.buildMode = null;
        this.emitHud();
      }
      return;
    }
    if (e.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreenX = e.clientX - rect.left;
    this.mouseScreenY = e.clientY - rect.top;
    this.updateMouseWorld();
    this.mouseDown = true;
    this.mouseJustClicked = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = false;
    this.isMouseDraggingLook = false;
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onBlur = (): void => {
    this.clearInputs();
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.saveNow();
      this.releasePointerLock();
      this.clearInputs();
    }
  };

  private onPageHide = (): void => {
    this.saveNow();
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private unbindEvents(): void {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private updateMouseWorld(): void {
    if (this.cameraMode === 'fps') {
      const aim = computeFirstPersonAimWorldTarget(
        this.player.x,
        this.player.y,
        this.player.facingAngle,
        this.fpsPitch
      );
      this.mouseWorldX = aim.wx;
      this.mouseWorldY = aim.wy;
      return;
    }
    // Camera look-ahead calls this after movement. Preserve touch aim rather than
    // overwriting the flashlight target with the last desktop cursor position.
    if (this.usingVirtualAim) {
      const angle = this.virtualAimActive ? this.virtualAimAngle : this.player.facingAngle;
      this.mouseWorldX = this.player.x + Math.cos(angle) * 4.5;
      this.mouseWorldY = this.player.y + Math.sin(angle) * 4.5;
      return;
    }
    const wp = this.threeRenderer.screenToWorld(
      this.mouseScreenX,
      this.mouseScreenY,
      this.camX,
      this.camY
    );
    this.mouseWorldX = wp.wx;
    this.mouseWorldY = wp.wy;
  }

  private update(dt: number): void {
    soundEngine.updateHeartbeat(this.player.hp, this.phase === 'playing' && !this.modalOpen && !this.pendingGameOver && !document.hidden, dt);
    soundEngine.updateAmbience(this.phase === 'playing', this.timeMinutes);
    if (this.phase !== 'playing' || this.modalOpen || this.pendingGameOver || document.hidden) soundEngine.updateSprintBreathing(false, false, 0);
    this.elapsedClock += dt;

    if (this.phase === 'paused' || this.phase === 'gameover' || this.hudEditMode) {
      return;
    }

    if(this.actionVisual){this.actionVisual.remaining-=dt;if(this.actionVisual.remaining<=0)this.actionVisual=null;}

    // Visual-only effects always tick even during hitstop
    this.trauma = Math.max(0, this.trauma - dt * 2.4);
    this.sleepTransitionTimer = Math.max(0, this.sleepTransitionTimer - dt);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
    this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt);
    if (this.hitMarkerTimer <= 0) {
      this.hitMarkerCrit = false;
      this.hitMarkerHeadshot = false;
    }
    this.screechCooldown = Math.max(0, this.screechCooldown - dt);
    this.weaponSwapTimer = Math.max(0, this.weaponSwapTimer - dt);
    this.updateParticles(dt);
    this.updateImpactEffects(dt);
    this.updateFloatingTexts(dt);
    this.updateSoundRipples(dt);
    for (const ash of this.ambientAsh) {
      ash.y += ash.speed * dt;
      ash.x += (ash.drift + Math.sin(this.elapsedClock * 1.3 + ash.y * 8) * 0.01) * dt;
      if (ash.y > 1.02) ash.y = -0.02;
      if (ash.x > 1.02) ash.x = -0.02;
    }

    if (this.statusBannerTimer > 0) {
      this.statusBannerTimer -= dt;
      if (this.statusBannerTimer <= 0) {
        this.statusBanner = null;
      }
    }

    if (this.pickupNotifications.length > 0) {
      const prevLen = this.pickupNotifications.length;
      this.pickupNotifications = tickPickupNotifications(this.pickupNotifications, dt);
      if (this.pickupNotifications.length !== prevLen) {
        this.emitHud();
      }
    }

    if (this.phase === 'title') {
      // Live World Camera Tour around crossroads camp
      const tourX = 28.5 + Math.cos(this.elapsedClock * 0.16) * 4.2;
      const tourY = 28.5 + Math.sin(this.elapsedClock * 0.13) * 3.8;
      const iso = worldToIso(tourX, tourY, 0);
      this.camX = lerp(this.camX, iso.sx, dt * 1.5);
      this.camY = lerp(this.camY, iso.sy, dt * 1.5);
      this.emitCampfireEmbers(dt);
      this.updateZombiesTitleTour(dt);
      return;
    }

    if (this.pendingGameOver) {
      soundEngine.updateEngineSound(false, 0, false);
      this.deathDelayTimer -= dt;
      if (this.deathDelayTimer <= 0) {
        this.pendingGameOver = false;
        if (this.hardcore) {
          // Hardcore: death permanently deletes the run.
          clearRunSnapshot();
          this.saveAvailable = false;
        }
        this.setPhase('gameover');
        this.emitHud();
      }
      return;
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      this.justPressed.clear();
      this.mouseJustClicked = false;
      return;
    }

    this.restCooldownSeconds = tickRestCooldown(this.restCooldownSeconds, dt, this.sleepTransitionTimer <= 0);
    this.recentCombatTimer = Math.max(0, this.recentCombatTimer - dt);

    // Periodic autosave; also saved on pause and when the app is backgrounded.
    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = AUTOSAVE_INTERVAL_SECONDS;
      this.saveNow();
    }

    // Advance Day-Night clock (1 full 24h cycle = ~9.6 real minutes)
    const prevTime = this.timeMinutes;
    this.timeMinutes += dt * 2.5;
    if (this.timeMinutes >= 1440) {
      this.timeMinutes -= 1440;
      this.day += 1;
      this.score += 150;
      this.showBanner(`DAY ${this.day} SURVIVED (+150 SCORE)`, 3.5);
    } else if (prevTime < 1200 && this.timeMinutes >= 1200) {
      this.showBanner('NIGHTFALL · INFECTED SURGE APPROACHING', 3.5);
    }

    // Decay vehicle hit flashes
    this.flushPendingChunkSpawns();
    for (const v of this.vehicles) {
      v.hitFlash = Math.max(0, v.hitFlash - dt);
    }

    if (this.activeVehicleId !== null) {
      this.updateDriving(dt);
    } else {
      soundEngine.updateEngineSound(false, 0, false);
      this.updatePlayer(dt);
    }
    soundEngine.updateSprintBreathing(this.activeVehicleId === null && this.isSprinting, this.phase === 'playing' && !this.modalOpen && !this.pendingGameOver && !document.hidden && this.player.hp > 0 && this.activeVehicleId === null, dt);
    this.updateDoors(dt);
    this.updateContainers(dt);
    this.updateFishing(dt);
    this.updateStructures(dt);
    this.updateProjectiles(dt);
    this.updateFirePatches(dt);
    this.updateZombies(dt);
    this.updateSpawning(dt);
    this.updateLandmarksAndHotspots(dt);
    this.emitCampfireEmbers(dt);

    // Smooth camera tracking with speed look-ahead when driving or cursor look-ahead on foot
    this.updateMouseWorld();
    const activeCar = this.getActiveVehicle();
    const lookX = activeCar
      ? clamp(activeCar.vx * 0.34, -3.2, 3.2)
      : clamp((this.mouseWorldX - this.player.x) * 0.18, -1.8, 1.8);
    const lookY = activeCar
      ? clamp(activeCar.vy * 0.34, -3.2, 3.2)
      : clamp((this.mouseWorldY - this.player.y) * 0.18, -1.8, 1.8);
    const targetIso = worldToIso(this.player.x + lookX, this.player.y + lookY, 0);
    this.camX = lerp(this.camX, targetIso.sx, 1 - Math.exp(-dt * 9));
    this.camY = lerp(this.camY, targetIso.sy, 1 - Math.exp(-dt * 9));

    this.hudSyncTimer += dt;
    if (this.hudSyncTimer >= 0.2) {
      this.hudSyncTimer = 0;
      this.emitHud();
    }

    this.justPressed.clear();
    this.mouseJustClicked = false;
    this.virtualFireJustPressed = false;
    this.virtualAimJustPressed = false;
  }

  private updateZombiesTitleTour(dt: number): void {
    for (const z of this.zombies) {
      z.walkCycle += dt * 2.4;
      const d = dist(z.x, z.y, z.wanderTargetX, z.wanderTargetY);
      if (d < 0.4 || Math.random() < 0.008) {
        z.wanderTargetX = z.x + (Math.random() - 0.5) * 6;
        z.wanderTargetY = z.y + (Math.random() - 0.5) * 6;
      }
      const dx = z.wanderTargetX - z.x;
      const dy = z.wanderTargetY - z.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = z.x + (dx / len) * z.speed * 0.45 * dt;
      const ny = z.y + (dy / len) * z.speed * 0.45 * dt;
      if (!this.isPointSolid(nx, ny, 0.25)) {
        z.x = nx;
        z.y = ny;
        z.facingX = dx / len;
        z.facingY = dy / len;
      }
    }
  }

  private updateDriving(dt: number): void {
    const idx = this.vehicles.findIndex((v) => v.id === this.activeVehicleId);
    if (idx === -1) {
      this.activeVehicleId = null;
      return;
    }

    const car = this.vehicles[idx];
    let throttle = 0;
    let steer = 0;
    const handbrake = this.keysHeld.has('Space') || this.virtualBrakeHeld;
    const boost =
      this.keysHeld.has('ShiftLeft') || this.keysHeld.has('ShiftRight') || this.virtualBoostHeld;

    if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) throttle += 1;
    if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) throttle -= 1;
    if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) steer -= 1;
    if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) steer += 1;

    // Up/down throttle follows the car's nose; left/right turns its wheels.
    // Keep keyboard priority and the on-foot screen-relative movement unchanged.
    const keyboardDriving = ['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight']
      .some((key) => this.keysHeld.has(key));
    if (!keyboardDriving) {
      ({ throttle, steer } = vehicleRelativeTouchInput(this.virtualMoveX, this.virtualMoveY));
    }

    if (car.fuel <= 0 && Math.abs(throttle) > 0.1 && this.inventory.fuel > 0) {
      this.showBanner('Out of Gas! Press [R] to refuel (+45%)', 2.0);
    }

    const next = stepVehiclePhysics(car, throttle, steer, handbrake, dt, boost);
    if (next.boosting && !this.prevBoostActive) {
      soundEngine.playTurboSurge();
    }
    this.prevBoostActive = next.boosting;

    // Move car & resolve tight solid building/prop/parked-car collisions across infinite world
    const carRadius = 0.42;
    const nextX = next.x + next.vx * dt;
    const nextY = next.y + next.vy * dt;
    let crashed = false;

    if (!isCircleBlocked(this.worldStore, nextX, next.y, carRadius, this.vehicles, next.id)) {
      next.x = nextX;
    } else {
      crashed = true;
    }

    if (!isCircleBlocked(this.worldStore, next.x, nextY, carRadius, this.vehicles, next.id)) {
      next.y = nextY;
    } else {
      crashed = true;
    }

    if (crashed && Math.abs(next.speed) > 2.4) {
      soundEngine.playCarImpact();
      this.trauma = Math.min(1, this.trauma + Math.min(0.6, Math.abs(next.speed) * 0.06));
      next.hp = Math.max(0, next.hp - Math.round(Math.abs(next.speed) * 1.6));
      next.hitFlash = 0.12;
      next.speed *= -0.35;
      next.vx *= -0.25;
      next.vy *= -0.25;
      this.spawnParticles(next.x, next.y, 0.35, 8, '#f0b849', 3.4, 2.2);
      if (next.hp <= 0) {
        this.showBanner('Vehicle Wrecked! Ejecting...', 2.2);
        this.vehicles[idx] = next;
        this.triggerEnterExitVehicle();
        return;
      }
    }

    // Tire skid marks, smoke, and tire screech when handbrake drifting
    if (next.drifting) {
      if (Math.random() < 0.75) {
        this.decals.push({ x: next.x, y: next.y, variant: 0, alpha: 0.45, kind: 'tire' });
        if (this.decals.length > 130) this.decals.shift();
        this.spawnParticles(next.x, next.y, 0.1, 1, '#9ba0a3', 1.2, 0.9, 1.5);
      }
      if (this.screechCooldown <= 0) {
        this.screechCooldown = 0.24;
        soundEngine.playTireScreech();
      }
    }

    // Exhaust puffs & Turbo Boost flame sparks
    if (next.boosting && Math.random() < dt * 28) {
      this.spawnParticles(
        next.x - Math.cos(next.angle) * 0.78,
        next.y - Math.sin(next.angle) * 0.78,
        0.16,
        1,
        Math.random() < 0.5 ? '#ffbe42' : '#ff6829',
        1.1,
        0.6,
        -1.5
      );
    } else if (Math.abs(throttle) > 0.2 && next.fuel > 0 && Math.random() < dt * 10) {
      this.spawnParticles(
        next.x - Math.cos(next.angle) * 0.75,
        next.y - Math.sin(next.angle) * 0.75,
        0.15,
        1,
        '#72787a',
        0.7,
        0.8,
        -1.2
      );
    }

    // Zombie ramming physics
    const ram = computeRamImpact(next.speed, next.boosting);
    if (ram.damage > 0) {
      for (const z of this.zombies) {
        if (z.state === 'dying') continue;
        if (dist(next.x, next.y, z.x, z.y) <= 0.96) {
          const kbDirX = Math.cos(next.angle) + (z.x - next.x) * 0.8;
          const kbDirY = Math.sin(next.angle) + (z.y - next.y) * 0.8;
          const kbLen = Math.hypot(kbDirX, kbDirY) || 1;
          this.damageZombie(
            z,
            ram.damage,
            (kbDirX / kbLen) * (ram.heavy ? 8.2 : 5.4),
            (kbDirY / kbLen) * (ram.heavy ? 8.2 : 5.4),
            ram.heavy,
            ram.heavy
          );
          next.speed *= 0.88;
          next.hp = Math.max(0, next.hp - (z.archetype === 'bloater' ? 7 : 2));
          next.hitFlash = 0.08;
          soundEngine.playCarZombieImpact();
          this.trauma = Math.min(1, this.trauma + (ram.heavy ? 0.35 : 0.18));
        }
      }
    }

    // Attract zombies to engine roar at speed or siren
    if ((Math.abs(next.speed) > 4.2 || next.sirenOn) && Math.random() < dt * 2.5) {
      this.emitSound(next.x, next.y, next.sirenOn ? 14 : 9.5, false);
    }

    this.vehicles[idx] = next;
    soundEngine.updateEngineSound(next.fuel > 0, Math.abs(next.speed) / 10.6, next.kind === 'police');

    // Sync survivor inside cabin
    this.player.x = next.x;
    this.player.y = next.y;
    if (this.cameraMode === 'fps') {
      if (Math.abs(steer) > 0.1 && document.pointerLockElement !== this.canvas && !this.isMouseDraggingLook) {
        this.fpsCarLookOffset *= Math.exp(-dt * 1.8);
      }
      this.player.facingAngle = wrapAngleRad(next.angle + this.fpsCarLookOffset);
    } else {
      this.player.facingAngle = next.angle;
    }
    this.player.hitFlash = Math.max(0, this.player.hitFlash - dt);
    this.player.invulnTimer = Math.max(0, this.player.invulnTimer - dt);
    this.player = tickSurvivalNeeds(this.player, dt, false, false);

    // Stream infinite chunks & reveal minimap fog with headlights
    const fgx = Math.floor(next.x);
    const fgy = Math.floor(next.y);
    if (fgx !== this.lastFogGX || fgy !== this.lastFogGY) {
      this.lastFogGX = fgx;
      this.lastFogGY = fgy;
      this.streamChunksAround(next.x, next.y, 3);
      this.revealFogAround(next.x, next.y, next.headlightsOn ? 11 : 7);
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    p.invulnTimer = Math.max(0, p.invulnTimer - dt);
    p.attackCooldown = Math.max(0, p.attackCooldown - dt);
    p.meleeSwingTimer = Math.max(0, p.meleeSwingTimer - dt);
    p.dodgeCooldown = Math.max(0, p.dodgeCooldown - dt);
    p.scaleX = lerp(p.scaleX, 1, 1 - Math.exp(-dt * 14));
    p.scaleY = lerp(p.scaleY, 1, 1 - Math.exp(-dt * 14));

    // Reloading timer
    if (p.reloadingTimer > 0 && p.reloadingWeapon) {
      p.reloadingTimer -= dt;
      if (p.reloadingTimer <= 0) {
        this.finishReload(p.reloadingWeapon);
      }
    }

    // Keyboard turning in FPS mode (ArrowLeft / ArrowRight); mobile look uses right-side drag pad
    if (this.cameraMode === 'fps') {
      let yawTurn = 0;
      if (this.keysHeld.has('ArrowLeft')) yawTurn -= 1;
      if (this.keysHeld.has('ArrowRight')) yawTurn += 1;
      if (yawTurn !== 0) {
        p.facingAngle = wrapAngleRad(p.facingAngle + yawTurn * 2.35 * dt);
      }
    }

    // Movement vector: FPS camera-relative WASD OR classic screen-aligned isometric WASD
    let moveX = 0;
    let moveY = 0;
    const vMag = Math.hypot(this.virtualMoveX, this.virtualMoveY);

    if (this.cameraMode === 'fps') {
      let fwd = 0;
      let strafe = 0;
      if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) fwd += 1;
      if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) fwd -= 1;
      if (this.keysHeld.has('KeyA')) strafe -= 1;
      if (this.keysHeld.has('KeyD')) strafe += 1;
      if (vMag > 0.14) {
        fwd -= this.virtualMoveY;
        strafe += this.virtualMoveX;
      }
      this.fpsStrafeInput = clamp(strafe, -1, 1);
      const vec = computeFirstPersonMoveVector(fwd, strafe, p.facingAngle);
      moveX = vec.wx;
      moveY = vec.wy;
    } else {
      this.fpsStrafeInput = 0;
      if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) {
        moveX -= 1;
        moveY -= 1;
      }
      if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) {
        moveX += 1;
        moveY += 1;
      }
      if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) {
        moveX -= 1;
        moveY += 1;
      }
      if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) {
        moveX += 1;
        moveY -= 1;
      }
      if (vMag > 0.14) {
        const isoVec = screenVectorToIsoWorld(this.virtualMoveX, this.virtualMoveY);
        moveX += isoVec.wx;
        moveY += isoVec.wy;
      }
    }

    const moveLen = Math.hypot(moveX, moveY);
    if (moveLen > 0) {
      moveX /= moveLen;
      moveY /= moveLen;
    }

    // Dodge roll (Space)
    if (this.justPressed.has('Space') && p.dodgeCooldown <= 0 && p.dodgeTimer <= 0) {
      p.dodgeTimer = 0.22;
      p.dodgeCooldown = 0.65;
      p.invulnTimer = Math.max(p.invulnTimer, 0.26);
      if (moveLen > 0) {
        p.dodgeDirX = moveX;
        p.dodgeDirY = moveY;
      } else {
        p.dodgeDirX = Math.cos(p.facingAngle);
        p.dodgeDirY = Math.sin(p.facingAngle);
      }
      p.scaleX = 1.24;
      p.scaleY = 0.78;
      this.spawnParticles(p.x, p.y, 0.1, 6, '#9ca396', 2.4, 1.5);
      soundEngine.playDodge();
    }

    const wantsSprint =
      ((this.keysHeld.has('ShiftLeft') || this.keysHeld.has('ShiftRight')) || vMag > 0.85) &&
      moveLen > 0;
    this.isSprinting = wantsSprint;

    if (p.dodgeTimer > 0) {
      p.dodgeTimer -= dt;
      const dodgeSpeed = 8.4;
      this.playerVelX = p.dodgeDirX * dodgeSpeed;
      this.playerVelY = p.dodgeDirY * dodgeSpeed;
      this.moveActor(p, this.playerVelX * dt, this.playerVelY * dt, 0.22);
    } else {
      const baseSpeed = wantsSprint ? 4.8 : 3.25;
      const targetVx = moveLen > 0 ? moveX * baseSpeed : 0;
      const targetVy = moveLen > 0 ? moveY * baseSpeed : 0;
      const accelRate = moveLen > 0 ? 18 : 22;
      const blend = 1 - Math.exp(-dt * accelRate);
      this.playerVelX = lerp(this.playerVelX, targetVx, blend);
      this.playerVelY = lerp(this.playerVelY, targetVy, blend);

      const speedNow = Math.hypot(this.playerVelX, this.playerVelY);
      if (moveLen === 0 && speedNow < 0.08) {
        this.playerVelX = 0;
        this.playerVelY = 0;
        p.walkCycle = 0;
      } else {
        const dx = this.playerVelX * dt;
        const dy = this.playerVelY * dt;
        const beforeX = p.x, beforeY = p.y;
        this.moveActor(p, dx, dy, 0.22);
        const stepDist = Math.hypot(p.x - beforeX, p.y - beforeY);
        p.walkCycle += stepDist * 5.2;
        p.stepAccumulator += stepDist;
        if (this.fishing.phase !== 'idle') {
          this.cancelFishing();
        }
        if (p.stepAccumulator >= 0.85) {
          p.stepAccumulator = 0;
          const cell = this.getCell(Math.floor(p.x), Math.floor(p.y));
          const surf = footstepSurfaceForTile(cell.tile);
          if (surf) soundEngine.playFootstep(surf, wantsSprint);
        }
      }
    }

    // Aim facing: in FPS mode yaw is controlled by mouse-look/arrows; in ISO by cursor/touch stick
    if (this.cameraMode !== 'fps') {
      if (this.virtualAimActive) {
        p.facingAngle = this.virtualAimAngle;
        this.mouseWorldX = p.x + Math.cos(this.virtualAimAngle) * 4.5;
        this.mouseWorldY = p.y + Math.sin(this.virtualAimAngle) * 4.5;
      } else if (this.usingVirtualAim && vMag > 0.14 && moveLen > 0) {
        p.facingAngle = Math.atan2(moveY, moveX);
        this.mouseWorldX = p.x + Math.cos(p.facingAngle) * 4.0;
        this.mouseWorldY = p.y + Math.sin(p.facingAngle) * 4.0;
      } else if (!this.usingVirtualAim) {
        p.facingAngle = Math.atan2(this.mouseWorldY - p.y, this.mouseWorldX - p.x);
      }
    }

    // Survival needs update
    const nearCampfire = this.structures.some(
      (s) => s.kind === 'campfire' && dist(s.gx + 0.5, s.gy + 0.5, p.x, p.y) <= 4.2
    );
    this.player = tickSurvivalNeeds(p, dt, wantsSprint, nearCampfire);

    // Subtle campfire crackle & low-HP heartbeat Foley
    if (nearCampfire) {
      this.crackleTimer -= dt;
      if (this.crackleTimer <= 0) {
        this.crackleTimer = 0.25 + Math.random() * 0.65;
        soundEngine.playCampfireCrackle();
      }
    }
    // Auto-collect zombie loot pouches when walking directly over them
    for (const c of this.containers) {
      if (c.kind === 'zombie_drop' && !c.searched && dist(this.player.x, this.player.y, c.gx + 0.5, c.gy + 0.5) <= 0.78) {
        this.collectContainer(c);
        break;
      }
    }

    // Stream infinite chunks & reveal minimap fog when survivor steps onto a new tile
    const fgx = Math.floor(this.player.x);
    const fgy = Math.floor(this.player.y);
    if (fgx !== this.lastFogGX || fgy !== this.lastFogGY) {
      this.lastFogGX = fgx;
      this.lastFogGY = fgy;
      this.streamChunksAround(this.player.x, this.player.y, 3);
      this.revealFogAround(this.player.x, this.player.y, this.player.flashlightOn ? 10 : 6);
    }

    // Handle Fishing Hook/Reel, Build Mode, or Combat Action
    // Inner ring aims only for every weapon in ISO. FPS uses separate look pad + Slash/Fire buttons.
    const aimStickAttack =
      this.cameraMode === 'fps' ? false : touchAimAttack(this.virtualAimActive, this.virtualAimMag);

    const triggerAction =
      this.mouseJustClicked ||
      this.virtualFireJustPressed ||
      this.virtualFireHeld ||
      aimStickAttack ||
      (this.mouseDown && (p.equippedWeapon === 'crowbar' || p.equippedWeapon === 'lmg')) ||
      this.justPressed.has('KeyJ');

    if (
      this.fishing.phase !== 'idle' &&
      (this.mouseJustClicked || this.virtualFireJustPressed || this.virtualAimJustPressed || this.justPressed.has('KeyJ'))
    ) {
      this.reelFishing();
    } else if (this.player.buildMode && (this.mouseJustClicked || this.virtualFireJustPressed || this.virtualAimJustPressed)) {
      this.tryPlaceStructure();
    } else if (!this.player.buildMode && this.fishing.phase === 'idle' && triggerAction) {
      this.tryAttack();
    }

    // Check death
    if (this.player.hp <= 0 && !this.pendingGameOver) {
      this.player.hp = 0;
      this.pendingGameOver = true;
      this.actionVisual = null;
      this.deathDelayTimer = 0.55;
      this.trauma = 1.0;
      this.spawnParticles(this.player.x, this.player.y, 0.5, 22, '#a82323', 4.2, 3.0);
      soundEngine.playPlayerHurt();
      if (this.score > this.bestScore) {
        this.bestScore = this.score;
        try {
          localStorage.setItem(BEST_SCORE_KEY, String(this.bestScore));
        } catch {
          // ignore
        }
      }
    }
  }

  private tryPlaceStructure(): void {
    const kind = this.player.buildMode;
    if (!kind) return;
    const { gx, gy } = getBuildTargetTile(
      this.player.x,
      this.player.y,
      this.player.facingAngle,
      this.mouseWorldX,
      this.mouseWorldY,
      this.usingVirtualAim
    );
    const spec = STRUCTURES[kind];

    if (!canAffordCost(this.inventory, spec.cost)) {
      this.showBanner(`Need more resources for ${spec.name}`, 1.8);
      return;
    }
    if (!canPlaceStructureAt(this.worldStore, this.structures, gx, gy, this.player.x, this.player.y)) {
      this.showBanner('Cannot build there (blocked or too far)', 1.5);
      return;
    }

    this.inventory = spendCost(this.inventory, spec.cost);
    this.structures.push({
      id: `str_${this.nextEntityId++}`,
      gx,
      gy,
      kind,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      cooldown: 0,
      hitFlash: 0,
    });
    if (kind === 'barricade') {
      this.getCell(gx, gy).solid = true;
    }
    this.animateAction('build','BUILDING',1.3);
    soundEngine.playBuildHammer();
    this.spawnParticles(gx + 0.5, gy + 0.5, 0.3, 10, '#a67449', 2.6, 2.2);
    this.addFloatingText(gx + 0.5, gy + 0.5, 1.0, `Built ${spec.name}`, '#e0bd5e');
    this.emitSound(gx + 0.5, gy + 0.5, 7.0, true);
    this.emitHud();
  }

  private tryStartReload(): void {
    const p = this.player;
    if (p.reloadingTimer > 0) return;
    if (p.equippedWeapon === 'pistol') {
      if (p.pistolMag >= p.pistolMagSize || this.inventory.ammo_9mm <= 0) return;
      p.reloadingWeapon = 'pistol';
      p.reloadingTimer = WEAPONS.pistol.reloadTime;
      soundEngine.playReload();
      this.emitHud();
    } else if (p.equippedWeapon === 'shotgun') {
      if (p.shotgunMag >= p.shotgunMagSize || this.inventory.ammo_shell <= 0) return;
      p.reloadingWeapon = 'shotgun';
      p.reloadingTimer = WEAPONS.shotgun.reloadTime;
      soundEngine.playReload();
      this.emitHud();
    }
  }

  private finishReload(weapon: WeaponId): void {
    const p = this.player;
    if (weapon === 'pistol') {
      const needed = p.pistolMagSize - p.pistolMag;
      const take = Math.min(needed, this.inventory.ammo_9mm);
      p.pistolMag += take;
      this.inventory.ammo_9mm -= take;
    } else if (weapon === 'shotgun') {
      const needed = p.shotgunMagSize - p.shotgunMag;
      const take = Math.min(needed, this.inventory.ammo_shell);
      p.shotgunMag += take;
      this.inventory.ammo_shell -= take;
    }
    p.reloadingTimer = 0;
    p.reloadingWeapon = null;
    soundEngine.playReloadComplete();
    this.emitHud();
  }

  private tryAttack(): void {
    const p = this.player;
    if (p.attackCooldown > 0 || p.reloadingTimer > 0) return;
    this.actionVisual = null;

    const spec = WEAPONS[p.equippedWeapon];

    if (p.equippedWeapon === 'crowbar') {
      p.attackCooldown = spec.cooldown;
      p.meleeSwingTimer = 0.22;
      p.scaleX = 1.16;
      p.scaleY = 0.88;
      soundEngine.playMeleeSwing();

      let hitCount = 0;
      for (const z of this.zombies) {
        if (z.state === 'dying') continue;
        if (isTargetInMeleeArc(p.x, p.y, p.facingAngle, z.x, z.y, spec.range, spec.spreadRad * 0.55)) {
          hitCount++;
          const kbX = (z.x - p.x) / (Math.hypot(z.x - p.x, z.y - p.y) || 1);
          const kbY = (z.y - p.y) / (Math.hypot(z.x - p.x, z.y - p.y) || 1);
          const { damage, isCrit } = computeCombatDamage(spec.damage, Math.random(), 0.2);
          this.damageZombie(z, damage, kbX * (isCrit ? 5.0 : 3.8), kbY * (isCrit ? 5.0 : 3.8), true, isCrit);
        }
      }
      if (hitCount > 0) {
        soundEngine.playMeleeHit(hitCount > 1);
        this.hitstopTimer = 0.045;
        this.trauma = Math.min(1, this.trauma + 0.26);
      } else {
        // Crowbar can pry open locked doors loudly in 2 hits
        const lockedDoor = this.doors.find(
          (d) =>
            d.status === 'locked' &&
            isTargetInMeleeArc(p.x, p.y, p.facingAngle, d.gx + 0.5, d.gy + 0.5, spec.range, spec.spreadRad * 0.7)
        );
        if (lockedDoor) {
          const cell = this.getCell(lockedDoor.gx, lockedDoor.gy);
          const pry = advanceDoorLockpick(lockedDoor, cell, 0.55);
          lockedDoor.hitFlash = 0.14;
          soundEngine.playCarImpact();
          this.emitSound(lockedDoor.gx + 0.5, lockedDoor.gy + 0.5, 9.5, true);
          this.spawnParticles(lockedDoor.gx + 0.5, lockedDoor.gy + 0.5, 0.45, 7, '#a67449', 2.4, 1.8);
          this.addFloatingText(
            lockedDoor.gx + 0.5,
            lockedDoor.gy + 0.5,
            1.1,
            pry.unlocked ? 'PRIED OPEN!' : 'PRYING LOCK...',
            '#ffd266'
          );
        }
      }
      this.emitHud();
      return;
    }

    if (p.equippedWeapon === 'pistol') {
      if (p.pistolMag <= 0) {
        soundEngine.playDryFire();
        if (this.inventory.ammo_9mm > 0) this.tryStartReload();
        else this.showBanner('No 9mm ammo! Craft or scavenge', 1.6);
        return;
      }
      p.pistolMag -= 1;
      p.attackCooldown = spec.cooldown;
      p.scaleX = 0.92;
      p.scaleY = 1.08;
      this.muzzleFlashTimer = 0.075;
      soundEngine.playGunshot('pistol');
      this.trauma = Math.min(1, this.trauma + 0.24);
      this.emitSound(p.x, p.y, spec.noiseRadius, true);
      this.fireProjectiles('bullet', p.x, p.y, p.facingAngle, 1, spec.spreadRad, spec.damage, BULLET_SPEED);
      if (this.cameraMode === 'fps') {
        this.fpsPitch = clamp(this.fpsPitch + 0.011, FPS_PITCH_MIN, FPS_PITCH_MAX);
      }
      // Muzzle flash & ejecting brass casing
      const cosF = Math.cos(p.facingAngle);
      const sinF = Math.sin(p.facingAngle);
      if (this.cameraMode === 'fps') {
        this.spawnParticles(p.x + cosF * 0.45 - sinF * 0.32, p.y + sinF * 0.45 + cosF * 0.32, 0.62, 1, '#e6be53', 1.4, 1.8, 14);
      } else {
        this.spawnParticles(p.x + cosF * 0.4, p.y + sinF * 0.4, 0.65, 5, '#ffd978', 3.4, 0.6);
        this.spawnParticles(p.x - sinF * 0.25, p.y + cosF * 0.25, 0.75, 1, '#e6be53', 1.6, 2.4, 14);
      }
      this.emitHud();
      return;
    }

    if (p.equippedWeapon === 'shotgun') {
      if (p.shotgunMag <= 0) {
        soundEngine.playDryFire();
        if (this.inventory.ammo_shell > 0) this.tryStartReload();
        else this.showBanner('No 12G shells! Craft or scavenge', 1.6);
        return;
      }
      p.shotgunMag -= 1;
      p.attackCooldown = spec.cooldown;
      p.scaleX = 0.84;
      p.scaleY = 1.16;
      this.muzzleFlashTimer = 0.095;
      soundEngine.playGunshot('shotgun');
      this.trauma = Math.min(1, this.trauma + 0.55);
      this.hitstopTimer = 0.032;
      this.emitSound(p.x, p.y, spec.noiseRadius, true);
      this.fireProjectiles('pellet', p.x, p.y, p.facingAngle, spec.pellets, spec.spreadRad, spec.damage, PELLET_SPEED);
      if (this.cameraMode === 'fps') {
        this.fpsPitch = clamp(this.fpsPitch + 0.026, FPS_PITCH_MIN, FPS_PITCH_MAX);
      }
      const cosF = Math.cos(p.facingAngle);
      const sinF = Math.sin(p.facingAngle);
      if (this.cameraMode === 'fps') {
        this.spawnParticles(p.x + cosF * 0.45 - sinF * 0.32, p.y + sinF * 0.45 + cosF * 0.32, 0.62, 1, '#d1493b', 1.7, 2.0, 14);
      } else {
        this.spawnParticles(p.x + cosF * 0.5, p.y + sinF * 0.5, 0.65, 11, '#ffbc52', 4.6, 0.8);
        this.spawnParticles(p.x - sinF * 0.25, p.y + cosF * 0.25, 0.75, 1, '#d1493b', 1.9, 2.7, 14);
      }
      this.emitHud();
      return;
    }

    if (p.equippedWeapon === 'lmg') {
      // Full-auto, belt-fed: no magazine, no reload, no ammo economy. Lower per-hit damage than
      // the pistol or a single shotgun pellet, paid back with rate of fire and noise.
      p.attackCooldown = spec.cooldown;
      p.scaleX = 0.95;
      p.scaleY = 1.05;
      this.muzzleFlashTimer = 0.05;
      soundEngine.playGunshot('lmg');
      this.trauma = Math.min(1, this.trauma + 0.1);
      this.emitSound(p.x, p.y, spec.noiseRadius, true);
      this.fireProjectiles('bullet', p.x, p.y, p.facingAngle, 1, spec.spreadRad, spec.damage, BULLET_SPEED);
      if (this.cameraMode === 'fps') {
        this.fpsPitch = clamp(this.fpsPitch + 0.006, FPS_PITCH_MIN, FPS_PITCH_MAX);
      }
      const cosF = Math.cos(p.facingAngle);
      const sinF = Math.sin(p.facingAngle);
      if (this.cameraMode === 'fps') {
        this.spawnParticles(p.x + cosF * 0.45 - sinF * 0.32, p.y + sinF * 0.45 + cosF * 0.32, 0.62, 1, '#e6be53', 1.3, 1.7, 14);
      } else {
        this.spawnParticles(p.x + cosF * 0.42, p.y + sinF * 0.42, 0.65, 3, '#ffd978', 3.2, 0.55);
        this.spawnParticles(p.x - sinF * 0.25, p.y + cosF * 0.25, 0.75, 1, '#e6be53', 1.5, 2.2, 14);
      }
      return;
    }

    if (p.equippedWeapon === 'molotov') {
      if (this.inventory.molotov <= 0) {
        this.showBanner('No Molotovs left!', 1.4);
        return;
      }
      this.inventory.molotov -= 1;
      p.attackCooldown = spec.cooldown;
      soundEngine.playMeleeSwing();
      const useForwardTarget = this.usingVirtualAim && this.cameraMode !== 'fps';
      const tx = useForwardTarget
        ? p.x + Math.cos(p.facingAngle) * 4.5
        : clamp(this.mouseWorldX, p.x - spec.range, p.x + spec.range);
      const ty = useForwardTarget
        ? p.y + Math.sin(p.facingAngle) * 4.5
        : clamp(this.mouseWorldY, p.y - spec.range, p.y + spec.range);
      const d = Math.max(1.2, dist(p.x, p.y, tx, ty));
      const travelTime = clamp(d / 8.5, 0.25, 0.85);
      this.projectiles.push({
        id: this.nextEntityId++,
        kind: 'molotov',
        x: p.x,
        y: p.y,
        z: 0.7,
        vx: (tx - p.x) / travelTime,
        vy: (ty - p.y) / travelTime,
        vz: 4.5 * travelTime,
        damage: spec.damage,
        life: travelTime,
        maxLife: travelTime,
        targetX: tx,
        targetY: ty,
      });
      this.emitHud();
    }
  }

  private fireProjectiles(
    kind: 'bullet' | 'pellet',
    sx: number,
    sy: number,
    angle: number,
    count: number,
    spread: number,
    damage: number,
    speed: number
  ): void {
    const isFps = this.cameraMode === 'fps';
    const spawnZ = isFps ? FPS_EYE_HEIGHT : 0.65;
    const maxLife = kind === 'pellet' ? 0.28 : 0.45;
    for (let i = 0; i < count; i++) {
      const yawOffset = (Math.random() - 0.5) * spread;
      if (isFps) {
        const pitchOffset = (Math.random() - 0.5) * spread * (kind === 'pellet' ? 0.55 : 0.42);
        const vel = computeProjectileVelocity3D(angle, this.fpsPitch, yawOffset, pitchOffset, speed);
        const leadT = 0.22 / speed;
        this.projectiles.push({
          id: this.nextEntityId++,
          kind,
          x: sx + vel.vx * leadT,
          y: sy + vel.vy * leadT,
          z: spawnZ + vel.vz * leadT,
          vx: vel.vx,
          vy: vel.vy,
          vz: vel.vz,
          damage,
          life: maxLife,
          maxLife,
          canHeadshot: true,
        });
      } else {
        const a = angle + yawOffset;
        this.projectiles.push({
          id: this.nextEntityId++,
          kind,
          x: sx + Math.cos(a) * 0.35,
          y: sy + Math.sin(a) * 0.35,
          z: spawnZ,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          vz: 0,
          damage,
          life: maxLife,
          maxLife,
          canHeadshot: false,
        });
      }
    }
  }

  private tryLootNearby(): void {
    if (this.fishing.phase !== 'idle') {
      this.reelFishing();
      return;
    }
    const c = this.findNearestLootable();
    if (c) {
      this.collectContainer(c);
      return;
    }
    const door = this.findNearestDoor();
    if (door) {
      this.interactDoor(door);
      return;
    }
    const v = this.findNearestVehicleTrunk();
    if (v) {
      this.collectVehicleTrunk(v);
      return;
    }
    const spot = findFishingSpot(this.worldStore, this.player.x, this.player.y);
    if (spot) {
      this.startFishing(spot);
      return;
    }
    if (this.trySleepInBed()) {
      return;
    }
    if (this.isNearCookingHeat()) {
      soundEngine.playUiClick();
      this.onRequestOpenCook?.();
    }
  }

  private cancelFishing(): void {
    if (this.fishing.phase === 'idle') return;
    this.fishing = createIdleFishingState();
    this.emitHud();
  }

  private startFishing(spot: NonNullable<ReturnType<typeof findFishingSpot>>): void {
    this.player.buildMode = null;
    this.player.facingAngle = Math.atan2(spot.bobberY - this.player.y, spot.bobberX - this.player.x);
    this.fishing = {
      phase: 'casting',
      pierGX: spot.pierGX,
      pierGY: spot.pierGY,
      bobberX: spot.bobberX,
      bobberY: spot.bobberY,
      timer: 0.32,
      biteDuration: 1.05,
      biteElapsed: 0,
      ripplePhase: 0,
    };
    soundEngine.playFishingCast();
    this.addFloatingText(spot.bobberX, spot.bobberY, 0.8, 'CASTING...', '#8ad4eb');
    this.emitHud();
  }

  private reelFishing(): void {
    if (this.fishing.phase === 'idle') return;
    if (this.fishing.phase === 'bite') {
      const roll = Math.random();
      const caughtCount = roll < 0.14 ? 2 : 1;
      this.inventory.raw_fish += caughtCount;
      let bonusText = '';
      if (roll >= 0.88) {
        this.inventory.scrap += 1;
        bonusText = ' +1 SCRAP';
      }
      this.score += 25;
      this.animateAction('reel','REELED IN',1.0);
      soundEngine.playFishingCatch();
      this.spawnParticles(this.fishing.bobberX, this.fishing.bobberY, 0.15, 10, '#8ad4eb', 2.4, 2.2);
      this.addFloatingText(
        this.fishing.bobberX,
        this.fishing.bobberY,
        1.0,
        `+${caughtCount} RAW FISH${bonusText}`,
        '#7fe0ff'
      );
      this.recordItemPickups(
        { raw_fish: caughtCount, ...(roll >= 0.88 ? { scrap: 1 } : {}) },
        'Fishing'
      );
      this.fishing = createIdleFishingState();
      this.emitHud();
      return;
    }
    this.animateAction('reel','REELING',.75);
    this.addFloatingText(this.fishing.bobberX, this.fishing.bobberY, 0.8, 'PULLED EARLY', '#c7c2b6');
    this.fishing = createIdleFishingState();
    this.emitHud();
  }

  private updateFishing(dt: number): void {
    const f = this.fishing;
    if (f.phase === 'idle') return;
    f.ripplePhase += dt;
    if (f.phase === 'casting') {
      f.timer -= dt;
      if (f.timer <= 0) {
        const standing = this.getCell(Math.floor(this.player.x), Math.floor(this.player.y));
        f.phase = 'waiting';
        f.timer = standing.tile === 'pier' ? 1.35 + Math.random() * 1.45 : 2.1 + Math.random() * 1.8;
        this.spawnParticles(f.bobberX, f.bobberY, 0.05, 4, '#a6e4f5', 1.2, 0.9);
      }
    } else if (f.phase === 'waiting') {
      f.timer -= dt;
      if (f.timer <= 0) {
        f.phase = 'bite';
        f.biteElapsed = 0;
        f.biteDuration = 1.05;
        soundEngine.playFishingBite();
        this.spawnParticles(f.bobberX, f.bobberY, 0.1, 7, '#d4f5ff', 1.8, 1.4);
        this.addFloatingText(f.bobberX, f.bobberY, 0.9, '! HOOK !', '#ffd266');
        this.emitHud();
      }
    } else if (f.phase === 'bite') {
      f.biteElapsed += dt;
      if (f.biteElapsed >= f.biteDuration) {
        this.addFloatingText(f.bobberX, f.bobberY, 0.9, 'FISH SLIPPED', '#e0895e');
        this.fishing = createIdleFishingState();
        this.emitHud();
      }
    }
  }

  private updateDoors(dt: number): void {
    const rate = 1 - Math.exp(-dt * 12);
    for (const d of this.doors) {
      const target = d.status === 'open' ? 1 : 0;
      d.openProgress = lerp(d.openProgress, target, rate);
      d.hitFlash = Math.max(0, d.hitFlash - dt);
    }
  }

  private updateContainers(dt: number): void {
    const inspectedId =
      this.activeLootSource?.type === 'container' ? this.activeLootSource.container.id : null;
    for (const c of this.containers) {
      if (c.kind === 'zombie_drop') continue;
      if (c.searched || c.id === inspectedId) {
        const cur = c.openAnim ?? 0;
        if (cur < 1) {
          c.openAnim = Math.min(1, cur + dt * 2.8);
        }
      }
      if (c.popTimer && c.popTimer > 0) {
        c.popTimer = Math.max(0, c.popTimer - dt);
      }
    }
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    return this.threeRenderer.getRenderInfo();
  }

  private collectContainer(c: LootContainer): void {
    if (c.searched && c.kind === 'zombie_drop') return;
    if (c.kind === 'zombie_drop') {
      this.animateAction('search', 'SCAVENGING', 0.6);
      c.searched = true;
      const gained: string[] = [];
      for (const [key, qty] of Object.entries(c.items)) {
        if (!qty) continue;
        const item = key as ItemId;
        this.inventory[item] += qty;
        gained.push(`+${qty} ${item.replace('ammo_', '')}`);
      }
      soundEngine.playLootPickup();
      this.score += 15;
      this.recordItemPickups(c.items, 'Scavenge Pouch');
      const label = gained.length > 0 ? gained.slice(0, 3).join(' · ') : 'Empty';
      this.addFloatingText(c.gx + 0.5, c.gy + 0.5, 1.1, label, '#f0d078');
      this.spawnParticles(c.gx + 0.5, c.gy + 0.5, 0.4, 6, '#d9b566', 2.0, 1.8);
      this.emitHud();
      return;
    }

    const entries = extractLootEntries(c.items);
    c.openAnim = Math.max(0.08, c.openAnim ?? 0);
    c.popTimer = 0.42;
    this.animateAction('search', 'INSPECTING', 0.75);
    soundEngine.playUiClick();
    this.activeLootSource = { type: 'container', container: c };
    this.activeLootContainer = buildActiveLootContainer('container', c.id, c.kind, c.items);
    this.releasePointerLock();
    this.clearInputs();
    this.emitHud();
  }

  private collectVehicleTrunk(v: Vehicle): void {
    const trunkItems = v.trunkItems ?? {};
    const entries = extractLootEntries(trunkItems);
    this.animateAction('search', 'INSPECTING TRUNK', 0.75);
    soundEngine.playUiClick();
    const trunkKind = v.kind === 'police' ? 'car_police' : 'car_sedan';
    this.activeLootSource = { type: 'trunk', vehicle: v };
    this.activeLootContainer = buildActiveLootContainer(
      'trunk',
      `trunk_${v.id}`,
      trunkKind,
      trunkItems
    );
    this.releasePointerLock();
    this.clearInputs();
    this.emitHud();
  }

  private findNearestLootable(): LootContainer | null {
    if (this.cameraMode === 'fps') {
      const candidates = this.containers.filter((c) => c.kind !== 'zombie_drop' || !c.searched);
      return pickBestDirectionalTarget(
        this.player.x,
        this.player.y,
        this.player.facingAngle,
        candidates,
        (c) => ({ x: c.gx + 0.5, y: c.gy + 0.5 }),
        1.95
      );
    }
    let best: LootContainer | null = null;
    let bestD = 1.95;
    for (const c of this.containers) {
      if (c.searched && c.kind === 'zombie_drop') continue;
      const d = dist(this.player.x, this.player.y, c.gx + 0.5, c.gy + 0.5);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private findNearestVehicleTrunk(): Vehicle | null {
    if (this.cameraMode === 'fps') {
      const candidates = this.vehicles;
      return pickBestDirectionalTarget(
        this.player.x,
        this.player.y,
        this.player.facingAngle,
        candidates,
        (v) => ({ x: v.x, y: v.y }),
        2.3
      );
    }
    let best: Vehicle | null = null;
    let bestD = 2.3;
    for (const v of this.vehicles) {
      const d = dist(this.player.x, this.player.y, v.x, v.y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  private findNearestBed(): { gx: number; gy: number } | null {
    const p = this.player;
    const pgx = Math.floor(p.x);
    const pgy = Math.floor(p.y);
    let best: { gx: number; gy: number } | null = null;
    let bestD = 1.85;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const gx = pgx + dx;
        const gy = pgy + dy;
        const cell = this.getCell(gx, gy);
        if (cell.prop !== 'bed') continue;
        const d = dist(p.x, p.y, gx + 0.5, gy + 0.5);
        if (d < bestD) {
          // Ensure we do not interact through a solid wall partition
          const midCell = this.getCell(Math.floor((p.x + gx + 0.5) * 0.5), Math.floor((p.y + gy + 0.5) * 0.5));
          if (midCell.prop.startsWith('wall')) continue;
          bestD = d;
          best = { gx, gy };
        }
      }
    }
    return best;
  }

  private trySleepInBed(): boolean {
    // One rest per transition, including repeated E / touch input.
    if (this.sleepTransitionTimer > 0) return true;
    const bed = this.findNearestBed();
    if (!bed) return false;

    if (this.restCooldownSeconds > 0) {
      this.showBanner(`Rest available in ${formatRestCooldown(this.restCooldownSeconds)} of awake play`, 2.2);
      this.emitHud();
      return true;
    }

    const safe = canSleepSafely(this.zombies, this.player.x, this.player.y);
    if (!safe) {
      soundEngine.playDryFire();
      this.showBanner('Too dangerous to sleep — infected nearby!', 2.2);
      return true;
    }

    const res = applyBedSleep(this.player, this.timeMinutes, this.day);
    this.player = res.player;
    this.day = res.day;
    this.timeMinutes = res.timeMinutes;
    this.sleepTransitionTimer = 1.65;
    this.restCooldownSeconds = BED_REST_COOLDOWN_SECONDS;
    this.animateAction('sleep', 'RESTING', 1.45);
    soundEngine.playSleepRest();

    this.addFloatingText(
      this.player.x,
      this.player.y,
      1.35,
      res.healed > 0 ? `+${res.healed} HP · RESTED +3h` : 'RESTED · +3h',
      '#9ee89e'
    );
    this.spawnParticles(bed.gx + 0.5, bed.gy + 0.5, 0.55, 8, '#c5e8c2', 1.1, 1.5, -1.2);

    if (res.dayWrapped) {
      this.score += 150;
      this.showBanner(`DAWN · DAY ${this.day} (+150 SCORE)`, 3.2);
    } else {
      this.showBanner(
        res.healed > 0 ? `Rested cleanly in bed (+${res.healed} HP · +3h)` : 'Rested cleanly in bed (+3h)',
        2.4
      );
    }
    this.emitHud();
    return true;
  }

  private emitSound(x: number, y: number, radius: number, showRipple: boolean): void {
    if (showRipple) {
      this.soundRipples.push({
        x,
        y,
        radius: 0.4,
        maxRadius: radius * 0.65,
        alpha: 0.55,
        color: '#e8a849',
      });
    }
    for (const z of this.zombies) {
      notifyZombieOfSound(this.worldStore, z, x, y, radius);
    }
  }

  private updateStructures(dt: number): void {
    for (let i = this.structures.length - 1; i >= 0; i--) {
      const s = this.structures[i];
      s.hitFlash = Math.max(0, s.hitFlash - dt);
      s.cooldown = Math.max(0, s.cooldown - dt);

      if (s.kind === 'spike_trap' && s.cooldown <= 0) {
        for (const z of this.zombies) {
          if (z.state === 'dying') continue;
          if (dist(z.x, z.y, s.gx + 0.5, s.gy + 0.5) < 0.72) {
            s.cooldown = 0.85;
            s.hitFlash = 0.12;
            s.hp -= 10;
            this.damageZombie(z, 26, 0, 0, false);
            z.bleedTimer = 3.0;
            soundEngine.playMeleeHit(false);
            break;
          }
        }
      }

      if (s.hp <= 0) {
        if (s.kind === 'barricade') {
          this.getCell(s.gx, s.gy).solid = false;
        }
        this.spawnParticles(s.gx + 0.5, s.gy + 0.5, 0.3, 12, '#7d5536', 3.2, 2.5);
        this.structures.splice(i, 1);
      }
    }
  }

  private updateProjectiles(dt: number): void {
    const isFps = this.cameraMode === 'fps';
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;

      if (pr.kind === 'molotov' || pr.kind === 'acid') {
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
        pr.z += pr.vz * dt;
        pr.vz -= 9.5 * dt;
        if (pr.life <= 0 || pr.z <= 0.05) {
          if (pr.kind === 'molotov') {
            this.detonateMolotov(pr.x, pr.y);
          } else {
            this.firePatches.push({
              id: this.nextEntityId++,
              x: pr.x,
              y: pr.y,
              radius: 1.35,
              life: 4.5,
              maxLife: 4.5,
              kind: 'acid',
              tickTimer: 0,
            });
            this.decals.push({ x: pr.x, y: pr.y, variant: 0, alpha: 0.65, kind: 'acid' });
            this.spawnParticles(pr.x, pr.y, 0.2, 10, '#5ef2b5', 2.8, 2.0);
          }
          this.projectiles.splice(i, 1);
          continue;
        }
        continue;
      }

      // Swept 3D ballistic collision so high-speed bullets never tunnel
      const prevX = pr.x;
      const prevY = pr.y;
      const prevZ = pr.z;
      const nextX = prevX + pr.vx * dt;
      const nextY = prevY + pr.vy * dt;
      const nextZ = prevZ + pr.vz * dt;

      const worldHit = traceSegmentWorldHit(
        prevX,
        prevY,
        prevZ,
        nextX,
        nextY,
        nextZ,
        isFps,
        (gx, gy) => this.getCell(gx, gy),
        this.doors,
        this.structures,
        this.vehicles,
        this.activeVehicleId
      );

      const zombieHit = traceSegmentZombieHit(
        prevX,
        prevY,
        prevZ,
        nextX,
        nextY,
        nextZ,
        this.zombies,
        Boolean(pr.canHeadshot),
        worldHit ? worldHit.t : 1
      );

      if (zombieHit) {
        const speed3D = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
        const speed2D = Math.hypot(pr.vx, pr.vy) || 1;
        const dirX = pr.vx / speed3D;
        const dirY = pr.vy / speed3D;
        const dirZ = pr.vz / speed3D;

        if (zombieHit.isHeadshot) {
          const mult = pr.kind === 'bullet' ? HEADSHOT_MULTIPLIER_BULLET : HEADSHOT_MULTIPLIER_PELLET;
          const dmg = Math.round(pr.damage * mult);
          this.damageZombie(
            zombieHit.zombie,
            dmg,
            (pr.vx / speed2D) * 4.4,
            (pr.vy / speed2D) * 4.4,
            true,
            true,
            true,
            zombieHit.hz
          );
          this.pushImpactEffect(
            zombieHit.hx,
            zombieHit.hy,
            zombieHit.hz,
            -dirX,
            -dirY,
            -dirZ,
            'headshot',
            1.28
          );
          soundEngine.playBulletImpact('headshot');

          if (isFps) {
            const backHit = traceSegmentWorldHit(
              zombieHit.hx,
              zombieHit.hy,
              zombieHit.hz,
              zombieHit.hx + dirX * 1.45,
              zombieHit.hy + dirY * 1.45,
              zombieHit.hz + dirZ * 1.45,
              true,
              (gx, gy) => this.getCell(gx, gy),
              this.doors,
              this.structures,
              this.vehicles,
              this.activeVehicleId
            );
            if (backHit && backHit.allowDecal) {
              this.pushImpactDecal(
                backHit.hx,
                backHit.hy,
                backHit.hz,
                backHit.nx,
                backHit.ny,
                backHit.nz,
                'blood_wall',
                0.38 + Math.random() * 0.14
              );
            }
          }
        } else {
          const { damage, isCrit } = computeCombatDamage(
            pr.damage,
            Math.random(),
            pr.canHeadshot ? 0.1 : pr.kind === 'bullet' ? 0.22 : 0.12
          );
          this.damageZombie(
            zombieHit.zombie,
            damage,
            (pr.vx / speed2D) * (isCrit ? 3.4 : 2.5),
            (pr.vy / speed2D) * (isCrit ? 3.4 : 2.5),
            isCrit,
            isCrit,
            false,
            zombieHit.hz
          );
          this.pushImpactEffect(
            zombieHit.hx,
            zombieHit.hy,
            zombieHit.hz,
            -dirX,
            -dirY,
            -dirZ,
            'flesh',
            0.9
          );
          soundEngine.playBulletImpact('flesh');
        }

        this.projectiles.splice(i, 1);
        continue;
      }

      if (worldHit) {
        this.handleBulletWorldImpact(worldHit, pr.kind, pr.damage, isFps);
        this.projectiles.splice(i, 1);
        continue;
      }

      pr.x = nextX;
      pr.y = nextY;
      pr.z = nextZ;

      if (pr.life <= 0 || dist(pr.x, pr.y, this.player.x, this.player.y) > 30) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  private handleBulletWorldImpact(
    hit: WorldHitResult,
    kind: 'bullet' | 'pellet',
    damage: number,
    isFps: boolean
  ): void {
    const scale = kind === 'bullet' ? 1.0 : 0.78;
    this.pushImpactEffect(hit.hx, hit.hy, hit.hz, hit.nx, hit.ny, hit.nz, hit.material, scale);
    soundEngine.playBulletImpact(hit.material);

    if (hit.material === 'stone') {
      this.spawnDirectionalParticles(hit.hx, hit.hy, hit.hz, hit.nx, hit.ny, hit.nz, kind === 'bullet' ? 6 : 4, '#ffd98a', 2.4, 4.4);
      this.spawnDirectionalParticles(hit.hx, hit.hy, hit.hz, hit.nx, hit.ny, hit.nz, kind === 'bullet' ? 5 : 3, '#8f969c', 1.1, 2.4);
    } else if (hit.material === 'wood') {
      this.spawnDirectionalParticles(hit.hx, hit.hy, hit.hz, hit.nx, hit.ny, hit.nz, kind === 'bullet' ? 7 : 4, '#b88252', 1.8, 3.6);
      this.spawnDirectionalParticles(hit.hx, hit.hy, hit.hz, hit.nx, hit.ny, hit.nz, 3, '#dec8a4', 1.0, 2.0);
    } else if (hit.material === 'metal') {
      this.spawnDirectionalParticles(hit.hx, hit.hy, hit.hz, hit.nx, hit.ny, hit.nz, kind === 'bullet' ? 9 : 5, '#fff0a6', 3.2, 5.6);
      this.spawnDirectionalParticles(hit.hx, hit.hy, hit.hz, hit.nx, hit.ny, hit.nz, 3, '#ff9d3b', 2.2, 4.0);
      if (hit.vehicleId !== undefined) {
        const v = this.vehicles.find((car) => car.id === hit.vehicleId);
        if (v && v.hp > 0) {
          v.hp = Math.max(0, v.hp - Math.max(1, Math.round(damage * 0.1)));
          v.hitFlash = 0.08;
        }
      }
    } else if (hit.material === 'water') {
      this.spawnDirectionalParticles(hit.hx, hit.hy, hit.hz, hit.nx, hit.ny, hit.nz, 8, '#a6e4f5', 1.6, 3.4);
    } else {
      this.spawnDirectionalParticles(hit.hx, hit.hy, hit.hz, hit.nx, hit.ny, hit.nz, 6, '#6e543a', 1.4, 3.0);
    }

    if (isFps && hit.allowDecal) {
      const decalKind = mapMaterialToDecalKind(hit.material);
      if (decalKind) {
        const baseSize = kind === 'bullet' ? 0.21 : 0.16;
        this.pushImpactDecal(
          hit.hx,
          hit.hy,
          hit.hz,
          hit.nx,
          hit.ny,
          hit.nz,
          decalKind,
          baseSize + Math.random() * 0.05
        );
      }
    }
  }

  private pushImpactDecal(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    kind: SurfaceImpactDecal['kind'],
    size: number
  ): void {
    this.impactDecals.push({
      id: this.nextEntityId++,
      x,
      y,
      z,
      nx,
      ny,
      nz,
      kind,
      size,
      rotation: Math.random() * Math.PI * 2,
      alpha: 0.92,
    });
    if (this.impactDecals.length > 96) {
      this.impactDecals.shift();
    }
  }

  private pushImpactEffect(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    material: BulletImpactEffect['material'],
    scale: number
  ): void {
    const maxLife = material === 'headshot' ? 0.22 : 0.15;
    this.impactEffects.push({
      id: this.nextEntityId++,
      x,
      y,
      z,
      nx,
      ny,
      nz,
      material,
      life: maxLife,
      maxLife,
      scale,
    });
    if (this.impactEffects.length > 24) {
      this.impactEffects.shift();
    }
  }

  private updateImpactEffects(dt: number): void {
    for (let i = this.impactEffects.length - 1; i >= 0; i--) {
      this.impactEffects[i].life -= dt;
      if (this.impactEffects[i].life <= 0) {
        this.impactEffects.splice(i, 1);
      }
    }
  }

  private detonateMolotov(x: number, y: number): void {
    soundEngine.playMolotovShatter();
    this.trauma = Math.min(1, this.trauma + 0.4);
    this.emitSound(x, y, 12, true);
    this.firePatches.push({
      id: this.nextEntityId++,
      x,
      y,
      radius: 2.35,
      life: 6.5,
      maxLife: 6.5,
      kind: 'fire',
      tickTimer: 0,
    });
    this.decals.push({ x, y, variant: 0, alpha: 0.65, kind: 'scorch' });
    this.spawnParticles(x, y, 0.3, 24, '#ff982b', 4.5, 3.6);
    for (const z of this.zombies) {
      if (z.state === 'dying') continue;
      if (dist(z.x, z.y, x, y) <= 2.4) {
        this.damageZombie(z, 38, 0, 0, true);
        z.burnTimer = 4.5;
      }
    }
  }

  private updateFirePatches(dt: number): void {
    for (let i = this.firePatches.length - 1; i >= 0; i--) {
      const fp = this.firePatches[i];
      fp.life -= dt;
      fp.tickTimer -= dt;

      if (fp.kind === 'fire' && Math.random() < 0.45) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * fp.radius * 0.8;
        this.spawnParticles(fp.x + Math.cos(ang) * r, fp.y + Math.sin(ang) * r, 0.15, 1, '#ff9e2b', 1.4, 2.6, -2.5);
      }

      if (fp.tickTimer <= 0) {
        fp.tickTimer = 0.45;
        if (fp.kind === 'fire') {
          for (const z of this.zombies) {
            if (z.state === 'dying') continue;
            if (dist(z.x, z.y, fp.x, fp.y) <= fp.radius) {
              this.damageZombie(z, 14, 0, 0, false);
              z.burnTimer = 2.0;
            }
          }
        } else {
          // Acid damages player
          if (dist(this.player.x, this.player.y, fp.x, fp.y) <= fp.radius) {
            this.hurtPlayer(9, false);
          }
        }
      }

      if (fp.life <= 0) {
        this.firePatches.splice(i, 1);
      }
    }
  }

  private damageZombie(
    z: Zombie,
    amount: number,
    kbX: number,
    kbY: number,
    heavy: boolean,
    isCrit = false,
    isHeadshot = false,
    hitZ = 0.58
  ): void {
    z.hp -= amount;
    this.recentCombatTimer = Math.max(this.recentCombatTimer, 6.0);
    if (z.hp > 0 && z.state !== 'dying') {
      soundEngine.playZombieHurt(z.archetype);
      // Only the struck zombie reacts to the physical blow and looks toward the attacker
      const dToP = dist(z.x, z.y, this.player.x, this.player.y);
      if (dToP > 1e-4) {
        z.facingX = (this.player.x - z.x) / dToP;
        z.facingY = (this.player.y - z.y) / dToP;
      }
      z.lastHeardX = this.player.x;
      z.lastHeardY = this.player.y;
      if (z.state === 'wander' || z.state === 'alert') {
        z.state = 'chase';
        z.stateTimer = 4.0;
      } else if (z.state === 'chase') {
        z.stateTimer = Math.max(z.stateTimer, 4.0);
      }
    }
    z.hitFlash = isHeadshot ? 0.12 : 0.08;
    z.scaleX = isHeadshot ? 1.28 : 1.22;
    z.scaleY = isHeadshot ? 0.76 : 0.8;
    z.vx += kbX;
    z.vy += kbY;
    if (isHeadshot) {
      this.hitMarkerTimer = 0.22;
      this.hitMarkerCrit = true;
      this.hitMarkerHeadshot = true;
      this.hitstopTimer = Math.max(this.hitstopTimer, 0.024);
    } else if (heavy || isCrit || amount >= 10) {
      this.hitMarkerTimer = 0.14;
      this.hitMarkerCrit = isCrit;
      this.hitMarkerHeadshot = false;
    }

    if (isHeadshot) {
      this.spawnParticles(z.x, z.y, hitZ, 15, '#d92b23', 4.0, 2.8);
      this.spawnParticles(z.x, z.y, hitZ, 5, '#e6dcc8', 3.1, 2.4);
      this.addFloatingText(z.x, z.y, 1.38, `HEADSHOT -${Math.round(amount)}`, '#ff5a36');
    } else {
      this.spawnParticles(z.x, z.y, hitZ, heavy ? 12 : 7, isCrit ? '#d93829' : '#a32222', 3.4, 2.2);
      this.addFloatingText(
        z.x,
        z.y,
        1.2,
        isCrit ? `CRIT -${Math.round(amount)}` : `-${Math.round(amount)}`,
        isCrit ? '#ffd266' : heavy ? '#f0d078' : '#e6e2d8'
      );
    }

    if (z.hp <= 0 && z.state !== 'dying') {
      z.state = 'dying';
      z.stateTimer = 0.52;
      z.hasAttackToken = false;
      this.kills += 1;
      // Prevent a zombie death from triggering an immediate replacement spawn
      this.spawnTimer = Math.max(this.spawnTimer, 5.0);
      const cfg = ZOMBIE_CONFIGS[z.archetype];
      this.score += cfg.scoreValue;
      this.hitstopTimer = Math.max(this.hitstopTimer, heavy ? 0.05 : 0.028);

      this.decals.push({
        x: z.x,
        y: z.y,
        variant: Math.floor(Math.random() * 3),
        alpha: 0.78,
        kind: z.archetype === 'bloater' ? 'acid' : 'blood',
      });
      if (this.decals.length > 90) this.decals.shift();

      // Bloater toxic explosion on death!
      if (z.archetype === 'bloater') {
        soundEngine.playMolotovShatter();
      } else {
        soundEngine.playZombieDeath(z.archetype);
      }
      if (z.archetype === 'bloater') {
        this.trauma = Math.min(1, this.trauma + 0.55);
        this.spawnParticles(z.x, z.y, 0.5, 22, '#99db3d', 4.5, 3.2);
        this.firePatches.push({
          id: this.nextEntityId++,
          x: z.x,
          y: z.y,
          radius: 1.8,
          life: 4.0,
          maxLife: 4.0,
          kind: 'acid',
          tickTimer: 0.3,
        });
        if (dist(this.player.x, this.player.y, z.x, z.y) <= 2.1) {
          this.hurtPlayer(18, false);
        }
      }

      // 35% chance to drop a scavenge pouch
      if (Math.random() < 0.35) {
        const dropItems: Partial<Inventory> =
          Math.random() < 0.45
            ? { ammo_9mm: 3 + Math.floor(Math.random() * 4) }
            : Math.random() < 0.6
              ? { cloth: 1, scrap: 1 }
              : { bandage: 1 };
        this.containers.push({
          id: `drop_${this.nextEntityId++}`,
          gx: Math.floor(z.x),
          gy: Math.floor(z.y),
          kind: 'zombie_drop',
          items: dropItems,
          searched: false,
          searchProgress: 0,
        });
      }
    }
  }

  private hurtPlayer(amount: number, canBleed: boolean): void {
    this.recentCombatTimer = Math.max(this.recentCombatTimer, 6.0);
    const activeCar = this.getActiveVehicle();
    if (activeCar && activeCar.hp > 0) {
      activeCar.hp = Math.max(0, activeCar.hp - Math.round(amount));
      activeCar.hitFlash = 0.12;
      soundEngine.playCarImpact();
      this.trauma = Math.min(1, this.trauma + 0.25);
      this.spawnParticles(activeCar.x, activeCar.y, 0.4, 6, '#e0b84c', 2.4, 1.5);
      if (activeCar.hp <= 0) {
        this.showBanner('Vehicle Wrecked! Ejecting...', 2.2);
        this.triggerEnterExitVehicle();
      }
      return;
    }

    const p = this.player;
    if (p.invulnTimer > 0 || p.hp <= 0) return;
    p.hp = Math.max(0, p.hp - amount);
    p.hitFlash = 0.14;
    p.invulnTimer = 0.42;
    p.scaleX = 1.2;
    p.scaleY = 0.82;
    this.trauma = Math.min(1, this.trauma + 0.48);
    if (canBleed && Math.random() < 0.25) {
      p.bleeding = true;
      this.showBanner('BLEEDING! Press [5] or [H] to Bandage', 2.6);
    }
    soundEngine.playPlayerHurt();
    this.spawnParticles(p.x, p.y, 0.6, 10, '#bd2424', 3.2, 2.2);
    this.addFloatingText(p.x, p.y, 1.3, `-${Math.round(amount)} HP`, '#ff5e57');
  }

  private updateZombies(dt: number): void {
    const p = this.player;
    const { darkness } = getDaylightInfo(this.timeMinutes);

    // Attack token pool (max 3 simultaneous close attackers so hordes remain fair)
    let activeAttackers = this.zombies.filter((z) => z.hasAttackToken).length;

    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      const cfg = ZOMBIE_CONFIGS[z.archetype];
      z.hitFlash = Math.max(0, z.hitFlash - dt);
      z.scaleX = lerp(z.scaleX, 1, 1 - Math.exp(-dt * 12));
      z.scaleY = lerp(z.scaleY, 1, 1 - Math.exp(-dt * 12));

      // Apply knockback decay
      if (Math.hypot(z.vx, z.vy) > 0.05) {
        this.moveActor(z, z.vx * dt, z.vy * dt, 0.21);
        z.vx *= Math.exp(-dt * 10);
        z.vy *= Math.exp(-dt * 10);
      }

      // Status DoTs
      if (z.bleedTimer > 0) {
        z.bleedTimer -= dt;
        z.hp -= dt * 6;
        if (z.hp <= 0 && z.state !== 'dying') {
          this.damageZombie(z, 1, 0, 0, false);
        }
      }
      if (z.burnTimer > 0) {
        z.burnTimer -= dt;
        z.hp -= dt * 11;
        if (Math.random() < 0.25) {
          this.spawnParticles(z.x, z.y, 0.6, 1, '#ff982b', 1.2, 2.0, -2);
        }
        if (z.hp <= 0 && z.state !== 'dying') {
          this.damageZombie(z, 1, 0, 0, false);
        }
      }

      if (z.state === 'dying') {
        z.stateTimer -= dt;
        z.koRotation = lerp(z.koRotation, Math.PI * 0.45, dt * 12);
        if (z.stateTimer <= 0) {
          this.zombieRoutes.delete(z.id);
          this.zombies.splice(i, 1);
        }
        continue;
      }

      const dToPlayer = dist(z.x, z.y, p.x, p.y);
      if (dToPlayer > 44) {
        this.zombieRoutes.delete(z.id);
        this.zombies.splice(i, 1);
        continue;
      }

      // Directional eye-cone vision check (no 360-degree omniscient sight)
      const canSeePlayer = canZombieSeePlayer(this.worldStore, z, p, darkness);

      if (canSeePlayer) {
        z.lastHeardX = p.x;
        z.lastHeardY = p.y;
        if (z.state === 'wander' || z.state === 'alert') {
          z.state = 'chase';
          z.stateTimer = 4.0;
          if (Math.random() < 0.5) soundEngine.playZombieGroan(z.archetype);
        } else if (z.state === 'chase') {
          z.stateTimer = Math.max(z.stateTimer, 4.0);
        }
      }

      if (z.state === 'wander') {
        const wd = dist(z.x, z.y, z.wanderTargetX, z.wanderTargetY);
        const dx = z.wanderTargetX - z.x;
        const dy = z.wanderTargetY - z.y;
        const len = Math.hypot(dx, dy) || 1;
        const stepBlocked = this.isPointSolid(z.x + (dx / len) * 0.45, z.y + (dy / len) * 0.45, 0.21);
        if (wd < 0.45 || stepBlocked || Math.random() < 0.008) {
          const randAng = Math.random() * Math.PI * 2;
          const randDist = 3.0 + Math.random() * 3.5;
          z.wanderTargetX = z.x + Math.cos(randAng) * randDist;
          z.wanderTargetY = z.y + Math.sin(randAng) * randDist;
        }
        const nextDx = z.wanderTargetX - z.x;
        const nextDy = z.wanderTargetY - z.y;
        const nextLen = Math.hypot(nextDx, nextDy) || 1;
        const dirX = nextDx / nextLen;
        const dirY = nextDy / nextLen;
        this.moveActor(z, dirX * z.speed * 0.35 * dt, dirY * z.speed * 0.35 * dt, 0.21);
        const turnBlend = 1 - Math.exp(-dt * 8);
        const fx = lerp(z.facingX, dirX, turnBlend);
        const fy = lerp(z.facingY, dirY, turnBlend);
        const fNorm = Math.hypot(fx, fy) || 1;
        z.facingX = fx / fNorm;
        z.facingY = fy / fNorm;
        z.walkCycle += z.speed * 0.35 * dt * 3;
      } else if (z.state === 'alert') {
        z.stateTimer -= dt;
        if (z.lastHeardX !== null && z.lastHeardY !== null) {
          const dHeard = dist(z.x, z.y, z.lastHeardX, z.lastHeardY);
          if (dHeard > 0.55) {
            const steer = this.steerZombie(z, z.lastHeardX, z.lastHeardY);
            this.moveActor(z, steer.dx * z.speed * 0.72 * dt, steer.dy * z.speed * 0.72 * dt, 0.21);
            z.facingX = steer.dx;
            z.facingY = steer.dy;
            z.walkCycle += z.speed * 0.72 * dt * 3;
          } else {
            z.lastHeardX = null;
            z.lastHeardY = null;
          }
        }
        if (z.stateTimer <= 0) {
          z.state = 'wander';
          z.wanderTargetX = z.x + z.facingX * 3.5;
          z.wanderTargetY = z.y + z.facingY * 3.5;
        }
      } else if (z.state === 'chase') {
        // Pursue live player coordinates only while in visual sight; otherwise pursue last-known position
        const targetX = canSeePlayer ? p.x : (z.lastHeardX ?? p.x);
        const targetY = canSeePlayer ? p.y : (z.lastHeardY ?? p.y);
        if (!canSeePlayer) {
          z.stateTimer -= dt;
          const dLastKnown = dist(z.x, z.y, targetX, targetY);
          if (dLastKnown <= 0.65 || z.stateTimer <= 0) {
            z.state = 'alert';
            z.stateTimer = 2.0;
            z.lastHeardX = null;
            z.lastHeardY = null;
            continue;
          }
        }

        const steer = this.steerZombie(z, targetX, targetY);
        if (canSeePlayer) {
          const dx = p.x - z.x;
          const dy = p.y - z.y;
          const len = Math.hypot(dx, dy) || 1;
          z.facingX = dx / len;
          z.facingY = dy / len;
        } else {
          z.facingX = steer.dx;
          z.facingY = steer.dy;
        }

        // Check if blocked by a player barricade or closed/barricaded door directly in path
        const nextX = z.x + steer.dx * 0.65;
        const nextY = z.y + steer.dy * 0.65;
        const blockingBarricade = this.structures.find(
          (s) => s.kind === 'barricade' && s.gx === Math.floor(nextX) && s.gy === Math.floor(nextY)
        );
        const blockingDoor = this.doorByTile.get(`${Math.floor(nextX)}_${Math.floor(nextY)}`);

        if (blockingBarricade || (blockingDoor && blockingDoor.status !== 'open')) {
          z.state = 'windup';
          z.stateTimer = cfg.windupTime;
          z.hasAttackToken = true;
          continue;
        }

        // Archetype-distinct movement policies!
        if (z.archetype === 'spitter') {
          // Kiter/Ranged: maintains 4.5-6.5 tile distance, strafes laterally
          let mx = steer.dx;
          let my = steer.dy;
          if (dToPlayer < 4.0 && canSeePlayer) {
            mx = -z.facingX;
            my = -z.facingY;
          } else if (dToPlayer <= cfg.attackRange && canSeePlayer) {
            // Lateral strafe + enter windup spit
            if (activeAttackers < 3 || z.hasAttackToken) {
              z.hasAttackToken = true;
              activeAttackers++;
              z.state = 'windup';
              z.stateTimer = cfg.windupTime;
              soundEngine.playZombieGroan('spitter');
              continue;
            }
            mx = -z.facingY;
            my = z.facingX;
          }
          this.moveActor(z, mx * z.speed * dt, my * z.speed * dt, 0.21);
          z.walkCycle += z.speed * dt * 3;
        } else {
          // Runner weaves slightly when closing in
          let mx = steer.dx;
          let my = steer.dy;
          if (z.archetype === 'runner' && dToPlayer > 1.8 && !this.zombieRoutes.get(z.id)?.points.length) {
            const weave = Math.sin(this.elapsedClock * 6 + z.id) * 0.42;
            mx += -steer.dy * weave;
            my += steer.dx * weave;
            const mLen = Math.hypot(mx, my) || 1;
            mx /= mLen;
            my /= mLen;
          }

          if (dToPlayer <= cfg.attackRange && canSeePlayer) {
            if (activeAttackers < 3 || z.hasAttackToken) {
              z.hasAttackToken = true;
              activeAttackers++;
              z.state = 'windup';
              z.stateTimer = cfg.windupTime;
              z.scaleX = 1.15;
              z.scaleY = 0.85;
              soundEngine.playZombieGroan(z.archetype);
            }
          } else {
            this.moveActor(z, mx * z.speed * dt, my * z.speed * dt, 0.21);
            z.walkCycle += z.speed * dt * 3;
          }
        }
      } else if (z.state === 'windup') {
        z.stateTimer -= dt;
        if (canSeePlayer && dToPlayer > 1e-4) {
          z.facingX = (p.x - z.x) / dToPlayer;
          z.facingY = (p.y - z.y) / dToPlayer;
        }
        // Telegraph crouch
        z.scaleX = 1.16;
        z.scaleY = 0.84;
        if (z.stateTimer <= 0) {
          z.state = 'attack';
          z.stateTimer = 0.14;
          this.executeZombieAttack(z);
        }
      } else if (z.state === 'attack') {
        z.stateTimer -= dt;
        if (z.stateTimer <= 0) {
          z.state = 'recover';
          z.stateTimer = 0.48;
          z.hasAttackToken = false;
        }
      } else if (z.state === 'recover') {
        z.stateTimer -= dt;
        if (z.stateTimer <= 0) {
          if (canSeePlayer || z.lastHeardX !== null) {
            z.state = 'chase';
            z.stateTimer = 4.0;
          } else {
            z.state = 'alert';
            z.stateTimer = 2.0;
          }
        }
      }
    }
  }

  private executeZombieAttack(z: Zombie): void {
    const cfg = ZOMBIE_CONFIGS[z.archetype];
    const p = this.player;


    // Check barricade first
    const bar = this.structures.find(
      (s) => s.kind === 'barricade' && dist(z.x, z.y, s.gx + 0.5, s.gy + 0.5) <= 1.25
    );
    if (bar) {
      bar.hp -= cfg.damage;
      bar.hitFlash = 0.12;
      soundEngine.playBuildHammer();
      this.spawnParticles(bar.gx + 0.5, bar.gy + 0.5, 0.5, 6, '#8f6340', 2.4, 2.0);
      return;
    }

    // Check closed/barricaded/locked door
    const door = this.doors.find(
      (d) => d.status !== 'open' && dist(z.x, z.y, d.gx + 0.5, d.gy + 0.5) <= 1.25
    );
    if (door) {
      door.hitFlash = 0.12;
      soundEngine.playBuildHammer();
      this.spawnParticles(door.gx + 0.5, door.gy + 0.5, 0.5, 5, '#8f6340', 2.2, 1.8);
      if (door.status === 'barricaded') {
        door.barricadeHp -= cfg.damage;
        if (door.barricadeHp <= 0) {
          door.barricadeHp = 0;
          door.status = 'closed';
          this.addFloatingText(door.gx + 0.5, door.gy + 0.5, 1.1, 'BARRICADE BREACHED!', '#ff5e57');
        }
      } else {
        door.hp -= cfg.damage;
        if (door.hp <= 0) {
          door.hp = 0;
          door.status = 'open';
          const cell = this.getCell(door.gx, door.gy);
          cell.solid = false;
          cell.blocksSight = false;
          soundEngine.playDoorSwing(true);
        }
      }
      return;
    }

    if (z.archetype === 'spitter') {
      soundEngine.playSpitHiss();
      // Launch arcing acid glob
      const travel = clamp(dist(z.x, z.y, p.x, p.y) / 7.5, 0.35, 0.9);
      this.projectiles.push({
        id: this.nextEntityId++,
        kind: 'acid',
        x: z.x,
        y: z.y,
        z: 0.75,
        vx: (p.x - z.x) / travel,
        vy: (p.y - z.y) / travel,
        vz: 4.5 * travel,
        damage: cfg.damage,
        life: travel,
        maxLife: travel,
      });
      return;
    }

    // Lunge forward slightly
    this.moveActor(z, z.facingX * 0.35, z.facingY * 0.35, 0.21);
    if (dist(z.x, z.y, p.x, p.y) <= cfg.attackRange + 0.35) {
      this.hurtPlayer(cfg.damage, true);
    }
  }

  private updateSpawning(dt: number): void {
    const { phaseLabel } = getDaylightInfo(this.timeMinutes);
    const isNight = phaseLabel === 'NIGHTFALL' || phaseLabel === 'DUSK';
    const maxZombies = Math.min(34, 10 + this.day * 3 + (isNight ? 8 : 0));
    const baseCooldown = isNight ? Math.max(2.4, 4.8 - this.day * 0.28) : 7.5;

    const canSpawnNow = shouldAllowAmbientSpawn(
      this.zombies,
      this.player.x,
      this.player.y,
      maxZombies,
      this.recentCombatTimer,
      isNight
    );
    if (!canSpawnNow) {
      // Never let spawnTimer sit at <= 0 while capped or in close combat so a kill never triggers an instant spawn
      this.spawnTimer = Math.max(this.spawnTimer, 2.5);
      return;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = baseCooldown;
      const pressure = evaluateCombatPressure(
        this.zombies,
        this.player.x,
        this.player.y,
        this.recentCombatTimer
      );
      const candidate = pickSafeAmbientSpawnPoint(this.worldStore, {
        playerX: this.player.x,
        playerY: this.player.y,
        playerFacingAngle: this.player.facingAngle,
        inCombat: pressure.inCombat,
        existingZombies: this.zombies,
        vehicles: this.vehicles,
      });
      if (candidate) {
        const cell = this.getCell(Math.floor(candidate.x), Math.floor(candidate.y));
        if (cell.tile !== 'water') {
          const r = Math.random();
          let arch: ZombieArchetype = 'walker';
          if (r < (isNight ? 0.28 : 0.12)) arch = 'runner';
          else if (r < (isNight ? 0.44 : 0.22)) arch = 'spitter';
          else if (r < (isNight ? 0.54 : 0.28)) arch = 'bloater';
          this.spawnZombieAt(candidate.x, candidate.y, arch, candidate);
        }
      }
    }
  }

  private spawnZombieAt(
    x: number,
    y: number,
    archetype: ZombieArchetype,
    initialPose?: { facingX: number; facingY: number; wanderTargetX: number; wanderTargetY: number }
  ): void {
    const cfg = ZOMBIE_CONFIGS[archetype];
    const hpScale = 1 + (this.day - 1) * 0.12;
    let facingX = initialPose?.facingX;
    let facingY = initialPose?.facingY;
    let wanderTargetX = initialPose?.wanderTargetX;
    let wanderTargetY = initialPose?.wanderTargetY;
    if (facingX === undefined || facingY === undefined || wanderTargetX === undefined || wanderTargetY === undefined) {
      // Orient initial gaze tangentially or away from player so newly spawned zombies do not stare directly at the player
      const awayAngle = Math.atan2(y - this.player.y, x - this.player.x) + (Math.random() - 0.5) * Math.PI * 0.8;
      facingX = Math.cos(awayAngle);
      facingY = Math.sin(awayAngle);
      wanderTargetX = x + facingX * 3.5;
      wanderTargetY = y + facingY * 3.5;
    }
    this.zombies.push({
      id: this.nextEntityId++,
      archetype,
      x,
      y,
      vx: 0,
      vy: 0,
      facingX,
      facingY,
      hp: cfg.hp * hpScale,
      maxHp: cfg.hp * hpScale,
      speed: cfg.speed,
      state: 'wander',
      stateTimer: 0,
      wanderTargetX,
      wanderTargetY,
      lastHeardX: null,
      lastHeardY: null,
      walkCycle: Math.random() * 4,
      hitFlash: 0,
      bleedTimer: 0,
      burnTimer: 0,
      hasAttackToken: false,
      scaleX: 1,
      scaleY: 1,
      koRotation: 0,
      variant: Math.floor(Math.random() * 4),
    });
  }

  private moveActor(actor: { x: number; y: number }, dx: number, dy: number, radius: number): void {
    const canMoveX = !this.isPointSolid(actor.x + dx, actor.y, radius);
    if (canMoveX) {
      actor.x += dx;
    } else if (Math.abs(dx) > 0.0005) {
      // Smooth corner-sliding around isometric doorways and furniture edges (works even on diagonal WASD)
      const probe = 0.28;
      const clearPlus = !this.isPointSolid(actor.x + dx, actor.y + probe, radius);
      const clearMinus = !this.isPointSolid(actor.x + dx, actor.y - probe, radius);
      if (clearPlus !== clearMinus) {
        const slide = Math.abs(dx) * 0.72 * (clearPlus ? 1 : -1);
        if (!this.isPointSolid(actor.x + dx * 0.45, actor.y + slide, radius)) {
          actor.y += slide;
        }
      }
    }

    const canMoveY = !this.isPointSolid(actor.x, actor.y + dy, radius);
    if (canMoveY) {
      actor.y += dy;
    } else if (Math.abs(dy) > 0.0005) {
      const probe = 0.28;
      const clearPlus = !this.isPointSolid(actor.x + probe, actor.y + dy, radius);
      const clearMinus = !this.isPointSolid(actor.x - probe, actor.y + dy, radius);
      if (clearPlus !== clearMinus) {
        const slide = Math.abs(dy) * 0.72 * (clearPlus ? 1 : -1);
        if (!this.isPointSolid(actor.x + slide, actor.y + dy * 0.45, radius)) {
          actor.x += slide;
        }
      }
    }
  }

  private isPointSolid(wx: number, wy: number, radius: number): boolean {
    return isCircleBlocked(this.worldStore, wx, wy, radius, this.vehicles, this.activeVehicleId);
  }

  private revealFogAround(wx: number, wy: number, radius: number): void {
    const minX = Math.floor(wx - radius);
    const maxX = Math.ceil(wx + radius);
    const minY = Math.floor(wy - radius);
    const maxY = Math.ceil(wy + radius);
    const r2 = radius * radius;
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const dx = gx + 0.5 - wx;
        const dy = gy + 0.5 - wy;
        if (dx * dx + dy * dy <= r2) {
          this.getCell(gx, gy).explored = true;
        }
      }
    }

    let newlyDiscovered = false;
    for (const lm of this.worldStore.landmarks.values()) {
      if (lm.discovered) continue;
      if (dist(wx, wy, lm.gx + 0.5, lm.gy + 0.5) <= radius + 5.5) {
        lm.discovered = true;
        newlyDiscovered = true;
        const tag = lm.threatLevel === 'high' ? 'HORDE HOTSPOT' : 'LANDMARK';
        this.showBanner(`DISCOVERED: ${lm.name.toUpperCase()} · ${tag}`, 3.0);
      }
    }
    if (newlyDiscovered) {
      this.emitHud();
    }
  }

  private updateLandmarksAndHotspots(dt: number): void {
    this.hotspotCheckTimer += dt;
    if (this.hotspotCheckTimer < 0.35) return;
    this.hotspotCheckTimer = 0;

    const biomeNow = getBiomeDisplayName(
      sampleBiomeAt(this.worldStore.seed, Math.floor(this.player.x), Math.floor(this.player.y))
    );
    if (biomeNow !== this.lastBiomeLabel) {
      const prev = this.lastBiomeLabel;
      this.lastBiomeLabel = biomeNow;
      if (prev && biomeNow !== 'ASHFALL CROSSROADS') {
        this.showBanner(`REGION: ${biomeNow}`, 2.6);
      }
      this.emitHud();
    }

    const pressure = evaluateCombatPressure(
      this.zombies,
      this.player.x,
      this.player.y,
      this.recentCombatTimer
    );

    for (const lm of this.worldStore.landmarks.values()) {
      const d = dist(this.player.x, this.player.y, lm.gx + 0.5, lm.gy + 0.5);
      // Pre-populate landmark packs while landmark is still at a safe distance and never on top of an active fight
      if (!lm.hotspotSpawned && d <= 34 && d >= 16 && !pressure.inCombat) {
        lm.hotspotSpawned = true;
        const count = lm.hotspotPacks.length;
        for (let i = 0; i < count; i++) {
          const arch = lm.hotspotPacks[i];
          const baseAng = (i / Math.max(1, count)) * Math.PI * 2;
          for (let attempt = 0; attempt < 12; attempt++) {
            const ang = baseAng + attempt * 0.56;
            const rad = 2.6 + (attempt % 5) * 1.95;
            const zx = lm.gx + 0.5 + Math.cos(ang) * rad;
            const zy = lm.gy + 0.5 + Math.sin(ang) * rad;
            if (dist(zx, zy, this.player.x, this.player.y) < 16.0) continue;
            if (!this.isPointSolid(zx, zy, 0.25)) {
              this.spawnZombieAt(zx, zy, arch);
              break;
            }
          }
        }
      } else if (lm.hotspotSpawned && !lm.hotspotCleared && d <= lm.radius + 7) {
        let aliveNear = 0;
        for (const z of this.zombies) {
          if (z.state === 'dying') continue;
          if (dist(z.x, z.y, lm.gx + 0.5, lm.gy + 0.5) <= lm.radius + 7) {
            aliveNear++;
          }
        }
        if (aliveNear === 0) {
          lm.hotspotCleared = true;
          this.score += 75;
          this.showBanner(`HOTSPOT CLEARED: ${lm.name.toUpperCase()} (+75)`, 2.8);
          this.emitHud();
        }
      }
    }
  }

  private spawnParticles(
    x: number,
    y: number,
    z: number,
    count: number,
    color: string,
    spreadSpeed: number,
    upSpeed: number,
    gravity = 9.8
  ): void {
    const budgeted = Math.max(1, Math.round(count * particleBudgetScale()));
    for (let i = 0; i < budgeted; i++) {
      const p = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
      const ang = Math.random() * Math.PI * 2;
      const spd = Math.random() * spreadSpeed;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.vz = Math.random() * upSpeed;
      p.size = 1 + Math.floor(Math.random() * 2);
      p.color = color;
      p.maxLife = 0.25 + Math.random() * 0.35;
      p.life = p.maxLife;
      p.gravity = gravity;
    }
  }

  private spawnDirectionalParticles(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    count: number,
    color: string,
    minSpeed: number,
    maxSpeed: number,
    gravity = 9.8
  ): void {
    const budgeted = Math.max(1, Math.round(count * particleBudgetScale()));
    for (let i = 0; i < budgeted; i++) {
      const p = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
      const spd = minSpeed + Math.random() * (maxSpeed - minSpeed);
      const jx = (Math.random() - 0.5) * 1.15;
      const jy = (Math.random() - 0.5) * 1.15;
      const jz = (Math.random() - 0.25) * 1.05;
      let vx = nx * 1.35 + jx;
      let vy = ny * 1.35 + jy;
      let vz = nz * 1.15 + jz;
      const len = Math.hypot(vx, vy, vz) || 1;
      vx = (vx / len) * spd;
      vy = (vy / len) * spd;
      vz = (vz / len) * spd + 0.6;
      p.active = true;
      p.x = x + nx * 0.03;
      p.y = y + ny * 0.03;
      p.z = Math.max(0.03, z + nz * 0.03);
      p.vx = vx;
      p.vy = vy;
      p.vz = vz;
      p.size = 1 + Math.floor(Math.random() * 2);
      p.color = color;
      p.maxLife = 0.18 + Math.random() * 0.24;
      p.life = p.maxLife;
      p.gravity = gravity;
    }
  }

  private emitCampfireEmbers(dt: number): void {
    for (const s of this.structures) {
      if (s.kind === 'campfire' && Math.random() < dt * 7) {
        this.spawnParticles(
          s.gx + 0.5 + (Math.random() - 0.5) * 0.25,
          s.gy + 0.5 + (Math.random() - 0.5) * 0.25,
          0.35,
          1,
          Math.random() < 0.5 ? '#ffca57' : '#ff6b2b',
          0.4,
          1.4,
          -1.8
        );
      }
    }
    // Cached burn barrel coordinates from streamed chunks (avoids scanning 1681 grid cells/frame)
    const barrels = this.threeRenderer.getBurnBarrelCoords();
    for (let i = 0; i < barrels.length; i++) {
      if (Math.random() < dt * 4.5) {
        const b = barrels[i];
        this.spawnParticles(
          b.x + (Math.random() - 0.5) * 0.18,
          b.z + (Math.random() - 0.5) * 0.18,
          0.55,
          1,
          Math.random() < 0.5 ? '#ffe07d' : '#ff7b29',
          0.35,
          1.6,
          -1.9
        );
      }
    }
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= p.gravity * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.3;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
    }
  }

  private addFloatingText(x: number, y: number, z: number, text: string, color: string): void {
    this.floatingTexts.push({ x, y, z, text, color, life: 1.0, maxLife: 1.0 });
  }

  private updateFloatingTexts(dt: number): void {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      ft.z += dt * 0.75;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  private updateSoundRipples(dt: number): void {
    for (let i = this.soundRipples.length - 1; i >= 0; i--) {
      const sr = this.soundRipples[i];
      sr.radius += dt * 16;
      sr.alpha = Math.max(0, 0.55 * (1 - sr.radius / sr.maxRadius));
      if (sr.radius >= sr.maxRadius) this.soundRipples.splice(i, 1);
    }
  }

  private render(): void {
    let nearInteractTile: { gx: number; gy: number } | null = null;
    if (this.phase === 'playing' && this.activeVehicleId === null && !this.player.buildMode) {
      const nearLoot = this.findNearestLootable();
      const nearDoor = !nearLoot ? this.findNearestDoor() : null;
      const nearBed = !nearLoot && !nearDoor ? this.findNearestBed() : null;
      if (nearLoot) nearInteractTile = { gx: nearLoot.gx, gy: nearLoot.gy };
      else if (nearDoor) nearInteractTile = { gx: nearDoor.gx, gy: nearDoor.gy };
      else if (nearBed) nearInteractTile = { gx: nearBed.gx, gy: nearBed.gy };
    }

    this.threeRenderer.render({
      phase: this.phase,
      cameraMode: this.cameraMode,
      fpsPitch: this.fpsPitch,
      strafeInput: this.activeVehicleId !== null ? 0 : this.fpsStrafeInput,
      weaponSwapTimer: this.weaponSwapTimer,
      playerVelX: this.playerVelX,
      playerVelY: this.playerVelY,
      isSprinting: this.isSprinting,
      elapsedClock: this.elapsedClock,
      timeMinutes: this.timeMinutes,
      camX: this.camX,
      camY: this.camY,
      trauma: this.trauma,
      worldStore: this.worldStore,
      getCell: (gx, gy) => this.getCell(gx, gy),
      player: this.player,
      inventory: this.inventory,
      activeVehicleId: this.activeVehicleId,
      vehicles: this.vehicles,
      doors: this.doors,
      containers: this.containers,
      structures: this.structures,
      zombies: this.zombies,
      projectiles: this.projectiles,
      firePatches: this.firePatches,
      decals: this.decals,
      soundRipples: this.soundRipples,
      fishing: this.fishing,
      particles: this.particles,
      ambientAsh: this.ambientAsh,
      floatingTexts: this.floatingTexts,
      actionVisual: this.actionVisual,
      muzzleFlashTimer: this.muzzleFlashTimer,
      hitMarkerTimer: this.hitMarkerTimer,
      hitMarkerCrit: this.hitMarkerCrit,
      hitMarkerHeadshot: this.hitMarkerHeadshot,
      impactDecals: this.impactDecals,
      impactEffects: this.impactEffects,
      sleepTransitionTimer: this.sleepTransitionTimer,
      mouseScreenX: this.mouseScreenX,
      mouseScreenY: this.mouseScreenY,
      mouseWorldX: this.mouseWorldX,
      mouseWorldY: this.mouseWorldY,
      usingVirtualAim: this.usingVirtualAim && this.cameraMode !== 'fps',
      nearInteractTile,
    });

    // Pass 7: Tactical Minimap (throttled to ~8Hz for low CPU overhead)
    this.minimapTimer += this.lastFrameDt;
    if (this.minimapTimer >= 0.12) {
      this.minimapTimer = 0;
      this.renderMinimap();
    }
    this.flushPendingChunkSpawns();
  }

  private renderMinimap(): void {
    const mc = this.minimapCanvas;
    if (!mc) return;
    const mctx = mc.getContext('2d');
    if (!mctx) return;
    const size = mc.width;
    mctx.imageSmoothingEnabled = false;
    mctx.fillStyle = '#0d1012';
    mctx.fillRect(0, 0, size, size);

    // Dynamic player-centered 44x44 tile radar window for infinite worlds
    const radarTiles = 44;
    const half = radarTiles * 0.5;
    const originGX = Math.floor(this.player.x - half);
    const originGY = Math.floor(this.player.y - half);
    const scale = size / radarTiles;

    for (let ry = 0; ry < radarTiles; ry++) {
      const gy = originGY + ry;
      for (let rx = 0; rx < radarTiles; rx++) {
        const gx = originGX + rx;
        const cell = this.getCell(gx, gy);
        if (!cell.explored) continue;
        if (cell.tile === 'water') {
          mctx.fillStyle = '#265c78';
        } else if (cell.tile === 'pier') {
          mctx.fillStyle = '#ab784b';
        } else if (cell.prop === 'door') {
          mctx.fillStyle = '#c98842';
        } else if (cell.solid) {
          if (cell.prop === 'wall_interior') mctx.fillStyle = '#cfc6b0';
          else if (cell.prop === 'wall_wood') mctx.fillStyle = '#8f5932';
          else if (cell.prop.startsWith('wall')) mctx.fillStyle = '#a34a36';
          else if (cell.prop === 'tree_pine' || cell.prop === 'tree_dead') mctx.fillStyle = '#2f5e2c';
          else if (cell.prop === 'wrecked_car') mctx.fillStyle = '#994823';
          else if (cell.prop === 'rock_boulder') mctx.fillStyle = '#6c7275';
          else if (cell.prop === 'sandbag_wall') mctx.fillStyle = '#85775b';
          else if (cell.prop === 'tent') mctx.fillStyle = '#69854a';
          else mctx.fillStyle = '#755b42';
        } else if (cell.tile === 'road' || cell.tile === 'crosswalk') {
          mctx.fillStyle = '#252a33';
        } else if (cell.tile === 'asphalt_cracked') {
          mctx.fillStyle = '#2b3038';
        } else if (cell.tile === 'sidewalk') {
          mctx.fillStyle = '#a8997e';
        } else if (cell.tile === 'gravel') {
          mctx.fillStyle = '#787268';
        } else if (cell.tile === 'sand') {
          mctx.fillStyle = '#c4ac74';
        } else if (cell.tile === 'mud') {
          mctx.fillStyle = '#473628';
        } else if (cell.tile === 'forest_floor') {
          mctx.fillStyle = '#264020';
        } else if (cell.tile === 'floor_rug') {
          mctx.fillStyle = '#8a3d31';
        } else if (cell.tile === 'floor_bath') {
          mctx.fillStyle = '#6b9196';
        } else if (cell.tile === 'floor_porch') {
          mctx.fillStyle = '#7d5939';
        } else if (cell.tile === 'floor' || cell.tile === 'tile_clinic' || cell.tile === 'tile_diner') {
          mctx.fillStyle = '#735a47';
        } else {
          mctx.fillStyle = '#38632e';
        }
        mctx.fillRect(Math.floor(rx * scale), Math.floor(ry * scale), Math.ceil(scale), Math.ceil(scale));
      }
    }

    const toRadar = (wx: number, wy: number) => ({
      px: Math.floor((wx - originGX) * scale),
      py: Math.floor((wy - originGY) * scale),
    });

    // Lootable unsearched containers
    mctx.fillStyle = '#e0bd5e';
    for (const c of this.containers) {
      if (c.searched) continue;
      const rx = c.gx - originGX;
      const ry = c.gy - originGY;
      if (rx < 0 || ry < 0 || rx >= radarTiles || ry >= radarTiles) continue;
      if (this.getCell(c.gx, c.gy).explored) {
        mctx.fillRect(Math.floor(rx * scale), Math.floor(ry * scale), 2, 2);
      }
    }

    // Drivable vehicles
    for (const v of this.vehicles) {
      if (v.hp <= 0) continue;
      const gx = Math.floor(v.x);
      const gy = Math.floor(v.y);
      if (gx < originGX || gy < originGY || gx >= originGX + radarTiles || gy >= originGY + radarTiles) continue;
      if (!this.getCell(gx, gy).explored) continue;
      const pos = toRadar(v.x, v.y);
      mctx.fillStyle = v.kind === 'police' ? '#4da3ff' : '#e8483f';
      mctx.fillRect(pos.px - 1, pos.py - 1, 3, 3);
    }

    // Campfires
    mctx.fillStyle = '#ff982b';
    for (const s of this.structures) {
      if (s.kind !== 'campfire') continue;
      const rx = s.gx - originGX;
      const ry = s.gy - originGY;
      if (rx < 0 || ry < 0 || rx >= radarTiles || ry >= radarTiles) continue;
      mctx.fillRect(Math.floor(rx * scale) - 1, Math.floor(ry * scale) - 1, 3, 3);
    }

    // Nearby zombies within 14 tiles
    mctx.fillStyle = '#e0483e';
    for (const z of this.zombies) {
      if (z.state === 'dying') continue;
      if (dist(z.x, z.y, this.player.x, this.player.y) <= 14) {
        const pos = toRadar(z.x, z.y);
        mctx.fillRect(pos.px - 1, pos.py - 1, 2, 2);
      }
    }

    // Landmark & Horde Hotspot cues (on-radar diamond or edge directional pip for nearby/discovered landmarks)
    for (const lm of this.worldStore.landmarks.values()) {
      const d = dist(lm.gx + 0.5, lm.gy + 0.5, this.player.x, this.player.y);
      if (!lm.discovered && (lm.threatLevel !== 'high' || lm.hotspotCleared || d > 58)) continue;
      const pos = toRadar(lm.gx + 0.5, lm.gy + 0.5);
      const clampedX = clamp(pos.px, 4, size - 5);
      const clampedY = clamp(pos.py, 4, size - 5);
      const col = lm.hotspotCleared
        ? '#78c796'
        : lm.threatLevel === 'high'
          ? '#ff5a52'
          : '#f0d078';
      mctx.fillStyle = col;
      mctx.beginPath();
      mctx.moveTo(clampedX, clampedY - 3);
      mctx.lineTo(clampedX + 3, clampedY);
      mctx.lineTo(clampedX, clampedY + 3);
      mctx.lineTo(clampedX - 3, clampedY);
      mctx.closePath();
      mctx.fill();
    }

    // Selected navigation destination, clamped to radar edge when off-screen.
    if (this.waypoint) {
      const pos = toRadar(this.waypoint.x, this.waypoint.y);
      const x=clamp(pos.px,4,size-5), y=clamp(pos.py,4,size-5);
      mctx.strokeStyle='#70d9ff';mctx.lineWidth=2;
      mctx.strokeRect(x-3,y-3,6,6);
    }

    // Survivor marker (centered)
    const pPos = toRadar(this.player.x, this.player.y);
    mctx.fillStyle = '#5ef28f';
    mctx.fillRect(pPos.px - 1, pPos.py - 1, 3, 3);
  }

  private emitHud(): void {
    const { phaseLabel, formattedTime } = getDaylightInfo(this.timeMinutes);
    const activeCar = this.getActiveVehicle();
    const nearby = activeCar ? null : this.findNearestLootable();
    const directDoor = !activeCar && this.fishing.phase === 'idle' ? this.findNearestDoor() : null;
    const nearbyDoor = !activeCar && !nearby ? this.findNearestDoor() : null;
    const nearbyTrunk = !activeCar && !nearby && !nearbyDoor ? this.findNearestVehicleTrunk() : null;
    const nearbyFish =
      !activeCar && !nearby && !nearbyDoor && !nearbyTrunk && this.fishing.phase === 'idle'
        ? findFishingSpot(this.worldStore, this.player.x, this.player.y)
        : null;
    const nearbyBed =
      !activeCar && !nearby && !nearbyDoor && !nearbyTrunk && !nearbyFish && this.fishing.phase === 'idle'
        ? this.findNearestBed()
        : null;
    const nearCookingHeat = !activeCar && this.isNearCookingHeat();
    const nearbyDriveCar = activeCar ? null : this.findNearestVehicle();

    let nearbyPrompt: NearbyActionPrompt | null = null;
    if (this.fishing.phase !== 'idle') {
      nearbyPrompt = {
        action: 'fishing',
        label:
          this.fishing.phase === 'bite'
            ? 'FISH ON! REEL IN!'
            : this.fishing.phase === 'casting'
              ? 'Casting line...'
              : 'Waiting for bite...',
        key: this.fishing.phase === 'bite' ? 'CLICK / E' : 'E',
        progress:
          this.fishing.phase === 'bite'
            ? clamp(1 - this.fishing.biteElapsed / (this.fishing.biteDuration || 1), 0, 1)
            : 0,
      };
    } else if (nearby) {
      nearbyPrompt = {
        action: 'loot',
        label:
          nearby.kind === 'zombie_drop'
            ? 'Loot Infected Pouch'
            : nearby.kind === 'med_cabinet'
              ? 'Search Medical Cabinet'
              : nearby.kind === 'fridge'
                ? 'Search Refrigerator'
                : 'Search Supply Crate',
        key: 'E',
        progress: nearby.searchProgress,
      };
    } else if (nearbyDoor) {
      if (nearbyDoor.status === 'locked') {
        nearbyPrompt = {
          action: 'door',
          label:
            nearbyDoor.lockpickProgress > 0
              ? `Lockpick Door (${Math.round(nearbyDoor.lockpickProgress * 100)}%)`
              : 'Lockpick Door (or Crowbar Pry)',
          key: 'E',
          progress: nearbyDoor.lockpickProgress,
        };
      } else if (nearbyDoor.status === 'barricaded') {
        nearbyPrompt = {
          action: 'door',
          label: 'Remove Door Barricade',
          key: 'E',
          progress: 0,
        };
      } else {
        nearbyPrompt = {
          action: 'door',
          label: nearbyDoor.status === 'open' ? 'Close Door' : 'Open Door',
          key: 'E',
          progress: 0,
          secondaryLabel: 'Barricade (2 Wood)',
          secondaryKey: 'V',
        };
      }
    } else if (nearbyTrunk) {
      nearbyPrompt = {
        action: 'loot',
        label: nearbyTrunk.kind === 'police' ? 'Search Police Trunk' : 'Search Sedan Trunk',
        key: 'E',
        progress: 0,
      };
    } else if (nearbyFish) {
      nearbyPrompt = {
        action: 'fishing',
        label: nearbyFish.onPier ? 'Cast Rod from Pier' : 'Cast Rod from Shore',
        key: 'E',
        progress: 0,
      };
    } else if (nearbyBed) {
      nearbyPrompt = {
        action: 'sleep',
        label: this.restCooldownSeconds > 0
          ? `Rest cooldown ${formatRestCooldown(this.restCooldownSeconds)} (awake play)`
          : !canSleepSafely(this.zombies, this.player.x, this.player.y)
            ? 'Unsafe to rest: infected nearby'
            : 'Rest in Bed (+40 HP · +3h)',
        key: 'E',
        progress: 0,
      };
    } else if (nearCookingHeat) {
      nearbyPrompt = {
        action: 'cook',
        label: 'Quick Cook Menu',
        key: 'K',
        progress: 0,
      };
    }

    this.onHudUpdate({
      phase: this.phase,
      hardcore: this.hardcore,
      playerName: getProfile().name,
      hasSave: this.saveAvailable,
      cameraMode: this.cameraMode,
      hp: Math.round(this.player.hp),
      maxHp: this.player.maxHp,
      hunger: Math.round(this.player.hunger),
      thirst: Math.round(this.player.thirst),
      bleeding: this.player.bleeding,
      battery: Math.round(this.player.battery),
      flashlightOn: this.player.flashlightOn,
      equippedWeapon: this.player.equippedWeapon,
      pistolMag: this.player.pistolMag,
      pistolMagSize: this.player.pistolMagSize,
      shotgunMag: this.player.shotgunMag,
      shotgunMagSize: this.player.shotgunMagSize,
      restCooldownSeconds: this.restCooldownSeconds,
      restSafe: canSleepSafely(this.zombies, this.player.x, this.player.y),
      dodgeReady: this.player.dodgeCooldown <= 0 && this.player.dodgeTimer <= 0,
      isReloading: this.player.reloadingTimer > 0,
      reloadProgress:
        this.player.reloadingWeapon && WEAPONS[this.player.reloadingWeapon].reloadTime > 0
          ? 1 - this.player.reloadingTimer / WEAPONS[this.player.reloadingWeapon].reloadTime
          : 0,
      buildMode: this.player.buildMode,
      inventory: { ...this.inventory },
      day: this.day,
      timeMinutes: this.timeMinutes,
      timeLabel: formattedTime,
      dayPhaseLabel: phaseLabel,
      kills: this.kills,
      score: this.score,
      bestScore: Math.max(this.bestScore, this.score),
      zombiesAlive: this.zombies.filter((z) => z.state !== 'dying').length,
      worldCoords: {
        gx: Math.floor(this.player.x),
        gy: Math.floor(this.player.y),
      },
      nearCookingHeat,
      fishing:
        this.fishing.phase !== 'idle'
          ? {
              phase: this.fishing.phase,
              biteProgress:
                this.fishing.phase === 'bite'
                  ? clamp(1 - this.fishing.biteElapsed / (this.fishing.biteDuration || 1), 0, 1)
                  : 0,
              canHook: this.fishing.phase === 'bite',
            }
          : null,
      nearbyPrompt,
      nearbyDoorAction: directDoor ? {status: directDoor.status, label: directDoor.status === 'locked' ? `PICK ${Math.round(directDoor.lockpickProgress*100)}%` : directDoor.status === 'open' ? 'CLOSE DOOR' : directDoor.status === 'barricaded' ? 'UNBOARD' : 'OPEN DOOR'} : null,
      nearbyVehiclePrompt: nearbyDriveCar
        ? {
            label:
              nearbyDriveCar.hp <= 0
                ? 'Wrecked Vehicle'
                : nearbyDriveCar.kind === 'police'
                  ? 'Drive Police Cruiser'
                  : 'Drive Sedan',
            canDrive: nearbyDriveCar.hp > 0,
            canRepair: nearbyDriveCar.hp < nearbyDriveCar.maxHp && this.inventory.scrap >= VEHICLE_REPAIR_SCRAP_COST,
            hpPct: Math.round((nearbyDriveCar.hp / nearbyDriveCar.maxHp) * 100),
            scrapCost: VEHICLE_REPAIR_SCRAP_COST,
          }
        : null,
      drivingVehicle: activeCar
        ? {
            kind: activeCar.kind,
            speedKmh: Math.round(Math.abs(activeCar.speed) * 11.5),
            fuel: Math.round(activeCar.fuel),
            hp: Math.round(activeCar.hp),
            maxHp: activeCar.maxHp,
            headlightsOn: activeCar.headlightsOn,
            sirenOn: activeCar.sirenOn,
            boosting: activeCar.boosting,
            canRepair: activeCar.hp < activeCar.maxHp && this.inventory.scrap >= VEHICLE_REPAIR_SCRAP_COST,
            repairCost: VEHICLE_REPAIR_SCRAP_COST,
          }
        : null,
      statusBanner: this.statusBanner,
      currentBiomeLabel: getBiomeDisplayName(
        sampleBiomeAt(this.worldStore.seed, Math.floor(this.player.x), Math.floor(this.player.y))
      ),
      discoveredLandmarks: Array.from(this.worldStore.landmarks.values())
        .filter((lm) => lm.discovered)
        .sort(
          (a, b) =>
            dist(a.gx + 0.5, a.gy + 0.5, this.player.x, this.player.y) -
            dist(b.gx + 0.5, b.gy + 0.5, this.player.x, this.player.y)
        )
        .slice(0, 10)
        .map((lm) => ({
          id: lm.id,
          name: lm.name,
          kind: lm.kind,
          x: lm.gx + 0.5,
          y: lm.gy + 0.5,
          threatLevel: lm.threatLevel,
          hotspotActive: !lm.hotspotCleared,
          hotspotCleared: lm.hotspotCleared,
        })),
      activeLootContainer: this.activeLootContainer,
      pickupNotifications: this.pickupNotifications,
    });
  }
}

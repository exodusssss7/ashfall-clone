import { vehicleRelativeTouchInput } from './drivingControls';
import {
  drawActionProp,
  getLootOpenStage,
  getLootPopTransform,
  getZombieDyingFrame,
  resolvePlayerAnimState,
  resolveZombieAnimState,
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
  CHUNK_SIZE,
  PIXEL_SCALE,
  TILE_H,
  TILE_W,
  clamp,
  dist,
  hasLineOfSight,
  isoToWorld,
  lerp,
  screenVectorToIsoWorld,
  worldToIso,
} from './isometric';
import { PixelArtAtlas } from './pixelArt';
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
import type {
  BloodDecal,
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
  PlayerState,
  Projectile,
  SoundRipple,
  StructureKind,
  TileCell,
  Vehicle,
  WeaponId,
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

export class SurvivalEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private lightCanvas: HTMLCanvasElement;
  private lightCtx: CanvasRenderingContext2D;
  private flashCanvas: HTMLCanvasElement;
  private flashCtx: CanvasRenderingContext2D;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private atlas: PixelArtAtlas;

  private zombieRoutes = new Map<number, { points: RoutePoint[]; target: string; expires: number }>();
  private waypoint: { x: number; y: number } | null = null;

  setWaypoint(x: number | null, y: number | null): void {
    this.waypoint = x === null || y === null ? null : { x, y };
  }

  private steerZombie(z: Zombie, tx: number, ty: number): { dx: number; dy: number } {
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
  private zombies: Zombie[] = [];
  private projectiles: Projectile[] = [];
  private firePatches: FirePatch[] = [];
  private soundRipples: SoundRipple[] = [];
  private floatingTexts: FloatingText[] = [];
  private particles: PooledParticle[] = [];
  private particleCursor = 0;

  private player: PlayerState = createInitialPlayer();
  private inventory: Inventory = createInitialInventory();

  private day = 1;
  private timeMinutes = 8 * 60 + 30; // Start at 08:30 AM Day 1
  private kills = 0;
  private score = 0;
  private bestScore = 0;
  private spawnTimer = 2.5;
  private nextEntityId = 1;
  private hitstopTimer = 0;
  private trauma = 0;
  private elapsedClock = 0;
  private muzzleFlashTimer = 0;
  private hitMarkerTimer = 0;
  private hitMarkerCrit = false;
  private screechCooldown = 0;
  private heartbeatTimer = 0;
  private crackleTimer = 0;
  private prevBoostActive = false;
  private statusBanner: string | null = null;
  private statusBannerTimer = 0;
  private deathDelayTimer = 0;
  private pendingGameOver = false;
  private sleepTransitionTimer = 0;
  private playerVelX = 0;
  private playerVelY = 0;
  private lastFrameDt = 0.016;
  private ambientAsh: Array<{ x: number; y: number; speed: number; drift: number; size: number; alpha: number }> = [];

  // Camera in unscaled isometric pixel coordinates
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
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;

    this.lightCanvas = document.createElement('canvas');
    this.lightCtx = this.lightCanvas.getContext('2d')!;

    this.flashCanvas = document.createElement('canvas');
    this.flashCanvas.width = 48;
    this.flashCanvas.height = 48;
    this.flashCtx = this.flashCanvas.getContext('2d')!;
    this.flashCtx.imageSmoothingEnabled = false;

    this.atlas = new PixelArtAtlas();
    this.onHudUpdate = onHudUpdate;
    this.onPhaseChange = onPhaseChange;
    this.onRequestOpenCook = onRequestOpenCook;

    try {
      const saved = localStorage.getItem(BEST_SCORE_KEY);
      if (saved) this.bestScore = parseInt(saved, 10) || 0;
    } catch {
      // ignore storage errors
    }

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
  }

  private getCell(gx: number, gy: number): TileCell {
    return getWorldCell(this.worldStore, gx, gy);
  }

  private streamChunksAround(wx: number, wy: number, radiusChunks = 2): void {
    const pcx = Math.floor(wx / CHUNK_SIZE);
    const pcy = Math.floor(wy / CHUNK_SIZE);
    for (let cy = pcy - radiusChunks; cy <= pcy + radiusChunks; cy++) {
      for (let cx = pcx - radiusChunks; cx <= pcx + radiusChunks; cx++) {
        const key = `${cx},${cy}`;
        if (this.worldStore.populatedChunks.has(key)) continue;
        const spawned = generateChunk(this.worldStore, cx, cy, this.nextVehicleIdRef);
        if (spawned.containers.length) this.containers.push(...spawned.containers);
        if (spawned.structures.length) this.structures.push(...spawned.structures);
        if (spawned.vehicles.length) this.vehicles.push(...spawned.vehicles);
        for (const d of spawned.doors) {
          this.doors.push(d);
          this.doorByTile.set(`${d.gx}_${d.gy}`, d);
        }
      }
    }
  }

  private initWorld(titleMode: boolean): void {
    this.zombieRoutes.clear();
    const world = generateWorld(1994);
    this.worldStore = world.worldStore;
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
    this.nextVehicleIdRef = { nextId: 100 };
    this.activeVehicleId = null;
    this.prevBoostActive = false;
    this.lastFogGX = -999999;
    this.lastFogGY = -999999;
    soundEngine.updateEngineSound(false, 0, false);
    this.player = createInitialPlayer(world.spawnX, world.spawnY);
    this.inventory = createInitialInventory();
    this.decals = [];
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
    this.spawnTimer = 3.0;
    this.hitstopTimer = 0;
    this.trauma = 0;
    this.pendingGameOver = false;
    this.deathDelayTimer = 0;
    this.sleepTransitionTimer = 0;
    this.playerVelX = 0;
    this.playerVelY = 0;
    this.statusBanner = titleMode ? null : 'DAY 1 · EXPLORE LAKE PIER, COOK AT STOVES & OUTLAST NIGHT';
    this.statusBannerTimer = titleMode ? 0 : 4.5;

    this.streamChunksAround(world.spawnX, world.spawnY, 2);

    // Seed initial neighborhood zombies at safe distance (>= 13 tiles away from spawn)
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
      if (!this.getCell(zx, zy).solid) {
        this.spawnZombieAt(zx + 0.5, zy + 0.5, arch);
      }
    }

    const iso = worldToIso(this.player.x, this.player.y, 0);
    this.camX = iso.sx;
    this.camY = iso.sy;
    this.revealFogAround(this.player.x, this.player.y, 9);
  }

  start(): void {
    this.lastTimestamp = performance.now();
    const loop = (now: number) => {
      const rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
      this.lastFrameDt = dt;
      this.update(dt);
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    soundEngine.stop();
    this.unbindEvents();
  }

  startGame(fromGesture = true): void {
    if (fromGesture) {
      soundEngine.unlock();
      soundEngine.playUiClick();
    }
    this.initWorld(false);
    this.setPhase('playing');
    this.clearInputs();
    this.emitHud();
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
    soundEngine.playUiClick();
    soundEngine.updateEngineSound(false, 0, false);
    this.setPhase('paused');
    this.clearInputs();
    this.emitHud();
  }

  returnToTitle(): void {
    soundEngine.playUiClick();
    soundEngine.updateEngineSound(false, 0, false);
    this.initWorld(true);
    this.setPhase('title');
    this.clearInputs();
    this.emitHud();
  }

  private setPhase(next: GamePhase): void {
    this.phase = next;
    document.body.dataset.state = next;
    this.onPhaseChange(next);
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  selectWeapon(weapon: WeaponId): void {
    if (this.phase !== 'playing') return;
    this.player.buildMode = null;
    if (this.player.equippedWeapon !== weapon) {
      this.player.equippedWeapon = weapon;
      this.player.reloadingTimer = 0;
      this.player.reloadingWeapon = null;
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
      this.emitHud();
      return true;
    }
    return false;
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
    this.player.x = nearest.x;
    this.player.y = nearest.y;
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
    soundEngine.playLootPickup();
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
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;

    this.lightCanvas.width = Math.max(160, Math.floor(w / PIXEL_SCALE));
    this.lightCanvas.height = Math.max(120, Math.floor(h / PIXEL_SCALE));
    this.lightCtx.imageSmoothingEnabled = false;
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

    if (this.phase !== 'playing') return;

    if (!this.keysHeld.has(code)) {
      this.justPressed.add(code);
    }
    this.keysHeld.add(code);

    // Hotbar weapon, consumable, door, cooking & vehicle switches
    if (code === 'KeyG') {
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
    } else if (code === 'Digit5' || code === 'KeyH') {
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

  private onMouseMove = (e: MouseEvent): void => {
    this.usingVirtualAim = false;
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreenX = e.clientX - rect.left;
    this.mouseScreenY = e.clientY - rect.top;
    this.updateMouseWorld();
  };

  private onMouseDown = (e: MouseEvent): void => {
    soundEngine.unlock();
    this.usingVirtualAim = false;
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
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onBlur = (): void => {
    this.clearInputs();
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) this.clearInputs();
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
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
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private updateMouseWorld(): void {
    // Camera look-ahead calls this after movement. Preserve touch aim rather than
    // overwriting the flashlight target with the last desktop cursor position.
    if (this.usingVirtualAim) {
      const angle = this.virtualAimActive ? this.virtualAimAngle : this.player.facingAngle;
      this.mouseWorldX = this.player.x + Math.cos(angle) * 4.5;
      this.mouseWorldY = this.player.y + Math.sin(angle) * 4.5;
      return;
    }
    const isoX = (this.mouseScreenX - this.viewW * 0.5) / PIXEL_SCALE + this.camX;
    const isoY = (this.mouseScreenY - this.viewH * 0.5) / PIXEL_SCALE + this.camY;
    const wp = isoToWorld(isoX, isoY);
    this.mouseWorldX = wp.wx;
    this.mouseWorldY = wp.wy;
  }

  private update(dt: number): void {
    soundEngine.updateAmbience(this.phase === 'playing', this.timeMinutes);
    this.elapsedClock += dt;

    if (this.phase === 'paused' || this.phase === 'gameover') {
      return;
    }

    if(this.actionVisual){this.actionVisual.remaining-=dt;if(this.actionVisual.remaining<=0)this.actionVisual=null;}

    // Visual-only effects always tick even during hitstop
    this.trauma = Math.max(0, this.trauma - dt * 2.4);
    this.sleepTransitionTimer = Math.max(0, this.sleepTransitionTimer - dt);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
    this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt);
    this.screechCooldown = Math.max(0, this.screechCooldown - dt);
    this.updateParticles(dt);
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
    for (const v of this.vehicles) {
      v.hitFlash = Math.max(0, v.hitFlash - dt);
    }

    if (this.activeVehicleId !== null) {
      this.updateDriving(dt);
    } else {
      soundEngine.updateEngineSound(false, 0, false);
      this.updatePlayer(dt);
    }
    this.updateDoors(dt);
    this.updateContainers(dt);
    this.updateFishing(dt);
    this.updateStructures(dt);
    this.updateProjectiles(dt);
    this.updateFirePatches(dt);
    this.updateZombies(dt);
    this.updateSpawning(dt);
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
          soundEngine.playCarImpact();
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
    this.player.facingAngle = next.angle;
    this.player.hitFlash = Math.max(0, this.player.hitFlash - dt);
    this.player.invulnTimer = Math.max(0, this.player.invulnTimer - dt);
    this.player = tickSurvivalNeeds(this.player, dt, false, false);

    // Stream infinite chunks & reveal minimap fog with headlights
    const fgx = Math.floor(next.x);
    const fgy = Math.floor(next.y);
    if (fgx !== this.lastFogGX || fgy !== this.lastFogGY) {
      this.lastFogGX = fgx;
      this.lastFogGY = fgy;
      this.streamChunksAround(next.x, next.y, 2);
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

    // Screen-aligned isometric WASD + virtual joystick vector
    let moveX = 0;
    let moveY = 0;
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

    const vMag = Math.hypot(this.virtualMoveX, this.virtualMoveY);
    if (vMag > 0.14) {
      const isoVec = screenVectorToIsoWorld(this.virtualMoveX, this.virtualMoveY);
      moveX += isoVec.wx;
      moveY += isoVec.wy;
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
      soundEngine.playMeleeSwing();
    }

    const wantsSprint =
      ((this.keysHeld.has('ShiftLeft') || this.keysHeld.has('ShiftRight')) || vMag > 0.85) &&
      moveLen > 0;

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
        this.moveActor(p, dx, dy, 0.22);
        const stepDist = Math.hypot(dx, dy);
        p.walkCycle += stepDist * 5.2;
        p.stepAccumulator += stepDist;
        if (this.fishing.phase !== 'idle') {
          this.cancelFishing();
        }
        if (p.stepAccumulator >= 0.85) {
          p.stepAccumulator = 0;
          const cell = this.getCell(Math.floor(p.x), Math.floor(p.y));
          const surf =
            cell.tile === 'road' || cell.tile === 'sidewalk' || cell.tile === 'floor' || cell.tile === 'pier'
              ? 'road'
              : 'grass';
          soundEngine.playFootstep(surf, wantsSprint);
          if (wantsSprint) {
            this.emitSound(p.x, p.y, 6.2, false);
          }
        }
      }
    }

    // Aim facing toward right touch stick, movement direction (when using touch), or mouse cursor
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
    if (this.player.hp > 0 && (this.player.hp <= 30 || this.player.bleeding)) {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        this.heartbeatTimer = this.player.hp <= 20 ? 0.85 : 1.15;
        soundEngine.playHeartbeat();
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
      this.streamChunksAround(this.player.x, this.player.y, 2);
      this.revealFogAround(this.player.x, this.player.y, this.player.flashlightOn ? 10 : 6);
    }

    // Handle Fishing Hook/Reel, Build Mode, or Combat Action
    // Inner ring aims only for every weapon. Outer ring aims and attacks.
    const aimStickAttack = touchAimAttack(this.virtualAimActive, this.virtualAimMag);

    const triggerAction =
      this.mouseJustClicked ||
      this.virtualFireJustPressed ||
      this.virtualFireHeld ||
      aimStickAttack ||
      (this.mouseDown && p.equippedWeapon === 'crowbar') ||
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
        this.emitSound(p.x, p.y, 4.2, false);
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
      this.fireProjectiles('bullet', p.x, p.y, p.facingAngle, 1, spec.spreadRad, spec.damage, 21);
      // Muzzle flash & ejecting brass casing
      this.spawnParticles(p.x + Math.cos(p.facingAngle) * 0.4, p.y + Math.sin(p.facingAngle) * 0.4, 0.65, 5, '#ffd978', 3.4, 0.6);
      this.spawnParticles(p.x - Math.sin(p.facingAngle) * 0.25, p.y + Math.cos(p.facingAngle) * 0.25, 0.75, 1, '#e6be53', 1.6, 2.4, 14);
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
      this.fireProjectiles('pellet', p.x, p.y, p.facingAngle, spec.pellets, spec.spreadRad, spec.damage, 19);
      this.spawnParticles(p.x + Math.cos(p.facingAngle) * 0.5, p.y + Math.sin(p.facingAngle) * 0.5, 0.65, 11, '#ffbc52', 4.6, 0.8);
      this.spawnParticles(p.x - Math.sin(p.facingAngle) * 0.25, p.y + Math.cos(p.facingAngle) * 0.25, 0.75, 1, '#d1493b', 1.9, 2.7, 14);
      this.emitHud();
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
      const tx = this.usingVirtualAim
        ? p.x + Math.cos(p.facingAngle) * 4.5
        : clamp(this.mouseWorldX, p.x - spec.range, p.x + spec.range);
      const ty = this.usingVirtualAim
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
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      this.projectiles.push({
        id: this.nextEntityId++,
        kind,
        x: sx + Math.cos(a) * 0.35,
        y: sy + Math.sin(a) * 0.35,
        z: 0.65,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        vz: 0,
        damage,
        life: kind === 'pellet' ? 0.48 : 0.75,
        maxLife: kind === 'pellet' ? 0.48 : 0.75,
      });
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
    for (const c of this.containers) {
      if (c.kind === 'zombie_drop') continue;
      if (c.searched) {
        const cur = c.openAnim ?? 0;
        if (cur < 1) {
          c.openAnim = Math.min(1, cur + dt * 2.6);
        }
      }
      if (c.popTimer && c.popTimer > 0) {
        c.popTimer = Math.max(0, c.popTimer - dt);
      }
    }
  }

  private collectContainer(c: LootContainer): void {
    if (c.searched) return;
    this.animateAction('search','SEARCHING',.9);
    c.searched = true;
    c.openAnim = 0.05;
    c.popTimer = 0.48;
    const gained: string[] = [];
    for (const [key, qty] of Object.entries(c.items)) {
      if (!qty) continue;
      const item = key as ItemId;
      this.inventory[item] += qty;
      gained.push(`+${qty} ${item.replace('ammo_', '')}`);
    }
    soundEngine.playLootPickup();
    this.score += 15;
    const label = gained.length > 0 ? gained.slice(0, 3).join(' · ') : 'Empty';
    this.addFloatingText(c.gx + 0.5, c.gy + 0.5, 1.1, label, '#f0d078');
    this.spawnParticles(c.gx + 0.5, c.gy + 0.5, 0.4, 6, '#d9b566', 2.0, 1.8);
    this.emitHud();
  }

  private collectVehicleTrunk(v: Vehicle): void {
    if (v.trunkSearched) return;
    this.animateAction('search','SEARCHING TRUNK',1);
    v.trunkSearched = true;
    const gained: string[] = [];
    for (const [key, qty] of Object.entries(v.trunkItems ?? {})) {
      if (!qty) continue;
      const item = key as ItemId;
      this.inventory[item] += qty;
      gained.push(`+${qty} ${item.replace('ammo_', '')}`);
    }
    soundEngine.playLootPickup();
    this.score += 20;
    const label = gained.length > 0 ? gained.slice(0, 3).join(' · ') : 'Empty Trunk';
    this.addFloatingText(v.x, v.y, 1.2, label, '#f0d078');
    this.spawnParticles(v.x, v.y, 0.4, 6, '#d9b566', 2.0, 1.8);
    this.emitHud();
  }

  private findNearestLootable(): LootContainer | null {
    let best: LootContainer | null = null;
    let bestD = 1.95;
    for (const c of this.containers) {
      if (c.searched) continue;
      const d = dist(this.player.x, this.player.y, c.gx + 0.5, c.gy + 0.5);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private findNearestVehicleTrunk(): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = 2.3;
    for (const v of this.vehicles) {
      if (v.trunkSearched) continue;
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
      if (z.state === 'dying') continue;
      if (dist(z.x, z.y, x, y) <= radius) {
        z.lastHeardX = x;
        z.lastHeardY = y;
        if (z.state === 'wander') {
          z.state = 'alert';
          z.stateTimer = 3.5;
        }
      }
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
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;

      if (pr.kind === 'molotov' || pr.kind === 'acid') {
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

      // Bullet / Pellet wall collision across infinite world
      const gx = Math.floor(pr.x);
      const gy = Math.floor(pr.y);
      if (dist(pr.x, pr.y, this.player.x, this.player.y) > 28 || this.getCell(gx, gy).blocksSight) {
        this.spawnParticles(pr.x, pr.y, 0.5, 4, '#d9b566', 2.4, 1.4);
        this.projectiles.splice(i, 1);
        continue;
      }

      // Bullet / Pellet zombie hit
      let hit = false;
      for (const z of this.zombies) {
        if (z.state === 'dying') continue;
        const hitRadius = z.archetype === 'bloater' ? 0.55 : 0.42;
        if (dist(pr.x, pr.y, z.x, z.y) <= hitRadius) {
          const speed = Math.hypot(pr.vx, pr.vy) || 1;
          const { damage, isCrit } = computeCombatDamage(
            pr.damage,
            Math.random(),
            pr.kind === 'bullet' ? 0.22 : 0.12
          );
          this.damageZombie(
            z,
            damage,
            (pr.vx / speed) * (isCrit ? 3.4 : 2.5),
            (pr.vy / speed) * (isCrit ? 3.4 : 2.5),
            isCrit,
            isCrit
          );
          hit = true;
          break;
        }
      }

      if (hit || pr.life <= 0) {
        this.projectiles.splice(i, 1);
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
    isCrit = false
  ): void {
    z.hp -= amount;
    z.hitFlash = 0.08;
    z.scaleX = 1.22;
    z.scaleY = 0.8;
    z.vx += kbX;
    z.vy += kbY;
    if (z.state === 'wander' || z.state === 'alert') {
      z.state = 'chase';
    }
    if (heavy || isCrit || amount >= 10) {
      this.hitMarkerTimer = 0.14;
      this.hitMarkerCrit = isCrit;
    }

    this.spawnParticles(z.x, z.y, 0.55, heavy ? 12 : 7, isCrit ? '#d93829' : '#a32222', 3.4, 2.2);
    this.addFloatingText(
      z.x,
      z.y,
      1.2,
      isCrit ? `CRIT -${Math.round(amount)}` : `-${Math.round(amount)}`,
      isCrit ? '#ffd266' : heavy ? '#f0d078' : '#e6e2d8'
    );

    if (z.hp <= 0 && z.state !== 'dying') {
      z.state = 'dying';
      z.stateTimer = 0.52;
      z.hasAttackToken = false;
      this.kills += 1;
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
      const effectiveSight = cfg.sightRange * (p.flashlightOn ? 1.15 : 1 - darkness * 0.35);
      const canSeePlayer =
        dToPlayer <= effectiveSight && hasLineOfSight(this.worldStore, z.x, z.y, p.x, p.y, true);

      if (canSeePlayer) {
        if (z.state === 'wander' || z.state === 'alert') {
          z.state = 'chase';
          if (Math.random() < 0.5) soundEngine.playZombieGroan(z.archetype);
        }
      }

      if (z.state === 'wander') {
        const wd = dist(z.x, z.y, z.wanderTargetX, z.wanderTargetY);
        if (wd < 0.4 || Math.random() < 0.008) {
          z.wanderTargetX = z.x + (Math.random() - 0.5) * 7;
          z.wanderTargetY = z.y + (Math.random() - 0.5) * 7;
        }
        const dx = z.wanderTargetX - z.x;
        const dy = z.wanderTargetY - z.y;
        const len = Math.hypot(dx, dy) || 1;
        this.moveActor(z, (dx / len) * z.speed * 0.35 * dt, (dy / len) * z.speed * 0.35 * dt, 0.21);
        z.facingX = dx / len;
        z.facingY = dy / len;
        z.walkCycle += z.speed * 0.35 * dt * 3;
      } else if (z.state === 'alert') {
        z.stateTimer -= dt;
        if (z.lastHeardX !== null && z.lastHeardY !== null) {
          const dHeard = dist(z.x, z.y, z.lastHeardX, z.lastHeardY);
          if (dHeard > 0.5) {
            const steer = this.steerZombie(z, z.lastHeardX, z.lastHeardY);
            this.moveActor(z, steer.dx * z.speed * 0.72 * dt, steer.dy * z.speed * 0.72 * dt, 0.21);
            z.facingX = steer.dx;
            z.facingY = steer.dy;
            z.walkCycle += z.speed * 0.72 * dt * 3;
          } else {
            z.lastHeardX = null;
          }
        }
        if (z.stateTimer <= 0) z.state = 'wander';
      } else if (z.state === 'chase') {
        const steer = this.steerZombie(z, p.x, p.y);
        const dx = p.x - z.x;
        const dy = p.y - z.y;
        const len = Math.hypot(dx, dy) || 1;
        z.facingX = dx / len;
        z.facingY = dy / len;

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

          if (dToPlayer <= cfg.attackRange) {
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
          z.state = 'chase';
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

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.zombies.length < maxZombies) {
      this.spawnTimer = isNight ? Math.max(1.8, 4.2 - this.day * 0.3) : 6.5;

      // Pick spawn point on outer ring (11-16 tiles from player) anywhere in infinite world
      for (let attempt = 0; attempt < 10; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 11 + Math.random() * 5;
        const sx = this.player.x + Math.cos(ang) * rad;
        const sy = this.player.y + Math.sin(ang) * rad;
        const cell = this.getCell(Math.floor(sx), Math.floor(sy));
        if (cell.tile !== 'water' && !this.isPointSolid(sx, sy, 0.3)) {
          const r = Math.random();
          let arch: ZombieArchetype = 'walker';
          if (r < (isNight ? 0.28 : 0.12)) arch = 'runner';
          else if (r < (isNight ? 0.44 : 0.22)) arch = 'spitter';
          else if (r < (isNight ? 0.54 : 0.28)) arch = 'bloater';
          this.spawnZombieAt(sx, sy, arch);
          break;
        }
      }
    }
  }

  private spawnZombieAt(x: number, y: number, archetype: ZombieArchetype): void {
    const cfg = ZOMBIE_CONFIGS[archetype];
    const hpScale = 1 + (this.day - 1) * 0.12;
    this.zombies.push({
      id: this.nextEntityId++,
      archetype,
      x,
      y,
      vx: 0,
      vy: 0,
      facingX: 1,
      facingY: 0,
      hp: cfg.hp * hpScale,
      maxHp: cfg.hp * hpScale,
      speed: cfg.speed,
      state: 'wander',
      stateTimer: 0,
      wanderTargetX: x,
      wanderTargetY: y,
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
    for (let i = 0; i < count; i++) {
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
    // Visible checkpoint burning barrels emit rising embers around camera
    const centerWorld = isoToWorld(this.camX, this.camY);
    const minGX = Math.floor(centerWorld.wx - 20);
    const maxGX = Math.ceil(centerWorld.wx + 20);
    const minGY = Math.floor(centerWorld.wy - 20);
    const maxGY = Math.ceil(centerWorld.wy + 20);
    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        if (this.getCell(gx, gy).prop === 'barrel_burn' && Math.random() < dt * 4.5) {
          this.spawnParticles(
            gx + 0.5 + (Math.random() - 0.5) * 0.18,
            gy + 0.5 + (Math.random() - 0.5) * 0.18,
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
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0d1012';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // Trauma camera shake
    const shakeMag = this.trauma * this.trauma * 7;
    const shakeX = shakeMag > 0.1 ? (Math.random() * 2 - 1) * shakeMag : 0;
    const shakeY = shakeMag > 0.1 ? (Math.random() * 2 - 1) * shakeMag : 0;

    const originX = this.viewW * 0.5 / PIXEL_SCALE - this.camX + shakeX;
    const originY = this.viewH * 0.5 / PIXEL_SCALE - this.camY + shakeY;

    ctx.save();
    ctx.scale(PIXEL_SCALE, PIXEL_SCALE);

    // Determine visible diamond tile bounds for fast infinite isometric culling (cull before getCell!)
    const vPw = Math.ceil(this.viewW / PIXEL_SCALE);
    const vPh = Math.ceil(this.viewH / PIXEL_SCALE);
    const centerWorld = isoToWorld(this.camX, this.camY);
    const span = 22;
    const minGX = Math.floor(centerWorld.wx - span);
    const maxGX = Math.ceil(centerWorld.wx + span);
    const minGY = Math.floor(centerWorld.wy - span);
    const maxGY = Math.ceil(centerWorld.wy + span);

    // Pass 1: Isometric Ground Tiles
    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const iso = worldToIso(gx, gy, 0);
        const drawX = Math.round(originX + iso.sx - TILE_W * 0.5);
        const drawY = Math.round(originY + iso.sy);
        if (drawX < -TILE_W || drawX > vPw + TILE_W || drawY < -TILE_H || drawY > vPh + TILE_H) {
          continue;
        }
        const cell = this.getCell(gx, gy);
        ctx.drawImage(this.atlas.getTile(cell.tile, cell.variant), drawX, drawY);
        // Subtle animated pixel water shimmer on lake tiles
        if (cell.tile === 'water' && ((gx * 7 + gy * 13 + Math.floor(this.elapsedClock * 3)) % 11) === 0) {
          ctx.fillStyle = 'rgba(138, 212, 235, 0.34)';
          ctx.fillRect(drawX + 13 + ((gx + gy) % 5), drawY + 7 + (gy % 3), 3, 1);
        }
      }
    }

    // Pass 1.5: True 2:1 Isometric Directional Ground Cast Shadows (NW sun casts diagonal SE shadows)
    const { darkness: shadowDarkness } = getDaylightInfo(this.timeMinutes);
    const shadowAlpha = clamp(0.24 * (1 - shadowDarkness * 0.55), 0.08, 0.25);
    ctx.fillStyle = `rgba(6, 8, 11, ${shadowAlpha.toFixed(2)})`;
    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const iso = worldToIso(gx + 0.5, gy + 0.5, 0);
        const sx = Math.round(originX + iso.sx);
        const sy = Math.round(originY + iso.sy);
        if (sx < -32 || sx > vPw + 32 || sy < -32 || sy > vPh + 32) {
          continue;
        }
        const cell = this.getCell(gx, gy);
        if (cell.prop === 'none') continue;
        if (
          cell.prop === 'wall_brick' ||
          cell.prop === 'wall_wood' ||
          cell.prop === 'wall_interior' ||
          cell.prop === 'door'
        ) {
          const door = cell.prop === 'door' ? this.doorByTile.get(`${gx}_${gy}`) : null;
          if (door && door.status === 'open') continue;
          // Cast a 2:1 isometric parallelogram shadow to the SE (+sx, +sy)
          ctx.beginPath();
          ctx.moveTo(sx, sy + 7);
          ctx.lineTo(sx + 16, sy - 1);
          ctx.lineTo(sx + 23, sy + 3);
          ctx.lineTo(sx + 7, sy + 11);
          ctx.closePath();
          ctx.fill();
        } else if (cell.prop === 'tree_pine' || cell.prop === 'tree_dead') {
          ctx.beginPath();
          ctx.ellipse(sx + 6, sy + 3, 11, 5.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Pass 2: Ground decals (projected in 2:1 isometric aspect), fire/acid patches, sound ripples, fishing bobber, target highlight
    for (const d of this.decals) {
      const iso = worldToIso(d.x, d.y, 0);
      const sx = Math.round(originX + iso.sx);
      const sy = Math.round(originY + iso.sy);
      ctx.globalAlpha = d.alpha;
      if (d.kind === 'tire') {
        ctx.fillStyle = '#131618';
        // 2:1 isometric diagonal skid tracks
        ctx.fillRect(sx - 4, sy - 1, 4, 1);
        ctx.fillRect(sx - 2, sy, 4, 1);
        ctx.fillRect(sx + 1, sy + 1, 4, 1);
      } else {
        ctx.fillStyle = d.kind === 'blood' ? '#6e1919' : d.kind === 'acid' ? '#4fb848' : '#1b1d1f';
        // 2:1 isometric diamond/ellipse splatter
        ctx.fillRect(sx - 5, sy - 1, 10, 2);
        ctx.fillRect(sx - 3, sy - 2, 6, 4);
        if (d.variant > 0) {
          ctx.fillStyle = d.kind === 'blood' ? '#4a0f0f' : d.kind === 'acid' ? '#85e655' : '#101214';
          ctx.fillRect(sx - 2 + d.variant, sy - 1, 3, 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    for (const fp of this.firePatches) {
      const iso = worldToIso(fp.x, fp.y, 0);
      const sx = Math.round(originX + iso.sx);
      const sy = Math.round(originY + iso.sy);
      const rx = Math.round(fp.radius * 14);
      const ry = Math.round(fp.radius * 7);
      ctx.globalAlpha = Math.min(0.45, fp.life * 0.2);
      ctx.fillStyle = fp.kind === 'fire' ? '#f57e20' : '#4ee674';
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Subtle 2:1 isometric diamond highlight on the nearest interactive tile (door, loot container, or bed)
    if (this.phase === 'playing' && this.activeVehicleId === null && !this.player.buildMode) {
      const nearLoot = this.findNearestLootable();
      const nearDoor = !nearLoot ? this.findNearestDoor() : null;
      const nearBed = !nearLoot && !nearDoor ? this.findNearestBed() : null;
      const tgx = nearLoot ? nearLoot.gx : nearDoor ? nearDoor.gx : nearBed ? nearBed.gx : null;
      const tgy = nearLoot ? nearLoot.gy : nearDoor ? nearDoor.gy : nearBed ? nearBed.gy : null;
      if (tgx !== null && tgy !== null) {
        const tIso = worldToIso(tgx + 0.5, tgy + 0.5, 0);
        const tx = Math.round(originX + tIso.sx);
        const ty = Math.round(originY + tIso.sy);
        ctx.strokeStyle = 'rgba(240, 208, 120, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx, ty - 8);
        ctx.lineTo(tx + 16, ty);
        ctx.lineTo(tx, ty + 8);
        ctx.lineTo(tx - 16, ty);
        ctx.closePath();
        ctx.stroke();
      }
    }

    for (const sr of this.soundRipples) {
      const iso = worldToIso(sr.x, sr.y, 0);
      const sx = Math.round(originX + iso.sx);
      const sy = Math.round(originY + iso.sy);
      ctx.strokeStyle = sr.color;
      ctx.globalAlpha = sr.alpha;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(sx, sy, sr.radius * 14, sr.radius * 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Fishing line, ripples & bobber on water
    if (this.fishing.phase !== 'idle') {
      const bIso = worldToIso(this.fishing.bobberX, this.fishing.bobberY, 0);
      const bx = Math.round(originX + bIso.sx);
      const by = Math.round(originY + bIso.sy);
      const pIso = worldToIso(this.player.x, this.player.y, 0.55);
      const px = Math.round(originX + pIso.sx + 4);
      const py = Math.round(originY + pIso.sy - 6);

      // Expanding water ripples
      const rip = (this.fishing.ripplePhase * 1.4) % 1;
      ctx.strokeStyle = this.fishing.phase === 'bite' ? '#ffd266' : 'rgba(138, 212, 235, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(bx, by, 3 + rip * 9, 1.5 + rip * 4.5, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Fishing rod + taut line
      ctx.strokeStyle = '#6e4d30';
      ctx.beginPath();
      ctx.moveTo(px - 2, py + 4);
      ctx.lineTo(px + 5, py - 4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(225, 235, 240, 0.72)';
      ctx.beginPath();
      ctx.moveTo(px + 5, py - 4);
      ctx.lineTo(bx, by - (this.fishing.phase === 'bite' ? 0 : 1));
      ctx.stroke();

      // Pixel bobber (dips & pulses on bite!)
      const bobDip = this.fishing.phase === 'bite' ? Math.sin(this.elapsedClock * 26) * 2 + 1 : Math.sin(this.elapsedClock * 4);
      ctx.fillStyle = this.fishing.phase === 'bite' ? '#ffd266' : '#e0483e';
      ctx.fillRect(bx - 1, Math.round(by - 2 + bobDip), 3, 2);
      ctx.fillStyle = '#f0ece1';
      ctx.fillRect(bx - 1, Math.round(by - 3 + bobDip), 3, 1);
    }

    if (this.phase === 'playing' && this.player.buildMode) {
      const { gx, gy } = getBuildTargetTile(
        this.player.x,
        this.player.y,
        this.player.facingAngle,
        this.mouseWorldX,
        this.mouseWorldY,
        this.usingVirtualAim
      );
      const valid =
        canPlaceStructureAt(this.worldStore, this.structures, gx, gy, this.player.x, this.player.y) &&
        canAffordCost(this.inventory, STRUCTURES[this.player.buildMode].cost);
      const iso = worldToIso(gx + 0.5, gy + 0.5, 0);
      const cx = Math.round(originX + iso.sx);
      const cy = Math.round(originY + iso.sy);
      ctx.strokeStyle = valid ? '#5ef28f' : '#eb4d4b';
      ctx.fillStyle = valid ? 'rgba(94, 242, 143, 0.22)' : 'rgba(235, 77, 75, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx + 16, cy);
      ctx.lineTo(cx, cy + 8);
      ctx.lineTo(cx - 16, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (this.phase === 'playing' && this.player.equippedWeapon === 'molotov') {
      // Subtle Molotov landing blast-radius preview reticle
      const spec = WEAPONS.molotov;
      const tx = this.usingVirtualAim
        ? this.player.x + Math.cos(this.player.facingAngle) * 4.5
        : clamp(this.mouseWorldX, this.player.x - spec.range, this.player.x + spec.range);
      const ty = this.usingVirtualAim
        ? this.player.y + Math.sin(this.player.facingAngle) * 4.5
        : clamp(this.mouseWorldY, this.player.y - spec.range, this.player.y + spec.range);
      const iso = worldToIso(tx, ty, 0);
      const cx = Math.round(originX + iso.sx);
      const cy = Math.round(originY + iso.sy);
      ctx.strokeStyle = 'rgba(245, 142, 43, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 24, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Pass 3: Depth-Sorted Isometric Entities (Props, Doors, Structures, Loot Drops, Player, Zombies, Projectiles)
    const renderList: Array<{ depth: number; draw: () => void }> = [];
    const containerByTile = new Map<string, LootContainer>();
    for (const c of this.containers) {
      if (c.kind !== 'zombie_drop') {
        containerByTile.set(`${c.gx}_${c.gy}`, c);
      }
    }

    // Static props, connected walls, swingable doors & loot containers
    const glintPulse = 0.55 + Math.sin(this.elapsedClock * 5) * 0.35;
    const animFrame = Math.floor(this.elapsedClock * 8);
    const isWallProp = (gx: number, gy: number) => {
      const p = this.getCell(gx, gy).prop;
      return p === 'wall_brick' || p === 'wall_wood' || p === 'wall_interior' || p === 'door';
    };

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const preIso = worldToIso(gx + 0.5, gy + 0.5, 0);
        const preX = originX + preIso.sx;
        const preY = originY + preIso.sy;
        if (preX < -42 || preX > vPw + 42 || preY < -36 || preY > vPh + 56) {
          continue;
        }
        const cell = this.getCell(gx, gy);
        if (cell.prop === 'none') continue;

        if (cell.prop === 'door') {
          const door = this.doorByTile.get(`${gx}_${gy}`);
          if (!door) continue;
          const sprite = this.atlas.getDoor(door.orientation, door.status);
          const iso = worldToIso(gx + 0.5, gy + 0.5, 0);
          const swingSlideX = door.openProgress * (door.orientation === 'ew' ? 3 : -2);
          const swingSlideY = door.openProgress * -1;
          const px = Math.round(originX + iso.sx - sprite.width * 0.5 + swingSlideX);
          const py = Math.round(originY + iso.sy - (sprite.height - 10) + swingSlideY);
          renderList.push({
            depth: gx + gy + 0.92,
            draw: () => {
              ctx.drawImage(sprite, px, py);
              if (door.hitFlash > 0) {
                ctx.fillStyle = 'rgba(255, 220, 160, 0.45)';
                ctx.fillRect(px + 8, py + 8, 16, 18);
              }
              if (door.status === 'locked' && door.lockpickProgress > 0) {
                ctx.fillStyle = '#121518';
                ctx.fillRect(Math.round(originX + iso.sx - 8), py - 3, 16, 3);
                ctx.fillStyle = '#ffd266';
                ctx.fillRect(Math.round(originX + iso.sx - 7), py - 2, Math.round(14 * door.lockpickProgress), 1);
              }
            },
          });
          continue;
        }

        let sprite: HTMLCanvasElement | undefined;
        let isWall = false;
        const container = containerByTile.get(`${gx}_${gy}`);
        if (cell.prop === 'wall_brick' || cell.prop === 'wall_wood' || cell.prop === 'wall_interior') {
          isWall = true;
          const mask =
            (isWallProp(gx, gy - 1) ? 1 : 0) |
            (isWallProp(gx + 1, gy) ? 2 : 0) |
            (isWallProp(gx, gy + 1) ? 4 : 0) |
            (isWallProp(gx - 1, gy) ? 8 : 0);
          sprite = this.atlas.getWall(cell.prop, mask, cell.variant);
        } else {
          const isSearched = container ? container.searched : false;
          const openStage = container ? getLootOpenStage(container.searched, container.openAnim ?? 0) : undefined;
          sprite = this.atlas.getProp(cell.prop, isSearched, animFrame, openStage);
        }

        if (!sprite) continue;
        const iso = worldToIso(gx + 0.5, gy + 0.5, 0);
        const anchorX = Math.round(originX + iso.sx);
        const anchorY = Math.round(originY + iso.sy);
        const px = Math.round(anchorX - sprite.width * 0.5);
        // Align each sprite's visual base anchor directly onto tile center (gx + 0.5, gy + 0.5)
        let baseOffsetY = 26; // buildIsoObjectSprite & buildLootContainerSprite (34x38, ground center at y=26)
        if (isWall) baseOffsetY = sprite.height - 10; // wall south corner meets iso.sy + 8
        else if (cell.prop === 'barrel_burn') baseOffsetY = 24;
        else if (cell.prop === 'streetlamp') baseOffsetY = 40;
        else if (cell.prop === 'tree_pine' || cell.prop === 'tree_dead') baseOffsetY = 42;
        const py = Math.round(anchorY - baseOffsetY);
        const occludesPlayer =
          isWall &&
          this.phase !== 'title' &&
          gx + gy > this.player.x + this.player.y + 0.15 &&
          Math.abs(gx + 0.5 - this.player.x) < 2.2 &&
          Math.abs(gy + 0.5 - this.player.y) < 2.2;
        const occludesTallProp =
          !isWall &&
          (cell.prop === 'bookshelf' || cell.prop === 'fridge') &&
          this.phase !== 'title' &&
          gx + gy > this.player.x + this.player.y + 0.25 &&
          Math.abs(gx + 0.5 - this.player.x) < 1.35 &&
          Math.abs(gy + 0.5 - this.player.y) < 1.35;
        const popTransform =
          container && container.popTimer && container.popTimer > 0
            ? getLootPopTransform(container.popTimer)
            : null;

        renderList.push({
          depth: gx + gy + 1.0,
          draw: () => {
            if (occludesPlayer) ctx.globalAlpha = 0.42;
            else if (occludesTallProp) ctx.globalAlpha = 0.58;
            if (popTransform) {
              ctx.save();
              ctx.translate(anchorX, Math.round(anchorY + popTransform.offsetY));
              ctx.scale(popTransform.scaleX, popTransform.scaleY);
              ctx.drawImage(sprite, Math.round(-sprite.width * 0.5), -baseOffsetY);
              ctx.restore();
            } else {
              ctx.drawImage(sprite, px, py);
            }
            ctx.globalAlpha = 1;
            if (container && !container.searched && dist(this.player.x, this.player.y, gx + 0.5, gy + 0.5) < 8.5) {
              ctx.globalAlpha = glintPulse;
              ctx.fillStyle = '#f0d078';
              ctx.fillRect(anchorX - 1, py + 4, 2, 2);
              ctx.globalAlpha = 1;
            }
          },
        });
      }
    }

    // Drivable vehicles
    const sirenTick = Math.floor(this.elapsedClock * 7);
    for (const v of this.vehicles) {
      const sprite = this.atlas.getVehicle(
        v.kind,
        v.angle,
        Boolean(v.trunkSearched),
        v.sirenOn ? sirenTick % 2 : 0
      );
      const iso = worldToIso(v.x, v.y, 0);
      const px = Math.round(originX + iso.sx - sprite.width * 0.5);
      const py = Math.round(originY + iso.sy - sprite.height * 0.64);
      renderList.push({
        depth: v.x + v.y + 0.25,
        draw: () => {
          ctx.drawImage(sprite, px, py);
          if (v.hitFlash > 0) {
            ctx.fillStyle = 'rgba(255, 230, 190, 0.36)';
            ctx.fillRect(px + 10, py + 12, sprite.width - 20, sprite.height - 20);
          }
          if (!v.trunkSearched && this.activeVehicleId !== v.id && dist(this.player.x, this.player.y, v.x, v.y) < 8.5) {
            ctx.globalAlpha = glintPulse;
            ctx.fillStyle = '#f0d078';
            ctx.fillRect(Math.round(originX + iso.sx - 1), py + 2, 2, 2);
            ctx.globalAlpha = 1;
          }
        },
      });
    }

    // Zombie loot drops (animated 2:1 isometric scavenger pouch)
    const dropSprite = this.atlas.getLootDrop(Math.floor(this.elapsedClock * 5));
    for (const c of this.containers) {
      if (c.kind !== 'zombie_drop' || c.searched) continue;
      const iso = worldToIso(c.gx + 0.5, c.gy + 0.5, 0);
      const bobY = Math.round(Math.sin(this.elapsedClock * 4 + c.gx * 1.7 + c.gy) * 1.0);
      const sx = Math.round(originX + iso.sx - dropSprite.width * 0.5);
      const sy = Math.round(originY + iso.sy - 14 + bobY);
      renderList.push({
        depth: c.gx + c.gy + 0.3,
        draw: () => {
          ctx.drawImage(dropSprite, sx, sy);
        },
      });
    }

    // Player-built structures + Campfire (32x34 isometric voxel sprites anchored at y=23)
    for (const s of this.structures) {
      const sprite = this.atlas.getStructure(s.kind, animFrame);
      const iso = worldToIso(s.gx + 0.5, s.gy + 0.5, 0);
      const sx = Math.round(originX + iso.sx - sprite.width * 0.5);
      const sy = Math.round(originY + iso.sy - 23);
      renderList.push({
        depth: s.gx + s.gy + 1.0,
        draw: () => {
          ctx.drawImage(sprite, sx, sy);
          if (s.hitFlash > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fillRect(sx + 6, sy + 10, 20, 14);
          }
        },
      });
    }

    // Zombies (4-quadrant isometric orientation & multi-state sprite animations)
    for (const z of this.zombies) {
      const iso = worldToIso(z.x, z.y, 0);
      const sx = Math.round(originX + iso.sx);
      const sy = Math.round(originY + iso.sy);
      const screenDir = z.facingX - z.facingY >= 0;
      const facingUp = z.facingX + z.facingY < -0.15;
      const animState = resolveZombieAnimState({
        state: z.state,
        isMoving: z.state === 'chase' || z.state === 'wander' || z.state === 'alert',
      });
      const frame =
        animState === 'dying'
          ? getZombieDyingFrame(z.stateTimer, 0.52)
          : animState === 'windup'
            ? Math.floor(this.elapsedClock * 10) % 4
            : animState === 'attack'
              ? Math.min(2, Math.floor((1 - clamp(z.stateTimer / 0.14, 0, 1)) * 3))
              : animState === 'walk'
                ? Math.floor(z.walkCycle) % 8
                : Math.floor(this.elapsedClock * 3 + z.id) % 4;
      const sprite = this.atlas.getCharacter(z.archetype, frame, screenDir, facingUp, animState);

      renderList.push({
        depth: z.x + z.y,
        draw: () => {
          // Windup telegraph ground ring
          if (z.state === 'windup') {
            ctx.strokeStyle = z.archetype === 'spitter' ? '#5ef2b5' : '#ff4d42';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(sx, sy, 9, 4.5, 0, 0, Math.PI * 2);
            ctx.stroke();
          }

          ctx.save();
          ctx.translate(sx, sy + 2);
          if (z.state === 'dying') {
            ctx.globalAlpha = clamp(z.stateTimer / 0.22, 0, 1);
          }
          ctx.scale(z.scaleX, z.scaleY);
          const drawX = -Math.floor(sprite.width * 0.5);
          const drawY = -sprite.height + 2;
          ctx.drawImage(sprite, drawX, drawY);
          if (z.hitFlash > 0) {
            this.drawTintedSprite(ctx, sprite, drawX, drawY, 'rgba(255, 255, 255, 0.72)');
          }
          ctx.restore();

          // Tiny health bar if damaged
          if (z.hp < z.maxHp && z.state !== 'dying') {
            const bw = 14;
            const barY = sy - (z.archetype === 'bloater' ? 40 : 37);
            const pct = clamp(z.hp / z.maxHp, 0, 1);
            ctx.fillStyle = '#121518';
            ctx.fillRect(sx - 7, barY, bw, 3);
            ctx.fillStyle = '#d6453a';
            ctx.fillRect(sx - 6, barY + 1, Math.round((bw - 2) * pct), 1);
          }
        },
      });
    }

    // Survivor (Player) — multi-state animated sprite, hidden when seated inside a vehicle
    if (this.phase !== 'title' && this.activeVehicleId === null) {
      const p = this.player;
      const iso = worldToIso(p.x, p.y, 0);
      const sx = Math.round(originX + iso.sx);
      const sy = Math.round(originY + iso.sy);
      const aimVecX = Math.cos(p.facingAngle);
      const aimVecY = Math.sin(p.facingAngle);
      const facingRight = aimVecX - aimVecY >= 0;
      const facingUp = aimVecX + aimVecY < -0.15;
      const animState = resolvePlayerAnimState({
        dodgeTimer: p.dodgeTimer,
        meleeSwingTimer: p.meleeSwingTimer,
        attackCooldown: p.attackCooldown,
        attackCooldownMax: WEAPONS[p.equippedWeapon].cooldown,
        walkCycle: p.walkCycle,
      });
      const frame =
        animState === 'dodge'
          ? Math.floor((1 - clamp(p.dodgeTimer / 0.22, 0, 1)) * 2)
          : animState === 'attack'
            ? p.meleeSwingTimer > 0
              ? Math.min(2, Math.floor((1 - clamp(p.meleeSwingTimer / 0.22, 0, 1)) * 3))
              : 1
            : animState === 'walk'
              ? Math.floor(p.walkCycle) % 8
              : Math.floor(this.elapsedClock * 3.5) % 4;
      const sprite = this.atlas.getCharacter('player', frame, facingRight, facingUp, animState);
      const weaponSprite = this.atlas.getWeaponSprite(p.equippedWeapon);
      let action = this.actionVisual;
      if (this.fishing.phase !== 'idle') {
        const casting = this.fishing.phase === 'casting';
        action = {
          kind: casting ? 'cast' : 'fish',
          label: casting ? 'CASTING' : this.fishing.phase === 'bite' ? 'REEL NOW' : 'FISHING',
          duration: casting ? 0.32 : 1,
          remaining: casting ? this.fishing.timer : 1 - (this.elapsedClock % 1),
        };
      } else if (p.reloadingTimer > 0 && p.reloadingWeapon) {
        action = {
          kind: 'reload',
          label: 'RELOADING',
          duration: WEAPONS[p.reloadingWeapon].reloadTime,
          remaining: p.reloadingTimer,
        };
      }

      renderList.push({
        depth: p.x + p.y,
        draw: () => {
          // True 2:1 Isometric projected melee crescent slash ribbon in world space
          if (p.meleeSwingTimer > 0) {
            const prog = 1 - clamp(p.meleeSwingTimer / 0.22, 0, 1);
            const startAng = p.facingAngle - 0.9;
            const endAng = p.facingAngle - 0.9 + 1.8 * clamp(prog * 1.35, 0.25, 1);
            const steps = 8;
            ctx.save();
            ctx.strokeStyle = 'rgba(242, 238, 226, 0.85)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
              const a = startAng + ((endAng - startAng) * i) / steps;
              const sPt = worldToIso(p.x + Math.cos(a) * 1.18, p.y + Math.sin(a) * 1.18, 0.42);
              const pxArc = originX + sPt.sx;
              const pyArc = originY + sPt.sy;
              if (i === 0) ctx.moveTo(pxArc, pyArc);
              else ctx.lineTo(pxArc, pyArc);
            }
            ctx.stroke();

            ctx.strokeStyle = 'rgba(235, 87, 87, 0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
              const a = startAng + ((endAng - startAng) * i) / steps;
              const sPt = worldToIso(p.x + Math.cos(a) * 0.92, p.y + Math.sin(a) * 0.92, 0.38);
              const pxArc = originX + sPt.sx;
              const pyArc = originY + sPt.sy;
              if (i === 0) ctx.moveTo(pxArc, pyArc);
              else ctx.lineTo(pxArc, pyArc);
            }
            ctx.stroke();
            ctx.restore();
          }

          ctx.save();
          ctx.translate(sx, sy + 2 + (action ? Math.round(Math.sin(this.elapsedClock * 12)) : 0));
          ctx.scale(p.scaleX, p.scaleY);

          const drawHeldWeapon = () => {
            if (animState === 'dodge') return;
            const screenAimAngle = Math.atan2((aimVecX + aimVecY) * 0.5, aimVecX - aimVecY);
            const swingRot =
              p.meleeSwingTimer > 0
                ? Math.sin((1 - p.meleeSwingTimer / 0.22) * Math.PI) * (facingRight ? 0.95 : -0.95)
                : 0;
            ctx.save();
            ctx.translate(facingRight ? 4 : -4, facingUp ? -16 : -14);
            ctx.rotate(
              (facingRight ? screenAimAngle * 0.55 : screenAimAngle * 0.55 - Math.PI * 0.15) + swingRot
            );
            ctx.drawImage(weaponSprite, facingRight ? -4 : -16, -10);
            if (this.muzzleFlashTimer > 0 && (p.equippedWeapon === 'pistol' || p.equippedWeapon === 'shotgun')) {
              const fx = facingRight ? 13 : -17;
              ctx.fillStyle = '#fff3b0';
              ctx.fillRect(fx, -3, 4, 3);
              ctx.fillStyle = '#ff982b';
              ctx.fillRect(fx + (facingRight ? 3 : -2), -2, 3, 2);
            }
            ctx.restore();
          };

          const pDrawX = -Math.floor(sprite.width * 0.5);
          const pDrawY = -sprite.height + 2;

          // Layer weapon behind torso when facing NE/NW away from camera, in front when facing SE/SW
          if (facingUp) {
            if (!action) drawHeldWeapon();
            ctx.drawImage(sprite, pDrawX, pDrawY);
          } else {
            ctx.drawImage(sprite, pDrawX, pDrawY);
            if (!action) drawHeldWeapon();
          }
          if (action) drawActionProp(ctx, action, facingRight);

          if (p.hitFlash > 0) {
            this.drawTintedSprite(ctx, sprite, pDrawX, pDrawY, 'rgba(255, 86, 76, 0.58)');
          }
          ctx.restore();

          if (action) {
            ctx.save();
            ctx.font = '7px monospace';
            ctx.textAlign = 'center';
            const w = ctx.measureText(action.label).width + 10;
            ctx.fillStyle = '#10271cdd';
            ctx.fillRect(Math.round(sx - w / 2), sy - 52, w, 12);
            ctx.fillStyle = '#e6dfad';
            ctx.fillText(action.label, sx, sy - 43);
            ctx.restore();
          }
          // Diegetic reload progress bar right above survivor
          if (p.reloadingTimer > 0 && p.reloadingWeapon) {
            const total = WEAPONS[p.reloadingWeapon].reloadTime || 1;
            const prog = clamp(1 - p.reloadingTimer / total, 0, 1);
            ctx.fillStyle = '#121518';
            ctx.fillRect(sx - 9, sy - 39, 18, 3);
            ctx.fillStyle = '#e8a849';
            ctx.fillRect(sx - 8, sy - 38, Math.round(16 * prog), 1);
          }
        },
      });
    }

    // Projectiles
    for (const pr of this.projectiles) {
      const iso = worldToIso(pr.x, pr.y, pr.z);
      const sx = Math.round(originX + iso.sx);
      const sy = Math.round(originY + iso.sy);
      renderList.push({
        depth: pr.x + pr.y + 0.1,
        draw: () => {
          if (pr.kind === 'molotov') {
            ctx.fillStyle = '#5f8a4b';
            ctx.fillRect(sx - 2, sy - 2, 4, 4);
            ctx.fillStyle = '#ffae38';
            ctx.fillRect(sx - 1, sy - 4, 2, 2);
          } else if (pr.kind === 'acid') {
            ctx.fillStyle = '#5ef2b5';
            ctx.fillRect(sx - 2, sy - 2, 4, 4);
          } else {
            ctx.fillStyle = '#ffe58f';
            ctx.fillRect(sx - 1, sy - 1, 2, 2);
          }
        },
      });
    }

    renderList.sort((a, b) => a.depth - b.depth);
    for (const item of renderList) {
      item.draw();
    }

    // Pass 4: Pooled Particles & Floating Texts
    for (const pt of this.particles) {
      if (!pt.active) continue;
      const iso = worldToIso(pt.x, pt.y, pt.z);
      const sx = Math.round(originX + iso.sx);
      const sy = Math.round(originY + iso.sy);
      ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.fillRect(sx, sy, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    ctx.font = 'bold 7px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (const ft of this.floatingTexts) {
      const iso = worldToIso(ft.x, ft.y, ft.z);
      const sx = Math.round(originX + iso.sx);
      const sy = Math.round(originY + iso.sy);
      ctx.globalAlpha = clamp(ft.life / ft.maxLife, 0, 1);
      ctx.fillStyle = '#0d1012';
      ctx.fillText(ft.text, sx + 1, sy + 1);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, sx, sy);
    }
    ctx.globalAlpha = 1;

    // Drifting atmospheric ashfall particles in pixel viewport space
    const { darkness } = getDaylightInfo(this.timeMinutes);
    for (const ash of this.ambientAsh) {
      ctx.globalAlpha = ash.alpha * (0.65 + darkness * 0.5);
      ctx.fillStyle = '#b9b5ab';
      ctx.fillRect(Math.floor(ash.x * vPw), Math.floor(ash.y * vPh), ash.size, ash.size);
    }
    ctx.globalAlpha = 1;

    // Cozy sleep vignette & rising Zzz pixel feedback when resting in a bed
    if (this.sleepTransitionTimer > 0) {
      const restProg = clamp(1 - this.sleepTransitionTimer / 1.65, 0, 1);
      const restFade = Math.sin(restProg * Math.PI) * 0.52;
      ctx.fillStyle = `rgba(9, 12, 22, ${restFade.toFixed(3)})`;
      ctx.fillRect(0, 0, vPw, vPh);

      const pIso = worldToIso(this.player.x, this.player.y, 0.9);
      const zx = Math.round(originX + pIso.sx + 6);
      const zy = Math.round(originY + pIso.sy - 16 - restProg * 14);
      ctx.save();
      ctx.globalAlpha = Math.sin(restProg * Math.PI);
      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.fillStyle = '#0d1012';
      ctx.fillText('Z z z', zx + 1, zy + 1);
      ctx.fillStyle = '#a8e6cf';
      ctx.fillText('Z z z', zx, zy);
      ctx.restore();
    }

    ctx.restore();

    // Pass 5: Dynamic Day/Night Lighting, Headlights, Sirens & Burn Barrels
    this.renderLighting(originX, originY);

    // Pass 6: Crisp Tactical Crosshair & Hit-Marker Feedback
    if (this.phase === 'playing' && this.activeVehicleId === null && !this.usingVirtualAim) {
      const mx = Math.round(this.mouseScreenX);
      const my = Math.round(this.mouseScreenY);
      ctx.strokeStyle = this.hitMarkerTimer > 0 ? (this.hitMarkerCrit ? '#ffd266' : '#f0ece1') : 'rgba(240, 236, 225, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx - 7, my);
      ctx.lineTo(mx - 3, my);
      ctx.moveTo(mx + 3, my);
      ctx.lineTo(mx + 7, my);
      ctx.moveTo(mx, my - 7);
      ctx.lineTo(mx, my - 3);
      ctx.moveTo(mx, my + 3);
      ctx.lineTo(mx, my + 7);
      ctx.stroke();
      ctx.fillStyle = '#d9822b';
      ctx.fillRect(mx - 1, my - 1, 2, 2);
    }
    if (this.phase === 'playing' && this.hitMarkerTimer > 0) {
      const hx = this.usingVirtualAim ? Math.round(this.viewW * 0.5) : Math.round(this.mouseScreenX);
      const hy = this.usingVirtualAim ? Math.round(this.viewH * 0.5) : Math.round(this.mouseScreenY);
      ctx.strokeStyle = this.hitMarkerCrit ? '#ffd266' : '#eb4d4b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx - 10, hy - 10);
      ctx.lineTo(hx - 5, hy - 5);
      ctx.moveTo(hx + 10, hy - 10);
      ctx.lineTo(hx + 5, hy - 5);
      ctx.moveTo(hx - 10, hy + 10);
      ctx.lineTo(hx - 5, hy + 5);
      ctx.moveTo(hx + 10, hy + 10);
      ctx.lineTo(hx + 5, hy + 5);
      ctx.stroke();
    }

    // Pass 7: Tactical Minimap (throttled to ~8Hz for low CPU overhead)
    this.minimapTimer += this.lastFrameDt;
    if (this.minimapTimer >= 0.12) {
      this.minimapTimer = 0;
      this.renderMinimap();
    }
  }

  private drawTintedSprite(
    targetCtx: CanvasRenderingContext2D,
    sprite: HTMLCanvasElement,
    dx: number,
    dy: number,
    tint: string
  ): void {
    const fctx = this.flashCtx;
    const sw = sprite.width;
    const sh = sprite.height;
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, sw, sh);
    fctx.drawImage(sprite, 0, 0);
    fctx.globalCompositeOperation = 'source-atop';
    fctx.fillStyle = tint;
    fctx.fillRect(0, 0, sw, sh);
    targetCtx.drawImage(this.flashCanvas, 0, 0, sw, sh, dx, dy, sw, sh);
  }

  private renderLighting(originX: number, originY: number): void {
    const { darkness } = getDaylightInfo(this.timeMinutes);
    if (darkness <= 0.09) return;

    const lw = this.lightCanvas.width;
    const lh = this.lightCanvas.height;
    const lctx = this.lightCtx;

    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, lw, lh);
    lctx.fillStyle = `rgba(8, 12, 22, ${darkness.toFixed(2)})`;
    lctx.fillRect(0, 0, lw, lh);

    lctx.globalCompositeOperation = 'destination-out';

    const punchRadial = (wx: number, wy: number, radiusPx: number, strength = 1) => {
      const iso = worldToIso(wx, wy, 0.3);
      const cx = Math.round(originX + iso.sx);
      const cy = Math.round(originY + iso.sy);
      const grad = lctx.createRadialGradient(cx, cy, radiusPx * 0.15, cx, cy, radiusPx);
      grad.addColorStop(0, `rgba(0,0,0,${strength})`);
      grad.addColorStop(0.65, `rgba(0,0,0,${strength * 0.55})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = grad;
      lctx.beginPath();
      lctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
      lctx.fill();
    };

    // Campfire warm holes
    const flicker = Math.sin(this.elapsedClock * 11) * 4;
    for (const s of this.structures) {
      if (s.kind === 'campfire') {
        punchRadial(s.gx + 0.5, s.gy + 0.5, 92 + flicker, 0.95);
      }
    }

    // Visible streetlamps, burn barrels, pier lanterns & kitchen stoves
    const centerWorld = isoToWorld(this.camX, this.camY);
    const vLw = lw;
    const vLh = lh;
    const minGX = Math.floor(centerWorld.wx - 22);
    const maxGX = Math.ceil(centerWorld.wx + 22);
    const minGY = Math.floor(centerWorld.wy - 22);
    const maxGY = Math.ceil(centerWorld.wy + 22);
    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const preIso = worldToIso(gx + 0.5, gy + 0.5, 0.3);
        const preX = originX + preIso.sx;
        const preY = originY + preIso.sy;
        if (preX < -85 || preX > vLw + 85 || preY < -85 || preY > vLh + 85) continue;
        const prop = this.getCell(gx, gy).prop;
        if (prop === 'streetlamp') {
          punchRadial(gx + 0.5, gy + 0.5, 68 + flicker * 0.35, 0.78);
        } else if (prop === 'barrel_burn') {
          punchRadial(gx + 0.5, gy + 0.5, 74 + flicker * 0.6, 0.88);
        } else if (prop === 'fishing_post') {
          punchRadial(gx + 0.5, gy + 0.5, 64 + flicker * 0.3, 0.8);
        } else if (prop === 'stove') {
          punchRadial(gx + 0.5, gy + 0.5, 52 + flicker * 0.25, 0.65);
        }
      }
    }

    // Vehicle headlight cones
    for (const v of this.vehicles) {
      if (!v.headlightsOn || v.hp <= 0) continue;
      const vIso = worldToIso(v.x + Math.cos(v.angle) * 0.55, v.y + Math.sin(v.angle) * 0.55, 0.35);
      const fwdIso = worldToIso(v.x + Math.cos(v.angle) * 3.0, v.y + Math.sin(v.angle) * 3.0, 0);
      const vx = originX + vIso.sx;
      const vy = originY + vIso.sy;
      const beamAngle = Math.atan2(originY + fwdIso.sy - vy, originX + fwdIso.sx - vx);
      const beamLen = 215;
      const halfSpread = 0.32;
      const grad = lctx.createRadialGradient(vx, vy, 10, vx, vy, beamLen);
      grad.addColorStop(0, 'rgba(0,0,0,0.96)');
      grad.addColorStop(0.75, 'rgba(0,0,0,0.72)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = grad;
      lctx.beginPath();
      lctx.moveTo(vx, vy);
      lctx.arc(vx, vy, beamLen, beamAngle - halfSpread, beamAngle + halfSpread);
      lctx.closePath();
      lctx.fill();
    }

    // Molotov fire patches
    for (const fp of this.firePatches) {
      if (fp.kind === 'fire') {
        punchRadial(fp.x, fp.y, 75, 0.9);
      }
    }

    if (this.phase !== 'title' && this.activeVehicleId === null) {
      const p = this.player;
      punchRadial(p.x, p.y, 44, 0.85);

      // Flashlight beam follows the shared right-stick/mouse aim target
      if (p.flashlightOn && p.battery > 0) {
        const pIso = worldToIso(p.x, p.y, 0.45);
        const px = originX + pIso.sx;
        const py = originY + pIso.sy;
        const aimIso = worldToIso(this.mouseWorldX, this.mouseWorldY, 0);
        const ax = originX + aimIso.sx;
        const ay = originY + aimIso.sy;
        const screenAngle = Math.atan2(ay - py, ax - px);

        const beamLen = 185;
        const halfSpread = 0.36;
        const grad = lctx.createRadialGradient(px, py, 8, px, py, beamLen);
        grad.addColorStop(0, 'rgba(0,0,0,0.96)');
        grad.addColorStop(0.7, 'rgba(0,0,0,0.72)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        lctx.fillStyle = grad;
        lctx.beginPath();
        lctx.moveTo(px, py);
        lctx.arc(px, py, beamLen, screenAngle - halfSpread, screenAngle + halfSpread);
        lctx.closePath();
        lctx.fill();
      }
    }

    this.ctx.drawImage(this.lightCanvas, 0, 0, this.viewW, this.viewH);

    // Police cruiser siren atmospheric red/blue pulse
    const sirenPhase = Math.floor(this.elapsedClock * 7) % 2;
    for (const v of this.vehicles) {
      if (!v.sirenOn || v.hp <= 0) continue;
      const iso = worldToIso(v.x, v.y, 0.7);
      const sx = (originX + iso.sx) * PIXEL_SCALE;
      const sy = (originY + iso.sy) * PIXEL_SCALE;
      const rad = 110 * (PIXEL_SCALE / 3);
      const grad = this.ctx.createRadialGradient(sx, sy, 4, sx, sy, rad);
      grad.addColorStop(0, sirenPhase === 0 ? 'rgba(235, 58, 52, 0.36)' : 'rgba(54, 148, 255, 0.36)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      this.ctx.fillStyle = grad;
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      this.ctx.fill();
    }
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
          mctx.fillStyle = '#264f63';
        } else if (cell.tile === 'pier') {
          mctx.fillStyle = '#a67449';
        } else if (cell.prop === 'door') {
          mctx.fillStyle = '#c98842';
        } else if (cell.solid) {
          if (cell.prop === 'wall_interior') mctx.fillStyle = '#a69e8e';
          else if (cell.prop.startsWith('wall')) mctx.fillStyle = '#875548';
          else if (cell.prop === 'tree_pine' || cell.prop === 'tree_dead') mctx.fillStyle = '#2c3d29';
          else mctx.fillStyle = '#755b42';
        } else if (cell.tile === 'road' || cell.tile === 'crosswalk') {
          mctx.fillStyle = '#383d42';
        } else if (cell.tile === 'floor_rug') {
          mctx.fillStyle = '#75382e';
        } else if (cell.tile === 'floor_bath') {
          mctx.fillStyle = '#5f7e82';
        } else if (cell.tile === 'floor_porch') {
          mctx.fillStyle = '#6b4d34';
        } else if (cell.tile === 'floor' || cell.tile === 'tile_clinic' || cell.tile === 'tile_diner') {
          mctx.fillStyle = '#5c4a3d';
        } else {
          mctx.fillStyle = '#24301f';
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
      mctx.fillStyle = v.kind === 'police' ? '#4fa8ff' : '#c7d2d9';
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
        label: 'Rest in Bed (+40 HP · +3h)',
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
    });
  }
}

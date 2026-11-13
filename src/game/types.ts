export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type TileKind =
  | 'grass'
  | 'dirt'
  | 'road'
  | 'sidewalk'
  | 'floor'
  | 'floor_rug'
  | 'floor_bath'
  | 'floor_porch'
  | 'water'
  | 'pier'
  | 'crosswalk'
  | 'tile_clinic'
  | 'tile_diner';

export type PropKind =
  | 'none'
  | 'wall_brick'
  | 'wall_wood'
  | 'wall_interior'
  | 'door'
  | 'stove'
  | 'fishing_post'
  | 'tree_pine'
  | 'tree_dead'
  | 'car_sedan'
  | 'car_police'
  | 'crate_wood'
  | 'crate_military'
  | 'fridge'
  | 'med_cabinet'
  | 'barrel_burn'
  | 'streetlamp'
  | 'dumpster'
  | 'concrete_barrier'
  | 'bench'
  | 'hydrant'
  | 'counter'
  | 'bed'
  | 'couch'
  | 'table'
  | 'bookshelf'
  | 'desk'
  | 'sink_toilet'
  | 'tv_stand';

export type StructureKind = 'barricade' | 'spike_trap' | 'campfire';

export type WeaponId = 'crowbar' | 'pistol' | 'shotgun' | 'molotov';

export type ItemId =
  | 'wood'
  | 'scrap'
  | 'cloth'
  | 'fuel'
  | 'food'
  | 'water'
  | 'bandage'
  | 'ammo_9mm'
  | 'ammo_shell'
  | 'molotov'
  | 'raw_fish'
  | 'cooked_fish'
  | 'fish_stew'
  | 'hot_rations';

export type ConsumableItemId =
  | 'food'
  | 'water'
  | 'bandage'
  | 'raw_fish'
  | 'cooked_fish'
  | 'fish_stew'
  | 'hot_rations';

export type Inventory = Record<ItemId, number>;

export interface TileCell {
  gx: number;
  gy: number;
  tile: TileKind;
  prop: PropKind;
  solid: boolean;
  blocksSight: boolean;
  variant: number; // 0-3 deterministic visual variation
  explored: boolean;
}

export interface WorldChunk {
  cx: number;
  cy: number;
  key: string;
  cells: TileCell[][];
}

export interface WorldStore {
  seed: number;
  chunks: Map<string, WorldChunk>;
  populatedChunks: Set<string>;
}

export type DoorStatus = 'closed' | 'open' | 'locked' | 'barricaded';

export interface DoorEntity {
  id: string;
  gx: number;
  gy: number;
  orientation: 'ns' | 'ew';
  status: DoorStatus;
  openProgress: number; // 0 closed -> 1 swung open
  hp: number;
  maxHp: number;
  barricadeHp: number;
  maxBarricadeHp: number;
  lockpickProgress: number; // 0..1
  hitFlash: number;
}

export type FishingPhase = 'idle' | 'casting' | 'waiting' | 'bite' | 'reeling';

export interface FishingState {
  phase: FishingPhase;
  pierGX: number;
  pierGY: number;
  bobberX: number;
  bobberY: number;
  timer: number;
  biteDuration: number;
  biteElapsed: number;
  ripplePhase: number;
}

export interface Vehicle {
  id: number;
  kind: 'sedan' | 'police';
  x: number;
  y: number;
  angle: number; // world radians
  speed: number; // tiles/sec (can be negative in reverse)
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  fuel: number; // 0..100
  headlightsOn: boolean;
  sirenOn: boolean;
  hitFlash: number;
  drifting: boolean;
  boosting: boolean;
  trunkItems?: Partial<Inventory>;
  trunkSearched?: boolean;
}

export interface LootContainer {
  id: string;
  gx: number;
  gy: number;
  kind: 'crate_wood' | 'crate_military' | 'car_police' | 'car_sedan' | 'fridge' | 'med_cabinet' | 'zombie_drop';
  items: Partial<Inventory>;
  searched: boolean;
  searchProgress: number; // 0..1
  openAnim?: number; // 0 (closed) -> 1 (fully open) for animated sprite transition
  popTimer?: number; // brief bounce/glint timer when looted
}

export interface WorldStructure {
  id: string;
  gx: number;
  gy: number;
  kind: StructureKind;
  hp: number;
  maxHp: number;
  cooldown: number;
  hitFlash: number;
}

export type ZombieArchetype = 'walker' | 'runner' | 'bloater' | 'spitter';

export type ZombieAIState =
  | 'wander'
  | 'alert'
  | 'chase'
  | 'windup'
  | 'attack'
  | 'recover'
  | 'dying';

export interface Zombie {
  id: number;
  archetype: ZombieArchetype;
  x: number; // world tile units
  y: number;
  vx: number;
  vy: number;
  facingX: number;
  facingY: number;
  hp: number;
  maxHp: number;
  speed: number;
  state: ZombieAIState;
  stateTimer: number;
  wanderTargetX: number;
  wanderTargetY: number;
  lastHeardX: number | null;
  lastHeardY: number | null;
  walkCycle: number;
  hitFlash: number;
  bleedTimer: number;
  burnTimer: number;
  hasAttackToken: boolean;
  scaleX: number;
  scaleY: number;
  koRotation: number;
  variant: number;
}

export interface Projectile {
  id: number;
  kind: 'bullet' | 'pellet' | 'molotov' | 'acid';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  life: number;
  maxLife: number;
  targetX?: number;
  targetY?: number;
}

export interface FirePatch {
  id: number;
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  kind: 'fire' | 'acid';
  tickTimer: number;
}

export interface SoundRipple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
}

export interface FloatingText {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface BloodDecal {
  x: number;
  y: number;
  variant: number;
  alpha: number;
  kind: 'blood' | 'scorch' | 'acid' | 'tire';
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingAngle: number; // radians in world space
  hp: number;
  maxHp: number;
  hunger: number; // 0..100
  thirst: number; // 0..100
  bleeding: boolean;
  infected: boolean;
  equippedWeapon: WeaponId;
  pistolMag: number;
  pistolMagSize: number;
  shotgunMag: number;
  shotgunMagSize: number;
  reloadingTimer: number;
  reloadingWeapon: WeaponId | null;
  attackCooldown: number;
  meleeSwingTimer: number;
  dodgeTimer: number;
  dodgeCooldown: number;
  dodgeDirX: number;
  dodgeDirY: number;
  flashlightOn: boolean;
  battery: number; // 0..100
  walkCycle: number;
  stepAccumulator: number;
  hitFlash: number;
  invulnTimer: number;
  scaleX: number;
  scaleY: number;
  buildMode: StructureKind | null;
}

export interface CraftRecipe {
  id: string;
  name: string;
  description: string;
  category: 'structure' | 'medical' | 'combat' | 'cooking';
  cost: Partial<Inventory>;
  outputItem?: ItemId;
  outputAmount?: number;
  outputStructure?: StructureKind;
  requiresHeatSource?: boolean;
}

export interface NearbyActionPrompt {
  action: 'loot' | 'door' | 'fishing' | 'cook' | 'sleep';
  label: string;
  key: string;
  progress: number;
  secondaryLabel?: string;
  secondaryKey?: string;
}

export interface HudSnapshot {
  phase: GamePhase;
  hp: number;
  maxHp: number;
  hunger: number;
  thirst: number;
  bleeding: boolean;
  battery: number;
  flashlightOn: boolean;
  equippedWeapon: WeaponId;
  pistolMag: number;
  pistolMagSize: number;
  shotgunMag: number;
  shotgunMagSize: number;
  isReloading: boolean;
  reloadProgress: number;
  buildMode: StructureKind | null;
  inventory: Inventory;
  day: number;
  timeMinutes: number; // 0..1440
  timeLabel: string;
  dayPhaseLabel: 'DAWN' | 'DAYLIGHT' | 'DUSK' | 'NIGHTFALL';
  kills: number;
  score: number;
  bestScore: number;
  zombiesAlive: number;
  worldCoords: { gx: number; gy: number };
  nearCookingHeat: boolean;
  fishing: {
    phase: FishingPhase;
    biteProgress: number;
    canHook: boolean;
  } | null;
  nearbyPrompt: NearbyActionPrompt | null;
  nearbyDoorAction: { label: string; status: DoorStatus } | null;
  nearbyVehiclePrompt: {
    label: string;
    canDrive: boolean;
    canRepair: boolean;
    hpPct: number;
    scrapCost: number;
  } | null;
  drivingVehicle: {
    kind: 'sedan' | 'police';
    speedKmh: number;
    fuel: number;
    hp: number;
    maxHp: number;
    headlightsOn: boolean;
    sirenOn: boolean;
    boosting: boolean;
    canRepair: boolean;
    repairCost: number;
  } | null;
  statusBanner: string | null;
}

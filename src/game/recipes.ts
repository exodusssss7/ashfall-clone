import type { CraftRecipe, ItemId, StructureKind, WeaponId, ZombieArchetype } from './types';

export interface ItemMeta {
  id: ItemId;
  name: string;
  short: string;
  color: string;
  consumable?: boolean;
}

export const ITEMS: Record<ItemId, ItemMeta> = {
  wood: { id: 'wood', name: 'Timber Planks', short: 'Wood', color: '#a67449' },
  scrap: { id: 'scrap', name: 'Scrap Metal', short: 'Scrap', color: '#8f9ba3' },
  cloth: { id: 'cloth', name: 'Clean Rags', short: 'Cloth', color: '#d4cfc4' },
  fuel: { id: 'fuel', name: 'Gasoline Can', short: 'Fuel', color: '#d4513b' },
  food: { id: 'food', name: 'Canned Rations', short: 'Food', color: '#d99b38', consumable: true },
  water: { id: 'water', name: 'Purified Water', short: 'Water', color: '#4ea2d4', consumable: true },
  bandage: { id: 'bandage', name: 'Field Bandage', short: 'Bandage', color: '#e6e2d8', consumable: true },
  ammo_9mm: { id: 'ammo_9mm', name: '9mm Rounds', short: '9mm', color: '#e0bd5e' },
  ammo_shell: { id: 'ammo_shell', name: '12G Shells', short: 'Shells', color: '#c44b42' },
  molotov: { id: 'molotov', name: 'Molotov Bottle', short: 'Molotov', color: '#eb7a2d' },
  raw_fish: { id: 'raw_fish', name: 'Raw Lake Fish', short: 'Raw Fish', color: '#7ea8b8', consumable: true },
  cooked_fish: { id: 'cooked_fish', name: 'Grilled Fish', short: 'Grilled Fish', color: '#e8a258', consumable: true },
  fish_stew: { id: 'fish_stew', name: 'Hearty Fish Stew', short: 'Fish Stew', color: '#f0b849', consumable: true },
  hot_rations: { id: 'hot_rations', name: 'Hot Rations', short: 'Hot Meal', color: '#e07b39', consumable: true },
};

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  role: string;
  key: string;
  damage: number;
  cooldown: number;
  noiseRadius: number;
  range: number;
  spreadRad: number;
  pellets: number;
  reloadTime: number;
  ammoItem?: ItemId;
  isMelee?: boolean;
  knockback?: number;
  critChance?: number;
  bleedDuration?: number;
  swingDuration?: number;
  doorLockProgress?: number;
  hitstop?: number;
  trauma?: number;
  arcColor?: number;
}

export const MELEE_WEAPON_IDS: readonly WeaponId[] = [
  'crowbar',
  'machete',
  'barbed_bat',
  'axe',
  'sledgehammer',
];

export function isMeleeWeapon(id: WeaponId): boolean {
  return (
    id === 'crowbar' ||
    id === 'machete' ||
    id === 'barbed_bat' ||
    id === 'axe' ||
    id === 'sledgehammer'
  );
}

export function cycleMeleeWeapon(current: WeaponId): WeaponId {
  const idx = MELEE_WEAPON_IDS.indexOf(current);
  if (idx === -1) return MELEE_WEAPON_IDS[0];
  return MELEE_WEAPON_IDS[(idx + 1) % MELEE_WEAPON_IDS.length];
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  crowbar: {
    id: 'crowbar',
    name: 'Crowbar',
    role: 'Balanced Melee · Lock Pry',
    key: '1',
    damage: 34,
    cooldown: 0.42,
    noiseRadius: 2.8,
    range: 1.85,
    spreadRad: 1.05,
    pellets: 1,
    reloadTime: 0,
    isMelee: true,
    knockback: 3.8,
    critChance: 0.2,
    bleedDuration: 0,
    swingDuration: 0.26,
    doorLockProgress: 0.55,
    hitstop: 0.045,
    trauma: 0.26,
    arcColor: 0xf2eee2,
  },
  machete: {
    id: 'machete',
    name: 'Machete',
    role: 'Fast Slash · Deep Bleed',
    key: '8',
    damage: 28,
    cooldown: 0.27,
    noiseRadius: 2.2,
    range: 1.75,
    spreadRad: 1.2,
    pellets: 1,
    reloadTime: 0,
    isMelee: true,
    knockback: 2.2,
    critChance: 0.24,
    bleedDuration: 4.0,
    swingDuration: 0.22,
    doorLockProgress: 0.2,
    hitstop: 0.032,
    trauma: 0.18,
    arcColor: 0xd9e8f5,
  },
  barbed_bat: {
    id: 'barbed_bat',
    name: 'Barbed Bat',
    role: 'Heavy Knockback · Bleed',
    key: '9',
    damage: 44,
    cooldown: 0.5,
    noiseRadius: 3.4,
    range: 2.05,
    spreadRad: 1.12,
    pellets: 1,
    reloadTime: 0,
    isMelee: true,
    knockback: 5.2,
    critChance: 0.22,
    bleedDuration: 2.8,
    swingDuration: 0.3,
    doorLockProgress: 0.35,
    hitstop: 0.055,
    trauma: 0.32,
    arcColor: 0xf0c988,
  },
  axe: {
    id: 'axe',
    name: 'Fire Axe',
    role: 'High Cleave · Chops Doors',
    key: '0',
    damage: 60,
    cooldown: 0.64,
    noiseRadius: 4.0,
    range: 2.15,
    spreadRad: 1.18,
    pellets: 1,
    reloadTime: 0,
    isMelee: true,
    knockback: 4.8,
    critChance: 0.25,
    bleedDuration: 1.8,
    swingDuration: 0.34,
    doorLockProgress: 0.6,
    hitstop: 0.065,
    trauma: 0.38,
    arcColor: 0xf0937a,
  },
  sledgehammer: {
    id: 'sledgehammer',
    name: 'Sledgehammer',
    role: 'Crushing Blow · Massive KB',
    key: '-',
    damage: 82,
    cooldown: 0.88,
    noiseRadius: 5.2,
    range: 2.3,
    spreadRad: 1.28,
    pellets: 1,
    reloadTime: 0,
    isMelee: true,
    knockback: 8.5,
    critChance: 0.18,
    bleedDuration: 0,
    swingDuration: 0.4,
    doorLockProgress: 1.0,
    hitstop: 0.085,
    trauma: 0.48,
    arcColor: 0xffd266,
  },
  pistol: {
    id: 'pistol',
    name: '9mm Pistol',
    role: 'Accurate Sidearm · Medium Noise',
    key: '2',
    damage: 42,
    cooldown: 0.28,
    noiseRadius: 11.5,
    range: 14,
    spreadRad: 0.05,
    pellets: 1,
    reloadTime: 1.15,
    ammoItem: 'ammo_9mm',
  },
  shotgun: {
    id: 'shotgun',
    name: 'Pump Shotgun',
    role: 'Heavy Spread · Loud Blast',
    key: '3',
    damage: 24,
    cooldown: 0.85,
    noiseRadius: 19.0,
    range: 9.5,
    spreadRad: 0.34,
    pellets: 6,
    reloadTime: 1.7,
    ammoItem: 'ammo_shell',
  },
  lmg: {
    id: 'lmg',
    name: 'M60 LMG',
    role: 'Full-Auto Rifle · Infinite Ammo',
    key: '5',
    damage: 18,
    cooldown: 0.09,
    noiseRadius: 14.5,
    range: 13,
    spreadRad: 0.1,
    pellets: 1,
    reloadTime: 0,
  },
  molotov: {
    id: 'molotov',
    name: 'Molotov',
    role: 'Area Fire · Burns Hordes',
    key: '4',
    damage: 28,
    cooldown: 0.8,
    noiseRadius: 9.5,
    range: 8.5,
    spreadRad: 0,
    pellets: 1,
    reloadTime: 0,
    ammoItem: 'molotov',
  },
};

export interface StructureSpec {
  kind: StructureKind;
  name: string;
  role: string;
  maxHp: number;
  cost: Partial<Record<ItemId, number>>;
}

export const STRUCTURES: Record<StructureKind, StructureSpec> = {
  barricade: {
    kind: 'barricade',
    name: 'Wooden Barricade',
    role: 'Blocks Zombies · 220 HP',
    maxHp: 220,
    cost: { wood: 3, scrap: 1 },
  },
  spike_trap: {
    kind: 'spike_trap',
    name: 'Spike Trap',
    role: 'Impales & Bleeds Walkers',
    maxHp: 140,
    cost: { wood: 2, scrap: 2 },
  },
  campfire: {
    kind: 'campfire',
    name: 'Campfire',
    role: 'Safe Light & Night Warmth',
    maxHp: 120,
    cost: { wood: 3, cloth: 1 },
  },
};

export const CRAFT_RECIPES: CraftRecipe[] = [
  {
    id: 'craft_bandage',
    name: 'Field Bandage',
    description: 'Stops bleeding and restores +35 HP.',
    category: 'medical',
    cost: { cloth: 2 },
    outputItem: 'bandage',
    outputAmount: 1,
  },
  {
    id: 'craft_molotov',
    name: 'Molotov Cocktail',
    description: 'Throwable firebomb for clearing crowds.',
    category: 'combat',
    cost: { fuel: 1, cloth: 1 },
    outputItem: 'molotov',
    outputAmount: 1,
  },
  {
    id: 'craft_9mm',
    name: 'Handload 9mm (x6)',
    description: 'Presses 6 pistol rounds from scrap & fuel.',
    category: 'combat',
    cost: { scrap: 3, fuel: 1 },
    outputItem: 'ammo_9mm',
    outputAmount: 6,
  },
  {
    id: 'craft_shells',
    name: '12G Shells (x4)',
    description: 'Packs 4 heavy buckshot shells.',
    category: 'combat',
    cost: { scrap: 4, fuel: 1 },
    outputItem: 'ammo_shell',
    outputAmount: 4,
  },
  {
    id: 'craft_barricade',
    name: 'Wooden Barricade',
    description: 'Heavy defensive wall that blocks zombie paths.',
    category: 'structure',
    cost: { wood: 3, scrap: 1 },
    outputStructure: 'barricade',
  },
  {
    id: 'craft_spikes',
    name: 'Spike Trap',
    description: 'Floor trap that slices and slows passing zombies.',
    category: 'structure',
    cost: { wood: 2, scrap: 2 },
    outputStructure: 'spike_trap',
  },
  {
    id: 'craft_campfire',
    name: 'Campfire',
    description: 'Illuminates darkness, warms the survivor, and cooks food.',
    category: 'structure',
    cost: { wood: 3, cloth: 1 },
    outputStructure: 'campfire',
  },
];

export const COOK_RECIPES: CraftRecipe[] = [
  {
    id: 'cook_grilled_fish',
    name: 'Grilled Fish',
    description: 'Seared lake catch (+42 Food · +14 HP).',
    category: 'cooking',
    cost: { raw_fish: 1 },
    outputItem: 'cooked_fish',
    outputAmount: 1,
    requiresHeatSource: true,
  },
  {
    id: 'cook_fish_stew',
    name: 'Hearty Fish Stew',
    description: 'Restorative hot pot (+58 Food · +40 H2O · +24 HP).',
    category: 'cooking',
    cost: { raw_fish: 1, water: 1 },
    outputItem: 'fish_stew',
    outputAmount: 1,
    requiresHeatSource: true,
  },
  {
    id: 'cook_hot_rations',
    name: 'Hot Rations',
    description: 'Warmed canned meal (+48 Food · +12 HP).',
    category: 'cooking',
    cost: { food: 1 },
    outputItem: 'hot_rations',
    outputAmount: 1,
    requiresHeatSource: true,
  },
  {
    id: 'cook_boil_water',
    name: 'Boil Clean Water',
    description: 'Purifies 1 bottle of clean drinking water using timber.',
    category: 'cooking',
    cost: { wood: 1 },
    outputItem: 'water',
    outputAmount: 1,
    requiresHeatSource: true,
  },
];

export interface ZombieConfig {
  archetype: ZombieArchetype;
  label: string;
  hp: number;
  speed: number;
  damage: number;
  attackRange: number;
  windupTime: number;
  sightRange: number;
  scoreValue: number;
}

export const ZOMBIE_CONFIGS: Record<ZombieArchetype, ZombieConfig> = {
  walker: {
    archetype: 'walker',
    label: 'Walker',
    hp: 75,
    speed: 1.55,
    damage: 14,
    attackRange: 1.05,
    windupTime: 0.42,
    sightRange: 7.5,
    scoreValue: 25,
  },
  runner: {
    archetype: 'runner',
    label: 'Feral Runner',
    hp: 52,
    speed: 3.15,
    damage: 18,
    attackRange: 1.0,
    windupTime: 0.30,
    sightRange: 9.5,
    scoreValue: 45,
  },
  bloater: {
    archetype: 'bloater',
    label: 'Gas Bloater',
    hp: 195,
    speed: 1.05,
    damage: 24,
    attackRange: 1.25,
    windupTime: 0.62,
    sightRange: 6.5,
    scoreValue: 80,
  },
  spitter: {
    archetype: 'spitter',
    label: 'Acid Spitter',
    hp: 64,
    speed: 1.85,
    damage: 16,
    attackRange: 6.5,
    windupTime: 0.58,
    sightRange: 10.5,
    scoreValue: 60,
  },
};

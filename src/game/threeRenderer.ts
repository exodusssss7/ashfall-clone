import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getLootPopTransform, resolvePlayerAnimState, resolveZombieAnimState, type ActionVisual } from './actionAnimation';
import { PLANET_RADIUS_TILES, isInsideCubeFaceTile, resolveCubeSphereCoord } from './cubeSphere';
import { CHUNK_SIZE, PIXEL_SCALE, TILE_W, clamp, dist, isoToWorld } from './isometric';
import { getPrimaryLootItem } from './lootUi';
import { WEAPONS, isMeleeWeapon } from './recipes';
import {
  FPS_CAR_EYE_HEIGHT,
  FPS_EYE_HEIGHT,
  computeFirstPersonHeadBob,
  computeFirstPersonStrafeRoll,
  computeFirstPersonWeaponRaiseOffset,
} from './firstPerson';
import {
  evaluateFirstPersonMeleePose,
  evaluateThirdPersonMeleePose,
  getFirstPersonMeleeGripPose,
  type FirstPersonMeleeSwingPose,
} from './meleeAnimation';
import { createAshFlakeGeometry, createDebrisShardGeometry } from './modelSculpt';
import { batchStaticObjectGroups } from './threeBatching';
import { ThreeGrassSystem } from './threeGrass';
import {
  ThreeModelFactory,
  type ActorRig3D,
  type DoorRig3D,
  type FirstPersonViewmodelRig,
  type LootContainerRig3D,
  type VehicleRig3D,
} from './threeModels';
import { SkyCloudDome } from './threeSky';
import { ThreePixelAtlas } from './threeTextures';
import {
  WATER_SURFACE_Y,
  WaterRippleBuffer,
  buildChunkWaterGeometry,
  createPixelWaterMaterial,
  syncPixelWaterUniforms,
  type PixelWaterMaterialUniforms,
} from './waterSystem';
import {
  applyWeatherAndShelterLighting,
  computeAtmosphereLighting,
  createAtmosphereLightingState,
} from './lighting';
import {
  getMacroRegionCave,
  isTunnelClaimedCell,
  isTunnelCoreCell,
  isTunnelOpeningEdge,
  sampleBridgeInfo,
  sampleRoadTunnelInfo,
  sampleTerrainHeight,
  sampleTerrainMeshHeight,
  sampleTerrainSurface,
} from './terrainSystem';
import { sampleBiomeAt, sampleOceanInfo, sampleRiverInfo, sampleRoadInfo } from './worldGen';
import { getBuildTargetTile, getDaylightInfo } from './survivalLogic';
import { getSettings } from './settings';
import { STRUCTURES } from './recipes';
import {
  ZOMBIE_VISUAL_PRESETS,
  computeZombieVisualLod,
  evaluateBlisterPulse,
  evaluateJawAndSpasm,
  evaluateSalivaStrandCycle,
  evaluateSkinDeformIntensity,
} from './zombieVisuals';
import type {
  BloodDecal,
  CubeFaceId,
  BulletImpactEffect,
  CameraMode,
  DoorEntity,
  FirePatch,
  FishingState,
  FloatingText,
  GamePhase,
  Inventory,
  LootContainer,
  PlayerState,
  Projectile,
  SoundRipple,
  SurfaceImpactDecal,
  TileCell,
  Vehicle,
  WeatherSnapshot,
  WorldStore,
  WorldStructure,
  Zombie,
  ZombieArchetype,
} from './types';

export interface RenderParticle {
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

export interface RenderAshFlake {
  x: number;
  y: number;
  speed: number;
  drift: number;
  size: number;
  alpha: number;
}

export interface RenderFrameState {
  phase: GamePhase;
  cameraMode: CameraMode;
  fpsPitch: number;
  strafeInput: number;
  weaponSwapTimer: number;
  playerVelX: number;
  playerVelY: number;
  isSprinting: boolean;
  elapsedClock: number;
  timeMinutes: number;
  camX: number;
  camY: number;
  trauma: number;
  worldStore: WorldStore;
  getCell: (gx: number, gy: number) => TileCell;
  player: PlayerState;
  inventory: Inventory;
  activeVehicleId: number | null;
  vehicles: Vehicle[];
  doors: DoorEntity[];
  containers: LootContainer[];
  structures: WorldStructure[];
  zombies: Zombie[];
  projectiles: Projectile[];
  firePatches: FirePatch[];
  decals: BloodDecal[];
  soundRipples: SoundRipple[];
  fishing: FishingState;
  particles: RenderParticle[];
  ambientAsh: RenderAshFlake[];
  floatingTexts: FloatingText[];
  actionVisual: ActionVisual | null;
  muzzleFlashTimer: number;
  hitMarkerTimer: number;
  hitMarkerCrit: boolean;
  hitMarkerHeadshot: boolean;
  meleeComboStep: number;
  meleeHitConfirmed: boolean;
  impactDecals: SurfaceImpactDecal[];
  impactEffects: BulletImpactEffect[];
  sleepTransitionTimer: number;
  mouseScreenX: number;
  mouseScreenY: number;
  mouseWorldX: number;
  mouseWorldY: number;
  usingVirtualAim: boolean;
  nearInteractTile: { gx: number; gy: number } | null;
  weather: WeatherSnapshot;
  sheltered: boolean;
  shelterKind: 'cave' | 'tunnel' | 'building' | 'vehicle' | null;
}

interface ChunkVisual {
  key: string;
  cx: number;
  cy: number;
  group: THREE.Group;
  terrainTex: THREE.CanvasTexture;
  terrainMat: THREE.MeshStandardMaterial;
  mergedGeos: THREE.BufferGeometry[];
  wallEntries: Array<{
    gx: number;
    gy: number;
    solidGroup: THREE.Group;
    fadedGroup: THREE.Group;
  }>;
  mergedWallsGroup?: THREE.Group;
  dynamicWallsGroup?: THREE.Group;
  fpsUpperGroup?: THREE.Group;
  shelterRoofs: Array<{
    kind: 'cave' | 'tunnel';
    group: THREE.Group;
    fpsWallGroup?: THREE.Group;
    fadeMaterials: THREE.MeshStandardMaterial[];
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    currentOpacity: number;
  }>;
  burnBarrelFlames: THREE.Group[];
  burnBarrelCoords: Array<{ x: number; z: number }>;
  lightAnchors: Array<{ x: number; y: number; z: number; color: number; intensity: number; distance: number; flicker: boolean }>;
  fpsRoofMesh?: THREE.InstancedMesh;
  grassMesh?: THREE.InstancedMesh | null;
  waterMesh?: THREE.Mesh;
}

// Reusable scratch math objects for zero-GC per-frame updates
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _camOffsetDir = new THREE.Vector3(1, Math.SQRT2 / Math.sqrt(3), 1);

const MAX_PARTICLE_INSTANCES = 300;
const MAX_ASH_INSTANCES = 48;
const MAX_INFECT_DROPS = 96;
const MAX_SPORE_PUFFS = 72;
const MAX_DECAL_INSTANCES = 140;
const MAX_IMPACT_DECALS = 96;
const MAX_IMPACT_EFFECTS = 24;
const MAX_DYNAMIC_POINT_LIGHTS = 6;
const MAX_POOLED_ZOMBIES = 48;

export class ThreeIsometricRenderer {
  public readonly isSoftwareGl: boolean;
  private qualityPixelRatio = 1;
  private canvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private fogExp: THREE.FogExp2;
  private camera: THREE.OrthographicCamera;
  private fpsCamera: THREE.PerspectiveCamera;
  private activeCamera: THREE.Camera;
  private currentFpsFov = getSettings().fpsFov;
  private currentIsoZoom = getSettings().isoZoom;
  private currentFpsRoll = 0;
  private envRT: THREE.WebGLRenderTarget;

  private atlas: ThreePixelAtlas;
  private factory: ThreeModelFactory;
  private skyDome: SkyCloudDome;
  private grassSystem: ThreeGrassSystem;
  private waterMaterial: THREE.ShaderMaterial;
  private waterUniforms: PixelWaterMaterialUniforms;
  private waterRipples = new WaterRippleBuffer();
  private lastBobberRippleTime = -10;
  private _flashlightDir = new THREE.Vector3(1, -0.1, 0);

  private sunLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private flashlight: THREE.SpotLight;
  private headlightLights: THREE.SpotLight[] = [];
  private pointLights: THREE.PointLight[] = [];

  private chunksGroup = new THREE.Group();
  private chunkVisuals = new Map<string, ChunkVisual>();
  private pendingDisposeChunks: ChunkVisual[] = [];
  private chunkPlaneGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
  private ceilingBoxGeo = new THREE.BoxGeometry(1, 0.08, 1);
  private ceilingMat: THREE.MeshStandardMaterial;
  private activeSeed = 1994;
  private activeFace: CubeFaceId = 0;
  private isMobileDevice = false;
  private shadowFrameCounter = 0;
  private lastShadowCamX = -99999;
  private lastShadowCamZ = -99999;
  private rollingFrameMs = 16.6;
  private adaptiveDprScale = 1.0;
  private planetCurveUniforms = {
    uCurveOrigin: { value: new THREE.Vector3(0, 0, 0) },
    uCurveStrength: { value: 0.06 },
    uPlanetRadius: { value: PLANET_RADIUS_TILES },
  };
  private smoothedTargetY = 0;
  private rainInstanced!: THREE.InstancedMesh;
  private rainDrops: Array<{ ox: number; oy: number; oz: number; speed: number; len: number }> = [];
  private lastIsFps: boolean | null = null;
  private lastOccludedWalls: Array<{ solidGroup: THREE.Group; fadedGroup: THREE.Group }> = [];
  private lastFallbackWallChunks: ChunkVisual[] = [];
  private burnBarrelCoordsCache: Array<{ x: number; z: number }> = [];
  private burnBarrelsDirty = true;

  private doorRigs = new Map<string, DoorRig3D>();
  private containerRigs = new Map<string, LootContainerRig3D>();
  private lootDropRigs = new Map<string, THREE.Group>();
  private structureRigs = new Map<string, THREE.Group>();
  private vehicleRigs = new Map<number, VehicleRig3D>();
  private zombieRigs = new Map<
    number,
    {
      rig: ActorRig3D;
      archetype: ZombieArchetype;
      ring: THREE.Mesh;
      wasFading: boolean;
      wasFlashing: boolean;
      salivaPhase: number;
      oozeTimer: number;
      sporeTimer: number;
    }
  >();
  private zombieRigPool = new Map<ZombieArchetype, Array<{ rig: ActorRig3D; ring: THREE.Mesh }>>();
  private pooledZombieCount = 0;
  private zombieRingGeo: THREE.RingGeometry;
  private zombieRingMatRed: THREE.MeshBasicMaterial;
  private zombieRingMatMint: THREE.MeshBasicMaterial;
  private lastRenderClock = 0;

  private playerRig: ActorRig3D;
  private playerWasFlashing = false;
  private playerWadeDepth = 0;
  private playerRigHeight = 1.8;
  private playerWadePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private playerWadeClipActive = false;
  private fpsViewmodelRig: FirstPersonViewmodelRig;
  private fpsSlashMesh: THREE.Mesh;

  private projectileMeshes = new Map<number, THREE.Group>();
  private firePatchMeshes = new Map<number, THREE.Group>();
  private rippleMeshes: THREE.Mesh[] = [];

  private particleInstanced: THREE.InstancedMesh;
  private ashInstanced: THREE.InstancedMesh;
  private infectDropInstanced: THREE.InstancedMesh;
  private sporePuffInstanced: THREE.InstancedMesh;
  private infectDrops: Array<{
    active: boolean;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    size: number;
    life: number;
    maxLife: number;
    color: number;
  }> = [];
  private sporePuffs: Array<{
    active: boolean;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    size: number;
    life: number;
    maxLife: number;
    rot: number;
    color: number;
  }> = [];
  private infectDropCursor = 0;
  private sporePuffCursor = 0;
  private decalMeshes: THREE.Mesh[] = [];
  private bulletTracerGeo = new THREE.BoxGeometry(0.76, 0.036, 0.036);
  private bulletCoreGeo = new THREE.BoxGeometry(0.32, 0.056, 0.056);
  private pelletTracerGeo = new THREE.BoxGeometry(0.48, 0.032, 0.032);
  private flameCardGeo = new THREE.PlaneGeometry(1, 1);
  private flameSpireGeo = new THREE.ConeGeometry(0.5, 1.0, 6);
  private emberSparkGeo = new THREE.OctahedronGeometry(0.032, 0);
  private molotovBodyGeo = new THREE.CylinderGeometry(0.062, 0.066, 0.17, 10);
  private molotovNeckGeo = new THREE.CylinderGeometry(0.028, 0.062, 0.075, 10);
  private molotovRagGeo = new THREE.CylinderGeometry(0.034, 0.038, 0.055, 8);
  private impactDecalGeo = new THREE.PlaneGeometry(1, 1);
  private impactDecalMeshes: THREE.Mesh[] = [];
  private impactFlashGeo = new THREE.PlaneGeometry(0.36, 0.09);
  private impactSparkGeo = new THREE.BoxGeometry(0.055, 0.055, 0.055);
  private impactEffectPools: Array<{
    root: THREE.Group;
    flashMat: THREE.MeshBasicMaterial;
    sparkMat: THREE.MeshBasicMaterial;
    flashA: THREE.Mesh;
    flashB: THREE.Mesh;
    sparks: THREE.Mesh[];
  }> = [];

  // Reusable per-frame scratch collections (zero GC pressure)
  private _scratchStrIds = new Set<string>();
  private _scratchStrIds2 = new Set<string>();
  private _scratchNumIds = new Set<number>();
  private _lightCandidates: Array<{
    x: number;
    y: number;
    z: number;
    color: number;
    intensity: number;
    distance: number;
    d2: number;
  }> = [];

  private fpsVignetteGrad: CanvasGradient | null = null;
  private fpsVignetteSprintGrad: CanvasGradient | null = null;

  // Helpers: build highlight, molotov reticle, near-interact diamond, fishing line/bobber, melee arc
  private interactHighlight: THREE.LineLoop;
  private buildHighlight: THREE.Group;
  private buildFillMat: THREE.MeshBasicMaterial;
  private buildEdgeMat: THREE.LineBasicMaterial;
  private molotovReticle: THREE.LineLoop;
  private meleeArcMesh: THREE.Mesh;
  private fishingLine: THREE.Line;
  private fishingBobber: THREE.Group;
  private fishingRipple: THREE.LineLoop;

  private viewW = 1280;
  private viewH = 720;
  private atmoState = createAtmosphereLightingState();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isSoftwareGl = ThreeIsometricRenderer.detectSoftwareGl();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.isMobileDevice =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0);
    const maxDpr = this.isSoftwareGl ? 1 : this.isMobileDevice ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.qualityPixelRatio = this.renderer.getPixelRatio();
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // On mobile GPUs, keep full 1024x1024 PCFSoftShadowMap quality while updating shadows at 30Hz
    // (or immediately on camera movement), cutting mobile GPU shadow workload in half with zero quality loss.
    if (this.isMobileDevice && !this.isSoftwareGl) {
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = true;
    }

    // Lightweight transparent 2D overlay canvas for crisp damage numbers, bars & crosshair
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.inset = '0';
    this.overlayCanvas.style.width = '100%';
    this.overlayCanvas.style.height = '100%';
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.className = 'pixelated';
    canvas.parentElement?.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d')!;

    this.scene = new THREE.Scene();
    this.scene.background = this.atmoState.isoFogColor.clone();
    this.fogExp = new THREE.FogExp2(this.atmoState.isoFogColor.getHex(), 0.009);
    this.scene.fog = this.fogExp;

    // Mandatory Studio Environment Reflection for metals/glass
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();

    // Locked 2:1 Orthographic Isometric Camera
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -60, 140);
    this.camera.zoom = this.currentIsoZoom;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(_camOffsetDir).multiplyScalar(28);
    this.camera.lookAt(0, 0, 0);

    // First-Person Perspective Camera (far=240 so SkyCloudDome + distant clouds never clip)
    this.fpsCamera = new THREE.PerspectiveCamera(this.currentFpsFov, 16 / 9, 0.08, 240);
    this.scene.add(this.fpsCamera);
    this.activeCamera = this.camera;

    // Lighting rig: warm directional sun + cool hemisphere fill
    this.hemiLight = new THREE.HemisphereLight(0x9ec0db, 0x3b3328, 0.72);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff2d9, 1.55);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 75;
    const d = 19;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Cool opposite sky rim/bounce fill light (no shadows -> zero draw-call overhead)
    this.rimLight = new THREE.DirectionalLight(0x80a4e8, 0.22);
    this.rimLight.castShadow = false;
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    // Player flashlight SpotLight
    this.flashlight = new THREE.SpotLight(0xfff1c9, 0, 12, Math.PI * 0.24, 0.55, 1.4);
    this.flashlight.castShadow = false;
    this.scene.add(this.flashlight);
    this.scene.add(this.flashlight.target);

    // Vehicle headlight SpotLights (up to 2)
    for (let i = 0; i < 2; i++) {
      const hl = new THREE.SpotLight(0xfff4cc, 0, 14, Math.PI * 0.26, 0.5, 1.3);
      hl.castShadow = false;
      this.scene.add(hl);
      this.scene.add(hl.target);
      this.headlightLights.push(hl);
    }

    // Dynamic PointLight pool for campfires, burn barrels, streetlamps, sirens & fire
    for (let i = 0; i < MAX_DYNAMIC_POINT_LIGHTS; i++) {
      const pl = new THREE.PointLight(0xff9838, 0, 7.5, 1.6);
      pl.castShadow = false;
      this.scene.add(pl);
      this.pointLights.push(pl);
    }

    this.atlas = new ThreePixelAtlas();
    this.factory = new ThreeModelFactory(this.atlas);
    this.skyDome = new SkyCloudDome();
    this.scene.add(this.skyDome.group);
    this.grassSystem = new ThreeGrassSystem();
    const waterSetup = createPixelWaterMaterial();
    this.waterMaterial = waterSetup.material;
    this.waterUniforms = waterSetup.uniforms;

    this.zombieRingGeo = new THREE.RingGeometry(0.32, 0.42, 18);
    this.zombieRingGeo.rotateX(-Math.PI * 0.5);
    this.zombieRingMatRed = new THREE.MeshBasicMaterial({
      color: 0xff4d42,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.zombieRingMatMint = new THREE.MeshBasicMaterial({
      color: 0x5ef2b5,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.ceilingMat = new THREE.MeshStandardMaterial({
      map: this.atlas.ceilingTex,
      roughness: 0.92,
      metalness: 0.04,
    });

    this.scene.add(this.chunksGroup);

    // Player 3D rig & First-Person 3D pixel-art viewmodel rig
    this.playerRig = this.factory.createActorRig('player');
    this.scene.add(this.playerRig.root);
    // Own the player's materials so the wading clip never affects zombies; measure height once.
    this.playerRig.root.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    });
    const rigBox = new THREE.Box3().setFromObject(this.playerRig.root);
    if (Number.isFinite(rigBox.max.y - rigBox.min.y) && rigBox.max.y - rigBox.min.y > 0.2) this.playerRigHeight = rigBox.max.y - rigBox.min.y;
    this.fpsViewmodelRig = this.factory.createFirstPersonViewmodelRig();
    this.fpsViewmodelRig.root.visible = false;
    this.fpsCamera.add(this.fpsViewmodelRig.root);

    // Instanced 3D faceted debris shards (splinters, rock chips, blood spray, sparks)
    const partGeo = createDebrisShardGeometry();
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleInstanced = new THREE.InstancedMesh(partGeo, partMat, MAX_PARTICLE_INSTANCES);
    this.particleInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleInstanced.frustumCulled = false;
    this.particleInstanced.count = 0;
    this.scene.add(this.particleInstanced);

    // Instanced 3D fluttering ash flakes & glowing embers
    const ashGeo = createAshFlakeGeometry();
    const ashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.56,
      side: THREE.DoubleSide,
    });
    this.ashInstanced = new THREE.InstancedMesh(ashGeo, ashMat, MAX_ASH_INSTANCES);
    this.ashInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ashInstanced.frustumCulled = false;
    this.ashInstanced.count = 0;
    this.scene.add(this.ashInstanced);

    // Pooled instanced 3D rain streaks for cold rainstorms
    const maxRain = this.isSoftwareGl ? 150 : 340;
    const rainGeo = new THREE.BoxGeometry(0.017, 0.62, 0.017);
    const rainMat = new THREE.MeshBasicMaterial({
      color: 0xbcd6e8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.rainInstanced = new THREE.InstancedMesh(rainGeo, rainMat, maxRain);
    this.rainInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rainInstanced.frustumCulled = false;
    this.rainInstanced.count = 0;
    this.scene.add(this.rainInstanced);
    for (let i = 0; i < maxRain; i++) {
      this.rainDrops.push({
        ox: (Math.random() - 0.5) * 32,
        oy: Math.random() * 14,
        oz: (Math.random() - 0.5) * 32,
        speed: 15 + Math.random() * 6,
        len: 0.78 + Math.random() * 0.55,
      });
    }

    // Pooled instanced infection droplets (saliva, oozing pus & bile) and toxic spore/miasma puffs
    const dropGeo = new THREE.OctahedronGeometry(0.022, 0);
    const dropMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.12,
      metalness: 0.06,
      transparent: true,
      opacity: 0.9,
    });
    this.infectDropInstanced = new THREE.InstancedMesh(dropGeo, dropMat, MAX_INFECT_DROPS);
    this.infectDropInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.infectDropInstanced.frustumCulled = false;
    this.infectDropInstanced.count = 0;
    this.scene.add(this.infectDropInstanced);
    for (let i = 0; i < MAX_INFECT_DROPS; i++) {
      this.infectDrops.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 1,
        life: 0,
        maxLife: 1,
        color: 0xc8d4b8,
      });
    }

    const sporeGeo = new THREE.DodecahedronGeometry(0.085, 0);
    const sporeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.sporePuffInstanced = new THREE.InstancedMesh(sporeGeo, sporeMat, MAX_SPORE_PUFFS);
    this.sporePuffInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sporePuffInstanced.frustumCulled = false;
    this.sporePuffInstanced.count = 0;
    this.scene.add(this.sporePuffInstanced);
    for (let i = 0; i < MAX_SPORE_PUFFS; i++) {
      this.sporePuffs.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 1,
        life: 0,
        maxLife: 1,
        rot: 0,
        color: 0x7cb832,
      });
    }

    // Tile interaction & build-mode highlights
    const tileSquarePts = [
      new THREE.Vector3(-0.48, 0.03, -0.48),
      new THREE.Vector3(0.48, 0.03, -0.48),
      new THREE.Vector3(0.48, 0.03, 0.48),
      new THREE.Vector3(-0.48, 0.03, 0.48),
    ];
    this.interactHighlight = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(tileSquarePts),
      new THREE.LineBasicMaterial({ color: 0xf0d078, transparent: true, opacity: 0.72 })
    );
    this.interactHighlight.visible = false;
    this.scene.add(this.interactHighlight);

    this.buildHighlight = new THREE.Group();
    this.buildFillMat = new THREE.MeshBasicMaterial({
      color: 0x5ef28f,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.buildEdgeMat = new THREE.LineBasicMaterial({ color: 0x5ef28f });
    const buildPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), this.buildFillMat);
    buildPlane.rotation.x = -Math.PI * 0.5;
    buildPlane.position.y = 0.03;
    const buildLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(tileSquarePts), this.buildEdgeMat);
    this.buildHighlight.add(buildPlane, buildLine);
    this.buildHighlight.visible = false;
    this.scene.add(this.buildHighlight);

    // Molotov blast radius circle
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * 1.45, 0.03, Math.sin(a) * 1.45));
    }
    this.molotovReticle = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: 0xf58e2b, transparent: true, opacity: 0.78 })
    );
    this.molotovReticle.visible = false;
    this.scene.add(this.molotovReticle);

    // First-person pixel-art melee slash smear attached to fpsCamera
    this.fpsSlashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.46),
      new THREE.MeshBasicMaterial({
        map: this.atlas.meleeSlashTex,
        color: 0xf2eee2,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.fpsSlashMesh.position.set(0, -0.02, -0.58);
    this.fpsSlashMesh.renderOrder = 12;
    this.fpsSlashMesh.visible = false;
    this.fpsCamera.add(this.fpsSlashMesh);

    // 3D Melee crescent pixel-art slash arc (oriented along +X world forward)
    const arcGeo = new THREE.PlaneGeometry(1.68, 0.92);
    arcGeo.rotateX(-Math.PI * 0.5);
    arcGeo.rotateY(-Math.PI * 0.5);
    arcGeo.translate(0.94, 0, 0);
    this.meleeArcMesh = new THREE.Mesh(
      arcGeo,
      new THREE.MeshBasicMaterial({
        map: this.atlas.meleeSlashTex,
        color: 0xf2eee2,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.meleeArcMesh.rotation.order = 'YXZ';
    this.meleeArcMesh.visible = false;
    this.scene.add(this.meleeArcMesh);

    // Fishing line, bobber & water ripple
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ]);
    this.fishingLine = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0xe1ebf0, transparent: true, opacity: 0.78 })
    );
    this.fishingLine.visible = false;
    this.scene.add(this.fishingLine);

    this.fishingBobber = new THREE.Group();
    const bobRed = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.1, 0.11),
      new THREE.MeshBasicMaterial({ color: 0xe0483e })
    );
    const bobWhite = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.06, 0.11),
      new THREE.MeshBasicMaterial({ color: 0xf0ece1 })
    );
    bobWhite.position.y = 0.07;
    this.fishingBobber.add(bobRed, bobWhite);
    this.fishingBobber.visible = false;
    this.scene.add(this.fishingBobber);

    const ripPts: THREE.Vector3[] = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      ripPts.push(new THREE.Vector3(Math.cos(a) * 0.35, 0.02, Math.sin(a) * 0.35));
    }
    this.fishingRipple = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ripPts),
      new THREE.LineBasicMaterial({ color: 0x8ad4eb, transparent: true, opacity: 0.7 })
    );
    this.fishingRipple.visible = false;
    this.scene.add(this.fishingRipple);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  /** Rebuild player rig + first-person arms after a survivor appearance change. */
  public refreshPlayerAppearance(): void {
    this.atlas.refreshPlayerActorTextures();

    const disposeRigMaterials = (root: THREE.Object3D) => {
      root.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.material) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) (mat as THREE.Material).dispose();
      });
    };

    this.scene.remove(this.playerRig.root);
    disposeRigMaterials(this.playerRig.root);
    this.playerRig = this.factory.createActorRig('player');
    // Same ownership rule as at construction: the player owns its materials.
    this.playerRig.root.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    });
    this.scene.add(this.playerRig.root);
    const rigBox = new THREE.Box3().setFromObject(this.playerRig.root);
    if (Number.isFinite(rigBox.max.y - rigBox.min.y) && rigBox.max.y - rigBox.min.y > 0.2) {
      this.playerRigHeight = rigBox.max.y - rigBox.min.y;
    }

    const wasVisible = this.fpsViewmodelRig.root.visible;
    this.fpsCamera.remove(this.fpsViewmodelRig.root);
    disposeRigMaterials(this.fpsViewmodelRig.root);
    this.fpsViewmodelRig = this.factory.createFirstPersonViewmodelRig();
    this.fpsViewmodelRig.root.visible = wasVisible;
    this.fpsCamera.add(this.fpsViewmodelRig.root);
  }

  private static detectSoftwareGl(): boolean {
    try {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param) || '');
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return true;
    }
  }

  public afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (status === gl.UNSIGNALED) {
        window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        window.setTimeout(cb, 80);
      }
    };
    window.setTimeout(poll, 5);
  }

  /** Apply the Settings graphics-quality pixel ratio (no-op under software GL, which stays at 1). */
  public setQualityPixelRatio(cap: number): void {
    if (this.isSoftwareGl) return;
    const next = Math.max(0.6, cap);
    if (Math.abs(next - this.qualityPixelRatio) < 0.001) return;
    this.qualityPixelRatio = next;
    this.renderer.setPixelRatio(next);
    if (this.viewW > 0) this.resize(this.viewW, this.viewH);
  }

  public resize(w: number, h: number): void {
    this.viewW = Math.max(320, w);
    this.viewH = Math.max(240, h);
    this.renderer.setSize(this.viewW, this.viewH, false);
    this.overlayCanvas.width = this.viewW;
    this.overlayCanvas.height = this.viewH;
    this.overlayCtx.imageSmoothingEnabled = false;

    const worldPerPx = Math.SQRT2 / (TILE_W * PIXEL_SCALE);
    const halfW = this.viewW * 0.5 * worldPerPx;
    const halfH = this.viewH * 0.5 * worldPerPx;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();

    this.fpsCamera.aspect = this.viewW / this.viewH;
    this.fpsCamera.updateProjectionMatrix();

    // Cache radial vignette gradients so renderOverlay2D creates zero gradient allocations per frame
    const rInner = Math.min(this.viewW, this.viewH) * 0.32;
    const rOuter = Math.max(this.viewW, this.viewH) * 0.72;
    const gBase = this.overlayCtx.createRadialGradient(
      this.viewW * 0.5,
      this.viewH * 0.5,
      rInner,
      this.viewW * 0.5,
      this.viewH * 0.5,
      rOuter
    );
    gBase.addColorStop(0, 'rgba(0,0,0,0)');
    gBase.addColorStop(1, 'rgba(6,8,10,0.28)');
    this.fpsVignetteGrad = gBase;

    const gSprint = this.overlayCtx.createRadialGradient(
      this.viewW * 0.5,
      this.viewH * 0.5,
      rInner,
      this.viewW * 0.5,
      this.viewH * 0.5,
      rOuter
    );
    gSprint.addColorStop(0, 'rgba(0,0,0,0)');
    gSprint.addColorStop(1, 'rgba(6,8,10,0.42)');
    this.fpsVignetteSprintGrad = gSprint;
  }

  public getRenderInfo(): { drawCalls: number; triangles: number } {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  public getBurnBarrelCoords(): ReadonlyArray<{ x: number; z: number }> {
    if (this.burnBarrelsDirty) {
      this.burnBarrelCoordsCache.length = 0;
      for (const cv of this.chunkVisuals.values()) {
        for (const coord of cv.burnBarrelCoords) {
          this.burnBarrelCoordsCache.push(coord);
        }
      }
      this.burnBarrelsDirty = false;
    }
    return this.burnBarrelCoordsCache;
  }

  private groundY(wx: number, wy: number): number {
    return sampleTerrainHeight(this.activeSeed, wx, wy, this.activeFace);
  }

  public screenToWorld(screenX: number, screenY: number, camX?: number, camY?: number): { wx: number; wy: number } {
    const baseY = this.smoothedTargetY;
    if (camX !== undefined && camY !== undefined) {
      const cw = isoToWorld(camX, camY);
      const cy = this.groundY(cw.wx, cw.wy);
      this.camera.position.set(
        cw.wx + _camOffsetDir.x * 28,
        cy + _camOffsetDir.y * 28,
        cw.wy + _camOffsetDir.z * 28
      );
      this.camera.lookAt(cw.wx, cy, cw.wy);
      this.camera.updateMatrixWorld();
    }
    _ndc.set((screenX / this.viewW) * 2 - 1, -(screenY / this.viewH) * 2 + 1);
    _raycaster.setFromCamera(_ndc, this.camera);
    _groundPlane.constant = -baseY;
    if (!_raycaster.ray.intersectPlane(_groundPlane, _vec3A)) {
      _groundPlane.constant = 0;
      return { wx: 28.5, wy: 28.5 };
    }
    // Refine intersection onto undulating hills (damped 4-step iteration prevents jitter on steep cliffs)
    let wx = _vec3A.x;
    let wy = _vec3A.z;
    for (let it = 0; it < 4; it++) {
      const h = this.groundY(wx, wy);
      _groundPlane.constant = -h;
      if (_raycaster.ray.intersectPlane(_groundPlane, _vec3A)) {
        wx += (_vec3A.x - wx) * 0.65;
        wy += (_vec3A.z - wy) * 0.65;
      }
    }
    _groundPlane.constant = 0;
    return { wx, wy };
  }

  public addWaterRipple(x: number, z: number, elapsedClock: number, strength = 1.0): void {
    this.waterRipples.push(x, z, elapsedClock, strength);
  }

  private disposeChunkVisual(chunk: ChunkVisual): void {
    this.chunksGroup.remove(chunk.group);
    chunk.terrainTex.dispose();
    chunk.terrainMat.dispose();
    chunk.fpsRoofMesh?.dispose();
    chunk.grassMesh?.dispose();
    chunk.waterMesh?.geometry.dispose();
    for (const sr of chunk.shelterRoofs) {
      for (const mat of sr.fadeMaterials) {
        mat.dispose();
      }
    }
    for (const geo of chunk.mergedGeos) {
      geo.dispose();
    }
  }

  private disposeLootDropMaterials(drop: THREE.Group): void {
    drop.traverse((o: THREE.Object3D) => {
      if ((o as THREE.Sprite).isSprite) {
        (o as THREE.Sprite).material.dispose();
      }
    });
  }

  public clearSceneCaches(deferChunkDispose = false): void {
    for (const chunk of this.chunkVisuals.values()) {
      this.chunksGroup.remove(chunk.group);
      if (deferChunkDispose) {
        this.pendingDisposeChunks.push(chunk);
      } else {
        this.disposeChunkVisual(chunk);
      }
    }
    this.chunkVisuals.clear();
    if (!deferChunkDispose) {
      while (this.pendingDisposeChunks.length > 0) {
        this.disposeChunkVisual(this.pendingDisposeChunks.pop()!);
      }
    }
    this.waterRipples.clear();
    this.lastBobberRippleTime = -10;
    this.lastOccludedWalls.length = 0;
    this.lastFallbackWallChunks.length = 0;
    this.lastIsFps = null;
    this.burnBarrelsDirty = true;

    for (const r of this.doorRigs.values()) this.scene.remove(r.root);
    this.doorRigs.clear();

    for (const r of this.containerRigs.values()) this.scene.remove(r.root);
    this.containerRigs.clear();

    for (const r of this.lootDropRigs.values()) {
      this.scene.remove(r);
      this.disposeLootDropMaterials(r);
    }
    this.lootDropRigs.clear();

    for (const r of this.structureRigs.values()) this.scene.remove(r);
    this.structureRigs.clear();

    for (const r of this.vehicleRigs.values()) this.scene.remove(r.root);
    this.vehicleRigs.clear();

    for (const z of this.zombieRigs.values()) {
      this.recycleZombieEntry(z.archetype, z.rig, z.ring);
    }
    this.zombieRigs.clear();
    for (let i = 0; i < this.infectDrops.length; i++) this.infectDrops[i].active = false;
    for (let i = 0; i < this.sporePuffs.length; i++) this.sporePuffs[i].active = false;
    this.infectDropInstanced.count = 0;
    this.sporePuffInstanced.count = 0;
    this.lastRenderClock = 0;

    for (const p of this.projectileMeshes.values()) {
      this.scene.remove(p);
      p.traverse((c: THREE.Object3D) => {
        if ((c as THREE.Mesh).isMesh && !c.userData.sharedGeo) (c as THREE.Mesh).geometry.dispose();
      });
    }
    this.projectileMeshes.clear();

    for (const dm of this.impactDecalMeshes) dm.visible = false;
    for (const fx of this.impactEffectPools) fx.root.visible = false;

    for (const f of this.firePatchMeshes.values()) {
      this.scene.remove(f);
      f.traverse((c: THREE.Object3D) => {
        if ((c as THREE.Mesh).isMesh) {
          const mesh = c as THREE.Mesh;
          if (!c.userData.sharedGeo) mesh.geometry.dispose();
          if (mesh === f.children[0]) (mesh.material as THREE.Material).dispose();
        }
      });
    }
    this.firePatchMeshes.clear();
  }

  private ensureChunksAround(centerWX: number, centerWY: number, getCell: (gx: number, gy: number) => TileCell): void {
    const pcx = Math.floor(centerWX / CHUNK_SIZE);
    const pcy = Math.floor(centerWY / CHUNK_SIZE);
    const keepRadius = 2;

    // Gently drain deferred chunk disposals (2/frame) so face transitions never stutter WebGL
    for (let d = 0; d < 2 && this.pendingDisposeChunks.length > 0; d++) {
      this.disposeChunkVisual(this.pendingDisposeChunks.pop()!);
    }

    // Stagger distant chunk eviction (max 2 per frame) to avoid GC hitches on mobile
    let evicted = 0;
    for (const [key, cv] of this.chunkVisuals.entries()) {
      if (Math.abs(cv.cx - pcx) > keepRadius + 1 || Math.abs(cv.cy - pcy) > keepRadius + 1) {
        this.chunksGroup.remove(cv.group);
        this.pendingDisposeChunks.push(cv);
        this.chunkVisuals.delete(key);
        this.burnBarrelsDirty = true;
        if (++evicted >= 2) break;
      }
    }

    // Collect missing chunks and sort closest-first so player's immediate area always builds first
    const missing: Array<{ cx: number; cy: number; key: string; distSq: number }> = [];
    for (let cy = pcy - keepRadius; cy <= pcy + keepRadius; cy++) {
      for (let cx = pcx - keepRadius; cx <= pcx + keepRadius; cx++) {
        const key = `${cx},${cy}`;
        if (this.chunkVisuals.has(key)) continue;
        const dx = cx - pcx;
        const dy = cy - pcy;
        missing.push({ cx, cy, key, distSq: dx * dx + dy * dy });
      }
    }
    if (missing.length === 0) return;

    missing.sort((a, b) => a.distSq - b.distSq);

    // On empty cache (startup or face transition), build immediate 3x3 (distSq <= 2) synchronously
    // so the player never sees an empty floor; time-slice outer chunks to 1-2/frame within a 5ms budget!
    const isColdStart = this.chunkVisuals.size === 0;
    const isBorderTransition = isColdStart && this.pendingDisposeChunks.length > 0;
    const maxPerFrame = isBorderTransition ? 2 : isColdStart ? 5 : this.isMobileDevice ? 1 : 2;
    const budgetMs = isBorderTransition ? 8.0 : isColdStart ? 18.0 : 4.5;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

    let built = 0;
    for (let i = 0; i < missing.length; i++) {
      const m = missing[i];
      if (!isColdStart && built >= maxPerFrame) break;
      if (isColdStart && m.distSq > 2 && built >= 1) break;
      this.chunkVisuals.set(m.key, this.buildChunkVisual(m.cx, m.cy, m.key, getCell));
      this.burnBarrelsDirty = true;
      built++;
      if (!isColdStart && t0 > 0 && performance.now() - t0 >= budgetMs) break;
    }
  }

  private buildChunkVisual(
    cx: number,
    cy: number,
    key: string,
    getCell: (gx: number, gy: number) => TileCell
  ): ChunkVisual {
    const group = new THREE.Group();
    const startX = cx * CHUNK_SIZE;
    const startY = cy * CHUNK_SIZE;
    const seed = this.activeSeed;
    const face = this.activeFace;
    const isFlatOrigin = face === 0 && cx >= 0 && cx <= 3 && cy >= 0 && cy <= 3;

    const terrainTex = this.atlas.createChunkTerrainTexture(getCell, cx, cy, CHUNK_SIZE);
    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainTex,
      roughness: 0.94,
      metalness: 0.02,
    });
    const curveUniforms = this.planetCurveUniforms;
    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uCurveOrigin = curveUniforms.uCurveOrigin;
      shader.uniforms.uCurveStrength = curveUniforms.uCurveStrength;
      shader.uniforms.uPlanetRadius = curveUniforms.uPlanetRadius;
      shader.vertexShader =
        `uniform vec3 uCurveOrigin;
uniform float uCurveStrength;
uniform float uPlanetRadius;
` +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_BATCHING
          mvPosition = batchingMatrix * mvPosition;
        #endif
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 planetWorldPos = modelMatrix * mvPosition;
        float pCurveDist = max(0.0, length(planetWorldPos.xz - uCurveOrigin.xz) - 22.0);
        planetWorldPos.y -= (pCurveDist * pCurveDist) / (2.0 * uPlanetRadius) * 0.12 * uCurveStrength;
        mvPosition = viewMatrix * planetWorldPos;
        gl_Position = projectionMatrix * mvPosition;`
      );
    };
    terrainMat.customProgramCacheKey = () => 'ashfall_planet_curve_terrain_v1';

    const mergedGeos: THREE.BufferGeometry[] = [];
    if (isFlatOrigin) {
      const terrainPlane = new THREE.Mesh(this.chunkPlaneGeo, terrainMat);
      terrainPlane.rotation.x = -Math.PI * 0.5;
      terrainPlane.position.set(startX + CHUNK_SIZE * 0.5, 0, startY + CHUNK_SIZE * 0.5);
      terrainPlane.receiveShadow = true;
      terrainPlane.castShadow = false;
      group.add(terrainPlane);
    } else {
      // Displaced 3D contoured terrain mesh (depresses riverbeds under elevated bridges so water flows continuously underneath)
      const terrainGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
      terrainGeo.rotateX(-Math.PI * 0.5);
      const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
      const normAttr = terrainGeo.attributes.normal as THREE.BufferAttribute;
      const centerX = startX + CHUNK_SIZE * 0.5;
      const centerZ = startY + CHUNK_SIZE * 0.5;
      for (let i = 0; i < posAttr.count; i++) {
        const wx = centerX + posAttr.getX(i);
        const wz = centerZ + posAttr.getZ(i);
        const meshY = sampleTerrainMeshHeight(seed, wx, wz, face);
        posAttr.setY(i, meshY);
        if (meshY < -0.02) {
          normAttr.setXYZ(i, 0, 1, 0);
        } else {
          const surf = sampleTerrainSurface(seed, wx, wz, face);
          normAttr.setXYZ(i, surf.normalX, surf.normalY, surf.normalZ);
        }
      }
      posAttr.needsUpdate = true;
      normAttr.needsUpdate = true;
      terrainGeo.computeBoundingBox();
      terrainGeo.computeBoundingSphere();
      mergedGeos.push(terrainGeo);

      const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
      terrainMesh.position.set(centerX, 0, centerZ);
      terrainMesh.receiveShadow = true;
      terrainMesh.castShadow = false;
      group.add(terrainMesh);
    }

    const wallEntries: ChunkVisual['wallEntries'] = [];
    const solidWallRoots: THREE.Object3D[] = [];
    const fpsUpperRoots: THREE.Object3D[] = [];
    const staticPropRoots: THREE.Object3D[] = [];
    const shelterRoofs: ChunkVisual['shelterRoofs'] = [];
    const burnBarrelFlames: THREE.Group[] = [];
    const burnBarrelCoords: Array<{ x: number; z: number }> = [];
    const lightAnchors: ChunkVisual['lightAnchors'] = [];
    const indoorRoofCells: Array<{ gx: number; gy: number; gyElev: number }> = [];
    const dynamicWallsGroup = new THREE.Group();
    dynamicWallsGroup.visible = false;

    const tunnelRoofRoots: THREE.Object3D[] = [];
    const tunnelFpsWallRoots: THREE.Object3D[] = [];
    let tunMinX = Infinity;
    let tunMaxX = -Infinity;
    let tunMinZ = Infinity;
    let tunMaxZ = -Infinity;

    // Shared materials for bridge decks/rails/pilings, road tunnels, and rocky cliff cave architecture
    const bridgeDeckMat = this.factory.getMat(0xffffff, { map: this.atlas.woodOakTex, roughness: 0.88, metalness: 0.04 });
    const bridgeGirderMat = this.factory.getMat('#353b42', { roughness: 0.62, metalness: 0.45 });
    const bridgeRailMat = this.factory.getMat('#5a646e', { roughness: 0.68, metalness: 0.38 });
    const bridgeWoodMat = this.factory.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.9 });
    const tunnelConcreteMat = this.factory.getMat(0xffffff, { map: this.atlas.tunnelConcreteTex, roughness: 0.92, metalness: 0.04 });
    const tunnelJambMat = this.factory.getMat(0xffffff, { map: this.atlas.tunnelConcreteSmoothTex, roughness: 0.94, metalness: 0.03 });
    const tunnelRimMat = this.factory.getMat('#a8b0ba', { roughness: 0.72, metalness: 0.08 });
    const tunnelDarkMat = this.factory.getMat(0xffffff, { map: this.atlas.tunnelStoneTex, roughness: 0.96 });
    const tunnelStoneTallMat = this.factory.getMat(0xffffff, { map: this.atlas.tunnelStoneTallTex, roughness: 0.96 });
    const tunnelLampMat = this.factory.getMat('#ffbe55', { emissive: '#ffaa33', emissiveIntensity: 2.1 });
    const caveRockMat = this.factory.getMat(0xffffff, { map: this.atlas.rockTex, roughness: 0.96 });
    const caveDarkMat = this.factory.getMat('#222730', { roughness: 0.98 });
    const caveFloorLinerMat = this.factory.getMat('#171b22', {
      roughness: 0.99,
      metalness: 0.02,
    });
    caveFloorLinerMat.polygonOffset = true;
    caveFloorLinerMat.polygonOffsetFactor = -1;
    caveFloorLinerMat.polygonOffsetUnits = -1;
    const caveCutawayRimMat = this.factory.getMat('#93a0b2', { roughness: 0.76, metalness: 0.08 });
    const plinthStoneMat = this.factory.getMat('#393d42', { roughness: 0.96 });

    // Tunnel envelope: the bore (isTunnel) PLUS its portal aprons (isPortal band road cells) get
    // the roof/wall envelope, so the envelope ends in a framed mouth at grade instead of stepping
    // mid-run and opening daylight slits between wall segments. The classification lives in
    // terrainSystem (isTunnelCoreCell/isTunnelClaimedCell) so gameplay collision matches these
    // visible walls exactly.
    const tunnelCoreAt = (tx: number, ty: number) => isTunnelCoreCell(seed, tx, ty, face);
    const tunnelClaimedAt = (tx: number, ty: number) => isTunnelClaimedCell(seed, tx, ty, face);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const gx = startX + lx;
        const gy = startY + ly;
        const cell = getCell(gx, gy);
        const tileSurf = isFlatOrigin ? null : sampleTerrainSurface(seed, gx + 0.5, gy + 0.5, face);
        const tileY = tileSurf ? tileSurf.height : 0;

        if (
          cell.tile === 'floor' ||
          cell.tile === 'floor_rug' ||
          cell.tile === 'floor_bath' ||
          cell.tile === 'tile_clinic' ||
          cell.tile === 'tile_diner'
        ) {
          indoorRoofCells.push({ gx, gy, gyElev: tileY });
        }

        // Solid 3D Elevated River Bridge Deck, steel stringer girders, wooden pilings & guardrails
        if (!isFlatOrigin && cell.tile === 'bridge_deck') {
          const bridge = sampleBridgeInfo(seed, gx + 0.5, gy + 0.5, face);
          const bRoot = new THREE.Group();
          bRoot.position.set(gx + 0.5, tileY, gy + 0.5);

          // Structural planked 3D bridge deck slab so continuous river water flows visibly underneath!
          const deckSlab = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.22, 1.04), bridgeDeckMat);
          deckSlab.position.set(0, -0.105, 0);
          deckSlab.receiveShadow = true;
          bRoot.add(deckSlab);

          if (bridge.axis === 'ew') {
            const girderN = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.14, 0.12), bridgeGirderMat);
            girderN.position.set(0, -0.24, -0.36);
            const girderS = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.14, 0.12), bridgeGirderMat);
            girderS.position.set(0, -0.24, 0.36);
            bRoot.add(girderN, girderS);

            if (getCell(gx, gy - 1).tile !== 'bridge_deck') {
              const railN = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.14, 0.09), bridgeRailMat);
              railN.position.set(0, 0.52, -0.46);
              const postN = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.62, 0.11), bridgeWoodMat);
              postN.position.set(0, 0.26, -0.46);
              bRoot.add(railN, postN);
              if (gx % 2 === 0) {
                const pileH = tileY + 0.65;
                const pileN = new THREE.Mesh(new THREE.BoxGeometry(0.19, pileH, 0.19), bridgeWoodMat);
                pileN.position.set(0, -pileH * 0.5 - 0.12, -0.42);
                bRoot.add(pileN);
              }
            }
            if (getCell(gx, gy + 1).tile !== 'bridge_deck') {
              const railS = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.14, 0.09), bridgeRailMat);
              railS.position.set(0, 0.52, 0.46);
              const postS = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.62, 0.11), bridgeWoodMat);
              postS.position.set(0, 0.26, 0.46);
              bRoot.add(railS, postS);
              if (gx % 2 === 0) {
                const pileH = tileY + 0.65;
                const pileS = new THREE.Mesh(new THREE.BoxGeometry(0.19, pileH, 0.19), bridgeWoodMat);
                pileS.position.set(0, -pileH * 0.5 - 0.12, 0.42);
                bRoot.add(pileS);
              }
            }
          } else {
            const girderW = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 1.04), bridgeGirderMat);
            girderW.position.set(-0.36, -0.24, 0);
            const girderE = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 1.04), bridgeGirderMat);
            girderE.position.set(0.36, -0.24, 0);
            bRoot.add(girderW, girderE);

            if (getCell(gx - 1, gy).tile !== 'bridge_deck') {
              const railW = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 1.04), bridgeRailMat);
              railW.position.set(-0.46, 0.52, 0);
              const postW = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.62, 0.11), bridgeWoodMat);
              postW.position.set(-0.46, 0.26, 0);
              bRoot.add(railW, postW);
              if (gy % 2 === 0) {
                const pileH = tileY + 0.65;
                const pileW = new THREE.Mesh(new THREE.BoxGeometry(0.19, pileH, 0.19), bridgeWoodMat);
                pileW.position.set(-0.42, -pileH * 0.5 - 0.12, 0);
                bRoot.add(pileW);
              }
            }
            if (getCell(gx + 1, gy).tile !== 'bridge_deck') {
              const railE = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 1.04), bridgeRailMat);
              railE.position.set(0.46, 0.52, 0);
              const postE = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.62, 0.11), bridgeWoodMat);
              postE.position.set(0.46, 0.26, 0);
              bRoot.add(railE, postE);
              if (gy % 2 === 0) {
                const pileH = tileY + 0.65;
                const pileE = new THREE.Mesh(new THREE.BoxGeometry(0.19, pileH, 0.19), bridgeWoodMat);
                pileE.position.set(0.42, -pileH * 0.5 - 0.12, 0);
                bRoot.add(pileE);
              }
            }
          }
          staticPropRoots.push(bRoot);
        }

        // 3D Highway Road Tunnel concrete vault, staggered rocky mountain overburden, portal arches & ISO cutaway curbs
        // Covers every tile the bore claims (road lanes AND walkable shoulder strips), not just road tiles,
        // so flanking gallery floors get the same roof/walls instead of standing open to the sky.
        if (!isFlatOrigin) {
          const tun = sampleRoadTunnelInfo(seed, gx + 0.5, gy + 0.5, face);
          if (tunnelClaimedAt(gx, gy)) {
            if (gx + 0.5 < tunMinX) tunMinX = gx + 0.5;
            if (gx + 0.5 > tunMaxX) tunMaxX = gx + 0.5;
            if (gy + 0.5 < tunMinZ) tunMinZ = gy + 0.5;
            if (gy + 0.5 > tunMaxZ) tunMaxZ = gy + 0.5;

            const clearH = Math.max(2.6, tun.roofY - tileY);
            // Slope the ceiling smoothly between neighbors instead of per-tile stair-step slabs
            const clearAt = (tx: number, ty: number) => {
              if (!tunnelClaimedAt(tx, ty)) return null;
              const ti = sampleRoadTunnelInfo(seed, tx + 0.5, ty + 0.5, face);
              return Math.max(2.6, ti.roofY - sampleTerrainSurface(seed, tx + 0.5, ty + 0.5, face).height);
            };
            const hPrev = tun.axis === 'ew' ? clearAt(gx - 1, gy) : clearAt(gx, gy - 1);
            const hNext = tun.axis === 'ew' ? clearAt(gx + 1, gy) : clearAt(gx, gy + 1);
            const slopeDh = ((hNext ?? clearH) - (hPrev ?? clearH)) / 2;
            const wallH = Math.max(clearH, hPrev ?? 0, hNext ?? 0) + 0.3;
            const jitterH = ((Math.abs(gx * 7 + gy * 13)) % 4) * 0.08;
            const tRoot = new THREE.Group();
            tRoot.position.set(gx + 0.5, tileY, gy + 0.5);
            // Concrete ceiling slab + staggered overburden cap; slab extends downward enough to
            // overlap the lowest adjacent ceiling, sealing daylight slots at roof steps.
            let slabDrop = 0;
            for (const [nx, ny] of [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]]) {
              if (!tunnelClaimedAt(nx, ny)) continue;
              const tn = sampleRoadTunnelInfo(seed, nx + 0.5, ny + 0.5, face);
              const nClear = Math.max(2.6, tn.roofY - sampleTerrainSurface(seed, nx + 0.5, ny + 0.5, face).height);
              slabDrop = Math.max(slabDrop, clearH - nClear - 0.36);
            }
            slabDrop = Math.max(0, slabDrop);
            const slabH = 0.36 + slabDrop + Math.abs(slopeDh);
            // Slabs overlap along the bore axis so tilted neighbors never open wedge seams
            const slabLen = 1.005 + 1.4;
            const ceiling = new THREE.Mesh(
              tun.axis === 'ew' ? new THREE.BoxGeometry(slabLen, slabH, 1.005) : new THREE.BoxGeometry(1.005, slabH, slabLen),
              tunnelConcreteMat);
            ceiling.position.set(0, clearH + 0.18 - slabH * 0.5, 0);
            if (tun.axis === 'ew') ceiling.rotation.z = Math.atan(slopeDh);
            else ceiling.rotation.x = -Math.atan(slopeDh);
            const burdenH = 0.82 + jitterH;
            const burden = new THREE.Mesh(
              tun.axis === 'ew' ? new THREE.BoxGeometry(slabLen, burdenH, 1.005) : new THREE.BoxGeometry(1.005, burdenH, slabLen),
              caveRockMat);
            burden.position.set(0, clearH + 0.18 + burdenH * 0.5 + Math.abs(slopeDh) * 0.5, 0);
            tRoot.add(ceiling, burden);

            // Stone-lined retaining walls. Camera-facing (+Z/+X) sides keep the ISO cutaway
            // (low curb + rim permanent, upper wall FPS-only). Where the envelope edge steps with
            // the curving road, cross walls seal hillside corners; where the highway lane itself
            // crosses the face, a framed header leaves a designed opening (no wall across the lane).
            const addCutawayWall = (cx: number, cz: number, alongX: boolean) => {
              const low = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 1.01 : 0.24, 0.56, alongX ? 0.24 : 1.01), tunnelDarkMat);
              low.position.set(cx, tileY + 0.28, cz);
              const rim = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 1.02 : 0.28, 0.09, alongX ? 0.28 : 1.02), tunnelRimMat);
              rim.position.set(cx, tileY + 0.59, cz);
              staticPropRoots.push(low, rim);
              const upperH = Math.max(0.5, wallH - 0.75);
              const up = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 1.01 : 0.24, upperH, alongX ? 0.24 : 1.01), tunnelStoneTallMat);
              up.position.set(cx, tileY + 0.62 + upperH * 0.5, cz);
              tunnelFpsWallRoots.push(up);
            };
            const addFullWall = (cx: number, cz: number, alongX: boolean) => {
              const seal = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 1.01 : 0.24, wallH + 0.25, alongX ? 0.24 : 1.01), tunnelStoneTallMat);
              seal.position.set(cx, tileY + wallH * 0.5 - 0.1, cz);
              staticPropRoots.push(seal);
            };
            // Support-spacing (user-approved 2026-11-20): only every ~3rd road crossing gets a
            // dressed portal frame (legs + header); skipped crossings stay plain openings (no
            // wall added, so the lane is never blocked - the opening exists with or without dressing).
            const thinFrame = (fx: number, fz: number, alongX: boolean) =>
              (alongX ? Math.round(fx) : Math.round(fz)) % 3 === 0;
            const addHeader = (cx: number, cz: number, alongX: boolean, fpsManaged: boolean) => {
              // Full portal frame: header above lane clearance + jamb stubs at both ends
              const header = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 1.02 : 0.3, 0.55, alongX ? 0.3 : 1.02), tunnelRimMat);
              header.position.set(cx, tileY + wallH - 0.5, cz);
              const jambGeo = new THREE.BoxGeometry(alongX ? 0.26 : 0.3, wallH + 0.1, alongX ? 0.3 : 0.26);
              const j1 = new THREE.Mesh(jambGeo, tunnelJambMat);
              const j2 = new THREE.Mesh(jambGeo, tunnelJambMat);
              if (alongX) { j1.position.set(cx - 0.44, tileY + wallH * 0.5 - 0.05, cz); j2.position.set(cx + 0.44, tileY + wallH * 0.5 - 0.05, cz); }
              else { j1.position.set(cx, tileY + wallH * 0.5 - 0.05, cz - 0.44); j2.position.set(cx, tileY + wallH * 0.5 - 0.05, cz + 0.44); }
              (fpsManaged ? tunnelFpsWallRoots : staticPropRoots).push(header);
              staticPropRoots.push(j1, j2);
            };
            if (tun.axis === 'ew') {
              if (!tunnelClaimedAt(gx, gy - 1)) {
                if (isTunnelOpeningEdge(seed, gx, gy, gx, gy - 1, face)) { if (thinFrame(gx + 0.5, gy + 0.05, true)) addHeader(gx + 0.5, gy + 0.05, true, false); }
                else addFullWall(gx + 0.5, gy + 0.05, true);
              }
              if (!tunnelClaimedAt(gx, gy + 1)) {
                if (isTunnelOpeningEdge(seed, gx, gy, gx, gy + 1, face)) { if (thinFrame(gx + 0.5, gy + 0.95, true)) addHeader(gx + 0.5, gy + 0.95, true, true); }
                else addCutawayWall(gx + 0.5, gy + 0.95, true);
              }
              // Step-corner seals where the bore's x edge steps with the curving road
              if (!tunnelClaimedAt(gx - 1, gy)) {
                if (isTunnelOpeningEdge(seed, gx, gy, gx - 1, gy, face)) { if (thinFrame(gx + 0.05, gy + 0.5, false)) addHeader(gx + 0.05, gy + 0.5, false, false); }
                else addFullWall(gx + 0.05, gy + 0.5, false);
              }
              if (!tunnelClaimedAt(gx + 1, gy)) {
                if (isTunnelOpeningEdge(seed, gx, gy, gx + 1, gy, face)) { if (thinFrame(gx + 0.95, gy + 0.5, false)) addHeader(gx + 0.95, gy + 0.5, false, true); }
                else addCutawayWall(gx + 0.95, gy + 0.5, false);
              }
              // Reinforced portal arch beam on tunnel entry/exit tiles
              if (tun.isPortal) {
                const beam = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 1.02), tunnelRimMat);
                beam.position.set(0, clearH - 0.08, 0);
                tRoot.add(beam);
              }
            } else {
              if (!tunnelClaimedAt(gx - 1, gy)) {
                if (isTunnelOpeningEdge(seed, gx, gy, gx - 1, gy, face)) { if (thinFrame(gx + 0.05, gy + 0.5, false)) addHeader(gx + 0.05, gy + 0.5, false, false); }
                else addFullWall(gx + 0.05, gy + 0.5, false);
              }
              if (!tunnelClaimedAt(gx + 1, gy)) {
                if (isTunnelOpeningEdge(seed, gx, gy, gx + 1, gy, face)) { if (thinFrame(gx + 0.95, gy + 0.5, false)) addHeader(gx + 0.95, gy + 0.5, false, true); }
                else addCutawayWall(gx + 0.95, gy + 0.5, false);
              }
              // Step-corner seals where the bore's z edge steps with the curving road
              if (!tunnelClaimedAt(gx, gy - 1)) {
                if (isTunnelOpeningEdge(seed, gx, gy, gx, gy - 1, face)) { if (thinFrame(gx + 0.5, gy + 0.05, true)) addHeader(gx + 0.5, gy + 0.05, true, false); }
                else addFullWall(gx + 0.5, gy + 0.05, true);
              }
              if (!tunnelClaimedAt(gx, gy + 1)) {
                if (isTunnelOpeningEdge(seed, gx, gy, gx, gy + 1, face)) { if (thinFrame(gx + 0.5, gy + 0.95, true)) addHeader(gx + 0.5, gy + 0.95, true, true); }
                else addCutawayWall(gx + 0.5, gy + 0.95, true);
              }
              if (tun.isPortal) {
                const beam = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.42, 0.38), tunnelRimMat);
                beam.position.set(0, clearH - 0.08, 0);
                tRoot.add(beam);
              }
            }

            // Warm amber ceiling work lamps spaced down the tunnel centerline
            if ((gx + gy) % 4 === 0 && (tun.axis === 'ew' ? gy % 2 === 0 : gx % 2 === 0)) {
              const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.14), tunnelLampMat);
              lamp.position.set(0, clearH - 0.2, 0);
              tRoot.add(lamp);
              lightAnchors.push({
                x: gx + 0.5,
                y: tileY + clearH - 0.38,
                z: gy + 0.5,
                color: 0xffb347,
                intensity: 4.4,
                distance: 10.5,
                flicker: false,
              });
            }
            tunnelRoofRoots.push(tRoot);
          }
        }

        if (cell.prop === 'none' || cell.prop === 'door') continue;
        // Loot containers & vehicles are synced dynamically
        if (
          cell.prop === 'crate_wood' ||
          cell.prop === 'crate_military' ||
          cell.prop === 'fridge' ||
          cell.prop === 'med_cabinet' ||
          cell.prop === 'car_sedan' ||
          cell.prop === 'car_police'
        ) {
          continue;
        }

        if (cell.prop === 'wall_brick' || cell.prop === 'wall_wood' || cell.prop === 'wall_interior') {
          const isW = (x: number, y: number) => {
            const p = getCell(x, y).prop;
            return p === 'wall_brick' || p === 'wall_wood' || p === 'wall_interior' || p === 'door';
          };
          const hasN = isW(gx, gy - 1);
          const hasE = isW(gx + 1, gy);
          const hasS = isW(gx, gy + 1);
          const hasW = isW(gx - 1, gy);
          const hasWindow = cell.prop !== 'wall_interior' && cell.variant === 2 && ((hasE && hasW) || (hasN && hasS));

          const solidGroup = this.factory.createWallGroup(cell.prop, hasWindow, false);
          solidGroup.position.set(gx + 0.5, tileY, gy + 0.5);
          const fpsUpper = solidGroup.userData.fpsUpperGroup as THREE.Group | undefined;
          if (fpsUpper) {
            solidGroup.remove(fpsUpper);
            fpsUpper.visible = true;
            fpsUpper.position.set(gx + 0.5, tileY, gy + 0.5);
            fpsUpperRoots.push(fpsUpper);
          }

          // Ground outer-frontier building walls onto sloped hillsides with a dark stone foundation plinth
          if (!isFlatOrigin && tileSurf && tileSurf.slope > 0.08 && cell.prop !== 'wall_interior') {
            const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.48, 1.02), plinthStoneMat);
            plinth.position.set(gx + 0.5, tileY - 0.24, gy + 0.5);
            staticPropRoots.push(plinth);
          }

          const fadedGroup = this.factory.createWallGroup(cell.prop, hasWindow, true);
          fadedGroup.position.set(gx + 0.5, tileY, gy + 0.5);
          fadedGroup.visible = false;

          solidWallRoots.push(solidGroup);
          dynamicWallsGroup.add(solidGroup, fadedGroup);
          wallEntries.push({ gx, gy, solidGroup, fadedGroup });
          continue;
        }

        // Seat outdoor props firmly into sloped hillsides so edges never float on steep grades
        const slopeSink =
          !isFlatOrigin &&
          tileSurf &&
          tileSurf.slope > 0.1 &&
          (cell.prop === 'tree_pine' ||
            cell.prop === 'tree_dead' ||
            cell.prop === 'tree_oak' ||
            cell.prop === 'tree_willow' ||
            cell.prop === 'tree_palm' ||
            cell.prop === 'rock_boulder' ||
            cell.prop === 'fallen_log' ||
            cell.prop === 'tent' ||
            cell.prop === 'concrete_barrier' ||
            cell.prop === 'sandbag_wall' ||
            cell.prop === 'barrel_burn' ||
            cell.prop === 'wrecked_car')
            ? Math.min(0.24, tileSurf.slope * 0.32)
            : 0;
        const propY = tileY - slopeSink;

        const propGroup = this.factory.createPropGroup(cell.prop);
        propGroup.position.set(gx + 0.5, propY, gy + 0.5);

        if (cell.prop === 'barrel_burn') {
          const fg = propGroup.userData.flameGroup as THREE.Group | undefined;
          if (fg) {
            propGroup.remove(fg);
            fg.position.set(gx + 0.5, propY + 0.74, gy + 0.5);
            group.add(fg);
            burnBarrelFlames.push(fg);
          }
          burnBarrelCoords.push({ x: gx + 0.5, z: gy + 0.5 });
          lightAnchors.push({ x: gx + 0.5, y: propY + 1.25, z: gy + 0.5, color: 0xff7b29, intensity: 3.4, distance: 7.5, flicker: true });
        } else if (cell.prop === 'streetlamp') {
          lightAnchors.push({ x: gx + 0.9, y: propY + 1.8, z: gy + 0.5, color: 0xffd27a, intensity: 3.2, distance: 8.0, flicker: false });
        } else if (cell.prop === 'fishing_post') {
          lightAnchors.push({ x: gx + 0.7, y: propY + 1.1, z: gy + 0.5, color: 0xffcf6e, intensity: 2.6, distance: 6.5, flicker: false });
        } else if (cell.prop === 'stove') {
          lightAnchors.push({ x: gx + 0.5, y: propY + 1.0, z: gy + 0.5, color: 0xff6e24, intensity: 2.2, distance: 5.5, flicker: true });
        }

        staticPropRoots.push(propGroup);
      }
    }

    // Batch Highway Road Tunnel roof vault & FPS foreground side walls into a smooth cutaway shelterRoof
    if (tunnelRoofRoots.length > 0) {
      const tunBatch = batchStaticObjectGroups(tunnelRoofRoots);
      const fadeMaterials: THREE.MeshStandardMaterial[] = [];
      tunBatch.group.traverse((obj: THREE.Object3D) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
          const cloned = mesh.material.clone();
          mesh.material = cloned;
          fadeMaterials.push(cloned);
        }
      });
      group.add(tunBatch.group);
      for (const bg of tunBatch.geometries) mergedGeos.push(bg);

      let tunnelFpsWallGroup: THREE.Group | undefined;
      if (tunnelFpsWallRoots.length > 0) {
        const wallBatch = batchStaticObjectGroups(tunnelFpsWallRoots);
        tunnelFpsWallGroup = wallBatch.group;
        tunnelFpsWallGroup.visible = this.lastIsFps === true;
        group.add(tunnelFpsWallGroup);
        for (const bg of wallBatch.geometries) mergedGeos.push(bg);
      }

      shelterRoofs.push({
        kind: 'tunnel',
        group: tunBatch.group,
        fpsWallGroup: tunnelFpsWallGroup,
        fadeMaterials,
        minX: tunMinX - 0.6,
        maxX: tunMaxX + 0.6,
        minZ: tunMinZ - 0.6,
        maxZ: tunMaxZ + 0.6,
        currentOpacity: 0.78,
      });
    }

    // Build True Isometric Rocky Cliff Cave Architecture (3 layers: moody basalt floor liner, asymmetric cutaway perimeter with crisp light-granite rims, and semi-translucent sculpted rocky roof dome)
    if (!isFlatOrigin) {
      const caveRes = isInsideCubeFaceTile(startX + 8, startY + 8)
        ? { face, gx: startX + 8, gy: startY + 8 }
        : resolveCubeSphereCoord(face, startX + 8, startY + 8);
      const rx = Math.floor(caveRes.gx / 32);
      const ry = Math.floor(caveRes.gy / 32);
      const cave = getMacroRegionCave(seed, rx, ry, caveRes.face);
      if (
        cave &&
        cave.gx >= startX &&
        cave.gx < startX + CHUNK_SIZE &&
        cave.gy >= startY &&
        cave.gy < startY + CHUNK_SIZE
      ) {
        const caveCX = cave.gx + 0.5;
        const caveCZ = cave.gy + 0.5;
        const roofH = Math.max(2.75, cave.roofY - cave.floorY);

        // Layer 3 — Moody Dark Cavern Floor Liner + covered mouth transition floor
        const linerRoot = new THREE.Group();
        linerRoot.position.set(caveCX, cave.floorY, caveCZ);
        const floorDisc = new THREE.Mesh(
          new THREE.CylinderGeometry(cave.chamberRadius + 0.3, cave.chamberRadius + 0.42, 0.06, 18),
          caveFloorLinerMat
        );
        floorDisc.position.set(0, 0.015, 0);
        floorDisc.receiveShadow = true;
        linerRoot.add(floorDisc);
        const mouthApron = new THREE.Mesh(
          cave.mouthDir === 's'
            ? new THREE.BoxGeometry(3.2, 0.06, 2.5)
            : new THREE.BoxGeometry(2.5, 0.06, 3.2),
          caveFloorLinerMat
        );
        mouthApron.position.set(
          cave.mouthDir === 'e' ? 2.1 : 0,
          0.015,
          cave.mouthDir === 's' ? 2.1 : 0
        );
        mouthApron.receiveShadow = true;
        linerRoot.add(mouthApron);
        staticPropRoots.push(linerRoot);

        // Layer 2 — Asymmetric Isometric Perimeter Walls (tall NW back massif + crisp-rimmed SE cutaway + FPS upper enclosure)
        const caveWallRoot = new THREE.Group();
        caveWallRoot.position.set(caveCX, cave.floorY, caveCZ);
        const caveFpsWallRoots: THREE.Object3D[] = [];
        const segCount = 16;
        // Keep every wall-segment inner face clear of the walkable chamber interior (chamberRadius):
        // the deepest box reaches 0.63 inward from wallR, so 0.80 leaves a 0.17 safety margin and
        // the FPS camera can never end up inside the rock architecture (which rendered as a void).
        const wallR = cave.chamberRadius + 0.80;
        const mouthAngle = cave.mouthDir === 's' ? Math.PI * 0.5 : 0;

        for (let s = 0; s < segCount; s++) {
          const ang = (s / segCount) * Math.PI * 2;
          const dAng = Math.abs(Math.atan2(Math.sin(ang - mouthAngle), Math.cos(ang - mouthAngle)));
          if (dAng < 0.52) continue; // Keep the timber-framed cave mouth wide open

          const sx = Math.cos(ang) * wallR;
          const sz = Math.sin(ang) * wallR;
          const isFrontCutaway = sx + sz > 0.72;
          const rotY = -ang;

          if (!isFrontCutaway) {
            // Permanent NW back cliff massif: full-height dark interior basalt + rugged outer granite shoulder
            const backWall = new THREE.Mesh(
              new THREE.BoxGeometry(1.26, roofH + 0.62, 1.84),
              s % 2 === 0 ? caveRockMat : caveDarkMat
            );
            backWall.position.set(sx, (roofH + 0.15) * 0.5 - 0.22, sz);
            backWall.rotation.y = rotY;
            caveWallRoot.add(backWall);

            // Subtle upper rock ledge accent framing the cavern interior in ISO
            const upperCap = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.12, 1.88), caveCutawayRimMat);
            upperCap.position.set(sx * 0.98, roofH + 0.12, sz * 0.98);
            upperCap.rotation.y = rotY;
            caveWallRoot.add(upperCap);
          } else {
            // SE Foreground Isometric Cutaway: low beveled dark basalt base + crisp light-granite architectural cutaway rim!
            const lowWall = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.72, 1.78), caveDarkMat);
            lowWall.position.set(sx, 0.24, sz);
            lowWall.rotation.y = rotY;
            caveWallRoot.add(lowWall);

            const rimCap = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.11, 1.84), caveCutawayRimMat);
            rimCap.position.set(sx, 0.635, sz);
            rimCap.rotation.y = rotY;
            caveWallRoot.add(rimCap);

            // FPS-only upper wall extension sealing the SE arc so First-Person view is 100% enclosed
            const upperH = Math.max(0.65, roofH - 0.35);
            const fpsUpperSeg = new THREE.Mesh(new THREE.BoxGeometry(1.04, upperH, 1.82), caveDarkMat);
            fpsUpperSeg.position.set(caveCX + sx, cave.floorY + 0.62 + upperH * 0.5, caveCZ + sz);
            fpsUpperSeg.rotation.y = rotY;
            caveFpsWallRoots.push(fpsUpperSeg);
          }
        }
        staticPropRoots.push(caveWallRoot);

        // Layer 1 — Sculpted Rocky Roof Dome (semi-translucent peek outside in ISO, smooth cutaway on entry, 100% opaque in FPS)
        const caveRoofRoots: THREE.Object3D[] = [];
        const roofRoot = new THREE.Group();
        roofRoot.position.set(caveCX, cave.floorY, caveCZ);

        const domeBase = new THREE.Mesh(
          new THREE.CylinderGeometry(3.45, 4.35, 0.62, 8),
          caveDarkMat
        );
        domeBase.position.set(0, roofH + 0.08, 0);
        domeBase.rotation.y = Math.PI / 8;

        const rockCrown1 = new THREE.Mesh(
          new THREE.CylinderGeometry(2.75, 3.95, 0.98, 7),
          caveRockMat
        );
        rockCrown1.position.set(-0.22, roofH + 0.76, -0.22);
        rockCrown1.rotation.y = 0.32;

        const rockCrown2 = new THREE.Mesh(
          new THREE.CylinderGeometry(1.35, 2.55, 0.84, 7),
          caveRockMat
        );
        rockCrown2.position.set(-0.35, roofH + 1.48, -0.35);
        rockCrown2.rotation.y = -0.45;

        // Overhanging rocky brow extending cleanly over the timber mouth lintel
        const brow = new THREE.Mesh(
          cave.mouthDir === 's'
            ? new THREE.BoxGeometry(3.95, 0.62, 1.55)
            : new THREE.BoxGeometry(1.55, 0.62, 3.95),
          caveRockMat
        );
        brow.position.set(
          cave.mouthDir === 'e' ? 2.65 : 0,
          roofH + 0.24,
          cave.mouthDir === 's' ? 2.65 : 0
        );
        roofRoot.add(domeBase, rockCrown1, rockCrown2, brow);
        caveRoofRoots.push(roofRoot);

        const caveBatch = batchStaticObjectGroups(caveRoofRoots);
        const caveFadeMaterials: THREE.MeshStandardMaterial[] = [];
        caveBatch.group.traverse((obj: THREE.Object3D) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
            const cloned = mesh.material.clone();
            mesh.material = cloned;
            caveFadeMaterials.push(cloned);
          }
        });
        group.add(caveBatch.group);
        for (const bg of caveBatch.geometries) mergedGeos.push(bg);

        let caveFpsWallGroup: THREE.Group | undefined;
        if (caveFpsWallRoots.length > 0) {
          const cwBatch = batchStaticObjectGroups(caveFpsWallRoots);
          caveFpsWallGroup = cwBatch.group;
          caveFpsWallGroup.visible = this.lastIsFps === true;
          group.add(caveFpsWallGroup);
          for (const bg of cwBatch.geometries) mergedGeos.push(bg);
        }

        const rPad = cave.chamberRadius + 0.6;
        shelterRoofs.push({
          kind: 'cave',
          group: caveBatch.group,
          fpsWallGroup: caveFpsWallGroup,
          fadeMaterials: caveFadeMaterials,
          minX: caveCX - rPad,
          maxX: caveCX + rPad + (cave.mouthDir === 'e' ? 1.0 : 0),
          minZ: caveCZ - rPad,
          maxZ: caveCZ + rPad + (cave.mouthDir === 's' ? 1.0 : 0),
          currentOpacity: 0.42,
        });

        // Permanent rocky mouth framing jambs + weathered timber lintel beam so hidden caves read crisply
        const mouthRoot = new THREE.Group();
        mouthRoot.position.set(caveCX, cave.floorY, caveCZ);
        if (cave.mouthDir === 's') {
          // Jambs sit outside the walkable mouth corridor (|dx| <= 1.55) with margin so the FPS
          // camera cannot clip inside the timber (which rendered as a black see-through slab).
          const pL = new THREE.Mesh(new THREE.BoxGeometry(0.45, roofH, 0.55), bridgeWoodMat);
          pL.position.set(-1.95, roofH * 0.5, 3.15);
          const pR = new THREE.Mesh(new THREE.BoxGeometry(0.45, roofH, 0.55), bridgeWoodMat);
          pR.position.set(1.95, roofH * 0.5, 3.15);
          const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.35, 0.36, 0.65), bridgeWoodMat);
          lintel.position.set(0, roofH - 0.12, 3.15);
          mouthRoot.add(pL, pR, lintel);
        } else {
          const pN = new THREE.Mesh(new THREE.BoxGeometry(0.55, roofH, 0.45), bridgeWoodMat);
          pN.position.set(3.15, roofH * 0.5, -1.95);
          const pS = new THREE.Mesh(new THREE.BoxGeometry(0.55, roofH, 0.45), bridgeWoodMat);
          pS.position.set(3.15, roofH * 0.5, 1.95);
          const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.36, 4.35), bridgeWoodMat);
          lintel.position.set(3.15, roofH - 0.12, 0);
          mouthRoot.add(pN, pS, lintel);
        }
        staticPropRoots.push(mouthRoot);
      }
    }

    // Batch all static chunk walls into minimal draw calls; keep dynamicWallsGroup hidden except on active occluding chunks
    let mergedWallsGroup: THREE.Group | undefined;
    if (solidWallRoots.length > 0) {
      const wallBatch = batchStaticObjectGroups(solidWallRoots);
      mergedWallsGroup = wallBatch.group;
      group.add(mergedWallsGroup, dynamicWallsGroup);
      for (const bg of wallBatch.geometries) mergedGeos.push(bg);
    }

    // Batch all static chunk props into minimal draw calls per material (lossless GPU optimization)
    if (staticPropRoots.length > 0) {
      const staticBatch = batchStaticObjectGroups(staticPropRoots);
      group.add(staticBatch.group);
      for (const bg of staticBatch.geometries) mergedGeos.push(bg);
    }

    // Batch all FPS upper wall extensions per chunk into a single toggleable group
    let fpsUpperGroup: THREE.Group | undefined;
    if (fpsUpperRoots.length > 0) {
      const upperBatch = batchStaticObjectGroups(fpsUpperRoots);
      fpsUpperGroup = upperBatch.group;
      fpsUpperGroup.visible = this.lastIsFps === true;
      group.add(fpsUpperGroup);
      for (const bg of upperBatch.geometries) mergedGeos.push(bg);
    }

    // Instanced wind-animated 3D grass across open grass and forest_floor tiles (grounded on hills!)
    const grassMesh = this.grassSystem.createChunkGrassMesh(
      getCell,
      cx,
      cy,
      CHUNK_SIZE,
      this.isSoftwareGl ? 0.55 : 1,
      isFlatOrigin ? undefined : (gx, gz) => sampleTerrainHeight(seed, gx, gz, face)
    );
    if (grassMesh) {
      group.add(grassMesh);
    }

    let fpsRoofMesh: THREE.InstancedMesh | undefined;
    if (indoorRoofCells.length > 0) {
      fpsRoofMesh = new THREE.InstancedMesh(this.ceilingBoxGeo, this.ceilingMat, indoorRoofCells.length);
      fpsRoofMesh.castShadow = false;
      fpsRoofMesh.receiveShadow = true;
      fpsRoofMesh.visible = this.lastIsFps === true;
      _quat.identity();
      _scale.set(1, 1, 1);
      for (let i = 0; i < indoorRoofCells.length; i++) {
        _vec3A.set(indoorRoofCells[i].gx + 0.5, indoorRoofCells[i].gyElev + 1.72, indoorRoofCells[i].gy + 0.5);
        _mat4.compose(_vec3A, _quat, _scale);
        fpsRoofMesh.setMatrixAt(i, _mat4);
      }
      fpsRoofMesh.instanceMatrix.needsUpdate = true;
      fpsRoofMesh.computeBoundingSphere();
      group.add(fpsRoofMesh);
    }

    // Render continuous animated river water underneath elevated river bridges too!
    const isWaterTile = isFlatOrigin
      ? undefined
      : (wx: number, wy: number) => {
          const t = getCell(wx, wy).tile;
          if (t === 'water') return true;
          if (t === 'bridge_deck') {
            const rv = sampleRiverInfo(seed, wx + 0.5, wy + 0.5, face);
            const oc = sampleOceanInfo(seed, wx + 0.5, wy + 0.5, face);
            return oc.inSeaWater || rv.inWater || rv.riverBand < 0.036;
          }
          return false;
        };
    const waterGeo = buildChunkWaterGeometry(cx, cy, CHUNK_SIZE, getCell, isWaterTile);
    let waterMesh: THREE.Mesh | undefined;
    if (waterGeo) {
      waterMesh = new THREE.Mesh(waterGeo, this.waterMaterial);
      waterMesh.castShadow = false;
      waterMesh.receiveShadow = false;
      waterMesh.renderOrder = 1;
      group.add(waterMesh);
    }

    this.chunksGroup.add(group);
    return {
      key,
      cx,
      cy,
      group,
      terrainTex,
      terrainMat,
      mergedGeos,
      wallEntries,
      mergedWallsGroup,
      dynamicWallsGroup: solidWallRoots.length > 0 ? dynamicWallsGroup : undefined,
      fpsUpperGroup,
      shelterRoofs,
      burnBarrelFlames,
      burnBarrelCoords,
      lightAnchors,
      fpsRoofMesh,
      grassMesh,
      waterMesh,
    };
  }

  public render(state: RenderFrameState): void {
    this.activeSeed = state.worldStore.seed;
    const nextFace = state.worldStore.activeFace ?? 0;
    if (nextFace !== this.activeFace) {
      this.activeFace = nextFace;
      this.clearSceneCaches(true);
    }
    const settings = getSettings();
    const isFps = state.cameraMode === 'fps' && state.phase !== 'title';
    const rawDt = this.lastRenderClock > 0 ? state.elapsedClock - this.lastRenderClock : 0.016;
    this.lastRenderClock = state.elapsedClock;
    const dt = clamp(rawDt, 0, 0.05);

    // Trauma camera shake (can be switched off in Settings)
    const shakeMag = settings.screenShake ? state.trauma * state.trauma * (isFps ? 0.11 : 0.28) : 0;
    const shakeX = shakeMag > 0.004 ? (Math.random() * 2 - 1) * shakeMag : 0;
    const shakeY = shakeMag > 0.004 ? (Math.random() * 2 - 1) * shakeMag * 0.7 : 0;
    const shakeZ = shakeMag > 0.004 ? (Math.random() * 2 - 1) * shakeMag : 0;

    let targetX: number;
    let targetY = 0;
    let targetZ: number;

    let fpsMeleePose: FirstPersonMeleeSwingPose | null = null;

    if (isFps) {
      const p = state.player;
      const activeCar =
        state.activeVehicleId !== null
          ? state.vehicles.find((v) => v.id === state.activeVehicleId) ?? null
          : null;

      targetX = p.x;
      targetZ = p.y;

      let eyeX = p.x;
      let eyeY = FPS_EYE_HEIGHT;
      let eyeZ = p.y;
      const baseFov = settings.fpsFov;
      let targetFov = baseFov;
      let targetRoll = 0;

      if (activeCar) {
        eyeX = activeCar.x + Math.cos(activeCar.angle) * 0.08;
        eyeZ = activeCar.y + Math.sin(activeCar.angle) * 0.08;
        const gY = this.groundY(eyeX, eyeZ);
        targetY = gY;
        eyeY = gY + FPS_CAR_EYE_HEIGHT;
        const speedNorm = clamp(Math.abs(activeCar.speed) / 10, 0, 1);
        targetFov = baseFov + speedNorm * 6 + (activeCar.boosting ? 5 : 0);
      } else {
        const gY = this.groundY(eyeX, eyeZ);
        targetY = gY;
        const speedNow = Math.hypot(state.playerVelX, state.playerVelY);
        const bob = settings.fpsHeadBob
          ? computeFirstPersonHeadBob(p.walkCycle, speedNow, state.isSprinting, p.dodgeTimer)
          : { eyeOffsetY: p.dodgeTimer > 0 ? -0.28 : 0, swayX: 0, swayY: 0 };
        eyeY = gY + FPS_EYE_HEIGHT + bob.eyeOffsetY;
        targetRoll = settings.fpsHeadBob ? computeFirstPersonStrafeRoll(state.strafeInput, speedNow) : 0;
        if (state.isSprinting && speedNow > 0.5) targetFov = baseFov + 4.5;
        else if (p.dodgeTimer > 0) targetFov = baseFov + 6;
        if (
          state.phase === 'playing' &&
          p.meleeSwingTimer > 0 &&
          p.reloadingTimer <= 0 &&
          p.dodgeTimer <= 0 &&
          isMeleeWeapon(p.equippedWeapon)
        ) {
          const swingTotal = WEAPONS[p.equippedWeapon].swingDuration ?? 0.26;
          const swingProg = 1 - clamp(p.meleeSwingTimer / swingTotal, 0, 1);
          fpsMeleePose = evaluateFirstPersonMeleePose({
            weapon: p.equippedWeapon,
            progress: swingProg,
            comboStep: state.meleeComboStep,
            hasHit: state.meleeHitConfirmed,
          });
        }
      }

      if (Math.abs(this.currentFpsFov - targetFov) > 0.05) {
        this.currentFpsFov += (targetFov - this.currentFpsFov) * 0.18;
        if (Math.abs(this.currentFpsFov - targetFov) <= 0.05) this.currentFpsFov = targetFov;
        this.fpsCamera.fov = this.currentFpsFov;
        this.fpsCamera.updateProjectionMatrix();
      }
      this.currentFpsRoll += (targetRoll - this.currentFpsRoll) * 0.18;
      this.smoothedTargetY = targetY;

      const punchScale = settings.screenShake ? 1 : 0.35;
      const effYaw = p.facingAngle + (fpsMeleePose ? fpsMeleePose.camYawOffset * punchScale : 0);
      const effPitch = clamp(
        state.fpsPitch + (fpsMeleePose ? fpsMeleePose.camPitchOffset * punchScale : 0),
        -1.3,
        1.3
      );
      const effRoll = this.currentFpsRoll + (fpsMeleePose ? fpsMeleePose.camRollOffset * punchScale : 0);

      const cosP = Math.cos(effPitch);
      const lookDirX = Math.cos(effYaw) * cosP;
      const lookDirY = Math.sin(effPitch);
      const lookDirZ = Math.sin(effYaw) * cosP;

      this.fpsCamera.position.set(eyeX + shakeX, eyeY + shakeY, eyeZ + shakeZ);
      this.fpsCamera.lookAt(
        eyeX + shakeX + lookDirX,
        eyeY + shakeY + lookDirY,
        eyeZ + shakeZ + lookDirZ
      );
      if (Math.abs(effRoll) > 0.0005) {
        this.fpsCamera.rotateZ(effRoll);
      }
      this.fpsCamera.updateMatrixWorld();
      this.activeCamera = this.fpsCamera;
      this.fogExp.density = 0.0085;
    } else {
      const targetIsoZoom = state.phase === 'title' ? 1 : settings.isoZoom;
      if (Math.abs(this.currentIsoZoom - targetIsoZoom) > 0.001) {
        this.currentIsoZoom += (targetIsoZoom - this.currentIsoZoom) * 0.22;
        if (Math.abs(this.currentIsoZoom - targetIsoZoom) < 0.002) {
          this.currentIsoZoom = targetIsoZoom;
        }
        this.camera.zoom = this.currentIsoZoom;
        this.camera.updateProjectionMatrix();
      }
      const centerWorld = isoToWorld(state.camX, state.camY);
      targetX = centerWorld.wx + shakeX;
      targetZ = centerWorld.wy + shakeZ;
      const rawGroundY = this.groundY(centerWorld.wx, centerWorld.wy);
      this.smoothedTargetY += (rawGroundY - this.smoothedTargetY) * Math.min(1, dt * 8 + 0.14);
      targetY = this.smoothedTargetY;

      this.camera.position.set(
        targetX + _camOffsetDir.x * 28,
        targetY + _camOffsetDir.y * 28,
        targetZ + _camOffsetDir.z * 28
      );
      this.camera.lookAt(targetX, targetY, targetZ);
      this.camera.updateMatrixWorld();
      this.activeCamera = this.camera;
      this.fogExp.density = 0.009;
    }

    // Sync subtle realistic planetary horizon curvature (imperceptible near-field on 2,048-tile globe)
    const curveStr = isFps ? 0.12 : 0.04;
    this.planetCurveUniforms.uCurveOrigin.value.set(targetX, 0, targetZ);
    this.planetCurveUniforms.uCurveStrength.value = curveStr;
    this.waterUniforms.uCurveOrigin.value.set(targetX, 0, targetZ);
    this.waterUniforms.uCurveStrength.value = curveStr;
    this.grassSystem.updateCurvature(targetX, targetZ, curveStr);

    // Mobile GPU optimization: 30Hz smart shadow update + smooth adaptive DPR guard (preserves visual quality)
    if (this.isMobileDevice && !this.isSoftwareGl) {
      this.shadowFrameCounter = (this.shadowFrameCounter + 1) & 1;
      const camMoved = Math.hypot(targetX - this.lastShadowCamX, targetZ - this.lastShadowCamZ) > 0.25;
      if (this.shadowFrameCounter === 0 || camMoved) {
        this.renderer.shadowMap.needsUpdate = true;
        this.lastShadowCamX = targetX;
        this.lastShadowCamZ = targetZ;
      }
      const frameMs = Math.min(80, Math.max(8, dt * 1000));
      this.rollingFrameMs = this.rollingFrameMs * 0.92 + frameMs * 0.08;
      if (this.rollingFrameMs > 26 && this.adaptiveDprScale > 0.78) {
        this.adaptiveDprScale = Math.max(0.78, this.adaptiveDprScale - 0.04);
        this.renderer.setPixelRatio(Math.max(1.0, this.qualityPixelRatio * this.adaptiveDprScale));
      } else if (this.rollingFrameMs < 18 && this.adaptiveDprScale < 1.0) {
        this.adaptiveDprScale = Math.min(1.0, this.adaptiveDprScale + 0.02);
        this.renderer.setPixelRatio(Math.max(1.0, this.qualityPixelRatio * this.adaptiveDprScale));
      }
    }

    // Stream 3D chunks around camera
    this.ensureChunksAround(targetX, targetZ, state.getCell);

    // Update dynamic sky dome, clouds, wind grass, Day/Night + Weather lighting, fog & sun shadows
    this.grassSystem.updateWind(state.elapsedClock, state.weather.windStrength);
    this.updateAtmosphereAndLights(state, targetX, targetY, targetZ, isFps);

    // Toggle FPS ceiling roofs & upper walls only when camera mode flips (zero per-frame scan)
    if (this.lastIsFps !== isFps) {
      this.lastIsFps = isFps;
      for (const cv of this.chunkVisuals.values()) {
        if (cv.fpsRoofMesh) cv.fpsRoofMesh.visible = isFps;
        if (cv.fpsUpperGroup) cv.fpsUpperGroup.visible = isFps;
      }
    }

    // Smooth Isometric Cave & Tunnel Roof Cutaways:
    // - FPS: 100% opaque roof dome + SE foreground enclosure walls
    // - ISO Outside: semi-translucent rocky cave roof peek (0.42) & tunnel cap (0.78)
    // - ISO Approaching/Inside: smooth cross-fade to full cutaway revealing moody interior + crisp wall rims
    const fadeLerp = Math.min(1, dt * 8.5 + 0.12);
    for (const cv of this.chunkVisuals.values()) {
      for (let i = 0; i < cv.shelterRoofs.length; i++) {
        const sr = cv.shelterRoofs[i];
        if (sr.fpsWallGroup) {
          sr.fpsWallGroup.visible = isFps;
        }
        if (isFps) {
          sr.currentOpacity = 1;
          sr.group.visible = true;
          for (let m = 0; m < sr.fadeMaterials.length; m++) {
            const mat = sr.fadeMaterials[m];
            if (mat.transparent || mat.opacity < 0.999) {
              mat.transparent = false;
              mat.opacity = 1;
              mat.depthWrite = true;
              mat.needsUpdate = true;
            }
          }
        } else {
          const pad = sr.kind === 'cave' ? 1.55 : state.shelterKind === 'tunnel' ? 11.0 : 4.5;
          const nearOrInside =
            state.player.x >= sr.minX - pad &&
            state.player.x <= sr.maxX + pad &&
            state.player.y >= sr.minZ - pad &&
            state.player.y <= sr.maxZ + pad;
          // Keep occluding cave/tunnel roofs at 30% opacity when near/inside (never fully transparent)
          const targetOp = nearOrInside ? 0.3 : sr.kind === 'cave' ? 0.42 : 0.78;
          sr.currentOpacity += (targetOp - sr.currentOpacity) * fadeLerp;
          if (Math.abs(sr.currentOpacity - targetOp) < 0.01) {
            sr.currentOpacity = targetOp;
          }
          sr.group.visible = sr.currentOpacity > 0.015;
          if (sr.group.visible) {
            const isSemi = sr.currentOpacity < 0.98;
            for (let m = 0; m < sr.fadeMaterials.length; m++) {
              const mat = sr.fadeMaterials[m];
              if (mat.transparent !== isSemi) {
                mat.transparent = isSemi;
                mat.depthWrite = !isSemi;
                mat.needsUpdate = true;
              }
              mat.opacity = sr.currentOpacity;
            }
          }
        }
      }
    }

    // Restore previously occluded walls and swap fallback chunks back to batched mergedWallsGroup
    for (let i = 0; i < this.lastOccludedWalls.length; i++) {
      const w = this.lastOccludedWalls[i];
      w.solidGroup.visible = true;
      w.fadedGroup.visible = false;
    }
    this.lastOccludedWalls.length = 0;
    for (let i = 0; i < this.lastFallbackWallChunks.length; i++) {
      const cv = this.lastFallbackWallChunks[i];
      if (cv.mergedWallsGroup) cv.mergedWallsGroup.visible = true;
      if (cv.dynamicWallsGroup) cv.dynamicWallsGroup.visible = false;
    }
    this.lastFallbackWallChunks.length = 0;

    if (!isFps && state.phase !== 'title') {
      const px = state.player.x;
      const py = state.player.y;
      const minCX = Math.floor((px - 2.3) / CHUNK_SIZE);
      const maxCX = Math.floor((px + 2.3) / CHUNK_SIZE);
      const minCY = Math.floor((py - 2.3) / CHUNK_SIZE);
      const maxCY = Math.floor((py + 2.3) / CHUNK_SIZE);
      const pSum = px + py + 0.15;
      for (let cy = minCY; cy <= maxCY; cy++) {
        for (let cx = minCX; cx <= maxCX; cx++) {
          const cv = this.chunkVisuals.get(`${cx},${cy}`);
          if (!cv || cv.wallEntries.length === 0) continue;
          let chunkHasOccluded = false;
          for (let i = 0; i < cv.wallEntries.length; i++) {
            const w = cv.wallEntries[i];
            if (
              w.gx + w.gy > pSum &&
              Math.abs(w.gx + 0.5 - px) < 2.2 &&
              Math.abs(w.gy + 0.5 - py) < 2.2
            ) {
              w.solidGroup.visible = false;
              w.fadedGroup.visible = true;
              this.lastOccludedWalls.push(w);
              chunkHasOccluded = true;
            }
          }
          if (chunkHasOccluded) {
            if (cv.mergedWallsGroup) cv.mergedWallsGroup.visible = false;
            if (cv.dynamicWallsGroup) cv.dynamicWallsGroup.visible = true;
            this.lastFallbackWallChunks.push(cv);
          }
        }
      }
    }

    // Animate burn barrel flames only in nearby chunks
    const camCX = Math.floor(targetX / CHUNK_SIZE);
    const camCY = Math.floor(targetZ / CHUNK_SIZE);
    for (let cy = camCY - 1; cy <= camCY + 1; cy++) {
      for (let cx = camCX - 1; cx <= camCX + 1; cx++) {
        const cv = this.chunkVisuals.get(`${cx},${cy}`);
        if (!cv || cv.burnBarrelFlames.length === 0) continue;
        for (let i = 0; i < cv.burnBarrelFlames.length; i++) {
          const fg = cv.burnBarrelFlames[i];
          const pulse = 0.88 + Math.sin(state.elapsedClock * 16 + fg.position.x * 3.1) * 0.22;
          fg.scale.set(1, pulse, 1);
          fg.rotation.y = Math.sin(state.elapsedClock * 9 + fg.position.z) * 0.2;
        }
      }
    }

    // Sync doors, containers, loot drops, structures, vehicles, zombies, player, VFX
    this.syncDoors(state.doors, targetX, targetZ, isFps);
    this.syncContainers(state.containers, state.player, state.elapsedClock, targetX, targetZ);
    this.syncStructures(state.structures, state.elapsedClock, targetX, targetZ);
    this.syncVehicles(state.vehicles, state.player, state.activeVehicleId, state.elapsedClock, isFps, targetX, targetZ);
    this.syncZombies(state.zombies, state.elapsedClock, targetX, targetZ, state.getCell, isFps, dt);
    this.updateInfectionVfx(dt);
    this.syncPlayer(state, isFps, fpsMeleePose);
    this.syncProjectiles(state.projectiles, state.elapsedClock);
    this.syncFirePatches(state.firePatches, state.elapsedClock);
    this.syncDecals(state.decals);
    this.syncImpactDecals(state.impactDecals, isFps);
    this.syncImpactEffects(state.impactEffects);
    this.syncRipples(state.soundRipples);
    this.syncFishing(state.fishing, state.player, state.elapsedClock, isFps);
    this.syncHighlights(state);
    this.syncParticles(state.particles);
    this.syncAmbientAsh(state.ambientAsh, targetX, targetY, targetZ, state.timeMinutes);
    this.syncWeatherRain(state, targetX, targetY, targetZ, dt, isFps);

    this.renderer.render(this.scene, this.activeCamera);
    this.renderOverlay2D(state, isFps);
  }

  private updateAtmosphereAndLights(
    state: RenderFrameState,
    targetX: number,
    targetY: number,
    targetZ: number,
    isFps: boolean
  ): void {
    const atmo = computeAtmosphereLighting(state.timeMinutes, this.atmoState);
    applyWeatherAndShelterLighting(atmo, state.weather, state.shelterKind, isFps);
    this.skyDome.update(targetX, targetZ, atmo, state.elapsedClock, isFps);

    const nightT = atmo.nightT;
    const inDarkShelter = state.shelterKind === 'cave' || state.shelterKind === 'tunnel';

    // Sky/fog blend (atmospheric dawn/day/dusk/storm horizon in FPS, deep void vignette in ISO)
    const fogCol = isFps ? atmo.fpsFogColor : atmo.isoFogColor;
    (this.scene.background as THREE.Color).copy(fogCol);
    if (this.scene.fog) {
      this.scene.fog.color.copy(fogCol);
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.density = (isFps ? 0.0085 : 0.009) * atmo.fogDensityScale;
      }
    }

    // Dynamic solar/lunar key light & opposite sky rim fill tracking player bounds & elevation
    this.sunLight.position.set(
      targetX + atmo.sunLightOffset.x,
      targetY + atmo.sunLightOffset.y,
      targetZ + atmo.sunLightOffset.z
    );
    this.sunLight.target.position.set(targetX, targetY, targetZ);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.color.copy(atmo.sunColor);
    this.sunLight.intensity = atmo.sunIntensity;

    this.rimLight.position.set(
      targetX + atmo.rimLightOffset.x,
      targetY + atmo.rimLightOffset.y,
      targetZ + atmo.rimLightOffset.z
    );
    this.rimLight.target.position.set(targetX, targetY, targetZ);
    this.rimLight.target.updateMatrixWorld();
    this.rimLight.color.copy(atmo.rimColor);
    this.rimLight.intensity = atmo.rimIntensity;

    this.hemiLight.color.copy(atmo.hemiSkyColor);
    this.hemiLight.groundColor.copy(atmo.hemiGroundColor);
    this.hemiLight.intensity = isFps ? Math.max(0.32 * (1 - nightT * 0.65), atmo.hemiIntensity + 0.05) : atmo.hemiIntensity;
    this.scene.environmentIntensity = atmo.envIntensity;
    this.renderer.toneMappingExposure = atmo.exposure;

    // Player flashlight SpotLight (tracks terrain elevation & vertical pitch in FPS mode!)
    const flashlightOn =
      state.phase !== 'title' &&
      state.activeVehicleId === null &&
      state.player.flashlightOn &&
      state.player.battery > 0;
    if (flashlightOn) {
      const p = state.player;
      const pGroundY = this.groundY(p.x, p.y);
      if (isFps) {
        const fx = Math.cos(p.facingAngle);
        const fz = Math.sin(p.facingAngle);
        const rx = -fz;
        const rz = fx;
        const cosP = Math.cos(state.fpsPitch);
        this.flashlight.position.set(p.x + fx * 0.18 + rx * 0.16, pGroundY + FPS_EYE_HEIGHT - 0.1, p.y + fz * 0.18 + rz * 0.16);
        this.flashlight.target.position.set(
          p.x + fx * cosP * 7,
          pGroundY + FPS_EYE_HEIGHT + Math.sin(state.fpsPitch) * 7,
          p.y + fz * cosP * 7
        );
      } else {
        const tx = p.x + Math.cos(p.facingAngle) * 6;
        const tz = p.y + Math.sin(p.facingAngle) * 6;
        this.flashlight.position.set(p.x, pGroundY + 0.85, p.y);
        this.flashlight.target.position.set(tx, this.groundY(tx, tz), tz);
      }
      this.flashlight.target.updateMatrixWorld();
      this.flashlight.intensity = 3.2 + Math.max(nightT, inDarkShelter ? 0.92 : 0) * 8.5;
      this._flashlightDir.copy(this.flashlight.target.position).sub(this.flashlight.position).normalize();
    } else {
      this.flashlight.intensity = 0;
    }

    syncPixelWaterUniforms(this.waterUniforms, {
      elapsedClock: state.elapsedClock,
      atmo,
      isFps,
      fogDensity: this.fogExp.density,
      flashlightOn,
      flashlightPos: this.flashlight.position,
      flashlightDir: this._flashlightDir,
      ripples: this.waterRipples,
    });

    // Vehicle headlight SpotLights
    let hlIdx = 0;
    for (const v of state.vehicles) {
      if (hlIdx >= this.headlightLights.length) break;
      if (!v.headlightsOn || v.hp <= 0 || dist(v.x, v.y, targetX, targetZ) > 22) continue;
      const hl = this.headlightLights[hlIdx++];
      const fx = Math.cos(v.angle);
      const fz = Math.sin(v.angle);
      const vx0 = v.x + fx * 0.75;
      const vz0 = v.y + fz * 0.75;
      const vx1 = v.x + fx * 7.5;
      const vz1 = v.y + fz * 7.5;
      hl.position.set(vx0, this.groundY(vx0, vz0) + 0.55, vz0);
      hl.target.position.set(vx1, this.groundY(vx1, vz1), vz1);
      hl.target.updateMatrixWorld();
      hl.intensity = 3.2 + Math.max(nightT, inDarkShelter ? 0.65 : 0) * 8.5;
    }
    for (let i = hlIdx; i < this.headlightLights.length; i++) {
      this.headlightLights[i].intensity = 0;
    }

    // Dynamic PointLight allocation for nearest campfires, burn barrels, tunnel lamps, streetlamps, fires & sirens
    const candidates = this._lightCandidates;
    candidates.length = 0;
    const flicker = Math.sin(state.elapsedClock * 13) * 0.45 + Math.cos(state.elapsedClock * 23) * 0.25;

    for (const s of state.structures) {
      if (s.kind !== 'campfire') continue;
      const sx = s.gx + 0.5;
      const sz = s.gy + 0.5;
      const dx = sx - targetX;
      const dz = sz - targetZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < 320) {
        candidates.push({
          x: sx,
          y: this.groundY(sx, sz) + 0.65,
          z: sz,
          color: 0xff8c32,
          intensity: (3.4 + Math.max(nightT, inDarkShelter ? 0.8 : 0) * 2.8) + flicker * 0.7,
          distance: 9.0,
          d2,
        });
      }
    }

    for (const fp of state.firePatches) {
      if (fp.kind !== 'fire') continue;
      const dx = fp.x - targetX;
      const dz = fp.y - targetZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < 320) {
        candidates.push({
          x: fp.x,
          y: this.groundY(fp.x, fp.y) + 0.6,
          z: fp.y,
          color: 0xff7722,
          intensity: 3.5 + flicker,
          distance: 7.5,
          d2,
        });
      }
    }

    const sirenPhase = Math.floor(state.elapsedClock * 7) % 2;
    for (const v of state.vehicles) {
      if (!v.sirenOn || v.hp <= 0) continue;
      const dx = v.x - targetX;
      const dz = v.y - targetZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < 320) {
        candidates.push({
          x: v.x,
          y: this.groundY(v.x, v.y) + 1.15,
          z: v.y,
          color: sirenPhase === 0 ? 0xff453a : 0x3b9eff,
          intensity: 3.6 + nightT * 3.0,
          distance: 8.5,
          d2,
        });
      }
    }

    if (nightT > 0.12 || inDarkShelter || state.weather.rainIntensity > 0.35) {
      const anchorScale = Math.max(0.4 + nightT * 0.8, inDarkShelter ? 0.95 : 0.45);
      for (const cv of this.chunkVisuals.values()) {
        for (const a of cv.lightAnchors) {
          const dx = a.x - targetX;
          const dz = a.z - targetZ;
          const d2 = dx * dx + dz * dz;
          if (d2 < 260) {
            candidates.push({
              x: a.x,
              y: a.y,
              z: a.z,
              color: a.color,
              intensity: a.intensity * anchorScale + (a.flicker ? flicker * 0.6 : 0),
              distance: a.distance,
              d2,
            });
          }
        }
      }
    }

    candidates.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < MAX_DYNAMIC_POINT_LIGHTS; i++) {
      const pl = this.pointLights[i];
      if (i < candidates.length) {
        const c = candidates[i];
        pl.position.set(c.x, c.y, c.z);
        pl.color.setHex(c.color);
        pl.intensity = Math.max(0, c.intensity);
        pl.distance = c.distance;
      } else {
        pl.intensity = 0;
      }
    }
  }

  private syncDoors(doors: DoorEntity[], targetX: number, targetZ: number, isFps: boolean): void {
    const activeIds = this._scratchStrIds;
    activeIds.clear();
    for (const d of doors) {
      if (Math.abs(d.gx - targetX) > 26 || Math.abs(d.gy - targetZ) > 26) continue;
      activeIds.add(d.id);
      let rig = this.doorRigs.get(d.id);
      if (!rig) {
        rig = this.factory.createDoorRig(d.orientation);
        rig.root.position.set(d.gx + 0.5, this.groundY(d.gx + 0.5, d.gy + 0.5), d.gy + 0.5);
        this.scene.add(rig.root);
        this.doorRigs.set(d.id, rig);
      }
      rig.hingePivot.rotation.y = d.openProgress * 1.48;
      rig.padlockGroup.visible = d.status === 'locked';
      rig.barricadeGroup.visible = d.status === 'barricaded';
      rig.fpsLintelGroup.visible = isFps;

      const doorMat = rig.doorMesh.material as THREE.MeshStandardMaterial;
      if (d.hitFlash > 0) {
        doorMat.emissive.setHex(0xffdca0);
        doorMat.emissiveIntensity = 0.7;
      } else {
        doorMat.emissive.setHex(0x000000);
        doorMat.emissiveIntensity = 0;
      }
    }
    for (const [id, rig] of this.doorRigs.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(rig.root);
        this.doorRigs.delete(id);
      }
    }
  }

  private syncContainers(
    containers: LootContainer[],
    player: PlayerState,
    elapsedClock: number,
    targetX: number,
    targetZ: number
  ): void {
    const activeContainers = this._scratchStrIds;
    activeContainers.clear();
    const activeDrops = this._scratchStrIds2;
    activeDrops.clear();

    for (const c of containers) {
      if (Math.abs(c.gx - targetX) > 26 || Math.abs(c.gy - targetZ) > 26) continue;
      if (c.kind === 'zombie_drop') {
        if (c.searched) continue;
        activeDrops.add(c.id);
        let drop = this.lootDropRigs.get(c.id);
        if (!drop) {
          drop = this.factory.createLootDropGroup(getPrimaryLootItem(c.items));
          this.scene.add(drop);
          this.lootDropRigs.set(c.id, drop);
        }
        const bob = Math.sin(elapsedClock * 4 + c.gx * 1.7 + c.gy) * 0.05;
        drop.position.set(c.gx + 0.5, this.groundY(c.gx + 0.5, c.gy + 0.5) + 0.04 + bob, c.gy + 0.5);
        drop.rotation.y = Math.sin(elapsedClock * 1.8 + c.gx) * 0.25;
        const itemSprite = drop.userData.itemSprite as THREE.Sprite | undefined;
        if (itemSprite) {
          itemSprite.position.y = 0.54 + Math.sin(elapsedClock * 3.8 + c.gx) * 0.05;
        }
        continue;
      }

      if (c.kind === 'car_police' || c.kind === 'car_sedan') continue;
      activeContainers.add(c.id);
      let rig = this.containerRigs.get(c.id);
      if (!rig) {
        rig = this.factory.createLootContainerRig(c.kind);
        rig.root.position.set(c.gx + 0.5, this.groundY(c.gx + 0.5, c.gy + 0.5), c.gy + 0.5);
        this.scene.add(rig.root);
        this.containerRigs.set(c.id, rig);
      }

      const openAmt = c.searched ? Math.max(0.85, c.openAnim ?? 1) : (c.openAnim ?? 0);
      if (c.kind === 'crate_wood' || c.kind === 'crate_military') {
        rig.lidPivot.rotation.x = -openAmt * 1.65;
      } else {
        rig.lidPivot.rotation.y = openAmt * 1.6;
      }

      if (c.popTimer && c.popTimer > 0) {
        const pop = getLootPopTransform(c.popTimer);
        rig.root.scale.set(pop.scaleX, pop.scaleY, pop.scaleX);
      } else {
        rig.root.scale.set(1, 1, 1);
      }

      const showGlint = !c.searched && dist(player.x, player.y, c.gx + 0.5, c.gy + 0.5) < 8.5;
      rig.glintMesh.visible = showGlint;
      if (showGlint) {
        rig.glintMesh.rotation.y = elapsedClock * 3.5;
        rig.glintMesh.scale.setScalar(0.09 * (0.85 + Math.sin(elapsedClock * 5) * 0.3));
      }
    }

    for (const [id, rig] of this.containerRigs.entries()) {
      if (!activeContainers.has(id)) {
        this.scene.remove(rig.root);
        this.containerRigs.delete(id);
      }
    }
    for (const [id, drop] of this.lootDropRigs.entries()) {
      if (!activeDrops.has(id)) {
        this.scene.remove(drop);
        this.disposeLootDropMaterials(drop);
        this.lootDropRigs.delete(id);
      }
    }
  }

  private syncStructures(structures: WorldStructure[], elapsedClock: number, targetX: number, targetZ: number): void {
    const activeIds = this._scratchStrIds;
    activeIds.clear();
    for (const s of structures) {
      if (Math.abs(s.gx + 0.5 - targetX) > 32 || Math.abs(s.gy + 0.5 - targetZ) > 32) continue;
      activeIds.add(s.id);
      let g = this.structureRigs.get(s.id);
      if (!g) {
        g = this.factory.createStructureGroup(s.kind);
        g.position.set(s.gx + 0.5, this.groundY(s.gx + 0.5, s.gy + 0.5), s.gy + 0.5);
        this.scene.add(g);
        this.structureRigs.set(s.id, g);
      }
      if (s.kind === 'campfire') {
        const fg = g.userData.flameGroup as THREE.Group | undefined;
        if (fg) {
          const phase = s.gx * 2.1 + s.gy * 1.3;
          const flick = 0.88 + Math.sin(elapsedClock * 15 + phase) * 0.22;
          fg.scale.set(1, flick, 1);
          fg.rotation.y = Math.sin(elapsedClock * 7.5 + s.gy) * 0.22;
          const tongues = fg.userData.tongues as THREE.Object3D[] | undefined;
          if (tongues) {
            for (let i = 0; i < tongues.length; i++) {
              const t = tongues[i];
              if (t.userData.baseScaleY === undefined) {
                t.userData.baseScaleY = t.scale.y;
                t.userData.baseRotZ = t.rotation.z;
              }
              const wave = Math.sin(elapsedClock * (14 + i * 2.3) + phase + i * 1.7);
              t.scale.y = (t.userData.baseScaleY as number) * (0.82 + wave * 0.26);
              t.rotation.z = (t.userData.baseRotZ as number) + Math.cos(elapsedClock * 11 + i * 1.4) * 0.08;
            }
          }
          const embers = fg.userData.embers as THREE.Mesh[] | undefined;
          if (embers) {
            for (let i = 0; i < embers.length; i++) {
              const em = embers[i];
              const cycle = ((elapsedClock * 0.95 + i * 0.21 + s.gx * 0.13) % 1 + 1) % 1;
              const ang = elapsedClock * 2.6 + i * 1.6;
              const r = 0.06 + cycle * 0.11;
              em.position.set(Math.cos(ang) * r, 0.14 + cycle * 0.72, Math.sin(ang) * r);
              em.scale.setScalar(0.18 * (1 - cycle * 0.72));
            }
          }
        }
      }
      const scaleFlash = s.hitFlash > 0 ? 1.06 : 1;
      g.scale.set(scaleFlash, scaleFlash, scaleFlash);
    }
    for (const [id, g] of this.structureRigs.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(g);
        this.structureRigs.delete(id);
      }
    }
  }

  private syncVehicles(
    vehicles: Vehicle[],
    player: PlayerState,
    activeVehicleId: number | null,
    elapsedClock: number,
    isFps: boolean,
    targetX: number,
    targetZ: number
  ): void {
    const activeIds = this._scratchNumIds;
    activeIds.clear();
    const sirenPhase = Math.floor(elapsedClock * 7) % 2;

    for (const v of vehicles) {
      if (v.id !== activeVehicleId && (Math.abs(v.x - targetX) > 34 || Math.abs(v.y - targetZ) > 34)) continue;
      activeIds.add(v.id);
      let rig = this.vehicleRigs.get(v.id);
      if (!rig) {
        rig = this.factory.createVehicleRig(v.kind);
        this.scene.add(rig.root);
        this.vehicleRigs.set(v.id, rig);
      }
      const vSurf = sampleTerrainSurface(this.activeSeed, v.x, v.y, this.activeFace);
      rig.root.position.set(v.x, vSurf.height, v.y);
      rig.root.rotation.order = 'YXZ';
      rig.root.rotation.y = -v.angle;
      // Align vehicle pitch & roll cleanly along hill grades and arched bridges
      const fwdX = Math.cos(v.angle);
      const fwdZ = Math.sin(v.angle);
      const rightX = -fwdZ;
      const rightZ = fwdX;
      const slopeFwd = -(vSurf.normalX * fwdX + vSurf.normalZ * fwdZ) / Math.max(0.25, vSurf.normalY);
      const slopeRight = -(vSurf.normalX * rightX + vSurf.normalZ * rightZ) / Math.max(0.25, vSurf.normalY);
      const targetPitch = clamp(Math.atan(slopeFwd), -0.46, 0.46);
      const targetRoll = clamp(-Math.atan(slopeRight), -0.38, 0.38);
      rig.root.rotation.z += (targetPitch - rig.root.rotation.z) * 0.24;
      rig.root.rotation.x += (targetRoll - rig.root.rotation.x) * 0.24;
      const inFpsCar = isFps && activeVehicleId === v.id;
      rig.cabGroup.visible = !inFpsCar;
      rig.cockpitGroup.visible = inFpsCar;

      // Compute smooth real-time steering angle from angular velocity
      let dAng = v.angle - rig.prevAngle;
      while (dAng > Math.PI) dAng -= Math.PI * 2;
      while (dAng < -Math.PI) dAng += Math.PI * 2;
      rig.prevAngle = v.angle;
      const targetSteer = clamp(dAng * 14, -0.55, 0.55);
      rig.steerSmooth += (targetSteer - rig.steerSmooth) * 0.22;

      // Animate front wheels turning into corners + wheel spin + realistic body roll/pitch
      rig.wheelFL.rotation.y = -rig.steerSmooth * 0.68;
      rig.wheelFR.rotation.y = -rig.steerSmooth * 0.68;
      const wheelSpin = elapsedClock * v.speed * 4.5;
      for (const wm of rig.wheelMeshes) {
        wm.rotation.z = -wheelSpin;
      }
      const engineRumble = Math.abs(v.speed) > 0.2 ? Math.sin(elapsedClock * 38) * 0.0022 : Math.sin(elapsedClock * 16) * 0.0008;
      rig.bodyGroup.position.y = engineRumble;
      rig.bodyGroup.rotation.z = clamp(v.speed * 0.006, -0.045, 0.045);
      rig.bodyGroup.rotation.x = clamp(-rig.steerSmooth * Math.min(1, Math.abs(v.speed) / 6) * 0.08, -0.06, 0.06);
      rig.trunkPivot.rotation.z = v.trunkSearched ? -0.9 : 0;

      // Live First-Person Cockpit Dashboard & Steering Wheel Animation
      if (inFpsCar) {
        rig.steeringWheel.rotation.x = rig.steerSmooth * 1.45;
        const speedNorm = clamp(Math.abs(v.speed) / 13.5, 0.04, 1.0);
        rig.speedBar.scale.z = speedNorm;
        const fuelNorm = clamp(v.fuel / 100, 0.02, 1.0);
        rig.fuelBar.scale.z = fuelNorm;
        const fMat = rig.fuelBar.material as THREE.MeshStandardMaterial;
        if (fuelNorm < 0.2) {
          fMat.color.set('#ff4a42');
          fMat.emissive.set('#ff4a42');
          fMat.emissiveIntensity = 1.2 + Math.sin(elapsedClock * 10) * 0.6;
        } else if (fuelNorm < 0.45) {
          fMat.color.set('#f0d078');
          fMat.emissive.set('#f0d078');
          fMat.emissiveIntensity = 1.2;
        } else {
          fMat.color.set('#5ef28f');
          fMat.emissive.set('#5ef28f');
          fMat.emissiveIntensity = 1.3;
        }
        const bMat = rig.boostLed.material as THREE.MeshStandardMaterial;
        bMat.emissiveIntensity = v.boosting ? 2.4 : 0.15;
      }

      // Dynamic headlight DRL brightness
      for (const hl of rig.headLights) {
        const hm = hl.material as THREE.MeshStandardMaterial;
        hm.emissiveIntensity = v.headlightsOn && v.hp > 0 ? 2.4 : 0.35;
      }

      // Brake lights
      const braking = v.speed < -0.2 || v.drifting;
      for (const tl of rig.tailLights) {
        const m = tl.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = braking ? 1.8 : 0.45;
      }

      if (rig.sirenRed && rig.sirenBlue) {
        const rMat = rig.sirenRed.material as THREE.MeshStandardMaterial;
        const bMat = rig.sirenBlue.material as THREE.MeshStandardMaterial;
        if (v.sirenOn && v.hp > 0) {
          rMat.emissiveIntensity = sirenPhase === 0 ? 2.4 : 0.15;
          bMat.emissiveIntensity = sirenPhase === 1 ? 2.4 : 0.15;
        } else {
          rMat.emissiveIntensity = 0.2;
          bMat.emissiveIntensity = 0.2;
        }
      }

      const showGlint =
        !v.trunkSearched && activeVehicleId !== v.id && dist(player.x, player.y, v.x, v.y) < 8.5;
      rig.glintMesh.visible = showGlint;
      if (showGlint) {
        rig.glintMesh.rotation.y = elapsedClock * 3.5;
        rig.glintMesh.scale.setScalar(0.09 * (0.85 + Math.sin(elapsedClock * 5) * 0.3));
      }
    }

    for (const [id, rig] of this.vehicleRigs.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(rig.root);
        this.vehicleRigs.delete(id);
      }
    }
  }

  private acquireZombieEntry(archetype: ZombieArchetype): { rig: ActorRig3D; ring: THREE.Mesh } {
    const bucket = this.zombieRigPool.get(archetype);
    if (bucket && bucket.length > 0) {
      const reused = bucket.pop()!;
      this.pooledZombieCount--;
      reused.rig.root.visible = true;
      reused.ring.visible = false;
      return reused;
    }
    const rig = this.factory.createActorRig(archetype);
    const ring = new THREE.Mesh(
      this.zombieRingGeo,
      archetype === 'spitter' ? this.zombieRingMatMint : this.zombieRingMatRed
    );
    ring.visible = false;
    this.scene.add(rig.root);
    this.scene.add(ring);
    return { rig, ring };
  }

  private recycleZombieEntry(archetype: ZombieArchetype, rig: ActorRig3D, ring: THREE.Mesh): void {
    rig.root.visible = false;
    ring.visible = false;
    if (this.pooledZombieCount < MAX_POOLED_ZOMBIES) {
      let bucket = this.zombieRigPool.get(archetype);
      if (!bucket) {
        bucket = [];
        this.zombieRigPool.set(archetype, bucket);
      }
      bucket.push({ rig, ring });
      this.pooledZombieCount++;
      return;
    }
    this.scene.remove(rig.root);
    this.scene.remove(ring);
    for (const m of rig.allMaterials) m.dispose();
  }

  private spawnInfectionDrop(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    colorHex: number
  ): void {
    const slot = this.infectDrops[this.infectDropCursor];
    this.infectDropCursor = (this.infectDropCursor + 1) % MAX_INFECT_DROPS;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.size = size;
    slot.life = 0.58;
    slot.maxLife = 0.58;
    slot.color = colorHex;
  }

  private spawnSporePuff(x: number, y: number, z: number, colorHex: number, sizeScale: number): void {
    const slot = this.sporePuffs[this.sporePuffCursor];
    this.sporePuffCursor = (this.sporePuffCursor + 1) % MAX_SPORE_PUFFS;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = (Math.random() - 0.5) * 0.24;
    slot.vy = 0.22 + Math.random() * 0.22;
    slot.vz = (Math.random() - 0.5) * 0.24;
    slot.size = (0.75 + Math.random() * 0.55) * sizeScale;
    slot.life = 0.85;
    slot.maxLife = 0.85;
    slot.rot = Math.random() * Math.PI * 2;
    slot.color = colorHex;
  }

  private updateInfectionVfx(dt: number): void {
    let dropCount = 0;
    _quat.identity();
    for (let i = 0; i < MAX_INFECT_DROPS; i++) {
      const d = this.infectDrops[i];
      if (!d.active) continue;
      d.life -= dt;
      const floorY = this.groundY(d.x, d.z) + 0.015;
      if (d.life <= 0 || d.y <= floorY) {
        d.active = false;
        continue;
      }
      d.vy -= 4.8 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      const t = clamp(d.life / d.maxLife, 0, 1);
      const s = d.size * (0.45 + 0.55 * t);
      _vec3A.set(d.x, Math.max(floorY + 0.005, d.y), d.z);
      _scale.set(s * 0.72, s * 1.65, s * 0.72);
      _mat4.compose(_vec3A, _quat, _scale);
      this.infectDropInstanced.setMatrixAt(dropCount, _mat4);
      _color.setHex(d.color);
      this.infectDropInstanced.setColorAt(dropCount, _color);
      dropCount++;
    }
    this.infectDropInstanced.count = dropCount;
    if (dropCount > 0) {
      this.infectDropInstanced.instanceMatrix.needsUpdate = true;
      if (this.infectDropInstanced.instanceColor) this.infectDropInstanced.instanceColor.needsUpdate = true;
    }

    let puffCount = 0;
    for (let i = 0; i < MAX_SPORE_PUFFS; i++) {
      const p = this.sporePuffs[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += dt * 1.4;
      const age = 1 - clamp(p.life / p.maxLife, 0, 1);
      const env = Math.sin(age * Math.PI);
      const s = p.size * (0.5 + age * 0.85) * env;
      _euler.set(p.rot * 0.6, p.rot, p.rot * 0.4);
      _quat.setFromEuler(_euler);
      _vec3A.set(p.x, p.y, p.z);
      _scale.setScalar(Math.max(0.001, s));
      _mat4.compose(_vec3A, _quat, _scale);
      this.sporePuffInstanced.setMatrixAt(puffCount, _mat4);
      _color.setHex(p.color);
      this.sporePuffInstanced.setColorAt(puffCount, _color);
      puffCount++;
    }
    this.sporePuffInstanced.count = puffCount;
    if (puffCount > 0) {
      this.sporePuffInstanced.instanceMatrix.needsUpdate = true;
      if (this.sporePuffInstanced.instanceColor) this.sporePuffInstanced.instanceColor.needsUpdate = true;
    }
  }

  private syncZombies(
    zombies: Zombie[],
    elapsedClock: number,
    targetX: number,
    targetZ: number,
    getCell: (gx: number, gy: number) => TileCell,
    isFps: boolean,
    dt: number
  ): void {
    const activeIds = this._scratchNumIds;
    activeIds.clear();
    for (const z of zombies) {
      if (Math.abs(z.x - targetX) > 34 || Math.abs(z.y - targetZ) > 34) continue;
      activeIds.add(z.id);
      let entry = this.zombieRigs.get(z.id);
      if (!entry) {
        const acquired = this.acquireZombieEntry(z.archetype);
        entry = {
          rig: acquired.rig,
          archetype: z.archetype,
          ring: acquired.ring,
          wasFading: false,
          wasFlashing: false,
          salivaPhase: ((z.id * 0.37) % 1 + 1) % 1,
          oozeTimer: ((z.id * 0.53) % 1 + 1) % 1,
          sporeTimer: ((z.id * 0.71) % 1 + 1) % 1,
        };
        this.zombieRigs.set(z.id, entry);
      }

      const { rig, ring } = entry;
      const zGroundY = this.groundY(z.x, z.y);
      const inWater = z.state !== 'dying' && getCell(Math.floor(z.x), Math.floor(z.y)).tile === 'water';
      rig.root.position.set(z.x, zGroundY + (inWater ? -0.22 * z.scaleY : 0), z.y);
      const facingAngle = Math.atan2(z.facingY, z.facingX);
      rig.root.rotation.y = -facingAngle;
      rig.root.scale.set(z.scaleX, z.scaleY, z.scaleX);
      // Keep windup telegraph ring elevated cleanly on slopes
      ring.position.y = zGroundY + 0.035;

      const animState = resolveZombieAnimState({
        state: z.state,
        isMoving: z.state === 'chase' || z.state === 'wander' || z.state === 'alert',
      });

      const camDist = Math.hypot(z.x - targetX, z.y - targetZ);
      const lod = computeZombieVisualLod({
        distance: camDist,
        isFps,
        isSoftwareGl: this.isSoftwareGl,
      });
      const preset = ZOMBIE_VISUAL_PRESETS[z.archetype];

      if (rig.zombieUniforms) {
        rig.zombieUniforms.uZTime.value = elapsedClock;
        rig.zombieUniforms.uZSeed.value = (z.id % 97) + 1;
        rig.zombieUniforms.uZDetail.value = lod.shaderDetail;
        const skinDeform = evaluateSkinDeformIntensity({
          archetype: z.archetype,
          animState,
          walkCycle: z.walkCycle,
        });
        rig.zombieUniforms.uZDeformAmp.value = skinDeform.deformAmp;
        rig.zombieUniforms.uZLunge.value = skinDeform.lungeStretch;
        rig.zombieUniforms.uZWalkPhase.value = z.walkCycle;
      }

      const jawPose = evaluateJawAndSpasm({
        time: elapsedClock,
        seed: z.id,
        archetype: z.archetype,
        state: z.state,
        stateTimer: z.stateTimer,
      });

      // Windup ground telegraph ring
      ring.visible = z.state === 'windup';
      if (ring.visible) {
        ring.position.set(z.x, zGroundY + 0.035, z.y);
        const pulse = 0.9 + Math.sin(elapsedClock * 18) * 0.12;
        ring.scale.set(pulse, 1, pulse);
      }

      // Articulated 3D animation + infection twitches + jaw snap
      if (rig.jawPivot) {
        rig.jawPivot.rotation.z = -jawPose.jawOpenAngle;
      }

      if (animState === 'dying') {
        const fallProg = clamp(1 - z.stateTimer / 0.52, 0, 1);
        rig.bodyPivot.rotation.z = fallProg * 1.48;
        rig.bodyPivot.position.y = fallProg * 0.18;
        const fade = clamp(z.stateTimer / 0.22, 0, 1);
        entry.wasFading = true;
        for (const m of rig.allMaterials) {
          m.transparent = fade < 0.99;
          m.opacity = fade;
        }
      } else {
        rig.bodyPivot.rotation.z = 0;
        if (entry.wasFading) {
          entry.wasFading = false;
          for (const m of rig.allMaterials) {
            m.transparent = false;
            m.opacity = 1;
          }
        }
        const isRunner = z.archetype === 'runner';
        const isBloater = z.archetype === 'bloater';
        const isSpitter = z.archetype === 'spitter';

        // Archetype-distinct predatory undead arm reach & hunched posture (zero stiff T-pose!)
        const baseTorsoLean = isRunner ? -0.26 : isSpitter ? -0.22 : isBloater ? -0.10 : -0.15;
        const baseArmL = isRunner ? -0.88 : isSpitter ? -0.62 : isBloater ? -0.96 : -0.34;
        const baseArmR = isRunner ? -0.82 : isSpitter ? -0.78 : isBloater ? -1.04 : -0.94; // Asymmetric shambling Walker reach!
        const baseElbowL = isRunner ? 0.96 : isSpitter ? 0.36 : isBloater ? 0.48 : 0.36;
        const baseElbowR = isRunner ? 0.90 : isSpitter ? 0.48 : isBloater ? 0.44 : 0.56;

        if (animState === 'walk') {
          const phase = z.walkCycle * (isRunner ? 1.35 : 1.1);
          const s = Math.sin(phase);
          const limpBias = z.archetype === 'walker' ? 0.14 : 0;
          rig.leftLegPivot.rotation.z = s * (isBloater ? 0.44 : 0.56) + 0.12;
          rig.rightLegPivot.rotation.z = -s * (isBloater ? 0.44 : 0.56) + 0.12 - limpBias;
          if (rig.leftKneePivot && rig.rightKneePivot) {
            rig.leftKneePivot.rotation.z = -0.16 - Math.max(0, -s) * (isRunner ? 0.72 : 0.52);
            rig.rightKneePivot.rotation.z = -0.16 - Math.max(0, s) * (isRunner ? 0.72 : 0.52);
          }
          rig.leftArmPivot.rotation.z = baseArmL + Math.sin(phase + 0.5) * 0.20 + jawPose.armTwitchL;
          rig.rightArmPivot.rotation.z = baseArmR - Math.sin(phase + 0.5) * 0.20 + jawPose.armTwitchR;
          if (rig.leftElbowPivot && rig.rightElbowPivot) {
            rig.leftElbowPivot.rotation.z = baseElbowL + Math.cos(phase) * 0.14;
            rig.rightElbowPivot.rotation.z = baseElbowR - Math.cos(phase) * 0.14;
          }
          rig.bodyPivot.position.y = Math.abs(Math.cos(phase)) * (isBloater ? 0.035 : 0.05) - 0.025;
          rig.torso.rotation.z = baseTorsoLean + jawPose.torsoTwitchZ;
          rig.torso.rotation.y = Math.sin(phase) * 0.08;
          rig.torso.rotation.x = Math.sin(phase) * (z.archetype === 'walker' ? 0.09 : isBloater ? 0.08 : 0.05);
        } else if (animState === 'windup') {
          rig.leftLegPivot.rotation.z = 0.24;
          rig.rightLegPivot.rotation.z = -0.18;
          if (rig.leftKneePivot && rig.rightKneePivot) {
            rig.leftKneePivot.rotation.z = -0.36;
            rig.rightKneePivot.rotation.z = -0.26;
          }
          if (isSpitter) {
            // Spitter hunches forward and pulls claws down-back while heaving acid from glowing throat sac
            rig.leftArmPivot.rotation.z = -1.08 + jawPose.armTwitchL;
            rig.rightArmPivot.rotation.z = -1.04 + jawPose.armTwitchR;
            if (rig.leftElbowPivot && rig.rightElbowPivot) {
              rig.leftElbowPivot.rotation.z = 0.56;
              rig.rightElbowPivot.rotation.z = 0.52;
            }
            rig.torso.rotation.z = -0.30 + jawPose.torsoTwitchZ;
            rig.torso.rotation.y = 0;
            rig.torso.rotation.x = 0;
          } else {
            // Predatory asymmetric slash coil: right claw cocked back/up, left claw braced low-forward (NO surrender hands-up!)
            rig.leftArmPivot.rotation.z = -0.78 + jawPose.armTwitchL;
            rig.rightArmPivot.rotation.z = 0.12 + jawPose.armTwitchR;
            if (rig.leftElbowPivot && rig.rightElbowPivot) {
              rig.leftElbowPivot.rotation.z = 0.54;
              rig.rightElbowPivot.rotation.z = 0.58;
            }
            rig.torso.rotation.z = -0.06 + jawPose.torsoTwitchZ;
            rig.torso.rotation.y = -0.24;
            rig.torso.rotation.x = 0.06;
          }
          rig.bodyPivot.position.y = -0.055;
        } else if (animState === 'attack') {
          rig.leftLegPivot.rotation.z = 0.32;
          rig.rightLegPivot.rotation.z = -0.28;
          if (rig.leftKneePivot && rig.rightKneePivot) {
            rig.leftKneePivot.rotation.z = -0.40;
            rig.rightKneePivot.rotation.z = -0.22;
          }
          rig.leftArmPivot.rotation.z = -0.42 + jawPose.armTwitchL;
          rig.rightArmPivot.rotation.z = -0.58 + jawPose.armTwitchR;
          if (rig.leftElbowPivot && rig.rightElbowPivot) {
            rig.leftElbowPivot.rotation.z = 0.34;
            rig.rightElbowPivot.rotation.z = 0.24;
          }
          rig.torso.rotation.z = -0.36 + jawPose.torsoTwitchZ;
          rig.torso.rotation.y = 0.26;
          rig.torso.rotation.x = -0.05;
          rig.bodyPivot.position.y = -0.025;
        } else {
          const sway = Math.sin(elapsedClock * 2.2 + z.id);
          rig.leftLegPivot.rotation.z = 0.10;
          rig.rightLegPivot.rotation.z = 0.04;
          if (rig.leftKneePivot && rig.rightKneePivot) {
            rig.leftKneePivot.rotation.z = -0.18;
            rig.rightKneePivot.rotation.z = -0.12;
          }
          rig.leftArmPivot.rotation.z = baseArmL + sway * 0.08 + jawPose.armTwitchL;
          rig.rightArmPivot.rotation.z = baseArmR - sway * 0.08 + jawPose.armTwitchR;
          if (rig.leftElbowPivot && rig.rightElbowPivot) {
            rig.leftElbowPivot.rotation.z = baseElbowL + sway * 0.06;
            rig.rightElbowPivot.rotation.z = baseElbowR - sway * 0.06;
          }
          rig.torso.rotation.z = baseTorsoLean * 0.85 + jawPose.torsoTwitchZ;
          rig.torso.rotation.y = sway * 0.05;
          rig.torso.rotation.x = sway * 0.04;
          rig.bodyPivot.position.y = -0.02 + Math.sin(elapsedClock * 2.6 + z.id) * 0.014;
        }
      }

      const baseHeadTiltX = z.archetype === 'walker' ? 0.12 : z.archetype === 'spitter' ? -0.06 : 0;
      const headCounterZ = animState === 'dying' ? 0 : -rig.torso.rotation.z * 0.82;
      rig.headPivot.rotation.set(
        baseHeadTiltX + jawPose.headTwitchX,
        jawPose.headTwitchY,
        headCounterZ + jawPose.headTwitchZ
      );

      // Macro blister swell, pulse & contraction (preserving surface-normal orientation!)
      if (rig.blisters && rig.blisters.length > 0) {
        if (lod.enableBlisterAnim && animState !== 'dying') {
          for (let bi = 0; bi < rig.blisters.length; bi++) {
            const b = rig.blisters[bi];
            const pulse = evaluateBlisterPulse({
              time: elapsedClock,
              seed: z.id,
              archetype: z.archetype,
              state: z.state,
              blisterIndex: bi,
            });
            const rScale = 1 + (pulse.radialScale - 1) * 0.45;
            const aScale = 1 + (pulse.axialStretch - 1) * 0.55;
            b.mesh.scale.set(
              b.baseScale.x * rScale,
              b.baseScale.y * aScale,
              b.baseScale.z * rScale
            );
          }
        } else {
          for (let bi = 0; bi < rig.blisters.length; bi++) {
            const b = rig.blisters[bi];
            b.mesh.scale.copy(b.baseScale);
          }
        }
      }

      // Close-up saliva drool strand, mouth droplets, oozing pus/bile & toxic spore puffs
      const showMicro = lod.enableMicroVfx && animState !== 'dying';
      if (rig.salivaStrand) {
        rig.salivaStrand.visible = showMicro;
        if (showMicro) {
          const salivaSample = evaluateSalivaStrandCycle({
            prevPhase: entry.salivaPhase,
            dt,
            archetype: z.archetype,
            jawOpenAngle: jawPose.jawOpenAngle,
            isSnapping: jawPose.isSnapping,
          });
          entry.salivaPhase = salivaSample.phase;
          rig.salivaStrand.scale.set(
            salivaSample.strandThickness,
            salivaSample.strandLength,
            salivaSample.strandThickness
          );
          if (salivaSample.emitDrop && rig.mouthAnchor) {
            rig.root.updateMatrixWorld(true);
            rig.mouthAnchor.getWorldPosition(_vec3A);
            this.spawnInfectionDrop(
              _vec3A.x,
              _vec3A.y,
              _vec3A.z,
              z.facingX * 0.24 + (Math.random() - 0.5) * 0.12,
              -0.32,
              z.facingY * 0.24 + (Math.random() - 0.5) * 0.12,
              0.9,
              preset.salivaColorHex
            );
          }
        }
      }

      if (showMicro && rig.oozeAnchors && rig.oozeAnchors.length > 0 && dt > 0) {
        entry.oozeTimer += dt * preset.oozeRate;
        if (entry.oozeTimer >= 1.0) {
          entry.oozeTimer -= Math.floor(entry.oozeTimer);
          rig.root.updateMatrixWorld(true);
          const idx = Math.floor((elapsedClock * 7 + z.id) % rig.oozeAnchors.length);
          rig.oozeAnchors[idx].getWorldPosition(_vec3A);
          this.spawnInfectionDrop(
            _vec3A.x,
            _vec3A.y,
            _vec3A.z,
            (Math.random() - 0.5) * 0.28,
            -0.14,
            (Math.random() - 0.5) * 0.28,
            1.05,
            preset.pusColorHex
          );
        }

        entry.sporeTimer += dt * preset.sporeRate;
        if (entry.sporeTimer >= 1.0) {
          entry.sporeTimer -= Math.floor(entry.sporeTimer);
          rig.root.updateMatrixWorld(true);
          const idx = Math.floor((elapsedClock * 5 + z.id * 3) % rig.oozeAnchors.length);
          rig.oozeAnchors[idx].getWorldPosition(_vec3A);
          const puffScale = z.archetype === 'bloater' || z.archetype === 'spitter' ? 1.35 : 0.85;
          this.spawnSporePuff(_vec3A.x, _vec3A.y, _vec3A.z, preset.sporeColorHex, puffScale);
        }
      }

      // Hit flash white emissive (only mutate when active or resetting)
      const flash = z.hitFlash > 0;
      if (flash || entry.wasFlashing) {
        entry.wasFlashing = flash;
        for (const mat of rig.flashMaterials) {
          if (flash) {
            mat.emissive.setHex(0xffffff);
            mat.emissiveIntensity = 0.85;
          } else {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
      }
    }

    for (const [id, entry] of this.zombieRigs.entries()) {
      if (!activeIds.has(id)) {
        if (entry.wasFading) {
          for (const m of entry.rig.allMaterials) {
            m.transparent = false;
            m.opacity = 1;
          }
        }
        if (entry.wasFlashing) {
          for (const mat of entry.rig.flashMaterials) {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
        this.recycleZombieEntry(entry.archetype, entry.rig, entry.ring);
        this.zombieRigs.delete(id);
      }
    }
  }

  private syncPlayer(
    state: RenderFrameState,
    isFps: boolean,
    fpsMeleePose: FirstPersonMeleeSwingPose | null
  ): void {
    const p = state.player;
    const thirdPersonVisible = !isFps && state.phase !== 'title' && state.activeVehicleId === null;
    this.playerRig.root.visible = thirdPersonVisible;
    this.meleeArcMesh.visible = false;

    const animState = resolvePlayerAnimState({
      dodgeTimer: p.dodgeTimer,
      meleeSwingTimer: p.meleeSwingTimer,
      attackCooldown: p.attackCooldown,
      attackCooldownMax: WEAPONS[p.equippedWeapon].cooldown,
      walkCycle: p.walkCycle,
    });

    // Sync First-Person 3D pixel-art viewmodel attached to fpsCamera
    const showViewmodel = isFps && state.phase === 'playing' && state.activeVehicleId === null;
    this.fpsViewmodelRig.root.visible = showViewmodel;
    if (!showViewmodel) {
      this.fpsSlashMesh.visible = false;
    } else {
      for (const wKey of Object.keys(this.fpsViewmodelRig.weapons) as Array<keyof typeof this.fpsViewmodelRig.weapons>) {
        this.fpsViewmodelRig.weapons[wKey].visible =
          state.fishing.phase === 'idle' && wKey === p.equippedWeapon && animState !== 'dodge';
      }
      this.fpsViewmodelRig.fishingRod.visible = state.fishing.phase !== 'idle';
      const showMuzzle =
        state.muzzleFlashTimer > 0 &&
        (p.equippedWeapon === 'pistol' || p.equippedWeapon === 'shotgun' || p.equippedWeapon === 'lmg');
      this.fpsViewmodelRig.muzzleFlash.visible = showMuzzle;
      if (showMuzzle) {
        this.fpsViewmodelRig.muzzleFlash.position.x =
          p.equippedWeapon === 'pistol' ? 0.33 : p.equippedWeapon === 'shotgun' ? 0.65 : 0.72;
      }

      const speedNow = Math.hypot(state.playerVelX, state.playerVelY);
      const bob = getSettings().fpsHeadBob
        ? computeFirstPersonHeadBob(p.walkCycle, speedNow, state.isSprinting, p.dodgeTimer)
        : { eyeOffsetY: 0, swayX: 0, swayY: 0 };
      const idleBreathY = Math.sin(state.elapsedClock * 2.4) * 0.006;
      const idleBreathX = Math.cos(state.elapsedClock * 1.4) * 0.004;
      const raiseDip = computeFirstPersonWeaponRaiseOffset(state.weaponSwapTimer);

      let posX = 0.24 + bob.swayX + idleBreathX;
      let posY = -0.22 - bob.swayY + idleBreathY + raiseDip;
      let posZ = -0.38;
      let rotX = 0;
      let rotY = 0;
      let rotZ = state.weaponSwapTimer > 0 ? state.weaponSwapTimer * 1.2 : 0;

      if (p.equippedWeapon === 'molotov') {
        const fPulse = 0.85 + Math.sin(state.elapsedClock * 19) * 0.22;
        this.fpsViewmodelRig.molotovFlame.scale.set(1, fPulse, 1);
        this.fpsViewmodelRig.molotovFlame.rotation.y = Math.sin(state.elapsedClock * 11) * 0.25;
      }

      if (isMeleeWeapon(p.equippedWeapon)) {
        const grip = getFirstPersonMeleeGripPose(p.equippedWeapon);
        const wObj = this.fpsViewmodelRig.weapons[p.equippedWeapon];
        wObj.rotation.order = 'ZYX';
        wObj.position.set(grip.posX, grip.posY, grip.posZ);
        if (fpsMeleePose && p.meleeSwingTimer > 0 && p.reloadingTimer <= 0 && p.dodgeTimer <= 0) {
          wObj.rotation.set(
            grip.rollX + fpsMeleePose.wristRollX,
            grip.yawY + fpsMeleePose.wristYawY,
            grip.pitchZ + fpsMeleePose.wristPitchZ
          );
        } else {
          wObj.rotation.set(grip.rollX, grip.yawY, grip.pitchZ);
        }
      }

      if (p.reloadingTimer > 0) {
        const total = WEAPONS[p.reloadingWeapon ?? p.equippedWeapon].reloadTime || 1;
        const prog = clamp(1 - p.reloadingTimer / total, 0, 1);
        const dip = Math.sin(prog * Math.PI);
        posY -= dip * 0.14;
        rotX -= dip * 0.55;
        rotZ += dip * 0.25;
        this.fpsSlashMesh.visible = false;
      } else if (fpsMeleePose && p.meleeSwingTimer > 0 && isMeleeWeapon(p.equippedWeapon)) {
        posX += fpsMeleePose.armPosX;
        posY += fpsMeleePose.armPosY;
        posZ += fpsMeleePose.armPosZ;
        rotX += fpsMeleePose.armRotX;
        rotY += fpsMeleePose.armRotY;
        rotZ += fpsMeleePose.armRotZ;

        this.fpsSlashMesh.visible = fpsMeleePose.slashVisible;
        if (fpsMeleePose.slashVisible) {
          const slashMat = this.fpsSlashMesh.material as THREE.MeshBasicMaterial;
          slashMat.color.setHex(WEAPONS[p.equippedWeapon].arcColor ?? 0xf2eee2);
          slashMat.opacity = fpsMeleePose.slashAlpha;
          this.fpsSlashMesh.rotation.z = fpsMeleePose.slashAngleZ;
          this.fpsSlashMesh.position.set(
            Math.sin(fpsMeleePose.slashAngleZ) * 0.14,
            -0.02 - Math.cos(fpsMeleePose.slashAngleZ) * 0.08,
            -0.58
          );
          const sx = (fpsMeleePose.slashFlipX ? -1 : 1) * fpsMeleePose.slashScale;
          const sy = fpsMeleePose.slashScale * (0.86 + fpsMeleePose.slashProgress * 0.26);
          this.fpsSlashMesh.scale.set(sx, sy, 1);
        }
      } else {
        this.fpsSlashMesh.visible = false;
        if (p.attackCooldown > 0 && (p.equippedWeapon === 'pistol' || p.equippedWeapon === 'shotgun')) {
          const specCd = WEAPONS[p.equippedWeapon].cooldown || 0.25;
          const kick = clamp(p.attackCooldown / specCd, 0, 1);
          const kickSq = kick * kick;
          posZ += kickSq * (p.equippedWeapon === 'shotgun' ? 0.09 : 0.055);
          posY += kickSq * 0.025;
          rotX += kickSq * (p.equippedWeapon === 'shotgun' ? 0.28 : 0.18);
        } else if (p.dodgeTimer > 0) {
          posY -= 0.14;
          rotZ += 0.35;
        }
      }

      this.fpsViewmodelRig.armPivot.position.set(posX, posY, posZ);
      this.fpsViewmodelRig.armPivot.rotation.set(rotX, rotY, rotZ);
    }

    if (!thirdPersonVisible) return;

    // Wading: while standing in lake/river water, sink the lower half below the animated surface.
    const pGroundY = this.groundY(p.x, p.y);
    const inWater = state.getCell(Math.floor(p.x), Math.floor(p.y)).tile === 'water';
    this.playerWadeDepth += ((inWater ? 0.55 : 0) - this.playerWadeDepth) * 0.25;
    if (Math.abs(this.playerWadeDepth - (inWater ? 0.55 : 0)) < 0.004) this.playerWadeDepth = inWater ? 0.55 : 0;
    const hasWade = this.playerWadeDepth > 0;
    const sinkY = (this.playerWadeDepth / 0.55) * 0.52 * p.scaleY;
    this.playerRig.root.position.set(p.x, pGroundY + (hasWade ? -sinkY : 0), p.y);
    this.playerRig.root.rotation.y = -p.facingAngle;
    this.playerRig.root.scale.set(p.scaleX, p.scaleY, p.scaleX);

    if (hasWade) this.playerWadePlane.constant = -WATER_SURFACE_Y;
    if (hasWade !== this.playerWadeClipActive) {
      this.playerWadeClipActive = hasWade;
      const wadePlanes = hasWade ? [this.playerWadePlane] : [];
      this.playerRig.root.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.material) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          if (mat.clippingPlanes?.length !== wadePlanes.length) {
            mat.clippingPlanes = wadePlanes;
            mat.needsUpdate = true;
          }
        }
      });
    }

    if (this.playerRig.weapons) {
      for (const wKey of Object.keys(this.playerRig.weapons) as Array<keyof typeof this.playerRig.weapons>) {
        this.playerRig.weapons[wKey].visible =
          state.fishing.phase === 'idle' && wKey === p.equippedWeapon && animState !== 'dodge';
      }
    }
    if (this.playerRig.fishingRod) {
      this.playerRig.fishingRod.visible = state.fishing.phase !== 'idle';
    }
    if (this.playerRig.muzzleFlash) {
      const show3pMuzzle =
        state.muzzleFlashTimer > 0 &&
        (p.equippedWeapon === 'pistol' || p.equippedWeapon === 'shotgun' || p.equippedWeapon === 'lmg');
      this.playerRig.muzzleFlash.visible = show3pMuzzle;
      if (show3pMuzzle) {
        this.playerRig.muzzleFlash.position.x =
          p.equippedWeapon === 'pistol' ? 0.33 : p.equippedWeapon === 'shotgun' ? 0.65 : 0.72;
      }
    }

    // Articulated pose
    const isGun = p.equippedWeapon === 'pistol' || p.equippedWeapon === 'shotgun' || p.equippedWeapon === 'lmg';
    if (animState === 'dodge') {
      const rollProg = 1 - clamp(p.dodgeTimer / 0.22, 0, 1);
      this.playerRig.bodyPivot.rotation.z = -rollProg * Math.PI * 2;
      this.playerRig.bodyPivot.position.y = 0.22;
      this.playerRig.leftLegPivot.rotation.z = 0.5;
      this.playerRig.rightLegPivot.rotation.z = 0.5;
      this.playerRig.rightArmPivot.rotation.set(0, 0, 0.2);
      this.playerRig.torso.rotation.y = 0;
      if (this.playerRig.weaponGroup) this.playerRig.weaponGroup.rotation.z = 0;
    } else {
      this.playerRig.bodyPivot.rotation.z = 0;
      let torsoZ = 0;
      let torsoY = 0;
      if (animState === 'walk') {
        const phase = p.walkCycle * 1.1;
        const s = Math.sin(phase);
        this.playerRig.leftLegPivot.rotation.z = s * 0.62;
        this.playerRig.rightLegPivot.rotation.z = -s * 0.62;
        this.playerRig.leftArmPivot.rotation.z = -s * 0.45;
        this.playerRig.rightArmPivot.rotation.z = isGun ? 1.32 : s * 0.35;
        this.playerRig.bodyPivot.position.y = Math.abs(Math.cos(phase)) * 0.05;
        torsoZ = -0.06;
      } else {
        this.playerRig.leftLegPivot.rotation.z = 0;
        this.playerRig.rightLegPivot.rotation.z = 0;
        this.playerRig.leftArmPivot.rotation.z = 0;
        this.playerRig.rightArmPivot.rotation.z =
          state.fishing.phase !== 'idle' ? 0.85 : isGun ? 1.38 : 0.42;
        this.playerRig.bodyPivot.position.y = Math.sin(state.elapsedClock * 3.5) * 0.02;
      }

      if (p.meleeSwingTimer > 0 && isMeleeWeapon(p.equippedWeapon)) {
        const spec = WEAPONS[p.equippedWeapon];
        const swingTotal = spec.swingDuration ?? 0.26;
        const swingProg = 1 - clamp(p.meleeSwingTimer / swingTotal, 0, 1);
        const tp = evaluateThirdPersonMeleePose({
          weapon: p.equippedWeapon,
          progress: swingProg,
          comboStep: state.meleeComboStep,
        });
        this.playerRig.rightArmPivot.rotation.set(tp.rightArmRotX, tp.rightArmRotY, tp.rightArmRotZ);
        torsoY += tp.torsoRotY;
        torsoZ += tp.torsoRotZ;

        if (tp.arcOpacity > 0.02) {
          this.meleeArcMesh.visible = true;
          this.meleeArcMesh.position.set(p.x, pGroundY + 0.56, p.y);
          this.meleeArcMesh.rotation.set(0, -p.facingAngle, tp.arcRotZ);
          const arcScale = spec.range / 1.85;
          this.meleeArcMesh.scale.set(arcScale, 1, tp.arcFlipX ? -arcScale : arcScale);
          const arcMat = this.meleeArcMesh.material as THREE.MeshBasicMaterial;
          arcMat.color.setHex(spec.arcColor ?? 0xf2eee2);
          arcMat.opacity = tp.arcOpacity;
        }
      } else {
        this.playerRig.rightArmPivot.rotation.x = 0;
        this.playerRig.rightArmPivot.rotation.y = 0;
      }

      this.playerRig.torso.rotation.y = torsoY;
      this.playerRig.torso.rotation.z = torsoZ;

      if (this.playerRig.weaponGroup) {
        this.playerRig.weaponGroup.rotation.z = isGun ? -this.playerRig.rightArmPivot.rotation.z : 0;
      }
    }

    const flash = p.hitFlash > 0;
    if (flash || this.playerWasFlashing) {
      this.playerWasFlashing = flash;
      for (const mat of this.playerRig.flashMaterials) {
        if (flash) {
          mat.emissive.setHex(0xff564c);
          mat.emissiveIntensity = 0.85;
        } else {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      }
    }
  }

  private syncProjectiles(projectiles: Projectile[], elapsedClock: number): void {
    const activeIds = this._scratchNumIds;
    activeIds.clear();
    for (const pr of projectiles) {
      activeIds.add(pr.id);
      let g = this.projectileMeshes.get(pr.id);
      if (!g) {
        g = new THREE.Group();
        if (pr.kind === 'molotov') {
          const glassMat = this.factory.getMat(0xffffff, {
            map: this.atlas.weaponTex.molotovGlass,
            roughness: 0.22,
            metalness: 0.14,
          });
          const clothMat = this.factory.getMat('#e6dcc8', { roughness: 0.9 });
          const flameCardMat = this.factory.getMat(0xffffff, {
            map: this.atlas.flameTex,
            emissive: '#ffaa38',
            emissiveMap: this.atlas.flameTex,
            emissiveIntensity: 1.8,
            alphaTest: 0.18,
            transparent: true,
            side: THREE.DoubleSide,
          });
          const coreFlameMat = this.factory.getMat('#fff3b0', { emissive: '#fff3b0', emissiveIntensity: 2.3 });

          const body = new THREE.Mesh(this.molotovBodyGeo, glassMat);
          body.userData.sharedGeo = true;
          const neck = new THREE.Mesh(this.molotovNeckGeo, glassMat);
          neck.position.y = 0.12;
          neck.userData.sharedGeo = true;
          const rag = new THREE.Mesh(this.molotovRagGeo, clothMat);
          rag.position.y = 0.175;
          rag.userData.sharedGeo = true;
          g.add(body, neck, rag);

          const projFlame = new THREE.Group();
          projFlame.position.set(0, 0.24, 0);
          for (const ry of [0, Math.PI * 0.5]) {
            const card = new THREE.Mesh(this.flameCardGeo, flameCardMat);
            card.scale.set(0.22, 0.28, 1);
            card.position.y = 0.06;
            card.rotation.y = ry;
            card.userData.sharedGeo = true;
            projFlame.add(card);
          }
          const core = new THREE.Mesh(this.flameSpireGeo, coreFlameMat);
          core.scale.set(0.085, 0.16, 0.085);
          core.position.y = 0.05;
          core.userData.sharedGeo = true;
          projFlame.add(core);
          g.add(projFlame);
          g.userData.projFlame = projFlame;
        } else if (pr.kind === 'acid') {
          g.add(
            new THREE.Mesh(
              new THREE.BoxGeometry(0.16, 0.16, 0.16),
              this.factory.getMat('#5ef2b5', { emissive: '#5ef2b5', emissiveIntensity: 1.8 })
            )
          );
        } else {
          const streak = new THREE.Mesh(
            pr.kind === 'pellet' ? this.pelletTracerGeo : this.bulletTracerGeo,
            this.factory.getMat('#ffcf6b', { emissive: '#ffae38', emissiveIntensity: 2.1 })
          );
          streak.userData.sharedGeo = true;
          g.add(streak);
          if (pr.kind === 'bullet') {
            const core = new THREE.Mesh(
              this.bulletCoreGeo,
              this.factory.getMat('#fff4c2', { emissive: '#ffe994', emissiveIntensity: 2.8 })
            );
            core.position.x = 0.18;
            core.userData.sharedGeo = true;
            g.add(core);
          }
        }
        this.scene.add(g);
        this.projectileMeshes.set(pr.id, g);
      }
      const groundH = this.groundY(pr.x, pr.y);
      const projY =
        pr.kind === 'bullet' || pr.kind === 'pellet'
          ? Math.max(groundH + 0.04, pr.z)
          : groundH + Math.max(0.04, pr.z);
      g.position.set(pr.x, projY, pr.y);
      if (pr.kind === 'molotov') {
        g.rotation.z = elapsedClock * 12;
        g.rotation.x = elapsedClock * 8;
        const projFlame = g.userData.projFlame as THREE.Group | undefined;
        if (projFlame) {
          const pPulse = 0.9 + Math.sin(elapsedClock * 28 + pr.id) * 0.25;
          projFlame.scale.set(pPulse, 0.85 + pPulse * 0.35, pPulse);
        }
      } else if (pr.kind === 'bullet' || pr.kind === 'pellet') {
        _vec3A.set(pr.vx, pr.vz, pr.vy);
        if (_vec3A.lengthSq() > 1e-6) {
          _vec3A.normalize();
          _quat.setFromUnitVectors(_xAxis, _vec3A);
          g.quaternion.copy(_quat);
        }
      }
    }
    for (const [id, g] of this.projectileMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(g);
        g.traverse((c: THREE.Object3D) => {
          if ((c as THREE.Mesh).isMesh && !c.userData.sharedGeo) (c as THREE.Mesh).geometry.dispose();
        });
        this.projectileMeshes.delete(id);
      }
    }
  }

  private syncFirePatches(firePatches: FirePatch[], elapsedClock: number): void {
    const activeIds = this._scratchNumIds;
    activeIds.clear();
    for (const fp of firePatches) {
      activeIds.add(fp.id);
      let g = this.firePatchMeshes.get(fp.id);
      if (!g) {
        g = new THREE.Group();
        const isFire = fp.kind === 'fire';
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(fp.radius, 22),
          new THREE.MeshBasicMaterial({
            color: isFire ? 0xffffff : 0x4ee674,
            map: isFire ? this.atlas.firePuddleTex : null,
            transparent: true,
            opacity: isFire ? 0.78 : 0.42,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
          })
        );
        disc.rotation.x = -Math.PI * 0.5;
        disc.position.y = 0.025;
        g.add(disc);
        if (isFire) {
          const flameCardMat = this.factory.getMat(0xffffff, {
            map: this.atlas.flameTex,
            emissive: '#ff9624',
            emissiveMap: this.atlas.flameTex,
            emissiveIntensity: 1.7,
            alphaTest: 0.18,
            transparent: true,
            side: THREE.DoubleSide,
          });
          const outerSpireMat = this.factory.getMat('#ff5c14', { emissive: '#ff5210', emissiveIntensity: 1.85 });
          const coreSpireMat = this.factory.getMat('#fff3b0', { emissive: '#fff2a6', emissiveIntensity: 2.35 });

          const tongues: THREE.Object3D[] = [];
          const embers: THREE.Mesh[] = [];
          const sparkMat = this.factory.getMat('#ffd966', { emissive: '#ffae33', emissiveIntensity: 2.2 });

          // Multi-ring inferno: tall center spire + 8 swirling outer & mid flame tongues
          const spots: Array<[number, number, number, number]> = [[0, 0, 1.15, 0]];
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.35;
            spots.push([Math.cos(a) * fp.radius * 0.36, Math.sin(a) * fp.radius * 0.36, 0.88, a]);
          }
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.9;
            spots.push([Math.cos(a) * fp.radius * 0.66, Math.sin(a) * fp.radius * 0.66, 0.68, a + 0.6]);
          }

          for (let i = 0; i < spots.length; i++) {
            const [sx, sz, sScale, rotOffset] = spots[i];
            const cardA = new THREE.Mesh(this.flameCardGeo, flameCardMat);
            cardA.scale.set(0.42 * sScale, 0.64 * sScale, 1);
            cardA.position.set(sx, 0.28 * sScale, sz);
            cardA.rotation.y = rotOffset;
            cardA.userData.sharedGeo = true;
            cardA.userData.baseScaleY = cardA.scale.y;
            cardA.userData.baseRotZ = 0;
            g.add(cardA);
            tongues.push(cardA);

            const cardB = new THREE.Mesh(this.flameCardGeo, flameCardMat);
            cardB.scale.set(0.42 * sScale, 0.64 * sScale, 1);
            cardB.position.set(sx, 0.28 * sScale, sz);
            cardB.rotation.y = rotOffset + Math.PI * 0.5;
            cardB.userData.sharedGeo = true;
            cardB.userData.baseScaleY = cardB.scale.y;
            cardB.userData.baseRotZ = 0;
            g.add(cardB);
            tongues.push(cardB);

            const spire = new THREE.Mesh(this.flameSpireGeo, i < 5 ? coreSpireMat : outerSpireMat);
            spire.scale.set(0.14 * sScale, 0.38 * sScale, 0.14 * sScale);
            spire.position.set(sx, 0.18 * sScale, sz);
            spire.userData.sharedGeo = true;
            spire.userData.baseScaleY = spire.scale.y;
            spire.userData.baseRotZ = (i % 2 === 0 ? 1 : -1) * 0.06;
            g.add(spire);
            tongues.push(spire);
          }

          for (let e = 0; e < 6; e++) {
            const em = new THREE.Mesh(this.emberSparkGeo, sparkMat);
            em.userData.sharedGeo = true;
            g.add(em);
            embers.push(em);
          }

          g.userData.tongues = tongues;
          g.userData.embers = embers;
        }
        this.scene.add(g);
        this.firePatchMeshes.set(fp.id, g);
      }
      g.position.set(fp.x, this.groundY(fp.x, fp.y), fp.y);
      const lifeFade = clamp(fp.life * 0.45, 0.12, 1);
      const discMat = (g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      discMat.opacity = fp.kind === 'fire' ? clamp(lifeFade * 0.85, 0.1, 0.82) : Math.min(0.45, fp.life * 0.2);

      const fid = typeof fp.id === 'number' && Number.isFinite(fp.id) ? fp.id : 1;
      const tongues = g.userData.tongues as THREE.Object3D[] | undefined;
      if (tongues) {
        for (let i = 0; i < tongues.length; i++) {
          const t = tongues[i];
          const flick = 0.78 + Math.sin(elapsedClock * (16 + (i % 5) * 2.1) + i * 1.9 + fid) * 0.32;
          t.scale.y = (t.userData.baseScaleY as number) * flick * (0.45 + lifeFade * 0.55);
          t.rotation.z = (t.userData.baseRotZ as number) + Math.cos(elapsedClock * 11 + i * 1.3) * 0.1;
        }
      }
      const embers = g.userData.embers as THREE.Mesh[] | undefined;
      if (embers) {
        for (let i = 0; i < embers.length; i++) {
          const em = embers[i];
          const cycle = ((elapsedClock * 1.15 + i * 0.18 + fid * 0.27) % 1 + 1) % 1;
          const a = i * 1.05 + elapsedClock * 2.2;
          const r = fp.radius * (0.18 + cycle * 0.55);
          em.position.set(Math.cos(a) * r, 0.12 + cycle * 0.95, Math.sin(a) * r);
          em.scale.setScalar((1 - cycle * 0.75) * lifeFade);
        }
      }
    }
    for (const [id, g] of this.firePatchMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(g);
        g.traverse((c: THREE.Object3D) => {
          if ((c as THREE.Mesh).isMesh) {
            const mesh = c as THREE.Mesh;
            if (!c.userData.sharedGeo) mesh.geometry.dispose();
            if (mesh === g.children[0]) (mesh.material as THREE.Material).dispose();
          }
        });
        this.firePatchMeshes.delete(id);
      }
    }
  }

  private syncDecals(decals: BloodDecal[]): void {
    const needed = Math.min(decals.length, MAX_DECAL_INSTANCES);
    while (this.decalMeshes.length < needed) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.68, 0.68),
        new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      );
      m.rotation.x = -Math.PI * 0.5;
      this.scene.add(m);
      this.decalMeshes.push(m);
    }
    const startIdx = Math.max(0, decals.length - MAX_DECAL_INSTANCES);
    for (let i = 0; i < this.decalMeshes.length; i++) {
      const mesh = this.decalMeshes[i];
      if (i < needed) {
        const d = decals[startIdx + i];
        mesh.visible = true;
        mesh.position.set(d.x, this.groundY(d.x, d.y) + 0.015 + i * 0.0001, d.y);
        mesh.rotation.z = d.variant * 1.1;
        const mat = mesh.material as THREE.MeshBasicMaterial;
        const nextTex = this.atlas.decalTex[d.kind];
        if (mat.map !== nextTex) {
          mat.map = nextTex;
          mat.needsUpdate = true;
        }
        mat.opacity = d.alpha;
      } else {
        mesh.visible = false;
      }
    }
  }

  private syncImpactDecals(decals: SurfaceImpactDecal[], isFps: boolean): void {
    if (!isFps) {
      for (const m of this.impactDecalMeshes) m.visible = false;
      return;
    }
    const needed = Math.min(decals.length, MAX_IMPACT_DECALS);
    while (this.impactDecalMeshes.length < needed) {
      const m = new THREE.Mesh(
        this.impactDecalGeo,
        new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        })
      );
      this.scene.add(m);
      this.impactDecalMeshes.push(m);
    }
    const startIdx = Math.max(0, decals.length - MAX_IMPACT_DECALS);
    for (let i = 0; i < this.impactDecalMeshes.length; i++) {
      const mesh = this.impactDecalMeshes[i];
      if (i < needed) {
        const d = decals[startIdx + i];
        mesh.visible = true;
        const offset = 0.014 + (i % 7) * 0.0004;
        mesh.position.set(
          d.x + d.nx * offset,
          this.groundY(d.x, d.y) + Math.max(0.015, d.z + d.nz * offset),
          d.y + d.ny * offset
        );
        _vec3A.set(d.nx, d.nz, d.ny).normalize();
        _quat.setFromUnitVectors(_zAxis, _vec3A);
        if (d.kind !== 'blood_wall' && d.rotation !== 0) {
          _quatB.setFromAxisAngle(_zAxis, d.rotation);
          _quat.multiply(_quatB);
        }
        mesh.quaternion.copy(_quat);
        mesh.scale.setScalar(d.size);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        const nextTex = this.atlas.bulletImpactTex[d.kind];
        if (mat.map !== nextTex) {
          mat.map = nextTex;
          mat.needsUpdate = true;
        }
        mat.opacity = d.alpha;
      } else {
        mesh.visible = false;
      }
    }
  }

  private syncImpactEffects(effects: BulletImpactEffect[]): void {
    const needed = Math.min(effects.length, MAX_IMPACT_EFFECTS);
    while (this.impactEffectPools.length < needed) {
      const root = new THREE.Group();
      const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffdf85,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const sparkMat = new THREE.MeshBasicMaterial({
        color: 0xffe9a6,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const flashA = new THREE.Mesh(this.impactFlashGeo, flashMat);
      const flashB = new THREE.Mesh(this.impactFlashGeo, flashMat);
      flashB.rotation.z = Math.PI * 0.5;
      root.add(flashA, flashB);
      const sparks: THREE.Mesh[] = [];
      for (let s = 0; s < 4; s++) {
        const sp = new THREE.Mesh(this.impactSparkGeo, sparkMat);
        root.add(sp);
        sparks.push(sp);
      }
      this.scene.add(root);
      this.impactEffectPools.push({ root, flashMat, sparkMat, flashA, flashB, sparks });
    }

    for (let i = 0; i < this.impactEffectPools.length; i++) {
      const fx = this.impactEffectPools[i];
      if (i >= needed) {
        fx.root.visible = false;
        continue;
      }
      const e = effects[i];
      const prog = clamp(1 - e.life / Math.max(0.01, e.maxLife), 0, 1);
      fx.root.visible = true;
      fx.root.position.set(
        e.x + e.nx * 0.02,
        this.groundY(e.x, e.y) + Math.max(0.02, e.z + e.nz * 0.02),
        e.y + e.ny * 0.02
      );

      // Build orthonormal basis around hit normal (in Three.js coords: x, z, y)
      _vec3A.set(e.nx, e.nz, e.ny);
      if (_vec3A.lengthSq() < 1e-6) _vec3A.set(0, 1, 0);
      else _vec3A.normalize();
      _quat.setFromUnitVectors(_zAxis, _vec3A);
      fx.root.quaternion.copy(_quat);

      let flashCol = 0xffdd88;
      let sparkCol = 0x9aa0a6;
      if (e.material === 'metal') {
        flashCol = 0xfff5bd;
        sparkCol = 0xffb340;
      } else if (e.material === 'wood') {
        flashCol = 0xe8b976;
        sparkCol = 0xa67449;
      } else if (e.material === 'dirt') {
        flashCol = 0xbfa37a;
        sparkCol = 0x6b533b;
      } else if (e.material === 'water') {
        flashCol = 0xc9f4ff;
        sparkCol = 0x7fd4eb;
      } else if (e.material === 'flesh') {
        flashCol = 0xd9362e;
        sparkCol = 0x821818;
      } else if (e.material === 'headshot') {
        flashCol = 0xffe066;
        sparkCol = 0xff3b30;
      }

      const flashScale = (e.material === 'headshot' ? 1.55 : 1.0) * e.scale * (1.15 - prog * 0.65);
      fx.flashA.visible = prog < 0.65;
      fx.flashB.visible = prog < 0.65;
      fx.flashA.scale.setScalar(flashScale);
      fx.flashB.scale.setScalar(flashScale);
      fx.flashA.rotation.z = (e.id % 5) * 0.45 + prog * 0.6;
      fx.flashB.rotation.z = fx.flashA.rotation.z + Math.PI * 0.5;
      fx.flashMat.color.setHex(flashCol);
      fx.flashMat.opacity = clamp((1 - prog / 0.65) * 0.95, 0, 1);

      const spread = (0.08 + prog * (e.material === 'headshot' ? 0.56 : 0.38)) * e.scale;
      const pushOut = (0.04 + prog * 0.24) * e.scale;
      fx.sparkMat.color.setHex(sparkCol);
      fx.sparkMat.opacity = clamp((1 - prog) * 0.92, 0, 1);
      for (let s = 0; s < fx.sparks.length; s++) {
        const ang = (s / fx.sparks.length) * Math.PI * 2 + (e.id % 7) * 0.7;
        const sp = fx.sparks[s];
        sp.position.set(
          Math.cos(ang) * spread,
          Math.sin(ang) * spread,
          pushOut * (0.7 + (s % 2) * 0.45)
        );
        sp.scale.setScalar((1 - prog * 0.75) * (e.material === 'headshot' ? 1.35 : 0.95));
      }
    }
  }

  private syncRipples(ripples: SoundRipple[]): void {
    while (this.rippleMeshes.length < ripples.length) {
      const geo = new THREE.RingGeometry(0.92, 1.0, 28);
      geo.rotateX(-Math.PI * 0.5);
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      this.scene.add(m);
      this.rippleMeshes.push(m);
    }
    for (let i = 0; i < this.rippleMeshes.length; i++) {
      const m = this.rippleMeshes[i];
      if (i < ripples.length) {
        const sr = ripples[i];
        m.visible = true;
        m.position.set(sr.x, this.groundY(sr.x, sr.y) + 0.03, sr.y);
        m.scale.set(sr.radius, 1, sr.radius);
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.color.set(sr.color);
        mat.opacity = sr.alpha;
      } else {
        m.visible = false;
      }
    }
  }

  private syncFishing(fishing: FishingState, player: PlayerState, elapsedClock: number, isFps: boolean): void {
    const active = fishing.phase !== 'idle';
    this.fishingLine.visible = active;
    this.fishingBobber.visible = active;
    this.fishingRipple.visible = active;
    if (!active) return;

    const bobDip =
      fishing.phase === 'bite'
        ? Math.sin(elapsedClock * 26) * 0.08 - 0.04
        : Math.sin(elapsedClock * 4) * 0.03;

    this.fishingBobber.position.set(fishing.bobberX, WATER_SURFACE_Y + 0.036 + bobDip, fishing.bobberY);
    (this.fishingBobber.children[0] as THREE.Mesh).material = this.factory.getMat(
      fishing.phase === 'bite' ? '#ffd266' : '#e0483e'
    );

    const ripInterval = fishing.phase === 'bite' ? 0.22 : 0.56;
    if (elapsedClock < this.lastBobberRippleTime || elapsedClock - this.lastBobberRippleTime >= ripInterval) {
      this.lastBobberRippleTime = elapsedClock;
      this.waterRipples.push(fishing.bobberX, fishing.bobberY, elapsedClock, fishing.phase === 'bite' ? 0.95 : 0.44);
    }

    const rip = (fishing.ripplePhase * 1.4) % 1;
    this.fishingRipple.position.set(fishing.bobberX, WATER_SURFACE_Y + 0.008, fishing.bobberY);
    const ripScale = 0.4 + rip * 1.6;
    this.fishingRipple.scale.set(ripScale, 1, ripScale);
    (this.fishingRipple.material as THREE.LineBasicMaterial).color.set(
      fishing.phase === 'bite' ? '#ffd266' : '#8ad4eb'
    );

    // Update fishing line vertices from rod tip to bobber
    const fx = Math.cos(player.facingAngle);
    const fz = Math.sin(player.facingAngle);
    const rx = -fz;
    const rz = fx;
    const pGroundY = this.groundY(player.x, player.y);
    const tipX = isFps ? player.x + fx * 0.72 + rx * 0.2 : player.x + fx * 0.65;
    const tipY = pGroundY + (isFps ? FPS_EYE_HEIGHT - 0.05 : 0.95);
    const tipZ = isFps ? player.y + fz * 0.72 + rz * 0.2 : player.y + fz * 0.65;
    const posAttr = this.fishingLine.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, tipX, tipY, tipZ);
    posAttr.setXYZ(1, fishing.bobberX, WATER_SURFACE_Y + 0.08 + bobDip, fishing.bobberY);
    posAttr.needsUpdate = true;
  }

  private syncHighlights(state: RenderFrameState): void {
    // Nearest interactive tile outline
    if (state.nearInteractTile && state.phase === 'playing' && state.activeVehicleId === null && !state.player.buildMode) {
      this.interactHighlight.visible = true;
      const ix = state.nearInteractTile.gx + 0.5;
      const iz = state.nearInteractTile.gy + 0.5;
      this.interactHighlight.position.set(ix, this.groundY(ix, iz), iz);
    } else {
      this.interactHighlight.visible = false;
    }

    // Build mode tile preview
    if (state.phase === 'playing' && state.player.buildMode) {
      const { gx, gy } = getBuildTargetTile(
        state.player.x,
        state.player.y,
        state.player.facingAngle,
        state.mouseWorldX,
        state.mouseWorldY,
        state.usingVirtualAim
      );
      const cell = state.getCell(gx, gy);
      const blockedByStruct = state.structures.some((s) => s.gx === gx && s.gy === gy);
      const nearPlayer = Math.floor(state.player.x) === gx && Math.floor(state.player.y) === gy;
      const valid =
        !cell.solid &&
        cell.tile !== 'water' &&
        cell.tile !== 'cliff_stone' &&
        !blockedByStruct &&
        !nearPlayer &&
        Object.entries(STRUCTURES[state.player.buildMode].cost).every(
          ([k, amt]) => (state.inventory[k as keyof Inventory] ?? 0) >= (amt ?? 0)
        );
      this.buildHighlight.visible = true;
      this.buildHighlight.position.set(gx + 0.5, this.groundY(gx + 0.5, gy + 0.5), gy + 0.5);
      const col = valid ? 0x5ef28f : 0xeb4d4b;
      this.buildFillMat.color.setHex(col);
      this.buildEdgeMat.color.setHex(col);
    } else {
      this.buildHighlight.visible = false;
    }

    // Molotov blast radius preview
    if (state.phase === 'playing' && state.player.equippedWeapon === 'molotov' && !state.player.buildMode && state.activeVehicleId === null) {
      const spec = WEAPONS.molotov;
      const tx = state.usingVirtualAim
        ? state.player.x + Math.cos(state.player.facingAngle) * 4.5
        : clamp(state.mouseWorldX, state.player.x - spec.range, state.player.x + spec.range);
      const ty = state.usingVirtualAim
        ? state.player.y + Math.sin(state.player.facingAngle) * 4.5
        : clamp(state.mouseWorldY, state.player.y - spec.range, state.player.y + spec.range);
      this.molotovReticle.visible = true;
      this.molotovReticle.position.set(tx, this.groundY(tx, ty), ty);
    } else {
      this.molotovReticle.visible = false;
    }
  }

  private syncParticles(particles: RenderParticle[]): void {
    let count = 0;
    for (let i = 0; i < particles.length && count < MAX_PARTICLE_INSTANCES; i++) {
      const p = particles[i];
      if (!p.active) continue;
      const alphaScale = clamp(p.life / p.maxLife, 0.15, 1);
      _vec3A.set(p.x, this.groundY(p.x, p.y) + Math.max(0.04, p.z), p.y);
      _euler.set(p.life * 8.5 + i * 1.1, p.x * 4 + p.life * 6.5, p.y * 4 + i * 0.7);
      _quat.setFromEuler(_euler);
      const s = (0.58 + p.size * 0.38) * alphaScale;
      _scale.set(s, s, s);
      _mat4.compose(_vec3A, _quat, _scale);
      this.particleInstanced.setMatrixAt(count, _mat4);
      _color.set(p.color);
      this.particleInstanced.setColorAt(count, _color);
      count++;
    }
    this.particleInstanced.count = count;
    this.particleInstanced.instanceMatrix.needsUpdate = true;
    if (this.particleInstanced.instanceColor) {
      this.particleInstanced.instanceColor.needsUpdate = true;
    }
  }

  private syncAmbientAsh(
    ashList: RenderAshFlake[],
    targetX: number,
    targetY: number,
    targetZ: number,
    timeMinutes: number
  ): void {
    const { darkness } = getDaylightInfo(timeMinutes);
    const mat = this.ashInstanced.material as THREE.MeshBasicMaterial;
    mat.opacity = clamp(0.28 + darkness * 0.32, 0.25, 0.62);

    const span = 18;
    const count = Math.min(ashList.length, MAX_ASH_INSTANCES);
    for (let i = 0; i < count; i++) {
      const a = ashList[i];
      _vec3A.set(
        targetX + (a.x - 0.5) * span * 2,
        targetY + 0.3 + ((1 - a.y) * 2.8),
        targetZ + (a.y - 0.5) * span * 2
      );
      _euler.set(
        Math.sin(a.y * 10 + i) * 0.75,
        a.x * 12 + a.y * 6 + i * 0.5,
        Math.cos(a.x * 10 + i) * 0.65
      );
      _quat.setFromEuler(_euler);
      const isEmber = i % 5 === 0;
      _scale.setScalar(a.size * (isEmber ? 0.38 : 0.48));
      _mat4.compose(_vec3A, _quat, _scale);
      this.ashInstanced.setMatrixAt(i, _mat4);
      _color.setHex(isEmber ? (i % 10 === 0 ? 0xff9d42 : 0xffcf6e) : (i % 2 === 0 ? 0xd2d8d4 : 0x9fa6a2));
      this.ashInstanced.setColorAt(i, _color);
    }
    this.ashInstanced.count = count;
    this.ashInstanced.instanceMatrix.needsUpdate = true;
    if (this.ashInstanced.instanceColor) {
      this.ashInstanced.instanceColor.needsUpdate = true;
    }
  }

  private syncWeatherRain(
    state: RenderFrameState,
    targetX: number,
    targetY: number,
    targetZ: number,
    dt: number,
    isFps: boolean
  ): void {
    const intensity = state.weather.rainIntensity;
    if (intensity < 0.05) {
      this.rainInstanced.count = 0;
      return;
    }
    const maxCount = Math.max(24, Math.floor(this.rainDrops.length * clamp(intensity, 0.2, 1)));
    const windSlant = 0.14 + state.weather.windStrength * 0.18;
    const mat = this.rainInstanced.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.26 + intensity * 0.28;

    _euler.set(0.06, 0, -windSlant);
    _quat.setFromEuler(_euler);

    let outCount = 0;
    const rainH = 14;
    for (let i = 0; i < maxCount; i++) {
      const d = this.rainDrops[i];
      d.oy -= d.speed * dt;
      d.ox += d.speed * windSlant * dt;
      if (d.oy < 0) {
        d.oy += rainH;
        d.ox = ((d.ox + 16) % 32 + 32) % 32 - 16;
      }
      const wx = targetX + d.ox;
      const wz = targetZ + d.oz;
      const wy = targetY + d.oy;
      const surf = sampleTerrainSurface(this.activeSeed, wx, wz, this.activeFace);
      const cellTile = state.getCell(Math.floor(wx), Math.floor(wz)).tile;
      const isIndoor =
        cellTile === 'floor' ||
        cellTile === 'floor_rug' ||
        cellTile === 'floor_bath' ||
        cellTile === 'tile_clinic' ||
        cellTile === 'tile_diner';
      const isCaveRoofed = surf.isCave || surf.isCaveCoveredMouth;
      const isTunnelRoofed = surf.isTunnel;

      // Zero rain leaks inside caves, road tunnels, or indoor buildings!
      if (!isFps) {
        // In ISO cutaway view, suppress the full rain column over sheltered interiors so drops never slice across open roofs
        if (isCaveRoofed || isTunnelRoofed || isIndoor) continue;
      } else {
        if (isCaveRoofed && wy < surf.caveRoofY + 0.2) continue;
        if (isTunnelRoofed && wy < surf.tunnelRoofY + 0.2) continue;
        if (isIndoor && wy < surf.height + 2.35) continue;
      }
      if (wy < surf.height + 0.15) continue;

      _vec3A.set(wx, wy, wz);
      _scale.set(1, d.len * (0.85 + intensity * 0.4), 1);
      _mat4.compose(_vec3A, _quat, _scale);
      this.rainInstanced.setMatrixAt(outCount++, _mat4);
    }
    this.rainInstanced.count = outCount;
    if (outCount > 0) {
      this.rainInstanced.instanceMatrix.needsUpdate = true;
    }
  }

  private worldToScreen(wx: number, wy: number, wz: number): { sx: number; sy: number; visible: boolean } {
    _vec3B.set(wx, wy, wz).project(this.activeCamera);
    const visible =
      _vec3B.z >= -1 &&
      _vec3B.z <= 1 &&
      _vec3B.x >= -1.25 &&
      _vec3B.x <= 1.25 &&
      _vec3B.y >= -1.25 &&
      _vec3B.y <= 1.25;
    return {
      sx: (_vec3B.x * 0.5 + 0.5) * this.viewW,
      sy: (-_vec3B.y * 0.5 + 0.5) * this.viewH,
      visible,
    };
  }

  private renderOverlay2D(state: RenderFrameState, isFps: boolean): void {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    // Damaged zombie mini health bars (guarded against behind-camera inverted projection)
    for (const z of state.zombies) {
      if (z.hp >= z.maxHp || z.state === 'dying') continue;
      const topH = this.groundY(z.x, z.y) + (z.archetype === 'bloater' ? 1.3 : 1.18);
      const proj = this.worldToScreen(z.x, topH, z.y);
      if (!proj.visible) continue;
      const bw = 28;
      const pct = clamp(z.hp / z.maxHp, 0, 1);
      ctx.fillStyle = '#121518';
      ctx.fillRect(Math.round(proj.sx - bw * 0.5), Math.round(proj.sy), bw, 5);
      ctx.fillStyle = '#d6453a';
      ctx.fillRect(Math.round(proj.sx - bw * 0.5 + 1), Math.round(proj.sy + 1), Math.round((bw - 2) * pct), 3);
    }

    // Locked door lockpick progress bar
    for (const d of state.doors) {
      if (d.status !== 'locked' || d.lockpickProgress <= 0) continue;
      const proj = this.worldToScreen(d.gx + 0.5, this.groundY(d.gx + 0.5, d.gy + 0.5) + 1.15, d.gy + 0.5);
      if (!proj.visible) continue;
      ctx.fillStyle = '#121518';
      ctx.fillRect(Math.round(proj.sx - 16), Math.round(proj.sy), 32, 6);
      ctx.fillStyle = '#ffd266';
      ctx.fillRect(Math.round(proj.sx - 15), Math.round(proj.sy + 1), Math.round(30 * d.lockpickProgress), 4);
    }

    // Player action badge & reload progress bar
    if (state.phase !== 'title' && state.activeVehicleId === null) {
      const p = state.player;
      const pGY = this.groundY(p.x, p.y);
      let actionLabel = state.actionVisual?.label ?? null;
      if (state.fishing.phase !== 'idle') {
        actionLabel =
          state.fishing.phase === 'casting'
            ? 'CASTING'
            : state.fishing.phase === 'bite'
              ? 'REEL NOW'
              : 'FISHING';
      } else if (p.reloadingTimer > 0 && p.reloadingWeapon) {
        actionLabel = 'RELOADING';
      }

      if (actionLabel) {
        const badgePos = isFps
          ? { sx: this.viewW * 0.5, sy: this.viewH * 0.5 + 42, visible: true }
          : this.worldToScreen(p.x, pGY + 1.48, p.y);
        if (badgePos.visible) {
          ctx.save();
          ctx.font = 'bold 12px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          const w = ctx.measureText(actionLabel).width + 16;
          ctx.fillStyle = '#10271cdd';
          ctx.fillRect(Math.round(badgePos.sx - w * 0.5), Math.round(badgePos.sy - 14), w, 18);
          ctx.fillStyle = '#e6dfad';
          ctx.fillText(actionLabel, Math.round(badgePos.sx), Math.round(badgePos.sy - 1));
          ctx.restore();
        }
      }

      if (p.reloadingTimer > 0 && p.reloadingWeapon) {
        const total = WEAPONS[p.reloadingWeapon].reloadTime || 1;
        const prog = clamp(1 - p.reloadingTimer / total, 0, 1);
        const barPos = isFps
          ? { sx: this.viewW * 0.5, sy: this.viewH * 0.5 + 48, visible: true }
          : this.worldToScreen(p.x, pGY + 1.25, p.y);
        if (barPos.visible) {
          ctx.fillStyle = '#121518';
          ctx.fillRect(Math.round(barPos.sx - 18), Math.round(barPos.sy), 36, 6);
          ctx.fillStyle = '#e8a849';
          ctx.fillRect(Math.round(barPos.sx - 16), Math.round(barPos.sy + 1), Math.round(32 * prog), 4);
        }
      }
    }

    // Floating combat & loot text
    ctx.save();
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (const ft of state.floatingTexts) {
      const proj = this.worldToScreen(ft.x, this.groundY(ft.x, ft.y) + ft.z + 0.5, ft.y);
      if (!proj.visible) continue;
      ctx.globalAlpha = clamp(ft.life / ft.maxLife, 0, 1);
      ctx.fillStyle = '#0d1012';
      ctx.fillText(ft.text, Math.round(proj.sx + 1), Math.round(proj.sy + 1));
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, Math.round(proj.sx), Math.round(proj.sy));
    }
    ctx.restore();

    // Sleep fade & Zzz
    if (state.sleepTransitionTimer > 0) {
      const restProg = clamp(1 - state.sleepTransitionTimer / 1.65, 0, 1);
      const restFade = Math.sin(restProg * Math.PI) * 0.52;
      ctx.fillStyle = `rgba(9, 12, 22, ${restFade.toFixed(3)})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);

      const zzzPos = isFps
        ? { sx: this.viewW * 0.5, sy: this.viewH * 0.42 - restProg * 28, visible: true }
        : this.worldToScreen(state.player.x, this.groundY(state.player.x, state.player.y) + 1.2 + restProg * 0.7, state.player.y);
      if (zzzPos.visible) {
        ctx.save();
        ctx.globalAlpha = Math.sin(restProg * Math.PI);
        ctx.font = 'bold 15px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0d1012';
        ctx.fillText('Z z z', Math.round(zzzPos.sx + 1), Math.round(zzzPos.sy + 1));
        ctx.fillStyle = '#a8e6cf';
        ctx.fillText('Z z z', Math.round(zzzPos.sx), Math.round(zzzPos.sy));
        ctx.restore();
      }
    }

    // Subtle FPS peripheral vignette for grounded depth (uses cached CanvasGradient)
    if (isFps && state.phase === 'playing') {
      const grad = state.isSprinting ? this.fpsVignetteSprintGrad : this.fpsVignetteGrad;
      if (grad) {
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.viewW, this.viewH);
      }
    }

    // Tactical crosshair (centered reticle with dynamic bloom in FPS mode; cursor-tracked in ISO mode) & hit-marker X
    const showFpsReticle = isFps && state.phase === 'playing' && state.activeVehicleId === null;
    const showIsoCrosshair = !isFps && state.phase === 'playing' && state.activeVehicleId === null && !state.usingVirtualAim;
    if (showFpsReticle || showIsoCrosshair) {
      const mx = showFpsReticle ? Math.round(this.viewW * 0.5) : Math.round(state.mouseScreenX);
      const my = showFpsReticle ? Math.round(this.viewH * 0.5) : Math.round(state.mouseScreenY);
      const moveBloom = showFpsReticle ? clamp(Math.hypot(state.playerVelX, state.playerVelY) / 4.5, 0, 1) * 4 : 0;
      const recoilBloom = showFpsReticle && state.player.attackCooldown > 0 ? clamp(state.player.attackCooldown / (WEAPONS[state.player.equippedWeapon].cooldown || 0.3), 0, 1) * 5 : 0;
      const baseGap = showFpsReticle
        ? state.player.equippedWeapon === 'shotgun'
          ? 7
          : isMeleeWeapon(state.player.equippedWeapon)
            ? 4
            : 3
        : 3;
      const spreadGap = Math.round(baseGap + moveBloom + recoilBloom);
      const armLen = showFpsReticle ? spreadGap + 6 : 7;
      ctx.strokeStyle =
        state.hitMarkerTimer > 0
          ? state.hitMarkerCrit
            ? '#ffd266'
            : '#f0ece1'
          : 'rgba(240, 236, 225, 0.9)';
      ctx.lineWidth = showFpsReticle ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(mx - armLen, my);
      ctx.lineTo(mx - spreadGap, my);
      ctx.moveTo(mx + spreadGap, my);
      ctx.lineTo(mx + armLen, my);
      ctx.moveTo(mx, my - armLen);
      ctx.lineTo(mx, my - spreadGap);
      ctx.moveTo(mx, my + spreadGap);
      ctx.lineTo(mx, my + armLen);
      ctx.stroke();
      ctx.fillStyle = isMeleeWeapon(state.player.equippedWeapon) && showFpsReticle ? '#ffd266' : '#d9822b';
      ctx.fillRect(mx - 1, my - 1, 2, 2);
    }

    if (state.phase === 'playing' && state.hitMarkerTimer > 0) {
      const useCenter = isFps || state.usingVirtualAim;
      const hx = useCenter ? Math.round(this.viewW * 0.5) : Math.round(state.mouseScreenX);
      const hy = useCenter ? Math.round(this.viewH * 0.5) : Math.round(state.mouseScreenY);
      if (state.hitMarkerHeadshot) {
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(hx - 13, hy - 13);
        ctx.lineTo(hx - 5, hy - 5);
        ctx.moveTo(hx + 13, hy - 13);
        ctx.lineTo(hx + 5, hy - 5);
        ctx.moveTo(hx - 13, hy + 13);
        ctx.lineTo(hx - 5, hy + 5);
        ctx.moveTo(hx + 13, hy + 13);
        ctx.lineTo(hx + 5, hy + 5);
        ctx.stroke();

        ctx.strokeStyle = '#ffd266';
        ctx.lineWidth = 1.5;
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

        ctx.save();
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0d1012';
        ctx.fillText('HEADSHOT', hx + 1, hy - 20);
        ctx.fillStyle = '#ffd266';
        ctx.fillText('HEADSHOT', hx, hy - 21);
        ctx.restore();
      } else {
        ctx.strokeStyle = state.hitMarkerCrit ? '#ffd266' : '#eb4d4b';
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
    }
  }

  public dispose(): void {
    this.clearSceneCaches();
    for (const bucket of this.zombieRigPool.values()) {
      for (const entry of bucket) {
        this.scene.remove(entry.rig.root);
        this.scene.remove(entry.ring);
        for (const m of entry.rig.allMaterials) m.dispose();
      }
    }
    this.zombieRigPool.clear();
    this.pooledZombieCount = 0;
    this.zombieRingGeo.dispose();
    this.zombieRingMatRed.dispose();
    this.zombieRingMatMint.dispose();

    this.chunkPlaneGeo.dispose();
    this.ceilingBoxGeo.dispose();
    this.ceilingMat.dispose();
    this.waterMaterial.dispose();
    this.skyDome.dispose();
    this.grassSystem.dispose();
    this.overlayCanvas.remove();
    this.factory.dispose();
    this.atlas.dispose();
    this.envRT.dispose();

    const disposeGroup = (obj: THREE.Object3D) => {
      obj.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
          const m = child as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mt: THREE.Material) => mt.dispose());
          else m.material?.dispose();
        }
      });
    };
    disposeGroup(this.interactHighlight);
    disposeGroup(this.buildHighlight);
    disposeGroup(this.molotovReticle);
    disposeGroup(this.fpsSlashMesh);
    disposeGroup(this.meleeArcMesh);
    disposeGroup(this.fishingLine);
    disposeGroup(this.fishingBobber);
    disposeGroup(this.fishingRipple);
    this.particleInstanced.geometry.dispose();
    (this.particleInstanced.material as THREE.Material).dispose();
    this.ashInstanced.geometry.dispose();
    (this.ashInstanced.material as THREE.Material).dispose();
    this.rainInstanced.geometry.dispose();
    (this.rainInstanced.material as THREE.Material).dispose();
    this.infectDropInstanced.geometry.dispose();
    (this.infectDropInstanced.material as THREE.Material).dispose();
    this.sporePuffInstanced.geometry.dispose();
    (this.sporePuffInstanced.material as THREE.Material).dispose();
    for (const dm of this.decalMeshes) {
      dm.geometry.dispose();
      (dm.material as THREE.Material).dispose();
    }
    for (const im of this.impactDecalMeshes) {
      (im.material as THREE.Material).dispose();
    }
    for (const fx of this.impactEffectPools) {
      fx.flashMat.dispose();
      fx.sparkMat.dispose();
    }
    this.bulletTracerGeo.dispose();
    this.bulletCoreGeo.dispose();
    this.pelletTracerGeo.dispose();
    this.flameCardGeo.dispose();
    this.flameSpireGeo.dispose();
    this.emberSparkGeo.dispose();
    this.molotovBodyGeo.dispose();
    this.molotovNeckGeo.dispose();
    this.molotovRagGeo.dispose();
    this.impactDecalGeo.dispose();
    this.impactFlashGeo.dispose();
    this.impactSparkGeo.dispose();
    this.renderer.dispose();
  }
}

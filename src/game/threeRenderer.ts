import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getLootPopTransform, resolvePlayerAnimState, resolveZombieAnimState, type ActionVisual } from './actionAnimation';
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
import { computeAtmosphereLighting, createAtmosphereLightingState } from './lighting';
import { getBuildTargetTile, getDaylightInfo } from './survivalLogic';
import { getSettings } from './settings';
import { STRUCTURES } from './recipes';
import type {
  BloodDecal,
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
  burnBarrelFlames: THREE.Group[];
  burnBarrelCoords: Array<{ x: number; z: number }>;
  lightAnchors: Array<{ x: number; z: number; color: number; intensity: number; distance: number; flicker: boolean }>;
  fpsRoofMesh?: THREE.InstancedMesh;
  grassMesh?: THREE.InstancedMesh | null;
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

  private sunLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private flashlight: THREE.SpotLight;
  private headlightLights: THREE.SpotLight[] = [];
  private pointLights: THREE.PointLight[] = [];

  private chunksGroup = new THREE.Group();
  private chunkVisuals = new Map<string, ChunkVisual>();
  private chunkPlaneGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
  private ceilingBoxGeo = new THREE.BoxGeometry(1, 0.08, 1);
  private ceilingMat: THREE.MeshStandardMaterial;
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
    { rig: ActorRig3D; archetype: ZombieArchetype; ring: THREE.Mesh; wasFading: boolean; wasFlashing: boolean }
  >();
  private zombieRigPool = new Map<ZombieArchetype, Array<{ rig: ActorRig3D; ring: THREE.Mesh }>>();
  private pooledZombieCount = 0;
  private zombieRingGeo: THREE.RingGeometry;
  private zombieRingMatRed: THREE.MeshBasicMaterial;
  private zombieRingMatMint: THREE.MeshBasicMaterial;

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
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.qualityPixelRatio = this.renderer.getPixelRatio();
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

  public screenToWorld(screenX: number, screenY: number, camX?: number, camY?: number): { wx: number; wy: number } {
    if (camX !== undefined && camY !== undefined) {
      const cw = isoToWorld(camX, camY);
      this.camera.position.set(
        cw.wx + _camOffsetDir.x * 28,
        _camOffsetDir.y * 28,
        cw.wy + _camOffsetDir.z * 28
      );
      this.camera.lookAt(cw.wx, 0, cw.wy);
      this.camera.updateMatrixWorld();
    }
    _ndc.set((screenX / this.viewW) * 2 - 1, -(screenY / this.viewH) * 2 + 1);
    _raycaster.setFromCamera(_ndc, this.camera);
    if (_raycaster.ray.intersectPlane(_groundPlane, _vec3A)) {
      return { wx: _vec3A.x, wy: _vec3A.z };
    }
    return { wx: 28.5, wy: 28.5 };
  }

  private disposeChunkVisual(chunk: ChunkVisual): void {
    this.chunksGroup.remove(chunk.group);
    chunk.terrainTex.dispose();
    chunk.terrainMat.dispose();
    chunk.fpsRoofMesh?.dispose();
    chunk.grassMesh?.dispose();
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

  public clearSceneCaches(): void {
    for (const chunk of this.chunkVisuals.values()) {
      this.disposeChunkVisual(chunk);
    }
    this.chunkVisuals.clear();
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

    // Evict distant chunks
    for (const [key, cv] of this.chunkVisuals.entries()) {
      if (Math.abs(cv.cx - pcx) > keepRadius + 1 || Math.abs(cv.cy - pcy) > keepRadius + 1) {
        this.disposeChunkVisual(cv);
        this.chunkVisuals.delete(key);
        this.burnBarrelsDirty = true;
      }
    }

    for (let cy = pcy - keepRadius; cy <= pcy + keepRadius; cy++) {
      for (let cx = pcx - keepRadius; cx <= pcx + keepRadius; cx++) {
        const key = `${cx},${cy}`;
        if (this.chunkVisuals.has(key)) continue;
        this.chunkVisuals.set(key, this.buildChunkVisual(cx, cy, key, getCell));
        this.burnBarrelsDirty = true;
      }
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

    const terrainTex = this.atlas.createChunkTerrainTexture(getCell, cx, cy, CHUNK_SIZE);
    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainTex,
      roughness: 0.94,
      metalness: 0.02,
    });
    const terrainPlane = new THREE.Mesh(this.chunkPlaneGeo, terrainMat);
    terrainPlane.rotation.x = -Math.PI * 0.5;
    terrainPlane.position.set(startX + CHUNK_SIZE * 0.5, 0, startY + CHUNK_SIZE * 0.5);
    terrainPlane.receiveShadow = true;
    terrainPlane.castShadow = false;
    group.add(terrainPlane);

    const wallEntries: ChunkVisual['wallEntries'] = [];
    const solidWallRoots: THREE.Object3D[] = [];
    const fpsUpperRoots: THREE.Object3D[] = [];
    const staticPropRoots: THREE.Object3D[] = [];
    const burnBarrelFlames: THREE.Group[] = [];
    const burnBarrelCoords: Array<{ x: number; z: number }> = [];
    const lightAnchors: ChunkVisual['lightAnchors'] = [];
    const indoorRoofCells: Array<{ gx: number; gy: number }> = [];
    const mergedGeos: THREE.BufferGeometry[] = [];
    const dynamicWallsGroup = new THREE.Group();
    dynamicWallsGroup.visible = false;

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const gx = startX + lx;
        const gy = startY + ly;
        const cell = getCell(gx, gy);
        if (
          cell.tile === 'floor' ||
          cell.tile === 'floor_rug' ||
          cell.tile === 'floor_bath' ||
          cell.tile === 'tile_clinic' ||
          cell.tile === 'tile_diner'
        ) {
          indoorRoofCells.push({ gx, gy });
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
          solidGroup.position.set(gx + 0.5, 0, gy + 0.5);
          const fpsUpper = solidGroup.userData.fpsUpperGroup as THREE.Group | undefined;
          if (fpsUpper) {
            solidGroup.remove(fpsUpper);
            fpsUpper.visible = true;
            fpsUpper.position.set(gx + 0.5, 0, gy + 0.5);
            fpsUpperRoots.push(fpsUpper);
          }

          const fadedGroup = this.factory.createWallGroup(cell.prop, hasWindow, true);
          fadedGroup.position.set(gx + 0.5, 0, gy + 0.5);
          fadedGroup.visible = false;

          solidWallRoots.push(solidGroup);
          dynamicWallsGroup.add(solidGroup, fadedGroup);
          wallEntries.push({ gx, gy, solidGroup, fadedGroup });
          continue;
        }

        const propGroup = this.factory.createPropGroup(cell.prop);
        propGroup.position.set(gx + 0.5, 0, gy + 0.5);

        if (cell.prop === 'barrel_burn') {
          const fg = propGroup.userData.flameGroup as THREE.Group | undefined;
          if (fg) {
            propGroup.remove(fg);
            fg.position.set(gx + 0.5, 0.74, gy + 0.5);
            group.add(fg);
            burnBarrelFlames.push(fg);
          }
          burnBarrelCoords.push({ x: gx + 0.5, z: gy + 0.5 });
          lightAnchors.push({ x: gx + 0.5, z: gy + 0.5, color: 0xff7b29, intensity: 3.4, distance: 7.5, flicker: true });
        } else if (cell.prop === 'streetlamp') {
          lightAnchors.push({ x: gx + 0.9, z: gy + 0.5, color: 0xffd27a, intensity: 3.2, distance: 8.0, flicker: false });
        } else if (cell.prop === 'fishing_post') {
          lightAnchors.push({ x: gx + 0.7, z: gy + 0.5, color: 0xffcf6e, intensity: 2.6, distance: 6.5, flicker: false });
        } else if (cell.prop === 'stove') {
          lightAnchors.push({ x: gx + 0.5, z: gy + 0.5, color: 0xff6e24, intensity: 2.2, distance: 5.5, flicker: true });
        }

        staticPropRoots.push(propGroup);
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

    // Instanced wind-animated 3D grass across open grass and forest_floor tiles
    const grassMesh = this.grassSystem.createChunkGrassMesh(
      getCell,
      cx,
      cy,
      CHUNK_SIZE,
      this.isSoftwareGl ? 0.55 : 1
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
        _vec3A.set(indoorRoofCells[i].gx + 0.5, 1.72, indoorRoofCells[i].gy + 0.5);
        _mat4.compose(_vec3A, _quat, _scale);
        fpsRoofMesh.setMatrixAt(i, _mat4);
      }
      fpsRoofMesh.instanceMatrix.needsUpdate = true;
      fpsRoofMesh.computeBoundingSphere();
      group.add(fpsRoofMesh);
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
      burnBarrelFlames,
      burnBarrelCoords,
      lightAnchors,
      fpsRoofMesh,
      grassMesh,
    };
  }

  public render(state: RenderFrameState): void {
    const settings = getSettings();
    const isFps = state.cameraMode === 'fps' && state.phase !== 'title';

    // Trauma camera shake (can be switched off in Settings)
    const shakeMag = settings.screenShake ? state.trauma * state.trauma * (isFps ? 0.11 : 0.28) : 0;
    const shakeX = shakeMag > 0.004 ? (Math.random() * 2 - 1) * shakeMag : 0;
    const shakeY = shakeMag > 0.004 ? (Math.random() * 2 - 1) * shakeMag * 0.7 : 0;
    const shakeZ = shakeMag > 0.004 ? (Math.random() * 2 - 1) * shakeMag : 0;

    let targetX: number;
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
        eyeY = FPS_CAR_EYE_HEIGHT;
        eyeZ = activeCar.y + Math.sin(activeCar.angle) * 0.08;
        const speedNorm = clamp(Math.abs(activeCar.speed) / 10, 0, 1);
        targetFov = baseFov + speedNorm * 6 + (activeCar.boosting ? 5 : 0);
      } else {
        const speedNow = Math.hypot(state.playerVelX, state.playerVelY);
        const bob = settings.fpsHeadBob
          ? computeFirstPersonHeadBob(p.walkCycle, speedNow, state.isSprinting, p.dodgeTimer)
          : { eyeOffsetY: p.dodgeTimer > 0 ? -0.28 : 0, swayX: 0, swayY: 0 };
        eyeY = FPS_EYE_HEIGHT + bob.eyeOffsetY;
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

      this.camera.position.set(
        targetX + _camOffsetDir.x * 28,
        _camOffsetDir.y * 28,
        targetZ + _camOffsetDir.z * 28
      );
      this.camera.lookAt(targetX, 0, targetZ);
      this.camera.updateMatrixWorld();
      this.activeCamera = this.camera;
      this.fogExp.density = 0.009;
    }

    // Stream 3D chunks around camera
    this.ensureChunksAround(targetX, targetZ, state.getCell);

    // Update dynamic sky dome, clouds, wind grass, Day/Night lighting, fog & sun shadows
    this.grassSystem.updateWind(state.elapsedClock);
    this.updateAtmosphereAndLights(state, targetX, targetZ, isFps);

    // Toggle FPS ceiling roofs & upper walls only when camera mode flips (zero per-frame scan)
    if (this.lastIsFps !== isFps) {
      this.lastIsFps = isFps;
      for (const cv of this.chunkVisuals.values()) {
        if (cv.fpsRoofMesh) cv.fpsRoofMesh.visible = isFps;
        if (cv.fpsUpperGroup) cv.fpsUpperGroup.visible = isFps;
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
    this.syncZombies(state.zombies, state.elapsedClock, targetX, targetZ);
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
    this.syncAmbientAsh(state.ambientAsh, targetX, targetZ, state.timeMinutes);

    this.renderer.render(this.scene, this.activeCamera);
    this.renderOverlay2D(state, isFps);
  }

  private updateAtmosphereAndLights(
    state: RenderFrameState,
    targetX: number,
    targetZ: number,
    isFps: boolean
  ): void {
    const atmo = computeAtmosphereLighting(state.timeMinutes, this.atmoState);
    this.skyDome.update(targetX, targetZ, atmo, state.elapsedClock, isFps);

    const nightT = atmo.nightT;

    // Sky/fog blend (atmospheric dawn/day/dusk horizon in FPS, deep void vignette in ISO)
    const fogCol = isFps ? atmo.fpsFogColor : atmo.isoFogColor;
    (this.scene.background as THREE.Color).copy(fogCol);
    if (this.scene.fog) {
      this.scene.fog.color.copy(fogCol);
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.density = (isFps ? 0.0085 : 0.009) * atmo.fogDensityScale;
      }
    }

    // Dynamic solar/lunar key light & opposite sky rim fill tracking player bounds
    this.sunLight.position.set(
      targetX + atmo.sunLightOffset.x,
      atmo.sunLightOffset.y,
      targetZ + atmo.sunLightOffset.z
    );
    this.sunLight.target.position.set(targetX, 0, targetZ);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.color.copy(atmo.sunColor);
    this.sunLight.intensity = atmo.sunIntensity;

    this.rimLight.position.set(
      targetX + atmo.rimLightOffset.x,
      atmo.rimLightOffset.y,
      targetZ + atmo.rimLightOffset.z
    );
    this.rimLight.target.position.set(targetX, 0, targetZ);
    this.rimLight.target.updateMatrixWorld();
    this.rimLight.color.copy(atmo.rimColor);
    this.rimLight.intensity = atmo.rimIntensity;

    this.hemiLight.color.copy(atmo.hemiSkyColor);
    this.hemiLight.groundColor.copy(atmo.hemiGroundColor);
    this.hemiLight.intensity = isFps ? Math.max(0.32 * (1 - nightT * 0.65), atmo.hemiIntensity + 0.05) : atmo.hemiIntensity;
    this.scene.environmentIntensity = atmo.envIntensity;
    this.renderer.toneMappingExposure = atmo.exposure;

    // Player flashlight SpotLight (tracks vertical pitch in FPS mode!)
    if (state.phase !== 'title' && state.activeVehicleId === null && state.player.flashlightOn && state.player.battery > 0) {
      const p = state.player;
      if (isFps) {
        const fx = Math.cos(p.facingAngle);
        const fz = Math.sin(p.facingAngle);
        const rx = -fz;
        const rz = fx;
        const cosP = Math.cos(state.fpsPitch);
        this.flashlight.position.set(p.x + fx * 0.18 + rx * 0.16, FPS_EYE_HEIGHT - 0.1, p.y + fz * 0.18 + rz * 0.16);
        this.flashlight.target.position.set(
          p.x + fx * cosP * 7,
          FPS_EYE_HEIGHT + Math.sin(state.fpsPitch) * 7,
          p.y + fz * cosP * 7
        );
      } else {
        this.flashlight.position.set(p.x, 0.85, p.y);
        this.flashlight.target.position.set(
          p.x + Math.cos(p.facingAngle) * 6,
          0,
          p.y + Math.sin(p.facingAngle) * 6
        );
      }
      this.flashlight.target.updateMatrixWorld();
      this.flashlight.intensity = 2.8 + nightT * 7.5;
    } else {
      this.flashlight.intensity = 0;
    }

    // Vehicle headlight SpotLights
    let hlIdx = 0;
    for (const v of state.vehicles) {
      if (hlIdx >= this.headlightLights.length) break;
      if (!v.headlightsOn || v.hp <= 0 || dist(v.x, v.y, targetX, targetZ) > 22) continue;
      const hl = this.headlightLights[hlIdx++];
      const fx = Math.cos(v.angle);
      const fz = Math.sin(v.angle);
      hl.position.set(v.x + fx * 0.75, 0.55, v.y + fz * 0.75);
      hl.target.position.set(v.x + fx * 7.5, 0, v.y + fz * 7.5);
      hl.target.updateMatrixWorld();
      hl.intensity = 3.2 + nightT * 8.5;
    }
    for (let i = hlIdx; i < this.headlightLights.length; i++) {
      this.headlightLights[i].intensity = 0;
    }

    // Dynamic PointLight allocation for nearest campfires, burn barrels, streetlamps, fires & sirens
    const candidates = this._lightCandidates;
    candidates.length = 0;
    const flicker = Math.sin(state.elapsedClock * 13) * 0.45 + Math.cos(state.elapsedClock * 23) * 0.25;

    for (const s of state.structures) {
      if (s.kind !== 'campfire') continue;
      const dx = s.gx + 0.5 - targetX;
      const dz = s.gy + 0.5 - targetZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < 320) {
        candidates.push({
          x: s.gx + 0.5,
          y: 0.65,
          z: s.gy + 0.5,
          color: 0xff8c32,
          intensity: (3.2 + nightT * 2.5) + flicker * 0.7,
          distance: 8.5,
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
          y: 0.6,
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
          y: 1.15,
          z: v.y,
          color: sirenPhase === 0 ? 0xff453a : 0x3b9eff,
          intensity: 3.6 + nightT * 3.0,
          distance: 8.5,
          d2,
        });
      }
    }

    if (nightT > 0.12) {
      for (const cv of this.chunkVisuals.values()) {
        for (const a of cv.lightAnchors) {
          const dx = a.x - targetX;
          const dz = a.z - targetZ;
          const d2 = dx * dx + dz * dz;
          if (d2 < 260) {
            candidates.push({
              x: a.x,
              y: 1.25,
              z: a.z,
              color: a.color,
              intensity: a.intensity * (0.4 + nightT * 0.8) + (a.flicker ? flicker * 0.6 : 0),
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
        rig.root.position.set(d.gx + 0.5, 0, d.gy + 0.5);
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
        drop.position.set(c.gx + 0.5, 0.04 + bob, c.gy + 0.5);
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
        rig.root.position.set(c.gx + 0.5, 0, c.gy + 0.5);
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
        g.position.set(s.gx + 0.5, 0, s.gy + 0.5);
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
      rig.root.position.set(v.x, 0, v.y);
      rig.root.rotation.y = -v.angle;
      rig.cabGroup.visible = !(isFps && activeVehicleId === v.id);

      // Wheel rotation & gentle suspension tilt
      const wheelSpin = elapsedClock * v.speed * 4.5;
      for (const wm of rig.wheelMeshes) {
        wm.rotation.z = -wheelSpin;
      }
      rig.bodyGroup.rotation.z = clamp(v.speed * 0.008, -0.05, 0.05);
      rig.trunkPivot.rotation.z = v.trunkSearched ? -0.9 : 0;

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

  private syncZombies(zombies: Zombie[], elapsedClock: number, targetX: number, targetZ: number): void {
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
        };
        this.zombieRigs.set(z.id, entry);
      }

      const { rig, ring } = entry;
      rig.root.position.set(z.x, 0, z.y);
      const facingAngle = Math.atan2(z.facingY, z.facingX);
      rig.root.rotation.y = -facingAngle;
      rig.root.scale.set(z.scaleX, z.scaleY, z.scaleX);

      const animState = resolveZombieAnimState({
        state: z.state,
        isMoving: z.state === 'chase' || z.state === 'wander' || z.state === 'alert',
      });

      // Windup ground telegraph ring
      ring.visible = z.state === 'windup';
      if (ring.visible) {
        ring.position.set(z.x, 0.03, z.y);
        const pulse = 0.9 + Math.sin(elapsedClock * 18) * 0.12;
        ring.scale.set(pulse, 1, pulse);
      }

      // Articulated 3D animation
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
        if (animState === 'walk') {
          const phase = z.walkCycle * 1.1;
          const s = Math.sin(phase);
          rig.leftLegPivot.rotation.z = s * 0.58;
          rig.rightLegPivot.rotation.z = -s * 0.58;
          rig.leftArmPivot.rotation.z = Math.sin(phase + 0.5) * 0.16;
          rig.rightArmPivot.rotation.z = -Math.sin(phase + 0.5) * 0.16;
          rig.bodyPivot.position.y = Math.abs(Math.cos(phase)) * 0.05;
          rig.torso.rotation.z = z.archetype === 'runner' ? -0.26 : -0.08;
        } else if (animState === 'windup') {
          rig.leftLegPivot.rotation.z = 0.2;
          rig.rightLegPivot.rotation.z = -0.2;
          rig.leftArmPivot.rotation.z = 0.9;
          rig.rightArmPivot.rotation.z = 0.9;
          rig.torso.rotation.z = 0.2;
          rig.bodyPivot.position.y = -0.04;
        } else if (animState === 'attack') {
          rig.leftArmPivot.rotation.z = -0.55;
          rig.rightArmPivot.rotation.z = -0.55;
          rig.torso.rotation.z = -0.35;
          rig.bodyPivot.position.y = 0.03;
        } else {
          rig.leftLegPivot.rotation.z = 0;
          rig.rightLegPivot.rotation.z = 0;
          rig.leftArmPivot.rotation.z = Math.sin(elapsedClock * 2.5 + z.id) * 0.08;
          rig.rightArmPivot.rotation.z = -Math.sin(elapsedClock * 2.5 + z.id) * 0.08;
          rig.torso.rotation.z = z.archetype === 'runner' ? -0.15 : 0;
          rig.bodyPivot.position.y = Math.sin(elapsedClock * 3 + z.id) * 0.02;
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

    this.playerRig.root.position.set(p.x, 0, p.y);
    this.playerRig.root.rotation.y = -p.facingAngle;
    this.playerRig.root.scale.set(p.scaleX, p.scaleY, p.scaleX);

    // Wading: while standing in lake/river water, about 55% of the body sits below the surface.
    const inWater = state.getCell(Math.floor(p.x), Math.floor(p.y)).tile === 'water';
    this.playerWadeDepth += ((inWater ? 0.55 : 0) - this.playerWadeDepth) * 0.25;
    if (Math.abs(this.playerWadeDepth - (inWater ? 0.55 : 0)) < 0.004) this.playerWadeDepth = inWater ? 0.55 : 0;
    const hasWade = this.playerWadeDepth > 0;
    if (hasWade) this.playerWadePlane.constant = -this.playerWadeDepth * this.playerRigHeight * p.scaleY;
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
          this.meleeArcMesh.position.set(p.x, 0.56, p.y);
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
      g.position.set(pr.x, Math.max(0.04, pr.z), pr.y);
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
      g.position.set(fp.x, 0, fp.y);
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
        mesh.position.set(d.x, 0.015 + i * 0.0001, d.y);
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
        mesh.position.set(d.x + d.nx * offset, Math.max(0.015, d.z + d.nz * offset), d.y + d.ny * offset);
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
      fx.root.position.set(e.x + e.nx * 0.02, Math.max(0.02, e.z + e.nz * 0.02), e.y + e.ny * 0.02);

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
        m.position.set(sr.x, 0.03, sr.y);
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

    this.fishingBobber.position.set(fishing.bobberX, 0.06 + bobDip, fishing.bobberY);
    (this.fishingBobber.children[0] as THREE.Mesh).material = this.factory.getMat(
      fishing.phase === 'bite' ? '#ffd266' : '#e0483e'
    );

    const rip = (fishing.ripplePhase * 1.4) % 1;
    this.fishingRipple.position.set(fishing.bobberX, 0.02, fishing.bobberY);
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
    const tipX = isFps ? player.x + fx * 0.72 + rx * 0.2 : player.x + fx * 0.65;
    const tipY = isFps ? FPS_EYE_HEIGHT - 0.05 : 0.95;
    const tipZ = isFps ? player.y + fz * 0.72 + rz * 0.2 : player.y + fz * 0.65;
    const posAttr = this.fishingLine.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, tipX, tipY, tipZ);
    posAttr.setXYZ(1, fishing.bobberX, 0.08 + bobDip, fishing.bobberY);
    posAttr.needsUpdate = true;
  }

  private syncHighlights(state: RenderFrameState): void {
    // Nearest interactive tile outline
    if (state.nearInteractTile && state.phase === 'playing' && state.activeVehicleId === null && !state.player.buildMode) {
      this.interactHighlight.visible = true;
      this.interactHighlight.position.set(state.nearInteractTile.gx + 0.5, 0, state.nearInteractTile.gy + 0.5);
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
        !blockedByStruct &&
        !nearPlayer &&
        Object.entries(STRUCTURES[state.player.buildMode].cost).every(
          ([k, amt]) => (state.inventory[k as keyof Inventory] ?? 0) >= (amt ?? 0)
        );
      this.buildHighlight.visible = true;
      this.buildHighlight.position.set(gx + 0.5, 0, gy + 0.5);
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
      this.molotovReticle.position.set(tx, 0, ty);
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
      _vec3A.set(p.x, Math.max(0.04, p.z), p.y);
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

  private syncAmbientAsh(ashList: RenderAshFlake[], targetX: number, targetZ: number, timeMinutes: number): void {
    const { darkness } = getDaylightInfo(timeMinutes);
    const mat = this.ashInstanced.material as THREE.MeshBasicMaterial;
    mat.opacity = clamp(0.28 + darkness * 0.32, 0.25, 0.62);

    const span = 18;
    const count = Math.min(ashList.length, MAX_ASH_INSTANCES);
    for (let i = 0; i < count; i++) {
      const a = ashList[i];
      _vec3A.set(
        targetX + (a.x - 0.5) * span * 2,
        0.3 + ((1 - a.y) * 2.8),
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
      const topH = z.archetype === 'bloater' ? 1.3 : 1.18;
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
      const proj = this.worldToScreen(d.gx + 0.5, 1.15, d.gy + 0.5);
      if (!proj.visible) continue;
      ctx.fillStyle = '#121518';
      ctx.fillRect(Math.round(proj.sx - 16), Math.round(proj.sy), 32, 6);
      ctx.fillStyle = '#ffd266';
      ctx.fillRect(Math.round(proj.sx - 15), Math.round(proj.sy + 1), Math.round(30 * d.lockpickProgress), 4);
    }

    // Player action badge & reload progress bar
    if (state.phase !== 'title' && state.activeVehicleId === null) {
      const p = state.player;
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
          : this.worldToScreen(p.x, 1.48, p.y);
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
          : this.worldToScreen(p.x, 1.25, p.y);
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
      const proj = this.worldToScreen(ft.x, ft.z + 0.5, ft.y);
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
        : this.worldToScreen(state.player.x, 1.2 + restProg * 0.7, state.player.y);
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

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getLootPopTransform, resolvePlayerAnimState, resolveZombieAnimState, type ActionVisual } from './actionAnimation';
import { CHUNK_SIZE, PIXEL_SCALE, TILE_W, clamp, dist, isoToWorld } from './isometric';
import { WEAPONS } from './recipes';
import {
  FPS_BASE_FOV,
  FPS_CAR_EYE_HEIGHT,
  FPS_EYE_HEIGHT,
  computeFirstPersonHeadBob,
  computeFirstPersonStrafeRoll,
  computeFirstPersonWeaponRaiseOffset,
} from './firstPerson';
import {
  ThreeModelFactory,
  type ActorRig3D,
  type DoorRig3D,
  type FirstPersonViewmodelRig,
  type LootContainerRig3D,
  type VehicleRig3D,
} from './threeModels';
import { ThreePixelAtlas } from './threeTextures';
import { getBuildTargetTile, getDaylightInfo } from './survivalLogic';
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
  wallEntries: Array<{
    gx: number;
    gy: number;
    solidGroup: THREE.Group;
    fadedGroup: THREE.Group;
  }>;
  burnBarrels: THREE.Group[];
  lightAnchors: Array<{ x: number; z: number; color: number; intensity: number; distance: number; flicker: boolean }>;
  fpsRoofMesh?: THREE.InstancedMesh;
}

// Reusable scratch math objects for zero-GC per-frame updates
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
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

export class ThreeIsometricRenderer {
  public readonly isSoftwareGl: boolean;
  private canvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private fogExp: THREE.FogExp2;
  private camera: THREE.OrthographicCamera;
  private fpsCamera: THREE.PerspectiveCamera;
  private activeCamera: THREE.Camera;
  private currentFpsFov = FPS_BASE_FOV;
  private currentFpsRoll = 0;
  private envRT: THREE.WebGLRenderTarget;

  private atlas: ThreePixelAtlas;
  private factory: ThreeModelFactory;

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private flashlight: THREE.SpotLight;
  private headlightLights: THREE.SpotLight[] = [];
  private pointLights: THREE.PointLight[] = [];

  private chunksGroup = new THREE.Group();
  private chunkVisuals = new Map<string, ChunkVisual>();
  private chunkPlaneGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
  private ceilingBoxGeo = new THREE.BoxGeometry(1, 0.08, 1);
  private ceilingMat: THREE.MeshStandardMaterial;

  private doorRigs = new Map<string, DoorRig3D>();
  private containerRigs = new Map<string, LootContainerRig3D>();
  private lootDropRigs = new Map<string, THREE.Group>();
  private structureRigs = new Map<string, THREE.Group>();
  private vehicleRigs = new Map<number, VehicleRig3D>();
  private zombieRigs = new Map<number, { rig: ActorRig3D; archetype: string; ring: THREE.Mesh }>();
  private playerRig: ActorRig3D;
  private fpsViewmodelRig: FirstPersonViewmodelRig;

  private projectileMeshes = new Map<number, THREE.Group>();
  private firePatchMeshes = new Map<number, THREE.Group>();
  private rippleMeshes: THREE.Mesh[] = [];

  private particleInstanced: THREE.InstancedMesh;
  private ashInstanced: THREE.InstancedMesh;
  private decalMeshes: THREE.Mesh[] = [];
  private bulletTracerGeo = new THREE.BoxGeometry(0.76, 0.036, 0.036);
  private bulletCoreGeo = new THREE.BoxGeometry(0.32, 0.056, 0.056);
  private pelletTracerGeo = new THREE.BoxGeometry(0.48, 0.032, 0.032);
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
  private dayColor = new THREE.Color('#1a2024');
  private duskColor = new THREE.Color('#1d1924');
  private nightColor = new THREE.Color('#090d16');
  private fpsDayColor = new THREE.Color('#6f838b');
  private fpsDuskColor = new THREE.Color('#915c49');
  private fpsNightColor = new THREE.Color('#0c1321');
  private sunDayColor = new THREE.Color('#fff2d9');
  private sunDuskColor = new THREE.Color('#ff9d5c');
  private sunNightColor = new THREE.Color('#6c8ec4');
  private hemiSkyDay = new THREE.Color('#9ec0db');
  private hemiSkyNight = new THREE.Color('#1c2a4a');
  private hemiGndDay = new THREE.Color('#3b3328');
  private hemiGndNight = new THREE.Color('#0c1018');

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isSoftwareGl = ThreeIsometricRenderer.detectSoftwareGl();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
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
    this.scene.background = this.dayColor.clone();
    this.fogExp = new THREE.FogExp2(this.dayColor.getHex(), 0.014);
    this.scene.fog = this.fogExp;

    // Mandatory Studio Environment Reflection for metals/glass
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();

    // Locked 2:1 Orthographic Isometric Camera
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -60, 140);
    this.camera.position.copy(_camOffsetDir).multiplyScalar(28);
    this.camera.lookAt(0, 0, 0);

    // First-Person Perspective Camera (added to scene so attached 3D viewmodel renders)
    this.fpsCamera = new THREE.PerspectiveCamera(FPS_BASE_FOV, 16 / 9, 0.08, 95);
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
    this.ceilingMat = new THREE.MeshStandardMaterial({
      map: this.atlas.ceilingTex,
      roughness: 0.92,
      metalness: 0.04,
    });

    this.scene.add(this.chunksGroup);

    // Player 3D rig & First-Person 3D pixel-art viewmodel rig
    this.playerRig = this.factory.createActorRig('player');
    this.scene.add(this.playerRig.root);
    this.fpsViewmodelRig = this.factory.createFirstPersonViewmodelRig();
    this.fpsViewmodelRig.root.visible = false;
    this.fpsCamera.add(this.fpsViewmodelRig.root);

    // Instanced 3D pixel particles
    const partGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleInstanced = new THREE.InstancedMesh(partGeo, partMat, MAX_PARTICLE_INSTANCES);
    this.particleInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleInstanced.frustumCulled = false;
    this.particleInstanced.count = 0;
    this.scene.add(this.particleInstanced);

    // Instanced 3D ambient ashfall
    const ashGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    const ashMat = new THREE.MeshBasicMaterial({ color: 0xc2beb4, transparent: true, opacity: 0.45 });
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

    // 3D Melee crescent slash arc
    const arcGeo = new THREE.RingGeometry(0.75, 1.25, 14, 1, -0.9, 1.8);
    arcGeo.rotateX(-Math.PI * 0.5);
    this.meleeArcMesh = new THREE.Mesh(
      arcGeo,
      new THREE.MeshBasicMaterial({
        color: 0xf2eee2,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
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

  public clearSceneCaches(): void {
    for (const chunk of this.chunkVisuals.values()) {
      this.chunksGroup.remove(chunk.group);
      chunk.terrainTex.dispose();
      chunk.terrainMat.dispose();
      chunk.fpsRoofMesh?.dispose();
    }
    this.chunkVisuals.clear();

    for (const r of this.doorRigs.values()) this.scene.remove(r.root);
    this.doorRigs.clear();

    for (const r of this.containerRigs.values()) this.scene.remove(r.root);
    this.containerRigs.clear();

    for (const r of this.lootDropRigs.values()) this.scene.remove(r);
    this.lootDropRigs.clear();

    for (const r of this.structureRigs.values()) this.scene.remove(r);
    this.structureRigs.clear();

    for (const r of this.vehicleRigs.values()) this.scene.remove(r.root);
    this.vehicleRigs.clear();

    for (const z of this.zombieRigs.values()) {
      this.scene.remove(z.rig.root);
      this.scene.remove(z.ring);
      for (const m of z.rig.allMaterials) m.dispose();
      z.ring.geometry.dispose();
      (z.ring.material as THREE.Material).dispose();
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
          mesh.geometry.dispose();
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
        this.chunksGroup.remove(cv.group);
        cv.terrainTex.dispose();
        cv.terrainMat.dispose();
        cv.fpsRoofMesh?.dispose();
        this.chunkVisuals.delete(key);
      }
    }

    for (let cy = pcy - keepRadius; cy <= pcy + keepRadius; cy++) {
      for (let cx = pcx - keepRadius; cx <= pcx + keepRadius; cx++) {
        const key = `${cx},${cy}`;
        if (this.chunkVisuals.has(key)) continue;
        this.chunkVisuals.set(key, this.buildChunkVisual(cx, cy, key, getCell));
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
    const burnBarrels: THREE.Group[] = [];
    const lightAnchors: ChunkVisual['lightAnchors'] = [];
    const indoorRoofCells: Array<{ gx: number; gy: number }> = [];

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
          const fadedGroup = this.factory.createWallGroup(cell.prop, hasWindow, true);
          fadedGroup.position.set(gx + 0.5, 0, gy + 0.5);
          fadedGroup.visible = false;

          group.add(solidGroup, fadedGroup);
          wallEntries.push({ gx, gy, solidGroup, fadedGroup });
          continue;
        }

        const propGroup = this.factory.createPropGroup(cell.prop);
        propGroup.position.set(gx + 0.5, 0, gy + 0.5);
        group.add(propGroup);

        if (cell.prop === 'barrel_burn') {
          burnBarrels.push(propGroup);
          lightAnchors.push({ x: gx + 0.5, z: gy + 0.5, color: 0xff7b29, intensity: 3.4, distance: 7.5, flicker: true });
        } else if (cell.prop === 'streetlamp') {
          lightAnchors.push({ x: gx + 0.9, z: gy + 0.5, color: 0xffd27a, intensity: 3.2, distance: 8.0, flicker: false });
        } else if (cell.prop === 'fishing_post') {
          lightAnchors.push({ x: gx + 0.7, z: gy + 0.5, color: 0xffcf6e, intensity: 2.6, distance: 6.5, flicker: false });
        } else if (cell.prop === 'stove') {
          lightAnchors.push({ x: gx + 0.5, z: gy + 0.5, color: 0xff6e24, intensity: 2.2, distance: 5.5, flicker: true });
        }
      }
    }

    let fpsRoofMesh: THREE.InstancedMesh | undefined;
    if (indoorRoofCells.length > 0) {
      fpsRoofMesh = new THREE.InstancedMesh(this.ceilingBoxGeo, this.ceilingMat, indoorRoofCells.length);
      fpsRoofMesh.castShadow = false;
      fpsRoofMesh.receiveShadow = true;
      fpsRoofMesh.visible = false;
      _quat.identity();
      _scale.set(1, 1, 1);
      for (let i = 0; i < indoorRoofCells.length; i++) {
        _vec3A.set(indoorRoofCells[i].gx + 0.5, 1.72, indoorRoofCells[i].gy + 0.5);
        _mat4.compose(_vec3A, _quat, _scale);
        fpsRoofMesh.setMatrixAt(i, _mat4);
      }
      fpsRoofMesh.instanceMatrix.needsUpdate = true;
      group.add(fpsRoofMesh);
    }

    this.chunksGroup.add(group);
    return { key, cx, cy, group, terrainTex, terrainMat, wallEntries, burnBarrels, lightAnchors, fpsRoofMesh };
  }

  public render(state: RenderFrameState): void {
    const isFps = state.cameraMode === 'fps' && state.phase !== 'title';

    // Trauma camera shake
    const shakeMag = state.trauma * state.trauma * (isFps ? 0.11 : 0.28);
    const shakeX = shakeMag > 0.004 ? (Math.random() * 2 - 1) * shakeMag : 0;
    const shakeY = shakeMag > 0.004 ? (Math.random() * 2 - 1) * shakeMag * 0.7 : 0;
    const shakeZ = shakeMag > 0.004 ? (Math.random() * 2 - 1) * shakeMag : 0;

    let targetX: number;
    let targetZ: number;

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
      let targetFov = FPS_BASE_FOV;
      let targetRoll = 0;

      if (activeCar) {
        eyeX = activeCar.x + Math.cos(activeCar.angle) * 0.08;
        eyeY = FPS_CAR_EYE_HEIGHT;
        eyeZ = activeCar.y + Math.sin(activeCar.angle) * 0.08;
        const speedNorm = clamp(Math.abs(activeCar.speed) / 10, 0, 1);
        targetFov = FPS_BASE_FOV + speedNorm * 6 + (activeCar.boosting ? 5 : 0);
      } else {
        const speedNow = Math.hypot(state.playerVelX, state.playerVelY);
        const bob = computeFirstPersonHeadBob(p.walkCycle, speedNow, state.isSprinting, p.dodgeTimer);
        eyeY = FPS_EYE_HEIGHT + bob.eyeOffsetY;
        targetRoll = computeFirstPersonStrafeRoll(state.strafeInput, speedNow);
        if (state.isSprinting && speedNow > 0.5) targetFov = FPS_BASE_FOV + 4.5;
        else if (p.dodgeTimer > 0) targetFov = FPS_BASE_FOV + 6;
      }

      if (Math.abs(this.currentFpsFov - targetFov) > 0.05) {
        this.currentFpsFov += (targetFov - this.currentFpsFov) * 0.18;
        this.fpsCamera.fov = this.currentFpsFov;
        this.fpsCamera.updateProjectionMatrix();
      }
      this.currentFpsRoll += (targetRoll - this.currentFpsRoll) * 0.18;

      const cosP = Math.cos(state.fpsPitch);
      const lookDirX = Math.cos(p.facingAngle) * cosP;
      const lookDirY = Math.sin(state.fpsPitch);
      const lookDirZ = Math.sin(p.facingAngle) * cosP;

      this.fpsCamera.position.set(eyeX + shakeX, eyeY + shakeY, eyeZ + shakeZ);
      this.fpsCamera.lookAt(
        eyeX + shakeX + lookDirX,
        eyeY + shakeY + lookDirY,
        eyeZ + shakeZ + lookDirZ
      );
      if (Math.abs(this.currentFpsRoll) > 0.0005) {
        this.fpsCamera.rotateZ(this.currentFpsRoll);
      }
      this.fpsCamera.updateMatrixWorld();
      this.activeCamera = this.fpsCamera;
      this.fogExp.density = 0.0155;
    } else {
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
      this.fogExp.density = 0.014;
    }

    // Stream 3D chunks around camera
    this.ensureChunksAround(targetX, targetZ, state.getCell);

    // Update dynamic Day/Night lighting, fog & sun shadows
    this.updateAtmosphereAndLights(state, targetX, targetZ, isFps);

    // Wall foreground occlusion fading (disabled in FPS) + FPS upper walls, interior ceilings & barrel flames
    for (const cv of this.chunkVisuals.values()) {
      if (cv.fpsRoofMesh) cv.fpsRoofMesh.visible = isFps;
      for (const w of cv.wallEntries) {
        const fpsUpper = w.solidGroup.userData.fpsUpperGroup as THREE.Group | undefined;
        if (fpsUpper) fpsUpper.visible = isFps;

        const occludes =
          !isFps &&
          state.phase !== 'title' &&
          w.gx + w.gy > state.player.x + state.player.y + 0.15 &&
          Math.abs(w.gx + 0.5 - state.player.x) < 2.2 &&
          Math.abs(w.gy + 0.5 - state.player.y) < 2.2;
        w.solidGroup.visible = !occludes;
        w.fadedGroup.visible = occludes;
      }
      for (const barrel of cv.burnBarrels) {
        const fg = barrel.userData.flameGroup as THREE.Group | undefined;
        if (fg) {
          const pulse = 0.88 + Math.sin(state.elapsedClock * 16 + barrel.position.x * 3.1) * 0.22;
          fg.scale.set(1, pulse, 1);
          fg.rotation.y = Math.sin(state.elapsedClock * 9 + barrel.position.z) * 0.2;
        }
      }
    }

    // Sync doors, containers, loot drops, structures, vehicles, zombies, player, VFX
    this.syncDoors(state.doors, targetX, targetZ, isFps);
    this.syncContainers(state.containers, state.player, state.elapsedClock, targetX, targetZ);
    this.syncStructures(state.structures, state.elapsedClock);
    this.syncVehicles(state.vehicles, state.player, state.activeVehicleId, state.elapsedClock, isFps);
    this.syncZombies(state.zombies, state.elapsedClock);
    this.syncPlayer(state, isFps);
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
    const { darkness, phaseLabel } = getDaylightInfo(state.timeMinutes);
    const nightT = clamp((darkness - 0.08) / 0.7, 0, 1);

    // Sky/fog blend (atmospheric overcast horizon in FPS, dark void edges in ISO)
    const cDay = isFps ? this.fpsDayColor : this.dayColor;
    const cDusk = isFps ? this.fpsDuskColor : this.duskColor;
    const cNight = isFps ? this.fpsNightColor : this.nightColor;
    if (phaseLabel === 'DAWN' || phaseLabel === 'DUSK') {
      _color.copy(cDay).lerp(cDusk, Math.sin(nightT * Math.PI));
      _color.lerp(cNight, nightT * 0.65);
    } else {
      _color.copy(cDay).lerp(cNight, nightT);
    }
    (this.scene.background as THREE.Color).copy(_color);
    if (this.scene.fog) this.scene.fog.color.copy(_color);

    // Sun DirectionalLight follows player shadow bounds
    this.sunLight.position.set(targetX - 16, 26, targetZ - 12);
    this.sunLight.target.position.set(targetX, 0, targetZ);
    this.sunLight.target.updateMatrixWorld();

    if (phaseLabel === 'DAWN' || phaseLabel === 'DUSK') {
      this.sunLight.color.copy(this.sunDayColor).lerp(this.sunDuskColor, 0.75);
    } else {
      this.sunLight.color.copy(this.sunDayColor).lerp(this.sunNightColor, nightT);
    }
    this.sunLight.intensity = 1.65 * (1 - nightT * 0.78);

    this.hemiLight.color.copy(this.hemiSkyDay).lerp(this.hemiSkyNight, nightT);
    this.hemiLight.groundColor.copy(this.hemiGndDay).lerp(this.hemiGndNight, nightT);
    this.hemiLight.intensity = isFps ? Math.max(0.32, 0.88 - nightT * 0.56) : 0.8 - nightT * 0.56;

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
    const candidates: Array<{ x: number; y: number; z: number; color: number; intensity: number; distance: number; d2: number }> = [];
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
    const activeIds = new Set<string>();
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
    const activeContainers = new Set<string>();
    const activeDrops = new Set<string>();

    for (const c of containers) {
      if (Math.abs(c.gx - targetX) > 26 || Math.abs(c.gy - targetZ) > 26) continue;
      if (c.kind === 'zombie_drop') {
        if (c.searched) continue;
        activeDrops.add(c.id);
        let drop = this.lootDropRigs.get(c.id);
        if (!drop) {
          drop = this.factory.createLootDropGroup();
          this.scene.add(drop);
          this.lootDropRigs.set(c.id, drop);
        }
        const bob = Math.sin(elapsedClock * 4 + c.gx * 1.7 + c.gy) * 0.05;
        drop.position.set(c.gx + 0.5, 0.04 + bob, c.gy + 0.5);
        drop.rotation.y = Math.sin(elapsedClock * 1.8 + c.gx) * 0.25;
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
        this.lootDropRigs.delete(id);
      }
    }
  }

  private syncStructures(structures: WorldStructure[], elapsedClock: number): void {
    const activeIds = new Set<string>();
    for (const s of structures) {
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
          const flick = 0.85 + Math.sin(elapsedClock * 15 + s.gx * 2.1) * 0.25;
          fg.scale.set(1, flick, 1);
          fg.rotation.y = Math.sin(elapsedClock * 8 + s.gy) * 0.25;
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
    isFps: boolean
  ): void {
    const activeIds = new Set<number>();
    const sirenPhase = Math.floor(elapsedClock * 7) % 2;

    for (const v of vehicles) {
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

  private syncZombies(zombies: Zombie[], elapsedClock: number): void {
    const activeIds = new Set<number>();
    for (const z of zombies) {
      activeIds.add(z.id);
      let entry = this.zombieRigs.get(z.id);
      if (!entry) {
        const rig = this.factory.createActorRig(z.archetype);
        const ringGeo = new THREE.RingGeometry(0.32, 0.42, 18);
        ringGeo.rotateX(-Math.PI * 0.5);
        const ring = new THREE.Mesh(
          ringGeo,
          new THREE.MeshBasicMaterial({
            color: z.archetype === 'spitter' ? 0x5ef2b5 : 0xff4d42,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        ring.visible = false;
        this.scene.add(rig.root);
        this.scene.add(ring);
        entry = { rig, archetype: z.archetype, ring };
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
        for (const m of rig.allMaterials) {
          m.transparent = fade < 0.99;
          m.opacity = fade;
        }
      } else {
        rig.bodyPivot.rotation.z = 0;
        for (const m of rig.allMaterials) {
          m.transparent = false;
          m.opacity = 1;
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

      // Hit flash white emissive
      const flash = z.hitFlash > 0;
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

    for (const [id, entry] of this.zombieRigs.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.rig.root);
        this.scene.remove(entry.ring);
        for (const m of entry.rig.allMaterials) m.dispose();
        entry.ring.geometry.dispose();
        (entry.ring.material as THREE.Material).dispose();
        this.zombieRigs.delete(id);
      }
    }
  }

  private syncPlayer(state: RenderFrameState, isFps: boolean): void {
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
    if (showViewmodel) {
      for (const wKey of Object.keys(this.fpsViewmodelRig.weapons) as Array<keyof typeof this.fpsViewmodelRig.weapons>) {
        this.fpsViewmodelRig.weapons[wKey].visible =
          state.fishing.phase === 'idle' && wKey === p.equippedWeapon && animState !== 'dodge';
      }
      this.fpsViewmodelRig.fishingRod.visible = state.fishing.phase !== 'idle';
      const showMuzzle =
        state.muzzleFlashTimer > 0 && (p.equippedWeapon === 'pistol' || p.equippedWeapon === 'shotgun');
      this.fpsViewmodelRig.muzzleFlash.visible = showMuzzle;
      if (showMuzzle) {
        this.fpsViewmodelRig.muzzleFlash.position.x = p.equippedWeapon === 'pistol' ? 0.32 : 0.58;
      }

      const speedNow = Math.hypot(state.playerVelX, state.playerVelY);
      const bob = computeFirstPersonHeadBob(p.walkCycle, speedNow, state.isSprinting, p.dodgeTimer);
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

      if (p.reloadingTimer > 0) {
        const total = WEAPONS[p.reloadingWeapon ?? p.equippedWeapon].reloadTime || 1;
        const prog = clamp(1 - p.reloadingTimer / total, 0, 1);
        const dip = Math.sin(prog * Math.PI);
        posY -= dip * 0.14;
        rotX -= dip * 0.55;
        rotZ += dip * 0.25;
      } else if (p.meleeSwingTimer > 0) {
        const swingProg = 1 - clamp(p.meleeSwingTimer / 0.22, 0, 1);
        const arc = Math.sin(swingProg * Math.PI);
        posX -= arc * 0.18;
        posZ -= arc * 0.08;
        rotX -= arc * 0.72;
        rotY += arc * 0.65;
        rotZ += arc * 0.55;
      } else if (p.attackCooldown > 0 && (p.equippedWeapon === 'pistol' || p.equippedWeapon === 'shotgun')) {
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

      this.fpsViewmodelRig.armPivot.position.set(posX, posY, posZ);
      this.fpsViewmodelRig.armPivot.rotation.set(rotX, rotY, rotZ);
    }

    if (!thirdPersonVisible) return;

    this.playerRig.root.position.set(p.x, 0, p.y);
    this.playerRig.root.rotation.y = -p.facingAngle;
    this.playerRig.root.scale.set(p.scaleX, p.scaleY, p.scaleX);

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
      this.playerRig.muzzleFlash.visible =
        state.muzzleFlashTimer > 0 && (p.equippedWeapon === 'pistol' || p.equippedWeapon === 'shotgun');
    }

    // Articulated pose
    const isGun = p.equippedWeapon === 'pistol' || p.equippedWeapon === 'shotgun';
    if (animState === 'dodge') {
      const rollProg = 1 - clamp(p.dodgeTimer / 0.22, 0, 1);
      this.playerRig.bodyPivot.rotation.z = -rollProg * Math.PI * 2;
      this.playerRig.bodyPivot.position.y = 0.22;
      this.playerRig.leftLegPivot.rotation.z = 0.5;
      this.playerRig.rightLegPivot.rotation.z = 0.5;
      if (this.playerRig.weaponGroup) this.playerRig.weaponGroup.rotation.z = 0;
    } else {
      this.playerRig.bodyPivot.rotation.z = 0;
      if (animState === 'walk') {
        const phase = p.walkCycle * 1.1;
        const s = Math.sin(phase);
        this.playerRig.leftLegPivot.rotation.z = s * 0.62;
        this.playerRig.rightLegPivot.rotation.z = -s * 0.62;
        this.playerRig.leftArmPivot.rotation.z = -s * 0.45;
        this.playerRig.rightArmPivot.rotation.z = isGun ? 1.32 : s * 0.35;
        this.playerRig.bodyPivot.position.y = Math.abs(Math.cos(phase)) * 0.05;
        this.playerRig.torso.rotation.z = -0.06;
      } else {
        this.playerRig.leftLegPivot.rotation.z = 0;
        this.playerRig.rightLegPivot.rotation.z = 0;
        this.playerRig.leftArmPivot.rotation.z = 0;
        this.playerRig.rightArmPivot.rotation.z =
          state.fishing.phase !== 'idle' ? 0.85 : isGun ? 1.38 : 0.35;
        this.playerRig.torso.rotation.z = 0;
        this.playerRig.bodyPivot.position.y = Math.sin(state.elapsedClock * 3.5) * 0.02;
      }

      if (p.meleeSwingTimer > 0) {
        const swingProg = 1 - clamp(p.meleeSwingTimer / 0.22, 0, 1);
        this.playerRig.rightArmPivot.rotation.z = 1.4 - swingProg * 2.2;
        this.playerRig.rightArmPivot.rotation.y = 0.7 - swingProg * 1.6;
        this.meleeArcMesh.visible = true;
        this.meleeArcMesh.position.set(p.x, 0.46, p.y);
        this.meleeArcMesh.rotation.y = -p.facingAngle;
      } else {
        this.playerRig.rightArmPivot.rotation.y = 0;
      }

      if (this.playerRig.weaponGroup) {
        this.playerRig.weaponGroup.rotation.z = isGun ? -this.playerRig.rightArmPivot.rotation.z : 0;
      }
    }

    const flash = p.hitFlash > 0;
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

  private syncProjectiles(projectiles: Projectile[], elapsedClock: number): void {
    const activeIds = new Set<number>();
    for (const pr of projectiles) {
      activeIds.add(pr.id);
      let g = this.projectileMeshes.get(pr.id);
      if (!g) {
        g = new THREE.Group();
        if (pr.kind === 'molotov') {
          g.add(
            new THREE.Mesh(
              new THREE.BoxGeometry(0.14, 0.22, 0.14),
              this.factory.getMat('#5f8a4b', { roughness: 0.3 })
            ),
            new THREE.Mesh(
              new THREE.BoxGeometry(0.1, 0.1, 0.1),
              this.factory.getMat('#ffae38', { emissive: '#ffae38', emissiveIntensity: 2.0 })
            )
          );
          g.children[1].position.y = 0.15;
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
    const activeIds = new Set<number>();
    for (const fp of firePatches) {
      activeIds.add(fp.id);
      let g = this.firePatchMeshes.get(fp.id);
      if (!g) {
        g = new THREE.Group();
        const isFire = fp.kind === 'fire';
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(fp.radius, 18),
          new THREE.MeshBasicMaterial({
            color: isFire ? 0xf57e20 : 0x4ee674,
            transparent: true,
            opacity: 0.42,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
          })
        );
        disc.rotation.x = -Math.PI * 0.5;
        disc.position.y = 0.025;
        g.add(disc);
        if (isFire) {
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            const flame = new THREE.Mesh(
              new THREE.BoxGeometry(0.18, 0.34, 0.18),
              this.factory.getMat('#ff982b', { emissive: '#ff982b', emissiveIntensity: 1.8 })
            );
            flame.position.set(Math.cos(a) * fp.radius * 0.45, 0.18, Math.sin(a) * fp.radius * 0.45);
            g.add(flame);
          }
        }
        this.scene.add(g);
        this.firePatchMeshes.set(fp.id, g);
      }
      g.position.set(fp.x, 0, fp.y);
      const alpha = Math.min(0.45, fp.life * 0.2);
      const discMat = (g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      discMat.opacity = alpha;
      for (let i = 1; i < g.children.length; i++) {
        g.children[i].scale.y = 0.75 + Math.sin(elapsedClock * 16 + i * 2) * 0.35;
      }
    }
    for (const [id, g] of this.firePatchMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(g);
        g.traverse((c: THREE.Object3D) => {
          if ((c as THREE.Mesh).isMesh) {
            const mesh = c as THREE.Mesh;
            mesh.geometry.dispose();
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
      _quat.identity();
      const s = (0.55 + p.size * 0.35) * alphaScale;
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
    mat.color.setHex(0xd4dad6);
    mat.opacity = clamp(0.24 + darkness * 0.3, 0.22, 0.56);

    const span = 18;
    const count = Math.min(ashList.length, MAX_ASH_INSTANCES);
    for (let i = 0; i < count; i++) {
      const a = ashList[i];
      _vec3A.set(
        targetX + (a.x - 0.5) * span * 2,
        0.3 + ((1 - a.y) * 2.8),
        targetZ + (a.y - 0.5) * span * 2
      );
      _quat.identity();
      _scale.setScalar(a.size * 0.42);
      _mat4.compose(_vec3A, _quat, _scale);
      this.ashInstanced.setMatrixAt(i, _mat4);
    }
    this.ashInstanced.count = count;
    this.ashInstanced.instanceMatrix.needsUpdate = true;
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

    // Subtle FPS peripheral vignette for grounded depth
    if (isFps && state.phase === 'playing') {
      const grad = ctx.createRadialGradient(
        this.viewW * 0.5,
        this.viewH * 0.5,
        Math.min(this.viewW, this.viewH) * 0.32,
        this.viewW * 0.5,
        this.viewH * 0.5,
        Math.max(this.viewW, this.viewH) * 0.72
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, state.isSprinting ? 'rgba(6,8,10,0.42)' : 'rgba(6,8,10,0.28)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
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
          : state.player.equippedWeapon === 'crowbar'
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
      ctx.fillStyle = state.player.equippedWeapon === 'crowbar' && showFpsReticle ? '#ffd266' : '#d9822b';
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
    this.chunkPlaneGeo.dispose();
    this.ceilingBoxGeo.dispose();
    this.ceilingMat.dispose();
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
    this.impactDecalGeo.dispose();
    this.impactFlashGeo.dispose();
    this.impactSparkGeo.dispose();
    this.renderer.dispose();
  }
}

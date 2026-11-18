import * as THREE from 'three';
import {
  SUPERCAR_CANOPY_PROFILE,
  SUPERCAR_HULL_PROFILE,
  TENT_PROFILE,
  WRECKED_SUPERCAR_PROFILE,
  createFacetedBoulderGeometry,
  createHelicalWireGeometry,
  createLatheWeaponGeometry,
  createSculptedProfileGeometry,
  createTaperedBoxGeometry,
} from './modelSculpt';
import { getFirstPersonMeleeGripPose } from './meleeAnimation';
import { derivePlayerPalette } from './profile';
import type { ThreePixelAtlas } from './threeTextures';
import type { ItemId, PropKind, StructureKind, WeaponId, ZombieArchetype } from './types';

export interface DoorRig3D {
  root: THREE.Group;
  hingePivot: THREE.Group;
  doorMesh: THREE.Mesh;
  padlockGroup: THREE.Group;
  barricadeGroup: THREE.Group;
  fpsLintelGroup: THREE.Group;
}

export interface LootContainerRig3D {
  root: THREE.Group;
  lidPivot: THREE.Group;
  bodyGroup: THREE.Group;
  glintMesh: THREE.Mesh;
}

export interface VehicleRig3D {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  cabGroup: THREE.Group;
  wheelFL: THREE.Group;
  wheelFR: THREE.Group;
  wheelMeshes: THREE.Mesh[];
  trunkPivot: THREE.Group;
  tailLights: THREE.Mesh[];
  sirenRed?: THREE.Mesh;
  sirenBlue?: THREE.Mesh;
  glintMesh: THREE.Mesh;
}

export interface FirstPersonViewmodelRig {
  root: THREE.Group;
  armPivot: THREE.Group;
  weapons: Record<WeaponId, THREE.Group>;
  muzzleFlash: THREE.Group;
  fishingRod: THREE.Group;
  molotovFlame: THREE.Group;
}

export interface ActorRig3D {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  torso: THREE.Group;
  headPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  weaponGroup?: THREE.Group;
  weapons?: Record<WeaponId, THREE.Group>;
  muzzleFlash?: THREE.Group;
  fishingRod?: THREE.Group;
  flashMeshes: THREE.Mesh[];
  flashMaterials: THREE.MeshStandardMaterial[];
  allMaterials: THREE.MeshStandardMaterial[];
}

export class ThreeModelFactory {
  private atlas: ThreePixelAtlas;
  private geometries: THREE.BufferGeometry[] = [];
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private materials: THREE.Material[] = [];
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  private physMatCache = new Map<string, THREE.MeshPhysicalMaterial>();
  private unitBox: THREE.BoxGeometry;
  private unitCylX: THREE.CylinderGeometry;
  private unitWheelGeo: THREE.CylinderGeometry;
  private supercarHullGeo: THREE.BufferGeometry;
  private supercarCanopyGeo: THREE.BufferGeometry;
  private wreckedHullGeo: THREE.BufferGeometry;
  private wreckedCanopyGeo: THREE.BufferGeometry;
  private pustuleGeo: THREE.IcosahedronGeometry;
  private spineConeGeo: THREE.ConeGeometry;
  private tentBodyGeo: THREE.BufferGeometry;
  private boulderMainGeo: THREE.BufferGeometry;
  private boulderSideGeo: THREE.BufferGeometry;
  private boulderTopGeo: THREE.BufferGeometry;
  private campStoneGeo: THREE.BufferGeometry;
  private pineTrunkGeo: THREE.CylinderGeometry;
  private pineConeGeo: THREE.ConeGeometry;
  private deadTrunkGeo: THREE.CylinderGeometry;
  private branchCylGeo: THREE.CylinderGeometry;
  private logCylGeo: THREE.CylinderGeometry;
  private logCapGeo: THREE.CylinderGeometry;
  private flameCardGeo: THREE.PlaneGeometry;
  private flameSpireGeo: THREE.ConeGeometry;
  private glintDiamondGeo: THREE.OctahedronGeometry;

  constructor(atlas: ThreePixelAtlas) {
    this.atlas = atlas;
    this.unitBox = this.trackGeo(new THREE.BoxGeometry(1, 1, 1));
    const cylX = new THREE.CylinderGeometry(1, 1, 1, 10);
    cylX.rotateZ(Math.PI * 0.5);
    this.unitCylX = this.trackGeo(cylX);
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    wheelGeo.rotateX(Math.PI * 0.5);
    this.unitWheelGeo = this.trackGeo(wheelGeo);

    this.supercarHullGeo = this.trackGeo(
      createSculptedProfileGeometry(SUPERCAR_HULL_PROFILE, 0.88, {
        bevelThickness: 0.025,
        bevelSize: 0.02,
        bevelSegments: 1,
        multiMaterialGroups: true,
      })
    );
    this.supercarCanopyGeo = this.trackGeo(
      createSculptedProfileGeometry(SUPERCAR_CANOPY_PROFILE, 0.70, {
        bevelThickness: 0.02,
        bevelSize: 0.018,
        bevelSegments: 1,
        multiMaterialGroups: true,
      })
    );
    this.wreckedHullGeo = this.trackGeo(
      createSculptedProfileGeometry(WRECKED_SUPERCAR_PROFILE, 0.78, {
        bevelThickness: 0.02,
        bevelSize: 0.016,
        bevelSegments: 1,
        multiMaterialGroups: false,
      })
    );
    this.wreckedCanopyGeo = this.trackGeo(
      createSculptedProfileGeometry(SUPERCAR_CANOPY_PROFILE, 0.62, {
        bevelThickness: 0.015,
        bevelSize: 0.012,
        bevelSegments: 1,
        multiMaterialGroups: false,
      })
    );
    this.pustuleGeo = this.trackGeo(new THREE.IcosahedronGeometry(0.06, 0));
    this.spineConeGeo = this.trackGeo(new THREE.ConeGeometry(0.036, 0.11, 5));
    this.tentBodyGeo = this.trackGeo(
      createSculptedProfileGeometry(TENT_PROFILE, 0.88, {
        bevelThickness: 0.014,
        bevelSize: 0.012,
        bevelSegments: 1,
        multiMaterialGroups: false,
      })
    );
    this.boulderMainGeo = this.trackGeo(createFacetedBoulderGeometry(0.41, 7, 0.72));
    this.boulderSideGeo = this.trackGeo(createFacetedBoulderGeometry(0.25, 23, 0.68));
    this.boulderTopGeo = this.trackGeo(createFacetedBoulderGeometry(0.23, 53, 0.62));
    this.campStoneGeo = this.trackGeo(createFacetedBoulderGeometry(0.11, 89, 0.65));
    this.pineTrunkGeo = this.trackGeo(new THREE.CylinderGeometry(0.085, 0.175, 1.04, 8));
    this.pineConeGeo = this.trackGeo(new THREE.ConeGeometry(0.5, 1.0, 7));
    this.deadTrunkGeo = this.trackGeo(new THREE.CylinderGeometry(0.068, 0.165, 1.14, 7));
    const branchGeo = new THREE.CylinderGeometry(0.012, 0.052, 1.0, 6);
    branchGeo.translate(0, 0.5, 0);
    this.branchCylGeo = this.trackGeo(branchGeo);
    const logCyl = new THREE.CylinderGeometry(0.16, 0.185, 0.90, 9);
    logCyl.rotateZ(Math.PI * 0.5);
    this.logCylGeo = this.trackGeo(logCyl);
    const logCap = new THREE.CylinderGeometry(0.15, 0.15, 0.016, 9);
    logCap.rotateZ(Math.PI * 0.5);
    this.logCapGeo = this.trackGeo(logCap);
    this.flameCardGeo = this.trackGeo(new THREE.PlaneGeometry(1, 1));
    this.flameSpireGeo = this.trackGeo(new THREE.ConeGeometry(0.5, 1.0, 6));
    this.glintDiamondGeo = this.trackGeo(new THREE.OctahedronGeometry(0.08, 0));
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private getTaperedGeo(
    topW: number,
    topD: number,
    botW: number,
    botD: number,
    height: number,
    centerY = false
  ): THREE.BufferGeometry {
    const key = `${topW}_${topD}_${botW}_${botD}_${height}_${centerY ? 1 : 0}`;
    const existing = this.geoCache.get(key);
    if (existing) return existing;
    const g = this.trackGeo(createTaperedBoxGeometry(topW, topD, botW, botD, height, centerY));
    this.geoCache.set(key, g);
    return g;
  }

  private getCachedGeo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
    const existing = this.geoCache.get(key);
    if (existing) return existing;
    const g = this.trackGeo(build());
    this.geoCache.set(key, g);
    return g;
  }

  private taperedMesh(
    topW: number,
    topD: number,
    botW: number,
    botD: number,
    height: number,
    mat: THREE.Material | THREE.Material[],
    x = 0,
    y = 0,
    z = 0,
    centerY = false,
    castShadow = true,
    receiveShadow = true
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.getTaperedGeo(topW, topD, botW, botD, height, centerY), mat);
    m.position.set(x, y, z);
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    return m;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  public getMat(
    color: string | number,
    opts: {
      roughness?: number;
      metalness?: number;
      map?: THREE.Texture;
      emissive?: string | number;
      emissiveMap?: THREE.Texture;
      emissiveIntensity?: number;
      transparent?: boolean;
      opacity?: number;
      alphaTest?: number;
      side?: THREE.Side;
    } = {}
  ): THREE.MeshStandardMaterial {
    const key = [
      color,
      opts.roughness ?? 0.85,
      opts.metalness ?? 0.05,
      opts.map?.uuid ?? 'nomap',
      opts.emissive ?? 'noem',
      opts.emissiveMap?.uuid ?? 'noemap',
      opts.emissiveIntensity ?? 0,
      opts.transparent ? 'tr' : 'op',
      opts.opacity ?? 1,
      opts.alphaTest ?? 0,
      opts.side ?? THREE.FrontSide,
    ].join('_');
    const existing = this.matCache.get(key);
    if (existing) return existing;

    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.85,
        metalness: opts.metalness ?? 0.05,
        map: opts.map ?? null,
        emissive: opts.emissive ?? 0x000000,
        emissiveMap: opts.emissiveMap ?? null,
        emissiveIntensity: opts.emissiveIntensity ?? 0,
        transparent: opts.transparent ?? false,
        opacity: opts.opacity ?? 1,
        alphaTest: opts.alphaTest ?? 0,
        side: opts.side ?? THREE.FrontSide,
      })
    );
    this.matCache.set(key, mat);
    return mat;
  }

  public getPhysicalMat(
    color: string | number,
    opts: {
      roughness?: number;
      metalness?: number;
      clearcoat?: number;
      clearcoatRoughness?: number;
      envMapIntensity?: number;
      map?: THREE.Texture;
    } = {}
  ): THREE.MeshPhysicalMaterial {
    const key = [
      'phys',
      color,
      opts.roughness ?? 0.26,
      opts.metalness ?? 0.46,
      opts.clearcoat ?? 1.0,
      opts.clearcoatRoughness ?? 0.08,
      opts.envMapIntensity ?? 1.25,
      opts.map?.uuid ?? 'nomap',
    ].join('_');
    const existing = this.physMatCache.get(key);
    if (existing) return existing;

    const mat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: opts.roughness ?? 0.26,
        metalness: opts.metalness ?? 0.46,
        clearcoat: opts.clearcoat ?? 1.0,
        clearcoatRoughness: opts.clearcoatRoughness ?? 0.08,
        envMapIntensity: opts.envMapIntensity ?? 1.25,
        map: opts.map ?? null,
      })
    );
    this.physMatCache.set(key, mat);
    return mat;
  }

  private box(
    w: number,
    h: number,
    d: number,
    mat: THREE.Material | THREE.Material[],
    x = 0,
    y = 0,
    z = 0,
    castShadow = true,
    receiveShadow = true
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.unitBox, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    return m;
  }

  private cylX(
    radius: number,
    length: number,
    mat: THREE.Material | THREE.Material[],
    x = 0,
    y = 0,
    z = 0,
    castShadow = false,
    receiveShadow = true
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.unitCylX, mat);
    m.scale.set(length, radius, radius);
    m.position.set(x, y, z);
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    return m;
  }

  private cylinderWheel(
    diameter: number,
    width: number,
    mat: THREE.Material | THREE.Material[],
    x = 0,
    y = 0,
    z = 0,
    castShadow = true,
    receiveShadow = true
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.unitWheelGeo, mat);
    m.scale.set(diameter, diameter, width);
    m.position.set(x, y, z);
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    return m;
  }

  private contactShadowPlane = this.trackGeo(new THREE.PlaneGeometry(1, 1));

  private addContactShadow(parent: THREE.Object3D, width: number, depth: number, y = 0.012): void {
    const mat = this.getMat(0xffffff, {
      map: this.atlas.contactShadowTex,
      transparent: true,
      opacity: 0.72,
      roughness: 1,
      metalness: 0,
    });
    mat.depthWrite = false;
    const disc = new THREE.Mesh(this.contactShadowPlane, mat);
    disc.rotation.x = -Math.PI * 0.5;
    disc.scale.set(width, depth, 1);
    disc.position.y = y;
    disc.receiveShadow = false;
    disc.castShadow = false;
    parent.add(disc);
  }

  public createWallGroup(
    kind: 'wall_brick' | 'wall_wood' | 'wall_interior',
    hasWindow: boolean,
    transparentFaded = false
  ): THREE.Group {
    const g = new THREE.Group();
    const h = kind === 'wall_interior' ? 0.78 : 1.02;
    const sideTex = this.atlas.wallSideTextures.get(`${kind}_${hasWindow && kind !== 'wall_interior' ? 1 : 0}`)!;
    const capTex = this.atlas.wallCapTextures.get(kind)!;
    const op = transparentFaded ? 0.36 : 1;
    const tr = transparentFaded;

    const sideMat = this.getMat(0xffffff, {
      map: sideTex,
      roughness: kind === 'wall_brick' ? 0.92 : 0.86,
      transparent: tr,
      opacity: op,
    });
    const capMat = this.getMat(0xffffff, {
      map: capTex,
      roughness: 0.9,
      transparent: tr,
      opacity: op,
    });

    const core = new THREE.Mesh(this.unitBox, [sideMat, sideMat, capMat, capMat, sideMat, sideMat]);
    core.scale.set(1.0, h, 1.0);
    core.position.set(0, h * 0.5, 0);
    core.castShadow = !transparentFaded;
    core.receiveShadow = true;
    g.add(core);

    // Subtle coping cap ledge
    const ledgeColor = kind === 'wall_brick' ? '#9c8d76' : kind === 'wall_wood' ? '#7d4d29' : '#b8ab96';
    const ledge = this.box(
      1.02,
      0.06,
      1.02,
      this.getMat(ledgeColor, { roughness: 0.88, transparent: tr, opacity: op }),
      0,
      h - 0.02,
      0,
      !transparentFaded,
      true
    );
    g.add(ledge);

    if (hasWindow && kind !== 'wall_interior') {
      const plankMat = this.getMat('#996a42', { roughness: 0.86, transparent: tr, opacity: op });
      const glassMat = this.getMat('#182836', { roughness: 0.18, metalness: 0.25, transparent: tr, opacity: op });
      const sill = this.box(1.05, 0.06, 1.05, this.getMat('#453222', { roughness: 0.88, transparent: tr, opacity: op }), 0, 0.35, 0, false, true);
      const pane = this.box(1.02, 0.42, 1.02, glassMat, 0, 0.58, 0, false, false);
      const plank1 = this.box(1.05, 0.08, 1.05, plankMat, 0, 0.49, 0, false, true);
      const plank2 = this.box(1.05, 0.08, 1.05, plankMat, 0, 0.67, 0, false, true);
      g.add(sill, pane, plank1, plank2);
    }

    // Upper wall extension shown only in First-Person mode so buildings stand full-height at eye level
    if (!transparentFaded) {
      const fpsUpperGroup = new THREE.Group();
      const upperSideTex = this.atlas.wallSideTextures.get(`${kind}_0`)!;
      const upperSideMat = this.getMat(0xffffff, {
        map: upperSideTex,
        roughness: kind === 'wall_brick' ? 0.92 : 0.86,
      });
      const upperH = kind === 'wall_interior' ? 0.86 : 0.9;
      const upperCore = new THREE.Mesh(this.unitBox, [upperSideMat, upperSideMat, capMat, capMat, upperSideMat, upperSideMat]);
      upperCore.scale.set(1.0, upperH, 1.0);
      upperCore.position.set(0, h + upperH * 0.5, 0);
      upperCore.castShadow = true;
      upperCore.receiveShadow = true;
      const upperLedge = this.box(
        1.03,
        0.07,
        1.03,
        this.getMat(ledgeColor, { roughness: 0.88 }),
        0,
        h + upperH - 0.02,
        0,
        true,
        true
      );
      fpsUpperGroup.add(upperCore, upperLedge);
      fpsUpperGroup.visible = false;
      g.add(fpsUpperGroup);
      g.userData.fpsUpperGroup = fpsUpperGroup;
    }

    return g;
  }

  public createDoorRig(orientation: 'ns' | 'ew'): DoorRig3D {
    const root = new THREE.Group();
    if (orientation === 'ns') {
      root.rotation.y = Math.PI * 0.5;
    }

    const frameMat = this.getMat('#5c3c24', { roughness: 0.86 });
    const thresholdMat = this.getMat('#453528', { roughness: 0.94 });

    // Threshold + side jambs + lintel (clean 1.00m headroom for FPS eye-level traversal)
    root.add(this.box(0.98, 0.03, 0.24, thresholdMat, 0, 0.015, 0, false, true));
    root.add(this.box(0.11, 1.02, 0.22, frameMat, -0.44, 0.51, 0));
    root.add(this.box(0.11, 1.02, 0.22, frameMat, 0.44, 0.51, 0));
    root.add(this.box(1.0, 0.1, 0.24, frameMat, 0, 1.05, 0));

    // Hinged leaf pivoting around left jamb (-0.38)
    const hingePivot = new THREE.Group();
    hingePivot.position.set(-0.38, 0, 0);
    root.add(hingePivot);

    const doorMat = this.getMat(0xffffff, { map: this.atlas.doorTex, roughness: 0.82 });
    const doorMesh = this.box(0.76, 0.96, 0.1, doorMat, 0.38, 0.48, 0);
    hingePivot.add(doorMesh);

    const knobMat = this.getMat('#e8c458', { roughness: 0.28, metalness: 0.82 });
    hingePivot.add(this.box(0.06, 0.06, 0.14, knobMat, 0.66, 0.46, 0, false, false));

    // Padlock badge (visible only when locked)
    const padlockGroup = new THREE.Group();
    const lockMat = this.getMat('#f0c44d', { roughness: 0.3, metalness: 0.78 });
    padlockGroup.add(this.box(0.14, 0.16, 0.14, lockMat, 0.38, 0.48, 0));
    padlockGroup.visible = false;
    hingePivot.add(padlockGroup);

    // Crossed barricade planks (visible only when barricaded)
    const barricadeGroup = new THREE.Group();
    const plankMat = this.getMat('#9c6e46', { roughness: 0.88 });
    const p1 = this.box(0.94, 0.11, 0.06, plankMat, 0, 0.5, 0.14);
    p1.rotation.z = 0.28;
    const p2 = this.box(0.94, 0.11, 0.06, plankMat, 0, 0.5, -0.14);
    p2.rotation.z = -0.28;
    const p3 = this.box(0.94, 0.11, 0.06, plankMat, 0, 0.76, 0.14);
    p3.rotation.z = -0.18;
    barricadeGroup.add(p1, p2, p3);
    barricadeGroup.visible = false;
    root.add(barricadeGroup);

    // Upper doorframe wall fill shown only in FPS mode so full-height walls don't leave a gap above doors
    const fpsLintelGroup = new THREE.Group();
    const lintelTex = this.atlas.wallSideTextures.get('wall_brick_0')!;
    const lintelWallMat = this.getMat(0xffffff, { map: lintelTex, roughness: 0.9 });
    fpsLintelGroup.add(
      this.box(1.0, 0.84, 0.98, lintelWallMat, 0, 1.5, 0),
      this.box(1.02, 0.08, 0.3, frameMat, 0, 1.07, 0)
    );
    fpsLintelGroup.visible = false;
    root.add(fpsLintelGroup);

    return { root, hingePivot, doorMesh, padlockGroup, barricadeGroup, fpsLintelGroup };
  }

  public createLootContainerRig(
    kind: 'crate_wood' | 'crate_military' | 'fridge' | 'med_cabinet'
  ): LootContainerRig3D {
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    const lidPivot = new THREE.Group();
    root.add(bodyGroup);
    root.add(lidPivot);

    // Sculpted crystal diamond glint indicator for unsearched containers
    const glintMesh = new THREE.Mesh(
      this.glintDiamondGeo,
      this.getMat('#f5d578', { emissive: '#f5d578', emissiveIntensity: 1.0, roughness: 0.25, metalness: 0.3 })
    );
    glintMesh.position.set(0, 1.1, 0);
    glintMesh.castShadow = false;
    glintMesh.receiveShadow = false;
    glintMesh.visible = false;
    root.add(glintMesh);

    if (kind === 'crate_wood' || kind === 'crate_military') {
      const mil = kind === 'crate_military';
      const sideMat = this.getMat(0xffffff, {
        map: mil ? this.atlas.crateSideTex.military : this.atlas.crateSideTex.wood,
        roughness: mil ? 0.68 : 0.86,
      });
      const topMat = this.getMat(0xffffff, {
        map: mil ? this.atlas.crateTopTex.military : this.atlas.crateTopTex.wood,
        roughness: mil ? 0.68 : 0.86,
      });
      const trimMat = this.getMat(mil ? '#2d3624' : '#3a2515', { roughness: 0.85 });
      const steelMat = this.getMat('#5a6269', { roughness: 0.36, metalness: 0.72 });
      const darkIn = this.getMat('#15181b', { roughness: 0.95 });

      this.addContactShadow(root, 0.94, 0.94);

      // Base skid runners + recessed crate body + corner reinforced pillars
      bodyGroup.add(this.box(0.76, 0.05, 0.14, trimMat, 0, 0.025, -0.26));
      bodyGroup.add(this.box(0.76, 0.05, 0.14, trimMat, 0, 0.025, 0.26));
      bodyGroup.add(this.box(0.74, 0.08, 0.74, darkIn, 0, 0.08, 0));
      bodyGroup.add(this.box(0.74, 0.50, 0.075, sideMat, 0, 0.30, 0.332));
      bodyGroup.add(this.box(0.74, 0.50, 0.075, sideMat, 0, 0.30, -0.332));
      bodyGroup.add(this.box(0.075, 0.50, 0.59, sideMat, -0.332, 0.30, 0));
      bodyGroup.add(this.box(0.075, 0.50, 0.59, sideMat, 0.332, 0.30, 0));
      for (const [cx, cz] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]] as const) {
        bodyGroup.add(this.box(0.08, 0.52, 0.08, mil ? steelMat : trimMat, cx, 0.30, cz));
      }

      // Detailed interior loot visible when lid opens
      bodyGroup.add(
        this.taperedMesh(0.20, 0.22, 0.24, 0.25, 0.16, this.getMat(mil ? '#d4b34a' : '#739954', { roughness: 0.62 }), -0.12, 0.12, 0.08),
        this.box(0.18, 0.14, 0.20, this.getMat(mil ? '#b83c30' : '#c98842', { roughness: 0.58 }), 0.14, 0.19, -0.09),
        this.cylX(0.045, 0.18, this.getMat(mil ? '#e0bd5e' : '#58a0cf', { roughness: 0.35, metalness: 0.5 }), 0.06, 0.16, 0.16)
      );

      // Hinged beveled lid along back (-Z) edge + rear hinges + front brass clasp
      lidPivot.position.set(0, 0.56, -0.38);
      lidPivot.add(this.taperedMesh(0.72, 0.72, 0.80, 0.80, 0.075, topMat, 0, 0, 0.38));
      lidPivot.add(this.box(0.14, 0.04, 0.06, steelMat, -0.22, 0.01, 0.01, false, false));
      lidPivot.add(this.box(0.14, 0.04, 0.06, steelMat, 0.22, 0.01, 0.01, false, false));
      lidPivot.add(
        this.box(0.13, 0.10, 0.055, this.getMat('#e6be4c', { roughness: 0.26, metalness: 0.85 }), 0, -0.01, 0.78, false, false)
      );
      glintMesh.position.y = 0.88;
    } else if (kind === 'fridge') {
      const bodyMat = this.getMat('#dce3df', { roughness: 0.38, metalness: 0.16 });
      const sideMat = this.getMat('#b2bdb8', { roughness: 0.45, metalness: 0.16 });
      const doorFrontMat = this.getMat(0xffffff, { map: this.atlas.fridgeFrontTex, roughness: 0.38, metalness: 0.15 });
      const interiorMat = this.getMat('#2a4554', { emissive: '#417791', emissiveIntensity: 0.45, roughness: 0.55 });
      const chromeMat = this.getMat('#cfd8dd', { roughness: 0.2, metalness: 0.88 });

      this.addContactShadow(root, 0.84, 0.80);

      // Insulated cabinet shell + tapered beveled top crown + vented plinth
      bodyGroup.add(this.box(0.64, 1.04, 0.11, sideMat, 0, 0.52, -0.24));
      bodyGroup.add(this.box(0.075, 1.04, 0.50, sideMat, -0.282, 0.52, 0.015));
      bodyGroup.add(this.box(0.075, 1.04, 0.50, sideMat, 0.282, 0.52, 0.015));
      bodyGroup.add(this.taperedMesh(0.58, 0.52, 0.64, 0.58, 0.07, bodyMat, 0, 1.03, 0));
      bodyGroup.add(this.box(0.64, 0.10, 0.58, this.getMat('#282e32', { roughness: 0.72 }), 0, 0.05, 0));
      bodyGroup.add(this.box(0.49, 0.88, 0.05, interiorMat, 0, 0.54, -0.16, false, false));

      // Interior cold wire shelves + bottles & ration cans
      bodyGroup.add(this.box(0.49, 0.035, 0.36, this.getMat('#7898a6', { roughness: 0.35 }), 0, 0.46, 0));
      bodyGroup.add(this.box(0.49, 0.035, 0.36, this.getMat('#7898a6', { roughness: 0.35 }), 0, 0.74, 0));
      bodyGroup.add(this.taperedMesh(0.06, 0.06, 0.10, 0.10, 0.19, this.getMat('#58a6d1', { roughness: 0.22 }), -0.11, 0.48, 0.02));
      bodyGroup.add(this.box(0.11, 0.14, 0.11, this.getMat('#d9963b', { roughness: 0.4 }), 0.12, 0.28, 0.04));
      bodyGroup.add(this.box(0.14, 0.09, 0.14, this.getMat('#c4493b', { roughness: 0.5 }), -0.08, 0.79, 0.02));

      // Swinging sculpted insulated door pivoted on right edge (+0.3, +0.27)
      lidPivot.position.set(0.3, 0, 0.27);
      lidPivot.add(
        this.box(
          0.62,
          0.98,
          0.07,
          [sideMat, sideMat, bodyMat, sideMat, doorFrontMat, sideMat],
          -0.3,
          0.53,
          0.02
        )
      );
      lidPivot.add(this.box(0.036, 0.22, 0.042, chromeMat, -0.50, 0.83, 0.068));
      lidPivot.add(this.box(0.036, 0.28, 0.042, chromeMat, -0.50, 0.43, 0.068));
      glintMesh.position.y = 1.26;
    } else {
      // Medical cabinet with beveled crown & detailed stocked shelves
      const cabMat = this.getMat('#e4ebe8', { roughness: 0.42, metalness: 0.12 });
      const shadeMat = this.getMat('#bcc7c2', { roughness: 0.48 });
      const frontMat = this.getMat(0xffffff, { map: this.atlas.medCabFrontTex, roughness: 0.4, metalness: 0.12 });
      const latchMat = this.getMat('#cfd8dd', { roughness: 0.22, metalness: 0.88 });

      this.addContactShadow(root, 0.74, 0.66);

      bodyGroup.add(this.box(0.54, 0.90, 0.10, shadeMat, 0, 0.45, -0.18));
      bodyGroup.add(this.box(0.07, 0.90, 0.42, shadeMat, -0.235, 0.45, 0.02));
      bodyGroup.add(this.box(0.07, 0.90, 0.42, shadeMat, 0.235, 0.45, 0.02));
      bodyGroup.add(this.taperedMesh(0.48, 0.40, 0.56, 0.48, 0.07, cabMat, 0, 0.88, 0));
      bodyGroup.add(this.box(0.54, 0.08, 0.46, shadeMat, 0, 0.04, 0));
      bodyGroup.add(this.box(0.39, 0.035, 0.30, this.getMat('#8d9994', { roughness: 0.35 }), 0, 0.48, 0));
      bodyGroup.add(this.box(0.39, 0.035, 0.30, this.getMat('#8d9994', { roughness: 0.35 }), 0, 0.24, 0));
      // Bandage boxes & medicine vials inside
      bodyGroup.add(this.box(0.14, 0.13, 0.11, this.getMat('#ebe6da'), -0.08, 0.56, 0.02));
      bodyGroup.add(this.taperedMesh(0.05, 0.05, 0.08, 0.08, 0.15, this.getMat('#d9483b', { roughness: 0.25 }), 0.11, 0.50, 0.03));
      bodyGroup.add(this.box(0.16, 0.10, 0.12, this.getMat('#3c78a8', { roughness: 0.4 }), 0.04, 0.30, 0.02));

      lidPivot.position.set(0.25, 0, 0.22);
      lidPivot.add(
        this.box(
          0.52,
          0.86,
          0.06,
          [shadeMat, shadeMat, cabMat, shadeMat, frontMat, shadeMat],
          -0.25,
          0.46,
          0.02
        )
      );
      lidPivot.add(this.box(0.03, 0.16, 0.035, latchMat, -0.44, 0.46, 0.055));
      glintMesh.position.y = 1.14;
    }

    return { root, lidPivot, bodyGroup, glintMesh };
  }

  public createLootDropGroup(primaryItem?: ItemId | null): THREE.Group {
    const g = new THREE.Group();
    this.addContactShadow(g, 0.66, 0.52);
    const packMat = this.getMat(0xffffff, { map: this.atlas.backpackTex, roughness: 0.86 });
    const pocketMat = this.getMat('#54422f', { roughness: 0.9 });
    const tarpMat = this.getMat('#768056', { roughness: 0.88 });
    const strapMat = this.getMat('#26201a', { roughness: 0.9 });
    const buckleMat = this.getMat('#f0c44d', { roughness: 0.25, metalness: 0.85, emissive: '#f0c44d', emissiveIntensity: 0.42 });

    // Sculpted tapered ALICE field pack + front bellows pocket + top sleeping roll
    const pack = this.taperedMesh(0.36, 0.24, 0.44, 0.32, 0.23, packMat, 0, 0.01, 0, false, false, true);
    pack.rotation.x = -0.14;
    g.add(pack);
    g.add(this.taperedMesh(0.26, 0.10, 0.30, 0.12, 0.14, pocketMat, 0, 0.04, 0.16, false, false, true));
    g.add(this.box(0.08, 0.14, 0.11, pocketMat, -0.23, 0.11, 0.02, false, true));
    g.add(this.box(0.08, 0.14, 0.11, pocketMat, 0.23, 0.11, 0.02, false, true));
    g.add(this.cylX(0.068, 0.40, tarpMat, 0, 0.26, -0.09, false, true));
    g.add(this.box(0.04, 0.18, 0.025, strapMat, -0.10, 0.14, 0.21, false, false));
    g.add(this.box(0.04, 0.18, 0.025, strapMat, 0.10, 0.14, 0.21, false, false));
    g.add(this.box(0.055, 0.045, 0.032, buckleMat, -0.10, 0.15, 0.22, false, false));
    g.add(this.box(0.055, 0.045, 0.032, buckleMat, 0.10, 0.15, 0.22, false, false));

    if (primaryItem && this.atlas.itemDropTex[primaryItem]) {
      const spriteMat = new THREE.SpriteMaterial({
        map: this.atlas.itemDropTex[primaryItem],
        transparent: true,
        alphaTest: 0.1,
      });
      this.materials.push(spriteMat);
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(0, 0.56, 0);
      sprite.scale.set(0.48, 0.48, 1);
      g.add(sprite);
      g.userData.itemSprite = sprite;
    }
    return g;
  }

  public createPropGroup(kind: PropKind): THREE.Group {
    const g = new THREE.Group();

    if (kind === 'tree_pine') {
      this.addContactShadow(g, 1.42, 1.42);
      const barkMat = this.getMat(0xffffff, { map: this.atlas.barkTex, roughness: 0.92 });
      const leafMat = this.getMat(0xffffff, { map: this.atlas.pineTex, roughness: 0.84 });
      const leafDark = this.getMat('#20421e', { roughness: 0.9 });

      // Sculpted tapered bark trunk + flared root buttresses (all single-material for static chunk batching)
      const trunk = new THREE.Mesh(this.pineTrunkGeo, barkMat);
      trunk.position.set(0, 0.56, 0);
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      g.add(trunk);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.3;
        const rootSpur = this.taperedMesh(0.05, 0.08, 0.10, 0.22, 0.24, barkMat, Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
        rootSpur.rotation.y = -a + Math.PI * 0.5;
        g.add(rootSpur);
      }

      // Layered sculpted conical spruce bough tiers (inner dark skirt + textured outer cone + spire)
      const tiers: Array<[number, number, number, number]> = [
        [1.06, 1.38, 0.54, 0.15],
        [1.38, 1.12, 0.50, 0.55],
        [1.68, 0.84, 0.46, 0.95],
        [1.94, 0.56, 0.42, 1.35],
      ];
      for (const [ty, diam, h, rotY] of tiers) {
        const skirt = new THREE.Mesh(this.pineConeGeo, leafDark);
        skirt.scale.set(diam * 1.04, h * 0.85, diam * 1.04);
        skirt.position.set(0, ty - 0.05, 0);
        skirt.rotation.y = rotY + 0.45;
        skirt.castShadow = true;
        skirt.receiveShadow = true;

        const bough = new THREE.Mesh(this.pineConeGeo, leafMat);
        bough.scale.set(diam, h, diam);
        bough.position.set(0, ty, 0);
        bough.rotation.y = rotY;
        bough.castShadow = true;
        bough.receiveShadow = true;
        g.add(skirt, bough);
      }
      const spire = new THREE.Mesh(this.pineConeGeo, leafMat);
      spire.scale.set(0.28, 0.38, 0.28);
      spire.position.set(0, 2.20, 0);
      spire.castShadow = true;
      spire.receiveShadow = true;
      g.add(spire);
      return g;
    }

    if (kind === 'tree_dead') {
      this.addContactShadow(g, 1.02, 1.02);
      const barkMat = this.getMat(0xffffff, { map: this.atlas.barkTex, roughness: 0.94 });
      const darkBark = this.getMat('#4a301d', { roughness: 0.94 });

      const trunk = new THREE.Mesh(this.deadTrunkGeo, barkMat);
      trunk.position.set(0, 0.57, 0);
      trunk.rotation.z = 0.04;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      g.add(trunk);

      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const root = this.taperedMesh(0.05, 0.08, 0.11, 0.24, 0.22, darkBark, Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
        root.rotation.y = -a + Math.PI * 0.5;
        g.add(root);
      }

      // Connected hierarchical forked limbs & secondary twigs anchored at trunk crown (-0.04, 1.06, 0)
      const addLimb = (
        px: number,
        py: number,
        pz: number,
        len: number,
        thick: number,
        rx: number,
        rz: number,
        twigs: Array<{ frac: number; len: number; thick: number; rx: number; rz: number }>
      ) => {
        const limb = new THREE.Mesh(this.branchCylGeo, barkMat);
        limb.scale.set(thick, len, thick);
        limb.position.set(px, py, pz);
        limb.rotation.set(rx, 0, rz);
        limb.castShadow = true;
        limb.receiveShadow = true;
        g.add(limb);

        for (const tw of twigs) {
          const tMesh = new THREE.Mesh(this.branchCylGeo, darkBark);
          // Attach in local limb space (divide scale back out so twig has clean proportions)
          tMesh.scale.set(tw.thick / thick, tw.len / len, tw.thick / thick);
          tMesh.position.set(0, tw.frac, 0);
          tMesh.rotation.set(tw.rx, 0, tw.rz);
          tMesh.castShadow = true;
          tMesh.receiveShadow = true;
          limb.add(tMesh);
        }
      };

      addLimb(-0.04, 1.04, 0.01, 0.62, 0.98, 0.14, 0.72, [
        { frac: 0.62, len: 0.36, thick: 0.52, rx: -0.22, rz: -0.52 },
        { frac: 0.78, len: 0.26, thick: 0.40, rx: 0.25, rz: 0.42 },
      ]);
      addLimb(-0.03, 1.06, -0.01, 0.58, 0.90, -0.15, -0.66, [
        { frac: 0.58, len: 0.34, thick: 0.48, rx: 0.24, rz: 0.48 },
      ]);
      addLimb(-0.02, 1.08, 0.02, 0.48, 0.74, 0.58, -0.16, [
        { frac: 0.65, len: 0.25, thick: 0.38, rx: -0.35, rz: 0.38 },
      ]);
      return g;
    }

    if (kind === 'streetlamp') {
      this.addContactShadow(g, 0.62, 0.62);
      const ironMat = this.getMat('#2c3238', { roughness: 0.42, metalness: 0.72 });
      const poleMat = this.getMat('#4a535e', { roughness: 0.38, metalness: 0.76 });
      const bulbMat = this.getMat('#ffe999', { emissive: '#f5c258', emissiveIntensity: 1.5, roughness: 0.2 });
      g.add(this.box(0.34, 0.18, 0.34, ironMat, 0, 0.09, 0));
      g.add(this.box(0.2, 0.24, 0.2, ironMat, 0, 0.28, 0));
      g.add(this.box(0.11, 1.58, 0.11, poleMat, 0, 1.15, 0));
      g.add(this.box(0.5, 0.09, 0.11, poleMat, 0.22, 1.9, 0));
      g.add(this.box(0.28, 0.09, 0.22, ironMat, 0.42, 1.84, 0));
      g.add(this.box(0.18, 0.1, 0.16, bulbMat, 0.42, 1.75, 0, false, false));
      return g;
    }

    if (kind === 'barrel_burn') {
      this.addContactShadow(g, 0.78, 0.78);
      const barrelMat = this.getMat(0xffffff, { map: this.atlas.barrelTex, roughness: 0.65, metalness: 0.52 });
      const rim = this.getMat('#25282b', { roughness: 0.45, metalness: 0.75 });
      const ember = this.getMat('#e85d1a', { emissive: '#ff7b29', emissiveIntensity: 1.4, roughness: 0.7 });
      g.add(this.box(0.52, 0.72, 0.52, barrelMat, 0, 0.36, 0));
      g.add(this.box(0.55, 0.06, 0.55, rim, 0, 0.04, 0));
      g.add(this.box(0.55, 0.06, 0.55, rim, 0, 0.38, 0));
      g.add(this.box(0.55, 0.06, 0.55, rim, 0, 0.7, 0));
      g.add(this.box(0.4, 0.05, 0.4, ember, 0, 0.72, 0, false, false));

      const flameGroup = new THREE.Group();
      flameGroup.position.set(0, 0.74, 0);
      flameGroup.add(
        this.box(0.24, 0.26, 0.24, this.getMat('#f79520', { emissive: '#f79520', emissiveIntensity: 1.6 }), 0, 0.13, 0, false, false),
        this.box(0.14, 0.38, 0.14, this.getMat('#fff1a8', { emissive: '#fff1a8', emissiveIntensity: 1.8 }), 0.02, 0.19, -0.02, false, false),
        this.box(0.12, 0.22, 0.12, this.getMat('#d64527', { emissive: '#d64527', emissiveIntensity: 1.4 }), -0.06, 0.16, 0.05, false, false)
      );
      g.add(flameGroup);
      g.userData.flameGroup = flameGroup;
      return g;
    }

    if (kind === 'dumpster') {
      this.addContactShadow(g, 1.08, 0.78);
      const sideMat = this.getMat(0xffffff, { map: this.atlas.dumpsterTex, roughness: 0.58, metalness: 0.45 });
      const lidMat = this.getMat('#1b2022', { roughness: 0.75 });
      g.add(this.box(0.92, 0.62, 0.62, sideMat, 0, 0.31, 0));
      g.add(this.box(0.96, 0.08, 0.66, this.getMat('#222825', { roughness: 0.6 }), 0, 0.62, 0));
      g.add(this.box(0.46, 0.06, 0.6, lidMat, -0.22, 0.68, 0));
      g.add(this.box(0.44, 0.06, 0.6, this.getMat('#35453b', { roughness: 0.65 }), 0.24, 0.67, 0));
      return g;
    }

    if (kind === 'concrete_barrier') {
      this.addContactShadow(g, 1.05, 0.56);
      const mat = this.getMat(0xffffff, { map: this.atlas.barrierTex, roughness: 0.92 });
      const base = this.getMat('#877f70', { roughness: 0.94 });
      g.add(this.box(0.94, 0.18, 0.44, base, 0, 0.09, 0));
      g.add(this.box(0.94, 0.34, 0.28, mat, 0, 0.35, 0));
      return g;
    }

    if (kind === 'counter') {
      this.addContactShadow(g, 1.02, 0.7);
      const top = this.getMat(0xffffff, { map: this.atlas.woodOakTex, roughness: 0.78 });
      const body = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.86 });
      g.add(this.box(0.9, 0.48, 0.56, body, 0, 0.24, 0));
      g.add(this.box(0.96, 0.1, 0.64, top, 0, 0.52, 0));
      return g;
    }

    if (kind === 'bench') {
      this.addContactShadow(g, 1.02, 0.58);
      const wood = this.getMat(0xffffff, { map: this.atlas.woodOakTex, roughness: 0.86 });
      const dark = this.getMat('#3d2a1d', { roughness: 0.9 });
      g.add(this.box(0.1, 0.28, 0.42, dark, -0.34, 0.14, 0));
      g.add(this.box(0.1, 0.28, 0.42, dark, 0.34, 0.14, 0));
      g.add(this.box(0.9, 0.08, 0.44, wood, 0, 0.3, 0.02));
      g.add(this.box(0.9, 0.24, 0.08, wood, 0, 0.46, -0.18));
      return g;
    }

    if (kind === 'hydrant') {
      this.addContactShadow(g, 0.48, 0.48);
      const red = this.getMat('#c2362b', { roughness: 0.42, metalness: 0.35 });
      const hi = this.getMat('#db493d', { roughness: 0.4, metalness: 0.35 });
      const silver = this.getMat('#c7c7c7', { roughness: 0.28, metalness: 0.8 });
      g.add(this.box(0.32, 0.1, 0.32, red, 0, 0.05, 0));
      g.add(this.box(0.24, 0.42, 0.24, red, 0, 0.3, 0));
      g.add(this.box(0.28, 0.1, 0.28, hi, 0, 0.54, 0));
      g.add(this.box(0.4, 0.09, 0.09, silver, 0, 0.36, 0));
      return g;
    }

    if (kind === 'stove') {
      this.addContactShadow(g, 0.84, 0.82);
      const steel = this.getMat('#888f96', { roughness: 0.38, metalness: 0.65 });
      const frontMat = this.getMat(0xffffff, { map: this.atlas.stoveTex.front, roughness: 0.4, metalness: 0.55 });
      const topMat = this.getMat(0xffffff, { map: this.atlas.stoveTex.top, roughness: 0.45, metalness: 0.4 });
      const burner = this.getMat('#e66c2c', { emissive: '#ff6e24', emissiveIntensity: 1.4, roughness: 0.4 });

      g.add(this.box(0.68, 0.62, 0.66, [steel, steel, topMat, steel, frontMat, steel], 0, 0.31, 0));
      g.add(this.box(0.14, 0.03, 0.14, burner, -0.15, 0.635, 0.12, false, false));
      g.add(this.box(0.14, 0.03, 0.14, burner, 0.15, 0.635, -0.12, false, false));
      g.add(this.box(0.58, 0.16, 0.44, this.getMat('#7a838c', { roughness: 0.35, metalness: 0.7 }), 0, 0.96, -0.06));
      return g;
    }

    if (kind === 'fishing_post') {
      this.addContactShadow(g, 0.46, 0.46);
      const wood = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.9 });
      const iron = this.getMat('#3d4247', { roughness: 0.4, metalness: 0.8 });
      const lantern = this.getMat('#f5c258', { emissive: '#ffcf5c', emissiveIntensity: 1.5, roughness: 0.25 });
      g.add(this.box(0.22, 0.88, 0.22, wood, 0, 0.44, 0));
      g.add(this.box(0.24, 0.06, 0.08, iron, 0.14, 0.82, 0));
      g.add(this.box(0.12, 0.16, 0.12, lantern, 0.24, 0.71, 0, false, false));
      return g;
    }

    if (kind === 'bed') {
      this.addContactShadow(g, 1.0, 0.8);
      const wood = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.85 });
      const quilt = this.getMat(0xffffff, { map: this.atlas.quiltTex, roughness: 0.9 });
      const sheet = this.getMat('#ede7da', { roughness: 0.88 });
      g.add(
        this.box(0.1, 0.16, 0.1, wood, -0.38, 0.08, -0.26),
        this.box(0.1, 0.16, 0.1, wood, 0.38, 0.08, -0.26),
        this.box(0.1, 0.16, 0.1, wood, -0.38, 0.08, 0.26),
        this.box(0.1, 0.16, 0.1, wood, 0.38, 0.08, 0.26)
      );
      g.add(this.box(0.86, 0.18, 0.64, sheet, 0, 0.24, 0));
      g.add(this.box(0.58, 0.19, 0.66, quilt, 0.14, 0.245, 0));
      g.add(this.box(0.16, 0.09, 0.44, this.getMat('#f2ede2', { roughness: 0.9 }), -0.26, 0.36, 0));
      g.add(this.box(0.1, 0.62, 0.68, wood, -0.4, 0.42, 0));
      g.add(this.box(0.1, 0.38, 0.68, wood, 0.4, 0.3, 0));
      return g;
    }

    if (kind === 'couch') {
      this.addContactShadow(g, 1.02, 0.72);
      const seatMat = this.getMat(0xffffff, { map: this.atlas.couchTex, roughness: 0.84 });
      const dark = this.getMat('#5c402e', { roughness: 0.88 });
      g.add(this.box(0.88, 0.26, 0.56, seatMat, 0, 0.14, 0.04));
      g.add(this.box(0.88, 0.36, 0.14, seatMat, 0, 0.36, -0.22));
      g.add(this.box(0.12, 0.22, 0.58, dark, -0.38, 0.28, 0.02));
      g.add(this.box(0.12, 0.22, 0.58, dark, 0.38, 0.28, 0.02));
      return g;
    }

    if (kind === 'table') {
      this.addContactShadow(g, 0.94, 0.78);
      const wood = this.getMat(0xffffff, { map: this.atlas.woodOakTex, roughness: 0.82 });
      const leg = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.88 });
      for (const lx of [-0.32, 0.32]) {
        for (const lz of [-0.26, 0.26]) {
          g.add(this.box(0.08, 0.38, 0.08, leg, lx, 0.19, lz));
        }
      }
      g.add(this.box(0.8, 0.1, 0.66, wood, 0, 0.42, 0));
      g.add(this.box(0.22, 0.03, 0.22, this.getMat('#d6d2c7', { roughness: 0.4 }), 0.14, 0.48, 0.1, false, true));
      g.add(this.box(0.1, 0.12, 0.1, this.getMat('#d15a3f', { roughness: 0.5 }), -0.16, 0.52, -0.08));
      return g;
    }

    if (kind === 'bookshelf') {
      this.addContactShadow(g, 0.96, 0.52);
      const frontMat = this.getMat(0xffffff, { map: this.atlas.bookshelfFrontTex, roughness: 0.86 });
      const wood = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.88 });
      const shelf = new THREE.Mesh(this.unitBox, [wood, wood, wood, wood, frontMat, wood]);
      shelf.scale.set(0.86, 1.05, 0.4);
      shelf.position.set(0, 0.525, 0);
      shelf.castShadow = true;
      shelf.receiveShadow = true;
      g.add(shelf);
      g.add(this.box(0.9, 0.06, 0.44, this.getMat(0xffffff, { map: this.atlas.woodOakTex, roughness: 0.85 }), 0, 1.06, 0));
      return g;
    }

    if (kind === 'desk') {
      this.addContactShadow(g, 1.0, 0.68);
      const top = this.getMat(0xffffff, { map: this.atlas.woodOakTex, roughness: 0.8 });
      const side = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.86 });
      g.add(this.box(0.24, 0.38, 0.5, side, -0.28, 0.19, 0));
      g.add(this.box(0.24, 0.38, 0.5, side, 0.28, 0.19, 0));
      g.add(this.box(0.88, 0.1, 0.56, top, 0, 0.43, 0));
      g.add(this.box(0.42, 0.02, 0.28, this.getMat('#34473a', { roughness: 0.9 }), 0, 0.49, 0.02, false, true));
      g.add(this.box(0.22, 0.22, 0.18, this.getMat('#3d4347', { roughness: 0.5, metalness: 0.5 }), -0.22, 0.59, -0.06));
      g.add(this.box(0.1, 0.06, 0.02, this.getMat('#6ee09e', { emissive: '#6ee09e', emissiveIntensity: 1.2 }), -0.22, 0.6, 0.035, false, false));
      return g;
    }

    if (kind === 'sink_toilet') {
      this.addContactShadow(g, 0.68, 0.64);
      const porc = this.getMat('#e6ecee', { roughness: 0.28, metalness: 0.1 });
      const water = this.getMat('#587b87', { roughness: 0.15, metalness: 0.2 });
      const mirror = this.getMat('#8eb4c2', { roughness: 0.1, metalness: 0.75 });
      g.add(this.box(0.54, 0.48, 0.5, porc, 0, 0.24, 0));
      g.add(this.box(0.32, 0.04, 0.28, water, 0, 0.49, 0.02, false, true));
      g.add(this.box(0.06, 0.14, 0.06, this.getMat('#b5c0c4', { roughness: 0.2, metalness: 0.85 }), 0, 0.55, -0.18));
      g.add(this.box(0.42, 0.34, 0.06, mirror, 0, 0.78, -0.22));
      return g;
    }

    if (kind === 'tv_stand') {
      this.addContactShadow(g, 0.88, 0.54);
      const cabSide = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.82 });
      const cabFront = this.getMat(0xffffff, { map: this.atlas.tvTex.cabinet, roughness: 0.82 });
      const caseMat = this.getMat('#303438', { roughness: 0.55, metalness: 0.3 });
      const screenFront = this.getMat(0xffffff, {
        map: this.atlas.tvTex.screen,
        emissive: '#3d515c',
        emissiveIntensity: 0.55,
        roughness: 0.25,
      });
      const antMat = this.getMat('#c4ccd1', { roughness: 0.25, metalness: 0.85 });
      g.add(this.box(0.76, 0.36, 0.42, [cabSide, cabSide, cabSide, cabSide, cabFront, cabSide], 0, 0.18, 0));
      g.add(this.box(0.5, 0.4, 0.34, [caseMat, caseMat, caseMat, caseMat, screenFront, caseMat], 0, 0.56, 0));
      const a1 = this.box(0.03, 0.24, 0.03, antMat, -0.08, 0.86, 0);
      a1.rotation.z = 0.45;
      const a2 = this.box(0.03, 0.24, 0.03, antMat, 0.08, 0.86, 0);
      a2.rotation.z = -0.45;
      g.add(a1, a2);
      return g;
    }

    if (kind === 'tent') {
      this.addContactShadow(g, 1.14, 1.12);
      const canvasMat = this.getMat(0xffffff, { map: this.atlas.tentTex, roughness: 0.9 });
      const darkCanvas = this.getMat('#36402a', { roughness: 0.94 });
      const doorVoid = this.getMat('#141612', { roughness: 0.96 });
      const stakeMat = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.88 });

      // True pitched A-frame extruded tent prism + ridge pole + recessed vestibule + guy stakes (all single-material)
      const body = new THREE.Mesh(this.tentBodyGeo, canvasMat);
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);

      const ridge = this.cylX(0.032, 0.98, stakeMat, 0, 0.86, 0);
      ridge.rotation.y = Math.PI * 0.5;
      g.add(ridge);

      // Recessed dark tent vestibule opening + rolled canvas flaps
      g.add(this.taperedMesh(0.06, 0.06, 0.36, 0.08, 0.52, doorVoid, 0, 0, 0.425, false, false, false));
      const flapL = this.cylX(0.045, 0.54, darkCanvas, -0.16, 0.24, 0.44);
      flapL.rotation.y = Math.PI * 0.5;
      flapL.rotation.x = 0.32;
      const flapR = this.cylX(0.045, 0.54, darkCanvas, 0.16, 0.24, 0.44);
      flapR.rotation.y = Math.PI * 0.5;
      flapR.rotation.x = 0.32;
      g.add(flapL, flapR);

      // 4 angled corner guy stakes
      for (const [sx, sz, rz] of [[-0.47, -0.43, -0.3], [0.47, -0.43, 0.3], [-0.47, 0.43, -0.3], [0.47, 0.43, 0.3]] as const) {
        const st = this.box(0.045, 0.16, 0.045, stakeMat, sx, 0.07, sz);
        st.rotation.z = rz;
        g.add(st);
      }
      return g;
    }

    if (kind === 'rock_boulder') {
      this.addContactShadow(g, 0.98, 0.98);
      const rockMat = this.getMat(0xffffff, { map: this.atlas.rockTex, roughness: 0.92 });
      const darkRock = this.getMat('#454b4f', { roughness: 0.96 });

      const main = new THREE.Mesh(this.boulderMainGeo, rockMat);
      main.position.set(-0.04, 0, 0.02);
      main.rotation.y = 0.45;
      main.castShadow = true;
      main.receiveShadow = true;

      const side = new THREE.Mesh(this.boulderSideGeo, darkRock);
      side.position.set(0.24, 0, -0.14);
      side.rotation.y = 1.6;
      side.castShadow = true;
      side.receiveShadow = true;

      const top = new THREE.Mesh(this.boulderTopGeo, rockMat);
      top.position.set(-0.06, 0.24, -0.02);
      top.rotation.y = 2.3;
      top.castShadow = true;
      top.receiveShadow = true;

      const scree = new THREE.Mesh(this.boulderSideGeo, darkRock);
      scree.scale.setScalar(0.55);
      scree.position.set(-0.24, 0, 0.22);
      scree.rotation.y = 0.9;
      scree.castShadow = true;
      scree.receiveShadow = true;
      g.add(main, side, top, scree);
      return g;
    }

    if (kind === 'fallen_log') {
      this.addContactShadow(g, 1.08, 0.64);
      const barkMat = this.getMat(0xffffff, { map: this.atlas.barkTex, roughness: 0.94 });
      const endMat = this.getMat(0xffffff, { map: this.atlas.treeRingTex, roughness: 0.88 });
      const mossMat = this.getMat('#3f5932', { roughness: 0.94 });

      // Single-material cylindrical bark trunk + separate heartwood end-cap discs (static batching safe)
      const trunk = new THREE.Mesh(this.logCylGeo, barkMat);
      trunk.position.set(0, 0.165, 0);
      trunk.castShadow = true;
      trunk.receiveShadow = true;

      const capL = new THREE.Mesh(this.logCapGeo, endMat);
      capL.scale.set(1, 0.95, 0.95);
      capL.position.set(-0.455, 0.165, 0);
      const capR = new THREE.Mesh(this.logCapGeo, endMat);
      capR.scale.set(1, 1.08, 1.08);
      capR.position.set(0.455, 0.165, 0);

      // Draped moss strip + snapped branch stubs rooted inside log body
      const moss = this.taperedMesh(0.44, 0.16, 0.56, 0.24, 0.05, mossMat, -0.08, 0.30, 0.01);
      const stub1 = new THREE.Mesh(this.branchCylGeo, barkMat);
      stub1.scale.set(1.2, 0.24, 1.2);
      stub1.position.set(0.16, 0.21, 0.06);
      stub1.rotation.set(0.38, 0, -0.58);
      stub1.castShadow = true;
      const stub2 = new THREE.Mesh(this.branchCylGeo, barkMat);
      stub2.scale.set(0.95, 0.20, 0.95);
      stub2.position.set(-0.22, 0.20, -0.05);
      stub2.rotation.set(-0.42, 0, 0.52);
      stub2.castShadow = true;

      g.add(trunk, capL, capR, moss, stub1, stub2);
      return g;
    }

    if (kind === 'road_sign') {
      this.addContactShadow(g, 0.42, 0.42);
      const poleMat = this.getMat('#545c63', { roughness: 0.45, metalness: 0.72 });
      const signMat = this.getMat(0xffffff, { map: this.atlas.roadSignTex, roughness: 0.52, metalness: 0.3 });
      g.add(this.box(0.24, 0.08, 0.24, poleMat, 0, 0.04, 0));
      g.add(this.box(0.08, 1.18, 0.08, poleMat, 0, 0.63, 0));
      const board = this.box(0.38, 0.38, 0.06, signMat, 0, 1.24, 0.04);
      board.rotation.z = Math.PI * 0.25;
      g.add(board);
      return g;
    }

    if (kind === 'wrecked_car') {
      this.addContactShadow(g, 1.88, 1.12);
      const hullBodyMat = this.getMat('#755c47', { roughness: 0.78, metalness: 0.38 });
      const sideDecalMat = this.getMat(0xffffff, { map: this.atlas.wreckedCarTex, roughness: 0.78, metalness: 0.35 });
      const topDecalMat = this.getMat(0xffffff, { map: this.atlas.wreckedCarTopTex, roughness: 0.78, metalness: 0.35 });
      const charMat = this.getMat('#211d1b', { roughness: 0.94, metalness: 0.25 });
      const rustMat = this.getMat('#994823', { roughness: 0.86, metalness: 0.32 });
      const tireMat = this.getMat('#101214', { roughness: 0.92 });
      const rimMat = this.getMat('#9e8470', { map: this.atlas.vehicleTex.sedan.wheel, roughness: 0.7, metalness: 0.45 });
      const glassMat = this.getMat('#1f2c36', { roughness: 0.28, metalness: 0.3 });

      g.rotation.y = 0.24;

      // Sculpted wrecked wedge supercar chassis (single-material meshes for static chunk batching)
      const hull = new THREE.Mesh(this.wreckedHullGeo, hullBodyMat);
      hull.position.set(0, -0.02, 0);
      hull.rotation.z = -0.03;
      hull.castShadow = true;
      hull.receiveShadow = true;
      g.add(hull);

      // Proud weathered supercar side door/intake panels aligned with hull tilt (zero z-clipping)
      for (const sz of [-0.402, 0.402]) {
        const sidePanel = this.box(1.18, 0.17, 0.018, sideDecalMat, -0.02, 0.21, sz);
        sidePanel.rotation.z = -0.03;
        g.add(sidePanel);
      }

      // Shattered front carbon chin splitter, rear diffuser & cracked taillight housings
      g.add(
        this.box(0.22, 0.04, 0.84, charMat, 0.72, 0.09, 0),
        this.box(0.18, 0.08, 0.82, charMat, -0.76, 0.13, 0),
        this.box(0.04, 0.045, 0.22, rustMat, -0.82, 0.29, -0.25),
        this.box(0.04, 0.045, 0.20, charMat, -0.82, 0.28, 0.25)
      );

      // Four charred low-profile supercar wheels (single-material tire + rim for static chunk batching)
      const wheelSpecs: Array<[number, number, number, number]> = [
        [-0.48, 0.14, -0.39, 0],
        [-0.48, 0.14, 0.39, 0.05],
        [0.48, 0.13, -0.39, -0.06],
        [0.48, 0.13, 0.39, 0.26],
      ];
      for (const [wx, wy, wz, tiltX] of wheelSpecs) {
        const tire = this.cylinderWheel(0.31, 0.13, tireMat, wx, wy, wz);
        tire.rotation.x += tiltX;
        const rim = this.cylinderWheel(0.20, 0.142, rimMat, wx, wy, wz, false, false);
        rim.rotation.x += tiltX;
        g.add(tire, rim);
      }

      // Crushed smoked-glass supercar canopy + dented rusted roof cap
      const canopy = new THREE.Mesh(this.wreckedCanopyGeo, glassMat);
      canopy.position.set(-0.02, -0.02, 0);
      canopy.rotation.z = -0.03;
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      g.add(canopy);
      const roofCap = this.box(0.38, 0.03, 0.56, rustMat, -0.03, 0.60, 0);
      roofCap.rotation.z = -0.06;
      g.add(roofCap);

      // Charred front bay + popped twisted hood panel
      g.add(this.box(0.24, 0.10, 0.42, charMat, 0.46, 0.27, 0));
      const hood = this.box(0.40, 0.03, 0.66, topDecalMat, 0.46, 0.36, 0);
      hood.rotation.z = 0.32;
      hood.rotation.x = 0.08;
      g.add(hood);

      // Scorched rear mid-engine deck + snapped crooked carbon GT wing
      const rearDeck = this.box(0.38, 0.03, 0.64, topDecalMat, -0.54, 0.36, 0);
      rearDeck.rotation.z = -0.06;
      g.add(rearDeck);
      const wing = this.box(0.14, 0.03, 0.80, charMat, -0.78, 0.44, 0);
      wing.rotation.z = -0.18;
      wing.rotation.x = 0.14;
      g.add(
        this.box(0.05, 0.09, 0.04, rustMat, -0.74, 0.38, -0.20),
        this.box(0.05, 0.07, 0.04, rustMat, -0.74, 0.37, 0.20),
        wing
      );
      return g;
    }

    if (kind === 'sandbag_wall') {
      this.addContactShadow(g, 1.0, 0.56);
      const bagMat = this.getMat(0xffffff, { map: this.atlas.sandbagTex, roughness: 0.94 });
      const stake = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.9 });
      g.add(this.box(0.92, 0.26, 0.46, bagMat, 0, 0.13, 0));
      g.add(this.box(0.84, 0.24, 0.36, bagMat, 0, 0.38, 0));
      g.add(this.box(0.08, 0.58, 0.08, stake, -0.38, 0.29, 0.14));
      g.add(this.box(0.08, 0.58, 0.08, stake, 0.38, 0.29, 0.14));
      return g;
    }

    return g;
  }

  public createStructureGroup(kind: StructureKind): THREE.Group {
    const g = new THREE.Group();
    if (kind === 'barricade') {
      this.addContactShadow(g, 0.98, 0.62);
      const bagMat = this.getMat(0xffffff, { map: this.atlas.sandbagTex, roughness: 0.94 });
      const wood = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.88 });
      const plank = this.getMat(0xffffff, { map: this.atlas.woodOakTex, roughness: 0.86 });
      const spike = this.getMat('#dee2e6', { roughness: 0.28, metalness: 0.85 });

      g.add(this.box(0.84, 0.3, 0.46, bagMat, 0, 0.15, 0));
      for (const px of [-0.32, 0, 0.32]) {
        g.add(this.box(0.11, 0.84, 0.11, wood, px, 0.42, 0));
        g.add(this.box(0.06, 0.14, 0.06, spike, px, 0.9, 0));
      }
      g.add(this.box(0.88, 0.13, 0.08, plank, 0, 0.48, 0.07));
      g.add(this.box(0.88, 0.13, 0.08, plank, 0, 0.72, 0.07));
      return g;
    }

    if (kind === 'spike_trap') {
      this.addContactShadow(g, 0.96, 0.96);
      const wood = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.9 });
      const steel = this.getMat('#6e7781', { roughness: 0.32, metalness: 0.8 });
      const blood = this.getMat('#b02a24', { roughness: 0.55, metalness: 0.2 });

      g.add(this.box(0.84, 0.08, 0.16, wood, 0, 0.04, -0.3));
      g.add(this.box(0.84, 0.08, 0.16, wood, 0, 0.04, 0));
      g.add(this.box(0.84, 0.08, 0.16, wood, 0, 0.04, 0.3));
      g.add(this.box(0.16, 0.08, 0.84, wood, -0.3, 0.04, 0));
      g.add(this.box(0.16, 0.08, 0.84, wood, 0, 0.04, 0));
      g.add(this.box(0.16, 0.08, 0.84, wood, 0.3, 0.04, 0));

      for (const sx of [-0.3, 0, 0.3]) {
        for (const sz of [-0.3, 0, 0.3]) {
          g.add(this.box(0.08, 0.3, 0.08, steel, sx, 0.22, sz));
          g.add(this.box(0.05, 0.12, 0.05, blood, sx, 0.4, sz));
        }
      }
      return g;
    }

    // Campfire: river-stone ring, charred ember pit, split teepee logs & multi-layered animated flame
    this.addContactShadow(g, 1.02, 1.02);
    const stoneLight = this.getMat(0xffffff, { map: this.atlas.rockTex, roughness: 0.94 });
    const stoneDark = this.getMat('#4f5559', { roughness: 0.96 });
    const logMat = this.getMat(0xffffff, { map: this.atlas.barkTex, roughness: 0.9 });
    const ashMat = this.getMat('#262220', { roughness: 0.98 });
    const emberMat = this.getMat('#ff6e1a', { emissive: '#ff6614', emissiveIntensity: 1.85, roughness: 0.65 });

    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.12;
      const r = 0.34 + (i % 3) * 0.015;
      const st = new THREE.Mesh(this.campStoneGeo, i % 2 === 0 ? stoneLight : stoneDark);
      st.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      st.rotation.y = a * 1.7;
      st.scale.set(0.95 + (i % 2) * 0.25, 0.85 + (i % 3) * 0.18, 0.95);
      st.castShadow = true;
      st.receiveShadow = true;
      g.add(st);
    }

    const ashBed = new THREE.Mesh(this.logCapGeo, ashMat);
    ashBed.rotation.z = Math.PI * 0.5;
    ashBed.scale.set(1.5, 2.0, 2.0);
    ashBed.position.set(0, 0.02, 0);
    g.add(ashBed);

    // Glowing cracked coal bed
    const coalBed = new THREE.Mesh(this.boulderTopGeo, emberMat);
    coalBed.scale.set(0.95, 0.28, 0.95);
    coalBed.position.set(0, 0.01, 0);
    g.add(coalBed);

    // Split firewood logs (2 crossed base logs + 3 angled teepee logs)
    for (const [ry, py] of [[0.58, 0.08], [-0.62, 0.10]] as const) {
      const baseLog = this.cylX(0.052, 0.54, logMat, 0, py, 0, true, true);
      baseLog.rotation.y = ry;
      g.add(baseLog);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.35;
      const tLog = this.cylX(0.044, 0.44, logMat, Math.cos(a) * 0.11, 0.15, Math.sin(a) * 0.11, true, true);
      tLog.rotation.y = -a;
      tLog.rotation.z = 0.68;
      g.add(tLog);
    }

    // Multi-layered animated flame: crossed pixel flame cards + twisting spires + white-hot core + rising embers
    const flameGroup = new THREE.Group();
    flameGroup.position.set(0, 0.10, 0);
    const flameCardMat = this.getMat(0xffffff, {
      map: this.atlas.flameTex,
      emissive: '#ffaa38',
      emissiveMap: this.atlas.flameTex,
      emissiveIntensity: 1.55,
      alphaTest: 0.18,
      transparent: true,
      side: THREE.DoubleSide,
      roughness: 0.4,
    });
    const outerSpireMat = this.getMat('#ff6a18', { emissive: '#ff5c12', emissiveIntensity: 1.75, roughness: 0.3 });
    const coreSpireMat = this.getMat('#fff6bf', { emissive: '#fff2a6', emissiveIntensity: 2.35, roughness: 0.2 });

    const tongues: THREE.Object3D[] = [];
    for (let c = 0; c < 3; c++) {
      const card = new THREE.Mesh(this.flameCardGeo, flameCardMat);
      card.scale.set(0.56, 0.76, 1);
      card.position.set(0, 0.31, 0);
      card.rotation.y = (c / 3) * Math.PI;
      flameGroup.add(card);
      tongues.push(card);
    }
    const core = new THREE.Mesh(this.flameSpireGeo, coreSpireMat);
    core.scale.set(0.18, 0.38, 0.18);
    core.position.set(0, 0.18, 0);
    flameGroup.add(core);
    tongues.push(core);

    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * Math.PI * 2;
      const spire = new THREE.Mesh(this.flameSpireGeo, outerSpireMat);
      spire.scale.set(0.15, 0.44, 0.15);
      spire.position.set(Math.cos(a) * 0.065, 0.21, Math.sin(a) * 0.065);
      spire.rotation.set(Math.sin(a) * 0.18, a, -Math.cos(a) * 0.18);
      flameGroup.add(spire);
      tongues.push(spire);
    }

    const embers: THREE.Mesh[] = [];
    const sparkMat = this.getMat('#ffe073', { emissive: '#ffb833', emissiveIntensity: 2.2 });
    for (let e = 0; e < 5; e++) {
      const spark = new THREE.Mesh(this.glintDiamondGeo, sparkMat);
      spark.scale.setScalar(0.18);
      spark.position.set(Math.cos(e * 1.4) * 0.11, 0.2 + e * 0.09, Math.sin(e * 1.9) * 0.11);
      flameGroup.add(spark);
      embers.push(spark);
    }
    flameGroup.userData.tongues = tongues;
    flameGroup.userData.embers = embers;

    g.add(flameGroup);
    g.userData.flameGroup = flameGroup;
    return g;
  }

  public createVehicleRig(kind: 'sedan' | 'police'): VehicleRig3D {
    const police = kind === 'police';
    const vTex = this.atlas.vehicleTex[kind];
    const root = new THREE.Group();
    this.addContactShadow(root, 2.15, 1.25);

    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    const sideMat = this.getPhysicalMat(0xffffff, { map: vTex.side, roughness: 0.24, metalness: 0.48, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.25 });
    const roofMat = this.getPhysicalMat(0xffffff, { map: vTex.roof, roughness: 0.22, metalness: 0.46, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.25 });
    const frontMat = this.getPhysicalMat(0xffffff, { map: vTex.front, roughness: 0.28, metalness: 0.42, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1.2 });
    const rearMat = this.getPhysicalMat(0xffffff, { map: vTex.rear, roughness: 0.30, metalness: 0.42, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 1.2 });
    const glassMat = this.getPhysicalMat(0xffffff, { map: vTex.glass, roughness: 0.08, metalness: 0.35, clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.35 });
    const carbonMat = this.getMat('#171a20', { roughness: 0.55, metalness: 0.45 });
    const tireMat = this.getMat('#101214', { roughness: 0.92 });
    const wheelFaceMat = this.getMat(0xffffff, { map: vTex.wheel, roughness: 0.36, metalness: 0.52 });
    const paintRoof = this.getPhysicalMat(police ? '#f4f8fc' : '#d92b24', { roughness: 0.24, metalness: 0.46, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.25 });
    const paintMain = this.getPhysicalMat(police ? '#1e3c72' : '#d92b24', { roughness: 0.24, metalness: 0.48, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.25 });
    const chromeMat = this.getMat('#cfd8e0', { roughness: 0.18, metalness: 0.92 });

    // Sculpted wedge supercar lower chassis [side, top/bot, front, rear]
    const hullMesh = new THREE.Mesh(this.supercarHullGeo, [sideMat, roofMat, frontMat, rearMat]);
    hullMesh.castShadow = true;
    hullMesh.receiveShadow = true;
    bodyGroup.add(hullMesh);

    // Carbon-fiber aerodynamic ground effects: chin splitter, side skirts & rear diffuser fins
    bodyGroup.add(
      this.box(0.22, 0.03, 0.90, carbonMat, 0.82, 0.12, 0),
      this.box(1.12, 0.04, 0.04, carbonMat, 0, 0.13, -0.45),
      this.box(1.12, 0.04, 0.04, carbonMat, 0, 0.13, 0.45),
      this.box(0.14, 0.05, 0.82, carbonMat, -0.84, 0.13, 0)
    );
    for (const fz of [-0.18, 0, 0.18]) {
      bodyGroup.add(this.box(0.12, 0.07, 0.025, carbonMat, -0.88, 0.14, fz, false, false));
    }

    // Quad cylindrical chrome performance exhaust tips
    for (const ez of [-0.23, -0.16, 0.16, 0.23]) {
      bodyGroup.add(this.cylX(0.022, 0.11, chromeMat, -0.89, 0.17, ez, false, true));
    }

    // Sculpted rear GT wing spoiler on twin pylons + aerodynamic endplates
    const wingBlade = this.box(0.15, 0.028, 0.90, carbonMat, -0.82, 0.51, 0);
    wingBlade.rotation.z = -0.08;
    bodyGroup.add(
      wingBlade,
      this.box(0.07, 0.11, 0.03, carbonMat, -0.80, 0.44, -0.22),
      this.box(0.07, 0.11, 0.03, carbonMat, -0.80, 0.44, 0.22),
      this.box(0.17, 0.08, 0.022, paintMain, -0.82, 0.51, -0.45),
      this.box(0.17, 0.08, 0.022, paintMain, -0.82, 0.51, 0.45)
    );

    // Teardrop aero side mirrors
    bodyGroup.add(
      this.box(0.09, 0.045, 0.11, carbonMat, 0.30, 0.44, -0.46),
      this.box(0.09, 0.045, 0.11, carbonMat, 0.30, 0.44, 0.46)
    );

    // Mid-engine V8 valve covers tucked beneath the rear clamshell deck
    bodyGroup.add(
      this.box(0.28, 0.07, 0.42, carbonMat, -0.62, 0.37, 0, false, false),
      this.box(0.24, 0.03, 0.12, paintMain, -0.62, 0.41, -0.11, false, false),
      this.box(0.24, 0.03, 0.12, paintMain, -0.62, 0.41, 0.11, false, false)
    );

    // Sleek teardrop cockpit canopy (isolated in cabGroup so FPS cockpit view hides interior glass)
    const cabGroup = new THREE.Group();
    const canopyMesh = new THREE.Mesh(this.supercarCanopyGeo, [glassMat, paintRoof, glassMat, glassMat]);
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;
    cabGroup.add(canopyMesh);

    // Painted roof cap & NACA roof air scoop
    cabGroup.add(this.box(0.36, 0.022, 0.66, paintRoof, -0.02, 0.625, 0));
    if (!police) {
      cabGroup.add(this.box(0.18, 0.042, 0.16, carbonMat, -0.08, 0.648, 0));
    }
    bodyGroup.add(cabGroup);

    // Hinged rear mid-engine clamshell deck (-0.43, 0.41, 0) lifts upward when searched
    const trunkPivot = new THREE.Group();
    trunkPivot.position.set(-0.43, 0.41, 0);
    trunkPivot.add(
      this.box(0.38, 0.026, 0.68, carbonMat, -0.19, 0.006, 0),
      this.box(0.34, 0.032, 0.10, paintMain, -0.19, 0.008, -0.30),
      this.box(0.34, 0.032, 0.10, paintMain, -0.19, 0.008, 0.30)
    );
    bodyGroup.add(trunkPivot);

    // Emissive LED DRL headlight blades
    const headMat = this.getMat('#fff5c2', { emissive: '#fff0a3', emissiveIntensity: 1.4, roughness: 0.18 });
    const hlL = this.box(0.05, 0.042, 0.19, headMat, 0.87, 0.25, -0.30, false, false);
    hlL.rotation.y = 0.20;
    const hlR = this.box(0.05, 0.042, 0.19, headMat, 0.87, 0.25, 0.30, false, false);
    hlR.rotation.y = -0.20;
    bodyGroup.add(hlL, hlR);

    // Twin rear LED taillight strips (pulsed on brake/drift)
    const tailMatL = this.getMat('#ff3b30', { emissive: '#ff3b30', emissiveIntensity: 0.5, roughness: 0.22 });
    const tailMatR = tailMatL.clone();
    this.materials.push(tailMatR);
    const tl = this.box(0.045, 0.048, 0.24, tailMatL, -0.89, 0.33, -0.27, false, false);
    const tr = this.box(0.045, 0.048, 0.24, tailMatR, -0.89, 0.33, 0.27, false, false);
    bodyGroup.add(tl, tr);

    // Wide low-profile supercar tires & 10-spoke Y-alloy wheels
    const wheelMats = [tireMat, wheelFaceMat, wheelFaceMat];
    const makeWheel = () => this.cylinderWheel(0.34, 0.15, wheelMats, 0, 0, 0);

    const wheelFL = new THREE.Group();
    wheelFL.position.set(0.55, 0.17, -0.42);
    const wFL = makeWheel();
    wheelFL.add(wFL);

    const wheelFR = new THREE.Group();
    wheelFR.position.set(0.55, 0.17, 0.42);
    const wFR = makeWheel();
    wheelFR.add(wFR);

    const wRL = makeWheel();
    wRL.position.set(-0.55, 0.17, -0.42);
    const wRR = makeWheel();
    wRR.position.set(-0.55, 0.17, 0.42);

    bodyGroup.add(wheelFL, wheelFR, wRL, wRR);

    let sirenRed: THREE.Mesh | undefined;
    let sirenBlue: THREE.Mesh | undefined;
    if (police) {
      // Matte-steel interceptor push-bar on front fascia
      bodyGroup.add(
        this.box(0.045, 0.15, 0.48, carbonMat, 0.91, 0.21, 0),
        this.box(0.05, 0.18, 0.04, carbonMat, 0.91, 0.22, -0.15),
        this.box(0.05, 0.18, 0.04, carbonMat, 0.91, 0.22, 0.15)
      );

      // Low-profile aerodynamic LED lightbar on cab roof
      cabGroup.add(this.box(0.12, 0.045, 0.58, carbonMat, -0.02, 0.652, 0));
      const redMat = this.getMat('#ff4a42', { emissive: '#ff4a42', emissiveIntensity: 0.25, roughness: 0.18 }).clone();
      const blueMat = this.getMat('#4da3ff', { emissive: '#4da3ff', emissiveIntensity: 0.25, roughness: 0.18 }).clone();
      this.materials.push(redMat, blueMat);
      sirenRed = this.box(0.11, 0.055, 0.22, redMat, -0.02, 0.665, -0.17, false, false);
      sirenBlue = this.box(0.11, 0.055, 0.22, blueMat, -0.02, 0.665, 0.17, false, false);
      cabGroup.add(sirenRed, sirenBlue);
      cabGroup.add(this.box(0.11, 0.055, 0.12, this.getMat('#dce8f5', { roughness: 0.22 }), -0.02, 0.665, 0, false, false));
    }

    const glintMesh = this.box(
      0.09,
      0.09,
      0.09,
      this.getMat('#f0d078', { emissive: '#f0d078', emissiveIntensity: 0.9 }),
      -0.62,
      0.98,
      0,
      false,
      false
    );
    glintMesh.rotation.set(0.65, 0, 0.55);
    glintMesh.visible = false;
    root.add(glintMesh);

    return {
      root,
      bodyGroup,
      cabGroup,
      wheelFL,
      wheelFR,
      wheelMeshes: [wFL, wFR, wRL, wRR],
      trunkPivot,
      tailLights: [tl, tr],
      sirenRed,
      sirenBlue,
      glintMesh,
    };
  }

  private createWeaponGroup(weapon: WeaponId): THREE.Group {
    const g = new THREE.Group();
    const wTex = this.atlas.weaponTex;
    if (weapon === 'crowbar') {
      const steel = this.getMat(0xffffff, { map: wTex.crowbarSteel, roughness: 0.34, metalness: 0.8 });
      const brightSteel = this.getMat('#d4dde3', { roughness: 0.22, metalness: 0.9 });
      const red = this.getMat(0xffffff, { map: wTex.crowbarRed, roughness: 0.48, metalness: 0.26 });
      const gripMat = this.getMat(0xffffff, { map: wTex.rubberGrip, roughness: 0.9, metalness: 0.04 });

      // Forged hexagonal steel gooseneck pry bar curving smoothly into -Y striking hook
      const barGeo = this.getCachedGeo('melee_crowbar_bar', () =>
        createSculptedProfileGeometry(
          [
            [-0.125, -0.004],
            [-0.08, -0.015],
            [0.42, -0.016],
            [0.485, -0.025],
            [0.515, -0.058],
            [0.506, -0.102],
            [0.474, -0.132],
            [0.498, -0.146],
            [0.548, -0.102],
            [0.562, -0.036],
            [0.526, 0.016],
            [0.46, 0.028],
            [0.39, 0.018],
            [-0.04, 0.016],
            [-0.11, 0.006],
          ],
          0.03,
          { bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 6 }
        )
      );
      g.add(new THREE.Mesh(barGeo, steel));

      // Worn red industrial enamel sleeve along shaft & outer gooseneck spine
      const sleeveGeo = this.getCachedGeo('melee_crowbar_sleeve', () =>
        createSculptedProfileGeometry(
          [
            [0.11, -0.017],
            [0.422, -0.018],
            [0.482, -0.026],
            [0.492, 0.028],
            [0.395, 0.019],
            [0.11, 0.018],
          ],
          0.033,
          { bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 4 }
        )
      );
      g.add(new THREE.Mesh(sleeveGeo, red));

      // Split V-claw honed pry tips at gooseneck beak (-Y)
      const prongGeo = this.getCachedGeo('melee_crowbar_prong', () =>
        createSculptedProfileGeometry(
          [
            [0.47, -0.128],
            [0.496, -0.152],
            [0.522, -0.124],
            [0.498, -0.1],
          ],
          0.009,
          { bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }
        )
      );
      const prongL = new THREE.Mesh(prongGeo, brightSteel);
      prongL.position.z = -0.01;
      const prongR = new THREE.Mesh(prongGeo, brightSteel);
      prongR.position.z = 0.01;
      g.add(prongL, prongR);

      // Ribbed rubber lower grip sleeve turned around shaft
      const gripGeo = this.getCachedGeo('melee_crowbar_grip', () =>
        createLatheWeaponGeometry(
          [
            [-0.035, 0.006],
            [-0.03, 0.024],
            [0.01, 0.022],
            [0.05, 0.025],
            [0.09, 0.022],
            [0.125, 0.025],
            [0.132, 0.006],
          ],
          14
        )
      );
      g.add(new THREE.Mesh(gripGeo, gripMat));
    } else if (weapon === 'machete') {
      const gripMat = this.getMat(0xffffff, { map: wTex.macheteGrip, roughness: 0.78, metalness: 0.08 });
      const guardMat = this.getMat('#c49c48', { roughness: 0.34, metalness: 0.82 });
      const bladeMat = this.getMat(0xffffff, { map: wTex.macheteBlade, roughness: 0.28, metalness: 0.84 });
      const razorMat = this.getMat('#e5edf2', { roughness: 0.16, metalness: 0.94 });

      // Ergonomic riveted walnut grip with flared pommel & finger groove
      const handleGeo = this.getCachedGeo('melee_machete_handle', () =>
        createSculptedProfileGeometry(
          [
            [-0.072, -0.026],
            [-0.048, -0.02],
            [-0.005, -0.017],
            [0.042, -0.021],
            [0.085, -0.018],
            [0.088, 0.02],
            [0.025, 0.021],
            [-0.035, 0.019],
            [-0.068, 0.024],
          ],
          0.028,
          { bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4 }
        )
      );
      g.add(new THREE.Mesh(handleGeo, gripMat));

      // Brass tang rivets & contoured cross-guard bolster
      const rivetGeo = this.getCachedGeo('melee_machete_rivet', () => {
        const cyl = new THREE.CylinderGeometry(0.0052, 0.0052, 0.032, 8);
        cyl.rotateX(Math.PI * 0.5);
        return cyl;
      });
      for (const rx of [-0.038, 0.01, 0.056]) {
        const r = new THREE.Mesh(rivetGeo, guardMat);
        r.position.set(rx, 0, 0);
        g.add(r);
      }

      const guardGeo = this.getCachedGeo('melee_machete_guard', () =>
        createSculptedProfileGeometry(
          [
            [0.082, -0.038],
            [0.104, -0.032],
            [0.108, 0.026],
            [0.084, 0.026],
          ],
          0.036,
          { bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }
        )
      );
      g.add(new THREE.Mesh(guardGeo, guardMat));

      // Swept curved clip-point blade: honed cutting belly curves cleanly along -Y
      const bladeGeo = this.getCachedGeo('melee_machete_blade', () =>
        createSculptedProfileGeometry(
          [
            [0.102, -0.024],
            [0.24, -0.033],
            [0.39, -0.043],
            [0.505, -0.03],
            [0.575, 0.006],
            [0.525, 0.028],
            [0.36, 0.03],
            [0.102, 0.023],
          ],
          0.014,
          { bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 6 }
        )
      );
      g.add(new THREE.Mesh(bladeGeo, bladeMat));

      // Polished razor-honed primary cutting edge hugging -Y belly
      const razorGeo = this.getCachedGeo('melee_machete_razor', () =>
        createSculptedProfileGeometry(
          [
            [0.105, -0.028],
            [0.24, -0.039],
            [0.392, -0.049],
            [0.508, -0.036],
            [0.58, 0.005],
            [0.556, 0.006],
            [0.495, -0.023],
            [0.39, -0.034],
            [0.24, -0.025],
            [0.105, -0.018],
          ],
          0.011,
          { bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }
        )
      );
      const razorMesh = new THREE.Mesh(razorGeo, razorMat);
      razorMesh.castShadow = false;
      g.add(razorMesh);
    } else if (weapon === 'barbed_bat') {
      const tape = this.getMat(0xffffff, { map: wTex.rubberGrip, roughness: 0.9, metalness: 0.04 });
      const wood = this.getMat(0xffffff, { map: wTex.batWood, roughness: 0.72, metalness: 0.05 });
      const wire = this.getMat(0xffffff, { map: wTex.barbedWire, roughness: 0.36, metalness: 0.78 });
      const barbMat = this.getMat('#dfe7eb', { roughness: 0.24, metalness: 0.88 });

      const batRadiusAt = (x: number): number => {
        if (x <= 0.14) return 0.0185;
        if (x >= 0.47) return 0.0415;
        const t = (x - 0.14) / 0.33;
        return 0.0185 + t * t * (3 - 2 * t) * (0.0415 - 0.0185);
      };

      // Smooth turned ash baseball bat via LatheGeometry (knob -> neck -> barrel -> cupped tip)
      const batGeo = this.getCachedGeo('melee_bat_lathe', () =>
        createLatheWeaponGeometry(
          [
            [-0.066, 0.006],
            [-0.062, 0.027],
            [-0.044, 0.025],
            [-0.032, 0.017],
            [0.14, 0.0185],
            [0.24, 0.025],
            [0.34, 0.035],
            [0.44, 0.041],
            [0.52, 0.0415],
            [0.556, 0.034],
            [0.562, 0.006],
          ],
          18
        )
      );
      g.add(new THREE.Mesh(batGeo, wood));

      // Ribbed athletic handle tape wrap
      const tapeGeo = this.getCachedGeo('melee_bat_tape', () =>
        createLatheWeaponGeometry(
          [
            [-0.064, 0.0285],
            [-0.043, 0.0265],
            [-0.03, 0.0195],
            [0.03, 0.021],
            [0.09, 0.0205],
            [0.145, 0.0215],
            [0.15, 0.018],
          ],
          16
        )
      );
      g.add(new THREE.Mesh(tapeGeo, tape));

      // Dual continuous 3D helical barbed-wire coils wrapped tightly around the barrel
      const wireGeoA = this.getCachedGeo('melee_bat_wire_a', () =>
        createHelicalWireGeometry({
          startX: 0.27,
          endX: 0.52,
          radiusFn: (t) => batRadiusAt(0.27 + t * 0.25) + 0.0038,
          turns: 5.5,
          tubeRadius: 0.0048,
          radialSegments: 6,
          tubularSegments: 72,
          phaseOffset: 0,
        })
      );
      const wireGeoB = this.getCachedGeo('melee_bat_wire_b', () =>
        createHelicalWireGeometry({
          startX: 0.29,
          endX: 0.505,
          radiusFn: (t) => batRadiusAt(0.29 + t * 0.215) + 0.0052,
          turns: 4.0,
          tubeRadius: 0.004,
          radialSegments: 6,
          tubularSegments: 54,
          phaseOffset: Math.PI * 0.85,
        })
      );
      g.add(new THREE.Mesh(wireGeoA, wire), new THREE.Mesh(wireGeoB, wire));

      // 14 sharp conical steel barbs protruding radially along the wire helix
      const spikeGeo = this.getCachedGeo('melee_bat_barb_cone', () => new THREE.ConeGeometry(0.0055, 0.024, 5));
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const bx = 0.28 + t * 0.23;
        const br = batRadiusAt(bx) + 0.005;
        const ang = t * 5.5 * Math.PI * 2 + (i % 2 === 0 ? 0.2 : Math.PI + 0.6);
        const ny = Math.cos(ang);
        const nz = Math.sin(ang);
        const spike = new THREE.Mesh(spikeGeo, barbMat);
        spike.position.set(bx, ny * (br + 0.008), nz * (br + 0.008));
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.22, ny, nz).normalize());
        spike.castShadow = false;
        g.add(spike);
      }
    } else if (weapon === 'axe') {
      const hickory = this.getMat(0xffffff, { map: wTex.batWood, roughness: 0.78, metalness: 0.04 });
      const collarMat = this.getMat('#24282e', { roughness: 0.65, metalness: 0.45 });
      const headMat = this.getMat(0xffffff, { map: wTex.axeHead, roughness: 0.38, metalness: 0.62 });
      const bitMat = this.getMat('#e4edf2', { roughness: 0.18, metalness: 0.92 });
      const gripMat = this.getMat(0xffffff, { map: wTex.rubberGrip, roughness: 0.9 });

      // Ergonomic S-curved hickory haft with fawn's-foot pommel flare
      const haftGeo = this.getCachedGeo('melee_axe_haft', () =>
        createSculptedProfileGeometry(
          [
            [-0.085, -0.028],
            [-0.042, -0.024],
            [0.06, -0.015],
            [0.24, -0.016],
            [0.41, -0.014],
            [0.545, -0.016],
            [0.552, 0.02],
            [0.42, 0.02],
            [0.24, 0.017],
            [0.06, 0.019],
            [-0.048, 0.016],
            [-0.08, 0.012],
          ],
          0.028,
          { bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 5 }
        )
      );
      g.add(new THREE.Mesh(haftGeo, hickory));

      // Lower palm grip wrap
      const gripGeo = this.getCachedGeo('melee_axe_grip', () =>
        createLatheWeaponGeometry(
          [
            [-0.032, 0.022],
            [0.03, 0.02],
            [0.11, 0.021],
            [0.12, 0.016],
          ],
          14
        )
      );
      g.add(new THREE.Mesh(gripGeo, gripMat));

      // Sculpted steel overstrike collar below axe eye
      const collarGeo = this.getCachedGeo('melee_axe_collar', () =>
        createSculptedProfileGeometry(
          [
            [0.425, -0.02],
            [0.548, -0.022],
            [0.552, 0.024],
            [0.425, 0.024],
          ],
          0.036,
          { bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }
        )
      );
      g.add(new THREE.Mesh(collarGeo, collarMat));

      // Bearded crimson fire-axe head: broad curved crescent bit extending cleanly into -Y!
      const headGeo = this.getCachedGeo('melee_axe_head', () =>
        createSculptedProfileGeometry(
          [
            [0.426, -0.022],
            [0.386, -0.116],
            [0.425, -0.144],
            [0.495, -0.15],
            [0.568, -0.126],
            [0.554, -0.042],
            [0.538, 0.034],
            [0.436, 0.034],
          ],
          0.034,
          { bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2, curveSegments: 6 }
        )
      );
      g.add(new THREE.Mesh(headGeo, headMat));

      // Gleaming honed crescent cutting bit along -Y edge
      const bitGeo = this.getCachedGeo('melee_axe_bit', () =>
        createSculptedProfileGeometry(
          [
            [0.384, -0.118],
            [0.424, -0.148],
            [0.496, -0.155],
            [0.57, -0.13],
            [0.558, -0.106],
            [0.494, -0.128],
            [0.43, -0.122],
            [0.396, -0.102],
          ],
          0.012,
          { bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2 }
        )
      );
      const bitMesh = new THREE.Mesh(bitGeo, bitMat);
      bitMesh.castShadow = false;
      g.add(bitMesh);

      // Rear tapered demolition pick spike projecting on +Y
      const pickGeo = this.getCachedGeo('melee_axe_pick', () =>
        createSculptedProfileGeometry(
          [
            [0.452, 0.028],
            [0.522, 0.028],
            [0.482, 0.098],
            [0.46, 0.098],
          ],
          0.02,
          { bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }
        )
      );
      g.add(new THREE.Mesh(pickGeo, bitMat));
    } else if (weapon === 'sledgehammer') {
      const shaftMat = this.getMat(0xffffff, { map: wTex.batWood, roughness: 0.82, metalness: 0.05 });
      const gripMat = this.getMat(0xffffff, { map: wTex.rubberGrip, roughness: 0.92 });
      const ironMat = this.getMat(0xffffff, { map: wTex.sledgeIron, roughness: 0.42, metalness: 0.78 });
      const faceMat = this.getMat('#9aa6b0', { roughness: 0.28, metalness: 0.88 });

      // Contoured thick hickory shaft with pommel flare
      const shaftGeo = this.getCachedGeo('melee_sledge_shaft', () =>
        createSculptedProfileGeometry(
          [
            [-0.085, -0.026],
            [-0.04, -0.02],
            [0.575, -0.02],
            [0.58, 0.02],
            [-0.04, 0.02],
            [-0.085, 0.026],
          ],
          0.034,
          { bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2 }
        )
      );
      g.add(new THREE.Mesh(shaftGeo, shaftMat));

      // Ribbed rubber lower grip + heavy overstrike sleeve near hammer eye
      const gripGeo = this.getCachedGeo('melee_sledge_grip', () =>
        createLatheWeaponGeometry(
          [
            [-0.042, 0.025],
            [0.02, 0.023],
            [0.09, 0.025],
            [0.16, 0.023],
            [0.17, 0.018],
          ],
          16
        )
      );
      const collarGeo = this.getCachedGeo('melee_sledge_collar', () =>
        createLatheWeaponGeometry(
          [
            [0.42, 0.018],
            [0.435, 0.028],
            [0.482, 0.03],
            [0.496, 0.025],
          ],
          16
        )
      );
      g.add(new THREE.Mesh(gripGeo, gripMat), new THREE.Mesh(collarGeo, gripMat));

      // Chamfered twin-faced cast-iron sledge head with pinched waist cheeks
      const headGeo = this.getCachedGeo('melee_sledge_head', () =>
        createSculptedProfileGeometry(
          [
            [0.494, -0.098],
            [0.586, -0.098],
            [0.578, -0.042],
            [0.588, 0.0],
            [0.578, 0.042],
            [0.586, 0.098],
            [0.494, 0.098],
            [0.502, 0.042],
            [0.49, 0.0],
            [0.502, -0.042],
          ],
          0.084,
          { bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2 }
        )
      );
      g.add(new THREE.Mesh(headGeo, ironMat));

      // Octagonal beveled steel striking face caps aligned to head cheeks at -Y (primary strike) and +Y
      const capGeo = this.getCachedGeo('melee_sledge_face', () => {
        const cyl = new THREE.CylinderGeometry(0.036, 0.043, 0.016, 8);
        cyl.rotateY(Math.PI / 8);
        return cyl;
      });
      const faceBot = new THREE.Mesh(capGeo, faceMat);
      faceBot.position.set(0.54, -0.104, 0);
      faceBot.rotation.x = Math.PI;
      const faceTop = new THREE.Mesh(capGeo, faceMat);
      faceTop.position.set(0.54, 0.104, 0);
      g.add(faceBot, faceTop);
    } else if (weapon === 'pistol') {
      const slide = this.getMat(0xffffff, { map: this.atlas.weaponTex.pistolSlide, roughness: 0.28, metalness: 0.86 });
      const slideTop = this.getMat('#7f8a94', { roughness: 0.26, metalness: 0.88 });
      const frame = this.getMat('#2a3036', { roughness: 0.68, metalness: 0.32 });
      const grip = this.getMat(0xffffff, { map: wTex.pistolGrip, roughness: 0.88, metalness: 0.08 });
      const steel = this.getMat('#aeb8c0', { roughness: 0.25, metalness: 0.92 });
      const darkBore = this.getMat('#0d1012', { roughness: 0.9, metalness: 0.1 });
      const brassHood = this.getMat('#d6b256', { roughness: 0.32, metalness: 0.85 });
      const sightDot = this.getMat('#b8f58e', { emissive: '#8de065', emissiveIntensity: 0.85, roughness: 0.2 });

      // Machined slide body + top bevel rib + recessed ejection port/brass chamber hood
      g.add(this.box(0.28, 0.052, 0.064, slide, 0.14, 0.064, 0));
      g.add(this.box(0.26, 0.012, 0.046, slideTop, 0.138, 0.094, 0, false, true));
      g.add(this.box(0.065, 0.014, 0.036, brassHood, 0.155, 0.089, 0.008, false, false));
      // Round protruding steel barrel + dark muzzle crown
      g.add(this.cylX(0.017, 0.065, steel, 0.285, 0.063, 0, false, true));
      g.add(this.cylX(0.011, 0.012, darkBore, 0.314, 0.063, 0, false, false));
      // Dust-cover frame + underbarrel tactical rail & compact weapon light
      g.add(this.box(0.25, 0.034, 0.054, frame, 0.13, 0.024, 0));
      g.add(this.box(0.09, 0.026, 0.044, frame, 0.22, -0.003, 0, false, true));
      g.add(this.cylX(0.012, 0.02, this.getMat('#ffe79c', { emissive: '#ffd266', emissiveIntensity: 0.45 }), 0.265, -0.003, 0, false, false));
      // Beavertail & spurred hammer + slide-stop lever
      g.add(this.box(0.04, 0.016, 0.044, frame, 0.005, 0.036, 0, false, false));
      const hammer = this.box(0.028, 0.024, 0.016, steel, -0.004, 0.064, 0, false, false);
      hammer.rotation.z = 0.45;
      g.add(hammer);
      g.add(this.box(0.055, 0.012, 0.008, steel, 0.09, 0.035, 0.03, false, false));
      // Trigger guard & curved trigger
      g.add(this.box(0.075, 0.012, 0.024, frame, 0.105, -0.028, 0, false, false));
      g.add(this.box(0.014, 0.042, 0.024, frame, 0.14, -0.008, 0, false, false));
      const trig = this.box(0.01, 0.028, 0.012, steel, 0.108, -0.004, 0, false, false);
      trig.rotation.z = -0.3;
      g.add(trig);
      // Angled stippled ergonomic grip + flared baseplate magazine
      const gripMesh = this.box(0.078, 0.145, 0.054, grip, 0.035, -0.038, 0);
      gripMesh.rotation.z = -0.18;
      g.add(gripMesh);
      const magPad = this.box(0.082, 0.018, 0.056, frame, 0.022, -0.112, 0, false, true);
      magPad.rotation.z = -0.18;
      g.add(magPad);
      // 3-dot tritium iron sights
      g.add(this.box(0.018, 0.018, 0.042, frame, 0.018, 0.104, 0, false, false));
      g.add(this.box(0.008, 0.01, 0.01, sightDot, 0.012, 0.108, -0.014, false, false));
      g.add(this.box(0.008, 0.01, 0.01, sightDot, 0.012, 0.108, 0.014, false, false));
      g.add(this.box(0.016, 0.018, 0.014, frame, 0.258, 0.104, 0, false, false));
      g.add(this.box(0.008, 0.01, 0.01, sightDot, 0.258, 0.108, 0, false, false));
    } else if (weapon === 'shotgun') {
      const barrel = this.getMat('#555e66', { roughness: 0.28, metalness: 0.88 });
      const darkSteel = this.getMat('#262b30', { roughness: 0.42, metalness: 0.82 });
      const receiver = this.getMat(0xffffff, { map: wTex.shotgunReceiver, roughness: 0.35, metalness: 0.82 });
      const stock = this.getMat(0xffffff, { map: wTex.shotgunWood, roughness: 0.78, metalness: 0.06 });
      const rubberPad = this.getMat('#16181b', { roughness: 0.92, metalness: 0.05 });
      const steel = this.getMat('#b8c2c9', { roughness: 0.24, metalness: 0.92 });
      const shellRed = this.getMat('#c43d33', { roughness: 0.55, metalness: 0.15 });
      const brass = this.getMat('#d4af4c', { roughness: 0.3, metalness: 0.88 });
      const bead = this.getMat('#ffd266', { emissive: '#e8aa35', emissiveIntensity: 0.7, metalness: 0.85 });

      // Heavy cylindrical 12G barrel + ventilated top rib + dark muzzle bore
      g.add(this.cylX(0.024, 0.54, barrel, 0.37, 0.072, 0, true, true));
      g.add(this.cylX(0.016, 0.014, rubberPad, 0.642, 0.072, 0, false, false));
      g.add(this.box(0.50, 0.012, 0.018, darkSteel, 0.36, 0.098, 0, false, true));
      // Full-length tubular magazine + barrel clamp ring
      g.add(this.cylX(0.020, 0.46, darkSteel, 0.33, 0.032, 0, true, true));
      g.add(this.box(0.028, 0.078, 0.052, darkSteel, 0.54, 0.052, 0, false, true));
      // Sculpted blued steel receiver with ejection port & bolt
      g.add(this.box(0.22, 0.078, 0.074, receiver, 0.12, 0.044, 0));
      g.add(this.box(0.065, 0.026, 0.012, steel, 0.135, 0.062, 0.034, false, false));
      // 4-shell side-saddle carrier mounted on left receiver
      g.add(this.box(0.14, 0.042, 0.014, darkSteel, 0.11, 0.044, -0.042, false, false));
      for (let s = 0; s < 4; s++) {
        const sx = 0.062 + s * 0.032;
        g.add(this.box(0.02, 0.046, 0.018, shellRed, sx, 0.046, -0.048, false, false));
        g.add(this.box(0.02, 0.014, 0.019, brass, sx, 0.022, -0.048, false, false));
      }
      // Ribbed walnut pump forend + dual steel action bars
      g.add(this.box(0.19, 0.058, 0.074, stock, 0.35, 0.026, 0));
      g.add(this.box(0.18, 0.01, 0.01, steel, 0.25, 0.032, 0.034, false, false));
      g.add(this.box(0.18, 0.01, 0.01, steel, 0.25, 0.032, -0.034, false, false));
      // Trigger guard & trigger
      g.add(this.box(0.065, 0.01, 0.022, darkSteel, 0.06, -0.012, 0, false, false));
      g.add(this.box(0.012, 0.032, 0.022, darkSteel, 0.09, 0.002, 0, false, false));
      g.add(this.box(0.01, 0.022, 0.01, steel, 0.064, 0.004, 0, false, false));
      // Angled walnut grip & full buttstock with rubber recoil pad
      const wrist = this.box(0.11, 0.068, 0.064, stock, -0.015, 0.018, 0);
      wrist.rotation.z = 0.26;
      g.add(wrist);
      const butt = this.box(0.2, 0.098, 0.068, stock, -0.14, -0.008, 0);
      butt.rotation.z = 0.08;
      g.add(butt);
      const pad = this.box(0.024, 0.102, 0.07, rubberPad, -0.244, -0.016, 0, false, true);
      pad.rotation.z = 0.08;
      g.add(pad);
      // Brass front bead sight
      g.add(this.box(0.018, 0.022, 0.018, bead, 0.61, 0.112, 0, false, false));
    } else if (weapon === 'lmg') {
      const barrel = this.getMat('#454d54', { roughness: 0.28, metalness: 0.9 });
      const shroud = this.getMat(0xffffff, { map: wTex.lmgShroud, roughness: 0.36, metalness: 0.82 });
      const receiver = this.getMat('#2a3036', { roughness: 0.4, metalness: 0.82 });
      const furniture = this.getMat('#3b4231', { roughness: 0.72, metalness: 0.18 });
      const ammoBox = this.getMat(0xffffff, { map: wTex.lmgAmmoBox, roughness: 0.62, metalness: 0.35 });
      const beltMat = this.getMat(0xffffff, { map: wTex.ammoBelt, roughness: 0.34, metalness: 0.85 });
      const steel = this.getMat('#a6b0b8', { roughness: 0.26, metalness: 0.9 });
      const darkBore = this.getMat('#0e1012', { roughness: 0.9 });
      const sightDot = this.getMat('#f5d78e', { emissive: '#e8aa35', emissiveIntensity: 0.7, roughness: 0.3 });

      // Heavy round barrel + birdcage muzzle flash suppressor + gas tube underneath
      g.add(this.cylX(0.02, 0.44, barrel, 0.45, 0.074, 0, true, true));
      g.add(this.cylX(0.026, 0.068, receiver, 0.68, 0.074, 0, false, true));
      g.add(this.cylX(0.015, 0.014, darkBore, 0.715, 0.074, 0, false, false));
      g.add(this.cylX(0.014, 0.34, barrel, 0.38, 0.036, 0, false, true));
      // Gas block & tall protected front sight post
      g.add(this.box(0.042, 0.068, 0.044, receiver, 0.56, 0.062, 0, false, true));
      g.add(this.box(0.022, 0.045, 0.034, receiver, 0.56, 0.112, 0, false, false));
      g.add(this.box(0.012, 0.028, 0.012, sightDot, 0.56, 0.118, 0, false, false));
      // Perforated cooling barrel shroud / handguard
      g.add(this.box(0.32, 0.068, 0.076, shroud, 0.34, 0.058, 0));
      // Folded steel bipod legs along shroud sides
      g.add(this.cylX(0.01, 0.24, steel, 0.39, 0.022, -0.044, false, false));
      g.add(this.cylX(0.01, 0.24, steel, 0.39, 0.022, 0.044, false, false));
      g.add(this.box(0.024, 0.024, 0.022, receiver, 0.27, 0.018, -0.044, false, false));
      g.add(this.box(0.024, 0.024, 0.022, receiver, 0.27, 0.018, 0.044, false, false));
      // Heavy stamped receiver + hinged top feed-tray cover + rear flip sight + charging handle
      g.add(this.box(0.32, 0.088, 0.088, receiver, 0.09, 0.046, 0));
      g.add(this.box(0.18, 0.024, 0.082, barrel, 0.09, 0.098, 0, false, true));
      g.add(this.box(0.025, 0.032, 0.042, receiver, -0.02, 0.116, 0, false, false));
      g.add(this.box(0.032, 0.016, 0.038, steel, 0.11, 0.068, 0.054, false, false));
      // Top carry handle with ribbed grip
      g.add(this.box(0.018, 0.044, 0.018, steel, 0.22, 0.116, 0, false, false));
      g.add(this.box(0.018, 0.044, 0.018, steel, 0.36, 0.116, 0, false, false));
      g.add(this.box(0.16, 0.026, 0.032, furniture, 0.29, 0.142, 0, false, false));
      // Slung OD-green steel ammo box + linked brass 7.62mm belt feeding into receiver
      g.add(this.box(0.16, 0.115, 0.088, ammoBox, 0.09, -0.048, -0.036));
      const beltCurve = this.box(0.08, 0.078, 0.024, beltMat, 0.09, 0.032, -0.056, false, false);
      beltCurve.rotation.x = 0.28;
      g.add(beltCurve);
      // Buttstock with shoulder rest, contoured pistol grip, trigger guard & trigger
      g.add(this.box(0.22, 0.086, 0.074, furniture, -0.15, 0.032, 0));
      g.add(this.box(0.025, 0.108, 0.078, receiver, -0.26, 0.022, 0, false, true));
      const pGrip = this.box(0.054, 0.105, 0.048, furniture, 0.01, -0.05, 0);
      pGrip.rotation.z = -0.2;
      g.add(pGrip);
      g.add(this.box(0.06, 0.01, 0.022, receiver, 0.055, -0.024, 0, false, false));
      g.add(this.box(0.01, 0.026, 0.01, steel, 0.058, -0.005, 0, false, false));
    } else {
      const glass = this.getMat(0xffffff, { map: wTex.molotovGlass, roughness: 0.22, metalness: 0.14 });
      const cloth = this.getMat('#e6dcc8', { roughness: 0.9 });
      const flameCardMat = this.getMat(0xffffff, {
        map: this.atlas.flameTex,
        emissive: '#ffaa38',
        emissiveMap: this.atlas.flameTex,
        emissiveIntensity: 1.65,
        alphaTest: 0.18,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const coreFlame = this.getMat('#fff3b0', { emissive: '#fff3b0', emissiveIntensity: 2.15 });

      const bottleBody = this.cylX(0.062, 0.17, glass, 0.06, 0.045, 0, true, false);
      bottleBody.rotation.z = Math.PI * 0.5;
      const shoulder = this.taperedMesh(0.056, 0.056, 0.115, 0.115, 0.055, glass, 0.06, 0.13, 0, false, false, false);
      const neck = this.cylX(0.028, 0.055, glass, 0.06, 0.205, 0, false, false);
      neck.rotation.z = Math.PI * 0.5;
      const rag = this.taperedMesh(0.036, 0.036, 0.054, 0.054, 0.06, cloth, 0.06, 0.225, 0, false, false, false);
      g.add(bottleBody, shoulder, neck, rag);

      const flameGroup = new THREE.Group();
      flameGroup.position.set(0.06, 0.285, 0);
      for (const ry of [0, Math.PI * 0.5]) {
        const card = new THREE.Mesh(this.flameCardGeo, flameCardMat);
        card.scale.set(0.13, 0.16, 1);
        card.position.set(0, 0.04, 0);
        card.rotation.y = ry;
        flameGroup.add(card);
      }
      const spire = new THREE.Mesh(this.flameSpireGeo, coreFlame);
      spire.scale.set(0.055, 0.095, 0.055);
      spire.position.set(0, 0.035, 0);
      flameGroup.add(spire);
      g.add(flameGroup);
      g.userData.molotovFlame = flameGroup;
    }
    return g;
  }

  public createActorRig(kind: 'player' | ZombieArchetype): ActorRig3D {
    const isPlayer = kind === 'player';
    const isBloater = kind === 'bloater';
    const isRunner = kind === 'runner';
    const isSpitter = kind === 'spitter';
    const hTex = this.atlas.actorHeadTex[kind];
    const tTex = this.atlas.actorTorsoTex[kind];
    const lTex = this.atlas.actorLimbTex[kind];

    let skinHex = '#d6ac88';
    let shirtHex = '#455b42';
    let pantsHex = '#323b45';

    if (kind === 'player') {
      const pal = derivePlayerPalette();
      skinHex = pal.skin;
      shirtHex = pal.shirt;
      pantsHex = pal.pants;
    } else if (kind === 'walker') {
      skinHex = '#7d9478';
      shirtHex = '#614a42';
      pantsHex = '#2b3036';
    } else if (kind === 'runner') {
      skinHex = '#99706c';
      shirtHex = '#7f2c2c';
      pantsHex = '#202329';
    } else if (kind === 'bloater') {
      skinHex = '#6f8c49';
      shirtHex = '#485435';
      pantsHex = '#2d3326';
    } else if (kind === 'spitter') {
      skinHex = '#5f8782';
      shirtHex = '#38464d';
      pantsHex = '#21262b';
    }

    const makeActorMat = (
      hex: string | number,
      roughness = 0.86,
      metalness = 0.05,
      map?: THREE.Texture,
      emissiveHex?: string,
      emissiveIntensity = 0
    ) => {
      const m = new THREE.MeshStandardMaterial({
        color: map ? 0xffffff : hex,
        map: map ?? null,
        roughness,
        metalness,
        emissive: emissiveHex ?? 0x000000,
        emissiveIntensity,
      });
      this.materials.push(m);
      return m;
    };

    const skinMat = makeActorMat(skinHex, 0.85);
    const sleeveTexMat = makeActorMat(0xffffff, 0.88, 0.05, lTex.sleeve);
    const pantsTexMat = makeActorMat(0xffffff, 0.88, 0.05, lTex.leg);
    const bootMat = makeActorMat('#1b1614', 0.78);

    const headFrontMat = makeActorMat(0xffffff, 0.84, 0.05, hTex.front);
    const headBackMat = makeActorMat(0xffffff, 0.84, 0.05, hTex.back);
    const headSideMat = makeActorMat(0xffffff, 0.84, 0.05, hTex.side);
    const headTopMat = makeActorMat(0xffffff, 0.84, 0.05, hTex.top);

    const torsoFrontMat = makeActorMat(0xffffff, 0.88, 0.05, tTex.front);
    const torsoBackMat = makeActorMat(0xffffff, 0.88, 0.05, tTex.back);
    const torsoSideMat = makeActorMat(0xffffff, 0.88, 0.05, tTex.side);

    const flashMaterials = [
      skinMat,
      sleeveTexMat,
      pantsTexMat,
      bootMat,
      headFrontMat,
      headBackMat,
      headSideMat,
      headTopMat,
      torsoFrontMat,
      torsoBackMat,
      torsoSideMat,
    ];
    const allMaterials = [...flashMaterials];
    const flashMeshes: THREE.Mesh[] = [];

    const root = new THREE.Group();
    this.addContactShadow(root, isBloater ? 0.96 : 0.68, isBloater ? 0.96 : 0.68);

    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);

    // Legs with sculpted tapered calves/thighs + cuffed combat boots
    const legH = isRunner ? 0.34 : 0.32;
    const legSpread = isBloater ? 0.18 : 0.11;
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(0, legH, -legSpread);
    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0, legH, legSpread);

    const bootHiMat = makeActorMat('#382d28', 0.78);
    allMaterials.push(bootHiMat);
    flashMaterials.push(bootHiMat);

    const makeLeg = (pivot: THREE.Group) => {
      if (isPlayer) {
        const l = this.box(0.13, 0.22, 0.13, pantsTexMat, 0, -0.11, 0);
        const cuff = this.box(0.15, 0.03, 0.14, bootHiMat, 0.01, -0.21, 0);
        const b = this.box(0.17, 0.1, 0.14, bootMat, 0.02, -0.27, 0);
        pivot.add(l, cuff, b);
        flashMeshes.push(l, cuff, b);
      } else {
        const topW = isBloater ? 0.18 : isRunner ? 0.125 : 0.14;
        const botW = isBloater ? 0.14 : isRunner ? 0.085 : 0.10;
        const legMesh = this.taperedMesh(
          topW,
          topW,
          botW,
          botW,
          legH - 0.09,
          pantsTexMat,
          0,
          -(legH - 0.09),
          0
        );
        const cuff = this.box(botW + 0.02, 0.028, botW + 0.02, bootHiMat, 0.01, -(legH - 0.1), 0);
        const boot = this.taperedMesh(
          botW + 0.01,
          botW + 0.01,
          botW + 0.05,
          botW + 0.02,
          0.09,
          bootMat,
          0.02,
          -legH,
          0
        );
        pivot.add(legMesh, cuff, boot);
        flashMeshes.push(legMesh, cuff, boot);
      }
    };
    makeLeg(leftLegPivot);
    makeLeg(rightLegPivot);
    bodyPivot.add(leftLegPivot, rightLegPivot);

    // Torso
    const torso = new THREE.Group();
    torso.position.set(0, legH, 0);
    bodyPivot.add(torso);

    const torsoW = isBloater ? 0.42 : isRunner ? 0.26 : isSpitter ? 0.25 : 0.28;
    const torsoD = isBloater ? 0.56 : isRunner ? 0.41 : isSpitter ? 0.35 : 0.38;
    const torsoH = isBloater ? 0.45 : isRunner ? 0.38 : isSpitter ? 0.39 : 0.38;

    let bloaterPustuleMat: THREE.MeshStandardMaterial | null = null;
    if (isPlayer) {
      const torsoCore = this.box(
        torsoW,
        torsoH,
        torsoD,
        [torsoFrontMat, torsoBackMat, torsoSideMat, torsoSideMat, torsoSideMat, torsoSideMat],
        0,
        torsoH * 0.5,
        0
      );
      torso.add(torsoCore);
      flashMeshes.push(torsoCore);

      const packMat = makeActorMat(0xffffff, 0.9, 0.05, this.atlas.backpackTex);
      const tarpMat = makeActorMat('#706443', 0.9);
      const canteenMat = makeActorMat('#75828a', 0.35, 0.75);
      allMaterials.push(packMat, tarpMat, canteenMat);
      flashMaterials.push(packMat, tarpMat, canteenMat);

      torso.add(
        this.box(0.13, 0.27, 0.25, packMat, -torsoW * 0.5 - 0.06, 0.19, 0),
        this.box(0.11, 0.07, 0.27, tarpMat, -torsoW * 0.5 - 0.06, 0.34, 0),
        this.box(0.07, 0.1, 0.07, canteenMat, -torsoW * 0.5 - 0.08, 0.13, 0.13)
      );
    } else {
      // Sculpted V-tapered/hunched anatomical zombie torsos + pelvis bridge to hips
      const botW = isBloater ? 0.37 : isRunner ? 0.20 : isSpitter ? 0.20 : 0.23;
      const botD = isBloater ? 0.50 : isRunner ? 0.31 : isSpitter ? 0.28 : 0.32;
      const pelvis = this.taperedMesh(
        botW,
        botD,
        botW * 0.95,
        Math.max(botD - 0.02, 0.26),
        0.09,
        torsoSideMat,
        0,
        -0.05,
        0
      );
      torso.add(pelvis);
      flashMeshes.push(pelvis);

      const torsoCore = this.taperedMesh(
        torsoW,
        torsoD,
        botW,
        botD,
        torsoH,
        [torsoFrontMat, torsoBackMat, torsoSideMat, torsoSideMat, torsoSideMat, torsoSideMat],
        0,
        0,
        0
      );
      torso.add(torsoCore);
      flashMeshes.push(torsoCore);

      if (kind === 'walker') {
        // Asymmetric hunched shoulder/back lump
        const hunch = this.taperedMesh(0.15, 0.22, 0.19, 0.28, 0.10, torsoBackMat, -0.05, 0.29, 0.03);
        torso.add(hunch);
        flashMeshes.push(hunch);
      } else if (kind === 'runner') {
        // Angled hunched shoulder blades for predatory forward posture
        const shoulders = this.taperedMesh(0.24, 0.43, 0.22, 0.38, 0.09, torsoSideMat, 0.02, 0.30, 0);
        torso.add(shoulders);
        flashMeshes.push(shoulders);
      } else if (kind === 'bloater') {
        // Protruding necrotic gut dome + pixel-art textured bioluminescent pustules
        const belly = this.taperedMesh(0.18, 0.32, 0.24, 0.40, 0.24, torsoFrontMat, 0.10, 0.03, 0);
        torso.add(belly);
        flashMeshes.push(belly);

        // Permanently emissive textured pustules (excluded from flashMaterials so hit-flash preserves glow)
        bloaterPustuleMat = makeActorMat(0xffffff, 0.38, 0, this.atlas.pustuleTex.lime, '#78b828', 0.85);
        allMaterials.push(bloaterPustuleMat);
        const pustulePositions: Array<[number, number, number, number, number, number]> = [
          [0.19, 0.29, 0.12, 0.95, 1.05, 0.95],
          [0.21, 0.15, -0.13, 1.08, 0.95, 1.0],
          [0.17, 0.20, 0.03, 0.72, 0.72, 0.72],
          [-0.17, 0.33, -0.14, 0.95, 0.95, 0.85],
          [-0.18, 0.18, 0.13, 0.85, 0.9, 0.85],
          [0.02, 0.40, -0.21, 0.85, 0.78, 0.85],
        ];
        for (const [px, py, pz, sx, sy, sz] of pustulePositions) {
          const pMesh = new THREE.Mesh(this.pustuleGeo, bloaterPustuleMat);
          pMesh.position.set(px, py, pz);
          pMesh.scale.set(sx, sy, sz);
          pMesh.castShadow = true;
          torso.add(pMesh);
        }
      } else if (kind === 'spitter') {
        // Textured bioluminescent venom glands on sternum + jagged dorsal spines
        const spineMat = makeActorMat(0xffffff, 0.32, 0.08, this.atlas.pustuleTex.cyan, '#39cf98', 0.95);
        allMaterials.push(spineMat);

        const sacMain = new THREE.Mesh(this.pustuleGeo, spineMat);
        sacMain.position.set(0.11, 0.25, 0);
        sacMain.scale.set(0.92, 1.25, 1.05);
        const sacSub = new THREE.Mesh(this.pustuleGeo, spineMat);
        sacSub.position.set(0.12, 0.17, -0.05);
        sacSub.scale.set(0.62, 0.74, 0.68);
        torso.add(sacMain, sacSub);

        for (let i = 0; i < 4; i++) {
          const spine = new THREE.Mesh(this.spineConeGeo, spineMat);
          spine.position.set(-0.13 - i * 0.008, 0.10 + i * 0.085, 0);
          spine.rotation.z = 1.15;
          torso.add(spine);
        }
      }
    }

    // Head
    const headPivot = new THREE.Group();
    headPivot.position.set(isSpitter ? 0.08 : isRunner ? 0.05 : isBloater ? 0.04 : 0.02, isBloater ? torsoH - 0.04 : torsoH, 0);
    torso.add(headPivot);

    const headSize = isBloater ? 0.32 : 0.29;
    if (isPlayer) {
      const headMesh = this.box(
        headSize,
        headSize,
        headSize,
        [headFrontMat, headBackMat, headTopMat, headSideMat, headSideMat, headSideMat],
        0,
        headSize * 0.5 + 0.02,
        0
      );
      headPivot.add(headMesh);
      flashMeshes.push(headMesh);

      const brimMat = makeActorMat('#2d3626', 0.88);
      allMaterials.push(brimMat);
      flashMaterials.push(brimMat);
      headPivot.add(
        this.box(0.08, 0.03, headSize + 0.02, brimMat, headSize * 0.5 + 0.035, headSize - 0.075, 0)
      );
    } else {
      // Sculpted organic skull (domed crown narrower than cheekbones) + dedicated lower mandible jaw + neck stalk
      const neck = this.taperedMesh(0.12, 0.12, 0.16, 0.16, 0.08, headSideMat, -0.02, -0.02, 0);
      headPivot.add(neck);
      flashMeshes.push(neck);

      const craniumTop = isBloater ? 0.26 : isSpitter ? 0.19 : isRunner ? 0.20 : 0.22;
      const craniumBot = isBloater ? 0.31 : isSpitter ? 0.23 : isRunner ? 0.24 : 0.26;
      const craniumH = isBloater ? 0.25 : 0.22;
      const cranium = this.taperedMesh(
        craniumTop,
        craniumTop,
        craniumBot,
        craniumBot,
        craniumH,
        [headFrontMat, headBackMat, headTopMat, headSideMat, headSideMat, headSideMat],
        0.01,
        0.06,
        0
      );
      headPivot.add(cranium);
      flashMeshes.push(cranium);

      const crownCap = this.taperedMesh(
        craniumTop * 0.78,
        craniumTop * 0.78,
        craniumTop * 0.98,
        craniumTop * 0.98,
        0.032,
        headTopMat,
        0.01,
        0.06 + craniumH,
        0
      );
      headPivot.add(crownCap);
      flashMeshes.push(crownCap);

      // Dedicated snarling lower mandible jaw (uses teeth/blood jaw texture, never full head eyes!)
      const jawFrontMat = makeActorMat(0xffffff, 0.84, 0.05, hTex.jaw ?? hTex.side);
      allMaterials.push(jawFrontMat);
      flashMaterials.push(jawFrontMat);

      const jaw = this.taperedMesh(
        isBloater ? 0.21 : 0.17,
        isBloater ? 0.22 : 0.17,
        isBloater ? 0.17 : 0.13,
        isBloater ? 0.18 : 0.13,
        0.07,
        [jawFrontMat, headBackMat, jawFrontMat, headSideMat, headSideMat, headSideMat],
        0.038,
        -0.002,
        0
      );
      jaw.rotation.z = isSpitter || isRunner ? -0.22 : -0.12;
      headPivot.add(jaw);
      flashMeshes.push(jaw);

      if (kind === 'walker') {
        headPivot.rotation.x = 0.10; // Undead lurch head tilt
      } else if (kind === 'bloater' && bloaterPustuleMat) {
        const headPustule = new THREE.Mesh(this.pustuleGeo, bloaterPustuleMat);
        headPustule.position.set(0.08, 0.27, -0.10);
        headPustule.scale.set(0.85, 0.78, 0.85);
        headPivot.add(headPustule);
      }
    }

    // Arms (tucked into shoulder socket with deltoid cap & inward zombie reach)
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(0, torsoH - 0.055, isPlayer ? -(torsoD * 0.5 + 0.055) : -(torsoD * 0.5 + 0.02));
    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0, torsoH - 0.055, isPlayer ? torsoD * 0.5 + 0.055 : torsoD * 0.5 + 0.02);

    const clawMat = makeActorMat(isSpitter ? '#4be3a5' : '#8c1d1d', 0.65);
    allMaterials.push(clawMat);
    flashMaterials.push(clawMat);

    const makeArm = (pivot: THREE.Group, isZombie: boolean, sideSign: number) => {
      if (isZombie) {
        const thick = isBloater ? 0.14 : isRunner ? 0.095 : 0.105;
        const len1 = isRunner ? 0.21 : 0.18;
        const len2 = isRunner ? 0.22 : 0.18;

        // Slight inward reach & slouch so arms read clearly in both front FPS and ISO views
        pivot.rotation.y = sideSign * 0.16;
        pivot.rotation.z = isBloater ? -0.20 : isRunner ? -0.06 : -0.14;

        // Shoulder deltoid cap bridging torso to upper arm with zero air gap
        const shoulderCap = this.box(thick * 1.15, thick * 1.1, thick * 1.15, sleeveTexMat, 0.01, -0.005, -sideSign * 0.015);
        const upper = this.box(len1, thick, thick, sleeveTexMat, len1 * 0.5, 0, 0);
        const forearmGroup = new THREE.Group();
        forearmGroup.position.set(len1 - 0.015, 0, 0);
        forearmGroup.rotation.z = isRunner ? -0.32 : isSpitter ? -0.26 : -0.22;
        forearmGroup.rotation.y = sideSign * 0.12;
        const forearm = this.taperedMesh(
          thick * 0.94,
          thick * 0.94,
          thick * 0.72,
          thick * 0.72,
          len2,
          sleeveTexMat,
          len2 * 0.5,
          0,
          0,
          true
        );
        forearm.rotation.z = Math.PI * 0.5;
        forearm.position.set(len2 * 0.5, 0, 0);

        const claw = this.taperedMesh(
          thick * 0.68,
          thick * 0.68,
          0.03,
          0.04,
          isRunner ? 0.11 : 0.08,
          clawMat,
          0,
          0,
          0,
          true
        );
        claw.rotation.z = Math.PI * 0.5;
        claw.position.set(len2 + (isRunner ? 0.045 : 0.035), 0, 0);

        forearmGroup.add(forearm, claw);
        pivot.add(shoulderCap, upper, forearmGroup);
        flashMeshes.push(shoulderCap, upper, forearm, claw);
      } else {
        const sleeve = this.box(0.11, 0.2, 0.11, sleeveTexMat, 0, -0.08, 0);
        const hand = this.box(0.1, 0.1, 0.1, skinMat, 0, -0.22, 0);
        pivot.add(sleeve, hand);
        flashMeshes.push(sleeve, hand);
      }
    };
    makeArm(leftArmPivot, !isPlayer, -1);
    makeArm(rightArmPivot, !isPlayer, 1);
    torso.add(leftArmPivot, rightArmPivot);

    const rig: ActorRig3D = {
      root,
      bodyPivot,
      torso,
      headPivot,
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      flashMeshes,
      flashMaterials,
      allMaterials,
    };

    if (isPlayer) {
      const weaponGroup = new THREE.Group();
      weaponGroup.position.set(0.02, -0.22, 0.01);
      rightArmPivot.add(weaponGroup);
      const weapons: Record<WeaponId, THREE.Group> = {
        crowbar: this.createWeaponGroup('crowbar'),
        machete: this.createWeaponGroup('machete'),
        barbed_bat: this.createWeaponGroup('barbed_bat'),
        axe: this.createWeaponGroup('axe'),
        sledgehammer: this.createWeaponGroup('sledgehammer'),
        pistol: this.createWeaponGroup('pistol'),
        shotgun: this.createWeaponGroup('shotgun'),
        lmg: this.createWeaponGroup('lmg'),
        molotov: this.createWeaponGroup('molotov'),
      };
      for (const key of Object.keys(weapons) as WeaponId[]) {
        weapons[key].visible = key === 'crowbar';
        weaponGroup.add(weapons[key]);
      }

      const muzzleFlash = new THREE.Group();
      muzzleFlash.position.set(0.45, 0.05, 0);
      muzzleFlash.add(
        this.box(0.16, 0.12, 0.12, this.getMat('#fff3b0', { emissive: '#fff3b0', emissiveIntensity: 2.2 }), 0, 0, 0, false, false),
        this.box(0.12, 0.08, 0.08, this.getMat('#ff982b', { emissive: '#ff982b', emissiveIntensity: 2.0 }), 0.1, 0, 0, false, false)
      );
      muzzleFlash.visible = false;
      weaponGroup.add(muzzleFlash);

      const fishingRod = new THREE.Group();
      fishingRod.position.set(0.05, -0.15, 0);
      const rodStick = this.box(0.68, 0.04, 0.04, this.getMat('#6e4d30'), 0.34, 0.18, 0);
      rodStick.rotation.z = 0.5;
      fishingRod.add(rodStick);
      fishingRod.visible = false;
      rightArmPivot.add(fishingRod);

      rig.weaponGroup = weaponGroup;
      rig.weapons = weapons;
      rig.muzzleFlash = muzzleFlash;
      rig.fishingRod = fishingRod;
    }

    return rig;
  }

  public createFirstPersonViewmodelRig(): FirstPersonViewmodelRig {
    const root = new THREE.Group();
    const armPivot = new THREE.Group();
    // Right-hand foreground position in camera-local space (-Z is forward)
    armPivot.position.set(0.24, -0.22, -0.38);
    root.add(armPivot);

    const sleeveMat = this.getMat(0xffffff, {
      map: this.atlas.actorLimbTex.player.sleeve,
      roughness: 0.88,
    });
    const cuffMat = this.getMat('#2a2e2b', { roughness: 0.9 });
    const gloveMat = this.getMat(0xffffff, {
      map: this.atlas.weaponTex.glove,
      roughness: 0.82,
    });
    const fingerMat = this.getMat(derivePlayerPalette().skin, { roughness: 0.85 });

    // Pixel-art forearm + cuff + fingerless tactical glove pointing forward along -Z
    const armHolder = new THREE.Group();
    armHolder.rotation.y = Math.PI * 0.5;
    armPivot.add(armHolder);

    armHolder.add(this.box(0.26, 0.082, 0.082, sleeveMat, -0.14, -0.032, 0, false, false));
    armHolder.add(this.box(0.03, 0.086, 0.086, cuffMat, -0.015, -0.025, 0, false, false));
    armHolder.add(this.box(0.082, 0.074, 0.076, gloveMat, 0.036, -0.016, 0, false, false));
    armHolder.add(this.box(0.032, 0.054, 0.07, fingerMat, 0.076, -0.016, 0, false, false));

    const weaponHolder = new THREE.Group();
    weaponHolder.position.set(0.055, 0.02, 0);
    weaponHolder.scale.setScalar(0.9);
    armHolder.add(weaponHolder);

    const weapons: Record<WeaponId, THREE.Group> = {
      crowbar: this.createWeaponGroup('crowbar'),
      machete: this.createWeaponGroup('machete'),
      barbed_bat: this.createWeaponGroup('barbed_bat'),
      axe: this.createWeaponGroup('axe'),
      sledgehammer: this.createWeaponGroup('sledgehammer'),
      pistol: this.createWeaponGroup('pistol'),
      shotgun: this.createWeaponGroup('shotgun'),
      lmg: this.createWeaponGroup('lmg'),
      molotov: this.createWeaponGroup('molotov'),
    };
    for (const key of ['crowbar', 'machete', 'barbed_bat', 'axe', 'sledgehammer'] as const) {
      const grip = getFirstPersonMeleeGripPose(key);
      weapons[key].position.set(grip.posX, grip.posY, grip.posZ);
      weapons[key].rotation.order = 'ZYX';
      weapons[key].rotation.set(grip.rollX, grip.yawY, grip.pitchZ);
    }
    weapons.pistol.position.set(0.02, 0.005, 0);
    weapons.shotgun.position.set(-0.02, 0.005, 0);
    weapons.lmg.position.set(-0.04, 0.005, 0);
    weapons.molotov.position.set(0.02, -0.02, 0);
    for (const key of Object.keys(weapons) as WeaponId[]) {
      weapons[key].visible = key === 'crowbar';
      weaponHolder.add(weapons[key]);
    }
    const molotovFlame = (weapons.molotov.userData.molotovFlame as THREE.Group | undefined) ?? new THREE.Group();

    const muzzleFlash = new THREE.Group();
    muzzleFlash.position.set(0.56, 0.075, 0);
    const flashCoreMat = this.getMat('#fff6bf', { emissive: '#fff2a6', emissiveIntensity: 2.6 });
    const flashEdgeMat = this.getMat('#ff9d38', { emissive: '#ff952b', emissiveIntensity: 2.2 });
    muzzleFlash.add(
      this.box(0.08, 0.024, 0.024, flashCoreMat, 0.03, 0, 0, false, false),
      this.box(0.022, 0.095, 0.022, flashEdgeMat, 0.01, 0, 0, false, false),
      this.box(0.022, 0.022, 0.095, flashEdgeMat, 0.01, 0, 0, false, false)
    );
    muzzleFlash.visible = false;
    weaponHolder.add(muzzleFlash);

    const fishingRod = new THREE.Group();
    const rodStick = this.box(0.75, 0.035, 0.035, this.getMat('#6e4d30'), 0.34, 0.16, 0, false, false);
    rodStick.rotation.z = 0.38;
    fishingRod.add(rodStick);
    fishingRod.visible = false;
    weaponHolder.add(fishingRod);

    return { root, armPivot, weapons, muzzleFlash, fishingRod, molotovFlame };
  }

  public dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = [];
    this.geoCache.clear();
    this.materials = [];
    this.matCache.clear();
  }
}

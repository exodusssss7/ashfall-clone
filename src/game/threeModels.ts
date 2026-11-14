import * as THREE from 'three';
import type { ThreePixelAtlas } from './threeTextures';
import type { PropKind, StructureKind, WeaponId, ZombieArchetype } from './types';

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
  private materials: THREE.Material[] = [];
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  private unitBox: THREE.BoxGeometry;

  constructor(atlas: ThreePixelAtlas) {
    this.atlas = atlas;
    this.unitBox = this.trackGeo(new THREE.BoxGeometry(1, 1, 1));
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
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
      emissiveIntensity?: number;
      transparent?: boolean;
      opacity?: number;
    } = {}
  ): THREE.MeshStandardMaterial {
    const key = [
      color,
      opts.roughness ?? 0.85,
      opts.metalness ?? 0.05,
      opts.map?.uuid ?? 'nomap',
      opts.emissive ?? 'noem',
      opts.emissiveIntensity ?? 0,
      opts.transparent ? 'tr' : 'op',
      opts.opacity ?? 1,
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
        emissiveIntensity: opts.emissiveIntensity ?? 0,
        transparent: opts.transparent ?? false,
        opacity: opts.opacity ?? 1,
      })
    );
    this.matCache.set(key, mat);
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
    const ledgeColor = kind === 'wall_brick' ? '#635c58' : kind === 'wall_wood' ? '#59402c' : '#857d6d';
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
      const plankMat = this.getMat('#7a593c', { roughness: 0.88, transparent: tr, opacity: op });
      const glassMat = this.getMat('#10151a', { roughness: 0.2, metalness: 0.2, transparent: tr, opacity: op });
      const sill = this.box(1.05, 0.06, 1.05, this.getMat('#2b2119', { roughness: 0.9, transparent: tr, opacity: op }), 0, 0.35, 0, false, true);
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

    const frameMat = this.getMat('#453020', { roughness: 0.88 });
    const thresholdMat = this.getMat('#2c251f', { roughness: 0.94 });

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

    // Subtle floating search glint diamond indicator
    const glintMesh = this.box(
      0.09,
      0.09,
      0.09,
      this.getMat('#f0d078', { emissive: '#f0d078', emissiveIntensity: 0.9, roughness: 0.3 }),
      0,
      1.1,
      0,
      false,
      false
    );
    glintMesh.rotation.set(0.65, 0, 0.55);
    glintMesh.visible = false;
    root.add(glintMesh);

    if (kind === 'crate_wood' || kind === 'crate_military') {
      const mil = kind === 'crate_military';
      const sideMat = this.getMat(0xffffff, {
        map: mil ? this.atlas.crateSideTex.military : this.atlas.crateSideTex.wood,
        roughness: mil ? 0.72 : 0.86,
      });
      const topMat = this.getMat(0xffffff, {
        map: mil ? this.atlas.crateTopTex.military : this.atlas.crateTopTex.wood,
        roughness: mil ? 0.72 : 0.86,
      });
      const darkIn = this.getMat('#16191c', { roughness: 0.95 });

      this.addContactShadow(root, 0.92, 0.92);

      // Hollow-topped crate walls so opening reveals loot inside
      bodyGroup.add(this.box(0.76, 0.1, 0.76, darkIn, 0, 0.05, 0));
      bodyGroup.add(this.box(0.76, 0.56, 0.09, sideMat, 0, 0.28, 0.335));
      bodyGroup.add(this.box(0.76, 0.56, 0.09, sideMat, 0, 0.28, -0.335));
      bodyGroup.add(this.box(0.09, 0.56, 0.58, sideMat, -0.335, 0.28, 0));
      bodyGroup.add(this.box(0.09, 0.56, 0.58, sideMat, 0.335, 0.28, 0));

      // Interior loot items
      bodyGroup.add(
        this.box(0.22, 0.16, 0.22, this.getMat(mil ? '#d4b34a' : '#789e5a', { roughness: 0.65 }), -0.11, 0.22, 0.08),
        this.box(0.18, 0.18, 0.18, this.getMat(mil ? '#c44536' : '#c98842', { roughness: 0.6 }), 0.14, 0.23, -0.09)
      );

      // Hinged lid along back (-Z) edge
      lidPivot.position.set(0, 0.56, -0.38);
      lidPivot.add(this.box(0.78, 0.08, 0.78, topMat, 0, 0.04, 0.38));
      lidPivot.add(
        this.box(0.12, 0.09, 0.06, this.getMat('#e0b84c', { roughness: 0.28, metalness: 0.8 }), 0, 0.01, 0.77, false, false)
      );
      glintMesh.position.y = 0.86;
    } else if (kind === 'fridge') {
      const bodyMat = this.getMat('#dce3df', { roughness: 0.42, metalness: 0.15 });
      const sideMat = this.getMat('#b2bdb8', { roughness: 0.48, metalness: 0.15 });
      const doorFrontMat = this.getMat(0xffffff, { map: this.atlas.fridgeFrontTex, roughness: 0.4, metalness: 0.15 });
      const interiorMat = this.getMat('#2c414d', { emissive: '#386278', emissiveIntensity: 0.35, roughness: 0.6 });

      this.addContactShadow(root, 0.82, 0.78);

      // Cabinet back + sides + top/bottom
      bodyGroup.add(this.box(0.64, 1.06, 0.12, sideMat, 0, 0.53, -0.24));
      bodyGroup.add(this.box(0.08, 1.06, 0.52, sideMat, -0.28, 0.53, 0.02));
      bodyGroup.add(this.box(0.08, 1.06, 0.52, sideMat, 0.28, 0.53, 0.02));
      bodyGroup.add(this.box(0.64, 0.08, 0.58, bodyMat, 0, 1.02, 0));
      bodyGroup.add(this.box(0.64, 0.1, 0.58, this.getMat('#2f3538', { roughness: 0.7 }), 0, 0.05, 0));
      bodyGroup.add(this.box(0.48, 0.88, 0.06, interiorMat, 0, 0.54, -0.15, false, false));
      // Shelves & interior items
      bodyGroup.add(this.box(0.48, 0.04, 0.36, this.getMat('#6e8c99', { roughness: 0.4 }), 0, 0.46, 0));
      bodyGroup.add(this.box(0.48, 0.04, 0.36, this.getMat('#6e8c99', { roughness: 0.4 }), 0, 0.74, 0));
      bodyGroup.add(this.box(0.11, 0.18, 0.11, this.getMat('#58a6d1', { roughness: 0.25 }), -0.1, 0.57, 0.02));
      bodyGroup.add(this.box(0.12, 0.14, 0.12, this.getMat('#d9963b', { roughness: 0.4 }), 0.12, 0.28, 0.04));

      // Swinging pixel-textured front door pivoted on right edge (+0.3, +0.27)
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
      lidPivot.add(this.box(0.04, 0.2, 0.04, this.getMat('#c9d1d6', { roughness: 0.22, metalness: 0.85 }), -0.5, 0.84, 0.065));
      lidPivot.add(this.box(0.04, 0.24, 0.04, this.getMat('#c9d1d6', { roughness: 0.22, metalness: 0.85 }), -0.5, 0.44, 0.065));
      glintMesh.position.y = 1.24;
    } else {
      // Medical cabinet with pixel-art red cross door
      const cabMat = this.getMat('#e4ebe8', { roughness: 0.45, metalness: 0.1 });
      const shadeMat = this.getMat('#bcc7c2', { roughness: 0.5 });
      const frontMat = this.getMat(0xffffff, { map: this.atlas.medCabFrontTex, roughness: 0.42, metalness: 0.1 });

      this.addContactShadow(root, 0.72, 0.65);

      bodyGroup.add(this.box(0.54, 0.92, 0.1, shadeMat, 0, 0.46, -0.18));
      bodyGroup.add(this.box(0.07, 0.92, 0.42, shadeMat, -0.235, 0.46, 0.02));
      bodyGroup.add(this.box(0.07, 0.92, 0.42, shadeMat, 0.235, 0.46, 0.02));
      bodyGroup.add(this.box(0.54, 0.08, 0.46, cabMat, 0, 0.88, 0));
      bodyGroup.add(this.box(0.54, 0.08, 0.46, shadeMat, 0, 0.04, 0));
      bodyGroup.add(this.box(0.38, 0.04, 0.3, this.getMat('#8d9994'), 0, 0.48, 0));
      bodyGroup.add(this.box(0.12, 0.14, 0.1, this.getMat('#e6dfd3'), -0.08, 0.57, 0.02));
      bodyGroup.add(this.box(0.09, 0.16, 0.09, this.getMat('#d9483b'), 0.1, 0.24, 0.02));

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
      glintMesh.position.y = 1.12;
    }

    return { root, lidPivot, bodyGroup, glintMesh };
  }

  public createLootDropGroup(): THREE.Group {
    const g = new THREE.Group();
    this.addContactShadow(g, 0.62, 0.48);
    const packMat = this.getMat(0xffffff, { map: this.atlas.backpackTex, roughness: 0.88 });
    const tarpMat = this.getMat('#9e8a58', { roughness: 0.9 });
    const buckleMat = this.getMat('#f0c44d', { roughness: 0.25, metalness: 0.85, emissive: '#f0c44d', emissiveIntensity: 0.38 });

    g.add(this.box(0.46, 0.28, 0.34, packMat, 0, 0.14, 0));
    g.add(this.box(0.42, 0.11, 0.14, tarpMat, 0, 0.32, -0.08));
    g.add(this.box(0.08, 0.07, 0.04, buckleMat, -0.11, 0.18, 0.18, false, false));
    g.add(this.box(0.08, 0.07, 0.04, buckleMat, 0.11, 0.18, 0.18, false, false));
    return g;
  }

  public createPropGroup(kind: PropKind): THREE.Group {
    const g = new THREE.Group();

    if (kind === 'tree_pine') {
      this.addContactShadow(g, 1.35, 1.35);
      const barkMat = this.getMat(0xffffff, { map: this.atlas.barkTex, roughness: 0.94 });
      const leafMat = this.getMat(0xffffff, { map: this.atlas.pineTex, roughness: 0.88 });
      const leafDark = this.getMat('#1c2d1b', { roughness: 0.94 });

      // Flared pixel-bark trunk
      g.add(this.box(0.36, 0.22, 0.36, barkMat, 0, 0.11, 0));
      g.add(this.box(0.24, 0.86, 0.24, barkMat, 0, 0.55, 0));

      // Jagged layered pixel-art conifer tiers (crossed stepped clusters)
      const addTier = (y: number, w: number, h: number) => {
        g.add(this.box(w, h * 0.45, w * 0.72, leafDark, 0, y - h * 0.18, 0));
        g.add(this.box(w * 0.72, h * 0.45, w, leafDark, 0, y - h * 0.18, 0));
        g.add(this.box(w * 0.88, h * 0.78, w * 0.64, leafMat, 0, y + h * 0.1, 0));
        g.add(this.box(w * 0.64, h * 0.78, w * 0.88, leafMat, 0, y + h * 0.1, 0));
      };
      addTier(0.92, 1.24, 0.36);
      addTier(1.26, 1.0, 0.36);
      addTier(1.58, 0.72, 0.34);
      addTier(1.86, 0.46, 0.3);
      g.add(this.box(0.2, 0.24, 0.2, leafMat, 0, 2.08, 0));
      return g;
    }

    if (kind === 'tree_dead') {
      this.addContactShadow(g, 0.95, 0.95);
      const barkMat = this.getMat(0xffffff, { map: this.atlas.barkTex, roughness: 0.95 });
      const darkBark = this.getMat('#3d2a1d', { roughness: 0.95 });
      g.add(this.box(0.34, 0.22, 0.34, darkBark, 0, 0.11, 0));
      g.add(this.box(0.22, 1.15, 0.22, barkMat, 0, 0.65, 0));
      const b1 = this.box(0.12, 0.65, 0.12, barkMat, -0.24, 1.28, 0.08);
      b1.rotation.z = 0.65;
      const b2 = this.box(0.11, 0.62, 0.11, barkMat, 0.24, 1.32, -0.06);
      b2.rotation.z = -0.6;
      const b3 = this.box(0.09, 0.48, 0.09, darkBark, 0.05, 1.48, 0.2);
      b3.rotation.x = 0.58;
      const b4 = this.box(0.08, 0.4, 0.08, darkBark, -0.34, 1.56, 0.12);
      b4.rotation.z = 0.25;
      g.add(b1, b2, b3, b4);
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
      const base = this.getMat('#595f63', { roughness: 0.94 });
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
      this.addContactShadow(g, 1.08, 1.08);
      const canvasMat = this.getMat(0xffffff, { map: this.atlas.tentTex, roughness: 0.92 });
      const darkCanvas = this.getMat('#36402a', { roughness: 0.94 });
      const doorVoid = this.getMat('#151714', { roughness: 0.96 });
      const stake = this.getMat(0xffffff, { map: this.atlas.woodDarkTex, roughness: 0.9 });
      // Stepped A-frame pixel-art tent silhouette + dark entrance flap + ridge pole
      g.add(this.box(0.88, 0.24, 0.88, canvasMat, 0, 0.12, 0));
      g.add(this.box(0.68, 0.24, 0.86, canvasMat, 0, 0.36, 0));
      g.add(this.box(0.46, 0.22, 0.84, canvasMat, 0, 0.59, 0));
      g.add(this.box(0.24, 0.16, 0.82, darkCanvas, 0, 0.78, 0));
      g.add(this.box(0.08, 0.08, 0.94, stake, 0, 0.87, 0));
      g.add(this.box(0.32, 0.44, 0.05, doorVoid, 0, 0.22, 0.43, false, false));
      return g;
    }

    if (kind === 'rock_boulder') {
      this.addContactShadow(g, 0.94, 0.94);
      const rockMat = this.getMat(0xffffff, { map: this.atlas.rockTex, roughness: 0.94 });
      const darkRock = this.getMat('#44494d', { roughness: 0.96 });
      g.add(this.box(0.76, 0.32, 0.68, darkRock, 0, 0.16, 0));
      g.add(this.box(0.58, 0.26, 0.54, rockMat, -0.05, 0.42, 0.04));
      g.add(this.box(0.36, 0.18, 0.34, rockMat, -0.08, 0.60, 0.02));
      g.add(this.box(0.28, 0.22, 0.26, darkRock, 0.22, 0.22, -0.18));
      return g;
    }

    if (kind === 'fallen_log') {
      this.addContactShadow(g, 1.04, 0.62);
      const barkMat = this.getMat(0xffffff, { map: this.atlas.barkTex, roughness: 0.94 });
      const endMat = this.getMat(0xffffff, { map: this.atlas.woodOakTex, roughness: 0.88 });
      const mossMat = this.getMat('#3f5932', { roughness: 0.94 });
      g.add(this.box(0.88, 0.30, 0.32, [endMat, endMat, barkMat, barkMat, barkMat, barkMat], 0, 0.15, 0));
      g.add(this.box(0.52, 0.06, 0.22, mossMat, -0.10, 0.31, 0.02));
      const stub = this.box(0.18, 0.12, 0.12, barkMat, 0.24, 0.30, 0.14);
      stub.rotation.z = -0.45;
      g.add(stub);
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
      this.addContactShadow(g, 1.56, 1.04);
      const hullMat = this.getMat(0xffffff, { map: this.atlas.wreckedCarTex, roughness: 0.78, metalness: 0.42 });
      const charMat = this.getMat('#211f1e', { roughness: 0.94, metalness: 0.22 });
      const rustMat = this.getMat('#6b3922', { roughness: 0.86, metalness: 0.35 });
      const tireMat = this.getMat('#111315', { roughness: 0.92 });
      const rimMat = this.getMat('#544842', { roughness: 0.68, metalness: 0.55 });
      const glassMat = this.getMat('#222a30', { roughness: 0.32, metalness: 0.25 });

      g.rotation.y = 0.24;
      // Main lower body shell + charred front/rear bumpers
      g.add(this.box(1.26, 0.28, 0.72, hullMat, 0, 0.21, 0));
      g.add(this.box(0.08, 0.11, 0.76, charMat, 0.64, 0.14, 0));
      g.add(this.box(0.08, 0.11, 0.76, charMat, -0.64, 0.14, 0));

      // Four distinct burned-out wheels & rusted rims
      for (const wx of [-0.38, 0.38]) {
        for (const wz of [-0.34, 0.34]) {
          g.add(this.box(0.28, 0.28, 0.12, tireMat, wx, 0.14, wz));
          g.add(this.box(0.14, 0.14, 0.13, rimMat, wx, 0.14, wz, false, false));
        }
      }

      // Exposed engine bay & popped hood
      g.add(this.box(0.24, 0.14, 0.38, charMat, 0.40, 0.33, 0));
      const hood = this.box(0.38, 0.05, 0.64, rustMat, 0.42, 0.39, 0);
      hood.rotation.z = 0.22;
      g.add(hood);

      // Crushed cabin pillars, shattered dark interior & dented roof panel
      g.add(this.box(0.48, 0.22, 0.56, glassMat, -0.06, 0.46, 0));
      for (const px of [-0.28, 0.16]) {
        for (const pz of [-0.28, 0.28]) {
          g.add(this.box(0.07, 0.28, 0.07, rustMat, px, 0.49, pz));
        }
      }
      const roof = this.box(0.50, 0.06, 0.64, hullMat, -0.06, 0.63, 0);
      roof.rotation.z = -0.05;
      g.add(roof);

      // Slightly ajar rear trunk deck
      const trunk = this.box(0.26, 0.05, 0.64, rustMat, -0.49, 0.37, 0);
      trunk.rotation.z = -0.14;
      g.add(trunk);
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

    // Campfire
    this.addContactShadow(g, 0.96, 0.96);
    const stone = this.getMat('#6c737a', { roughness: 0.94 });
    const log = this.getMat(0xffffff, { map: this.atlas.barkTex, roughness: 0.9 });
    const ember = this.getMat('#e86a24', { emissive: '#e86a24', emissiveIntensity: 1.5, roughness: 0.7 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(this.box(0.16, 0.14, 0.16, stone, Math.cos(a) * 0.34, 0.07, Math.sin(a) * 0.34));
    }
    g.add(this.box(0.42, 0.05, 0.42, ember, 0, 0.03, 0, false, false));
    const l1 = this.box(0.56, 0.1, 0.1, log, 0, 0.1, 0);
    l1.rotation.y = 0.6;
    const l2 = this.box(0.56, 0.1, 0.1, log, 0, 0.12, 0);
    l2.rotation.y = -0.65;
    g.add(l1, l2);

    const flameGroup = new THREE.Group();
    flameGroup.position.set(0, 0.14, 0);
    flameGroup.add(
      this.box(0.24, 0.28, 0.24, this.getMat('#d64527', { emissive: '#d64527', emissiveIntensity: 1.4 }), 0, 0.14, 0, false, false),
      this.box(0.18, 0.42, 0.18, this.getMat('#f79520', { emissive: '#f79520', emissiveIntensity: 1.6 }), 0.02, 0.22, 0, false, false),
      this.box(0.1, 0.28, 0.1, this.getMat('#fff3b0', { emissive: '#fff3b0', emissiveIntensity: 1.9 }), 0, 0.16, 0, false, false)
    );
    g.add(flameGroup);
    g.userData.flameGroup = flameGroup;
    return g;
  }

  public createVehicleRig(kind: 'sedan' | 'police'): VehicleRig3D {
    const police = kind === 'police';
    const vTex = this.atlas.vehicleTex[kind];
    const root = new THREE.Group();
    this.addContactShadow(root, 2.05, 1.25);

    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    const sideMat = this.getMat(0xffffff, { map: vTex.side, roughness: 0.42, metalness: 0.28 });
    const roofMat = this.getMat(0xffffff, { map: vTex.roof, roughness: 0.38, metalness: 0.25 });
    const frontMat = this.getMat(0xffffff, { map: vTex.front, roughness: 0.45, metalness: 0.32 });
    const rearMat = this.getMat(0xffffff, { map: vTex.rear, roughness: 0.45, metalness: 0.32 });
    const glassMat = this.getMat(0xffffff, { map: vTex.glass, roughness: 0.14, metalness: 0.25 });
    const trim = this.getMat('#181c21', { roughness: 0.72, metalness: 0.35 });
    const tireMat = this.getMat('#101214', { roughness: 0.9 });
    const wheelFaceMat = this.getMat(0xffffff, { map: vTex.wheel, roughness: 0.45, metalness: 0.35 });
    const paintMain = this.getMat(police ? '#253145' : '#bf5e46', { roughness: 0.42, metalness: 0.28 });

    // Lower hull with pixel-art front grille, rear bumper/plate, side doors/badge & hood deck
    bodyGroup.add(
      this.box(1.66, 0.35, 0.86, [frontMat, rearMat, roofMat, trim, sideMat, sideMat], 0, 0.34, 0),
      this.box(1.74, 0.09, 0.9, trim, 0, 0.17, 0)
    );

    // Cab & pixel-art reflected windshields/windows (isolated into cabGroup so FPS cockpit hides interior glass)
    const cabGroup = new THREE.Group();
    cabGroup.add(
      this.box(0.88, 0.33, 0.76, [paintMain, paintMain, roofMat, trim, paintMain, paintMain], -0.05, 0.67, 0),
      this.box(0.9, 0.22, 0.66, glassMat, -0.05, 0.66, 0),
      this.box(0.68, 0.21, 0.78, glassMat, -0.05, 0.66, 0)
    );
    bodyGroup.add(cabGroup);

    // Side mirrors & exhaust pipe
    bodyGroup.add(
      this.box(0.08, 0.08, 0.08, trim, 0.32, 0.56, -0.45),
      this.box(0.08, 0.08, 0.08, trim, 0.32, 0.56, 0.45),
      this.box(0.14, 0.06, 0.06, this.getMat('#6e767d', { roughness: 0.3, metalness: 0.8 }), -0.86, 0.16, 0.24)
    );

    // Trunk lid hinged near cab rear (-0.48, 0.52, 0)
    const trunkPivot = new THREE.Group();
    trunkPivot.position.set(-0.48, 0.52, 0);
    trunkPivot.add(this.box(0.36, 0.06, 0.78, roofMat, -0.18, 0, 0));
    bodyGroup.add(trunkPivot);

    // Emissive Headlights & Taillights
    const headMat = this.getMat('#fff0a3', { emissive: '#fff0a3', emissiveIntensity: 1.3, roughness: 0.2 });
    bodyGroup.add(this.box(0.06, 0.1, 0.16, headMat, 0.84, 0.36, -0.28, false, false));
    bodyGroup.add(this.box(0.06, 0.1, 0.16, headMat, 0.84, 0.36, 0.28, false, false));

    const tailMatL = this.getMat('#eb4438', { emissive: '#eb4438', emissiveIntensity: 0.5, roughness: 0.25 });
    const tailMatR = tailMatL.clone();
    this.materials.push(tailMatR);
    const tl = this.box(0.06, 0.1, 0.16, tailMatL, -0.84, 0.36, -0.28, false, false);
    const tr = this.box(0.06, 0.1, 0.16, tailMatR, -0.84, 0.36, 0.28, false, false);
    bodyGroup.add(tl, tr);

    // Pixel-art wheels (hubcap faces on +Z / -Z)
    const wheelMats = [tireMat, tireMat, tireMat, tireMat, wheelFaceMat, wheelFaceMat];
    const makeWheel = () => this.box(0.36, 0.36, 0.14, wheelMats, 0, 0, 0);

    const wheelFL = new THREE.Group();
    wheelFL.position.set(0.52, 0.18, -0.44);
    const wFL = makeWheel();
    wheelFL.add(wFL);

    const wheelFR = new THREE.Group();
    wheelFR.position.set(0.52, 0.18, 0.44);
    const wFR = makeWheel();
    wheelFR.add(wFR);

    const wRL = makeWheel();
    wRL.position.set(-0.52, 0.18, -0.44);
    const wRR = makeWheel();
    wRR.position.set(-0.52, 0.18, 0.44);

    bodyGroup.add(wheelFL, wheelFR, wRL, wRR);

    let sirenRed: THREE.Mesh | undefined;
    let sirenBlue: THREE.Mesh | undefined;
    if (police) {
      cabGroup.add(this.box(0.14, 0.08, 0.56, trim, -0.02, 0.87, 0));
      const redMat = this.getMat('#ff5952', { emissive: '#ff5952', emissiveIntensity: 0.25, roughness: 0.2 }).clone();
      const blueMat = this.getMat('#5ea8ff', { emissive: '#5ea8ff', emissiveIntensity: 0.25, roughness: 0.2 }).clone();
      this.materials.push(redMat, blueMat);
      sirenRed = this.box(0.12, 0.09, 0.22, redMat, -0.02, 0.92, -0.16, false, false);
      sirenBlue = this.box(0.12, 0.09, 0.22, blueMat, -0.02, 0.92, 0.16, false, false);
      cabGroup.add(sirenRed, sirenBlue);
      cabGroup.add(this.box(0.12, 0.08, 0.12, this.getMat('#dce2e8', { roughness: 0.3 }), -0.02, 0.92, 0, false, false));
    }

    const glintMesh = this.box(
      0.09,
      0.09,
      0.09,
      this.getMat('#f0d078', { emissive: '#f0d078', emissiveIntensity: 0.9 }),
      -0.65,
      1.12,
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
      const steel = this.getMat(0xffffff, { map: wTex.crowbarSteel, roughness: 0.34, metalness: 0.78 });
      const darkSteel = this.getMat('#212529', { roughness: 0.5, metalness: 0.7 });
      const red = this.getMat(0xffffff, { map: wTex.crowbarRed, roughness: 0.48, metalness: 0.25 });
      g.add(this.box(0.46, 0.055, 0.055, steel, 0.22, 0, 0));
      g.add(this.box(0.47, 0.025, 0.064, darkSteel, 0.22, -0.02, 0));
      g.add(this.box(0.14, 0.065, 0.065, red, 0.01, 0, 0));
      const hook = this.box(0.15, 0.055, 0.055, red, 0.46, 0.05, 0);
      hook.rotation.z = 0.85;
      g.add(hook);
      const claw = this.box(0.06, 0.025, 0.058, steel, 0.52, 0.1, 0);
      claw.rotation.z = 0.35;
      g.add(claw);
    } else if (weapon === 'pistol') {
      const slide = this.getMat(0xffffff, { map: wTex.pistolSlide, roughness: 0.32, metalness: 0.82 });
      const frame = this.getMat('#363d44', { roughness: 0.48, metalness: 0.65 });
      const grip = this.getMat(0xffffff, { map: wTex.pistolGrip, roughness: 0.8 });
      const barrelTip = this.getMat('#1b1f24', { roughness: 0.35, metalness: 0.9 });
      const sightDot = this.getMat('#b8f58e', { emissive: '#8de065', emissiveIntensity: 0.7, roughness: 0.2 });
      g.add(this.box(0.28, 0.056, 0.066, slide, 0.14, 0.062, 0));
      g.add(this.box(0.24, 0.036, 0.056, frame, 0.12, 0.022, 0));
      g.add(this.box(0.08, 0.14, 0.056, grip, 0.04, -0.03, 0));
      g.add(this.box(0.02, 0.024, 0.024, barrelTip, 0.285, 0.058, 0));
      // Iron sights
      g.add(this.box(0.016, 0.014, 0.034, sightDot, 0.02, 0.094, 0, false, false));
      g.add(this.box(0.016, 0.016, 0.014, sightDot, 0.26, 0.095, 0, false, false));
    } else if (weapon === 'shotgun') {
      const barrel = this.getMat('#5a636b', { roughness: 0.32, metalness: 0.85 });
      const receiver = this.getMat('#32383e', { roughness: 0.42, metalness: 0.78 });
      const stock = this.getMat(0xffffff, { map: wTex.shotgunWood, roughness: 0.82 });
      const bead = this.getMat('#ffd266', { emissive: '#e8aa35', emissiveIntensity: 0.6, metalness: 0.8 });
      g.add(this.box(0.56, 0.044, 0.048, barrel, 0.3, 0.068, 0));
      g.add(this.box(0.42, 0.036, 0.044, barrel, 0.24, 0.03, 0));
      g.add(this.box(0.18, 0.072, 0.072, receiver, 0.12, 0.038, 0));
      g.add(this.box(0.24, 0.086, 0.074, stock, -0.02, 0.006, 0));
      g.add(this.box(0.19, 0.056, 0.076, stock, 0.3, 0.018, 0));
      g.add(this.box(0.022, 0.022, 0.022, bead, 0.56, 0.096, 0, false, false));
    } else {
      const glass = this.getMat(0xffffff, { map: wTex.molotovGlass, roughness: 0.24, metalness: 0.12 });
      const cloth = this.getMat('#e6dcc8', { roughness: 0.9 });
      const flame = this.getMat('#f59e27', { emissive: '#ffae38', emissiveIntensity: 1.7 });
      const coreFlame = this.getMat('#fff3b0', { emissive: '#fff3b0', emissiveIntensity: 2.0 });
      g.add(this.box(0.12, 0.18, 0.12, glass, 0.06, 0.05, 0));
      g.add(this.box(0.065, 0.06, 0.065, glass, 0.06, 0.16, 0));
      g.add(this.box(0.058, 0.07, 0.058, cloth, 0.06, 0.21, 0));
      const flameGroup = new THREE.Group();
      flameGroup.position.set(0.06, 0.26, 0);
      flameGroup.add(
        this.box(0.075, 0.095, 0.075, flame, 0, 0, 0, false, false),
        this.box(0.045, 0.065, 0.045, coreFlame, 0, 0.02, 0, false, false)
      );
      g.add(flameGroup);
      g.userData.molotovFlame = flameGroup;
    }
    return g;
  }

  public createActorRig(kind: 'player' | ZombieArchetype): ActorRig3D {
    const isPlayer = kind === 'player';
    const isBloater = kind === 'bloater';
    const hTex = this.atlas.actorHeadTex[kind];
    const tTex = this.atlas.actorTorsoTex[kind];
    const lTex = this.atlas.actorLimbTex[kind];

    let skinHex = '#d6ac88';
    let shirtHex = '#455b42';
    let pantsHex = '#323b45';

    if (kind === 'walker') {
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
    this.addContactShadow(root, isBloater ? 0.9 : 0.68, isBloater ? 0.9 : 0.68);

    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);

    // Legs with cuffed combat boots
    const legH = 0.32;
    const legSpread = isBloater ? 0.16 : 0.11;
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(0, legH, -legSpread);
    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0, legH, legSpread);

    const bootHiMat = makeActorMat('#382d28', 0.78);
    allMaterials.push(bootHiMat);
    flashMaterials.push(bootHiMat);

    const makeLeg = (pivot: THREE.Group) => {
      const l = this.box(0.13, 0.22, 0.13, pantsTexMat, 0, -0.11, 0);
      const cuff = this.box(0.15, 0.03, 0.14, bootHiMat, 0.01, -0.21, 0);
      const b = this.box(0.17, 0.1, 0.14, bootMat, 0.02, -0.27, 0);
      pivot.add(l, cuff, b);
      flashMeshes.push(l, cuff, b);
    };
    makeLeg(leftLegPivot);
    makeLeg(rightLegPivot);
    bodyPivot.add(leftLegPivot, rightLegPivot);

    // Pixel-art textured torso (+X front, -X back, sides)
    const torso = new THREE.Group();
    torso.position.set(0, legH, 0);
    bodyPivot.add(torso);

    const torsoW = isBloater ? 0.42 : 0.28;
    const torsoD = isBloater ? 0.56 : 0.38;
    const torsoH = isBloater ? 0.44 : 0.38;
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

    if (isPlayer) {
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
    } else if (kind === 'bloater') {
      const pustuleMat = makeActorMat('#c8ff59', 0.4, 0, undefined, '#9ed93b', 1.1);
      allMaterials.push(pustuleMat);
      torso.add(
        this.box(0.1, 0.14, 0.12, pustuleMat, torsoW * 0.48, 0.26, 0.12),
        this.box(0.1, 0.12, 0.1, pustuleMat, -0.1, 0.2, -torsoD * 0.46)
      );
    } else if (kind === 'spitter') {
      const spineMat = makeActorMat('#6ef7be', 0.35, 0.1, undefined, '#5ef2b5', 1.25);
      allMaterials.push(spineMat);
      torso.add(
        this.box(0.08, 0.1, 0.06, spineMat, -torsoW * 0.55, 0.3, 0),
        this.box(0.08, 0.1, 0.06, spineMat, -torsoW * 0.55, 0.15, 0)
      );
    }

    // Pixel-art textured Head (+X front face with goggles/eyes/jaw)
    const headPivot = new THREE.Group();
    headPivot.position.set(0, torsoH, 0);
    torso.add(headPivot);

    const headSize = isBloater ? 0.32 : 0.29;
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

    if (isPlayer) {
      const brimMat = makeActorMat('#2d3626', 0.88);
      allMaterials.push(brimMat);
      flashMaterials.push(brimMat);
      headPivot.add(
        this.box(0.08, 0.03, headSize + 0.02, brimMat, headSize * 0.5 + 0.035, headSize - 0.075, 0)
      );
    }

    // Arms
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(0, torsoH - 0.06, -(torsoD * 0.5 + 0.06));
    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0, torsoH - 0.06, torsoD * 0.5 + 0.06);

    const clawMat = makeActorMat('#a82828', 0.7);
    allMaterials.push(clawMat);
    flashMaterials.push(clawMat);

    const makeArm = (pivot: THREE.Group, isZombie: boolean) => {
      if (isZombie) {
        const a = this.box(0.32, 0.11, 0.11, sleeveTexMat, 0.14, 0, 0);
        const claw = this.box(0.07, 0.09, 0.09, clawMat, 0.3, 0, 0);
        pivot.add(a, claw);
        flashMeshes.push(a);
      } else {
        const sleeve = this.box(0.11, 0.2, 0.11, sleeveTexMat, 0, -0.08, 0);
        const hand = this.box(0.1, 0.1, 0.1, skinMat, 0, -0.22, 0);
        pivot.add(sleeve, hand);
        flashMeshes.push(sleeve, hand);
      }
    };
    makeArm(leftArmPivot, !isPlayer);
    makeArm(rightArmPivot, !isPlayer);
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
        pistol: this.createWeaponGroup('pistol'),
        shotgun: this.createWeaponGroup('shotgun'),
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
    const fingerMat = this.getMat('#d6ac88', { roughness: 0.85 });

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
      pistol: this.createWeaponGroup('pistol'),
      shotgun: this.createWeaponGroup('shotgun'),
      molotov: this.createWeaponGroup('molotov'),
    };
    weapons.crowbar.rotation.z = 0.2;
    weapons.pistol.position.set(0.02, 0.005, 0);
    weapons.shotgun.position.set(-0.02, 0.005, 0);
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
    this.materials = [];
    this.matCache.clear();
  }
}

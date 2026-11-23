import * as THREE from 'three';
import { PLANET_RADIUS_TILES } from './cubeSphere';
import type { BiomeKind, TileCell } from './types';

function hash2(gx: number, gy: number, salt: number): number {
  const n = Math.sin(gx * 127.1 + gy * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * 5-blade crossed tapered grass clump geometry: lush, full silhouette from both ISO & FPS angles
 * while keeping a single GPU instanced draw call per chunk.
 */
function buildCrossedGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const blades = [
    { angle: 0.12, tilt: 0.06, width: 0.115, height: 0.30, ox: 0.0, oz: 0.0 },
    { angle: 0.88, tilt: 0.08, width: 0.105, height: 0.35, ox: 0.03, oz: -0.02 },
    { angle: 1.62, tilt: 0.07, width: 0.10, height: 0.27, ox: -0.03, oz: 0.02 },
    { angle: 2.38, tilt: 0.09, width: 0.095, height: 0.33, ox: 0.02, oz: 0.03 },
    { angle: 3.04, tilt: 0.05, width: 0.105, height: 0.24, ox: -0.02, oz: -0.03 },
  ];

  const rootR = 0.38;
  const rootG = 0.44;
  const rootB = 0.34;
  const tipR = 1.0;
  const tipG = 1.0;
  const tipB = 0.92;

  for (let b = 0; b < blades.length; b++) {
    const bl = blades[b];
    const cosA = Math.cos(bl.angle);
    const sinA = Math.sin(bl.angle);
    const hw = bl.width * 0.5;
    const tw = bl.width * 0.16;

    const baseIdx = b * 4;
    positions.push(
      bl.ox - hw * cosA, 0, bl.oz - hw * sinA,
      bl.ox + hw * cosA, 0, bl.oz + hw * sinA,
      bl.ox + tw * cosA - bl.tilt * sinA, bl.height, bl.oz + tw * sinA + bl.tilt * cosA,
      bl.ox - tw * cosA - bl.tilt * sinA, bl.height, bl.oz - tw * sinA + bl.tilt * cosA
    );

    for (let v = 0; v < 4; v++) {
      normals.push(0, 1, 0);
    }

    colors.push(
      rootR, rootG, rootB,
      rootR, rootG, rootB,
      tipR, tipG, tipB,
      tipR, tipG, tipB
    );

    indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

// Biome-specific grass species color palettes
const MEADOW_TINTS = [
  new THREE.Color('#4f9438'),
  new THREE.Color('#62ad44'),
  new THREE.Color('#427d2f'),
  new THREE.Color('#7aba4a'),
  new THREE.Color('#8ec252'), // sunlit spring tip
];

const FOREST_FERN_TINTS = [
  new THREE.Color('#2c5c29'),
  new THREE.Color('#386e30'),
  new THREE.Color('#487a38'),
  new THREE.Color('#3e692c'),
];

const RIVER_REED_TINTS = [
  new THREE.Color('#3e7d4b'),
  new THREE.Color('#4f8f52'),
  new THREE.Color('#669948'),
  new THREE.Color('#346b44'),
];

const SCORCHED_SCRUB_TINTS = [
  new THREE.Color('#9c8644'),
  new THREE.Color('#b08d42'),
  new THREE.Color('#856e3a'),
  new THREE.Color('#7a783d'),
];

const COASTAL_DUNE_TINTS = [
  new THREE.Color('#b8ad68'),
  new THREE.Color('#9ba65b'),
  new THREE.Color('#c7ba75'),
  new THREE.Color('#889954'),
];

export class ThreeGrassSystem {
  public readonly geo: THREE.BufferGeometry;
  public readonly mat: THREE.MeshLambertMaterial;
  private windUniform = { value: 0 };
  private windStrengthUniform = { value: 1.0 };
  private curveOriginUniform = { value: new THREE.Vector3(0, 0, 0) };
  private curveStrengthUniform = { value: 0.04 };
  private planetRadiusUniform = { value: PLANET_RADIUS_TILES };

  private _pos = new THREE.Vector3();
  private _quat = new THREE.Quaternion();
  private _euler = new THREE.Euler();
  private _scale = new THREE.Vector3();
  private _mat4 = new THREE.Matrix4();

  constructor() {
    this.geo = buildCrossedGrassTuftGeometry();
    this.mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    this.mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windUniform;
      shader.uniforms.uWindStrength = this.windStrengthUniform;
      shader.uniforms.uCurveOrigin = this.curveOriginUniform;
      shader.uniforms.uCurveStrength = this.curveStrengthUniform;
      shader.uniforms.uPlanetRadius = this.planetRadiusUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uWindTime;
           uniform float uWindStrength;
           uniform vec3 uCurveOrigin;
           uniform float uCurveStrength;
           uniform float uPlanetRadius;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float bladeTip = clamp(position.y * 3.1, 0.0, 1.0);
           vec4 grassWorld = vec4(0.0, 0.0, 0.0, 1.0);
           #ifdef USE_INSTANCING
             grassWorld = instanceMatrix * grassWorld;
           #endif
           float sway = sin(uWindTime * 2.2 + grassWorld.x * 0.85 + grassWorld.z * 0.65)
                      + 0.45 * cos(uWindTime * 3.6 + grassWorld.x * 1.35 - grassWorld.z * 1.05);
           transformed.x += sway * 0.058 * uWindStrength * bladeTip * bladeTip;
           transformed.z += sway * 0.034 * uWindStrength * bladeTip * bladeTip;`
        )
        .replace(
          '#include <project_vertex>',
          `vec4 mvPosition = vec4( transformed, 1.0 );
           #ifdef USE_INSTANCING
             mvPosition = instanceMatrix * mvPosition;
           #endif
           vec4 gWorldPos = modelMatrix * mvPosition;
           float gCurveDist = max(0.0, length(gWorldPos.xz - uCurveOrigin.xz) - 22.0);
           gWorldPos.y -= (gCurveDist * gCurveDist) / (2.0 * uPlanetRadius) * 0.12 * uCurveStrength;
           mvPosition = viewMatrix * gWorldPos;
           gl_Position = projectionMatrix * mvPosition;`
        );
    };
    this.mat.customProgramCacheKey = () => 'ashfall_wind_grass_biome_v3';
  }

  public updateWind(elapsedClock: number, windStrength = 0.2): void {
    this.windUniform.value = elapsedClock;
    this.windStrengthUniform.value = 0.85 + windStrength * 1.35;
  }

  public updateCurvature(originX: number, originZ: number, strength: number): void {
    this.curveOriginUniform.value.set(originX, 0, originZ);
    this.curveStrengthUniform.value = strength;
  }

  public createChunkGrassMesh(
    getCell: (gx: number, gy: number) => TileCell,
    cx: number,
    cy: number,
    chunkSize: number,
    densityScale = 1,
    getHeight?: (x: number, z: number) => number,
    getBiome?: (gx: number, gy: number) => BiomeKind
  ): THREE.InstancedMesh | null {
    const startX = cx * chunkSize;
    const startY = cy * chunkSize;

    const placements: Array<{
      x: number;
      z: number;
      ry: number;
      sx: number;
      sy: number;
      color: THREE.Color;
    }> = [];

    for (let ly = 0; ly < chunkSize; ly++) {
      for (let lx = 0; lx < chunkSize; lx++) {
        const gx = startX + lx;
        const gy = startY + ly;
        const cell = getCell(gx, gy);

        const biome: BiomeKind = getBiome ? getBiome(gx, gy) : 'rural_meadow';
        const isGrass = cell.tile === 'grass';
        const isForest = cell.tile === 'forest_floor';
        const isCoastalSand = cell.tile === 'sand' && hash2(gx, gy, 91) > 0.62;
        const isScorchedDirt = biome === 'scorched_barrens' && cell.tile === 'dirt' && hash2(gx, gy, 77) > 0.45;
        const isRiverMud = biome === 'river_valley' && cell.tile === 'mud' && hash2(gx, gy, 53) > 0.35;

        if (!isGrass && !isForest && !isCoastalSand && !isScorchedDirt && !isRiverMud) continue;

        // Leave clean patches around solid man-made structures/walls/cars/crates
        const allowUnderProp =
          cell.prop === 'none' ||
          cell.prop === 'tree_pine' ||
          cell.prop === 'tree_dead' ||
          cell.prop === 'tree_oak' ||
          cell.prop === 'tree_willow' ||
          cell.prop === 'tree_palm' ||
          cell.prop === 'rock_boulder' ||
          cell.prop === 'fallen_log';
        if (!allowUnderProp) continue;

        // Biome-specific dense grass profiles (lush meadows, fern floors, tall river reeds, scrub, sea oats)
        let baseCount = 10;
        let palette = MEADOW_TINTS;
        let minSX = 0.88;
        let rangeSX = 0.48;
        let minSY = 0.88;
        let rangeSY = 0.62;

        if (isCoastalSand) {
          baseCount = 4;
          palette = COASTAL_DUNE_TINTS;
          minSX = 0.78;
          rangeSX = 0.38;
          minSY = 0.95;
          rangeSY = 0.62;
        } else if (biome === 'river_valley' || isRiverMud) {
          // Tall swaying riverbank reeds & wetland sedges
          baseCount = cell.prop === 'none' ? 9 : 4;
          palette = RIVER_REED_TINTS;
          minSX = 0.72;
          rangeSX = 0.34;
          minSY = 1.25;
          rangeSY = 0.78;
        } else if (biome === 'pine_forest' || isForest) {
          // Broad, low woodland ferns & deep emerald moss tufts
          baseCount = cell.prop === 'none' ? 8 : 4;
          palette = FOREST_FERN_TINTS;
          minSX = 1.05;
          rangeSX = 0.52;
          minSY = 0.68;
          rangeSY = 0.44;
        } else if (biome === 'scorched_barrens' || isScorchedDirt) {
          // Dry golden-amber & burnt-ochre steppe scrub grass
          baseCount = isScorchedDirt ? 3 : 5;
          palette = SCORCHED_SCRUB_TINTS;
          minSX = 0.75;
          rangeSX = 0.38;
          minSY = 0.55;
          rangeSY = 0.45;
        } else {
          // rural_meadow & town_edge: lush, thick emerald meadow carpet!
          baseCount = cell.prop === 'none' ? 11 : 5;
          palette = MEADOW_TINTS;
          minSX = 0.90;
          rangeSX = 0.48;
          minSY = 0.88;
          rangeSY = 0.64;
        }

        const count = Math.max(1, Math.round(baseCount * densityScale));

        for (let k = 0; k < count; k++) {
          const rx = hash2(gx, gy, k * 3 + 1);
          const rz = hash2(gx, gy, k * 3 + 2);
          const rr = hash2(gx, gy, k * 3 + 3);
          const px = gx + 0.06 + rx * 0.88;
          const pz = gy + 0.06 + rz * 0.88;

          if (cell.prop !== 'none' && Math.hypot(px - (gx + 0.5), pz - (gy + 0.5)) < 0.24) {
            continue;
          }

          const tint = palette[Math.floor(rr * palette.length) % palette.length];
          placements.push({
            x: px,
            z: pz,
            ry: rr * Math.PI * 2,
            sx: minSX + rx * rangeSX,
            sy: minSY + rz * rangeSY,
            color: tint,
          });
        }
      }
    }

    if (placements.length === 0) return null;

    const mesh = new THREE.InstancedMesh(this.geo, this.mat, placements.length);
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const py = getHeight ? getHeight(p.x, p.z) : 0;
      this._pos.set(p.x, py, p.z);
      this._euler.set(0, p.ry, 0);
      this._quat.setFromEuler(this._euler);
      this._scale.set(p.sx, p.sy, p.sx);
      this._mat4.compose(this._pos, this._quat, this._scale);
      mesh.setMatrixAt(i, this._mat4);
      mesh.setColorAt(i, p.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  public dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

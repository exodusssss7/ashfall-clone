import * as THREE from 'three';
import type { TileCell } from './types';

function hash2(gx: number, gy: number, salt: number): number {
  const n = Math.sin(gx * 127.1 + gy * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function buildCrossedGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // 3 crossed tapered blades forming a lush stylized pixel-art grass clump
  const blades = [
    { angle: 0.15, tilt: 0.05, width: 0.11, height: 0.28 },
    { angle: 1.22, tilt: 0.07, width: 0.10, height: 0.32 },
    { angle: 2.34, tilt: 0.06, width: 0.095, height: 0.25 },
  ];

  const rootR = 0.42;
  const rootG = 0.48;
  const rootB = 0.36;
  const tipR = 1.0;
  const tipG = 1.0;
  const tipB = 0.9;

  for (let b = 0; b < blades.length; b++) {
    const bl = blades[b];
    const cosA = Math.cos(bl.angle);
    const sinA = Math.sin(bl.angle);
    const hw = bl.width * 0.5;
    const tw = bl.width * 0.18;

    const baseIdx = b * 4;
    // Bottom left, bottom right, top right, top left
    positions.push(
      -hw * cosA, 0, -hw * sinA,
      hw * cosA, 0, hw * sinA,
      tw * cosA - bl.tilt * sinA, bl.height, tw * sinA + bl.tilt * cosA,
      -tw * cosA - bl.tilt * sinA, bl.height, -tw * sinA + bl.tilt * cosA
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

const GRASS_TINTS = [
  new THREE.Color('#4f8a38'),
  new THREE.Color('#5fa143'),
  new THREE.Color('#3f732d'),
  new THREE.Color('#75ab46'),
];

const FOREST_TINTS = [
  new THREE.Color('#37662d'),
  new THREE.Color('#457a36'),
  new THREE.Color('#5c7d3b'),
];

export class ThreeGrassSystem {
  public readonly geo: THREE.BufferGeometry;
  public readonly mat: THREE.MeshLambertMaterial;
  private windUniform = { value: 0 };

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
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uWindTime;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float bladeTip = clamp(position.y * 3.3, 0.0, 1.0);
           vec4 grassWorld = vec4(0.0, 0.0, 0.0, 1.0);
           #ifdef USE_INSTANCING
             grassWorld = instanceMatrix * grassWorld;
           #endif
           float sway = sin(uWindTime * 2.2 + grassWorld.x * 0.85 + grassWorld.z * 0.65)
                      + 0.45 * cos(uWindTime * 3.6 + grassWorld.x * 1.35 - grassWorld.z * 1.05);
           transformed.x += sway * 0.055 * bladeTip * bladeTip;
           transformed.z += sway * 0.032 * bladeTip * bladeTip;`
        );
    };
    this.mat.customProgramCacheKey = () => 'ashfall_wind_grass_v1';
  }

  public updateWind(elapsedClock: number): void {
    this.windUniform.value = elapsedClock;
  }

  public createChunkGrassMesh(
    getCell: (gx: number, gy: number) => TileCell,
    cx: number,
    cy: number,
    chunkSize: number,
    densityScale = 1
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

        const isGrass = cell.tile === 'grass';
        const isForest = cell.tile === 'forest_floor';
        if (!isGrass && !isForest) continue;

        // Leave clean patches around solid man-made structures/walls/cars/crates
        const allowUnderProp =
          cell.prop === 'none' ||
          cell.prop === 'tree_pine' ||
          cell.prop === 'tree_dead' ||
          cell.prop === 'rock_boulder' ||
          cell.prop === 'fallen_log';
        if (!allowUnderProp) continue;

        const baseCount = isGrass ? (cell.prop === 'none' ? 6 : 3) : cell.prop === 'none' ? 3 : 2;
        const count = Math.max(1, Math.round(baseCount * densityScale));

        for (let k = 0; k < count; k++) {
          const rx = hash2(gx, gy, k * 3 + 1);
          const rz = hash2(gx, gy, k * 3 + 2);
          const rr = hash2(gx, gy, k * 3 + 3);
          const px = gx + 0.1 + rx * 0.8;
          const pz = gy + 0.1 + rz * 0.8;

          // Keep tufts slightly off the center of trees/boulders
          if (cell.prop !== 'none' && Math.hypot(px - (gx + 0.5), pz - (gy + 0.5)) < 0.26) {
            continue;
          }

          const palette = isGrass ? GRASS_TINTS : FOREST_TINTS;
          const tint = palette[Math.floor(rr * palette.length) % palette.length];
          placements.push({
            x: px,
            z: pz,
            ry: rr * Math.PI * 2,
            sx: 0.78 + rx * 0.44,
            sy: (isGrass ? 0.75 : 0.65) + rz * 0.55,
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
      this._pos.set(p.x, 0, p.z);
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

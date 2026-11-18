import * as THREE from 'three';
import { clamp } from './isometric';
import type { AtmosphereLightingState } from './lighting';
import type { TileKind } from './types';

export const WATER_SURFACE_Y = 0.024;
export const MAX_WATER_RIPPLES = 12;
export const WATER_RIPPLE_LIFETIME = 1.65;
export const WATER_PIXEL_GRID = 16.0;

export interface WaterRippleEntry {
  x: number;
  z: number;
  startTime: number;
  strength: number;
}

function isDryLandTile(tile: TileKind): boolean {
  return tile !== 'water' && tile !== 'pier';
}

/**
 * Computes normalized distance-from-shore depth in [0, 1] for a water tile at (gx, gy).
 * Returns 0 for non-water tiles; ramps from ~0 at shore banks up to 1.0 in deep lake/river centers.
 * Piers and bridges over water do not count as dry shoreline so deep water flows cleanly underneath them.
 */
export function computeWaterShoreDepth(
  gx: number,
  gy: number,
  getCell: (x: number, y: number) => { tile: TileKind }
): number {
  if (getCell(gx, gy).tile !== 'water') return 0;

  let minLandDist = 3.2;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (isDryLandTile(getCell(gx + dx, gy + dy).tile)) {
        const d = Math.hypot(dx, dy);
        if (d < minLandDist) minLandDist = d;
      }
    }
  }

  return clamp((minLandDist - 0.85) / 1.75, 0.06, 1.0);
}

/**
 * Evaluates smoothed depth and shoreline contact mask at a grid vertex corner (vx, vy).
 */
function sampleCornerWaterAttributes(
  vx: number,
  vy: number,
  getCell: (x: number, y: number) => { tile: TileKind }
): { depth: number; shore: number } {
  let dryNeighbors = 0;
  let waterSum = 0;
  let waterCount = 0;

  for (let oy = -1; oy <= 0; oy++) {
    for (let ox = -1; ox <= 0; ox++) {
      const tile = getCell(vx + ox, vy + oy).tile;
      if (isDryLandTile(tile)) {
        dryNeighbors++;
      } else if (tile === 'water') {
        waterSum += computeWaterShoreDepth(vx + ox, vy + oy, getCell);
        waterCount++;
      }
    }
  }

  if (dryNeighbors > 0) {
    return { depth: 0.0, shore: 1.0 };
  }
  const avgDepth = waterCount > 0 ? waterSum / waterCount : 0.25;
  return { depth: clamp(avgDepth, 0.12, 1.0), shore: 0.0 };
}

/**
 * Builds a subdivided 2x2-per-tile water surface geometry covering only `tile === 'water'`
 * cells within chunk (cx, cy), carrying `aDepth` and `aShore` vertex attributes.
 * Returns null if the chunk contains no water tiles.
 */
export function buildChunkWaterGeometry(
  cx: number,
  cy: number,
  chunkSize: number,
  getCell: (x: number, y: number) => { tile: TileKind }
): THREE.BufferGeometry | null {
  const startX = cx * chunkSize;
  const startY = cy * chunkSize;

  const waterTiles: Array<{ gx: number; gy: number }> = [];
  for (let ly = 0; ly < chunkSize; ly++) {
    for (let lx = 0; lx < chunkSize; lx++) {
      const gx = startX + lx;
      const gy = startY + ly;
      if (getCell(gx, gy).tile === 'water') {
        waterTiles.push({ gx, gy });
      }
    }
  }

  if (waterTiles.length === 0) return null;

  // 2x2 sub-quads per water tile -> 4 quads * 2 triangles * 3 vertices = 24 vertices per tile
  const vertsPerTile = 24;
  const totalVerts = waterTiles.length * vertsPerTile;
  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const depths = new Float32Array(totalVerts);
  const shores = new Float32Array(totalVerts);

  let vIdx = 0;
  const pushVertex = (wx: number, wz: number, u: number, v: number, depth: number, shore: number) => {
    positions[vIdx * 3] = wx;
    positions[vIdx * 3 + 1] = WATER_SURFACE_Y;
    positions[vIdx * 3 + 2] = wz;
    uvs[vIdx * 2] = u;
    uvs[vIdx * 2 + 1] = v;
    depths[vIdx] = depth;
    shores[vIdx] = shore;
    vIdx++;
  };

  for (let i = 0; i < waterTiles.length; i++) {
    const { gx, gy } = waterTiles[i];
    const c00 = sampleCornerWaterAttributes(gx, gy, getCell);
    const c10 = sampleCornerWaterAttributes(gx + 1, gy, getCell);
    const c01 = sampleCornerWaterAttributes(gx, gy + 1, getCell);
    const c11 = sampleCornerWaterAttributes(gx + 1, gy + 1, getCell);

    const gridD = [
      [c00.depth, (c00.depth + c10.depth) * 0.5, c10.depth],
      [
        (c00.depth + c01.depth) * 0.5,
        (c00.depth + c10.depth + c01.depth + c11.depth) * 0.25,
        (c10.depth + c11.depth) * 0.5,
      ],
      [c01.depth, (c01.depth + c11.depth) * 0.5, c11.depth],
    ];
    const gridS = [
      [c00.shore, (c00.shore + c10.shore) * 0.5, c10.shore],
      [
        (c00.shore + c01.shore) * 0.5,
        (c00.shore + c10.shore + c01.shore + c11.shore) * 0.25,
        (c10.shore + c11.shore) * 0.5,
      ],
      [c01.shore, (c01.shore + c11.shore) * 0.5, c11.shore],
    ];

    for (let sy = 0; sy < 2; sy++) {
      for (let sx = 0; sx < 2; sx++) {
        const u0 = sx * 0.5;
        const u1 = (sx + 1) * 0.5;
        const v0 = sy * 0.5;
        const v1 = (sy + 1) * 0.5;
        const x0 = gx + u0;
        const x1 = gx + u1;
        const z0 = gy + v0;
        const z1 = gy + v1;

        const d00 = gridD[sy][sx];
        const d10 = gridD[sy][sx + 1];
        const d01 = gridD[sy + 1][sx];
        const d11 = gridD[sy + 1][sx + 1];

        const s00 = gridS[sy][sx];
        const s10 = gridS[sy][sx + 1];
        const s01 = gridS[sy + 1][sx];
        const s11 = gridS[sy + 1][sx + 1];

        // CCW winding facing +Y: (x0,z0) -> (x0,z1) -> (x1,z1), (x0,z0) -> (x1,z1) -> (x1,z0)
        pushVertex(x0, z0, x0, z0, d00, s00);
        pushVertex(x0, z1, x0, z1, d01, s01);
        pushVertex(x1, z1, x1, z1, d11, s11);

        pushVertex(x0, z0, x0, z0, d00, s00);
        pushVertex(x1, z1, x1, z1, d11, s11);
        pushVertex(x1, z0, x1, z0, d10, s10);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
  geo.setAttribute('aShore', new THREE.BufferAttribute(shores, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Fixed-capacity ring buffer of interactive water ripples (wading wakes, bullet splashes, fishing bobber).
 */
export class WaterRippleBuffer {
  private readonly entries: WaterRippleEntry[];
  private writeIndex = 0;

  constructor(capacity = MAX_WATER_RIPPLES) {
    this.entries = Array.from({ length: capacity }, () => ({
      x: 0,
      z: 0,
      startTime: -999,
      strength: 0,
    }));
  }

  public clear(): void {
    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i].strength = 0;
      this.entries[i].startTime = -999;
    }
    this.writeIndex = 0;
  }

  public push(x: number, z: number, elapsedClock: number, strength = 1.0): void {
    // Coalesce near-simultaneous ripples at the same spot so standing wakes don't starve impact rings
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.strength > 0 && elapsedClock - e.startTime < 0.14) {
        const dx = e.x - x;
        const dz = e.z - z;
        if (dx * dx + dz * dz < 0.18) {
          if (strength > e.strength) {
            e.x = x;
            e.z = z;
            e.startTime = elapsedClock;
            e.strength = clamp(strength, 0.1, 1.5);
          }
          return;
        }
      }
    }

    const slot = this.entries[this.writeIndex];
    slot.x = x;
    slot.z = z;
    slot.startTime = elapsedClock;
    slot.strength = clamp(strength, 0.1, 1.5);
    this.writeIndex = (this.writeIndex + 1) % this.entries.length;
  }

  public packUniforms(elapsedClock: number, out: THREE.Vector4[]): void {
    for (let i = 0; i < out.length && i < this.entries.length; i++) {
      const e = this.entries[i];
      const age = elapsedClock - e.startTime;
      if (e.strength > 0 && age >= 0 && age < WATER_RIPPLE_LIFETIME) {
        out[i].set(e.x, e.z, age, e.strength);
      } else {
        out[i].set(0, 0, 99, 0);
      }
    }
  }

  public getActiveCount(elapsedClock: number): number {
    let count = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const age = elapsedClock - e.startTime;
      if (e.strength > 0 && age >= 0 && age < WATER_RIPPLE_LIFETIME) {
        count++;
      }
    }
    return count;
  }
}

export interface PixelWaterMaterialUniforms {
  uTime: { value: number };
  uSkyZenith: { value: THREE.Color };
  uSkyHorizon: { value: THREE.Color };
  uCloudColor: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uMoonDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uNightFactor: { value: number };
  uDawnFactor: { value: number };
  uDuskFactor: { value: number };
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
  uFlashlightOn: { value: number };
  uFlashlightPos: { value: THREE.Vector3 };
  uFlashlightDir: { value: THREE.Vector3 };
  uIsFps: { value: number };
  uRipples: { value: THREE.Vector4[] };
}

export function createPixelWaterMaterial(): {
  material: THREE.ShaderMaterial;
  uniforms: PixelWaterMaterialUniforms;
} {
  const rippleVecs = Array.from({ length: MAX_WATER_RIPPLES }, () => new THREE.Vector4(0, 0, 99, 0));
  const uniforms: PixelWaterMaterialUniforms = {
    uTime: { value: 0 },
    uSkyZenith: { value: new THREE.Color('#2b6cb0') },
    uSkyHorizon: { value: new THREE.Color('#bfe0ed') },
    uCloudColor: { value: new THREE.Color('#fcfcf7') },
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, -0.5).normalize() },
    uMoonDir: { value: new THREE.Vector3(-0.4, 0.4, 0.5).normalize() },
    uSunColor: { value: new THREE.Color('#ffefd2') },
    uNightFactor: { value: 0 },
    uDawnFactor: { value: 0 },
    uDuskFactor: { value: 0 },
    uFogColor: { value: new THREE.Color('#7ca3bf') },
    uFogDensity: { value: 0.0085 },
    uFlashlightOn: { value: 0 },
    uFlashlightPos: { value: new THREE.Vector3(0, 1.3, 0) },
    uFlashlightDir: { value: new THREE.Vector3(1, -0.1, 0).normalize() },
    uIsFps: { value: 0 },
    uRipples: { value: rippleVecs },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      attribute float aDepth;
      attribute float aShore;
      uniform float uTime;

      varying vec3 vWorldPos;
      varying float vDepth;
      varying float vShore;
      varying float vFogDepth;

      void main() {
        vec3 pos = position;
        float waveDamp = 1.0 - aShore * 0.85;
        float bob = sin(pos.x * 2.1 + uTime * 2.2) * cos(pos.z * 1.9 - uTime * 1.7);
        pos.y += bob * 0.009 * (0.3 + aDepth * 0.7) * waveDamp;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vec4 mvPos = viewMatrix * worldPos;
        vWorldPos = worldPos.xyz;
        vDepth = aDepth;
        vShore = aShore;
        vFogDepth = -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSkyZenith;
      uniform vec3 uSkyHorizon;
      uniform vec3 uCloudColor;
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform vec3 uSunColor;
      uniform float uNightFactor;
      uniform float uDawnFactor;
      uniform float uDuskFactor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uFlashlightOn;
      uniform vec3 uFlashlightPos;
      uniform vec3 uFlashlightDir;
      uniform float uIsFps;
      uniform vec4 uRipples[${MAX_WATER_RIPPLES}];

      varying vec3 vWorldPos;
      varying float vDepth;
      varying float vShore;
      varying float vFogDepth;

      float hash21(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float sampleWaveHeight(vec2 p) {
        float w1 = sin(p.x * 3.1 + p.y * 1.4 + uTime * 2.15);
        float w2 = cos(p.x * 1.7 - p.y * 3.4 - uTime * 1.75);
        float w3 = sin((p.x + p.y) * 5.2 - uTime * 2.9) * 0.45;
        float n = (valueNoise(p * 1.85 + vec2(uTime * 0.28, -uTime * 0.18)) - 0.5) * 1.4;
        return (w1 + w2) * 0.35 + w3 * 0.3 + n * 0.4;
      }

      void main() {
        // Snap world coordinates onto a crisp 16x16 pixel-art grid per tile
        vec2 pxPos = floor(vWorldPos.xz * ${WATER_PIXEL_GRID.toFixed(1)}) / ${WATER_PIXEL_GRID.toFixed(1)};
        float pxStep = ${ (1 / WATER_PIXEL_GRID).toFixed(4) };

        float hC = sampleWaveHeight(pxPos);
        float hX = sampleWaveHeight(pxPos + vec2(pxStep, 0.0));
        float hZ = sampleWaveHeight(pxPos + vec2(0.0, pxStep));

        // Interactive wake, fishing bobber & projectile splash ripple contributions
        float rippleBreak = 0.55 + 0.45 * valueNoise(pxPos * 6.5 + vec2(uTime * 0.8, -uTime * 0.6));
        float rippleFoam = 0.0;
        float rippleSlopeX = 0.0;
        float rippleSlopeZ = 0.0;
        for (int i = 0; i < ${MAX_WATER_RIPPLES}; i++) {
          vec4 r = uRipples[i];
          if (r.w > 0.01 && r.z < ${WATER_RIPPLE_LIFETIME.toFixed(2)}) {
            vec2 delta = pxPos - r.xy;
            float d = length(delta);
            float ageNorm = r.z / ${WATER_RIPPLE_LIFETIME.toFixed(2)};
            float radius = 0.12 + r.z * 1.65;
            float ringDist = d - radius;
            float band = exp(-ringDist * ringDist * 10.5);
            float fade = pow(1.0 - ageNorm, 1.35) * r.w;
            float crest = sin(ringDist * 18.0) * band * fade;
            float arcMask = step(0.26, crest * rippleBreak);
            rippleFoam += arcMask * clamp(crest * 1.15, 0.0, 0.72);
            vec2 dir = delta / max(d, 0.05);
            float dCrest = cos(ringDist * 18.0) * band * fade * 0.48;
            rippleSlopeX += dir.x * dCrest;
            rippleSlopeZ += dir.y * dCrest;
          }
        }

        float dhdx = (hX - hC) * 1.45 + rippleSlopeX * 0.85;
        float dhdz = (hZ - hC) * 1.45 + rippleSlopeZ * 0.85;
        vec3 N = normalize(vec3(-dhdx * 0.34, 1.0, -dhdz * 0.34));

        // Stepped pixel-art wave bands & subtle caustic shimmer in shallows
        float waveQuant = floor((hC + 1.0) * 3.0) / 3.0;
        float caustic = smoothstep(0.52, 0.84, valueNoise(pxPos * 4.2 + vec2(uTime * 0.48, uTime * 0.34)));

        // Shallow -> mid -> deep coastal palette harmonized across Dawn / Day / Dusk / Night
        vec3 dayShallow = vec3(0.24, 0.64, 0.73);
        vec3 dayMid     = vec3(0.14, 0.44, 0.57);
        vec3 dayDeep    = vec3(0.08, 0.27, 0.39);

        vec3 nightShallow = vec3(0.08, 0.20, 0.30);
        vec3 nightMid     = vec3(0.05, 0.13, 0.22);
        vec3 nightDeep    = vec3(0.03, 0.08, 0.15);

        vec3 shallowCol = mix(dayShallow, nightShallow, uNightFactor);
        vec3 midCol     = mix(dayMid, nightMid, uNightFactor);
        vec3 deepCol    = mix(dayDeep, nightDeep, uNightFactor);

        vec3 warmAtmoTint = mix(vec3(0.35, 0.47, 0.52), vec3(0.46, 0.36, 0.45), uDuskFactor);
        float atmoMix = clamp(uDawnFactor * 0.4 + uDuskFactor * 0.45, 0.0, 0.55);
        shallowCol = mix(shallowCol, warmAtmoTint * 1.15, atmoMix * 0.62);
        midCol = mix(midCol, warmAtmoTint * 0.84, atmoMix * 0.52);

        float midT = smoothstep(0.08, 0.50, vDepth);
        float deepT = smoothstep(0.42, 0.95, vDepth);
        vec3 waterCol = mix(shallowCol, midCol, midT);
        waterCol = mix(waterCol, deepCol, deepT);

        // Stepped surface wave tint & underwater shallow caustics
        waterCol += vec3(0.05, 0.09, 0.11) * (waveQuant - 0.5) * (1.0 - uNightFactor * 0.55);
        waterCol += vec3(0.14, 0.28, 0.30) * caustic * (1.0 - deepT) * (1.0 - uNightFactor * 0.75) * 0.65;

        // Fresnel sky + broken drifting pixel cloud shimmer (avoiding large opaque white blobs)
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 R = reflect(-V, N);
        float ndotv = max(dot(N, V), 0.0);
        float fresnel = clamp(0.12 + 0.72 * pow(1.0 - ndotv, 2.6), 0.0, 0.78);
        float skyGrad = clamp(R.y * 0.85 + 0.14, 0.0, 1.0);
        vec3 skyRefl = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.85, skyGrad));

        vec2 reflCloudUv = pxPos * 0.55 + N.xz * 1.9 + vec2(uTime * 0.07, uTime * 0.03);
        float cloudReflNoise = valueNoise(floor(reflCloudUv * 5.0) / 5.0);
        float cloudReflMask = smoothstep(0.58, 0.80, cloudReflNoise) * (1.0 - uNightFactor * 0.88);
        skyRefl = mix(skyRefl, uCloudColor, cloudReflMask * 0.22);

        float reflWeight = mix(fresnel * 0.62, clamp(0.16 + fresnel * 0.40, 0.0, 0.52), 1.0 - uIsFps);
        waterCol = mix(waterCol, skyRefl, reflWeight * (0.68 + 0.32 * vDepth));

        // Crisp sun & moon specular glints (gated inside directional reflection lobes + delicate wave twinkles)
        vec3 sunDir = normalize(uSunDir);
        float sunVis = (1.0 - smoothstep(0.60, 0.92, uNightFactor)) * smoothstep(-0.04, 0.1, sunDir.y);
        float sunDot = max(dot(R, sunDir), 0.0);
        float sunSparkNoise = valueNoise(pxPos * 9.0 + vec2(uTime * 0.9, -uTime * 0.7));
        float sunLobe = pow(sunDot, 16.0);
        float sunSpec = smoothstep(0.28, 0.68, sunLobe * (0.62 + max(hC, 0.0) * 0.65 + sunSparkNoise * 0.55));
        float sunTwinkle = step(0.84, max(hC, 0.0) * 0.52 + sunSparkNoise * 0.48) * 0.20;
        vec3 sunGlintCol = mix(uSunColor, vec3(1.0, 0.97, 0.86), 0.48);
        waterCol += sunGlintCol * (sunSpec * 0.62 + sunTwinkle) * sunVis;

        vec3 moonDir = normalize(uMoonDir);
        float moonVis = smoothstep(0.28, 0.78, uNightFactor) * smoothstep(-0.04, 0.1, moonDir.y);
        float moonDot = max(dot(R, moonDir), 0.0);
        float moonLobe = pow(moonDot, 22.0);
        float moonSpec = smoothstep(0.28, 0.68, moonLobe * (0.62 + max(hC, 0.0) * 0.65 + sunSparkNoise * 0.55));
        float moonTwinkle = step(0.86, max(hC, 0.0) * 0.52 + sunSparkNoise * 0.48) * 0.14;
        waterCol += vec3(0.76, 0.88, 1.0) * (moonSpec * 0.55 + moonTwinkle) * moonVis;

        // Player flashlight reflection & wet-wave shimmer cone
        if (uFlashlightOn > 0.5) {
          vec3 toWater = vec3(pxPos.x, 0.04, pxPos.y) - uFlashlightPos;
          float distF = length(toWater);
          if (distF < 18.0) {
            vec3 fDir = normalize(uFlashlightDir);
            vec3 wDir = toWater / max(distF, 0.05);
            float cone = smoothstep(0.66, 0.93, dot(wDir, fDir));
            float atten = 1.0 - smoothstep(2.5, 17.5, distF);
            float waveSparkle = 0.45 + 0.55 * step(0.28, hC * 0.6 + sunSparkNoise * 0.45);
            vec3 flashH = normalize(normalize(uFlashlightPos - vWorldPos) + V);
            float specF = smoothstep(0.62, 0.86, dot(N, flashH));
            waterCol += vec3(0.98, 0.93, 0.76) * cone * atten * (0.44 * waveSparkle + 0.56 * specF) * (0.42 + uNightFactor * 0.95);
          }
        }

        // Dynamic lapping shoreline foam + broken wake ripple crests
        float foamNoise = valueNoise(pxPos * 5.2 + vec2(uTime * 0.55, -uTime * 0.42));
        float bankDetail = valueNoise(pxPos * 8.5 - vec2(uTime * 0.25, uTime * 0.35));
        float lapWave = 0.5 + 0.5 * sin(uTime * 2.8 - vDepth * 17.0 + foamNoise * 4.2);
        float shoreBand = smoothstep(0.30, 0.01, vDepth) * max(vShore * 0.78, 1.0 - vDepth * 3.4);
        float shoreFoam = step(0.54, shoreBand * (0.55 + foamNoise * 0.62) * (0.52 + lapWave * 0.68));
        float edgeContactFoam = smoothstep(0.80, 0.98, vShore) * step(0.46, bankDetail * 0.65 + lapWave * 0.42);
        float crestSpark = step(0.80, hC * 0.7 + sunSparkNoise * 0.35) * (1.0 - uNightFactor * 0.68) * 0.26;

        vec3 shoreFoamCol = mix(vec3(0.90, 0.97, 0.98), vec3(0.36, 0.48, 0.60), uNightFactor);
        shoreFoamCol = mix(shoreFoamCol, vec3(0.98, 0.82, 0.68), (uDawnFactor + uDuskFactor) * 0.45);
        vec3 rippleTintCol = mix(vec3(0.76, 0.94, 0.98), vec3(0.46, 0.64, 0.78), uNightFactor);

        float shoreMask = clamp(max(shoreFoam, edgeContactFoam) + crestSpark, 0.0, 1.0);
        float rippleMask = clamp(rippleFoam, 0.0, 0.72);
        waterCol = mix(waterCol, shoreFoamCol, shoreMask * 0.76);
        waterCol = mix(waterCol, rippleTintCol, rippleMask * 0.58);

        // Translucent near shore so submerged sandy pebbles show through, richer in deep centers
        float baseAlpha = mix(0.46, 0.90, smoothstep(0.0, 0.72, vDepth));
        float alpha = clamp(max(baseAlpha, max(shoreMask * 0.85, rippleMask * 0.75)), 0.40, 0.94);

        // Synchronized scene FogExp2 distance blend
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
        waterCol = mix(waterCol, uFogColor, clamp(fogFactor, 0.0, 1.0));

        gl_FragColor = vec4(waterCol, alpha);
      }
    `,
  });

  return { material, uniforms };
}

export function syncPixelWaterUniforms(
  uniforms: PixelWaterMaterialUniforms,
  params: {
    elapsedClock: number;
    atmo: AtmosphereLightingState;
    isFps: boolean;
    fogDensity: number;
    flashlightOn: boolean;
    flashlightPos: THREE.Vector3;
    flashlightDir: THREE.Vector3;
    ripples: WaterRippleBuffer;
  }
): void {
  uniforms.uTime.value = params.elapsedClock;
  uniforms.uSkyZenith.value.copy(params.atmo.skyZenith);
  uniforms.uSkyHorizon.value.copy(params.atmo.skyHorizon);
  uniforms.uCloudColor.value.copy(params.atmo.cloudTop);
  uniforms.uSunDir.value.copy(params.atmo.sunDir);
  uniforms.uMoonDir.value.copy(params.atmo.moonDir);
  uniforms.uSunColor.value.copy(params.atmo.sunColor);
  uniforms.uNightFactor.value = params.atmo.nightT;
  uniforms.uDawnFactor.value = params.atmo.dawnT;
  uniforms.uDuskFactor.value = params.atmo.duskT;
  uniforms.uFogColor.value.copy(params.isFps ? params.atmo.fpsFogColor : params.atmo.isoFogColor);
  uniforms.uFogDensity.value = params.fogDensity;
  uniforms.uIsFps.value = params.isFps ? 1 : 0;
  uniforms.uFlashlightOn.value = params.flashlightOn ? 1 : 0;
  if (params.flashlightOn) {
    uniforms.uFlashlightPos.value.copy(params.flashlightPos);
    uniforms.uFlashlightDir.value.copy(params.flashlightDir);
  }
  params.ripples.packUniforms(params.elapsedClock, uniforms.uRipples.value);
}

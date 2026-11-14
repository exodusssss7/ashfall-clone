import * as THREE from 'three';
import { clamp } from './isometric';
import type { AtmosphereLightingState } from './lighting';

interface CloudDef {
  baseX: number;
  baseZ: number;
  y: number;
  speed: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  puffOffsets: Array<{ dx: number; dy: number; dz: number; sx: number; sy: number; sz: number }>;
}

const CLOUD_COUNT = 34;
const CLOUD_SPAN = 160;

export class SkyCloudDome {
  public readonly group = new THREE.Group();
  private domeMesh: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private cloudInstanced: THREE.InstancedMesh;
  private cloudMat: THREE.MeshBasicMaterial;
  private clouds: CloudDef[] = [];
  private totalPuffs = 0;

  private _tmpColor = new THREE.Color();
  private _mat4 = new THREE.Matrix4();
  private _pos = new THREE.Vector3();
  private _quat = new THREE.Quaternion();
  private _scale = new THREE.Vector3();

  constructor() {
    const domeGeo = new THREE.SphereGeometry(165, 24, 16);
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color('#3a6ea5') },
        uMid: { value: new THREE.Color('#6f9ec4') },
        uHorizon: { value: new THREE.Color('#b6cad4') },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, -0.5).normalize() },
        uMoonDir: { value: new THREE.Vector3(-0.4, 0.4, 0.5).normalize() },
        uNightFactor: { value: 0 },
        uDawnFactor: { value: 0 },
        uDuskFactor: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocalDir;
        void main() {
          vLocalDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uMoonDir;
        uniform float uNightFactor;
        uniform float uDawnFactor;
        uniform float uDuskFactor;
        uniform float uTime;
        varying vec3 vLocalDir;

        float hash21(vec2 p) {
          p = fract(p * vec2(234.34, 435.345));
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

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 3; i++) {
            v += a * valueNoise(p);
            p *= 2.04;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vLocalDir);
          float h = clamp(dir.y, -0.15, 1.0);
          float lowT = smoothstep(-0.02, 0.24, h);
          float highT = smoothstep(0.18, 0.85, h);

          vec3 sky = mix(uHorizon, uMid, lowT);
          sky = mix(sky, uZenith, highT);

          // Subtle painted distant cloud wisps near the upper horizon
          if (dir.y > 0.02) {
            vec2 cloudUv = dir.xz / (dir.y + 0.22) * 1.45 + vec2(uTime * 0.012, uTime * 0.004);
            float n = fbm(cloudUv);
            float band = smoothstep(0.48, 0.82, n) * smoothstep(0.02, 0.2, dir.y) * (1.0 - smoothstep(0.55, 0.92, dir.y));
            vec3 wispCol = mix(vec3(0.95, 0.96, 0.98), vec3(0.96, 0.66, 0.45), uDuskFactor);
            wispCol = mix(wispCol, vec3(1.0, 0.85, 0.72), uDawnFactor);
            wispCol = mix(wispCol, vec3(0.18, 0.24, 0.36), uNightFactor * (1.0 - uDawnFactor * 0.5));
            sky = mix(sky, wispCol, band * 0.48);
          }

          // Sun disc + corona + dawn/dusk horizon atmospheric scatter
          float sunAmt = max(dot(dir, normalize(uSunDir)), 0.0);
          float sunVis = (1.0 - smoothstep(0.65, 0.95, uNightFactor)) * smoothstep(-0.06, 0.05, uSunDir.y);
          float horizonBand = 1.0 - smoothstep(0.0, 0.36, max(dir.y, 0.0));
          vec3 scatterCol = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.78, 0.52), uDawnFactor);
          sky += scatterCol * pow(sunAmt, 3.0) * horizonBand * (uDawnFactor * 0.42 + uDuskFactor * 0.38);

          vec3 sunGlowCol = mix(vec3(1.0, 0.93, 0.78), vec3(1.0, 0.56, 0.26), uDuskFactor);
          sunGlowCol = mix(sunGlowCol, vec3(1.0, 0.82, 0.56), uDawnFactor);
          sky += sunGlowCol * pow(sunAmt, 12.0) * (0.38 + uDawnFactor * 0.24) * sunVis;
          sky += vec3(1.0, 0.97, 0.88) * smoothstep(0.9962, 0.9988, sunAmt) * 1.35 * sunVis;

          // Moon disc + subtle halo at night
          float moonAmt = max(dot(dir, normalize(uMoonDir)), 0.0);
          float moonVis = smoothstep(0.25, 0.75, uNightFactor) * smoothstep(-0.05, 0.08, uMoonDir.y);
          sky += vec3(0.55, 0.70, 0.95) * pow(moonAmt, 36.0) * 0.28 * moonVis;
          sky += vec3(0.88, 0.93, 1.0) * smoothstep(0.9978, 0.9992, moonAmt) * 0.95 * moonVis;

          // Crisp pixel stars fading gently at dawn
          if (uNightFactor > 0.22 && dir.y > 0.08) {
            vec2 starGrid = floor(dir.xz / (dir.y + 0.38) * 68.0);
            float starRand = hash21(starGrid);
            if (starRand > 0.984) {
              float twinkle = 0.6 + 0.4 * sin(uTime * 2.5 + starRand * 90.0);
              float fade = smoothstep(0.08, 0.3, dir.y) * smoothstep(0.22, 0.78, uNightFactor) * (1.0 - uDawnFactor * 0.45);
              sky += vec3(0.82, 0.89, 1.0) * twinkle * fade * 0.85;
            }
          }

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    this.domeMesh = new THREE.Mesh(domeGeo, this.domeMat);
    this.domeMesh.frustumCulled = false;
    this.domeMesh.renderOrder = -100;
    this.group.add(this.domeMesh);

    // Build stylized 3D pixel-cluster clouds (InstancedMesh for single draw call)
    const seeded = (n: number) => {
      const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const puffOffsets: CloudDef['puffOffsets'] = [];
      const puffCount = 5 + Math.floor(seeded(i * 11 + 1) * 3);
      for (let p = 0; p < puffCount; p++) {
        const t = puffCount > 1 ? p / (puffCount - 1) - 0.5 : 0;
        const arch = 1 - Math.abs(t) * 1.1;
        puffOffsets.push({
          dx: t * (5.2 + seeded(i * 17 + p) * 2.6),
          dy: arch * (0.9 + seeded(i * 23 + p) * 1.0),
          dz: (seeded(i * 29 + p) - 0.5) * 2.6,
          sx: 3.1 + arch * 2.4 + seeded(i * 31 + p) * 1.3,
          sy: 1.05 + arch * 1.2,
          sz: 2.6 + arch * 1.5 + seeded(i * 37 + p) * 1.1,
        });
      }
      this.totalPuffs += puffOffsets.length;
      const isHorizonTier = i < Math.floor(CLOUD_COUNT * 0.55);
      this.clouds.push({
        baseX: (seeded(i * 3 + 1) - 0.5) * CLOUD_SPAN,
        baseZ: (seeded(i * 3 + 2) - 0.5) * CLOUD_SPAN,
        y: isHorizonTier
          ? 12.5 + seeded(i * 3 + 3) * 6.5
          : 19.5 + seeded(i * 3 + 3) * 9.5,
        speed: (isHorizonTier ? 0.28 : 0.42) + seeded(i * 5 + 4) * 0.42,
        scaleX: (isHorizonTier ? 1.05 : 0.9) + seeded(i * 7 + 5) * 0.72,
        scaleY: 0.8 + seeded(i * 7 + 6) * 0.48,
        scaleZ: (isHorizonTier ? 1.0 : 0.88) + seeded(i * 7 + 7) * 0.65,
        puffOffsets,
      });
    }

    const puffGeo = new THREE.BoxGeometry(1, 1, 1);
    this.cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.86,
      fog: false,
      depthWrite: false,
    });
    this.cloudInstanced = new THREE.InstancedMesh(puffGeo, this.cloudMat, this.totalPuffs);
    this.cloudInstanced.frustumCulled = false;
    this.cloudInstanced.castShadow = false;
    this.cloudInstanced.receiveShadow = false;
    this.cloudInstanced.renderOrder = -50;
    this.group.add(this.cloudInstanced);
  }

  public update(
    targetX: number,
    targetZ: number,
    atmo: AtmosphereLightingState,
    elapsedClock: number,
    isFps: boolean
  ): void {
    this.group.visible = isFps;
    if (!isFps) return;

    this.domeMesh.position.set(targetX, 0, targetZ);

    this.domeMat.uniforms.uZenith.value.copy(atmo.skyZenith);
    this.domeMat.uniforms.uMid.value.copy(atmo.skyMid);
    this.domeMat.uniforms.uHorizon.value.copy(atmo.skyHorizon);
    this.domeMat.uniforms.uNightFactor.value = atmo.nightT;
    this.domeMat.uniforms.uDawnFactor.value = atmo.dawnT;
    this.domeMat.uniforms.uDuskFactor.value = atmo.duskT;
    this.domeMat.uniforms.uTime.value = elapsedClock;
    this.domeMat.uniforms.uSunDir.value.copy(atmo.sunDir);
    this.domeMat.uniforms.uMoonDir.value.copy(atmo.moonDir);

    this.cloudMat.opacity = 0.86 - atmo.nightT * 0.28 + atmo.dawnT * 0.06;
    this._quat.identity();

    const halfSpan = CLOUD_SPAN * 0.5;
    let idx = 0;
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      const wrappedX =
        ((((c.baseX + elapsedClock * c.speed - targetX) % CLOUD_SPAN) + CLOUD_SPAN + halfSpan) % CLOUD_SPAN) -
        halfSpan;
      const wrappedZ =
        ((((c.baseZ + elapsedClock * c.speed * 0.22 - targetZ) % CLOUD_SPAN) + CLOUD_SPAN + halfSpan) % CLOUD_SPAN) -
        halfSpan;

      const worldX = targetX + wrappedX;
      const worldZ = targetZ + wrappedZ;

      for (let p = 0; p < c.puffOffsets.length; p++) {
        const puff = c.puffOffsets[p];
        this._pos.set(
          worldX + puff.dx * c.scaleX,
          c.y + puff.dy * c.scaleY,
          worldZ + puff.dz * c.scaleZ
        );
        this._scale.set(
          puff.sx * c.scaleX,
          puff.sy * c.scaleY,
          puff.sz * c.scaleZ
        );
        this._mat4.compose(this._pos, this._quat, this._scale);
        this.cloudInstanced.setMatrixAt(idx, this._mat4);

        const shadeT = clamp(0.35 + puff.dy * 0.35, 0, 1);
        this._tmpColor.copy(atmo.cloudBottom).lerp(atmo.cloudTop, shadeT);
        this.cloudInstanced.setColorAt(idx, this._tmpColor);
        idx++;
      }
    }
    this.cloudInstanced.count = idx;
    this.cloudInstanced.instanceMatrix.needsUpdate = true;
    if (this.cloudInstanced.instanceColor) {
      this.cloudInstanced.instanceColor.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.domeMesh.geometry.dispose();
    this.domeMat.dispose();
    this.cloudInstanced.geometry.dispose();
    this.cloudMat.dispose();
  }
}

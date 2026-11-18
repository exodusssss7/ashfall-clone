import * as THREE from 'three';
import type { ZombieArchetype } from './types';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function gauss(x: number, mu: number, sigma: number): number {
  const d = (x - mu) / Math.max(1e-5, sigma);
  return Math.exp(-0.5 * d * d);
}

function gauss2(a: number, ma: number, sa: number, b: number, mb: number, sb: number): number {
  const da = (a - ma) / Math.max(1e-5, sa);
  const db = (b - mb) / Math.max(1e-5, sb);
  return Math.exp(-0.5 * (da * da + db * db));
}

export interface SkullMetrics {
  /** Center offset relative to headPivot */
  centerY: number;
  centerX: number;
  /** Front lip/maxilla position for saliva & mouth anchoring */
  mouthFrontX: number;
  mouthUpperY: number;
  /** Eye socket world-offset relative to headPivot */
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  eyeRadius: number;
  /** Upper dental arch radii */
  jawWidth: number;
  jawLength: number;
}

export function getSkullMetrics(archetype: ZombieArchetype): SkullMetrics {
  switch (archetype) {
    case 'runner':
      return {
        centerY: 0.155,
        centerX: 0.02,
        mouthFrontX: 0.148,
        mouthUpperY: 0.07,
        eyeX: 0.128,
        eyeY: 0.164,
        eyeZ: 0.042,
        eyeRadius: 0.017,
        jawWidth: 0.142,
        jawLength: 0.124,
      };
    case 'bloater':
      return {
        centerY: 0.178,
        centerX: 0.012,
        mouthFrontX: 0.156,
        mouthUpperY: 0.068,
        eyeX: 0.138,
        eyeY: 0.188,
        eyeZ: 0.052,
        eyeRadius: 0.02,
        jawWidth: 0.194,
        jawLength: 0.134,
      };
    case 'spitter':
      return {
        centerY: 0.162,
        centerX: 0.016,
        mouthFrontX: 0.138,
        mouthUpperY: 0.068,
        eyeX: 0.118,
        eyeY: 0.17,
        eyeZ: 0.041,
        eyeRadius: 0.018,
        jawWidth: 0.146,
        jawLength: 0.116,
      };
    case 'walker':
    default:
      return {
        centerY: 0.16,
        centerX: 0.012,
        mouthFrontX: 0.13,
        mouthUpperY: 0.07,
        eyeX: 0.114,
        eyeY: 0.168,
        eyeZ: 0.041,
        eyeRadius: 0.017,
        jawWidth: 0.144,
        jawLength: 0.112,
      };
  }
}

/**
 * Average vertex normals along the periodic seam (col 0 === col uSteps)
 * so wrapped cylindrical/spherical meshes have zero lighting crease at u=0/1.
 */
function weldPeriodicGridNormals(
  geo: THREE.BufferGeometry,
  uSteps: number,
  vSteps: number
): void {
  geo.computeVertexNormals();
  const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const cols = uSteps + 1;
  const vTmp = new THREE.Vector3();
  const vB = new THREE.Vector3();

  // Blend periodic horizontal seam (col 0 and col uSteps)
  for (let row = 0; row <= vSteps; row++) {
    const i0 = row * cols;
    const i1 = row * cols + uSteps;
    vTmp.set(norm.getX(i0), norm.getY(i0), norm.getZ(i0));
    vB.set(norm.getX(i1), norm.getY(i1), norm.getZ(i1));
    vTmp.add(vB);
    if (vTmp.lengthSq() > 1e-8) {
      vTmp.normalize();
      norm.setXYZ(i0, vTmp.x, vTmp.y, vTmp.z);
      norm.setXYZ(i1, vTmp.x, vTmp.y, vTmp.z);
    }
  }

  // Average top & bottom pole rings (row 0 and row vSteps) so poles shade smoothly
  for (const row of [0, vSteps]) {
    vTmp.set(0, 0, 0);
    for (let col = 0; col < uSteps; col++) {
      const idx = row * cols + col;
      vTmp.x += norm.getX(idx);
      vTmp.y += norm.getY(idx);
      vTmp.z += norm.getZ(idx);
    }
    if (vTmp.lengthSq() > 1e-8) {
      vTmp.normalize();
      for (let col = 0; col <= uSteps; col++) {
        const idx = row * cols + col;
        norm.setXYZ(idx, vTmp.x, vTmp.y, vTmp.z);
      }
    }
  }
  norm.needsUpdate = true;
}

/**
 * Sculpts a low-poly organic skull (+X forward, +Y up, +/-Z sides) with rounded
 * cranial dome, projecting supraorbital brow ridge, carved zygomatic cheekbones,
 * deeply concave orbital sockets, nasal bridge/cavity, upper maxilla arch,
 * and unique silhouette proportions per zombie archetype.
 */
export function createSculptedSkullGeometry(archetype: ZombieArchetype): THREE.BufferGeometry {
  const uSteps = 18;
  const vSteps = 11;
  const cols = uSteps + 1;
  const vertCount = cols * (vSteps + 1);

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  const m = getSkullMetrics(archetype);

  // Balanced organic cranial ellipsoid radii (broad domed braincase, zero pinched coneheads)
  const baseRx =
    archetype === 'bloater' ? 0.142 : archetype === 'runner' ? 0.128 : archetype === 'spitter' ? 0.12 : 0.118;
  const baseRy =
    archetype === 'bloater' ? 0.146 : archetype === 'runner' ? 0.114 : archetype === 'spitter' ? 0.124 : 0.122;
  const baseRz =
    archetype === 'bloater' ? 0.148 : archetype === 'runner' ? 0.108 : archetype === 'spitter' ? 0.11 : 0.114;

  for (let row = 0; row <= vSteps; row++) {
    const vNorm = 1 - row / vSteps; // 1 at top crown, 0 at base
    const phi = (row / vSteps) * Math.PI; // 0 = crown (+Y), PI = base (-Y)
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    // Keep upper cranial vault & forehead broad and rounded rather than tapering to a point
    const domeSinP = cosP > 0 ? Math.pow(sinP, 0.82) : sinP;

    for (let col = 0; col <= uSteps; col++) {
      const uNorm = col / uSteps;
      // theta = 0 faces +X (front face), +/-PI is -X (back of skull)
      const theta = (uNorm - 0.5) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Unit sphere direction (broad upper braincase)
      const dx = domeSinP * cosT;
      const dy = cosP;
      const dz = domeSinP * sinT;
      const az = Math.abs(dz);

      // Start with base cranial ellipsoid
      let x = dx * baseRx;
      let y = dy * baseRy;
      let z = dz * baseRz;

      // 1. Occipital cranial vault bulge (rounded back-top braincase)
      const vaultMask = smoothstep(-0.15, 0.55, dy) * smoothstep(0.25, -0.55, dx);
      x -= 0.014 * vaultMask;
      y += 0.006 * vaultMask;

      // Narrow lower occiput cleanly into neck stalk without squashing upper face
      const lowerBackTaper = smoothstep(-0.22, -0.82, dy) * smoothstep(0.2, -0.55, dx);
      z *= 1 - 0.28 * lowerBackTaper;
      y += 0.014 * lowerBackTaper;

      // 2. Front facial sculpting & forward maxilla projection
      const frontMask = smoothstep(-0.1, 0.55, dx);
      // Maxilla (upper jaw horseshoe arch) protrudes forward and narrows smoothly toward teeth rim
      const maxillaMask = smoothstep(0.15, 0.72, dx) * smoothstep(-0.08, -0.7, dy);
      const maxillaZPinch = smoothstep(0.05, 0.72, az) * smoothstep(-0.05, -0.7, dy) * frontMask;
      x += (archetype === 'runner' ? 0.028 : archetype === 'spitter' ? 0.022 : 0.016) * maxillaMask;
      z *= 1 - 0.26 * maxillaZPinch;
      // Gentle palate recess so hinged lower jaw tucks seamlessly underneath
      if (dy < -0.58) {
        const palateCut = smoothstep(-0.58, -0.96, dy);
        y += 0.014 * palateCut * smoothstep(-0.2, 0.6, dx);
      }

      // 3. Supraorbital brow ridge + angry glabella furrow
      const brow =
        gauss(dy, 0.26, 0.12) *
        smoothstep(0.28, 0.78, dx) *
        (1 - smoothstep(0.58, 0.92, az));
      const glabellaDip = gauss(az, 0, 0.14) * gauss(dy, 0.24, 0.11) * smoothstep(0.5, 0.9, dx);
      const browBoost = archetype === 'runner' ? 0.022 : archetype === 'bloater' ? 0.018 : 0.018;
      x += brow * browBoost;
      y -= glabellaDip * 0.007;

      // 4. Deep concave orbital eye sockets (left and right of nasal bridge)
      const eyeMaskL = gauss2(dz, -0.35, 0.17, dy, 0.06, 0.15) * smoothstep(0.35, 0.78, dx);
      const eyeMaskR = gauss2(dz, 0.35, 0.17, dy, 0.06, 0.15) * smoothstep(0.35, 0.78, dx);
      const eyeSocket = Math.max(eyeMaskL, eyeMaskR);
      x -= eyeSocket * (archetype === 'bloater' ? 0.024 : 0.028);

      // 5. Zygomatic cheekbones & sunken temporal/buccal hollows (kept below parietal dome)
      const cheekMask =
        (gauss2(dz, -0.56, 0.2, dy, -0.1, 0.16) + gauss2(dz, 0.56, 0.2, dy, -0.1, 0.16)) *
        smoothstep(0.08, 0.65, dx);
      x += cheekMask * (archetype === 'walker' ? 0.018 : archetype === 'runner' ? 0.02 : 0.014);
      z += Math.sign(dz) * cheekMask * (archetype === 'bloater' ? 0.015 : 0.012);

      const templeHollow =
        (gauss2(dz, -0.84, 0.16, dy, 0.08, 0.16) + gauss2(dz, 0.84, 0.16, dy, 0.08, 0.16)) *
        smoothstep(-0.2, 0.45, dx) *
        (1 - smoothstep(0.35, 0.72, dy));
      const buccalHollow =
        (gauss2(dz, -0.62, 0.18, dy, -0.36, 0.18) + gauss2(dz, 0.62, 0.18, dy, -0.36, 0.18)) *
        smoothstep(-0.1, 0.6, dx);

      if (archetype === 'walker' || archetype === 'runner') {
        const gauntAmt = archetype === 'walker' ? 0.011 : 0.009;
        z -= Math.sign(dz) * (templeHollow * gauntAmt + buccalHollow * gauntAmt * 1.35);
      }

      // 6. Nasal bridge ridge & torn piriform nasal recess
      const nasalBridge = gauss(az, 0, 0.11) * gauss(dy, 0.08, 0.13) * smoothstep(0.62, 0.94, dx);
      const nasalHole = gauss(az, 0, 0.14) * gauss(dy, -0.14, 0.11) * smoothstep(0.68, 0.95, dx);
      x += nasalBridge * 0.015 - nasalHole * 0.017;

      // 7. Archetype-specific organic cranial silhouette shaping
      let boneLesion = 0;
      let bruiseTint = 0;
      let infectGlowTint = 0;

      if (archetype === 'walker') {
        // Gaunt asymmetric skull + concave parietal skull wound exposing pale bone
        const wound = gauss2(dz, -0.45, 0.24, dy, 0.52, 0.22) * smoothstep(-0.2, 0.55, dx);
        x -= wound * 0.006;
        y -= wound * 0.008;
        boneLesion = smoothstep(0.32, 0.72, wound);
        // Subtle asymmetric cheek slump
        y -= 0.005 * smoothstep(0.2, 0.8, dz) * smoothstep(0, -0.6, dy);
      } else if (archetype === 'runner') {
        // Swept-back predatory cranium + flared snout/nostril ridge
        const sweep = smoothstep(0.1, 0.8, dy);
        x -= sweep * 0.016;
        // Flared cheek/jaw muscles for snarling silhouette
        const snarl = gauss(dy, -0.22, 0.14) * smoothstep(0.35, 0.88, dx);
        x += snarl * 0.014;
        bruiseTint = smoothstep(0.2, 0.8, maxillaMask) * 0.55;
      } else if (archetype === 'bloater') {
        // Asymmetrical tumorous cranial lobes + sagging lower jowls
        const tumorLobe1 = gauss2(dz, -0.58, 0.28, dy, 0.34, 0.26) * smoothstep(-0.5, 0.5, dx);
        const tumorLobe2 = gauss2(dz, 0.52, 0.26, dy, -0.05, 0.24) * smoothstep(-0.1, 0.7, dx);
        const tumorLobe3 = gauss2(dz, 0.18, 0.28, dy, 0.62, 0.24);
        const jowlSag = smoothstep(-0.1, -0.65, dy) * smoothstep(0.35, 0.85, az);
        x += (tumorLobe1 * 0.018 + tumorLobe2 * 0.022 + tumorLobe3 * 0.01) * Math.sign(dx || 1);
        y += tumorLobe3 * 0.014 - jowlSag * 0.016;
        z += Math.sign(dz) * (tumorLobe1 * 0.02 + tumorLobe2 * 0.022 + jowlSag * 0.02);
        infectGlowTint = clamp01(tumorLobe1 * 0.8 + tumorLobe2 * 0.9 + tumorLobe3 * 0.6);
      } else if (archetype === 'spitter') {
        // Subtle anatomical frontal crest (fading before top pole) + lateral cheek/throat venom sacs
        const crest =
          gauss(az, 0, 0.22) *
          smoothstep(0.15, 0.55, dy) *
          (1 - smoothstep(0.75, 0.96, dy)) *
          smoothstep(-0.4, 0.55, dx);
        y += crest * 0.008;
        const cheekSac =
          (gauss2(dz, -0.74, 0.22, dy, -0.34, 0.22) + gauss2(dz, 0.74, 0.22, dy, -0.34, 0.22)) *
          smoothstep(-0.05, 0.65, dx);
        z += Math.sign(dz) * cheekSac * 0.036;
        y -= cheekSac * 0.01;
        infectGlowTint = clamp01(cheekSac * 0.9 + crest * 0.45);
      }

      const idx = row * cols + col;
      positions[idx * 3] = x + m.centerX;
      positions[idx * 3 + 1] = y + m.centerY;
      positions[idx * 3 + 2] = z;

      uvs[idx * 2] = uNorm;
      uvs[idx * 2 + 1] = vNorm;

      // Anatomical vertex AO + localized gore/bone tint (cleanly preserves wet-skin shader contrast)
      const baseAo =
        1.0 -
        eyeSocket * 0.74 -
        nasalHole * 0.68 -
        buccalHollow * 0.26 -
        templeHollow * 0.18 -
        smoothstep(-0.35, -0.92, dy) * 0.34;
      const ao = clamp(baseAo + brow * 0.08 + cheekMask * 0.06, 0.18, 1.0);

      let cr = ao;
      let cg = ao;
      let cb = ao;
      if (boneLesion > 0.01) {
        cr = cr * (1 - boneLesion * 0.3) + 0.95 * boneLesion * 0.3;
        cg = cg * (1 - boneLesion * 0.3) + 0.89 * boneLesion * 0.3;
        cb = cb * (1 - boneLesion * 0.3) + 0.76 * boneLesion * 0.3;
      }
      if (bruiseTint > 0.01) {
        cr = clamp01(cr + bruiseTint * 0.14);
        cg = clamp01(cg * (1 - bruiseTint * 0.42));
        cb = clamp01(cb * (1 - bruiseTint * 0.44));
      }
      if (infectGlowTint > 0.01) {
        if (archetype === 'bloater') {
          cr = clamp01(cr + infectGlowTint * 0.12);
          cg = clamp01(cg + infectGlowTint * 0.24);
          cb = clamp01(cb * (1 - infectGlowTint * 0.25));
        } else if (archetype === 'spitter') {
          cr = clamp01(cr * (1 - infectGlowTint * 0.32));
          cg = clamp01(cg + infectGlowTint * 0.26);
          cb = clamp01(cb + infectGlowTint * 0.18);
        }
      }

      colors[idx * 3] = cr;
      colors[idx * 3 + 1] = cg;
      colors[idx * 3 + 2] = cb;
    }
  }

  for (let row = 0; row < vSteps; row++) {
    for (let col = 0; col < uSteps; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = (row + 1) * cols + col;
      const d = c + 1;
      // Outward CCW winding when theta increases from -PI -> +PI around +Y and phi increases +Y -> -Y
      if (row > 0) indices.push(a, b, c);
      if (row < vSteps - 1) indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  weldPeriodicGridNormals(geo, uSteps, vSteps);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Sculpts a curved horseshoe / U-shaped lower mandible hinged around local origin
 * (jawPivot), leaving an open mouth cavity inside the arch and rounded chin contour.
 */
export function createSculptedJawGeometry(archetype: ZombieArchetype): THREE.BufferGeometry {
  const m = getSkullMetrics(archetype);
  const archSteps = 10; // left condyle -> chin -> right condyle
  const tubeSteps = 6;  // rounded hexagonal/oval bone cross-section
  const rows = archSteps + 1;
  const cols = tubeSteps + 1;
  const vertCount = rows * cols;

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  const halfW = m.jawWidth * 0.44;
  const len = m.jawLength * 0.92;
  const chinDrop = archetype === 'bloater' ? -0.044 : archetype === 'runner' ? -0.042 : -0.038;

  for (let r = 0; r <= archSteps; r++) {
    const t = r / archSteps; // 0 = left (-Z) back condyle, 0.5 = front chin, 1 = right (+Z) back condyle
    const ang = (t - 0.5) * Math.PI; // -PI/2 -> 0 -> +PI/2
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);

    // Centerline point along the curved jawbone arch hugging tightly under cheekbones
    const archSharpness = archetype === 'runner' || archetype === 'spitter' ? 1.15 : archetype === 'bloater' ? 0.92 : 1.04;
    const cx = Math.pow(cosA, archSharpness) * len;
    const cz = sinA * halfW;
    const cy = Math.abs(sinA) * 0.018 + cosA * chinDrop;

    // Sleek anatomical mandible bone cross-section (no bulky donut collar)
    const thickLat = (archetype === 'bloater' ? 0.017 : 0.012) * (0.8 + 0.3 * cosA);
    const heightVert = (archetype === 'bloater' ? 0.022 : 0.017) * (0.85 + 0.28 * cosA);

    // Outward normal in XZ plane of the U-arch
    const outX = cosA;
    const outZ = sinA;

    for (let c = 0; c <= tubeSteps; c++) {
      const ct = c / tubeSteps;
      const phi = ct * Math.PI * 2;
      const radOut = Math.cos(phi);
      const radUp = Math.sin(phi);

      const idx = r * cols + c;
      positions[idx * 3] = cx + outX * radOut * thickLat;
      positions[idx * 3 + 1] = cy + radUp * heightVert;
      positions[idx * 3 + 2] = cz + outZ * radOut * thickLat;

      uvs[idx * 2] = t;
      uvs[idx * 2 + 1] = ct;

      // Darken inside of mouth arch (radOut < 0) and underside of chin (radUp < 0)
      const innerAo = radOut < 0 ? 0.48 : 1.0;
      const underAo = radUp < -0.25 ? 0.72 : 1.0;
      const ao = clamp(innerAo * underAo, 0.34, 1.0);
      colors[idx * 3] = ao;
      colors[idx * 3 + 1] = ao;
      colors[idx * 3 + 2] = ao;
    }
  }

  for (let r = 0; r < archSteps; r++) {
    for (let c = 0; c < tubeSteps; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      indices.push(a, b, d);
      indices.push(b, e, d);
    }
  }

  // Cap both condyle ends cleanly facing outward (-X at both rear condyles)
  const addEndCap = (ringStart: number, outwardFlip: boolean) => {
    for (let c = 1; c < tubeSteps - 1; c++) {
      const a = ringStart;
      const b = ringStart + c;
      const d = ringStart + c + 1;
      if (outwardFlip) indices.push(a, b, d);
      else indices.push(a, d, b);
    }
  };
  addEndCap(0, false);
  addEndCap(archSteps * cols, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Generates a compact curved arc of jagged low-poly teeth along +X/-Z..+Z dental arch.
 */
export function createCurvedTeethRowGeometry(opts: {
  radiusX: number;
  radiusZ: number;
  count: number;
  toothHeight: number;
  toothRadius: number;
  upper: boolean;
}): THREE.BufferGeometry {
  const { radiusX, radiusZ, count, toothHeight, toothRadius, upper } = opts;
  const trisPerTooth = 3; // 3-sided pyramid fang = ultra low-poly yet razor-sharp
  const positions = new Float32Array(count * trisPerTooth * 3 * 3);
  const colors = new Float32Array(count * trisPerTooth * 3 * 3);
  let write = 0;

  const pushTri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    baseShade: number,
    tipShade: number
  ) => {
    const pts = [
      [ax, ay, az, baseShade],
      [bx, by, bz, baseShade],
      [cx, cy, cz, tipShade],
    ];
    for (const [px, py, pz, s] of pts) {
      positions[write * 3] = px;
      positions[write * 3 + 1] = py;
      positions[write * 3 + 2] = pz;
      colors[write * 3] = s;
      colors[write * 3 + 1] = s * 0.96;
      colors[write * 3 + 2] = s * 0.86;
      write++;
    }
  };

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const ang = (t - 0.5) * Math.PI * 0.82;
    const cx = Math.cos(ang) * radiusX;
    const cz = Math.sin(ang) * radiusZ;
    // Slightly longer fangs near the corners (canines)
    const canineBoost = Math.abs(t - 0.5) > 0.22 && Math.abs(t - 0.5) < 0.4 ? 1.32 : 0.92 + ((i * 37) % 10) * 0.025;
    const h = toothHeight * canineBoost * (upper ? -1 : 1);
    const r = toothRadius;

    // 3 base corners around tooth base
    const basePts: Array<[number, number, number]> = [];
    for (let k = 0; k < 3; k++) {
      const a = ang + (k / 3) * Math.PI * 2;
      basePts.push([cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r]);
    }
    const tipX = cx + Math.cos(ang) * r * 0.35;
    const tipY = h;
    const tipZ = cz + Math.sin(ang) * r * 0.35;

    for (let k = 0; k < 3; k++) {
      const p0 = basePts[k];
      const p1 = basePts[(k + 1) % 3];
      if (upper) {
        pushTri(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], tipX, tipY, tipZ, 0.58, 1.0);
      } else {
        pushTri(p1[0], p1[1], p1[2], p0[0], p0[1], p0[2], tipX, tipY, tipZ, 0.58, 1.0);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export interface LoftRingSpec {
  y: number;
  rx: number;
  rz: number;
  offsetX?: number;
  offsetZ?: number;
  /** Optional sagittal/chest/back shaping: positive pushes front (+X) slightly more rounded, negative pulls waist/spine */
  chestPinch?: number;
  /** Anatomical AO multiplier [0..1] for this ring */
  ao?: number;
}

/**
 * Parametric organic radial loft along +Y for rounded zombie torsos, limbs, necks, and boots.
 * Zero 4-sided cuboid corners; averages periodic seam normals for smooth organic highlights.
 */
export function createOrganicLoftGeometry(
  rings: ReadonlyArray<LoftRingSpec>,
  radialSegments = 10,
  capEnds = true
): THREE.BufferGeometry {
  const ringCount = rings.length;
  const cols = radialSegments + 1;
  const totalRingVerts = ringCount * cols;
  const capVertCount = capEnds ? 2 : 0;
  const vertCount = totalRingVerts + capVertCount;

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  const yMin = rings[0].y;
  const ySpan = Math.max(1e-4, rings[ringCount - 1].y - yMin);

  for (let r = 0; r < ringCount; r++) {
    const spec = rings[r];
    const v = clamp01((spec.y - yMin) / ySpan);
    const ox = spec.offsetX ?? 0;
    const oz = spec.offsetZ ?? 0;
    const pinch = spec.chestPinch ?? 0;
    const ringAo = spec.ao ?? 1.0;

    for (let c = 0; c <= radialSegments; c++) {
      const u = c / radialSegments;
      const theta = (u - 0.5) * Math.PI * 2; // theta=0 is +X front
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Optional anatomical pectoral/spine contouring without sharp boxy edges
      let rxMod = spec.rx;
      if (pinch !== 0 && cosT > 0) {
        // Subtle twin pectoral mound vs sternum valley when pinch > 0, or pinched rib contour
        const pecCurve = Math.sin(clamp(Math.abs(sinT) * 1.4, 0, 1) * Math.PI);
        rxMod += pinch * pecCurve * 0.014;
      }

      const idx = r * cols + c;
      positions[idx * 3] = ox + cosT * rxMod;
      positions[idx * 3 + 1] = spec.y;
      positions[idx * 3 + 2] = oz + sinT * spec.rz;

      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;

      // Subtle under-arm / side shading
      const sideShade = 1.0 - 0.12 * Math.abs(sinT);
      const ao = clamp(ringAo * sideShade, 0.35, 1.0);
      colors[idx * 3] = ao;
      colors[idx * 3 + 1] = ao;
      colors[idx * 3 + 2] = ao;
    }
  }

  for (let r = 0; r < ringCount - 1; r++) {
    for (let c = 0; c < radialSegments; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }

  if (capEnds) {
    const botIdx = totalRingVerts;
    const topIdx = totalRingVerts + 1;
    const r0 = rings[0];
    const rLast = rings[ringCount - 1];

    positions[botIdx * 3] = r0.offsetX ?? 0;
    positions[botIdx * 3 + 1] = r0.y;
    positions[botIdx * 3 + 2] = r0.offsetZ ?? 0;
    uvs[botIdx * 2] = 0.5;
    uvs[botIdx * 2 + 1] = 0;
    const botAo = r0.ao ?? 0.72;
    colors[botIdx * 3] = botAo;
    colors[botIdx * 3 + 1] = botAo;
    colors[botIdx * 3 + 2] = botAo;

    positions[topIdx * 3] = rLast.offsetX ?? 0;
    positions[topIdx * 3 + 1] = rLast.y;
    positions[topIdx * 3 + 2] = rLast.offsetZ ?? 0;
    uvs[topIdx * 2] = 0.5;
    uvs[topIdx * 2 + 1] = 1;
    const topAo = rLast.ao ?? 0.92;
    colors[topIdx * 3] = topAo;
    colors[topIdx * 3 + 1] = topAo;
    colors[topIdx * 3 + 2] = topAo;

    for (let c = 0; c < radialSegments; c++) {
      // Bottom cap faces -Y
      indices.push(botIdx, c, c + 1);
      // Top cap faces +Y
      const tStart = (ringCount - 1) * cols;
      indices.push(topIdx, tStart + c + 1, tStart + c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Weld seam normals across col 0 & col radialSegments
  const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const n0 = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  for (let r = 0; r < ringCount; r++) {
    const i0 = r * cols;
    const i1 = r * cols + radialSegments;
    n0.set(norm.getX(i0), norm.getY(i0), norm.getZ(i0));
    n1.set(norm.getX(i1), norm.getY(i1), norm.getZ(i1));
    n0.add(n1);
    if (n0.lengthSq() > 1e-8) {
      n0.normalize();
      norm.setXYZ(i0, n0.x, n0.y, n0.z);
      norm.setXYZ(i1, n0.x, n0.y, n0.z);
    }
  }
  norm.needsUpdate = true;

  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Organic contoured anatomical zombie torso spanning y = [-0.07 .. torsoH]
 * with sculpted pelvis/hips, waist taper, ribcage or gut dome, and rounded trapezius collar.
 */
export function createSculptedTorsoGeometry(archetype: ZombieArchetype): THREE.BufferGeometry {
  if (archetype === 'bloater') {
    return createOrganicLoftGeometry(
      [
        { y: -0.08, rx: 0.16, rz: 0.22, offsetX: 0.0, ao: 0.65 },
        { y: 0.0, rx: 0.21, rz: 0.26, offsetX: 0.025, ao: 0.78 },
        { y: 0.13, rx: 0.25, rz: 0.285, offsetX: 0.052, ao: 0.96 }, // Heavy sagging gut
        { y: 0.28, rx: 0.225, rz: 0.275, offsetX: 0.022, chestPinch: 0.5, ao: 1.0 },
        { y: 0.41, rx: 0.175, rz: 0.24, offsetX: -0.006, ao: 0.95 },
        { y: 0.455, rx: 0.095, rz: 0.125, offsetX: 0.01, ao: 0.85 },
      ],
      10,
      true
    );
  }
  if (archetype === 'runner') {
    return createOrganicLoftGeometry(
      [
        { y: -0.075, rx: 0.092, rz: 0.145, offsetX: -0.01, ao: 0.68 },
        { y: 0.01, rx: 0.098, rz: 0.142, offsetX: -0.005, ao: 0.82 },
        { y: 0.13, rx: 0.108, rz: 0.156, offsetX: 0.008, ao: 0.94 }, // Taut athletic waist
        { y: 0.26, rx: 0.132, rz: 0.206, offsetX: 0.018, chestPinch: 1.2, ao: 1.0 }, // Broad V-taper chest
        { y: 0.355, rx: 0.118, rz: 0.194, offsetX: 0.014, ao: 0.95 },
        { y: 0.39, rx: 0.072, rz: 0.1, offsetX: 0.022, ao: 0.84 },
      ],
      10,
      true
    );
  }
  if (archetype === 'spitter') {
    return createOrganicLoftGeometry(
      [
        { y: -0.07, rx: 0.092, rz: 0.134, offsetX: -0.01, ao: 0.68 },
        { y: 0.01, rx: 0.098, rz: 0.132, offsetX: 0.0, ao: 0.84 },
        { y: 0.14, rx: 0.118, rz: 0.155, offsetX: 0.012, ao: 0.95 },
        { y: 0.27, rx: 0.13, rz: 0.175, offsetX: 0.005, chestPinch: 0.8, ao: 1.0 }, // Hunched ribcage
        { y: 0.365, rx: 0.114, rz: 0.16, offsetX: 0.022, ao: 0.94 }, // Forward hunched upper spine
        { y: 0.4, rx: 0.068, rz: 0.092, offsetX: 0.04, ao: 0.82 },
      ],
      10,
      true
    );
  }
  // Walker: gaunt slumped torso with pinched waist & curved ribcage
  return createOrganicLoftGeometry(
    [
      { y: -0.075, rx: 0.104, rz: 0.152, offsetX: -0.008, ao: 0.68 },
      { y: 0.01, rx: 0.106, rz: 0.146, offsetX: -0.004, ao: 0.82 },
      { y: 0.13, rx: 0.114, rz: 0.158, offsetX: 0.006, ao: 0.92 },
      { y: 0.26, rx: 0.136, rz: 0.188, offsetX: 0.004, chestPinch: 0.7, ao: 1.0 },
      { y: 0.355, rx: 0.12, rz: 0.174, offsetX: 0.008, ao: 0.94 },
      { y: 0.39, rx: 0.074, rz: 0.098, offsetX: 0.016, ao: 0.84 },
    ],
    10,
    true
  );
}

/**
 * Skeletal multi-fingered zombie claw hand along +X (wrist at x=0 -> flat palm + 4 curled talons).
 * Zero puffy glove blobs; stays compact in triangle budget (~96 tris total).
 */
export function createSculptedClawHandGeometry(isRunner: boolean): THREE.BufferGeometry {
  const palmLen = isRunner ? 0.058 : 0.048;
  const fingerLen = isRunner ? 0.064 : 0.048;
  const parts: THREE.BufferGeometry[] = [];

  // Compact flattened palm
  const palm = createOrganicLoftGeometry(
    [
      { y: 0, rx: 0.014, rz: 0.02, ao: 0.72 },
      { y: palmLen * 0.55, rx: 0.013, rz: 0.028, ao: 0.95 },
      { y: palmLen, rx: 0.01, rz: 0.03, offsetX: -0.002, ao: 0.88 },
    ],
    6,
    true
  );
  palm.rotateZ(-Math.PI * 0.5);
  parts.push(palm);

  // 4 splayed, downward-curling tapered bony fingers/talons
  const zOffsets = [-0.022, -0.007, 0.008, 0.023];
  const lengthMods = [0.88, 1.05, 1.0, 0.82];
  for (let i = 0; i < 4; i++) {
    const fl = fingerLen * lengthMods[i];
    const finger = createOrganicLoftGeometry(
      [
        { y: 0, rx: 0.0068, rz: 0.0068, ao: 0.85 },
        { y: fl * 0.52, rx: 0.0052, rz: 0.0052, offsetX: -0.005, ao: 1.0 },
        { y: fl, rx: 0.0018, rz: 0.0018, offsetX: -0.016, ao: 0.65 },
      ],
      4,
      true
    );
    finger.rotateZ(-Math.PI * 0.5);
    // Slight lateral splay
    finger.rotateY((i - 1.5) * -0.09);
    finger.translate(palmLen - 0.004, 0, zOffsets[i]);
    parts.push(finger);
  }

  // Merge non-indexed triangles into one crisp shared geometry
  let totalVerts = 0;
  const nonIndexed = parts.map((p) => {
    const ni = p.index ? p.toNonIndexed() : p;
    totalVerts += ni.getAttribute('position').count;
    return ni;
  });

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  let offset = 0;
  for (const ni of nonIndexed) {
    const p = ni.getAttribute('position') as THREE.BufferAttribute;
    const n = ni.getAttribute('normal') as THREE.BufferAttribute;
    const c = ni.getAttribute('color') as THREE.BufferAttribute;
    const u = ni.getAttribute('uv') as THREE.BufferAttribute;
    positions.set(p.array as Float32Array, offset * 3);
    normals.set(n.array as Float32Array, offset * 3);
    colors.set(c.array as Float32Array, offset * 3);
    uvs.set(u.array as Float32Array, offset * 2);
    offset += p.count;
    ni.dispose();
  }
  for (const p of parts) p.dispose();

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Sculpted rounded zombie boot centered under ankle at y=0 extending down to y=-height.
 */
export function createSculptedBootGeometry(
  width: number,
  length: number,
  height: number
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const hl = length * 0.5;
  return createOrganicLoftGeometry(
    [
      { y: -height, rx: hl * 1.04, rz: hw * 1.04, offsetX: 0.022, ao: 0.7 },
      { y: -height * 0.48, rx: hl * 0.94, rz: hw * 0.98, offsetX: 0.016, ao: 0.92 },
      { y: -height * 0.08, rx: hw * 0.92, rz: hw * 0.9, offsetX: 0.002, ao: 1.0 },
      { y: 0, rx: hw * 0.88, rz: hw * 0.86, offsetX: 0.0, ao: 0.86 },
    ],
    8,
    true
  );
}

/**
 * Curved anatomical rib arch wrapping around the front (+X) ribcage for Walker torso gore.
 */
export function createSculptedRibArchGeometry(
  radiusX: number,
  radiusZ: number,
  tubeRadius: number
): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = (t - 0.5) * Math.PI * 0.82;
    pts.push(
      new THREE.Vector3(
        Math.cos(ang) * radiusX,
        -Math.abs(Math.sin(ang)) * 0.01,
        Math.sin(ang) * radiusZ
      )
    );
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 8, tubeRadius, 5, false);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Rounded organic limb segment (arm or leg) with subtle anatomical muscle swell
 * along the axis (+X when horizontal, -Y when vertical leg).
 */
export function createSculptedLimbSegmentGeometry(opts: {
  topRadius: number;
  midRadius: number;
  botRadius: number;
  length: number;
  horizontalX?: boolean;
  radialSegments?: number;
  vStart?: number;
  vEnd?: number;
}): THREE.BufferGeometry {
  const {
    topRadius,
    midRadius,
    botRadius,
    length,
    horizontalX = false,
    radialSegments = 8,
    vStart = 1,
    vEnd = 0,
  } = opts;
  const geo = createOrganicLoftGeometry(
    [
      { y: 0, rx: topRadius * 0.94, rz: topRadius * 0.94, ao: 0.78 },
      { y: length * 0.34, rx: midRadius * 1.04, rz: midRadius * 0.98, ao: 1.0 },
      { y: length * 0.68, rx: (midRadius + botRadius) * 0.5, rz: (midRadius + botRadius) * 0.48, ao: 0.96 },
      { y: length, rx: botRadius * 0.92, rz: botRadius * 0.92, ao: 0.8 },
    ],
    radialSegments,
    true
  );
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const t = uv.getY(i);
    uv.setY(i, clamp01(vStart + (vEnd - vStart) * t));
  }
  uv.needsUpdate = true;

  if (horizontalX) {
    // Rotate +Y extent -> +X arm direction from shoulder/elbow joint
    geo.rotateZ(-Math.PI * 0.5);
  } else {
    // Flip +Y extent -> -Y leg direction from hip pivot downward
    geo.rotateZ(Math.PI);
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Organic muscular/tendon neck stalk bridging torso collar to skull base.
 */
export function createSculptedNeckGeometry(archetype: ZombieArchetype): THREE.BufferGeometry {
  const topR = archetype === 'bloater' ? 0.082 : 0.056;
  const botR = archetype === 'bloater' ? 0.105 : 0.074;
  return createOrganicLoftGeometry(
    [
      { y: -0.045, rx: botR, rz: botR * 1.08, offsetX: -0.022, ao: 0.68 },
      { y: 0.0, rx: (topR + botR) * 0.5, rz: ((topR + botR) * 0.5) * 1.04, offsetX: -0.012, ao: 0.85 },
      { y: 0.055, rx: topR, rz: topR * 0.96, offsetX: 0.002, ao: 0.82 },
    ],
    8,
    true
  );
}

/**
 * Dark rounded upper palate / throat core seated inside the skull and mandible arch.
 */
export function createSculptedMouthCavityGeometry(archetype: ZombieArchetype): THREE.BufferGeometry {
  const m = getSkullMetrics(archetype);
  const rx = m.jawLength * 0.62;
  const rz = m.jawWidth * 0.38;
  return createOrganicLoftGeometry(
    [
      { y: -0.024, rx: rx * 0.85, rz: rz * 0.85, ao: 0.25 },
      { y: 0.0, rx, rz, ao: 0.35 },
      { y: 0.026, rx: rx * 0.9, rz: rz * 0.9, ao: 0.25 },
    ],
    8,
    true
  );
}


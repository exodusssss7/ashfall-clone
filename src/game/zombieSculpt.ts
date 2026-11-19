import * as THREE from 'three';
import type { ZombieArchetype } from './types';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (Math.abs(span) < 1e-6) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / span);
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
  /** Eye socket world-offset relative to headPivot (recessed cleanly behind brow overhang) */
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  eyeRadius: number;
  /** Upper dental arch radii */
  jawWidth: number;
  jawLength: number;
  /** Jaw hinge pivot offset relative to headPivot */
  jawPivotX: number;
  jawPivotY: number;
}

export function getSkullMetrics(archetype: ZombieArchetype): SkullMetrics {
  switch (archetype) {
    case 'runner':
      return {
        centerY: 0.128,
        centerX: 0.016,
        mouthFrontX: 0.132,
        mouthUpperY: 0.056,
        eyeX: 0.110,
        eyeY: 0.133,
        eyeZ: 0.032,
        eyeRadius: 0.0155,
        jawWidth: 0.126,
        jawLength: 0.112,
        jawPivotX: 0.016,
        jawPivotY: 0.072,
      };
    case 'bloater':
      return {
        centerY: 0.144,
        centerX: 0.012,
        mouthFrontX: 0.138,
        mouthUpperY: 0.056,
        eyeX: 0.114,
        eyeY: 0.151,
        eyeZ: 0.041,
        eyeRadius: 0.0165,
        jawWidth: 0.168,
        jawLength: 0.118,
        jawPivotX: 0.014,
        jawPivotY: 0.076,
      };
    case 'spitter':
      return {
        centerY: 0.132,
        centerX: 0.014,
        mouthFrontX: 0.126,
        mouthUpperY: 0.056,
        eyeX: 0.101,
        eyeY: 0.138,
        eyeZ: 0.033,
        eyeRadius: 0.016,
        jawWidth: 0.130,
        jawLength: 0.108,
        jawPivotX: 0.014,
        jawPivotY: 0.072,
      };
    case 'walker':
    default:
      return {
        centerY: 0.132,
        centerX: 0.010,
        mouthFrontX: 0.120,
        mouthUpperY: 0.056,
        eyeX: 0.098,
        eyeY: 0.138,
        eyeZ: 0.033,
        eyeRadius: 0.0155,
        jawWidth: 0.128,
        jawLength: 0.104,
        jawPivotX: 0.012,
        jawPivotY: 0.072,
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
 * Sculpts an anatomical low-poly human-zombie skull (+X forward, +Y up, +/-Z sides)
 * with a natural rounded cranial dome (no lemon/cone pinch), overhanging supraorbital
 * brow ridge, carved deep orbital sockets, prominent zygomatic cheekbones, hollowed
 * temples/buccal cheeks, piriform nasal cavity, and projecting maxilla arch.
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

  // True human cranial proportions (slightly elongated front-to-back, rounded top vault)
  const baseRx =
    archetype === 'bloater' ? 0.124 : archetype === 'runner' ? 0.114 : archetype === 'spitter' ? 0.108 : 0.108;
  const baseRy =
    archetype === 'bloater' ? 0.126 : archetype === 'runner' ? 0.109 : archetype === 'spitter' ? 0.113 : 0.114;
  const baseRz =
    archetype === 'bloater' ? 0.126 : archetype === 'runner' ? 0.099 : archetype === 'spitter' ? 0.099 : 0.099;

  for (let row = 0; row <= vSteps; row++) {
    const vNorm = 1 - row / vSteps; // 1 at top crown, 0 at base
    const phi = (row / vSteps) * Math.PI; // 0 = crown (+Y), PI = base (-Y)
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);

    for (let col = 0; col <= uSteps; col++) {
      const uNorm = col / uSteps;
      // theta = 0 faces +X (front face), +/-PI is -X (back of skull)
      const theta = (uNorm - 0.5) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const dx = sinP * cosT;
      const dy = cosP;
      const dz = sinP * sinT;
      const az = Math.abs(dz);

      let x = dx * baseRx;
      let y = dy * baseRy;
      let z = dz * baseRz;

      // 1. Natural rounded human cranial vault (broad parietal eminence, fuller occipital back)
      const parietalFull = smoothstep(0.15, 0.72, dy) * (1 - smoothstep(0.84, 1.0, dy));
      z *= 1 + 0.06 * parietalFull;
      const occiput = smoothstep(-0.1, 0.55, dy) * smoothstep(0.15, -0.6, dx);
      x -= 0.015 * occiput;
      y += 0.005 * occiput;

      // Gently flatten top crown so skull never reads as pointy/conical
      if (dy > 0.78) {
        const crownFlat = smoothstep(0.78, 1.0, dy);
        y -= 0.008 * crownFlat;
      }

      // Clean occipital-to-neck taper at lower rear base
      const lowerBackTaper = smoothstep(-0.2, -0.82, dy) * smoothstep(0.18, -0.58, dx);
      z *= 1 - 0.30 * lowerBackTaper;
      y += 0.012 * lowerBackTaper;

      // 2. Forehead plane + projecting upper maxilla (horseshoe dental arch)
      const frontMask = smoothstep(-0.08, 0.52, dx);
      const forehead = smoothstep(0.32, 0.74, dy) * smoothstep(0.35, 0.85, dx);
      x += 0.007 * forehead;

      const maxillaMask = smoothstep(0.18, 0.75, dx) * smoothstep(-0.10, -0.68, dy);
      const maxillaZPinch = smoothstep(0.08, 0.74, az) * smoothstep(-0.08, -0.72, dy) * frontMask;
      x += (archetype === 'runner' ? 0.024 : archetype === 'spitter' ? 0.020 : 0.015) * maxillaMask;
      z *= 1 - 0.25 * maxillaZPinch;

      // Recess palate cleanly so lower jaw & teeth sit tightly inside
      if (dy < -0.56) {
        const palateCut = smoothstep(-0.56, -0.96, dy);
        y += 0.014 * palateCut * smoothstep(-0.2, 0.65, dx);
      }

      // 3. Heavy overhanging supraorbital brow ridge + angry furrowed glabella
      const brow =
        gauss(dy, 0.25, 0.11) *
        smoothstep(0.30, 0.78, dx) *
        (1 - smoothstep(0.56, 0.88, az));
      const glabellaDip = gauss(az, 0, 0.12) * gauss(dy, 0.23, 0.10) * smoothstep(0.55, 0.92, dx);
      const browBoost = archetype === 'runner' ? 0.020 : archetype === 'bloater' ? 0.019 : 0.017;
      x += brow * browBoost;
      y -= glabellaDip * 0.006;

      // 4. Deep concave orbital sockets calibrated to m.eyeX/Y/Z
      const eyeMaskL = gauss2(dz, -0.35, 0.16, dy, 0.04, 0.14) * smoothstep(0.38, 0.80, dx);
      const eyeMaskR = gauss2(dz, 0.35, 0.16, dy, 0.04, 0.14) * smoothstep(0.38, 0.80, dx);
      const eyeSocket = Math.max(eyeMaskL, eyeMaskR);
      x -= eyeSocket * (archetype === 'runner' ? 0.024 : 0.022);

      // 5. Sharp zygomatic cheekbones + gaunt hollowed temples & cheeks
      const cheekMask =
        (gauss2(dz, -0.55, 0.18, dy, -0.10, 0.14) + gauss2(dz, 0.55, 0.18, dy, -0.10, 0.14)) *
        smoothstep(0.12, 0.68, dx);
      x += cheekMask * (archetype === 'walker' ? 0.015 : archetype === 'runner' ? 0.016 : 0.012);
      z += Math.sign(dz) * cheekMask * (archetype === 'bloater' ? 0.012 : 0.010);

      const templeHollow =
        (gauss2(dz, -0.82, 0.16, dy, 0.12, 0.15) + gauss2(dz, 0.82, 0.16, dy, 0.12, 0.15)) *
        smoothstep(-0.18, 0.45, dx) *
        (1 - smoothstep(0.38, 0.72, dy));
      const buccalHollow =
        (gauss2(dz, -0.60, 0.17, dy, -0.36, 0.17) + gauss2(dz, 0.60, 0.17, dy, -0.36, 0.17)) *
        smoothstep(-0.08, 0.62, dx);

      if (archetype === 'walker' || archetype === 'runner' || archetype === 'spitter') {
        const gauntAmt = archetype === 'walker' ? 0.010 : archetype === 'spitter' ? 0.008 : 0.009;
        z -= Math.sign(dz) * (templeHollow * gauntAmt + buccalHollow * gauntAmt * 1.3);
      }

      // 6. Sculpted nasal bridge & desiccated piriform nasal recess
      const nasalBridge = gauss(az, 0, 0.10) * gauss(dy, 0.07, 0.12) * smoothstep(0.64, 0.94, dx);
      const nasalHole = gauss(az, 0, 0.13) * gauss(dy, -0.13, 0.10) * smoothstep(0.68, 0.95, dx);
      x += nasalBridge * 0.013 - nasalHole * 0.015;

      // 7. Archetype-specific anatomical cranial character (preserving recognizable human head silhouette!)
      let boneLesion = 0;
      let bruiseTint = 0;
      let infectGlowTint = 0;

      if (archetype === 'walker') {
        // Concave left-parietal skull trauma exposing pale bone + slight cadaverous asymmetry
        const wound = gauss2(dz, -0.46, 0.22, dy, 0.48, 0.20) * smoothstep(-0.15, 0.55, dx);
        x -= wound * 0.005;
        y -= wound * 0.007;
        boneLesion = smoothstep(0.32, 0.72, wound);
        y -= 0.004 * smoothstep(0.25, 0.85, dz) * smoothstep(0, -0.55, dy);
      } else if (archetype === 'runner') {
        // Swept-back feral cranium + aggressive forward snout snarl
        const sweep = smoothstep(0.12, 0.82, dy);
        x -= sweep * 0.012;
        const snarl = gauss(dy, -0.22, 0.13) * smoothstep(0.38, 0.88, dx);
        x += snarl * 0.013;
        bruiseTint = smoothstep(0.22, 0.82, maxillaMask) * 0.52;
      } else if (archetype === 'bloater') {
        // Heavy grotesque sagging jowls + localized asymmetric right-temple tumor growth (NOT a lemon!)
        const jowlSag = smoothstep(-0.08, -0.66, dy) * smoothstep(0.32, 0.88, az);
        const browLump = gauss2(dz, -0.52, 0.24, dy, 0.30, 0.22) * smoothstep(-0.2, 0.65, dx);
        const cheekSwelling = gauss2(dz, 0.56, 0.24, dy, -0.18, 0.22) * smoothstep(-0.1, 0.72, dx);
        x += (browLump * 0.013 + cheekSwelling * 0.015) * Math.sign(dx || 1);
        y -= jowlSag * 0.014;
        z += Math.sign(dz) * (browLump * 0.014 + cheekSwelling * 0.016 + jowlSag * 0.018);
        infectGlowTint = clamp01(browLump * 0.75 + cheekSwelling * 0.7);
      } else if (archetype === 'spitter') {
        // Gaunt desiccated human cranium + distended sub-zygomatic lateral venom glands (zero conehead!)
        const venomGland =
          (gauss2(dz, -0.76, 0.20, dy, -0.34, 0.20) + gauss2(dz, 0.76, 0.20, dy, -0.34, 0.20)) *
          smoothstep(-0.05, 0.65, dx);
        z += Math.sign(dz) * venomGland * 0.024;
        y -= venomGland * 0.008;
        infectGlowTint = clamp01(venomGland * 0.82);
      }

      const idx = row * cols + col;
      positions[idx * 3] = x + m.centerX;
      positions[idx * 3 + 1] = y + m.centerY;
      positions[idx * 3 + 2] = z;

      uvs[idx * 2] = uNorm;
      uvs[idx * 2 + 1] = vNorm;

      // Sculpted anatomical vertex AO (deep sockets, nasal cavity, cheek hollows, brow catchlight)
      const baseAo =
        1.0 -
        eyeSocket * 0.76 -
        nasalHole * 0.70 -
        buccalHollow * 0.28 -
        templeHollow * 0.20 -
        smoothstep(-0.36, -0.92, dy) * 0.34;
      const ao = clamp(baseAo + brow * 0.09 + cheekMask * 0.07, 0.16, 1.0);

      let cr = ao;
      let cg = ao;
      let cb = ao;
      if (boneLesion > 0.01) {
        cr = cr * (1 - boneLesion * 0.35) + 0.96 * boneLesion * 0.35;
        cg = cg * (1 - boneLesion * 0.35) + 0.90 * boneLesion * 0.35;
        cb = cb * (1 - boneLesion * 0.35) + 0.78 * boneLesion * 0.35;
      }
      if (bruiseTint > 0.01) {
        cr = clamp01(cr + bruiseTint * 0.14);
        cg = clamp01(cg * (1 - bruiseTint * 0.44));
        cb = clamp01(cb * (1 - bruiseTint * 0.46));
      }
      if (infectGlowTint > 0.01) {
        if (archetype === 'bloater') {
          cr = clamp01(cr + infectGlowTint * 0.10);
          cg = clamp01(cg + infectGlowTint * 0.18);
          cb = clamp01(cb * (1 - infectGlowTint * 0.24));
        } else if (archetype === 'spitter') {
          cr = clamp01(cr * (1 - infectGlowTint * 0.26));
          cg = clamp01(cg + infectGlowTint * 0.20);
          cb = clamp01(cb + infectGlowTint * 0.14);
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
 * Sculpts an anatomical U-shaped lower mandible with ascending rami that tuck cleanly
 * beneath the zygomatic cheeks and a defined bony chin contour.
 */
export function createSculptedJawGeometry(archetype: ZombieArchetype): THREE.BufferGeometry {
  const m = getSkullMetrics(archetype);
  const archSteps = 10;
  const tubeSteps = 6;
  const rows = archSteps + 1;
  const cols = tubeSteps + 1;
  const vertCount = rows * cols;

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  const halfW = m.jawWidth * 0.44;
  const len = m.jawLength * 0.90;
  const chinDrop = archetype === 'bloater' ? -0.040 : archetype === 'spitter' ? -0.044 : -0.036;

  for (let r = 0; r <= archSteps; r++) {
    const t = r / archSteps;
    const ang = (t - 0.5) * Math.PI;
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);

    // Ascending rami rise up into the cheek/temple socket at |sinA| -> 1
    const archSharpness = archetype === 'runner' || archetype === 'spitter' ? 1.12 : archetype === 'bloater' ? 0.92 : 1.04;
    const cx = Math.pow(cosA, archSharpness) * len;
    const cz = sinA * halfW;
    const cy = Math.pow(Math.abs(sinA), 1.4) * 0.026 + cosA * chinDrop;

    const thickLat = (archetype === 'bloater' ? 0.016 : 0.0115) * (0.82 + 0.28 * cosA);
    const heightVert = (archetype === 'bloater' ? 0.021 : 0.017) * (0.85 + 0.30 * cosA);

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

      const innerAo = radOut < 0 ? 0.44 : 1.0;
      const underAo = radUp < -0.25 ? 0.70 : 1.0;
      const ao = clamp(innerAo * underAo, 0.30, 1.0);
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
  const trisPerTooth = 3;
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
      colors[write * 3 + 1] = s * 0.94;
      colors[write * 3 + 2] = s * 0.80;
      write++;
    }
  };

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const ang = (t - 0.5) * Math.PI * 0.84;
    const cx = Math.cos(ang) * radiusX;
    const cz = Math.sin(ang) * radiusZ;
    const canineBoost = Math.abs(t - 0.5) > 0.22 && Math.abs(t - 0.5) < 0.42 ? 1.35 : 0.88 + ((i * 37) % 10) * 0.03;
    const h = toothHeight * canineBoost * (upper ? -1 : 1);
    const r = toothRadius;

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
        pushTri(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], tipX, tipY, tipZ, 0.54, 1.0);
      } else {
        pushTri(p1[0], p1[1], p1[2], p0[0], p0[1], p0[2], tipX, tipY, tipZ, 0.54, 1.0);
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
  /** Optional sagittal/chest/back shaping: positive accentuates twin pecs + sternum valley */
  chestPinch?: number;
  /** Optional dorsal spine ridge projection along -X back */
  backRidge?: number;
  /** Anatomical AO multiplier [0..1] for this ring */
  ao?: number;
}

/**
 * Parametric organic radial loft along +Y for rounded zombie torsos, limbs, necks, and boots.
 * Averages periodic seam normals for smooth organic highlights without seams.
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
    const ridge = spec.backRidge ?? 0;
    const ringAo = spec.ao ?? 1.0;

    for (let c = 0; c <= radialSegments; c++) {
      const u = c / radialSegments;
      const theta = (u - 0.5) * Math.PI * 2; // theta=0 is +X front
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      let rxMod = spec.rx;
      if (pinch !== 0 && cosT > 0) {
        const pecCurve = Math.sin(clamp(Math.abs(sinT) * 1.4, 0, 1) * Math.PI);
        rxMod += pinch * pecCurve * 0.015;
      }
      if (ridge !== 0 && cosT < -0.5) {
        const spineCurve = Math.pow(Math.max(0, -cosT - 0.5) / 0.5, 1.8);
        rxMod += ridge * spineCurve * 0.018;
      }

      const idx = r * cols + c;
      positions[idx * 3] = ox + cosT * rxMod;
      positions[idx * 3 + 1] = spec.y;
      positions[idx * 3 + 2] = oz + sinT * spec.rz;

      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;

      const sideShade = 1.0 - 0.13 * Math.abs(sinT);
      const ao = clamp(ringAo * sideShade, 0.32, 1.0);
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
      indices.push(botIdx, c, c + 1);
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
 * Helper to merge multiple BufferGeometries (with position/normal/color/uv) into one clean mesh.
 */
function mergePartGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
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
    const c = ni.getAttribute('color') as THREE.BufferAttribute | undefined;
    const u = ni.getAttribute('uv') as THREE.BufferAttribute | undefined;
    positions.set(p.array as Float32Array, offset * 3);
    normals.set(n.array as Float32Array, offset * 3);
    if (c) {
      colors.set(c.array as Float32Array, offset * 3);
    } else {
      for (let i = 0; i < p.count * 3; i++) colors[offset * 3 + i] = 1.0;
    }
    if (u) {
      uvs.set(u.array as Float32Array, offset * 2);
    }
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
 * Organic contoured anatomical zombie torso spanning y = [-0.06 .. torsoH]
 * with sculpted pelvis/hips, taut waist taper, ribcage or hulking gut, dorsal spine contour,
 * and rounded trapezius collar for realistic survival-horror proportions.
 */
export function createSculptedTorsoGeometry(archetype: ZombieArchetype): THREE.BufferGeometry {
  if (archetype === 'bloater') {
    return createOrganicLoftGeometry(
      [
        { y: -0.065, rx: 0.145, rz: 0.195, offsetX: -0.005, ao: 0.62 },
        { y: 0.02, rx: 0.185, rz: 0.235, offsetX: 0.024, ao: 0.78 },
        { y: 0.14, rx: 0.222, rz: 0.258, offsetX: 0.048, ao: 0.96 }, // Heavy ruptured sagging gut
        { y: 0.29, rx: 0.195, rz: 0.252, offsetX: 0.015, chestPinch: 0.65, backRidge: 0.6, ao: 1.0 },
        { y: 0.42, rx: 0.155, rz: 0.225, offsetX: -0.012, backRidge: 0.8, ao: 0.94 }, // Hulking trapezius hunch
        { y: 0.475, rx: 0.088, rz: 0.120, offsetX: 0.008, ao: 0.84 },
      ],
      10,
      true
    );
  }
  if (archetype === 'runner') {
    return createOrganicLoftGeometry(
      [
        { y: -0.06, rx: 0.078, rz: 0.122, offsetX: -0.014, ao: 0.66 },
        { y: 0.02, rx: 0.082, rz: 0.118, offsetX: -0.008, ao: 0.80 },
        { y: 0.13, rx: 0.092, rz: 0.132, offsetX: 0.006, backRidge: 0.7, ao: 0.94 }, // Gaunt athletic waist
        { y: 0.25, rx: 0.116, rz: 0.182, offsetX: 0.020, chestPinch: 1.35, backRidge: 0.9, ao: 1.0 }, // Predatory V-taper chest
        { y: 0.335, rx: 0.102, rz: 0.168, offsetX: 0.026, backRidge: 0.6, ao: 0.94 },
        { y: 0.368, rx: 0.062, rz: 0.088, offsetX: 0.036, ao: 0.82 },
      ],
      10,
      true
    );
  }
  if (archetype === 'spitter') {
    return createOrganicLoftGeometry(
      [
        { y: -0.06, rx: 0.076, rz: 0.114, offsetX: -0.014, ao: 0.64 },
        { y: 0.02, rx: 0.080, rz: 0.108, offsetX: -0.006, ao: 0.80 },
        { y: 0.14, rx: 0.098, rz: 0.128, offsetX: 0.006, backRidge: 0.95, ao: 0.94 },
        { y: 0.27, rx: 0.114, rz: 0.152, offsetX: 0.014, chestPinch: 0.5, backRidge: 1.25, ao: 1.0 }, // Kyphotic hunched ribcage
        { y: 0.36, rx: 0.098, rz: 0.138, offsetX: 0.036, backRidge: 1.0, ao: 0.92 }, // Forward-craned upper spine
        { y: 0.395, rx: 0.058, rz: 0.080, offsetX: 0.054, ao: 0.82 },
      ],
      10,
      true
    );
  }
  // Walker: gaunt urban survivor corpse with narrow waist, slumped ribcage & slight shoulder hunch
  return createOrganicLoftGeometry(
    [
      { y: -0.06, rx: 0.088, rz: 0.132, offsetX: -0.010, ao: 0.66 },
      { y: 0.02, rx: 0.088, rz: 0.124, offsetX: -0.006, ao: 0.80 },
      { y: 0.13, rx: 0.096, rz: 0.136, offsetX: 0.004, backRidge: 0.45, ao: 0.92 },
      { y: 0.255, rx: 0.116, rz: 0.164, offsetX: 0.008, chestPinch: 0.85, backRidge: 0.65, ao: 1.0 },
      { y: 0.345, rx: 0.102, rz: 0.152, offsetX: 0.016, ao: 0.94 },
      { y: 0.382, rx: 0.064, rz: 0.088, offsetX: 0.024, ao: 0.84 },
    ],
    10,
    true
  );
}

/**
 * Skeletal 5-digit zombie claw hand along +X (wrist at x=0 -> sculpted palm + opposable thumb + 4 curled bony fingers).
 * Fits cleanly under 144 triangles while reading unmistakably as gnarled undead hands.
 */
export function createSculptedClawHandGeometry(isRunner: boolean): THREE.BufferGeometry {
  const palmLen = isRunner ? 0.052 : 0.044;
  const fingerLen = isRunner ? 0.062 : 0.046;
  const parts: THREE.BufferGeometry[] = [];

  // Compact flattened bony palm
  const palm = createOrganicLoftGeometry(
    [
      { y: 0, rx: 0.011, rz: 0.018, ao: 0.72 },
      { y: palmLen * 0.55, rx: 0.011, rz: 0.025, ao: 0.95 },
      { y: palmLen, rx: 0.009, rz: 0.027, offsetX: -0.002, ao: 0.88 },
    ],
    6,
    true
  );
  palm.rotateZ(-Math.PI * 0.5);
  parts.push(palm);

  // 4 splayed, downward-curling tapered bony fingers/talons
  const zOffsets = [-0.020, -0.007, 0.007, 0.020];
  const lengthMods = [0.86, 1.06, 0.98, 0.78];
  for (let i = 0; i < 4; i++) {
    const fl = fingerLen * lengthMods[i];
    const finger = createOrganicLoftGeometry(
      [
        { y: 0, rx: 0.0056, rz: 0.0056, ao: 0.85 },
        { y: fl * 0.50, rx: 0.0044, rz: 0.0044, offsetX: -0.006, ao: 1.0 },
        { y: fl, rx: 0.0014, rz: 0.0014, offsetX: -0.019, ao: 0.52 },
      ],
      3,
      true
    );
    finger.rotateZ(-Math.PI * 0.5);
    finger.rotateY((i - 1.5) * -0.10);
    finger.translate(palmLen - 0.004, 0, zOffsets[i]);
    parts.push(finger);
  }

  // Crooked opposable thumb angled downward-inward for sinister grasping silhouette
  const thumbLen = fingerLen * 0.62;
  const thumb = createOrganicLoftGeometry(
    [
      { y: 0, rx: 0.0062, rz: 0.0058, ao: 0.82 },
      { y: thumbLen * 0.55, rx: 0.0048, rz: 0.0048, offsetX: -0.005, ao: 0.96 },
      { y: thumbLen, rx: 0.0016, rz: 0.0016, offsetX: -0.012, ao: 0.55 },
    ],
    3,
    true
  );
  thumb.rotateZ(-Math.PI * 0.65);
  thumb.rotateY(0.55);
  thumb.translate(palmLen * 0.42, -0.008, -0.022);
  parts.push(thumb);

  return mergePartGeometries(parts);
}

/**
 * Sculpted rounded rugged zombie boot centered under ankle at y=0 extending down to y=-height,
 * with distinct heel block, instep curve, and slightly upturned scuffed toe cap.
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
      { y: -height, rx: hl * 1.06, rz: hw * 1.05, offsetX: 0.024, ao: 0.66 },
      { y: -height * 0.54, rx: hl * 0.96, rz: hw * 0.98, offsetX: 0.018, ao: 0.90 },
      { y: -height * 0.14, rx: hw * 0.90, rz: hw * 0.88, offsetX: 0.003, ao: 1.0 },
      { y: 0, rx: hw * 0.84, rz: hw * 0.82, offsetX: 0.0, ao: 0.84 },
    ],
    8,
    true
  );
}

/**
 * Curved anatomical rib arch wrapping around the front (+X) ribcage for Walker & Spitter gore.
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
    const ang = (t - 0.5) * Math.PI * 0.84;
    pts.push(
      new THREE.Vector3(
        Math.cos(ang) * radiusX,
        -Math.abs(Math.sin(ang)) * 0.012,
        Math.sin(ang) * radiusZ
      )
    );
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 8, tubeRadius, 5, false);
  geo.computeVertexNormals();
  // Add warm aged-bone vertex colors (darker where ribs enter flesh, brighter across anterior sternum arch)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const frontT = clamp01(x / Math.max(0.01, radiusX));
    const shade = 0.62 + frontT * 0.36;
    cols[i * 3] = shade;
    cols[i * 3 + 1] = shade * 0.96;
    cols[i * 3 + 2] = shade * 0.86;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Rounded organic limb segment (arm, thigh, or calf) with subtle anatomical muscle swell
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
      { y: 0, rx: topRadius * 0.94, rz: topRadius * 0.94, ao: 0.76 },
      { y: length * 0.34, rx: midRadius * 1.04, rz: midRadius * 0.98, ao: 1.0 },
      { y: length * 0.68, rx: (midRadius + botRadius) * 0.5, rz: (midRadius + botRadius) * 0.48, ao: 0.95 },
      { y: length, rx: botRadius * 0.92, rz: botRadius * 0.92, ao: 0.78 },
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
    geo.rotateZ(-Math.PI * 0.5);
  } else {
    geo.rotateZ(Math.PI);
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Organic corded/tendon neck stalk bridging torso collar to skull base,
 * sculpted with subtle sternocleidomastoid ridges & cervical taper.
 */
export function createSculptedNeckGeometry(archetype: ZombieArchetype): THREE.BufferGeometry {
  const topR = archetype === 'bloater' ? 0.076 : archetype === 'spitter' ? 0.044 : 0.048;
  const botR = archetype === 'bloater' ? 0.104 : archetype === 'spitter' ? 0.058 : 0.066;
  return createOrganicLoftGeometry(
    [
      { y: -0.050, rx: botR, rz: botR * 1.12, offsetX: -0.024, chestPinch: 0.4, ao: 0.64 },
      { y: -0.002, rx: (topR + botR) * 0.48, rz: ((topR + botR) * 0.5) * 1.02, offsetX: -0.010, chestPinch: 0.5, ao: 0.84 },
      { y: 0.052, rx: topR, rz: topR * 0.94, offsetX: 0.002, ao: 0.80 },
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
  const rx = m.jawLength * 0.60;
  const rz = m.jawWidth * 0.36;
  return createOrganicLoftGeometry(
    [
      { y: -0.020, rx: rx * 0.85, rz: rz * 0.85, ao: 0.22 },
      { y: 0.0, rx, rz, ao: 0.34 },
      { y: 0.022, rx: rx * 0.9, rz: rz * 0.9, ao: 0.22 },
    ],
    8,
    true
  );
}

/**
 * Sculpted 3D ragged cloth hem / torn jacket tails wrapping around the zombie's waist/pelvis.
 * Breaks the smooth egg-torso silhouette with jagged hanging fabric strips and folds.
 */
export function createTatteredHemGeometry(opts: {
  topRx: number;
  topRz: number;
  length: number;
  flare?: number;
  seed?: number;
  frontGap?: number;
}): THREE.BufferGeometry {
  const { topRx, topRz, length, flare = 1.24, seed = 1, frontGap = 0.22 } = opts;
  const uSteps = 12;
  const vSteps = 2;
  const cols = uSteps + 1;
  const vertCount = cols * (vSteps + 1);
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let col = 0; col <= uSteps; col++) {
    const u = col / uSteps;
    // Wrap from front-right around back to front-left, leaving open lapel gap in front (+X)
    const span = Math.PI * 2 - frontGap * 2;
    const theta = frontGap + u * span;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const jag = 0.65 + 0.55 * Math.abs(Math.sin(col * 2.17 + seed * 3.1));
    const wave = Math.sin(col * 1.9 + seed) * 0.008;

    for (let row = 0; row <= vSteps; row++) {
      const vt = row / vSteps; // 0 = waist top, 1 = frayed ragged bottom edge
      const scale = 1 + (flare - 1) * vt;
      const drop = -length * vt * (row === vSteps ? jag : 0.48 + 0.1 * jag);
      const rBoost = vt * wave;

      const idx = row * cols + col;
      positions[idx * 3] = cosT * (topRx * scale + rBoost);
      positions[idx * 3 + 1] = drop;
      positions[idx * 3 + 2] = sinT * (topRz * scale + rBoost);

      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = 1 - vt;

      const ao = clamp(0.92 - vt * 0.34 - (row === vSteps ? 0.08 : 0), 0.35, 1.0);
      colors[idx * 3] = ao;
      colors[idx * 3 + 1] = ao;
      colors[idx * 3 + 2] = ao;
    }
  }

  for (let row = 0; row < vSteps; row++) {
    for (let col = 0; col < uSteps; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = (row + 1) * cols + col;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

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
 * Sculpted 3D torn jacket collar / frayed lapels wrapping around the neck and upper shoulders.
 */
export function createTornCollarGeometry(opts: {
  rx: number;
  rz: number;
  height: number;
  seed?: number;
}): THREE.BufferGeometry {
  const { rx, rz, height, seed = 7 } = opts;
  const uSteps = 10;
  const cols = uSteps + 1;
  const vertCount = cols * 2;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let col = 0; col <= uSteps; col++) {
    const u = col / uSteps;
    const theta = 0.38 + u * (Math.PI * 2 - 0.76); // open V-neck at front (+X)
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const lapelHeight = height * (0.7 + 0.45 * Math.sin(u * Math.PI) + 0.18 * Math.sin(col * 3.1 + seed));

    // Bottom edge seated into shoulders
    const i0 = col;
    positions[i0 * 3] = cosT * rx;
    positions[i0 * 3 + 1] = -0.015;
    positions[i0 * 3 + 2] = sinT * rz;
    uvs[i0 * 2] = u;
    uvs[i0 * 2 + 1] = 0;
    colors[i0 * 3] = 0.72;
    colors[i0 * 3 + 1] = 0.72;
    colors[i0 * 3 + 2] = 0.72;

    // Top flared tattered collar rim
    const i1 = cols + col;
    positions[i1 * 3] = cosT * (rx * 1.18);
    positions[i1 * 3 + 1] = lapelHeight;
    positions[i1 * 3 + 2] = sinT * (rz * 1.22);
    uvs[i1 * 2] = u;
    uvs[i1 * 2 + 1] = 1;
    colors[i1 * 3] = 0.96;
    colors[i1 * 3 + 1] = 0.96;
    colors[i1 * 3 + 2] = 0.96;
  }

  for (let col = 0; col < uSteps; col++) {
    const a = col;
    const b = col + 1;
    const c = cols + col;
    const d = c + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

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
 * Irregular organic dimpled necrotic boil / pustule with flared dark crater base
 * and taut asymmetrical apex (replaces generic floating icosahedron ping-pong balls).
 */
export function createSculptedBoilGeometry(seed = 1): THREE.BufferGeometry {
  const uSteps = 9;
  const vSteps = 5;
  const cols = uSteps + 1;
  const vertCount = cols * (vSteps + 1);
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let row = 0; row <= vSteps; row++) {
    const vNorm = 1 - row / vSteps; // 1 = top apex, 0 = embedded base
    const phi = (row / vSteps) * Math.PI * 0.88; // flattened dome sitting deep into flesh
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);

    for (let col = 0; col <= uSteps; col++) {
      const uNorm = col / uSteps;
      const theta = uNorm * Math.PI * 2;
      const asym =
        1.0 +
        0.16 * Math.sin(theta * 2 + seed * 1.9) +
        0.09 * Math.cos(theta * 3 - seed * 2.7);
      const r = 0.046 * asym;

      // Slight dimple near tip + flared necrotic collar at base
      const craterBase = row === vSteps ? 1.12 : 1.0;
      const x = sinP * Math.cos(theta) * r * craterBase;
      const y = (cosP * 0.038 - (row === 0 ? 0.004 : 0));
      const z = sinP * Math.sin(theta) * r * craterBase;

      const idx = row * cols + col;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;
      uvs[idx * 2] = uNorm;
      uvs[idx * 2 + 1] = vNorm;

      // Dark bruised necrotic rim at base -> brighter taut pressurized apex
      const ao = clamp(0.42 + vNorm * 0.58, 0.35, 1.0);
      colors[idx * 3] = ao;
      colors[idx * 3 + 1] = ao;
      colors[idx * 3 + 2] = ao;
    }
  }

  for (let row = 0; row < vSteps; row++) {
    for (let col = 0; col < uSteps; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = (row + 1) * cols + col;
      const d = c + 1;
      if (row > 0) indices.push(a, b, c);
      indices.push(b, d, c);
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
 * Clinging matted ragged 3D hair cap & drooping nape/temple strands hugging the zombie cranium
 * (leaves face, brow, and Walker's left-parietal cranial trauma cleanly exposed; zero horn/ear spikes).
 */
export function createSculptedHairCrownGeometry(archetype: ZombieArchetype): THREE.BufferGeometry {
  const m = getSkullMetrics(archetype);
  const uSteps = 12;
  const vSteps = 4;
  const cols = uSteps + 1;
  const vertCount = cols * (vSteps + 1);
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  const rx = archetype === 'runner' ? 0.128 : 0.122;
  const ry = archetype === 'runner' ? 0.116 : 0.124;
  const rz = archetype === 'runner' ? 0.112 : 0.113;

  for (let row = 0; row <= vSteps; row++) {
    const vt = row / vSteps; // 0 = crown apex, 1 = jagged clinging hairline / nape fringe
    for (let col = 0; col <= uSteps; col++) {
      const u = col / uSteps;
      const theta = (u - 0.5) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Natural receding undead hairline: high on forehead (+X), sweeping smoothly down temples & nape (-X)
      const backFactor = smoothstep(0.65, -0.65, cosT);
      const jag = 0.06 * Math.sin(col * 3.7 + (archetype === 'runner' ? 2.1 : 0.6));
      const maxPhi = clamp(0.42 + backFactor * 0.94 + jag * vt, 0.36, 1.42);
      const phi = 0.04 + vt * maxPhi;

      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);
      // Uniform clearance outside cranial dome so forehead never pokes through hair cap
      const flare = 1.0 + 0.025 * vt + (row === vSteps ? 0.02 * Math.sin(col * 4.3) : 0);

      // Match skull occiput fullness smoothly at rear (-X)
      const occiput = smoothstep(-0.1, 0.55, cosP) * smoothstep(0.15, -0.6, sinP * cosT);
      const x = sinP * cosT * rx * flare - 0.015 * occiput;
      const y = cosP * ry * flare - (row === vSteps ? backFactor * 0.012 : 0);
      const z = sinP * sinT * rz * flare;

      const idx = row * cols + col;
      positions[idx * 3] = x + m.centerX;
      positions[idx * 3 + 1] = y + m.centerY;
      positions[idx * 3 + 2] = z;

      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = 1 - vt;

      const ao = clamp(0.86 - vt * 0.32 - (1 - backFactor) * 0.08, 0.38, 0.94);
      colors[idx * 3] = ao;
      colors[idx * 3 + 1] = ao;
      colors[idx * 3 + 2] = ao;
    }
  }

  for (let row = 0; row < vSteps; row++) {
    for (let col = 0; col < uSteps; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = (row + 1) * cols + col;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
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
 * Curved dorsal protruding vertebral bone spines running along a hunched zombie back.
 */
export function createSculptedSpineFinGeometry(count = 5, scale = 1.0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const arch = Math.sin(t * Math.PI);
    const len = (0.032 + arch * 0.034) * scale;
    const rad = (0.009 + arch * 0.006) * scale;
    const spike = createOrganicLoftGeometry(
      [
        { y: 0, rx: rad * 1.25, rz: rad * 0.75, ao: 0.55 },
        { y: len * 0.55, rx: rad * 0.72, rz: rad * 0.48, offsetX: 0.006 * scale, ao: 0.92 },
        { y: len, rx: rad * 0.14, rz: rad * 0.12, offsetX: 0.012 * scale, ao: 1.0 },
      ],
      4,
      true
    );
    // Point backward (-X) and slightly upward (+Y)
    spike.rotateZ(1.18 - t * 0.25);
    spike.translate(-0.005 * arch, t * 0.24 * scale, 0);
    parts.push(spike);
  }
  return mergePartGeometries(parts);
}

/**
 * Distended bioluminescent throat/gular venom pouch seated cleanly beneath the Spitter's mandible.
 */
export function createSculptedThroatSacGeometry(): THREE.BufferGeometry {
  return createOrganicLoftGeometry(
    [
      { y: -0.068, rx: 0.022, rz: 0.026, offsetX: 0.014, ao: 0.65 },
      { y: -0.044, rx: 0.048, rz: 0.054, offsetX: 0.028, ao: 1.0 },
      { y: -0.016, rx: 0.044, rz: 0.050, offsetX: 0.020, ao: 0.92 },
      { y: 0.010, rx: 0.028, rz: 0.034, offsetX: 0.006, ao: 0.55 },
    ],
    8,
    true
  );
}

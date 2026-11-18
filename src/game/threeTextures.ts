import * as THREE from 'three';
import { derivePlayerPalette, shadeHex } from './profile';
import type { ItemId, TileKind } from './types';

function makePixelCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function toNearestTexture(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a high-resolution 32x32 square pixel-art canvas for any ground tile kind & variant,
 * preserving ASHFALL's gritty survival palette with crisp blades, cracks, planks, and mortar.
 */
export function buildSquareTileCanvas(kind: TileKind, variant: number): HTMLCanvasElement {
  const size = 32;
  const [c, ctx] = makePixelCanvas(size, size);

  const hash = (x: number, y: number, s = 0) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + variant * 74.7 + s * 19.3) * 43758.5453;
    return n - Math.floor(n);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = hash(x, y);
      const r2 = hash(Math.floor(x / 2), Math.floor(y / 2), 3);
      let col = '#2e3b26';

      if (kind === 'grass') {
        if (r2 < 0.2) col = '#4f7d3a';
        else if (r2 < 0.56) col = '#3c662e';
        else col = '#2d4f22';
        if (r < 0.14) col = '#5a8c43';
        else if (r > 0.88) col = '#233d1a';
        // Crisp 2-3px grass blade tufts & dry clover
        const blade = hash(x, y - 1, 7) > 0.91 && y > 1;
        if (blade) col = r > 0.5 ? '#74ab52' : '#619446';
        if (variant === 3 && r < 0.028) col = '#9bb056';
      } else if (kind === 'dirt') {
        if (r2 < 0.22) col = '#69503b';
        else if (r2 < 0.65) col = '#543f2d';
        else col = '#402f21';
        if (r < 0.1) col = '#7a5d45';
        else if (r > 0.91) col = '#2e2117';
        if ((x * 5 + y * 9 + variant * 7) % 23 === 0 && r > 0.5) col = '#87725c'; // pebble
      } else if (kind === 'road' || kind === 'crosswalk') {
        if (r < 0.12) col = '#2d333d';
        else if (r < 0.54) col = '#21262e';
        else if (r < 0.88) col = '#1b1f26';
        else col = '#14171c';
        if (kind === 'road') {
          // Aged center dashed/double paint & oil stain
          if (variant === 0 && y >= 14 && y <= 17 && x >= 5 && x <= 26) {
            col = r < 0.14 ? '#8f7228' : y === 14 ? '#e6bc4e' : '#cfa43a';
          }
          if (variant === 2) {
            const dx = x - 15.5;
            const dy = y - 15.5;
            if (dx * dx + dy * dy < 32 && r < 0.72) col = '#101317';
          }
        } else {
          const bar = (x + 2) % 10;
          if (bar >= 2 && bar <= 5 && y >= 4 && y <= 27) {
            col = r < 0.14 ? '#8c8a82' : r > 0.84 ? '#ebe6da' : '#d1ccc0';
          }
        }
      } else if (kind === 'sidewalk') {
        const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1;
        const slabJoint = x === 16 || y === 16;
        if (isBorder) col = x === 0 || y === 0 ? '#cfc0a5' : '#695e4c';
        else if (slabJoint) col = '#594f40';
        else if (x === 17 || y === 17) col = '#bfb095';
        else if (r < 0.24) col = '#b3a388';
        else if (r < 0.78) col = '#a19278';
        else col = '#8c7e66';
        if (variant === 2 && (slabJoint || Math.abs(x - y) <= 0.7) && r > 0.7) col = '#55753d';
      } else if (kind === 'floor') {
        const plankRow = Math.floor(y / 8);
        const plankSeamY = y % 8 === 0;
        const buttJoint = (x + plankRow * 13 + variant * 5) % 24 === 0;
        const grain = hash(Math.floor(x / 3), y, 11);
        if (plankSeamY || buttJoint) col = '#2b1e14';
        else if (y % 8 === 1) col = '#826247';
        else if (grain < 0.24) col = '#73563e';
        else if (grain < 0.72) col = '#5e4532';
        else col = '#4c3727';
        if ((y % 8 === 2 || y % 8 === 6) && (x + plankRow * 13 + variant * 5) % 24 === 2) col = '#221810'; // nail head
      } else if (kind === 'floor_rug') {
        const outer = x <= 1 || y <= 1 || x >= size - 2 || y >= size - 2;
        const innerBand = x === 4 || y === 4 || x === size - 5 || y === size - 5;
        const diamond = Math.abs(((x % 8) - 3.5)) + Math.abs(((y % 8) - 3.5)) <= 2.5;
        if (outer) {
          col = (x + y) % 2 === 0 ? '#c49b56' : '#854632';
        } else if (innerBand) {
          col = '#d9b56c';
        } else if (diamond) {
          col = r < 0.25 ? '#b35746' : '#963f33';
        } else {
          col = r < 0.22 ? '#87382c' : '#6e2a21';
        }
      } else if (kind === 'floor_bath') {
        const u = Math.floor(x / 8);
        const v = Math.floor(y / 8);
        const grout = x % 8 === 0 || y % 8 === 0;
        const hi = x % 8 === 1 || y % 8 === 1;
        if (grout) col = '#3c4e52';
        else if (hi) col = (u + v) % 2 === 0 ? '#a8cccf' : '#82a7ad';
        else col = (u + v) % 2 === 0 ? (r < 0.2 ? '#82a3a6' : '#95b8ba') : r < 0.2 ? '#64858a' : '#719499';
      } else if (kind === 'floor_porch') {
        const isEdge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
        const seam = x % 8 === 0;
        if (isEdge) col = '#3b2719';
        else if (seam) col = '#2b1c11';
        else if (x % 8 === 1) col = '#9c6e46';
        else col = r < 0.3 ? '#8a603c' : r < 0.75 ? '#734f31' : '#5e3f26';
      } else if (kind === 'tile_clinic') {
        const u = Math.floor(x / 8);
        const v = Math.floor(y / 8);
        const grout = x % 8 === 0 || y % 8 === 0;
        if (grout) col = '#53615d';
        else if (x % 8 === 1 || y % 8 === 1) col = '#adc2ba';
        else col = (u + v) % 2 === 0 ? (r < 0.18 ? '#8ea19a' : '#a0b5ad') : r < 0.2 ? '#7c8f88' : '#8da199';
        if (variant === 3 && Math.hypot(x - 19, y - 14) < 5 && r > 0.32) col = '#702622';
      } else if (kind === 'tile_diner') {
        const u = Math.floor(x / 8);
        const v = Math.floor(y / 8);
        const even = (u + v) % 2 === 0;
        const grout = x % 8 === 0 || y % 8 === 0;
        if (grout) col = '#1b1e21';
        else col = even ? (r < 0.2 ? '#b5aa99' : '#ccc2b0') : r < 0.2 ? '#292e36' : '#363d47';
      } else if (kind === 'water') {
        const wave = ((x + y * 2 + variant * 3) % 11 === 0 || (x - y + variant * 5 + 64) % 15 === 0) && r < 0.45;
        col = wave ? '#4c8ca3' : r < 0.22 ? '#2a5f75' : r > 0.85 ? '#183c4d' : '#1f4a5c';
      } else if (kind === 'pier') {
        const plankSeam = x % 6 === 0;
        const rail = y <= 1 || y >= size - 2;
        if (rail) col = y === 0 || y === size - 1 ? '#2e1e12' : '#543823';
        else if (plankSeam) col = '#2b1d12';
        else if (x % 6 === 1) col = '#a8764a';
        else col = r < 0.28 ? '#94673f' : r < 0.76 ? '#7a5332' : '#634125';
      } else if (kind === 'forest_floor') {
        if (r2 < 0.2) col = '#375429';
        else if (r2 < 0.55) col = '#473221';
        else col = '#332417';
        if (r < 0.14) col = '#543c28';
        else if (r > 0.9) col = '#211810';
        if (((x * 3 + y * 7 + variant) % 17 === 0) && r > 0.42) col = '#7a5837'; // pine needles
        if (variant === 2 && r2 < 0.26 && r < 0.28) col = '#578240'; // moss carpet
      } else if (kind === 'gravel') {
        const cell = hash(Math.floor(x / 2), Math.floor(y / 2), 9);
        if (cell < 0.18) col = '#948e82';
        else if (cell < 0.52) col = '#787268';
        else if (cell < 0.82) col = '#5e5951';
        else col = '#45413b';
        if (x % 2 === 0 && y % 2 === 0 && cell > 0.7) col = '#b0aa9c';
      } else if (kind === 'mud') {
        if (r2 < 0.22) col = '#453224';
        else if (r2 < 0.62) col = '#36261a';
        else col = '#261a11';
        if (variant === 1 && Math.hypot(x - 15, y - 16) < 7 && r < 0.65) {
          col = r < 0.2 ? '#4d7080' : '#354f5c';
        }
      } else if (kind === 'sand') {
        const ripple = Math.sin((x + y * 0.4) * 0.45 + variant) > 0.55;
        if (ripple && r > 0.35) col = '#c4a976';
        else if (r < 0.2) col = '#b39866';
        else if (r < 0.75) col = '#9c8254';
        else col = '#806942';
        if (r > 0.95) col = '#d9bf8c';
      } else if (kind === 'asphalt_cracked') {
        const crack =
          Math.abs(x - y - (variant - 1) * 5) <= 0.8 ||
          (x >= 9 && x <= 25 && Math.abs(y - 18 + Math.sin(x * 0.6) * 2) <= 0.7);
        if (crack) col = r > 0.72 ? '#526b39' : '#0f1216';
        else if (r < 0.14) col = '#2d333c';
        else if (r < 0.58) col = '#20252c';
        else col = '#181b21';
      }

      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function buildWallSideTexture(
  kind: 'wall_brick' | 'wall_wood' | 'wall_interior',
  hasWindow: boolean
): THREE.CanvasTexture {
  const w = 16;
  const h = 18;
  const [c, ctx] = makePixelCanvas(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let col = '#8f3c2b';
      if (hasWindow && y >= 4 && y <= 11 && x >= 3 && x <= 12) {
        const isFrame = y === 4 || y === 11 || x === 3 || x === 12;
        const isPlank = y === 6 || y === 9;
        if (isFrame) col = '#332216';
        else if (isPlank) col = '#996a42';
        else col = '#182836';
      } else if (kind === 'wall_brick') {
        if (y <= 1) col = '#b8a88e';
        else if (y >= 16) col = '#665b4c';
        else {
          const course = Math.floor(y / 3);
          const isMortarH = y % 3 === 0;
          const isMortarV = (x + (course % 2) * 3) % 6 === 0;
          if (isMortarH || isMortarV) col = '#5c4b42';
          else {
            const shade = (x * 7 + course * 13) % 5;
            col = shade === 0 ? '#bd563e' : shade < 3 ? '#a14430' : '#853525';
          }
          if (y > 13 && (x + y) % 3 === 0) col = '#4a6b35';
        }
      } else if (kind === 'wall_wood') {
        const plankEdge = x % 4 === 0;
        const crossBrace = Math.abs(y - x * 1.1) < 1.3;
        if (y <= 1 || y >= 16 || x === 0 || x === w - 1) col = '#6b4224';
        else if (plankEdge) col = '#2e1c10';
        else if (crossBrace) col = '#b37644';
        else col = (x + y * 2) % 5 === 0 ? '#7d4e2b' : '#996136';
      } else {
        if (y <= 1) col = '#dfd6bf';
        else if (y === 8) col = '#855836';
        else if (y >= 9) col = x % 4 === 0 ? '#422a19' : '#91633e';
        else col = (x + y) % 5 === 0 ? '#bfb6a1' : '#cfc6b0';
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildWallCapTexture(kind: 'wall_brick' | 'wall_wood' | 'wall_interior'): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      let col = '#9c8d76';
      if (kind === 'wall_brick') {
        col = edge ? '#756857' : (x + y) % 4 === 0 ? '#b5a58c' : '#9c8d76';
      } else if (kind === 'wall_wood') {
        col = edge ? '#52331d' : (x + y) % 2 === 0 ? '#8c5a34' : '#734727';
      } else {
        col = edge ? '#75624e' : (x + y) % 3 === 0 ? '#bdb19b' : '#a89c86';
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildCrateSideTexture(mil: boolean): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(48, 48);
  const hi = mil ? '#7b8f5e' : '#c98e59';
  const base = mil ? '#596b42' : '#96663d';
  const shadow = mil ? '#3e4c2d' : '#6e4829';
  const trim = mil ? '#1a2016' : '#29190e';
  const metal = mil ? '#49524c' : '#5e656b';
  const rivet = '#9aa3aa';

  drawZombieDither(ctx, 0, 0, 48, 48, base, hi, shadow, mil ? 81 : 82);
  // Horizontal planks / stamped ribs
  for (let y = 8; y < 44; y += 8) {
    drawPixelRect(ctx, 4, y, 40, 1, trim);
    drawPixelRect(ctx, 4, y + 1, 40, 1, hi);
  }
  if (!mil) {
    // Diagonal wooden cross-brace
    for (let i = 6; i < 42; i++) {
      drawPixelRect(ctx, i - 1, i - 1, 4, 4, trim);
      drawPixelRect(ctx, i, i, 3, 3, hi);
    }
  } else {
    // Military hazard band, stenciled markings & side carry handle recess
    drawPixelRect(ctx, 5, 16, 38, 4, '#e0bd53');
    drawPixelRect(ctx, 5, 16, 38, 1, '#f7dc7e');
    drawPixelRect(ctx, 14, 25, 20, 6, '#23291d');
    drawPixelRect(ctx, 16, 27, 16, 2, '#96a194');
    // Stencil block letters/digits
    drawPixelRect(ctx, 10, 10, 6, 3, '#e8d79b');
    drawPixelRect(ctx, 19, 10, 9, 3, '#e8d79b');
    drawPixelRect(ctx, 31, 10, 5, 3, '#e8d79b');
  }
  // Outer bevel frame & steel corner L-brackets + rivets
  drawPixelRect(ctx, 0, 0, 48, 4, trim);
  drawPixelRect(ctx, 0, 44, 48, 4, trim);
  drawPixelRect(ctx, 0, 0, 4, 48, trim);
  drawPixelRect(ctx, 44, 0, 4, 48, trim);
  drawPixelRect(ctx, 2, 2, 44, 2, hi);
  drawPixelRect(ctx, 2, 2, 2, 44, hi);

  for (const [cx, cy] of [[1, 1], [37, 1], [1, 37], [37, 37]] as const) {
    drawPixelRect(ctx, cx, cy, 10, 10, metal);
    drawPixelRect(ctx, cx + 1, cy + 1, 8, 8, '#6e767d');
    drawPixelRect(ctx, cx + 2, cy + 2, 2, 2, rivet);
    drawPixelRect(ctx, cx + 6, cy + 6, 2, 2, rivet);
  }
  return toNearestTexture(c);
}

function buildCrateTopTexture(mil: boolean): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(48, 48);
  const hi = mil ? '#7b8f5e' : '#c98e59';
  const base = mil ? '#65784b' : '#ad794b';
  const shadow = mil ? '#475734' : '#7a5230';
  const trim = mil ? '#1a2016' : '#29190e';
  const metal = mil ? '#49524c' : '#5e656b';

  drawZombieDither(ctx, 0, 0, 48, 48, base, hi, shadow, mil ? 83 : 84);
  for (let x = 8; x < 44; x += 8) {
    drawPixelRect(ctx, x, 4, 1, 40, trim);
    drawPixelRect(ctx, x + 1, 4, 1, 40, hi);
  }
  drawPixelRect(ctx, 0, 0, 48, 4, trim);
  drawPixelRect(ctx, 0, 44, 48, 4, trim);
  drawPixelRect(ctx, 0, 0, 4, 48, trim);
  drawPixelRect(ctx, 44, 0, 4, 48, trim);
  drawPixelRect(ctx, 3, 3, 42, 2, metal);
  drawPixelRect(ctx, 3, 43, 42, 2, metal);
  drawPixelRect(ctx, 3, 3, 2, 42, metal);
  drawPixelRect(ctx, 43, 3, 2, 42, metal);
  if (mil) {
    drawPixelRect(ctx, 18, 18, 12, 12, '#2d3624');
    drawPixelRect(ctx, 20, 20, 8, 8, '#d9b84e');
    drawPixelRect(ctx, 22, 22, 4, 4, '#2d3624');
  } else {
    // Diagonal cleat bar
    drawPixelRect(ctx, 6, 21, 36, 6, shadow);
    drawPixelRect(ctx, 7, 22, 34, 3, hi);
  }
  return toNearestTexture(c);
}

function buildBookshelfFrontTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 20);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 16; x++) {
      let col = '#593b24';
      if (x === 0 || x === 15 || y === 0 || y === 19) col = '#1f150e';
      else if (y === 1 || y === 6 || y === 11 || y === 16) col = '#7a5437';
      else if (x >= 2 && x <= 13) {
        const b = (x + y * 3) % 5;
        if (x % 4 === 0) col = '#261c14';
        else col = b === 0 ? '#9c3b33' : b === 1 ? '#4a7052' : b === 2 ? '#45688a' : b === 3 ? '#c29848' : '#735a42';
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildBarrierTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const hazard = (x + y) % 6 < 2 && y <= 3;
      let col = y >= 5 ? '#877f70' : '#ada493';
      if (hazard) col = '#eba834';
      if (x === 0 || x === 15 || y === 0 || y === 7) col = '#3d372f';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildDoorTexture(locked: boolean): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(12, 18);
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 12; x++) {
      let col = x % 3 === 0 ? '#6e4527' : '#96623b';
      if (x === 0 || x === 11 || y === 0 || y === 17) col = '#21160f';
      else if (locked && y >= 7 && y <= 10 && x >= 4 && x <= 7) col = y === 8 ? '#f5cb52' : '#c49129';
      else if (y >= 8 && y <= 9 && x === 9) col = '#f2cc5c';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildPineFoliageTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(48, 48);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const n = pxHash(x, y, 51);
      // ConeGeometry maps v=0 (bottom of canvas, y=47) to outer cone rim, v=1 (y=0) to apex.
      const rimTooth = (x + Math.floor(y * 0.4)) % 8 < 2 || (x % 6 === 0 && y > 30);
      const boughShadow = (y >= 37 && ((x % 6 === 0) || (x % 6 === 1))) || (y === 47);
      const needleCluster = ((x + y * 2) % 7 <= 1) && n > 0.35;
      const sunlit = y < 28 && n > 0.54 && !rimTooth;
      let col = '#2e5c2b';
      if (boughShadow) col = '#173317';
      else if (rimTooth) col = '#1f421f';
      else if (sunlit) col = n > 0.8 ? '#7dbf58' : '#5da143';
      else if (needleCluster) col = '#47823a';
      else if (n < 0.25) col = '#244722';
      else if (n < 0.7) col = '#386b33';
      else col = '#447a38';
      if ((x * 7 + y * 13) % 53 === 0 && y > 10) col = '#543922';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildTreeRingTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const r = Math.hypot(dx, dy);
      const n = pxHash(x, y, 67);
      const ang = Math.atan2(dy, dx);
      const radialCrack = (Math.abs(ang - 0.55) < 0.08 && r > 3 && r < 14) || (Math.abs(ang + 2.1) < 0.07 && r > 4 && r < 12);
      let col = '#c79763';
      if (r >= 13.8) col = '#452b19'; // outer dark bark rim
      else if (radialCrack) col = '#472c18';
      else if (r < 3.2) col = '#784e2d'; // dark heartwood pith
      else {
        const ring = Math.floor(r + (n - 0.5) * 0.65) % 2 === 0;
        if (r > 11.2) col = ring ? '#b58654' : '#d6a874';
        else col = ring ? '#8a5d38' : '#ba8b59';
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildBarkTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(32, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 32; x++) {
      const n = pxHash(x, y, 61);
      const furrow = x % 5 === 0 || (x % 5 === 1 && n < 0.45);
      const ridge = x % 5 === 3;
      const knot = Math.hypot(x - 16, y - 28) < 3.4 || Math.hypot(x - 8, y - 48) < 2.6;
      let col = '#6b452a';
      if (knot) col = '#332014';
      else if (furrow) col = '#3a2416';
      else if (ridge) col = n > 0.35 ? '#8f5e3c' : '#7d5233';
      else if (n > 0.8) col = '#7d5234';
      else if (n < 0.16) col = '#4d311d';
      if (y > 50 && n > 0.74) col = '#4d7839'; // moss at root base
      if (y < 40 && (x * 11 + y * 17) % 53 === 0) col = '#84945e'; // lichen fleck
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildQuiltTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const stripe = x % 3 === 0 || y === 2 || y === 13;
      ctx.fillStyle = edge ? '#241810' : stripe ? '#496343' : '#618259';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildDecalTexture(kind: 'blood' | 'scorch' | 'acid' | 'tire'): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  if (kind === 'tire') {
    ctx.fillStyle = '#131618';
    ctx.fillRect(2, 4, 12, 2);
    ctx.fillRect(2, 10, 12, 2);
  } else {
    const main = kind === 'blood' ? '#6e1919' : kind === 'acid' ? '#4fb848' : '#1b1d1f';
    const hi = kind === 'blood' ? '#4a0f0f' : kind === 'acid' ? '#85e655' : '#101214';
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const d2 = dx * dx + dy * dy + ((x * 13 + y * 7) % 5);
        if (d2 < 28) {
          ctx.fillStyle = d2 < 11 ? hi : main;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }
  return toNearestTexture(c);
}

function buildBulletImpactTexture(
  kind: 'stone' | 'wood' | 'metal' | 'blood_wall'
): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(14, 14);
  if (kind === 'blood_wall') {
    for (let y = 0; y < 14; y++) {
      for (let x = 0; x < 14; x++) {
        const dx = x - 6.5;
        const dy = y - 5.2;
        const n = (x * 17 + y * 13) % 7;
        const d2 = dx * dx + dy * dy + (n - 3) * 1.4;
        const drip = x >= 5 && x <= 8 && y >= 6 && y <= 12 && (x === 6 || (x === 7 && y <= 10));
        const fleck = d2 < 22 && n % 2 === 0;
        if (d2 < 8 || drip) {
          ctx.fillStyle = d2 < 3 ? '#4a0b0b' : '#731414';
          ctx.fillRect(x, y, 1, 1);
        } else if (d2 < 14 || fleck) {
          ctx.fillStyle = '#991e1e';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    return toNearestTexture(c);
  }

  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 14; x++) {
      const dx = x - 6.5;
      const dy = y - 6.5;
      const d = Math.hypot(dx, dy);
      const n = (x * 11 + y * 19) % 5;
      const crack =
        (Math.abs(dx - dy) < 0.85 && d < 5.2) ||
        (Math.abs(dx + dy * 0.6) < 0.8 && d < 4.8);

      if (d <= 1.85) {
        ctx.fillStyle = kind === 'wood' ? '#170f0a' : '#0c0e10';
        ctx.fillRect(x, y, 1, 1);
      } else if (d <= 3.15 + (n === 0 ? 0.5 : 0)) {
        if (kind === 'stone') {
          ctx.fillStyle = n < 2 ? '#34383d' : '#525860';
        } else if (kind === 'wood') {
          ctx.fillStyle = n < 2 ? '#452a17' : '#855836';
        } else {
          ctx.fillStyle = n < 2 ? '#4d565e' : '#96a1ab';
        }
        ctx.fillRect(x, y, 1, 1);
      } else if (crack || (d <= 4.3 && n === 4)) {
        if (kind === 'stone') {
          ctx.fillStyle = n === 4 ? '#8c9296' : '#25282c';
        } else if (kind === 'wood') {
          ctx.fillStyle = n === 4 ? '#b88858' : '#301d10';
        } else {
          ctx.fillStyle = n === 4 ? '#c7d1d9' : '#24292e';
        }
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return toNearestTexture(c);
}

function buildDumpsterSideTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 12);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 16; x++) {
      let col = x % 4 === 0 ? '#314737' : '#45634d';
      if (y <= 2) col = '#222825';
      if (x === 0 || x === 15 || y === 0 || y === 11) col = '#161b18';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildSandbagTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const seam = x % 4 === 0 || y === 3 || y === 7;
      ctx.fillStyle = seam ? '#453d2e' : (x + y) % 2 === 0 ? '#756851' : '#6e624d';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function drawPixelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function buildWoodPlankTexture(base: string, hi: string, dark: string, border = '#1c120c'): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const seam = y % 4 === 0;
      const grain = (x + y * 2) % 5 === 0;
      ctx.fillStyle = edge ? border : seam ? dark : grain ? hi : base;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function pxHash(x: number, y: number, seed = 1): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function drawPixelDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string
): void {
  ctx.fillStyle = color;
  const r2 = r * r;
  const x0 = Math.floor(cx - r);
  const x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r);
  const y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function drawZombieDither(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  base: string,
  hi: string,
  dark: string,
  seed: number
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const n = pxHash(x, y, seed);
      ctx.fillStyle = n < 0.16 ? dark : n > 0.86 ? hi : base;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function buildActorHeadTextures(kind: 'player' | 'walker' | 'runner' | 'bloater' | 'spitter'): {
  front: THREE.CanvasTexture;
  back: THREE.CanvasTexture;
  side: THREE.CanvasTexture;
  top: THREE.CanvasTexture;
  jaw?: THREE.CanvasTexture;
} {
  if (kind === 'player') {
    const [cf, fctx] = makePixelCanvas(16, 16);
    const [cb, bctx] = makePixelCanvas(16, 16);
    const [cs, sctx] = makePixelCanvas(16, 16);
    const [ct, tctx] = makePixelCanvas(16, 16);

    const pal = derivePlayerPalette();
    const skin = pal.skin;
    const skinShadow = pal.skinShadow;
    const capMain = pal.hair;
    const capHi = shadeHex(pal.hair, 1.35);
    const capBrim = shadeHex(pal.hair, 0.55);
    const capBack = shadeHex(pal.hair, 0.5);

    drawPixelRect(fctx, 0, 0, 16, 16, '#14171a');
    drawPixelRect(fctx, 1, 1, 14, 14, skin);
    drawPixelRect(fctx, 1, 12, 14, 3, skinShadow);

    drawPixelRect(bctx, 0, 0, 16, 16, '#14171a');
    drawPixelRect(bctx, 1, 1, 14, 14, skinShadow);

    drawPixelRect(sctx, 0, 0, 16, 16, '#14171a');
    drawPixelRect(sctx, 1, 1, 14, 14, skin);
    drawPixelRect(sctx, 1, 11, 14, 4, skinShadow);

    drawPixelRect(tctx, 0, 0, 16, 16, '#14171a');
    drawPixelRect(tctx, 1, 1, 14, 14, capMain);
    drawPixelRect(tctx, 2, 2, 12, 12, capHi);
    drawPixelRect(tctx, 4, 4, 8, 8, capMain);

    drawPixelRect(fctx, 1, 1, 14, 4, capMain);
    drawPixelRect(fctx, 3, 1, 10, 2, capHi);
    drawPixelRect(fctx, 1, 5, 14, 2, capBrim);
    drawPixelRect(fctx, 2, 7, 12, 4, '#1e2226');
    drawPixelRect(fctx, 3, 8, 4, 2, '#e89b38');
    drawPixelRect(fctx, 9, 8, 4, 2, '#e89b38');
    drawPixelRect(fctx, 4, 8, 2, 1, '#ffd98a');
    drawPixelRect(fctx, 10, 8, 2, 1, '#ffd98a');
    drawPixelRect(fctx, 1, 11, 14, 4, '#7a5438');
    drawPixelRect(fctx, 3, 12, 10, 1, '#5c3d27');

    drawPixelRect(sctx, 1, 1, 14, 5, capMain);
    drawPixelRect(sctx, 2, 1, 12, 2, capHi);
    drawPixelRect(sctx, 1, 6, 14, 2, '#1e2226');
    drawPixelRect(sctx, 1, 8, 14, 3, skinShadow);
    drawPixelRect(sctx, 1, 11, 14, 4, '#7a5438');

    drawPixelRect(bctx, 1, 1, 14, 6, capMain);
    drawPixelRect(bctx, 3, 2, 10, 2, capHi);
    drawPixelRect(bctx, 5, 5, 6, 2, capBack);
    drawPixelRect(bctx, 1, 7, 14, 4, shadeHex(pal.hair, 0.62));
    drawPixelRect(bctx, 1, 11, 14, 4, '#7a5438');

    return {
      front: toNearestTexture(cf),
      back: toNearestTexture(cb),
      side: toNearestTexture(cs),
      top: toNearestTexture(ct),
    };
  }

  // High-resolution 64x64 sculpted pixel-art textures for all zombie archetypes
  const S = 64;
  const [cf, fctx] = makePixelCanvas(S, S);
  const [cb, bctx] = makePixelCanvas(S, S);
  const [cs, sctx] = makePixelCanvas(S, S);
  const [ct, tctx] = makePixelCanvas(S, S);

  const pal =
    kind === 'walker'
      ? { skin: '#7d9478', hi: '#9db897', dark: '#4c6148', rot: '#2d3b2b', eye: '#ff4d42', eyeCore: '#ffe0b8', seed: 11 }
      : kind === 'runner'
        ? { skin: '#996c68', hi: '#b88580', dark: '#5e3533', rot: '#381616', eye: '#ff5233', eyeCore: '#fff0bd', seed: 23 }
        : kind === 'bloater'
          ? { skin: '#6f8c49', hi: '#96b569', dark: '#415727', rot: '#273616', eye: '#c4f24b', eyeCore: '#f6ffd6', seed: 37 }
          : { skin: '#58827d', hi: '#78aba5', dark: '#304c49', rot: '#1a2b2a', eye: '#6ef7be', eyeCore: '#e8fff6', seed: 53 };

  for (const [idx, ctx] of [fctx, bctx, sctx, tctx].entries()) {
    drawPixelRect(ctx, 0, 0, S, S, '#101215');
    drawZombieDither(ctx, 2, 2, S - 4, S - 4, pal.skin, pal.hi, pal.dark, pal.seed + idx * 7);
    // Ambient lower-jaw/crown shading
    drawPixelRect(ctx, 2, 50, S - 4, 12, pal.dark);
    drawPixelRect(ctx, 2, 2, S - 4, 6, pal.hi);
  }

  // Scalp / rotting cranial patches on back, side, and top
  drawZombieDither(tctx, 8, 8, 48, 48, pal.dark, pal.skin, pal.rot, pal.seed + 91);
  drawZombieDither(bctx, 4, 4, 56, 40, pal.dark, pal.skin, pal.rot, pal.seed + 97);
  drawZombieDither(sctx, 4, 4, 56, 22, pal.dark, pal.skin, pal.rot, pal.seed + 101);

  // Forehead wrinkles, rot blotches & brow ridge
  drawZombieDither(fctx, 6, 4, 52, 12, pal.dark, pal.skin, pal.rot, pal.seed + 3);
  drawPixelRect(fctx, 10, 17, 44, 4, pal.rot); // Heavy brow shadow
  drawPixelRect(fctx, 12, 15, 18, 3, pal.hi);   // Brow bone highlights
  drawPixelRect(fctx, 34, 15, 18, 3, pal.hi);

  // Deeply sunken eye sockets + glowing irises + dark nasal cavity
  drawPixelDisc(fctx, 20, 27, 8.5, '#120d0e');
  drawPixelDisc(fctx, 44, 27, 8.5, '#120d0e');
  drawPixelDisc(fctx, 20, 27, 6.0, '#1f1214');
  drawPixelDisc(fctx, 44, 27, 6.0, '#1f1214');
  drawPixelDisc(fctx, 20, 27, 3.6, pal.eye);
  drawPixelDisc(fctx, 44, 27, 3.6, pal.eye);
  drawPixelRect(fctx, 19, 26, 2, 2, pal.eyeCore);
  drawPixelRect(fctx, 43, 26, 2, 2, pal.eyeCore);

  // Desiccated nasal bridge & dark cavity
  drawPixelRect(fctx, 30, 22, 4, 12, pal.hi);
  drawPixelRect(fctx, 28, 33, 3, 5, '#160d0f');
  drawPixelRect(fctx, 33, 33, 3, 5, '#160d0f');

  // Cheekbones & sunken hollows
  drawPixelRect(fctx, 8, 32, 10, 4, pal.hi);
  drawPixelRect(fctx, 46, 32, 10, 4, pal.hi);
  drawPixelRect(fctx, 10, 36, 8, 8, pal.dark);
  drawPixelRect(fctx, 46, 36, 8, 8, pal.dark);

  // Gaping torn jaw, gumline & staggered teeth
  drawPixelRect(fctx, 16, 42, 32, 16, '#260808');
  drawPixelRect(fctx, 18, 43, 28, 13, '#571010');
  drawPixelRect(fctx, 22, 46, 20, 8, '#7a1919');
  for (let tx = 18; tx <= 42; tx += 5) {
    drawPixelRect(fctx, tx, 42, 3, 4, '#e6dcc8');
    drawPixelRect(fctx, tx + 1, 53, 3, 3, '#cfc3ab');
  }

  // Archetype-specific gore & mutations
  if (kind === 'walker') {
    // Exposed bone patch on left temple + bloody cheek tear + tattered hair tufts
    drawPixelDisc(fctx, 14, 12, 5.5, '#d6cbb8');
    drawPixelDisc(fctx, 14, 12, 3.5, '#b8ab96');
    drawPixelRect(fctx, 40, 36, 12, 14, '#5c1111');
    drawPixelRect(fctx, 43, 38, 6, 10, '#8f1d1d');
    drawPixelRect(sctx, 18, 28, 22, 14, '#3a4734');
    drawPixelRect(sctx, 24, 32, 10, 6, '#6e1919');
    drawPixelRect(bctx, 14, 14, 16, 12, '#1f1918');
    drawPixelRect(bctx, 36, 20, 14, 14, '#471515');
  } else if (kind === 'runner') {
    // Flayed crimson muscle striations across cheeks, forehead & sides
    for (let sy = 8; sy < 56; sy += 4) {
      drawPixelRect(fctx, 6, sy, 10, 2, '#7d1b1b');
      drawPixelRect(fctx, 48, sy + 1, 10, 2, '#7d1b1b');
      drawPixelRect(sctx, 8, sy, 48, 2, '#6e1919');
    }
    // Blood-splatter streaks dripping down mouth/chin
    drawPixelRect(fctx, 18, 56, 4, 6, '#8f1919');
    drawPixelRect(fctx, 28, 55, 5, 7, '#6b0f0f');
    drawPixelRect(fctx, 41, 56, 4, 6, '#8f1919');
    // Snarling red-rimmed feral eyes
    drawPixelRect(fctx, 14, 21, 12, 2, '#a82323');
    drawPixelRect(fctx, 38, 21, 12, 2, '#a82323');
    drawPixelRect(bctx, 10, 10, 44, 28, '#541515');
  } else if (kind === 'bloater') {
    // Bulging bioluminescent toxic pustules across brow, cheek, side & back
    const pustules: Array<[CanvasRenderingContext2D, number, number, number]> = [
      [fctx, 12, 12, 6.5],
      [fctx, 50, 36, 7.5],
      [fctx, 33, 9, 4.5],
      [sctx, 22, 24, 9],
      [sctx, 44, 40, 7],
      [bctx, 24, 26, 10],
      [bctx, 46, 36, 7],
      [tctx, 24, 24, 8],
    ];
    for (const [ctx, px, py, r] of pustules) {
      drawPixelDisc(ctx, px, py, r + 1.5, '#2b3d16');
      drawPixelDisc(ctx, px, py, r, '#9ed93b');
      drawPixelDisc(ctx, px - 1, py - 1, r * 0.6, '#c8ff59');
      drawPixelDisc(ctx, px - 1.5, py - 1.5, Math.max(1.2, r * 0.28), '#f5ffd9');
    }
    // Dripping lime bile from split jaw
    drawPixelRect(fctx, 24, 52, 5, 10, '#85c42b');
    drawPixelRect(fctx, 35, 53, 4, 9, '#b8f244');
  } else {
    // Spitter: glowing bioluminescent cyan-mint veins & split venom-oozing jaw
    drawPixelRect(fctx, 22, 46, 20, 15, '#19473d');
    drawPixelRect(fctx, 25, 48, 14, 13, '#5ef2b5');
    drawPixelRect(fctx, 29, 50, 6, 10, '#d9fff0');
    // Glowing vein network
    for (let i = 0; i < 12; i++) {
      drawPixelRect(fctx, 8 + i, 14 + (i % 4) * 3, 2, 2, '#5ef2b5');
      drawPixelRect(fctx, 54 - i, 14 + (i % 4) * 3, 2, 2, '#5ef2b5');
      drawPixelRect(sctx, 10 + i * 4, 20 + (i % 3) * 6, 3, 2, '#5ef2b5');
    }
    // Dorsal glowing spine nodes down back of skull
    for (let sy = 10; sy <= 50; sy += 10) {
      drawPixelDisc(bctx, 32, sy, 5, '#19473d');
      drawPixelDisc(bctx, 32, sy, 3.2, '#5ef2b5');
      drawPixelRect(bctx, 31, sy - 1, 2, 2, '#e8fff6');
    }
  }

  // Dedicated 32x16 lower mandible / jagged teeth texture for hinged zombie jaw (no duplicate eyes!)
  const [cj, jctx] = makePixelCanvas(32, 16);
  drawPixelRect(jctx, 0, 0, 32, 16, '#101215');
  drawZombieDither(jctx, 1, 1, 30, 14, pal.dark, pal.skin, pal.rot, pal.seed + 199);
  // Bloody upper gumline + staggered lower teeth row across top of mandible
  drawPixelRect(jctx, 4, 1, 24, 5, '#470d0d');
  drawPixelRect(jctx, 6, 2, 20, 3, '#7a1919');
  for (let tx = 6; tx <= 23; tx += 4) {
    drawPixelRect(jctx, tx, 1, 3, 4, '#e6dcc8');
    drawPixelRect(jctx, tx + 1, 4, 2, 1, '#9e9078');
  }
  if (kind === 'runner') {
    drawPixelRect(jctx, 8, 6, 4, 8, '#8f1919');
    drawPixelRect(jctx, 19, 6, 5, 9, '#6b0f0f');
  } else if (kind === 'bloater') {
    drawPixelRect(jctx, 10, 5, 4, 9, '#9ed93b');
    drawPixelRect(jctx, 18, 6, 3, 8, '#c8ff59');
  } else if (kind === 'spitter') {
    drawPixelRect(jctx, 9, 4, 14, 10, '#19473d');
    drawPixelRect(jctx, 12, 5, 8, 8, '#5ef2b5');
    drawPixelRect(jctx, 14, 6, 4, 5, '#d9fff0');
  } else {
    drawPixelRect(jctx, 12, 6, 6, 7, '#5c1111');
  }

  return {
    front: toNearestTexture(cf),
    back: toNearestTexture(cb),
    side: toNearestTexture(cs),
    top: toNearestTexture(ct),
    jaw: toNearestTexture(cj),
  };
}

function buildPustuleTexture(cyan: boolean): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  const rim = cyan ? '#112e27' : '#263812';
  const base = cyan ? '#29876d' : '#78ad2b';
  const mid = cyan ? '#5ef2b5' : '#b8f244';
  const hot = cyan ? '#e0fff3' : '#f2ffd1';
  drawPixelRect(ctx, 0, 0, 16, 16, rim);
  drawZombieDither(ctx, 1, 1, 14, 14, base, mid, rim, cyan ? 401 : 409);
  drawPixelDisc(ctx, 8, 8, 5.2, mid);
  drawPixelDisc(ctx, 6.5, 6.5, 2.8, hot);
  drawPixelRect(ctx, 10, 11, 2, 2, rim);
  drawPixelRect(ctx, 3, 10, 2, 2, rim);
  return toNearestTexture(c);
}

function buildActorLimbTextures(kind: 'player' | 'walker' | 'runner' | 'bloater' | 'spitter'): {
  sleeve: THREE.CanvasTexture;
  leg: THREE.CanvasTexture;
} {
  if (kind === 'player') {
    const [cs, sctx] = makePixelCanvas(8, 12);
    const [cl, lctx] = makePixelCanvas(8, 12);
    const p = derivePlayerPalette();
    drawPixelRect(sctx, 0, 0, 8, 12, '#101215');
    drawPixelRect(sctx, 1, 1, 6, 10, p.shirt);
    drawPixelRect(sctx, 1, 1, 6, 3, p.shirtHi);
    drawPixelRect(sctx, 1, 9, 6, 2, p.shirtDark);

    drawPixelRect(lctx, 0, 0, 8, 12, '#101215');
    drawPixelRect(lctx, 1, 1, 6, 10, p.pants);
    drawPixelRect(lctx, 1, 1, 6, 3, p.pantsHi);
    drawPixelRect(lctx, 1, 8, 6, 3, p.pantsDark);
    return { sleeve: toNearestTexture(cs), leg: toNearestTexture(cl) };
  }

  const [cs, sctx] = makePixelCanvas(32, 48);
  const [cl, lctx] = makePixelCanvas(32, 48);

  const sleevePal =
    kind === 'walker'
      ? { cloth: '#614a42', clothDark: '#3a2b26', flesh: '#7d9478', hi: '#9db897', dark: '#4c6148', seed: 101 }
      : kind === 'runner'
        ? { cloth: '#7f2c2c', clothDark: '#4a1717', flesh: '#996c68', hi: '#b88580', dark: '#5e3533', seed: 107 }
        : kind === 'bloater'
          ? { cloth: '#485435', clothDark: '#2a331e', flesh: '#6f8c49', hi: '#96b569', dark: '#415727', seed: 113 }
          : { cloth: '#38464d', clothDark: '#20292e', flesh: '#58827d', hi: '#78aba5', dark: '#304c49', seed: 127 };

  const pantsPal =
    kind === 'walker'
      ? { main: '#2b3036', hi: '#3f464f', dark: '#181b1f', seed: 131 }
      : kind === 'runner'
        ? { main: '#202329', hi: '#343a45', dark: '#111317', seed: 137 }
        : kind === 'bloater'
          ? { main: '#2d3326', hi: '#434d39', dark: '#181c14', seed: 149 }
          : { main: '#21262b', hi: '#343c45', dark: '#121517', seed: 151 };

  // Arm / sleeve: tattered upper fabric + rotting forearm + grime/blood/pustules
  drawPixelRect(sctx, 0, 0, 32, 48, '#101215');
  drawZombieDither(sctx, 2, 2, 28, 18, sleevePal.cloth, sleevePal.cloth, sleevePal.clothDark, sleevePal.seed);
  drawZombieDither(sctx, 2, 20, 28, 26, sleevePal.flesh, sleevePal.hi, sleevePal.dark, sleevePal.seed + 5);
  // Jagged torn fabric fringe
  for (let x = 2; x < 30; x += 4) {
    drawPixelRect(sctx, x, 18, 2, 5, sleevePal.clothDark);
  }
  if (kind === 'runner') {
    drawPixelRect(sctx, 8, 22, 6, 22, '#7a1919');
    drawPixelRect(sctx, 18, 26, 5, 16, '#9c2424');
  } else if (kind === 'bloater') {
    drawPixelDisc(sctx, 16, 30, 5, '#9ed93b');
    drawPixelDisc(sctx, 15, 29, 3, '#c8ff59');
  } else if (kind === 'spitter') {
    drawPixelRect(sctx, 12, 22, 4, 20, '#5ef2b5');
  } else {
    drawPixelRect(sctx, 10, 28, 10, 6, '#5c1414');
  }

  // Legs: torn knee + stitching + mud-caked cuffs
  drawPixelRect(lctx, 0, 0, 32, 48, '#101215');
  drawZombieDither(lctx, 2, 2, 28, 44, pantsPal.main, pantsPal.hi, pantsPal.dark, pantsPal.seed);
  // Vertical seam + knee tear exposing flesh/bone
  drawPixelRect(lctx, 15, 2, 2, 44, pantsPal.dark);
  drawPixelRect(lctx, 6, 18, 18, 8, '#161414');
  drawPixelRect(lctx, 8, 19, 14, 6, sleevePal.dark);
  drawPixelRect(lctx, 11, 20, 8, 3, '#cfc3ab'); // kneecap bone
  // Muddy hem
  drawZombieDither(lctx, 2, 38, 28, 8, '#29211b', '#382e26', '#17120e', pantsPal.seed + 9);

  return {
    sleeve: toNearestTexture(cs),
    leg: toNearestTexture(cl),
  };
}

function buildActorTorsoTextures(kind: 'player' | 'walker' | 'runner' | 'bloater' | 'spitter'): {
  front: THREE.CanvasTexture;
  back: THREE.CanvasTexture;
  side: THREE.CanvasTexture;
} {
  if (kind === 'player') {
    const [cf, fctx] = makePixelCanvas(16, 16);
    const [cb, bctx] = makePixelCanvas(16, 16);
    const [cs, sctx] = makePixelCanvas(16, 16);
    const p = derivePlayerPalette();
    for (const ctx of [fctx, bctx, sctx]) {
      drawPixelRect(ctx, 0, 0, 16, 16, '#101215');
      drawPixelRect(ctx, 1, 1, 14, 14, p.shirt);
      drawPixelRect(ctx, 1, 1, 14, 3, p.shirtHi);
      drawPixelRect(ctx, 1, 12, 14, 3, p.shirtDark);
    }
    drawPixelRect(fctx, 2, 1, 12, 2, '#7a5438');
    for (let i = 2; i < 12; i++) {
      drawPixelRect(fctx, i, i, 2, 1, '#5c4632');
    }
    drawPixelRect(fctx, 10, 4, 4, 4, '#344532');
    drawPixelRect(fctx, 10, 4, 4, 1, '#607d5b');
    drawPixelRect(fctx, 1, 12, 14, 3, '#241c16');
    drawPixelRect(fctx, 6, 12, 4, 3, '#d4af55');
    drawPixelRect(fctx, 7, 13, 2, 1, '#fff0a3');
    drawPixelRect(bctx, 2, 1, 12, 2, '#7a5438');
    drawPixelRect(bctx, 1, 12, 14, 3, '#241c16');
    drawPixelRect(sctx, 1, 12, 14, 3, '#241c16');
    return { front: toNearestTexture(cf), back: toNearestTexture(cb), side: toNearestTexture(cs) };
  }

  const S = 64;
  const [cf, fctx] = makePixelCanvas(S, S);
  const [cb, bctx] = makePixelCanvas(S, S);
  const [cs, sctx] = makePixelCanvas(S, S);

  const palette =
    kind === 'walker'
      ? { main: '#614a42', hi: '#7d6056', dark: '#3a2b26', seed: 201 }
      : kind === 'runner'
        ? { main: '#7f2c2c', hi: '#a63d3d', dark: '#4a1717', seed: 211 }
        : kind === 'bloater'
          ? { main: '#485435', hi: '#627349', dark: '#2a331e', seed: 223 }
          : { main: '#38464d', hi: '#4e626b', dark: '#20292e', seed: 229 };

  for (const [idx, ctx] of [fctx, bctx, sctx].entries()) {
    drawPixelRect(ctx, 0, 0, S, S, '#101215');
    drawZombieDither(ctx, 2, 2, S - 4, S - 4, palette.main, palette.hi, palette.dark, palette.seed + idx * 13);
    drawPixelRect(ctx, 2, 2, S - 4, 7, palette.hi);
    drawPixelRect(ctx, 2, 52, S - 4, 10, palette.dark);
  }

  if (kind === 'walker') {
    // Torn jacket lapels + deep chest cavity + 4 pairs of ivory ribs + dripping blood
    drawPixelRect(fctx, 14, 10, 36, 36, '#380b0b');
    drawPixelRect(fctx, 18, 12, 28, 32, '#6e1616');
    drawPixelRect(fctx, 29, 12, 6, 32, '#420c0c'); // sternum gap
    for (let ry = 15; ry <= 39; ry += 7) {
      drawPixelRect(fctx, 17, ry, 11, 4, '#e6dcc8');
      drawPixelRect(fctx, 36, ry, 11, 4, '#e6dcc8');
      drawPixelRect(fctx, 18, ry + 3, 9, 1, '#b0a38e');
      drawPixelRect(fctx, 37, ry + 3, 9, 1, '#b0a38e');
    }
    // Blood drips + tattered belt + back wound
    drawPixelRect(fctx, 22, 46, 5, 14, '#7a1616');
    drawPixelRect(fctx, 36, 45, 6, 15, '#590d0d');
    drawPixelRect(fctx, 2, 50, 60, 6, '#211914');
    drawPixelRect(bctx, 22, 16, 20, 26, '#4a1b1b');
    for (let vy = 18; vy <= 38; vy += 5) {
      drawPixelRect(bctx, 29, vy, 6, 3, '#cfc3ab');
    }
  } else if (kind === 'runner') {
    // Shredded blood-soaked athletic vest + exposed striated pecs & abs + claw slashes
    drawPixelRect(fctx, 10, 10, 44, 42, '#4d1111');
    drawPixelRect(fctx, 14, 14, 36, 32, '#8a1e1e');
    for (let sx = 16; sx <= 44; sx += 5) {
      drawPixelRect(fctx, sx, 16, 2, 28, '#5e1111');
    }
    // Pectoral highlights & sinew
    drawPixelRect(fctx, 15, 16, 14, 10, '#ad2d2d');
    drawPixelRect(fctx, 35, 16, 14, 10, '#ad2d2d');
    // Diagonal claw scars on back and sides
    for (let i = 0; i < 28; i++) {
      drawPixelRect(bctx, 14 + i, 14 + i, 3, 3, '#400c0c');
      drawPixelRect(bctx, 24 + i, 12 + i, 2, 2, '#9c2424');
      drawPixelRect(sctx, 14 + i, 22 + (i >> 1), 3, 3, '#591616');
    }
  } else if (kind === 'bloater') {
    // Split swollen necrotic belly + clustered glowing lime pustules
    drawPixelRect(fctx, 10, 16, 44, 42, '#5a6e39');
    drawZombieDither(fctx, 14, 20, 36, 34, '#6f8c49', '#87a85b', '#415727', 239);
    const bodyPustules: Array<[CanvasRenderingContext2D, number, number, number]> = [
      [fctx, 20, 24, 9],
      [fctx, 44, 38, 10],
      [fctx, 26, 44, 6],
      [bctx, 22, 24, 10],
      [bctx, 42, 34, 8],
      [sctx, 30, 32, 9],
    ];
    for (const [ctx, px, py, r] of bodyPustules) {
      drawPixelDisc(ctx, px, py, r + 2, '#283814');
      drawPixelDisc(ctx, px, py, r, '#9ed93b');
      drawPixelDisc(ctx, px - 1.5, py - 1.5, r * 0.62, '#c8ff59');
      drawPixelDisc(ctx, px - 2, py - 2, Math.max(2, r * 0.3), '#f3ffd4');
    }
  } else {
    // Spitter: pulsing glowing teal-mint acid sac across sternum + glowing dorsal spine vents
    drawPixelDisc(fctx, 32, 32, 18, '#173830');
    drawPixelDisc(fctx, 32, 32, 14, '#24735e');
    drawPixelDisc(fctx, 32, 31, 10, '#4be3a5');
    drawPixelDisc(fctx, 32, 30, 5.5, '#c4ffea');
    // Glowing capillary veins
    for (let i = 0; i < 18; i++) {
      drawPixelRect(fctx, 8 + i, 12 + i, 2, 2, '#4be3a5');
      drawPixelRect(fctx, 54 - i, 12 + i, 2, 2, '#4be3a5');
      drawPixelRect(sctx, 14 + i * 2, 24 + (i % 5) * 4, 3, 2, '#4be3a5');
    }
    // Glowing spinal socket vents on back
    drawPixelRect(bctx, 26, 6, 12, 50, '#14332b');
    for (let sy = 10; sy <= 48; sy += 9) {
      drawPixelDisc(bctx, 32, sy, 5, '#5ef2b5');
      drawPixelDisc(bctx, 32, sy, 2.5, '#e8fff6');
    }
  }

  return {
    front: toNearestTexture(cf),
    back: toNearestTexture(cb),
    side: toNearestTexture(cs),
  };
}

function buildBackpackTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(32, 32);
  drawPixelRect(ctx, 0, 0, 32, 32, '#14110e');
  drawZombieDither(ctx, 2, 2, 28, 28, '#69533b', '#80664a', '#4d3c2a', 95);
  // Top storm flap & stitched border
  drawPixelRect(ctx, 3, 3, 26, 11, '#7d6347');
  drawPixelRect(ctx, 4, 4, 24, 3, '#947858');
  drawPixelRect(ctx, 3, 13, 26, 2, '#3b2e20');
  // Twin vertical compression straps & brass buckles
  drawPixelRect(ctx, 7, 2, 4, 28, '#29221b');
  drawPixelRect(ctx, 21, 2, 4, 28, '#29221b');
  drawPixelRect(ctx, 7, 13, 4, 4, '#e0ba58');
  drawPixelRect(ctx, 21, 13, 4, 4, '#e0ba58');
  // Lower cargo pouch + mud weathering
  drawPixelRect(ctx, 5, 18, 22, 10, '#594530');
  drawPixelRect(ctx, 6, 19, 20, 2, '#735b40');
  drawPixelRect(ctx, 13, 21, 6, 2, '#29221b');
  drawPixelRect(ctx, 2, 27, 28, 3, '#302419');
  return toNearestTexture(c);
}

function buildVehicleTextures(police: boolean): {
  side: THREE.CanvasTexture;
  roof: THREE.CanvasTexture;
  front: THREE.CanvasTexture;
  rear: THREE.CanvasTexture;
  glass: THREE.CanvasTexture;
  wheel: THREE.CanvasTexture;
} {
  const main = police ? '#1e3c72' : '#d92b24';
  const hi = police ? '#3b66b5' : '#ff564a';
  const mid = police ? '#162d57' : '#b31e18';
  const dark = police ? '#0c1a36' : '#6b100d';
  const carbon = '#181c22';
  const carbonHi = '#2d3540';
  const trim = '#0e1115';

  // Side hull (128x32) mapped u=0 (REAR -X) -> u=1 (FRONT +X), v=1 (TOP) -> v=0 (BOTTOM)
  const [cs, sctx] = makePixelCanvas(128, 32);
  drawPixelRect(sctx, 0, 0, 128, 32, main);
  // Gloss top shoulder highlight + sculpted wedge beltline crease
  drawPixelRect(sctx, 0, 0, 128, 3, hi);
  drawPixelRect(sctx, 0, 3, 128, 2, mid);
  drawPixelRect(sctx, 0, 12, 128, 2, hi);
  drawPixelRect(sctx, 0, 14, 128, 10, main);
  drawPixelRect(sctx, 0, 23, 128, 2, dark);
  // Forged carbon lower rocker skirt & front/rear aero splitters
  drawPixelRect(sctx, 0, 25, 128, 7, carbon);
  for (let x = 0; x < 128; x += 2) {
    drawPixelRect(sctx, x, 26 + (x % 4 === 0 ? 0 : 1), 1, 2, carbonHi);
  }
  drawPixelRect(sctx, 0, 25, 128, 1, police ? '#6eb8ff' : '#ff6357'); // thin aero accent pinstripe

  // Rear & front wheel-arch dark fender liners (centered around x=26 rear, x=100 front)
  drawPixelDisc(sctx, 26, 27, 13, trim);
  drawPixelDisc(sctx, 100, 27, 13, trim);
  drawPixelDisc(sctx, 26, 27, 14, dark);
  drawPixelDisc(sctx, 26, 27, 12.5, trim);
  drawPixelDisc(sctx, 100, 27, 14, dark);
  drawPixelDisc(sctx, 100, 27, 12.5, trim);

  // Mid-engine side aero intake scoop (x=38..54, y=9..23)
  drawPixelRect(sctx, 38, 9, 16, 14, dark);
  drawPixelRect(sctx, 40, 10, 12, 12, '#0d1014');
  drawPixelRect(sctx, 41, 13, 10, 2, carbonHi); // horizontal strake
  drawPixelRect(sctx, 41, 17, 10, 2, carbonHi);

  // Door shut line + aero flush handle + front fender gill vents
  drawPixelRect(sctx, 84, 5, 1, 20, dark);
  drawPixelRect(sctx, 56, 5, 1, 20, dark);
  drawPixelRect(sctx, 60, 11, 7, 2, '#14171c');
  drawPixelRect(sctx, 88, 13, 3, 8, '#12161a');

  if (police) {
    // Sleek Arctic White interceptor door panel + angled pursuit stripe + gold badge + "07"
    for (let y = 4; y < 25; y++) {
      const skew = Math.floor((y - 4) * 0.45);
      drawPixelRect(sctx, 54 + skew, y, 36 - skew, 1, '#f4f8fc');
    }
    drawPixelRect(sctx, 56, 20, 32, 2, '#2d72d9'); // crisp sapphire pursuit accent line
    // Gold Interceptor Shield Emblem
    drawPixelRect(sctx, 68, 8, 8, 9, '#d4af55');
    drawPixelRect(sctx, 69, 9, 6, 7, '#ffe082');
    drawPixelRect(sctx, 71, 11, 2, 3, '#1e3c72');
    // Unit "07" pixel stencil
    drawPixelRect(sctx, 58, 10, 4, 7, '#1e3c72');
    drawPixelRect(sctx, 59, 11, 2, 5, '#f4f8fc');
    drawPixelRect(sctx, 63, 10, 4, 2, '#1e3c72');
    drawPixelRect(sctx, 65, 12, 2, 5, '#1e3c72');
  } else {
    // Crisp pearl-silver GT side stripe & supercar vent badge
    drawPixelRect(sctx, 55, 20, 30, 2, '#eef3f7');
    drawPixelRect(sctx, 78, 8, 4, 3, '#f0c44d');
  }

  // Hood / Roof / Rear Engine Deck top texture (128x64, x=0 rear -> x=127 front)
  const [cr, rctx] = makePixelCanvas(128, 64);
  drawPixelRect(rctx, 0, 0, 128, 64, main);
  drawPixelRect(rctx, 2, 2, 124, 60, hi);
  drawPixelRect(rctx, 4, 4, 120, 56, main);

  if (police) {
    // Crisp white interceptor roof & hood stripes
    drawPixelRect(rctx, 44, 6, 40, 52, '#f4f8fc');
    drawPixelRect(rctx, 46, 8, 36, 48, '#e3ebf2');
    // Roof unit number "07"
    drawPixelRect(rctx, 56, 20, 7, 16, '#1e3c72');
    drawPixelRect(rctx, 58, 23, 3, 10, '#f4f8fc');
    drawPixelRect(rctx, 66, 20, 7, 4, '#1e3c72');
    drawPixelRect(rctx, 70, 24, 3, 12, '#1e3c72');
    // Front hood twin white pursuit stripes
    drawPixelRect(rctx, 88, 22, 38, 6, '#f4f8fc');
    drawPixelRect(rctx, 88, 36, 38, 6, '#f4f8fc');
  } else {
    // Twin pearl-silver racing stripes with dark pinstripe borders
    drawPixelRect(rctx, 4, 21, 122, 8, '#1b1f24');
    drawPixelRect(rctx, 4, 22, 122, 6, '#eef3f7');
    drawPixelRect(rctx, 4, 35, 122, 8, '#1b1f24');
    drawPixelRect(rctx, 4, 36, 122, 6, '#eef3f7');
  }

  // Rear mid-engine smoked glass & twin V8 valve covers (x=6..40)
  drawPixelRect(rctx, 6, 12, 34, 40, '#13171d');
  drawPixelRect(rctx, 8, 14, 30, 36, '#1f2833');
  drawPixelRect(rctx, 12, 17, 22, 10, police ? '#3b66b5' : '#cc2920');
  drawPixelRect(rctx, 12, 37, 22, 10, police ? '#3b66b5' : '#cc2920');
  for (let lx = 10; lx <= 34; lx += 6) {
    drawPixelRect(rctx, lx, 14, 2, 36, '#14181f'); // engine louver slats
  }

  // Front hood heat extractor vents (x=92..114)
  drawPixelRect(rctx, 94, 12, 18, 9, '#14171c');
  drawPixelRect(rctx, 94, 43, 18, 9, '#14171c');
  for (let vx = 97; vx <= 109; vx += 4) {
    drawPixelRect(rctx, vx, 13, 2, 7, '#2d333b');
    drawPixelRect(rctx, vx, 44, 2, 7, '#2d333b');
  }

  // Front fascia + twin aero intakes + chin splitter + DRL blades (64x32)
  const [cf, fctx] = makePixelCanvas(64, 32);
  drawPixelRect(fctx, 0, 0, 64, 32, main);
  drawPixelRect(fctx, 2, 2, 60, 8, hi);
  // Twin angular carbon air intakes
  drawPixelRect(fctx, 4, 14, 18, 11, carbon);
  drawPixelRect(fctx, 42, 14, 18, 11, carbon);
  drawPixelRect(fctx, 24, 16, 16, 9, '#121519');
  // Honeycomb grille bars
  for (let gx = 6; gx <= 56; gx += 4) {
    drawPixelRect(fctx, gx, 16, 1, 8, '#282f38');
  }
  // Sharp LED DRL headlight blades + badge
  drawPixelRect(fctx, 3, 7, 15, 4, '#14181e');
  drawPixelRect(fctx, 4, 8, 13, 2, '#fff5bd');
  drawPixelRect(fctx, 46, 7, 15, 4, '#14181e');
  drawPixelRect(fctx, 47, 8, 13, 2, '#fff5bd');
  drawPixelRect(fctx, 30, 5, 4, 4, '#d4af55');
  drawPixelRect(fctx, 0, 26, 64, 6, carbon); // carbon front splitter

  // Rear fascia + honeycomb heat grille + diffuser fins + plate + LED tail bar (64x32)
  const [cb, bctx] = makePixelCanvas(64, 32);
  drawPixelRect(bctx, 0, 0, 64, 32, dark);
  drawPixelRect(bctx, 2, 2, 60, 5, main);
  // Wide dark honeycomb heat-extraction mesh
  drawPixelRect(bctx, 4, 11, 56, 12, '#111418');
  for (let gy = 13; gy <= 21; gy += 3) {
    for (let gx = 6; gx <= 56; gx += 3) {
      drawPixelRect(bctx, gx, gy, 1, 1, '#2a3038');
    }
  }
  // License plate
  drawPixelRect(bctx, 25, 14, 14, 7, '#e2ddd0');
  drawPixelRect(bctx, 27, 16, 10, 3, '#2b3138');
  // Aggressive rear diffuser fins
  drawPixelRect(bctx, 0, 23, 64, 9, carbon);
  for (const fx of [10, 18, 26, 37, 45, 53]) {
    drawPixelRect(bctx, fx, 23, 2, 9, '#323842');
  }
  // Upper LED taillight bar
  drawPixelRect(bctx, 3, 6, 18, 4, '#ff3b30');
  drawPixelRect(bctx, 43, 6, 18, 4, '#ff3b30');
  drawPixelRect(bctx, 21, 7, 22, 2, '#a31c15');

  // Smoked aerodynamic supercar windshield/glass with sharp diagonal sky reflection (64x32)
  const [cg, gctx] = makePixelCanvas(64, 32);
  drawPixelRect(gctx, 0, 0, 64, 32, '#0e1217');
  drawPixelRect(gctx, 3, 3, 58, 26, '#1f313f');
  for (let y = 4; y < 27; y++) {
    const startX = 8 + Math.floor(y * 0.65);
    drawPixelRect(gctx, startX, y, 14, 1, '#395a73');
    drawPixelRect(gctx, startX + 3, y, 6, 1, '#689ab8');
    drawPixelRect(gctx, startX + 22, y, 5, 1, '#2b4559');
  }
  drawPixelRect(gctx, 10, 26, 20, 2, '#0f1318'); // wiper blade

  // High-res 48x48 low-profile tire + cross-drilled rotor + caliper + 10-spoke Y-alloy rim
  const [cw, wctx] = makePixelCanvas(48, 48);
  drawPixelRect(wctx, 0, 0, 48, 48, '#0c0e11');
  drawPixelDisc(wctx, 24, 24, 23.0, '#16191d'); // low-profile rubber
  drawPixelDisc(wctx, 24, 24, 20.5, '#202429'); // sidewall bevel
  drawPixelDisc(wctx, 24, 24, 17.5, '#121518'); // deep-dish inner barrel
  drawPixelDisc(wctx, 24, 24, 15.0, '#5a626b'); // slotted steel brake rotor
  drawPixelDisc(wctx, 24, 24, 11.5, '#252a30');
  // Brake caliper behind spokes (crimson on civilian, blue on police)
  wctx.fillStyle = police ? '#3b82f6' : '#e03124';
  wctx.fillRect(30, 17, 6, 13);

  // 10-spoke Y-pattern alloy wheel spokes
  wctx.strokeStyle = '#c8d1da';
  wctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const baseAngle = (i * Math.PI * 2) / 5;
    for (const offset of [-0.2, 0.2]) {
      const a = baseAngle + offset;
      wctx.beginPath();
      wctx.moveTo(24 + Math.cos(baseAngle) * 4, 24 + Math.sin(baseAngle) * 4);
      wctx.lineTo(24 + Math.cos(a) * 16.5, 24 + Math.sin(a) * 16.5);
      wctx.stroke();
    }
  }
  drawPixelDisc(wctx, 24, 24, 4.5, '#1b1f24');
  drawPixelDisc(wctx, 24, 24, 2.5, police ? '#5ea8ff' : '#e03124'); // center-lock nut

  return {
    side: toNearestTexture(cs),
    roof: toNearestTexture(cr),
    front: toNearestTexture(cf),
    rear: toNearestTexture(cb),
    glass: toNearestTexture(cg),
    wheel: toNearestTexture(cw),
  };
}

function buildFridgeFrontTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(48, 64);
  drawPixelRect(ctx, 0, 0, 48, 64, '#1c2024');
  drawZombieDither(ctx, 2, 2, 44, 60, '#d8e0dc', '#eaf2ee', '#bcc7c2', 112);
  // Top highlight & side bevel
  drawPixelRect(ctx, 2, 2, 44, 2, '#f4faf7');
  drawPixelRect(ctx, 2, 2, 2, 60, '#edf5f1');
  // Freezer compartment seam + gasket shadow
  drawPixelRect(ctx, 2, 20, 44, 3, '#383e42');
  drawPixelRect(ctx, 2, 23, 44, 1, '#f0f7f4');
  // Brushed chrome vertical handles
  drawPixelRect(ctx, 36, 5, 4, 12, '#697378');
  drawPixelRect(ctx, 37, 6, 2, 10, '#cfd8dd');
  drawPixelRect(ctx, 36, 26, 4, 18, '#697378');
  drawPixelRect(ctx, 37, 27, 2, 16, '#cfd8dd');
  // Survivor notes, magnets & rust smudge
  drawPixelRect(ctx, 8, 28, 9, 10, '#f2e8b6');
  drawPixelRect(ctx, 11, 27, 3, 3, '#d9483b');
  drawPixelRect(ctx, 20, 31, 7, 5, '#76b5d9');
  drawPixelRect(ctx, 6, 45, 5, 3, '#8a5d3b');
  // Lower compressor vent slats
  drawPixelRect(ctx, 2, 54, 44, 8, '#282d30');
  for (let x = 5; x < 43; x += 4) {
    drawPixelRect(ctx, x, 56, 2, 4, '#131618');
  }
  return toNearestTexture(c);
}

function buildMedCabinetFrontTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(48, 64);
  drawPixelRect(ctx, 0, 0, 48, 64, '#1b2024');
  drawZombieDither(ctx, 2, 2, 44, 60, '#dfe8e4', '#eef5f2', '#c3cfca', 118);
  // Inset recessed door border
  drawPixelRect(ctx, 5, 5, 38, 42, '#b0bdb8');
  drawPixelRect(ctx, 7, 7, 34, 38, '#e8f0ec');
  // Crisp weathered Red Cross emblem
  drawPixelRect(ctx, 20, 14, 8, 24, '#c9342c');
  drawPixelRect(ctx, 12, 22, 24, 8, '#c9342c');
  drawPixelRect(ctx, 21, 15, 6, 22, '#e34940');
  drawPixelRect(ctx, 13, 23, 22, 6, '#e34940');
  // Brushed steel door latch + lower storage drawer seam
  drawPixelRect(ctx, 38, 22, 4, 9, '#6c777d');
  drawPixelRect(ctx, 39, 23, 2, 7, '#d4dde0');
  drawPixelRect(ctx, 4, 48, 40, 2, '#3d4547');
  drawPixelRect(ctx, 6, 51, 36, 9, '#cfd9d4');
  drawPixelRect(ctx, 18, 54, 12, 3, '#6c777d');
  // Rust chip accent
  drawPixelRect(ctx, 7, 40, 4, 3, '#7d4c2d');
  return toNearestTexture(c);
}

function buildStoveTextures(): { front: THREE.CanvasTexture; top: THREE.CanvasTexture } {
  const [cf, fctx] = makePixelCanvas(14, 14);
  drawPixelRect(fctx, 0, 0, 14, 14, '#16191c');
  drawPixelRect(fctx, 1, 1, 12, 12, '#888f96');
  drawPixelRect(fctx, 1, 1, 12, 2, '#2e3338'); // dial strip
  drawPixelRect(fctx, 3, 1, 1, 1, '#d9dde0');
  drawPixelRect(fctx, 6, 1, 1, 1, '#e66c2c');
  drawPixelRect(fctx, 10, 1, 1, 1, '#d9dde0');
  drawPixelRect(fctx, 3, 5, 8, 6, '#1b1f24'); // oven window
  drawPixelRect(fctx, 3, 4, 8, 1, '#d9dde0'); // oven handle

  const [ct, tctx] = makePixelCanvas(14, 14);
  drawPixelRect(tctx, 0, 0, 14, 14, '#16191c');
  drawPixelRect(tctx, 1, 1, 12, 12, '#2e3338');
  drawPixelRect(tctx, 2, 2, 4, 4, '#592818');
  drawPixelRect(tctx, 3, 3, 2, 2, '#ff7b29');
  drawPixelRect(tctx, 8, 2, 4, 4, '#212529');
  drawPixelRect(tctx, 8, 8, 4, 4, '#592818');
  drawPixelRect(tctx, 9, 9, 2, 2, '#ff7b29');
  drawPixelRect(tctx, 2, 8, 4, 4, '#212529');
  return { front: toNearestTexture(cf), top: toNearestTexture(ct) };
}

function buildTvTextures(): { screen: THREE.CanvasTexture; cabinet: THREE.CanvasTexture } {
  const [cs, sctx] = makePixelCanvas(12, 10);
  drawPixelRect(sctx, 0, 0, 12, 10, '#141618');
  drawPixelRect(sctx, 1, 1, 10, 8, '#303438');
  for (let y = 2; y < 8; y++) {
    for (let x = 2; x < 8; x++) {
      sctx.fillStyle = (x + y) % 2 === 0 ? '#506773' : '#3d515c';
      sctx.fillRect(x, y, 1, 1);
    }
  }
  drawPixelRect(sctx, 9, 3, 1, 1, '#c7a44a');
  drawPixelRect(sctx, 9, 6, 1, 1, '#c7a44a');

  const [cc, cctx] = makePixelCanvas(14, 8);
  drawPixelRect(cctx, 0, 0, 14, 8, '#1c140e');
  drawPixelRect(cctx, 1, 1, 12, 6, '#5e3f27');
  drawPixelRect(cctx, 6, 1, 1, 6, '#3b2515');
  drawPixelRect(cctx, 4, 3, 1, 1, '#b89646');
  drawPixelRect(cctx, 8, 3, 1, 1, '#b89646');
  return { screen: toNearestTexture(cs), cabinet: toNearestTexture(cc) };
}

function buildBurnBarrelTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const rim = y === 0 || y === 7 || y === 8 || y === 15;
      const rust = (x * 5 + y * 3) % 7 === 0;
      const edge = x === 0 || x === 15;
      ctx.fillStyle = edge ? '#1e2124' : rim ? '#25282b' : rust ? '#7a4024' : x % 3 === 0 ? '#5d6369' : '#4a4e52';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildCouchTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 12);
  drawPixelRect(ctx, 0, 0, 16, 12, '#1b1a18');
  drawPixelRect(ctx, 1, 1, 14, 10, '#7a5741');
  drawPixelRect(ctx, 7, 1, 2, 10, '#5c4130'); // center cushion seam
  drawPixelRect(ctx, 2, 2, 4, 3, '#8c664d');
  drawPixelRect(ctx, 10, 2, 4, 3, '#8c664d');
  return toNearestTexture(c);
}

function buildSoftContactShadowTexture(): THREE.CanvasTexture {
  const size = 32;
  const [c, ctx] = makePixelCanvas(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - size * 0.5) / (size * 0.48);
      const dy = (y + 0.5 - size * 0.5) / (size * 0.48);
      const r = Math.hypot(dx, dy);
      if (r < 1) {
        const a = Math.max(0, 1 - r * r) * 0.52;
        ctx.fillStyle = `rgba(6, 8, 10, ${a.toFixed(3)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return toNearestTexture(c);
}

function buildCeilingTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const joist = x === 0 || x === 8;
      const border = y === 0 || y === 15;
      const speckle = ((x * 17 + y * 31) % 7) === 0;
      let col = '#2a2420';
      if (joist) col = '#1d1714';
      else if (border) col = '#221c18';
      else if (speckle) col = '#332b26';
      else if ((x + y) % 5 === 0) col = '#25201c';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildWeaponTextures() {
  // Crowbar forged hexagonal steel with specular chamfer & rust wear (32x16)
  const [cs, csCtx] = makePixelCanvas(32, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      const bevelTop = y === 1 || y === 2;
      const ridge = y === 4;
      const under = y >= 13;
      const pit = pxHash(x, y, 17) < 0.08;
      const rust = pxHash(x, y, 31) < 0.05 && y >= 7;
      let col = '#6f7a84';
      if (y === 0 || y === 15) col = '#2a3036';
      else if (bevelTop) col = '#aeb9c2';
      else if (ridge) col = '#919da6';
      else if (under) col = '#3c444c';
      else if (rust) col = '#6e432f';
      else if (pit) col = '#535d66';
      csCtx.fillStyle = col;
      csCtx.fillRect(x, y, 1, 1);
    }
  }

  // Crowbar worn red industrial enamel with scratched metal chips (24x12)
  const [cr, crCtx] = makePixelCanvas(24, 12);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 24; x++) {
      const chip = pxHash(x, y, 43) < 0.14 && (x > 16 || y <= 2 || y >= 9);
      const hi = y === 1 || y === 2;
      const shadow = y >= 9;
      crCtx.fillStyle = chip ? '#8f9ba3' : y === 0 || y === 11 ? '#4d1814' : hi ? '#eb6154' : shadow ? '#8c2820' : '#c94138';
      crCtx.fillRect(x, y, 1, 1);
    }
  }

  // Pistol machined steel slide with rear serrations & ejection port
  const [ps, psCtx] = makePixelCanvas(16, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const serration = x >= 1 && x <= 5 && x % 2 === 1 && y >= 1 && y <= 6;
      const port = x >= 8 && x <= 11 && y <= 2;
      const hi = y === 0;
      let col = '#66717a';
      if (port) col = '#24292e';
      else if (serration) col = '#3c444c';
      else if (hi) col = '#9aa5ae';
      else if (y >= 6) col = '#444c54';
      psCtx.fillStyle = col;
      psCtx.fillRect(x, y, 1, 1);
    }
  }

  // Stippled polymer weapon grip
  const [pg, pgCtx] = makePixelCanvas(8, 12);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 8; x++) {
      const check = (x + y) % 2 === 0 && x >= 1 && x <= 6 && y >= 2 && y <= 10;
      pgCtx.fillStyle = check ? '#171a1e' : '#2b3036';
      pgCtx.fillRect(x, y, 1, 1);
    }
  }

  // Shotgun checkered walnut stock & ribbed forend
  const [sw, swCtx] = makePixelCanvas(16, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const rib = x % 3 === 0 && y >= 1 && y <= 6;
      const grain = (x + y * 2) % 5 === 0;
      swCtx.fillStyle = rib ? '#4a2e19' : grain ? '#875835' : '#6e4527';
      swCtx.fillRect(x, y, 1, 1);
    }
  }

  // Molotov tinted glass bottle with amber fuel line, specular reflection & cloth band
  const [mg, mgCtx] = makePixelCanvas(16, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      const spec = (x === 3 || x === 4) && y >= 4 && y <= 26;
      const liquid = y >= 15 && x >= 2 && x <= 13;
      const meniscus = y === 15 && x >= 2 && x <= 13;
      const rim = x <= 1 || x >= 14 || y === 31;
      let col = '#538241';
      if (rim) col = '#2d4723';
      else if (meniscus) col = '#f5b849';
      else if (spec) col = y >= 15 ? '#ffcf73' : '#9ed184';
      else if (liquid) col = (x + y) % 4 === 0 ? '#e3942b' : '#b8681f';
      else if (y >= 19 && y <= 25 && x >= 4 && x <= 11) col = '#d9cfb8'; // torn paper label
      mgCtx.fillStyle = col;
      mgCtx.fillRect(x, y, 1, 1);
    }
  }

  // Shotgun blued receiver with ejection port & shell lifter
  const [sr, srCtx] = makePixelCanvas(16, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const hi = y === 0;
      const port = x >= 6 && x <= 11 && y >= 1 && y <= 3;
      const lifter = x >= 6 && x <= 10 && y >= 5 && y <= 6;
      const pin = (x === 3 || x === 13) && (y === 2 || y === 5);
      let col = '#2a3036';
      if (port) col = '#c2ccd4';
      else if (lifter) col = '#8c969e';
      else if (pin) col = '#171a1d';
      else if (hi) col = '#4a535c';
      srCtx.fillStyle = col;
      srCtx.fillRect(x, y, 1, 1);
    }
  }

  // LMG perforated steel barrel shroud
  const [ls, lsCtx] = makePixelCanvas(16, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const hole = (x % 3 === 1) && (y === 2 || y === 5);
      const hi = y === 0;
      let col = '#3c434a';
      if (hole) col = '#131619';
      else if (hi) col = '#68737d';
      else if (y === 7) col = '#252a2f';
      lsCtx.fillStyle = col;
      lsCtx.fillRect(x, y, 1, 1);
    }
  }

  // Linked brass 7.62mm ammo belt
  const [ab, abCtx] = makePixelCanvas(12, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 12; x++) {
      const link = y === 3 || y === 4;
      const tip = y <= 1 && x % 2 === 0;
      let col = x % 2 === 0 ? '#d4a644' : '#3a3428';
      if (tip) col = '#b86c3a';
      else if (link) col = '#24272b';
      abCtx.fillStyle = col;
      abCtx.fillRect(x, y, 1, 1);
    }
  }

  // OD-green steel LMG ammo box with yellow stencil
  const [lb, lbCtx] = makePixelCanvas(12, 10);
  drawPixelRect(lbCtx, 0, 0, 12, 10, '#272e1e');
  drawPixelRect(lbCtx, 1, 1, 10, 8, '#4a5836');
  drawPixelRect(lbCtx, 1, 1, 10, 2, '#627348');
  drawPixelRect(lbCtx, 3, 4, 6, 1, '#d9b54a');
  drawPixelRect(lbCtx, 3, 6, 4, 1, '#d9b54a');

  // Tactical glove / wrapped palm
  const [gl, glCtx] = makePixelCanvas(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const knuckle = y === 2 && (x === 1 || x === 3 || x === 5);
      const strap = y >= 5;
      glCtx.fillStyle = knuckle ? '#4d463f' : strap ? '#1d1b18' : '#2e2a26';
      glCtx.fillRect(x, y, 1, 1);
    }
  }

  // Machete carbon-steel blade with fuller groove, oil-rubbed spine, subtle patina & gleaming honed edge (48x16)
  // Note: tri-planar v=0 (canvas y=15) maps to -Y cutting edge!
  const [mb, mbCtx] = makePixelCanvas(48, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 48; x++) {
      const spine = y <= 2;
      const fuller = (y === 4 || y === 5) && x >= 3 && x <= 34;
      const bevelLine = y === 11;
      const edge = y >= 12;
      const razor = y >= 14;
      const scratch = pxHash(x, y, 71) < 0.08 && y >= 6 && y <= 10;
      const patina = ((x >= 16 && x <= 23 && y >= 7 && y <= 10) || (x >= 32 && x <= 37 && y >= 7 && y <= 10)) && pxHash(x, y, 89) > 0.56;
      let col = '#68757e';
      if (y === 0) col = '#1a1f24';
      else if (spine) col = '#2c343b';
      else if (fuller) col = y === 4 ? '#39424a' : '#4e5862';
      else if (razor) col = '#f3f8fb';
      else if (edge) col = y === 12 ? '#b7c4ce' : '#d8e3ea';
      else if (patina) col = '#5c2623';
      else if (bevelLine) col = '#8c9aa4';
      else if (scratch) col = '#8896a0';
      mbCtx.fillStyle = col;
      mbCtx.fillRect(x, y, 1, 1);
    }
  }

  // Machete riveted walnut grip scales with brass pins (24x12)
  const [mgr, mgrCtx] = makePixelCanvas(24, 12);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 24; x++) {
      const rivet = (y >= 4 && y <= 7) && ((x >= 4 && x <= 6) || (x >= 11 && x <= 13) || (x >= 18 && x <= 20));
      const tang = y === 0 || y === 11;
      const grain = (x + y * 2) % 5 === 0;
      mgrCtx.fillStyle = tang ? '#556068' : rivet ? '#d9b54a' : grain ? '#573923' : '#422a19';
      mgrCtx.fillRect(x, y, 1, 1);
    }
  }

  // Turned ash-wood baseball bat / hickory haft grain with dark toasted barrel bands (32x16)
  const [bw, bwCtx] = makePixelCanvas(32, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      const wave = Math.sin(x * 0.38 + y * 0.7) > 0.55;
      const hi = y <= 3;
      const dark = y >= 12;
      const scuff = x >= 18 && pxHash(x, y, 103) < 0.08;
      bwCtx.fillStyle = scuff ? '#59361d' : hi ? '#d49d64' : dark ? '#664021' : wave ? '#8f5e35' : '#ad7749';
      bwCtx.fillRect(x, y, 1, 1);
    }
  }

  // Coiled twisted twin-strand galvanized & oxidized barbed wire (32x8)
  const [wi, wiCtx] = makePixelCanvas(32, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 32; x++) {
      const twist = (x + y * 2) % 6;
      const rust = pxHash(x, y, 127) < 0.14;
      wiCtx.fillStyle = rust ? '#783c29' : twist === 0 || twist === 1 ? '#e3ecee' : twist >= 4 ? '#3f474d' : '#7b8891';
      wiCtx.fillRect(x, y, 1, 1);
    }
  }

  // Weathered crimson fire axe head with steel collar & bright honed cutting bit along v=0 (-Y) (32x24)
  const [ax, axCtx] = makePixelCanvas(32, 24);
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 32; x++) {
      const border = y === 0 || x === 0 || x === 31;
      const collar = y <= 5 && x >= 10 && x <= 21;
      const honedBevel = y >= 18;
      const razor = y >= 21;
      const chip = (y >= 15 && y <= 17 && pxHash(x, y, 149) < 0.35) || pxHash(x, y, 151) < 0.06;
      const blood = y >= 19 && x >= 4 && x <= 14 && pxHash(x, y, 163) > 0.55;
      let col = '#b52e26';
      if (border) col = '#2a1614';
      else if (blood) col = '#7a1919';
      else if (razor) col = '#eef4f7';
      else if (honedBevel) col = y === 18 ? '#87949e' : '#c6d1d9';
      else if (collar) col = '#32383e';
      else if (chip) col = '#6f7b85';
      else if (y <= 8) col = '#df4f44';
      axCtx.fillStyle = col;
      axCtx.fillRect(x, y, 1, 1);
    }
  }

  // Forged cast-iron sledgehammer head with machined chamfered strike faces & patina (32x16)
  const [sl, slCtx] = makePixelCanvas(32, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      const faceBottom = y >= 13;
      const faceTop = y <= 2;
      const eyeBand = x >= 12 && x <= 19 && y >= 5 && y <= 10;
      const pit = pxHash(x, y, 193) < 0.1;
      const rust = pxHash(x, y, 197) < 0.07;
      let col = '#444c54';
      if (faceBottom || faceTop) col = y === 15 || y === 0 ? '#aeb9c2' : '#7b8791';
      else if (eyeBand) col = '#262b30';
      else if (rust) col = '#633f2a';
      else if (pit) col = '#32383f';
      else if (y <= 4) col = '#5d6770';
      slCtx.fillStyle = col;
      slCtx.fillRect(x, y, 1, 1);
    }
  }

  // Cross-wrapped dark athletic tape & ribbed rubber grip (16x12)
  const [rg, rgCtx] = makePixelCanvas(16, 12);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 16; x++) {
      const seam = (x + y * 2) % 6 === 0;
      const ridge = x % 4 === 1;
      rgCtx.fillStyle = seam ? '#121417' : ridge ? '#33383f' : '#21252a';
      rgCtx.fillRect(x, y, 1, 1);
    }
  }

  return {
    crowbarSteel: toNearestTexture(cs),
    crowbarRed: toNearestTexture(cr),
    macheteBlade: toNearestTexture(mb),
    macheteGrip: toNearestTexture(mgr),
    batWood: toNearestTexture(bw),
    barbedWire: toNearestTexture(wi),
    axeHead: toNearestTexture(ax),
    sledgeIron: toNearestTexture(sl),
    rubberGrip: toNearestTexture(rg),
    pistolSlide: toNearestTexture(ps),
    pistolGrip: toNearestTexture(pg),
    shotgunWood: toNearestTexture(sw),
    shotgunReceiver: toNearestTexture(sr),
    lmgShroud: toNearestTexture(ls),
    ammoBelt: toNearestTexture(ab),
    lmgAmmoBox: toNearestTexture(lb),
    molotovGlass: toNearestTexture(mg),
    glove: toNearestTexture(gl),
  };
}

function buildMeleeSlashTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 32;
  const [c, ctx] = makePixelCanvas(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / (w - 1); // 0..1 along arc width
      const ny = y / (h - 1); // 0=outer edge, 1=inner trail
      const arcCurve = Math.sin(nx * Math.PI);
      if (arcCurve < 0.08) continue;
      // Crescent thickness swells in middle of swing and tapers sharply at tips
      const outer = 0.08 + (1 - arcCurve) * 0.42;
      const inner = outer + 0.14 + arcCurve * 0.56;
      if (ny < outer || ny > inner) continue;
      const bandPos = (ny - outer) / Math.max(0.01, inner - outer);
      const n = pxHash(x, y, 223);
      // Tapered trailing pixel streaks
      if (bandPos > 0.62 && n < (bandPos - 0.52) * 1.9) continue;
      if (bandPos < 0.22) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      } else if (bandPos < 0.48) {
        ctx.fillStyle = n > 0.25 ? 'rgba(245, 245, 240, 0.72)' : 'rgba(225, 225, 220, 0.48)';
      } else {
        ctx.fillStyle = `rgba(220, 220, 215, ${(Math.max(0.12, (1 - bandPos) * 0.7)).toFixed(2)})`;
      }
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildItemDropTextures(): Record<ItemId, THREE.CanvasTexture> {
  const mk = (draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
    const [c, ctx] = makePixelCanvas(32, 32);
    draw(ctx);
    return toNearestTexture(c);
  };

  return {
    wood: mk((ctx) => {
      drawPixelRect(ctx, 4, 10, 24, 12, '#301d10');
      drawPixelRect(ctx, 5, 11, 22, 10, '#9e6c40');
      drawPixelRect(ctx, 6, 11, 20, 3, '#c48d5a');
      drawPixelRect(ctx, 6, 16, 20, 2, '#734b2a');
      drawPixelRect(ctx, 8, 13, 2, 2, '#241811');
      drawPixelRect(ctx, 22, 13, 2, 2, '#241811');
    }),
    scrap: mk((ctx) => {
      drawPixelRect(ctx, 6, 6, 20, 20, '#1e2429');
      drawPixelRect(ctx, 8, 8, 16, 16, '#76848f');
      drawPixelRect(ctx, 9, 9, 7, 7, '#bcc7cf');
      drawPixelRect(ctx, 17, 16, 6, 6, '#485259');
      drawPixelRect(ctx, 12, 12, 8, 8, '#30373d');
      drawPixelRect(ctx, 14, 14, 4, 4, '#d19a47');
    }),
    cloth: mk((ctx) => {
      drawPixelRect(ctx, 5, 8, 22, 16, '#2d3236');
      drawPixelRect(ctx, 7, 10, 18, 12, '#dbd5c8');
      drawPixelRect(ctx, 8, 11, 16, 4, '#f2eee3');
      drawPixelRect(ctx, 10, 17, 12, 3, '#b5afa2');
      drawPixelRect(ctx, 15, 10, 2, 12, '#9c9587');
    }),
    fuel: mk((ctx) => {
      drawPixelRect(ctx, 7, 5, 18, 23, '#26100e');
      drawPixelRect(ctx, 9, 9, 14, 17, '#cf4632');
      drawPixelRect(ctx, 10, 10, 4, 14, '#eb634d');
      drawPixelRect(ctx, 16, 4, 7, 5, '#e0bd5e');
      drawPixelRect(ctx, 11, 13, 10, 9, '#962b1c');
      drawPixelRect(ctx, 14, 15, 4, 5, '#e6b84c');
    }),
    food: mk((ctx) => {
      drawPixelRect(ctx, 8, 6, 16, 20, '#1c211e');
      drawPixelRect(ctx, 9, 9, 14, 15, '#c48c45');
      drawPixelRect(ctx, 8, 6, 16, 4, '#cdd6cf');
      drawPixelRect(ctx, 11, 13, 10, 6, '#f2d279');
      drawPixelRect(ctx, 13, 15, 6, 2, '#9c422c');
    }),
    water: mk((ctx) => {
      drawPixelRect(ctx, 10, 4, 12, 24, '#182b38');
      drawPixelRect(ctx, 11, 8, 10, 18, '#4ea2d4');
      drawPixelRect(ctx, 12, 4, 8, 4, '#dceef7');
      drawPixelRect(ctx, 13, 10, 3, 13, '#8ad4eb');
      drawPixelRect(ctx, 11, 15, 10, 4, '#eef7fa');
    }),
    bandage: mk((ctx) => {
      drawPixelRect(ctx, 5, 8, 22, 16, '#272d2e');
      drawPixelRect(ctx, 7, 10, 18, 12, '#ebe6da');
      drawPixelRect(ctx, 14, 11, 4, 10, '#d13d34');
      drawPixelRect(ctx, 11, 14, 10, 4, '#d13d34');
    }),
    ammo_9mm: mk((ctx) => {
      drawPixelRect(ctx, 6, 8, 20, 17, '#1d190f');
      drawPixelRect(ctx, 8, 10, 16, 13, '#4c5e3f');
      for (const bx of [10, 15, 20]) {
        drawPixelRect(ctx, bx, 12, 3, 9, '#e0bd5e');
        drawPixelRect(ctx, bx, 10, 3, 3, '#b8703b');
      }
    }),
    ammo_shell: mk((ctx) => {
      drawPixelRect(ctx, 6, 6, 20, 20, '#211212');
      for (const sx of [9, 17]) {
        drawPixelRect(ctx, sx, 8, 6, 14, '#c44237');
        drawPixelRect(ctx, sx + 1, 9, 2, 11, '#e85f54');
        drawPixelRect(ctx, sx, 20, 6, 4, '#e0bd5e');
      }
    }),
    molotov: mk((ctx) => {
      drawPixelRect(ctx, 10, 9, 12, 19, '#1f3018');
      drawPixelRect(ctx, 12, 12, 8, 14, '#5a8747');
      drawPixelRect(ctx, 12, 18, 8, 8, '#d98c2b');
      drawPixelRect(ctx, 13, 6, 6, 4, '#e6dcc8');
      drawPixelRect(ctx, 14, 2, 4, 5, '#ff8f24');
      drawPixelRect(ctx, 15, 3, 2, 3, '#fff2a6');
    }),
    raw_fish: mk((ctx) => {
      drawPixelRect(ctx, 4, 11, 20, 10, '#182830');
      drawPixelRect(ctx, 6, 12, 16, 8, '#7ea8b8');
      drawPixelRect(ctx, 8, 13, 10, 3, '#a4cad9');
      drawPixelRect(ctx, 22, 10, 6, 12, '#5c8596');
      drawPixelRect(ctx, 9, 14, 2, 2, '#f0f7fa');
    }),
    cooked_fish: mk((ctx) => {
      drawPixelRect(ctx, 4, 11, 20, 10, '#29160b');
      drawPixelRect(ctx, 6, 12, 16, 8, '#d4843d');
      drawPixelRect(ctx, 22, 10, 6, 12, '#a85b27');
      drawPixelRect(ctx, 10, 12, 2, 8, '#783b18');
      drawPixelRect(ctx, 16, 12, 2, 8, '#783b18');
    }),
    fish_stew: mk((ctx) => {
      drawPixelRect(ctx, 4, 14, 24, 12, '#182224');
      drawPixelRect(ctx, 6, 16, 20, 8, '#475c61');
      drawPixelRect(ctx, 6, 14, 20, 4, '#f0b659');
      drawPixelRect(ctx, 11, 7, 2, 5, '#e6dfd1');
      drawPixelRect(ctx, 19, 6, 2, 6, '#e6dfd1');
    }),
    hot_rations: mk((ctx) => {
      drawPixelRect(ctx, 7, 9, 18, 18, '#191d1a');
      drawPixelRect(ctx, 9, 11, 14, 14, '#9a935a');
      drawPixelRect(ctx, 9, 15, 14, 6, '#c76432');
      drawPixelRect(ctx, 15, 4, 3, 6, '#cfd6d9');
    }),
  };
}

function buildTentCanvasTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(48, 48);
  drawZombieDither(ctx, 0, 0, 48, 48, '#53633f', '#64774c', '#414f31', 127);
  // Subtle woven ripstop grid & single center ridge seam
  for (let y = 0; y < 48; y += 4) {
    drawPixelRect(ctx, 0, y, 48, 1, '#4a5938');
  }
  drawPixelRect(ctx, 23, 0, 2, 48, '#333e25');
  // Weathered survival tan trim stripe & muddy bottom hem
  drawPixelRect(ctx, 0, 38, 48, 3, '#9c6e38');
  drawPixelRect(ctx, 0, 38, 48, 1, '#b88649');
  drawZombieDither(ctx, 0, 42, 48, 6, '#30281d', '#3e3325', '#211c14', 129);
  drawPixelRect(ctx, 4, 43, 3, 3, '#d9b555');
  drawPixelRect(ctx, 41, 43, 3, 3, '#d9b555');
  return toNearestTexture(c);
}

function buildRockGraniteTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(48, 48);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const n = pxHash(x, y, 137);
      const strata = pxHash(Math.floor(x / 3), Math.floor(y / 2), 141);
      const crack =
        (Math.abs(x - y * 0.7 - 8) < 1.1 && y > 6 && y < 38) ||
        (Math.abs(y - 28 + Math.sin(x * 0.3) * 3) < 0.9 && x > 14);
      let col = strata < 0.25 ? '#787e82' : strata < 0.65 ? '#5c6266' : '#454a4e';
      if (crack) col = '#232729';
      else if (n > 0.88) col = '#91979c'; // quartz fleck
      else if (y < 10 && strata < 0.35) col = '#4f6940'; // lichen/moss
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildFlameSpriteTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(32, 48);
  // Crisp serrated pixel-art flame silhouette with incandescent core & rising sparks
  for (let y = 0; y < 48; y++) {
    const ny = 1 - y / 47; // 0 = base, 1 = tip
    const flickerWave = Math.sin(ny * 10.5) * 1.8 + Math.cos(ny * 18.0) * 1.1;
    const halfW = Math.max(0, (1 - Math.pow(ny, 0.75)) * 12.5 + flickerWave * (1 - ny * 0.6));
    const cx = 15.5 + Math.sin(ny * 6.2) * 1.6;
    for (let x = 0; x < 32; x++) {
      if (ny > 0.88) continue;
      const dx = Math.abs(x - cx);
      const n = pxHash(x, y, 173);
      if (dx <= halfW && (ny > 0.08 || Math.abs(x - 15.5) < 11)) {
        const edgeRatio = dx / Math.max(0.5, halfW);
        let col = '#ff7b19';
        if (edgeRatio > 0.78 || ny > 0.72) col = n > 0.4 ? '#d93618' : '#f2571b';
        else if (edgeRatio < 0.36 && ny < 0.48) col = ny < 0.28 ? '#fff9c4' : '#ffe169';
        else if (edgeRatio < 0.62 && ny < 0.64) col = '#ffb636';
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // Rising floating ember sparks above the flame tongue
  drawPixelRect(ctx, 12, 3, 2, 2, '#ffe073');
  drawPixelRect(ctx, 20, 6, 2, 2, '#ff8d24');
  drawPixelRect(ctx, 16, 1, 1, 2, '#fff5b8');
  return toNearestTexture(c);
}

function buildFirePuddleTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = (x - 31.5) / 30;
      const dy = (y - 31.5) / 30;
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const n = pxHash(x, y, 191);
      const lobe = Math.sin(ang * 5 + 0.7) * 0.08 + Math.cos(ang * 3 - 1.2) * 0.06;
      const d = r + lobe + (n - 0.5) * 0.18;
      if (d > 0.92) continue;
      // Sparse fractured edge instead of a hard circle
      if (d > 0.74 && n > 0.55) continue;
      let col = '#17100c';
      if (d < 0.24) col = n > 0.35 ? '#fff2a3' : '#ffbf38';
      else if (d < 0.46) col = n > 0.45 ? '#ff7d1a' : '#d93e14';
      else if (d < 0.68) col = n > 0.62 ? '#b83211' : '#3d160c';
      else col = n > 0.72 ? '#5c1d0d' : '#1b110d';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildRoadSignTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const border = x === 0 || y === 0 || x === 15 || y === 15;
      const innerBorder = x === 1 || y === 1 || x === 14 || y === 14;
      const rust = (x * 7 + y * 13) % 11 === 0;
      const exclaim = (x >= 7 && x <= 8 && y >= 4 && y <= 9) || (x >= 7 && x <= 8 && y >= 11 && y <= 12);
      let col = '#d9a434';
      if (border) col = '#26221a';
      else if (innerBorder || exclaim) col = '#1b1d1f';
      else if (rust) col = '#7a4a24';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildWreckedCarTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(128, 32);
  drawZombieDither(ctx, 0, 0, 128, 32, '#755c47', '#8f7258', '#523f30', 307);
  drawPixelRect(ctx, 0, 0, 128, 3, '#9c7e62');
  drawPixelRect(ctx, 0, 12, 128, 2, '#4a3829');
  // Oxidized rust-orange patina & burn streaks across doors, side intake & fenders
  drawZombieDither(ctx, 8, 8, 30, 16, '#994823', '#bd5c2e', '#612910', 311);
  drawZombieDither(ctx, 76, 4, 34, 20, '#362c27', '#4a3c35', '#1c1714', 313);
  drawPixelRect(ctx, 38, 10, 16, 13, '#171514'); // charred side intake
  drawPixelRect(ctx, 56, 5, 1, 20, '#1a1614');
  drawPixelRect(ctx, 84, 5, 1, 20, '#1a1614');
  drawPixelRect(ctx, 0, 25, 128, 7, '#1c1917'); // scorched carbon rocker
  drawPixelDisc(ctx, 26, 27, 13, '#11100f');
  drawPixelDisc(ctx, 100, 27, 13, '#11100f');
  return toNearestTexture(c);
}

function buildWreckedCarTopTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(128, 64);
  drawZombieDither(ctx, 0, 0, 128, 64, '#755c47', '#8f7258', '#523f30', 317);
  // Faded ochre racing stripes & burnt-copper rust patches
  drawPixelRect(ctx, 4, 22, 120, 6, '#a69681');
  drawPixelRect(ctx, 4, 36, 120, 6, '#a69681');
  drawZombieDither(ctx, 84, 10, 34, 44, '#362a23', '#994823', '#1c1714', 331);
  // Charred mid-engine louver bay
  drawPixelRect(ctx, 6, 12, 34, 40, '#171514');
  drawPixelRect(ctx, 12, 18, 22, 10, '#853d1e');
  drawPixelRect(ctx, 12, 36, 22, 10, '#853d1e');
  return toNearestTexture(c);
}

export class ThreePixelAtlas {
  /** Rebuild the player's actor textures in place after an appearance change.
   * Canvas image buffers are swapped on the existing texture objects, so every
   * material already referencing them (rig, first-person arms) updates live. */
  public refreshPlayerActorTextures(): void {
    const swap = (target: THREE.CanvasTexture, next: THREE.CanvasTexture) => {
      target.image = next.image;
      target.needsUpdate = true;
    };
    const h = buildActorHeadTextures('player');
    const t = buildActorTorsoTextures('player');
    const l = buildActorLimbTextures('player');
    swap(this.actorHeadTex.player.front, h.front);
    swap(this.actorHeadTex.player.back, h.back);
    swap(this.actorHeadTex.player.side, h.side);
    swap(this.actorHeadTex.player.top, h.top);
    swap(this.actorTorsoTex.player.front, t.front);
    swap(this.actorTorsoTex.player.back, t.back);
    swap(this.actorTorsoTex.player.side, t.side);
    swap(this.actorLimbTex.player.sleeve, l.sleeve);
    swap(this.actorLimbTex.player.leg, l.leg);
  }

  public readonly tileCanvases = new Map<string, HTMLCanvasElement>();
  public readonly wallSideTextures = new Map<string, THREE.CanvasTexture>();
  public readonly wallCapTextures = new Map<string, THREE.CanvasTexture>();
  public readonly crateSideTex: Record<'wood' | 'military', THREE.CanvasTexture>;
  public readonly crateTopTex: Record<'wood' | 'military', THREE.CanvasTexture>;
  public readonly bookshelfFrontTex: THREE.CanvasTexture;
  public readonly barrierTex: THREE.CanvasTexture;
  public readonly doorTex: THREE.CanvasTexture;
  public readonly doorLockedTex: THREE.CanvasTexture;
  public readonly pineTex: THREE.CanvasTexture;
  public readonly barkTex: THREE.CanvasTexture;
  public readonly treeRingTex: THREE.CanvasTexture;
  public readonly quiltTex: THREE.CanvasTexture;
  public readonly dumpsterTex: THREE.CanvasTexture;
  public readonly sandbagTex: THREE.CanvasTexture;
  public readonly decalTex: Record<'blood' | 'scorch' | 'acid' | 'tire', THREE.CanvasTexture>;
  public readonly bulletImpactTex: Record<'stone' | 'wood' | 'metal' | 'blood_wall', THREE.CanvasTexture>;

  // Pixel-art model surface textures
  public readonly actorHeadTex: Record<'player' | 'walker' | 'runner' | 'bloater' | 'spitter', { front: THREE.CanvasTexture; back: THREE.CanvasTexture; side: THREE.CanvasTexture; top: THREE.CanvasTexture; jaw?: THREE.CanvasTexture }>;
  public readonly actorTorsoTex: Record<'player' | 'walker' | 'runner' | 'bloater' | 'spitter', { front: THREE.CanvasTexture; back: THREE.CanvasTexture; side: THREE.CanvasTexture }>;
  public readonly actorLimbTex: Record<'player' | 'walker' | 'runner' | 'bloater' | 'spitter', { sleeve: THREE.CanvasTexture; leg: THREE.CanvasTexture }>;
  public readonly pustuleTex: { lime: THREE.CanvasTexture; cyan: THREE.CanvasTexture };
  public readonly backpackTex: THREE.CanvasTexture;
  public readonly vehicleTex: Record<'sedan' | 'police', ReturnType<typeof buildVehicleTextures>>;
  public readonly fridgeFrontTex: THREE.CanvasTexture;
  public readonly medCabFrontTex: THREE.CanvasTexture;
  public readonly stoveTex: ReturnType<typeof buildStoveTextures>;
  public readonly tvTex: ReturnType<typeof buildTvTextures>;
  public readonly barrelTex: THREE.CanvasTexture;
  public readonly couchTex: THREE.CanvasTexture;
  public readonly woodOakTex: THREE.CanvasTexture;
  public readonly woodDarkTex: THREE.CanvasTexture;
  public readonly ceilingTex: THREE.CanvasTexture;
  public readonly weaponTex: ReturnType<typeof buildWeaponTextures>;
  public readonly meleeSlashTex: THREE.CanvasTexture;
  public readonly itemDropTex: Record<ItemId, THREE.CanvasTexture>;
  public readonly contactShadowTex: THREE.CanvasTexture;
  public readonly tentTex: THREE.CanvasTexture;
  public readonly rockTex: THREE.CanvasTexture;
  public readonly roadSignTex: THREE.CanvasTexture;
  public readonly wreckedCarTex: THREE.CanvasTexture;
  public readonly wreckedCarTopTex: THREE.CanvasTexture;
  public readonly flameTex: THREE.CanvasTexture;
  public readonly firePuddleTex: THREE.CanvasTexture;

  private allTextures: THREE.Texture[] = [];

  constructor() {
    const tileKinds: TileKind[] = [
      'grass',
      'dirt',
      'road',
      'sidewalk',
      'floor',
      'floor_rug',
      'floor_bath',
      'floor_porch',
      'water',
      'pier',
      'crosswalk',
      'tile_clinic',
      'tile_diner',
      'forest_floor',
      'gravel',
      'mud',
      'sand',
      'asphalt_cracked',
    ];
    for (const kind of tileKinds) {
      for (let v = 0; v < 4; v++) {
        this.tileCanvases.set(`${kind}_${v}`, buildSquareTileCanvas(kind, v));
      }
    }

    for (const kind of ['wall_brick', 'wall_wood', 'wall_interior'] as const) {
      this.wallCapTextures.set(kind, this.track(buildWallCapTexture(kind)));
      this.wallSideTextures.set(`${kind}_0`, this.track(buildWallSideTexture(kind, false)));
      this.wallSideTextures.set(`${kind}_1`, this.track(buildWallSideTexture(kind, kind !== 'wall_interior')));
    }

    this.crateSideTex = {
      wood: this.track(buildCrateSideTexture(false)),
      military: this.track(buildCrateSideTexture(true)),
    };
    this.crateTopTex = {
      wood: this.track(buildCrateTopTexture(false)),
      military: this.track(buildCrateTopTexture(true)),
    };
    this.bookshelfFrontTex = this.track(buildBookshelfFrontTexture());
    this.barrierTex = this.track(buildBarrierTexture());
    this.doorTex = this.track(buildDoorTexture(false));
    this.doorLockedTex = this.track(buildDoorTexture(true));
    this.pineTex = this.track(buildPineFoliageTexture());
    this.barkTex = this.track(buildBarkTexture());
    this.treeRingTex = this.track(buildTreeRingTexture());
    this.quiltTex = this.track(buildQuiltTexture());
    this.dumpsterTex = this.track(buildDumpsterSideTexture());
    this.sandbagTex = this.track(buildSandbagTexture());
    this.decalTex = {
      blood: this.track(buildDecalTexture('blood')),
      scorch: this.track(buildDecalTexture('scorch')),
      acid: this.track(buildDecalTexture('acid')),
      tire: this.track(buildDecalTexture('tire')),
    };
    this.bulletImpactTex = {
      stone: this.track(buildBulletImpactTexture('stone')),
      wood: this.track(buildBulletImpactTexture('wood')),
      metal: this.track(buildBulletImpactTexture('metal')),
      blood_wall: this.track(buildBulletImpactTexture('blood_wall')),
    };

    const kinds = ['player', 'walker', 'runner', 'bloater', 'spitter'] as const;
    this.actorHeadTex = {} as typeof this.actorHeadTex;
    this.actorTorsoTex = {} as typeof this.actorTorsoTex;
    this.actorLimbTex = {} as typeof this.actorLimbTex;
    for (const k of kinds) {
      const h = buildActorHeadTextures(k);
      const t = buildActorTorsoTextures(k);
      const l = buildActorLimbTextures(k);
      this.track(h.front);
      this.track(h.back);
      this.track(h.side);
      this.track(h.top);
      if (h.jaw) this.track(h.jaw);
      this.track(t.front);
      this.track(t.back);
      this.track(t.side);
      this.track(l.sleeve);
      this.track(l.leg);
      this.actorHeadTex[k] = h;
      this.actorTorsoTex[k] = t;
      this.actorLimbTex[k] = l;
    }

    this.pustuleTex = {
      lime: this.track(buildPustuleTexture(false)),
      cyan: this.track(buildPustuleTexture(true)),
    };
    this.backpackTex = this.track(buildBackpackTexture());
    const sedanTex = buildVehicleTextures(false);
    const policeTex = buildVehicleTextures(true);
    for (const vt of [sedanTex, policeTex]) {
      this.track(vt.side);
      this.track(vt.roof);
      this.track(vt.front);
      this.track(vt.rear);
      this.track(vt.glass);
      this.track(vt.wheel);
    }
    this.vehicleTex = { sedan: sedanTex, police: policeTex };

    this.fridgeFrontTex = this.track(buildFridgeFrontTexture());
    this.medCabFrontTex = this.track(buildMedCabinetFrontTexture());
    this.stoveTex = buildStoveTextures();
    this.track(this.stoveTex.front);
    this.track(this.stoveTex.top);
    this.tvTex = buildTvTextures();
    this.track(this.tvTex.screen);
    this.track(this.tvTex.cabinet);
    this.barrelTex = this.track(buildBurnBarrelTexture());
    this.couchTex = this.track(buildCouchTexture());
    this.woodOakTex = this.track(buildWoodPlankTexture('#9c6e46', '#ad7d53', '#6e4b2e'));
    this.woodDarkTex = this.track(buildWoodPlankTexture('#694429', '#7d5435', '#452b18'));
    this.ceilingTex = this.track(buildCeilingTexture());
    this.weaponTex = buildWeaponTextures();
    this.track(this.weaponTex.crowbarSteel);
    this.track(this.weaponTex.crowbarRed);
    this.track(this.weaponTex.macheteBlade);
    this.track(this.weaponTex.macheteGrip);
    this.track(this.weaponTex.batWood);
    this.track(this.weaponTex.barbedWire);
    this.track(this.weaponTex.axeHead);
    this.track(this.weaponTex.sledgeIron);
    this.track(this.weaponTex.rubberGrip);
    this.track(this.weaponTex.pistolSlide);
    this.track(this.weaponTex.pistolGrip);
    this.track(this.weaponTex.shotgunWood);
    this.track(this.weaponTex.shotgunReceiver);
    this.track(this.weaponTex.lmgShroud);
    this.track(this.weaponTex.ammoBelt);
    this.track(this.weaponTex.lmgAmmoBox);
    this.track(this.weaponTex.molotovGlass);
    this.track(this.weaponTex.glove);
    this.meleeSlashTex = this.track(buildMeleeSlashTexture());
    this.itemDropTex = buildItemDropTextures();
    for (const tex of Object.values(this.itemDropTex)) {
      this.track(tex);
    }
    this.contactShadowTex = this.track(buildSoftContactShadowTexture());
    this.tentTex = this.track(buildTentCanvasTexture());
    this.rockTex = this.track(buildRockGraniteTexture());
    this.roadSignTex = this.track(buildRoadSignTexture());
    this.wreckedCarTex = this.track(buildWreckedCarTexture());
    this.wreckedCarTopTex = this.track(buildWreckedCarTopTexture());
    this.flameTex = this.track(buildFlameSpriteTexture());
    this.firePuddleTex = this.track(buildFirePuddleTexture());
  }

  private track<T extends THREE.Texture>(tex: T): T {
    this.allTextures.push(tex);
    return tex;
  }

  getTileCanvas(kind: TileKind, variant: number): HTMLCanvasElement {
    return this.tileCanvases.get(`${kind}_${variant % 4}`)!;
  }

  createChunkTerrainTexture(getCell: (gx: number, gy: number) => { tile: TileKind; variant: number }, cx: number, cy: number, chunkSize: number): THREE.CanvasTexture {
    const pxPerTile = 32;
    const dim = chunkSize * pxPerTile;
    const [c, ctx] = makePixelCanvas(dim, dim);
    const startX = cx * chunkSize;
    const startY = cy * chunkSize;
    for (let ly = 0; ly < chunkSize; ly++) {
      for (let lx = 0; lx < chunkSize; lx++) {
        const cell = getCell(startX + lx, startY + ly);
        const tileCanvas = this.getTileCanvas(cell.tile, cell.variant);
        ctx.drawImage(tileCanvas, lx * pxPerTile, ly * pxPerTile);
      }
    }
    return toNearestTexture(c);
  }

  dispose(): void {
    for (const t of this.allTextures) {
      t.dispose();
    }
    this.allTextures = [];
  }
}

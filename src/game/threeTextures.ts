import * as THREE from 'three';
import { derivePlayerPalette, shadeHex } from './profile';
import type { ItemId, TileKind } from './types';
import { computeWaterShoreDepth } from './waterSystem';

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

function toOrganicTexture(canvas: HTMLCanvasElement, wrapS = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = wrapS ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function paintSoftMottle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  count: number,
  colors: string[],
  minR: number,
  maxR: number,
  alpha: number,
  seed: number,
  wrapX = true
): void {
  ctx.save();
  for (let i = 0; i < count; i++) {
    const rx = pxHash(i, 1, seed) * w;
    const ry = pxHash(i, 2, seed) * h;
    const r = minR + pxHash(i, 3, seed) * (maxR - minR);
    const col = colors[Math.floor(pxHash(i, 4, seed) * colors.length) % colors.length];
    const a = alpha * (0.55 + 0.45 * pxHash(i, 5, seed));
    const drawAt = (cx: number) => {
      const grad = ctx.createRadialGradient(cx, ry, r * 0.12, cx, ry, r);
      grad.addColorStop(0, col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = a;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, ry, r, 0, Math.PI * 2);
      ctx.fill();
    };
    drawAt(rx);
    if (wrapX) {
      if (rx - r < 0) drawAt(rx + w);
      if (rx + r > w) drawAt(rx - w);
    }
  }
  ctx.restore();
}

function paintFabricWeave(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  hiColor: string,
  darkColor: string,
  seed: number
): void {
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = darkColor;
  for (let y = y0; y < y0 + h; y += 3) {
    ctx.fillRect(x0, y, w, 1);
  }
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = hiColor;
  for (let x = x0; x < x0 + w; x += 4) {
    ctx.fillRect(x, y0, 1, h);
  }
  // Subtle directional cloth creases
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = darkColor;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) {
    const sx = x0 + pxHash(i, 11, seed) * w;
    const sy = y0 + pxHash(i, 12, seed) * h * 0.7;
    const len = 14 + pxHash(i, 13, seed) * 26;
    const dx = (pxHash(i, 14, seed) - 0.5) * 14;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + dx * 0.6, sy + len * 0.5, sx + dx, sy + len);
    ctx.stroke();
  }
  ctx.restore();
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
      } else if (kind === 'bridge_deck') {
        // Heavy bolted timber & weathered steel river bridge deck
        const ns = variant >= 2;
        const seam = ns ? y % 6 === 0 : x % 6 === 0;
        const rail = ns ? x <= 2 || x >= size - 3 : y <= 2 || y >= size - 3;
        const stripe = ns ? (x === 3 || x === size - 4) && y % 8 < 4 : (y === 3 || y === size - 4) && x % 8 < 4;
        if (rail) col = r < 0.3 ? '#6d757d' : '#4a5259';
        else if (stripe) col = '#c9a23a';
        else if (seam) col = '#241910';
        else if ((ns ? y % 6 === 1 : x % 6 === 1)) col = '#9c6e46';
        else col = r < 0.28 ? '#875f3c' : r < 0.74 ? '#6e4c2e' : '#573b23';
      } else if (kind === 'cave_floor') {
        // Damp dark slate cavern floor with subtle granite speckles & pebbles
        const slab = hash(Math.floor(x / 4), Math.floor(y / 4), 11);
        const crevice = (x + y * 2 + variant * 5) % 19 === 0 && r < 0.4;
        if (crevice) col = '#14171c';
        else if (slab < 0.25) col = '#2d323b';
        else if (slab < 0.65) col = '#232830';
        else col = '#1c2026';
        if (r > 0.93) col = '#4a525e';
      } else if (kind === 'cliff_stone') {
        // Stratified craggy dark granite cliff rock
        const strata = Math.floor((y + Math.sin(x * 0.35 + variant) * 2.2) / 5);
        const crack = (y + Math.round(Math.sin(x * 0.4) * 2)) % 5 === 0;
        if (crack) col = '#1d2126';
        else if ((strata + variant) % 3 === 0) col = r < 0.3 ? '#6b727a' : '#575d66';
        else if ((strata + variant) % 3 === 1) col = r < 0.3 ? '#525861' : '#41474f';
        else col = r < 0.25 ? '#485442' : '#353a42'; // subtle cliff moss
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
  wrap?: THREE.CanvasTexture;
  eye?: THREE.CanvasTexture;
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

  // High-craft organic horror textures for all four zombie archetypes
  const S = 64;
  const [cf, fctx] = makePixelCanvas(S, S);
  const [cb, bctx] = makePixelCanvas(S, S);
  const [cs, sctx] = makePixelCanvas(S, S);
  const [ct, tctx] = makePixelCanvas(S, S);

  const pal =
    kind === 'walker'
      ? {
          skin: '#7e8f77',
          hi: '#a3b39a',
          dark: '#465442',
          rot: '#252e23',
          bruise: '#3d2a30',
          eye: '#e85a3a',
          eyeRim: '#992218',
          eyeCore: '#fff0c2',
          seed: 11,
        }
      : kind === 'runner'
        ? {
            skin: '#966c68',
            hi: '#ba8d86',
            dark: '#572f2e',
            rot: '#2e1213',
            bruise: '#6e161a',
            eye: '#ff4b2b',
            eyeRim: '#a6140c',
            eyeCore: '#fff6cc',
            seed: 23,
          }
        : kind === 'bloater'
          ? {
              skin: '#728554',
              hi: '#95ab71',
              dark: '#42522d',
              rot: '#253017',
              bruise: '#473e29',
              eye: '#b5e342',
              eyeRim: '#4f7314',
              eyeCore: '#f6ffd6',
              seed: 37,
            }
          : {
              skin: '#5d7d7a',
              hi: '#81a6a2',
              dark: '#2e4544',
              rot: '#172626',
              bruise: '#1f3638',
              eye: '#5ef2b5',
              eyeRim: '#167a5c',
              eyeCore: '#e8fff6',
              seed: 53,
            };

  for (const [idx, ctx] of [fctx, bctx, sctx, tctx].entries()) {
    drawPixelRect(ctx, 0, 0, S, S, pal.skin);
    paintSoftMottle(ctx, S, S, 28, [pal.dark, pal.hi, pal.rot], 4, 14, 0.36, pal.seed + idx * 7, false);
  }

  // Dedicated 64x32 anatomical lower mandible skin, gumline & dried-gore texture
  const [cj, jctx] = makePixelCanvas(64, 32);
  jctx.imageSmoothingEnabled = true;
  jctx.fillStyle = pal.skin;
  jctx.fillRect(0, 0, 64, 32);
  paintSoftMottle(jctx, 64, 32, 34, [pal.dark, pal.hi, pal.bruise, pal.rot], 3, 10, 0.42, pal.seed + 199, false);
  // Darkened bloodstained gum rim along top edge & deep chin under-shadow
  const jawGrad = jctx.createLinearGradient(0, 0, 0, 32);
  jawGrad.addColorStop(0, 'rgba(62, 8, 10, 0.92)');
  jawGrad.addColorStop(0.22, 'rgba(92, 16, 18, 0.45)');
  jawGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
  jawGrad.addColorStop(1, 'rgba(18, 14, 14, 0.65)');
  jctx.fillStyle = jawGrad;
  jctx.fillRect(0, 0, 64, 32);
  // Dried blood/bile drips running down the chin
  const dripCol = kind === 'bloater' ? '#6c9122' : kind === 'spitter' ? '#2da878' : '#6b1012';
  jctx.fillStyle = dripCol;
  jctx.globalAlpha = 0.72;
  for (let i = 0; i < 6; i++) {
    const dx = 14 + i * 7 + (i % 2) * 2;
    const dh = 10 + ((i * 7 + pal.seed) % 14);
    jctx.fillRect(dx, 2, 2.5, dh);
  }
  jctx.globalAlpha = 1;

  // High-detail 256x128 seamless spherical wrap aligned to createSculptedSkullGeometry UVs:
  // x=128 is +X front face; eyes sit at x=113 & x=143, y=62; brow at y=52; nose at y=69; maxilla y=82..98.
  const W = 256;
  const H = 128;
  const [cw, wctx] = makePixelCanvas(W, H);
  wctx.imageSmoothingEnabled = true;
  wctx.fillStyle = pal.skin;
  wctx.fillRect(0, 0, W, H);

  // Organic cadaver skin mottling, subtle bruising, and cranial light/shadow falloff
  paintSoftMottle(wctx, W, H, 120, [pal.dark, pal.hi, pal.bruise, pal.rot], 5, 22, 0.34, pal.seed + 307, true);
  const skullVGrad = wctx.createLinearGradient(0, 0, 0, H);
  skullVGrad.addColorStop(0, 'rgba(24, 28, 22, 0.44)');
  skullVGrad.addColorStop(0.18, 'rgba(255, 255, 240, 0.08)');
  skullVGrad.addColorStop(0.70, 'rgba(0, 0, 0, 0.0)');
  skullVGrad.addColorStop(1, 'rgba(14, 10, 10, 0.78)');
  wctx.fillStyle = skullVGrad;
  wctx.fillRect(0, 0, W, H);

  // Subtle scalp / nape hair shadow wrapping seamlessly across x=0/256 (-X back)
  paintSoftMottle(wctx, W, 44, 48, [pal.rot, '#1c1816', pal.dark], 6, 18, 0.42, pal.seed + 313, true);

  // Sculpted brow ridge highlight + heavy angry glabella/supraorbital shadow crease
  wctx.save();
  wctx.strokeStyle = pal.rot;
  wctx.lineWidth = 3.5;
  wctx.globalAlpha = 0.72;
  wctx.beginPath();
  wctx.moveTo(104, 52);
  wctx.quadraticCurveTo(118, 49, 128, 54);
  wctx.quadraticCurveTo(138, 49, 152, 52);
  wctx.stroke();
  // Forehead frown wrinkles
  wctx.lineWidth = 1.4;
  wctx.globalAlpha = 0.45;
  for (let fy = 40; fy <= 46; fy += 3) {
    wctx.beginPath();
    wctx.moveTo(112, fy);
    wctx.quadraticCurveTo(128, fy + 2, 144, fy);
    wctx.stroke();
  }
  // Brow bone & zygomatic cheekbone specular catchlights
  wctx.globalAlpha = 0.34;
  wctx.fillStyle = pal.hi;
  wctx.beginPath();
  wctx.ellipse(114, 49, 10, 2.5, -0.1, 0, Math.PI * 2);
  wctx.ellipse(142, 49, 10, 2.5, 0.1, 0, Math.PI * 2);
  wctx.ellipse(105, 70, 9, 3.5, 0.2, 0, Math.PI * 2);
  wctx.ellipse(151, 70, 9, 3.5, -0.2, 0, Math.PI * 2);
  wctx.fill();
  wctx.restore();

  // Deeply bruised recessed orbital sockets precisely centered on 3D eyeball sockets (x=113, 143; y=62)
  for (const ex of [113, 143]) {
    const outer = wctx.createRadialGradient(ex, 62, 2, ex, 62, 12.5);
    outer.addColorStop(0, 'rgba(10, 5, 6, 0.96)');
    outer.addColorStop(0.55, 'rgba(26, 12, 15, 0.85)');
    outer.addColorStop(0.82, 'rgba(48, 22, 26, 0.45)');
    outer.addColorStop(1, 'rgba(0, 0, 0, 0)');
    wctx.fillStyle = outer;
    wctx.beginPath();
    wctx.arc(ex, 62, 12.5, 0, Math.PI * 2);
    wctx.fill();
  }

  // Gaunt buccal cheek hollows & desiccated nasal bridge + dark piriform cavity
  for (const cx of [100, 156]) {
    const hollow = wctx.createRadialGradient(cx, 80, 2, cx, 80, 14);
    hollow.addColorStop(0, 'rgba(24, 16, 18, 0.56)');
    hollow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    wctx.fillStyle = hollow;
    wctx.beginPath();
    wctx.arc(cx, 80, 14, 0, Math.PI * 2);
    wctx.fill();
  }
  wctx.fillStyle = pal.hi;
  wctx.globalAlpha = 0.32;
  wctx.fillRect(126, 56, 4, 11);
  wctx.globalAlpha = 1;
  const noseGrad = wctx.createRadialGradient(128, 70, 1, 128, 70, 6.5);
  noseGrad.addColorStop(0, '#0f0708');
  noseGrad.addColorStop(0.65, '#241013');
  noseGrad.addColorStop(1, 'rgba(0,0,0,0)');
  wctx.fillStyle = noseGrad;
  wctx.beginPath();
  wctx.ellipse(128, 70, 5.5, 6.5, 0, 0, Math.PI * 2);
  wctx.fill();

  // Narrow bloodied gumline & jagged dried-blood drips (avoids cartoon oval around snout)
  const mouthGrad = wctx.createRadialGradient(128, 86, 3, 128, 86, 17);
  mouthGrad.addColorStop(0, kind === 'spitter' ? 'rgba(12, 54, 42, 0.92)' : 'rgba(54, 8, 10, 0.90)');
  mouthGrad.addColorStop(0.55, kind === 'spitter' ? 'rgba(20, 74, 58, 0.55)' : 'rgba(78, 14, 16, 0.46)');
  mouthGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  wctx.fillStyle = mouthGrad;
  wctx.beginPath();
  wctx.ellipse(128, 86, 17, 7.5, 0, 0, Math.PI * 2);
  wctx.fill();
  // Irregular dried gore/bile drips down chin
  wctx.fillStyle = kind === 'spitter' ? 'rgba(42, 168, 122, 0.45)' : kind === 'bloater' ? 'rgba(116, 152, 34, 0.50)' : 'rgba(84, 12, 14, 0.65)';
  wctx.fillRect(118, 89, 3, 14);
  wctx.fillRect(126, 91, 4, 18);
  wctx.fillRect(136, 89, 3, 12);

  // Archetype-specific facial horror storytelling
  if (kind === 'walker') {
    // Exposed pale fractured cranial bone on left temple + dark lacerated right cheek
    const boneGrad = wctx.createRadialGradient(90, 34, 2, 90, 34, 14);
    boneGrad.addColorStop(0, '#dbd0bb');
    boneGrad.addColorStop(0.58, '#b0a38b');
    boneGrad.addColorStop(0.84, '#591616');
    boneGrad.addColorStop(1, 'rgba(0,0,0,0)');
    wctx.fillStyle = boneGrad;
    wctx.beginPath();
    wctx.arc(90, 34, 14, 0, Math.PI * 2);
    wctx.fill();

    // Jagged cheek laceration exposing dark bruised tissue
    wctx.fillStyle = 'rgba(72, 14, 16, 0.80)';
    wctx.beginPath();
    wctx.ellipse(150, 79, 9, 5.5, -0.35, 0, Math.PI * 2);
    wctx.fill();
  } else if (kind === 'runner') {
    // Organic raw crimson flayed musculature & deep coagulated gore across cheeks & brow (no zebra stripes!)
    paintSoftMottle(wctx, W, H, 85, ['#661113', '#8a1c1e', '#3d090b', '#753835'], 5, 18, 0.58, 439, true);
    // Subtle dark bruised brow & sinew crease lines
    wctx.save();
    wctx.strokeStyle = 'rgba(44, 6, 8, 0.62)';
    wctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const sy = 56 + i * 9;
      wctx.beginPath();
      wctx.moveTo(82, sy + 3);
      wctx.quadraticCurveTo(96, sy - 2, 108, sy + 2);
      wctx.stroke();
      wctx.beginPath();
      wctx.moveTo(174, sy + 3);
      wctx.quadraticCurveTo(160, sy - 2, 148, sy + 2);
      wctx.stroke();
    }
    wctx.restore();
  } else if (kind === 'bloater') {
    // Deep bruised skin folds & dark necrotic crater rings (no cartoonish lime polka dots!)
    const craters: Array<[number, number, number]> = [
      [88, 44, 14],
      [164, 70, 15],
      [54, 62, 13],
      [204, 58, 13],
    ];
    for (const [cx, cy, r] of craters) {
      const cg = wctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      cg.addColorStop(0, 'rgba(130, 168, 42, 0.60)');
      cg.addColorStop(0.55, 'rgba(44, 58, 22, 0.78)');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      wctx.fillStyle = cg;
      wctx.beginPath();
      wctx.arc(cx, cy, r, 0, Math.PI * 2);
      wctx.fill();
    }
  } else {
    // Spitter: gaunt corpse-teal mottling + localized bioluminescent venom glands on lower cheeks (no forehead stripes!)
    paintSoftMottle(wctx, W, H, 65, ['#243b39', '#4a6b68', '#172928', '#335952'], 5, 18, 0.44, 449, true);
    wctx.save();
    for (const gx of [86, 170]) {
      const gg = wctx.createRadialGradient(gx, 78, 2, gx, 78, 16);
      gg.addColorStop(0, 'rgba(72, 228, 164, 0.52)');
      gg.addColorStop(0.55, 'rgba(20, 74, 60, 0.65)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      wctx.fillStyle = gg;
      wctx.beginPath();
      wctx.arc(gx, 78, 16, 0, Math.PI * 2);
      wctx.fill();
    }
    // Delicate lower-jaw glowing veins branching from cheek glands
    wctx.strokeStyle = 'rgba(76, 232, 170, 0.58)';
    wctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const yStart = 66 + i * 9;
      wctx.beginPath();
      wctx.moveTo(80, yStart + 4);
      wctx.quadraticCurveTo(96, yStart, 108, yStart + 3);
      wctx.stroke();
      wctx.beginPath();
      wctx.moveTo(176, yStart + 4);
      wctx.quadraticCurveTo(160, yStart, 148, yStart + 3);
      wctx.stroke();
    }
    wctx.restore();
  }

  // Dedicated 64x64 horror eyeball texture (iris/pupil centered at 32,32 -> faces +X on SphereGeometry!)
  const [ce, ectx] = makePixelCanvas(64, 64);
  ectx.imageSmoothingEnabled = true;
  // Dark bloodshot necrotic sclera
  ectx.fillStyle = kind === 'spitter' ? '#132422' : '#261a1a';
  ectx.fillRect(0, 0, 64, 64);
  const scleraGrad = ectx.createRadialGradient(32, 32, 4, 32, 32, 26);
  scleraGrad.addColorStop(0, kind === 'spitter' ? '#a6ffe0' : '#d6c8b8');
  scleraGrad.addColorStop(0.55, kind === 'runner' ? '#a85952' : '#857168');
  scleraGrad.addColorStop(1, '#1a0c0d');
  ectx.fillStyle = scleraGrad;
  ectx.beginPath();
  ectx.arc(32, 32, 24, 0, Math.PI * 2);
  ectx.fill();
  // Bloodshot capillaries radiating from outer rim
  ectx.strokeStyle = kind === 'spitter' ? 'rgba(42, 180, 132, 0.55)' : 'rgba(138, 20, 20, 0.65)';
  ectx.lineWidth = 1.2;
  for (let a = 0; a < 10; a++) {
    const ang = (a / 10) * Math.PI * 2 + 0.2;
    ectx.beginPath();
    ectx.moveTo(32 + Math.cos(ang) * 21, 32 + Math.sin(ang) * 21);
    ectx.lineTo(32 + Math.cos(ang + 0.08) * 12, 32 + Math.sin(ang + 0.08) * 12);
    ectx.stroke();
  }
  // Glowing colored limbal ring + iris
  const irisGrad = ectx.createRadialGradient(32, 32, 2, 32, 32, 11.5);
  irisGrad.addColorStop(0, pal.eyeCore);
  irisGrad.addColorStop(0.48, pal.eye);
  irisGrad.addColorStop(0.88, pal.eyeRim);
  irisGrad.addColorStop(1, '#0d0607');
  ectx.fillStyle = irisGrad;
  ectx.beginPath();
  ectx.arc(32, 32, 11.5, 0, Math.PI * 2);
  ectx.fill();
  // Razor-sharp contracted horror pupil (vertical feral slit on Spitter/Runner, pinpoint on Walker/Bloater)
  ectx.fillStyle = '#070405';
  ectx.beginPath();
  if (kind === 'spitter' || kind === 'runner') {
    ectx.ellipse(32, 32, 2.6, 6.2, 0, 0, Math.PI * 2);
  } else {
    ectx.arc(32, 32, 3.6, 0, Math.PI * 2);
  }
  ectx.fill();
  // Wet cornea specular glint + subtle upper brow shadow
  ectx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ectx.beginPath();
  ectx.arc(35.5, 28.5, 2.0, 0, Math.PI * 2);
  ectx.fill();
  const lidShadow = ectx.createLinearGradient(0, 14, 0, 30);
  lidShadow.addColorStop(0, 'rgba(8, 4, 5, 0.72)');
  lidShadow.addColorStop(1, 'rgba(8, 4, 5, 0)');
  ectx.fillStyle = lidShadow;
  ectx.fillRect(0, 0, 64, 30);

  return {
    front: toOrganicTexture(cf, false),
    back: toOrganicTexture(cb, false),
    side: toOrganicTexture(cs, false),
    top: toOrganicTexture(ct, false),
    jaw: toOrganicTexture(cj, false),
    wrap: toOrganicTexture(cw, true),
    eye: toOrganicTexture(ce, false),
  };
}

function buildPustuleTexture(cyan: boolean): THREE.CanvasTexture {
  // 64x64 organic boil texture: y=0 (v=1) is taut glowing apex, y=64 (v=0) is dark necrotic base collar
  const [c, ctx] = makePixelCanvas(64, 64);
  ctx.imageSmoothingEnabled = true;
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  if (cyan) {
    grad.addColorStop(0, '#c8ffeb');
    grad.addColorStop(0.24, '#56ebb2');
    grad.addColorStop(0.56, '#1f6e59');
    grad.addColorStop(0.84, '#132e2a');
    grad.addColorStop(1, '#0b1918');
  } else {
    grad.addColorStop(0, '#ecffb8');
    grad.addColorStop(0.26, '#a5d63e');
    grad.addColorStop(0.58, '#536e22');
    grad.addColorStop(0.84, '#2a3317');
    grad.addColorStop(1, '#1c1914');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  paintSoftMottle(
    ctx,
    64,
    64,
    24,
    cyan ? ['#245e4f', '#7dffcc', '#122924'] : ['#3d4f1a', '#c9f059', '#2b1e16'],
    4,
    12,
    0.34,
    cyan ? 401 : 409,
    true
  );
  // Fine inflamed capillaries climbing from dark crater rim toward taut apex
  ctx.strokeStyle = cyan ? 'rgba(18, 64, 52, 0.55)' : 'rgba(92, 24, 18, 0.45)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 8; i++) {
    const bx = i * 8 + 4;
    ctx.beginPath();
    ctx.moveTo(bx, 62);
    ctx.quadraticCurveTo(bx + (i % 2 ? 4 : -4), 38, bx + (i % 2 ? -2 : 2), 18);
    ctx.stroke();
  }
  return toOrganicTexture(c, true);
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

  // Crisp 128x128 organic limb textures: tattered fabric upper sleeve -> gaunt rotting forearm;
  // weathered stitched trousers with torn knee bone & mud-caked ankle hems.
  const S = 128;
  const [cs, sctx] = makePixelCanvas(S, S);
  const [cl, lctx] = makePixelCanvas(S, S);
  sctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingEnabled = true;

  const sleevePal =
    kind === 'walker'
      ? { cloth: '#4f3e37', clothHi: '#6b544b', clothDark: '#2c211d', flesh: '#7c8e74', hi: '#9fb096', dark: '#475742', seed: 101 }
      : kind === 'runner'
        ? { cloth: '#612525', clothHi: '#823434', clothDark: '#361212', flesh: '#946864', hi: '#b58680', dark: '#542d2b', seed: 107 }
        : kind === 'bloater'
          ? { cloth: '#454f34', clothHi: '#5e6b48', clothDark: '#262d1c', flesh: '#718554', hi: '#94ab70', dark: '#3f4f2b', seed: 113 }
          : { cloth: '#313d42', clothHi: '#46575e', clothDark: '#1b2326', flesh: '#5b7b78', hi: '#7ea19d', dark: '#2d4543', seed: 127 };

  const pantsPal =
    kind === 'walker'
      ? { main: '#2c3238', hi: '#414a52', dark: '#171a1e', seed: 131 }
      : kind === 'runner'
        ? { main: '#22252b', hi: '#353a44', dark: '#111317', seed: 137 }
        : kind === 'bloater'
          ? { main: '#323828', hi: '#48523a', dark: '#1b1f15', seed: 149 }
          : { main: '#22282d', hi: '#343e46', dark: '#111518', seed: 151 };

  // Arm sleeve (y=0..56 = v=1.0..0.56 upper arm) + exposed rotting forearm (y=56..128 = v=0.56..0.0)
  sctx.fillStyle = sleevePal.cloth;
  sctx.fillRect(0, 0, S, 60);
  paintSoftMottle(sctx, S, 60, 32, [sleevePal.clothDark, sleevePal.clothHi, '#241b16'], 6, 18, 0.35, sleevePal.seed, true);
  paintFabricWeave(sctx, 0, 0, S, 58, sleevePal.clothHi, sleevePal.clothDark, sleevePal.seed);

  sctx.fillStyle = sleevePal.flesh;
  sctx.fillRect(0, 56, S, S - 56);
  paintSoftMottle(sctx, S, S - 56, 42, [sleevePal.dark, sleevePal.hi, '#3b2424'], 5, 16, 0.38, sleevePal.seed + 5, true);
  // Subtle forearm tendon lines + wrist grime
  sctx.strokeStyle = sleevePal.dark;
  sctx.globalAlpha = 0.42;
  sctx.lineWidth = 2;
  for (let tx = 14; tx < S; tx += 22) {
    sctx.beginPath();
    sctx.moveTo(tx, 62);
    sctx.lineTo(tx + 3, 122);
    sctx.stroke();
  }
  sctx.globalAlpha = 1;

  // Jagged torn cloth cuff overlapping top of forearm with cast shadow
  sctx.fillStyle = 'rgba(12, 10, 10, 0.55)';
  sctx.beginPath();
  sctx.moveTo(0, 52);
  for (let x = 0; x <= S; x += 8) {
    const jag = 54 + ((x * 7 + sleevePal.seed) % 13);
    sctx.lineTo(x, jag + 4);
  }
  sctx.lineTo(S, 52);
  sctx.closePath();
  sctx.fill();

  sctx.fillStyle = sleevePal.clothDark;
  sctx.beginPath();
  sctx.moveTo(0, 48);
  for (let x = 0; x <= S; x += 8) {
    const jag = 52 + ((x * 7 + sleevePal.seed) % 13);
    sctx.lineTo(x, jag);
  }
  sctx.lineTo(S, 48);
  sctx.closePath();
  sctx.fill();

  // Archetype forearm stains (blood / necrotic bruise / acid veins)
  if (kind === 'runner') {
    paintSoftMottle(sctx, S, 64, 20, ['#781214', '#4d0a0c'], 5, 14, 0.65, 611, true);
    sctx.fillStyle = 'rgba(116, 16, 18, 0.55)';
    sctx.fillRect(0, 96, S, 32);
  } else if (kind === 'bloater') {
    paintSoftMottle(sctx, S, 70, 16, ['#3a4720', '#7ea82d', '#2b2418'], 5, 14, 0.48, 613, true);
  } else if (kind === 'spitter') {
    sctx.strokeStyle = 'rgba(80, 232, 170, 0.65)';
    sctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const vx = 18 + i * 30;
      sctx.beginPath();
      sctx.moveTo(vx, 60);
      sctx.quadraticCurveTo(vx + 6, 90, vx - 4, 124);
      sctx.stroke();
    }
  } else {
    paintSoftMottle(sctx, S, 60, 12, ['#541214', '#38221d'], 4, 12, 0.52, 607, true);
  }

  // Trousers: weathered woven fabric + side stitching + torn knee hole revealing kneecap + muddy hem
  lctx.fillStyle = pantsPal.main;
  lctx.fillRect(0, 0, S, S);
  paintSoftMottle(lctx, S, S, 55, [pantsPal.dark, pantsPal.hi, '#241e19'], 6, 20, 0.36, pantsPal.seed, true);
  paintFabricWeave(lctx, 0, 0, S, S, pantsPal.hi, pantsPal.dark, pantsPal.seed);
  // Outseam stitching along sides
  lctx.fillStyle = pantsPal.dark;
  lctx.fillRect(30, 0, 3, S);
  lctx.fillRect(94, 0, 3, S);
  // Torn knee opening at front (x=64, y=60) showing bruised flesh & pale patella bone
  lctx.fillStyle = '#121010';
  lctx.beginPath();
  lctx.ellipse(64, 62, 18, 11, -0.08, 0, Math.PI * 2);
  lctx.fill();
  lctx.fillStyle = sleevePal.dark;
  lctx.beginPath();
  lctx.ellipse(64, 62, 14, 8, -0.08, 0, Math.PI * 2);
  lctx.fill();
  lctx.fillStyle = '#cbc0a8';
  lctx.beginPath();
  lctx.ellipse(64, 61, 7, 4.5, 0, 0, Math.PI * 2);
  lctx.fill();
  // Mud-caked lower cuffs
  const mudGrad = lctx.createLinearGradient(0, 96, 0, S);
  mudGrad.addColorStop(0, 'rgba(38, 29, 21, 0)');
  mudGrad.addColorStop(0.55, 'rgba(38, 29, 21, 0.72)');
  mudGrad.addColorStop(1, 'rgba(22, 17, 13, 0.94)');
  lctx.fillStyle = mudGrad;
  lctx.fillRect(0, 96, S, 32);

  return {
    sleeve: toOrganicTexture(cs, true),
    leg: toOrganicTexture(cl, true),
  };
}

function buildActorTorsoTextures(kind: 'player' | 'walker' | 'runner' | 'bloater' | 'spitter'): {
  front: THREE.CanvasTexture;
  back: THREE.CanvasTexture;
  side: THREE.CanvasTexture;
  wrap?: THREE.CanvasTexture;
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
      ? { main: '#4f3e37', hi: '#6e574d', dark: '#291f1c', skin: '#7c8e74', seed: 201 }
      : kind === 'runner'
        ? { main: '#5e2222', hi: '#823232', dark: '#301010', skin: '#946864', seed: 211 }
        : kind === 'bloater'
          ? { main: '#465035', hi: '#606d49', dark: '#242b1b', skin: '#718554', seed: 223 }
          : { main: '#313d42', hi: '#485961', dark: '#192124', skin: '#5b7b78', seed: 229 };

  for (const [idx, ctx] of [fctx, bctx, sctx].entries()) {
    drawPixelRect(ctx, 0, 0, S, S, palette.main);
    paintSoftMottle(ctx, S, S, 24, [palette.dark, palette.hi], 5, 16, 0.35, palette.seed + idx * 13, false);
  }

  // High-detail 256x128 seamless cylindrical wrap aligned to createSculptedTorsoGeometry:
  // x=128 is +X front chest, x=0/256 is -X spine/back, y=0 top shoulders, y=128 pelvis.
  const W = 256;
  const H = 128;
  const [cwt, wtctx] = makePixelCanvas(W, H);
  wtctx.imageSmoothingEnabled = true;
  wtctx.fillStyle = palette.main;
  wtctx.fillRect(0, 0, W, H);
  paintSoftMottle(wtctx, W, H, 110, [palette.dark, palette.hi, '#1e1915'], 6, 24, 0.38, palette.seed + 503, true);
  paintFabricWeave(wtctx, 0, 0, W, H, palette.hi, palette.dark, palette.seed + 509);

  // Top shoulder dirt/highlight & lower waist shadow
  const torsoGrad = wtctx.createLinearGradient(0, 0, 0, H);
  torsoGrad.addColorStop(0, 'rgba(255, 250, 235, 0.10)');
  torsoGrad.addColorStop(0.25, 'rgba(0, 0, 0, 0)');
  torsoGrad.addColorStop(0.82, 'rgba(12, 10, 9, 0.32)');
  torsoGrad.addColorStop(1, 'rgba(8, 7, 7, 0.68)');
  wtctx.fillStyle = torsoGrad;
  wtctx.fillRect(0, 0, W, H);

  if (kind === 'walker') {
    // Torn civilian jacket parting unevenly over grime-stained undershirt & jagged ribcage tear
    wtctx.fillStyle = '#3b352d';
    wtctx.fillRect(102, 10, 52, 92);
    paintSoftMottle(wtctx, 52, 92, 22, ['#26211c', '#4d443a', '#4a1717'], 4, 12, 0.45, 251, false);
    // Jagged torn chest gore cavity framed by shredded shirt edges (3D ivory ribs arch cleanly across!)
    wtctx.fillStyle = '#38090b';
    wtctx.beginPath();
    wtctx.moveTo(108, 30);
    wtctx.lineTo(124, 24);
    wtctx.lineTo(146, 33);
    wtctx.lineTo(150, 58);
    wtctx.lineTo(141, 74);
    wtctx.lineTo(122, 78);
    wtctx.lineTo(106, 64);
    wtctx.closePath();
    wtctx.fill();
    const cavity = wtctx.createRadialGradient(128, 52, 4, 128, 52, 22);
    cavity.addColorStop(0, '#1f0304');
    cavity.addColorStop(0.68, '#540d0f');
    cavity.addColorStop(1, 'rgba(54, 10, 10, 0)');
    wtctx.fillStyle = cavity;
    wtctx.fillRect(104, 24, 48, 56);
    // Jacket lapel seams + tattered fabric strips + dried blood drips
    wtctx.strokeStyle = '#1b1411';
    wtctx.lineWidth = 3;
    wtctx.beginPath();
    wtctx.moveTo(98, 8);
    wtctx.lineTo(103, 102);
    wtctx.moveTo(158, 8);
    wtctx.lineTo(153, 102);
    wtctx.stroke();
    wtctx.fillStyle = '#5c0e10';
    wtctx.globalAlpha = 0.72;
    wtctx.fillRect(114, 72, 6, 28);
    wtctx.fillRect(128, 76, 8, 24);
    wtctx.fillRect(140, 68, 5, 30);
    wtctx.globalAlpha = 1;
    // Worn dark leather belt band & torn spine patch on back (x=0/256)
    wtctx.fillStyle = '#1f1712';
    wtctx.fillRect(0, 100, W, 12);
    wtctx.fillStyle = '#3d1515';
    wtctx.fillRect(0, 26, 16, 56);
    wtctx.fillRect(240, 26, 16, 56);
  } else if (kind === 'runner') {
    // Shredded blood-drenched tank/hoodie over flayed crimson musculature & diagonal claw gashes
    const chest = wtctx.createRadialGradient(128, 54, 8, 128, 54, 46);
    chest.addColorStop(0, '#851b1d');
    chest.addColorStop(0.65, '#591113');
    chest.addColorStop(1, 'rgba(48, 14, 14, 0)');
    wtctx.fillStyle = chest;
    wtctx.beginPath();
    wtctx.ellipse(128, 56, 44, 42, 0, 0, Math.PI * 2);
    wtctx.fill();
    // Anatomical muscle striations across chest & abs
    wtctx.strokeStyle = '#400a0b';
    wtctx.lineWidth = 2;
    for (let sx = 98; sx <= 158; sx += 8) {
      wtctx.beginPath();
      wtctx.moveTo(sx, 26);
      wtctx.lineTo(sx + (sx < 128 ? 3 : -3), 88);
      wtctx.stroke();
    }
    // Diagonal predatory claw scars across flanks & back
    wtctx.strokeStyle = '#9e2123';
    wtctx.lineWidth = 2.6;
    for (let i = 0; i < 3; i++) {
      wtctx.beginPath();
      wtctx.moveTo(32 + i * 9, 32 + i * 5);
      wtctx.lineTo(74 + i * 9, 64 + i * 5);
      wtctx.stroke();
      wtctx.beginPath();
      wtctx.moveTo(182 + i * 9, 64 + i * 5);
      wtctx.lineTo(224 + i * 9, 32 + i * 5);
      wtctx.stroke();
    }
  } else if (kind === 'bloater') {
    // Bursting hazmat/work overalls torn open across massive mottled necrotic gut (no cartoon polka dots!)
    wtctx.fillStyle = palette.skin;
    wtctx.beginPath();
    wtctx.ellipse(128, 66, 54, 52, 0, 0, Math.PI * 2);
    wtctx.fill();
    paintSoftMottle(wtctx, 110, 96, 46, ['#46592c', '#8fa866', '#4a3d28', '#2a3619'], 5, 18, 0.44, 239, false);
    // Horizontal belly fat-fold shadows & vertical ruptured scar tissue
    wtctx.strokeStyle = 'rgba(28, 36, 16, 0.65)';
    wtctx.lineWidth = 3;
    for (const fy of [48, 72, 92]) {
      wtctx.beginPath();
      wtctx.moveTo(86, fy);
      wtctx.quadraticCurveTo(128, fy + 8, 170, fy);
      wtctx.stroke();
    }
    // Inflamed bruised skin craters anchoring the 3D boils naturally into the flesh
    const craters: Array<[number, number, number]> = [
      [104, 46, 16],
      [152, 74, 18],
      [126, 82, 14],
      [48, 56, 16],
      [206, 62, 15],
    ];
    for (const [cx, cy, r] of craters) {
      const cg = wtctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r);
      cg.addColorStop(0, 'rgba(128, 168, 40, 0.55)');
      cg.addColorStop(0.55, 'rgba(42, 54, 20, 0.72)');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      wtctx.fillStyle = cg;
      wtctx.beginPath();
      wtctx.arc(cx, cy, r, 0, Math.PI * 2);
      wtctx.fill();
    }
    // Straining heavy industrial waistband
    wtctx.fillStyle = '#24211b';
    wtctx.fillRect(0, 102, W, 11);
  } else {
    // Spitter: gaunt torn dark coat over recessed glowing emerald-cyan acid sternum cavity
    const acidGlow = wtctx.createRadialGradient(128, 54, 4, 128, 54, 34);
    acidGlow.addColorStop(0, '#96ffd8');
    acidGlow.addColorStop(0.35, '#2db385');
    acidGlow.addColorStop(0.72, '#133d33');
    acidGlow.addColorStop(1, 'rgba(19, 44, 40, 0)');
    wtctx.fillStyle = acidGlow;
    wtctx.beginPath();
    wtctx.ellipse(128, 54, 30, 34, 0, 0, Math.PI * 2);
    wtctx.fill();
    // Delicate glowing bioluminescent veins radiating onto chest & flanks
    wtctx.strokeStyle = 'rgba(84, 240, 178, 0.58)';
    wtctx.lineWidth = 1.6;
    for (let i = 0; i < 6; i++) {
      const y = 26 + i * 10;
      wtctx.beginPath();
      wtctx.moveTo(106, y);
      wtctx.quadraticCurveTo(84, y + 6, 64, y - 2);
      wtctx.stroke();
      wtctx.beginPath();
      wtctx.moveTo(150, y);
      wtctx.quadraticCurveTo(172, y + 6, 192, y - 2);
      wtctx.stroke();
    }
    // Dark recessed dorsal spinal channel (3D bone spines sit along x=0/256)
    wtctx.fillStyle = '#112924';
    wtctx.fillRect(0, 10, 14, 96);
    wtctx.fillRect(242, 10, 14, 96);
  }

  return {
    front: toOrganicTexture(cf, false),
    back: toOrganicTexture(cb, false),
    side: toOrganicTexture(cs, false),
    wrap: toOrganicTexture(cwt, true),
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


function buildStoneMasonryTexture(): THREE.CanvasTexture {
  // Coursed cut-stone tunnel lining: running-bond blocks, recessed mortar, warm gray stone
  const [c, ctx] = makePixelCanvas(64, 64);
  const rowH = 8, blockW = 16;
  for (let row = 0; row < 8; row++) {
    const off = row % 2 === 0 ? 0 : blockW / 2;
    for (let bx = -1; bx < 5; bx++) {
      const x0 = bx * blockW + off;
      const tone = pxHash(bx + 31, row + 57, 211);
      const base = tone < 0.3 ? '#7a7a76' : tone < 0.6 ? '#6d6d69' : tone < 0.85 ? '#82827c' : '#62625e';
      for (let y = 0; y < rowH; y++) {
        for (let x = 0; x < blockW; x++) {
          const px = ((x0 + x) % 64 + 64) % 64;
          const py = row * rowH + y;
          let col = base;
          if (y === 0 || x === 0) col = '#42423e'; // recessed mortar joint
          else if (y === 1 || x === 1) col = '#4e4e4a'; // mortar shadow edge
          else {
            const n = pxHash(px, py, 223);
            if (n > 0.95) col = '#8f8f89'; // light chip
            else if (n < 0.05) col = '#585854'; // dark pit
            else if (y === rowH - 1) col = '#5b5b57'; // block bottom shade
          }
          ctx.fillStyle = col;
          ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }
  return toNearestTexture(c, 1, 1);
}

function buildTunnelConcreteTexture(): THREE.CanvasTexture {
  // Poured concrete panels: warm light gray, form lines, tie holes, speckle, hairline cracks
  const [c, ctx] = makePixelCanvas(48, 48);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const n = pxHash(x, y, 307);
      let col = n > 0.9 ? '#8e939a' : n < 0.1 ? '#757a81' : '#82868c';
      if (y % 16 === 0) col = '#6a6f76'; // horizontal form seam
      if (y % 16 === 1) col = '#8f949b'; // seam highlight
      if (x % 24 === 0) col = '#6a6f76'; // vertical form seam
      // form tie holes
      if ((x % 24 === 12) && (y % 16 === 8)) col = '#5c6167';
      if ((x % 24 === 12) && (y % 16 === 9)) col = '#6e7379';
      // hairline crack
      if (Math.abs(y - 30 - Math.sin(x * 0.35) * 2.5) < 0.7 && x > 8 && x < 40) col = '#61666d';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c, 1, 1);
}

function buildTunnelConcreteSmoothTexture(): THREE.CanvasTexture {
  // Smooth poured concrete for narrow jamb/column faces: fine isotropic aggregate
  // speckle only - no form seams or tie holes (those stretch into plank-like grain
  // on narrow faces at close range)
  const [c, ctx] = makePixelCanvas(48, 48);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const n = pxHash(x, y, 911);
      const m = pxHash(x, y, 912);
      let col = '#7b7f86';
      if (n > 0.82) col = '#888d94';
      else if (n < 0.16) col = '#6e7279';
      if (m > 0.965) col = '#62666d'; // sparse aggregate fleck
      else if (m < 0.03) col = '#92979e'; // sparse light fleck
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c, 1, 1);
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

  // Pixel-art & organic sculpted model surface textures
  public readonly actorHeadTex: Record<'player' | 'walker' | 'runner' | 'bloater' | 'spitter', { front: THREE.CanvasTexture; back: THREE.CanvasTexture; side: THREE.CanvasTexture; top: THREE.CanvasTexture; jaw?: THREE.CanvasTexture; wrap?: THREE.CanvasTexture; eye?: THREE.CanvasTexture }>;
  public readonly actorTorsoTex: Record<'player' | 'walker' | 'runner' | 'bloater' | 'spitter', { front: THREE.CanvasTexture; back: THREE.CanvasTexture; side: THREE.CanvasTexture; wrap?: THREE.CanvasTexture }>;
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
  public readonly tunnelStoneTex: THREE.CanvasTexture;
  public readonly tunnelStoneTallTex: THREE.CanvasTexture;
  public readonly tunnelConcreteTex: THREE.CanvasTexture;
  public readonly tunnelConcreteSmoothTex: THREE.CanvasTexture;
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
      'bridge_deck',
      'cave_floor',
      'cliff_stone',
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
      if (h.wrap) this.track(h.wrap);
      if (h.eye) this.track(h.eye);
      this.track(t.front);
      this.track(t.back);
      this.track(t.side);
      if (t.wrap) this.track(t.wrap);
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
    this.tunnelStoneTex = this.track(buildStoneMasonryTexture());
    {
      const tall = buildStoneMasonryTexture();
      tall.wrapS = THREE.RepeatWrapping; tall.wrapT = THREE.RepeatWrapping;
      tall.repeat.set(0.5, 2);
      // Glancing-angle antialiasing: crisp texels up close, averaged at grazing angles
      tall.minFilter = THREE.LinearMipmapLinearFilter;
      tall.generateMipmaps = true;
      tall.anisotropy = 8;
      tall.needsUpdate = true;
      this.tunnelStoneTallTex = this.track(tall);
    }
    this.tunnelConcreteTex = this.track(buildTunnelConcreteTexture());
    this.tunnelConcreteSmoothTex = this.track(buildTunnelConcreteSmoothTexture());
    // Jamb faces are narrow and tall: repeat vertically so texels stay square-ish
    this.tunnelConcreteSmoothTex.repeat.set(1, 8);
    for (const t of [this.tunnelStoneTex, this.tunnelConcreteTex, this.tunnelConcreteSmoothTex]) {
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 8;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
    }
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

  private drawSubmergedLakebedTile(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    pxPerTile: number,
    gx: number,
    gy: number,
    depth01: number,
    variant: number
  ): void {
    // 16x16 pixel-art submerged floor (drawn in 2x2 pixel blocks over 32x32 tile area for crisp texels)
    const cells = 16;
    const step = pxPerTile / cells;
    const seed = (gx * 73856093) ^ (gy * 19349663) ^ (variant * 83492791);
    for (let sy = 0; sy < cells; sy++) {
      for (let sx = 0; sx < cells; sx++) {
        const h = Math.abs(Math.sin((seed + sx * 17 + sy * 31) * 12.9898) * 43758.5453) % 1;
        let col: string;
        if (depth01 < 0.34) {
          // Shallow sunlit wet sand & scattered shore pebbles
          if (h < 0.08) col = '#5c523b';
          else if (h < 0.22) col = '#9c865b';
          else if (h < 0.76) col = '#7a6c4c';
          else col = '#526152';
        } else if (depth01 < 0.68) {
          // Mid-depth mossy river silt & darker stones
          if (h < 0.1) col = '#223338';
          else if (h < 0.28) col = '#3c4f49';
          else if (h < 0.78) col = '#2b3f42';
          else col = '#4a5444';
        } else {
          // Deep abyssal slate riverbed
          if (h < 0.14) col = '#0c171e';
          else if (h < 0.34) col = '#1c2e36';
          else col = '#132229';
        }
        ctx.fillStyle = col;
        ctx.fillRect(px + sx * step, py + sy * step, step, step);
      }
    }
  }

  createChunkTerrainTexture(getCell: (gx: number, gy: number) => { tile: TileKind; variant: number }, cx: number, cy: number, chunkSize: number): THREE.CanvasTexture {
    const pxPerTile = 32;
    const dim = chunkSize * pxPerTile;
    const [c, ctx] = makePixelCanvas(dim, dim);
    const startX = cx * chunkSize;
    const startY = cy * chunkSize;
    for (let ly = 0; ly < chunkSize; ly++) {
      for (let lx = 0; lx < chunkSize; lx++) {
        const gx = startX + lx;
        const gy = startY + ly;
        const cell = getCell(gx, gy);
        if (cell.tile === 'water') {
          const depth01 = computeWaterShoreDepth(gx, gy, getCell);
          this.drawSubmergedLakebedTile(ctx, lx * pxPerTile, ly * pxPerTile, pxPerTile, gx, gy, depth01, cell.variant);
        } else {
          const tileCanvas = this.getTileCanvas(cell.tile, cell.variant);
          ctx.drawImage(tileCanvas, lx * pxPerTile, ly * pxPerTile);
        }
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

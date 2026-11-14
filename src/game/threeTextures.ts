import * as THREE from 'three';
import type { TileKind } from './types';

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
 * Generates a 16x16 square pixel-art canvas for any ground tile kind & variant,
 * preserving the exact color palette, dithering, planks, rugs, and markings of ASHFALL.
 */
export function buildSquareTileCanvas(kind: TileKind, variant: number): HTMLCanvasElement {
  const size = 16;
  const [c, ctx] = makePixelCanvas(size, size);

  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + variant * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = hash(x, y);
      let col = '#2e3b26';

      if (kind === 'grass') {
        if (r < 0.14) col = '#445737';
        else if (r < 0.34) col = '#3a4a2f';
        else if (r < 0.78) col = '#2f3d26';
        else col = '#25301e';
        if (r > 0.92 && y > 1) col = '#5a7046';
        if (variant === 3 && r < 0.04) col = '#697848';
      } else if (kind === 'dirt') {
        if (r < 0.16) col = '#5c4939';
        else if (r < 0.45) col = '#4c3c2f';
        else if (r < 0.82) col = '#3f3227';
        else col = '#33281f';
      } else if (kind === 'road' || kind === 'crosswalk') {
        if (r < 0.12) col = '#32373e';
        else if (r < 0.54) col = '#262a2f';
        else if (r < 0.88) col = '#21252a';
        else col = '#1a1d21';
        if (kind === 'road') {
          if (variant === 0 && y >= 7 && y <= 8 && x >= 3 && x <= 12) col = '#8c7a3e';
          if (variant === 2 && ((x === 7 && y >= 5 && y <= 10) || (x === 8 && y >= 6 && y <= 10))) {
            col = '#14171a';
          }
        } else {
          const bar = (x + 1) % 5;
          if (bar >= 1 && bar <= 2 && y >= 2 && y <= 13) {
            col = r < 0.18 ? '#6e7275' : '#9ca1a3';
          }
        }
      } else if (kind === 'sidewalk') {
        const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1;
        const slabJoint = x === 8 || y === 8;
        if (isBorder) col = x === 0 || y === 0 ? '#62696e' : '#32363a';
        else if (slabJoint) col = '#2d3136';
        else if (r < 0.25) col = '#52585e';
        else if (r < 0.75) col = '#464b50';
        else col = '#3d4146';
        if (variant === 2 && slabJoint && r > 0.72) col = '#425433';
      } else if (kind === 'floor') {
        const plank = y % 4 === 0;
        if (plank) col = '#30251d';
        else if (r < 0.25) col = '#5e4c3e';
        else if (r < 0.75) col = '#4e3e32';
        else col = '#413329';
      } else if (kind === 'floor_rug') {
        const border = x <= 1 || y <= 1 || x >= size - 2 || y >= size - 2;
        const motif = (x + y) % 4 === 0 || (x - y + 16) % 6 === 0;
        if (border) {
          col = (x + y) % 2 === 0 ? '#a8844c' : '#734433';
        } else if (motif) {
          col = r < 0.25 ? '#9c5243' : '#853c31';
        } else {
          col = r < 0.22 ? '#78342a' : '#632922';
        }
      } else if (kind === 'floor_bath') {
        const u = Math.floor(x / 4);
        const v = Math.floor(y / 4);
        const grout = x % 4 === 0 || y % 4 === 0;
        if (grout) col = '#3e4d4f';
        else col = (u + v) % 2 === 0 ? (r < 0.2 ? '#759194' : '#86a4a6') : r < 0.2 ? '#5d777a' : '#6a868a';
      } else if (kind === 'floor_porch') {
        const isEdge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
        const seam = x % 4 === 0;
        if (isEdge) col = '#38271b';
        else if (seam) col = '#2b1d14';
        else col = r < 0.3 ? '#755338' : r < 0.75 ? '#61442d' : '#4f3623';
      } else if (kind === 'tile_clinic') {
        const u = Math.floor(x / 4);
        const v = Math.floor(y / 4);
        const grout = x % 4 === 0 || y % 4 === 0;
        if (grout) col = '#4f5a57';
        else col = (u + v) % 2 === 0 ? (r < 0.18 ? '#7b8783' : '#8b9994') : r < 0.2 ? '#6e7a76' : '#7c8a85';
        if (variant === 3 && r > 0.9) col = '#57322e';
      } else if (kind === 'tile_diner') {
        const u = Math.floor(x / 4);
        const v = Math.floor(y / 4);
        const even = (u + v) % 2 === 0;
        col = even ? (r < 0.2 ? '#8f8a80' : '#a39d92') : r < 0.2 ? '#292c30' : '#35393e';
      } else if (kind === 'water') {
        const wave = (x + y * 2 + variant) % 7 === 0 && r < 0.45;
        col = wave ? '#315769' : r < 0.22 ? '#264654' : '#1b3440';
      } else if (kind === 'pier') {
        const plankSeam = x % 3 === 0;
        const rail = y === 0 || y === size - 1;
        if (rail) col = '#3d2a1b';
        else if (plankSeam) col = '#2a1d13';
        else col = r < 0.28 ? '#875f3d' : r < 0.76 ? '#704d30' : '#593b24';
      } else if (kind === 'forest_floor') {
        if (r < 0.14) col = '#2d3b22';
        else if (r < 0.36) col = '#3b2e21';
        else if (r < 0.74) col = '#2d241a';
        else col = '#211c14';
        if (r > 0.91 && (x + y) % 2 === 0) col = '#57452f'; // pine needles
        if (variant === 2 && r < 0.06) col = '#405731'; // moss fleck
      } else if (kind === 'gravel') {
        if (r < 0.16) col = '#717578';
        else if (r < 0.48) col = '#5a5e61';
        else if (r < 0.80) col = '#484b4e';
        else col = '#36393b';
        if ((x * 3 + y * 5 + variant) % 11 === 0 && r > 0.6) col = '#83878a';
      } else if (kind === 'mud') {
        if (r < 0.18) col = '#3a2b20';
        else if (r < 0.56) col = '#2e2118';
        else if (r < 0.88) col = '#241a12';
        else col = '#1b140f';
        if (variant === 1 && x >= 4 && x <= 10 && y >= 5 && y <= 9 && r < 0.42) col = '#2b3b42'; // shallow puddle glint
      } else if (kind === 'sand') {
        if (r < 0.16) col = '#ab956b';
        else if (r < 0.52) col = '#968059';
        else if (r < 0.86) col = '#806c49';
        else col = '#69583c';
        if (r > 0.94) col = '#baa57a';
      } else if (kind === 'asphalt_cracked') {
        const crack =
          Math.abs(x - y - (variant - 1) * 3) <= 0.6 ||
          (x >= 5 && x <= 12 && Math.abs(y - 9 + (x % 3)) <= 0.5);
        if (crack) col = '#101214';
        else if (r < 0.14) col = '#32363b';
        else if (r < 0.58) col = '#25292e';
        else col = '#1d2024';
        if (crack && r > 0.72) col = '#3d472e'; // weed sprout in crack
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
      let col = '#66362c';
      if (hasWindow && y >= 4 && y <= 11 && x >= 3 && x <= 12) {
        const isFrame = y === 4 || y === 11 || x === 3 || x === 12;
        const isPlank = y === 6 || y === 9;
        if (isFrame) col = '#261d17';
        else if (isPlank) col = '#7a593c';
        else col = '#101316';
      } else if (kind === 'wall_brick') {
        if (y <= 1) col = '#756e6a';
        else if (y >= 16) col = '#4a4543';
        else {
          const course = Math.floor(y / 3);
          const isMortarH = y % 3 === 0;
          const isMortarV = (x + (course % 2) * 3) % 6 === 0;
          if (isMortarH || isMortarV) col = '#3e3634';
          else {
            const shade = (x * 7 + course * 13) % 5;
            col = shade === 0 ? '#965545' : shade < 3 ? '#7d4437' : '#66362c';
          }
          if (y > 13 && (x + y) % 3 === 0) col = '#3a4a2e';
        }
      } else if (kind === 'wall_wood') {
        const plankEdge = x % 4 === 0;
        const crossBrace = Math.abs(y - x * 1.1) < 1.3;
        if (y <= 1 || y >= 16 || x === 0 || x === w - 1) col = '#4f3825';
        else if (plankEdge) col = '#241a13';
        else if (crossBrace) col = '#856142';
        else col = (x + y * 2) % 5 === 0 ? '#5e432d' : '#755439';
      } else {
        if (y <= 1) col = '#b5aa94';
        else if (y === 8) col = '#6e5038';
        else if (y >= 9) col = x % 4 === 0 ? '#3b291c' : '#7a593e';
        else col = (x + y) % 5 === 0 ? '#9e9c8e' : '#aba99b';
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
      let col = '#5e5652';
      if (kind === 'wall_brick') {
        col = edge ? '#4f4a48' : (x + y) % 4 === 0 ? '#6e6560' : '#5e5652';
      } else if (kind === 'wall_wood') {
        col = edge ? '#402f22' : (x + y) % 2 === 0 ? '#6b4e37' : '#59402c';
      } else {
        col = edge ? '#59493b' : (x + y) % 3 === 0 ? '#8c8375' : '#7a7266';
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildCrateSideTexture(mil: boolean): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  const topBase = mil ? '#6b7e50' : '#b37d4f';
  const leftBase = mil ? '#52633c' : '#8c5f3a';
  const trim = mil ? '#1d2219' : '#2b1b10';
  const bracket = mil ? '#49524d' : '#595e63';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const corner = (x <= 2 || x >= 13) && (y <= 2 || y >= 13);
      let col = leftBase;
      if (edge) col = trim;
      else if (corner) col = bracket;
      else if (mil) {
        if (y === 6) col = '#e0bd53';
        else if (y === 9 && x >= 5 && x <= 10) col = '#272e21';
        else col = y % 4 === 0 ? '#465433' : leftBase;
      } else {
        if (Math.abs(x - y) <= 1) col = topBase;
        else col = y % 4 === 0 ? '#754e2e' : leftBase;
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildCrateTopTexture(mil: boolean): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  const topBase = mil ? '#6b7e50' : '#b37d4f';
  const slatCol = mil ? '#52633c' : '#8c5f3a';
  const trim = mil ? '#1d2219' : '#2b1b10';
  const bracket = mil ? '#49524d' : '#595e63';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const rim = x === 1 || y === 1 || x === 14 || y === 14;
      let col = x % 3 === 0 ? slatCol : topBase;
      if (edge) col = trim;
      else if (rim) col = bracket;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
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
      let col = y >= 5 ? '#595f63' : '#7f868a';
      if (hazard) col = '#e3a63b';
      if (x === 0 || x === 15 || y === 0 || y === 7) col = '#272a2e';
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
      let col = x % 3 === 0 ? '#593b25' : '#7a5437';
      if (x === 0 || x === 11 || y === 0 || y === 17) col = '#1b140f';
      else if (locked && y >= 7 && y <= 10 && x >= 4 && x <= 7) col = y === 8 ? '#f0c44d' : '#b88b28';
      else if (y >= 8 && y <= 9 && x === 9) col = '#e8c458';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildPineFoliageTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const n = (x * 13 + y * 29) % 7;
      let col = '#273c26';
      if (n < 2) col = '#4c7043';
      else if (n < 4) col = '#3b5935';
      else if (n === 6) col = '#172418';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildBarkTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(8, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      const n = (x * 7 + y * 11) % 5;
      ctx.fillStyle = n === 0 ? '#241a14' : n < 3 ? '#634732' : '#4f3726';
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

function buildActorHeadTextures(kind: 'player' | 'walker' | 'runner' | 'bloater' | 'spitter'): {
  front: THREE.CanvasTexture;
  back: THREE.CanvasTexture;
  side: THREE.CanvasTexture;
  top: THREE.CanvasTexture;
} {
  const [cf, fctx] = makePixelCanvas(16, 16);
  const [cb, bctx] = makePixelCanvas(16, 16);
  const [cs, sctx] = makePixelCanvas(16, 16);
  const [ct, tctx] = makePixelCanvas(16, 16);

  const skin =
    kind === 'player'
      ? '#d6ac88'
      : kind === 'walker'
        ? '#7d9478'
        : kind === 'runner'
          ? '#99706c'
          : kind === 'bloater'
            ? '#6f8c49'
            : '#5f8782';
  const skinShadow =
    kind === 'player'
      ? '#9e7454'
      : kind === 'walker'
        ? '#4e634a'
        : kind === 'runner'
          ? '#5e3f3d'
          : kind === 'bloater'
            ? '#44592a'
            : '#385451';

  // Base fill + 1px dark pixel-art frame border
  drawPixelRect(fctx, 0, 0, 16, 16, '#14171a');
  drawPixelRect(fctx, 1, 1, 14, 14, skin);
  drawPixelRect(fctx, 1, 12, 14, 3, skinShadow);

  drawPixelRect(cb ? bctx : sctx, 0, 0, 16, 16, '#14171a');
  drawPixelRect(bctx, 1, 1, 14, 14, skinShadow);

  drawPixelRect(cs ? sctx : sctx, 0, 0, 16, 16, '#14171a');
  drawPixelRect(sctx, 1, 1, 14, 14, skin);
  drawPixelRect(sctx, 1, 11, 14, 4, skinShadow);

  drawPixelRect(tctx, 0, 0, 16, 16, '#14171a');
  drawPixelRect(tctx, 1, 1, 14, 14, kind === 'player' ? '#4b5940' : skinShadow);

  if (kind === 'player') {
    // Olive tactical cap + highlight + brim
    drawPixelRect(tctx, 2, 2, 12, 12, '#637555');
    drawPixelRect(tctx, 4, 4, 8, 8, '#4b5940');

    drawPixelRect(fctx, 1, 1, 14, 4, '#4b5940');
    drawPixelRect(fctx, 3, 1, 10, 2, '#637555');
    drawPixelRect(fctx, 1, 5, 14, 2, '#2d3626'); // cap brim
    // Amber tactical visor goggles
    drawPixelRect(fctx, 2, 7, 12, 4, '#1e2226');
    drawPixelRect(fctx, 3, 8, 4, 2, '#e89b38');
    drawPixelRect(fctx, 9, 8, 4, 2, '#e89b38');
    drawPixelRect(fctx, 4, 8, 2, 1, '#ffd98a');
    drawPixelRect(fctx, 10, 8, 2, 1, '#ffd98a');
    // Scarf mouth mask
    drawPixelRect(fctx, 1, 11, 14, 4, '#7a5438');
    drawPixelRect(fctx, 3, 12, 10, 1, '#5c3d27');

    // Side cap + strap + scarf wrap
    drawPixelRect(sctx, 1, 1, 14, 5, '#4b5940');
    drawPixelRect(sctx, 2, 1, 12, 2, '#637555');
    drawPixelRect(sctx, 1, 6, 14, 2, '#1e2226'); // goggle strap
    drawPixelRect(sctx, 1, 8, 14, 3, skinShadow);
    drawPixelRect(sctx, 1, 11, 14, 4, '#7a5438');

    // Back of head: cap crown, dark snapback cutout/hair, scarf wrap
    drawPixelRect(bctx, 1, 1, 14, 6, '#4b5940');
    drawPixelRect(bctx, 3, 2, 10, 2, '#637555');
    drawPixelRect(bctx, 5, 5, 6, 2, '#262e21');
    drawPixelRect(bctx, 1, 7, 14, 4, '#3a2b20');
    drawPixelRect(bctx, 1, 11, 14, 4, '#7a5438');
  } else {
    const eye =
      kind === 'walker'
        ? '#ff4d42'
        : kind === 'runner'
          ? '#ff4a3d'
          : kind === 'bloater'
            ? '#c4f24b'
            : '#6ef7be';
    // Hair/rot blotches on crown and sides
    for (let y = 1; y < 5; y++) {
      for (let x = 1; x < 15; x++) {
        if ((x * 7 + y * 13) % 5 !== 0) {
          fctx.fillStyle = skinShadow;
          fctx.fillRect(x, y, 1, 1);
        }
      }
    }
    drawPixelRect(sctx, 1, 1, 14, 7, skinShadow);
    drawPixelRect(bctx, 1, 1, 14, 9, skinShadow);
    drawPixelRect(bctx, 3, 3, 4, 4, '#241a18');
    drawPixelRect(bctx, 9, 4, 4, 3, '#241a18');
    // Sunken dark sockets + glowing eyes
    drawPixelRect(fctx, 3, 6, 4, 3, '#171212');
    drawPixelRect(fctx, 9, 6, 4, 3, '#171212');
    drawPixelRect(fctx, 4, 7, 2, 2, eye);
    drawPixelRect(fctx, 10, 7, 2, 2, eye);
    // Gaping bloody jaw + teeth
    drawPixelRect(fctx, 4, 11, 8, 4, '#4d0e0e');
    drawPixelRect(fctx, 5, 11, 2, 1, '#e8dfd1');
    drawPixelRect(fctx, 9, 11, 2, 1, '#e8dfd1');
    drawPixelRect(fctx, 6, 13, 4, 2, '#801919');
    if (kind === 'bloater') {
      drawPixelRect(fctx, 2, 3, 3, 3, '#c8ff59');
      drawPixelRect(sctx, 10, 8, 3, 3, '#9ed93b');
      drawPixelRect(bctx, 5, 6, 4, 4, '#9ed93b');
    } else if (kind === 'spitter') {
      drawPixelRect(fctx, 5, 12, 6, 2, '#5ef2b5');
      drawPixelRect(bctx, 6, 8, 4, 4, '#5ef2b5');
    }
  }

  return {
    front: toNearestTexture(cf),
    back: toNearestTexture(cb),
    side: toNearestTexture(cs),
    top: toNearestTexture(ct),
  };
}

function buildActorLimbTextures(kind: 'player' | 'walker' | 'runner' | 'bloater' | 'spitter'): {
  sleeve: THREE.CanvasTexture;
  leg: THREE.CanvasTexture;
} {
  const [cs, sctx] = makePixelCanvas(8, 12);
  const [cl, lctx] = makePixelCanvas(8, 12);

  const sleeveCol =
    kind === 'player'
      ? { main: '#455b42', hi: '#607d5b', dark: '#293727' }
      : kind === 'walker'
        ? { main: '#7d9478', hi: '#92ab8c', dark: '#4e634a' }
        : kind === 'runner'
          ? { main: '#99706c', hi: '#b38681', dark: '#5e3f3d' }
          : kind === 'bloater'
            ? { main: '#6f8c49', hi: '#87a85b', dark: '#44592a' }
            : { main: '#5f8782', hi: '#77a39e', dark: '#385451' };

  const pantsCol =
    kind === 'player'
      ? { main: '#323b45', hi: '#45515e', dark: '#1f252b' }
      : kind === 'walker'
        ? { main: '#2b3036', hi: '#3a4047', dark: '#181b1f' }
        : kind === 'runner'
          ? { main: '#202329', hi: '#2e333b', dark: '#121417' }
          : kind === 'bloater'
            ? { main: '#2d3326', hi: '#3d4534', dark: '#1a1f16' }
            : { main: '#21262b', hi: '#30373d', dark: '#121517' };

  drawPixelRect(sctx, 0, 0, 8, 12, '#101215');
  drawPixelRect(sctx, 1, 1, 6, 10, sleeveCol.main);
  drawPixelRect(sctx, 1, 1, 6, 3, sleeveCol.hi);
  drawPixelRect(sctx, 1, 9, 6, 2, sleeveCol.dark);

  drawPixelRect(lctx, 0, 0, 8, 12, '#101215');
  drawPixelRect(lctx, 1, 1, 6, 10, pantsCol.main);
  drawPixelRect(lctx, 1, 1, 6, 3, pantsCol.hi);
  drawPixelRect(lctx, 1, 8, 6, 3, pantsCol.dark);

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
  const [cf, fctx] = makePixelCanvas(16, 16);
  const [cb, bctx] = makePixelCanvas(16, 16);
  const [cs, sctx] = makePixelCanvas(16, 16);

  const palette =
    kind === 'player'
      ? { main: '#455b42', hi: '#607d5b', dark: '#293727' }
      : kind === 'walker'
        ? { main: '#614a42', hi: '#7a5d54', dark: '#3a2b26' }
        : kind === 'runner'
          ? { main: '#7f2c2c', hi: '#a63d3d', dark: '#4a1717' }
          : kind === 'bloater'
            ? { main: '#485435', hi: '#627349', dark: '#2a331e' }
            : { main: '#38464d', hi: '#4e626b', dark: '#20292e' };

  for (const ctx of [fctx, bctx, sctx]) {
    drawPixelRect(ctx, 0, 0, 16, 16, '#101215');
    drawPixelRect(ctx, 1, 1, 14, 14, palette.main);
    drawPixelRect(ctx, 1, 1, 14, 3, palette.hi);
    drawPixelRect(ctx, 1, 12, 14, 3, palette.dark);
  }

  if (kind === 'player') {
    // Collar scarf + chest sling strap + pocket + tactical belt + brass buckle
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
  } else if (kind === 'walker') {
    // Exposed bloodstained ribcage
    drawPixelRect(fctx, 4, 4, 7, 6, '#9c2c2c');
    drawPixelRect(fctx, 5, 5, 5, 1, '#d9cdb8');
    drawPixelRect(fctx, 5, 7, 5, 1, '#d9cdb8');
    drawPixelRect(fctx, 5, 9, 4, 1, '#d9cdb8');
    drawPixelRect(bctx, 5, 5, 5, 5, '#4a1b1b');
  } else if (kind === 'runner') {
    // Shredded bloodstains across chest
    drawPixelRect(fctx, 3, 3, 10, 8, '#591616');
    drawPixelRect(fctx, 5, 5, 6, 4, '#9c2424');
    drawPixelRect(sctx, 4, 6, 6, 5, '#591616');
  } else if (kind === 'bloater') {
    // Toxic glowing pustules
    drawPixelRect(fctx, 3, 4, 5, 5, '#9ed93b');
    drawPixelRect(fctx, 4, 5, 3, 3, '#c8ff59');
    drawPixelRect(fctx, 5, 6, 1, 1, '#f0ffb8');
    drawPixelRect(fctx, 9, 8, 4, 4, '#85bd2c');
    drawPixelRect(fctx, 10, 9, 2, 2, '#c8ff59');
    drawPixelRect(bctx, 4, 5, 4, 4, '#9ed93b');
    drawPixelRect(sctx, 5, 6, 4, 4, '#c8ff59');
  } else {
    // Spitter bioluminescent acid sac & dorsal spines
    drawPixelRect(fctx, 4, 4, 8, 6, '#265c4d');
    drawPixelRect(fctx, 5, 5, 6, 4, '#5ef2b5');
    drawPixelRect(fctx, 7, 6, 2, 2, '#e3fff4');
    drawPixelRect(bctx, 6, 2, 4, 11, '#5ef2b5');
    drawPixelRect(bctx, 7, 3, 2, 9, '#e3fff4');
  }

  return {
    front: toNearestTexture(cf),
    back: toNearestTexture(cb),
    side: toNearestTexture(cs),
  };
}

function buildBackpackTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  drawPixelRect(ctx, 0, 0, 16, 16, '#14110e');
  drawPixelRect(ctx, 1, 1, 14, 14, '#6b553d');
  drawPixelRect(ctx, 2, 2, 12, 5, '#8a6f51');
  drawPixelRect(ctx, 2, 9, 12, 5, '#4a3a29');
  drawPixelRect(ctx, 4, 1, 2, 14, '#2b241d');
  drawPixelRect(ctx, 10, 1, 2, 14, '#2b241d');
  drawPixelRect(ctx, 4, 8, 2, 2, '#d4af55');
  drawPixelRect(ctx, 10, 8, 2, 2, '#d4af55');
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
  const main = police ? '#253145' : '#bf5e46';
  const hi = police ? '#314059' : '#db775e';
  const dark = police ? '#1b2433' : '#853c2b';
  const trim = '#13161a';

  // Side hull (32x8)
  const [cs, sctx] = makePixelCanvas(32, 8);
  drawPixelRect(sctx, 0, 0, 32, 8, trim);
  drawPixelRect(sctx, 1, 1, 30, 5, main);
  drawPixelRect(sctx, 1, 1, 30, 1, hi);
  drawPixelRect(sctx, 1, 5, 30, 1, dark);
  drawPixelRect(sctx, 0, 6, 32, 2, '#181c21'); // rocker/bumper
  if (police) {
    drawPixelRect(sctx, 9, 1, 14, 5, '#e8edf2'); // white police doors
    drawPixelRect(sctx, 14, 2, 4, 3, '#d4af55'); // gold badge
    drawPixelRect(sctx, 15, 3, 2, 1, '#253145');
  } else {
    // Subtle weathering & door seam
    drawPixelRect(sctx, 16, 1, 1, 5, dark);
    drawPixelRect(sctx, 6, 3, 2, 2, '#66341f');
    drawPixelRect(sctx, 24, 4, 3, 1, '#66341f');
  }

  // Hood / Roof / Trunk top (32x16)
  const [cr, rctx] = makePixelCanvas(32, 16);
  drawPixelRect(rctx, 0, 0, 32, 16, trim);
  drawPixelRect(rctx, 1, 1, 30, 14, police ? '#f2f5f7' : hi);
  drawPixelRect(rctx, 2, 2, 28, 12, police ? '#e8edf2' : main);
  if (!police) {
    drawPixelRect(rctx, 5, 4, 4, 2, '#66341f');
    drawPixelRect(rctx, 22, 10, 3, 2, '#66341f');
  }

  // Front grille + bumper + headlights (16x8)
  const [cf, fctx] = makePixelCanvas(16, 8);
  drawPixelRect(fctx, 0, 0, 16, 8, trim);
  drawPixelRect(fctx, 1, 1, 14, 5, main);
  drawPixelRect(fctx, 4, 2, 8, 3, '#2c3138'); // grille
  drawPixelRect(fctx, 5, 3, 6, 1, '#6a727a');
  drawPixelRect(fctx, 1, 2, 3, 2, '#fff0a3'); // headlights
  drawPixelRect(fctx, 12, 2, 3, 2, '#fff0a3');
  drawPixelRect(fctx, 0, 6, 16, 2, '#22262b');

  // Rear bumper + license plate + taillights (16x8)
  const [cb, bctx] = makePixelCanvas(16, 8);
  drawPixelRect(bctx, 0, 0, 16, 8, trim);
  drawPixelRect(bctx, 1, 1, 14, 5, dark);
  drawPixelRect(bctx, 6, 3, 4, 2, '#d8d3c4'); // plate
  drawPixelRect(bctx, 1, 2, 3, 2, '#eb4438'); // taillights
  drawPixelRect(bctx, 12, 2, 3, 2, '#eb4438');
  drawPixelRect(bctx, 0, 6, 16, 2, '#22262b');

  // Glass with diagonal sky reflections (16x8)
  const [cg, gctx] = makePixelCanvas(16, 8);
  drawPixelRect(gctx, 0, 0, 16, 8, '#161b21');
  drawPixelRect(gctx, 1, 1, 14, 6, '#395569');
  drawPixelRect(gctx, 2, 1, 5, 4, '#537b91');
  drawPixelRect(gctx, 3, 1, 3, 2, '#7cb0cc');

  // Circular wheel tire + alloy hubcap (24x24)
  const [cw, wctx] = makePixelCanvas(24, 24);
  drawPixelRect(wctx, 0, 0, 24, 24, '#0e1013');
  const drawDisc = (r: number, color: string) => {
    wctx.fillStyle = color;
    wctx.beginPath();
    wctx.arc(12, 12, r, 0, Math.PI * 2);
    wctx.fill();
  };
  drawDisc(11.5, '#191c20');
  drawDisc(7.0, '#8d969e');
  drawDisc(5.2, '#5e666e');
  wctx.fillStyle = '#2d3338';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    wctx.beginPath();
    wctx.arc(12 + Math.cos(a) * 3.4, 12 + Math.sin(a) * 3.4, 1.0, 0, Math.PI * 2);
    wctx.fill();
  }
  drawDisc(2.2, '#c8d1d9');

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
  const [c, ctx] = makePixelCanvas(12, 20);
  drawPixelRect(ctx, 0, 0, 12, 20, '#1c2024');
  drawPixelRect(ctx, 1, 1, 10, 18, '#dce3df');
  drawPixelRect(ctx, 1, 6, 10, 1, '#484f54'); // freezer seam
  drawPixelRect(ctx, 1, 17, 10, 2, '#2f3538'); // compressor grille
  drawPixelRect(ctx, 8, 2, 1, 3, '#8d999e'); // handles
  drawPixelRect(ctx, 8, 8, 1, 5, '#8d999e');
  drawPixelRect(ctx, 3, 8, 2, 2, '#d9534f'); // magnets
  drawPixelRect(ctx, 6, 9, 2, 1, '#f0c44d');
  return toNearestTexture(c);
}

function buildMedCabinetFrontTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(12, 16);
  drawPixelRect(ctx, 0, 0, 12, 16, '#1c2124');
  drawPixelRect(ctx, 1, 1, 10, 14, '#e4ebe8');
  drawPixelRect(ctx, 2, 2, 8, 12, '#cfd8d4');
  drawPixelRect(ctx, 5, 4, 2, 8, '#d13d34');
  drawPixelRect(ctx, 3, 7, 6, 2, '#d13d34');
  drawPixelRect(ctx, 9, 7, 1, 3, '#7b878c');
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
  // Crowbar forged steel + worn red paint edge
  const [cs, csCtx] = makePixelCanvas(16, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const topHi = y === 0 || y === 1;
      const botDark = y >= 6;
      const wear = (x * 5 + y * 11) % 9 === 0;
      csCtx.fillStyle = topHi ? '#a0aab2' : botDark ? '#3a4249' : wear ? '#5f6972' : '#7a848c';
      csCtx.fillRect(x, y, 1, 1);
    }
  }

  // Crowbar red pry-tip/grip paint
  const [cr, crCtx] = makePixelCanvas(12, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 12; x++) {
      const chip = (x + y * 3) % 7 === 0;
      crCtx.fillStyle = chip ? '#8f2923' : y < 2 ? '#e35950' : '#c94138';
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

  // Molotov tinted glass bottle with amber fuel line
  const [mg, mgCtx] = makePixelCanvas(8, 14);
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 8; x++) {
      const spec = x === 1 && y >= 2 && y <= 11;
      const liquid = y >= 7 && x >= 1 && x <= 6;
      let col = '#5b8a47';
      if (spec) col = '#9ac97f';
      else if (liquid) col = (x + y) % 3 === 0 ? '#d98c2b' : '#b8681f';
      else if (x === 0 || x === 7) col = '#3a592e';
      mgCtx.fillStyle = col;
      mgCtx.fillRect(x, y, 1, 1);
    }
  }

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

  return {
    crowbarSteel: toNearestTexture(cs),
    crowbarRed: toNearestTexture(cr),
    pistolSlide: toNearestTexture(ps),
    pistolGrip: toNearestTexture(pg),
    shotgunWood: toNearestTexture(sw),
    molotovGlass: toNearestTexture(mg),
    glove: toNearestTexture(gl),
  };
}

function buildTentCanvasTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || x === 15 || y === 0 || y === 15;
      const seam = x === 8 || y === 5 || y === 11;
      const stripe = y === 13 || y === 14;
      let col = (x + y) % 3 === 0 ? '#5c6b47' : '#4d5c3b';
      if (edge) col = '#262e1e';
      else if (seam) col = '#354028';
      else if (stripe) col = '#8c693a';
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return toNearestTexture(c);
}

function buildRockGraniteTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const n = (x * 13 + y * 23) % 7;
      const crack = (x === 5 && y >= 3 && y <= 11) || (y === 9 && x >= 5 && x <= 12);
      let col = n < 2 ? '#787e82' : n < 5 ? '#5c6266' : '#454a4e';
      if (crack) col = '#282c2e';
      else if (y <= 3 && n === 0) col = '#4f6642'; // top moss
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
  const [c, ctx] = makePixelCanvas(24, 10);
  drawPixelRect(ctx, 0, 0, 24, 10, '#181615');
  drawPixelRect(ctx, 1, 1, 22, 7, '#5c5957');
  drawPixelRect(ctx, 1, 1, 22, 1, '#736c67');
  // Rust & scorch streaks across doors and fenders
  drawPixelRect(ctx, 2, 3, 5, 3, '#6e3b24');
  drawPixelRect(ctx, 14, 2, 6, 4, '#292524');
  drawPixelRect(ctx, 16, 4, 5, 3, '#733e26');
  // Door seam & charred rocker panel
  drawPixelRect(ctx, 8, 1, 1, 7, '#1b1817');
  drawPixelRect(ctx, 15, 1, 1, 7, '#1b1817');
  drawPixelRect(ctx, 0, 8, 24, 2, '#1f1c1b');
  return toNearestTexture(c);
}

export class ThreePixelAtlas {
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
  public readonly quiltTex: THREE.CanvasTexture;
  public readonly dumpsterTex: THREE.CanvasTexture;
  public readonly sandbagTex: THREE.CanvasTexture;
  public readonly decalTex: Record<'blood' | 'scorch' | 'acid' | 'tire', THREE.CanvasTexture>;
  public readonly bulletImpactTex: Record<'stone' | 'wood' | 'metal' | 'blood_wall', THREE.CanvasTexture>;

  // Pixel-art model surface textures
  public readonly actorHeadTex: Record<'player' | 'walker' | 'runner' | 'bloater' | 'spitter', { front: THREE.CanvasTexture; back: THREE.CanvasTexture; side: THREE.CanvasTexture; top: THREE.CanvasTexture }>;
  public readonly actorTorsoTex: Record<'player' | 'walker' | 'runner' | 'bloater' | 'spitter', { front: THREE.CanvasTexture; back: THREE.CanvasTexture; side: THREE.CanvasTexture }>;
  public readonly actorLimbTex: Record<'player' | 'walker' | 'runner' | 'bloater' | 'spitter', { sleeve: THREE.CanvasTexture; leg: THREE.CanvasTexture }>;
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
  public readonly contactShadowTex: THREE.CanvasTexture;
  public readonly tentTex: THREE.CanvasTexture;
  public readonly rockTex: THREE.CanvasTexture;
  public readonly roadSignTex: THREE.CanvasTexture;
  public readonly wreckedCarTex: THREE.CanvasTexture;

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
      this.track(t.front);
      this.track(t.back);
      this.track(t.side);
      this.track(l.sleeve);
      this.track(l.leg);
      this.actorHeadTex[k] = h;
      this.actorTorsoTex[k] = t;
      this.actorLimbTex[k] = l;
    }

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
    this.track(this.weaponTex.pistolSlide);
    this.track(this.weaponTex.pistolGrip);
    this.track(this.weaponTex.shotgunWood);
    this.track(this.weaponTex.molotovGlass);
    this.track(this.weaponTex.glove);
    this.contactShadowTex = this.track(buildSoftContactShadowTexture());
    this.tentTex = this.track(buildTentCanvasTexture());
    this.rockTex = this.track(buildRockGraniteTexture());
    this.roadSignTex = this.track(buildRoadSignTexture());
    this.wreckedCarTex = this.track(buildWreckedCarTexture());
  }

  private track<T extends THREE.Texture>(tex: T): T {
    this.allTextures.push(tex);
    return tex;
  }

  getTileCanvas(kind: TileKind, variant: number): HTMLCanvasElement {
    return this.tileCanvases.get(`${kind}_${variant % 4}`)!;
  }

  createChunkTerrainTexture(getCell: (gx: number, gy: number) => { tile: TileKind; variant: number }, cx: number, cy: number, chunkSize: number): THREE.CanvasTexture {
    const pxPerTile = 16;
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

import { TILE_H, TILE_W } from './isometric';
import type { PropKind, StructureKind, TileKind, WeaponId, ZombieArchetype } from './types';

export type CharacterAnimState = 'idle' | 'walk' | 'windup' | 'attack' | 'dodge' | 'dying';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), w, h);
}

/**
 * Helper to draw a true 2:1 isometric pixel-voxel object centered at (cx, cy).
 */
function makeIsoPlotter(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number) {
  return (u: number, v: number, z: number, color: string) => {
    const sx = Math.round(cx + u - v);
    const sy = Math.round(cy + (u + v) * 0.5 - z);
    if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
      px(ctx, sx, sy, color);
    }
  };
}

/**
 * Draws a crisp 2:1 isometric ground tile (32x16) with procedural dithering & wear.
 */
function buildIsoTile(kind: TileKind, variant: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(TILE_W, TILE_H);
  const cx = TILE_W / 2;
  const cy = TILE_H / 2;

  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + variant * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };

  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const dx = Math.abs(x + 0.5 - cx) / cx;
      const dy = Math.abs(y + 0.5 - cy) / cy;
      if (dx + dy > 1.001) continue;

      const r = hash(x, y);
      let col = '#2e3b26';

      if (kind === 'grass') {
        if (r < 0.14) col = '#445737';
        else if (r < 0.34) col = '#3a4a2f';
        else if (r < 0.78) col = '#2f3d26';
        else col = '#25301e';
        if (r > 0.92 && y > 2) col = '#5a7046';
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
          if (variant === 0 && y === 7 && x >= 11 && x <= 20) col = '#8c7a3e';
          if (variant === 2 && ((x === 15 && y >= 5 && y <= 10) || (x === 16 && y >= 7 && y <= 11))) {
            col = '#14171a';
          }
        } else {
          const u = (x - cx) * 0.5 + (y - cy);
          const bar = Math.floor(u + 16) % 5;
          if (bar >= 1 && bar <= 2 && Math.abs(x - cx) < 11) {
            col = r < 0.18 ? '#6e7275' : '#9ca1a3';
          }
        }
      } else if (kind === 'sidewalk') {
        const isBorder = dx + dy > 0.86;
        const slabJoint = (x + y * 2) % 12 === 0;
        if (isBorder) col = y < cy ? '#62696e' : '#32363a';
        else if (slabJoint) col = '#2d3136';
        else if (r < 0.25) col = '#52585e';
        else if (r < 0.75) col = '#464b50';
        else col = '#3d4146';
        if (variant === 2 && slabJoint && r > 0.72) col = '#425433';
      } else if (kind === 'floor') {
        const plank = (x + y * 2) % 4 === 0;
        if (plank) col = '#30251d';
        else if (r < 0.25) col = '#5e4c3e';
        else if (r < 0.75) col = '#4e3e32';
        else col = '#413329';
      } else if (kind === 'floor_rug') {
        const border = dx + dy > 0.76;
        const motif = (x + y) % 4 === 0 || (x - y + 32) % 6 === 0;
        if (border) {
          col = (x + y) % 2 === 0 ? '#a8844c' : '#734433';
        } else if (motif) {
          col = r < 0.25 ? '#9c5243' : '#853c31';
        } else {
          col = r < 0.22 ? '#78342a' : '#632922';
        }
      } else if (kind === 'floor_bath') {
        const u = Math.floor(((x - cx) * 0.5 + (y - cy) + 20) / 3);
        const v = Math.floor(((cx - x) * 0.5 + (y - cy) + 20) / 3);
        const grout = (x + y * 2) % 3 === 0 || (x - y * 2 + 32) % 3 === 0;
        if (grout) col = '#3e4d4f';
        else col = (u + v) % 2 === 0 ? (r < 0.2 ? '#759194' : '#86a4a6') : r < 0.2 ? '#5d777a' : '#6a868a';
      } else if (kind === 'floor_porch') {
        const isEdge = dx + dy > 0.88;
        const seam = Math.floor((x - cx) * 0.5 + (y - cy) + 16) % 3 === 0;
        if (isEdge) col = '#38271b';
        else if (seam) col = '#2b1d14';
        else col = r < 0.3 ? '#755338' : r < 0.75 ? '#61442d' : '#4f3623';
      } else if (kind === 'tile_clinic') {
        const u = Math.floor(((x - cx) * 0.5 + (y - cy) + 20) / 4);
        const v = Math.floor(((cx - x) * 0.5 + (y - cy) + 20) / 4);
        const grout = (x + y * 2) % 4 === 0 || (x - y * 2 + 32) % 4 === 0;
        if (grout) col = '#4f5a57';
        else col = (u + v) % 2 === 0 ? (r < 0.18 ? '#7b8783' : '#8b9994') : r < 0.2 ? '#6e7a76' : '#7c8a85';
        if (variant === 3 && r > 0.9) col = '#57322e';
      } else if (kind === 'tile_diner') {
        const u = Math.floor(((x - cx) * 0.5 + (y - cy) + 20) / 4);
        const v = Math.floor(((cx - x) * 0.5 + (y - cy) + 20) / 4);
        const even = (u + v) % 2 === 0;
        col = even ? (r < 0.2 ? '#8f8a80' : '#a39d92') : r < 0.2 ? '#292c30' : '#35393e';
      } else if (kind === 'water') {
        const wave = (x + y * 2 + variant) % 7 === 0 && r < 0.45;
        col = wave ? '#315769' : r < 0.22 ? '#264654' : '#1b3440';
      } else if (kind === 'pier') {
        const u = (x - cx) * 0.5 + (y - cy);
        const plankSeam = Math.floor(u + 16) % 3 === 0;
        const rail = dx + dy > 0.88 && y > cy;
        if (rail) col = '#3d2a1b';
        else if (plankSeam) col = '#2a1d13';
        else col = r < 0.28 ? '#875f3d' : r < 0.76 ? '#704d30' : '#593b24';
      }

      px(ctx, x, y, col);
    }
  }

  return c;
}

/**
 * Renders neighbor-aware isometric architectural walls (bitmask: N=1, E=2, S=4, W=8)
 * including exterior brick/timber walls and interior plaster-wainscot partition walls.
 */
function buildWallSprite(
  kind: 'wall_brick' | 'wall_wood' | 'wall_interior',
  mask: number,
  variant: number
): HTMLCanvasElement {
  const w = 32;
  const h = 38;
  const [c, ctx] = makeCanvas(w, h);

  const hasN = (mask & 1) !== 0;
  const hasE = (mask & 2) !== 0;
  const hasS = (mask & 4) !== 0;
  const hasW = (mask & 8) !== 0;
  const topOffset = kind === 'wall_interior' ? 4 : 0;
  const wallHeight = kind === 'wall_interior' ? 14 : 18;

  // Ground contact ambient occlusion shadow along bottom edges
  ctx.fillStyle = 'rgba(7, 9, 11, 0.36)';
  for (let x = 0; x < 32; x++) {
    const botY = 11 + topOffset + Math.floor((16 - Math.abs(x + 0.5 - 16)) * 0.5) + wallHeight;
    if (botY + 1 < h) ctx.fillRect(x, botY + 1, 1, 2);
  }

  const hasWindow = kind !== 'wall_interior' && variant === 2 && ((hasE && hasW) || (hasN && hasS));

  for (let x = 0; x < 32; x++) {
    const isLeft = x < 16;
    const chip =
      kind !== 'wall_interior' && variant === 1 && !hasN && !hasS && (x === 6 || x === 7 || x === 24 || x === 25)
        ? 2
        : kind !== 'wall_interior' && variant === 3 && (x === 14 || x === 17)
          ? 1
          : 0;

    for (let y = 0; y < h; y++) {
      const capCenterY = 10 + topOffset + chip;
      const tdx = Math.abs(x + 0.5 - 16) / 16;
      const tdy = Math.abs(y + 0.5 - capCenterY) / 8;
      if (tdx + tdy <= 1.0 && y >= 2 + topOffset + chip) {
        const edgeNW = x < 16 && y < capCenterY && tdx + tdy > 0.85;
        const edgeNE = x >= 16 && y < capCenterY && tdx + tdy > 0.85;
        const edgeSW = x < 16 && y >= capCenterY && tdx + tdy > 0.85;
        const edgeSE = x >= 16 && y >= capCenterY && tdx + tdy > 0.85;

        const isOuterCapEdge =
          (edgeNW && !hasW) || (edgeNE && !hasN) || (edgeSW && !hasS) || (edgeSE && !hasE);

        if (kind === 'wall_brick') {
          ctx.fillStyle = isOuterCapEdge ? '#4f4a48' : (x + y) % 4 === 0 ? '#6e6560' : '#5e5652';
        } else if (kind === 'wall_wood') {
          ctx.fillStyle = isOuterCapEdge ? '#402f22' : (x + y) % 2 === 0 ? '#6b4e37' : '#59402c';
        } else {
          ctx.fillStyle = isOuterCapEdge ? '#59493b' : (x + y) % 3 === 0 ? '#8c8375' : '#7a7266';
        }
        ctx.fillRect(x, y, 1, 1);
      }

      const frontTopY = 10 + topOffset + chip + Math.floor((16 - Math.abs(x + 0.5 - 16)) * 0.5);
      const frontBotY = 10 + topOffset + Math.floor((16 - Math.abs(x + 0.5 - 16)) * 0.5) + wallHeight;

      if (y >= frontTopY && y <= frontBotY && y < h) {
        const skipLeftSeam = x === 0 && hasW;
        const skipRightSeam = x === 31 && hasE;
        const skipCenterCrease = (x === 15 || x === 16) && ((hasW && hasE) || (hasN && hasS));

        if (y === frontTopY || y === frontBotY || (x === 0 && !skipLeftSeam) || (x === 31 && !skipRightSeam)) {
          ctx.fillStyle = '#181415';
          ctx.fillRect(x, y, 1, 1);
          continue;
        }
        if ((x === 15 || x === 16) && !skipCenterCrease) {
          ctx.fillStyle = '#241b1a';
          ctx.fillRect(x, y, 1, 1);
          continue;
        }

        const relY = y - frontTopY;

        if (hasWindow && relY >= 4 && relY <= 11 && ((x >= 5 && x <= 11) || (x >= 20 && x <= 26))) {
          const isFrame =
            relY === 4 || relY === 11 || x === 5 || x === 11 || x === 20 || x === 26;
          const isPlank = relY === 6 || relY === 9;
          if (isFrame) ctx.fillStyle = '#261d17';
          else if (isPlank) ctx.fillStyle = isLeft ? '#7a593c' : '#59402b';
          else ctx.fillStyle = '#101316';
          ctx.fillRect(x, y, 1, 1);
          continue;
        }

        if (kind === 'wall_brick') {
          const isQuoin =
            ((!hasW && x >= 1 && x <= 4) || (!hasE && x >= 27 && x <= 30) || (!hasS && x >= 13 && x <= 18)) &&
            Math.floor(relY / 3) % 2 === 0;
          if (relY <= 2) {
            ctx.fillStyle = isLeft ? '#756e6a' : '#524c49';
            ctx.fillRect(x, y, 1, 1);
            continue;
          }
          if (relY >= 16) {
            ctx.fillStyle = isLeft ? '#4a4543' : '#332f2e';
            ctx.fillRect(x, y, 1, 1);
            continue;
          }
          if (isQuoin) {
            ctx.fillStyle = isLeft ? '#6b635e' : '#4a4441';
            ctx.fillRect(x, y, 1, 1);
            continue;
          }
          const course = Math.floor(relY / 3);
          const isMortarH = relY % 3 === 0;
          const isMortarV = (x + (course % 2) * 3) % 6 === 0;
          if (isMortarH || isMortarV) {
            ctx.fillStyle = isLeft ? '#3e3634' : '#2c2625';
          } else {
            const shade = (x * 7 + course * 13) % 5;
            if (isLeft) {
              ctx.fillStyle = shade === 0 ? '#965545' : shade < 3 ? '#7d4437' : '#66362c';
            } else {
              ctx.fillStyle = shade === 0 ? '#66362b' : shade < 3 ? '#542c24' : '#42211b';
            }
          }
          if (relY > 13 && (x + relY) % 3 === 0) {
            ctx.fillStyle = isLeft ? '#3a4a2e' : '#293621';
          }
        } else if (kind === 'wall_wood') {
          const isCornerPost =
            (!hasW && x >= 1 && x <= 3) || (!hasE && x >= 28 && x <= 30) || (!hasS && x >= 14 && x <= 17);
          const plankEdge = x % 4 === 0;
          const crossBrace = Math.abs(relY - (isLeft ? x * 0.8 : (31 - x) * 0.8)) < 1.4;
          if (relY <= 1 || relY >= 16 || isCornerPost) {
            ctx.fillStyle = isLeft ? '#4f3825' : '#382719';
          } else if (plankEdge) {
            ctx.fillStyle = '#241a13';
          } else if (crossBrace) {
            ctx.fillStyle = isLeft ? '#856142' : '#5e432d';
          } else {
            const grain = (x + relY * 2) % 5 === 0;
            ctx.fillStyle = isLeft
              ? grain
                ? '#5e432d'
                : '#755439'
              : grain
                ? '#453020'
                : '#523a27';
          }
        } else {
          // Interior plaster partition wall with warm oak wainscot paneling & crown trim
          if (relY <= 1) {
            ctx.fillStyle = isLeft ? '#b5aa94' : '#857d6d';
          } else if (relY === 8) {
            ctx.fillStyle = isLeft ? '#6e5038' : '#4c3625'; // chair rail
          } else if (relY >= 9) {
            const panel = x % 4 === 0;
            ctx.fillStyle = panel ? '#3b291c' : isLeft ? '#7a593e' : '#573f2c';
          } else {
            const subtlePaper = (x + relY) % 5 === 0;
            ctx.fillStyle = isLeft
              ? subtlePaper
                ? '#9e9c8e'
                : '#aba99b'
              : subtlePaper
                ? '#76756b'
                : '#828176';
          }
        }
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  return c;
}

function buildTreeSprite(dead: boolean): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(36, 48);
  const plot = makeIsoPlotter(ctx, 36, 48, 18, 42);

  for (let u = -7; u <= 7; u++) {
    for (let v = -7; v <= 7; v++) {
      if (u * u + v * v <= 42) {
        plot(u + 1, v + 1, 0, 'rgba(8, 10, 12, 0.46)');
      }
    }
  }
  for (let z = 1; z <= 16; z++) {
    const r = z <= 2 ? 3 : 2;
    for (let u = -r; u <= r; u++) {
      for (let v = -r; v <= r; v++) {
        if (u * u + v * v > r * r + 1) continue;
        const col =
          u === r && v === r
            ? '#241a14'
            : v > u
              ? '#634732'
              : u > v
                ? '#3d2a1d'
                : '#4f3726';
        plot(u, v, z, col);
      }
    }
  }

  if (dead) {
    const branches = [
      [17, 27, 10, 17],
      [18, 25, 26, 15],
      [14, 21, 8, 12],
      [22, 19, 28, 10],
      [18, 26, 17, 11],
    ];
    for (const [x0, y0, x1, y1] of branches) {
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const bx = Math.round(x0 + ((x1 - x0) * i) / steps);
        const by = Math.round(y0 + ((y1 - y0) * i) / steps);
        px(ctx, bx, by, '#574233', 2, 1);
        px(ctx, bx, by + 1, '#291e16', 1, 1);
      }
    }
    return c;
  }

  const tiers = [
    { cy: 31, rx: 13, ry: 7 },
    { cy: 23, rx: 11, ry: 6 },
    { cy: 15, rx: 8, ry: 5 },
    { cy: 8, rx: 5, ry: 4 },
  ];

  for (const tier of tiers) {
    for (let dy = -tier.ry; dy <= tier.ry; dy++) {
      const rowWidth = Math.max(1, Math.round(((dy + tier.ry) / (tier.ry * 2)) * tier.rx));
      for (let dx = -rowWidth; dx <= rowWidth; dx++) {
        const x = 18 + dx;
        const y = tier.cy + dy;
        if (x < 1 || x >= 35 || y < 1 || y >= 46) continue;
        if (Math.abs(dx) === rowWidth && (y + dx) % 2 === 0) continue;
        const n = (x * 13 + y * 29) % 7;
        let col = '#273c26';
        if (dx < -1 && dy < 1) col = n < 3 ? '#4c7043' : '#3b5935';
        else if (dy >= tier.ry - 1 || dx > 2) col = '#172418';
        else if (n === 0) col = '#3f6139';
        px(ctx, x, y, col);
      }
    }
  }
  return c;
}

function buildStreetlampSprite(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(28, 46);
  const plot = makeIsoPlotter(ctx, 28, 46, 14, 40);
  for (let u = -3; u <= 3; u++) {
    for (let v = -3; v <= 3; v++) {
      if (u * u + v * v <= 10) plot(u, v, 0, 'rgba(8, 10, 12, 0.45)');
    }
  }
  for (let z = 1; z <= 5; z++) {
    const r = z <= 2 ? 2 : 1;
    for (let u = -r; u <= r; u++) {
      for (let v = -r; v <= r; v++) {
        plot(u, v, z, v > u ? '#3c434a' : '#202429');
      }
    }
  }
  for (let y = 11; y <= 35; y++) {
    px(ctx, 13, y, '#4a535e', 1, 1);
    px(ctx, 14, y, '#22272c', 1, 1);
  }
  px(ctx, 14, 10, '#394047', 4, 2);
  px(ctx, 17, 11, '#49525c', 4, 2);
  px(ctx, 19, 12, '#1f2328', 5, 2);
  px(ctx, 20, 14, '#f5c258', 3, 2);
  px(ctx, 21, 14, '#fff2b8', 1, 1);
  return c;
}

/**
 * Animated & richly textured 2:1 isometric loot containers:
 * openStage: 0=closed (idle shimmer frame 0..3), 1=cracking open, 2=half open, 3=fully open showing interior loot
 */
function buildLootContainerSprite(
  kind: 'crate_wood' | 'crate_military' | 'fridge' | 'med_cabinet',
  openStage: number,
  idleFrame: number
): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(34, 38);
  const plot = makeIsoPlotter(ctx, 34, 38, 17, 26);

  const drawBox = (
    uMin: number,
    uMax: number,
    vMin: number,
    vMax: number,
    zMin: number,
    zMax: number,
    shader: (u: number, v: number, z: number, face: 'top' | 'left' | 'right', edge: boolean) => string | null
  ) => {
    for (let u = uMin - 1; u <= uMax + 1; u++) {
      for (let v = vMin - 1; v <= vMax + 1; v++) {
        plot(u, v, 0, 'rgba(6, 8, 10, 0.45)');
      }
    }
    for (let z = zMin; z <= zMax; z++) {
      for (let u = uMin; u <= uMax; u++) {
        for (let v = vMin; v <= vMax; v++) {
          const isTop = z === zMax;
          const isLeft = v === vMax && !isTop;
          const isRight = u === uMax && !isTop;
          if (!isTop && !isLeft && !isRight) continue;
          const boundaryCount =
            (u === uMin || u === uMax ? 1 : 0) +
            (v === vMin || v === vMax ? 1 : 0) +
            (z === zMin || z === zMax ? 1 : 0);
          const edge = boundaryCount >= 2;
          const face = isTop ? 'top' : isLeft ? 'left' : 'right';
          const col = shader(u, v, z, face, edge);
          if (col) plot(u, v, z, col);
        }
      }
    }
  };

  const isOpen = openStage > 0;
  const glintU = (idleFrame % 4) * 3 - 5;

  if (kind === 'crate_wood' || kind === 'crate_military') {
    const mil = kind === 'crate_military';
    const topHi = mil ? '#839964' : '#c99363';
    const topBase = mil ? '#6b7e50' : '#b37d4f';
    const leftBase = mil ? '#52633c' : '#8c5f3a';
    const rightBase = mil ? '#374228' : '#5e3f25';
    const trim = mil ? '#1d2219' : '#2b1b10';
    const bracket = mil ? '#49524d' : '#595e63';
    const claspCol = openStage === 0 && Math.abs(glintU) <= 2 ? '#fff0a3' : '#e0b84c';

    // Crate body (z = 1..9)
    drawBox(-6, 6, -6, 6, 1, 9, (u, v, z, face, edge) => {
      if (face === 'top' && isOpen) {
        if (Math.abs(u) <= 4 && Math.abs(v) <= 4) {
          // Detailed interior contents!
          if (openStage >= 2 && Math.abs(u + 1) <= 1 && Math.abs(v - 1) <= 1) {
            return mil ? '#d4b34a' : '#789e5a'; // brass ammo / supply cloth
          }
          if (openStage >= 2 && Math.abs(u - 2) <= 1 && Math.abs(v + 1) <= 1) {
            return mil ? '#c44536' : '#c98842'; // shotgun shells / ration tin
          }
          return '#16191c';
        }
        return trim;
      }

      // Corner iron brackets & rivets
      const isCornerBracket =
        (Math.abs(u) >= 5 && Math.abs(v) >= 5) ||
        ((z === 1 || z === 9) && (Math.abs(u) >= 5 || Math.abs(v) >= 5));
      if (edge) return trim;
      if (isCornerBracket && face !== 'top') return bracket;

      if (face === 'top') {
        const slat = u % 3 === 0;
        if (!isOpen && idleFrame % 4 === 1 && u + v === glintU) return topHi;
        return slat ? leftBase : topBase;
      }

      // Front brass clasp latch
      if (face === 'left' && Math.abs(u) <= 1 && z >= 7 && z <= 9) {
        return claspCol;
      }
      // Side rope/metal handle
      if (face === 'right' && Math.abs(v) <= 2 && z === 5) {
        return '#a89f8d';
      }
      if (mil) {
        if (z === 6) return '#e0bd53';
        if (face === 'left' && z === 4 && Math.abs(u) <= 2) return '#272e21';
        return face === 'left' ? (z % 3 === 0 ? '#465433' : leftBase) : rightBase;
      }
      // Diagonal brace + recessed wooden planks
      if (face === 'left' && Math.abs(u - (z - 5)) <= 1) return topBase;
      const plank = z % 3 === 0;
      return face === 'left' ? (plank ? '#754e2e' : leftBase) : plank ? '#472f1b' : rightBase;
    });

    // Animated hinged lid!
    if (openStage === 0) {
      // Closed lid cap with raised bevel (z=10)
      for (let u = -6; u <= 6; u++) {
        for (let v = -6; v <= 6; v++) {
          const isRim = Math.abs(u) === 6 || Math.abs(v) === 6;
          const col = isRim ? bracket : u % 3 === 0 ? leftBase : topBase;
          plot(u, v, 10, col);
        }
      }
      // Brass padlock pin
      plot(0, 6, 9, claspCol);
      plot(0, 6, 8, '#a8832a');
    } else {
      // Hinged lid lifting along back (-v) edge: stage 1=30deg, 2=65deg, 3=95deg
      const liftZ = openStage === 1 ? 10 : openStage === 2 ? 12 : 13;
      const tiltV = openStage === 1 ? -4 : openStage === 2 ? -6 : -7;
      for (let zOff = 0; zOff <= (openStage === 1 ? 2 : openStage === 2 ? 5 : 6); zOff++) {
        for (let u = -6; u <= 6; u++) {
          const isRim = Math.abs(u) === 6 || zOff === 0 || zOff === (openStage === 1 ? 2 : 5);
          const vPos = openStage === 1 ? -6 + zOff * 2 : tiltV;
          plot(u, Math.min(4, vPos), liftZ + zOff, isRim ? trim : topBase);
          if (Math.abs(u) <= 4 && !isRim) {
            plot(u, Math.min(4, vPos), liftZ + zOff - 1, topHi);
          }
        }
      }
    }
    return c;
  }

  if (kind === 'fridge') {
    const bodyBase = '#dce3df';
    const bodyShade = '#b2bdb8';
    const bodyDark = '#78827e';
    const handle = openStage === 0 && idleFrame % 4 === 2 ? '#ffffff' : '#c9d1d6';

    // Main fridge body (z=1..18)
    drawBox(-5, 5, -5, 5, 1, 18, (u, _v, z, face, edge) => {
      if (edge) return '#1c2024';
      if (face === 'top') return z === 18 ? bodyBase : bodyShade;
      if (face === 'left') {
        if (isOpen && Math.abs(u) <= 3 && z >= 3 && z <= 16) {
          // Lit cool-blue interior shelves with bottles & cans!
          if (z === 8 || z === 13) return '#6e8c99';
          if (openStage >= 2 && z >= 9 && z <= 11 && u >= -2 && u <= 0) return '#58a6d1'; // water bottle
          if (openStage >= 2 && z >= 4 && z <= 6 && u >= 1 && u <= 2) return '#d9963b'; // food tin
          return '#2c414d';
        }
        if (z === 12) return '#484f54'; // freezer divider
        if (z === 2) return '#2f3538'; // compressor grille
        if (u === 3 && ((z >= 14 && z <= 16) || (z >= 7 && z <= 10))) return handle;
        // Fridge magnets / notes
        if (!isOpen && u === -2 && z === 14) return '#d9534f';
        if (!isOpen && u === 0 && z === 15) return '#f0c44d';
        return bodyShade;
      }
      return bodyDark;
    });

    // Swung-open fridge door on the right (+u=+5) hinge!
    if (isOpen) {
      const swingOut = openStage === 1 ? 2 : openStage === 2 ? 4 : 5;
      for (let z = 2; z <= 17; z++) {
        for (let d = 1; d <= swingOut; d++) {
          plot(5, 5 + d, z, d === swingOut || z === 2 || z === 17 ? '#1c2024' : bodyBase);
        }
      }
    }
    return c;
  }

  // Medical Cabinet
  const cabTop = '#e4ebe8';
  const cabLeft = '#bcc7c2';
  const cabDark = '#7f8a85';
  drawBox(-4, 4, -4, 4, 1, 15, (u, _v, z, face, edge) => {
    if (edge) return '#1c2124';
    if (face === 'top') return cabTop;
    if (face === 'left') {
      if (isOpen && Math.abs(u) <= 2 && z >= 3 && z <= 13) {
        if (z === 8) return '#8d9994';
        if (openStage >= 2 && z >= 9 && z <= 11 && u === -1) return '#e6dfd3'; // bandages
        if (openStage >= 2 && z >= 4 && z <= 6 && u === 1) return '#d9483b'; // med bottle
        return '#232d30';
      }
      if ((Math.abs(u) <= 1 && z >= 5 && z <= 11) || (z >= 7 && z <= 9 && Math.abs(u) <= 2)) {
        return openStage === 0 && idleFrame % 4 === 1 ? '#f2574e' : '#d13d34';
      }
      if (u === 3 && z >= 7 && z <= 9) return '#dce3e6';
      return cabLeft;
    }
    return cabDark;
  });
  if (isOpen) {
    const swingOut = openStage === 1 ? 2 : openStage === 2 ? 3 : 4;
    for (let z = 2; z <= 14; z++) {
      for (let d = 1; d <= swingOut; d++) {
        plot(4, 4 + d, z, d === swingOut || z === 2 || z === 14 ? '#1c2124' : cabTop);
      }
    }
  }
  return c;
}

/**
 * Builds true 2:1 isometric survival objects & rich interior house furniture.
 */
function buildIsoObjectSprite(
  kind:
    | 'dumpster'
    | 'concrete_barrier'
    | 'counter'
    | 'bench'
    | 'hydrant'
    | 'stove'
    | 'fishing_post'
    | 'bed'
    | 'couch'
    | 'table'
    | 'bookshelf'
    | 'desk'
    | 'sink_toilet'
    | 'tv_stand'
): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(34, 38);
  const plot = makeIsoPlotter(ctx, 34, 38, 17, 26);

  const drawBox = (
    uMin: number,
    uMax: number,
    vMin: number,
    vMax: number,
    zMin: number,
    zMax: number,
    shader: (u: number, v: number, z: number, face: 'top' | 'left' | 'right', edge: boolean) => string | null
  ) => {
    for (let u = uMin - 1; u <= uMax + 1; u++) {
      for (let v = vMin - 1; v <= vMax + 1; v++) {
        plot(u, v, 0, 'rgba(6, 8, 10, 0.42)');
      }
    }
    for (let z = zMin; z <= zMax; z++) {
      for (let u = uMin; u <= uMax; u++) {
        for (let v = vMin; v <= vMax; v++) {
          const isTop = z === zMax;
          const isLeft = v === vMax && !isTop;
          const isRight = u === uMax && !isTop;
          if (!isTop && !isLeft && !isRight) continue;
          const boundaryCount =
            (u === uMin || u === uMax ? 1 : 0) +
            (v === vMin || v === vMax ? 1 : 0) +
            (z === zMin || z === zMax ? 1 : 0);
          const edge = boundaryCount >= 2;
          const face = isTop ? 'top' : isLeft ? 'left' : 'right';
          const col = shader(u, v, z, face, edge);
          if (col) plot(u, v, z, col);
        }
      }
    }
  };

  if (kind === 'bed') {
    // Timber legs (z = 1)
    for (const lu of [-6, 6]) {
      for (const lv of [-4, 4]) {
        plot(lu, lv, 1, '#3b2515');
      }
    }
    // Cozy mattress, puffy pillow, crisp white sheet fold & warm quilted blanket
    drawBox(-7, 7, -5, 5, 2, 5, (u, v, z, face, edge) => {
      if (edge) return '#241810';
      if (z === 2 && face !== 'top') return face === 'left' ? '#69472c' : '#4a301c';
      if (face === 'top') {
        if (u <= -3) {
          // Fluffy pillow resting at headboard with center crease
          if (Math.abs(v) <= 3 && u >= -5 && u <= -4) {
            return v === 0 ? '#cfc8ba' : '#f2ede2';
          }
          return '#ddd6c7';
        }
        if (u === -2) return '#ede7da'; // crisp folded top sheet trim
        const stripe = ((u + 7) % 3 === 0) || (Math.abs(v) === 3);
        return stripe ? '#496343' : '#618259'; // quilted olive blanket
      }
      if (u <= -2) return face === 'left' ? '#c9c2b2' : '#9c9687';
      return face === 'left' ? '#4d6946' : '#394f34';
    });
    // Tall carved headboard at u = -7..-6
    drawBox(-7, -6, -5, 5, 6, 11, (_u, v, z, face, edge) => {
      if (edge) return '#1c120c';
      if (face === 'top') return '#946641';
      return (v + z) % 2 === 0 ? '#734c2e' : '#573820';
    });
    // Low carved footboard at u = 6..7
    drawBox(6, 7, -5, 5, 6, 7, (_u, v, _z, face, edge) => {
      if (edge) return '#1c120c';
      if (face === 'top') return '#875c3a';
      return v % 2 === 0 ? '#694429' : '#4f331e';
    });
    return c;
  }

  if (kind === 'couch') {
    // Seat & base cushions
    drawBox(-7, 7, -4, 4, 1, 5, (u, _v, z, face, edge) => {
      if (edge) return '#1b1a18';
      if (face === 'top') return u === 0 ? '#5c4130' : '#7a5741'; // twin seat cushions
      if (z === 1) return '#3b291d';
      return face === 'left' ? '#664835' : '#4a3325';
    });
    // Backrest along v = -4..-3 + side armrests
    drawBox(-7, 7, -4, -3, 6, 10, (_u, _v, _z, face, edge) => {
      if (edge) return '#1b1a18';
      return face === 'top' ? '#8c664d' : '#5c402e';
    });
    drawBox(-7, -6, -3, 4, 6, 7, (_u, _v, _z, face, edge) => (edge ? '#1b1a18' : face === 'top' ? '#856048' : '#593d2c'));
    drawBox(6, 7, -3, 4, 6, 7, (_u, _v, _z, face, edge) => (edge ? '#1b1a18' : face === 'top' ? '#856048' : '#473022'));
    return c;
  }

  if (kind === 'table') {
    // 4 timber legs (z=1..6)
    for (const lu of [-5, 5]) {
      for (const lv of [-4, 4]) {
        for (let z = 1; z <= 6; z++) {
          plot(lu, lv, z, '#4a3321');
        }
      }
    }
    // Tabletop + tin plate & mug
    drawBox(-6, 6, -5, 5, 6, 8, (u, v, _z, face, edge) => {
      if (edge) return '#241910';
      if (face === 'top') {
        if ((u - 2) * (u - 2) + (v - 1) * (v - 1) <= 3) return '#d6d2c7'; // plate
        return u % 3 === 0 ? '#8a6240' : '#a1734d';
      }
      return face === 'left' ? '#755033' : '#573b24';
    });
    plot(-2, -1, 9, '#d15a3f'); // mug
    plot(-2, -1, 10, '#f0e6d2');
    return c;
  }

  if (kind === 'bookshelf') {
    drawBox(-7, 7, -3, 3, 1, 17, (u, _v, z, face, edge) => {
      if (edge) return '#1f150e';
      if (face === 'top') return '#7a5437';
      if (face === 'left') {
        if (z === 1 || z === 6 || z === 11 || z === 16) return '#66442b';
        if (Math.abs(u) <= 5) {
          // Colorful pixel book spines
          const b = (u + z * 3 + 12) % 5;
          if ((u + 7) % 4 === 0) return '#261c14';
          return b === 0 ? '#9c3b33' : b === 1 ? '#4a7052' : b === 2 ? '#45688a' : b === 3 ? '#c29848' : '#735a42';
        }
        return '#593b24';
      }
      return '#452c1a';
    });
    return c;
  }

  if (kind === 'desk') {
    drawBox(-7, 7, -4, 4, 1, 7, (u, v, z, face, edge) => {
      if (edge) return '#1d1610';
      if (face === 'top') {
        if (Math.abs(u) <= 3 && Math.abs(v) <= 2) return '#34473a'; // desk blotter
        return '#8c6443';
      }
      if (face === 'left' && Math.abs(u) >= 3 && z <= 5) {
        return z === 3 ? '#c7a44a' : '#5e4028'; // drawers + brass pulls
      }
      return face === 'left' ? '#704d30' : '#4a321e';
    });
    // Field radio / lamp on desk
    drawBox(-5, -2, -2, 1, 8, 11, (_u, _v, z, face, edge) => {
      if (edge) return '#181c1e';
      if (face === 'left' && z === 9) return '#6ee09e'; // radio dial glow
      return face === 'top' ? '#5e666b' : '#3d4347';
    });
    return c;
  }

  if (kind === 'sink_toilet') {
    // Porcelain bathroom vanity & sink bowl
    drawBox(-4, 4, -4, 4, 1, 8, (u, v, z, face, edge) => {
      if (edge) return '#2b3236';
      if (face === 'top') {
        if (Math.abs(u) <= 2 && Math.abs(v) <= 2) return '#587b87'; // basin water
        return '#e6ecee';
      }
      if (face === 'left' && z === 4 && Math.abs(u) <= 1) return '#9aa4a8';
      return face === 'left' ? '#cfd8db' : '#9ca7ab';
    });
    // Chrome faucet & wall mirror
    plot(0, -3, 9, '#b5c0c4');
    plot(0, -3, 10, '#e3edf0');
    drawBox(-3, 3, -4, -3, 10, 15, (_u, _v, _z, face, edge) => (edge ? '#2e363b' : face === 'left' ? '#8eb4c2' : '#6b8791'));
    return c;
  }

  if (kind === 'tv_stand') {
    // Walnut cabinet
    drawBox(-6, 6, -3, 3, 1, 6, (u, _v, z, face, edge) => {
      if (edge) return '#1c140e';
      if (face === 'top') return '#7d5637';
      return face === 'left' ? (z === 3 && u === 0 ? '#b89646' : '#5e3f27') : '#422c1b';
    });
    // Boxy CRT Television
    drawBox(-4, 4, -2, 2, 7, 13, (u, _v, z, face, edge) => {
      if (edge) return '#141618';
      if (face === 'top') return '#494e54';
      if (face === 'left') {
        if (u >= -3 && u <= 1 && z >= 8 && z <= 11) {
          return (u + z) % 2 === 0 ? '#506773' : '#3d515c'; // CRT static glass
        }
        if (u === 3 && (z === 9 || z === 11)) return '#c7a44a'; // dial knobs
        return '#303438';
      }
      return '#222529';
    });
    // Rabbit-ear antenna
    plot(-1, 0, 14, '#9aa2a8');
    plot(-2, 0, 15, '#c4ccd1');
    plot(1, 0, 14, '#9aa2a8');
    plot(2, 0, 15, '#c4ccd1');
    return c;
  }

  if (kind === 'dumpster') {
    drawBox(-8, 8, -5, 5, 1, 10, (u, _v, z, face, edge) => {
      if (edge) return '#161b18';
      if (face === 'top') return u < 0 ? '#1b2022' : '#35453b';
      if (z >= 8) return '#222825';
      const rib = u % 4 === 0;
      if (face === 'left') return rib ? '#314737' : '#45634d';
      return rib ? '#223026' : '#2f4235';
    });
    return c;
  }

  if (kind === 'concrete_barrier') {
    drawBox(-8, 8, -3, 3, 1, 7, (u, _v, z, face, edge) => {
      if (edge) return '#272a2e';
      if (face === 'top') return '#9ba1a6';
      const hazard = (u + z + 16) % 6 < 2 && z >= 4;
      if (face === 'left') return hazard ? '#e3a63b' : z <= 2 ? '#595f63' : '#7f868a';
      return hazard ? '#a67624' : '#5e6369';
    });
    return c;
  }

  if (kind === 'counter') {
    drawBox(-7, 7, -4, 4, 1, 8, (_u, _v, z, face, edge) => {
      if (edge) return '#241a12';
      if (face === 'top') return '#a88968';
      if (face === 'left') return z % 2 === 0 ? '#78573d' : '#63462f';
      return '#4a3322';
    });
    return c;
  }

  if (kind === 'bench') {
    drawBox(-7, 7, -3, 3, 2, 5, (_u, _v, _z, face, edge) => {
      if (edge) return '#1d1916';
      return face === 'top' ? '#966943' : '#5e4028';
    });
    for (let u = -7; u <= 7; u++) {
      plot(u, -3, 7, '#7d5635');
      plot(u, -3, 8, '#9e6f47');
    }
    return c;
  }

  if (kind === 'stove') {
    drawBox(-5, 5, -5, 5, 1, 10, (u, v, z, face, edge) => {
      if (edge) return '#16191c';
      if (face === 'top') {
        if ((Math.abs(u - 2) <= 1 && Math.abs(v - 2) <= 1) || (Math.abs(u + 2) <= 1 && Math.abs(v + 2) <= 1)) {
          return '#e66c2c';
        }
        return '#2e3338';
      }
      if (face === 'left') {
        if (z >= 3 && z <= 7 && Math.abs(u) <= 3) {
          return z === 7 ? '#d9dde0' : '#1b1f24';
        }
        return '#888f96';
      }
      return '#61686e';
    });
    drawBox(-4, 0, -4, 0, 11, 14, (_u, _v, z, face, edge) => {
      if (edge) return '#1b1f24';
      if (face === 'top') return z === 14 ? '#adb5bd' : '#7c858e';
      return face === 'left' ? '#7a838c' : '#555c63';
    });
    return c;
  }

  if (kind === 'fishing_post') {
    drawBox(-2, 2, -2, 2, 1, 13, (_u, _v, _z, face, edge) => {
      if (edge) return '#1d150e';
      if (face === 'top') return '#704d30';
      return face === 'left' ? '#5e4028' : '#402a19';
    });
    plot(2, 0, 12, '#3d4247');
    plot(3, 0, 11, '#f5c258');
    plot(3, 0, 10, '#fff2b8');
    return c;
  }

  // Fire hydrant
  drawBox(-2, 2, -2, 2, 1, 8, (_u, _v, z, face, edge) => {
    if (edge && z === 8) return '#e34e40';
    if (edge) return '#291210';
    if (face === 'top') return '#db493d';
    return face === 'left' ? '#c2362b' : '#87221b';
  });
  plot(-3, 0, 5, '#c7c7c7');
  plot(3, 0, 5, '#999999');
  return c;
}

function buildDoorSprite(
  orientation: 'ns' | 'ew',
  status: 'closed' | 'open' | 'locked' | 'barricaded'
): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(32, 38);
  const plot = makeIsoPlotter(ctx, 32, 38, 16, 26);

  const drawPlankBox = (
    uMin: number,
    uMax: number,
    vMin: number,
    vMax: number,
    zMin: number,
    zMax: number,
    shader: (u: number, v: number, z: number, face: 'top' | 'left' | 'right', edge: boolean) => string
  ) => {
    for (let z = zMin; z <= zMax; z++) {
      for (let u = uMin; u <= uMax; u++) {
        for (let v = vMin; v <= vMax; v++) {
          const isTop = z === zMax;
          const isLeft = v === vMax && !isTop;
          const isRight = u === uMax && !isTop;
          if (!isTop && !isLeft && !isRight) continue;
          const boundaryCount =
            (u === uMin || u === uMax ? 1 : 0) +
            (v === vMin || v === vMax ? 1 : 0) +
            (z === zMin || z === zMax ? 1 : 0);
          const edge = boundaryCount >= 2;
          const face = isTop ? 'top' : isLeft ? 'left' : 'right';
          plot(u, v, z, shader(u, v, z, face, edge));
        }
      }
    }
  };

  const isHorizontal = status === 'open' ? orientation === 'ns' : orientation === 'ew';
  const uMin = status === 'open' && orientation === 'ns' ? -7 : isHorizontal ? -7 : -1;
  const uMax = status === 'open' && orientation === 'ns' ? 5 : isHorizontal ? 7 : 1;
  const vMin = status === 'open' && orientation === 'ew' ? -7 : isHorizontal ? -1 : -7;
  const vMax = status === 'open' && orientation === 'ew' ? 5 : isHorizontal ? 1 : 7;

  for (let i = -7; i <= 7; i++) {
    if (orientation === 'ew') plot(i, 0, 0, '#2c251f');
    else plot(0, i, 0, '#2c251f');
  }

  drawPlankBox(uMin, uMax, vMin, vMax, 1, 17, (u, v, z, face, edge) => {
    if (edge) return '#1b140f';
    if (face === 'top') return '#6e4c32';
    const isLocked = status === 'locked';
    if (isLocked && z >= 7 && z <= 10 && Math.abs(isHorizontal ? u : v) <= 2) {
      return z === 9 ? '#f0c44d' : '#b88b28';
    }
    if (z >= 8 && z <= 9 && (isHorizontal ? u === 4 : v === 4)) {
      return '#e8c458';
    }
    const groove = isHorizontal ? u % 3 === 0 : v % 3 === 0;
    if (face === 'left') return groove ? '#593b25' : '#7a5437';
    return groove ? '#422b1a' : '#5c3e27';
  });

  if (status === 'barricaded') {
    for (let i = -7; i <= 7; i++) {
      const zA = 5 + Math.round((i + 7) * 0.45);
      const zB = 12 - Math.round((i + 7) * 0.45);
      if (orientation === 'ew') {
        plot(i, 2, zA, '#9c6e46');
        plot(i, 2, zA + 1, '#5e4027');
        plot(i, 2, zB, '#8f633d');
      } else {
        plot(2, i, zA, '#9c6e46');
        plot(2, i, zA + 1, '#5e4027');
        plot(2, i, zB, '#8f633d');
      }
    }
  }

  return c;
}

function buildBurnBarrelSprite(frame: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(28, 34);
  const plot = makeIsoPlotter(ctx, 28, 34, 14, 24);
  for (let u = -5; u <= 5; u++) {
    for (let v = -5; v <= 5; v++) {
      if (u * u + v * v < 24) plot(u, v, 0, 'rgba(6, 8, 10, 0.45)');
    }
  }
  for (let z = 1; z <= 12; z++) {
    for (let u = -4; u <= 4; u++) {
      for (let v = -4; v <= 4; v++) {
        if (u * u + v * v > 20) continue;
        const rim = z === 1 || z === 6 || z === 12;
        const isTop = z === 12;
        let col = '#4a4e52';
        if (isTop) col = u * u + v * v < 10 ? '#d9571e' : '#26292c';
        else if (rim) col = '#25282b';
        else if ((u * 5 + z * 3) % 7 === 0) col = '#7a4024';
        else if (v > u) col = '#5d6369';
        else col = '#35393d';
        plot(u, v, z, col);
      }
    }
  }
  const flick = frame % 4;
  const fH = flick === 0 ? 7 : flick === 1 ? 9 : flick === 2 ? 6 : 8;
  for (let i = 0; i < fH; i++) {
    const rad = Math.max(0, Math.round(2 - (i / fH) * 2));
    const sway = flick === 1 ? -1 : flick === 3 ? 1 : 0;
    for (let dx = -rad; dx <= rad; dx++) {
      px(ctx, 14 + dx + (i > 3 ? sway : 0), 12 - i, i < 2 ? '#fff1a8' : i < 5 ? '#f79520' : '#d64527');
    }
  }
  return c;
}

/**
 * Builds crisp 2:1 isometric vehicle sprites for 16 smooth rotation angles (0..15) using a 2D depth buffer.
 */
function buildVehicleSprite(
  police: boolean,
  angleIdx: number,
  searched = false,
  sirenFrame = 0
): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(52, 38);
  const bodyMain = police ? '#253145' : '#bf5e46';
  const bodySide = police ? '#1b2433' : '#853c2b';
  const bodyTop = police ? '#314059' : '#db775e';
  const trim = '#13161a';

  const theta = (angleIdx / 16) * Math.PI * 2;
  const cosA = Math.cos(theta);
  const sinA = Math.sin(theta);
  const zBuf = new Float32Array(52 * 38).fill(-1e9);

  const plotRotIso = (u: number, v: number, h: number, color: string) => {
    const wx = u * cosA - v * sinA;
    const wy = u * sinA + v * cosA;
    const sx = Math.round(26 + (wx - wy) * 0.92);
    const sy = Math.round(24 + (wx + wy) * 0.46 - h);
    const depth = wx + wy + h * 0.35;
    if (sx >= 0 && sx < 52 && sy >= 0 && sy < 38) {
      const idx = sy * 52 + sx;
      if (depth >= zBuf[idx]) {
        zBuf[idx] = depth;
        px(ctx, sx, sy, color);
      }
    }
  };

  for (let u = -14; u <= 14; u++) {
    for (let v = -7; v <= 7; v++) {
      if (Math.abs(u) + Math.abs(v) * 0.5 < 16) {
        const wx = u * cosA - v * sinA;
        const wy = u * sinA + v * cosA;
        const sx = Math.round(26 + (wx - wy) * 0.92);
        const sy = Math.round(24 + (wx + wy) * 0.46);
        if (sx >= 0 && sx < 52 && sy >= 0 && sy < 38) {
          ctx.fillStyle = 'rgba(6, 8, 10, 0.46)';
          ctx.fillRect(sx, sy, 1, 1);
        }
      }
    }
  }

  for (let h = 2; h <= 7; h++) {
    for (let u = -13; u <= 13; u++) {
      for (let v = -6; v <= 6; v++) {
        if (Math.abs(u) >= 12 && Math.abs(v) >= 5) continue;
        const onOuter = Math.abs(u) === 13 || Math.abs(v) === 6 || h === 2 || h === 7;
        if (!onOuter) continue;

        const borderCount =
          (Math.abs(u) === 13 ? 1 : 0) +
          (Math.abs(v) === 6 ? 1 : 0) +
          (h === 2 || h === 7 ? 1 : 0);
        const isEdge = borderCount >= 2;

        let col = bodyMain;
        if (h === 7) col = bodyTop;
        else if (Math.abs(v) === 6) col = bodySide;

        if (police && Math.abs(u) <= 5 && (Math.abs(v) === 6 || h === 7)) col = '#e8edf2';
        if (!police && ((u * 7 + v * 13 + h * 5) & 15) === 0) col = '#66341f';
        if (isEdge) col = trim;

        if (h <= 4 && (Math.abs(u - 7) <= 2 || Math.abs(u + 7) <= 2) && Math.abs(v) >= 5) {
          col = h === 3 && (Math.abs(u - 7) <= 1 || Math.abs(u + 7) <= 1) ? '#8d969e' : '#101214';
        }
        if (h >= 4 && h <= 5 && u === 13 && Math.abs(v) >= 3 && Math.abs(v) <= 4) col = '#fff0a3';
        if (h >= 4 && h <= 5 && u === -13 && Math.abs(v) >= 3 && Math.abs(v) <= 4) col = '#eb4438';

        plotRotIso(u, v, h, col);
      }
    }
  }

  for (let h = 8; h <= 12; h++) {
    const uMin = -7 + Math.floor((h - 8) * 0.4);
    const uMax = 6 - Math.floor((h - 8) * 0.6);
    for (let u = uMin; u <= uMax; u++) {
      for (let v = -5; v <= 5; v++) {
        const onOuter = u === uMin || u === uMax || Math.abs(v) === 5 || h === 12;
        if (!onOuter) continue;

        const borderCount =
          (u === uMin || u === uMax ? 1 : 0) +
          (Math.abs(v) === 5 ? 1 : 0) +
          (h === 12 ? 1 : 0);
        const isEdge = borderCount >= 2;

        let col = h === 12 ? (police ? '#f2f5f7' : bodyTop) : bodyMain;
        if (h >= 9 && h <= 11) {
          if (u === uMax) col = v < 0 ? '#7cb0cc' : '#537b91';
          else if (u === uMin) col = '#3c5a6e';
          else if (Math.abs(v) === 5 && u > uMin + 1 && u < uMax - 1) col = '#395569';
        }
        if (isEdge) col = trim;
        plotRotIso(u, v, h, col);
      }
    }
  }

  if (police) {
    for (let v = -3; v <= 3; v++) {
      plotRotIso(-1, v, 13, '#181c21');
      const leftFlash = sirenFrame % 2 === 0;
      const cLeft = leftFlash ? '#ff5952' : '#7a201c';
      const cRight = leftFlash ? '#1e4273' : '#5ea8ff';
      plotRotIso(0, v, 13, v < 0 ? cLeft : v > 0 ? cRight : '#dce2e8');
      plotRotIso(0, v, 14, v < 0 ? cLeft : v > 0 ? cRight : '#ffffff');
    }
  }

  if (searched) {
    for (let u = -13; u <= -9; u++) {
      for (let v = -4; v <= 4; v++) {
        plotRotIso(u, v, 8, '#171a1e');
      }
    }
    plotRotIso(-11, 0, 11, bodyTop);
  }

  return c;
}

/**
 * High-detail multi-state isometric pixel-art character & zombie sprites (32x40, 36x42 for bloater).
 * Supports idle breathing, walk stride, windup crouch, attack lunge, dodge roll, and KO topple animations.
 */
function buildCharacterSprite(
  kind: 'player' | ZombieArchetype,
  animState: CharacterAnimState,
  frame: number,
  facingRight: boolean,
  facingUp = false
): HTMLCanvasElement {
  const isBloater = kind === 'bloater';
  const w = isBloater ? 36 : 32;
  const h = isBloater ? 42 : 40;
  const [c, ctx] = makeCanvas(w, h);
  const cx = Math.floor(w / 2);
  const groundY = h - 4;
  const dir = facingRight ? 1 : -1;

  // Dying collapse sprite frames (progressive kneel -> fall -> sprawl)
  if (animState === 'dying' && kind !== 'player') {
    const stage = frame % 3;
    const skin =
      kind === 'walker'
        ? '#7d9478'
        : kind === 'runner'
          ? '#946e6a'
          : kind === 'bloater'
            ? '#6f8c49'
            : '#5f8782';
    const shirt =
      kind === 'walker'
        ? '#5e4942'
        : kind === 'runner'
          ? '#7a2b2b'
          : kind === 'bloater'
            ? '#485435'
            : '#38464d';

    // Dark ground pool shadow
    ctx.fillStyle = 'rgba(6, 8, 10, 0.52)';
    ctx.fillRect(cx - 10, groundY - 2, 20, 4);

    if (stage === 0) {
      // Staggering / dropping to knees
      px(ctx, cx - 5, groundY - 12, '#121417', 10, 10);
      px(ctx, cx - 4, groundY - 11, shirt, 8, 7);
      px(ctx, cx - 3, groundY - 18, '#121417', 7, 7);
      px(ctx, cx - 2, groundY - 17, skin, 5, 5);
      px(ctx, cx - 5, groundY - 4, '#24292e', 9, 4);
    } else if (stage === 1) {
      // Falling sideways
      px(ctx, cx - 9, groundY - 8, '#121417', 16, 7);
      px(ctx, cx - 8, groundY - 7, shirt, 9, 5);
      px(ctx, cx + 1, groundY - 7, '#282d33', 5, 4);
      px(ctx, cx - 12, groundY - 10, '#121417', 7, 6);
      px(ctx, cx - 11, groundY - 9, skin, 5, 4);
    } else {
      // Sprawled flat on floor
      px(ctx, cx - 12, groundY - 5, '#121417', 23, 5);
      px(ctx, cx - 10, groundY - 4, shirt, 10, 3);
      px(ctx, cx, groundY - 4, '#24292e', 9, 3);
      px(ctx, cx - 13, groundY - 5, skin, 4, 3);
      px(ctx, cx - 6, groundY - 2, '#6e1919', 8, 2);
    }
    return c;
  }

  // Ground contact shadow
  ctx.fillStyle = 'rgba(6, 8, 10, 0.54)';
  const shadowR = isBloater ? 9 : 7;
  ctx.fillRect(cx - shadowR, groundY - 2, shadowR * 2, 3);
  ctx.fillRect(cx - shadowR + 2, groundY - 3, (shadowR - 2) * 2, 5);

  // Dodge roll tucked silhouette for Player
  if (animState === 'dodge' && kind === 'player') {
    const rollShift = frame % 2 === 0 ? dir * 2 : dir * 4;
    px(ctx, cx - 7 + rollShift, groundY - 15, '#121518', 14, 12);
    px(ctx, cx - 6 + rollShift, groundY - 14, '#455942', 12, 9);
    px(ctx, cx - 4 + rollShift, groundY - 16, '#6b553d', 8, 5);
    px(ctx, cx - 5 + rollShift, groundY - 12, '#d98a3b', 4, 2); // goggle streak
    px(ctx, cx - 7 - dir * 2, groundY - 8, '#323a45', 5, 4);
    return c;
  }

  // Per-state kinematic animation curves (smooth 8-frame sinusoidal walk cycle)
  const f = frame % 4;
  let stride = 0;
  let bob = 0;
  let armSwing = 0;
  let lungeX = 0;
  let crouchY = 0;
  let legBackLift = 0;
  let legFrontLift = 0;

  if (animState === 'walk') {
    const walkPhase = ((frame % 8) / 8) * Math.PI * 2;
    const sinP = Math.sin(walkPhase);
    stride = Math.round(sinP * 3.2);
    bob = Math.round(-Math.abs(Math.cos(walkPhase)) * 1.4);
    armSwing = Math.round(-sinP * 2.4);
    legBackLift = sinP < 0 ? Math.round(-sinP * 1.6) : 0;
    legFrontLift = sinP > 0 ? Math.round(sinP * 1.6) : 0;
  } else if (animState === 'idle') {
    bob = f === 1 || f === 2 ? -1 : 0;
    armSwing = f === 2 ? 1 : 0;
  } else if (animState === 'windup') {
    crouchY = 2;
    lungeX = -dir * 2;
    armSwing = -3;
  } else if (animState === 'attack') {
    const af = frame % 3;
    lungeX = af === 1 ? dir * 4 : dir * 2;
    bob = af === 1 ? -1 : 0;
    stride = dir * 2;
    armSwing = af === 1 ? 4 : 2;
  }

  const lean =
    (kind === 'runner' ? dir * 2 : kind === 'spitter' ? dir : 0) + lungeX;

  let skin = '#d6ac88';
  let skinShadow = '#9e7454';
  let shirt = '#455b42';
  let shirtHi = '#607d5b';
  let shirtDark = '#293727';
  let pants = '#323b45';
  let pantsHi = '#44505e';
  const boots = '#1b1614';
  const bootHi = '#382d28';
  let headColor = '#3a2b22';
  let eyeColor = '#17191c';

  if (kind === 'walker') {
    skin = '#7d9478';
    skinShadow = '#4e634a';
    shirt = '#614a42';
    shirtHi = '#7a5d54';
    shirtDark = '#3a2b26';
    pants = '#2b3036';
    pantsHi = '#3a414a';
    headColor = '#6f856b';
    eyeColor = animState === 'windup' || animState === 'attack' ? '#ff594f' : '#c94038';
  } else if (kind === 'runner') {
    skin = '#99706c';
    skinShadow = '#5e3f3d';
    shirt = '#7f2c2c';
    shirtHi = '#a63d3d';
    shirtDark = '#4a1717';
    pants = '#202329';
    pantsHi = '#323740';
    headColor = '#875f5b';
    eyeColor = '#ff4a3d';
  } else if (kind === 'bloater') {
    skin = '#6f8c49';
    skinShadow = '#44592a';
    shirt = '#485435';
    shirtHi = '#627349';
    shirtDark = '#2a331e';
    pants = '#2d3326';
    pantsHi = '#3f4736';
    headColor = '#668242';
    eyeColor = '#c4f24b';
  } else if (kind === 'spitter') {
    skin = '#5f8782';
    skinShadow = '#385451';
    shirt = '#38464d';
    shirtHi = '#4e626b';
    shirtDark = '#20292e';
    pants = '#21262b';
    pantsHi = '#313840';
    headColor = '#557d78';
    eyeColor = '#6ef7be';
  }

  // Legs + knee articulation + laced combat boots
  const legBackX = (facingRight ? cx - 4 : cx + 1) + stride + Math.floor(lungeX * 0.4);
  const legFrontX = (facingRight ? cx + 1 : cx - 4) - stride + Math.floor(lungeX * 0.4);
  const legBackY = groundY - 9 - legBackLift;
  const legFrontY = groundY - 8 - legFrontLift;

  // Back leg
  px(ctx, legBackX, legBackY, '#101214', 4, 8);
  px(ctx, legBackX + 1, legBackY, pants, 2, 5);
  px(ctx, legBackX + (facingRight ? 0 : -1), legBackY + 5, boots, 4, 3);
  px(ctx, legBackX + 1, legBackY + 5, bootHi, 2, 1);

  // Front leg
  px(ctx, legFrontX, legFrontY, '#101214', 4, 8);
  px(ctx, legFrontX + 1, legFrontY, pantsHi, 2, 5);
  px(ctx, legFrontX + (facingRight ? 0 : -1), legFrontY + 5, boots, 4, 3);
  px(ctx, legFrontX + 1, legFrontY + 5, bootHi, 2, 1);

  // Torso dimensions
  const torsoW = isBloater ? 14 : 9;
  const torsoH = isBloater ? 13 : 11;
  const tx = cx - Math.floor(torsoW / 2) + Math.floor(lean * 0.5);
  const ty = groundY - 19 + bob + crouchY;

  // Player rucksack behind shoulder when facing toward camera
  if (kind === 'player' && !facingUp) {
    const bx = facingRight ? tx - 4 : tx + torsoW;
    px(ctx, bx, ty + 1, '#14110e', 4, 9);
    px(ctx, bx + (facingRight ? 1 : 0), ty + 2, '#69523b', 3, 7);
    px(ctx, bx + (facingRight ? 1 : 0), ty + 3, '#8a6d50', 2, 3);
    px(ctx, bx + (facingRight ? 1 : 0), ty, '#948358', 3, 1); // sleeping roll top
  }

  // Back arm (animated swing)
  const backArmX = cx - dir * (isBloater ? 8 : 5) + Math.floor(lean * 0.4) - dir * Math.floor(armSwing * 0.5);
  const backArmY = ty + 2 - (animState === 'windup' ? 3 : 0);
  px(ctx, backArmX, backArmY, '#101214', 3, 7);
  px(ctx, backArmX + 1, backArmY + 1, kind === 'player' ? shirtDark : skinShadow, 2, 4);
  px(ctx, backArmX + 1, backArmY + 5, kind === 'player' ? skinShadow : '#8f2424', 2, 2);

  // Main outlined torso with directional shading & clothing details
  px(ctx, tx, ty - 1, '#101215', torsoW, 1);
  px(ctx, tx - 1, ty, '#101215', torsoW + 2, torsoH);
  px(ctx, tx, ty + torsoH, '#101215', torsoW, 1);
  px(ctx, tx, ty, shirt, torsoW, torsoH);
  px(ctx, facingRight ? tx : tx + Math.ceil(torsoW / 2), ty, shirtDark, Math.floor(torsoW / 2), torsoH);
  px(ctx, tx + (facingRight ? 3 : 1), ty, shirtHi, Math.max(3, torsoW - 4), 3);

  if (kind === 'player') {
    // Tactical belt, brass buckle, chest harness & collar scarf
    px(ctx, tx, ty + torsoH - 2, '#241c16', torsoW, 2);
    px(ctx, tx + (facingRight ? torsoW - 3 : 2), ty + torsoH - 2, '#d4af55', 2, 1);
    px(ctx, tx + 1, ty, '#7a5438', torsoW - 2, 2); // collar scarf
    if (!facingUp) {
      px(ctx, tx + (facingRight ? 2 : torsoW - 3), ty + 2, '#5c4632', 1, 6); // chest sling strap
      px(ctx, tx + (facingRight ? torsoW - 3 : 1), ty + 3, '#344532', 2, 3); // chest pocket
    } else {
      // Full 3D tactical rucksack + canteen + bedroll when facing away
      const packX = tx + 1;
      px(ctx, packX - 1, ty + 1, '#14110e', 9, 9);
      px(ctx, packX, ty + 2, '#6b553d', 7, 7);
      px(ctx, packX + 1, ty + 3, '#8a6f51', 5, 3);
      px(ctx, packX + 1, ty + 7, '#4a3a29', 5, 2);
      px(ctx, packX, ty, '#9e8a58', 7, 2); // rolled tarp
      px(ctx, packX + 6, ty + 6, '#75828a', 2, 3); // steel canteen
    }
  } else {
    // Tattered clothes & grotesque infected anatomy
    px(ctx, tx + 1, ty + torsoH, shirtDark, 2, 1);
    px(ctx, tx + torsoW - 3, ty + torsoH, shirt, 2, 1);
    if (kind === 'walker' && !facingUp) {
      // Exposed rib / bloodstain
      px(ctx, tx + 2, ty + 3, '#9c2c2c', 4, 4);
      px(ctx, tx + 3, ty + 4, '#d9cdb8', 2, 1);
      px(ctx, tx + 3, ty + 6, '#d9cdb8', 2, 1);
    }
    if (kind === 'bloater') {
      const pulse = frame % 2 === 0;
      px(ctx, tx - 1, ty + 3, '#536b34', 2, 7);
      px(ctx, tx + torsoW - 1, ty + 4, '#3b4d24', 2, 6);
      px(ctx, tx + 2, ty + 3, pulse ? '#c8ff59' : '#9ed93b', 4, 4);
      px(ctx, tx + 3, ty + 4, '#f0ffb8', 2, 2);
      px(ctx, tx + 8, ty + 6, pulse ? '#b8f04f' : '#85bd2c', 4, 3);
    }
    if (kind === 'spitter') {
      const glow = animState === 'windup' || frame % 2 === 1;
      px(ctx, cx + dir, ty + 1, glow ? '#8affd4' : '#5ef2b5', 4, 4);
      px(ctx, cx + dir * 2, ty + 2, '#e3fff4', 2, 2);
      if (facingUp) {
        px(ctx, cx - 1, ty + 2, '#6ef7be', 2, 6); // glowing dorsal spines
      }
    }
  }

  // Head & expressive facial silhouette (hood/goggles for player, glowing eyes/jaw for zombies)
  const headW = isBloater ? 9 : 8;
  const headH = 8;
  const hy = ty - headH + (kind === 'runner' ? 2 : kind === 'bloater' ? 1 : 0);
  const hx = cx - Math.floor(headW / 2) + lean;

  px(ctx, hx + 1, hy - 1, '#101215', headW - 2, 1);
  px(ctx, hx, hy, '#101215', headW, headH);
  px(ctx, hx + 1, hy + headH, '#101215', headW - 2, 1);
  px(ctx, hx + 1, hy + 1, kind === 'player' ? skin : headColor, headW - 2, headH - 1);
  px(ctx, hx + (facingRight ? 1 : headW - 3), hy + 2, skinShadow, 2, 5);

  if (kind === 'player') {
    // Survivor hood/cap + brim + glowing amber tactical goggles
    px(ctx, hx + 1, hy, '#4b5940', headW - 2, 3);
    px(ctx, hx + 2, hy, '#637555', headW - 4, 1);
    if (facingUp) {
      px(ctx, hx + 1, hy + 2, '#343e2c', headW - 2, 4);
      px(ctx, hx + 2, hy + 6, '#7a5438', headW - 4, 2); // scarf wrap
    } else {
      px(ctx, hx + (facingRight ? 2 : 0), hy + 2, '#2d3626', headW - 2, 1); // cap brim
      // Amber tactical visor goggles
      const gx = hx + (facingRight ? 3 : 1);
      px(ctx, gx, hy + 3, '#1e2226', 4, 2);
      px(ctx, gx + (facingRight ? 1 : 0), hy + 3, '#e89b38', 2, 1);
      px(ctx, gx + (facingRight ? 2 : 1), hy + 3, '#ffd98a', 1, 1);
      // Scarf mouth mask
      px(ctx, hx + 2, hy + 6, '#7a5438', headW - 4, 2);
    }
  } else if (!facingUp) {
    // Sunken glowing eyes + gaping bloody jaw
    const ex = hx + (facingRight ? headW - 3 : 2);
    px(ctx, ex, hy + 3, eyeColor, 1, 1);
    px(ctx, ex - dir * 2, hy + 3, eyeColor, 1, 1);
    const mouthOpen = animState === 'attack' || animState === 'windup' ? 2 : 1;
    px(ctx, hx + (facingRight ? 3 : 2), hy + 5, '#6e1616', 3, mouthOpen);
    if (animState === 'attack') {
      px(ctx, hx + (facingRight ? 4 : 2), hy + 5, '#e8dfd1', 1, 1); // teeth glint
    }
  } else {
    px(ctx, hx + 2, hy + 1, skinShadow, headW - 4, 5);
  }

  // Foreground articulated arm (animated swing / windup raise / attack slash)
  if (kind !== 'player') {
    const reach = animState === 'attack' ? 4 : animState === 'windup' ? -1 : Math.floor(armSwing * 0.5);
    const armY = ty + 2 + (animState === 'windup' ? -3 : f === 2 ? 1 : 0) - (facingUp ? 1 : 0);
    const armX = facingRight
      ? cx + 3 + Math.floor(lean * 0.5) + reach
      : cx - 9 + Math.floor(lean * 0.5) - reach;
    px(ctx, armX, armY, '#101215', 7, 4);
    px(ctx, armX + 1, armY + 1, skin, 5, 2);
    px(ctx, armX + (facingRight ? 5 : 1), armY + 1, '#a82828', 1, 2); // bloodied claws
  } else {
    const frontArmX = cx + (facingRight ? 2 : -5) + Math.floor(lean * 0.5) + dir * Math.floor(armSwing * 0.4);
    const frontArmY = ty + (facingUp ? 1 : 2) + (animState === 'attack' ? -1 : 0);
    px(ctx, frontArmX, frontArmY, '#101215', 4, 5);
    px(ctx, frontArmX + 1, frontArmY + 1, shirtHi, 2, 3);
    px(ctx, frontArmX + (facingRight ? 2 : 1), frontArmY + 3, skin, 2, 2);
  }

  return c;
}

/**
 * Builds true 2:1 isometric player-built structures (barricade, spike_trap, campfire).
 */
function buildStructureSprite(kind: StructureKind, frame = 0): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(32, 34);
  const plot = makeIsoPlotter(ctx, 32, 34, 16, 23);

  if (kind === 'barricade') {
    for (let u = -7; u <= 7; u++) {
      for (let v = -5; v <= 5; v++) {
        plot(u, v, 0, 'rgba(8, 10, 12, 0.45)');
      }
    }
    for (let z = 1; z <= 5; z++) {
      for (let u = -6; u <= 6; u++) {
        for (let v = -3; v <= 3; v++) {
          const bagSeam = (u + 6) % 4 === 0 || z === 3;
          const isEdge = Math.abs(u) === 6 || Math.abs(v) === 3 || z === 5;
          if (!isEdge) continue;
          let col = '#6e624d';
          if (bagSeam) col = '#453d2e';
          else if (z === 5) col = '#82745b';
          else if (v === 3) col = '#756851';
          else col = '#544a39';
          plot(u, v, z, col);
        }
      }
    }
    for (let z = 3; z <= 13; z++) {
      for (const postU of [-5, 0, 5]) {
        plot(postU, 0, z, '#7d5536');
        plot(postU, 1, z, '#593b24');
      }
      if (z === 7 || z === 8 || z === 11 || z === 12) {
        for (let u = -6; u <= 6; u++) {
          plot(u, 1, z, z % 2 === 0 ? '#9c6e46' : '#734f30');
          plot(u, 2, z, '#523721');
        }
      }
    }
    for (const nu of [-5, 0, 5]) {
      plot(nu, 1, 14, '#adb5bd');
      plot(nu, 1, 15, '#dee2e6');
    }
    return c;
  }

  if (kind === 'spike_trap') {
    for (let u = -6; u <= 6; u++) {
      for (let v = -6; v <= 6; v++) {
        plot(u, v, 0, 'rgba(8, 10, 12, 0.38)');
        const onBeam = Math.abs(u) <= 1 || Math.abs(v) <= 1 || Math.abs(u) >= 5 || Math.abs(v) >= 5;
        if (!onBeam) continue;
        plot(u, v, 1, v > u ? '#543b27' : '#382618');
        plot(u, v, 2, (u + v) % 2 === 0 ? '#735238' : '#5e422c');
      }
    }
    const spikeCoords: Array<[number, number]> = [
      [-4, -4], [0, -4], [4, -4],
      [-4, 0],  [0, 0],  [4, 0],
      [-4, 4],  [0, 4],  [4, 4],
    ];
    for (const [su, sv] of spikeCoords) {
      for (let z = 3; z <= 8; z++) {
        const col = z >= 7 ? '#b02a24' : z >= 5 ? '#d0d7de' : '#6e7781';
        plot(su, sv, z, col);
        if (z <= 5) plot(su, sv + 1, z, '#424a53');
      }
    }
    return c;
  }

  for (let u = -6; u <= 6; u++) {
    for (let v = -6; v <= 6; v++) {
      const r2 = u * u + v * v;
      if (r2 <= 38) {
        plot(u, v, 0, r2 <= 18 ? '#1f140e' : 'rgba(10, 8, 6, 0.48)');
      }
      if (r2 <= 12) {
        plot(u, v, 1, (u + v + frame) % 2 === 0 ? '#e86a24' : '#b83718');
      }
      if (r2 >= 15 && r2 <= 32) {
        const stoneIdx = Math.floor((Math.atan2(v, u) + Math.PI) * 3.5);
        if (stoneIdx % 2 === 0) {
          plot(u, v, 1, '#3d4145');
          plot(u, v, 2, v > u ? '#6c737a' : '#4d5257');
          if (r2 <= 24) plot(u, v, 3, '#838b91');
        }
      }
    }
  }
  for (let i = -4; i <= 4; i++) {
    plot(i, 0, 2, '#5c3c24');
    plot(i, 0, 3, '#785032');
    plot(0, i, 2, '#4a301c');
    plot(0, i, 3, '#694429');
  }

  const flicker = frame % 4;
  const flameH = flicker === 0 ? 10 : flicker === 1 ? 12 : flicker === 2 ? 9 : 11;
  for (let z = 3; z < 3 + flameH; z++) {
    const prog = (z - 3) / flameH;
    const rad = Math.max(0, Math.round((1 - prog) * 3));
    const sway = z > 7 ? (flicker === 1 ? -1 : flicker === 3 ? 1 : 0) : 0;
    for (let u = -rad; u <= rad; u++) {
      for (let v = -rad; v <= rad; v++) {
        if (u * u + v * v > rad * rad + 1) continue;
        const col = prog < 0.3 ? '#fff3b0' : prog < 0.68 ? '#f79520' : '#d64527';
        plot(u + sway, v, z, col);
      }
    }
  }
  return c;
}

/**
 * Animated scavenger pack loot drop with 4-frame metallic buckle shimmer.
 */
function buildLootDropSprite(frame = 0): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(22, 20);
  const plot = makeIsoPlotter(ctx, 22, 20, 11, 14);
  for (let u = -4; u <= 4; u++) {
    for (let v = -3; v <= 3; v++) {
      plot(u, v, 0, 'rgba(6, 8, 10, 0.45)');
    }
  }
  const buckle = frame % 4 === 1 ? '#fff2b0' : '#f0c44d';
  for (let z = 1; z <= 5; z++) {
    for (let u = -3; u <= 3; u++) {
      for (let v = -2; v <= 2; v++) {
        const isRim = z === 1 || Math.abs(u) === 3 || Math.abs(v) === 2;
        const isTop = z === 5;
        const isStrap = u === -1 || u === 1;
        let col = '#4f6145';
        if (isRim && z === 1) col = '#1b2118';
        else if (isStrap) col = z === 3 && v === 2 ? buckle : '#2b241d';
        else if (isTop) col = u === 0 ? '#857853' : '#6c805e';
        else if (v === 2) col = '#5a6e4e';
        else col = '#384531';
        plot(u, v, z, col);
      }
    }
  }
  return c;
}

export class PixelArtAtlas {
  private tiles = new Map<string, HTMLCanvasElement>();
  private props = new Map<string, HTMLCanvasElement>();
  private lootContainers = new Map<string, HTMLCanvasElement>();
  private walls = new Map<string, HTMLCanvasElement>();
  private doors = new Map<string, HTMLCanvasElement>();
  private vehicles = new Map<string, HTMLCanvasElement>();
  private structures = new Map<string, HTMLCanvasElement>();
  private barrels: HTMLCanvasElement[] = [];
  private chars = new Map<string, HTMLCanvasElement>();
  private weaponIcons = new Map<WeaponId, HTMLCanvasElement>();
  private lootDrops: HTMLCanvasElement[] = [];

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
    ];
    for (const kind of tileKinds) {
      for (let v = 0; v < 4; v++) {
        this.tiles.set(`${kind}_${v}`, buildIsoTile(kind, v));
      }
    }

    // Static environment & interior furniture props
    this.props.set('tree_pine', buildTreeSprite(false));
    this.props.set('tree_dead', buildTreeSprite(true));
    this.props.set('streetlamp', buildStreetlampSprite());
    this.props.set('dumpster', buildIsoObjectSprite('dumpster'));
    this.props.set('concrete_barrier', buildIsoObjectSprite('concrete_barrier'));
    this.props.set('counter', buildIsoObjectSprite('counter'));
    this.props.set('bench', buildIsoObjectSprite('bench'));
    this.props.set('hydrant', buildIsoObjectSprite('hydrant'));
    this.props.set('stove', buildIsoObjectSprite('stove'));
    this.props.set('fishing_post', buildIsoObjectSprite('fishing_post'));
    this.props.set('bed', buildIsoObjectSprite('bed'));
    this.props.set('couch', buildIsoObjectSprite('couch'));
    this.props.set('table', buildIsoObjectSprite('table'));
    this.props.set('bookshelf', buildIsoObjectSprite('bookshelf'));
    this.props.set('desk', buildIsoObjectSprite('desk'));
    this.props.set('sink_toilet', buildIsoObjectSprite('sink_toilet'));
    this.props.set('tv_stand', buildIsoObjectSprite('tv_stand'));

    for (const ori of ['ns', 'ew'] as const) {
      for (const st of ['closed', 'open', 'locked', 'barricaded'] as const) {
        this.doors.set(`${ori}_${st}`, buildDoorSprite(ori, st));
      }
    }

    for (let f = 0; f < 4; f++) {
      this.barrels.push(buildBurnBarrelSprite(f));
      this.lootDrops.push(buildLootDropSprite(f));
    }

    // 16 smooth rotation angles for drivable vehicles
    for (let ang = 0; ang < 16; ang++) {
      this.vehicles.set(`sedan_${ang}_0`, buildVehicleSprite(false, ang, false, 0));
      this.vehicles.set(`sedan_${ang}_1`, buildVehicleSprite(false, ang, true, 0));
      this.vehicles.set(`police_${ang}_0_0`, buildVehicleSprite(true, ang, false, 0));
      this.vehicles.set(`police_${ang}_0_1`, buildVehicleSprite(true, ang, false, 1));
      this.vehicles.set(`police_${ang}_1_0`, buildVehicleSprite(true, ang, true, 0));
      this.vehicles.set(`police_${ang}_1_1`, buildVehicleSprite(true, ang, true, 1));
    }

    this.structures.set('barricade_0', buildStructureSprite('barricade', 0));
    this.structures.set('spike_trap_0', buildStructureSprite('spike_trap', 0));
    for (let f = 0; f < 4; f++) {
      this.structures.set(`campfire_${f}`, buildStructureSprite('campfire', f));
    }
  }

  getLootDrop(frame = 0): HTMLCanvasElement {
    return this.lootDrops[frame % 4];
  }

  getTile(kind: TileKind, variant: number): HTMLCanvasElement {
    return this.tiles.get(`${kind}_${variant % 4}`)!;
  }

  getWall(kind: 'wall_brick' | 'wall_wood' | 'wall_interior', mask: number, variant: number): HTMLCanvasElement {
    const key = `${kind}_${mask}_${variant % 4}`;
    let cached = this.walls.get(key);
    if (!cached) {
      cached = buildWallSprite(kind, mask, variant % 4);
      this.walls.set(key, cached);
    }
    return cached;
  }

  getDoor(orientation: 'ns' | 'ew', status: 'closed' | 'open' | 'locked' | 'barricaded'): HTMLCanvasElement {
    return this.doors.get(`${orientation}_${status}`)!;
  }

  getProp(
    kind: PropKind,
    searched = false,
    frame = 0,
    openStage?: number
  ): HTMLCanvasElement | undefined {
    if (kind === 'barrel_burn') {
      return this.barrels[frame % 4];
    }
    if (
      kind === 'crate_wood' ||
      kind === 'crate_military' ||
      kind === 'fridge' ||
      kind === 'med_cabinet'
    ) {
      const stage = openStage !== undefined ? Math.max(0, Math.min(3, openStage)) : searched ? 3 : 0;
      const idleF = stage === 0 ? frame % 4 : 0;
      const key = `${kind}_${stage}_${idleF}`;
      let cached = this.lootContainers.get(key);
      if (!cached) {
        cached = buildLootContainerSprite(kind, stage, idleF);
        this.lootContainers.set(key, cached);
      }
      return cached;
    }
    return this.props.get(kind);
  }

  getVehicle(kind: 'sedan' | 'police', angleRad: number, searched = false, sirenFrame = 0): HTMLCanvasElement {
    const norm = ((angleRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const idx = Math.round((norm / (Math.PI * 2)) * 16) % 16;
    if (kind === 'sedan') {
      return this.vehicles.get(`sedan_${idx}_${searched ? 1 : 0}`)!;
    }
    return this.vehicles.get(`police_${idx}_${searched ? 1 : 0}_${sirenFrame % 2}`)!;
  }

  getStructure(kind: StructureKind, frame: number): HTMLCanvasElement {
    const f = kind === 'campfire' ? frame % 4 : 0;
    return this.structures.get(`${kind}_${f}`)!;
  }

  getCharacter(
    kind: 'player' | ZombieArchetype,
    frame: number,
    facingRight: boolean,
    facingUp = false,
    animState: CharacterAnimState = 'walk'
  ): HTMLCanvasElement {
    const dir = facingRight ? 'R' : 'L';
    const vert = facingUp ? 'U' : 'D';
    const f = animState === 'walk' ? frame % 8 : frame % 4;
    const key = `${kind}_${animState}_${f}_${dir}_${vert}`;
    let cached = this.chars.get(key);
    if (!cached) {
      cached = buildCharacterSprite(kind, animState, f, facingRight, facingUp);
      this.chars.set(key, cached);
    }
    return cached;
  }

  getWeaponSprite(weapon: WeaponId): HTMLCanvasElement {
    let cached = this.weaponIcons.get(weapon);
    if (cached) return cached;
    const [c, ctx] = makeCanvas(20, 20);
    if (weapon === 'crowbar') {
      for (let i = 0; i < 12; i++) {
        px(ctx, 3 + i, 15 - i, '#212529', 3, 3);
        px(ctx, 4 + i, 15 - i, '#7a848c', 2, 2);
      }
      px(ctx, 13, 2, '#c94138', 4, 3);
      px(ctx, 15, 3, '#eb655b', 2, 1);
      px(ctx, 2, 14, '#c94138', 3, 2);
    } else if (weapon === 'pistol') {
      px(ctx, 4, 7, '#181c20', 11, 4);
      px(ctx, 5, 8, '#66717a', 9, 2);
      px(ctx, 5, 9, '#394047', 8, 1);
      px(ctx, 5, 10, '#22262b', 3, 5);
      px(ctx, 8, 10, '#444b52', 2, 2);
    } else if (weapon === 'shotgun') {
      px(ctx, 2, 9, '#1b1714', 16, 4);
      px(ctx, 2, 10, '#784c2d', 5, 3);
      px(ctx, 6, 8, '#5a636b', 12, 2);
      px(ctx, 10, 10, '#633f25', 5, 2);
      px(ctx, 17, 8, '#8d98a3', 1, 1);
    } else if (weapon === 'machete') {
      for (let i = 0; i < 11; i++) {
        px(ctx, 4 + i, 15 - i, '#212529', 3, 3);
        px(ctx, 5 + i, 15 - i, '#b8c4c9', 2, 2);
      }
      px(ctx, 3, 14, '#6e4a2e', 3, 3);
    } else if (weapon === 'barbed_bat') {
      for (let i = 0; i < 12; i++) {
        px(ctx, 3 + i, 15 - i, '#212529', 3, 3);
        px(ctx, 4 + i, 15 - i, i > 5 ? '#a87447' : '#3a332d', 2, 2);
      }
      px(ctx, 11, 6, '#d4dde0', 2, 1);
      px(ctx, 13, 4, '#d4dde0', 2, 1);
    } else if (weapon === 'axe') {
      for (let i = 0; i < 11; i++) {
        px(ctx, 3 + i, 15 - i, '#8f5f39', 2, 2);
      }
      px(ctx, 12, 3, '#c94138', 5, 4);
      px(ctx, 15, 5, '#dce4e8', 2, 2);
    } else if (weapon === 'sledgehammer') {
      for (let i = 0; i < 11; i++) {
        px(ctx, 3 + i, 15 - i, '#6b4628', 2, 2);
      }
      px(ctx, 11, 2, '#4f5961', 6, 5);
      px(ctx, 12, 3, '#98a3ab', 4, 2);
    } else {
      px(ctx, 8, 8, '#1e2b18', 5, 8);
      px(ctx, 9, 9, '#63914e', 3, 6);
      px(ctx, 10, 10, '#91c777', 1, 4);
      px(ctx, 10, 5, '#e6dcc8', 1, 3);
      px(ctx, 9, 2, '#f59e27', 3, 3);
      px(ctx, 10, 1, '#fff2b0', 1, 2);
    }
    this.weaponIcons.set(weapon, c);
    return c;
  }
}

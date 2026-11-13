import { TILE_H, TILE_W } from './isometric';
import type { PropKind, StructureKind, TileKind, WeaponId, ZombieArchetype } from './types';

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
        if (variant === 3 && r < 0.04) col = '#697848'; // dry weed tuft
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
        // Road paint stripes / asphalt cracks
        if (kind === 'road') {
          if (variant === 0 && y === 7 && x >= 11 && x <= 20) col = '#8c7a3e';
          if (variant === 2 && ((x === 15 && y >= 5 && y <= 10) || (x === 16 && y >= 7 && y <= 11))) {
            col = '#14171a';
          }
        } else {
          // Isometric zebra crosswalk bars
          const u = (x - cx) * 0.5 + (y - cy);
          const bar = Math.floor(u + 16) % 5;
          if (bar >= 1 && bar <= 2 && Math.abs(x - cx) < 11) {
            col = r < 0.18 ? '#6e7275' : '#9ca1a3';
          }
        }
      } else if (kind === 'sidewalk') {
        const isBorder = dx + dy > 0.86;
        const slabJoint = ((x + y * 2) % 12 === 0);
        if (isBorder) {
          col = y < cy ? '#62696e' : '#32363a';
        } else if (slabJoint) {
          col = '#2d3136';
        } else if (r < 0.25) {
          col = '#52585e';
        } else if (r < 0.75) {
          col = '#464b50';
        } else {
          col = '#3d4146';
        }
        if (variant === 2 && slabJoint && r > 0.72) col = '#425433'; // sidewalk crack moss
      } else if (kind === 'floor') {
        const plank = (x + y * 2) % 4 === 0;
        if (plank) col = '#30251d';
        else if (r < 0.25) col = '#5a493c';
        else if (r < 0.75) col = '#4b3b30';
        else col = '#3f3127';
      } else if (kind === 'tile_clinic') {
        const u = Math.floor(((x - cx) * 0.5 + (y - cy) + 20) / 4);
        const v = Math.floor(((cx - x) * 0.5 + (y - cy) + 20) / 4);
        const grout = ((x + y * 2) % 4 === 0) || ((x - y * 2 + 32) % 4 === 0);
        if (grout) col = '#4f5a57';
        else col = (u + v) % 2 === 0 ? (r < 0.18 ? '#7b8783' : '#8b9994') : (r < 0.2 ? '#6e7a76' : '#7c8a85');
        if (variant === 3 && r > 0.9) col = '#57322e'; // faint dried stain
      } else if (kind === 'tile_diner') {
        const u = Math.floor(((x - cx) * 0.5 + (y - cy) + 20) / 4);
        const v = Math.floor(((cx - x) * 0.5 + (y - cy) + 20) / 4);
        const even = (u + v) % 2 === 0;
        col = even ? (r < 0.2 ? '#8f8a80' : '#a39d92') : (r < 0.2 ? '#292c30' : '#35393e');
      } else if (kind === 'water') {
        const wave = ((x + y * 2 + variant) % 7 === 0) && r < 0.45;
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
 * with concrete parapet coping, continuous brick/plank courses, boarded windows, and ambient occlusion.
 */
function buildWallSprite(
  kind: 'wall_brick' | 'wall_wood',
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

  // Ground contact ambient occlusion shadow along bottom edges
  ctx.fillStyle = 'rgba(7, 9, 11, 0.36)';
  for (let x = 0; x < 32; x++) {
    const botY = 11 + Math.floor((16 - Math.abs(x + 0.5 - 16)) * 0.5) + 18;
    if (botY + 1 < h) ctx.fillRect(x, botY + 1, 1, 2);
  }

  const hasWindow = variant === 2 && ((hasE && hasW) || (hasN && hasS));

  for (let x = 0; x < 32; x++) {
    const isLeft = x < 16;
    const chip =
      variant === 1 && !hasN && !hasS && (x === 6 || x === 7 || x === 24 || x === 25)
        ? 2
        : variant === 3 && (x === 14 || x === 17)
          ? 1
          : 0;

    for (let y = 0; y < h; y++) {
      // Top cap diamond (parapet / coping) centered at (16, 10 + chip)
      const tdx = Math.abs(x + 0.5 - 16) / 16;
      const tdy = Math.abs(y + 0.5 - (10 + chip)) / 8;
      if (tdx + tdy <= 1.0 && y >= 2 + chip) {
        const edgeNW = x < 16 && y < 10 + chip && tdx + tdy > 0.85;
        const edgeNE = x >= 16 && y < 10 + chip && tdx + tdy > 0.85;
        const edgeSW = x < 16 && y >= 10 + chip && tdx + tdy > 0.85;
        const edgeSE = x >= 16 && y >= 10 + chip && tdx + tdy > 0.85;

        const isOuterCapEdge =
          (edgeNW && !hasW) || (edgeNE && !hasN) || (edgeSW && !hasS) || (edgeSE && !hasE);

        if (kind === 'wall_brick') {
          if (isOuterCapEdge) ctx.fillStyle = '#4f4a48'; // stone coping bevel
          else ctx.fillStyle = (x + y) % 4 === 0 ? '#6e6560' : '#5e5652';
        } else {
          if (isOuterCapEdge) ctx.fillStyle = '#402f22';
          else ctx.fillStyle = (x + y) % 2 === 0 ? '#6b4e37' : '#59402c';
        }
        ctx.fillRect(x, y, 1, 1);
      }

      // Exposed SW (x < 16) and SE (x >= 16) vertical wall faces
      const frontTopY = 10 + chip + Math.floor((16 - Math.abs(x + 0.5 - 16)) * 0.5);
      const frontBotY = 10 + Math.floor((16 - Math.abs(x + 0.5 - 16)) * 0.5) + 18;

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

        // Boarded-up window cutout on select continuous spans
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
          // Stone parapet trim at top 2px + corner quoining blocks on exposed ends
          const isQuoin =
            ((!hasW && x >= 1 && x <= 4) || (!hasE && x >= 27 && x <= 30) || (!hasS && x >= 13 && x <= 18)) &&
            Math.floor(relY / 3) % 2 === 0;
          if (relY <= 2) {
            ctx.fillStyle = isLeft ? '#756e6a' : '#524c49';
            ctx.fillRect(x, y, 1, 1);
            continue;
          }
          if (relY >= 16) {
            // Isometric stone plinth baseboard
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
          // Base grime & creeping moss
          if (relY > 13 && (x + relY) % 3 === 0) {
            ctx.fillStyle = isLeft ? '#3a4a2e' : '#293621';
          }
        } else {
          // Timber plank wall with top beam, corner post, iron nailheads & diagonal brace
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

  // True 2:1 isometric elliptical ground shadow + root flare
  for (let u = -7; u <= 7; u++) {
    for (let v = -7; v <= 7; v++) {
      if (u * u + v * v <= 42) {
        plot(u + 1, v + 1, 0, 'rgba(8, 10, 12, 0.46)');
      }
    }
  }
  // 3D isometric roots & trunk column
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

  // Layered 2:1 isometric pine bough tiers with NW sunlit top-left & SE shaded bottom-right
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
  // 2:1 Isometric cast-iron octagonal pedestal base
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
  // Isometric cantilevered arm extending along +u (SE screen-right/down)
  px(ctx, 14, 10, '#394047', 4, 2);
  px(ctx, 17, 11, '#49525c', 4, 2);
  px(ctx, 19, 12, '#1f2328', 5, 2);
  px(ctx, 20, 14, '#f5c258', 3, 2);
  px(ctx, 21, 14, '#fff2b8', 1, 1);
  return c;
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
 * Builds true 2:1 isometric survival objects (crates, lockers, fridges, med cabinets, dumpsters, barriers, counters, benches, hydrants, fire barrels).
 */
function buildIsoObjectSprite(
  kind:
    | 'crate_wood'
    | 'crate_military'
    | 'fridge'
    | 'med_cabinet'
    | 'dumpster'
    | 'concrete_barrier'
    | 'counter'
    | 'bench'
    | 'hydrant'
    | 'stove'
    | 'fishing_post',
  searched = false
): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(32, 34);
  const plot = makeIsoPlotter(ctx, 32, 34, 16, 23);

  const drawBox = (
    uMin: number,
    uMax: number,
    vMin: number,
    vMax: number,
    zMin: number,
    zMax: number,
    shader: (u: number, v: number, z: number, face: 'top' | 'left' | 'right', edge: boolean) => string | null
  ) => {
    // Contact shadow
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

  if (kind === 'crate_wood' || kind === 'crate_military') {
    const mil = kind === 'crate_military';
    const top = searched ? (mil ? '#4c5740' : '#73543b') : mil ? '#748759' : '#b88558';
    const left = searched ? (mil ? '#38402e' : '#573f2b') : mil ? '#546640' : '#8f643e';
    const right = searched ? (mil ? '#262b20' : '#3d2b1e') : mil ? '#3a472c' : '#634328';
    const trim = mil ? '#21261d' : '#382414';

    drawBox(-6, 6, -6, 6, 1, 10, (u, v, z, face, edge) => {
      if (face === 'top' && searched && Math.abs(u) <= 4 && Math.abs(v) <= 4) {
        return '#121417';
      }
      if (edge) return trim;
      if (face === 'top') return top;
      if (mil && z === 6) return searched ? '#8a783a' : '#e0bd53';
      if (!mil && Math.abs(u - (z - 5)) <= 1 && face === 'left') return top;
      return face === 'left' ? left : right;
    });
    if (searched) {
      // Propped lid slab
      for (let u = -5; u <= 5; u++) {
        plot(u, -7, 12, trim);
        plot(u, -7, 13, top);
      }
    }
    return c;
  }

  if (kind === 'fridge' || kind === 'med_cabinet') {
    const isFridge = kind === 'fridge';
    const uLim = isFridge ? 5 : 4;
    const vLim = isFridge ? 5 : 4;
    const zTop = isFridge ? 18 : 14;
    const base = searched ? '#717876' : '#dce3df';
    const shade = searched ? '#535957' : '#b4bdb8';
    const dark = searched ? '#363b3a' : '#7e8783';

    drawBox(-uLim, uLim, -vLim, vLim, 1, zTop, (u, v, z, face, edge) => {
      if (edge) return '#1c2024';
      if (face === 'top') return base;
      if (face === 'left') {
        if (searched && Math.abs(u) <= uLim - 2 && z >= 3 && z <= zTop - 2) {
          return '#181c20';
        }
        if (isFridge && z === 12) return '#4e5559';
        if (isFridge && u === 3 && (z === 14 || z === 15 || z === 8 || z === 9)) return '#dfe6ea';
        if (!isFridge && ((Math.abs(u) <= 1 && z >= 5 && z <= 10) || (z >= 7 && z <= 8 && Math.abs(u) <= 2))) {
          return searched ? '#7d302b' : '#d13d34'; // Red cross emblem
        }
        return shade;
      }
      return dark;
    });
    return c;
  }

  if (kind === 'dumpster') {
    drawBox(-8, 8, -5, 5, 1, 10, (u, v, z, face, edge) => {
      if (edge) return '#161b18';
      if (face === 'top') return u < 0 ? '#1b2022' : '#35453b'; // open half-lid
      if (z >= 8) return '#222825'; // black plastic lid lip
      const rib = u % 4 === 0;
      if (face === 'left') return rib ? '#314737' : '#45634d';
      return rib ? '#223026' : '#2f4235';
    });
    return c;
  }

  if (kind === 'concrete_barrier') {
    drawBox(-8, 8, -3, 3, 1, 7, (u, v, z, face, edge) => {
      if (edge) return '#272a2e';
      if (face === 'top') return '#9ba1a6';
      const hazard = ((u + z + 16) % 6) < 2 && z >= 4;
      if (face === 'left') return hazard ? '#e3a63b' : z <= 2 ? '#595f63' : '#7f868a';
      return hazard ? '#a67624' : '#5e6369';
    });
    return c;
  }

  if (kind === 'counter') {
    drawBox(-7, 7, -4, 4, 1, 8, (u, v, z, face, edge) => {
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
    // Backrest slats
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
        // Burners & cast iron stovetop
        if ((Math.abs(u - 2) <= 1 && Math.abs(v - 2) <= 1) || (Math.abs(u + 2) <= 1 && Math.abs(v + 2) <= 1)) {
          return '#e66c2c'; // warm burner glow
        }
        return '#2e3338';
      }
      if (face === 'left') {
        if (z >= 3 && z <= 7 && Math.abs(u) <= 3) {
          return z === 7 ? '#d9dde0' : '#1b1f24'; // oven window & handle
        }
        return '#888f96';
      }
      return '#61686e';
    });
    // Stovetop simmering steel pot
    drawBox(-4, 0, -4, 0, 11, 14, (_u, _v, z, face, edge) => {
      if (edge) return '#1b1f24';
      if (face === 'top') return z === 14 ? '#adb5bd' : '#7c858e';
      return face === 'left' ? '#7a838c' : '#555c63';
    });
    return c;
  }

  if (kind === 'fishing_post') {
    // Timber dock piling + warm brass lantern
    drawBox(-2, 2, -2, 2, 1, 13, (_u, _v, z, face, edge) => {
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

  // Determine slab orientation: closed 'ew' runs along u (-7..7, v=-1..1), open swings perpendicular along v
  const isHorizontal = status === 'open' ? orientation === 'ns' : orientation === 'ew';
  const uMin = status === 'open' && orientation === 'ns' ? -7 : isHorizontal ? -7 : -1;
  const uMax = status === 'open' && orientation === 'ns' ? 5 : isHorizontal ? 7 : 1;
  const vMin = status === 'open' && orientation === 'ew' ? -7 : isHorizontal ? -1 : -7;
  const vMax = status === 'open' && orientation === 'ew' ? 5 : isHorizontal ? 1 : 7;

  // Threshold sill
  for (let i = -7; i <= 7; i++) {
    if (orientation === 'ew') plot(i, 0, 0, '#2c251f');
    else plot(0, i, 0, '#2c251f');
  }

  // Hinged door leaf
  drawPlankBox(uMin, uMax, vMin, vMax, 1, 17, (u, v, z, face, edge) => {
    if (edge) return '#1b140f';
    if (face === 'top') return '#6e4c32';
    const isLocked = status === 'locked';
    // Brass padlock / steel reinforcement plate on locked doors
    if (isLocked && z >= 7 && z <= 10 && Math.abs(isHorizontal ? u : v) <= 2) {
      return z === 9 ? '#f0c44d' : '#b88b28';
    }
    // Brass handle knob
    if (z >= 8 && z <= 9 && (isHorizontal ? u === 4 : v === 4)) {
      return '#e8c458';
    }
    const groove = isHorizontal ? u % 3 === 0 : v % 3 === 0;
    if (face === 'left') return groove ? '#593b25' : '#7a5437';
    return groove ? '#422b1a' : '#5c3e27';
  });

  // Barricaded cross-planks across closed door
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
  // Shadow
  for (let u = -5; u <= 5; u++) {
    for (let v = -5; v <= 5; v++) {
      if (u * u + v * v < 24) plot(u, v, 0, 'rgba(6, 8, 10, 0.45)');
    }
  }
  // Rusted cylindrical steel drum
  for (let z = 1; z <= 12; z++) {
    for (let u = -4; u <= 4; u++) {
      for (let v = -4; v <= 4; v++) {
        if (u * u + v * v > 20) continue;
        const rim = z === 1 || z === 6 || z === 12;
        const isTop = z === 12;
        let col = '#4a4e52';
        if (isTop) col = u * u + v * v < 10 ? '#d9571e' : '#26292c';
        else if (rim) col = '#25282b';
        else if ((u * 5 + z * 3) % 7 === 0) col = '#7a4024'; // rust band
        else if (v > u) col = '#5d6369';
        else col = '#35393d';
        plot(u, v, z, col);
      }
    }
  }
  // Animated pixel flames
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

  // Ground shadow
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

  // Lower chassis (h = 2..7)
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

        // Police cruiser crisp white doors & bumper stripe
        if (police && Math.abs(u) <= 5 && (Math.abs(v) === 6 || h === 7)) col = '#e8edf2';
        if (!police && ((u * 7 + v * 13 + h * 5) & 15) === 0) col = '#66341f';
        if (isEdge) col = trim;

        // Wheels & silver rims
        if (h <= 4 && (Math.abs(u - 7) <= 2 || Math.abs(u + 7) <= 2) && Math.abs(v) >= 5) {
          col = h === 3 && (Math.abs(u - 7) <= 1 || Math.abs(u + 7) <= 1) ? '#8d969e' : '#101214';
        }
        // Headlights & taillights
        if (h >= 4 && h <= 5 && u === 13 && Math.abs(v) >= 3 && Math.abs(v) <= 4) col = '#fff0a3';
        if (h >= 4 && h <= 5 && u === -13 && Math.abs(v) >= 3 && Math.abs(v) <= 4) col = '#eb4438';

        plotRotIso(u, v, h, col);
      }
    }
  }

  // Cabin & glass (h = 8..12)
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

function buildCharacterSprite(
  kind: 'player' | ZombieArchetype,
  frame: number,
  facingRight: boolean,
  facingUp = false
): HTMLCanvasElement {
  const w = kind === 'bloater' ? 28 : 24;
  const h = 32;
  const [c, ctx] = makeCanvas(w, h);
  const cx = Math.floor(w / 2);
  const dir = facingRight ? 1 : -1;

  // 2:1 Isometric elliptical contact shadow on the ground plane
  ctx.fillStyle = 'rgba(6, 8, 10, 0.52)';
  ctx.fillRect(cx - 6, 27, 12, 2);
  ctx.fillRect(cx - 4, 26, 8, 4);

  const stride = frame === 1 ? 2 : frame === 3 ? -2 : 0;
  const bob = frame === 1 || frame === 3 ? -1 : 0;
  const lean = kind === 'runner' ? dir * 2 : kind === 'spitter' ? dir : 0;

  let skin = '#d1a784';
  let skinShadow = '#9e7657';
  let shirt = '#455942';
  let shirtHi = '#5d7558';
  let shirtDark = '#2a3628';
  let pants = '#323a45';
  const boots = '#1c1816';
  let headColor = '#3a2b22';
  let eyeColor = '#17191c';

  if (kind === 'walker') {
    skin = '#7d9478';
    skinShadow = '#4f634b';
    shirt = '#5e4942';
    shirtHi = '#735a52';
    shirtDark = '#3a2b27';
    pants = '#2b3036';
    headColor = '#6f856b';
    eyeColor = '#c94038';
  } else if (kind === 'runner') {
    skin = '#946e6a';
    skinShadow = '#5c3f3d';
    shirt = '#7a2b2b';
    shirtHi = '#993a3a';
    shirtDark = '#4a1818';
    pants = '#212429';
    headColor = '#825d59';
    eyeColor = '#ff4a3d';
  } else if (kind === 'bloater') {
    skin = '#6f8c49';
    skinShadow = '#465c2c';
    shirt = '#485435';
    shirtHi = '#5e6e46';
    shirtDark = '#2c3620';
    pants = '#2e3326';
    headColor = '#668242';
    eyeColor = '#c4f24b';
  } else if (kind === 'spitter') {
    skin = '#5f8782';
    skinShadow = '#3a5754';
    shirt = '#38464d';
    shirtHi = '#4c5e66';
    shirtDark = '#212a2e';
    pants = '#22272b';
    headColor = '#557d78';
    eyeColor = '#5ef2b5';
  }

  // Isometric staggered legs: back leg is 1px higher on screen than front leg along 2:1 diagonal
  const legBackX = (facingRight ? cx - 3 : cx + 1) + stride;
  const legFrontX = (facingRight ? cx + 1 : cx - 3) - stride;
  const legBackY = 20 + (stride < 0 ? -1 : 0);
  const legFrontY = 21 + (stride > 0 ? 1 : 0);

  // Back leg
  px(ctx, legBackX, legBackY, '#121417', 3, 6);
  px(ctx, legBackX, legBackY, pants, 2, 4);
  px(ctx, legBackX + (facingRight ? 0 : -1), legBackY + 4, boots, 3, 2);

  // Front leg (closer to isometric camera)
  px(ctx, legFrontX, legFrontY, '#121417', 3, 6);
  px(ctx, legFrontX, legFrontY, pants, 2, 4);
  px(ctx, legFrontX + (facingRight ? 0 : -1), legFrontY + 4, boots, 3, 2);

  const torsoW = kind === 'bloater' ? 11 : 7;
  const torsoH = kind === 'bloater' ? 10 : 9;
  const tx = cx - Math.floor(torsoW / 2) + Math.floor(lean * 0.5);
  const ty = 12 + bob;

  // When facing towards camera (!facingUp), backpack sits behind the shoulder
  if (kind === 'player' && !facingUp) {
    const bx = facingRight ? tx - 3 : tx + torsoW;
    px(ctx, bx, ty + 1, '#181411', 3, 7);
    px(ctx, bx + (facingRight ? 1 : 0), ty + 1, '#5e4b35', 2, 6);
    px(ctx, bx + (facingRight ? 1 : 0), ty + 2, '#7d6448', 1, 3);
  }

  if (kind === 'player') {
    const backArmX = cx - dir * 4 - (stride > 0 ? 1 : 0);
    px(ctx, backArmX, 14 + bob, shirtDark, 2, 5);
    px(ctx, backArmX, 19 + bob, skinShadow, 2, 1);
  }

  // Isometric 3/4 Torso with NW-to-SE directional shading
  px(ctx, tx, ty - 1, '#121518', torsoW, 1);
  px(ctx, tx - 1, ty, '#121518', torsoW + 2, torsoH - 1);
  px(ctx, tx, ty + torsoH - 1, '#121518', torsoW, 2);
  px(ctx, tx, ty, shirt, torsoW, torsoH);
  px(ctx, facingRight ? tx : tx + Math.ceil(torsoW / 2), ty, shirtDark, Math.floor(torsoW / 2), torsoH);
  px(ctx, tx + (facingRight ? 2 : 0), ty, shirtHi, Math.max(2, torsoW - 3), 2);

  if (kind === 'player') {
    px(ctx, tx, ty + torsoH - 2, '#241e19', torsoW, 1);
    if (!facingUp) {
      px(ctx, tx + (facingRight ? torsoW - 2 : 1), ty + torsoH - 2, '#9e824c', 1, 1);
      px(ctx, tx + (facingRight ? 1 : torsoW - 2), ty + 1, '#4a3a28', 1, 4);
    } else {
      // Facing NE/NW away from camera: render full 3D survivor rucksack & bedroll on the back!
      const packX = tx + (facingRight ? 0 : 1);
      px(ctx, packX - 1, ty + 1, '#181411', 6, 7);
      px(ctx, packX, ty + 1, '#6b553d', 4, 6);
      px(ctx, packX, ty + 2, '#856b4d', 3, 2);
      px(ctx, packX + 1, ty + 5, '#473828', 3, 2);
      px(ctx, packX, ty, '#9e824c', 4, 1);
    }
  } else {
    px(ctx, tx + 1, ty + torsoH, shirtDark, 1, 1);
    px(ctx, tx + torsoW - 2, ty + torsoH, shirt, 1, 1);
    if (facingUp) {
      px(ctx, cx - 1, ty + 1, shirtDark, 2, torsoH - 2);
      px(ctx, cx, ty + 2, skinShadow, 1, 4);
    }
  }

  if (kind === 'bloater') {
    px(ctx, tx - 1, ty + 2, '#536b34', 2, 6);
    px(ctx, tx + torsoW - 1, ty + 3, '#3b4d24', 2, 5);
    px(ctx, tx + 2, ty + 2, '#b8f04f', 3, 3);
    px(ctx, tx + 3, ty + 3, '#e2ff99', 1, 1);
    px(ctx, tx + 6, ty + 5, '#9ed93b', 3, 2);
  }

  if (kind === 'spitter') {
    px(ctx, cx - dir * 3, ty + 1, '#4c706b', 2, 4);
    px(ctx, cx + dir, ty + 1, '#5ef2b5', 3, 3);
    px(ctx, cx + dir * 2, ty + 2, '#b8ffe2', 1, 1);
  }

  const hy = (kind === 'runner' ? 7 : kind === 'bloater' ? 6 : 5) + bob;
  const hx = cx - 3 + lean;
  px(ctx, hx + 1, hy - 1, '#121518', 5, 1);
  px(ctx, hx, hy, '#121518', 7, 6);
  px(ctx, hx + 1, hy + 6, '#121518', 5, 1);
  px(ctx, hx + 1, hy + 1, kind === 'player' ? skin : headColor, 5, 5);
  px(ctx, hx + (facingRight ? 1 : 4), hy + 2, skinShadow, 2, 3);

  if (kind === 'player') {
    px(ctx, hx + 1, hy, '#4b5940', 5, 2);
    if (facingUp) {
      px(ctx, hx + 1, hy + 1, '#333d2b', 5, 2);
      px(ctx, hx + 1, hy + 3, '#2b211a', 5, 2);
    } else {
      px(ctx, hx + (facingRight ? 3 : 0), hy + 1, '#333d2b', 4, 1);
      px(ctx, hx + (facingRight ? 4 : 2), hy + 3, eyeColor, 1, 1);
    }
  } else if (!facingUp) {
    px(ctx, hx + (facingRight ? 4 : 1), hy + 4, '#8f2424', 2, 1);
    px(ctx, hx + (facingRight ? 4 : 2), hy + 3, eyeColor, 1, 1);
  } else {
    px(ctx, hx + 2, hy + 1, skinShadow, 3, 4);
  }

  if (kind !== 'player') {
    const armY = ty + 2 + (frame === 2 ? 1 : 0) - (facingUp ? 1 : 0);
    const armX = facingRight ? cx + 3 + Math.floor(lean * 0.5) : cx - 8 + Math.floor(lean * 0.5);
    px(ctx, armX, armY, '#14171a', 5, 3);
    px(ctx, armX, armY + 1, skin, 5, 2);
    px(ctx, armX + (facingRight ? 4 : 0), armY + 1, '#942828', 1, 2);
  } else {
    const frontArmX = cx + (facingRight ? 2 : -4);
    px(ctx, frontArmX, ty + (facingUp ? 1 : 2), shirtHi, 3, 3);
    px(ctx, frontArmX + (facingRight ? 2 : 0), ty + (facingUp ? 3 : 4), skin, 1, 2);
  }

  return c;
}

/**
 * Builds true 2:1 isometric player-built structures (barricade, spike_trap, campfire)
 * using volumetric isometric voxel plotting instead of flat 2D rectangles.
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

function buildLootDropSprite(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(20, 18);
  const plot = makeIsoPlotter(ctx, 20, 18, 10, 12);
  for (let u = -4; u <= 4; u++) {
    for (let v = -3; v <= 3; v++) {
      plot(u, v, 0, 'rgba(6, 8, 10, 0.45)');
    }
  }
  for (let z = 1; z <= 4; z++) {
    for (let u = -3; u <= 3; u++) {
      for (let v = -2; v <= 2; v++) {
        const isTop = z === 4;
        const isStrap = u === 0;
        let col = '#4f5e46';
        if (isStrap) col = z === 3 && v === 2 ? '#f0c44d' : '#2b241d';
        else if (isTop) col = '#687a5c';
        else if (v === 2) col = '#57694d';
        else col = '#394533';
        plot(u, v, z, col);
      }
    }
  }
  return c;
}

export class PixelArtAtlas {
  private tiles = new Map<string, HTMLCanvasElement>();
  private props = new Map<string, HTMLCanvasElement>();
  private walls = new Map<string, HTMLCanvasElement>();
  private doors = new Map<string, HTMLCanvasElement>();
  private vehicles = new Map<string, HTMLCanvasElement>();
  private structures = new Map<string, HTMLCanvasElement>();
  private barrels: HTMLCanvasElement[] = [];
  private chars = new Map<string, HTMLCanvasElement>();
  private weaponIcons = new Map<WeaponId, HTMLCanvasElement>();
  private lootDropSprite: HTMLCanvasElement;

  constructor() {
    const tileKinds: TileKind[] = [
      'grass',
      'dirt',
      'road',
      'sidewalk',
      'floor',
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

    // Static environment props
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

    for (const ori of ['ns', 'ew'] as const) {
      for (const st of ['closed', 'open', 'locked', 'barricaded'] as const) {
        this.doors.set(`${ori}_${st}`, buildDoorSprite(ori, st));
      }
    }

    for (const kind of ['crate_wood', 'crate_military', 'fridge', 'med_cabinet'] as const) {
      this.props.set(kind, buildIsoObjectSprite(kind, false));
      this.props.set(`${kind}_open`, buildIsoObjectSprite(kind, true));
    }

    for (let f = 0; f < 4; f++) {
      this.barrels.push(buildBurnBarrelSprite(f));
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

    const actors: Array<'player' | ZombieArchetype> = ['player', 'walker', 'runner', 'bloater', 'spitter'];
    for (const actor of actors) {
      for (let f = 0; f < 4; f++) {
        this.chars.set(`${actor}_${f}_R_D`, buildCharacterSprite(actor, f, true, false));
        this.chars.set(`${actor}_${f}_L_D`, buildCharacterSprite(actor, f, false, false));
        this.chars.set(`${actor}_${f}_R_U`, buildCharacterSprite(actor, f, true, true));
        this.chars.set(`${actor}_${f}_L_U`, buildCharacterSprite(actor, f, false, true));
      }
    }
    this.lootDropSprite = buildLootDropSprite();
  }

  getLootDrop(): HTMLCanvasElement {
    return this.lootDropSprite;
  }

  getTile(kind: TileKind, variant: number): HTMLCanvasElement {
    return this.tiles.get(`${kind}_${variant % 4}`)!;
  }

  getWall(kind: 'wall_brick' | 'wall_wood', mask: number, variant: number): HTMLCanvasElement {
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

  getProp(kind: PropKind, searched = false, frame = 0): HTMLCanvasElement | undefined {
    if (kind === 'barrel_burn') {
      return this.barrels[frame % 4];
    }
    if (searched) {
      const openSprite = this.props.get(`${kind}_open`);
      if (openSprite) return openSprite;
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
    facingUp = false
  ): HTMLCanvasElement {
    const dir = facingRight ? 'R' : 'L';
    const vert = facingUp ? 'U' : 'D';
    return this.chars.get(`${kind}_${frame % 4}_${dir}_${vert}`)!;
  }

  getWeaponSprite(weapon: WeaponId): HTMLCanvasElement {
    let cached = this.weaponIcons.get(weapon);
    if (cached) return cached;
    const [c, ctx] = makeCanvas(16, 16);
    if (weapon === 'crowbar') {
      for (let i = 0; i < 10; i++) {
        px(ctx, 3 + i, 12 - i, '#6b757d', 2, 2);
      }
      px(ctx, 11, 2, '#c43e35', 3, 2);
      px(ctx, 13, 3, '#e0584f', 1, 1);
      px(ctx, 2, 11, '#c43e35', 2, 2);
    } else if (weapon === 'pistol') {
      px(ctx, 4, 6, '#566069', 8, 2);
      px(ctx, 4, 7, '#2f353b', 7, 1);
      px(ctx, 4, 8, '#1e2226', 2, 4);
      px(ctx, 6, 8, '#394047', 2, 2);
    } else if (weapon === 'shotgun') {
      px(ctx, 2, 8, '#6e472b', 4, 2);
      px(ctx, 5, 6, '#4c545c', 10, 2);
      px(ctx, 8, 8, '#593922', 4, 1);
      px(ctx, 14, 6, '#7a848f', 1, 1);
    } else {
      px(ctx, 7, 6, '#5f8a4b', 3, 6);
      px(ctx, 8, 7, '#87b86e', 1, 4);
      px(ctx, 8, 4, '#e0d6c3', 1, 2);
      px(ctx, 8, 2, '#f59e27', 2, 2);
      px(ctx, 8, 1, '#fff1a8', 1, 1);
    }
    this.weaponIcons.set(weapon, c);
    return c;
  }
}

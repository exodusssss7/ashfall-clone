import { useEffect, useRef, useState } from 'react';
import { Compass, Globe2 } from 'lucide-react';
import {
  CUBE_FACES,
  cubeFaceToSphere,
  sphereToCubeFace,
  type CubeFaceId,
  type Vec3,
} from '../game/cubeSphere';
import { sampleRawHillHeight } from '../game/terrainSystem';
import type { HudSnapshot, LandmarkKind } from '../game/types';
import { sampleBiomeAt, sampleOceanInfo, sampleRiverInfo, sampleRoadInfo } from '../game/worldGen';

interface Props {
  hud: HudSnapshot;
  seed?: number;
}

interface GlobeTexture {
  w: number;
  h: number;
  rgb: Uint8Array;
}

const TEXTURE_CACHE = new Map<number, GlobeTexture>();

/**
 * Pre-bakes a lightweight 144x72 spherical surface map directly from the live
 * Cube-Sphere 3D biome, river, great-circle highway, and elevation generators.
 * Cached per seed so rotating the 3D globe runs at 60fps with zero GC.
 */
function getOrBuildGlobeTexture(seed: number): GlobeTexture {
  const cached = TEXTURE_CACHE.get(seed);
  if (cached) return cached;

  const w = 96;
  const h = 48;
  const rgb = new Uint8Array(w * h * 3);

  for (let py = 0; py < h; py++) {
    // lat in [+PI/2 .. -PI/2] (top = North Pole / Ashfall Crown)
    const lat = (0.5 - (py + 0.5) / h) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    for (let px = 0; px < w; px++) {
      // lon in [-PI .. +PI]
      const lon = ((px + 0.5) / w - 0.5) * Math.PI * 2;
      const sp: Vec3 = {
        x: Math.sin(lon) * cosLat,
        y: sinLat,
        z: Math.cos(lon) * cosLat,
      };
      const { face, gx, gy } = sphereToCubeFace(sp);
      const igx = Math.floor(gx);
      const igy = Math.floor(gy);

      const ocean = sampleOceanInfo(seed, igx, igy, face);
      const river = sampleRiverInfo(seed, igx, igy, face);
      const road = sampleRoadInfo(seed, igx, igy, face);
      const biome = sampleBiomeAt(seed, igx, igy, face);
      const elev = sampleRawHillHeight(seed, gx, gy, face);

      let r = 74;
      let g = 112;
      let b = 68;

      if (biome === 'town_edge') {
        r = 178;
        g = 158;
        b = 116;
      } else if (ocean.inDeepSea) {
        r = 20;
        g = 62;
        b = 104;
      } else if (ocean.inShallowSea) {
        r = 42;
        g = 126;
        b = 156;
      } else if (ocean.inBeach) {
        r = 210;
        g = 188;
        b = 128;
      } else if (river.inWater) {
        r = 38;
        g = 104;
        b = 142;
      } else if (road.isMainHighway) {
        r = 112;
        g = 110;
        b = 104;
      } else if (biome === 'pine_forest') {
        r = 44;
        g = 88;
        b = 54;
      } else if (biome === 'river_valley') {
        r = 66;
        g = 108;
        b = 78;
      } else if (biome === 'scorched_barrens') {
        r = 128;
        g = 86;
        b = 58;
      } else {
        // rural_meadow
        r = 84;
        g = 122;
        b = 70;
      }

      // Highlight high mountain ridges & terraced plateaus
      if (!river.inWater && elev > 1.2) {
        const ridgeT = Math.min(1, (elev - 1.2) / 4.2);
        r = Math.round(r + (176 - r) * ridgeT * 0.55);
        g = Math.round(g + (178 - g) * ridgeT * 0.55);
        b = Math.round(b + (186 - b) * ridgeT * 0.55);
      }

      const idx = (py * w + px) * 3;
      rgb[idx] = r;
      rgb[idx + 1] = g;
      rgb[idx + 2] = b;
    }
  }

  const tex = { w, h, rgb };
  TEXTURE_CACHE.set(seed, tex);
  return tex;
}

function rotatePoint(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const y1 = p.y;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y1 * cp - z1 * sp;
  const z2 = y1 * sp + z1 * cp;
  return { x: x1, y: y2, z: z2 };
}

function invRotatePoint(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);
  const y1 = p.y * cp - p.z * sp;
  const z1 = p.y * sp + p.z * cp;
  const x1 = p.x;

  const cy = Math.cos(-yaw);
  const sy = Math.sin(-yaw);
  const x2 = x1 * cy - z1 * sy;
  const z2 = x1 * sy + z1 * cy;
  return { x: x2, y: y1, z: z2 };
}

function markerColor(kind: LandmarkKind, cleared: boolean, threat: 'low' | 'medium' | 'high'): string {
  if (cleared) return '#78c796';
  if (kind === 'cave') return '#70d9ff';
  if (threat === 'high') return '#ff5a52';
  return '#f0d078';
}

export function PlanetGlobeView({ hud, seed = 1994 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });

  const playerFace: CubeFaceId = hud.planetCoords?.face ?? 0;
  const playerSphere = cubeFaceToSphere(playerFace, hud.worldCoords.gx + 0.5, hud.worldCoords.gy + 0.5);

  // Initialize camera aimed at player's current planetary position
  const initLon = Math.atan2(playerSphere.x, playerSphere.z);
  const initLat = Math.asin(Math.max(-1, Math.min(1, playerSphere.y)));

  const [angles, setAngles] = useState<{ yaw: number; pitch: number }>({
    yaw: -initLon,
    pitch: initLat,
  });
  const [showCubeSeams, setShowCubeSeams] = useState(true);

  const focusOnSpherePoint = (p: Vec3) => {
    const lon = Math.atan2(p.x, p.z);
    const lat = Math.asin(Math.max(-1, Math.min(1, p.y)));
    setAngles({ yaw: -lon, pitch: lat });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tex = getOrBuildGlobeTexture(seed);
    const size = canvas.width;
    const cx = size * 0.5;
    const cy = size * 0.5;
    const radius = size * 0.42;

    const img = ctx.createImageData(size, size);
    const data = img.data;

    // Directional sunlight from upper-right-front
    const lx = 0.52;
    const ly = 0.58;
    const lz = 0.63;

    for (let py = 0; py < size; py++) {
      const ny = -(py - cy) / radius;
      for (let px = 0; px < size; px++) {
        const nx = (px - cx) / radius;
        const r2 = nx * nx + ny * ny;
        const off = (py * size + px) * 4;

        if (r2 > 1.0) {
          // Subtle atmospheric halo just outside limb
          if (r2 < 1.18) {
            const halo = Math.pow(1 - (r2 - 1.0) / 0.18, 2.2);
            data[off] = 88;
            data[off + 1] = 178;
            data[off + 2] = 224;
            data[off + 3] = Math.round(halo * 95);
          } else {
            data[off + 3] = 0;
          }
          continue;
        }

        const nz = Math.sqrt(Math.max(0, 1 - r2));
        const worldP = invRotatePoint({ x: nx, y: ny, z: nz }, angles.yaw, angles.pitch);

        // Equirectangular UV lookup into pre-baked Cube-Sphere surface texture
        const lon = Math.atan2(worldP.x, worldP.z); // -PI..PI
        const lat = Math.asin(Math.max(-1, Math.min(1, worldP.y))); // -PI/2..PI/2
        const u = Math.floor(((lon / (Math.PI * 2)) + 0.5) * tex.w) % tex.w;
        const v = Math.max(0, Math.min(tex.h - 1, Math.floor((0.5 - lat / Math.PI) * tex.h)));
        const tIdx = (v * tex.w + (u < 0 ? u + tex.w : u)) * 3;

        const ndotl = Math.max(0, nx * lx + ny * ly + nz * lz);
        const shade = 0.38 + ndotl * 0.68;
        const rim = Math.pow(1 - nz, 2.8);

        let r = tex.rgb[tIdx] * shade + 76 * rim * 0.45;
        let g = tex.rgb[tIdx + 1] * shade + 158 * rim * 0.45;
        let b = tex.rgb[tIdx + 2] * shade + 210 * rim * 0.52;

        // Optional subtle 12-edge Cube-Sphere boundary wireframe (where two dominant axes nearly tie)
        if (showCubeSeams) {
          const ax = Math.abs(worldP.x);
          const ay = Math.abs(worldP.y);
          const az = Math.abs(worldP.z);
          const mx = Math.max(ax, ay, az);
          const second = ax + ay + az - mx - Math.min(ax, ay, az);
          if (mx - second < 0.018) {
            r = r * 0.55 + 112 * 0.45;
            g = g * 0.55 + 217 * 0.45;
            b = b * 0.55 + 255 * 0.45;
          }
        }

        data[off] = Math.min(255, Math.round(r));
        data[off + 1] = Math.min(255, Math.round(g));
        data[off + 2] = Math.min(255, Math.round(b));
        data[off + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    // Draw front-facing Cube-Sphere sector labels
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of CUBE_FACES) {
      const rp = rotatePoint(f.normal, angles.yaw, angles.pitch);
      if (rp.z <= 0.12) continue;
      const sx = cx + rp.x * radius;
      const sy = cy - rp.y * radius;
      ctx.fillStyle = f.id === playerFace ? 'rgba(112, 217, 255, 0.95)' : 'rgba(240, 236, 225, 0.58)';
      ctx.fillText(f.code, sx, sy);
    }

    // Draw Ashfall Crossroads starter town marker (North Pole, Face 0)
    const townP = rotatePoint(cubeFaceToSphere(0, 28.5, 28.5), angles.yaw, angles.pitch);
    if (townP.z > 0) {
      const tx = cx + townP.x * radius;
      const ty = cy - townP.y * radius;
      ctx.fillStyle = '#f0d078';
      ctx.beginPath();
      ctx.arc(tx, ty, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0d1012';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw discovered landmarks across all 6 faces
    for (const lm of hud.discoveredLandmarks) {
      const lmFace: CubeFaceId = (lm.face ?? 0) as CubeFaceId;
      const lp = rotatePoint(cubeFaceToSphere(lmFace, lm.x, lm.y), angles.yaw, angles.pitch);
      if (lp.z <= 0) continue;
      const sx = cx + lp.x * radius;
      const sy = cy - lp.y * radius;
      ctx.fillStyle = markerColor(lm.kind, lm.hotspotCleared, lm.threatLevel);
      ctx.beginPath();
      ctx.moveTo(sx, sy - 3);
      ctx.lineTo(sx + 3, sy);
      ctx.lineTo(sx, sy + 3);
      ctx.lineTo(sx - 3, sy);
      ctx.closePath();
      ctx.fill();
    }

    // Draw live player beacon
    const pp = rotatePoint(playerSphere, angles.yaw, angles.pitch);
    if (pp.z > -0.05) {
      const sx = cx + pp.x * radius;
      const sy = cy - pp.y * radius;
      ctx.strokeStyle = 'rgba(94, 242, 143, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#5ef28f';
      ctx.beginPath();
      ctx.arc(sx, sy, 3.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [angles, hud.discoveredLandmarks, playerFace, playerSphere.x, playerSphere.y, playerSphere.z, seed, showCubeSeams]);

  return (
    <div className="hud-slot p-2.5 flex flex-col sm:flex-row items-center gap-3">
      <div className="relative shrink-0">
        <canvas
          ref={canvasRef}
          width={156}
          height={156}
          aria-label="Interactive 3D Cube-Sphere planet globe"
          className="block rounded-full cursor-grab active:cursor-grabbing touch-none select-none bg-[#090d11]"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
          }}
          onPointerMove={(e) => {
            if (!dragRef.current.active) return;
            const dx = e.clientX - dragRef.current.lastX;
            const dy = e.clientY - dragRef.current.lastY;
            dragRef.current.lastX = e.clientX;
            dragRef.current.lastY = e.clientY;
            setAngles((prev) => ({
              yaw: prev.yaw + dx * 0.014,
              pitch: Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, prev.pitch + dy * 0.014)),
            }));
          }}
          onPointerUp={() => {
            dragRef.current.active = false;
          }}
          onPointerCancel={() => {
            dragRef.current.active = false;
          }}
        />
      </div>

      <div className="flex-1 min-w-0 text-[10px] font-telemetry space-y-1.5">
        <div className="flex items-center gap-1.5 text-[#70d9ff] uppercase tracking-wider font-bold">
          <Globe2 className="w-3.5 h-3.5 shrink-0" />
          <span>{hud.planetCoords?.faceName ?? 'ASHFALL CROWN'}</span>
        </div>
        <div className="text-[#c7c2b6]">
          Pos: <span className="text-[#f0ece1]">{hud.planetCoords?.latLonLabel ?? '90°N 0°E'}</span> ·{' '}
          <span className="text-[#5ef28f]">{hud.planetCoords?.exploredPct ?? 0}%</span> Globe Charted (
          {hud.planetCoords?.exploredChunks ?? 0}/{hud.planetCoords?.totalChunks ?? 24576} chunks)
        </div>
        <div className="text-[#9aa09c] leading-snug">
          Drag globe to orbit all 6 Cube-Sphere sectors. Drive or walk past any sector edge to circumnavigate (4,096 tiles).
        </div>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() => focusOnSpherePoint(playerSphere)}
            className="hud-slot px-2 py-1 text-[9px] text-[#5ef28f] hover:border-[#5ef28f] cursor-pointer inline-flex items-center gap-1"
          >
            <Compass className="w-3 h-3" /> Center Me
          </button>
          <button
            type="button"
            onClick={() => focusOnSpherePoint({ x: 0, y: 1, z: 0 })}
            className="hud-slot px-2 py-1 text-[9px] text-[#f0d078] hover:border-[#f0d078] cursor-pointer"
          >
            Crown (+Y)
          </button>
          <button
            type="button"
            onClick={() => focusOnSpherePoint({ x: 0, y: -1, z: 0 })}
            className="hud-slot px-2 py-1 text-[9px] text-[#ff6e66] hover:border-[#ff6e66] cursor-pointer"
          >
            Caldera (-Y)
          </button>
          <button
            type="button"
            onClick={() => setShowCubeSeams((s) => !s)}
            className="hud-slot px-2 py-1 text-[9px] text-[#70d9ff] hover:border-[#70d9ff] cursor-pointer"
          >
            {showCubeSeams ? 'Hide Seams' : 'Show Seams'}
          </button>
        </div>
      </div>
    </div>
  );
}

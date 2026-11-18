import type { CameraMode } from './types';

export interface SpatialPosition {
  x: number;
  y: number;
  height?: number;
}

export interface AudioListenerPose {
  x: number;
  y: number;
  z: number;
  forwardX: number;
  forwardY: number;
  forwardZ: number;
  upX: number;
  upY: number;
  upZ: number;
}

/** Isometric camera looks along (-1, -sqrt(2/3), -1); its horizontal ground forward points (-1/sqrt(2), 0, -1/sqrt(2)). */
export const ISO_LISTENER_FORWARD_X = -Math.SQRT1_2;
export const ISO_LISTENER_FORWARD_Z = -Math.SQRT1_2;

export const SPATIAL_REF_DISTANCE = 2.4;
export const SPATIAL_MAX_DISTANCE = 44;
export const SPATIAL_ROLLOFF_FACTOR = 1.15;

/**
 * Converts simulation 2D tile coordinates (x, y) + vertical elevation height
 * into Three.js / Web Audio right-handed 3D coordinates (X = x, Y = height, Z = y).
 */
export function worldToAudioPosition(pos: SpatialPosition, defaultHeight = 1.0): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: Number.isFinite(pos.x) ? pos.x : 0,
    y: Number.isFinite(pos.height) ? (pos.height as number) : defaultHeight,
    z: Number.isFinite(pos.y) ? pos.y : 0,
  };
}

/**
 * Computes orthonormal AudioListener position and orientation for Web Audio HRTF
 * synchronized to both First-Person (FPS) and Isometric (ISO) camera views.
 *
 * - FPS: anchored at survivor eye height, looking along (facingAngle, fpsPitch).
 * - ISO: anchored at survivor height, aligned to the isometric viewport's top-of-screen
 *   forward (-1/sqrt(2), 0, -1/sqrt(2)) so screen-left emitters always pan to the left
 *   ear and screen-right emitters always pan to the right ear.
 */
export function computeAudioListenerPose(params: {
  cameraMode: CameraMode;
  playerX: number;
  playerY: number;
  facingAngle: number;
  fpsPitch: number;
  eyeHeight?: number;
  inVehicle?: boolean;
}): AudioListenerPose {
  const px = Number.isFinite(params.playerX) ? params.playerX : 0;
  const py = Number.isFinite(params.playerY) ? params.playerY : 0;

  if (params.cameraMode === 'fps') {
    const pitch = Math.max(-1.3, Math.min(1.3, params.fpsPitch || 0));
    const cosP = Math.cos(pitch);
    const fx = Math.cos(params.facingAngle) * cosP;
    const fy = Math.sin(pitch);
    const fz = Math.sin(params.facingAngle) * cosP;

    // Right = forward x worldUp(0, 1, 0) = (-fz, 0, fx)
    const rx = -fz;
    const rz = fx;
    const rLen = Math.hypot(rx, rz) || 1;
    const nrx = rx / rLen;
    const nrz = rz / rLen;

    // Camera-orthonormal up = right x forward (with nry = 0)
    const ux = -nrz * fy;
    const uy = nrz * fx - nrx * fz;
    const uz = nrx * fy;
    const uLen = Math.hypot(ux, uy, uz) || 1;

    const defaultEye = params.inVehicle ? 1.18 : 1.58;
    return {
      x: px,
      y: params.eyeHeight ?? defaultEye,
      z: py,
      forwardX: fx,
      forwardY: fy,
      forwardZ: fz,
      upX: ux / uLen,
      upY: uy / uLen,
      upZ: uz / uLen,
    };
  }

  // ISO mode: align listener azimuth with the isometric screen axes
  return {
    x: px,
    y: params.eyeHeight ?? 1.5,
    z: py,
    forwardX: ISO_LISTENER_FORWARD_X,
    forwardY: 0,
    forwardZ: ISO_LISTENER_FORWARD_Z,
    upX: 0,
    upY: 1,
    upZ: 0,
  };
}

/**
 * Helper for tests/telemetry: computes signed stereo lateral projection in [-1, 1]
 * where -1 is directly left of listener and +1 is directly right of listener.
 */
export function computeListenerRightSign(
  listener: AudioListenerPose,
  emitter: SpatialPosition
): { pan: number; distance: number } {
  const e = worldToAudioPosition(emitter, listener.y);
  const dx = e.x - listener.x;
  const dy = e.y - listener.y;
  const dz = e.z - listener.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-5) return { pan: 0, distance: 0 };

  // Right vector = forward x up
  const rx = listener.forwardY * listener.upZ - listener.forwardZ * listener.upY;
  const ry = listener.forwardZ * listener.upX - listener.forwardX * listener.upZ;
  const rz = listener.forwardX * listener.upY - listener.forwardY * listener.upX;
  const rLen = Math.hypot(rx, ry, rz) || 1;

  const dot = (dx * rx + dy * ry + dz * rz) / (distance * rLen);
  return {
    pan: Math.max(-1, Math.min(1, dot)),
    distance,
  };
}

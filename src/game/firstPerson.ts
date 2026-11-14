import { clamp } from './isometric';

export const FPS_PITCH_MIN = -Math.PI * 0.36;
export const FPS_PITCH_MAX = Math.PI * 0.32;
export const FPS_EYE_HEIGHT = 0.88;
export const FPS_CAR_EYE_HEIGHT = 0.92;
export const FPS_BASE_FOV = 72;
export const FPS_TOUCH_LOOK_SENSITIVITY = 0.0046;

export function wrapAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function applyFirstPersonLookDelta(
  yaw: number,
  pitch: number,
  dx: number,
  dy: number,
  sensitivity = 0.0026
): { yaw: number; pitch: number } {
  const nextYaw = wrapAngleRad(yaw + dx * sensitivity);
  const nextPitch = clamp(pitch - dy * sensitivity, FPS_PITCH_MIN, FPS_PITCH_MAX);
  return { yaw: nextYaw, pitch: nextPitch };
}

export function applyFirstPersonTouchLookDelta(
  yaw: number,
  pitch: number,
  dx: number,
  dy: number,
  sensitivity = FPS_TOUCH_LOOK_SENSITIVITY
): { yaw: number; pitch: number } {
  return applyFirstPersonLookDelta(yaw, pitch, dx, dy, sensitivity);
}

export function computeFirstPersonMoveVector(
  forwardInput: number,
  strafeInput: number,
  yaw: number
): { wx: number; wy: number } {
  if (Math.abs(forwardInput) < 1e-4 && Math.abs(strafeInput) < 1e-4) {
    return { wx: 0, wy: 0 };
  }
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const rx = -Math.sin(yaw);
  const ry = Math.cos(yaw);

  const rawX = fx * forwardInput + rx * strafeInput;
  const rawY = fy * forwardInput + ry * strafeInput;
  const len = Math.hypot(rawX, rawY);
  if (len < 1e-5) return { wx: 0, wy: 0 };
  return { wx: rawX / len, wy: rawY / len };
}

export function computeFirstPersonAimRange(pitch: number, defaultRange = 5.5, minRange = 1.2, maxRange = 7.5): number {
  if (pitch >= -0.08) {
    return clamp(defaultRange + Math.max(0, pitch) * 4.5, minRange, maxRange);
  }
  const groundDist = FPS_EYE_HEIGHT / Math.tan(-pitch);
  return clamp(groundDist, minRange, maxRange);
}

export function computeFirstPersonAimWorldTarget(
  px: number,
  py: number,
  yaw: number,
  pitch: number,
  defaultRange = 5.5,
  minRange = 1.2,
  maxRange = 7.5
): { wx: number; wy: number; range: number } {
  const range = computeFirstPersonAimRange(pitch, defaultRange, minRange, maxRange);
  return {
    wx: px + Math.cos(yaw) * range,
    wy: py + Math.sin(yaw) * range,
    range,
  };
}

export function computeFirstPersonHeadBob(
  walkCycle: number,
  speed: number,
  isSprinting: boolean,
  dodgeTimer: number
): { eyeOffsetY: number; swayX: number; swayY: number } {
  if (dodgeTimer > 0) {
    return { eyeOffsetY: -0.28, swayX: 0, swayY: -0.04 };
  }
  const speedBlend = clamp(speed / 4.2, 0, 1);
  if (speedBlend <= 0.02) {
    return { eyeOffsetY: 0, swayX: 0, swayY: 0 };
  }
  const ampY = (isSprinting ? 0.042 : 0.026) * speedBlend;
  const ampX = (isSprinting ? 0.024 : 0.015) * speedBlend;
  return {
    eyeOffsetY: Math.sin(walkCycle * 1.1) * ampY,
    swayX: Math.cos(walkCycle * 0.55) * ampX,
    swayY: Math.abs(Math.sin(walkCycle * 0.55)) * ampY * 0.85,
  };
}

export function computeFirstPersonStrafeRoll(
  strafeInput: number,
  speed: number,
  maxRoll = 0.022
): number {
  const speedBlend = clamp(speed / 4.2, 0, 1);
  if (speedBlend <= 0) return 0;
  return (clamp(-strafeInput, -1, 1) * speedBlend * maxRoll) || 0;
}

export function computeFirstPersonWeaponRaiseOffset(
  swapTimer: number,
  duration = 0.22
): number {
  if (swapTimer <= 0 || duration <= 0) return 0;
  const t = clamp(swapTimer / duration, 0, 1);
  return -(t * t) * 0.14;
}

export function pickBestDirectionalTarget<T>(
  originX: number,
  originY: number,
  facingAngle: number,
  items: readonly T[],
  getPos: (item: T) => { x: number; y: number },
  maxDist: number,
  forwardBias = 0.75
): T | null {
  const fx = Math.cos(facingAngle);
  const fy = Math.sin(facingAngle);
  let best: T | null = null;
  let bestScore = Infinity;

  for (const item of items) {
    const pos = getPos(item);
    const dx = pos.x - originX;
    const dy = pos.y - originY;
    const d = Math.hypot(dx, dy);
    if (d >= maxDist) continue;
    const inv = d > 1e-4 ? 1 / d : 0;
    const dot = d > 1e-4 ? (dx * fx + dy * fy) * inv : 1;
    const score = d - dot * forwardBias;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

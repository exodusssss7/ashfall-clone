import { soundEngine } from './sound';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface GameSettings {
  /** Effects/ambience loudness, 0..1. There is no music channel in the game. */
  sfxVolume: number;
  muted: boolean;
  graphicsQuality: GraphicsQuality;
  /** Multiplier applied to touch-look and mouse-look deltas, 0.5..2. */
  touchSensitivity: number;
  screenShake: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  sfxVolume: 1,
  muted: false,
  graphicsQuality: 'high',
  touchSensitivity: 1,
  screenShake: true,
};

const STORAGE_KEY = 'ashfall_settings_v1';

function sanitize(raw: Partial<GameSettings> | null | undefined): GameSettings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  s.sfxVolume = clampNum(s.sfxVolume, 0, 1, DEFAULT_SETTINGS.sfxVolume);
  s.touchSensitivity = clampNum(s.touchSensitivity, 0.5, 2, DEFAULT_SETTINGS.touchSensitivity);
  s.muted = Boolean(s.muted);
  s.screenShake = Boolean(s.screenShake);
  if (s.graphicsQuality !== 'low' && s.graphicsQuality !== 'medium' && s.graphicsQuality !== 'high') {
    s.graphicsQuality = DEFAULT_SETTINGS.graphicsQuality;
  }
  return s;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function load(): GameSettings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return sanitize(raw ? (JSON.parse(raw) as Partial<GameSettings>) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: GameSettings = load();

const listeners = new Set<(s: GameSettings) => void>();

/** Push the parts of the settings the audio engine owns. */
function applyAudio(s: GameSettings): void {
  soundEngine.setVolume(s.sfxVolume);
  soundEngine.setMuted(s.muted);
}

export function getSettings(): GameSettings {
  return current;
}

export function updateSettings(patch: Partial<GameSettings>): GameSettings {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // private mode / WebView storage denial: keep runtime settings anyway
  }
  applyAudio(current);
  for (const fn of listeners) fn(current);
  return current;
}

export function subscribeSettings(fn: (s: GameSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called once at boot so persisted settings reach the audio engine. */
export function initSettings(): GameSettings {
  applyAudio(current);
  return current;
}

/** Fraction of particle spawns kept at the current graphics quality. */
export function particleBudgetScale(): number {
  const q = current.graphicsQuality;
  return q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
}

/** Renderer pixel-ratio cap for the current graphics quality. */
export function pixelRatioCap(deviceRatio: number): number {
  const q = current.graphicsQuality;
  const dpr = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  if (q === 'low') return Math.min(dpr, 1);
  if (q === 'medium') return Math.min(dpr, 1.5);
  return Math.min(dpr, 2);
}

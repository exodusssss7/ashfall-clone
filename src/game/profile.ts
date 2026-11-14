/**
 * Player identity and colour-only appearance, persisted across runs.
 * The 3D rig, generated player textures and the customizer preview all
 * derive their palettes from here, so one saved profile skins every view.
 */

export interface PlayerAppearance {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
}

export interface PlayerProfile {
  /** Display name chosen on first run. Empty until named. */
  name: string;
  appearance: PlayerAppearance;
  /** True once the player has completed (or confirmed) the first-run setup. */
  customized: boolean;
}

export const DEFAULT_APPEARANCE: PlayerAppearance = {
  skin: '#d6ac88',
  shirt: '#455b42',
  pants: '#323b45',
  hair: '#4b5940', // the survivor's cap; back-of-head hair derives from it
};

export const DEFAULT_PROFILE: PlayerProfile = {
  name: '',
  appearance: { ...DEFAULT_APPEARANCE },
  customized: false,
};

/** Swatch presets offered in the customizer. First entry is the classic look. */
export const APPEARANCE_PRESETS: Record<keyof PlayerAppearance, string[]> = {
  skin: ['#d6ac88', '#f0cfa8', '#b98a62', '#8a5f43', '#6b4429', '#e8b8a0'],
  shirt: ['#455b42', '#374e6b', '#6b3737', '#565a61', '#6e5636', '#2f5d5a', '#5b3a68', '#33363b'],
  pants: ['#323b45', '#3a2f28', '#26292e', '#44504a', '#4d3a52', '#5c5346'],
  hair: ['#4b5940', '#3a2b22', '#181818', '#6e4b2a', '#8c8c8c', '#5a2e2e'],
};

const STORAGE_KEY = 'ashfall_profile_v1';
const MAX_NAME_LEN = 12;

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, MAX_NAME_LEN);
}

function sanitizeAppearance(raw: Partial<PlayerAppearance> | null | undefined): PlayerAppearance {
  const a = { ...DEFAULT_APPEARANCE, ...(raw ?? {}) };
  for (const key of Object.keys(DEFAULT_APPEARANCE) as Array<keyof PlayerAppearance>) {
    if (!isHexColor(a[key])) a[key] = DEFAULT_APPEARANCE[key];
  }
  return a;
}

function sanitize(raw: Partial<PlayerProfile> | null | undefined): PlayerProfile {
  const p = { ...DEFAULT_PROFILE, ...(raw ?? {}) };
  p.name = sanitizeName(p.name);
  p.appearance = sanitizeAppearance(p.appearance);
  p.customized = Boolean(p.customized);
  return p;
}

function load(): PlayerProfile {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return sanitize(raw ? (JSON.parse(raw) as Partial<PlayerProfile>) : null);
  } catch {
    return { ...DEFAULT_PROFILE, appearance: { ...DEFAULT_APPEARANCE } };
  }
}

let current: PlayerProfile = load();

const listeners = new Set<(p: PlayerProfile) => void>();

export function getProfile(): PlayerProfile {
  return current;
}

export function updateProfile(patch: Partial<PlayerProfile>): PlayerProfile {
  current = sanitize({ ...current, ...patch, appearance: { ...current.appearance, ...(patch.appearance ?? {}) } });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // private mode / WebView storage denial: keep runtime profile anyway
  }
  for (const fn of listeners) fn(current);
  return current;
}

export function subscribeProfile(fn: (p: PlayerProfile) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** First-run setup is done once the profile has been confirmed with a name. */
export function hasCompletedSetup(): boolean {
  return current.customized && current.name.length > 0;
}

/** Multiply a #rrggbb colour; factor > 1 lightens, < 1 darkens. */
export function shadeHex(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = ch((n >> 16) & 0xff);
  const g = ch((n >> 8) & 0xff);
  const b = ch(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export interface PlayerPalette {
  skin: string;
  skinShadow: string;
  shirt: string;
  shirtHi: string;
  shirtDark: string;
  pants: string;
  pantsHi: string;
  pantsDark: string;
  hair: string;
}

/** Derived tints/shades for the pixel textures and 3D rig from the three base colours. */
export function derivePlayerPalette(a: PlayerAppearance = current.appearance): PlayerPalette {
  return {
    skin: a.skin,
    skinShadow: shadeHex(a.skin, 0.72),
    shirt: a.shirt,
    shirtHi: shadeHex(a.shirt, 1.38),
    shirtDark: shadeHex(a.shirt, 0.56),
    pants: a.pants,
    pantsHi: shadeHex(a.pants, 1.42),
    pantsDark: shadeHex(a.pants, 0.6),
    hair: a.hair,
  };
}

import { getDaylightInfo } from './survivalLogic';

/** Equal-power day/night blend follows the world's existing dawn/dusk lighting. */
export function ambienceMix(timeMinutes: number): { day: number; night: number } {
  const darkness = getDaylightInfo(timeMinutes).darkness;
  const night = Math.max(0, Math.min(1, (darkness - 0.08) / 0.7));
  return { day: Math.cos(night * Math.PI / 2), night: Math.sin(night * Math.PI / 2) };
}

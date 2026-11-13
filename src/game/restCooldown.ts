// Awake gameplay only: sleep's time skip, pause, and title screens never pay down this gap.
export const BED_REST_COOLDOWN_SECONDS = 60;
export function tickRestCooldown(remaining: number, dt: number, playing: boolean): number {
  return playing ? Math.max(0, remaining - Math.max(0, dt)) : remaining;
}
export function formatRestCooldown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

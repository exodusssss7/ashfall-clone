/** Normalized stick travel. Touchdown is neutral; inner circle is aim-only. */
export const AIM_DIRECTION_DEADZONE = 0.06;
export const AIM_ATTACK_THRESHOLD = 0.5;
export function touchAimAttack(active: boolean, magnitude: number): boolean {
  return active && magnitude >= AIM_ATTACK_THRESHOLD;
}

/** Sound-only recovery state. Does not change stamina, movement or survival. */
export interface SprintBreathingState { sprintSeconds: number; wasSprinting: boolean }
export function tickSprintBreathing(state: SprintBreathingState, sprinting: boolean, active: boolean, dt: number) {
  if (!active) return { state: { sprintSeconds: 0, wasSprinting: false }, playSeconds: 0 };
  if (sprinting) return {
    state: { sprintSeconds: Math.min(12, state.sprintSeconds + Math.max(0, dt)), wasSprinting: true },
    playSeconds: 0,
  };
  const playSeconds = state.wasSprinting && state.sprintSeconds >= 1.2
    ? Math.min(6, 2 + state.sprintSeconds * 0.4) : 0;
  return { state: { sprintSeconds: 0, wasSprinting: false }, playSeconds };
}
